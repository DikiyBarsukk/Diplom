from typing import Any, Dict, List, Optional

import requests


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
        resp = requests.get(f"{self.base_url}/health", timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def fetch_logs(
        self,
        host: Optional[str] = None,
        severity: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Получает логи из базы данных сервера с фильтрацией.
        
        Args:
            host: фильтр по хосту
            severity: фильтр по уровню важности (err, warn, info, debug и т.д.)
            since: фильтр по времени (ISO формат)
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
        
        resp = requests.get(f"{self.base_url}/logs", params=params, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        assert isinstance(data, list)
        return data

    def get_stats(self) -> Dict[str, Any]:
        """Получает статистику по логам."""
        resp = requests.get(f"{self.base_url}/stats", timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def send_logs(self, logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Отправляет логи на сервер (используется агентом).
        
        Args:
            logs: список сырых событий для отправки
        
        Returns:
            Результат сохранения (saved, skipped)
        """
        resp = requests.post(
            f"{self.base_url}/logs",
            json=logs,
            timeout=self.timeout * 3  # Больший таймаут для отправки
        )
        resp.raise_for_status()
        return resp.json()






