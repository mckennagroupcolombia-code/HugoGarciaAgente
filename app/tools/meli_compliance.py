"""
Herramienta de compliance y autopublicación en Mercado Libre para McKenna Group.

McKenna reempaca materias primas (alimentarias, cosméticas e industriales).
NO vende suplementos terminados ni medicamentos.
Marco legal: Res. 2674/2013 Art. 37 num. 3.

Funciones principales:
  diagnosticar_riesgo(...)         — Detecta señales de riesgo de baja en MeLi
  generar_contenido_compliance(...)— Genera título/descripción/atributos compliant con Claude
  buscar_publicaciones_pausadas()  — Lista items pausados o bajados en MeLi
  republicar_item(...)             — Corrige y reactiva un ítem existente
  autopublicar_producto(...)       — Pipeline completo: diagnóstico → corrección → publicar
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from typing import Optional

import requests

from app.utils import refrescar_token_meli, obtener_seller_id_meli

# ── Constantes de compliance ───────────────────────────────────────────────

PALABRAS_RIESGO = [
    "grado farmacológico", "ph. eur", "usp", "farmacológico",
    "suplemento dietario", "suplemento dietético", "suplementos",
    "antiácido", "laxante", "estreñimiento",
    "salud ósea", "salud muscular", "cardiovascular", "dolores musculares",
    "magnesio elemental", "absorbido por el organismo", "absorción",
    "ciclo de krebs", "diálisis", "procedimiento médico",
    "dosis recomendada", "porción diaria", "tómalo", "consumir de una",
    "tratamiento", "medicamento para", "cura ",
    "sal de magnesio", "sal de calcio", "sal de zinc",
    "acné", "arrugas", "colágeno", "exfoliante", "antienvejecimiento", "antiedad",
    "% elemental", "mg por gramo", "mg por cápsula",
    "invima", "registro sanitario",
]

_RE_SAL_DE_MINERAL = re.compile(
    r"\bsal\s+de\s+(magnesio|calcio|zinc|potasio|sodio)\b",
    re.I,
)

PERFILES = {
    "materia_prima_alimentaria": {
        "subtitulo_etiqueta": "Insumo alimentario 100% puro · Res. 2674/2013 Art. 37-3",
        "uso_descripcion": (
            "formulación y elaboración de alimentos, bebidas, productos nutricionales "
            "e industria alimentaria"
        ),
        "linea_meli": "Materias primas alimentarias",
        "categoria_meli": "MCO8830",
        "domain_meli": "MCO-SUPPLEMENTS",
    },
    "insumo_cosmetico": {
        "subtitulo_etiqueta": "Insumo cosmético — materia prima para formulación",
        "uso_descripcion": (
            "formulación cosmética, elaboración de cremas, lociones, jabones "
            "y productos de cuidado personal a nivel industrial"
        ),
        "linea_meli": "Insumos cosméticos",
        "categoria_meli": "MCO8830",
        "domain_meli": "MCO-SUPPLEMENTS",
    },
    "insumo_tecnico": {
        "subtitulo_etiqueta": "Materia prima técnica para uso industrial",
        "uso_descripcion": (
            "formulación industrial, limpieza, tratamiento de agua, "
            "síntesis química y aplicaciones técnicas"
        ),
        "linea_meli": "Insumos técnicos",
        "categoria_meli": "MCO8830",
        "domain_meli": "MCO-SUPPLEMENTS",
    },
}

PIE_LEGAL = (
    "Distribuidor: McKenna Group S.A.S · Bogotá, Colombia\n"
    "Reenvase amparado por Res. 2674/2013 Art. 37 num. 3\n"
    "No es medicamento · No es suplemento dietario terminado\n"
    "Uso exclusivo en formulación y elaboración de productos"
)

# ── Diagnóstico de riesgo ──────────────────────────────────────────────────

def diagnosticar_riesgo(
    sku: str,
    nombre: str,
    titulo_meli: str = "",
    descripcion: str = "",
    texto_etiqueta: str = "",
    atributos_meli: Optional[dict] = None,
) -> dict:
    """
    Analiza el contenido de un producto y retorna nivel de riesgo de baja en MeLi.

    Returns:
        {
          "nivel": "bajo" | "medio" | "alto",
          "score": int (0-10),
          "señales": list[str],     # frases concretas encontradas
          "palabras_eliminar": list[str],
          "advertencias_taxonomia": list[str],
          "recomendaciones": list[str],
        }
    """
    texto_completo = " ".join([
        titulo_meli, descripcion, texto_etiqueta
    ]).lower()

    señales: list[str] = []
    for palabra in PALABRAS_RIESGO:
        if palabra.lower() in texto_completo:
            señales.append(palabra)

    # Señales de taxonomía
    advertencias_taxonomia: list[str] = []
    if atributos_meli:
        linea = str(atributos_meli.get("LINE", "")).lower()
        domain = str(atributos_meli.get("domain_id", "")).lower()
        if "sal" in linea:
            advertencias_taxonomia.append(
                f"LINE='{linea}' — 'Sal' en LINE clasifica el ítem como sal alimentaria, no materia prima"
            )
        if "mco-salt" in domain:
            advertencias_taxonomia.append(
                "domain_id='MCO-SALT' — usar MCO-SUPPLEMENTS para minerales en polvo"
            )
        if "sal de" in titulo_meli.lower():
            advertencias_taxonomia.append(
                f"Título usa 'Sal de' — cambiar a nombre químico correcto (ej. Citrato de magnesio)"
            )

    score = min(len(señales) * 2 + len(advertencias_taxonomia) * 3, 10)
    if score <= 2:
        nivel = "bajo"
    elif score <= 5:
        nivel = "medio"
    else:
        nivel = "alto"

    recomendaciones = []
    if señales:
        recomendaciones.append(
            f"Eliminar {len(señales)} frase(s) de riesgo: {', '.join(señales[:5])}"
        )
    if advertencias_taxonomia:
        recomendaciones.append(
            "Corregir taxonomía MeLi: domain_id=MCO-SUPPLEMENTS, LINE=Materias primas alimentarias"
        )
    if not any(kw in texto_completo for kw in ["materia prima", "insumo", "formulación", "res. 2674"]):
        recomendaciones.append(
            "Agregar identidad explícita: 'materia prima', 'insumo para formulación', 'Res. 2674/2013'"
        )

    return {
        "sku": sku,
        "nombre": nombre,
        "nivel": nivel,
        "score": score,
        "señales": señales,
        "palabras_eliminar": señales,
        "advertencias_taxonomia": advertencias_taxonomia,
        "recomendaciones": recomendaciones,
    }


# ── Generación de contenido con Claude ────────────────────────────────────

def _llm_generar_texto(prompt_sistema: str, prompt_usuario: str) -> tuple[Optional[str], Optional[str]]:
    """
    Genera texto con Claude (preferido) o Gemini (fallback).
    Returns (texto, error).
    """
    from dotenv import load_dotenv

    load_dotenv()

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if anthropic_key:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=anthropic_key)
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=prompt_sistema,
                messages=[{"role": "user", "content": prompt_usuario}],
            )
            return response.content[0].text.strip(), None
        except Exception as e:
            return None, str(e)

    gemini_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if gemini_key:
        try:
            from google import genai

            client = genai.Client(api_key=gemini_key)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"{prompt_sistema}\n\n{prompt_usuario}",
            )
            texto = (response.text or "").strip()
            if not texto:
                return None, "Gemini devolvió respuesta vacía"
            return texto, None
        except Exception as e:
            return None, str(e)

    return None, (
        "No hay API key de IA configurada. Agrega ANTHROPIC_API_KEY o GOOGLE_API_KEY en .env"
    )


def generar_contenido_compliance(
    sku: str,
    nombre: str,
    presentacion: str,
    perfil: str = "materia_prima_alimentaria",
    ficha_tecnica: str = "",
    titulo_actual: str = "",
    descripcion_actual: str = "",
) -> dict:
    """
    Usa Claude o Gemini para generar título, descripción y atributos MeLi compliant.

    Returns:
        {
          "titulo": str,
          "descripcion": str,
          "subtitulo_etiqueta": str,
          "bloque_etiqueta": str,
          "atributos": dict,
          "checklist": dict,
        }
    """
    perfil_info = PERFILES.get(perfil, PERFILES["materia_prima_alimentaria"])

    prompt_sistema = (
        "Eres un asesor de compliance comercial para McKenna Group S.A.S. (Colombia). "
        "McKenna reempaca y fracciona materias primas. NO vende suplementos ni medicamentos. "
        "Tu tarea es generar contenido MeLi y de etiqueta que cumpla Res. 2674/2013 Art. 37-3 "
        "y no sea bajado por el moderador de Mercado Libre."
    )

    contenido_actual = ""
    if titulo_actual:
        contenido_actual += f"\nTítulo actual (posiblemente incompliant): {titulo_actual}"
    if descripcion_actual:
        contenido_actual += f"\nDescripción actual (fragmento): {descripcion_actual[:500]}"
    if ficha_tecnica:
        contenido_actual += f"\nFicha técnica (filtrar claims de salud): {ficha_tecnica[:800]}"

    prompt_usuario = f"""Genera contenido de compliance para este producto McKenna:

SKU: {sku}
Nombre: {nombre}
Presentación: {presentacion}
Perfil: {perfil} — {perfil_info['subtitulo_etiqueta']}
{contenido_actual}

REGLAS ESTRICTAS:
- NO mencionar: dosis, consumo, absorción, salud ósea/muscular/cardiovascular, farmacológico, Ph.Eur, USP, INVIMA, laxante, antiácido, magnesio elemental, % elemental
- NO usar frases tipo "sal de magnesio/sal de calcio/sal de zinc" (usar "citrato de X", "compuesto de X con citrato" o "materia prima mineral")
- SÍ incluir: "materia prima", "insumo para formulación", "Res. 2674/2013 Art. 37-3", "no es suplemento terminado"
- Título MeLi máx 60 chars, formato: "{{Ingrediente}} En Polvo Puro {{presentación}} — Materia Prima"
- LINE MeLi: "{perfil_info['linea_meli']}"
- domain_id: "{perfil_info['domain_meli']}"

Responde SOLO con JSON válido con esta estructura exacta:
{{
  "titulo": "...",
  "descripcion": "...",
  "subtitulo_etiqueta": "...",
  "bloque_etiqueta": "...",
  "atributos": {{
    "LINE": "...",
    "INGREDIENTS": "...",
    "domain_id": "...",
    "category_id": "..."
  }}
}}

La descripcion debe tener 7 secciones: (1) encabezado, (2) qué es, (3) aplicaciones, (4) calidad/COA, (5) marco regulatorio, (6) advertencias, (7) distribuidor.
El bloque_etiqueta es el texto completo para imprimir en la etiqueta física alternativa (sin Ph.Eur, sin USP, con Res. 2674 visible).
"""

    texto, err = _llm_generar_texto(prompt_sistema, prompt_usuario)
    if err:
        return {"error": err}
    try:
        # Extraer JSON si el modelo añade texto antes/después
        m = re.search(r"\{.*\}", texto or "", re.DOTALL)
        if m:
            data = json.loads(m.group())
        else:
            data = json.loads(texto or "")

        data = _sanear_salida_compliance(data)

        # Agregar checklist automático
        data["checklist"] = _evaluar_checklist(
            data.get("titulo", ""),
            data.get("descripcion", ""),
            data.get("atributos", {}),
        )
        data["sku"] = sku
        data["perfil"] = perfil
        return data

    except json.JSONDecodeError as e:
        return {"error": f"La IA no devolvió JSON válido: {e}", "texto_raw": texto}


def _sanear_texto_compliance(texto: str) -> str:
    t = (texto or "").strip()
    if not t:
        return t
    def _repl_sal(m: re.Match[str]) -> str:
        base = f"citrato de {m.group(1).lower()}"
        return base.capitalize() if m.group(0)[:1].isupper() else base

    t = _RE_SAL_DE_MINERAL.sub(_repl_sal, t)
    t = re.sub(r"\s{2,}", " ", t)
    return t


def _sanear_salida_compliance(data: dict) -> dict:
    out = dict(data or {})
    for campo in ("titulo", "descripcion", "subtitulo_etiqueta", "bloque_etiqueta"):
        if isinstance(out.get(campo), str):
            out[campo] = _sanear_texto_compliance(out[campo])
    atrs = out.get("atributos")
    if isinstance(atrs, dict):
        atrs = dict(atrs)
        for k in ("LINE", "INGREDIENTS"):
            if isinstance(atrs.get(k), str):
                atrs[k] = _sanear_texto_compliance(atrs[k])
        out["atributos"] = atrs
    out = _forzar_clausulas_obligatorias(out)
    return out


def _forzar_clausulas_obligatorias(data: dict) -> dict:
    out = dict(data or {})
    desc = str(out.get("descripcion") or "").strip()
    bloque = str(out.get("bloque_etiqueta") or "").strip()
    req_res = "Res. 2674/2013 Art. 37-3"
    req_nosup = "no es suplemento terminado"

    if desc:
        desc_low = desc.lower()
        anexos: list[str] = []
        if "2674" not in desc_low:
            anexos.append(
                "Marco regulatorio: materia prima para formulación conforme a la "
                f"{req_res}."
            )
        if "suplemento terminado" not in desc_low:
            anexos.append("Este producto no es suplemento terminado ni medicamento.")
        if anexos:
            out["descripcion"] = f"{desc}\n\n" + "\n".join(anexos)

    if bloque:
        bloque_low = bloque.lower()
        anexos_b: list[str] = []
        if "2674" not in bloque_low:
            anexos_b.append(f"Marco regulatorio: {req_res}.")
        if "suplemento terminado" not in bloque_low:
            anexos_b.append("No es suplemento terminado ni medicamento.")
        if anexos_b:
            out["bloque_etiqueta"] = f"{bloque}\n" + "\n".join(anexos_b)

    # Refuerzo del subtítulo para publicaciones nuevas / alternativas
    subt = str(out.get("subtitulo_etiqueta") or "").strip()
    if subt:
        subt_low = subt.lower()
        if "2674" not in subt_low:
            subt = f"{subt} · {req_res}"
        if "suplemento terminado" not in subt_low:
            subt = f"{subt} · No es suplemento terminado"
        out["subtitulo_etiqueta"] = subt
    return out


def _evaluar_checklist(titulo: str, descripcion: str, atributos: dict) -> dict:
    texto = (titulo + " " + descripcion).lower()
    return {
        "titulo_nombre_quimico_correcto": "sal de" not in titulo.lower(),
        "descripcion_sin_sal_de": "sal de" not in descripcion.lower(),
        "titulo_incluye_materia_prima": any(
            kw in titulo.lower() for kw in ["materia prima", "insumo"]
        ),
        "sin_claims_salud": not any(
            kw in texto for kw in ["salud", "absorci", "terapéutic", "laxante", "antiácido"]
        ),
        "incluye_res_2674": "2674" in descripcion,
        "domain_correcto": atributos.get("domain_id", "").upper() == "MCO-SUPPLEMENTS",
        "line_correcto": "sal" not in str(atributos.get("LINE", "")).lower(),
        "sin_farma": not any(
            kw in texto for kw in ["ph. eur", "usp", "farmacológico", "grado farma"]
        ),
        "sin_dosis": not any(
            kw in texto for kw in ["dosis", "porción diaria", "tómalo", "consumir"]
        ),
        "pie_legal_presente": any(
            kw in descripcion.lower() for kw in ["mckenna", "res. 2674", "no es medicamento"]
        ),
        "una_publicacion_sku": True,  # Se valida externamente al publicar
    }


# ── MeLi API helpers ───────────────────────────────────────────────────────

def _headers() -> Optional[dict]:
    token = refrescar_token_meli()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _extraer_sku_item(item: dict) -> str:
    """SKU desde seller_custom_field o atributo SELLER_SKU (user products)."""
    sku = (item.get("seller_custom_field") or "").strip()
    if sku:
        return sku
    for attr in item.get("attributes") or []:
        if attr.get("id") == "SELLER_SKU":
            return (attr.get("value_name") or "").strip()
    return ""


def _extraer_line_item(item: dict) -> str:
    for attr in item.get("attributes") or []:
        if attr.get("id") == "LINE":
            return (attr.get("value_name") or "").strip()
    return ""


def _mapa_catalogo_por_sku() -> dict[str, dict]:
    try:
        from app.services.publicaciones import listar_publicaciones

        data = listar_publicaciones()
        return {
            i["sku"]: {"nombre": i.get("nombre", ""), "categoria": i.get("categoria", "")}
            for i in data.get("items", [])
            if i.get("sku")
        }
    except Exception:
        return {}


def _buscar_item_ids_paginado(
    seller_id: str,
    headers: dict,
    params: dict,
    *,
    max_items: int = 500,
) -> list[str]:
    """Recorre /users/{seller}/items/search con offset hasta agotar resultados."""
    ids: list[str] = []
    offset = 0
    limit = 100
    while offset < max_items:
        try:
            r = requests.get(
                f"https://api.mercadolibre.com/users/{seller_id}/items/search",
                params={**params, "limit": limit, "offset": offset},
                headers=headers,
                timeout=15,
            )
            if r.status_code != 200:
                break
            body = r.json()
            batch = body.get("results") or []
            if not batch:
                break
            ids.extend(batch)
            total = (body.get("paging") or {}).get("total", 0)
            offset += len(batch)
            if offset >= total:
                break
        except Exception:
            break
    return ids


def _item_a_resumen(d: dict, catalogo: dict[str, dict]) -> dict:
    sku = _extraer_sku_item(d)
    cat_info = catalogo.get(sku, {})
    item_id = d.get("id", "")
    return {
        "item_id": item_id,
        "title": d.get("title", ""),
        "status": d.get("status", ""),
        "sub_status": d.get("sub_status") or [],
        "sku": sku,
        "line": _extraer_line_item(d),
        "price": d.get("price", 0),
        "permalink": d.get("permalink", ""),
        "category_id": d.get("category_id", ""),
        "domain_id": d.get("domain_id", ""),
        "nombre_catalogo": cat_info.get("nombre", ""),
        "categoria_catalogo": cat_info.get("categoria", ""),
    }


def _fetch_items_multiget(item_ids: list[str], headers: dict) -> list[dict]:
    """Detalle de ítems en lotes de 20 (API multiget MeLi)."""
    items: list[dict] = []
    for i in range(0, len(item_ids), 20):
        lote = item_ids[i : i + 20]
        if not lote:
            continue
        try:
            r = requests.get(
                f"https://api.mercadolibre.com/items?ids={','.join(lote)}",
                headers=headers,
                timeout=25,
            )
            if r.status_code != 200:
                continue
            for wrap in r.json():
                if wrap.get("code") != 200:
                    continue
                body = wrap.get("body")
                if isinstance(body, dict):
                    items.append(body)
        except Exception:
            continue
    return items


def _prioridad_item(item: dict) -> tuple[int, str]:
    """Orden: prohibidas por política → Sales Minerales → resto (por título)."""
    sub = item.get("sub_status") or []
    prio = 0
    if "forbidden" in sub:
        prio = 0
    elif item.get("status") == "under_review":
        prio = 1
    elif item.get("status") == "paused":
        prio = 2
    else:
        prio = 3
    cat = (item.get("categoria_catalogo") or "").lower()
    if cat == "sales minerales":
        prio -= 1
    return (prio, (item.get("title") or "").lower())


def buscar_publicaciones_pausadas(
    incluir_cerradas: bool = True,
    incluir_pausadas: bool = False,
) -> dict:
    """
    Lista publicaciones del vendedor prohibidas por política y, opcionalmente, pausadas.

    Por defecto solo trae sub_status=forbidden (bajas por política MeLi) — carga rápida.
    Con incluir_pausadas=True agrega todas las pausadas (puede tardar más).

    Returns:
        {
          "ok": bool,
          "items": list[{item_id, title, status, sub_status, sku, ...}],
          "total": int,
          "conteos": dict,
          "incluye_pausadas": bool,
        }
    """
    headers = _headers()
    if not headers:
        return {
            "ok": False,
            "error": "No se pudo obtener token MeLi",
            "items": [],
            "total": 0,
            "incluye_pausadas": incluir_pausadas,
        }

    seller_id = obtener_seller_id_meli()
    busquedas: list[dict] = [{"sub_status": "forbidden"}]
    if incluir_pausadas:
        busquedas.extend([
            {"status": "paused"},
            {"status": "under_review"},
        ])
    if incluir_cerradas and incluir_pausadas:
        busquedas.append({"status": "closed"})

    item_ids: list[str] = []
    vistos: set[str] = set()
    for params in busquedas:
        for iid in _buscar_item_ids_paginado(seller_id, headers, params):
            if iid not in vistos:
                vistos.add(iid)
                item_ids.append(iid)

    catalogo = _mapa_catalogo_por_sku()
    detalles = _fetch_items_multiget(item_ids, headers)
    todos = [_item_a_resumen(d, catalogo) for d in detalles]
    todos.sort(key=_prioridad_item)

    conteos = {
        "forbidden": sum(1 for i in todos if "forbidden" in (i.get("sub_status") or [])),
        "paused": sum(1 for i in todos if i.get("status") == "paused"),
        "under_review": sum(1 for i in todos if i.get("status") == "under_review"),
        "closed": sum(1 for i in todos if i.get("status") == "closed"),
        "sales_minerales": sum(
            1 for i in todos if (i.get("categoria_catalogo") or "").lower() == "sales minerales"
        ),
    }

    return {
        "ok": True,
        "items": todos,
        "total": len(todos),
        "conteos": conteos,
        "incluye_pausadas": incluir_pausadas,
    }


def obtener_item_meli(item_id: str) -> Optional[dict]:
    """Obtiene datos completos de un ítem MeLi."""
    headers = _headers()
    if not headers:
        return None
    try:
        r = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            timeout=10,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def _titulo_a_family_name(titulo: str) -> str:
    """Nombre de familia UP: sin sufijo de presentación ni 'Materia Prima'."""
    t = (titulo or "").strip()
    for sep in (" — ", " - ", " – "):
        if sep in t:
            t = t.split(sep, 1)[0].strip()
    return t[:60]


def _restricciones_republicacion(item: dict) -> dict:
    """Qué campos MeLi permite editar según estado del ítem (User Products / forbidden)."""
    status = (item.get("status") or "").lower()
    sub = [str(s).lower() for s in (item.get("sub_status") or [])]
    forbidden = "forbidden" in sub
    bloqueado = forbidden or status == "under_review"
    sold = int(item.get("sold_quantity") or 0)
    has_family = bool((item.get("family_name") or "").strip())
    user_product = "user_product_listing" in (item.get("tags") or [])

    puede_descripcion = (
        status in {"active", "paused", "not_yet_active"}
        or "waiting_for_patch" in sub
    ) and not forbidden

    return {
        "forbidden": forbidden,
        "under_review": status == "under_review",
        "user_product": user_product,
        "tiene_family_name": has_family,
        "con_ventas": sold > 0,
        "sold_quantity": sold,
        "puede_titulo": not has_family and not user_product and not bloqueado,
        "puede_family_name": has_family and sold == 0 and not bloqueado,
        "puede_status": not bloqueado,
        "puede_precio": not bloqueado,
        "puede_descripcion": puede_descripcion,
        "puede_category": False,
        "puede_fotos": not bloqueado,
        "puede_atributos": True,
    }


def republicar_item(
    item_id: str,
    correcciones: dict,
    item_actual: Optional[dict] = None,
) -> dict:
    """
    Aplica correcciones compliance permitidas por MeLi y reactiva si es posible.

    En publicaciones prohibidas (sub_status=forbidden) o User Products con ventas,
    MeLi suele bloquear título, descripción, fotos y status. Solo atributos (LINE, etc.).

    Returns:
        ok, parcial, aplicado, omitido, acciones_manuales, restricciones, descripcion_para_pegar
    """
    headers = _headers()
    if not headers:
        return {"ok": False, "error": "Sin token MeLi", "item_id": item_id}

    item = item_actual or obtener_item_meli(item_id)
    if not item:
        return {"ok": False, "error": "No se pudo leer el ítem actual", "item_id": item_id}

    rest = _restricciones_republicacion(item)
    payload: dict = {}
    aplicado: list[str] = []
    omitido: list[dict] = []
    acciones_manuales: list[str] = []

    titulo = (correcciones.get("titulo") or "").strip()
    if titulo:
        if rest["puede_titulo"]:
            payload["title"] = titulo
            aplicado.append("title")
        elif rest["puede_family_name"]:
            payload["family_name"] = _titulo_a_family_name(titulo)
            aplicado.append("family_name")
        else:
            razon = (
                "User Product con ventas: family_name no editable por API"
                if rest["tiene_family_name"] and rest["con_ventas"]
                else "MeLi bloquea título/family_name en publicación prohibida o en revisión"
            )
            omitido.append({"campo": "titulo", "razon": razon})
            if rest["tiene_family_name"] and rest["con_ventas"]:
                acciones_manuales.append(
                    "El nombre de la publicación (family_name) no se puede cambiar por API "
                    f"porque ya tiene {rest['sold_quantity']} venta(s). "
                    "Edita el nombre en Moderaciones de MeLi o crea una publicación nueva compliant."
                )
            elif rest["forbidden"] or rest["under_review"]:
                acciones_manuales.append(
                    "MeLi no permite cambiar el título mientras la publicación está prohibida. "
                    "Usa el panel de Moderaciones en Mercado Libre para enviar la corrección."
                )

    if correcciones.get("attributes") and rest["puede_atributos"]:
        payload["attributes"] = correcciones["attributes"]
        if "attributes" not in aplicado:
            aplicado.append("attributes")

    if correcciones.get("category_id") and rest["puede_category"]:
        payload["category_id"] = correcciones["category_id"]
        aplicado.append("category_id")
    elif correcciones.get("category_id"):
        omitido.append({
            "campo": "category_id",
            "razon": "MeLi no permite cambiar categoría en este ítem",
        })

    if "price" in correcciones and rest["puede_precio"]:
        payload["price"] = correcciones["price"]
        aplicado.append("price")
    elif "price" in correcciones:
        omitido.append({
            "campo": "price",
            "razon": "Precio bloqueado mientras está prohibida/en revisión",
        })

    reactivar = correcciones.get("reactivar", True)
    if reactivar and rest["puede_status"]:
        payload["status"] = "active"
        aplicado.append("status")
    elif reactivar:
        omitido.append({
            "campo": "status",
            "razon": "No se puede reactivar por API en under_review/forbidden",
        })
        acciones_manuales.append(
            "No se puede reactivar por API mientras MeLi marca la publicación como prohibida. "
            "Corrige foto de etiqueta, descripción y atributos; luego solicita revisión en MeLi."
        )

    resultado_put: Optional[dict] = None
    if payload:
        try:
            r = requests.put(
                f"https://api.mercadolibre.com/items/{item_id}",
                json=payload,
                headers=headers,
                timeout=15,
            )
            if r.status_code in (200, 201):
                resultado_put = r.json()
            else:
                return {
                    "ok": False,
                    "item_id": item_id,
                    "error": f"HTTP {r.status_code}: {r.text[:400]}",
                    "restricciones": rest,
                    "omitido": omitido,
                    "acciones_manuales": acciones_manuales,
                }
        except Exception as e:
            return {
                "ok": False,
                "item_id": item_id,
                "error": str(e),
                "restricciones": rest,
            }
    elif not aplicado:
        return {
            "ok": False,
            "item_id": item_id,
            "error": "MeLi no permite modificar ningún campo solicitado en el estado actual",
            "restricciones": rest,
            "omitido": omitido,
            "acciones_manuales": acciones_manuales,
            "parcial": True,
        }

    descripcion = (correcciones.get("descripcion") or "").strip()
    descripcion_para_pegar: Optional[str] = None
    if descripcion:
        if rest["puede_descripcion"]:
            _actualizar_descripcion(item_id, descripcion, headers)
            aplicado.append("descripcion")
        else:
            omitido.append({
                "campo": "descripcion",
                "razon": "Descripción bloqueada mientras está prohibida/en revisión",
            })
            descripcion_para_pegar = descripcion
            acciones_manuales.append(
                "Copia la descripción generada y pégala en MeLi → publicación → Moderaciones / editar."
            )

    if rest["forbidden"] and rest["puede_fotos"] is False:
        acciones_manuales.append(
            "Sube la foto de la etiqueta alternativa (Studio → Alternativa) desde el panel de MeLi; "
            "el OCR de la imagen es clave para que aprueben la republicación."
        )

    parcial = bool(omitido) or bool(acciones_manuales)
    return {
        "ok": True,
        "parcial": parcial,
        "item_id": item_id,
        "resultado": resultado_put,
        "aplicado": aplicado,
        "omitido": omitido,
        "acciones_manuales": list(dict.fromkeys(acciones_manuales)),
        "restricciones": rest,
        "descripcion_para_pegar": descripcion_para_pegar,
    }


def _actualizar_descripcion(item_id: str, texto: str, headers: dict) -> None:
    try:
        requests.put(
            f"https://api.mercadolibre.com/items/{item_id}/description",
            json={"plain_text": texto},
            headers=headers,
            timeout=10,
        )
    except Exception:
        pass


def _attr_value_name(attr_id: str, value: str) -> dict:
    return {"id": attr_id, "value_name": str(value).strip()}


def _attr_number_unit(attr_id: str, number: float, unit: str) -> dict:
    num = float(number)
    unit = str(unit).strip()
    return {
        "id": attr_id,
        "value_name": f"{num:g} {unit}",
        "value_struct": {"number": num, "unit": unit},
    }


def _parsear_cantidad_presentacion(presentacion: str) -> tuple[float, str]:
    """Extrae cantidad y unidad de textos como '500 g', '1 kg', '250gr'."""
    texto = (presentacion or "").lower().replace(",", ".")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|gr|gramos|kilogramos|ml|l)\b", texto)
    if not m:
        return 500.0, "g"
    qty = float(m.group(1))
    unit = m.group(2)
    if unit in {"kg", "kilogramos"}:
        return qty * 1000, "g"
    if unit in {"l"}:
        return qty * 1000, "ml"
    if unit in {"g", "gr", "gramos"}:
        return qty, "g"
    return qty, unit


def _extraer_paquete_de_item(item: Optional[dict]) -> dict[str, float]:
    """Lee SELLER_PACKAGE_* de un ítem MeLi existente."""
    if not item:
        return {}
    out: dict[str, float] = {}
    key_map = {
        "SELLER_PACKAGE_HEIGHT": "height",
        "SELLER_PACKAGE_WIDTH": "width",
        "SELLER_PACKAGE_LENGTH": "length",
        "SELLER_PACKAGE_WEIGHT": "weight",
    }
    for attr in item.get("attributes") or []:
        aid = attr.get("id") or ""
        if aid not in key_map:
            continue
        struct = (attr.get("values") or [{}])[0].get("struct") or attr.get("value_struct") or {}
        num = struct.get("number")
        if num is not None:
            out[key_map[aid]] = float(num)
    return out


def _inferir_dimensiones_paquete(
    presentacion: str = "",
    atributos_compliance: Optional[dict] = None,
    item_referencia: Optional[dict] = None,
) -> dict[str, float]:
    """
    Dimensiones de empaque seller (obligatorias en sellers multi-warehouse).
    Prioridad: atributos explícitos → ítem origen → heurística por presentación.
    """
    atrs = atributos_compliance or {}
    explicit = {}
    for src_key, dst in (
        ("seller_package_height", "height"),
        ("SELLER_PACKAGE_HEIGHT", "height"),
        ("seller_package_width", "width"),
        ("SELLER_PACKAGE_WIDTH", "width"),
        ("seller_package_length", "length"),
        ("SELLER_PACKAGE_LENGTH", "length"),
        ("seller_package_weight", "weight"),
        ("SELLER_PACKAGE_WEIGHT", "weight"),
    ):
        val = atrs.get(src_key)
        if val is None:
            continue
        if isinstance(val, dict) and val.get("number") is not None:
            explicit[dst] = float(val["number"])
        else:
            m = re.search(r"(\d+(?:\.\d+)?)", str(val))
            if m:
                explicit[dst] = float(m.group(1))
    if len(explicit) == 4:
        return explicit

    from_item = _extraer_paquete_de_item(item_referencia)
    gramos, _ = _parsear_cantidad_presentacion(presentacion)
    peso_heuristico = max(gramos + 50, 200) if gramos else 550

    if len(from_item) == 4:
        # Algunas publicaciones viejas tienen peso mal cargado; priorizar heurística.
        if from_item.get("weight", 0) < gramos * 0.5:
            from_item["weight"] = peso_heuristico
        return from_item

    if gramos >= 900:
        return {"height": 25, "width": 18, "length": 9, "weight": peso_heuristico}
    if gramos >= 400:
        return {"height": 19, "width": 17, "length": 9, "weight": peso_heuristico}
    if gramos >= 200:
        return {"height": 19, "width": 16, "length": 5, "weight": peso_heuristico}
    return {"height": 19, "width": 17, "length": 9, "weight": peso_heuristico}


def _construir_atributos_publicacion(
    *,
    sku: str,
    nombre: str,
    presentacion: str,
    titulo: str,
    atributos_compliance: dict,
    item_referencia: Optional[dict] = None,
) -> list[dict]:
    """Atributos MeLi para publicación nueva en MCO8830 / materias primas."""
    line = atributos_compliance.get("LINE", "Materias primas alimentarias")
    ingredients = atributos_compliance.get("INGREDIENTS", nombre or titulo)
    cantidad, unidad = _parsear_cantidad_presentacion(presentacion)
    paquete = _inferir_dimensiones_paquete(presentacion, atributos_compliance, item_referencia)

    marca = str(
        atributos_compliance.get("BRAND")
        or atributos_compliance.get("brand")
        or nombre
        or titulo
    ).strip()[:60]
    main_supp = str(atributos_compliance.get("MAIN_SUPPLEMENT") or nombre or ingredients).strip()[:60]

    catalog_defaults = {
        "FLAVOR": atributos_compliance.get("FLAVOR", "Sin sabor"),
        "SUPPLEMENT_TYPE": atributos_compliance.get("SUPPLEMENT_TYPE", "Nutricional/Deportivo"),
        "SUPPLEMENT_FORMAT": atributos_compliance.get("SUPPLEMENT_FORMAT", "Polvo"),
        "SALE_FORMAT": atributos_compliance.get("SALE_FORMAT", "Unidad"),
        "PACKAGING_TYPE": atributos_compliance.get("PACKAGING_TYPE", "Bolsa resellable"),
        "ITEM_CONDITION": atributos_compliance.get("ITEM_CONDITION", "Nuevo"),
        "IS_GLUTEN_FREE": atributos_compliance.get("IS_GLUTEN_FREE", "Sí"),
        "IS_VEGAN": atributos_compliance.get("IS_VEGAN", "Sí"),
        "SUPPLEMENT_CLASS": atributos_compliance.get(
            "SUPPLEMENT_CLASS", "Vitaminas/Multivitamínicos/Minerales"
        ),
        "UNITS_PER_PACK": atributos_compliance.get("UNITS_PER_PACK", "1"),
    }

    attributes: list[dict] = [
        _attr_value_name("LINE", line),
        _attr_value_name("INGREDIENTS", ingredients),
        _attr_value_name("SELLER_SKU", sku),
        _attr_value_name("BRAND", marca),
        _attr_value_name("MAIN_SUPPLEMENT", main_supp),
        {"id": "QUANTITY", "value_name": f"{cantidad:g}"},
        _attr_value_name("UNIT_TYPE", unidad),
        _attr_number_unit("SELLER_PACKAGE_HEIGHT", paquete["height"], "cm"),
        _attr_number_unit("SELLER_PACKAGE_WIDTH", paquete["width"], "cm"),
        _attr_number_unit("SELLER_PACKAGE_LENGTH", paquete["length"], "cm"),
        _attr_number_unit("SELLER_PACKAGE_WEIGHT", paquete["weight"], "g"),
        {"id": "SELLER_PACKAGE_TYPE", "value_id": "47115156"},
        {"id": "EMPTY_GTIN_REASON", "value_id": "17055161"},
    ]
    for attr_id, value in catalog_defaults.items():
        if attr_id == "UNITS_PER_PACK":
            attributes.append({"id": attr_id, "value_name": str(int(float(value)))})
        else:
            attributes.append(_attr_value_name(attr_id, str(value)))
    return attributes


def _seller_es_multiwarehouse() -> bool:
    """Seller con gestión de depósitos (stock_locations en vez de available_quantity)."""
    try:
        seller = obtener_seller_id_meli()
        headers = _headers()
        if not headers:
            return False
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller}",
            headers=headers,
            timeout=10,
        )
        if r.status_code != 200:
            return False
        tags = r.json().get("tags") or []
        return "warehouse_management" in tags
    except Exception:
        return False


def _obtener_depositos_stock() -> list[dict]:
    """Depósitos del seller habilitados como stock_location."""
    headers = _headers()
    if not headers:
        return []
    try:
        seller = obtener_seller_id_meli()
        r = requests.get(
            f"https://api.mercadolibre.com/users/{seller}/stores/search",
            params={"tags": "stock_location"},
            headers=headers,
            timeout=12,
        )
        if r.status_code != 200:
            return []
        return [
            s for s in r.json().get("results", [])
            if s.get("status") == "active" and s.get("network_node_id")
        ]
    except Exception:
        return []


def _asignar_stock_user_product(user_product_id: str, stock: int = 10) -> dict:
    """Asigna stock en depósito seller_warehouse (multi-origen)."""
    headers = _headers()
    if not headers or not user_product_id:
        return {"ok": False, "error": "Sin user_product_id o token"}

    depositos = _obtener_depositos_stock()
    if not depositos:
        return {"ok": False, "error": "Sin depósitos stock_location configurados"}

    dep = depositos[0]
    body = {
        "locations": [{
            "store_id": str(dep["id"]),
            "network_node_id": dep["network_node_id"],
            "quantity": int(stock),
        }],
    }
    put_headers = {**headers, "Content-Type": "application/json", "x-version": "1"}
    try:
        r = requests.put(
            f"https://api.mercadolibre.com/user-products/{user_product_id}/stock/type/seller_warehouse",
            json=body,
            headers=put_headers,
            timeout=20,
        )
        if r.status_code == 200:
            return {"ok": True, "stock": r.json()}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:400]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _foto_desde_item(item: Optional[dict]) -> Optional[str]:
    if not item:
        return None
    for pic in item.get("pictures") or []:
        url = pic.get("secure_url") or pic.get("url")
        if url:
            return url
    return None


def _precio_desde_item(item: Optional[dict], fallback: float = 0) -> float:
    if not item:
        return fallback
    try:
        p = float(item.get("price") or 0)
        return p if p > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def crear_publicacion_meli(
    sku: str,
    titulo: str,
    descripcion: str,
    precio: float,
    categoria_id: str,
    atributos_compliance: dict,
    stock: int = 10,
    listing_type_id: str = "gold_special",
    foto_url: Optional[str] = None,
    usar_user_product: bool = True,
    presentacion: str = "",
    nombre: str = "",
    item_referencia: Optional[dict] = None,
) -> dict:
    """
    Crea una nueva publicación en MeLi con contenido compliant.

    McKenna publica en modelo User Products: usa family_name (no title) + SELLER_SKU.

    Returns:
        {"ok": bool, "item_id": str, "permalink": str} o {"ok": False, "error": str}
    """
    headers = _headers()
    if not headers:
        return {"ok": False, "error": "Sin token MeLi"}

    precio = float(precio or 0)
    if precio <= 0:
        precio = _precio_desde_item(item_referencia)
    if precio <= 0:
        return {"ok": False, "error": "Precio inválido (debe ser > 0 COP)"}

    if not foto_url and item_referencia:
        foto_url = _foto_desde_item(item_referencia)
    if not foto_url:
        return {"ok": False, "error": "Foto obligatoria para gold_special — sube imagen o indica item_origen con fotos"}

    attributes = _construir_atributos_publicacion(
        sku=sku,
        nombre=nombre or atributos_compliance.get("nombre", ""),
        presentacion=presentacion,
        titulo=titulo,
        atributos_compliance=atributos_compliance,
        item_referencia=item_referencia,
    )

    payload: dict = {
        "category_id": categoria_id,
        "price": precio,
        "currency_id": "COP",
        "buying_mode": "buy_it_now",
        "condition": "new",
        "listing_type_id": listing_type_id,
        "attributes": attributes,
        "pictures": [{"source": foto_url}],
        "channels": ["marketplace"],
    }

    multiwarehouse = _seller_es_multiwarehouse()
    depositos = _obtener_depositos_stock() if multiwarehouse else []
    if multiwarehouse and depositos:
        payload["stock_locations"] = [{
            "store_id": str(depositos[0]["id"]),
            "network_node_id": depositos[0]["network_node_id"],
            "quantity": int(stock),
        }]
    else:
        payload["available_quantity"] = stock

    if usar_user_product:
        # Modelo UP: family_name obligatorio; title lo genera MeLi
        payload["family_name"] = (titulo or "").strip()[:60]
    else:
        payload["title"] = titulo
        payload["seller_custom_field"] = sku

    endpoint = (
        "https://api.mercadolibre.com/items/multiwarehouse"
        if multiwarehouse and depositos
        else "https://api.mercadolibre.com/items"
    )

    try:
        r = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=25,
        )
        if r.status_code in (200, 201):
            data = r.json()
            item_id = data.get("id", "")
            user_product_id = data.get("user_product_id", "")
            status = data.get("status", "")

            # Fallback stock si quedó sin inventario (seller multi-origen)
            if user_product_id and status == "paused":
                sub = [str(s).lower() for s in (data.get("sub_status") or [])]
                if "out_of_stock" in sub:
                    _asignar_stock_user_product(user_product_id, stock)

            if item_id:
                _actualizar_descripcion(item_id, descripcion, headers)
                # Reactivar si quedó pausada por stock
                item_live = obtener_item_meli(item_id)
                if item_live and item_live.get("status") == "paused":
                    sub = [str(s).lower() for s in (item_live.get("sub_status") or [])]
                    if "out_of_stock" in sub and user_product_id:
                        _asignar_stock_user_product(user_product_id, stock)
                        requests.put(
                            f"https://api.mercadolibre.com/items/{item_id}",
                            json={"status": "active"},
                            headers={**headers, "Content-Type": "application/json"},
                            timeout=15,
                        )
                        item_live = obtener_item_meli(item_id)
                        status = (item_live or {}).get("status", status)

            return {
                "ok": True,
                "item_id": item_id,
                "permalink": data.get("permalink", ""),
                "status": status,
                "family_name": data.get("family_name", payload.get("family_name", "")),
                "user_product_id": user_product_id,
                "multiwarehouse": bool(multiwarehouse and depositos),
            }
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:800]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Pipeline completo ──────────────────────────────────────────────────────

def autopublicar_producto(
    sku: str,
    nombre: str,
    presentacion: str,
    precio: float,
    perfil: str = "materia_prima_alimentaria",
    ficha_tecnica: str = "",
    titulo_actual: str = "",
    descripcion_actual: str = "",
    texto_etiqueta: str = "",
    stock: int = 10,
    foto_url: Optional[str] = None,
    listing_type_id: str = "gold_special",
    dry_run: bool = False,
) -> dict:
    """
    Pipeline completo para publicar (o republicar) un producto con compliance.

    Pasos:
      1. Diagnosticar riesgo del contenido actual
      2. Generar contenido compliant con Claude
      3. Verificar que no hay publicación activa duplicada
      4. Crear nueva publicación en MeLi

    dry_run=True realiza diagnóstico y generación sin publicar en MeLi.

    Returns:
        {
          "diagnostico": dict,
          "contenido_generado": dict,
          "publicacion": dict | None,
          "paso_fallido": str | None,
        }
    """
    resultado: dict = {
        "sku": sku,
        "nombre": nombre,
        "timestamp": datetime.now().isoformat(),
        "diagnostico": None,
        "contenido_generado": None,
        "publicacion": None,
        "paso_fallido": None,
    }

    # Paso 1 — Diagnóstico
    diagnostico = diagnosticar_riesgo(
        sku=sku,
        nombre=nombre,
        titulo_meli=titulo_actual,
        descripcion=descripcion_actual,
        texto_etiqueta=texto_etiqueta,
    )
    resultado["diagnostico"] = diagnostico

    # Paso 2 — Generar contenido compliant
    contenido = generar_contenido_compliance(
        sku=sku,
        nombre=nombre,
        presentacion=presentacion,
        perfil=perfil,
        ficha_tecnica=ficha_tecnica,
        titulo_actual=titulo_actual,
        descripcion_actual=descripcion_actual,
    )
    if "error" in contenido:
        resultado["paso_fallido"] = f"generacion_contenido: {contenido['error']}"
        return resultado
    resultado["contenido_generado"] = contenido

    if dry_run:
        resultado["publicacion"] = {"dry_run": True, "mensaje": "No publicado (dry_run=True)"}
        return resultado

    # Paso 3 — Publicar
    perfil_info = PERFILES.get(perfil, PERFILES["materia_prima_alimentaria"])
    pub = crear_publicacion_meli(
        sku=sku,
        titulo=contenido["titulo"],
        descripcion=contenido["descripcion"],
        precio=precio,
        categoria_id=contenido.get("atributos", {}).get("category_id", perfil_info["categoria_meli"]),
        atributos_compliance=contenido.get("atributos", {}),
        stock=stock,
        listing_type_id=listing_type_id,
        foto_url=foto_url,
        usar_user_product=True,
        presentacion=presentacion,
        nombre=nombre,
    )
    resultado["publicacion"] = pub
    if not pub.get("ok"):
        resultado["paso_fallido"] = f"publicacion_meli: {pub.get('error', 'error desconocido')}"

    return resultado


def republicar_desde_diagnostico(
    item_id: str,
    sku: str,
    nombre: str,
    presentacion: str,
    precio: float,
    perfil: str = "materia_prima_alimentaria",
    ficha_tecnica: str = "",
    dry_run: bool = False,
) -> dict:
    """
    Corrige y reactiva un ítem MeLi pausado/bajado por incumplimiento.

    Pasos:
      1. Obtiene el ítem actual de MeLi
      2. Diagnostica señales de riesgo en el contenido actual
      3. Genera contenido compliant
      4. Actualiza el ítem y lo reactiva

    Returns dict con diagnostico, contenido_generado, republicacion
    """
    resultado: dict = {
        "item_id": item_id,
        "sku": sku,
        "timestamp": datetime.now().isoformat(),
        "item_actual": None,
        "diagnostico": None,
        "contenido_generado": None,
        "republicacion": None,
        "paso_fallido": None,
    }

    # Paso 1 — Obtener ítem actual
    item = obtener_item_meli(item_id)
    if not item:
        resultado["paso_fallido"] = "No se pudo obtener el ítem de MeLi"
        return resultado
    resultado["item_actual"] = {
        "titulo": item.get("title", ""),
        "status": item.get("status", ""),
        "sub_status": item.get("sub_status") or [],
        "category_id": item.get("category_id", ""),
        "domain_id": item.get("domain_id", ""),
        "family_name": item.get("family_name", ""),
        "sold_quantity": item.get("sold_quantity", 0),
        "line": _extraer_line_item(item),
    }
    restricciones = _restricciones_republicacion(item)
    resultado["restricciones"] = restricciones

    titulo_actual = item.get("title", "")
    desc_resp = requests.get(
        f"https://api.mercadolibre.com/items/{item_id}/description",
        headers=_headers() or {},
        timeout=10,
    )
    desc_actual = ""
    if desc_resp.status_code == 200:
        desc_actual = desc_resp.json().get("plain_text") or desc_resp.json().get("text") or ""

    # Paso 2 — Diagnóstico
    diagnostico = diagnosticar_riesgo(
        sku=sku,
        nombre=nombre,
        titulo_meli=titulo_actual,
        descripcion=desc_actual,
        atributos_meli={"domain_id": item.get("domain_id", ""), "LINE": _extraer_line_item(item)},
    )
    resultado["diagnostico"] = diagnostico

    # Paso 3 — Generar contenido compliant
    contenido = generar_contenido_compliance(
        sku=sku,
        nombre=nombre,
        presentacion=presentacion,
        perfil=perfil,
        ficha_tecnica=ficha_tecnica,
        titulo_actual=titulo_actual,
        descripcion_actual=desc_actual,
    )
    if "error" in contenido:
        resultado["paso_fallido"] = f"generacion_contenido: {contenido['error']}"
        return resultado
    resultado["contenido_generado"] = contenido

    if dry_run:
        resultado["republicacion"] = {"dry_run": True, "mensaje": "No republicado (dry_run=True)"}
        return resultado

    # Paso 4 — Republicar
    perfil_info = PERFILES.get(perfil, PERFILES["materia_prima_alimentaria"])
    atrs = contenido.get("atributos", {})
    correcciones = {
        "titulo": contenido["titulo"],
        "descripcion": contenido["descripcion"],
        "category_id": atrs.get("category_id", perfil_info["categoria_meli"]),
        "price": precio,
        "attributes": [
            {"id": "LINE", "value_name": atrs.get("LINE", perfil_info["linea_meli"])},
            {"id": "INGREDIENTS", "value_name": atrs.get("INGREDIENTS", nombre)},
        ],
        "reactivar": True,
    }
    resultado["republicacion"] = republicar_item(item_id, correcciones, item_actual=item)
    if not resultado["republicacion"].get("ok"):
        resultado["paso_fallido"] = (
            f"republicacion: {resultado['republicacion'].get('error', 'error desconocido')}"
        )
    elif resultado["republicacion"].get("parcial"):
        resultado["paso_fallido"] = None  # éxito parcial — ver acciones_manuales

    return resultado


# ── CLI de diagnóstico rápido ──────────────────────────────────────────────

def _cli_diagnostico_lote() -> None:
    """
    Diagnóstica todas las publicaciones pausadas/cerradas del vendedor
    e imprime un reporte de riesgo por consola.
    """
    print("🔍 Buscando publicaciones pausadas o bajadas en MeLi...\n")
    resultado = buscar_publicaciones_pausadas()
    if not resultado["ok"]:
        print(f"❌ {resultado.get('error')}")
        return

    items = resultado["items"]
    if not items:
        print("✅ No hay publicaciones pausadas o cerradas.")
        return

    print(f"Encontradas {len(items)} publicación(es) pausadas/cerradas:\n")
    for item in items:
        diag = diagnosticar_riesgo(
            sku=item.get("sku", ""),
            nombre=item.get("title", ""),
            titulo_meli=item.get("title", ""),
        )
        icono = {"bajo": "🟢", "medio": "🟡", "alto": "🔴"}.get(diag["nivel"], "⚪")
        print(f"{icono} [{diag['nivel'].upper()}] {item['item_id']} — {item['title'][:60]}")
        if diag["señales"]:
            print(f"   Señales: {', '.join(diag['señales'][:4])}")
        if diag["advertencias_taxonomia"]:
            for adv in diag["advertencias_taxonomia"]:
                print(f"   ⚠️ {adv}")
        print()


if __name__ == "__main__":
    _cli_diagnostico_lote()
