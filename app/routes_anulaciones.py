"""
Anulaciones / notas crédito — API del panel del contador (/app → Contabilidad → Anulaciones).

Endpoints bajo /api/anulaciones/* (y alias /app/api/anulaciones/* para el proxy
del panel). Acceso: CHAT_API_TOKEN (admin) o usuario de tickets con permiso
`libro-mayor` — mismo patrón híbrido de app/routes_proveedores.py.

`libro-mayor` y no `facturacion`: un expediente muestra el motivo por el que se
anuló una venta, el monto reintegrado al comprador y el asiento contable — es
el mismo nivel de sensibilidad que el libro mayor, no el de una lista de
facturas.

Datos: app/services/anulaciones_db.py (SQLite app/data/contabilidad.db).
Ninguna ruta llama a un LLM. La única que toca Alegra es POST
/api/anulaciones/<id>/emitir, y respeta la política de autonomía salvo que el
operador pase `forzar: true` — decisión humana explícita que queda registrada
en la línea de tiempo con su nombre.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        if ((usuario.get("rol") or {}).get("nivel", 0)) >= 3:
            return True
    permisos = usuario.get("permisos_secciones") or {}
    return bool(permisos.get("libro-mayor"))


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import (
                aplicar_privilegios_admin_cynthia,
                get_usuario_by_token,
            )

            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not _usuario_puede(usuario):
            return jsonify(
                {"error": "Anulaciones requiere rol administrador o permiso 'libro-mayor'"}
            ), 403
        request.environ["ra_usuario"] = usuario
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    """Registra la ruta en /api/... y /app/api/... (ver docs/agentic/modules/desktop-panel.md)."""

    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def _body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _actor() -> str:
    """Quién hizo la acción, para la línea de tiempo del expediente.

    Un expediente sin actor no sirve como precedente: lo primero que pregunta
    quien lo lee meses después es quién decidió qué.
    """
    usuario = request.environ.get("ra_usuario") or {}
    uid = usuario.get("id")
    nombre = usuario.get("nombre") or usuario.get("username") or ""
    if uid:
        return f"usuario:{uid}" + (f" ({nombre})" if nombre else "")
    return "usuario:api"


def register_anulaciones_routes(app):
    from app.services import anulaciones_db as adb

    @_dual(app, "/api/anulaciones/resumen", methods=["GET"])
    @_auth
    def anulaciones_resumen():
        """La deuda abierta: cuántas anulaciones sin nota crédito, por cuánto y
        desde hace cuánto la más antigua."""
        adb.init_db()
        return jsonify(adb.deuda_abierta())

    @_dual(app, "/api/anulaciones", methods=["GET"])
    @_auth
    def anulaciones_listar():
        adb.init_db()
        estado = (request.args.get("estado") or "").strip()
        origen = (request.args.get("origen") or "").strip() or None
        abiertos = request.args.get("abiertos") in ("1", "true")
        q = (request.args.get("q") or "").strip()
        try:
            limite = min(int(request.args.get("limite") or 200), 500)
        except ValueError:
            limite = 200

        if q:
            return jsonify({"anulaciones": adb.buscar(q, limite=limite)})
        estados = (estado,) if estado else None
        return jsonify(
            {"anulaciones": adb.listar(estados=estados, abiertos=abiertos, origen=origen, limite=limite)}
        )

    @_dual(app, "/api/anulaciones/<identificador>", methods=["GET"])
    @_auth
    def anulaciones_detalle(identificador: str):
        """Expediente completo. Acepta código (RA-2026-0142), referencia, pack
        id o número de factura — el operador pega lo que tenga a mano."""
        adb.init_db()
        caso = adb.resolver(identificador)
        if not caso:
            return jsonify({"error": "No existe ese expediente"}), 404
        return jsonify(adb.expediente_completo(caso["id"]))

    @_dual(app, "/api/anulaciones/<int:caso_id>/nota", methods=["POST"])
    @_auth
    def anulaciones_nota(caso_id: int):
        texto = (_body().get("texto") or "").strip()
        if not texto:
            return jsonify({"error": "La nota no puede estar vacía"}), 400
        try:
            adb.agregar_nota(caso_id, texto, actor=_actor())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(adb.expediente_completo(caso_id))

    @_dual(app, "/api/anulaciones/<int:caso_id>/inventario", methods=["POST"])
    @_auth
    def anulaciones_inventario(caso_id: int):
        """El eje de inventario, separado del fiscal: el reingreso se registra
        cuando el producto llega físicamente, no cuando se emite la NC."""
        from app.services import anulaciones_motor as motor

        recibido = bool(_body().get("recibido"))
        nota = (_body().get("nota") or "").strip()
        caso = motor.registrar_retorno_inventario(
            caso_id, recibido=recibido, actor=_actor(), nota=nota
        )
        if not caso:
            return jsonify({"error": "No existe ese expediente"}), 404
        motor.cerrar_si_completo(caso_id, actor=_actor())
        return jsonify(adb.expediente_completo(caso_id))

    @_dual(app, "/api/anulaciones/<int:caso_id>/descartar", methods=["POST"])
    @_auth
    def anulaciones_descartar(caso_id: int):
        """Cierra un caso que NO necesita nota crédito (p. ej. un reclamo
        resuelto a favor del vendedor: no hubo reintegro, la venta sigue viva).
        No borra nada — `descartada` es un estado."""
        motivo = (_body().get("motivo") or "").strip()
        if not motivo:
            return jsonify({"error": "Explica por qué se descarta (queda en el expediente)"}), 400
        try:
            caso = adb.transicionar(
                caso_id, "descartada", actor=_actor(), resumen=f"Descartado: {motivo}"
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(adb.expediente_completo(caso["id"]))

    @_dual(app, "/api/anulaciones/<int:caso_id>/emitir", methods=["POST"])
    @_auth
    def anulaciones_emitir(caso_id: int):
        """Emite la nota crédito.

        `forzar: true` salta la política de autonomía — es la aprobación humana
        de un caso que el motor no emite solo (rezago Siigo, reembolso a cargo
        de MeLi, monto sobre el umbral). Queda registrada con el nombre de quien
        la dio: es exactamente la decisión que después alguien va a querer poder
        rastrear.
        """
        from app.services import anulaciones_motor as motor

        forzar = bool(_body().get("forzar"))
        actor = _actor()
        if forzar:
            adb.registrar_evento(
                caso_id, tipo="decidido", actor=actor,
                resumen="Emisión aprobada manualmente desde el panel (fuera de la política de autonomía).",
            )
        resultado = motor.emitir(caso_id, actor=actor, forzar=forzar)
        caso = adb.obtener(caso_id)
        if caso:
            try:
                adb.actualizar(
                    caso_id,
                    relato=motor.relato_largo(caso, adb.eventos(caso_id)),
                )
            except Exception:
                pass
            motor.cerrar_si_completo(caso_id, actor=actor)
        codigo_http = 200 if resultado.get("ok") else 409
        return jsonify({**resultado, "expediente": adb.expediente_completo(caso_id)}), codigo_http
