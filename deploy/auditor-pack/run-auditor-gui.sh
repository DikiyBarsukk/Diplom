#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source .venv/bin/activate

echo "Desktop-клиент подключается к http://192.168.0.159:8080"
echo "Web UI на Ubuntu: http://127.0.0.1:8080/login"
echo "Дополнительно web UI можно открыть с Windows-хоста: http://192.168.0.159:8080/login"
echo "Логин: admin"
echo "Пароль: admin123"
python main.py client --server http://192.168.0.159:8080