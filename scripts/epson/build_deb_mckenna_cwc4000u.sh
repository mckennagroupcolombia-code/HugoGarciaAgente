#!/usr/bin/env bash
# Construye el paquete .deb McKenna para Epson CW-C4000u (Ubuntu amd64).
# Uso: ./scripts/epson/build_deb_mckenna_cwc4000u.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PKG_NAME="mckenna-epson-cwc4000u"
PKG_VER="1.0.0"
ARCH="amd64"
OUT_DIR="$SCRIPT_DIR/dist"
STAGE="$OUT_DIR/${PKG_NAME}_${PKG_VER}_${ARCH}"
DEB_PATH="$OUT_DIR/${PKG_NAME}_${PKG_VER}_${ARCH}.deb"

PPD_SRC="$SCRIPT_DIR/CW-C4000u.ppd"
ELPU_SRC="$SCRIPT_DIR/elpu"

[[ -f "$PPD_SRC" ]] || { echo "Falta PPD: $PPD_SRC" >&2; exit 1; }
[[ -f "$ELPU_SRC" ]] || { echo "Falta elpu: $ELPU_SRC" >&2; exit 1; }

rm -rf "$STAGE"
mkdir -p \
  "$STAGE/DEBIAN" \
  "$STAGE/usr/share/ppd/mckenna" \
  "$STAGE/opt/epson/epson-label-printer-utility" \
  "$STAGE/usr/local/bin" \
  "$STAGE/usr/share/doc/$PKG_NAME"

install -m 644 "$PPD_SRC" "$STAGE/usr/share/ppd/mckenna/CW-C4000u.ppd"
install -m 755 "$ELPU_SRC" "$STAGE/opt/epson/epson-label-printer-utility/elpu"
ln -sf /opt/epson/epson-label-printer-utility/elpu "$STAGE/usr/local/bin/elpu"

cat > "$STAGE/usr/share/doc/$PKG_NAME/README" <<'EOF'
McKenna · Epson ColorWorks CW-C4000u (Ubuntu)

Instala PPD + utilidad elpu y registra la cola CUPS "CW-C4000u".

Uso:
  sudo dpkg -i mckenna-epson-cwc4000u_*.deb
  sudo apt-get install -f   # si faltan dependencias

Panel: Etiquetas → Instalar impresora → Ubuntu (.deb)
EOF

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $PKG_VER
Section: utils
Priority: optional
Architecture: $ARCH
Depends: cups, cups-client, smbclient
Maintainer: McKenna Group <mckenna.group.colombia@gmail.com>
Description: Driver/cola McKenna para Epson CW-C4000u
 PPD, elpu y registro de cola CUPS CW-C4000u para el panel de etiquetas.
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/bash
set -e
PRINTER=CW-C4000u
PPD=/usr/share/ppd/mckenna/CW-C4000u.ppd
ELPU=/opt/epson/epson-label-printer-utility/elpu

ln -sf "$ELPU" /usr/local/bin/elpu 2>/dev/null || true

# Detectar USB Epson si está conectada; si no, dejar cola lista con URI genérica
URI="usb://EPSON/CW-C4000u"
if command -v lpinfo >/dev/null 2>&1; then
  DET=$(lpinfo -v 2>/dev/null | awk '/usb/ && (/[Ee]pson/ || /[Cc]4000/) {print $2; exit}')
  [[ -n "$DET" ]] && URI="$DET"
fi

if [[ -f "$PPD" ]] && command -v lpadmin >/dev/null 2>&1; then
  lpadmin -p "$PRINTER" -E -v "$URI" -P "$PPD" 2>/dev/null || \
    lpadmin -p "$PRINTER" -E -v "$URI" 2>/dev/null || true
  cupsenable "$PRINTER" 2>/dev/null || true
  cupsaccept "$PRINTER" 2>/dev/null || true
  lpoptions -p "$PRINTER" -o MediaForm=Diecut_Gap 2>/dev/null || true
fi

echo "McKenna CW-C4000u: cola lista (URI=$URI). Verifica: lpstat -v $PRINTER"
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/bash
set -e
# No borramos la cola CUPS automáticamente (puede estar en uso / Windows remoto).
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/prerm"

# Tamaño instalado aproximado
INSTALLED_SIZE=$(du -sk "$STAGE" | awk '{print $1}')
sed -i "/^Description:/i Installed-Size: $INSTALLED_SIZE" "$STAGE/DEBIAN/control" 2>/dev/null || \
  echo "Installed-Size: $INSTALLED_SIZE" >> "$STAGE/DEBIAN/control"

dpkg-deb --root-owner-group --build "$STAGE" "$DEB_PATH"
rm -rf "$STAGE"

# Enlace estable para la API
STABLE="$OUT_DIR/${PKG_NAME}_amd64.deb"
ln -sfn "$(basename "$DEB_PATH")" "$STABLE"

echo "▶ Deb: $DEB_PATH"
echo "▶ Link: $STABLE"
ls -lh "$DEB_PATH" "$STABLE"
