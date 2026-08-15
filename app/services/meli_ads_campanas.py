"""
Plan de migración de la campaña única de Product Ads a 3 campañas separadas
por rotación de ventas — Alta / Media / Baja — y, una vez el operador las
crea manualmente en Mercado Ads (API de escritura bloqueada para esta cuenta,
ver app/services/meli_ads.py), alertas cuando un producto ya no está en la
campaña que le corresponde según su rotación actual.

Por qué por rotación y no por marca propia/ajena (decisión ago-2026, revertida
del diseño original): lo que predice si un producto aguanta más o menos ACOS
es cuánto rota, no si es catálogo McKenna o reventa de terceros — un producto
de marca ajena con alta rotación puede sostener más ACOS que uno propio que
casi no se vende. La marca sigue disponible por producto (para la comparación
propio/ajena del panel), pero ya no decide en qué campaña va.

Los umbrales de rotación son los MISMOS que usa el motor de recomendaciones
(NIVELES_ACOS en meli_ads_recomendaciones.py) — una sola fuente de verdad
para "qué tan agresivo puede ser el ACOS de este producto", en vez de tener
dos reglas de negocio distintas que se puedan desalinear con el tiempo.
"sin_ventas" se pliega dentro de "baja" para la agrupación de campañas (no
tiene sentido una cuarta campaña solo para productos sin ninguna venta — esos
son candidatos a pausar vía el motor de recomendaciones, no a pautar aparte).

Cadencia de revisión: cada 15 días (ver JOBS["publicidad_recomendaciones"] en
app/services/cron_scheduler.py) — la rotación se mide sobre una ventana de 30
días, así que revisarla más seguido no aporta señal nueva; 15 días balancea
"reaccionar rápido a un producto que despegó" con "no pedirle al operador que
mueva productos entre campañas todas las semanas".
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Literal

from app.services.meli_ads import listar_items_publicidad_completo
from app.services.meli_ads_margenes import obtener_margenes_reales
from app.services.meli_ads_recomendaciones import NIVELES_ACOS
from app.sync import obtener_ventas_meli_por_item

Grupo = Literal["alta", "media", "baja"]

_NOMBRE_GRUPO: dict[Grupo, str] = {
    "alta": "Alta rotación",
    "media": "Media rotación",
    "baja": "Baja rotación",
}
_DESCRIPCION_GRUPO: dict[Grupo, str] = {
    "alta": "Motor de ventas del negocio — tolera más ACOS porque el volumen compensa.",
    "media": "Rotación intermedia — objetivo de ACOS moderado.",
    "baja": "Rotación baja o sin ventas en el período — sin colchón para subsidiar ACOS alto.",
}

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "publicidad_campanas_config.json")
_CONFIG_PATH = os.path.normpath(_CONFIG_PATH)


def _nivel_rotacion(item_id: str, ventas_por_item: dict) -> tuple[Grupo, bool]:
    """Devuelve (grupo, tiene_dato). Sin dato o 'sin_ventas' → 'baja' (conservador)."""
    info = ventas_por_item.get(item_id)
    if not info:
        return "baja", False
    nivel = info.get("nivel") or "baja"
    if nivel == "alta":
        return "alta", True
    if nivel == "media":
        return "media", True
    return "baja", True  # "baja" o "sin_ventas"


def _items_con_grupo(dias: int, refresh: bool) -> list[dict]:
    completo = listar_items_publicidad_completo(dias=dias, refresh=refresh)
    ventas = obtener_ventas_meli_por_item(dias=dias, refresh=False)
    ventas_por_item: dict[str, Any] = ventas.get("por_item") or {}
    margenes = obtener_margenes_reales(dias=dias, refresh=False)
    margen_por_item: dict[str, dict] = {m["item_id"]: m for m in margenes.get("con_margen") or []}

    out = []
    for item in completo["items"]:
        grupo, tiene_dato = _nivel_rotacion(item["item_id"], ventas_por_item)
        margen = margen_por_item.get(item["item_id"])
        out.append({
            **item,
            "nivel_rotacion": grupo,
            "rotacion_con_dato": tiene_dato,
            "grupo_recomendado": grupo,
            "margen_real": bool(margen),
            "acos_objetivo_real": margen["acos_objetivo_pct"] if margen else None,
        })
    return out


def _acos_target_grupo(g: Grupo, lista: list[dict]) -> tuple[float, int]:
    """Objetivo ACOS del grupo: promedio ponderado por gasto de los ACOS objetivo reales
    donde hay margen calculado; si ningún producto del grupo tiene margen real, cae al
    valor fijo por rotación (NIVELES_ACOS — la misma tabla del motor de recomendaciones)."""
    con_margen = [it for it in lista if it["margen_real"]]
    peso_total = sum(it["costo"] for it in con_margen)
    if not con_margen or peso_total <= 0:
        return NIVELES_ACOS[g]["objetivo"], 0
    promedio = sum(it["acos_objetivo_real"] * it["costo"] for it in con_margen) / peso_total
    return round(promedio, 1), len(con_margen)


def plan_migracion_3_campanas(dias: int = 30, refresh: bool = False) -> dict:
    """Reparto propuesto del catálogo pautado en 3 campañas por rotación, con parámetros sugeridos."""
    items = _items_con_grupo(dias, refresh)

    grupos: dict[Grupo, list[dict]] = {"alta": [], "media": [], "baja": []}
    for it in items:
        grupos[it["grupo_recomendado"]].append(it)

    resultado = {"dias": dias, "generado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "grupos": {}}
    for g in ("alta", "media", "baja"):
        lista = sorted(grupos[g], key=lambda it: -it["costo"])
        costo = sum(it["costo"] for it in lista)
        ventas = sum(it["ventas"] for it in lista)
        acos_target, n_con_margen = _acos_target_grupo(g, lista)
        resultado["grupos"][g] = {
            "nombre": _NOMBRE_GRUPO[g],
            "descripcion": _DESCRIPCION_GRUPO[g],
            "acos_target_sugerido": acos_target,
            "acos_target_fuente": (
                f"margen real ({n_con_margen} de {len(lista)} productos)"
                if n_con_margen else "rotación (sin margen real en el grupo todavía)"
            ),
            "presupuesto_diario_sugerido": max(5000.0, round(costo / dias / 1000) * 1000),
            "count": len(lista),
            "con_margen_real": n_con_margen,
            "costo_30d": costo,
            "ventas_30d": ventas,
            "acos_actual": round(costo / ventas * 100, 1) if ventas else None,
            "items": lista,
        }
    return resultado


# ── Config: qué campaign_id real de MeLi corresponde a cada grupo ──────────

def leer_config_grupos() -> dict:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "mapa" in data and "marca_ajena" not in data.get("mapa", {}):
            return data
    except Exception:
        pass
    return {"mapa": {"alta": None, "media": None, "baja": None}, "actualizado_en": None}


def guardar_config_grupos(mapa: dict) -> dict:
    limpio = {
        "alta": int(mapa["alta"]) if mapa.get("alta") else None,
        "media": int(mapa["media"]) if mapa.get("media") else None,
        "baja": int(mapa["baja"]) if mapa.get("baja") else None,
    }
    out = {"mapa": limpio, "actualizado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")}
    os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


# ── Alertas: 3 tipos de ajuste sobre las campañas reales ────────────────────

_VENTANA_MUERTO_DIAS = 90  # ventana para "sin ninguna venta reciente" — más larga que los 30d de ACOS/rotación


def calcular_alertas_reasignacion(dias: int = 30, refresh: bool = False) -> dict:
    """
    Una vez configurado el mapa grupo → campaign_id real, revisa 3 cosas
    contra el estado real de MeLi (campaign_id de cada producto):

    1. reasignar: está en una de las 3 campañas pero su rotación actual lo
       ubica en otra (revisión pensada cada 15 días).
    2. pausar_de_campana: ya está en una de las 3 campañas pero no tiene
       NINGUNA venta en los últimos 90 días — no debería estar pautado en
       ninguna campaña, hay que pausarlo directamente en MeLi.
    3. migrar_a_campana: tiene ventas reales en 90 días pero todavía no está
       en ninguna de las 3 campañas (sigue en la campaña vieja pausada o sin
       campaña) — falta migrarlo.
    """
    config = leer_config_grupos()
    mapa = config.get("mapa") or {}
    if not any(mapa.values()):
        return {"configurado": False, "reasignar": [], "pausar_de_campana": [], "migrar_a_campana": []}

    campaign_id_a_grupo: dict[int, Grupo] = {}
    for grupo, cid in mapa.items():
        if cid:
            campaign_id_a_grupo[int(cid)] = grupo  # type: ignore[assignment]

    items = _items_con_grupo(dias, refresh)
    ventas_90d = obtener_ventas_meli_por_item(dias=_VENTANA_MUERTO_DIAS, refresh=False)
    ventas_90d_por_item: dict[str, Any] = ventas_90d.get("por_item") or {}

    reasignar, pausar_de_campana, migrar_a_campana = [], [], []
    for it in items:
        cid = it.get("campaign_id")
        uds_90d = (ventas_90d_por_item.get(it["item_id"]) or {}).get("unidades", 0)
        en_campana_nueva = cid is not None and int(cid) in campaign_id_a_grupo

        if en_campana_nueva:
            grupo_actual = campaign_id_a_grupo[int(cid)]  # type: ignore[index]
            if uds_90d == 0 and it["costo"] > 0:
                pausar_de_campana.append({
                    **it,
                    "grupo_actual": grupo_actual,
                    "grupo_actual_nombre": _NOMBRE_GRUPO[grupo_actual],
                    "motivo": (
                        f"Está en '{_NOMBRE_GRUPO[grupo_actual]}' gastando ads pero sin ninguna venta en "
                        f"{_VENTANA_MUERTO_DIAS} días — pausar directamente, no reasignar de campaña."
                    ),
                })
            elif grupo_actual != it["grupo_recomendado"]:
                reasignar.append({
                    **it,
                    "grupo_actual": grupo_actual,
                    "grupo_actual_nombre": _NOMBRE_GRUPO[grupo_actual],
                    "grupo_recomendado_nombre": _NOMBRE_GRUPO[it["grupo_recomendado"]],
                    "motivo": (
                        f"Está en la campaña '{_NOMBRE_GRUPO[grupo_actual]}' pero su rotación actual "
                        f"lo ubica en '{_NOMBRE_GRUPO[it['grupo_recomendado']]}'."
                    ),
                })
        elif uds_90d > 0 and it["costo"] > 0:
            migrar_a_campana.append({
                **it,
                "grupo_recomendado_nombre": _NOMBRE_GRUPO[it["grupo_recomendado"]],
                "motivo": (
                    f"Tiene {uds_90d} unidades vendidas en {_VENTANA_MUERTO_DIAS} días pero sigue fuera de las "
                    f"3 campañas nuevas — falta moverlo a '{_NOMBRE_GRUPO[it['grupo_recomendado']]}'."
                ),
            })

    reasignar.sort(key=lambda a: -a["costo"])
    pausar_de_campana.sort(key=lambda a: -a["costo"])
    migrar_a_campana.sort(key=lambda a: -a["costo"])

    return {
        "configurado": True,
        "reasignar": reasignar,
        "pausar_de_campana": pausar_de_campana,
        "migrar_a_campana": migrar_a_campana,
        "count": len(reasignar) + len(pausar_de_campana) + len(migrar_a_campana),
    }
