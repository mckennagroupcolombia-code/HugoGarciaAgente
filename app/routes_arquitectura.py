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

Visor 3D (22-sep-2026): el binario trae una interfaz HTTP del grafo
(`--ui=true`, puerto 9749, solo en 127.0.0.1, sin autenticación, con
`frame-ancestors 'none'`). Como el panel se usa por LAN y por el túnel de
Cloudflare, ese puerto no se alcanza desde el navegador: /app/cbm/... lo proxea con
la sesión del panel (cookie `mck_panel`, que lleva path=/app: por eso el proxy
vive bajo /app y no en la raíz) y exige administrador, reescribe las rutas
absolutas del bundle (/assets, /api, /rpc → /app/cbm/...) y cambia la CSP
para que quepa en un iframe del propio /app. El visor muestra el índice del
demonio que esté escuchando en ese puerto, que no es necesariamente el mismo
snapshot de los JSON.

Ninguna ruta llama a un LLM ni escribe nada.
"""

from __future__ import annotations

import json
import os
import re
from functools import wraps
from pathlib import Path

from flask import Response, jsonify, request

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

# ---------------------------------------------------------------- visor 3D (proxy)

PREFIJO_VISOR = "/app/cbm"


def _url_visor() -> str:
    """Dónde escucha la interfaz HTTP de codebase-memory-mcp (config `ui_port`)."""
    return (os.getenv("CBM_UI_URL") or "http://127.0.0.1:9749").rstrip("/")


# Todo lo que el bundle pide con ruta absoluta (medido sobre index-BiHLJL7z.js
# de la 0.11.0): "/api/…", `/api/…` y "/rpc". Los chunks se importan relativos.
_RE_JS = re.compile(r'(["\'`])/(api|rpc)(?=[/"\'`?])')
_RE_HTML = re.compile(r'\b(src|href)="/(?!/)')
_RE_CSS = re.compile(r'url\(\s*(["\']?)/(?!/)')

# La del visor trae frame-ancestors 'none'; esta es la misma pero embebible en /app.
CSP_VISOR = (
    "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; "
    "script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'self'"
)

_CACHE_ASSETS: dict[str, tuple[bytes, str]] = {}
_CACHE_MAX = 40


def reescribir_visor(cuerpo: bytes, content_type: str, ruta: str, prefijo: str = PREFIJO_VISOR) -> bytes:
    """Reescribe las rutas absolutas del visor para que vivan bajo `prefijo`.

    Se aplica solo a HTML, JS y CSS; el resto (fuentes, imágenes, JSON) pasa
    intacto. Es una función pura para poder probarla sin levantar el demonio.
    """
    ct = (content_type or "").lower()
    es_js = "javascript" in ct or ruta.endswith((".js", ".mjs"))
    es_html = "text/html" in ct
    es_css = "text/css" in ct or ruta.endswith(".css")
    if not (es_js or es_html or es_css):
        return cuerpo
    try:
        texto = cuerpo.decode("utf-8")
    except UnicodeDecodeError:
        return cuerpo
    if es_html:
        texto = _RE_HTML.sub(lambda m: f'{m.group(1)}="{prefijo}/', texto)
    elif es_js:
        texto = _RE_JS.sub(lambda m: f"{m.group(1)}{prefijo}/{m.group(2)}", texto)
    elif es_css:
        texto = _RE_CSS.sub(lambda m: f"url({m.group(1)}{prefijo}/", texto)
    return texto.encode("utf-8")


def _usuario_de_peticion():
    """Bearer (llamadas del panel) o cookie mck_panel (el iframe no manda cabeceras)."""
    try:
        from app.api_auth import bearer_token_from_request
        from app.services.tickets_db import aplicar_privilegios_admin_cynthia, get_usuario_by_token

        token = bearer_token_from_request()
        usuario = get_usuario_by_token(token) if token else None
        if not usuario:
            from app.spa_sesion import usuario_de_cookie

            usuario = usuario_de_cookie()
        return aplicar_privilegios_admin_cynthia(usuario) if usuario else None
    except Exception:
        return None


def estado_visor(timeout: float = 2.0) -> dict:
    """¿Hay un demonio de CBM sirviendo la interfaz? No lanza: el panel muestra el resultado."""
    import requests

    base = _url_visor()
    try:
        r = requests.get(f"{base}/api/ui-config", timeout=timeout)
        r.raise_for_status()
        cfg = r.json() if "json" in (r.headers.get("Content-Type") or "") else {}
        # Directo a la vista 3D del proyecto: sin `tab=graph` el visor abre en su
        # lista de proyectos y hay que pulsar «View Graph», que es justo lo que
        # nadie encontraba.
        proyecto = os.getenv("CBM_PROYECTO") or "home-mckg-mi-agente"
        try:
            proyecto = json.loads((DIR_SNAPSHOT / "resumen.json").read_text("utf-8")).get("proyecto") or proyecto
        except (OSError, json.JSONDecodeError):
            pass
        url = f"{PREFIJO_VISOR}/?tab=graph&project={proyecto}"
        return {"activo": True, "version": cfg.get("version"), "url": url, "proyecto": proyecto, "upstream": base}
    except Exception as e:  # conexión rechazada, timeout, respuesta rara
        return {"activo": False, "url": PREFIJO_VISOR + "/", "upstream": base,
                "motivo": type(e).__name__,
                "comando": "codebase-memory-mcp --ui=true"}


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

    @_dual(app, "/api/arquitectura/visor", methods=["GET"])
    @_auth
    def arquitectura_visor():
        """Si el visor 3D del demonio está encendido y por dónde se abre."""
        return jsonify(estado_visor())

    def _proxy_visor(ruta: str = ""):
        import requests

        from app.api_auth import chat_api_token_matches_request

        if not chat_api_token_matches_request():
            usuario = _usuario_de_peticion()
            if not usuario:
                return jsonify({"error": "Abre el panel con tu sesión para ver el grafo"}), 401
            if not _es_admin(usuario):
                return jsonify({"error": "Arquitectura requiere rol administrador"}), 403

        clave = f"/{ruta}" if ruta else "/"
        cacheable = ruta.startswith("assets/") and request.method == "GET"
        if cacheable and clave in _CACHE_ASSETS:
            cuerpo, ct = _CACHE_ASSETS[clave]
            return Response(cuerpo, 200, {"Content-Type": ct,
                                          "Cache-Control": "public, max-age=31536000, immutable",
                                          "Content-Security-Policy": CSP_VISOR})

        base = _url_visor()
        try:
            r = requests.request(
                request.method, f"{base}{clave}",
                params=request.args.to_dict(flat=False) or None,
                data=request.get_data() if request.method != "GET" else None,
                headers={k: v for k, v in request.headers.items()
                         if k.lower() in ("content-type", "accept")},
                timeout=60, allow_redirects=False,
            )
        except requests.RequestException as e:
            return jsonify({"error": "visor_apagado", "mensaje": str(e)[:200],
                            "comando": "codebase-memory-mcp --ui=true"}), 502

        ct = r.headers.get("Content-Type") or "application/octet-stream"
        cuerpo = reescribir_visor(r.content, ct, clave)
        if cacheable and r.status_code == 200:
            if len(_CACHE_ASSETS) >= _CACHE_MAX:
                _CACHE_ASSETS.clear()
            _CACHE_ASSETS[clave] = (cuerpo, ct)
        cabeceras = {"Content-Type": ct, "Content-Security-Policy": CSP_VISOR,
                     "X-Content-Type-Options": "nosniff"}
        if r.headers.get("Cache-Control") and r.status_code == 200:
            cabeceras["Cache-Control"] = r.headers["Cache-Control"]
        return Response(cuerpo, r.status_code, cabeceras)

    app.add_url_rule(PREFIJO_VISOR + "/", endpoint="cbm_visor_raiz", view_func=_proxy_visor,
                     methods=["GET"])
    app.add_url_rule(PREFIJO_VISOR + "/<path:ruta>", endpoint="cbm_visor", view_func=_proxy_visor,
                     methods=["GET", "POST", "DELETE"])

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
