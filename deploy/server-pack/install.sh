#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

sudo apt update
sudo apt install -y python3 python3-venv python3-pip curl
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-server.txt

echo "Установка серверного пакета завершена."
echo "Обычный запуск: ./run-server.sh"
echo "Демо-режим для защиты: ./run-server-demo.sh"
echo "Полный сброс и автонаполнение демо-стенда: ./reset-demo.sh"