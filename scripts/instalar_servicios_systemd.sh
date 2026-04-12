#!/bin/bash
# Instala en /etc/systemd/system/ las plantillas del repo (no las habilita solas).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Origen: $REPO/scripts/systemd/"
sudo cp "$REPO/scripts/systemd/"*.service /etc/systemd/system/
sudo systemctl daemon-reload
echo "OK. Habilitar solo lo que uses (evita dos dueños del mismo puerto):"
echo "  sudo systemctl enable --now webhook-meli.service"
echo "  sudo systemctl enable --now mckenna-agente.service    # opcional :8081"
echo "  sudo systemctl enable --now mckenna-website.service   # opcional :8083"
echo ""
echo "Tras miles de fallos: sudo systemctl reset-failed webhook-meli.service"
