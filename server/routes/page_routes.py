from pathlib import Path

from fastapi import APIRouter, Cookie
from fastapi.responses import HTMLResponse, RedirectResponse


def create_page_router(web_dir: Path, auth_manager):
    router = APIRouter()

    def read_html(filename: str, not_found_title: str) -> HTMLResponse:
        target = web_dir / filename
        if target.exists():
            return HTMLResponse(content=target.read_text(encoding="utf-8"))
        return HTMLResponse(content=f"<h1>{not_found_title}</h1>", status_code=404)

    def require_page_session(session_token: str | None):
        return session_token and auth_manager.validate_session(session_token)

    @router.get("/", response_class=HTMLResponse)
    def dashboard(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            login_file = web_dir / "login.html"
            if login_file.exists():
                return HTMLResponse(content=login_file.read_text(encoding="utf-8"))
            return HTMLResponse(content="<h1>Login required</h1>", status_code=401)
        return read_html("index.html", "Dashboard not found")

    @router.get("/logs", response_class=HTMLResponse)
    def logs_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("logs.html", "Logs page not found")

    @router.get("/incidents", response_class=HTMLResponse)
    def incidents_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("incidents.html", "Incidents page not found")

    @router.get("/incidents/details", response_class=HTMLResponse)
    def incident_details_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("incident_details.html", "Incident details page not found")

    @router.get("/analytics", response_class=HTMLResponse)
    def analytics_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("analytics.html", "Analytics page not found")

    @router.get("/login", response_class=HTMLResponse)
    def login_page() -> HTMLResponse:
        return read_html("login.html", "Login page not found")

    @router.get("/inventory", response_class=HTMLResponse)
    def inventory_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("remote_pcs.html", "Inventory page not found")

    @router.get("/compliance", response_class=HTMLResponse)
    def compliance_page(session_token: str = Cookie(None)) -> HTMLResponse:
        if not require_page_session(session_token):
            return RedirectResponse(url="/login")
        return read_html("compliance.html", "Compliance page not found")

    return router
