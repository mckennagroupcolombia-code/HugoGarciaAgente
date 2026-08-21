"""Helpers compartidos para stores JSON admin-editables (patrón de tema_web.py).

Usado por app/tools/origen_materias.py y app/tools/banners_web.py: escritura
atómica (tempfile + os.replace) y merge recursivo dict-sobre-dict.
"""

from __future__ import annotations

import copy
import json
import os
import tempfile
from pathlib import Path


def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def deep_merge(base: dict, extra: dict) -> dict:
    """Merge recursivo: extra pisa base; dicts se combinan, listas se reemplazan."""
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out
