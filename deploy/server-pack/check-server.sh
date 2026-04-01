#!/usr/bin/env bash
set -e
curl -fsS http://127.0.0.1:8080/health > /dev/null
echo "Сервер отвечает на локальном адресе http://127.0.0.1:8080/health"