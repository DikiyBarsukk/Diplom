#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source .venv/bin/activate

echo "Агент будет отправлять данные на http://192.168.0.159:8080"
echo "Режим: auto"
echo "Интервал: 60 секунд"
python main.py agent --server http://192.168.0.159:8080 --source auto --interval 60