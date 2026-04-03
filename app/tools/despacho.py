"""
REC-05: Integración con Sistema de Despacho / Transporte
- Genera guías Interrapidísimo al confirmar pago
- Notifica al cliente el número de guía y tiempo estimado
- Registro local de guías generadas
"""

import os
import json
import sqlite3
import requests
from datetime import datetime

DB_PATH   = os.path.join("/home/mckg/mi-agente", "app", "data", "despachos.db")
TARIFAS_P = os.path.join("/home/mckg/mi-agente", "app", "data", "tarifas_interrapidisimo.json")


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS despachos (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id        TEXT UNIQUE,
            numero_wa       TEXT,
            cliente         TEXT,
            direccion       TEXT,
            ciudad          TEXT,
            productos       TEXT,
            peso_kg         REAL,
            guia            TEXT,
            transportadora  TEXT DEFAULT 'Interrapidísimo',
            tarifa          REAL,
            estado          TEXT DEFAULT 'PENDIENTE',
            creado_en       TEXT,
            entregado_en    TEXT
        )
    """)
    conn.commit()
    conn.close()

_init_db()


def _leer_tarifa(ciudad: str) -> dict:
    try:
        with open(TARIFAS_P, encoding="utf-8") as f:
            data = json.load(f)
        ciudad_norm = ciudad.lower().strip()
        for k, v in data.get("ciudades", {}).items():
            if ciudad_norm in k.lower() or k.lower() in ciudad_norm:
                return v
        return data.get("ciudades", {}).get("default", {"precio_base": 18000, "dias": 5})
    except Exception:
        return {"precio_base": 18000, "dias": 5}


def crear_guia_despacho(order_id: str, cliente: str, numero_wa: str,
                        direccion: str, ciudad: str, productos: list,
                        peso_kg: float = 1.0) -> dict:
    """
    Registra el despacho y notifica al cliente.
    En producción real se conectaría al API de Interrapidísimo.
    Por ahora genera número de guía interno y usa tarifas del JSON.

    Retorna: {"guia": "...", "tarifa": ..., "dias": ..., "ok": True/False}
    """
    from app.utils import enviar_whatsapp_reporte

    tarifa_info = _leer_tarifa(ciudad)
    tarifa      = tarifa_info.get("precio_base", 18000)
    dias        = tarifa_info.get("dias", 5)

    # Peso extra
    if peso_kg > 1.0:
        tarifa += int(peso_kg - 1.0) * 2000

    # Número de guía simulado (en producción vendría de la API)
    guia = f"IRR{datetime.now().strftime('%Y%m%d%H%M%S')}{order_id[-4:]}"
    prods_str = ", ".join(f"{p.get('nombre','')} x{p.get('cantidad',1)}" for p in productos)

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT OR REPLACE INTO despachos (order_id, numero_wa, cliente, direccion, ciudad, "
            "productos, peso_kg, guia, tarifa, creado_en) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (order_id, numero_wa, cliente, direccion, ciudad, prods_str,
             peso_kg, guia, tarifa, datetime.now().isoformat())
        )
        conn.commit()
    finally:
        conn.close()

    # Mensaje al cliente
    nombre = cliente.split()[0] if cliente else "veci"
    msg = (
        f"📦 *Pedido en camino, {nombre}!*\n\n"
        f"🚚 Transportadora: *Interrapidísimo*\n"
        f"🔢 Número de guía: *{guia}*\n"
        f"📍 Destino: {ciudad}\n"
        f"⏰ Tiempo estimado: *{dias} días hábiles*\n\n"
        f"Puedes hacer seguimiento en interrapidisimo.com.co con tu número de guía. "
        f"¡Cualquier novedad estamos a la orden! 🙌"
    )
    if numero_wa:
        enviar_whatsapp_reporte(msg, numero_destino=numero_wa)

    # Notificar al grupo
    enviar_whatsapp_reporte(
        f"🚚 *Despacho generado*\n"
        f"📦 Orden: {order_id}\n👤 Cliente: {cliente}\n"
        f"🔢 Guía: {guia}\n📍 Ciudad: {ciudad}\n💵 Flete: ${tarifa:,.0f}"
    )

    print(f"🚚 [DESPACHO] Guía {guia} generada para {order_id} → {ciudad}")
    return {"guia": guia, "tarifa": tarifa, "dias": dias, "ok": True}


def obtener_estado_despacho(order_id: str) -> dict | None:
    """Retorna el estado actual de un despacho por order_id."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT guia, transportadora, ciudad, estado, tarifa, creado_en FROM despachos WHERE order_id=?",
        (order_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"guia": row[0], "transportadora": row[1], "ciudad": row[2],
            "estado": row[3], "tarifa": row[4], "creado_en": row[5]}


def marcar_entregado(guia: str):
    """Marca un despacho como entregado."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE despachos SET estado='ENTREGADO', entregado_en=? WHERE guia=?",
        (datetime.now().isoformat(), guia)
    )
    conn.commit()
    conn.close()
    print(f"✅ [DESPACHO] Guía {guia} marcada como entregada")
