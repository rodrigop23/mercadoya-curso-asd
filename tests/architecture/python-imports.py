"""Exercise the actual Python contracts with temporary forbidden imports."""

import subprocess
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[2]
for service, module, forbidden in (
    ("agent-service", "agent_service", "mercadoya_mcp"),
    ("agent-service", "agent_service", "mcp_server"),
    ("mcp-server", "mercadoya_mcp", "agent_service"),
):
    directory = root / "apps" / service
    fixture = directory / "src" / module / f"_fitness_{uuid4().hex}.py"
    try:
        fixture.write_text(f"from {forbidden}.server import app\n")
        result = subprocess.run(
            ["uv", "run", "--locked", "lint-imports", "--no-cache", "--no-logo"],
            cwd=directory,
            capture_output=True,
            text=True,
        )
        if result.returncode != 1 or "BROKEN" not in result.stdout:
            raise AssertionError(result.stdout + result.stderr)
        print(f"PASS {module} rejects {forbidden}")
    finally:
        fixture.unlink(missing_ok=True)
