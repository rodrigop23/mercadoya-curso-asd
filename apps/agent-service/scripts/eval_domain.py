"""Evalúa Clef secuencialmente sin exportar textos ni credenciales."""

import argparse
import asyncio
import json
import math
import os
from collections import Counter
from pathlib import Path
from statistics import median

from agent_service.guardrails.domain import CRITERIA, ClassificationError
from agent_service.guardrails.domain_clef import ClefClassifier, close_client

DATASET = Path(__file__).resolve().parents[1] / "evals/domain_cases.jsonl"


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


async def evaluate(model, cases, pause_s):
    os.environ["AGENT_CLASSIFIER_MODEL"] = model
    classifier = ClefClassifier()
    matrix = Counter()
    correct = category_correct = 0
    false_positives, false_negatives, errors, latencies, category_mismatches = [], [], [], [], []
    for index, case in enumerate(cases):
        if index:
            await asyncio.sleep(pause_s)
        try:
            decision = await classifier.classify(
                case["input"], case["history"], case["recent_confirmation"]
            )
        except ClassificationError as error:
            errors.append({"id": case["id"], "subtype": error.subtype})
            continue
        correct += decision.in_domain == case["expected_in_domain"]
        category_correct += decision.category == case["expected_category"]
        if decision.category != case["expected_category"]:
            category_mismatches.append(
                {
                    "id": case["id"],
                    "expected": case["expected_category"],
                    "actual": decision.category,
                }
            )
        matrix[case["expected_category"], decision.category] += 1
        latencies.append(decision.latency_ms)
        if decision.in_domain and not case["expected_in_domain"]:
            false_positives.append(case["id"])
        if not decision.in_domain and case["expected_in_domain"]:
            false_negatives.append(case["id"])
    result = {
        "model": model,
        "cases": len(cases),
        "accuracy": correct / len(cases),
        "category_accuracy": category_correct / len(cases),
        "category_order": list(CRITERIA),
        "category_matrix": [
            [matrix[expected, actual] for actual in CRITERIA] for expected in CRITERIA
        ],
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "category_mismatches": category_mismatches,
        "errors": errors,
        "latency_p50_ms": median(latencies) if latencies else None,
        "latency_p95_ms": percentile(latencies, 0.95) if latencies else None,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=["clef", "clef-flash", "both"], default="clef")
    parser.add_argument("--pause-s", type=float, default=0.1)
    args = parser.parse_args()
    if not os.getenv("CLOUDFLARE_ACCOUNT_ID") or not os.getenv("CLOUDFLARE_API_TOKEN"):
        print("Evaluación omitida: configura CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN.")
        return
    if args.pause_s < 0:
        parser.error("--pause-s debe ser mayor o igual a cero")
    cases = [json.loads(line) for line in DATASET.read_text().splitlines() if line.strip()]
    models = ["clef", "clef-flash"] if args.model == "both" else [args.model]
    try:
        results = [await evaluate(model, cases, args.pause_s) for model in models]
        if len(results) == 2:
            print(
                json.dumps(
                    {
                        "comparison": [
                            {
                                key: result[key]
                                for key in (
                                    "model",
                                    "accuracy",
                                    "category_accuracy",
                                    "latency_p50_ms",
                                    "latency_p95_ms",
                                )
                            }
                            for result in results
                        ]
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(main())
