"""Arranca dev sin claves y prueba el API con un JWKS RSA efímero local."""

import argparse
import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

HERE = Path(__file__).resolve().parents[1]


def request(base, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(
        base + path,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        response = urlopen(req, timeout=15)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read().decode()
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = raw
        return response.status, value


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=2024)
    args = parser.parse_args()
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key.update(kid="smoke-rsa", use="sig", alg="RS256")
    jwks_available = True

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if jwks_available else 503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"keys": [key]}).encode())

        def log_message(self, *_args):
            pass

    jwks = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=jwks.serve_forever, daemon=True)
    worker.start()
    tokens = []

    def issue(subject, kid="smoke-rsa"):
        now = int(time.time())
        token = jwt.encode(
            {
                "sub": subject,
                "role": "user",
                "iss": "http://localhost:8000",
                "aud": "mercadoya-services",
                "iat": now,
                "exp": now + 300,
            },
            private,
            algorithm="RS256",
            headers={"kid": kid},
        )
        tokens.append(token)
        return token

    env = dict(os.environ)
    for name in (
        "OPENAI_API_KEY",
        "LANGSMITH_API_KEY",
        "LANGCHAIN_API_KEY",
        "LANGGRAPH_CLOUD_LICENSE_KEY",
        "DATABASE_URI",
        "REDIS_URI",
    ):
        env.pop(name, None)
    env.update(
        OPENAI_API_KEY="",
        LANGSMITH_API_KEY="",
        LANGSMITH_TRACING="false",
        LANGCHAIN_TRACING_V2="false",
        AGENT_MODEL_PROVIDER="echo",
        JWKS_URL=f"http://127.0.0.1:{jwks.server_port}/jwks",
        JWT_ISSUER="http://localhost:8000",
        JWT_AUDIENCE="mercadoya-services",
    )
    base = f"http://127.0.0.1:{args.port}"
    process = None
    try:
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen(
                [
                    "uv",
                    "run",
                    "--locked",
                    "langgraph",
                    "dev",
                    "--config",
                    "langgraph.ci.json",
                    "--no-browser",
                    "--no-reload",
                    "--port",
                    str(args.port),
                ],
                cwd=HERE,
                env=env,
                stdout=log,
                stderr=log,
            )
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("langgraph dev terminó antes del healthcheck")
                    try:
                        if request(base, "/ok")[0] == 200:
                            break
                    except (URLError, TimeoutError):
                        pass
                    time.sleep(0.5)
                else:
                    raise TimeoutError("langgraph dev no respondió en 60 segundos")
                check(request(base, "/ok")[0] == 200, "/ok 200")
                check(request(base, "/threads", body={})[0] == 401, "sin token 401")
                check(request(base, "/threads", "invalid", {})[0] == 401, "token falso 401")
                a, b = issue("smoke-buyer-a"), issue("smoke-buyer-b")
                status, thread = request(
                    base, "/threads", a, {"metadata": {"owner": "smoke-buyer-b"}}
                )
                check(status == 200, "JWT RSA válido crea hilo")
                check(thread["metadata"]["owner"] == "smoke-buyer-a", "owner forzado")
                tid = thread["thread_id"]
                status, result = request(
                    base,
                    f"/threads/{tid}/runs/wait",
                    a,
                    {
                        "assistant_id": "agent",
                        "input": {"messages": [{"role": "user", "content": "hola"}]},
                    },
                )
                check(status == 200 and "eco: hola" in json.dumps(result), "run eco")
                status, found = request(base, "/threads/search", b, {})
                check(
                    status == 200 and all(t["thread_id"] != tid for t in found), "búsqueda aislada"
                )
                check(request(base, f"/threads/{tid}", b)[0] == 404, "hilo ajeno 404")
                check(request(base, f"/threads/{tid}/state", b)[0] == 404, "state ajeno 404")
                status, state = request(base, f"/threads/{tid}/state", a)
                check(status == 200 and "eco: hola" in json.dumps(state), "historial del dueño")
                check(all(t not in json.dumps(state) for t in tokens), "state sin JWT")
                jwks_available = False
                time.sleep(5.1)  # Cooldown de JWKS igual al verificador Node.
                # Un kid nuevo obliga a consultar JWKS a pesar de su caché.
                status, _ = request(base, "/threads", issue("smoke-buyer-a", "rotated"), {})
                check(status >= 500, "JWKS caído responde 5xx")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            log.seek(0)
            logs = log.read()
            check(all(t not in logs for t in tokens), "logs sin JWT")
    finally:
        jwks.shutdown()
        jwks.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
