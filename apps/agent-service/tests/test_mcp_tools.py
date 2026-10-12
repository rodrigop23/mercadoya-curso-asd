import asyncio
import json
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tracers.base import BaseTracer
from langchain_mcp_adapters.interceptors import MCPToolCallRequest
from langchain_mcp_adapters.tools import convert_mcp_tool_to_langchain_tool
from mcp.types import CallToolResult, TextContent, Tool

from agent_service import graph as graph_module
from agent_service import mcp_tools, model


def test_interceptor_current_token_no_runtime_and_public():
    seen = []

    async def handler(request):
        seen.append(request)
        return "ok"

    async def run():
        for token in ("token-a", "token-b"):
            runtime = SimpleNamespace(
                config={"configurable": {"langgraph_auth_user": {"token": token}}}
            )
            request = MCPToolCallRequest("list_my_orders", {}, "mercadoya", runtime=runtime)
            await mcp_tools.forward_user_jwt(request, handler)
            assert request.headers is None
        await mcp_tools.forward_user_jwt(
            MCPToolCallRequest("list_my_orders", {}, "mercadoya"), handler
        )
        await mcp_tools.forward_user_jwt(
            MCPToolCallRequest("search_products", {}, "mercadoya", runtime=runtime), handler
        )

    asyncio.run(run())
    assert [r.headers for r in seen] == [
        {"Authorization": "Bearer token-a"},
        {"Authorization": "Bearer token-b"},
        None,
        None,
    ]


class CaptureTracer(BaseTracer):
    def __init__(self):
        super().__init__()
        self.runs = []

    def _persist_run(self, run):
        self.runs.append(run.model_dump())


def test_tool_runtime_per_run_and_traces_without_jwt(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")
    tokens = ["secret-buyer-a", "secret-buyer-b"]
    seen = []
    tracer = CaptureTracer()

    async def observe(request, handler):
        assert request.runtime is not None
        assert request.args == {}

        async def fake_handler(forwarded):
            seen.append(forwarded.headers)
            return CallToolResult(
                content=[TextContent(type="text", text="pedidos propios")],
                structuredContent={"orders": []},
            )

        return await mcp_tools.forward_user_jwt(request, fake_handler)

    tool = convert_mcp_tool_to_langchain_tool(
        None,
        Tool(
            name="list_my_orders",
            description="Pedidos propios",
            inputSchema={"type": "object", "properties": {}},
        ),
        connection={"transport": "streamable_http", "url": "http://unused/mcp"},
        tool_interceptors=[observe],
        server_name="mercadoya",
    )

    async def fake_tools():
        return [tool]

    monkeypatch.setattr(graph_module, "get_tools", fake_tools)

    async def run():
        for token in tokens:
            result = await graph_module.graph.ainvoke(
                {"messages": [HumanMessage("/tool list_my_orders {}")]},
                config={
                    "configurable": {"langgraph_auth_user": {"token": token}},
                    "callbacks": [tracer],
                },
            )
            assert result["messages"][-1].content == "resultado: pedidos propios"
            assert isinstance(result["messages"][-2], ToolMessage)
            assert all(t not in json.dumps(result, default=str) for t in tokens)

    asyncio.run(run())
    assert seen == [{"Authorization": f"Bearer {t}"} for t in tokens]
    serialized = json.dumps(tracer.runs, default=str)
    assert all(t not in serialized for t in tokens)
    assert "Bearer" not in serialized


def test_lazy_cache_retries(monkeypatch):
    monkeypatch.setattr(mcp_tools, "_tools", None)
    monkeypatch.setattr(mcp_tools, "_lock", asyncio.Lock())
    count = 0

    class FakeClient:
        async def get_tools(self):
            nonlocal count
            count += 1
            if count == 1:
                raise RuntimeError("unavailable")
            return ["public-tool"]

    monkeypatch.setattr(mcp_tools, "client", FakeClient)

    async def run():
        assert await mcp_tools.get_tools() == []
        assert await mcp_tools.get_tools() == ["public-tool"]
        assert await mcp_tools.get_tools() == ["public-tool"]

    asyncio.run(run())
    assert count == 2


def test_unavailable_run_does_not_fail(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")

    async def unavailable():
        return []

    monkeypatch.setattr(graph_module, "get_tools", unavailable)
    result = asyncio.run(
        graph_module.graph.ainvoke({"messages": [HumanMessage("/tool search_products {}")]})
    )
    assert result["messages"][-1].content == graph_module.UNAVAILABLE_MESSAGE


def test_openai_without_tools_receives_unavailability_notice(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fake")
    received = []

    async def unavailable():
        return []

    class FakeModel:
        def bind_tools(self, tools):
            raise AssertionError("No debe enlazar herramientas cuando MCP no está disponible")

        async def ainvoke(self, messages, config):
            received.append(messages)
            return AIMessage(content="Hola, ¿en qué puedo ayudarte?")

    monkeypatch.setattr(graph_module, "get_tools", unavailable)
    monkeypatch.setattr(model, "create_model", FakeModel)
    result = asyncio.run(graph_module.graph.ainvoke({"messages": [HumanMessage("hola")]}))

    assert result["messages"][-1].content == "Hola, ¿en qué puedo ayudarte?"
    assert len(received) == 1
    assert any(message.type == "human" and message.text == "hola" for message in received[0])
    notice = received[0][-1]
    assert isinstance(notice, SystemMessage)
    assert "El catálogo y los pedidos no están disponibles ahora" in notice.text
    assert "no inventes" in notice.text


def test_six_iterations_per_turn(monkeypatch):
    from langchain_core.tools import tool

    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fake")
    calls = []

    @tool
    def search_products() -> str:
        """Catálogo de prueba."""
        calls.append(1)
        return "producto real"

    async def fake_tools():
        return [search_products]

    class LoopModel:
        bound = False

        def bind_tools(self, tools):
            self.bound = True
            return self

        async def ainvoke(self, messages, config):
            if self.bound:
                return AIMessage(
                    content="",
                    tool_calls=[{"id": str(len(calls)), "name": "search_products", "args": {}}],
                )
            return AIMessage(content="producto real, consultas agotadas")

    monkeypatch.setattr(graph_module, "get_tools", fake_tools)
    monkeypatch.setattr(model, "create_model", LoopModel)

    async def run():
        result = await graph_module.graph.ainvoke({"messages": [HumanMessage("buscar")]})
        assert len(calls) == 6
        assert "consultas agotadas" in result["messages"][-1].content
        await graph_module.graph.ainvoke({"messages": [*result["messages"], HumanMessage("otra")]})
        assert len(calls) == 12

    asyncio.run(run())


def test_scripted_echo_does_not_need_mcp(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "scripted")

    async def never_load():
        raise AssertionError("No debe abrir MCP para echo")

    monkeypatch.setattr(graph_module, "get_tools", never_load)
    result = asyncio.run(graph_module.graph.ainvoke({"messages": [HumanMessage("hola")]}))
    assert result["messages"][-1].content == "eco: hola"
