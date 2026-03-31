import logging
import os
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_CLIENT_USERNAME = "admin"
DEFAULT_CLIENT_PASSWORD = "admin123"


class ServerClient:
    """Клиент для подключения к серверу аудита логов."""

    def __init__(self, base_url: str, timeout_sec: int = 10) -> None:
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout_sec
        self.session = requests.Session()
        self.username = os.getenv("BARSUKSIEM_CLIENT_USERNAME", DEFAULT_CLIENT_USERNAME)
        self.password = os.getenv("BARSUKSIEM_CLIENT_PASSWORD", DEFAULT_CLIENT_PASSWORD)
        self.using_default_credentials = (
            os.getenv("BARSUKSIEM_CLIENT_USERNAME") is None
            and os.getenv("BARSUKSIEM_CLIENT_PASSWORD") is None
        )
        self._authenticated = False

    def get_auth_mode_label(self) -> str:
        if self.using_default_credentials:
            return "Учетная запись: стандартная дипломная (admin / admin123)"
        return f"Учетная запись: из переменных окружения ({self.username})"

    def _ensure_authenticated(self) -> None:
        if self._authenticated:
            return
        if not self.username or not self.password:
            raise RuntimeError(
                "Protected API requires credentials. Set BARSUKSIEM_CLIENT_USERNAME and BARSUKSIEM_CLIENT_PASSWORD."
            )

        response = self.session.post(
            f"{self.base_url}/api/auth/login",
            json={"username": self.username, "password": self.password},
            timeout=self.timeout,
        )
        response.raise_for_status()
        self._authenticated = True

    def health(self) -> Dict[str, Any]:
        try:
            resp = self.session.get(f"{self.base_url}/health", timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error("Timeout connecting to %s/health", self.base_url)
            raise
        except requests.RequestException as exc:
            logger.error("Error connecting to server: %s", exc)
            raise

    def fetch_logs(
        self,
        host: Optional[str] = None,
        severity: Optional[str] = None,
        since: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        self._ensure_authenticated()
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if host:
            params["host"] = host
        if severity:
            params["severity"] = severity
        if since:
            params["since"] = since
        if search:
            params["search"] = search

        try:
            resp = self.session.get(f"{self.base_url}/api/logs", params=params, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            assert isinstance(data, list)
            return data
        except requests.Timeout:
            logger.error("Timeout fetching logs from %s/api/logs", self.base_url)
            raise
        except requests.RequestException as exc:
            logger.error("Error fetching logs: %s", exc)
            raise

    def get_stats(self) -> Dict[str, Any]:
        self._ensure_authenticated()
        try:
            resp = self.session.get(f"{self.base_url}/api/stats", timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error("Timeout fetching stats from %s/api/stats", self.base_url)
            raise
        except requests.RequestException as exc:
            logger.error("Error fetching stats: %s", exc)
            raise

    def send_logs(self, logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        try:
            resp = self.session.post(
                f"{self.base_url}/api/logs",
                json=logs,
                timeout=self.timeout * 3,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error("Timeout sending logs to %s/api/logs", self.base_url)
            raise
        except requests.RequestException as exc:
            logger.error("Error sending logs: %s", exc)
            raise
