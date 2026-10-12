"""Conversación base, sin herramientas, interrupts ni checkpointer propio.

Las futuras acciones leerán config["configurable"]["langgraph_auth_user"]["token"]
dentro del nodo de confirmación y DESPUÉS de interrupt(). Al reanudar, ese nodo
se vuelve a ejecutar con la identidad del request nuevo; los nodos anteriores no.
Nunca guardar el token en state, metadata o logs. Este grafo todavía no lo lee.
El Agent Server proporciona el checkpointer y la persistencia del historial.
"""

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph

from agent_service.model import reply
from agent_service.prompts import SYSTEM_PROMPT


async def assistant(state: MessagesState, config: RunnableConfig) -> dict:
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    return {"messages": [await reply(messages, config)]}


builder = StateGraph(MessagesState)
builder.add_node("assistant", assistant)
builder.add_edge(START, "assistant")
builder.add_edge("assistant", END)
graph = builder.compile()
