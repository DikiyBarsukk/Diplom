"""
Модуль для аутентификации и авторизации пользователей.
Реализует продвинутые механизмы информационной безопасности.
"""
import logging
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Iterator, Optional, Dict, Any, List, Tuple
from pathlib import Path

from server.security import (
    PasswordSecurity, RateLimiter, CSRFProtection, 
    InputSanitizer
)

# Настройка логирования
logger = logging.getLogger(__name__)


class AuthManager:
    """
    Управление аутентификацией и авторизацией пользователей.
    
    Реализует продвинутые механизмы безопасности:
    - bcrypt для хеширования паролей (12 раундов)
    - Защита от timing attacks через constant-time операции
    - Rate limiting для защиты от brute force (5 попыток за 5 минут)
    - Валидация и санитизация входных данных
    - Управление сессиями с ротацией (одна активная сессия на пользователя)
    - CSRF защита через токены
    - Аудит всех действий пользователей
    
    Поддерживаемые роли:
    - admin: полный доступ (read, write, delete, manage_users)
    - auditor: только чтение (read)
    - guest: только чтение (read)
    
    Example:
        >>> auth = AuthManager(db_path="logs.db")
        >>> user, error = auth.authenticate("admin", "Admin123!@#")
        >>> if user:
        ...     session = auth.create_session(user['id'], user['username'])
        ...     print(session['session_token'])
    """
    
    ROLES = {
        'admin': ['read', 'write', 'delete', 'manage_users'],
        'auditor': ['read'],
        'guest': ['read']
    }
    
    def __init__(self, db_path: str = "logs.db"):
        """
        Инициализирует менеджер аутентификации.
        
        Args:
            db_path (str): Путь к файлу базы данных SQLite.
                По умолчанию "logs.db" в текущей директории.
        
        Note:
            При первом запуске автоматически:
            - Создаются таблицы users, sessions, audit_log
            - Создается пользователь по умолчанию (admin/Admin123!@#)
        """
        self.db_path = db_path
        self.rate_limiter = RateLimiter()
        self._init_db()
        self._create_default_user()
    
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
        """Инициализирует таблицы для пользователей и сессий."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # Таблица пользователей
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'auditor',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_login TEXT,
                    failed_login_attempts INTEGER DEFAULT 0,
                    locked_until TEXT,
                    password_changed_at TEXT
                )
            """)
            
            # Таблица сессий
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    csrf_token TEXT,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_activity TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ip_address TEXT,
                    user_agent TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            
            # Таблица аудита действий
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT,
                    action TEXT NOT NULL,
                    resource TEXT,
                    details TEXT,
                    ip_address TEXT,
                    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            
            # Индексы
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)")
            
            conn.commit()
    
    def _create_default_user(self) -> None:
        """Создает пользователя по умолчанию, если его нет."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            # Создаем админа: admin/Admin123!@#
            # Используем безопасный пароль для демонстрации
            password_hash = PasswordSecurity.hash_password("Admin123!@#")
            cursor.execute("""
                INSERT INTO users (username, password_hash, role, password_changed_at)
                VALUES (?, ?, ?, ?)
            """, ("admin", password_hash, "admin", datetime.utcnow().isoformat()))
            conn.commit()
        
        conn.close()
    
    def _hash_password(self, password: str) -> str:
        """
        Хеширует пароль с использованием bcrypt.
        
        Args:
            password: Пароль для хеширования
            
        Returns:
            Хешированный пароль
        """
        return PasswordSecurity.hash_password(password)
    
    def authenticate(self, username: str, password: str, 
                    ip_address: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Аутентифицирует пользователя с защитой от brute force атак.
        
        Args:
            username: Имя пользователя
            password: Пароль
            ip_address: IP адрес клиента (для rate limiting)
            
        Returns:
            (user_dict, error_message)
        """
        # Валидация и санитизация входных данных
        is_valid_username, username_error = InputSanitizer.validate_username(username)
        if not is_valid_username:
            return None, username_error or "Недопустимое имя пользователя"
        
        username = InputSanitizer.sanitize_string(username, max_length=50)
        
        # Rate limiting по IP и username
        rate_limit_key = f"{ip_address or 'unknown'}:{username}"
        is_allowed, retry_after = self.rate_limiter.check_rate_limit(
            rate_limit_key, max_attempts=5, window_seconds=300
        )
        
        if not is_allowed:
            self.rate_limiter.record_attempt(rate_limit_key, False)
            return None, f"Слишком много неудачных попыток. Попробуйте через {retry_after} секунд"
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Проверяем блокировку аккаунта
        cursor.execute("""
            SELECT id, username, role, password_hash, locked_until, failed_login_attempts
            FROM users WHERE username = ?
        """, (username,))
        
        user_row = cursor.fetchone()
        
        if not user_row:
            # Пользователь не найден - все равно проверяем пароль для защиты от timing attacks
            # Используем фиктивный хеш для постоянного времени выполнения
            dummy_hash = PasswordSecurity.hash_password("dummy")
            PasswordSecurity.verify_password(password, dummy_hash)
            self.rate_limiter.record_attempt(rate_limit_key, False)
            conn.close()
            return None, "Неверное имя пользователя или пароль"
        
        user_id, db_username, role, password_hash, locked_until, failed_attempts = user_row
        
        # Проверяем блокировку аккаунта
        if locked_until:
            lock_time = datetime.fromisoformat(locked_until)
            if lock_time > datetime.utcnow():
                remaining_seconds = int((lock_time - datetime.utcnow()).total_seconds())
                conn.close()
                return None, f"Аккаунт заблокирован. Попробуйте через {remaining_seconds} секунд"
        
        # Проверяем пароль с защитой от timing attacks
        is_valid = PasswordSecurity.verify_password(password, password_hash)
        
        if is_valid:
            # Успешная аутентификация
            now = datetime.utcnow().isoformat()
            cursor.execute("""
                UPDATE users 
                SET last_login = ?, failed_login_attempts = 0, locked_until = NULL
                WHERE id = ?
            """, (now, user_id))
            conn.commit()
            conn.close()
            
            self.rate_limiter.record_attempt(rate_limit_key, True)
            
            return {
                "id": user_id,
                "username": db_username,
                "role": role
            }, None
        else:
            # Неудачная аутентификация
            failed_attempts += 1
            locked_until = None
            
            # Блокируем аккаунт после 5 неудачных попыток на 30 минут
            if failed_attempts >= 5:
                locked_until = (datetime.utcnow() + timedelta(minutes=30)).isoformat()
            
            cursor.execute("""
                UPDATE users 
                SET failed_login_attempts = ?, locked_until = ?
                WHERE id = ?
            """, (failed_attempts, locked_until, user_id))
            conn.commit()
            conn.close()
            
            self.rate_limiter.record_attempt(rate_limit_key, False)
            
            if locked_until:
                return None, "Аккаунт заблокирован из-за множественных неудачных попыток входа"
            return None, "Неверное имя пользователя или пароль"
    
    def create_session(self, user_id: int, username: str, 
                      ip_address: Optional[str] = None,
                      user_agent: Optional[str] = None) -> Dict[str, str]:
        """
        Создает сессию для пользователя с CSRF токеном.
        
        Args:
            user_id: ID пользователя
            username: Имя пользователя
            ip_address: IP адрес клиента
            user_agent: User-Agent заголовок
            
        Returns:
            Словарь с session_token и csrf_token
        """
        # Генерируем токены
        session_token = secrets.token_urlsafe(32)
        csrf_token = CSRFProtection.generate_token()
        expires_at = datetime.utcnow() + timedelta(hours=24)
        now = datetime.utcnow().isoformat()
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Инвалидируем старые сессии пользователя (ротация сессий)
        cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        
        cursor.execute("""
            INSERT INTO sessions (user_id, token, csrf_token, expires_at, 
                                ip_address, user_agent, last_activity)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (user_id, session_token, csrf_token, expires_at.isoformat(),
              ip_address, user_agent, now))
        
        conn.commit()
        conn.close()
        
        return {
            "session_token": session_token,
            "csrf_token": csrf_token
        }
    
    def validate_session(self, token: str, update_activity: bool = True) -> Optional[Dict[str, Any]]:
        """
        Проверяет валидность сессии и обновляет время активности.
        
        Args:
            token: Токен сессии
            update_activity: Обновлять ли время последней активности
            
        Returns:
            Информация о пользователе или None
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Удаляем истекшие сессии
        cursor.execute("DELETE FROM sessions WHERE expires_at < ?", 
                      (datetime.utcnow().isoformat(),))
        
        cursor.execute("""
            SELECT s.user_id, u.username, u.role, s.csrf_token, s.last_activity
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        """, (token, datetime.utcnow().isoformat()))
        
        result = cursor.fetchone()
        
        if result:
            user_id, username, role, csrf_token, last_activity = result
            
            # Обновляем время активности (не чаще раза в минуту)
            if update_activity:
                try:
                    last_activity_time = datetime.fromisoformat(last_activity)
                    if (datetime.utcnow() - last_activity_time).total_seconds() > 60:
                        cursor.execute("""
                            UPDATE sessions SET last_activity = ? WHERE token = ?
                        """, (datetime.utcnow().isoformat(), token))
                except Exception:
                    pass
            
            conn.commit()
            conn.close()
            
            return {
                "id": user_id,
                "username": username,
                "role": role,
                "csrf_token": csrf_token
            }
        
        conn.commit()
        conn.close()
        return None
    
    def validate_csrf_token(self, session_token: str, csrf_token: str) -> bool:
        """
        Проверяет CSRF токен для сессии.
        
        Args:
            session_token: Токен сессии
            csrf_token: CSRF токен из запроса
            
        Returns:
            True если токен валиден
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT csrf_token FROM sessions
            WHERE token = ? AND expires_at > ?
        """, (session_token, datetime.utcnow().isoformat()))
        
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return False
        
        stored_csrf_token = result[0]
        return CSRFProtection.validate_token(csrf_token, stored_csrf_token)
    
    def logout(self, token: str) -> bool:
        """Удаляет сессию."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        deleted = cursor.rowcount > 0
        
        conn.commit()
        conn.close()
        return deleted
    
    def has_permission(self, role: str, permission: str) -> bool:
        """Проверяет наличие разрешения у роли."""
        return permission in self.ROLES.get(role, [])
    
    def log_action(self, user_id: Optional[int], username: Optional[str], 
                   action: str, resource: Optional[str] = None,
                   details: Optional[str] = None, ip_address: Optional[str] = None) -> None:
        """Логирует действие пользователя."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO audit_log (user_id, username, action, resource, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, username, action, resource, details, ip_address))
        
        conn.commit()
        conn.close()
    
    def get_audit_log(self, limit: int = 100, offset: int = 0,
                     user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Получает журнал аудита."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            # Строим запрос без использования f-string для безопасности
            query = "SELECT * FROM audit_log"
            params = []
            
            conditions = []
            if user_id:
                conditions.append("user_id = ?")
                params.append(user_id)
            
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            
            query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()
            
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting audit log: {e}", exc_info=True)
            conn.close()
            return []
    
    def create_user(self, username: str, password: str, role: str = "auditor") -> Tuple[bool, Optional[str]]:
        """
        Создает нового пользователя с валидацией.
        
        Args:
            username: Имя пользователя
            password: Пароль
            role: Роль пользователя
            
        Returns:
            (success, error_message)
        """
        # Валидация имени пользователя
        is_valid, error = InputSanitizer.validate_username(username)
        if not is_valid:
            return False, error
        
        # Валидация пароля
        is_valid, error = PasswordSecurity.validate_password_strength(password)
        if not is_valid:
            return False, error
        
        # Проверка роли
        if role not in self.ROLES:
            return False, f"Недопустимая роль: {role}"
        
        # Санитизация
        username = InputSanitizer.sanitize_string(username, max_length=50)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            password_hash = self._hash_password(password)
            now = datetime.utcnow().isoformat()
            cursor.execute("""
                INSERT INTO users (username, password_hash, role, password_changed_at)
                VALUES (?, ?, ?, ?)
            """, (username, password_hash, role, now))
            conn.commit()
            conn.close()
            return True, None
        except sqlite3.IntegrityError:
            conn.rollback()
            conn.close()
            return False, "Пользователь с таким именем уже существует"
        except Exception as e:
            conn.rollback()
            conn.close()
            return False, f"Ошибка при создании пользователя: {str(e)}"
    
    def list_users(self) -> List[Dict[str, Any]]:
        """Возвращает список пользователей."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("SELECT id, username, role, created_at, last_login FROM users")
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]

