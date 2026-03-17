# Рекомендации по запуску BARSUKSIEM на Linux

## Подготовка

- убедитесь, что установлен Python 3.11+
- подготовьте отдельное виртуальное окружение
- при необходимости выдайте доступ к журналам systemd

## Установка

### Сервер

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements-server.txt
```

### Агент и desktop-клиент

```bash
python -m pip install -r requirements-client.txt
```

## Доступ к журналам Linux

Для чтения `journalctl` обычно требуется доступ к группе `systemd-journal`:

```bash
sudo usermod -aG systemd-journal $USER
```

После этого нужно перелогиниться.

## Рекомендуемый demo-запуск

```bash
export BARSUKSIEM_BOOTSTRAP_ADMIN_USERNAME=admin
export BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD=Admin123!Test
export CORS_ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080
python main.py server --host 0.0.0.0 --port 8080
```

В отдельном терминале:

```bash
python main.py agent --server http://127.0.0.1:8080 --source journal --interval 60
```

## Desktop-клиент на Linux

```bash
export BARSUKSIEM_CLIENT_USERNAME=admin
export BARSUKSIEM_CLIENT_PASSWORD=Admin123!Test
python main.py client --server http://127.0.0.1:8080
```

## Что проверять после запуска

- `curl http://127.0.0.1:8080/health`
- вход в `/login`
- появление данных в `/logs`
- наличие статистики в `/api/stats`
- наличие инцидентов в `/api/incidents`

## Практические рекомендации

- для production включайте HTTPS и `BARSUKSIEM_COOKIE_SECURE=true`
- используйте отдельную директорию для файла БД
- запускайте сервер под отдельным пользователем
- ограничивайте `CORS_ALLOWED_ORIGINS` конкретными origin
