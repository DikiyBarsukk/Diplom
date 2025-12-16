import argparse
import socket
import time
from typing import Any, Dict, List, Optional

import requests


def run_server(host: str, port: int, db_path: str = "logs.db", 
               ssl_cert: str = None, ssl_key: str = None) -> None:
    """
    Запускает сервер для приема и обработки логов от агентов.
    """
    from fastapi import FastAPI, Body, Query, Depends, HTTPException, Request, Cookie
    from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
    from fastapi.staticfiles import StaticFiles
    from fastapi.middleware.cors import CORSMiddleware
    from pathlib import Path
    import uvicorn

    from server.parser import normalize_event
    from server.storage import LogStorage
    from server.auth import AuthManager
    from server.cache import cache
    from server.security import SecurityHeaders, InputSanitizer
    from server.incidents import get_analyzer

    app = FastAPI(title="Log Audit Server", version="0.4")
    
    # Инициализация компонентов
    storage = LogStorage(db_path=db_path)
    auth_manager = AuthManager(db_path=db_path)
    incident_analyzer = get_analyzer()
    
    # Security Headers middleware
    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        """Добавляет Security Headers ко всем ответам."""
        response = await call_next(request)
        security_headers = SecurityHeaders.get_security_headers()
        for header, value in security_headers.items():
            response.headers[header] = value
        return response
    
    # CORS middleware (настроен для безопасности)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # В production указать конкретные домены
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        expose_headers=["X-CSRF-Token"],
    )

    # Mount static files
    web_dir = Path(__file__).parent / "web"
    static_dir = web_dir / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    
    # Dependency для получения текущего пользователя
    def get_current_user(session_token: str = Cookie(None)) -> Dict[str, Any]:
        """Получает текущего пользователя из сессии."""
        if not session_token:
            return None
        return auth_manager.validate_session(session_token)
    
    def require_auth(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        """
        Требует аутентификации.
        
        Проверяет валидность сессии и обновляет время активности.
        """
        if not user:
            raise HTTPException(
                status_code=401,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"}
            )
        return user
    
    def require_csrf(request: Request, user: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
        """
        Требует валидный CSRF токен для операций изменения данных.
        
        Проверяет CSRF токен из заголовка X-CSRF-Token.
        """
        csrf_token = request.headers.get("X-CSRF-Token")
        session_token = request.cookies.get("session_token")
        
        if not csrf_token or not session_token:
            raise HTTPException(status_code=403, detail="CSRF token required")
        
        if not auth_manager.validate_csrf_token(session_token, csrf_token):
            raise HTTPException(status_code=403, detail="Invalid CSRF token")
        
        return user
    
    def require_permission(permission: str):
        """Требует определенного разрешения."""
        def check_permission(user: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
            if not auth_manager.has_permission(user['role'], permission):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return user
        return check_permission
    
    def get_client_ip(request: Optional[Request]) -> str:
        """Получает IP адрес клиента."""
        if request and request.client:
            return request.client.host
        return "unknown"

    @app.get("/health")
    def health() -> Dict[str, Any]:
        """
        Проверка доступности сервера (публичный эндпоинт).
        
        Returns:
            Dict с полями:
            - status (str): Статус сервера ("ok")
            - host (str): Имя хоста сервера
            - version (str): Версия сервера
        
        Example:
            >>> GET /health
            {
                "status": "ok",
                "host": "server-hostname",
                "version": "0.4"
            }
        """
        return {"status": "ok", "host": socket.gethostname(), "version": "0.4"}
    
    @app.post("/api/auth/login")
    def login(
        username: str = Body(...),
        password: str = Body(...),
        request: Request = None
    ) -> JSONResponse:
        """
        Аутентификация пользователя с защитой от brute force атак.
        
        Args:
            username (str): Имя пользователя (минимум 3 символа, только буквы, цифры, дефисы и подчеркивания)
            password (str): Пароль (минимум 8 символов, должен содержать заглавные, строчные буквы, цифры и спецсимволы)
            request (Request, optional): FastAPI Request объект для получения IP адреса
        
        Returns:
            JSONResponse с полями:
            - status (str): "ok" при успехе
            - token (str): Токен сессии
            - csrf_token (str): CSRF токен для защиты от CSRF атак
            - user (dict): Информация о пользователе (id, username, role)
        
        Raises:
            HTTPException 401: При неверных учетных данных или блокировке аккаунта
        
        Реализует:
        - Rate limiting по IP и username (макс. 5 попыток за 5 минут)
        - Валидацию и санитизацию входных данных
        - Защиту от timing attacks через constant-time сравнение
        - Блокировку аккаунта после 5 неудачных попыток на 30 минут
        
        Example:
            >>> POST /api/auth/login
            Body: {"username": "admin", "password": "Admin123!@#"}
            Response: {
                "status": "ok",
                "token": "session_token_here",
                "csrf_token": "csrf_token_here",
                "user": {"id": 1, "username": "admin", "role": "admin"}
            }
        """
        client_ip = get_client_ip(request) if request else "unknown"
        user_agent = request.headers.get("User-Agent", "unknown") if request else "unknown"
        
        user, error = auth_manager.authenticate(username, password, ip_address=client_ip)
        
        if not user:
            auth_manager.log_action(
                None, username, "login_failed", 
                details=error or "Invalid credentials",
                ip_address=client_ip
            )
            return JSONResponse({"error": error or "Invalid credentials"}, status_code=401)
        
        # Создаем сессию с CSRF токеном
        session_data = auth_manager.create_session(
            user['id'], user['username'],
            ip_address=client_ip,
            user_agent=user_agent
        )
        
        auth_manager.log_action(
            user['id'], user['username'], "login_success",
            ip_address=client_ip
        )
        
        response = JSONResponse({
            "status": "ok",
            "token": session_data["session_token"],
            "csrf_token": session_data["csrf_token"],
            "user": {"id": user['id'], "username": user['username'], "role": user['role']}
        })
        
        # Устанавливаем безопасные cookies
        response.set_cookie(
            key="session_token",
            value=session_data["session_token"],
            httponly=True,
            secure=False,  # В production установить True для HTTPS
            samesite="lax",
            max_age=86400
        )
        
        # Возвращаем CSRF токен в заголовке
        response.headers["X-CSRF-Token"] = session_data["csrf_token"]
        
        return response
    
    @app.post("/api/auth/logout")
    def logout(
        user: Dict[str, Any] = Depends(require_csrf),
        session_token: str = Cookie(None),
        request: Request = None
    ) -> JSONResponse:
        """
        Выход из системы.
        
        Требует CSRF токен для защиты от CSRF атак.
        """
        client_ip = get_client_ip(request) if request else "unknown"
        if session_token:
            auth_manager.logout(session_token)
            auth_manager.log_action(user['id'], user['username'], "logout", ip_address=client_ip)
        response = JSONResponse({"status": "ok"})
        response.delete_cookie(
            key="session_token",
            httponly=True,
            samesite="lax"
        )
        return response
    
    @app.get("/api/auth/me")
    def get_current_user_info(user: Dict[str, Any] = Depends(require_auth)) -> JSONResponse:
        """Получение информации о текущем пользователе."""
        return JSONResponse(user)
    
    @app.get("/api/audit")
    def get_audit_log(
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_permission("manage_users"))
    ) -> JSONResponse:
        """Получение журнала аудита (только для админов)."""
        log = auth_manager.get_audit_log(limit=limit, offset=offset)
        auth_manager.log_action(
            user['id'], user['username'], "view_audit_log",
            details=f"limit={limit}, offset={offset}"
        )
        return JSONResponse(log)

    @app.post("/logs")
    def ingest_logs(
        logs: List[Dict[str, Any]] = Body(...),
        request: Request = None
    ) -> JSONResponse:
        """
        Принимает логи от агентов, нормализует и сохраняет их.
        Публичный эндпоинт (не требует аутентификации для агентов).
        
        Args:
            logs (List[Dict[str, Any]]): Список сырых событий для обработки.
                Каждое событие должно содержать:
                - host (str, optional): Имя хоста источника
                - source (str, optional): Тип источника (journal, eventlog, file)
                - message (str): Текст сообщения
                - ts (str, optional): Временная метка в ISO формате
                - Другие поля в зависимости от источника
            request (Request, optional): FastAPI Request объект
        
        Returns:
            JSONResponse с полями:
            - status (str): "ok" при успехе
            - received (int): Количество полученных событий
            - saved (int): Количество сохраненных событий (без дубликатов)
            - skipped (int): Количество пропущенных событий (дубликаты)
        
        Example:
            >>> POST /logs
            Body: [
                {
                    "host": "server1",
                    "source": "journal",
                    "message": "System started",
                    "ts": "2024-01-01T12:00:00Z"
                }
            ]
            Response: {
                "status": "ok",
                "received": 1,
                "saved": 1,
                "skipped": 0
            }
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
        
        # Анализируем события на инциденты ИБ
        incidents = []
        if normalized:
            try:
                import logging
                logger_incidents = logging.getLogger("incidents")
                
                # Получаем последние события для анализа (для корреляции)
                recent_events = storage.get_events(limit=1000)
                detected_incidents = incident_analyzer.analyze_events(recent_events)
                
                # Сохраняем обнаруженные инциденты
                for incident in detected_incidents:
                    if storage.store_incident(incident):
                        incidents.append(incident)
                        logger_incidents.warning(
                            f"Security incident detected: {incident.get('title')} "
                            f"(Rule: {incident.get('rule_id')}, Type: {incident.get('incident_type')}, "
                            f"Severity: {incident.get('severity')})"
                        )
            except Exception as e:
                import logging
                logger_incidents = logging.getLogger("incidents")
                logger_incidents.error(f"Error analyzing incidents: {e}", exc_info=True)
        
        # Очищаем кэш статистики при добавлении новых логов
        cache.delete("stats")
        cache.delete("get_logs")
        cache.delete("incidents")

        return JSONResponse({
            "status": "ok",
            "received": len(logs),
            "saved": result["saved"],
            "skipped": result["skipped"],
            "incidents_detected": len(incidents),
        })

    @app.get("/logs")
    def get_logs(
        host: str | None = Query(None),
        severity: str | None = Query(None),
        since: str | None = Query(None),
        search: str | None = Query(None),
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None
    ) -> JSONResponse:
        """
        Получение логов с фильтрацией.
        
        Реализует:
        - Санитизацию поисковых запросов перед использованием
        - Защиту от SQL injection через параметризацию
        - Валидацию входных параметров
        - Кэширование результатов для улучшения производительности
        
        Требует аутентификации.
        """
        # Санитизация входных данных ПЕРЕД использованием
        sanitized_host = None
        sanitized_severity = None
        sanitized_search = None
        
        if host:
            sanitized_host = InputSanitizer.sanitize_string(host, max_length=255)
        if severity:
            sanitized_severity = InputSanitizer.sanitize_string(severity, max_length=20)
        if search:
            sanitized_search = InputSanitizer.sanitize_search_query(search)
        
        # Проверяем кэш ПЕРЕД запросом к БД
        cache_key = f"logs:{sanitized_host}:{sanitized_severity}:{since}:{sanitized_search}:{limit}:{offset}"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)
        
        # Выполняем запрос к БД только если нет в кэше
        events = storage.get_events(
            host=sanitized_host,
            severity=sanitized_severity,
            since=since,
            search=sanitized_search,
            limit=limit,
            offset=offset,
        )
        
        # Сохраняем результат в кэш
        cache.set(cache_key, events, ttl=60)
        
        # Логируем действие
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(
            user['id'], user['username'], "view_logs",
            details=f"host={sanitized_host}, severity={sanitized_severity}, limit={limit}",
            ip_address=client_ip
        )
        
        return JSONResponse(events)

    @app.get("/api/incidents")
    def get_incidents(
        incident_type: str | None = Query(None),
        severity: str | None = Query(None),
        status: str | None = Query(None),
        since: str | None = Query(None),
        limit: int = Query(100, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None
    ) -> JSONResponse:
        """
        Получение инцидентов ИБ с фильтрацией.
        
        Args:
            incident_type: Фильтр по типу инцидента
            severity: Фильтр по критичности (critical, high, medium, low, info)
            status: Фильтр по статусу (open, closed, investigating)
            since: Фильтр по времени обнаружения (ISO формат)
            limit: Максимальное количество инцидентов
            offset: Смещение для пагинации
        
        Returns:
            Список инцидентов ИБ
        """
        # Санитизация параметров
        sanitized_type = None
        sanitized_severity = None
        sanitized_status = None
        
        if incident_type:
            sanitized_type = InputSanitizer.sanitize_string(incident_type, max_length=50)
        if severity:
            sanitized_severity = InputSanitizer.sanitize_string(severity, max_length=20)
        if status:
            sanitized_status = InputSanitizer.sanitize_string(status, max_length=20)
        
        incidents = storage.get_incidents(
            incident_type=sanitized_type,
            severity=sanitized_severity,
            status=sanitized_status,
            since=since,
            limit=limit,
            offset=offset,
        )
        
        # Логируем действие
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(
            user['id'], user['username'], "view_incidents",
            details=f"type={sanitized_type}, severity={sanitized_severity}, limit={limit}",
            ip_address=client_ip
        )
        
        return JSONResponse(incidents)
    
    @app.get("/api/incidents/rules")
    def get_incident_rules(
        user: Dict[str, Any] = Depends(require_auth)
    ) -> JSONResponse:
        """Получение информации о правилах выявления инцидентов."""
        rules = incident_analyzer.get_rules_info()
        return JSONResponse(rules)
    
    @app.get("/api/incidents/stats")
    def get_incidents_stats(
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None
    ) -> JSONResponse:
        """Получение статистики по инцидентам ИБ."""
        stats = storage.get_incidents_stats()
        
        # Логируем действие
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(user['id'], user['username'], "view_incidents_stats", ip_address=client_ip)
        
        # Кэшируем результат
        cache_key = "incidents_stats"
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return JSONResponse(cached_result)
        
        cache.set(cache_key, stats, ttl=300)
        return JSONResponse(stats)
    
    @app.get("/stats")
    def stats(
        user: Dict[str, Any] = Depends(require_auth),
        request: Request = None
    ) -> JSONResponse:
        """
        Возвращает статистику по логам.
        Требует аутентификации.
        """
        stats_data = storage.get_stats()
        
        # Логируем действие
        client_ip = get_client_ip(request) if request else "unknown"
        auth_manager.log_action(user['id'], user['username'], "view_stats", ip_address=client_ip)
        
        # Кэшируем результат
        cache_key = "stats"
        cached_result = cache.get(cache_key)
        if cached_result is None:
            cache.set(cache_key, stats_data, ttl=300)
            return JSONResponse(stats_data)
        return JSONResponse(cached_result)

    @app.get("/", response_class=HTMLResponse)
    def dashboard(session_token: str = Cookie(None)) -> HTMLResponse:
        """
        Возвращает главную страницу дашборда или страницу логина.
        """
        # Проверяем аутентификацию
        if not session_token or not auth_manager.validate_session(session_token):
            login_file = web_dir / "login.html"
            if login_file.exists():
                return HTMLResponse(content=login_file.read_text(encoding="utf-8"))
            # Если нет страницы логина, создаем простую
            return HTMLResponse(content="""
            <!DOCTYPE html>
            <html><head><meta charset="UTF-8"><title>Вход</title></head>
            <body><h1>Требуется вход</h1>
            <p>Используйте /api/auth/login для аутентификации</p>
            </body></html>
            """)
        
        index_file = web_dir / "index.html"
        if index_file.exists():
            return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
        return HTMLResponse(content="<h1>Dashboard not found</h1>", status_code=404)
    
    @app.get("/login", response_class=HTMLResponse)
    def login_page() -> HTMLResponse:
        """Страница входа."""
        login_file = web_dir / "login.html"
        if login_file.exists():
            return HTMLResponse(content=login_file.read_text(encoding="utf-8"))
        return HTMLResponse(content="<h1>Login page not found</h1>", status_code=404)

    # Настройка SSL
    ssl_config = {}
    if ssl_cert and ssl_key:
        ssl_config = {
            "ssl_certfile": ssl_cert,
            "ssl_keyfile": ssl_key
        }
    
    uvicorn.run(app, host=host, port=port, **ssl_config)


def run_client(server_url: str) -> None:
    """
    Запускает клиент-аудитор (GUI) для просмотра логов.
    """
    from client.gui import run_app

    run_app(server_url)


def run_agent(server_url: str, source: str = "auto", limit: int = 200, 
              interval: int = 60, encrypt: bool = False, encryption_key: str = None) -> None:
    """
    Запускает клиент-агент для сбора логов и отправки на сервер.
    
    Args:
        server_url: URL сервера (http://, udp://, tcp://)
        source: источник логов (auto, journal, eventlog, file)
        limit: количество событий за раз
        interval: интервал отправки в секундах
        encrypt: использовать шифрование
        encryption_key: ключ шифрования (если None, используется по умолчанию)
    """
    from client.agent import collect_logs
    from client.udp_client import UDPClient, TCPClient, parse_server_url
    from client.encryption import EncryptionManager

    protocol, host, port = parse_server_url(server_url)
    
    print(f"Agent started. Collecting logs from: {source}")
    print(f"Protocol: {protocol.upper()}")
    print(f"Sending to: {host}:{port}")
    print(f"Interval: {interval} seconds")
    if encrypt:
        print("Encryption: ENABLED")
    print("Press Ctrl+C to stop\n")

    # Инициализация клиента в зависимости от протокола
    if protocol == 'udp':
        client = UDPClient(host, port)
    elif protocol == 'tcp':
        client = TCPClient(host, port)
    else:
        client = None  # HTTP использует requests
    
    # Инициализация шифрования
    enc_manager = None
    if encrypt:
        enc_manager = EncryptionManager(encryption_key)

    try:
        while True:
            # Собираем логи локально
            raw_logs = collect_logs(source=source, limit=limit)
            
            if not raw_logs:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No logs collected")
            else:
                try:
                    # Шифруем если нужно
                    if encrypt and enc_manager:
                        logs_to_send = enc_manager.encrypt_json(raw_logs)
                        # Для UDP/TCP отправляем зашифрованные данные
                        if protocol in ['udp', 'tcp']:
                            # В реальной реализации нужно будет расшифровывать на сервере
                            # Пока отправляем как есть
                            pass
                    else:
                        logs_to_send = raw_logs
                    
                    # Отправляем в зависимости от протокола
                    if protocol == 'udp':
                        success = client.send_logs(logs_to_send)
                        if success:
                            print(
                                f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
                                f"Sent {len(raw_logs)} logs via UDP"
                            )
                        else:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] UDP send failed")
                    
                    elif protocol == 'tcp':
                        success = client.send_logs(logs_to_send)
                        if success:
                            print(
                                f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
                                f"Sent {len(raw_logs)} logs via TCP"
                            )
                        else:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] TCP send failed")
                    
                    else:  # HTTP
                        response = requests.post(
                            f"{server_url.rstrip('/')}/logs",
                            json=logs_to_send,
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
    finally:
        if client:
            client.close()


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
    sp_server.add_argument("--ssl-cert", help="Path to SSL certificate file (for HTTPS)")
    sp_server.add_argument("--ssl-key", help="Path to SSL private key file (for HTTPS)")

    # Клиент-аудитор (GUI)
    sp_client = subs.add_parser("client", help="Run client GUI (auditor) to view logs")
    sp_client.add_argument("--server", required=True, help="Server base URL, e.g. http://127.0.0.1:8080")

    # Клиент-агент
    sp_agent = subs.add_parser("agent", help="Run agent to collect logs and send to server")
    sp_agent.add_argument("--server", required=True, help="Server URL: http://, udp://, or tcp:// (e.g. http://127.0.0.1:8080)")
    sp_agent.add_argument("--source", default="auto", help="Log source: auto, journal, eventlog, file")
    sp_agent.add_argument("--limit", type=int, default=200, help="Number of events to collect per cycle")
    sp_agent.add_argument("--interval", type=int, default=60, help="Interval between sends (seconds)")
    sp_agent.add_argument("--encrypt", action="store_true", help="Enable encryption for data transmission")
    sp_agent.add_argument("--encryption-key", help="Encryption key (if not provided, default key is used)")

    args = parser.parse_args()

    if args.mode == "server":
        run_server(args.host, args.port, args.db, args.ssl_cert, args.ssl_key)
        return

    if args.mode == "client":
        run_client(args.server)
        return

    if args.mode == "agent":
        run_agent(args.server, args.source, args.limit, args.interval, 
                 args.encrypt, args.encryption_key)
        return


if __name__ == "__main__":
    main()


