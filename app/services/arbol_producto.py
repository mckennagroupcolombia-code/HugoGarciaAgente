"""
Árbol del producto — Studio (Diseño) → «Árbol del producto».

Categoría → familia (materia prima) → presentación (combo C-…) → piezas.

No calcula nada nuevo: junta lo que ya producen el taller de combos
(`mapa_producto.anatomia_combos`: receta, documento, EAN, etiqueta con sus dos PNG,
foto), Canales del producto (`canales_producto.tabla_maestra`: MeLi, web y si el
SKU se puede facturar en Alegra, contra la copia local) y la revisión de pesos y
medidas (`revision_empaque.resumen_por_sku`: el paquete de envío que MeLi pide). Así
el árbol, el taller, Canales y la solicitud no pueden contar distinto. Solo lectura,
sin LLM y sin llamadas vivas.

La categoría es la `linea` del combo, la misma regla de la web
(`website._combo_category_from_siigo`, vía `mapa_producto._categoria_web`).
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

SIN_CATEGORIA = "Sin categoría en la web"

# Las piezas de una presentación, en el orden en que se leen en el árbol. «envio» = peso y
# medidas del paquete listo para despachar (lo que MeLi pide como SELLER_PACKAGE_*).
PIEZAS = ("etiquetas", "fotos", "ean", "receta", "envio", "factura", "meli", "web")

CANALES_FOTO = (("web", "web"), ("meli", "MeLi"))

# Carpetas de ETIQUETAS STUDIO que en la web tienen otro nombre de sección.
_CARPETA_A_CATEGORIA = {"Semillas & Frutos Secos": "Frutos secos y semillas"}
# Secciones de la web que en el árbol van con el nombre de su línea comercial.
_SECCION_A_CATEGORIA = {"Agrícola": "Agro"}


def _u(s: Any) -> str:
    return str(s or "").strip().upper()


def _pieza(estado: str, detalle: str, **extra) -> dict:
    return {"estado": estado if estado in ("ok", "aviso", "falta") else "falta", "detalle": detalle, **extra}


def _etiquetas(esl: dict) -> dict:
    e = esl.get("etiqueta") or {}
    png = e.get("png") or ""
    digital = e.get("png_digital") or ""
    extra = {
        "png": png,
        "png_digital": digital,
        "aprobado_at": e.get("aprobado_at") or "",
        "etiqueta_id": e.get("etiqueta_id") or "",
        "tamano": e.get("tamano") or "",
        "categoria_png": _carpeta(png or digital),
    }
    if e.get("estado") == "falta" or not e.get("etiqueta_id"):
        return _pieza("falta", e.get("detalle") or "Sin diseño de etiqueta.", **extra)
    if not png and not digital:
        return _pieza("aviso", "Diseño sin PNG aprobado todavía.", **extra)
    if not digital:
        return _pieza("aviso", "Falta la variante desenfocada (MeLi).", **extra)
    if not png:
        return _pieza("aviso", "Falta la variante nítida (web).", **extra)
    if e.get("estado") != "ok":
        return _pieza(e.get("estado") or "aviso", e.get("detalle") or "", **extra)
    return _pieza("ok", "Web + MeLi", **extra)


def _carpeta(ruta: str) -> str:
    """«ETIQUETAS STUDIO/Conservantes/X.png» → «Conservantes»."""
    partes = [p for p in (ruta or "").replace("\\", "/").split("/") if p]
    return partes[1] if len(partes) >= 3 else ""


def _fotos(c: dict, esl: dict, fotos: dict | None) -> dict:
    """Sin foto de producto con la etiqueta vigente no se publica bien: la pieza se completa
    con una foto por canal (web y MeLi) posterior a la aprobación de la etiqueta. Las fotos se
    pegan en el Árbol o en Espacio de producto (`fotos_producto`)."""
    aprobado = ((esl.get("etiqueta") or {}).get("aprobado_at") or "")[:19]
    por_canal: dict[str, dict] = {}
    faltan: list[str] = []
    viejas: list[str] = []
    for canal, nombre in CANALES_FOTO:
        d = (fotos or {}).get(canal) or {"n": 0, "ultima": ""}
        vieja = bool(d["n"] and aprobado and (d.get("ultima") or "")[:19] < aprobado)
        por_canal[canal] = {"n": d["n"], "ultima": d.get("ultima") or "", "desactualizada": vieja}
        if not d["n"]:
            faltan.append(nombre)
        elif vieja:
            viejas.append(nombre)
    extra = {"canales": por_canal, "foto_estado": c.get("foto_estado") or ""}
    if not faltan and not viejas:
        return _pieza("ok", "Web y MeLi con la etiqueta vigente", **extra)
    if len(faltan) == len(CANALES_FOTO) and c.get("foto_estado") == "ok":
        return _pieza("ok", "La vitrina ya muestra la etiqueta vigente", **extra)
    if len(faltan) == len(CANALES_FOTO):
        return _pieza("falta", c.get("foto_motivo") or "Sin fotos de producto.", **extra)
    partes = [f"falta la de {n}" for n in faltan] + [f"la de {n} es anterior a la etiqueta" for n in viejas]
    texto = "; ".join(partes)
    return _pieza("aviso", texto[:1].upper() + texto[1:] + ".", **extra)


def _receta(esl: dict) -> dict:
    r = esl.get("receta") or {}
    fis = esl.get("etiqueta_fisica") or {}
    estado = r.get("estado") or "falta"
    detalle = r.get("detalle") or ""
    pieza_taller = "receta"
    if estado == "ok" and fis.get("estado") and fis.get("estado") != "ok":
        estado, detalle, pieza_taller = "aviso", fis.get("detalle") or "La receta no descuenta etiqueta.", "etiqueta_fisica"
    return _pieza(estado, detalle, pieza_taller=pieza_taller)


def _factura(fila: dict | None) -> dict:
    if not fila:
        return _pieza("aviso", "Sin dato de Canales del producto.")
    f = (fila.get("canales") or {}).get("facturable") or {}
    est = f.get("estado")
    if est == "si":
        return _pieza("ok", "El SKU se factura en Alegra.")
    if est == "alias":
        return _pieza("aviso", f"Se factura por su alias «{f.get('alias_destino')}».")
    if est == "inactivo":
        return _pieza("falta", "El código está inactivo en Alegra.")
    return _pieza("falta", "Alegra no tiene este código: la factura falla.")


def _meli(fila: dict | None, esl: dict) -> dict:
    m = ((fila or {}).get("canales") or {}).get("meli") or {}
    pub = esl.get("publicacion") or {}
    mid = m.get("meli_id") or pub.get("meli_id") or ""
    extra = {"meli_id": mid, "permalink": m.get("permalink") or "", "precio": pub.get("precio")}
    est = m.get("estado")
    if m.get("pausada_por_cese"):
        # Canales la cuenta como publicada (estaba activa antes del cese): se dice tal cual.
        return _pieza("ok", f"{mid} · pausada por el cese", pausada_por_cese=True, **extra)
    if est == "publicado":
        return _pieza("ok", f"{mid} activa" if mid else "Publicada", **extra)
    if est == "pausado":
        return _pieza("aviso", f"{mid} pausada", **extra)
    if mid and not fila:
        return _pieza("ok", mid, **extra)
    if mid:
        # La vitrina la enlaza, pero la relación de códigos MeLi ↔ Alegra no la conoce.
        return _pieza("aviso", f"{mid} · sin vínculo en la relación de códigos", **extra)
    return _pieza("aviso", "Sin publicación en MeLi.", **extra)


def _envio(envios: dict | None, ref: Any) -> dict:
    if envios is None:
        return _pieza("aviso", "No se pudo leer la revisión de pesos y medidas.")
    e = envios.get(_u(ref))
    if not e:
        return _pieza("falta", "Sin pesar ni medir el paquete.")
    return _pieza(e["estado"], e["detalle"], **{k: v for k, v in e.items() if k not in ("estado", "detalle")})


def _web(fila: dict | None) -> dict:
    w = ((fila or {}).get("canales") or {}).get("web") or {}
    if w.get("estado") == "publicado":
        if not w.get("buyable"):
            return _pieza("aviso", "En la vitrina, pero no se puede comprar.", cat=w.get("cat") or "")
        return _pieza("ok", "Publicada", cat=w.get("cat") or "", stock=w.get("stock"))
    return _pieza("aviso", "No aparece en la vitrina web.")


def _alegra(fila: dict | None) -> dict:
    a = ((fila or {}).get("canales") or {}).get("alegra") or {}
    est = a.get("estado")
    if est == "ok":
        return _pieza("ok", "Combo activo" if a.get("tipo") == "kit" else "Producto activo (sin combo)")
    if est == "inactivo":
        return _pieza("falta", "Inactivo en Alegra.")
    return _pieza("falta", "No existe en Alegra.")


def _desplegado(ref: str) -> dict | None:
    """Despliegue gradual tras el cese: None si no hay despliegue; si lo hay, dice si
    esta presentación volvió a la venta (MeLi + web) porque se factura."""
    try:
        from app.services import despliegue_ventas

        if not despliegue_ventas.activo():
            return None
        info = despliegue_ventas.info_sku(ref)
    except Exception:
        return None
    if not info:
        return {"activo": False}
    return {"activo": True, "meli_ids": info.get("meli_ids") or [], "desde": info.get("desde")}


def _tam_orden(p: dict) -> tuple:
    """Ordena 50 g < 100 g < 250 g < 1 kg por la cantidad del nombre."""
    txt = f"{p.get('presentacion') or ''} {p.get('nombre') or ''}".upper()
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(KG|K\b|G|GR|ML|L\b|UN)", txt)
    if m:
        n = float(m.group(1).replace(",", "."))
        if m.group(2) in ("KG", "K", "L"):
            n *= 1000
        return (0, n, txt)
    if re.search(r"\bKG\b", txt):
        return (0, 1000.0, txt)
    return (1, 0.0, txt)


def _etiqueta_corta(c: dict) -> str:
    pres = (c.get("presentacion") or "").strip()
    if pres:
        return pres
    m = re.search(r"(\d+(?:[.,]\d+)?\s*(?:KG|G|GR|ML|L|UN)\b|\bKG\b)\s*$", (c.get("nombre") or "").upper())
    return m.group(1).replace("KG", "Kg").replace("GR", "g").replace("G", "g").replace("ML", "mL").strip() if m else c.get("ref") or ""


def _orden_alfa(txt: str) -> str:
    """«Ácidos» entre «Aceites» y «Antisépticos», no después de la Z."""
    return unicodedata.normalize("NFKD", txt or "").encode("ascii", "ignore").decode().lower()


# La tienda web agrupa y nombra sus tarjetas igual que el árbol (familia = materia prima,
# nombre = título del documento técnico). La web no puede calcular el árbol en cada visita
# (~8 s), así que el árbol deja aquí una copia liviana cada vez que se calcula; sin este
# archivo la web vuelve a su agrupación por nombre. Regenerar a mano:
#   python3 -m app.services.arbol_producto --familias-web
FAMILIAS_WEB_FILE = Path(__file__).resolve().parents[2] / "PAGINA_WEB" / "site" / "data" / "familias_arbol.json"


def _guardar_familias_web(categorias: list[dict]) -> None:
    por_ref: dict[str, dict] = {}
    for c in categorias:
        for f in c["familias"]:
            if str(f["clave"]).startswith("solo:"):
                continue
            for p in f["presentaciones"]:
                if p.get("ref"):
                    por_ref[_u(p["ref"])] = {"familia": f["clave"], "nombre": f["nombre"]}
    try:
        tmp = FAMILIAS_WEB_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(por_ref, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        tmp.replace(FAMILIAS_WEB_FILE)
    except OSError:
        pass  # la web sigue con la copia anterior


def arbol(refrescar: bool = False) -> dict:
    from app.services import canales_producto, mapa_producto

    datos = mapa_producto.anatomia_combos(refrescar=refrescar)
    sin_senal: list[dict] = []
    try:
        tabla = canales_producto.tabla_maestra(refrescar=refrescar)
        filas = {_u(f.get("sku")): f for f in tabla.get("filas") or []}
        sin_senal.extend(tabla.get("sin_senal") or [])
    except Exception as exc:  # un árbol sin canales sigue mostrando el taller
        filas = {}
        sin_senal.append({"fuente": "Canales del producto", "error": str(exc)[:160]})

    try:
        from app.services import fotos_producto

        fotos_sku = fotos_producto.por_sku()
    except Exception as exc:
        fotos_sku = {}
        sin_senal.append({"fuente": "Fotos de producto", "error": str(exc)[:160]})

    try:
        from app.services import revision_empaque

        envios = revision_empaque.resumen_por_sku()
    except Exception as exc:
        envios = None
        sin_senal.append({"fuente": "Revisión de pesos y medidas", "error": str(exc)[:160]})

    # Costo de la receta contra el precio publicado (última compra de cada componente).
    try:
        from app.services import costo_receta

        precios_pub = costo_receta.precios_publicados()
        iva_ref = costo_receta.iva_por_ref()
    except Exception as exc:
        costo_receta = None
        precios_pub, iva_ref = {}, {}
        sin_senal.append({"fuente": "Costo de la receta", "error": str(exc)[:160]})

    categorias: dict[str, dict[str, dict]] = {}
    for c in datos.get("combos") or []:
        esl = c.get("eslabones") or {}
        fila = filas.get(_u(c.get("ref")))
        piezas = {
            "etiquetas": _etiquetas(esl),
            "fotos": _fotos(c, esl, fotos_sku.get(_u(c.get("ref")))),
            "ean": _pieza((esl.get("ean") or {}).get("estado") or "falta",
                          (esl.get("ean") or {}).get("detalle") or "",
                          codigo=(esl.get("ean") or {}).get("codigo") or ""),
            "receta": _receta(esl),
            "envio": _envio(envios, c.get("ref")),
            "factura": _factura(fila),
            "meli": _meli(fila, esl),
            "web": _web(fila),
        }
        doc = esl.get("documento") or {}
        ref_u = _u(c.get("ref"))
        pub = precios_pub.get(ref_u) or {}
        precios = {"web": pub.get("web"), "meli": pub.get("meli"),
                   "lista": c.get("precio_lista")}
        costo = None
        if costo_receta:
            try:
                costo = costo_receta.para_presentacion(c.get("componentes") or [], precios, iva_ref.get(ref_u, costo_receta.IVA))
            except Exception as exc:  # una receta rara no tumba el árbol
                costo = {"error": str(exc)[:160]}
        pres = {
            "ref": c.get("ref"),
            "nombre": c.get("nombre"),
            "corto": _etiqueta_corta(c),
            "presentacion": c.get("presentacion") or "",
            "precio_lista": c.get("precio_lista"),
            "precios": precios,
            "costo": costo,
            "foto": c.get("foto"),
            "foto_estado": c.get("foto_estado") or "",
            "foto_motivo": c.get("foto_motivo") or "",
            "alegra": _alegra(fila),
            "desplegado": _desplegado(c.get("ref")),
            "clasificacion": (fila or {}).get("clasificacion") or "",
            "piezas": piezas,
            "listas": sum(1 for p in piezas.values() if p["estado"] == "ok"),
        }
        linea = c.get("linea") or SIN_CATEGORIA
        # Sin publicar en la web, la regla de la tienda deja en «Otros» lo que no reconoce (el
        # jabón potásico, que es Agro). Ahí manda la carpeta del Studio donde está su etiqueta.
        carpeta = piezas["etiquetas"].get("categoria_png") or ""
        if carpeta and not c.get("linea_publicada") and linea in ("Otros", SIN_CATEGORIA):
            linea = _CARPETA_A_CATEGORIA.get(carpeta, carpeta)
        linea = _SECCION_A_CATEGORIA.get(linea, linea)
        mp = next((k for k in c.get("componentes") or [] if k.get("casilla") == "materia_prima"), None)
        clave = c.get("familia") or f"solo:{c.get('ref')}"
        fam = categorias.setdefault(linea, {}).setdefault(clave, {
            "clave": clave,
            "mp_sku": c.get("familia") or (mp or {}).get("codigo") or "",
            "nombre": "",
            "documento": {
                "estado": doc.get("estado") or "falta",
                "detalle": doc.get("detalle") or "",
                "archivo": doc.get("archivo") or "",
                "titulo": doc.get("doc_titulo") or "",
                "pdf_nombre": doc.get("pdf_nombre") or "",
            },
            "presentaciones": [],
        })
        if not fam["nombre"]:
            fam["nombre"] = (doc.get("doc_titulo") or (mp or {}).get("nombre") or c.get("nombre") or "").strip()
        # El documento es de la materia prima: si una presentación lo tiene y otra no, manda el mejor.
        rango = {"ok": 0, "aviso": 1, "falta": 2}
        if rango.get(doc.get("estado") or "falta", 2) < rango.get(fam["documento"]["estado"], 2):
            fam["documento"] = {"estado": doc.get("estado"), "detalle": doc.get("detalle") or "",
                                "archivo": doc.get("archivo") or "", "titulo": doc.get("doc_titulo") or "",
                                "pdf_nombre": doc.get("pdf_nombre") or ""}
        fam["presentaciones"].append(pres)

    salida = []
    for nombre, familias in categorias.items():
        fams = []
        for f in familias.values():
            f["presentaciones"].sort(key=_tam_orden)
            f["completas"] = sum(1 for p in f["presentaciones"] if p["listas"] == len(PIEZAS))
            f["total"] = len(f["presentaciones"])
            f["desplegadas"] = sum(1 for p in f["presentaciones"] if (p.get("desplegado") or {}).get("activo"))
            # Otras carpetas donde quedaron los PNG de esta familia (p. ej. «Aditivos alimentarios»).
            f["carpetas_png"] = sorted({p["piezas"]["etiquetas"].get("categoria_png") for p in f["presentaciones"]} - {""})
            fams.append(f)
        fams.sort(key=lambda f: (f["completas"] == f["total"], f["nombre"]))
        salida.append({
            "nombre": nombre,
            "familias": fams,
            "total": sum(f["total"] for f in fams),
            "completas": sum(f["completas"] for f in fams),
        })
    salida.sort(key=lambda c: (c["nombre"] == SIN_CATEGORIA, _orden_alfa(c["nombre"])))
    _guardar_familias_web(salida)
    return {
        "categorias": salida,
        "piezas": list(PIEZAS),
        "total": sum(c["total"] for c in salida),
        "completas": sum(c["completas"] for c in salida),
        "desplegadas": sum(f["desplegadas"] for c in salida for f in c["familias"]),
        "sin_senal": sin_senal,
        "generado": datos.get("generado"),
    }


if __name__ == "__main__":
    import sys

    if "--familias-web" in sys.argv:
        r = arbol(refrescar="--refrescar" in sys.argv)
        print(f"familias_arbol.json: {sum(len(c['familias']) for c in r['categorias'])} familias en {len(r['categorias'])} categorías")
