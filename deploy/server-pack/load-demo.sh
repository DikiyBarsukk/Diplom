#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source .venv/bin/activate

curl -fsS http://127.0.0.1:8080/health > /dev/null
python scripts/load_demo_data.py --server http://127.0.0.1:8080 --fixture tests/data/demo_master_template.json

echo "Демо-данные загружены."
echo "Хосты сценариев: bf-srv-01, night-admin-01, powershell-01, tamper-01, priv-esc-01"
echo "Основные страницы: /, /incidents, /logs, /analytics"