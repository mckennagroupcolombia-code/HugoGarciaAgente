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
from app.services.meli import subir_factura_meli
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


def _crear_accion_sync_facturas_faltantes_siigo(faltantes: list[str]) -> dict | None:
    """
    Crea una acción en el Centro de mando para que un colaborador ejecute la sincronización
    manual de los Pack IDs faltantes.
    """
    if not faltantes:
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

    marker_line = f"SYS_SYNC_FALTANTES_PACKS_JSON: {json.dumps(faltantes, ensure_ascii=False)}"
    lista_legible = "\n".join([f"- {p}" for p in faltantes])
    descripcion = (
        "Se detectaron órdenes de MeLi sin factura fiscal en el cruce MeLi↔Siigo.\n\n"
        "Acción requerida: revisar cada orden en SIIGO, crear/subir la factura a MeLi y "
        "dejar una nota del motivo. Usa el modo 'Resolver paso a paso' para ir orden por orden.\n\n"
        f"Pack IDs faltantes ({len(faltantes)}):\n{lista_legible}\n\n"
        + marker_line
    )

    data = {
        "tipo": "accion",
        "titulo": TITULO_SYNC_FACTURAS_FALTANTES_SIIGO,
        "categoria": "contabilidad",
        "descripcion": descripcion,
        "prioridad": "alta",
        "asignado_a": asignado_a,
        "pasos": [
            {
                "descripcion": f"Verificar y facturar orden MeLi: {p_id}",
                "notas": "Revisar en SIIGO → crear o subir factura a MeLi → dejar nota del motivo si aplica.",
            }
            for p_id in faltantes
        ],
    }

    ticket, err = crear_ticket(data, creador_id, None)
    if err or not ticket:
        return None

    # Notificar al grupo SEDE SUR (misma lógica que _notificar_nueva_accion_wa en routes_tickets)
    try:
        import threading
        _grupo_sede_sur = os.getenv("GRUPO_SEDE_SUR_WA", "120363023555909043@g.us")
        numero = ticket.get("numero", "")
        n = len(faltantes)
        texto_notif = (
            f"⚡ *Acción nueva* — Sistema\n"
            f"{numero} — {TITULO_SYNC_FACTURAS_FALTANTES_SIIGO}\n"
            f"👤 Asignado a: Sin asignar  ·  Prioridad: alta\n"
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
        # Mapear primero: pack_id -> factura Siigo encontrada por búsqueda en observations/purchase_order.
        pack_set = set(pack_norm)
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

        exitosas: list[str] = []
        fallidas: list[str] = []
        faltantes: list[str] = []
        cache_doc: dict[str, tuple[str, str]] = {}  # siigo_factura_id -> (doc, fmt)

        for p_id in pack_norm:
            fac = fac_match.get(p_id)
            if not fac:
                faltantes.append(p_id)
                continue

            if siigo_omitir_pdf_mientras_timbrado(fac):
                fallidas.append(p_id)
                continue

            sid = str(fac.get("id") or "").strip()
            if not sid:
                fallidas.append(p_id)
                continue

            if sid in cache_doc:
                doc, fmt = cache_doc[sid]
            else:
                doc, fmt = obtener_documento_fiscal_siigo_para_meli(sid)
                cache_doc[sid] = (doc, fmt)

            if not doc:
                fallidas.append(p_id)
                continue

            res = subir_factura_meli(p_id, doc, formato=fmt)
            if isinstance(res, str) and "✅" in res:
                exitosas.append(p_id)
            else:
                fallidas.append(p_id)

        return {
            "ok": True,
            "pack_ids": pack_norm,
            "exitosas": exitosas,
            "fallidas": fallidas,
            "faltantes": faltantes,
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
        url_meli = f"https://api.mercadolibre.com/orders/search?seller={seller_id}&order.date_created.from={fecha_hace_15}"
        pendientes = []
        for ord in (
            requests.get(url_meli, headers={"Authorization": f"Bearer {token_meli}"})
            .json()
            .get("results", [])
        ):
            if not ord.get("fiscal_documents"):
                p_id = str(ord.get("pack_id") or ord.get("id"))
                if p_id not in pendientes:
                    pendientes.append(p_id)
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

        exitosas, faltantes = [], []
        for p_id in pendientes:
            encontrada = False
            for fac in facturas_siigo:
                if (
                    p_id
                    in f"{fac.get('observations', '')} {fac.get('purchase_order', '')}"
                ):
                    encontrada = True
                    if siigo_omitir_pdf_mientras_timbrado(fac):
                        print(
                            f"   └──> ⏭️ PDF omitido Pack {p_id} "
                            f"(timbrado: {siigo_factura_estado_log(fac)}): "
                            f"{siigo_factura_etiqueta_log(fac)}"
                        )
                        break
                    doc, fmt = obtener_documento_fiscal_siigo_para_meli(fac.get("id"))
                    if (
                        doc
                        and "✅" in subir_factura_meli(p_id, doc, formato=fmt)
                    ):
                        suf = " (XML DIAN)" if fmt == "xml" else ""
                        print(f"   └──> ✅ Sincronizada factura para Pack ID: {p_id}{suf}")
                        exitosas.append(p_id)
                    elif not doc:
                        print(
                            f"   └──> ⚠️ Sin documento Siigo (PDF/XML) Pack {p_id} "
                            f"({siigo_factura_etiqueta_log(fac)} est={siigo_factura_estado_log(fac)})"
                        )
                    break
            if not encontrada:
                faltantes.append(p_id)
            elif p_id not in exitosas:
                faltantes.append(p_id)

        if faltantes:
            resumen = f"⚠️ *ALERTA DE FACTURACIÓN* ⚠️\nSe subieron {len(exitosas)} facturas, pero faltan las de {len(faltantes)} órdenes de MeLi."
            lista_ids = "\n".join([f"- {f}" for f in faltantes])
            reporte = f"{resumen}\n\n*IDs sin factura ({len(faltantes)}):*\n{lista_ids}"
            ticket = _crear_accion_sync_facturas_faltantes_siigo(faltantes)
            if ticket and ticket.get("numero"):
                reporte += f"\n\n🏢 Centro de mando: acción #{ticket.get('numero')}"
            enviar_reporte_controlado(reporte)
            return f"Sync terminada. Subidas: {len(exitosas)}. Faltantes: {len(faltantes)}. Reporte enviado."

        return f"✅ ¡Sincronización Inteligente completada! Se subieron {len(exitosas)} facturas."
    except Exception as e:
        return f"❌ Error crítico en Sync Inteligente: {e}"


def ejecutar_sincronizacion_y_reporte_stock():
    """Cruza el stock de Google Sheets con Mercado Libre y envía un reporte de niveles bajos."""
    print("\n💹 [STOCK SYNC] Iniciando escaneo de productos para reporte de stock...")
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: Token de Mercado Libre no disponible."

    try:
        gc = gspread.service_account(filename=GOOGLE_CREDS_PATH)
        sh = gc.open_by_key(SPREADSHEET_ID)
        sheet = sh.worksheet("Hoja 1")
        data = sheet.get_all_values()

        ml_ids, fila_map, nombre_map = [], {}, {}
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

        if not ml_ids:
            return "⚠️ No se encontraron códigos MCO en la Columna A de Google Sheets."
        print(
            f"✅ {len(ml_ids)} productos leídos de Sheets. Consultando stock en Mercado Libre..."
        )

        headers = {"Authorization": f"Bearer {token}"}
        updates, agotados, criticos = [], [], []
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

                nombre = nombre_map.get(ml_id, item.get("title"))
                if stock == 0:
                    agotados.append(f"🚫 {nombre}")
                elif stock == 1:
                    criticos.append(f"⚠️ {nombre}")
                updates.append({"range": f"F{fila_map[ml_id]}", "values": [[stock]]})

        if updates:
            sheet.batch_update(updates)
        print("✅ Stock actualizado en Google Sheets.")

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
            reporte + f"\n\n🤖 _Total procesados: {len(ml_ids)}_",
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
                f"Procesados en Sheets: {len(ml_ids)} productos. Agotados: {len(agotados)}, críticos: {len(criticos)}."
            )
        return f"✅ Reporte de stock enviado por WhatsApp. Agotados: {len(agotados)}, Críticos: {len(criticos)}."

    except Exception as e:
        return f"❌ Error crítico en reporte de stock: {e}"
