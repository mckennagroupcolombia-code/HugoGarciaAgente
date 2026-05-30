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
            return {
                "cas": str(cas or "").strip(),
                "formula_molecular": str(p.get("MolecularFormula") or "").strip(),
                "nombre_iupac": str(p.get("IUPACName") or "").strip(),
                "masa_molecular": str(p.get("MolecularWeight") or "").strip(),
                "fuente_pubchem": f"https://pubchem.ncbi.nlm.nih.gov/compound/{p.get('CID', '')}",
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

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(model="gemini-2.5-pro", contents=prompt)
        return _extraer_json(resp.text or "")
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
