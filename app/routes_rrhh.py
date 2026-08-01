"""RRHH · Compensaciones — hallazgos de equidad interna, métricas de carga y agente especializado.

Endpoints bajo /api/rrhh/*. Acceso restringido: CHAT_API_TOKEN (admin) o usuario
de tickets con rol nivel >= 3, o permiso explícito `rrhh` en permisos_secciones.
Los datos salariales son sensibles: no abrir este módulo a operarios sin permiso.

Fuentes en vivo (solo lectura):
  - app/data/tickets.db      → sesiones de panel, tickets y eventos por usuario
  - app/data/wa_chats.db     → volumen WhatsApp, comprobantes, pagos confirmados
  - PAGINA_WEB/site/data/orders.db → pedidos de la tienda web

Persistencia editable: app/data/rrhh_compensaciones.json (nómina + hallazgos).
"""

import json
import os
import sqlite3
import threading
from datetime import datetime
from functools import wraps

from flask import jsonify, request

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_PATH = os.path.join(_BASE, "app", "data", "rrhh_compensaciones.json")
_TICKETS_DB = os.path.join(_BASE, "app", "data", "tickets.db")
_WA_DB = os.path.join(_BASE, "app", "data", "wa_chats.db")
_ORDERS_DB = os.path.join(_BASE, "PAGINA_WEB", "site", "data", "orders.db")

_lock = threading.Lock()

# Usuarios técnicos/prueba que no cuentan como equipo
_USUARIOS_EXCLUIDOS = ("tester", "hugo_ia_bot", "prueba", "Cynthua", "velastella")


# ── Persistencia ────────────────────────────────────────────────────────────────

def _cargar() -> dict:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"nomina": [], "hallazgos": [], "matriz_factores": {}}


def _guardar(data: dict) -> None:
    tmp = _DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _DATA_PATH)


# ── Auth ────────────────────────────────────────────────────────────────────────

def _usuario_puede_rrhh(usuario: dict | None) -> bool:
    if not usuario:
        return False
    if ((usuario.get("rol") or {}).get("nivel", 0)) >= 3:
        return True
    permisos = usuario.get("permisos_secciones") or {}
    return bool(permisos.get("rrhh"))


def _auth_rrhh(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        from app.api_auth import bearer_token_from_request, chat_api_token_matches_request

        if chat_api_token_matches_request():
            request.rrhh_usuario = {"nombre": "Administrador (token)"}
            return f(*args, **kwargs)
        token = bearer_token_from_request()
        if not token:
            return jsonify({"error": "No autorizado"}), 401
        try:
            from app.services.tickets_db import get_usuario_by_token
            usuario = get_usuario_by_token(token)
        except Exception:
            usuario = None
        if not usuario:
            return jsonify({"error": "Sesión inválida o expirada"}), 401
        if not _usuario_puede_rrhh(usuario):
            return jsonify({"error": "RRHH · Compensaciones requiere rol administrador o permiso 'rrhh'"}), 403
        request.rrhh_usuario = usuario
        return f(*args, **kwargs)

    return wrapper


# ── Métricas en vivo ────────────────────────────────────────────────────────────

def _consulta(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    if not os.path.exists(db_path):
        return []
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
        try:
            return con.execute(sql, params).fetchall()
        finally:
            con.close()
    except Exception:
        return []


def _actividad_equipo() -> list[dict]:
    """Horas de sesión, días activos y tickets por usuario del panel."""
    exclu = ",".join("?" * len(_USUARIOS_EXCLUIDOS))
    sesiones = _consulta(
        _TICKETS_DB,
        f"""
        SELECT u.id, u.nombre, strftime('%Y-%m', s.inicio) mes,
               ROUND(SUM(COALESCE(s.duracion_segundos,0))/3600.0, 1) horas,
               COUNT(DISTINCT date(s.inicio)) dias,
               COUNT(*) sesiones
        FROM panel_sesiones_operativas s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE u.username NOT IN ({exclu}) AND u.username != 'admin'
        GROUP BY u.id, mes ORDER BY mes
        """,
        _USUARIOS_EXCLUIDOS,
    )
    tickets = {
        fila[0]: {"asignados": fila[1], "resueltos": fila[2]}
        for fila in _consulta(
            _TICKETS_DB,
            """
            SELECT asignado_a, COUNT(*),
                   SUM(CASE WHEN estado IN ('resuelto','cerrado','completado','hecho') THEN 1 ELSE 0 END)
            FROM tickets WHERE asignado_a IS NOT NULL GROUP BY asignado_a
            """,
        )
    }
    solicitudes = {
        fila[0]: fila[1]
        for fila in _consulta(
            _TICKETS_DB,
            "SELECT usuario_id, COUNT(*) FROM panel_eventos_operativos "
            "WHERE tipo='solicitud_resuelta' GROUP BY usuario_id",
        )
    }
    ultimo_uso = {
        fila[0]: fila[1]
        for fila in _consulta(
            _TICKETS_DB,
            "SELECT usuario_id, MAX(date(inicio)) FROM panel_sesiones_operativas GROUP BY usuario_id",
        )
    }

    equipo: dict[int, dict] = {}
    for uid, nombre, mes, horas, dias, n_ses in sesiones:
        item = equipo.setdefault(
            uid,
            {
                "usuario_id": uid,
                "nombre": nombre,
                "horas_total": 0.0,
                "dias_total": 0,
                "sesiones_total": 0,
                "por_mes": {},
                "tickets_asignados": tickets.get(uid, {}).get("asignados", 0),
                "tickets_resueltos": tickets.get(uid, {}).get("resueltos", 0),
                "solicitudes_resueltas": solicitudes.get(uid, 0),
                "ultimo_uso_panel": ultimo_uso.get(uid),
            },
        )
        item["horas_total"] = round(item["horas_total"] + (horas or 0), 1)
        item["dias_total"] += dias or 0
        item["sesiones_total"] += n_ses or 0
        item["por_mes"][mes] = {"horas": horas or 0, "dias": dias or 0, "sesiones": n_ses or 0}
    return sorted(equipo.values(), key=lambda x: -x["horas_total"])


def _whatsapp_mensual() -> list[dict]:
    filas = _consulta(
        _WA_DB,
        """
        SELECT strftime('%Y-%m', ts, 'unixepoch') mes,
               SUM(direccion='entrada'),
               SUM(direccion='salida' AND enviado_por='humano'),
               SUM(direccion='salida' AND enviado_por='bot'),
               COUNT(DISTINCT CASE WHEN jid NOT LIKE '%@g.us' AND direccion='entrada' THEN jid END)
        FROM mensajes GROUP BY mes ORDER BY mes
        """,
    )
    return [
        {"mes": m, "entrantes": e or 0, "salientes_humano": h or 0,
         "salientes_bot": b or 0, "contactos_unicos": c or 0}
        for m, e, h, b, c in filas
    ]


def _ventas_mensual() -> list[dict]:
    comprobantes = {
        m: n
        for m, n in _consulta(
            _WA_DB,
            "SELECT strftime('%Y-%m', ts, 'unixepoch') mes, COUNT(*) FROM mensajes "
            "WHERE direccion='entrada' AND tiene_media=1 AND jid NOT LIKE '%@g.us' GROUP BY mes",
        )
    }
    confirmados = {
        m: n
        for m, n in _consulta(
            _WA_DB,
            "SELECT strftime('%Y-%m', ts, 'unixepoch') mes, COUNT(*) FROM mensajes "
            "WHERE direccion='salida' AND (texto LIKE '%confirmamos su pago%' "
            "OR texto LIKE '%pago confirmado%') GROUP BY mes",
        )
    }
    contactos = {
        m: n
        for m, n in _consulta(
            _WA_DB,
            "SELECT strftime('%Y-%m', ts, 'unixepoch') mes, "
            "COUNT(DISTINCT CASE WHEN jid NOT LIKE '%@g.us' THEN jid END) FROM mensajes "
            "WHERE direccion='entrada' GROUP BY mes",
        )
    }
    web: dict[str, dict] = {}
    for m, status, n, total in _consulta(
        _ORDERS_DB,
        "SELECT substr(created_at,1,7), status, COUNT(*), ROUND(SUM(COALESCE(total,0))) "
        "FROM orders GROUP BY substr(created_at,1,7), status",
    ):
        item = web.setdefault(m, {"pedidos": 0, "aprobados": 0, "valor_aprobado": 0,
                                  "rechazados": 0, "valor_rechazado": 0})
        item["pedidos"] += n or 0
        if status == "approved":
            item["aprobados"] += n or 0
            item["valor_aprobado"] += total or 0
        elif status == "declined":
            item["rechazados"] += n or 0
            item["valor_rechazado"] += total or 0

    meses = sorted(set(contactos) | set(comprobantes) | set(confirmados) | set(web))
    resultado = []
    for m in meses:
        cont = contactos.get(m, 0)
        comp = comprobantes.get(m, 0)
        conf = confirmados.get(m, 0)
        resultado.append({
            "mes": m,
            "contactos_wa": cont,
            "comprobantes_wa": comp,
            "pagos_confirmados_wa": conf,
            "conversion_comprobante_pct": round(100.0 * comp / cont, 1) if cont else None,
            "web": web.get(m, {"pedidos": 0, "aprobados": 0, "valor_aprobado": 0,
                               "rechazados": 0, "valor_rechazado": 0}),
        })
    return resultado


def _resumen_completo() -> dict:
    data = _cargar()
    return {
        "generado": datetime.now().isoformat(timespec="seconds"),
        "actividad_equipo": _actividad_equipo(),
        "whatsapp": _whatsapp_mensual(),
        "ventas": _ventas_mensual(),
        "nomina": data.get("nomina", []),
        "matriz_factores": data.get("matriz_factores", {}),
        "hallazgos_abiertos": sum(
            1 for h in data.get("hallazgos", []) if h.get("estado") in ("pendiente", "en_curso")
        ),
    }


# ── Agente especializado ────────────────────────────────────────────────────────

_PROMPT_AGENTE = """Eres el asesor de RRHH, compensaciones y finanzas corporativas de McKenna Group S.A.S.
(materias primas farmacéuticas y cosméticas, Bogotá, Colombia). Asesoras exclusivamente a la
gerencia sobre equidad interna, formalización de pagos, riesgos UGPP/DIAN y sostenibilidad de nómina.

Contexto normativo que dominas (Colombia): contrato realidad (habitualidad + subordinación),
cotizaciones PILA (8% empleado, 12% pensión patronal, exoneración art. 114-1 ET bajo 10 SMMLV),
independientes (IBC 40% del ingreso), art. 107/108 ET (deducibilidad y verificación de aportes),
fondo de solidaridad pensional (>4 SMMLV), fiscalización UGPP por cruces de nómina y bancos.
Aclara siempre que no sustituyes al contador ni al abogado laboral para decisiones finales.

Reglas:
- Responde en español, directo y concreto, con cifras cuando el contexto las tenga.
- Basa tus respuestas en los DATOS EN VIVO y HALLAZGOS de abajo; si algo no está, dilo.
- Las horas de panel NO capturan trabajo físico (bodega, empaque): úsalas como indicador de
  carga digital, nunca como veredicto único sobre una persona.
- Nunca recomiendes rebajas nominales de salario ni esquemas para evadir aportes; tu rol es
  formalizar y blindar, no ocultar.
- Si te piden cambiar el estado de un hallazgo, indica que se hace desde la pestaña Hallazgos.

=== DATOS EN VIVO (JSON) ===
{resumen}

=== HALLAZGOS REGISTRADOS (JSON) ===
{hallazgos}
"""


def _respuesta_agente(mensaje: str, historial: list[dict]) -> str:
    import app.core as core

    cliente_claude = getattr(core, "cliente_ia", None)
    cliente_gemini = getattr(core, "cliente_gemini", None)
    if not cliente_claude and not cliente_gemini:
        raise RuntimeError("Sin ANTHROPIC_API_KEY ni GOOGLE_API_KEY: el agente RRHH no está disponible")

    data = _cargar()
    resumen = _resumen_completo()
    sistema = _PROMPT_AGENTE.format(
        resumen=json.dumps(resumen, ensure_ascii=False),
        hallazgos=json.dumps(data.get("hallazgos", []), ensure_ascii=False),
    )
    turnos = []
    for turno in (historial or [])[-12:]:
        rol = "assistant" if turno.get("rol") == "assistant" else "user"
        texto = str(turno.get("texto") or "").strip()
        if texto:
            turnos.append({"role": rol, "content": texto})

    if cliente_claude:
        respuesta = cliente_claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1600,
            system=sistema,
            messages=turnos + [{"role": "user", "content": mensaje}],
        )
        partes = [b.text for b in respuesta.content if getattr(b, "type", "") == "text"]
        return "\n".join(partes).strip() or "(sin respuesta)"

    # Fallback Gemini (mismo patrón texto-plano que usa core para chat)
    contexto = "\n".join(
        f"{'Asesor' if t['role'] == 'assistant' else 'Gerencia'}: {t['content']}" for t in turnos
    )
    prompt = (
        f"{sistema}\n\n"
        f"Conversación previa:\n{contexto or '[sin historial]'}\n\n"
        f"Pregunta actual de la gerencia:\n{mensaje}\n\n"
        "Responde solo el texto final para la gerencia."
    )
    resp = cliente_gemini.models.generate_content(model="gemini-2.5-pro", contents=prompt)
    return (getattr(resp, "text", "") or "").strip() or "(sin respuesta)"


# ── Rutas ───────────────────────────────────────────────────────────────────────

def register_rrhh_routes(app):
    @app.route("/api/rrhh/resumen", methods=["GET"])
    @app.route("/app/api/rrhh/resumen", methods=["GET"])
    @_auth_rrhh
    def rrhh_resumen():
        return jsonify(_resumen_completo())

    @app.route("/api/rrhh/hallazgos", methods=["GET"])
    @app.route("/app/api/rrhh/hallazgos", methods=["GET"])
    @_auth_rrhh
    def rrhh_hallazgos_listar():
        data = _cargar()
        return jsonify({"hallazgos": data.get("hallazgos", [])})

    @app.route("/api/rrhh/hallazgos", methods=["POST"])
    @app.route("/app/api/rrhh/hallazgos", methods=["POST"])
    @_auth_rrhh
    def rrhh_hallazgos_crear():
        body = request.get_json(silent=True) or {}
        titulo = str(body.get("titulo") or "").strip()
        if not titulo:
            return jsonify({"error": "Falta el título"}), 400
        hoy = datetime.now().strftime("%Y-%m-%d")
        with _lock:
            data = _cargar()
            hallazgos = data.setdefault("hallazgos", [])
            nuevo = {
                "id": max((h.get("id", 0) for h in hallazgos), default=0) + 1,
                "titulo": titulo[:200],
                "categoria": str(body.get("categoria") or "otro")[:40],
                "severidad": str(body.get("severidad") or "media")[:20],
                "estado": "pendiente",
                "detalle": str(body.get("detalle") or "")[:2000],
                "accion": str(body.get("accion") or "")[:1000],
                "responsable": str(body.get("responsable") or "")[:80],
                "notas": [],
                "creado": hoy,
                "actualizado": hoy,
            }
            hallazgos.append(nuevo)
            _guardar(data)
        return jsonify(nuevo), 201

    @app.route("/api/rrhh/hallazgos/<int:hid>", methods=["PATCH"])
    @app.route("/app/api/rrhh/hallazgos/<int:hid>", methods=["PATCH"])
    @_auth_rrhh
    def rrhh_hallazgos_editar(hid: int):
        body = request.get_json(silent=True) or {}
        with _lock:
            data = _cargar()
            hallazgo = next((h for h in data.get("hallazgos", []) if h.get("id") == hid), None)
            if not hallazgo:
                return jsonify({"error": "Hallazgo no encontrado"}), 404
            if "estado" in body and body["estado"] in ("pendiente", "en_curso", "resuelto", "descartado"):
                hallazgo["estado"] = body["estado"]
            for campo in ("titulo", "detalle", "accion", "responsable", "categoria", "severidad"):
                if campo in body and isinstance(body[campo], str):
                    hallazgo[campo] = body[campo][:2000]
            if body.get("nota"):
                autor = (getattr(request, "rrhh_usuario", {}) or {}).get("nombre", "?")
                hallazgo.setdefault("notas", []).append({
                    "texto": str(body["nota"])[:1000],
                    "autor": autor,
                    "fecha": datetime.now().strftime("%Y-%m-%d %H:%M"),
                })
            hallazgo["actualizado"] = datetime.now().strftime("%Y-%m-%d")
            _guardar(data)
        return jsonify(hallazgo)

    @app.route("/api/rrhh/hallazgos/<int:hid>", methods=["DELETE"])
    @app.route("/app/api/rrhh/hallazgos/<int:hid>", methods=["DELETE"])
    @_auth_rrhh
    def rrhh_hallazgos_borrar(hid: int):
        with _lock:
            data = _cargar()
            antes = len(data.get("hallazgos", []))
            data["hallazgos"] = [h for h in data.get("hallazgos", []) if h.get("id") != hid]
            if len(data["hallazgos"]) == antes:
                return jsonify({"error": "Hallazgo no encontrado"}), 404
            _guardar(data)
        return jsonify({"ok": True})

    @app.route("/api/rrhh/nomina", methods=["PUT"])
    @app.route("/app/api/rrhh/nomina", methods=["PUT"])
    @_auth_rrhh
    def rrhh_nomina_actualizar():
        body = request.get_json(silent=True) or {}
        filas = body.get("nomina")
        if not isinstance(filas, list):
            return jsonify({"error": "Se espera {nomina: [...]}"}), 400
        limpias = []
        for fila in filas[:20]:
            if not isinstance(fila, dict) or not str(fila.get("persona") or "").strip():
                continue
            limpias.append({
                "persona": str(fila.get("persona"))[:80],
                "esquema": str(fila.get("esquema") or "nomina_fija")[:40],
                "devengado": float(fila.get("devengado") or 0),
                "deducciones": float(fila.get("deducciones") or 0),
                "deducciones_detalle": str(fila.get("deducciones_detalle") or "")[:300],
                "neto": float(fila.get("neto") or 0),
                "puntaje": (float(fila["puntaje"]) if fila.get("puntaje") not in (None, "") else None),
                "notas": str(fila.get("notas") or "")[:500],
            })
        with _lock:
            data = _cargar()
            data["nomina"] = limpias
            if isinstance(body.get("matriz_factores"), dict):
                data["matriz_factores"] = body["matriz_factores"]
            _guardar(data)
        return jsonify({"ok": True, "nomina": limpias})

    @app.route("/api/rrhh/agente", methods=["POST"])
    @app.route("/app/api/rrhh/agente", methods=["POST"])
    @_auth_rrhh
    def rrhh_agente():
        body = request.get_json(silent=True) or {}
        mensaje = str(body.get("mensaje") or "").strip()
        if not mensaje:
            return jsonify({"error": "Falta el mensaje"}), 400
        try:
            texto = _respuesta_agente(mensaje, body.get("historial") or [])
        except Exception as e:
            return jsonify({"error": f"Agente RRHH no disponible: {e}"}), 503
        return jsonify({"respuesta": texto})

    print("✅ RRHH · Compensaciones: rutas /api/rrhh/* registradas")
