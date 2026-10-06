"""Paquete mensual del expediente: un ZIP autosuficiente para corroborar el libro por fuera.

El contador (o cualquier otra IA) recibe un solo archivo por mes con los datos en
CSV/JSON, un índice legible (LEEME.md), un índice para máquinas (manifest.json) y los
documentos de soporte que están en disco. Cada archivo lleva su SHA-256 en el manifest
y una referencia al asiento que respalda, así se puede verificar sin el panel.

Reglas:
- Se arma en un hilo (tarda; 3.500 asientos en un mes) y se cachea en
  comprobantes/expedientes/ (gitignored). `firma(periodo)` cambia si cambian los
  asientos, los extractos, los listados DIAN, las observaciones o las declaraciones:
  así el panel sabe si el ZIP está vigente.
- Nunca sale a la red: solo entran los documentos que ya están en disco. Lo que no
  está (una FE que vive en Alegra) queda en `faltantes` con su enlace.
- Las facturas de venta van en XML (verificables por CUFE); el PDF solo con
  `incluir_pdf_ventas`, y hasta `max_mb`.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import threading
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_CACHE_DIR = _REPO / "comprobantes" / "expedientes"
VERSION = 1
_hilos: dict[str, threading.Thread] = {}
_lock = threading.Lock()


def _validar(periodo: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}", periodo or ""):
        raise ValueError("Período inválido: use AAAA-MM")
    return periodo


def _rutas(periodo: str) -> tuple[Path, Path]:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"expediente_{periodo}.zip", _CACHE_DIR / f"expediente_{periodo}.estado.json"


def _leer_estado(p: Path) -> dict[str, Any]:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _guardar_estado(p: Path, d: dict[str, Any]) -> None:
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def firma(periodo: str) -> str:
    """Huella de todo lo que entra al paquete; si cambia, el ZIP está desactualizado."""
    from app.services.contabilidad_core import _DB_PATH
    from app.services.dian_cruce import DIAN_DIR
    from app.services.expediente_contable import _rango

    desde, hasta = _rango(periodo)
    partes: list[Any] = []
    con = sqlite3.connect(_DB_PATH, timeout=30)
    try:
        for sql in (
            "SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(MAX(created_at),'') FROM cc_movimientos WHERE fecha BETWEEN ? AND ?",
            "SELECT COUNT(*), COALESCE(MAX(id),0) FROM extracto_movimientos WHERE fecha BETWEEN ? AND ?",
        ):
            try:
                partes.append(tuple(con.execute(sql, (desde, hasta)).fetchone()))
            except sqlite3.OperationalError:
                partes.append(None)
        for sql in (
            "SELECT COUNT(*), COALESCE(MAX(id),0) FROM extracto_vinculos",
            f"SELECT COUNT(*), COALESCE(MAX(id),0), COALESCE(MAX(resuelto_en),'') FROM cc_observaciones_contador WHERE periodo='{periodo}'",
        ):
            try:
                partes.append(tuple(con.execute(sql).fetchone()))
            except sqlite3.OperationalError:
                partes.append(None)
    finally:
        con.close()
    for p in sorted(DIAN_DIR.glob("*.xlsx")) if DIAN_DIR.exists() else []:
        if periodo in p.name or re.match(r"dian_(\d{4}-\d{2})-\d{2}_(\d{4}-\d{2})", p.name) and p.name[5:12] <= periodo <= p.name[16:23]:
            partes.append((p.name, p.stat().st_mtime))
    decl = _REPO / "docs" / "contabilidad" / periodo[:4] / "declaraciones_contador.json"
    if decl.exists():
        partes.append(("decl", decl.stat().st_mtime))
    return hashlib.sha1(json.dumps(partes, default=str).encode()).hexdigest()


def estado(periodo: str) -> dict[str, Any]:
    periodo = _validar(periodo)
    zip_p, est_p = _rutas(periodo)
    e = _leer_estado(est_p)
    if not e or (e.get("estado") == "listo" and not zip_p.is_file()):
        return {"estado": "no", "periodo": periodo}
    if e.get("estado") == "generando" and not (_hilos.get(periodo) and _hilos[periodo].is_alive()):
        e["estado"] = "error"
        e["error"] = e.get("error") or "La generación se interrumpió."
    out = {**e, "periodo": periodo}
    if e.get("estado") == "listo":
        try:
            out["firma_vigente"] = e.get("firma") == firma(periodo)
        except Exception:  # noqa: BLE001
            out["firma_vigente"] = None
        out["bytes"] = zip_p.stat().st_size
    return out


def ruta_zip(periodo: str) -> Path | None:
    zip_p, _ = _rutas(_validar(periodo))
    return zip_p if zip_p.is_file() and estado(periodo).get("estado") == "listo" else None


# ── Generación ──────────────────────────────────────────────────────────────


class _Zip:
    """Escribe archivos una sola vez (dedup por SHA-256) y lleva el manifest."""

    def __init__(self, periodo: str, max_bytes: int):
        self.periodo = periodo
        self.buf = io.BytesIO()
        self.z = zipfile.ZipFile(self.buf, "w", zipfile.ZIP_DEFLATED)
        self.archivos: dict[str, dict[str, Any]] = {}      # ruta en zip → entrada del manifest
        self.por_sha: dict[str, str] = {}                  # sha256 → ruta en zip
        self.faltantes: list[dict[str, Any]] = []
        self.bytes = 0
        self.max_bytes = max_bytes
        self.ahorrados = 0

    def texto(self, ruta: str, contenido: str, *, tipo: str, cuenta: str = "", refs: list[str] | None = None) -> None:
        self.binario(ruta, contenido.encode("utf-8"), tipo=tipo, cuenta=cuenta, refs=refs, origen="libro")

    def binario(self, ruta: str, data: bytes, *, tipo: str, origen: str, cuenta: str = "", refs: list[str] | None = None,
                asientos: list[int] | None = None, dedup: bool = True) -> str:
        sha = hashlib.sha256(data).hexdigest()
        if dedup and sha in self.por_sha:
            destino = self.por_sha[sha]
            e = self.archivos[destino]
            e["refs"] = sorted(set(e["refs"]) | set(refs or []))
            e["asientos"] = sorted(set(e["asientos"]) | set(asientos or []))
            self.ahorrados += len(data)
            return destino
        # Dos documentos distintos con el mismo nombre (dos recibos 490 el mismo día): se numeran.
        base, n = ruta, 1
        while ruta in self.archivos:
            n += 1
            raiz, _, ext = base.rpartition(".")
            ruta = f"{raiz}_{n}.{ext}" if raiz else f"{base}_{n}"
        self.z.writestr(ruta, data)
        self.bytes += len(data)
        self.por_sha[sha] = ruta
        self.archivos[ruta] = {"ruta": ruta, "tipo": tipo, "sha256": sha, "bytes": len(data), "origen": origen,
                               "refs": sorted(set(refs or [])), "asientos": sorted(set(asientos or [])), "cuenta": cuenta}
        return ruta

    def archivo(self, ruta_zip: str, origen_disco: Path, **kw) -> str | None:
        try:
            data = origen_disco.read_bytes()
        except OSError as e:
            self.faltantes.append({"ref": kw.get("refs", [""])[0] if kw.get("refs") else ruta_zip, "motivo": f"no se pudo leer: {e}"})
            return None
        if self.bytes + len(data) > self.max_bytes:
            self.faltantes.append({"ref": (kw.get("refs") or [ruta_zip])[0], "motivo": "se superó el tamaño máximo del paquete"})
            return None
        return self.binario(ruta_zip, data, **kw)


def _csv(filas: list[dict[str, Any]], columnas: list[str]) -> str:
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf, delimiter=";")
    w.writerow(columnas)
    for f in filas:
        w.writerow([_celda(f.get(c)) for c in columnas])
    return buf.getvalue()


def _celda(v: Any) -> str:
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else f"{v:.2f}".replace(".", ",")
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return "" if v is None else str(v)


def _slug(s: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", (s or "").strip())
    return s.strip("_")[:60] or "x"


def generar(periodo: str, *, incluir_pdf_ventas: bool = False, max_mb: int | None = None) -> dict[str, Any]:
    """Arma el ZIP del mes (síncrono). Devuelve el estado final."""
    periodo = _validar(periodo)
    import app.services.contabilidad_core as cc
    from app.services import expediente_contable as ec
    from app.services.contabilidad_mayor import auxiliar_terceros, extracto_csv, extracto_cuenta, libro_diario, libro_diario_csv
    from app.services.dian_cruce import cruce_mes
    from app.services.expediente_documentos import documentos_de_asiento, listado_dian, resolver

    zip_p, est_p = _rutas(periodo)
    inicio = datetime.now()
    _guardar_estado(est_p, {"estado": "generando", "iniciado_en": inicio.isoformat(timespec="seconds")})
    max_bytes = int(max_mb or os.getenv("EXPEDIENTE_PAQUETE_MAX_MB") or 400) * 1024 * 1024
    z = _Zip(periodo, max_bytes)
    try:
        e = ec.expediente_mes(periodo)
        desde, hasta = e["desde"], e["hasta"]
        propio = e["tipo"] == "libro_propio"

        # 01 balance y estado
        estado_mes = {k: v for k, v in e.items() if k != "cuentas"}
        z.texto("01_balance/estado_mes.json", json.dumps(estado_mes, ensure_ascii=False, indent=1), tipo="json")
        if propio:
            bal = cc.balance_comprobacion(desde=desde, hasta=hasta)
            z.texto("01_balance/balance_comprobacion.csv",
                    _csv(bal["cuentas"], ["codigo", "nombre", "tipo", "naturaleza", "saldo_inicial", "debito", "credito", "saldo_final"]), tipo="csv")
            z.texto("01_balance/cuentas.json", json.dumps(e["cuentas"], ensure_ascii=False, indent=1), tipo="json")
            # 02 auxiliares
            for c in e["cuentas"]:
                if not c.get("es_movimiento") or not c["verificacion"]["asientos"]:
                    continue
                ext = extracto_cuenta(codigo=c["codigo"], desde=desde, hasta=hasta, limite=100000)
                z.texto(f"02_auxiliares/{c['codigo']}_{_slug(c['nombre'])}.csv", extracto_csv(ext), tipo="csv", cuenta=c["codigo"])
            z.texto("02_auxiliares/auxiliar_terceros.json", json.dumps(auxiliar_terceros(desde, hasta), ensure_ascii=False, indent=1), tipo="json")
            # 03 diario
            diario = libro_diario(desde, hasta, limit=100000)
            z.texto("03_diario/libro_diario.csv", libro_diario_csv(diario), tipo="csv")
            z.texto("03_diario/libro_diario.json", json.dumps(diario, ensure_ascii=False), tipo="json")
        # 04 banco
        conc = ec.conciliacion_mes(periodo)
        z.texto("04_banco/conciliacion.json", json.dumps(conc, ensure_ascii=False, indent=1), tipo="json", cuenta="1110")
        z.texto("04_banco/conciliacion.csv", _csv(
            [{**l, "asiento_concepto": (l.get("asiento") or {}).get("concepto"), "contrapartida": (l.get("asiento") or {}).get("contrapartida")} for l in conc["lineas"]],
            ["fecha", "descripcion", "referencia", "tipo", "monto", "saldo", "estado", "movimiento_id", "asiento_concepto", "contrapartida", "vinculo_notas"]), tipo="csv", cuenta="1110")
        for x in e["estado"]["banco"]["extractos"]:
            r = resolver(f"extracto:{x['id']}")
            if r:
                z.archivo(f"04_banco/{_slug(x['nombre'] or x['archivo_nombre'])}{r[0].suffix}", r[0], tipo="extracto", origen="banco", cuenta="1110", refs=[f"extracto:{x['id']}"])
            else:
                z.faltantes.append({"ref": f"extracto:{x['id']}", "motivo": "archivo original no está en disco"})
        # 05 dian
        try:
            cru = cruce_mes(periodo)
            if cru["listado"]:
                z.texto("05_dian/cruce.json", json.dumps(cru, ensure_ascii=False, indent=1), tipo="json")
                cols = ["documento", "tipo", "fecha", "nit", "nombre", "total_dian", "iva_dian", "total_libro", "diferencia", "estado", "movimiento_id", "cuenta_codigo", "criterio", "cufe"]
                for g in ("emitidos", "notas_credito", "documentos_soporte", "recibidos"):
                    z.texto(f"05_dian/cruce_{g}.csv", _csv(cru[g]["filas"], cols), tipo="csv")
                p = listado_dian(periodo)
                if p:
                    z.archivo(f"05_dian/{p.name}", p, tipo="dian_listado", origen="dian", refs=[f"dian_listado:{periodo}"])
        except Exception as ex:  # noqa: BLE001
            z.faltantes.append({"ref": f"dian_listado:{periodo}", "motivo": f"cruce no disponible: {ex}"})
        # 06 impuestos
        z.texto("06_impuestos/impuestos.json", json.dumps(e["estado"]["impuestos"], ensure_ascii=False, indent=1), tipo="json")
        if propio:
            try:
                from app.services.declaraciones_impuestos import borrador, csv_borrador

                z.texto(f"06_impuestos/350_{periodo}.csv", csv_borrador("350", periodo), tipo="csv", cuenta="2365")
                z.texto(f"06_impuestos/350_{periodo}.json", json.dumps(borrador("350", periodo), ensure_ascii=False, indent=1), tipo="json", cuenta="2365")
                bim = f"{periodo[:4]}-B{(int(periodo[5:7]) + 1) // 2}"
                z.texto(f"06_impuestos/rtica_{bim}.csv", csv_borrador("rtica", bim), tipo="csv", cuenta="2368")
            except Exception as ex:  # noqa: BLE001
                z.faltantes.append({"ref": f"borrador:350:{periodo}", "motivo": str(ex)})
        for f in e["fuentes"]:
            if f["tipo"] in ("declaracion", "certificado", "recibo", "contrato"):
                r = resolver(f["ref"])
                carpeta = {"declaracion": "06_impuestos/declaraciones", "certificado": "06_impuestos/certificados",
                           "recibo": "06_impuestos/recibos", "contrato": "07_soportes/prestamos"}[f["tipo"]]
                if r:
                    z.archivo(f"{carpeta}/{_slug(r[2] or r[0].name)}{'' if r[2] and '.' in r[2] else r[0].suffix}", r[0], tipo=f["tipo"], origen="contador" if f["tipo"] != "contrato" else "local", refs=[f["ref"]], cuenta=",".join(f["cuentas"]))
                else:
                    z.faltantes.append({"ref": f["ref"], "motivo": "no está en disco"})
        # 07 soportes por asiento (solo lo que ya está en disco: sin red)
        indice: list[dict[str, Any]] = []
        if propio:
            with cc._conn() as con:
                ids = [r[0] for r in con.execute("SELECT id FROM cc_movimientos WHERE estado='confirmado' AND fecha BETWEEN ? AND ? ORDER BY id", (desde, hasta))]
            for mid in ids:
                mov = cc.obtener_movimiento(mid)
                if not mov:
                    continue
                cuenta = next((l["cuenta_codigo"] for l in mov.get("lineas") or [] if not str(l.get("cuenta_codigo", "")).startswith(("1110", "1305"))), "")
                for d in documentos_de_asiento(mov):
                    if d["tipo"] == "alegra_journal":
                        indice.append({"movimiento_id": mid, "ref": d["ref"], "tipo": d["tipo"], "ruta": "", "enlace": d["enlace_externo"], "sha256": ""})
                        continue
                    if d["tipo"] == "factura_venta" and not incluir_pdf_ventas and not d["archivo"]:
                        indice.append({"movimiento_id": mid, "ref": d["ref"], "tipo": d["tipo"], "ruta": "", "enlace": d["enlace_externo"], "sha256": ""})
                        z.faltantes.append({"ref": d["ref"], "motivo": "factura de venta: PDF en Alegra (no incluido)", "enlace_externo": d["enlace_externo"], "asientos": [mid]})
                        continue
                    if not d["archivo"]:
                        if d["tipo"] in ("documento_soporte", "contrato"):
                            continue   # se materializan por red: no en el paquete
                        z.faltantes.append({"ref": d["ref"], "motivo": d["nota"] or "no está en disco", "enlace_externo": d["enlace_externo"], "asientos": [mid]})
                        indice.append({"movimiento_id": mid, "ref": d["ref"], "tipo": d["tipo"], "ruta": "", "enlace": d["enlace_externo"] or "", "sha256": ""})
                        continue
                    origen = _REPO / d["archivo"]
                    sub = {"factura_compra": "facturas_compra", "factura_compra_xml": "facturas_compra", "factura_venta": "facturas_venta",
                           "nota_credito": "facturas_venta", "documento_soporte": "documentos_soporte", "contrato": "prestamos"}.get(d["tipo"], "asientos")
                    ruta = z.archivo(f"07_soportes/{sub}/{mid}_{_slug(origen.name)}", origen, tipo=d["tipo"], origen="local", refs=[d["ref"]], asientos=[mid], cuenta=cuenta)
                    indice.append({"movimiento_id": mid, "ref": d["ref"], "tipo": d["tipo"], "ruta": ruta or "", "enlace": "", "sha256": z.archivos[ruta]["sha256"] if ruta else ""})
            z.texto("07_soportes/INDICE_SOPORTES.csv", _csv(indice, ["movimiento_id", "ref", "tipo", "ruta", "enlace", "sha256"]), tipo="csv")
        # 08 observaciones
        try:
            from app.services.observaciones_contador import listar

            obs = listar(periodo=periodo)
            z.texto("08_observaciones/observaciones.json", json.dumps(obs, ensure_ascii=False, indent=1), tipo="json")
            z.texto("08_observaciones/observaciones.csv", _csv(obs, ["id", "objeto_tipo", "objeto_id", "estado", "texto", "por", "created_at", "respuesta", "resuelto_por", "resuelto_en"]), tipo="csv")
        except Exception:  # noqa: BLE001
            pass
        # manifest + LEEME
        f = firma(periodo)
        manifest = {
            "version": VERSION, "periodo": periodo, "tipo": e["tipo"], "generado_en": datetime.now().isoformat(timespec="seconds"),
            "firma": f, "empresa": _empresa(), "corte": e["corte"], "resumen": estado_mes["estado"], "veredicto": e["veredicto"],
            "cuentas": [{k: c.get(k) for k in ("codigo", "nombre", "saldo_inicial", "debito", "credito", "saldo_final")}
                        | {"auxiliar": f"02_auxiliares/{c['codigo']}_{_slug(c['nombre'])}.csv" if c.get("es_movimiento") and c["verificacion"]["asientos"] else None}
                        for c in e["cuentas"]],
            "archivos": list(z.archivos.values()), "faltantes": z.faltantes,
            "totales": {"archivos": len(z.archivos), "bytes": z.bytes, "dedup_ahorrados": z.ahorrados,
                        "soportes_locales": sum(1 for a in z.archivos.values() if a["origen"] == "local"),
                        "soportes_externos": len([x for x in z.faltantes if x.get("enlace_externo")])},
        }
        z.texto("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1), tipo="json")
        z.texto("LEEME.md", _leeme(e, manifest, incluir_pdf_ventas), tipo="md")
        z.z.close()
        zip_p.write_bytes(z.buf.getvalue())
        est = {"estado": "listo", "firma": f, "generado_en": manifest["generado_en"], "bytes": zip_p.stat().st_size,
               "archivos": len(z.archivos), "faltantes": len(z.faltantes), "incluir_pdf_ventas": incluir_pdf_ventas,
               "segundos": round((datetime.now() - inicio).total_seconds(), 1)}
        _guardar_estado(est_p, est)
        return {**est, "periodo": periodo}
    except Exception as ex:  # noqa: BLE001
        est = {"estado": "error", "error": str(ex), "generado_en": datetime.now().isoformat(timespec="seconds")}
        _guardar_estado(est_p, est)
        raise


def generar_async(periodo: str, *, incluir_pdf_ventas: bool = False) -> dict[str, Any]:
    periodo = _validar(periodo)
    with _lock:
        h = _hilos.get(periodo)
        if h and h.is_alive():
            return {"estado": "generando", "periodo": periodo, "ya_corria": True}
        _, est_p = _rutas(periodo)
        _guardar_estado(est_p, {"estado": "generando", "iniciado_en": datetime.now().isoformat(timespec="seconds")})

        def _run():
            try:
                generar(periodo, incluir_pdf_ventas=incluir_pdf_ventas)
            except Exception:  # noqa: BLE001 — el estado ya quedó en «error»
                pass

        h = threading.Thread(target=_run, name=f"expediente-{periodo}", daemon=True)
        _hilos[periodo] = h
        h.start()
    return {"estado": "generando", "periodo": periodo}


def _empresa() -> dict[str, str]:
    try:
        from app.services import empresa

        return {"nit": empresa.nit(), "razon_social": empresa.razon_social()}
    except Exception:  # noqa: BLE001
        return {"nit": "", "razon_social": "McKenna Group S.A.S."}


def _leeme(e: dict[str, Any], m: dict[str, Any], pdf_ventas: bool) -> str:
    b = e["estado"]["banco"]
    d = e["estado"]["dian"]
    emp = m["empresa"]
    propio = e["tipo"] == "libro_propio"
    lineas = [
        f"# Expediente contable {e['periodo']} — {emp.get('razon_social', '')} (NIT {emp.get('nit', '')})",
        "",
        f"Generado el {m['generado_en']}. Firma `{m['firma']}` (cambia si cambia cualquier dato del mes).",
        "",
        "## Qué es este período",
        ("Mes llevado por el **Libro Mayor propio** de McKenna (partida doble, asientos con soporte). El libro propio manda desde el "
         f"{e['corte']}; lo anterior lo declaró el contador." if propio else
         "Mes **anterior al corte**: lo llevó y declaró el contador. Aquí van las fuentes (extracto, listado DIAN, declaraciones) y lo "
         "que el libro tiene de forma informativa; no pretende cuadrar el mes."),
        "",
        "## Estado del mes",
        f"- {e['veredicto']['titulo']} {e['veredicto']['frase']}",
        f"- Banco 1110: extracto {b['saldo_extracto_inicial']} → {b['saldo_extracto_final']} ({b['saldo_metodo']})"
        + (f"; libro {b['saldo_libro_inicial']} → {b['saldo_libro_final']}; diferencia {b['diferencia']}" if propio else "")
        + f". {b['vinculadas']} de {b['lineas']} líneas con asiento.",
        (f"- DIAN: ventas {d['emitidos']['en_ambos']} en ambos / {d['emitidos']['solo_dian']} solo DIAN / {d['emitidos']['solo_libro']} solo libro; "
         f"compras {d['recibidos']['en_ambos']} en ambos / {d['recibidos']['solo_dian']} solo DIAN." if d.get("listado") else "- DIAN: sin listado para este mes."),
        "- Impuestos: " + "; ".join(f"{i['cuenta']} {i['veredicto']}" for i in e["estado"]["impuestos"]) + ".",
        "",
        "## Carpetas",
        "- `01_balance/`: estado del mes (JSON), balance de comprobación (CSV) y cuentas con sus verificaciones.",
        "- `02_auxiliares/`: un CSV por cuenta con movimiento (saldo inicial, cada asiento con contrapartida, NIT y documento, saldo corrido).",
        "- `03_diario/`: el Libro Diario completo del mes (CSV y JSON), una fila por línea de asiento.",
        "- `04_banco/`: el extracto original del banco y la conciliación línea por línea (`estado`: vinculada / sin_asiento / con_nota).",
        "- `05_dian/`: el listado original de la DIAN y el cruce documento por documento (`estado`: cuadra / difiere / solo_dian / solo_libro).",
        "- `06_impuestos/`: lo que dicen las cuentas 2365/2367/2368/2408/1355xx, los borradores 350 y RTICA, y las declaraciones, recibos y certificados en PDF.",
        "- `07_soportes/`: los documentos detrás de cada asiento. `INDICE_SOPORTES.csv` dice, por asiento, qué archivo (o qué enlace) lo respalda.",
        "- `08_observaciones/`: lo que el contador marcó como revisado y sus preguntas o ajustes, con las respuestas.",
        "",
        "## Cómo corroborar",
        "1. Tome un asiento de `03_diario/libro_diario.csv` (columna `Documento`).",
        "2. Búsquelo en `05_dian/cruce_*.csv` por `documento` o `cufe`: ahí está lo que la DIAN tiene y la diferencia.",
        "3. Abra su archivo según `07_soportes/INDICE_SOPORTES.csv`; el `sha256` del manifest permite comprobar que no cambió.",
        "4. Para una salida de banco, búsquela en `04_banco/conciliacion.csv` por fecha y valor: la fila trae el asiento y su contrapartida.",
        "",
        "## Política de documentos",
        f"- Facturas de venta: {'PDF incluido cuando está en disco' if pdf_ventas else 'solo el enlace a Alegra (PDF no incluido por tamaño)'}; el listado DIAN trae el CUFE de cada una.",
        "- Facturas de compra: PDF y XML cuando llegaron por correo del proveedor; si no, el listado DIAN es la prueba de que existe.",
        "- Documentos soporte y contratos se generan desde Alegra/el sistema al abrirlos en el panel; no van en el paquete.",
        "- Nada de este paquete se bajó de internet al generarlo: solo lo que ya estaba en disco.",
        "",
        f"## Faltantes ({len(m['faltantes'])})",
    ] + [f"- {x['ref']}: {x['motivo']}" + (f" → {x['enlace_externo']}" if x.get("enlace_externo") else "") for x in m["faltantes"][:200]]
    if len(m["faltantes"]) > 200:
        lineas.append(f"- … y {len(m['faltantes']) - 200} más (ver manifest.json).")
    return "\n".join(lineas) + "\n"


if __name__ == "__main__":  # pragma: no cover
    import argparse

    ap = argparse.ArgumentParser(description="Paquete mensual del expediente contable")
    ap.add_argument("periodo")
    ap.add_argument("--pdf-ventas", action="store_true")
    ap.add_argument("--regenerar", action="store_true")
    a = ap.parse_args()
    if not a.regenerar and estado(a.periodo).get("estado") == "listo" and estado(a.periodo).get("firma_vigente"):
        print(json.dumps(estado(a.periodo), ensure_ascii=False, indent=1))
    else:
        print(json.dumps(generar(a.periodo, incluir_pdf_ventas=a.pdf_ventas), ensure_ascii=False, indent=1))
