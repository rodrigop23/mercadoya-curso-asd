"""Sincroniza el JSONL completo. Solo imprime cantidades, nunca ejemplos."""

import argparse
import json
import os
import sys
from contextlib import closing

from agent_service.evals.dataset import load_cases, sync_dataset


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag")
    args = parser.parse_args(argv)
    if not os.getenv("LANGSMITH_API_KEY"):
        print("Falta LANGSMITH_API_KEY", file=sys.stderr)
        return 1
    try:
        from langsmith import Client

        from agent_service.guardrails.privacy import sanitize_trace

        with closing(Client(anonymizer=sanitize_trace)) as client:
            counts = sync_dataset(client, load_cases(), args.tag)
        print(json.dumps(counts))
        return 0
    except Exception as error:
        print(
            "No se pudo sincronizar el dataset "
            f"[{type(error).__name__}]; revisar configuración y acceso",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
