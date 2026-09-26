"""
Mapa del sistema y anatomía de combos — /api/mapa-sistema/* y alias /app/api/...

Paneles Sistemas → Mapa del sistema e Inventario → Combos. Lógica en
app/services/mapa_producto.py. Solo lectura y sin LLM.

El permiso se valida también acá (no solo ocultando la pestaña): administrador, o
quien tenga `mapa-sistema` / `combos`. El diagrama estático de Archify se sirve
autenticado porque muestra la estructura interna del sistema.
"""

from __future__ import annotations

import re
from functools import wraps
from pathlib import Path

from flask import jsonify, request, send_file

_PERMISOS = ("mapa-sistema", "combos", "producto")  # «producto» = Espacio de producto (lee /combos)
_DIAGRAMAS_DIR = Path(__file__).resolve().parents[1] / "docs" / "arquitectura"


def _usuario_puede(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    permisos = usuario.get("permisos_secciones") or {}
    # A diferencia de otros paneles, sin mapa de permisos NO se abre: es una vista
    # de administración, no una herramienta de operación diaria.
    return any(permisos.get(p) for p in _PERMISOS)


def _auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        if chat_api_token_matches_request():
            return f(*args, **kwargs)
        usuario = None
        try:
            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not _usuario_puede(usuario):
            return jsonify({"error": "El mapa del sistema es una vista de administración"}), 403
        return f(*args, **kwargs)

    return wrapper


def _puede_escribir_documentos(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        if es_admin_efectivo(usuario):
            return True
    except Exception:
        pass
    return bool((usuario.get("permisos_secciones") or {}).get("fichas"))


def _auth_escritura(f):
    """Como `_auth`, pero para lo que escribe en los documentos técnicos."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        if chat_api_token_matches_request():
            return f(*args, **kwargs)
        usuario = None
        try:
            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not _puede_escribir_documentos(usuario):
            return jsonify({"error": "Fijar el SKU de un documento requiere ser administrador o tener el permiso de Docs técnicos"}), 403
        return f(*args, **kwargs)

    return wrapper


def _auth_etiquetas(f):
    """Editar una etiqueta desde el taller de combos pide lo mismo que el Studio visual
    (`puede_ver_etiquetas_avanzado`): es la misma escritura, por otra puerta."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import (aplicar_privilegios_admin_cynthia, get_usuario_by_token,
                                             puede_ver_etiquetas_avanzado)

        usuario = None
        try:
            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok)) if tok else None
        except Exception:
            usuario = None
        if usuario is None and chat_api_token_matches_request():
            return f(*args, **kwargs)
        if not usuario:
            return jsonify({"error": "No autorizado"}), 401
        if not puede_ver_etiquetas_avanzado(usuario):
            return jsonify({"error": "Editar etiquetas requiere el acceso al Studio visual"}), 403
        return f(*args, **kwargs)

    return wrapper


def _dual(app, rule: str, **opts):
    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def register_mapa_sistema_routes(app):
    import os

    from app.services import mapa_producto as M

    if not os.environ.get("PYTEST_CURRENT_TEST"):
        try:
            from app.services import mapa_app

            mapa_app.precalentar()
        except Exception as exc:  # el precalentado es una cortesía, nunca un requisito
            print(f"⚠️ Mapa de la app: no se pudo precalentar ({exc})")

    @_dual(app, "/api/mapa-sistema/flujo", methods=["GET"])
    @_auth
    def mapa_sistema_flujo():
        return jsonify(M.mapa_sistema(refrescar=request.args.get("refrescar") == "1"))

    @_dual(app, "/api/mapa-sistema/combos", methods=["GET"])
    @_auth
    def mapa_sistema_combos():
        return jsonify(M.anatomia_combos(
            buscar=request.args.get("q") or "",
            filtro=request.args.get("filtro") or "",
            refrescar=request.args.get("refrescar") == "1",
        ))

    @_dual(app, "/api/mapa-sistema/bloqueos", methods=["GET"])
    @_auth
    def mapa_sistema_bloqueos():
        """Qué está detenido ahora, por etapa del negocio (app/services/mapa_app.py)."""
        from app.services import mapa_app

        return jsonify(mapa_app.bloqueos(refrescar=request.args.get("refrescar") == "1"))

    @_dual(app, "/api/mapa-sistema/urgencias", methods=["GET"])
    def mapa_sistema_urgencias():
        """Lo detenido que ESTA persona puede atender (el Mapa lo hace titilar).

        A diferencia de /bloqueos (administración), la ve todo el equipo interno, pero
        filtrada en el servidor por los paneles que cada quien puede abrir
        (`mapa_app.urgencias_para`). La persona sale del token PERSONAL (X-Tickets-Token o
        el Bearer de sesión): CHAT_API_TOKEN solo lo recibe administración y, sin persona,
        es un script de administración.
        """
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services import mapa_app
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        usuario = None
        for tok in ((request.headers.get("X-Tickets-Token") or "").strip(), bearer_token_from_request()):
            if tok:
                try:
                    usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(tok))
                except Exception:
                    usuario = None
                if usuario:
                    break
        if not usuario:
            if chat_api_token_matches_request():
                return jsonify(mapa_app.bloqueos())
            return jsonify({"error": "No autorizado"}), 401
        return jsonify(mapa_app.urgencias_para(usuario))

    @_dual(app, "/api/mapa-sistema/productos", methods=["GET"])
    @_auth
    def mapa_sistema_productos():
        """La cadena vista desde lo que se compró: una fila por producto adquirido."""
        return jsonify(M.matriz_productos(refrescar=request.args.get("refrescar") == "1"))

    @_dual(app, "/api/mapa-sistema/combos/<ref>/ean-propuesto", methods=["GET"])
    @_auth
    def mapa_sistema_ean_propuesto(ref: str):
        """Solo propone. El código se crea con POST /api/etiquetas/codigos-ean, que ya
        tiene su propio control de quién puede registrar códigos."""
        try:
            return jsonify(M.proponer_ean(ref))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @_dual(app, "/api/mapa-sistema/etiqueta/<ficha_id>", methods=["GET", "POST"])
    @_auth_etiquetas
    def api_mapa_sistema_etiqueta(ficha_id: str):
        """Taller de combos: leer una etiqueta sin sus imágenes y corregir tamaño, plantilla o
        textos. Escribe por `etiquetas_fichas` (la vía del Studio), no por una propia."""
        from app.tools import etiquetas_fichas as EF

        if request.method == "GET":
            f = EF.ficha_ligera(ficha_id)
            if not f:
                return jsonify({"error": "Esa etiqueta no existe"}), 404
            return jsonify({"ficha": f, "opciones": EF.opciones_etiqueta(), "editables": list(EF.CAMPOS_EDITABLES)})
        body = request.get_json(silent=True) or {}
        try:
            EF.actualizar_campos_ficha(ficha_id, body.get("campos"), body.get("tipo_nombre"), body.get("plantilla_id"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        M.invalidar()
        return jsonify({"ok": True, "ficha": EF.ficha_ligera(ficha_id)})

    @_dual(app, "/api/mapa-sistema/recipientes", methods=["GET"])
    @_auth_etiquetas
    def api_mapa_sistema_recipientes():
        """«envase»/«empaque» por código de barras y por etiqueta (casilla CONSERVACIÓN)."""
        return jsonify(M.recipientes())

    @_dual(app, "/api/mapa-sistema/invalidar", methods=["POST"])
    @_auth
    def mapa_sistema_invalidar():
        M.invalidar()
        return jsonify({"ok": True})

    @_dual(app, "/api/mapa-sistema/documentos/propuestas-sku", methods=["GET"])
    @_auth
    def mapa_sistema_propuestas_sku():
        return jsonify(M.propuestas_sku())

    @_dual(app, "/api/mapa-sistema/documentos", methods=["GET"])
    @_auth
    def mapa_sistema_documentos():
        """Buscar un documento técnico para unirlo a mano a una materia prima."""
        return jsonify({"documentos": M.listar_documentos(request.args.get("q") or "", request.args.get("limite") or 40)})

    @_dual(app, "/api/mapa-sistema/documentos/<archivo>/revision", methods=["GET"])
    @_auth
    def mapa_sistema_documento_revision(archivo: str):
        """El documento técnico organizado para leerlo en un emergente del taller de combos."""
        try:
            return jsonify(M.revisar_documento(archivo))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 404

    @_dual(app, "/api/mapa-sistema/documentos/<archivo>/editar", methods=["POST"])
    @_auth_escritura
    def mapa_sistema_documento_editar(archivo: str):
        """Corregir valores del documento desde el emergente del taller (administrador o permiso `fichas`)."""
        body = request.get_json(silent=True) or {}
        quien = ""
        try:
            from app.api_auth import bearer_token_from_request
            from app.services.tickets_db import get_usuario_by_token

            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            u = get_usuario_by_token(tok) if tok else None
            quien = (u or {}).get("nombre") or (u or {}).get("username") or ""
        except Exception:
            pass
        try:
            r = M.editar_documento(archivo, body.get("cambios"), usuario=quien, confirmar_publicado=bool(body.get("confirmar_publicado")))
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        return jsonify({**r, "revision": M.revisar_documento(archivo)})

    @_dual(app, "/api/mapa-sistema/combos/<ref>/documento-no-requerido", methods=["POST"])
    @_auth_escritura
    def mapa_sistema_documento_no_requerido(ref: str):
        """Casilla «No requiere documento técnico» del taller (administrador o permiso `fichas`)."""
        body = request.get_json(silent=True) or {}
        quien = ""
        try:
            from app.api_auth import bearer_token_from_request
            from app.services.tickets_db import get_usuario_by_token

            tok = (request.headers.get("X-Tickets-Token") or "").strip() or bearer_token_from_request()
            u = get_usuario_by_token(tok) if tok else None
            quien = (u or {}).get("nombre") or (u or {}).get("username") or ""
        except Exception:
            pass
        try:
            return jsonify(M.marcar_documento_no_requerido(ref, bool(body.get("no_requiere")),
                                                           motivo=str(body.get("motivo") or ""), usuario=quien))
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @_dual(app, "/api/mapa-sistema/documentos/referencia", methods=["GET"])
    @_auth
    def mapa_sistema_documento_referencia():
        """Editor del documento técnico: a qué SKU está unido el documento de ese título."""
        return jsonify(M.referencia_documento(request.args.get("titulo") or ""))

    @_dual(app, "/api/mapa-sistema/documentos/quitar-sku", methods=["POST"])
    @_auth_escritura
    def mapa_sistema_quitar_sku():
        body = request.get_json(silent=True) or {}
        try:
            return jsonify(M.quitar_sku_documento(body.get("archivo"), body.get("sku")))
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @_dual(app, "/api/mapa-sistema/documentos/fijar-sku", methods=["POST"])
    @_auth_escritura
    def mapa_sistema_fijar_sku():
        items = (request.get_json(silent=True) or {}).get("items") or []
        if not isinstance(items, list) or not items:
            return jsonify({"error": "Nada que fijar"}), 400
        if len(items) > 150:
            return jsonify({"error": "Máximo 150 documentos por llamada"}), 400
        hechos, errores = [], []
        for it in items:
            try:
                hechos.append(M.fijar_sku_documento((it or {}).get("archivo"), (it or {}).get("sku"),
                                                    compartir=bool((it or {}).get("compartir")),
                                                    corregir=bool((it or {}).get("corregir"))))
            except ValueError as exc:
                errores.append({"archivo": (it or {}).get("archivo"), "error": str(exc)})
        return jsonify({"ok": not errores, "hechos": hechos, "errores": errores})

    @_dual(app, "/api/mapa-sistema/diagramas", methods=["GET"])
    @_auth
    def mapa_sistema_diagramas():
        import json as _json

        disponibles = {}
        if _DIAGRAMAS_DIR.is_dir():
            for p in sorted(_DIAGRAMAS_DIR.glob("*.html")):
                if ".visual-check" not in p.name:
                    disponibles[p.stem] = p
        try:
            indice = _json.loads((_DIAGRAMAS_DIR / "indice.json").read_text(encoding="utf-8")).get("diagramas") or []
        except Exception:
            indice = []
        items = []
        for it in indice:
            nombre = it.get("nombre") or ""
            if nombre in disponibles:
                items.append({"nombre": nombre, "titulo": it.get("corto") or nombre, "grupo": it.get("grupo") or "",
                              "resumen": it.get("resumen") or ""})
                disponibles.pop(nombre)
        for nombre in disponibles:  # generado pero sin entrada en el índice
            items.append({"nombre": nombre, "titulo": nombre, "grupo": "Otros", "resumen": ""})
        return jsonify({"diagramas": items})

    @_dual(app, "/api/mapa-sistema/diagramas/<nombre>", methods=["GET"])
    @_auth
    def mapa_sistema_diagrama(nombre: str):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", nombre or ""):
            return jsonify({"error": "Nombre inválido"}), 400
        ruta = _DIAGRAMAS_DIR / f"{nombre}.html"
        if not ruta.is_file():
            return jsonify({"error": "Diagrama no encontrado"}), 404
        return send_file(ruta, mimetype="text/html", conditional=True)
