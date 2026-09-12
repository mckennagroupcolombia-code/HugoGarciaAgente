# -*- coding: utf-8 -*-
"""Pedido consolidado a proveedores para las fichas marcadas como vacias.

Agrupa por proveedor cuando consta en una factura (`_proveedor_factura`); si no,
por familia de producto, porque un mismo proveedor surte toda la familia.

Correr:  sudo -n -u mckg python3 scripts/pedido_proveedores_fichas.py
Escribe: docs/pedido_proveedores_fichas.md
"""
import glob, json, os, re, unicodedata, yaml

RAIZ = "/home/mckg/mi-agente"
D = os.path.join(RAIZ, "fichas_word", "datos")
STOCK = os.path.join(RAIZ, "app", "data", "siigo_stock_cache.json")
SALIDA = os.path.join(RAIZ, "docs", "pedido_proveedores_fichas.md")

COMUN = [
    "SDS (hoja de seguridad) vigente, con la seccion 2 completa: pictogramas, palabra de advertencia, frases H y P.",
    "COA del lote que nos despacharon, con los parametros que certifican.",
    "CAS y numero EC/EINECS que ustedes declaran para el producto.",
]


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s)).strip()


STOP = {"DE", "DEL", "LA", "EL", "EN", "SIN", "Y", "A", "CON"}
def toks(s):
    return {t for t in norm(s).split() if t not in STOP and len(t) > 1}


def familia(titulo):
    t = norm(titulo)
    if t.startswith("ACEITE ESENCIAL"):
        return "Aceites esenciales"
    if t.startswith("ACEITE"):
        return "Aceites vegetales"
    if "ARCILLA" in t:
        return "Arcillas y minerales"
    return "Otros insumos"


def catalogo():
    try:
        por = json.load(open(STOCK, encoding="utf-8"))["por_codigo"]
    except Exception:
        return []
    return [(c, v.get("nombre", ""), toks(v.get("nombre", ""))) for c, v in por.items()]


def sku_de(titulo, prods):
    ts = toks(titulo)
    mejor = None
    for code, nom, ns in prods:
        if not ts or not ns:
            continue
        sc = len(ts & ns) / len(ts)
        if sc >= 0.75 and (mejor is None or sc > mejor[0]):
            mejor = (sc, code, nom)
    return (mejor[1], mejor[2]) if mejor else ("", "")


def main():
    prods = catalogo()
    fichas = []
    for p in sorted(glob.glob(os.path.join(D, "*.yaml"))):
        d = yaml.safe_load(open(p, encoding="utf-8")) or {}
        if d.get("_estado") != "vacio":
            continue
        t = d.get("titulo", "")
        code, nom = sku_de(t, prods)
        pf = d.get("_proveedor_factura") or {}
        fichas.append({
            "titulo": t,
            "sku": code,
            "producto": nom,
            "proveedor": pf.get("proveedor", ""),
            "factura_fecha": pf.get("fecha", ""),
            "pedido": [str(x) for x in (d.get("_pedido_proveedor") or [])],
            "familia": familia(t),
        })

    grupos = {}
    for f in fichas:
        clave = f["proveedor"] or ("%s — proveedor por confirmar" % f["familia"])
        grupos.setdefault(clave, []).append(f)

    L = []
    L.append("# Pedido a proveedores — fichas que no se pueden publicar")
    L.append("")
    L.append("Una seccion por proveedor. Cada producto lista solo lo que falta para poder publicar su "
             "ficha tecnica, su COA y su SDS. Nada de esto se puede deducir ni buscar en fuentes "
             "publicas: o lo manda el proveedor, o la ficha no sale.")
    L.append("")
    L.append("Generado por `scripts/pedido_proveedores_fichas.py` desde las fichas con `_estado: vacio`. "
             "El detalle completo de cada una esta en `docs/fichas_vacias_pendientes.md`.")
    L.append("")
    L.append("**%d productos, %d grupos.**" % (len(fichas), len(grupos)))
    L.append("")
    L.append("## Lo que se pide para todos")
    L.append("")
    for c in COMUN:
        L.append("- [ ] %s" % c)
    L.append("")
    L.append("---")
    L.append("")

    for clave in sorted(grupos, key=lambda k: (k.endswith("por confirmar"), k)):
        items = grupos[clave]
        L.append("## %s" % clave)
        L.append("")
        confirmados = [f for f in items if f["proveedor"]]
        if confirmados:
            L.append("Consta en factura: %s." % ", ".join(
                "%s (%s)" % (f["titulo"], f["factura_fecha"]) for f in confirmados))
            L.append("")
        else:
            L.append("_Sin factura que lo confirme: asignar el proveedor antes de enviar._")
            L.append("")
        L.append("%d producto(s): %s" % (len(items), ", ".join(f["titulo"] for f in items)))
        L.append("")
        for f in items:
            L.append("### %s" % f["titulo"])
            L.append("")
            if f["sku"]:
                L.append("SKU `%s` — %s" % (f["sku"], f["producto"]))
                L.append("")
            if not f["pedido"]:
                L.append("> Falta redactar el pedido de este producto "
                         "(`_pedido_proveedor` en su YAML).")
            for p in f["pedido"]:
                L.append("- [ ] %s" % p)
            L.append("")
        L.append("---")
        L.append("")

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print("escrito:", SALIDA)
    for clave in sorted(grupos):
        print("   %-46s %d" % (clave, len(grupos[clave])))


if __name__ == "__main__":
    main()
