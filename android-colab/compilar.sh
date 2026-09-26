#!/usr/bin/env bash
# Compila y firma la APK de colaboradores → McKenna_Colaboradores.apk
#   ./compilar.sh          → misma versión (versionCode igual)
#   ./compilar.sh 1.1.0    → versionName 1.1.0 y versionCode +1 (para instalar encima)
# También lo lanza /app → Ajustes → App de colaboradores (POST /api/build-apk-colab).
set -euo pipefail
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
[[ -f keystore.properties ]] || { echo "Falta keystore.properties (ver LEEME.md)"; exit 1; }
if [[ -n "${1:-}" ]]; then
  [[ "$1" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]] || { echo "Versión inválida: $1"; exit 1; }
  codigo=$(( $(sed -n 's/^versionCode=//p' version.properties) + 1 ))
  printf "versionName=%s\nversionCode=%s\n" "$1" "$codigo" > version.properties
fi
echo "Versión $(sed -n 's/^versionName=//p' version.properties) (code $(sed -n 's/^versionCode=//p' version.properties))"
[[ -f local.properties ]] || echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleRelease --no-daemon -q
cp app/build/outputs/apk/release/app-release.apk McKenna_Colaboradores.apk
"$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -1)" verify McKenna_Colaboradores.apk
echo "Listo: $(pwd)/McKenna_Colaboradores.apk ($(du -h McKenna_Colaboradores.apk | cut -f1))"
