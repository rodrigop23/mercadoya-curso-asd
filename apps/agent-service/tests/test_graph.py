import asyncio
import importlib
import json

from langchain_core.messages import AIMessage, HumanMessage

from agent_service import graph as graph_module
from agent_service import model


def test_echo(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "echo")
    result = asyncio.run(
        graph_module.graph.ainvoke({"messages": [HumanMessage("lista de compras")]})
    )
    assert result["messages"][-1].content == "eco: lista de compras"
    assert graph_module.graph.checkpointer is None


def test_openai_without_key_imports_and_replies(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    importlib.reload(graph_module)
    result = asyncio.run(graph_module.graph.ainvoke({"messages": [HumanMessage("hola")]}))
    assert result["messages"][-1].content == model.MISSING_KEY_MESSAGE


def test_model_receives_prompt_history_and_no_credentials(monkeypatch):
    monkeypatch.setenv("AGENT_MODEL_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    observed = {}

    async def fake_tools():
        from langchain_core.tools import tool

        @tool
        def get_product() -> str:
            """Producto de prueba."""
            return "producto"

        return [get_product]

    monkeypatch.setattr(graph_module, "get_tools", fake_tools)

    class FakeModel:
        def bind_tools(self, tools):
            observed["tools"] = tools
            return self

        async def ainvoke(self, messages, config):
            observed.update(messages=messages, config=config)
            return AIMessage(content="respuesta")

    monkeypatch.setattr(model, "create_model", FakeModel)
    result = asyncio.run(
        graph_module.graph.ainvoke(
            {"messages": [HumanMessage("hola"), AIMessage("saludo"), HumanMessage("ayuda")]},
            config={"configurable": {"langgraph_auth_user": {"token": "private-jwt"}}},
        )
    )
    assert observed["messages"][0].type == "system"
    assert [m.content for m in observed["messages"][1:]] == ["hola", "saludo", "ayuda"]
    assert "configurable" not in observed["config"]
    assert "private-jwt" not in json.dumps(result, default=str)


def test_model_env(monkeypatch):
    import langchain_openai

    monkeypatch.setenv("AGENT_MODEL", "configured-model")
    monkeypatch.setenv("AGENT_REASONING_EFFORT", "medium")
    monkeypatch.setattr(langchain_openai, "ChatOpenAI", lambda **kwargs: kwargs)
    assert model.create_model() == {
        "model": "configured-model",
        "use_responses_api": True,
        "reasoning": {"effort": "medium"},
    }
