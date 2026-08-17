"""Estadísticas de postventa: clasificación y agregados locales (sin MeLi)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services import postventa_stats as ps

_CO = timezone(timedelta(hours=-5))


def _isolate(monkeypatch, tmp_path: Path) -> None:
    db = tmp_path / "postventa_stats.db"
    state = tmp_path / "pendientes.json"
    state.write_text(
        json.dumps({"pendientes": {}, "procesados": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(ps, "DB_PATH", str(db))
    monkeypatch.setattr(ps, "_POSVENTA_STATE_PATH", str(state))
    monkeypatch.setattr(ps, "_DB_READY", False)
    monkeypatch.setattr(ps, "_sync_reclamos_meli", lambda: None)
    monkeypatch.setattr(ps, "_sembrar_reclamos_desde_tickets", lambda: None)
    monkeypatch.setattr(ps, "_MELI_SYNC_CACHE", {"ts": 10**12, "ok": False})


def test_clasificar_solicitud_factura_envio_documentos() -> None:
    assert ps.clasificar_solicitud("Me puede enviar la factura y el RUT")[0] == "factura"
    assert ps.clasificar_solicitud("¿Dónde está la guía de envío?")[0] == "envio"
    assert ps.clasificar_solicitud("Me pasa la ficha técnica y el COA")[0] == "documentos"
    assert ps.clasificar_solicitud("El frasco llegó dañado y faltante")[0] == "producto"
    assert ps.clasificar_solicitud("Quiero cancelar y pedir reembolso")[0] == "cancelacion"
    assert ps.clasificar_solicitud("¿Cómo se usa y cuál es la dosis?")[0] == "uso"
    assert ps.clasificar_solicitud("[Solo adjunto: rut.pdf]")[0] == "adjunto"
    assert ps.clasificar_solicitud("Hola, gracias")[0] == "otro"


def test_clasificar_solicitud_no_confunde_fruta_con_rut() -> None:
    tid, _ = ps.clasificar_solicitud("sirve para mascarilla de fruta")
    assert tid != "factura"


def test_clasificar_motivo_reclamo_por_reason_id() -> None:
    assert ps.clasificar_motivo_reclamo("PNR4011", "mediations")[0] == "no_recibido"
    assert ps.clasificar_motivo_reclamo("PDD9997", None)[0] == "defectuoso"
    assert ps.clasificar_motivo_reclamo("", "returns")[0] == "devolucion"
    assert ps.clasificar_motivo_reclamo("", "cancellations")[0] == "cancelacion"


def test_estadisticas_tiempos_solicitudes_y_reclamos(monkeypatch, tmp_path: Path) -> None:
    _isolate(monkeypatch, tmp_path)
    t0 = datetime(2026, 8, 16, 10, 0, tzinfo=_CO)
    t1 = t0 + timedelta(minutes=20)

    ps.registrar_mensaje_recibido(
        {
            "msg_id": "m1",
            "pack_id": "2001",
            "codigo": "001",
            "texto": "Necesito la factura electrónica",
            "timestamp": t0.isoformat(),
        }
    )
    ps.marcar_mensaje_cerrado(
        {"msg_id": "m1", "pack_id": "2001", "texto": "Necesito la factura electrónica"},
        via="panel",
        cerrado_en=t1.isoformat(),
    )
    ps.registrar_mensaje_recibido(
        {
            "msg_id": "m2",
            "pack_id": "2002",
            "codigo": "002",
            "texto": "¿Cuándo llega el paquete, hay guía?",
            "timestamp": t0.isoformat(),
        }
    )
    ps.registrar_reclamo(
        claim_id="998877",
        payload={
            "reason_id": "PNRP2019",
            "type": "mediations",
            "status": "opened",
            "date_created": t0.isoformat(),
        },
    )

    stats = ps.calcular_estadisticas(dias=30, sync_meli=False)
    assert stats["solicitudes_total"] >= 2
    ids = {s["id"] for s in stats["solicitudes"]}
    assert "factura" in ids
    assert "envio" in ids
    assert stats["tiempos"]["respondidos"] == 1
    assert stats["tiempos"]["mediana_min"] == 20
    assert stats["cola"]["pendientes"] == 1
    assert stats["reclamos"]["total"] == 1
    assert stats["reclamos"]["motivos"][0]["id"] == "no_recibido"


def test_clasificar_entrada_espera(monkeypatch, tmp_path: Path) -> None:
    _isolate(monkeypatch, tmp_path)
    extra = ps.clasificar_entrada(
        {
            "texto": "adjunto el RUT para facturar",
            "timestamp": (datetime.now(_CO) - timedelta(minutes=12)).isoformat(),
        }
    )
    assert extra["tipo_solicitud"] == "factura"
    assert extra["espera_min"] is not None
    assert 10 <= extra["espera_min"] <= 15
