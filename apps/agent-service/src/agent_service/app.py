"""Lifespan del Agent Server: diagnóstico al arrancar y cierre del cliente Clef."""

from contextlib import asynccontextmanager

from starlette.applications import Starlette

from agent_service.guardrails.domain import report_classifier_configuration
from agent_service.guardrails.domain_clef import close_client


@asynccontextmanager
async def lifespan(app):
    report_classifier_configuration()
    try:
        yield
    finally:
        await close_client()


app = Starlette(lifespan=lifespan)
