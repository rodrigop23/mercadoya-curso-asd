FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN useradd --create-home --uid 10001 mcp && chown mcp:mcp /app
USER mcp
COPY --chown=mcp:mcp pyproject.toml uv.lock .python-version ./
COPY --chown=mcp:mcp src ./src
RUN uv sync --locked --no-dev
EXPOSE 8080
CMD ["/app/.venv/bin/python", "-m", "mercadoya_mcp.server"]
