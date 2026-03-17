import unittest

from server.parser import normalize_event


class ParserTests(unittest.TestCase):
    def test_normalizes_linux_journal_event(self):
        raw = {
            "__REALTIME_TIMESTAMP": "1735689600000000",
            "MESSAGE": "System started",
            "_SYSTEMD_UNIT": "sshd.service",
            "SYSLOG_IDENTIFIER": "sshd",
            "_PID": "101",
            "_UID": "0",
            "PRIORITY": "4",
        }

        event = normalize_event(raw, source="journal", host="srv-01")

        self.assertEqual(event["host"], "srv-01")
        self.assertEqual(event["source"], "journal")
        self.assertEqual(event["severity"], "warn")
        self.assertEqual(event["process"], "sshd")
        self.assertEqual(event["pid"], 101)
        self.assertEqual(event["uid"], 0)
        self.assertTrue(event["hash"])

    def test_normalizes_windows_event_level(self):
        raw = {
            "TimeGenerated": "2026-01-01T12:00:00Z",
            "Message": "Critical service failure",
            "SourceName": "ServiceControlManager",
            "EventType": "Error",
        }

        event = normalize_event(raw, source="eventlog", host="win-host")

        self.assertEqual(event["severity"], "err")
        self.assertEqual(event["unit"], "ServiceControlManager")
        self.assertEqual(event["process"], "ServiceControlManager")


if __name__ == "__main__":
    unittest.main()

