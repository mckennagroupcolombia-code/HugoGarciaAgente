"""
Arquitectura del código — API del panel (/app → Arquitectura).

Sirve el grafo de dependencias y el reporte de código muerto que produce
codebase-memory-mcp. Endpoints bajo /api/arquitectura/* (y alias
/app/api/arquitectura/* para el proxy del panel).

Acceso: solo administrador. No es dato de negocio sino el mapa interno del
sistema —qué archivo llama a cuál, qué código nadie usa—, y con él se planean
borrados. Mismo criterio que un libro mayor: lo ve quien puede decidir.

Estas rutas NO ejecutan CBM: leen los JSON que deja
scripts/arquitectura_cbm.py en app/data/arquitectura_cbm/. El binario y su
índice viven en el home de otro usuario, inaccesible para el proceso de la app;
y aunque no lo fuera, una consulta al grafo tarda ~20 s y el panel debe abrir
ya. El script se corre a mano o por cron, y cada respuesta trae el campo
`generado` para que el panel muestre de cuándo es lo que estás viendo.

Ninguna ruta llama a un LLM ni escribe nada.
"""

from __future__ import annotations

import json
from functools import wraps
from pathlib import Path

from flask import jsonify, request

DIR_SNAPSHOT = Path(__file__).resolve().parent / "data" / "arquitectura_cbm"

# Los tres que genera scripts/arquitectura_cbm.py. Lista blanca explícita:
# el nombre entra por la URL y de aquí se arma una ruta de archivo.
PIEZAS = ("resumen", "codigo_muerto", "grafo")


def _dual(app, rule: str, **opts):
    """Registra la ruta en /api/... y /app/api/... (ver docs/agentic/modules/desktop-panel.md)."""

    def deco(f):
        app.add_url_rule(rule, endpoint=f.__name__, view_func=f, **opts)
        app.add_url_rule("/app" + rule, endpoint=f.__name__ + "_app", view_func=f, **opts)
        return f

    return deco


def _es_admin(usuario: dict | None) -> bool:
    if not usuario:
        return False
    try:
        from app.services.tickets_db import es_admin_efectivo

        return bool(es_admin_efectivo(usuario))
    except Exception:
        return ((usuario.get("rol") or {}).get("nivel", 0)) >= 3


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
        if not _es_admin(usuario):
            return jsonify({"error": "Arquitectura requiere rol administrador"}), 403
        request.environ["ra_usuario"] = usuario
        return f(*args, **kwargs)

    return wrapper


def _leer(pieza: str):
    """Devuelve (payload, status). Un snapshot ausente no es un error del
    servidor: es que nadie ha corrido el generador todavía, y el panel lo
    explica en pantalla en vez de mostrar una falla."""
    ruta = DIR_SNAPSHOT / f"{pieza}.json"
    if not ruta.exists():
        return {
            "error": "sin_snapshot",
            "mensaje": (
                "Todavía no hay snapshot de arquitectura. "
                "Genéralo con: python3 scripts/arquitectura_cbm.py"
            ),
        }, 404
    try:
        return json.loads(ruta.read_text(encoding="utf-8")), 200
    except (OSError, json.JSONDecodeError) as e:
        return {"error": "snapshot_ilegible", "mensaje": str(e)[:200]}, 500


def register_arquitectura_routes(app):
    @_dual(app, "/api/arquitectura/resumen", methods=["GET"])
    @_auth
    def arquitectura_resumen():
        """Panorama del repo: lenguajes, paquetes, rutas, hotspots, capas."""
        datos, status = _leer("resumen")
        return jsonify(datos), status

    @_dual(app, "/api/arquitectura/codigo-muerto", methods=["GET"])
    @_auth
    def arquitectura_codigo_muerto():
        """Funciones que nadie referencia, ya filtradas.

        Admite ?archivo=<prefijo> para acotar a una carpeta, y ?lenguaje=py|ts|tsx.
        El embudo viaja siempre completo: sin él, el número final no se puede
        juzgar.
        """
        datos, status = _leer("codigo_muerto")
        if status != 200:
            return jsonify(datos), status

        prefijo = (request.args.get("archivo") or "").strip()
        lenguaje = (request.args.get("lenguaje") or "").strip().lstrip(".")
        funciones = datos.get("funciones") or []
        if prefijo:
            funciones = [f for f in funciones if str(f.get("archivo", "")).startswith(prefijo)]
        if lenguaje:
            funciones = [f for f in funciones if f.get("lenguaje") == lenguaje]
        datos["funciones"] = funciones
        datos["filtrado"] = {"archivo": prefijo or None, "lenguaje": lenguaje or None,
                             "devueltas": len(funciones)}
        return jsonify(datos), status

    @_dual(app, "/api/arquitectura/grafo", methods=["GET"])
    @_auth
    def arquitectura_grafo():
        """Grafo archivo→archivo; el peso de la arista son las llamadas que cruzan.

        ?modulo=app|desktop|tests|… recorta a un módulo y sus vecinos directos,
        que es como se vuelve legible un grafo de 600 nodos.
        """
        datos, status = _leer("grafo")
        if status != 200:
            return jsonify(datos), status

        modulo = (request.args.get("modulo") or "").strip()
        if modulo:
            aristas = [
                a for a in datos.get("aristas", [])
                if str(a.get("origen", "")).startswith(modulo + "/")
                or str(a.get("destino", "")).startswith(modulo + "/")
            ]
            vivos = {a["origen"] for a in aristas} | {a["destino"] for a in aristas}
            datos["aristas"] = aristas
            datos["nodos"] = [n for n in datos.get("nodos", []) if n.get("archivo") in vivos]
            datos["filtrado"] = {"modulo": modulo, "nodos": len(datos["nodos"]),
                                 "aristas": len(aristas)}
        return jsonify(datos), status

    @_dual(app, "/api/arquitectura/estado", methods=["GET"])
    @_auth
    def arquitectura_estado():
        """De cuándo es cada snapshot y si falta alguno. Es lo que consulta el
        panel al abrir, antes de pedir los payloads grandes."""
        estado = {}
        for pieza in PIEZAS:
            ruta = DIR_SNAPSHOT / f"{pieza}.json"
            if not ruta.exists():
                estado[pieza] = {"presente": False}
                continue
            generado = None
            try:
                generado = json.loads(ruta.read_text(encoding="utf-8")).get("generado")
            except (OSError, json.JSONDecodeError):
                pass
            estado[pieza] = {"presente": True, "generado": generado, "bytes": ruta.stat().st_size}
        return jsonify({"piezas": estado, "comando": "python3 scripts/arquitectura_cbm.py"})
