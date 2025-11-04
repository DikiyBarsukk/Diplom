#!/usr/bin/env bash
set -euo pipefail

python3 -m pip install -U pip
python3 -m pip install -U -r requirements-server.txt
echo "Server dependencies installed. Run: python main.py server --host 0.0.0.0 --port 8080"





