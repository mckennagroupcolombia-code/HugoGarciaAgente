# -*- coding: utf-8 -*-
"""Empresa viva — el estado de la operación para el juego de /app (panel «empresa-viva»).

El juego dibuja a McKenna como un tablero de rol: un muñequito por cada pregunta de
preventa esperando en la puerta de la tienda, un cliente de WhatsApp sin respuesta,
la fila de paquetes esperando el camión, el proveedor descargando en el muelle y el
avatar de cada persona del equipo en la parte de la empresa donde está trabajando.

Reglas (las mismas del Mapa, `mapa_app.py`):
- **Solo lectura.** El juego no tiene estado propio de la operación: todo sale de las
  fuentes que ya existen. Lo que se «hace» en el juego abre el panel de verdad.
- **Sin LLM.** La única red es la API de MercadoLibre (órdenes pagadas y su envío), en
  segundo plano, con caché; nunca en el camino de la petición.
- **Una fuente caída no tumba el tablero:** se omite y se anota en `sin_senal`.
- **Cada quien ve lo suyo:** los conteos los ve todo el equipo interno; el texto de una
  pregunta, el barrio de un envío o el nombre de un proveedor solo quien puede abrir ese
  panel (`acceso_paneles.puede_ver_panel`, decidido en el servidor).

Las transiciones (pregunta atendida, paquete alistado, paquete que sale, proveedor
registrado) se detectan comparando la foto anterior con la nueva, y se atribuyen a
quien las hizo con los eventos que el panel y los comandos de WhatsApp ya registran
(`panel_eventos_operativos`). El juego anima esas transiciones.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "app" / "data"

_TTL_S = 10            # foto local (archivos y SQLite): barata, se renueva seguido
_TTL_MELI_S = 60       # órdenes MeLi: una consulta a la API por minuto como mucho
_TTL_ENVIO_S = 300     # estado de cada envío MeLi ya consultado
_MAX_ENVIOS_POR_RONDA = 40
_EVENTOS_VIDA_S = 15 * 60
_MAX_VISITANTES = 14   # la tienda no se llena de cientos de muñecos: el resto va en «+N»
_MAX_PAQUETES = 24

_lock = threading.Lock()
_memo: dict[str, Any] = {"t": 0.0, "data": None}
_prev: dict[str, dict[str, str]] = {}
_eventos: deque = deque(maxlen=80)
_seq = [0]

_meli_lock = threading.Lock()
_meli: dict[str, Any] = {"t": 0.0, "paquetes": [], "error": None}
_meli_refrescando = threading.Event()
_envios_memo: dict[str, tuple[float, dict]] = {}


def _ro(ruta: Path) -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True, timeout=3)
    con.row_factory = sqlite3.Row
    return con


def _iso_local(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


# ─── Personas ────────────────────────────────────────────────────────────────

def casas() -> dict:
    """Quién vive en qué casa del barrio y con qué avatar (app/data/empresa_viva_casas.json)."""
    try:
        return json.loads((DATA / "empresa_viva_casas.json").read_text(encoding="utf-8"))
    except Exception:
        return {"usuarios": {}, "ocultos": []}


def _usuarios_ocultos(con: sqlite3.Connection) -> set[int]:
    """Quien no es del equipo interno no aparece en el tablero (contador, colaborador externo,
    cuentas genéricas listadas en `ocultos` de la configuración de casas)."""
    genericas = set(casas().get("ocultos") or []) | {"hugo_ia_bot", "prueba"}
    ocultos: set[int] = set()
    for r in con.execute("SELECT id, username, permisos_secciones FROM usuarios"):
        try:
            p = json.loads(r["permisos_secciones"] or "{}") or {}
        except Exception:
            p = {}
        if p.get("contador") or p.get("colaborador_externo") or r["username"] in genericas:
            ocultos.add(int(r["id"]))
    return ocultos


# Comando de un grupo de WhatsApp → panel donde «está» esa persona mientras lo hace.
_COMANDO_PANEL = (
    (re.compile(r"^(resp|ok)\b", re.I), "preventa"),
    (re.compile(r"^posventa\b", re.I), "postventa"),
    (re.compile(r"^(facturar|anular|cancelar)\b", re.I), "facturacion"),
    (re.compile(r"^(envio|envío|entregado)\b", re.I), "pedidos"),
    (re.compile(r"^(no)\b", re.I), "pagos"),
)


def _panel_de_comando(texto: str) -> str:
    t = (texto or "").strip().lstrip("*_~` ")
    for rx, panel in _COMANDO_PANEL:
        if rx.match(t):
            return panel
    return "chat-equipo"


def _personas() -> list[dict]:
    """Todo el equipo interno. Quien está conectado lleva el panel que tiene abierto (o el
    comando de WhatsApp que acaba de mandar); quien no, `en_linea=False` (el juego lo dibuja
    en su cuarto si vive en el barrio, o no lo dibuja)."""
    from app.services.panel_presencia import ONLINE_IDLE_MINUTES
    from app.services.tickets_db import DB_PATH

    corte = (datetime.now() - timedelta(minutes=ONLINE_IDLE_MINUTES)).strftime("%Y-%m-%d %H:%M:%S")
    con = _ro(Path(DB_PATH))
    try:
        ocultos = _usuarios_ocultos(con)
        equipo = {int(r["id"]): {"id": int(r["id"]), "nombre": (r["nombre"] or r["username"] or "").strip(),
                                 "username": r["username"] or "", "en_linea": False, "panel": "", "via": "",
                                 "avatar": _avatar_de(r["preferencias_ui"]), "funciones": []}
                  for r in con.execute("SELECT id, nombre, username, preferencias_ui FROM usuarios WHERE activo=1")
                  if int(r["id"]) not in ocultos}
        for r in con.execute(
            "SELECT usuario_id, panel_actual, ultimo_ping FROM panel_sesiones_operativas "
            "WHERE activa=1 AND ultimo_ping >= ? ORDER BY ultimo_ping DESC", (corte,)
        ):
            p = equipo.get(int(r["usuario_id"]))
            if p and not p["en_linea"]:
                p.update(en_linea=True, panel=r["panel_actual"] or "mapa-vivo", via="panel")
        # Quien no tiene el panel abierto pero acaba de mandar un comando en un grupo de WhatsApp
        # también está trabajando: se dibuja con el celular, en el sitio de ese comando.
        # (creado_en de los eventos va en UTC: datetime('now') de SQLite.)
        for r in con.execute(
            "SELECT usuario_id, detalle FROM panel_eventos_operativos "
            "WHERE tipo='comando_wa' AND creado_en >= datetime('now','-10 minutes') ORDER BY id DESC"
        ):
            p = equipo.get(int(r["usuario_id"]))
            if p and not p["en_linea"]:
                p.update(en_linea=True, panel=_panel_de_comando(r["detalle"] or ""), via="whatsapp")
    finally:
        con.close()
    for uid, funciones in _funciones_por_persona().items():
        if uid in equipo:
            equipo[uid]["funciones"] = funciones
    return sorted(equipo.values(), key=lambda p: p["id"])


def _avatar_de(preferencias_ui: str | None) -> dict | None:
    """El avatar que la persona eligió en el juego (preferencias_ui.empresa), o None."""
    try:
        emp = (json.loads(preferencias_ui or "{}") or {}).get("empresa")
    except Exception:
        return None
    return emp if isinstance(emp, dict) and emp.get("avatar") else None


def _funciones_por_persona(maximo: int = 4) -> dict[int, list[str]]:
    """Lo que cada quien hace de verdad (catálogo de rendimiento, últimos 60 días): solo los
    nombres de las funciones, en orden. Nada de horas ni conteos (eso es de RRHH)."""
    try:
        from app.services import rendimiento

        quien = rendimiento.quien_hace()
        nombres = {cid: c[1] for cid, c in rendimiento._POR_ID.items()}
    except Exception:
        return {}
    por: dict[int, list[tuple[float, str]]] = {}
    for cid, filas in quien.items():
        nombre = nombres.get(cid)
        if not nombre:
            continue
        for f in filas:
            por.setdefault(int(f["id"]), []).append((float(f.get("peso") or 0), nombre))
    return {uid: [n for _, n in sorted(xs, key=lambda t: -t[0])[:maximo]] for uid, xs in por.items()}


# ─── Quién le habla a quién ──────────────────────────────────────────────────

_VENTANA_INTER_S = 20 * 60


def _interacciones() -> list[dict]:
    """Lo que el equipo se dijo en los últimos 20 minutos: solicitudes y preguntas de una
    persona a otra, las respuestas en esos hilos, y los mensajes en los grupos del chat del
    equipo. El juego las dibuja como avioncitos de papel de un avatar a otro."""
    from app.services.tickets_db import DB_PATH

    con = _ro(Path(DB_PATH))
    out: list[dict] = []
    try:
        ocultos = _usuarios_ocultos(con)
        for r in con.execute(
            "SELECT id, titulo, subtipo, creado_por, asignado_a, CAST(strftime('%s', creado_en) AS INTEGER) AS ts "
            "FROM tickets WHERE tipo='solicitud' AND creado_en >= datetime('now', ?) AND asignado_a IS NOT NULL "
            "AND creado_por != asignado_a", (f"-{_VENTANA_INTER_S} seconds",)
        ):
            if r["creado_por"] in ocultos or r["asignado_a"] in ocultos:
                continue
            out.append({"id": f"t{r['id']}", "tipo": "pregunta" if r["subtipo"] == "pregunta" else "solicitud",
                        "de": r["creado_por"], "para": [r["asignado_a"]], "ts": r["ts"], "ticket_id": r["id"],
                        "texto": (r["titulo"] or "")[:120], "privado": True})
        for r in con.execute(
            "SELECT c.id, c.usuario_id, c.texto, t.id AS tid, t.creado_por, t.asignado_a, "
            "CAST(strftime('%s', c.creado_en) AS INTEGER) AS ts FROM comentarios_tickets c JOIN tickets t ON t.id = c.ticket_id "
            "WHERE c.creado_en >= datetime('now', ?) AND COALESCE(c.es_interno, 0) = 0 AND t.tipo = 'solicitud'",
            (f"-{_VENTANA_INTER_S} seconds",)
        ):
            otro = r["creado_por"] if r["usuario_id"] == r["asignado_a"] else r["asignado_a"]
            if not otro or otro == r["usuario_id"] or r["usuario_id"] in ocultos or otro in ocultos:
                continue
            out.append({"id": f"r{r['id']}", "tipo": "respuesta", "de": r["usuario_id"], "para": [otro], "ts": r["ts"],
                        "ticket_id": r["tid"], "texto": (r["texto"] or "")[:120], "privado": True})
        canales = {int(r["id"]): r["nombre"] for r in con.execute("SELECT id, nombre FROM canales_internos WHERE archivado=0")}
        miembros: dict[int, list[int]] = {}
        for r in con.execute("SELECT canal_id, usuario_id FROM canal_miembros"):
            miembros.setdefault(int(r["canal_id"]), []).append(int(r["usuario_id"]))
        for r in con.execute(
            "SELECT id, canal_id, usuario_id, texto, CAST(creado_en AS INTEGER) AS ts FROM canal_mensajes "
            "WHERE creado_en >= ? AND eliminado = 0 AND usuario_id IS NOT NULL AND tipo = 'mensaje'",
            (time.time() - _VENTANA_INTER_S,)
        ):
            cid = int(r["canal_id"])
            if cid not in canales or r["usuario_id"] in ocultos:
                continue
            texto = (r["texto"] or "").strip()
            out.append({"id": f"m{r['id']}", "tipo": "idea" if re.match(r"^\W*idea\b", texto, re.I) else "grupo",
                        "de": r["usuario_id"], "para": [u for u in miembros.get(cid, []) if u != r["usuario_id"] and u not in ocultos],
                        "todos": not miembros.get(cid), "canal_id": cid, "canal": canales[cid], "ts": r["ts"],
                        "texto": texto[:140], "privado": False})
    finally:
        con.close()
    out.sort(key=lambda x: x["ts"])
    return out[-40:]


# ─── Tienda: preventa MeLi y clientes de WhatsApp ────────────────────────────

def _preventa() -> list[dict]:
    d = json.loads((DATA / "preguntas_pendientes_preventa.json").read_text(encoding="utf-8"))
    out = []
    for p in d.get("preguntas") or []:
        if p.get("respondida"):
            continue
        out.append({
            "id": f"q{p.get('question_id')}",
            "tipo": "preventa",
            "desde": p.get("timestamp") or "",
            "producto": (p.get("titulo_producto") or "").strip()[:80],
            "texto": (p.get("pregunta") or "").strip()[:160],
            "panel": "preventa",
        })
    out.sort(key=lambda v: v["desde"])
    return out


def _telefonos_equipo() -> set[str]:
    from app.services.tickets_db import DB_PATH

    con = _ro(Path(DB_PATH))
    try:
        return {re.sub(r"\D", "", r[0])[-10:] for r in con.execute(
            "SELECT telefono FROM usuarios WHERE telefono IS NOT NULL AND telefono != ''") if r[0]}
    finally:
        con.close()


def _clientes_wa() -> list[dict]:
    """Chats de clientes cuyo último mensaje es del cliente (nadie le ha contestado), de las
    últimas 2 horas. Lo más viejo no es «alguien en la puerta»: eso ya es seguimiento."""
    ruta = DATA / "wa_chats.db"
    if not ruta.is_file():
        return []
    equipo = _telefonos_equipo()
    con = _ro(ruta)
    try:
        filas = con.execute(
            """SELECT m.jid, m.ts, m.direccion, m.texto FROM mensajes m
               JOIN (SELECT jid, MAX(ts) AS ts FROM mensajes
                     WHERE ts >= strftime('%s','now') - 7200 AND eliminado = 0
                       AND jid NOT LIKE '%@g.us' AND jid NOT LIKE '%@broadcast'
                     GROUP BY jid) u ON u.jid = m.jid AND u.ts = m.ts"""
        ).fetchall()
    finally:
        con.close()
    out = []
    for r in filas:
        if r["direccion"] != "entrada":
            continue
        dig = re.sub(r"\D", "", r["jid"] or "")
        if dig[-10:] in equipo:
            continue
        out.append({
            "id": f"w{dig[-12:]}",
            "tipo": "whatsapp",
            "desde": _iso_local(datetime.fromtimestamp(float(r["ts"]))),
            "producto": "",
            "texto": (r["texto"] or "").strip()[:120],
            "panel": "whatsapp",
        })
    out.sort(key=lambda v: v["desde"])
    return out


def _quien_contesto_wa(jid_digitos: str) -> dict | None:
    """El último mensaje de salida a ese chat: del bot (Hugo) o de un asesor."""
    ruta = DATA / "wa_chats.db"
    con = _ro(ruta)
    try:
        r = con.execute(
            "SELECT enviado_por FROM mensajes WHERE jid LIKE ? AND direccion='salida' "
            "AND ts >= strftime('%s','now') - 1800 ORDER BY ts DESC LIMIT 1",
            (f"%{jid_digitos}%",),
        ).fetchone()
    finally:
        con.close()
    if not r:
        return None
    return {"id": 0, "nombre": "Hugo", "bot": True} if r["enviado_por"] == "bot" else {"id": None, "nombre": "Un asesor"}


# ─── Despacho: paquetes ──────────────────────────────────────────────────────

def _evidencias(dias: int = 6) -> dict[tuple[str, str], dict]:
    """Foto del paquete listo (panel Empaque) = paquete alistado, y por quién."""
    ruta = DATA / "empaque_evidencia.db"
    if not ruta.is_file():
        return {}
    corte = (datetime.now() - timedelta(days=dias)).strftime("%Y-%m-%d")
    con = _ro(ruta)
    try:
        out = {}
        for r in con.execute(
            "SELECT canal, venta_id, subido_por, subido_por_id FROM evidencias WHERE creado_en >= ? ORDER BY id",
            (corte,),
        ):
            out[(r["canal"], str(r["venta_id"]))] = {"id": r["subido_por_id"], "nombre": (r["subido_por"] or "").strip()}
        return out
    finally:
        con.close()


def _flex_por_orden() -> dict[str, dict]:
    """Envíos Flex conocidos (cron 23:15 + sincronización del panel): sirve para saber si
    un paquete ya salió sin preguntarle a MeLi."""
    ruta = DATA / "entregas_flex.db"
    if not ruta.is_file():
        return {}
    con = _ro(ruta)
    try:
        return {str(r["order_id"]): dict(r) for r in con.execute(
            "SELECT order_id, shipment_id, localidad, impreso, salida, entregado FROM envios_flex "
            "WHERE compra >= date('now','-6 day')")}
    finally:
        con.close()


def _estado_envio_meli(sesion, token: str, shipment_id: str) -> dict:
    ahora = time.time()
    viejo = _envios_memo.get(shipment_id)
    if viejo and ahora - viejo[0] < _TTL_ENVIO_S:
        return viejo[1]
    r = sesion.get(f"https://api.mercadolibre.com/shipments/{shipment_id}",
                   headers={"Authorization": f"Bearer {token}", "x-format-new": "true"}, timeout=10)
    d = r.json() if r.status_code == 200 else {}
    direccion = (d.get("destination") or {}).get("shipping_address") or d.get("receiver_address") or {}
    barrio = direccion.get("neighborhood") if isinstance(direccion, dict) else None
    ciudad = direccion.get("city") if isinstance(direccion, dict) else None
    lugar = (barrio or {}).get("name") if isinstance(barrio, dict) else ""
    lugar = lugar or ((ciudad or {}).get("name") if isinstance(ciudad, dict) else "")
    info = {"status": str(d.get("status") or ""), "substatus": str(d.get("substatus") or ""), "localidad": str(lugar or "")}
    if d:
        _envios_memo[shipment_id] = (ahora, info)
    return info


def _clasificar(status: str, substatus: str, evidencia: bool) -> str | None:
    """Estado del paquete en el tablero: por_alistar → alistado → en_ruta. None = fuera."""
    s, ss = status.lower(), substatus.lower()
    if s in ("delivered", "cancelled", "not_delivered", "returned"):
        return None
    if s == "shipped":
        return "en_ruta"
    if evidencia or ss in ("printed", "ready_for_pickup", "ready_for_dropoff", "picked_up", "in_hub"):
        return "alistado"
    return "por_alistar"


def _refrescar_meli() -> None:
    """Órdenes MeLi pagadas de los últimos 3 días y su envío. En segundo plano."""
    import requests

    from app.utils import obtener_seller_id_meli, refrescar_token_meli

    paquetes: list[dict] = []
    error = None
    try:
        token = refrescar_token_meli()
        seller = obtener_seller_id_meli()
        if not token or not seller:
            raise RuntimeError("sin token de MercadoLibre")
        desde = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S.000-00:00")
        ses = requests.Session()
        r = ses.get(
            f"https://api.mercadolibre.com/orders/search?seller={seller}&order.status=paid&sort=date_desc"
            f"&limit=50&order.date_created.from={desde}",
            headers={"Authorization": f"Bearer {token}"}, timeout=18,
        )
        if r.status_code != 200:
            raise RuntimeError(f"orders/search HTTP {r.status_code}")
        for sid in [k for k, (t, _) in _envios_memo.items() if time.time() - t > 86400]:
            _envios_memo.pop(sid, None)
        evid = _evidencias()
        flex = _flex_por_orden()
        vistos: set[str] = set()
        consultas = 0
        for o in r.json().get("results") or []:
            tags = set(o.get("tags") or [])
            # «not_delivered» = todavía no entregado (casi todas las pagadas lo traen), no un fallo.
            if "delivered" in tags:
                continue
            oid = str(o.get("id") or "")
            pack = str(o.get("pack_id") or oid)
            envio_id = str((o.get("shipping") or {}).get("id") or "")
            clave = envio_id or pack
            if not clave or clave in vistos:
                continue
            vistos.add(clave)
            ev = evid.get(("meli", pack)) or evid.get(("meli", oid))
            fx = flex.get(oid) or {}
            status, substatus, localidad = "", "", fx.get("localidad") or ""
            if fx.get("entregado"):
                continue
            if fx.get("salida"):
                status = "shipped"
            elif envio_id:
                if envio_id not in _envios_memo:
                    if consultas >= _MAX_ENVIOS_POR_RONDA:
                        continue  # sin saber su estado no se dibuja: entra en la próxima ronda
                    consultas += 1
                info = _estado_envio_meli(ses, token, envio_id)
                status, substatus = info.get("status", ""), info.get("substatus", "")
                localidad = localidad or info.get("localidad", "")
            estado = _clasificar(status, substatus, bool(ev))
            if not estado:
                continue
            items = o.get("order_items") or []
            paquetes.append({
                "id": f"m{clave}",
                "canal": "meli",
                "flex": bool(fx),
                "estado": estado,
                "desde": str(o.get("date_created") or "")[:19],
                "unidades": sum(int(i.get("quantity") or 1) for i in items),
                "producto": str(((items[0] if items else {}).get("item") or {}).get("title") or "")[:70],
                "lugar": localidad,
                "alistado_por": ev,
                "panel": "empaque",
            })
    except Exception as exc:
        error = str(exc)[:160]
    with _meli_lock:
        if error is None or not _meli["paquetes"]:
            _meli["paquetes"] = paquetes
        _meli.update(t=time.time(), error=error)


def _paquetes_meli() -> list[dict]:
    with _meli_lock:
        viejo = time.time() - _meli["t"] >= _TTL_MELI_S
        paquetes, error = list(_meli["paquetes"]), _meli["error"]
    if viejo and not _meli_refrescando.is_set():
        _meli_refrescando.set()

        def _run():
            try:
                _refrescar_meli()
            finally:
                _meli_refrescando.clear()

        threading.Thread(target=_run, name="empresa-viva-meli", daemon=True).start()
    if error and not paquetes:
        raise RuntimeError(error)
    return paquetes


def _paquetes_web() -> list[dict]:
    ruta = REPO / "PAGINA_WEB" / "site" / "data" / "orders.db"
    evid = _evidencias()
    con = _ro(ruta)
    try:
        filas = con.execute(
            "SELECT reference, id, created_at, shipping_status, buyer_city, items_json FROM orders "
            "WHERE lower(status) IN ('approved','paid') AND created_at >= date('now','-10 day') "
            "AND COALESCE(cancelled_at,'') = '' AND COALESCE(delivered_at,'') = '' "
            "AND (shipping_status IN ('preparing','pending','') OR shipping_status IS NULL "
            "     OR (shipping_status='shipped' AND created_at >= date('now','-3 day')))"
        ).fetchall()
    finally:
        con.close()
    out = []
    for r in filas:
        ref = str(r["reference"] or r["id"])
        ev = evid.get(("web", ref))
        estado = "en_ruta" if r["shipping_status"] == "shipped" else ("alistado" if ev else "por_alistar")
        try:
            raw = json.loads(r["items_json"] or "{}")
            items = raw.get("items", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        except Exception:
            items = []
        primero = items[0] if items and isinstance(items[0], dict) else {}
        out.append({
            "id": f"web{ref}",
            "canal": "web",
            "flex": False,
            "estado": estado,
            "desde": str(r["created_at"] or "")[:19],
            "unidades": sum(int((i or {}).get("quantity") or (i or {}).get("qty") or 1) for i in items if isinstance(i, dict)) or 1,
            "producto": str(primero.get("name") or primero.get("title") or "")[:70],
            "lugar": r["buyer_city"] or "",
            "alistado_por": ev,
            "panel": "pedidos",
        })
    return out


def _paquetes_wa() -> list[dict]:
    ruta = DATA / "despachos.db"
    if not ruta.is_file():
        return []
    con = _ro(ruta)
    try:
        filas = con.execute(
            "SELECT order_id, cliente, ciudad, productos, estado, creado_en FROM despachos "
            "WHERE upper(COALESCE(estado,'PENDIENTE')) NOT IN ('ENTREGADO','CANCELADO') "
            "AND COALESCE(creado_en,'') >= ?", ((datetime.now() - timedelta(days=7)).isoformat(),)
        ).fetchall()
    finally:
        con.close()
    return [{
        "id": f"wa{r['order_id']}", "canal": "whatsapp", "flex": False,
        "estado": "en_ruta" if (r["estado"] or "").upper() in ("ENVIADO", "DESPACHADO") else "por_alistar",
        "desde": str(r["creado_en"] or "")[:19], "unidades": 1,
        "producto": str(r["productos"] or "")[:70], "lugar": r["ciudad"] or "",
        "alistado_por": None, "panel": "empaque",
    } for r in filas]


# ─── Muelle: proveedores ─────────────────────────────────────────────────────

def _proveedores() -> list[dict]:
    ruta = DATA / "recepciones.db"
    if not ruta.is_file():
        return []
    hace_4h = time.time() - 4 * 3600
    con = _ro(ruta)
    try:
        filas = con.execute(
            """SELECT r.id, r.proveedor, r.estado, r.recibido_por, r.recibido_por_nombre, r.cerrado_por,
                      r.creada_en, r.cerrada_en,
                      (SELECT COUNT(*) FROM recepcion_items i WHERE i.recepcion_id = r.id) AS items
               FROM recepciones r
               WHERE r.estado = 'abierta' OR COALESCE(r.cerrada_en, 0) >= ?""",
            (hace_4h,),
        ).fetchall()
    finally:
        con.close()
    return [{
        "id": f"r{r['id']}",
        "estado": "descargando" if r["estado"] == "abierta" else "registrado",
        "proveedor": (r["proveedor"] or "").strip()[:60],
        "items": int(r["items"] or 0),
        "recibe": {"id": r["recibido_por"], "nombre": (r["recibido_por_nombre"] or "").strip()} if r["recibido_por"] else None,
        "cerrado_por": r["cerrado_por"],
        "desde": _iso_local(datetime.fromtimestamp(float(r["creada_en"]))),
        "panel": "recepcion-mercancia",
    } for r in filas]


# ─── Bodega ──────────────────────────────────────────────────────────────────

def _bodega() -> dict:
    """Existencias por publicación (caché del Control de inventario). `por_reponer`: lo agotado
    y lo crítico, primero lo que más rota (lo que más urge reponer)."""
    d = json.loads((DATA / "inventario_control_resumen_cache.json").read_text(encoding="utf-8"))
    items = (d.get("data") or {}).get("items") or []
    cuenta = {"agotado": 0, "critico": 0}
    reponer = []
    for x in items:
        est = x.get("estado")
        if est in cuenta:
            cuenta[est] += 1
            reponer.append({"sku": x.get("sku") or "", "nombre": (x.get("nombre") or "")[:70], "estado": est,
                            "stock": x.get("stock_meli"), "rotacion": x.get("rotacion")})

    # La rotación viene como etiqueta (alta/media/baja/sin_ventas); dentro de cada una, menos stock primero.
    rango = {"alta": 0, "media": 1, "baja": 2}
    reponer.sort(key=lambda r: (r["estado"] != "agotado", rango.get(str(r["rotacion"]), 3), r["stock"] or 0, r["nombre"]))
    return {"publicaciones": len(items), "agotados": cuenta["agotado"], "criticos": cuenta["critico"],
            "por_reponer": reponer[:30], "panel": "control-inventario"}


# ─── Quién hizo qué ──────────────────────────────────────────────────────────

def _nombre_usuario(uid: int | None) -> str:
    if not uid:
        return ""
    from app.services.tickets_db import DB_PATH

    con = _ro(Path(DB_PATH))
    try:
        r = con.execute("SELECT nombre, username FROM usuarios WHERE id=?", (int(uid),)).fetchone()
        return ((r["nombre"] or r["username"]) if r else "") or ""
    finally:
        con.close()


def _quien_respondio_preventa(qid: str) -> dict | None:
    """Panel (evento `preventa_respondida` con el question_id) o comando del grupo
    (`resp 497: …`, `ok 497`, `resp preventa <id>: …`). Sin rastro humano y con nota del
    monitor/supervisor, la contestó Hugo."""
    from app.services.tickets_db import DB_PATH

    con = _ro(Path(DB_PATH))
    try:
        r = con.execute(
            "SELECT usuario_id FROM panel_eventos_operativos WHERE tipo='preventa_respondida' "
            "AND creado_en >= datetime('now','-40 minutes') AND detalle LIKE ? ORDER BY id DESC LIMIT 1",
            (f"%{qid}%",),
        ).fetchone()
        if r:
            uid = int(r["usuario_id"])
            return {"id": uid, "nombre": _nombre_usuario(uid)}
        for r in con.execute(
            "SELECT usuario_id, detalle FROM panel_eventos_operativos WHERE tipo='comando_wa' "
            "AND creado_en >= datetime('now','-40 minutes') ORDER BY id DESC LIMIT 60"
        ):
            m = re.match(r"^\W*(?:resp|ok)\s+(?:preventa\s+)?(\d{3,})", (r["detalle"] or "").strip(), re.I)
            if m and qid.endswith(m.group(1)):
                uid = int(r["usuario_id"])
                return {"id": uid, "nombre": _nombre_usuario(uid)}
    finally:
        con.close()
    try:
        d = json.loads((DATA / "preguntas_pendientes_preventa.json").read_text(encoding="utf-8"))
        for p in d.get("preguntas") or []:
            if str(p.get("question_id")) == qid and re.search(r"monitor|supervisor|autom", p.get("nota") or "", re.I):
                return {"id": 0, "nombre": "Hugo", "bot": True}
    except Exception:
        pass
    return None


def _nuevo_evento(tipo: str, objeto: str, por: dict | None, **extra) -> None:
    _seq[0] += 1
    _eventos.append({"seq": _seq[0], "ts": time.time(), "tipo": tipo, "objeto": objeto, "por": por, **extra})


def _detectar_transiciones(data: dict) -> None:
    """Compara la foto nueva con la anterior y anota lo que pasó. La primera foto (al
    arrancar el servidor) no genera eventos: no se sabe qué cambió."""
    actual = {
        "visitantes": {v["id"]: "esperando" for v in data["visitantes"]},
        "paquetes": {p["id"]: p["estado"] for p in data["paquetes"]},
        "proveedores": {p["id"]: p["estado"] for p in data["proveedores"]},
    }
    alistador = {p["id"]: p.get("alistado_por") for p in data["paquetes"]}
    cerrado = {p["id"]: p.get("cerrado_por") for p in data["proveedores"]}
    sin = {s["fuente"] for s in data["sin_senal"]}
    if _prev:
        if not sin & {"preventa MeLi", "WhatsApp"}:
            for vid in _prev["visitantes"].keys() - actual["visitantes"].keys():
                try:
                    por = _quien_respondio_preventa(vid[1:]) if vid.startswith("q") else _quien_contesto_wa(vid[1:])
                except Exception:
                    por = None
                _nuevo_evento("atendido", vid, por)
        if not sin & {"pedidos MeLi", "pedidos web", "despachos WhatsApp"}:
            for pid, est in actual["paquetes"].items():
                antes = _prev["paquetes"].get(pid)
                if antes == "por_alistar" and est == "alistado":
                    _nuevo_evento("alistado", pid, alistador.get(pid))
                elif antes in ("por_alistar", "alistado") and est == "en_ruta":
                    _nuevo_evento("salio", pid, None)
        if "recepciones" not in sin:
            for rid, est in actual["proveedores"].items():
                if _prev["proveedores"].get(rid) == "descargando" and est == "registrado":
                    uid = cerrado.get(rid)
                    _nuevo_evento("registrado", rid, {"id": uid, "nombre": _nombre_usuario(uid)} if uid else None)
            for rid in actual["proveedores"].keys() - _prev["proveedores"].keys():
                _nuevo_evento("llego_proveedor", rid, None)
    # Una fuente caída no borra lo que se sabía de ella: si no, al volver todo parecería nuevo.
    for clave, fuentes in (("visitantes", {"preventa MeLi", "WhatsApp"}),
                           ("paquetes", {"pedidos MeLi", "pedidos web", "despachos WhatsApp"}),
                           ("proveedores", {"recepciones"})):
        if sin & fuentes and _prev.get(clave):
            actual[clave] = {**_prev[clave], **actual[clave]}
    _prev.clear()
    _prev.update(actual)
    corte = time.time() - _EVENTOS_VIDA_S
    while _eventos and _eventos[0]["ts"] < corte:
        _eventos.popleft()


# ─── Foto completa ───────────────────────────────────────────────────────────

_FUENTES: tuple[tuple[str, str, Callable[[], Any]], ...] = (
    ("personas", "presencia", _personas),
    ("preventa", "preventa MeLi", _preventa),
    ("whatsapp", "WhatsApp", _clientes_wa),
    ("meli", "pedidos MeLi", _paquetes_meli),
    ("web", "pedidos web", _paquetes_web),
    ("wa", "despachos WhatsApp", _paquetes_wa),
    ("proveedores", "recepciones", _proveedores),
    ("bodega", "inventario", _bodega),
    ("interacciones", "mensajes del equipo", _interacciones),
)


def _foto() -> dict:
    vals: dict[str, Any] = {}
    sin_senal: list[dict] = []
    for clave, nombre, fuente in _FUENTES:
        try:
            vals[clave] = fuente()
        except Exception as exc:  # una fuente caída no tumba el tablero
            vals[clave] = None
            sin_senal.append({"fuente": nombre, "error": str(exc)[:160]})
    visitantes = (vals["preventa"] or []) + (vals["whatsapp"] or [])
    paquetes = (vals["meli"] or []) + (vals["web"] or []) + (vals["wa"] or [])
    paquetes.sort(key=lambda p: p["desde"])
    return {
        "personas": vals["personas"] or [],
        "visitantes": visitantes,
        "paquetes": paquetes,
        "proveedores": vals["proveedores"] or [],
        "bodega": vals["bodega"],
        "interacciones": vals["interacciones"] or [],
        "sin_senal": sin_senal,
        "generado": _iso_local(datetime.now()),
    }


def foto(refrescar: bool = False) -> dict:
    with _lock:
        if not refrescar and _memo["data"] is not None and time.time() - _memo["t"] < _TTL_S:
            return _memo["data"]
        data = _foto()
        _detectar_transiciones(data)
        data["eventos"] = list(_eventos)
        _memo.update(t=time.time(), data=data)
        return data


# ─── Lo que ve cada persona ──────────────────────────────────────────────────

def puede_ver_juego(usuario: dict | None) -> bool:
    """Todo el equipo interno; no el contador ni el colaborador externo (como el Mapa)."""
    if not usuario:
        return False
    p = usuario.get("permisos_secciones") or {}
    return not (p.get("contador") or p.get("colaborador_externo"))


def estado_para(usuario: dict, refrescar: bool = False) -> dict:
    """La foto, recortada a lo que esta persona puede ver. Los conteos y las figuras los ve
    todo el equipo; los textos (pregunta, cliente, barrio, proveedor) solo quien abre ese panel."""
    from app.services.acceso_paneles import _es_admin, puede_ver_panel
    from app.services import mapa_app

    d = foto(refrescar=refrescar)
    cache: dict[str, bool] = {}

    def puede(panel: str) -> bool:
        if panel not in cache:
            cache[panel] = puede_ver_panel(usuario, panel)
        return cache[panel]

    ver_despacho = puede("pedidos") or puede("empaque") or puede("entregas-flex")
    visitantes = []
    for v in d["visitantes"]:
        ok = puede(v["panel"]) or (v["panel"] == "whatsapp" and puede("supervisor"))
        visitantes.append({**v, "producto": v["producto"] if ok else "", "texto": v["texto"] if ok else "", "puede": ok})
    paquetes = [{**p, "producto": p["producto"] if ver_despacho else "", "lugar": p["lugar"] if ver_despacho else "",
                 "puede": ver_despacho} for p in d["paquetes"]]
    ver_recepcion = puede("recepcion-mercancia")
    proveedores = [{**p, "proveedor": p["proveedor"] if ver_recepcion else "", "puede": ver_recepcion}
                   for p in d["proveedores"]]
    for p in proveedores:
        p.pop("cerrado_por", None)
    # Quién le habla a quién lo ve todo el equipo (el avioncito); lo que se dijo, solo quien
    # participa: la persona que pregunta y la que responde, o los miembros del grupo.
    yo = int(usuario.get("id") or 0)
    admin = _es_admin(usuario)
    interacciones = []
    for it in d.get("interacciones") or []:
        if it["privado"]:
            ve = yo == it["de"] or yo in it["para"]
        else:
            ve = admin or it.get("todos") or yo == it["de"] or yo in it["para"]
        interacciones.append({**it, "texto": it["texto"] if ve else "", "canal": it.get("canal") if ve else ""})
    try:
        oficina = mapa_app.urgencias_para(usuario)
    except Exception:
        oficina = {"por_etapa": {}}
    return {
        "yo": usuario.get("id"),
        "personas": d["personas"],
        "casas": casas(),
        "visitantes": visitantes[:_MAX_VISITANTES],
        "visitantes_mas": max(0, len(visitantes) - _MAX_VISITANTES),
        "paquetes": paquetes[-_MAX_PAQUETES:],
        "paquetes_mas": max(0, len(paquetes) - _MAX_PAQUETES),
        "proveedores": proveedores,
        "bodega": d["bodega"],
        "oficina": oficina.get("por_etapa") or {},
        "eventos": d["eventos"],
        "interacciones": interacciones,
        "sin_senal": d["sin_senal"] if admin else [],
        "generado": d["generado"],
    }
