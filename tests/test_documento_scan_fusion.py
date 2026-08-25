"""Fusión de parámetros COA de varias fotos."""
from app.services.documento_scan_tablas import (
    fusionar_campos_coa,
    fusionar_texto_parametros,
)


def test_fusionar_parametros_no_pisa_celdas_vacias() -> None:
    a = "Color|Blanco nieve|\nSabor|Característico a coco|"
    b = "Aflatoxina B1||<0.50 µg/kg\nColor||"
    out = fusionar_texto_parametros(a, b)
    assert "Color|Blanco nieve|" in out
    assert "Sabor|Característico a coco|" in out
    assert "Aflatoxina B1||<0.50 µg/kg" in out


def test_fusionar_campos_une_fotos() -> None:
    foto1 = {
        "nombre_producto": "Maní Runner",
        "lote": "EXP0006/26",
        "parametros": "Humedad|3 %|",
    }
    foto2 = {
        "nombre_producto": "Maní Runner Brasileño Tostado Partido",
        "parametros": "Aflatoxina B1||<0.50 µg/kg\nAflatoxina B2||<0.50 µg/kg",
    }
    out = fusionar_campos_coa(foto1, foto2)
    assert out["lote"] == "EXP0006/26"
    assert out["nombre_producto"] == "Maní Runner"
    assert "Humedad|3 %|" in out["parametros"]
    assert "Aflatoxina B1||<0.50 µg/kg" in out["parametros"]
    assert "Aflatoxina B2||<0.50 µg/kg" in out["parametros"]


def test_coa_escanear_sin_archivo_responde_json(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    from flask import Flask
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/coa/escanear-parametros",
            headers={"Authorization": "Bearer token-prueba"},
        )
        assert r.is_json
        assert r.status_code == 400
        assert "imagen" in (r.get_json() or {}).get("error", "").lower()


def test_acceso_red_api_no_devuelve_html(monkeypatch) -> None:
    monkeypatch.setattr("app.routes._leer_acceso_red", lambda: False)
    from flask import Flask
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/coa/escanear-parametros",
            environ_base={"REMOTE_ADDR": "192.168.1.50"},
        )
        assert r.is_json
        assert r.status_code == 403
        assert "restringido" in (r.get_json() or {}).get("error", "").lower()


_PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_empaquetar_resultado_coa_scan() -> None:
    from app.services.coa_scan_jobs import empaquetar_resultado_coa_scan

    out = empaquetar_resultado_coa_scan(
        {
            "nombre_producto": "Urea cosmética",
            "parametros": "Humedad|máx. 1 %|0.8 %",
            "cas": "57-13-6",
            "fecha_fabricacion": "2025-12-XX",
            "einecs": "200-315-5",
        },
        [(_PNG_1PX, "image/png")],
        [],
    )
    assert out["ok"] is True
    assert out["nombre_producto"] == "Urea cosmética"
    assert out["cas"] == "57-13-6"
    assert out["campos"]["einces"] == "200-315-5"
    assert out["campos"]["fecha_fabricacion"] == "2025-12-01"
    assert out["imagenes_procesadas"] == 1


def test_empaquetar_sin_datos_utiles() -> None:
    from app.services.coa_scan_jobs import empaquetar_resultado_coa_scan
    import pytest

    with pytest.raises(ValueError):
        empaquetar_resultado_coa_scan({"olor": ""}, [], [])


def test_mejorar_imagen_baja_fotos_enormes() -> None:
    import io
    from PIL import Image
    from app.services.documento_scan_tablas import preparar_partes

    im = Image.new("RGB", (4000, 3000), (240, 240, 240))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=90)
    data, mime = preparar_partes([(buf.getvalue(), "image/jpeg")])[0]
    out = Image.open(io.BytesIO(data))
    assert max(out.size) <= 1800
    assert mime == "image/jpeg"


def test_coa_escanear_post_devuelve_job_sin_esperar_gemini(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    monkeypatch.setenv("GOOGLE_API_KEY", "fake-key")
    monkeypatch.setattr(
        "app.services.coa_scan_jobs.spawn_thread",
        lambda *a, **k: None,
    )
    from flask import Flask
    from app.routes import register_routes
    from io import BytesIO

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/coa/escanear-parametros",
            headers={"Authorization": "Bearer token-prueba"},
            data={"imagen": (BytesIO(_PNG_1PX), "coa.png")},
            content_type="multipart/form-data",
        )
        assert r.status_code == 202
        body = r.get_json() or {}
        assert body.get("status") == "pending"
        assert body.get("job_id")
        st = c.get(
            f"/api/fichas/coa/escanear-parametros/{body['job_id']}",
            headers={"Authorization": "Bearer token-prueba"},
        )
        assert st.status_code == 200
        assert (st.get_json() or {}).get("status") == "pending"


def test_coa_escanear_job_completa_y_get_done(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    monkeypatch.setenv("GOOGLE_API_KEY", "fake-key")

    def _run_inline(target, args=(), kwargs=None, **_kw):
        target(*args, **(kwargs or {}))
        return None

    monkeypatch.setattr("app.services.coa_scan_jobs.spawn_thread", _run_inline)
    monkeypatch.setattr(
        "app.services.documento_scan_tablas.extraer_coa_desde_imagenes",
        lambda *a, **k: {
            "nombre_producto": "Urea cosmética",
            "parametros": "Humedad|máx. 1 %|0.8 %",
            "cas": "57-13-6",
        },
    )
    from flask import Flask
    from app.routes import register_routes
    from io import BytesIO

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/coa/escanear-parametros",
            headers={"Authorization": "Bearer token-prueba"},
            data={"imagen": (BytesIO(_PNG_1PX), "coa.png")},
            content_type="multipart/form-data",
        )
        job_id = (r.get_json() or {}).get("job_id")
        assert r.status_code == 202 and job_id
        st = c.get(
            f"/api/fichas/coa/escanear-parametros/{job_id}",
            headers={"Authorization": "Bearer token-prueba"},
        )
        body = st.get_json() or {}
        assert st.status_code == 200
        assert body.get("status") == "done"
        assert body.get("nombre_producto") == "Urea cosmética"
        assert "Humedad" in (body.get("parametros") or "")


def test_coa_escanear_estado_desconocido_404(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    from flask import Flask
    from app.routes import register_routes

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.get(
            "/api/fichas/coa/escanear-parametros/deadbeefdeadbeef",
            headers={"Authorization": "Bearer token-prueba"},
        )
        assert r.is_json
        assert r.status_code == 404


def test_empaquetar_resultado_ft_scan() -> None:
    from app.services.coa_scan_jobs import empaquetar_resultado_ft_scan

    out = empaquetar_resultado_ft_scan(
        {
            "nombre_producto": "Urea cosmética",
            "cas": "57-13-6",
            "formula_quimica": "CH4N2O",
            "descripcion": "Polvo blanco cristalino",
        }
    )
    assert out["ok"] is True
    assert out["campos"]["cas"] == "57-13-6"
    assert "descripcion" in out["campos"]


def test_ft_escanear_post_devuelve_job_sin_esperar_gemini(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    monkeypatch.setenv("GOOGLE_API_KEY", "fake-key")
    monkeypatch.setattr("app.services.coa_scan_jobs.spawn_thread", lambda *a, **k: None)
    from flask import Flask
    from app.routes import register_routes
    from io import BytesIO

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/ft/escanear-imagen",
            headers={"Authorization": "Bearer token-prueba"},
            data={"imagen": (BytesIO(_PNG_1PX), "ft.png")},
            content_type="multipart/form-data",
        )
        assert r.status_code == 202
        body = r.get_json() or {}
        assert body.get("job_id")
        st = c.get(
            f"/api/fichas/ft/escanear-imagen/{body['job_id']}",
            headers={"Authorization": "Bearer token-prueba"},
        )
        assert (st.get_json() or {}).get("status") == "pending"


def test_ft_escanear_job_completa_y_get_done(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_API_TOKEN", "token-prueba")
    monkeypatch.setenv("GOOGLE_API_KEY", "fake-key")

    def _run_inline(target, args=(), kwargs=None, **_kw):
        target(*args, **(kwargs or {}))
        return None

    monkeypatch.setattr("app.services.coa_scan_jobs.spawn_thread", _run_inline)
    monkeypatch.setattr(
        "app.services.documento_scan_tablas.extraer_ft_desde_imagenes",
        lambda *a, **k: {
            "nombre_producto": "Urea cosmética",
            "cas": "57-13-6",
            "formula_quimica": "CH4N2O",
            "descripcion": "Polvo blanco",
        },
    )
    from flask import Flask
    from app.routes import register_routes
    from io import BytesIO

    app = Flask(__name__)
    register_routes(app)
    app.config["TESTING"] = True
    with app.test_client() as c:
        r = c.post(
            "/api/fichas/ft/escanear-imagen",
            headers={"Authorization": "Bearer token-prueba"},
            data={"imagen": (BytesIO(_PNG_1PX), "ft.png")},
            content_type="multipart/form-data",
        )
        job_id = (r.get_json() or {}).get("job_id")
        assert r.status_code == 202 and job_id
        st = c.get(
            f"/api/fichas/ft/escanear-imagen/{job_id}",
            headers={"Authorization": "Bearer token-prueba"},
        )
        body = st.get_json() or {}
        assert body.get("status") == "done"
        assert (body.get("campos") or {}).get("cas") == "57-13-6"
