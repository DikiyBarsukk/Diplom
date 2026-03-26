# BARSUKSIEM: подробная инструкция для 3 Linux ВМ

## 1. Что мы будем делать

В этой инструкции мы развернем BARSUKSIEM на трех отдельных виртуальных машинах:

- ВМ 1 - сервер BARSUKSIEM
- ВМ 2 - агент сбора логов
- ВМ 3 - рабочее место аудитора

После выполнения инструкции у вас будет работать такая схема:

1. Агент на ВМ 2 собирает логи.
2. Агент отправляет логи на сервер на ВМ 1.
3. Сервер сохраняет события, строит статистику и выявляет инциденты.
4. Аудитор на ВМ 3 открывает web UI в браузере и при необходимости запускает desktop-клиент.

Это инструкция "для чайника", поэтому здесь уже выбраны простые значения по умолчанию:

- порт сервера: `8080`
- протокол: обычный `http`
- база данных: локальная SQLite на серверной ВМ
- режим агента: `--source auto`
- интервал отправки логов: `60` секунд

## 2. Что нужно подготовить заранее

До начала работы подготовьте:

- 3 виртуальные машины с Linux
- Python `3.11` или новее на всех 3 ВМ
- сетевую связность между ВМ
- доступ по SSH или через консоль к каждой ВМ
- IP-адреса всех трех машин

Для примеров ниже будем считать:

- ВМ 1, сервер: `192.168.56.10`
- ВМ 2, агент: `192.168.56.11`
- ВМ 3, аудитор: `192.168.56.12`

Если у вас другие адреса, просто замените их в командах.

## 3. Что должно быть доступно по сети

Минимально нужно обеспечить:

- с ВМ 2 на ВМ 1 должен открываться порт `8080`
- с ВМ 3 на ВМ 1 должен открываться порт `8080`
- на ВМ 1 сервер должен слушать `0.0.0.0:8080`

Проверка с ВМ 2 и ВМ 3:

```bash
curl http://192.168.56.10:8080/health
```

Если сервер еще не запущен, команда сначала не сработает. Это нормально.

## 4. Какие файлы нужны на каждой ВМ

### 4.1 ВМ 1 - сервер

На серверную ВМ нужно скопировать:

- `main.py`
- `requirements-server.txt`
- весь каталог `server/`
- весь каталог `common/`
- весь каталог `web/`

На серверную ВМ не нужно копировать:

- `tests/`
- `.venv/`
- `.idea/`
- `client/`
- лишние markdown-документы, если они не нужны на самой машине

Рекомендуемая раскладка на сервере:

```text
/opt/barsuksiem/server/
├─ app/
│  ├─ main.py
│  ├─ requirements-server.txt
│  ├─ server/
│  ├─ common/
│  └─ web/
├─ data/
├─ logs/
└─ env/
```

### 4.2 ВМ 2 - агент

На агентную ВМ нужно скопировать:

- `main.py`
- `requirements-client.txt`
- `client/agent.py`
- `client/encryption.py`
- `client/udp_client.py`
- весь каталог `common/`

На агентную ВМ не нужно копировать:

- `server/`
- `web/`
- `tests/`
- `client/gui.py`
- `client/connection.py`
- `.venv/`
- `.idea/`

Рекомендуемая раскладка на агенте:

```text
/opt/barsuksiem/agent/
├─ app/
│  ├─ main.py
│  ├─ requirements-client.txt
│  ├─ client/
│  │  ├─ agent.py
│  │  ├─ encryption.py
│  │  └─ udp_client.py
│  └─ common/
├─ logs/
└─ env/
```

### 4.3 ВМ 3 - аудитор

На ВМ аудитора нужно скопировать:

- `main.py`
- `requirements-client.txt`
- `client/gui.py`
- `client/connection.py`
- `client/encryption.py`
- `client/udp_client.py`

На ВМ аудитора не нужно копировать:

- `server/`
- `web/`
- `tests/`
- `common/`
- `.venv/`
- `.idea/`

Рекомендуемая раскладка на ВМ аудитора:

```text
/opt/barsuksiem/auditor/
├─ app/
│  ├─ main.py
│  ├─ requirements-client.txt
│  └─ client/
│     ├─ gui.py
│     ├─ connection.py
│     ├─ encryption.py
│     └─ udp_client.py
└─ env/
```

## 5. Как правильно копировать файлы

Самый простой вариант:

1. На вашей основной машине подготовить 3 отдельных папки:
   - одну для сервера
   - одну для агента
   - одну для аудитора
2. Разложить в них файлы по спискам выше.
3. Передать их на соответствующие ВМ.

Пример передачи через `scp`:

```bash
scp -r server_bundle/* user@192.168.56.10:/opt/barsuksiem/server/app/
scp -r agent_bundle/* user@192.168.56.11:/opt/barsuksiem/agent/app/
scp -r auditor_bundle/* user@192.168.56.12:/opt/barsuksiem/auditor/app/
```

Если у вас нет `scp`, можно:

- передать через общую папку гипервизора
- использовать архив `.tar.gz`
- использовать любой файловый менеджер или SFTP

Главное правило:

- на каждую ВМ копируйте только те файлы, которые нужны именно этой роли

## 6. Настройка ВМ 1 - сервер

### 6.1 Создаем каталоги

```bash
sudo mkdir -p /opt/barsuksiem/server/app
sudo mkdir -p /opt/barsuksiem/server/data
sudo mkdir -p /opt/barsuksiem/server/logs
sudo mkdir -p /opt/barsuksiem/server/env
sudo chown -R $USER:$USER /opt/barsuksiem/server
```

### 6.2 Переходим в каталог приложения

```bash
cd /opt/barsuksiem/server/app
```

### 6.3 Создаем виртуальное окружение

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 6.4 Устанавливаем зависимости

```bash
python -m pip install -U pip
python -m pip install -U -r requirements-server.txt
```

### 6.5 Создаем env-файл сервера

Создайте файл:

```text
/opt/barsuksiem/server/env/server.env
```

Содержимое:

```bash
export BARSUKSIEM_BOOTSTRAP_ADMIN_USERNAME=admin
export BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD=StrongPassword123!
export BARSUKSIEM_COOKIE_SECURE=false
export BARSUKSIEM_COOKIE_SAMESITE=lax
export BARSUKSIEM_SESSION_MAX_AGE=86400
export CORS_ALLOWED_ORIGINS=http://192.168.56.10:8080,http://192.168.56.12:8080,http://localhost:8080
```

Загрузите переменные:

```bash
source /opt/barsuksiem/server/env/server.env
```

### 6.6 Запускаем сервер

```bash
cd /opt/barsuksiem/server/app
source .venv/bin/activate
source /opt/barsuksiem/server/env/server.env
python main.py server --host 0.0.0.0 --port 8080 --db /opt/barsuksiem/server/data/logs.db
```

### 6.7 Проверяем сервер

На серверной ВМ:

```bash
curl http://127.0.0.1:8080/health
```

На агентной или аудиторской ВМ:

```bash
curl http://192.168.56.10:8080/health
```

### 6.8 Первый вход в web UI

На ВМ аудитора откройте в браузере:

```text
http://192.168.56.10:8080/login
```

Войдите с логином и паролем:

- логин: `admin`
- пароль: `StrongPassword123!`

## 7. Настройка ВМ 2 - агент

### 7.1 Создаем каталоги

```bash
sudo mkdir -p /opt/barsuksiem/agent/app
sudo mkdir -p /opt/barsuksiem/agent/logs
sudo mkdir -p /opt/barsuksiem/agent/env
sudo chown -R $USER:$USER /opt/barsuksiem/agent
```

### 7.2 Создаем `venv` и ставим зависимости

```bash
cd /opt/barsuksiem/agent/app
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -U -r requirements-client.txt
```

### 7.3 Проверяем доступ к серверу

```bash
curl http://192.168.56.10:8080/health
```

### 7.4 Запускаем агента

```bash
cd /opt/barsuksiem/agent/app
source .venv/bin/activate
python main.py agent --server http://192.168.56.10:8080 --source auto --interval 60
```

Если хотите вручную выбрать источник, используйте:

```bash
python main.py agent --server http://192.168.56.10:8080 --source journal --interval 60
python main.py agent --server http://192.168.56.10:8080 --source file --interval 60
```

Для первого запуска оставляйте `--source auto`.

## 8. Настройка ВМ 3 - аудитор

### 8.1 Создаем каталоги

```bash
sudo mkdir -p /opt/barsuksiem/auditor/app
sudo mkdir -p /opt/barsuksiem/auditor/env
sudo chown -R $USER:$USER /opt/barsuksiem/auditor
```

### 8.2 Создаем `venv` и ставим зависимости

```bash
cd /opt/barsuksiem/auditor/app
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -U -r requirements-client.txt
```

### 8.3 Создаем env-файл аудитора

Создайте файл:

```text
/opt/barsuksiem/auditor/env/auditor.env
```

Содержимое:

```bash
export BARSUKSIEM_CLIENT_USERNAME=admin
export BARSUKSIEM_CLIENT_PASSWORD=StrongPassword123!
```

Загрузите переменные:

```bash
source /opt/barsuksiem/auditor/env/auditor.env
```

### 8.4 Проверяем доступ к серверу

```bash
curl http://192.168.56.10:8080/health
```

### 8.5 Работа через браузер

Откройте:

```text
http://192.168.56.10:8080/login
```

После входа проверьте страницы:

- `/`
- `/logs`
- `/incidents`
- `/analytics`

### 8.6 Запуск desktop-клиента

```bash
cd /opt/barsuksiem/auditor/app
source .venv/bin/activate
source /opt/barsuksiem/auditor/env/auditor.env
python main.py client --server http://192.168.56.10:8080
```

Рекомендуемый вариант для аудитора:

- web UI использовать как основной интерфейс
- desktop GUI держать как дополнительный клиент

## 9. Порядок первого запуска всей системы

1. Подготовить файлы на всех 3 ВМ.
2. На серверной ВМ создать `venv`, установить зависимости и задать env.
3. Запустить сервер.
4. Проверить `http://SERVER_IP:8080/health`.
5. На ВМ аудитора открыть `/login`.
6. Войти под администратором.
7. На агентной ВМ создать `venv`, установить зависимости и запустить агент.
8. Подождать 1-2 цикла отправки логов.
9. На ВМ аудитора открыть `/logs`.
10. Убедиться, что события появились.
11. Открыть `/incidents`.
12. Убедиться, что инциденты и статистика работают.
13. При необходимости запустить desktop GUI аудитора.

## 10. Полный чек-лист проверки

### 10.1 Проверка сервера

- сервер стартует без ошибок
- `/health` отвечает
- `/login` открывается
- вход под `admin` работает

### 10.2 Проверка агента

- агент запускается без traceback
- агент видит доступный источник логов
- агент отправляет данные на `/api/logs`
- в консоли агента видно подтверждение отправки

### 10.3 Проверка аудитора

- web UI открывается
- после входа доступны `/logs` и `/incidents`
- desktop-клиент запускается
- desktop-клиент подключается к серверу

### 10.4 Сквозная проверка

- сервер поднят
- агент запущен
- в `/logs` появились события
- в `/incidents` появились записи
- `/analytics` открывается и показывает данные

## 11. Типовые ошибки и что делать

### 11.1 Сервер не стартует

Проверьте:

- установлен ли Python 3.11+
- активировано ли `venv`
- выполнена ли установка из `requirements-server.txt`
- существует ли каталог для базы данных
- не занят ли порт `8080`

### 11.2 `/health` не отвечает

Проверьте:

- что сервер действительно запущен
- что он стартовал с `--host 0.0.0.0`
- что firewall не блокирует `8080`
- что вы используете правильный IP сервера

### 11.3 Не открывается `/login`

Проверьте:

- что сервер работает
- что вы открываете именно `http://SERVER_IP:8080/login`
- что порт `8080` доступен с ВМ аудитора

### 11.4 Не удается войти

Проверьте:

- что загружен `server.env`
- что логин и пароль соответствуют `BARSUKSIEM_BOOTSTRAP_ADMIN_USERNAME` и `BARSUKSIEM_BOOTSTRAP_ADMIN_PASSWORD`
- что браузер не блокирует cookie

### 11.5 Агент не шлет логи

Проверьте:

- доступен ли `http://SERVER_IP:8080/health`
- правильно ли указан `--server`
- хватает ли прав на чтение логов
- попробуйте вместо `--source auto` использовать `--source journal`

### 11.6 В `/logs` ничего нет

Проверьте:

- что агент действительно запущен
- что агент не пишет ошибку отправки
- что сервер доступен по сети
- подождите не меньше 60 секунд после запуска агента

### 11.7 Desktop-клиент не подключается

Проверьте:

- заданы ли `BARSUKSIEM_CLIENT_USERNAME`
- заданы ли `BARSUKSIEM_CLIENT_PASSWORD`
- правильно ли указан `--server`
- открывается ли `/health` с ВМ аудитора

## 12. Как останавливать и запускать заново

### 12.1 Остановка

Если процесс запущен в текущем терминале:

```bash
Ctrl+C
```

### 12.2 Повторный запуск сервера

```bash
cd /opt/barsuksiem/server/app
source .venv/bin/activate
source /opt/barsuksiem/server/env/server.env
python main.py server --host 0.0.0.0 --port 8080 --db /opt/barsuksiem/server/data/logs.db
```

### 12.3 Повторный запуск агента

```bash
cd /opt/barsuksiem/agent/app
source .venv/bin/activate
python main.py agent --server http://192.168.56.10:8080 --source auto --interval 60
```

### 12.4 Повторный запуск аудитора

```bash
cd /opt/barsuksiem/auditor/app
source .venv/bin/activate
source /opt/barsuksiem/auditor/env/auditor.env
python main.py client --server http://192.168.56.10:8080
```

## 13. Как менять IP сервера

Если IP серверной ВМ изменился:

1. На агентной ВМ замените адрес в команде `--server`.
2. На ВМ аудитора замените адрес:
   - в браузере
   - в команде `python main.py client --server ...`
3. При необходимости обновите `CORS_ALLOWED_ORIGINS` в `server.env`.
4. Перезапустите сервер, агента и клиента.

## 14. Как делать резервную копию SQLite

База данных хранится на серверной ВМ.

Перед копированием лучше остановить сервер.

Пример:

```bash
cp /opt/barsuksiem/server/data/logs.db /opt/barsuksiem/server/data/logs.db.bak
```

Лучше делать резервную копию в отдельный каталог:

```bash
mkdir -p /opt/barsuksiem/server/backup
cp /opt/barsuksiem/server/data/logs.db /opt/barsuksiem/server/backup/logs_$(date +%F_%H-%M-%S).db
```

## 15. Как обновлять проект без потери данных

Порядок обновления:

1. Остановить сервер.
2. Сделать резервную копию `logs.db`.
3. Сохранить `server.env` и `auditor.env`.
4. Обновить файлы приложения.
5. При необходимости заново выполнить:

```bash
source .venv/bin/activate
python -m pip install -U -r requirements-server.txt
```

или на клиентских ВМ:

```bash
source .venv/bin/activate
python -m pip install -U -r requirements-client.txt
```

6. Запустить сервер.
7. Проверить `/health`.
8. Запустить агента.
9. Проверить `/logs` и `/incidents`.

## 16. Что не нужно копировать на рабочие ВМ

Не копируйте на сервер, агент и аудитора:

- `.venv/`
- `.idea/`
- `tests/`
- временные файлы
- локальные кэши

Также:

- база SQLite должна быть только на серверной ВМ
- каталог `web/` должен быть только на серверной ВМ
- серверный каталог `server/` не нужен агенту и аудитору

## 17. Итоговая схема по ролям

### ВМ 1 - сервер

Хранит:

- API
- web UI
- SQLite базу
- auth и incident detection

Запуск:

```bash
python main.py server --host 0.0.0.0 --port 8080 --db /opt/barsuksiem/server/data/logs.db
```

### ВМ 2 - агент

Хранит:

- агент сбора логов
- общие утилиты для чтения логов

Запуск:

```bash
python main.py agent --server http://192.168.56.10:8080 --source auto --interval 60
```

### ВМ 3 - аудитор

Хранит:

- desktop GUI
- данные для подключения к серверу

Запуск GUI:

```bash
python main.py client --server http://192.168.56.10:8080
```

Web UI:

```text
http://192.168.56.10:8080/login
```
