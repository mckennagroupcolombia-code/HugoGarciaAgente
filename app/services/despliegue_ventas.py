# -*- coding: utf-8 -*-
"""Despliegue gradual de ventas tras el cese de actividades (27-sep-2026).

Al levantar el cese solo vuelve a la venta lo que **hoy se puede facturar**: una
publicación MeLi que estaba activa antes del cese se reactiva si su SKU resuelve en
Alegra (código propio activo o alias de venta — misma regla que la facturación,
`canales_producto._facturable`, contra la copia local del catálogo). Fotos viejas o
documentación técnica incompleta no frenan el despliegue; un SKU que no factura sí.

Desde el 5-oct-2026 tampoco vuelve a la venta un combo cuya etiqueta no está aprobada
(«Terminar y aprobar» del editor, app/data/etiquetas_png_aprobados.json), salvo lo que
no lleva etiqueta impresa (`_SIN_ETIQUETA_LINEAS`, o sin diseño y sin etiqueta en la
receta). `sincronizar()` pausa en MeLi lo que deja de cumplir y reactiva lo que vuelve a
cumplir (anotado en meli_pausa_global.json → `pausadas_por_etiqueta`); la aprobación de
una etiqueta la dispara sola (`sincronizar_en_segundo_plano`, desde routes.py).

Estado en ``app/data/despliegue_ventas.json``. Mientras ``"activo": true``:
  - MeLi: la sincronización de stock no reactiva publicaciones fuera de la lista
    (`meli.meli_item_reactivable`). Reactivar a mano desde el panel sigue igual.
  - Web: la tienda solo muestra combos de la lista (website.py lee el archivo).
  - Cotizar/Facturar (ventas directas por WhatsApp) NO se restringe desde el 29-sep-2026:
    se vende cualquier SKU activo en Alegra, también combos sin publicación en MeLi.
  - Diseño de producto (Árbol del producto): cada combo dice si está desplegado.

Ampliar el despliegue = volver a correr ``scripts/desplegar_ventas_facturables.py``
cuando se enlacen más SKUs. Sin LLM.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARCHIVO = REPO / "app" / "data" / "despliegue_ventas.json"
_PAUSA_GLOBAL_JSON = REPO / "app" / "data" / "meli_pausa_global.json"
_RELACION_JSON = REPO / "app" / "data" / "relacion_codigos_cache.json"

_lock = threading.Lock()
_memo: dict = {"mtime": None, "data": {}}

# Líneas de la web cuyos productos no llevan etiqueta impresa (equipos, accesorios, kits):
# no esperan aprobación de etiqueta para venderse.
_SIN_ETIQUETA_LINEAS = {"Equipos y Materiales", "Otros", "Kits"}
# Menos publicaciones que esto en relacion_codigos_cache.json = carga incompleta (hay ~480).
_MIN_RELACION = 400


def _u(s) -> str:
    return str(s or "").strip().upper()


def estado() -> dict:
    """Contenido del archivo, releído solo si cambió en disco."""
    try:
        mtime = ARCHIVO.stat().st_mtime
    except OSError:
        return {}
    with _lock:
        if _memo["mtime"] == mtime:
            return _memo["data"]
        try:
            data = json.loads(ARCHIVO.read_text(encoding="utf-8")) or {}
        except (OSError, ValueError):
            data = {}
        _memo.update({"mtime": mtime, "data": data})
        return data


def activo() -> bool:
    return bool(estado().get("activo"))


def skus_habilitados() -> set[str] | None:
    """SKUs de venta habilitados, o None si no hay despliegue activo (sin restricción)."""
    data = estado()
    if not data.get("activo"):
        return None
    return {_u(k) for k in (data.get("skus") or {})}


def sku_habilitado(sku: str) -> bool:
    permitidos = skus_habilitados()
    return permitidos is None or _u(sku) in permitidos


def meli_ids_habilitados() -> set[str] | None:
    data = estado()
    if not data.get("activo"):
        return None
    return {_u(m) for info in (data.get("skus") or {}).values() for m in (info.get("meli_ids") or [])}


def info_sku(sku: str) -> dict | None:
    """{nombre, meli_ids, desde} si el SKU está desplegado; None si no (o sin despliegue)."""
    data = estado()
    if not data.get("activo"):
        return None
    info = (data.get("skus") or {}).get(_u(sku))
    if info is None:
        return None
    return {**info, "desde": data.get("desde")}


def _leer(ruta: Path) -> dict:
    try:
        return json.loads(ruta.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError):
        return {}


def etiquetas_sin_aprobar() -> dict[str, str]:
    """{SKU_UPPER: nombre} de los combos que llevan etiqueta y no la tienen aprobada.

    Aprobada = el taller de combos encuentra el PNG de «Terminar y aprobar» (registro por
    etiqueta, o el archivo `_digital` de las aprobadas antes de existir el registro)."""
    from app.services import mapa_producto

    out: dict[str, str] = {}
    for c in mapa_producto._datos(refrescar=True).get("combos") or []:
        etq = (c.get("eslabones") or {}).get("etiqueta") or {}
        if etq.get("aprobado_at") or etq.get("png_digital"):
            continue
        if c.get("linea") in _SIN_ETIQUETA_LINEAS:
            continue
        receta_con_etiqueta = ((c.get("eslabones") or {}).get("etiqueta_fisica") or {}).get("estado") == "ok"
        if etq.get("estado") == "falta" and not receta_con_etiqueta:
            continue  # ni diseño ni etiqueta en la receta: es un artículo que no se etiqueta
        out[_u(c.get("ref"))] = c.get("nombre") or ""
    return out


def calcular() -> dict:
    """Qué publicaciones del cese se reactivan y cuáles no (solo lectura, sin llamadas vivas)."""
    from app.services import canales_producto as cp

    pausa = _leer(_PAUSA_GLOBAL_JSON)
    candidatas = [k for k, v in (pausa.get("resultado_pausa") or {}).items() if v == "ok"]
    candidatas += (pausa.get("recuperadas_del_primer_cese") or {}).get("ids") or []
    # Publicaciones creadas después del cese (`registrar_publicacion_nueva`): pasan por las
    # mismas reglas; su SKU va anotado porque la relación de códigos aún no las conoce.
    nuevas = {_u(k): v for k, v in (estado().get("publicadas_despues") or {}).items()}
    candidatas += list(nuevas)
    candidatas = list(dict.fromkeys(_u(x) for x in candidatas if x))

    rel = _leer(_RELACION_JSON)
    por_id = {_u(it.get("meli_id")): it for it in rel.get("items") or []}
    for mid, v in nuevas.items():
        por_id.setdefault(mid, {"meli_id": mid, "sku_meli": v.get("sku"), "titulo": v.get("titulo") or ""})
    alegra = cp._fuente_alegra()
    alias = cp._fuente_alias()
    sin_aprobar = etiquetas_sin_aprobar()

    skus: dict[str, dict] = {}
    excluidas: list[dict] = []
    for mid in candidatas:
        it = por_id.get(mid)
        if not it:
            excluidas.append({"meli_id": mid, "sku": "", "titulo": "", "motivo": "sin SKU en la relación de códigos"})
            continue
        sku = _u(it.get("sku_meli") or it.get("codigo_siigo"))
        fact = cp._facturable(sku, alegra, alias) if sku else {"estado": "no", "alias_destino": ""}
        if fact["estado"] not in ("si", "alias"):
            motivo = "código inactivo en Alegra" if fact["estado"] == "inactivo" else "el SKU no existe en Alegra ni tiene alias"
            excluidas.append({"meli_id": mid, "sku": sku, "titulo": it.get("titulo") or "", "motivo": motivo})
            continue
        if sku in sin_aprobar:
            excluidas.append({"meli_id": mid, "sku": sku, "titulo": it.get("titulo") or "",
                              "motivo": "etiqueta sin aprobar", "por_etiqueta": True})
            continue
        destino = alegra.get(sku) or alegra.get(_u(fact["alias_destino"])) or {}
        info = skus.setdefault(sku, {
            "nombre": destino.get("nombre") or it.get("titulo") or sku,
            "titulo_meli": it.get("titulo") or "",
            "tipo": destino.get("tipo") or "",
            "alias_destino": fact["alias_destino"],
            "meli_ids": [],
        })
        info["meli_ids"].append(mid)
    return {"candidatas": len(candidatas), "skus": skus, "excluidas": excluidas}


def guardar(calculo: dict, *, usuario: str = "") -> dict:
    previo = estado()
    data = {
        "activo": True,
        "desde": previo.get("desde") or datetime.now().isoformat(timespec="seconds"),
        "actualizado": datetime.now().isoformat(timespec="seconds"),
        "actualizado_por": usuario,
        "criterio": "Publicaciones activas antes del cese cuyo SKU se factura hoy en Alegra (código propio activo o alias) y cuya etiqueta está aprobada.",
        "skus": calculo["skus"],
        "excluidas": calculo["excluidas"],
        "publicadas_despues": previo.get("publicadas_despues") or {},
    }
    tmp = str(ARCHIVO) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARCHIVO)
    return data


def registrar_publicacion_nueva(meli_id: str, sku: str, *, titulo: str = "", usuario: str = "") -> dict:
    """Una publicación creada después del cese entra al despliegue (web + reactivación de
    stock) si cumple las mismas reglas que las demás: SKU que se factura y etiqueta aprobada.
    Queda anotada en `publicadas_despues` para que los recálculos (`calcular`) la conserven.

    Evalúa SOLO este SKU y no recalcula la lista: con la relación de códigos a medias
    (timeout de MeLi) un recálculo sacaba decenas de SKUs buenos (5-oct-2026: 193 → 159)."""
    if not activo():
        return {"ok": True, "desplegado": True, "motivo": "sin despliegue activo: no hay restricción"}
    from app.services import canales_producto as cp

    mid, ref = _u(meli_id), _u(sku)
    alegra = cp._fuente_alegra()
    fact = cp._facturable(ref, alegra, cp._fuente_alias())
    motivo = ""
    if fact["estado"] not in ("si", "alias"):
        motivo = "código inactivo en Alegra" if fact["estado"] == "inactivo" else "el SKU no existe en Alegra ni tiene alias"
    elif ref in etiquetas_sin_aprobar():
        motivo = "etiqueta sin aprobar"

    data = dict(estado())
    nuevas = dict(data.get("publicadas_despues") or {})
    nuevas[mid] = {"sku": ref, "titulo": titulo, "desde": datetime.now().isoformat(timespec="seconds"), "por": usuario}
    data["publicadas_despues"] = nuevas
    skus = dict(data.get("skus") or {})
    if not motivo:
        destino = alegra.get(ref) or alegra.get(_u(fact["alias_destino"])) or {}
        info = dict(skus.get(ref) or {"nombre": destino.get("nombre") or titulo or ref, "titulo_meli": titulo,
                                      "tipo": destino.get("tipo") or "", "alias_destino": fact["alias_destino"],
                                      "meli_ids": []})
        info["meli_ids"] = list(dict.fromkeys([*(info.get("meli_ids") or []), mid]))
        skus[ref] = info
        data["skus"] = skus
    data["actualizado"] = datetime.now().isoformat(timespec="seconds")
    data["actualizado_por"] = usuario
    tmp = str(ARCHIVO) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARCHIVO)
    return {"ok": True, "desplegado": not motivo, "motivo": motivo}


def _pausa_mod():
    import importlib.util

    spec = importlib.util.spec_from_file_location("pausa_global_meli", REPO / "scripts" / "pausa_global_meli.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sincronizar(*, usuario: str = "", simular: bool = False) -> dict:
    """Recalcula la lista y alinea MeLi con ella por la etiqueta: pausa las publicaciones
    cuya etiqueta no está aprobada y reactiva las que pausó esta regla y ya cumplen.
    La web no necesita nada: lee la lista en cada petición."""
    if not activo():
        return {"ok": False, "error": "No hay despliegue activo"}
    # Con la relación MeLi ↔ Siigo a medias (timeout de MeLi, o borrada al cambiar un SKU)
    # las publicaciones caen al código de Siigo y la regla pausa/reactiva lo que no es.
    rel = _leer(_RELACION_JSON)
    n_rel = len(rel.get("items") or [])
    if rel.get("error") or n_rel < _MIN_RELACION:
        return {"ok": False, "error": f"Relación de códigos incompleta ({n_rel} publicaciones"
                                      f"{', ' + str(rel.get('error'))[:80] if rel.get('error') else ''}): no se recalcula"}
    calc = calcular()
    pm = _pausa_mod()
    pausa = pm._leer()
    previas = dict(pausa.get("pausadas_por_etiqueta") or {})
    permitidos = {m for v in calc["skus"].values() for m in v["meli_ids"]}
    por_etiqueta = {x["meli_id"] for x in calc["excluidas"] if x.get("por_etiqueta")}
    a_pausar = sorted(por_etiqueta - set(previas))
    a_reactivar = sorted(set(previas) & permitidos)
    resumen = {"ok": True, "pausar": a_pausar, "reactivar": a_reactivar,
               "sin_aprobar": sorted({x["sku"] for x in calc["excluidas"] if x.get("por_etiqueta")})}
    if simular:
        return resumen
    guardar(calc, usuario=usuario)  # la lista queda escrita ANTES de tocar MeLi
    if not a_pausar and not a_reactivar:
        return resumen
    h = pm._headers()
    res_p = pm._cambiar(a_pausar, "paused", h) if a_pausar else {}
    res_r = pm._cambiar(a_reactivar, "active", h) if a_reactivar else {}
    ahora = datetime.now().isoformat(timespec="seconds")
    pausa = pm._leer()
    marcadas = pausa.setdefault("pausadas_por_etiqueta", {})
    for mid, r in res_p.items():
        if r == "ok":
            marcadas[mid] = ahora
    for mid, r in res_r.items():
        if r == "ok":
            marcadas.pop(mid, None)
    pm._guardar(pausa)
    resumen["resultado_pausa"] = res_p
    resumen["resultado_reactivacion"] = res_r
    return resumen


_sync_lock = threading.Lock()
_sync_estado = {"corriendo": False, "pendiente": False}


def sincronizar_en_segundo_plano(usuario: str = "") -> None:
    """Para la aprobación de una etiqueta (dos POST seguidos, impresión y digital): una
    sola corrida a la vez; lo que llegue mientras corre se junta en una más al final."""
    with _sync_lock:
        if _sync_estado["corriendo"]:
            _sync_estado["pendiente"] = True
            return
        _sync_estado["corriendo"] = True

    def _correr():
        while True:
            try:
                r = sincronizar(usuario=usuario)
                if r.get("pausar") or r.get("reactivar"):
                    print(f"[DESPLIEGUE-ETIQUETA] pausadas={r.get('resultado_pausa')} reactivadas={r.get('resultado_reactivacion')}")
            except Exception as exc:  # noqa: BLE001 — un fallo no debe tumbar la aprobación
                print(f"[DESPLIEGUE-ETIQUETA] error: {exc}")
            with _sync_lock:
                if not _sync_estado["pendiente"]:
                    _sync_estado["corriendo"] = False
                    return
                _sync_estado["pendiente"] = False

    from app.observability import spawn_thread

    spawn_thread(_correr)
