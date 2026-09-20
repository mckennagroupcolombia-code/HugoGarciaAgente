# -*- coding: utf-8 -*-
"""Auditoría del catálogo: producto de inventario ↔ combo de venta ↔ documento técnico.

En Alegra conviven dos cosas con nombres parecidos y no son lo mismo:

  * **Producto de inventario** (`type=product`, p. ej. `AMICREMONg` «CREATINA
    MONOHIDRATO G»): la materia prima a granel. Es donde entra la factura de compra.
  * **Combo de venta** (`type=kit`, p. ej. `C-CREMON500g`): lo que se publica en MeLi
    y en la web. Descuenta N gramos del producto de inventario MÁS su empaque
    (bolsa, cuchara medidora, etiqueta, vinipel…).

La ficha técnica, el COA y la SDS describen la **materia prima**, así que se
documenta UNA vez por producto de inventario y todos sus combos la heredan. Buscar
«¿ya tiene SKU?» solo en la vitrina web (que lista combos) lleva a inventar SKU
que ya existen — pasó el 2026-09-19 con la creatina y la semilla de calabaza.

Lee la copia local del catálogo (`alegra_catalogo_db`, sincronizada por cron). No
llama a Alegra, no escribe nada en Alegra y no usa LLM.

Uso:
    python3 scripts/auditar_catalogo_combos.py            # escribe docs/auditoria_catalogo_combos.md
    python3 scripts/auditar_catalogo_combos.py --json     # además vuelca el detalle en JSON a stdout
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

SALIDA = REPO / "docs" / "auditoria_catalogo_combos.md"

# Empaque e insumos: se reconocen por la PRIMERA palabra del nombre. Buscarla en
# cualquier parte marcaba como empaque «ALMENDRA … CAJA X 22.68 KG».
_EMPAQUE_INICIO = {
    "BOLSA", "ETIQUETA", "TAPA", "TAPON", "ENVASE", "ENV", "FARMA", "GOTERO", "PASTILLERO",
    "LINER", "LINNER", "BANDA", "PAPEL", "VINIPEL", "CUCHARA", "CAJA", "FRASCO", "PERA",
    "PIPETA", "DOYPACK", "STICKER", "CINTA", "ROLLO", "TARRO", "POTE", "ATOMIZADOR",
    "VALVULA", "SELLO", "PLASTICO", "SOBRE", "SPRAY", "DISPENSADOR", "E", "ZUNCHO",
}
_NO_MATERIA = {"OPERATIVOS", "ENVIO", "DOMICILIO", "FLETE", "SERVICIO", "GENERICO"}
_STOP = {"DE", "DEL", "LA", "EL", "EN", "Y", "G", "GR", "ML", "KG", "LT", "UN", "X", "MG", "L", "CON", "SIN"}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9., ]", " ", s)).strip()


def _singular(t: str) -> str:
    # «SEMILLAS DE CALABAZA» y «SEMILLA DE CALABAZA» son el mismo producto: por no
    # tolerar el plural se redactó un documento que ya existía (2026-09-19).
    if len(t) > 4 and t.endswith("ES") and t[-3] not in "AEIOU":
        return t[:-2]
    return t[:-1] if len(t) > 3 and t.endswith("S") else t


def _toks(s: str) -> set[str]:
    return {_singular(t) for t in re.split(r"[^A-Z0-9]+", _norm(s)) if len(t) > 2 and t not in _STOP and not t.isdigit()}


def _primera(nombre: str) -> str:
    p = _norm(nombre).replace(".", " ").split()
    return p[0] if p else ""


def es_empaque(nombre: str) -> bool:
    return _primera(nombre) in _EMPAQUE_INICIO


def es_materia_prima(ref: str, nombre: str) -> bool:
    """A granel: no es empaque ni servicio y su código o nombre termina en unidad de masa/volumen."""
    if es_empaque(nombre) or _primera(nombre) in _NO_MATERIA or ref.upper().startswith(("WEB-", "OPR")):
        return False
    return bool(re.search(r"(g|mL|ml|Kg|KG|Lt|L)$", ref)) or bool(re.search(r"\b(G|ML|KG|LT)$", _norm(nombre)))


def presentacion(nombre: str, ref: str) -> float | None:
    """Gramos o mililitros que promete el combo, leídos de su nombre o su código."""
    for txt in (_norm(nombre), _norm(ref)):
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(KG|KILOS?|LT|LITROS?|G|GR|GRS|GRAMOS|ML|CC)\b", txt)
        if m:
            q = float(m.group(1).replace(",", "."))
            return q * 1000 if m.group(2)[0] in "KL" else q
    m = re.search(r"\b(KG|LT)$", _norm(nombre))
    return 1000.0 if m else None


def cargar_catalogo() -> dict[str, dict]:
    from app.services import alegra_catalogo_db as ac

    items: list[dict] = []
    off = 0
    while True:
        r = ac.listar_items(limit=500, offset=off, solo_activos=True)
        lote = r.get("items") if isinstance(r, dict) else r
        items += lote or []
        if not lote or len(lote) < 500:
            break
        off += 500
    return {i["reference"]: (ac.obtener_item(i["reference"]) or i) for i in items}


def documentos_por_titulo() -> list[dict]:
    """YAML de fichas: completos, borradores, antiguas y marcadas vacías."""
    from app.services import ficha_tecnica as ft

    out = []
    for y in sorted(ft.DATOS_DIR.glob("*.yaml")):
        if y.name.startswith(("plantilla", "coa_plantilla")):
            continue
        try:
            d = ft.cargar_datos_desde_archivo(y)
        except Exception:
            continue
        titulo = (d.get("titulo") or d.get("nombre_producto") or "").strip()
        if not titulo:
            continue
        if y.name.startswith("vacio_") or d.get("_estado") == "vacio":
            estado = "vacía"
        elif d.get("_borrador"):
            estado = "borrador"
        elif d.get("_tipo") == "completo":
            coa = ft._contexto_coa(d["_coa"]) if d.get("_coa") else None
            sds = ft._contexto_sds(d["_sds"]) if d.get("_sds") else None
            tiene_coa = bool(coa and ft._coa_diligenciado(coa))
            tiene_sds = bool(sds and ft._sds_diligenciado(sds))
            estado = "TDS+COA+SDS" if tiene_coa and tiene_sds else ("TDS+COA" if tiene_coa else "TDS")
        else:
            # Hay YAML con COA y SDS diligenciados que no llevan `_tipo: completo`:
            # la web solo publica los marcados, así que existen pero nadie los ve.
            coa = ft._contexto_coa(d["_coa"]) if d.get("_coa") else None
            sds = ft._contexto_sds(d["_sds"]) if d.get("_sds") else None
            if coa and sds and ft._coa_diligenciado(coa) and ft._sds_diligenciado(sds):
                estado = "completo SIN PUBLICAR"
            else:
                estado = "antigua (solo TDS)"
        out.append({"archivo": y.name, "titulo": titulo, "toks": _toks(titulo), "estado": estado,
                    "referencia": (d.get("referencia") or "").strip()})
    return out


_ORDEN_DOC = ["TDS+COA+SDS", "completo SIN PUBLICAR", "TDS+COA", "TDS", "borrador", "antigua (solo TDS)", "vacía"]


def mejor_documento(ref: str, nombre: str, docs: list[dict]) -> dict | None:
    tn = _toks(nombre)
    cand = []
    for d in docs:
        if d["referencia"] and d["referencia"].lower() == ref.lower():
            cand.append((3.0, d))
            continue
        if not tn or not d["toks"]:
            continue
        inter = len(tn & d["toks"])
        if inter and (d["toks"] <= tn or tn <= d["toks"]):
            cand.append((inter / max(len(tn), len(d["toks"])) + 1, d))
    if not cand:
        return None
    cand.sort(key=lambda x: (-x[0], _ORDEN_DOC.index(x[1]["estado"])))
    return cand[0][1]


def auditar() -> dict:
    cat = cargar_catalogo()
    kits = {r: v for r, v in cat.items() if v.get("type") == "kit"}
    prods = {r: v for r, v in cat.items() if v.get("type") != "kit"}
    hall: dict[str, list[str]] = collections.OrderedDict()
    usos: dict[str, list[str]] = collections.defaultdict(list)

    def add(clave: str, txt: str) -> None:
        hall.setdefault(clave, []).append(txt)

    for r, k in sorted(kits.items()):
        nombre = k.get("name") or ""
        comps = k.get("componentes") or []
        if not comps:
            add("A. Combo sin componentes — al venderse no descuenta inventario ni tiene costo", f"`{r}` {nombre}")
            continue
        mp = [c for c in comps if not es_empaque(c.get("nombre") or "") and _primera(c.get("nombre") or "") not in _NO_MATERIA]
        for c in comps:
            if c.get("codigo") and c["codigo"] not in cat:
                add("F. Componente que ya no existe como producto activo", f"`{r}` → `{c['codigo']}` {c.get('nombre')}")
        es_equipo = bool(re.search(r"\b(KIT|BEAKER|GRAMERA|AGITADOR|ESPATULA|VASO|REVOLVEDOR|GOTERO|ENVASE|CAPSULAS?|ELASTICO|CUCHARA)\b", _norm(nombre)))
        if not mp:
            if not es_equipo:
                add("B. Combo sin materia prima — solo lleva empaque, el producto vendido no se descuenta", f"`{r}` {nombre}")
            continue
        for c in mp:
            usos[c.get("codigo") or ""].append(r)
        if not es_equipo and not any(_primera(c.get("nombre") or "") == "ETIQUETA" and "TERMICA" not in _norm(c.get("nombre")) for c in comps):
            add("E. Combo sin etiqueta de producto entre sus componentes", f"`{r}` {nombre}")
        if len(mp) == 1 and not es_equipo:  # un beaker de 100 mL lleva 1 unidad, no 100
            c = mp[0]
            q = presentacion(nombre, r)
            cant = float(c.get("cantidad") or 0)
            if q and abs(cant - q) > 0.011 * q:
                add("C. La cantidad de materia prima no coincide con la presentación",
                    f"`{r}` {nombre} → descuenta **{cant:g}** de `{c.get('codigo')}` (la presentación dice {q:g})")
            if _toks(nombre) and _toks(c.get("nombre") or "") and not (_toks(nombre) & _toks(c.get("nombre") or "")):
                add("D. La materia prima del combo no se parece a su nombre (revisar a ojo)",
                    f"`{r}` {nombre} → `{c.get('codigo')}` {c.get('nombre')}")
        if " " not in nombre.strip() and _norm(nombre) == _norm(r.replace("C-", "")):
            add("G. El nombre del combo es su propio código", f"`{r}` {nombre}")

    for r, v in sorted(prods.items()):
        if r.upper().startswith("C-") and not es_empaque(v.get("name") or ""):
            add("I. SKU de venta `C-…` creado como producto simple y no como combo — se vende sin descontar materia prima ni empaque",
                f"`{r}` {v.get('name')}")

    docs = documentos_por_titulo()
    materias = {r: v for r, v in prods.items() if es_materia_prima(r, v.get("name") or "")}
    filas = []
    for r, v in sorted(materias.items(), key=lambda x: _norm(x[1].get("name") or "")):
        d = mejor_documento(r, v.get("name") or "", docs)
        filas.append({"ref": r, "nombre": v.get("name") or "", "combos": sorted(usos.get(r, [])),
                      "doc": d["estado"] if d else "—", "archivo": d["archivo"] if d else ""})
    grupos = collections.defaultdict(list)
    for r, v in materias.items():
        grupos[frozenset(_toks(v.get("name") or ""))].append(r)
    for t, rs in grupos.items():
        if t and len(rs) > 1 and not any(x.upper().startswith("FOR-") for x in rs):
            add("H. Posible materia prima duplicada (mismo nombre, dos códigos)", " / ".join(f"`{x}`" for x in sorted(rs)) + f" — {materias[rs[0]].get('name')}")
    return {"kits": len(kits), "productos": len(prods), "materias": filas, "hallazgos": hall}


def escribir(res: dict) -> None:
    m = res["materias"]
    cuenta = collections.Counter(f["doc"] for f in m)
    L = ["# Auditoría de catálogo — inventario ↔ combos ↔ documentos técnicos", "",
         f"Generado por `scripts/auditar_catalogo_combos.py` el {datetime.now():%Y-%m-%d %H:%M}. No editar a mano.",
         "", f"**{res['productos']} productos · {res['kits']} combos · {len(m)} materias primas a granel.**",
         "", "La ficha técnica se hace **una vez por materia prima** (producto de inventario); sus combos `C-…` la heredan.", "",
         "## Errores de estructura en los combos", ""]
    if not res["hallazgos"]:
        L.append("Sin hallazgos.")
    for t, l in res["hallazgos"].items():
        L += [f"### {t} ({len(l)})", ""] + [f"- {x}" for x in l] + [""]
    L += ["## Estado documental por materia prima", "",
          "| Estado | Materias primas |", "|---|---|"] + [f"| {k} | {cuenta.get(k, 0)} |" for k in _ORDEN_DOC + ["—"]] + [""]
    L += ["| Código inventario | Materia prima | Combos que la usan | Documento | Archivo |", "|---|---|---|---|---|"]
    for f in m:
        L.append(f"| `{f['ref']}` | {f['nombre']} | {len(f['combos'])}{' — sin publicar' if not f['combos'] else ''} | {f['doc']} | {f['archivo']} |")
    SALIDA.write_text("\n".join(L) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    res = auditar()
    escribir(res)
    if a.json:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    else:
        print(f"{res['productos']} productos · {res['kits']} combos · {len(res['materias'])} materias primas")
        for t, l in res["hallazgos"].items():
            print(f"  {len(l):3d}  {t}")
        print("→", SALIDA)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
