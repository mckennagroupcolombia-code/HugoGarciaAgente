#!/bin/bash
# =============================================================
# auto_commit.sh — Commit y push automático diario
# Proyecto: McKenna Group Agente
# =============================================================

# Ruta absoluta al proyecto (por si cron no tiene el directorio correcto)
PROYECTO="/home/mckg/mi-agente"
LOG="$PROYECTO/log_cron.txt"

cd "$PROYECTO" || { echo "[$(date)] ERROR: No se pudo acceder a $PROYECTO" >> "$LOG"; exit 1; }

# Verificar si hay cambios reales (staged, unstaged o archivos nuevos)
if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sin cambios. No se generó commit." >> "$LOG"
    exit 0
fi

# git add de todo
git add -A

# Mensaje de commit con fecha y hora
FECHA=$(date '+%Y-%m-%d')
HORA=$(date '+%H:%M')
MENSAJE="Auto-commit: actualizacion diaria $FECHA $HORA"

# Commit
git commit -m "$MENSAJE"

# El push al remoto lo hace app/tools/backup_drive.py (cron 2:00, rama actual).
# Este script solo deja el commit local listo para ese push.
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Commit local creado: '$MENSAJE'" >> "$LOG"
