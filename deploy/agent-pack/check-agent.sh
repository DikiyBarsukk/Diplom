#!/usr/bin/env bash
set -e
curl -fsS http://192.168.0.159:8080/health
echo
echo "Сервер доступен. Можно запускать ./run-agent.sh"
