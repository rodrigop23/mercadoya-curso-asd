"""Prove the real scan rejects a synthetic secret and unsafe Compose."""

import secrets
import subprocess
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[2]
directory = root / "tests" / "security"
identifier = uuid4().hex
key_file = directory / f"fitness-{identifier}.txt"
compose_file = directory / f"compose-{identifier}.yaml"
dockerfile = directory / f"Dockerfile.{identifier}"
exceptions_file = directory / f"exceptions-{identifier}.yaml"
try:
    # Construido al ejecutar el test, sin claves ni fixtures secretos en Git.
    key = "AK" + "IA" + ''.join(secrets.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') for _ in range(16))
    key_file.write_text(f'aws_access_key_id="{key}"\naws_secret_access_key="{secrets.token_urlsafe(30)}"\n')
    compose_file.write_text(
        "services:\n  unsafe:\n    image: alpine:latest\n    privileged: true\n"
        "    ports: ['8080:80']\n"
    )
    dockerfile.write_text('FROM alpine:latest\nUSER root\nCMD ["true"]\n')
    exceptions_file.write_text(
        "vulnerabilities:\n"
        "  - id: expired-fixture\n    paths: [fixture]\n    statement: synthetic\n"
        "    expired_at: '2020-01-01T00:00:00Z'\n"
        "  - id: long-fixture\n    paths: [fixture]\n    statement: synthetic\n"
        "    expired_at: '2099-01-01T00:00:00Z'\n"
    )
    result = subprocess.run(
        ["bash", "scripts/security-scan.sh"], cwd=root, capture_output=True, text=True
    )
    # stdout solo contiene metadatos redactados por security-report.py.
    print(result.stdout, end="")
    if result.returncode != 1:
        raise AssertionError("Security scan did not reject the fixtures")
    if "aws-access-key-id" not in result.stdout:
        raise AssertionError("AWS secret detector did not fire")
    for rule in (
        "MY-COMPOSE-001", "MY-COMPOSE-002", "DS-0002", "MY-DOCKER-001", "MY-EXCEPTIONS-001"
    ):
        if rule not in result.stdout:
            raise AssertionError(f"{rule} did not fire")
    if result.stdout.count("MY-EXCEPTIONS-001") != 2:
        raise AssertionError("Expired and over-90-day exceptions must both fail")
    print("PASS secret, container misconfiguration and invalid exceptions rejected, exit 1")
finally:
    key_file.unlink(missing_ok=True)
    compose_file.unlink(missing_ok=True)
    dockerfile.unlink(missing_ok=True)
    exceptions_file.unlink(missing_ok=True)
