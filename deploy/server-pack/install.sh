#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

sudo apt update
sudo apt install -y python3 python3-venv python3-pip curl

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install -U pip
python -m pip install -U -r requirements-server.txt

echo "Установка завершена."
echo "Следующий шаг: ./run-server.sh"