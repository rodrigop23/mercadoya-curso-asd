import asyncio
from types import SimpleNamespace

import pytest
from langgraph_sdk import Auth

from agent_service import resume


@pytest.mark.parametrize(
    "status,ids,requested,accepted",
    [
        ("interrupted", ["current"], "current", True),
        ("idle", [], "current", False),
        ("interrupted", ["new"], "old", False),
        ("busy", ["current"], "current", False),
        ("interrupted", ["a", "b"], "a", False),
    ],
)
def test_resume_requires_current_single_interrupt(monkeypatch, status, ids, requested, accepted):
    closed = []

    async def get(tid):
        assert tid == "thread"
        return dict(status=status, interrupts={"task": [dict(id=id) for id in ids]})

    async def close():
        closed.append(True)

    def client(**kwargs):
        assert kwargs == dict(api_key=None, headers={"Authorization": "Bearer fresh"})
        return SimpleNamespace(threads=SimpleNamespace(get=get), aclose=close)

    monkeypatch.setattr(resume, "get_client", client)
    value = dict(
        thread_id="thread",
        kwargs=dict(
            command={"resume": {requested: dict(approved=True)}},
            config={"configurable": {"langgraph_auth_user": {"token": "fresh"}}},
        ),
    )
    if accepted:
        asyncio.run(resume.validate_pending_resume(value))
    else:
        with pytest.raises(Auth.exceptions.HTTPException) as error:
            asyncio.run(resume.validate_pending_resume(value))
        assert error.value.status_code == 409
        assert str(error.value.detail) == resume.ALREADY_RESPONDED
    assert closed == [True]


def test_resume_blocks_historical_checkpoint(monkeypatch):
    def never_client(**kwargs):
        raise AssertionError("No debe abrir un cliente para replay histórico")

    monkeypatch.setattr(resume, "get_client", never_client)
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        asyncio.run(
            resume.validate_pending_resume(
                dict(
                    kwargs=dict(
                        command={"resume": True}, config={"configurable": {"checkpoint_id": "old"}}
                    )
                )
            )
        )
    assert error.value.status_code == 409
