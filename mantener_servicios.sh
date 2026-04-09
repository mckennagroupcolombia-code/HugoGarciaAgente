#!/bin/bash
# Script para mantener los servicios del agente McKenna Group activos
# Uso: ./mantener_servicios.sh (ejecutar en background con &)

LOG="/home/mckg/mi-agente/.services_watcher.log"
VENV="/home/mckg/mi-agente/venv/bin/python3"
DIR="/home/mckg/mi-agente"

echo "$(date): Iniciando supervisor de servicios..." >> $LOG

while true; do
    # Website (8083)
    if ! pgrep -f "website.py" > /dev/null 2>&1; then
        echo "$(date): Reiniciando website..." >> $LOG
        cd $DIR
        nohup $VENV -u PAGINA_WEB/site/website.py >> .website.log 2>&1 &
    fi

    # Agente Pro (8081)
    if ! pgrep -f "agente_pro.py" > /dev/null 2>&1; then
        echo "$(date): Reiniciando agente_pro..." >> $LOG
        cd $DIR
        nohup $VENV -u agente_pro.py >> .agente.log 2>&1 &
    fi

    # Webhook MeLi (8080)
    if ! pgrep -f "webhook_meli.py" > /dev/null 2>&1; then
        echo "$(date): Reiniciando webhook_meli..." >> $LOG
        cd $DIR
        nohup $VENV -u webhook_meli.py >> .webhook.log 2>&1 &
    fi

    # Cloudflare Tunnel
    if ! pgrep -f "cloudflared" > /dev/null 2>&1; then
        echo "$(date): Reiniciando tunnel..." >> $LOG
        source $DIR/.env 2>/dev/null
        if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
            cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" >> $DIR/.tunnel_output.log 2>&1 &
        fi
    fi

    sleep 30
done
