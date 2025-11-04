import datetime
import hashlib
from typing import Any, Dict


def iso_utc_now() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def normalize_event(raw_event: Dict[str, Any], source: str, host: str) -> Dict[str, Any]:
    """
    Нормализует событие из разных источников (Linux journalctl, Windows Event Log, файлы).
    """
    ts = _extract_timestamp(raw_event)
    
    # Поддержка разных форматов сообщений
    message = (
        raw_event.get("MESSAGE") or 
        raw_event.get("message") or 
        raw_event.get("Message") or 
        ""
    )
    message = str(message)
    
    # Поддержка разных источников unit/process
    unit = (
        raw_event.get("_SYSTEMD_UNIT") or 
        raw_event.get("SYSLOG_IDENTIFIER") or 
        raw_event.get("unit") or
        raw_event.get("SourceName") or
        raw_event.get("LogName")
    )
    
    # Поддержка разных источников process
    process = (
        raw_event.get("SYSLOG_IDENTIFIER") or 
        raw_event.get("process") or
        raw_event.get("SourceName")
    )
    
    # Поддержка разных источников PID
    pid = _safe_int(
        raw_event.get("_PID") or 
        raw_event.get("pid") or
        raw_event.get("ProcessId")
    )
    
    # Поддержка разных источников UID
    uid = _safe_int(
        raw_event.get("_UID") or 
        raw_event.get("uid") or
        raw_event.get("UserId")
    )
    
    # Поддержка разных источников severity/priority
    severity = _map_priority(
        raw_event.get("PRIORITY") or 
        raw_event.get("severity") or
        raw_event.get("EventType") or
        raw_event.get("LevelDisplayName")
    )

    base = {
        "ts": ts,
        "host": host,
        "source": source,
        "unit": unit,
        "process": process,
        "pid": pid,
        "uid": uid,
        "severity": severity,
        "message": message,
        "raw": raw_event,
        "ingest_ts": iso_utc_now(),
    }

    digest = hashlib.sha1((f"{ts}|{host}|{unit}|{pid}|{message}").encode("utf-8")).hexdigest()
    base["hash"] = digest
    return base


def _extract_timestamp(raw_event: Dict[str, Any]) -> str:
    """
    Извлекает timestamp из события в разных форматах.
    Поддерживает journalctl, Windows Event Log, и другие форматы.
    """
    # Linux journalctl - __REALTIME_TIMESTAMP (микросекунды)
    if "__REALTIME_TIMESTAMP" in raw_event:
        try:
            micros = int(raw_event["__REALTIME_TIMESTAMP"])  # type: ignore[arg-type]
            dt = datetime.datetime.fromtimestamp(micros / 1_000_000, tz=datetime.timezone.utc)
            return dt.isoformat()
        except Exception:
            pass
    
    # Windows Event Log - TimeGenerated (ISO строка или datetime)
    if "TimeGenerated" in raw_event:
        try:
            ts = raw_event["TimeGenerated"]
            if isinstance(ts, str):
                # Парсим ISO строку
                if "T" in ts:
                    dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    return dt.isoformat()
            elif hasattr(ts, "isoformat"):
                # datetime объект
                return ts.isoformat()
        except Exception:
            pass
    
    # Общие форматы
    if "ts" in raw_event:
        ts = raw_event["ts"]
        if isinstance(ts, str):
            return ts
        if hasattr(ts, "isoformat"):
            return ts.isoformat()
    
    if "@timestamp" in raw_event:
        return str(raw_event["@timestamp"])
    
    return iso_utc_now()


def _map_priority(priority: Any) -> str:
    """
    Маппинг приоритета/уровня важности из разных источников.
    Поддерживает Linux syslog priority (0-7) и Windows Event Log levels.
    """
    # Если это строка, пробуем найти соответствие
    if isinstance(priority, str):
        priority_lower = priority.lower()
        
        # Windows Event Log уровни
        if "critical" in priority_lower or "error" in priority_lower:
            return "err"
        if "warning" in priority_lower:
            return "warn"
        if "information" in priority_lower or "info" in priority_lower:
            return "info"
        if "verbose" in priority_lower or "debug" in priority_lower:
            return "debug"
        
        # Если уже в правильном формате
        if priority_lower in ["emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"]:
            return priority_lower
    
    # Числовые значения (Linux syslog priority)
    try:
        val = int(priority)
    except Exception:
        return str(priority or "info")
    
    mapping = {
        0: "emerg",
        1: "alert",
        2: "crit",
        3: "err",
        4: "warn",
        5: "notice",
        6: "info",
        7: "debug",
    }
    return mapping.get(val, "info")


def _safe_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None




