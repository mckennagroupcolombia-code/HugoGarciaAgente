import re
import os
import json
import sqlite3
from typing import Any
import gspread
import requests
from datetime import datetime, timedelta

# --- Importaciones de Servicios y Utilidades Modulares ---
from app.services.siigo import (
    obtener_facturas_siigo_paginadas,
    siigo_factura_etiqueta_log,
    siigo_factura_estado_log,
    siigo_omitir_pdf_mientras_timbrado,
    obtener_documento_fiscal_siigo_para_meli,
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


TITULO_SYNC_FACTURAS_FALTANTES_SIIGO = "Sync facturas faltantes MeLi↔Siigo"

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


def _indexar_facturas_siigo_por_packs(
    facturas_siigo: list, pack_ids: list[str]
) -> dict[str, dict]:
    """Mapea pack_id → factura Siigo (observations / purchase_order)."""
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
    Intenta obtener documento Siigo y subirlo a MeLi.
    Retorna (categoría, detalle_opcional).
    categoría: 'ok' | SYNC_FACTURA_CAT_* .
    """
    if siigo_omitir_pdf_mientras_timbrado(fac):
        est = siigo_factura_estado_log(fac)
        return (
            SYNC_FACTURA_CAT_TIMBRADO,
            f"estado Siigo: {est or 'pendiente timbrado DIAN'}",
        )

    sid = str(fac.get("id") or "").strip()
    if not sid:
        return (SYNC_FACTURA_CAT_SIN_DOC, "factura Siigo sin id")

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
    """Cruza packs pendientes en MeLi con facturas Siigo y sube cuando es posible."""
    categorias = _categorias_sync_facturas_vacias()
    fallo_detalle: dict[str, str] = {}
    exitosas: list[str] = []
    cache_doc: dict[str, tuple[Any, str]] = {}
    fac_match = _indexar_facturas_siigo_por_packs(facturas_siigo, pack_ids)

    for p_id in pack_ids:
        fac = fac_match.get(p_id)
        if not fac:
            categorias[SYNC_FACTURA_CAT_SIN_CRUCE].append(p_id)
            print(f"   └──> ❓ Pack {p_id}: sin cruce en Siigo (observations/purchase_order)")
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
            print(f"   └──> ⚠️ Pack {p_id}: sin PDF/XML en Siigo ({detalle})")
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
            + (f" · En timbrado Siigo: {n_tim}" if n_tim else "")
        )
    elif n_tim:
        resumen = (
            f"ℹ️ *Sync facturas MeLi↔Siigo*\n"
            f"Subidas: {len(exitosas)} · "
            f"{n_tim} pack(s) con factura en Siigo esperando timbrado DIAN (sin subir aún)."
        )
    else:
        return ""

    partes = [resumen]
    secciones = (
        (
            SYNC_FACTURA_CAT_SIN_CRUCE,
            "Sin cruce en Siigo",
            "No aparece el Pack ID en observations/purchase_order de ninguna factura reciente.",
        ),
        (
            SYNC_FACTURA_CAT_SIN_DOC,
            "Factura en Siigo sin PDF/XML",
            "Hay cruce en Siigo pero aún no hay documento descargable para MeLi.",
        ),
        (
            SYNC_FACTURA_CAT_FALLO_SUBIDA,
            "Fallo al subir a MeLi",
            "Documento listo en Siigo pero la API de MeLi rechazó o falló la subida.",
        ),
        (
            SYNC_FACTURA_CAT_TIMBRADO,
            "Esperando timbrado DIAN",
            "Factura en Siigo en borrador/envío; reintentar cuando esté timbrada.",
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
        "Se detectaron packs de MeLi sin documento fiscal subido, tras cruce con Siigo.\n",
        "Resolver según categoría (ver abajo). Al cerrar la acción se reintenta el sync automático.\n",
    ]
    notas_por_cat = {
        SYNC_FACTURA_CAT_SIN_CRUCE: (
            "Buscar el Pack ID en Siigo (observations/purchase_order) o emitir factura "
            "y volver a sincronizar."
        ),
        SYNC_FACTURA_CAT_TIMBRADO: (
            "Factura en Siigo aún en timbrado; esperar estado timbrado y reintentar sync."
        ),
        SYNC_FACTURA_CAT_SIN_DOC: (
            "Hay cruce en Siigo pero falta PDF/XML descargable; completar timbrado o "
            "regenerar documento en Siigo."
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
    """Lee el available_quantity vigente de un ítem puntual (maneja variaciones)."""
    headers = {"Authorization": f"Bearer {token}"}
    res = requests.get(
        f"https://api.mercadolibre.com/items/{meli_id}", headers=headers, timeout=10
    )
    res.raise_for_status()
    item = res.json()
    if item.get("variations"):
        return sum(v.get("available_quantity", 0) for v in item["variations"])
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
      regenera el catálogo desde Siigo (la web no tiene control de stock numérico propio).
    - Siigo: solo lectura de referencia — Siigo es solo para facturación (ver CLAUDE.md),
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
                    f"el catálogo desde Siigo, sin número de stock propio. {msg_web}"
                ),
                "numerico": False,
            }
    except Exception as e:
        resultado["web"] = {"ok": False, "mensaje": f"❌ Error: {e}", "numerico": web_configurado}

    if not verificar_siigo:
        resultado["siigo"] = {"stock": None, "mensaje": "No verificado (sincronización masiva)."}
        return resultado

    try:
        from app.services.siigo import buscar_producto_siigo_por_sku

        datos_siigo = buscar_producto_siigo_por_sku(sku)
        if datos_siigo:
            resultado["siigo"] = {
                "stock": datos_siigo.get("stock_siigo"),
                "mensaje": "Solo lectura — Siigo se usa para facturación, no recibe stock automáticamente.",
            }
        else:
            resultado["siigo"] = {"stock": None, "mensaje": "SKU no encontrado en Siigo."}
    except Exception as e:
        resultado["siigo"] = {"stock": None, "mensaje": f"❌ Error consultando Siigo: {e}"}

    return resultado


def sincronizar_facturas_recientes(dias: int = 1):
    """Busca facturas en Siigo de los últimos 'dias' y las sube a Mercado Libre."""
    print(
        f"\n🚀 [SYNC RECIENTE] Iniciando revisión de facturas de Siigo para los últimos {dias} día(s)..."
    )
    fecha_inicio = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    try:
        facturas_siigo = obtener_facturas_siigo_paginadas(fecha_inicio)
        if not facturas_siigo:
            return f"✅ No se encontraron facturas en Siigo desde {fecha_inicio}."
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
                        f"   └──> ⚠️ Sin documento Siigo (PDF/XML) Pack {p_id} "
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
                        f"   └──> ⚠️ Sin documento Siigo (PDF/XML) Pack {p_id} "
                        f"({siigo_factura_etiqueta_log(f)} est={siigo_factura_estado_log(f)})"
                    )
        return f"✅ Fin del proceso para {fecha_consulta}. Facturas subidas: {exitos}"
    except Exception as e:
        return f"❌ Error crítico en sync por día: {e}"


def sincronizar_manual_por_id(pack_id: str):
    """Busca una factura en Siigo por Pack ID y la sube a Mercado Libre."""
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
                    f"✨ ¡Coincidencia encontrada! Factura Siigo ID: {fac.get('id')}. Procediendo a subir..."
                )
                if siigo_omitir_pdf_mientras_timbrado(fac):
                    return (
                        f"⏭️ La factura está en timbrado ({siigo_factura_estado_log(fac)}). "
                        f"No se puede obtener PDF todavía; reintente cuando esté Accepted en Siigo."
                    )
                doc, fmt = obtener_documento_fiscal_siigo_para_meli(fac.get("id"))
                if doc:
                    return (
                        f"🚀 Resultado de la subida: "
                        f"{subir_factura_meli(pack_id, doc, formato=fmt)}"
                        + (" (XML DIAN)" if fmt == "xml" else "")
                    )
                else:
                    return f"❌ Se encontró la factura pero no se pudo descargar PDF ni XML de Siigo."
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
    """Busca órdenes en MeLi sin factura y las cruza con facturas de Siigo."""
    print(
        "\n🧠 [SYNC INTELIGENTE] Iniciando cruce de datos entre Mercado Libre y Siigo..."
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
        packs_revisados: set[str] = set()
        offset, limit = 0, 50
        while True:
            url_meli = (
                f"https://api.mercadolibre.com/orders/search?seller={seller_id}"
                f"&order.date_created.from={fecha_hace_15}&limit={limit}&offset={offset}"
            )
            data = requests.get(url_meli, headers=headers_meli, timeout=30).json()
            results = data.get("results", []) or []
            for ord in results:
                p_id = str(ord.get("pack_id") or ord.get("id") or "").strip()
                if not p_id or p_id in packs_revisados:
                    continue
                packs_revisados.add(p_id)
                if not meli_pack_tiene_documento_fiscal(p_id, token=token_meli):
                    pendientes.append(p_id)
            paging = data.get("paging") or {}
            total = int(paging.get("total") or 0)
            offset += limit
            if offset >= total or not results:
                break
        if not pendientes:
            return (
                "✅ ¡Excelente! Mercado Libre está al día. No hay facturas pendientes."
            )
        print(f"⏳ Encontradas {len(pendientes)} órdenes en MeLi sin factura fiscal.")

        facturas_siigo = obtener_facturas_siigo_paginadas(
            (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%d")
        )
        if not facturas_siigo:
            return f"⚠️ Alerta: MeLi tiene {len(pendientes)} pendientes pero no hay facturas en Siigo para cruzar."
        print(f"🔍 Obtenidas {len(facturas_siigo)} facturas de Siigo para comparar.")

        resultado = _procesar_packs_sync_siigo(pendientes, facturas_siigo)
        exitosas = resultado["exitosas"]
        categorias = resultado["categorias"]
        fallo_detalle = resultado.get("fallo_detalle") or {}
        pendientes_accion = _packs_accionables_sync(categorias)

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


def obtener_estado_stock_meli() -> list[dict]:
    """
    Lee Google Sheets (col A=meli_id, B=sku, D=nombre) y consulta el stock EN VIVO
    en Mercado Libre para cada producto. Solo lectura — no escribe en Sheets ni notifica.
    Retorna lista de {meli_id, sku, nombre, stock, fila}. `fila` sirve para escribir de
    vuelta en la Hoja 1 (columna F) si algún llamador lo necesita.
    """
    token = refrescar_token_meli()
    if not token:
        raise RuntimeError("Token de Mercado Libre no disponible.")

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
    for i in range(0, len(ml_ids), 20):
        lote = ml_ids[i : i + 20]
        res = requests.get(
            f"https://api.mercadolibre.com/items?ids={','.join(lote)}",
            headers=headers,
        ).json()
        for r in res:
            if r.get("code") != 200:
                continue
            item = r["body"]
            ml_id = item.get("id")
            stock = (
                sum(
                    v.get("available_quantity", 0)
                    for v in item.get("variations", [])
                )
                if item.get("variations")
                else item.get("available_quantity", 0)
            )
            es_full = (item.get("shipping") or {}).get("logistic_type") == "fulfillment"
            items.append({
                "meli_id": ml_id,
                "sku": sku_map.get(ml_id, ""),
                "nombre": nombre_map.get(ml_id, item.get("title")),
                "stock": stock,
                "fila": fila_map.get(ml_id),
                "estado_meli": item.get("status", ""),
                "es_full": es_full,
                "sync_bloqueado": item.get("status") != "active",
                "permalink": item.get("permalink", ""),
            })
    return items


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

        updates, agotados, criticos = [], [], []
        for it in items:
            stock = it["stock"]
            nombre = it["nombre"]
            if stock == 0:
                agotados.append(f"🚫 {nombre}")
            elif stock == 1:
                criticos.append(f"⚠️ {nombre}")
            if it["fila"]:
                updates.append({"range": f"F{it['fila']}", "values": [[stock]]})

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

        reporte = "📊 *ALERTA DE STOCK MCKENNA*\n" + "─" * 25
        if agotados:
            reporte += f"\n\n*❌ AGOTADOS ({len(agotados)}):*\n" + "\n".join(
                agotados[:20]
            )
        if criticos:
            reporte += f"\n\n*⚠️ ÚLTIMA UNIDAD ({len(criticos)}):*\n" + "\n".join(
                criticos[:20]
            )
        if not agotados and not criticos:
            reporte += "\n\n✅ Todo el stock está por encima de 1 unidad."

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
