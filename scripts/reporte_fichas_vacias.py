# -*- coding: utf-8 -*-
"""Reporte de fichas marcadas como VACIAS: que dato falta y quien lo tiene que conseguir.

Correr:  sudo -n -u mckg python3 scripts/reporte_fichas_vacias.py
Escribe: docs/fichas_vacias_pendientes.md
"""
import glob, json, os, re, unicodedata, yaml

RAIZ = "/home/mckg/mi-agente"
D = os.path.join(RAIZ, "fichas_word", "datos")
STOCK = os.path.join(RAIZ, "app", "data", "siigo_stock_cache.json")
SALIDA = os.path.join(RAIZ, "docs", "fichas_vacias_pendientes.md")


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s)).strip()


STOP = {"DE", "DEL", "LA", "EL", "EN", "SIN", "Y", "A", "CON"}
def toks(s):
    return {t for t in norm(s).split() if t not in STOP and len(t) > 1}


def catalogo():
    try:
        por_codigo = json.load(open(STOCK, encoding="utf-8"))["por_codigo"]
    except Exception:
        return []
    return [(c, v.get("nombre", ""), toks(v.get("nombre", ""))) for c, v in por_codigo.items()]


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


def _obsoleta(pendiente, ficha):
    """Viñetas que ya no aplican tras vaciar la ficha.

    - 'Cotejar la clasificación GHS...' hablaba de una clasificación que ya se descartó.
    - 'El producto no aparece en el catálogo...' sobra cuando sí se le encontró SKU.
    """
    t = pendiente.strip().lower()
    if t.startswith("cotejar la clasificaci"):
        return True
    if t.startswith("el producto no aparece en el cat") and ficha.get("sku"):
        return True
    return False


def main():
    prods = catalogo()
    vacias = []
    for f in sorted(glob.glob(os.path.join(D, "*.yaml"))):
        d = yaml.safe_load(open(f, encoding="utf-8")) or {}
        if d.get("_estado") != "vacio":
            continue
        t = d.get("titulo", "")
        code, nom = sku_de(t, prods)
        vacias.append({
            "archivo": os.path.basename(f),
            "titulo": t,
            "sku": code,
            "producto": nom,
            "motivo": d.get("_vacio_motivo", ""),
            "pendientes": d.get("_vacio_pendientes") or [],
            "vacios": [k for k in ("cas", "sinonimos", "composicion", "grado")
                       if d.get(k) in ("", [], None)],
            "ghs_descartado": d.get("_ghs_derivado_descartado") or {},
        })

    L = []
    L.append("# Fichas vacías — pendientes de una persona")
    L.append("")
    L.append("Fichas cuyo dato estaba equivocado y no tiene fuente verificable. El campo se dejó **vacío** "
             "a propósito: no se inventa ni se deja el valor incorrecto. No cuentan como ficha completa, "
             "ni como borrador, ni como ficha antigua pendiente de convertir.")
    L.append("")
    L.append("Generado por `scripts/reporte_fichas_vacias.py`. No editar a mano: los datos viven en "
             "`fichas_word/datos/*.yaml` bajo las claves `_estado`, `_vacio_motivo` y `_vacio_pendientes`.")
    L.append("")
    L.append("**Total: %d**" % len(vacias))
    L.append("")
    for v in vacias:
        L.append("## %s" % v["titulo"])
        L.append("")
        if v["sku"]:
            L.append("- **Producto en catálogo:** %s (`%s`)" % (v["producto"], v["sku"]))
        else:
            L.append("- **Producto en catálogo:** sin coincidencia — confirmar si se sigue vendiendo")
        L.append("- **Archivo:** `fichas_word/datos/%s`" % v["archivo"])
        if v["vacios"]:
            L.append("- **Campos vacíos:** %s" % ", ".join("`%s`" % c for c in v["vacios"]))
        L.append("- **Por qué:** %s" % v["motivo"])
        L.append("")
        L.append("**Qué hay que conseguir:**")
        L.append("")
        for p in v["pendientes"]:
            if _obsoleta(p, v):
                continue
            L.append("- [ ] %s" % p)
        L.append("")
        g = v["ghs_descartado"]
        if g.get("clasificacion") or g.get("pictogramas"):
            L.append("<details><summary>Clasificación GHS que traía, descartada por deducirse de %s"
                     " — sirve para contrastar con la del proveedor</summary>" % g.get("derivado_de", "?"))
            L.append("")
            if g.get("clasificacion"):
                L.append("**Clasificación:** %s" % g["clasificacion"])
                L.append("")
            if g.get("pictogramas"):
                L.append("```")
                L.append(str(g["pictogramas"]).rstrip())
                L.append("```")
            L.append("")
            L.append("</details>")
            L.append("")

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print("escrito:", SALIDA, "(%d fichas)" % len(vacias))


if __name__ == "__main__":
    main()
