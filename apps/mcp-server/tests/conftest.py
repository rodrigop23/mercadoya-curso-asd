import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

HERE = Path(__file__).resolve().parents[1]
PID = "00000000-0000-4000-8000-000000000001"


@pytest.fixture
def running_mcp(tmp_path):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            product = dict(id=PID, title="Audífonos", description="x" * 1200, price=99.90, stock=3)
            body = (
                {"products": [product] * 12}
                if self.path.startswith("/api/products?") or self.path == "/api/products"
                else {"product": product}
            )
            self.wfile.write(json.dumps(body).encode())

        def log_message(self, *_args):
            pass

    stub = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=stub.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    log_path = tmp_path / "mcp.log"
    with log_path.open("w+") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "mercadoya_mcp.server"],
            cwd=HERE,
            env={
                **os.environ,
                "MCP_PORT": str(port),
                "MCP_INTERNAL_TOKEN": "integration-secret",
                "CATALOG_URL": f"http://127.0.0.1:{stub.server_port}",
            },
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(log_path.read_text())
                try:
                    if httpx.get(base + "/health").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError("MCP no respondió")
            yield base
        finally:
            process.terminate()
            process.wait(timeout=10)
            stub.shutdown()
            stub.server_close()
            thread.join(timeout=2)
