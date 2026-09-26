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
_STOCK_JSON = Path(__file__).resolve().parents[1] / "data" / "siigo_stock_cache.json"
_ETIQUETAS_JSON = REPO / "app" / "data" / "etiquetas_fichas.json"
_PNG_JSON = REPO / "app" / "data" / "etiquetas_recursos_png.json"
# «Terminar y aprobar» del editor: el PNG de impresión y el digital de cada etiqueta
# (lo escribe POST /api/etiquetas/recursos-png con `etiqueta_id`, en routes.py).
_APROBADOS_JSON = REPO / "app" / "data" / "etiquetas_png_aprobados.json"
# La biblioteca de PNG (misma carpeta que `_carpeta_png_recursos_etiquetas` en routes.py).
_PNG_DIR = Path("~/Documentos/Etiquetas McKenna/Recursos PNG").expanduser()
_CACHE_WEB = REPO / "PAGINA_WEB" / "site" / "data" / "cache.json"
# Combos que no necesitan documento técnico (empaques sueltos, accesorios, kits de regalo…):
# lo marca una persona en el taller y la pieza cuenta como completa. Por combo, no por
# materia prima: cada publicación se decide por separado.
_DOC_NO_REQUERIDO_JSON = REPO / "app" / "data" / "documento_no_requerido.json"

_TTL_S = 90
_lock = threading.Lock()
_memo: dict[str, Any] = {"t": 0.0, "data": None}
_etq_memo: dict[str, Any] = {"mtime": 0.0, "data": None}
_memo_matriz: dict[str, Any] = {"t": 0.0, "data": None}

# Casilla del «inventario» en la que cae cada componente, por la primera palabra.
_CASILLAS = (
    ("etiqueta", {"ETIQUETA", "STICKER"}),
    ("bolsa", {"BOLSA", "DOYPACK", "SOBRE"}),
    ("envase", {"ENVASE", "ENV", "FRASCO", "TARRO", "POTE", "GOTERO", "ATOMIZADOR", "PASTILLERO", "FARMA", "BALA"}),
    ("tapa", {"TAPA", "TAPON", "VALVULA", "LINER", "LINNER", "SELLO", "BANDA", "DISPENSADOR", "SPRAY"}),
    ("accesorio", {"CUCHARA", "PIPETA", "PERA"}),
    ("proteccion", {"PAPEL", "VINIPEL", "PLASTICO", "CINTA", "ZUNCHO", "CAJA", "ROLLO"}),
    ("operacion", {"OPERATIVOS", "SERVICIO"}),
)

_DOC_OK = {"TDS+COA+SDS", "TDS+COA", "TDS"}


_memo_auditoria: dict = {"firma": None, "mod": None}


def _auditoria():
    """El módulo de auditoría, cargado por ruta (scripts/ no es un paquete).

    Se vuelve a cargar solo si el script cambió: así sus reglas nuevas aplican sin reiniciar
    y no se pierde la memoria de YAML que guarda (`_DOCS_MEMO`)."""
    ruta = REPO / "scripts" / "auditar_catalogo_combos.py"
    st = ruta.stat()
    firma = (st.st_mtime_ns, st.st_size)
    if _memo_auditoria["mod"] is None or _memo_auditoria["firma"] != firma:
        spec = importlib.util.spec_from_file_location("_auditar_catalogo_combos", ruta)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        _memo_auditoria.update(firma=firma, mod=mod)
    return _memo_auditoria["mod"]


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
            "tipo_nombre": f.get("tipo_nombre") or "",
            "plantilla_id": f.get("plantilla_id") or "",
            "actualizado": f.get("actualizado") or "",
            "barcode": (d.get("barcode") or "").strip(),
            "ficha_tecnica_id": (d.get("fichaTecnicaId") or "").strip(),
        })
    _etq_memo.update(mtime=mtime, data=out)
    return out


def _clave_archivo(titulo: str) -> str:
    """El nombre de archivo que el editor da al PNG (`nombreArchivoDesdeTitulo`, en
    desktop/src/lib/fichaTecnicaMatch.ts), en minúsculas para comparar."""
    s = unicodedata.normalize("NFD", titulo or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").strip()
    s = re.sub(r"\s+", "_", s)
    return re.sub(r"[^A-Za-z0-9_\-]+", "", s)[:60].lower()


def _png_aprobados_en_disco() -> dict[str, dict[str, str]]:
    """Los PNG aprobados antes de que el editor registrara la etiqueta al aprobar:
    {clave de título: {"impresion": ruta, "digital": ruta}}, el más reciente de cada uno
    (las copias `…_2.png` que dejaba volver a aprobar cuentan como el mismo archivo)."""
    mejor: dict[str, dict[str, tuple[float, str]]] = {}
    for sub, variante in (("ETIQUETAS STUDIO", "impresion"), ("PUBLICACIONES DIGITALES", "digital")):
        raiz = _PNG_DIR / sub
        if not raiz.is_dir():
            continue
        for f in raiz.rglob("*.png"):
            stem = re.sub(r"_\d+$", "", f.stem)
            es_digital = stem.lower().endswith("_digital")
            if es_digital != (variante == "digital"):
                continue
            if es_digital:
                stem = stem[: -len("_digital")]
            try:
                mt = f.stat().st_mtime
            except OSError:
                continue
            fila = mejor.setdefault(stem.lower(), {})
            if variante not in fila or mt > fila[variante][0]:
                fila[variante] = (mt, f.relative_to(_PNG_DIR).as_posix())
    return {k: {v: r for v, (_mt, r) in fila.items()} for k, fila in mejor.items()}


def _es_inventario_activo(cat: dict, ref: str) -> bool:
    """¿`ref` es hoy un producto de inventario (no un combo) en la copia local de Alegra?"""
    ref = (ref or "").strip().lower()
    if not ref:
        return False
    item = next((v for k, v in cat.items() if k.lower() == ref), None)
    return bool(item) and item.get("type") != "kit"


def _estado_foto(w: dict | None, etq: dict | None) -> tuple[str, str, str]:
    """¿La foto con la que se vende está al día? → (estado, fecha AAAA-MM, por qué).

    sin_foto · prestada (la vitrina la tomó de OTRA publicación por parecido de nombre) ·
    anterior_a_etiqueta (la foto se subió antes del último rediseño de la etiqueta, así que
    muestra la etiqueta vieja) · ok. La fecha sale del nombre del archivo de MeLi (`…_072026-O.jpg`).
    """
    foto = (w or {}).get("photo") or ""
    if not foto:
        return "sin_foto", "", "No tiene foto en la vitrina."
    m = re.search(r"_(\d{2})(20\d{2})-", foto)
    fecha = f"{m.group(2)}-{m.group(1)}" if m else ""
    if (w or {}).get("photo_match_type") == "identity":
        return "prestada", fecha, "La foto no es de esta presentación: la vitrina la tomó de otra publicación por parecido de nombre."
    rediseno = ((etq or {}).get("actualizado") or "")[:7]
    if fecha and rediseno and fecha < rediseno:
        return "anterior_a_etiqueta", fecha, f"La foto es de {fecha} y la etiqueta se rediseñó en {rediseno}: muestra la etiqueta anterior."
    return "ok", fecha, ""


def _casilla(nombre: str, es_mp: bool) -> str:
    if es_mp:
        return "materia_prima"
    primera = (_norm(nombre).split() or [""])[0]
    for casilla, palabras in _CASILLAS:
        if primera in palabras:
            return casilla
    return "otro"


# Bolsas del despacho (van por fuera, con la guía): no dicen en qué se guarda el producto.
_BOLSA_ENVIO = {"SEGURIDAD", "PORTAGUIA"}


def _recipiente(comps: list[dict]) -> str:
    """Cómo se nombra en la etiqueta lo que contiene el producto: «envase» si la receta lleva
    frasco, pote, farma, gotero, bala…; «empaque» si solo va en bolsa. Vacío si no se sabe."""
    if any(c["casilla"] == "envase" for c in comps):
        return "envase"
    if any(c["casilla"] == "bolsa" and not (_BOLSA_ENVIO & set(_norm(c["nombre"]).split())) for c in comps):
        return "empaque"
    return ""


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

    aprobados = (_leer_json(_APROBADOS_JSON, {}) or {}).get("etiquetas") or {}
    en_disco = _png_aprobados_en_disco()

    web = {}
    cache = _leer_json(_CACHE_WEB, {}) or {}
    for sec in cache.get("sections") or []:
        for p in sec.get("products") or []:
            web[(p.get("ref") or "").strip().upper()] = {**p, "_linea": sec.get("name")}
    for p in cache.get("combos") or []:
        web.setdefault((p.get("ref") or "").strip().upper(), {**p, "_linea": p.get("cat")})

    # Existencias de referencia: el caché que ya deja el panel de Inventario (Siigo, solo lectura).
    # Acá solo se lee el archivo; si no está, los componentes salen sin existencias.
    stock_ref = {str(c).lower(): v for c, v in ((_leer_json(_STOCK_JSON, {}) or {}).get("por_codigo") or {}).items()}

    no_requeridos = _no_requeridos()

    combos = []
    for ref, k in sorted(cat.items()):
        if k.get("type") != "kit":
            continue
        nombre = k.get("name") or ""
        comps_raw = k.get("componentes") or []
        comps = []
        for c in comps_raw:
            # Hay recetas cuyo componente llega SIN nombre en la copia local de Alegra: sin nombre
            # nada parece empaque y las diez piezas del kit salían como «materia prima» (con lo
            # que el combo no podía unir su documento). El nombre está en el catálogo, por código.
            cn = c.get("nombre") or (cat.get(c.get("codigo") or "") or {}).get("name") or ""
            es_mp = not A.es_empaque(cn) and A._primera(cn) not in A._NO_MATERIA
            en_cat = cat.get(c.get("codigo") or "") or {}
            existencias = (stock_ref.get((c.get("codigo") or "").lower()) or {}).get("stock_siigo")
            comps.append({
                "codigo": c.get("codigo") or "",
                "nombre": cn,
                "cantidad": float(c.get("cantidad") or 0),
                "casilla": _casilla(cn, es_mp),
                "existe": bool(c.get("codigo")) and c.get("codigo") in cat,
                "costo": float(en_cat.get("unit_cost") or 0),
                "existencias": existencias if isinstance(existencias, (int, float)) else None,
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
        mp_doc = None  # la materia prima a la que pertenece el documento encontrado
        for c in mp:
            doc = A.mejor_documento(c["codigo"], c["nombre"], docs)
            # Con varias «materias primas», un parecido de nombre que no tiene nada que ver con
            # el producto vendido no vale: la bolsa BOLTRA500gZIP se llama «SEMILLA GIRASOL g» en
            # Alegra y unía la sal ahumada, las nueces o las pasas al documento del girasol. Sin
            # documento, el taller ofrece crear uno desde cero.
            if doc and len(mp) > 1 and not _declara_sku(doc, c["codigo"]) and not A.mejor_documento("", nombre, [doc]):
                doc = None
            if doc:
                mp_doc = c
                break
        if not doc:
            doc = A.mejor_documento(ref, nombre, docs)
        exento = no_requeridos.get(ref.upper())
        if exento:
            quien = f" por {exento['por']}" if exento.get("por") else ""
            motivo = f": {exento['motivo']}" if exento.get("motivo") else ""
            esl["documento"] = _eslabon("ok", "Documento técnico",
                                        f"No requiere documento técnico (marcado{quien} el {exento.get('fecha', '')[:10]}){motivo}.",
                                        no_requiere=exento)
        elif doc:
            declarados = {x.lower() for x in [doc.get("referencia") or "", *doc.get("equivalentes", [])] if x}
            por_sku = any(c["codigo"].lower() in declarados for c in mp)
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
        # Los dos PNG de «Terminar y aprobar»: primero el registro por etiqueta; si la
        # etiqueta se aprobó antes de existir ese registro, por el nombre de archivo
        # (sale del título del código EAN, o del nombre de la etiqueta).
        png_digital = None
        aprobado_at = ""
        if etq:
            reg = aprobados.get(etq["id"]) or {}
            vivos = {v: (reg.get(v) or {}) for v in ("impresion", "digital")}
            vivos = {v: f for v, f in vivos.items() if f.get("nombre") and (_PNG_DIR / f["nombre"]).is_file()}
            if "impresion" not in vivos or "digital" not in vivos:
                for titulo in ((ean or {}).get("nombre_producto"), etq["nombre"], nombre):
                    viejo = en_disco.get(_clave_archivo(titulo or "")) if titulo else None
                    if viejo:
                        for v, ruta in viejo.items():
                            vivos.setdefault(v, {"nombre": ruta})
                        break
            png = (vivos.get("impresion") or {}).get("nombre") or png
            png_digital = (vivos.get("digital") or {}).get("nombre")
            aprobado_at = max((f.get("aprobado_at") or "" for f in vivos.values()), default="")
        if etq:
            esl["etiqueta"] = _eslabon("ok" if via == "código de barras" else "aviso", "Diseño de etiqueta",
                                       f"«{etq['nombre']}» · unida por {via}", etiqueta_id=etq["id"], png=png,
                                       png_digital=png_digital, aprobado_at=aprobado_at,
                                       tamano=etq.get("tipo_nombre") or "", plantilla_id=etq.get("plantilla_id") or "")
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
        # Las materias primas a las que se puede unir un documento (para elegirlo a mano también).
        mps = [{"codigo": c["codigo"], "nombre": c["nombre"]} for c in mp if c["existe"] and c["nombre"].strip()]
        # Primero la que se parece al producto vendido: «Asociar o redactar» busca con el nombre
        # de la primera, y la bolsa mal nombrada llevaba de la sal ahumada al girasol.
        mps.sort(key=lambda m: not (A._toks(m["nombre"]) & A._toks(nombre)))
        if esl["documento"].get("no_requiere"):
            pass
        elif esl["documento"]["estado"] == "falta":
            esl["documento"]["accion"] = {"tipo": "crear_documento", "mps": mps}
        elif doc and not esl["documento"].get("por_sku") and mps:
            # El documento se encontró por nombre. Tres casos, según lo que ya declare:
            #   fijar       no declara SKU → se escribe
            #   reemplazar  declara uno que no es un producto de inventario activo (viejo, mal
            #               tecleado o el código de un combo) → se corrige; antes se rechazaba
            #   compartir   declara OTRA materia prima activa → el documento sirve a las dos
            principal = mp_doc if mp_doc and mp_doc["existe"] else mp[0]
            actual = (doc.get("referencia") or "").strip()
            vigente = _es_inventario_activo(cat, actual)
            esl["documento"]["accion"] = {
                "tipo": "fijar_sku", "sku": principal["codigo"], "mp_nombre": principal["nombre"],
                "archivo": doc["archivo"], "doc_titulo": doc["titulo"], "mps": mps,
                "referencia_actual": actual,
                "modo": "fijar" if not actual else ("compartir" if vigente else "reemplazar"),
            }

        foto_estado, foto_fecha, foto_motivo = _estado_foto(w, etq)
        estados = [e["estado"] for e in esl.values()]
        combos.append({
            "ref": ref,
            "nombre": nombre,
            "precio_lista": k.get("precio_lista"),
            "foto": (w or {}).get("photo"),
            "foto_estado": foto_estado, "foto_fecha": foto_fecha, "foto_motivo": foto_motivo,
            "fotos": [f for f in ((w or {}).get("photos") or []) if isinstance(f, str)][:8]
                     if isinstance((w or {}).get("photos"), list) else [],
            # Un producto puede venderse en varias presentaciones (250 g, 500 g, 1 kg): todas
            # comparten materia prima —y por eso documento—, pero cada una es SU combo, con su
            # propio EAN, su propia etiqueta y su propia plantilla.
            # Solo con UNA materia prima: un kit de varias no es «otra presentación» de ninguna.
            "familia": (mp[0]["codigo"] if len(mp) == 1 else "") or (w or {}).get("family_slug") or "",
            "presentacion": (w or {}).get("presentacion_label") or "",
            "linea": (w or {}).get("_linea") or "",
            "componentes": comps,
            "recipiente": _recipiente(comps),
            "eslabones": esl,
            "ok": estados.count("ok"),
            "avisos": estados.count("aviso"),
            "faltas": estados.count("falta"),
        })

    # Documentos huérfanos: existen pero ningún combo llega a ellos (el caso propionato).
    usados = {c["eslabones"]["documento"].get("archivo") for c in combos}
    # Un combo exento no «usa» el documento que el parecido de nombre le habría encontrado,
    # pero tampoco lo deja huérfano: ese documento sigue siendo de su materia prima.
    for c in combos:
        if c["eslabones"]["documento"].get("no_requiere"):
            for m in c["componentes"]:
                if m["casilla"] == "materia_prima":
                    d = A.mejor_documento(m["codigo"], m["nombre"], docs)
                    if d:
                        usados.add(d["archivo"])
    huerfanos = [
        {"archivo": d["archivo"], "titulo": d["titulo"], "estado": d["estado"], "referencia": d["referencia"]}
        for d in docs
        if d["archivo"] not in usados and d["estado"] != "vacía"
    ]

    documentos = [{"archivo": d["archivo"], "titulo": d["titulo"], "estado": d["estado"],
                   "referencia": d["referencia"], "equivalentes": d.get("equivalentes", [])} for d in docs]
    return {"combos": combos, "docs_huerfanos": huerfanos, "documentos": documentos, "total_docs": len(docs),
            "total_etiquetas": len(etiquetas), "total_ean": len(ean_por_sku),
            "generado": time.strftime("%Y-%m-%dT%H:%M:%S")}


def _datos(refrescar: bool = False) -> dict:
    with _lock:
        if not refrescar and _memo["data"] is not None and time.time() - _memo["t"] < _TTL_S:
            return _memo["data"]
        data = _construir()
        _memo.update(t=time.time(), data=data)
        return data


def presentaciones_de(ref: str) -> list[str]:
    """SKU de venta del combo y de sus presentaciones hermanas (misma materia prima: 250 g, 500 g, kg).
    Comparten documento técnico, así que un visto bueno al documento vale para todas. Sin familia
    reconocible (kit con varias materias primas), solo el propio combo."""
    ref_u = (ref or "").strip().upper()
    if not ref_u:
        return []
    combos = _datos().get("combos") or []
    propio = next((c for c in combos if (c.get("ref") or "").upper() == ref_u), None)
    familia = (propio or {}).get("familia") or ""
    if not familia:
        return [ref.strip()]
    refs = [c["ref"] for c in combos if c.get("familia") == familia and c.get("ref")]
    return refs or [ref.strip()]


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


# ─── La misma cadena, vista desde lo que se COMPRÓ ───────────────────────────

_RELACION_MELI = REPO / "app" / "data" / "relacion_codigos_cache.json"
_COLS_PRODUCTO = ("combo", "documento", "ean", "etiqueta", "meli", "web")


def matriz_productos(refrescar: bool = False) -> dict:
    """Una fila por producto ADQUIRIDO (materia prima activa en Alegra) y una columna
    por eslabón. La unidad no es el combo: es lo que se compró, con su documento y
    sus presentaciones colgando. Así se ven también los comprados que nunca llegaron
    a tener combo, que en la vista por combos no existen.

    Estados: ok · parcial (algunos combos sí, otros no) · falta · na (aún no aplica).
    """
    with _lock:
        if not refrescar and _memo_matriz["data"] is not None and time.time() - _memo_matriz["t"] < _TTL_S:
            return _memo_matriz["data"]
    A = _auditoria()
    materias = A.auditar()["materias"]
    combos = {c["ref"]: c for c in _datos(refrescar)["combos"]}

    # MeLi se mide aparte de la web: un combo puede estar publicado allá y no acá.
    meli = set()
    for x in (_leer_json(_RELACION_MELI, {}) or {}).get("items") or []:
        sku = (x.get("sku_meli") or "").strip().upper()
        if sku:
            meli.add(sku)
    cache = _leer_json(_CACHE_WEB, {}) or {}
    web = {(p.get("ref") or "").strip().upper() for s in cache.get("sections") or [] for p in s.get("products") or []}
    web |= {(p.get("ref") or "").strip().upper() for p in cache.get("combos") or []}

    def agrega(vals: list[bool]) -> str:
        if not vals:
            return "na"
        return "ok" if all(vals) else ("parcial" if any(vals) else "falta")

    filas = []
    for m in materias:
        cs = [combos[r] for r in m["combos"] if r in combos]
        est = lambda c, k: c["eslabones"][k]["estado"]  # noqa: E731
        fila = {
            "ref": m["ref"], "nombre": m["nombre"], "combos": [c["ref"] for c in cs], "doc_estado": m["doc"],
            "combo": "falta" if not cs else ("ok" if all(est(c, "receta") == "ok" for c in cs) else "parcial"),
            # Si TODAS sus presentaciones están marcadas «no requiere documento», no le falta nada.
            "documento": "ok" if m["doc"] in _DOC_OK or (cs and all(c["eslabones"]["documento"].get("no_requiere") for c in cs))
                          else ("parcial" if m["doc"] != "—" else "falta"),
            "ean": agrega([est(c, "ean") == "ok" for c in cs]),
            "etiqueta": agrega([est(c, "etiqueta") != "falta" for c in cs]),
            "meli": agrega([c["ref"].upper() in meli for c in cs]),
            "web": agrega([c["ref"].upper() in web for c in cs]),
        }
        fila["completo"] = all(fila[k] == "ok" for k in _COLS_PRODUCTO)
        # Se vende (está en MeLi) sin etiqueta o sin documento listo: el cliente compra a ciegas.
        fila["se_vende_incompleto"] = fila["meli"] in ("ok", "parcial") and (fila["etiqueta"] != "ok" or fila["documento"] != "ok")
        filas.append(fila)

    embudo, vivos = [("adquiridos", len(filas))], filas
    for k in _COLS_PRODUCTO:
        vivos = [f for f in vivos if f[k] == "ok"]
        embudo.append((k, len(vivos)))
    data = {
        "filas": filas, "embudo": embudo, "total": len(filas),
        "completos": sum(1 for f in filas if f["completo"]),
        "sin_combo": sum(1 for f in filas if f["combo"] == "falta"),
        "se_venden_incompletos": sum(1 for f in filas if f["se_vende_incompleto"]),
        "generado": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with _lock:
        _memo_matriz.update(t=time.time(), data=data)
    return data


# ─── Acciones: lo que destraba una ranura vacía ──────────────────────────────

def recipientes() -> dict:
    """«envase» o «empaque» por código de barras y por etiqueta, según la receta del combo.
    Si una etiqueta sirve a combos que no coinciden (uno en frasco, otro en bolsa), no se decide."""
    por_barcode: dict[str, set] = {}
    por_etiqueta: dict[str, set] = {}
    for c in _datos()["combos"]:
        r = c.get("recipiente") or ""
        if not r:
            continue
        codigo = str((c["eslabones"].get("ean") or {}).get("codigo") or "").strip()
        eid = (c["eslabones"].get("etiqueta") or {}).get("etiqueta_id") or ""
        if codigo:
            por_barcode.setdefault(codigo, set()).add(r)
        if eid:
            por_etiqueta.setdefault(eid, set()).add(r)
    unico = lambda d: {k: next(iter(v)) for k, v in d.items() if len(v) == 1}
    return {"por_barcode": unico(por_barcode), "por_etiqueta": unico(por_etiqueta)}


def recipiente_etiqueta(ficha_id: str = "", barcode: str = "") -> str:
    """Manda el código de barras (dice cuál es el combo); si no, el enlace ya conocido."""
    r = recipientes()
    return r["por_barcode"].get((barcode or "").strip()) or r["por_etiqueta"].get(ficha_id or "") or ""


_RE_RECIPIENTE = re.compile(r"\b(envase|empaque)(s?)\b", re.IGNORECASE)


def palabra_recipiente(texto: str, recipiente: str) -> str:
    """Cambia «envase»/«empaque» por la palabra del combo, respetando plural y mayúsculas."""
    if not texto or recipiente not in ("envase", "empaque"):
        return texto

    def cambio(m: re.Match) -> str:
        w = recipiente + m.group(2)
        orig = m.group(0)
        if orig.isupper():
            return w.upper()
        return w[0].upper() + w[1:] if orig[0].isupper() else w

    return _RE_RECIPIENTE.sub(cambio, texto)


def _no_requeridos() -> dict[str, dict]:
    datos = _leer_json(_DOC_NO_REQUERIDO_JSON, {}) or {}
    return {str(k).strip().upper(): v for k, v in (datos.get("combos") or {}).items() if isinstance(v, dict)}


def marcar_documento_no_requerido(ref: str, no_requiere: bool, motivo: str = "", usuario: str = "") -> dict:
    """Marca (o desmarca) que un combo no necesita documento técnico. Solo toca el JSON de
    exenciones: no borra ni cambia ningún documento."""
    ref = (ref or "").strip().upper()
    combo = next((c for c in _datos()["combos"] if c["ref"].upper() == ref), None)
    if not combo:
        raise ValueError("Ese combo no existe en la copia local de Alegra")
    with _lock:
        datos = _leer_json(_DOC_NO_REQUERIDO_JSON, {}) or {}
        combos = {str(k).strip().upper(): v for k, v in (datos.get("combos") or {}).items()}
        if no_requiere:
            combos[ref] = {"motivo": (motivo or "").strip()[:200], "por": (usuario or "").strip()[:80],
                           "fecha": time.strftime("%Y-%m-%dT%H:%M:%S"), "nombre": combo["nombre"]}
        else:
            combos.pop(ref, None)
        datos["combos"] = dict(sorted(combos.items()))
        tmp = _DOC_NO_REQUERIDO_JSON.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(_DOC_NO_REQUERIDO_JSON)
    invalidar()
    return {"ok": True, "ref": ref, "no_requiere": bool(no_requiere)}


def _declara_sku(doc: dict, sku: str) -> bool:
    return sku.lower() in {x.lower() for x in [doc.get("referencia") or "", *doc.get("equivalentes", [])] if x}


def invalidar() -> None:
    """Tras escribir algo, la próxima lectura se recalcula."""
    with _lock:
        _memo.update(t=0.0, data=None)
        _memo_matriz.update(t=0.0, data=None)


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
        if a.get("tipo") != "fijar_sku" or a.get("modo", "fijar") != "fijar":
            continue  # reemplazar o compartir una referencia se decide caso a caso, no en lote
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


def fijar_sku_documento(archivo: str, sku: str, compartir: bool = False, corregir: bool = False) -> dict:
    """Une un documento a su materia prima escribiendo su SKU en el YAML — y nada más.

    Edita UNA línea (no re-serializa el archivo: `yaml.dump` reordenaría comentarios y
    bloques de texto de 248 documentos). Respaldo previo, y si al releer cambió algo
    distinto de lo pedido, no se escribe. Según lo que el documento ya declare:

    - nada → escribe `referencia: <sku>`;
    - un código que NO es un producto de inventario activo (viejo, mal tecleado o el de un
      combo) → lo reemplaza: era un enlace roto, no una decisión (`ALUg` cuando el producto
      es `ALUALLg`). Antes se rechazaba y el taller no dejaba unir esos documentos;
    - OTRA materia prima activa → no la pisa. Solo con `compartir=True` agrega el SKU a
      `referencias_equivalentes`: el mismo documento sirve a las dos. Con `corregir=True`
      (lo pide una persona desde el editor del documento: el enlace estaba mal) la reemplaza.
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
    if not item or item.get("type") == "kit" or (item.get("status") or "active") != "active":
        raise ValueError(f"`{sku}` no es un producto de inventario activo en Alegra (la referencia es la materia prima, no el combo)")

    texto = ruta.read_text(encoding="utf-8")
    antes = yaml.safe_load(texto) or {}
    actual = str(antes.get("referencia") or "").strip()
    equiv = antes.get("referencias_equivalentes") or []
    equiv = [str(x).strip() for x in equiv] if isinstance(equiv, list) else []
    if sku.lower() in {x.lower() for x in [actual, *equiv] if x}:
        return {"ok": True, "archivo": archivo, "sku": sku, "sin_cambios": True}

    clave, modo = "referencia", "fijar"
    if actual:
        otro = ac.obtener_item(actual)
        if corregir:
            modo = "corregir"
        elif otro and otro.get("type") != "kit" and (otro.get("status") or "active") == "active":
            if not compartir:
                raise ValueError(f"El documento ya pertenece a `{actual}`, que es otro producto activo. "
                                 "Si los dos son la misma sustancia, compártelo; si no, este producto necesita su propio documento")
            clave, modo = "referencias_equivalentes", "compartir"
        else:
            modo = "reemplazar"

    if clave == "referencia":
        linea = f"referencia: {sku}"
    else:
        linea = "referencias_equivalentes: [" + ", ".join([*equiv, sku]) + "]"
    if re.search(rf"^{clave}:.*$", texto, flags=re.M):
        if clave == "referencias_equivalentes" and not re.search(r"^referencias_equivalentes: *\[.*\] *$", texto, flags=re.M):
            raise ValueError("`referencias_equivalentes` está escrita en varias líneas: edítala a mano en el YAML")
        nuevo = re.sub(rf"^{clave}:.*$", linea, texto, count=1, flags=re.M)
    else:
        m = re.search(r"^referencia:.*$", texto, flags=re.M) if clave != "referencia" else None
        m = m or re.search(r"^(nombre_producto|titulo):.*$", texto, flags=re.M)
        if not m:
            raise ValueError("El documento no tiene `titulo` ni `nombre_producto` donde anclar la referencia")
        nuevo = texto[: m.end()] + "\n" + linea + texto[m.end():]

    despues = yaml.safe_load(nuevo) or {}
    esperado = sku if clave == "referencia" else [*equiv, sku]
    if {k: v for k, v in despues.items() if k != clave} != {k: v for k, v in antes.items() if k != clave} \
            or despues.get(clave) != esperado:
        raise ValueError("La edición habría cambiado algo más que lo pedido: no se escribió")

    respaldo = ft.DATOS_DIR / "_respaldo_referencia"
    respaldo.mkdir(exist_ok=True)
    shutil.copy2(ruta, respaldo / f"{ruta.stem}.{time.strftime('%Y%m%d_%H%M%S')}.yaml")
    ruta.write_text(nuevo, encoding="utf-8")
    invalidar()
    return {"ok": True, "archivo": archivo, "sku": sku, "modo": modo, "antes": actual}


def quitar_sku_documento(archivo: str, sku: str) -> dict:
    """Saca un SKU de `referencias_equivalentes` (un «compartir» que estaba mal). Misma
    edición de UNA línea y mismas salvaguardas que `fijar_sku_documento`."""
    import shutil

    import yaml

    from app.services import ficha_tecnica as ft

    archivo = (archivo or "").strip()
    sku = (sku or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.yaml", archivo):
        raise ValueError("Nombre de documento inválido")
    ruta = ft.DATOS_DIR / archivo
    if not ruta.is_file():
        raise ValueError("Ese documento no existe")
    texto = ruta.read_text(encoding="utf-8")
    antes = yaml.safe_load(texto) or {}
    equiv = antes.get("referencias_equivalentes") or []
    equiv = [str(x).strip() for x in equiv] if isinstance(equiv, list) else []
    quedan = [x for x in equiv if x.lower() != sku.lower()]
    if len(quedan) == len(equiv):
        return {"ok": True, "archivo": archivo, "sku": sku, "sin_cambios": True}
    if not re.search(r"^referencias_equivalentes: *\[.*\] *$", texto, flags=re.M):
        raise ValueError("`referencias_equivalentes` está escrita en varias líneas: edítala a mano en el YAML")
    nuevo = re.sub(r"^referencias_equivalentes:.*$", "referencias_equivalentes: [" + ", ".join(quedan) + "]",
                   texto, count=1, flags=re.M)
    despues = yaml.safe_load(nuevo) or {}
    if {k: v for k, v in despues.items() if k != "referencias_equivalentes"} != \
            {k: v for k, v in antes.items() if k != "referencias_equivalentes"} \
            or (despues.get("referencias_equivalentes") or []) != quedan:
        raise ValueError("La edición habría cambiado algo más que lo pedido: no se escribió")
    respaldo = ft.DATOS_DIR / "_respaldo_referencia"
    respaldo.mkdir(exist_ok=True)
    shutil.copy2(ruta, respaldo / f"{ruta.stem}.{time.strftime('%Y%m%d_%H%M%S')}.yaml")
    ruta.write_text(nuevo, encoding="utf-8")
    invalidar()
    return {"ok": True, "archivo": archivo, "sku": sku, "quitado": True}


def referencia_documento(titulo: str) -> dict:
    """A qué SKU está unido el documento de ese título (el archivo sale del título, igual
    que al generarlo: «FT COA SDS {titulo}» → `ft_coa_sds_{slug}.yaml`)."""
    import yaml

    from app.services import alegra_catalogo_db as ac
    from app.services import ficha_tecnica as ft

    slug = re.sub(r"[^a-z0-9_]+", "_", ft._normalizar(titulo or "").lower()).strip("_")
    if not slug:
        return {"archivo": "", "existe": False, "referencia": "", "equivalentes": [], "nombres": {}}
    archivo = f"ft_coa_sds_{slug}.yaml"
    ruta = ft.DATOS_DIR / archivo
    if not ruta.is_file():
        return {"archivo": archivo, "existe": False, "referencia": "", "equivalentes": [], "nombres": {}}
    datos = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    ref = str(datos.get("referencia") or "").strip()
    equiv = datos.get("referencias_equivalentes") or []
    equiv = [str(x).strip() for x in equiv if str(x).strip()] if isinstance(equiv, list) else []
    nombres = {}
    for s in [ref, *equiv]:
        if s:
            it = ac.obtener_item(s)
            nombres[s] = (it or {}).get("name") or ""
    return {"archivo": archivo, "existe": True, "referencia": ref, "equivalentes": equiv, "nombres": nombres}


_DOC_OCULTOS = {"imagen_b64", "color_acento", "identidad", "titulo", "nombre_producto"}
_DOC_NOMBRES = {
    "cas": "CAS", "ins": "INS", "ph": "pH", "einces": "EINECS", "numero_ce": "Número CE", "nombre_inci": "Nombre INCI",
    "pais_origen": "País de origen", "fecha_revision": "Fecha de revisión", "modo_uso": "Modo de uso",
    "caracteristicas_fisicas": "Características físicas", "propiedades_lista": "Propiedades funcionales",
    "composicion": "Composición", "conservacion": "Conservación", "descripcion": "Descripción",
    "sinonimos": "Sinónimos", "parametros": "Parámetros analizados", "identificacion": "Identificación",
    "toxicologia": "Toxicología", "ecologia": "Ecología", "eliminacion": "Eliminación", "exposicion": "Controles de exposición",
    "otra_info": "Otra información", "primeros_auxilios": "Primeros auxilios", "manipulacion": "Manipulación y almacenamiento",
}


def _doc_nombre(clave: str) -> str:
    return _DOC_NOMBRES.get(clave) or clave.strip("_").replace("_", " ").capitalize()


# Lo que NO se edita desde el taller: el enlace con la materia prima (va por `fijar_sku_documento`,
# que valida el SKU contra Alegra), el nombre (de él salen el archivo y el emparejamiento) y las imágenes.
_DOC_NO_EDITABLES = {"referencia", "referencia_interna", "titulo", "nombre_producto", "imagen_b64", "color_acento"}


def _doc_bloques(datos: dict, base: list | None = None) -> tuple[list[dict], int]:
    """Un dict del YAML → bloques para leer (texto · filas · tabla · lista) y cuántos campos están
    vacíos. Cada valor lleva su RUTA dentro del YAML (`["_coa", "lote", "numero"]`) para editarlo."""
    base = list(base or [])
    bloques: list[dict] = []
    vacios = 0
    sueltos: list[list] = []
    for k, v in datos.items():
        if k.startswith("_") or k in _DOC_OCULTOS:
            continue
        nombre = _doc_nombre(k)
        ruta = [*base, k]
        editable = k not in _DOC_NO_EDITABLES
        if v is None or v == "" or v == [] or v == {}:
            vacios += 1
            sueltos.append([nombre, "", ruta if editable and not isinstance(v, (list, dict)) else None])
        elif isinstance(v, dict):
            sub, n = _doc_bloques(v, ruta)
            vacios += n
            for b in sub:
                b["titulo"] = b.get("titulo") or nombre
                bloques.append(b)
        elif isinstance(v, list):
            if not base and k == "propiedades":
                ruta = None  # tabla DERIVADA de los campos sueltos: se rehace al guardar, no se edita
            if all(isinstance(x, (list, tuple)) for x in v):
                bloques.append({"tipo": "tabla", "titulo": nombre, "ruta": ruta, "filas": [[str(c) for c in x] for x in v]})
            else:
                bloques.append({"tipo": "lista", "titulo": nombre, "ruta": ruta, "items": [str(x) for x in v]})
        elif len(str(v)) > 90 or "\n" in str(v):
            bloques.append({"tipo": "texto", "titulo": nombre, "texto": str(v), "ruta": ruta if editable else None})
        else:
            sueltos.append([nombre, str(v), ruta if editable else None])
    if sueltos:
        bloques.insert(0, {"tipo": "filas", "titulo": "", "filas": sueltos})
    return bloques, vacios


def revisar_documento(archivo: str) -> dict:
    """El documento técnico listo para LEERSE en el taller de combos, sin abrir Docs técnicos:
    sus tres partes (ficha, COA, SDS), las fuentes, lo que tiene pendiente y cuántos campos le
    faltan a cada una. Solo lectura; no genera PDF ni toca el YAML."""
    import yaml

    from app.services import ficha_tecnica as ft

    archivo = (archivo or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.yaml", archivo):
        raise ValueError("Nombre de documento inválido")
    ruta = ft.DATOS_DIR / archivo
    if not ruta.is_file():
        raise ValueError("Ese documento no existe")
    d = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    meta = next((x for x in _datos()["documentos"] if x["archivo"] == archivo), None) or {}

    secciones = []
    for clave, titulo, datos in (("tds", "Ficha técnica", {k: v for k, v in d.items() if not k.startswith("_")}),
                                 ("coa", "Certificado de análisis (COA)", d.get("_coa") or {}),
                                 ("sds", "Hoja de seguridad (SDS)", d.get("_sds") or {})):
        if not isinstance(datos, dict) or not datos:
            secciones.append({"id": clave, "titulo": titulo, "bloques": [], "vacios": 0, "existe": False})
            continue
        bloques, vacios = _doc_bloques(datos, [] if clave == "tds" else [f"_{clave}"])
        firma = (datos.get("firma") or {}) if isinstance(datos.get("firma"), dict) else {}
        secciones.append({"id": clave, "titulo": titulo, "bloques": bloques, "vacios": vacios, "existe": True,
                          "firmado": bool(firma.get("imagen_b64"))})

    pendientes = []
    if d.get("_vacio_motivo"):
        pendientes.append({"titulo": "Por qué está marcado como vacío", "items": [str(d["_vacio_motivo"])]})
    for clave, titulo in (("_vacio_pendientes", "Pendientes para poder publicarlo"), ("_pedido_proveedor", "Hay que pedírselo al proveedor")):
        if isinstance(d.get(clave), list) and d[clave]:
            pendientes.append({"titulo": titulo, "items": [str(x) for x in d[clave]]})
    return {
        "archivo": archivo, "titulo": (d.get("titulo") or d.get("nombre_producto") or archivo),
        "estado": meta.get("estado") or "", "referencia": meta.get("referencia") or "", "equivalentes": meta.get("equivalentes") or [],
        "borrador": bool(d.get("_borrador")), "secciones": secciones, "pendientes": pendientes,
        # Publicado = la web lo muestra tal cual está en este archivo: editarlo cambia lo que ve el cliente.
        "publicado": d.get("_tipo") == "completo" and not d.get("_borrador") and d.get("_estado") != "vacio",
        "ediciones": [e for e in (d.get("_ediciones") or []) if isinstance(e, dict)][-5:],
        "fuentes": [str(x) for x in (d.get("_fuentes") or [])] if isinstance(d.get("_fuentes"), list) else [],
        "proveedor": d.get("_proveedor_factura") if isinstance(d.get("_proveedor_factura"), dict) else None,
    }


def editar_documento(archivo: str, cambios: list, usuario: str = "", confirmar_publicado: bool = False) -> dict:
    """Corrige valores de un documento técnico desde el taller de combos, sin abrir Docs técnicos.

    `cambios` = [{"ruta": ["caracteristicas_fisicas", "ph"], "valor": "7,0"}, …]. Solo valores que YA
    existen y son texto o número (incluye celdas de tabla e ítems de lista por índice): no crea claves,
    no toca `referencia` (eso es `fijar_sku_documento`), ni el nombre, ni imágenes, ni claves privadas.

    Guarda como guarda Docs técnicos (`yaml.dump`, mismo formato), con respaldo previo en
    `_respaldo_edicion/` y un rastro en `_ediciones`. Relee y exige que SOLO hayan cambiado las rutas
    pedidas. Un documento PUBLICADO se muestra en la web desde este archivo: cambiarlo cambia lo que ve
    el cliente y no regenera el PDF ya emitido, por eso pide `confirmar_publicado`.
    """
    import copy
    import shutil

    import yaml

    from app.services import ficha_tecnica as ft

    archivo = (archivo or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}\.yaml", archivo):
        raise ValueError("Nombre de documento inválido")
    ruta_archivo = ft.DATOS_DIR / archivo
    if not ruta_archivo.is_file():
        raise ValueError("Ese documento no existe")
    if not isinstance(cambios, list) or not cambios:
        raise ValueError("Nada que cambiar")
    if len(cambios) > 200:
        raise ValueError("Demasiados cambios en una sola vez")

    antes = yaml.safe_load(ruta_archivo.read_text(encoding="utf-8")) or {}
    publicado = antes.get("_tipo") == "completo" and not antes.get("_borrador") and antes.get("_estado") != "vacio"
    if publicado and not confirmar_publicado:
        raise ValueError("Este documento está publicado: el cambio se verá en la página web. Confírmalo para guardar")

    nuevo = copy.deepcopy(antes)
    hechos = []
    for c in cambios:
        ruta = (c or {}).get("ruta")
        valor = (c or {}).get("valor")
        if not isinstance(ruta, list) or not ruta or not isinstance(valor, str) or len(valor) > 8000:
            raise ValueError("Cambio mal formado")
        if str(ruta[0]).startswith("_") and ruta[0] not in ("_coa", "_sds"):
            raise ValueError(f"`{ruta[0]}` no se edita desde aquí")
        if any(isinstance(x, str) and x in _DOC_NO_EDITABLES for x in ruta):
            raise ValueError(f"`{'.'.join(map(str, ruta))}` no se edita desde aquí (el enlace con la materia prima va por «Unir»; el nombre, por Docs técnicos)")
        nodo = nuevo
        for paso in ruta[:-1]:
            if isinstance(nodo, dict) and paso in nodo:
                nodo = nodo[paso]
            elif isinstance(nodo, list) and isinstance(paso, int) and 0 <= paso < len(nodo):
                nodo = nodo[paso]
            else:
                raise ValueError(f"La ruta `{'.'.join(map(str, ruta))}` no existe en el documento")
        ultimo = ruta[-1]
        existe = (isinstance(nodo, dict) and ultimo in nodo) or (isinstance(nodo, list) and isinstance(ultimo, int) and 0 <= ultimo < len(nodo))
        if not existe:
            raise ValueError(f"La ruta `{'.'.join(map(str, ruta))}` no existe en el documento")
        actual = nodo[ultimo]
        if isinstance(actual, (dict, list)):
            raise ValueError(f"`{'.'.join(map(str, ruta))}` no es un valor suelto")
        if str(actual if actual is not None else "") != valor:
            nodo[ultimo] = valor
            hechos.append(".".join(map(str, ruta)))
    if not hechos:
        return {"ok": True, "archivo": archivo, "sin_cambios": True, "cambiados": []}

    # Las tablas `identidad` / `propiedades` se DERIVAN de los campos sueltos: se rehacen como al guardar
    # desde Docs técnicos. Si rehacerlas tocara algo privado, se deja el documento sin re-derivar.
    if any(not h.startswith("_") for h in hechos):
        try:
            derivado = ft.normalizar_datos_ficha(nuevo)
            if {k: v for k, v in derivado.items() if k.startswith("_")} == {k: v for k, v in nuevo.items() if k.startswith("_")}:
                nuevo = derivado
        except Exception:
            pass
    rastro = [e for e in (nuevo.get("_ediciones") or []) if isinstance(e, dict)][-19:]
    rastro.append({"cuando": time.strftime("%Y-%m-%dT%H:%M:%S"), "quien": (usuario or "").strip()[:60] or "panel",
                   "desde": "taller de combos", "campos": hechos[:40]})
    nuevo["_ediciones"] = rastro

    texto = yaml.dump(nuevo, allow_unicode=True, sort_keys=False, default_flow_style=False)
    if (yaml.safe_load(texto) or {}) != nuevo:
        raise ValueError("El documento no se pudo volver a escribir igual: no se guardó")
    respaldo = ft.DATOS_DIR / "_respaldo_edicion"
    respaldo.mkdir(exist_ok=True)
    shutil.copy2(ruta_archivo, respaldo / f"{ruta_archivo.stem}.{time.strftime('%Y%m%d_%H%M%S')}.yaml")
    ruta_archivo.write_text(texto, encoding="utf-8")
    invalidar()
    return {"ok": True, "archivo": archivo, "cambiados": hechos, "publicado": publicado}


def listar_documentos(q: str = "", limite: int = 40) -> list[dict]:
    """Los documentos técnicos para elegir uno a mano cuando el parecido de nombre no lo encuentra."""
    A = _auditoria()
    palabras = [p for p in A._norm(q).split() if p]
    out = []
    for d in _datos()["documentos"]:
        base = A._norm(d["titulo"] + " " + d["archivo"].replace("_", " ") + " " + d["referencia"])
        if all(p in base for p in palabras):
            out.append(d)
    out.sort(key=lambda d: (A._ORDEN_DOC.index(d["estado"]) if d["estado"] in A._ORDEN_DOC else 99, d["titulo"]))
    return out[: max(1, min(int(limite or 40), 200))]
