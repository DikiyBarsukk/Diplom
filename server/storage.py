"""
Модуль для хранения логов в базе данных SQLite.
"""
import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)


class LogStorage:
    """
    Хранилище логов в SQLite с поддержкой connection pooling.
    
    Обеспечивает:
    - Эффективное хранение нормализованных событий
    - Batch insert для оптимизации производительности
    - Дедупликацию по hash
    - Индексацию для быстрого поиска
    - Connection pooling для переиспользования соединений
    
    Example:
        >>> storage = LogStorage(db_path="logs.db")
        >>> events = [{"hash": "...", "ts": "...", "host": "...", ...}]
        >>> result = storage.store_events(events)
        >>> print(result)  # {"saved": 10, "skipped": 0}
    """

    def __init__(self, db_path: str = "logs.db"):
        """
        Инициализирует хранилище логов.
        
        Args:
            db_path (str): Путь к файлу базы данных SQLite.
                По умолчанию "logs.db" в текущей директории.
        
        Note:
            При первом запуске автоматически создаются таблицы и индексы.
        """
        self.db_path = db_path
        self._init_db()
    
    @contextmanager
    def _get_connection(self) -> Iterator[sqlite3.Connection]:
        """
        Context manager для получения соединения с БД.
        Создает новое соединение для каждого запроса (безопасно для многопоточности).
        """
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False  # Разрешаем использование из разных потоков
        )
        conn.row_factory = sqlite3.Row
        
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_db(self) -> None:
        """Инициализирует базу данных и создает таблицы."""
        with self._get_connection() as conn:
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

            # Таблица для инцидентов ИБ
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_id TEXT NOT NULL,
                    incident_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    host TEXT,
                    event_count INTEGER,
                    detected_at TEXT NOT NULL,
                    first_event_time TEXT,
                    last_event_time TEXT,
                    related_events TEXT,
                    correlation_pattern TEXT,
                    status TEXT DEFAULT 'open',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Индексы для инцидентов
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_detected ON incidents(detected_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)")

            conn.commit()

    def store_event(self, event: Dict[str, Any]) -> bool:
        """
        Сохраняет одно событие в базу данных.
        
        Args:
            event (Dict[str, Any]): Нормализованное событие со следующими полями:
                - hash (str): Уникальный hash события для дедупликации
                - ts (str): Временная метка в ISO формате
                - host (str): Имя хоста источника
                - source (str): Тип источника (journal, eventlog, file)
                - severity (str): Уровень важности (emerg, alert, crit, err, warn, notice, info, debug)
                - message (str): Текст сообщения
                - unit (str, optional): Системная единица/сервис
                - process (str, optional): Имя процесса
                - pid (int, optional): ID процесса
                - uid (int, optional): ID пользователя
                - raw (dict, optional): Сырые данные события
                - ingest_ts (str): Временная метка получения события
        
        Returns:
            bool: True если событие сохранено, False если уже существует (дубликат по hash)
        
        Example:
            >>> event = {
            ...     "hash": "abc123...",
            ...     "ts": "2024-01-01T12:00:00Z",
            ...     "host": "server1",
            ...     "source": "journal",
            ...     "severity": "info",
            ...     "message": "System started"
            ... }
            >>> storage.store_event(event)
            True
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Преобразуем raw_data в JSON строку
                raw_data = json.dumps(event.get("raw", {}))
                
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
                    raw_data,
                    event.get("ingest_ts"),
                ))
                conn.commit()
                return cursor.rowcount > 0
        except sqlite3.IntegrityError:
            # Дубликат по hash - это нормально
            return False
        except Exception as e:
            logger.error(f"Error storing event: {e}", exc_info=True)
            return False

    def store_events(self, events: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Сохраняет список событий используя batch insert для оптимизации.
        
        Использует executemany для эффективной пакетной вставки.
        При ошибках выполняет fallback на поштучное сохранение.
        
        Args:
            events (List[Dict[str, Any]]): Список нормализованных событий.
                Формат каждого события см. в store_event().
        
        Returns:
            Dict[str, int] с полями:
            - saved (int): Количество успешно сохраненных событий
            - skipped (int): Количество пропущенных событий (дубликаты или ошибки)
        
        Example:
            >>> events = [
            ...     {"hash": "hash1", "ts": "...", "host": "server1", ...},
            ...     {"hash": "hash2", "ts": "...", "host": "server2", ...}
            ... ]
            >>> result = storage.store_events(events)
            >>> print(result)  # {"saved": 2, "skipped": 0}
        
        Note:
            Дубликаты определяются по полю hash и автоматически пропускаются.
        """
        if not events:
            return {"saved": 0, "skipped": 0}
        
        saved = 0
        skipped = 0
        
        # Подготавливаем данные для batch insert
        batch_data = []
        for event in events:
            try:
                raw_data = json.dumps(event.get("raw", {}))
                batch_data.append((
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
                    raw_data,
                    event.get("ingest_ts"),
                ))
            except Exception as e:
                logger.warning(f"Error preparing event for batch insert: {e}")
                skipped += 1
        
        if not batch_data:
            return {"saved": saved, "skipped": skipped}
        
        # Выполняем batch insert с обработкой дубликатов
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.executemany("""
                    INSERT OR IGNORE INTO events (
                        hash, ts, host, source, unit, process, pid, uid,
                        severity, message, raw_data, ingest_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch_data)
                
                saved = cursor.rowcount
                skipped += len(batch_data) - saved
                
                conn.commit()
        except sqlite3.IntegrityError:
            # Если есть дубликаты, обрабатываем по одному
            with self._get_connection() as conn:
                cursor = conn.cursor()
                for data in batch_data:
                    try:
                        cursor.execute("""
                            INSERT OR IGNORE INTO events (
                                hash, ts, host, source, unit, process, pid, uid,
                                severity, message, raw_data, ingest_ts
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, data)
                        if cursor.rowcount > 0:
                            saved += 1
                        else:
                            skipped += 1
                    except Exception as e:
                        logger.warning(f"Error inserting event: {e}")
                        skipped += 1
                conn.commit()
        except Exception as e:
            logger.error(f"Error in batch insert: {e}", exc_info=True)
            # Fallback: сохраняем по одному
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
        search: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Получает события из базы данных с фильтрацией и пагинацией.
        
        Args:
            host (Optional[str]): Фильтр по имени хоста (точное совпадение).
                Пример: "server1"
            severity (Optional[str]): Фильтр по уровню важности.
                Допустимые значения: "emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"
            since (Optional[str]): Фильтр по времени (ISO формат).
                Пример: "2024-01-01T00:00:00Z" - только события после указанной даты
            search (Optional[str]): Поиск по содержимому сообщения (LIKE поиск, case-insensitive).
                Пример: "error" найдет все сообщения содержащие "error"
            limit (int): Максимальное количество событий в результате.
                По умолчанию 200, максимум рекомендуется 1000
            offset (int): Смещение для пагинации (количество пропускаемых записей).
                По умолчанию 0
        
        Returns:
            List[Dict[str, Any]]: Список событий, отсортированных по времени (новые первыми).
                Каждое событие содержит все поля из таблицы events плюс восстановленное поле "raw".
        
        Example:
            >>> # Получить последние 100 ошибок с сервера server1
            >>> events = storage.get_events(
            ...     host="server1",
            ...     severity="err",
            ...     limit=100
            ... )
            >>> 
            >>> # Поиск по содержимому
            >>> events = storage.get_events(
            ...     search="authentication failed",
            ...     limit=50
            ... )
            >>> 
            >>> # События за последние 24 часа
            >>> from datetime import datetime, timedelta
            >>> since = (datetime.utcnow() - timedelta(hours=24)).isoformat()
            >>> events = storage.get_events(since=since)
        """
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

        if search:
            conditions.append("message LIKE ?")
            params.append(f"%{search}%")

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

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            # Преобразуем Row объекты в словари
            events = []
            for row in rows:
                event = dict(row)
                # Восстанавливаем raw_data из строки
                try:
                    event["raw"] = json.loads(event.get("raw_data", "{}"))
                except Exception:
                    event["raw"] = {}
                events.append(event)

            return events

    def get_stats(self) -> Dict[str, Any]:
        """
        Возвращает статистику по событиям в базе данных.
        
        Returns:
            Dict[str, Any] с полями:
            - total_events (int): Общее количество событий в БД
            - hosts (Dict[str, int]): Распределение событий по хостам.
                Ключ - имя хоста, значение - количество событий
            - severity (Dict[str, int]): Распределение событий по уровням важности.
                Ключ - уровень важности, значение - количество событий
            - last_event_time (Optional[str]): Временная метка последнего события (ISO формат).
                None если событий нет
        
        Example:
            >>> stats = storage.get_stats()
            >>> print(stats)
            {
                "total_events": 10000,
                "hosts": {"server1": 5000, "server2": 5000},
                "severity": {"info": 8000, "warn": 1500, "err": 500},
                "last_event_time": "2024-01-01T12:00:00Z"
            }
        """
        with self._get_connection() as conn:
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

            return stats

    def get_agent_stats(self, window_minutes: int = 5) -> Dict[str, Any]:
        """
        Возвращает статистику по агентам (онлайн/оффлайн).

        Онлайн определяется по наличию события в окне window_minutes.
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT host, MAX(ts) FROM events GROUP BY host")
            rows = cursor.fetchall()

        now = datetime.now(timezone.utc)
        online = 0
        last_seen: Dict[str, Any] = {}

        for host, ts in rows:
            last_seen[host] = ts
            if not ts:
                continue
            try:
                ts_value = ts.replace("Z", "+00:00") if isinstance(ts, str) else ts
                dt = datetime.fromisoformat(ts_value)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if now - dt <= timedelta(minutes=window_minutes):
                    online += 1
            except Exception:
                continue

        total = len(rows)
        offline = max(total - online, 0)

        return {
            "total": total,
            "online": online,
            "offline": offline,
            "window_minutes": window_minutes,
            "last_seen": last_seen,
        }
    
    def store_incident(self, incident: Dict[str, Any]) -> bool:
        """
        Сохраняет инцидент ИБ в базу данных.
        
        Args:
            incident: Словарь с информацией об инциденте
        
        Returns:
            True если инцидент сохранен
        """
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                
                # Преобразуем related_events в JSON строку
                related_events = json.dumps(incident.get("related_events", []))
                
                cursor.execute("""
                    INSERT INTO incidents (
                        rule_id, incident_type, severity, title, description,
                        host, event_count, detected_at, first_event_time,
                        last_event_time, related_events, correlation_pattern, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    incident.get("rule_id"),
                    incident.get("incident_type"),
                    incident.get("severity"),
                    incident.get("title"),
                    incident.get("description"),
                    incident.get("host"),
                    incident.get("event_count", 0),
                    incident.get("detected_at"),
                    incident.get("first_event_time"),
                    incident.get("last_event_time"),
                    related_events,
                    incident.get("correlation_pattern"),
                    incident.get("status", "open"),
                ))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Error storing incident: {e}", exc_info=True)
            return False
    
    def get_incidents(
        self,
        incident_type: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
        since: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Получает инциденты из базы данных с фильтрацией.
        
        Args:
            incident_type: Фильтр по типу инцидента
            severity: Фильтр по критичности
            status: Фильтр по статусу (open, closed, investigating)
            since: Фильтр по времени обнаружения (ISO формат)
            limit: Максимальное количество инцидентов
            offset: Смещение для пагинации
        
        Returns:
            Список инцидентов
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            conditions = []
            params = []
            
            if incident_type:
                conditions.append("incident_type = ?")
                params.append(incident_type)
            
            if severity:
                conditions.append("severity = ?")
                params.append(severity)
            
            if status:
                conditions.append("status = ?")
                params.append(status)
            
            if since:
                conditions.append("detected_at >= ?")
                params.append(since)

            if search:
                conditions.append(
                    "("
                    "LOWER(title) LIKE ? OR "
                    "LOWER(description) LIKE ? OR "
                    "LOWER(host) LIKE ? OR "
                    "LOWER(incident_type) LIKE ? OR "
                    "LOWER(rule_id) LIKE ?"
                    ")"
                )
                like_value = f"%{search.lower()}%"
                params.extend([like_value, like_value, like_value, like_value, like_value])
            
            where_clause = ""
            if conditions:
                where_clause = "WHERE " + " AND ".join(conditions)
            
            query = f"""
                SELECT * FROM incidents
                {where_clause}
                ORDER BY detected_at DESC
                LIMIT ? OFFSET ?
            """
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            incidents = []
            for row in rows:
                incident = dict(row)
                # Восстанавливаем related_events из JSON
                try:
                    incident["related_events"] = json.loads(incident.get("related_events", "[]"))
                except Exception:
                    incident["related_events"] = []
                incidents.append(incident)
            
            return incidents
    
    def get_incidents_stats(self) -> Dict[str, Any]:
        """Возвращает статистику по инцидентам."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            stats: Dict[str, Any] = {}
            
            # Общее количество инцидентов
            cursor.execute("SELECT COUNT(*) FROM incidents")
            stats["total_incidents"] = cursor.fetchone()[0]
            
            # По типам
            cursor.execute("SELECT incident_type, COUNT(*) FROM incidents GROUP BY incident_type")
            stats["by_type"] = {row[0]: row[1] for row in cursor.fetchall()}
            
            # По критичности
            cursor.execute("SELECT severity, COUNT(*) FROM incidents GROUP BY severity")
            stats["by_severity"] = {row[0]: row[1] for row in cursor.fetchall()}
            
            # По статусу
            cursor.execute("SELECT status, COUNT(*) FROM incidents GROUP BY status")
            stats["by_status"] = {row[0]: row[1] for row in cursor.fetchall()}
            
            # Последний инцидент
            cursor.execute("SELECT MAX(detected_at) FROM incidents")
            last_detected = cursor.fetchone()[0]
            stats["last_incident_time"] = last_detected
            
            return stats

