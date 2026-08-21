"""Cobertura geográfica real de MercadoLibre (departamento/municipio) — alimenta
la sección "¿A dónde hemos llegado?" del inicio (ver
PAGINA_WEB/site/website.py::_calcular_cobertura()).

No hay forma barata de pedirle esto a MeLi en vivo en cada visita del ticker
(no existe un endpoint agregado; hay que resolver envío por envío vía
`GET /shipments/{id}`), así que se acumula día a día: cada corrida revisa las
órdenes pagadas recientes, y solo consulta el envío de las que aún no se
habían visto. Lo ya contado queda en `app/data/cobertura_meli.json` y nunca se
vuelve a pedir — así el conteo por municipio solo crece hacia adelante desde
que este cron empezó a correr (no hay backfill retroactivo del historial
completo: costaría miles de llamadas a la API de una sola vez).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from app.tools._json_store import atomic_write_json
from app.tools.colombia_geo import resolver_departamento

_ROOT = Path(__file__).resolve().parent.parent.parent  # /home/mckg/mi-agente
COBERTURA_MELI_FILE = _ROOT / "app" / "data" / "cobertura_meli.json"


def _cargar() -> dict:
    try:
        data = json.loads(COBERTURA_MELI_FILE.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    if not isinstance(data.get("municipios"), dict):
        data["municipios"] = {}
    if not isinstance(data.get("shipping_ids_vistos"), list):
        data["shipping_ids_vistos"] = []
    if not isinstance(data.get("envios_por_fecha"), dict):
        data["envios_por_fecha"] = {}
    return data


def _registrar(data: dict, depto: str, municipio: str, fecha: str) -> None:
    key = f"{depto}|{municipio}"
    entry = data["municipios"].setdefault(key, {
        "departamento": depto,
        "municipio": municipio,
        "n_pedidos": 0,
        "primera_vez": fecha,
        "ultima_vez": fecha,
    })
    entry["n_pedidos"] += 1
    if fecha > entry["ultima_vez"]:
        entry["ultima_vez"] = fecha
    if fecha < entry["primera_vez"]:
        entry["primera_vez"] = fecha


def actualizar_cobertura_meli(dias: int = 10, limite: int = 60) -> dict:
    """Revisa órdenes MeLi pagadas de los últimos `dias` días; para cada envío
    que todavía no se había visto, resuelve `GET /shipments/{id}` y —si ya está
    'shipped' o 'delivered'— suma su ciudad/departamento real a la cobertura
    acumulada. Idempotente entre corridas (no vuelve a golpear la API por un
    shipping_id ya contado).

    `dias=10` por defecto (no 1-2): un pedido a una vereda/municipio remoto —
    justo el caso que más nos importa para "cobertura"— tarda más en salir de
    bodega, y si la ventana fuera corta el pedido se sale del filtro
    `date_created` antes de que su envío quede 'shipped' y nunca se cuenta.
    `limite` acota cuántos envíos NUEVOS se consultan por corrida: cada
    `consultar_envio_meli()` refresca el token de MeLi por dentro (sin cache
    propio, ver app/utils.py::refrescar_token_meli), así que un límite alto
    dispara igual de refrescos de token seguidos — se deja bajo a propósito
    para no forzar la rotación del refresh_token.
    """
    from app.services.meli import consultar_envio_meli, listar_ordenes_meli_por_estado

    data = _cargar()
    vistos: set[str] = set(data["shipping_ids_vistos"])

    ordenes = listar_ordenes_meli_por_estado("paid", dias_atras=dias)
    consultados = 0
    resueltos = 0
    sin_resolver = 0
    aun_no_despachados = 0

    # `listar_ordenes_meli_por_estado` viene ordenada date_desc (más nuevas
    # primero) — para este uso conviene al revés: las más viejas del rango son
    # las que ya tuvieron tiempo de salir de bodega, así el límite por corrida
    # rinde en resueltos en vez de gastarse en pedidos recién pagados.
    for orden in reversed(ordenes):
        shipping_id = (orden.get("shipping") or {}).get("id")
        if not shipping_id:
            continue
        shipping_id = str(shipping_id)
        if shipping_id in vistos:
            continue
        if consultados >= limite:
            break
        consultados += 1

        info = consultar_envio_meli(shipping_id)
        if not info:
            continue
        if info.get("status") not in ("shipped", "delivered"):
            # aún no salió de bodega — se reintenta en una corrida futura
            aun_no_despachados += 1
            continue

        vistos.add(shipping_id)
        # fecha real de despacho (no la fecha en que corrió el cron) — para que
        # "despachos esta semana" cuente la semana real, no cuando lo notamos.
        fecha_envio = (info.get("status_history") or {}).get("date_shipped")
        fecha = (fecha_envio or datetime.now().isoformat())[:10]
        data["envios_por_fecha"][fecha] = data["envios_por_fecha"].get(fecha, 0) + 1

        direccion = info.get("receiver_address") or {}
        ciudad = ((direccion.get("city") or {}).get("name") or "").strip()
        estado_nombre = ((direccion.get("state") or {}).get("name") or "").strip()
        depto = resolver_departamento(estado_nombre)
        if depto and ciudad:
            _registrar(data, depto, ciudad, fecha)
            resueltos += 1
        else:
            sin_resolver += 1

    data["shipping_ids_vistos"] = sorted(vistos)
    data["actualizado_en"] = datetime.now().isoformat(timespec="seconds")
    atomic_write_json(COBERTURA_MELI_FILE, data)

    return {
        "ordenes_revisadas": len(ordenes),
        "envios_consultados": consultados,
        "resueltos": resueltos,
        "sin_resolver": sin_resolver,
        "aun_no_despachados": aun_no_despachados,
        "total_municipios_acumulados": len(data["municipios"]),
    }
