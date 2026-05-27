#!/usr/bin/env bash
# Captura el crash de McKenna Panel al abrir la APK (requiere Depuración USB, no solo MTP).
set -euo pipefail

PKG="co.mckennagroup.panel"
APK="${1:-/home/mckg/mi-agente/android-twa/app/build/outputs/apk/release/app-release.apk}"

echo "=== McKenna Android — captura de crash ==="
echo ""

if ! command -v adb >/dev/null 2>&1; then
  echo "Instala adb: sudo apt install adb"
  exit 1
fi

adb kill-server >/dev/null 2>&1 || true
adb start-server

echo "Dispositivos ADB:"
adb devices -l
echo ""

if ! adb get-state >/dev/null 2>&1; then
  echo "❌ El teléfono NO está en modo depuración USB."
  echo ""
  echo "En el Xiaomi (MIUI / HyperOS):"
  echo "  1. Ajustes → Mi dispositivo → Toda la info → pulsa 7 veces «Versión MIUI/OS»"
  echo "  2. Ajustes → Ajustes adicionales → Opciones de desarrollador"
  echo "  3. Activa «Depuración USB»"
  echo "  4. (Recomendado) «Depuración USB (Configuración de seguridad)»"
  echo "  5. Conecta el cable; en la notificación USB elige «Transferencia de archivos»"
  echo "  6. En el teléfono acepta «¿Permitir depuración USB?» (marca «Siempre»)"
  echo ""
  echo "Luego ejecuta de nuevo: $0"
  exit 1
fi

if [[ -f "$APK" ]]; then
  echo "Instalando $APK ..."
  adb install -r "$APK" || adb install -r -d "$APK"
  echo ""
fi

echo "Limpiando log y abriendo la app (mira el teléfono)..."
adb logcat -c
adb shell am start -n "${PKG}/.LauncherActivity" || true

echo "Grabando 25 s de log → /tmp/mckenna_crash.log"
timeout 25 adb logcat -v time \
  AndroidRuntime:E \
  McKennaLauncher:I \
  McKennaDeepLink:I \
  AlarmaReceiver:I \
  AlarmAudioCache:I \
  chromium:W \
  cr_TwaLauncher:W \
  TrustedWebActivity:W \
  ActivityManager:I \
  *:S \
  2>&1 | tee /tmp/mckenna_crash.log || true

echo ""
echo "=== Líneas FATAL / mckennagroup ==="
grep -iE "FATAL|mckennagroup|McKenna|TrustedWeb|cr_WebView|VerifyError|SecurityException" /tmp/mckenna_crash.log | tail -40 || echo "(ninguna — abre la app manualmente y vuelve a correr el script)"

echo ""
echo "Log completo: /tmp/mckenna_crash.log"
