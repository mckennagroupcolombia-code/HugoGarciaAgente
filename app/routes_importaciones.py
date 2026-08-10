"""
Importaciones — sección del módulo Logística Internacional (/app → Importaciones).

Endpoints bajo /api/importaciones/*. Acceso restringido: CHAT_API_TOKEN (admin) o
usuario de tickets con permiso `logistica-internacional` (mismo permiso que gatea
el módulo en el frontend, ver desktop/src/lib/logisticaAccess.ts), siguiendo el
mismo patrón híbrido de app/routes_rrhh.py.

Fuente de aliados/reglas: app/data/aliados_logisticos.json (varios aliados: DDP
y ordinaria, más la guía de cuándo usar cada modalidad) vía
app/services/aliados_logisticos.py. El cotizador con tarifas reales solo existe
para el aliado "china-latin-agent" (app/services/tarifas_china_latin_agent.py).
Los procesos de importación se guardan como tickets (categoría "importaciones",
ver app/tools/importaciones.py) — sin tabla nueva.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request


def _usuario_puede_importaciones(usuario: dict | None) -> bool:
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
    return bool(permisos.get("logistica-internacional"))


def _auth_importaciones(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            # Sin "id": deja que crear_ticket_importacion resuelva el creador real
            # (usuario admin en tickets.db) en vez de usar un id inexistente.
            request.importaciones_usuario = {"nombre": "Administrador (token)", "rol": {"nivel": 3}}
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
        if not _usuario_puede_importaciones(usuario):
            return jsonify({"error": "Importaciones requiere rol administrador o permiso 'logistica-internacional'"}), 403
        request.importaciones_usuario = usuario
        return f(*args, **kwargs)

    return wrapper


def register_importaciones_routes(app):
    @app.route("/api/importaciones/aliados", methods=["GET"])
    @_auth_importaciones
    def importaciones_aliados():
        from app.services.aliados_logisticos import listar_aliados, guia_modalidad
        return jsonify({"aliados": listar_aliados(), "guia_modalidad": guia_modalidad()})

    @app.route("/api/importaciones/cotizar", methods=["POST"])
    @_auth_importaciones
    def importaciones_cotizar():
        from app.services.aliados_logisticos import obtener_aliado
        from app.services.tarifas_china_latin_agent import cotizar_importacion

        body = request.get_json(silent=True) or {}
        aliado_id = (body.get("aliado_id") or "china-latin-agent").strip()
        aliado = obtener_aliado(aliado_id)
        if not aliado or not aliado.get("tiene_cotizador"):
            return jsonify({
                "error": f"El aliado '{aliado_id}' no tiene cotizador automático — solicitar cotización directa."
            }), 400
        try:
            kg = float(body["kg"]) if body.get("kg") not in (None, "") else None
            cbm = float(body["cbm"]) if body.get("cbm") not in (None, "") else None
            valor_fob_usd = (
                float(body["valor_fob_usd"]) if body.get("valor_fob_usd") not in (None, "") else None
            )
            modo = (body.get("modo") or "").strip() or None
            resultado = cotizar_importacion(kg=kg, cbm=cbm, valor_fob_usd=valor_fob_usd, modo=modo)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify(resultado)

    @app.route("/api/importaciones/procesos", methods=["GET"])
    @_auth_importaciones
    def importaciones_listar_procesos():
        from app.services.tickets_db import listar_tickets
        from app.tools.importaciones import CATEGORIA_IMPORTACIONES

        tickets = listar_tickets(request.importaciones_usuario, {"categoria": CATEGORIA_IMPORTACIONES})
        return jsonify({"procesos": tickets})

    @app.route("/api/importaciones/procesos", methods=["POST"])
    @_auth_importaciones
    def importaciones_crear_proceso():
        from app.services.aliados_logisticos import obtener_aliado
        from app.services.tarifas_china_latin_agent import cotizar_importacion
        from app.tools.importaciones import crear_ticket_importacion

        body = request.get_json(silent=True) or {}
        titulo = (body.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Falta el título del proceso"}), 400

        aliado_id = (body.get("aliado_id") or "china-latin-agent").strip()
        aliado = obtener_aliado(aliado_id)
        if not aliado:
            return jsonify({"error": f"Aliado '{aliado_id}' no encontrado"}), 400

        kg = float(body["kg"]) if body.get("kg") not in (None, "") else None
        cbm = float(body["cbm"]) if body.get("cbm") not in (None, "") else None
        valor_fob_usd = (
            float(body["valor_fob_usd"]) if body.get("valor_fob_usd") not in (None, "") else None
        )
        modo = (body.get("modo") or "").strip()

        cotizacion = None
        if aliado.get("tiene_cotizador") and (kg is not None or cbm is not None):
            try:
                cotizacion = cotizar_importacion(kg=kg, cbm=cbm, valor_fob_usd=valor_fob_usd, modo=modo or None)
                modo = modo or cotizacion.get("modo", "")
            except ValueError:
                cotizacion = None

        creador_id = (request.importaciones_usuario or {}).get("id")
        ok, mensaje, ticket = crear_ticket_importacion(
            titulo=titulo,
            proveedor=(body.get("proveedor") or "").strip(),
            aliado_id=aliado_id,
            modo=modo,
            kg=kg,
            cbm=cbm,
            valor_fob_usd=valor_fob_usd,
            cotizacion=cotizacion,
            creador_id=creador_id,
        )
        if not ok:
            return jsonify({"error": mensaje}), 400
        return jsonify({"mensaje": mensaje, "ticket": ticket})

    @app.route("/api/importaciones/historico", methods=["GET"])
    @_auth_importaciones
    def importaciones_historico():
        from app.services.importaciones_historico import historico_unificado
        return jsonify(historico_unificado())

    @app.route("/api/importaciones/compras-chicas/<int:compra_id>/comprado-por", methods=["POST"])
    @_auth_importaciones
    def importaciones_compra_chica_comprado_por(compra_id: int):
        from app.services.contabilidad_db import establecer_comprado_por_compra_exterior

        body = request.get_json(silent=True) or {}
        ok, err = establecer_comprado_por_compra_exterior(compra_id, body.get("comprado_por", ""))
        if not ok:
            return jsonify({"error": err}), 400
        return jsonify({"ok": True})
