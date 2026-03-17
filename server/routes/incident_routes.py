from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from server.cache import cache
from server.security import InputSanitizer


def create_incident_router(storage, auth_manager, incident_analyzer, get_client_ip, require_auth):
    router = APIRouter()

    @router.get("/api/incidents")
    def get_incidents(
        incident_type: str | None = Query(None),
        severity: str | None = Query(None),
        status: str | None = Query(None),
        search: str | None = Query(None),
        since: str | None = Query(None),
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None,
    ) -> JSONResponse:
        sanitized_type = InputSanitizer.sanitize_string(incident_type, max_length=50) if incident_type else None
        sanitized_severity = InputSanitizer.sanitize_string(severity, max_length=20) if severity else None
        sanitized_status = InputSanitizer.sanitize_string(status, max_length=20) if status else None
        sanitized_search = InputSanitizer.sanitize_search_query(search) if search else None

        cache_key = f"incidents:{sanitized_type}:{sanitized_severity}:{sanitized_status}:{since}:{sanitized_search}:{limit}:{offset}"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)

        incidents = storage.get_incidents(
            incident_type=sanitized_type,
            severity=sanitized_severity,
            status=sanitized_status,
            search=sanitized_search,
            since=since,
            limit=limit,
            offset=offset,
        )
        cache.set(cache_key, incidents, ttl=60)

        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(
            user["id"],
            user["username"],
            "view_incidents",
            details=f"type={sanitized_type}, severity={sanitized_severity}, limit={limit}",
            ip_address=client_ip,
        )
        return JSONResponse(incidents)

    @router.get("/api/incidents/rules")
    def get_incident_rules(user: Dict[str, Any] = Depends(require_auth)) -> JSONResponse:
        return JSONResponse(incident_analyzer.get_rules_info())

    @router.get("/api/incidents/stats")
    def get_incidents_stats(
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None,
    ) -> JSONResponse:
        cache_key = "incidents_stats"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)

        stats = storage.get_incidents_stats()
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(user["id"], user["username"], "view_incidents_stats", ip_address=client_ip)
        cache.set(cache_key, stats, ttl=300)
        return JSONResponse(stats)

    return router
