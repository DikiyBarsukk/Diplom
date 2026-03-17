"""
Simple in-memory cache with TTL support.
"""
import time
from functools import wraps
from typing import Any, Dict, Optional


class Cache:
    def __init__(self, default_ttl: int = 300):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self.default_ttl = default_ttl

    def get(self, key: str) -> Optional[Any]:
        self.cleanup()
        if key not in self._cache:
            return None
        entry = self._cache[key]
        if time.time() > entry["expires_at"]:
            del self._cache[key]
            return None
        return entry["value"]

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        self.cleanup()
        ttl = ttl or self.default_ttl
        self._cache[key] = {"value": value, "expires_at": time.time() + ttl}

    def delete(self, key: str) -> None:
        if key in self._cache:
            del self._cache[key]

    def delete_prefix(self, prefix: str) -> None:
        keys_to_delete = [key for key in self._cache if key.startswith(prefix)]
        for key in keys_to_delete:
            del self._cache[key]

    def clear(self) -> None:
        self._cache.clear()

    def cleanup(self) -> None:
        now = time.time()
        expired_keys = [key for key, entry in self._cache.items() if now > entry["expires_at"]]
        for key in expired_keys:
            del self._cache[key]


cache = Cache(default_ttl=300)


def cached(ttl: int = 300):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            cache_key = f"{func.__name__}:{str(args)}:{str(sorted(kwargs.items()))}"
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl)
            return result

        return wrapper

    return decorator
