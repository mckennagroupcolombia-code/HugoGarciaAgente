#!/usr/bin/env python3
"""Propone pasar a anticipo (133005) una compra que se contabilizó al girar la cotización.

Caso (6-oct-2026): los asientos #7965 (Factores, solicitud #62) y #7964
(Comercializadora, #65) cargaron a 1435 + 240810 lo COTIZADO al momento del giro;
la factura vino distinta y no hay contra qué cruzarla. El ajuste:

    Débito 133005 (tercero)   = inventario + IVA del asiento
    Crédito 1435 por renglón  / Crédito 240810

y, si el extracto muestra otro valor que el libro (--banco-real), corrige Bancos
contra el anticipo: lo que no salió del banco tampoco es plata a favor.

Por defecto SOLO MUESTRA. `--aplicar` postea el ajuste, marca la solicitud como
anticipo (queda en «por legalizar») y la espeja a Alegra.

    python3 scripts/reclasificar_compra_a_anticipo.py 7965
    python3 scripts/reclasificar_compra_a_anticipo.py 7964 --banco-real 425455
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:   # sin el .env el espejo a Alegra falla por credenciales (6-oct-2026, asiento #9108)
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
except ImportError:
    pass


def proponer(mov_id: int, banco_real: float | None) -> dict:
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    mov = cc.obtener_movimiento(mov_id)
    if not mov:
        raise SystemExit(f"Asiento #{mov_id} no existe")
    if mov.get("estado") == "anulado":
        raise SystemExit(f"Asiento #{mov_id} está anulado")
    pd = json.loads(mov.get("plantilla_datos_json") or "{}")
    sid = pd.get("solicitud_id")
    tid = mov.get("tercero_id")
    compra = [l for l in mov["lineas"] if l["cuenta_codigo"] in ("1435", "240810") and l["debito"] > 0]
    if not compra:
        raise SystemExit(f"Asiento #{mov_id} no tiene inventario ni IVA que reclasificar")
    total = round(sum(l["debito"] for l in compra), 2)
    lineas = [{"cuenta_id": pw._asegurar_cuenta_anticipos(), "cuenta_codigo": "133005", "debito": total,
               "credito": 0, "tercero_id": tid,
               "descripcion": f"Reclasifica a anticipo el giro del asiento #{mov_id} (sin factura todavía)"}]
    lineas += [{"cuenta_id": l["cuenta_id"], "cuenta_codigo": l["cuenta_codigo"], "debito": 0,
                "credito": l["debito"], "tercero_id": tid,
                "descripcion": f"Reversa: {l['descripcion']}"} for l in compra]
    banco_libro = round(sum(l["credito"] - l["debito"] for l in mov["lineas"] if l["cuenta_codigo"] == "1110"), 2)
    dif_banco = 0.0
    if banco_real is not None:
        dif_banco = round(banco_libro - float(banco_real), 2)
        if abs(dif_banco) >= 0.01:
            id_banco = next(l["cuenta_id"] for l in mov["lineas"] if l["cuenta_codigo"] == "1110")
            lineas.append({"cuenta_id": id_banco, "cuenta_codigo": "1110",
                           "debito": dif_banco if dif_banco > 0 else 0, "credito": -dif_banco if dif_banco < 0 else 0,
                           "descripcion": f"Corrige Bancos: el extracto muestra {_fmt(banco_real)}, el libro {_fmt(banco_libro)}"})
            lineas.append({"cuenta_id": pw._asegurar_cuenta_anticipos(), "cuenta_codigo": "133005",
                           "debito": -dif_banco if dif_banco < 0 else 0, "credito": dif_banco if dif_banco > 0 else 0,
                           "tercero_id": tid,
                           "descripcion": "Lo que no salió del banco tampoco es anticipo"})
    return {"movimiento": mov, "solicitud_id": sid, "lineas": lineas, "banco_libro": banco_libro,
            "dif_banco": dif_banco}


def _fmt(v: float) -> str:
    return f"{v:,.0f}".replace(",", ".")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("asiento", type=int)
    ap.add_argument("--banco-real", type=float, default=None, help="Valor que muestra el extracto")
    ap.add_argument("--fecha", default="", help="Fecha del ajuste (por defecto la del asiento)")
    ap.add_argument("--aplicar", action="store_true", help="Postear el ajuste (sin esto solo muestra)")
    a = ap.parse_args()

    p = proponer(a.asiento, a.banco_real)
    mov = p["movimiento"]
    print(f"\nAsiento #{mov['id']} · {mov['fecha']} · {mov['concepto']}  (solicitud #{p['solicitud_id']})")
    print("  Como está hoy:")
    for l in mov["lineas"]:
        print(f"    {l['cuenta_codigo']:<7} D {_fmt(l['debito']):>12}  C {_fmt(l['credito']):>12}  {l['descripcion'][:60]}")
    print("  Ajuste propuesto:")
    for l in p["lineas"]:
        print(f"    {l['cuenta_codigo']:<7} D {_fmt(l['debito']):>12}  C {_fmt(l['credito']):>12}  {l['descripcion'][:70]}")
    d = sum(l["debito"] for l in p["lineas"]); c = sum(l["credito"] for l in p["lineas"])
    print(f"  Débitos {_fmt(d)} · Créditos {_fmt(c)} · {'cuadra' if abs(d - c) < 0.01 else 'NO CUADRA'}")
    if not a.aplicar:
        print("  (vista previa — no se posteó nada; --aplicar para registrarlo)")
        return

    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard as pw

    nuevo = cc.crear_movimiento(
        fecha=a.fecha or mov["fecha"],
        concepto=f"Reclasificación a anticipo del asiento #{mov['id']} — se legaliza con la factura",
        lineas=[{k: l[k] for k in ("cuenta_id", "debito", "credito", "descripcion") if k in l}
                | ({"tercero_id": l["tercero_id"]} if l.get("tercero_id") else {}) for l in p["lineas"]],
        tercero_id=mov.get("tercero_id"), referencia=f"reclasifica:{mov['id']}",
        tipo_origen="reclasificacion_anticipo",
        plantilla_datos={"reclasifica_movimiento_id": mov["id"], "solicitud_id_anticipo": p["solicitud_id"]},
    )
    if p["solicitud_id"]:
        with pw._conn() as con:
            con.execute("UPDATE cc_solicitudes_pago SET es_anticipo=1 WHERE id=?", (int(p["solicitud_id"]),))
    try:
        from app.services.alegra_espejo import espejar_movimiento

        print("  Alegra:", espejar_movimiento(nuevo["id"], forzar=True).get("status"))
    except Exception as e:
        print("  Alegra: error", e)
    print(f"  ✅ Ajuste posteado: asiento #{nuevo['id']}")


if __name__ == "__main__":
    main()
