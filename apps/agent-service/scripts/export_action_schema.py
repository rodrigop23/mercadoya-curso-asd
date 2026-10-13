"""Exporta el contrato público; ejecutar desde apps/agent-service con uv run python."""

import json
from pathlib import Path

from agent_service.actions import action_adapter

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "packages/contracts/agent/agent-action.schema.json"
)


def schema_text():
    return json.dumps(action_adapter.json_schema(), ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(schema_text())
