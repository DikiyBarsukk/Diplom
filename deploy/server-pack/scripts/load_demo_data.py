from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from server.demo_loader import (  # noqa: E402
    DEFAULT_FIXTURE_PATH,
    expected_rules_from_fixture,
    load_fixture,
    materialize_fixture,
    summarize_materialized_events,
)


def resolve_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return (ROOT_DIR / path).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description="Load reproducible demo data into BARSUKSIEM")
    parser.add_argument("--server", required=True, help="Server base URL, for example http://127.0.0.1:8080")
    parser.add_argument(
        "--fixture",
        default=str(DEFAULT_FIXTURE_PATH),
        help="Path to demo fixture template (default: tests/data/demo_master_template.json)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print resolved events without sending them")
    parser.add_argument("--output", help="Optional path to save resolved JSON payload")
    args = parser.parse_args()

    fixture_path = resolve_path(args.fixture)
    fixture = load_fixture(fixture_path)
    resolved_events = materialize_fixture(fixture)
    summary = summarize_materialized_events(resolved_events)
    expected_rules = expected_rules_from_fixture(fixture)

    if args.output:
        output_path = resolve_path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(resolved_events, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Resolved payload saved to: {output_path}")

    print(f"Fixture: {fixture_path}")
    print(f"Materialized {summary['total_events']} events across {len(summary['hosts'])} hosts")
    print("Hosts: " + ", ".join(summary["hosts"]))
    print("Expected rules: " + ", ".join(expected_rules))

    if args.dry_run:
        print(json.dumps(resolved_events, ensure_ascii=False, indent=2))
        return 0

    try:
        import requests
    except ImportError:
        print("The 'requests' package is required for sending demo data. Install requirements-server.txt first.", file=sys.stderr)
        return 1

    try:
        response = requests.post(
            f"{args.server.rstrip('/')}/api/logs",
            json=resolved_events,
            timeout=60,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Demo ingest failed: {exc}", file=sys.stderr)
        return 1

    payload = response.json()
    print(
        "Server response: "
        f"received={payload.get('received', 0)} saved={payload.get('saved', 0)} "
        f"skipped={payload.get('skipped', 0)} incidents_detected={payload.get('incidents_detected', 0)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())