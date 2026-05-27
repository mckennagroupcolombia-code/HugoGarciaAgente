#!/usr/bin/env bash
# Firma app-release-unsigned.apk con mckenna.keystore (misma firma que instalaciones anteriores).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

UNSIGNED="${1:-app/build/outputs/apk/release/app-release-unsigned.apk}"
KEYSTORE="${KEYSTORE:-$ROOT/mckenna.keystore}"
ALIAS="${ALIAS:-mckenna}"
OUT="${OUT:-$ROOT/McKenna_Group_latest.apk}"

if [[ ! -f "$UNSIGNED" ]]; then
  echo "Compilando release..."
  ./gradlew assembleRelease
fi

if [[ ! -f "$UNSIGNED" ]]; then
  echo "No existe: $UNSIGNED"
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "No se encuentra keystore: $KEYSTORE"
  exit 1
fi

APKSIGNER="$(find "${ANDROID_HOME:-$HOME/Android/Sdk}/build-tools" -name apksigner 2>/dev/null | sort -V | tail -1)"
if [[ -z "$APKSIGNER" ]]; then
  echo "Instala Android SDK build-tools o define ANDROID_HOME."
  exit 1
fi

echo "Firmando → $OUT"
echo "(Te pedirá la contraseña del keystore si no está en KEYSTORE_PASS)"
echo ""

rm -f "$OUT"
cp "$UNSIGNED" "$OUT"

if [[ -n "${KEYSTORE_PASS:-}" ]]; then
  "$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "$ALIAS" \
    --ks-pass "pass:$KEYSTORE_PASS" \
    --out "$OUT" \
    "$OUT"
else
  "$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-key-alias "$ALIAS" \
    --out "$OUT" \
    "$OUT"
fi

"$APKSIGNER" verify "$OUT"
echo ""
echo "Listo: $OUT"
echo "Copia al teléfono e instala desde Archivos, o: adb install -r \"$OUT\""
