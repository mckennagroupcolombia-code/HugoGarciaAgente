"""Consultas de clientes que el catálogo no logró resolver.

Motivación (2026-09-09): el bot le dijo cinco veces a un cliente que el precio
de la creatina "no me figura en el sistema" mientras el producto estaba en
catálogo con stock 9. El defecto solo se descubrió leyendo chats a mano. Este
registro convierte ese hallazgo en un dato: cada vez que el preflight de
catálogo se queda sin resultados, se anota el término normalizado con su
contador, para tener la lista de lo que hay que arreglar (o dar de alta en el
catálogo) sin depender de que alguien lea conversaciones.

Agregado por término, no por evento: el archivo se mantiene pequeño y estable
(ver la convención de app/data/ en CLAUDE.md).
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime

_PATH = os.path.join("app", "data", "catalogo_sin_resultado.json")
_MAX_TERMINOS = 400
_MAX_LARGO_TERMINO = 80


def _normalizar(termino: str) -> str:
    t = (termino or "").strip().lower()
    t = re.sub(r"\s+", " ", t)
    return t[:_MAX_LARGO_TERMINO]


def registrar_sin_resultado(termino: str, canal: str = "whatsapp") -> None:
    """Anota un término que no encontró nada. Nunca lanza: es telemetría."""
    clave = _normalizar(termino)
    if len(clave) < 3:
        return
    try:
        try:
            with open(_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {}
        terminos = data.setdefault("terminos", {})
        entrada = terminos.setdefault(
            clave, {"veces": 0, "canales": [], "primera_vez": None, "ultima_vez": None}
        )
        ahora = datetime.now().isoformat(timespec="seconds")
        entrada["veces"] += 1
        entrada["ultima_vez"] = ahora
        if not entrada.get("primera_vez"):
            entrada["primera_vez"] = ahora
        if canal not in entrada["canales"]:
            entrada["canales"].append(canal)

        # Poda: se conservan los más repetidos, que son los que valen la pena
        # revisar. Los términos de una sola vez suelen ser ruido o typos.
        if len(terminos) > _MAX_TERMINOS:
            ordenados = sorted(
                terminos.items(),
                key=lambda kv: (-kv[1].get("veces", 0), kv[1].get("ultima_vez") or ""),
            )
            data["terminos"] = dict(ordenados[:_MAX_TERMINOS])

        data["actualizado"] = ahora
        with open(_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def top_sin_resultado(limite: int = 30) -> list[dict]:
    """Términos más pedidos que el catálogo no resuelve, de mayor a menor."""
    try:
        with open(_PATH, encoding="utf-8") as f:
            terminos = json.load(f).get("terminos", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return []
    filas = [{"termino": k, **v} for k, v in terminos.items()]
    filas.sort(key=lambda r: (-r.get("veces", 0), r.get("ultima_vez") or ""))
    return filas[:limite]
