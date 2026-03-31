#!/usr/bin/env bash
set -e
curl -fsS http://127.0.0.1:8080/health
echo
echo "Сервер отвечает. Можно открывать /login и запускать агента."