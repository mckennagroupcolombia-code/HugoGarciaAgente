"""Pagos de impuestos a partir de los recibos que manda el contador.

El contador (William) presenta las declaraciones y manda por correo el formulario
y su recibo de pago: 490 para la DIAN, «formulario de pago» para Hacienda Bogotá.
`scripts/descargar_soportes_contador.py` los baja y
`scripts/extraer_declaraciones_contador.py` los deja leídos en
`docs/contabilidad/<año>/declaraciones_contador.json`.

Este módulo convierte cada recibo en una solicitud de pago de la categoría
`impuestos` **con la cuenta correcta ya elegida**, que es lo que el operador no
tiene por qué saber:

    490 concepto 61 de un 350 (retención a título de renta) → 2365
    490 concepto 62 de un 350 (retención a título de IVA)   → 2367
    490 de un 300 (IVA)                                      → 2408
    490 de un 110 (renta)                                    → 2404
    Hacienda Bogotá RTICA (lo retenido de ICA)               → 2368
    Hacienda Bogotá ICA anual (el ICA propio)                → 2412

Un pago de impuestos **no es un gasto**: extingue un pasivo que nació cuando se
causó la retención (o el impuesto). Por eso cada recibo trae también cuánto hay
causado en esa cuenta: si el libro tiene menos de lo que se paga, el pago deja
la cuenta en saldo contrario y lo que falta es la causación, no el pago.

No llama a ningún LLM y no escribe nada salvo en `crear_solicitud_desde_recibo`.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_DOCS = _ROOT / "docs" / "contabilidad"

_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]

# Días de tolerancia para reconocer un pago ya registrado por otra vía (p. ej. al
# clasificar la línea PSE del extracto) con el mismo valor.
_TOLERANCIA_DIAS = 7


def _declaraciones() -> list[dict]:
    out: list[dict] = []
    if not _DOCS.exists():
        return out
    for f in sorted(_DOCS.glob("*/declaraciones_contador.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        out.extend(d for d in (data.get("declaraciones") or []) if isinstance(d, dict))
    return out


def _periodo_txt(d: dict, formulario: str) -> str:
    anio, per = d.get("anio"), d.get("periodo")
    if not anio:
        return ""
    if formulario == "300":
        return f"cuatrimestre {per} de {anio}" if per else str(anio)
    if formulario in ("110", "ICA"):
        return f"año {anio}"
    if formulario == "RTICA":
        return f"bimestre {per} de {anio}" if per else str(anio)
    if per and 1 <= int(per) <= 12:
        return f"{_MESES[int(per) - 1]} de {anio}"
    return str(anio)


def _clasificar_490(d: dict) -> tuple[str, str, str] | None:
    """(cuenta, formulario, etiqueta) de un recibo 490, o None si no se sabe.

    El formulario que paga lo dice el prefijo de su número (350…, 300…, 110…).
    """
    pagado = str(d.get("formulario_pagado") or "")
    concepto = str(d.get("concepto") or "")
    if pagado.startswith("35"):
        if concepto == "61":
            return "2365", "350", "Retención en la fuente a título de renta"
        if concepto == "62":
            return "2367", "350", "Retención a título de IVA (reteIVA)"
        return None
    if pagado.startswith("300"):
        return "2408", "300", "IVA por pagar"
    if pagado.startswith("110"):
        return "2404", "110", "Impuesto de renta"
    return None


def _recibos_crudos() -> list[dict]:
    decls = _declaraciones()
    por_numero = {str(d.get("numero_formulario") or ""): d for d in decls}
    out: list[dict] = []
    for d in decls:
        tipo = d.get("tipo")
        if tipo == "490":
            cls = _clasificar_490(d)
            valor = float(d.get("valor_impuesto") or 0) + float(d.get("valor_sancion") or 0) + float(d.get("valor_mora") or 0)
            decl = por_numero.get(str(d.get("formulario_pagado") or ""))
            out.append({
                "numero": str(d.get("numero_formulario") or ""),
                "entidad": "DIAN",
                "recibo": "490",
                "formulario": cls[1] if cls else "",
                "formulario_numero": str(d.get("formulario_pagado") or ""),
                "cuenta": cls[0] if cls else "",
                "etiqueta": cls[2] if cls else f"Concepto {d.get('concepto')} (sin clasificar)",
                "periodo": _periodo_txt(d, cls[1] if cls else ""),
                "anio": d.get("anio"), "mes": d.get("periodo") if (cls and cls[1] == "350") else None,
                "fecha_pago": d.get("fecha_pago") or "",
                "valor": round(valor),
                "sancion": round(float(d.get("valor_sancion") or 0)),
                "mora": round(float(d.get("valor_mora") or 0)),
                "archivo": d.get("archivo") or "",
                "declaracion": _resumen_declaracion(decl) if decl else None,
            })
        elif tipo == "PAGO_SDH":
            imp = str(d.get("impuesto") or "").upper()
            cuenta = "2368" if imp == "RTICA" else "2412" if imp == "ICA" else ""
            valor = float(d.get("total_a_pagar_TP") or d.get("valor_a_pagar_VP") or 0)
            out.append({
                "numero": str(d.get("numero_formulario") or ""),
                "entidad": "Secretaría Distrital de Hacienda",
                "recibo": "SDH",
                "formulario": imp,
                "formulario_numero": "",
                "cuenta": cuenta,
                "etiqueta": ("Retención de ICA (RTICA)" if imp == "RTICA"
                             else "Industria y comercio (ICA propio)" if imp == "ICA" else imp),
                "periodo": _periodo_txt(d, imp),
                "anio": d.get("anio"), "mes": None,
                "fecha_pago": d.get("fecha_pago") or "",
                "valor": round(valor),
                "sancion": 0,
                "mora": round(float(d.get("intereses_mora_IM") or 0)),
                "archivo": d.get("archivo") or "",
                "declaracion": None,
            })
    return [r for r in out if r["numero"] and r["valor"] > 0]


def _resumen_declaracion(d: dict) -> dict:
    """Lo que el operador necesita ver de la declaración que paga el recibo."""
    tipo = d.get("tipo")
    r = d.get("renglones") or {}
    if tipo == "350":
        return {
            "tipo": "350", "numero": d.get("numero_formulario"),
            "renta": r.get("130", d.get("total_renta_130")),
            "iva": r.get("134"),
            "exceso_descontado": r.get("129") or 0,
            "total": r.get("138", d.get("total_mas_sanciones_138")),
            "compras_pj_base": (d.get("compras") or {}).get("pj_base"),
            "compras_pj_retencion": (d.get("compras") or {}).get("pj_retencion"),
            "compras_pn_retencion": (d.get("compras") or {}).get("pn_retencion"),
        }
    return {"tipo": tipo, "numero": d.get("numero_formulario")}


def declaraciones_sin_pago() -> list[dict]:
    """Declaraciones de IVA recientes que no llevan recibo: saldo a favor o cero.

    No son pagos, pero sí se contabilizan (cierre de IVA). Se muestran para que
    nadie busque un recibo que no existe.
    """
    out = []
    for d in _declaraciones():
        if d.get("tipo") != "300":
            continue
        a_pagar = float(d.get("total_saldo_a_pagar_88") or 0)
        if a_pagar > 0:
            continue
        out.append({
            "formulario": "300", "numero": d.get("numero_formulario"),
            "periodo": _periodo_txt(d, "300"),
            "iva_generado": d.get("impuesto_generado_67"),
            "iva_descontable": d.get("impuesto_descontable_81"),
            "retenciones_iva_que_le_practicaron": d.get("retenciones_iva_practicadas_85"),
            "saldo_a_favor": d.get("total_saldo_a_favor_89"),
            "archivo": d.get("archivo") or "",
        })
    return out


def _saldo_cuenta(con, codigo: str, hasta: str) -> float:
    r = con.execute(
        """SELECT COALESCE(SUM(l.credito),0) - COALESCE(SUM(l.debito),0) AS s
             FROM cc_movimiento_lineas l
             JOIN cc_movimientos m ON m.id = l.movimiento_id
             JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
            WHERE m.estado <> 'anulado' AND m.fecha <= ?
              AND (c.codigo = ? OR c.codigo LIKE ?)""",
        (hasta, codigo, f"{codigo}%"),
    ).fetchone()
    return round(float(r["s"] or 0), 2)


def _causado_mes(con, codigo: str, anio: int, mes: int) -> float:
    ini = f"{anio}-{mes:02d}-01"
    fin = f"{anio + (mes == 12)}-{(mes % 12) + 1:02d}-01"
    r = con.execute(
        """SELECT COALESCE(SUM(l.credito),0) AS s
             FROM cc_movimiento_lineas l
             JOIN cc_movimientos m ON m.id = l.movimiento_id
             JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
            WHERE m.estado <> 'anulado' AND m.fecha >= ? AND m.fecha < ?
              AND (c.codigo = ? OR c.codigo LIKE ?)""",
        (ini, fin, codigo, f"{codigo}%"),
    ).fetchone()
    return round(float(r["s"] or 0), 2)


def _registro(con, rec: dict) -> dict:
    """Dónde está ya este pago, si está."""
    ref = f"dian:490:{rec['numero']}" if rec["recibo"] == "490" else f"sdh:{rec['numero']}"
    rec["referencia"] = ref
    m = con.execute(
        "SELECT id FROM cc_movimientos WHERE referencia=? AND estado<>'anulado' LIMIT 1", (ref,)
    ).fetchone()
    if m:
        return {"estado": "registrado", "movimiento_id": m["id"]}
    s = con.execute(
        """SELECT id, estado FROM cc_solicitudes_pago
            WHERE (origen_ref=? OR referencia=?) AND estado NOT IN ('rechazada','anulada')
            ORDER BY id DESC LIMIT 1""",
        (ref, ref),
    ).fetchone()
    if s:
        return {"estado": "solicitado", "solicitud_id": s["id"], "solicitud_estado": s["estado"]}
    if rec["cuenta"] and rec["fecha_pago"]:
        # Registrado por otra vía (línea PSE del extracto, asiento manual) con el
        # mismo valor y fecha cercana: no ofrecerlo como pendiente, que es como
        # se duplican pagos.
        try:
            f = date.fromisoformat(rec["fecha_pago"][:10])
        except ValueError:
            f = None
        if f:
            filas = con.execute(
                """SELECT m.id, m.fecha, SUM(l.debito) AS d
                     FROM cc_movimiento_lineas l
                     JOIN cc_movimientos m ON m.id = l.movimiento_id
                     JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                    WHERE m.estado <> 'anulado' AND (c.codigo = ? OR c.codigo LIKE ?)
                      AND m.fecha BETWEEN date(?, '-%d days') AND date(?, '+%d days')
                    GROUP BY m.id""" % (_TOLERANCIA_DIAS, _TOLERANCIA_DIAS),
                (rec["cuenta"], f"{rec['cuenta']}%", f.isoformat(), f.isoformat()),
            ).fetchall()
            for x in filas:
                if abs(float(x["d"] or 0) - rec["valor"]) < 1:
                    return {"estado": "registrado", "movimiento_id": x["id"], "por_otra_via": True}
    return {"estado": "pendiente"}


def recibos(desde: str | None = None) -> dict:
    """Recibos de pago del contador con su estado en el libro.

    `desde` (AAAA-MM-DD) filtra por fecha de pago; por defecto, este año.
    """
    import app.services.contabilidad_core as cc

    desde = desde or f"{date.today().year}-01-01"
    lista = [r for r in _recibos_crudos() if (r["fecha_pago"] or "9999") >= desde]
    lista.sort(key=lambda r: (r["fecha_pago"], r["numero"]), reverse=True)
    with cc._conn() as con:
        for r in lista:
            r.update(_registro(con, r))
            if r["cuenta"]:
                r["saldo_libro"] = _saldo_cuenta(con, r["cuenta"], r["fecha_pago"] or date.today().isoformat())
                if r["mes"] and r["anio"]:
                    r["causado_periodo"] = _causado_mes(con, r["cuenta"], int(r["anio"]), int(r["mes"]))
            r["avisos"] = _avisos(r)
    return {
        "recibos": lista,
        "pendientes": sum(1 for r in lista if r["estado"] == "pendiente"),
        "sin_pago": declaraciones_sin_pago(),
    }


_CACHE_RECIBOS: dict[str, Any] = {"ts": 0.0, "lista": []}

# Tercero a quien se le paga cada tipo de recibo (lo busca el Taller por nombre).
TERCERO_POR_RECIBO = {"490": "DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES", "SDH": "SECRETARIA DISTRITAL DE HACIENDA"}


def recibo_para_linea(monto: float, fecha: str, entidad: str) -> dict | None:
    """El recibo del contador que paga esta línea del banco, si hay uno.

    `entidad` es «490» (DIAN) o «SDH» (Secretaría de Hacienda de Bogotá). Casa por
    valor exacto (±$1) y fecha de pago a ±`_TOLERANCIA_DIAS`; entre varios, el de
    fecha más cercana y, a igual distancia, el que aún no está en el libro. Es lo
    que deja al Taller llevar cada impuesto a SU cuenta —2365 retefuente, 2367
    reteIVA, 2368 reteICA, 2408 IVA, 2404 renta— en vez de mandar todo «PAGO PSE
    DIAN» a 2365 (25-sep-2026: el reteIVA de agosto habría caído ahí).
    """
    import time

    ahora = time.time()
    if ahora - _CACHE_RECIBOS["ts"] > 60:
        _CACHE_RECIBOS["lista"] = recibos(desde="1900-01-01")["recibos"]
        _CACHE_RECIBOS["ts"] = ahora
    try:
        f = date.fromisoformat(str(fecha)[:10])
    except ValueError:
        return None
    candidatos = []
    for r in _CACHE_RECIBOS["lista"]:
        if r.get("recibo") != entidad or not r.get("cuenta") or not r.get("fecha_pago"):
            continue
        if abs(float(r.get("valor") or 0) - float(monto or 0)) >= 1:
            continue
        try:
            dias = abs((date.fromisoformat(r["fecha_pago"][:10]) - f).days)
        except ValueError:
            continue
        if dias <= _TOLERANCIA_DIAS:
            candidatos.append((dias, r.get("estado") != "pendiente", r))
    if not candidatos:
        return None
    candidatos.sort(key=lambda x: (x[0], x[1]))
    return candidatos[0][2]


def adjuntar_soporte_recibo(movimiento_id: int) -> bool:
    """Adjunta el PDF del recibo 490/SDH al asiento que lo cita en su referencia.

    No pisa un soporte que ya tenga. Devuelve True si adjuntó algo.
    """
    import app.services.contabilidad_core as cc

    mov = cc.obtener_movimiento(int(movimiento_id))
    ref = str((mov or {}).get("referencia") or "")
    if not mov or mov.get("soporte_path") or not (ref.startswith("dian:490:") or ref.startswith("sdh:")):
        return False
    numero = ref.rsplit(":", 1)[-1]
    rec = next((r for r in _recibos_crudos() if str(r.get("numero")) == numero), None)
    if not rec or not rec.get("archivo") or not (_ROOT / rec["archivo"]).is_file():
        return False
    ruta = _ROOT / rec["archivo"]
    cc.guardar_comprobante(int(movimiento_id), ruta.read_bytes(), ruta.name, "application/pdf")
    return True


def invalidar_cache_recibos() -> None:
    _CACHE_RECIBOS["ts"] = 0.0


def _cop(v: float) -> str:
    return "$" + f"{round(v):,}".replace(",", ".")


def _avisos(r: dict) -> list[str]:
    avisos: list[str] = []
    if not r["cuenta"]:
        avisos.append("No se sabe qué cuenta salda este recibo: regístralo eligiendo la cuenta a mano.")
        return avisos
    if r["estado"] == "pendiente" and r.get("saldo_libro") is not None and r["saldo_libro"] + 0.5 < r["valor"]:
        avisos.append(
            f"En el libro la cuenta {r['cuenta']} solo tiene {_cop(max(r['saldo_libro'], 0))} por pagar y el recibo "
            f"es de {_cop(r['valor'])}. Falta causar {_cop(r['valor'] - max(r['saldo_libro'], 0))}: el pago se "
            "puede registrar, pero la cuenta quedará en saldo contrario hasta que se cause lo que falta."
        )
    decl = r.get("declaracion") or {}
    pendiente = r["estado"] == "pendiente"
    if pendiente and r["formulario"] == "350" and r["cuenta"] == "2365" and decl and r.get("causado_periodo") is not None:
        # Lo practicado en el mes = lo que se paga (130) + lo que la declaración
        # descontó por practicado en exceso (129). Eso es lo que debió causarse.
        declarado = float(decl.get("renta") or 0) + float(decl.get("exceso_descontado") or 0)
        if declarado and abs(r["causado_periodo"] - declarado) > 1000:
            avisos.append(
                f"Retención practicada en el mes: la declaración dice {_cop(declarado)} y el libro tiene "
                f"{_cop(r['causado_periodo'])} causado. Hay que cruzar tercero por tercero antes de dar el mes "
                "por cerrado (Contabilidad → Conciliación contador)."
            )
        if float(decl.get("exceso_descontado") or 0) > 0:
            avisos.append(
                f"La declaración descuenta {_cop(decl['exceso_descontado'])} de retenciones practicadas en exceso o "
                "indebidas (renglón 129). Ese valor se devuelve al tercero o se reversa en el libro; si no, la 2365 "
                "queda con ese saldo aunque el pago esté completo."
            )
    if r["sancion"] or r["mora"]:
        avisos.append(
            f"Incluye sanción/intereses por {_cop(r['sancion'] + r['mora'])}: eso es gasto (5305), no retención. "
            "Pídele al contador el detalle antes de aprobar."
        )
    return avisos


def crear_solicitud_desde_recibo(numero: str, medio_pago_id: int, created_by: int | None = None,
                                 fecha: str | None = None) -> dict:
    """Solicitud de pago `impuestos` con cuenta, valor, fecha y soporte del recibo.

    Rechaza el recibo si ya está registrado o solicitado. La referencia del
    asiento será `dian:490:<n>` (o `sdh:<n>`), la misma que usa Conciliación
    contador, así que ningún camino lo vuelve a registrar.
    """
    from app.services import pagos_wizard as pw

    data = recibos(desde="1900-01-01")
    rec = next((r for r in data["recibos"] if r["numero"] == str(numero).strip()), None)
    if not rec:
        raise ValueError(f"No encuentro el recibo {numero} entre los soportes del contador")
    if rec["estado"] != "pendiente":
        donde = (f"asiento #{rec['movimiento_id']}" if rec.get("movimiento_id")
                 else f"solicitud #{rec.get('solicitud_id')}")
        raise ValueError(f"Ese recibo ya está en el libro ({donde})")
    if not rec["cuenta"]:
        raise ValueError("No se sabe qué cuenta salda este recibo: usa «Otro impuesto» y elige la cuenta")
    if rec["sancion"] or rec["mora"]:
        raise ValueError("El recibo trae sanción o intereses: esa parte es gasto y se registra aparte con el contador")

    concepto = f"{rec['etiqueta']} — {rec['periodo']} · recibo {rec['recibo']} No. {rec['numero']}"
    if rec["formulario_numero"]:
        concepto += f" (formulario {rec['formulario']} No. {rec['formulario_numero']})"
    sol = pw.crear_solicitud({
        "categoria": "impuestos",
        "cuenta_debito": rec["cuenta"],
        "monto": rec["valor"],
        "fecha": fecha or rec["fecha_pago"],
        "concepto": concepto,
        "medio_pago_id": medio_pago_id,
        "referencia": rec["referencia"],
        "origen_ref": rec["referencia"],
        "origen_sistema": "contador",
        "retencion_modo": "ninguna",
        "notas": "\n".join(rec["avisos"]),
    }, created_by=created_by)
    if rec["archivo"] and (_ROOT / rec["archivo"]).exists():
        with pw._conn() as con:
            con.execute(
                "UPDATE cc_solicitudes_pago SET factura_archivo=?, factura_nombre=? WHERE id=?",
                (rec["archivo"], Path(rec["archivo"]).name, int(sol["id"])),
            )
        sol = {**pw.obtener(int(sol["id"])), "previsualizacion": sol.get("previsualizacion")}
    return sol
