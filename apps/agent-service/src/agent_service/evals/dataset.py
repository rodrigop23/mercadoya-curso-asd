"""Fuente de verdad en git y sincronización por metadata.case_id."""

import json
import os
from pathlib import Path

DATASET_NAME = "mercadoya-agent-evals"
ROOT = Path(__file__).resolve().parents[3]
CASES_PATH = ROOT / "evals/agent_cases.jsonl"
THRESHOLDS_PATH = ROOT / "evals/thresholds.json"


def bind_text(text):
    for name in ("product_id", "order_id"):
        text = text.replace(
            "{" + name + "}",
            os.getenv("AGENT_EVAL_" + name.upper(), "00000000-0000-4000-8000-000000000001"),
        )
    return text


def load_cases(path=CASES_PATH, split=None):
    cases = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("Ids duplicados en el dataset")
    for case in cases:
        if case["metadata"]["kind"] not in {"domain", "routing", "tools", "proposal", "guardrail"}:
            raise ValueError("Kind desconocido")
    selected = [case for case in cases if split is None or case["split"] == split]
    if not selected:
        raise ValueError("El split no contiene casos")
    return selected


def example_payload(case):
    return {
        "inputs": {
            **{key: value for key, value in case.items() if key not in {"expected", "metadata"}},
            "kind": case["metadata"]["kind"],
        },
        "outputs": case["expected"],
        "metadata": {**case["metadata"], "case_id": case["id"]},
        "split": case["split"],
    }


def sync_dataset(client, cases, tag=None):
    from langsmith.utils import LangSmithNotFoundError

    # Validar ids antes de cualquier mutación remota.
    payloads = {case["id"]: example_payload(case) for case in cases}
    if len(payloads) != len(cases):
        raise ValueError("Ids duplicados en el dataset")
    try:
        dataset = client.read_dataset(dataset_name=DATASET_NAME)
    except LangSmithNotFoundError:
        dataset = client.create_dataset(dataset_name=DATASET_NAME)
    existing = list(client.list_examples(dataset_id=dataset.id))
    by_id = {}
    for example in existing:
        case_id = (example.metadata or {}).get("case_id")
        if case_id in by_id:
            raise ValueError("case_id remoto duplicado; revisar el dataset")
        by_id[case_id] = example
    counts = dict(created=0, updated=0, deleted=0)
    creates = []
    for case_id, payload in payloads.items():
        previous = by_id.get(case_id)
        if previous is None:
            creates.append(payload)
            continue
        metadata = dict(previous.metadata or {})
        splits = metadata.pop("dataset_split", [])
        splits = [splits] if isinstance(splits, str) else splits
        if (
            previous.inputs != payload["inputs"]
            or previous.outputs != payload["outputs"]
            or metadata != payload["metadata"]
            or splits != [payload["split"]]
        ):
            client.update_example(previous.id, **payload)
            counts["updated"] += 1
    if creates:
        client.create_examples(dataset_id=dataset.id, examples=creates)
        counts["created"] = len(creates)
    for case_id, example in by_id.items():
        if case_id not in payloads:
            client.delete_example(example.id)
            counts["deleted"] += 1
    if tag:
        version = client.read_dataset_version(dataset_id=dataset.id, tag="latest")
        client.update_dataset_tag(dataset_id=dataset.id, as_of=version.as_of, tag=tag)
    return counts
