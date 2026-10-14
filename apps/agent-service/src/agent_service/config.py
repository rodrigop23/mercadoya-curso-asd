"""Configuración del proceso, sin cargar archivos .env."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    model: str
    reasoning_effort: str
    model_provider: str
    jwks_url: str
    issuer: str
    mcp_url: str
    mcp_internal_token: str
    audience: str
    moderation: bool
    max_input_chars: int
    classifier_provider: str
    classifier_model: str
    classifier_timeout_s: float
    classifier_min_in_domain: float
    classifier_fail_open: bool


def settings() -> Settings:
    provider = os.getenv("AGENT_MODEL_PROVIDER", "openai")
    return Settings(
        classifier_provider=os.getenv(
            "AGENT_CLASSIFIER_PROVIDER", "clef" if provider == "openai" else "rules"
        ),
        classifier_model=os.getenv("AGENT_CLASSIFIER_MODEL", "clef"),
        classifier_timeout_s=float(os.getenv("AGENT_CLASSIFIER_TIMEOUT_S", "2")),
        classifier_min_in_domain=float(os.getenv("AGENT_CLASSIFIER_MIN_IN_DOMAIN", "0.5")),
        classifier_fail_open=os.getenv("AGENT_CLASSIFIER_FAIL_OPEN", "false").lower() == "true",
        moderation=os.getenv("AGENT_MODERATION", "off") == "on",
        max_input_chars=max(1, min(2000, int(os.getenv("AGENT_MAX_INPUT_CHARS", "2000")))),
        mcp_url=os.getenv("MCP_URL", "http://localhost:8080/mcp"),
        mcp_internal_token=os.getenv("MCP_INTERNAL_TOKEN", ""),
        model=os.getenv("AGENT_MODEL", "gpt-6-luna"),
        reasoning_effort=os.getenv("AGENT_REASONING_EFFORT", "low"),
        model_provider=provider,
        jwks_url=os.getenv("JWKS_URL", "http://localhost:3006/api/auth/jwks"),
        issuer=os.getenv("JWT_ISSUER", "http://localhost:8000"),
        audience=os.getenv("JWT_AUDIENCE", "mercadoya-services"),
    )
