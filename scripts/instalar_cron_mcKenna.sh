#!/usr/bin/env bash
# Instala entradas cron idempotentes para el agente McKenna (auditoría de scripts).
# Uso: ./scripts/instalar_cron_mcKenna.sh

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${REPO}/venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3 || true)"
fi
if [[ -z "$PYTHON" ]]; then
  echo "No se encontró venv/bin/python ni python3." >&2
  exit 1
fi
LOG="${REPO}/log_cron.txt"
MARK_B="# MCKENNA_AGENTE_CRON_BEGIN"
MARK_E="# MCKENNA_AGENTE_CRON_END"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

crontab -l 2>/dev/null | awk -v b="$MARK_B" -v e="$MARK_E" '
  $0 == b { skip = 1; next }
  $0 == e { skip = 0; next }
  skip == 0 { print }
' >"$TMP" || true

{
  echo "$MARK_B"
  echo "# Auditoría de scripts (fallos → WhatsApp)"
  echo "15 7 * * * cd ${REPO} && AGENTE_AUDITORIA_CRON_QUIET=1 ${PYTHON} ${REPO}/scripts/auditar_scripts_cron.py >>${LOG} 2>&1"
  echo "# MeLi compliance watchlist (estado publicaciones + alerta WA)"
  echo "30 8 * * * cd ${REPO} && AGENTE_COMPLIANCE_MONITOR_QUIET=1 ${PYTHON} ${REPO}/scripts/meli_compliance_monitor_cron.py >>${LOG} 2>&1"
  echo "# Correos de proveedores: certificados de retención → solicitud a Cynthia"
  echo "0 8 * * * cd ${REPO} && AGENTE_MONITOR_CORREOS_CRON_QUIET=1 ${PYTHON} ${REPO}/scripts/monitor_correos_certificados_retencion_cron.py >>${LOG} 2>&1"
  echo "# Costos LLM vía API: resumen semanal al grupo de sistemas (lunes)"
  echo "45 7 * * 1 cd ${REPO} && ${PYTHON} ${REPO}/scripts/resumen_costos_llm_cron.py >>${LOG} 2>&1"
  echo "# Actividad SEDE SUR: resumen diario al grupo (reemplaza el mensaje por cada cambio de estado, frecuencia real vía Sistemas → Tareas Programadas)"
  echo "0 18 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/resumen_actividad_sede_sur_cron.py >>${LOG} 2>&1"
  echo "# Comunicaciones importaciones: correos/WhatsApp nuevos → comentario en ticket (frecuencia real vía Sistemas → Tareas Programadas, ver app/services/cron_scheduler.py)"
  echo "15 8 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/monitor_comunicaciones_importaciones.py >>${LOG} 2>&1"
  echo "# Notas crédito automáticas: ventas MeLi canceladas con factura ya emitida (frecuencia real vía Sistemas → Tareas Programadas)"
  echo "20 7 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/emitir_notas_credito_cron.py >>${LOG} 2>&1"
  echo "# Publicidad MeLi: recomendaciones de ACOS por rotación → ticket + WhatsApp (lunes, frecuencia real vía Sistemas → Tareas Programadas)"
  echo "15 8 * * 1 cd ${REPO} && ${PYTHON} ${REPO}/scripts/publicidad_recomendaciones_cron.py >>${LOG} 2>&1"
  echo "# Reposición alta rotación: informe de cierre de mes a Sede Sur (corre a diario, el propio script valida que sea el último día del mes)"
  echo "0 20 * * * cd ${REPO} && ${PYTHON} ${REPO}/scripts/informe_reposicion_mensual_cron.py >>${LOG} 2>&1"
  echo "# Archiva gasto en ads MeLi antes de que salga de la ventana de 90 días (frecuencia real vía Sistemas → Tareas Programadas)"
  echo "20 8 * * 1 cd ${REPO} && ${PYTHON} ${REPO}/scripts/archivar_gasto_ads_cron.py >>${LOG} 2>&1"
  echo "# Recordatorio semanal de inventario: agotados/críticos/bajo stock → Control de Inventario (frecuencia real vía Sistemas → Tareas Programadas)"
  echo "30 8 * * 1 cd ${REPO} && ${PYTHON} ${REPO}/scripts/recordatorio_inventario_cron.py >>${LOG} 2>&1"
  echo "$MARK_E"
} >>"$TMP"

crontab "$TMP"
echo "✅ Crontab actualizado. Bloque McKenna:"
crontab -l | grep -A4 "$MARK_B" || true
