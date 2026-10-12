"""Read-only tool loop; Agent Server owns persistence. No credentials in state."""

import os

from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from agent_service.mcp_tools import get_tools
from agent_service.model import reply
from agent_service.prompts import SYSTEM_PROMPT

MAX_TOOL_ITERATIONS = 6
UNAVAILABLE_MESSAGE = "El catálogo no está disponible ahora. Inténtalo de nuevo más tarde."


def tool_iterations(messages):
    count = 0
    for message in reversed(messages):
        if message.type == "human":
            break
        if isinstance(message, AIMessage) and message.tool_calls:
            count += 1
    return count


async def assistant(state: MessagesState, config: RunnableConfig) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    tools = []
    provider = os.getenv("AGENT_MODEL_PROVIDER", "openai")
    last = state["messages"][-1]
    scripted_tool = provider == "scripted" and (
        last.type != "human" or last.text.startswith("/tool ")
    )
    if scripted_tool or (provider == "openai" and os.getenv("OPENAI_API_KEY")):
        tools = await get_tools()
        if not tools:
            if scripted_tool:
                return {"messages": [AIMessage(content=UNAVAILABLE_MESSAGE)]}
            messages.append(
                SystemMessage(
                    content=(
                        "El catálogo y los pedidos no están disponibles ahora. "
                        "Puedes responder consultas generales, pero no inventes productos, "
                        "precios, stock ni datos de pedidos."
                    )
                )
            )
    exhausted = tool_iterations(state["messages"]) >= MAX_TOOL_ITERATIONS
    if exhausted:
        messages.append(
            SystemMessage(
                content=(
                    "Llegaste al límite de consultas de este turno. "
                    "Responde con los datos obtenidos."
                )
            )
        )
    return {"messages": [await reply(messages, config, tools if not exhausted else [])]}


def tool_failure(error: Exception) -> str:
    return "El servicio de consultas no está disponible ahora. Inténtalo de nuevo más tarde."


async def tools(state: MessagesState, config: RunnableConfig):
    return await ToolNode(await get_tools(), handle_tool_errors=tool_failure).ainvoke(state, config)


builder = StateGraph(MessagesState)
builder.add_node("assistant", assistant)
builder.add_node("tools", tools)
builder.add_edge(START, "assistant")
builder.add_conditional_edges("assistant", tools_condition, {"tools": "tools", "__end__": END})
builder.add_edge("tools", "assistant")
graph = builder.compile()
