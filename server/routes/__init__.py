from .auth_routes import create_auth_router
from .incident_routes import create_incident_router
from .log_routes import create_log_router
from .page_routes import create_page_router
from .stats_routes import create_stats_router

__all__ = [
    "create_auth_router",
    "create_incident_router",
    "create_log_router",
    "create_page_router",
    "create_stats_router",
]
