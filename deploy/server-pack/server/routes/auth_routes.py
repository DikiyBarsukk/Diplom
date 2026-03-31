from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse


def create_auth_router(auth_manager, config, get_client_ip, require_auth, require_csrf, require_permission):
    router = APIRouter()

    @router.post("/api/auth/login")
    def login(
        username: str = Body(...),
        password: str = Body(...),
        request: Request = None,
    ) -> JSONResponse:
        client_ip = get_client_ip(request) if request else "unknown"
        user_agent = request.headers.get("User-Agent", "unknown") if request else "unknown"

        user, error = auth_manager.authenticate(username, password, ip_address=client_ip)
        if not user:
            auth_manager.log_action(
                None,
                username,
                "login_failed",
                details=error or "Invalid credentials",
                ip_address=client_ip,
            )
            return JSONResponse({"error": error or "Invalid credentials"}, status_code=401)

        session_data = auth_manager.create_session(
            user["id"],
            user["username"],
            ip_address=client_ip,
            user_agent=user_agent,
        )
        auth_manager.log_action(user["id"], user["username"], "login_success", ip_address=client_ip)

        response = JSONResponse(
            {
                "status": "ok",
                "token": session_data["session_token"],
                "csrf_token": session_data["csrf_token"],
                "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
            }
        )
        response.set_cookie(
            key="session_token",
            value=session_data["session_token"],
            httponly=True,
            secure=config.cookie_secure,
            samesite=config.cookie_samesite,
            max_age=config.session_max_age,
        )
        response.headers["X-CSRF-Token"] = session_data["csrf_token"]
        return response

    @router.post("/api/auth/logout")
    def logout(
        user: Dict[str, Any] = Depends(require_csrf),
        session_token: str = Cookie(None),
        request: Request = None,
    ) -> JSONResponse:
        client_ip = get_client_ip(request) if request else "unknown"
        if session_token:
            auth_manager.logout(session_token)
            auth_manager.log_action(user["id"], user["username"], "logout", ip_address=client_ip)
        response = JSONResponse({"status": "ok"})
        response.delete_cookie(
            key="session_token",
            httponly=True,
            secure=config.cookie_secure,
            samesite=config.cookie_samesite,
        )
        return response

    @router.get("/api/auth/me")
    def get_current_user_info(user: Dict[str, Any] = Depends(require_auth)) -> JSONResponse:
        response = JSONResponse(user)
        if user.get("csrf_token"):
            response.headers["X-CSRF-Token"] = user["csrf_token"]
        return response

    @router.get("/api/audit")
    def get_audit_log(
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_permission("manage_users")),
    ) -> JSONResponse:
        log = auth_manager.get_audit_log(limit=limit, offset=offset)
        auth_manager.log_action(
            user["id"],
            user["username"],
            "view_audit_log",
            details=f"limit={limit}, offset={offset}",
        )
        return JSONResponse(log)

    return router
