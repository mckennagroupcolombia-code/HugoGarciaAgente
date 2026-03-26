#!/bin/bash
cd /home/mckg/mi-agente
source venv/bin/activate
# Ahora ejecutamos el proceso completo en lugar de solo el reporte
python3 proceso_completo.py >> log_cron.txt 2>&1
