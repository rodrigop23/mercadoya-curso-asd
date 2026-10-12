"""Fábrica perezosa: importar el grafo no construye clientes ni requiere claves."""

import json
import os
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from agent_service.config import settings

MISSING_KEY_MESSAGE = (
    "El asistente aún no está configurado para responder. "
    "Falta la clave de OpenAI en el servidor. Puedes seguir comprando desde el catálogo."
)


def create_model():
    from langchain_openai import ChatOpenAI

    cfg = settings()
    return ChatOpenAI(
        model=cfg.model,
        use_responses_api=True,
        reasoning={"effort": cfg.reasoning_effort},
    )


async def reply(messages: list[BaseMessage], config: RunnableConfig, tools=None) -> AIMessage:
    provider = settings().model_provider
    if provider == "scripted":
        last = messages[-1]
        if isinstance(last, ToolMessage):
            return AIMessage(content=f"resultado: {last.text}")
        if last.type == "human" and last.text.startswith("/tool ") and tools:
            try:
                _, name, raw = last.text.split(" ", 2)
                args = json.loads(raw)
                if not isinstance(args, dict) or name not in {tool.name for tool in tools}:
                    raise ValueError
            except (ValueError, TypeError):
                return AIMessage(content="Solicitud de herramienta inválida")
            return AIMessage(
                content="",
                tool_calls=[{"id": str(uuid4()), "name": name, "args": args, "type": "tool_call"}],
            )
    if provider in {"echo", "scripted"}:
        human = next((message for message in reversed(messages) if message.type == "human"), None)
        return AIMessage(content=f"eco: {human.text if human else ''}")
    if provider != "openai":
        raise ValueError("AGENT_MODEL_PROVIDER debe ser openai, echo o scripted")
    if not os.getenv("OPENAI_API_KEY"):
        return AIMessage(content=MISSING_KEY_MESSAGE)
    # No pasar configurable al cliente: auth_user contiene la credencial del request.
    # callbacks conserva streaming/trazas sin enviar ese token al modelo.
    model_config: RunnableConfig = {"callbacks": config.get("callbacks")}
    model = create_model()
    if tools:
        model = model.bind_tools(tools)
    return await model.ainvoke(messages, config=model_config)
