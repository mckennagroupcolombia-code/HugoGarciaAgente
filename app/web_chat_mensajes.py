"""Textos reutilizables del chat web (burbuja): regulatorio, WhatsApp, historial."""

from __future__ import annotations

from app.web_chat_intents import wa_publico


def nota_regulatoria_materias_primas_invima() -> str:
    return (
        "Como somos proveedores de materias primas e insumos para formulación, nuestros productos "
        "no requieren registro INVIMA — eso aplica al producto terminado. "
        "Lo que podemos facilitarle es la **ficha técnica** y/o el **COA** (certificado de análisis). "
        "¿Le interesa?"
    )


def nota_regulatoria_invima_reempaque() -> str:
    return (
        "Tienes toda la razón en que el INVIMA otorga registros para la modalidad de Reempaque "
        "o Envase, pero la norma hace una distinción fundamental que aclara por qué no aplica "
        "en este caso:\n\n"
        "**¿Cuándo sí aplica?** Aplica exclusivamente cuando se toma un granel para transformarlo "
        "en un Producto Terminado de Consumo Directo bajo una marca comercial destinada a góndola "
        "o retail (por ejemplo, bolsas de frutos secos de pasabocas para el consumidor final). "
        "Esos productos sí requieren una Notificación Sanitaria (NSA) de reempaque.\n\n"
        "**¿Por qué no aplica con nosotros?** Porque nosotros comercializamos el producto en su "
        "estado de Materia Prima Pura / Insumo Grado Industrial o Alimentario. Al venderse como "
        "un insumo técnico para que tú u otras empresas lo utilicen como ingrediente en diversos "
        "desarrollos (cosméticos, alimentos procesados, fórmulas farmacéuticas, etc.), el INVIMA "
        "no lo clasifica como producto terminado.\n\n"
        "Por ley, las materias primas puras destinadas a procesos de transformación no se amparan "
        "con registros comerciales de marca, sino con la trazabilidad técnica obligatoria: el "
        "**Visto Bueno de Importación (VUCE)** de la aduana y el **Certificado de Análisis (COA)** "
        "del lote de origen.\n\n"
        "Ten la total seguridad de que nuestro producto es 100% lícito, cumple con la cadena de "
        "custodia y cuenta con los soportes de laboratorio que garantizan su pureza para el uso "
        "que le vayas a dar en tu producción."
    )


def nota_regulatoria_invima_explicacion() -> str:
    return (
        "Es simple: el INVIMA divide los productos en dos categorías muy claras:\n\n"
        "**Productos Terminados (llevan Registro/Notificación):** Son mezclas listas para el "
        "consumo directo del público (por ejemplo, un champú, una crema facial o una granola "
        "empaquetada). Como el usuario final los consume de inmediato, el INVIMA les asigna "
        "un código comercial fijo.\n\n"
        "**Materias Primas Puras (no llevan Registro):** Son insumos en estado puro (como un "
        "ácido, un extracto, un fruto seco o una semilla) que sirven para que otras empresas "
        "fabriquen cosas diferentes. Como el INVIMA no sabe si vas a usar esa materia prima para "
        "formular un cosmético, un suplemento, un alimento o un producto industrial, no puede "
        "ampararla con un único registro comercial.\n\n"
        "Por eso, la ley establece que la seguridad de una materia prima no se mide con un código "
        "en la etiqueta, sino con su **Certificado de Análisis (COA)** de laboratorio y su "
        "**Visto Bueno de Importación (VUCE)**, que garantizan que el lote es químicamente puro, "
        "lícito y seguro para ser transformado."
    )


def nota_regulatoria_materias_primas_invima_larga() -> str:
    return (
        "Al ser una materia prima pura destinada a la elaboración de productos con diversos fines "
        "(alimentos, cosmética o desarrollo industrial), el INVIMA no otorga registros comerciales "
        "(RSA/NSA), ya que estos aplican únicamente para productos terminados de consumo directo.\n\n"
        "El producto es 100% legal y seguro: se comercializa bajo el **Visto Bueno Técnico de "
        "Importación (VUCE)** que avala su ingreso al país como insumo seguro y apto para su "
        "posterior transformación o dosificación.\n\n"
        "Con tu compra garantizamos total trazabilidad adjuntando:\n"
        "- Ficha técnica de origen con especificaciones.\n"
        "- Certificado de Análisis (COA) del lote actual.\n\n"
        "¡Puedes comprar con total tranquilidad para el desarrollo de tus productos!"
    )


def nota_asesor_whatsapp_chat_web(
    *,
    motivo: str = "el dato exacto de lote o la documentación adicional",
) -> str:
    display, digits = wa_publico()
    return (
        f"\n\nSi necesita {motivo}, use el **botón de WhatsApp** en la página o escríbanos "
        f"al **{display}**: https://wa.me/{digits}\n"
        "Un **asesor humano** le brinda la información y le hace seguimiento por ese medio."
    )


def nota_seguimiento_pedido_whatsapp() -> str:
    """Cierre opcional para documentos / cotización formal (tono más corto)."""
    display, digits = wa_publico()
    return (
        f"\n\nPara seguimiento de pedido o cotización formal con asesor: WhatsApp {display} "
        f"(https://wa.me/{digits})."
    )
