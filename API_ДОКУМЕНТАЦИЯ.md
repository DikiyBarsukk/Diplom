# 📚 API Документация системы аудита логов

## Обзор

Система предоставляет RESTful API для работы с логами и управления пользователями. API использует FastAPI, который автоматически генерирует OpenAPI/Swagger документацию.

**Базовый URL**: `http://localhost:8080`  
**Версия API**: 0.4

---

## Аутентификация

Большинство эндпоинтов требуют аутентификации через сессионные токены.

### Процесс аутентификации:

1. **Вход в систему** через `POST /api/auth/login`
2. Получение `session_token` в cookie и `csrf_token` в заголовке ответа
3. Использование `session_token` в cookie для последующих запросов
4. Использование `csrf_token` в заголовке `X-CSRF-Token` для операций изменения данных

---

## Публичные эндпоинты

### GET /health

Проверка доступности сервера (не требует аутентификации).

**Response:**
```json
{
    "status": "ok",
    "host": "server-hostname",
    "version": "0.4"
}
```

**Example:**
```bash
curl http://localhost:8080/health
```

---

### POST /logs

Прием логов от агентов (не требует аутентификации).

**Request Body:**
```json
[
    {
        "host": "server1",
        "source": "journal",
        "message": "System started",
        "ts": "2024-01-01T12:00:00Z",
        "severity": "info"
    }
]
```

**Response:**
```json
{
    "status": "ok",
    "received": 1,
    "saved": 1,
    "skipped": 0
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '[{"host": "server1", "message": "Test log", "ts": "2024-01-01T12:00:00Z"}]'
```

---

## Эндпоинты аутентификации

### POST /api/auth/login

Аутентификация пользователя.

**Request Body:**
```json
{
    "username": "admin",
    "password": "Admin123!@#"
}
```

**Response:**
```json
{
    "status": "ok",
    "token": "session_token_here",
    "csrf_token": "csrf_token_here",
    "user": {
        "id": 1,
        "username": "admin",
        "role": "admin"
    }
}
```

**Cookies:**
- `session_token`: Токен сессии (HttpOnly, SameSite=Lax)

**Headers:**
- `X-CSRF-Token`: CSRF токен для защиты от CSRF атак

**Example:**
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "Admin123!@#"}' \
  -c cookies.txt
```

---

### POST /api/auth/logout

Выход из системы (требует аутентификации и CSRF токен).

**Headers:**
- `Cookie: session_token=...`
- `X-CSRF-Token: ...`

**Response:**
```json
{
    "status": "ok"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/auth/logout \
  -b cookies.txt \
  -H "X-CSRF-Token: csrf_token_here"
```

---

### GET /api/auth/me

Получение информации о текущем пользователе (требует аутентификации).

**Response:**
```json
{
    "id": 1,
    "username": "admin",
    "role": "admin",
    "csrf_token": "csrf_token_here"
}
```

**Example:**
```bash
curl http://localhost:8080/api/auth/me -b cookies.txt
```

---

## Эндпоинты работы с логами

### GET /logs

Получение логов с фильтрацией (требует аутентификации).

**Query Parameters:**
- `host` (optional, string): Фильтр по имени хоста
- `severity` (optional, string): Фильтр по уровню важности (emerg, alert, crit, err, warn, notice, info, debug)
- `since` (optional, string): Фильтр по времени (ISO формат, например "2024-01-01T00:00:00Z")
- `search` (optional, string): Поиск по содержимому сообщения (LIKE поиск)
- `limit` (optional, int): Максимальное количество событий (по умолчанию 200, максимум 1000)
- `offset` (optional, int): Смещение для пагинации (по умолчанию 0)

**Response:**
```json
[
    {
        "id": 1,
        "hash": "abc123...",
        "ts": "2024-01-01T12:00:00Z",
        "host": "server1",
        "source": "journal",
        "severity": "info",
        "message": "System started",
        "unit": "systemd",
        "process": "systemd",
        "pid": 1,
        "uid": 0,
        "raw": {},
        "ingest_ts": "2024-01-01T12:00:01Z"
    }
]
```

**Examples:**
```bash
# Получить последние 100 логов
curl "http://localhost:8080/logs?limit=100" -b cookies.txt

# Фильтр по хосту и уровню важности
curl "http://localhost:8080/logs?host=server1&severity=err" -b cookies.txt

# Поиск по содержимому
curl "http://localhost:8080/logs?search=error" -b cookies.txt

# События за последние 24 часа
curl "http://localhost:8080/logs?since=2024-01-01T00:00:00Z" -b cookies.txt

# Пагинация
curl "http://localhost:8080/logs?limit=50&offset=50" -b cookies.txt
```

---

### GET /stats

Получение статистики по логам (требует аутентификации).

**Response:**
```json
{
    "total_events": 10000,
    "hosts": {
        "server1": 5000,
        "server2": 5000
    },
    "severity": {
        "info": 8000,
        "warn": 1500,
        "err": 500
    },
    "last_event_time": "2024-01-01T12:00:00Z"
}
```

**Example:**
```bash
curl http://localhost:8080/stats -b cookies.txt
```

---

## Эндпоинты аудита

### GET /api/audit

Получение журнала аудита (требует права `manage_users`, обычно только для админов).

**Query Parameters:**
- `limit` (optional, int): Максимальное количество записей (по умолчанию 100, максимум 1000)
- `offset` (optional, int): Смещение для пагинации (по умолчанию 0)

**Response:**
```json
[
    {
        "id": 1,
        "user_id": 1,
        "username": "admin",
        "action": "login_success",
        "resource": null,
        "details": null,
        "ip_address": "127.0.0.1",
        "timestamp": "2024-01-01T12:00:00Z"
    }
]
```

**Example:**
```bash
curl "http://localhost:8080/api/audit?limit=50" -b cookies.txt -H "X-CSRF-Token: csrf_token_here"
```

---

## Коды ошибок

- **200 OK**: Успешный запрос
- **400 Bad Request**: Неверный формат запроса
- **401 Unauthorized**: Требуется аутентификация
- **403 Forbidden**: Недостаточно прав или неверный CSRF токен
- **404 Not Found**: Ресурс не найден
- **500 Internal Server Error**: Внутренняя ошибка сервера

---

## Форматы данных

### Событие (Event)

```json
{
    "id": 1,
    "hash": "sha1_hash_string",
    "ts": "2024-01-01T12:00:00Z",
    "host": "server1",
    "source": "journal|eventlog|file",
    "unit": "systemd",
    "process": "systemd",
    "pid": 1,
    "uid": 0,
    "severity": "emerg|alert|crit|err|warn|notice|info|debug",
    "message": "Log message text",
    "raw": {},
    "ingest_ts": "2024-01-01T12:00:00Z"
}
```

### Уровни важности (Severity)

- `emerg` - Emergency (0)
- `alert` - Alert (1)
- `crit` - Critical (2)
- `err` - Error (3)
- `warn` - Warning (4)
- `notice` - Notice (5)
- `info` - Information (6)
- `debug` - Debug (7)

---

## Swagger/OpenAPI документация

FastAPI автоматически генерирует интерактивную документацию:

- **Swagger UI**: `http://localhost:8080/docs`
- **ReDoc**: `http://localhost:8080/redoc`
- **OpenAPI JSON**: `http://localhost:8080/openapi.json`

---

## Примеры использования

### Python (requests)

```python
import requests

BASE_URL = "http://localhost:8080"

# Вход в систему
response = requests.post(
    f"{BASE_URL}/api/auth/login",
    json={"username": "admin", "password": "Admin123!@#"}
)
data = response.json()
session_token = response.cookies.get("session_token")
csrf_token = data["csrf_token"]

# Получение логов
headers = {"X-CSRF-Token": csrf_token}
cookies = {"session_token": session_token}
response = requests.get(
    f"{BASE_URL}/logs",
    params={"limit": 100, "severity": "err"},
    headers=headers,
    cookies=cookies
)
logs = response.json()

# Отправка логов (от агента)
logs_data = [
    {
        "host": "server1",
        "source": "journal",
        "message": "Test log",
        "ts": "2024-01-01T12:00:00Z"
    }
]
response = requests.post(f"{BASE_URL}/logs", json=logs_data)
result = response.json()
```

### JavaScript (fetch)

```javascript
const BASE_URL = "http://localhost:8080";

// Вход в систему
const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    credentials: "include",
    body: JSON.stringify({
        username: "admin",
        password: "Admin123!@#"
    })
});
const loginData = await loginResponse.json();
const csrfToken = loginData.csrf_token;

// Получение логов
const logsResponse = await fetch(
    `${BASE_URL}/logs?limit=100&severity=err`,
    {
        headers: {"X-CSRF-Token": csrfToken},
        credentials: "include"
    }
);
const logs = await logsResponse.json();
```

---

## Безопасность

### Защита от атак

- **Brute Force**: Rate limiting (5 попыток за 5 минут)
- **CSRF**: CSRF токены для операций изменения данных
- **SQL Injection**: Параметризованные запросы
- **XSS**: Санитизация входных данных
- **Timing Attacks**: Constant-time сравнение паролей

### Security Headers

Сервер автоматически устанавливает следующие заголовки:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: ...`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

---

## Эндпоинты анализа инцидентов ИБ

### GET /api/incidents

Получение списка инцидентов информационной безопасности с фильтрацией (требует аутентификации).

**Query Parameters:**
- `incident_type` (optional, string): Фильтр по типу инцидента (brute_force, unauthorized_access, suspicious_activity, log_tampering, privilege_escalation, anomaly, malware_indicator)
- `severity` (optional, string): Фильтр по критичности (critical, high, medium, low, info)
- `status` (optional, string): Фильтр по статусу (open, closed, investigating)
- `since` (optional, string): Фильтр по времени обнаружения (ISO формат)
- `limit` (optional, int): Максимальное количество инцидентов (по умолчанию 100, максимум 1000)
- `offset` (optional, int): Смещение для пагинации (по умолчанию 0)

**Response:**
```json
[
    {
        "id": 1,
        "rule_id": "R001",
        "incident_type": "brute_force",
        "severity": "high",
        "title": "Brute Force Attack on server1",
        "description": "Обнаружено 5 или более неудачных попыток входа за 10 минут",
        "host": "server1",
        "event_count": 5,
        "detected_at": "2024-01-15T10:01:00Z",
        "first_event_time": "2024-01-15T10:00:00Z",
        "last_event_time": "2024-01-15T10:01:00Z",
        "related_events": [1, 2, 3, 4, 5],
        "correlation_pattern": null,
        "status": "open"
    }
]
```

**Example:**
```bash
# Получить все критические инциденты
curl "http://localhost:8080/api/incidents?severity=critical" -b cookies.txt

# Получить инциденты brute force
curl "http://localhost:8080/api/incidents?incident_type=brute_force" -b cookies.txt

# Получить открытые инциденты за последние 24 часа
curl "http://localhost:8080/api/incidents?status=open&since=2024-01-14T00:00:00Z" -b cookies.txt
```

---

### GET /api/incidents/rules

Получение информации о всех правилах выявления инцидентов (требует аутентификации).

**Response:**
```json
[
    {
        "rule_id": "R001",
        "name": "Brute Force Attack Detection",
        "description": "Обнаружено 5 или более неудачных попыток входа за 10 минут",
        "severity": "high",
        "incident_type": "brute_force"
    }
]
```

**Example:**
```bash
curl http://localhost:8080/api/incidents/rules -b cookies.txt
```

---

### GET /api/incidents/stats

Получение статистики по инцидентам ИБ (требует аутентификации).

**Response:**
```json
{
    "total_incidents": 25,
    "by_type": {
        "brute_force": 10,
        "suspicious_activity": 5,
        "privilege_escalation": 2,
        "log_tampering": 1
    },
    "by_severity": {
        "critical": 3,
        "high": 12,
        "medium": 8,
        "low": 2
    },
    "by_status": {
        "open": 15,
        "closed": 8,
        "investigating": 2
    },
    "last_incident_time": "2024-01-15T10:01:00Z"
}
```

**Example:**
```bash
curl http://localhost:8080/api/incidents/stats -b cookies.txt
```

---

**Версия документа**: 1.1  
**Дата**: 2024

