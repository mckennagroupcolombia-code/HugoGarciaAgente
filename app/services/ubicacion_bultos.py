# -*- coding: utf-8 -*-
"""Ubicación de bultos — dónde quedó cada caja o bulto de materia prima.

El problema (27-sep-2026): a un operario le piden «empacar quinua roja 500 g» y no
encuentra el bulto. Quien lo recibió colgó una foto en el grupo de WhatsApp, pero esa
foto no queda asociada a ningún producto ni a ningún lugar: no se puede buscar, y
dentro de la solicitud no aparece.

Aquí cada bulto es un registro:

    foto  +  producto (SKU de inventario de Alegra)  +  sede y ubicación  +  cantidad

Tres entradas:
  1. «Registrar bulto» con la cámara del celular (la vía principal).
  2. Bandeja «Por identificar»: fotos que YA llegaron — de los grupos de WhatsApp
     espejados a un canal interno (canal_mensajes) y de las recepciones de mercancía —
     y que nadie ha asociado todavía. Se les pone producto y lugar, o se descartan.
  3. Desde una recepción: cada renglón contado puede ubicarse.

Y una salida que es la razón de ser del módulo: `en_texto()` encuentra los bultos del
producto que menciona una solicitud («Empacar PSYLLUM 500GR» → Psyllium Husk, Sede Sur,
estante B2) y la solicitud muestra la foto y el lugar.

Mover un bulto o marcarlo agotado deja rastro (`movimientos`). Al ubicarse avisa en el
canal interno «Inventario» (que llega al grupo si el canal tiene ida y vuelta).
No escribe inventario ni contabilidad; no llama a Alegra (usa la copia local). Sin LLM.

Base propia: app/data/bultos.db (gitignored). Fotos: fotos_bultos/ (gitignored),
copiadas y reducidas: el bulto conserva su foto aunque se borre la de origen.
"""
from __future__ import annotations

import difflib
import io
import os
import re
import sqlite3
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
DB_PATH = str(REPO / "app" / "data" / "bultos.db")
FOTOS_DIR = REPO / "fotos_bultos"
CANAL_CLAVE = "inventario"
SEDES = ("Principal", "Sede Sur")
BANDEJA_DIAS = 45
_LADO_MAX_FOTO = 1400
_lock = threading.Lock()
_listo: dict[str, bool] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bultos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sku                 TEXT NOT NULL,
    nombre              TEXT NOT NULL,
    cantidad            REAL,
    unidad              TEXT DEFAULT '',
    lote                TEXT DEFAULT '',
    sede                TEXT NOT NULL DEFAULT 'Principal',
    ubicacion           TEXT NOT NULL DEFAULT '',
    estado              TEXT NOT NULL DEFAULT 'en_bodega',
    nota                TEXT DEFAULT '',
    recepcion_id        INTEGER,
    creado_por          INTEGER,
    creado_por_nombre   TEXT DEFAULT '',
    creado_en           REAL NOT NULL,
    actualizado_en      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bultos_sku ON bultos(sku, estado);
CREATE TABLE IF NOT EXISTS bulto_fotos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bulto_id    INTEGER NOT NULL,
    archivo     TEXT NOT NULL,
    origen      TEXT NOT NULL DEFAULT 'panel',
    origen_ref  TEXT DEFAULT '',
    subida_en   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bulto_fotos ON bulto_fotos(bulto_id);
CREATE TABLE IF NOT EXISTS bulto_movimientos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bulto_id    INTEGER NOT NULL,
    accion      TEXT NOT NULL,
    detalle     TEXT DEFAULT '',
    por_nombre  TEXT DEFAULT '',
    en          REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_bulto_mov ON bulto_movimientos(bulto_id);
CREATE TABLE IF NOT EXISTS fotos_revisadas (
    origen      TEXT NOT NULL,
    origen_ref  TEXT NOT NULL,
    decision    TEXT NOT NULL,
    bulto_id    INTEGER,
    por_nombre  TEXT DEFAULT '',
    en          REAL NOT NULL,
    PRIMARY KEY (origen, origen_ref)
);
"""

ESTADOS = ("en_bodega", "agotado")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    if not _listo.get(DB_PATH):
        with _lock:
            if not _listo.get(DB_PATH):
                c.executescript(_SCHEMA)
                c.commit()
                _listo[DB_PATH] = True
    return c


def _nombre(usuario: dict | None) -> str:
    u = usuario or {}
    return str(u.get("nombre") or u.get("username") or "")


def _actividad(usuario: dict | None, tipo: str, detalle: dict) -> None:
    if not usuario or not usuario.get("id"):
        return
    try:
        from app.services.panel_presencia import registrar_evento_panel

        registrar_evento_panel(int(usuario["id"]), tipo, panel="recepcion-mercancia", detalle=detalle)
    except Exception:
        pass


def _avisar_canal(texto: str, ref: dict) -> None:
    try:
        from app.services import canales_internos as CI

        cid = CI.asegurar_canal(CANAL_CLAVE, "Inventario", "Llegadas de mercancía, conteos y novedades de bodega")
        CI.enviar_mensaje(cid, None, texto, tipo="sistema", ref=ref)
    except Exception as e:
        print(f"[bultos] aviso al canal: {e}")


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def codigo(bid: int) -> str:
    return f"B-{int(bid):04d}"


# ── Texto: normalizar y emparejar ────────────────────────────────────────────

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def _tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", _norm(s))


# Palabras que no identifican un producto por sí solas (unidades, presentación, verbos
# de las solicitudes, colores y formas). Cuentan como segunda coincidencia, nunca solas.
_VACIAS = {
    "de", "del", "la", "el", "los", "las", "y", "en", "con", "por", "para", "un", "una",
    "g", "gr", "gramos", "kg", "kilo", "kilos", "ml", "l", "lt", "litro", "litros", "und", "un",
    "empacar", "empaque", "envasar", "buscar", "traer", "llevar", "sacar", "bolsa", "bolsas",
    "caja", "cajas", "bulto", "bultos", "urgente", "pedido", "favor",
}
_GENERICAS = {
    "aceite", "extracto", "polvo", "natural", "grano", "granos", "semilla", "semillas", "blanca",
    "blanco", "negra", "negro", "roja", "rojo", "amarilla", "amarillo", "verde", "puro", "pura",
    "organico", "organica", "cosmetico", "cosmetica", "grado", "alimentario", "liquido", "solido",
    "escamas", "hojuelas", "harina", "acido", "sal", "sales", "entero", "entera", "molido", "molida",
}


def _significativas(nombre: str) -> list[str]:
    out = []
    for t in _tokens(nombre):
        if t in _VACIAS or len(t) < 3 or re.fullmatch(r"\d+[a-z]{0,3}", t):
            continue
        out.append(t)
    return out


def _coincide(tok: str, texto_toks: set[str]) -> bool:
    if tok in texto_toks:
        return True
    if len(tok) >= 5:
        for t in texto_toks:
            if len(t) >= 5 and (t.startswith(tok[:5]) and abs(len(t) - len(tok)) <= 2):
                return True
            if len(t) >= 5 and difflib.SequenceMatcher(None, tok, t).ratio() >= 0.8:
                return True
    return False


def puntaje_nombre(nombre: str, sku: str, texto: str) -> int:
    """0 si el texto no habla de ese producto; >0 cuanto más seguro.

    Regla: el SKU escrito tal cual gana; si no, hace falta al menos una palabra propia
    del producto (no genérica) y, si esa palabra es corta (<6), una segunda.
    «quinua roja» ↔ QUINUA ROJA GRANO; «PSYLLUM» ↔ PSYLLIUM HUSK; «coco rallado» no
    se confunde con ACEITE DE COCO."""
    tt = set(_tokens(texto))
    if not tt:
        return 0
    if sku and _norm(sku) in tt:
        return 100
    sig = _significativas(nombre)
    if not sig:
        return 0
    propias = [t for t in sig if t not in _GENERICAS and _coincide(t, tt)]
    todas = [t for t in sig if _coincide(t, tt)]
    if not propias:
        return 0
    if len(todas) >= 2 or any(len(t) >= 6 for t in propias):
        return 10 * len(todas) + sum(len(t) for t in propias)
    return 0


# ── Catálogo (copia local de Alegra, solo productos de inventario) ───────────

def buscar_productos(q: str, limite: int = 20) -> list[dict]:
    from app.services import insumos as I

    items, _ = I._catalogo()
    toks = [t for t in _tokens(q) if t]
    out = []
    for ref, it in items.items():
        if not I._es_insumo(it) or str(it.get("status") or "active") != "active":
            continue
        if I.equivalente_de(ref):
            continue  # SKU reemplazado: se registra al canónico
        hay = _norm(f"{ref} {it.get('name') or ''}")
        if toks and not all(t in hay for t in toks):
            continue
        out.append({"sku": ref, "nombre": it.get("name") or ref, "unidad": it.get("unit") or ""})
    out.sort(key=lambda x: (len(x["nombre"]), x["nombre"]))
    return out[:limite]


def _producto(sku: str) -> dict:
    from app.services import insumos as I

    s = I.canonico(str(sku or "").strip())
    it = I.producto(s)
    if not it:
        raise ValueError(f"{sku or '(vacío)'} no es un producto de inventario del catálogo")
    return {"sku": it["reference"], "nombre": it.get("name") or it["reference"], "unidad": it.get("unit") or ""}


# ── Fotos ────────────────────────────────────────────────────────────────────

def _guardar_imagen(contenido: bytes) -> str:
    from PIL import Image, ImageOps

    if not contenido:
        raise ValueError("La foto llegó vacía")
    try:
        img = Image.open(io.BytesIO(contenido))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as e:
        raise ValueError(f"No se pudo leer la imagen: {e}") from None
    img.thumbnail((_LADO_MAX_FOTO, _LADO_MAX_FOTO))
    FOTOS_DIR.mkdir(parents=True, exist_ok=True)
    archivo = f"{uuid.uuid4().hex}.jpg"
    img.save(FOTOS_DIR / archivo, "JPEG", quality=82, optimize=True)
    return archivo


def ruta_foto(archivo: str) -> Path | None:
    nombre = os.path.basename(str(archivo or ""))
    p = FOTOS_DIR / nombre
    return p if nombre and p.is_file() else None


def _ruta_origen(origen: str, ref: str) -> str | None:
    """Archivo de una foto de la bandeja: canal interno (WhatsApp o panel) o recepción."""
    try:
        if origen == "canal":
            from app.services import canales_internos as CI
            from app.services.wa_chats import resolver_media_absoluto

            with CI._conn() as c:
                r = c.execute("SELECT wa_media_path, adjunto_archivo FROM canal_mensajes WHERE id=?",
                              (int(ref),)).fetchone()
            if not r:
                return None
            if r["wa_media_path"]:
                return resolver_media_absoluto(r["wa_media_path"])
            if r["adjunto_archivo"]:
                p = os.path.join(os.path.abspath(CI.UPLOADS_DIR), os.path.basename(r["adjunto_archivo"]))
                return p if os.path.isfile(p) else None
        elif origen == "recepcion":
            from app.services import recepcion_mercancia as R

            with R._conn() as c:
                r = c.execute("SELECT archivo FROM recepcion_fotos WHERE id=?", (int(ref),)).fetchone()
            if r:
                p = os.path.join(os.path.abspath(R.UPLOADS_DIR), os.path.basename(r["archivo"]))
                return p if os.path.isfile(p) else None
    except (ValueError, TypeError):
        return None
    return None


def ruta_foto_bandeja(origen: str, ref: str) -> str | None:
    return _ruta_origen(origen, ref)


# ── Bultos ───────────────────────────────────────────────────────────────────

def _mov(c: sqlite3.Connection, bid: int, accion: str, detalle: str, usuario: dict | None) -> None:
    c.execute("INSERT INTO bulto_movimientos (bulto_id, accion, detalle, por_nombre, en) VALUES (?,?,?,?,?)",
              (bid, accion, detalle[:300], _nombre(usuario), time.time()))


def _lugar(sede: str, ubicacion: str) -> tuple[str, str]:
    sede = (sede or "").strip()[:40] or SEDES[0]
    ubicacion = re.sub(r"\s+", " ", (ubicacion or "").strip())[:120]
    if not ubicacion:
        raise ValueError("Falta la ubicación (ej. «Estante B, nivel 2» o «Piso, junto a la puerta»)")
    return sede, ubicacion


def crear(usuario: dict | None, *, sku: str, sede: str = "", ubicacion: str = "", cantidad: Any = None,
          unidad: str = "", lote: str = "", nota: str = "", recepcion_id: int | None = None,
          foto: bytes | None = None, foto_origen: str = "", foto_ref: str = "") -> dict:
    """Registra un bulto con su foto. La foto viene subida (`foto`) o de la bandeja
    (`foto_origen` + `foto_ref`), en cuyo caso esa foto sale de «Por identificar»."""
    prod = _producto(sku)
    sede, ubicacion = _lugar(sede, ubicacion)
    contenido = foto
    if not contenido and foto_origen:
        ruta = _ruta_origen(foto_origen, foto_ref)
        if not ruta:
            raise ValueError("La foto de la bandeja ya no está disponible")
        contenido = Path(ruta).read_bytes()
    if not contenido:
        raise ValueError("Falta la foto del bulto: es lo que permite reconocerlo en bodega")
    archivo = _guardar_imagen(contenido)
    ahora = time.time()
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO bultos (sku, nombre, cantidad, unidad, lote, sede, ubicacion, nota, recepcion_id, "
            "creado_por, creado_por_nombre, creado_en, actualizado_en) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (prod["sku"], prod["nombre"], _num(cantidad), (unidad or prod["unidad"] or "").strip()[:12],
             (lote or "").strip()[:60], sede, ubicacion, (nota or "").strip()[:500], recepcion_id,
             (usuario or {}).get("id"), _nombre(usuario), ahora, ahora),
        )
        bid = int(cur.lastrowid)
        c.execute("INSERT INTO bulto_fotos (bulto_id, archivo, origen, origen_ref, subida_en) VALUES (?,?,?,?,?)",
                  (bid, archivo, foto_origen or "panel", str(foto_ref or ""), ahora))
        if foto_origen:
            c.execute("INSERT OR REPLACE INTO fotos_revisadas (origen, origen_ref, decision, bulto_id, por_nombre, en) "
                      "VALUES (?,?,?,?,?,?)", (foto_origen, str(foto_ref), "bulto", bid, _nombre(usuario), ahora))
        _mov(c, bid, "creado", f"{sede} · {ubicacion}", usuario)
    _actividad(usuario, "bulto_ubicado", {"bulto_id": bid, "sku": prod["sku"]})
    cant = f" ({_fmt(_num(cantidad))} {unidad or prod['unidad']})".rstrip() if _num(cantidad) is not None else ""
    _avisar_canal(f"📍 {prod['nombre']}{cant} quedó en {sede} · {ubicacion}. Bulto {codigo(bid)}, "
                  f"registrado por {_nombre(usuario) or 'alguien'}.", {"bulto_id": bid})
    return obtener(bid)  # type: ignore[return-value]


def _fmt(v: float | None) -> str:
    if v is None:
        return ""
    return f"{v:,.0f}".replace(",", ".") if float(v).is_integer() else f"{v:,.2f}"


def agregar_foto(bid: int, usuario: dict | None, contenido: bytes) -> dict:
    archivo = _guardar_imagen(contenido)
    with _conn() as c:
        if not c.execute("SELECT 1 FROM bultos WHERE id=?", (bid,)).fetchone():
            raise LookupError("Bulto no encontrado")
        c.execute("INSERT INTO bulto_fotos (bulto_id, archivo, origen, subida_en) VALUES (?,?,?,?)",
                  (bid, archivo, "panel", time.time()))
        c.execute("UPDATE bultos SET actualizado_en=? WHERE id=?", (time.time(), bid))
        _mov(c, bid, "foto", "", usuario)
    _actividad(usuario, "bulto_foto", {"bulto_id": bid})
    return obtener(bid)  # type: ignore[return-value]


def mover(bid: int, usuario: dict | None, *, sede: str, ubicacion: str) -> dict:
    sede, ubicacion = _lugar(sede, ubicacion)
    with _conn() as c:
        r = c.execute("SELECT * FROM bultos WHERE id=?", (bid,)).fetchone()
        if not r:
            raise LookupError("Bulto no encontrado")
        antes = f"{r['sede']} · {r['ubicacion']}"
        c.execute("UPDATE bultos SET sede=?, ubicacion=?, estado='en_bodega', actualizado_en=? WHERE id=?",
                  (sede, ubicacion, time.time(), bid))
        _mov(c, bid, "movido", f"{antes} → {sede} · {ubicacion}", usuario)
        nombre = r["nombre"]
    _actividad(usuario, "bulto_movido", {"bulto_id": bid})
    _avisar_canal(f"↪️ {nombre} ({codigo(bid)}) se movió a {sede} · {ubicacion}.", {"bulto_id": bid})
    return obtener(bid)  # type: ignore[return-value]


def actualizar(bid: int, usuario: dict | None, *, cantidad: Any = None, lote: str | None = None,
               nota: str | None = None, estado: str | None = None) -> dict:
    with _conn() as c:
        r = c.execute("SELECT * FROM bultos WHERE id=?", (bid,)).fetchone()
        if not r:
            raise LookupError("Bulto no encontrado")
        cambios, valores, rastro = [], [], []
        if cantidad is not None:
            cambios.append("cantidad=?"); valores.append(_num(cantidad)); rastro.append(f"cantidad {_fmt(_num(cantidad))}")
        if lote is not None:
            cambios.append("lote=?"); valores.append(lote.strip()[:60])
        if nota is not None:
            cambios.append("nota=?"); valores.append(nota.strip()[:500])
        if estado is not None:
            if estado not in ESTADOS:
                raise ValueError("Estado inválido")
            cambios.append("estado=?"); valores.append(estado)
            rastro.append("se acabó" if estado == "agotado" else "vuelve a bodega")
        if not cambios:
            return obtener(bid)  # type: ignore[return-value]
        c.execute(f"UPDATE bultos SET {', '.join(cambios)}, actualizado_en=? WHERE id=?", (*valores, time.time(), bid))
        _mov(c, bid, "agotado" if estado == "agotado" else "editado", ", ".join(rastro), usuario)
    _actividad(usuario, "bulto_editado", {"bulto_id": bid})
    return obtener(bid)  # type: ignore[return-value]


def _fila(c: sqlite3.Connection, r: sqlite3.Row, *, historial: bool = False) -> dict:
    d = dict(r)
    d["codigo"] = codigo(r["id"])
    d["fotos"] = [dict(f) for f in c.execute(
        "SELECT id, archivo, origen, subida_en FROM bulto_fotos WHERE bulto_id=? ORDER BY id DESC", (r["id"],))]
    if historial:
        d["movimientos"] = [dict(m) for m in c.execute(
            "SELECT accion, detalle, por_nombre, en FROM bulto_movimientos WHERE bulto_id=? ORDER BY id DESC", (r["id"],))]
    return d


def obtener(bid: int) -> dict | None:
    with _conn() as c:
        r = c.execute("SELECT * FROM bultos WHERE id=?", (bid,)).fetchone()
        return _fila(c, r, historial=True) if r else None


def listar(q: str = "", *, sede: str = "", incluir_agotados: bool = False, limite: int = 300) -> list[dict]:
    sql, args = "SELECT * FROM bultos WHERE 1=1", []
    if not incluir_agotados:
        sql += " AND estado='en_bodega'"
    if sede:
        sql += " AND sede=?"; args.append(sede)
    sql += " ORDER BY actualizado_en DESC"
    toks = _tokens(q)
    with _conn() as c:
        out = []
        for r in c.execute(sql, args):
            if toks:
                hay = _norm(f"{r['sku']} {r['nombre']} {r['ubicacion']} {r['lote']} {r['nota']} {codigo(r['id'])}")
                if not all(t in hay for t in toks):
                    continue
            out.append(_fila(c, r))
            if len(out) >= limite:
                break
    return out


def ubicaciones_usadas() -> list[dict]:
    """Lugares ya escritos, para autocompletar y no tener «estante b2» y «Estante B-2»."""
    with _conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT sede, ubicacion, COUNT(*) AS n, MAX(actualizado_en) AS ultimo FROM bultos "
            "GROUP BY sede, ubicacion COLLATE NOCASE ORDER BY n DESC, ultimo DESC LIMIT 200")]


def en_texto(texto: str, limite_productos: int = 4) -> list[dict]:
    """Productos con bultos en bodega que el texto menciona (una solicitud), del más
    seguro al menos. Cada uno con sus bultos y su foto más reciente."""
    if not (texto or "").strip():
        return []
    with _conn() as c:
        filas = [_fila(c, r) for r in c.execute(
            "SELECT * FROM bultos WHERE estado='en_bodega' ORDER BY actualizado_en DESC")]
    por_sku: dict[str, dict] = {}
    for b in filas:
        g = por_sku.setdefault(b["sku"], {"sku": b["sku"], "nombre": b["nombre"], "bultos": []})
        g["bultos"].append(b)
    out = []
    for g in por_sku.values():
        p = puntaje_nombre(g["nombre"], g["sku"], texto)
        if p:
            out.append({**g, "puntaje": p})
    out.sort(key=lambda g: -g["puntaje"])
    return out[:limite_productos]


# ── Bandeja «Por identificar» ────────────────────────────────────────────────

def _es_imagen(mime: str, archivo: str) -> bool:
    return (mime or "").startswith("image/") or bool(re.search(r"\.(jpe?g|png|webp|gif|heic)$", archivo or "", re.I))


def por_identificar(dias: int = BANDEJA_DIAS, limite: int = 120) -> list[dict]:
    """Fotos recientes de los canales internos (incluye lo que llega de los grupos de
    WhatsApp enlazados) y de las recepciones que nadie ha asociado a un bulto.
    Cada una con el texto que la acompañó y productos sugeridos por ese texto."""
    desde = time.time() - dias * 86400
    with _conn() as c:
        vistas = {(r["origen"], r["origen_ref"]) for r in c.execute("SELECT origen, origen_ref FROM fotos_revisadas")}
    out: list[dict] = []
    try:
        from app.services import canales_internos as CI

        with CI._conn() as c:
            filas = c.execute(
                "SELECT m.id, m.canal_id, k.nombre AS canal, m.autor_nombre, m.origen, m.texto, m.wa_media_path, "
                "m.adjunto_archivo, m.adjunto_mime, m.creado_en FROM canal_mensajes m "
                "JOIN canales_internos k ON k.id=m.canal_id "
                "WHERE m.eliminado=0 AND m.creado_en>=? AND (m.wa_media_path IS NOT NULL OR m.adjunto_archivo IS NOT NULL) "
                "ORDER BY m.id DESC LIMIT 400", (desde,)).fetchall()
            for r in filas:
                if ("canal", str(r["id"])) in vistas:
                    continue
                if not _es_imagen(r["adjunto_mime"] or "", r["wa_media_path"] or r["adjunto_archivo"] or ""):
                    continue
                out.append({
                    "origen": "canal", "ref": str(r["id"]), "donde": r["canal"],
                    "via": "WhatsApp" if r["origen"] == "whatsapp" or r["wa_media_path"] else "Panel",
                    "autor": r["autor_nombre"] or "", "texto": r["texto"] or "", "en": r["creado_en"],
                })
    except Exception as e:
        print(f"[bultos] bandeja canales: {e}")
    try:
        from app.services import recepcion_mercancia as R

        with R._conn() as c:
            filas = c.execute(
                "SELECT f.id, f.recepcion_id, f.archivo, f.subida_en, r.proveedor, r.recibido_por_nombre, "
                "(SELECT group_concat(descripcion, ' · ') FROM recepcion_items WHERE recepcion_id=r.id) AS items "
                "FROM recepcion_fotos f JOIN recepciones r ON r.id=f.recepcion_id "
                "WHERE f.subida_en>=? AND r.estado!='anulada' ORDER BY f.id DESC LIMIT 300", (desde,)).fetchall()
            for r in filas:
                if ("recepcion", str(r["id"])) in vistas or not _es_imagen("", r["archivo"]):
                    continue
                out.append({
                    "origen": "recepcion", "ref": str(r["id"]), "donde": f"Recepción #{r['recepcion_id']} · {r['proveedor']}",
                    "via": "Recepción", "autor": r["recibido_por_nombre"] or "", "texto": r["items"] or "",
                    "en": r["subida_en"], "recepcion_id": r["recepcion_id"],
                })
    except Exception as e:
        print(f"[bultos] bandeja recepciones: {e}")
    out.sort(key=lambda x: -float(x["en"] or 0))
    out = out[:limite]
    if any(x["texto"] for x in out):
        try:
            catalogo = buscar_productos("", limite=100000)
        except Exception:
            catalogo = []
        for x in out:
            x["sugeridos"] = _sugerir(x["texto"], catalogo) if x["texto"] else []
    return out


def _sugerir(texto: str, catalogo: list[dict], n: int = 3) -> list[dict]:
    puntuados = [(puntaje_nombre(p["nombre"], p["sku"], texto), p) for p in catalogo]
    puntuados = [(s, p) for s, p in puntuados if s]
    puntuados.sort(key=lambda sp: -sp[0])
    return [p for _, p in puntuados[:n]]


def descartar(origen: str, ref: str, usuario: dict | None) -> None:
    """«No es un bulto» (un comprobante, una guía, una conversación)."""
    if origen not in ("canal", "recepcion"):
        raise ValueError("Origen inválido")
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO fotos_revisadas (origen, origen_ref, decision, por_nombre, en) "
                  "VALUES (?,?,?,?,?)", (origen, str(ref), "descartada", _nombre(usuario), time.time()))
    _actividad(usuario, "bulto_foto_descartada", {"origen": origen, "ref": ref})


def resumen() -> dict:
    with _conn() as c:
        n = c.execute("SELECT COUNT(*), COUNT(DISTINCT sku) FROM bultos WHERE estado='en_bodega'").fetchone()
    return {"bultos": int(n[0] or 0), "productos": int(n[1] or 0), "por_identificar": len(por_identificar())}
