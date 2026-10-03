"""Rutas del expediente fiscal de socios (Declarador) — `/api/socios/*`.

Privacidad: el expediente expone cédula, patrimonio declarado, extractos
personales e historial de Binance de una persona. Mismo criterio que los gastos
personales de la Cuenta de Socio (`_cc_es_admin` en app/routes.py): cada socio
ve SOLO el suyo (vía `cc_terceros.usuario_id`), y únicamente la cuenta `admin`
real —o una llamada con el CHAT_API_TOKEN crudo, sin identidad de persona— ve
los de todos. Tener rol Administrador (nivel 3) no basta: los dos socios lo
tienen para lo operativo y no deben verse la declaración de renta entre sí.
"""

from __future__ import annotations

import tempfile
from functools import wraps

from flask import jsonify, request, send_file


def _usuario_sesion() -> dict | None:
    """Usuario de tickets de la sesión (X-Tickets-Token o Bearer JWT)."""
    try:
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request
        from app.services.tickets_db import get_usuario_by_token

        xt = (
            (request.headers.get("X-Tickets-Token") or "").strip()
            or (request.headers.get("X-Tickets-Authorization") or "").replace("Bearer ", "", 1).strip()
        )
        if xt:
            u = get_usuario_by_token(xt)
            if u:
                return u
        if not chat_api_token_matches_request():
            tok = bearer_token_from_request()
            if tok:
                return get_usuario_by_token(tok)
    except Exception:
        return None
    return None


def _es_admin_real(usuario: dict | None) -> bool:
    from app.api_auth import chat_api_token_matches_request

    if not usuario:
        return chat_api_token_matches_request()
    return (usuario.get("username") or "").strip().lower() == "admin"


def _autenticado() -> bool:
    from app.api_auth import chat_api_token_matches_request

    if chat_api_token_matches_request():
        return True
    return _usuario_sesion() is not None


def _puede_ver_tercero(usuario: dict | None, tercero_id: int) -> bool:
    if _es_admin_real(usuario):
        return True
    if not usuario:
        return False
    from app.services.contabilidad_core import tercero_por_usuario

    t = tercero_por_usuario(int(usuario["id"]))
    return bool(t and int(t["id"]) == int(tercero_id))


def _auth_tercero(f):
    """Decorador para rutas con `<int:tercero_id>`: 401 sin sesión, 403 si no
    es su propio expediente ni es admin real."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        if not _autenticado():
            return jsonify({"error": "No autorizado"}), 401
        u = _usuario_sesion()
        tid = int(kwargs.get("tercero_id") or 0)
        if not _puede_ver_tercero(u, tid):
            return jsonify({"error": "Solo puedes ver tu propio expediente"}), 403
        request.declarador_usuario = u  # type: ignore[attr-defined]
        return f(*args, **kwargs)

    return wrapper


def register_declarador_routes(app):
    import app.services.declarador as dl

    # ── Selector: qué socios puede ver quien pregunta ────────────────────
    @app.route("/api/socios", methods=["GET"])
    @app.route("/app/api/socios", methods=["GET"])
    def api_socios_lista():
        if not _autenticado():
            return jsonify({"error": "No autorizado"}), 401
        u = _usuario_sesion()
        try:
            socios = dl.resumen_socios()
            if not _es_admin_real(u):
                from app.services.contabilidad_core import tercero_por_usuario

                mio = tercero_por_usuario(int(u["id"])) if u else None
                socios = [s for s in socios if mio and s["id"] == mio["id"]]
            return jsonify({"socios": socios, "es_admin": _es_admin_real(u)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Expediente completo (wizard) ─────────────────────────────────────
    @app.route("/api/socios/<int:tercero_id>/expediente", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/expediente", methods=["GET"])
    @_auth_tercero
    def api_socio_expediente(tercero_id: int):
        try:
            return jsonify(dl.obtener_expediente(tercero_id))
        except ValueError as e:
            return jsonify({"error": str(e)}), 404
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/socios/<int:tercero_id>/perfil", methods=["POST", "PATCH"])
    @app.route("/app/api/socios/<int:tercero_id>/perfil", methods=["POST", "PATCH"])
    @_auth_tercero
    def api_socio_perfil(tercero_id: int):
        data = request.get_json(silent=True) or {}
        try:
            # Datos de contacto viven en cc_terceros; el resto en dl_expedientes.
            contacto = {k: data[k] for k in ("email", "telefono", "cuenta_bancaria", "identificacion") if k in data}
            if contacto:
                from app.services.contabilidad_core import actualizar_tercero

                actualizar_tercero(tercero_id, contacto)
            if "identificacion" in data and "cedula" not in data:
                data["cedula"] = data["identificacion"]
            return jsonify(dl.guardar_perfil(tercero_id, data))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/socios/<int:tercero_id>/pasos/<string:paso>", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/pasos/<string:paso>", methods=["POST"])
    @_auth_tercero
    def api_socio_marcar_paso(tercero_id: int, paso: str):
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(dl.marcar_paso(tercero_id, paso, bool(data.get("hecho", True))))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/socios/<int:tercero_id>/carpeta", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/carpeta", methods=["POST"])
    @_auth_tercero
    def api_socio_crear_carpeta(tercero_id: int):
        try:
            return jsonify({"ok": True, **dl.crear_carpeta_socio(tercero_id)})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/socios/<int:tercero_id>/plan", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/plan", methods=["GET"])
    @_auth_tercero
    def api_socio_plan(tercero_id: int):
        try:
            return jsonify(dl.plan_carga(tercero_id))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Documentos ───────────────────────────────────────────────────────
    @app.route("/api/socios/<int:tercero_id>/documentos", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/documentos", methods=["POST"])
    @_auth_tercero
    def api_socio_documento_subir(tercero_id: int):
        archivo = request.files.get("archivo") or request.files.get("file")
        if not archivo or not archivo.filename:
            return jsonify({"error": "Envíe el archivo en multipart «archivo»"}), 400
        contenido = archivo.read()
        if len(contenido) > 30 * 1024 * 1024:
            return jsonify({"error": "Archivo demasiado grande (máx 30 MB)"}), 400
        ano_raw = (request.form.get("ano") or "").strip()
        try:
            ano = int(ano_raw) if ano_raw else None
        except ValueError:
            ano = None
        try:
            doc = dl.guardar_documento(
                tercero_id,
                contenido,
                archivo.filename,
                categoria=(request.form.get("categoria") or "soporte").strip(),
                ano=ano,
                notas=(request.form.get("notas") or "").strip(),
            )
            return jsonify({"ok": True, "documento": doc})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/socios/<int:tercero_id>/documentos/<int:doc_id>", methods=["PATCH"])
    @app.route("/app/api/socios/<int:tercero_id>/documentos/<int:doc_id>", methods=["PATCH"])
    @_auth_tercero
    def api_socio_documento_editar(tercero_id: int, doc_id: int):
        data = request.get_json(silent=True) or {}
        doc = dl.actualizar_documento(tercero_id, doc_id, data)
        if not doc:
            return jsonify({"error": "Documento no encontrado"}), 404
        return jsonify(doc)

    @app.route("/api/socios/<int:tercero_id>/documentos/<int:doc_id>", methods=["DELETE"])
    @app.route("/app/api/socios/<int:tercero_id>/documentos/<int:doc_id>", methods=["DELETE"])
    @_auth_tercero
    def api_socio_documento_borrar(tercero_id: int, doc_id: int):
        if not dl.eliminar_documento(tercero_id, doc_id):
            return jsonify({"error": "Documento no encontrado"}), 404
        return jsonify({"ok": True})

    @app.route("/api/socios/<int:tercero_id>/documentos/<int:doc_id>/archivo", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/documentos/<int:doc_id>/archivo", methods=["GET"])
    @_auth_tercero
    def api_socio_documento_archivo(tercero_id: int, doc_id: int):
        r = dl.ruta_documento(tercero_id, doc_id)
        if not r:
            return jsonify({"error": "Archivo no disponible"}), 404
        path, nombre = r
        return send_file(path, as_attachment=False, download_name=nombre)

    @app.route("/api/socios/<int:tercero_id>/documentos/<int:doc_id>/texto", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/documentos/<int:doc_id>/texto", methods=["GET"])
    @_auth_tercero
    def api_socio_documento_texto(tercero_id: int, doc_id: int):
        try:
            n = int(request.args.get("max_chars") or 12000)
        except ValueError:
            n = 12000
        return jsonify({"texto": dl.leer_documento_texto(tercero_id, doc_id, n)})

    @app.route("/api/socios/<int:tercero_id>/importar-carpeta", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/importar-carpeta", methods=["POST"])
    @_auth_tercero
    def api_socio_importar_carpeta(tercero_id: int):
        data = request.get_json(silent=True) or {}
        try:
            return jsonify({"ok": True, **dl.importar_carpeta(tercero_id, (data.get("carpeta") or "").strip() or None)})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Años gravables y hallazgos ───────────────────────────────────────
    @app.route("/api/socios/<int:tercero_id>/anios/<int:ano>", methods=["PATCH", "POST"])
    @app.route("/app/api/socios/<int:tercero_id>/anios/<int:ano>", methods=["PATCH", "POST"])
    @_auth_tercero
    def api_socio_anio(tercero_id: int, ano: int):
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(dl.actualizar_anio(tercero_id, ano, data))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/socios/<int:tercero_id>/hallazgos", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/hallazgos", methods=["POST"])
    @_auth_tercero
    def api_socio_hallazgo_crear(tercero_id: int):
        data = request.get_json(silent=True) or {}
        try:
            return jsonify(dl.crear_hallazgo(tercero_id, data))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/socios/<int:tercero_id>/hallazgos/<int:hallazgo_id>", methods=["PATCH"])
    @app.route("/app/api/socios/<int:tercero_id>/hallazgos/<int:hallazgo_id>", methods=["PATCH"])
    @_auth_tercero
    def api_socio_hallazgo_editar(tercero_id: int, hallazgo_id: int):
        data = request.get_json(silent=True) or {}
        try:
            h = dl.actualizar_hallazgo(tercero_id, hallazgo_id, data)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if not h:
            return jsonify({"error": "Hallazgo no encontrado"}), 404
        return jsonify(h)

    # ── Cruces banco socio ↔ empresa ─────────────────────────────────────
    @app.route("/api/socios/<int:tercero_id>/cronologia", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/cronologia", methods=["GET"])
    @_auth_tercero
    def api_socio_cronologia(tercero_id: int):
        """Expediente en línea de tiempo, para que el contador verifique cada
        cifra contra su soporte. Va aparte del expediente porque lee los CSV de
        evidencia y los certificados del disco."""
        return jsonify(dl.cronologia(tercero_id))

    @app.route("/api/socios/<int:tercero_id>/informe.pdf", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/informe.pdf", methods=["GET"])
    @_auth_tercero
    def api_socio_informe_pdf(tercero_id: int):
        """El expediente en PDF para entregarle al contador. Se regenera en cada
        descarga (las cifras de intereses cambian con los días) y queda guardado
        en la propia carpeta del socio, junto a los soportes que cita."""
        import os

        from app.tools import declarador_pdf

        crono = dl.cronologia(tercero_id)
        carpeta = crono.get("carpeta") or ""
        nombre = "Informe_Expediente_Criptoactivos.pdf"
        destino = (
            os.path.join(carpeta, dl.CARPETA_INFORME, nombre)
            if carpeta and os.path.isdir(carpeta)
            else os.path.join(tempfile.gettempdir(), f"informe_socio_{tercero_id}.pdf")
        )
        try:
            declarador_pdf.generar_informe(crono, destino)
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": f"No se pudo generar el PDF: {e}"}), 500
        apellido = (crono["titular"]["nombre"] or "socio").split()[0]
        return send_file(destino, mimetype="application/pdf", as_attachment=True, download_name=f"Expediente_Criptoactivos_{apellido}.pdf")

    @app.route("/api/socios/<int:tercero_id>/organizar-carpeta", methods=["GET", "POST"])
    @app.route("/app/api/socios/<int:tercero_id>/organizar-carpeta", methods=["GET", "POST"])
    @_auth_tercero
    def api_socio_organizar_carpeta(tercero_id: int):
        """GET: qué se movería. POST: lo mueve y actualiza las rutas."""
        try:
            if request.method == "GET":
                return jsonify(dl.plan_organizar_carpeta(tercero_id))
            return jsonify({"ok": True, **dl.organizar_carpeta(tercero_id)})
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/socios/<int:tercero_id>/cruces", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/cruces", methods=["GET"])
    @_auth_tercero
    def api_socio_cruces(tercero_id: int):
        try:
            return jsonify(
                dl.cruces_socio_empresa(
                    tercero_id,
                    desde=(request.args.get("desde") or "").strip() or None,
                    hasta=(request.args.get("hasta") or "").strip() or None,
                )
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    # ── Agente ───────────────────────────────────────────────────────────
    @app.route("/api/socios/<int:tercero_id>/agente", methods=["GET"])
    @app.route("/app/api/socios/<int:tercero_id>/agente", methods=["GET"])
    @_auth_tercero
    def api_socio_agente_historial(tercero_id: int):
        return jsonify({"historial": dl.historial_chat(tercero_id)})

    @app.route("/api/socios/<int:tercero_id>/agente", methods=["POST"])
    @app.route("/app/api/socios/<int:tercero_id>/agente", methods=["POST"])
    @_auth_tercero
    def api_socio_agente(tercero_id: int):
        data = request.get_json(silent=True) or {}
        mensaje = str(data.get("mensaje") or "").strip()
        if not mensaje:
            return jsonify({"error": "Falta el mensaje"}), 400
        try:
            return jsonify(dl.responder_agente(tercero_id, mensaje))
        except RuntimeError as e:
            return jsonify({"error": f"Agente no disponible: {e}"}), 503
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/socios/<int:tercero_id>/agente", methods=["DELETE"])
    @app.route("/app/api/socios/<int:tercero_id>/agente", methods=["DELETE"])
    @_auth_tercero
    def api_socio_agente_borrar(tercero_id: int):
        return jsonify({"ok": True, "borrados": dl.borrar_chat(tercero_id)})

    print("✅ Declarador · expediente de socios: rutas /api/socios/* registradas")
