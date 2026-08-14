"""
Empaque / evidencia fotográfica de paquetes.

Lista ventas de MeLi, tienda web y WhatsApp, y guarda fotos del estado del
paquete antes de despachar (defensa ante reclamos por faltantes).
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB_PATH = os.path.join(_ROOT, "app", "data", "empaque_evidencia.db")
UPLOADS_DIR = os.path.join(_ROOT, "app", "data", "empaque_uploads")
ORDERS_WEB_DB = os.path.join(_ROOT, "PAGINA_WEB", "site", "data", "orders.db")
DESPACHOS_DB = os.path.join(_ROOT, "app", "data", "despachos.db")
COTIZACIONES_DIR = os.path.join(_ROOT, "cotizaciones_preliminares")

_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
_DB_READY = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    global _DB_READY
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    # El agente suele correr como mckg; carpetas creadas por root/otro user
    # dejaban Permission denied al guardar fotos (evidencia vacía en panel).
    for path, mode in ((UPLOADS_DIR, 0o777), (DB_PATH, 0o666)):
        try:
            if os.path.exists(path):
                os.chmod(path, mode)
        except OSError:
            pass
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS evidencias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canal TEXT NOT NULL,
                venta_id TEXT NOT NULL,
                archivo TEXT NOT NULL,
                nota TEXT,
                subido_por TEXT,
                subido_por_id INTEGER,
                creado_en TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_evidencias_venta
                ON evidencias(canal, venta_id);

            CREATE TABLE IF NOT EXISTS ventas_wa (
                id TEXT PRIMARY KEY,
                cliente TEXT,
                telefono TEXT,
                productos_json TEXT,
                total REAL,
                notas TEXT,
                creado_por TEXT,
                creado_por_id INTEGER,
                creado_en TEXT NOT NULL
            );
            """
        )
        con.commit()
    _DB_READY = True


def _ensure_db() -> None:
    if not _DB_READY:
        init_db()


def _counts_evidencias(pares: list[tuple[str, str]]) -> dict[tuple[str, str], int]:
    _ensure_db()
    if not pares:
        return {}
    with _conn() as con:
        out: dict[tuple[str, str], int] = {}
        for canal, venta_id in pares:
            row = con.execute(
                "SELECT COUNT(*) AS c FROM evidencias WHERE canal=? AND venta_id=?",
                (canal, venta_id),
            ).fetchone()
            out[(canal, venta_id)] = int(row["c"] if row else 0)
        return out


def listar_evidencias(canal: str, venta_id: str) -> list[dict[str, Any]]:
    _ensure_db()
    canal = (canal or "").strip().lower()
    venta_id = str(venta_id or "").strip()
    if not canal or not venta_id:
        return []
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM evidencias WHERE canal=? AND venta_id=? ORDER BY id DESC",
            (canal, venta_id),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "canal": r["canal"],
            "venta_id": r["venta_id"],
            "archivo": r["archivo"],
            "url": f"/api/empaque/uploads/{r['archivo']}",
            "nota": r["nota"] or "",
            "subido_por": r["subido_por"] or "",
            "subido_por_id": r["subido_por_id"],
            "creado_en": r["creado_en"],
        }
        for r in rows
    ]


def registrar_evidencia(
    canal: str,
    venta_id: str,
    archivo: str,
    *,
    nota: str = "",
    subido_por: str = "",
    subido_por_id: int | None = None,
) -> dict[str, Any]:
    _ensure_db()
    canal = (canal or "").strip().lower()
    venta_id = str(venta_id or "").strip()
    if canal not in ("meli", "web", "whatsapp"):
        raise ValueError("Canal inválido (meli|web|whatsapp)")
    if not venta_id:
        raise ValueError("Falta venta_id")
    if not archivo:
        raise ValueError("Falta archivo")
    creado = _now_iso()
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO evidencias (canal, venta_id, archivo, nota, subido_por, subido_por_id, creado_en) "
            "VALUES (?,?,?,?,?,?,?)",
            (canal, venta_id, archivo, (nota or "")[:300], (subido_por or "")[:120], subido_por_id, creado),
        )
        con.commit()
        eid = int(cur.lastrowid)
    return {
        "id": eid,
        "canal": canal,
        "venta_id": venta_id,
        "archivo": archivo,
        "url": f"/api/empaque/uploads/{archivo}",
        "nota": (nota or "")[:300],
        "subido_por": (subido_por or "")[:120],
        "subido_por_id": subido_por_id,
        "creado_en": creado,
    }


def eliminar_evidencia(evidencia_id: int) -> tuple[bool, str]:
    _ensure_db()
    with _conn() as con:
        row = con.execute("SELECT * FROM evidencias WHERE id=?", (evidencia_id,)).fetchone()
        if not row:
            return False, "Evidencia no encontrada"
        archivo = row["archivo"]
        con.execute("DELETE FROM evidencias WHERE id=?", (evidencia_id,))
        con.commit()
    ruta = os.path.join(UPLOADS_DIR, archivo)
    if os.path.isfile(ruta):
        try:
            os.remove(ruta)
        except OSError:
            pass
    return True, "Eliminada"


def _asegurar_dir_uploads() -> None:
    """Crea UPLOADS_DIR y intenta dejarlo escribible por el proceso del agente."""
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    try:
        os.chmod(UPLOADS_DIR, 0o777)
    except OSError:
        pass
    probe = os.path.join(UPLOADS_DIR, f".wprobe_{uuid.uuid4().hex[:8]}")
    try:
        with open(probe, "wb") as fh:
            fh.write(b"1")
        os.remove(probe)
    except OSError as e:
        raise PermissionError(
            f"No se puede guardar fotos en {UPLOADS_DIR} (permiso denegado). "
            "Ajusta dueño/permisos al usuario del agente (mckg)."
        ) from e


def guardar_archivo_upload(file_storage) -> str:
    """Guarda el FileStorage de Flask y retorna el nombre de archivo seguro."""
    _ensure_db()
    nombre_orig = (getattr(file_storage, "filename", None) or "").strip()
    # Móvil (input capture) a veces manda filename vacío o sin extensión.
    content_type = (getattr(file_storage, "content_type", None) or "").lower()
    _, ext = os.path.splitext(nombre_orig)
    ext = (ext or "").lower()
    if not ext:
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        elif "heic" in content_type or "heif" in content_type:
            ext = ".heic"
        else:
            ext = ".jpg"
    if ext not in _ALLOWED_EXT:
        raise ValueError(f"Formato no permitido ({ext}). Usa JPG, PNG o WEBP.")
    _asegurar_dir_uploads()
    nombre = f"emp_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:10]}{ext}"
    path = os.path.join(UPLOADS_DIR, nombre)
    try:
        file_storage.save(path)
    except OSError as e:
        raise PermissionError(
            f"No se pudo escribir la foto ({e}). Revisa permisos de {UPLOADS_DIR}."
        ) from e
    if not os.path.isfile(path) or os.path.getsize(path) <= 0:
        raise ValueError("La foto llegó vacía. Vuelve a tomar o elige de galería.")
    return nombre


def crear_venta_wa(
    *,
    cliente: str,
    telefono: str = "",
    productos: list | str = "",
    total: float | None = None,
    notas: str = "",
    creado_por: str = "",
    creado_por_id: int | None = None,
) -> dict[str, Any]:
    _ensure_db()
    cliente = (cliente or "").strip()
    if not cliente:
        raise ValueError("Indica el nombre del cliente")
    if isinstance(productos, list):
        prods_json = json.dumps(productos, ensure_ascii=False)
        prods_txt = ", ".join(
            f"{(p.get('nombre') or p.get('name') or '?')} x{(p.get('cantidad') or p.get('qty') or 1)}"
            for p in productos
            if isinstance(p, dict)
        )
    else:
        prods_txt = str(productos or "").strip()
        prods_json = json.dumps(
            [{"nombre": line.strip(), "cantidad": 1} for line in prods_txt.split("\n") if line.strip()],
            ensure_ascii=False,
        )
    vid = f"WA-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    creado = _now_iso()
    with _conn() as con:
        con.execute(
            "INSERT INTO ventas_wa (id, cliente, telefono, productos_json, total, notas, creado_por, creado_por_id, creado_en) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                vid,
                cliente[:200],
                (telefono or "")[:40],
                prods_json,
                float(total) if total is not None else None,
                (notas or "")[:500],
                (creado_por or "")[:120],
                creado_por_id,
                creado,
            ),
        )
        con.commit()
    return {
        "canal": "whatsapp",
        "id": vid,
        "fecha": creado,
        "cliente": cliente[:200],
        "telefono": (telefono or "")[:40],
        "total": float(total) if total is not None else None,
        "estado": "pendiente_empaque",
        "items": json.loads(prods_json),
        "items_resumen": prods_txt[:240],
        "notas": (notas or "")[:500],
        "evidencias_count": 0,
        "origen": "manual",
    }


def _listar_ventas_wa_manuales(dias: int) -> list[dict[str, Any]]:
    _ensure_db()
    corte = datetime.now() - timedelta(days=max(1, dias))
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM ventas_wa ORDER BY creado_en DESC LIMIT 200"
        ).fetchall()
    out = []
    for r in rows:
        try:
            fe = datetime.fromisoformat((r["creado_en"] or "").replace("Z", "+00:00"))
            if fe.replace(tzinfo=None) < corte.replace(tzinfo=None):
                continue
        except Exception:
            pass
        try:
            items = json.loads(r["productos_json"] or "[]")
        except Exception:
            items = []
        resumen = ", ".join(
            f"{(p.get('nombre') or '?')} x{(p.get('cantidad') or 1)}"
            for p in items
            if isinstance(p, dict)
        )
        out.append(
            {
                "canal": "whatsapp",
                "id": r["id"],
                "fecha": r["creado_en"],
                "cliente": r["cliente"] or "",
                "telefono": r["telefono"] or "",
                "total": r["total"],
                "estado": "pendiente_empaque",
                "items": items,
                "items_resumen": resumen[:240],
                "notas": r["notas"] or "",
                "origen": "manual",
            }
        )
    return out


def _listar_cotizaciones_wa(dias: int) -> list[dict[str, Any]]:
    if not os.path.isdir(COTIZACIONES_DIR):
        return []
    corte = datetime.now() - timedelta(days=max(1, dias))
    out = []
    try:
        files = sorted(os.listdir(COTIZACIONES_DIR), reverse=True)
    except OSError:
        return []
    for name in files[:120]:
        if not name.startswith("PRE-") or not name.endswith(".json"):
            continue
        path = os.path.join(COTIZACIONES_DIR, name)
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            if mtime < corte:
                continue
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        vid = str(data.get("id_preliminar") or name.replace(".json", ""))
        productos = data.get("productos") or []
        if not isinstance(productos, list):
            productos = []
        resumen = ", ".join(
            f"{(p.get('nombre') or p.get('description') or '?')} x{(p.get('cantidad') or p.get('quantity') or 1)}"
            for p in productos
            if isinstance(p, dict)
        )
        out.append(
            {
                "canal": "whatsapp",
                "id": vid,
                "fecha": data.get("fecha") or mtime.isoformat(timespec="seconds"),
                "cliente": data.get("nombre_cliente") or "",
                "telefono": "",
                "total": data.get("total"),
                "estado": "cotizacion",
                "items": productos,
                "items_resumen": resumen[:240],
                "notas": data.get("direccion_envio") or "",
                "origen": "cotizacion",
            }
        )
    return out


def _listar_despachos_wa(dias: int) -> list[dict[str, Any]]:
    if not os.path.isfile(DESPACHOS_DB):
        return []
    corte = (datetime.now() - timedelta(days=max(1, dias))).isoformat()
    try:
        con = sqlite3.connect(DESPACHOS_DB)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM despachos WHERE creado_en >= ? OR creado_en IS NULL ORDER BY id DESC LIMIT 100",
            (corte,),
        ).fetchall()
        con.close()
    except Exception:
        return []
    out = []
    for r in rows:
        prods = r["productos"] or ""
        out.append(
            {
                "canal": "whatsapp",
                "id": str(r["order_id"]),
                "fecha": r["creado_en"] or "",
                "cliente": r["cliente"] or "",
                "telefono": r["numero_wa"] or "",
                "total": None,
                "estado": (r["estado"] or "PENDIENTE").lower(),
                "items": [{"nombre": p.strip(), "cantidad": 1} for p in prods.split(",") if p.strip()],
                "items_resumen": prods[:240],
                "notas": f"{r['ciudad'] or ''} · guía {r['guia'] or ''}".strip(" ·"),
                "origen": "despacho",
            }
        )
    return out


def _listar_web(dias: int, q: str = "") -> list[dict[str, Any]]:
    if not os.path.isfile(ORDERS_WEB_DB):
        return []
    corte = (datetime.now() - timedelta(days=max(1, dias))).isoformat()
    try:
        con = sqlite3.connect(ORDERS_WEB_DB)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM orders WHERE lower(status) IN ('approved','paid') "
            "AND (created_at >= ? OR created_at IS NULL) ORDER BY id DESC LIMIT 150",
            (corte,),
        ).fetchall()
        con.close()
    except Exception:
        return []
    qn = (q or "").strip().lower()
    out = []
    for row in rows:
        d = dict(row)
        try:
            raw = json.loads(d.get("items_json") or "{}")
            items = raw.get("items", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        except Exception:
            items = []
        ref = str(d.get("reference") or d.get("id") or "")
        cliente = d.get("buyer_name") or ""
        if qn and qn not in ref.lower() and qn not in cliente.lower() and qn not in (d.get("buyer_phone") or "").lower():
            continue
        resumen = ", ".join(
            f"{(it.get('name') or it.get('title') or '?')} x{(it.get('quantity') or it.get('qty') or 1)}"
            for it in items
            if isinstance(it, dict)
        )
        out.append(
            {
                "canal": "web",
                "id": ref,
                "fecha": d.get("created_at") or "",
                "cliente": cliente,
                "telefono": d.get("buyer_phone") or "",
                "total": d.get("total"),
                "estado": d.get("shipping_status") or d.get("status") or "",
                "items": items,
                "items_resumen": resumen[:240],
                "notas": d.get("buyer_city") or "",
                "origen": "tienda",
            }
        )
    return out


def _listar_meli(dias: int, q: str = "", limit: int = 50) -> list[dict[str, Any]]:
    from app.utils import obtener_seller_id_meli, refrescar_token_meli

    token = refrescar_token_meli()
    seller_id = obtener_seller_id_meli()
    if not token or not seller_id:
        return []
    desde = (datetime.now(timezone.utc) - timedelta(days=max(1, dias))).strftime(
        "%Y-%m-%dT%H:%M:%S.000-00:00"
    )
    url = (
        f"https://api.mercadolibre.com/orders/search?seller={seller_id}"
        f"&order.status=paid&sort=date_desc&limit={min(50, max(10, limit))}"
        f"&order.date_created.from={desde}"
    )
    try:
        res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=18)
        if res.status_code != 200:
            return []
        results = res.json().get("results") or []
    except requests.RequestException:
        return []

    qn = (q or "").strip().lower()
    out = []
    for orden in results:
        status = (orden.get("status") or "").lower()
        if status not in ("paid", "partially_paid", "confirmed"):
            continue
        oid = str(orden.get("pack_id") or orden.get("id") or "")
        buyer = orden.get("buyer") or {}
        cliente = str(buyer.get("nickname") or buyer.get("first_name") or "")
        if qn and qn not in oid.lower() and qn not in cliente.lower():
            continue
        items_raw = orden.get("order_items") or []
        items = []
        for it in items_raw:
            item = it.get("item") or {}
            items.append(
                {
                    "nombre": item.get("title") or "",
                    "sku": item.get("seller_sku") or item.get("seller_custom_field") or "",
                    "cantidad": it.get("quantity") or 1,
                    "precio": it.get("unit_price"),
                }
            )
        resumen = ", ".join(f"{i['nombre'][:60]} x{i['cantidad']}" for i in items)
        out.append(
            {
                "canal": "meli",
                "id": oid,
                "fecha": orden.get("date_created") or "",
                "cliente": cliente,
                "telefono": "",
                "total": orden.get("total_amount"),
                "estado": status,
                "items": items,
                "items_resumen": resumen[:240],
                "notas": "",
                "origen": "mercadolibre",
            }
        )
    return out


def listar_ventas(
    *,
    canal: str | None = None,
    dias: int = 7,
    q: str = "",
    solo_sin_evidencia: bool = False,
) -> dict[str, Any]:
    """Lista unificada de ventas para empaque."""
    canal_f = (canal or "").strip().lower() or None
    dias = max(1, min(60, int(dias or 7)))
    errores: list[str] = []
    ventas: list[dict[str, Any]] = []

    if canal_f in (None, "meli"):
        try:
            ventas.extend(_listar_meli(dias, q=q))
        except Exception as e:
            errores.append(f"meli: {e}")

    if canal_f in (None, "web"):
        try:
            ventas.extend(_listar_web(dias, q=q))
        except Exception as e:
            errores.append(f"web: {e}")

    if canal_f in (None, "whatsapp"):
        try:
            vistos: set[str] = set()
            for bloque in (
                _listar_ventas_wa_manuales(dias),
                _listar_despachos_wa(dias),
                _listar_cotizaciones_wa(dias),
            ):
                for v in bloque:
                    if q:
                        qn = q.lower()
                        blob = f"{v.get('id')} {v.get('cliente')} {v.get('telefono')}".lower()
                        if qn not in blob:
                            continue
                    key = str(v.get("id") or "")
                    if key in vistos:
                        continue
                    vistos.add(key)
                    ventas.append(v)
        except Exception as e:
            errores.append(f"whatsapp: {e}")

    pares = [(str(v["canal"]), str(v["id"])) for v in ventas]
    counts = _counts_evidencias(pares)
    for v in ventas:
        v["evidencias_count"] = counts.get((str(v["canal"]), str(v["id"])), 0)

    if solo_sin_evidencia:
        ventas = [v for v in ventas if int(v.get("evidencias_count") or 0) == 0]

    def _sort_key(v: dict) -> str:
        return str(v.get("fecha") or "")

    ventas.sort(key=_sort_key, reverse=True)

    resumen = {"meli": 0, "web": 0, "whatsapp": 0, "sin_evidencia": 0}
    for v in ventas:
        c = str(v.get("canal") or "")
        if c in resumen:
            resumen[c] += 1
        if int(v.get("evidencias_count") or 0) == 0:
            resumen["sin_evidencia"] += 1

    return {
        "ventas": ventas,
        "total": len(ventas),
        "dias": dias,
        "resumen": resumen,
        "errores": errores,
    }


def ruta_upload_segura(filename: str) -> str | None:
    """Nombre de archivo dentro de uploads/empaque, o None si es path traversal."""
    name = os.path.basename((filename or "").strip())
    if not name or not re.match(r"^emp_[\w.\-]+$", name, re.I):
        return None
    full = os.path.normpath(os.path.join(UPLOADS_DIR, name))
    if not full.startswith(os.path.normpath(UPLOADS_DIR)):
        return None
    return full if os.path.isfile(full) else None
