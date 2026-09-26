"""Urgencias del Mapa: cada persona ve solo lo de los paneles que puede abrir.

La regla vive en app/services/acceso_paneles.py (réplica, del lado del servidor, de
desktop/src/lib/panelAccess.ts para los paneles a los que apunta alguna urgencia).
"""
from __future__ import annotations

import re
from pathlib import Path

from app.services import acceso_paneles as A
from app.services import mapa_app

REPO = Path(__file__).resolve().parents[1]
ADMIN = {"id": 8, "rol": {"nivel": 3}, "permisos_secciones": {}}
DESPACHOS = {"id": 12, "rol": {"nivel": 1},
             "permisos_secciones": {"tickets": True, "pedidos": True, "empaque": True, "facturacion": True}}
CONTABLE = {"id": 14, "rol": {"nivel": 1}, "permisos_secciones": {"tickets": True, "libro-mayor": True}}
CONTADOR = {"id": 20, "rol": {"nivel": 1}, "permisos_secciones": {"contador": True, "libro-mayor": True}}


def test_cada_quien_ve_lo_suyo():
    assert A.puede_ver_panel(ADMIN, "libro-mayor")
    assert A.puede_ver_panel(DESPACHOS, "pedidos") and A.puede_ver_panel(DESPACHOS, "guias-envio")
    assert A.puede_ver_panel(DESPACHOS, "facturacion")
    # Lo contable sensible NO se hereda de facturación.
    for p in ("libro-mayor", "pagos", "conciliacion-contador", "socios", "prestamos"):
        assert not A.puede_ver_panel(DESPACHOS, p), p
        assert A.puede_ver_panel(CONTABLE, p), p
    assert not A.puede_ver_panel(CONTABLE, "pedidos")
    # Contador y colaborador externo no usan el mapa; sin sesión, nada.
    assert not A.puede_ver_panel(CONTADOR, "libro-mayor")
    assert not A.puede_ver_panel(None, "pedidos")


def test_toda_fuente_del_mapa_apunta_a_un_panel_con_regla_conocida():
    """Si una fuente nueva apunta a un panel que no está en REGLAS, se exige el permiso con
    su mismo nombre. Este test obliga a decidirlo a conciencia: o se agrega una regla (si el
    menú lo hereda de otro permiso) o se anota aquí que el permiso directo es la regla."""
    fuente = (REPO / "app" / "services" / "mapa_app.py").read_text(encoding="utf-8")
    paneles = set(re.findall(r'_b\("[a-z]+", "[a-z_]+", [^,]+, "[^"]*", "([a-z-]+)"', fuente))
    paneles |= set(re.findall(r'\("[a-z]+", "([a-z-]+)", "[^"]+"\)', fuente))  # _CHECKLIST
    # Fuentes que arman sus urgencias en su propio módulo (misma forma que _b()).
    for delegado in ("canales_producto.py",):
        texto = (REPO / "app" / "services" / delegado).read_text(encoding="utf-8")
        paneles |= set(re.findall(r'"panel": "([a-z-]+)"', texto))
    assert {"pedidos", "libro-mayor", "canales-producto"} <= paneles, "la lectura de fuentes quedó vacía"
    permiso_directo = {"combos", "control-inventario", "publicaciones", "pedidos", "preventa"}
    sin_decidir = sorted(p for p in paneles if p not in A.REGLAS and p not in permiso_directo)
    assert not sin_decidir, f"paneles de urgencias sin regla decidida: {sin_decidir}"


def test_las_urgencias_se_filtran_en_el_servidor(monkeypatch):
    b = mapa_app._b
    datos = {"por_etapa": {
        "entregar": {"alta": 3, "media": 0, "items": [b("entregar", "web", 3, "pedidos sin despachar", "pedidos")]},
        "contar": {"alta": 117, "media": 25, "items": [
            b("contar", "extracto", 117, "movimientos sin clasificar", "libro-mayor"),
            b("contar", "socios", 25, "expedientes", "socios", "media")]},
    }, "sin_senal": [{"fuente": "x", "error": "y"}], "generado": "hoy"}
    monkeypatch.setattr(mapa_app, "bloqueos", lambda refrescar=False: datos)

    d = mapa_app.urgencias_para(DESPACHOS)
    assert set(d["por_etapa"]) == {"entregar"} and d["por_etapa"]["entregar"]["alta"] == 3
    assert d["sin_senal"] == []                      # el detalle técnico es de administración

    c = mapa_app.urgencias_para(CONTABLE)
    assert set(c["por_etapa"]) == {"contar"}
    assert (c["por_etapa"]["contar"]["alta"], c["por_etapa"]["contar"]["media"]) == (117, 25)

    assert mapa_app.urgencias_para(ADMIN)["sin_senal"]
    assert mapa_app.urgencias_para(None)["por_etapa"] == {}
