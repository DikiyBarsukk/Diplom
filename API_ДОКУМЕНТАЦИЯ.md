# API документация BARSUKSIEM

## Обзор

BARSUKSIEM использует FastAPI приложение, собираемое через `create_app()` в `server/app_factory.py`.

Канонические программные маршруты находятся под `/api/...`. HTML-страницы `/`, `/logs`, `/incidents`, `/analytics`, `/inventory`, `/compliance` не должны использоваться как программный API.

## Аутентификация

Модель доступа:

- вход выполняется через `POST /api/auth/login`
- сервер создает `session_token` cookie
- для операций изменения данных используется CSRF header `X-CSRF-Token`
- актуальный пользователь и CSRF token получаются через `GET /api/auth/me`

### POST /api/auth/login

Request body:

```json
{
  "username": "admin",
  "password": "Admin123!Test"
}
```

Response `200 OK`:

```json
{
  "status": "ok",
  "token": "session-token",
  "csrf_token": "csrf-token",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

Дополнительно сервер выставляет cookie `session_token` и дублирует CSRF token в header `X-CSRF-Token`.

### GET /api/auth/me

Response `200 OK`:

```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "csrf_token": "csrf-token"
}
```

### POST /api/auth/logout

Требует валидную сессию и header `X-CSRF-Token`.

Response `200 OK`:

```json
{
  "status": "ok"
}
```

Без CSRF token сервер возвращает `403`.

## Публичные маршруты

### GET /health

Проверка состояния приложения.

Response:

```json
{
  "status": "ok",
  "host": "server-hostname",
  "version": "0.5"
}
```

### POST /api/logs

Основной маршрут для приема логов от агента.

Request body: массив нормализуемых или сырых событий.

Response:

```json
{
  "status": "ok",
  "received": 10,
  "saved": 10,
  "skipped": 0,
  "incidents_detected": 1
}
```

Примечание: `POST /logs` сохранен как compatibility alias, но в клиентах и документации нужно использовать `POST /api/logs`.

## Защищенные маршруты

### GET /api/logs

Параметры:

- `host`
- `severity`
- `since`
- `search`
- `limit`
- `offset`

Возвращает список событий.

### GET /api/stats

Возвращает сводную статистику по событиям.

Типичные поля ответа:

- `total_events`
- `severity`
- `hosts`
- агрегаты по источникам и единицам журнала

`GET /stats` сохранен только как compatibility alias.

### GET /api/incidents

Параметры:

- `incident_type`
- `severity`
- `status`
- `search`
- `since`
- `limit`
- `offset`

Возвращает список выявленных инцидентов.

### GET /api/incidents/stats

Возвращает агрегированную статистику по инцидентам, включая группировки по статусам и критичности.

### GET /api/incidents/rules

Возвращает список активных правил incident detection.

### GET /api/agents/stats

Параметр:

- `window_minutes` - окно оценки активности агентов

### GET /api/audit

Доступен роли `admin` с permission `manage_users`.

Параметры:

- `limit`
- `offset`

Возвращает журнал действий пользователей.

## Формат события

Нормализованное событие содержит поля вида:

```json
{
  "ts": "2026-03-16T12:00:00+00:00",
  "host": "pc-01",
  "source": "journal",
  "unit": "sshd",
  "process": "sshd",
  "pid": 123,
  "uid": 1000,
  "severity": "warn",
  "message": "authentication failed",
  "raw": {},
  "ingest_ts": "2026-03-16T12:00:03+00:00",
  "hash": "..."
}
```

## Формат инцидента

Типичный инцидент содержит:

```json
{
  "id": 1,
  "rule_id": "R001",
  "incident_type": "brute_force",
  "severity": "high",
  "title": "Brute Force Attack on host",
  "description": "...",
  "host": "pc-01",
  "detected_at": "2026-03-16T12:10:00+00:00"
}
```

## Коды ошибок

- `400` - некорректный запрос, например пустой список логов
- `401` - отсутствует или невалидна аутентификация
- `403` - нет прав или отсутствует CSRF token
- `429` - превышен rate limit
- `500` - внутренняя ошибка сервера

## Пример Python

```python
import requests

session = requests.Session()
login = session.post(
    'http://127.0.0.1:8080/api/auth/login',
    json={'username': 'admin', 'password': 'Admin123!Test'},
)
login.raise_for_status()
csrf_token = login.headers['X-CSRF-Token']

stats = session.get('http://127.0.0.1:8080/api/stats')
print(stats.json())

logout = session.post(
    'http://127.0.0.1:8080/api/auth/logout',
    headers={'X-CSRF-Token': csrf_token},
)
logout.raise_for_status()
```

## Пример JavaScript

```javascript
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'Admin123!Test' })
});

const csrfToken = loginResponse.headers.get('X-CSRF-Token');
const statsResponse = await fetch('/api/stats', {
  credentials: 'include'
});
```

## Проверенные сценарии

Integration tests подтверждают:

- успешный login / me / logout
- отказ logout без CSRF token
- ingest demo логов
- доступ к `/api/logs`, `/api/stats`, `/api/incidents`
- отказ доступа к защищенным маршрутам без аутентификации
