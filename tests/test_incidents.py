import unittest

from server.incidents import BruteForceRule, SuspiciousActivityRule, UnauthorizedAccessRule


class IncidentRuleTests(unittest.TestCase):
    def test_brute_force_rule_detects_threshold(self):
        rule = BruteForceRule()
        events = [
            {"id": i, "host": "srv-01", "message": "login_failed", "ts": f"2026-01-01T00:0{i}:00Z"}
            for i in range(5)
        ]

        incident = rule.check(events)

        self.assertIsNotNone(incident)
        self.assertEqual(incident["incident_type"], "brute_force")
        self.assertEqual(incident["host"], "srv-01")

    def test_suspicious_activity_rule_correlates_download(self):
        rule = SuspiciousActivityRule()
        events = [
            {
                "id": 1,
                "host": "win-01",
                "process": "powershell",
                "message": "PowerShell started",
                "ts": "2026-01-01T10:00:00Z",
            },
            {
                "id": 2,
                "host": "win-01",
                "message": "invoke-webrequest download payload",
                "ts": "2026-01-01T10:03:00Z",
            },
        ]

        incident = rule.check(events)

        self.assertIsNotNone(incident)
        self.assertEqual(incident["incident_type"], "suspicious_activity")

    def test_unauthorized_access_rule_detects_night_admin_login(self):
        rule = UnauthorizedAccessRule()
        events = [
            {
                "id": 1,
                "message": "login_success admin",
                "unit": "admin",
                "ts": "2026-01-01T01:15:00Z",
            }
        ]

        incident = rule.check(events)

        self.assertIsNotNone(incident)
        self.assertEqual(incident["incident_type"], "unauthorized_access")


if __name__ == "__main__":
    unittest.main()

