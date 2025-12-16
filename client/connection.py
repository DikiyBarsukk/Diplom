import logging
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)


class ServerClient:
    """
    Клиент для подключения к серверу аудита логов.
    Используется для получения логов из базы данных сервера.
    """
    def __init__(self, base_url: str, timeout_sec: int = 10) -> None:
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout_sec

    def health(self) -> Dict[str, Any]:
        """Проверяет доступность сервера."""
        try:
            resp = requests.get(f"{self.base_url}/health", timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error(f"Timeout connecting to {self.base_url}/health")
            raise
        except requests.RequestException as e:
            logger.error(f"Error connecting to server: {e}")
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
        """
        Получает логи из базы данных сервера с фильтрацией.
        
        Args:
            host: фильтр по хосту
            severity: фильтр по уровню важности (err, warn, info, debug и т.д.)
            since: фильтр по времени (ISO формат)
            search: поиск по содержимому сообщения
            limit: максимальное количество событий
            offset: смещение для пагинации
        
        Returns:
            Список нормализованных событий
        """
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
            resp = requests.get(f"{self.base_url}/logs", params=params, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
            assert isinstance(data, list)
            return data
        except requests.Timeout:
            logger.error(f"Timeout fetching logs from {self.base_url}/logs")
            raise
        except requests.RequestException as e:
            logger.error(f"Error fetching logs: {e}")
            raise

    def get_stats(self) -> Dict[str, Any]:
        """Получает статистику по логам."""
        try:
            resp = requests.get(f"{self.base_url}/stats", timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error(f"Timeout fetching stats from {self.base_url}/stats")
            raise
        except requests.RequestException as e:
            logger.error(f"Error fetching stats: {e}")
            raise

    def send_logs(self, logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Отправляет логи на сервер (используется агентом).
        
        Args:
            logs: список сырых событий для отправки
        
        Returns:
            Результат сохранения (saved, skipped)
        """
        try:
            resp = requests.post(
                f"{self.base_url}/logs",
                json=logs,
                timeout=self.timeout * 3  # Больший таймаут для отправки
            )
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout:
            logger.error(f"Timeout sending logs to {self.base_url}/logs")
            raise
        except requests.RequestException as e:
            logger.error(f"Error sending logs: {e}")
            raise






