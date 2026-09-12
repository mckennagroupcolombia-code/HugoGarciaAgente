"""El correo a un tercero debe salir con la marca y con una persona firmando.

Los correos de préstamos salieron una vez con HTML suelto y cerrados solo con
la razón social; el usuario lo devolvió. Estas pruebas fijan las dos cosas que
faltaban para que no se pierdan en la próxima edición.
"""

from app.tools import correo_marca


def test_marco_trae_la_identidad_visual():
    html = correo_marca.marco(preheader="Prueba", inner_html="<p>cuerpo</p>")
    assert "<p>cuerpo</p>" in html
    assert correo_marca.LOGO_URL in html
    assert "Montserrat" in html
    assert correo_marca.VERDE in html
    assert "mckennagroup.co" in html


def test_marco_escapa_el_preheader():
    html = correo_marca.marco(preheader='<script>x</script>', inner_html="")
    assert "<script>x</script>" not in html
    assert "&lt;script&gt;" in html


def test_firma_nombra_a_la_persona_no_solo_a_la_empresa():
    for firma in (correo_marca.firma_html(), correo_marca.firma_texto()):
        assert "Hugo Armando García Velandia" in firma
        assert "Representante Legal" in firma
        assert "901.316.016-3" in firma


def test_web_pedidos_usa_la_misma_plantilla():
    """Si alguien vuelve a duplicar el marco en pedidos, esto lo detecta."""
    from app.tools import web_pedidos

    inner = "<p>pedido</p>"
    assert web_pedidos._wrap_mckenna_email(preheader="p", inner_html=inner) == correo_marca.marco(
        preheader="p", inner_html=inner
    )
