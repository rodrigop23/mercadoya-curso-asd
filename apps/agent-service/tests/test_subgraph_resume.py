from typing import TypedDict

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


@pytest.mark.parametrize("wrapped", [False, True])
def test_resume(wrapped):
    class State(TypedDict):
        approved: bool

    calls = []

    def before(state):
        calls.append("route")
        return {}

    def assistant(state):
        calls.append("assistant")
        return {}

    def confirm(state):
        calls.append("confirm")
        return {"approved": interrupt({"action_id": "stable"})}

    child = StateGraph(State)
    child.add_node("assistant", assistant)
    child.add_node("confirm", confirm)
    child.add_edge(START, "assistant")
    child.add_edge("assistant", "confirm")
    child.add_edge("confirm", END)
    compiled = child.compile(name="shopping").with_config(tags=["agent:shopping"])

    def wrapper(state):
        calls.append("wrapper")
        return compiled.invoke(state)

    parent = StateGraph(State)
    parent.add_node("route", before)
    parent.add_node("shopping", wrapper if wrapped else compiled)
    parent.add_edge(START, "route")
    parent.add_edge("route", "shopping")
    parent.add_edge("shopping", END)
    graph = parent.compile(checkpointer=InMemorySaver())
    cfg = {"configurable": {"thread_id": "test"}}
    first = graph.invoke({"approved": False}, cfg)
    intr = first["__interrupt__"][0]
    snapshot = graph.get_state(cfg, subgraphs=True)
    assert snapshot.next == ("shopping",)
    if not wrapped:
        assert snapshot.tasks[0].state.next == ("confirm",)
    final = graph.invoke(Command(resume={intr.id: True}), cfg)
    assert final["approved"]
    assert calls == (
        ["route", "wrapper", "assistant", "confirm", "wrapper", "confirm"]
        if wrapped
        else ["route", "assistant", "confirm", "confirm"]
    )
