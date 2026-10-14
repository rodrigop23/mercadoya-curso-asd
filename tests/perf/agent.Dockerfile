# langgraph build genera el runtime PostgreSQL que exige licencia/LangSmith.
# Fitness functions sin claves usan el mismo API 0.16.0 en modo dev, inmem.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN useradd --create-home --uid 10001 perf && chown perf:perf /app
USER perf
COPY --chown=perf:perf apps/agent-service/pyproject.toml apps/agent-service/uv.lock apps/agent-service/.python-version ./
COPY --chown=perf:perf apps/agent-service/src ./src
RUN uv sync --locked
COPY --chown=perf:perf apps/agent-service/langgraph.ci.json ./langgraph.ci.json
EXPOSE 8000
CMD ["/app/.venv/bin/langgraph", "dev", "--config", "langgraph.ci.json", "--host", "0.0.0.0", "--port", "8000", "--no-browser", "--no-reload"]
