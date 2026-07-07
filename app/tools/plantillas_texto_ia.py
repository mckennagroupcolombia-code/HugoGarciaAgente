"""
Sugerencias de texto para Plantillas Visuales a partir de fichas técnicas.
Genera copy técnico-comercial estructurado para catálogo o publicación.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from app.observability import spawn_thread

_REPO = Path(__file__).resolve().parents[2]
_FICHAS_JSON = _REPO / "PAGINA_WEB" / "site" / "data" / "fichas_tecnicas.json"

_STOP = {
    "para", "con", "del", "los", "las", "una", "unos", "unas", "por", "que", "como",
    "the", "and", "de", "la", "el", "en", "y", "a", "es", "se",
}

_PROMPT_CATALOGO = """Eres redactor técnico especializado en materias primas químicas, cosméticas, alimentarias, industriales y de laboratorio (según corresponda al ingrediente) de McKenna Group.

El usuario escribe palabras clave para identificar una materia prima (solo para buscar la ficha; NO las repitas en el texto):
"{fragmento}"

NOMBRE CANÓNICO del ingrediente (mencionar como MÁXIMO 1 vez en TODO el texto, preferiblemente al inicio del párrafo 1; si el título ya está en otra capa de la etiqueta, NO lo menciones):
"{nombre_canonico}"

Usa SOLO la información de las fichas técnicas adjuntas. No inventes datos. Si un dato no está en las fichas, indica de forma general sin especificar cifras falsas.

Redacta {n_opciones} variante(s) de texto técnico-comercial para catálogo o publicación de MATERIA PRIMA.

EXTENSIÓN Y FORMA (obligatorio):
- EXACTAMENTE 2 párrafos, separados por una línea en blanco (\\n\\n en JSON).
- Cada párrafo debe tener alrededor de {palabras_por_parrafo} palabras (rango por párrafo: {palabras_parrafo_min}–{palabras_parrafo_max}).
- Total aproximado: {palabras_objetivo} palabras entre ambos párrafos.
- Desarrolla cada párrafo con detalle y varias oraciones; evita párrafos breves o telegráficos.

VOZ Y PERSPECTIVA (obligatorio):
- Redacción IMPERSONAL y OBJETIVA: describe la materia prima, no a un proveedor ni a un producto comercial propio.
- PROHIBIDO primera persona: nosotros, nuestro, nuestra, ofrecemos, garantizamos, le presentamos, etc.
- PROHIBIDO apropiación comercial en tercera persona: "nuestro producto", "este producto de calidad", "garantiza su excelencia", "le ofrece", lenguaje de marca o venta directa.
- Tras la primera mención del ingrediente (si hace falta), varía referencias: "se emplea", "su uso", "el compuesto" — NO encadenes "este insumo" en oraciones seguidas (máximo 2 veces en todo el texto).
- Construcciones preferidas: "se presenta", "es soluble en", "se emplea en", "se utiliza como", "presenta", "actúa como".
- El texto debe leerse como una ficha técnica o descriptivo de catálogo de ingrediente, no como copy publicitario de una empresa.

ESTILO NATURAL (obligatorio):
- Español técnico fluido, como catálogo B2B colombiano; oraciones directas y concretas.
- Varía el inicio de cada oración; evita plantillas vacías ("características funcionales específicas", "rol relevante", "encuentra su principal campo de aplicación", "optimizar el perfil").
- PROHIBIDO acumular sinónimos huecos: no repitas "funcional", "características", "matrices" en la misma frase.
- Describe propiedades físicas y usos industriales concretos; NO redactes como artículo de salud ni fisiología.
- PROHIBIDO metabolismo celular, ATP, trifosfato de adenosina, energía celular, soporte celular o efectos en el organismo.
- Usa "concentración" o "nivel de incorporación", no "dosificación" orientada al consumidor.

ANTI-REPETICIÓN (obligatorio):
- PROHIBIDO repetir el nombre canónico, las palabras clave del usuario o frases casi iguales en oraciones consecutivas.
- "materia prima" como MÁXIMO 1 vez en todo el texto (si el subtítulo de la etiqueta ya lo dice, NO lo uses).
- "formulación" no más de 3 veces en todo el texto; varía con "matriz", "proceso industrial", "elaboración".
- Cada oración debe aportar un dato distinto (físico, funcional o de aplicación).

Contenido a integrar de forma natural (sin títulos ni viñetas):

PÁRRAFO 1 — ORDEN OBLIGATORIO (desarrolla cada bloque con datos de la ficha; si falta un dato, omítelo sin inventar):
A) QUÉ ES: identifica brevemente de qué tipo de compuesto o ingrediente se trata, sin repetir el nombre canónico más de la única vez ya permitida.
B) APARIENCIA FÍSICA: estado (polvo, líquido, granulado, cristalino), color, textura u organolépticas visuales si constan. Usa redacción explícita («se presenta como…», «en apariencia…»).
C) ORIGEN O FUENTE: origen natural (vegetal, animal, mineral) o de síntesis química/industrial, y presencia natural si aplica — solo si consta en la ficha.
D) MODO DE OBTENCIÓN: proceso general de extracción, síntesis, fermentación, refinación u otro método de obtención — solo si consta en la ficha; si no hay dato, omite este punto sin inventar.
E) SOLUBILIDAD: medios de disolución o dispersión (agua, alcohol, aceites, etc.) con redacción explícita («es soluble en…», «se dispersa en…», «presenta solubilidad…»). Este punto es obligatorio si la ficha lo menciona.
F) PROPIEDADES Y BENEFICIOS COMO MATERIA PRIMA: función técnica, rol en formulación, ventajas de proceso (estabilidad, textura, compatibilidad reológica, pureza) — sin claims de salud al consumidor.
G) Comportamiento en matrices industriales según diseño de fórmula, equipo y condiciones de elaboración.
H) Estabilidad frente al aire, humedad, luz o temperatura solo como propiedad del material, no como recomendación de guardado.

NO incluir instrucciones de almacenamiento, caducidad ni conservación en el párrafo 1.

PÁRRAFO 2 (características generales, propiedades y usos):
- Características generales y propiedades adicionales relevantes para quien formula.
- Aplicaciones por industria (química, alimentaria, farmacéutica, cosmética, industrial o de laboratorio, según lo que indiquen las fichas).
- Referencia de uso o concentración (solo si consta en fichas; si no, indicar que depende de formulación y normativa).

- PROHIBIDO en el párrafo 1: almacenar, guardar en envase, caducidad, consumir preferentemente, recomendaciones logísticas.

- No repitas encabezados de ficha (Apariencia:, Solubilidad:, etc.); integra esos datos en prosa.
- No dupliques frases del tipo "En la industria alimentaria… Para la industria alimentaria…".
- Si no hay datos de una industria en las fichas, omítela; no uses texto genérico de relleno.
- PROHIBIDO copiar tablas de especificaciones, valores Máx/Min, unidades (g/100g), pH numérico, índices de laboratorio o listas técnicas de control de calidad.
- PROHIBIDO dejar etiquetas sueltas (Olor y sabor:, Alérgenos:, ALMACENAMIENTO, etc.); integra olor, sabor y alérgenos en oraciones completas si constan en la ficha.
- No repitas la misma idea en oraciones consecutivas (p. ej. "materia prima industrial" dos veces seguidas).
- Sin prometer curas, sin exagerar beneficios, sin lenguaje medicinal directo.
- No uses emojis, comillas envolventes, listas ni encabezados en mayúsculas.
- Máximo {max_chars} caracteres por variante.

COMPLIANCE MERCADO LIBRE (obligatorio — evita baja de publicación):
- McKenna comercializa MATERIA PRIMA reempacada para formulación. NO suplemento terminado ni medicamento.
- PROHIBIDO mencionar: grado farmacéutico, uso medicinal, suplemento (en cualquier forma), dosis sugerida o recomendada, instrucciones de consumo tipo "tomar" o "ingerir", afirmaciones terapéuticas o promesas de resultados médicos.
- PROHIBIDO orientar al consumidor final: dosis, dosificación, gramos diarios, fase de carga, consumo, suplemento deportivo, atletas, culturistas, ganancia muscular, recuperación post-entrenamiento, tratamiento, cura, terapia, ELA, trastornos neuromusculares, función cerebral terapéutica, absorción por el organismo, salud ósea/muscular/cardiovascular al consumidor, ATP, trifosfato de adenosina, metabolismo energético, soporte celular, perfil energético.
- PROHIBIDO claims de producto terminado; describe uso en FORMULACIÓN industrial, alimentaria, cosmética, química o de laboratorio.
- PROHIBIDO repetir el nombre comercial del ingrediente como titular si ya consta en otra capa de la plantilla.
- PROHIBIDO repetir frases del subtítulo (ej. "materia prima alimentaria", "insumo cosmético").
- Cada párrafo debe aportar información técnica nueva (propiedad, solubilidad, aplicaciones de formulación).

OTRAS CAPAS DE LA ETIQUETA (no repetir):
{contexto_otras_capas}

{instrucciones_segmento}

FICHAS TÉCNICAS:
{contexto}

Responde ÚNICAMENTE con JSON válido en este formato:
{{"sugerencias": [{{"texto": "primer párrafo.\\n\\nsegundo párrafo."}}]}}"""

PALABRAS_POR_PARRAFO = 80
PALABRAS_POR_PARRAFO_MIN = 65
PALABRAS_POR_PARRAFO_MAX = 95
PALABRAS_OBJETIVO = PALABRAS_POR_PARRAFO * 2
PALABRAS_MIN = 120
PALABRAS_MAX = 200
MAX_CHARS_CATALOGO = 2600
_JOB_TTL_SEC = 600

_jobs_texto_magico: dict[str, dict] = {}
_jobs_lock = threading.Lock()

_fichas_cache: dict | None = None


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _palabras_clave(texto: str, min_len: int = 3) -> list[str]:
    raw = re.findall(r"[a-z0-9áéíóúüñ]+", _norm(texto))
    out: list[str] = []
    for p in raw:
        if len(p) < min_len or p in _STOP:
            continue
        if p not in out:
            out.append(p)
    return out


def _load_fichas_json() -> dict:
    global _fichas_cache
    if _fichas_cache is not None:
        return _fichas_cache
    if not _FICHAS_JSON.is_file():
        _fichas_cache = {}
        return _fichas_cache
    try:
        with open(_FICHAS_JSON, encoding="utf-8") as f:
            data = json.load(f)
        _fichas_cache = data if isinstance(data, dict) else {}
    except Exception:
        _fichas_cache = {}
    return _fichas_cache


def _ficha_dict_a_texto(ficha: dict) -> str:
    partes: list[str] = []
    titulo = (ficha.get("titulo") or "").strip()
    if titulo:
        partes.append(titulo)
    desc = (ficha.get("descripcion") or "").strip()
    if desc:
        partes.append(desc)
    for par in ficha.get("propiedades") or []:
        if isinstance(par, (list, tuple)) and len(par) >= 2:
            partes.append(f"{par[0]}: {par[1]}")
    for sec in ficha.get("secciones") or []:
        if not isinstance(sec, dict):
            continue
        st = (sec.get("titulo") or "").strip()
        if st:
            partes.append(st)
        for item in sec.get("items") or []:
            t = str(item).strip()
            if t:
                partes.append(t)
    return "\n".join(partes)[:5000]


def _buscar_en_json(palabras: list[str], limite: int = 3) -> list[dict]:
    fichas = _load_fichas_json()
    if not fichas or not palabras:
        return []

    scored: list[tuple[int, str, dict]] = []
    for clave, ficha in fichas.items():
        if not isinstance(ficha, dict):
            continue
        clave_norm = _norm(clave)
        blob = _norm(f"{clave} {_ficha_dict_a_texto(ficha)}")
        hits_blob = sum(1 for p in palabras if p in blob)
        if hits_blob < min(2, len(palabras)):
            continue
        # Prioriza fuerte las coincidencias en el propio nombre de la ficha:
        # antes el score solo sumaba `len(clave)` como desempate, así que una
        # mención suelta de las palabras clave dentro del cuerpo de OTRA
        # ficha (p. ej. "se combina con ácido ascórbico" en la ficha de
        # benzoato de sodio) podía empatar o superar a la ficha que
        # realmente es el producto buscado — la etiqueta terminaba con texto
        # de un insumo distinto al de su propio título.
        hits_clave = sum(1 for p in palabras if p in clave_norm)
        score = hits_clave * 1000 + hits_blob * 10
        scored.append((score, clave, ficha))

    scored.sort(key=lambda t: t[0], reverse=True)
    out: list[dict] = []
    for score, clave, ficha in scored[:limite]:
        texto = _ficha_dict_a_texto(ficha)
        out.append({
            "titulo": ficha.get("titulo") or clave,
            "clave": clave,
            "fuente": "fichas_tecnicas.json",
            "texto": texto,
            "score": score,
        })
    return out


def _aplanar_datos_yaml(valor: Any, prefijo: str = "") -> list[str]:
    """Convierte un dict/list de datos YAML (FT/COA/SDS) en líneas 'campo: valor'."""
    lineas: list[str] = []
    if isinstance(valor, dict):
        for clave, sub in valor.items():
            if clave == "titulo":
                continue
            etiqueta = str(clave).replace("_", " ").strip()
            if isinstance(sub, (dict, list)):
                lineas.extend(_aplanar_datos_yaml(sub, etiqueta))
            else:
                texto = str(sub).strip()
                if texto:
                    lineas.append(f"{etiqueta}: {texto}")
    elif isinstance(valor, list):
        for item in valor:
            if isinstance(item, (dict, list)):
                lineas.extend(_aplanar_datos_yaml(item, prefijo))
            else:
                texto = str(item).strip()
                if texto:
                    lineas.append(f"{prefijo}: {texto}" if prefijo else texto)
    else:
        texto = str(valor).strip()
        if texto:
            lineas.append(f"{prefijo}: {texto}" if prefijo else texto)
    return lineas


def _texto_desde_datos_ficha_word(datos: dict) -> str:
    return "\n".join(_aplanar_datos_yaml(datos))[:4000]


def _buscar_en_fichas_word(termino: str, limite: int = 3) -> list[dict]:
    """Busca en los documentos FT/COA/SDS generados en Etiquetas Studio
    (fichas_word/datos/*.yaml) cuyo título conecta con `termino`
    (normalmente el título de la capa/plantilla)."""
    termino = (termino or "").strip()
    if not termino:
        return []
    try:
        from app.services.ficha_tecnica import DATOS_DIR, cargar_datos_desde_archivo
    except Exception:
        return []
    if not DATOS_DIR.is_dir():
        return []

    palabras_termino = _palabras_clave(termino, min_len=3)
    if not palabras_termino:
        return []

    archivos = list(DATOS_DIR.glob("*.yaml")) + list(DATOS_DIR.glob("*.yml"))
    familias = (
        ("FT", lambda p: not p.name.startswith(("plantilla", "coa_", "sds_"))),
        ("COA", lambda p: p.name.startswith("coa_")),
        ("SDS", lambda p: p.name.startswith("sds_")),
    )

    encontradas: list[dict] = []
    for etiqueta, filtro in familias:
        mejor: tuple[int, str, dict] | None = None
        for p in archivos:
            if not filtro(p):
                continue
            try:
                datos = cargar_datos_desde_archivo(p)
            except Exception:
                continue
            if not isinstance(datos, dict):
                continue
            titulo = str(datos.get("titulo") or p.stem).strip()
            if not titulo:
                continue
            blob = _norm(titulo)
            hits = sum(1 for palabra in palabras_termino if palabra in blob)
            if hits < min(2, len(palabras_termino)):
                continue
            score = hits * 100 + len(titulo)
            if not mejor or score > mejor[0]:
                mejor = (score, titulo, datos)
        if mejor:
            score, titulo, datos = mejor
            texto = _texto_desde_datos_ficha_word(datos)
            if texto:
                # El documento combinado ("generar-completo") trae FT+COA+SDS
                # en un solo yaml (campos _coa / _sds anidados); refleja eso en la etiqueta.
                etiqueta_doc = "FT/COA/SDS" if datos.get("_tipo") == "completo" else etiqueta
                encontradas.append({
                    "titulo": f"{etiqueta_doc} {titulo}",
                    "clave": _norm(f"{etiqueta}:{titulo}"),
                    "fuente": f"ficha_word_{etiqueta.lower()}",
                    "texto": texto,
                    "score": 1000 + score,
                })

    encontradas.sort(key=lambda f: f["score"], reverse=True)
    return encontradas[:limite]


def buscar_cas_por_titulo(titulo: str) -> str | None:
    """Busca el número CAS en el documento FT/COA/SDS del Studio (fichas_word/datos)
    cuyo título conecta con `titulo` (el título de la capa/plantilla de la etiqueta).
    Lookup determinístico (no genera texto con IA): un CAS mal generado es un
    riesgo de cumplimiento en la etiqueta.
    """
    titulo = (titulo or "").strip()
    if not titulo:
        return None
    try:
        from app.services.ficha_tecnica import DATOS_DIR, cargar_datos_desde_archivo
    except Exception:
        return None
    if not DATOS_DIR.is_dir():
        return None

    palabras_termino = _palabras_clave(titulo, min_len=3)
    if not palabras_termino:
        return None

    mejor: tuple[int, str] | None = None
    for p in list(DATOS_DIR.glob("*.yaml")) + list(DATOS_DIR.glob("*.yml")):
        if p.name.startswith("plantilla"):
            continue
        try:
            datos = cargar_datos_desde_archivo(p)
        except Exception:
            continue
        if not isinstance(datos, dict):
            continue
        cas = str(datos.get("cas") or "").strip()
        if not cas:
            continue
        titulo_doc = str(datos.get("titulo") or p.stem).strip()
        blob = _norm(titulo_doc)
        hits = sum(1 for palabra in palabras_termino if palabra in blob)
        if hits < min(2, len(palabras_termino)):
            continue
        score = hits * 100 + len(titulo_doc)
        if not mejor or score > mejor[0]:
            mejor = (score, cas)

    return mejor[1] if mejor else None


def _buscar_en_sheets(termino: str) -> dict | None:
    try:
        from app.services.google_services import buscar_ficha_tecnica_producto

        ficha = buscar_ficha_tecnica_producto(termino)
        if not ficha or not str(ficha).strip():
            return None
        return {
            "titulo": termino.strip()[:80],
            "clave": _norm(termino)[:80],
            "fuente": "google_sheets",
            "texto": str(ficha).strip()[:5000],
            "score": 999,
        }
    except Exception:
        return None


def _recolectar_fichas(
    fragmento: str,
    palabras: list[str],
    limite: int = 3,
    contexto_capas: dict | None = None,
) -> list[dict]:
    vistos: set[str] = set()
    resultados: list[dict] = []

    # Prioridad 1: documentos FT/COA/SDS del Studio, buscados por el título
    # de la plantilla (más confiable que el fragmento parcial que se edita).
    titulo_plantilla = ((contexto_capas or {}).get("titulo") or "").strip() or fragmento
    for item in _buscar_en_fichas_word(titulo_plantilla, limite=limite):
        if item["clave"] in vistos:
            continue
        vistos.add(item["clave"])
        resultados.append(item)

    # Prioridad 2: catálogo curado de fichas_tecnicas.json (secciones
    # estructuradas: beneficios, apariencia, solubilidad...). Va ANTES que
    # Google Sheets a propósito: ambas fuentes suelen compartir la misma
    # clave normalizada para el mismo producto, y el primero en reclamarla
    # gana el cupo (se descarta el resto por duplicado). Sheets solo trae
    # un bloque de texto plano de una columna — si ganaba el cupo antes,
    # la ficha rica y estructurada del JSON quedaba descartada y el texto
    # generado terminaba genérico, sin datos reales del producto.
    for item in _buscar_en_json(palabras, limite=limite):
        if item["clave"] in vistos:
            continue
        vistos.add(item["clave"])
        resultados.append(item)

    sheet = _buscar_en_sheets(fragmento)
    if sheet and sheet["clave"] not in vistos:
        vistos.add(sheet["clave"])
        resultados.append(sheet)

    resultados.sort(key=lambda x: x.get("score", 0), reverse=True)
    return resultados[:limite]


def _extraer_json(raw: str) -> dict | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    bloque = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if bloque:
        raw = bloque.group(1)
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        inicio = raw.find("{")
        fin = raw.rfind("}")
        if inicio >= 0 and fin > inicio:
            try:
                data = json.loads(raw[inicio : fin + 1])
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                return None
    return None


_APROPIACION_RE = re.compile(
    r"\b("
    r"nuestro|nuestra|nuestros|nuestras|nosotros|ofrecemos|garantizamos|"
    r"presentamos|suministramos|le ofrecemos|nuestro producto|nuestra materia|"
    r"este producto de|producto de (alta|excelente|superior) calidad|"
    r"garantiza su (calidad|excelencia|pureza)"
    r")\b",
    re.I,
)


def _contar_palabras(texto: str) -> int:
    return len(re.findall(r"[a-záéíóúüñ0-9]+", _norm(texto), re.I))


def _limpiar_apropiacion(texto: str) -> str:
    bloques = re.split(r"\n\s*\n", (texto or "").strip())
    limpios: list[str] = []
    for bloque in bloques:
        t = re.sub(r"\s+", " ", bloque).strip()
        if not t:
            continue
        t = re.sub(r"\b[Nn]uestro[s]?\s+", "El ", t)
        t = re.sub(r"\b[Nn]uestra[s]?\s+", "La ", t)
        t = re.sub(r"\b[Ss]e garantiza\b", "Se recomienda", t)
        t = re.sub(r"\b[Ll]e ofrecemos\b", "Se emplea", t)
        limpios.append(t)
    return "\n\n".join(limpios)


def _asegurar_dos_parrafos(texto: str) -> str:
    paras = [p.strip() for p in re.split(r"\n\s*\n", texto) if p.strip()]
    if len(paras) >= 2:
        return "\n\n".join(paras[:2])
    if not paras:
        return texto.strip()
    unico = paras[0]
    oraciones = [o.strip() for o in re.split(r"(?<=[.!?])\s+", unico) if o.strip()]
    if len(oraciones) < 2:
        mitad = max(1, len(unico) // 2)
        corte = unico.rfind(". ", 0, mitad + 80)
        if corte < 40:
            corte = unico.find(". ", mitad)
        if corte > 0:
            return f"{unico[: corte + 1].strip()}\n\n{unico[corte + 1 :].strip()}"
        return unico
    mitad = len(oraciones) // 2
    return f"{' '.join(oraciones[:mitad])}\n\n{' '.join(oraciones[mitad:])}"


def _limpiar_fragmento_ficha(texto: str) -> str:
    t = re.sub(r"\s+", " ", (texto or "").strip())
    t = re.sub(
        r"^(apariencia|solubilidad|olor|estado|funci[oó]n|uso|aplicaciones?)\s*:\s*",
        "",
        t,
        flags=re.I,
    )
    for pref in (
        r"para la industria alimentaria[,]?\s*",
        r"en la industria alimentaria[,]?\s*",
        r"para la industria farmac[eé]utica[,]?\s*",
        r"en la industria farmac[eé]utica[,]?\s*",
        r"para la industria cosm[eé]tica[,]?\s*",
        r"en la industria cosm[eé]tica[,]?\s*",
    ):
        t = re.sub(pref, "", t, flags=re.I)
    return t.strip().rstrip(".")


_RE_PREFIJO_FUENTE_FICHA = re.compile(r"^(?:FT/COA/SDS|FT|COA|SDS)\s+", re.I)


def _titulo_sin_prefijo_fuente(titulo: str) -> str:
    """`_buscar_en_fichas_word` antepone la familia de documento al título
    (p. ej. "FT/COA/SDS LACTATO DE CALCIO") solo para mostrar la fuente al
    usuario ("Fuentes: ..."). Usar ese título tal cual para construir el
    nombre del ingrediente colaba el prefijo en la prosa generada
    ("El ft/coa/sds lactato de calcio es un ingrediente...") y además
    duplicaba el ancla anti-repetición, produciendo sustituciones rotas
    como "El ft/coa/sds Este insumo es...". Se limpia aquí, en el único
    punto de entrada hacia nombre/anclas."""
    return _RE_PREFIJO_FUENTE_FICHA.sub("", (titulo or "").strip()).strip()


def _nombre_materia_prima(titulo: str) -> str:
    t = (titulo or "materia prima").strip()
    if t.isupper():
        t = t.title()
    minusculas = {"de", "del", "la", "el", "los", "las", "y", "e", "o", "u"}
    partes = [p.lower() if p.lower() in minusculas else p for p in t.split()]
    return " ".join(partes).lower()


_ALTERNA_SUSTITUTO = (
    "Este insumo",
    "El compuesto",
    "La sustancia",
    "El ingrediente",
    "El material",
)

_SUSTITUTO_SIN_ARTICULO = (
    "insumo",
    "compuesto",
    "sustancia",
    "ingrediente",
    "material",
)


def _terminos_ancla_repeticion(
    fragmento: str,
    contexto_capas: dict | None = None,
    titulo_ficha: str = "",
) -> list[str]:
    vistos: set[str] = set()
    anclas: list[str] = []

    def add(raw: str | None) -> None:
        t = re.sub(r"\s+", " ", (raw or "").strip())
        if len(t) < 4:
            return
        k = _norm(t)
        if k in vistos:
            return
        vistos.add(k)
        anclas.append(t)

    ctx = contexto_capas or {}
    add(ctx.get("titulo"))
    add(titulo_ficha)
    add(_nombre_materia_prima(titulo_ficha or ctx.get("titulo") or fragmento))
    add(fragmento)
    add(ctx.get("subtitulo"))
    titulo_norm = _norm(titulo_ficha or ctx.get("titulo") or "")
    for palabra in _palabras_clave(fragmento, min_len=4):
        if len(palabra) >= 5 and palabra not in titulo_norm:
            add(palabra)
    anclas.sort(key=len, reverse=True)
    return anclas


def _contar_frase(texto: str, frase: str) -> int:
    nf = _norm(frase)
    if len(nf) < 3:
        return 0
    return _norm(texto).count(nf)


def _limite_apariciones_ancla(ancla: str, contexto_capas: dict | None) -> int:
    if not contexto_capas:
        return 1
    titulo = _norm((contexto_capas.get("titulo") or ""))
    subt = _norm((contexto_capas.get("subtitulo") or ""))
    na = _norm(ancla)
    if titulo and (na == titulo or (len(na) >= 8 and na in titulo)):
        return 0
    if subt and (na == subt or (len(na) >= 10 and na in subt)):
        return 0
    return 1


def _repeticion_excesiva(
    texto: str,
    anclas: list[str] | None,
    contexto_capas: dict | None = None,
) -> bool:
    for ancla in anclas or []:
        if _contar_frase(texto, ancla) > _limite_apariciones_ancla(ancla, contexto_capas):
            return True
    subt = _norm((contexto_capas or {}).get("subtitulo") or "")
    max_mp = 0 if "materia prima" in subt else 1
    if len(re.findall(r"\bmateria prima\b", _norm(texto))) > max_mp:
        return True
    if len(re.findall(r"\bformulaci[oó]n\b", _norm(texto))) > 3:
        return True
    if len(re.findall(r"\beste insumo\b", _norm(texto))) > 2:
        return True
    return False


def _suavizar_repeticiones(
    texto: str,
    anclas: list[str],
    contexto_capas: dict | None = None,
) -> str:
    out = texto
    alt_idx = 0
    for ancla in anclas:
        ancla_norm = _norm(ancla)
        if not ancla_norm:
            continue
        lim = _limite_apariciones_ancla(ancla, contexto_capas)
        # _norm() (NFD + descarte de marcas combinantes) preserva longitud e
        # índice carácter a carácter frente al texto original — así el match
        # se ubica sobre la versión normalizada (sin tildes) pero se corta y
        # reemplaza sobre `out` tal cual, sin depender de que Gemini haya
        # escrito el nombre con exactamente las mismas tildes/mayúsculas.
        pat = re.compile(
            rf"(?:\b(?:el|la|los|las)\s+)?{re.escape(ancla_norm)}",
            re.I,
        )
        out_norm = _norm(out)
        count = 0
        partes: list[str] = []
        last = 0
        for m in pat.finditer(out_norm):
            partes.append(out[last : m.start()])
            count += 1
            if count <= lim:
                partes.append(out[m.start() : m.end()])
            else:
                rep = _ALTERNA_SUSTITUTO[alt_idx % len(_ALTERNA_SUSTITUTO)]
                alt_idx += 1
                partes.append(rep)
            last = m.end()
        partes.append(out[last:])
        out = "".join(partes)

    subt = _norm((contexto_capas or {}).get("subtitulo") or "")
    max_mp = 0 if "materia prima" in subt else 1
    mp_pat = re.compile(r"\bmateria prima\b", re.I)
    n_mp = 0
    partes_mp: list[str] = []
    last = 0
    for m in mp_pat.finditer(out):
        partes_mp.append(out[last : m.start()])
        n_mp += 1
        if n_mp <= max_mp:
            partes_mp.append(m.group(0))
        else:
            rep = ("insumo técnico", "ingrediente industrial")[alt_idx % 2]
            alt_idx += 1
            partes_mp.append(rep)
        last = m.end()
    partes_mp.append(out[last:])
    return _pulir_redaccion("".join(partes_mp))


_RE_ARTICULO_MAL = re.compile(
    r"\b(La|El|Los|Las)\s+(este|el|la|los|las)\s+",
    re.I,
)

_RE_REDACCION_ROBOT = re.compile(
    r"\b("
    r"encuentra su principal campo de aplicaci[oó]n|"
    r"caracter[ií]sticas funcionales espec[ií]ficas|"
    r"optimizar el perfil energ[eé]tico|"
    r"soporte celular|"
    r"soporte nutricional|"
    r"actividades f[ií]sicas|"
    r"alta intensidad|"
    r"potenciar ciertos atributos|"
    r"fin t[eé]cnico espec[ií]fico|"
    r"programas espec[ií]ficos|"
    r"alta energ[ií]a a nivel celular|"
    r"rol en el soporte celular|"
    r"propiedades distintivas para la elaboraci[oó]n"
    r")\b",
    re.I,
)


def _pulir_redaccion(texto: str) -> str:
    bloques = re.split(r"\n\s*\n", (texto or "").strip())
    limpios = [_pulir_parrafo(b) for b in bloques if b.strip()]
    return "\n\n".join(limpios)


def _pulir_parrafo(parrafo: str) -> str:
    t = re.sub(r"\s+", " ", (parrafo or "").strip())
    sustituciones = (
        (r"\bLa este insumo\b", "Este insumo"),
        (r"\bEl este insumo\b", "Este insumo"),
        (r"\bLa el compuesto\b", "El compuesto"),
        (r"\bEl la sustancia\b", "La sustancia"),
        (r"\bLos el\b", "Los"),
        (r"\bLas la\b", "Las"),
        (r"\bEl insumo encuentra su principal campo de aplicaci[oó]n\b", "Se emplea principalmente"),
        (r"\bencuentra su principal campo de aplicaci[oó]n\b", "se utiliza"),
        (r"\bLa dosificaci[oó]n\b", "La concentración"),
        (r"\bdosificaci[oó]n\b", "concentración"),
        (r"\boptimizar el perfil energ[eé]tico\b", "ajustar el perfil funcional"),
        (r"\bsoporte celular\b", "comportamiento en matriz"),
        (r"\bperfil energ[eé]tico\b", "perfil funcional"),
        (r"\bmetabolismo energ[eé]tico celular\b", "procesos de formulación"),
        (r"\btrifosfato de adenosina\s*\(\s*ATP\s*\)", "procesos de formulación"),
        (r"\btrifosfato de adenosina\b", "procesos industriales"),
        (r"\bprecursor clave en la s[ií]ntesis\b", "componente de uso en"),
        (r"\bofreciendo propiedades distintivas\b", "con propiedades técnicas"),
        (r"\bgarantizando un uso adecuado\b", "según criterio técnico"),
        (r"\bformulaciones dise[nñ]adas para aportar\b", "formulaciones que incorporan"),
        (r"\b,\s*ofreciendo\b", "; aporta"),
        (r"\b,\s*aportando\b", "; aporta"),
    )
    for patron, repl in sustituciones:
        t = re.sub(patron, repl, t, flags=re.I)
    t = re.sub(r"\bEste insumo\b(?:[^.]*\bEste insumo\b)+", "Este insumo", t, flags=re.I)
    t = re.sub(r" {2,}", " ", t).strip()
    return t


def _redaccion_deficiente(texto: str) -> bool:
    if _RE_ARTICULO_MAL.search(texto):
        return True
    if _RE_REDACCION_ROBOT.search(texto):
        return True
    return False


def _post_procesar_texto(texto: str) -> str:
    bloques = re.split(r"\n\s*\n", (texto or "").strip())
    limpios: list[str] = []
    for bloque in bloques:
        t = _limpiar_apropiacion(bloque)
        t = re.sub(r"\bApariencia:\s*", "Se presenta con ", t, flags=re.I)
        t = re.sub(r"\bSolubilidad:\s*", "Presenta solubilidad: ", t, flags=re.I)
        t = re.sub(
            r"En la industria alimentaria se emplea en Para la industria alimentaria",
            "En la industria alimentaria",
            t,
            flags=re.I,
        )
        t = re.sub(
            r"En la industria alimentaria se emplea en En la industria alimentaria",
            "En la industria alimentaria",
            t,
            flags=re.I,
        )
        t = _quitar_especificaciones(t)
        # Sensible a mayúsculas a propósito: solo limpia encabezados de ficha
        # ("ESTABILIDAD Y ALMACENAMIENTO") sin comerse la palabra normal
        # "almacenamiento" cuando aparece en una oración en prosa.
        t = re.sub(r"\b(?:Y\s+)?ALMACENAMIENTO\b", "", t)
        t = re.sub(r"\bOlor y sabor:\s*", "Presenta ", t, flags=re.I)
        t = re.sub(r"\bAl[eé]rgenos:\s*", "", t, flags=re.I)
        t = re.sub(r" {2,}", " ", t).strip()
        if t:
            limpios.append(t)
    return "\n\n".join(limpios)


_GENERICO_USO = "formulaciones acordes a la normativa vigente"


def _es_texto_generico(texto: str) -> bool:
    return "uso según formulación y normativa vigente" in _norm(texto)


_SECCION_RE = re.compile(
    r"(?:^|\s)(DESCRIPCI[OÓ]N|APLICACIONES|PROPIEDADES(?:\s+ORGANOL[EÉ]PTICAS)?|"
    r"ESTABILIDAD|ALMACENAMIENTO|INFORMACI[OÓ]N NUTRICIONAL)\b",
)

_RE_ESPECIFICACIONES = re.compile(
    r"(?:Grasa de leche|Prote[ií]nas de leche)\s*\(\s*g/100g\s*\)|"
    r"Humedad\s*\(\s*g/100g\s*\)|"
    r"Cenizas\s*\([^)]+\)\s*\(\s*g/100g\s*\)|"
    r"Lactosa anhidra\s*\(\s*g/100g\s*\)|"
    r"Acidez titulable\s*\(|"
    r"[ÍI]ndice insolubilidad\s*\(\s*ml\s*\)|"
    r"Part[ií]culas quemadas\s*\(\s*disco\s*\)|"
    r"ph\s*:\s*M",
    re.I,
)

_RE_FUNCION = re.compile(
    r"\b(antioxidante|acidulante|humectante|conservante|emulsionante|espesante|"
    r"solvente|activo cosm[eé]tico|fuente (?:de )?(?:prote[ií]nas?|mineral(?:es)?)|"
    r"ingrediente de formulaci[oó]n|emulsificante|estabilizante|edulcorante|"
    r"aromatizante|espesante|gelificante|nutriente)\b",
    re.I,
)

_RE_ALMACENAMIENTO_P1 = re.compile(
    r"\b(almacenar|almacenamiento|guardar en envase|envases? bien cerrados?|"
    r"caduca|consumir preferentemente|fecha de fabricaci[oó]n|lugar fresco y seco)\b",
    re.I,
)

_RIESGO_MELI_EXTRA = (
    "suplemento deportivo",
    "suplementos deportivos",
    "culturistas",
    "atletas",
    "dosis sugerida",
    "dosis recomendada",
    "gramos diarios",
    "gramos al dia",
    "gramos al día",
    "fase de carga",
    "post-entrenamiento",
    "post entrenamiento",
    "aumento de masa muscular",
    "ganancia muscular",
    "recuperacion post",
    "recuperación post",
    "trastorno neuromuscular",
    "terapia medica",
    "terapia médica",
    "funcion cerebral",
    "función cerebral",
    "terapias medicas",
    "terapias médicas",
    "consumo diario",
    "porcion diaria",
    "porción diaria",
    "suplemento dietario",
    "suplemento dietético",
    "rendimiento deportivo",
    "mejora la capacidad",
    "mejorando la capacidad",
    "esfuerzos intensos",
    "energia celular",
    "energía celular",
    "mejora el rendimiento",
    "envejecimiento prematuro",
    "salud cardiovascular",
    "salud osea",
    "salud ósea",
    "suplemento terminado",
    "medicamento terminado",
    "consumidor final",
    "trifosfato de adenosina",
    "metabolismo energético",
    "metabolismo energetico",
    "metabolismo energético celular",
    "soporte celular",
    "perfil energético",
    "perfil energetico",
    "nivel celular",
    "dosificación",
    "dosificacion",
    "precursor clave",
    "síntesis de trifosfato",
    "sintesis de trifosfato",
    "adenosina",
    "soporte nutricional",
    "actividades físicas",
    "actividades fisicas",
    "alta intensidad",
    "grado farmacéutico",
    "uso medicinal",
    "suplemento",
    "tomar",
    "ingerir",
    "afirmación terapéutica",
    "terapéutico",
    "terapéutica",
    "resultado médico",
)


def _palabras_riesgo_meli() -> tuple[str, ...]:
    """Lista unificada: meli_compliance.PALABRAS_RIESGO + extras plantillas."""
    base: list[str] = list(_RIESGO_MELI_EXTRA)
    try:
        from app.tools.meli_compliance import PALABRAS_RIESGO

        for p in PALABRAS_RIESGO:
            if p not in base:
                base.append(p)
    except Exception:
        pass
    return tuple(base)


def _señales_riesgo_meli(texto: str) -> list[str]:
    # Coincidencia por palabra/frase completa, no substring: evita falsos
    # positivos como "cura " detectado dentro de "frescura".
    t = _norm(texto)
    señales: list[str] = []
    for p in _palabras_riesgo_meli():
        pn = _norm(p).strip()
        if not pn:
            continue
        if re.search(rf"\b{re.escape(pn)}\b", t):
            señales.append(p)
    return señales


def _formatear_contexto_otras_capas(contexto_capas: dict | None) -> str:
    if not contexto_capas:
        return "No se indicaron otras capas; evita titulares comerciales redundantes."
    lineas: list[str] = []
    titulo = (contexto_capas.get("titulo") or "").strip()
    subtitulo = (contexto_capas.get("subtitulo") or "").strip()
    if titulo:
        lineas.append(f"- Título (ya impreso en la etiqueta): «{titulo[:120]}»")
    if subtitulo:
        lineas.append(f"- Subtítulo (ya impreso): «{subtitulo[:120]}»")
    if not lineas:
        return "No se indicaron otras capas; evita titulares comerciales redundantes."
    lineas.append("- No repitas esas frases ni parafrasees el mismo mensaje.")
    seg = _segmento_insumo(contexto_capas)
    if seg == "alimentario":
        lineas.append(
            "- El producto es un insumo alimentario: la descripción debe centrarse "
            "en formulación alimentaria industrial."
        )
    return "\n".join(lineas)


def _contiene_riesgo_meli(texto: str) -> bool:
    return bool(_señales_riesgo_meli(texto))


def _repite_capas_etiqueta(texto: str, contexto_capas: dict | None) -> bool:
    """Detecta repetición del título o subtítulo ya impreso en otras capas."""
    if not contexto_capas:
        return False
    t = _norm(texto)
    titulo = _norm((contexto_capas.get("titulo") or "").strip())
    subtitulo = _norm((contexto_capas.get("subtitulo") or "").strip())
    if subtitulo and len(subtitulo) >= 10 and subtitulo in t:
        return True
    if not titulo or len(titulo) < 6:
        return False
    if titulo in t:
        return True
    palabras_t = [p for p in titulo.split() if len(p) >= 3][:5]
    if len(palabras_t) >= 3:
        ventana = " ".join(palabras_t)
        if ventana in t:
            return True
    return False


def _primera_oracion(texto: str) -> str:
    t = (texto or "").strip()
    m = re.match(r"^(.+?[.!?])(?:\s+|$)", t)
    return m.group(1).strip() if m else t


def _estabilidad_material(texto: str) -> str:
    """Propiedades de estabilidad del material, sin instrucciones de almacenamiento."""
    raw = _seccion_ficha(texto, "ESTABILIDAD") or _seccion_ficha(texto, "ALMACENAMIENTO")
    if not raw:
        return ""
    sensibles: list[str] = []
    if re.search(r"humedad", raw, re.I):
        sensibles.append("la humedad")
    if re.search(r"\bluz\b", raw, re.I):
        sensibles.append("la luz")
    if re.search(r"calor|temperatura|t[eé]rmic", raw, re.I):
        sensibles.append("las variaciones térmicas")
    if re.search(r"\baire\b|ox[ií]geno|oxid", raw, re.I):
        sensibles.append("el contacto con el aire")
    if not sensibles:
        return ""
    union = ", ".join(sensibles[:-1]) + (" y " + sensibles[-1] if len(sensibles) > 1 else sensibles[0])
    return f"Presenta sensibilidad a {union}."


def _inferir_funcional(texto: str, nombre: str) -> str:
    t = texto or ""
    for match in _RE_FUNCION.finditer(t):
        rol = match.group(1).lower()
        return f"Actúa como {rol} en formulaciones industriales."
    if re.search(r"fuente de prote[ií]nas|prote[ií]na de leche|prote[ií]nas", t, re.I):
        return (
            f"Se trata de una fuente de proteínas e ingrediente de formulación "
            f"de uso industrial y alimentario."
        )
    if re.search(r"ingrediente de uso industrial|materia prima", t, re.I):
        return f"Se utiliza como ingrediente de formulación de uso industrial."
    return f"Este insumo cumple una función técnica dentro de procesos de formulación industrial."


def _inferir_mecanismo(alim: str, origen: str, nombre: str) -> str:
    if alim and not _es_texto_generico(alim):
        a = _limpiar_fragmento_ficha(alim)
        if re.search(r"fuente de prote[ií]nas|otorga m[uú]ltiples propiedades", a, re.I):
            return (
                f"En matrices alimentarias e industriales, aporta proteínas y propiedades "
                f"funcionales que inciden en la textura, el valor nutricional y el "
                f"comportamiento de la matriz elaborada."
            )
        if re.search(r"ferment", a, re.I):
            return (
                f"Participa como soporte o medio en procesos fermentativos y en la "
                f"obtención de productos tecnológicos derivados."
            )
        return (
            f"Cumple un papel relevante en procesos industriales al aportar "
            f"características funcionales a la formulación final."
        )
    if origen and re.search(r"concentraci|deshidrat|coagul|ferment", origen, re.I):
        return (
            f"Su obtención por procesos de concentración y deshidratación condiciona "
            f"su comportamiento como insumo proteico en cadenas alimentarias e industriales."
        )
    return (
        f"Interviene en procesos químicos e industriales de formulación "
        f"como componente funcional de matrices especializadas."
    )


_RE_ETIQUETA_FICHA = re.compile(
    r"\b(Olor y sabor|Al[eé]rgenos)\s*:",
    re.I,
)


def _quitar_especificaciones(texto: str) -> str:
    t = (texto or "").strip()
    if not t:
        return ""
    t = re.sub(
        r"(?:Grasa de leche|Prote[ií]nas de leche|Humedad|Cenizas|Lactosa anhidra|"
        r"Acidez titulable|[ÍI]ndice insolubilidad|Part[ií]culas quemadas)\s*"
        r"\([^)]+\)\s*[^A-ZÁÉÍÓÚÑ]*",
        " ",
        t,
        flags=re.I,
    )
    t = re.sub(r"ph\s*:\s*[^.]+", " ", t, flags=re.I)
    t = re.sub(r"Peso molecular\s*\([^)]*\)\s*:?\s*[^.]+", " ", t, flags=re.I)
    t = re.sub(r"\bM[aá]x\.?\s*[\d,.]+", " ", t, flags=re.I)
    t = re.sub(r"\bMin\.?\s*[\d,.]+", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _prosa_olor_sabor(texto: str) -> str:
    t = texto or ""
    m = re.search(r"Olor y sabor:\s*([^.;]+)", t, re.I)
    if m:
        frag = _sanitizar_campo_ficha(m.group(1))
        if frag:
            if re.search(r"inodor", frag, re.I):
                return "Es inodoro."
            return f"Presenta {frag[0].lower()}{frag[1:].rstrip('.')}."
    if not re.search(r"olor|sabor", t, re.I):
        return ""
    notas: list[str] = []
    if re.search(r"sabor salado|dulz[oó]n", t, re.I):
        notas.append("sabor salado-dulzón")
    if re.search(r"olor l[aá]ctico|l[aá]ctico suave", t, re.I):
        notas.append("olor láctico suave")
    elif re.search(r"olor caracter[ií]stico", t, re.I):
        notas.append("olor característico")
    if not notas:
        return ""
    return "Presenta " + " y ".join(notas) + "."


def _prosa_alergenos(texto: str) -> str:
    m = re.search(r"Al[eé]rgenos:\s*([^.;]+)", texto or "", re.I)
    if not m:
        return ""
    frag = _limpiar_fragmento_ficha(m.group(1))
    if not frag:
        return ""
    if re.search(r"contiene", frag, re.I):
        return f"{frag[0].upper()}{frag[1:].rstrip('.')}."
    return f"Contiene {frag[0].lower()}{frag[1:].rstrip('.')}."


def _sanitizar_campo_ficha(texto: str) -> str:
    t = _quitar_especificaciones(_limpiar_fragmento_ficha(texto))
    # Sensible a mayúsculas: son encabezados de sección de ficha, no deben
    # comerse "almacenamiento"/"propiedades organolépticas" en prosa normal.
    t = re.sub(r"\b(?:Y\s+)?ALMACENAMIENTO\b", "", t)
    t = re.sub(r"\bPROPIEDADES ORGANOL[EÉ]PTICAS\b", "", t)
    return re.sub(r"\s+", " ", t).strip().rstrip(".")


_RE_ORACION_CONSUMIDOR = re.compile(
    r"\b(atleta|culturista|deportivo|muscular|suplemento|dosis|gramos?\s+(?:al|diari)|"
    r"consumidor|post[\s-]?entren|ganancia|rendimiento|ejercicio|levantamiento|"
    r"m[uú]sculo|niveles?\s+[oó]ptimos?|guarde el|metabolismo energ|trifosfato|adenosina|\batp\b|"
    r"soporte celular|perfil energ)\b",
    re.I,
)

_P2_CIERRE = (
    " La concentración y el modo de incorporación dependen de la matriz final, "
    "la normativa aplicable y el criterio técnico del fabricante; se sugiere "
    "consultar la ficha técnica correspondiente antes de definir rangos de uso "
    "en la elaboración industrial."
)

_RELLENO_P1 = (
    "Su perfil lo hace compatible con procesos de mezcla, homogeneización e "
    "incorporación en matrices sólidas, líquidas o semisólidas. "
    "La calidad del insumo condiciona la reproducibilidad del proceso y las "
    "características organolépticas o funcionales de la matriz elaborada."
)

_RELLENO_P1_ALIMENTARIO = (
    "Su perfil lo hace apto para procesos de mezcla, tamizado y homogeneización "
    "en planta alimentaria. La calidad del insumo incide en la estabilidad de "
    "la mezcla, la solubilidad en la matriz y las características organolépticas "
    "del producto elaborado."
)

_RELLENO_P2 = (
    "En formulación cosmética y farmacéutica, puede integrarse como componente "
    "activo o excipiente según el diseño de la fórmula y los requisitos "
    "regulatorios del mercado objetivo."
)

_RELLENO_P2_ALIMENTARIO = (
    "También puede usarse en bases para bebidas, mezclas en polvo y productos "
    "intermedios, siempre bajo criterio técnico del formulador y la normativa "
    "sanitaria del producto terminado."
)


def _segmento_insumo(
    contexto_capas: dict | None,
    ficha_texto: str = "",
) -> str:
    subt = _norm((contexto_capas or {}).get("subtitulo") or "")
    blob = _norm(ficha_texto or "")
    if any(k in subt for k in ("alimentar", "nutrac", "nutrit", "grado aliment")):
        return "alimentario"
    if any(k in subt for k in ("cosmet", "dermat", "belleza")):
        return "cosmetico"
    if any(k in subt for k in ("farmac", "farmaceut")):
        return "farmaceutico"
    if re.search(
        r"industria alimentaria|uso alimentario|grado alimenticio|ingrediente alimentario",
        blob,
    ):
        return "alimentario"
    if re.search(r"industria cosmet|uso cosmet", blob):
        return "cosmetico"
    if re.search(r"industria farmac|uso farmac", blob):
        return "farmaceutico"
    return "general"


def _instrucciones_segmento(segmento: str) -> str:
    if segmento == "alimentario":
        return (
            "SEGMENTO ALIMENTARIO (obligatorio):\n"
            "- Es un INSUMO ALIMENTARIO para formulación en planta; redacta para "
            "fabricantes de alimentos y bebidas.\n"
            "- Prioriza aplicaciones en industria alimentaria: premezclas, bases en "
            "polvo, mezclas intermedias, bebidas y productos elaborados por terceros.\n"
            "- NO menciones cosmética ni farmacéutica salvo que la ficha lo exija.\n"
            "- NO repitas la frase exacta del subtítulo («materia prima alimentaria»); "
            "usa «insumo alimentario», «ingrediente alimentario» o «formulación alimentaria».\n"
            "- Tono: ingrediente de formulación alimentaria industrial, no producto "
            "terminado ni orientación al consumidor."
        )
    if segmento == "cosmetico":
        return (
            "SEGMENTO COSMÉTICO: redacta para formulación cosmética industrial; "
            "no menciones alimentaria ni farmacéutica salvo en la ficha."
        )
    if segmento == "farmaceutico":
        return (
            "SEGMENTO FARMACÉUTICO: redacta para formulación farmacéutica industrial; "
            "no menciones alimentaria ni cosmética salvo en la ficha."
        )
    return (
        "Redacta según el segmento principal que indiquen las fichas técnicas "
        "(alimentaria, cosmética o farmacéutica)."
    )


def _titulo_ya_en_capa(
    titulo_ficha: str,
    nombre_mp: str,
    contexto_capas: dict | None,
) -> bool:
    """
    True si el nombre del producto ya está impreso en la capa Título del
    diseño (para no repetirlo en el párrafo 1). La capa Título suele traer
    texto extra (peso, presentación: "Ácido Ascórbico 100g") que la ficha
    técnica no tiene, así que hay que comparar en ambos sentidos de
    contención — no solo "¿el título de la capa cabe completo en el nombre
    de la ficha?", que casi nunca es cierto.
    """
    capa = _norm((contexto_capas or {}).get("titulo") or "")
    if not capa:
        return False
    ficha = _norm(titulo_ficha or "")
    nombre = _norm(nombre_mp or "")
    return bool(
        (ficha and (capa in ficha or ficha in capa))
        or (nombre and len(nombre) >= 4 and nombre in capa)
    )


def _apertura_p1(
    segmento: str,
    titulo_en_capa: bool,
    nombre: str,
) -> str:
    if segmento == "alimentario":
        if titulo_en_capa:
            return "Ingrediente alimentario de grado técnico para formulación en planta."
        return (
            f"El {nombre} es un ingrediente alimentario de grado técnico "
            f"para formulación en planta."
        )
    if segmento == "cosmetico":
        if titulo_en_capa:
            return "Insumo cosmético de uso industrial para formulación en planta."
        return f"El {nombre} es un insumo cosmético de uso industrial para formulación."
    if segmento == "farmaceutico":
        if titulo_en_capa:
            return "Insumo de uso farmacéutico-industrial para formulación en planta."
        return f"El {nombre} es un insumo de uso farmacéutico-industrial para formulación."
    if titulo_en_capa:
        return "Insumo de uso industrial y de formulación."
    return f"El {nombre} es un insumo de uso industrial y de formulación."


def _relleno_p1(segmento: str) -> str:
    return _RELLENO_P1_ALIMENTARIO if segmento == "alimentario" else _RELLENO_P1


def _relleno_p2(segmento: str) -> str:
    return _RELLENO_P2_ALIMENTARIO if segmento == "alimentario" else _RELLENO_P2


def _uso_generico_p2(segmento: str) -> str:
    if segmento == "alimentario":
        return (
            "Se incorpora en la elaboración de alimentos y bebidas según la "
            "aplicación prevista y la normativa sanitaria aplicable."
        )
    if segmento == "cosmetico":
        return (
            "Se incorpora en formulaciones cosméticas según la aplicación prevista "
            "y la normativa vigente."
        )
    if segmento == "farmaceutico":
        return (
            "Se incorpora en formulaciones farmacéuticas según la aplicación "
            "prevista y la normativa vigente."
        )
    return (
        "Se incorpora en procesos industriales según la aplicación "
        "prevista y la normativa aplicable."
    )


def _oracion_apta_descripcion_mp(oracion: str) -> bool:
    o = (oracion or "").strip()
    if len(o) < 18:
        return False
    if _contiene_basura_ficha(o):
        return False
    if _contiene_riesgo_meli(o):
        return False
    if _RE_ORACION_CONSUMIDOR.search(o):
        return False
    return True


def _oraciones_seguras_ficha(
    texto: str,
    max_oraciones: int = 2,
    max_palabras: int = 85,
) -> str:
    t = _sanitizar_campo_ficha(texto)
    if not t:
        return ""
    oraciones = [o.strip() for o in re.split(r"(?<=[.!?])\s+", t) if o.strip()]
    seguras: list[str] = []
    for o in oraciones:
        if not _oracion_apta_descripcion_mp(o):
            continue
        seguras.append(o)
        if len(seguras) >= max_oraciones:
            break
    if not seguras:
        return ""
    out = " ".join(seguras)
    if _contar_palabras(out) > max_palabras:
        acum: list[str] = []
        total = 0
        for o in seguras:
            wo = _contar_palabras(o)
            if total + wo > max_palabras and acum:
                break
            acum.append(o)
            total += wo
        out = " ".join(acum) if acum else out
        if _contar_palabras(out) > max_palabras:
            partes = re.findall(r"\S+", out)
            out = " ".join(partes[:max_palabras]).rstrip(",;:")
            if not out.endswith((".", "!", "?")):
                out += "."
    return out


def _ajustar_parrafo_longitud(
    parrafo: str,
    max_palabras: int = PALABRAS_POR_PARRAFO_MAX + 25,
) -> str:
    p = re.sub(r"\s+", " ", (parrafo or "").strip())
    if not p:
        return p
    if _contar_palabras(p) <= max_palabras:
        return p
    oraciones = [o.strip() for o in re.split(r"(?<=[.!?])\s+", p) if o.strip()]
    acum: list[str] = []
    total = 0
    for o in oraciones:
        wo = _contar_palabras(o)
        if total + wo > max_palabras and acum:
            break
        acum.append(o)
        total += wo
    if acum:
        return " ".join(acum)
    partes = re.findall(r"\S+", p)
    out = " ".join(partes[:max_palabras]).rstrip(",;:")
    return out + ("" if out.endswith((".", "!", "?")) else ".")


def _ampliar_parrafo_si_corto(parrafo: str, relleno: str) -> str:
    p = re.sub(r"\s+", " ", (parrafo or "").strip())
    if _contar_palabras(p) >= PALABRAS_POR_PARRAFO_MIN:
        return p
    return f"{p.rstrip('.')}. {relleno}".strip()


def _plantilla_respaldo_catalogo(
    contexto_capas: dict | None = None,
    segmento: str | None = None,
) -> str:
    seg = segmento or _segmento_insumo(contexto_capas)
    titulo_en_capa = bool((contexto_capas or {}).get("titulo"))
    p1_ini = _apertura_p1(seg, titulo_en_capa, "insumo").rstrip(".")
    if seg == "alimentario":
        p1 = (
            f"{p1_ini}. Se presenta con apariencia y color característicos del "
            "ingrediente, en forma acorde a su perfil físico-químico. Es soluble o "
            "dispersable en medios acuosos y en mezclas húmedas o secas de la "
            "industria de alimentos. Como materia prima aporta estabilidad de "
            "proceso, solubilidad en la matriz y comportamiento organoléptico "
            "predecible según la fórmula, el equipamiento de planta y las "
            "condiciones de elaboración definidas por el fabricante."
        )
        p2 = (
            "En la industria de alimentos y bebidas se emplea en premezclas, bases "
            "en polvo y mezclas intermedias para productos elaborados por terceros. "
            "Su inclusión obedece al diseño de la formulación alimentaria y a la "
            f"normativa sanitaria aplicable al producto.{_P2_CIERRE}"
        )
    elif seg == "cosmetico":
        p1 = (
            f"{p1_ini}. Se presenta con apariencia y estado físico propios de "
            "insumos cosméticos industriales. Es soluble o dispersable en los "
            "medios de formulación habituales (fase acuosa u oleosa según perfil). "
            "Como materia prima aporta propiedades funcionales que condicionan "
            "textura, estabilidad y compatibilidad en emulsiones, geles y bases."
        )
        p2 = (
            "En la industria cosmética se emplea como componente de formulación "
            "según la aplicación prevista y la normativa vigente."
            f"{_P2_CIERRE}"
        )
    elif seg == "farmaceutico":
        p1 = (
            f"{p1_ini}. Se presenta con apariencia y pureza acordes a su uso en "
            "formulación farmacéutica industrial. Es soluble o dispersable en "
            "vehículos de formulación según su perfil químico. Como materia prima "
            "aporta comportamiento reológico y compatibilidad en la mezcla final."
        )
        p2 = (
            "En la industria farmacéutica se emplea como excipiente o activo "
            "según la aplicación prevista y la normativa aplicable."
            f"{_P2_CIERRE}"
        )
    else:
        p1 = (
            f"{p1_ini}. Se presenta con apariencia y estado físico definidos para "
            "uso industrial (polvo, granular o líquido según presentación). Es "
            "soluble o dispersable en los medios habituales de formulación, con "
            "buena compatibilidad en procesos de mezcla en planta. Como materia "
            "prima aporta propiedades funcionales que condicionan textura, "
            "estabilidad de proceso y comportamiento reológico de la matriz final."
        )
        p2 = (
            "En aplicaciones industriales se incorpora como componente de "
            "formulación según la aplicación prevista y la normativa "
            f"aplicable.{_P2_CIERRE}"
        )
    return f"{_ajustar_parrafo_longitud(p1)}\n\n{_ajustar_parrafo_longitud(p2)}"


def _contiene_basura_ficha(texto: str) -> bool:
    t = texto or ""
    if _RE_ESPECIFICACIONES.search(t):
        return True
    if _RE_ETIQUETA_FICHA.search(t):
        return True
    if re.search(r"\b(?:Y\s+)?ALMACENAMIENTO\b", t):
        return True
    if re.search(r"\b(?:M[aá]x|Min)\.?\s*[\d,.]+\b", t, re.I):
        return True
    return False


def _contexto_ficha_para_ia(ficha: dict) -> str:
    parsed = _parsear_ficha_estructurada(ficha.get("texto") or "")
    blob = ficha.get("texto") or ""
    lineas = [f"Título: {ficha.get('titulo', '')}"]
    ap, sol = _extraer_apariencia_solubilidad_blob(blob)
    if ap:
        lineas.append(f"Apariencia física: {ap}")
    if sol:
        lineas.append(f"Solubilidad: {sol}")
    if parsed.get("fisica") and not ap and not sol:
        lineas.append(f"Descripción física: {parsed['fisica']}")
    if parsed.get("organoleptica"):
        lineas.append(f"Olor y sabor: {parsed['organoleptica']}")
    if parsed.get("alergenos"):
        lineas.append(f"Alérgenos: {parsed['alergenos']}")
    estab = _estabilidad_material(blob)
    if estab:
        lineas.append(f"Estabilidad del material: {estab}")
    props = _seccion_ficha(blob, "PROPIEDADES")
    if props:
        lineas.append(f"Propiedades como materia prima: {props[:420]}")
    if parsed.get("origen"):
        lineas.append(f"Tipo y origen: {parsed['origen']}")
    funcional = _inferir_funcional(blob + " " + parsed.get("origen", ""), parsed.get("titulo") or "")
    lineas.append(f"Función principal: {funcional}")
    mecanismo = _inferir_mecanismo(parsed.get("alimentaria", ""), parsed.get("origen", ""), "")
    lineas.append(f"Mecanismo general: {mecanismo}")
    if parsed.get("alimentaria"):
        lineas.append(f"Aplicaciones (párrafo 2): {parsed['alimentaria']}")
    return "\n".join(lineas)


def _seccion_ficha(texto: str, nombre: str) -> str:
    """Extrae el cuerpo de una sección de ficha (encabezados en mayúsculas)."""
    t = re.sub(r"\s+", " ", (texto or "").replace("\r\n", "\n")).strip()
    if nombre.upper().startswith("DESCRIPCI"):
        patron = r"(?:^|\s)DESCRIPCI[OÓ]N\b"
    elif nombre.upper().startswith("APLICACIONES"):
        patron = r"(?:^|\s)APLICACIONES\b"
    elif nombre.upper().startswith("ESTABILIDAD"):
        patron = r"(?:^|\s)ESTABILIDAD\b"
    elif nombre.upper().startswith("ALMACENAMIENTO"):
        patron = r"(?:^|\s)ALMACENAMIENTO\b"
    else:
        patron = rf"(?:^|\s){re.escape(nombre)}\b"
    m = re.search(rf"{patron}\s*(.*)$", t)
    if not m:
        return ""
    resto = m.group(1).strip()
    fin = _SECCION_RE.search(resto)
    cuerpo = resto[: fin.start()].strip() if fin else resto
    cuerpo = re.sub(r"^[:\-\s]+", "", cuerpo)
    return _sanitizar_campo_ficha(cuerpo)


def _parsear_ficha_estructurada(cuerpo: str) -> dict[str, str]:
    """Extrae campos útiles de fichas en JSON o texto plano de Google Sheets."""
    t = re.sub(r"\s+", " ", (cuerpo or "").replace("\r\n", "\n")).strip()
    out: dict[str, str] = {}

    ap = re.search(
        r"Apariencia:\s*(.+?)(?=Olor y sabor|Solubilidad:|Libre de|\bPROPIEDADES\b|\bAPLICACIONES\b|\bDESCRIPCI\b|$)",
        t,
        re.I,
    )
    sol = re.search(
        r"Solubilidad:\s*(.+?)(?=Olor y sabor|Libre de|\bPROPIEDADES\b|\bAPLICACIONES\b|\bDESCRIPCI\b|$)",
        t,
        re.I,
    )
    partes_fisicas: list[str] = []
    if ap:
        partes_fisicas.append(ap.group(1).strip().rstrip("."))
    if sol:
        partes_fisicas.append(sol.group(1).strip().rstrip("."))
    libre = re.search(
        r"Libre de\s+(.+?)(?=Olor y sabor|\bPROPIEDADES\b|\bAPLICACIONES\b|\bDESCRIPCI\b|$)",
        t,
        re.I,
    )
    if libre:
        partes_fisicas.append("libre de " + libre.group(1).strip().rstrip("."))
    soluble = re.search(
        r"\bSoluble en\s+[^.;]+",
        t,
        re.I,
    )
    if soluble:
        frag = soluble.group(0).strip().rstrip(".")
        if frag.lower() not in " ".join(partes_fisicas).lower():
            partes_fisicas.append(frag[0].lower() + frag[1:])
    if partes_fisicas:
        out["fisica"] = _sanitizar_campo_ficha(", ".join(partes_fisicas))

    out["organoleptica"] = _prosa_olor_sabor(t)
    out["alergenos"] = _prosa_alergenos(t)

    out["origen"] = _seccion_ficha(t, "DESCRIPCIÓN")
    out["alimentaria"] = _seccion_ficha(t, "APLICACIONES")
    out["almacenamiento"] = _seccion_ficha(t, "ESTABILIDAD") or _seccion_ficha(t, "ALMACENAMIENTO")

    if not out.get("fisica"):
        # Detenerse al llegar a otra sección (APLICACIONES, RECOMENDACIONES...):
        # sin este corte, una viñeta de uso que mencione "color" o "olor" del
        # producto FINAL (ej. "mantiene el color de alimentos congelados") se
        # adoptaba como si describiera el aspecto físico de la materia prima.
        header_stop = re.compile(
            r"^(APLICACIONES|RECOMENDACIONES|PROPIEDADES|DOSIFICACI[OÓ]N|"
            r"COMPONENTES|BENEFICIOS|ESTABILIDAD|ALMACENAMIENTO)\b",
            re.I,
        )
        for ln in (cuerpo or "").splitlines():
            ln = ln.strip()
            if not ln:
                continue
            if header_stop.match(ln):
                break
            if re.search(r"apariencia|solubil|polvo|líquido|color|olor", ln, re.I):
                out["fisica"] = _limpiar_fragmento_ficha(ln)
                break

    if not out.get("origen"):
        for ln in (cuerpo or "").splitlines():
            ln = ln.strip()
            if len(ln) > 50 and re.search(r"obtenid|proceso|concentraci|deshidrat", ln, re.I):
                out["origen"] = _limpiar_fragmento_ficha(ln)
                break

    if not out.get("alimentaria"):
        for ln in (cuerpo or "").splitlines():
            ln = ln.strip()
            if re.search(r"aliment|nutri|proteín|ferment", ln, re.I) and len(ln) > 40:
                out["alimentaria"] = _limpiar_fragmento_ficha(ln)
                break

    return out


def _extraer_apariencia_solubilidad_blob(cuerpo: str) -> tuple[str, str]:
    """Devuelve (apariencia, solubilidad) como texto limpio desde la ficha."""
    t = re.sub(r"\s+", " ", (cuerpo or "").replace("\r\n", "\n")).strip()
    ap = ""
    sol = ""
    m_ap = re.search(
        r"Apariencia:\s*(.+?)(?=Olor y sabor|Solubilidad:|Libre de|\bPROPIEDADES\b|\bAPLICACIONES\b|\bDESCRIPCI\b|$)",
        t,
        re.I,
    )
    if m_ap:
        ap = _sanitizar_campo_ficha(m_ap.group(1))
    m_sol = re.search(
        r"Solubilidad:\s*(.+?)(?=Olor y sabor|Libre de|\bPROPIEDADES\b|\bAPLICACIONES\b|\bDESCRIPCI\b|$)",
        t,
        re.I,
    )
    if m_sol:
        sol = _sanitizar_campo_ficha(m_sol.group(1))
    return ap, sol


def _oracion_apariencia_fisica(ap: str, blob: str) -> str:
    if ap:
        if re.match(
            r"^(polvo|l[ií]quido|granul|cristal|escama|hojuela|gel|pasta|flor|semilla)",
            ap,
            re.I,
        ):
            return f"Se presenta en forma de {ap[0].lower()}{ap[1:].rstrip('.')}."
        return f"En apariencia, {ap[0].lower()}{ap[1:].rstrip('.')}."
    if re.search(r"\bpolvo\b", blob, re.I):
        color = ""
        m = re.search(
            r"color\s+(?:blanco|amarill|incolor|crema|característico[^.;]*)",
            blob,
            re.I,
        )
        if m:
            color = f" de {m.group(0).replace('color ', '').strip().rstrip('.')}"
        return f"Se presenta como polvo fino{color}."
    if re.search(r"\bl[ií]quido\b", blob, re.I):
        return "Se presenta en estado líquido de uso industrial."
    if re.search(r"\bgranul", blob, re.I):
        return "Se presenta en forma granular de uso industrial."
    return ""


def _oracion_solubilidad(sol: str, blob: str) -> str:
    if sol:
        if re.search(r"solubl", sol, re.I):
            return f"{sol[0].upper()}{sol[1:].rstrip('.')}."
        return f"Presenta solubilidad {sol[0].lower()}{sol[1:].rstrip('.')}."
    m = re.search(r"\bSoluble en\s+[^.;]+", blob, re.I)
    if m:
        return f"{m.group(0).strip().rstrip('.')}."
    m = re.search(r"dispersable en[^.;]+", blob, re.I)
    if m:
        frag = m.group(0).strip().rstrip(".")
        return f"Es {frag[0].lower()}{frag[1:]}."
    return ""


def _oracion_propiedades_mp(blob: str, parsed: dict[str, str], nombre: str) -> str:
    props = _seccion_ficha(blob, "PROPIEDADES")
    if props:
        safe = _oraciones_seguras_ficha(props, max_oraciones=1, max_palabras=45)
        if safe and _oracion_apta_descripcion_mp(safe):
            lead = safe.lstrip(": ").strip()
            if re.match(r"^fuente de", lead, re.I):
                lead = f"Actúa como {lead[0].lower()}{lead[1:]}"
            elif not re.match(r"^como materia prima", lead, re.I):
                lead = f"Como materia prima, {lead[0].lower()}{lead[1:]}"
            return lead if lead.endswith((".", "!", "?")) else f"{lead}."
    funcional = _inferir_funcional(blob + " " + parsed.get("origen", ""), nombre)
    mecanismo = _inferir_mecanismo(parsed.get("alimentaria", ""), parsed.get("origen", ""), nombre)
    if funcional and mecanismo and funcional != mecanismo:
        return f"{funcional.rstrip('.')}. {mecanismo.rstrip('.')}."
    if funcional:
        return funcional
    return (
        "Como materia prima aporta propiedades funcionales que condicionan "
        "textura, estabilidad y comportamiento de la mezcla final."
    )


def _oraciones_desde_ficha(cuerpo: str) -> list[str]:
    lineas = []
    for ln in (cuerpo or "").splitlines():
        ln = _limpiar_fragmento_ficha(ln)
        if len(ln) >= 25:
            lineas.append(ln)
    desc = ""
    bloques = re.split(r"\n\s*\n", cuerpo or "")
    if bloques:
        desc = _limpiar_fragmento_ficha(bloques[0].replace("\n", " "))
    if desc and desc not in lineas:
        lineas.insert(0, desc)
    return lineas


def _validar_texto_catalogo(
    texto: str,
    max_chars: int,
    min_palabras: int = PALABRAS_MIN,
    max_palabras: int = PALABRAS_MAX,
    estricto: bool = True,
    contexto_capas: dict | None = None,
    anclas: list[str] | None = None,
) -> str | None:
    t = _asegurar_dos_parrafos(_post_procesar_texto(texto))
    if len(t) < 200:
        return None
    paras = [p for p in re.split(r"\n\s*\n", t) if p.strip()]
    if len(paras) < 2:
        return None
    min_p = PALABRAS_POR_PARRAFO_MIN if estricto else max(45, PALABRAS_POR_PARRAFO_MIN - 15)
    max_p = PALABRAS_POR_PARRAFO_MAX + (25 if estricto else 40)
    for p in paras[:2]:
        wp = _contar_palabras(p)
        if wp < min_p or wp > max_p:
            return None
    palabras = _contar_palabras(t)
    min_total = min_palabras if estricto else max(90, min_palabras - 30)
    if palabras < min_total or palabras > max_palabras + 40:
        return None
    if re.search(
        r"(DESCRIPCIÓN FÍSICA|DESCRIPCIÓN FUNCIONAL|IMPORTANCIA Y MECANISMO|"
        r"APLICACIONES|REFERENCIA DE USO|^\s*[•\-]\s)",
        t,
        re.I | re.M,
    ):
        return None
    if _APROPIACION_RE.search(t):
        return None
    if re.search(r"se emplea en Para la industria|se emplea en En la industria", t, re.I):
        return None
    if _contiene_basura_ficha(t):
        return None
    if _RE_ALMACENAMIENTO_P1.search(paras[0]):
        return None
    if _contiene_riesgo_meli(t):
        return None
    if _repite_capas_etiqueta(t, contexto_capas):
        return None
    if _repeticion_excesiva(t, anclas, contexto_capas):
        return None
    if _redaccion_deficiente(t):
        return None
    if not _cumple_segmento(t, contexto_capas):
        return None
    return t[:max_chars]


def _cumple_segmento(texto: str, contexto_capas: dict | None) -> bool:
    seg = _segmento_insumo(contexto_capas)
    t = _norm(texto)
    if seg == "alimentario":
        if not re.search(r"alimentar|bebidas|alimentos", t):
            return False
        if re.search(r"\bcosmet|\bfarmac", t):
            return False
    if seg == "cosmetico" and re.search(r"\bfarmac|\balimentar", t):
        return False
    if seg == "farmaceutico" and re.search(r"\bcosmet|\balimentar", t):
        return False
    return True


def _aceptar_texto_ia(
    texto: str,
    max_chars: int,
    contexto_capas: dict | None = None,
    anclas: list[str] | None = None,
) -> str | None:
    limpio = _post_procesar_texto(texto)
    if anclas:
        limpio = _suavizar_repeticiones(limpio, anclas, contexto_capas)
    else:
        limpio = _pulir_redaccion(limpio)
    for estricto in (True, False):
        ok = _validar_texto_catalogo(
            limpio,
            max_chars,
            estricto=estricto,
            contexto_capas=contexto_capas,
            anclas=anclas,
        )
        if ok:
            return ok
    return None


def _filtrar_sugerencias(
    items: list[dict],
    max_chars: int,
    contexto_capas: dict | None = None,
    anclas: list[str] | None = None,
) -> list[dict]:
    out: list[dict] = []
    for item in items:
        raw = (item.get("texto") or "").strip()
        if not raw:
            continue
        aceptado = _aceptar_texto_ia(
            raw,
            max_chars,
            contexto_capas=contexto_capas,
            anclas=anclas,
        )
        if aceptado:
            out.append({**item, "texto": aceptado})
    return out


def _fallback_catalogo(
    fragmento: str,
    fichas: list[dict],
    max_chars: int,
    contexto_capas: dict | None = None,
) -> list[dict]:
    if not fichas:
        return []
    ficha = fichas[0]
    titulo = (ficha.get("titulo") or fragmento).strip()
    # `titulo` puede traer el prefijo de familia de documento ("FT/COA/SDS ...")
    # que antepone `_buscar_en_fichas_word` — útil para mostrar la fuente,
    # pero nunca para construir el nombre del ingrediente en la prosa.
    titulo_nombre = _titulo_sin_prefijo_fuente(titulo)
    nombre = _nombre_materia_prima(titulo_nombre)
    blob = ficha.get("texto") or ""
    parsed = _parsear_ficha_estructurada(blob)
    segmento = _segmento_insumo(contexto_capas, blob)

    fisica = parsed.get("fisica", "")
    organo = parsed.get("organoleptica", "")
    alergenos = parsed.get("alergenos", "")
    origen = parsed.get("origen", "")
    alim = parsed.get("alimentaria", "")

    titulo_en_capa = _titulo_ya_en_capa(titulo_nombre, nombre, contexto_capas)
    ap, sol = _extraer_apariencia_solubilidad_blob(blob)
    p1_partes = [_apertura_p1(segmento, titulo_en_capa, nombre)]
    or_ap = _oracion_apariencia_fisica(ap, blob)
    if or_ap:
        p1_partes.append(or_ap)
    elif fisica and not ap:
        fp = _oraciones_seguras_ficha(fisica, max_oraciones=1, max_palabras=35)
        if fp:
            p1_partes.append(f"Se presenta como {fp[0].lower()}{fp[1:].rstrip('.')}.")
        elif not _contiene_riesgo_meli(fisica) and not _contiene_basura_ficha(fisica):
            p1_partes.append(f"Se presenta como {fisica[0].lower()}{fisica[1:].rstrip('.')}.")
    or_sol = _oracion_solubilidad(sol, blob)
    if or_sol:
        p1_partes.append(or_sol)
    if organo and _oracion_apta_descripcion_mp(organo):
        ya_libre = re.search(r"libre de olores", " ".join(p1_partes), re.I)
        if not (ya_libre and re.search(r"libre de olores", organo, re.I)):
            p1_partes.append(organo)
    if alergenos and _oracion_apta_descripcion_mp(alergenos):
        p1_partes.append(alergenos)
    estab_mat = _estabilidad_material(blob)
    if estab_mat:
        p1_partes.append(estab_mat)
    origen_safe = _oraciones_seguras_ficha(origen, max_oraciones=2, max_palabras=50)
    if origen_safe and origen_safe != fisica:
        p1_partes.append(
            origen_safe if origen_safe.endswith((".", "!", "?")) else f"{origen_safe}."
        )
    p1_partes.append(_oracion_propiedades_mp(blob, parsed, nombre))
    p1 = _ampliar_parrafo_si_corto(
        _ajustar_parrafo_longitud(" ".join(p1_partes)),
        _relleno_p1(segmento),
    )

    alim_safe = _oraciones_seguras_ficha(alim, max_oraciones=2, max_palabras=55)
    if alim_safe:
        if re.search(r"^en la industria", alim_safe, re.I):
            usos = [
                alim_safe if alim_safe.endswith((".", "!", "?")) else f"{alim_safe}."
            ]
        elif re.search(r"^industria ", alim_safe, re.I):
            usos = [
                f"Se emplea en la {alim_safe[0].lower()}{alim_safe[1:].rstrip('.')}."
            ]
        else:
            # "alimentaria" solo cuando el segmento realmente lo es — asumirlo
            # por defecto en el segmento "general" etiquetaba usos no
            # alimentarios (ej. plaguicidas) como si lo fueran.
            if segmento == "alimentario":
                pref = "En la industria alimentaria"
            elif segmento == "cosmetico":
                pref = "En la industria cosmética"
            elif segmento == "farmaceutico":
                pref = "En la industria farmacéutica"
            else:
                pref = "En aplicaciones industriales"
            usos = [
                f"{pref}, {alim_safe[0].lower()}{alim_safe[1:].rstrip('.')}."
            ]
    else:
        usos = [_uso_generico_p2(segmento)]

    p2 = _ampliar_parrafo_si_corto(
        _ajustar_parrafo_longitud(" ".join(usos) + _P2_CIERRE),
        _relleno_p2(segmento),
    )
    texto = _asegurar_dos_parrafos(_post_procesar_texto(f"{p1}\n\n{p2}"))
    anclas = _terminos_ancla_repeticion(fragmento, contexto_capas, titulo_nombre)
    aceptado = _aceptar_texto_ia(
        texto,
        max_chars,
        contexto_capas=contexto_capas,
        anclas=anclas,
    )
    if not aceptado:
        respaldo = _plantilla_respaldo_catalogo(contexto_capas, segmento=segmento)
        aceptado = _aceptar_texto_ia(
            respaldo,
            max_chars,
            contexto_capas=contexto_capas,
            anclas=anclas,
        )
    if not aceptado:
        return []
    return [{
        "texto": aceptado,
        "titulo": titulo,
        "fuente": ficha.get("fuente") or "",
    }]


def _generar_con_gemini(
    fragmento: str,
    fichas: list[dict],
    max_chars: int,
    n_opciones: int = 1,
    contexto_capas: dict | None = None,
) -> list[dict]:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return _fallback_catalogo(fragmento, fichas, max_chars, contexto_capas=contexto_capas)

    contexto = ""
    titulo_ficha = _titulo_sin_prefijo_fuente(
        (fichas[0].get("titulo") if fichas else "") or fragmento
    )
    nombre_canonico = _nombre_materia_prima(titulo_ficha)
    anclas = _terminos_ancla_repeticion(fragmento, contexto_capas, titulo_ficha)
    segmento = _segmento_insumo(
        contexto_capas,
        (fichas[0].get("texto") if fichas else "") or "",
    )
    for i, f in enumerate(fichas, 1):
        contexto += f"\n\n--- FICHA {i}: {f.get('titulo', '')} ---\n"
        contexto += _contexto_ficha_para_ia(f)[:2200]

    prompt = _PROMPT_CATALOGO.format(
        fragmento=fragmento,
        nombre_canonico=nombre_canonico,
        n_opciones=n_opciones,
        palabras_por_parrafo=PALABRAS_POR_PARRAFO,
        palabras_parrafo_min=PALABRAS_POR_PARRAFO_MIN,
        palabras_parrafo_max=PALABRAS_POR_PARRAFO_MAX,
        palabras_objetivo=PALABRAS_OBJETIVO,
        max_chars=max_chars,
        contexto_otras_capas=_formatear_contexto_otras_capas(contexto_capas),
        instrucciones_segmento=_instrucciones_segmento(segmento),
        contexto=contexto,
    )

    titulo = fichas[0].get("titulo") if fichas else ""
    fuente = fichas[0].get("fuente") if fichas else ""

    try:
        from google import genai
        from google.genai import types as genai_types

        # timeout explícito (ms): sin esto una llamada colgada bloquea todo
        # el flujo (agravado por los reintentos de abajo).
        client = genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(timeout=20_000),
        )
    except Exception:
        return _fallback_catalogo(fragmento, fichas, max_chars, contexto_capas=contexto_capas)

    # Un solo candidato de Gemini a veces incumple una regla de validación
    # (frase clonada prohibida, contenido de párrafo 2 colado en el 1, etc.)
    # aunque el resto del texto sea bueno. Antes de caer a la plantilla
    # genérica de respaldo, se reintenta un par de veces — la variación
    # entre generaciones suele bastar para producir un candidato válido.
    INTENTOS_GEMINI = 3
    for intento in range(INTENTOS_GEMINI):
        try:
            resp = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
            raw = (resp.text or "").strip()
            data = _extraer_json(raw)

            if data and isinstance(data.get("sugerencias"), list):
                out: list[dict] = []
                for item in data["sugerencias"]:
                    raw_txt = item if isinstance(item, str) else (
                        str(item.get("texto") or "") if isinstance(item, dict) else ""
                    )
                    texto = (
                        _aceptar_texto_ia(
                            raw_txt,
                            max_chars,
                            contexto_capas=contexto_capas,
                            anclas=anclas,
                        )
                        if raw_txt
                        else None
                    )
                    if texto:
                        out.append({"texto": texto, "titulo": titulo, "fuente": fuente})
                if out:
                    return out[:n_opciones]
                continue

            texto_raw = raw if data is None else ""
            aceptado = (
                _aceptar_texto_ia(
                    texto_raw,
                    max_chars,
                    contexto_capas=contexto_capas,
                    anclas=anclas,
                )
                if texto_raw
                else None
            )
            if aceptado:
                return [{"texto": aceptado, "titulo": titulo, "fuente": fuente}]
        except Exception:
            continue

    return _fallback_catalogo(fragmento, fichas, max_chars, contexto_capas=contexto_capas)


def sugerir_texto_magico(
    fragmento: str,
    max_chars: int = MAX_CHARS_CATALOGO,
    contexto_capas: dict | None = None,
) -> dict:
    fragmento = (fragmento or "").strip()
    palabras = _palabras_clave(fragmento, min_len=3)
    if len(palabras) < 2:
        return {
            "ok": False,
            "error": "Escribe al menos dos palabras para sugerencias",
            "sugerencias": [],
            "fichas": [],
        }

    fichas = _recolectar_fichas(fragmento, palabras, contexto_capas=contexto_capas)
    if not fichas:
        return {
            "ok": True,
            "sugerencias": [],
            "fichas": [],
            "mensaje": "No hay fichas técnicas que coincidan con esas palabras",
        }

    titulo_ficha = _titulo_sin_prefijo_fuente((fichas[0].get("titulo") or fragmento).strip())
    anclas = _terminos_ancla_repeticion(fragmento, contexto_capas, titulo_ficha)

    sugerencias = _filtrar_sugerencias(
        _generar_con_gemini(
            fragmento,
            fichas,
            max_chars=max_chars,
            contexto_capas=contexto_capas,
        ),
        max_chars,
        contexto_capas=contexto_capas,
        anclas=anclas,
    )
    if not sugerencias and fichas:
        sugerencias = _filtrar_sugerencias(
            _fallback_catalogo(
                fragmento,
                fichas,
                max_chars=max_chars,
                contexto_capas=contexto_capas,
            ),
            max_chars,
            contexto_capas=contexto_capas,
            anclas=anclas,
        )
    mensaje_extra = None
    if not sugerencias and fichas:
        mensaje_extra = (
            "No se pudo generar texto válido con la ficha disponible. "
            "Revisa las palabras clave o edita manualmente la descripción."
        )
    return {
        "ok": True,
        "sugerencias": sugerencias,
        "fichas": [
            {"titulo": f.get("titulo"), "fuente": f.get("fuente")}
            for f in fichas
        ],
        **({"mensaje": mensaje_extra} if mensaje_extra else {}),
    }


def _limpiar_jobs_texto_magico() -> None:
    limite = time.time() - _JOB_TTL_SEC
    with _jobs_lock:
        viejos = [k for k, v in _jobs_texto_magico.items() if (v.get("created") or 0) < limite]
        for k in viejos:
            _jobs_texto_magico.pop(k, None)


def iniciar_sugerencia_texto_job(
    fragmento: str,
    max_chars: int = MAX_CHARS_CATALOGO,
    contexto_capas: dict | None = None,
) -> str:
    _limpiar_jobs_texto_magico()
    job_id = uuid.uuid4().hex[:16]
    with _jobs_lock:
        _jobs_texto_magico[job_id] = {
            "status": "pending",
            "created": time.time(),
            "result": None,
            "error": None,
        }

    def _run() -> None:
        try:
            result = sugerir_texto_magico(
                fragmento,
                max_chars=max_chars,
                contexto_capas=contexto_capas,
            )
            with _jobs_lock:
                _jobs_texto_magico[job_id] = {
                    "status": "done",
                    "created": time.time(),
                    "result": result,
                    "error": None,
                }
        except Exception as exc:
            with _jobs_lock:
                _jobs_texto_magico[job_id] = {
                    "status": "error",
                    "created": time.time(),
                    "result": None,
                    "error": str(exc),
                }

    spawn_thread(_run, daemon=True)
    return job_id


def estado_sugerencia_texto_job(job_id: str) -> dict | None:
    _limpiar_jobs_texto_magico()
    with _jobs_lock:
        job = _jobs_texto_magico.get((job_id or "").strip())
        if not job:
            return None
        return dict(job)
