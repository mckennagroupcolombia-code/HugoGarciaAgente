#!/usr/bin/env python3
"""Descarga de la DIAN el listado de documentos electrónicos de McKenna (emitidos y recibidos).

Es la misma información con la que el contador arma las declaraciones: facturas,
notas crédito/débito y documentos soporte, con IVA, retenciones, forma de pago y
estado. Sale del portal de facturación electrónica (catalogo-vpfe.dian.gov.co →
«Descarga de listados»), que pide un **token de acceso** enviado al correo de la
empresa.

Flujo:
  1. Alguien pide el token en el portal (Empresa → Representante legal → NIT y
     cédula). Este script NO lo pide: ese paso es del representante legal.
  2. El script busca en mckenna.group.colombia@gmail.com el correo «Token Acceso
     DIAN» más reciente, entra con su enlace y pide un listado por cada mes.
  3. La DIAN arma los listados en segundo plano; el script espera, los descarga y
     los deja en docs/contabilidad/DIAN_listados/dian_<desde>_<hasta>.xlsx
     (gitignored: trae nombres, cédulas y valores de terceros).

Va mes a mes a propósito: con rangos de un año o un semestre de 2025 la DIAN
devolvió «Error»; un mes siempre funcionó. Los meses ya descargados se saltan
(`--forzar` los vuelve a bajar: un mes en curso cambia día a día).

El enlace del token nunca se imprime ni se guarda: da acceso al portal de
facturación de la empresa.

Uso:
    python3 scripts/descargar_listados_dian.py                  # el mes anterior
    python3 scripts/descargar_listados_dian.py --desde 2026-01 --hasta 2026-08
    python3 scripts/descargar_listados_dian.py --desde 2026-09 --forzar
"""

from __future__ import annotations

import argparse
import base64
import calendar
import html
import io
import re
import sys
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

BASE = "https://catalogo-vpfe.dian.gov.co"
DESTINO = REPO / "docs" / "contabilidad" / "DIAN_listados"
ESPERA_MAX_S = 900          # cuánto esperar a que la DIAN arme los listados
TOKEN_VIGENTE_H = 24        # un correo de token más viejo que esto no se intenta


def _mes(s: str) -> date:
    return datetime.strptime(s, "%Y-%m").date().replace(day=1)


def meses(desde: date, hasta: date) -> list[tuple[str, str]]:
    """[(primer día, último día)] de cada mes entre `desde` y `hasta`, inclusive."""
    out, d = [], desde
    while d <= hasta:
        ultimo = calendar.monthrange(d.year, d.month)[1]
        out.append((d.isoformat(), d.replace(day=ultimo).isoformat()))
        d = (d.replace(day=ultimo) + timedelta(days=1))
    return out


def enlace_token() -> str:
    """Enlace AuthToken del correo de la DIAN más reciente (sin imprimirlo)."""
    from app.tools.sincronizar_facturas_de_compra_siigo import get_gmail_service

    gmail = get_gmail_service()
    res = gmail.users().messages().list(
        userId="me", q=f"from:facturacionelectronica@dian.gov.co newer_than:{TOKEN_VIGENTE_H}h",
        maxResults=1,
    ).execute()
    if not res.get("messages"):
        raise SystemExit(
            f"No hay correo «Token Acceso DIAN» de las últimas {TOKEN_VIGENTE_H} h en la cuenta de McKenna.\n"
            "Pídelo en catalogo-vpfe.dian.gov.co → Empresa → Representante legal (NIT 901316016) "
            "y vuelve a correr el script."
        )
    msg = gmail.users().messages().get(userId="me", id=res["messages"][0]["id"], format="full").execute()

    def cuerpos(p):
        if p.get("body", {}).get("data"):
            yield base64.urlsafe_b64decode(p["body"]["data"]).decode("utf-8", "ignore")
        for c in p.get("parts") or []:
            yield from cuerpos(c)

    for cuerpo in cuerpos(msg["payload"]):
        for href in re.findall(r'href="([^"]+)"', cuerpo):
            href = html.unescape(href)
            if "/User/AuthToken" in href:
                return href
    raise SystemExit("El correo de la DIAN no trae el enlace de acceso (¿cambió el formato?).")


def sesion(enlace: str):
    import requests

    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36"
    r = s.get(enlace, timeout=60)
    if "Cerrar sesión" not in r.text:
        raise SystemExit("La DIAN no aceptó el token (¿vencido o ya usado?). Pide uno nuevo.")
    print("Sesión abierta en el portal DIAN.")
    return s


def _antifalsificacion(s) -> str:
    r = s.get(BASE + "/Document/Export", timeout=60)
    return re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', r.text).group(1)


def pedir(s, desde: str, hasta: str) -> None:
    r = s.post(
        BASE + "/Document/Export",
        data={
            "__RequestVerificationToken": _antifalsificacion(s), "Type": "0",
            "StartDate": desde, "EndDate": hasta, "AmountAdmin": "100000",
            "ReceiverCode": "", "GroupCode": "0",           # 0 = emitidos y recibidos
        },
        headers={"X-Requested-With": "XMLHttpRequest"}, timeout=90,
    )
    if r.status_code != 200 or r.text.strip() != "true":
        raise RuntimeError(f"la DIAN rechazó la solicitud {desde}→{hasta}: {r.status_code} {r.text[:120]}")


def tareas(s) -> list[dict]:
    """Filas de la tabla «Descarga de listados»: rango, estado, total y enlace."""
    r = s.post(BASE + "/Document/TasksPartial",
               data={"__RequestVerificationToken": _antifalsificacion(s)}, timeout=60)
    out = []
    for fila in re.findall(r"<tr>.*?</tr>", r.text, re.S):
        rango = re.search(r"Desde (\d{2})-(\d{2})-(\d{4}) Hasta (\d{2})-(\d{2})-(\d{4})", fila)
        if not rango:
            continue
        d1, m1, a1, d2, m2, a2 = rango.groups()
        estado = re.search(r'title="([^"]+)" data-html="true" data-original-title="(?:Listo|Error|[^"]*)"', fila)
        enlace = re.search(r'href="(/Document/DownloadExportedZipFile[^"]+)"', fila)
        total = re.findall(r'<td class="text-left">(\d+)</td>', fila)
        out.append({
            "desde": f"{a1}-{m1}-{d1}", "hasta": f"{a2}-{m2}-{d2}",
            "estado": estado.group(1) if estado else "?",
            "total": int(total[0]) if total else None,
            "enlace": html.unescape(enlace.group(1)) if enlace else None,
        })
    return out


def resumen(ruta: Path) -> str:
    import openpyxl

    filas = list(openpyxl.load_workbook(ruta, read_only=True).active.iter_rows(values_only=True))
    ix = {c: i for i, c in enumerate(filas[0])}
    emit = recib = 0.0
    for f in filas[1:]:
        base = float(f[ix["Total"]] or 0) - float(f[ix["IVA"]] or 0)
        tipo = str(f[ix["Tipo de documento"]] or "")
        if "Documento soporte" in tipo:
            continue
        signo = -1 if "crédito" in tipo else 1
        if f[ix["Grupo"]] == "Emitido":
            emit += signo * base
        else:
            recib += signo * base
    return f"{len(filas) - 1} docs · ventas netas ${emit:,.0f} · compras netas ${recib:,.0f}".replace(",", ".")


def main() -> int:
    hoy = date.today()
    mes_anterior = (hoy.replace(day=1) - timedelta(days=1)).replace(day=1)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--desde", type=_mes, default=mes_anterior, help="AAAA-MM (default: mes anterior)")
    ap.add_argument("--hasta", type=_mes, default=None, help="AAAA-MM (default: igual a --desde)")
    ap.add_argument("--forzar", action="store_true", help="vuelve a bajar meses ya descargados")
    args = ap.parse_args()

    DESTINO.mkdir(parents=True, exist_ok=True)
    rango = meses(args.desde, args.hasta or args.desde)
    faltan = [(d, h) for d, h in rango if args.forzar or not (DESTINO / f"dian_{d}_{h}.xlsx").exists()]
    if not faltan:
        print("Esos meses ya están descargados (usa --forzar para bajarlos de nuevo).")
        return 0

    s = sesion(enlace_token())
    pedido_en = time.time()
    for d, h in faltan:
        pedir(s, d, h)
        print(f"  pedido {d} → {h}")
        time.sleep(2)

    pendientes = set(faltan)
    while pendientes and time.time() - pedido_en < ESPERA_MAX_S:
        time.sleep(25)
        for t in tareas(s):
            clave = (t["desde"], t["hasta"])
            if clave not in pendientes:
                continue
            if t["estado"] == "Listo" and t["enlace"]:
                contenido = s.get(BASE + t["enlace"], timeout=240).content
                z = zipfile.ZipFile(io.BytesIO(contenido))
                ruta = DESTINO / f"dian_{clave[0]}_{clave[1]}.xlsx"
                ruta.write_bytes(z.read(z.namelist()[0]))
                print(f"  ✓ {clave[0]} → {clave[1]}: {resumen(ruta)}")
                pendientes.discard(clave)
            elif t["estado"] == "Error":
                print(f"  ✗ {clave[0]} → {clave[1]}: la DIAN devolvió Error")
                pendientes.discard(clave)
    if pendientes:
        print(f"Sin terminar tras {ESPERA_MAX_S // 60} min: {sorted(pendientes)}. "
              "Siguen en el portal (Descarga de listados); vuelve a correr el script más tarde.")
        return 1
    print(f"Listados en {DESTINO.relative_to(REPO)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
