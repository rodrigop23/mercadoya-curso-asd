import asyncio
import copy
import json
import os
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest

from agent_service.evals import evaluators as ev
from agent_service.evals.dataset import example_payload, load_cases, sync_dataset
from agent_service.evals.fakes import PID, PRODUCT
from agent_service.evals.runner import main, offline_environment, summarize
from agent_service.evals.target import evaluation_runtime, run_case

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def buyer_jwt():
    return jwt.encode(
        {"sub": "eval-demo-buyer", "exp": int(time.time()) + 300},
        "eval-signing-key-for-tests-only-0000000000",
        algorithm="HS256",
    )


@pytest.mark.parametrize(
    "evaluator,kind,outputs,expected,bad",
    [
        (
            ev.domain_correct,
            "domain",
            {"in_domain": True},
            {"in_domain": True},
            {"in_domain": False},
        ),
        (
            ev.category_correct,
            "domain",
            {"category": "productos"},
            {"category": "productos"},
            {"category": "pedidos"},
        ),
        (
            ev.route_correct,
            "routing",
            {"agent": "shopping"},
            {"agent": "shopping"},
            {"agent": "post_sale"},
        ),
        (
            ev.tool_selected,
            "tools",
            {"tools_called": ["get_product"]},
            {"tools_any": ["get_product"], "forbidden_tools": ["cancel_my_order"]},
            {"tools_called": []},
        ),
        (
            ev.proposal_not_executed,
            "proposal",
            {"proposal": {"kind": "cancel_order"}, "executed_writes": []},
            {"proposal_kind": "cancel_order", "executed": False},
            {"proposal": {"kind": "cancel_order"}, "executed_writes": ["cancel_my_order"]},
        ),
        (
            ev.guardrail_correct,
            "guardrail",
            {"blocked": True},
            {"blocked": True},
            {"blocked": False},
        ),
        (ev.no_pii_leak, "guardrail", {"answer": "Hola"}, {}, {"answer": "correo@ejemplo.invalid"}),
        (
            ev.no_invented_price,
            "guardrail",
            {"answer": "Cuesta S/ 12.90", "tool_context": [PRODUCT]},
            {},
            {"answer": "Cuesta S/ 999.00", "tool_context": [PRODUCT]},
        ),
    ],
)
def test_evaluator_positive_negative(evaluator, kind, outputs, expected, bad):
    inputs = {"id": "case_test", "kind": kind, "input": "correo@ejemplo.invalid"}
    assert evaluator(inputs, outputs, expected)["score"] == 1.0
    result = evaluator(inputs, bad, expected)
    assert result["score"] == 0.0
    assert result["comment"] == "case_test"
    if evaluator is not ev.no_pii_leak:
        assert evaluator({**inputs, "kind": "other"}, bad, expected)["score"] is None


@pytest.mark.parametrize("text", ["[correo]", "999 123 456", "12345678", "4111 1111 1111 1111"])
def test_no_pii_uses_existing_detector(text):
    assert ev.no_pii_leak({"id": "pii"}, {"answer": text}, {})["score"] == 0


def test_tool_requires_accepted_and_no_forbidden():
    ref = {"tools_any": ["get_product"], "forbidden_tools": ["cancel_my_order"]}
    result = ev.tool_selected(
        {"id": "tools", "kind": "tools"},
        {"tools_called": ["get_product", "cancel_my_order"]},
        ref,
    )
    assert result["score"] == 0


def test_price_evidence_nested_totals_and_no_context():
    inputs = {"id": "prices", "kind": "tools"}
    assert (
        ev.no_invented_price(
            inputs,
            {
                "answer": "S/ 25.80",
                "tool_context": [{"products": [PRODUCT]}],
            },
            {},
        )["score"]
        == 1
    )
    assert ev.no_invented_price(inputs, {"answer": "S/ 25.80"}, {})["score"] == 0
    assert ev.no_invented_price(inputs, {"answer": "No tengo ese dato"}, {})["score"] == 1


def test_proposal_must_exist_and_match():
    inputs = {"id": "proposal", "kind": "proposal"}
    ref = {"proposal_kind": "cancel_order", "executed": False}
    for proposal in (None, {"kind": "add_to_cart"}):
        assert (
            ev.proposal_not_executed(
                inputs,
                {
                    "proposal": proposal,
                    "executed_writes": [],
                },
                ref,
            )["score"]
            == 0
        )


@pytest.mark.parametrize("case_id", ["cart_first", "cancel_explicit"])
def test_real_graph_stops_at_interrupt(monkeypatch, case_id):
    from agent_service import graph as module
    from agent_service.agents import specialist

    proposals = []
    original = specialist.interrupt

    def observe(proposal):
        proposals.append(proposal)
        return original(proposal)

    monkeypatch.setattr(specialist, "interrupt", observe)
    case = next(case for case in load_cases() if case["id"] == case_id)

    async def run():
        with offline_environment():
            async with evaluation_runtime("offline"):
                return await run_case(example_payload(case)["inputs"])

    output = asyncio.run(run())
    assert len(proposals) == 1
    assert output["proposal"]["kind"] == case["expected"]["proposal_kind"]
    assert output["executed_writes"] == []
    assert output["tool_context"]
    assert ("get_product" if case_id == "cart_first" else "get_my_order") in output["tools_called"]
    assert output["answer"] == ""
    assert module.graph.checkpointer is None


def test_concurrent_cases_do_not_share_observations():
    cases = [
        next(case for case in load_cases() if case["id"] == name)
        for name in ("product_detail", "my_orders")
    ]

    async def run():
        with offline_environment():
            async with evaluation_runtime("offline"):
                return await asyncio.gather(
                    *(run_case(example_payload(c)["inputs"]) for c in cases)
                )

    shopping, sale = asyncio.run(run())
    assert shopping["tools_called"] == ["get_product"]
    assert sale["tools_called"] == ["list_my_orders"]
    assert shopping["agent"] == "shopping" and sale["agent"] == "post_sale"
    assert shopping["tool_context"] != sale["tool_context"]


class DatasetClient:
    def __init__(self):
        self.exists = False
        self.examples = {}
        self.mutations = []
        self.tags = []

    def read_dataset(self, **kwargs):
        from langsmith.utils import LangSmithNotFoundError

        if not self.exists:
            raise LangSmithNotFoundError("missing")
        return SimpleNamespace(id="dataset")

    def create_dataset(self, **kwargs):
        self.exists = True
        return self.read_dataset()

    def list_examples(self, **kwargs):
        return list(self.examples.values())

    def create_examples(self, *, examples, **kwargs):
        for payload in examples:
            self.update_example(str(uuid4()), **payload)

    def update_example(self, example_id, *, inputs, outputs, metadata, split):
        self.mutations.append(example_id)
        self.examples[example_id] = SimpleNamespace(
            id=example_id,
            inputs=copy.deepcopy(inputs),
            outputs=copy.deepcopy(outputs),
            metadata={**metadata, "dataset_split": [split]},
        )

    def delete_example(self, example_id):
        self.mutations.append(example_id)
        del self.examples[example_id]

    def read_dataset_version(self, *, dataset_id=None, tag):
        assert tag == "latest"
        return SimpleNamespace(as_of=datetime(2026, 10, 13, tzinfo=UTC))

    def update_dataset_tag(self, **kwargs):
        self.tags.append(kwargs)


def test_sync_create_idempotent_update_delete_and_tag():
    cases = load_cases()[:3]
    client = DatasetClient()
    assert sync_dataset(client, cases, "v1") == dict(created=3, updated=0, deleted=0)
    client.mutations.clear()
    assert sync_dataset(client, cases, "v1") == dict(created=0, updated=0, deleted=0)
    assert not client.mutations
    changed = copy.deepcopy(cases[:2])
    changed[0]["expected"]["in_domain"] = False
    changed[1]["split"] = "new-split"
    assert sync_dataset(client, changed) == dict(created=0, updated=2, deleted=1)
    assert client.tags[0]["as_of"] == client.read_dataset_version(tag="latest").as_of
    assert client.tags[0]["tag"] == "v1"
    changed[0]["metadata"]["note"] = "updated"
    assert sync_dataset(client, changed) == dict(created=0, updated=1, deleted=0)


def test_dataset_covers_kinds_and_reuses_domain_source():
    cases = load_cases()
    assert 36 <= len(cases) <= 40
    assert {c["metadata"]["kind"] for c in cases} == {
        "domain",
        "routing",
        "tools",
        "proposal",
        "guardrail",
    }
    source = {
        c["id"]: c
        for c in map(json.loads, (ROOT / "evals/domain_cases.jsonl").read_text().splitlines())
    }
    for case in cases:
        if case["metadata"]["kind"] == "domain":
            assert case["input"] == source[case["id"]]["input"]
            assert case["history"] == source[case["id"]]["history"]
    with pytest.raises(ValueError, match="split"):
        load_cases(split="absent")


def test_offline_no_client_no_network_even_with_keys(monkeypatch, capsys):
    import langsmith
    import langsmith.client
    import langsmith.run_helpers

    def forbidden(*args, **kwargs):
        pytest.fail("Offline no puede construir clientes ni acceder a red")

    monkeypatch.setattr(langsmith.Client, "__init__", forbidden)
    monkeypatch.setattr(langsmith, "Client", forbidden)
    monkeypatch.setattr(langsmith.client, "Client", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    for name in ("LANGSMITH_API_KEY", "OPENAI_API_KEY", "CLOUDFLARE_API_TOKEN"):
        monkeypatch.setenv(name, "secret-not-for-output")
    assert main(["--mode", "offline"]) == 0
    captured = capsys.readouterr()
    assert "secret-not-for-output" not in captured.out + captured.err
    assert "ignora credenciales" in captured.err
    summary = json.loads(captured.out)
    assert summary["cases"] == 38
    assert len(summary["by_kind"]) == 5
    assert summary["errors"] == []
    assert os.environ["OPENAI_API_KEY"] == "secret-not-for-output"


@pytest.mark.parametrize("impossible", [False, True])
def test_cli_exit_thresholds(tmp_path, impossible):
    thresholds = json.loads((ROOT / "evals/thresholds.json").read_text())
    if impossible:
        thresholds["offline"]["domain_correct"] = 1.1
    path = tmp_path / "thresholds.json"
    path.write_text(json.dumps(thresholds))
    result = subprocess.run(
        [sys.executable, "scripts/eval_agent.py", "--mode", "offline", "--thresholds", str(path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == int(impossible), result.stderr
    summary = json.loads(result.stdout)
    assert bool(summary["below_threshold"]) == impossible


def test_missing_keys_no_client(monkeypatch, capsys):
    for name in ("LANGSMITH_API_KEY", "OPENAI_API_KEY", "CLOUDFLARE_ACCOUNT_ID"):
        monkeypatch.delenv(name, raising=False)
    assert main(["--mode", "langsmith"]) == 1
    stderr = capsys.readouterr().err
    assert all(
        key in stderr
        for key in (
            "LANGSMITH_API_KEY",
            "OPENAI_API_KEY",
            "CLOUDFLARE_ACCOUNT_ID",
        )
    )


def test_langsmith_thresholds_are_informational():
    rows = [({"id": "domain", "kind": "domain"}, [{"key": "domain_correct", "score": 0}], False)]
    summary = summarize(rows, {"domain_correct": 0.95}, "langsmith")
    assert summary["below_threshold"] == ["domain_correct"]
    assert summary["thresholds_blocking"] is False


def test_judges_without_key_are_omitted(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert ev.llm_evaluators() == []


def install_fake_judges(monkeypatch, factory):
    import types

    package = types.ModuleType("openevals")
    llm = types.ModuleType("openevals.llm")
    prompts = types.ModuleType("openevals.prompts")
    llm.create_async_llm_as_judge = factory
    prompts.RAG_GROUNDEDNESS_PROMPT = "grounded {context} {outputs}"
    prompts.RAG_HELPFULNESS_PROMPT = "helpful {inputs} {outputs}"
    monkeypatch.setitem(sys.modules, "openevals", package)
    monkeypatch.setitem(sys.modules, "openevals.llm", llm)
    monkeypatch.setitem(sys.modules, "openevals.prompts", prompts)


@pytest.mark.parametrize("fails", [False, True])
def test_judges_explicit_keys_context_and_safe_comments(monkeypatch, fails):
    created, invoked = [], []

    def factory(**kwargs):
        created.append(kwargs)

        async def judge(**payload):
            invoked.append(payload)
            if fails:
                raise RuntimeError("secret-do-not-log")
            return {"score": True, "comment": "secret-do-not-log"}

        return judge

    monkeypatch.setenv("OPENAI_API_KEY", "local-fake")
    monkeypatch.setenv("AGENT_EVAL_JUDGE_MODEL", "demo-judge")
    install_fake_judges(monkeypatch, factory)
    judges = ev.llm_evaluators()

    async def run():
        return [
            await judge(
                {"id": "case_id", "input": "consulta"},
                {
                    "answer": "",
                    "proposal": {
                        "kind": "add_to_cart",
                        "action_id": "technical-id",
                        "product_id": PID,
                        "title": PRODUCT["title"],
                        "unit_price_pen": PRODUCT["price_pen"],
                        "quantity": 2,
                    },
                    "tool_context": [PRODUCT],
                },
                {},
            )
            for judge in judges
        ]

    results = asyncio.run(run())
    assert {item["feedback_key"] for item in created} == {"groundedness", "helpfulness"}
    assert all(item["model"] == "openai:demo-judge" for item in created)
    assert all(item["use_reasoning"] is False for item in created)
    assert all(item["comment"] == "case_id" for item in results)
    assert all(item["score"] == (None if fails else 1) for item in results)
    assert all(json.loads(item["context"]) == [PRODUCT] for item in invoked)
    assert json.loads(invoked[0]["outputs"])["title"] == PRODUCT["title"]
    assert "quantity" not in json.loads(invoked[0]["outputs"])
    assert json.loads(invoked[1]["outputs"])["kind"] == "add_to_cart"
    assert json.loads(invoked[1]["outputs"])["quantity"] == 2
    assert all("action_id" not in json.loads(item["outputs"]) for item in invoked)
    assert "secret-do-not-log" not in json.dumps(results)


def test_langsmith_runner_wiring_without_network(monkeypatch, capsys, buyer_jwt):
    import langsmith
    from langsmith.evaluation.evaluator import EvaluationResult

    from agent_service.evals import target
    from agent_service.evals.runner import require_local_environment

    observed = {}
    for name in (
        "LANGSMITH_API_KEY",
        "OPENAI_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "MCP_INTERNAL_TOKEN",
        "AGENT_EVAL_BUYER_JWT",
        "AGENT_EVAL_PRODUCT_ID",
        "AGENT_EVAL_ORDER_ID",
    ):
        monkeypatch.setenv(name, PID)
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")
    monkeypatch.setenv("AGENT_CLASSIFIER_PROVIDER", "rules")
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("AGENT_MODEL", "demo-model")
    monkeypatch.setenv("AGENT_EVAL_BUYER_JWT", buyer_jwt)
    require_local_environment()

    class Client:
        def __init__(self, **kwargs):
            observed["anonymizer"] = kwargs["anonymizer"]

        def close(self):
            observed["closed"] = True

        def list_examples(self, **kwargs):
            observed["data_args"] = kwargs
            return [SimpleNamespace(inputs={"id": "sample", "kind": "domain"})]

    class Results:
        url = "https://example.invalid/experiment"

        def __aiter__(self):
            async def rows():
                yield {
                    "example": SimpleNamespace(inputs={"id": "sample", "kind": "domain"}),
                    "run": SimpleNamespace(error=None),
                    "evaluation_results": {
                        "results": [
                            EvaluationResult(
                                key="domain_correct",
                                score=0,
                                comment="sample",
                            )
                        ]
                    },
                }

            return rows()

    async def aevaluate(fn, **kwargs):
        observed.update(kwargs)
        assert fn is target.run_case
        assert os.environ["AGENT_MODEL_PROVIDER"] == "openai"
        assert os.environ["AGENT_CLASSIFIER_PROVIDER"] == "clef"
        return Results()

    from contextlib import asynccontextmanager, nullcontext

    @asynccontextmanager
    async def runtime(mode):
        observed["mode"] = mode
        yield

    monkeypatch.setattr(langsmith, "Client", Client)
    monkeypatch.setattr(langsmith, "aevaluate", aevaluate)
    monkeypatch.setattr(langsmith, "tracing_context", lambda **kwargs: nullcontext())
    monkeypatch.setattr(target, "evaluation_runtime", runtime)
    install_fake_judges(monkeypatch, lambda **kwargs: None)
    assert (
        main(
            [
                "--mode",
                "langsmith",
                "--no-sync",
                "--dataset-tag",
                "v1",
                "--split",
                "regression",
                "--experiment-prefix",
                "base",
            ]
        )
        == 0
    )
    assert observed["data_args"]["as_of"] == "v1"
    assert observed["data_args"]["splits"] == ["regression"]
    assert observed["experiment_prefix"] == "base"
    assert observed["max_concurrency"] == 2
    assert observed["disable_evaluator_tracing"] is True
    assert observed["closed"] is True
    metadata = observed["metadata"]
    assert metadata["models"] == ["demo-model"] and metadata["classifier"] == "clef"
    assert len(metadata["git_sha"]) == 40 and len(metadata["prompt_hash"]) == 64
    assert len(metadata["evaluation_hash"]) == 64
    assert {fn.__name__ for fn in observed["evaluators"]} >= {"groundedness", "helpfulness"}
    output = json.loads(capsys.readouterr().out)
    assert output["experiment_url"] == Results.url
    assert output["below_threshold"] == ["domain_correct"]


def test_fresh_offline_process_cannot_create_client_or_connect():
    code = """
import socket
import langsmith

def forbidden(*args, **kwargs):
    raise AssertionError("Acceso externo prohibido")

langsmith.Client.__init__ = forbidden
socket.socket.connect = forbidden
socket.create_connection = forbidden
from agent_service.evals.runner import main
raise SystemExit(main(["--mode", "offline"]))
"""
    env = {
        **os.environ,
        "LANGSMITH_TRACING": "true",
        "LANGCHAIN_TRACING_V2": "true",
        "LANGSMITH_API_KEY": "secret-not-for-output",
        "OPENAI_API_KEY": "secret-not-for-output",
        "CLOUDFLARE_API_TOKEN": "secret-not-for-output",
    }
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "secret-not-for-output" not in result.stdout + result.stderr
    assert json.loads(result.stdout)["cases"] == 38


@pytest.mark.parametrize("fails", [False, True])
def test_sync_script_real_sdk_client_is_closed(monkeypatch, capsys, fails):
    import importlib.util

    from langsmith import Client

    path = ROOT / "scripts/sync_agent_dataset.py"
    spec = importlib.util.spec_from_file_location("sync_agent_dataset", path)
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    monkeypatch.setenv("LANGSMITH_API_KEY", "fake-local-key")
    closed = []
    original_close = Client.close

    def close(client):
        closed.append(client)
        original_close(client)

    def sync(client, cases, tag):
        assert isinstance(client, Client)
        assert len(cases) == 38
        assert tag == "v1"
        if fails:
            raise RuntimeError("sensitive-do-not-log")
        return dict(created=0, updated=0, deleted=0)

    monkeypatch.setattr(Client, "close", close)
    monkeypatch.setattr(script, "sync_dataset", sync)
    assert script.main(["--tag", "v1"]) == int(fails)
    assert len(closed) == 1
    captured = capsys.readouterr()
    if fails:
        assert "RuntimeError" in captured.err
        assert "sensitive-do-not-log" not in captured.out + captured.err
    else:
        assert json.loads(captured.out) == dict(created=0, updated=0, deleted=0)


@pytest.mark.parametrize("case_id", ["cart_first", "cancel_followup"])
def test_proposal_history_reaches_real_model_window(monkeypatch, case_id):
    from langchain_core.messages import AIMessage

    from agent_service import model

    case = next(case for case in load_cases() if case["id"] == case_id)
    inputs = example_payload(case)["inputs"]
    inputs.pop("scripted")
    seen = []
    tool_name = "propose_add_to_cart" if case_id == "cart_first" else "propose_cancel_order"
    args = {"product_id": PID, "quantity": 2} if case_id == "cart_first" else {"order_id": PID}

    class Model:
        def bind_tools(self, tools):
            assert tool_name in {tool.name for tool in tools}
            return self

        async def ainvoke(self, messages, config):
            seen.extend(messages)
            return AIMessage("", tool_calls=[dict(id="proposal", name=tool_name, args=args)])

    monkeypatch.setattr(model, "create_model", Model)

    async def run():
        with offline_environment():
            monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
            monkeypatch.setenv("OPENAI_API_KEY", "fake-local-key")
            async with evaluation_runtime("offline"):
                return await run_case(inputs)

    output = asyncio.run(run())
    assert any(message.type == "ai" and PID in message.text for message in seen)
    assert any(
        message.type == "human"
        and message.text
        == case["history"][0]["text"].replace(
            "{order_id}",
            PID,
        )
        for message in seen
    )
    assert output["proposal"]["kind"] == case["expected"]["proposal_kind"]
    assert output["executed_writes"] == []


def test_stock_reference_accepts_equivalent_reads_and_rejects_writes():
    case = next(case for case in load_cases() if case["id"] == "product_stock")
    payload = example_payload(case)
    for name in ("check_stock", "get_product"):
        output = {"tools_called": [name]}
        assert ev.tool_selected(payload["inputs"], output, payload["outputs"])["score"] == 1
        output["tools_called"].append("cancel_my_order")
        assert ev.tool_selected(payload["inputs"], output, payload["outputs"])["score"] == 0


@pytest.mark.parametrize(
    "blocked,context,groundedness,helpfulness",
    [
        (True, [PRODUCT], None, None),
        (False, [], None, 1),
        (False, [{}], None, 1),
        (False, [{"orders": []}], 1, 1),
        (False, [PRODUCT], 1, 1),
    ],
)
def test_judges_skip_without_calls(monkeypatch, blocked, context, groundedness, helpfulness):
    calls = []

    def factory(**kwargs):
        async def judge(**payload):
            calls.append(kwargs["feedback_key"])
            return {"score": True}

        return judge

    install_fake_judges(monkeypatch, factory)
    monkeypatch.setenv("OPENAI_API_KEY", "fake-local")
    judges = ev.llm_evaluators()
    outputs = {"blocked": blocked, "tool_context": context, "answer": "Respuesta ficticia"}

    async def run():
        return [
            await judge({"id": "skip_test", "input": "consulta"}, outputs, {}) for judge in judges
        ]

    feedbacks = asyncio.run(run())
    assert [item["score"] for item in feedbacks] == [groundedness, helpfulness]
    assert len(calls) == sum(score is not None for score in (groundedness, helpfulness))
    assert all(item["comment"] == "skip_test" for item in feedbacks)


def test_judges_receive_bound_history_and_safe_input(monkeypatch):
    monkeypatch.setenv("AGENT_EVAL_PRODUCT_ID", PID)
    payload = ev.judge_payload(
        "helpfulness",
        {
            "id": "followup",
            "input": "agrega el producto {product_id}",
            "history": [
                {"type": "human", "text": "Mi correo es ficticio@example.invalid"},
                {"type": "ai", "text": "El producto es {product_id}"},
            ],
        },
        {"answer": "Consulta realizada", "tool_context": []},
    )
    assert payload["inputs"]["input"] == f"agrega el producto {PID}"
    assert payload["inputs"]["history"][1]["text"] == f"El producto es {PID}"
    assert "ficticio@example.invalid" not in json.dumps(payload)


def test_groundedness_cancel_uses_only_retrieved_facts():
    proposal = {
        "kind": "cancel_order",
        "action_id": "technical-id",
        "order_id": PID,
        "status": "pending",
        "total_pen": "25.80",
        "items_count": 2,
        "created_at": "2026-10-12T10:00:00Z",
    }
    payload = ev.judge_payload(
        "groundedness",
        {"input": "cancela mi pedido"},
        {
            "proposal": proposal,
            "tool_context": [{"order_id": PID, "status": "pending"}],
        },
    )
    facts = json.loads(payload["outputs"])
    assert facts == {
        key: value
        for key, value in proposal.items()
        if key
        not in {
            "action_id",
            "kind",
        }
    }


def test_summary_reports_skips_without_hiding_errors():
    inputs = {"id": "example", "kind": "guardrail"}
    rows = [
        (
            inputs,
            [
                {"key": "groundedness", "score": None},
                {"key": "helpfulness", "score": None, "extra": {"error": True}},
            ],
            False,
        )
    ]
    result = summarize(rows, {}, "langsmith")
    assert result["skipped"] == {"groundedness": 1}
    assert result["errors"] == ["example"]
    assert result["evaluators"] == {}


@pytest.mark.parametrize(
    "claims,valid",
    [
        ({"exp": 1000}, False),
        ({"exp": 999}, False),
        ({"exp": 1001}, True),
        ({}, False),
        ({"exp": "tomorrow"}, False),
        ({"exp": True}, False),
    ],
)
def test_jwt_expiration_preflight(monkeypatch, claims, valid):
    from agent_service.evals import auth

    token = jwt.encode(claims, "eval-signing-key-for-tests-only-0000000000", algorithm="HS256")
    monkeypatch.setenv("AGENT_EVAL_BUYER_JWT", token)
    monkeypatch.setattr(auth.time, "time", lambda: 1000)
    if valid:
        auth.validate_buyer_jwt()
    else:
        with pytest.raises(auth.EvaluationConfigError) as raised:
            auth.validate_buyer_jwt()
        assert token not in str(raised.value)


@pytest.mark.parametrize(
    "token", ["invalid", '{"token":"not-a-token"}', "e30.e30.bad*", "a.b.c", "expired"]
)
def test_invalid_or_expired_jwt_stops_before_client(monkeypatch, capsys, token):
    import langsmith

    if token == "expired":
        token = jwt.encode(
            {"exp": 0}, "eval-signing-key-for-tests-only-0000000000", algorithm="HS256"
        )

    for name in (
        "LANGSMITH_API_KEY",
        "OPENAI_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "MCP_INTERNAL_TOKEN",
        "AGENT_EVAL_PRODUCT_ID",
        "AGENT_EVAL_ORDER_ID",
    ):
        monkeypatch.setenv(name, "fake-local")
    monkeypatch.setenv("AGENT_EVAL_BUYER_JWT", token)
    monkeypatch.setattr(langsmith, "Client", lambda **kwargs: pytest.fail("No crear cliente"))
    assert main(["--mode", "langsmith"]) == 1
    captured = capsys.readouterr()
    assert "AGENT_EVAL_BUYER_JWT" in captured.err
    assert token not in captured.err


def test_jwt_expiring_between_cases_stops_before_model(monkeypatch, buyer_jwt):
    from agent_service.agents import specialist
    from agent_service.evals import auth, target

    monkeypatch.setenv("AGENT_EVAL_BUYER_JWT", buyer_jwt)
    auth.validate_buyer_jwt()
    expired_time = time.time() + 600
    monkeypatch.setattr(auth.time, "time", lambda: expired_time)

    async def never_model(*args, **kwargs):
        pytest.fail("No llamar al modelo con JWT vencido")

    monkeypatch.setattr(specialist, "reply", never_model)

    async def run():
        token = target._mode.set("langsmith")
        try:
            with pytest.raises(auth.EvaluationConfigError, match="vencido"):
                await run_case({"id": "expired", "input": "cancela mi pedido"})
        finally:
            target._mode.reset(token)

    asyncio.run(run())
