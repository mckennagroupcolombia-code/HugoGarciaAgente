"""Validación MeLi en texto mágico de plantillas visuales."""
from __future__ import annotations

from app.tools.plantillas_texto_ia import (
    _aceptar_texto_ia,
    _contiene_riesgo_meli,
    _contar_palabras,
    _formatear_contexto_otras_capas,
    _norm,
    _repite_capas_etiqueta,
    _repeticion_excesiva,
    _señales_riesgo_meli,
    _suavizar_repeticiones,
    _terminos_ancla_repeticion,
    _validar_texto_catalogo,
)


def test_contiene_riesgo_meli_suplemento_deportivo():
    assert _contiene_riesgo_meli(
        "Ampliamente utilizada en suplementos deportivos por atletas."
    )


def test_contiene_riesgo_meli_dosis():
    assert _contiene_riesgo_meli("Las dosis sugeridas varían: 15-20 gramos diarios.")


def test_señales_riesgo_meli_lista_coincidencias():
    señales = _señales_riesgo_meli(
        "Dosis sugeridas para atletas y suplemento deportivo."
    )
    assert "dosis sugerida" in señales or "suplemento deportivo" in señales


def test_texto_tecnico_formulacion_pasa_riesgo_meli():
    assert not _contiene_riesgo_meli(
        "El citrato de magnesio se emplea como materia prima en formulación "
        "alimentaria e industrial según normativa vigente."
    )


def test_validar_rechaza_texto_con_claims_consumidor():
    texto = (
        "La creatina es fundamental para ATP y mejora el rendimiento deportivo.\n\n"
        "Se usa en suplementos deportivos por culturistas. Dosis sugeridas: 3-5 gramos "
        "al día para mantenimiento y fase de carga inicial."
    )
    assert _validar_texto_catalogo(texto, 2600, estricto=False) is None


def test_repite_capas_etiqueta_titulo():
    ctx = {"titulo": "CREATINA MONOHIDRATO", "subtitulo": "Materia prima alimentaria"}
    assert _repite_capas_etiqueta(
        "CREATINA MONOHIDRATO es una sustancia usada en formulación.\n\n"
        "Segundo párrafo con aplicaciones industriales en matrices alimentarias "
        "y procesos de manufactura de productos elaborados por terceros.",
        ctx,
    )


def test_aceptar_rechaza_redundancia_con_titulo():
    ctx = {"titulo": "CREATINA MONOHIDRATO", "subtitulo": "Materia prima alimentaria"}
    texto = (
        "CREATINA MONOHIDRATO se presenta como polvo soluble de uso industrial.\n\n"
        "En formulación alimentaria se utiliza como insumo técnico según criterio "
        "del fabricante y la normativa vigente para matrices elaboradas por terceros."
    )
    assert _aceptar_texto_ia(texto, 2600, contexto_capas=ctx) is None


def test_formatear_contexto_otras_capas():
    ctx = _formatear_contexto_otras_capas({
        "titulo": "CREATINA MONOHIDRATO",
        "subtitulo": "Materia prima alimentaria",
    })
    assert "CREATINA" in ctx
    assert "Subtítulo" in ctx
    assert "No repitas" in ctx


def test_suavizar_quita_repeticion_nombre_en_titulo_capa():
    ctx = {"titulo": "CREATINA MONOHIDRATO", "subtitulo": "Materia prima alimentaria"}
    anclas = _terminos_ancla_repeticion("creatina monohidrato", ctx, "Creatina Monohidrato")
    raw = (
        "CREATINA MONOHIDRATO es polvo soluble. CREATINA MONOHIDRATO se emplea "
        "en procesos industriales."
    )
    out = _suavizar_repeticiones(raw, anclas, ctx)
    assert _norm("creatina monohidrato") not in _norm(out)
    assert "este ingrediente" in out.lower() or "el compuesto" in out.lower()


def test_rechaza_texto_ejemplo_redaccion_robotica():
    texto = (
        "La este insumo es un compuesto reconocido por su papel en el metabolismo "
        "energético celular, actuando como un precursor clave en la síntesis de "
        "trifosfato de adenosina (ATP). Este insumo cumple una función técnica "
        "dentro de procesos de formulación industrial, aportando características "
        "funcionales. Su participación se enfoca en el soporte de procesos que "
        "demandan alta energía a nivel celular, ofreciendo propiedades distintivas "
        "para la elaboración de diversas matrices.\n\n"
        "El insumo encuentra su principal campo de aplicación en la industria "
        "alimentaria, integrándose en formulaciones diseñadas para aportar "
        "características funcionales específicas. Se emplea en la elaboración de "
        "matrices que buscan optimizar el perfil energético de los productos finales, "
        "donde su rol en el soporte celular es relevante. La dosificación y el modo "
        "de incorporación de este material dependen estrictamente de la formulación "
        "objetivo y la normativa regulatoria pertinente, garantizando un uso adecuado "
        "en el proceso industrial."
    )
    assert _validar_texto_catalogo(texto, 2600, estricto=False) is None


def test_pulir_corrige_la_este_insumo():
    from app.tools.plantillas_texto_ia import _pulir_redaccion

    out = _pulir_redaccion("La este insumo es soluble en agua.")
    assert "La este" not in out
    assert out.startswith("Este ingrediente")


def test_segmento_alimentario_desde_subtitulo():
    from app.tools.plantillas_texto_ia import _segmento_insumo, _plantilla_respaldo_catalogo

    ctx = {
        "titulo": "CREATINA MONOHIDRATO",
        "subtitulo": "Materia prima alimentaria",
    }
    assert _segmento_insumo(ctx) == "alimentario"
    t = _plantilla_respaldo_catalogo(ctx)
    assert "ingrediente alimentario" in t.lower()
    assert "cosmétic" not in t.lower() and "cosmetic" not in t.lower()


def test_fallback_respaldo_devuelve_texto_valido():
    from app.tools.plantillas_texto_ia import (
        _fallback_catalogo,
        _plantilla_respaldo_catalogo,
    )

    ctx = {
        "titulo": "CREATINA MONOHIDRATO",
        "subtitulo": "Materia prima alimentaria",
    }
    ficha = {
        "titulo": "Creatina Monohidrato",
        "fuente": "test",
        "texto": (
            "Apariencia: polvo cristalino blanco. Solubilidad: soluble en agua. "
            "DESCRIPCIÓN La creatina mejora el rendimiento deportivo y las dosis "
            "sugeridas para atletas. APLICACIONES Los culturistas usan creatina "
            "para ganancia muscular."
        ),
    }
    out = _fallback_catalogo("creatina monohidrato", [ficha], 2600, contexto_capas=ctx)
    assert len(out) >= 1
    texto = out[0]["texto"]
    assert _contar_palabras(texto) >= 120
    assert not _contiene_riesgo_meli(texto)
    assert "alimentar" in _norm(texto)
    assert "cosmet" not in _norm(texto)
    assert "farmac" not in _norm(texto)

    respaldo = _plantilla_respaldo_catalogo(ctx)
    anclas = _terminos_ancla_repeticion("creatina monohidrato", ctx, ficha["titulo"])
    assert _aceptar_texto_ia(respaldo, 2600, contexto_capas=ctx, anclas=anclas)


def test_repeticion_excesiva_detecta_nombre_multiples_veces():
    ctx = {"titulo": "CREATINA MONOHIDRATO"}
    anclas = _terminos_ancla_repeticion("creatina", ctx, "Creatina Monohidrato")
    texto = (
        "Creatina monohidrato es polvo. Creatina monohidrato se usa en industria.\n\n"
        "Segundo párrafo con aplicaciones técnicas amplias en matrices alimentarias."
    )
    assert _repeticion_excesiva(texto, anclas, ctx)
