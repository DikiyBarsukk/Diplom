# 📋 Сценарий использования: Аудит Linux-машины

## 🎯 Цель сценария

Настроить систему аудита для мониторинга логов одной Linux-машины. Агент будет собирать логи локально через `journalctl` и отправлять их на сервер для централизованного хранения и анализа.

---

## 📋 Предварительные требования

1. **Linux-машина** (Ubuntu/Debian/CentOS/RHEL) с systemd
2. **Сервер** (может быть на той же машине или отдельной)
3. **Python 3.10+** на обеих машинах
4. **Сетевое подключение** между машинами

---

## 🏗️ Архитектура сценария

```
┌─────────────────────────────────┐
│   Linux-машина (192.168.1.50)   │
│                                 │
│  ┌─────────────┐               │
│  │   Агент     │ ────────┐      │
│  │  (journal)  │         │      │
│  └─────────────┘         │      │
│                          │ HTTP │
│                          ▼      │
│  ┌─────────────────────────────────┐
│  │   Сервер (192.168.1.100)        │
│  │  - Принимает логи               │
│  │  - Нормализует                  │
│  │  - Сохраняет в SQLite           │
│  └─────────────────────────────────┘
│                          │
│                          │ HTTP │
│                          ▼      │
│  ┌─────────────────────────────────┐
│  │   Клиент-аудитор                │
│  │   (Windows/Linux)               │
│  │  - Просмотр логов               │
│  │  - Фильтрация                   │
│  │  - Статистика                   │
│  └─────────────────────────────────┘
```

---

## 📝 Пошаговая инструкция

### Шаг 1: Подготовка Linux-машины

#### 1.1 Проверка системы

```bash
# Проверяем версию Python
python3 --version
# Должно быть: Python 3.10 или выше

# Проверяем доступность journalctl
journalctl --version

# Проверяем hostname
hostname
# Запомните это имя (например: ubuntu-server)
```

#### 1.2 Добавление пользователя в группу systemd-journal

Для чтения логов через journalctl нужны права:

```bash
# Добавляем текущего пользователя в группу systemd-journal
sudo usermod -aG systemd-journal $USER

# Проверяем членство в группе
groups

# Важно: нужно перелогиниться для применения изменений
# Выполните: exit и зайдите снова, ИЛИ используйте:
newgrp systemd-journal
```

#### 1.3 Проверка доступа к логам

```bash
# Пробуем прочитать последние логи
journalctl -n 10 --no-pager

# Если видите логи - всё хорошо!
# Если ошибка доступа - проверьте права группы
```

---

### Шаг 2: Установка зависимостей на Linux-машине

#### 2.1 Клонирование/копирование проекта

```bash
# Перейдите в директорию проекта
cd ~/audit-app
# или
cd /путь/к/проекту/ПО
```

#### 2.2 Установка зависимостей для агента

```bash
# Обновляем pip
python3 -m pip install --user -U pip

# Устанавливаем зависимости клиента (агент)
python3 -m pip install --user -U -r requirements-client.txt
```

**Проверка установки:**
```bash
python3 -c "import requests; print('requests OK')"
```

---

### Шаг 3: Настройка сервера

Сервер может быть на той же Linux-машине или на отдельной машине.

#### 3.1 Установка зависимостей сервера

**Если сервер на той же Linux-машине:**
```bash
python3 -m pip install --user -U -r requirements-server.txt
```

**Если сервер на отдельной машине (Linux/Windows):**
- Следуйте инструкциям из `ИНСТРУКЦИЯ.md` для установки сервера

#### 3.2 Запуск сервера

```bash
# Запускаем сервер на порту 8080
python3 main.py server --host 0.0.0.0 --port 8080 --db logs.db
```

**Ожидаемый вывод:**
```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
```

**Проверка работы сервера:**
```bash
# В другом терминале проверяем health endpoint
curl http://localhost:8080/health

# Должен вернуть:
# {"status":"ok","host":"ubuntu-server","version":"0.2"}
```

**Важно:** Оставьте сервер запущенным в отдельном терминале или используйте `screen`/`tmux`:

```bash
# Установка screen (если нет)
sudo apt-get install screen  # Ubuntu/Debian
# или
sudo yum install screen     # CentOS/RHEL

# Создаём сессию
screen -S server

# Запускаем сервер
python3 main.py server --host 0.0.0.0 --port 8080

# Отключаемся: Ctrl+A, затем D
# Подключаемся обратно: screen -r server
```

---

### Шаг 4: Запуск агента на Linux-машине

#### 4.1 Определение IP-адреса сервера

```bash
# Если сервер на той же машине:
SERVER_URL="http://127.0.0.1:8080"

# Если сервер на другой машине:
SERVER_URL="http://192.168.1.100:8080"  # Замените на IP вашего сервера

# Проверяем доступность сервера
curl $SERVER_URL/health
```

#### 4.2 Запуск агента

```bash
# Запускаем агент для сбора логов через journalctl
python3 main.py agent \
  --server http://192.168.1.100:8080 \
  --source journal \
  --limit 200 \
  --interval 60
```

**Параметры:**
- `--server` - URL сервера (замените на ваш IP)
- `--source journal` - источник логов (journalctl)
- `--limit 200` - количество событий за раз
- `--interval 60` - интервал отправки (60 секунд)

**Ожидаемый вывод:**
```
Agent started. Collecting logs from: journal
Sending to: http://192.168.1.100:8080
Interval: 60 seconds
Press Ctrl+C to stop

[2024-01-15 14:30:00] Sent 45 logs, saved 45, skipped 0
[2024-01-15 14:31:00] Sent 12 logs, saved 12, skipped 0
[2024-01-15 14:32:00] Sent 8 logs, saved 8, skipped 0
```

**Важно:** Оставьте агент запущенным. Он будет автоматически собирать и отправлять логи каждые 60 секунд.

**Для запуска в фоне (screen):**
```bash
screen -S agent
python3 main.py agent --server http://192.168.1.100:8080 --source journal --interval 60
# Ctrl+A, затем D для отключения
```

---

### Шаг 5: Запуск клиента-аудитора

Клиент можно запустить на любой машине (Windows/Linux), которая имеет доступ к серверу.

#### 5.1 Установка зависимостей клиента

**На Windows:**
```powershell
python -m pip install -U -r requirements-client.txt
```

**На Linux:**
```bash
python3 -m pip install --user -U -r requirements-client.txt
```

#### 5.2 Запуск GUI

```bash
# Windows
python main.py client --server http://192.168.1.100:8080

# Linux
python3 main.py client --server http://192.168.1.100:8080
```

**После запуска:**
1. Откроется окно с таблицей логов
2. Нажмите "Fetch" для загрузки логов
3. Используйте фильтры:
   - **Host:** введите hostname (например: `ubuntu-server`)
   - **Severity:** выберите уровень важности (err, warn, info и т.д.)
   - **Limit:** количество событий для отображения
4. Нажмите "Stats" для просмотра статистики

---

## 🔍 Примеры использования

### Пример 1: Просмотр всех критических ошибок

В GUI клиента:
1. **Severity:** выберите `err`
2. **Limit:** 100
3. Нажмите **Fetch**

Вы увидите все ошибки, собранные с Linux-машины.

### Пример 2: Просмотр логов конкретного хоста

В GUI клиента:
1. **Host:** введите `ubuntu-server` (ваш hostname)
2. **Severity:** оставьте пустым (все уровни)
3. **Limit:** 200
4. Нажмите **Fetch**

### Пример 3: Получение статистики через API

```bash
# Получаем статистику
curl http://192.168.1.100:8080/stats

# Пример ответа:
# {
#   "total_events": 1234,
#   "hosts": {"ubuntu-server": 1234},
#   "severity": {"err": 5, "warn": 23, "info": 1206},
#   "last_event_time": "2024-01-15T14:32:00.123456"
# }
```

### Пример 4: Получение логов через API

```bash
# Получаем последние 10 ошибок
curl "http://192.168.1.100:8080/api/logs?severity=err&limit=10"

# Получаем логи за последний час
curl "http://192.168.1.100:8080/api/logs?since=2024-01-15T13:00:00&limit=50"

# Получаем логи конкретного хоста
curl "http://192.168.1.100:8080/api/logs?host=ubuntu-server&limit=20"
```

---

## 🧪 Тестирование системы

### Тест 1: Проверка сбора логов

```bash
# На Linux-машине создаём тестовое событие
logger "Тестовое сообщение для аудита"

# Ждём 60 секунд (интервал агента)

# Проверяем, что событие появилось на сервере
curl "http://192.168.1.100:8080/api/logs?limit=1" | grep "Тестовое сообщение"
```

### Тест 2: Проверка статистики

```bash
# Запускаем агент на 5 минут, затем проверяем статистику
curl http://192.168.1.100:8080/stats

# Должны увидеть:
# - total_events > 0
# - hosts содержит ваш hostname
# - severity содержит различные уровни
```

### Тест 3: Проверка фильтрации

В GUI клиента:
1. Выберите **Severity:** `err`
2. Нажмите **Fetch**
3. Все отображаемые события должны иметь `severity: err`

---

## 🔧 Настройка автозапуска (опционально)

### Автозапуск сервера через systemd

Создайте файл `/etc/systemd/system/audit-server.service`:

```ini
[Unit]
Description=Audit Log Server
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/audit-app
ExecStart=/usr/bin/python3 main.py server --host 0.0.0.0 --port 8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Активация:
```bash
sudo systemctl daemon-reload
sudo systemctl enable audit-server
sudo systemctl start audit-server
sudo systemctl status audit-server
```

### Автозапуск агента через systemd

Создайте файл `/etc/systemd/system/audit-agent.service`:

```ini
[Unit]
Description=Audit Log Agent
After=network.target audit-server.service

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/audit-app
ExecStart=/usr/bin/python3 main.py agent --server http://127.0.0.1:8080 --source journal --interval 60
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Активация:
```bash
sudo systemctl daemon-reload
sudo systemctl enable audit-agent
sudo systemctl start audit-agent
sudo systemctl status audit-agent
```

---

## 📊 Мониторинг и обслуживание

### Просмотр статуса сервера

```bash
# Проверка здоровья
curl http://localhost:8080/health

# Просмотр статистики
curl http://localhost:8080/stats
```

### Просмотр логов агента

```bash
# Если агент запущен в screen
screen -r agent

# Просмотр последних событий
tail -f /var/log/syslog | grep audit-agent
```

### Резервное копирование базы данных

```bash
# Остановите сервер
# Создайте копию базы данных
cp logs.db logs.db.backup.$(date +%Y%m%d_%H%M%S)

# Или используйте SQLite backup
sqlite3 logs.db ".backup 'logs.db.backup'"
```

---

## ❓ Частые проблемы и решения

### Проблема: Агент не может подключиться к серверу

**Решение:**
```bash
# Проверьте, что сервер запущен
curl http://192.168.1.100:8080/health

# Проверьте файрвол
sudo ufw status
sudo ufw allow 8080/tcp

# Проверьте, что сервер слушает на правильном интерфейсе
netstat -tlnp | grep 8080
```

### Проблема: Агент не может читать journalctl

**Решение:**
```bash
# Проверьте членство в группе
groups | grep systemd-journal

# Если нет, добавьте и перелогиньтесь
sudo usermod -aG systemd-journal $USER
newgrp systemd-journal

# Проверьте доступ
journalctl -n 5 --no-pager
```

### Проблема: Нет логов в базе данных

**Решение:**
```bash
# Проверьте, что агент отправляет логи
# Смотрите вывод агента - должны быть сообщения "Sent X logs"

# Проверьте базу данных
sqlite3 logs.db "SELECT COUNT(*) FROM events;"

# Если 0, проверьте логи агента на ошибки
```

---

## 📈 Результат

После выполнения всех шагов у вас будет:

✅ **Работающий агент** на Linux-машине, собирающий логи через journalctl  
✅ **Сервер**, принимающий и хранящий логи в SQLite  
✅ **Клиент-аудитор** для просмотра и анализа логов  
✅ **Централизованное хранилище** всех логов  
✅ **История логов** в базе данных  
✅ **Фильтрация и поиск** через GUI  

Система готова к использованию! 🎉

