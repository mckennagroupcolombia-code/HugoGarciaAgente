"""Extracción de documentos técnicos (COA / FT) en dos pasos vía Gemini Vision.

Paso 1 — Leer TODAS las tablas y campos del encabezado (transcripción fiel).
Paso 2 — Mapear esa transcripción al JSON del formulario (sin inventar filas).

Así se evita que el modelo salte filas de tablas densas al ir directo a JSON.
"""
from __future__ import annotations

import io
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any

log = logging.getLogger(__name__)

_MODELO = "gemini-2.5-flash"


def _mejorar_imagen_para_tablas(data: bytes, mime: str) -> tuple[bytes, str]:
    """Amplía fotos chicas (típicas de COA escaneado) para que las tablas se lean mejor."""
    if mime == "application/pdf" or data[:4] == b"%PDF":
        return data, mime
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        w, h = im.size
        lado_min = min(w, h)
        # COA densos suelen llegar a 400–700 px: subir a ~1600 en el lado corto
        if lado_min < 1200:
            scale = max(2.0, 1600 / float(lado_min))
            scale = min(scale, 4.0)
            nw, nh = int(w * scale), int(h * scale)
            im = im.resize((nw, nh), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=92, optimize=True)
            return buf.getvalue(), "image/jpeg"
        if mime == "image/png" and len(data) > 2_500_000:
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=90, optimize=True)
            return buf.getvalue(), "image/jpeg"
    except Exception as e:
        log.debug("mejorar_imagen_para_tablas: %s", e)
    return data, mime


def preparar_partes(partes: list[tuple[bytes, str]]) -> list[tuple[bytes, str]]:
    return [_mejorar_imagen_para_tablas(d, m) for d, m in partes]


def _limpiar_json_texto(texto: str) -> str:
    raw = (texto or "").strip()
    if not raw:
        return ""
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip("`").strip()
    if raw.lower().startswith("json"):
        raw = raw[4:].strip()
    return raw


def parsear_json_objeto(texto: str) -> dict[str, Any] | None:
    limpio = _limpiar_json_texto(texto)
    if not limpio:
        return None
    try:
        data = json.loads(limpio)
        return data if isinstance(data, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", limpio, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else None
        except Exception:
            return None


def _registrar_budget(resp, contexto: str) -> None:
    try:
        from app.services.llm_budget import registrar_llamada, usage_gemini

        tin, tout = usage_gemini(resp)
        registrar_llamada(_MODELO, tin, tout, contexto=contexto)
    except Exception:
        pass


def _check_budget(contexto: str) -> None:
    try:
        from app.services.llm_budget import permitir_llamada

        ok, motivo = permitir_llamada(_MODELO, contexto=contexto)
        if not ok:
            raise RuntimeError(motivo or "Presupuesto LLM agotado")
    except RuntimeError:
        raise
    except Exception:
        pass


def _gemini_vision(
    partes: list[tuple[bytes, str]],
    prompt: str,
    *,
    timeout_s: float,
    contexto: str,
) -> str:
    import os

    from google import genai
    from google.genai import types as gtypes

    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY no configurada")

    _check_budget(contexto)

    client = genai.Client(api_key=api_key)
    contents: list[Any] = [gtypes.Part.from_bytes(data=d, mime_type=m) for d, m in partes]
    contents.append(prompt)

    def _call():
        return client.models.generate_content(model=_MODELO, contents=contents)

    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_call)
        try:
            resp = fut.result(timeout=timeout_s)
        except FutureTimeout as e:
            raise TimeoutError("Gemini tardó demasiado") from e
    _registrar_budget(resp, contexto)
    return (resp.text or "").strip()


def _gemini_texto(prompt: str, *, timeout_s: float, contexto: str) -> str:
    import os

    from google import genai

    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY no configurada")

    _check_budget(contexto)

    client = genai.Client(api_key=api_key)

    def _call():
        return client.models.generate_content(model=_MODELO, contents=prompt)

    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_call)
        try:
            resp = fut.result(timeout=timeout_s)
        except FutureTimeout as e:
            raise TimeoutError("Gemini tardó demasiado") from e
    _registrar_budget(resp, contexto)
    return (resp.text or "").strip()


_PROMPT_TABLAS_COA = """Eres un OCR técnico de control de calidad farmacéutico/cosmético.
Tu ÚNICA tarea en este paso: LEER y TRANSCRIBIR fielmente el documento (COA, etiqueta o hoja de calidad).

NO resumas. NO omitas filas. NO inventes. Si no se lee una celda, escribe [ilegible].

Devuelve SOLO texto plano (sin JSON) con esta estructura exacta:

=== ENCABEZADO ===
(lista clave: valor de TODOS los campos del encabezado: Product Name, Batch No, Lot, MFG DATE, EXP DATE, Quantity, Specification, Report date, Manufacturer, Packing, etc. EN o ES)

=== TABLA: <nombre o descripción corta> ===
Columnas: col1 | col2 | col3 | ...
fila1_c1 | fila1_c2 | fila1_c3 | ...
fila2_c1 | fila2_c2 | fila2_c3 | ...
(repite === TABLA: ... === por CADA tabla visible: composición, dimensiones Cap/Body, Items/Specification/Result, microbiología, metales pesados, etc.)

=== OTROS ===
(almacenamiento, firmas, sellos, notas al pie — texto literal)

Reglas:
- Incluye TODAS las filas de cada tabla, de arriba a abajo.
- Si hay Cap y Body en columnas separadas, conserva ambas.
- Mantén números, unidades y códigos exactamente como aparecen.
- Si hay varias imágenes/páginas, transcribe todas y une las tablas sin duplicar filas idénticas.
"""


def _prompt_estructurar_coa(transcripcion: str, catalogo_prompt: str, multi_nota: str) -> str:
    return (
        "Eres un especialista en control de calidad de materias primas farmaceuticas y cosmeticas.\n"
        f"{multi_nota}"
        "A partir de la TRANSCRIPCION OCR siguiente (ya leida de un COA/etiqueta), "
        "completa el JSON del formulario. NO inventes filas que no esten en la transcripcion.\n"
        f"{catalogo_prompt}\n"
        "TRANSCRIPCION:\n"
        "-----\n"
        f"{transcripcion[:28000]}\n"
        "-----\n\n"
        "Responde SOLO un JSON valido (sin markdown) con esta forma:\n"
        "{\n"
        '  "nombre_producto": "materia prima (ej. Acido Citrico Anhidro)",\n'
        '  "archivo_biblioteca": "nombre exacto del catalogo si aplica",\n'
        '  "nombre_comercial": "nombre comercial si difiere",\n'
        '  "inci": "nombre INCI si aparece",\n'
        '  "cas": "numero CAS",\n'
        '  "einecs": "numero EINECS/EC",\n'
        '  "formula_quimica": "formula molecular",\n'
        '  "grado": "Cosmetico/Alimentos/Industrial/Farmaceutico/etc",\n'
        '  "concentracion": "concentracion o pureza nominal",\n'
        '  "lote": "numero de lote",\n'
        '  "fecha_fabricacion": "fecha fabricacion (mejor YYYY-MM-DD)",\n'
        '  "fecha_vencimiento": "fecha vencimiento o retest",\n'
        '  "fecha_analisis": "fecha de analisis",\n'
        '  "fecha_emision": "fecha emision del COA",\n'
        '  "vida_util": "vida util / shelf life",\n'
        '  "tamano_lote": "tamano del lote si aparece",\n'
        '  "pais_origen": "pais de origen",\n'
        '  "fabricante": "fabricante o proveedor",\n'
        '  "apariencia": "aspecto fisico",\n'
        '  "olor": "olor si aparece",\n'
        '  "ph": "pH o rango",\n'
        '  "solubilidad": "solubilidad si aparece",\n'
        '  "humedad": "humedad / loss on drying si aparece fuera de tabla",\n'
        '  "presentacion": "presentacion o empaque",\n'
        '  "almacenamiento": "condiciones de almacenamiento",\n'
        '  "firma_nombre": "nombre legible de quien firma o aprueba el COA",\n'
        '  "firma_cargo": "cargo o rol legible de quien firma",\n'
        '  "firma_organizacion": "empresa o laboratorio del firmante",\n'
        '  "parametros": "TODAS las filas de analisis como Parametro|Especificacion|Resultado separadas por \\n"\n'
        "}\n\n"
        "Reglas:\n"
        "- Omite claves vacias.\n"
        "- nombre_producto: Product Name / Nombre del producto del ENCABEZADO (no del laboratorio).\n"
        "- BATCH / Lot / Lot No. / Lote → lote; EXP DATE / Expiry / Retest → fecha_vencimiento; "
        "MFG DATE / Manufacturing → fecha_fabricacion.\n"
        "- parametros: incluye CADA fila de tablas de ensayo/dimensiones/composicion/microbiologia/"
        "metales. Formato Parametro|Especificacion|Resultado. Si solo hay 2 columnas, usa "
        "Parametro|Especificacion| (resultado vacio) o Parametro||Resultado segun corresponda.\n"
        "- Traduce etiquetas de parametros al espanol; mantén numeros, unidades y codigos de lote.\n"
        "- Appearance→Aspecto, Assay→Valoracion, Loss on Drying→Perdida por Secado, "
        "Heavy Metals→Metales Pesados, Conforms/Passes/Passed→Cumple.\n"
        "- Responde SOLO JSON valido."
    )


_PROMPT_TABLAS_FT = """Eres un OCR técnico de materias primas farmacéuticas/cosméticas.
Transcribe FIELMENTE el documento (ficha técnica, COA, etiqueta, TDS, empaque).

NO resumas. NO omitas filas de tablas. NO inventes.

Devuelve SOLO texto plano:

=== ENCABEZADO ===
(Product Name, CAS, Batch, MFG, EXP, Manufacturer, Quantity, etc.)

=== TABLA: <nombre> ===
Columnas: ...
filas completas con | entre celdas

=== OTROS ===
(descripcion, apariencia, almacenamiento, modo de uso, aplicaciones)

Si hay varias imagenes, unelas. Mantén numeros y unidades exactos.
"""


def _prompt_estructurar_ft(transcripcion: str, multi_nota: str) -> str:
    return (
        "Eres especialista en materias primas farmacéuticas y cosméticas de McKenna Group S.A.S.\n"
        f"{multi_nota}"
        "A partir de esta TRANSCRIPCION OCR, genera el JSON del formulario. "
        "No inventes datos ausentes en la transcripcion.\n\n"
        "TRANSCRIPCION:\n-----\n"
        f"{transcripcion[:28000]}\n"
        "-----\n\n"
        "Campos (solo los que existan; claves en español):\n"
        "{\n"
        '  "nombre_producto": "...",\n'
        '  "cas": "...",\n'
        '  "descripcion": "...",\n'
        '  "apariencia": "...",\n'
        '  "olor": "...",\n'
        '  "punto_fusion": "...",\n'
        '  "ph": "...",\n'
        '  "solubilidad": "...",\n'
        '  "humedad": "...",\n'
        '  "formula_quimica": "...",\n'
        '  "modo_uso": "...",\n'
        '  "propiedades_lista": "Nombre|Descripción por línea",\n'
        '  "aplicaciones": "una por línea",\n'
        '  "lote": "BATCH / lote",\n'
        '  "fecha_fabricacion": "MFG",\n'
        '  "fecha_vencimiento": "EXP",\n'
        '  "fabricante": "...",\n'
        '  "presentacion": "cantidad/peso",\n'
        '  "almacenamiento": "...",\n'
        '  "pais_origen": "..."\n'
        "}\n"
        "Traduce textos al español; no traduzcas CAS, fórmulas ni códigos de lote.\n"
        "SOLO JSON válido, sin markdown."
    )


def _parametros_desde_transcripcion(transcripcion: str) -> str:
    """Convierte filas OCR 'a|b|c' de secciones TABLA en Parametro|Espec|Resultado."""
    lineas_out: list[str] = []
    en_tabla = False
    seccion = ""
    for raw in transcripcion.splitlines():
        ln = raw.strip()
        if not ln:
            continue
        if ln.startswith("==="):
            up = ln.upper()
            if "TABLA" in up:
                en_tabla = True
                seccion = "tabla"
            elif "ENCABEZADO" in up:
                en_tabla = False
                seccion = "encabezado"
            elif "OTROS" in up:
                en_tabla = False
                seccion = "otros"
            else:
                en_tabla = False
            continue
        # Aceptar filas con | también si el modelo olvidó el marcador === TABLA ===
        if not en_tabla and seccion in ("encabezado", "otros"):
            continue
        if not en_tabla and "|" not in ln:
            continue
        if ln.lower().startswith("columnas"):
            continue
        if "|" not in ln:
            continue
        parts = [p.strip() for p in ln.split("|")]
        if len(parts) < 2:
            continue
        # Cabecera tipica Item|Specification|Result — saltar
        joined = " ".join(parts).lower()
        if "specification" in joined and "result" in joined and len(parts) <= 4:
            if parts[0].lower() in ("item", "items", "test", "parameter", "parametro"):
                continue
        if len(parts) == 2:
            lineas_out.append(f"{parts[0]}|{parts[1]}|")
        else:
            parametro = parts[0]
            espec = parts[1]
            resultado = " | ".join(parts[2:])
            lineas_out.append(f"{parametro}|{espec}|{resultado}")
    seen: set[str] = set()
    uniq: list[str] = []
    for ln in lineas_out:
        k = ln.lower()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(ln)
    return "\n".join(uniq)


def _extraer_coa_un_paso(
    partes: list[tuple[bytes, str]],
    catalogo_prompt: str,
    multi_nota: str,
) -> dict[str, Any]:
    prompt = (
        "PRIMERO lee mentalmente TODAS las tablas fila por fila; "
        "LUEGO genera el JSON. parametros debe listar cada fila.\n"
        + _prompt_estructurar_coa(
            "(sin transcripcion previa — lee las imagenes adjuntas con TODAS las filas de tabla)",
            catalogo_prompt,
            multi_nota,
        )
    )
    texto = _gemini_vision(
        partes,
        prompt,
        timeout_s=min(150, 50 + 25 * max(1, len(partes))),
        contexto="coa_scan_un_paso",
    )
    return parsear_json_objeto(texto) or {}


def extraer_coa_desde_imagenes(
    partes: list[tuple[bytes, str]],
    *,
    catalogo_prompt: str = "",
    multi_nota: str = "",
) -> dict[str, Any]:
    """Pipeline COA: tablas → JSON. Devuelve dict de campos."""
    partes_ok = preparar_partes(partes)
    n = max(1, len(partes_ok))
    t1 = min(120, 40 + 20 * n)
    t2 = min(90, 35 + 10 * n)

    prompt1 = _PROMPT_TABLAS_COA
    if multi_nota:
        prompt1 = multi_nota + "\n" + prompt1

    try:
        transcripcion = _gemini_vision(
            partes_ok, prompt1, timeout_s=t1, contexto="coa_scan_tablas"
        )
    except TimeoutError:
        raise
    except Exception as e:
        log.warning("coa_scan_tablas falló: %s — fallback un paso", e)
        return _extraer_coa_un_paso(partes_ok, catalogo_prompt, multi_nota)

    if not transcripcion or len(transcripcion) < 40:
        return _extraer_coa_un_paso(partes_ok, catalogo_prompt, multi_nota)

    try:
        texto_json = _gemini_texto(
            _prompt_estructurar_coa(transcripcion, catalogo_prompt, multi_nota),
            timeout_s=t2,
            contexto="coa_scan_estructurar",
        )
    except Exception as e:
        log.warning("coa_scan_estructurar falló: %s — fallback un paso", e)
        parsed_fb = _extraer_coa_un_paso(partes_ok, catalogo_prompt, multi_nota)
        if parsed_fb:
            parsed_fb["_transcripcion"] = transcripcion[:8000]
        return parsed_fb

    parsed = parsear_json_objeto(texto_json or "")
    if not parsed:
        parsed = _extraer_coa_un_paso(partes_ok, catalogo_prompt, multi_nota)
        if parsed:
            parsed["_transcripcion"] = transcripcion[:8000]
        return parsed or {}

    params = str(parsed.get("parametros") or "")
    n_lineas_params = len([ln for ln in params.splitlines() if "|" in ln and ln.strip()])
    n_filas_ocr = len(
        [
            ln
            for ln in transcripcion.splitlines()
            if "|" in ln and not ln.strip().lower().startswith("columnas")
        ]
    )
    if n_filas_ocr >= 8 and n_lineas_params < max(5, n_filas_ocr // 3):
        extra = _parametros_desde_transcripcion(transcripcion)
        if extra:
            parsed["parametros"] = extra

    parsed["_transcripcion"] = transcripcion[:8000]
    return parsed


def extraer_ft_desde_imagenes(
    partes: list[tuple[bytes, str]],
    *,
    multi_nota: str = "",
) -> dict[str, Any]:
    partes_ok = preparar_partes(partes)
    n = max(1, len(partes_ok))
    prompt1 = (multi_nota + "\n" if multi_nota else "") + _PROMPT_TABLAS_FT
    try:
        transcripcion = _gemini_vision(
            partes_ok, prompt1, timeout_s=min(120, 40 + 20 * n), contexto="ft_scan_tablas"
        )
    except Exception as e:
        log.warning("ft_scan_tablas falló: %s", e)
        transcripcion = ""

    if not transcripcion or len(transcripcion) < 40:
        texto = _gemini_vision(
            partes_ok,
            "PRIMERO lee todas las tablas; LUEGO JSON.\n"
            + _prompt_estructurar_ft("(lee las imagenes)", multi_nota),
            timeout_s=min(150, 45 + 25 * n),
            contexto="ft_scan_un_paso",
        )
        return parsear_json_objeto(texto) or {}

    texto_json = _gemini_texto(
        _prompt_estructurar_ft(transcripcion, multi_nota),
        timeout_s=min(90, 35 + 10 * n),
        contexto="ft_scan_estructurar",
    )
    parsed = parsear_json_objeto(texto_json or "") or {}
    if parsed:
        parsed["_transcripcion"] = transcripcion[:8000]
    return parsed
