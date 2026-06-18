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

from app.observability import spawn_thread

_REPO = Path(__file__).resolve().parents[2]
_FICHAS_JSON = _REPO / "PAGINA_WEB" / "site" / "data" / "fichas_tecnicas.json"

_STOP = {
    "para", "con", "del", "los", "las", "una", "unos", "unas", "por", "que", "como",
    "the", "and", "de", "la", "el", "en", "y", "a", "es", "se",
}

_PROMPT_CATALOGO = """Eres redactor técnico-comercial de McKenna Group (materias primas farmacéuticas, cosméticas y alimentarias).

El usuario escribe palabras clave para identificar una materia prima:
"{fragmento}"

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
- Usa el NOMBRE DE LA MATERIA PRIMA (ej. "el ácido ascórbico", "la niacinamida") y construcciones como: "se presenta", "es soluble en", "se emplea en", "se utiliza como", "presenta", "actúa como".
- El texto debe leerse como una ficha técnica o descriptivo de catálogo de ingrediente, no como copy publicitario de una empresa.

Contenido a integrar de forma natural (sin títulos ni viñetas):

PÁRRAFO 1 (descriptivo técnico; NO incluir instrucciones de almacenamiento, caducidad ni conservación):
1) Descripción física inicial: apariencia, estado físico, color, olor si aplica, solubilidad y estabilidad frente al aire, humedad, luz o temperatura (como propiedad del material, no como recomendación de guardado).
2) Descripción funcional: qué tipo de sustancia es y cuál es su función principal (p. ej. antioxidante, acidulante, humectante, conservante, emulsionante, espesante, solvente, activo cosmético, fuente de proteínas, fuente mineral).
3) Importancia o mecanismo general: papel que cumple en procesos biológicos, químicos, alimentarios, cosméticos o industriales, sin afirmaciones médicas.

PÁRRAFO 2 (aplicaciones):
- Aplicaciones por industria (alimentaria, farmacéutica, cosmética, química/laboratorio si aplica en fichas).
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
        blob = _norm(f"{clave} {_ficha_dict_a_texto(ficha)}")
        hits = sum(1 for p in palabras if p in blob)
        if hits < min(2, len(palabras)):
            continue
        score = hits * 100 + len(clave)
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


def _recolectar_fichas(fragmento: str, palabras: list[str], limite: int = 3) -> list[dict]:
    vistos: set[str] = set()
    resultados: list[dict] = []

    sheet = _buscar_en_sheets(fragmento)
    if sheet:
        vistos.add(sheet["clave"])
        resultados.append(sheet)

    for item in _buscar_en_json(palabras, limite=limite):
        if item["clave"] in vistos:
            continue
        vistos.add(item["clave"])
        resultados.append(item)

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


def _nombre_materia_prima(titulo: str) -> str:
    t = (titulo or "materia prima").strip()
    if t.isupper():
        t = t.title()
    minusculas = {"de", "del", "la", "el", "los", "las", "y", "e", "o", "u"}
    partes = [p.lower() if p.lower() in minusculas else p for p in t.split()]
    return " ".join(partes).lower()


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
        t = re.sub(r"\b(?:Y\s+)?ALMACENAMIENTO\b", "", t, flags=re.I)
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
    return f"El {nombre} cumple una función técnica dentro de procesos de formulación industrial."


def _inferir_mecanismo(alim: str, origen: str, nombre: str) -> str:
    if alim and not _es_texto_generico(alim):
        a = _limpiar_fragmento_ficha(alim)
        if re.search(r"fuente de prote[ií]nas|otorga m[uú]ltiples propiedades", a, re.I):
            return (
                f"En matrices alimentarias e industriales, aporta proteínas y propiedades "
                f"funcionales que inciden en la textura, el valor nutricional y el "
                f"comportamiento del producto terminado."
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
        f"Interviene en procesos biológicos, químicos e industriales como componente "
        f"funcional de formulaciones especializadas."
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
    t = re.sub(r"\bM[aá]x\.?\s*[\d,.]+", " ", t, flags=re.I)
    t = re.sub(r"\bMin\.?\s*[\d,.]+", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _prosa_olor_sabor(texto: str) -> str:
    t = texto or ""
    if not re.search(r"olor|sabor", t, re.I):
        return ""
    notas: list[str] = []
    if re.search(r"sabor salado|dulz[oó]n", t, re.I):
        notas.append("sabor salado-dulzón")
    if re.search(r"olor l[aá]ctico|l[aá]ctico suave", t, re.I):
        notas.append("olor láctico suave")
    elif re.search(r"olor caracter[ií]stico", t, re.I):
        notas.append("olor característico")
    if re.search(r"libre de olores", t, re.I):
        notas.append("libre de olores extraños")
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
    t = re.sub(r"\b(?:Y\s+)?ALMACENAMIENTO\b", "", t, flags=re.I)
    t = re.sub(r"\bPROPIEDADES ORGANOL[EÉ]PTICAS\b", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip().rstrip(".")


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
    if parsed.get("fisica"):
        lineas.append(f"Descripción física: {parsed['fisica']}")
    if parsed.get("organoleptica"):
        lineas.append(f"Olor y sabor: {parsed['organoleptica']}")
    if parsed.get("alergenos"):
        lineas.append(f"Alérgenos: {parsed['alergenos']}")
    estab = _estabilidad_material(blob)
    if estab:
        lineas.append(f"Estabilidad del material: {estab}")
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
        for ln in (cuerpo or "").splitlines():
            ln = ln.strip()
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
    return t[:max_chars]


def _aceptar_texto_ia(texto: str, max_chars: int) -> str | None:
    limpio = _post_procesar_texto(texto)
    for estricto in (True, False):
        ok = _validar_texto_catalogo(limpio, max_chars, estricto=estricto)
        if ok:
            return ok
    return None


def _fallback_catalogo(fragmento: str, fichas: list[dict], max_chars: int) -> list[dict]:
    if not fichas:
        return []
    ficha = fichas[0]
    titulo = (ficha.get("titulo") or fragmento).strip()
    nombre = _nombre_materia_prima(titulo)
    blob = ficha.get("texto") or ""
    parsed = _parsear_ficha_estructurada(blob)

    fisica = parsed.get("fisica", "")
    organo = parsed.get("organoleptica", "")
    alergenos = parsed.get("alergenos", "")
    origen = parsed.get("origen", "")
    alim = parsed.get("alimentaria", "")

    p1_partes = [f"El {nombre} es una materia prima de uso industrial y de formulación."]
    if fisica:
        p1_partes.append(f"Se presenta como {fisica[0].lower()}{fisica[1:].rstrip('.')}.")
    if organo:
        p1_partes.append(organo)
    if alergenos:
        p1_partes.append(alergenos)
    estab_mat = _estabilidad_material(blob)
    if estab_mat:
        p1_partes.append(estab_mat)
    if origen and origen != fisica:
        p1_partes.append(f"{origen[0].upper()}{origen[1:].rstrip('.')}.")
    p1_partes.append(_inferir_funcional(blob + " " + origen, nombre))
    p1_partes.append(_inferir_mecanismo(alim, origen, nombre))
    p1 = " ".join(p1_partes)

    usos: list[str] = []
    if alim and not _es_texto_generico(alim):
        a = _limpiar_fragmento_ficha(alim)
        if re.search(r"^(el|la|los|las)\s", a, re.I):
            usos.append(f"{a[0].upper()}{a[1:].rstrip('.')}.")
        elif re.search(r"industria alimentaria", a, re.I):
            usos.append(f"{a[0].upper()}{a[1:].rstrip('.')}.")
        else:
            usos.append(f"En la industria alimentaria, {a[0].lower()}{a[1:].rstrip('.')}.")

    if not usos:
        usos.append(
            f"El {nombre} se incorpora en procesos industriales según la aplicación "
            f"prevista y la normativa aplicable."
        )

    p2 = " ".join(usos)
    p2 += (
        " La concentración y el modo de incorporación dependen de la formulación final, "
        "la normativa aplicable y el criterio técnico del fabricante; se sugiere "
        f"consultar la ficha técnica de {(titulo or nombre).strip()} antes de definir rangos de uso "
        "en producto terminado."
    )
    texto = _asegurar_dos_parrafos(_post_procesar_texto(f"{p1}\n\n{p2}"))

    return [{
        "texto": _aceptar_texto_ia(texto, max_chars) or texto[:max_chars],
        "titulo": titulo,
        "fuente": ficha.get("fuente") or "",
    }]


def _generar_con_gemini(
    fragmento: str,
    fichas: list[dict],
    max_chars: int,
    n_opciones: int = 1,
) -> list[dict]:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return _fallback_catalogo(fragmento, fichas, max_chars)

    contexto = ""
    for i, f in enumerate(fichas, 1):
        contexto += f"\n\n--- FICHA {i}: {f.get('titulo', '')} ---\n"
        contexto += _contexto_ficha_para_ia(f)[:2200]

    prompt = _PROMPT_CATALOGO.format(
        fragmento=fragmento,
        n_opciones=n_opciones,
        palabras_por_parrafo=PALABRAS_POR_PARRAFO,
        palabras_parrafo_min=PALABRAS_POR_PARRAFO_MIN,
        palabras_parrafo_max=PALABRAS_POR_PARRAFO_MAX,
        palabras_objetivo=PALABRAS_OBJETIVO,
        max_chars=max_chars,
        contexto=contexto,
    )

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        raw = (resp.text or "").strip()
        data = _extraer_json(raw)
        titulo = fichas[0].get("titulo") if fichas else ""
        fuente = fichas[0].get("fuente") if fichas else ""

        if data and isinstance(data.get("sugerencias"), list):
            out: list[dict] = []
            for item in data["sugerencias"]:
                raw_txt = item if isinstance(item, str) else (
                    str(item.get("texto") or "") if isinstance(item, dict) else ""
                )
                texto = _aceptar_texto_ia(raw_txt, max_chars) if raw_txt else None
                if texto:
                    out.append({"texto": texto, "titulo": titulo, "fuente": fuente})
            if out:
                return out[:n_opciones]

        texto_raw = (raw if data is None else "")
        aceptado = _aceptar_texto_ia(texto_raw, max_chars) if texto_raw else None
        if aceptado:
            return [{"texto": aceptado, "titulo": titulo, "fuente": fuente}]

        return _fallback_catalogo(fragmento, fichas, max_chars)
    except Exception:
        return _fallback_catalogo(fragmento, fichas, max_chars)


def sugerir_texto_magico(fragmento: str, max_chars: int = MAX_CHARS_CATALOGO) -> dict:
    fragmento = (fragmento or "").strip()
    palabras = _palabras_clave(fragmento, min_len=3)
    if len(palabras) < 2:
        return {
            "ok": False,
            "error": "Escribe al menos dos palabras para sugerencias",
            "sugerencias": [],
            "fichas": [],
        }

    fichas = _recolectar_fichas(fragmento, palabras)
    if not fichas:
        return {
            "ok": True,
            "sugerencias": [],
            "fichas": [],
            "mensaje": "No hay fichas técnicas que coincidan con esas palabras",
        }

    sugerencias = _generar_con_gemini(fragmento, fichas, max_chars=max_chars)
    return {
        "ok": True,
        "sugerencias": sugerencias,
        "fichas": [
            {"titulo": f.get("titulo"), "fuente": f.get("fuente")}
            for f in fichas
        ],
    }


def _limpiar_jobs_texto_magico() -> None:
    limite = time.time() - _JOB_TTL_SEC
    with _jobs_lock:
        viejos = [k for k, v in _jobs_texto_magico.items() if (v.get("created") or 0) < limite]
        for k in viejos:
            _jobs_texto_magico.pop(k, None)


def iniciar_sugerencia_texto_job(fragmento: str, max_chars: int = MAX_CHARS_CATALOGO) -> str:
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
            result = sugerir_texto_magico(fragmento, max_chars=max_chars)
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
