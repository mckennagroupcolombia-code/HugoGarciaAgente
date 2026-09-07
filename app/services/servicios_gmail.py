"""
Detecta suscripciones / recibos de pago en Gmail McKenna y los carga en
Operativos → Servicios (contabilidad.db).

No usa LLM. Dedup por comprobante `gmail:{message_id}`.
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any

from app.services.contabilidad_db import (
    listar_servicios,
    registrar_pago,
    upsert_servicio,
)

log = logging.getLogger(__name__)

# Proveedores conocidos (consulta Gmail acotada + tipo/empresa panel).
PROVEEDORES: list[dict[str, Any]] = [
    {
        "clave": "starlink",
        "empresa": "Starlink",
        "tipo": "internet",
        "q": "from:starlink.com (invoice OR payment OR receipt OR billed OR processed)",
        "max": 20,
    },
    {
        "clave": "cursor",
        "empresa": "Cursor",
        "tipo": "saas",
        "q": "from:(cursor.com OR mail.cursor.com) (invoice OR receipt OR payment OR billing OR paid OR subscription OR charge)",
        "max": 20,
    },
    {
        "clave": "openai",
        "empresa": "OpenAI",
        "tipo": "saas",
        "q": "from:(openai.com OR tm.openai.com) (invoice OR receipt OR payment OR billing OR paid OR subscription)",
        "max": 15,
    },
    {
        "clave": "anthropic",
        "empresa": "Anthropic",
        "tipo": "saas",
        "q": "from:anthropic.com (invoice OR receipt OR payment OR billing OR paid OR subscription)",
        "max": 15,
    },
    {
        "clave": "google",
        "empresa": "Google Workspace / Cloud",
        "tipo": "saas",
        "q": "from:(payments-noreply@google.com OR google.com) (\"Google Workspace\" OR \"Google Cloud\" OR \"Google One\" OR \"Your Google invoice\" OR \"Google payment\")",
        "max": 15,
    },
    {
        "clave": "cloudflare",
        "empresa": "Cloudflare",
        "tipo": "saas",
        "q": "from:cloudflare.com (invoice OR receipt OR payment OR billing)",
        "max": 12,
    },
    {
        "clave": "github",
        "empresa": "GitHub",
        "tipo": "saas",
        "q": "from:github.com (invoice OR receipt OR payment OR billing OR \"GitHub Copilot\" OR \"payment receipt\")",
        "max": 15,
    },
    {
        "clave": "ideogram",
        "empresa": "Ideogram",
        "tipo": "saas",
        "q": "from:ideogram.ai (invoice OR receipt OR payment OR billing)",
        "max": 10,
    },
    {
        "clave": "elevenlabs",
        "empresa": "ElevenLabs",
        "tipo": "saas",
        "q": "from:elevenlabs.io (invoice OR receipt OR payment OR billing)",
        "max": 10,
    },
    {
        "clave": "fal",
        "empresa": "fal.ai",
        "tipo": "saas",
        "q": "from:(fal.ai OR mail.fal.ai) (invoice OR receipt OR payment OR billing)",
        "max": 10,
    },
    {
        "clave": "paypal",
        "empresa": "PayPal (suscripciones)",
        "tipo": "saas",
        "q": "from:paypal.com (suscripción OR subscription OR \"pago recurrente\" OR \"recurring payment\" OR \"you've paid\")",
        "max": 12,
    },
    {
        "clave": "stripe",
        "empresa": "Stripe (cargos)",
        "tipo": "saas",
        "q": "from:stripe.com subject:(receipt OR invoice OR paid) -newsletter",
        "max": 15,
    },
]

_RE_USD = re.compile(
    r"(?<![A-Z])(?:USD|US\$)\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)"
    r"|(?<![A-Z0-9])\$\s*([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})(?!\d)",
    re.I,
)
_RE_COP = re.compile(
    r"(?:COP|COL\$)\s*\$?\s*"
    r"([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?"  # 224,000.00
    r"|[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{2})?"  # 224.000,00
    r"|[0-9]+(?:\.[0-9]{2})?)",  # 224000.00 / 224000
    re.I,
)
_RE_COP_PESOS = re.compile(
    r"\$\s*([0-9]{1,3}(?:\.[0-9]{3})+)(?:,[0-9]{2})?\b",
)
_RE_SUBJECT_PAGO = re.compile(
    r"invoice|receipt|payment|paid|billing|billed|cargo|factura|recibo|suscrip|"
    r"subscription|processed|charge|comprobante|renov|activation confirmation",
    re.I,
)
# Marketing / ruido que no es recibo de pago
_RE_SUBJECT_NOISE = re.compile(
    r"newsletter|now includes|introducing|build a |extending |catch bugs|"
    r"mobile app|customize page|data usage|set your|password|turned off|"
    r"was canceled|se cancelar|descubre la manera|action needed",
    re.I,
)


def _to_float_money(raw: str, style: str) -> float | None:
    """style: 'us' = 1,234.56 | 'eu' = 1.234,56 | 'cop_plain' = 224000.00"""
    s = raw.strip().replace(" ", "").replace("\xa0", "")
    try:
        if style == "us":
            return float(s.replace(",", ""))
        if style == "eu":
            return float(s.replace(".", "").replace(",", "."))
        if style == "cop_plain":
            # COP 224,000.00 o COP 224000.00
            if "," in s and "." in s:
                return float(s.replace(",", ""))
            if "," in s and s.count(",") == 1 and len(s.split(",")[-1]) <= 2:
                return float(s.replace(",", "."))
            if "," in s:
                return float(s.replace(",", ""))
            return float(s)
    except ValueError:
        return None
    return None


def _parse_monto(texto: str) -> tuple[float | None, str]:
    """Devuelve (monto, moneda). COP etiquetado gana; si no, USD; fallback COP colombiano."""
    if not texto:
        return None, ""

    m = _RE_COP.search(texto)
    if m:
        val = _to_float_money(m.group(1), "cop_plain")
        if val is not None and val > 0:
            return val, "COP"

    m = _RE_USD.search(texto)
    if m:
        raw = next(g for g in m.groups() if g)
        val = _to_float_money(raw, "us")
        if val is not None and val > 0:
            # OpenAI LATAM a veces pone $99900.00 sin moneda (= COP)
            if "USD" not in texto.upper() and "US$" not in texto.upper() and val >= 10000:
                return val, "COP"
            return val, "USD"

    m = _RE_COP_PESOS.search(texto)
    if m:
        val = _to_float_money(m.group(1), "eu")
        if val is not None and val >= 1000:
            return val, "COP"
    return None, ""


def _hdrs(msg: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in (msg.get("payload") or {}).get("headers") or []:
        name = (h.get("name") or "").lower()
        if name in {"from", "subject", "date"}:
            out[name] = h.get("value") or ""
    return out


def _fecha_iso(date_hdr: str, internal_ms: str | None = None) -> str:
    if date_hdr:
        try:
            return parsedate_to_datetime(date_hdr).date().isoformat()
        except Exception:
            pass
    if internal_ms:
        try:
            return datetime.utcfromtimestamp(int(internal_ms) / 1000).date().isoformat()
        except Exception:
            pass
    return datetime.now().date().isoformat()


def _decode_parts(payload: dict | None, limit: int = 12000) -> str:
    if not payload:
        return ""
    chunks: list[str] = []

    def walk(part: dict) -> None:
        if sum(len(c) for c in chunks) >= limit:
            return
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        data = body.get("data")
        if data and mime.startswith("text/"):
            try:
                chunks.append(base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore"))
            except Exception:
                pass
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    return "\n".join(chunks)[:limit]


def _pago_ya_existe(comprobante: str) -> bool:
    from app.services.contabilidad_db import _conn, _ensure

    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT id FROM pagos_servicios WHERE comprobante = ? LIMIT 1",
            (comprobante,),
        ).fetchone()
    return row is not None


_RE_NUM_RECIBO = re.compile(r"#\s*([A-Za-z0-9][A-Za-z0-9-]{4,})")


def _numero_recibo(texto: str) -> str | None:
    """N° de factura/recibo (ej. 'PBC #2102-5744-9538') si el texto trae uno."""
    m = _RE_NUM_RECIBO.search(texto or "")
    return m.group(1) if m else None


def _pago_duplicado_probable(servicio_id: int, fecha: str, monto: float, subj: str) -> bool:
    """True si ya hay un pago del mismo servicio/fecha/monto que probablemente sea el
    mismo cobro (dos correos transaccionales del mismo proveedor para una sola compra:
    ej. 'activation confirmation' + 'payment processed'), no dos cargos reales aparte.

    Caso real que motivó esto (sep-2026): Starlink mandó "Service Activation Confirmation"
    y "Payment Processed" el mismo día por el mismo monto — dos IDs de Gmail distintos,
    cero número de factura en ninguno de los dos → quedaron dos pagos_servicios para un
    solo cobro real. Si ambos correos SÍ traen un número de factura/recibo (`_numero_recibo`)
    y son distintos, se asume que son cargos legítimos distintos (pasó con Anthropic:
    mismo día, mismo monto, pero recibos "#2102-5744-9538" vs "#2518-0902-0765").
    """
    from app.services.contabilidad_db import _conn, _ensure

    _ensure()
    with _conn() as con:
        rows = con.execute(
            """SELECT notas FROM pagos_servicios
               WHERE servicio_id = ? AND fecha = ? AND ABS(monto - ?) < 0.01""",
            (servicio_id, fecha, monto),
        ).fetchall()
    if not rows:
        return False
    nuevo_num = _numero_recibo(subj)
    for r in rows:
        existente_num = _numero_recibo(dict(r).get("notas") or "")
        if nuevo_num and existente_num and nuevo_num != existente_num:
            continue  # números distintos → cargos distintos, no es duplicado
        return True
    return False


def _servicio_por_empresa(empresa: str) -> dict | None:
    for s in listar_servicios(ver_todo=True):
        if (s.get("empresa") or "").strip().lower() == empresa.strip().lower():
            return s
    return None


def _asegurar_servicio(empresa: str, tipo: str, notas: str = "") -> dict:
    existente = _servicio_por_empresa(empresa)
    if existente:
        return existente
    return upsert_servicio(
        {
            "empresa": empresa,
            "tipo": tipo,
            "numero_contrato": "",
            "direccion": "",
            "activo": True,
            "dia_vencimiento": None,
            "notas": notas or "Importado desde Gmail (recibos de suscripción)",
        }
    )


def sincronizar_suscripciones_gmail(*, newer_than: str = "3y") -> dict:
    """Escanea Gmail y carga servicios + pagos. Retorna resumen para el panel."""
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    svc = get_gmail_service()
    resumen: dict[str, Any] = {
        "ok": True,
        "email": None,
        "proveedores": [],
        "servicios_creados": 0,
        "pagos_nuevos": 0,
        "pagos_omitidos": 0,
        "pagos_duplicados_omitidos": 0,
        "sin_monto": 0,
        "errores": [],
    }
    try:
        prof = svc.users().getProfile(userId="me").execute()
        resumen["email"] = prof.get("emailAddress")
    except Exception as e:
        resumen["errores"].append(f"perfil: {e}")

    for prov in PROVEEDORES:
        entrada = {
            "clave": prov["clave"],
            "empresa": prov["empresa"],
            "encontrados": 0,
            "pagos_nuevos": 0,
            "omitidos": 0,
            "duplicados_omitidos": 0,
            "sin_monto": 0,
            "muestras": [],
        }
        q = f"{prov['q']} newer_than:{newer_than}"
        try:
            resp = (
                svc.users()
                .messages()
                .list(userId="me", q=q, maxResults=int(prov["max"]))
                .execute()
            )
        except Exception as e:
            msg = f"{prov['clave']}: list {e}"
            log.warning(msg)
            resumen["errores"].append(msg)
            resumen["proveedores"].append(entrada)
            continue

        ids = [m["id"] for m in (resp.get("messages") or [])]
        entrada["encontrados"] = len(ids)
        if not ids:
            resumen["proveedores"].append(entrada)
            continue

        srv = None
        for mid in ids:
            try:
                msg = (
                    svc.users()
                    .messages()
                    .get(userId="me", id=mid, format="full")
                    .execute()
                )
            except Exception as e:
                resumen["errores"].append(f"{prov['clave']} get {mid}: {e}")
                continue

            h = _hdrs(msg)
            subj = h.get("subject") or ""
            snip = msg.get("snippet") or ""
            if _RE_SUBJECT_NOISE.search(subj):
                continue
            if not _RE_SUBJECT_PAGO.search(subj) and not _RE_SUBJECT_PAGO.search(snip):
                # Skip newsletters / noise without payment signal
                continue

            comprobante = f"gmail:{mid}"
            if _pago_ya_existe(comprobante):
                entrada["omitidos"] += 1
                resumen["pagos_omitidos"] += 1
                continue

            body = _decode_parts(msg.get("payload"))
            blob = "\n".join(
                [subj, snip, body, h.get("from") or ""]
            )
            monto, moneda = _parse_monto(blob)
            if monto is None or monto <= 0:
                entrada["sin_monto"] += 1
                resumen["sin_monto"] += 1
                if len(entrada["muestras"]) < 3:
                    entrada["muestras"].append(
                        {"subject": subj[:100], "fecha": h.get("date", "")[:30], "sin_monto": True}
                    )
                continue

            fecha = _fecha_iso(h.get("date", ""), msg.get("internalDate"))

            srv_existente = srv or _servicio_por_empresa(prov["empresa"])
            if srv_existente and _pago_duplicado_probable(
                int(srv_existente["id"]), fecha, float(monto), subj
            ):
                # Mismo servicio+fecha+monto que un pago ya registrado, y ninguno de los
                # dos correos trae un n° de factura/recibo que los distinga → probable
                # duplicado (dos correos transaccionales del mismo cobro, no dos cargos).
                entrada["duplicados_omitidos"] += 1
                resumen["pagos_duplicados_omitidos"] += 1
                if len(entrada["muestras"]) < 5:
                    entrada["muestras"].append(
                        {
                            "fecha": fecha,
                            "monto": monto,
                            "moneda": moneda,
                            "subject": subj[:100],
                            "duplicado_omitido": True,
                        }
                    )
                continue

            if srv is None:
                creado_antes = srv_existente is None
                srv = srv_existente or _asegurar_servicio(
                    prov["empresa"],
                    prov["tipo"],
                    notas=f"Origen Gmail · query {prov['clave']}",
                )
                if creado_antes:
                    resumen["servicios_creados"] += 1

            notas = f"{moneda} · {subj[:160]}"
            registrar_pago(
                int(srv["id"]),
                fecha,
                float(monto),
                comprobante=comprobante,
                notas=notas,
            )
            entrada["pagos_nuevos"] += 1
            resumen["pagos_nuevos"] += 1
            if len(entrada["muestras"]) < 5:
                entrada["muestras"].append(
                    {
                        "fecha": fecha,
                        "monto": monto,
                        "moneda": moneda,
                        "subject": subj[:100],
                    }
                )

        resumen["proveedores"].append(entrada)

    resumen["proveedores_con_hits"] = [
        p for p in resumen["proveedores"] if p.get("encontrados")
    ]
    return resumen
