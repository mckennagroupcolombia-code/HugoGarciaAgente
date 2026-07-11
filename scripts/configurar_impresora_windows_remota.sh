#!/usr/bin/env bash
# Apunta la cola CUPS CW-C4000u del PC Linux (agente) a la impresora
# compartida en el Windows de Jenniffer (SMB por defecto).
#
# Uso:
#   ./scripts/configurar_impresora_windows_remota.sh 192.168.5.116
#   ./scripts/configurar_impresora_windows_remota.sh 192.168.5.116 CW-C4000u
#   ./scripts/configurar_impresora_windows_remota.sh --uri smb://192.168.5.116/CW-C4000u
#   ./scripts/configurar_impresora_windows_remota.sh --uri ipp://192.168.5.116/printers/CW-C4000u  # opcional
#
set -euo pipefail

PRINTER_NAME="CW-C4000u"
SHARE_DEFAULT="CW-C4000u"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PPD_REPO="$REPO_ROOT/scripts/epson/CW-C4000u.ppd"
CFG_JSON="$REPO_ROOT/app/data/etiquetas_impresora_remoto.json"

HOST=""
SHARE="$SHARE_DEFAULT"
URI=""

usage() {
  sed -n '1,12p' "$0" | sed 's/^# \?//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uri) URI="${2:-}"; shift 2 ;;
    --share) SHARE="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *)
      if [[ -z "$HOST" && "$1" != --* ]]; then HOST="$1"; shift
      elif [[ "$SHARE" == "$SHARE_DEFAULT" && "$1" != --* ]]; then SHARE="$1"; shift
      else echo "Arg desconocido: $1"; usage
      fi
      ;;
  esac
done

if [[ -z "$URI" ]]; then
  [[ -n "$HOST" ]] || usage
  URI="smb://${HOST}/${SHARE}"
fi

# Detectar protocolo para la config
PROTO="smb"
case "$URI" in
  smb://*) PROTO="smb" ;;
  ipp://*|ipps://*) PROTO="ipp" ;;
  *) PROTO="red" ;;
esac

echo "▶ Cola: $PRINTER_NAME"
echo "▶ URI:  $URI ($PROTO)"

if [[ "$PROTO" == "smb" && ! -e /usr/lib/cups/backend/smb ]]; then
  echo "✗ Falta backend SMB de CUPS. Instala: sudo apt-get install -y smbclient" >&2
  exit 1
fi

if [[ -f "$PPD_REPO" ]]; then
  sudo lpadmin -p "$PRINTER_NAME" -E -v "$URI" -P "$PPD_REPO" || \
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$URI" -m everywhere || \
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$URI"
else
  sudo lpadmin -p "$PRINTER_NAME" -E -v "$URI" -m everywhere || \
    sudo lpadmin -p "$PRINTER_NAME" -E -v "$URI"
fi

sudo cupsenable "$PRINTER_NAME" || true
sudo cupsaccept "$PRINTER_NAME" || true

mkdir -p "$(dirname "$CFG_JSON")"
python3 - <<PY
import json
from datetime import datetime
from pathlib import Path
p = Path("$CFG_JSON")
data = {
  "activo": True,
  "modo": "windows_compartida",
  "sistema_operativo": "windows_10_pro",
  "sistema_operativo_label": "Windows 10 Pro",
  "sesion": "Jenniffer Garcia",
  "host": "$HOST",
  "share": "$SHARE",
  "uri": "$URI",
  "protocolo": "$PROTO",
  "actualizado_at": datetime.now().isoformat(timespec="seconds"),
}
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"▶ Config guardada: {p}")
PY

echo
echo "Listo. Verifica:"
echo "  lpstat -v $PRINTER_NAME"
echo "  lpstat -p $PRINTER_NAME"
echo
echo "En Windows (Jenniffer) antes de imprimir:"
echo "  1. Instalar driver Epson CW-C4000u (Windows 10/11 oficial)"
echo "     https://epson.com/Support/Printers/Label-Printers/ColorWorks-Series/Epson-ColorWorks-CW-C4000/s/SPT_C31CK03101"
echo "  2. USB conectado, impresora Listo"
echo "  3. Compartir impresora con nombre: $SHARE"
echo "  4. Ejecutar (Admin): scripts/epson/configurar_compartir_windows.ps1"
echo "     (perfil Privado + Compartir archivos e impresoras)"
echo "  5. Misma red LAN (o Tailscale) que el PC Linux $(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  Guía: scripts/epson/GUIA_WINDOWS_CW-C4000u.md"
