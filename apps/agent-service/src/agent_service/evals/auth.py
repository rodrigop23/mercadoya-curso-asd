"""Preflight local de formato y expiración. MCP sigue validando firma e identidad."""

import math
import os
import re
import time

import jwt


class EvaluationConfigError(ValueError):
    """Mensaje fijo que se puede imprimir sin credenciales ni datos de terceros."""


def validate_buyer_jwt():
    token = os.getenv("AGENT_EVAL_BUYER_JWT", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
        raise EvaluationConfigError(
            "AGENT_EVAL_BUYER_JWT tiene formato inválido; copia solo el valor de token"
        )
    try:
        # Este chequeo no autentica al comprador ni sustituye la validación del servicio.
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        raise EvaluationConfigError(
            "AGENT_EVAL_BUYER_JWT no se puede leer; renueva el JWT"
        ) from None
    expiry = claims.get("exp")
    if type(expiry) not in (int, float) or not math.isfinite(expiry):
        raise EvaluationConfigError("AGENT_EVAL_BUYER_JWT no tiene una expiración válida")
    if expiry <= time.time():
        raise EvaluationConfigError(
            "AGENT_EVAL_BUYER_JWT vencido; obtén uno nuevo en /api/auth/token "
            "y actualiza .env.evals"
        )
