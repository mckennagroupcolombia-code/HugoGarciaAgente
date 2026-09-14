"""Declarador — expediente fiscal de cada socio dentro de la contabilidad de McKenna.

Trae al panel la herramienta agéntica que vivía en `/home/mckg/Declarador`
(agente de terminal que conciliaba extractos bancarios personales, historial de
Binance, declaraciones F210 presentadas e información exógena para preparar la
declaración de renta con criptoactivos omitidos). Aquí esa misma información
queda **por socio** (tercero tipo `socio` de `cc_terceros`) y al lado de su
cuenta con la empresa, para que la contabilidad personal del socio viva dentro
de la de McKenna y no en una carpeta suelta.

Qué guarda (tablas `dl_*` en `contabilidad.db`, mismo archivo que el Libro Mayor):

- `dl_expedientes`  — perfil fiscal del socio (cédula, UID Binance, carpeta de
  origen, notas) y el estado de los pasos del wizard.
- `dl_documentos`   — inventario de soportes por categoría y año gravable. Un
  documento puede ser un archivo subido desde el panel (queda en
  `comprobantes/socios/<tercero_id>/`, gitignored) o una referencia a un archivo
  que ya existe en la carpeta del Declarador (`origen='carpeta'`, no se copia).
- `dl_anios`        — un renglón por año gravable: lo declarado en el F210
  (patrimonio bruto, deudas, renta líquida, impuesto pagado) y lo que arrojó el
  motor FIFO de criptoactivos (renta ordinaria / ganancia ocasional / sin costo
  base), más el estado (presentada · borrador · por_corregir · corregida).
- `dl_hallazgos`    — pendientes y preguntas abiertas, con clave estable para
  no duplicar al reimportar; los cierra el usuario o el agente.
- `dl_chat`         — historial del agente por socio.

Qué NO hace: no calcula impuestos ni sanciones (eso sigue siendo criterio del
contador con los CSV del motor como soporte), no toca el Libro Mayor, y no
llama a ningún LLM salvo en `responder_agente`, que pasa por `llm_budget`.
"""

from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

# Misma base que el Libro Mayor (cc_*): usar el mismo módulo garantiza que en
# pruebas (monkeypatch de _DB_PATH) y en producción se hable con un solo archivo.
from app.services.contabilidad_core import _conn, _ensure as _init_db

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DOCS_DIR = os.path.join(_REPO_ROOT, "comprobantes", "socios")

# Carpeta raíz del Declarador original. Dentro se espera una subcarpeta por
# socio (`Armando/`, `Cynthia/`…) y `Calculos/` con las salidas del motor.
DECLARADOR_DIR = os.getenv("DECLARADOR_DIR", "/home/mckg/Declarador")

# Categorías de documento del expediente (orden = orden en el panel).
CATEGORIAS_DOC: list[tuple[str, str]] = [
    ("declaracion_f210", "Declaración de renta (F210)"),
    ("exogena", "Información exógena DIAN"),
    ("extracto_banco", "Extracto bancario"),
    ("extracto_tarjeta", "Extracto tarjeta de crédito"),
    ("credito", "Cuota de crédito"),
    ("certificado_banco", "Certificado bancario anual"),
    ("binance_csv", "Historial Binance (CSV)"),
    ("binance_snapshot", "Snapshot de tenencia Binance"),
    ("binance_api", "Evidencia API Binance"),
    ("otra_plataforma", "Otra plataforma (Littio, MoonPay…)"),
    ("calculo", "Cálculo / motor de costo"),
    ("informe", "Informe para el contador"),
    ("formulario_ref", "Formulario 210 de referencia"),
    ("soporte", "Otro soporte"),
]
_CATS = {c for c, _ in CATEGORIAS_DOC}

ESTADOS_ANIO = ("sin_datos", "presentada", "borrador", "por_corregir", "corregida", "no_obligado", "no_presentada")
ESTADOS_HALLAZGO = ("pendiente", "en_curso", "resuelto", "descartado")
SEVERIDADES = ("alta", "media", "baja")

PASOS_WIZARD: list[tuple[str, str]] = [
    ("perfil", "Empecemos"),
    ("plan", "Plan de carga"),
    ("extractos", "Extractos personales"),
    ("mckenna", "Cuenta con McKenna"),
    ("cruces", "Cruces socio ↔ empresa"),
    ("declarador", "Activos digitales"),
    ("cierre", "Expediente para el contador"),
]


# ── Esquema ─────────────────────────────────────────────────────────────────

_tables_ready = False


def _ensure() -> None:
    global _tables_ready
    _init_db()
    if _tables_ready:
        return
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS dl_expedientes (
                tercero_id INTEGER PRIMARY KEY REFERENCES cc_terceros(id),
                cedula TEXT NOT NULL DEFAULT '',
                binance_uid TEXT NOT NULL DEFAULT '',
                binance_desde TEXT NOT NULL DEFAULT '',
                carpeta TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                pasos_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS dl_documentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
                categoria TEXT NOT NULL DEFAULT 'soporte',
                ano INTEGER,
                archivo_nombre TEXT NOT NULL DEFAULT '',
                archivo_path TEXT NOT NULL DEFAULT '',
                origen TEXT NOT NULL DEFAULT 'subido',
                tamano INTEGER NOT NULL DEFAULT 0,
                notas TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(tercero_id, archivo_path)
            );
            CREATE TABLE IF NOT EXISTS dl_anios (
                tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
                ano INTEGER NOT NULL,
                formulario TEXT NOT NULL DEFAULT '',
                presentada_en TEXT NOT NULL DEFAULT '',
                patrimonio_bruto REAL,
                deudas REAL,
                patrimonio_liquido REAL,
                renta_liquida REAL,
                impuesto_pagado REAL,
                ganancia_ocasional REAL,
                estado TEXT NOT NULL DEFAULT 'sin_datos',
                tenencia_cierre_usd REAL,
                cripto_renta_ordinaria REAL,
                cripto_ganancia_ocasional REAL,
                cripto_sin_costo REAL,
                cripto_eventos INTEGER,
                notas TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (tercero_id, ano)
            );
            CREATE TABLE IF NOT EXISTS dl_hallazgos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
                clave TEXT NOT NULL,
                ano INTEGER,
                severidad TEXT NOT NULL DEFAULT 'media',
                titulo TEXT NOT NULL,
                detalle TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT 'pendiente',
                origen TEXT NOT NULL DEFAULT 'manual',
                resolucion TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                resuelto_at TEXT,
                UNIQUE(tercero_id, clave)
            );
            CREATE TABLE IF NOT EXISTS dl_chat (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tercero_id INTEGER NOT NULL REFERENCES cc_terceros(id),
                rol TEXT NOT NULL,
                texto TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_dl_doc_tercero ON dl_documentos(tercero_id);
            CREATE INDEX IF NOT EXISTS idx_dl_hall_tercero ON dl_hallazgos(tercero_id);
            CREATE INDEX IF NOT EXISTS idx_dl_chat_tercero ON dl_chat(tercero_id);
            """
        )
        cols_docs = {r[1] for r in con.execute("PRAGMA table_info(dl_documentos)").fetchall()}
        if "ano_hasta" not in cols_docs:
            con.execute("ALTER TABLE dl_documentos ADD COLUMN ano_hasta INTEGER")
        cols_anios = {r[1] for r in con.execute("PRAGMA table_info(dl_anios)").fetchall()}
        for col in ("cripto_costo_cierre_usd", "cripto_costo_cierre_cop", "trm_cierre"):
            if col not in cols_anios:
                con.execute(f"ALTER TABLE dl_anios ADD COLUMN {col} REAL")
        cols_exp = {r[1] for r in con.execute("PRAGMA table_info(dl_expedientes)").fetchall()}
        if "tenencia_json" not in cols_exp:
            con.execute("ALTER TABLE dl_expedientes ADD COLUMN tenencia_json TEXT NOT NULL DEFAULT '{}'")
        cols = {r[1] for r in con.execute("PRAGMA table_info(dl_expedientes)").fetchall()}
        if "cuestionario_json" not in cols:
            # Respuestas del cuestionario inicial (¿tiene cripto?, ¿declaró antes?,
            # ¿desde qué año?…) que deciden qué pasos y documentos se piden.
            con.execute("ALTER TABLE dl_expedientes ADD COLUMN cuestionario_json TEXT NOT NULL DEFAULT '{}'")
    _tables_ready = True


def _tercero(con: sqlite3.Connection, tercero_id: int) -> dict:
    row = con.execute("SELECT * FROM cc_terceros WHERE id=?", (int(tercero_id),)).fetchone()
    if not row:
        raise ValueError("Tercero no encontrado")
    return dict(row)


# ── Expediente (perfil) ─────────────────────────────────────────────────────


def obtener_perfil(tercero_id: int) -> dict[str, Any]:
    _ensure()
    with _conn() as con:
        t = _tercero(con, tercero_id)
        row = con.execute(
            "SELECT * FROM dl_expedientes WHERE tercero_id=?", (int(tercero_id),)
        ).fetchone()
    exp = dict(row) if row else {}
    try:
        pasos = json.loads(exp.get("pasos_json") or "{}")
    except Exception:
        pasos = {}
    try:
        cuestionario = json.loads(exp.get("cuestionario_json") or "{}")
    except Exception:
        cuestionario = {}
    return {
        "cuestionario": cuestionario,
        "tercero": {
            "id": t["id"],
            "nombre": t["nombre"],
            "tipo": t["tipo"],
            "identificacion": t.get("identificacion") or "",
            "email": t.get("email") or "",
            "telefono": t.get("telefono") or "",
            "cuenta_bancaria": t.get("cuenta_bancaria") or "",
            "usuario_id": t.get("usuario_id"),
            "tipo_persona": t.get("tipo_persona") or "natural",
        },
        "cedula": exp.get("cedula") or t.get("identificacion") or "",
        "binance_uid": exp.get("binance_uid") or "",
        "binance_desde": exp.get("binance_desde") or "",
        "carpeta": exp.get("carpeta") or "",
        "notas": exp.get("notas") or "",
        "pasos": pasos,
        "existe": bool(row),
        "updated_at": exp.get("updated_at"),
    }


def guardar_perfil(tercero_id: int, payload: dict) -> dict[str, Any]:
    _ensure()
    campos = {
        k: str(payload.get(k) or "").strip()
        for k in ("cedula", "binance_uid", "binance_desde", "carpeta", "notas")
        if k in payload
    }
    pasos = payload.get("pasos")
    with _conn() as con:
        _tercero(con, tercero_id)
        con.execute(
            "INSERT OR IGNORE INTO dl_expedientes (tercero_id) VALUES (?)", (int(tercero_id),)
        )
        if campos:
            sets = ", ".join(f"{k}=?" for k in campos)
            con.execute(
                f"UPDATE dl_expedientes SET {sets}, updated_at=datetime('now') WHERE tercero_id=?",
                (*campos.values(), int(tercero_id)),
            )
        if isinstance(pasos, dict):
            con.execute(
                "UPDATE dl_expedientes SET pasos_json=?, updated_at=datetime('now') WHERE tercero_id=?",
                (json.dumps(pasos, ensure_ascii=False), int(tercero_id)),
            )
        cuestionario = payload.get("cuestionario")
        if isinstance(cuestionario, dict):
            row = con.execute(
                "SELECT cuestionario_json FROM dl_expedientes WHERE tercero_id=?", (int(tercero_id),)
            ).fetchone()
            try:
                actual = json.loads((row["cuestionario_json"] if row else "") or "{}")
            except Exception:
                actual = {}
            actual.update({k: v for k, v in cuestionario.items() if k in CUESTIONARIO_CLAVES or k == "omitidos"})
            con.execute(
                "UPDATE dl_expedientes SET cuestionario_json=?, updated_at=datetime('now') WHERE tercero_id=?",
                (json.dumps(actual, ensure_ascii=False), int(tercero_id)),
            )
        # La cédula del expediente y la identificación del tercero son el
        # mismo dato — mantenerlas iguales evita dos verdades.
        if campos.get("cedula"):
            con.execute(
                "UPDATE cc_terceros SET identificacion=? WHERE id=? AND (identificacion='' OR identificacion IS NULL)",
                (campos["cedula"], int(tercero_id)),
            )
    return obtener_perfil(tercero_id)


def marcar_paso(tercero_id: int, paso: str, hecho: bool) -> dict[str, Any]:
    if paso not in {p for p, _ in PASOS_WIZARD}:
        raise ValueError("paso inválido")
    perfil = obtener_perfil(tercero_id)
    pasos = dict(perfil.get("pasos") or {})
    pasos[paso] = {"hecho": bool(hecho), "en": datetime.now().isoformat(timespec="seconds")}
    return guardar_perfil(tercero_id, {"pasos": pasos})


# ── Documentos ──────────────────────────────────────────────────────────────

_ANO_RE = re.compile(r"(?<!\d)(20[12]\d)(?!\d)")

_REGLAS_CATEGORIA: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"declaracion\s*(19|20)\d{2}\.pdf$", re.I), "declaracion_f210"),
    (re.compile(r"exogena|exógena", re.I), "exogena"),
    (re.compile(r"accountstatementsnapshot|declaracion_sin_clave", re.I), "binance_snapshot"),
    (re.compile(r"evidencia_binance|binance_api_export|api_export|_trades\.json$|p2p_orders|withdrawals\.json|deposits\.json|spot_trades|spot_balances|fiat_pagos|dividendos_airdrops|conversiones\.csv|depositos\.csv|retiros\.csv", re.I), "binance_api"),
    (re.compile(r"declaracion binance|binance.*\.csv$|[0-9a-f]{8}-[0-9a-f]{4}-.*\.csv$", re.I), "binance_csv"),
    (re.compile(r"littio|moonpay|pexto", re.I), "otra_plataforma"),
    (re.compile(r"formulario\s*210", re.I), "formulario_ref"),
    (re.compile(r"informe|bitacora|leeme|balance_cripto", re.I), "informe"),
    (re.compile(r"ledger|eventos_realizados|trm_|precios_externos|ahorros_\d{4}|_klines|ganancia_perdida|libro_maestro", re.I), "calculo"),
    # Tarjetas antes que "extractos bancarios": los xlsx de tarjeta viven en la
    # misma carpeta «Extractos Bancarios <año>» y se distinguen por el nombre.
    # Bancolombia: «<cédula>_DIC<año>» = reporte anual de costos; «<cédula>-1-B_» =
    # certificado de operaciones de crédito; «<cédula>-1-B1_» = certificado de
    # retención en la fuente y GMF. «<9 dígitos>_MES<año>» = cuota de un crédito
    # de consumo (310154706, 310158870); «<11 dígitos>_» = cuenta de ahorros.
    (re.compile(r"^\d{10}(-1-B1?)?_[A-Z]{3}\d{4}\.xlsx$", re.I), "certificado_banco"),
    (re.compile(r"certificado", re.I), "certificado_banco"),
    (re.compile(r"^\d{9}_[A-Z]{3}\d{4}\.xlsx$", re.I), "credito"),
    (re.compile(r"^\d{11}_[A-Z]{3}\d{4}\.xlsx$", re.I), "extracto_banco"),
    (re.compile(r"^(1343|8017|3894)_", re.I), "extracto_tarjeta"),
    (re.compile(r"extractos? bancarios|documento_\d{6}_|estado de cuenta", re.I), "extracto_banco"),
    (re.compile(r"hugo armando garcia velandia\d?\.pdf$", re.I), "extracto_banco"),
]


def _clasificar_zip(path: str) -> str | None:
    """Categoría mayoritaria de los archivos dentro de un zip (los «Documento_
    YYYYMM_…zip» de Bancolombia traen tarjetas, créditos, certificados o la
    cuenta de ahorros, y solo se sabe mirando adentro)."""
    import zipfile
    from collections import Counter

    try:
        with zipfile.ZipFile(path) as z:
            nombres = [os.path.basename(n) for n in z.namelist() if not n.endswith("/")]
    except Exception:  # noqa: BLE001
        return None
    cuenta: Counter[str] = Counter()
    for n in nombres:
        cat = "soporte"
        for patron, c in _REGLAS_CATEGORIA:
            if patron.search(n):
                cat = c
                break
        cuenta[cat] += 1
    if not cuenta:
        return None
    # La cuenta de ahorros manda si viene: es lo que el plan exige mes a mes.
    if cuenta.get("extracto_banco"):
        return "extracto_banco"
    return cuenta.most_common(1)[0][0]


def _ano_exogena_por_contenido(path: str) -> int | None:
    """Año real de un reporte de exógena de la DIAN, leído de la fila «Año al
    que se refiere la consulta». El nombre del archivo lo pone quien descarga y
    se equivoca (reporte_Exogena2020.xls que por dentro era 2022)."""
    ext = os.path.splitext(path)[1].lower()
    texto = ""
    try:
        if ext in {".xlsx", ".xlsm"}:
            import openpyxl

            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            for i, fila in enumerate(wb.worksheets[0].iter_rows(values_only=True)):
                if i > 15:
                    break
                texto += " | ".join("" if c is None else str(c) for c in fila) + "\n"
        elif ext == ".xls":
            import shutil
            import tempfile

            soffice = shutil.which("soffice") or shutil.which("libreoffice")
            if not soffice:
                return None
            with tempfile.TemporaryDirectory() as tmp:
                subprocess.run([soffice, "--headless", "--convert-to", "csv", "--outdir", tmp, path], capture_output=True, timeout=60)
                csvs = [f for f in os.listdir(tmp) if f.lower().endswith(".csv")]
                if csvs:
                    with open(os.path.join(tmp, csvs[0]), encoding="utf-8", errors="replace") as fh:
                        texto = fh.read(4000)
        else:
            return None
    except Exception:  # noqa: BLE001
        return None
    m = re.search(r"a[ñn]o al que se refiere la consulta[^0-9]{0,20}(20\d{2})", texto, re.I)
    return int(m.group(1)) if m else None


_RANGO_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})\s*[-_–]\s*((?:19|20)\d{2})(?!\d)")


def rango_anios_en_nombre(path: str) -> tuple[int, int] | None:
    """«2020-2025.zip», «ahorros_2019_2024.csv», «Historial_2020-2024»: un solo
    archivo que cubre varios años. Sin esto, el archivo quedaba en el primer año
    y los demás salían en rojo en el mapa."""
    for parte in (os.path.basename(path), path.replace("\\", "/")):
        m = _RANGO_RE.search(parte)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 2000 <= a <= b <= 2100 and b - a <= 15:
                return a, b
    return None


def clasificar_archivo_rango(path: str) -> tuple[str, int | None, int | None]:
    """Como `clasificar_archivo`, pero devuelve también el último año cubierto
    cuando el nombre trae un rango (None si es de un solo año)."""
    cat, ano = clasificar_archivo(path)
    r = rango_anios_en_nombre(path)
    if r:
        return cat, r[0], r[1]
    return cat, ano, None


def clasificar_archivo(path: str) -> tuple[str, int | None]:
    """Categoría y año gravable inferidos del nombre/ruta (un zip se mira por
    dentro; un reporte de exógena se lee para sacar el año real)."""
    nombre = os.path.basename(path)
    rel = path.replace("\\", "/")
    categoria = "soporte"
    for patron, cat in _REGLAS_CATEGORIA:
        if patron.search(nombre) or patron.search(rel):
            categoria = cat
            break
    if nombre.lower().endswith(".zip") and re.search(r"documento_\d{6}_", nombre, re.I):
        categoria = _clasificar_zip(path) or categoria
    ano: int | None = None
    m = _ANO_RE.search(nombre) or _ANO_RE.search(rel)
    if m:
        ano = int(m.group(1))
    # Los zips mensuales del banco vienen como Documento_YYYYMM_...
    m2 = re.search(r"documento_(20\d{2})(\d{2})_", nombre, re.I)
    if m2:
        ano = int(m2.group(1))
    # Snapshot de Binance fechado 1 de enero = tenencia al 31-dic del año anterior.
    m3 = re.search(r"_(20\d{2})0101_", nombre)
    if categoria == "binance_snapshot" and m3:
        ano = int(m3.group(1)) - 1
    # El año del nombre lo pone quien descarga; el reporte de exógena trae el real.
    if categoria == "exogena" and os.path.isfile(path):
        real = _ano_exogena_por_contenido(path)
        if real:
            ano = real
    return categoria, ano


def listar_documentos(tercero_id: int) -> list[dict[str, Any]]:
    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM dl_documentos WHERE tercero_id=? ORDER BY categoria, ano, archivo_nombre",
            (int(tercero_id),),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["existe"] = bool(d.get("archivo_path")) and os.path.exists(d["archivo_path"])
        d["legible"] = _es_legible(d.get("archivo_nombre") or "")
        out.append(d)
    return out


def registrar_documento_existente(
    tercero_id: int,
    path: str,
    *,
    categoria: str | None = None,
    ano: int | None = None,
    notas: str = "",
) -> dict[str, Any] | None:
    """Referencia (sin copiar) a un archivo que ya está en disco. Idempotente
    por (tercero, ruta)."""
    _ensure()
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return None
    with _conn() as con:
        _tercero(con, tercero_id)
        # Un zip descomprimido a mano junto a su carpeta original (Littio.zip →
        # Littio/ además de Littio_capturas/) duplicaba cada captura: mismo
        # nombre y tamaño en otra ruta que sigue en disco = el mismo archivo.
        gemelo = con.execute(
            """SELECT * FROM dl_documentos
               WHERE tercero_id=? AND archivo_nombre=? AND tamano=? AND archivo_path<>?""",
            (int(tercero_id), os.path.basename(path)[:200], os.path.getsize(path), path),
        ).fetchone()
        if gemelo and os.path.isfile(gemelo["archivo_path"]):
            d = dict(gemelo)
            d["nuevo"] = False
            return d
    cat_auto, ano_auto, hasta_auto = clasificar_archivo_rango(path)
    cat = categoria if categoria in _CATS else cat_auto
    with _conn() as con:
        cur = con.execute(
            """INSERT OR IGNORE INTO dl_documentos
                 (tercero_id, categoria, ano, ano_hasta, archivo_nombre, archivo_path, origen, tamano, notas)
               VALUES (?, ?, ?, ?, ?, ?, 'carpeta', ?, ?)""",
            (
                int(tercero_id),
                cat,
                ano if ano is not None else ano_auto,
                None if ano is not None else hasta_auto,
                os.path.basename(path)[:200],
                path,
                os.path.getsize(path),
                (notas or "")[:400],
            ),
        )
        nuevo = cur.rowcount > 0
        row = con.execute(
            "SELECT * FROM dl_documentos WHERE tercero_id=? AND archivo_path=?",
            (int(tercero_id), path),
        ).fetchone()
    d = dict(row) if row else None
    if d is not None:
        d["nuevo"] = nuevo
    return d


def guardar_documento(
    tercero_id: int,
    contenido: bytes,
    nombre: str,
    *,
    categoria: str = "soporte",
    ano: int | None = None,
    notas: str = "",
) -> dict[str, Any]:
    """Archivo subido desde el panel → comprobantes/socios/<tercero_id>/."""
    _ensure()
    if not contenido:
        raise ValueError("Archivo vacío")
    if categoria not in _CATS:
        categoria = "soporte"
    seguro = re.sub(r"[^A-Za-z0-9._-]+", "_", nombre or "documento")[:120]
    carpeta = os.path.join(_DOCS_DIR, str(int(tercero_id)))
    os.makedirs(carpeta, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    path = os.path.join(carpeta, f"{stamp}_{seguro}")
    with open(path, "wb") as fh:
        fh.write(contenido)
    if ano is None:
        _, ano = clasificar_archivo(nombre)
    with _conn() as con:
        _tercero(con, tercero_id)
        cur = con.execute(
            """INSERT INTO dl_documentos
                 (tercero_id, categoria, ano, archivo_nombre, archivo_path, origen, tamano, notas)
               VALUES (?, ?, ?, ?, ?, 'subido', ?, ?)""",
            (int(tercero_id), categoria, ano, (nombre or seguro)[:200], path, len(contenido), (notas or "")[:400]),
        )
        row = con.execute("SELECT * FROM dl_documentos WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


def actualizar_documento(tercero_id: int, doc_id: int, payload: dict) -> dict[str, Any] | None:
    _ensure()
    campos: dict[str, Any] = {}
    if "categoria" in payload and payload["categoria"] in _CATS:
        campos["categoria"] = payload["categoria"]
    if "ano" in payload:
        try:
            campos["ano"] = int(payload["ano"]) if payload["ano"] not in (None, "") else None
        except (TypeError, ValueError):
            pass
    if "ano_hasta" in payload:
        try:
            campos["ano_hasta"] = int(payload["ano_hasta"]) if payload["ano_hasta"] not in (None, "") else None
        except (TypeError, ValueError):
            pass
    if "notas" in payload:
        campos["notas"] = str(payload["notas"] or "")[:400]
    with _conn() as con:
        if campos:
            sets = ", ".join(f"{k}=?" for k in campos)
            con.execute(
                f"UPDATE dl_documentos SET {sets} WHERE id=? AND tercero_id=?",
                (*campos.values(), int(doc_id), int(tercero_id)),
            )
        row = con.execute(
            "SELECT * FROM dl_documentos WHERE id=? AND tercero_id=?", (int(doc_id), int(tercero_id))
        ).fetchone()
    return dict(row) if row else None


def eliminar_documento(tercero_id: int, doc_id: int) -> bool:
    """Quita el documento del expediente. Solo borra del disco lo que se
    subió desde el panel; las referencias a la carpeta del Declarador se
    desregistran sin tocar el archivo original."""
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM dl_documentos WHERE id=? AND tercero_id=?", (int(doc_id), int(tercero_id))
        ).fetchone()
        if not row:
            return False
        d = dict(row)
        con.execute("DELETE FROM dl_documentos WHERE id=?", (int(doc_id),))
    if d.get("origen") == "subido" and d.get("archivo_path") and d["archivo_path"].startswith(_DOCS_DIR):
        try:
            os.remove(d["archivo_path"])
        except OSError:
            pass
    return True


def ruta_documento(tercero_id: int, doc_id: int) -> tuple[str, str] | None:
    _ensure()
    with _conn() as con:
        row = con.execute(
            "SELECT archivo_path, archivo_nombre FROM dl_documentos WHERE id=? AND tercero_id=?",
            (int(doc_id), int(tercero_id)),
        ).fetchone()
    if not row or not row["archivo_path"] or not os.path.exists(row["archivo_path"]):
        return None
    return row["archivo_path"], row["archivo_nombre"]


_EXT_TEXTO = {".md", ".txt", ".csv", ".json", ".tsv"}


def _es_legible(nombre: str) -> bool:
    ext = os.path.splitext(nombre or "")[1].lower()
    return ext in _EXT_TEXTO or ext in {".pdf", ".xlsx", ".xls", ".xlsm"}


def leer_documento_texto(tercero_id: int, doc_id: int, max_chars: int = 12000) -> str:
    """Texto plano de un documento (para el agente): md/txt/csv/json directo,
    PDF vía `pdftotext`, Excel vía openpyxl (primera hoja). Recortado a
    `max_chars` para no reventar el presupuesto de tokens."""
    r = ruta_documento(tercero_id, doc_id)
    if not r:
        return "(documento no disponible en disco)"
    path, nombre = r
    ext = os.path.splitext(nombre)[1].lower()
    max_chars = max(500, min(int(max_chars or 12000), 60000))
    try:
        if ext in _EXT_TEXTO:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                return fh.read(max_chars)
        if ext == ".pdf":
            out = subprocess.run(
                ["pdftotext", "-layout", "-l", "40", path, "-"],
                capture_output=True,
                text=True,
                timeout=40,
            )
            return (out.stdout or "")[:max_chars] or "(PDF sin texto extraíble — probablemente escaneado)"
        if ext in {".xlsx", ".xlsm"}:
            import openpyxl

            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            ws = wb.worksheets[0]
            lineas = []
            for i, fila in enumerate(ws.iter_rows(values_only=True)):
                if i > 400:
                    break
                lineas.append(" | ".join("" if c is None else str(c) for c in fila))
            return "\n".join(lineas)[:max_chars]
        if ext == ".xls":
            # Excel antiguo (los reportes de exógena de la DIAN de 2021/2022
            # llegan así): se convierte a CSV con LibreOffice en un temporal.
            import shutil
            import tempfile

            soffice = shutil.which("soffice") or shutil.which("libreoffice")
            if not soffice:
                return "(Excel .xls antiguo y LibreOffice no está instalado: conviértelo a .xlsx o CSV)"
            with tempfile.TemporaryDirectory() as tmp:
                subprocess.run(
                    [soffice, "--headless", "--convert-to", "csv", "--outdir", tmp, path],
                    capture_output=True,
                    timeout=60,
                )
                csvs = [f for f in os.listdir(tmp) if f.lower().endswith(".csv")]
                if not csvs:
                    return "(no se pudo convertir el .xls con LibreOffice)"
                with open(os.path.join(tmp, csvs[0]), "r", encoding="utf-8", errors="replace") as fh:
                    return fh.read(max_chars)
    except Exception as e:  # noqa: BLE001
        return f"(no se pudo leer: {e})"
    return "(formato no legible como texto — imagen o binario)"


# ── Años gravables ──────────────────────────────────────────────────────────

_CAMPOS_ANIO_NUM = (
    "patrimonio_bruto",
    "deudas",
    "patrimonio_liquido",
    "renta_liquida",
    "impuesto_pagado",
    "ganancia_ocasional",
    "tenencia_cierre_usd",
    "cripto_renta_ordinaria",
    "cripto_ganancia_ocasional",
    "cripto_sin_costo",
    "cripto_costo_cierre_usd",
    "cripto_costo_cierre_cop",
    "trm_cierre",
)


def listar_anios(tercero_id: int) -> list[dict[str, Any]]:
    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT * FROM dl_anios WHERE tercero_id=? ORDER BY ano", (int(tercero_id),)
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        ro = d.get("cripto_renta_ordinaria") or 0
        go = d.get("cripto_ganancia_ocasional") or 0
        sc = d.get("cripto_sin_costo") or 0
        d["cripto_total"] = round(ro + go + sc, 2) if any(
            d.get(k) is not None for k in ("cripto_renta_ordinaria", "cripto_ganancia_ocasional", "cripto_sin_costo")
        ) else None
        # Señal de omisión: hay cripto con efecto y la declaración ya se presentó sin él.
        d["requiere_revision"] = bool(
            d["estado"] == "presentada" and d["cripto_total"] is not None and abs(d["cripto_total"]) >= 1000
        )
        out.append(d)
    return out


def actualizar_anio(tercero_id: int, ano: int, payload: dict) -> dict[str, Any]:
    _ensure()
    campos: dict[str, Any] = {}
    for k in _CAMPOS_ANIO_NUM:
        if k in payload:
            v = payload[k]
            if v in (None, ""):
                campos[k] = None
            else:
                try:
                    campos[k] = float(str(v).replace(",", ""))
                except ValueError:
                    raise ValueError(f"{k} debe ser numérico") from None
    for k in ("formulario", "presentada_en", "notas"):
        if k in payload:
            campos[k] = str(payload[k] or "").strip()[:400]
    if "cripto_eventos" in payload:
        try:
            campos["cripto_eventos"] = int(payload["cripto_eventos"] or 0)
        except (TypeError, ValueError):
            pass
    if "estado" in payload:
        if payload["estado"] not in ESTADOS_ANIO:
            raise ValueError(f"estado inválido; usa uno de {', '.join(ESTADOS_ANIO)}")
        campos["estado"] = payload["estado"]
    with _conn() as con:
        _tercero(con, tercero_id)
        con.execute(
            "INSERT OR IGNORE INTO dl_anios (tercero_id, ano) VALUES (?, ?)",
            (int(tercero_id), int(ano)),
        )
        if campos:
            sets = ", ".join(f"{k}=?" for k in campos)
            con.execute(
                f"UPDATE dl_anios SET {sets}, updated_at=datetime('now') WHERE tercero_id=? AND ano=?",
                (*campos.values(), int(tercero_id), int(ano)),
            )
        row = con.execute(
            "SELECT * FROM dl_anios WHERE tercero_id=? AND ano=?", (int(tercero_id), int(ano))
        ).fetchone()
    return dict(row)


# ── Hallazgos ───────────────────────────────────────────────────────────────


def listar_hallazgos(tercero_id: int, *, solo_abiertos: bool = False) -> list[dict[str, Any]]:
    _ensure()
    sql = "SELECT * FROM dl_hallazgos WHERE tercero_id=?"
    if solo_abiertos:
        sql += " AND estado IN ('pendiente','en_curso')"
    sql += (
        " ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'en_curso' THEN 1 ELSE 2 END,"
        " CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, ano, id"
    )
    with _conn() as con:
        rows = con.execute(sql, (int(tercero_id),)).fetchall()
    return [dict(r) for r in rows]


def crear_hallazgo(tercero_id: int, payload: dict, *, origen: str = "manual") -> dict[str, Any]:
    _ensure()
    titulo = str(payload.get("titulo") or "").strip()
    if not titulo:
        raise ValueError("titulo requerido")
    sev = str(payload.get("severidad") or "media")
    if sev not in SEVERIDADES:
        sev = "media"
    clave = str(payload.get("clave") or "").strip() or re.sub(r"[^a-z0-9]+", "_", titulo.lower())[:60]
    ano = payload.get("ano")
    try:
        ano_i = int(ano) if ano not in (None, "") else None
    except (TypeError, ValueError):
        ano_i = None
    with _conn() as con:
        _tercero(con, tercero_id)
        con.execute(
            """INSERT INTO dl_hallazgos (tercero_id, clave, ano, severidad, titulo, detalle, origen)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(tercero_id, clave) DO UPDATE SET
                 titulo=excluded.titulo,
                 detalle=CASE WHEN excluded.detalle != '' THEN excluded.detalle ELSE dl_hallazgos.detalle END,
                 severidad=excluded.severidad,
                 ano=COALESCE(excluded.ano, dl_hallazgos.ano)""",
            (int(tercero_id), clave, ano_i, sev, titulo[:200], str(payload.get("detalle") or "")[:2000], origen),
        )
        row = con.execute(
            "SELECT * FROM dl_hallazgos WHERE tercero_id=? AND clave=?", (int(tercero_id), clave)
        ).fetchone()
    return dict(row)


def actualizar_hallazgo(tercero_id: int, hallazgo_id: int, payload: dict) -> dict[str, Any] | None:
    _ensure()
    campos: dict[str, Any] = {}
    if "estado" in payload:
        if payload["estado"] not in ESTADOS_HALLAZGO:
            raise ValueError(f"estado inválido; usa uno de {', '.join(ESTADOS_HALLAZGO)}")
        campos["estado"] = payload["estado"]
        campos["resuelto_at"] = (
            datetime.now().isoformat(timespec="seconds")
            if payload["estado"] in ("resuelto", "descartado")
            else None
        )
    if "resolucion" in payload:
        campos["resolucion"] = str(payload["resolucion"] or "")[:2000]
    for k in ("titulo", "detalle"):
        if k in payload and str(payload[k] or "").strip():
            campos[k] = str(payload[k]).strip()[:2000]
    if "severidad" in payload and payload["severidad"] in SEVERIDADES:
        campos["severidad"] = payload["severidad"]
    with _conn() as con:
        if campos:
            sets = ", ".join(f"{k}=?" for k in campos)
            con.execute(
                f"UPDATE dl_hallazgos SET {sets} WHERE id=? AND tercero_id=?",
                (*campos.values(), int(hallazgo_id), int(tercero_id)),
            )
        row = con.execute(
            "SELECT * FROM dl_hallazgos WHERE id=? AND tercero_id=?", (int(hallazgo_id), int(tercero_id))
        ).fetchone()
    return dict(row) if row else None


# ── Motor de criptoactivos (salidas del Declarador) ─────────────────────────


def _carpeta_calculos(carpeta_socio: str) -> str:
    """`Calculos/` DENTRO de la carpeta del socio (puede ser un enlace simbólico,
    como en `Armando/Calculos -> ../Calculos`). Nunca la de la raíz del
    Declarador: la primera importación de Cynthia se trajo los cálculos cripto de
    Armando porque estaban al nivel de arriba."""
    cand = os.path.join(carpeta_socio, "Calculos")
    return cand if os.path.isdir(cand) else ""


def resumen_cripto_fifo(ruta_csv: str) -> dict[int, dict[str, Any]]:
    """Agrega `eventos_realizados_fifo.csv` (motor FIFO del Declarador) por
    año y cédula tributaria. Solo lectura; con el módulo csv de la librería
    estándar para no depender de pandas en el proceso de Flask."""
    if not ruta_csv or not os.path.isfile(ruta_csv):
        return {}
    acum: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    eventos: dict[int, int] = defaultdict(int)
    with open(ruta_csv, newline="", encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            try:
                ano = int((row.get("fecha") or "")[:4])
                gan = float(row.get("ganancia_cop") or 0)
            except ValueError:
                continue
            ced = (row.get("cedula") or "").strip()
            if ced == "renta_ordinaria":
                acum[ano]["renta_ordinaria"] += gan
            elif ced == "ganancia_ocasional":
                acum[ano]["ganancia_ocasional"] += gan
            else:
                acum[ano]["sin_costo_base"] += gan
            eventos[ano] += 1
    return {
        ano: {
            "cripto_renta_ordinaria": round(v["renta_ordinaria"], 2),
            "cripto_ganancia_ocasional": round(v["ganancia_ocasional"], 2),
            "cripto_sin_costo": round(v["sin_costo_base"], 2),
            "cripto_eventos": eventos[ano],
        }
        for ano, v in sorted(acum.items())
    }


# Para_Contador/ es el paquete armado para el contador: COPIAS de los mismos
# archivos organizadas por tema. Solo se registra su informe principal; si se
# recorriera entera, cada extracto y cada F210 quedaría dos veces.
_SALTAR_DIRS = {"__pycache__", ".claude", "node_modules", ".git", "binance_klines", "coingecko", "binance_api_export", "Para_Contador"}
_SALTAR_EXT = {".pyc"}
_EXT_IMAGEN = {".png", ".jpg", ".jpeg", ".webp"}


_STABLE = {"USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP"}
_OPS_TRANSFERENCIA_INTERNA = {
    "Transfer Between Main and Funding Wallet",
    "Transfer Between Spot Account and UM Futures Account",
    "Transfer Between Main Account And Mining Account",
    "Transfer Between Main And Mining Account",
    "Asset - Transfer",
}


def tenencia_fifo_por_anio(ruta_ledger: str, ruta_trm: str) -> dict[int, dict[str, Any]]:
    """Costo fiscal (FIFO) de lo que quedaba en Binance al 31 de diciembre de
    cada año, en USD y en COP a la TRM de esa fecha. Es el «activo omitido»
    que va al patrimonio bruto (renglón 29) de cada corrección. Misma lógica
    de lotes que `Calculos/scripts/12_valor_tenencia_actual.py`, que solo lo
    hacía para el último cierre; las stablecoins sin precio en el ledger
    valen 1 USD (igual que en `08_price_engine_v2.py`).

    Solo cuenta lo que está EN Binance: lo retirado a otra billetera o a
    Littio no aparece aquí aunque siga siendo del titular."""
    if not (ruta_ledger and os.path.isfile(ruta_ledger)):
        return {}
    trm: dict[str, float] = {}
    if ruta_trm and os.path.isfile(ruta_trm):
        with open(ruta_trm, newline="", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                try:
                    trm[(r.get("fecha") or "")[:10]] = float(r.get("trm") or 0)
                except ValueError:
                    continue
    filas: list[tuple[str, str, float, float]] = []
    with open(ruta_ledger, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            if r.get("Operation") in _OPS_TRANSFERENCIA_INTERNA or r.get("Coin") == "COP":
                continue
            try:
                ch = float(r.get("Change") or 0)
                px = float(r.get("price_usd") or 0)
            except ValueError:
                continue
            if r.get("Coin") in _STABLE and not px:
                px = 1.0
            filas.append((r.get("UTC_Time") or "", r.get("Coin") or "", ch, px))
    if not filas:
        return {}
    filas.sort()
    primer = int(filas[0][0][:4])
    ultimo = int(filas[-1][0][:4])
    from collections import deque

    lotes: dict[str, deque] = defaultdict(deque)
    out: dict[int, dict[str, Any]] = {}

    mensual: list[dict[str, Any]] = []

    def _trm_fin_de(y: int, m: int) -> float | None:
        for dd in (31, 30, 29, 28):
            v = trm.get(f"{y}-{m:02d}-{dd:02d}")
            if v:
                return v
        return None

    def foto(ano: int) -> None:
        total = 0.0
        det = []
        for coin, dq in lotes.items():
            q = sum(l[0] for l in dq)
            c = sum(l[0] * l[1] for l in dq)
            if q > 1e-6:
                total += c
                det.append({"coin": coin, "cantidad": round(q, 6), "costo_usd": round(c, 2)})
        det.sort(key=lambda x: -x["costo_usd"])
        t = _trm_fin_de(ano, 12)
        out[ano] = {
            "cripto_costo_cierre_usd": round(total, 2),
            "trm_cierre": t,
            "cripto_costo_cierre_cop": round(total * t) if t else None,
            "detalle": det,
        }

    def foto_mes(y: int, m: int) -> None:
        total = sum(l[0] * l[1] for dq in lotes.values() for l in dq if l[0] > 1e-6)
        t = _trm_fin_de(y, m)
        mensual.append({"mes": f"{y}-{m:02d}", "costo_usd": round(total, 2), "costo_cop": round(total * t) if t else None})

    ano_corte = primer
    mes_corte = int(filas[0][0][5:7])
    for t, coin, ch, px in filas:
        y, m = int(t[:4]), int(t[5:7])
        while (ano_corte, mes_corte) < (y, m):
            foto_mes(ano_corte, mes_corte)
            if mes_corte == 12:
                foto(ano_corte)
                ano_corte += 1
                mes_corte = 1
            else:
                mes_corte += 1
        if ch > 0:
            lotes[coin].append([ch, px])
        elif ch < 0:
            resto = -ch
            while resto > 1e-12 and lotes[coin]:
                l = lotes[coin][0]
                take = min(l[0], resto)
                l[0] -= take
                resto -= take
                if l[0] <= 1e-12:
                    lotes[coin].popleft()
    while ano_corte <= ultimo:
        foto_mes(ano_corte, mes_corte)
        if mes_corte == 12:
            foto(ano_corte)
            ano_corte += 1
            mes_corte = 1
        else:
            mes_corte += 1
    out["_mensual"] = mensual  # type: ignore[index]
    return out


# Tabla del Art. 241 ET (personas naturales residentes), en UVT: (desde, hasta,
# tarifa marginal, impuesto acumulado en UVT al inicio del rango). Vigente sin
# cambios para los años gravables 2019 en adelante (Ley 2010/2019; la Ley
# 2277/2022 no la modificó).
_TABLA_ART_241 = [
    (0, 1090, 0.00, 0),
    (1090, 1700, 0.19, 0),
    (1700, 4100, 0.28, 116),
    (4100, 8670, 0.33, 788),
    (8670, 18970, 0.35, 2296),
    (18970, 31000, 0.37, 5901),
    (31000, float("inf"), 0.39, 10352),
]


def impuesto_renta_art241(renta_liquida_gravable_cop: float, ano: int) -> float | None:
    """Impuesto de renta de una persona natural sobre la renta líquida gravable
    de la cédula general (Art. 241 ET). Devuelve None si la UVT del año no
    está cargada — nunca se extrapola."""
    from app.services.retenciones import uvt

    u = uvt(int(ano))
    if not u or renta_liquida_gravable_cop is None:
        return None
    rlg_uvt = max(0.0, float(renta_liquida_gravable_cop)) / u
    for lo, hi, tarifa, base in _TABLA_ART_241:
        if lo < rlg_uvt <= hi:
            return round(((rlg_uvt - lo) * tarifa + base) * u)
    return 0.0


_CERT_CACHE: dict[tuple[str, float], dict[str, Any]] = {}

_ENCABEZADOS_PRODUCTO = ("TARJETA MASTERCARD", "MASTER CARD", "CUENTA DE AHORROS", "DEPOSITO DE BAJO MONTO", "NEQUI", "PRESTAMO", "PRESTAMO COMERCIAL")


def _filas_xlsx(path: str, max_filas: int = 400) -> list[list[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        for i, fila in enumerate(ws.iter_rows(values_only=True)):
            if i > max_filas:
                break
            out.append(["" if c is None else str(c).strip() for c in fila])
    return out


def _num(txt: str) -> float | None:
    t = (txt or "").replace("$", "").replace(" ", "").replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def resumen_tarjeta_certificado(path: str) -> dict[str, Any]:
    """Lo que el «Reporte anual de costos totales» y el «Certificado anual de
    retención» de Bancolombia dicen de la TARJETA DE CRÉDITO de ese año.

    Existe porque los extractos mensuales de tarjeta anteriores a ago-2024 ya no
    se pueden descargar: el banco solo conserva los últimos 12-24 meses. Estos
    certificados son la fuente oficial que sí cubre los años viejos, con cifras
    agregadas (no el detalle comercio por comercio)."""
    if not os.path.isfile(path):
        return {}
    clave = (path, os.path.getmtime(path))
    if clave in _CERT_CACHE:
        return _CERT_CACHE[clave]
    out: dict[str, Any] = {}
    try:
        filas = _filas_xlsx(path)
    except Exception:  # noqa: BLE001
        return {}
    en_tarjeta = False
    for fila in filas:
        texto = " | ".join(fila)
        primera = fila[0] if fila else ""
        up = primera.upper()
        # ── Reporte anual de costos: secciones por producto ──
        if up.startswith("TARJETA MASTERCARD") or up.startswith("MASTER CARD"):
            en_tarjeta = True
            m = re.search(r"(\d{12,19})", primera)
            if m:
                tarjetas = out.setdefault("tarjetas", [])
                etiqueta_t = f"****{m.group(1)[-4:]}"
                if etiqueta_t not in tarjetas:
                    tarjetas.append(etiqueta_t)
            continue
        if en_tarjeta and any(up.startswith(h) for h in _ENCABEZADOS_PRODUCTO):
            en_tarjeta = False
        if en_tarjeta:
            etiqueta = primera.upper()
            ops = int(_num(fila[1]) or 0) if len(fila) > 1 and _num(fila[1]) is not None else None
            moneda = next((c for c in fila if c in ("COP", "USD")), "")
            valor = next((_num(c) for c in reversed(fila) if _num(c) is not None and c not in ("COP", "USD")), None)
            if valor is None:
                continue
            def _acum(campo: str) -> None:
                # Un año puede traer dos tarjetas (8017 y 3894): se suman.
                celda = out.setdefault(campo, {}).setdefault(moneda or "COP", {"operaciones": 0, "valor": 0.0})
                celda["operaciones"] = (celda["operaciones"] or 0) + (ops or 0)
                celda["valor"] = round((celda["valor"] or 0) + valor, 2)

            if etiqueta.startswith("UTILIZACIONES"):
                _acum("consumos")
            elif etiqueta.startswith("PAGOS A CAPITAL"):
                _acum("pagos_capital")
            elif etiqueta.startswith("PAGOS A INTERES"):
                _acum("intereses_pagados")
            elif "AVANCE" in etiqueta:
                av = out.setdefault("avances", {"operaciones": 0, "comision": 0.0})
                av["operaciones"] += ops or 0
                av["comision"] = round(av["comision"] + valor, 2)
            elif "CUOTA" in etiqueta and "MANEJO" in etiqueta:
                out["cuota_manejo"] = round((out.get("cuota_manejo") or 0) + valor, 2)
        # ── Certificado de retención (B1): saldo e intereses causados ──
        if "SALDO TARJETA DE CR" in primera.upper():
            nums = [_num(c) for c in fila[1:] if _num(c) is not None]
            if nums:
                out["saldo_31dic"] = {
                    "capital": nums[0],
                    "interes": nums[1] if len(nums) > 1 else None,
                    "otros": nums[2] if len(nums) > 2 else None,
                }
        if "INTERESES CAUSADOS TARJETA" in texto.upper():
            v = next((_num(c) for c in reversed(fila) if _num(c) is not None), None)
            if v is not None:
                out["intereses_causados"] = v
        if "SALDO CUENTA AHORROS" in primera.upper():
            v = next((_num(c) for c in reversed(fila) if _num(c) is not None), None)
            if v is not None:
                out["saldo_ahorros_31dic"] = v
    _CERT_CACHE[clave] = out
    return out


def tarjeta_por_anio(docs: list[dict]) -> dict[int, dict[str, Any]]:
    """Consolida, por año gravable, lo que dicen los certificados anuales sobre
    la tarjeta de crédito. Es lo que sustituye a los extractos mensuales que el
    banco ya no entrega."""
    out: dict[int, dict[str, Any]] = {}
    for d in docs:
        if d.get("categoria") != "certificado_banco" or not d.get("ano"):
            continue
        nombre = (d.get("archivo_nombre") or "").lower()
        if not nombre.endswith((".xlsx", ".xlsm")):
            continue
        datos = resumen_tarjeta_certificado(d["archivo_path"])
        if not datos:
            continue
        ano = int(d["ano"])
        acum = out.setdefault(ano, {"fuentes": []})
        for k, v in datos.items():
            if k == "tarjetas":
                lista = acum.setdefault("tarjetas", [])
                lista.extend(t for t in v if t not in lista)
            elif k not in acum or not acum.get(k):
                acum[k] = v
        acum["fuentes"].append(d["archivo_nombre"])
    return out


def _cantidad(x: float) -> str:
    """Cantidad de cripto legible: sin ceros de relleno, pero sin truncar un BTC
    a «0.00» (que fue lo que pasó al formatear todo con 2 decimales)."""
    if x == 0:
        return "0"
    txt = f"{x:,.8f}".rstrip("0").rstrip(".") if abs(x) < 1000 else f"{x:,.2f}".rstrip("0").rstrip(".")
    return txt


def creditos_desde_certificados(docs: list[dict]) -> list[dict[str, Any]]:
    """Préstamos y cupos de tarjeta con su fecha de desembolso, monto, plazo y
    tasa, leídos de los certificados anuales de Bancolombia. Son los hitos que
    explican de dónde salió la plata en la línea de tiempo."""
    vistos: dict[tuple, dict[str, Any]] = {}
    for d in docs:
        if d.get("categoria") != "certificado_banco" or not (d.get("archivo_nombre") or "").lower().endswith((".xlsx", ".xlsm")):
            continue
        try:
            filas = _filas_xlsx(d["archivo_path"])
        except Exception:  # noqa: BLE001
            continue
        producto = ""
        for fila in filas:
            primera = (fila[0] if fila else "").strip()
            up = primera.upper()
            # Reporte anual de costos: «Prestamo de Consumo Nro.: 310154706» + «VALOR DEL DESEMBOLSO»
            if up.startswith("PRESTAMO"):
                producto = primera
                continue
            if up.startswith("VALOR DEL DESEMBOLSO") and producto:
                fecha = next((c for c in fila[1:] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", c or "")), "")
                monto = next((_num(c) for c in reversed(fila) if _num(c) is not None), None)
                num = re.search(r"(\d{6,})", producto)
                if fecha and monto:
                    vistos[("prestamo", num.group(1) if num else producto, fecha)] = {
                        "fecha": fecha,
                        "tipo": "credito",
                        "producto": producto.split("Nro.")[0].strip(" :"),
                        "numero": num.group(1) if num else "",
                        "monto": monto,
                        "moneda": "COP",
                        "fuente": d["archivo_nombre"],
                    }
                continue
            # Certificado de operaciones de crédito: tabla con fecha de originación
            if len(fila) >= 7 and re.fullmatch(r"\d{2}/\d{2}/\d{4}", (fila[2] or "").strip()):
                dd, mm, yy = fila[2].split("/")
                monto = _num(fila[3])
                if monto is None:
                    continue
                vistos[("cred", (fila[1] or "").strip(), f"{yy}-{mm}-{dd}")] = {
                    "fecha": f"{yy}-{mm}-{dd}",
                    "tipo": "credito",
                    "producto": (fila[0] or "").strip(),
                    "numero": (fila[1] or "").strip(),
                    "monto": monto,
                    "moneda": (fila[6] or "COP").strip(),
                    "plazo": (fila[4] or "").strip(),
                    "tasa": (fila[5] or "").strip(),
                    "fuente": d["archivo_nombre"],
                }
    return sorted(vistos.values(), key=lambda x: x["fecha"])


def hitos_binance(carpeta_calculos: str) -> list[dict[str, Any]]:
    """Operaciones de Binance que dejan rastro verificable fuera del exchange:
    compras y ventas P2P (tienen contraparte bancaria en COP) y los retiros y
    depósitos de cripto. Son las que el contador puede cruzar contra el banco."""
    out: list[dict[str, Any]] = []
    p2p = os.path.join(carpeta_calculos or "", "evidencia_binance_p2p.csv")
    if os.path.isfile(p2p):
        with open(p2p, newline="", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                if (r.get("orderStatus") or "").upper() != "COMPLETED":
                    continue
                fecha = (r.get("fecha_utc") or "")[:10]
                if not fecha:
                    continue
                compra = (r.get("tradeType") or "").upper() == "BUY"
                out.append(
                    {
                        "fecha": fecha,
                        "tipo": "p2p",
                        "titulo": f"{'Compra' if compra else 'Venta'} P2P de {_cantidad(float(r.get('amount') or 0))} {r.get('asset')}",
                        "detalle": f"{'Pagó' if compra else 'Recibió'} {float(r.get('totalPrice') or 0):,.0f} COP a {r.get('unitPrice')} COP/{r.get('asset')} · {r.get('payMethodName') or 'sin método'} · orden {r.get('orderNumber')}",
                        "monto": float(r.get("totalPrice") or 0),
                        "entrada": compra,
                        "fuente": "evidencia_binance_p2p.csv",
                    }
                )
    for archivo, etiqueta in (("evidencia_binance_retiros.csv", "Retiro"), ("evidencia_binance_depositos.csv", "Depósito")):
        ruta = os.path.join(carpeta_calculos or "", archivo)
        if not os.path.isfile(ruta):
            continue
        with open(ruta, newline="", encoding="utf-8", errors="replace") as fh:
            for r in csv.DictReader(fh):
                fecha = (r.get("applyTime") or r.get("insertTime") or r.get("completeTime") or "")[:10]
                cant = float(r.get("amount") or 0)
                if not fecha or not cant:
                    continue
                out.append(
                    {
                        "fecha": fecha,
                        "tipo": "movimiento",
                        "titulo": f"{etiqueta} de {_cantidad(cant)} {r.get('coin')}",
                        "detalle": f"red {r.get('network') or '—'}"
                        + (f" · dirección {(r.get('address') or '')[:14]}…" if r.get("address") else ""),
                        "monto": None,
                        "entrada": etiqueta == "Depósito",
                        "fuente": archivo,
                    }
                )
    return sorted(out, key=lambda x: x["fecha"])


def cronologia(tercero_id: int) -> dict[str, Any]:
    """El expediente como línea de tiempo: un bloque por año gravable con lo que
    se declaró, lo que realmente pasó, los hitos fechados y los documentos que
    lo prueban. Es la vista que recorre el contador para verificar cifra por
    cifra contra su soporte."""
    perfil = obtener_perfil(tercero_id)
    docs = listar_documentos(tercero_id)
    anios_db = {int(a["ano"]): a for a in listar_anios(tercero_id)}
    plan = plan_carga(tercero_id, perfil, docs)
    objetivo = objetivo_declaraciones(list(anios_db.values()), docs, plan)
    obj_por_ano = {int(x["ano"]): x for x in objetivo.get("anios", [])}
    hallazgos = listar_hallazgos(tercero_id)
    tarjetas = tarjeta_por_anio(docs)
    creditos = creditos_desde_certificados(docs)
    ten = _tenencia_guardada(tercero_id)
    labels = dict(CATEGORIAS_DOC)
    try:
        from app.services.extracto_bancario import cobertura_mensual

        cobertura = cobertura_mensual(int(tercero_id))
    except Exception:  # noqa: BLE001
        cobertura = {"anios": {}}
    calc = _carpeta_calculos(perfil.get("carpeta") or "")
    hb = hitos_binance(calc) if calc else []

    anios = sorted(set(plan["anios"]) | set(anios_db))
    bloques = []
    for ano in anios:
        a = anios_db.get(ano, {})
        obj = obj_por_ano.get(ano, {})
        hitos: list[dict[str, Any]] = []
        if a.get("presentada_en"):
            hitos.append(
                {
                    "fecha": a["presentada_en"][:10],
                    "tipo": "declaracion",
                    "titulo": f"Declaración de renta {ano} presentada a la DIAN",
                    "detalle": f"Formulario {a.get('formulario') or '—'} · patrimonio bruto {a.get('patrimonio_bruto') or 0:,.0f} · renta líquida {a.get('renta_liquida') or 0:,.0f} · impuesto {a.get('impuesto_pagado') or 0:,.0f}. Sin criptoactivos.",
                    "monto": None,
                    "fuente": "F210",
                }
            )
        for c in creditos:
            if c["fecha"][:4] == str(ano):
                hitos.append(
                    {
                        "fecha": c["fecha"],
                        "tipo": "credito",
                        "titulo": f"{c['producto']} desembolsado: {c['monto']:,.2f} {c['moneda']}",
                        "detalle": " · ".join(x for x in [f"obligación {c['numero']}" if c.get("numero") else "", c.get("plazo", ""), c.get("tasa", "")] if x),
                        "monto": c["monto"] if c["moneda"] == "COP" else None,
                        "fuente": c["fuente"],
                    }
                )
        for h in hb:
            if h["fecha"][:4] == str(ano):
                hitos.append(h)
        hitos.sort(key=lambda x: (x["fecha"], x["tipo"] != "declaracion"))
        docs_ano = [
            {
                "id": d["id"],
                "categoria": d["categoria"],
                "categoria_label": labels.get(d["categoria"], d["categoria"]),
                "archivo_nombre": d["archivo_nombre"],
                "ano": d.get("ano"),
                "ano_hasta": d.get("ano_hasta"),
                "existe": d.get("existe"),
                "legible": d.get("legible"),
            }
            for d in docs
            if d.get("ano") and int(d["ano"]) <= ano <= int(d.get("ano_hasta") or d["ano"])
        ]
        cob = (cobertura.get("anios") or {}).get(str(ano)) or {}
        tenencia = (ten.get("anios") or {}).get(str(ano)) or {}
        bloques.append(
            {
                "ano": ano,
                "estado": a.get("estado") or "sin_datos",
                "situacion": obj.get("situacion"),
                "accion": obj.get("accion"),
                "presentacion": obj.get("presentacion"),
                "declarado": {
                    "formulario": a.get("formulario") or "",
                    "presentada_en": a.get("presentada_en") or "",
                    "patrimonio_bruto": a.get("patrimonio_bruto"),
                    "deudas": a.get("deudas"),
                    "patrimonio_liquido": a.get("patrimonio_liquido"),
                    "renta_liquida": a.get("renta_liquida"),
                    "impuesto_pagado": a.get("impuesto_pagado"),
                },
                "cripto": {
                    "efecto": a.get("cripto_total"),
                    "renta_ordinaria": a.get("cripto_renta_ordinaria"),
                    "ganancia_ocasional": a.get("cripto_ganancia_ocasional"),
                    "sin_costo": a.get("cripto_sin_costo"),
                    "eventos": a.get("cripto_eventos"),
                    "tenencia_usd": tenencia.get("cripto_costo_cierre_usd", a.get("cripto_costo_cierre_usd")),
                    "tenencia_cop": tenencia.get("cripto_costo_cierre_cop", a.get("cripto_costo_cierre_cop")),
                    "trm": tenencia.get("trm_cierre", a.get("trm_cierre")),
                    "detalle": (tenencia.get("detalle") or [])[:8],
                    "snapshot_usd": a.get("tenencia_cierre_usd"),
                },
                "correccion": obj.get("correccion"),
                "banco": {
                    "meses_extracto": cob.get("meses_con", 0),
                    "meses_faltan": cob.get("faltan", []),
                    "tarjeta": tarjetas.get(ano),
                },
                "hitos": hitos,
                "documentos": docs_ano,
                "hallazgos": [
                    {"id": h["id"], "titulo": h["titulo"], "severidad": h["severidad"], "estado": h["estado"], "detalle": h["detalle"]}
                    for h in hallazgos
                    if h.get("ano") == ano and h["estado"] in ("pendiente", "en_curso")
                ],
            }
        )
    sin_ano = [
        {
            "id": d["id"],
            "categoria": d["categoria"],
            "categoria_label": labels.get(d["categoria"], d["categoria"]),
            "archivo_nombre": d["archivo_nombre"],
            "existe": d.get("existe"),
            "legible": d.get("legible"),
        }
        for d in docs
        if not d.get("ano")
    ]
    return {
        "titular": {
            "nombre": perfil["tercero"]["nombre"],
            "cedula": perfil.get("cedula") or perfil["tercero"].get("identificacion") or "",
            "binance_uid": perfil.get("binance_uid") or "",
        },
        "anios": bloques,
        "sin_ano": sin_ano,
        "totales": objetivo.get("totales"),
        "parametros": objetivo.get("parametros"),
        "generado": datetime.now().isoformat(timespec="seconds"),
    }


def importar_carpeta(tercero_id: int, carpeta: str | None = None) -> dict[str, Any]:
    """Trae al expediente lo que ya existe en la carpeta del Declarador.

    - Cada archivo se registra como documento (referencia, sin copiar), con
      categoría y año inferidos del nombre. Repetible sin duplicar.
    - `declarado_f210.json` (si existe) siembra los años gravables declarados,
      el perfil (cédula, UID Binance) y los pendientes conocidos como hallazgos.
    - `Calculos/eventos_realizados_fifo.csv` (si existe) actualiza el efecto
      cripto por año, y `Calculos/*.csv` + `Para_Contador/**` se registran como
      cálculo/informe.
    """
    _ensure()
    perfil = obtener_perfil(tercero_id)
    carpeta = (carpeta or perfil.get("carpeta") or "").strip()
    if not carpeta:
        # Convención del Declarador: subcarpeta con el primer nombre del socio.
        primer = (perfil["tercero"]["nombre"] or "").split()[0] if perfil["tercero"]["nombre"] else ""
        cand = os.path.join(DECLARADOR_DIR, primer) if primer else ""
        carpeta = cand if cand and os.path.isdir(cand) else ""
    if not carpeta or not os.path.isdir(carpeta):
        raise ValueError(
            f"Carpeta no encontrada: {carpeta or '(sin definir)'} — indícala en el perfil fiscal"
        )
    carpeta = os.path.abspath(carpeta)
    guardar_perfil(tercero_id, {"carpeta": carpeta})

    docs_nuevos = 0
    docs_total = 0
    imagenes = 0
    for raiz, dirs, archivos in os.walk(carpeta, followlinks=True):
        dirs[:] = [d for d in dirs if d not in _SALTAR_DIRS]
        for a in archivos:
            ext = os.path.splitext(a)[1].lower()
            if ext in _SALTAR_EXT or a == "declarado_f210.json":
                continue
            if ext in _EXT_IMAGEN:
                # Capturas (F210 del portal DIAN, historial de Littio) sí son
                # parte del expediente: se abren desde el panel aunque el agente
                # no pueda leerlas como texto.
                imagenes += 1
            r = registrar_documento_existente(tercero_id, os.path.join(raiz, a))
            if r:
                docs_total += 1
                if r.get("nuevo"):
                    docs_nuevos += 1

    calc = _carpeta_calculos(carpeta)
    if calc:
        for a in sorted(os.listdir(calc)):
            p = os.path.join(calc, a)
            if os.path.isfile(p) and os.path.splitext(a)[1].lower() in {".csv", ".md", ".pdf", ".html"}:
                r = registrar_documento_existente(tercero_id, p, categoria="calculo")
                if r:
                    docs_total += 1
                    docs_nuevos += 1 if r.get("nuevo") else 0
        # Informes del Declarador (md/pdf en Calculos/) son "informe", no "calculo".
        for a in ("Informe_Contador_Criptoactivos.md", "Informe_Contador_Criptoactivos.pdf"):
            p = os.path.join(calc, a)
            if os.path.isfile(p):
                with _conn() as con:
                    con.execute(
                        "UPDATE dl_documentos SET categoria='informe' WHERE tercero_id=? AND archivo_path=?",
                        (int(tercero_id), p),
                    )
    pc = os.path.join(carpeta, "Para_Contador", "01_Informe_Principal")
    if os.path.isdir(pc):
        for a in sorted(os.listdir(pc)):
            r = registrar_documento_existente(tercero_id, os.path.join(pc, a), categoria="informe")
            if r:
                docs_total += 1
                docs_nuevos += 1 if r.get("nuevo") else 0
    # Informes dentro de la carpeta del socio (balance_cripto_dian.md, LEEME.md…) → "informe".
    with _conn() as con:
        con.execute(
            """UPDATE dl_documentos SET categoria='informe'
               WHERE tercero_id=? AND origen='carpeta' AND categoria='soporte'
                 AND (archivo_path LIKE '%/Para_Contador/%' OR archivo_nombre LIKE '%.md')""",
            (int(tercero_id),),
        )

    anios_sembrados = 0
    hallazgos_sembrados = 0
    seed_path = os.path.join(carpeta, "declarado_f210.json")
    if os.path.isfile(seed_path):
        with open(seed_path, encoding="utf-8") as fh:
            seed = json.load(fh)
        tit = seed.get("titular") or {}
        guardar_perfil(
            tercero_id,
            {k: tit.get(k) for k in ("cedula", "binance_uid", "binance_desde") if tit.get(k)},
        )
        for a in seed.get("anios") or []:
            try:
                ano = int(a["ano"])
            except (KeyError, TypeError, ValueError):
                continue
            campos = {k: a.get(k) for k in (*_CAMPOS_ANIO_NUM, "formulario", "presentada_en") if k in a}
            if a.get("estado") in ESTADOS_ANIO:
                campos["estado"] = a["estado"]
            actualizar_anio(tercero_id, ano, campos)
            anios_sembrados += 1
        for h in seed.get("pendientes") or []:
            if not h.get("titulo"):
                continue
            crear_hallazgo(tercero_id, h, origen="carpeta")
            hallazgos_sembrados += 1

    cripto_anios = 0
    fifo = os.path.join(calc, "eventos_realizados_fifo.csv") if calc else ""
    res = resumen_cripto_fifo(fifo)
    for ano, campos in res.items():
        actual = {a["ano"]: a for a in listar_anios(tercero_id)}.get(ano) or {}
        estado = actual.get("estado") or "sin_datos"
        if estado == "sin_datos":
            campos["estado"] = "borrador" if ano >= datetime.now().year - 1 else "sin_datos"
        actualizar_anio(tercero_id, ano, campos)
        cripto_anios += 1

    tenencias = 0
    if calc:
        ten = tenencia_fifo_por_anio(os.path.join(calc, "ledger_final.csv"), os.path.join(calc, "trm_diaria.csv"))
        mensual = ten.pop("_mensual", [])
        for ano, campos in ten.items():
            actualizar_anio(tercero_id, ano, {k: campos[k] for k in ("cripto_costo_cierre_usd", "cripto_costo_cierre_cop", "trm_cierre")})
            tenencias += 1
        if ten:
            with _conn() as con:
                con.execute(
                    "UPDATE dl_expedientes SET tenencia_json=? WHERE tercero_id=?",
                    (json.dumps({"anios": {str(k): v for k, v in ten.items()}, "mensual": mensual}, ensure_ascii=False), int(tercero_id)),
                )

    _sembrar_hallazgos_automaticos(tercero_id)
    return {
        "carpeta": carpeta,
        "tenencias_cierre": tenencias,
        "documentos": docs_total,
        "documentos_nuevos": docs_nuevos,
        "imagenes": imagenes,
        "anios_sembrados": anios_sembrados,
        "hallazgos_sembrados": hallazgos_sembrados,
        "anios_con_cripto": cripto_anios,
        "calculos": calc,
    }


def _sembrar_hallazgos_automaticos(tercero_id: int) -> None:
    """Hallazgos que se deducen de los datos (no de una lista escrita a mano):
    años presentados sin cripto aunque el motor muestre efecto, borrador sin
    presentar, y años con historial sin F210 registrado."""
    for a in listar_anios(tercero_id):
        ano = a["ano"]
        if a.get("requiere_revision"):
            crear_hallazgo(
                tercero_id,
                {
                    "clave": f"auto_omision_{ano}",
                    "ano": ano,
                    "severidad": "alta" if (a.get("cripto_total") or 0) > 5_000_000 else "media",
                    "titulo": f"F210-{ano} presentada sin criptoactivos",
                    "detalle": (
                        f"El motor FIFO arroja {a.get('cripto_total'):,.0f} COP de efecto en {ano} "
                        f"(renta ordinaria {a.get('cripto_renta_ordinaria') or 0:,.0f}; ganancia ocasional "
                        f"{a.get('cripto_ganancia_ocasional') or 0:,.0f}) y la declaración presentada no lo incluye."
                        + (
                            f" Activo omitido a 31-dic-{ano} (costo fiscal de lo que quedaba en Binance): "
                            f"{a.get('cripto_costo_cierre_cop'):,.0f} COP."
                            if a.get("cripto_costo_cierre_cop") is not None
                            else ""
                        )
                        + " Decidir con el contador si se corrige (Art. 588/644 ET) o se maneja por comparación patrimonial."
                    ),
                },
                origen="auto",
            )
        if a.get("estado") == "borrador" and ventana_f210(ano)["estado"] == "vencida":
            crear_hallazgo(
                tercero_id,
                {
                    "clave": f"auto_borrador_{ano}",
                    "ano": ano,
                    "severidad": "media",
                    "titulo": f"Declaración {ano} en borrador",
                    "detalle": "Aún no se presenta. Debe incluir la tenencia de criptoactivos a 31-dic al costo fiscal y el efecto realizado del año.",
                },
                origen="auto",
            )


# ── Cruces socio ↔ empresa ──────────────────────────────────────────────────


def cruces_socio_empresa(
    tercero_id: int,
    *,
    desde: str | None = None,
    hasta: str | None = None,
    ventana_dias: int = 3,
    tolerancia: float = 1.0,
) -> dict[str, Any]:
    """Cruza el banco personal del socio contra el banco y el libro de McKenna.

    Tres cosas se responden aquí, y son las que motivan que el socio cargue su
    extracto dentro de la contabilidad de la empresa:

    1. `empresa_a_socio`: débitos del banco de McKenna que calzan (monto ±tol,
       fecha ±ventana) con créditos del banco del socio → giros reales de la
       empresa al socio (reintegros, cuota de manejo, préstamos). Cada par dice
       si el lado empresa ya está vinculado a un asiento (`contabilizado`).
    2. `socio_a_empresa`: al revés — plata del socio que entró a McKenna
       (aportes, préstamos del socio a la empresa).
    3. `mencionan_mckenna_sin_par`: líneas del socio que nombran a McKenna y no
       tienen contraparte en el extracto de la empresa en ese rango — o falta el
       extracto de la empresa de ese mes, o el pago salió por otra cuenta.
    """
    from app.services.extracto_bancario import lineas_por_titular

    hoy = datetime.now().date()
    if not hasta:
        hasta = hoy.isoformat()
    if not desde:
        desde = (hoy - timedelta(days=365)).isoformat()
    socio = lineas_por_titular(int(tercero_id), desde=desde, hasta=hasta)
    empresa = lineas_por_titular(None, desde=desde, hasta=hasta)
    if not socio:
        return {
            "desde": desde,
            "hasta": hasta,
            "sin_extracto_socio": True,
            "empresa_a_socio": [],
            "socio_a_empresa": [],
            "mencionan_mckenna_sin_par": [],
            "resumen": {"pares": 0, "contabilizados": 0, "sin_asiento": 0, "sin_par": 0},
        }

    # Vínculos del lado empresa (línea de banco → asiento) para marcar "contabilizado".
    vinculados_empresa: set[int] = set()
    try:
        from app.services.contabilidad_db import _conn as _c

        with _c() as con:
            ids = [e["id"] for e in empresa]
            for i in range(0, len(ids), 500):
                lote = ids[i : i + 500]
                ph = ",".join("?" * len(lote))
                for r in con.execute(
                    f"SELECT extracto_mov_id FROM extracto_vinculos WHERE extracto_mov_id IN ({ph})", lote
                ):
                    vinculados_empresa.add(int(r[0]))
    except Exception:
        pass

    def _d(s: str) -> datetime:
        return datetime.strptime(s[:10], "%Y-%m-%d")

    def emparejar(lado_a: list[dict], lado_b: list[dict]) -> list[dict[str, Any]]:
        usados: set[int] = set()
        pares = []
        idx: dict[int, list[dict]] = defaultdict(list)
        for b in lado_b:
            idx[int(round(abs(b["monto"])))].append(b)
        for a in lado_a:
            m = int(round(abs(a["monto"])))
            cands = []
            for delta in range(-int(tolerancia), int(tolerancia) + 1):
                cands.extend(idx.get(m + delta, []))
            fa = _d(a["fecha"])
            mejor = None
            mejor_dist = None
            for b in cands:
                if b["id"] in usados:
                    continue
                dist = abs((_d(b["fecha"]) - fa).days)
                if dist <= ventana_dias and (mejor is None or dist < mejor_dist):
                    mejor, mejor_dist = b, dist
            if mejor is not None:
                usados.add(mejor["id"])
                pares.append({"a": a, "b": mejor, "dias": mejor_dist})
        return pares

    emp_deb = [e for e in empresa if e["tipo"] == "debito"]
    emp_cre = [e for e in empresa if e["tipo"] == "credito"]
    soc_deb = [s for s in socio if s["tipo"] == "debito"]
    soc_cre = [s for s in socio if s["tipo"] == "credito"]

    e2s = [
        {
            "empresa": p["a"],
            "socio": p["b"],
            "dias": p["dias"],
            "monto": abs(p["a"]["monto"]),
            "contabilizado": p["a"]["id"] in vinculados_empresa,
        }
        for p in emparejar(emp_deb, soc_cre)
    ]
    s2e = [
        {
            "empresa": p["b"],
            "socio": p["a"],
            "dias": p["dias"],
            "monto": abs(p["a"]["monto"]),
            "contabilizado": p["b"]["id"] in vinculados_empresa,
        }
        for p in emparejar(soc_deb, emp_cre)
    ]
    ids_par = {x["socio"]["id"] for x in e2s} | {x["socio"]["id"] for x in s2e}
    sin_par = [
        s
        for s in socio
        if s["id"] not in ids_par and re.search(r"mckenna|mc kenna|mckg", s["descripcion"] or "", re.I)
    ]
    contab = sum(1 for x in e2s + s2e if x["contabilizado"])
    return {
        "desde": desde,
        "hasta": hasta,
        "sin_extracto_socio": False,
        "empresa_a_socio": e2s,
        "socio_a_empresa": s2e,
        "mencionan_mckenna_sin_par": sin_par[:200],
        "resumen": {
            "pares": len(e2s) + len(s2e),
            "contabilizados": contab,
            "sin_asiento": len(e2s) + len(s2e) - contab,
            "sin_par": len(sin_par),
            "lineas_socio": len(socio),
            "lineas_empresa": len(empresa),
        },
    }


# ── Cuestionario inicial y plan de carga ────────────────────────────────────

# Preguntas del paso «Empecemos». Solo se pregunta lo que cambia qué se pide
# después; todo lo demás (teléfono, cuenta bancaria, UID de Binance) NO hace
# falta para armar el expediente y por eso no se pide.
CUESTIONARIO: list[dict[str, Any]] = [
    {
        "id": "cripto",
        "pregunta": "¿Tienes o has tenido criptoactivos (Binance u otra plataforma)?",
        "ayuda": "Si la respuesta es sí, el expediente pide el historial de Binance y el snapshot de tenencia a 31 de diciembre.",
        "tipo": "sino",
    },
    {
        "id": "declaro_antes",
        "pregunta": "¿Has presentado declaración de renta (Formulario 210) en años anteriores?",
        "ayuda": "Si sí, se piden los PDF firmados de cada año para comparar lo declarado con la realidad.",
        "tipo": "sino",
    },
    {
        "id": "desde",
        "pregunta": "¿Desde qué año gravable quieres organizar la información?",
        "ayuda": "Armando organizó desde 2020 (cuando abrió Binance). La DIAN puede revisar hasta 3 años atrás en general, y más si hay omisión de activos.",
        "tipo": "anio",
    },
    {
        "id": "otras_plataformas",
        "pregunta": "¿Usaste billeteras o plataformas distintas al banco (Nequi, Littio, MoonPay, Wompi, Rappi)?",
        "ayuda": "Sus historiales explican de dónde salió o a dónde llegó la plata cuando el banco no lo muestra.",
        "tipo": "sino",
    },
    {
        "id": "prestamos_familia",
        "pregunta": "¿Recibiste o diste préstamos a familiares o a McKenna?",
        "ayuda": "Un préstamo no es ingreso, pero hay que poder probarlo (contrato, transferencia, mensaje).",
        "tipo": "sino",
    },
]
CUESTIONARIO_CLAVES = {q["id"] for q in CUESTIONARIO}

# Qué documentos necesita el expediente, por qué y dónde se consiguen. `aplica`
# es la clave del cuestionario que lo activa (None = siempre). `por_anio`
# significa que se espera uno por cada año gravable desde `desde`.
REQUISITOS: list[dict[str, Any]] = [
    {
        "id": "f210",
        "rol": "base",
        "impacto": "Sin él no se sabe qué se declaró; la corrección se arma sobre ese F210.",
        "categoria": "declaracion_f210",
        "titulo": "Declaración de renta ya presentada (Formulario 210), si la hubo",
        "por_que": "No es la meta, es el punto de partida: lo que la DIAN ya tiene de ese año SIN los criptoactivos. Sobre ese F210 se arma la corrección que los incluye. Si ese año no presentaste declaración, márcalo así en la casilla y el año pasa a «presentar» en vez de «corregir».",
        "como": "DIAN → Muisca → «Consultar documentos» → Renta personas naturales → descargar el PDF firmado de cada año presentado.",
        "aplica": "declaro_antes",
        "por_anio": True,
    },
    {
        "id": "exogena",
        "rol": "soporte",
        "impacto": "No cambia el cálculo cripto: sirve para anticipar qué le va a cruzar la DIAN.",
        "categoria": "exogena",
        "titulo": "Información exógena (lo que terceros reportaron de ti)",
        "por_que": "Bancos, McKenna, exchanges y comisionistas le cuentan a la DIAN tus movimientos; aquí se ve qué le van a cruzar.",
        "como": "DIAN → Muisca → «Consultar información exógena» → año gravable → descargar Excel.",
        "aplica": None,
        "por_anio": True,
    },
    {
        "id": "extracto_banco",
        "rol": "soporte",
        "impacto": "Justifica el origen de los fondos de cada compra; no cambia el cálculo.",
        "categoria": "extracto_banco",
        "titulo": "Extractos de cuentas de ahorro / corriente",
        "por_que": "Justifican de dónde salió la plata de cada compra y a dónde llegó cada venta. Se cargan en el paso «Extractos personales», mes a mes.",
        "como": "Bancolombia sucursal virtual → Extractos → descargar CSV o PDF por mes. Si faltan años, pedir en oficina el historial completo en PDF (con la cédula como clave).",
        "aplica": None,
        "por_anio": True,
        "es_extracto": True,
    },
    {
        "id": "extracto_tarjeta",
        "rol": "soporte",
        "impacto": "Justifica origen de fondos (avances) y la deuda a 31-dic; no cambia el cálculo cripto.",
        "categoria": "extracto_tarjeta",
        "titulo": "Movimientos de tarjetas de crédito",
        "por_que": "Compras en Amazon o cripto con tarjeta y avances en efectivo: deuda que va en el patrimonio y origen de fondos.",
        "como": "Sucursal virtual → Tarjetas → Estado de cuenta → descargar Excel de cada mes. El banco solo conserva los últimos 12-24 meses: para años anteriores el sustituto oficial es el «Reporte anual de costos totales» (Certificados tributarios), que ya trae por año los consumos en COP y USD, los pagos, los intereses y cuántos avances en efectivo hubo.",
        "aplica": None,
        "por_anio": True,
        "alternativas": ["certificado_banco"],
        "alternativa_nota": "cubierto por el certificado anual de Bancolombia (cifras del año, sin el detalle comercio por comercio)",
    },
    {
        "id": "certificado_banco",
        "rol": "soporte",
        "impacto": "Da deudas, retenciones y GMF a 31-dic para el resto del F210; no toca el cálculo cripto.",
        "categoria": "certificado_banco",
        "titulo": "Certificados bancarios anuales (retención y GMF, créditos, costos)",
        "por_que": "Dan las cifras a 31 de diciembre que van en el F210: saldo de los créditos (deudas), retenciones que te practicó el banco y el 4x1000 (50 % deducible). También sustentan los préstamos de consumo ante la DIAN.",
        "como": "Bancolombia sucursal virtual → Documentos → Certificados tributarios → año → descargar (salen como Documento_<año>12_….zip con el certificado de retención/GMF, el de operaciones de crédito y el reporte anual de costos).",
        "aplica": None,
        "por_anio": True,
    },
    {
        "id": "binance_csv",
        "rol": "calculo",
        "impacto": "BLOQUEA: sin el historial de ese año no se puede calcular el efecto cripto ni la tenencia.",
        "categoria": "binance_csv",
        "titulo": "Historial de transacciones de Binance (CSV)",
        "por_que": "Con él se reconstruye el costo fiscal de cada moneda (FIFO) y la ganancia o pérdida realizada por año.",
        "como": "Binance → Wallet → Historial de transacciones → «Exportar registros» → «Generar todas las declaraciones» → un archivo por cada 12 meses. Llega por correo como ZIP.",
        "aplica": "cripto",
        "por_anio": True,
    },
    {
        "id": "binance_snapshot",
        "rol": "soporte",
        "impacto": "Valida la tenencia calculada; si Binance no da snapshots pasados, vale la tenencia del motor.",
        "categoria": "binance_snapshot",
        "titulo": "Snapshot de tenencia al 31 de diciembre",
        "por_que": "Es el patrimonio bruto en criptoactivos que va en el F210 de cada año.",
        "como": "Binance → Wallet → «Account Statement» → fecha 31-dic (o 1-ene siguiente) → PDF. Pedirlo para cada año que se declare.",
        "aplica": "cripto",
        "por_anio": True,
    },
    {
        "id": "binance_api",
        "rol": "soporte",
        "impacto": "Evidencia oficial para la DIAN; no cambia el cálculo.",
        "categoria": "binance_api",
        "titulo": "Evidencia oficial por API de Binance (opcional)",
        "por_que": "Órdenes P2P con el monto exacto en COP, depósitos y retiros: la prueba más fuerte ante la DIAN.",
        "como": "Crear una API key de SOLO lectura en Binance y correr `export_binance_tax_data.py` (ya existe en la carpeta del Declarador). Revocar la llave al terminar.",
        "aplica": "cripto",
        "por_anio": False,
    },
    {
        "id": "otra_plataforma",
        "rol": "soporte",
        "impacto": "Cierra huecos de trazabilidad; no cambia el cálculo.",
        "categoria": "otra_plataforma",
        "titulo": "Historial de otras plataformas (Nequi, Littio, MoonPay…)",
        "por_que": "Cierra los huecos: plata que salió de Binance a Littio, o compras de cripto fuera de Binance.",
        "como": "Capturas de pantalla del historial completo (como hizo Armando con Littio: 71 capturas) o el export de la app si lo permite.",
        "aplica": "otras_plataformas",
        "por_anio": False,
    },
    {
        "id": "soporte",
        "rol": "soporte",
        "impacto": "Prueba que un préstamo no es ingreso; no cambia el cálculo cripto.",
        "categoria": "soporte",
        "titulo": "Soportes de préstamos y otros",
        "por_que": "Un préstamo recibido no es ingreso y uno dado no es gasto, pero sin soporte la DIAN lo trata como lo que más impuesto genere.",
        "como": "Contrato o pagaré, comprobante de la transferencia y, si no hay contrato, el chat donde se acordó.",
        "aplica": "prestamos_familia",
        "por_anio": False,
    },
]

CARPETAS_SOCIO = [
    ("01_Declaraciones_Renta", "Un PDF por año: Declaracion2021.pdf, Declaracion2022.pdf…"),
    ("02_Exogena", "Excel de la DIAN por año: reporteExogena2023.xlsx…"),
    ("03_Extractos_Bancarios", "Una subcarpeta por año y por mes: 2025/01_ENERO/…"),
    ("04_Binance", "CSV del historial por año + snapshot PDF a 31-dic"),
    ("05_Otras_Plataformas", "Capturas de Nequi, Littio, MoonPay…"),
    ("06_Soportes", "Contratos de préstamo, comprobantes, chats"),
    ("07_Certificados_Bancarios", "Por año: certificado de retención/GMF, de operaciones de crédito y reporte anual de costos (Documento_<año>12_….zip de Bancolombia)"),
]


def cuestionario_inferido(tercero_id: int) -> dict[str, Any]:
    """Respuestas deducidas de lo que ya hay en el expediente — para no volver
    a preguntarle a quien ya cargó todo (Armando)."""
    docs = listar_documentos(tercero_id)
    cats = {d["categoria"] for d in docs}
    anios = [a["ano"] for a in listar_anios(tercero_id)]
    anios_docs = [d["ano"] for d in docs if d.get("ano")]
    out: dict[str, Any] = {}
    if cats & {"binance_csv", "binance_snapshot", "binance_api"}:
        out["cripto"] = True
    presentados = [a["ano"] for a in listar_anios(tercero_id) if a.get("estado") in ("presentada", "corregida", "por_corregir")]
    if "declaracion_f210" in cats or presentados:
        out["declaro_antes"] = True
    if presentados:
        out["desde"] = min(presentados)
    elif anios_docs:
        out["desde"] = min(a for a in anios_docs if a >= 2015)
    if "otra_plataforma" in cats:
        out["otras_plataformas"] = True
    return out


def cuestionario_efectivo(tercero_id: int, perfil: dict | None = None) -> dict[str, Any]:
    perfil = perfil or obtener_perfil(tercero_id)
    inferido = cuestionario_inferido(tercero_id)
    respondido = dict(perfil.get("cuestionario") or {})
    omitidos = respondido.pop("omitidos", None)
    ef = {**inferido, **{k: v for k, v in respondido.items() if v is not None}}
    ef["_inferido"] = [k for k in inferido if k not in respondido]
    ef["_respondido"] = sorted(respondido.keys())
    ef["omitidos"] = list(omitidos or [])
    faltan = [q["id"] for q in CUESTIONARIO if q["id"] not in ef]
    ef["_completo"] = not faltan
    ef["_faltan"] = faltan
    return ef


def carpeta_socio_default(tercero: dict) -> str:
    primer = (tercero.get("nombre") or "").split()[0] if tercero.get("nombre") else ""
    return os.path.join(DECLARADOR_DIR, primer) if primer else ""


def crear_carpeta_socio(tercero_id: int) -> dict[str, Any]:
    """Crea la carpeta del socio en el Declarador con la misma estructura que
    usó Armando, un LEEME con qué va dónde, y la plantilla `declarado_f210.json`.
    Idempotente: no pisa nada que ya exista."""
    _ensure()
    perfil = obtener_perfil(tercero_id)
    carpeta = perfil.get("carpeta") or carpeta_socio_default(perfil["tercero"])
    if not carpeta:
        raise ValueError("El tercero no tiene nombre; no se puede derivar la carpeta")
    os.makedirs(carpeta, exist_ok=True)
    creadas = []
    for sub, _desc in CARPETAS_SOCIO:
        p = os.path.join(carpeta, sub)
        if not os.path.isdir(p):
            os.makedirs(p, exist_ok=True)
            creadas.append(sub)
    nombre = perfil["tercero"]["nombre"]
    cedula = perfil.get("cedula") or ""
    leeme = os.path.join(carpeta, "LEEME.md")
    if not os.path.exists(leeme):
        lineas = [
            f"# Carpeta del Declarador — {nombre}" + (f" (CC {cedula})" if cedula else ""),
            "",
            "Misma estructura que usó Armando. Todo lo que dejes aquí se registra en el panel",
            "(/app → Contabilidad → Socios → paso «Activos digitales» → «Importar carpeta del Declarador»)",
            "sin copiar los archivos. Los nombres importan: el panel adivina la categoría y el año por el nombre.",
            "",
            "| Carpeta | Qué va | Nombre sugerido |",
            "|---|---|---|",
        ]
        for sub, desc in CARPETAS_SOCIO:
            lineas.append(f"| `{sub}/` | {desc} | ver ejemplos en `../Armando/` |")
        lineas += [
            "",
            "## Cómo conseguir cada cosa",
            "",
        ]
        for r in REQUISITOS:
            lineas += [f"### {r['titulo']}", f"- **Para qué:** {r['por_que']}", f"- **Cómo:** {r['como']}", ""]
        lineas += [
            "## `declarado_f210.json`",
            "",
            "Plantilla con un renglón por año. Llena `patrimonio_bruto`, `deudas`, `renta_liquida` e",
            "`impuesto_pagado` con lo que dice cada F210 presentado (renglones 29, 30, 96/ renta líquida gravable, 136).",
            "Si un año no se declaró, deja `estado: \"no_obligado\"` o `\"sin_datos\"`. Los `pendientes` son preguntas",
            "abiertas que quieras dejar anotadas; el panel también las genera solo.",
        ]
        with open(leeme, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lineas) + "\n")
        creadas.append("LEEME.md")
    seed = os.path.join(carpeta, "declarado_f210.json")
    if not os.path.exists(seed):
        cq = cuestionario_efectivo(tercero_id, perfil)
        desde = int(cq.get("desde") or 2020)
        hasta = datetime.now().year - 1
        plantilla = {
            "_nota": "Plantilla generada por el panel. Llenar con lo que dice cada F210 presentado; null = sin dato.",
            "titular": {"cedula": cedula, "binance_uid": perfil.get("binance_uid") or "", "binance_desde": ""},
            "anios": [
                {
                    "ano": a,
                    "formulario": "",
                    "presentada_en": "",
                    "patrimonio_bruto": None,
                    "deudas": None,
                    "patrimonio_liquido": None,
                    "renta_liquida": None,
                    "impuesto_pagado": None,
                    "ganancia_ocasional": None,
                    "estado": "sin_datos" if a < hasta else "borrador",
                }
                for a in range(desde, hasta + 1)
            ],
            "pendientes": [],
        }
        with open(seed, "w", encoding="utf-8") as fh:
            json.dump(plantilla, fh, ensure_ascii=False, indent=2)
        creadas.append("declarado_f210.json")
    guardar_perfil(tercero_id, {"carpeta": carpeta})
    return {"carpeta": carpeta, "creadas": creadas, "existia": not creadas}


def socio_referencia(tercero_id: int) -> dict[str, Any] | None:
    """El otro socio con el expediente más completo, como referencia de «así lo
    hizo X». Solo expone conteos por categoría y año — nunca cifras ni
    documentos — porque quien mira puede ser el otro socio."""
    from app.services.contabilidad_core import listar_terceros

    mejor = None
    for t in listar_terceros(tipo="socio"):
        if int(t["id"]) == int(tercero_id):
            continue
        docs = listar_documentos(int(t["id"]))
        if not docs:
            continue
        if mejor is None or len(docs) > mejor["documentos"]:
            por = defaultdict(lambda: defaultdict(int))
            for d in docs:
                por[d["categoria"]][str(d.get("ano") or "")] += 1
            anios = [a["ano"] for a in listar_anios(int(t["id"]))]
            cob = None
            try:
                from app.services.extracto_bancario import cobertura_mensual

                cob = {k: v["meses_con"] for k, v in cobertura_mensual(int(t["id"]))["anios"].items()}
            except Exception:
                pass
            mejor = {
                "id": t["id"],
                "nombre": t["nombre"].split()[0],
                "documentos": len(docs),
                "por_categoria": {c: dict(v) for c, v in por.items()},
                "anios": anios,
                "desde": min(anios) if anios else None,
                "extractos_meses": cob,
            }
    return mejor


def plan_carga(tercero_id: int, perfil: dict | None = None, docs: list[dict] | None = None, cobertura: dict | None = None) -> dict[str, Any]:
    """Qué documentos pide el expediente según el cuestionario, cuántos hay,
    cuántos tiene el socio de referencia y cómo conseguir cada uno."""
    perfil = perfil or obtener_perfil(tercero_id)
    docs = docs if docs is not None else listar_documentos(tercero_id)
    cq = cuestionario_efectivo(tercero_id, perfil)
    ref = socio_referencia(tercero_id)
    desde = int(cq.get("desde") or (ref or {}).get("desde") or 2020)
    hoy = datetime.now()
    hasta = hoy.year - 1
    anios = list(range(desde, hasta + 1))
    # El F210 del año gravable anterior se presenta entre agosto y octubre del
    # año siguiente: hasta noviembre no se le exige a nadie tenerlo.
    hasta_f210 = hasta if hoy.month >= 11 else hasta - 1
    omitidos = {str(x) for x in (cq.get("omitidos") or [])}
    if cobertura is None:
        try:
            from app.services.extracto_bancario import cobertura_mensual

            cobertura = cobertura_mensual(int(tercero_id))
        except Exception:
            cobertura = {"anios": {}}
    mios = defaultdict(lambda: defaultdict(int))
    zips = defaultdict(lambda: defaultdict(int))
    for d in docs:
        a0 = d.get("ano")
        a1 = d.get("ano_hasta") or a0
        claves = [str(a) for a in range(int(a0), int(a1) + 1)] if a0 else [""]
        destino = zips if str(d.get("archivo_nombre") or "").lower().endswith(".zip") else mios
        for k in claves:
            destino[d["categoria"]][k] += 1
    # Un zip solo cuenta cuando no hay nada descomprimido de esa categoría y año
    # (si ya se extrajo, contarlo duplica: «2 archivos» por un solo certificado).
    for cat, por in zips.items():
        for k, n in por.items():
            if not mios[cat].get(k):
                mios[cat][k] += n
    estado_anio = {int(a["ano"]): a.get("estado") for a in listar_anios(tercero_id)}
    out = []
    for r in REQUISITOS:
        aplica = r["aplica"] is None or bool(cq.get(r["aplica"]))
        omitido = r["id"] in omitidos
        cat = r["categoria"]
        total_mio = sum(mios[cat].values())
        total_ref = sum((ref or {}).get("por_categoria", {}).get(cat, {}).values()) if ref else 0
        por_anio = []
        if r["por_anio"]:
            for a in (a for a in anios if not (r["id"] == "f210" and a > hasta_f210)):
                if r.get("es_extracto"):
                    m = int((cobertura.get("anios") or {}).get(str(a), {}).get("meses_con") or 0)
                    mref = int(((ref or {}).get("extractos_meses") or {}).get(str(a)) or 0) if ref else 0
                    por_anio.append({"ano": a, "mios": m, "ref": mref, "unidad": "meses", "ok": m >= 12})
                elif f"{r['id']}:{a}" in omitidos:
                    # «No aplica ese año» (p. ej. la DIAN no tiene exógena de 2020):
                    # no cuenta como faltante, se pinta en gris y se puede deshacer.
                    por_anio.append({"ano": a, "mios": mios[cat].get(str(a), 0), "ref": 0, "unidad": "archivos", "ok": True, "nota": "no_aplica"})
                elif r["id"] == "f210" and estado_anio.get(a) in ("no_presentada", "no_obligado"):
                    # Ese año no hubo declaración: no hay F210 que cargar. No es
                    # un faltante, es un año que se PRESENTA (ver objetivo_declaraciones).
                    por_anio.append({"ano": a, "mios": 0, "ref": 0, "unidad": "archivos", "ok": True, "nota": "no_presentada"})
                else:
                    n = mios[cat].get(str(a), 0)
                    nref = (ref or {}).get("por_categoria", {}).get(cat, {}).get(str(a), 0) if ref else 0
                    celda = {"ano": a, "mios": n, "ref": nref, "unidad": "archivos", "ok": n > 0}
                    if not n:
                        # Sin el documento propio, ¿lo cubre una fuente equivalente?
                        alt = next((c for c in (r.get("alternativas") or []) if mios[c].get(str(a))), None)
                        if alt:
                            celda.update({"ok": True, "nota": "alternativa", "alternativa_en": alt})
                    por_anio.append(celda)
        if not aplica:
            estado = "no_aplica"
        elif omitido:
            estado = "omitido"
        elif r["por_anio"]:
            oks = sum(1 for x in por_anio if x["ok"])
            estado = "hecho" if oks == len(por_anio) and por_anio else ("parcial" if oks else "pendiente")
        else:
            estado = "hecho" if total_mio else "pendiente"
        out.append(
            {
                **{k: r[k] for k in ("id", "categoria", "titulo", "por_que", "como", "por_anio")},
                "rol": r.get("rol", "soporte"),
                "impacto": r.get("impacto", ""),
                "es_extracto": bool(r.get("es_extracto")),
                "alternativa_nota": r.get("alternativa_nota", ""),
                "aplica": aplica,
                "omitido": omitido,
                "estado": estado,
                "mios": total_mio,
                "ref": total_ref,
                "anios": por_anio,
            }
        )
    aplicables = [x for x in out if x["aplica"] and not x["omitido"]]
    hechos = sum(1 for x in aplicables if x["estado"] == "hecho")
    return {
        "cuestionario": cq,
        "preguntas": CUESTIONARIO,
        "anios": anios,
        "hasta_f210": hasta_f210,
        "requisitos": out,
        "referencia": ref,
        "progreso": {"hechos": hechos, "total": len(aplicables)},
        "carpeta": perfil.get("carpeta") or carpeta_socio_default(perfil["tercero"]),
        "carpeta_existe": bool(perfil.get("carpeta") and os.path.isdir(perfil["carpeta"])),
    }


# ── Meta del expediente: qué declaración se presenta o corrige por año ──────

VIAS_ACTIVOS_OMITIDOS = [
    {
        "id": "correccion",
        "titulo": "Corrección voluntaria de la declaración presentada",
        "detalle": "Art. 588 ET: se presenta de nuevo el F210 del año incluyendo los criptoactivos (patrimonio a 31-dic al costo fiscal y el efecto realizado). Lleva sanción por corrección (Art. 644 ET) e intereses si aumenta el impuesto. Aplica mientras el año siga siendo revisable.",
    },
    {
        "id": "activos_omitidos",
        "titulo": "Renta líquida por activos omitidos (Art. 239-1 ET)",
        "detalle": "Si el año ya no es revisable, los activos omitidos se incluyen como renta líquida gravable en la declaración del año en curso o en una corrección. Si la DIAN los detecta primero, la sanción por inexactitud sube al 200 % (Art. 648 ET).",
    },
    {
        "id": "extemporanea",
        "titulo": "Declaración extemporánea",
        "detalle": "Para el año que nunca se declaró estando obligado: se presenta ahora incluyendo los activos, con sanción por extemporaneidad (Art. 641 ET) e intereses.",
    },
    {
        "id": "normalizacion",
        "titulo": "Impuesto de normalización tributaria",
        "detalle": "Solo existe cuando una ley lo habilita (la última fue la Ley 2155 de 2021, para 2022). Hoy no está vigente; si vuelve a abrirse, suele ser la vía más barata para activos omitidos.",
    },
]


def ventana_f210(ano_gravable: int, presentadas: list[str] | None = None, hoy: date | None = None) -> dict[str, Any]:
    """En qué momento está la declaración del año gravable: «futuro» (aún no
    abre), «en_ventana» (agosto–octubre del año siguiente: se está preparando,
    NO falta), «vencida». No se inventa el día exacto: el calendario de personas
    naturales cambia cada año por decreto; se muestra el turno de años anteriores
    (fechas de presentación reales) como referencia."""
    hoy = hoy or date.today()
    apertura = date(ano_gravable + 1, 8, 1)
    cierre = date(ano_gravable + 1, 10, 31)
    if hoy < apertura:
        estado = "futuro"
    elif hoy <= cierre:
        estado = "en_ventana"
    else:
        estado = "vencida"
    turnos = sorted({p[5:] for p in (presentadas or []) if p and len(p) >= 10 and p[5:7] in ("08", "09", "10")})
    return {
        "estado": estado,
        "ventana": f"agosto–octubre de {ano_gravable + 1}",
        "turno_habitual": turnos[-1] if turnos else None,  # "MM-DD" de la última presentación en ventana
        "nota": "Confirmar el día exacto en el calendario tributario de la DIAN para ese año (depende de los dos últimos dígitos de la cédula).",
    }


def intereses_mora(capital: float, desde: date, hasta: date, tasa_anual: float) -> dict[str, Any]:
    """Intereses de mora del Art. 635 ET, liquidados con la tasa efectiva anual
    equivalente día a día (como el liquidador de la DIAN), desde el vencimiento
    hasta `hasta`. La tasa (usura de consumo menos 2 puntos) la fija la
    Superfinanciera cada mes: aquí es un parámetro editable, no un dato."""
    dias = max(0, (hasta - desde).days)
    if capital <= 0 or dias == 0 or tasa_anual <= 0:
        return {"dias": dias, "valor": 0}
    factor = (1.0 + float(tasa_anual)) ** (dias / 365.0) - 1.0
    return {"dias": dias, "valor": round(float(capital) * factor)}


TASA_MORA_DEFAULT = 0.23  # ilustrativa: usura de consumo (~25 %) menos 2 puntos, Art. 635 ET


def objetivo_declaraciones(anios: list[dict], docs: list[dict], plan: dict) -> dict[str, Any]:
    """Qué hay que presentar o corregir por año para regularizar los
    criptoactivos que nunca se incluyeron. Es la meta que justifica cada
    documento del plan de carga: sin esto el socio ve una lista de archivos y
    no sabe para qué son."""
    cq = plan["cuestionario"]
    if not cq.get("cripto"):
        return {"aplica": False, "anios": [], "resumen": {}, "vias": VIAS_ACTIVOS_OMITIDOS}
    por_ano = {int(a["ano"]): a for a in anios}
    hasta_f210 = int(plan.get("hasta_f210") or 0)
    hoy = date.today()
    try:
        tasa_mora = float(cq.get("tasa_mora_anual") or TASA_MORA_DEFAULT)
    except (TypeError, ValueError):
        tasa_mora = TASA_MORA_DEFAULT
    presentadas = [a.get("presentada_en") or "" for a in anios]
    # ¿qué bloquea el cálculo? solo los requisitos con rol «calculo» que falten en un año
    bloqueos: dict[int, list[str]] = defaultdict(list)
    for r in plan["requisitos"]:
        if r.get("rol") != "calculo" or not r["aplica"] or r["omitido"]:
            continue
        for x in r["anios"]:
            if not x["ok"]:
                bloqueos[int(x["ano"])].append(r["titulo"])
    f210 = {int(d["ano"]) for d in docs if d["categoria"] == "declaracion_f210" and d.get("ano")}
    snapshot = {int(d["ano"]) for d in docs if d["categoria"] == "binance_snapshot" and d.get("ano")}
    csv = {int(d["ano"]) for d in docs if d["categoria"] == "binance_csv" and d.get("ano")}
    out = []
    for ano in plan["anios"]:
        a = por_ano.get(ano) or {}
        estado = a.get("estado") or "sin_datos"
        total = a.get("cripto_total")
        tiene_f210 = ano in f210
        efecto = total is not None
        tenencia = a.get("tenencia_cierre_usd") is not None or ano in snapshot
        ventana = None
        if ano > hasta_f210:
            ventana = ventana_f210(ano, presentadas, hoy)
            if ventana["estado"] == "en_ventana":
                situacion, accion, via = (
                    "en_preparacion",
                    f"Se presenta ahora ({ventana['ventana']}), incluyendo los criptoactivos desde el inicio: no es una corrección ni un faltante.",
                    None,
                )
            else:
                situacion, accion, via = (
                    "futura",
                    f"Se presenta en {ventana['ventana']}, incluyendo los criptoactivos desde el inicio.",
                    None,
                )
        elif estado == "corregida":
            situacion, accion, via = "corregida", "Ya corregida con los criptoactivos incluidos.", None
        elif estado in ("presentada", "por_corregir") or (estado == "sin_datos" and tiene_f210):
            if efecto and abs(total or 0) < 1000:
                situacion, accion, via = "presentada_sin_efecto", "Presentada sin criptoactivos, pero el motor no arroja efecto ese año: confirmar con el contador si basta con incluir la tenencia a 31-dic.", "correccion"
            elif efecto:
                situacion, accion, via = "corregir", "Corregir el F210 presentado para incluir los criptoactivos omitidos (tenencia a 31-dic y efecto del año).", "correccion"
            else:
                situacion, accion, via = "corregir_sin_calculo", "Presentada sin criptoactivos; falta calcular el efecto del año (historial Binance) antes de armar la corrección.", "correccion"
        elif estado == "borrador":
            situacion, accion, via = "presentar", "En borrador: presentarla incluyendo la tenencia de criptoactivos a 31-dic y el efecto del año.", None
        elif estado in ("no_presentada", "no_obligado"):
            situacion, accion, via = "presentar_extemporanea", "Ese año no se presentó declaración: presentarla ahora incluyendo los criptoactivos (extemporánea si estabas obligado).", "extemporanea"
        else:
            situacion, accion, via = "por_definir", "Falta saber si ese año presentaste declaración: sube el F210 o marca «no presenté».", None
        # Recálculo del año con el efecto cripto (Art. 241) y el activo omitido a 31-dic.
        rlg = a.get("renta_liquida")
        imp_pag = a.get("impuesto_pagado")
        correccion = None
        if efecto and rlg is not None and situacion not in ("futura", "en_preparacion"):
            rlg_corr = max(0.0, float(rlg) + float(total or 0))
            imp_decl_calc = impuesto_renta_art241(float(rlg), ano)
            imp_corr = impuesto_renta_art241(rlg_corr, ano)
            mayor = (imp_corr - float(imp_pag or 0)) if imp_corr is not None else None
            # Los intereses corren desde el vencimiento original. Si se presentó en
            # su turno, la fecha de presentación ES el vencimiento; si no hay fecha,
            # se toma el 31-oct del año siguiente (cierre de la ventana).
            pres = a.get("presentada_en") or ""
            try:
                desde = date.fromisoformat(pres[:10]) if pres else date(ano + 1, 10, 31)
            except ValueError:
                desde = date(ano + 1, 10, 31)
            mora = intereses_mora(mayor or 0, desde, hoy, tasa_mora) if mayor and mayor > 0 else {"dias": 0, "valor": 0}
            sancion = round(mayor * 0.10) if mayor is not None and mayor > 0 else 0
            correccion = {
                "intereses_mora": mora["valor"],
                "intereses_dias": mora["dias"],
                "intereses_desde": desde.isoformat(),
                "total_estimado": (round(mayor) + sancion + mora["valor"]) if mayor is not None and mayor > 0 else 0,
                "rlg_declarada": rlg,
                "ajuste_cripto": total,
                "rlg_corregida": round(rlg_corr),
                "impuesto_pagado": imp_pag,
                "impuesto_declarado_recalculado": imp_decl_calc,
                "impuesto_corregido": imp_corr,
                "mayor_valor": round(mayor) if mayor is not None else None,
                "sancion_correccion_10": sancion,
                "uvt_cargada": imp_corr is not None,
            }
        out.append(
            {
                "ano": ano,
                "estado": estado,
                "situacion": situacion,
                "accion": accion,
                "via": via,
                "cripto_total": total,
                "tenencia_cierre_usd": a.get("tenencia_cierre_usd"),
                "cripto_costo_cierre_usd": a.get("cripto_costo_cierre_usd"),
                "cripto_costo_cierre_cop": a.get("cripto_costo_cierre_cop"),
                "trm_cierre": a.get("trm_cierre"),
                "patrimonio_bruto_declarado": a.get("patrimonio_bruto"),
                "correccion": correccion,
                "presentacion": ventana,
                "bloqueos": bloqueos.get(ano, []),
                "insumos": {
                    "f210": tiene_f210,
                    "f210_aplica": situacion not in ("presentar_extemporanea", "futura"),
                    "efecto_cripto": efecto,
                    "historial": ano in csv,
                    "tenencia": tenencia,
                },
            }
        )
    resumen = defaultdict(int)
    for x in out:
        resumen[x["situacion"]] += 1
    mayor_total = sum((x["correccion"] or {}).get("mayor_valor") or 0 for x in out if (x["correccion"] or {}).get("mayor_valor", 0) and x["correccion"]["mayor_valor"] > 0)
    sancion_total = sum((x["correccion"] or {}).get("sancion_correccion_10") or 0 for x in out)
    a_favor = sum(-(x["correccion"] or {}).get("mayor_valor") or 0 for x in out if (x["correccion"] or {}).get("mayor_valor") is not None and x["correccion"]["mayor_valor"] < 0)
    intereses_total = sum((x["correccion"] or {}).get("intereses_mora") or 0 for x in out)
    total_est = round(mayor_total) + round(sancion_total) + round(intereses_total)
    con_bloqueo = [x["ano"] for x in out if x["bloqueos"]]
    return {
        "aplica": True,
        "anios": out,
        "resumen": dict(resumen),
        "totales": {
            "mayor_valor": round(mayor_total),
            "sancion_correccion_10": round(sancion_total),
            "intereses_mora": round(intereses_total),
            "total_estimado": total_est,
            "a_favor_no_reclamable": round(a_favor),
        },
        "parametros": {"tasa_mora_anual": tasa_mora, "hoy": hoy.isoformat(), "tasa_default": TASA_MORA_DEFAULT},
        "calculable": not con_bloqueo,
        "anios_bloqueados": con_bloqueo,
        "vias": VIAS_ACTIVOS_OMITIDOS,
    }


# ── Expediente completo + pasos del wizard ──────────────────────────────────


def _tenencia_guardada(tercero_id: int) -> dict[str, Any]:
    _ensure()
    with _conn() as con:
        row = con.execute("SELECT tenencia_json FROM dl_expedientes WHERE tercero_id=?", (int(tercero_id),)).fetchone()
    try:
        return json.loads(row["tenencia_json"]) if row and row["tenencia_json"] else {}
    except (TypeError, ValueError):
        return {}


def obtener_expediente(tercero_id: int) -> dict[str, Any]:
    from app.services.contabilidad_core import saldo_tercero
    from app.services.extracto_bancario import cobertura_mensual, listar_extractos

    perfil = obtener_perfil(tercero_id)
    docs = listar_documentos(tercero_id)
    anios = listar_anios(tercero_id)
    hallazgos = listar_hallazgos(tercero_id)
    cobertura = cobertura_mensual(int(tercero_id))
    extractos = listar_extractos(limit=200, tercero_id=int(tercero_id))
    try:
        saldo = saldo_tercero(int(tercero_id))
    except Exception:
        saldo = {"cuentas": [], "saldo_por_pagar": 0.0}
    try:
        cruces = cruces_socio_empresa(int(tercero_id))
        cruces_res = cruces["resumen"] | {"sin_extracto_socio": cruces["sin_extracto_socio"]}
    except Exception as e:  # noqa: BLE001
        cruces_res = {"error": str(e)[:200]}

    por_cat: dict[str, int] = defaultdict(int)
    for d in docs:
        por_cat[d["categoria"]] += 1
    abiertos = [h for h in hallazgos if h["estado"] in ("pendiente", "en_curso")]

    plan = plan_carga(tercero_id, perfil, docs, cobertura)
    pasos = _estado_pasos(perfil, extractos, cobertura, saldo, cruces_res, anios, docs, abiertos, plan)
    hechos = sum(1 for p in pasos if p["estado"] == "hecho")
    return {
        "perfil": perfil,
        "plan": plan,
        "objetivo": objetivo_declaraciones(anios, docs, plan),
        "tenencia": _tenencia_guardada(tercero_id),
        "tarjeta": {str(k): v for k, v in tarjeta_por_anio(docs).items()},
        "documentos": docs,
        "documentos_por_categoria": dict(por_cat),
        "categorias": [{"id": c, "label": l} for c, l in CATEGORIAS_DOC],
        "anios": anios,
        "hallazgos": hallazgos,
        "hallazgos_abiertos": len(abiertos),
        "extractos": extractos,
        "cobertura": cobertura,
        "cuenta_mckenna": {
            "cuentas": saldo.get("cuentas") or [],
            "saldo_por_pagar": saldo.get("saldo_por_pagar") or 0.0,
        },
        "cruces": cruces_res,
        "pasos": pasos,
        "progreso": {"hechos": hechos, "total": len(pasos)},
        "carpeta_declarador_disponible": bool(perfil.get("carpeta") and os.path.isdir(perfil["carpeta"]))
        or os.path.isdir(os.path.join(DECLARADOR_DIR, (perfil["tercero"]["nombre"] or "x").split()[0])),
    }


def _estado_pasos(perfil, extractos, cobertura, saldo, cruces_res, anios, docs, abiertos, plan) -> list[dict[str, Any]]:
    """Estado calculado de cada paso: `hecho` · `parcial` · `pendiente`, con
    un texto corto que dice qué falta. Lo manual (`pasos` del perfil) solo
    puede marcar como hecho un paso que no tenga nada calculable en contra."""
    manual = perfil.get("pasos") or {}
    out = []

    def add(id_, estado, detalle, cantidad=0):
        label = dict(PASOS_WIZARD)[id_]
        if manual.get(id_, {}).get("hecho") and estado != "hecho":
            estado = "hecho"
            detalle = detalle + " · marcado como hecho manualmente"
        out.append({"id": id_, "label": label, "estado": estado, "detalle": detalle, "cantidad": cantidad})

    t = perfil["tercero"]
    cq = plan["cuestionario"]
    faltan = []
    if not (perfil.get("cedula") or t.get("identificacion")):
        faltan.append("cédula")
    if not cq.get("_completo"):
        n = len(cq.get("_faltan") or [])
        faltan.append(f"{n} pregunta(s) del cuestionario")
    add(
        "perfil",
        "hecho" if not faltan else ("parcial" if len(faltan) == 1 else "pendiente"),
        "Cédula y cuestionario listos" if not faltan else "Falta: " + ", ".join(faltan),
        len(faltan),
    )

    pr = plan["progreso"]
    pend = [r["titulo"] for r in plan["requisitos"] if r["aplica"] and not r["omitido"] and r["estado"] != "hecho"]
    add(
        "plan",
        "hecho" if pr["total"] and pr["hechos"] == pr["total"] else ("parcial" if pr["hechos"] else "pendiente"),
        (f"{pr['hechos']}/{pr['total']} tipos de documento completos" + (f" · falta: {pend[0]}" + (f" y {len(pend) - 1} más" if len(pend) > 1 else "") if pend else "")),
        len(pend),
    )

    anio_actual = datetime.now().year
    if not extractos:
        add("extractos", "pendiente", "Ningún extracto personal cargado", 0)
    else:
        huecos = 0
        for a, info in (cobertura.get("anios") or {}).items():
            if int(a) < anio_actual:
                huecos += len(info.get("faltan") or [])
        n = len(extractos)
        add(
            "extractos",
            "hecho" if huecos == 0 else "parcial",
            f"{n} extracto{'s' if n != 1 else ''} · "
            + ("sin meses faltantes en años cerrados" if huecos == 0 else f"{huecos} mes(es) sin extracto en años cerrados"),
            huecos,
        )

    n_cuentas = len(saldo.get("cuentas") or [])
    add(
        "mckenna",
        "hecho" if n_cuentas else "pendiente",
        (f"{n_cuentas} cuenta(s) con saldo/movimiento con la empresa" if n_cuentas else "Sin movimientos con McKenna registrados en el Libro Mayor"),
        n_cuentas,
    )

    if cruces_res.get("sin_extracto_socio"):
        ultimo = max((e.get("periodo_hasta") or "" for e in extractos), default="")
        add(
            "cruces",
            "pendiente",
            (f"Sin extracto personal de los últimos 12 meses (el último llega a {ultimo}); carga el más reciente para cruzar"
             if extractos else "Carga primero un extracto personal"),
            0,
        )
    elif "error" in cruces_res:
        add("cruces", "pendiente", cruces_res["error"], 0)
    else:
        sa = int(cruces_res.get("sin_asiento") or 0)
        sp = int(cruces_res.get("sin_par") or 0)
        pares = int(cruces_res.get("pares") or 0)
        add(
            "cruces",
            "hecho" if (sa == 0 and sp == 0) else "parcial",
            f"{pares} giro(s) cruzados · {sa} sin asiento en McKenna · {sp} mencionan a McKenna sin par",
            sa + sp,
        )

    n_docs = len(docs)
    n_rev = sum(
        1
        for a in anios
        if a.get("requiere_revision")
        or a.get("estado") in ("por_corregir", "no_presentada")
        or (a.get("estado") == "borrador" and ventana_f210(int(a["ano"]))["estado"] == "vencida")
    )
    if not cq.get("cripto") and not cq.get("declaro_antes") and cq.get("_completo"):
        add("declarador", "hecho", "Sin criptoactivos ni declaraciones previas: este paso no aplica", 0)
    elif not anios and not n_docs:
        add("declarador", "pendiente", "Sin años gravables ni documentos: importa la carpeta del Declarador o sube los soportes", 0)
    else:
        add(
            "declarador",
            "hecho" if n_rev == 0 else "parcial",
            f"{len(anios)} año(s) · {n_docs} documento(s) · {n_rev} año(s) por corregir o presentar",
            n_rev,
        )

    n_ab = len(abiertos)
    altas = sum(1 for h in abiertos if h["severidad"] == "alta")
    add(
        "cierre",
        "hecho" if n_ab == 0 else ("parcial" if altas == 0 else "pendiente"),
        "Sin pendientes abiertos" if n_ab == 0 else f"{n_ab} pendiente(s) abierto(s), {altas} de severidad alta",
        n_ab,
    )
    return out


def resumen_socios() -> list[dict[str, Any]]:
    """Una línea por socio para el selector/checklist: progreso y pendientes."""
    _ensure()
    from app.services.contabilidad_core import listar_terceros

    out = []
    for t in listar_terceros(tipo="socio"):
        try:
            hall = listar_hallazgos(t["id"], solo_abiertos=True)
            n_doc = len(listar_documentos(t["id"]))
            anios = listar_anios(t["id"])
        except Exception:
            hall, n_doc, anios = [], 0, []
        out.append(
            {
                "id": t["id"],
                "nombre": t["nombre"],
                "usuario_id": t.get("usuario_id"),
                "hallazgos_abiertos": len(hall),
                "documentos": n_doc,
                "anios": len(anios),
                "por_corregir": sum(1 for a in anios if a.get("requiere_revision") or a.get("estado") == "por_corregir"),
            }
        )
    return out


# ── Agente ──────────────────────────────────────────────────────────────────

_PROMPT_AGENTE = """Eres un Contador Público colombiano experto en derecho tributario, fiscalidad internacional y
tributación de criptoactivos/activos digitales bajo el marco de la DIAN (Estatuto Tributario). Trabajas
dentro del panel de McKenna Group S.A.S. asesorando a UN socio de la empresa sobre SU declaración de
renta personal (Formulario 210), con especial foco en criptoactivos no declarados en años anteriores.

Tienes herramientas para leer el expediente del socio (documentos, años gravables, hallazgos, extractos
personales, cruces con la empresa). Úsalas antes de afirmar cifras: no inventes datos que no estén en el
expediente. Cuando descubras un pendiente nuevo, regístralo con `registrar_hallazgo`; cuando el socio
confirme un dato de un año, actualízalo con `actualizar_anio`.

Reglas:
- Responde en español, directo y con trazabilidad: dato origen → conversión → renglón F210.
- Diferencia compras P2P (mover dinero propio vs. adquirir un activo), permutas cripto-cripto y
  ventas a fiat (realización). Tenencia <2 años = renta líquida ordinaria (cédula general);
  ≥2 años = ganancia ocasional (Art. 300 y ss. ET).
- El socio también es socio de McKenna: distingue siempre plata personal de plata de la empresa
  (reintegros de compras con tarjeta personal NO son ingreso; préstamos del socio a la empresa van a
  2380/1355 en la empresa y son cuenta por cobrar en su patrimonio personal).
- No sustituyes al contador para la firma ni para liquidar sanciones e intereses de mora: dilo cuando
  corresponda y deja el cálculo como estimado.
- Sé breve. Máximo ~250 palabras salvo que pidan un cuadro.

=== RESUMEN DEL EXPEDIENTE (JSON) ===
{resumen}
"""

_HERRAMIENTAS = [
    {
        "name": "listar_documentos",
        "description": "Inventario de documentos del expediente (id, categoría, año, nombre). Filtra por categoría o año si se indica.",
        "input_schema": {
            "type": "object",
            "properties": {"categoria": {"type": "string"}, "ano": {"type": "integer"}},
        },
    },
    {
        "name": "leer_documento",
        "description": "Texto de un documento por id (md/txt/csv/json/pdf/xlsx). Recortado a max_chars (default 8000).",
        "input_schema": {
            "type": "object",
            "properties": {"doc_id": {"type": "integer"}, "max_chars": {"type": "integer"}},
            "required": ["doc_id"],
        },
    },
    {
        "name": "consultar_extracto_personal",
        "description": "Busca líneas del banco PERSONAL del socio por texto del concepto, opcionalmente entre fechas (YYYY-MM-DD). Devuelve líneas y sumas.",
        "input_schema": {
            "type": "object",
            "properties": {"concepto": {"type": "string"}, "desde": {"type": "string"}, "hasta": {"type": "string"}},
            "required": ["concepto"],
        },
    },
    {
        "name": "cruces_con_empresa",
        "description": "Giros cruzados entre el banco del socio y el banco/libro de McKenna en un rango (default último año).",
        "input_schema": {
            "type": "object",
            "properties": {"desde": {"type": "string"}, "hasta": {"type": "string"}},
        },
    },
    {
        "name": "registrar_hallazgo",
        "description": "Crea un pendiente/hallazgo en el expediente del socio.",
        "input_schema": {
            "type": "object",
            "properties": {
                "titulo": {"type": "string"},
                "detalle": {"type": "string"},
                "severidad": {"type": "string", "enum": ["alta", "media", "baja"]},
                "ano": {"type": "integer"},
            },
            "required": ["titulo", "detalle"],
        },
    },
    {
        "name": "actualizar_anio",
        "description": "Actualiza campos de un año gravable (patrimonio_bruto, deudas, renta_liquida, impuesto_pagado, estado, notas, …). Solo con datos confirmados por el socio o un documento.",
        "input_schema": {
            "type": "object",
            "properties": {"ano": {"type": "integer"}, "campos": {"type": "object"}},
            "required": ["ano", "campos"],
        },
    },
]


def _ejecutar_herramienta(tercero_id: int, nombre: str, args: dict) -> str:
    try:
        if nombre == "listar_documentos":
            docs = listar_documentos(tercero_id)
            if args.get("categoria"):
                docs = [d for d in docs if d["categoria"] == args["categoria"]]
            if args.get("ano"):
                docs = [d for d in docs if d.get("ano") == int(args["ano"])]
            return json.dumps(
                [{"id": d["id"], "categoria": d["categoria"], "ano": d.get("ano"), "nombre": d["archivo_nombre"], "legible": d["legible"]} for d in docs[:120]],
                ensure_ascii=False,
            )
        if nombre == "leer_documento":
            return leer_documento_texto(tercero_id, int(args["doc_id"]), int(args.get("max_chars") or 8000))
        if nombre == "consultar_extracto_personal":
            from app.services.extracto_bancario import lineas_por_titular

            q = (args.get("concepto") or "").strip().lower()
            lineas = lineas_por_titular(tercero_id, desde=args.get("desde"), hasta=args.get("hasta"))
            hits = [l for l in lineas if q in (l["descripcion"] or "").lower() or q in (l["referencia"] or "").lower()]
            deb = sum(l["monto"] for l in hits if l["tipo"] == "debito")
            cre = sum(l["monto"] for l in hits if l["tipo"] == "credito")
            return json.dumps(
                {"coincidencias": len(hits), "suma_debitos": round(deb, 2), "suma_creditos": round(cre, 2), "lineas": hits[:60]},
                ensure_ascii=False,
            )
        if nombre == "cruces_con_empresa":
            c = cruces_socio_empresa(tercero_id, desde=args.get("desde"), hasta=args.get("hasta"))
            c["empresa_a_socio"] = c["empresa_a_socio"][:40]
            c["socio_a_empresa"] = c["socio_a_empresa"][:40]
            c["mencionan_mckenna_sin_par"] = c["mencionan_mckenna_sin_par"][:40]
            return json.dumps(c, ensure_ascii=False, default=str)
        if nombre == "registrar_hallazgo":
            h = crear_hallazgo(tercero_id, args, origen="agente")
            return json.dumps({"ok": True, "id": h["id"], "clave": h["clave"]}, ensure_ascii=False)
        if nombre == "actualizar_anio":
            a = actualizar_anio(tercero_id, int(args["ano"]), dict(args.get("campos") or {}))
            return json.dumps({"ok": True, "ano": a["ano"], "estado": a["estado"]}, ensure_ascii=False)
        return f"herramienta desconocida: {nombre}"
    except Exception as e:  # noqa: BLE001
        return f"error en {nombre}: {e}"


def _resumen_para_agente(tercero_id: int) -> dict[str, Any]:
    exp = obtener_expediente(tercero_id)
    return {
        "socio": exp["perfil"]["tercero"]["nombre"],
        "cedula": exp["perfil"].get("cedula"),
        "binance_uid": exp["perfil"].get("binance_uid"),
        "anios": [
            {k: a.get(k) for k in ("ano", "estado", "formulario", "patrimonio_bruto", "deudas", "renta_liquida", "impuesto_pagado", "cripto_renta_ordinaria", "cripto_ganancia_ocasional", "cripto_sin_costo", "tenencia_cierre_usd", "requiere_revision")}
            for a in exp["anios"]
        ],
        "hallazgos_abiertos": [
            {k: h.get(k) for k in ("id", "ano", "severidad", "titulo", "estado")} for h in exp["hallazgos"] if h["estado"] in ("pendiente", "en_curso")
        ][:40],
        "documentos_por_categoria": exp["documentos_por_categoria"],
        "cobertura_extractos": exp["cobertura"].get("anios"),
        "cuenta_mckenna": exp["cuenta_mckenna"],
        "cruces": exp["cruces"],
        "pasos": [{"id": p["id"], "estado": p["estado"], "detalle": p["detalle"]} for p in exp["pasos"]],
    }


def historial_chat(tercero_id: int, limit: int = 60) -> list[dict[str, Any]]:
    _ensure()
    with _conn() as con:
        rows = con.execute(
            "SELECT id, rol, texto, created_at FROM dl_chat WHERE tercero_id=? ORDER BY id DESC LIMIT ?",
            (int(tercero_id), max(1, min(int(limit), 300))),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def _guardar_turno(tercero_id: int, rol: str, texto: str) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO dl_chat (tercero_id, rol, texto) VALUES (?, ?, ?)",
            (int(tercero_id), rol, texto[:20000]),
        )


def borrar_chat(tercero_id: int) -> int:
    _ensure()
    with _conn() as con:
        cur = con.execute("DELETE FROM dl_chat WHERE tercero_id=?", (int(tercero_id),))
        return int(cur.rowcount or 0)


def responder_agente(tercero_id: int, mensaje: str, *, max_iteraciones: int = 6) -> dict[str, Any]:
    """Un turno del agente para este socio. Claude con tool-use (lee el
    expediente, registra hallazgos); Gemini como red de seguridad sin
    herramientas. Cada llamada pasa por `llm_budget`."""
    import app.core as core
    from app.services.llm_budget import permitir_llamada, registrar_llamada, usage_anthropic, usage_gemini

    _ensure()
    mensaje = (mensaje or "").strip()
    if not mensaje:
        raise ValueError("Falta el mensaje")
    cliente_claude = getattr(core, "cliente_ia", None)
    cliente_gemini = getattr(core, "cliente_gemini", None)
    if not cliente_claude and not cliente_gemini:
        raise RuntimeError("Sin ANTHROPIC_API_KEY ni GOOGLE_API_KEY: el agente Declarador no está disponible")

    sistema = _PROMPT_AGENTE.format(resumen=json.dumps(_resumen_para_agente(tercero_id), ensure_ascii=False, default=str))
    previos = historial_chat(tercero_id, limit=16)
    turnos = [
        {"role": "assistant" if t["rol"] == "assistant" else "user", "content": t["texto"]}
        for t in previos
        if (t["texto"] or "").strip()
    ]
    _guardar_turno(tercero_id, "user", mensaje)
    acciones: list[str] = []

    modelo = os.getenv("DECLARADOR_MODELO", "claude-sonnet-5")
    if cliente_claude:
        ok, motivo = permitir_llamada(modelo, contexto="declarador")
        if not ok:
            raise RuntimeError(motivo)
        mensajes = turnos + [{"role": "user", "content": mensaje}]
        texto_final = ""
        for _ in range(max_iteraciones):
            resp = cliente_claude.messages.create(
                model=modelo,
                max_tokens=1800,
                system=sistema,
                tools=_HERRAMIENTAS,
                messages=mensajes,
            )
            try:
                ti, to = usage_anthropic(resp)
            except Exception:
                ti, to = 0, 0
            registrar_llamada(modelo, ti, to, contexto="declarador")
            partes_texto = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
            tool_uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
            if partes_texto:
                texto_final = "\n".join(partes_texto).strip()
            if resp.stop_reason != "tool_use" or not tool_uses:
                break
            mensajes.append({"role": "assistant", "content": [b.model_dump() if hasattr(b, "model_dump") else b for b in resp.content]})
            resultados = []
            for tu in tool_uses:
                salida = _ejecutar_herramienta(int(tercero_id), tu.name, dict(tu.input or {}))
                acciones.append(tu.name)
                resultados.append({"type": "tool_result", "tool_use_id": tu.id, "content": salida[:30000]})
            mensajes.append({"role": "user", "content": resultados})
            ok, motivo = permitir_llamada(modelo, contexto="declarador")
            if not ok:
                texto_final = (texto_final + "\n\n⚠️ " + motivo).strip()
                break
        texto_final = texto_final or "(sin respuesta)"
        _guardar_turno(tercero_id, "assistant", texto_final)
        return {"respuesta": texto_final, "acciones": acciones, "modelo": modelo}

    # Red de seguridad: Gemini sin herramientas (solo contexto).
    modelo_g = "gemini-2.5-pro"
    ok, motivo = permitir_llamada(modelo_g, contexto="declarador")
    if not ok:
        raise RuntimeError(motivo)
    contexto = "\n".join(f"{'Asesor' if t['role'] == 'assistant' else 'Socio'}: {t['content']}" for t in turnos)
    prompt = (
        f"{sistema}\n\nConversación previa:\n{contexto or '[sin historial]'}\n\n"
        f"Pregunta actual del socio:\n{mensaje}\n\nResponde solo el texto final para el socio."
    )
    resp = cliente_gemini.models.generate_content(model=modelo_g, contents=prompt)
    try:
        ti, to = usage_gemini(resp)
    except Exception:
        ti, to = 0, 0
    registrar_llamada(modelo_g, ti, to, contexto="declarador", chars_prompt=len(prompt))
    texto = (getattr(resp, "text", "") or "").strip() or "(sin respuesta)"
    _guardar_turno(tercero_id, "assistant", texto)
    return {"respuesta": texto, "acciones": [], "modelo": modelo_g}
