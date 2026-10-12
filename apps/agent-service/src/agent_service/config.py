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


def settings() -> Settings:
    return Settings(
        mcp_url=os.getenv("MCP_URL", "http://localhost:8080/mcp"),
        mcp_internal_token=os.getenv("MCP_INTERNAL_TOKEN", ""),
        model=os.getenv("AGENT_MODEL", "gpt-6-luna"),
        reasoning_effort=os.getenv("AGENT_REASONING_EFFORT", "low"),
        model_provider=os.getenv("AGENT_MODEL_PROVIDER", "openai"),
        jwks_url=os.getenv("JWKS_URL", "http://localhost:3006/api/auth/jwks"),
        issuer=os.getenv("JWT_ISSUER", "http://localhost:8000"),
        audience=os.getenv("JWT_AUDIENCE", "mercadoya-services"),
    )
