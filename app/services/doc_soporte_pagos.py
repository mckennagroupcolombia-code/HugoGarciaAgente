"""Documento soporte en adquisiciones a no obligados a facturar.

**Qué resuelve.** El Art. 771-2 E.T. solo acepta un costo o una deducción si
está soportado en factura o documento equivalente. Cuando el proveedor **no
está obligado a facturar** —una persona natural que cobra con cuenta de cobro
amparada en el Art. 616-2— no hay factura que pedirle: el soporte lo tiene que
**emitir McKenna**, y es el «documento soporte en adquisiciones efectuadas a
sujetos no obligados a expedir factura o documento equivalente» (Res. DIAN
000167/2021). Es electrónico, se transmite a la DIAN y trae su **CUDS**.

Sin él, el gasto está pagado, conciliado y contabilizado… y aun así no es
deducible. El caso que lo motivó es la mensajería de Fidel Rocha: ~$1,93M por
quincena, unos $46,4M al año, que hoy no tienen soporte fiscal. A la tarifa de
renta del 35% son $16,2M de mayor impuesto, más la sanción por inexactitud.

**Quién NO necesita esto**, para no emitirlo de más:

* Quien factura electrónicamente. Su factura ya es el soporte, y emitirle
  además un documento soporte duplicaría el gasto ante la DIAN. Se detecta con
  `perfil_tributario_dian`: si el NIT tiene facturas en `facturas_descargadas/`,
  factura.
* Los contribuyentes del **Régimen SIMPLE**, que **sí** están obligados a
  expedir factura electrónica (Art. 915 E.T.). De hecho, que alguien cobre con
  cuenta de cobro amparado en el 616-2 es evidencia de que **no** es del SIMPLE:
  las dos cosas son incompatibles.
* Las personas jurídicas, todas obligadas a facturar.

**Lo que este módulo NO hace.** No decide solo a quién emitirle: lo propone y lo
marca en la ficha del tercero (`emite_doc_soporte`), porque equivocarse emite un
documento fiscal irreversible —solo se corrige con nota de ajuste— a nombre de
alguien real.
"""

from __future__ import annotations

import os

# La línea del documento se carga contra una **cuenta contable**, no contra un
# ítem de inventario: Alegra rechaza `purchases.items` con el error 11034 en
# esta cuenta (verificado en vivo el 2026-09-11, ver `alegra.py`). La cuenta
# sale del PUC del asiento vía `_cuenta_alegra`; no hay cuenta por defecto a
# propósito — ver ahí por qué.


def activo() -> bool:
    """Si se emite de verdad o solo se calcula (modo sombra).

    Arranca apagado a propósito: un documento soporte emitido **ya viajó a la
    DIAN** y consume numeración de la resolución. No se emite un documento
    fiscal irreversible por defecto.
    """
    return (os.getenv("PAGOS_DOC_SOPORTE_ACTIVO") or "0").strip() not in ("", "0", "false", "False")


def _ensure() -> None:
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        # `emite_doc_soporte` la crea `contabilidad_core`, que es el dueño de
        # `cc_terceros`: crearla aquí dejaba el campo inexistente hasta que
        # alguien emitiera el primer documento.
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_doc_soporte (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                solicitud_id INTEGER,
                movimiento_id INTEGER,
                tercero_id INTEGER NOT NULL,
                fecha TEXT NOT NULL,
                valor REAL NOT NULL,
                alegra_id TEXT NOT NULL DEFAULT '',
                numero TEXT NOT NULL DEFAULT '',
                cuds TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT '',
                mensaje TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # El documento nace BORRADOR al aprobar y viaja a la DIAN solo cuando un
        # operador pulsa «Emitir a la DIAN» (21-sep-2026). `detalle_json` es la
        # foto exacta de lo que se va a emitir —base, retenciones, pagos—, para
        # que lo que se revisa sea exactamente lo que se transmite.
        cols = {r[1] for r in con.execute("PRAGMA table_info(cc_doc_soporte)")}
        for col, ddl in (("detalle_json", "TEXT NOT NULL DEFAULT '{}'"),
                         ("estado_dian", "TEXT NOT NULL DEFAULT ''"),
                         ("incluido_en", "INTEGER"),
                         ("emitido_por", "INTEGER"),
                         ("emitido_at", "TEXT NOT NULL DEFAULT ''")):
            if col not in cols:
                con.execute(f"ALTER TABLE cc_doc_soporte ADD COLUMN {col} {ddl}")
        # Un pago no puede generar dos documentos soporte: cada uno consume
        # numeración de la resolución y duplicaría el gasto ante la DIAN.
        con.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_soporte_solicitud"
            " ON cc_doc_soporte(solicitud_id) WHERE solicitud_id IS NOT NULL"
        )


def requiere(tercero: dict | None) -> tuple[bool, str]:
    """¿A este tercero hay que emitirle documento soporte? Con el porqué."""
    if not tercero:
        return False, "Sin tercero: el documento soporte va a nombre de alguien."
    if int(tercero.get("emite_doc_soporte") or 0):
        return True, "Marcado en su ficha como no obligado a facturar."
    if (tercero.get("tipo_persona") or "") != "natural":
        return False, "Persona jurídica: está obligada a facturar."
    if int(tercero.get("regimen_simple") or 0):
        return False, (
            "Está marcado como Régimen SIMPLE, y los del SIMPLE SÍ están obligados a "
            "expedir factura electrónica (Art. 915 E.T.). Si de verdad cobra con cuenta "
            "de cobro, una de las dos cosas está mal."
        )
    return False, (
        "Persona natural, pero no está marcada como no obligada a facturar. "
        "Revisa si factura electrónicamente; si cobra con cuenta de cobro, "
        "márcalo en su ficha (emite_doc_soporte)."
    )


def _es_peso(v) -> bool:
    return abs(float(v or 0) - round(float(v or 0))) < 0.005


def emitir_por_solicitud(solicitud_id: int, *, forzar: bool = False) -> dict:
    """Deja el documento soporte de una solicitud aprobada como BORRADOR.

    No toca Alegra. El documento viaja a la DIAN solo cuando un operador pulsa
    «Emitir a la DIAN» (`emitir_a_dian`): un documento transmitido no se borra,
    y la API de Alegra no permite transmitir después uno ya creado, así que se
    crea y se transmite en el mismo paso, cuando alguien ya lo revisó.

    Idempotente: si la solicitud ya tiene documento (borrador o emitido), lo
    devuelve sin armar otro.
    """
    _ensure()
    import json

    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    sol = pw.obtener(int(solicitud_id))
    if not sol:
        return {"status": "error", "message": f"Solicitud {solicitud_id} no encontrada"}

    # Las cuotas de préstamo son otro concepto: capital más intereses, y el
    # documento soporte de los intereses lo emite `prestamos.py` por su cuenta.
    # Emitirlo aquí por la cuota entera soportaría capital como si fuera gasto.
    if sol.get("categoria") == "cuota_prestamo":
        return {"status": "no_aplica",
                "message": "Cuota de préstamo: el documento soporte de los intereses lo emite Préstamos."}

    with cc._conn() as con:
        ya = con.execute("SELECT * FROM cc_doc_soporte WHERE solicitud_id=?", (int(solicitud_id),)).fetchone()
    if ya and ya["estado"] == "success":
        return {"status": "ya_emitido", "id": ya["alegra_id"], "numero": ya["numero"],
                "message": f"La solicitud {solicitud_id} ya tiene el documento soporte {ya['numero']}."}
    if ya and ya["estado"] == "borrador":
        return {"status": "borrador", "numero": "", "message": "El documento soporte ya está en borrador."}

    if not sol.get("movimiento_id"):
        return {"status": "no_aplica",
                "message": "La solicitud aún no está aprobada: el documento soporte se emite "
                           "sobre un gasto ya contabilizado."}
    # Antes del corte manda el contador; no se emiten documentos fiscales de un
    # período que él ya declaró.
    if cc.antes_del_corte(sol.get("fecha")):
        return {"status": "bloqueado_por_corte", "message": cc.motivo_corte(sol.get("fecha"))}

    tercero = cc.obtener_tercero(int(sol["tercero_id"])) if sol.get("tercero_id") else None
    hay, motivo = requiere(tercero)
    if not hay and not forzar:
        return {"status": "no_aplica", "message": motivo}

    detalle = _detalle_desde_solicitud(sol, tercero)
    base = detalle["base"]
    with cc._conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO cc_doc_soporte"
            " (solicitud_id, movimiento_id, tercero_id, fecha, valor, estado, mensaje, detalle_json)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (int(solicitud_id), sol.get("movimiento_id"), (tercero or {}).get("id"), detalle["fecha"],
             base, "borrador", "Pendiente de emitir a la DIAN", json.dumps(detalle, ensure_ascii=False)),
        )
    return {"status": "borrador", "numero": "",
            "message": "Documento soporte en borrador: revísalo y emítelo a la DIAN desde el Libro Mayor."}


def _detalle_desde_solicitud(sol: dict, tercero: dict | None) -> dict:
    """La foto del documento soporte a partir de la solicitud: lo que se emitiría.

    Una sola función para el borrador (al aprobar) y la vista previa (antes de
    aprobar): lo que se revisa antes de firmar es exactamente lo que queda.
    """
    # La base es lo facturado por el tercero, no lo girado: la retención es suya
    # y el documento la informa aparte, igual que una factura.
    base = float(sol.get("monto") or 0)
    ret = float(sol.get("retencion") or 0)
    ica = float(sol.get("retencion_ica") or 0)
    return {
        "tercero_id": (tercero or {}).get("id"),
        "identificacion": str((tercero or {}).get("identificacion") or ""),
        "nombre": str((tercero or {}).get("nombre") or ""),
        "email": str((tercero or {}).get("email") or ""),
        "fecha": str(sol.get("fecha"))[:10],
        "descripcion": str(sol.get("concepto") or "")[:255],
        "cuenta_puc": str(sol.get("cuenta_debito") or ""),
        "base": base,
        "retencion": ret, "retencion_concepto": sol.get("retencion_concepto") or "",
        "retencion_ica": ica, "ica_por_mil": float(sol.get("ica_por_mil") or 0),
        "girado": round(base - ret - ica, 2),
        "solicitudes": [int(sol["id"])],
        # Los giros ya hechos; los que falten los agrega `registrar_pago_en_alegra`.
        "pagos": [],
    }


def vista_previa(sol: dict) -> dict | None:
    """El documento soporte que dejaría esta solicitud al aprobarla. No guarda nada.

    Quien aprueba ve el asiento antes de firmar; el documento soporte también
    tiene que verse, porque al aprobar queda listo para ir a la DIAN.
    """
    import app.services.contabilidad_core as cc

    if not sol or sol.get("categoria") == "cuota_prestamo" or sol.get("es_plantilla"):
        return None
    tercero = cc.obtener_tercero(int(sol["tercero_id"])) if sol.get("tercero_id") else None
    hay, _ = requiere(tercero)
    if not hay:
        return None
    avisos = []
    if cc.antes_del_corte(sol.get("fecha")):
        avisos.append(cc.motivo_corte(sol.get("fecha")))
    det = _detalle_desde_solicitud(sol, tercero)
    if not all(_es_peso(det[k]) for k in ("base", "retencion", "retencion_ica")):
        avisos.append("⚠️ No está al peso: así no se podría emitir.")
    if not _cuenta_alegra(det["cuenta_puc"]):
        avisos.append(f"⚠️ La cuenta {det['cuenta_puc']} no tiene equivalente en Alegra.")
    return {"solicitud_id": int(sol["id"]), "estado": "vista_previa", "numero": "", "cuds": "",
            "estado_dian": "", "alegra_id": "", "valor": det["base"], "mensaje": " ".join(avisos),
            "emitido_at": "", "detalle": det}


def _fila(solicitud_id: int):
    import app.services.contabilidad_core as cc

    with cc._conn() as con:
        r = con.execute("SELECT * FROM cc_doc_soporte WHERE solicitud_id=?", (int(solicitud_id),)).fetchone()
        if r and r["estado"] == "incluido" and r["incluido_en"]:
            r = con.execute("SELECT * FROM cc_doc_soporte WHERE solicitud_id=?", (int(r["incluido_en"]),)).fetchone()
    return r


def _a_dict(r) -> dict:
    import json

    d = dict(r)
    try:
        d["detalle"] = json.loads(d.pop("detalle_json", None) or "{}")
    except Exception:
        d["detalle"] = {}
    return d


def obtener_por_solicitud(solicitud_id: int) -> dict | None:
    """El documento soporte de una solicitud (o del que la incluye, si es un complemento)."""
    _ensure()
    r = _fila(solicitud_id)
    return _a_dict(r) if r else None


def listar(desde: str | None = None, hasta: str | None = None, estado: str | None = None) -> list[dict]:
    """Los documentos soporte (borradores y emitidos) para el apartado del Libro Mayor."""
    _ensure()
    import app.services.contabilidad_core as cc

    sql = ("SELECT d.*, t.nombre AS tercero_nombre, t.identificacion AS tercero_identificacion"
           " FROM cc_doc_soporte d LEFT JOIN cc_terceros t ON t.id = d.tercero_id"
           " WHERE d.estado != 'incluido'")
    params: list = []
    if desde:
        sql += " AND d.fecha >= ?"; params.append(desde)
    if hasta:
        sql += " AND d.fecha <= ?"; params.append(hasta)
    if estado:
        sql += " AND d.estado = ?"; params.append(estado)
    sql += " ORDER BY d.fecha DESC, d.id DESC"
    with cc._conn() as con:
        return [_a_dict(r) for r in con.execute(sql, params)]


def emitir_a_dian(solicitud_id: int, *, por: int | None = None) -> dict:
    """Crea el documento soporte en Alegra y lo TRANSMITE a la DIAN. Es el botón.

    Se valida todo ANTES de enviar, porque lo transmitido no se corrige (solo
    con nota de ajuste). La lección del DSMG1 (18-sep-2026): se transmitió sin
    retenciones y dejó un saldo fantasma de $28.657 en Alegra. Por eso:

    * todo al peso, y base − retenciones = girado exacto;
    * cada retención con su id en Alegra —si alguna no está, NO se emite, en vez
      de salir sin ella—; y la simulación tiene que sumar lo esperado;
    * el contacto como NIT con dígito de verificación;
    * nunca un PUT a /bills: un PUT reemplaza el documento entero.
    """
    _ensure()
    import json

    import requests

    import app.services.contabilidad_core as cc
    from app.services import alegra as A
    from app.services import pagos_wizard as pw

    r = _fila(solicitud_id)
    if not r:
        return {"status": "error", "message": "Esa solicitud no tiene documento soporte."}
    doc = _a_dict(r)
    sid = int(doc["solicitud_id"])
    if doc["estado"] == "success":
        return {"status": "ya_emitido", "numero": doc["numero"],
                "message": f"Ya se emitió como {doc['numero']}."}

    # Un intento anterior lo dejó creado en Alegra sin sello (la DIAN no
    # respondió). La API de Alegra no transmite un documento ya creado, así que:
    # si entretanto quedó sellado, se da por emitido; si no, se borra —sin sello
    # se puede— y se vuelve a crear. Nunca dos documentos para el mismo pago.
    if doc.get("alegra_id"):
        previo = requests.get(f"{A._ALEGRA_BASE}/bills/{doc['alegra_id']}", headers=A._alegra_headers(), timeout=15)
        if previo.status_code == 200:
            pb = previo.json()
            sello = (pb.get("stamp") or {}).get("legalStatus") or ""
            if sello:
                return _finalizar(doc, {"id": str(pb["id"]), "numero": (pb.get("numberTemplate") or {}).get("fullNumber"),
                                        "estado_dian": sello, "transmitido": True, "data": pb}, por=por)
            if pb.get("payments"):
                return {"status": "error", "message": (
                    f"{doc.get('numero')} está en Alegra sin sello pero con pagos: revísalo en Alegra antes de reintentar.")}
            borrado = requests.delete(f"{A._ALEGRA_BASE}/bills/{doc['alegra_id']}", headers=A._alegra_headers(), timeout=20)
            if borrado.status_code not in (200, 204, 404):
                return {"status": "error", "message": (
                    f"No se pudo retirar el intento anterior ({doc.get('numero')}): HTTP {borrado.status_code}.")}
            _devolver_numeracion(doc.get("numero") or "")
        with cc._conn() as con:
            con.execute("UPDATE cc_doc_soporte SET alegra_id='', numero='', estado='borrador' WHERE solicitud_id=?", (sid,))

    if not activo():
        return {"status": "error", "message": "La emisión real está apagada (PAGOS_DOC_SOPORTE_ACTIVO=0)."}
    d = doc["detalle"] or {}
    base, ret, ica = float(d.get("base") or 0), float(d.get("retencion") or 0), float(d.get("retencion_ica") or 0)
    girado = float(d.get("girado") or 0)

    # 1. Al peso y cuadrado.
    if not all(_es_peso(v) for v in (base, ret, ica, girado)):
        return {"status": "error", "message": (
            f"El documento no está al peso (base {base}, retención {ret}, ICA {ica}): Alegra "
            "redondearía y el libro y Alegra dejarían de cuadrar. Corrige la solicitud.")}
    if round(base - ret - ica) != round(girado):
        return {"status": "error", "message": (
            f"No cuadra: base {base:,.0f} − retención {ret:,.0f} − ICA {ica:,.0f} ≠ girado {girado:,.0f}.")}
    pagos = d.get("pagos") or []
    if pagos and round(sum(float(x["valor"]) for x in pagos)) != round(girado):
        return {"status": "error", "message": "Los pagos registrados no suman lo girado."}

    # 2. Cuenta contable.
    cuenta = _cuenta_alegra(d.get("cuenta_puc"))
    if not cuenta:
        return {"status": "error", "message": (
            f"La cuenta {d.get('cuenta_puc')} no tiene equivalente en Alegra: el documento "
            "saldría contra una cuenta equivocada.")}

    # 3. El contacto: NIT con DV (la DIAN no acepta CC en un documento electrónico).
    try:
        cs = requests.get(f"{A._ALEGRA_BASE}/contacts", headers=A._alegra_headers(),
                          params={"identification": d.get("identificacion"), "limit": 5}, timeout=15).json()
    except Exception as e:
        return {"status": "error", "message": f"No se pudo consultar el contacto en Alegra: {e}"}
    if cs:
        io = cs[0].get("identificationObject") or {}
        if io.get("type") != "NIT" or not str(io.get("dv") or "").strip():
            return {"status": "error", "message": (
                f"En Alegra {cs[0].get('name')} está como {io.get('type')} sin dígito de verificación: "
                "la DIAN lo rechazaría. Pásalo a NIT con DV en Alegra y vuelve a intentar.")}
        # ⚠️ Sin país la DIAN no recibe el documento, y Alegra lo reporta como un
        # genérico «problema de comunicación con DIAN» (3051): costó seis
        # intentos con el DSMG2 de William (21-sep-2026). Se exige la ubicación
        # completa del vendedor, que el documento soporte informa.
        dire = cs[0].get("address") or {}
        faltan = [n for k, n in (("country", "país"), ("department", "departamento"), ("city", "ciudad"))
                  if not str(dire.get(k) or "").strip()]
        if faltan:
            return {"status": "error", "message": (
                f"En Alegra a {cs[0].get('name')} le falta {', '.join(faltan)} en la dirección: la DIAN no "
                "recibiría el documento. Complétalo en su contacto de Alegra y vuelve a intentar.")}

    kw = dict(identificacion=d.get("identificacion") or "", nombre=d.get("nombre") or "",
              email=d.get("email") or "", fecha=d.get("fecha"), valor=base,
              descripcion=str(d.get("descripcion") or "")[:255], cuenta_contable=cuenta,
              observaciones=(f"Documento soporte de la(s) solicitud(es) de pago "
                             f"{', '.join('#' + str(x) for x in d.get('solicitudes') or [sid])}"
                             f" · asiento {doc.get('movimiento_id')}")[:500],
              retencion=({"concepto": d.get("retencion_concepto") or "",
                          "tarifa_pct": round(ret / base * 100, 2) if base else 0,
                          "retencion": ret} if ret > 0 else None),
              # ⚠️ El ReteICA NO va dentro del documento soporte: la DIAN solo
              # contempla ReteFuente y ReteIVA (representación gráfica del DSMG1)
              # y con él la transmisión fallaba con el genérico 3051 (DSMG2 de
              # William, 21-sep-2026). Se aplica al registrar el pago en Alegra.
              retencion_ica=0, ica_por_mil=0)

    # 4. Simulación: las retenciones tienen que estar TODAS y sumar lo esperado.
    sim = A.crear_documento_soporte_alegra(**kw, dry_run=True)
    if sim.get("status") != "dry_run":
        return {"status": "error", "message": sim.get("message") or "No se pudo armar el documento."}
    if sim.get("aviso"):
        return {"status": "error", "message": "No se emite: " + str(sim["aviso"])}
    en_payload = round(sum(float(x.get("amount") or 0) for x in (sim["payload"].get("retentions") or [])))
    if ica > 0:
        rid_ica = A.retencion_ica_alegra_id(float(d.get("ica_por_mil") or 0))
        if not rid_ica or rid_ica == A.ALEGRA_RETENCION_ICA_ID:
            return {"status": "error", "message": (
                f"No se emite: el ReteICA de {d.get('ica_por_mil')} por mil no tiene su retención en Alegra "
                "y sin ella el pago no podría saldar el documento (quedaría un saldo fantasma).")}
    if en_payload != round(ret):
        return {"status": "error", "message": (
            f"No se emite: el documento llevaría {en_payload:,.0f} en retención en la fuente y deberían ser "
            f"{ret:,.0f}. Emitirlo así deja un saldo por pagar fantasma en Alegra.")}

    # 5. Crear y transmitir en el mismo paso.
    res = A.crear_documento_soporte_alegra(**kw, dry_run=False, enviar_dian=True)
    if res.get("status") == "creado_sin_transmitir":
        with cc._conn() as con:
            con.execute("UPDATE cc_doc_soporte SET alegra_id=?, numero=?, estado='por_emitir', mensaje=?"
                        " WHERE solicitud_id=?",
                        (str(res["id"]), str(res.get("numero") or ""),
                         f"Creado en Alegra sin transmitir: {str(res.get('message'))[:300]}", sid))
        return {"status": "por_emitir", "numero": res.get("numero"), "message": (
            f"Alegra creó {res.get('numero')} pero la DIAN no lo recibió ({res.get('message')}). "
            "Vuelve a intentarlo en unos minutos: el reintento retoma este mismo documento, no crea otro.")}
    if res.get("status") != "success":
        with cc._conn() as con:
            con.execute("UPDATE cc_doc_soporte SET mensaje=? WHERE solicitud_id=?",
                        (f"Error al emitir: {str(res.get('message'))[:350]}", sid))
        return {"status": "error", "message": res.get("message") or "Alegra rechazó el documento."}
    return _finalizar(doc, res, por=por)


def _devolver_numeracion(numero_retirado: str) -> None:
    """Si el documento retirado era el último, la numeración vuelve a ese número.

    Sin esto cada intento fallido deja un hueco (DSMG2, DSMG3… sin documento).
    Solo baja el contador cuando el retirado es justo el anterior al siguiente,
    y reenvía la numeración COMPLETA: un PUT a Alegra reemplaza, no es parcial.
    """
    import re

    import requests

    from app.services import alegra as A

    m = re.search(r"(\d+)$", str(numero_retirado or ""))
    if not m:
        return
    n = int(m.group(1))
    url = f"{A._ALEGRA_BASE}/number-templates/{A.ALEGRA_NUMBER_TEMPLATE_DOC_SOPORTE}"
    try:
        nt = requests.get(url, headers=A._alegra_headers(), timeout=15).json()
        if int(nt.get("nextInvoiceNumber") or 0) != n + 1:
            return
        campos = ("name", "prefix", "isDefault", "autoincrement", "invoiceText", "documentType",
                  "minInvoiceNumber", "maxInvoiceNumber", "startDate", "endDate", "resolutionNumber", "isElectronic")
        payload = {k: nt[k] for k in campos if k in nt}
        payload["nextInvoiceNumber"] = n
        requests.put(url, headers=A._alegra_headers(), json=payload, timeout=20)
    except Exception as e:
        print(f"⚠️ No se pudo devolver la numeración a {numero_retirado}: {e}", flush=True)


def _retenciones_de_pago(detalle: dict) -> list[dict] | None:
    """El ReteICA que se aplica al registrar el pago en Alegra (no va en el documento)."""
    from app.services import alegra as A

    ica = float(detalle.get("retencion_ica") or 0)
    if ica <= 0:
        return None
    rid = A.retencion_ica_alegra_id(float(detalle.get("ica_por_mil") or 0))
    return [{"id": int(rid) if str(rid).isdigit() else rid, "amount": round(ica)}] if rid else None


def _finalizar(doc: dict, res: dict, *, por: int | None = None) -> dict:
    """Documento ya sellado en Alegra: se guarda, se registran los pagos y se verifica el saldo."""
    import json

    import requests

    import app.services.contabilidad_core as cc
    from app.services import alegra as A
    from app.services import pagos_wizard as pw

    sid = int(doc["solicitud_id"])
    d = doc["detalle"] or {}
    ret, ica = float(d.get("retencion") or 0), float(d.get("retencion_ica") or 0)
    girado = float(d.get("girado") or 0)
    pagos = d.get("pagos") or []
    data = res.get("data") or {}
    avisos = []
    en_alegra = round(sum(float(x.get("amount") or 0) for x in (data.get("retentions") or [])))
    if en_alegra != round(ret):
        avisos.append(f"⚠️ Alegra guardó {en_alegra:,.0f} en retenciones, se esperaban {ret:,.0f}.")
    with cc._conn() as con:
        con.execute(
            "UPDATE cc_doc_soporte SET alegra_id=?, numero=?, cuds=?, estado='success', estado_dian=?,"
            " emitido_por=?, emitido_at=datetime('now'), mensaje=? WHERE solicitud_id=?",
            (str(res.get("id")), str(res.get("numero") or ""),
             # El CUDS viene en `stamp.cude` (verificado contra el DSMG1), no en `cufe`.
             str((data.get("stamp") or {}).get("cude") or (data.get("stamp") or {}).get("cufe") or ""),
             str(res.get("estado_dian") or ""), por, " ".join(avisos), sid),
        )

    # 6. Los pagos ya hechos, y el saldo tiene que quedar en cero.
    sol = pw.obtener(sid) or {}
    if not pagos and sol.get("estado") == "pagada":
        pagos = [{"fecha": str(sol.get("pagado_at") or sol.get("fecha"))[:10], "valor": girado}]
    ids_pago = []
    ret_pago = _retenciones_de_pago(d)
    for pg in pagos:
        rp = A.registrar_pago_documento_soporte(
            bill_id=str(res.get("id")), fecha=pg["fecha"], valor=float(pg["valor"]),
            observaciones=f"Pago de la solicitud #{pg.get('solicitud_id') or sid}",
            retenciones=ret_pago)
        if rp.get("status") == "success":
            ret_pago = None      # el ReteICA se aplica una sola vez, con el primer pago
        if rp.get("status") == "success":
            ids_pago.append(str(rp.get("id")))
        else:
            avisos.append(f"⚠️ Pago {pg['fecha']} por {float(pg['valor']):,.0f} no registrado: {rp.get('message')}")
    if pagos:
        try:
            saldo = float(requests.get(f"{A._ALEGRA_BASE}/bills/{res.get('id')}", headers=A._alegra_headers(),
                                       timeout=15).json().get("balance") or 0)
            if abs(saldo) > 0.5:
                avisos.append(f"⚠️ El documento quedó con saldo {saldo:,.0f} en Alegra.")
        except Exception:
            pass
    d["pagos_alegra"] = ids_pago
    with cc._conn() as con:
        con.execute("UPDATE cc_doc_soporte SET mensaje=?, detalle_json=? WHERE solicitud_id=?",
                    (" ".join(avisos), json.dumps(d, ensure_ascii=False), sid))
    return {"status": "success", "numero": res.get("numero"), "estado_dian": res.get("estado_dian"),
            "transmitido": bool(res.get("transmitido")), "avisos": avisos,
            "message": f"Documento soporte {res.get('numero')} emitido"
                       + (f" · DIAN: {res.get('estado_dian')}" if res.get("estado_dian") else "")}


def _cuenta_alegra(codigo_puc: str | None) -> str | None:
    """Cuenta de Alegra donde cargar la línea, a partir del PUC del asiento.

    ⚠️ La función vive en **`alegra_espejo`**, no en `alegra_puc`. Es la que
    resuelve por el mapa de códigos y solo cae al `MAPA_PUC` viejo si esa id
    **todavía existe** en Alegra: al pasar al catálogo PUC, Alegra reasignó
    todas sus ids internas. Llamando a otra cosa, 523550 resolvía a la id 5214
    —del catálogo NIIF, muerta— y Alegra rechazaba el documento con el error
    11060 «No se encontró una de las cuentas contables». Pasó al emitir el
    primer documento soporte (18-sep-2026).

    Devuelve `None` si no hay equivalente: **no se inventa una cuenta de
    respaldo**. Un documento soporte emitido contra la cuenta equivocada ya
    viajó a la DIAN y solo se corrige con nota de ajuste.
    """
    try:
        from app.services.alegra_espejo import cuenta_alegra

        return cuenta_alegra(str(codigo_puc or "")) or None
    except Exception:
        return None


def pendientes(desde: str | None = None) -> list[dict]:
    """Pagos ya aprobados a no obligados a facturar que aún no tienen documento.

    Es la lista que evita que esto se vuelva un paso manual que nadie hace: lo
    que se deja al criterio de cada quien, un día se deja de hacer.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    corte = desde or cc.fecha_corte()
    with cc._conn() as con:
        filas = con.execute(
            """SELECT s.id, s.fecha, s.concepto, s.monto, s.tercero_id, t.nombre, t.identificacion
                 FROM cc_solicitudes_pago s
                 JOIN cc_terceros t ON t.id = s.tercero_id
                WHERE s.movimiento_id IS NOT NULL AND s.fecha >= ?
                  AND COALESCE(t.emite_doc_soporte,0) = 1
                  AND NOT EXISTS (SELECT 1 FROM cc_doc_soporte d
                                   WHERE d.solicitud_id = s.id AND d.estado='success')
                ORDER BY s.fecha""",
            (corte,),
        ).fetchall()
    return [dict(f) for f in filas]


def registrar_pago_en_alegra(solicitud_id: int, *, referencia: str = "") -> dict:
    """Salda en Alegra el documento soporte cuando el giro ya se confirmó.

    **Por qué hace falta.** El documento soporte crea una cuenta por pagar en
    Alegra, igual que la factura de un proveedor. Si nadie la salda, queda un
    pasivo fantasma con el beneficiario: sobre la quincena de Fidel eran $2
    millones que McKenna no debe, apareciendo en el auxiliar de proveedores.

    Va en `confirmar_pago` y no al aprobar porque **al aprobar la plata todavía
    no ha salido**: falta montarla en la Sucursal Virtual con el primer token y
    aprobarla con el segundo. El documento se emite antes (soporta el gasto
    causado); el pago se registra cuando de verdad salió.

    El monto es lo **girado**, no el total: la retención no se le pagó a él,
    se le consignará a la DIAN. Así el saldo del documento queda en cero.
    """
    _ensure()
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    with cc._conn() as con:
        borrador = con.execute(
            "SELECT * FROM cc_doc_soporte WHERE solicitud_id=? AND estado IN ('borrador', 'por_emitir')",
            (int(solicitud_id),),
        ).fetchone()
    if borrador:
        # Todavía no está en Alegra: el giro se anota en la foto del documento y
        # se registra en Alegra cuando el operador lo emita.
        import json

        sol = pw.obtener(int(solicitud_id)) or {}
        det = _a_dict(borrador)["detalle"]
        girado_b = round(float(sol.get("girado") or 0), 2)
        if girado_b > 0 and not det.get("pagos"):
            det["pagos"] = [{"fecha": str(sol.get("pagado_at") or sol.get("fecha") or "")[:10],
                             "valor": girado_b, "solicitud_id": int(solicitud_id)}]
            with cc._conn() as con:
                con.execute("UPDATE cc_doc_soporte SET detalle_json=? WHERE solicitud_id=?",
                            (json.dumps(det, ensure_ascii=False), int(solicitud_id)))
        return {"status": "anotado", "message": "El pago queda anotado en el borrador del documento soporte."}
    with cc._conn() as con:
        doc = con.execute(
            "SELECT * FROM cc_doc_soporte WHERE solicitud_id=? AND estado='success'",
            (int(solicitud_id),),
        ).fetchone()
    if not doc or not doc["alegra_id"]:
        return {"status": "no_aplica", "message": "Esa solicitud no tiene documento soporte emitido."}

    sol = pw.obtener(int(solicitud_id))
    girado = round(float((sol or {}).get("girado") or 0), 2)
    if girado <= 0:
        return {"status": "no_aplica", "message": "No hay valor girado que registrar."}

    from app.services.alegra import registrar_pago_documento_soporte

    det = _a_dict(doc)["detalle"] or {}
    r = registrar_pago_documento_soporte(
        bill_id=str(doc["alegra_id"]),
        fecha=str((sol or {}).get("pagado_at") or (sol or {}).get("fecha") or "")[:10],
        valor=girado,
        retenciones=None if det.get("pagos_alegra") else _retenciones_de_pago(det),
        observaciones=(
            f"Pago de la solicitud #{solicitud_id} · asiento {(sol or {}).get('movimiento_id')}"
            + (f" · ref. {referencia}" if referencia else "")
        ),
    )
    if r.get("status") == "success":
        with cc._conn() as con:
            con.execute(
                "UPDATE cc_doc_soporte SET mensaje=TRIM(COALESCE(mensaje,'')||' · pago Alegra '||?)"
                " WHERE solicitud_id=?", (str(r.get("id")), int(solicitud_id)),
            )
    return r
