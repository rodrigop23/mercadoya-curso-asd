"""Decisiones sin texto ni identidad, tanto en logs como en el árbol de trazas."""

import json
import logging
from collections import Counter

from langchain_core.tracers.base import BaseTracer
from langsmith import get_current_run_tree

logger = logging.getLogger(__name__)
_counts = Counter()


def record_event(config, guardrail: str, reason: str, action: str):
    event = dict(guardrail=guardrail, reason=reason, action=action)
    tags = [f"{key}={value}" for key, value in event.items()]
    config.setdefault("metadata", {}).update(event)
    config.setdefault("tags", []).extend(tag for tag in tags if tag not in config["tags"])
    run = get_current_run_tree()
    while run is not None:
        run.add_metadata(event)
        run.add_tags(tags)
        run = run.parent_run
    key = (guardrail, reason, action)
    _counts[key] += 1
    logger.info(
        json.dumps(
            {
                "metric": "guardrail_events_total",
                **event,
                **({"category": reason} if guardrail == "domain" else {}),
                "count": _counts[key],
            }
        )
    )


def record_domain(config, metadata: dict):
    config.setdefault("metadata", {}).update(metadata)
    run = get_current_run_tree()
    while run is not None:
        run.add_metadata(metadata)
        run = run.parent_run
    logger.info(json.dumps(metadata))


def record_moderation(config, status: str):
    config.setdefault("metadata", {})["moderation"] = status
    run = get_current_run_tree()
    while run is not None:
        run.add_metadata({"moderation": status})
        run = run.parent_run
    logger.info(json.dumps({"moderation": status}))


def record_specialist(config, name: str, reason: str | None):
    metadata = {"agent_name": name, "route_reason": reason}
    tag = f"agent:{name}"
    config.setdefault("metadata", {}).update(metadata)
    tags = config.setdefault("tags", [])
    if tag not in tags:
        tags.append(tag)
    run = get_current_run_tree()
    current = run
    while run is not None:
        if run is current or run.name == name:
            run.add_metadata(metadata)
            if tag not in run.tags:
                run.add_tags([tag])
        run = run.parent_run

    # Los tracers de LangChain enlazan runs por parent_run_id; parent_run puede ser None.
    # Actualiza los spans activos antes de su exportación, sin depender del orden de callbacks.
    callbacks = config.get("callbacks")
    for handler in getattr(callbacks, "handlers", []):
        if not isinstance(handler, BaseTracer):
            continue
        run_id = getattr(callbacks, "parent_run_id", None)
        current_id = run_id
        while run_id is not None:
            traced = handler.run_map.get(str(run_id))
            if traced is None:
                break
            if run_id == current_id or traced.name == name:
                traced.add_metadata(metadata)
                if tag not in traced.tags:
                    traced.add_tags([tag])
            run_id = traced.parent_run_id
