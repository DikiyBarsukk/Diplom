import json
import os
import platform
import socket
import subprocess
from typing import Any, Dict, Iterable, List, Optional


def _hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "unknown-host"


def iter_journal_json(limit: int = 200, since: Optional[str] = None) -> Iterable[Dict[str, Any]]:
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


def get_logs(source: str, limit: int = 200, since: Optional[str] = None) -> List[Dict[str, Any]]:
    host = _hostname()
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




