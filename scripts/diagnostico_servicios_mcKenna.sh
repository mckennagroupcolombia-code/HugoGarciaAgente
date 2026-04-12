#!/bin/bash
# Puertos Flask + systemd + procesos Python reales (sin ruido de Cursor/sandbox en pgrep).
set +e

echo "=== Unidades systemd (McKenna / túnel) ==="
for u in webhook-meli mckenna-agente mckenna-website agente-pro mckenna-site cloudflared mckenna-tunnel mckenna-bot-tunnel; do
    if systemctl cat "${u}.service" &>/dev/null; then
        state=$(systemctl is-active "${u}.service" 2>/dev/null || echo "?")
        printf "  %-26s %s\n" "${u}.service" "$state"
    fi
done

echo ""
echo "=== Escucha TCP (8080 webhook / 8081 agente / 8083 sitio) ==="
ss -tlnp 2>/dev/null | grep -E ':8080\b|:8081\b|:8083\b' || echo "  (ninguno)"

echo ""
echo "=== Procesos Python (solo líneas con venv/bin/python3 … target) ==="
for needle in "webhook_meli.py" "agente_pro.py" "PAGINA_WEB/site/website.py"; do
    echo "  -- $needle --"
    pgrep -af "python3.*${needle}" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' || echo "    (ninguno)"
done

echo ""
echo "=== Webhook MeLi: coherencia systemd ↔ puerto 8080 ==="
if systemctl is-active --quiet webhook-meli.service 2>/dev/null; then
    main_pid=$(systemctl show -p MainPID --value webhook-meli.service 2>/dev/null)
    listen_pid=$(ss -tlnp 2>/dev/null | grep -E ':8080\b' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
    echo "  MainPID (systemd): ${main_pid:-?}"
    echo "  PID que escucha :8080: ${listen_pid:-?}"
    if [ -n "$main_pid" ] && [ -n "$listen_pid" ] && [ "$main_pid" != "$listen_pid" ]; then
        echo "  ⚠️  ALERTA: quien tiene el 8080 NO es el MainPID de systemd (proceso huérfano o duplicado)."
    fi
fi
n_webhook=$(pgrep -af "python3.*webhook_meli\.py" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' | wc -l)
n_webhook=$((n_webhook + 0))
if [ "$n_webhook" -gt 1 ]; then
    echo "  ⚠️  ALERTA: hay $n_webhook procesos webhook_meli.py — debe quedar solo uno (ideal: systemd)."
    echo "     Ejecuta: ./scripts/normalizar_webhook_meli.sh"
fi

echo ""
echo "Si systemd está 'activating' con muchos reinicios: liberar puerto y copiar"
echo "  StartLimitBurst desde scripts/systemd/webhook-meli.service, luego:"
echo "  sudo systemctl daemon-reload && sudo systemctl reset-failed webhook-meli && sudo systemctl start webhook-meli"
