#!/bin/bash
# =============================================================================
#  start.sh — Script de arranque del Agente McKenna Group
# =============================================================================
#
#  Secuencia de inicio:
#  1. Carga las variables del .env
#  2. Inicia cloudflared tunnel apuntando a http://localhost:8081 en background
#  3. Captura y guarda la URL pública generada en tunnel_url.txt
#  4. Inicia el agente principal con: python3 agente_pro.py
#  5. Al cerrar (Ctrl+C), detiene también el tunnel limpiamente
#
# =============================================================================

set -e

# --- Directorio del script (raíz del proyecto) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- 1. Cargar variables de entorno desde .env ---
if [ -f ".env" ]; then
    echo "📋 Cargando variables de entorno desde .env..."
    set -a
    source .env
    set +a
else
    echo "⚠️  Advertencia: No se encontró el archivo .env. Continuando sin él."
fi

# --- Archivo de log temporal para capturar la URL del tunnel ---
TUNNEL_LOG="$SCRIPT_DIR/.tunnel_output.log"
TUNNEL_URL_FILE="$SCRIPT_DIR/tunnel_url.txt"
TUNNEL_PID_FILE="$SCRIPT_DIR/.tunnel.pid"

# --- Función de limpieza al salir (Ctrl+C o señal de cierre) ---
cleanup() {
    echo ""
    echo "🛑 Deteniendo el agente y el tunnel de Cloudflare..."

    # Detener cloudflared si tenemos su PID
    if [ -f "$TUNNEL_PID_FILE" ]; then
        TUNNEL_PID=$(cat "$TUNNEL_PID_FILE")
        if kill -0 "$TUNNEL_PID" 2>/dev/null; then
            kill "$TUNNEL_PID"
            echo "✅ Tunnel de Cloudflare detenido (PID: $TUNNEL_PID)."
        fi
        rm -f "$TUNNEL_PID_FILE"
    fi

    # Limpiar archivos temporales
    rm -f "$TUNNEL_LOG"

    echo "👋 Agente detenido correctamente."
    exit 0
}

# Registrar la función de limpieza para señales de cierre
trap cleanup SIGINT SIGTERM EXIT

# --- 2. Iniciar cloudflared tunnel en background ---
echo "🌐 Iniciando Cloudflare Tunnel apuntando a http://localhost:8081..."

# Verificar si cloudflared está disponible
if ! command -v cloudflared &>/dev/null; then
    echo "⚠️  cloudflared no encontrado en PATH. Intentando con ruta local..."
    # Intentar con el .deb instalado o ruta alternativa
    if [ -f "/usr/local/bin/cloudflared" ]; then
        CLOUDFLARED_CMD="/usr/local/bin/cloudflared"
    elif [ -f "$SCRIPT_DIR/cloudflared" ]; then
        CLOUDFLARED_CMD="$SCRIPT_DIR/cloudflared"
    else
        echo "❌ cloudflared no está instalado. Iniciando el agente sin tunnel..."
        CLOUDFLARED_CMD=""
    fi
else
    CLOUDFLARED_CMD="cloudflared"
fi

# Iniciar el tunnel si cloudflared está disponible
if [ -n "$CLOUDFLARED_CMD" ]; then
    # Si hay un CLOUDFLARE_TUNNEL_TOKEN configurado, usar tunnel autenticado
    if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
        echo "🔑 Usando tunnel autenticado con CLOUDFLARE_TUNNEL_TOKEN..."
        $CLOUDFLARED_CMD tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" \
            > "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        echo $TUNNEL_PID > "$TUNNEL_PID_FILE"
        echo "✅ Tunnel autenticado iniciado (PID: $TUNNEL_PID)."
        echo "ℹ️  La URL del tunnel está configurada en tu dashboard de Cloudflare."
    else
        # Tunnel rápido (quick tunnel) — genera URL temporal
        echo "⚡ Usando quick tunnel (URL temporal)..."
        $CLOUDFLARED_CMD tunnel --no-autoupdate --url http://localhost:8081 \
            > "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!
        echo $TUNNEL_PID > "$TUNNEL_PID_FILE"
        echo "⏳ Esperando que el tunnel genere la URL pública..."

        # --- 3. Capturar la URL pública generada ---
        URL_FOUND=""
        for i in $(seq 1 30); do
            sleep 1
            # Buscar la URL en el log (cloudflared la imprime con el patrón trycloudflare.com)
            URL_FOUND=$(grep -oP 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
            if [ -n "$URL_FOUND" ]; then
                break
            fi
        done

        if [ -n "$URL_FOUND" ]; then
            echo "$URL_FOUND" > "$TUNNEL_URL_FILE"
            echo "✅ URL pública del tunnel: $URL_FOUND"
            echo "📄 URL guardada en: tunnel_url.txt"
        else
            echo "⚠️  No se pudo capturar la URL del tunnel automáticamente."
            echo "    Revisa el log en: $TUNNEL_LOG"
        fi
    fi
else
    echo "⚠️  Continuando sin Cloudflare Tunnel."
fi

# --- 4. Iniciar el website nativo (puerto 8083) ---
echo "🌐 Iniciando website nativo McKenna Group (puerto 8083)..."
python3 "$SCRIPT_DIR/PAGINA_WEB/site/website.py" > "$SCRIPT_DIR/.website.log" 2>&1 &
WEBSITE_PID=$!
echo "   Website PID: $WEBSITE_PID"
sleep 2
if kill -0 "$WEBSITE_PID" 2>/dev/null; then
    echo "   ✅ Website iniciado correctamente"
else
    echo "   ⚠️  Website no pudo iniciar — revisa .website.log"
fi

# --- 5. Iniciar el agente principal ---
echo ""
echo "🚀 Iniciando el Agente McKenna Group (agente_pro.py)..."
echo "   Puerto: 8081"
echo "   Presiona Ctrl+C para detener."
echo ""

# Desactivar el trap EXIT temporalmente para que no se dispare al terminar python normalmente
trap - EXIT

python3 agente_pro.py

# Restaurar el trap para la limpieza final
trap cleanup SIGINT SIGTERM

# Si python termina por sí solo, ejecutar limpieza
cleanup
