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
_ALIASES_LIMPIOS = False


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


def digitos_jid(jid: str) -> str:
    raw = str(jid or "").split("@")[0]
    return re.sub(r"\D", "", raw)


def es_telefono_jid_valido(jid: str) -> bool:
    """Colombia móvil: 57 + 10 dígitos empezando en 3 (12 dígitos totales)."""
    if not es_jid_cus(jid):
        return False
    digits = digitos_jid(jid)
    if len(digits) != 12 or not digits.startswith("57"):
        return False
    local = digits[2:]
    return len(local) == 10 and local.startswith("3")


def es_jid_cus_falso(jid: str) -> bool:
    """@c.us que no es móvil colombiano válido (p. ej. 57+dígitos del @lid)."""
    return es_jid_cus(jid) and not es_telefono_jid_valido(jid)


def lid_desde_jid_cus_falso(jid: str) -> str | None:
    """Infiere @lid desde un @c.us opaco tipo 5763973621784822@c.us."""
    if not es_jid_cus_falso(jid):
        return None
    digits = digitos_jid(jid)
    if digits.startswith("57") and len(digits) > 12:
        lid_part = digits[2:]
        if len(lid_part) >= 8:
            return f"{lid_part}@lid"
    return None


def es_alias_telefono_falso(lid: str, phone_jid: str) -> bool:
    """Detecta 57+lid_digits@c.us (error histórico al normalizar @lid)."""
    if not es_jid_lid(lid) or not es_jid_cus(phone_jid):
        return True
    if es_telefono_jid_valido(phone_jid):
        return False
    lid_pref = lid.split("@")[0]
    phone_pref = digitos_jid(phone_jid)
    if phone_pref == f"57{lid_pref}":
        return True
    if len(phone_pref) > 12:
        return True
    return False


def limpiar_aliases_falsos() -> int:
    """Elimina mapeos lid→teléfono inválidos del JSON. Retorna cuántos quitó."""
    global _ALIASES_LIMPIOS
    with _LOCK:
        aliases = _load_aliases()
        limpios = {
            lid: phone
            for lid, phone in aliases.items()
            if not es_alias_telefono_falso(lid, phone)
            and not es_telefono_negocio(phone)
        }
        removidos = len(aliases) - len(limpios)
        if removidos:
            _save_aliases(limpios)
        _ALIASES_LIMPIOS = True
        return removidos


def _aliases_seguros() -> dict[str, str]:
    global _ALIASES_LIMPIOS
    if not _ALIASES_LIMPIOS:
        limpiar_aliases_falsos()
    return _load_aliases()


def lid_desde_wa_id(wa_id: str) -> str | None:
    """Extrae 39818893471872@lid desde true_39818893471872@lid_ABC…"""
    m = re.search(r"(\d+@lid)", str(wa_id or ""))
    if m:
        return m.group(1)
    return None


def es_telefono_negocio(jid: str) -> bool:
    """Evita mapear @lid → número de la línea comercial (no es el cliente)."""
    if not es_jid_cus(jid):
        return False
    digits = digitos_jid(jid)
    negocio = {
        digitos_jid(os.getenv("MCKENNA_WA_PUBLIC") or ""),
        digitos_jid(os.getenv("WEB_WA_NUMBER") or ""),
        digitos_jid(os.getenv("MCKENNA_WA_LINE") or ""),
        "573195183596",
    }
    negocio = {d for d in negocio if len(d) >= 10}
    return digits in negocio


def registrar_alias_lid(lid: str, phone_jid: str) -> None:
    """Persiste lid@lid → 573XXXXXXXXX@c.us cuando el bridge resuelve el contacto."""
    lid = str(lid or "").strip()
    phone_jid = str(phone_jid or "").strip()
    if not es_jid_lid(lid) or not es_telefono_jid_valido(phone_jid):
        return
    if es_telefono_negocio(phone_jid):
        return
    if es_alias_telefono_falso(lid, phone_jid):
        return
    with _LOCK:
        aliases = _load_aliases()
        if aliases.get(lid) == phone_jid:
            return
        aliases[lid] = phone_jid
        _save_aliases(aliases)


def normalizar_jid_almacenamiento(
    jid: str,
    *,
    sender_lid: str = "",
    sender_phone: str = "",
) -> str:
    """JID estable para SQLite: teléfono real > @lid > nunca 57+lid@c.us."""
    jid = str(jid or "").strip()
    sl = str(sender_lid or "").strip()
    sp = str(sender_phone or "").strip()
    if sl and sp and es_jid_lid(sl) and es_telefono_jid_valido(sp) and not es_telefono_negocio(sp):
        registrar_alias_lid(sl, sp)
    if sp and es_telefono_jid_valido(sp) and not es_telefono_negocio(sp):
        return sp
    if sl and es_jid_lid(sl):
        return jid_canonico(sl)
    if es_jid_lid(jid):
        return jid_canonico(jid)
    if es_jid_cus_falso(jid):
        lid = lid_desde_jid_cus_falso(jid)
        if lid:
            return jid_canonico(lid)
    if es_telefono_jid_valido(jid) and not es_telefono_negocio(jid):
        return jid
    if es_telefono_negocio(jid):
        return jid
    return jid


def jid_canonico(jid: str) -> str:
    """JID preferido para agrupar historial (teléfono válido si se conoce el alias)."""
    jid = str(jid or "").strip()
    if not jid:
        return jid
    if es_jid_grupo(jid):
        return jid
    if es_jid_cus(jid):
        if es_telefono_jid_valido(jid) and not es_telefono_negocio(jid):
            return jid
        if es_telefono_negocio(jid):
            return jid
        lid = lid_desde_jid_cus_falso(jid)
        if lid:
            phone = _aliases_seguros().get(lid)
            if (
                phone
                and es_telefono_jid_valido(phone)
                and not es_telefono_negocio(phone)
            ):
                return phone
            return lid
        return jid
    if es_jid_lid(jid):
        phone = _aliases_seguros().get(jid)
        if (
            phone
            and es_telefono_jid_valido(phone)
            and not es_telefono_negocio(phone)
        ):
            return phone
        return jid
    return jid


def jids_relacionados(jid: str) -> set[str]:
    """Todos los JID que representan al mismo chat individual."""
    jid = str(jid or "").strip()
    if not jid:
        return set()
    if es_jid_grupo(jid):
        return {jid}
    out = {jid}
    aliases = _aliases_seguros()
    if es_jid_lid(jid):
        phone = aliases.get(jid)
        if phone and es_telefono_jid_valido(phone) and not es_telefono_negocio(phone):
            out.add(phone)
    elif es_jid_cus(jid):
        if not es_telefono_negocio(jid):
            for lid, phone in aliases.items():
                if phone == jid:
                    out.add(lid)
        lid_falso = lid_desde_jid_cus_falso(jid)
        if lid_falso:
            out.add(lid_falso)
            fake_cus = jid if es_jid_cus_falso(jid) else None
            if fake_cus:
                out.add(fake_cus)
    canon = jid_canonico(jid)
    out.add(canon)
    if es_jid_lid(canon):
        phone = aliases.get(canon)
        if phone and es_telefono_jid_valido(phone) and not es_telefono_negocio(phone):
            out.add(phone)
    return out


def es_jid_conversacion_cliente(jid: str) -> bool:
    """False para la línea comercial (no es un chat de cliente)."""
    jid = str(jid or "").strip()
    if not jid or es_jid_grupo(jid):
        return bool(jid)
    if es_telefono_negocio(jid):
        return False
    if es_jid_lid(jid):
        return True
    if es_telefono_jid_valido(jid):
        return True
    if es_jid_cus_falso(jid):
        return True
    return True


def en_lista_modo(jid: str, lista: Iterable[str]) -> bool:
    lista_set = set(lista or [])
    return bool(jids_relacionados(jid) & lista_set)


def modo_para_jid(jid: str, humanos: Iterable[str], silenciados: Iterable[str]) -> str:
    if en_lista_modo(jid, silenciados):
        return "silenciado"
    if en_lista_modo(jid, humanos):
        return "humano"
    return "bot"


def _formato_colombia(digits: str) -> str:
    if digits.startswith("57") and len(digits) == 12:
        local = digits[2:]
        return f"+57 {local[:3]} {local[3:6]} {local[6:]}"
    if len(digits) == 10 and digits.startswith("3"):
        return f"+57 {digits[:3]} {digits[3:6]} {digits[6:]}"
    return digits


def telefono_desde_jid(jid: str) -> str | None:
    """Número E.164 formateado si el JID es teléfono colombiano válido."""
    canon = jid_canonico(jid)
    if es_telefono_jid_valido(canon):
        return _formato_colombia(digitos_jid(canon))
    if es_jid_cus(jid) and es_telefono_jid_valido(jid):
        return _formato_colombia(digitos_jid(jid))
    return None


def info_contacto_jid(jid: str) -> dict[str, str | bool | None]:
    """Metadatos para el panel Agente WA."""
    jid = str(jid or "").strip()
    if es_jid_cus_falso(jid):
        lid_inf = lid_desde_jid_cus_falso(jid)
        if lid_inf:
            return info_contacto_jid(lid_inf)
    canon = jid_canonico(jid)
    telefono = telefono_desde_jid(jid)
    lid_raw = jid if es_jid_lid(jid) else None
    if not lid_raw:
        aliases = _aliases_seguros()
        for lid, phone in aliases.items():
            if phone == canon or phone == jid:
                lid_raw = lid
                break
    if not lid_raw and es_jid_cus_falso(jid):
        lid_raw = lid_desde_jid_cus_falso(jid)
    es_lid = bool(lid_raw) or es_jid_lid(jid) or (es_jid_lid(canon) and not telefono)
    if telefono:
        display = telefono
    elif es_jid_lid(jid) or es_jid_lid(canon) or lid_raw:
        ref = lid_raw or (jid if es_jid_lid(jid) else canon)
        corto = ref.split("@")[0][-8:]
        display = f"Contacto WA · …{corto}"
    elif es_jid_cus_falso(jid):
        corto = digitos_jid(jid)[-8:]
        display = f"Contacto WA · …{corto}"
    else:
        pref = jid.split("@")[0] if "@" in jid else jid
        display = telefono_desde_jid(jid) or (
            f"Contacto WA · …{pref[-8:]}" if len(pref) > 10 else pref
        )
    return {
        "display": display,
        "telefono": telefono,
        "es_lid": es_lid and not telefono,
        "jid_canon": canon,
        "jid_lid": lid_raw,
    }


def formato_display(jid: str) -> str:
    """Etiqueta legible para el panel (+57 318 243 2463 en lugar de 730…@lid)."""
    return str(info_contacto_jid(jid).get("display") or jid)


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
    aliases = _aliases_seguros()
    lids_en_humano = [j for j in modos.get("numeros_en_humano", []) if es_jid_lid(j)]
    falsos: set[str] = set()
    for lid in lids_en_humano:
        pref = lid.split("@")[0]
        falso = f"{pref}@c.us"
        if falso not in aliases.values() and not es_telefono_jid_valido(falso):
            falsos.add(falso)
        elif es_alias_telefono_falso(lid, falso):
            falsos.add(falso)
    for j in list(modos.get("numeros_en_humano", [])) + list(
        modos.get("numeros_silenciados", [])
    ):
        if es_jid_cus(j) and not es_telefono_jid_valido(j):
            falsos.add(j)
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
