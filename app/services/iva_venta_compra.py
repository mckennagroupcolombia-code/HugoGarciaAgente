"""
IVA de venta = el IVA que cobra el proveedor (regla de Armando, 6/7-oct-2026).

Lo que McKenna reempaca sin transformar se vende con la tarifa que trae la factura de
compra: la ley la fija por producto (Art. 424 / 468-1 E.T.), no por el empaque. Cobrar 19 %
a algo excluido o al 5 % es IVA de más al cliente; cobrar de menos es IVA que se debe.

De dónde sale la tarifa: `cc_compras_iva_sku` (pagos_proveedor.aprender_iva_compra), que
solo se llena cuando el total de la compra CUADRA con el documento — ahí cada tarifa quedó
probada. Cada vez que se aprende una, `al_aprender()` la pasa al IVA de venta en Alegra:

- a la materia prima (ítem de inventario con ese código) y
- a cada combo cuya ÚNICA materia prima es esa (el resto de la receta es empaque).

Lo que NO se toca solo:
- fórmulas y kits que mezclan varias materias primas (son un producto transformado);
- un 0 % de un proveedor que nunca cobra 19 % (no responsable de IVA: su 0 % no dice la
  tarifa del producto — p. ej. los collares comprados a una persona natural);
- un cambio de tarifa del mismo insumo (antes se compraba al 19 % y ahora al 0 %): puede
  ser otro proveedor o un error de factura → aviso al grupo, sin cambiar nada.

Sin LLM. `IVA_VENTA_COMPRA_ACTIVO=0` apaga el cambio automático (el aviso sigue).
CLI de revisión: `python3 scripts/iva_venta_por_compra.py` (vista previa; `--aplicar`).
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_LOG = REPO / "app" / "data" / "iva_venta_compra_log.jsonl"

# Impuestos de Alegra (GET /taxes): 1 exento 0 %, 2 excluido 0 %, 3 IVA 5 %, 4 IVA 19 %.
# Una línea de compra sin IVA va a «excluido» (el XML no trae TaxTotal), como el 6-oct.
TAX_ID = {19.0: "4", 5.0: "3", 0.0: "2"}
TAX_NOMBRE = {"4": "IVA 19 %", "3": "IVA 5 %", "2": "Excluido", "1": "Exento"}
_lock = threading.Lock()


def activo() -> bool:
    return os.getenv("IVA_VENTA_COMPRA_ACTIVO", "1").strip() != "0"


def _tax_id(pct: float) -> str | None:
    return TAX_ID.get(round(float(pct or 0), 0))


def _auditoria():
    from app.services.mapa_producto import _auditoria as a

    return a()


def _materias_primas(componentes: list[dict], A) -> set[str]:
    """Códigos de la receta que no son empaque, insumo operativo ni servicio."""
    out = set()
    for c in componentes or []:
        cod = (c.get("codigo") or "").strip()
        if not cod or cod.upper().startswith(("OPR", "WEB-")):
            continue
        nombre = c.get("nombre") or ""
        if A.es_empaque(nombre, cod) or A._primera(nombre) in A._NO_MATERIA:
            continue
        out.add(cod.upper())
    return out


def _catalogo() -> tuple[dict[str, dict], dict[str, float | None]]:
    """Ítems activos de la copia local de Alegra y su tarifa de IVA actual."""
    from app.services import alegra_catalogo_db as ac
    from app.services import contabilidad_db as cdb

    items: dict[str, dict] = {}
    off = 0
    while True:
        r = ac.listar_items(limit=500, offset=off, solo_activos=True)
        lote = r.get("items") if isinstance(r, dict) else r
        if not lote:
            break
        for it in lote:
            items[(it.get("reference") or "").upper()] = it
        off += len(lote)
        if len(lote) < 500:
            break
    with cdb._conn() as con:
        tasas = {(r[0] or "").upper(): r[1] for r in con.execute("SELECT reference, iva_pct FROM alegra_items")}
        nombres = {(r[0] or "").upper(): r[1] or "" for r in con.execute("SELECT reference, name FROM alegra_items")}
        # `listar_items` no trae la receta: sale de la tabla de componentes.
        for kit, comp in con.execute("SELECT kit_reference, component_reference FROM alegra_kit_components"):
            it = items.get((kit or "").upper())
            if it is not None:
                it.setdefault("componentes", []).append(
                    {"codigo": comp or "", "nombre": nombres.get((comp or "").upper(), "")})
    return items, tasas


_SOCIEDAD = {"LTDA", "LIMITADA", "SAS", "SA", "S", "A", "CIA", "Y", "DE", "EN", "C", "COLOMBIA"}


def _prov(nombre: str) -> str:
    """«QUIMICA INTERKROL LTDA» y «QUIMICA INTERKROL LIMITADA» son el mismo proveedor."""
    import re

    toks = re.split(r"[^A-Z0-9]+", (nombre or "").upper())
    return " ".join(t for t in toks if t and t not in _SOCIEDAD)


def _proveedores_responsables(aprendido: dict[str, dict]) -> set[str]:
    """Quien cobra IVA (5 o 19 %) en alguna compra es responsable: su 0 % sí dice algo."""
    return {_prov(v.get("ultimo_proveedor") or "")
            for v in aprendido.values() if float(v.get("iva_pct") or 0) > 0}


def plan(skus: list[str] | None = None, *, previos: dict[str, float | None] | None = None) -> dict:
    """Qué ítems de Alegra deben cambiar de IVA según lo que cobra el proveedor.

    `skus`: solo esos códigos de compra (None = todos los aprendidos).
    `previos`: tarifa de compra que había antes de esta compra, para detectar cambios.
    """
    from app.services.pagos_proveedor import iva_compras_conocido

    aprendido = {k.upper(): {**v, "sku": k} for k, v in iva_compras_conocido().items()}
    responsables = _proveedores_responsables(aprendido)
    items, tasas = _catalogo()
    A = _auditoria()

    mp_de_combo: dict[str, set[str]] = {}
    for ref, it in items.items():
        if (it.get("type") or "") == "kit":
            mp_de_combo[ref] = _materias_primas(it.get("componentes") or [], A)

    objetivo = [s.upper() for s in skus] if skus else sorted(aprendido)
    cambios, omitidos = [], []
    for sku in objetivo:
        info = aprendido.get(sku)
        if not info:
            continue
        pct = float(info.get("iva_pct") or 0)
        prov = (info.get("ultimo_proveedor") or "").strip()
        base = {"compra": info.get("sku") or sku, "iva_compra": pct, "proveedor": prov, "fecha": info.get("ultima_fecha") or ""}
        tax = _tax_id(pct)
        if tax is None:
            omitidos.append({**base, "motivo": f"tarifa de compra {pct:g} % sin equivalente en Alegra"})
            continue
        if pct == 0 and _prov(prov) not in responsables:
            omitidos.append({**base, "motivo": "el proveedor nunca cobra IVA: su 0 % no dice la tarifa del producto"})
            continue
        previo = (previos or {}).get(sku)
        if previo is not None and round(previo) != round(pct):
            omitidos.append({**base, "motivo": f"el insumo se compraba al {previo:g} % y ahora al {pct:g} %: revisar a mano",
                             "cambio_de_tarifa": True})
            continue

        destinos = []
        it = items.get(sku)
        if it and A.es_empaque(it.get("name") or "", it.get("reference") or sku):
            continue  # bolsas, etiquetas, tapas…: no se venden, su IVA de venta no importa
        if it and (it.get("type") or "") != "kit":
            destinos.append((it.get("reference") or sku, "materia prima"))
        for ref, mps in mp_de_combo.items():
            if sku not in mps:
                continue
            if mps == {sku}:
                destinos.append((items[ref].get("reference") or ref, "combo"))
            else:
                omitidos.append({**base, "ref": items[ref].get("reference") or ref,
                                 "motivo": "mezcla de varias materias primas (producto transformado): se queda como está"})
        for ref, tipo in destinos:
            actual = tasas.get(ref.upper())
            if actual is not None and round(float(actual)) == round(pct):
                continue
            cambios.append({**base, "ref": ref, "tipo": tipo,
                            "iva_venta_actual": actual, "tax_id": tax, "a": TAX_NOMBRE[tax]})
    return {"cambios": cambios, "omitidos": omitidos}


def _leer_alegra(ref: str) -> dict:
    import requests

    from app.services import alegra

    h = alegra._alegra_headers()
    for intento in range(3):
        try:
            g = requests.get(f"{alegra._ALEGRA_BASE}/items", headers=h,
                             params={"reference": ref, "limit": 30}, timeout=20).json()
            x = alegra._solo_referencia_exacta(g, ref)
            activos = [i for i in x if (i.get("status") or "active") == "active"]
            return (activos or x or [{}])[0]
        except Exception:
            if intento == 2:
                raise
            time.sleep(2)
    return {}


def _huella(it: dict) -> dict:
    """Todo lo que NO debe cambiar al tocar el IVA (un PUT a Alegra reemplaza, no es parcial)."""
    return {
        "name": it.get("name"), "status": it.get("status"), "type": it.get("type"),
        "price": [p.get("price") for p in it.get("price") or []],
        "unit": (it.get("inventory") or {}).get("unit"),
        "kit": [((k.get("item") or {}).get("id") if isinstance(k.get("item"), dict) else k.get("id"), k.get("quantity"))
                for k in (it.get("kitComponents") or it.get("subitems") or [])],
    }


def _registrar(evento: dict) -> None:
    try:
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), **evento},
                               ensure_ascii=False) + "\n")
    except OSError:
        pass


def aplicar(cambios: list[dict], *, por: str = "") -> list[dict]:
    """PUT del impuesto en Alegra, relectura y espejo local. Si algo más que el IVA cambió,
    o la relectura no muestra la tarifa nueva, el ítem queda marcado para revisar."""
    import requests

    from app.services import alegra
    from app.services import alegra_catalogo_db as ac

    h = alegra._alegra_headers()
    hechos = []
    with _lock:
        for c in cambios:
            ref = c["ref"]
            r: dict = {**c, "por": por}
            try:
                antes = _leer_alegra(ref)
                if not antes.get("id"):
                    r.update(ok=False, error="no está en Alegra")
                elif [str(t.get("id")) for t in antes.get("tax") or []] == [c["tax_id"]]:
                    r.update(ok=True, ya_estaba=True)
                else:
                    put = requests.put(f"{alegra._ALEGRA_BASE}/items/{antes['id']}", headers=h,
                                       json={"tax": [{"id": int(c["tax_id"])}]}, timeout=25)
                    time.sleep(0.5)
                    despues = _leer_alegra(ref)
                    tax_ahora = [str(t.get("id")) for t in despues.get("tax") or []]
                    otros = {k: (v, _huella(despues)[k]) for k, v in _huella(antes).items() if _huella(despues)[k] != v}
                    r.update(ok=put.status_code == 200 and tax_ahora == [c["tax_id"]] and not otros,
                             http=put.status_code, antes=[str(t.get("id")) for t in antes.get("tax") or []],
                             despues=tax_ahora, otros_cambios=otros,
                             error="" if put.status_code == 200 else (put.text or "")[:200])
                    if despues.get("id"):
                        local = ac.obtener_item(ref)
                        ac.upsert_item_desde_alegra(despues, (local or {}).get("componentes"))
                alegra._producto_cache.pop(ref, None)
            except Exception as e:
                r.update(ok=False, error=str(e)[:200])
            _registrar({"evento": "cambio_iva", **r})
            hechos.append(r)
    return hechos


def _avisar(hechos: list[dict], omitidos: list[dict], *, proveedor: str = "") -> None:
    lineas = []
    for h in hechos:
        if h.get("ya_estaba"):
            continue
        marca = "✅" if h.get("ok") else ("⏸ pendiente (cambio automático apagado)" if h.get("pendiente") else "⚠️ revisar")
        lineas.append(f"{marca} {h['ref']} ({h['tipo']}) → {h['a']}")
    for o in omitidos:
        if o.get("cambio_de_tarifa"):
            lineas.append(f"⚠️ {o['compra']}: {o['motivo']}")
    if not lineas:
        return
    texto = ("🧾 *IVA de venta según la compra*\n"
             f"{proveedor or 'Compra'} cobró estas tarifas y el IVA de venta en Alegra se ajusta a ellas:\n\n"
             + "\n".join(lineas[:30])
             + "\n\nEl precio de lista no cambia (ya incluye el IVA). Lo facturado antes se habla con el contador.")
    if os.getenv("IVA_VENTA_COMPRA_SKIP_WA", "0") == "1":
        print(texto, flush=True)
        return
    try:
        from app.utils import enviar_whatsapp_reporte, jid_grupo_facturacion_ventas_wa

        enviar_whatsapp_reporte(texto, numero_destino=jid_grupo_facturacion_ventas_wa())
    except Exception as e:
        print(f"⚠️ IVA de venta por compra: no se pudo avisar ({e})", flush=True)


def _procesar(aprendidos: list[dict], proveedor: str) -> None:
    previos = {a["sku"].upper(): a.get("previo") for a in aprendidos}
    p = plan([a["sku"] for a in aprendidos], previos=previos)
    if activo():
        hechos = aplicar(p["cambios"], por="compra:" + (proveedor or ""))
    else:
        hechos = [{**c, "ok": False, "pendiente": True} for c in p["cambios"]]
        for c in p["cambios"]:
            _registrar({"evento": "pendiente_apagado", **c})
    _avisar(hechos, p["omitidos"], proveedor=proveedor)


def al_aprender(aprendidos: list[dict], *, proveedor: str = "", fecha: str = "", en_hilo: bool = True) -> None:
    """Gancho de `aprender_iva_compra`: [{sku, iva_pct, previo}] → IVA de venta en Alegra."""
    if not aprendidos:
        return
    if en_hilo:
        threading.Thread(target=_procesar, args=(aprendidos, proveedor), daemon=True,
                         name="iva-venta-compra").start()
    else:
        _procesar(aprendidos, proveedor)
