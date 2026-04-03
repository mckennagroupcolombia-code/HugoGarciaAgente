"""
REC-03: Seguimiento Post-Venta Automatizado
24 horas después de una venta confirmada (MeLi / WC), envía un WA al comprador
solicitando confirmación de recepción y calificación.
Se almacena en SQLite para evitar duplicados.
"""

import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta

DB_PATH = os.path.join("/home/mckg/mi-agente", "app", "data", "seguimiento_postventa.db")


def _init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS seguimientos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id    TEXT UNIQUE,
            plataforma  TEXT,
            comprador   TEXT,
            numero_wa   TEXT,
            producto    TEXT,
            pack_id     TEXT,
            vendido_en  TEXT,
            enviado     INTEGER DEFAULT 0,
            enviado_en  TEXT
        )
    """)
    conn.commit()
    conn.close()


_init_db()


def registrar_venta_para_seguimiento(order_id: str, plataforma: str, comprador: str,
                                      numero_wa: str, producto: str, pack_id: str = ""):
    """
    Registra una venta para que 24h después se envíe el mensaje de seguimiento.
    Llamar desde el webhook de MeLi/WC cuando se confirma pago.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT OR IGNORE INTO seguimientos (order_id, plataforma, comprador, numero_wa, producto, pack_id, vendido_en) "
            "VALUES (?,?,?,?,?,?,?)",
            (str(order_id), plataforma, comprador, numero_wa, producto, pack_id,
             datetime.now().isoformat())
        )
        conn.commit()
        print(f"📋 [POSTVENTA] Seguimiento registrado: {order_id} ({plataforma}) — {comprador}")
    except Exception as e:
        print(f"❌ [POSTVENTA] Error registrando: {e}")
    finally:
        conn.close()


def _mensaje_seguimiento(comprador: str, producto: str, plataforma: str) -> str:
    nombre = comprador.split()[0] if comprador else "veci"
    plat   = "MercadoLibre" if plataforma == "meli" else "nuestra tienda en línea"
    return (
        f"Hola {nombre}, soy Hugo García de *McKenna Group S.A.S.* 👋\n\n"
        f"Quería confirmar que recibiste tu pedido de *{producto}* realizado en {plat}. "
        f"¿Todo llegó en perfectas condiciones? 📦✅\n\n"
        f"Si tienes alguna novedad o inquietud, con gusto te ayudo. "
        f"Y si todo estuvo bien, te agradecemos mucho si nos dejas una reseña — "
        f"nos ayuda a seguir mejorando 🙏"
    )


def _procesar_seguimientos_pendientes():
    """Busca ventas de hace 24h+ sin mensaje enviado y los despacha."""
    from app.utils import enviar_whatsapp_reporte

    conn = sqlite3.connect(DB_PATH)
    limite = (datetime.now() - timedelta(hours=24)).isoformat()
    rows = conn.execute(
        "SELECT id, order_id, plataforma, comprador, numero_wa, producto "
        "FROM seguimientos WHERE enviado=0 AND vendido_en <= ?",
        (limite,)
    ).fetchall()

    for row in rows:
        sid, order_id, plat, comprador, numero_wa, producto = row
        try:
            if numero_wa:
                msg = _mensaje_seguimiento(comprador, producto, plat)
                enviar_whatsapp_reporte(msg, numero_destino=numero_wa)
                print(f"✅ [POSTVENTA] Seguimiento enviado → {comprador} ({order_id})")
            conn.execute(
                "UPDATE seguimientos SET enviado=1, enviado_en=? WHERE id=?",
                (datetime.now().isoformat(), sid)
            )
            conn.commit()
        except Exception as e:
            print(f"❌ [POSTVENTA] Error enviando seguimiento {order_id}: {e}")

    conn.close()
    return len(rows)


def iniciar_monitor_postventa():
    """
    Daemon que cada hora verifica ventas listas para recibir seguimiento.
    Se llama desde el arranque del agente.
    """
    def _loop():
        time.sleep(300)  # Esperar 5 min al arrancar
        while True:
            try:
                n = _procesar_seguimientos_pendientes()
                if n:
                    print(f"🔔 [POSTVENTA] {n} mensajes de seguimiento enviados")
            except Exception as e:
                print(f"❌ [POSTVENTA] Error en monitor: {e}")
            time.sleep(3600)  # Cada hora

    t = threading.Thread(target=_loop, daemon=True, name="monitor-postventa")
    t.start()
    print("✅ Monitor de seguimiento post-venta iniciado")
