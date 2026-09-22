from app.tools.reenvio_alertas_banco import clasificar


def test_abono_qr_y_transferencia():
    assert clasificar("¡Listo! Todo salió bien con tus movimientos Bancolombia: Recibiste $122100.00 por QR de X") == "abono"
    assert clasificar("Recibiste un pago por $9000000.00 de MERCADOPAGO SA a tu cuenta AHORROS") == "abono"


def test_otp_y_claves_nunca_salen():
    assert clasificar("No lo compartas. Por tu seguridad Este es tu código HUGO Bancolombia te comparte el codigo OTP 265104") == "bloqueado"
    assert clasificar("Notificación Seguridad Hola Hugo, ¡Listo! Cambiaste tu clave el 15/09/2026") == "bloqueado"
    # Aunque mencione "recibiste", un OTP sigue bloqueado.
    assert clasificar("Recibiste tu código OTP 123456") == "bloqueado"


def test_salidas_separadas_de_abonos():
    assert clasificar("Notificación Transacción exitosa Hola HUGO, Enviaste un pago de Proveedores") == "salida"
    assert clasificar("Notificación Alerta y Seguridad Hola, Se aprobó la transacción Pagar proveedores") == "bloqueado"


def test_extraer_aviso_sin_saludo_ni_pie():
    from app.tools.reenvio_alertas_banco import extraer_aviso

    t = ("¡Listo! Todo salió bien con tus movimientos Bancolombia: Recibiste $68,000.00 por QR de "
         "Laura Sofia Jaramillo Gonzalez en tu cuenta *0974 el 2026/09/22 a las 12:26. "
         "¿Dudas? Llama al 018000931987.")
    assert extraer_aviso(t) == ("Recibiste $68,000.00 por QR de Laura Sofia Jaramillo Gonzalez "
                                "en tu cuenta *0974 el 2026/09/22 a las 12:26.")
    assert extraer_aviso("<p>Hola</p><p>Recibiste&nbsp;$10.00 de X</p>") == "Recibiste $10.00 de X"
    assert extraer_aviso("sin movimiento") == ""


def test_destino_por_defecto_es_la_asesora(monkeypatch):
    from app.tools import reenvio_alertas_banco as rab

    monkeypatch.delenv("REENVIO_BANCO_WA", raising=False)
    monkeypatch.delenv("REENVIO_BANCO_DESTINO", raising=False)
    assert rab.destino() == "23jenniffergarcia@gmail.com"
    assert rab.destino_wa() == "573182432463"
    monkeypatch.setenv("REENVIO_BANCO_WA", "+57 300 111 2233@c.us")
    assert rab.destino_wa() == "573001112233"
