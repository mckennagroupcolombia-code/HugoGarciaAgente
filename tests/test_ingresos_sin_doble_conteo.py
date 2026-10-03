"""El ingreso se reconoce UNA vez, aunque la venta tenga orden y factura.

El libro toma ingresos de tres fuentes que se solapan: las órdenes de MeLi, los
pedidos de la tienda y las facturas. Una venta de MeLi facturada aparecía en dos
y se contaba dos veces.

Lo que hace grave el caso —y lo que estos tests fijan— es que el daño estaba
contenido por accidente: el listado de facturas se corta a los 28 segundos, así
que solo alcanzaba a traer un día. Subir ese presupuesto habría inflado el
ingreso solo, sin que nadie tocara nada y por un monto distinto cada vez.
"""

from __future__ import annotations

from app.services.contabilidad_ledger import factura_ya_contada


def test_una_factura_de_mercadolibre_ya_esta_contada():
    f = {"observations": "Venta MercadoLibre — Pack 20000150064590", "total": 20100}
    assert factura_ya_contada(f) is True


def test_una_factura_de_la_tienda_web_ya_esta_contada():
    assert factura_ya_contada({"observations": "Pedido web MCKG-250"}) is True


def test_una_venta_directa_SI_cuenta():
    """Si no viene de un canal propio, la factura es la única fuente: omitirla
    perdería la venta, que es el error contrario y peor."""
    assert factura_ya_contada({"observations": "Venta mostrador"}) is False
    assert factura_ya_contada({"observations": ""}) is False
    assert factura_ya_contada({}) is False


def test_la_marca_no_depende_de_mayusculas_ni_del_campo():
    assert factura_ya_contada({"observations": "VENTA MERCADOLIBRE — Orden 2000018359733730"}) is True
    assert factura_ya_contada({"observaciones": "venta mercadolibre — orden 2000018359733730"}) is True


def test_un_numero_corto_no_es_una_orden_de_mercadolibre():
    """Los ids de MeLi tienen 13+ dígitos. Exigir al menos 8 evita que un número
    cualquiera del texto convierta una factura en «ya contada» y la haga
    desaparecer del ingreso — el error contrario al doble conteo, y peor,
    porque una venta que falta no la reclama nadie."""
    assert factura_ya_contada({"observations": "Venta MercadoLibre — Orden 123"}) is False


def test_una_mencion_sin_numero_de_orden_no_cuenta_como_marca():
    """«Nota sobre la venta MercadoLibre anterior» no es una factura de venta.

    Lo que prueba que la factura corresponde a una orden ya contada es el
    NÚMERO que acompaña la marca, no el texto suelto.
    """
    assert factura_ya_contada({"observations": "Nota sobre venta MercadoLibre anterior"}) is False
    assert factura_ya_contada({"observations": "Venta mostrador"}) is False
    assert factura_ya_contada({"observations": "TERMINOS Y CONDICIONES  La siguiente info"}) is False


def test_la_marca_no_tiene_que_estar_al_principio():
    """El caso que costó $17,7M de agosto.

    Las facturas de corrección del IVA duplicado de astroselling empiezan por
    «Reemplaza FV-…» y traen la marca DESPUÉS. Con `startswith` se escapaban 343
    facturas de agosto, que se habrían contado dos veces: una por la orden de
    MeLi y otra por su factura de reemplazo.
    """
    obs = ("Reemplaza FV-2-67352 — corrección IVA duplicado parcial (astroselling). "
           "Venta Mercado Libre #2000013456789")
    assert factura_ya_contada({"observations": obs}) is True


def test_cubre_las_dos_grafias_de_los_dos_sistemas():
    """Alegra escribe «Venta MercadoLibre — Pack …»; astroselling, en Siigo,
    «Venta Mercado Libre #… - Facturado desde astroselling». Cubrir solo una
    dejaba pasar todo el histórico del otro sistema."""
    assert factura_ya_contada({"observations": "Venta MercadoLibre — Pack 20000150064590"}) is True
    assert factura_ya_contada(
        {"observations": "Venta Mercado Libre #2000014851989261 - Facturado desde astroselling"}
    ) is True
