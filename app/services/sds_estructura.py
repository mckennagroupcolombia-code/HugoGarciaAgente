"""Hoja de seguridad (SDS) sin información repetida — esquema 2 (21-sep-2026).

Hasta aquí la SDS guardaba los peligros como tres textos libres que se repetían
entre sí (y a veces se contradecían: el aceite de canela listaba H335 en las
recomendaciones y no en la lista de frases):

- `peligros.clasificacion`   clases y categorías… y la palabra de advertencia
- `peligros.pictogramas`     «GHS07 - …» + frases H + frases P, todo junto
- `recomendaciones`          SEÑAL / INDICACIONES H / PREVENCIÓN / RESPUESTA /
                             ALMACENAMIENTO / ELIMINACIÓN / PRIMEROS AUXILIOS / EPP

El esquema 2 guarda cada dato una vez:

    peligros:
      clasificacion: "Líquido inflamable, cat. 3 (H226); …"   (solo clases/categorías)
      senal: "Peligro" | "Atención" | ""
      pictogramas_ghs: ["GHS02", "GHS07"]
      frases_h: ["H226: Líquidos y vapores inflamables.", …]
      frases_p: ["P210: Mantener alejado del calor…", "Respuesta: texto sin código", …]
    esquema: 2

Lo que las recomendaciones decían de almacenamiento, eliminación o EPP pasa a
su sección (7, 13, 8) solo si esa sección estaba vacía; si no, se descarta
porque ya estaba dicho allí. El texto corrido sin categoría (heredado de la FT:
conservación, vida útil) se descarta con aviso. Primeros auxilios no tiene sección propia
(decisión del usuario, commit 1a48387): pasa a las frases P de respuesta y la
sección 4 remite a ellas.

`normalizar_sds()` es pura y no escribe nada: la usan el PDF, la web y el
formulario, así un documento viejo se ve igual de ordenado sin migrarlo.
`scripts/sds_migrar_esquema2.py` la aplica a los YAML cuando se decida.

`preparar_sds_documento()` resuelve las referencias cruzadas del documento
combinado (FT + COA + SDS): lo que ya está en la FT o en el COA no se repite.
"""
from __future__ import annotations

import copy
import re
import unicodedata
from typing import Any

ESQUEMA_ACTUAL = 2

# Nombres oficiales en español (SGA, Rev. 6 — Decreto 1496 de 2018).
PICTOGRAMAS_GHS: dict[str, str] = {
    "GHS01": "Bomba explotando",
    "GHS02": "Llama",
    "GHS03": "Llama sobre círculo",
    "GHS04": "Bombona de gas",
    "GHS05": "Corrosión",
    "GHS06": "Calavera y tibias cruzadas",
    "GHS07": "Signo de exclamación",
    "GHS08": "Peligro para la salud",
    "GHS09": "Medio ambiente",
}

SENALES = ("Peligro", "Atención")

# Consejos de prudencia por el primer dígito del código (SGA, anexo 3).
GRUPOS_P: dict[str, str] = {
    "1": "Generales",
    "2": "Prevención",
    "3": "Respuesta",
    "4": "Almacenamiento",
    "5": "Eliminación",
}
_GRUPO_POR_NOMBRE = {
    "general": "1", "generales": "1",
    "prevencion": "2",
    "respuesta": "3", "primeros auxilios": "3",
    "almacenamiento": "4",
    "eliminacion": "5",
}

_RE_PICTO = re.compile(r"\bGHS\s*0?([1-9])\b", re.I)
_RE_CODIGO = re.compile(
    r"\b((?:EUH|H)\d{3}[A-Za-z]{0,2}(?:\s*\+\s*H\d{3}[A-Za-z]{0,2})*"
    r"|P\d{3}(?:\s*\+\s*P\d{3})*)\b\s*[:.\-–—]?\s*"
)
_RE_SENAL = re.compile(
    r"(?:palabra\s+de\s+advertencia|se[ñn]al\s+de\s+peligro|palabra\s+de\s+se[ñn]al)"
    r"\s*[:\-–]?\s*(peligro|atenci[oó]n|advertencia|ninguna|no\s+aplica|sin\b[^.\n]*)",
    re.I,
)


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn"
    ).lower().strip()


def _texto(valor: Any) -> str:
    if valor is None:
        return ""
    if isinstance(valor, list):
        return "\n".join(_texto(v) for v in valor if _texto(v))
    return str(valor).strip()


def _lista(valor: Any) -> list[str]:
    """Lista de líneas desde lista o texto multilínea."""
    if isinstance(valor, list):
        return [str(v).strip() for v in valor if str(v or "").strip()]
    return [l.strip() for l in _texto(valor).split("\n") if l.strip()]


def _codigo_canonico(codigo: str) -> str:
    return re.sub(r"\s*\+\s*", "+", codigo.strip().upper())


def pictogramas_en_texto(texto: str) -> list[str]:
    """GHS0N mencionados, en orden y sin repetir. «No aplica pictograma» → []."""
    vistos: list[str] = []
    for m in _RE_PICTO.finditer(texto or ""):
        cod = f"GHS0{m.group(1)}"
        if cod not in vistos:
            vistos.append(cod)
    return vistos


def frases_en_texto(texto: str) -> list[tuple[str, str]]:
    """Frases H/P con su texto: [("H315", "Provoca irritación cutánea."), …].

    Acepta la lista una por línea o todo en un solo renglón («… H304: … P102: …»):
    el texto de cada frase va hasta el siguiente código."""
    texto = texto or ""
    matches = list(_RE_CODIGO.finditer(texto))
    frases: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        fin = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        cuerpo = texto[m.end():fin]
        # Un «GHS07 - …» o una categoría en mayúsculas que venga después no es parte de la frase.
        cuerpo = re.split(r"\bGHS\s*0?[1-9]\b|\n\s*[A-ZÁÉÍÓÚÑ ]{4,}:", cuerpo)[0]
        cuerpo = " ".join(cuerpo.split()).strip(" ;,-–")
        frases.append((_codigo_canonico(m.group(1)), cuerpo))
    return frases


def _formatear_frase(codigo: str, texto: str) -> str:
    texto = texto.strip()
    if texto and texto[-1] not in ".!?":
        texto += "."
    return f"{codigo}: {texto}" if texto else codigo


def _senal_en_texto(texto: str) -> str | None:
    """'Peligro' / 'Atención' / '' (explícitamente sin palabra) / None (no lo dice)."""
    m = _RE_SENAL.search(texto or "")
    if not m:
        return None
    v = _sin_tildes(m.group(1))
    if v.startswith("peligro"):
        return "Peligro"
    if v.startswith(("atencion", "advertencia")):
        return "Atención"
    return ""


def _limpiar_clasificacion(texto: str) -> str:
    """Quita de la clasificación la palabra de advertencia (ahora tiene su campo)."""
    texto = _RE_SENAL.sub("", texto or "")
    # El rótulo de la fila ya dice «Clasificación»: no repetirlo en el texto.
    texto = re.sub(r"^\s*clasificaci[oó]n\s*(?:\([^)]*\)\s*)?(?:seg[uú]n\s+(?:el\s+|la\s+)?[\w/ ().-]{0,40}?)?\s*:\s*", "", texto, flags=re.I)
    lineas = [l.strip(" .;") for l in texto.split("\n")]
    limpio = "\n".join(l for l in lineas if l)
    limpio = re.sub(r"\s{2,}", " ", limpio).strip()
    if limpio and limpio[-1] not in ".!?)":
        limpio += "."
    return limpio


def _categorias_recomendaciones(raw: Any) -> list[tuple[str, str]]:
    """«SEÑAL DE PELIGRO: Atención» → [("senal de peligro", "Atención")]; sin categoría → ("", línea)."""
    salida: list[tuple[str, str]] = []
    for linea in _lista(raw):
        m = re.match(r"^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ /]{3,40}?)\s*:\s*(.+)$", linea)
        if m and m.group(1).strip().upper() == m.group(1).strip():
            salida.append((_sin_tildes(m.group(1)), m.group(2).strip()))
        else:
            salida.append(("", linea.strip()))
    return salida


def normalizar_sds(datos_sds: dict | None) -> tuple[dict, list[str]]:
    """Convierte una SDS de cualquier época al esquema 2. No escribe nada.

    Devuelve (sds_nueva, avisos). Los avisos cuentan lo que no cuadraba —
    contradicciones entre las fuentes viejas, texto que se descartó por estar
    ya en su sección — para revisarlo antes de migrar el YAML."""
    sds = copy.deepcopy(datos_sds or {})
    avisos: list[str] = []
    if not isinstance(sds, dict):
        return {}, avisos
    pel = sds.get("peligros") if isinstance(sds.get("peligros"), dict) else {}
    if sds.get("esquema") == ESQUEMA_ACTUAL:
        pel.setdefault("pictogramas_ghs", [])
        pel["frases_h"] = _lista(pel.get("frases_h"))
        pel["frases_p"] = _lista(pel.get("frases_p"))
        sds["peligros"] = pel
        return sds, avisos

    clasif_raw = _texto(pel.get("clasificacion"))
    picto_raw = _texto(pel.get("pictogramas"))
    rec_raw = sds.get("recomendaciones")
    if rec_raw is None:
        rec_raw = pel.get("recomendaciones")
    if rec_raw is None and isinstance(sds.get("manipulacion"), dict):
        rec_raw = sds["manipulacion"].get("recomendaciones")
    categorias = _categorias_recomendaciones(rec_raw)

    # ── Pictogramas: la lista explícita manda ─────────────────────────────────
    pictos = pictogramas_en_texto(picto_raw) or pictogramas_en_texto(clasif_raw)

    # ── Frases H y P: la lista explícita («pictogramas») manda ────────────────
    frases = frases_en_texto(picto_raw)
    h = [(c, t) for c, t in frases if not c.startswith("P")]
    p = [(c, t) for c, t in frases if c.startswith("P")]

    # ── Palabra de advertencia ────────────────────────────────────────────────
    senal = _senal_en_texto(clasif_raw)
    if senal is None:
        senal = _senal_en_texto(picto_raw)

    p_sin_codigo: list[str] = []
    for cat, texto in categorias:
        if cat in ("senal de peligro", "palabra de advertencia"):
            s = _senal_en_texto(f"señal de peligro: {texto}")
            if senal is None:
                senal = s
            elif s is not None and s != senal:
                avisos.append(f"Palabra de advertencia distinta: «{senal}» en peligros, «{s}» en recomendaciones (se deja «{senal}»).")
        elif cat in ("indicaciones h", "frases h", "indicaciones de peligro"):
            h_rec = [(c, t) for c, t in frases_en_texto(texto) if not c.startswith("P")]
            if not h:
                h = h_rec
            else:
                sobran = sorted({c for c, _ in h_rec} - {c for c, _ in h})
                if sobran:
                    avisos.append(f"Las recomendaciones mencionan {', '.join(sobran)}, que no está en la lista de frases H: revisar si aplica.")
        elif cat in ("prevencion", "respuesta", "primeros auxilios", "almacenamiento", "eliminacion"):
            codigos = [(c, t) for c, t in frases_en_texto(texto) if c.startswith("P")]
            if codigos:
                ya = {c for c, _ in p}
                p.extend((c, t) for c, t in codigos if c not in ya)
                continue
            if cat == "almacenamiento":
                man = sds.get("manipulacion")
                if not isinstance(man, dict):
                    man = sds["manipulacion"] = {}
                if not _texto(man.get("almacenamiento")):
                    man["almacenamiento"] = texto
                else:
                    avisos.append("Se descartó el almacenamiento de las recomendaciones: la sección 7 ya lo dice.")
            elif cat == "eliminacion":
                if not _texto(sds.get("eliminacion")):
                    sds["eliminacion"] = texto
                else:
                    avisos.append("Se descartó la eliminación de las recomendaciones: la sección 13 ya la dice.")
            else:
                etiqueta = "Respuesta" if cat in ("respuesta", "primeros auxilios") else "Prevención"
                if not [x for x in p if x[0][1:2] == _GRUPO_POR_NOMBRE.get(cat, "")]:
                    p_sin_codigo.append(f"{etiqueta}: {texto}")
                else:
                    avisos.append(f"Se descartó «{cat}» sin códigos de las recomendaciones: ya hay frases P de ese grupo.")
        elif cat in ("epp requerido", "epp", "proteccion personal"):
            if not _texto(sds.get("exposicion")):
                sds["exposicion"] = texto
            else:
                avisos.append("Se descartó el EPP de las recomendaciones: la sección 8 ya lo dice.")
        elif texto:
            # Texto corrido heredado de la FT (conservación, vida útil, advertencias
            # de consumo): no es de seguridad y ya lo dice la FT o la sección 7.
            etiqueta = f"{cat.upper()}: " if cat else ""
            avisos.append(f"Se descartó texto de recomendaciones sin sección de la SDS: «{etiqueta}{texto[:70]}»")

    if not h and not pictos and re.search(r"\bH\d{3}\b", clasif_raw):
        avisos.append("La clasificación cita frases H pero no hay lista con su texto: completar las frases H.")

    pel_nuevo = {k: v for k, v in pel.items() if k not in ("pictogramas", "recomendaciones")}
    pel_nuevo.update({
        "clasificacion": _limpiar_clasificacion(clasif_raw),
        "senal": senal or "",
        "pictogramas_ghs": pictos,
        "frases_h": [_formatear_frase(c, t) for c, t in h],
        "frases_p": [_formatear_frase(c, t) for c, t in p] + p_sin_codigo,
    })
    if p and not pictos and not h:
        avisos.append("Tiene frases P pero ningún peligro clasificado: revisar si sobran.")
    if pictos and not senal:
        avisos.append("Hay pictogramas pero no palabra de advertencia: elegir Peligro o Atención.")
    sds["peligros"] = pel_nuevo
    sds.pop("recomendaciones", None)
    if isinstance(sds.get("manipulacion"), dict):
        sds["manipulacion"].pop("recomendaciones", None)
    sds["esquema"] = ESQUEMA_ACTUAL
    return sds, avisos


# ── Presentación ──────────────────────────────────────────────────────────────

def _separar_frase(linea: str) -> tuple[str, str, str]:
    """(código, grupo P o «H», texto). Una frase P sin código trae su grupo por nombre."""
    m = _RE_CODIGO.match(linea.strip())
    if m:
        cod = _codigo_canonico(m.group(1))
        texto = linea.strip()[m.end():].strip()
        grupo = GRUPOS_P.get(cod[1], "Generales") if cod.startswith("P") else "H"
        return cod, grupo, texto
    m = re.match(r"^\s*([A-Za-zÁÉÍÓÚáéíóú ]+?)\s*:\s*(.+)$", linea)
    if m and _sin_tildes(m.group(1)) in _GRUPO_POR_NOMBRE:
        return "", GRUPOS_P[_GRUPO_POR_NOMBRE[_sin_tildes(m.group(1))]], m.group(2).strip()
    return "", "Generales", linea.strip()


def peligros_para_documento(sds_norm: dict) -> dict[str, Any]:
    """Lo que la plantilla necesita para la sección 2 y la 4."""
    pel = sds_norm.get("peligros") or {}
    pictos = [c for c in (pel.get("pictogramas_ghs") or []) if c in PICTOGRAMAS_GHS]
    h = [(_separar_frase(l)[0], _separar_frase(l)[2]) for l in _lista(pel.get("frases_h"))]
    grupos: dict[str, list[tuple[str, str]]] = {}
    for linea in _lista(pel.get("frases_p")):
        cod, grupo, texto = _separar_frase(linea)
        grupos.setdefault(grupo, []).append((cod, texto))
    orden = [g for g in GRUPOS_P.values() if g in grupos]
    return {
        "clasificacion": _texto(pel.get("clasificacion")),
        "senal": _texto(pel.get("senal")),
        "pictogramas": [{"codigo": c, "nombre": PICTOGRAMAS_GHS[c], "archivo": f"ghs/{c}.svg"} for c in pictos],
        "frases_h": h,
        "frases_p": [(g, grupos[g]) for g in orden],
        "tiene_respuesta": "Respuesta" in grupos,
        # Solo se afirma «no requiere etiquetado» si alguien clasificó el producto.
        "sin_peligro": bool(_texto(pel.get("clasificacion"))) and not pictos and not h and not _texto(pel.get("senal")),
    }


# Grupos de propiedades que la FT ya cubre en «Especificaciones fisicoquímicas».
_PROPIEDADES_FT = {
    "apariencia": ("apariencia", "aspecto", "estado fisico", "color", "forma"),
    "olor": ("olor", "aroma"),
    "solubilidad": ("solubilidad",),
}


def _grupo_propiedad(nombre: str) -> str | None:
    n = _sin_tildes(nombre).rstrip(":")
    for grupo, claves in _PROPIEDADES_FT.items():
        if any(n.startswith(c) for c in claves):
            return grupo
    return None


def preparar_sds_documento(ft_ctx: dict, coa_ctx: dict | None, sds_ctx: dict | None) -> None:
    """Agrega a `sds_ctx` lo que la plantilla usa para remitir en vez de repetir.

    No quita nada: la SDS impresa sola (`seccion_sola='sds'`) sigue mostrando
    todo. La plantilla elige con `remitir` (documento combinado)."""
    if not sds_ctx:
        return
    ft_props = {_grupo_propiedad(k) for k, _ in (ft_ctx.get("propiedades") or [])} - {None}
    propias, en_ft = [], []
    for nombre, valor in sds_ctx.get("propiedades") or []:
        grupo = _grupo_propiedad(nombre)
        if grupo and grupo in ft_props:
            if grupo not in en_ft:
                en_ft.append(grupo)
        else:
            propias.append((nombre, valor))
    nombres = {"apariencia": "apariencia", "olor": "olor", "solubilidad": "solubilidad"}
    partes = [nombres[g] for g in en_ft]
    texto = ", ".join(partes[:-1]) + (" y " if len(partes) > 1 else "") + partes[-1] if partes else ""
    sds_ctx["propiedades_propias"] = propias
    sds_ctx["propiedades_en_ft"] = en_ft
    sds_ctx["propiedades_en_ft_texto"] = texto[:1].upper() + texto[1:]
    sds_ctx["ft_tiene_conservacion"] = bool(_texto(ft_ctx.get("conservacion")))
    sds_ctx["coa_tiene_composicion"] = bool(coa_ctx and coa_ctx.get("composicion"))


# ── Guardar sin perder secciones ──────────────────────────────────────────────

def fusionar_sds(anterior: dict | None, nueva: dict | None) -> dict | None:
    """SDS a guardar = la anterior + lo que manda el formulario.

    El formulario solo conocía 4 casillas y reemplazaba la SDS entera: abrir y
    generar uno de los 52 documentos de lote borraba incendios, vertidos,
    toxicología… Ahora una clave que el formulario no manda se conserva; una que
    manda en `None` se elimina (así se retiran los campos del esquema viejo)."""
    if not isinstance(nueva, dict):
        return nueva
    base = copy.deepcopy(anterior) if isinstance(anterior, dict) else {}
    for clave, valor in nueva.items():
        if valor is None:
            base.pop(clave, None)
        elif isinstance(valor, dict) and isinstance(base.get(clave), dict):
            sub = base[clave]
            for k2, v2 in valor.items():
                if v2 is None:
                    sub.pop(k2, None)
                else:
                    sub[k2] = v2
        else:
            base[clave] = valor
    return base


# ── Sugerencia con IA ─────────────────────────────────────────────────────────

_PROMPT_SUGERIR = """Eres el área de calidad y seguridad de McKenna Group S.A.S. (Bogotá, Colombia), que
vende MATERIAS PRIMAS cosméticas, farmacéuticas y alimentarias reenvasadas (no suplementos ni
productos terminados). Redacta la HOJA DE DATOS DE SEGURIDAD de: {titulo}
{identificacion}
La Ficha Técnica del mismo documento YA dice lo siguiente. NO lo repitas en la SDS:
- Conservación y almacenamiento: {conservacion}
- Especificaciones fisicoquímicas: {propiedades}

Reglas:
- SGA/GHS Rev. 6 (Decreto 1496 de 2018), español de Colombia, tono técnico y breve.
- Si la sustancia no está clasificada como peligrosa: senal "", pictogramas_ghs [], frases_h [] y
  frases_p [] (sin consejos de prudencia de relleno). NO asignes frases P que no correspondan a
  un peligro clasificado.
- Palabra de advertencia: "Peligro" o "Atención" (nunca "Advertencia").
- frases_h y frases_p: código y texto oficial en español, una por elemento: "H315: Provoca irritación cutánea."
- Primeros auxilios NO tiene sección propia: van como consejos P de respuesta (P3xx).
- manipulacion.almacenamiento: SOLO lo de seguridad que la FT no dice (incompatibilidades, materiales
  a evitar, temperatura crítica). Si no hay nada que agregar, "".
- propiedades: SOLO las relevantes para seguridad (punto de inflamación, densidad, pH, punto de
  fusión, presión de vapor…). Nada de apariencia, color, olor ni solubilidad (ya están en la FT).
- No inventes cifras sin respaldo: si no se conoce un valor, omite esa propiedad.
- Cada texto en 1 a 3 oraciones. Sin markdown.

Responde ÚNICAMENTE JSON válido:
{{
  "identificacion": {{"usos": ""}},
  "peligros": {{"clasificacion": "", "senal": "", "pictogramas_ghs": [], "frases_h": [], "frases_p": []}},
  "incendios": "", "vertidos": "", "exposicion": "", "estabilidad": "", "toxicologia": "",
  "ecologia": "", "eliminacion": "", "transporte": "",
  "manipulacion": {{"almacenamiento": ""}},
  "propiedades": [["Punto de inflamación", ""]],
  "regulatorio": {{"normativa": ""}}
}}"""


def _limpiar_sugerencia(bruto: dict) -> dict:
    """Deja solo el esquema 2 y valores bien formados (la IA a veces se sale del molde)."""
    pel = bruto.get("peligros") if isinstance(bruto.get("peligros"), dict) else {}
    senal = _texto(pel.get("senal"))
    senal = {"peligro": "Peligro", "atencion": "Atención", "advertencia": "Atención"}.get(_sin_tildes(senal), "")
    pictos = []
    for c in pel.get("pictogramas_ghs") or []:
        for cod in pictogramas_en_texto(str(c)):
            if cod not in pictos:
                pictos.append(cod)
    salida: dict[str, Any] = {
        "identificacion": {"usos": _texto((bruto.get("identificacion") or {}).get("usos"))},
        "peligros": {
            "clasificacion": _limpiar_clasificacion(_texto(pel.get("clasificacion"))),
            "senal": senal,
            "pictogramas_ghs": pictos,
            "frases_h": [_formatear_frase(c, t) for c, t in frases_en_texto("\n".join(_lista(pel.get("frases_h")))) if not c.startswith("P")],
            "frases_p": [_formatear_frase(c, t) for c, t in frases_en_texto("\n".join(_lista(pel.get("frases_p")))) if c.startswith("P")],
        },
        "manipulacion": {"almacenamiento": _texto((bruto.get("manipulacion") or {}).get("almacenamiento"))},
        "regulatorio": {"normativa": _texto((bruto.get("regulatorio") or {}).get("normativa"))},
        "propiedades": [
            [str(f[0]).strip(), str(f[1]).strip()]
            for f in (bruto.get("propiedades") or [])
            if isinstance(f, (list, tuple)) and len(f) >= 2 and str(f[1]).strip()
            and not _grupo_propiedad(str(f[0]))
        ],
    }
    for campo in ("incendios", "vertidos", "exposicion", "estabilidad", "toxicologia",
                  "ecologia", "eliminacion", "transporte"):
        salida[campo] = _texto(bruto.get(campo))
    return salida


def sugerir_sds(titulo: str, ft: dict | None = None, identificacion: dict | None = None) -> dict:
    """Propone la SDS completa (esquema 2) a partir del título. Una llamada a la IA.

    Recibe lo que la FT ya dice para que la sugerencia no lo repita. El
    resultado es una sugerencia: el formulario la marca `sugerida_ia` y el
    documento final no sale sin visto bueno."""
    from app.services.documento_cientifico import _sintetizar_json

    titulo = (titulo or "").strip()
    if not titulo:
        raise ValueError("Se requiere el nombre del producto")
    ft = ft or {}
    ident = identificacion or {}
    ident_txt = ", ".join(f"{k}: {v}" for k, v in (("CAS", ident.get("cas")), ("INCI", ident.get("inci"))) if v)
    props = "; ".join(f"{a}: {b}" for a, b in (ft.get("propiedades") or []) if a) or "(sin datos)"
    prompt = _PROMPT_SUGERIR.format(
        titulo=titulo,
        identificacion=f"Identificación: {ident_txt}\n" if ident_txt else "",
        conservacion=_texto(ft.get("conservacion")) or "(sin datos)",
        propiedades=props,
    )
    bruto = _sintetizar_json(prompt, contexto="documentos_sugerir_sds")
    if not isinstance(bruto, dict):
        raise RuntimeError("La IA no devolvió una hoja de seguridad válida. Intente de nuevo.")
    return _limpiar_sugerencia(bruto)
