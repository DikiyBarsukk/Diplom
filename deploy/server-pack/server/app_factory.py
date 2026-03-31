import logging
import socket
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from server.auth import AuthManager
from server.config import AppConfig
from server.incidents import get_analyzer
from server.routes import (
    create_auth_router,
    create_incident_router,
    create_log_router,
    create_page_router,
    create_stats_router,
)
from server.security import RateLimiter, SecurityHeaders
from server.storage import LogStorage

logger = logging.getLogger(__name__)


def create_app(db_path: str = "logs.db", config: Optional[AppConfig] = None) -> FastAPI:
    config = config or AppConfig.from_env()

    app = FastAPI(title="Log Audit Server", version="0.5")
    storage = LogStorage(db_path=db_path)
    auth_manager = AuthManager(
        db_path=db_path,
        bootstrap_admin_username=config.bootstrap_admin_username,
        bootstrap_admin_password=config.bootstrap_admin_password,
        demo_mode=config.demo_mode,
    )
    ingest_rate_limiter = RateLimiter()
    incident_analyzer = get_analyzer()

    app.state.config = config
    app.state.storage = storage
    app.state.auth_manager = auth_manager

    web_dir = Path(__file__).resolve().parent.parent / "web"
    static_dir = web_dir / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.middleware("http")
    async def add_response_headers(request: Request, call_next):
        response = await call_next(request)
        for header, value in SecurityHeaders.get_security_headers().items():
            response.headers[header] = value

        session_token = request.cookies.get("session_token")
        if session_token and "X-CSRF-Token" not in response.headers:
            user = auth_manager.validate_session(session_token, update_activity=False)
            if user and user.get("csrf_token"):
                response.headers["X-CSRF-Token"] = user["csrf_token"]
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        expose_headers=["X-CSRF-Token"],
    )

    def get_current_user(session_token: str = Cookie(None)) -> Optional[Dict[str, Any]]:
        if not session_token:
            return None
        return auth_manager.validate_session(session_token)

    def require_auth(user: Optional[Dict[str, Any]] = Depends(get_current_user)) -> Dict[str, Any]:
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user

    def require_csrf(request: Request, user: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
        csrf_token = request.headers.get("X-CSRF-Token")
        session_token = request.cookies.get("session_token")
        if not csrf_token or not session_token:
            raise HTTPException(status_code=403, detail="CSRF token required")
        if not auth_manager.validate_csrf_token(session_token, csrf_token):
            raise HTTPException(status_code=403, detail="Invalid CSRF token")
        return user

    def require_permission(permission: str):
        def check_permission(user: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
            if not auth_manager.has_permission(user["role"], permission):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user

        return check_permission

    def get_client_ip(request: Optional[Request]) -> str:
        if request and request.client:
            return request.client.host
        return "unknown"

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "host": socket.gethostname(), "version": "0.5"}

    app.include_router(
        create_auth_router(
            auth_manager=auth_manager,
            config=config,
            get_client_ip=get_client_ip,
            require_auth=require_auth,
            require_csrf=require_csrf,
            require_permission=require_permission,
        )
    )
    app.include_router(
        create_log_router(
            storage=storage,
            auth_manager=auth_manager,
            ingest_rate_limiter=ingest_rate_limiter,
            incident_analyzer=incident_analyzer,
            get_client_ip=get_client_ip,
            require_auth=require_auth,
        )
    )
    app.include_router(
        create_incident_router(
            storage=storage,
            auth_manager=auth_manager,
            incident_analyzer=incident_analyzer,
            get_client_ip=get_client_ip,
            require_auth=require_auth,
        )
    )
    app.include_router(
        create_stats_router(
            storage=storage,
            auth_manager=auth_manager,
            get_client_ip=get_client_ip,
            require_auth=require_auth,
        )
    )
    app.include_router(create_page_router(web_dir=web_dir, auth_manager=auth_manager))

    return app
