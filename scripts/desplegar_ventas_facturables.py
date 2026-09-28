#!/usr/bin/env python3
"""
Levanta el cese de actividades con despliegue gradual: solo vuelve a la venta lo que
hoy se puede facturar (27-sep-2026).

    python3 scripts/desplegar_ventas_facturables.py --simular     # qué se reactivaría, sin tocar nada
    python3 scripts/desplegar_ventas_facturables.py --aplicar     # levanta el cese y reactiva solo lo facturable
    python3 scripts/desplegar_ventas_facturables.py --ampliar     # tras enlazar más SKUs: recalcula y reactiva los nuevos
    python3 scripts/desplegar_ventas_facturables.py --notificar   # aviso al grupo de inventario con la lista

  1. Calcula la lista (app/services/despliegue_ventas.py) y la guarda ANTES de tocar MeLi,
     para que la sincronización de stock no reactive nada fuera de ella.
  2. WhatsApp y web vuelven (cese_actividades.json inactivo, sin bandera MANTENIMIENTO);
     la web solo muestra la lista.
  3. MeLi: de las publicaciones que pausó el cese, reactiva solo las de la lista; las
     demás quedan pausadas y anotadas en meli_pausa_global.json (`no_reactivadas`).

Sin LLM. Detalle: docs/agentic/modules/operacion-equipo.md (Y).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

from app.services import cese_actividades as cese  # noqa: E402
from app.services import despliegue_ventas as D  # noqa: E402

FLAG_WEB = os.path.join(REPO, "PAGINA_WEB", "site", "data", "MANTENIMIENTO")


def _pausa_mod():
    spec = importlib.util.spec_from_file_location("pausa_global_meli", os.path.join(REPO, "scripts", "pausa_global_meli.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _resumen(calc: dict) -> None:
    n_pubs = sum(len(v["meli_ids"]) for v in calc["skus"].values())
    print(f"Publicaciones pausadas por el cese: {calc['candidatas']}")
    print(f"  Se reactivan: {n_pubs} publicaciones · {len(calc['skus'])} SKUs")
    print(f"  Siguen pausadas: {len(calc['excluidas'])}")
    for x in calc["excluidas"]:
        print(f"    {x['meli_id']}  {x['sku'] or '—':<22} {x['motivo']} · {x['titulo'][:50]}")


def _levantar_cese() -> None:
    data = cese.estado()
    if data.get("activa"):
        data["activa"] = False
        data["hasta"] = datetime.now().isoformat(timespec="seconds")
        tmp = cese.ARCHIVO + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, cese.ARCHIVO)
    try:
        os.remove(FLAG_WEB)
    except FileNotFoundError:
        pass
    print("WhatsApp y web: de vuelta (la web solo muestra lo desplegado)")


def _reactivar(ids: list[str], pm) -> dict:
    if not ids:
        return {}
    h = pm._headers()
    print(f"Reactivando {len(ids)} publicaciones…")
    return pm._cambiar(ids, "active", h)


def aplicar(ampliar: bool = False) -> None:
    calc = D.calcular()
    _resumen(calc)
    D.guardar(calc, usuario=os.getenv("USER", ""))  # la lista queda escrita ANTES de reactivar

    pm = _pausa_mod()
    pausa = pm._leer()
    if not ampliar:
        _levantar_cese()
        pausa["activa"] = False
        pausa["reactivada"] = datetime.now().isoformat(timespec="seconds")
        pausa["reactivacion_por_despliegue"] = True
    permitidos = {m for v in calc["skus"].values() for m in v["meli_ids"]}
    ya = {k for k, v in (pausa.get("resultado_reactivacion") or {}).items() if v == "ok"}
    ids = sorted(permitidos - ya) if ampliar else sorted(permitidos)
    pausa["no_reactivadas"] = calc["excluidas"]
    pm._guardar(pausa)

    res = _reactivar(ids, pm)
    pausa = pm._leer()
    pausa.setdefault("resultado_reactivacion", {}).update(res)
    pm._guardar(pausa)
    fallos = {k: v for k, v in res.items() if v != "ok"}
    print(f"Reactivadas: {len(res) - len(fallos)} · fallos: {len(fallos)}")
    for k, v in fallos.items():
        print(f"  {k}: {v}")


def texto_aviso() -> str:
    data = D.estado()
    skus = data.get("skus") or {}
    pausa = _pausa_mod()._leer()
    res = pausa.get("resultado_reactivacion") or {}
    fallidas = {k for k, v in res.items() if v != "ok"}
    filas = []
    for sku, info in sorted(skus.items(), key=lambda kv: (kv[1].get("nombre") or kv[0]).lower()):
        if info.get("meli_ids") and all(m in fallidas for m in info["meli_ids"]):
            continue
        filas.append(f"• {(info.get('nombre') or sku).strip()} ({sku})")
    excl = data.get("excluidas") or []
    partes = [
        "✅ *Retomamos ventas — despliegue gradual*",
        "",
        "Se levantó el cese de actividades. WhatsApp y la página web vuelven a atender, y en "
        "Mercado Libre y la web quedan activos *solo los productos que hoy se pueden facturar* "
        "(SKU enlazado en Alegra). Fotos o documentación técnica pendiente no los frena.",
        "",
        f"*{len(filas)} productos a la venta* en Mercado Libre (y en la página web los que ya tienen ficha allí):",
        *filas,
    ]
    sin_stock = sorted({sku for sku, info in skus.items()
                        if info.get("meli_ids") and all(m in fallidas for m in info["meli_ids"])})
    if sin_stock:
        partes += ["", "📦 Se pueden facturar pero MeLi no las reactivó por falta de stock: "
                   + ", ".join(sin_stock) + ". Vuelven solas al cargar inventario."]
    if excl:
        partes += [
            "",
            f"⏸️ Siguen pausadas {len(excl)} publicaciones porque su SKU no se factura todavía:",
            *[f"• {(x.get('titulo') or x.get('meli_id'))[:60]} ({x.get('sku') or 'sin SKU'})" for x in excl],
        ]
    partes += [
        "",
        "En Cotizar/Facturar (ventas por WhatsApp) solo se pueden cotizar estos productos. "
        "En /app → Diseño de producto → Árbol del producto cada presentación dice si está «A la venta».",
    ]
    return "\n".join(partes)


def notificar() -> None:
    from app.utils import enviar_whatsapp_reporte, jid_grupo_inventario_wa

    if not D.activo():
        sys.exit("No hay despliegue activo: nada que anunciar.")
    texto = texto_aviso()
    if os.getenv("DESPLIEGUE_SKIP_WA") == "1":
        print(texto)
        return
    ok = enviar_whatsapp_reporte(texto, jid_grupo_inventario_wa())
    print("Aviso enviado al grupo de inventario" if ok else "No se pudo enviar el aviso")


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--simular", action="store_true")
    g.add_argument("--aplicar", action="store_true")
    g.add_argument("--ampliar", action="store_true")
    g.add_argument("--notificar", action="store_true")
    a = ap.parse_args()
    if a.simular:
        _resumen(D.calcular())
    elif a.aplicar:
        aplicar()
    elif a.ampliar:
        aplicar(ampliar=True)
    else:
        notificar()


if __name__ == "__main__":
    main()
