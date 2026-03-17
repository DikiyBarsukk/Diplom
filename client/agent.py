"""
РњРѕРґСѓР»СЊ РґР»СЏ СЃР±РѕСЂР° Р»РѕРіРѕРІ Р»РѕРєР°Р»СЊРЅРѕ (РєР»РёРµРЅС‚-Р°РіРµРЅС‚).
РџРѕРґРґРµСЂР¶РёРІР°РµС‚ Windows Event Log Рё Linux journalctl.
"""
import json
import platform
import subprocess
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from common.log_utils import get_hostname, iter_journal_json, read_file_tail


def get_windows_event_logs(limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    if platform.system().lower() != "windows":
        return []

    try:
        import win32evtlog
        import win32evtlogutil
    except ImportError:
        return _get_windows_logs_powershell(limit, since)

    results: List[Dict[str, Any]] = []
    host = get_hostname()
    since_time = None
    if since:
        try:
            if "ago" in since.lower():
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

    log_types = [
        ("System", win32evtlog.EVENTLOG_SYSTEM_TYPE),
        ("Application", win32evtlog.EVENTLOG_APPLICATION_TYPE),
        ("Security", win32evtlog.EVENTLOG_SECURITY_TYPE),
    ]

    for log_type, _ in log_types:
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
                if since_time:
                    try:
                        event_timestamp = datetime.fromtimestamp(event.TimeGenerated.timestamp())
                        if event_timestamp < since_time:
                            continue
                    except Exception:
                        pass
                try:
                    results.append(
                        {
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
                    )
                    count += 1
                except Exception:
                    continue

            win32evtlog.CloseEventLog(hand)
        except Exception:
            continue

    return results[:limit]


def _get_windows_logs_powershell(limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    host = get_hostname()
    results: List[Dict[str, Any]] = []
    ps_cmd = f"""
    Get-WinEvent -LogName System,Application,Security -MaxEvents {limit} |
    ForEach-Object {{
        @{{
            TimeGenerated = $_.TimeCreated.ToString(\"o\")
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
        )
        stdout, _ = proc.communicate(timeout=30)
        if proc.returncode == 0 and stdout:
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


def collect_logs(source: str = "auto", limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    host = get_hostname()
    system = platform.system().lower()

    if source == "auto":
        if system == "windows":
            source = "eventlog"
        elif system == "linux":
            source = "journal"
        else:
            source = "file"

    if source == "eventlog" and system == "windows":
        return get_windows_event_logs(limit=limit, since=since)

    if source == "journal" and system == "linux":
        events = list(iter_journal_json(limit=limit, since=since))
        return [{**event, "host": host} for event in events]

    if source == "file" and system == "linux":
        default_paths = ["/var/log/syslog", "/var/log/messages", "/var/log/auth.log"]
        events = read_file_tail(default_paths, limit=limit)
        return [{**event, "host": host} for event in events]

    return []

