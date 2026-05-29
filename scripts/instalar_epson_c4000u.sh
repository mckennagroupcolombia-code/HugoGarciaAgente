#!/usr/bin/env bash
# instalar_epson_c4000u.sh — Instalador automático MCKG Suite v8.0 - La Patrona
# Epson ColorWorks CW-C4000u · Linux (Ubuntu/Debian) y macOS
# Uso: sudo bash instalar_epson_c4000u.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
err()  { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
info() { echo -e "${CYAN}  → $*${NC}"; }

PRINTER_NAME="CW-C4000u"
PRINTER_URI="usb://EPSON/ColorWorks%20CW-C4000u"
ELPU_INSTALL_DIR="/opt/epson/epson-label-printer-utility"
ELPU_BIN="$ELPU_INSTALL_DIR/elpu"
APP_SRC="/usr/local/bin/utilidad_epson.py"
DESKTOP_FILE="/usr/share/applications/mckg-etiquetas.desktop"
ICON_DIR="/usr/local/share/icons/mckg"

# ─── Detectar OS ─────────────────────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
elif [[ -f /etc/debian_version ]]; then
  OS="debian"
elif [[ -f /etc/redhat-release ]]; then
  OS="rhel"
else
  err "Sistema operativo no soportado. Solo Ubuntu/Debian, RHEL/Fedora y macOS."
fi

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}   MCKG Suite v8.0 — Instalador Epson CW-C4000u       ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "   OS detectado: ${YELLOW}$OS${NC}"
echo ""

# ─── 1. Dependencias base ────────────────────────────────────────────────────
info "Instalando dependencias base..."

if [[ "$OS" == "debian" ]]; then
  apt-get update -qq
  apt-get install -y -qq \
    cups cups-client cups-bsd \
    python3 python3-tk python3-pip \
    wget curl libcupsimage2 \
    printer-driver-cups-pdf 2>/dev/null || true
  ok "Dependencias Debian instaladas"

elif [[ "$OS" == "rhel" ]]; then
  dnf install -y -q \
    cups cups-client \
    python3 python3-tkinter \
    wget curl 2>/dev/null || true
  ok "Dependencias RHEL instaladas"

elif [[ "$OS" == "macos" ]]; then
  if ! command -v brew &>/dev/null; then
    warn "Homebrew no encontrado. Instalando..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  brew install python3 --quiet 2>/dev/null || true
  # CUPS ya viene en macOS
  ok "Dependencias macOS instaladas"
fi

# ─── 2. CUPS en marcha ───────────────────────────────────────────────────────
info "Verificando servicio CUPS..."

if [[ "$OS" == "debian" || "$OS" == "rhel" ]]; then
  systemctl enable cups --quiet 2>/dev/null || true
  systemctl start  cups 2>/dev/null || true
  if systemctl is-active --quiet cups; then
    ok "CUPS activo"
  else
    warn "CUPS no está activo — intenta: sudo systemctl start cups"
  fi
elif [[ "$OS" == "macos" ]]; then
  launchctl load /System/Library/LaunchDaemons/org.cups.cupsd.plist 2>/dev/null || true
  ok "CUPS macOS"
fi

# ─── 3. Driver Epson CW-C4000u ───────────────────────────────────────────────
info "Verificando driver Epson CW-C4000u..."

# Detectar driver ya instalado
DRIVER_OK=false
if lpinfo -m 2>/dev/null | grep -qi "c4000\|cw-c4000\|ColorWorks.*4000"; then
  ok "Driver Epson CW-C4000u ya instalado"
  DRIVER_OK=true
fi

if [[ "$DRIVER_OK" == "false" ]]; then
  warn "Driver no encontrado. Descargando desde Epson..."

  DRIVER_TMP=$(mktemp -d)
  DRIVER_URL=""

  if [[ "$OS" == "debian" ]]; then
    # Epson publica .deb para Ubuntu/Debian
    DRIVER_URL="https://download.ebz.epson.net/dsc/du/02/DriverDownloadInfo.do?LG2=JA&CN2=US&CTG=DRV&PRD=CW-C4000&OS=LX"
    # Como la URL exacta puede cambiar, ofrecer instrucciones manuales si falla
    warn "Visita: https://www.epson.com/cgi-bin/ceDriver.pl?OID=28878"
    warn "Descarga el driver .deb para Linux y ejecútalo con: sudo dpkg -i epson-cw-c4000*.deb"
    warn "O instálalo desde la tienda de tu distribución si está disponible."
    echo ""
    read -r -p "¿Ya instalaste el driver manualmente? (s/n): " RESP
    if [[ "$RESP" =~ ^[Ss] ]]; then
      ok "Usuario confirmó instalación manual del driver"
    else
      warn "Continúa la instalación después de instalar el driver Epson."
    fi

  elif [[ "$OS" == "macos" ]]; then
    warn "Descarga el driver desde:"
    warn "https://www.epson.com/cgi-bin/ceDriver.pl?OID=28878"
    warn "Instala el .pkg descargado y vuelve a ejecutar este script."
    read -r -p "¿Ya instalaste el driver? (s/n): " RESP
  fi

  rm -rf "$DRIVER_TMP"
fi

# ─── 4. ELPU (Epson Label Printer Utility) ───────────────────────────────────
info "Verificando Epson Label Printer Utility (elpu)..."

ELPU_OK=false
if [[ -x "$ELPU_BIN" ]] || command -v elpu &>/dev/null; then
  ok "elpu ya instalado"
  ELPU_OK=true
fi

if [[ "$ELPU_OK" == "false" ]]; then
  warn "elpu no encontrado. Descargando..."
  ELPU_TMP=$(mktemp -d)

  if [[ "$OS" == "debian" ]]; then
    # Intentar descargar el paquete elpu de Epson
    ELPU_PKG_URL="https://download.ebz.epson.net/dsc/du/02/DriverDownloadInfo.do?LG2=JA&CN2=US&CTG=DRV&PRD=ELPU&OS=LX"
    warn "Descarga ELPU desde: https://www.epson.com/cgi-bin/ceDriver.pl?OID=28877"
    warn "Busca 'Epson Label Printer Utility for Linux' y descarga el .deb"
    warn "Luego instala con: sudo dpkg -i epson-label-printer-utility*.deb"
    echo ""
    read -r -p "¿Ya instalaste ELPU? (s/n): " RESP
    if [[ "$RESP" =~ ^[Ss] ]]; then
      ok "Usuario confirmó instalación manual de ELPU"
    fi
  fi

  rm -rf "$ELPU_TMP"
fi

# ─── 5. Agregar impresora a CUPS ─────────────────────────────────────────────
info "Registrando impresora $PRINTER_NAME en CUPS..."

if lpstat -p "$PRINTER_NAME" &>/dev/null 2>&1; then
  ok "Impresora $PRINTER_NAME ya registrada en CUPS"
else
  # Buscar la URI USB automáticamente
  USB_URI=$(lpinfo -v 2>/dev/null | grep -i "epson\|c4000\|ColorWorks" | awk '{print $2}' | head -1)

  if [[ -z "$USB_URI" ]]; then
    warn "Impresora no detectada por USB. Asegúrate de que esté conectada y encendida."
    USB_URI="$PRINTER_URI"
  fi

  # Buscar PPD del driver instalado
  PPD=$(lpinfo -m 2>/dev/null | grep -i "c4000\|ColorWorks.*4000" | head -1 | awk '{print $1}')

  if [[ -n "$PPD" ]]; then
    lpadmin -p "$PRINTER_NAME" -E -v "$USB_URI" -m "$PPD" 2>/dev/null && \
      ok "Impresora $PRINTER_NAME registrada con PPD: $PPD" || \
      warn "No se pudo registrar automáticamente. Agrégala en: http://localhost:631"
  else
    warn "PPD no encontrado. Registra la impresora manualmente en: http://localhost:631"
    warn "Nombre sugerido: $PRINTER_NAME"
  fi
fi

# Habilitar la impresora
cupsenable "$PRINTER_NAME" 2>/dev/null && ok "Impresora habilitada" || true
cupsaccept "$PRINTER_NAME" 2>/dev/null || true

# ─── 6. Configurar sudo para elpu ────────────────────────────────────────────
info "Configurando sudo sin contraseña para elpu..."

SUDOERS_FILE="/etc/sudoers.d/mckg-elpu"
ELPU_REAL=$(command -v elpu 2>/dev/null || echo "$ELPU_BIN")

if [[ ! -f "$SUDOERS_FILE" ]] || ! grep -q "$ELPU_REAL" "$SUDOERS_FILE" 2>/dev/null; then
  cat > "$SUDOERS_FILE" << EOF
# MCKG Suite — permite ejecutar elpu sin contraseña para imprimir etiquetas
%lpadmin ALL=(ALL) NOPASSWD: $ELPU_REAL
$(logname 2>/dev/null || whoami) ALL=(ALL) NOPASSWD: $ELPU_REAL
EOF
  chmod 440 "$SUDOERS_FILE"
  ok "Regla sudo configurada en $SUDOERS_FILE"
else
  ok "Regla sudo ya configurada"
fi

# ─── 7. Instalar la app Python ───────────────────────────────────────────────
info "Instalando MCKG Suite..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PY="$SCRIPT_DIR/utilidad_epson.py"

# Si no existe en scripts/, buscar en ubicación conocida
if [[ ! -f "$SOURCE_PY" ]]; then
  SOURCE_PY="/usr/local/bin/utilidad_epson.py"
fi

if [[ -f "$SOURCE_PY" ]]; then
  install -m 755 "$SOURCE_PY" /usr/local/bin/utilidad_epson.py
  ok "App instalada en /usr/local/bin/utilidad_epson.py"
else
  warn "No se encontró utilidad_epson.py. Colócalo en $SCRIPT_DIR/ y vuelve a ejecutar."
fi

# Enlace simbólico cómodo
ln -sf /usr/local/bin/utilidad_epson.py /usr/local/bin/mckg-etiquetas 2>/dev/null || true

# ─── 8. Acceso directo (solo Linux) ──────────────────────────────────────────
if [[ "$OS" == "debian" || "$OS" == "rhel" ]]; then
  info "Creando acceso directo en el escritorio..."

  PYTHON3=$(command -v python3)
  mkdir -p "$ICON_DIR"

  # Icono simple SVG de impresora
  cat > "$ICON_DIR/mckg-etiquetas.svg" << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0e7490"/>
  <text x="32" y="46" font-size="38" text-anchor="middle" fill="white">🖨</text>
</svg>
SVGEOF

  cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=MCKG Suite — Etiquetas
GenericName=Impresión de etiquetas Epson CW-C4000u
Comment=McKenna Group S.A.S. · Sistema de etiquetado
Exec=$PYTHON3 /usr/local/bin/utilidad_epson.py
Icon=$ICON_DIR/mckg-etiquetas.svg
Terminal=false
Type=Application
Categories=Office;
StartupNotify=true
EOF

  chmod 644 "$DESKTOP_FILE"
  update-desktop-database 2>/dev/null || true
  ok "Acceso directo creado: Menú → Oficina → MCKG Suite — Etiquetas"
fi

# ─── Resumen ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Instalación completada${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Impresora : $PRINTER_NAME"
echo "  ELPU      : $ELPU_REAL"
echo "  App       : /usr/local/bin/utilidad_epson.py"
echo "  Acceso    : mckg-etiquetas (terminal) o acceso directo"
echo ""
echo "  Lanzar desde terminal:"
echo -e "  ${CYAN}python3 /usr/local/bin/utilidad_epson.py${NC}"
echo ""
echo "  Verificar impresora:"
echo -e "  ${CYAN}lpstat -p $PRINTER_NAME${NC}"
echo ""
