"""
Модуль для реализации продвинутых механизмов информационной безопасности.
Демонстрирует навыки ИБ инженера.
"""
import bcrypt
import secrets
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
from functools import wraps
import re


class PasswordSecurity:
    """Класс для безопасной работы с паролями."""
    
    # Минимальные требования к паролю
    MIN_LENGTH = 8
    REQUIRE_UPPERCASE = True
    REQUIRE_LOWERCASE = True
    REQUIRE_DIGITS = True
    REQUIRE_SPECIAL = True
    
    @staticmethod
    def hash_password(password: str, rounds: int = 12) -> str:
        """
        Хеширует пароль с использованием bcrypt.
        
        Args:
            password: Пароль для хеширования
            rounds: Количество раундов bcrypt (12 = ~300ms на современном CPU)
            
        Returns:
            Хешированный пароль в формате bcrypt
        """
        # Генерируем соль автоматически
        salt = bcrypt.gensalt(rounds=rounds)
        password_bytes = password.encode('utf-8')
        hashed = bcrypt.hashpw(password_bytes, salt)
        return hashed.decode('utf-8')
    
    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        """
        Проверяет пароль против хеша с защитой от timing attacks.
        
        Args:
            password: Пароль для проверки
            password_hash: Хеш пароля из БД
            
        Returns:
            True если пароль верный, False иначе
        """
        password_bytes = password.encode('utf-8')
        hash_bytes = password_hash.encode('utf-8')
        
        try:
            # bcrypt использует constant-time сравнение
            return bcrypt.checkpw(password_bytes, hash_bytes)
        except Exception:
            # В случае ошибки всегда возвращаем False
            # Используем constant-time операцию для предотвращения timing attacks
            bcrypt.hashpw(b"dummy", bcrypt.gensalt())
            return False
    
    @staticmethod
    def validate_password_strength(password: str) -> Tuple[bool, Optional[str]]:
        """
        Проверяет силу пароля согласно политике безопасности.
        
        Args:
            password: Пароль для проверки
            
        Returns:
            (is_valid, error_message)
        """
        if len(password) < PasswordSecurity.MIN_LENGTH:
            return False, f"Пароль должен содержать минимум {PasswordSecurity.MIN_LENGTH} символов"
        
        if PasswordSecurity.REQUIRE_UPPERCASE and not re.search(r'[A-Z]', password):
            return False, "Пароль должен содержать хотя бы одну заглавную букву"
        
        if PasswordSecurity.REQUIRE_LOWERCASE and not re.search(r'[a-z]', password):
            return False, "Пароль должен содержать хотя бы одну строчную букву"
        
        if PasswordSecurity.REQUIRE_DIGITS and not re.search(r'\d', password):
            return False, "Пароль должен содержать хотя бы одну цифру"
        
        if PasswordSecurity.REQUIRE_SPECIAL and not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            return False, "Пароль должен содержать хотя бы один специальный символ"
        
        # Проверка на распространенные слабые пароли
        common_passwords = ['password', '12345678', 'qwerty', 'admin', 'letmein']
        if password.lower() in common_passwords:
            return False, "Пароль слишком простой и легко угадывается"
        
        return True, None


class RateLimiter:
    """Защита от brute force атак через rate limiting."""
    
    def __init__(self):
        # Хранилище попыток: {key: [(timestamp, success), ...]}
        self._attempts: Dict[str, list] = {}
        # Очистка старых записей каждые 5 минут
        self._last_cleanup = time.time()
        self._cleanup_interval = 300
    
    def _cleanup_old_attempts(self):
        """Удаляет старые записи о попытках."""
        current_time = time.time()
        if current_time - self._last_cleanup < self._cleanup_interval:
            return
        
        cutoff_time = current_time - 3600  # Удаляем записи старше часа
        
        for key in list(self._attempts.keys()):
            self._attempts[key] = [
                (ts, success) for ts, success in self._attempts[key]
                if ts > cutoff_time
            ]
            if not self._attempts[key]:
                del self._attempts[key]
        
        self._last_cleanup = current_time
    
    def check_rate_limit(self, key: str, max_attempts: int = 5, 
                        window_seconds: int = 300) -> Tuple[bool, Optional[int]]:
        """
        Проверяет, не превышен ли лимит попыток.
        
        Args:
            key: Уникальный ключ (например, IP адрес или username)
            max_attempts: Максимальное количество попыток
            window_seconds: Временное окно в секундах
            
        Returns:
            (is_allowed, seconds_until_retry)
        """
        self._cleanup_old_attempts()
        
        current_time = time.time()
        cutoff_time = current_time - window_seconds
        
        # Получаем попытки за последнее окно
        attempts = self._attempts.get(key, [])
        recent_attempts = [
            ts for ts, success in attempts
            if ts > cutoff_time and not success
        ]
        
        if len(recent_attempts) >= max_attempts:
            # Блокировка активна
            oldest_attempt = min(recent_attempts)
            retry_after = int(window_seconds - (current_time - oldest_attempt))
            return False, retry_after
        
        return True, None
    
    def record_attempt(self, key: str, success: bool):
        """Записывает попытку входа."""
        current_time = time.time()
        
        if key not in self._attempts:
            self._attempts[key] = []
        
        self._attempts[key].append((current_time, success))
        
        # Ограничиваем количество записей на ключ
        if len(self._attempts[key]) > 100:
            self._attempts[key] = self._attempts[key][-100:]


class CSRFProtection:
    """Защита от CSRF атак."""
    
    @staticmethod
    def generate_token() -> str:
        """Генерирует CSRF токен."""
        return secrets.token_urlsafe(32)
    
    @staticmethod
    def validate_token(token: str, stored_token: str) -> bool:
        """
        Проверяет CSRF токен с защитой от timing attacks.
        
        Args:
            token: Токен из запроса
            stored_token: Токен из сессии
            
        Returns:
            True если токены совпадают
        """
        if not token or not stored_token:
            return False
        
        # Используем secrets.compare_digest для constant-time сравнения
        return secrets.compare_digest(token, stored_token)


class InputSanitizer:
    """Санитизация и валидация входных данных."""
    
    # Паттерны для опасных конструкций
    SQL_INJECTION_PATTERNS = [
        r"(\bUNION\b.*\bSELECT\b)",
        r"(\bSELECT\b.*\bFROM\b)",
        r"(\bINSERT\b.*\bINTO\b)",
        r"(\bDELETE\b.*\bFROM\b)",
        r"(\bDROP\b.*\bTABLE\b)",
        r"(\bEXEC\b|\bEXECUTE\b)",
        r"('|(\\')|(;)|(--)|(/\*)|(\*/))",
    ]
    
    XSS_PATTERNS = [
        r"<script[^>]*>.*?</script>",
        r"javascript:",
        r"on\w+\s*=",
        r"<iframe",
        r"<object",
        r"<embed",
    ]
    
    @staticmethod
    def sanitize_string(value: str, max_length: int = 1000) -> str:
        """
        Санитизирует строку, удаляя опасные символы.
        
        Args:
            value: Строка для санитизации
            max_length: Максимальная длина
            
        Returns:
            Санитизированная строка
        """
        if not isinstance(value, str):
            return ""
        
        # Обрезаем длину
        value = value[:max_length]
        
        # Удаляем нулевые байты
        value = value.replace('\x00', '')
        
        # Удаляем управляющие символы (кроме переносов строк и табуляции)
        value = ''.join(char for char in value 
                       if ord(char) >= 32 or char in '\n\t')
        
        return value.strip()
    
    @staticmethod
    def validate_username(username: str) -> Tuple[bool, Optional[str]]:
        """
        Валидирует имя пользователя.
        
        Args:
            username: Имя пользователя
            
        Returns:
            (is_valid, error_message)
        """
        if not username:
            return False, "Имя пользователя не может быть пустым"
        
        if len(username) < 3:
            return False, "Имя пользователя должно содержать минимум 3 символа"
        
        if len(username) > 50:
            return False, "Имя пользователя не может быть длиннее 50 символов"
        
        # Разрешаем только буквы, цифры, дефисы и подчеркивания
        if not re.match(r'^[a-zA-Z0-9_-]+$', username):
            return False, "Имя пользователя может содержать только буквы, цифры, дефисы и подчеркивания"
        
        # Проверка на SQL injection
        for pattern in InputSanitizer.SQL_INJECTION_PATTERNS:
            if re.search(pattern, username, re.IGNORECASE):
                return False, "Недопустимые символы в имени пользователя"
        
        # Проверка на XSS
        for pattern in InputSanitizer.XSS_PATTERNS:
            if re.search(pattern, username, re.IGNORECASE):
                return False, "Недопустимые символы в имени пользователя"
        
        return True, None
    
    @staticmethod
    def sanitize_search_query(query: str) -> str:
        """
        Санитизирует поисковый запрос.
        
        Args:
            query: Поисковый запрос
            
        Returns:
            Санитизированный запрос
        """
        query = InputSanitizer.sanitize_string(query, max_length=500)
        
        # Удаляем опасные SQL конструкции
        for pattern in InputSanitizer.SQL_INJECTION_PATTERNS:
            query = re.sub(pattern, '', query, flags=re.IGNORECASE)
        
        return query


class SecurityHeaders:
    """Утилиты для установки Security Headers."""
    
    @staticmethod
    def get_security_headers() -> Dict[str, str]:
        """
        Возвращает словарь с рекомендуемыми security headers.
        
        Returns:
            Словарь заголовков безопасности
        """
        return {
            # Защита от XSS
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-XSS-Protection": "1; mode=block",
            
            # Content Security Policy
            "Content-Security-Policy": (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
                "img-src 'self' data:; "
                "font-src 'self' cdn.jsdelivr.net; "
                "connect-src 'self'; "
                "frame-ancestors 'none';"
            ),
            
            # Strict Transport Security (для HTTPS)
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            
            # Referrer Policy
            "Referrer-Policy": "strict-origin-when-cross-origin",
            
            # Permissions Policy
            "Permissions-Policy": (
                "geolocation=(), "
                "microphone=(), "
                "camera=(), "
                "payment=(), "
                "usb=()"
            ),
        }

