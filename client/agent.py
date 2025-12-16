"""
Модуль для сбора логов локально (клиент-агент).
Поддерживает Windows Event Log и Linux journalctl.
"""
import json
import os
import platform
import socket
import subprocess
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from common.log_utils import get_hostname, iter_journal_json, read_file_tail


def get_windows_event_logs(limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Собирает логи из Windows Event Log.
    Использует win32evtlog через pywin32.
    """
    if platform.system().lower() != "windows":
        return []

    try:
        import win32evtlog
        import win32evtlogutil
        import win32security
        import win32con
    except ImportError:
        # Если pywin32 не установлен, пробуем использовать PowerShell
        return _get_windows_logs_powershell(limit, since)

    results: List[Dict[str, Any]] = []
    host = get_hostname()

    # Определяем время для фильтрации
    since_time = None
    if since:
        try:
            # Парсим формат типа "2024-01-01T00:00:00" или "1 hour ago"
            if "ago" in since.lower():
                # Простой парсер для "1 hour ago", "2 days ago" и т.д.
                parts = since.lower().split()
                if len(parts) >= 3:
                    num = int(parts[0])
                    unit = parts[1]
                    if unit.startswith("hour"):
                        since_time = datetime.now() - timedelta(hours=num)
                    elif unit.startswith("day"):
                        since_time = datetime.now() - timedelta(days=num)
                    elif unit.startswith("minute"):
                        since_time = datetime.now() - timedelta(minutes=num)
            else:
                since_time = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except Exception:
            pass

    # Читаем события из разных журналов
    log_types = [
        ("System", win32evtlog.EVENTLOG_SYSTEM_TYPE),
        ("Application", win32evtlog.EVENTLOG_APPLICATION_TYPE),
        ("Security", win32evtlog.EVENTLOG_SECURITY_TYPE),
    ]

    for log_type, log_flag in log_types:
        try:
            hand = win32evtlog.OpenEventLog(None, log_type)
            if not hand:
                continue

            flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
            events = win32evtlog.ReadEventLog(hand, flags, 0)

            count = 0
            for event in events:
                if count >= limit:
                    break

                # Фильтр по времени
                if since_time:
                    event_time = win32evtlogutil.SafeFormatMessage(event, log_type)
                    # Пропускаем старые события (упрощенная проверка)
                    try:
                        event_timestamp = datetime.fromtimestamp(event.TimeGenerated.timestamp())
                        if event_timestamp < since_time:
                            continue
                    except Exception:
                        pass

                try:
                    event_dict = {
                        "TimeGenerated": event.TimeGenerated.isoformat() if hasattr(event.TimeGenerated, "isoformat") else str(event.TimeGenerated),
                        "EventID": event.EventID,
                        "EventType": event.EventType,
                        "EventCategory": event.EventCategory,
                        "SourceName": event.SourceName,
                        "ComputerName": event.ComputerName,
                        "Message": win32evtlogutil.SafeFormatMessage(event, log_type),
                        "host": host,
                        "log_type": log_type,
                    }
                    results.append(event_dict)
                    count += 1
                except Exception:
                    continue

            win32evtlog.CloseEventLog(hand)
        except Exception:
            continue

    # Ограничиваем результат
    return results[:limit]


def _get_windows_logs_powershell(limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Альтернативный метод сбора логов через PowerShell (если pywin32 недоступен).
    """
    host = get_hostname()
    results: List[Dict[str, Any]] = []

    # PowerShell команда для получения событий
    ps_cmd = f"""
    Get-WinEvent -LogName System,Application,Security -MaxEvents {limit} | 
    ForEach-Object {{
        @{{
            TimeGenerated = $_.TimeCreated.ToString("o")
            EventID = $_.Id
            EventType = $_.LevelDisplayName
            SourceName = $_.ProviderName
            ComputerName = $_.MachineName
            Message = $_.Message
            LogName = $_.LogName
        }}
    }} | ConvertTo-Json -Compress
    """

    try:
        proc = subprocess.Popen(
            ["powershell", "-Command", ps_cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True
        )
        stdout, stderr = proc.communicate(timeout=30)

        if proc.returncode == 0 and stdout:
            # PowerShell возвращает JSON объекты по одному на строку
            for line in stdout.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    event["host"] = host
                    event["log_type"] = event.get("LogName", "Unknown")
                    results.append(event)
                except Exception:
                    continue
    except Exception:
        pass

    return results[:limit]




def read_file_tail(paths: List[str], limit: int = 200) -> List[Dict[str, Any]]:
    """
    Читает последние строки из файлов логов (Linux).
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


def collect_logs(source: str = "auto", limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Собирает логи локально в зависимости от платформы.
    
    Args:
        source: "auto" (автоопределение), "journal" (Linux), "file" (Linux), "eventlog" (Windows)
        limit: максимальное количество событий
        since: фильтр по времени (ISO формат или "1 hour ago")
    
    Returns:
        Список сырых событий с полем "host"
    """
    host = get_hostname()
    system = platform.system().lower()

    # Автоопределение источника
    if source == "auto":
        if system == "windows":
            source = "eventlog"
        elif system == "linux":
            source = "journal"
        else:
            source = "file"

    # Сбор логов в зависимости от платформы
    if source == "eventlog" and system == "windows":
        return get_windows_event_logs(limit=limit, since=since)

    if source == "journal" and system == "linux":
        events = list(iter_journal_json(limit=limit, since=since))
        return [{**e, "host": host} for e in events]

    if source == "file" and system == "linux":
        default_paths = [
            "/var/log/syslog",
            "/var/log/messages",
            "/var/log/auth.log",
        ]
        events = read_file_tail(default_paths, limit=limit)
        return [{**e, "host": host} for e in events]

    return []

