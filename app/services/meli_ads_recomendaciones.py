"""
Motor de recomendaciones de publicidad MeLi — pondera el ACOS de cada
producto pautado por su nivel de rotación real (no solo por lo vendido a
través del anuncio), para no exigirle el mismo ACOS a un producto de alta
rotación que a uno que casi no se vende.

Por qué existe: MeLi no expone control por producto vía API (confirmado
ago-2026 — se probaron endpoints de pausa/bid/exclusión por item, todos 404).
Solo se puede pausar/ajustar la campaña completa desde el panel web de
Mercado Ads. Este motor no puede "corregir" nada solo — calcula qué haría
falta corregir y se lo entrega al operador como una lista accionable
(WhatsApp + ticket en Centro de Mando, ver scripts/publicidad_recomendaciones_cron.py),
con el link directo a cada publicación para que el pausado manual tome
segundos por producto.

Regla de negocio (documentada para que un humano pueda auditarla, no es una
caja negra): cada nivel de rotación tiene un ACOS "objetivo" (a partir de ahí
se recomienda revisar) y uno de "pausar" (a partir de ahí se recomienda
pausar el anuncio). Un producto de rotación alta puede sostener más ACOS
porque es motor de ventas del negocio; uno de rotación baja o sin ventas no
tiene ese colchón — no vale la pena subsidiarle publicidad.

Desde ago-2026 (una vez resuelto el cruce por seller_custom_field, ver
app/services/meli_ads_margenes.py), cuando hay margen real conocido para un
producto se usa ESE límite en vez del de rotación — es más preciso porque
viene del costo real del combo, no de una regla genérica. La rotación sigue
siendo el criterio para el resto del catálogo sin margen calculado todavía.

Dos situaciones distintas de "ya no está activo" (confirmado ago-2026, tras
que el operador reportara ~91 "desalineados"/78 "pausar" con la gran mayoría
ya resueltos y ~56 de una campaña que ni existe ensuciando el listado):

1. Anuncio pausado/idle/hold DENTRO de una campaña que sigue vigente (ej. el
   operador ya lo pausó manualmente en Mercado Ads): SÍ se muestra, marcado
   con `activo_en_meli=False` y ordenado al final de su lista (lo que sigue
   `active` y de verdad necesita un clic va primero) — el operador pidió
   verlo así en vez de tener que ir a chequear uno por uno.
2. Anuncio cuyo `campaign_id` NO aparece en la respuesta actual de
   /campaigns/search (campaña vieja/eliminada, ej. 298663966): se EXCLUYE
   del todo (`resumen.campana_inexistente`) — no hay ningún lugar real en
   Mercado Ads donde ir a verificarlo, mantenerlo en la lista es puro ruido.
   Confirmado en vivo: el 100% de estos casos ya estaban idle/hold de
   cualquier forma, nunca "active".

`resumen.no_activos` cuenta solo el caso 1 (visible, marcado) — no incluye
el caso 2 (excluido).
"""

from datetime import datetime
from typing import Any

from app.services.meli_ads import listar_items_publicidad_completo
from app.services.meli_ads_margenes import obtener_margenes_reales
from app.sync import obtener_ventas_meli_por_item

# ACOS objetivo/pausar por nivel de rotación (ventas reales en MeLi en el
# mismo período, no solo lo vendido vía anuncio — ver app.sync.obtener_ventas_meli_por_item).
NIVELES_ACOS = {
    "alta": {"objetivo": 50.0, "pausar": 90.0},
    "media": {"objetivo": 40.0, "pausar": 70.0},
    "baja": {"objetivo": 25.0, "pausar": 55.0},
    "sin_ventas": {"objetivo": 15.0, "pausar": 40.0},
}
_NIVEL_DEFECTO = "baja"  # sin dato de rotación → conservador, no darle el beneficio de "alta"

# Por debajo de este gasto, un producto en cero ventas se marca "revisar" en
# vez de "pausar" — no vale la pena una acción manual por unos pocos pesos.
_UMBRAL_RUIDO_COP = 15_000.0


def _nivel_rotacion(item_id: str, ventas_por_item: dict) -> tuple[str, bool]:
    """Devuelve (nivel, tiene_dato). Sin dato → nivel por defecto conservador."""
    info = ventas_por_item.get(item_id)
    if not info:
        return _NIVEL_DEFECTO, False
    nivel = info.get("nivel") or _NIVEL_DEFECTO
    if nivel not in NIVELES_ACOS:
        nivel = _NIVEL_DEFECTO
    return nivel, True


def _evaluar_item(item: dict, nivel: str, margen: dict | None) -> tuple[str, str] | None:
    """Devuelve (accion, motivo) o None si el producto está saludable ('ok')."""
    costo = item["costo"]
    unidades = item["unidades"]
    acos = item["acos"]

    if unidades == 0:
        if costo >= _UMBRAL_RUIDO_COP:
            return "pausar", f"Cero ventas por ads con ${costo:,.0f} COP gastados — sin ningún retorno."
        return "revisar", f"Cero ventas por ads, gasto menor (${costo:,.0f} COP) — vigilar, no urge pausar."

    if margen:
        limite_pausar = margen["acos_equilibrio_pct"]
        limite_objetivo = margen["acos_objetivo_pct"]
        origen = f"margen real (costo combo ${margen['costo_combo']:,.0f}, margen neto {margen['margen_neto_pct']:.1f}%)"
    else:
        l = NIVELES_ACOS[nivel]
        limite_pausar, limite_objetivo = l["pausar"], l["objetivo"]
        origen = f"rotación '{nivel}' (sin margen real calculado aún)"

    if acos > limite_pausar:
        return (
            "pausar",
            f"ACOS {acos:.1f}% supera el punto de equilibrio ({limite_pausar:.1f}%) — {origen}. "
            + ("Pérdida neta confirmada con el costo real." if margen else "Pérdida bruta estimada por rotación."),
        )
    if acos > limite_objetivo:
        return (
            "revisar",
            f"ACOS {acos:.1f}% supera el objetivo ({limite_objetivo:.1f}%) pero no el punto de equilibrio "
            f"({limite_pausar:.1f}%) — {origen}.",
        )
    return None


def calcular_recomendaciones_publicidad(dias: int = 30, refresh: bool = False) -> dict:
    """
    Cruza el gasto/ACOS por producto en Product Ads (app.services.meli_ads)
    con la rotación real de ventas en MeLi (app.sync.obtener_ventas_meli_por_item)
    y devuelve una lista accionable de qué pausar y qué revisar.
    """
    completo = listar_items_publicidad_completo(dias=dias, refresh=refresh)
    ventas = obtener_ventas_meli_por_item(dias=dias, refresh=False)
    ventas_por_item: dict[str, Any] = ventas.get("por_item") or {}

    margenes = obtener_margenes_reales(dias=dias, refresh=False)
    margen_por_item: dict[str, dict] = {m["item_id"]: m for m in margenes.get("con_margen") or []}

    # Campañas vigentes según la última respuesta de /campaigns/search —
    # confirmado ago-2026: ~56 anuncios traían `campaign_id` de una campaña
    # que YA NO figura ahí (ej. 298663966) y aun así aparecían en
    # pausar/revisar con gasto histórico dentro de la ventana. A diferencia
    # de un anuncio pausado DENTRO de una campaña vigente (ver
    # `activo_en_meli` más abajo — ese sí se muestra, marcado), uno de una
    # campaña que ya no existe no tiene ningún lugar real donde ir a
    # verificarlo — se excluye del todo, no solo se marca.
    campanas_vigentes = {c["id"] for c in completo["campanas"] if c.get("id") is not None}

    pausar: list[dict] = []
    revisar: list[dict] = []
    ok_count = 0
    sin_dato_count = 0
    con_margen_real_count = 0
    no_activo_count = 0
    campana_inexistente_count = 0

    for item in completo["items"]:
        if item["costo"] <= 0:
            continue  # sin gasto en el período, no hay nada que recomendar
        if item.get("campaign_id") not in campanas_vigentes:
            campana_inexistente_count += 1
            continue
        # No se excluyen los que ya no están "active" en MeLi pero SÍ siguen
        # en una campaña vigente (idle/hold/paused) — el operador pidió
        # verlos igual en la lista, con el estado real marcado, para no
        # tener que ir a revisar uno por uno en Mercado Ads.
        activo_en_meli = item.get("status") == "active"
        nivel, tiene_dato = _nivel_rotacion(item["item_id"], ventas_por_item)
        if not tiene_dato:
            sin_dato_count += 1
        margen = margen_por_item.get(item["item_id"])
        if margen:
            con_margen_real_count += 1
        veredicto = _evaluar_item(item, nivel, margen)
        if veredicto is None:
            ok_count += 1
            continue
        accion, motivo = veredicto
        if not activo_en_meli:
            no_activo_count += 1
        fila = {
            **item,
            "nivel_rotacion": nivel,
            "rotacion_con_dato": tiene_dato,
            "margen_real": bool(margen),
            "motivo": motivo,
            "activo_en_meli": activo_en_meli,
        }
        (pausar if accion == "pausar" else revisar).append(fila)

    # Dentro de cada lista, lo que SÍ sigue activo (necesita que lo pauses)
    # va primero — lo que ya está pausado/idle/hold queda visible pero al
    # final, no compite por atención con lo que de verdad requiere un clic.
    pausar.sort(key=lambda f: (f["activo_en_meli"] is False, -f["costo"]))
    revisar.sort(key=lambda f: (f["activo_en_meli"] is False, -f["costo"]))

    return {
        "generado_en": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "dias": dias,
        "campanas": completo["campanas"],
        "resumen": {
            "pausar": len(pausar),
            "revisar": len(revisar),
            "ok": ok_count,
            "sin_dato_rotacion": sin_dato_count,
            "con_margen_real": con_margen_real_count,
            "no_activos": no_activo_count,
            "campana_inexistente": campana_inexistente_count,
            "costo_pausar": sum(f["costo"] for f in pausar),
            "costo_revisar": sum(f["costo"] for f in revisar),
        },
        "pausar": pausar,
        "revisar": revisar,
    }
