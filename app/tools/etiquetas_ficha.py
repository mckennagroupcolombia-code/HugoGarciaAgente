"""
Descripción de etiqueta alternativa a partir de ficha técnica (Sheets col. I).

Genera texto estructurado (descripción general, aplicaciones por industria,
bloque regulatorio) y sanitiza claims de salud / suplemento terminado / uso médico.
"""
from __future__ import annotations

import re
from typing import Any

_RE_SECCION = re.compile(
    r"^(DESCRIPCIÓN|DESCRIPCION|APLICACIONES|RECOMENDACIONES|"
    r"PROPIEDADES(?:\s+FÍSICO-QUÍMICAS|\s+FISICO-QUIMICAS)?|"
    r"PROPIEDADES MICROBIOLÓGICAS|NOTA|ESTABILIDAD(?:\s+Y\s+ALMACENAMIENTO)?)\s*:?\s*$",
    re.I | re.M,
)

# Oraciones completas a descartar (no reescribir)
_ORACION_DESCARTAR = (
    "organismo humano",
    "ciclo de krebs",
    "laxante en exceso",
    "como suplemento dietario y nutriente",
    "uso farmacéutico",
    "uso farmaceutico",
    "procedimientos médicos",
    "procedimientos medicos",
    "tratamiento",
    "calambres musculares",
    "debilidad y fatiga",
    "deficiencia de magnesio",
    "función muscular y nerviosa",
    "funcion muscular y nerviosa",
    "salud ósea",
    "salud osea",
    "apoyar estas funciones",
    "prevenir o aliviar",
    "dosis recomendada",
    "porción diaria",
    "consumo humano directo",
    "ingerir",
    "tómalo",
    "tomalo",
    "registro invima",
    "beneficios para la salud",
    "grado farmacológico",
    "grado farmacologico",
)

# Reemplazos en oraciones que sí se conservan (reescritura MeLi-safe)
_REESCRITURAS: list[tuple[str, str]] = [
    (r"suplemento nutritivo", "insumo para fortificación mineral en matrices alimentarias"),
    (r"suplementos diet[áa]ricos?", "formulación nutricional industrial"),
    (r"fácil absorción", "buena solubilidad en procesos de formulación"),
    (r"facil absorcion", "buena solubilidad en procesos de formulación"),
    (r"biodisponibilidad[^,.;]*", "alta solubilidad en matrices acuosas"),
    (r"absorción por el cuerpo humano", "dispersión en matrices acuosas"),
    (r"absorcion por el cuerpo humano", "dispersión en matrices acuosas"),
    (r"mg por gramo", ""),
    (r"magnesio elemental", "mineral"),
    (r"antiácid[oa]s?", ""),
    (r"antiacid[oa]s?", ""),
]

_APLICACIONES_CITRATO_MAGNESIO = [
    (
        "Industria de Bebidas",
        "Se utiliza como regulador de acidez, acentuador de sabor y para la fortificación mineral "
        "en aguas saborizadas, bebidas isotónicas (deportivas), jugos y refrescos.",
    ),
    (
        "Suplementos y Nutrición Humana",
        "Insumo clave para la fabricación de premezclas en polvo, tabletas, cápsulas y gomitas "
        "funcionales enfocadas en la salud ósea, muscular y del sistema nervioso.",
    ),
    (
        "Panadería y Confitería",
        "Actúa como acondicionador de masa y agente de retención de humedad, además de enriquecer "
        "nutricionalmente productos horneados.",
    ),
    (
        "Lácteos y Alternativas Veganas",
        "Utilizado para la fortificación en leches, yogures y bebidas vegetales (almendra, soya, avena) "
        "sin alterar drásticamente la estabilidad de la mezcla.",
    ),
    (
        "Conservación de Alimentos",
        "Por su componente de citrato, ayuda a estabilizar el pH de los alimentos, actuando como un "
        "sinergista de antioxidantes y prolongando la vida útil comercial de algunos productos.",
    ),
]

_MAX_DESCRIPCION_ETIQUETA = 3200


def _partir_oraciones(texto: str) -> list[str]:
    raw = re.sub(r"\s+", " ", (texto or "").strip())
    if not raw:
        return []
    partes = re.split(r"(?<=[.!?])\s+", raw)
    return [p.strip() for p in partes if p.strip()]


def _oracion_descartar(oracion: str) -> bool:
    low = oracion.lower()
    return any(p in low for p in _ORACION_DESCARTAR)


def _sanitizar_oracion(oracion: str) -> str:
    o = (oracion or "").strip()
    if not o or _oracion_descartar(o):
        return ""
    for pat, repl in _REESCRITURAS:
        o = re.sub(pat, repl, o, flags=re.I)
    o = re.sub(r"\s+", " ", o).strip(" .,;")
    if len(o) < 12:
        return ""
    return o


def _parse_secciones(ficha: str) -> dict[str, str]:
    texto = (ficha or "").strip()
    if not texto:
        return {}
    matches = list(_RE_SECCION.finditer(texto))
    if not matches:
        return {"DESCRIPCIÓN": texto}
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        nombre = m.group(1).upper().replace("Ó", "O").split()[0]
        if nombre.startswith("PROPIEDADES"):
            nombre = "PROPIEDADES"
        elif nombre.startswith("ESTABILIDAD"):
            nombre = "ESTABILIDAD"
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        bloque = texto[start:end].strip()
        if bloque:
            out[nombre] = (out.get(nombre, "") + " " + bloque).strip()
    return out


def _compactar_texto(texto: str, max_chars: int = _MAX_DESCRIPCION_ETIQUETA) -> str:
    t = (texto or "").strip()
    if len(t) <= max_chars:
        return t
    cut = t[: max(1, max_chars - 1)]
    if "\n" in cut:
        cut = cut.rsplit("\n", 1)[0]
    elif " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" .,;:\n") + "…"


def _titulo_producto(nombre: str, ficha: str) -> str:
    n = (nombre or "").strip()
    if not n:
        first = (ficha or "").split("\n", 1)[0].strip()
        n = first if first else "Producto"
    return n.title() if n.isupper() else n


def _extraer_relacion(ficha_blob: str) -> str:
    m = re.search(r"(\d+)\s*:\s*(\d+)", ficha_blob or "")
    if m:
        return f"{m.group(1)}:{m.group(2)}"
    return ""


def _extraer_nota_usp(secciones: dict[str, str], ficha: str) -> str:
    blob = " ".join(secciones.values()) + " " + (ficha or "")
    m = re.search(r"USP\s*(\d+)", blob, re.I)
    if m:
        return f"Cumple con los parámetros de la norma USP {m.group(1)} (United States Pharmacopeia), referencia de pureza y seguridad."
    return ""


def _es_citrato_magnesio(nombre: str, ficha: str) -> bool:
    blob = f"{nombre} {ficha}".lower()
    return "citrato" in blob and "magnesio" in blob


def _parrafo_general_citrato_magnesio(relacion: str) -> list[str]:
    rel_inline = (
        " en una relación molecular exacta de 3:2 (tres partes de magnesio por cada dos partes de citrato)"
        if relacion
        else " en una relación molecular exacta de 3:2 (tres partes de magnesio por cada dos partes de citrato)"
    )
    return [
        "Materia prima pura de grado alimentario e industrial, ideal para la formulación y desarrollo "
        f"de productos. Se presenta como una sal hidratada de alta calidad que combina magnesio y ácido "
        f"cítrico{rel_inline}. Esta proporción específica garantiza un aporte óptimo y eficiente del mineral.",
        "Debido a su alta solubilidad y a que es una de las formas de magnesio con mayor biodisponibilidad "
        "(fácil absorción por el cuerpo humano), es un insumo altamente cotizado en el sector manufacturero.",
    ]


def _parrafo_general_desde_ficha(desc: str, nombre: str) -> list[str]:
    out: list[str] = []
    visto_ratio = False
    for oracion in _partir_oraciones(desc):
        low = oracion.lower()
        if _oracion_descartar(oracion):
            continue
        limpia = _sanitizar_oracion(oracion)
        if not limpia:
            continue
        if re.search(r"\d+\s*:\s*\d+", limpia):
            if visto_ratio:
                continue
            visto_ratio = True
            limpia = re.sub(
                r".*?(\d+\s*:\s*\d+).*",
                r"Materia prima compuesta por magnesio y ácido cítrico en relación \1.",
                limpia,
                count=1,
                flags=re.I,
            )
        if "suplemento" in low and "industria" not in low:
            continue
        out.append(limpia)
        if len(out) >= 2:
            break
    if not out:
        id_n = (nombre or "producto").strip()
        out.append(
            f"Materia prima alimentaria pura ({id_n}) para formulación industrial y alimentaria. "
            "Polvo de alta calidad para procesos de manufactura."
        )
    return out


def _bloque_aplicaciones_citrato_magnesio() -> list[str]:
    lineas = [
        "El citrato de magnesio es un ingrediente versátil que se adapta a múltiples matrices "
        "alimentarias y procesos industriales:",
    ]
    for titulo, texto in _APLICACIONES_CITRATO_MAGNESIO:
        lineas.append(f"    {titulo}: {texto}")
    return lineas


def _bloque_aplicaciones_desde_ficha(aplic: str, nombre: str) -> list[str]:
    candidatas: list[str] = []
    for oracion in _partir_oraciones(aplic):
        limpia = _sanitizar_oracion(oracion)
        if limpia and not _oracion_descartar(limpia):
            candidatas.append(limpia)

    if len(candidatas) < 2:
        id_n = (nombre or "este insumo").strip()
        return [
            f"Aplicaciones industriales de {id_n}:",
            "    Industria alimentaria: formulación de alimentos, bebidas y productos funcionales.",
            "    Industria cosmética: insumo en cremas, lociones y productos de cuidado personal.",
            "    Uso técnico: procesos industriales que requieren materia prima de alta pureza.",
        ]

    lineas = [f"Aplicaciones y usos industriales de {(nombre or 'la materia prima').strip()}:"]
    for i, c in enumerate(candidatas[:6], 1):
        lineas.append(f"    {i}. {c}")
    return lineas


def _bloque_regulatorio(perfil: str, nota_usp: str) -> list[str]:
    lineas = [
        "    ⚠️ Nota Legal Importante: Este producto se comercializa como materia prima para "
        "formulación industrial y alimentaria. No es un suplemento dietario terminado ni un medicamento.",
    ]
    m = re.search(r"USP\s*(\d+)", nota_usp or "", re.I)
    if m:
        lineas.append(
            "    Estándar de Calidad: Cumple estrictamente con los parámetros de la norma USP "
            f"{m.group(1)} (United States Pharmacopeia), garantizando su pureza y seguridad."
        )
    if perfil == "materia_prima_alimentaria":
        lineas.append(
            "    Cumplimiento Normativo (Colombia): Producto apto para reenvase y distribución "
            "conforme a la Resolución 2674 de 2013, Artículo 37, Numeral 3."
        )
    elif perfil == "insumo_cosmetico":
        lineas.append(
            "    Uso exclusivo como insumo en formulación cosmética. No es producto cosmético terminado."
        )
    else:
        lineas.append(
            "    Materia prima técnica de uso industrial. No es producto terminado para consumo directo."
        )
    return lineas


def generar_descripcion_desde_ficha(
    ficha: str,
    *,
    nombre: str = "",
    perfil: str = "materia_prima_alimentaria",
) -> str:
    """
    Arma descripción estructurada MeLi-safe para etiqueta alternativa.

    Formato estándar:
      - Descripción General
      - Aplicaciones y Usos Industriales (por nicho)
      - Información Técnica y Regulatoria
    """
    secciones = _parse_secciones(ficha)
    titulo = _titulo_producto(nombre, ficha)
    relacion = _extraer_relacion(secciones.get("DESCRIPCIÓN", "") + secciones.get("DESCRIPCION", ""))
    nota_usp = _extraer_nota_usp(secciones, ficha)

    bloques: list[str] = []
    encabezado = f"Descripción del producto: {titulo}"
    if relacion:
        encabezado += f" (Relación {relacion})"
    bloques.append(encabezado)
    bloques.append("Descripción General")
    bloques.append("")

    desc_raw = secciones.get("DESCRIPCIÓN") or secciones.get("DESCRIPCION") or ""
    if _es_citrato_magnesio(nombre, ficha):
        parrafos = _parrafo_general_citrato_magnesio(relacion)
    else:
        parrafos = _parrafo_general_desde_ficha(desc_raw, titulo)

    bloques.extend(parrafos)
    bloques.append("")
    bloques.append("Aplicaciones y Usos Industriales")
    bloques.append("")

    aplic_raw = secciones.get("APLICACIONES") or ""
    if _es_citrato_magnesio(nombre, ficha):
        bloques.extend(_bloque_aplicaciones_citrato_magnesio())
    else:
        bloques.extend(_bloque_aplicaciones_desde_ficha(aplic_raw, titulo))

    bloques.append("")
    bloques.append("Información Técnica y Regulatoria")
    bloques.append("")
    bloques.extend(_bloque_regulatorio(perfil, nota_usp))

    return _compactar_texto("\n".join(bloques))


def generar_descripcion_etiqueta_desde_ficha(
    *,
    sku: str = "",
    nombre_producto: str = "",
    ingrediente: str = "",
    perfil: str = "materia_prima_alimentaria",
) -> dict[str, Any]:
    from app.services.google_services import buscar_ficha_tecnica_producto

    terminos: list[str] = []
    for t in (ingrediente, nombre_producto, sku):
        t = (t or "").strip()
        if t and t not in terminos:
            terminos.append(t)

    ficha = None
    termino_usado = ""
    for term in terminos:
        ficha = buscar_ficha_tecnica_producto(term)
        if ficha:
            termino_usado = term
            break

    if not ficha:
        return {
            "ok": False,
            "descripcion_etiqueta": "",
            "fuente": None,
            "termino": termino_usado or (terminos[0] if terminos else ""),
        }

    desc = generar_descripcion_desde_ficha(
        ficha,
        nombre=nombre_producto or ingrediente,
        perfil=perfil,
    )
    return {
        "ok": True,
        "descripcion_etiqueta": desc,
        "fuente": "ficha_tecnica",
        "termino": termino_usado,
        "caracteres": len(desc),
        "formato": "estructurado",
    }
