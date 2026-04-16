#!/bin/bash
# Puertos Flask + systemd + procesos Python reales (sin ruido de Cursor/sandbox en pgrep).
set +e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# pgrep -f usa regex: anclar al script real (evita py_compile … webhook_meli.py en cmdlines ajenas).
_pgrep_repo_script() {
    pgrep -af "$1" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' || true
}

echo "=== Unidades systemd --system (McKenna / túnel) ==="
for u in webhook-meli agente-pro mckenna-whatsapp-bridge bot-mckenna mckenna-website mckenna-site cloudflared mckenna-tunnel mckenna-bot-tunnel; do
    if systemctl cat "${u}.service" &>/dev/null; then
        state=$(systemctl is-active "${u}.service" 2>/dev/null || echo "?")
        printf "  %-32s %s\n" "${u}.service" "$state"
    fi
done

echo ""
echo "=== Unidades systemd --user (no mezclar con --system mismo binario/puerto) ==="
if systemctl --user is-system-running &>/dev/null; then
    for u in mckenna-agente mckenna-website mckenna-cloudflared mckenna-webhook-meli; do
        if systemctl --user cat "${u}.service" &>/dev/null; then
            state=$(systemctl --user is-active "${u}.service" 2>/dev/null || echo "?")
            printf "  %-32s %s\n" "${u}.service" "$state"
        fi
    done
else
    echo "  (sesión user systemd no disponible; omitido)"
fi

echo ""
echo "=== Escucha TCP (8080 webhook / 8081 agente / 8083 sitio) ==="
ss -tlnp 2>/dev/null | grep -E ':8080\b|:8081\b|:8083\b' || echo "  (ninguno)"

echo ""
echo "=== Procesos Python (ruta repo, sin ruido sandbox) ==="
for pair in "webhook_meli.py|webhook_meli\\.py" "agente_pro.py|agente_pro\\.py" "website.py|PAGINA_WEB/site/website\\.py"; do
    name="${pair%%|*}"
    suf="${pair#*|}"
    echo "  -- $name --"
    out=$(_pgrep_repo_script "${REPO_ROOT}/${suf}")
    if [ -n "$out" ]; then echo "$out"; else echo "    (ninguno)"; fi
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
n_webhook=$(_pgrep_repo_script "${REPO_ROOT}/webhook_meli\\.py" | wc -l)
n_webhook=$((n_webhook + 0))
if [ "$n_webhook" -gt 1 ]; then
    echo "  ⚠️  ALERTA: hay $n_webhook procesos webhook_meli.py — debe quedar solo uno (ideal: systemd)."
    echo "     Ejecuta: ./scripts/normalizar_webhook_meli.sh"
fi

if systemctl cat bot-mckenna.service &>/dev/null; then
    bm_en=$(systemctl is-enabled bot-mckenna.service 2>/dev/null || echo "")
    bm_st=$(systemctl is-active bot-mckenna.service 2>/dev/null || echo "inactive")
    if [ "$bm_en" = "enabled" ] || [ "$bm_st" = "active" ] || [ "$bm_st" = "activating" ]; then
        echo ""
        echo "=== bot-mckenna.service (nombre legado: debe ser Node server.js :3000, NO webhook_meli.py) ==="
        systemctl cat bot-mckenna.service 2>/dev/null | grep -E '^ExecStart=' || true
    fi
    if { [ "$bm_en" = "enabled" ] || [ "$bm_st" = "active" ] || [ "$bm_st" = "activating" ]; } && systemctl cat bot-mckenna.service 2>/dev/null | grep -q 'webhook_meli'; then
        echo "  ⚠️  ALERTA: bot-mckenna.service apunta a webhook_meli.py — compite con webhook-meli.service"
        echo "     en :8080. Puente WA real: mckenna-whatsapp-bridge.service. Deshabilitar: sudo systemctl disable --now bot-mckenna"
    elif systemctl cat bot-mckenna.service 2>/dev/null | grep -q 'webhook_meli'; then
        echo ""
        echo "=== bot-mckenna.service (deshabilitado; unit aún con ExecStart=webhook — no re-enable sin corregir) ==="
    fi
fi

echo ""
echo "=== Agente :8081 — coherencia y duplicados ==="
n_agente=$(_pgrep_repo_script "${REPO_ROOT}/agente_pro\\.py" | wc -l)
n_agente=$((n_agente + 0))
if [ "$n_agente" -gt 1 ]; then
    echo "  ⚠️  ALERTA: hay $n_agente procesos agente_pro.py — un solo dueño (agente-pro O mckenna-agente user, no ambos)."
    _pgrep_repo_script "${REPO_ROOT}/agente_pro\\.py" || true
fi
user_agente_st=$(systemctl --user show -p ActiveState --value mckenna-agente.service 2>/dev/null || echo "")
if systemctl is-active --quiet agente-pro.service 2>/dev/null && [[ "$user_agente_st" =~ ^(active|activating)$ ]]; then
    echo "  ⚠️  ALERTA: agente-pro (system) y mckenna-agente (user) en $user_agente_st — mismo :8081; deshabilitar uno: systemctl --user disable --now mckenna-agente"
fi
user_wh_st=$(systemctl --user show -p ActiveState --value mckenna-webhook-meli.service 2>/dev/null || echo "")
if systemctl is-active --quiet webhook-meli.service 2>/dev/null && [[ "$user_wh_st" =~ ^(active|activating)$ ]]; then
    echo "  ⚠️  ALERTA: webhook-meli (system) y mckenna-webhook-meli (user) en $user_wh_st — riesgo de doble webhook en :8080."
fi

n_node=$(pgrep -af "node.*/bot-mckenna/server\.js" 2>/dev/null | grep -vE 'cursorsandbox|cursor.*sandbox' | wc -l)
n_node=$((n_node + 0))
if [ "$n_node" -gt 1 ]; then
    echo ""
    echo "  ⚠️  ALERTA: $n_node procesos node …/bot-mckenna/server.js — un solo puente :3000."
fi

echo ""
echo "=== MeLi: topics de notificaciones suscritos ==="
if command -v python3 &>/dev/null && [ -f "${REPO_ROOT}/venv/bin/python3" ]; then
    "${REPO_ROOT}/venv/bin/python3" -c "
import os, json, sys
sys.path.insert(0, '${REPO_ROOT}')
os.chdir('${REPO_ROOT}')
try:
    from dotenv import load_dotenv; load_dotenv()
    from app.utils import refrescar_token_meli
    import requests
    token = refrescar_token_meli()
    if not token:
        print('  ⚠️  Sin token MeLi — no se puede verificar topics.')
        sys.exit(0)
    with open('credenciales_meli.json') as f:
        app_id = str(json.load(f).get('app_id', json.load(open('credenciales_meli.json')).get('client_id', '')))
    r = requests.get(f'https://api.mercadolibre.com/applications/{app_id}',
                     headers={'Authorization': f'Bearer {token}'}, timeout=10)
    if r.status_code != 200:
        print(f'  ⚠️  GET /applications/{app_id}: {r.status_code}')
        sys.exit(0)
    d = r.json()
    url = d.get('notifications_callback_url', '?')
    topics = d.get('notifications_topics') or []
    print(f'  callback: {url}')
    print(f'  topics:   {topics}')
    needed = {'questions', 'orders_v2', 'messages'}
    present = set(topics)
    # MeLi subtopics: messages.created counts as messages
    if any(t.startswith('messages') for t in present):
        present.add('messages')
    missing = needed - present
    if missing:
        print(f'  ⚠️  ALERTA: faltan topics críticos: {sorted(missing)}')
        print('     Ir a https://developers.mercadolibre.com.co → Mis Aplicaciones → Editar → agregar topics.')
    else:
        print('  ✅ topics questions, orders_v2, messages presentes.')
except Exception as e:
    print(f'  ⚠️  Error verificando MeLi: {e}')
" 2>/dev/null
else
    echo "  (python3 no disponible — omitido)"
fi

echo ""
echo "Si systemd está 'activating' con muchos reinicios: liberar puerto y copiar"
echo "  StartLimitBurst desde scripts/systemd/webhook-meli.service, luego:"
echo "  sudo systemctl daemon-reload && sudo systemctl reset-failed webhook-meli && sudo systemctl start webhook-meli"
