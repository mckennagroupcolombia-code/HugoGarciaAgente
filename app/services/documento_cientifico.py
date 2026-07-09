"""
Enriquecimiento de datos COA/SDS/TDS con PubChem, PubMed, ficha Sheets y síntesis Gemini.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any

import requests

from app.tools.knowledge_agent import buscar_arxiv, buscar_pubmed


def _vacio(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        return not val.strip()
    if isinstance(val, (list, dict)):
        return len(val) == 0
    return False


def _merge_profundo(base: dict, nuevo: dict) -> dict:
    """Conserva valores existentes no vacíos en base."""
    out = dict(base)
    for k, v in (nuevo or {}).items():
        if k not in out or _vacio(out[k]):
            out[k] = v
        elif isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _merge_profundo(out[k], v)
        elif isinstance(out.get(k), list) and isinstance(v, list) and _vacio(out[k]):
            out[k] = v
    return out


def buscar_pubchem(nombre: str) -> dict[str, Any]:
    """Propiedades básicas vía PubChem PUG REST (sin API key)."""
    term = (nombre or "").strip()
    if not term:
        return {}
    props = "MolecularFormula,MolecularWeight,IUPACName,CAS,CanonicalSMILES"
    for endpoint in (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{requests.utils.quote(term)}/property/{props}/JSON",
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{requests.utils.quote(term.split()[0])}/property/{props}/JSON",
    ):
        try:
            r = requests.get(endpoint, timeout=12)
            if r.status_code != 200:
                continue
            data = r.json()
            props_list = data.get("PropertyTable", {}).get("Properties") or []
            if not props_list:
                continue
            p = props_list[0]
            cas = p.get("CAS")
            if isinstance(cas, list):
                cas = cas[0] if cas else ""
            _cid = str(p.get("CID") or "").strip()
            return {
                "cas": str(cas or "").strip(),
                "formula_molecular": str(p.get("MolecularFormula") or "").strip(),
                "nombre_iupac": str(p.get("IUPACName") or "").strip(),
                "masa_molecular": str(p.get("MolecularWeight") or "").strip(),
                "cid": _cid,
                "fuente_pubchem": f"https://pubchem.ncbi.nlm.nih.gov/compound/{_cid}",
            }
        except Exception:
            continue
    return {}


def recopilar_fuentes(titulo: str, max_pubmed: int = 5) -> dict[str, Any]:
    termino = f"{titulo} cosmetic pharmaceutical safety"
    pubmed = buscar_pubmed(termino, max_results=max_pubmed)
    if not pubmed:
        pubmed = buscar_pubmed(titulo, max_results=max_pubmed)
    arxiv = buscar_arxiv(titulo, max_results=2)
    pubchem = buscar_pubchem(titulo)

    ficha_sheets = None
    try:
        from app.services.google_services import buscar_ficha_tecnica_producto

        ficha_sheets = buscar_ficha_tecnica_producto(titulo)
    except Exception:
        pass

    bloques = []
    if pubchem:
        bloques.append(
            "PubChem: "
            + ", ".join(f"{k}={v}" for k, v in pubchem.items() if v and k != "fuente_pubchem")
        )
    if ficha_sheets:
        bloques.append(f"Ficha técnica interna (Sheets):\n{ficha_sheets[:4000]}")
    for art in pubmed:
        bloques.append(
            f"[PubMed {art.get('año')} PMID:{art.get('pmid')}] {art.get('titulo')}\n{art.get('abstract', '')[:1200]}"
        )
    for art in arxiv:
        bloques.append(
            f"[ArXiv {art.get('año')}] {art.get('titulo')}\n{art.get('abstract', '')[:800]}"
        )

    urls = [a.get("url") for a in pubmed if a.get("url")]
    if pubchem.get("fuente_pubchem"):
        urls.append(pubchem["fuente_pubchem"])

    return {
        "pubchem": pubchem,
        "pubmed": pubmed,
        "arxiv": arxiv,
        "ficha_sheets": ficha_sheets,
        "contexto": "\n\n---\n\n".join(bloques)[:12000],
        "referencias": urls[:15],
    }


def _extraer_json(texto: str) -> dict | None:
    if not texto:
        return None
    t = texto.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    i, j = t.find("{"), t.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(t[i : j + 1])
        except json.JSONDecodeError:
            return None
    return None


def _sintetizar_json(prompt: str) -> dict | None:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY no configurada (requerida para completar documentos)")
    try:
        from google import genai

        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
        client = genai.Client(api_key=api_key)
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(lambda: client.models.generate_content(model="gemini-2.5-pro", contents=prompt))
            try:
                resp = fut.result(timeout=75)
            except FutureTimeout:
                raise RuntimeError("Gemini tardó demasiado — intente de nuevo")
        return _extraer_json(resp.text or "")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Gemini no completó datos: {exc}") from exc


_PROMPT_SDS = """Eres el departamento de calidad y seguridad de McKenna Group S.A.S. (Bogotá, Colombia).
Materias primas cosméticas y farmacéuticas. Redacta una HOJA DE DATOS DE SEGURIDAD (SDS) en español
siguiendo formato GHS (16 secciones) como la ficha Ventós SDS ELEMI: subapartados 1.1, 2.1, 2.2, etc.

PRODUCTO: {titulo}

DATOS YA CONOCIDOS (JSON, no sobrescribir si vienen completos):
{datos_json}

EVIDENCIA CIENTÍFICA Y TÉCNICA:
{contexto}

INSTRUCCIONES:
- Completa SOLO campos faltantes o genéricos usando la evidencia. No inventes CAS ni datos numéricos sin respaldo.
- Para ingredientes cosméticos comunes sin clasificación peligrosa: "No clasificado como peligroso según criterios GHS" si aplica.
- Teléfono emergencia Colombia: Servicio Información Toxicológica (SIT) +34 91 562 0420 o local 123 Bogotá.
- Proveedor: MCKENNA GROUP S.A.S., Bogotá, Colombia, www.mckennagroup.co
- Cada sección ghs.s01…s16: texto multilínea con subapartados numerados (1.1, 2.1, 2.2, 4.1, etc.) como SDS Ventós/ELEMI.
- Sección 2: clasificación CLP, pictogramas, palabra de advertencia, frases H y P.
- Sección 9: además de ghs.s09, rellene propiedades_fisicas (aspecto, color, olor, pH, densidad, solubilidad…).
- Tono técnico, español de Colombia.

Responde ÚNICAMENTE JSON válido (sin markdown) con esta estructura:
{{
  "titulo": "...",
  "referencia": "...",
  "fecha_revision": "DD-MM-AAAA",
  "version": "1.0/GHS/ES",
  "identificacion": {{
    "nombre_comercial": "", "referencia_interna": "", "nombre_inci": "", "cas": "",
    "numero_ce": "", "formula_molecular": "", "usos": "", "telefono_emergencia": ""
  }},
  "ghs": {{
    "s01": "texto sección 1 (1.1–1.4)",
    "s02": "sección 2 peligros (2.1–2.3)", "s03": "...", "s04": "...", "s05": "...",
    "s06": "...", "s07": "...", "s08": "...", "s10": "...", "s11": "...",
    "s12": "...", "s13": "...", "s14": "...", "s15": "...", "s16": "..."
  }},
  "propiedades_fisicas": {{
    "aspecto": "", "color": "", "olor": "", "ph": "", "densidad": "",
    "solubilidad_agua": "", "punto_inflamacion": ""
  }},
  "propiedades": [["Aspecto", "valor"], ["pH", "valor"]],
  "referencias_usadas": ["url o pmid..."]
}}"""


_PROMPT_COA = """Eres calidad McKenna Group S.A.S. Completa un CERTIFICADO DE ANÁLISIS (COA) en español.

PRODUCTO: {titulo}

DATOS PARCIALES:
{datos_json}

EVIDENCIA:
{contexto}

- No inventes resultados analíticos numéricos sin respaldo; use rangos típicos de grado cosmético solo si la literatura lo sugiere.
- Marque campos inciertos con "Según especificación proveedor" o "Conforme".

JSON únicamente:
{{
  "titulo": "...",
  "identificacion": {{ "nombre_comercial": "", "referencia_interna": "", "nombre_inci": "", "cas": "",
    "formula_molecular": "", "einces": "", "concentracion": "", "grado": "Cosmético",
    "presentacion": "", "incluye": "" }},
  "lote": {{ "numero": "I-AAAA", "fecha_fabricacion": "", "fecha_vencimiento": "", "vida_util": "24 meses",
    "tamano_lote": "", "pais_origen": "", "fecha_analisis": "", "fecha_emision": "" }},
  "parametros": [["Parámetro", "Especificación", "Resultado"]],
  "empaque": {{ "empaque_original": "", "almacenamiento": "", "precauciones": "", "observaciones": "" }},
  "codigo_verificacion": "MKG-COA-...",
  "referencias_usadas": []
}}"""


_PROMPT_FT = """Eres técnico McKenna Group. Completa datos de FICHA TÉCNICA (TDS) en español colombiano.

PRODUCTO: {titulo}
DATOS PARCIALES: {datos_json}
EVIDENCIA: {contexto}

JSON únicamente:
{{
  "titulo": "...",
  "descripcion": "párrafo",
  "aplicaciones": ["..."],
  "identidad": [["campo", "valor"]],
  "propiedades": [["campo", "valor"]],
  "microbiologia": [["campo", "valor"]],
  "nota_micro": "",
  "estabilidad": ["..."],
  "referencias_usadas": []
}}"""


def completar_datos_documento(
    tipo: str,
    titulo: str,
    datos: dict | None = None,
) -> dict[str, Any]:
    """
    tipo: 'sds' | 'coa' | 'fichas'
    Retorna datos enriquecidos + metadatos de fuentes.
    """
    titulo = (titulo or (datos or {}).get("titulo") or "").strip()
    if not titulo:
        raise ValueError("Se requiere titulo del producto")

    base = dict(datos or {})
    base.setdefault("titulo", titulo)

    fuentes = recopilar_fuentes(titulo)
    if fuentes.get("pubchem"):
        pc = fuentes["pubchem"]
        ident = base.setdefault("identificacion", {})
        if _vacio(ident.get("cas")) and pc.get("cas"):
            ident["cas"] = pc["cas"]
        if _vacio(ident.get("nombre_inci")) and pc.get("nombre_iupac"):
            ident["nombre_inci"] = pc["nombre_iupac"]
        if _vacio(ident.get("formula_molecular")) and pc.get("formula_molecular"):
            ident["formula_molecular"] = pc["formula_molecular"]

    prompts = {"sds": _PROMPT_SDS, "coa": _PROMPT_COA, "fichas": _PROMPT_FT, "ft": _PROMPT_FT}
    prompt_tpl = prompts.get(tipo.lower())
    if not prompt_tpl:
        raise ValueError(f"Tipo no soportado: {tipo}")

    prompt = prompt_tpl.format(
        titulo=titulo,
        datos_json=json.dumps(base, ensure_ascii=False, indent=2)[:6000],
        contexto=fuentes.get("contexto") or "(sin fuentes externas)",
    )
    generado = _sintetizar_json(prompt)
    if not generado:
        raise RuntimeError("La IA no devolvió JSON válido para completar el documento")

    refs_ia = generado.pop("referencias_usadas", []) or []
    merged = _merge_profundo(base, generado)

    if _vacio(merged.get("fecha_revision")) and not _vacio(merged.get("fecha_emision")):
        merged["fecha_revision"] = merged["fecha_emision"]
    if _vacio(merged.get("fecha_revision")):
        merged["fecha_revision"] = datetime.now().strftime("%d-%m-%Y")

    import yaml as _yaml

    return {
        "ok": True,
        "datos": merged,
        "yaml": _yaml.dump(merged, allow_unicode=True, sort_keys=False),
        "fuentes": {
            "pubmed_count": len(fuentes.get("pubmed") or []),
            "arxiv_count": len(fuentes.get("arxiv") or []),
            "pubchem": bool(fuentes.get("pubchem")),
            "ficha_sheets": bool(fuentes.get("ficha_sheets")),
            "referencias": list(dict.fromkeys((fuentes.get("referencias") or []) + refs_ia))[:20],
        },
    }


def _sintetizar_texto(prompt: str) -> str:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY no configurada (requerida para sugerencias IA)")
    try:
        from google import genai

        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
        client = genai.Client(api_key=api_key)
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(lambda: client.models.generate_content(model="gemini-2.5-flash", contents=prompt))
            try:
                resp = fut.result(timeout=30)
            except FutureTimeout:
                raise RuntimeError("Gemini tardó demasiado — intente de nuevo en unos segundos")
        text = (resp.text or "").strip()
        text = re.sub(r"^```[\w]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
        return text.strip()
    except Exception as exc:
        raise RuntimeError(f"Gemini no generó sugerencia: {exc}") from exc


def _get_pubchem_cid(nombre: str) -> str | None:
    """CID de PubChem para un nombre de compuesto."""
    url = (
        "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/"
        f"{requests.utils.quote(nombre)}/cids/JSON"
    )
    try:
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            cids = r.json().get("IdentifierList", {}).get("CID", [])
            return str(cids[0]) if cids else None
    except Exception:
        pass
    return None


def _extraer_textos_pug(nodo, buf: list | None = None, limite: int = 8) -> list[str]:
    """Extrae cadenas de texto de la respuesta jerárquica PUG View."""
    if buf is None:
        buf = []
    if len(buf) >= limite:
        return buf
    if isinstance(nodo, dict):
        if "StringWithMarkup" in nodo:
            for swm in nodo["StringWithMarkup"]:
                s = (swm.get("String") or "").strip()
                if s and s not in buf:
                    buf.append(s)
                if len(buf) >= limite:
                    break
        elif "Number" in nodo:
            unit = nodo.get("Unit", "")
            for num in nodo.get("Number", []):
                t = f"{num} {unit}".strip()
                if t and t not in buf:
                    buf.append(t)
                if len(buf) >= limite:
                    break
        else:
            for v in nodo.values():
                _extraer_textos_pug(v, buf, limite)
    elif isinstance(nodo, list):
        for item in nodo:
            _extraer_textos_pug(item, buf, limite)
    return buf


def _pug_view(cid: str, heading: str) -> list[str]:
    """Valores de una sección específica del PUG View para un CID."""
    url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON"
        f"?heading={requests.utils.quote(heading)}"
    )
    try:
        r = requests.get(url, timeout=14)
        if r.status_code == 200:
            return _extraer_textos_pug(r.json())[:5]
    except Exception:
        pass
    return []


def _sinonimos_pubchem(nombre: str, cid: str | None = None) -> list[str]:
    """Lista de sinónimos de PubChem."""
    if not cid:
        cid = _get_pubchem_cid(nombre)
    if not cid:
        return []
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/synonyms/JSON"
    try:
        r = requests.get(url, timeout=12)
        if r.status_code == 200:
            info = r.json().get("InformationList", {}).get("Information", [])
            return list(info[0].get("Synonym", []))[:5] if info else []
    except Exception:
        pass
    return []


_CAMPOS_PERMITIDOS = {
    "sinonimos", "cas", "inci", "descripcion",
    "apariencia", "punto_fusion", "indice_saponificacion", "ph", "olor", "sabor",
    "formula_quimica", "solubilidad",
    "modo_uso", "propiedades_lista", "aplicaciones", "composicion",
    "recomendaciones", "nombre_comercial",
    "sds_clasificacion_ghs", "sds_pictogramas", "sds_primeros_auxilios", "sds_manipulacion",
    "coa_einecs", "coa_grado",
}

_PROMPT_BASE = (
    'Eres especialista en materias primas farmacéuticas y cosméticas de McKenna Group S.A.S. (Bogotá, Colombia). '
    'Responde en español técnico, sin saludos, sin markdown, sin títulos.'
)

# Campos cuya respuesta es una oración o frase corta (no un valor/código ni una
# lista multilínea): deben terminar siempre en punto para verse consistentes
# en la casilla del formulario, sin importar si el valor vino de PubChem o de
# Gemini (ninguna de las dos fuentes lo garantiza de forma confiable).
_CAMPOS_ORACION_CORTA = {
    "descripcion", "apariencia", "olor", "sabor", "solubilidad",
    "modo_uso", "sds_clasificacion_ghs", "sds_manipulacion",
}


def _asegurar_punto_final(texto: str) -> str:
    t = (texto or "").strip()
    if not t or t[-1] in ".!?…:;":
        return t
    if not re.search(r"[\wáéíóúñ%°\)\]\"']$", t, re.I):
        return t
    return t + "."


def _asegurar_punto_final_lineas(texto: str) -> str:
    """Como _asegurar_punto_final pero por cada línea: para campos con una
    oración por renglón (ej. aplicaciones), donde cada línea se renderiza
    como un ítem independiente en el PDF y debe llevar su propia puntuación."""
    lineas = (texto or "").split("\n")
    return "\n".join(_asegurar_punto_final(ln) if ln.strip() else ln for ln in lineas)


def sugerir_campo_ficha(campo: str, nombre: str) -> dict[str, Any]:
    """Sugerencia IA para cualquier campo del formulario de ficha técnica.
    Usa PubChem PUG REST/View como fuente primaria; Gemini como síntesis."""
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("Se requiere nombre del producto")

    campo = (campo or "").strip().lower()
    if campo not in _CAMPOS_PERMITIDOS:
        raise ValueError(f"Campo no soportado: {campo}")

    # ── Sinónimos: Gemini Flash directo, sin PubChem (evita timeouts de red) ────
    if campo == "sinonimos":
        valor = _sintetizar_texto(
            f'{_PROMPT_BASE}\n'
            f'Genera exactamente 5 sinónimos en español para "{nombre}".\n'
            'Reglas obligatorias:\n'
            f'- NO incluir el nombre "{nombre}" ni ninguna variación del mismo.\n'
            '- NO incluir nombres en inglés.\n'
            '- SÍ incluir el número de aditivo alimentario (E-XXX o INS XXX) si aplica, como uno de los 5.\n'
            '- SÍ incluir nombre INCI y nombre químico sistemático en español.\n'
            '- Exactamente 5 sinónimos, únicos, sin repetir información.\n'
            '- Responde SOLO los 5 separados por punto y coma, sin títulos, sin numeración, sin explicaciones.'
        )
        return {"ok": True, "campo": campo, "valor": valor, "origen": "gemini"}

    # ── 1. PubChem: CID + propiedades básicas (una sola llamada HTTP) ──────────
    pc = buscar_pubchem(nombre)
    cid: str | None = pc.get("cid") or None
    if not cid:
        cid = _get_pubchem_cid(nombre)

    # ── 2. Respuestas directas desde PubChem (sin Gemini) ───────────────────
    if campo == "cas":
        if pc.get("cas"):
            return {"ok": True, "campo": campo, "valor": pc["cas"], "origen": "pubchem"}
        valor = _sintetizar_texto(
            f'{_PROMPT_BASE}\nIndica el número CAS principal del compuesto "{nombre}".\n'
            "Responde SOLO con el número CAS (formato 0000-00-0) o \"No aplica\"."
        )
        m = re.search(r"\d{2,7}-\d{2}-\d", valor)
        return {"ok": True, "campo": campo, "valor": m.group(0) if m else valor.strip(), "origen": "gemini"}

    if campo == "formula_quimica":
        if pc.get("formula_molecular"):
            return {"ok": True, "campo": campo, "valor": pc["formula_molecular"], "origen": "pubchem"}
        if cid:
            vals = _pug_view(cid, "Molecular Formula")
            if vals:
                return {"ok": True, "campo": campo, "valor": vals[0], "origen": "pubchem"}
        valor = _sintetizar_texto(
            f'{_PROMPT_BASE}\nIndica la fórmula química molecular de "{nombre}".\n'
            "Responde SOLO con la fórmula (ej. C6H12O6) o \"No aplica\"."
        )
        return {"ok": True, "campo": campo, "valor": valor.split("\n")[0].strip(), "origen": "gemini"}

    # ── 3. Campos físico-químicos vía PUG View ───────────────────────────────
    _PUG_MAP: dict[str, list[str]] = {
        "apariencia":   ["Physical Description", "Color/Form", "Color Form"],
        "olor":         ["Odor"],
        "punto_fusion": ["Melting Point"],
        "solubilidad":  ["Solubility"],
        "ph":           ["pH"],
    }
    if campo in _PUG_MAP and cid:
        for heading in _PUG_MAP[campo]:
            vals = _pug_view(cid, heading)
            if vals:
                valor = "; ".join(vals[:3])
                if campo in _CAMPOS_ORACION_CORTA:
                    valor = _asegurar_punto_final(valor)
                return {"ok": True, "campo": campo, "valor": valor, "origen": "pubchem"}

    # ── 4. Contexto enriquecido para Gemini ──────────────────────────────────
    fuentes = recopilar_fuentes(nombre)
    ctx = (fuentes.get("contexto") or "")[:3500]
    pc_info = ", ".join(f"{k}={v}" for k, v in pc.items() if v and k != "fuente_pubchem") if pc else ""

    _PROMPTS: dict[str, str] = {
        "inci": (
            f'Indica el nombre INCI (International Nomenclature of Cosmetic Ingredients) o nombre químico IUPAC de "{nombre}".\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde en UNA sola línea con el nombre exacto. Sin markdown."
        ),
        "descripcion": (
            f'Redacta una descripción técnica (80-130 palabras) de "{nombre}" para ficha técnica McKenna Group.\n'
            "Énfasis obligatorio: origen, modo de obtención y proceso de extracción/síntesis.\n"
            "NO mencionar apariencia física, color, textura ni estado físico (eso va en otro campo).\n"
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Tono técnico. Sin saludo, sin markdown."
        ),
        "apariencia": (
            f'Describe en una línea concisa la apariencia física de "{nombre}" (estado, color, textura, forma).\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Responde en UNA sola línea. Sin markdown."
        ),
        "punto_fusion": (
            f'Indica el punto de fusión o rango de fusión de "{nombre}" con sus unidades (°C o °F).\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde en UNA línea (ej. 58-62 °C). Sin markdown."
        ),
        "indice_saponificacion": (
            f'Indica el índice de saponificación de "{nombre}" (mg KOH/g).\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Responde en UNA línea con el valor y unidad. Si no aplica escribe \"No aplica\"."
        ),
        "ph": (
            f'Indica el pH o rango de pH de "{nombre}" en solución acuosa.\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde en UNA línea (ej. 4.5-6.0 en sol. 10%). Sin markdown."
        ),
        "olor": (
            f'Describe en una línea concisa el olor característico de "{nombre}".\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde en UNA sola línea. Sin markdown."
        ),
        "sabor": (
            f'Describe en una línea concisa el sabor característico de "{nombre}" para uso farmacéutico/cosmético.\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Ejemplos: Insípido, Ligeramente amargo, Dulce, Salino, Astringente, Sin sabor apreciable.\n"
            "Responde en UNA sola línea. Sin markdown."
        ),
        "solubilidad": (
            f'Describe la solubilidad de "{nombre}" en agua y solventes orgánicos.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Responde en UNA o dos líneas concisas. Sin markdown."
        ),
        "humedad": (
            f'Indica el contenido máximo de humedad permitido para "{nombre}" según especificaciones típicas.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Responde en UNA línea (ej. ≤ 5.0%). Sin markdown."
        ),
        "inercia_quimica": (
            f'Describe la inercia química o estabilidad química de "{nombre}": incompatibilidades, reactividad, condiciones a evitar.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Responde en 1-2 líneas técnicas. Sin markdown."
        ),
        "modo_uso": (
            f'Redacta el modo de uso recomendado de "{nombre}" en formulaciones farmacéuticas o cosméticas.\n'
            f"EVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Incluye: concentración típica, forma de incorporación, temperatura, orden de adición. "
            "2-4 oraciones técnicas. Sin markdown."
        ),
        "propiedades_lista": (
            f'Lista los principales beneficios de "{nombre}" como materia prima para formulaciones farmacéuticas y cosméticas.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Formato ESTRICTO: un beneficio por línea como \"Nombre del beneficio|Descripción breve\".\n"
            "Ejemplo:\nEmoliente|Suaviza y acondiciona la piel\nAntioxidante|Protege frente al estrés oxidativo\n"
            "Sin markdown, sin numeración."
        ),
        "aplicaciones": (
            f'Lista las principales aplicaciones de "{nombre}" en la industria farmacéutica y cosmética.\n'
            f"EVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Una aplicación por línea, frases cortas y directas. Sin numeración, sin guiones, sin markdown."
        ),
        "recomendaciones": (
            f'Genera recomendaciones de manejo seguro para "{nombre}" siguiendo el Sistema Globalmente Armonizado (GHS/SGA).\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Formato ESTRICTO: una línea por categoría, empezando con el nombre de la categoría en mayúsculas seguido de dos puntos.\n"
            "Categorías requeridas (solo las que apliquen):\n"
            "SEÑAL DE PELIGRO: Peligro / Advertencia / Sin peligro\n"
            "INDICACIONES H: [códigos H y descripción]\n"
            "PREVENCIÓN: [medidas P de prevención]\n"
            "RESPUESTA: [medidas P de respuesta ante emergencia]\n"
            "ALMACENAMIENTO: [condiciones seguras de almacenamiento; referirse siempre a EMPAQUE, nunca a envase]\n"
            "ELIMINACIÓN: [disposición de residuos; referirse siempre a EMPAQUE, nunca a envase]\n"
            "PRIMEROS AUXILIOS: [inhalación / contacto piel / contacto ocular / ingestión]\n"
            "EPP REQUERIDO: [equipos de protección personal]\n"
            "Sin markdown, sin viñetas, sin saludo."
        ),
        "composicion": (
            f'Indica la composición típica de "{nombre}" con sus componentes y porcentajes o concentraciones.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Formato ESTRICTO: una fila por línea como \"Componente|Porcentaje\".\n"
            "Ejemplo:\nIllita|75% ± 5\nCaolinita|15% ± 3\nCuarzo|Trazas\n"
            "Sin markdown, sin encabezados."
        ),
        "nombre_comercial": (
            f'Indica el nombre comercial o de marca más reconocido de "{nombre}" en la industria farmacéutica y cosmética latinoamericana.\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde en UNA sola línea con el nombre comercial. Sin markdown."
        ),
        "sds_clasificacion_ghs": (
            f'Genera la clasificación GHS/CLP de "{nombre}" según el Sistema Globalmente Armonizado (SGA/GHS).\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Incluye: categoría de peligro, clase de peligro, palabra de advertencia (Peligro/Advertencia) y frases H relevantes.\n"
            "Si la sustancia no presenta peligros significativos, indícalo claramente.\n"
            "2-4 líneas técnicas. Sin markdown."
        ),
        "sds_pictogramas": (
            f'Lista los pictogramas GHS aplicables a "{nombre}" y las frases H y P más relevantes.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Formato: una línea por elemento.\n"
            "Ejemplo:\nGHS07 - Nocivo\nH302: Nocivo en caso de ingestión\nP260: No respirar los vapores\n"
            "Sin markdown. Si no aplica pictograma, indicarlo."
        ),
        "sds_primeros_auxilios": (
            f'Redacta las instrucciones de primeros auxilios para "{nombre}" en caso de exposición accidental.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Formato ESTRICTO: una línea por vía de exposición como \"Caso|Instrucción\".\n"
            "Ejemplo:\nInhalación|Llevar al afectado a lugar ventilado; consultar médico si persiste\n"
            "Contacto piel|Lavar con agua y jabón abundante durante 15 minutos\n"
            "Contacto ojos|Enjuagar con agua limpia durante 15 minutos; consultar oftalmólogo\n"
            "Ingestión|No inducir vómito; consultar médico inmediatamente\n"
            "Sin markdown, sin encabezados."
        ),
        "sds_manipulacion": (
            f'Redacta las instrucciones de manipulación segura de "{nombre}" para uso industrial/cosmético/farmacéutico.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Incluye: EPP recomendado, ventilación, precauciones generales, incompatibilidades a evitar.\n"
            "2-4 oraciones técnicas en español. Sin markdown, sin listas."
        ),
        "coa_einecs": (
            f'Indica el número EINECS (European Inventory of Existing Commercial Chemical Substances) de "{nombre}".\n'
            f"PubChem: {pc_info or 'sin datos'}\n"
            "Responde SOLO con el número EINECS (formato 000-000-0) o \"No aplica\". Sin markdown."
        ),
        "coa_grado": (
            f'Indica el grado de calidad estándar de "{nombre}" para uso en industria farmacéutica y cosmética.\n'
            f"PubChem: {pc_info or 'sin datos'}\nEVIDENCIA:\n{ctx or '(sin fuentes)'}\n"
            "Ejemplos: Grado Farmacéutico USP/NF, Grado Cosmético, Grado Alimentario FCC, Grado Reactivo ACS.\n"
            "Responde en UNA línea concisa. Sin markdown."
        ),
    }

    prompt_texto = _PROMPTS.get(campo)
    if not prompt_texto:
        raise ValueError(f"Campo no tiene prompt configurado: {campo}")

    valor = _sintetizar_texto(f"{_PROMPT_BASE}\n{prompt_texto}")
    if campo in _CAMPOS_ORACION_CORTA:
        valor = _asegurar_punto_final(valor)
    elif campo == "aplicaciones":
        valor = _asegurar_punto_final_lineas(valor)
    return {"ok": True, "campo": campo, "valor": valor, "origen": "gemini"}


def sugerir_multiples_campos(nombre: str, campos: list[str]) -> dict[str, str | None]:
    """Sugiere varios campos en paralelo (PubChem + Gemini).

    Retorna {campo: valor_sugerido | None si falló}.
    Los campos no reconocidos se omiten.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    validos = [c for c in campos if c in _CAMPOS_PERMITIDOS]
    if not validos:
        return {}

    resultados: dict[str, str | None] = {}

    def _sugerir(campo: str) -> tuple[str, str | None]:
        try:
            r = sugerir_campo_ficha(campo, nombre)
            return (campo, r.get("valor") or None)
        except Exception:
            return (campo, None)

    workers = min(len(validos), 3)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_sugerir, c): c for c in validos}
        for fut in as_completed(futures, timeout=90):
            campo_key, valor = fut.result()
            resultados[campo_key] = valor

    return resultados
