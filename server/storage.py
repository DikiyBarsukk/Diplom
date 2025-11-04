"""
Модуль для хранения логов в базе данных SQLite.
"""
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


class LogStorage:
    """Хранилище логов в SQLite."""

    def __init__(self, db_path: str = "logs.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Инициализирует базу данных и создает таблицы."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Таблица для нормализованных событий
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT UNIQUE,
                ts TEXT NOT NULL,
                host TEXT NOT NULL,
                source TEXT NOT NULL,
                unit TEXT,
                process TEXT,
                pid INTEGER,
                uid INTEGER,
                severity TEXT NOT NULL,
                message TEXT NOT NULL,
                raw_data TEXT,
                ingest_ts TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Индексы для быстрого поиска
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_host ON events(host)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ts ON events(ts)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_severity ON events(severity)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hash ON events(hash)")

        conn.commit()
        conn.close()

    def store_event(self, event: Dict[str, Any]) -> bool:
        """
        Сохраняет одно событие в базу данных.
        
        Returns:
            True если событие сохранено, False если уже существует (дубликат)
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute("""
                INSERT INTO events (
                    hash, ts, host, source, unit, process, pid, uid,
                    severity, message, raw_data, ingest_ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event.get("hash"),
                event.get("ts"),
                event.get("host"),
                event.get("source"),
                event.get("unit"),
                event.get("process"),
                event.get("pid"),
                event.get("uid"),
                event.get("severity"),
                event.get("message"),
                str(event.get("raw", {})),
                event.get("ingest_ts"),
            ))
            conn.commit()
            inserted = cursor.rowcount > 0
            conn.close()
            return inserted
        except sqlite3.IntegrityError:
            # Дубликат по hash - это нормально
            conn.rollback()
            conn.close()
            return False
        except Exception:
            conn.rollback()
            conn.close()
            return False

    def store_events(self, events: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Сохраняет список событий.
        
        Returns:
            Словарь с количеством сохраненных и пропущенных событий
        """
        saved = 0
        skipped = 0

        for event in events:
            if self.store_event(event):
                saved += 1
            else:
                skipped += 1

        return {"saved": saved, "skipped": skipped}

    def get_events(
        self,
        host: Optional[str] = None,
        severity: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Получает события из базы данных с фильтрацией.
        
        Args:
            host: фильтр по хосту
            severity: фильтр по уровню важности
            since: фильтр по времени (ISO формат)
            limit: максимальное количество событий
            offset: смещение для пагинации
        
        Returns:
            Список событий
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        conditions = []
        params = []

        if host:
            conditions.append("host = ?")
            params.append(host)

        if severity:
            conditions.append("severity = ?")
            params.append(severity)

        if since:
            conditions.append("ts >= ?")
            params.append(since)

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        query = f"""
            SELECT * FROM events
            {where_clause}
            ORDER BY ts DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        # Преобразуем Row объекты в словари
        events = []
        for row in rows:
            event = dict(row)
            # Восстанавливаем raw_data из строки
            try:
                import json
                event["raw"] = json.loads(event.get("raw_data", "{}"))
            except Exception:
                event["raw"] = {}
            events.append(event)

        return events

    def get_stats(self) -> Dict[str, Any]:
        """Возвращает статистику по событиям."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        stats: Dict[str, Any] = {}

        # Общее количество событий
        cursor.execute("SELECT COUNT(*) FROM events")
        stats["total_events"] = cursor.fetchone()[0]

        # Количество по хостам
        cursor.execute("SELECT host, COUNT(*) FROM events GROUP BY host")
        stats["hosts"] = {row[0]: row[1] for row in cursor.fetchall()}

        # Количество по уровням важности
        cursor.execute("SELECT severity, COUNT(*) FROM events GROUP BY severity")
        stats["severity"] = {row[0]: row[1] for row in cursor.fetchall()}

        # Последнее событие
        cursor.execute("SELECT MAX(ts) FROM events")
        last_ts = cursor.fetchone()[0]
        stats["last_event_time"] = last_ts

        conn.close()
        return stats

