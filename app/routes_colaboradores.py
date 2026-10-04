"""API de Colaboradores (diagramas compartidos). Ver app/services/colaboradores.py."""

from __future__ import annotations

import json
from functools import wraps

from flask import g, jsonify, request, send_file


def _usuario():
    from app.api_auth import bearer_token_from_request
    from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

    try:
        tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
        return aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
    except Exception:
        return None


def _miembro(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.services import colaboradores as col

        u = _usuario()
        if not u:
            return jsonify({"error": "No autorizado"}), 401
        if not col.es_miembro(u):
            return jsonify({"error": "Colaboradores es un espacio entre Armando y sus colaboradores."}), 403
        g.colab_usuario = u
        return f(*args, **kwargs)

    return wrapper


def _suyo(f):
    """El diagrama pedido tiene que ser de la pareja de quien lo pide.

    Sin esto, `colaborador_externo` era la llave de TODO el espacio: un segundo
    colaborador abriría los diagramas del primero con solo cambiar el id.
    """
    @wraps(f)
    def wrapper(did: int, *args, **kwargs):
        from app.services import colaboradores as col

        if not col.puede_ver(did, g.colab_usuario):
            return jsonify({"error": "No encontrado"}), 404
        return f(did, *args, **kwargs)

    return wrapper


_absorbidos: set[int] = set()


def register_colaboradores_routes(app):
    from app.services import colaboradores as col

    @app.route("/api/colaboradores/diagramas", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas", methods=["GET"])
    @_miembro
    def colab_listar():
        from app.services import colab_tablero as tb

        lista = col.listar(g.colab_usuario, request.args.get("archivados") == "1")
        res = tb.resumenes([d["id"] for d in lista])
        for d in lista:
            d["tablero"] = res.get(int(d["id"]))
        return jsonify({"diagramas": lista,
                        "yo": {"id": g.colab_usuario.get("id"), "nombre": g.colab_usuario.get("nombre"),
                               "anfitrion": col.es_anfitrion(g.colab_usuario)},
                        "carriles": col.CARRILES, "tipos": {k: v[1] for k, v in col.TIPOS.items()}})

    @app.route("/api/colaboradores/diagramas", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas", methods=["POST"])
    @_miembro
    def colab_crear():
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.crear(d.get("titulo") or "", int(g.colab_usuario["id"]),
                                     d.get("descripcion") or "", d.get("doc"),
                                     d.get("colaborador_id"))), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>", methods=["GET"])
    @_miembro
    def colab_obtener(did: int):
        d = col.obtener(did, g.colab_usuario)
        return (jsonify(d), 200) if d else (jsonify({"error": "No encontrado"}), 404)

    @app.route("/api/colaboradores/diagramas/<int:did>", methods=["PUT"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>", methods=["PUT"])
    @_miembro
    @_suyo
    def colab_guardar(did: int):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.guardar(did, d.get("doc") or {}, int(d.get("version") or 0),
                                       int(g.colab_usuario["id"]), titulo=d.get("titulo"),
                                       descripcion=d.get("descripcion"), resumen=d.get("resumen") or ""))
        except col.Conflicto as c:
            return jsonify({"error": "conflicto", "mensaje": str(c), "actual": c.actual}), 409
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/versiones", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/versiones", methods=["GET"])
    @_miembro
    @_suyo
    def colab_versiones(did: int):
        return jsonify({"versiones": col.versiones(did)})

    @app.route("/api/colaboradores/diagramas/<int:did>/restaurar", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/restaurar", methods=["POST"])
    @_miembro
    @_suyo
    def colab_restaurar(did: int):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.restaurar(did, int(d.get("a_version") or 0), int(d.get("version") or 0),
                                         int(g.colab_usuario["id"])))
        except col.Conflicto as c:
            return jsonify({"error": "conflicto", "mensaje": str(c), "actual": c.actual}), 409
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/archivar", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/archivar", methods=["POST"])
    @_miembro
    @_suyo
    def colab_archivar(did: int):
        d = request.get_json(silent=True) or {}
        return jsonify(col.archivar(did, bool(d.get("archivado", True))))

    @app.route("/api/colaboradores/diagramas/<int:did>/consenso", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/consenso", methods=["POST"])
    @_miembro
    @_suyo
    def colab_consenso(did: int):
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.accion_consenso(
                did, int(g.colab_usuario["id"]), str(d.get("nodo") or ""), str(d.get("accion") or ""),
                texto=d.get("texto") or "", propuesta=d.get("propuesta") or ""))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/operacion", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/operacion", methods=["POST"])
    @_miembro
    @_suyo
    def colab_operacion(did: int):
        """Una jugada del diorama de Operación (simulación: no toca Alegra ni la contabilidad)."""
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.accion_operacion(did, int(g.colab_usuario["id"]), str(d.get("accion") or ""),
                                                d.get("datos") or {}))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/media", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/media", methods=["POST"])
    @_miembro
    @_suyo
    def colab_subir_media(did: int):
        f = request.files.get("archivo")
        if not f:
            return jsonify({"error": "No llegó el archivo"}), 400
        datos = f.read()
        if len(datos) > col.MAX_MEDIA_BYTES:
            return jsonify({"error": "El archivo supera los 15 MB"}), 400
        try:
            return jsonify(col.guardar_media(did, datos, f.filename or "")), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    # ── Miembros: proyectos personales y compartidos (3-oct-2026) ─────────────

    @app.route("/api/colaboradores/usuarios", methods=["GET"])
    @app.route("/app/api/colaboradores/usuarios", methods=["GET"])
    @_miembro
    def colab_invitables():
        """A quién puede invitar un anfitrión (nombre y foto). Un colaborador externo no invita."""
        if not col.es_anfitrion(g.colab_usuario):
            return jsonify({"error": "Solo un anfitrión invita gente"}), 403
        return jsonify({"usuarios": col.invitables(g.colab_usuario)})

    @app.route("/api/colaboradores/diagramas/<int:did>/miembros", methods=["GET", "POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/miembros", methods=["GET", "POST"])
    @_miembro
    @_suyo
    def colab_miembros(did: int):
        if request.method == "GET":
            return jsonify({"miembros": col.miembros(did), "soy_dueno": col.es_dueno(did, int(g.colab_usuario["id"]))})
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(col.agregar_miembro(did, g.colab_usuario, int(d.get("usuario_id") or 0)))
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/miembros/<int:uid>", methods=["DELETE"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/miembros/<int:uid>", methods=["DELETE"])
    @_miembro
    @_suyo
    def colab_quitar_miembro(did: int, uid: int):
        try:
            return jsonify(col.quitar_miembro(did, g.colab_usuario, uid))
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    # ── Tablero del proyecto (app/services/colab_tablero.py) ──────────────────

    @app.route("/api/colaboradores/diagramas/<int:did>/tablero", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/tablero", methods=["GET"])
    @_miembro
    @_suyo
    def colab_tablero(did: int):
        from app.services import colab_tablero as tb

        # Una sola vista (3-oct-2026): las cajas del edificio entran al mapa como rama «Proceso»
        # la primera vez que se abre el proyecto en este proceso (idempotente si se repite).
        if did not in _absorbidos:
            tb.absorber_edificio(did, int(g.colab_usuario["id"]))
            _absorbidos.add(did)
        return jsonify({"tarjetas": tb.listar(did), "ritmo": tb.ritmo(did), "tipos": tb.TIPOS,
                        "participantes": {str(u): col._nombre(u) for u in tb._pareja(did)}})

    @app.route("/api/colaboradores/diagramas/<int:did>/tablero/visto", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/tablero/visto", methods=["POST"])
    @_miembro
    @_suyo
    def colab_tablero_visto(did: int):
        from app.services import colab_tablero as tb

        return jsonify({"registrado": tb.marcar_visto(did, int(g.colab_usuario["id"]))})

    @app.route("/api/colaboradores/diagramas/<int:did>/tarjetas", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/tarjetas", methods=["POST"])
    @_miembro
    @_suyo
    def colab_tarjeta_crear(did: int):
        from app.services import colab_tablero as tb

        try:
            return jsonify(tb.crear(did, int(g.colab_usuario["id"]), request.get_json(silent=True) or {})), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/tarjetas/<int:tid>", methods=["PATCH", "DELETE"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/tarjetas/<int:tid>", methods=["PATCH", "DELETE"])
    @_miembro
    @_suyo
    def colab_tarjeta(did: int, tid: int):
        from app.services import colab_tablero as tb

        try:
            if request.method == "DELETE":
                tb.borrar(did, tid, int(g.colab_usuario["id"]))
                return jsonify({"ok": True})
            return jsonify(tb.editar(did, tid, int(g.colab_usuario["id"]), request.get_json(silent=True) or {}))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404 if "no encontrada" in str(e) else 400

    @app.route("/api/colaboradores/diagramas/<int:did>/tarjetas/<int:tid>/acuerdo", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/tarjetas/<int:tid>/acuerdo", methods=["POST"])
    @_miembro
    @_suyo
    def colab_tarjeta_acuerdo(did: int, tid: int):
        from app.services import colab_tablero as tb

        d = request.get_json(silent=True) or {}
        try:
            return jsonify(tb.acordar(did, tid, int(g.colab_usuario["id"]), bool(d.get("de_acuerdo", True))))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

    # ── Simulador de precios (app/services/colab_precios.py) ──────────────────

    @app.route("/api/colaboradores/diagramas/<int:did>/precios", methods=["GET", "POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/precios", methods=["GET", "POST"])
    @_miembro
    @_suyo
    def colab_precios(did: int):
        from app.services import colab_precios as cp

        if request.method == "GET":
            return jsonify({**cp.listar(did),
                            "participantes": {str(u): col._nombre(u) for u in col.miembros_ids(did)}})
        try:
            return jsonify(cp.crear(did, int(g.colab_usuario["id"]), request.get_json(silent=True) or {})), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/colaboradores/diagramas/<int:did>/precios/<int:pid>", methods=["PATCH", "DELETE"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/precios/<int:pid>", methods=["PATCH", "DELETE"])
    @_miembro
    @_suyo
    def colab_precio(did: int, pid: int):
        from app.services import colab_precios as cp

        try:
            if request.method == "DELETE":
                cp.borrar(did, pid, int(g.colab_usuario["id"]))
                return jsonify({"ok": True})
            return jsonify(cp.editar(did, pid, int(g.colab_usuario["id"]), request.get_json(silent=True) or {}))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404 if "no encontrado" in str(e) else 400

    @app.route("/api/colaboradores/diagramas/<int:did>/precios/<int:pid>/acuerdo", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/precios/<int:pid>/acuerdo", methods=["POST"])
    @_miembro
    @_suyo
    def colab_precio_acuerdo(did: int, pid: int):
        from app.services import colab_precios as cp

        d = request.get_json(silent=True) or {}
        try:
            return jsonify(cp.acordar(did, pid, int(g.colab_usuario["id"]), bool(d.get("de_acuerdo", True))))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404

    @app.route("/api/colaboradores/diagramas/<int:did>/chat", methods=["POST"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/chat", methods=["POST"])
    @_miembro
    @_suyo
    def colab_chat(did: int):
        """Lee un chat exportado de WhatsApp para convertir mensajes en tarjetas.

        El texto NO se guarda: vuelve al navegador y allá se elige mensaje por mensaje. Con
        `guardar_ritmo` se guardan solo los números del ritmo (sin contenido).
        """
        from app.services import colab_tablero as tb

        uid = int(g.colab_usuario["id"])
        f = request.files.get("archivo")
        try:
            if f:
                datos = f.read()
                if len(datos) > col.MAX_MEDIA_BYTES:
                    return jsonify({"error": "El archivo supera los 15 MB"}), 400
                mensajes = tb.leer_chat(datos, f.filename or "")
                opciones = request.form
            else:
                d = request.get_json(silent=True) or {}
                mensajes = tb.leer_chat(str(d.get("texto") or ""))
                opciones = d
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if not mensajes:
            return jsonify({"error": "No se reconocieron mensajes de WhatsApp en lo que llegó"}), 400
        try:
            pedidos = json.loads(opciones.get("autores")) if isinstance(opciones.get("autores"), str) \
                else (opciones.get("autores") or {})
        except ValueError:
            pedidos = {}
        pareja = tb._pareja(did)
        autores = {str(k): int(v) for k, v in (pedidos or {}).items() if str(v).isdigit() and int(v) in pareja} \
            or tb.autores_sugeridos(mensajes, did, uid)
        ritmo = tb.ritmo_chat(mensajes, autores)
        if str(opciones.get("guardar_ritmo") or "").lower() in ("1", "true"):
            tb.guardar_ritmo_chat(did, uid, ritmo)
        return jsonify({"mensajes": mensajes, "autores": autores, "ritmo": ritmo,
                        "nombres": sorted({m["autor"] for m in mensajes})})

    @app.route("/api/colaboradores/diagramas/<int:did>/media/<mid>", methods=["GET"])
    @app.route("/app/api/colaboradores/diagramas/<int:did>/media/<mid>", methods=["GET"])
    @_miembro
    @_suyo
    def colab_ver_media(did: int, mid: str):
        p = col.media_de_diagrama(mid, did)
        if not p:
            return jsonify({"error": "No encontrado"}), 404
        resp = send_file(str(p), mimetype="application/pdf" if p.suffix == ".pdf" else "image/jpeg")
        resp.headers["Cache-Control"] = "private, max-age=86400"
        return resp
