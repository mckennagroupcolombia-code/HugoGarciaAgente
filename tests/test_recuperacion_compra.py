"""Recuperación de compras abandonadas, diagnóstico de abandono y modo
mantenimiento de la web (sep-2026)."""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "PAGINA_WEB" / "site"))

from app.tools import recuperacion_compra as rc  # noqa: E402


def _db(tmp_path: Path) -> Path:
    p = tmp_path / "orders.db"
    con = sqlite3.connect(p)
    con.execute(
        """CREATE TABLE orders (id INTEGER PRIMARY KEY, reference TEXT, buyer_name TEXT, buyer_email TEXT,
           buyer_city TEXT, items_json TEXT, total REAL, status TEXT, created_at TEXT,
           payment_method TEXT, payment_type TEXT)"""
    )
    con.commit()
    con.close()
    rc.migrar(p)
    return p


def _pedido(p: Path, ref: str, email: str, status: str, horas: float, total: float = 80000, detail: str = "", city: str = "Bogotá"):
    con = sqlite3.connect(p)
    items = json.dumps({"items": [{"name": "NIACINAMIDA 100g", "slug": "c-nia100g", "ref": "C-NIA100g", "qty": 1, "price": total}]})
    con.execute(
        "INSERT INTO orders (reference, buyer_name, buyer_email, buyer_city, items_json, total, status, created_at, payment_status_detail, payment_type) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (ref, "Ana Pérez", email, city, items, total, status, (datetime.now() - timedelta(hours=horas)).isoformat(timespec="seconds"), detail, "credit_card" if detail else ""),
    )
    con.commit()
    con.close()


def test_migrar_agrega_tablas_y_columna(tmp_path):
    p = _db(tmp_path)
    con = sqlite3.connect(p)
    tablas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cols = {r[1] for r in con.execute("PRAGMA table_info(orders)")}
    con.close()
    assert {"recuperacion_envios", "correo_bajas"} <= tablas
    assert "payment_status_detail" in cols
    rc.migrar(p)  # idempotente


def test_candidatos_respeta_etapas_compras_y_bajas(tmp_path):
    p = _db(tmp_path)
    _pedido(p, "A1", "ana@x.co", "no_realizado", horas=2)      # recordatorio
    _pedido(p, "B1", "beto@x.co", "declined", horas=50)         # ya vencieron las dos etapas → último
    _pedido(p, "C1", "caro@x.co", "pending", horas=0.5)         # aún no toca
    _pedido(p, "D1", "dani@x.co", "no_realizado", horas=5)
    _pedido(p, "D2", "dani@x.co", "approved", horas=1)          # compró después: no molestar
    _pedido(p, "E1", "eva@x.co", "no_realizado", horas=5)
    rc.dar_de_baja("eva@x.co", path=p)
    _pedido(p, "F1", "", "no_realizado", horas=5)               # sin correo
    _pedido(p, "G1", "gus@x.co", "no_realizado", horas=24 * 40) # fuera de la ventana
    c = {x["reference"]: x for x in rc.candidatos(p)}
    assert set(c) == {"A1", "B1"}
    assert c["A1"]["etapa"] == "recordatorio" and c["B1"]["etapa"] == "ultimo"


@pytest.fixture()
def smtp_falso(monkeypatch):
    """Envío real sin SMTP: registra en la base como si el correo hubiera salido."""
    from app.tools import web_pedidos

    enviados: list[tuple[str, str]] = []
    monkeypatch.setattr(web_pedidos, "_send_smtp", lambda to, subj, txt, html: enviados.append((to, subj)) or True)
    return enviados


def test_enviar_es_idempotente_y_no_repite_etapa(tmp_path, smtp_falso):
    p = _db(tmp_path)
    _pedido(p, "A1", "ana@x.co", "no_realizado", horas=2)
    r1 = rc.enviar_pendientes(path=p)
    assert r1["enviados"] == 1 and r1["detalle"][0]["etapa"] == "recordatorio" and len(smtp_falso) == 1
    r2 = rc.enviar_pendientes(path=p)
    assert r2["enviados"] == 0  # misma etapa no se repite
    # 48 h después toca el último, y después nada más
    luego = datetime.now() + timedelta(hours=49)
    r3 = rc.enviar_pendientes(path=p, ahora=luego)
    assert r3["enviados"] == 1 and r3["detalle"][0]["etapa"] == "ultimo"
    r4 = rc.enviar_pendientes(path=p, ahora=luego + timedelta(days=2))
    assert r4["enviados"] == 0 and len(smtp_falso) == 2


def test_simular_no_deja_rastro(tmp_path):
    p = _db(tmp_path)
    _pedido(p, "A1", "ana@x.co", "no_realizado", horas=2)
    assert rc.enviar_pendientes(simular=True, path=p)["enviados"] == 1
    assert rc.enviar_pendientes(simular=True, path=p)["enviados"] == 1  # sigue pendiente de verdad
    con = sqlite3.connect(p)
    assert con.execute("SELECT COUNT(*) FROM recuperacion_envios").fetchone()[0] == 0
    con.close()


def test_maximo_un_correo_por_persona_y_dia(tmp_path):
    p = _db(tmp_path)
    _pedido(p, "A1", "ana@x.co", "no_realizado", horas=3)
    _pedido(p, "A2", "ana@x.co", "no_realizado", horas=2)
    r = rc.enviar_pendientes(simular=True, path=p)
    assert r["enviados"] == 1


def test_correo_explica_motivo_de_rechazo_y_trae_baja(tmp_path):
    p = _db(tmp_path)
    _pedido(p, "R1", "rita@x.co", "declined", horas=2, detail="cc_rejected_insufficient_amount")
    c = rc.candidatos(p)[0]
    asunto, texto, html = rc.render_correo(c, "tok_prueba_12345678901234")
    assert "no pasó" in asunto.lower() or "pago" in asunto.lower()
    assert "fondos insuficientes" in html and "PSE" in html
    assert "/checkout/reanudar/tok_prueba_12345678901234" in html
    assert "/correos/baja/" in html and "rita%40x.co" in html.replace("@", "%40")
    assert "no constituye" not in html  # no es un artículo, es un correo
    assert "cura" not in html.lower()


def test_token_de_baja_es_verificable_y_no_transferible():
    t = rc.token_baja("Ana@X.co")
    assert rc.baja_valida("ana@x.co", t)          # sin distinguir mayúsculas
    assert not rc.baja_valida("otra@x.co", t)
    assert not rc.baja_valida("ana@x.co", t[:-1] + "0")


def test_pedido_por_token_marca_el_clic(tmp_path, smtp_falso):
    p = _db(tmp_path)
    _pedido(p, "A1", "ana@x.co", "no_realizado", horas=2)
    rc.enviar_pendientes(path=p)
    con = sqlite3.connect(p)
    token = con.execute("SELECT token FROM recuperacion_envios").fetchone()[0]
    con.close()
    ped = rc.pedido_por_token(token, path=p)
    assert ped and ped["reference"] == "A1" and ped["items"][0]["slug"] == "c-nia100g"
    con = sqlite3.connect(p)
    assert con.execute("SELECT reanudado_at FROM recuperacion_envios").fetchone()[0]
    con.close()
    assert rc.pedido_por_token("no-existe-000000000000", path=p) is None
    assert rc.pedido_por_token("../x", path=p) is None


def test_diagnostico_arma_hipotesis_con_evidencia(tmp_path):
    p = _db(tmp_path)
    for i in range(6):
        _pedido(p, f"P{i}", f"p{i}@x.co", "no_realizado", horas=10 + i, total=30000)
    for i in range(3):
        _pedido(p, f"D{i}", f"d{i}@x.co", "declined", horas=20 + i, detail="cc_rejected_insufficient_amount", total=300000)
    for i in range(4):
        _pedido(p, f"OK{i}", f"ok{i}@x.co", "approved", horas=30 + i, total=120000)
    _pedido(p, "REP1", "rep@x.co", "no_realizado", horas=40)
    _pedido(p, "REP2", "rep@x.co", "declined", horas=41)
    d = rc.diagnostico_abandono(30, path=p, metricas_path=tmp_path / "no-existe.db")
    assert d["total"] == 15 and d["aprobados"] == 4 and d["rechazados"] == 4 and d["sin_pago"] == 7
    tipos = {h["tipo"] for h in d["hipotesis"]}
    assert {"embudo", "no_volvieron", "rechazo", "recurrente"} <= tipos
    assert d["motivos_rechazo"][0]["texto"] == "fondos insuficientes en la tarjeta"
    assert d["recurrentes"][0] == {"email": "rep@x.co", "intentos": 2}
    assert d["productos_abandonados"][0]["producto"] == "NIACINAMIDA 100g"
    assert len(d["abandonados_recientes"]) == 11


# ── web ──────────────────────────────────────────────────────────────────────

@pytest.fixture()
def client():
    import website

    website.app.config["TESTING"] = True
    with website.app.test_client() as c:
        yield c


def test_baja_por_enlace(client, monkeypatch, tmp_path):
    p = _db(tmp_path)
    monkeypatch.setattr(rc, "ORDERS_DB", p)
    t = rc.token_baja("ana@x.co")
    r = client.get(f"/correos/baja/{t}?e=ana@x.co")
    assert r.status_code == 200 and "No te volveremos a" in r.get_data(as_text=True)
    assert rc.esta_de_baja("ana@x.co", path=p)
    assert client.get("/correos/baja/abc?e=ana@x.co").status_code == 400


def test_reanudar_con_token_invalido_redirige(client):
    r = client.get("/checkout/reanudar/token-que-no-existe-00000000")
    assert r.status_code == 302 and "/catalogo" in r.headers["Location"]


def test_modo_mantenimiento_por_bandera(client):
    import website

    flag = website._MANTENIMIENTO_FLAG
    assert not flag.exists(), "la bandera de mantenimiento está puesta en el repo"
    flag.write_text("prueba", encoding="utf-8")
    try:
        r = client.get("/")
        assert r.status_code == 503 and "mantenimiento" in r.get_data(as_text=True).lower()
        assert r.headers.get("Retry-After") == "120"
        assert client.get("/status").status_code == 503
        assert client.get("/static/css/main.css").status_code == 200  # los estáticos siguen
    finally:
        flag.unlink()
    assert client.get("/").status_code == 200


def test_pagina_de_mantenimiento_es_autocontenida():
    html = (REPO / "PAGINA_WEB" / "site" / "mantenimiento" / "index.html").read_text(encoding="utf-8")
    assert "data:image/png;base64," in html and "wa.me" in html
    assert "http-equiv=\"refresh\"" in html
    assert 'href="/static' not in html and "<link " not in html  # nada que dependa del servidor caído
