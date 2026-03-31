from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from server.cache import cache


def create_stats_router(storage, auth_manager, get_client_ip, require_auth):
    router = APIRouter()

    @router.get("/api/stats")
    @router.get("/stats")
    def stats(
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None,
    ) -> JSONResponse:
        cache_key = "api_stats"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)

        stats_data = storage.get_stats()
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(user["id"], user["username"], "view_stats", ip_address=client_ip)
        cache.set(cache_key, stats_data, ttl=300)
        return JSONResponse(stats_data)

    @router.get("/api/agents/stats")
    def agent_stats(
        window_minutes: int = Query(5, ge=1, le=60),
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None,
    ) -> JSONResponse:
        stats_data = storage.get_agent_stats(window_minutes=window_minutes)
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(user["id"], user["username"], "view_agent_stats", ip_address=client_ip)
        return JSONResponse(stats_data)

    return router
