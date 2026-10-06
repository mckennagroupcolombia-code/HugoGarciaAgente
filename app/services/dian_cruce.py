"""Cruce de los listados de la DIAN contra el Libro Mayor, documento por documento.

La DIAN sabe exactamente qué facturas, notas y documentos soporte emitió y recibió
McKenna (es con lo que el contador declara: 2025 cuadró al peso con la renta y 2026
con los F300). `scripts/descargar_listados_dian.py` deja esos listados en
`docs/contabilidad/DIAN_listados/dian_<desde>_<hasta>.xlsx`; aquí se importan a la
tabla `dian_documentos` (una fila por CUFE) y se cruzan con los asientos del mes:

- **emitidos**: facturas FE / notas crédito NC / documentos soporte DS nuestros ↔ el
  asiento que los registra (`contabilidad_documentos.documento_de_asiento`).
- **recibidos**: facturas de proveedores ↔ asientos con referencia `compra:NIT:NUM`
  (o el documento de la solicitud de pago).

Cada documento queda en uno de cuatro estados: `cuadra` (está en ambos y el valor
coincide), `difiere` (está en ambos con otro valor), `solo_dian` (la DIAN lo tiene y
el libro no) o `solo_libro` (el libro lo nombra y la DIAN no lo trae). Ese es el
cruce que un contador hace a mano con dos Excel.

Solo lectura del libro; nunca crea asientos. Sin LLM.
"""
from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
DIAN_DIR = _REPO / "docs" / "contabilidad" / "DIAN_listados"

TIPO_FACTURA = "Factura electrónica"
TIPO_NC = "Nota de crédito electrónica"
TIPO_ND = "Nota de débito electrónica"
TIPO_DS = "Documento soporte con no obligados"

_TOLERANCIA = 1.0   # pesos; la DIAN redondea distinto que Alegra en los centavos


def _conn() -> sqlite3.Connection:
    from app.services.contabilidad_core import _DB_PATH

    con = sqlite3.connect(_DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def _ensure(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS dian_documentos (
            cufe TEXT PRIMARY KEY,
            tipo TEXT NOT NULL,
            prefijo TEXT NOT NULL DEFAULT '',
            folio TEXT NOT NULL DEFAULT '',
            documento TEXT NOT NULL DEFAULT '',
            fecha_emision TEXT NOT NULL,
            fecha_recepcion TEXT NOT NULL DEFAULT '',
            periodo TEXT NOT NULL,
            nit_emisor TEXT NOT NULL DEFAULT '',
            nombre_emisor TEXT NOT NULL DEFAULT '',
            nit_receptor TEXT NOT NULL DEFAULT '',
            nombre_receptor TEXT NOT NULL DEFAULT '',
            iva REAL NOT NULL DEFAULT 0,
            rete_iva REAL NOT NULL DEFAULT 0,
            rete_renta REAL NOT NULL DEFAULT 0,
            rete_ica REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            estado TEXT NOT NULL DEFAULT '',
            grupo TEXT NOT NULL,
            forma_pago TEXT NOT NULL DEFAULT '',
            archivo_origen TEXT NOT NULL DEFAULT '',
            importado_en TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_dian_periodo_grupo ON dian_documentos (periodo, grupo);
        CREATE INDEX IF NOT EXISTS idx_dian_documento ON dian_documentos (nit_emisor, documento);
        CREATE TABLE IF NOT EXISTS dian_importaciones (
            archivo TEXT PRIMARY KEY,
            mtime REAL NOT NULL,
            filas INTEGER NOT NULL,
            importado_en TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )


# ── Importación ─────────────────────────────────────────────────────────────

_COLUMNAS = {
    "tipo": "Tipo de documento", "cufe": "CUFE/CUDE", "folio": "Folio", "prefijo": "Prefijo",
    "forma_pago": "Forma de Pago", "fecha_emision": "Fecha Emisión", "fecha_recepcion": "Fecha Recepción",
    "nit_emisor": "NIT Emisor", "nombre_emisor": "Nombre Emisor", "nit_receptor": "NIT Receptor",
    "nombre_receptor": "Nombre Receptor", "iva": "IVA", "rete_iva": "Rete IVA", "rete_renta": "Rete Renta",
    "rete_ica": "Rete ICA", "total": "Total", "estado": "Estado", "grupo": "Grupo",
}


def _fecha_dian(v: Any) -> str:
    """«26-09-2026» (o «2026-09-26T19:33:53», o un datetime) → «2026-09-26»."""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    s = str(v or "").strip()
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else ""


def _num(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _nit(v: Any) -> str:
    return re.sub(r"\D", "", str(v or ""))


def _filas_xlsx(path: Path) -> list[dict[str, Any]]:
    import openpyxl

    ws = openpyxl.load_workbook(path, read_only=True).active
    filas = ws.iter_rows(values_only=True)
    try:
        encabezado = [str(c or "").strip() for c in next(filas)]
    except StopIteration:
        return []
    ix = {clave: encabezado.index(col) for clave, col in _COLUMNAS.items() if col in encabezado}
    faltan = set(_COLUMNAS) - set(ix)
    if faltan - {"forma_pago", "fecha_recepcion"}:
        raise ValueError(f"{path.name}: el listado no trae las columnas {sorted(faltan)}")
    out = []
    for r in filas:
        if not r or not r[ix["cufe"]]:
            continue
        d = {k: r[i] for k, i in ix.items()}
        fecha = _fecha_dian(d.get("fecha_emision"))
        if not fecha:
            continue
        prefijo = str(d.get("prefijo") or "").strip()
        folio = str(d.get("folio") or "").strip()
        out.append({
            "cufe": str(d["cufe"]).strip(),
            "tipo": str(d.get("tipo") or "").strip(),
            "prefijo": prefijo, "folio": folio, "documento": f"{prefijo}{folio}".upper(),
            "fecha_emision": fecha, "fecha_recepcion": _fecha_dian(d.get("fecha_recepcion")),
            "periodo": fecha[:7],
            "nit_emisor": _nit(d.get("nit_emisor")), "nombre_emisor": str(d.get("nombre_emisor") or "").strip(),
            "nit_receptor": _nit(d.get("nit_receptor")), "nombre_receptor": str(d.get("nombre_receptor") or "").strip(),
            "iva": _num(d.get("iva")), "rete_iva": _num(d.get("rete_iva")),
            "rete_renta": _num(d.get("rete_renta")), "rete_ica": _num(d.get("rete_ica")),
            "total": _num(d.get("total")), "estado": str(d.get("estado") or "").strip(),
            "grupo": str(d.get("grupo") or "").strip(), "forma_pago": str(d.get("forma_pago") or "").strip(),
            "archivo_origen": path.name,
        })
    return out


def importar(archivo: Path | str | None = None, *, todos: bool = False) -> dict[str, Any]:
    """Importa un listado (o todos los de DIAN_DIR). Idempotente: salta los archivos
    que no cambiaron desde la última importación, salvo con `todos`."""
    rutas = [Path(archivo)] if archivo else sorted(DIAN_DIR.glob("*.xlsx"))
    res = {"archivos": 0, "insertados": 0, "actualizados": 0, "omitidos": 0, "errores": []}
    with _conn() as con:
        _ensure(con)
        hechos = {r["archivo"]: r["mtime"] for r in con.execute("SELECT archivo, mtime FROM dian_importaciones")}
        for ruta in rutas:
            if not ruta.is_file():
                continue
            mtime = ruta.stat().st_mtime
            if not todos and hechos.get(ruta.name) == mtime:
                res["omitidos"] += 1
                continue
            try:
                filas = _filas_xlsx(ruta)
            except Exception as e:  # noqa: BLE001 — un listado malo no tumba los demás
                res["errores"].append(f"{ruta.name}: {e}")
                continue
            res["archivos"] += 1
            for f in filas:
                existe = con.execute("SELECT 1 FROM dian_documentos WHERE cufe=?", (f["cufe"],)).fetchone()
                con.execute(
                    """INSERT OR REPLACE INTO dian_documentos
                       (cufe, tipo, prefijo, folio, documento, fecha_emision, fecha_recepcion, periodo,
                        nit_emisor, nombre_emisor, nit_receptor, nombre_receptor, iva, rete_iva, rete_renta,
                        rete_ica, total, estado, grupo, forma_pago, archivo_origen, importado_en)
                       VALUES (:cufe, :tipo, :prefijo, :folio, :documento, :fecha_emision, :fecha_recepcion,
                               :periodo, :nit_emisor, :nombre_emisor, :nit_receptor, :nombre_receptor, :iva,
                               :rete_iva, :rete_renta, :rete_ica, :total, :estado, :grupo, :forma_pago,
                               :archivo_origen, datetime('now'))""",
                    f,
                )
                res["actualizados" if existe else "insertados"] += 1
            con.execute(
                "INSERT OR REPLACE INTO dian_importaciones (archivo, mtime, filas, importado_en) "
                "VALUES (?, ?, ?, datetime('now'))", (ruta.name, mtime, len(filas)),
            )
        con.commit()
    _memo.clear()
    return res


def importar_pendientes() -> dict[str, Any]:
    """Lo que llama la vista: barato si no hay listados nuevos."""
    return importar()


def periodos_con_listado() -> list[str]:
    with _conn() as con:
        _ensure(con)
        return [r[0] for r in con.execute("SELECT DISTINCT periodo FROM dian_documentos ORDER BY periodo")]


# ── Cruce ───────────────────────────────────────────────────────────────────

_memo: dict[str, Any] = {}


def _firma_mes(con: sqlite3.Connection, periodo: str) -> str:
    a = con.execute(
        "SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(MAX(created_at),'') FROM cc_movimientos "
        "WHERE substr(fecha,1,7)=? AND estado<>'anulado'", (periodo,),
    ).fetchone()
    b = con.execute(
        "SELECT COUNT(*), COALESCE(MAX(importado_en),'') FROM dian_documentos WHERE periodo=?", (periodo,),
    ).fetchone()
    return f"{tuple(a)}|{tuple(b)}"


def _periodo_menos(periodo: str, meses: int) -> str:
    a, m = int(periodo[:4]), int(periodo[5:7]) - meses
    while m <= 0:
        a, m = a - 1, m + 12
    return f"{a:04d}-{m:02d}"


def _libro_del_mes(con: sqlite3.Connection, periodo: str) -> list[dict[str, Any]]:
    """Asientos confirmados del mes y de los DOS anteriores, con lo necesario para
    `documento_de_asiento`. Se miran meses atrás porque McKenna factura al entregar:
    la FE de septiembre puede ser de una venta asentada en agosto. Solo los del mes
    (`en_periodo`) cuentan como «solo libro»."""
    desde = _periodo_menos(periodo, 2)
    filas = con.execute(
        """SELECT m.id, m.fecha, m.concepto, m.referencia, m.plantilla_datos_json, m.tipo_origen,
                  t.identificacion AS tercero_identificacion, t.nombre AS tercero_nombre,
                  (SELECT SUM(l.debito) FROM cc_movimiento_lineas l WHERE l.movimiento_id = m.id) AS total,
                  (SELECT GROUP_CONCAT(DISTINCT p.codigo) FROM cc_movimiento_lineas l
                     JOIN cc_plan_cuentas p ON p.id = l.cuenta_id WHERE l.movimiento_id = m.id) AS cuentas
             FROM cc_movimientos m LEFT JOIN cc_terceros t ON t.id = m.tercero_id
            WHERE substr(m.fecha,1,7) BETWEEN ? AND ? AND m.estado <> 'anulado'
            ORDER BY m.fecha, m.id""",
        (desde, periodo),
    ).fetchall()
    out = []
    for r in filas:
        d = dict(r)
        d["en_periodo"] = d["fecha"][:7] == periodo
        out.append(d)
    return out


def _doc_soporte_por_numero(con: sqlite3.Connection) -> dict[str, int]:
    """DSMG2 → movimiento_id: el número del documento soporte no está en la referencia del asiento."""
    try:
        return {str(r[0]).upper(): int(r[1]) for r in con.execute(
            "SELECT numero, movimiento_id FROM cc_doc_soporte WHERE numero<>'' AND movimiento_id IS NOT NULL"
        )}
    except sqlite3.OperationalError:
        return {}


_RE_DOC_PROPIO = re.compile(r"^(FE|FV|NC|ND|DS[A-Z]*)\s*-?\s*(\d+)$", re.I)
# Recibos de impuestos (490/SDH) no son documentos electrónicos: no se cruzan con la DIAN.
_RE_NO_DIAN = re.compile(r"^RECIBO", re.I)


def _normalizar_doc(doc: str) -> str:
    return re.sub(r"[\s\-]", "", (doc or "").upper())


def _folio(doc: str) -> str:
    m = re.search(r"(\d+)$", doc or "")
    return m.group(1) if m else ""


def _cuenta_principal(cuentas: str, grupo: str) -> str:
    """La cuenta «de fondo» del asiento, para colgar el cruce de la cuenta correcta."""
    codigos = [c for c in (cuentas or "").split(",") if c]
    prefer = ("4135", "4175", "4210") if grupo == "Emitido" else ("1435", "2205", "51", "52", "53", "14")
    for p in prefer:
        for c in codigos:
            if c.startswith(p):
                return c
    return next((c for c in codigos if not c.startswith(("1110", "1305", "1105", "2408", "2365", "2367", "2368"))), codigos[0] if codigos else "")


def cruce_mes(periodo: str, *, importar_nuevos: bool = True) -> dict[str, Any]:
    """El cruce DIAN ↔ libro de un mes. Cacheado por firma (asientos + listado)."""
    from app.services import empresa
    from app.services.contabilidad_documentos import documento_de_asiento, solicitudes_por_id

    if not re.fullmatch(r"\d{4}-\d{2}", periodo or ""):
        raise ValueError("Período inválido: use AAAA-MM")
    if importar_nuevos:
        try:
            importar_pendientes()
        except Exception:  # noqa: BLE001 — sin listados nuevos se cruza con lo que hay
            pass
    nit_empresa = empresa.nit_sin_dv()
    with _conn() as con:
        _ensure(con)
        firma = _firma_mes(con, periodo)
        if _memo.get(periodo, {}).get("firma") == firma:
            return _memo[periodo]["cruce"]
        dian = [dict(r) for r in con.execute(
            "SELECT * FROM dian_documentos WHERE periodo=? ORDER BY fecha_emision, documento", (periodo,),
        )]
        libro = _libro_del_mes(con, periodo)
        ds_por_numero = _doc_soporte_por_numero(con)

    sols = solicitudes_por_id()
    # ── índices del libro ──
    por_doc_propio: dict[str, list[dict]] = defaultdict(list)          # FE797 → asientos
    por_compra: dict[tuple[str, str], list[dict]] = defaultdict(list)   # (nit, DOC) → asientos
    por_compra_folio: dict[tuple[str, str], list[dict]] = defaultdict(list)
    por_cufe: dict[str, list[dict]] = defaultdict(list)
    por_id = {m["id"]: m for m in libro}
    ventas_por_valor: dict[int, list[dict]] = defaultdict(list)    # round(total) → asientos de venta
    for m in libro:
        d = documento_de_asiento(m, solicitudes=sols)
        m["_doc"] = d
        cuentas = (m.get("cuentas") or "").split(",")
        es_venta = any(c.startswith("41") for c in cuentas)
        docs = [x.strip() for x in (d["documento"] or "").split(",") if x.strip()]
        if d["cufe"]:
            por_cufe[d["cufe"]].append(m)
        if es_venta:
            ventas_por_valor[int(round(float(m["total"] or 0)))].append(m)
        for doc in docs:
            nd = _normalizar_doc(doc)
            if _RE_NO_DIAN.match(nd):
                continue
            # Un documento FE/NC con cuenta de ventas es nuestro aunque el asiento traiga
            # el NIT del cliente (las facturas de Siigo lo traen).
            if _RE_DOC_PROPIO.match(nd) and (es_venta or d["nit"] in ("", nit_empresa)):
                por_doc_propio[nd].append(m)
            elif d["nit"] and d["nit"] != nit_empresa:
                por_compra[(d["nit"], nd)].append(m)
                por_compra_folio[(d["nit"], _folio(nd))].append(m)
    for numero, mid in ds_por_numero.items():
        if mid in por_id:
            por_doc_propio[numero].append(por_id[mid])

    usados: set[int] = set()

    def _por_valor(doc: dict) -> list[dict]:
        """Último recurso para una FE: una venta sin documento, del mismo valor, a ≤ 7 días."""
        cands = [a for a in ventas_por_valor.get(int(round(doc["total"])), [])
                 if a["id"] not in usados and not a["_doc"]["documento"]
                 and abs((datetime.strptime(a["fecha"][:10], "%Y-%m-%d")
                          - datetime.strptime(doc["fecha_emision"], "%Y-%m-%d")).days) <= 7]
        return cands[:1]

    def _fila(doc: dict, asientos: list[dict], grupo: str) -> dict[str, Any]:
        criterio = "documento"
        asientos = [a for a in asientos if a["id"] not in usados] or asientos
        if grupo == "Emitido" and doc["tipo"] == TIPO_FACTURA and (
            not asientos or abs(doc["total"] - sum(float(a["total"] or 0) for a in asientos)) > _TOLERANCIA
        ):
            alt = _por_valor(doc)
            if alt:
                asientos, criterio = alt, "valor y fecha"
        total_libro = round(sum(float(a["total"] or 0) for a in asientos), 2)
        if asientos:
            for a in asientos:
                usados.add(a["id"])
            diff = round(doc["total"] - total_libro, 2)
            estado = "cuadra" if abs(diff) <= _TOLERANCIA else "difiere"
        else:
            diff = round(doc["total"], 2)
            estado = "solo_dian"
        return {
            "documento": doc["documento"], "cufe": doc["cufe"], "tipo": doc["tipo"], "fecha": doc["fecha_emision"],
            "nit": doc["nit_emisor"] if grupo == "Recibido" else doc["nit_receptor"],
            "nombre": doc["nombre_emisor"] if grupo == "Recibido" else doc["nombre_receptor"],
            "total_dian": doc["total"], "iva_dian": doc["iva"], "total_libro": total_libro, "diferencia": diff,
            "estado": estado,
            "movimiento_id": asientos[0]["id"] if asientos else None,
            "movimientos": [a["id"] for a in asientos],
            "cuenta_codigo": _cuenta_principal(asientos[0].get("cuentas") or "", grupo) if asientos else "",
            "forma_pago": doc.get("forma_pago") or "",
            "criterio": criterio if asientos else "",
            "asiento_periodo": asientos[0]["fecha"][:7] if asientos else "",
        }

    grupos: dict[str, list[dict]] = {"emitidos": [], "notas_credito": [], "documentos_soporte": [], "recibidos": []}
    for doc in dian:
        if doc["grupo"] == "Emitido":
            candidatos = por_cufe.get(doc["cufe"]) or por_doc_propio.get(doc["documento"]) or []
            if doc["tipo"] == TIPO_NC:
                grupos["notas_credito"].append(_fila(doc, candidatos, "Emitido"))
            elif doc["tipo"] == TIPO_DS:
                grupos["documentos_soporte"].append(_fila(doc, candidatos, "Emitido"))
            else:
                grupos["emitidos"].append(_fila(doc, candidatos, "Emitido"))
        else:
            nit = doc["nit_emisor"]
            candidatos = (por_cufe.get(doc["cufe"]) or por_compra.get((nit, doc["documento"]))
                          or por_compra_folio.get((nit, doc["folio"])) or [])
            grupos["recibidos"].append(_fila(doc, candidatos, "Recibido"))

    # Lo que el libro nombra y la DIAN no trae (sin contar lo ya usado).
    for grupo, indice, es_propio in (("emitidos", por_doc_propio, True), ("recibidos", por_compra, False)):
        vistos: set[int] = set()
        for clave, asientos in indice.items():
            for a in asientos:
                if a["id"] in usados or a["id"] in vistos or not a.get("en_periodo"):
                    continue
                vistos.add(a["id"])
                doc = clave if es_propio else clave[1]
                destino = grupo
                if es_propio and doc.startswith("NC"):
                    destino = "notas_credito"
                elif es_propio and doc.startswith("DS"):
                    destino = "documentos_soporte"
                grupos[destino].append({
                    "documento": doc, "cufe": a["_doc"]["cufe"], "tipo": "", "fecha": a["fecha"],
                    "nit": a["_doc"]["nit"], "nombre": a.get("tercero_nombre") or "",
                    "total_dian": 0.0, "iva_dian": 0.0, "total_libro": round(float(a["total"] or 0), 2),
                    "diferencia": round(-float(a["total"] or 0), 2), "estado": "solo_libro",
                    "movimiento_id": a["id"], "movimientos": [a["id"]],
                    "cuenta_codigo": _cuenta_principal(a.get("cuentas") or "", "Emitido" if es_propio else "Recibido"),
                    "forma_pago": "", "criterio": "documento", "asiento_periodo": a["fecha"][:7],
                })

    def _totales(filas: list[dict]) -> dict[str, Any]:
        t = {"dian": 0, "libro": 0, "en_ambos": 0, "cuadran": 0, "difieren": 0, "solo_dian": 0, "solo_libro": 0,
             "valor_dian": 0.0, "valor_libro": 0.0, "diferencia": 0.0}
        for f in filas:
            if f["estado"] != "solo_libro":
                t["dian"] += 1
                t["valor_dian"] += f["total_dian"]
            if f["estado"] != "solo_dian":
                t["libro"] += 1
                t["valor_libro"] += f["total_libro"]
            if f["estado"] in ("cuadra", "difiere"):
                t["en_ambos"] += 1
            t[{"cuadra": "cuadran", "difiere": "difieren", "solo_dian": "solo_dian", "solo_libro": "solo_libro"}[f["estado"]]] += 1
        t["valor_dian"] = round(t["valor_dian"], 2)
        t["valor_libro"] = round(t["valor_libro"], 2)
        t["diferencia"] = round(t["valor_dian"] - t["valor_libro"], 2)
        return t

    cruce = {
        "periodo": periodo, "nit_empresa": nit_empresa, "listado": bool(dian),
        "asientos_del_mes": sum(1 for m in libro if m.get("en_periodo")),
        **{g: {"filas": filas, "totales": _totales(filas)} for g, filas in grupos.items()},
    }
    _memo[periodo] = {"firma": firma, "cruce": cruce}
    return cruce


def resumen_para_cuenta(periodo: str, codigo: str) -> dict[str, int] | None:
    """Conteos del cruce que le tocan a una cuenta (para la insignia DIAN de la ficha)."""
    codigo = str(codigo or "")
    if codigo.startswith(("41", "42")):
        grupos = ("emitidos", "notas_credito")
    elif codigo.startswith(("14", "22", "51", "52", "53", "2408")):
        grupos = ("recibidos", "documentos_soporte") if codigo.startswith(("51", "52", "53")) else ("recibidos",)
    else:
        return None
    c = cruce_mes(periodo)
    if not c["listado"]:
        return None
    out = {"en_ambos": 0, "cuadran": 0, "difieren": 0, "solo_libro": 0, "solo_dian": 0}
    # Lo que solo la DIAN tiene no pertenece a ninguna cuenta todavía: se cuelga de la
    # cuenta «de entrada» (ventas o proveedores), no de todas las que tocaría.
    for g in grupos:
        for f in c[g]["filas"]:
            if f["estado"] == "solo_dian" and codigo not in ("4135", "2205"):
                continue
            if f["cuenta_codigo"] and not f["cuenta_codigo"].startswith(codigo) and f["estado"] != "solo_dian":
                continue
            if f["estado"] in ("cuadra", "difiere"):
                out["en_ambos"] += 1
            out[{"cuadra": "cuadran", "difiere": "difieren", "solo_dian": "solo_dian", "solo_libro": "solo_libro"}[f["estado"]]] += 1
    return out


def estados_por_movimiento(periodo: str) -> dict[int, dict[str, Any]]:
    """movimiento_id → {estado, documento, cufe, total_dian}: la insignia DIAN de cada fila del auxiliar."""
    c = cruce_mes(periodo)
    out: dict[int, dict[str, Any]] = {}
    for g in ("emitidos", "notas_credito", "documentos_soporte", "recibidos"):
        for f in c[g]["filas"]:
            for mid in f.get("movimientos") or []:
                out[int(mid)] = {"estado": f["estado"], "documento": f["documento"], "cufe": f["cufe"],
                                 "total_dian": f["total_dian"], "diferencia": f["diferencia"]}
    return out


def retenciones_sufridas(periodo: str) -> dict[str, float]:
    """Lo que nos retuvieron en los documentos emitidos del mes, según la DIAN."""
    with _conn() as con:
        _ensure(con)
        r = con.execute(
            "SELECT COALESCE(SUM(rete_iva),0), COALESCE(SUM(rete_renta),0), COALESCE(SUM(rete_ica),0) "
            "FROM dian_documentos WHERE periodo=? AND grupo='Emitido'", (periodo,),
        ).fetchone()
    return {"rete_iva": round(r[0], 2), "rete_renta": round(r[1], 2), "rete_ica": round(r[2], 2)}


if __name__ == "__main__":  # pragma: no cover
    import argparse

    ap = argparse.ArgumentParser(description="Listados DIAN ↔ Libro Mayor")
    ap.add_argument("--importar", action="store_true")
    ap.add_argument("--todos", action="store_true")
    ap.add_argument("--cruce", metavar="AAAA-MM")
    a = ap.parse_args()
    if a.importar:
        print(json.dumps(importar(todos=a.todos), ensure_ascii=False, indent=2))
    if a.cruce:
        c = cruce_mes(a.cruce)
        print(json.dumps({g: c[g]["totales"] for g in ("emitidos", "notas_credito", "documentos_soporte", "recibidos")},
                         ensure_ascii=False, indent=2))
    if not (a.importar or a.cruce):
        ap.print_help()
