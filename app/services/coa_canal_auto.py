# -*- coding: utf-8 -*-
"""COA que llegan por foto al grupo «COA y fichas técnicas» → documento técnico al día.

Cuando entra una foto a un canal cuyo módulo es `documentos_tecnicos` (subida desde el panel
o espejada del grupo de WhatsApp), se encola. Las fotos llegan de a una (~10 s entre cada
una) y un COA puede tener dos páginas, así que se espera a que el grupo quede quieto
`COA_CANAL_AUTO_ESPERA_S` segundos y se procesa el lote completo:

1. Cada foto pasa por el extractor de COA del panel (`documento_scan_tablas`, Gemini Flash,
   con `llm_budget`): ~2 llamadas por foto.
2. Una foto sin nombre ni lote es la página siguiente del COA anterior: se une a él.
3. Se busca el documento técnico por nombre (`auditar_catalogo_combos.mejor_documento`). Si no
   hay uno claro, NO se adivina: se avisa con los candidatos.
4. Si el lote ya estaba, no se toca nada. Si es otro lote, se reemplaza el bloque de lote del
   COA y la tabla de resultados (los resultados solo salen del COA del proveedor), con
   respaldo en `_respaldo_edicion/`, rastro en `_ediciones`, historial de lotes
   (`registrar_lote_desde_documento`) y el PDF completo regenerado.
5. Un mensaje del sistema en el mismo grupo (y por el espejo, en WhatsApp) dice qué se
   actualizó, qué ya estaba y qué hay que revisar a mano.

Estado durable en `app/data/coa_canal_auto.db` (gitignored): una foto se procesa una sola vez
y lo pendiente se retoma al reiniciar. `COA_CANAL_AUTO_ACTIVO=0` lo apaga.
"""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

_RAIZ = Path(__file__).resolve().parents[2]
_DB = _RAIZ / "app" / "data" / "coa_canal_auto.db"
MODULO = "documentos_tecnicos"

# Un COA con menos filas que esto no se toma como lectura completa de la tabla.
_MIN_FILAS = 4

_timers: dict[int, threading.Timer] = {}
_lock = threading.Lock()
_proceso_lock = threading.Lock()


def activo() -> bool:
    return os.environ.get("COA_CANAL_AUTO_ACTIVO", "1").strip().lower() not in ("0", "false", "no", "off")


def _espera_s() -> float:
    try:
        return max(5.0, float(os.environ.get("COA_CANAL_AUTO_ESPERA_S", "90")))
    except ValueError:
        return 90.0


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(_DB), timeout=15)
    c.row_factory = sqlite3.Row
    c.execute(
        """CREATE TABLE IF NOT EXISTS coa_fotos (
            mensaje_id   INTEGER PRIMARY KEY,
            canal_id     INTEGER NOT NULL,
            ruta         TEXT NOT NULL,
            mime         TEXT,
            estado       TEXT NOT NULL DEFAULT 'pendiente',
            producto     TEXT,
            lote         TEXT,
            archivo_doc  TEXT,
            detalle      TEXT,
            creado_en    REAL NOT NULL,
            procesado_en REAL,
            lectura      TEXT
        )"""
    )
    return c


# ── Entrada ────────────────────────────────────────────────────────────────

def es_imagen(mime: str | None) -> bool:
    return str(mime or "").lower().startswith("image/")


def encolar(canal_id: int, mensaje_id: int, ruta: str, mime: str = "image/jpeg") -> bool:
    """Registra la foto y (re)arranca la espera del canal. True si quedó en cola."""
    if not activo() or not ruta:
        return False
    with _conn() as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO coa_fotos (mensaje_id, canal_id, ruta, mime, creado_en) VALUES (?,?,?,?,?)",
            (int(mensaje_id), int(canal_id), str(ruta), mime or "image/jpeg", time.time()),
        )
        if not cur.rowcount:
            return False
    programar(int(canal_id))
    return True


def programar(canal_id: int, espera_s: float | None = None) -> None:
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    with _lock:
        t = _timers.pop(canal_id, None)
        if t:
            t.cancel()
        t = threading.Timer(_espera_s() if espera_s is None else espera_s, _disparar, args=(canal_id,))
        t.name = f"coa-canal-{canal_id}"
        t.daemon = True
        _timers[canal_id] = t
        t.start()


def _disparar(canal_id: int) -> None:
    with _lock:
        _timers.pop(canal_id, None)
    try:
        procesar_pendientes(canal_id)
    except Exception as e:  # nunca tumba el hilo del servidor
        print(f"[coa_canal_auto] canal {canal_id}: {e!r}", flush=True)


def retomar_pendientes() -> None:
    """Al arrancar el servidor: lo que quedó en cola antes de un reinicio."""
    if not activo():
        return
    try:
        with _conn() as c:
            canales = [int(r[0]) for r in c.execute("SELECT DISTINCT canal_id FROM coa_fotos WHERE estado='pendiente'")]
    except Exception:
        return
    for cid in canales:
        programar(cid, 20)


# ── Lectura de cada foto ───────────────────────────────────────────────────

def _leer_foto(ruta: str, mime: str) -> dict[str, Any]:
    from app.services.coa_scan_jobs import _norm_fecha, _valor_a_texto
    from app.services.documento_scan_tablas import extraer_coa_desde_imagenes

    data = Path(ruta).read_bytes()
    parsed = extraer_coa_desde_imagenes([(data, mime or "image/jpeg")]) or {}
    campos = {k: _valor_a_texto(v).strip() for k, v in parsed.items()
              if v not in (None, "") and not str(k).startswith("_")}
    for fk in ("fecha_fabricacion", "fecha_vencimiento"):
        if campos.get(fk):
            campos[fk] = _norm_fecha(campos[fk])
    campos["filas"] = _filas(campos.get("parametros", ""))
    return campos


def _filas(texto: str) -> list[list[str]]:
    """«Parametro|Espec|Resultado[|Método]» → [[p, e, r]]. El método no va en el documento."""
    out: list[list[str]] = []
    vistos: set[str] = set()
    for raw in (texto or "").splitlines():
        if "|" not in raw:
            continue
        p = [x.strip() for x in raw.split("|")]
        while len(p) < 3:
            p.append("")
        if not p[0] or p[0].lower() in ("parametro", "parámetro", "propiedades", "propiedad") or p[0].lower() in vistos:
            continue
        vistos.add(p[0].lower())
        out.append([p[0], p[1], p[2]])
    return out


def _agrupar(lecturas: list[dict]) -> list[dict]:
    """Une las páginas de un mismo COA: una foto sin nombre ni lote sigue a la anterior;
    dos fotos seguidas con el mismo lote también son el mismo certificado."""
    grupos: list[dict] = []
    for lec in lecturas:
        campos = lec.get("campos") or {}
        nombre = (campos.get("nombre_producto") or "").strip()
        lote = (campos.get("lote") or "").strip()
        previo = grupos[-1] if grupos else None
        # Página siguiente: sin lote y sin nombre, o sin lote con el mismo producto repetido en el
        # encabezado (la hoja 2 de la creatina dice «CREATINA MONOHIDRATO» pero no el lote).
        continua = previo and (
            (not lote and (not nombre or _mismo_producto(nombre, previo["campos"].get("nombre_producto") or "")))
            or (lote and lote == previo["campos"].get("lote"))
        )
        if continua:
            for k, v in campos.items():
                if k == "filas":
                    ya = {f[0].lower() for f in previo["campos"]["filas"]}
                    previo["campos"]["filas"] += [f for f in v if f[0].lower() not in ya]
                elif v and not previo["campos"].get(k):
                    previo["campos"][k] = v
            previo["mensajes"].append(lec["mensaje_id"])
            continue
        if not nombre and not campos.get("filas"):
            lec["no_coa"] = True
            continue
        grupos.append({"campos": dict(campos, filas=list(campos.get("filas") or [])), "mensajes": [lec["mensaje_id"]]})
    return grupos


def _mismo_producto(a: str, b: str) -> bool:
    A = _auditoria()
    ta, tb = A._toks(a), A._toks(b)
    return bool(ta and tb and (ta <= tb or tb <= ta))


# ── Documento técnico ──────────────────────────────────────────────────────

def _auditoria():
    import importlib.util
    import sys

    if "auditar_catalogo_combos" in sys.modules:
        return sys.modules["auditar_catalogo_combos"]
    spec = importlib.util.spec_from_file_location("auditar_catalogo_combos", _RAIZ / "scripts" / "auditar_catalogo_combos.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["auditar_catalogo_combos"] = mod
    spec.loader.exec_module(mod)
    return mod


def buscar_documento(nombre: str) -> tuple[dict | None, list[dict]]:
    """(documento, candidatos). Documento None si no hay uno claro: no se adivina."""
    A = _auditoria()
    docs = [d for d in A.documentos_por_titulo() if d["estado"] not in ("vacía", "borrador")]
    tn = A._toks(nombre)
    if not tn:
        return None, []
    puntaje = []
    for d in docs:
        inter = len(tn & d["toks"])
        if inter and (d["toks"] <= tn or tn <= d["toks"]):
            puntaje.append((inter / max(len(tn), len(d["toks"])), d))
    if not puntaje:
        cerca = sorted(((len(tn & d["toks"]), d) for d in docs if tn & d["toks"]), key=lambda x: -x[0])[:3]
        return None, [d for _, d in cerca]
    puntaje.sort(key=lambda x: (-x[0], A._ORDEN_DOC.index(x[1]["estado"]), -float(x[1].get("mtime") or 0)))
    mejor = puntaje[0]
    empatados = [d for s, d in puntaje if s == mejor[0] and d["archivo"] != mejor[1]["archivo"]]
    # Dos documentos igual de parecidos de productos distintos (las dos con SKU, y distinto): no se
    # adivina. Uno sin SKU junto a otro con SKU es la ficha vieja del mismo producto (agar agar).
    ref_mejor = (mejor[1].get("referencia") or "").lower()
    if any((d.get("referencia") or "").lower() not in ("", ref_mejor) for d in empatados):
        return None, [d for _, d in puntaje[:3]]
    try:
        from app.services.coa_biblioteca_match import sustancias_en_conflicto

        if sustancias_en_conflicto(nombre, mejor[1]["titulo"]):
            return None, [d for _, d in puntaje[:3]]
    except Exception:
        pass
    return mejor[1], []


def _norm_lote(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


# ── Casillas vacías y casillas que contradicen el COA ─────────────────────

# Lo que la IA NO deduce: dosis/usos terapéuticos y textos de venta reintrodujeron en las fichas
# viejas «dosis de suplemento» (McKenna vende materia prima). Eso queda para una persona.
_SOLO_HUMANO = ("modo_uso", "descripcion", "aplicaciones", "propiedades_lista")
_NOMBRES = {
    "concentracion": "concentración", "presentacion": "presentación", "fabricante": "fabricante",
    "cas": "CAS", "ins": "INS", "sinonimos": "sinónimos", "alergenos": "alérgenos", "composicion": "composición",
    "caracteristicas_fisicas.ph": "pH", "caracteristicas_fisicas.solubilidad": "solubilidad",
    "caracteristicas_fisicas.punto_fusion": "punto de fusión", "caracteristicas_fisicas.apariencia": "apariencia",
    "caracteristicas_fisicas.olor": "olor", "caracteristicas_fisicas.sabor": "sabor",
    "caracteristicas_fisicas.formula_quimica": "fórmula química", "_coa.identificacion.einces": "EINECS",
    "_coa.identificacion.nombre_inci": "INCI", "_coa.identificacion.ins": "INS",
    "_coa.lote.fabricante": "fabricante (COA)", "_coa.lote.tamano_lote": "cantidad del lote",
    "_coa.lote.fecha_fabricacion": "fecha de fabricación", "_coa.lote.fecha_vencimiento": "vencimiento",
    "_coa.lote.pais_origen": "país de origen", "_coa.identificacion.cas": "CAS", "conservacion": "conservación", "modo_uso": "modo de uso", "recomendaciones": "recomendaciones",
    "aplicaciones": "aplicaciones", "propiedades_lista": "propiedades", "descripcion": "descripción",
}
_PROXIMAL = re.compile(r"^(prote[ií]na|grasa|contenido de grasa|humedad|cenizas?|carbohidratos?|fibra|minerales|az[uú]cares)\b", re.I)


def _nombre_casilla(ruta: str) -> str:
    return _NOMBRES.get(ruta, ruta.split(".")[-1].replace("_", " "))


def _vacio(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or v == [] or v == {}


def _get(d: dict, ruta: str) -> Any:
    nodo: Any = d
    for p in ruta.split("."):
        if not isinstance(nodo, dict):
            return None
        nodo = nodo.get(p)
    return nodo


def _set(d: dict, ruta: str, valor: Any) -> None:
    partes = ruta.split(".")
    nodo = d
    for p in partes[:-1]:
        if not isinstance(nodo.get(p), dict):
            nodo[p] = {}
        nodo = nodo[p]
    nodo[partes[-1]] = valor


def _numeros(s: str) -> list[float]:
    return [float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", s or "")]


def _fila(filas: list[list[str]], patron: str) -> list[str] | None:
    rx = re.compile(patron, re.I)
    return next((f for f in filas if rx.search(f[0] or "")), None)


def _palabras(s: str) -> set[str]:
    import unicodedata

    s = "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z]{3,}", s)}


def _tipo_y_grado(doc: dict) -> tuple[str, str]:
    ident = ((doc.get("_coa") or {}).get("identificacion") or {}) if isinstance(doc.get("_coa"), dict) else {}
    return str(doc.get("tipo_insumo") or "").lower(), str((ident or {}).get("grado") or "").lower()


def _concentracion_coa(filas: list[list[str]]) -> str:
    f = _fila(filas, r"^(pureza|ensayo|assay|valoraci[oó]n)\b") or _fila(filas, r"^prote[ií]na")
    if not f:
        return ""
    res, spec = (f[2] or "").strip(), (f[1] or "").strip()
    n = _numeros(res)
    if n and n[0] <= 100 and not re.search(r"conforme|cumple", res, re.I):
        return res if "%" in res else f"{res} %"
    return (spec if "%" in spec else f"{spec} %") if spec else ""


def cambios_desde_coa(doc: dict, campos: dict) -> list[dict]:
    """Casillas que el COA del proveedor llena (vacías) o corrige (lo contradicen). Sin LLM."""
    filas = [f for f in (campos.get("filas") or []) if len(f) >= 3]
    tipo, grado = _tipo_y_grado(doc)
    out: list[dict] = []

    def propone(ruta: str, valor: str, *, corregir_si=None) -> None:
        valor = (valor or "").strip()
        if not valor:
            return
        actual = _get(doc, ruta)
        if _vacio(actual):
            out.append({"ruta": ruta, "antes": "", "despues": valor, "tipo": "llenado"})
        elif corregir_si and corregir_si(str(actual)) and str(actual).strip() != valor:
            out.append({"ruta": ruta, "antes": str(actual), "despues": valor, "tipo": "corregido"})

    # pH: el rango de la especificación (no el resultado del lote).
    f = _fila(filas, r"^ph\b")
    ph = (f[1] if f and f[1] else "") or ""
    propone("caracteristicas_fisicas.ph", ph,
            corregir_si=lambda a: bool(_numeros(a)) and bool(_numeros(ph)) and set(_numeros(a)) != set(_numeros(ph)))
    f = _fila(filas, r"^solubilidad")
    sol = f[1] if f and f[1] and not re.fullmatch(r"[\d.,\s%]+", f[1]) else (campos.get("solubilidad") or "")
    propone("caracteristicas_fisicas.solubilidad", sol)
    f = _fila(filas, r"^punto de fusi")
    propone("caracteristicas_fisicas.punto_fusion", f[1] if f else "")
    f = _fila(filas, r"^(apariencia|descripci[oó]n|aspecto)")
    ap = (f[1] if f and f[1] else "") or (campos.get("apariencia") or "")
    # Se corrige una apariencia que el COA dice más completa (todas sus palabras están en la del COA).
    propone("caracteristicas_fisicas.apariencia", ap,
            corregir_si=lambda a: bool(_palabras(a)) and _palabras(a) < _palabras(ap))
    f = _fila(filas, r"^olor")
    olor = (f[1] if f and f[1] else "") or (campos.get("olor") or "")
    propone("caracteristicas_fisicas.olor", olor,
            corregir_si=lambda a: "inodoro" in olor.lower() and "inodoro" not in a.lower())
    conc = _concentracion_coa(filas)
    propone("concentracion", conc,
            corregir_si=lambda a: bool(_numeros(a)) and bool(_numeros(conc)) and _numeros(a)[0] != _numeros(conc)[0])
    # Presentación = cantidad del lote (así la llenó siempre el formulario al escanear un COA).
    tam = campos.get("tamano_lote") or ""
    propone("presentacion", tam, corregir_si=lambda a: _norm_lote(a) != _norm_lote(tam))
    if tipo != "alimento":
        for ruta, clave in (("cas", "cas"), ("_coa.identificacion.cas", "cas"), ("_coa.identificacion.einces", "einecs")):
            propone(ruta, campos.get(clave) or "")
    if "cosm" in grado:
        propone("_coa.identificacion.nombre_inci", campos.get("inci") or "")
    if tipo == "definida":
        propone("caracteristicas_fisicas.formula_quimica", campos.get("formula_quimica") or "")
    # INS / E-número escrito en el COA («Cumple con FCC/JECFA/E-406»).
    if "aliment" in grado and tipo != "alimento":
        m = re.search(r"\b(?:E|INS)[\s-]?(\d{3,4}[a-z]?)\b", campos.get("parametros") or "", re.I)
        if m:
            propone("ins", f"INS {m.group(1)}")
            propone("_coa.identificacion.ins", f"INS {m.group(1)}")
    # Composición de un insumo natural o mezcla: el análisis proximal del COA (proteína, grasa, humedad…).
    if tipo and tipo != "definida" and _vacio(doc.get("composicion")):
        comp = [[re.sub(r"\s*[\[(].*$", "", f[0]).strip(), f[2]] for f in filas
                if _PROXIMAL.search(f[0] or "") and _numeros(f[2]) and not re.search(r"conforme|cumple", f[2], re.I)]
        if len(comp) >= 2:
            out.append({"ruta": "composicion", "antes": "", "despues": comp, "tipo": "llenado"})
    return out


# Casillas que la IA puede deducir (PubChem + Gemini Flash, con llm_budget), según el tipo de insumo.
def _deducibles(doc: dict) -> list[tuple[str, str]]:
    tipo, grado = _tipo_y_grado(doc)
    cand = [("caracteristicas_fisicas.solubilidad", "solubilidad"), ("caracteristicas_fisicas.olor", "olor"),
            ("caracteristicas_fisicas.sabor", "sabor"), ("caracteristicas_fisicas.ph", "ph"),
            ("sinonimos", "sinonimos")]
    if tipo == "definida":
        cand += [("caracteristicas_fisicas.punto_fusion", "punto_fusion"),
                 ("caracteristicas_fisicas.formula_quimica", "formula_quimica"),
                 ("_coa.identificacion.einces", "coa_einecs")]
    if "aliment" in grado or tipo == "alimento":
        cand.append(("alergenos", "alergenos"))
    if "cosm" in grado:
        cand.append(("_coa.identificacion.nombre_inci", "inci"))
    if _vacio(doc.get("conservacion")):
        cand.append(("conservacion", "conservacion"))
    return [(r, c) for r, c in cand if _vacio(_get(doc, r))]


def deducir_vacios(doc: dict, maximo: int) -> list[dict]:
    if maximo <= 0:
        return []
    from app.services.documento_cientifico import sugerir_campo_ficha

    nombre = str(doc.get("nombre_producto") or doc.get("titulo") or "")
    _, grado = _tipo_y_grado(doc)
    out = []
    liquido = "líquid" in str(_get(doc, "caracteristicas_fisicas.apariencia") or "").lower()
    for ruta, campo in _deducibles(doc)[:maximo]:
        # Un líquido no lleva punto de fusión (al D-pantenol le llegó el del DL-pantenol en polvo).
        if campo == "punto_fusion" and liquido:
            continue
        try:
            r = sugerir_campo_ficha(campo, nombre, grado)
        except Exception as e:
            print(f"[coa_canal_auto] deducir {campo} de {nombre}: {e}", flush=True)
            continue
        valor = str(r.get("valor") or "").strip()
        # «No aplica» deducido para un número de registro es casi siempre falso (agar sí tiene EINECS).
        if campo in ("coa_einecs", "cas") and not re.search(r"\d", valor):
            continue
        if valor and len(valor) < 600 and not re.search(r"no (hay|tengo) (datos|informaci)", valor, re.I):
            out.append({"ruta": ruta, "antes": "", "despues": valor, "tipo": "deducido", "origen": r.get("origen") or "IA"})
    return out


def vacias_para_humano(doc: dict) -> list[str]:
    return [_nombre_casilla(k) for k in _SOLO_HUMANO if k in doc and _vacio(doc.get(k))]


def _max_ia() -> int:
    try:
        return int(os.environ.get("COA_CANAL_AUTO_MAX_IA", "6"))
    except ValueError:
        return 6


def aplicar_coa(archivo: str, campos: dict, *, quien: str = "", origen: str = "chat COA y fichas técnicas",
                regenerar_pdf: bool = True, escribir: bool = True, deducir: bool | None = None) -> dict:
    """Pone en el documento el lote y los resultados del COA del proveedor, llena con el COA las
    casillas vacías y corrige las que lo contradicen; lo que el COA no trae se deduce (anotado)."""
    import yaml

    from app.services import ficha_tecnica as ft

    ruta = ft.DATOS_DIR / archivo
    antes = yaml.safe_load(ruta.read_text(encoding="utf-8")) or {}
    coa = antes.get("_coa") if isinstance(antes.get("_coa"), dict) else {}
    lote_prev = coa.get("lote") if isinstance(coa.get("lote"), dict) else {}
    lote_nuevo = (campos.get("lote") or "").strip()
    # «El producto cumple con el estándar» llega como fila sin especificación ni resultado.
    filas = [f for f in (campos.get("filas") or []) if len(f) >= 3 and (f[1] or f[2])]
    campos = dict(campos, filas=filas)
    res = {"archivo": archivo, "titulo": antes.get("titulo") or archivo, "lote": lote_nuevo,
           "lote_anterior": str(lote_prev.get("numero") or antes.get("lote") or "").strip(),
           "filas": len(filas), "vence": campos.get("fecha_vencimiento") or "", "cambios": []}
    if not lote_nuevo:
        return {**res, "estado": "sin_lote"}
    mismo_lote = _norm_lote(lote_nuevo) == _norm_lote(res["lote_anterior"])
    if not mismo_lote and len(filas) < _MIN_FILAS:
        return {**res, "estado": "lectura_incompleta"}

    nuevo = copy.deepcopy(antes)
    if not isinstance(nuevo.get("_coa"), dict):
        nuevo["_coa"] = {}
    c2 = nuevo["_coa"]
    tocados: list[str] = []
    if not mismo_lote:
        lote_dict = dict(lote_prev)
        lote_dict.update({
            "numero": lote_nuevo,
            "fabricante": campos.get("fabricante") or "",
            "pais_origen": campos.get("pais_origen") or lote_prev.get("pais_origen") or "",
            "fecha_fabricacion": campos.get("fecha_fabricacion") or "",
            "fecha_vencimiento": campos.get("fecha_vencimiento") or "",
            "tamano_lote": campos.get("tamano_lote") or "",
        })
        c2["lote"] = lote_dict
        c2["parametros"] = [list(f) for f in filas]
        # Campos sueltos de la FT que repiten el lote (los lee la etiqueta y la web).
        nuevo["lote"] = lote_nuevo
        for k in ("fecha_fabricacion", "fecha_vencimiento", "pais_origen", "fabricante"):
            if lote_dict.get(k):
                nuevo[k] = lote_dict[k]
        tocados += ["_coa.lote", "_coa.parametros", "lote"]
    else:
        # Mismo lote: lo que el COA trae y el bloque de lote tiene vacío (fechas, cantidad, fabricante).
        if not isinstance(c2.get("lote"), dict):
            c2["lote"] = {}
        lote_dict = c2["lote"]
        for k in ("fabricante", "pais_origen", "fecha_fabricacion", "fecha_vencimiento", "tamano_lote"):
            if _vacio(lote_dict.get(k)) and campos.get(k):
                lote_dict[k] = campos[k]
                res["cambios"].append({"ruta": f"_coa.lote.{k}", "antes": "", "despues": campos[k], "tipo": "llenado"})

    # Casillas: primero lo que dice el COA de este lote; después lo que se deduce.
    hoy = time.strftime("%Y-%m-%d")
    for c in cambios_desde_coa(nuevo, campos):
        _set(nuevo, c["ruta"], c["despues"])
        res["cambios"].append(c)
    if deducir is None:
        deducir = os.environ.get("COA_CANAL_AUTO_DEDUCIR", "1").strip() not in ("0", "false", "no", "off")
    if deducir and escribir:
        for c in deducir_vacios(nuevo, _max_ia()):
            _set(nuevo, c["ruta"], c["despues"])
            res["cambios"].append(c)
    if res["cambios"]:
        fuentes = [str(x) for x in (nuevo.get("_fuentes") or [])] if isinstance(nuevo.get("_fuentes"), list) else []
        for c in res["cambios"]:
            nombre_c = _nombre_casilla(c["ruta"])
            if c["tipo"] == "deducido":
                fuentes.append(f"{nombre_c} — {c.get('origen') or 'IA'} (deducido; confirmar con el proveedor) ({hoy})")
            else:
                fuentes.append(f"{nombre_c} — COA del proveedor, lote {lote_nuevo}"
                               + (f" (antes «{c['antes']}»)" if c["tipo"] == "corregido" else "") + f" ({hoy})")
        nuevo["_fuentes"] = list(dict.fromkeys(fuentes))[-60:]
        tocados += sorted({c["ruta"] for c in res["cambios"]})
        # `identidad` / `propiedades` se DERIVAN de los campos sueltos (como en mapa_producto.editar_documento).
        try:
            derivado = ft.normalizar_datos_ficha(nuevo)
            if {k: v for k, v in derivado.items() if k.startswith("_")} == {k: v for k, v in nuevo.items() if k.startswith("_")}:
                nuevo = derivado
        except Exception:
            pass
    res["vacias_humano"] = vacias_para_humano(nuevo)
    if not tocados:
        return {**res, "estado": "al_dia"}

    rastro = [e for e in (nuevo.get("_ediciones") or []) if isinstance(e, dict)][-19:]
    rastro.append({"cuando": time.strftime("%Y-%m-%dT%H:%M:%S"), "quien": (quien or "").strip()[:60] or "automático",
                   "desde": origen, "campos": tocados[:40], "lote_anterior": res["lote_anterior"]})
    nuevo["_ediciones"] = rastro

    texto = yaml.dump(nuevo, allow_unicode=True, sort_keys=False, default_flow_style=False)
    if (yaml.safe_load(texto) or {}) != nuevo:
        return {**res, "estado": "error", "error": "el documento no se pudo volver a escribir igual"}
    res["lote_cambiado"] = not mismo_lote
    if not escribir:
        return {**res, "estado": "actualizaria"}
    respaldo = ft.DATOS_DIR / "_respaldo_edicion"
    respaldo.mkdir(exist_ok=True)
    shutil.copy2(ruta, respaldo / f"{ruta.stem}.{time.strftime('%Y%m%d_%H%M%S')}.yaml")
    ruta.write_text(texto, encoding="utf-8")
    res["estado"] = "actualizado"

    if res["lote_cambiado"]:
        try:
            from app.services.lotes_materia_prima import registrar_lote_desde_documento

            registrar_lote_desde_documento(nuevo)
        except Exception as e:
            res["aviso_lote"] = str(e)[:120]
    if regenerar_pdf and nuevo.get("_tipo") == "completo" and not nuevo.get("_borrador"):
        try:
            ft.generar_pdf_completo(nuevo, datos_coa=nuevo.get("_coa"), datos_sds=nuevo.get("_sds"),
                                    cabezote_id=nuevo.get("_cabezote_id"))
            res["pdf"] = True
        except Exception as e:
            res["pdf"] = False
            res["aviso_pdf"] = str(e)[:120]
    for inval in ("app.services.documentos_web:invalidar_indice_documentos_web", "app.services.mapa_producto:invalidar"):
        try:
            mod, fn = inval.split(":")
            getattr(__import__(mod, fromlist=[fn]), fn)()
        except Exception:
            pass
    return res


# ── Proceso del lote ───────────────────────────────────────────────────────

def procesar_pendientes(canal_id: int, *, escribir: bool = True, avisar: bool = True,
                        mensaje_ids: list[int] | None = None) -> dict:
    with _proceso_lock:
        with _conn() as c:
            q = "SELECT * FROM coa_fotos WHERE canal_id=? AND estado='pendiente'"
            args: list[Any] = [canal_id]
            if mensaje_ids:
                q += f" AND mensaje_id IN ({','.join('?' * len(mensaje_ids))})"
                args += [int(x) for x in mensaje_ids]
            filas = [dict(r) for r in c.execute(q + " ORDER BY mensaje_id", args)]
        if not filas:
            return {"fotos": 0, "resultados": []}

        lecturas = []
        for f in filas:
            try:
                # La lectura se guarda: reintentar o revisar antes de aplicar no paga otra vez el OCR.
                campos = json.loads(f["lectura"]) if f.get("lectura") else _leer_foto(f["ruta"], f["mime"])
                if not f.get("lectura"):
                    with _conn() as c:
                        c.execute("UPDATE coa_fotos SET lectura=? WHERE mensaje_id=?",
                                  (json.dumps(campos, ensure_ascii=False), f["mensaje_id"]))
                lecturas.append({"mensaje_id": f["mensaje_id"], "campos": campos})
            except Exception as e:
                lecturas.append({"mensaje_id": f["mensaje_id"], "campos": {}, "error": str(e)[:200]})
        errores = [l for l in lecturas if l.get("error")]
        grupos = _agrupar([l for l in lecturas if not l.get("error")])

        resultados = []
        for g in grupos:
            cp = g["campos"]
            nombre = cp.get("nombre_producto") or cp.get("nombre_comercial") or ""
            doc, candidatos = buscar_documento(nombre)
            if not doc:
                r = {"estado": "sin_documento", "titulo": nombre, "lote": cp.get("lote") or "",
                     "candidatos": [d["titulo"] for d in candidatos]}
            else:
                try:
                    r = aplicar_coa(doc["archivo"], cp, escribir=escribir)
                except Exception as e:
                    r = {"estado": "error", "titulo": doc["titulo"], "archivo": doc["archivo"], "error": str(e)[:200]}
            r["producto_coa"] = nombre
            r["mensajes"] = g["mensajes"]
            resultados.append(r)

        if escribir:
            ahora = time.time()
            with _conn() as c:
                for r in resultados:
                    for mid in r["mensajes"]:
                        c.execute("UPDATE coa_fotos SET estado=?, producto=?, lote=?, archivo_doc=?, detalle=?, procesado_en=? "
                                  "WHERE mensaje_id=?", (r["estado"], r.get("producto_coa"), r.get("lote"), r.get("archivo"),
                                                         json.dumps(r, ensure_ascii=False)[:4000], ahora, mid))
                for l in lecturas:
                    if l.get("no_coa"):
                        c.execute("UPDATE coa_fotos SET estado='no_coa', procesado_en=? WHERE mensaje_id=?", (ahora, l["mensaje_id"]))
                    elif l.get("error"):
                        c.execute("UPDATE coa_fotos SET estado='error', detalle=?, procesado_en=? WHERE mensaje_id=?",
                                  (l["error"], ahora, l["mensaje_id"]))
        texto = resumen(resultados, len(errores))
        if escribir and avisar and texto:
            try:
                from app.services.canales_internos import enviar_mensaje

                enviar_mensaje(canal_id, None, texto, responde_a=filas[-1]["mensaje_id"])
            except Exception as e:
                print(f"[coa_canal_auto] aviso al canal falló: {e!r}", flush=True)
        return {"fotos": len(filas), "resultados": resultados, "errores_lectura": len(errores), "texto": texto}


def _fecha_corta(iso: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else (iso or "")


def _corto(v: Any, n: int = 40) -> str:
    t = "; ".join(f"{a} {b}" for a, b in v) if isinstance(v, list) else str(v)
    t = t.replace("\n", " ")
    return t if len(t) <= n else t[: n - 1] + "…"


def _lineas_cambios(r: dict) -> list[str]:
    cs = r.get("cambios") or []
    out = []
    llen = [c for c in cs if c["tipo"] == "llenado"]
    corr = [c for c in cs if c["tipo"] == "corregido"]
    ded = [c for c in cs if c["tipo"] == "deducido"]
    if corr:
        out.append("   ✏️ corregí: " + "; ".join(f"{_nombre_casilla(c['ruta'])} «{_corto(c['antes'], 25)}» → «{_corto(c['despues'], 30)}»" for c in corr))
    if llen:
        out.append("   ➕ llené con el COA: " + ", ".join(dict.fromkeys(_nombre_casilla(c["ruta"]) for c in llen)))
    if ded:
        out.append("   🔎 deduje (confirmar): " + ", ".join(dict.fromkeys(_nombre_casilla(c["ruta"]) for c in ded)))
    if r.get("vacias_humano"):
        out.append("   ✋ siguen vacías (las llena una persona): " + ", ".join(r["vacias_humano"]))
    return out


def resumen(resultados: list[dict], errores_lectura: int = 0) -> str:
    if not resultados and not errores_lectura:
        return ""
    act = [r for r in resultados if r["estado"] in ("actualizado", "actualizaria")]
    al_dia = [r for r in resultados if r["estado"] == "al_dia"]
    revisar = [r for r in resultados if r["estado"] not in ("actualizado", "al_dia", "actualizaria")]
    lineas = ["📄 *Documentos técnicos* — leí los COA de las fotos."]
    if act:
        lineas.append("")
        lineas.append("✅ *Actualizados:*" if any(r["estado"] == "actualizado" for r in act) else "🔎 *Se actualizarían:*")
        for r in act:
            if r.get("lote_cambiado", True) and r.get("lote_anterior") != r.get("lote"):
                antes = f" (antes {r['lote_anterior']})" if r.get("lote_anterior") else ""
                vence = f", vence {_fecha_corta(r['vence'])}" if r.get("vence") else ""
                cab = f"• *{r['titulo']}*: lote {r['lote']}{antes}, {r['filas']} resultados{vence}"
            else:
                cab = f"• *{r['titulo']}* (lote {r['lote']}, sin cambio de lote)"
            if not r.get("pdf", True):
                cab += " — ⚠️ el PDF no se regeneró"
            lineas.append(cab)
            lineas += _lineas_cambios(r)
    if al_dia:
        lineas.append("")
        lineas.append("☑️ *Ya estaban al día:* " + ", ".join(f"{r['titulo']} ({r['lote']})" for r in al_dia))
    if revisar or errores_lectura:
        lineas.append("")
        lineas.append("⚠️ *Para revisar a mano:*")
        motivos = {
            "sin_documento": "no encontré su documento técnico",
            "sin_lote": "no se leyó el número de lote",
            "lectura_incompleta": "la tabla se leyó incompleta (foto más nítida o completa)",
            "error": "falló al guardar",
        }
        for r in revisar:
            m = motivos.get(r["estado"], r["estado"])
            cand = f" (¿{' / '.join(r['candidatos'])}?)" if r.get("candidatos") else ""
            lineas.append(f"• {r.get('producto_coa') or r.get('titulo')}: {m}{cand}")
        if errores_lectura:
            lineas.append(f"• {errores_lectura} foto(s) no se pudieron leer")
    lineas.append("")
    lineas.append("Revisar en el panel: /app?panel=fichas")
    return "\n".join(lineas)


# ── Fotos de un documento (editor del documento técnico) ───────────────────

_PREFIJOS_DOC = ("borrador_ft_coa_sds_", "vacio_ft_coa_sds_", "ft_coa_sds_")


def _raiz_doc(archivo: str) -> str:
    s = re.sub(r"\.ya?ml$", "", str(archivo or "").strip(), flags=re.I)
    for p in _PREFIJOS_DOC:
        if s.startswith(p):
            return s[len(p):]
    return s


def fotos_de_documento(raiz: str) -> list[dict]:
    """Fotos del grupo «COA y fichas técnicas» que actualizaron este documento (por la raíz del
    slug, así el borrador, el vacío y el final comparten fotos). Solo las que siguen en disco."""
    raiz = _raiz_doc(raiz)
    if not raiz or not _DB.exists():
        return []
    with _conn() as c:
        filas = [dict(r) for r in c.execute(
            "SELECT mensaje_id, canal_id, ruta, estado, producto, lote, archivo_doc, creado_en FROM coa_fotos "
            "WHERE archivo_doc IS NOT NULL AND archivo_doc != '' ORDER BY creado_en DESC, mensaje_id")]
    fotos = [
        {k: f[k] for k in ("mensaje_id", "estado", "producto", "lote", "archivo_doc", "creado_en")}
        for f in filas if _raiz_doc(f["archivo_doc"]) == raiz and os.path.isfile(f["ruta"])
    ]
    # El COA más reciente primero; sus páginas en el orden en que llegaron.
    ultimo: dict[str, float] = {}
    for f in fotos:
        ultimo[f["lote"] or ""] = max(ultimo.get(f["lote"] or "", 0), f["creado_en"])
    return sorted(fotos, key=lambda f: (-ultimo[f["lote"] or ""], f["mensaje_id"]))


def ruta_foto(mensaje_id: int) -> str | None:
    with _conn() as c:
        r = c.execute("SELECT ruta FROM coa_fotos WHERE mensaje_id=?", (int(mensaje_id),)).fetchone()
    return r["ruta"] if r and os.path.isfile(r["ruta"]) else None
