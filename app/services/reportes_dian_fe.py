"""Reportes mensuales de facturación electrónica que la DIAN manda por correo.

Cada mes facturacionelectronica@dian.gov.co envía a la cuenta de McKenna el
«Reporte de facturación electrónica»: cuántas facturas, notas y documentos
soporte se GENERARON (ventas) y se RECIBIERON (compras) ese mes y en el año,
con su valor. Es lo que la DIAN ve de McKenna — y con lo que después cruza las
declaraciones —, así que es la tercera pata del cruce declaraciones ↔ banco ↔
DIAN (`declaraciones_impuestos.cruce_tripartito`).

Se lee del Gmail con el token OAuth del repo (sin LLM) y se guarda en
`docs/contabilidad/<año>/reportes_dian_fe.json` (gitignored, igual que las
declaraciones del contador). El valor que reporta la DIAN es el total de cada
documento, con impuestos.
"""

from __future__ import annotations

import base64
import html
import json
import re
from pathlib import Path

_DOCS = Path(__file__).resolve().parents[2] / "docs" / "contabilidad"
_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]
_TIPOS = {
    "factura electronica": "factura",
    "documento equivalente electronico": "doc_equivalente",
    "nota de credito electronica": "nota_credito",
    "nota de debito electronica": "nota_debito",
    "documento soporte": "doc_soporte",
    "nota de ajuste al documento soporte": "nota_ajuste_ds",
}


def _norm(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _valor(s: str) -> float:
    return float(s.replace("$", "").replace(".", "").replace(",", ".").strip() or 0)


def _texto(payload: dict) -> str:
    partes: list[str] = []

    def rec(p: dict) -> None:
        if p.get("body", {}).get("data"):
            partes.append(base64.urlsafe_b64decode(p["body"]["data"]).decode("utf-8", "ignore"))
        for x in p.get("parts") or []:
            rec(x)

    rec(payload)
    b = re.sub(r"<style.*?</style>", "", " ".join(partes), flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", b)))


def parsear(texto: str) -> dict | None:
    """Del cuerpo del correo a {anio, mes, generados:{tipo:{cant,valor,acum_cant,acum_valor}}, recibidos:{…}}."""
    t = _norm(texto)
    m = re.search(r"reporte correspondiente al mes de (\w+) del ano (\d{4})", t)
    if not m or m.group(1) not in _MESES:
        return None
    out = {"anio": int(m.group(2)), "mes": _MESES.index(m.group(1)) + 1, "generados": {}, "recibidos": {}}
    corte = re.search(r"generados con corte al (\d{2})/(\d{2})/(\d{4})", t)
    if corte:
        out["corte"] = f"{corte.group(3)}-{corte.group(2)}-{corte.group(1)}"
    # Celdas separadas por «|»: tras la etiqueta vienen 8 (cant/valor del mes y
    # acumulado, generados y recibidos). Se corta en la etiqueta exacta para que
    # «documento soporte» no case dentro de «nota de ajuste al documento soporte».
    for etiqueta, clave in _TIPOS.items():
        fm = re.search(r"(?:^|\|)\s*" + re.escape(etiqueta) + r"\s*\|", t)
        if not fm:
            continue
        celdas = [c.strip() for c in t[fm.end():fm.end() + 400].split("|") if c.strip()][:8]
        if len(celdas) < 8 or not all(re.fullmatch(r"\$?\s*[\d.,]+", c) for c in celdas):
            continue
        n = lambda c: int(c.replace(".", ""))  # noqa: E731
        out["generados"][clave] = {"cant": n(celdas[0]), "valor": _valor(celdas[1]),
                                   "acum_cant": n(celdas[2]), "acum_valor": _valor(celdas[3])}
        out["recibidos"][clave] = {"cant": n(celdas[4]), "valor": _valor(celdas[5]),
                                   "acum_cant": n(celdas[6]), "acum_valor": _valor(celdas[7])}
    return out if out["generados"] else None


def actualizar_desde_gmail(max_correos: int = 40) -> dict:
    """Baja y guarda los reportes que haya en el correo. Idempotente."""
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    s = get_gmail_service()
    q = 'from:facturacionelectronica@dian.gov.co subject:"Reporte de facturación electrónica"'
    ids = [m["id"] for m in s.users().messages().list(userId="me", q=q, maxResults=max_correos).execute().get("messages", [])]
    por_anio: dict[int, dict[str, dict]] = {}
    for f in _DOCS.glob("*/reportes_dian_fe.json"):
        try:
            por_anio[int(f.parent.name)] = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    nuevos = 0
    for mid in ids:
        msg = s.users().messages().get(userId="me", id=mid, format="full").execute()
        r = parsear(_texto(msg["payload"]))
        if not r:
            continue
        r["gmail_id"] = mid
        clave = f"{r['anio']:04d}-{r['mes']:02d}"
        anio = por_anio.setdefault(r["anio"], {})
        if clave not in anio:
            nuevos += 1
        anio[clave] = r
    for a, datos in por_anio.items():
        (_DOCS / str(a)).mkdir(parents=True, exist_ok=True)
        (_DOCS / str(a) / "reportes_dian_fe.json").write_text(
            json.dumps(dict(sorted(datos.items())), ensure_ascii=False, indent=1), encoding="utf-8")
    return {"correos": len(ids), "nuevos": nuevos, "meses": sorted(k for d in por_anio.values() for k in d)}


def por_mes() -> dict[str, dict]:
    """{AAAA-MM: {ventas, notas_credito, compras, notas_credito_recibidas, doc_soporte, …}} con los
    meses que faltan deducidos del acumulado (enero sale de febrero acumulado − febrero)."""
    crudo: dict[str, dict] = {}
    for f in sorted(_DOCS.glob("*/reportes_dian_fe.json")):
        try:
            crudo.update(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue

    def fila(gen: dict, rec: dict, campo: str) -> dict:
        g = lambda d, k: float((d.get(k) or {}).get(campo) or 0)  # noqa: E731
        return {
            "facturas_emitidas": g(gen, "factura"), "nc_emitidas": g(gen, "nota_credito"),
            "nd_emitidas": g(gen, "nota_debito"), "doc_soporte": g(gen, "doc_soporte"),
            "facturas_recibidas": g(rec, "factura"), "nc_recibidas": g(rec, "nota_credito"),
            "nd_recibidas": g(rec, "nota_debito"),
            "cant_facturas_emitidas": int(g(gen, "factura") if campo == "cant" else
                                          float((gen.get("factura") or {}).get("cant") or 0)),
            "cant_facturas_recibidas": int(float((rec.get("factura") or {}).get("cant") or 0)),
        }

    out: dict[str, dict] = {}
    for k, r in crudo.items():
        out[k] = {**fila(r["generados"], r["recibidos"], "valor"), "fuente": "reporte", "corte": r.get("corte")}
    # Meses sin correo: acumulado del mes siguiente − ese mes, si ambos están en el mismo año.
    for k, r in sorted(crudo.items()):
        a, m = map(int, k.split("-"))
        previo = f"{a:04d}-{m - 1:02d}" if m > 1 else None
        if not previo or previo in out:
            continue
        acum = fila(r["generados"], r["recibidos"], "acum_valor")
        mes = out[k]
        antes = [x for x in out if x.startswith(f"{a:04d}-") and x < k and x != previo]
        if m - 1 == 1 or not antes:
            out[previo] = {c: (acum[c] - mes[c]) if isinstance(acum[c], float) else 0
                           for c in acum if c.startswith(("facturas", "nc_", "nd_", "doc_"))}
            out[previo].update({"fuente": "deducido del acumulado de " + k, "corte": None,
                                "cant_facturas_emitidas": 0, "cant_facturas_recibidas": 0})
    for v in out.values():
        v["ventas_netas"] = round(v["facturas_emitidas"] - v["nc_emitidas"] + v["nd_emitidas"], 2)
        v["compras_netas"] = round(v["facturas_recibidas"] - v["nc_recibidas"] + v["nd_recibidas"], 2)
    return dict(sorted(out.items()))
