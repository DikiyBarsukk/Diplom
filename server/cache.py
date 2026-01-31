"""
Модуль для кэширования результатов запросов.
"""
import time
from typing import Any, Optional, Dict
from functools import wraps


class Cache:
    """Простой in-memory кэш с TTL."""
    
    def __init__(self, default_ttl: int = 300):  # 5 минут по умолчанию
        self._cache: Dict[str, Dict[str, Any]] = {}
        self.default_ttl = default_ttl
    
    def get(self, key: str) -> Optional[Any]:
        """Получает значение из кэша."""
        self.cleanup()
        if key not in self._cache:
            return None
        
        entry = self._cache[key]
        if time.time() > entry['expires_at']:
            del self._cache[key]
            return None
        
        return entry['value']
    
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Сохраняет значение в кэш."""
        self.cleanup()
        ttl = ttl or self.default_ttl
        self._cache[key] = {
            'value': value,
            'expires_at': time.time() + ttl
        }
    
    def delete(self, key: str) -> None:
        """Удаляет значение из кэша."""
        if key in self._cache:
            del self._cache[key]
    
    def clear(self) -> None:
        """Очищает весь кэш."""
        self._cache.clear()
    
    def cleanup(self) -> None:
        """Удаляет истекшие записи."""
        now = time.time()
        expired_keys = [
            key for key, entry in self._cache.items()
            if now > entry['expires_at']
        ]
        for key in expired_keys:
            del self._cache[key]


# Глобальный экземпляр кэша
cache = Cache(default_ttl=300)


def cached(ttl: int = 300):
    """Декоратор для кэширования результатов функции."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Создаем ключ кэша из аргументов
            cache_key = f"{func.__name__}:{str(args)}:{str(sorted(kwargs.items()))}"
            
            # Пытаемся получить из кэша
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Выполняем функцию
            result = func(*args, **kwargs)
            
            # Сохраняем в кэш
            cache.set(cache_key, result, ttl)
            
            return result
        return wrapper
    return decorator

