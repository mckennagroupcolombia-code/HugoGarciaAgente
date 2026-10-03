#!/usr/bin/env bash
# Backup nocturno de mi-agente al disco MCKENNA (NTFS, /media/mckg/MCKENNA).
#   espejo/                 rsync incremental del proyecto (sin venv, node_modules, __pycache__)
#   bases/AAAA-MM-DD/       bases SQLite copiadas con `sqlite3 .backup` (consistentes), últimas 14
# Si el disco no está montado, no escribe nada (evitaría llenar el disco del sistema) y avisa por WhatsApp.
# Instalado por scripts/instalar_cron_mcKenna.sh (03:30). Ficha: docs/agentic/modules/ops-systemd.md.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PUNTO="${BACKUP_DISCO_PUNTO:-/media/mckg/MCKENNA}"
RAIZ="${BACKUP_DISCO_RAIZ:-$PUNTO/backup-sistema/mi-agente-nocturno}"
RETENCION_DIAS="${BACKUP_DISCO_RETENCION_DIAS:-14}"
HOY="$(date +%F)"
LOG="$RAIZ/backup.log"
PYTHON="$REPO/venv/bin/python"

avisar() {
  # Solo cuando algo falla. AGENTE_BACKUP_SKIP_WA=1 lo silencia (pruebas).
  echo "$(date '+%F %T') ⚠️ $1" >&2
  [ "${AGENTE_BACKUP_SKIP_WA:-0}" = "1" ] && return 0
  cd "$REPO" && "$PYTHON" - "$1" <<'PY' 2>/dev/null
import sys
from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa
enviar_whatsapp_reporte("💾 *Backup nocturno a disco externo falló*\n" + sys.argv[1], numero_destino=jid_grupo_alertas_sistemas_wa())
PY
}

if ! mountpoint -q "$PUNTO"; then
  avisar "El disco $PUNTO no está montado; no se hizo el backup de $HOY."
  exit 1
fi
mkdir -p "$RAIZ/espejo" "$RAIZ/bases/$HOY" || { avisar "No se pudo escribir en $RAIZ."; exit 1; }
exec >>"$LOG" 2>&1
echo "== $(date '+%F %T') inicio"

nice -n 10 ionice -c3 rsync -rt --no-perms --no-owner --no-group --no-links --delete --delete-excluded \
  --exclude='/venv/' --exclude='node_modules/' --exclude='__pycache__/' --exclude='*.pyc' \
  --info=stats1 "$REPO/" "$RAIZ/espejo/"
rc=$?
# 23 y 24 = archivos que cambiaron o desaparecieron mientras se copiaba: normal con el sistema en marcha.
if [ $rc -ne 0 ] && [ $rc -ne 23 ] && [ $rc -ne 24 ]; then
  avisar "rsync terminó con código $rc (ver $LOG)."
fi

cd "$REPO" || exit 1
n=0; fallos=0
while IFS= read -r -d '' db; do
  rel="${db#./}"
  mkdir -p "$RAIZ/bases/$HOY/$(dirname "$rel")"
  if sqlite3 "$db" ".timeout 30000" ".backup '$RAIZ/bases/$HOY/$rel'"; then
    r="$(sqlite3 "$RAIZ/bases/$HOY/$rel" 'PRAGMA integrity_check;' 2>&1 | head -1)"
    if [ "$r" = "ok" ]; then n=$((n+1)); else fallos=$((fallos+1)); echo "integridad mala: $rel -> $r"; fi
  else
    fallos=$((fallos+1)); echo "falló el backup de $rel"
  fi
done < <(find app PAGINA_WEB memoria_vectorial desktop/memoria_vectorial \
          \( -path '*/node_modules' -o -path '*/venv' \) -prune -o \
          \( -name '*.db' -o -name '*.sqlite3' \) -type f -size +0 -print0 2>/dev/null)
echo "bases copiadas=$n fallos=$fallos"
[ "$fallos" -gt 0 ] && avisar "$fallos base(s) de datos no se pudieron copiar o fallaron la verificación (ver $LOG)."
[ "$n" -eq 0 ] && avisar "No se copió ninguna base de datos."

"$REPO/venv/bin/pip" freeze >"$RAIZ/requirements-freeze.txt" 2>/dev/null
crontab -l >"$RAIZ/crontab-mckg.txt" 2>/dev/null

# Rotación de las copias de bases (el espejo es uno solo, se sobrescribe).
find "$RAIZ/bases" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENCION_DIAS" -exec rm -rf {} + 2>/dev/null
sync
echo "== $(date '+%F %T') fin"
