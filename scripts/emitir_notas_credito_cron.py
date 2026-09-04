#!/usr/bin/env python3
"""
Cron: detecta ventas MeLi canceladas que ya tenían factura electrónica
emitida (Siigo histórico o Alegra desde el 2026-09-02, ver
`app/services/alegra.py::obtener_facturas_hibridas`/`FECHA_CORTE_MIGRACION_ALEGRA`)
y aún no tienen nota crédito, y las emite automáticamente contra el proveedor
que corresponda (reason=2 / "anulación de factura electrónica" en Siigo,
`VOID_ELECTRONIC_INVOICE` en Alegra), referenciando la factura original.
Reporta por WhatsApp solo si hubo actividad.

Hasta el 2026-09-03 este cron solo miraba Siigo — cualquier cancelación de
una venta ya facturada en Alegra quedaba sin nota crédito automática, mismo
patrón que el incidente original (ver más abajo) pero con el proveedor
nuevo. Se corrigió el mismo día que se detectó, sin dejarlo acumular.

Origen: la auditoría manual del 10-ago-2026 encontró 44 casos acumulados
desde el 26-jun-2026 sin que nadie se diera cuenta — el flujo de tickets
manuales (ver app/tools/notas_credito.py) dejó de trabajarse y nadie lo
notó durante 6 semanas. Este cron reemplaza ese paso manual para
cancelaciones "normales" de MeLi (fuera de reclamos, que siguen su propio
flujo en app/meli_reclamos.py).

Margen de seguridad (NOTAS_CREDITO_MARGEN_HORAS, default 48h): solo procesa
cancelaciones con más de esa antigüedad, para dar tiempo a que contabilidad
la resuelva a mano si ya la estaba trabajando. Además, justo antes de cada
POST vuelve a consultar Siigo por si ya existe una nota crédito para esa
factura — la corrida manual del 10-ago-2026 generó 4 notas crédito
duplicadas exactamente por no tener este segundo chequeo (alguien las
estaba haciendo a mano en paralelo).

Uso típico (crontab, desde la raíz del repo):
  20 7 * * * cd /ruta/mi-agente && ./venv/bin/python scripts/emitir_notas_credito_cron.py >>log_cron.txt 2>&1

La frecuencia efectiva real la gobierna app/services/cron_scheduler.py
(panel Sistemas → Tareas Programadas) — el crontab solo dispara el chequeo,
que se sale de inmediato si no ha pasado el intervalo configurado.

Variables:
  NOTAS_CREDITO_CRON_ACTIVO=0     — desactiva el cron sin tocar el crontab (default: activo)
  NOTAS_CREDITO_CRON_QUIET=1      — no envía WhatsApp aunque haya actividad (pruebas)
  NOTAS_CREDITO_MARGEN_HORAS      — margen de seguridad tras la cancelación (default 48)
  MELI_CANCELADAS_DIAS_ATRAS      — ventana de búsqueda de canceladas en MeLi (default 90)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.chdir(REPO)

from dotenv import load_dotenv

load_dotenv(REPO / ".env")

JOB_ID = "notas_credito_auto"
ESTADO_PATH = REPO / "app" / "data" / "notas_credito_auto_log.json"


def _activo() -> bool:
    return (os.getenv("NOTAS_CREDITO_CRON_ACTIVO", "1") or "1").strip() == "1"


def _quiet() -> bool:
    return (os.getenv("NOTAS_CREDITO_CRON_QUIET", "0") or "0").strip() == "1"


def _margen_horas() -> float:
    try:
        return float(os.getenv("NOTAS_CREDITO_MARGEN_HORAS", "48") or "48")
    except ValueError:
        return 48.0


def _dias_atras_meli() -> int:
    try:
        return int(os.getenv("MELI_CANCELADAS_DIAS_ATRAS", "90") or "90")
    except ValueError:
        return 90


def _leer_estado() -> dict:
    try:
        with open(ESTADO_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("procesadas"), dict):
                return data
    except Exception:
        pass
    return {"procesadas": {}}


def _guardar_estado(data: dict) -> None:
    ESTADO_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ESTADO_PATH)


def _texto_factura(f: dict) -> str:
    return f"{f.get('observations', '')} {f.get('purchase_order', '')}"


def _subir_nota_credito_a_meli(pack_id: str, nc_id: str, *, es_alegra: bool) -> tuple[bool, str]:
    """
    Descarga el PDF de la nota crédito (Siigo o Alegra según `es_alegra`) y lo
    sube al pack en MeLi (mismo endpoint fiscal_documents que la factura). Sin
    esto, el proveedor queda con la nota crédito correcta pero MeLi solo
    muestra la factura original en "ver factura" — como si la cancelación
    nunca se hubiera resuelto.

    MeLi solo admite UN documento fiscal por pack (confirmado con un 409
    "File Not allowed... there can be only one fiscal_document per pack" al
    intentar subir la NC junto a la factura ya existente): hay que borrar el
    documento anterior antes de subir la nota crédito. El proveedor conserva
    ambos documentos siempre — esto solo reemplaza lo que MeLi expone.
    """
    from app.services.meli import subir_factura_meli, eliminar_documentos_fiscales_meli

    if not nc_id:
        return False, "Sin ID de nota crédito para descargar el PDF."
    if es_alegra:
        from app.services.alegra import descargar_nota_credito_pdf_alegra as _descargar_nc
    else:
        from app.services.siigo import descargar_nota_credito_pdf_siigo as _descargar_nc
    pdf_b64 = _descargar_nc(nc_id)
    if not pdf_b64 or "Error" in str(pdf_b64):
        proveedor = "Alegra" if es_alegra else "Siigo"
        return False, f"No se pudo descargar el PDF de la nota crédito en {proveedor}: {pdf_b64}"

    borrado_ok, borrado_error = eliminar_documentos_fiscales_meli(pack_id)
    if not borrado_ok:
        return False, f"No se pudo borrar el documento fiscal anterior en MeLi: {borrado_error}"

    resultado = subir_factura_meli(pack_id, pdf_b64, formato="pdf", prefijo_archivo="NC")
    if "✅" in str(resultado):
        return True, ""
    return False, f"No se pudo subir la nota crédito a MeLi: {resultado}"


def _mas_viejo_que_margen(orden: dict, margen_horas: float) -> bool:
    # `cancel_detail.date` es el momento real de la cancelación — puede ser
    # muy posterior a date_closed/date_created (esos son de cuando la orden
    # se cerró/pagó originalmente). Usar date_closed como proxy de "cuándo se
    # canceló" adelanta el margen de seguridad: una orden cerrada hace días
    # pero cancelada hace una hora pasaría el chequeo de inmediato, dejando
    # a contabilidad sin las 48h que el margen promete.
    fecha_txt = (
        (orden.get("cancel_detail") or {}).get("date")
        or orden.get("date_closed")
        or orden.get("date_created")
    )
    if not fecha_txt:
        return True
    try:
        fecha = datetime.fromisoformat(fecha_txt.replace("Z", "+00:00"))
    except ValueError:
        return True
    ahora = datetime.now(fecha.tzinfo) if fecha.tzinfo else datetime.now()
    return ahora - fecha >= timedelta(hours=margen_horas)


def _mensaje_whatsapp(emitidas: list[dict], duplicados: list[dict], errores: list[dict]) -> str:
    lineas = ["🎫 *Notas crédito automáticas (cron)*", ""]
    if emitidas:
        total = sum(e["total"] for e in emitidas)
        lineas.append(f"✅ *{len(emitidas)}* nota(s) crédito emitida(s) — ${total:,.0f} COP")
        for e in emitidas[:15]:
            lineas.append(f"• {e['nc_name']} — factura {e['factura']}, ${e['total']:,.0f} (timbrado: {e['status']})")
        if len(emitidas) > 15:
            lineas.append(f"… y {len(emitidas) - 15} más.")
        lineas.append("")
    if duplicados:
        # Informativo, no alarmante: son casos que alguien ya resolvió (a mano
        # o en una corrida anterior) antes de que el cron llegara a ellos.
        lineas.append(f"ℹ️ {len(duplicados)} factura(s) más ya tenían nota crédito (resuelta por otra vía), sin acción necesaria.")
        lineas.append("")
    if errores:
        lineas.append(f"🔴 *{len(errores)}* error(es) al emitir — revisar manualmente:")
        for e in errores[:10]:
            lineas.append(f"• {e['factura']}: {e['error'][:150]}")
        lineas.append("")
    lineas.append("Revisar en Siigo Nube → Ventas → Notas crédito.")
    return "\n".join(lineas)


def _crear_ticket_revision(errores: list[dict]) -> None:
    """Solo se crea ticket si hubo errores reales al emitir (necesita ojo humano)."""
    if not errores:
        return
    try:
        from app.services import tickets_db as tdb

        tdb.init_db()
        import sqlite3

        with sqlite3.connect(tdb.DB_PATH) as db:
            db.row_factory = sqlite3.Row
            admin_row = db.execute("SELECT id FROM usuarios WHERE username='admin'").fetchone()
            jerry_row = db.execute("SELECT id FROM usuarios WHERE username='jerry'").fetchone()
        admin_id = admin_row["id"] if admin_row else None
        asignado_a = jerry_row["id"] if jerry_row else None
        if not admin_id:
            return

        partes = [f"**{len(errores)} error(es) al emitir automáticamente:**"]
        for e in errores:
            partes.append(f"- Factura {e['factura']} (pack {e['pack']}): {e['error']}")

        data = {
            "tipo": "accion",
            "titulo": "Notas crédito automáticas: error al emitir",
            "categoria": "contabilidad",
            "descripcion": "El cron de notas crédito automáticas encontró error(es) al emitir.\n\n" + "\n".join(partes),
            "prioridad": "alta",
            "asignado_a": asignado_a,
        }
        tdb.crear_ticket(data, admin_id, None)
    except Exception as e:
        print(f"⚠️ No se pudo crear ticket de revisión: {e}")


def main() -> int:
    from app.services.cron_scheduler import debe_ejecutar, registrar_ejecucion

    if not debe_ejecutar(JOB_ID):
        print("⏭  Notas crédito automáticas: aún no toca según la frecuencia configurada (Sistemas → Tareas Programadas).")
        return 0

    if not _activo():
        print("⏸️  NOTAS_CREDITO_CRON_ACTIVO=0 — cron desactivado, no se hace nada.")
        return 0

    from app.services.meli import listar_ordenes_canceladas_meli
    from app.services.siigo import (
        buscar_nota_credito_existente_siigo,
        crear_nota_credito_siigo,
    )
    from app.services.alegra import (
        obtener_facturas_hibridas,
        es_factura_alegra,
        buscar_nota_credito_existente_alegra,
        crear_nota_credito_alegra,
    )
    from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

    margen_horas = _margen_horas()
    dias_atras = _dias_atras_meli()

    print(f"🔎 Buscando canceladas MeLi (últimos {dias_atras} días, margen {margen_horas}h)…")
    canceladas = listar_ordenes_canceladas_meli(dias_atras=dias_atras)
    print(f"   {len(canceladas)} órdenes canceladas en la ventana.")

    fecha_inicio_facturas = (datetime.now() - timedelta(days=dias_atras + 5)).strftime("%Y-%m-%d")
    try:
        # Híbrido: Siigo hasta el corte de migración + Alegra desde ahí — si
        # solo miráramos Siigo, cualquier cancelación de una venta ya
        # facturada en Alegra se trataría como "sin factura" y se
        # descartaría sin nota crédito, sin dejar rastro.
        facturas = obtener_facturas_hibridas(fecha_inicio_facturas, estricto=True)
    except Exception as e:
        # No seguir: una lista de facturas incompleta hace que cancelaciones
        # con factura real se traten como "sin factura" y se descarten sin
        # dejar rastro (ver historial de este archivo). Mejor abortar la
        # corrida, avisar y reintentar mañana con la lista completa.
        print(f"🔴 No se pudo obtener el listado completo de facturas (Siigo+Alegra), se aborta esta corrida: {e}")
        errores = [{"pack": "-", "factura": "-", "error": f"Paginación de facturas incompleta: {e}"}]
        _crear_ticket_revision(errores)
        if not _quiet():
            enviar_whatsapp_reporte(_mensaje_whatsapp([], [], errores), jid_grupo_facturacion_ventas_wa())
        registrar_ejecucion(JOB_ID)
        return 1
    print(f"   {len(facturas)} facturas (Siigo+Alegra) en la ventana.")

    try:
        from app.services.conciliacion_meli import (
            construir_indice_facturacion_meli,
            guardar_indice_facturacion_meli,
        )
        indice = construir_indice_facturacion_meli(facturas)
        guardar_indice_facturacion_meli(indice)
        print(f"   Índice de conciliación Ventas/Facturación actualizado ({len(indice)} packs con factura).")
    except Exception as e:
        # No es crítico para el flujo de notas crédito — solo alimenta el
        # panel "Ventas y NC". No abortar la corrida por esto.
        print(f"⚠️ No se pudo actualizar el índice de conciliación: {e}")

    estado = _leer_estado()
    procesadas = estado["procesadas"]

    emitidas: list[dict] = []
    duplicados: list[dict] = []
    errores: list[dict] = []

    for orden in canceladas:
        pack_id = str(orden.get("pack_id") or orden.get("id") or "").strip()
        if not pack_id:
            continue
        if pack_id in procesadas and procesadas[pack_id].get("estado") in ("emitida", "ya_tenia_nc"):
            continue
        if not _mas_viejo_que_margen(orden, margen_horas):
            continue

        factura = next((f for f in facturas if pack_id in _texto_factura(f)), None)
        if not factura:
            continue  # cancelada sin factura emitida — no aplica nota crédito

        es_alegra = es_factura_alegra(factura)
        proveedor = "Alegra" if es_alegra else "Siigo"
        factura_numero = (
            (factura.get("numberTemplate") or {}).get("fullNumber")
            if es_alegra
            else (factura.get("name") or str(factura.get("number") or ""))
        )
        factura_id = factura.get("id")

        existente = (
            buscar_nota_credito_existente_alegra(factura_id) if es_alegra
            else buscar_nota_credito_existente_siigo(factura_id)
        )
        if existente:
            nc_nombre_existente = (
                (existente.get("numberTemplate") or {}).get("fullNumber") if es_alegra
                else existente.get("name")
            )
            subida_ok, subida_error = _subir_nota_credito_a_meli(pack_id, existente.get("id"), es_alegra=es_alegra)
            duplicados.append({
                "pack": pack_id, "factura": factura_numero,
                "nc_existente": nc_nombre_existente,
            })
            if not subida_ok:
                errores.append({"pack": pack_id, "factura": factura_numero, "error": f"NC {nc_nombre_existente} ya existía en {proveedor} pero no se pudo subir a MeLi: {subida_error}"})
            procesadas[pack_id] = {
                "estado": "ya_tenia_nc", "factura": factura_numero,
                "nc": nc_nombre_existente, "subida_meli": subida_ok, "proveedor": proveedor,
                "actualizado_en": datetime.now().isoformat(timespec="seconds"),
            }
            continue

        if es_alegra:
            # crear_nota_credito_alegra resuelve cliente/ítems/bodega directo de la
            # factura por id — no hace falta reconstruirlos como con Siigo.
            resultado = crear_nota_credito_alegra(
                factura_id=factura_id,
                motivo=(
                    f"Nota credito por cancelacion de orden Mercado Libre (pack {pack_id}). "
                    f"Factura ya emitida antes de la cancelacion. Generada automaticamente por cron."
                ),
            )
        else:
            items = [
                {
                    "code": it["code"],
                    "description": it.get("description", ""),
                    "quantity": it["quantity"],
                    "price": it["price"],
                    "tax_ids": [t["id"] for t in (it.get("taxes") or [])],
                }
                for it in factura.get("items", [])
            ]
            payments = [{"id": p["id"], "value": p["value"]} for p in factura.get("payments", [])]

            resultado = crear_nota_credito_siigo(
                invoice_id=factura_id,
                items=items,
                payments=payments,
                reason=2,
                observaciones=(
                    f"Nota crédito por cancelación de orden Mercado Libre (pack {pack_id}). "
                    f"Factura ya emitida antes de la cancelación. Generada automáticamente por cron."
                ),
            )

        if resultado.get("ok"):
            subida_ok, subida_error = _subir_nota_credito_a_meli(pack_id, resultado.get("credit_note_id"), es_alegra=es_alegra)
            emitidas.append({
                "pack": pack_id, "factura": factura_numero,
                "nc_name": resultado["name"], "total": resultado.get("total") or factura.get("total") or 0,
                "status": resultado.get("status"),
            })
            if not subida_ok:
                errores.append({"pack": pack_id, "factura": factura_numero, "error": f"NC {resultado['name']} se emitió en {proveedor} pero no se pudo subir a MeLi: {subida_error}"})
            procesadas[pack_id] = {
                "estado": "emitida", "factura": factura_numero, "nc": resultado["name"],
                "subida_meli": subida_ok, "proveedor": proveedor,
                "actualizado_en": datetime.now().isoformat(timespec="seconds"),
            }
            print(f"   ✅ {factura_numero} -> {resultado['name']} ({resultado.get('status')}) — MeLi: {'✅' if subida_ok else '❌ ' + subida_error}")
        else:
            errores.append({"pack": pack_id, "factura": factura_numero, "error": resultado.get("error", "error desconocido")})
            print(f"   🔴 {factura_numero}: {resultado.get('error')}")

        _guardar_estado(estado)

    _guardar_estado(estado)
    registrar_ejecucion(JOB_ID)

    print(f"Resumen: {len(emitidas)} emitidas, {len(duplicados)} ya tenían NC (sin acción), {len(errores)} errores.")

    # "ya tenía NC" es el caso normal (alguien ya la resolvió, a mano o en una
    # corrida anterior) — no es una anomalía y no debe generar ruido. Solo
    # avisamos/ticketeamos cuando el cron REALMENTE hizo algo (emitió) o
    # encontró un problema real (error al emitir).
    if not emitidas and not errores:
        print("✅ Sin novedades que reportar (nada emitido, nada roto).")
        return 0

    _crear_ticket_revision(errores)

    if not _quiet():
        mensaje = _mensaje_whatsapp(emitidas, duplicados, errores)
        enviar_whatsapp_reporte(mensaje, jid_grupo_facturacion_ventas_wa())

    return 0 if not errores else 1


if __name__ == "__main__":
    sys.exit(main())
