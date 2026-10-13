import asyncio
import time
from types import SimpleNamespace

import jwt
import pytest
from langgraph_sdk import Auth

from agent_service.auth import add_owner, authenticate, jwks_client


def verify(token):
    return asyncio.run(authenticate({b"authorization": f"Bearer {token}".encode()}))


@pytest.mark.parametrize("role", ["user", "admin"])
def test_valid(identity, role):
    token = identity({"role": role})
    assert verify(token) == {"identity": "buyer-a", "role": role, "token": token}


@pytest.mark.parametrize("header", [None, "", "Basic demo", "Bearer false", b"Bearer false"])
def test_invalid_header(header):
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        asyncio.run(authenticate({"authorization": header}))
    assert error.value.status_code == 401


@pytest.mark.parametrize(
    "override",
    [
        {"iss": "another-issuer"},
        {"aud": "another-audience"},
        {"role": "guest"},
        {"sub": ""},
        {"sub": 12},
        {"role": None},
        {"iat": int(time.time()) - 301},
        {"iat": int(time.time()) + 60},
        {"exp": int(time.time()) - 1},
        {"iat": "123"},
        {"iat": True},
        {"exp": str(int(time.time()) + 300)},
        {"exp": 10**400},
    ],
)
def test_invalid_claims(identity, override):
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(identity(override))
    assert error.value.status_code == 401


@pytest.mark.parametrize("claim", ["sub", "iss", "aud", "iat", "exp"])
def test_required_claims(identity, claim):
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(identity(omit=[claim]))
    assert error.value.status_code == 401


def test_max_age_boundary_matches_jose(identity, monkeypatch):
    now = int(time.time())
    monkeypatch.setattr("agent_service.auth.time.time", lambda: now)
    assert verify(identity({"iat": now - 300}))["identity"] == "buyer-a"
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(identity({"iat": now - 300.01}))
    assert error.value.status_code == 401


def test_numeric_dates_match_jose(identity, monkeypatch):
    now = int(time.time())
    monkeypatch.setattr("agent_service.auth.time.time", lambda: now)
    assert verify(identity({"exp": now + 0.1}))["identity"] == "buyer-a"
    for claims in ({"exp": now}, {"nbf": now + 1}, {"nbf": str(now)}, {"exp": float("nan")}):
        with pytest.raises(Auth.exceptions.HTTPException) as error:
            verify(identity(claims))
        assert error.value.status_code == 401


@pytest.mark.parametrize("headers", [{}, {"kid": "unknown"}])
def test_invalid_kid(identity, headers):
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(identity(headers=headers))
    assert error.value.status_code == 401


def test_wrong_signature(identity):
    token = identity()
    head, payload, _signature = token.split(".")
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(f"{head}.{payload}.ZmFrZQ")
    assert error.value.status_code == 401


def test_only_rs256(identity):
    token = jwt.encode({"sub": "buyer-a"}, "fake-test-secret" * 3, headers={"kid": "test-key"})
    with pytest.raises(Auth.exceptions.HTTPException) as error:
        verify(token)
    assert error.value.status_code == 401


def test_jwks_unavailable_is_infrastructure_error(identity, monkeypatch):
    monkeypatch.setenv("JWKS_URL", "http://127.0.0.1:1/jwks")
    jwks_client.cache_clear()
    with pytest.raises(RuntimeError, match="JWKS"):
        verify(identity())


@pytest.mark.parametrize("value", [{}, {"metadata": None}, {"metadata": {"owner": "buyer-b"}}])
def test_owner_overwrites_client(value):
    ctx = SimpleNamespace(
        user=SimpleNamespace(identity="buyer-a"), resource="threads", action="create"
    )
    assert asyncio.run(add_owner(ctx, value)) == {"owner": "buyer-a"}
    assert value["metadata"]["owner"] == "buyer-a"
