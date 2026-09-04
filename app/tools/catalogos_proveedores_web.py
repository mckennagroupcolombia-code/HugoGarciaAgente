"""
Extracción de la oferta de materias primas desde los catálogos WEB públicos de
los proveedores de McKenna (sin LLM). Cada sitio tiene un extractor propio
porque la estructura difiere (WooCommerce, Webflow, Duda, WordPress); si un
dominio no tiene extractor se usa la heurística genérica de
proveedores_db.extraer_productos_desde_url.

Uso (panel → Proveedores → Catálogos → "Leer catálogo web del proveedor", o
desde consola):

    from app.tools.catalogos_proveedores_web import extraer_catalogo_web, cargar_catalogo_web
    extraer_catalogo_web("https://glotracol.com/productos/")   # → {"lineas": [...], ...}
    cargar_catalogo_web(proveedor_id, url)                     # guarda en proveedores.db

Los nombres se guardan tal cual vienen del sitio (fuente="catalogo_web",
referencia=url); la limpieza para la web pública la hace nombre_publico().
"""

from __future__ import annotations

import re
import warnings
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

warnings.filterwarnings("ignore", message=".*XMLParsedAsHTMLWarning.*")

_H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 McKennaCatalogReader/1.0"}
_TIMEOUT = 30
_MAX_PAGINAS = 40

_RUIDO = ("inicio", "nosotros", "contacto", "blog", "productos", "home", "about", "políticas", "politicas",
          "lun - vie", "whatsapp", "cotiz", "ver más", "ver mas", "leer más", "catálogo", "catalogo", "industria ",
          "empaque", "contenido", "unidades", "solicit", "©", "todos los derechos", "soluciones especiales", "elección", "eleccion")


def _get(url: str) -> BeautifulSoup | None:
    try:
        r = requests.get(url, headers=_H, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        return BeautifulSoup(r.text, "lxml")
    except Exception:
        return None


def _limpio(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "")).strip(" -–·:")


def _es_ruido(t: str) -> bool:
    low = t.lower()
    return len(t) < 3 or len(t) > 90 or any(k in low for k in _RUIDO) or not re.search(r"[a-záéíóúñ]{3}", low)


def _dedupe(items: list[dict]) -> list[dict]:
    vistos, out = set(), []
    for it in items:
        k = it["nombre"].lower()
        if k in vistos or _es_ruido(it["nombre"]):
            continue
        vistos.add(k)
        out.append(it)
    return out


# ───────────────────────── extractores por sitio ─────────────────────────


def _woocommerce(url: str) -> list[dict]:
    """Listados WooCommerce paginados: /productos/page/N/ (glotracol y similares)."""
    base = url.rstrip("/")
    out: list[dict] = []
    for pg in range(1, _MAX_PAGINAS + 1):
        s = _get(base + "/" if pg == 1 else f"{base}/page/{pg}/")
        if s is None:
            break
        titulos = s.select("h2.woocommerce-loop-product__title, li.product h2, li.product h3, .product-title, .wc-block-components-product-name")
        if not titulos:
            break
        for h in titulos:
            cat = ""
            li = h.find_parent("li")
            if li is not None:
                cls = " ".join(li.get("class") or [])
                m = re.search(r"product_cat-([a-z0-9\-]+)", cls)
                cat = m.group(1).replace("-", " ") if m else ""
            out.append({"nombre": _limpio(h.get_text(" ", strip=True)), "categoria": cat, "precio": None, "cas": ""})
    return _dedupe(out)


def _interkrol(url: str) -> list[dict]:
    """interkrol.com/listado-general: cada producto es un <li> dentro de ul.defaultList (Duda)."""
    u = url if "listado-general" in url else "https://www.interkrol.com/listado-general"
    s = _get(u)
    if s is None:
        return []
    out = []
    for li in s.select("ul.defaultList li, ul.bullet li"):
        t = _limpio(li.get_text(" ", strip=True))
        if t and not _es_ruido(t):
            out.append({"nombre": t, "categoria": "", "precio": None, "cas": ""})
    return _dedupe(out)


def _cadiep(url: str) -> list[dict]:
    """cadiep.com/catalogo/<industria>: h4 = subcategoría, h5 = producto (Webflow)."""
    raiz = "https://www.cadiep.com/catalogo"
    s = _get(url if "/catalogo/" in url else raiz)
    if s is None:
        return []
    cats = sorted({urljoin("https://www.cadiep.com/", a["href"]).replace("cadiep-website.webflow.io", "www.cadiep.com")
                   for a in s.select("a[href*='/catalogo/']")})
    if "/catalogo/" in url:
        cats = [url]
    out = []
    for cu in cats or [url]:
        sc = _get(cu)
        if sc is None:
            continue
        industria = _limpio(sc.title.text.split("|")[0]) if sc.title else ""
        sub = ""
        for tag in sc.select("h4, h5"):
            t = _limpio(tag.get_text(" ", strip=True))
            if tag.name == "h4":
                sub = t
                continue
            if tag.get("class") or _es_ruido(t):
                continue
            out.append({"nombre": t, "categoria": (sub or industria)[:60], "precio": None, "cas": ""})
    return _dedupe(out)


def _productos3a(url: str) -> list[dict]:
    """productos3a.com/portafolio-de-productos (Webflow CMS, paginado ?fadf6aa7_page=N)."""
    base = "https://www.productos3a.com/portafolio-de-productos"
    out = []
    for pg in range(1, 8):
        s = _get(base if pg == 1 else f"{base}?fadf6aa7_page={pg}")
        if s is None:
            break
        items = s.select(".w-dyn-item")
        if not items:
            break
        for it in items:
            # Estructura Webflow del sitio: .text-block-2 = categoría, .text-block-3 = nombre
            nom_el = it.select_one(".text-block-3") or it.select_one("h1, h2, h3, h4")
            nombre = _limpio(nom_el.get_text(" ", strip=True)) if nom_el else ""
            cat_el = it.select_one(".text-block-2") or it.select_one("[class*=categor]")
            cat = _limpio(cat_el.get_text(" ", strip=True)) if cat_el else ""
            if nombre:
                out.append({"nombre": nombre, "categoria": cat[:60], "precio": None, "cas": ""})
        if not s.select_one(f"a[href*='_page={pg + 1}']"):
            break
    return _dedupe(out)


def _factores(url: str) -> list[dict]:
    """factoresymercadeo.com: el sitio solo publica categorías; se recorren las páginas
    de productos y el listado para capturar nombres concretos si existen."""
    out = []
    for u in ("https://factoresymercadeo.com/listado-de-productos/", "https://factoresymercadeo.com/productos-2/",
              "https://factoresymercadeo.com/productos/"):
        s = _get(u)
        if s is None:
            continue
        for tag in s.select("li, td, h3, h4, h5, p strong"):
            t = _limpio(tag.get_text(" ", strip=True))
            if _es_ruido(t) or len(t) > 45 or "polític" in t.lower() or "@" in t or "+57" in t:
                continue
            out.append({"nombre": t, "categoria": "", "precio": None, "cas": ""})
    return _dedupe(out)


def _globalquimia_co(url: str) -> list[dict]:
    """globalquimia.com.co: páginas de insumos (cápsulas, sílica, liners…) en el page-sitemap."""
    s = _get("https://globalquimia.com.co/page-sitemap.xml")
    out = []
    locs = re.findall(r"<loc>([^<]+)</loc>", str(s)) if s else []
    for loc in locs:
        if not re.search(r"/(insumos|equipos|productos|capsulas|estandares)", loc):
            continue
        sp = _get(loc)
        if sp is None:
            continue
        h1 = sp.select_one("h1")
        t = _limpio(h1.get_text(" ", strip=True)) if h1 else ""
        if t and not _es_ruido(t):
            out.append({"nombre": t, "categoria": loc.split("/")[3].replace("-", " ") if loc.count("/") > 3 else "", "precio": None, "cas": ""})
    return _dedupe(out)


_EXTRACTORES = {
    "glotracol.com": _woocommerce,
    "interkrol.com": _interkrol,
    "cadiep.com": _cadiep,
    "productos3a.com": _productos3a,
    "factoresymercadeo.com": _factores,
    "globalquimia.com.co": _globalquimia_co,
}

# Sitios conocidos de proveedores (nombre normalizado en proveedores.db → URL de catálogo)
CATALOGOS_CONOCIDOS: dict[str, str] = {
    "global trading de colombia": "https://glotracol.com/productos/",
    "quimica interkrol": "https://www.interkrol.com/listado-general",
    "cadiep": "https://www.cadiep.com/catalogo",
    "productos 3a": "https://www.productos3a.com/portafolio-de-productos",
    "factores y mercadeo": "https://factoresymercadeo.com/productos/",
    "globalquimia": "https://globalquimia.com.co/",
}


def extraer_catalogo_web(url: str) -> dict:
    url = (url or "").strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "URL inválida", "lineas": []}
    host = urlparse(url).netloc.lower().replace("www.", "")
    ext = next((f for dom, f in _EXTRACTORES.items() if host.endswith(dom)), None)
    lineas: list[dict] = []
    metodo = "generico"
    if ext is not None:
        try:
            lineas = ext(url)
            metodo = ext.__name__.strip("_")
        except Exception as e:
            return {"ok": False, "error": f"Extractor {ext.__name__}: {e}", "lineas": []}
    if not lineas:
        from app.services.proveedores_db import extraer_productos_desde_url
        r = extraer_productos_desde_url(url)
        lineas = r.get("lineas", []) if r.get("ok") else []
        metodo = "generico"
    for ln in lineas:
        ln.setdefault("archivo", host)
        ln.setdefault("fila", ln["nombre"])
    return {"ok": True, "url": url, "metodo": metodo, "lineas": lineas, "n": len(lineas)}


def cargar_catalogo_web(proveedor_id: int, url: str, *, publicar_web: bool = True, autoclasificar: bool = True) -> dict:
    """Extrae y guarda en proveedores.db (fuente catalogo_web). Idempotente por nombre."""
    from app.services import proveedores_db as P

    r = extraer_catalogo_web(url)
    if not r.get("ok"):
        return r
    lineas = []
    for ln in r["lineas"]:
        sug = P.clasificar_nombre(ln["nombre"]) if autoclasificar else {"linea": "", "origen_pais": ""}
        lineas.append({"nombre": ln["nombre"], "cas": ln.get("cas", ""), "presentacion": "",
                       "linea": sug["linea"], "origen_pais": sug["origen_pais"], "notas": ln.get("categoria", "")})
    res = P.importar_lineas_catalogo(0, proveedor_id, lineas, publicar_web=publicar_web)
    P.guardar_proveedor({"sitio_web": url}, pid=proveedor_id)
    # marcar fuente/referencia de estas líneas
    try:
        con = P._conn()
        try:
            con.execute("UPDATE proveedor_productos SET fuente='catalogo_web', referencia=? "
                        "WHERE proveedor_id=? AND fuente='catalogo' AND referencia='catalogo'", (url, proveedor_id))
            con.commit()
        finally:
            con.close()
    except Exception:
        pass
    return {"ok": True, "url": url, "metodo": r["metodo"], "extraidas": r["n"], **res}
