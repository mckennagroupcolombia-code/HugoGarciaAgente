"""
Parser de docs/team-recaps.md para el panel "Control de Versiones" (/app).

Formato esperado por entrada (ver docs/agentic/TEAM_WORKFLOW.md):

    ### [Fecha y Hora] - [Titulo corto]
    - **Autor:** Nombre
    - **Tipo de Cambio:** Nueva funcionalidad / Correccion / Mejora tecnica
    - **Que se implemento:**
      - bullet
      - bullet
    - **Archivos Modificados:** archivo1, archivo2

Parseo tolerante: una entrada con campos faltantes igual se devuelve con lo
que se pudo extraer, en vez de romper el listado completo.
"""

from __future__ import annotations

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
RECAPS_PATH = _REPO_ROOT / "docs" / "team-recaps.md"

_ENTRADA_RE = re.compile(r"^###\s+(.+)$", re.MULTILINE)
_CAMPO_RE = re.compile(r"^-\s+\*\*(.+?):\*\*\s*(.*)$")
_SUBBULLET_RE = re.compile(r"^\s{2,}-\s+(.+)$")


def _parsear_titulo(linea: str) -> dict:
    # "[Fecha y Hora] - [Titulo corto]" -> separa por el primer " - "
    partes = linea.split(" - ", 1)
    fecha = partes[0].strip()
    titulo = partes[1].strip() if len(partes) > 1 else ""
    return {"fecha": fecha, "titulo": titulo}


def _parsear_bloque(titulo_linea: str, cuerpo: str) -> dict:
    entrada = _parsear_titulo(titulo_linea)
    entrada.update(
        {"autor": "", "tipo_cambio": "", "que_se_implemento": [], "archivos_modificados": ""}
    )

    campo_actual = None
    for linea in cuerpo.splitlines():
        m_campo = _CAMPO_RE.match(linea)
        if m_campo:
            nombre, valor = m_campo.group(1).strip().lower(), m_campo.group(2).strip()
            if "autor" in nombre:
                entrada["autor"] = valor
                campo_actual = None
            elif "tipo" in nombre:
                entrada["tipo_cambio"] = valor
                campo_actual = None
            elif "implement" in nombre:
                campo_actual = "que_se_implemento"
                if valor:
                    entrada["que_se_implemento"].append(valor)
            elif "archivo" in nombre:
                entrada["archivos_modificados"] = valor
                campo_actual = "archivos_lista"
            else:
                campo_actual = None
            continue

        m_sub = _SUBBULLET_RE.match(linea)
        if m_sub and campo_actual == "que_se_implemento":
            entrada["que_se_implemento"].append(m_sub.group(1).strip())
        elif m_sub and campo_actual == "archivos_lista":
            extra = m_sub.group(1).strip()
            entrada["archivos_modificados"] = (
                f"{entrada['archivos_modificados']}, {extra}"
                if entrada["archivos_modificados"]
                else extra
            )

    return entrada


def obtener_team_recaps(limite: int = 100) -> dict:
    """Devuelve {recaps: [...]} en el mismo orden del archivo (mas reciente primero)."""
    if not RECAPS_PATH.exists():
        return {"recaps": []}

    try:
        texto = RECAPS_PATH.read_text(encoding="utf-8")
    except Exception as e:
        return {"error": str(e)}

    matches = list(_ENTRADA_RE.finditer(texto))
    recaps = []
    for i, m in enumerate(matches):
        inicio_cuerpo = m.end()
        fin_cuerpo = matches[i + 1].start() if i + 1 < len(matches) else len(texto)
        cuerpo = texto[inicio_cuerpo:fin_cuerpo]
        recaps.append(_parsear_bloque(m.group(1).strip(), cuerpo))

    limite = max(1, min(int(limite or 100), 500))
    return {"recaps": recaps[:limite]}
