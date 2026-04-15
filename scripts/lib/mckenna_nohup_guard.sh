# -*- shell-script -*-
# Política McKenna: un solo dueño por servicio.
# Si la unidad systemd indicada está activa, los scripts (nohup / mantener_servicios)
# NO deben lanzar el mismo binario o competir por el puerto.
#
# Uso: desde la raíz del repo:
#   DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   # shellcheck source=scripts/lib/mckenna_nohup_guard.sh
#   source "$DIR/scripts/lib/mckenna_nohup_guard.sh"

_mckenna_systemd_active() {
    systemctl is-active --quiet "$1" 2>/dev/null
}

# Solo **activa** (o brevemente *activating*): no lanzar nohup.
# Importante: NO usar solo `is-enabled`: si la unidad quedó en **failed** (p. ej. lock/puerto)
# pero sigue enabled, bloqueaba nohup y dejaba un webhook_meli.py huérfano sin recuperación.
_mckenna_unit_controls_service() {
    local u="$1"
    _mckenna_systemd_active "$u" && return 0
    local st
    st=$(systemctl show -p ActiveState --value "$u" 2>/dev/null || echo "")
    [ "$st" = "activating" ] && return 0
    return 1
}

mckenna_webhook_managed_by_systemd() {
    _mckenna_unit_controls_service webhook-meli.service
}

mckenna_agente_managed_by_systemd() {
    _mckenna_unit_controls_service mckenna-agente.service \
        || _mckenna_unit_controls_service agente-pro.service
}

mckenna_website_managed_by_systemd() {
    _mckenna_unit_controls_service mckenna-website.service \
        || _mckenna_unit_controls_service mckenna-site.service
}

mckenna_tunnel_managed_by_systemd() {
    _mckenna_unit_controls_service cloudflared.service \
        || _mckenna_unit_controls_service mckenna-tunnel.service \
        || _mckenna_unit_controls_service mckenna-bot-tunnel.service
}
