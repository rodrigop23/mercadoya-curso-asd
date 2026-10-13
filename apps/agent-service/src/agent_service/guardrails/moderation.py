"""Moderación opcional, con un presupuesto total de tres segundos y sin retries."""

import asyncio
import os


async def moderate(text: str, *, enabled: bool, client=None) -> str:
    if not enabled or not os.getenv("OPENAI_API_KEY"):
        return "skipped"
    try:
        async with asyncio.timeout(3):
            if client is not None:
                result = await client.moderations.create(model="omni-moderation-latest", input=text)
            else:
                from openai import AsyncOpenAI

                async with AsyncOpenAI(timeout=3, max_retries=0) as api:
                    result = await api.moderations.create(
                        model="omni-moderation-latest", input=text
                    )
            return "blocked" if any(item.flagged for item in result.results) else "allowed"
    except Exception:
        # No se registran excepciones del proveedor: pueden incluir el request.
        return "skipped"
