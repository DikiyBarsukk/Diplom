#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p data
source .venv/bin/activate

DEMO_DB="$SCRIPT_DIR/data/demo.db"
DEMO_LOG="$SCRIPT_DIR/data/demo-server.log"
DEMO_PATTERN="main.py server .*data/demo.db"

if pgrep -f "$DEMO_PATTERN" > /dev/null 2>&1; then
  echo "Останавливаю предыдущий demo-сервер..."
  pkill -f "$DEMO_PATTERN" || true
  sleep 1
fi

if curl -fsS http://127.0.0.1:8080/health > /dev/null 2>&1; then
  echo "Порт 8080 уже занят другим сервером. Остановите его и повторите reset-demo.sh."
  exit 1
fi

rm -f "$DEMO_DB"
rm -f "$DEMO_LOG"

echo "Запускаю demo-сервер в фоне..."
export BARSUKSIEM_DEMO_MODE=1
nohup python main.py server --host 0.0.0.0 --port 8080 --db "$DEMO_DB" > "$DEMO_LOG" 2>&1 &

for _ in {1..40}; do
  if pgrep -f "$DEMO_PATTERN" > /dev/null 2>&1 && curl -fsS http://127.0.0.1:8080/health > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! pgrep -f "$DEMO_PATTERN" > /dev/null 2>&1; then
  echo "Demo-сервер не запустился. Смотрите лог: $DEMO_LOG"
  exit 1
fi

if ! curl -fsS http://127.0.0.1:8080/health > /dev/null 2>&1; then
  echo "Demo-сервер не ответил на /health. Смотрите лог: $DEMO_LOG"
  exit 1
fi

bash "$SCRIPT_DIR/load-demo.sh"

echo "Demo-стенд готов."
echo "Ubuntu: http://127.0.0.1:8080/login"
echo "Сеть/Windows-хост: http://192.168.0.159:8080/login"
echo "Логин: admin"
echo "Пароль: admin123"