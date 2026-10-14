import subprocess
from pathlib import Path

import httpx


def test_real_adapter_and_legacy_handshake(running_mcp):
    here = Path(__file__).resolve().parent
    agent = here.parents[1] / "agent-service"
    result = subprocess.run(
        ["uv", "run", "--locked", "python", str(here / "adapter_probe.py"), running_mcp],
        cwd=agent,
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert httpx.post(running_mcp + "/mcp", json={}).status_code == 401
    assert (
        httpx.post(
            running_mcp + "/mcp", json={}, headers={"X-MCP-Internal-Token": "wrong"}
        ).status_code
        == 401
    )
    assert httpx.get(running_mcp + "/health").status_code == 200
