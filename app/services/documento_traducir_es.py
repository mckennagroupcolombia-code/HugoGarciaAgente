"""Traduce al español los campos extraídos de COA / FT / SDS en inglés.

Los pantallazos y PDF de proveedores suelen llegar en inglés. El OCR debe
transcribir fielmente, pero lo que se registra en el formulario y la biblioteca
queda en español. No traduce CAS, fórmulas, lotes, INCI ni nombres de empresa.
"""
from __future__ import annotations

import re
from typing import Any

# Claves que se dejan tal cual (códigos, identidades, nombres propios).
_CAMPOS_SIN_TRADUCIR = frozenset({
    "cas",
    "formula_quimica",
    "lote",
    "inci",
    "einecs",
    "einces",
    "firma_imagen_b64",
    "firma_bbox",
    "archivo_biblioteca",
    "codigo_verificacion",
    "firma_nombre",
    "firma_organizacion",
    "fabricante",
    "referencia",
})

_CAMPOS_FECHA = frozenset({
    "fecha_fabricacion",
    "fecha_vencimiento",
    "fecha_analisis",
    "fecha_emision",
    "fecha_revision",
})

# Frases largas primero. Clave en minúsculas.
_FRASES: tuple[tuple[str, str], ...] = (
    ("empty hard gelatin capsules", "Cápsulas vacías de gelatina dura"),
    ("hard gelatin capsules", "Cápsulas de gelatina dura"),
    ("empty gelatin capsules", "Cápsulas vacías de gelatina"),
    ("store in a cool, dry place", "Almacenar en un lugar fresco y seco"),
    ("store in a cool dry place", "Almacenar en un lugar fresco y seco"),
    ("keep in a cool, dry place", "Conservar en un lugar fresco y seco"),
    ("keep in a cool dry place", "Conservar en un lugar fresco y seco"),
    ("keep tightly closed", "Mantener bien cerrado"),
    ("keep container tightly closed", "Mantener el envase bien cerrado"),
    ("protect from light and moisture", "Proteger de la luz y la humedad"),
    ("protect from light", "Proteger de la luz"),
    ("protect from moisture", "Proteger de la humedad"),
    ("away from heat and sunlight", "Alejado del calor y la luz solar"),
    ("away from heat", "Alejado del calor"),
    ("room temperature", "temperatura ambiente"),
    ("tightly closed containers", "envases bien cerrados"),
    ("in tightly closed containers", "en envases bien cerrados"),
    ("white to off-white crystalline powder", "Polvo cristalino de blanco a blanco hueso"),
    ("white crystalline powder", "Polvo cristalino blanco"),
    ("off-white crystalline powder", "Polvo cristalino blanco hueso"),
    ("white to off-white powder", "Polvo de blanco a blanco hueso"),
    ("almost white powder", "Polvo casi blanco"),
    ("white powder", "Polvo blanco"),
    ("off-white powder", "Polvo blanco hueso"),
    ("colorless liquid", "Líquido incoloro"),
    ("colourless liquid", "Líquido incoloro"),
    ("clear liquid", "Líquido transparente"),
    ("yellowish liquid", "Líquido amarillento"),
    ("viscous liquid", "Líquido viscoso"),
    ("characteristic odor", "Olor característico"),
    ("characteristic odour", "Olor característico"),
    ("slight characteristic odor", "Olor característico ligero"),
    ("practically insoluble in water", "Prácticamente insoluble en agua"),
    ("freely soluble in water", "Fácilmente soluble en agua"),
    ("soluble in water", "Soluble en agua"),
    ("insoluble in water", "Insoluble en agua"),
    ("slightly soluble in water", "Ligeramente soluble en agua"),
    ("sparingly soluble in water", "Poco soluble en agua"),
    ("soluble in ethanol", "Soluble en etanol"),
    ("loss on drying", "Pérdida por secado"),
    ("loss on ignition", "Pérdida por calcinación"),
    ("residue on ignition", "Residuo de ignición"),
    ("sulphated ash", "Cenizas sulfatadas"),
    ("sulfated ash", "Cenizas sulfatadas"),
    ("heavy metals", "Metales pesados"),
    ("related substances", "Sustancias relacionadas"),
    ("residual solvents", "Disolventes residuales"),
    ("total plate count", "Recuento total en placa"),
    ("aerobic plate count", "Recuento de aerobios"),
    ("total aerobic microbial count", "Recuento microbiano aerobio total"),
    ("total yeast and mold count", "Recuento de hongos y levaduras"),
    ("yeast and mold", "Hongos y levaduras"),
    ("yeast and mould", "Hongos y levaduras"),
    ("specified microorganisms", "Microorganismos especificados"),
    ("microbial limits", "Límites microbianos"),
    ("particle size", "Tamaño de partícula"),
    ("bulk density", "Densidad aparente"),
    ("tapped density", "Densidad compactada"),
    ("specific gravity", "Densidad relativa"),
    ("melting point", "Punto de fusión"),
    ("boiling point", "Punto de ebullición"),
    ("flash point", "Punto de inflamación"),
    ("optical rotation", "Rotación óptica"),
    ("refractive index", "Índice de refracción"),
    ("molecular weight", "Peso molecular"),
    ("molecular formula", "Fórmula molecular"),
    ("country of origin", "País de origen"),
    ("shelf life", "Vida útil"),
    ("retest date", "Fecha de reensayo"),
    ("expiry date", "Fecha de vencimiento"),
    ("expiration date", "Fecha de vencimiento"),
    ("manufacturing date", "Fecha de fabricación"),
    ("date of manufacture", "Fecha de fabricación"),
    ("analysis date", "Fecha de análisis"),
    ("report date", "Fecha de informe"),
    ("issue date", "Fecha de emisión"),
    ("net weight", "Peso neto"),
    ("batch no.", "N.º de lote"),
    ("lot no.", "N.º de lote"),
    ("batch number", "Número de lote"),
    ("lot number", "Número de lote"),
    ("not more than", "No más de"),
    ("not less than", "No menos de"),
    ("not detected", "No detectado"),
    ("below detection", "Por debajo del límite de detección"),
    ("does not conform", "No cumple"),
    ("non conforming", "No cumple"),
    ("quality manager", "Jefe de calidad"),
    ("qa manager", "Jefe de calidad"),
    ("qc manager", "Jefe de control de calidad"),
    ("quality control", "Control de calidad"),
    ("cosmetic grade", "Grado cosmético"),
    ("food grade", "Grado alimentario"),
    ("pharmaceutical grade", "Grado farmacéutico"),
    ("technical grade", "Grado técnico"),
    ("industrial grade", "Grado industrial"),
    ("for industrial use", "Uso industrial"),
    ("for cosmetic use", "Uso cosmético"),
    ("united states", "Estados Unidos"),
    ("united kingdom", "Reino Unido"),
    ("desiccated coconut full fat long thread", "Coco deshidratado grasa completa hilo largo"),
    ("desiccated coconut", "Coco deshidratado"),
    ("full fat", "grasa completa"),
    ("long thread", "hilo largo"),
    ("white snow color", "color blanco nieve"),
    ("white snow colour", "color blanco nieve"),
    ("snow white color", "color blanco nieve"),
    ("snow white colour", "color blanco nieve"),
    ("snow white", "blanco nieve"),
    ("free fatty acids", "ácidos grasos libres"),
    ("crude fiber", "fibra cruda"),
    ("crude fibre", "fibra cruda"),
    ("total fat", "grasa total"),
    ("sulfur dioxide", "dióxido de azufre"),
    ("sulphur dioxide", "dióxido de azufre"),
)

_PALABRAS: tuple[tuple[str, str], ...] = (
    ("appearance", "Aspecto"),
    ("identification", "Identificación"),
    ("assay", "Valoración"),
    ("purity", "Pureza"),
    ("moisture", "Humedad"),
    ("arsenic", "Arsénico"),
    ("cadmium", "Cadmio"),
    ("mercury", "Mercurio"),
    ("chloride", "Cloruros"),
    ("chlorides", "Cloruros"),
    ("sulfate", "Sulfatos"),
    ("sulphate", "Sulfatos"),
    ("sulfates", "Sulfatos"),
    ("iron", "Hierro"),
    ("lead", "Plomo"),
    ("impurities", "Impurezas"),
    ("viscosity", "Viscosidad"),
    ("hardness", "Dureza"),
    ("disintegration", "Desintegración"),
    ("dissolution", "Disolución"),
    ("friability", "Friabilidad"),
    ("thickness", "Espesor"),
    ("diameter", "Diámetro"),
    ("length", "Longitud"),
    ("weight", "Peso"),
    ("color", "Color"),
    ("colour", "Color"),
    ("odor", "Olor"),
    ("odour", "Olor"),
    ("taste", "Sabor"),
    ("solubility", "Solubilidad"),
    ("description", "Descripción"),
    ("applications", "Aplicaciones"),
    ("storage", "Almacenamiento"),
    ("handling", "Manipulación"),
    ("precautions", "Precauciones"),
    ("remarks", "Observaciones"),
    ("notes", "Notas"),
    ("specification", "Especificación"),
    ("specifications", "Especificaciones"),
    ("result", "Resultado"),
    ("results", "Resultados"),
    ("parameter", "Parámetro"),
    ("parameters", "Parámetros"),
    ("item", "Ítem"),
    ("items", "Ítems"),
    ("test", "Ensayo"),
    ("manufacturer", "Fabricante"),
    ("supplier", "Proveedor"),
    ("packing", "Empaque"),
    ("packaging", "Empaque"),
    ("quantity", "Cantidad"),
    ("conforms", "Cumple"),
    ("conformed", "Cumple"),
    ("conform", "Cumple"),
    ("complies", "Cumple"),
    ("compliant", "Cumple"),
    ("passes", "Cumple"),
    ("passed", "Cumple"),
    ("pass", "Cumple"),
    ("failed", "No cumple"),
    ("fail", "No cumple"),
    ("negative", "Negativo"),
    ("positive", "Positivo"),
    ("absent", "Ausente"),
    ("absence", "Ausencia"),
    ("present", "Presente"),
    ("typical", "Típico"),
    ("characteristic", "característico"),
    ("crystalline", "cristalino"),
    ("powder", "polvo"),
    ("liquid", "líquido"),
    ("solid", "sólido"),
    ("flakes", "escamas"),
    ("granules", "gránulos"),
    ("pellets", "pellets"),
    ("capsules", "cápsulas"),
    ("capsule", "cápsula"),
    ("odorless", "inodoro"),
    ("odourless", "inodoro"),
    ("colorless", "incoloro"),
    ("colourless", "incoloro"),
    ("yellowish", "amarillento"),
    ("white", "blanco"),
    ("anhydrous", "anhidro"),
    ("monohydrate", "monohidrato"),
    ("dihydrate", "dihidrato"),
    ("slightly", "ligeramente"),
    ("practically", "prácticamente"),
    ("freely", "fácilmente"),
    ("sparingly", "poco"),
    ("insoluble", "insoluble"),
    ("soluble", "soluble"),
    ("cool", "fresco"),
    ("dry", "seco"),
    ("tightly", "herméticamente"),
    ("closed", "cerrado"),
    ("empty", "vacías"),
    ("hard", "duras"),
    ("gelatin", "gelatina"),
    ("glycerin", "glicerina"),
    ("glycerol", "glicerol"),
    ("coconut", "coco"),
    ("desiccated", "deshidratado"),
    ("thread", "hilo"),
    ("snow", "nieve"),
    ("texture", "textura"),
    ("flavor", "sabor"),
    ("flavour", "sabor"),
    ("aroma", "aroma"),
    ("fiber", "fibra"),
    ("fibre", "fibra"),
    ("crude", "cruda"),
    ("refined", "refinado"),
    ("organic", "orgánico"),
    ("extract", "extracto"),
    ("china", "China"),
    ("india", "India"),
    ("germany", "Alemania"),
    ("france", "Francia"),
    ("brazil", "Brasil"),
    ("italy", "Italia"),
    ("spain", "España"),
    ("japan", "Japón"),
    ("korea", "Corea"),
    ("mexico", "México"),
    ("colombia", "Colombia"),
)

_ABREVIATURAS: tuple[tuple[str, str], ...] = (
    (r"\bN\.?\s*M\.?\s*T\.?(?=\s|$|[^A-Za-z])", "No más de"),
    (r"\bNMT\b", "No más de"),
    (r"\bN\.?\s*L\.?\s*T\.?(?=\s|$|[^A-Za-z])", "No menos de"),
    (r"\bNLT\b", "No menos de"),
    (r"\bN\.?\s*D\.?(?=\s|$|[^A-Za-z])", "No detectado"),
    (r"\bBDL\b", "Por debajo del límite de detección"),
    (r"\bLOD\b", "Límite de detección"),
    (r"\bLOQ\b", "Límite de cuantificación"),
    (r"\bTAMC\b", "Recuento microbiano aerobio total"),
    (r"\bTYMC\b", "Recuento de hongos y levaduras"),
    (r"\bCFU\b", "UFC"),
    (r"\bcfu\b", "UFC"),
    (r"\bUSP\b", "USP"),
    (r"(\d+(?:[.,]\d+)?)\s+to\s+(\d+(?:[.,]\d+)?)", r"\1 a \2"),
    (r"(\d+(?:[.,]\d+)?)\s*max\.?\b", r"\1 máx."),
    (r"\bmax\.?\s*(\d+(?:[.,]\d+)?)", r"máx. \1"),
    (r"\bmaximum\b", "máximo"),
    (r"\bminimum\b", "mínimo"),
)

_ACIDOS = {
    "citric": "cítrico",
    "ascorbic": "ascórbico",
    "hyaluronic": "hialurónico",
    "stearic": "esteárico",
    "salicylic": "salicílico",
    "lactic": "láctico",
    "glycolic": "glicólico",
    "boric": "bórico",
    "acetic": "acético",
    "benzoic": "benzoico",
    "sorbic": "sórbico",
    "folic": "fólico",
    "oleic": "oleico",
    "palmitic": "palmítico",
    "linoleic": "linoleico",
    "tartaric": "tartárico",
    "malic": "málico",
    "azelaic": "azelaico",
    "kojic": "kójico",
    "ferulic": "ferúlico",
    "retinoic": "retinoico",
    "nicotinic": "nicotínico",
    "gallic": "gálico",
    "caffeic": "cafeico",
    "phosphoric": "fosfórico",
    "hyaluronate": None,
}

_SUSTANCIAS = {
    "coconut": "coco",
    "lemon": "limón",
    "orange": "naranja",
    "almond": "almendra",
    "olive": "oliva",
    "shea": "karité",
    "cocoa": "cacao",
    "honey": "miel",
    "rice": "arroz",
    "wheat": "trigo",
    "corn": "maíz",
    "soy": "soya",
    "oat": "avena",
}

_MESES = {
    "jan": "ene",
    "january": "enero",
    "feb": "feb",
    "february": "febrero",
    "mar": "mar",
    "march": "marzo",
    "apr": "abr",
    "april": "abril",
    "may": "may",
    "jun": "jun",
    "june": "junio",
    "jul": "jul",
    "july": "julio",
    "aug": "ago",
    "august": "agosto",
    "sep": "sep",
    "sept": "sep",
    "september": "septiembre",
    "oct": "oct",
    "october": "octubre",
    "nov": "nov",
    "november": "noviembre",
    "dec": "dic",
    "december": "diciembre",
}

_FRASES_ORD = tuple(sorted(_FRASES, key=lambda x: len(x[0]), reverse=True))
_PALABRAS_ORD = tuple(sorted(_PALABRAS, key=lambda x: len(x[0]), reverse=True))

_INSTRUCCION_PROMPT = (
    "OBLIGATORIO: todo valor de texto que se registre en el formulario debe quedar en "
    "español de Colombia (descripcion, apariencia, olor, almacenamiento, modo de uso, "
    "aplicaciones, propiedades, parametros, grado, presentacion, pais_origen, cargo). "
    "Si el documento fuente está en inglés, bilingüe u otro idioma, TRADUCE. "
    "No traduzcas CAS, fórmulas químicas, códigos de lote, INCI ni nombres de empresa. "
    "Mantén números y unidades. "
    "Appearance→Aspecto, Assay→Valoración, Loss on Drying→Pérdida por secado, "
    "Heavy Metals→Metales pesados, Identification→Identificación, "
    "Conforms/Passes/Passed/Complies→Cumple, Not detected→No detectado, "
    "N.M.T./NMT→No más de, N.L.T./NLT→No menos de, "
    "White crystalline powder→Polvo cristalino blanco, "
    "Store in a cool dry place→Almacenar en un lugar fresco y seco."
)


def instruccion_traducir_es() -> str:
    """Bloque para prompts de extracción (imagen, PDF o URL)."""
    return _INSTRUCCION_PROMPT


def _reemplazar_acidos(texto: str) -> str:
    def _sub(m: re.Match[str]) -> str:
        es = _ACIDOS.get(m.group(1).lower())
        if not es:
            return m.group(0)
        extra = ""
        suf = (m.group(2) or "").lower()
        if "anhydrous" in suf:
            extra = " anhidro"
        elif "monohydrate" in suf:
            extra = " monohidrato"
        elif "dihydrate" in suf:
            extra = " dihidrato"
        return f"Ácido {es}{extra}"

    return re.sub(
        r"\b([A-Za-z]+)\s+Acid(\s+(?:Anhydrous|Monohydrate|Dihydrate))?\b",
        _sub,
        texto,
        flags=re.I,
    )


def traducir_fecha_meses(texto: str) -> str:
    """DEC.2025 / December 2025 → dic.2025 / diciembre 2025 (ISO se deja)."""
    s = (texto or "").strip()
    if not s:
        return s
    if re.match(r"^\d{4}-\d{2}(?:-\d{2})?$", s):
        return s

    def _mes(m: re.Match[str]) -> str:
        clave = m.group(1).replace(".", "").lower()
        es = _MESES.get(clave)
        if not es:
            return m.group(0)
        sep = m.group(2) or "."
        anio = m.group(3)
        return f"{es}{sep}{anio}"

    return re.sub(
        r"\b([A-Za-zÁÉÍÓÚáéíóú.]{3,})\s*([.\s/-]+)\s*(\d{4})\b",
        _mes,
        s,
    )


def _reemplazar_caracteristico(texto: str) -> str:
    def _sust(nombre: str) -> str:
        return _SUSTANCIAS.get(nombre.lower(), nombre.lower())

    s = re.sub(
        r"\bcharacteristic of\s+([A-Za-z]+)\s+(?:taste|flavor|flavour)\b",
        lambda m: f"sabor característico a {_sust(m.group(1))}",
        texto,
        flags=re.I,
    )
    s = re.sub(
        r"\bcharacteristic of\s+([A-Za-z]+)\s+aroma\b",
        lambda m: f"aroma característico a {_sust(m.group(1))}",
        s,
        flags=re.I,
    )
    s = re.sub(
        r"\bcharacteristic of\s+([A-Za-z]+)\s+(?:odor|odour|smell)\b",
        lambda m: f"olor característico a {_sust(m.group(1))}",
        s,
        flags=re.I,
    )
    return re.sub(
        r"\bcharacteristic of\s+([A-Za-z]+)\b",
        lambda m: f"característico a {_sust(m.group(1))}",
        s,
        flags=re.I,
    )


def traducir_texto_tecnico(texto: str) -> str:
    """Traduce etiquetas y frases técnicas EN→ES; deja números, unidades y códigos."""
    s = (texto or "").strip()
    if not s:
        return s
    s = _reemplazar_acidos(s)
    s = _reemplazar_caracteristico(s)
    for en, es in _FRASES_ORD:
        s = re.sub(re.escape(en), es, s, flags=re.I)
    for pat, es in _ABREVIATURAS:
        s = re.sub(pat, es, s, flags=re.I)
    for en, es in _PALABRAS_ORD:
        s = re.sub(rf"\b{re.escape(en)}\b", es, s, flags=re.I)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def traducir_parametros(texto: str) -> str:
    """Traduce filas Parametro|Especificacion|Resultado."""
    if not (texto or "").strip():
        return texto or ""
    out: list[str] = []
    for raw in texto.splitlines():
        ln = raw.strip()
        if not ln:
            continue
        partes = [p.strip() for p in ln.split("|")]
        out.append("|".join(traducir_texto_tecnico(p) for p in partes))
    return "\n".join(out)


def espanolizar_campos_documento(campos: dict[str, Any] | None) -> dict[str, Any]:
    """Devuelve copia con textos de formulario en español. Idempotente."""
    if not isinstance(campos, dict):
        return {}
    out: dict[str, Any] = dict(campos)
    for clave, valor in list(out.items()):
        if clave.startswith("_") or clave in _CAMPOS_SIN_TRADUCIR:
            continue
        if not isinstance(valor, str) or not valor.strip():
            continue
        if clave in _CAMPOS_FECHA:
            out[clave] = traducir_fecha_meses(valor)
            continue
        if clave == "parametros":
            out[clave] = traducir_parametros(valor)
            continue
        out[clave] = traducir_texto_tecnico(valor)
    return out
