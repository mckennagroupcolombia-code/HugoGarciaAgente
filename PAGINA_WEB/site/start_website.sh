#!/bin/bash
# Inicia el website nativo de McKenna Group en puerto 8082
cd "$(dirname "$0")"
source /home/mckg/mi-agente/venv/bin/activate
exec gunicorn -w 2 -b 0.0.0.0:8083 website:app 2>/dev/null || exec python3 website.py
