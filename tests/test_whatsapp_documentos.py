"""WhatsApp directo (+573195183596): a diferencia de MeLi, aquí sí se puede
compartir el enlace de ficha técnica / COA — mismo interceptor determinista
que ya usa la burbuja web (app/web_chat_documentos.py), con canal="whatsapp".
Los PDFs viven en la propia página web (app.services.documentos_web), no en
Drive — ver /documentos-tecnicos/<pdf>?seccion=ft|coa|sds."""

from __future__ import annotations

import app.web_chat_documentos as wcd

_DOC_CON_COA = {
    "titulo": "Ácido Cítrico",
    "pdf_nombre": "FT COA SDS Acido Citrico.pdf",
    "coa": {"parametros": [["pH", "2-3", "2.5"]]},
    "sds": None,
}


def test_whatsapp_incluye_enlace_directo_al_sitio(monkeypatch):
    monkeypatch.setattr(wcd, "buscar_documento_completo_web", lambda nombre, ref="": _DOC_CON_COA)

    salida = wcd.manejar_documentos_web(
        user_message="me puedes enviar la ficha tecnica y el coa del acido citrico?",
        historial_usuario="",
        canal="whatsapp",
    )

    assert salida is not None
    assert "mckennagroup.co/documentos-tecnicos/" in salida
    assert "seccion=ft" in salida
    assert "seccion=coa" in salida
    assert "drive.google.com" not in salida
    # En WhatsApp no tiene sentido redirigir al cliente... a WhatsApp.
    assert "wa.me" not in salida


def test_web_chat_mantiene_cierre_con_boton_whatsapp(monkeypatch):
    monkeypatch.setattr(wcd, "buscar_documento_completo_web", lambda nombre, ref="": _DOC_CON_COA)

    salida = wcd.manejar_documentos_web(
        user_message="me puedes enviar la ficha tecnica y el coa del acido citrico?",
        historial_usuario="",
    )

    assert salida is not None
    assert "mckennagroup.co/documentos-tecnicos/" in salida
    assert "wa.me" in salida


def test_sin_documento_publicado_pide_correo(monkeypatch):
    monkeypatch.setattr(wcd, "buscar_documento_completo_web", lambda nombre, ref="": None)

    salida = wcd.manejar_documentos_web(
        user_message="me puedes enviar la ficha tecnica y el coa del acido citrico?",
        historial_usuario="",
        canal="whatsapp",
    )

    assert salida is not None
    assert "correo" in salida.lower()
    assert "documentos-tecnicos" not in salida
