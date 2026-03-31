"""
Auth manager for BARSUKSIEM users, sessions and audit log.
"""
import logging
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, List, Optional, Tuple

from server.security import CSRFProtection, InputSanitizer, PasswordSecurity, RateLimiter
from server.time_utils import utc_now, utc_now_iso

logger = logging.getLogger(__name__)


class AuthManager:
    """Manage authentication, authorization and audit trail."""

    ROLES = {
        "admin": ["read", "write", "delete", "manage_users"],
        "auditor": ["read"],
        "guest": ["read"],
    }

    def __init__(
        self,
        db_path: str = "logs.db",
        bootstrap_admin_username: Optional[str] = None,
        bootstrap_admin_password: Optional[str] = None,
        demo_mode: bool = False,
    ):
        self.db_path = db_path
        self.rate_limiter = RateLimiter()
        self.bootstrap_admin_username = bootstrap_admin_username
        self.bootstrap_admin_password = bootstrap_admin_password
        self.demo_mode = demo_mode
        self._init_db()
        self._bootstrap_admin_user()

    @contextmanager
    def _get_connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
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
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
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
                """
            )
            cursor.execute(
                """
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
                """
            )
            cursor.execute(
                """
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
                """
            )
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)")

    def _generate_bootstrap_password(self) -> str:
        return f"Adm1n!{secrets.token_urlsafe(9)}"

    def _bootstrap_admin_user(self) -> None:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM users")
            if cursor.fetchone()[0] != 0:
                return

            username = self.bootstrap_admin_username or "admin"
            password = self.bootstrap_admin_password or self._generate_bootstrap_password()
            generated_password = self.bootstrap_admin_password is None
            password_hash = PasswordSecurity.hash_password(password)
            now = utc_now_iso()
            cursor.execute(
                """
                INSERT INTO users (username, password_hash, role, password_changed_at)
                VALUES (?, ?, ?, ?)
                """,
                (username, password_hash, "admin", now),
            )

            if generated_password:
                logger.warning(
                    "Bootstrap admin created. Username: %s Password: %s. Set BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD to control it explicitly.",
                    username,
                    password,
                )
            else:
                logger.warning(
                    "Bootstrap admin created from configuration for user %s%s",
                    username,
                    " (demo mode)" if self.demo_mode else "",
                )

    def _hash_password(self, password: str) -> str:
        return PasswordSecurity.hash_password(password)

    def authenticate(
        self,
        username: str,
        password: str,
        ip_address: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        is_valid_username, username_error = InputSanitizer.validate_username(username)
        if not is_valid_username:
            return None, username_error or "Invalid username"

        username = InputSanitizer.sanitize_string(username, max_length=50)
        rate_limit_key = f"{ip_address or 'unknown'}:{username}"
        is_allowed, retry_after = self.rate_limiter.check_rate_limit(
            rate_limit_key,
            max_attempts=5,
            window_seconds=300,
        )
        if not is_allowed:
            self.rate_limiter.record_attempt(rate_limit_key, False)
            return None, f"Too many failed login attempts. Retry after {retry_after} seconds"

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, username, role, password_hash, locked_until, failed_login_attempts
                FROM users WHERE username = ?
                """,
                (username,),
            )
            user_row = cursor.fetchone()

            if not user_row:
                dummy_hash = PasswordSecurity.hash_password("dummy")
                PasswordSecurity.verify_password(password, dummy_hash)
                self.rate_limiter.record_attempt(rate_limit_key, False)
                return None, "Invalid username or password"

            user_id, db_username, role, password_hash, locked_until, failed_attempts = user_row
            now = utc_now()
            if locked_until:
                try:
                    lock_time = datetime.fromisoformat(locked_until)
                except Exception:
                    lock_time = None
                if lock_time and lock_time > now:
                    remaining_seconds = int((lock_time - now).total_seconds())
                    return None, f"Account is locked. Retry after {remaining_seconds} seconds"

            is_valid = PasswordSecurity.verify_password(password, password_hash)
            if is_valid:
                cursor.execute(
                    """
                    UPDATE users
                    SET last_login = ?, failed_login_attempts = 0, locked_until = NULL
                    WHERE id = ?
                    """,
                    (now.isoformat(), user_id),
                )
                self.rate_limiter.record_attempt(rate_limit_key, True)
                return {"id": user_id, "username": db_username, "role": role}, None

            failed_attempts += 1
            new_locked_until = None
            if failed_attempts >= 5:
                new_locked_until = (now + timedelta(minutes=30)).isoformat()
            cursor.execute(
                """
                UPDATE users
                SET failed_login_attempts = ?, locked_until = ?
                WHERE id = ?
                """,
                (failed_attempts, new_locked_until, user_id),
            )
            self.rate_limiter.record_attempt(rate_limit_key, False)

            if new_locked_until:
                return None, "Account is locked after repeated failed attempts"
            return None, "Invalid username or password"

    def create_session(
        self,
        user_id: int,
        username: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Dict[str, str]:
        session_token = secrets.token_urlsafe(32)
        csrf_token = CSRFProtection.generate_token()
        expires_at = utc_now() + timedelta(hours=24)
        now = utc_now_iso()

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            cursor.execute(
                """
                INSERT INTO sessions (user_id, token, csrf_token, expires_at, ip_address, user_agent, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, session_token, csrf_token, expires_at.isoformat(), ip_address, user_agent, now),
            )

        return {"session_token": session_token, "csrf_token": csrf_token}

    def validate_session(self, token: str, update_activity: bool = True) -> Optional[Dict[str, Any]]:
        now = utc_now()
        now_iso = now.isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso,))
            cursor.execute(
                """
                SELECT s.user_id, u.username, u.role, s.csrf_token, s.last_activity
                FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ? AND s.expires_at > ?
                """,
                (token, now_iso),
            )
            result = cursor.fetchone()
            if not result:
                return None

            user_id, username, role, csrf_token, last_activity = result
            if update_activity:
                try:
                    last_activity_time = datetime.fromisoformat(last_activity)
                    if (now - last_activity_time).total_seconds() > 60:
                        cursor.execute(
                            "UPDATE sessions SET last_activity = ? WHERE token = ?",
                            (now_iso, token),
                        )
                except Exception:
                    pass
            return {
                "id": user_id,
                "username": username,
                "role": role,
                "csrf_token": csrf_token,
            }

    def validate_csrf_token(self, session_token: str, csrf_token: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT csrf_token FROM sessions
                WHERE token = ? AND expires_at > ?
                """,
                (session_token, utc_now_iso()),
            )
            result = cursor.fetchone()
        if not result:
            return False
        return CSRFProtection.validate_token(csrf_token, result[0])

    def logout(self, token: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return cursor.rowcount > 0

    def has_permission(self, role: str, permission: str) -> bool:
        return permission in self.ROLES.get(role, [])

    def log_action(
        self,
        user_id: Optional[int],
        username: Optional[str],
        action: str,
        resource: Optional[str] = None,
        details: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO audit_log (user_id, username, action, resource, details, ip_address)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, username, action, resource, details, ip_address),
            )

    def get_audit_log(self, limit: int = 100, offset: int = 0, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
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
                return [dict(row) for row in rows]
        except Exception as exc:
            logger.error("Error getting audit log: %s", exc, exc_info=True)
            return []

    def create_user(self, username: str, password: str, role: str = "auditor") -> Tuple[bool, Optional[str]]:
        is_valid, error = InputSanitizer.validate_username(username)
        if not is_valid:
            return False, error

        is_valid, error = PasswordSecurity.validate_password_strength(password)
        if not is_valid:
            return False, error

        if role not in self.ROLES:
            return False, f"Invalid role: {role}"

        username = InputSanitizer.sanitize_string(username, max_length=50)
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                password_hash = self._hash_password(password)
                now = utc_now_iso()
                cursor.execute(
                    """
                    INSERT INTO users (username, password_hash, role, password_changed_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (username, password_hash, role, now),
                )
            return True, None
        except sqlite3.IntegrityError:
            return False, "User already exists"
        except Exception as exc:
            return False, f"Error creating user: {str(exc)}"

    def list_users(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, role, created_at, last_login FROM users")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
