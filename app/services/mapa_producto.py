# -*- coding: utf-8 -*-
"""Mapa del sistema y anatomía de combos — Sistemas → Mapa del sistema / Inventario → Combos.

Responde dos preguntas que hasta ahora solo se podían contestar abriendo archivos:

  * **¿De qué está hecho un combo y qué le falta?** Un combo de venta (`type=kit` en
    Alegra, p. ej. `C-CREMON500g`) son gramos de materia prima + empaque + etiqueta.
    Alrededor cuelgan el documento técnico, el código EAN, el diseño de etiqueta y la
    publicación. Cada una de esas piezas vive en un almacén distinto y se une con una
    llave distinta; cuando una falta, nada lo avisa (el propionato de calcio tuvo
    documento completo durante semanas sin que pudiera nacer su etiqueta).
  * **¿Dónde se corta la cadena?** El mismo cruce, agregado: cuántos productos pasan
    cada eslabón y cuáles se quedan, más el ciclo de las solicitudes de pago.

Solo lectura, sin LLM y sin llamar a Alegra ni a MeLi: lee la copia local del
catálogo (`alegra_catalogo_db`), los YAML de `fichas_word/datos`, el catálogo de EAN,
el almacén de etiquetas, el índice de PNG y `cache.json` de la web.

Las reglas de qué es empaque, qué es materia prima y cómo se empareja un documento
NO se repiten acá: se cargan de `scripts/auditar_catalogo_combos.py`, que es donde el
equipo las ha ido afinando (plurales, «ALMENDRA … CAJA X 22 KG», etc.).
"""
from __future__ import annotations

import importlib.util
import json
import re
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
_EAN_JSON = REPO / "app" / "data" / "etiquetas_codigos_ean.json"
_ETIQUETAS_JSON = REPO / "app" / "data" / "etiquetas_fichas.json"
_PNG_JSON = REPO / "app" / "data" / "etiquetas_recursos_png.json"
_CACHE_WEB = REPO / "PAGINA_WEB" / "site" / "data" / "cache.json"

_TTL_S = 90
_lock = threading.Lock()
_memo: dict[str, Any] = {"t": 0.0, "data": None}
_etq_memo: dict[str, Any] = {"mtime": 0.0, "data": None}

# Casilla del «inventario» en la que cae cada componente, por la primera palabra.
_CASILLAS = (
    ("etiqueta", {"ETIQUETA", "STICKER"}),
    ("bolsa", {"BOLSA", "DOYPACK", "SOBRE"}),
    ("envase", {"ENVASE", "ENV", "FRASCO", "TARRO", "POTE", "GOTERO", "ATOMIZADOR", "PASTILLERO", "FARMA"}),
    ("tapa", {"TAPA", "TAPON", "VALVULA", "LINER", "LINNER", "SELLO", "BANDA", "DISPENSADOR", "SPRAY"}),
    ("accesorio", {"CUCHARA", "PIPETA", "PERA"}),
    ("proteccion", {"PAPEL", "VINIPEL", "PLASTICO", "CINTA", "ZUNCHO", "CAJA", "ROLLO"}),
    ("operacion", {"OPERATIVOS", "SERVICIO"}),
)

_DOC_OK = {"TDS+COA+SDS", "TDS+COA", "TDS"}


def _auditoria():
    """El módulo de auditoría, cargado por ruta (scripts/ no es un paquete)."""
    ruta = REPO / "scripts" / "auditar_catalogo_combos.py"
    spec = importlib.util.spec_from_file_location("_auditar_catalogo_combos", ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def _leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return defecto


def _etiquetas_ligeras() -> list[dict]:
    """Las etiquetas sin su `logoUrl` (184 KB de data-URI cada una: el archivo pesa
    42 MB y casi todo es el mismo logo repetido). Se cachea por mtime."""
    try:
        mtime = _ETIQUETAS_JSON.stat().st_mtime
    except OSError:
        return []
    if _etq_memo["data"] is not None and _etq_memo["mtime"] == mtime:
        return _etq_memo["data"]
    crudas = (_leer_json(_ETIQUETAS_JSON, {}) or {}).get("fichas") or []
    out = []
    for f in crudas:
        d = f.get("data") or {}
        out.append({
            "id": f.get("id"),
            "nombre": f.get("nombre") or "",
            "categoria": f.get("categoria") or "",
            "actualizado": f.get("actualizado") or "",
            "barcode": (d.get("barcode") or "").strip(),
            "ficha_tecnica_id": (d.get("fichaTecnicaId") or "").strip(),
        })
    _etq_memo.update(mtime=mtime, data=out)
    return out


def _casilla(nombre: str, es_mp: bool) -> str:
    if es_mp:
        return "materia_prima"
    primera = (_norm(nombre).split() or [""])[0]
    for casilla, palabras in _CASILLAS:
        if primera in palabras:
            return casilla
    return "otro"


def _eslabon(estado: str, titulo: str, detalle: str, **extra) -> dict:
    """estado: ok | aviso | falta."""
    return {"estado": estado, "titulo": titulo, "detalle": detalle, **extra}


def _construir() -> dict:
    A = _auditoria()
    cat = A.cargar_catalogo()
    docs = A.documentos_por_titulo()

    ean_por_sku = {}
    for e in (_leer_json(_EAN_JSON, {}) or {}).get("codigos") or []:
        sku = (e.get("sku") or "").strip().upper()
        if sku:
            ean_por_sku[sku] = e

    etiquetas = _etiquetas_ligeras()
    etq_por_barcode = {e["barcode"]: e for e in etiquetas if e["barcode"]}
    etq_por_doc = {}
    for e in etiquetas:
        if e["ficha_tecnica_id"]:
            etq_por_doc.setdefault(e["ficha_tecnica_id"], []).append(e)
    etq_por_nombre = {_norm(e["nombre"]): e for e in etiquetas}

    png_por_nombre = {}
    for r in (_leer_json(_PNG_JSON, {}) or {}).get("recursos") or []:
        nombre = r.get("nombre") or ""
        png_por_nombre[_norm(Path(nombre).stem)] = nombre

    web = {}
    cache = _leer_json(_CACHE_WEB, {}) or {}
    for sec in cache.get("sections") or []:
        for p in sec.get("products") or []:
            web[(p.get("ref") or "").strip().upper()] = {**p, "_linea": sec.get("name")}
    for p in cache.get("combos") or []:
        web.setdefault((p.get("ref") or "").strip().upper(), {**p, "_linea": p.get("cat")})

    combos = []
    for ref, k in sorted(cat.items()):
        if k.get("type") != "kit":
            continue
        nombre = k.get("name") or ""
        comps_raw = k.get("componentes") or []
        comps = []
        for c in comps_raw:
            cn = c.get("nombre") or ""
            es_mp = not A.es_empaque(cn) and A._primera(cn) not in A._NO_MATERIA
            comps.append({
                "codigo": c.get("codigo") or "",
                "nombre": cn,
                "cantidad": float(c.get("cantidad") or 0),
                "casilla": _casilla(cn, es_mp),
                "existe": bool(c.get("codigo")) and c.get("codigo") in cat,
            })
        mp = [c for c in comps if c["casilla"] == "materia_prima"]

        esl: dict[str, dict] = {}

        # 1. Receta: componentes y materia prima
        if not comps:
            esl["receta"] = _eslabon("falta", "Receta", "Combo sin componentes: al venderse no descuenta inventario ni tiene costo.")
        elif not mp:
            esl["receta"] = _eslabon("falta", "Receta", "Solo lleva empaque: el producto vendido no se descuenta de inventario.")
        else:
            avisos = []
            for c in comps:
                if not c["existe"]:
                    avisos.append(f"`{c['codigo']}` ya no existe como producto activo")
            if len(mp) == 1:
                q = A.presentacion(nombre, ref)
                if q and abs(mp[0]["cantidad"] - q) > 0.011 * q:
                    avisos.append(f"descuenta {mp[0]['cantidad']:g} y la presentación dice {q:g}")
            esl["receta"] = _eslabon("aviso" if avisos else "ok", "Receta",
                                     "; ".join(avisos) if avisos else f"{len(mp)} materia prima + {len(comps) - len(mp)} de empaque.")

        # 2. Etiqueta física dentro de la receta
        tiene_etq_fisica = any(c["casilla"] == "etiqueta" and "TERMICA" not in _norm(c["nombre"]) for c in comps)
        esl["etiqueta_fisica"] = _eslabon(
            "ok" if tiene_etq_fisica else "aviso", "Etiqueta en la receta",
            "La receta descuenta una etiqueta por unidad." if tiene_etq_fisica
            else "La receta no incluye etiqueta: se imprime pero no se descuenta ni se costea.")

        # 3. Documento técnico (describe la materia prima; el combo lo hereda)
        doc = None
        for c in mp:
            doc = A.mejor_documento(c["codigo"], c["nombre"], docs)
            if doc:
                break
        if not doc:
            doc = A.mejor_documento(ref, nombre, docs)
        if doc:
            por_sku = bool(doc.get("referencia")) and any(doc["referencia"].lower() == c["codigo"].lower() for c in mp)
            estado = "ok" if doc["estado"] in _DOC_OK else "aviso"
            detalle = doc["estado"] + (" · unido por SKU" if por_sku else " · unido por parecido de nombre (el documento no declara SKU)")
            if estado == "ok" and not por_sku:
                estado = "aviso"
            esl["documento"] = _eslabon(estado, "Documento técnico", detalle,
                                        archivo=doc["archivo"], doc_titulo=doc["titulo"], por_sku=por_sku)
        else:
            esl["documento"] = _eslabon("falta", "Documento técnico", "No hay ficha, COA ni SDS para su materia prima.")

        # 4. Código EAN (se genera por SKU de venta)
        ean = ean_por_sku.get(ref.upper())
        if ean:
            esl["ean"] = _eslabon("ok", "Código EAN", str(ean.get("codigo") or ""), codigo=ean.get("codigo"))
        else:
            esl["ean"] = _eslabon("falta", "Código EAN", "Sin código de barras: el generador de etiquetas en lote lo salta.")

        # 5. Diseño de etiqueta
        etq = etq_por_barcode.get(str(ean.get("codigo"))) if ean else None
        via = "código de barras"
        if not etq and doc:
            cand = etq_por_doc.get(Path(doc["archivo"]).stem) or []
            if cand:
                pres = _norm(nombre).split()[-1:] or [""]
                etq = next((e for e in cand if pres[0] and pres[0] in _norm(e["nombre"]).split()), None)
                via = "documento (sin código)"
        if not etq:
            etq = etq_por_nombre.get(_norm(nombre))
            via = "nombre"
        png = png_por_nombre.get(_norm(nombre)) or png_por_nombre.get(_norm(nombre).replace(" ", ""))
        if etq:
            esl["etiqueta"] = _eslabon("ok" if via == "código de barras" else "aviso", "Diseño de etiqueta",
                                       f"«{etq['nombre']}» · unida por {via}", etiqueta_id=etq["id"], png=png)
        else:
            motivo = "no tiene código EAN" if not ean else "nadie la ha diseñado"
            esl["etiqueta"] = _eslabon("falta", "Diseño de etiqueta", f"Sin etiqueta: {motivo}.", png=png)

        # 6. Publicación
        w = web.get(ref.upper())
        if w:
            esl["publicacion"] = _eslabon("ok", "Publicación", f"Web + MeLi {w.get('meli_id') or '—'}",
                                          meli_id=w.get("meli_id"), foto=w.get("photo"), linea=w.get("_linea"),
                                          precio=w.get("precio_num"))
        else:
            esl["publicacion"] = _eslabon("aviso", "Publicación", "No aparece en la vitrina web.")

        # Qué destraba cada ranura. La acción solo se ofrece cuando tiene sentido: no se
        # genera código para un combo con la receta rota (el equipo los dejó sin código a
        # propósito el 2026-09-19: precio $1, cantidades erradas, duplicados).
        if esl["receta"]["estado"] == "falta":
            esl["receta"]["accion"] = {"tipo": "corregir_alegra"}
        if esl["ean"]["estado"] == "falta" and esl["receta"]["estado"] != "falta":
            esl["ean"]["accion"] = {"tipo": "generar_ean"}
        if esl["etiqueta"]["estado"] == "falta" and esl["ean"]["estado"] == "ok":
            esl["etiqueta"]["accion"] = {"tipo": "disenar_etiqueta"}
        if esl["documento"]["estado"] == "falta":
            esl["documento"]["accion"] = {"tipo": "crear_documento"}
        elif (doc and not esl["documento"].get("por_sku") and len(mp) == 1 and not doc.get("referencia")
              and mp[0]["existe"] and mp[0]["nombre"].strip()):
            esl["documento"]["accion"] = {"tipo": "fijar_sku", "sku": mp[0]["codigo"], "mp_nombre": mp[0]["nombre"],
                                          "archivo": doc["archivo"], "doc_titulo": doc["titulo"]}

        estados = [e["estado"] for e in esl.values()]
        combos.append({
            "ref": ref,
            "nombre": nombre,
            "precio_lista": k.get("precio_lista"),
            "foto": (w or {}).get("photo"),
            "linea": (w or {}).get("_linea") or "",
            "componentes": comps,
            "eslabones": esl,
            "ok": estados.count("ok"),
            "avisos": estados.count("aviso"),
            "faltas": estados.count("falta"),
        })

    # Documentos huérfanos: existen pero ningún combo llega a ellos (el caso propionato).
    usados = {c["eslabones"]["documento"].get("archivo") for c in combos}
    huerfanos = [
        {"archivo": d["archivo"], "titulo": d["titulo"], "estado": d["estado"], "referencia": d["referencia"]}
        for d in docs
        if d["archivo"] not in usados and d["estado"] != "vacía"
    ]

    return {"combos": combos, "docs_huerfanos": huerfanos, "total_docs": len(docs),
            "total_etiquetas": len(etiquetas), "total_ean": len(ean_por_sku),
            "generado": time.strftime("%Y-%m-%dT%H:%M:%S")}


def _datos(refrescar: bool = False) -> dict:
    with _lock:
        if not refrescar and _memo["data"] is not None and time.time() - _memo["t"] < _TTL_S:
            return _memo["data"]
        data = _construir()
        _memo.update(t=time.time(), data=data)
        return data


def anatomia_combos(buscar: str = "", filtro: str = "", refrescar: bool = False) -> dict:
    """Lista de combos con sus piezas y eslabones. filtro: rotos | sin_etiqueta | sin_documento | sin_ean | sanos."""
    data = _datos(refrescar)
    combos = data["combos"]
    q = _norm(buscar)
    if q:
        combos = [c for c in combos if q in _norm(c["nombre"]) or q in _norm(c["ref"])]
    if filtro == "rotos":
        combos = [c for c in combos if c["faltas"]]
    elif filtro == "sanos":
        combos = [c for c in combos if not c["faltas"] and not c["avisos"]]
    elif filtro in ("sin_etiqueta", "sin_documento", "sin_ean"):
        clave = {"sin_etiqueta": "etiqueta", "sin_documento": "documento", "sin_ean": "ean"}[filtro]
        combos = [c for c in combos if c["eslabones"][clave]["estado"] == "falta"]
    todos = data["combos"]
    return {
        "combos": combos,
        "total": len(todos),
        "conteo": {
            "rotos": sum(1 for c in todos if c["faltas"]),
            "sanos": sum(1 for c in todos if not c["faltas"] and not c["avisos"]),
            "sin_etiqueta": sum(1 for c in todos if c["eslabones"]["etiqueta"]["estado"] == "falta"),
            "sin_documento": sum(1 for c in todos if c["eslabones"]["documento"]["estado"] == "falta"),
            "sin_ean": sum(1 for c in todos if c["eslabones"]["ean"]["estado"] == "falta"),
        },
        "generado": data["generado"],
    }


def mapa_sistema(refrescar: bool = False) -> dict:
    """Nodos y tramos del flujo con conteos vivos: cuántos pasan cada eslabón y cuáles se quedan."""
    data = _datos(refrescar)
    combos = data["combos"]
    n = len(combos)

    def tramo(clave: str) -> dict:
        ok = [c for c in combos if c["eslabones"][clave]["estado"] == "ok"]
        aviso = [c for c in combos if c["eslabones"][clave]["estado"] == "aviso"]
        falta = [c for c in combos if c["eslabones"][clave]["estado"] == "falta"]
        return {
            "ok": len(ok), "aviso": len(aviso), "falta": len(falta), "total": n,
            "atascados": [{"ref": c["ref"], "nombre": c["nombre"], "estado": c["eslabones"][clave]["estado"],
                           "detalle": c["eslabones"][clave]["detalle"]} for c in falta + aviso][:400],
        }

    producto = [
        {"id": "receta", "titulo": "Combo en Alegra", "sub": "materia prima + empaque", **tramo("receta")},
        {"id": "documento", "titulo": "Documento técnico", "sub": "TDS · COA · SDS", **tramo("documento")},
        {"id": "ean", "titulo": "Código EAN", "sub": "por SKU de venta", **tramo("ean")},
        {"id": "etiqueta", "titulo": "Diseño de etiqueta", "sub": "Studio visual", **tramo("etiqueta")},
        {"id": "publicacion", "titulo": "Publicación", "sub": "web + MeLi", **tramo("publicacion")},
    ]

    pagos: dict = {"por_estado": {}}
    try:
        from app.services import pagos_wizard

        pagos = pagos_wizard.resumen()
    except Exception as exc:  # la contabilidad puede no estar disponible en un entorno de pruebas
        pagos = {"por_estado": {}, "error": str(exc)}

    ciclo_pago = [
        {"id": "borrador", "titulo": "Borrador", "quien": "quien solicita"},
        {"id": "pendiente", "titulo": "Pendiente", "quien": "espera aprobación"},
        {"id": "aprobada", "titulo": "Aprobada", "quien": "nace el asiento + espejo Alegra"},
        {"id": "en_banco", "titulo": "En el banco", "quien": "token 1: quien aprobó lo monta"},
        {"id": "pagada", "titulo": "Pagada", "quien": "token 2: otro admin confirma con el comprobante"},
    ]
    for paso in ciclo_pago:
        e = (pagos.get("por_estado") or {}).get(paso["id"]) or {}
        paso["n"] = int(e.get("n") or 0)
        paso["total"] = float(e.get("total") or 0)
    fuera = {k: v for k, v in (pagos.get("por_estado") or {}).items() if k in ("rechazada", "anulada")}

    return {
        "producto": producto,
        "docs_huerfanos": data["docs_huerfanos"],
        "ciclo_pago": ciclo_pago,
        "pagos_fuera": fuera,
        "totales": {"combos": n, "documentos": data["total_docs"], "etiquetas": data["total_etiquetas"],
                    "ean": data["total_ean"]},
        "generado": data["generado"],
    }


# ─── Acciones: lo que destraba una ranura vacía ──────────────────────────────

def invalidar() -> None:
    """Tras escribir algo, la próxima lectura se recalcula."""
    with _lock:
        _memo.update(t=0.0, data=None)


def proponer_ean(ref: str) -> dict:
    """Valores para crear el código de un combo con el MISMO endpoint del panel de códigos
    (`POST /api/etiquetas/codigos-ean`): acá solo se propone, no se escribe."""
    from app.tools import etiquetas_codigos_ean as E

    combo = next((c for c in _datos()["combos"] if c["ref"].upper() == (ref or "").strip().upper()), None)
    if not combo:
        raise ValueError("Ese combo no existe en la copia local de Alegra")
    if combo["eslabones"]["ean"]["estado"] == "ok":
        raise ValueError("Ese combo ya tiene código")
    if combo["eslabones"]["receta"]["estado"] == "falta":
        raise ValueError("La receta del combo está rota en Alegra: corrígela antes de gastarle un código")
    codigos = (_leer_json(_EAN_JSON, {}) or {}).get("codigos") or []
    numero = E.siguiente_numero_producto(int(c.get("numero_producto") or 0) for c in codigos)
    if numero is None:
        raise ValueError("No quedan números de producto libres (1-900)")
    presentacion = E.presentacion_ean_desde_sku(combo["ref"], combo["nombre"])
    anio, bimestre = E.anio_bimestre_actual()
    d12 = f"770{numero:03d}{presentacion}{anio:02d}{bimestre}"
    check = (10 - sum(int(ch) * (3 if i % 2 else 1) for i, ch in enumerate(d12)) % 10) % 10
    return {"sku": combo["ref"], "nombre_producto": combo["nombre"], "numero_producto": numero,
            "presentacion": presentacion, "anio": anio, "bimestre": bimestre, "codigo_previsto": f"{d12}{check}"}


def propuestas_sku() -> dict:
    """Documentos que hoy se unen a su materia prima por parecido de nombre y podrían
    unirse por SKU. Una fila por documento; `exacto` = los nombres son idénticos."""
    por_doc: dict[str, dict] = {}
    for c in _datos()["combos"]:
        a = c["eslabones"]["documento"].get("accion") or {}
        if a.get("tipo") != "fijar_sku":
            continue
        fila = por_doc.setdefault(a["archivo"], {"archivo": a["archivo"], "doc_titulo": a["doc_titulo"],
                                                 "candidatos": {}, "combos": []})
        fila["candidatos"][a["sku"]] = a["mp_nombre"]
        fila["combos"].append(c["ref"])
    filas = []
    for f in por_doc.values():
        cands = f.pop("candidatos")
        f["conflicto"] = len(cands) > 1  # dos materias primas distintas reclaman el mismo documento
        f["sku"], f["mp_nombre"] = next(iter(cands.items()))
        f["otros"] = [{"sku": s, "mp_nombre": n} for s, n in list(cands.items())[1:]]
        f["exacto"] = not f["conflicto"] and _norm(f["doc_titulo"]) == _norm(re.sub(r"\s+(G|ML|UN|KG)$", "", _norm(f["mp_nombre"])))
        filas.append(f)
    filas.sort(key=lambda x: (x["conflicto"], not x["exacto"], x["doc_titulo"]))
    return {"propuestas": filas, "total": len(filas),
            "exactas": sum(1 for f in filas if f["exacto"]), "conflictos": sum(1 for f in filas if f["conflicto"])}


def fijar_sku_documento(archivo: str, sku: str) -> dict:
    """Escribe `referencia: <sku>` en el YAML del documento — y nada más.

    Edita UNA línea (no re-serializa el archivo: `yaml.dump` reordenaría comentarios y
    bloques de texto de 248 documentos). Respaldo previo, y si al releer cambió algo
    distinto de `referencia`, se restaura. No pisa una referencia ya declarada.
    """
    import shutil

    import yaml

    from app.services import ficha_tecnica as ft

    archivo = (archivo or "").strip()
    sku = (sku or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.yaml", archivo):
        raise ValueError("Nombre de documento inválido")
    if not re.fullmatch(r"[A-Za-z0-9._-]{2,40}", sku):
        raise ValueError("SKU inválido")
    ruta = ft.DATOS_DIR / archivo
    if not ruta.is_file():
        raise ValueError("Ese documento no existe")
    from app.services import alegra_catalogo_db as ac

    item = ac.obtener_item(sku)
    if not item or item.get("type") == "kit":
        raise ValueError(f"`{sku}` no es un producto de inventario activo en Alegra (la referencia es la materia prima, no el combo)")

    texto = ruta.read_text(encoding="utf-8")
    antes = yaml.safe_load(texto) or {}
    actual = str(antes.get("referencia") or "").strip()
    if actual and actual.lower() != sku.lower():
        raise ValueError(f"El documento ya declara `{actual}`: no se pisa")
    if actual.lower() == sku.lower():
        return {"ok": True, "archivo": archivo, "sku": sku, "sin_cambios": True}

    linea = f"referencia: {sku}"
    if re.search(r"^referencia:.*$", texto, flags=re.M):
        nuevo = re.sub(r"^referencia:.*$", linea, texto, count=1, flags=re.M)
    else:
        m = re.search(r"^(nombre_producto|titulo):.*$", texto, flags=re.M)
        if not m:
            raise ValueError("El documento no tiene `titulo` ni `nombre_producto` donde anclar la referencia")
        nuevo = texto[: m.end()] + "\n" + linea + texto[m.end():]

    despues = yaml.safe_load(nuevo) or {}
    if {k: v for k, v in despues.items() if k != "referencia"} != {k: v for k, v in antes.items() if k != "referencia"} \
            or str(despues.get("referencia")) != sku:
        raise ValueError("La edición habría cambiado algo más que `referencia`: no se escribió")

    respaldo = ft.DATOS_DIR / "_respaldo_referencia"
    respaldo.mkdir(exist_ok=True)
    shutil.copy2(ruta, respaldo / f"{ruta.stem}.{time.strftime('%Y%m%d_%H%M%S')}.yaml")
    ruta.write_text(nuevo, encoding="utf-8")
    invalidar()
    return {"ok": True, "archivo": archivo, "sku": sku}
