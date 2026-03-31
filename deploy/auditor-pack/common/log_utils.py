"""
Общие утилиты для работы с логами.
Используются как сервером, так и клиентами.
"""
import json
import os
import platform
import socket
import subprocess
from typing import Any, Dict, Iterable, List, Optional


def get_hostname() -> str:
    """
    Получает имя хоста системы.
    
    Returns:
        Имя хоста или "unknown-host" в случае ошибки
    """
    try:
        return socket.gethostname()
    except Exception:
        return "unknown-host"


def iter_journal_json(limit: int = 200, since: Optional[str] = None) -> Iterable[Dict[str, Any]]:
    """
    Итератор для чтения journalctl в формате JSON (Linux).
    
    Args:
        limit: Максимальное количество записей
        since: Фильтр по времени (формат journalctl)
    
    Returns:
        Итератор словарей с событиями
    """
    if platform.system().lower() != "linux":
        return iter(())

    cmd = [
        "journalctl",
        "-o",
        "json",
        "-n",
        str(max(1, limit)),
    ]
    if since:
        cmd.extend(["--since", since])

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError:
        return iter(())

    def _gen() -> Iterable[Dict[str, Any]]:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue

    return _gen()


def read_file_tail(paths: List[str], limit: int = 200) -> List[Dict[str, Any]]:
    """
    Читает последние строки из файлов логов (Linux).
    
    Args:
        paths: Список путей к файлам логов
        limit: Максимальное количество строк из каждого файла
    
    Returns:
        Список словарей с сообщениями и путями к файлам
    """
    results: List[Dict[str, Any]] = []
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()[-limit:]
            for line in lines:
                results.append({
                    "message": line.rstrip("\n"),
                    "path": path,
                })
        except Exception:
            continue
    return results

