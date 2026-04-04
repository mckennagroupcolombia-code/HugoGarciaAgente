#!/usr/bin/env python3
"""
McKenna Group — Website nativo (Flask)
Fuente de datos: Google Sheets + MeLi API (fotos vía CDN)
Puerto: 8082
"""

import sys, os, json, time, re, logging, hashlib, sqlite3, uuid
from pathlib import Path
from collections import defaultdict
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent.parent   # /home/mckg/mi-agente
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / '.env')

from flask import Flask, render_template, request, jsonify, abort, redirect, url_for, session
import requests
import gspread

# ══════════════════════════════════════════════════════════
#  CONFIG
# ══════════════════════════════════════════════════════════
CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    str(ROOT / "mi-agente-ubuntu-9043f67d9755.json")
)
SHEET_ID    = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
MELI_CREDS  = Path(os.getenv("MELI_CREDS_PATH", str(ROOT / "credenciales_meli.json")))
CACHE_FILE  = Path(__file__).parent / "data/cache.json"
CACHE_TTL   = 6 * 3600          # 6 horas
WA_NUMBER   = "573195183596"
SITE_URL    = "https://mckennagroup.co"

# ── MercadoPago Colombia ─────────────────────────────────
MP_ACCESS_TOKEN   = os.getenv("MP_ACCESS_TOKEN", "")       # APP_USR-...
MP_API            = "https://api.mercadopago.com"

# ── DB órdenes ───────────────────────────────────────────
DB_PATH = Path(__file__).parent / "data/orders.db"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("website")

# ══════════════════════════════════════════════════════════
#  CATEGORÍAS (mismo orden que catálogo PDF)
# ══════════════════════════════════════════════════════════
CATEGORY_MAP = [
    (["acd", "ktacd"],                                           "Ácidos"),
    (["oilesn"],                                                  "Aceites Esenciales"),
    (["oil","oilarg","oilgrs","oilbmb","oilsml","oilvrgn",
      "sbcrd","vsl"],                                             "Aceites"),
    (["crcrn","crabjrf","lnln","mntcc","mntk","mntklb",
      "mntccrfkg","mntkkg","mntk250g","mntl100g","mtnkrtkg",
      "prfn"],                                                     "Ceras y Mantecas"),
    (["alcctl","btms","btncc","crlnt","ccmd","tsscc","tsci",
      "pls20","polisb","polsorb","cocamid"],                       "Emulsionantes y Surfactantes"),
    (["alnt","frbsgl","glc","hyal","niac","dprp",
      "srb500","urcsm"],                                           "Humectantes"),
    (["arc"],                                                      "Arcillas"),
    (["bcarna","ctrca","ctmg","ctrmg","clrmg","ctrzn","salmg",
      "salkmg","clrcalb","ctk","srlch"],                           "Sales Minerales"),
    (["oltk","lctca","gmxtn","gmxnt","brxlben","slfcul"],          "Minerales"),
    (["dpnt","vtmb","vtmc","vtma","vtmd","vtme"],                  "Vitaminas"),
    (["bcaa","clgnhd","crtnmnh","els","gltssnbr","prtasl",
      "gelat","albhv","larg","lglt","lisl","lprl",
      "ltrp","trn250"],                                            "Suplementarios"),
    (["cfn","extalvr","extgsn","extmlt","extemtc","mltdxtr",
      "mltdxlb","algna","cmcph","cmclb","coloid","extmat",
      "gmsn","actnalb","agag","almyc","cpsvcglt","dxdtlb",
      "dxtkg","estmglb","gltmns","gmgr","inl","lctsyl",
      "ppn","agdst","h2ors"],                                      "Excipientes"),
    (["shrmx","shrx","phemx","dmdm","benz","propgl",
      "potsorb","sodbnz","bnznalb","mtbslfn","srbk","srbtkg"],     "Conservantes"),
    (["alls","erttlb","frct","stvia","xylitol","crmtrt",
      "scr250"],                                                    "Edulcorantes"),
    (["dha","as-96","retinol","rtn5p","niacin","kojic",
      "alfarb","dmso","oxdzn","mntl100","vltgn"],                  "Principios Activos"),
    (["kt","kit"],                                                  "Kits"),
    (["agtmgn","bkr","gtrvdr","gtrvdramb","gtr","ppmt",
      "termm","piseta","filtro","embudo","cchmzcpls",
      "glslcarn","rvv","tds/eh"],                                   "Equipos y Materiales"),
    (["almlijmkt","brcesc","extelc","frspdrmttx","as-15",
      "pnttrscbl","ktext","repuesto","dscvdr","flnpvc",
      "owofan"],                                                    "Herramientas"),
    (["azm","glt2p","crbact"],                                     "Agrícola"),
    (["as-44","as-86","as-38","collar","mascot"],                  "Mascotas"),
]

CAT_COLORS = {
    "Ácidos":                     "#143D36",
    "Aceites Esenciales":         "#1E5C51",
    "Aceites":                    "#2E8B7A",
    "Ceras y Mantecas":           "#3A9E8C",
    "Emulsionantes y Surfactantes":"#1E5C51",
    "Humectantes":                "#4DB3A0",
    "Arcillas":                   "#6B8F71",
    "Sales Minerales":            "#2E8B7A",
    "Minerales":                  "#143D36",
    "Vitaminas":                  "#1E5C51",
    "Suplementarios":             "#2E8B7A",
    "Excipientes":                "#3A9E8C",
    "Conservantes":               "#143D36",
    "Edulcorantes":               "#4DB3A0",
    "Principios Activos":         "#1E5C51",
    "Kits":                       "#2E8B7A",
    "Equipos y Materiales":       "#143D36",
    "Herramientas":               "#1E5C51",
    "Agrícola":                   "#6B8F71",
    "Mascotas":                   "#2E8B7A",
    "Otros":                      "#888888",
}


def categorize(sku: str) -> str:
    sl = sku.strip().lower()
    for prefixes, cat in CATEGORY_MAP:
        for pfx in prefixes:
            if sl.startswith(pfx) or sl == pfx:
                return cat
    return "Otros"


# ══════════════════════════════════════════════════════════
#  TOKEN MELI
# ══════════════════════════════════════════════════════════
def get_meli_token() -> str:
    try:
        with open(MELI_CREDS) as f:
            creds = json.load(f)
        token = creds.get("access_token", "")
        if token:
            return token
    except Exception as e:
        log.warning(f"No se pudo leer token MeLi: {e}")
    return ""


# ══════════════════════════════════════════════════════════
#  FOTOS MELI (retorna URLs CDN, no descarga localmente)
# ══════════════════════════════════════════════════════════
def fetch_meli_photo_urls(token: str, meli_id_to_sku: dict) -> dict:
    """Retorna {sku: url_foto_meli}"""
    if not token or not meli_id_to_sku:
        return {}

    headers   = {"Authorization": f"Bearer {token}"}
    item_ids  = list(meli_id_to_sku.keys())
    sku_photo = {}

    for i in range(0, len(item_ids), 20):
        batch = item_ids[i:i+20]
        try:
            res = requests.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(batch), "attributes": "id,pictures,price,available_quantity"},
                headers=headers, timeout=15
            )
            if res.status_code != 200:
                continue
            for entry in res.json():
                if entry.get("code") != 200:
                    continue
                body    = entry.get("body", {})
                item_id = body.get("id", "")
                sku     = meli_id_to_sku.get(item_id, "")
                if not sku:
                    continue
                pics = body.get("pictures", [])
                if pics:
                    url = pics[0].get("secure_url") or pics[0].get("url", "")
                    if url:
                        sku_photo[sku] = url
        except Exception as e:
            log.warning(f"Error batch fotos MeLi: {e}")

    log.info(f"  {len(sku_photo)} fotos obtenidas de MeLi CDN")
    return sku_photo


# ══════════════════════════════════════════════════════════
#  LEER CATÁLOGO DESDE SHEETS
# ══════════════════════════════════════════════════════════
def leer_catalogo() -> list:
    """Lee Google Sheets y retorna lista de secciones con productos."""
    log.info("Conectando con Google Sheets...")
    gc = gspread.service_account(filename=CREDS_PATH)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.sheet1
    rows = ws.get_all_values()
    log.info(f"  {len(rows)-1} filas en Sheets")

    header     = [h.strip().upper() for h in rows[0]]
    idx_meli   = 0
    idx_sku    = next((i for i, h in enumerate(header) if "SKU"    in h), 1)
    idx_nombre = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_precio = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)
    idx_desc   = next((i for i, h in enumerate(header) if any(k in h for k in ["FICHA","TDS","DESC","TECNICA","TÉCNICA"])), 8)

    seen       = set()
    sections   = defaultdict(list)
    id_to_sku  = {}

    for row in rows[1:]:
        if len(row) <= max(idx_sku, idx_nombre, idx_precio):
            continue
        meli_id    = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        sku        = row[idx_sku].strip()
        nombre     = row[idx_nombre].strip()
        precio_raw = row[idx_precio].strip()
        desc_raw   = row[idx_desc].strip() if len(row) > idx_desc else ""

        if not sku or not nombre or not precio_raw or sku in seen:
            continue
        seen.add(sku)

        if meli_id.startswith("MCO"):
            id_to_sku[meli_id] = sku

        try:
            precio_meli = float(precio_raw.replace(",", "").replace(".", "")
                                .replace("$", "").replace(" ", ""))
            if precio_meli <= 0:
                continue
        except ValueError:
            continue

        precio_desc = precio_meli * 0.90
        ahorro      = precio_meli * 0.10

        def fmt(n): return f"${n:,.0f}".replace(",", ".")

        cat = categorize(sku)
        sections[cat].append({
            "name":       nombre,
            "ref":        sku,
            "precio":     fmt(precio_desc),
            "precio_meli":fmt(precio_meli),
            "ahorro":     fmt(ahorro),
            "photo":      None,
            "meli_id":    meli_id if meli_id.startswith("MCO") else "",
            "cat":        cat,
            "cat_color":  CAT_COLORS.get(cat, "#2E8B7A"),
            "slug":       re.sub(r"[^a-z0-9\-]", "-", sku.lower()),
            "desc":       desc_raw[:450] if desc_raw else "",
        })

    # Fotos desde MeLi
    token     = get_meli_token()
    photo_map = fetch_meli_photo_urls(token, id_to_sku)
    for prods in sections.values():
        for p in prods:
            p["photo"] = photo_map.get(p["ref"], "")

    # Ordenar secciones
    orden = [cat for _, cat in CATEGORY_MAP] + ["Otros"]
    seen_ord, orden_final = set(), []
    for c in orden:
        if c not in seen_ord:
            seen_ord.add(c)
            orden_final.append(c)

    result = []
    for cat in orden_final:
        if cat in sections and sections[cat]:
            prods = sorted(sections[cat], key=lambda p: p["name"].lower())
            result.append({"name": cat, "products": prods})
    for cat, prods in sections.items():
        if cat not in seen_ord and prods:
            result.append({"name": cat, "products": sorted(prods, key=lambda p: p["name"].lower())})

    total = sum(len(s["products"]) for s in result)
    log.info(f"Catálogo listo: {len(result)} categorías, {total} productos")
    return result


# ══════════════════════════════════════════════════════════
#  CACHE
# ══════════════════════════════════════════════════════════
_catalog_cache = {"data": None, "ts": 0}

def get_catalog(force=False) -> list:
    now = time.time()
    if not force and _catalog_cache["data"] and (now - _catalog_cache["ts"]) < CACHE_TTL:
        return _catalog_cache["data"]

    # Intentar cargar desde archivo
    if not force and CACHE_FILE.exists():
        age = now - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL:
            try:
                data = json.loads(CACHE_FILE.read_text())
                _catalog_cache.update({"data": data, "ts": now})
                log.info(f"Catálogo cargado desde cache ({int(age/60)} min)")
                return data
            except Exception:
                pass

    # Construir catálogo fresco
    try:
        data = leer_catalogo()
        _catalog_cache.update({"data": data, "ts": now})
        CACHE_FILE.parent.mkdir(exist_ok=True)
        CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        log.info("Cache guardado en disco")
        return data
    except Exception as e:
        log.error(f"Error construyendo catálogo: {e}")
        if _catalog_cache["data"]:
            return _catalog_cache["data"]
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text())
        return []


def get_all_products(catalog=None) -> list:
    if catalog is None:
        catalog = get_catalog()
    return [p for section in catalog for p in section["products"]]


def find_product(sku: str) -> dict | None:
    for p in get_all_products():
        if p["ref"].lower() == sku.lower() or p["slug"] == sku.lower():
            return p
    return None


def wa_link(producto: dict) -> str:
    msg = (f"Hola, quiero ordenar: *{producto['name']}* "
           f"(Ref: {producto['ref']}) — {producto['precio']} COP")
    return f"https://wa.me/{WA_NUMBER}?text={requests.utils.quote(msg)}"


# ══════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════
def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            reference   TEXT UNIQUE,
            buyer_name  TEXT,
            buyer_email TEXT,
            buyer_phone TEXT,
            buyer_city  TEXT,
            items_json  TEXT,
            total       REAL,
            status      TEXT DEFAULT 'pending',
            payu_ref    TEXT,
            created_at  TEXT
        )
    """)
    con.commit()
    con.close()

def mp_crear_preferencia(ref: str, cart: dict, total: float) -> dict:
    """Crea una preferencia de pago en MercadoPago y retorna {init_point, id}."""
    items = []
    for item in cart.values():
        items.append({
            "title":      item["name"][:256],
            "quantity":   item["qty"],
            "unit_price": round(item["price"]),
            "currency_id": "COP",
        })
    payload = {
        "items": items,
        "external_reference": ref,
        "back_urls": {
            "success": SITE_URL + "/pago/respuesta?estado=aprobado",
            "failure": SITE_URL + "/pago/respuesta?estado=rechazado",
            "pending": SITE_URL + "/pago/respuesta?estado=pendiente",
        },
        "auto_return": "approved",
        "notification_url": SITE_URL + "/pago/confirmacion",
        "statement_descriptor": "MCKENNA GROUP",
        "expires": False,
    }
    try:
        res = requests.post(
            f"{MP_API}/checkout/preferences",
            json=payload,
            headers={
                "Authorization": f"Bearer {MP_ACCESS_TOKEN}",
                "Content-Type": "application/json",
                "X-Idempotency-Key": ref,
            },
            timeout=15,
        )
        if res.status_code in (200, 201):
            data = res.json()
            return {"init_point": data["init_point"], "id": data["id"], "ok": True}
        log.error(f"MP preferencia error {res.status_code}: {res.text[:300]}")
    except Exception as e:
        log.error(f"MP preferencia excepción: {e}")
    return {"ok": False, "init_point": "", "id": ""}


def cart_total(cart: dict) -> float:
    return sum(item["price"] * item["qty"] for item in cart.values())


app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "mckg-s3cr3t-2026-!xK9")
app.jinja_env.globals.update(wa_link=wa_link, WA_NUMBER=WA_NUMBER)


@app.route("/")
def index():
    catalog   = get_catalog()
    cats      = [s["name"] for s in catalog]
    featured  = []
    for s in catalog:
        featured.extend(s["products"][:2])
        if len(featured) >= 8:
            break
    return render_template("index.html",
        catalog=catalog,
        cats=cats,
        featured=featured[:8])


@app.route("/tienda")
@app.route("/tienda/")
def tienda():
    return redirect(url_for("catalogo"), code=301)


@app.route("/catalogo")
@app.route("/catalogo/")
def catalogo():
    cat_filter = request.args.get("cat", "").strip()
    catalog    = get_catalog()
    if cat_filter:
        sections = [s for s in catalog if s["name"].lower() == cat_filter.lower()]
        if not sections:
            return redirect(url_for("catalogo"))
    else:
        sections = catalog
    cats = [s["name"] for s in catalog]
    return render_template("tienda.html",
        sections=sections,
        cats=cats,
        cat_filter=cat_filter)


@app.route("/producto/<slug>")
def producto(slug):
    p = find_product(slug)
    if not p:
        abort(404)
    catalog = get_catalog()
    # Productos relacionados (misma categoría)
    relacionados = [x for s in catalog if s["name"] == p["cat"]
                    for x in s["products"] if x["ref"] != p["ref"]][:4]
    return render_template("producto.html",
        p=p,
        relacionados=relacionados,
        wa=wa_link(p))


@app.route("/nosotros")
def nosotros():
    return render_template("nosotros.html")


@app.route("/contacto")
def contacto():
    return render_template("contacto.html")


@app.route("/guias/kit-acidos")
def guia_kit_acidos():
    from flask import send_file
    guide = Path(__file__).parent.parent / "guia-kit-acidos.html"
    if guide.exists():
        return send_file(str(guide))
    abort(404)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    admin = os.getenv("ADMIN_TOKEN", "")
    if admin and token != admin:
        abort(403)
    data = get_catalog(force=True)
    return jsonify({"ok": True, "categorias": len(data),
                    "productos": sum(len(s["products"]) for s in data)})


# ══════════════════════════════════════════════════════════
#  CARRITO
# ══════════════════════════════════════════════════════════
@app.route("/carrito")
def carrito():
    cart = session.get("cart", {})
    total = cart_total(cart)
    return render_template("carrito.html", cart=cart, total=total)


@app.route("/carrito/agregar", methods=["POST"])
def carrito_agregar():
    slug = request.form.get("slug", "")
    qty  = max(1, int(request.form.get("qty", 1)))
    p = find_product(slug)
    if not p:
        abort(404)
    # Convertir precio a número
    price_str = p["precio"].replace("$", "").replace(".", "").replace(",", "").strip()
    try:
        price = float(price_str)
    except ValueError:
        price = 0.0

    cart = session.get("cart", {})
    if slug in cart:
        cart[slug]["qty"] += qty
    else:
        cart[slug] = {
            "name":  p["name"],
            "ref":   p["ref"],
            "price": price,
            "qty":   qty,
            "photo": p.get("photo", ""),
            "slug":  slug,
        }
    session["cart"] = cart
    session.modified = True

    next_url = request.form.get("next", url_for("carrito"))
    return redirect(next_url)


@app.route("/carrito/actualizar", methods=["POST"])
def carrito_actualizar():
    slug = request.form.get("slug", "")
    qty  = int(request.form.get("qty", 1))
    cart = session.get("cart", {})
    if slug in cart:
        if qty <= 0:
            del cart[slug]
        else:
            cart[slug]["qty"] = qty
    session["cart"] = cart
    session.modified = True
    return redirect(url_for("carrito"))


@app.route("/carrito/eliminar", methods=["POST"])
def carrito_eliminar():
    slug = request.form.get("slug", "")
    cart = session.get("cart", {})
    cart.pop(slug, None)
    session["cart"] = cart
    session.modified = True
    return redirect(url_for("carrito"))


# ══════════════════════════════════════════════════════════
#  CHECKOUT + PAYU
# ══════════════════════════════════════════════════════════
@app.route("/checkout")
def checkout():
    cart = session.get("cart", {})
    if not cart:
        return redirect(url_for("catalogo"))
    total = cart_total(cart)
    ref   = "MCKG-" + uuid.uuid4().hex[:10].upper()
    session["pending_ref"] = ref
    session.modified = True
    return render_template("checkout.html", cart=cart, total=total, ref=ref)


@app.route("/checkout/pagar", methods=["POST"])
def checkout_pagar():
    """Recibe el formulario de datos del comprador, crea preferencia MP y redirige."""
    cart = session.get("cart", {})
    if not cart:
        return redirect(url_for("catalogo"))

    ref          = session.get("pending_ref") or ("MCKG-" + uuid.uuid4().hex[:10].upper())
    total        = cart_total(cart)
    buyer_name   = request.form.get("buyer_name", "").strip()
    buyer_email  = request.form.get("buyer_email", "").strip()
    buyer_phone  = request.form.get("buyer_phone", "").strip()
    buyer_city   = request.form.get("buyer_city", "").strip()
    buyer_addr   = request.form.get("buyer_address", "").strip()

    # Guardar orden en DB como "pending"
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute(
            """INSERT OR IGNORE INTO orders
               (reference, buyer_name, buyer_email, buyer_phone, buyer_city,
                items_json, total, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (ref, buyer_name, buyer_email, buyer_phone, buyer_city,
             json.dumps(list(cart.values()), ensure_ascii=False),
             total, "pending", datetime.now().isoformat())
        )
        con.commit()
        con.close()
    except Exception as e:
        log.warning(f"checkout_pagar DB: {e}")

    if not MP_ACCESS_TOKEN:
        # Sin token configurado: mostrar página de confirmación manual
        return render_template("checkout_sin_mp.html",
            ref=ref, total=total,
            buyer_name=buyer_name, buyer_email=buyer_email)

    pref = mp_crear_preferencia(ref, cart, total)
    if pref["ok"]:
        return redirect(pref["init_point"])

    # Si MP falla, ofrecer pago por WhatsApp como fallback
    return render_template("checkout_sin_mp.html",
        ref=ref, total=total,
        buyer_name=buyer_name, buyer_email=buyer_email)


@app.route("/pago/respuesta")
def pago_respuesta():
    """MercadoPago redirige aquí via back_urls."""
    estado      = request.args.get("estado", "")           # aprobado/rechazado/pendiente
    mp_status   = request.args.get("status", "")           # approved/rejected/pending
    ref         = request.args.get("external_reference", "")
    payment_id  = request.args.get("payment_id", "")
    collection_status = request.args.get("collection_status", "")

    # Normalizar status
    raw = mp_status or collection_status or estado
    if raw in ("approved", "aprobado"):
        status = "approved"
    elif raw in ("rejected", "rechazado"):
        status = "declined"
    else:
        status = "pending"

    if status == "approved":
        session.pop("cart", None)
        session.modified = True
        # Actualizar DB
        try:
            con = sqlite3.connect(DB_PATH)
            con.execute("UPDATE orders SET status='approved', payu_ref=? WHERE reference=?",
                        (payment_id, ref))
            con.commit(); con.close()
        except Exception: pass

    return render_template("pago_respuesta.html",
        status=status, ref=ref, tx_id=payment_id, amount="")


@app.route("/pago/confirmacion", methods=["GET", "POST"])
def pago_confirmacion():
    """Webhook IPN de MercadoPago."""
    topic      = request.args.get("topic") or request.args.get("type", "")
    payment_id = request.args.get("id") or request.args.get("data.id", "")

    if topic not in ("payment", "merchant_order") or not payment_id:
        return "OK", 200

    # Consultar el pago a la API de MP para obtener estado real
    try:
        res = requests.get(
            f"{MP_API}/v1/payments/{payment_id}",
            headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"},
            timeout=10,
        )
        if res.status_code == 200:
            data       = res.json()
            ref        = data.get("external_reference", "")
            mp_status  = data.get("status", "")
            mapping    = {"approved": "approved", "rejected": "declined",
                          "in_process": "pending", "pending": "pending"}
            new_status = mapping.get(mp_status, "unknown")
            try:
                con = sqlite3.connect(DB_PATH)
                con.execute("UPDATE orders SET status=?, payu_ref=? WHERE reference=?",
                            (new_status, str(payment_id), ref))
                con.commit(); con.close()
            except Exception as e:
                log.warning(f"MP confirmacion DB: {e}")
            log.info(f"MP IPN: payment={payment_id} ref={ref} status={new_status}")
    except Exception as e:
        log.warning(f"MP IPN consulta: {e}")

    return "OK", 200


@app.route("/mis-pedidos")
def mis_pedidos():
    email = request.args.get("email", "").strip().lower()
    orders = []
    if email:
        try:
            con = sqlite3.connect(DB_PATH)
            con.row_factory = sqlite3.Row
            orders = con.execute(
                "SELECT * FROM orders WHERE lower(buyer_email)=? ORDER BY id DESC LIMIT 20",
                (email,)
            ).fetchall()
            con.close()
        except Exception as e:
            log.warning(f"mis_pedidos: {e}")
    return render_template("mis_pedidos.html", orders=orders, email=email)


@app.errorhandler(404)
def not_found(e):
    return render_template("404.html"), 404


if __name__ == "__main__":
    init_db()
    log.info("Cargando catálogo inicial...")
    get_catalog()
    log.info("Website McKenna Group iniciando en puerto 8082")
    app.run(host="0.0.0.0", port=8083, debug=False)
