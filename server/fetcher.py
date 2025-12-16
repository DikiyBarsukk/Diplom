from typing import Any, Dict, List, Optional

from common.log_utils import get_hostname, iter_journal_json, read_file_tail


def get_logs(source: str, limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Получает логи из указанного источника.
    
    Args:
        source: Источник логов ("journal" или "file")
        limit: Максимальное количество записей
        since: Фильтр по времени
    
    Returns:
        Список событий с добавленным полем host
    """
    host = get_hostname()
    if source == "journal":
        return [{**e, "host": host} for e in list(iter_journal_json(limit=limit, since=since))]

    if source == "file":
        default_paths = [
            "/var/log/syslog",
            "/var/log/messages",
            "/var/log/auth.log",
        ]
        return [{**e, "host": host} for e in read_file_tail(default_paths, limit=limit)]

    return []




