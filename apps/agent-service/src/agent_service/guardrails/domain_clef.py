"""Workers AI REST. Una conexión perezosa sin credenciales en headers compartidos."""

import logging
import math
import os
from contextvars import ContextVar
from time import perf_counter

import httpx

from agent_service.config import settings
from agent_service.guardrails.domain import (
    CRITERIA,
    QUESTIONS,
    ClassificationError,
    DomainDecision,
    request_state,
)

_client: httpx.AsyncClient | None = None
_private_request = ContextVar("clef_private_request", default=False)


class PrivateTransportLogs(logging.Filter):
    def filter(self, record):
        return not _private_request.get()


# HTTPX registra la URL con el account id a INFO; httpcore puede emitir headers a DEBUG.
for _name in (
    "httpx",
    "httpcore.connection",
    "httpcore.http11",
    "httpcore.http2",
    "httpcore.proxy",
    "httpcore.socks",
):
    logging.getLogger(_name).addFilter(PrivateTransportLogs())


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=settings().classifier_timeout_s, trust_env=False)
    return _client


async def close_client():
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def probability(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ClassificationError("invalid_response")
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ClassificationError("invalid_response")
    return float(value)


def parse_response(payload, model: str, minimum: float, latency_ms: float) -> DomainDecision:
    try:
        if not isinstance(payload, dict) or payload.get("success", True) is not True:
            raise ClassificationError("invalid_response")
        answers = payload.get("result", payload)["answers"]
        category = answers["categoria"]
        choice = category["choice"]
        if choice not in CRITERIA:
            raise ClassificationError("invalid_response")
        confidence = probability(category["confidence"])
        probabilities = category["probabilities"]
        if not isinstance(probabilities, dict) or choice not in probabilities:
            raise ClassificationError("invalid_response")
        for option, value in probabilities.items():
            if option not in CRITERIA:
                raise ClassificationError("invalid_response")
            probability(value)
        noul = answers["en_dominio"]
        if isinstance(noul, dict):
            noul = noul.get("noul", noul.get("probability"))
        in_domain_probability = probability(noul)
        return DomainDecision(
            choice != "fuera_de_dominio" and in_domain_probability >= minimum,
            choice,
            confidence,
            in_domain_probability,
            "clef",
            model,
            latency_ms,
        )
    except (KeyError, TypeError, AttributeError):
        raise ClassificationError("invalid_response") from None


class ClefClassifier:
    async def classify(
        self, text: str, history: list[dict], recent_confirmation: bool
    ) -> DomainDecision:
        cfg = settings()
        account = os.getenv("CLOUDFLARE_ACCOUNT_ID")
        token = os.getenv("CLOUDFLARE_API_TOKEN")
        if not account or not token:
            raise ClassificationError("unconfigured")
        if (
            cfg.classifier_model not in {"clef", "clef-flash"}
            or not math.isfinite(cfg.classifier_timeout_s)
            or cfg.classifier_timeout_s <= 0
            or not math.isfinite(cfg.classifier_min_in_domain)
            or not 0 <= cfg.classifier_min_in_domain <= 1
        ):
            raise ClassificationError("unconfigured")
        started = perf_counter()
        subtype = None
        context_token = _private_request.set(True)
        try:
            response = await get_client().post(
                f"https://api.cloudflare.com/client/v4/accounts/{account}"
                f"/ai/run/@cf/cloudflare/{cfg.classifier_model}",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "model": cfg.classifier_model,
                    "state": request_state(text, history, recent_confirmation),
                    "questions": QUESTIONS,
                },
                timeout=cfg.classifier_timeout_s,
            )
            if not 200 <= response.status_code < 300:
                subtype = (
                    "http_5xx"
                    if response.status_code >= 500
                    else "http_4xx"
                    if response.status_code >= 400
                    else "invalid_response"
                )
            else:
                try:
                    payload = response.json()
                except ValueError:
                    subtype = "invalid_response"
        except httpx.TimeoutException:
            subtype = "timeout"
        except httpx.RequestError:
            subtype = "invalid_response"
        finally:
            _private_request.reset(context_token)
        latency_ms = round((perf_counter() - started) * 1000, 3)
        # Levantar fuera de except evita conservar la excepción HTTP sensible en __context__.
        if subtype:
            raise ClassificationError(subtype, latency_ms)
        try:
            return parse_response(
                payload, cfg.classifier_model, cfg.classifier_min_in_domain, latency_ms
            )
        except ClassificationError as error:
            error.latency_ms = latency_ms
            raise
