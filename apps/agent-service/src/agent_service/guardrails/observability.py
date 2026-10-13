"""Decisiones sin texto ni identidad, tanto en logs como en el árbol de trazas."""

import json
import logging
from collections import Counter

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
    _counts[reason] += 1
    logger.info(json.dumps({"metric": "guardrail_events_total", **event, "count": _counts[reason]}))


def record_moderation(config, status: str):
    config.setdefault("metadata", {})["moderation"] = status
    run = get_current_run_tree()
    while run is not None:
        run.add_metadata({"moderation": status})
        run = run.parent_run
    logger.info(json.dumps({"moderation": status}))
