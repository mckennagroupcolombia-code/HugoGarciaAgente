#!/usr/bin/env python3
"""
cross_reference_full.py
Cross-reference all MeLi SKUs vs SIIGO products, and WooCommerce products
(by name) vs SIIGO/MeLi. Standalone script — loads its own env and credentials.
"""

import os
import sys
import json
import time
import unicodedata
import requests
from dotenv import load_dotenv

# ── Env ──────────────────────────────────────────────────────────────────────
load_dotenv("/home/mckg/mi-agente/.env")
sys.path.insert(0, "/home/mckg/mi-agente")

MELI_CREDS_PATH = os.getenv("MELI_CREDS_PATH", "/home/mckg/mi-agente/credenciales_meli.json")
SIIGO_CREDS_PATH = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
PARTNER_ID = "SiigoAPI"
MELI_SELLER_ID = 432439187   # confirmed via /users/me

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    """Lowercase + strip accents + collapse whitespace."""
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_str.lower().split())


def extraer_sku_meli(item: dict) -> str:
    """Extract SKU from seller_custom_field OR attributes[SELLER_SKU]."""
    sku = (item.get("seller_custom_field") or "").strip()
    if sku:
        return sku
    for attr in item.get("attributes", []):
        if attr.get("id") == "SELLER_SKU":
            val = (attr.get("value_name") or "").strip()
            if val:
                return val
    return ""


def separator(char="─", width=70):
    print(char * width)


# ─────────────────────────────────────────────────────────────────────────────
# 1. MeLi — token refresh
# ─────────────────────────────────────────────────────────────────────────────

def get_meli_token() -> str:
    print("\n[MeLi] Refreshing access token …")
    with open(MELI_CREDS_PATH) as f:
        creds = json.load(f)

    payload = {
        "grant_type": "refresh_token",
        "client_id": creds["app_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
    }
    r = requests.post("https://api.mercadolibre.com/oauth/token",
                      data=payload, timeout=15)
    r.raise_for_status()
    data = r.json()
    token = data["access_token"]
    creds["access_token"] = token
    if "refresh_token" in data:
        creds["refresh_token"] = data["refresh_token"]
    with open(MELI_CREDS_PATH, "w") as f:
        json.dump(creds, f, indent=4)
    print("[MeLi] Token refreshed OK.")
    return token


# ─────────────────────────────────────────────────────────────────────────────
# 2. MeLi — fetch ALL active listings (with attributes)
# ─────────────────────────────────────────────────────────────────────────────

def get_meli_active_listings(token: str) -> list:
    """
    Returns list of item dicts. Each item includes seller_custom_field and
    attributes (fetched in bulk via /items endpoint, 20 per call).
    """
    print("\n[MeLi] Fetching all active listing IDs …")
    headers = {"Authorization": f"Bearer {token}"}
    all_ids = []
    offset = 0
    limit = 100

    while True:
        url = (f"https://api.mercadolibre.com/users/{MELI_SELLER_ID}/items/search"
               f"?status=active&offset={offset}&limit={limit}")
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code != 200:
            print(f"  [MeLi] Error fetching IDs (offset={offset}): {r.status_code} {r.text[:120]}")
            break
        data = r.json()
        batch = data.get("results", [])
        if not batch:
            break
        all_ids.extend(batch)
        paging = data.get("paging", {})
        total = paging.get("total", 0)
        offset += limit
        if offset >= total:
            break
        time.sleep(0.3)

    print(f"  [MeLi] Total active listing IDs found: {len(all_ids)}")

    # Fetch item details in batches of 20 (MeLi multi-get)
    print("[MeLi] Fetching item details (SKU, attributes) in batches of 20 …")
    items_detail = []
    batch_size = 20
    for i in range(0, len(all_ids), batch_size):
        batch_ids = all_ids[i : i + batch_size]
        ids_param = ",".join(batch_ids)
        url = (f"https://api.mercadolibre.com/items"
               f"?ids={ids_param}"
               f"&attributes=id,title,seller_custom_field,attributes")
        r = requests.get(url, headers=headers, timeout=20)
        if r.status_code != 200:
            print(f"  [MeLi] Error fetching batch {i//batch_size + 1}: {r.status_code}")
            continue
        for entry in r.json():
            body = entry.get("body", {})
            if entry.get("code") == 200 and body:
                items_detail.append(body)
        time.sleep(0.3)

    print(f"  [MeLi] Item details retrieved: {len(items_detail)}")
    return items_detail


# ─────────────────────────────────────────────────────────────────────────────
# 3. SIIGO — authenticate + fetch all products
# ─────────────────────────────────────────────────────────────────────────────

def get_siigo_token(force=True) -> str:
    print("\n[SIIGO] Authenticating (force refresh) …")
    with open(SIIGO_CREDS_PATH) as f:
        creds = json.load(f)

    if not force and time.time() < creds.get("token_vencimiento", 0):
        print("[SIIGO] Using cached token.")
        return creds["access_token"]

    r = requests.post(
        "https://api.siigo.com/auth",
        json={"username": creds["username"], "access_key": creds["api_key"]},
        headers={"Partner-Id": PARTNER_ID},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"SIIGO auth failed: {r.status_code} {r.text[:200]}")

    token = r.json()["access_token"]
    creds.update({"access_token": token, "token_vencimiento": time.time() + 23 * 3600})
    with open(SIIGO_CREDS_PATH, "w") as f:
        json.dump(creds, f)
    print("[SIIGO] Token obtained OK.")
    return token


def get_siigo_products(token: str) -> list:
    """Fetch all SIIGO products using pagination."""
    print("\n[SIIGO] Fetching all products …")
    headers = {"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"}
    all_products = []
    page = 1
    page_size = 100

    while True:
        url = f"https://api.siigo.com/v1/products?page={page}&page_size={page_size}"
        r = requests.get(url, headers=headers, timeout=20)
        if r.status_code != 200:
            print(f"  [SIIGO] Error page {page}: {r.status_code} {r.text[:120]}")
            break
        data = r.json()
        results = data.get("results", [])
        if not results:
            break
        all_products.extend(results)
        pagination = data.get("pagination", {})
        total = pagination.get("total_results", 0)
        if len(all_products) >= total:
            break
        page += 1
        time.sleep(0.2)

    print(f"  [SIIGO] Total SIIGO products: {len(all_products)}")
    return all_products


# ─────────────────────────────────────────────────────────────────────────────
# 4. WooCommerce — fetch all products
# ─────────────────────────────────────────────────────────────────────────────

def get_woocommerce_products() -> list:
    print("\n[WC] Fetching all WooCommerce products …")
    wc_url = os.getenv("WC_URL", "").rstrip("/")
    wc_key = os.getenv("WC_KEY", "")
    wc_secret = os.getenv("WC_SECRET", "")

    if not all([wc_url, wc_key, wc_secret]):
        print("  [WC] Missing WC_URL / WC_KEY / WC_SECRET — skipping WooCommerce.")
        return []

    all_products = []
    page = 1
    per_page = 100

    while True:
        url = f"{wc_url}/wp-json/wc/v3/products"
        params = {
            "status": "publish",
            "per_page": per_page,
            "page": page,
            "_fields": "id,name,sku,stock_quantity,status",
        }
        try:
            r = requests.get(url, params=params,
                             auth=(wc_key, wc_secret), timeout=20,
                             headers={"Accept": "application/json",
                                      "User-Agent": "McKennaAgent/1.0"})
        except Exception as e:
            print(f"  [WC] Network error page {page}: {e}")
            break

        if r.status_code != 200:
            print(f"  [WC] Error page {page}: {r.status_code} {r.text[:120]}")
            break

        batch = r.json()
        if not batch:
            break
        all_products.extend(batch)
        if len(batch) < per_page:
            break
        page += 1
        time.sleep(0.3)

    print(f"  [WC] Total WooCommerce products: {len(all_products)}")
    return all_products


# ─────────────────────────────────────────────────────────────────────────────
# 5. Fuzzy name matcher (simple token overlap ratio)
# ─────────────────────────────────────────────────────────────────────────────

def token_overlap_ratio(a: str, b: str) -> float:
    ta = set(normalize(a).split())
    tb = set(normalize(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


MATCH_THRESHOLD = 0.55   # tune as needed


def best_name_match(name: str, candidates: list, key: str = "name") -> tuple:
    """
    Returns (best_candidate_dict, score) or (None, 0) if below threshold.
    """
    best_score = 0.0
    best_item = None
    for cand in candidates:
        score = token_overlap_ratio(name, cand.get(key, ""))
        if score > best_score:
            best_score = score
            best_item = cand
    if best_score >= MATCH_THRESHOLD:
        return best_item, best_score
    return None, 0.0


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    separator("═")
    print("  CROSS-REFERENCE FULL: MeLi ↔ SIIGO  |  WooCommerce ↔ SIIGO/MeLi")
    separator("═")

    # ── Fetch data ────────────────────────────────────────────────────────────
    meli_token = get_meli_token()
    meli_items = get_meli_active_listings(meli_token)

    siigo_token = get_siigo_token(force=True)
    siigo_products = get_siigo_products(siigo_token)

    wc_products = get_woocommerce_products()

    # ── Build SIIGO lookup structures ─────────────────────────────────────────
    # By code (which is the SKU field in SIIGO)
    siigo_by_code = {}
    for p in siigo_products:
        code = (p.get("code") or "").strip().upper()
        if code:
            siigo_by_code[code] = p

    # By normalized name
    siigo_by_norm_name = {}
    for p in siigo_products:
        nm = normalize(p.get("name", ""))
        siigo_by_norm_name[nm] = p

    # ── Process MeLi listings ─────────────────────────────────────────────────
    meli_with_sku = []
    meli_without_sku = []
    for item in meli_items:
        sku = extraer_sku_meli(item)
        if sku:
            meli_with_sku.append({"id": item.get("id"),
                                   "title": item.get("title", ""),
                                   "sku": sku})
        else:
            meli_without_sku.append({"id": item.get("id"),
                                      "title": item.get("title", "")})

    meli_sku_in_siigo = []
    meli_sku_not_in_siigo = []
    for entry in meli_with_sku:
        sku_upper = entry["sku"].upper()
        if sku_upper in siigo_by_code:
            meli_sku_in_siigo.append({**entry,
                                       "siigo_name": siigo_by_code[sku_upper].get("name", "")})
        else:
            meli_sku_not_in_siigo.append(entry)

    # ── Process WooCommerce ───────────────────────────────────────────────────
    wc_with_sku = [p for p in wc_products if (p.get("sku") or "").strip()]
    wc_without_sku = [p for p in wc_products if not (p.get("sku") or "").strip()]

    # WC → SIIGO name match
    wc_siigo_matches = []
    wc_siigo_no_match = []
    for wcp in wc_products:
        wc_name = wcp.get("name", "")
        siigo_match, score = best_name_match(wc_name, siigo_products, key="name")
        if siigo_match:
            wc_siigo_matches.append({
                "wc_id": wcp.get("id"),
                "wc_name": wc_name,
                "wc_sku": wcp.get("sku", ""),
                "wc_stock": wcp.get("stock_quantity"),
                "siigo_code": siigo_match.get("code", ""),
                "siigo_name": siigo_match.get("name", ""),
                "score": round(score, 2),
            })
        else:
            wc_siigo_no_match.append({
                "wc_id": wcp.get("id"),
                "wc_name": wc_name,
                "wc_sku": wcp.get("sku", ""),
            })

    # WC → MeLi name match (build MeLi name list)
    meli_for_matching = [{"id": i.get("id"), "name": i.get("title", "")} for i in meli_items]
    wc_meli_matches = []
    for wcp in wc_products:
        wc_name = wcp.get("name", "")
        meli_match, score = best_name_match(wc_name, meli_for_matching, key="name")
        if meli_match:
            wc_meli_matches.append({
                "wc_name": wc_name,
                "wc_sku": wcp.get("sku", ""),
                "meli_id": meli_match.get("id", ""),
                "meli_title": meli_match.get("name", ""),
                "score": round(score, 2),
            })

    # ── PRINT REPORT ──────────────────────────────────────────────────────────

    separator("═")
    print("  SECTION 1: MERCADO LIBRE LISTINGS")
    separator()
    total_meli = len(meli_items)
    pct_sku = (len(meli_with_sku) / total_meli * 100) if total_meli else 0
    pct_in_siigo = (len(meli_sku_in_siigo) / len(meli_with_sku) * 100) if meli_with_sku else 0

    print(f"  Total active MeLi listings         : {total_meli}")
    print(f"  Listings WITH SKU                  : {len(meli_with_sku)}  ({pct_sku:.1f}%)")
    print(f"  Listings WITHOUT SKU               : {len(meli_without_sku)}")
    print(f"  MeLi SKUs found in SIIGO           : {len(meli_sku_in_siigo)}  ({pct_in_siigo:.1f}% of SKU'd listings)")
    print(f"  MeLi SKUs NOT in SIIGO             : {len(meli_sku_not_in_siigo)}")

    separator()
    print("  MeLi SKUs MATCHED in SIIGO:")
    separator("·")
    if meli_sku_in_siigo:
        for e in sorted(meli_sku_in_siigo, key=lambda x: x["sku"]):
            print(f"  SKU: {e['sku']:<20}  MeLi: {e['title'][:40]:<42}  SIIGO: {e['siigo_name'][:35]}")
    else:
        print("  (none)")

    separator()
    print("  MeLi SKUs NOT found in SIIGO:")
    separator("·")
    if meli_sku_not_in_siigo:
        for e in sorted(meli_sku_not_in_siigo, key=lambda x: x["sku"]):
            print(f"  SKU: {e['sku']:<20}  MeLi title: {e['title'][:50]}")
    else:
        print("  (all MeLi SKUs exist in SIIGO — perfect match!)")

    separator()
    print("  MeLi listings WITHOUT any SKU (sample — first 30):")
    separator("·")
    for e in meli_without_sku[:30]:
        print(f"  ID: {e['id']}   Title: {e['title'][:60]}")
    if len(meli_without_sku) > 30:
        print(f"  … and {len(meli_without_sku) - 30} more.")

    separator("═")
    print("  SECTION 2: SIIGO PRODUCT CATALOG")
    separator()
    print(f"  Total SIIGO products               : {len(siigo_products)}")
    siigo_with_code = [p for p in siigo_products if (p.get("code") or "").strip()]
    print(f"  Products with code (SKU)           : {len(siigo_with_code)}")
    separator()
    print("  Full SIIGO product list:")
    separator("·")
    for p in sorted(siigo_products, key=lambda x: (x.get("code") or "")):
        code = (p.get("code") or "").strip()
        name = (p.get("name") or "").strip()
        active = p.get("active", True)
        ptype = p.get("type", "")
        print(f"  Code: {code:<20}  Active: {str(active):<6}  Type: {ptype:<12}  Name: {name[:45]}")

    separator("═")
    print("  SECTION 3: WOOCOMMERCE PRODUCTS")
    separator()
    total_wc = len(wc_products)
    print(f"  Total WooCommerce products         : {total_wc}")
    print(f"  Products WITH SKU                  : {len(wc_with_sku)}")
    print(f"  Products WITHOUT SKU               : {len(wc_without_sku)}")
    print(f"  WC products matched → SIIGO (name) : {len(wc_siigo_matches)}")
    print(f"  WC products unmatched → SIIGO      : {len(wc_siigo_no_match)}")
    print(f"  WC products matched → MeLi  (name) : {len(wc_meli_matches)}")

    separator()
    print(f"  WooCommerce ↔ SIIGO Name Matches (threshold ≥ {MATCH_THRESHOLD}):")
    separator("·")
    if wc_siigo_matches:
        for m in sorted(wc_siigo_matches, key=lambda x: -x["score"]):
            print(f"  Score:{m['score']:.2f}  WC:{m['wc_name'][:35]:<37}  SIIGO code:{m['siigo_code']:<12}  SIIGO:{m['siigo_name'][:30]}")
    else:
        print("  (no name matches found)")

    separator()
    print("  WooCommerce products with NO SIIGO match:")
    separator("·")
    if wc_siigo_no_match:
        for m in wc_siigo_no_match:
            sku_str = f" [SKU:{m['wc_sku']}]" if m["wc_sku"] else ""
            print(f"  WC id:{m['wc_id']}  {m['wc_name'][:55]}{sku_str}")
    else:
        print("  (all WC products matched to SIIGO)")

    separator()
    print(f"  WooCommerce ↔ MeLi Name Matches (threshold ≥ {MATCH_THRESHOLD}):")
    separator("·")
    if wc_meli_matches:
        for m in sorted(wc_meli_matches, key=lambda x: -x["score"])[:50]:
            print(f"  Score:{m['score']:.2f}  WC:{m['wc_name'][:35]:<37}  MeLi ID:{m['meli_id']}  {m['meli_title'][:35]}")
        if len(wc_meli_matches) > 50:
            print(f"  … and {len(wc_meli_matches)-50} more matches.")
    else:
        print("  (no name matches found)")

    separator("═")
    print("  SUMMARY")
    separator()
    print(f"  MeLi total active listings         : {total_meli}")
    print(f"  MeLi with SKU                      : {len(meli_with_sku)} ({pct_sku:.1f}%)")
    print(f"  MeLi SKU → SIIGO match             : {len(meli_sku_in_siigo)} / {len(meli_with_sku)} ({pct_in_siigo:.1f}%)")
    print(f"  MeLi SKU NOT in SIIGO              : {len(meli_sku_not_in_siigo)}")
    print(f"  SIIGO total products               : {len(siigo_products)}")
    print(f"  WooCommerce total products         : {total_wc}")
    print(f"  WC → SIIGO name match              : {len(wc_siigo_matches)} / {total_wc}")
    print(f"  WC → MeLi name match               : {len(wc_meli_matches)} / {total_wc}")
    separator("═")
    print("  Done.")


if __name__ == "__main__":
    main()
