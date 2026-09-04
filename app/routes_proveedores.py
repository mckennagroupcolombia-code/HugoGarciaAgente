"""
Proveedores — sección del módulo Logística Internacional (/app → Proveedores).

Endpoints bajo /api/proveedores/* (y alias /app/api/proveedores/* para el
proxy del panel). Acceso: CHAT_API_TOKEN (admin) o usuario de tickets con
permiso `logistica-internacional`, mismo patrón híbrido de
app/routes_importaciones.py.

Datos: app/services/proveedores_db.py (SQLite app/data/proveedores.db).
Ninguna ruta llama a un LLM: los importadores usan datos ya existentes
(historial de facturas de compra, Siigo, compras exterior) y los catálogos por
correo se parsean con heurísticas que el operador revisa antes de guardar.
"""

from __future__ import annotations

import os
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
    return bool(permisos.get("logistica-internacional") or permisos.get("logistica-proveedores"))


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
            from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token
            usuario = aplicar_privilegios_admin_cynthia(get_usuario_by_token(token))
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not _usuario_puede(usuario):
            return jsonify({"error": "Proveedores requiere rol administrador o permiso 'logistica-internacional'"}), 403
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


def _notificar_cotizacion_whatsapp(sol: dict) -> bool:
    """Aviso al grupo de pedidos web (o GRUPO_COTIZACIONES_WA si está definido)."""
    try:
        from app.utils import enviar_whatsapp_reporte
    except Exception:
        return False
    jid = (os.getenv("GRUPO_COTIZACIONES_WA") or os.getenv("GRUPO_PEDIDOS_WEB_WA") or "").strip()
    if not jid:
        return False
    lineas = [
        "📨 *SOLICITUD DE COTIZACIÓN (web)*",
        f"Producto: *{sol.get('producto', '')}*",
    ]
    if sol.get("presentacion"):
        lineas.append(f"Presentación: {sol['presentacion']}")
    if sol.get("cantidad"):
        lineas.append(f"Cantidad: {sol['cantidad']}")
    lineas.append(f"Cliente: {sol.get('nombre', '')}" + (f" ({sol['empresa']})" if sol.get("empresa") else ""))
    if sol.get("email"):
        lineas.append(f"Correo: {sol['email']}")
    if sol.get("telefono"):
        lineas.append(f"Tel: {sol['telefono']}")
    if sol.get("ciudad"):
        lineas.append(f"Ciudad: {sol['ciudad']}")
    if sol.get("mensaje"):
        lineas.append(f"Nota: {sol['mensaje'][:300]}")
    provs = sol.get("proveedores_posibles") or []
    if provs:
        lineas.append("Posibles fuentes: " + ", ".join(p["nombre"] for p in provs[:4]))
    lineas.append(f"Gestionar en /app → Proveedores → Cotizaciones (#{sol.get('id')})")
    try:
        return bool(enviar_whatsapp_reporte("\n".join(lineas), numero_destino=jid))
    except TypeError:
        return bool(enviar_whatsapp_reporte("\n".join(lineas)))
    except Exception:
        return False


def _confirmar_por_correo(sol: dict) -> str:
    email = (sol.get("email") or "").strip()
    if not email or "@" not in email:
        return "sin correo"
    try:
        from app.tools.system_tools import enviar_email_reporte
    except Exception as e:
        return f"sin módulo de correo: {e}"
    cuerpo = (
        f"Hola {sol.get('nombre') or ''},\n\n"
        f"Recibimos su solicitud de cotización de *{sol.get('producto')}*"
        + (f" ({sol['presentacion']})" if sol.get("presentacion") else "")
        + (f", cantidad: {sol['cantidad']}" if sol.get("cantidad") else "")
        + ".\n\nNuestro equipo comercial revisará disponibilidad con nuestra red de abastecimiento "
          "internacional y le enviará por este medio precio, presentaciones disponibles y tiempo de entrega.\n\n"
          "McKenna Group S.A.S. · Bogotá, Colombia · mckennagroup.co"
    )
    return enviar_email_reporte(email, "Recibimos su solicitud de cotización — McKenna Group", cuerpo)


def register_proveedores_routes(app):
    from app.services import proveedores_db as P

    # ── resumen / proveedores ──────────────────────────────────────────
    @_dual(app, "/api/proveedores/resumen", methods=["GET"])
    @_auth
    def proveedores_resumen():
        return jsonify(P.resumen())

    @_dual(app, "/api/proveedores", methods=["GET", "POST"])
    @_auth
    def proveedores_lista():
        if request.method == "POST":
            datos = _body()
            if not (datos.get("nombre") or "").strip():
                return jsonify({"error": "nombre es obligatorio"}), 400
            return jsonify(P.guardar_proveedor(datos)), 201
        q = (request.args.get("q") or "").strip()
        inactivos = request.args.get("inactivos") in ("1", "true")
        return jsonify({"proveedores": P.listar_proveedores(q, incluir_inactivos=inactivos)})

    @_dual(app, "/api/proveedores/<int:pid>", methods=["GET", "PUT"])
    @_auth
    def proveedores_detalle(pid: int):
        if request.method == "PUT":
            out = P.guardar_proveedor(_body(), pid=pid)
            return jsonify(out) if out else (jsonify({"error": "No existe"}), 404)
        p = P.obtener_proveedor(pid)
        return jsonify(p) if p else (jsonify({"error": "No existe"}), 404)

    @_dual(app, "/api/proveedores/<int:pid>/productos", methods=["POST"])
    @_auth
    def proveedores_agregar_producto(pid: int):
        datos = _body()
        if not (datos.get("nombre") or "").strip():
            return jsonify({"error": "nombre es obligatorio"}), 400
        try:
            return jsonify(P.agregar_producto_manual(pid, datos)), 201
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    # ── productos: quién vende qué ─────────────────────────────────────
    @_dual(app, "/api/proveedores/productos", methods=["GET"])
    @_auth
    def proveedores_productos():
        q = (request.args.get("q") or "").strip()
        linea = (request.args.get("linea") or "").strip()
        solo_pub = request.args.get("publicables") in ("1", "true")
        return jsonify({"productos": P.buscar_productos(q, solo_publicables=solo_pub, linea=linea)})

    @_dual(app, "/api/proveedores/productos/<int:prod_id>", methods=["PUT", "DELETE"])
    @_auth
    def proveedores_producto(prod_id: int):
        if request.method == "DELETE":
            return jsonify({"ok": P.eliminar_producto(prod_id)})
        datos = _body()
        out = P.actualizar_producto(prod_id, datos, aplicar_a_clave=bool(datos.get("aplicar_a_clave")))
        return jsonify(out) if out else (jsonify({"error": "No existe"}), 404)

    @_dual(app, "/api/proveedores/precios", methods=["GET"])
    @_auth
    def proveedores_precios():
        clave = (request.args.get("clave") or "").strip()
        if not clave:
            return jsonify({"error": "clave requerida"}), 400
        return jsonify({"clave": clave, "precios": P.historial_precios(clave)})

    # ── importadores (sin LLM) ─────────────────────────────────────────
    @_dual(app, "/api/proveedores/importar", methods=["POST"])
    @_auth
    def proveedores_importar():
        datos = _body()
        fuente = (datos.get("fuente") or "todo").strip()
        if fuente == "historial":
            return jsonify(P.importar_historial_facturas())
        if fuente == "compras_exterior":
            return jsonify(P.importar_compras_exterior())
        if fuente == "siigo":
            return jsonify(P.importar_siigo_compras(str(datos.get("fecha_desde") or "2024-01-01")))
        return jsonify(P.importar_todo(incluir_siigo=bool(datos.get("incluir_siigo")),
                                       fecha_desde_siigo=str(datos.get("fecha_desde") or "2024-01-01")))

    # ── catálogos por correo ───────────────────────────────────────────
    @_dual(app, "/api/proveedores/catalogos", methods=["GET"])
    @_auth
    def proveedores_catalogos():
        return jsonify({"catalogos": P.listar_catalogos((request.args.get("estado") or "").strip())})

    @_dual(app, "/api/proveedores/catalogos/escanear", methods=["POST"])
    @_auth
    def proveedores_catalogos_escanear():
        datos = _body()
        dias = int(datos.get("dias") or 730)
        return jsonify(P.escanear_catalogos_gmail(dias=max(7, min(dias, 3650)), max_correos=int(datos.get("max") or 200)))

    @_dual(app, "/api/proveedores/catalogos/<int:cat_id>", methods=["PUT"])
    @_auth
    def proveedores_catalogo_editar(cat_id: int):
        out = P.actualizar_catalogo(cat_id, _body())
        return jsonify(out) if out else (jsonify({"error": "No existe"}), 404)

    @_dual(app, "/api/proveedores/catalogos/<int:cat_id>/extraer", methods=["POST"])
    @_auth
    def proveedores_catalogo_extraer(cat_id: int):
        return jsonify(P.extraer_lineas_catalogo(cat_id))

    @_dual(app, "/api/proveedores/catalogos/<int:cat_id>/importar", methods=["POST"])
    @_auth
    def proveedores_catalogo_importar(cat_id: int):
        datos = _body()
        pid = datos.get("proveedor_id")
        if not pid and (datos.get("proveedor_nombre") or "").strip():
            pid = P.guardar_proveedor({"nombre": datos["proveedor_nombre"], "pais": datos.get("origen_pais") or "",
                                       "email": datos.get("email") or ""}).get("id")
        if not pid:
            return jsonify({"error": "proveedor_id o proveedor_nombre requerido"}), 400
        return jsonify(P.importar_lineas_catalogo(
            cat_id, int(pid), datos.get("lineas") or [], moneda=str(datos.get("moneda") or "COP"),
            publicar_web=bool(datos.get("publicar_web")), linea=str(datos.get("linea") or ""),
            origen_pais=str(datos.get("origen_pais") or "")))

    @_dual(app, "/api/proveedores/extraer-url", methods=["POST"])
    @_auth
    def proveedores_extraer_url():
        return jsonify(P.extraer_productos_desde_url(str(_body().get("url") or "")))

    @_dual(app, "/api/proveedores/importar-lineas", methods=["POST"])
    @_auth
    def proveedores_importar_lineas():
        """Guarda líneas confirmadas que vienen de una URL o de captura manual (sin catálogo de correo)."""
        datos = _body()
        pid = datos.get("proveedor_id")
        if not pid:
            return jsonify({"error": "proveedor_id requerido"}), 400
        return jsonify(P.importar_lineas_catalogo(
            0, int(pid), datos.get("lineas") or [], moneda=str(datos.get("moneda") or "COP"),
            publicar_web=bool(datos.get("publicar_web")), linea=str(datos.get("linea") or ""),
            origen_pais=str(datos.get("origen_pais") or "")))

    @_dual(app, "/api/proveedores/autoclasificar", methods=["POST"])
    @_auth
    def proveedores_autoclasificar():
        datos = _body()
        return jsonify(P.autoclasificar_productos(solo_faltantes=not bool(datos.get("todos")),
                                                  proveedor_id=datos.get("proveedor_id")))

    @_dual(app, "/api/proveedores/publicar-masivo", methods=["POST"])
    @_auth
    def proveedores_publicar_masivo():
        """Marca publicar_web para todos los productos de los proveedores indicados (o de todos los de tipo materia prima)."""
        datos = _body()
        ids = [int(x) for x in (datos.get("proveedor_ids") or []) if str(x).isdigit()]
        valor = 0 if datos.get("despublicar") else 1
        return jsonify(P.marcar_publicar_masivo(ids, valor))

    # ── publicación web ────────────────────────────────────────────────
    @_dual(app, "/api/proveedores/publicar-web", methods=["POST"])
    @_auth
    def proveedores_publicar_web():
        out = P.publicar_oferta_web()
        try:
            import requests
            url = (os.getenv("WEBSITE_LOCAL_URL") or "http://127.0.0.1:8083").rstrip("/")
            requests.post(f"{url}/api/oferta/refresh", timeout=5)
        except Exception:
            pass
        return jsonify(out)

    @_dual(app, "/api/proveedores/oferta-web", methods=["GET"])
    @_auth
    def proveedores_oferta_web():
        return jsonify(P.cargar_oferta_web())

    @_dual(app, "/api/proveedores/paises", methods=["GET"])
    @_auth
    def proveedores_paises():
        return jsonify({"paises": sorted(P.PAISES_COORDENADAS.keys()), "lineas": list(P.LINEAS_VALIDAS),
                        "tipos": list(P.TIPOS_PROVEEDOR)})

    # ── solicitudes de cotización (las crea website.py :8083) ──────────
    @_dual(app, "/api/proveedores/cotizaciones", methods=["GET"])
    @_auth
    def proveedores_cotizaciones():
        return jsonify({"solicitudes": P.listar_solicitudes_cotizacion((request.args.get("estado") or "").strip())})

    @_dual(app, "/api/proveedores/cotizaciones/<int:sid>", methods=["PUT"])
    @_auth
    def proveedores_cotizacion_editar(sid: int):
        datos = _body()
        out = P.actualizar_solicitud_cotizacion(sid, datos)
        if not out:
            return jsonify({"error": "No existe"}), 404
        if datos.get("enviar_respuesta") and out.get("respuesta") and out.get("email"):
            try:
                from app.tools.system_tools import enviar_email_reporte
                res = enviar_email_reporte(out["email"], f"Cotización {out.get('producto', '')} — McKenna Group",
                                           out["respuesta"])
                out["envio_correo"] = res
                if res.startswith("✅"):
                    out = P.actualizar_solicitud_cotizacion(sid, {"estado": "enviada"}) or out
            except Exception as e:
                out["envio_correo"] = f"error: {e}"
        return jsonify(out)

    @_dual(app, "/api/proveedores/cotizaciones/notificar", methods=["POST"])
    def proveedores_cotizacion_notificar():
        """Interno: website.py avisa que registró una solicitud → WhatsApp + correo de confirmación.
        Protegido con CHAT_API_TOKEN (Bearer) como el resto de llamadas web → agente."""
        from app.api_auth import chat_api_token_matches_request
        if not chat_api_token_matches_request():
            return jsonify({"error": "No autorizado"}), 401
        datos = _body()
        sid = datos.get("id")
        sol = None
        if sid:
            sols = [s for s in P.listar_solicitudes_cotizacion(limite=50) if s["id"] == int(sid)]
            sol = sols[0] if sols else None
        sol = sol or datos
        wa = _notificar_cotizacion_whatsapp(sol)
        correo = _confirmar_por_correo(sol)
        return jsonify({"ok": True, "whatsapp": wa, "correo": correo})
