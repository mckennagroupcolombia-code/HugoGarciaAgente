#!/usr/bin/env python3
"""
asignar_skus_woocommerce.py
Matches WooCommerce products to SIIGO products by name (fuzzy),
then assigns the SIIGO product code as the WC SKU via the WooCommerce REST API.

Rules:
 - Skip WC products that already have a SKU (never overwrite).
 - Skip matches with score < 0.65 (safe threshold for actual writes).
 - Print every decision and a final summary.
"""

import os
import sys
import json
import time
import unicodedata
import requests
from dotenv import load_dotenv
from woocommerce import API

# ── Env ──────────────────────────────────────────────────────────────────────
load_dotenv("/home/mckg/mi-agente/.env")
sys.path.insert(0, "/home/mckg/mi-agente")

SIIGO_CREDS_PATH = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
PARTNER_ID       = "SiigoAPI"
WRITE_THRESHOLD  = 0.65   # minimum score to actually write to WooCommerce
MATCH_THRESHOLD  = 0.55   # same as cross_reference_full.py (for display only)

WC_URL    = os.getenv("WC_URL", "").rstrip("/")
WC_KEY    = os.getenv("WC_KEY", "")
WC_SECRET = os.getenv("WC_SECRET", "")


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


def token_overlap_ratio(a: str, b: str) -> float:
    ta = set(normalize(a).split())
    tb = set(normalize(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def best_name_match(name: str, candidates: list, key: str = "name") -> tuple:
    """
    Returns (best_candidate_dict, score) using the same logic as cross_reference_full.py.
    Returns (None, 0.0) if no candidate reaches MATCH_THRESHOLD.
    """
    best_score = 0.0
    best_item  = None
    for cand in candidates:
        score = token_overlap_ratio(name, cand.get(key, ""))
        if score > best_score:
            best_score = score
            best_item  = cand
    if best_score >= MATCH_THRESHOLD:
        return best_item, best_score
    return None, 0.0


def separator(char="─", width=72):
    print(char * width)


# ─────────────────────────────────────────────────────────────────────────────
# DATA LOADERS  (same as cross_reference_full.py)
# ─────────────────────────────────────────────────────────────────────────────

def get_siigo_token() -> str:
    print("[SIIGO] Authenticating …")
    with open(SIIGO_CREDS_PATH) as f:
        creds = json.load(f)

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
    print("[SIIGO] Fetching all products …")
    headers   = {"Partner-Id": PARTNER_ID, "Authorization": f"Bearer {token}"}
    all_prods = []
    page      = 1

    while True:
        url = f"https://api.siigo.com/v1/products?page={page}&page_size=100"
        r   = requests.get(url, headers=headers, timeout=20)
        if r.status_code != 200:
            print(f"  [SIIGO] Error page {page}: {r.status_code} {r.text[:120]}")
            break
        data    = r.json()
        results = data.get("results", [])
        if not results:
            break
        all_prods.extend(results)
        total = data.get("pagination", {}).get("total_results", 0)
        if len(all_prods) >= total:
            break
        page += 1
        time.sleep(0.2)

    print(f"  [SIIGO] {len(all_prods)} products loaded.")
    return all_prods


def get_woocommerce_products(wcapi) -> list:
    print("[WC] Fetching all WooCommerce products …")
    all_prods = []
    page      = 1

    while True:
        r = wcapi.get("products", params={
            "status":   "publish",
            "per_page": 100,
            "page":     page,
            "_fields":  "id,name,sku",
        })
        if r.status_code != 200:
            print(f"  [WC] Error page {page}: {r.status_code} {r.text[:120]}")
            break
        batch = r.json()
        if not batch:
            break
        all_prods.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.3)

    print(f"  [WC] {len(all_prods)} products loaded.")
    return all_prods


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    separator("═")
    print("  ASIGNAR SKUs WOOCOMMERCE ← SIIGO  (threshold for writes: ≥ 0.65)")
    separator("═")

    if not all([WC_URL, WC_KEY, WC_SECRET]):
        print("ERROR: Missing WC_URL / WC_KEY / WC_SECRET in .env — aborting.")
        sys.exit(1)

    # ── Initialise WC API client ──────────────────────────────────────────────
    wcapi = API(
        url=WC_URL,
        consumer_key=WC_KEY,
        consumer_secret=WC_SECRET,
        version="wc/v3",
        timeout=30,
    )

    # ── Load data ─────────────────────────────────────────────────────────────
    siigo_token    = get_siigo_token()
    siigo_products = get_siigo_products(siigo_token)
    wc_products    = get_woocommerce_products(wcapi)

    # ── Match + decide ────────────────────────────────────────────────────────
    separator("═")
    print("  MATCHING DECISIONS")
    separator()

    updated       = []   # (wc_id, wc_name, sku, score)
    skipped_sku   = []   # already had SKU
    below_thresh  = []   # match found but score < 0.65
    no_match      = []   # no match at all (score < 0.55)

    for wcp in wc_products:
        wc_id   = wcp.get("id")
        wc_name = (wcp.get("name") or "").strip()
        wc_sku  = (wcp.get("sku")  or "").strip()

        # Rule 1: skip if already has a SKU
        if wc_sku:
            skipped_sku.append((wc_id, wc_name, wc_sku))
            print(f"  [SKIP-HAS-SKU]    id={wc_id:<6}  SKU={wc_sku:<20}  \"{wc_name[:45]}\"")
            continue

        # Find best SIIGO match
        siigo_match, score = best_name_match(wc_name, siigo_products, key="name")

        if siigo_match is None:
            # score < 0.55 — no match at all
            no_match.append((wc_id, wc_name))
            print(f"  [NO-MATCH]        id={wc_id:<6}  score=0.00   \"{wc_name[:55]}\"")
            continue

        sku_siigo   = (siigo_match.get("code") or "").strip()
        siigo_name  = (siigo_match.get("name") or "").strip()

        if score < WRITE_THRESHOLD:
            # Between 0.55 and 0.65 — log but do not write
            below_thresh.append((wc_id, wc_name, sku_siigo, score, siigo_name))
            print(f"  [BELOW-0.65]      id={wc_id:<6}  score={score:.2f}   "
                  f"\"{wc_name[:35]}\"  →  SIIGO:{sku_siigo} \"{siigo_name[:30]}\"")
            continue

        # Score ≥ 0.65 — write the SKU
        if not sku_siigo:
            print(f"  [SKIP-NO-CODE]    id={wc_id:<6}  score={score:.2f}   "
                  f"\"{wc_name[:35]}\"  →  SIIGO product has no code, skipping.")
            no_match.append((wc_id, wc_name))
            continue

        print(f"  [UPDATE]          id={wc_id:<6}  score={score:.2f}   "
              f"\"{wc_name[:35]}\"  →  SKU={sku_siigo}  \"{siigo_name[:30]}\"")

        # ── Actual API call ───────────────────────────────────────────────────
        try:
            resp = wcapi.put(f"products/{wc_id}", {"sku": sku_siigo})
            resp_data = resp.json()
            if resp.status_code in (200, 201):
                confirmed_sku = (resp_data.get("sku") or "").strip()
                print(f"             ✓ WC confirmed SKU = \"{confirmed_sku}\"")
                updated.append((wc_id, wc_name, sku_siigo, score))
            else:
                print(f"             ✗ WC API error {resp.status_code}: "
                      f"{json.dumps(resp_data)[:120]}")
                no_match.append((wc_id, wc_name))
        except Exception as e:
            print(f"             ✗ Exception updating id={wc_id}: {e}")
            no_match.append((wc_id, wc_name))

        time.sleep(0.4)   # be gentle with the WC server

    # ── Final summary ─────────────────────────────────────────────────────────
    separator("═")
    print("  FINAL SUMMARY")
    separator()
    print(f"  WooCommerce products total         : {len(wc_products)}")
    print(f"  Updated (SKU assigned)             : {len(updated)}")
    print(f"  Skipped (already had SKU)          : {len(skipped_sku)}")
    print(f"  Below threshold (0.55–0.65, no write): {len(below_thresh)}")
    print(f"  No match at all (< 0.55)           : {len(no_match)}")

    if updated:
        separator()
        print("  Products that got a new SKU:")
        separator("·")
        for wc_id, wc_name, sku, score in sorted(updated, key=lambda x: -x[3]):
            print(f"  id={wc_id:<6}  SKU={sku:<20}  score={score:.2f}  \"{wc_name[:45]}\"")

    if below_thresh:
        separator()
        print("  Products matched but below 0.65 (NOT written — review manually):")
        separator("·")
        for wc_id, wc_name, sku, score, siigo_name in sorted(below_thresh, key=lambda x: -x[3]):
            print(f"  id={wc_id:<6}  SIIGO={sku:<20}  score={score:.2f}  "
                  f"\"{wc_name[:30]}\"  →  \"{siigo_name[:30]}\"")

    separator("═")
    print("  Done.")


if __name__ == "__main__":
    main()
