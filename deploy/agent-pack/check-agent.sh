#!/usr/bin/env bash
set -e
curl -fsS http://192.168.0.159:8080/health > /dev/null
echo "Сервер доступен для агента по адресу http://192.168.0.159:8080"