"""
Ideas de producto (Diseño de producto → Desarrollar idea).

Cada idea se construye como un cladograma, rama por rama: la idea es la raíz y
el equipo decide qué ramas lleva. Las siete etapas del ciclo de diseño
(usuario, requerimientos, arquitectura…) son solo una guía que el panel ofrece
como sugerencia; cada proyecto tiene además sus propios parámetros (usuario,
precio, manufactura, restricciones o los que se agreguen), y la IA los usa para
proponer opciones en la rama que se esté desarrollando. Nada entra al árbol sin
que alguien lo elija.

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


def _parametros(raw: Any) -> list[dict]:
    """Parámetros propios del proyecto: [{nombre, valor}], sin filas del todo vacías."""
    salida = []
    for p in raw if isinstance(raw, list) else []:
        if not isinstance(p, dict):
            continue
        nombre, valor = _texto(p.get("nombre"), 80), _texto(p.get("valor"), 600)
        if nombre or valor:
            salida.append({"nombre": nombre, "valor": valor})
    return salida[:30]


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
            "parametros": _parametros(body.get("parametros")),
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


def _contexto(titulo: str, parametros: list[dict], descripcion: str = "") -> str:
    lineas = [f"- {p['nombre'] or 'Dato'}: {p['valor']}" for p in _parametros(parametros) if p["valor"]]
    return (
        "Actúas como líder de diseño industrial y gestión de producto (Head of Hardware Design & Engineering).\n"
        f"Idea de producto: {titulo}\n"
        + ("Parámetros de este proyecto:\n" + "\n".join(lineas) + "\n" if lineas else "")
        + (f"Notas del equipo: {descripcion}\n" if descripcion else "")
        + "Escribe en español, en frases cortas y concretas (máximo 18 palabras cada una), con cifras "
        "cuando aplique (mm, g, %, USD, ciclos). Nada genérico: todo debe responder a esta idea y sus parámetros.\n"
    )


def ramificar(
    titulo: str,
    parametros: list[dict],
    ruta: list[str],
    existentes: list[str] | None = None,
    descripcion: str = "",
) -> dict:
    """Opciones (5-6) para abrir un nodo; `ruta` va de la raíz al nodo, `existentes` son sus hijos actuales.
    El panel las muestra para elegir: aquí no se toca el árbol guardado."""
    ruta = [_texto(r, 400) for r in ruta or [] if _texto(r, 400)]
    if not ruta:
        raise ValueError("Falta el nodo a ramificar")
    ya = [_texto(e, 300) for e in existentes or [] if _texto(e, 300)]
    prompt = (
        _contexto(_texto(titulo, 160) or ruta[0], parametros, _texto(descripcion, 3000))
        + "Rama del cladograma, de la raíz al nodo:\n"
        + "\n".join(f"{'  ' * k}→ {r}" for k, r in enumerate(ruta))
        + f"\nPropón de 5 a 6 ramas hijas para el último nodo («{ruta[-1]}»), más específicas que él."
        + (" Como es la raíz, propón las grandes áreas que este proyecto necesita desarrollar." if len(ruta) == 1 else "")
        + (f"\nYa tiene estas ramas, no las repitas: {json.dumps(ya, ensure_ascii=False)}" if ya else "")
        + '\nResponde SOLO un arreglo JSON de textos ["rama", ...], sin texto adicional.'
    )
    datos = _gemini(prompt)
    if isinstance(datos, dict):  # a veces envuelve el arreglo en un objeto
        datos = next((v for v in datos.values() if isinstance(v, list)), [])
    opciones = [_texto(v, 300) for v in datos if _texto(v, 300)][:6] if isinstance(datos, list) else []
    if not opciones:
        raise RuntimeError("La IA no propuso ramas nuevas; intenta de nuevo")
    return {"opciones": opciones}
