"""
Tarifas DDP puerta a puerta China-Colombia — aliado logístico China Latin Agent.

Fuente de datos: app/data/aliados_logisticos.json (aliado id "china-latin-agent"),
vía app/services/aliados_logisticos.py — mismo master file que lista todos los
aliados de importación (DDP y ordinaria) para el panel Importaciones.

Consumidor: app/routes_importaciones.py (panel Importaciones del /app).
"""

from __future__ import annotations

_ALIADO_ID = "china-latin-agent"


def _datos() -> dict:
    from app.services.aliados_logisticos import obtener_aliado
    return obtener_aliado(_ALIADO_ID) or {}


def _courier_usd_por_kg_promedio() -> float:
    courier = _datos().get("modos", {}).get("courier", {})
    valores = []
    for prov in courier.get("proveedores", {}).values():
        valores.append(prov.get("usd_por_kg_min", 0))
        valores.append(prov.get("usd_por_kg_max", 0))
    return round(sum(valores) / len(valores), 2) if valores else 0.0


def modo_recomendado(kg: float | None = None, cbm: float | None = None) -> str | None:
    """Modo sugerido según lo que haya de carga. Si hay kg y cbm a la vez, se compara costo."""
    candidatos = []
    if cbm is not None and cbm > 0:
        candidatos.append("maritimo")
    if kg is not None and kg > 0:
        candidatos.append("courier" if kg < 50 else "aereo")
    if not candidatos:
        return None
    if len(candidatos) == 1:
        return candidatos[0]
    costos = {m: tarifa_modo(m, cbm if m == "maritimo" else kg) for m in candidatos}
    return min(costos, key=costos.get)


def tarifa_modo(modo: str, cantidad: float) -> float:
    """Costo de transporte (USD) para `cantidad` (cbm si modo=maritimo, kg si aereo/courier)."""
    modos = _datos().get("modos", {})
    if modo == "courier":
        return round(_courier_usd_por_kg_promedio() * cantidad, 2)
    m = modos.get(modo)
    if not m:
        return 0.0
    for tier in m.get("tiers", []):
        if tier["hasta"] is None or cantidad <= tier["hasta"]:
            return round(tier["usd_por_unidad"] * cantidad, 2)
    return 0.0


def estimar_aranceles(valor_fob_usd: float) -> dict:
    """Bucket de arancel/IVA estimado según valor FOB (USD)."""
    for bucket in _datos().get("aranceles_estimados", []):
        desde = bucket.get("fob_usd_desde", 0)
        hasta = bucket.get("fob_usd_hasta")
        if valor_fob_usd >= desde and (hasta is None or valor_fob_usd <= hasta):
            return bucket
    return {}


def cotizar_importacion(
    kg: float | None = None,
    cbm: float | None = None,
    valor_fob_usd: float | None = None,
    modo: str | None = None,
) -> dict:
    """Cotización estimada DDP: modo, costo de transporte, tiempos, arancel estimado y advertencias."""
    data = _datos()
    modo_final = modo or modo_recomendado(kg=kg, cbm=cbm)
    if not modo_final:
        raise ValueError("Se necesita al menos peso (kg) o volumen (cbm) para cotizar.")

    cantidad = cbm if modo_final == "maritimo" else kg
    if cantidad is None:
        raise ValueError(f"Falta la cantidad ({'cbm' if modo_final == 'maritimo' else 'kg'}) para el modo {modo_final}.")

    costo_transporte_usd = tarifa_modo(modo_final, cantidad)
    modo_info = data.get("modos", {}).get(modo_final, {})
    dias_transito = modo_info.get("dias_transito", [None, None])

    arancel = estimar_aranceles(valor_fob_usd) if valor_fob_usd is not None else None

    advertencias = []
    if data.get("aplicabilidad_materia_prima_farmaceutica_cosmetica") == "pendiente_confirmar":
        advertencias.append(
            "Aplicabilidad a materia prima farmacéutica/cosmética aún no confirmada con el aliado — "
            "su página excluye ese tipo de carga por defecto."
        )
    minimo = modo_info.get("minimo")
    if minimo is not None and cantidad < minimo:
        unidad = modo_info.get("unidad", "unidad")
        advertencias.append(f"Cantidad ({cantidad} {unidad}) por debajo del mínimo del aliado ({minimo} {unidad}).")

    return {
        "modo": modo_final,
        "modo_nombre": modo_info.get("nombre", modo_final),
        "cantidad": cantidad,
        "unidad": modo_info.get("unidad", "kg" if modo_final != "maritimo" else "cbm"),
        "costo_transporte_usd": costo_transporte_usd,
        "dias_transito_min": dias_transito[0] if dias_transito else None,
        "dias_transito_max": dias_transito[1] if len(dias_transito) > 1 else None,
        "arancel_estimado": arancel,
        "advertencias": advertencias,
    }
