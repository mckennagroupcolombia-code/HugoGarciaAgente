"""
Catálogo local Alegra (productos + kits) en contabilidad.db.

Fuente de verdad: Alegra API. Esta DB es espejo operativo para el panel y pickers.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

from app.services import contabilidad_db as cdb

_STALE_SECONDS = 24 * 3600
_sync_lock = threading.Lock()
_sync_estado: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "ok": None,
    "error": None,
    "productos": 0,
    "kits": 0,
    "total": 0,
    "mensaje": "",
}


def estado_sync() -> dict[str, Any]:
    return dict(_sync_estado)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalizar_tipo(raw: Any) -> str:
    t = str(raw or "product").strip().lower()
    if t in ("kit", "combo"):
        return "kit"
    return "product"


def _precio_lista(raw: dict) -> float:
    try:
        precios = raw.get("price") or []
        if isinstance(precios, list) and precios:
            return float(precios[0].get("price") or 0)
        if isinstance(precios, (int, float)):
            return float(precios)
    except (TypeError, ValueError, AttributeError, IndexError, KeyError):
        pass
    try:
        return float(raw.get("precio_lista") or 0)
    except (TypeError, ValueError):
        return 0.0


def _unit_cost(raw: dict) -> float:
    inv = raw.get("inventory") or {}
    try:
        return float(inv.get("unitCost") or raw.get("unit_cost") or 0)
    except (TypeError, ValueError):
        return 0.0


def _unit(raw: dict) -> str:
    inv = raw.get("inventory") or {}
    return str(inv.get("unit") or raw.get("unit") or "").strip()


def _tiene_iva(raw: dict) -> int:
    taxes = raw.get("tax") or raw.get("taxes") or []
    if not taxes:
        return 0
    return 1


def _componentes_desde_raw(raw: dict) -> list[dict]:
    """Extrae [{reference, name, quantity}] de subitems Alegra."""
    from app.services.alegra import _resolver_referencia_item_alegra

    out: list[dict] = []
    for sub in raw.get("subitems") or []:
        item = sub.get("item") if isinstance(sub.get("item"), dict) else {}
        if not item and isinstance(sub, dict):
            # Forma ya normalizada {codigo,nombre,cantidad}
            ref = str(sub.get("reference") or sub.get("codigo") or "").strip()
            name = str(sub.get("name") or sub.get("nombre") or "").strip()
            try:
                qty = float(sub.get("quantity") if sub.get("quantity") is not None else sub.get("cantidad") or 1)
            except (TypeError, ValueError):
                qty = 1.0
            if ref and qty > 0:
                out.append({"reference": ref, "name": name, "quantity": qty})
            continue

        ref = str(item.get("reference") or "").strip()
        name = str(item.get("name") or "").strip()
        item_id = str(item.get("id") or "").strip()
        if not ref and item_id:
            resolved = _resolver_referencia_item_alegra(item_id)
            ref = str(resolved.get("reference") or "").strip()
            if not name:
                name = str(resolved.get("name") or "").strip()
        try:
            qty = float(sub.get("quantity") or 1)
        except (TypeError, ValueError):
            qty = 1.0
        if not ref or qty <= 0:
            continue
        out.append({"reference": ref, "name": name, "quantity": qty})
    return out


def upsert_item(
    *,
    alegra_id: str | int | None,
    reference: str,
    name: str = "",
    tipo: str = "product",
    status: str = "active",
    unit: str = "",
    unit_cost: float = 0.0,
    precio_lista: float = 0.0,
    iva: bool | int = False,
    componentes: list[dict] | None = None,
    synced_at: str | None = None,
) -> None:
    """Inserta o actualiza un ítem local; si es kit, reemplaza componentes."""
    cdb._ensure()
    ref = (reference or "").strip()
    if not ref:
        return
    tipo_n = _normalizar_tipo(tipo)
    now = synced_at or _now_iso()
    with cdb._conn() as con:
        con.execute(
            """
            INSERT INTO alegra_items (
                id, reference, name, type, status, unit, unit_cost,
                precio_lista, iva, updated_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(reference) DO UPDATE SET
                id=excluded.id,
                name=excluded.name,
                type=excluded.type,
                status=excluded.status,
                unit=excluded.unit,
                unit_cost=excluded.unit_cost,
                precio_lista=excluded.precio_lista,
                iva=excluded.iva,
                updated_at=excluded.updated_at,
                synced_at=excluded.synced_at
            """,
            (
                str(alegra_id or ""),
                ref,
                (name or "").strip() or ref,
                tipo_n,
                (status or "active").strip() or "active",
                (unit or "").strip(),
                float(unit_cost or 0),
                float(precio_lista or 0),
                1 if iva else 0,
                now,
                now,
            ),
        )
        if tipo_n == "kit":
            con.execute(
                "DELETE FROM alegra_kit_components WHERE kit_reference = ?",
                (ref,),
            )
            for comp in componentes or []:
                cref = str(
                    comp.get("reference") or comp.get("codigo") or comp.get("code") or ""
                ).strip()
                if not cref:
                    continue
                try:
                    qty = float(
                        comp.get("quantity")
                        if comp.get("quantity") is not None
                        else comp.get("cantidad") or 1
                    )
                except (TypeError, ValueError):
                    qty = 1.0
                if qty <= 0:
                    continue
                cname = str(
                    comp.get("name") or comp.get("nombre") or comp.get("component_name") or ""
                ).strip()
                con.execute(
                    """
                    INSERT INTO alegra_kit_components (
                        kit_reference, component_reference, component_name, quantity
                    ) VALUES (?, ?, ?, ?)
                    ON CONFLICT(kit_reference, component_reference) DO UPDATE SET
                        component_name=excluded.component_name,
                        quantity=excluded.quantity
                    """,
                    (ref, cref, cname, qty),
                )


def upsert_item_desde_alegra(raw: dict, componentes: list[dict] | None = None) -> None:
    """Upsert desde respuesta cruda de Alegra (GET/POST /items)."""
    if not isinstance(raw, dict):
        return
    ref = str(raw.get("reference") or "").strip()
    if not ref:
        return
    tipo = _normalizar_tipo(raw.get("type"))
    comps = componentes if componentes is not None else (
        _componentes_desde_raw(raw) if tipo == "kit" else []
    )
    upsert_item(
        alegra_id=raw.get("id"),
        reference=ref,
        name=str(raw.get("name") or "").strip(),
        tipo=tipo,
        status=str(raw.get("status") or "active").strip() or "active",
        unit=_unit(raw),
        unit_cost=_unit_cost(raw),
        precio_lista=_precio_lista(raw),
        iva=_tiene_iva(raw),
        componentes=comps,
    )


def contar_items(*, solo_activos: bool = True) -> int:
    cdb._ensure()
    sql = "SELECT COUNT(*) FROM alegra_items"
    if solo_activos:
        sql += " WHERE status = 'active'"
    with cdb._conn() as con:
        row = con.execute(sql).fetchone()
    return int(row[0] if row else 0)


def ultima_sync_at() -> str | None:
    cdb._ensure()
    with cdb._conn() as con:
        row = con.execute("SELECT MAX(synced_at) FROM alegra_items").fetchone()
    val = row[0] if row else None
    return str(val) if val else None


def catalogo_stale(*, max_age_seconds: int = _STALE_SECONDS) -> bool:
    """True si no hay filas o la sync más reciente supera max_age_seconds."""
    ts = ultima_sync_at()
    if not ts or contar_items(solo_activos=False) == 0:
        return True
    try:
        # Acepta ISO con Z o sin tz
        cleaned = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = time.time() - dt.timestamp()
        return age > max_age_seconds
    except Exception:
        return True


def listar_items(
    *,
    tipo: str | None = None,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    solo_activos: bool = True,
) -> dict[str, Any]:
    cdb._ensure()
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    where: list[str] = []
    params: list[Any] = []
    if solo_activos:
        where.append("status = 'active'")
    tipo_n = (tipo or "").strip().lower()
    if tipo_n in ("product", "kit"):
        where.append("type = ?")
        params.append(tipo_n)
    qn = (q or "").strip()
    if qn:
        where.append("(reference LIKE ? OR name LIKE ?)")
        like = f"%{qn}%"
        params.extend([like, like])
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with cdb._conn() as con:
        total = con.execute(
            f"SELECT COUNT(*) FROM alegra_items{clause}", params
        ).fetchone()[0]
        rows = con.execute(
            f"""
            SELECT id, reference, name, type, status, unit, unit_cost,
                   precio_lista, iva, updated_at, synced_at
            FROM alegra_items{clause}
            ORDER BY name COLLATE NOCASE, reference
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    items = [dict(r) for r in rows]
    conteos = {"product": 0, "kit": 0}
    with cdb._conn() as con:
        for row in con.execute(
            """
            SELECT type, COUNT(*) AS n FROM alegra_items
            WHERE status = 'active'
            GROUP BY type
            """
        ).fetchall():
            t = str(row["type"] or "")
            if t in conteos:
                conteos[t] = int(row["n"])
    return {
        "items": items,
        "total": int(total),
        "synced_at": ultima_sync_at(),
        "limit": limit,
        "offset": offset,
        "conteos": conteos,
    }


def obtener_item(reference: str) -> dict[str, Any] | None:
    cdb._ensure()
    ref = (reference or "").strip()
    if not ref:
        return None
    with cdb._conn() as con:
        row = con.execute(
            """
            SELECT id, reference, name, type, status, unit, unit_cost,
                   precio_lista, iva, updated_at, synced_at
            FROM alegra_items WHERE reference = ? COLLATE NOCASE
            """,
            (ref,),
        ).fetchone()
        if not row:
            return None
        item = dict(row)
        comps: list[dict] = []
        if item.get("type") == "kit":
            crow = con.execute(
                """
                SELECT component_reference, component_name, quantity
                FROM alegra_kit_components
                WHERE kit_reference = ?
                ORDER BY component_reference
                """,
                (item["reference"],),
            ).fetchall()
            comps = [
                {
                    "codigo": r["component_reference"],
                    "nombre": r["component_name"],
                    "cantidad": r["quantity"],
                }
                for r in crow
            ]
    item["componentes"] = comps
    return item


def borrar_item_local(reference: str) -> bool:
    """Quita el ítem (y componentes de kit) del espejo SQLite."""
    cdb._ensure()
    ref = (reference or "").strip()
    if not ref:
        return False
    with cdb._conn() as con:
        # Resolver referencia exacta (case-insensitive)
        row = con.execute(
            "SELECT reference FROM alegra_items WHERE reference = ? COLLATE NOCASE",
            (ref,),
        ).fetchone()
        if not row:
            return False
        exact = row["reference"]
        con.execute(
            "DELETE FROM alegra_kit_components WHERE kit_reference = ?", (exact,),
        )
        con.execute("DELETE FROM alegra_items WHERE reference = ?", (exact,))
    return True


def actualizar_campos_locales(
    reference: str,
    *,
    name: str | None = None,
    precio_lista: float | None = None,
    unit_cost: float | None = None,
    status: str | None = None,
) -> dict[str, Any] | None:
    """Actualiza campos del espejo local tras editar en Alegra."""
    cdb._ensure()
    item = obtener_item(reference)
    if not item:
        return None
    ref = item["reference"]
    now = _now_iso()
    new_name = item["name"] if name is None else (name or "").strip() or item["name"]
    new_precio = item["precio_lista"] if precio_lista is None else float(precio_lista)
    new_cost = item["unit_cost"] if unit_cost is None else float(unit_cost)
    new_status = item["status"] if status is None else (status or item["status"])
    with cdb._conn() as con:
        con.execute(
            """
            UPDATE alegra_items
            SET name = ?, precio_lista = ?, unit_cost = ?, status = ?,
                updated_at = ?, synced_at = ?
            WHERE reference = ?
            """,
            (new_name, new_precio, new_cost, new_status, now, now, ref),
        )
    return obtener_item(ref)


def buscar_picker_local(
    consulta: str, *, max_items: int = 40, excluir_combos: bool = True,
) -> list[dict]:
    """Misma forma que buscar_productos_alegra_picker: [{codigo,nombre,type}]."""
    q = (consulta or "").strip()
    if "—" in q or " - " in q:
        q = q.split("—")[0].split(" - ")[0].strip()
    if len(q) < 1:
        return []
    cdb._ensure()
    like = f"%{q}%"
    where = ["status = 'active'", "(reference LIKE ? OR name LIKE ?)"]
    params: list[Any] = [like, like]
    if excluir_combos:
        where.append("type != 'kit'")
    clause = " AND ".join(where)
    with cdb._conn() as con:
        # Prefer exact reference match first
        exact = con.execute(
            f"""
            SELECT reference, name, type FROM alegra_items
            WHERE status = 'active' AND reference = ? COLLATE NOCASE
            {"AND type != 'kit'" if excluir_combos else ""}
            LIMIT 5
            """,
            (q,),
        ).fetchall()
        rows = list(exact)
        seen = {str(r["reference"]).upper() for r in rows}
        if len(rows) < max_items:
            more = con.execute(
                f"""
                SELECT reference, name, type FROM alegra_items
                WHERE {clause}
                ORDER BY
                  CASE WHEN reference LIKE ? THEN 0 ELSE 1 END,
                  name COLLATE NOCASE
                LIMIT ?
                """,
                [*params, f"{q}%", max_items],
            ).fetchall()
            for r in more:
                cu = str(r["reference"]).upper()
                if cu in seen:
                    continue
                seen.add(cu)
                rows.append(r)
                if len(rows) >= max_items:
                    break
    out = []
    for r in rows[:max_items]:
        tipo = "Combo" if r["type"] == "kit" else "Product"
        out.append({
            "codigo": r["reference"],
            "nombre": r["name"] or r["reference"],
            "type": tipo,
        })
    return out


def _paginar_items_alegra(*, tipo: str | None = None) -> list[dict]:
    import requests
    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    headers = _alegra_headers()
    out: list[dict] = []
    pagina = 0
    while True:
        params: dict[str, Any] = {"limit": 30, "start": pagina * 30}
        if tipo:
            params["type"] = tipo
        res = requests.get(
            f"{_ALEGRA_BASE}/items", headers=headers, params=params, timeout=30,
        )
        if res.status_code != 200:
            raise RuntimeError(f"Alegra GET /items {res.status_code}: {res.text[:200]}")
        lote = res.json() or []
        if not lote:
            break
        out.extend(lote)
        if len(lote) < 30:
            break
        pagina += 1
    return out


def sincronizar_catalogo_alegra(*, en_hilo: bool = False) -> dict[str, Any]:
    """Sincroniza productos (simple) y kits activos desde Alegra a SQLite."""
    if en_hilo:
        with _sync_lock:
            if _sync_estado.get("running"):
                return {"ok": True, "started": False, "mensaje": "Sync ya en curso", **estado_sync()}
            _sync_estado.update({
                "running": True,
                "started_at": _now_iso(),
                "finished_at": None,
                "ok": None,
                "error": None,
                "productos": 0,
                "kits": 0,
                "total": 0,
                "mensaje": "Sincronizando…",
            })

        def _run():
            try:
                sincronizar_catalogo_alegra(en_hilo=False)
            except Exception as e:
                with _sync_lock:
                    _sync_estado.update({
                        "running": False,
                        "finished_at": _now_iso(),
                        "ok": False,
                        "error": str(e),
                        "mensaje": f"Error: {e}",
                    })

        from app.observability import spawn_thread

        spawn_thread(_run)
        # estado_sync() trae ok=None mientras corre; no debe pisar ok=True de esta respuesta.
        return {
            **estado_sync(),
            "ok": True,
            "started": True,
            "mensaje": "Sync iniciada",
        }

    with _sync_lock:
        _sync_estado.update({
            "running": True,
            "started_at": _sync_estado.get("started_at") or _now_iso(),
            "finished_at": None,
            "ok": None,
            "error": None,
            "mensaje": "Sincronizando…",
        })

    try:
        # Alegra: type=simple (productos) y type=kit
        productos_raw = _paginar_items_alegra(tipo="simple")
        kits_raw = _paginar_items_alegra(tipo="kit")
        now = _now_iso()
        n_prod = 0
        n_kit = 0
        for raw in productos_raw:
            if (raw.get("status") or "active") != "active":
                continue
            upsert_item_desde_alegra(raw)
            n_prod += 1
        for raw in kits_raw:
            if (raw.get("status") or "active") != "active":
                continue
            upsert_item_desde_alegra(raw)
            n_kit += 1
        with _sync_lock:
            _sync_estado.update({
                "running": False,
                "finished_at": now,
                "ok": True,
                "error": None,
                "productos": n_prod,
                "kits": n_kit,
                "total": n_prod + n_kit,
                "mensaje": f"OK: {n_prod} productos, {n_kit} combos",
            })
        return {
            **estado_sync(),
            "ok": True,
            "productos": n_prod,
            "kits": n_kit,
            "total": n_prod + n_kit,
            "synced_at": ultima_sync_at(),
        }
    except Exception as e:
        with _sync_lock:
            _sync_estado.update({
                "running": False,
                "finished_at": _now_iso(),
                "ok": False,
                "error": str(e),
                "mensaje": f"Error: {e}",
            })
        return {**estado_sync(), "ok": False, "error": str(e)}
