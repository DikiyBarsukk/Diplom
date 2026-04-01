import unittest
from datetime import datetime, timezone
from pathlib import Path

from server.demo_loader import EXPECTED_RULE_IDS, load_fixture, materialize_fixture, resolve_night_window_anchor
from server.incidents import IncidentAnalyzer


class DemoLoaderTests(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture(Path("tests/data/demo_master_template.json"))

    def test_materialize_fixture_orders_events_and_produces_valid_timestamps(self):
        fixed_now = datetime(2026, 4, 1, 12, 34, 56, tzinfo=timezone.utc)
        events = materialize_fixture(self.fixture, now=fixed_now)

        self.assertEqual(len(events), len(self.fixture["events"]))
        self.assertEqual([event["ts"] for event in events], sorted(event["ts"] for event in events))

        blocks = {event["block"] for event in events}
        self.assertEqual(blocks, {"baseline", "R001", "R002", "R003", "R004", "R005"})

        for event in events:
            parsed = datetime.fromisoformat(event["ts"].replace("Z", "+00:00"))
            self.assertIsNotNone(parsed.tzinfo)

    def test_night_window_anchor_uses_previous_safe_window_after_morning(self):
        fixed_now = datetime(2026, 4, 1, 12, 34, tzinfo=timezone.utc)
        anchor = resolve_night_window_anchor(fixed_now)
        self.assertEqual(anchor.isoformat(), "2026-03-31T01:30:00+00:00")

    def test_materialized_fixture_triggers_all_rules(self):
        fixed_now = datetime(2026, 4, 1, 12, 34, tzinfo=timezone.utc)
        events = materialize_fixture(self.fixture, now=fixed_now)
        incidents = IncidentAnalyzer().analyze_events(events)

        rule_ids = {incident["rule_id"] for incident in incidents}
        self.assertTrue(set(EXPECTED_RULE_IDS).issubset(rule_ids))


if __name__ == "__main__":
    unittest.main()