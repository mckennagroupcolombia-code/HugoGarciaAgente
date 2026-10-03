"""
Ubicación de bultos — /api/bultos/*. Lógica en app/services/ubicacion_bultos.py. Sin LLM.

Consultar (buscar, «¿dónde está?» de una solicitud, ver fotos) lo puede todo el equipo
interno: quien recibe una solicitud de empacar necesita encontrar el bulto aunque no
tenga el permiso de Recepción. Registrar, mover y la bandeja «Por identificar» piden
los mismos permisos que Recepción de mercancía. Contador y colaborador externo, nada.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request, send_file

from app.routes_canales import _auth

_PERMISOS_ESCRIBIR = ("recepcion-mercancia", "pedidos", "empaque", "control-inventario", "stock")
_MAX_FOTO = 15 * 1024 * 1024


def _es_admin(usuario: dict) -> bool:
    try:
        from app.services.tickets_db import es_admin_efectivo

        return bool(es_admin_efectivo(usuario))
    except Exception:
        return False


def _es_interno(usuario: dict | None) -> bool:
    if not usuario:
        return False
    if _es_admin(usuario):
        return True
    permisos = usuario.get("permisos_secciones") or {}
    return not (permisos.get("contador") or permisos.get("colaborador_externo"))


def _puede_escribir(usuario: dict | None) -> bool:
    if not _es_interno(usuario):
        return False
    if _es_admin(usuario):  # type: ignore[arg-type]
        return True
    permisos = (usuario or {}).get("permisos_secciones")
    if not permisos:  # sin mapa de permisos: mismo criterio que Recepción
        return True
    return any(permisos.get(p) for p in _PERMISOS_ESCRIBIR)


def _requiere(regla, mensaje: str):
    def deco(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if not regla(getattr(request, "tickets_usuario", None)):
                return jsonify({"error": mensaje}), 403
            return f(*args, **kwargs)

        return wrapper

    return deco


_leer = _requiere(_es_interno, "Sin permiso para consultar bultos")
_escribir = _requiere(_puede_escribir, "Sin permiso para registrar bultos")


def register_bultos_routes(app):
    from app.services import ubicacion_bultos as B

    def _u():
        return request.tickets_usuario  # type: ignore[attr-defined]

    def _resp(fn, *a, **kw):
        try:
            return jsonify(fn(*a, **kw))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except LookupError as e:
            return jsonify({"error": str(e)}), 404

    def _foto_subida() -> bytes | None:
        f = request.files.get("foto")
        if not f or not f.filename:
            return None
        datos = f.read(_MAX_FOTO + 1)
        if len(datos) > _MAX_FOTO:
            raise ValueError("La foto supera 15 MB")
        return datos

    @app.route("/api/bultos", methods=["GET"])
    @_auth
    @_leer
    def bultos_listar():
        a = request.args
        return jsonify({
            "bultos": B.listar(a.get("q") or "", sede=a.get("sede") or "",
                               incluir_agotados=a.get("agotados") == "1"),
            "sedes": list(B.SEDES),
            "puede_escribir": _puede_escribir(_u()),
        })

    @app.route("/api/bultos/resumen", methods=["GET"])
    @_auth
    @_leer
    def bultos_resumen():
        return jsonify(B.resumen())

    @app.route("/api/bultos/en-texto", methods=["POST"])
    @_auth
    @_leer
    def bultos_en_texto():
        texto = str((request.get_json(silent=True) or {}).get("texto") or "")[:4000]
        return jsonify({"productos": B.en_texto(texto)})

    @app.route("/api/bultos/productos", methods=["GET"])
    @_auth
    @_leer
    def bultos_productos():
        return jsonify({"productos": B.buscar_productos(request.args.get("q") or "")})

    @app.route("/api/bultos/ubicaciones", methods=["GET"])
    @_auth
    @_leer
    def bultos_ubicaciones():
        return jsonify({"ubicaciones": B.ubicaciones_usadas(), "sedes": list(B.SEDES)})

    @app.route("/api/bultos/foto/<archivo>", methods=["GET"])
    @_auth
    @_leer
    def bultos_foto(archivo: str):
        ruta = B.ruta_foto(archivo)
        if not ruta:
            return jsonify({"error": "Sin foto"}), 404
        resp = send_file(str(ruta), mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "private, max-age=86400"
        return resp

    @app.route("/api/bultos/<int:bid>", methods=["GET"])
    @_auth
    @_leer
    def bultos_obtener(bid: int):
        b = B.obtener(bid)
        return (jsonify(b), 200) if b else (jsonify({"error": "Bulto no encontrado"}), 404)

    @app.route("/api/bultos", methods=["POST"])
    @_auth
    @_escribir
    def bultos_crear():
        # multipart (foto de la cámara) o JSON (foto de la bandeja)
        d = request.form.to_dict() if request.files or request.form else (request.get_json(silent=True) or {})
        try:
            foto = _foto_subida()
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        rid = d.get("recepcion_id")
        return _resp(B.crear, _u(), sku=d.get("sku") or "", sede=d.get("sede") or "",
                     ubicacion=d.get("ubicacion") or "", cantidad=d.get("cantidad"),
                     unidad=d.get("unidad") or "", lote=d.get("lote") or "", nota=d.get("nota") or "",
                     recepcion_id=int(rid) if rid else None, foto=foto,
                     foto_origen=d.get("foto_origen") or "", foto_ref=str(d.get("foto_ref") or ""))

    @app.route("/api/bultos/<int:bid>/fotos", methods=["POST"])
    @_auth
    @_escribir
    def bultos_agregar_foto(bid: int):
        try:
            foto = _foto_subida()
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if not foto:
            return jsonify({"error": "No llegó la foto"}), 400
        return _resp(B.agregar_foto, bid, _u(), foto)

    @app.route("/api/bultos/<int:bid>/mover", methods=["POST"])
    @_auth
    @_escribir
    def bultos_mover(bid: int):
        d = request.get_json(silent=True) or {}
        return _resp(B.mover, bid, _u(), sede=d.get("sede") or "", ubicacion=d.get("ubicacion") or "")

    @app.route("/api/bultos/<int:bid>", methods=["PATCH"])
    @_auth
    @_escribir
    def bultos_actualizar(bid: int):
        d = request.get_json(silent=True) or {}
        return _resp(B.actualizar, bid, _u(), cantidad=d.get("cantidad"), lote=d.get("lote"),
                     nota=d.get("nota"), estado=d.get("estado"))

    @app.route("/api/bultos/por-identificar", methods=["GET"])
    @_auth
    @_escribir
    def bultos_bandeja():
        return jsonify({"fotos": B.por_identificar()})

    @app.route("/api/bultos/por-identificar/<origen>/<ref>/foto", methods=["GET"])
    @_auth
    @_escribir
    def bultos_bandeja_foto(origen: str, ref: str):
        ruta = B.ruta_foto_bandeja(origen, ref)
        if not ruta:
            return jsonify({"error": "Sin foto"}), 404
        resp = send_file(ruta)
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp

    @app.route("/api/bultos/por-identificar/<origen>/<ref>/descartar", methods=["POST"])
    @_auth
    @_escribir
    def bultos_bandeja_descartar(origen: str, ref: str):
        try:
            B.descartar(origen, ref, _u())
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})
