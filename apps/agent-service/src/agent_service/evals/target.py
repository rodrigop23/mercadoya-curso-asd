"""Grafo real en proceso. El único ainvoke se detiene en el primer interrupt."""

import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from mcp.types import CallToolResult

from agent_service.config import settings
from agent_service.evals.auth import validate_buyer_jwt
from agent_service.evals.dataset import bind_text
from agent_service.evals.fakes import READ_NAMES, FakeMCP
from agent_service.guardrails.privacy import sanitize_trace


@dataclass
class Observation:
    tools: list = field(default_factory=list)
    context: list = field(default_factory=list)
    writes: list = field(default_factory=list)
    available: list = field(default_factory=list)


_observation = ContextVar("eval_observation")
_mode = ContextVar("eval_mode", default="offline")
_real_tools = ContextVar("eval_real_tools", default=None)


async def observe_mcp(request, handler):
    observation = _observation.get()
    observation.tools.append(request.name)
    # Ni una regresión futura puede mutar el comprador de demo desde este target.
    if request.name not in READ_NAMES:
        observation.writes.append(request.name)
        raise RuntimeError("Escritura MCP rechazada por la evaluación")
    result = await handler(request)
    if isinstance(result, CallToolResult):
        observation.context.append(sanitize_trace(result.structuredContent or {}))
    return result


async def case_tools():
    return _observation.get().available


@asynccontextmanager
async def evaluation_runtime(mode):
    """Instala una dependencia por proceso; ContextVar aísla los casos concurrentes."""
    from unittest.mock import patch

    from agent_service.agents import specialist
    from agent_service.mcp_tools import forward_user_jwt

    token = _mode.set(mode)
    real_token = None
    try:
        if mode == "langsmith":
            cfg = settings()
            client = MultiServerMCPClient(
                {
                    "mercadoya": {
                        "transport": "streamable_http",
                        "url": cfg.mcp_url,
                        "headers": {"X-MCP-Internal-Token": cfg.mcp_internal_token},
                        "timeout": 5,
                    }
                },
                tool_interceptors=[observe_mcp, forward_user_jwt],
                handle_tool_errors=True,
            )
            real_token = _real_tools.set(await client.get_tools())
        with patch.object(specialist, "get_tools", case_tools):
            yield
    finally:
        if real_token is not None:
            _real_tools.reset(real_token)
        _mode.reset(token)
        if mode == "langsmith":
            from agent_service.guardrails.domain_clef import close_client

            await close_client()


async def run_case(inputs) -> dict:
    from agent_service.graph import builder

    offline = _mode.get() == "offline"
    if not offline:
        validate_buyer_jwt()
    observation = Observation()
    observation.available = (
        FakeMCP(inputs.get("fixture", "default")).tools(observe_mcp)
        if offline
        else _real_tools.get()
    )
    token = _observation.set(observation)
    try:
        messages = [
            (HumanMessage if item["type"] == "human" else AIMessage)(bind_text(item["text"]))
            for item in inputs.get("history", [])
        ]
        start = len(messages)
        text = inputs.get("scripted", inputs["input"]) if offline else inputs["input"]
        messages.append(HumanMessage(bind_text(text)))
        state = {
            "messages": messages,
            "recent_confirmation": inputs.get("recent_confirmation", False),
        }
        for key in ("active_agent", "last_domain_in_domain"):
            if key in inputs:
                state[key] = inputs[key]
        graph = builder.compile(checkpointer=InMemorySaver(), store=InMemoryStore())
        result = await graph.ainvoke(
            state,
            {
                "configurable": {
                    "thread_id": str(uuid4()),
                    "langgraph_auth_user": {
                        "identity": "eval-demo-buyer",
                        "role": "user",
                        "token": "eval-fake" if offline else os.environ["AGENT_EVAL_BUYER_JWT"],
                    },
                },
                "tags": ["eval"],
                "metadata": {"case_id": inputs["id"]},
            },
        )
        interrupts = result.get("__interrupt__", [])
        proposal = interrupts[0].value if interrupts else None
        # En interrupt, los mensajes del especialista aún no llegan al padre.
        called = [
            call["name"]
            for message in result["messages"][start:]
            for call in getattr(message, "tool_calls", [])
        ]
        if proposal:
            called.append("propose_" + proposal["kind"])
        answer = next(
            (
                message.text
                for message in reversed(result["messages"][start:])
                if message.type == "ai" and not getattr(message, "tool_calls", [])
            ),
            "",
        )
        return {
            "in_domain": result.get("last_domain_in_domain"),
            "category": result.get("last_domain_category"),
            "agent": result.get("active_agent"),
            "route_reason": result.get("route_reason"),
            "tools_called": sorted(set(called + observation.tools)),
            "proposal": sanitize_trace(proposal),
            "executed_writes": observation.writes,
            "blocked": bool(result.get("input_blocked") or result.get("domain_blocked")),
            "answer": answer,
            "tool_context": observation.context,
        }
    finally:
        _observation.reset(token)
