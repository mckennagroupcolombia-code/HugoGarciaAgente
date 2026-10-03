"""Las plantillas del libro aceptan «valor» y «monto» indistintamente.

No es una comodidad: es un bug que estuvo vivo. `registrar_ingreso` y
`registrar_egreso` leen `payload["valor"]`, pero las plantillas de préstamos y
socios leen `payload["monto"]`, y el panel mandaba «monto» para todas. Resultado:
clasificar una línea del banco como ingreso o egreso respondía siempre «fecha,
concepto, valor, cuenta_… son requeridos» —sin decir que el problema era el
nombre de la clave— y por lo tanto no se podía causar nada desde la bandeja del
clasificador ni desde el taller de conciliación.

El panel ya manda la clave correcta; la ruta normaliza para que un llamador que
se equivoque (o un script viejo) no vuelva a chocar contra esto en silencio.
"""
from __future__ import annotations

import pytest
from flask import Flask

from app.routes import register_routes

TOKEN = "token-de-sistema-para-test"


@pytest.fixture()
def cliente(monkeypatch, tmp_path):
    """App Flask con la contabilidad en una DB de usar y tirar."""
    monkeypatch.setenv("CHAT_API_TOKEN", TOKEN)
    import app.services.contabilidad_core as cc

    db = str(tmp_path / "contabilidad_test.db")
    monkeypatch.setattr(cc, "_DB_PATH", db)
    monkeypatch.setattr(cc, "_initialized", False)
    cc.init_db()  # siembra el PUC: 1110 Bancos y el medio de pago salen de acá

    app = Flask(__name__)
    register_routes(app)
    with app.test_client() as c:
        yield c


def _cuenta(codigo: str, nombre: str, tipo: str) -> int:
    import app.services.contabilidad_core as cc

    with cc._conn() as con:
        fila = con.execute("SELECT id FROM cc_plan_cuentas WHERE codigo = ?", (codigo,)).fetchone()
        if fila:
            return int(fila[0])
    return int(cc.crear_cuenta({"codigo": codigo, "nombre": nombre, "tipo": tipo})["id"])


def _medio_banco() -> int:
    import app.services.contabilidad_core as cc

    banco = _cuenta("1110", "Bancos", "activo")
    with cc._conn() as con:
        fila = con.execute("SELECT id FROM cc_medios_pago LIMIT 1").fetchone()
        if fila:
            return int(fila[0])
        cur = con.execute(
            "INSERT INTO cc_medios_pago (nombre, cuenta_id, activo) VALUES (?, ?, 1)",
            ("Bancolombia", banco),
        )
        return int(cur.lastrowid)


def _post(cliente, ruta: str, cuerpo: dict):
    return cliente.post(
        f"/api/contabilidad/cc/plantillas/{ruta}",
        json=cuerpo,
        headers={"Authorization": f"Bearer {TOKEN}"},
    )


@pytest.mark.parametrize("clave", ["valor", "monto"])
@pytest.mark.parametrize(
    "ruta,campo_cuenta,codigo,nombre,tipo",
    [
        ("egreso", "cuenta_gasto_id", "5305", "Gastos bancarios", "gasto"),
        ("ingreso", "cuenta_ingreso_id", "4295", "Intereses de ahorros", "ingreso"),
    ],
)
def test_plantilla_acepta_las_dos_claves(cliente, clave, ruta, campo_cuenta, codigo, nombre, tipo):
    cuerpo = {
        "fecha": "2026-09-21",
        "concepto": f"Prueba {ruta} con «{clave}»",
        clave: 27784,
        campo_cuenta: _cuenta(codigo, nombre, tipo),
        "medio_pago_id": _medio_banco(),
        "referencia": f"extracto:{clave}:{ruta}",
    }
    r = _post(cliente, ruta, cuerpo)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["movimiento"]["id"]


def test_sin_monto_ni_valor_sigue_fallando(cliente):
    """Normalizar no es inventar: si no viene la plata, la plantilla se queja."""
    r = _post(
        cliente,
        "egreso",
        {
            "fecha": "2026-09-21",
            "concepto": "Sin plata",
            "cuenta_gasto_id": _cuenta("5305", "Gastos bancarios", "gasto"),
            "medio_pago_id": _medio_banco(),
        },
    )
    assert r.status_code == 400
    assert "requerid" in (r.get_json().get("error") or "").lower()
