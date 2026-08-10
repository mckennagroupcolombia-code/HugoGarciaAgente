"""Regresión: hilos postventa viejos ya respondidos no deben resucitar.

Caso real (jul 2026, pack …785): el comprador escribió UN mensaje nuevo y el
webhook alertó 4 — tres eran mensajes de enero 2025 que el vendedor ya había
respondido en MeLi (la reconciliación solo corría en modo polling). Además,
tras una auto-respuesta FT/COA el pack salía de la cola y el código corto
dejaba de resolver para respuesta manual.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import app.meli_postventa_notif as notif


PACK = "2000007044713785"
SELLER = "432439187"


def _msg(mid, from_id, texto, fecha):
    return {
        "id": mid,
        "from": {"user_id": from_id},
        "text": texto,
        "message_date": {"created": fecha},
    }


def _fake_get(url, headers=None, timeout=None):
    res = MagicMock()
    if f"/messages/packs/{PACK}/" in url:
        res.status_code = 200
        res.json.return_value = {
            "conversation_status": {"status": "active"},
            "messages": [
                # Hilo viejo: pregunta del comprador YA respondida por el vendedor
                _msg("m-viejo", "80229157",
                     "Si utilizo el de ricino , cual sería la proporcion?",
                     "2025-01-23T15:39:00.000Z"),
                _msg("m-resp-vendedor", SELLER,
                     "Mezclar con aceites más ligeros (proporción 1:1).",
                     "2025-01-23T23:21:00.000Z"),
                # Mensaje realmente nuevo, sin respuesta posterior
                _msg("m-nuevo", "80229157",
                     "Muy buenas tardes, no la tienen en presentación pequeña?",
                     "2026-07-18T19:55:00.000Z"),
            ],
        }
    else:
        res.status_code = 404
        res.json.return_value = {}
    return res


def test_mensaje_viejo_respondido_no_alerta_y_nuevo_si(monkeypatch):
    alertas = []
    estado = {"pendientes": {}, "procesados": []}

    monkeypatch.setattr(notif, "refrescar_token_meli", lambda: "tok")
    monkeypatch.setattr(notif, "obtener_seller_id_meli", lambda: SELLER)
    monkeypatch.setattr(notif._requests_lib, "get", _fake_get)
    monkeypatch.setattr(notif, "jid_grupo_postventa_wa", lambda: "grupo@g.us")
    monkeypatch.setattr(
        notif, "enviar_whatsapp_reporte",
        lambda texto, numero_destino=None: alertas.append(texto) or True,
    )
    monkeypatch.setattr(notif, "_cargar_state_posventa", lambda: estado)
    monkeypatch.setattr(notif, "_guardar_state_posventa", lambda d: estado.update(d))
    monkeypatch.setattr(
        notif, "_detalle_venta_orden", lambda pack, h: ("", "", "", "", [])
    )
    import app.monitor as monitor
    monkeypatch.setattr(monitor, "incrementar_metrica", lambda *a, **k: None)

    notif.procesar_postventa_meli_desde_webhook(
        f"/messages/packs/{PACK}/sellers/{SELLER}"
    )

    # Solo el mensaje nuevo alerta; el viejo ya respondido queda procesado en silencio
    assert len(alertas) == 1, alertas
    assert "presentación pequeña" in alertas[0]
    assert "m-viejo" in estado["procesados"]
    assert "m-nuevo" in estado["procesados"]
    # La alerta ofrece las dos sintaxis de respuesta manual
    assert "posventa 785:" in alertas[0]
    assert "resp 785:" in alertas[0]
    # El pack queda direccionable para posventa/resp <código>
    assert estado["pendientes"].get(PACK, {}).get("codigo") == "785"


def test_alerta_incluye_sugerencia_ia_para_aprobar(monkeypatch):
    """Autocompletado: si hay base (ficha/presentaciones), la alerta trae el
    borrador y las opciones 'hugo dale ok <código>' / 'resp <código>: ...'."""
    alertas = []
    estado = {"pendientes": {}, "procesados": []}

    monkeypatch.setattr(notif, "refrescar_token_meli", lambda: "tok")
    monkeypatch.setattr(notif, "obtener_seller_id_meli", lambda: SELLER)
    monkeypatch.setattr(notif._requests_lib, "get", _fake_get)
    monkeypatch.setattr(notif, "jid_grupo_postventa_wa", lambda: "grupo@g.us")
    monkeypatch.setattr(
        notif, "enviar_whatsapp_reporte",
        lambda texto, numero_destino=None: alertas.append(texto) or True,
    )
    monkeypatch.setattr(notif, "_cargar_state_posventa", lambda: estado)
    monkeypatch.setattr(notif, "_guardar_state_posventa", lambda d: estado.update(d))
    monkeypatch.setattr(
        notif, "_detalle_venta_orden",
        lambda pack, h: ("  • Manteca Karite x1", "", "", "",
                         [{"nombre": "Manteca Karite 500 Gr + Envío"}]),
    )
    monkeypatch.setattr(
        notif, "_sugerencia_ia_postventa",
        lambda *a, **k: "Cordial saludo veci, la blanca es refinada y la amarilla sin refinar…",
    )
    import app.monitor as monitor
    monkeypatch.setattr(monitor, "incrementar_metrica", lambda *a, **k: None)

    notif.procesar_postventa_meli_desde_webhook(
        f"/messages/packs/{PACK}/sellers/{SELLER}"
    )

    assert len(alertas) == 1
    assert "Sugerencia de respuesta" in alertas[0]
    assert f"hugo dale ok 785" in alertas[0]
    assert "resp 785:" in alertas[0]
    # El borrador queda persistido para que "hugo dale ok" (proceso 8081) lo lea
    assert "refinada" in estado["pendientes"][PACK]["sugerencia_ia"]


def test_sugerencia_omite_adjuntos_y_sin_producto():
    assert notif._sugerencia_ia_postventa(
        [{"nombre": "X"}], "[Solo adjunto(s) en MeLi: RUT.pdf] …", [], SELLER
    ) == ""
    assert notif._sugerencia_ia_postventa([], "¿me pasa la ficha?", [], SELLER) == ""
