import argparse
import socket
import time
from typing import Any, Dict, List

import requests


def run_server(host: str, port: int, db_path: str = "logs.db") -> None:
    """
    Запускает сервер для приема и обработки логов от агентов.
    """
    from fastapi import FastAPI, Body, Query
    from fastapi.responses import JSONResponse, HTMLResponse
    from fastapi.staticfiles import StaticFiles
    from pathlib import Path
    import uvicorn

    from server.parser import normalize_event
    from server.storage import LogStorage

    app = FastAPI(title="Log Audit Server", version="0.2")

    # Mount static files
    web_dir = Path(__file__).parent / "web"
    static_dir = web_dir / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    storage = LogStorage(db_path=db_path)

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "host": socket.gethostname(), "version": "0.2"}

    @app.post("/logs")
    def ingest_logs(logs: List[Dict[str, Any]] = Body(...)) -> JSONResponse:
        """
        Принимает логи от агентов, нормализует и сохраняет их.
        """
        if not logs:
            return JSONResponse({"error": "Empty logs list"}, status_code=400)

        normalized = []
        for raw_event in logs:
            # Извлекаем информацию о хосте и источнике
            event_host = str(raw_event.get("host", "unknown"))
            event_source = raw_event.get("source") or raw_event.get("log_type") or "unknown"
            
            # Нормализуем событие
            normalized_event = normalize_event(raw_event, source=event_source, host=event_host)
            normalized.append(normalized_event)

        # Сохраняем в БД
        result = storage.store_events(normalized)

        return JSONResponse({
            "status": "ok",
            "received": len(logs),
            "saved": result["saved"],
            "skipped": result["skipped"],
        })

    @app.get("/logs")
    def get_logs(
        host: str | None = Query(None),
        severity: str | None = Query(None),
        since: str | None = Query(None),
        search: str | None = Query(None),
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ) -> JSONResponse:
        """
        Получает логи из базы данных с фильтрацией.
        """
        events = storage.get_events(
            host=host,
            severity=severity,
            since=since,
            search=search,
            limit=limit,
            offset=offset,
        )
        return JSONResponse(events)

    @app.get("/stats")
    def stats() -> JSONResponse:
        """
        Возвращает статистику по логам.
        """
        return JSONResponse(storage.get_stats())

    @app.get("/", response_class=HTMLResponse)
    def dashboard() -> HTMLResponse:
        """
        Возвращает главную страницу дашборда.
        """
        index_file = web_dir / "index.html"
        if index_file.exists():
            return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
        return HTMLResponse(content="<h1>Dashboard not found</h1>", status_code=404)

    uvicorn.run(app, host=host, port=port)


def run_client(server_url: str) -> None:
    """
    Запускает клиент-аудитор (GUI) для просмотра логов.
    """
    from client.gui import run_app

    run_app(server_url)


def run_agent(server_url: str, source: str = "auto", limit: int = 200, interval: int = 60) -> None:
    """
    Запускает клиент-агент для сбора логов и отправки на сервер.
    
    Args:
        server_url: URL сервера (например, http://127.0.0.1:8080)
        source: источник логов (auto, journal, eventlog, file)
        limit: количество событий за раз
        interval: интервал отправки в секундах
    """
    from client.agent import collect_logs

    print(f"Agent started. Collecting logs from: {source}")
    print(f"Sending to: {server_url}")
    print(f"Interval: {interval} seconds")
    print("Press Ctrl+C to stop\n")

    try:
        while True:
            # Собираем логи локально
            raw_logs = collect_logs(source=source, limit=limit)
            
            if not raw_logs:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No logs collected")
            else:
                try:
                    # Отправляем на сервер
                    response = requests.post(
                        f"{server_url.rstrip('/')}/logs",
                        json=raw_logs,
                        timeout=30
                    )
                    response.raise_for_status()
                    result = response.json()
                    print(
                        f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
                        f"Sent {result.get('received', 0)} logs, "
                        f"saved {result.get('saved', 0)}, "
                        f"skipped {result.get('skipped', 0)}"
                    )
                except Exception as e:
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error sending logs: {e}")

            # Ждем перед следующей отправкой
            time.sleep(interval)

    except KeyboardInterrupt:
        print("\nAgent stopped.")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="audit-app",
        description="Client-server log audit application with agent support"
    )
    subs = parser.add_subparsers(dest="mode", required=True)

    # Сервер
    sp_server = subs.add_parser("server", help="Run server for receiving and processing logs")
    sp_server.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    sp_server.add_argument("--port", type=int, default=8080, help="Port to bind to")
    sp_server.add_argument("--db", default="logs.db", help="Path to SQLite database")

    # Клиент-аудитор (GUI)
    sp_client = subs.add_parser("client", help="Run client GUI (auditor) to view logs")
    sp_client.add_argument("--server", required=True, help="Server base URL, e.g. http://127.0.0.1:8080")

    # Клиент-агент
    sp_agent = subs.add_parser("agent", help="Run agent to collect logs and send to server")
    sp_agent.add_argument("--server", required=True, help="Server base URL, e.g. http://127.0.0.1:8080")
    sp_agent.add_argument("--source", default="auto", help="Log source: auto, journal, eventlog, file")
    sp_agent.add_argument("--limit", type=int, default=200, help="Number of events to collect per cycle")
    sp_agent.add_argument("--interval", type=int, default=60, help="Interval between sends (seconds)")

    args = parser.parse_args()

    if args.mode == "server":
        run_server(args.host, args.port, args.db)
        return

    if args.mode == "client":
        run_client(args.server)
        return

    if args.mode == "agent":
        run_agent(args.server, args.source, args.limit, args.interval)
        return


if __name__ == "__main__":
    main()


