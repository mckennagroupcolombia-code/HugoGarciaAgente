# -*- coding: utf-8 -*-
"""Canales internos del panel — la conversación operativa del equipo, dentro de /app.

Hoy la llegada de mercancía, las fotos, las cantidades y los avisos viven en grupos
de WhatsApp: no quedan registrados, no se pueden buscar y no cuentan para el control
de horas. Un canal interno es un grupo del panel: quién escribió (usuario del panel,
no un teléfono), qué adjuntó, quién lo leyó.

**Espejo transitorio con WhatsApp** (decidido el 24-sep-2026: redirigir, no bloquear):
un canal puede enlazarse a un grupo oficial (`wa_jid`).
  * Entrada: lo que llega al grupo (vía el espejo del puente → `wa_chats.
    ingestar_desde_whatsapp`) aparece también en el canal (`espejar_desde_wa`).
  * Salida (si `espejo_salida=1`): lo que se escribe en el panel se reenvía al grupo
    con el nombre del autor. El puente no devuelve el id del mensaje, así que el
    anti-eco se hace por contenido: el `texto_wa` enviado se compara con los
    mensajes `from_me` que vuelven por el espejo en los minutos siguientes.

Cada mensaje del panel se anota con `panel_presencia.registrar_evento_panel`, así
que cuenta en `control_horas` sin tocarlo. Sin LLM.

Tablas en `tickets.db` (usuarios, sesiones y permisos ya viven ahí); se crean con
`CREATE TABLE IF NOT EXISTS` al primer uso.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any

from app.services import tickets_db

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "canales")
_ECO_VENTANA_S = 15 * 60
_lock = threading.Lock()
_listo: dict[str, bool] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS canales_internos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    descripcion   TEXT DEFAULT '',
    tipo          TEXT NOT NULL DEFAULT 'grupo',
    clave         TEXT UNIQUE,
    wa_jid        TEXT,
    espejo_salida INTEGER NOT NULL DEFAULT 0,
    creado_por    INTEGER,
    creado_en     REAL NOT NULL,
    archivado     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_canales_wa_jid ON canales_internos(wa_jid) WHERE wa_jid IS NOT NULL;
CREATE TABLE IF NOT EXISTS canal_miembros (
    canal_id    INTEGER NOT NULL,
    usuario_id  INTEGER NOT NULL,
    agregado_en REAL NOT NULL,
    UNIQUE(canal_id, usuario_id)
);
CREATE TABLE IF NOT EXISTS canal_mensajes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    canal_id         INTEGER NOT NULL,
    usuario_id       INTEGER,
    autor_nombre     TEXT DEFAULT '',
    origen           TEXT NOT NULL DEFAULT 'panel',
    tipo             TEXT NOT NULL DEFAULT 'mensaje',
    wa_id            TEXT,
    autor_wa         TEXT,
    texto            TEXT DEFAULT '',
    texto_wa         TEXT,
    adjunto_archivo  TEXT,
    adjunto_nombre   TEXT,
    adjunto_mime     TEXT,
    wa_media_path    TEXT,
    ref              TEXT,
    creado_en        REAL NOT NULL,
    eliminado        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_canal_mensajes_wa_id ON canal_mensajes(wa_id) WHERE wa_id IS NOT NULL AND wa_id != '';
CREATE INDEX IF NOT EXISTS ix_canal_mensajes_canal ON canal_mensajes(canal_id, id);
-- Solicitudes (tickets) que viven en un grupo: creadas desde el grupo o vinculadas a él.
-- La fecha límite va aquí porque `tickets` no tiene columna de vencimiento.
CREATE TABLE IF NOT EXISTS canal_solicitudes (
    canal_id      INTEGER NOT NULL,
    ticket_id     INTEGER NOT NULL UNIQUE,
    mensaje_id    INTEGER,
    fecha_limite  TEXT,
    tipo          TEXT,
    ref           TEXT,
    vinculado_por INTEGER,
    creado_en     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_canal_solicitudes_canal ON canal_solicitudes(canal_id);
CREATE TABLE IF NOT EXISTS canal_lecturas (
    canal_id          INTEGER NOT NULL,
    usuario_id        INTEGER NOT NULL,
    ultimo_mensaje_id INTEGER NOT NULL DEFAULT 0,
    leido_en          REAL,
    UNIQUE(canal_id, usuario_id)
);
-- Menciones con @ (7-oct-2026): quién fue nombrado en qué mensaje. Queda «pendiente» mientras
-- esa persona no haya leído el grupo hasta ese mensaje (canal_lecturas): no hay que marcarla.
CREATE TABLE IF NOT EXISTS canal_menciones (
    mensaje_id INTEGER NOT NULL,
    canal_id   INTEGER NOT NULL,
    usuario_id INTEGER NOT NULL,
    creado_en  REAL NOT NULL,
    UNIQUE(mensaje_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_canal_menciones_usuario ON canal_menciones(usuario_id, canal_id, mensaje_id);
"""


def _conn() -> sqlite3.Connection:
    ruta = tickets_db.DB_PATH
    c = sqlite3.connect(ruta, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(ruta):
        with _lock:
            if not _listo.get(ruta):
                c.executescript(_SCHEMA)
                # Los incidentes que salen del chat van como solicitudes con esta categoría.
                tickets_db._safe_migrate(lambda: c.execute(
                    "INSERT OR IGNORE INTO categorias (slug, nombre, color, icono) "
                    "VALUES ('incidente', 'Incidente', '#b54a3c', '🛠️')"))
                # Grupos de trabajo: el canal se vincula a un módulo (canales_vinculos.MODULOS).
                tickets_db._safe_migrate(lambda: c.execute("ALTER TABLE canales_internos ADD COLUMN modulo TEXT"))
                for col in ("tipo", "ref"):
                    tickets_db._safe_migrate(lambda col=col: c.execute(f"ALTER TABLE canal_solicitudes ADD COLUMN {col} TEXT"))
                # Responder a un mensaje (6-oct): id del mensaje citado, del mismo canal.
                tickets_db._safe_migrate(lambda: c.execute("ALTER TABLE canal_mensajes ADD COLUMN responde_a INTEGER"))
                c.commit()
                _listo[ruta] = True
    return c


def _es_admin(usuario: dict | None) -> bool:
    try:
        return bool(usuario) and tickets_db.es_admin_efectivo(usuario)
    except Exception:
        return False


def _nivel(usuario: dict | None) -> int:
    return int(((usuario or {}).get("rol") or {}).get("nivel") or 0)


def puede_administrar(usuario: dict | None) -> bool:
    """Crear canales y enlazarlos a grupos: supervisor o administrador."""
    return _es_admin(usuario) or _nivel(usuario) >= 2


def _miembros(c: sqlite3.Connection, canal_id: int) -> list[int]:
    return [int(r[0]) for r in c.execute("SELECT usuario_id FROM canal_miembros WHERE canal_id=?", (canal_id,))]


def _puede_ver(c: sqlite3.Connection, canal: sqlite3.Row, usuario: dict) -> bool:
    """Un canal sin miembros es de todo el equipo; con miembros, solo de ellos (y admin)."""
    if _es_admin(usuario):
        return True
    miembros = _miembros(c, int(canal["id"]))
    return not miembros or int(usuario["id"]) in miembros


def _canal(c: sqlite3.Connection, canal_id: int) -> sqlite3.Row | None:
    return c.execute("SELECT * FROM canales_internos WHERE id=?", (canal_id,)).fetchone()


def _nombre_usuario(usuario: dict) -> str:
    return str(usuario.get("nombre") or usuario.get("username") or "Alguien")


# ── Canales ──────────────────────────────────────────────────────────────────

def crear_canal(
    usuario: dict | None,
    nombre: str,
    *,
    descripcion: str = "",
    miembros: list[int] | None = None,
    wa_jid: str = "",
    espejo_salida: bool = False,
    clave: str | None = None,
    modulo: str = "",
) -> dict:
    nombre = (nombre or "").strip()[:80]
    modulo = _modulo_valido(modulo)
    if not nombre:
        raise ValueError("El canal necesita un nombre")
    wa_jid = (wa_jid or "").strip() or None
    if wa_jid and "@g.us" not in wa_jid:
        raise ValueError("Solo se enlazan grupos de WhatsApp (@g.us)")
    with _conn() as c:
        if wa_jid and c.execute("SELECT 1 FROM canales_internos WHERE wa_jid=?", (wa_jid,)).fetchone():
            raise ValueError("Ese grupo de WhatsApp ya está enlazado a otro canal")
        cur = c.execute(
            "INSERT INTO canales_internos (nombre, descripcion, tipo, clave, wa_jid, espejo_salida, creado_por, creado_en, modulo) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (nombre, (descripcion or "").strip()[:300], "grupo", clave, wa_jid, 1 if espejo_salida else 0,
             (usuario or {}).get("id"), time.time(), modulo),
        )
        cid = int(cur.lastrowid)
        for uid in sorted({int(u) for u in (miembros or [])}):
            c.execute("INSERT OR IGNORE INTO canal_miembros (canal_id, usuario_id, agregado_en) VALUES (?,?,?)",
                      (cid, uid, time.time()))
    return obtener_canal(cid, usuario, forzar=True)  # type: ignore[return-value]


def actualizar_canal(canal_id: int, usuario: dict, **campos: Any) -> dict | None:
    permitidos = {"nombre", "descripcion", "espejo_salida", "archivado", "wa_jid", "modulo"}
    sets, vals = [], []
    for k, v in campos.items():
        if k not in permitidos or v is None:
            continue
        if k in ("espejo_salida", "archivado"):
            v = 1 if v else 0
        if k == "wa_jid":
            v = (str(v).strip() or None)
            if v and "@g.us" not in v:
                raise ValueError("Solo se enlazan grupos de WhatsApp (@g.us)")
        if k == "modulo":
            v = _modulo_valido(v)
        sets.append(f"{k}=?")
        vals.append(v)
    with _conn() as c:
        if sets:
            c.execute(f"UPDATE canales_internos SET {', '.join(sets)} WHERE id=?", (*vals, canal_id))
        if "miembros" in campos and campos["miembros"] is not None:
            c.execute("DELETE FROM canal_miembros WHERE canal_id=?", (canal_id,))
            for uid in sorted({int(u) for u in campos["miembros"]}):
                c.execute("INSERT OR IGNORE INTO canal_miembros (canal_id, usuario_id, agregado_en) VALUES (?,?,?)",
                          (canal_id, uid, time.time()))
    return obtener_canal(canal_id, usuario, forzar=True)


def _modulo_valido(modulo: Any) -> str | None:
    """'' quita el vínculo; un módulo que no existe es un error."""
    from app.services.canales_vinculos import MODULOS

    modulo = str(modulo or "").strip()
    if not modulo:
        return None
    if modulo not in MODULOS:
        raise ValueError("Módulo desconocido")
    return modulo


def canal_por_clave(clave: str) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM canales_internos WHERE clave=?", (clave,)).fetchone()
        return dict(r) if r else None


def asegurar_canal(clave: str, nombre: str, descripcion: str = "") -> int:
    """Canal de sistema (p. ej. «inventario» para recepción de mercancía): lo crea si falta."""
    existente = canal_por_clave(clave)
    if existente:
        return int(existente["id"])
    with _conn() as c:
        cur = c.execute(
            "INSERT OR IGNORE INTO canales_internos (nombre, descripcion, tipo, clave, creado_en) VALUES (?,?,?,?,?)",
            (nombre, descripcion, "grupo", clave, time.time()),
        )
        if cur.lastrowid:
            return int(cur.lastrowid)
    return int(canal_por_clave(clave)["id"])  # type: ignore[index]


def _fila_canal(c: sqlite3.Connection, r: sqlite3.Row, usuario_id: int | None) -> dict:
    ultimo = c.execute(
        "SELECT id, texto, autor_nombre, creado_en, adjunto_nombre FROM canal_mensajes "
        "WHERE canal_id=? AND eliminado=0 ORDER BY id DESC LIMIT 1",
        (r["id"],),
    ).fetchone()
    leido = 0
    if usuario_id:
        lr = c.execute("SELECT ultimo_mensaje_id FROM canal_lecturas WHERE canal_id=? AND usuario_id=?",
                       (r["id"], usuario_id)).fetchone()
        leido = int(lr[0]) if lr else 0
    no_leidos = c.execute(
        "SELECT COUNT(*) FROM canal_mensajes WHERE canal_id=? AND eliminado=0 AND id>? "
        "AND (usuario_id IS NULL OR usuario_id != ?)",
        (r["id"], leido, usuario_id or -1),
    ).fetchone()[0]
    menciones = 0
    if usuario_id:
        menciones = c.execute(
            "SELECT COUNT(*) FROM canal_menciones m JOIN canal_mensajes x ON x.id = m.mensaje_id "
            "WHERE m.canal_id=? AND m.usuario_id=? AND m.mensaje_id>? AND x.eliminado=0",
            (r["id"], usuario_id, leido),
        ).fetchone()[0]
    nombre_wa = ""
    if r["wa_jid"]:
        try:
            from app.services.wa_chats import nombre_grupo

            nombre_wa = nombre_grupo(r["wa_jid"])
        except Exception:
            nombre_wa = ""
    return {
        "id": int(r["id"]),
        "nombre": r["nombre"],
        "descripcion": r["descripcion"] or "",
        "clave": r["clave"],
        "modulo": r["modulo"] if "modulo" in r.keys() else None,
        "wa_jid": r["wa_jid"] or "",
        "wa_nombre": nombre_wa,
        "espejo_salida": bool(r["espejo_salida"]),
        "archivado": bool(r["archivado"]),
        "miembros": _miembros(c, int(r["id"])),
        "no_leidos": int(no_leidos),
        # Menciones a esta persona que todavía no ha leído: el grupo le «toca» (bandeja).
        "menciones": int(menciones),
        "ultimo": dict(ultimo) if ultimo else None,
    }


def obtener_canal(canal_id: int, usuario: dict | None, *, forzar: bool = False) -> dict | None:
    with _conn() as c:
        r = _canal(c, canal_id)
        if not r or (not forzar and not _puede_ver(c, r, usuario or {})):
            return None
        return _fila_canal(c, r, (usuario or {}).get("id"))


def listar_canales(usuario: dict, *, incluir_archivados: bool = False) -> list[dict]:
    with _conn() as c:
        filas = c.execute(
            "SELECT * FROM canales_internos" + ("" if incluir_archivados else " WHERE archivado=0")
        ).fetchall()
        out = [_fila_canal(c, r, usuario.get("id")) for r in filas if _puede_ver(c, r, usuario)]
    out.sort(key=lambda x: -((x["ultimo"] or {}).get("creado_en") or 0))
    return out


def no_leidos_total(usuario: dict) -> int:
    return sum(c["no_leidos"] for c in listar_canales(usuario))


def solicitudes_para_mi(usuario_id: int, limite: int = 8) -> list[dict]:
    """Solicitudes abiertas asignadas a esta persona que pidió OTRA (las más nuevas).

    La campana las consulta cada pocos segundos: el panel compara los ids con los que ya
    vio y suena con el sonido elegido para quien la pidió. Solo lectura, sin LLM."""
    with _conn() as c:
        filas = c.execute(
            "SELECT t.id, t.numero, t.titulo, t.creado_por, COALESCE(u.nombre, '') AS creado_por_nombre "
            "FROM tickets t LEFT JOIN usuarios u ON u.id = t.creado_por "
            "WHERE t.asignado_a=? AND t.creado_por != ? AND t.estado IN ('pendiente','en_proceso') "
            "ORDER BY t.id DESC LIMIT ?",
            (int(usuario_id), int(usuario_id), max(1, min(int(limite), 20))),
        ).fetchall()
    return [dict(f) for f in filas]


# ── Mensajes ─────────────────────────────────────────────────────────────────

def _fila_mensaje(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["ref"] = json.loads(d["ref"]) if d.get("ref") else None
    d.pop("texto_wa", None)
    d.setdefault("responde_a", None)
    d["cita"] = None
    d["menciones"] = []
    return d


def _con_menciones(c: sqlite3.Connection, mensajes: list[dict]) -> list[dict]:
    """Agrega `menciones` ([{id, nombre}]) a cada mensaje: el panel resalta los @ y el tuyo."""
    ids = [int(m["id"]) for m in mensajes]
    if not ids:
        return mensajes
    filas = c.execute(
        f"SELECT m.mensaje_id, m.usuario_id, COALESCE(u.nombre, u.username, '') AS nombre, COALESCE(u.username, '') AS username "
        f"FROM canal_menciones m LEFT JOIN usuarios u ON u.id = m.usuario_id "
        f"WHERE m.mensaje_id IN ({','.join('?' * len(ids))})", tuple(ids)
    ).fetchall()
    por_mensaje: dict[int, list[dict]] = {}
    for f in filas:
        por_mensaje.setdefault(int(f["mensaje_id"]), []).append(
            {"id": int(f["usuario_id"]), "nombre": f["nombre"] or "", "username": f["username"] or ""})
    for m in mensajes:
        m["menciones"] = por_mensaje.get(int(m["id"]), [])
    return mensajes


# ── Menciones con @ ──────────────────────────────────────────────────────────

def _normalizar(t: str) -> str:
    """Minúsculas y sin tildes: «@sebastian» encuentra a «Sebastián García»."""
    import unicodedata

    t = unicodedata.normalize("NFKD", t or "")
    return "".join(ch for ch in t if not unicodedata.combining(ch)).lower()


_TODOS = ("todos", "todas", "equipo")


def _candidatos(c: sqlite3.Connection, canal_id: int) -> list[sqlite3.Row]:
    """Quién puede ser nombrado: los miembros del grupo o, si no tiene, todo el equipo activo.
    Sin cuentas técnicas o de prueba (admin, Hugo IA, «prueba»…): no son personas a quien avisar."""
    miembros = _miembros(c, canal_id)
    filas = c.execute("SELECT id, nombre, username FROM usuarios WHERE COALESCE(activo,1)=1").fetchall()
    tecnicas = set(tickets_db.USUARIOS_TECNICOS_O_PRUEBA)
    return [f for f in filas if (f["username"] or "") not in tecnicas and (not miembros or int(f["id"]) in miembros)]


def detectar_menciones(c: sqlite3.Connection, canal_id: int, texto: str, autor_id: int | None) -> list[int]:
    """Usuarios nombrados con @ en `texto` (nunca el autor).

    Vale «@Nombre Apellido», «@Nombre» (si nadie más del grupo se llama igual), «@usuario» y
    «@todos». De WhatsApp llegan como «@573001234567»: se buscan por teléfono (usuarios.telefono).
    """
    if "@" not in (texto or ""):
        return []
    import re

    candidatos = _candidatos(c, canal_id)
    nombres = [_normalizar(str(f["nombre"] or "")).strip() for f in candidatos]
    primeros = [n.split()[0] if n.split() else "" for n in nombres]
    claves: list[tuple[str, int]] = []
    for f, completo, primero in zip(candidatos, nombres, primeros):
        uid = int(f["id"])
        if completo:
            claves.append((completo, uid))
        if primero and primeros.count(primero) == 1:
            claves.append((primero, uid))
        usuario = _normalizar(str(f["username"] or "")).strip().lstrip("@")  # hay usernames como «@cynthia»
        if usuario:
            claves.append((usuario, uid))
    claves.sort(key=lambda k: -len(k[0]))  # la más larga primero: «ana maria» antes que «ana»

    norm = _normalizar(texto)
    nombrados: set[int] = set()
    for m in re.finditer(r"(?<![\w.])@", norm):
        resto = norm[m.end():]
        if any(re.match(rf"{t}\b", resto) for t in _TODOS):
            nombrados.update(int(f["id"]) for f in candidatos)
            continue
        tel = re.match(r"\d{10,15}", resto)
        if tel:
            try:
                from app.services.pagos_clientes import usuario_por_telefono

                uid, _ = usuario_por_telefono(tel.group(0))
                if uid:
                    nombrados.add(int(uid))
            except Exception:
                pass
            continue
        for clave, uid in claves:
            if resto.startswith(clave) and not (len(resto) > len(clave) and (resto[len(clave)].isalnum() or resto[len(clave)] == "_")):
                nombrados.add(uid)
                break
    nombrados.discard(int(autor_id or -1))
    return sorted(nombrados)


def _guardar_menciones(c: sqlite3.Connection, canal_id: int, mensaje_id: int, uids: list[int]) -> None:
    for uid in uids:
        c.execute("INSERT OR IGNORE INTO canal_menciones (mensaje_id, canal_id, usuario_id, creado_en) VALUES (?,?,?,?)",
                  (mensaje_id, canal_id, uid, time.time()))


def mencionables(canal_id: int, usuario: dict) -> list[dict] | None:
    """Personas que se pueden nombrar en el grupo (sin quien escribe). None si no lo ve."""
    with _conn() as c:
        r = _canal(c, canal_id)
        if not r or not _puede_ver(c, r, usuario):
            return None
        yo = int(usuario.get("id") or -1)
        return [{"id": int(f["id"]), "nombre": f["nombre"] or f["username"] or "", "username": f["username"] or ""}
                for f in _candidatos(c, canal_id) if int(f["id"]) != yo]


def menciones_pendientes(usuario: dict) -> int:
    """Total de menciones sin leer de esta persona en los grupos que ve."""
    return sum(c.get("menciones", 0) for c in listar_canales(usuario))


def _con_citas(c: sqlite3.Connection, mensajes: list[dict]) -> list[dict]:
    """Agrega `cita` (autor, texto corto, adjunto) a los mensajes que responden a otro."""
    ids = {int(m["responde_a"]) for m in mensajes if m.get("responde_a")}
    if not ids:
        return mensajes
    filas = c.execute(
        f"SELECT id, autor_nombre, texto, adjunto_nombre, adjunto_mime, eliminado FROM canal_mensajes "
        f"WHERE id IN ({','.join('?' * len(ids))})", tuple(ids)
    ).fetchall()
    citas = {
        int(f["id"]): {
            "id": int(f["id"]),
            "autor_nombre": f["autor_nombre"] or "",
            "texto": "" if f["eliminado"] else (f["texto"] or "")[:200],
            "adjunto_nombre": None if f["eliminado"] else f["adjunto_nombre"],
            "adjunto_mime": None if f["eliminado"] else f["adjunto_mime"],
            "eliminado": bool(f["eliminado"]),
        }
        for f in filas
    }
    for m in mensajes:
        if m.get("responde_a"):
            m["cita"] = citas.get(int(m["responde_a"]))
    return mensajes


def listar_mensajes(canal_id: int, usuario: dict, *, despues_de: int = 0, antes_de: int = 0, limite: int = 80) -> list[dict] | None:
    limite = max(1, min(int(limite or 80), 200))
    with _conn() as c:
        r = _canal(c, canal_id)
        if not r or not _puede_ver(c, r, usuario):
            return None
        if despues_de:
            filas = c.execute(
                "SELECT * FROM canal_mensajes WHERE canal_id=? AND eliminado=0 AND id>? ORDER BY id ASC LIMIT ?",
                (canal_id, despues_de, limite),
            ).fetchall()
        else:
            filas = c.execute(
                "SELECT * FROM canal_mensajes WHERE canal_id=? AND eliminado=0"
                + (" AND id<?" if antes_de else "")
                + " ORDER BY id DESC LIMIT ?",
                (canal_id, antes_de, limite) if antes_de else (canal_id, limite),
            ).fetchall()[::-1]
        return _con_menciones(c, _con_citas(c, [_fila_mensaje(f) for f in filas]))


def enviar_mensaje(
    canal_id: int,
    usuario: dict | None,
    texto: str,
    *,
    adjunto: dict | None = None,
    tipo: str = "mensaje",
    ref: dict | None = None,
    reenviar_wa: bool = True,
    responde_a: int | None = None,
) -> dict:
    """Mensaje del panel (o de sistema si `usuario` es None). Devuelve el mensaje guardado."""
    texto = (texto or "").strip()[:4000]
    if not texto and not adjunto and not ref:
        raise ValueError("Mensaje vacío")
    with _conn() as c:
        canal = _canal(c, canal_id)
        if not canal or canal["archivado"]:
            raise LookupError("Canal no encontrado")
        if usuario and not _puede_ver(c, canal, usuario):
            raise PermissionError("No eres miembro de este canal")
        autor = _nombre_usuario(usuario) if usuario else "Sistema"
        citado = None
        if responde_a:
            citado = c.execute(
                "SELECT id, autor_nombre, texto FROM canal_mensajes WHERE id=? AND canal_id=? AND eliminado=0",
                (int(responde_a), canal_id),
            ).fetchone()
            if not citado:
                raise ValueError("El mensaje al que respondes ya no está en este grupo")
        texto_wa = None
        if reenviar_wa and canal["wa_jid"] and canal["espejo_salida"] and texto:
            texto_wa = f"*{autor}* — panel:\n{texto}"
            if citado:
                cita_wa = (citado["texto"] or "(adjunto)").replace("\n", " ")[:80]
                texto_wa = f"*{autor}* — panel, respondiendo a {citado['autor_nombre']}:\n> {cita_wa}\n{texto}"
        cur = c.execute(
            "INSERT INTO canal_mensajes (canal_id, usuario_id, autor_nombre, origen, tipo, texto, texto_wa, "
            "adjunto_archivo, adjunto_nombre, adjunto_mime, ref, creado_en, responde_a) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (canal_id, (usuario or {}).get("id"), autor, "panel", tipo, texto, texto_wa,
             (adjunto or {}).get("archivo"), (adjunto or {}).get("nombre"), (adjunto or {}).get("mime"),
             json.dumps(ref, ensure_ascii=False) if ref else None, time.time(),
             int(citado["id"]) if citado else None),
        )
        mid = int(cur.lastrowid)
        if usuario:
            _marcar_leido(c, canal_id, int(usuario["id"]), mid)
        nombrados = detectar_menciones(c, canal_id, texto, (usuario or {}).get("id")) if tipo == "mensaje" else []
        _guardar_menciones(c, canal_id, mid, nombrados)
        fila = _con_menciones(c, _con_citas(c, [_fila_mensaje(c.execute("SELECT * FROM canal_mensajes WHERE id=?", (mid,)).fetchone())]))[0]
        jid = canal["wa_jid"]
    if usuario:
        try:
            from app.services.panel_presencia import registrar_evento_panel

            registrar_evento_panel(int(usuario["id"]), "canal_mensaje", panel="mensajes",
                                   detalle={"canal_id": canal_id, "texto": texto[:120]})
        except Exception:
            pass
    if texto_wa and jid:
        _reenviar_a_wa(jid, texto_wa)
    if usuario and adjunto and canal["modulo"] == "documentos_tecnicos":
        _encolar_coa(canal_id, mid, os.path.join(UPLOADS_DIR, str(adjunto.get("archivo") or "")), adjunto.get("mime"))
    es_voz = str((adjunto or {}).get("mime") or "").startswith("audio/")
    _avisar(canal_id, (usuario or {}).get("id"), autor, texto or ("🎤 Nota de voz" if es_voz else ""), bool(adjunto),
            mencionados=nombrados)
    return fila


def _avisar(canal_id: int, autor_id: int | None, autor: str, texto: str, adjunto: bool,
            mencionados: list[int] | None = None) -> None:
    """Notificación a los demás del grupo (canales_avisos: push con la app cerrada).
    A quien nombraron con @ le llega siempre, sin la ventana anti-spam del grupo."""
    try:
        from app.services import canales_avisos

        nombre = (obtener_canal(canal_id, None, forzar=True) or {}).get("nombre") or "Grupo"
        canales_avisos.avisar_mensaje(canal_id, nombre, autor_id, autor, texto, adjunto, mencionados=mencionados or [])
    except Exception as e:
        print(f"[canales_internos] aviso falló: {e}")


def _reenviar_a_wa(jid: str, texto_wa: str) -> None:
    def _run():
        try:
            from app.utils import enviar_whatsapp_reporte

            enviar_whatsapp_reporte(texto_wa, numero_destino=jid)
        except Exception as e:
            print(f"[canales_internos] reenvío a WhatsApp falló: {e}")

    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    threading.Thread(target=_run, name="canal-a-wa", daemon=True).start()


def _marcar_leido(c: sqlite3.Connection, canal_id: int, usuario_id: int, hasta: int) -> None:
    c.execute(
        "INSERT INTO canal_lecturas (canal_id, usuario_id, ultimo_mensaje_id, leido_en) VALUES (?,?,?,?) "
        "ON CONFLICT(canal_id, usuario_id) DO UPDATE SET "
        "ultimo_mensaje_id=MAX(ultimo_mensaje_id, excluded.ultimo_mensaje_id), leido_en=excluded.leido_en",
        (canal_id, usuario_id, hasta, time.time()),
    )


def marcar_leido(canal_id: int, usuario: dict) -> None:
    with _conn() as c:
        r = c.execute("SELECT MAX(id) FROM canal_mensajes WHERE canal_id=?", (canal_id,)).fetchone()
        _marcar_leido(c, canal_id, int(usuario["id"]), int(r[0] or 0))


def eliminar_mensaje(mensaje_id: int, usuario: dict) -> bool:
    """Solo el autor (o admin) y solo mensajes del panel: lo que vino de WhatsApp ya ocurrió allá."""
    with _conn() as c:
        r = c.execute("SELECT usuario_id, origen FROM canal_mensajes WHERE id=?", (mensaje_id,)).fetchone()
        if not r or r["origen"] != "panel":
            return False
        if not _es_admin(usuario) and int(r["usuario_id"] or 0) != int(usuario["id"]):
            return False
        c.execute("UPDATE canal_mensajes SET eliminado=1 WHERE id=?", (mensaje_id,))
    return True


# ── Solicitudes del grupo ────────────────────────────────────────────────────

_ABIERTAS = ("pendiente", "en_proceso", "esperando_aprobacion")


def _fecha_valida(fecha: Any) -> str | None:
    import re

    f = str(fecha or "").strip()[:10]
    return f if re.fullmatch(r"\d{4}-\d{2}-\d{2}", f) else None


def vincular_solicitud(
    canal_id: int, usuario: dict, ticket_id: int, *, mensaje_id: int | None = None, fecha_limite: str = "",
    tipo: str = "", ref: dict | None = None,
) -> dict:
    """Deja la solicitud dentro del grupo y lo avisa en el chat. Una solicitud vive en un solo grupo.
    `tipo` (canales_vinculos.TIPOS_SOLICITUD) la clasifica; `ref` es el elemento del módulo
    que se pide revisar (p. ej. la solicitud de pago #61)."""
    from app.services.canales_vinculos import TIPOS_SOLICITUD, normalizar_ref

    tipo = tipo if tipo in TIPOS_SOLICITUD else None
    ref = normalizar_ref(ref)
    with _conn() as c:
        canal = _canal(c, canal_id)
        if not canal or canal["archivado"] or not _puede_ver(c, canal, usuario):
            raise LookupError("Canal no encontrado")
        t = c.execute(
            "SELECT t.id, t.numero, t.titulo, u.nombre AS asignado FROM tickets t "
            "LEFT JOIN usuarios u ON u.id = t.asignado_a WHERE t.id=?", (int(ticket_id),)
        ).fetchone()
        if not t:
            raise LookupError("Solicitud no encontrada")
        c.execute(
            "INSERT INTO canal_solicitudes (canal_id, ticket_id, mensaje_id, fecha_limite, tipo, ref, vinculado_por, creado_en) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ticket_id) DO UPDATE SET canal_id=excluded.canal_id, "
            "mensaje_id=COALESCE(excluded.mensaje_id, mensaje_id), fecha_limite=excluded.fecha_limite, "
            "tipo=COALESCE(excluded.tipo, tipo), ref=COALESCE(excluded.ref, ref)",
            (canal_id, int(ticket_id), mensaje_id, _fecha_valida(fecha_limite), tipo,
             json.dumps(ref, ensure_ascii=False) if ref else None, usuario.get("id"), time.time()),
        )
    para = f" a {t['asignado']}" if t["asignado"] else ""
    vence = _fecha_valida(fecha_limite)
    clase = f" · {TIPOS_SOLICITUD[tipo]['nombre']}" if tipo else ""
    enviar_mensaje(
        canal_id, None,
        f"📋 {_nombre_usuario(usuario)} solicitó{para}: «{t['titulo']}»{clase}" + (f" · vence {vence}" if vence else ""),
        tipo="sistema", reenviar_wa=False,
        ref={"ticket_id": int(t["id"]), "titulo": f"{t['numero']} · {t['titulo']}", "detalle": t["asignado"] or ""},
    )
    return {"ok": True, "ticket_id": int(t["id"])}


def listar_solicitudes(canal_id: int, usuario: dict) -> list[dict] | None:
    """Solicitudes abiertas del grupo: las vinculadas y, si el módulo tiene categoría
    (Compras en el exterior → importaciones), las de esa categoría."""
    from app.services.canales_vinculos import MODULOS

    with _conn() as c:
        canal = _canal(c, canal_id)
        if not canal or not _puede_ver(c, canal, usuario):
            return None
        modulo = canal["modulo"] if "modulo" in canal.keys() else None
        categoria = (MODULOS.get(modulo or "") or {}).get("categoria")
        marcas = ",".join("?" * len(_ABIERTAS))
        sql = (
            "SELECT t.id, t.numero, t.titulo, t.estado, t.prioridad, t.asignado_a, u.nombre AS asignado_nombre, "
            "cs.fecha_limite, cs.mensaje_id, cs.tipo, cs.ref, CASE WHEN cs.canal_id IS NULL THEN 'modulo' ELSE 'grupo' END AS origen, "
            "t.actualizado_en FROM tickets t "
            "LEFT JOIN canal_solicitudes cs ON cs.ticket_id = t.id "
            "LEFT JOIN usuarios u ON u.id = t.asignado_a "
            f"WHERE t.estado IN ({marcas}) AND (cs.canal_id = ?"
        )
        params: list[Any] = [*_ABIERTAS, canal_id]
        if categoria:
            sql += " OR (cs.canal_id IS NULL AND t.categoria = ?)"
            params.append(categoria)
        sql += ") ORDER BY (cs.fecha_limite IS NULL), cs.fecha_limite, t.actualizado_en DESC LIMIT 40"
        try:
            filas = c.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            return []
    out = []
    for f in filas:
        d = dict(f)
        try:
            d["ref"] = json.loads(d["ref"]) if d.get("ref") else None
        except ValueError:
            d["ref"] = None
        out.append(d)
    return out


# ── Espejo de WhatsApp (entrada) ─────────────────────────────────────────────

def espejar_desde_wa(
    *, jid: str, wa_id: str, texto: str, from_me: bool, autor: str, ts: float,
    media_path: str = "", media_mime: str = "",
) -> bool:
    """Un mensaje nuevo de un grupo enlazado aparece en su canal. True si se insertó."""
    with _conn() as c:
        canal = c.execute("SELECT id, modulo FROM canales_internos WHERE wa_jid=? AND archivado=0", (jid,)).fetchone()
        if not canal:
            return False
        cid = int(canal["id"])
        if wa_id and c.execute("SELECT 1 FROM canal_mensajes WHERE wa_id=?", (wa_id,)).fetchone():
            return False
        if from_me:
            # Anti-eco: ¿es el reenvío de algo escrito en el panel?
            eco = c.execute(
                "SELECT id FROM canal_mensajes WHERE canal_id=? AND origen='panel' AND texto_wa IS NOT NULL "
                "AND (wa_id IS NULL OR wa_id='') AND creado_en>=? AND TRIM(texto_wa)=TRIM(?) ORDER BY id DESC LIMIT 1",
                (cid, time.time() - _ECO_VENTANA_S, texto or ""),
            ).fetchone()
            if eco:
                if wa_id:
                    c.execute("UPDATE canal_mensajes SET wa_id=? WHERE id=?", (wa_id, eco["id"]))
                return False
        uid, nombre = None, ""
        if not from_me:
            try:
                from app.services.pagos_clientes import usuario_por_telefono

                uid, nombre = usuario_por_telefono(autor)
            except Exception:
                uid, nombre = None, ""
        autor_nombre = nombre or ("Teléfono de McKenna" if from_me else (f"…{autor[-4:]}" if autor else "WhatsApp"))
        cur = c.execute(
            "INSERT OR IGNORE INTO canal_mensajes (canal_id, usuario_id, autor_nombre, origen, tipo, wa_id, autor_wa, "
            "texto, wa_media_path, adjunto_mime, creado_en) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (cid, uid, autor_nombre, "wa", "mensaje", wa_id or None, autor or None,
             "" if texto == "[adjunto]" and media_path else texto, media_path or None, media_mime or None,
             float(ts or time.time())),
        )
        nombrados: list[int] = []
        if cur.lastrowid and texto and texto != "[adjunto]":
            nombrados = detectar_menciones(c, cid, texto, uid)
            _guardar_menciones(c, cid, int(cur.lastrowid), nombrados)
    _avisar(cid, uid, autor_nombre, "" if texto == "[adjunto]" else texto, bool(media_path), mencionados=nombrados)
    if cur.lastrowid and media_path and canal["modulo"] == "documentos_tecnicos":
        try:
            from app.services.wa_chats import resolver_media_absoluto

            _encolar_coa(cid, int(cur.lastrowid), resolver_media_absoluto(media_path) or "", media_mime)
        except Exception as e:
            print(f"[canales_internos] COA automático: {e}")
    return True


def _encolar_coa(canal_id: int, mensaje_id: int, ruta: str, mime: str | None) -> None:
    """Foto en el grupo de documentos técnicos → lectura del COA y documento al día (coa_canal_auto)."""
    try:
        from app.services import coa_canal_auto

        if coa_canal_auto.es_imagen(mime) and ruta and os.path.isfile(ruta):
            coa_canal_auto.encolar(canal_id, mensaje_id, ruta, str(mime))
    except Exception as e:
        print(f"[canales_internos] COA automático: {e}")


def media_wa_de_mensaje(mensaje_id: int, usuario: dict) -> str | None:
    """Ruta absoluta del adjunto que llegó por WhatsApp, si el usuario ve ese canal."""
    with _conn() as c:
        r = c.execute("SELECT canal_id, wa_media_path FROM canal_mensajes WHERE id=?", (mensaje_id,)).fetchone()
        if not r or not r["wa_media_path"]:
            return None
        canal = _canal(c, int(r["canal_id"]))
        if not canal or not _puede_ver(c, canal, usuario):
            return None
        rel = r["wa_media_path"]
    try:
        from app.services.wa_chats import resolver_media_absoluto

        return resolver_media_absoluto(rel)
    except Exception:
        return None


def grupos_oficiales() -> list[dict]:
    """Grupos del inventario oficial, para ofrecer el enlace al crear un canal."""
    ruta = os.path.join(os.path.dirname(__file__), "..", "data", "grupos_whatsapp_oficiales.json")
    try:
        with open(ruta, encoding="utf-8") as fh:
            inv = json.load(fh)
    except Exception:
        return []
    with _conn() as c:
        usados = {r[0] for r in c.execute("SELECT wa_jid FROM canales_internos WHERE wa_jid IS NOT NULL")}
    out = []
    for g in (inv.get("grupos") or []) + [inv.get("pedidos_web_exclusivo") or {}]:
        if g.get("jid"):
            out.append({"jid": g["jid"], "nombre": g.get("nombre") or g["jid"], "enlazado": g["jid"] in usados})
    return out
