"""/api/conexiones — estado en vivo de todas las integraciones (panel Sistemas → Conexiones).

Solo administradores, igual que los asistentes OAuth de MeLi y Gmail que el panel
incrusta: el detalle nombra cuentas y dice qué llave falla. Ver
app/services/conexiones.py.
"""

from flask import jsonify, request

from app.routes_gmail_oauth import _auth_gmail_oauth as _solo_admin


def register_conexiones_routes(app):
    @app.route("/api/conexiones", methods=["GET"])
    @app.route("/app/api/conexiones", methods=["GET"])
    @_solo_admin
    def conexiones_estado():
        from app.services.conexiones import estado_conexiones

        forzar = request.args.get("forzar") in ("1", "true")
        return jsonify(estado_conexiones(forzar=forzar, solo=request.args.get("id") or None))

    @app.route("/api/conexiones/mercadopago/token", methods=["POST"])
    @app.route("/app/api/conexiones/mercadopago/token", methods=["POST"])
    @_solo_admin
    def conexiones_mercadopago_token():
        """Pega un Access Token nuevo de Mercado Pago: lo prueba y, si sirve, lo deja en uso."""
        from app.services.conexiones import reconectar_mercadopago

        body = request.get_json(silent=True) or {}
        u = getattr(request, "gmail_oauth_usuario", None) or {}
        r = reconectar_mercadopago(
            str(body.get("token") or ""),
            usuario=str(u.get("nombre") or u.get("usuario") or ""),
            aceptar_otra_cuenta=bool(body.get("aceptar_otra_cuenta")),
        )
        # 200 también cuando el token no sirve: el panel lee `ok`, `error` y `otra_cuenta`.
        return jsonify(r)
