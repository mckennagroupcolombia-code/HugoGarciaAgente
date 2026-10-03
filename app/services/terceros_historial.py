"""Historial por tercero: qué ha pasado con cada uno, en orden.

**Por qué existe.** La ficha de un tercero guarda su *estado* actual —que está
exento, que es del SIMPLE, a qué cuenta va su gasto— pero no **cómo se llegó
ahí ni qué le ha pasado**. Y eso es justo lo que alguien necesita saber cuando
abre un tercero seis meses después: por qué se le retiene lo que se le retiene,
qué documentos se le han emitido, qué salió mal alguna vez y cómo se resolvió.

Hasta ahora esa memoria vivía en tres sitios que no se hablan: el campo `notas`
(texto libre que crece sin orden), las tablas de cada módulo (`cc_doc_soporte`,
las solicitudes de pago) y la cabeza de quien estuvo. Cuando una de las tres
falla, la decisión queda sin explicación — y la siguiente persona la repite o
la deshace sin saber.

Este módulo junta lo que ya está registrado en otras tablas **sin duplicarlo**
y agrega un log propio para lo que no tiene dónde vivir: decisiones, incidentes
y lo que el contador indicó. Es **append-only**: un historial que se puede
editar no sirve para responder «¿qué pasó?».
"""

from __future__ import annotations

TIPOS = {
    "decision": "Decisión",
    "incidente": "Incidente",
    "contador": "Indicación del contador",
    "fiscal": "Cambio de perfil tributario",
    "documento": "Documento emitido",
    "nota": "Nota",
}


def _ensure() -> None:
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_tercero_eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
                fecha TEXT NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'nota',
                titulo TEXT NOT NULL,
                detalle TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                monto REAL,
                por TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_tercero_eventos ON cc_tercero_eventos(tercero_id, fecha)"
        )
        # Un mismo hecho no se registra dos veces: si un cron o un reintento
        # vuelve a pasar por aquí, el historial no se llena de duplicados que
        # después nadie sabe si fueron dos hechos o dos registros.
        con.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tercero_eventos_unico"
            " ON cc_tercero_eventos(tercero_id, fecha, titulo)"
        )


def registrar(tercero_id: int, *, titulo: str, fecha: str, tipo: str = "nota",
              detalle: str = "", referencia: str = "", monto: float | None = None,
              por: str = "") -> dict:
    """Anota un hecho en el historial del tercero. Idempotente por (tercero, fecha, título)."""
    _ensure()
    import app.services.contabilidad_core as cc

    if tipo not in TIPOS:
        raise ValueError(f"tipo inválido: {tipo}. Opciones: {', '.join(TIPOS)}")
    if not (titulo or "").strip():
        raise ValueError("Un evento sin título no le sirve a quien lo lea después")
    with cc._conn() as con:
        con.execute(
            "INSERT OR IGNORE INTO cc_tercero_eventos"
            " (tercero_id, fecha, tipo, titulo, detalle, referencia, monto, por)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (int(tercero_id), str(fecha)[:10], tipo, titulo.strip(), detalle.strip(),
             referencia, monto, por),
        )
        r = con.execute(
            "SELECT * FROM cc_tercero_eventos WHERE tercero_id=? AND fecha=? AND titulo=?",
            (int(tercero_id), str(fecha)[:10], titulo.strip()),
        ).fetchone()
    return dict(r) if r else {}


def historial(tercero_id: int, *, limite_movimientos: int = 30) -> dict:
    """Todo lo del tercero en un solo sitio: ficha, eventos, documentos y saldos.

    Los eventos propios se mezclan con lo que **ya** registran otros módulos
    —documentos soporte, solicitudes de pago— en vez de copiarlo: una copia se
    desactualiza y entonces hay dos versiones de lo que pasó.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    t = cc.obtener_tercero(int(tercero_id))
    if not t:
        raise ValueError(f"Tercero {tercero_id} no encontrado")

    eventos: list[dict] = []
    with cc._conn() as con:
        for r in con.execute(
            "SELECT * FROM cc_tercero_eventos WHERE tercero_id=? ORDER BY fecha DESC, id DESC",
            (int(tercero_id),),
        ):
            eventos.append({**dict(r), "origen": "historial",
                            "tipo_label": TIPOS.get(r["tipo"], r["tipo"])})

        # Documentos soporte emitidos (los registra doc_soporte_pagos).
        try:
            for r in con.execute(
                "SELECT * FROM cc_doc_soporte WHERE tercero_id=? ORDER BY fecha DESC",
                (int(tercero_id),),
            ):
                eventos.append({
                    "fecha": r["fecha"], "tipo": "documento", "tipo_label": "Documento emitido",
                    "titulo": (f"Documento soporte {r['numero']}" if r["numero"]
                               else f"Documento soporte ({r['estado']})"),
                    "detalle": r["mensaje"] or "",
                    "referencia": f"solicitud #{r['solicitud_id']}" if r["solicitud_id"] else "",
                    "monto": r["valor"], "origen": "doc_soporte",
                })
        except Exception:
            pass

        # Pagos aprobados desde el wizard.
        try:
            for r in con.execute(
                """SELECT id, fecha, concepto, monto, estado, retencion, retencion_ica,
                          movimiento_id
                     FROM cc_solicitudes_pago WHERE tercero_id=? ORDER BY fecha DESC LIMIT ?""",
                (int(tercero_id), int(limite_movimientos)),
            ):
                eventos.append({
                    "fecha": r["fecha"], "tipo": "documento", "tipo_label": "Solicitud de pago",
                    "titulo": f"Pago #{r['id']} — {r['estado']}",
                    "detalle": r["concepto"] or "",
                    "referencia": f"asiento {r['movimiento_id']}" if r["movimiento_id"] else "",
                    "monto": r["monto"], "origen": "pago",
                })
        except Exception:
            pass

    eventos.sort(key=lambda e: (str(e.get("fecha") or ""), str(e.get("origen"))), reverse=True)

    # El perfil tributario, explicado: es lo que decide cuánto se le gira, y sin
    # el porqué al lado nadie se atreve a cambiarlo ni sabe si sigue vigente.
    perfil = []
    if int(t.get("regimen_simple") or 0):
        perfil.append("Régimen SIMPLE: no se le practica retención de renta ni de ICA (Art. 911 E.T.).")
    if int(t.get("retefuente_exento") or 0):
        perfil.append("Exento de retención en la fuente (autorretenedor o indicación del contador).")
    if float(t.get("ica_por_mil") or 0) > 0:
        perfil.append(f"ReteICA {float(t['ica_por_mil']):g} por mil.")
    if int(t.get("retencion_asume_mckenna") or 0):
        perfil.append("Pago pactado libre de retención: McKenna la asume como mayor gasto.")
    if int(t.get("emite_doc_soporte") or 0):
        perfil.append("No obligado a facturar: McKenna le emite documento soporte (Art. 771-2 E.T.).")
    if t.get("cuenta_gasto_default"):
        perfil.append(f"Su gasto va a la cuenta {t['cuenta_gasto_default']}.")

    return {
        "tercero": {k: t.get(k) for k in (
            "id", "nombre", "identificacion", "tipo", "tipo_persona", "email", "telefono",
            "cuenta_bancaria", "regimen_simple", "retefuente_exento", "ica_por_mil",
            "cuenta_gasto_default", "emite_doc_soporte", "retencion_asume_mckenna", "notas",
        )},
        "perfil_tributario": perfil,
        "eventos": eventos,
        "total_eventos": len(eventos),
    }
