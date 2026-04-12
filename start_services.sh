#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1
source venv/bin/activate
# shellcheck source=scripts/lib/mckenna_nohup_guard.sh
source "$DIR/scripts/lib/mckenna_nohup_guard.sh"

_pgrep_py() {
    pgrep -af "python3.*${1}" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' || true
}

# Webhook MeLi (8080)
if mckenna_webhook_managed_by_systemd; then
    echo "webhook_meli: systemd (webhook-meli.service)"
elif [ -n "$(_pgrep_py 'webhook_meli\.py')" ]; then
    echo "webhook_meli: ya en ejecución"
else
    nohup python3 -u webhook_meli.py > .webhook.log 2>&1 &
    echo "webhook_meli.py: $!"
fi

# Agente Pro (8081)
if mckenna_agente_managed_by_systemd; then
    echo "agente_pro: systemd (mckenna-agente u otra unidad)"
elif [ -n "$(_pgrep_py 'agente_pro\.py')" ]; then
    echo "agente_pro: ya en ejecución"
else
    nohup python3 agente_pro.py > .agente.log 2>&1 &
    echo "agente_pro.py: $!"
fi

# Website (8083)
if mckenna_website_managed_by_systemd; then
    echo "website: systemd (mckenna-website.service)"
elif [ -n "$(_pgrep_py 'PAGINA_WEB/site/website.py')" ]; then
    echo "website: ya en ejecución"
else
    nohup python3 PAGINA_WEB/site/website.py > .website.log 2>&1 &
    echo "website.py: $!"
fi

echo "Listo (revisa mensajes arriba; systemd tiene prioridad sobre nohup)."
