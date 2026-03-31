import os
from dataclasses import dataclass
from typing import List, Optional

DEFAULT_BOOTSTRAP_ADMIN_USERNAME = "admin"
DEFAULT_BOOTSTRAP_ADMIN_PASSWORD = "admin123"
DEFAULT_CORS_ALLOWED_ORIGINS = (
    "http://localhost:8080,"
    "http://127.0.0.1:8080,"
    "http://192.168.0.159:8080,"
    "http://192.168.0.160:8080"
)


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AppConfig:
    cors_allowed_origins: List[str]
    cookie_secure: bool
    cookie_samesite: str
    session_max_age: int
    bootstrap_admin_username: Optional[str]
    bootstrap_admin_password: Optional[str]
    demo_mode: bool

    @classmethod
    def from_env(cls) -> "AppConfig":
        cors_env = os.getenv("CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ALLOWED_ORIGINS)
        allowed_origins = [origin.strip() for origin in cors_env.split(",") if origin.strip()]
        return cls(
            cors_allowed_origins=allowed_origins,
            cookie_secure=_env_flag("BARSUKSIEM_COOKIE_SECURE", default=False),
            cookie_samesite=os.getenv("BARSUKSIEM_COOKIE_SAMESITE", "lax"),
            session_max_age=int(os.getenv("BARSUKSIEM_SESSION_MAX_AGE", "86400")),
            bootstrap_admin_username=os.getenv(
                "BARSUKSIEM_BOOTSTRAP_ADMIN_USERNAME",
                DEFAULT_BOOTSTRAP_ADMIN_USERNAME,
            ),
            bootstrap_admin_password=os.getenv(
                "BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD",
                DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
            ),
            demo_mode=_env_flag("BARSUKSIEM_DEMO_MODE", default=False),
        )

