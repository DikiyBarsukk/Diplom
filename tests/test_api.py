import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

import requests
import uvicorn

from server.app_factory import create_app
from server.config import AppConfig


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.db_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_file.close()
        self.port = self._find_free_port()
        config = AppConfig(
            cors_allowed_origins=["http://localhost:8080"],
            cookie_secure=False,
            cookie_samesite="lax",
            session_max_age=86400,
            bootstrap_admin_username="admin",
            bootstrap_admin_password="Admin123!Test",
            demo_mode=True,
        )
        app = create_app(db_path=self.db_file.name, config=config)
        uvicorn_config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="error")
        self.server = uvicorn.Server(uvicorn_config)
        self.server_thread = threading.Thread(target=self.server.run, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.session = requests.Session()
        self.demo_logs = json.loads(Path("tests/data/demo_logs.json").read_text(encoding="utf-8"))
        self._wait_until_ready()

    def tearDown(self):
        self.server.should_exit = True
        self.server_thread.join(timeout=10)
        self.session.close()
        try:
            Path(self.db_file.name).unlink(missing_ok=True)
        except PermissionError:
            pass

    def _find_free_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def _wait_until_ready(self) -> None:
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                response = requests.get(f"{self.base_url}/health", timeout=1)
                if response.status_code == 200:
                    return
            except requests.RequestException:
                time.sleep(0.1)
        raise RuntimeError("Server did not start in time")

    def test_login_me_logout_and_protected_endpoints(self):
        login_response = self.session.post(
            f"{self.base_url}/api/auth/login",
            json={"username": "admin", "password": "Admin123!Test"},
            timeout=5,
        )
        self.assertEqual(login_response.status_code, 200)
        csrf_token = login_response.headers.get("X-CSRF-Token")
        self.assertTrue(csrf_token)

        me_response = self.session.get(f"{self.base_url}/api/auth/me", timeout=5)
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["username"], "admin")
        self.assertEqual(me_response.headers.get("X-CSRF-Token"), csrf_token)

        ingest_response = self.session.post(f"{self.base_url}/api/logs", json=self.demo_logs, timeout=5)
        self.assertEqual(ingest_response.status_code, 200)
        self.assertEqual(ingest_response.json()["saved"], len(self.demo_logs))

        logs_response = self.session.get(f"{self.base_url}/api/logs?limit=20", timeout=5)
        self.assertEqual(logs_response.status_code, 200)
        self.assertGreaterEqual(len(logs_response.json()), len(self.demo_logs))

        stats_response = self.session.get(f"{self.base_url}/api/stats", timeout=5)
        self.assertEqual(stats_response.status_code, 200)
        self.assertEqual(stats_response.json()["total_events"], len(self.demo_logs))

        incidents_response = self.session.get(f"{self.base_url}/api/incidents", timeout=5)
        self.assertEqual(incidents_response.status_code, 200)
        self.assertGreaterEqual(len(incidents_response.json()), 1)

        forbidden_logout = self.session.post(f"{self.base_url}/api/auth/logout", timeout=5)
        self.assertEqual(forbidden_logout.status_code, 403)

        logout_response = self.session.post(
            f"{self.base_url}/api/auth/logout",
            headers={"X-CSRF-Token": csrf_token},
            timeout=5,
        )
        self.assertEqual(logout_response.status_code, 200)

    def test_requires_auth_for_stats(self):
        response = requests.get(f"{self.base_url}/api/stats", timeout=5)
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
