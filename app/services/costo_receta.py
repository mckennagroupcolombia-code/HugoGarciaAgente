"""
Costo de la receta de un combo frente a su precio publicado (Árbol del producto).

Cada componente de la receta (materia prima, bolsa, etiqueta, sobre…) se costea con su
última compra, en este orden:

  1. Compra registrada en el Libro Mayor (débito a 1435 con la línea «CÓDIGO nombre · N und × $P»,
     que deja la compra contabilizada desde la cotización). Precio sin IVA, por código.
  2. Historial de facturas de compra (`facturas_compra_historial.json`, `precio_neto` por código).
     Entre 1 y 2 gana la compra más reciente.
  3. Costo de referencia (`app/data/costos_referencia.json`): un código que nunca se compró con
     su propio SKU toma el costo de otro × factor (p. ej. ACECOCVIRg ← ACECOCmL por la densidad).
  4. Costo cargado a mano por nombre (`componente_costos` de contabilidad.db, el de Rentabilidad).
  5. `unit_cost` de la copia local de Alegra.

Sin LLM y sin llamadas vivas: solo SQLite y JSON locales. Los precios publicados salen de lo
que ya lee el árbol (vitrina web `precio_num` / `precio_meli_num` y lista de Alegra); todos
incluyen IVA, por eso el margen se calcula sobre el precio sin IVA.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
import unicodedata
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parents[1] / "data"
_HISTORIAL = DATA / "facturas_compra_historial.json"
_REFERENCIA = DATA / "costos_referencia.json"

IVA = 0.19
# Igual que Rentabilidad (COMISION_MELI_DEFAULT): referencia, no la tarifa exacta de cada publicación.
COMISION_MELI = 0.165

_LINEA_COMPRA = re.compile(r"·\s*([\d.,]+)\s*(\S+)\s*×\s*\$\s*([\d.,]+)\s*$")

_memo: dict[str, Any] = {"ts": 0.0, "costos": None}
_TTL = 300


def _num(txt: str) -> float:
    """«10.000» → 10000 · «19,6» → 19.6 · «1.234,5» → 1234.5 (formato colombiano)."""
    t = (txt or "").strip()
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", t):
        t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _norm_nombre(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().upper()


def _compras_libro() -> dict[str, dict]:
    from app.services import contabilidad_db as cdb

    out: dict[str, dict] = {}
    with cdb._conn() as con:
        filas = con.execute(
            """SELECT m.fecha, l.descripcion, m.referencia
                 FROM cc_movimiento_lineas l
                 JOIN cc_movimientos m ON m.id = l.movimiento_id
                 JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                WHERE c.codigo = '1435' AND l.debito > 0 AND m.estado != 'anulado'
                  AND l.descripcion LIKE '%×%'"""
        ).fetchall()
    for fecha, desc, ref in filas:
        desc = desc or ""
        codigo = desc.split(" ", 1)[0].strip()
        m = _LINEA_COMPRA.search(desc)
        # Solo líneas que empiezan por el código de Alegra (sin espacios ni paréntesis).
        if not m or not codigo or not re.fullmatch(r"[A-Za-z0-9\-_.]+", codigo) or codigo.isdigit():
            continue
        precio = _num(m.group(3))
        if precio <= 0:
            continue
        previo = out.get(codigo.upper())
        if previo and previo["fecha"] >= (fecha or ""):
            continue
        out[codigo.upper()] = {"costo": precio, "fecha": (fecha or "")[:10], "fuente": "libro",
                               "detalle": f"Compra en el Libro Mayor{f' ({ref})' if ref else ''}"}
    return out


def _compras_historial() -> dict[str, dict]:
    try:
        hist = json.loads(_HISTORIAL.read_text(encoding="utf-8")).get("historial") or []
    except (OSError, ValueError):
        return {}
    out: dict[str, dict] = {}
    for f in hist:
        fecha = (f.get("fecha_factura") or "")[:10]
        for i in f.get("items_resumen") or []:
            codigo = (i.get("codigo") or "").strip().upper()
            precio = float(i.get("precio_neto") or 0)
            if not codigo or precio <= 0:
                continue
            previo = out.get(codigo)
            if previo and previo["fecha"] >= fecha:
                continue
            out[codigo] = {"costo": precio, "fecha": fecha, "fuente": "factura",
                           "detalle": f"Factura {f.get('numero_factura') or ''} · {f.get('proveedor') or ''}".strip()}
    return out


def _manuales() -> dict[str, dict]:
    from app.services import contabilidad_db as cdb

    out: dict[str, dict] = {}
    try:
        filas = cdb.listar_componentes()
    except sqlite3.Error:
        return out
    for r in filas:
        costo = float(r.get("costo_unitario") or 0)
        if costo <= 0:
            continue
        if r.get("iva_incluido"):
            costo /= 1 + IVA
        out[_norm_nombre(r.get("nombre_original") or "")] = {
            "costo": costo, "fecha": (r.get("updated_at") or "")[:10], "fuente": "manual",
            "detalle": "Costo cargado a mano (Rentabilidad)"}
    return out


def referencias() -> dict[str, dict]:
    try:
        d = json.loads(_REFERENCIA.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k.upper(): v for k, v in (d.get("referencias") or {}).items() if isinstance(v, dict)}


def _fuentes() -> dict:
    if _memo["costos"] is not None and time.time() - _memo["ts"] < _TTL:
        return _memo["costos"]
    compras = _compras_historial()
    try:
        for cod, v in _compras_libro().items():
            if cod not in compras or v["fecha"] >= compras[cod]["fecha"]:
                compras[cod] = v
    except sqlite3.Error:
        pass
    datos = {"compras": compras, "manuales": _manuales(), "referencias": referencias()}
    _memo.update(ts=time.time(), costos=datos)
    return datos


def invalidar() -> None:
    _memo.update(ts=0.0, costos=None)


def costo_unitario(codigo: str, nombre: str = "", costo_alegra: float = 0.0) -> dict | None:
    """Costo sin IVA por unidad de inventario del componente (g, mL, und), o None."""
    f = _fuentes()
    cod = (codigo or "").strip().upper()
    if cod in f["compras"]:
        return dict(f["compras"][cod])
    ref = f["referencias"].get(cod)
    if ref:
        base = f["compras"].get((ref.get("compra_de") or "").upper())
        factor = float(ref.get("factor") or 1)
        if base:
            return {"costo": base["costo"] * factor, "fecha": base["fecha"], "fuente": "referencia",
                    "detalle": f"{base['detalle']} · {ref.get('compra_de')} × {factor:g} ({ref.get('motivo') or 'equivalencia'})"}
    man = f["manuales"].get(_norm_nombre(nombre))
    if man:
        return dict(man)
    if costo_alegra and costo_alegra > 0:
        return {"costo": float(costo_alegra), "fecha": "", "fuente": "alegra", "detalle": "Costo unitario en Alegra"}
    return None


def costo_combo(componentes: list[dict]) -> dict:
    """Recibe los componentes de `mapa_producto.anatomia_combos` (codigo, nombre, cantidad,
    casilla, costo) y devuelve el desglose con total y lo que quedó sin costo."""
    lineas = []
    total = 0.0
    sin_costo: list[str] = []
    for c in componentes or []:
        cu = costo_unitario(c.get("codigo") or "", c.get("nombre") or "", float(c.get("costo") or 0))
        cant = float(c.get("cantidad") or 0)
        sub = round(cu["costo"] * cant, 2) if cu else None
        if sub is None:
            sin_costo.append(c.get("codigo") or c.get("nombre") or "?")
        else:
            total += sub
        lineas.append({
            "codigo": c.get("codigo") or "",
            "nombre": c.get("nombre") or "",
            "casilla": c.get("casilla") or "",
            "cantidad": cant,
            "costo_unitario": round(cu["costo"], 4) if cu else None,
            "subtotal": sub,
            "fuente": cu["fuente"] if cu else "",
            "fecha": cu["fecha"] if cu else "",
            "detalle": cu["detalle"] if cu else "Sin compra ni costo registrado",
        })
    return {"total": round(total, 2), "lineas": lineas, "sin_costo": sin_costo, "completo": not sin_costo}


def contraste(costo_total: float, precios: dict[str, float | None], tasa_iva: float = IVA) -> list[dict]:
    """Margen de cada precio publicado contra el costo de la receta. `precios` incluye IVA a `tasa_iva`."""
    out = []
    for canal, precio in precios.items():
        if not precio or precio <= 0:
            continue
        neto = float(precio) / (1 + tasa_iva)
        comision = neto * COMISION_MELI if canal == "meli" else 0.0
        utilidad = neto - comision - costo_total
        out.append({
            "canal": canal,
            "precio": round(float(precio), 2),
            "neto": round(neto, 2),
            "comision": round(comision, 2),
            "utilidad": round(utilidad, 2),
            "margen": round(utilidad / neto, 4) if neto else None,
            "veces_costo": round(neto / costo_total, 2) if costo_total else None,
        })
    return out


_CACHE_WEB = Path(__file__).resolve().parents[2] / "PAGINA_WEB" / "site" / "data" / "cache.json"


def precios_publicados() -> dict[str, dict]:
    """{REF: {web, meli}} con IVA, de la vitrina (`cache.json`); la web ya trae el de MeLi."""
    try:
        cache = json.loads(_CACHE_WEB.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict[str, dict] = {}
    productos = list(cache.get("combos") or [])
    for sec in cache.get("sections") or []:
        productos += sec.get("products") or []
    for p in productos:
        ref = (p.get("ref") or "").strip().upper()
        if ref and ref not in out:
            out[ref] = {"web": p.get("precio_num"), "meli": p.get("precio_meli_num")}
    return out


def iva_por_ref() -> dict[str, float]:
    """{REF: tarifa de IVA de venta} (0.19, 0.05, 0…). Sin la tarifa sincronizada (`iva_pct`
    NULL) se asume 19 % si el ítem lleva IVA, como antes."""
    from app.services import contabilidad_db as cdb

    cdb._ensure()
    try:
        with cdb._conn() as con:
            filas = con.execute("SELECT reference, iva, iva_pct FROM alegra_items").fetchall()
    except sqlite3.Error:
        return {}
    out: dict[str, float] = {}
    for ref, iva, pct in filas:
        out[str(ref).upper()] = (float(pct) / 100) if pct is not None else (IVA if iva else 0.0)
    return out


def para_presentacion(componentes: list[dict], precios: dict[str, float | None], tasa_iva: float = IVA) -> dict:
    """Lo que el árbol muestra por presentación: desglose de la receta + contraste por canal."""
    r = costo_combo(componentes)
    r["contraste"] = contraste(r["total"], precios, tasa_iva) if r["total"] > 0 else []
    # Con piezas sin costo el margen está inflado: es un techo, no el margen real.
    r["parcial"] = bool(r["sin_costo"])
    r["con_iva"] = tasa_iva > 0
    r["tasa_iva"] = tasa_iva
    r["comision_meli"] = COMISION_MELI
    return r


if __name__ == "__main__":
    import sys

    from app.services import mapa_producto

    for ref in sys.argv[1:]:
        c = next((x for x in mapa_producto.anatomia_combos(buscar=ref)["combos"] if x["ref"].upper() == ref.upper()), None)
        if not c:
            print(ref, "no encontrado")
            continue
        r = costo_combo(c["componentes"])
        faltan = "" if r["completo"] else f" (sin costo: {', '.join(r['sin_costo'])})"
        print(f"{ref}: costo receta ${r['total']:,.0f}{faltan}")
        for li in r["lineas"]:
            print(f"   {li['codigo']:<16} {li['cantidad']:>8g} × {li['costo_unitario'] or 0:>10,.2f} = {li['subtotal'] or 0:>10,.0f}  [{li['fuente']}] {li['detalle']}")
