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
