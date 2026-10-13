"""Arranca dev sin claves y prueba el API con un JWKS RSA efímero local."""

import argparse
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from jsonschema import validate

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


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def wait_health(base, path, process):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("MCP terminó antes del healthcheck")
        try:
            if request(base, path)[0] == 200:
                return
        except (URLError, TimeoutError):
            pass
        time.sleep(0.2)
    raise TimeoutError("MCP no respondió")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=2024)
    parser.add_argument("--tools", action="store_true")
    args = parser.parse_args()
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key.update(kid="smoke-rsa", use="sig", alg="RS256")
    jwks_available = True
    received_auth = []
    cancel_posts = []
    order_status = {"smoke-buyer-a": "pending", "smoke-buyer-b": "pending"}
    order_ids = {
        "smoke-buyer-a": "00000000-0000-4000-8000-00000000000a",
        "smoke-buyer-b": "00000000-0000-4000-8000-00000000000b",
    }
    product_id = "00000000-0000-4000-8000-000000000001"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status = 200
            if self.path.startswith("/api/products"):
                product = dict(
                    id=product_id,
                    title="Audífonos del stub",
                    description="Lectura real",
                    price=99.90,
                    stock=7,
                )
                body = (
                    {"products": [product]}
                    if self.path.split("?")[0] == "/api/products"
                    else {"product": product}
                )
            elif self.path.startswith("/api/orders"):
                authorization = self.headers.get("Authorization", "")
                received_auth.append(authorization)
                try:
                    claims = jwt.decode(
                        authorization.removeprefix("Bearer "),
                        private.public_key(),
                        algorithms=["RS256"],
                        issuer="http://localhost:8000",
                        audience="mercadoya-services",
                    )
                    oid = order_ids[claims["sub"]]
                    order = dict(
                        id=oid,
                        status=order_status[claims["sub"]],
                        createdAt="2026-10-12T10:00:00Z",
                        totalAmount=19980,
                        buyerId=claims["sub"],
                        items=[
                            dict(
                                productId=product_id,
                                title="Audífonos del stub",
                                quantity=2,
                                unitAmount=9990,
                                currency="pen",
                            )
                        ],
                    )
                    if self.path == "/api/orders":
                        body = {"orders": [order]}
                    elif self.path == f"/api/orders/{oid}":
                        body = {"order": order}
                    else:
                        status, body = 404, {"error": "private order"}
                except (jwt.PyJWTError, KeyError):
                    status, body = 401, {"error": "invalid"}
            else:
                status, body = (200 if jwks_available else 503), {"keys": [key]}
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def do_POST(self):
            authorization = self.headers.get("Authorization", "")
            cancel_posts.append(authorization)
            try:
                claims = jwt.decode(
                    authorization.removeprefix("Bearer "),
                    private.public_key(),
                    algorithms=["RS256"],
                    issuer="http://localhost:8000",
                    audience="mercadoya-services",
                )
                subject = claims["sub"]
                oid = order_ids[subject]
                if self.path != f"/api/orders/{oid}/cancel":
                    status, body = 404, {"error": "private order"}
                elif order_status[subject] not in {"pending", "cancelled"}:
                    status, body = 409, {"error": "finished"}
                else:
                    status = 200 if order_status[subject] == "cancelled" else 202
                    order_status[subject] = "cancelled"
                    body = {"order": {"id": oid, "status": "cancelled"}}
            except (jwt.PyJWTError, KeyError):
                status, body = 401, {"error": "invalid"}
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

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
                "jti": str(uuid4()),
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
    mcp_process = None
    try:
        with ExitStack() as stack:
            log = stack.enter_context(tempfile.TemporaryFile(mode="w+"))
            mcp_log = stack.enter_context(tempfile.TemporaryFile(mode="w+"))
            config_path = "langgraph.ci.json"
            if args.tools:
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    mcp_port = sock.getsockname()[1]
                mcp_base = f"http://127.0.0.1:{mcp_port}"
                env.update(
                    AGENT_MODEL_PROVIDER="scripted",
                    MCP_URL=mcp_base + "/mcp",
                    MCP_INTERNAL_TOKEN="smoke-internal-token",
                )
                config = json.loads((HERE / "langgraph.ci.json").read_text())
                config["env"]["AGENT_MODEL_PROVIDER"] = "scripted"
                config_file = stack.enter_context(
                    tempfile.NamedTemporaryFile(
                        mode="w+", suffix=".json", prefix=".smoke-", dir=HERE
                    )
                )
                json.dump(config, config_file)
                config_file.flush()
                config_path = config_file.name
                stub_base = f"http://127.0.0.1:{jwks.server_port}"
                mcp_process = subprocess.Popen(
                    ["uv", "run", "--locked", "python", "-m", "mercadoya_mcp.server"],
                    cwd=HERE.parent / "mcp-server",
                    env={
                        **env,
                        "MCP_PORT": str(mcp_port),
                        "CATALOG_URL": stub_base,
                        "ORDERS_URL": stub_base,
                    },
                    stdout=mcp_log,
                    stderr=mcp_log,
                )
                stack.callback(stop_process, mcp_process)
                wait_health(mcp_base, "/health", mcp_process)
                check(request(mcp_base, "/mcp", body={})[0] == 401, "MCP sin token interno 401")
            process = subprocess.Popen(
                [
                    "uv",
                    "run",
                    "--locked",
                    "langgraph",
                    "dev",
                    "--config",
                    config_path,
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
                if args.tools:

                    def tool_run(token, command):
                        status, created = request(base, "/threads", token, {})
                        check(status == 200, "hilo para tool")
                        thread_id = created["thread_id"]
                        status, result = request(
                            base,
                            f"/threads/{thread_id}/runs/wait",
                            token,
                            {
                                "assistant_id": "agent",
                                "input": {"messages": [{"role": "user", "content": command}]},
                            },
                        )
                        check(status == 200, "run con herramienta")
                        text = json.dumps(result, ensure_ascii=False)
                        check("resultado:" in text, "respuesta desde ToolMessage")
                        status, state = request(base, f"/threads/{thread_id}/state", token)
                        check(
                            status == 200 and all(t not in json.dumps(state) for t in tokens),
                            "estado y argumentos de tools sin JWT",
                        )
                        return text, state

                    text, _ = tool_run(a, '/tool search_products {"query":"audifonos"}')
                    check("Audífonos del stub" in text and "99.90" in text, "catálogo vía MCP")
                    for token, subject, other in (
                        (a, "smoke-buyer-a", "smoke-buyer-b"),
                        (b, "smoke-buyer-b", "smoke-buyer-a"),
                    ):
                        text, _ = tool_run(token, "/tool list_my_orders {}")
                        check(
                            order_ids[subject] in text and order_ids[other] not in text,
                            "pedidos propios aislados",
                        )
                        check(received_auth[-1] == f"Bearer {token}", "JWT exacto en Orders")
                        check("buyerId" not in text, "sin datos privados de Orders")
                    text, state = tool_run(
                        a,
                        "/tool get_my_order "
                        + json.dumps({"order_id": order_ids["smoke-buyer-b"]}),
                    )
                    check("No encontré ese pedido entre los tuyos" in text, "pedido ajeno oculto")
                    check(
                        any(
                            m.get("status") == "error"
                            for m in state["values"]["messages"]
                            if m.get("type") == "tool"
                        ),
                        "error MCP como ToolMessage",
                    )

                    schema = json.loads(
                        (
                            HERE.parents[1] / "packages/contracts/agent/agent-action.schema.json"
                        ).read_text()
                    )

                    def proposal_run(token, name, params):
                        status, created = request(base, "/threads", token, {})
                        check(status == 200, "hilo para propuesta")
                        thread_id = created["thread_id"]
                        status, result = request(
                            base,
                            f"/threads/{thread_id}/runs/wait",
                            token,
                            {
                                "assistant_id": "agent",
                                "input": {
                                    "messages": [
                                        {
                                            "role": "user",
                                            "content": f"/tool {name} " + json.dumps(params),
                                        }
                                    ]
                                },
                            },
                        )
                        check(status == 200, "run de propuesta")
                        check(all(t not in json.dumps(result) for t in tokens), "interrupt sin JWT")
                        status, state = request(base, f"/threads/{thread_id}/state", token)
                        check(
                            status == 200 and all(t not in json.dumps(state) for t in tokens),
                            "estado interrumpido sin JWT",
                        )
                        status, thread = request(base, f"/threads/{thread_id}", token)
                        check(
                            status == 200 and all(t not in json.dumps(thread) for t in tokens),
                            "interrupts del hilo sin JWT",
                        )
                        return thread_id, result

                    def resume_run(thread_id, token, intr, approved, result=None):
                        value = {"action_id": intr["value"]["action_id"], "approved": approved}
                        if result is not None:
                            value["result"] = result
                        validate(value, schema)
                        check(all(t not in json.dumps(value) for t in tokens), "resume sin JWT")
                        return request(
                            base,
                            f"/threads/{thread_id}/runs/wait",
                            token,
                            {"assistant_id": "agent", "command": {"resume": {intr["id"]: value}}},
                        )

                    for approved in (True, False):
                        thread_id, result = proposal_run(
                            a, "propose_add_to_cart", {"product_id": product_id, "quantity": 2}
                        )
                        intr = result["__interrupt__"][0]
                        validate(intr["value"], schema)
                        check(intr["value"]["kind"] == "add_to_cart", "payload de carrito válido")
                        status, result = resume_run(
                            thread_id,
                            a,
                            intr,
                            approved,
                            {"applied": True, "quantity_in_cart": 2} if approved else None,
                        )
                        text = json.dumps(result, ensure_ascii=False)
                        check(
                            status == 200
                            and ("Cantidad final: 2" if approved else "no aprobó") in text,
                            "carrito aprobado" if approved else "carrito rechazado",
                        )

                    # Rechazar antes de aprobar conserva un pedido pendiente para ambos casos.
                    thread_id, result = proposal_run(
                        a, "propose_cancel_order", {"order_id": order_ids["smoke-buyer-a"]}
                    )
                    intr = result["__interrupt__"][0]
                    validate(intr["value"], schema)
                    status, result = resume_run(thread_id, a, intr, False)
                    check(
                        status == 200
                        and "no aprobó" in json.dumps(result, ensure_ascii=False)
                        and not cancel_posts,
                        "cancelación rechazada sin POST",
                    )

                    thread_id, result = proposal_run(
                        a, "propose_cancel_order", {"order_id": order_ids["smoke-buyer-a"]}
                    )
                    intr = result["__interrupt__"][0]
                    validate(intr["value"], schema)
                    renewed = issue("smoke-buyer-a")
                    check(renewed != a, "JWT nuevo del mismo comprador")
                    status, result = resume_run(thread_id, renewed, intr, True)
                    check(
                        status == 200
                        and "Pedido cancelado" in json.dumps(result, ensure_ascii=False),
                        "cancelación aprobada",
                    )
                    check(
                        cancel_posts == [f"Bearer {renewed}"],
                        "un POST con JWT del request que reanuda",
                    )
                    status, duplicate = resume_run(thread_id, renewed, intr, True)
                    check(status >= 400 or "__error__" in duplicate, "segundo resume rechazado")
                    check(cancel_posts == [f"Bearer {renewed}"], "segundo resume sin segundo POST")
                    status, state = request(base, f"/threads/{thread_id}/state", renewed)
                    check(
                        status == 200 and all(t not in json.dumps(state) for t in tokens),
                        "estado final sin JWT",
                    )

                    _, result = proposal_run(
                        a, "propose_cancel_order", {"order_id": order_ids["smoke-buyer-b"]}
                    )
                    check(
                        not result.get("__interrupt__")
                        and "No encontré ese pedido entre los tuyos"
                        in json.dumps(result, ensure_ascii=False),
                        "cancelación ajena sin interrupt",
                    )
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
            if mcp_process:
                stop_process(mcp_process)
                mcp_log.seek(0)
                check(all(t not in mcp_log.read() for t in tokens), "logs MCP sin JWT")
            log.seek(0)
            logs = log.read()
            check(all(t not in logs for t in tokens), "logs sin JWT")
    finally:
        jwks.shutdown()
        jwks.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
