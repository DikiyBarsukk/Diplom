# Linux demo-сценарий для защиты BARSUKSIEM

## Цель

Показать на одной Linux-машине или в двух VM полный поток:

`agent -> /api/logs -> storage -> incidents -> web UI`

## Подготовка

```bash
export BARSUKSIEM_BOOTSTRAP_ADMIN_USERNAME=admin
export BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD=Admin123!Test
export CORS_ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
```

## Шаг 1. Запуск сервера

```bash
python main.py server --host 0.0.0.0 --port 8080
```

Проверка:

```bash
curl http://127.0.0.1:8080/health
```

## Шаг 2. Вход в web UI

- открыть `http://127.0.0.1:8080/login`
- войти под bootstrap admin
- показать главную страницу `/`

## Шаг 3. Запуск агента

```bash
python main.py agent --server http://127.0.0.1:8080 --source journal --interval 60
```

Если нужен воспроизводимый demo, можно использовать:

```bash
python main.py agent --server http://127.0.0.1:8080 --source file --interval 60
```

## Шаг 4. Показ логов

Открыть `/logs` и показать:

- новые события
- фильтрацию по severity
- фильтрацию по host
- поиск по message

## Шаг 5. Показ инцидентов

Открыть `/incidents` и показать:

- инциденты, созданные на основе поступивших событий
- карточку инцидента `/incidents/details?id=...`
- severity и rule-based классификацию

## Шаг 6. Показ аналитики

Открыть:

- `/`
- `/analytics`
- `/compliance`
- `/inventory`

## Шаг 7. Подтверждение воспроизводимости

```bash
python -m unittest discover -s tests -v
```

На защите имеет смысл отдельно проговорить, что тесты подтверждают login/logout/CSRF, ingest и ключевые incident rules.
