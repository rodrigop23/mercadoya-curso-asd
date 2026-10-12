"""Fábrica perezosa: importar el grafo no construye clientes ni requiere claves."""

import os

from langchain_core.messages import AIMessage, BaseMessage
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


async def reply(messages: list[BaseMessage], config: RunnableConfig) -> AIMessage:
    provider = settings().model_provider
    if provider == "echo":
        human = next((message for message in reversed(messages) if message.type == "human"), None)
        return AIMessage(content=f"eco: {human.text if human else ''}")
    if provider != "openai":
        raise ValueError("AGENT_MODEL_PROVIDER debe ser openai o echo")
    if not os.getenv("OPENAI_API_KEY"):
        return AIMessage(content=MISSING_KEY_MESSAGE)
    # No pasar configurable al cliente: auth_user contiene la credencial del request.
    # callbacks conserva streaming/trazas sin enviar ese token al modelo.
    model_config: RunnableConfig = {"callbacks": config.get("callbacks")}
    return await create_model().ainvoke(messages, config=model_config)
