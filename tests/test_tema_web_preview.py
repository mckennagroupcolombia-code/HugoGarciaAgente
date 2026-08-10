"""Borrador del Studio web: no debe publicar el sitio."""

from __future__ import annotations

import json

from app.tools import tema_web as tw


def _reset_caches() -> None:
    tw._cache = {}
    tw._cache_mtime = None
    tw._preview_cache = None
    tw._preview_mtime = None


def test_host_permite_studio_preview_solo_local() -> None:
    assert tw.host_permite_studio_preview("127.0.0.1:8083") is True
    assert tw.host_permite_studio_preview("localhost:8083") is True
    assert tw.host_permite_studio_preview("[::1]:8083") is True
    assert tw.host_permite_studio_preview("mckennagroup.co") is False
    assert tw.host_permite_studio_preview("bot.mckennagroup.co") is False


def test_guardar_preview_no_pisa_publicado(tmp_path, monkeypatch) -> None:
    pub = tmp_path / "tema_web.json"
    prev = tmp_path / "tema_web_preview.json"
    pub.write_text(
        json.dumps(
            {
                "tema_activo": "clasico",
                "diseno": {
                    "fuente_display": "montserrat",
                    "radio": "pill",
                    "densidad": "normal",
                    "tagline": "publicado",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(tw, "TEMA_WEB_FILE", pub)
    monkeypatch.setattr(tw, "TEMA_WEB_PREVIEW_FILE", prev)
    _reset_caches()

    antes = pub.read_text(encoding="utf-8")
    draft = tw.guardar_tema_preview(
        {
            "diseno": {
                "fuente_display": "montserrat",
                "radio": "sharp",
                "densidad": "amplia",
                "tagline": "borrador studio",
            }
        }
    )
    assert pub.read_text(encoding="utf-8") == antes
    assert draft["diseno"]["radio"] == "sharp"
    assert draft["diseno"]["tagline"] == "borrador studio"
    assert prev.is_file()

    publicado = tw.cargar_tema_web(force=True)
    assert publicado["diseno"]["tagline"] == "publicado"
    assert publicado["diseno"]["radio"] == "pill"

    leido = tw.cargar_tema_preview(force=True)
    assert leido["diseno"]["tagline"] == "borrador studio"
    assert leido["diseno"]["radio"] == "sharp"

    tw.borrar_tema_preview()
    assert not prev.exists()
    fallback = tw.cargar_tema_preview(force=True)
    assert fallback["diseno"]["tagline"] == "publicado"
