import re
import os
import json
import sqlite3
import threading
import time
from typing import Any
import gspread
import requests
from datetime import datetime, timedelta

# --- Importaciones de Servicios y Utilidades Modulares ---
# Migrado de Siigo a Alegra 2026-09-03 — ver app/services/alegra.py
from app.services.alegra import (
    obtener_facturas_hibridas as obtener_facturas_siigo_paginadas,
    alegra_factura_etiqueta_log as siigo_factura_etiqueta_log,
    alegra_factura_estado_log as siigo_factura_estado_log,
    alegra_omitir_pdf_mientras_timbrado as siigo_omitir_pdf_mientras_timbrado,
    obtener_documento_fiscal_alegra_para_meli as obtener_documento_fiscal_siigo_para_meli,
)
from app.services.meli import meli_pack_tiene_documento_fiscal, subir_factura_meli
from app.utils import refrescar_token_meli, enviar_whatsapp_reporte, jid_grupo_inventario_wa
from app.tools.system_tools import enviar_reporte_controlado
from app.services.tickets_db import (
    init_db as tickets_init_db,
    crear_ticket,
    DB_PATH as TICKETS_DB_PATH,
    get_aliados_asignaciones,
    TAREA_SYNC_FACTURAS_FALTANTES_SIIGO,
)


TITULO_SYNC_FACTURAS_FALTANTES_SIIGO = "Sync facturas faltantes MeLi↔Alegra"

# Categorías del cruce MeLi↔Siigo (pack sin documento fiscal en MeLi aún).
SYNC_FACTURA_CAT_SIN_CRUCE = "sin_cruce_siigo"
SYNC_FACTURA_CAT_TIMBRADO = "esperando_timbrado"
SYNC_FACTURA_CAT_SIN_DOC = "sin_documento_siigo"
SYNC_FACTURA_CAT_FALLO_SUBIDA = "fallo_subida_meli"
SYNC_FACTURA_CATEGORIAS_ORDEN = (
    SYNC_FACTURA_CAT_SIN_CRUCE,
    SYNC_FACTURA_CAT_TIMBRADO,
    SYNC_FACTURA_CAT_SIN_DOC,
    SYNC_FACTURA_CAT_FALLO_SUBIDA,
)


def _categorias_sync_facturas_vacias() -> dict[str, list[str]]:
    return {k: [] for k in SYNC_FACTURA_CATEGORIAS_ORDEN}


# --- Seguimiento persistente de packs sin factura ------------------------
# sincronizar_inteligente() solo mira los últimos 15 días de órdenes MeLi;
# sin esto, un pack genuinamente sin facturar dejaba de aparecer en el
# cruce (y en el ticket diario) al salir de esa ventana, sin haberse
# resuelto nunca — se perdía en silencio. Ver caso real 2000014497692789
# (28-ago-2026, $161.520, 16 días sin facturar, ya no aparecía en ningún
# ticket). Este store mantiene cada pack pendiente rastreado día a día
# hasta que se le sube factura a MeLi o se confirma que ya no aplica
# (orden cancelada/no pagada).
SYNC_FACTURAS_SEGUIMIENTO_PATH = os.path.join(
    os.path.dirname(__file__), "data", "sync_facturas_faltantes_seguimiento.json"
)
SYNC_FACTURAS_SEGUIMIENTO_MAX_DIAS = 90  # tope de antigüedad para no rastrear para siempre
_SYNC_FACTURAS_SEGUIMIENTO_LOCK = threading.Lock()


def _leer_seguimiento_sync_facturas() -> dict[str, dict]:
    try:
        with open(SYNC_FACTURAS_SEGUIMIENTO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("pendientes"), dict):
                return data
    except Exception:
        pass
    return {"pendientes": {}}


def _guardar_seguimiento_sync_facturas(data: dict) -> None:
    try:
        with open(SYNC_FACTURAS_SEGUIMIENTO_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ [SYNC-SEGUIMIENTO] No se pudo guardar: {e}")


def _packs_seguimiento_vigentes() -> dict[str, dict]:
    """Packs rastreados que aún no superan el tope de antigüedad."""
    limite = datetime.now() - timedelta(days=SYNC_FACTURAS_SEGUIMIENTO_MAX_DIAS)
    with _SYNC_FACTURAS_SEGUIMIENTO_LOCK:
        data = _leer_seguimiento_sync_facturas()
    vigentes = {}
    for p_id, meta in data.get("pendientes", {}).items():
        try:
            primera = datetime.fromisoformat(meta.get("primera_vez", ""))
        except ValueError:
            primera = datetime.now()
        if primera >= limite:
            vigentes[p_id] = meta
    return vigentes


def _pack_meli_sigue_vigente(pack_id: str, token: str) -> bool:
    """
    True si el pack/orden todavía representa una venta que debería facturarse
    (no cancelada / no pagada). En caso de error de red o respuesta inesperada
    se asume vigente (mejor seguir rastreando de más que perder un caso real).
    """
    headers = {"Authorization": f"Bearer {token}"}
    try:
        r = requests.get(f"https://api.mercadolibre.com/packs/{pack_id}", headers=headers, timeout=15)
        if r.status_code == 200:
            estado = (r.json() or {}).get("status")
            return estado != "cancelled"
        r = requests.get(f"https://api.mercadolibre.com/orders/{pack_id}", headers=headers, timeout=15)
        if r.status_code == 200:
            estado = (r.json() or {}).get("status")
            return estado not in ("cancelled", "invalid")
    except requests.RequestException:
        pass
    return True


def _actualizar_seguimiento_sync_facturas(
    categorias: dict[str, list[str]],
    *,
    resueltos: list[str],
    descartados: list[str],
) -> None:
    """
    Persiste el estado de seguimiento tras una corrida de sincronizar_inteligente():
    - agrega/actualiza los packs aún pendientes (preserva `primera_vez`).
    - quita los que ya se subieron a MeLi (`resueltos`) o dejaron de aplicar
      (`descartados`: cancelados/no pagados detectados al re-chequear packs
      viejos que ya habían salido de la ventana de 15 días).
    """
    ahora = datetime.now().isoformat(timespec="seconds")
    pendientes_actuales = _packs_accionables_sync(categorias)
    with _SYNC_FACTURAS_SEGUIMIENTO_LOCK:
        data = _leer_seguimiento_sync_facturas()
        store = data["pendientes"]
        for cat in SYNC_FACTURA_CATEGORIAS_ORDEN:
            for p_id in categorias.get(cat, []) or []:
                entrada = store.setdefault(p_id, {"primera_vez": ahora})
                entrada["ultima_vez"] = ahora
                entrada["categoria"] = cat
        for p_id in resueltos + descartados:
            store.pop(p_id, None)
        _guardar_seguimiento_sync_facturas(data)


def _indexar_facturas_siigo_por_packs(
    facturas_siigo: list, pack_ids: list[str]
) -> dict[str, dict]:
    """Mapea pack_id → factura Alegra (observations / purchase_order)."""
    pack_set = {str(p).strip() for p in pack_ids if str(p).strip()}
    fac_match: dict[str, dict] = {}
    for fac in facturas_siigo:
        obs = (
            str(fac.get("observations", ""))
            + " "
            + str(fac.get("purchase_order", ""))
        )
        for p in list(pack_set):
            if p in obs:
                fac_match[p] = fac
                pack_set.discard(p)
        if not pack_set:
            break
    return fac_match


def _intentar_sync_pack_desde_factura_siigo(
    pack_id: str,
    fac: dict,
    cache_doc: dict[str, tuple[Any, str]],
) -> tuple[str, str | None]:
    """
    Intenta obtener documento Alegra y subirlo a MeLi.
    Retorna (categoría, detalle_opcional).
    categoría: 'ok' | SYNC_FACTURA_CAT_* .
    """
    if siigo_omitir_pdf_mientras_timbrado(fac):
        est = siigo_factura_estado_log(fac)
        return (
            SYNC_FACTURA_CAT_TIMBRADO,
            f"estado Alegra: {est or 'pendiente timbrado DIAN'}",
        )

    sid = str(fac.get("id") or "").strip()
    if not sid:
        return (SYNC_FACTURA_CAT_SIN_DOC, "factura Alegra sin id")

    if sid in cache_doc:
        doc, fmt = cache_doc[sid]
    else:
        doc, fmt = obtener_documento_fiscal_siigo_para_meli(sid)
        cache_doc[sid] = (doc, fmt)

    if not doc:
        return (
            SYNC_FACTURA_CAT_SIN_DOC,
            f"{siigo_factura_etiqueta_log(fac)} (est={siigo_factura_estado_log(fac)})",
        )

    res = subir_factura_meli(pack_id, doc, formato=fmt)
    if isinstance(res, str) and "✅" in res:
        return ("ok", None)

    detalle = (res or "error desconocido")[:220]
    return (SYNC_FACTURA_CAT_FALLO_SUBIDA, detalle)


def _procesar_packs_sync_siigo(
    pack_ids: list[str], facturas_siigo: list
) -> dict[str, Any]:
    """Cruza packs pendientes en MeLi con facturas Alegra y sube cuando es posible."""
    categorias = _categorias_sync_facturas_vacias()
    fallo_detalle: dict[str, str] = {}
    exitosas: list[str] = []
    cache_doc: dict[str, tuple[Any, str]] = {}
    fac_match = _indexar_facturas_siigo_por_packs(facturas_siigo, pack_ids)

    for p_id in pack_ids:
        fac = fac_match.get(p_id)
        if not fac:
            categorias[SYNC_FACTURA_CAT_SIN_CRUCE].append(p_id)
            print(f"   └──> ❓ Pack {p_id}: sin cruce en Alegra (observations/purchase_order)")
            continue

        cat, detalle = _intentar_sync_pack_desde_factura_siigo(p_id, fac, cache_doc)
        if cat == "ok":
            exitosas.append(p_id)
            print(f"   └──> ✅ Sincronizada factura para Pack ID: {p_id}")
            continue

        categorias[cat].append(p_id)
        if detalle:
            fallo_detalle[p_id] = detalle
        if cat == SYNC_FACTURA_CAT_TIMBRADO:
            print(f"   └──> ⏭️ Pack {p_id}: esperando timbrado ({detalle})")
        elif cat == SYNC_FACTURA_CAT_SIN_DOC:
            print(f"   └──> ⚠️ Pack {p_id}: sin PDF/XML en Alegra ({detalle})")
        else:
            print(f"   └──> ❌ Pack {p_id}: fallo subida MeLi ({detalle})")

    return {
        "exitosas": exitosas,
        "categorias": categorias,
        "fallo_detalle": fallo_detalle,
    }


def _packs_accionables_sync(categorias: dict[str, list[str]]) -> list[str]:
    """IDs que requieren intervención o seguimiento (incluye timbrado pendiente)."""
    vistos: set[str] = set()
    orden: list[str] = []
    for cat in SYNC_FACTURA_CATEGORIAS_ORDEN:
        for p in categorias.get(cat, []) or []:
            if p not in vistos:
                vistos.add(p)
                orden.append(p)
    return orden


def _packs_criticos_sync(categorias: dict[str, list[str]]) -> list[str]:
    """IDs sin factura en MeLi que no se explican solo por timbrado en curso."""
    out: list[str] = []
    vistos: set[str] = set()
    for cat in (
        SYNC_FACTURA_CAT_SIN_CRUCE,
        SYNC_FACTURA_CAT_SIN_DOC,
        SYNC_FACTURA_CAT_FALLO_SUBIDA,
    ):
        for p in categorias.get(cat, []) or []:
            if p not in vistos:
                vistos.add(p)
                out.append(p)
    return out


def _formatear_lista_pack_ids(pack_ids: list[str], max_items: int = 15) -> str:
    if not pack_ids:
        return "_(ninguno)_"
    lineas = [f"- {p}" for p in pack_ids[:max_items]]
    if len(pack_ids) > max_items:
        lineas.append(f"- … y {len(pack_ids) - max_items} más")
    return "\n".join(lineas)


def _formatear_reporte_sync_facturas(
    exitosas: list[str],
    categorias: dict[str, list[str]],
    fallo_detalle: dict[str, str] | None = None,
) -> str:
    """Mensaje WhatsApp con secciones por tipo de pendiente."""
    fallo_detalle = fallo_detalle or {}
    criticos = _packs_criticos_sync(categorias)
    timbrado = categorias.get(SYNC_FACTURA_CAT_TIMBRADO, [])
    n_crit = len(criticos)
    n_tim = len(timbrado)

    if n_crit:
        resumen = (
            f"⚠️ *ALERTA DE FACTURACIÓN* ⚠️\n"
            f"Subidas a MeLi: {len(exitosas)} · "
            f"Pendientes críticos: {n_crit}"
            + (f" · En timbrado Alegra: {n_tim}" if n_tim else "")
        )
    elif n_tim:
        resumen = (
            f"ℹ️ *Sync facturas MeLi↔Alegra*\n"
            f"Subidas: {len(exitosas)} · "
            f"{n_tim} pack(s) con factura en Alegra esperando timbrado DIAN (sin subir aún)."
        )
    else:
        return ""

    partes = [resumen]
    secciones = (
        (
            SYNC_FACTURA_CAT_SIN_CRUCE,
            "Sin cruce en Alegra",
            "No aparece el Pack ID en observations/purchase_order de ninguna factura reciente.",
        ),
        (
            SYNC_FACTURA_CAT_SIN_DOC,
            "Factura en Alegra sin PDF/XML",
            "Hay cruce en Alegra pero aún no hay documento descargable para MeLi.",
        ),
        (
            SYNC_FACTURA_CAT_FALLO_SUBIDA,
            "Fallo al subir a MeLi",
            "Documento listo en Alegra pero la API de MeLi rechazó o falló la subida.",
        ),
        (
            SYNC_FACTURA_CAT_TIMBRADO,
            "Esperando timbrado DIAN",
            "Factura en Alegra en borrador/envío; reintentar cuando esté timbrada.",
        ),
    )
    for cat, titulo, ayuda in secciones:
        ids = categorias.get(cat, [])
        if not ids:
            continue
        bloque = f"\n*{titulo} ({len(ids)}):*\n{ayuda}\n{_formatear_lista_pack_ids(ids)}"
        if cat == SYNC_FACTURA_CAT_FALLO_SUBIDA and fallo_detalle:
            ejemplos = []
            for p in ids[:5]:
                d = fallo_detalle.get(p)
                if d:
                    ejemplos.append(f"  · {p}: {d[:120]}")
            if ejemplos:
                bloque += "\n_Detalle:_\n" + "\n".join(ejemplos)
        partes.append(bloque)

    return "\n".join(partes)


def _get_admin_creator_id() -> int | None:
    """
    Para tickets que crea el sistema desde tareas backend (sync),
    elegimos el usuario 'admin' si existe; si no, el primero activo.
    """
    try:
        tickets_init_db()
        with sqlite3.connect(TICKETS_DB_PATH) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
            if row and row["id"]:
                return int(row["id"])
            row = db.execute(
                "SELECT id FROM usuarios WHERE activo=1 ORDER BY id ASC LIMIT 1"
            ).fetchone()
            if row and row["id"]:
                return int(row["id"])
    except Exception:
        return None
    return None


def _hay_accion_abierta_sync_facturas_faltantes() -> bool:
    try:
        tickets_init_db()
        with sqlite3.connect(TICKETS_DB_PATH) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(
                """
                SELECT id
                FROM tickets
                WHERE tipo='accion'
                  AND titulo=?
                  AND estado IN ('pendiente','en_proceso','esperando_aprobacion')
                ORDER BY id DESC
                LIMIT 1
                """,
                (TITULO_SYNC_FACTURAS_FALTANTES_SIIGO,),
            ).fetchone()
            return bool(row)
    except Exception:
        return False
    return False


def _crear_accion_sync_facturas_faltantes_siigo(
    categorias: dict[str, list[str]],
    *,
    fallo_detalle: dict[str, str] | None = None,
) -> dict | None:
    """
    Crea una acción en el Centro de mando para packs sin documento fiscal en MeLi.
    categorias: dict con claves SYNC_FACTURA_CAT_*.
    """
    packs_ticket = _packs_accionables_sync(categorias)
    if not packs_ticket:
        return None
    if _hay_accion_abierta_sync_facturas_faltantes():
        return None

    creador_id = _get_admin_creator_id()
    if not creador_id:
        return None

    asignado_a = None
    try:
        asignado_a = (
            (get_aliados_asignaciones().get(TAREA_SYNC_FACTURAS_FALTANTES_SIIGO) or {}).get("usuario_id")
            or None
        )
    except Exception:
        asignado_a = None

    fallo_detalle = fallo_detalle or {}
    marker_packs = (
        f"SYS_SYNC_FALTANTES_PACKS_JSON: "
        f"{json.dumps(packs_ticket, ensure_ascii=False)}"
    )
    marker_cats = (
        f"SYS_SYNC_FALTANTES_CATEGORIAS_JSON: "
        f"{json.dumps(categorias, ensure_ascii=False)}"
    )

    bloques_desc = [
        "Se detectaron packs de MeLi sin documento fiscal subido, tras cruce con Alegra.\n",
        "Resolver según categoría (ver abajo). Al cerrar la acción se reintenta el sync automático.\n",
    ]
    notas_por_cat = {
        SYNC_FACTURA_CAT_SIN_CRUCE: (
            "Buscar el Pack ID en Alegra (observations/purchase_order) o emitir factura "
            "y volver a sincronizar."
        ),
        SYNC_FACTURA_CAT_TIMBRADO: (
            "Factura en Alegra aún en timbrado; esperar estado timbrado y reintentar sync."
        ),
        SYNC_FACTURA_CAT_SIN_DOC: (
            "Hay cruce en Alegra pero falta PDF/XML descargable; completar timbrado o "
            "regenerar documento en Alegra."
        ),
        SYNC_FACTURA_CAT_FALLO_SUBIDA: (
            "Subir manualmente a MeLi o corregir el documento; revisar detalle del error."
        ),
    }
    for cat in SYNC_FACTURA_CATEGORIAS_ORDEN:
        ids = categorias.get(cat, [])
        if not ids:
            continue
        bloques_desc.append(
            f"\n{cat} ({len(ids)}):\n{_formatear_lista_pack_ids(ids, max_items=30)}"
        )

    descripcion = "\n".join(bloques_desc) + f"\n\n{marker_packs}\n{marker_cats}"

    def _paso_para_pack(p_id: str) -> dict:
        for cat in SYNC_FACTURA_CATEGORIAS_ORDEN:
            if p_id in (categorias.get(cat) or []):
                notas = notas_por_cat.get(cat, "")
                if cat == SYNC_FACTURA_CAT_FALLO_SUBIDA:
                    err = fallo_detalle.get(p_id)
                    if err:
                        notas = f"{notas}\nError: {err[:300]}"
                return {
                    "descripcion": f"[{cat}] Pack MeLi: {p_id}",
                    "notas": notas,
                }
        return {
            "descripcion": f"Pack MeLi: {p_id}",
            "notas": notas_por_cat[SYNC_FACTURA_CAT_SIN_CRUCE],
        }

    data = {
        "tipo": "accion",
        "titulo": TITULO_SYNC_FACTURAS_FALTANTES_SIIGO,
        "categoria": "contabilidad",
        "descripcion": descripcion,
        "prioridad": "alta" if _packs_criticos_sync(categorias) else "media",
        "asignado_a": asignado_a,
        "pasos": [_paso_para_pack(p_id) for p_id in packs_ticket],
    }

    ticket, err = crear_ticket(data, creador_id, None)
    if err or not ticket:
        return None

    # Notificar al grupo SEDE SUR (misma lógica que _notificar_nueva_accion_wa en routes_tickets)
    try:
        import threading
        _grupo_sede_sur = os.getenv("GRUPO_SEDE_SUR_WA", "120363023555909043@g.us")
        numero = ticket.get("numero", "")
        n = len(packs_ticket)
        # Resolver nombre del asignado para la notificación
        asignado_nombre = "Sin asignar"
        if asignado_a:
            try:
                from app.services.tickets_db import _conn as _tdb_conn
                with _tdb_conn() as _db:
                    _row = _db.execute("SELECT nombre FROM usuarios WHERE id=?", (asignado_a,)).fetchone()
                    if _row:
                        asignado_nombre = _row["nombre"]
            except Exception:
                pass
        texto_notif = (
            f"⚡ *Acción nueva* — Sistema\n"
            f"{numero} — {TITULO_SYNC_FACTURAS_FALTANTES_SIIGO}\n"
            f"👤 Asignado a: {asignado_nombre}  ·  Prioridad: alta\n"
            f"📋 {n} paso{'s' if n != 1 else ''} para resolver (1 por orden)\n"
            f"🏢 Abre Centro de Mando → Acciones para resolverlo paso a paso."
        )
        threading.Thread(
            target=enviar_whatsapp_reporte,
            kwargs={"texto_mensaje": texto_notif, "numero_destino": _grupo_sede_sur},
            daemon=True,
        ).start()
    except Exception:
        pass

    return ticket

# ========================================================
#  CONFIGURACIÓN TEMPORAL
# ========================================================
# TODO: Mover estas constantes a un archivo de configuración central (p.ej. .env)
GOOGLE_CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json",
)
SPREADSHEET_ID = os.getenv(
    "SPREADSHEET_ID", "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
)

# ========================================================
#  LÓGICAS DE SINCRONIZACIÓN ENTRE PLATAFORMAS
# ========================================================


def sincronizar_stock_todas_las_plataformas(sku: str, nuevo_stock: int):
    """
    Punto central de sincronización de stock. Propaga el valor a la página web (API REST
    configurada en WEB_API_URL / WEB_API_KEY) y a MercadoLibre.
    Llamar cuando haya un movimiento de inventario que deba igualarse en ambas plataformas.
    """
    print(
        f"\n🔄 [STOCK SYNC] Propagando stock SKU '{sku}' → {nuevo_stock} uds a web y MeLi..."
    )
    resultados = []
    nuevo_stock = int(nuevo_stock)

    try:
        from app.tools.sincronizar_productos_pagina_web import (
            sincronizar_productos_pagina_web,
        )

        resultado_web = sincronizar_productos_pagina_web(
            [{"sku": sku, "stock": nuevo_stock}]
        )
        resultados.append(f"Web: {resultado_web}")
        print(f"   └──> Web: {resultado_web[:160]}...")
    except Exception as e:
        msg = f"⚠️ Error propagando stock a la página web (SKU: {sku}): {e}"
        resultados.append(msg)
        print(msg)

    try:
        from app.services.meli import actualizar_stock_meli

        resultado_meli = actualizar_stock_meli(sku, nuevo_stock)
        resultados.append(f"MeLi: {resultado_meli}")
        print(f"   └──> MeLi: {resultado_meli}")
    except Exception as e:
        msg = f"⚠️ Error propagando stock a MeLi (SKU: {sku}): {e}"
        resultados.append(msg)
        print(msg)

    return "\n".join(resultados)


def _stock_meli_actual(meli_id: str, token: str) -> int:
    """Lee el stock vigente: en multi-bodega usa seller_warehouse; si no, available_quantity."""
    headers = {"Authorization": f"Bearer {token}"}
    res = requests.get(
        f"https://api.mercadolibre.com/items/{meli_id}", headers=headers, timeout=10
    )
    res.raise_for_status()
    item = res.json()
    user_product_id = item.get("user_product_id")
    if user_product_id:
        try:
            rs = requests.get(
                f"https://api.mercadolibre.com/user-products/{user_product_id}/stock",
                headers=headers,
                timeout=10,
            )
            if rs.status_code == 200:
                bodega = next(
                    (
                        l
                        for l in (rs.json().get("locations") or [])
                        if l.get("type") == "seller_warehouse"
                    ),
                    None,
                )
                if bodega is not None:
                    return int(bodega.get("quantity") or 0)
        except Exception:
            pass
    if item.get("variations"):
        return sum(int(v.get("available_quantity") or 0) for v in item["variations"])
    return int(item.get("available_quantity", 0) or 0)


def ajustar_stock_multicanal(sku: str, meli_id: str, delta: int) -> dict:
    """
    Punto de entrada único para sumar/restar unidades desde el panel Stock: lee el
    stock vigente en MeLi, aplica `delta` (positivo = entrada, negativo = salida,
    nunca queda negativo) y propaga el nuevo valor a MeLi + web con
    `sincronizar_stock_multicanal`. El panel es la fuente de verdad desde acá — ya
    no se espera edición manual en la app de MeLi.
    """
    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")

    stock_actual = _stock_meli_actual(meli_id, token) if meli_id else 0
    stock_nuevo = max(0, stock_actual + int(delta))

    resultado = sincronizar_stock_multicanal(sku, stock_nuevo, meli_id=meli_id)
    resultado["stock_anterior"] = stock_actual
    resultado["delta"] = int(delta)
    return resultado


def sincronizar_stock_multicanal(
    sku: str, nuevo_stock: int, meli_id: str = "", verificar_siigo: bool = True
) -> dict:
    """
    Igual que `sincronizar_stock_todas_las_plataformas` pero devuelve el resultado
    desglosado por canal (para mostrar en el panel si cada uno quedó al día).
    - MeLi: si se conoce `meli_id` (item MCOxxxxxxxx) se escribe directo por item_id —
      más confiable que buscar por SKU, porque el atributo SELLER_SKU de la publicación
      suele diferir en mayúsculas/formato del SKU registrado en Sheets (ej. "ALGNA100GR"
      en Sheets vs "ALGNA100g" en MeLi), lo que hace fallar esa búsqueda silenciosamente.
      Sin `meli_id` se cae al buscar por SKU (comportamiento anterior).
    - Web: push real si WEB_API_URL/WEB_API_KEY están configurados; si no, solo se
      regenera el catálogo desde Alegra (la web no tiene control de stock numérico propio).
    - Alegra: solo lectura de referencia — Alegra es solo para facturación (ver CLAUDE.md),
      nunca se le escribe el stock.
    """
    nuevo_stock = int(nuevo_stock)
    resultado: dict = {"sku": sku, "stock_objetivo": nuevo_stock}

    try:
        if meli_id:
            from app.services.meli import actualizar_stock_meli_por_item_id

            msg_meli = actualizar_stock_meli_por_item_id(meli_id, nuevo_stock)
        else:
            from app.services.meli import actualizar_stock_meli

            msg_meli = actualizar_stock_meli(sku, nuevo_stock)
        resultado["meli"] = {
            "ok": "✅" in msg_meli,
            "mensaje": msg_meli,
            "no_aplica": "Mercado Envíos Full" in msg_meli,
        }
    except Exception as e:
        resultado["meli"] = {"ok": False, "mensaje": f"❌ Error: {e}"}

    web_configurado = bool((os.getenv("WEB_API_URL") or "").strip()) and bool(
        (os.getenv("WEB_API_KEY") or "").strip()
    )
    try:
        from app.tools.sincronizar_productos_pagina_web import (
            sincronizar_productos_pagina_web,
        )

        msg_web = sincronizar_productos_pagina_web([{"sku": sku, "stock": nuevo_stock}])
        if web_configurado:
            resultado["web"] = {"ok": "✅" in msg_web, "mensaje": msg_web, "numerico": True}
        else:
            resultado["web"] = {
                "ok": "✅" in msg_web,
                "mensaje": (
                    "Sin API de stock configurada (WEB_API_URL/WEB_API_KEY) — se regeneró "
                    f"el catálogo desde Alegra, sin número de stock propio. {msg_web}"
                ),
                "numerico": False,
            }
    except Exception as e:
        resultado["web"] = {"ok": False, "mensaje": f"❌ Error: {e}", "numerico": web_configurado}

    if not verificar_siigo:
        resultado["siigo"] = {"stock": None, "mensaje": "No verificado (sincronización masiva)."}
        return resultado

    try:
        from app.services.alegra import buscar_producto_alegra_por_referencia as buscar_producto_siigo_por_sku

        datos_siigo = buscar_producto_siigo_por_sku(sku)
        if datos_siigo:
            resultado["siigo"] = {
                "stock": datos_siigo.get("stock_siigo"),
                "mensaje": "Solo lectura — Alegra se usa para facturación, no recibe stock automáticamente.",
            }
        else:
            resultado["siigo"] = {"stock": None, "mensaje": "SKU no encontrado en Alegra."}
    except Exception as e:
        resultado["siigo"] = {"stock": None, "mensaje": f"❌ Error consultando Alegra: {e}"}

    return resultado


def sincronizar_facturas_recientes(dias: int = 1):
    """Busca facturas en Alegra de los últimos 'dias' y las sube a Mercado Libre."""
    print(
        f"\n🚀 [SYNC RECIENTE] Iniciando revisión de facturas de Alegra para los últimos {dias} día(s)..."
    )
    fecha_inicio = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        if not facturas_siigo:
            return f"✅ No se encontraron facturas en Alegra desde {fecha_inicio}."
        print(f"📊 Se encontraron {len(facturas_siigo)} facturas. Analizando...")
        exitos = 0
        for f in facturas_siigo:
            texto = f"{f.get('observations', '')} {f.get('purchase_order', '')}"
            match = re.search(r"\d{12,20}", texto)
            if match:
                p_id = match.group()
                if siigo_omitir_pdf_mientras_timbrado(f):
                    print(
                        f"   └──> ⏭️ PDF omitido (timbrado: {siigo_factura_estado_log(f)}): "
                        f"{siigo_factura_etiqueta_log(f)}"
                    )
                    continue
                doc, fmt = obtener_documento_fiscal_siigo_para_meli(f.get("id"))
                if (
                    doc
                    and "✅" in subir_factura_meli(p_id, doc, formato=fmt)
                ):
                    exitos += 1
                    suf = " (XML DIAN)" if fmt == "xml" else ""
                    print(f"   └──> ✅ Sincronizado Pack ID: {p_id}{suf}")
                elif not doc:
                    print(
                        f"   └──> ⚠️ Sin documento Alegra (PDF/XML) Pack {p_id} "
                        f"({siigo_factura_etiqueta_log(f)} est={siigo_factura_estado_log(f)})"
                    )
        return f"✅ Revisión terminada. Se subieron {exitos} facturas."
    except Exception as e:
        return f"❌ Error crítico en sync reciente: {e}"


def sincronizar_por_dia_especifico(fecha_consulta: str):
    """Busca y sincroniza facturas para un día específico."""
    print(f"\n📅 [SYNC POR DÍA] Buscando facturas para la fecha: {fecha_consulta}...")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_consulta)
        facturas_del_dia = [
            f for f in facturas_siigo if f.get("date", "").startswith(fecha_consulta)
        ]
        if not facturas_del_dia:
            return (
                f"✅ No se encontraron facturas creadas en la fecha {fecha_consulta}."
            )
        print(f"📊 Se encontraron {len(facturas_del_dia)} facturas. Analizando...")
        exitos = 0
        for f in facturas_del_dia:
            texto = f"{f.get('observations', '')} {f.get('purchase_order', '')}"
            match = re.search(r"\d{12,20}", texto)
            if match:
                p_id = match.group()
                if siigo_omitir_pdf_mientras_timbrado(f):
                    print(
                        f"   └──> ⏭️ PDF omitido (timbrado: {siigo_factura_estado_log(f)}): "
                        f"{siigo_factura_etiqueta_log(f)}"
                    )
                    continue
                doc, fmt = obtener_documento_fiscal_siigo_para_meli(f.get("id"))
                if (
                    doc
                    and "✅" in subir_factura_meli(p_id, doc, formato=fmt)
                ):
                    exitos += 1
                    suf = " (XML DIAN)" if fmt == "xml" else ""
                    print(f"   └──> ✅ Sincronizado Pack ID: {p_id}{suf}")
                elif not doc:
                    print(
                        f"   └──> ⚠️ Sin documento Alegra (PDF/XML) Pack {p_id} "
                        f"({siigo_factura_etiqueta_log(f)} est={siigo_factura_estado_log(f)})"
                    )
        return f"✅ Fin del proceso para {fecha_consulta}. Facturas subidas: {exitos}"
    except Exception as e:
        return f"❌ Error crítico en sync por día: {e}"


def sincronizar_manual_por_id(pack_id: str):
    """Busca una factura en Alegra por Pack ID y la sube a Mercado Libre."""
    print(f"\n🔎 [SYNC MANUAL] Buscando factura para el Pack ID: {pack_id}...")
    fecha_inicio = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        for fac in facturas_siigo:
            obs = (
                str(fac.get("observations", ""))
                + " "
                + str(fac.get("purchase_order", ""))
            )
            if str(pack_id).strip() in obs:
                print(
                    f"✨ ¡Coincidencia encontrada! Factura Alegra ID: {fac.get('id')}. Procediendo a subir..."
                )
                if siigo_omitir_pdf_mientras_timbrado(fac):
                    return (
                        f"⏭️ La factura está en timbrado ({siigo_factura_estado_log(fac)}). "
                        f"No se puede obtener PDF todavía; reintente cuando esté Accepted en Alegra."
                    )
                doc, fmt = obtener_documento_fiscal_siigo_para_meli(fac.get("id"))
                if doc:
                    return (
                        f"🚀 Resultado de la subida: "
                        f"{subir_factura_meli(pack_id, doc, formato=fmt)}"
                        + (" (XML DIAN)" if fmt == "xml" else "")
                    )
                else:
                    return f"❌ Se encontró la factura pero no se pudo descargar PDF ni XML de Alegra."
        return "❌ No se encontró una factura en los últimos 90 días con ese Pack ID."
    except Exception as e:
        return f"❌ Error crítico en sync manual: {e}"


def sincronizar_manual_por_packs(pack_ids: list[str]) -> dict[str, Any]:
    """
    Versión multi-pack del sync manual para evitar múltiples listados/paginaciones.
    Retorna un resumen para bitácora / comentarios de tickets.
    """
    pack_norm = [str(p).strip() for p in (pack_ids or []) if str(p).strip()]
    pack_norm = list(dict.fromkeys(pack_norm))  # dedup preserving order
    if not pack_norm:
        return {"ok": True, "pack_ids": [], "exitosas": [], "fallidas": [], "faltantes": []}

    fecha_inicio = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        resultado = _procesar_packs_sync_siigo(pack_norm, facturas_siigo)
        categorias = resultado["categorias"]
        fallidas = _packs_accionables_sync(categorias)
        faltantes = categorias.get(SYNC_FACTURA_CAT_SIN_CRUCE, [])

        return {
            "ok": True,
            "pack_ids": pack_norm,
            "exitosas": resultado["exitosas"],
            "fallidas": fallidas,
            "faltantes": faltantes,
            "categorias": categorias,
            "fallo_detalle": resultado.get("fallo_detalle") or {},
            "facturas_siigo_leidas": len(facturas_siigo),
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "pack_ids": pack_norm}


def sincronizar_inteligente():
    """Busca órdenes en MeLi sin factura y las cruza con facturas de Alegra."""
    print(
        "\n🧠 [SYNC INTELIGENTE] Iniciando cruce de datos entre Mercado Libre y Alegra..."
    )
    try:
        token_meli = refrescar_token_meli()
        res_me = requests.get(
            "https://api.mercadolibre.com/users/me",
            headers={"Authorization": f"Bearer {token_meli}"},
        )
        seller_id = res_me.json().get("id")
        fecha_hace_15 = (datetime.now() - timedelta(days=15)).strftime(
            "%Y-%m-%dT%H:%M:%S.000-00:00"
        )
        headers_meli = {"Authorization": f"Bearer {token_meli}", "x-version": "2"}
        pendientes = []
        resueltos_fresco: list[str] = []
        packs_revisados: set[str] = set()
        offset, limit = 0, 50
        while True:
            url_meli = (
                f"https://api.mercadolibre.com/orders/search?seller={seller_id}"
                f"&order.date_created.from={fecha_hace_15}&order.status=paid"
                f"&limit={limit}&offset={offset}"
            )
            data = requests.get(url_meli, headers=headers_meli, timeout=30).json()
            results = data.get("results", []) or []
            for ord in results:
                p_id = str(ord.get("pack_id") or ord.get("id") or "").strip()
                if not p_id or p_id in packs_revisados:
                    continue
                packs_revisados.add(p_id)
                if meli_pack_tiene_documento_fiscal(p_id, token=token_meli):
                    # Ya facturado — si venía de una corrida anterior en el
                    # store de seguimiento, hay que sacarlo de ahí también,
                    # o quedaría como pendiente "fantasma" hasta que saliera
                    # de la ventana de 15 días (bug detectado 01-sep-2026).
                    resueltos_fresco.append(p_id)
                else:
                    pendientes.append(p_id)
            paging = data.get("paging") or {}
            total = int(paging.get("total") or 0)
            offset += limit
            if offset >= total or not results:
                break
        print(f"⏳ Encontradas {len(pendientes)} órdenes en MeLi (últimos 15 días) sin factura fiscal.")

        # Re-chequea packs de corridas anteriores que ya salieron de la ventana
        # de 15 días — si no, un pack genuinamente sin facturar dejaría de
        # aparecer aquí para siempre sin haberse resuelto (ver comentario en
        # SYNC_FACTURAS_SEGUIMIENTO_PATH).
        seguimiento_previo = _packs_seguimiento_vigentes()
        antiguos = [p for p in seguimiento_previo if p not in packs_revisados]
        resueltos_seguimiento: list[str] = []
        descartados_seguimiento: list[str] = []
        fecha_mas_antigua = datetime.now()
        for p_id in antiguos:
            if meli_pack_tiene_documento_fiscal(p_id, token=token_meli):
                resueltos_seguimiento.append(p_id)
                print(f"   └──> ✅ Pack {p_id} (rastreado, fuera de la ventana): ya tiene factura en MeLi.")
                continue
            if not _pack_meli_sigue_vigente(p_id, token_meli):
                descartados_seguimiento.append(p_id)
                print(f"   └──> ⏭️ Pack {p_id} (rastreado): cancelado/no pagado, se deja de rastrear.")
                continue
            pendientes.append(p_id)
            try:
                primera = datetime.fromisoformat(seguimiento_previo[p_id].get("primera_vez", ""))
                fecha_mas_antigua = min(fecha_mas_antigua, primera)
            except ValueError:
                pass
        if antiguos:
            print(
                f"🗂️ Seguimiento persistente: {len(antiguos)} pack(s) fuera de la ventana de 15 días "
                f"— {len(resueltos_seguimiento)} ya facturados, {len(descartados_seguimiento)} descartados, "
                f"{len(antiguos) - len(resueltos_seguimiento) - len(descartados_seguimiento)} siguen pendientes."
            )

        if not pendientes:
            _actualizar_seguimiento_sync_facturas(
                _categorias_sync_facturas_vacias(),
                resueltos=resueltos_fresco + resueltos_seguimiento,
                descartados=descartados_seguimiento,
            )
            return (
                "✅ ¡Excelente! Mercado Libre está al día. No hay facturas pendientes."
            )

        dias_siigo = 15
        if fecha_mas_antigua < datetime.now() - timedelta(days=15):
            dias_siigo = min(
                SYNC_FACTURAS_SEGUIMIENTO_MAX_DIAS,
                (datetime.now() - fecha_mas_antigua).days + 1,
            )
        facturas_siigo = obtener_facturas_siigo_paginadas(
            (datetime.now() - timedelta(days=dias_siigo)).strftime("%Y-%m-%d")
        )
        if not facturas_siigo:
            return f"⚠️ Alerta: MeLi tiene {len(pendientes)} pendientes pero no hay facturas en Alegra para cruzar."
        print(f"🔍 Obtenidas {len(facturas_siigo)} facturas de Alegra para comparar ({dias_siigo}d).")

        resultado = _procesar_packs_sync_siigo(pendientes, facturas_siigo)
        exitosas = resultado["exitosas"]
        categorias = resultado["categorias"]
        fallo_detalle = resultado.get("fallo_detalle") or {}
        pendientes_accion = _packs_accionables_sync(categorias)

        _actualizar_seguimiento_sync_facturas(
            categorias,
            resueltos=exitosas + resueltos_fresco + resueltos_seguimiento,
            descartados=descartados_seguimiento,
        )

        if pendientes_accion:
            reporte = _formatear_reporte_sync_facturas(
                exitosas, categorias, fallo_detalle
            )
            ticket = _crear_accion_sync_facturas_faltantes_siigo(
                categorias, fallo_detalle=fallo_detalle
            )
            if ticket and ticket.get("numero"):
                reporte += f"\n\n🏢 Centro de mando: acción #{ticket.get('numero')}"
            enviar_reporte_controlado(reporte)
            crit = len(_packs_criticos_sync(categorias))
            tim = len(categorias.get(SYNC_FACTURA_CAT_TIMBRADO, []))
            return (
                f"Sync terminada. Subidas: {len(exitosas)}. "
                f"Pendientes: {len(pendientes_accion)} "
                f"(críticos: {crit}, timbrado: {tim}). Reporte enviado."
            )

        return f"✅ ¡Sincronización Inteligente completada! Se subieron {len(exitosas)} facturas."
    except Exception as e:
        return f"❌ Error crítico en Sync Inteligente: {e}"


_VENTAS_CACHE_PATH = os.path.join(
    os.path.dirname(__file__), "data", "meli_ventas_30d_cache.json"
)
_VENTAS_CACHE_TTL_S = 30 * 60


def obtener_ventas_meli_por_item(dias: int = 30, refresh: bool = False) -> dict:
    """
    Agrega ventas pagadas de MeLi por item_id (MCO…) en los últimos `dias`.

    Retorna:
      {
        "dias": 30,
        "actualizado_en": "...",
        "fuente": "cache"|"live",
        "ordenes": N,
        "por_item": {
          "MCOxxx": {
            "unidades": int,
            "ordenes": int,
            "monto": float,
            "ritmo_diario": float,
            "nivel": "sin_ventas"|"baja"|"media"|"alta",
          }
        }
      }
    """
    dias = max(1, min(int(dias or 30), 90))
    now = datetime.now()
    if not refresh and os.path.isfile(_VENTAS_CACHE_PATH):
        try:
            with open(_VENTAS_CACHE_PATH, encoding="utf-8") as f:
                cached = json.load(f)
            ts = float(cached.get("ts") or 0)
            if (
                cached.get("version") == 1
                and cached.get("dias") == dias
                and (now.timestamp() - ts) < _VENTAS_CACHE_TTL_S
                and isinstance(cached.get("por_item"), dict)
            ):
                return {
                    "dias": dias,
                    "actualizado_en": cached.get("actualizado_en"),
                    "fuente": "cache",
                    "ordenes": int(cached.get("ordenes") or 0),
                    "por_item": cached["por_item"],
                    "cache_ttl_s": _VENTAS_CACHE_TTL_S,
                }
        except Exception:
            pass

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")

    headers = {"Authorization": f"Bearer {token}"}
    me = requests.get(
        "https://api.mercadolibre.com/users/me", headers=headers, timeout=20
    ).json()
    seller_id = me.get("id")
    if not seller_id:
        raise RuntimeError("No se pudo obtener seller_id de MeLi.")

    # Colombia UTC-5
    fecha_desde = (now - timedelta(days=dias)).strftime("%Y-%m-%dT00:00:00.000-05:00")
    por_item: dict[str, dict[str, Any]] = {}
    ordenes_contadas = 0
    offset, limit = 0, 50

    while True:
        url = (
            f"https://api.mercadolibre.com/orders/search?seller={seller_id}"
            f"&order.date_created.from={fecha_desde}"
            f"&sort=date_desc&limit={limit}&offset={offset}"
        )
        r = requests.get(url, headers=headers, timeout=40)
        if r.status_code >= 400:
            raise RuntimeError(
                f"MeLi orders/search HTTP {r.status_code}: {(r.text or '')[:240]}"
            )
        data = r.json() or {}
        results = data.get("results") or []
        for ord_ in results:
            status = (ord_.get("status") or "").lower()
            # Solo ventas cobradas / confirmadas (no canceladas)
            if status not in ("paid", "partially_paid", "confirmed"):
                continue
            ordenes_contadas += 1
            for oi in ord_.get("order_items") or []:
                item = oi.get("item") or {}
                mid = str(item.get("id") or "").strip().upper()
                if not mid.startswith("MCO"):
                    continue
                qty = int(oi.get("quantity") or 0)
                if qty <= 0:
                    continue
                unit = float(
                    oi.get("full_unit_price")
                    or oi.get("unit_price")
                    or 0
                )
                slot = por_item.setdefault(
                    mid,
                    {"unidades": 0, "ordenes": 0, "monto": 0.0, "_oids": set()},
                )
                slot["unidades"] += qty
                slot["monto"] = round(slot["monto"] + unit * qty, 2)
                oid = str(ord_.get("id") or "")
                if oid and oid not in slot["_oids"]:
                    slot["_oids"].add(oid)
                    slot["ordenes"] += 1

        paging = data.get("paging") or {}
        total = int(paging.get("total") or 0)
        offset += limit
        if offset >= total or not results:
            break
        if offset > 2000:  # safety
            break

    out_items: dict[str, dict] = {}
    for mid, slot in por_item.items():
        uds = int(slot["unidades"])
        ritmo = round(uds / float(dias), 2)
        if uds <= 0:
            nivel = "sin_ventas"
        elif uds <= 2:
            nivel = "baja"
        elif uds <= 10:
            nivel = "media"
        else:
            nivel = "alta"
        out_items[mid] = {
            "unidades": uds,
            "ordenes": int(slot["ordenes"]),
            "monto": float(slot["monto"]),
            "ritmo_diario": ritmo,
            "nivel": nivel,
        }

    actualizado_en = now.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        os.makedirs(os.path.dirname(_VENTAS_CACHE_PATH), exist_ok=True)
        with open(_VENTAS_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": 1,
                    "ts": now.timestamp(),
                    "dias": dias,
                    "actualizado_en": actualizado_en,
                    "ordenes": ordenes_contadas,
                    "por_item": out_items,
                },
                f,
                ensure_ascii=False,
            )
    except Exception as e:
        print(f"⚠️ [ventas-30d] No se pudo guardar caché: {e}")

    return {
        "dias": dias,
        "actualizado_en": actualizado_en,
        "fuente": "live",
        "ordenes": ordenes_contadas,
        "por_item": out_items,
        "cache_ttl_s": _VENTAS_CACHE_TTL_S,
    }


def obtener_estado_stock_meli(
    *,
    timeout_lote: float = 20.0,
    max_seconds: float | None = None,
) -> list[dict]:
    """
    Lee Google Sheets (col A=meli_id, B=sku, D=nombre) y consulta el stock EN VIVO
    en Mercado Libre para cada producto. Solo lectura — no escribe en Sheets ni notifica.
    Retorna lista de {meli_id, sku, nombre, stock, fila}. `fila` sirve para escribir de
    vuelta en la Hoja 1 (columna F) si algún llamador lo necesita.

    Omite publicaciones ``closed`` / ``inactive`` (ya no operables en MeLi).
    Conserva ``paused`` / ``under_review`` (pueden reactivarse).

    `timeout_lote` evita que un GET a MeLi cuelgue el hilo de Flask. `max_seconds`
    recorta el barrido (p. ej. el panel de Control de Inventario) y devuelve lo
    reunido hasta ese tope en vez de fallar entero.
    """
    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")

    # Estados que MeLi no deja volver a operar (SKU/stock bloqueados de forma práctica).
    _NO_OPERABLES = frozenset({"closed", "inactive"})

    gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
    sh = gc.open_by_key(SPREADSHEET_ID)
    sheet = sh.worksheet("Hoja 1")
    data = sheet.get_all_values()

    ml_ids, fila_map, nombre_map, sku_map = [], {}, {}, {}
    for i, row in enumerate(data[1:], start=2):
        if not row:
            continue
        id_meli = str(row[0]).strip().upper()
        if id_meli.startswith("MCO"):
            ml_ids.append(id_meli)
            fila_map[id_meli] = i
            nombre_map[id_meli] = (
                str(row[3]).strip() if len(row) > 3 else "Producto sin nombre"
            )
            sku_map[id_meli] = str(row[1]).strip() if len(row) > 1 else ""

    if not ml_ids:
        return []

    headers = {"Authorization": f"Bearer {token}"}
    items = []
    omitidas_cerradas = 0
    t0 = time.time()
    for i in range(0, len(ml_ids), 20):
        if max_seconds is not None and (time.time() - t0) >= max_seconds:
            print(
                f"⚠️ [STOCK] corte por tiempo ({max_seconds:.0f}s) "
                f"tras {len(items)} ítems; el resto se omite."
            )
            break
        lote = ml_ids[i : i + 20]
        try:
            resp = requests.get(
                f"https://api.mercadolibre.com/items?ids={','.join(lote)}",
                headers=headers,
                timeout=timeout_lote,
            )
            resp.raise_for_status()
            res = resp.json()
        except Exception as e:
            print(f"⚠️ [STOCK] lote MeLi {lote[0]}… falló: {e}")
            continue
        if not isinstance(res, list):
            continue
        for r in res:
            if r.get("code") != 200:
                continue
            item = r["body"]
            ml_id = item.get("id")
            estado = (item.get("status") or "").strip().lower()
            if estado in _NO_OPERABLES:
                omitidas_cerradas += 1
                continue
            stock = (
                sum(
                    v.get("available_quantity", 0)
                    for v in item.get("variations", [])
                )
                if item.get("variations")
                else item.get("available_quantity", 0)
            )
            es_full = (item.get("shipping") or {}).get("logistic_type") == "fulfillment"
            # SKU vivo en MeLi: SELLER_SKU primero (oficial), luego custom_field / variaciones
            sku_meli_vivo = ""
            for a in item.get("attributes") or []:
                if a.get("id") == "SELLER_SKU":
                    sku_meli_vivo = (a.get("value_name") or "").strip()
                    break
            if not sku_meli_vivo:
                sku_meli_vivo = (item.get("seller_custom_field") or "").strip()
            if not sku_meli_vivo:
                for v in item.get("variations") or []:
                    for a in v.get("attributes") or []:
                        if a.get("id") == "SELLER_SKU":
                            sku_meli_vivo = (a.get("value_name") or "").strip()
                            break
                    if sku_meli_vivo:
                        break
            titulo_meli = (item.get("title") or "").strip()
            nombre_sheets = (nombre_map.get(ml_id) or "").strip()
            # Título MeLi = nombre de la publicación (lo que el operador espera ver).
            # La col D de Sheets a menudo trae el código/SKU, no el nombre comercial.
            items.append({
                "meli_id": ml_id,
                # Preferir SKU vivo de MeLi; Sheets solo si MeLi no trae código
                "sku": (sku_meli_vivo or sku_map.get(ml_id, "")),
                "nombre": titulo_meli or nombre_sheets or "Producto sin nombre",
                "stock": stock,
                "fila": fila_map.get(ml_id),
                "estado_meli": item.get("status", ""),
                "es_full": es_full,
                "sync_bloqueado": item.get("status") != "active",
                "permalink": item.get("permalink", ""),
                "precio": item.get("price"),
                "moneda": item.get("currency_id") or "COP",
            })
    if omitidas_cerradas:
        print(
            f"ℹ️ [STOCK] Omitidas {omitidas_cerradas} publicaciones closed/inactive "
            f"(ya no operables en MeLi)."
        )

    # Incluir activas/pausadas de MeLi que no están en Sheets — p.ej. publicaciones
    # nuevas o desactualizadas en la hoja (la hoja no es el universo real de MeLi).
    if max_seconds is not None and (time.time() - t0) >= max_seconds:
        return items
    try:
        me = requests.get(
            "https://api.mercadolibre.com/users/me", headers=headers, timeout=15
        ).json()
        seller_id = me.get("id")
        ids_extra: list[str] = []
        seen_ids = {str(it.get("meli_id") or "").upper() for it in items}
        if seller_id:
            for estado_busqueda in ("active", "paused"):
                offset = 0
                while True:
                    r = requests.get(
                        f"https://api.mercadolibre.com/users/{seller_id}/items/search",
                        params={"status": estado_busqueda, "limit": 100, "offset": offset},
                        headers=headers,
                        timeout=30,
                    ).json()
                    batch_ids = r.get("results") or []
                    if not batch_ids:
                        break
                    for iid in batch_ids:
                        su = str(iid).strip().upper()
                        if su and su not in seen_ids:
                            seen_ids.add(su)
                            ids_extra.append(str(iid).strip())
                    offset += len(batch_ids)
                    if offset >= (r.get("paging") or {}).get("total", 0):
                        break

        for i in range(0, len(ids_extra), 20):
            if max_seconds is not None and (time.time() - t0) >= max_seconds:
                break
            lote = ids_extra[i : i + 20]
            try:
                resp = requests.get(
                    f"https://api.mercadolibre.com/items?ids={','.join(lote)}",
                    headers=headers,
                    timeout=min(timeout_lote, 40.0),
                )
                resp.raise_for_status()
                res = resp.json()
            except Exception as e:
                print(f"⚠️ [STOCK] lote pausadas {lote[0]}… falló: {e}")
                continue
            if not isinstance(res, list):
                continue
            for r in res:
                if r.get("code") != 200:
                    continue
                item = r["body"]
                ml_id = item.get("id")
                estado = (item.get("status") or "").strip().lower()
                if estado in _NO_OPERABLES:
                    continue
                stock = (
                    sum(v.get("available_quantity", 0) for v in item.get("variations", []))
                    if item.get("variations")
                    else item.get("available_quantity", 0)
                )
                sku_meli_vivo = ""
                for a in item.get("attributes") or []:
                    if a.get("id") == "SELLER_SKU":
                        sku_meli_vivo = (a.get("value_name") or "").strip()
                        break
                if not sku_meli_vivo:
                    sku_meli_vivo = (item.get("seller_custom_field") or "").strip()
                es_full = (item.get("shipping") or {}).get("logistic_type") == "fulfillment"
                items.append(
                    {
                        "meli_id": ml_id,
                        "sku": sku_meli_vivo,
                        "nombre": item.get("title") or "Sin nombre",
                        "stock": stock,
                        "fila": None,
                        "estado_meli": item.get("status", ""),
                        "es_full": es_full,
                        "sync_bloqueado": item.get("status") != "active",
                        "permalink": item.get("permalink", ""),
                        "precio": item.get("price"),
                        "moneda": item.get("currency_id") or "COP",
                        "solo_meli": True,
                    }
                )
        if ids_extra:
            print(
                f"ℹ️ [STOCK] +{len(ids_extra)} publicaciones activas/pausadas MeLi "
                f"no listadas en Sheets añadidas al resumen."
            )
    except Exception as e:
        print(f"⚠️ [STOCK] No se pudieron añadir ítems MeLi fuera de Sheets: {e}")

    return items


_VENTAS_YTD_CACHE_PATH = os.path.join(
    os.path.dirname(__file__), "data", "meli_ventas_ytd_cache.json"
)
_VENTAS_YTD_CACHE_TTL_S = 6 * 60 * 60  # recorrer el año completo puede tardar 1-2 min


def _meli_orders_paid_qty_rango(
    headers: dict, seller_id, desde: datetime, hasta: datetime
) -> dict[str, int]:
    """Unidades vendidas por publicación MeLi (MCO…) en órdenes 'paid' dentro de
    [desde, hasta]. /orders/search rechaza offset+limit > 10000 en un mismo rango;
    si se topa con eso, parte el rango de fechas a la mitad y recorre cada mitad
    por separado, sumando resultados."""
    url = "https://api.mercadolibre.com/orders/search"
    params = {
        "seller": seller_id,
        "order.date_created.from": desde.strftime("%Y-%m-%dT00:00:00.000-05:00"),
        "order.date_created.to": hasta.strftime("%Y-%m-%dT23:59:59.000-05:00"),
        "order.status": "paid",
        "sort": "date_asc",
        "limit": 50,
        "offset": 0,
    }
    por_item: dict[str, int] = {}
    offset = 0
    while True:
        params["offset"] = offset
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.status_code != 200:
            break
        data = r.json() or {}
        results = data.get("results") or []
        for ord_ in results:
            for oi in ord_.get("order_items") or []:
                item = oi.get("item") or {}
                mid = str(item.get("id") or "").strip().upper()
                qty = int(oi.get("quantity") or 0)
                if mid.startswith("MCO") and qty > 0:
                    por_item[mid] = por_item.get(mid, 0) + qty
        total = int((data.get("paging") or {}).get("total") or 0)
        offset += len(results)
        if offset >= total or not results:
            break
        if offset >= 9950:
            if hasta - desde <= timedelta(days=1):
                break
            mitad = desde + (hasta - desde) / 2
            izquierda = _meli_orders_paid_qty_rango(headers, seller_id, desde, mitad)
            derecha = _meli_orders_paid_qty_rango(
                headers, seller_id, mitad + timedelta(seconds=1), hasta
            )
            for mid, qty in izquierda.items():
                por_item[mid] = por_item.get(mid, 0) + qty
            for mid, qty in derecha.items():
                por_item[mid] = por_item.get(mid, 0) + qty
            return por_item
    return por_item


# Cortes de rotación sobre unidades vendidas en lo que va del año (~8 meses a ago-2026).
# Calibrados sobre los cuartiles reales de los productos agotados/críticos (ago-2026):
# p25≈5, mediana=19, p75≈64 unidades vendidas en el año.
ROTACION_BAJA_MAX = 5  # ≤5 unidades vendidas en el año → baja rotación (puede esperar)
ROTACION_MEDIA_MAX = 49  # 6 a 49 unidades → media rotación; 50+ → alta


def clasificar_rotacion(unidades_ytd: int) -> str:
    if unidades_ytd <= 0:
        return "sin_ventas"
    if unidades_ytd <= ROTACION_BAJA_MAX:
        return "baja"
    if unidades_ytd <= ROTACION_MEDIA_MAX:
        return "media"
    return "alta"


def obtener_ventas_meli_ytd_por_item(refresh: bool = False) -> dict:
    """Unidades vendidas por publicación MeLi (MCOxxxxxxxx) desde el 1 de enero
    del año en curso. Se cachea (TTL algunas horas) porque recorrer el año
    completo implica varias pasadas por el tope de 10.000 resultados de
    /orders/search."""
    now = datetime.now()
    anio = now.year
    if not refresh and os.path.isfile(_VENTAS_YTD_CACHE_PATH):
        try:
            with open(_VENTAS_YTD_CACHE_PATH, encoding="utf-8") as f:
                cached = json.load(f)
            ts = float(cached.get("ts") or 0)
            if (
                cached.get("version") == 2
                and cached.get("anio") == anio
                and (now.timestamp() - ts) < _VENTAS_YTD_CACHE_TTL_S
                and isinstance(cached.get("por_item"), dict)
            ):
                return {
                    "anio": anio,
                    "fuente": "cache",
                    "actualizado_en": cached.get("actualizado_en"),
                    "por_item": {k: int(v) for k, v in cached["por_item"].items()},
                }
        except Exception:
            pass

    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")
    headers = {"Authorization": f"Bearer {token}"}
    me = requests.get(
        "https://api.mercadolibre.com/users/me", headers=headers, timeout=20
    ).json()
    seller_id = me.get("id")
    if not seller_id:
        raise RuntimeError("No se pudo obtener seller_id de MeLi.")

    por_item = _meli_orders_paid_qty_rango(
        headers, seller_id, datetime(anio, 1, 1), now
    )

    actualizado_en = now.strftime("%Y-%m-%dT%H:%M:%S")
    try:
        os.makedirs(os.path.dirname(_VENTAS_YTD_CACHE_PATH), exist_ok=True)
        with open(_VENTAS_YTD_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": 2,
                    "ts": now.timestamp(),
                    "anio": anio,
                    "actualizado_en": actualizado_en,
                    "por_item": por_item,
                },
                f,
                ensure_ascii=False,
            )
    except Exception as e:
        print(f"⚠️ [ventas-ytd] No se pudo guardar caché: {e}")

    return {
        "anio": anio,
        "fuente": "live",
        "actualizado_en": actualizado_en,
        "por_item": por_item,
    }


_HISTORIAL_REPOSICION_PATH = os.path.join(
    os.path.dirname(__file__), "data", "historial_reposicion_stock.json"
)


def _parse_iso_seguro(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def actualizar_historial_reposicion(eventos: list[tuple[str, str, int]]) -> None:
    """Registra, por publicación de ALTA rotación, cuándo queda en stock=0 y
    cuándo vuelve a tener stock>0. Es el insumo del informe mensual de
    reposición a Sede Sur (scripts/informe_reposicion_mensual_cron.py).

    `eventos` es [(meli_id, nombre, stock_actual), ...] de esta misma corrida,
    ya filtrados a rotación "alta". Se llama en cada corrida del reporte de
    stock (diario o manual): compara contra el último stock conocido por SKU
    para detectar la transición exacta. No hay historial antes de esta fecha
    (ago-2026) — no existía ningún trackeo de reposición previo."""
    if not eventos:
        return
    try:
        with open(_HISTORIAL_REPOSICION_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}

    ultimo_stock: dict[str, int] = data.get("ultimo_stock") or {}
    abiertos: dict[str, dict] = data.get("eventos_abiertos") or {}
    cerrados: list[dict] = data.get("eventos_cerrados") or []

    ahora = datetime.now()
    ahora_iso = ahora.isoformat(timespec="seconds")
    for mid, nombre, stock in eventos:
        previo = ultimo_stock.get(mid)
        if previo is None:
            pass  # primera vez que se ve este SKU: bootstrap, sin evento
        elif previo > 0 and stock == 0:
            abiertos[mid] = {"nombre": nombre, "agotado_en": ahora_iso}
        elif previo == 0 and stock > 0 and mid in abiertos:
            abierto = abiertos.pop(mid)
            agotado_dt = _parse_iso_seguro(abierto.get("agotado_en"))
            if agotado_dt is not None:
                cerrados.append({
                    "meli_id": mid,
                    "nombre": nombre,
                    "agotado_en": abierto["agotado_en"],
                    "repuesto_en": ahora_iso,
                    "dias": round((ahora - agotado_dt).total_seconds() / 86400, 2),
                })
        ultimo_stock[mid] = stock

    limite = ahora - timedelta(days=400)  # el informe solo necesita ~1 año
    cerrados = [
        c for c in cerrados
        if (dt := _parse_iso_seguro(c.get("repuesto_en"))) is None or dt >= limite
    ]

    try:
        os.makedirs(os.path.dirname(_HISTORIAL_REPOSICION_PATH), exist_ok=True)
        tmp = _HISTORIAL_REPOSICION_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "version": 1,
                    "actualizado_en": ahora_iso,
                    "ultimo_stock": ultimo_stock,
                    "eventos_abiertos": abiertos,
                    "eventos_cerrados": cerrados,
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
        os.replace(tmp, _HISTORIAL_REPOSICION_PATH)
    except Exception as e:
        print(f"⚠️ [reposicion] No se pudo guardar historial: {e}")


def ejecutar_sincronizacion_y_reporte_stock():
    """Cruza el stock de Google Sheets con Mercado Libre y envía un reporte de niveles bajos."""
    print("\n💹 [STOCK SYNC] Iniciando escaneo de productos para reporte de stock...")
    try:
        items = obtener_estado_stock_meli()
        if not items:
            return "⚠️ No se encontraron códigos MCO en la Columna A de Google Sheets."
        print(
            f"✅ {len(items)} productos leídos de Sheets. Consultando stock en Mercado Libre..."
        )

        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sh = gc.open_by_key(SPREADSHEET_ID)
        sheet = sh.worksheet("Hoja 1")

        try:
            ventas_ytd = obtener_ventas_meli_ytd_por_item()
            unidades_ytd_por_item = ventas_ytd["por_item"]
            anio_actual = ventas_ytd["anio"]
        except Exception as e:
            print(f"⚠️ [STOCK SYNC] No se pudo verificar ventas del año, no se filtra: {e}")
            unidades_ytd_por_item = None
            anio_actual = datetime.now().year

        try:
            from app.services.inventario_control import obtener_config_inventario

            umbral_bajo_stock = obtener_config_inventario()["umbral_bajo_stock"]
        except Exception:
            umbral_bajo_stock = 5

        updates = []
        agotados_por_rotacion = {"alta": [], "media": [], "baja": []}
        criticos_por_rotacion = {"alta": [], "media": [], "baja": []}
        sin_ventas_excluidos = 0
        bajo_stock_count = 0
        eventos_alta_rotacion: list[tuple[str, str, int]] = []
        for it in items:
            stock = it["stock"]
            nombre = it["nombre"]
            mid = str(it.get("meli_id") or "").strip().upper()
            if it["fila"]:
                updates.append({"range": f"F{it['fila']}", "values": [[stock]]})
            rotacion = (
                clasificar_rotacion(unidades_ytd_por_item.get(mid, 0))
                if unidades_ytd_por_item is not None
                else None
            )
            if rotacion == "alta" and mid:
                # Alimenta el historial de reposición (informe mensual a Sede Sur)
                # independientemente del stock actual — necesita ver cada corrida
                # para detectar cuándo cruza a 0 y cuándo vuelve a subir.
                eventos_alta_rotacion.append((mid, nombre, stock))
            if 1 < stock < umbral_bajo_stock:
                bajo_stock_count += 1
            if stock not in (0, 1):
                continue
            if rotacion is None:
                rotacion = "media"  # sin datos de ventas: no se puede clasificar ni excluir
            elif rotacion == "sin_ventas":
                sin_ventas_excluidos += 1
                continue
            destino = agotados_por_rotacion if stock == 0 else criticos_por_rotacion
            emoji = "🚫" if stock == 0 else "⚠️"
            destino[rotacion].append(f"{emoji} {nombre}")

        try:
            actualizar_historial_reposicion(eventos_alta_rotacion)
        except Exception as e:
            print(f"⚠️ [STOCK SYNC] No se pudo actualizar historial de reposición: {e}")

        agotados = (
            agotados_por_rotacion["alta"]
            + agotados_por_rotacion["media"]
            + agotados_por_rotacion["baja"]
        )
        criticos = (
            criticos_por_rotacion["alta"]
            + criticos_por_rotacion["media"]
            + criticos_por_rotacion["baja"]
        )

        if updates:
            sheet.batch_update(updates)
        print("✅ Stock actualizado en Google Sheets.")

        try:
            from app.tools.sincronizar_productos_pagina_web import (
                sincronizar_productos_pagina_web,
            )

            productos_web = [
                {"sku": it["sku"], "stock": it["stock"]} for it in items if it.get("sku")
            ]
            if productos_web:
                resultado_web = sincronizar_productos_pagina_web(productos_web)
                print(f"   └──> Web (diario): {resultado_web[:200]}")
        except Exception as e:
            print(f"⚠️ [STOCK SYNC] No se pudo propagar stock a la web en el cron diario: {e}")

        def _seccion_por_rotacion(titulo: str, por_rotacion: dict) -> str:
            total = sum(len(v) for v in por_rotacion.values())
            if not total:
                return ""
            bloque = f"\n\n*{titulo} ({total}):*"
            etiquetas = {
                "alta": "🔥 Alta rotación (repón ya)",
                "media": "🔸 Media rotación",
                "baja": "🔹 Baja rotación (puede esperar)",
            }
            for nivel in ("alta", "media", "baja"):
                lista = por_rotacion[nivel]
                if lista:
                    bloque += f"\n_{etiquetas[nivel]} ({len(lista)}):_\n" + "\n".join(lista)
            return bloque

        reporte = "📊 *ALERTA DE STOCK MCKENNA*\n" + "─" * 25
        reporte += _seccion_por_rotacion("❌ AGOTADOS", agotados_por_rotacion)
        reporte += _seccion_por_rotacion("⚠️ ÚLTIMA UNIDAD", criticos_por_rotacion)
        if not agotados and not criticos:
            reporte += "\n\n✅ Todo el stock está por encima de 1 unidad."
        if sin_ventas_excluidos:
            reporte += (
                f"\n\n🗑️ _{sin_ventas_excluidos} agotadas/críticas sin ventas en "
                f"{anio_actual} — excluidas de esta alerta, revisar si eliminar la "
                "publicación._"
            )
        if bajo_stock_count:
            reporte += (
                f"\n\n🟡 {bajo_stock_count} producto(s) con stock bajo (2–{umbral_bajo_stock - 1} "
                "uds) — revisar en Control de Inventario (/app)."
            )

        grupo_inventario = jid_grupo_inventario_wa()
        ok_wa = enviar_whatsapp_reporte(
            reporte + f"\n\n🤖 _Total procesados: {len(items)}_",
            numero_destino=grupo_inventario,
        )
        if not ok_wa:
            print(
                f"❌ [STOCK SYNC] WhatsApp no entregó el reporte (bridge :3000 / URL_API_WHATSAPP). "
                f"Grupo: {grupo_inventario}"
            )
            return (
                "⚠️ Reporte de stock generado pero NO se envió por WhatsApp. "
                "Comprueba que bot-mckenna esté en marcha (puerto 3000) y que URL_API_WHATSAPP en .env "
                f"apunte al /enviar correcto. Destino: {grupo_inventario}. "
                f"Procesados en Sheets: {len(items)} productos. Agotados: {len(agotados)}, críticos: {len(criticos)}."
            )
        return f"✅ Reporte de stock enviado por WhatsApp. Agotados: {len(agotados)}, Críticos: {len(criticos)}."

    except Exception as e:
        return f"❌ Error crítico en reporte de stock: {e}"
