from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse

from server.cache import cache
from server.parser import normalize_event
from server.security import InputSanitizer


def create_log_router(storage, auth_manager, ingest_rate_limiter, incident_analyzer, get_client_ip, require_auth):
    router = APIRouter()

    @router.post("/api/logs")
    @router.post("/logs")
    def ingest_logs(logs: List[Dict[str, Any]] = Body(...), request: Request = None) -> JSONResponse:
        client_ip = get_client_ip(request) if request else "unknown"
        rate_key = f"ingest:{client_ip}"
        is_allowed, retry_after = ingest_rate_limiter.check_rate_limit(
            rate_key,
            max_attempts=120,
            window_seconds=60,
        )
        if not is_allowed:
            ingest_rate_limiter.record_attempt(rate_key, False)
            return JSONResponse(
                {"error": "Rate limit exceeded", "retry_after": retry_after},
                status_code=429,
            )
        ingest_rate_limiter.record_attempt(rate_key, False)

        if not logs:
            return JSONResponse({"error": "Empty logs list"}, status_code=400)

        normalized = []
        for raw_event in logs:
            event_host = str(raw_event.get("host", "unknown"))
            event_source = raw_event.get("source") or raw_event.get("log_type") or "unknown"
            normalized.append(normalize_event(raw_event, source=event_source, host=event_host))

        result = storage.store_events(normalized)
        incidents = []
        if normalized:
            try:
                recent_events = storage.get_events(limit=1000)
                detected_incidents = incident_analyzer.analyze_events(recent_events)
                for incident in detected_incidents:
                    if storage.store_incident(incident):
                        incidents.append(incident)
            except Exception:
                pass

        cache.delete("stats")
        cache.delete("api_stats")
        cache.delete("incidents_stats")
        cache.delete_prefix("logs:")
        cache.delete_prefix("incidents:")

        return JSONResponse(
            {
                "status": "ok",
                "received": len(logs),
                "saved": result["saved"],
                "skipped": result["skipped"],
                "incidents_detected": len(incidents),
            }
        )

    @router.get("/api/logs")
    def get_logs(
        host: str | None = Query(None),
        severity: str | None = Query(None),
        since: str | None = Query(None),
        search: str | None = Query(None),
        limit: int = Query(200, ge=1, le=10000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None,
    ) -> JSONResponse:
        sanitized_host = InputSanitizer.sanitize_string(host, max_length=255) if host else None
        sanitized_severity = InputSanitizer.sanitize_string(severity, max_length=20) if severity else None
        sanitized_search = InputSanitizer.sanitize_search_query(search) if search else None

        cache_key = f"logs:{sanitized_host}:{sanitized_severity}:{since}:{sanitized_search}:{limit}:{offset}"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)

        events = storage.get_events(
            host=sanitized_host,
            severity=sanitized_severity,
            since=since,
            search=sanitized_search,
            limit=limit,
            offset=offset,
        )
        cache.set(cache_key, events, ttl=60)

        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(
            user["id"],
            user["username"],
            "view_logs",
            details=f"host={sanitized_host}, severity={sanitized_severity}, limit={limit}",
            ip_address=client_ip,
        )
        return JSONResponse(events)

    return router
