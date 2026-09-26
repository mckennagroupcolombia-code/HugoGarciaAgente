"""Mensaje automático al comprador cuando se vende un SKU configurado.

Al llegar una orden pagada por el webhook `orders_v2`, si alguno de los ítems
tiene un SKU listado en `app/data/mensajes_venta_sku.json`, se escribe ese texto
en el chat posventa de la compra (API messages de MeLi) y se avisa al grupo de
WhatsApp de posventa.

MeLi manda `orders_v2` muchas veces por la misma orden (pago, tags, envío…),
así que cada par orden+SKU se anota en `mensajes_venta_sku_enviados.json` y se
envía una sola vez, incluso si dos notificaciones llegan en paralelo.

Formato de la configuración (clave = SKU tal como está en la publicación):

    {
      "C-FRBSGL120mL": {
        "texto": "Hola! ...",
        "activo": true
      }
    }

Política MeLi: el texto no debe llevar enlaces ni datos de contacto.
Apagado global con `MELI_MENSAJE_VENTA_SKU_ACTIVO=0`.
"""

from __future__ import annotations

import json
import os
import threading
import time

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CONFIG_PATH = os.path.join(_DATA_DIR, "mensajes_venta_sku.json")
ENVIADOS_PATH = os.path.join(_DATA_DIR, "mensajes_venta_sku_enviados.json")

_MAX_REGISTROS = 2000
_lock = threading.Lock()


def _activo() -> bool:
    return os.getenv("MELI_MENSAJE_VENTA_SKU_ACTIVO", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _normalizar_sku(sku: str | None) -> str:
    return (sku or "").strip().upper()


def cargar_mensajes_por_sku(path: str | None = None) -> dict[str, str]:
    """SKU normalizado (mayúsculas) -> texto. Solo entradas activas con texto."""
    ruta = path or CONFIG_PATH
    try:
        with open(ruta, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f"⚠️ [MELI-MSG-SKU] Config ilegible {ruta}: {e}")
        return {}
    if not isinstance(data, dict):
        return {}
    salida: dict[str, str] = {}
    for sku, cfg in data.items():
        if isinstance(cfg, str):
            texto, activo = cfg, True
        elif isinstance(cfg, dict):
            texto = cfg.get("texto") or ""
            activo = cfg.get("activo", True)
        else:
            continue
        texto = str(texto).strip()
        clave = _normalizar_sku(sku)
        if clave and texto and activo:
            salida[clave] = texto
    return salida


def mensaje_para_sku(sku: str | None, path: str | None = None) -> str | None:
    return cargar_mensajes_por_sku(path).get(_normalizar_sku(sku))


def _cargar_enviados(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        print(f"⚠️ [MELI-MSG-SKU] Registro ilegible {path}: {e}")
        return {}


def _guardar_enviados(path: str, data: dict) -> None:
    if len(data) > _MAX_REGISTROS:
        # Conservar los más recientes (orden de inserción del dict).
        data = dict(list(data.items())[-_MAX_REGISTROS:])
    tmp = f"{path}.tmp"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def procesar_mensaje_venta_sku(
    order_id: str,
    sku: str | None,
    *,
    nombre_producto: str = "",
    comprador: str = "",
    config_path: str | None = None,
    enviados_path: str | None = None,
) -> str:
    """Devuelve "sin_match", "inactivo", "ya_enviado", "enviado" o "fallo".

    Se llama por cada ítem de una orden pagada. Nunca lanza.
    """
    if not _activo():
        return "inactivo"
    texto = mensaje_para_sku(sku, config_path)
    if not texto:
        return "sin_match"

    order_id = str(order_id).strip()
    clave = f"{order_id}:{_normalizar_sku(sku)}"
    ruta_enviados = enviados_path or ENVIADOS_PATH

    # Reservar la clave antes de enviar: dos hilos con la misma orden no deben
    # mandar el mensaje dos veces (como pasó con la auto-respuesta de factura).
    with _lock:
        enviados = _cargar_enviados(ruta_enviados)
        if clave in enviados:
            return "ya_enviado"
        enviados[clave] = {
            "estado": "enviando",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        try:
            _guardar_enviados(ruta_enviados, enviados)
        except Exception as e:
            print(f"⚠️ [MELI-MSG-SKU] No pude guardar registro {ruta_enviados}: {e}")

    ok = False
    try:
        from modulo_posventa import responder_mensaje_posventa

        ok = bool(responder_mensaje_posventa(order_id, texto))
    except Exception as e:
        print(f"❌ [MELI-MSG-SKU] Error enviando a MeLi orden {order_id}: {e}")

    with _lock:
        enviados = _cargar_enviados(ruta_enviados)
        if ok:
            enviados[clave] = {
                "estado": "enviado",
                "sku": sku,
                "producto": nombre_producto,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
        else:
            # Liberar la clave: la próxima notificación de la orden reintenta.
            enviados.pop(clave, None)
        try:
            _guardar_enviados(ruta_enviados, enviados)
        except Exception as e:
            print(f"⚠️ [MELI-MSG-SKU] No pude guardar registro {ruta_enviados}: {e}")

    if not ok:
        print(f"❌ [MELI-MSG-SKU] Falló el mensaje por SKU {sku} en orden {order_id}")
        return "fallo"

    print(f"✅ [MELI-MSG-SKU] Mensaje por SKU {sku} enviado en orden {order_id}")
    _avisar_grupo(order_id, sku, texto, nombre_producto, comprador)
    return "enviado"


def _avisar_grupo(order_id: str, sku, texto: str, nombre_producto: str, comprador: str) -> None:
    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_postventa_wa

        sufijo = order_id[-6:]
        aviso = (
            "🤖 *Mensaje automático por venta (SKU)*\n\n"
            f"🔢 Orden: *{order_id}* (código {sufijo})\n"
            f"📦 {nombre_producto or sku}\n"
            f"👤 {comprador or 'Comprador'}\n\n"
            f"🗣 Se le escribió: _{texto}_\n\n"
            "✍️ Para complementar o corregir:\n"
            f"*posventa {sufijo}: tu mensaje*"
        )
        enviar_whatsapp_reporte(aviso, numero_destino=jid_grupo_postventa_wa())
    except Exception as e:
        print(f"⚠️ [MELI-MSG-SKU] No pude avisar al grupo: {e}")
