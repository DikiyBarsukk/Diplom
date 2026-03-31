#!/usr/bin/env bash
set -e
curl -fsS http://192.168.0.159:8080/health > /dev/null
curl -fsS http://192.168.0.159:8080/login > /dev/null
echo "Сервер и страница входа доступны."
