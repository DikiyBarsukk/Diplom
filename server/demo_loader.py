from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Mapping

DEFAULT_FIXTURE_PATH = Path("tests/data/demo_master_template.json")
EXPECTED_RULE_IDS = ("R001", "R002", "R003", "R004", "R005")


def _round_utc_minute(now: datetime | None = None) -> datetime:
    value = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    return value.replace(second=0, microsecond=0)


def _to_zulu(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(second=0, microsecond=0).isoformat().replace("+00:00", "Z")


def resolve_anchor_times(now: datetime | None = None) -> Dict[str, datetime]:
    base_now = _round_utc_minute(now)
    return {
        "now": base_now,
        "night_window": resolve_night_window_anchor(base_now),
    }


def resolve_night_window_anchor(now: datetime | None = None) -> datetime:
    base_now = _round_utc_minute(now)
    today_window = base_now.replace(hour=1, minute=30, second=0, microsecond=0)

    if base_now < today_window:
        return today_window - timedelta(days=1)
    if base_now.hour < 6:
        return today_window
    return today_window - timedelta(days=1)


def load_fixture(source: str | Path | Mapping[str, Any]) -> Dict[str, Any]:
    if isinstance(source, Mapping):
        return dict(source)

    path = Path(source)
    return json.loads(path.read_text(encoding="utf-8"))


def expected_rules_from_fixture(fixture_source: str | Path | Mapping[str, Any]) -> list[str]:
    fixture = load_fixture(fixture_source)
    metadata = fixture.get("metadata") or {}
    rules = metadata.get("expected_rules")
    if isinstance(rules, list) and rules:
        return [str(rule) for rule in rules]

    discovered: list[str] = []
    for event in fixture.get("events", []):
        block = str(event.get("block") or "")
        if block.startswith("R") and block not in discovered:
            discovered.append(block)
    return discovered


def materialize_fixture(fixture_source: str | Path | Mapping[str, Any], now: datetime | None = None) -> list[Dict[str, Any]]:
    fixture = load_fixture(fixture_source)
    anchors = resolve_anchor_times(now)
    resolved_events: list[Dict[str, Any]] = []

    for event in fixture.get("events", []):
        anchor = str(event.get("anchor") or "now")
        if anchor not in anchors:
            raise ValueError(f"Unsupported anchor: {anchor}")

        offset_minutes = int(event.get("offset_minutes") or 0)
        timestamp = anchors[anchor] + timedelta(minutes=offset_minutes)

        resolved = {
            key: value
            for key, value in event.items()
            if key not in {"anchor", "offset_minutes"}
        }
        resolved["ts"] = _to_zulu(timestamp)
        resolved_events.append(resolved)

    resolved_events.sort(key=lambda item: item["ts"])
    return resolved_events


def summarize_materialized_events(events: list[Dict[str, Any]]) -> Dict[str, Any]:
    hosts = sorted({str(event.get("host") or "unknown") for event in events})
    blocks = []
    for event in events:
        block = str(event.get("block") or "")
        if block and block not in blocks:
            blocks.append(block)

    return {
        "total_events": len(events),
        "hosts": hosts,
        "blocks": blocks,
    }