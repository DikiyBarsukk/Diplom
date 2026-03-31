#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p data
source .venv/bin/activate

echo "Сервер запускается на http://0.0.0.0:8080"
echo "Web UI: http://192.168.0.159:8080/login"
echo "Логин: admin"
echo "Пароль: admin123"
python main.py server --host 0.0.0.0 --port 8080 --db "$SCRIPT_DIR/data/logs.db"
