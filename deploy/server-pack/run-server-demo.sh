#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p data
source .venv/bin/activate
export BARSUKSIEM_DEMO_MODE=1

echo "Demo-сервер BARSUKSIEM запускается на отдельной БД $SCRIPT_DIR/data/demo.db"
echo "Основной доступ на Ubuntu: http://127.0.0.1:8080/login"
echo "Дополнительный доступ из сети: http://192.168.0.159:8080/login"
echo "Логин: admin"
echo "Пароль: admin123"

python main.py server --host 0.0.0.0 --port 8080 --db "$SCRIPT_DIR/data/demo.db"