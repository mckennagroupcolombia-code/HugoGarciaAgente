"""Perfil tributario de cada proveedor, leído de sus facturas electrónicas.

**Qué resuelve (sep-2026).** Saber si a un proveedor hay que retenerle no depende
de qué se le compró sino de QUIÉN es: un autorretenedor se retiene a sí mismo, un
contribuyente del Régimen SIMPLE no admite retención de ninguna clase (Art. 911
E.T.). Ese dato vivía en la cabeza de alguien, y cuando no estaba se retenía de
más o de menos — las dos cosas le salen del bolsillo a una persona real.

Resulta que el dato ya estaba en casa. Toda factura electrónica que un proveedor
le emite a McKenna llega por correo como **XML `AttachedDocument` UBL 2.1**
(Res. DIAN 042/2020: ese XML, no el PDF, es la entrega con validez legal), y
`app/tools/sincronizar_facturas_de_compra_siigo.py` lleva años guardándolos en
`facturas_descargadas/`. Dentro, el bloque `AccountingSupplierParty` trae
`cbc:TaxLevelCode` con las **responsabilidades fiscales del RUT** del emisor.

Así se obtiene, sin acceso privilegiado a nada:

  1. **Correo** — es lo que hacemos. El emisor está obligado a mandarlo.
  2. **Portal DIAN** `catalogo-vpfe.dian.gov.co` → «Documentos recibidos» →
     descarga en lote de los XML. Fuente autoritativa si el correo se perdió.
     No tiene API de listado; es descarga manual.
  3. El servicio SOAP `vpfe.dian.gov.co/WcfDianCustomerServices.svc` sirve para
     emitir y para consultar UN documento por CUFE. **No lista lo recibido.**

⚠️ **Este módulo PROPONE, nunca aplica solo.** No es una cautela de principio:
`TaxLevelCode` lo escribe el emisor sobre sí mismo y **puede estar mal**. Caso
que lo probó: DUQUE SALDARRIAGA Y CIA (NIT 860508007) se declara `O-47` Régimen
SIMPLE en 10 de sus 64 facturas y **no lo es** — es régimen común autorretenedor
(confirmado por el usuario, 18-sep-2026). Aplicar el XML a ciegas habría marcado
mal a un proveedor con el que se mueven millones. Por eso cada propuesta lleva
«en N de M facturas»: esa proporción es la señal. Los casos falsos aparecen en
minoría (Duque 10/64, Envasar 14/42) y los ciertos en bloque (Sodimac 114/114).
Además `R-99-PN` («no aplica») es el valor más frecuente y no informa nada.

Lo que el XML **no** trae, y conviene no confundir:

  * **La retención que McKenna debe practicar.** El bloque `WithholdingTaxTotal`
    que traen algunas facturas son retenciones que el EMISOR informa (sus
    autorretenciones, su ReteICA). La del comprador la calcula el comprador, con
    `retenciones.py` + `impuestos_por_cuenta.py`.
  * **A quien no factura electrónicamente.** Una cuenta de cobro del Art. 616-2
    no es documento electrónico y jamás aparecerá acá. Es el caso de la
    mensajería de Fidel Rocha: cero facturas en 2.235 XML.
"""

from __future__ import annotations

import glob
import html
import json
import os
import re
from datetime import datetime

# Responsabilidades fiscales de la casilla 53 del RUT, tal como viajan en el XML.
# Solo se listan las que cambian cómo se le paga a alguien; el resto se guarda
# igual (para no perder información) pero no se interpreta.
RESPONSABILIDADES: dict[str, dict] = {
    "O-13": {"clave": "gran_contribuyente", "etiqueta": "Gran contribuyente",
             "efecto": ""},
    "O-15": {"clave": "autorretenedor", "etiqueta": "Autorretenedor de renta",
             "efecto": "No se le practica retención de renta: se retiene a sí mismo."},
    "O-23": {"clave": "agente_retencion_iva", "etiqueta": "Agente de retención de IVA",
             "efecto": ""},
    "O-47": {"clave": "regimen_simple", "etiqueta": "Régimen Simple de Tributación",
             "efecto": "No se le practica retención de renta ni de ICA (Art. 911 E.T.)."},
    "R-99-PN": {"clave": "no_informa", "etiqueta": "No informa responsabilidades",
                "efecto": ""},
}

_CARPETA_XML = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "facturas_descargadas",
)


# ─── Tablas ────────────────────────────────────────────────────────────────

def _ensure() -> None:
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_perfil_dian (
                nit TEXT PRIMARY KEY,
                nombre TEXT NOT NULL DEFAULT '',
                responsabilidades_json TEXT NOT NULL DEFAULT '{}',
                facturas INTEGER NOT NULL DEFAULT 0,
                primera_fecha TEXT NOT NULL DEFAULT '',
                ultima_fecha TEXT NOT NULL DEFAULT '',
                total_facturado REAL NOT NULL DEFAULT 0,
                actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Qué archivos ya se leyeron, para que un reescaneo cueste segundos y no
        # minutos. La firma incluye el tamaño: un XML reemplazado se vuelve a leer.
        # Propuestas que alguien ya miró y rechazó. Sin esto, Duque reaparece
        # cada vez que se abre la lista aunque ya se sepa que su O-47 es falso, y
        # una lista que no converge deja de leerse — que es como se vuelve
        # invisible lo que sí importa. Se guarda la evidencia del momento: si
        # mañana muchas más facturas lo declaran, la propuesta vuelve a salir.
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_perfil_dian_descartes (
                nit TEXT NOT NULL,
                campo TEXT NOT NULL,
                veces_al_descartar INTEGER NOT NULL DEFAULT 0,
                motivo TEXT NOT NULL DEFAULT '',
                por TEXT NOT NULL DEFAULT '',
                descartado_en TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (nit, campo)
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_perfil_dian_archivos (
                ruta TEXT PRIMARY KEY,
                firma TEXT NOT NULL DEFAULT '',
                nit TEXT NOT NULL DEFAULT '',
                leido_en TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)


# ─── 1. Extractor ──────────────────────────────────────────────────────────

def _desenvolver(raw: str) -> str:
    """Saca la `Invoice` de dentro del `AttachedDocument`.

    El XML que llega por correo es un sobre: la factura real va embebida como
    texto escapado dentro de `cbc:Description`. Parsear el sobre sin abrirlo
    devuelve los datos de la DIAN, no los del proveedor.
    """
    texto = html.unescape(raw)
    m = re.search(r"<(\w+:)?Invoice[\s>].*?</(\w+:)?Invoice>", texto, re.S)
    return m.group(0) if m else texto


def _bloque(xml: str, tag: str) -> str:
    m = re.search(rf"<(\w+:)?{tag}[\s>](.*?)</(\w+:)?{tag}>", xml, re.S)
    return m.group(0) if m else ""


def _primero(xml: str, tag: str) -> str:
    m = re.search(rf"<(\w+:)?{tag}[^>]*>([^<]*)</(\w+:)?{tag}>", xml)
    return (m.group(2) or "").strip() if m else ""


def leer_xml(ruta: str) -> dict | None:
    """Datos del emisor y del documento, o `None` si el archivo no es una factura."""
    try:
        with open(ruta, "rb") as fh:
            raw = fh.read().decode("utf8", "ignore")
    except OSError:
        return None
    xml = _desenvolver(raw)
    proveedor = _bloque(xml, "AccountingSupplierParty")
    if not proveedor:
        return None
    nit = re.sub(r"\D", "", _primero(proveedor, "CompanyID"))
    if not nit:
        return None

    codigos: list[str] = []
    for bruto in re.findall(r"TaxLevelCode[^>]*>([^<]+)<", proveedor):
        for cod in bruto.replace(" ", "").replace("\t", "").replace("\n", "").split(";"):
            cod = cod.strip().upper()
            if cod:
                codigos.append(cod)

    total = 0.0
    m = re.search(r"<(\w+:)?PayableAmount[^>]*>([\d.]+)<", xml)
    if m:
        try:
            total = float(m.group(2))
        except ValueError:
            total = 0.0

    return {
        "nit": nit,
        "nombre": _primero(proveedor, "RegistrationName"),
        "responsabilidades": codigos,
        "fecha": _primero(xml, "IssueDate"),
        "numero": _primero(xml, "ID"),
        "total": total,
        # Retenciones que informa el EMISOR. No son las que McKenna practica;
        # se guardan solo para no tener que volver a abrir el archivo.
        "retenciones_informadas": bool(re.search(r"WithholdingTaxTotal", xml)),
    }


def escanear(carpeta: str | None = None, *, releer: bool = False, limite: int = 0) -> dict:
    """Recorre los XML y consolida el perfil de cada emisor.

    Es incremental: un archivo ya leído se salta salvo que cambie de tamaño o se
    pase `releer=True`. No escribe nada en `cc_terceros` — eso es la capa 2.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    base = carpeta or _CARPETA_XML
    rutas = sorted(set(glob.glob(os.path.join(base, "*.XML")) + glob.glob(os.path.join(base, "*.xml"))))
    if limite:
        rutas = rutas[:limite]

    with cc._conn() as con:
        vistos = {
            r["ruta"]: r["firma"]
            for r in con.execute("SELECT ruta, firma FROM cc_perfil_dian_archivos")
        }

    nuevos, saltados, ilegibles = 0, 0, 0
    acumulado: dict[str, dict] = {}
    procesados: list[tuple[str, str, str]] = []

    for ruta in rutas:
        try:
            firma = str(os.path.getsize(ruta))
        except OSError:
            ilegibles += 1
            continue
        if not releer and vistos.get(ruta) == firma:
            saltados += 1
            continue
        datos = leer_xml(ruta)
        if not datos:
            ilegibles += 1
            procesados.append((ruta, firma, ""))
            continue
        nuevos += 1
        procesados.append((ruta, firma, datos["nit"]))
        p = acumulado.setdefault(datos["nit"], {
            "nombre": "", "resp": {}, "facturas": 0,
            "primera": "", "ultima": "", "total": 0.0,
        })
        p["facturas"] += 1
        p["total"] += datos["total"]
        if datos["nombre"]:
            p["nombre"] = datos["nombre"]
        for cod in datos["responsabilidades"]:
            p["resp"][cod] = p["resp"].get(cod, 0) + 1
        f = (datos["fecha"] or "")[:10]
        if f:
            p["primera"] = min(p["primera"], f) if p["primera"] else f
            p["ultima"] = max(p["ultima"], f)

    with cc._conn() as con:
        for ruta, firma, nit in procesados:
            con.execute(
                "INSERT INTO cc_perfil_dian_archivos (ruta, firma, nit, leido_en)"
                " VALUES (?,?,?,datetime('now'))"
                " ON CONFLICT(ruta) DO UPDATE SET firma=excluded.firma, nit=excluded.nit,"
                " leido_en=excluded.leido_en",
                (ruta, firma, nit),
            )
        for nit, p in acumulado.items():
            fila = con.execute("SELECT * FROM cc_perfil_dian WHERE nit=?", (nit,)).fetchone()
            resp = dict(json.loads(fila["responsabilidades_json"])) if fila else {}
            for cod, n in p["resp"].items():
                resp[cod] = resp.get(cod, 0) + n
            facturas = (fila["facturas"] if fila else 0) + p["facturas"]
            total = (fila["total_facturado"] if fila else 0.0) + p["total"]
            primera = min([x for x in ((fila["primera_fecha"] if fila else ""), p["primera"]) if x] or [""])
            ultima = max([x for x in ((fila["ultima_fecha"] if fila else ""), p["ultima"]) if x] or [""])
            con.execute(
                "INSERT INTO cc_perfil_dian (nit, nombre, responsabilidades_json, facturas,"
                " primera_fecha, ultima_fecha, total_facturado, actualizado_en)"
                " VALUES (?,?,?,?,?,?,?,datetime('now'))"
                " ON CONFLICT(nit) DO UPDATE SET nombre=CASE WHEN excluded.nombre<>'' THEN excluded.nombre ELSE cc_perfil_dian.nombre END,"
                " responsabilidades_json=excluded.responsabilidades_json, facturas=excluded.facturas,"
                " primera_fecha=excluded.primera_fecha, ultima_fecha=excluded.ultima_fecha,"
                " total_facturado=excluded.total_facturado, actualizado_en=excluded.actualizado_en",
                (nit, p["nombre"], json.dumps(resp), facturas, primera, ultima, round(total, 2)),
            )

    return {
        "carpeta": base, "archivos": len(rutas), "leidos": nuevos,
        "ya_conocidos": saltados, "sin_factura": ilegibles,
        "emisores": len(acumulado),
    }


def perfiles() -> list[dict]:
    """Un renglón por emisor, con sus responsabilidades ya interpretadas."""
    _ensure()
    import app.services.contabilidad_core as cc

    salida = []
    with cc._conn() as con:
        filas = con.execute("SELECT * FROM cc_perfil_dian ORDER BY facturas DESC").fetchall()
    for f in filas:
        resp = json.loads(f["responsabilidades_json"] or "{}")
        # Un código informado en UNA sola factura de cien puede ser un error de
        # digitación del emisor. Se guarda el conteo para que quien decida lo vea.
        etiquetas = [
            {"codigo": c, "veces": n,
             "etiqueta": RESPONSABILIDADES.get(c, {}).get("etiqueta", c),
             "efecto": RESPONSABILIDADES.get(c, {}).get("efecto", "")}
            for c, n in sorted(resp.items(), key=lambda x: -x[1])
        ]
        salida.append({
            "nit": f["nit"], "nombre": f["nombre"], "facturas": f["facturas"],
            "primera_fecha": f["primera_fecha"], "ultima_fecha": f["ultima_fecha"],
            "total_facturado": f["total_facturado"],
            "responsabilidades": etiquetas,
            "autorretenedor": "O-15" in resp,
            "regimen_simple": "O-47" in resp,
            "solo_no_informa": bool(resp) and set(resp) <= {"R-99-PN"},
        })
    return salida


# ─── 2. Perfilador: propone, no aplica ─────────────────────────────────────

def proponer() -> list[dict]:
    """Diferencias entre lo que dice el XML y lo que tiene la ficha del tercero.

    Devuelve propuestas, no cambios. Cada una trae la evidencia (cuántas
    facturas lo dicen, de cuándo es la última) para que quien decide pueda
    dudar con fundamento — que es exactamente lo que hizo falta con Duque.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    por_nit: dict[str, dict] = {}
    for t in cc.listar_terceros(solo_activos=False):
        ident = re.sub(r"\D", "", t.get("identificacion") or "")
        if ident:
            por_nit[ident] = t

    with cc._conn() as con:
        descartes = {
            (r["nit"], r["campo"]): r["veces_al_descartar"]
            for r in con.execute("SELECT * FROM cc_perfil_dian_descartes")
        }

    propuestas = []
    for p in perfiles():
        tercero = por_nit.get(p["nit"])
        if not tercero:
            continue
        cambios, motivos = {}, []
        n_simple = next((r["veces"] for r in p["responsabilidades"] if r["codigo"] == "O-47"), 0)
        n_auto = next((r["veces"] for r in p["responsabilidades"] if r["codigo"] == "O-15"), 0)

        # Un descarte deja de valer si la evidencia CRECIÓ de verdad (el doble
        # de facturas lo declaran). Que alguien dijera «no» con 10 facturas no
        # debe silenciar el aviso cuando ya son 60.
        def _descartado(campo: str, veces: int) -> bool:
            previo = descartes.get((p["nit"], campo))
            return previo is not None and veces < previo * 2

        if (p["regimen_simple"] and not int(tercero.get("regimen_simple") or 0)
                and not _descartado("regimen_simple", n_simple)):
            cambios["regimen_simple"] = 1
            motivos.append(
                f"Se declara Régimen SIMPLE (O-47) en {n_simple} de {p['facturas']} facturas "
                f"electrónicas (última: {p['ultima_fecha'] or 's/f'}). En el SIMPLE no se le "
                "practica retención de renta ni de ICA (Art. 911 E.T.)."
            )
        if (p["autorretenedor"] and not int(tercero.get("retefuente_exento") or 0)
                and not _descartado("retefuente_exento", n_auto)):
            cambios["retefuente_exento"] = 1
            motivos.append(
                f"Se declara autorretenedor (O-15) en {n_auto} de {p['facturas']} facturas "
                f"electrónicas (última: {p['ultima_fecha'] or 's/f'}). Un autorretenedor se "
                "retiene a sí mismo: practicarle retención se la cobra dos veces."
            )
        # El caso contrario también importa: la ficha dice SIMPLE y el XML nunca
        # lo ha dicho. No se propone desmarcar (el XML no es autoritativo), pero
        # se avisa, porque una de las dos fuentes está equivocada.
        contradice = ""
        if int(tercero.get("regimen_simple") or 0) and not p["regimen_simple"] and p["facturas"] >= 3:
            contradice = (
                f"La ficha dice Régimen SIMPLE pero ninguna de sus {p['facturas']} facturas "
                "electrónicas lo declara. Verificar con el RUT."
            )
        if not cambios and not contradice:
            continue
        propuestas.append({
            "nit": p["nit"], "tercero_id": tercero["id"], "nombre": tercero["nombre"],
            "nombre_dian": p["nombre"], "facturas": p["facturas"],
            "ultima_fecha": p["ultima_fecha"], "cambios": cambios,
            "motivo": " ".join(motivos), "contradiccion": contradice,
            "responsabilidades": p["responsabilidades"],
            # La advertencia va en CADA propuesta, no en la documentación del
            # módulo: quien la lee es quien está a punto de aprobarla.
            "advertencia": (
                "El emisor escribe estas responsabilidades sobre sí mismo y puede equivocarse "
                "(DUQUE SALDARRIAGA se declara SIMPLE en 10 de 64 facturas y es régimen común "
                "autorretenedor). Mira la proporción y confirma con el RUT antes de aplicar."
            ),
        })
    return propuestas


def aplicar(nit: str, cambios: dict, *, por: str = "", nota: str = "") -> dict:
    """Escribe en la ficha del tercero lo que alguien decidió, dejando constancia.

    Solo toca `regimen_simple` y `retefuente_exento`: son las dos banderas que
    cambian cuánto se le gira a alguien, y no se mueven sin que quede escrito
    quién lo decidió y con qué evidencia.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    nit = re.sub(r"\D", "", str(nit or ""))
    permitidos = {"regimen_simple", "retefuente_exento"}
    campos = {k: int(bool(v)) for k, v in (cambios or {}).items() if k in permitidos}
    if not campos:
        raise ValueError("Nada que aplicar: solo se aceptan regimen_simple y retefuente_exento")

    with cc._conn() as con:
        fila = con.execute(
            "SELECT id, nombre FROM cc_terceros WHERE REPLACE(REPLACE(identificacion,'.',''),'-','')=?",
            (nit,),
        ).fetchone()
        if not fila:
            raise ValueError(f"No hay tercero con identificación {nit}")
        marca = datetime.now().strftime("%Y-%m-%d")
        detalle = nota or "según sus facturas electrónicas (DIAN)"
        traza = f"[{marca}] Perfil DIAN: {', '.join(sorted(campos))} — {detalle}"
        if por:
            traza += f" (aplicado por {por})"
        sets = ", ".join(f"{k}=?" for k in campos)
        con.execute(
            f"UPDATE cc_terceros SET {sets},"
            " notas=TRIM(COALESCE(notas,'') || ' · ' || ?) WHERE id=?",
            (*campos.values(), traza, fila["id"]),
        )
    return {"tercero_id": fila["id"], "nombre": fila["nombre"], "aplicado": campos, "traza": traza}


def descartar(nit: str, campo: str, *, motivo: str, por: str = "") -> dict:
    """Registra que alguien miró una propuesta y la rechazó.

    Existe porque una lista que no converge deja de leerse. El descarte guarda
    cuántas facturas respaldaban la propuesta en ese momento; si más adelante el
    respaldo se duplica, vuelve a aparecer — el «no» fue sobre la evidencia de
    entonces, no sobre el proveedor para siempre.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    nit = re.sub(r"\D", "", str(nit or ""))
    if campo not in ("regimen_simple", "retefuente_exento"):
        raise ValueError("Solo se descartan propuestas de regimen_simple o retefuente_exento")
    if not (motivo or "").strip():
        raise ValueError("Un descarte sin motivo no le sirve al que lo lea después")

    perfil = next((p for p in perfiles() if p["nit"] == nit), None)
    veces = 0
    if perfil:
        codigo = "O-47" if campo == "regimen_simple" else "O-15"
        veces = next((r["veces"] for r in perfil["responsabilidades"] if r["codigo"] == codigo), 0)
    with cc._conn() as con:
        con.execute(
            "INSERT INTO cc_perfil_dian_descartes (nit, campo, veces_al_descartar, motivo, por, descartado_en)"
            " VALUES (?,?,?,?,?,datetime('now'))"
            " ON CONFLICT(nit, campo) DO UPDATE SET veces_al_descartar=excluded.veces_al_descartar,"
            " motivo=excluded.motivo, por=excluded.por, descartado_en=excluded.descartado_en",
            (nit, campo, veces, motivo.strip(), por),
        )
    return {"nit": nit, "campo": campo, "veces_al_descartar": veces, "motivo": motivo.strip()}
