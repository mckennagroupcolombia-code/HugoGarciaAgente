"""
Ideas de producto (Diseño de producto → Desarrollar idea).

Cada idea se desarrolla como un cladograma: la idea es la raíz y se abre en las
siete ramas del ciclo de diseño (usuario, requerimientos, arquitectura,
ingeniería y DFM, prototipado, sostenibilidad, riesgos); cada rama en sus
sub-ramas y cada sub-rama en puntos concretos. El esqueleto de ramas es fijo
(sale de aquí, no de la IA); la IA solo llena los puntos, y cualquier nodo se
puede volver a ramificar o editar a mano desde el panel.

Datos: app/data/ideas.json, bajo candado de archivo (fcntl) como las fórmulas.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import uuid
from datetime import datetime
from typing import Any

_DATA = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
_ARCHIVO = os.path.join(_DATA, "ideas.json")
_CANDADO = _ARCHIVO + ".lock"

_MAX_PROFUNDIDAD = 7
_MAX_NODOS = 800

# Las siete ramas del ciclo de diseño y sus sub-ramas (id, texto, qué debe cubrir).
RAMAS: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    ("usuario", "1 · Usuario (Descubrir)", [
        ("perfil", "Perfil del usuario", "arquetipo, contexto de uso diario y puntos de dolor"),
        ("ergonomia", "Ergonomía y antropometría", "puntos de contacto, percentiles, agarre, peso objetivo, feedback táctil"),
    ]),
    ("requerimientos", "2 · Requerimientos (Definir)", [
        ("funcionales", "Funcionales", "desempeño, vida útil, cargas, interacción"),
        ("esteticos", "Estéticos y CMF", "ADN de marca, color-material-acabado, semiótica"),
        ("comerciales", "Comerciales", "costo de manufactura objetivo (COGS), time-to-market"),
    ]),
    ("arquitectura", "3 · Arquitectura (Idear)", [
        ("bom", "Componentes (BOM preliminar)", "carcasa, mecanismos, electrónica si aplica, fijaciones"),
        ("ensamble", "Estrategia de ensamble", "secuencia de armado, mantenimiento, desensamble"),
    ]),
    ("ingenieria", "4 · Ingeniería y DFM (Desarrollar)", [
        ("materiales", "Materiales", "resinas/metales/elastómeros con su justificación"),
        ("dfm", "Reglas de manufactura", "espesores de pared, ángulos de desmolde, nervaduras, torres"),
        ("uniones", "Tolerancias y uniones", "GD&T, snap-fits, ultrasonido, tornillería"),
    ]),
    ("prototipado", "5 · Prototipado y pruebas", [
        ("validacion", "Secuencia de validación", "mock-up, prueba de concepto, alfa, beta"),
        ("pruebas", "Pruebas y normativas", "caída, estanqueidad, fatiga, certificaciones"),
    ]),
    ("sostenibilidad", "6 · Sostenibilidad (ciclo de vida)", [
        ("fin_vida", "Fin de vida", "desensamble, reciclabilidad, biomateriales"),
        ("empaque", "Empaque y transporte", "eficiencia volumétrica, embalaje"),
    ]),
    ("riesgos", "7 · Riesgos y siguientes pasos", [
        ("fmea", "FMEA preliminar", "modos de falla en fabricación y uso, con su mitigación"),
        ("entregables", "Entregables para CAD 3D", "lo inmediato para arrancar el modelado"),
    ]),
]


@contextlib.contextmanager
def _candado():
    os.makedirs(_DATA, exist_ok=True)
    with open(_CANDADO, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _nuevo_id() -> str:
    return uuid.uuid4().hex[:10]


def _texto(v: Any, maximo: int = 4000) -> str:
    return str(v or "").strip()[:maximo]


def _load() -> list[dict]:
    try:
        with open(_ARCHIVO, encoding="utf-8") as fh:
            datos = json.load(fh)
    except FileNotFoundError:
        return []
    return [i for i in (datos.get("ideas") if isinstance(datos, dict) else datos) or [] if isinstance(i, dict)]


def _save(ideas: list[dict]) -> None:
    tmp = _ARCHIVO + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"ideas": ideas}, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, _ARCHIVO)


def _nodo(raw: Any, profundidad: int, cuenta: list[int]) -> dict | None:
    """Nodo saneado: {id, texto, hijos}. Corta por profundidad y por total de nodos."""
    if not isinstance(raw, dict) or profundidad > _MAX_PROFUNDIDAD or cuenta[0] >= _MAX_NODOS:
        return None
    texto = _texto(raw.get("texto"), 400)
    if not texto:
        return None
    cuenta[0] += 1
    hijos = [h for h in (_nodo(x, profundidad + 1, cuenta) for x in raw.get("hijos") or []) if h]
    return {"id": _texto(raw.get("id"), 40) or _nuevo_id(), "texto": texto, "hijos": hijos}


def listar() -> list[dict]:
    return sorted(_load(), key=lambda i: i.get("actualizado") or "", reverse=True)


def guardar(body: dict, autor: str = "") -> dict:
    titulo = _texto(body.get("titulo"), 160)
    if not titulo:
        raise ValueError("La idea necesita un nombre")
    arbol = _nodo(body.get("arbol"), 0, [0]) if body.get("arbol") else None
    if arbol:
        arbol["texto"] = titulo  # la raíz del cladograma es siempre la idea
    idea_id = _texto(body.get("id"), 40)
    with _candado():
        todas = _load()
        existente = next((i for i in todas if i.get("id") == idea_id), None) if idea_id else None
        entrada = {
            "id": idea_id if existente else uuid.uuid4().hex[:12],
            "titulo": titulo,
            "descripcion": _texto(body.get("descripcion"), 3000),
            "arbol": arbol,
            "creado": (existente or {}).get("creado") or _now(),
            "creado_por": (existente or {}).get("creado_por") or autor,
            "actualizado": _now(),
            "actualizado_por": autor,
        }
        if existente:
            todas = [entrada if i.get("id") == entrada["id"] else i for i in todas]
        else:
            todas.append(entrada)
        _save(todas)
    return entrada


def eliminar(idea_id: str) -> bool:
    with _candado():
        todas = _load()
        quedan = [i for i in todas if i.get("id") != idea_id]
        if len(quedan) == len(todas):
            return False
        _save(quedan)
    return True


# ── IA ──────────────────────────────────────────────────────────────────────

def _gemini(prompt: str) -> Any:
    """Gemini con el límite de 120 s de los jobs en segundo plano; devuelve el JSON parseado."""
    from app.services.documento_cientifico import _LIMITE_GEMINI_S, _sintetizar_texto

    token = _LIMITE_GEMINI_S.set(120)
    try:
        texto = _sintetizar_texto(prompt)
    finally:
        _LIMITE_GEMINI_S.reset(token)
    m = re.search(r"[\[{].*[\]}]", texto, re.S)
    try:
        return json.loads(m.group(0) if m else texto)
    except (ValueError, AttributeError):
        raise RuntimeError("La IA no devolvió un cladograma legible; intenta de nuevo")


def _hojas(valores: Any, maximo: int = 6) -> list[dict]:
    if not isinstance(valores, list):
        return []
    return [{"id": _nuevo_id(), "texto": _texto(v, 300), "hijos": []} for v in valores if _texto(v, 300)][:maximo]


def _contexto(titulo: str, descripcion: str) -> str:
    return (
        "Actúas como líder de diseño industrial y gestión de producto (Head of Hardware Design & Engineering).\n"
        f"Idea de producto: {titulo}\n"
        + (f"Descripción y restricciones dadas por el equipo: {descripcion}\n" if descripcion else "")
        + "Escribe en español, en frases cortas y concretas (máximo 18 palabras cada una), con cifras "
        "cuando aplique (mm, g, %, USD, ciclos). Nada genérico: todo debe ser propio de esta idea.\n"
    )


def desarrollar(titulo: str, descripcion: str = "") -> dict:
    """Cladograma completo: raíz = idea, 7 ramas fijas, sus sub-ramas y 3-5 puntos en cada una."""
    titulo = _texto(titulo, 160)
    if not titulo:
        raise ValueError("Escribe primero la idea")
    claves = "\n".join(
        f'- "{sub_id}": {sub_txt} — {cubre}'
        for _, _, subs in RAMAS
        for sub_id, sub_txt, cubre in subs
    )
    prompt = (
        _contexto(titulo, _texto(descripcion, 3000))
        + "Desarrolla la idea para cada una de estas claves (3 a 5 puntos cada una):\n"
        + claves
        + '\nResponde SOLO un objeto JSON {"clave": ["punto", ...], ...} con todas las claves, sin texto adicional.'
    )
    datos = _gemini(prompt)
    if not isinstance(datos, dict):
        raise RuntimeError("La IA no devolvió un cladograma legible; intenta de nuevo")
    arbol = {
        "id": _nuevo_id(),
        "texto": titulo,
        "hijos": [
            {
                "id": _nuevo_id(),
                "texto": rama_txt,
                "hijos": [
                    {"id": _nuevo_id(), "texto": sub_txt, "hijos": _hojas(datos.get(sub_id))}
                    for sub_id, sub_txt, _ in subs
                ],
            }
            for _, rama_txt, subs in RAMAS
        ],
    }
    return {"arbol": arbol}


def ramificar(titulo: str, descripcion: str, ruta: list[str], existentes: list[str] | None = None) -> dict:
    """Nuevas ramas (3-5) para un nodo; `ruta` va de la raíz al nodo, `existentes` son sus hijos actuales."""
    ruta = [_texto(r, 400) for r in ruta or [] if _texto(r, 400)]
    if not ruta:
        raise ValueError("Falta el nodo a ramificar")
    ya = [_texto(e, 300) for e in existentes or [] if _texto(e, 300)]
    prompt = (
        _contexto(_texto(titulo, 160) or ruta[0], _texto(descripcion, 3000))
        + "Rama del cladograma, de la raíz al nodo:\n"
        + "\n".join(f"{'  ' * k}→ {r}" for k, r in enumerate(ruta))
        + f"\nAbre el último nodo («{ruta[-1]}») en 3 a 5 ramas hijas más específicas."
        + (f"\nYa tiene estas ramas, no las repitas: {json.dumps(ya, ensure_ascii=False)}" if ya else "")
        + '\nResponde SOLO un arreglo JSON de textos ["rama", ...], sin texto adicional.'
    )
    datos = _gemini(prompt)
    if isinstance(datos, dict):  # a veces envuelve el arreglo en un objeto
        datos = next((v for v in datos.values() if isinstance(v, list)), [])
    hijos = _hojas(datos, 5)
    if not hijos:
        raise RuntimeError("La IA no propuso ramas nuevas; intenta de nuevo")
    return {"hijos": hijos}
