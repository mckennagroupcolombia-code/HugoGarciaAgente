#!/usr/bin/env bash
# Compila y firma la APK de colaboradores → McKenna_Colaboradores.apk
# Subir versionCode/versionName en app/build.gradle antes de entregar una nueva.
set -euo pipefail
cd "$(dirname "$0")"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
[[ -f keystore.properties ]] || { echo "Falta keystore.properties (ver LEEME.md)"; exit 1; }
./gradlew assembleRelease --no-daemon -q
cp app/build/outputs/apk/release/app-release.apk McKenna_Colaboradores.apk
"$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -1)" verify McKenna_Colaboradores.apk
echo "Listo: $(pwd)/McKenna_Colaboradores.apk ($(du -h McKenna_Colaboradores.apk | cut -f1))"
