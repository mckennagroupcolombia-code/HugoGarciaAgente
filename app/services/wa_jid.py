"""
WhatsApp JID: @c.us (teléfono) vs @lid (Linked ID opaco).
Unifica modos de atención, historial del panel y alias lid↔teléfono.
"""

from __future__ import annotations

import json
import os
import re
import threading
from typing import Iterable

_ALIASES_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "wa_lid_aliases.json")
_LOCK = threading.Lock()


def _load_aliases() -> dict[str, str]:
    try:
        with open(_ALIASES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in data.items():
        lk = str(k).strip()
        cv = str(v).strip()
        if lk.endswith("@lid") and cv.endswith("@c.us"):
            out[lk] = cv
    return out


def _save_aliases(aliases: dict[str, str]) -> None:
    os.makedirs(os.path.dirname(_ALIASES_PATH), exist_ok=True)
    with open(_ALIASES_PATH, "w", encoding="utf-8") as f:
        json.dump(aliases, f, indent=2, ensure_ascii=False)


def es_jid_lid(jid: str) -> bool:
    return str(jid or "").strip().endswith("@lid")


def es_jid_grupo(jid: str) -> bool:
    return str(jid or "").strip().endswith("@g.us")


def es_jid_cus(jid: str) -> bool:
    return str(jid or "").strip().endswith("@c.us")


def registrar_alias_lid(lid: str, phone_jid: str) -> None:
    """Persiste lid@lid → 573XXXXXXXXX@c.us cuando el bridge resuelve el contacto."""
    lid = str(lid or "").strip()
    phone_jid = str(phone_jid or "").strip()
    if not es_jid_lid(lid) or not es_jid_cus(phone_jid):
        return
    with _LOCK:
        aliases = _load_aliases()
        if aliases.get(lid) == phone_jid:
            return
        aliases[lid] = phone_jid
        _save_aliases(aliases)


def jid_canonico(jid: str) -> str:
    """JID preferido para agrupar historial (teléfono si se conoce el alias)."""
    jid = str(jid or "").strip()
    if not jid:
        return jid
    if es_jid_cus(jid) or es_jid_grupo(jid):
        return jid
    if es_jid_lid(jid):
        return _load_aliases().get(jid, jid)
    return jid


def jids_relacionados(jid: str) -> set[str]:
    """Todos los JID que representan al mismo chat individual."""
    jid = str(jid or "").strip()
    if not jid:
        return set()
    if es_jid_grupo(jid):
        return {jid}
    out = {jid}
    aliases = _load_aliases()
    if es_jid_lid(jid):
        phone = aliases.get(jid)
        if phone:
            out.add(phone)
    elif es_jid_cus(jid):
        for lid, phone in aliases.items():
            if phone == jid:
                out.add(lid)
    canon = jid_canonico(jid)
    out.add(canon)
    if es_jid_lid(canon):
        phone = aliases.get(canon)
        if phone:
            out.add(phone)
    return out


def en_lista_modo(jid: str, lista: Iterable[str]) -> bool:
    lista_set = set(lista or [])
    return bool(jids_relacionados(jid) & lista_set)


def modo_para_jid(jid: str, humanos: Iterable[str], silenciados: Iterable[str]) -> str:
    if en_lista_modo(jid, silenciados):
        return "silenciado"
    if en_lista_modo(jid, humanos):
        return "humano"
    return "bot"


def formato_display(jid: str) -> str:
    """Etiqueta legible para el panel (318 243 2463 en lugar de 730…@lid)."""
    canon = jid_canonico(jid)
    num = canon.split("@")[0] if "@" in canon else canon
    digits = re.sub(r"\D", "", num)
    if digits.startswith("57") and len(digits) == 12:
        local = digits[2:]
        return f"{local[:3]} {local[3:6]} {local[6]}"
    if len(digits) == 10 and digits.startswith("3"):
        return f"{digits[:3]} {digits[3:6]} {digits[6:]}"
    if es_jid_lid(jid):
        return f"Contacto WA ({jid.split('@')[0][:6]}…)"
    return num


def aplicar_modo_en_relacionados(
    modos: dict,
    jid: str,
    *,
    agregar_humano: bool = False,
    quitar_humano: bool = False,
    silenciar: bool = False,
    activar: bool = False,
    razon: str = "",
    ts: float | None = None,
) -> None:
    """Replica cambios de modo en lid + @c.us vinculados."""
    import time as _time

    ts = ts if ts is not None else _time.time()
    modos.setdefault("numeros_en_humano", [])
    modos.setdefault("numeros_silenciados", [])
    modos.setdefault("timestamps", {})
    modos.setdefault("bot_auto_pausados", {})

    for j in jids_relacionados(jid):
        if agregar_humano:
            if j not in modos["numeros_en_humano"]:
                modos["numeros_en_humano"].append(j)
            modos["timestamps"][j] = ts
            modos["bot_auto_pausados"][j] = {
                "timestamp": ts,
                "razon": razon,
                "ultimo_mensaje": "",
            }
        if quitar_humano or activar:
            modos["numeros_en_humano"] = [n for n in modos["numeros_en_humano"] if n != j]
            modos.get("bot_auto_pausados", {}).pop(j, None)
            modos.get("timestamps", {}).pop(j, None)
        if silenciar:
            if j not in modos["numeros_silenciados"]:
                modos["numeros_silenciados"].append(j)
            modos["timestamps"][j] = ts
        if activar:
            modos["numeros_silenciados"] = [
                n for n in modos.get("numeros_silenciados", []) if n != j
            ]


def limpiar_jids_falsos_en_modos(modos: dict) -> bool:
    """
    Quita entradas 123456789012@c.us generadas por error al normalizar un @lid.
    Devuelve True si hubo cambios.
    """
    aliases = _load_aliases()
    lids_en_humano = [j for j in modos.get("numeros_en_humano", []) if es_jid_lid(j)]
    falsos: set[str] = set()
    for lid in lids_en_humano:
        pref = lid.split("@")[0]
        falso = f"{pref}@c.us"
        if falso not in aliases.values():
            falsos.add(falso)
    if not falsos:
        return False
    changed = False
    for key in ("numeros_en_humano", "numeros_silenciados"):
        antes = modos.get(key, [])
        despues = [j for j in antes if j not in falsos]
        if len(despues) != len(antes):
            modos[key] = despues
            changed = True
    for j in falsos:
        if modos.get("bot_auto_pausados", {}).pop(j, None) is not None:
            changed = True
        if modos.get("timestamps", {}).pop(j, None) is not None:
            changed = True
    return changed
