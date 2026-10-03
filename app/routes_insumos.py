"""
Insumos — /api/insumos/*: foto de referencia, conteo físico y contador de unidades.
Lógica en app/services/insumos.py. Sin LLM; no llama a Alegra ni a MeLi.

Permiso: administrador, o cualquiera de los que compran, reciben o arman combos
(`pagos`, `libro-mayor`, `recepcion-mercancia`, `pedidos`, `empaque`,
`control-inventario`, `stock`, `combos`, `mapa-sistema`). La foto se ve con
`?token=` de la sesión, igual que las de Recepción.
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, request, send_file

from app.routes_canales import _auth

_PERMISOS = ("pagos", "libro-mayor", "recepcion-mercancia", "pedidos", "empaque",
             "control-inventario", "stock", "combos", "mapa-sistema")
_MAX_FOTO = 15 * 1024 * 1024


def _puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    permisos = usuario.get("permisos_secciones")
    if not permisos:  # sin mapa de permisos: mismo criterio que el panel
        return True
    return any(permisos.get(p) for p in _PERMISOS)


def _permiso(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not _puede(getattr(request, "tickets_usuario", None)):
            return jsonify({"error": "Sin permiso para ver los insumos"}), 403
        return f(*args, **kwargs)

    return wrapper


def register_insumos_routes(app):
    from app.services import insumos as I

    def _u():
        return request.tickets_usuario  # type: ignore[attr-defined]

    @app.route("/api/insumos", methods=["GET"])
    @_auth
    @_permiso
    def insumos_resumen():
        skus = [s for s in (request.args.get("skus") or "").split(",") if s.strip()]
        return jsonify(I.resumen(request.args.get("q") or "", skus=skus or None,
                                 estado=request.args.get("estado") or "",
                                 refrescar=request.args.get("refrescar") == "1"))

    @app.route("/api/insumos/<path:sku>/foto", methods=["GET"])
    @_auth
    @_permiso
    def insumos_ver_foto(sku: str):
        ruta = I.ruta_foto(sku)
        if not ruta:
            return jsonify({"error": "Sin foto"}), 404
        resp = send_file(str(ruta), mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "private, max-age=300"
        return resp

    @app.route("/api/insumos/<path:sku>/foto", methods=["POST"])
    @_auth
    @_permiso
    def insumos_subir_foto(sku: str):
        f = request.files.get("foto")
        if not f or not f.filename:
            return jsonify({"error": "No llegó la foto"}), 400
        datos = f.read(_MAX_FOTO + 1)
        if len(datos) > _MAX_FOTO:
            return jsonify({"error": "La foto supera 15 MB"}), 400
        try:
            return jsonify(I.guardar_foto(sku, datos, f.filename, _u()))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/insumos/<path:sku>/conteo", methods=["POST"])
    @_auth
    @_permiso
    def insumos_conteo(sku: str):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(I.registrar_conteo(sku, d.get("cantidad"), _u(),
                                              nota=d.get("nota") or "", fecha=d.get("fecha")))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
