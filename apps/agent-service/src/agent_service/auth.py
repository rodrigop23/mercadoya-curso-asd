"""RS256 y claims de packages/jwt-verifier; credenciales solo en auth_user."""

import asyncio
import math
import time
from functools import lru_cache

import jwt
from langgraph_sdk import Auth

from agent_service.config import settings

auth = Auth()


@lru_cache(maxsize=1)
def jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=60, timeout=3, cooldown_duration=5)


@auth.authenticate
async def authenticate(headers: dict) -> dict:
    authorization = headers.get(b"authorization", headers.get("authorization", ""))
    if isinstance(authorization, bytes):
        authorization = authorization.decode("utf-8", errors="replace")
    if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
        raise Auth.exceptions.HTTPException(status_code=401, detail="Credencial inválida")
    token = authorization[7:]
    cfg = settings()
    try:
        header = jwt.get_unverified_header(token)
        if not header.get("kid") or header.get("alg") != "RS256":
            raise ValueError("Invalid signing header")
        key = await asyncio.to_thread(jwks_client(cfg.jwks_url).get_signing_key_from_jwt, token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=cfg.issuer,
            audience=cfg.audience,
            leeway=0,
            options={
                "require": ["sub", "iss", "aud", "iat", "exp"],
                "verify_iat": False,
                "verify_exp": False,
                "verify_nbf": False,
            },
        )
        # jose exige NumericDate numérico, sin strings ni bools. Usa segundos enteros.
        now = int(time.time())
        if (
            not isinstance(claims["sub"], str)
            or not claims["sub"]
            or claims.get("role") not in ("user", "admin")
            or any(
                type(claims[name]) not in (int, float) or not math.isfinite(claims[name])
                for name in ("iat", "exp", "nbf")
                if name in claims
            )
            or claims["exp"] <= now
            or ("nbf" in claims and claims["nbf"] > now)
            or claims["iat"] > now
            or now - claims["iat"] > 300
        ):
            raise ValueError("Invalid application claims")
    except jwt.PyJWKClientConnectionError:
        # CustomAuthBackend propaga excepciones de infraestructura; el servidor
        # responde 500. Mensaje sin token, header ni URL con credenciales.
        raise RuntimeError("No se pudo consultar el JWKS de identity") from None
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, OverflowError):
        raise Auth.exceptions.HTTPException(status_code=401, detail="Credencial inválida") from None
    return {"identity": claims["sub"], "role": claims["role"], "token": token}


@auth.on
async def add_owner(ctx: Auth.types.AuthContext, value: dict) -> dict:
    owner = ctx.user.identity
    if value.get("metadata") is None:
        value["metadata"] = {}
    value["metadata"]["owner"] = owner
    return {"owner": owner}
