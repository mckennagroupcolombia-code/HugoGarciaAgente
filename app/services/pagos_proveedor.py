"""Solicitud de pago a proveedor — proveedores, productos con SKU y verificación de la factura.

Complementa `pagos_wizard.py` para el caso que más plata mueve: pagarle a un proveedor una
compra. La regla (sep-2026): **una solicitud de pago a proveedor solo existe en Contabilidad →
Solicitudes de pago**, con proveedor elegido del listado (terceros del Libro Mayor + contactos
de Alegra), productos con su SKU del catálogo espejo de Alegra, y la factura o cotización del
proveedor cotejada contra lo pedido ANTES de enviarla al aprobador.

Tres piezas, ninguna llama a un LLM:

  proveedores(q)          terceros tipo proveedor del Libro Mayor + contactos «provider» de Alegra
                          (cache local 1 h en app/data/alegra_contactos_cache.json). Un contacto
                          de Alegra que aún no es tercero se adopta con `adoptar_contacto_alegra`.
  productos(q)            espejo local del catálogo Alegra (`alegra_catalogo_db`), con costo unitario.
  verificar_factura(...)  lee el archivo del proveedor (XML DIAN, PDF, ZIP con cualquiera de los dos)
                          y coteja: NIT del proveedor, número de factura/cotización, total, y cada
                          producto pedido (SKU o nombre, cantidad, precio). Devuelve `fiel` y la lista
                          de diferencias. El PDF se lee con pdftotext; si el proveedor manda una foto
                          o un PDF escaneado no hay texto y se dice claramente, no se adivina.
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[2]
_CACHE_CONTACTOS = _ROOT / "app" / "data" / "alegra_contactos_cache.json"
_CACHE_TTL = 3600
DIR_FACTURAS = _ROOT / "comprobantes" / "solicitudes_pago"

EXT_OK = {".pdf", ".xml", ".zip"}


# ───────────────────────────────────────────── proveedores ───────────────


def _contactos_alegra(forzar: bool = False) -> list[dict]:
    """Contactos proveedor de Alegra, con cache de una hora (la API es lenta y paginada)."""
    try:
        if not forzar and _CACHE_CONTACTOS.exists():
            data = json.loads(_CACHE_CONTACTOS.read_text(encoding="utf-8"))
            if time.time() - float(data.get("ts") or 0) < _CACHE_TTL:
                return data.get("contactos", [])
    except Exception:
        pass
    contactos: list[dict] = []
    try:
        import requests
        from app.services.alegra import _alegra_headers

        headers = _alegra_headers()
        start = 0
        while True:
            r = requests.get(
                "https://api.alegra.com/api/v1/contacts",
                headers=headers, params={"type": "provider", "limit": 30, "start": start}, timeout=20,
            )
            if r.status_code != 200:
                break
            lote = r.json() if isinstance(r.json(), list) else []
            for c in lote:
                ident = (c.get("identificationObject") or {}).get("number") or c.get("identification") or ""
                contactos.append({
                    "alegra_id": str(c.get("id")),
                    "nombre": (c.get("name") or "").strip(),
                    "identificacion": re.sub(r"\D", "", str(ident)),
                    "tipo_persona": "natural" if (c.get("kindOfPerson") or "") == "PERSON_ENTITY" else "juridica",
                    "email": (c.get("email") or "").strip(),
                    "telefono": (c.get("phonePrimary") or c.get("mobile") or "").strip(),
                })
            if len(lote) < 30:
                break
            start += 30
        _CACHE_CONTACTOS.write_text(json.dumps({"ts": time.time(), "contactos": contactos}, ensure_ascii=False),
                                    encoding="utf-8")
    except Exception:
        pass
    return contactos


def proveedores(q: str = "") -> list[dict]:
    """Un solo listado: terceros proveedor del libro (con su saldo en 2205) + contactos de Alegra
    que todavía no son terceros. `en_libro` dice cuál es cuál."""
    import app.services.contabilidad_core as cc

    cc._ensure()
    qn = _norm(q)
    with cc._conn() as con:
        saldos = {
            r["tercero_id"]: float(r["saldo"] or 0)
            for r in con.execute(
                """SELECT COALESCE(l.tercero_id, m.tercero_id) AS tercero_id,
                          SUM(l.credito) - SUM(l.debito) AS saldo
                     FROM cc_movimiento_lineas l
                     JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                     JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                    WHERE c.codigo = '2205' GROUP BY 1"""
            )
        }
    out: list[dict] = []
    vistos_ident: set[str] = set()
    for t in cc.listar_terceros(solo_activos=True):
        if t.get("tipo") not in ("proveedor", "socio", "otro"):
            continue
        ident = re.sub(r"\D", "", t.get("identificacion") or "")
        if qn and qn not in _norm(t["nombre"]) and qn not in ident:
            continue
        vistos_ident.add(ident)
        out.append({
            "id": t["id"], "nombre": t["nombre"], "identificacion": t.get("identificacion") or "",
            "tipo_persona": t.get("tipo_persona") or "", "regimen_simple": int(t.get("regimen_simple") or 0),
            "saldo_2205": round(saldos.get(t["id"], 0.0)), "en_libro": True, "alegra_id": None,
            # Perfil tributario guardado: el wizard lo usa para dejar las
            # casillas de impuestos ya puestas y no depender de que alguien se
            # acuerde de marcarlas cada quincena.
            "retefuente_exento": int(t.get("retefuente_exento") or 0),
            "ica_por_mil": float(t.get("ica_por_mil") or 0),
            "gmf_por_defecto": int(t.get("gmf_por_defecto") or 0),
            "cuenta_gasto_default": t.get("cuenta_gasto_default") or "",
        })
    for c in _contactos_alegra():
        if c["identificacion"] and c["identificacion"] in vistos_ident:
            continue
        if qn and qn not in _norm(c["nombre"]) and qn not in c["identificacion"]:
            continue
        out.append({**c, "id": None, "saldo_2205": 0, "en_libro": False})
    out.sort(key=lambda x: (not x["en_libro"], -abs(x["saldo_2205"]), x["nombre"].lower()))
    return out[:60]


def adoptar_contacto_alegra(alegra_id: str) -> dict:
    """Crea el tercero en el Libro Mayor a partir del contacto de Alegra (o devuelve el que ya exista)."""
    import app.services.contabilidad_core as cc

    c = next((x for x in _contactos_alegra() if x["alegra_id"] == str(alegra_id)), None)
    if not c:
        raise ValueError("Ese contacto de Alegra no está en el listado")
    if c["identificacion"]:
        for t in cc.listar_terceros(solo_activos=False):
            if re.sub(r"\D", "", t.get("identificacion") or "") == c["identificacion"]:
                return t
    return cc.crear_tercero({
        "nombre": c["nombre"], "tipo": "proveedor", "identificacion": c["identificacion"],
        "tipo_persona": c["tipo_persona"], "email": c["email"], "telefono": c["telefono"],
        "notas": f"Adoptado del contacto Alegra #{c['alegra_id']} desde Solicitudes de pago",
    })


# ───────────────────────────────────────────── productos ─────────────────


def productos(q: str = "", limit: int = 25) -> list[dict]:
    from app.services import alegra_catalogo_db as cat

    if not (q or "").strip():
        return []
    # Búsqueda por palabras en cualquier orden: «farma 30» encuentra «FARMA AZUL 30mL».
    tokens = [t for t in _norm(q).split() if t]
    data = cat.listar_items(q=tokens[0], limit=300, offset=0)
    items = data.get("items") if isinstance(data, dict) else data
    out = []
    for it in items or []:
        texto = _norm(f"{it.get('reference') or ''} {it.get('name') or ''}")
        if not all(t in texto for t in tokens):
            continue
        if len(out) >= limit:
            break
        out.append({
            "sku": it.get("reference") or "", "nombre": it.get("name") or "",
            "tipo": it.get("type") or "", "unidad": it.get("unit") or "",
            "costo_unitario": round(float(it.get("unit_cost") or 0), 2),
            "precio": round(float(it.get("price") or it.get("precio") or 0), 2),
        })
    return out


def normalizar_items(items: Any) -> list[dict]:
    """Líneas del pedido como las guarda la solicitud: sku, nombre, cantidad, precio (sin IVA),
    iva_pct (19 por defecto; 0 para excluidos), subtotal, iva, total. El monto a pagar es la suma
    de `total` (con IVA), que es lo que dice la factura; la retención se calcula sobre `subtotal`."""
    out: list[dict] = []
    if not isinstance(items, list):
        return out
    for i, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        sku = str(raw.get("sku") or "").strip()
        nombre = str(raw.get("nombre") or "").strip()
        if not sku and not nombre:
            continue
        try:
            cantidad = float(str(raw.get("cantidad") or 0).replace(",", "."))
            precio = float(str(raw.get("precio") or 0).replace(",", "."))
        except ValueError:
            raise ValueError(f"Producto {i + 1}: cantidad o precio no numéricos")
        if cantidad <= 0:
            raise ValueError(f"Producto {i + 1} ({sku or nombre}): la cantidad debe ser mayor que cero")
        if precio < 0:
            raise ValueError(f"Producto {i + 1} ({sku or nombre}): el precio no puede ser negativo")
        try:
            iva_pct = float(str(raw.get("iva_pct", 19) if raw.get("iva_pct", 19) not in ("", None) else 19).replace(",", "."))
        except ValueError:
            raise ValueError(f"Producto {i + 1}: IVA no numérico")
        if iva_pct < 0 or iva_pct > 30:
            raise ValueError(f"Producto {i + 1}: IVA fuera de rango")
        subtotal = round(cantidad * precio, 2)
        iva = round(subtotal * iva_pct / 100, 2)
        out.append({
            "sku": sku, "nombre": nombre, "cantidad": cantidad, "precio": round(precio, 2),
            "unidad": str(raw.get("unidad") or "").strip(),
            "iva_pct": iva_pct, "subtotal": subtotal, "iva": iva, "total": round(subtotal + iva, 2),
        })
    return out


# ───────────────────────────────────────────── verificación ──────────────


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s.lower()).strip()


def _texto_pdf(data: bytes) -> str:
    if not shutil.which("pdftotext"):
        return ""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(data)
        path = tf.name
    try:
        r = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=60)
        return r.stdout if r.returncode == 0 else ""
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _leer_archivo(contenido: bytes, nombre: str) -> dict:
    """{texto, xml (dict o None), origen}. Un ZIP de la DIAN trae XML + PDF: se usan los dos."""
    ext = Path(nombre or "").suffix.lower()
    texto, xml, origen = "", None, ext.lstrip(".") or "desconocido"
    partes: list[tuple[str, bytes]] = []
    if ext == ".zip":
        try:
            with zipfile.ZipFile(io.BytesIO(contenido)) as zf:
                for n in zf.namelist():
                    if Path(n).suffix.lower() in (".xml", ".pdf"):
                        partes.append((n, zf.read(n)))
        except zipfile.BadZipFile:
            raise ValueError("El ZIP está dañado")
    else:
        partes.append((nombre, contenido))
    for n, data in partes:
        e = Path(n).suffix.lower()
        if e == ".xml":
            try:
                from app.services.siigo import _xml_extraer_resumen_factura

                # El AttachedDocument de la DIAN trae la factura embebida y escapada.
                raw = data
                if b"AttachedDocument" in raw and b"&lt;Invoice" in raw:
                    m = re.search(rb"<cbc:Description><!\[CDATA\[(.*?)\]\]></cbc:Description>", raw, re.S)
                    if m:
                        raw = m.group(1)
                xml = _xml_extraer_resumen_factura(raw)
                origen = "xml"
            except Exception:
                texto += data.decode("utf-8", "ignore")
        elif e == ".pdf":
            texto += "\n" + _texto_pdf(data)
    return {"texto": texto, "xml": xml, "origen": origen}


def _variantes_numero(v: float) -> list[str]:
    n = round(float(v))
    con_puntos = f"{n:,}".replace(",", ".")
    con_comas = f"{n:,}"
    return [con_puntos, con_comas, str(n), f"{con_puntos},00", f"{con_comas}.00"]


def _numero_en_texto(texto: str, v: float) -> bool:
    if v <= 0:
        return False
    for var in _variantes_numero(v):
        if re.search(r"(?<![\d.,])" + re.escape(var) + r"(?![\d])", texto):
            return True
    return False


def _numero_documento(texto: str) -> str:
    pats = [
        r"(?:factura|cotizaci[oó]n|remisi[oó]n|proforma|cuenta de cobro)[^\n]{0,40}?(?:n[o°º]\.?|#|numero|número)?\s*[:\-]?\s*([A-Z]{1,5}\s?-?\s?\d{2,10})",
        r"\b(FE|FEV|FV|FA|FC|BO|COT|CT|PF|A|N)\s?-?\s?(\d{3,10})\b",
    ]
    for p in pats:
        m = re.search(p, texto, re.I)
        if m:
            return re.sub(r"\s+", "", "".join(g for g in m.groups() if g)).upper()
    return ""


def verificar_factura(contenido: bytes, nombre: str, items: list[dict], monto: float,
                      tercero: dict | None) -> dict:
    """Coteja el archivo del proveedor contra lo pedido. Nunca falla por 'no entendí': si no hay
    texto legible lo dice y deja `fiel=False` con el motivo."""
    if not contenido:
        raise ValueError("Archivo vacío")
    if Path(nombre or "").suffix.lower() not in EXT_OK:
        raise ValueError("Adjunta la factura o cotización en PDF, XML de la DIAN o ZIP")
    leido = _leer_archivo(contenido, nombre)
    texto = leido["texto"] or ""
    xml = leido["xml"]
    if xml:
        # El XML manda: sus líneas y totales son exactos.
        texto += "\n" + "\n".join(
            f"{l.get('descripcion','')} {l.get('cantidad','')} {l.get('precio','')} {l.get('valor','')}" for l in xml.get("lineas", [])
        )
        texto += f"\n{xml.get('numero','')} {xml.get('total','')} {xml.get('subtotal','')} " \
                 f"{(xml.get('proveedor') or {}).get('nit','')} {(xml.get('proveedor') or {}).get('nombre','')}"
    tn = _norm(texto)
    advertencias: list[str] = []
    if len(tn) < 40:
        advertencias.append("El archivo no tiene texto legible (¿foto o PDF escaneado?). No se pudo cotejar.")
        return {"fiel": False, "legible": False, "origen": leido["origen"], "advertencias": advertencias,
                "numero_documento": "", "nit_ok": None, "total_ok": False, "total_detectado": None,
                "items": [{**it, "encontrado": False, "cantidad_ok": False, "precio_ok": False} for it in items]}

    # NIT del proveedor
    nit_ok = None
    ident = re.sub(r"\D", "", (tercero or {}).get("identificacion") or "")
    if ident:
        nit_ok = ident in re.sub(r"[.\s-]", "", texto)
        if not nit_ok:
            advertencias.append(f"El NIT/cédula del proveedor ({ident}) no aparece en el documento.")

    # Total
    total_xml = float(xml.get("total") or 0) if xml else 0.0
    total_ok = _numero_en_texto(texto, monto)
    if xml and total_xml and abs(total_xml - float(monto)) > 1:
        total_ok = False
        advertencias.append(f"El XML dice total {total_xml:,.0f} y la solicitud {float(monto):,.0f}.".replace(",", "."))
    elif not total_ok:
        advertencias.append(f"El total solicitado ({float(monto):,.0f}) no aparece en el documento.".replace(",", "."))

    # Productos
    cotejo = []
    for it in items:
        sku = _norm(it.get("sku"))
        nombre_it = _norm(it.get("nombre"))
        tokens = [t for t in re.split(r"[^a-z0-9]+", nombre_it) if len(t) > 2]
        enc_sku = bool(sku) and sku in tn
        enc_nombre = bool(tokens) and sum(1 for t in tokens if t in tn) >= max(1, round(len(tokens) * 0.6))
        encontrado = enc_sku or enc_nombre
        cant = float(it.get("cantidad") or 0)
        cantidad_ok = encontrado and (
            re.search(r"(?<![\d.,])" + re.escape(str(int(cant)) if cant == int(cant) else str(cant)) + r"(?![\d])", texto) is not None
        )
        precio_it, subtotal_it = float(it.get("precio") or 0), float(it.get("subtotal") or 0)
        precio_ok = encontrado and (_numero_en_texto(texto, precio_it) or _numero_en_texto(texto, subtotal_it))
        if not precio_ok and xml:
            # En el XML los precios vienen con decimales (828.571432): comparar como número.
            precio_ok = encontrado and any(
                abs(float(l.get("precio") or 0) - precio_it) < 1 or abs(float(l.get("valor") or 0) - subtotal_it) < 1
                for l in xml.get("lineas", [])
            )
        cotejo.append({**it, "encontrado": encontrado, "por": "sku" if enc_sku else ("nombre" if enc_nombre else ""),
                       "cantidad_ok": bool(cantidad_ok), "precio_ok": bool(precio_ok)})
        if not encontrado:
            advertencias.append(f"No se encontró «{it.get('sku') or it.get('nombre')}» en el documento.")
        elif not precio_ok:
            advertencias.append(f"«{it.get('sku') or it.get('nombre')}»: el precio {float(it.get('precio') or 0):,.0f} no aparece.".replace(",", "."))
    fiel = total_ok and all(c["encontrado"] for c in cotejo) and (nit_ok is not False) and bool(cotejo)
    if not cotejo:
        advertencias.append("La solicitud no tiene productos para cotejar.")
    return {
        "fiel": fiel, "legible": True, "origen": leido["origen"], "advertencias": advertencias,
        "numero_documento": (xml or {}).get("numero") or _numero_documento(texto),
        "fecha_documento": (xml or {}).get("fecha") or "",
        "nit_ok": nit_ok, "total_ok": total_ok, "total_detectado": total_xml or None,
        "proveedor_documento": ((xml or {}).get("proveedor") or {}).get("nombre") or "",
        "items": cotejo,
    }


# ───────────────────────────────────────────── archivos ──────────────────


def guardar_temporal(contenido: bytes, nombre: str) -> str:
    """Guarda el archivo del proveedor mientras se termina la solicitud. Devuelve el id temporal."""
    import uuid

    DIR_FACTURAS.mkdir(parents=True, exist_ok=True)
    ext = Path(nombre or "").suffix.lower()[:8]
    tid = f"tmp_{uuid.uuid4().hex}{ext}"
    (DIR_FACTURAS / tid).write_bytes(contenido)
    return tid


def ruta_temporal(tid: str) -> Path | None:
    if not tid or not re.fullmatch(r"tmp_[0-9a-f]{32}\.[a-z0-9]{1,7}", tid):
        return None
    p = DIR_FACTURAS / tid
    return p if p.exists() else None


def consolidar_archivo(tid: str, sid: int, nombre_original: str) -> tuple[str, str] | None:
    """tmp_… → <sid>_<nombre>. Devuelve (ruta relativa, nombre) o None."""
    p = ruta_temporal(tid)
    if not p:
        return None
    seguro = re.sub(r"[^A-Za-z0-9._-]+", "_", nombre_original or p.name)[:80] or p.name
    destino = DIR_FACTURAS / f"sol{sid}_{seguro}"
    p.replace(destino)
    try:
        return str(destino.relative_to(_ROOT)), seguro
    except ValueError:
        return str(destino), seguro
