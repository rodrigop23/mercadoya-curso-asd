"""Runner offline aislado del entorno y experimentos locales con aevaluate."""

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict
from contextlib import closing, contextmanager
from pathlib import Path
from unittest.mock import patch

from agent_service.evals.auth import EvaluationConfigError, validate_buyer_jwt
from agent_service.evals.dataset import (
    DATASET_NAME,
    THRESHOLDS_PATH,
    example_payload,
    load_cases,
    sync_dataset,
)


def summarize(rows, thresholds, mode):
    scores, kinds = defaultdict(list), defaultdict(lambda: defaultdict(list))
    failures = []
    skipped = Counter()
    errors = []
    for inputs, feedbacks, error in rows:
        if error or any((result.get("extra") or {}).get("error") for result in feedbacks):
            errors.append(inputs["id"])
        for result in feedbacks:
            score = result.get("score")
            if score is None and not (result.get("extra") or {}).get("error"):
                skipped[result["key"]] += 1
            if score is not None:
                key = result["key"]
                scores[key].append(float(score))
                kinds[inputs["kind"]][key].append(float(score))
                if score < thresholds.get(key, 0):
                    failures.append({"id": inputs["id"], "evaluator": key})

    def averages(values):
        return {
            key: {"score": sum(items) / len(items), "count": len(items)}
            for key, items in sorted(values.items())
        }

    averages_all = averages(scores)
    below = [
        key
        for key, threshold in thresholds.items()
        if key in averages_all and averages_all[key]["score"] < threshold
    ]
    return {
        "mode": mode,
        "cases": len(rows),
        "evaluators": averages_all,
        "by_kind": {kind: averages(values) for kind, values in sorted(kinds.items())},
        "below_threshold": below,
        "skipped": dict(sorted(skipped.items())),
        "failures": failures,
        "errors": errors,
        "thresholds_blocking": mode == "offline",
        "tool_selection_measures_model": mode == "langsmith",
    }


@contextmanager
def offline_environment():
    ignored = sorted(
        key
        for key in os.environ
        if os.environ[key]
        and (
            key in {"LANGSMITH_API_KEY", "LANGCHAIN_API_KEY", "OPENAI_API_KEY"}
            or key.startswith("CLOUDFLARE_")
        )
    )
    if ignored:
        print("Offline ignora credenciales: " + ", ".join(ignored), file=sys.stderr)
    with patch.dict(os.environ):
        for key in ignored:
            os.environ.pop(key, None)
        os.environ.update(
            AGENT_MODEL_PROVIDER="scripted",
            AGENT_CLASSIFIER_PROVIDER="rules",
            AGENT_CLASSIFIER_FAIL_OPEN="false",
            AGENT_MODERATION="off",
            LANGSMITH_TRACING="false",
            LANGCHAIN_TRACING_V2="false",
            LANGSMITH_TEST_TRACKING="false",
            AGENT_MAX_INPUT_CHARS="2000",
        )
        for key in (
            "AGENT_EVAL_PRODUCT_ID",
            "AGENT_EVAL_ORDER_ID",
            "AGENT_TEST_CLASSIFIER_TIMEOUT",
        ):
            os.environ.pop(key, None)
        from langsmith import tracing_context

        with tracing_context(enabled=False):
            yield


async def offline(args):
    with offline_environment():
        from agent_service.evals.evaluators import CODE_EVALUATORS
        from agent_service.evals.target import evaluation_runtime, run_case

        cases = load_cases(split=args.split)
        semaphore = asyncio.Semaphore(args.max_concurrency)

        async def evaluate(case):
            payload = example_payload(case)
            inputs = payload["inputs"]
            async with semaphore:
                try:
                    outputs = await run_case(inputs)
                    feedbacks = [fn(inputs, outputs, payload["outputs"]) for fn in CODE_EVALUATORS]
                    return inputs, feedbacks, False
                except Exception:
                    # No incluir cuerpos ni excepciones con credenciales o texto de entrada.
                    return inputs, [], True

        async with evaluation_runtime("offline"):
            rows = await asyncio.gather(*(evaluate(case) for case in cases))
        return summarize(rows, args.thresholds["offline"], "offline")


def require_local_environment():
    required = [
        "LANGSMITH_API_KEY",
        "OPENAI_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "MCP_INTERNAL_TOKEN",
        "AGENT_EVAL_BUYER_JWT",
        "AGENT_EVAL_PRODUCT_ID",
        "AGENT_EVAL_ORDER_ID",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise EvaluationConfigError("Faltan variables: " + ", ".join(missing))
    validate_buyer_jwt()


def experiment_metadata(args):
    from agent_service import prompts
    from agent_service.config import settings

    cfg = settings()
    prompt = prompts.SHOPPING_PROMPT + "\n" + prompts.POST_SALE_PROMPT
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    evaluation = hashlib.sha256()
    for name in ("auth.py", "dataset.py", "evaluators.py", "runner.py", "target.py"):
        evaluation.update(name.encode() + b"\0" + Path(__file__).with_name(name).read_bytes())
    return {
        "models": [cfg.model],
        "classifier": cfg.classifier_provider,
        "classifier_model": cfg.classifier_model,
        "git_sha": sha,
        "dataset_tag": args.dataset_tag or "latest",
        "prompt_hash": hashlib.sha256(prompt.encode()).hexdigest(),
        "evaluation_hash": evaluation.hexdigest(),
        "fixture_hash": hashlib.sha256(
            (os.environ["AGENT_EVAL_PRODUCT_ID"] + os.environ["AGENT_EVAL_ORDER_ID"]).encode()
        ).hexdigest(),
        "judge_model": os.getenv("AGENT_EVAL_JUDGE_MODEL", cfg.model),
    }


async def langsmith_run(args):
    require_local_environment()
    try:
        import openevals  # noqa: F401
    except ImportError:
        raise EvaluationConfigError("Instala jueces con uv sync --locked --group evals") from None
    # No heredar scripted/rules de una terminal usada para smokes.
    os.environ.update(
        AGENT_MODEL_PROVIDER="openai", AGENT_CLASSIFIER_PROVIDER="clef", LANGSMITH_TRACING="true"
    )
    from langsmith import Client, aevaluate, tracing_context

    from agent_service.evals.evaluators import CODE_EVALUATORS, llm_evaluators
    from agent_service.evals.target import evaluation_runtime, run_case
    from agent_service.guardrails.privacy import sanitize_trace

    with (
        closing(Client(anonymizer=sanitize_trace)) as client,
        tracing_context(client=client, enabled=True),
    ):
        if not args.no_sync:
            print(json.dumps({"sync": sync_dataset(client, load_cases())}))
        examples = list(
            client.list_examples(
                dataset_name=DATASET_NAME,
                as_of=args.dataset_tag or "latest",
                splits=[args.split] if args.split else None,
            )
        )
        if not examples:
            raise EvaluationConfigError("El split o versión no contiene ejemplos")
        async with evaluation_runtime("langsmith"):
            validate_buyer_jwt()
            results = await aevaluate(
                run_case,
                data=examples,
                evaluators=[*CODE_EVALUATORS, *llm_evaluators()],
                client=client,
                experiment_prefix=args.experiment_prefix,
                description="Grafo real en proceso; sin reanudar interrupts",
                max_concurrency=args.max_concurrency,
                metadata=experiment_metadata(args),
                disable_evaluator_tracing=True,
            )
            rows = []
            async for row in results:
                feedbacks = [item.model_dump() for item in row["evaluation_results"]["results"]]
                run = row["run"]
                rows.append((row["example"].inputs, feedbacks, bool(run.error)))
        summary = summarize(rows, args.thresholds["langsmith"], "langsmith")
        summary["experiment_url"] = results.url
        return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["offline", "langsmith"], default="offline")
    parser.add_argument("--split")
    parser.add_argument("--max-concurrency", type=int, default=2)
    parser.add_argument("--experiment-prefix", default="agent")
    parser.add_argument("--dataset-tag")
    parser.add_argument("--no-sync", action="store_true")
    parser.add_argument("--thresholds", default=str(THRESHOLDS_PATH))
    args = parser.parse_args(argv)
    if not 1 <= args.max_concurrency <= 4:
        parser.error("--max-concurrency debe estar entre 1 y 4")
    try:
        args.thresholds = json.loads(Path(args.thresholds).read_text())
        summary = asyncio.run(offline(args) if args.mode == "offline" else langsmith_run(args))
    except EvaluationConfigError as error:
        # Los ValueError propios solo llevan nombres de configuración, nunca valores.
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print("Evaluación incompleta; revisar servicios, permisos y dependencias", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return int(
        bool(summary["errors"]) or (args.mode == "offline" and bool(summary["below_threshold"]))
    )
