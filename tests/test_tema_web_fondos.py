"""Imágenes de fondo del Studio → sitio (upload + tema_web.json)."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest

from app.tools import tema_web as tw
from app.tools import tema_web_fondos as tf


PNG_MIN = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40


def _reset_tema(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    prev = tmp_path / "tema_web_preview.json"
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    monkeypatch.setattr(tw, "TEMA_WEB_PREVIEW_FILE", prev)
    tw._cache = {}
    tw._cache_mtime = None
    tw._preview_cache = None
    tw._preview_mtime = None


class _FakeFile:
    def __init__(self, name: str, data: bytes) -> None:
        self.filename = name
        self.stream = BytesIO(data)


def test_sanitize_fondo_url_solo_uploads() -> None:
    ok = "/static/uploads/fondos/abc123.webp"
    assert tf.sanitize_fondo_url(ok) == ok
    assert tf.sanitize_fondo_url("https://evil.example/x.jpg") == ""
    assert tf.sanitize_fondo_url("/static/uploads/fondos/../passwd") == ""
    assert tf.sanitize_fondo_url("/static/img/isotipo.png") == ""
    assert tf.sanitize_fondo_url("javascript:alert(1)") == ""


def test_guardar_fondo_png(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(tf, "FONDOS_DIR", tmp_path)
    item = tf.guardar_fondo(_FakeFile("foto.png", PNG_MIN))
    assert item["url"].startswith("/static/uploads/fondos/")
    assert item["url"].endswith(".png")
    assert item["bytes"] == len(PNG_MIN)
    assert (tmp_path / item["filename"]).read_bytes() == PNG_MIN


def test_guardar_fondo_rechaza_no_imagen(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(tf, "FONDOS_DIR", tmp_path)
    with pytest.raises(ValueError, match="Formato"):
        tf.guardar_fondo(_FakeFile("x.exe", b"MZ" + b"\x00" * 40))


def test_guardar_fondo_sin_archivo() -> None:
    with pytest.raises(ValueError, match="archivo"):
        tf.guardar_fondo(None)


def test_guardar_fondo_permiso_denegado(tmp_path, monkeypatch) -> None:
    bloqueado = tmp_path / "fondos"
    bloqueado.mkdir()
    monkeypatch.setattr(tf, "FONDOS_DIR", bloqueado)

    def _boom(*_a, **_k):
        raise PermissionError("[Errno 13] Permission denied")

    monkeypatch.setattr(Path, "write_bytes", _boom)
    with pytest.raises(ValueError, match="Sin permiso"):
        tf.guardar_fondo(_FakeFile("foto.png", PNG_MIN))


def test_ruta_fondo_segura(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(tf, "FONDOS_DIR", tmp_path)
    bueno = tmp_path / "abc123.png"
    bueno.write_bytes(PNG_MIN)
    assert tf.ruta_fondo_segura("abc123.png") == bueno.resolve()
    assert tf.ruta_fondo_segura("../passwd") is None
    assert tf.ruta_fondo_segura("no-existe.png") is None
    assert tf.ruta_fondo_segura("a/b.png") is None


def test_normalizar_y_resolver_fondos_clasico(tmp_path, monkeypatch) -> None:
    _reset_tema(tmp_path, monkeypatch)
    tw.guardar_tema_web(
        {
            "clasico": {
                "fondos": {
                    "hero_izq": "/static/uploads/fondos/a.jpg",
                    "pagina": "javascript:alert(1)",
                    "basura": "/static/uploads/fondos/x.jpg",
                }
            }
        }
    )
    cfg = tw.cargar_tema_web(force=True)
    f = cfg["clasico"]["fondos"]
    assert f["hero_izq"] == "/static/uploads/fondos/a.jpg"
    assert f["pagina"] == ""
    assert "basura" not in f
    css = tw.resolver_fondos_css(cfg, tema="clasico")
    assert "url('/static/uploads/fondos/a.jpg')" in css["hero_izq_css"]
    assert "linear-gradient" in css["hero_izq_css"]
    assert css["pagina_css"] == "none"


def test_layout_nodo_background_image(tmp_path, monkeypatch) -> None:
    _reset_tema(tmp_path, monkeypatch)
    tw.guardar_tema_web(
        {
            "layout_clasico": {
                "orden": ["hero"],
                "nodos": {
                    "hero": {
                        "dx": 1,
                        "backgroundImage": "/static/uploads/fondos/x.webp",
                    },
                    "cta": {"backgroundImage": "/etc/passwd"},
                },
            }
        }
    )
    cfg = tw.cargar_tema_web(force=True)
    hero = cfg["layout_clasico"]["nodos"]["hero"]
    assert hero["backgroundImage"] == "/static/uploads/fondos/x.webp"
    assert "backgroundImage" not in cfg["layout_clasico"]["nodos"].get("cta", {})
    css = tw.estilo_nodo_layout(hero)
    assert "background-image:url('/static/uploads/fondos/x.webp')" in css
    assert "background-size:cover" in css


def test_nodo_foto_sitio_no_emite_background_css(tmp_path, monkeypatch) -> None:
    _reset_tema(tmp_path, monkeypatch)
    tw.guardar_tema_web(
        {
            "layout_clasico": {
                "orden": ["hero"],
                "nodos": {
                    "hero.foto_izq": {
                        "dx": 12,
                        "dy": 8,
                        "width": 240,
                        "height": 160,
                        "backgroundImage": "/static/uploads/fondos/foto.png",
                    }
                },
            }
        }
    )
    cfg = tw.cargar_tema_web(force=True)
    nodo = cfg["layout_clasico"]["nodos"]["hero.foto_izq"]
    css = tw.estilo_nodo_layout(nodo, "hero.foto_izq")
    assert "background-image" not in css
    assert "width:240px" in css
    assert "height:160px" in css
    assert "translate(12px,8px)" in css
    assert tw.es_nodo_foto_sitio("hero.foto_izq")
    assert not tw.es_nodo_foto_sitio("hero")
