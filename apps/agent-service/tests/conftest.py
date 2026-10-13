import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from agent_service.auth import jwks_client


@pytest.fixture
def identity(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key.update(kid="test-key", alg="RS256", use="sig")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"keys": [key]}).encode())

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    monkeypatch.setenv("JWKS_URL", f"http://127.0.0.1:{server.server_port}/jwks")
    monkeypatch.setenv("JWT_ISSUER", "http://localhost:8000")
    monkeypatch.setenv("JWT_AUDIENCE", "mercadoya-services")
    jwks_client.cache_clear()

    def issue(overrides=None, headers=None, omit=()):
        now = int(time.time())
        claims = {
            "sub": "buyer-a",
            "role": "user",
            "iss": "http://localhost:8000",
            "aud": "mercadoya-services",
            "iat": now,
            "exp": now + 300,
        }
        claims.update(overrides or {})
        for claim in omit:
            claims.pop(claim)
        return jwt.encode(
            claims,
            private,
            algorithm="RS256",
            headers={"kid": "test-key"} if headers is None else headers,
        )

    yield issue
    server.shutdown()
    server.server_close()
    worker.join(timeout=2)
    jwks_client.cache_clear()


@pytest.fixture(autouse=True)
def classifiers_without_network(monkeypatch):
    monkeypatch.setenv("AGENT_CLASSIFIER_PROVIDER", "rules")
    monkeypatch.setenv("AGENT_CLASSIFIER_FAIL_OPEN", "false")
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
