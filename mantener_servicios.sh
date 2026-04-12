#!/bin/bash
# Script para mantener los servicios del agente McKenna Group activos
# Uso: ./mantener_servicios.sh (ejecutar en background con &)
#
# Si corres unidades systemd (webhook-meli, mckenna-agente, mckenna-website, cloudflared),
# este script NO vuelve a lanzar esos procesos con nohup (un solo dueño por puerto).

LOG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.services_watcher.log"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/venv/bin/python3"
# shellcheck source=scripts/lib/mckenna_nohup_guard.sh
source "$DIR/scripts/lib/mckenna_nohup_guard.sh"

# Solo procesos Python reales (evita falsos positivos en líneas de bash que mencionan *.py)
_pgrep_py() {
    pgrep -af "python3.*${1}" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' || true
}

echo "$(date): Iniciando supervisor de servicios..." >> $LOG

while true; do
    # Website (8083)
    if mckenna_website_managed_by_systemd; then
        true
    elif [ -z "$(_pgrep_py 'PAGINA_WEB/site/website.py')" ]; then
        echo "$(date): Reiniciando website..." >> $LOG
        cd "$DIR" || exit 1
        nohup $VENV -u PAGINA_WEB/site/website.py >> .website.log 2>&1 &
    fi

    # Agente Pro (8081)
    if mckenna_agente_managed_by_systemd; then
        true
    elif [ -z "$(_pgrep_py 'agente_pro\.py')" ]; then
        echo "$(date): Reiniciando agente_pro..." >> $LOG
        cd "$DIR" || exit 1
        nohup $VENV -u agente_pro.py >> .agente.log 2>&1 &
    fi

    # Webhook MeLi (8080)
    if mckenna_webhook_managed_by_systemd; then
        # Un solo dueño: si hay otro webhook_meli.py (p. ej. sin -u, manual), matarlo.
        main_pid=$(systemctl show -p MainPID --value webhook-meli.service 2>/dev/null || echo "")
        if [ -n "$main_pid" ] && [ "$main_pid" != "0" ]; then
            for pid in $(pgrep -f "webhook_meli\\.py" 2>/dev/null || true); do
                [ "$pid" = "$main_pid" ] && continue
                case "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)" in
                    *cursorsandbox*|*cursor*sandbox*) continue ;;
                esac
                echo "$(date): webhook_meli duplicado PID $pid (MainPID systemd=$main_pid) → terminando" >> "$LOG"
                kill "$pid" 2>/dev/null || true
            done
        fi
    elif [ -z "$(_pgrep_py 'webhook_meli\.py')" ]; then
        echo "$(date): Reiniciando webhook_meli..." >> $LOG
        cd "$DIR" || exit 1
        nohup $VENV -u webhook_meli.py >> .webhook.log 2>&1 &
    fi

    # Cloudflare Tunnel
    if mckenna_tunnel_managed_by_systemd; then
        true
    elif ! pgrep -x cloudflared >/dev/null 2>&1; then
        echo "$(date): Reiniciando tunnel..." >> $LOG
        # shellcheck source=/dev/null
        source "$DIR/.env" 2>/dev/null
        if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
            cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" >> "$DIR/.tunnel_output.log" 2>&1 &
        fi
    fi

    sleep 30
done
