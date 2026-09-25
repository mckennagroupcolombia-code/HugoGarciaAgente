"""
Extractos bancarios ↔ libro de ingresos/egresos.

- Parsea CSV / Excel / PDF (Bancolombia y formatos genéricos CO).
- Persiste líneas en contabilidad.db.
- Vincula cada línea del extracto a un movimiento del libro (id estable).
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import zipfile
from datetime import datetime, timedelta
from typing import Any

from app.services.contabilidad_db import _conn, _ensure

_EXTRACTOS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "extractos_bancarios"
)

_FECHA_HEADERS = (
    "fecha",
    "date",
    "f. movimiento",
    "f movimiento",
    "fecha movimiento",
    "fecha transaccion",
    "fecha transacción",
    "fecha valor",
    "valor fecha",
)
_DESC_HEADERS = (
    "descripcion",
    "descripción",
    "detalle",
    "concepto",
    "transaccion",
    "transacción",
    "descripcion transaccion",
    "descripción transacción",
    "narrativa",
)
_REF_HEADERS = (
    "referencia",
    "ref",
    "documento",
    "nro",
    "numero",
    "número",
    "nro documento",
    "id transaccion",
    "id transacción",
)
_DEBITO_HEADERS = (
    "debito",
    "débito",
    "retiro",
    "cargo",
    "valor debito",
    "valor débito",
    "debitos",
    "débitos",
)
_CREDITO_HEADERS = (
    "credito",
    "crédito",
    "abono",
    "consignacion",
    "consignación",
    "valor credito",
    "valor crédito",
    "creditos",
    "créditos",
)
_VALOR_HEADERS = ("valor", "monto", "amount", "importe", "valor movimiento")
_SALDO_HEADERS = ("saldo", "balance", "saldo disponible")
_TIPO_HEADERS = ("tipo", "naturaleza", "signo", "dc")

_MESES_ES = {
    "ene": 1,
    "enero": 1,
    "feb": 2,
    "febrero": 2,
    "mar": 3,
    "marzo": 3,
    "abr": 4,
    "abril": 4,
    "may": 5,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "jul": 7,
    "julio": 7,
    "ago": 8,
    "agosto": 8,
    "sep": 9,
    "sept": 9,
    "septiembre": 9,
    "set": 9,
    "oct": 10,
    "octubre": 10,
    "nov": 11,
    "noviembre": 11,
    "dic": 12,
    "diciembre": 12,
}

# Línea de PDF: fecha al inicio + resto (numérica o con mes en español)
_PDF_LINEA_FECHA = re.compile(
    r"^(?P<fecha>"
    r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"
    r"|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}"
    r"|\d{1,2}\s*[/\-.\s]\s*[A-Za-zÁÉÍÓÚáéíóú]{3,12}\s*[/\-.\s]\s*\d{2,4}"
    r")\b\s+(?P<rest>.+)$",
    re.IGNORECASE,
)
# Montos típicos CO / US en texto de extracto
_PDF_MONTO = re.compile(
    r"(?<![\w/])("
    r"-?\$?\s*\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?"  # 1.234.567,89
    r"|-?\$?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?"  # 1,234,567.89
    r"|-?\$?\s*\d+[.,]\d{2}"  # 1234,50 / 1234.50
    r"|-?\d{4,}"  # 50000 enteros
    r")(?!\d)"
)

def id_movimiento_ledger(row: dict[str, Any]) -> str:
    """Id estable de una fila del libro (para vincular sin persistir el libro)."""
    extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
    parts = [
        str(row.get("fecha") or ""),
        str(row.get("tipo") or ""),
        str(row.get("fuente") or ""),
        str(row.get("referencia") or ""),
        f"{float(row.get('monto') or 0):.2f}",
        str(row.get("concepto") or "")[:120],
        str(extra.get("order_id") or ""),
        str(row.get("contraparte") or "")[:80],
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:20]


def ensure_extracto_tables() -> None:
    _ensure()
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS extractos_bancarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                banco TEXT NOT NULL DEFAULT '',
                cuenta TEXT NOT NULL DEFAULT '',
                periodo_desde TEXT NOT NULL DEFAULT '',
                periodo_hasta TEXT NOT NULL DEFAULT '',
                archivo_nombre TEXT NOT NULL DEFAULT '',
                archivo_path TEXT NOT NULL DEFAULT '',
                notas TEXT NOT NULL DEFAULT '',
                lineas_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS extracto_movimientos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                extracto_id INTEGER NOT NULL
                    REFERENCES extractos_bancarios(id) ON DELETE CASCADE,
                fecha TEXT NOT NULL,
                descripcion TEXT NOT NULL DEFAULT '',
                referencia TEXT NOT NULL DEFAULT '',
                monto REAL NOT NULL,
                tipo TEXT NOT NULL,
                saldo REAL,
                fila_origen INTEGER,
                hash_linea TEXT NOT NULL DEFAULT ''
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_extracto_hash
                ON extracto_movimientos(extracto_id, hash_linea);
            CREATE TABLE IF NOT EXISTS extracto_vinculos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                extracto_mov_id INTEGER NOT NULL UNIQUE
                    REFERENCES extracto_movimientos(id) ON DELETE CASCADE,
                movimiento_id TEXT NOT NULL UNIQUE,
                notas TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_vinculo_mov
                ON extracto_vinculos(movimiento_id);
            """
        )
        try:
            cols = {r[1] for r in con.execute("PRAGMA table_info(extractos_bancarios)").fetchall()}
            if "nombre" not in cols:
                con.execute(
                    "ALTER TABLE extractos_bancarios ADD COLUMN nombre TEXT NOT NULL DEFAULT ''"
                )
            # Titular del extracto: NULL = la empresa (McKenna); un id de
            # cc_terceros (tipo socio) = extracto PERSONAL de ese socio. Los
            # extractos de socios nunca entran a la conciliación de la empresa
            # (candidatos/sugerencias/pendientes filtran por titular) — son
            # datos del socio para SU contabilidad y su declaración de renta,
            # y solo se cruzan con la empresa vía declarador.cruces_socio_empresa.
            if "tercero_id" not in cols:
                con.execute(
                    "ALTER TABLE extractos_bancarios ADD COLUMN tercero_id INTEGER"
                )
                con.execute(
                    "CREATE INDEX IF NOT EXISTS idx_extracto_tercero ON extractos_bancarios(tercero_id)"
                )
        except Exception:
            pass


def _filtro_titular(tercero_id: int | None, alias: str = "e") -> tuple[str, list[Any]]:
    """Cláusula SQL para restringir por titular del extracto.

    `tercero_id=None` → solo extractos de la empresa (`tercero_id IS NULL`);
    un entero → solo los de ese socio. Se usa en toda consulta que agrega
    líneas de varios extractos, para que el banco personal de un socio jamás
    aparezca como candidato/pendiente de la contabilidad de McKenna."""
    if tercero_id is None:
        return f"{alias}.tercero_id IS NULL", []
    return f"{alias}.tercero_id = ?", [int(tercero_id)]


def _norm_header(h: str) -> str:
    s = (h or "").strip().lower()
    s = (
        s.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
    )
    s = re.sub(r"\s+", " ", s)
    return s


def _find_col(headers: list[str], aliases: tuple[str, ...]) -> int | None:
    norms = [_norm_header(h) for h in headers]
    alias_norm = [_norm_header(a) for a in aliases]
    for i, h in enumerate(norms):
        if h in alias_norm:
            return i
    for i, h in enumerate(norms):
        for a in alias_norm:
            if a and (a in h or h in a):
                return i
    return None


def _parse_fecha(val: Any, periodo_hasta: tuple[int, int] | None = None) -> str:
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return ""
    # Excel serial (días desde 1899-12-30)
    if re.fullmatch(r"\d{5}(\.\d+)?", s):
        try:
            base = datetime(1899, 12, 30)
            d = base + timedelta(days=float(s))
            return d.strftime("%Y-%m-%d")
        except Exception:
            pass
    # D/M o D/MM sin año (p. ej. extracto Bancolombia "1/07"): usa el año del
    # bloque DESDE/HASTA del encabezado general del extracto.
    m_corto = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})", s)
    if m_corto and periodo_hasta:
        try:
            dia, mes = int(m_corto.group(1)), int(m_corto.group(2))
            anio_hasta, mes_hasta = periodo_hasta
            anio = anio_hasta - 1 if mes > mes_hasta else anio_hasta
            if 1 <= dia <= 31 and 1 <= mes <= 12:
                return f"{anio:04d}-{mes:02d}-{dia:02d}"
        except ValueError:
            pass
    # 01 Ago 2026 / 1-AGO-26 / 01/agosto/2026
    m_mes = re.match(
        r"^(\d{1,2})\s*[/\-.\s]\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]{3,12})\s*[/\-.\s]\s*(\d{2,4})$",
        s,
        re.IGNORECASE,
    )
    if m_mes:
        try:
            dia = int(m_mes.group(1))
            mes_raw = (
                m_mes.group(2)
                .lower()
                .replace("á", "a")
                .replace("é", "e")
                .replace("í", "i")
                .replace("ó", "o")
                .replace("ú", "u")
            )
            mes = _MESES_ES.get(mes_raw) or _MESES_ES.get(mes_raw[:3])
            anio = int(m_mes.group(3))
            if anio < 100:
                anio += 2000
            if mes and 1 <= dia <= 31:
                return f"{anio:04d}-{mes:02d}-{dia:02d}"
        except ValueError:
            pass
    s_norm = s.replace(".", "/").replace("-", "/")
    for fmt in ("%d/%m/%Y", "%Y/%m/%d", "%d/%m/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s_norm[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # ISO leftover
    m = re.match(r"(\d{4})[/-](\d{2})[/-](\d{2})", str(val))
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


def _parse_monto(val: Any) -> float | None:
    if val is None or val == "":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s or s in {"-", "—", "N/A", "n/a"}:
        return None
    s = s.replace("$", "").replace("COP", "").replace(" ", "").strip()
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1]
    if s.startswith("-"):
        neg = True
        s = s[1:]
    # 1.234.567,89 (CO) vs 1,234,567.89 (US)
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # solo coma: decimal si hay 1-2 dígitos tras la última
        parts = s.split(",")
        if len(parts[-1]) <= 2:
            s = "".join(parts[:-1]) + "." + parts[-1]
        else:
            s = s.replace(",", "")
    elif "." in s:
        # solo puntos: miles CO (1.234.567 o 50.000) vs decimal US (50.5)
        parts = s.split(".")
        if len(parts) > 1 and all(len(p) == 3 for p in parts[1:]):
            # grupos de 3 → miles (último también de 3)
            s = "".join(parts)
        elif len(parts) == 2 and len(parts[1]) == 3 and parts[0].isdigit() and len(parts[0]) <= 3:
            # "50.000" → 50000 (CO); no "50.500" ambiguo: 3 decimales raros en COP
            # Si la parte entera tiene ≤3 dígitos y la fracc exactamente 3, preferir miles CO.
            s = "".join(parts)
        # else: dejar para float() como decimal (12.5)
    try:
        n = float(s)
        return -n if neg else n
    except ValueError:
        return None


def _hash_linea(fecha: str, tipo: str, monto: float, desc: str, ref: str, fila: int) -> str:
    raw = f"{fecha}|{tipo}|{monto:.2f}|{desc[:80]}|{ref}|{fila}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def _infer_tipo_from_texto(tipo_raw: str, monto: float) -> str:
    t = _norm_header(tipo_raw)
    if any(x in t for x in ("credito", "cred", "abono", "ingreso", "c")):
        return "credito"
    if any(x in t for x in ("debito", "deb", "retiro", "cargo", "egreso", "d")):
        return "debito"
    # monto negativo → débito (salida)
    return "debito" if monto < 0 else "credito"


def _extraer_periodo_hasta(matrix: list[list[Any]]) -> tuple[int, int] | None:
    """Busca el bloque DESDE/HASTA del encabezado general (formato Bancolombia)
    y devuelve (año, mes) de HASTA — usado para completar fechas de movimiento
    que vienen sin año (p. ej. "1/07")."""
    for i, row in enumerate(matrix[:20]):
        norms = [_norm_header(str(c or "")) for c in row]
        if "desde" in norms and "hasta" in norms:
            idx_hasta = norms.index("hasta")
            if i + 1 < len(matrix):
                sig = matrix[i + 1]
                val = sig[idx_hasta] if idx_hasta < len(sig) else None
                m = re.match(r"(\d{4})[/-](\d{1,2})[/-]\d{1,2}", str(val or "").strip())
                if m:
                    return int(m.group(1)), int(m.group(2))
    return None


def _rows_from_matrix(matrix: list[list[Any]]) -> list[dict[str, Any]]:
    if not matrix:
        return []
    periodo_hasta = _extraer_periodo_hasta(matrix)
    # Buscar fila de encabezados (primera con ≥2 celdas texto)
    header_idx = 0
    for i, row in enumerate(matrix[:15]):
        texts = [str(c or "").strip() for c in row if str(c or "").strip()]
        if len(texts) >= 2:
            joined = " ".join(_norm_header(t) for t in texts)
            if any(k in joined for k in ("fecha", "date", "valor", "debito", "credito", "descripcion")):
                header_idx = i
                break
    headers = [str(c or "").strip() for c in matrix[header_idx]]
    i_fecha = _find_col(headers, _FECHA_HEADERS)
    i_desc = _find_col(headers, _DESC_HEADERS)
    i_ref = _find_col(headers, _REF_HEADERS)
    i_deb = _find_col(headers, _DEBITO_HEADERS)
    i_cre = _find_col(headers, _CREDITO_HEADERS)
    i_val = _find_col(headers, _VALOR_HEADERS)
    i_sal = _find_col(headers, _SALDO_HEADERS)
    i_tipo = _find_col(headers, _TIPO_HEADERS)

    if i_fecha is None:
        raise ValueError(
            "No se encontró columna de fecha. Use CSV/Excel con encabezado Fecha / Débito / Crédito."
        )

    out: list[dict[str, Any]] = []
    for fila_n, row in enumerate(matrix[header_idx + 1 :], start=header_idx + 2):
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue

        def cell(idx: int | None) -> Any:
            if idx is None or idx >= len(row):
                return None
            return row[idx]

        fecha = _parse_fecha(cell(i_fecha), periodo_hasta)
        if not fecha:
            continue
        desc = str(cell(i_desc) or "").strip()[:220]
        ref = str(cell(i_ref) or "").strip()[:80]
        saldo_v = _parse_monto(cell(i_sal))
        tipo = ""
        monto = 0.0

        deb = _parse_monto(cell(i_deb)) if i_deb is not None else None
        cre = _parse_monto(cell(i_cre)) if i_cre is not None else None
        if deb is not None and abs(deb) > 0.009 and (cre is None or abs(cre) < 0.01):
            tipo = "debito"
            monto = abs(deb)
        elif cre is not None and abs(cre) > 0.009 and (deb is None or abs(deb) < 0.01):
            tipo = "credito"
            monto = abs(cre)
        else:
            val = _parse_monto(cell(i_val)) if i_val is not None else None
            if val is None:
                continue
            tipo_raw = str(cell(i_tipo) or "")
            tipo = _infer_tipo_from_texto(tipo_raw, val)
            monto = abs(val)

        if monto < 0.01:
            continue

        out.append(
            {
                "fecha": fecha,
                "descripcion": desc or "(sin descripción)",
                "referencia": ref,
                "monto": round(monto, 2),
                "tipo": tipo,
                "saldo": round(saldo_v, 2) if saldo_v is not None else None,
                "fila_origen": fila_n,
                "hash_linea": _hash_linea(fecha, tipo, monto, desc, ref, fila_n),
            }
        )
    return out


def _rows_from_pdf_plain_text(text: str) -> list[dict[str, Any]]:
    """Fallback: líneas con fecha al inicio y montos al final (extractos CO)."""
    out: list[dict[str, Any]] = []
    for fila_n, raw in enumerate(text.splitlines(), start=1):
        line = (raw or "").strip()
        if len(line) < 10:
            continue
        m = _PDF_LINEA_FECHA.match(line)
        if not m:
            # Fecha en cualquier parte al inicio tras basura corta (p. ej. viñeta)
            m2 = re.search(
                r"(?P<fecha>\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})",
                line[:24],
            )
            if not m2:
                continue
            fecha = _parse_fecha(m2.group("fecha"))
            if not fecha:
                continue
            rest = (line[m2.end() :]).strip()
        else:
            fecha = _parse_fecha(m.group("fecha"))
            if not fecha:
                continue
            rest = m.group("rest").strip()
        if not rest:
            continue
        hits: list[tuple[int, float, str]] = []
        for mm in _PDF_MONTO.finditer(rest):
            token = mm.group(1)
            # Evitar capturar años sueltos tipo 2024 en la descripción
            if re.fullmatch(r"20\d{2}", token.replace("$", "").strip()):
                continue
            v = _parse_monto(token)
            if v is None or abs(v) < 0.01:
                continue
            hits.append((mm.start(), float(v), token))
        if not hits:
            continue

        saldo_v: float | None = None
        if len(hits) >= 2:
            monto_raw = hits[-2][1]
            saldo_v = hits[-1][1]
            desc_end = hits[-2][0]
        else:
            monto_raw = hits[0][1]
            desc_end = hits[0][0]

        desc = rest[:desc_end].strip(" -\t·|")
        # Quitar referencias numéricas sueltas al final de la descripción
        desc = re.sub(r"\s+\d{6,}\s*$", "", desc).strip() or "(sin descripción)"
        desc = desc[:220]

        dn = _norm_header(desc)
        tipo = "debito" if monto_raw < 0 else "credito"
        if any(
            x in dn
            for x in (
                "abono",
                "consignacion",
                "nomina",
                "nómina",
                "transferencia recibida",
                "credito",
                "ingreso",
            )
        ):
            tipo = "credito"
        elif any(
            x in dn
            for x in (
                "retiro",
                "pago",
                "debito",
                "compra",
                "comision",
                "comisión",
                "transferencia enviada",
                "cargo",
            )
        ):
            tipo = "debito"

        monto = abs(monto_raw)
        if monto < 0.01:
            continue
        ref = ""
        out.append(
            {
                "fecha": fecha,
                "descripcion": desc,
                "referencia": ref,
                "monto": round(monto, 2),
                "tipo": tipo,
                "saldo": round(saldo_v, 2) if saldo_v is not None else None,
                "fila_origen": fila_n,
                "hash_linea": _hash_linea(fecha, tipo, monto, desc, ref, fila_n),
            }
        )
    return out


def _pdf_cluster_word_rows(page) -> list[list[tuple[float, str]]]:
    """Agrupa palabras del PDF por Y (misma fila visual) ordenadas por X."""
    try:
        words = page.get_text("words") or []
    except Exception:
        return []
    buckets: dict[int, list[tuple[float, str]]] = {}
    for w in words:
        try:
            x0, y0, _x1, y1, token = w[0], w[1], w[2], w[3], str(w[4] or "")
        except (IndexError, TypeError, ValueError):
            continue
        token = token.strip()
        if not token:
            continue
        key = int(round(((y0 + y1) / 2.0) / 3.5) * 3.5)
        buckets.setdefault(key, []).append((float(x0), token))
    rows: list[list[tuple[float, str]]] = []
    for key in sorted(buckets):
        parts = sorted(buckets[key], key=lambda t: t[0])
        rows.append(parts)
    return rows


def _pdf_lines_from_words(page) -> list[str]:
    return [" ".join(tok for _x, tok in row) for row in _pdf_cluster_word_rows(page)]


def _pdf_matrix_from_words(page) -> list[list[str]]:
    return [[tok for _x, tok in row] for row in _pdf_cluster_word_rows(page)]


def _rows_from_date_leading_matrix(matrix: list[list[Any]]) -> list[dict[str, Any]]:
    """
    Matriz sin encabezados claros: primera celda = fecha, últimas = montos.
    Útil cuando el PDF parte cada columna en celdas sueltas.
    """
    out: list[dict[str, Any]] = []
    for fila_n, row in enumerate(matrix, start=1):
        cells = [str(c or "").strip() for c in row if str(c or "").strip()]
        if len(cells) < 2:
            continue
        fecha = _parse_fecha(cells[0])
        if not fecha:
            # A veces la fecha viene pegada al segundo token
            m = re.match(
                r"^(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})(.*)$",
                cells[0],
            )
            if not m:
                continue
            fecha = _parse_fecha(m.group(1))
            if not fecha:
                continue
            extra = (m.group(2) or "").strip()
            cells = ([extra] if extra else []) + cells[1:]
        montos: list[float] = []
        desc_parts: list[str] = []
        for c in cells[1:]:
            v = _parse_monto(c)
            # Celda solo-monto (no mezclar códigos de 6+ dígitos sin separador como monto si
            # parecen referencias: preferir montos con separador o cortos)
            if v is not None and abs(v) >= 0.01:
                compact = c.replace(" ", "").replace("$", "")
                looks_money = bool(
                    re.fullmatch(r"-?\d{1,3}([.,]\d{3})+([.,]\d{1,2})?", compact)
                    or re.fullmatch(r"-?\d+[.,]\d{2}", compact)
                    or re.fullmatch(r"-?\d{1,7}", compact)
                )
                if looks_money:
                    montos.append(float(v))
                    continue
            desc_parts.append(c)
        if not montos:
            continue
        if len(montos) >= 2:
            monto_raw, saldo_v = montos[-2], montos[-1]
        else:
            monto_raw, saldo_v = montos[0], None
        desc = " ".join(desc_parts).strip()[:220] or "(sin descripción)"
        dn = _norm_header(desc)
        tipo = "debito" if monto_raw < 0 else "credito"
        if any(x in dn for x in ("abono", "consignacion", "nomina", "transferencia recibida", "credito", "ingreso")):
            tipo = "credito"
        elif any(x in dn for x in ("retiro", "pago", "debito", "compra", "comision", "comisión", "transferencia enviada", "cargo")):
            tipo = "debito"
        monto = abs(monto_raw)
        if monto < 0.01:
            continue
        out.append(
            {
                "fecha": fecha,
                "descripcion": desc,
                "referencia": "",
                "monto": round(monto, 2),
                "tipo": tipo,
                "saldo": round(saldo_v, 2) if saldo_v is not None else None,
                "fila_origen": fila_n,
                "hash_linea": _hash_linea(fecha, tipo, monto, desc, "", fila_n),
            }
        )
    return out


def _parse_pdf_extracto(contenido: bytes) -> list[dict[str, Any]]:
    """Lee PDF de extracto: palabras por fila, tablas o texto plano."""
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise ValueError("PyMuPDF (fitz) no disponible para leer PDF") from e

    if not contenido.startswith(b"%PDF"):
        raise ValueError("El archivo no parece un PDF válido")

    try:
        doc = fitz.open(stream=contenido, filetype="pdf")
    except Exception as e:
        raise ValueError(f"No se pudo abrir el PDF: {e}") from e

    matrices: list[list[list[Any]]] = []
    word_lines: list[str] = []
    word_matrices: list[list[list[str]]] = []
    text_parts: list[str] = []
    try:
        if doc.is_encrypted:
            try:
                doc.authenticate("")
            except Exception:
                pass
            if doc.is_encrypted:
                raise ValueError("El PDF está protegido con contraseña")

        for page in doc:
            text_parts.append(page.get_text("text") or "")
            lines = _pdf_lines_from_words(page)
            if lines:
                word_lines.extend(lines)
                word_matrices.append(_pdf_matrix_from_words(page))
            try:
                finder = page.find_tables()
                tables = getattr(finder, "tables", None) or list(finder)
                for tab in tables:
                    try:
                        data = tab.extract()
                    except Exception:
                        continue
                    if data and len(data) >= 2:
                        matrices.append(data)
            except Exception:
                continue
    finally:
        doc.close()

    candidates: list[list[dict[str, Any]]] = []

    # 1) Filas reconstruidas por posición (arregla columnas sueltas del banco)
    if word_lines:
        rows = _rows_from_pdf_plain_text("\n".join(word_lines))
        if rows:
            candidates.append(rows)
    for wm in word_matrices:
        rows = _rows_from_date_leading_matrix(wm)
        if rows:
            candidates.append(rows)
        try:
            rows = _rows_from_matrix(wm)
            if rows:
                candidates.append(rows)
        except ValueError:
            pass

    # 2) Tablas detectadas por PyMuPDF
    for matrix in matrices:
        try:
            rows = _rows_from_matrix(matrix)
            if rows:
                candidates.append(rows)
        except ValueError:
            pass
        rows = _rows_from_date_leading_matrix(
            [[str(c or "") for c in row] for row in matrix]
        )
        if rows:
            candidates.append(rows)

    # 3) Texto crudo del PDF
    text = "\n".join(text_parts)
    if text.strip():
        rows = _rows_from_pdf_plain_text(text)
        if rows:
            candidates.append(rows)

    if candidates:
        return max(candidates, key=len)

    # 4) IA (Gemini vision): PDFs de Bancolombia a menudo son imagen o layout raro
    try:
        rows_ia = _parse_pdf_extracto_con_ia(contenido)
        if rows_ia:
            return rows_ia
    except Exception:
        pass

    if not (text.strip() or word_lines):
        raise ValueError(
            "El PDF no tiene texto seleccionable (¿escaneado?). "
            "Se intentó con IA y tampoco se leyeron movimientos. "
            "Exporte el extracto a CSV/Excel desde la app del banco."
        )

    raise ValueError(
        "No se encontraron movimientos en el PDF. "
        "Pruebe exportar desde el banco en CSV/Excel, o un PDF de 'movimientos' "
        "(no solo el resumen / imagen)."
    )


def _extraer_json_ia(texto: str) -> dict[str, Any] | None:
    raw = (texto or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        import json

        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return None
        try:
            import json

            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else None
        except Exception:
            return None


def _parse_pdf_extracto_con_ia(contenido: bytes) -> list[dict[str, Any]]:
    """Renderiza páginas del PDF y pide a Gemini los movimientos en JSON."""
    api_key = (os.getenv("GOOGLE_API_KEY") or "").strip()
    if not api_key:
        return []

    try:
        import fitz
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return []

    try:
        doc = fitz.open(stream=contenido, filetype="pdf")
    except Exception:
        return []

    pngs: list[bytes] = []
    try:
        if doc.is_encrypted:
            try:
                doc.authenticate("")
            except Exception:
                pass
            if doc.is_encrypted:
                return []
        max_pages = int(os.getenv("EXTRACTO_PDF_IA_MAX_PAGES", "10") or 10)
        max_pages = max(1, min(max_pages, 20))
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            # ~144 dpi: legible y no demasiado pesado
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            pngs.append(pix.tobytes("png"))
    finally:
        doc.close()

    if not pngs:
        return []

    model_name = (
        os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
    )
    prompt = (
        "Eres un extractor de extractos bancarios de Colombia (Bancolombia, Davivienda, etc.). "
        "Lee las imágenes del extracto y responde SOLO JSON válido con esta forma:\n"
        '{"movimientos":[{"fecha":"YYYY-MM-DD","descripcion":"texto",'
        '"referencia":"","monto":12345.67,"tipo":"debito"|"credito","saldo":null}]}\n'
        "Reglas:\n"
        "- Incluye TODOS los movimientos visibles (no inventes).\n"
        "- monto siempre positivo (número).\n"
        "- tipo=debito si es retiro/pago/compra/cargo/salida; credito si es abono/consignación/nómina/ingreso.\n"
        "- Si una columna muestra valor en débito o crédito, úsala.\n"
        "- fecha en ISO YYYY-MM-DD.\n"
        "- Si no hay movimientos: {\"movimientos\":[]}"
    )

    parts: list[Any] = [prompt]
    for png in pngs:
        parts.append(gtypes.Part.from_bytes(data=png, mime_type="image/png"))

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model=model_name, contents=parts)
    except Exception:
        return []

    parsed = _extraer_json_ia(getattr(response, "text", None) or "")
    if not parsed:
        return []
    raw_movs = parsed.get("movimientos")
    if not isinstance(raw_movs, list):
        raw_movs = parsed.get("movimientos_bancarios") or parsed.get("lineas") or []
    if not isinstance(raw_movs, list):
        return []

    out: list[dict[str, Any]] = []
    for i, item in enumerate(raw_movs, start=1):
        if not isinstance(item, dict):
            continue
        fecha = _parse_fecha(item.get("fecha"))
        if not fecha:
            continue
        monto_v = _parse_monto(item.get("monto"))
        if monto_v is None:
            continue
        monto = abs(float(monto_v))
        if monto < 0.01:
            continue
        tipo_raw = str(item.get("tipo") or "").strip().lower()
        if tipo_raw in ("debito", "débito", "retiro", "pago", "egreso", "d"):
            tipo = "debito"
        elif tipo_raw in ("credito", "crédito", "abono", "ingreso", "c"):
            tipo = "credito"
        else:
            tipo = _infer_tipo_from_texto(tipo_raw, float(monto_v))
        desc = str(item.get("descripcion") or item.get("concepto") or "").strip()[:220] or "(sin descripción)"
        ref = str(item.get("referencia") or "").strip()[:80]
        saldo_v = _parse_monto(item.get("saldo"))
        out.append(
            {
                "fecha": fecha,
                "descripcion": desc,
                "referencia": ref,
                "monto": round(monto, 2),
                "tipo": tipo,
                "saldo": round(saldo_v, 2) if saldo_v is not None else None,
                "fila_origen": i,
                "hash_linea": _hash_linea(fecha, tipo, monto, desc, ref, i),
            }
        )
    return out


def _guardar_pdf_fallido(contenido: bytes, nombre: str, motivo: str) -> str:
    """Guarda PDF que no se pudo parsear para depuración."""
    fallidos = os.path.join(_EXTRACTOS_DIR, "_fallidos")
    try:
        os.makedirs(fallidos, exist_ok=True)
        safe = re.sub(r"[^\w.\-]+", "_", (nombre or "extracto")[:80]) or "extracto"
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"{ts}_{safe}"
        path = os.path.join(fallidos, fname)
        with open(path, "wb") as f:
            f.write(contenido)
        meta = os.path.join(fallidos, f"{ts}_{safe}.txt")
        with open(meta, "w", encoding="utf-8") as f:
            f.write((motivo or "")[:2000])
        return fname
    except OSError:
        return ""


def _es_movimientos_bancolombia(matrix: list[list]) -> bool:
    """¿Es el CSV de «Movimientos» de la Sucursal Virtual de Bancolombia?

    Sin encabezados y por posición, 10 columnas:
    cuenta · sucursal · (vacía) · AAAAMMDD · (vacía) · valor con signo ·
    código de transacción · descripción · 0 · (vacía).

    Es otro archivo distinto del consolidado (`_es_consolidado_bancolombia`):
    aquí la fecha va en la 4ª columna, no en la 1ª, y no trae líneas de SALDO
    contra las cuales verificar. Se reconoce porque TODAS las filas del inicio
    traen fecha de 8 dígitos en esa posición y un valor numérico en la 6ª.
    """
    if not matrix:
        return False
    vistas = 0
    for fila in matrix[:20]:
        if len(fila) < 9:
            return False
        # La 1ª columna es el número de cuenta («428-000009-74»): un CSV con
        # encabezados trae ahí un rótulo y se descarta en la primera fila.
        cuenta = str(fila[0]).strip()
        if not cuenta or not any(c.isdigit() for c in cuenta):
            return False
        f = str(fila[3]).strip()
        if len(f) != 8 or not f.isdigit():
            return False
        if not (1900 <= int(f[:4]) <= 2199 and 1 <= int(f[4:6]) <= 12 and 1 <= int(f[6:]) <= 31):
            return False
        try:
            float(str(fila[5]).strip())
        except ValueError:
            return False
        vistas += 1
    # Basta una fila válida: los chequeos de arriba son específicos de este
    # archivo, y un rango de un solo día también se baja y se carga.
    return vistas >= 1


def _parse_movimientos_bancolombia(matrix: list[list]) -> list[dict[str, Any]]:
    """Movimientos del CSV de Sucursal Virtual.

    El signo del valor es el que manda: negativo = salió plata (débito),
    positivo = entró (crédito). El código de transacción (4065 llave, 8162 pago
    a proveedor, 3339 GMF…) se guarda como referencia: es lo único estable que
    trae el archivo para reconocer la clase de movimiento cuando la descripción
    viene truncada a 30 caracteres.

    A diferencia del consolidado, este archivo NO trae saldos, así que no hay
    contra qué verificar lo leído; por eso se es estricto al reconocerlo.
    """
    movs: list[dict[str, Any]] = []
    for n_fila, fila in enumerate(matrix, start=1):
        if len(fila) < 9:
            continue
        f = str(fila[3]).strip()
        if len(f) != 8 or not f.isdigit():
            continue
        fecha = f"{f[:4]}-{f[4:6]}-{f[6:]}"
        try:
            valor = float(str(fila[5]).strip())
        except ValueError:
            continue
        monto = round(abs(valor), 2)
        if monto < 0.01:
            continue
        desc = str(fila[7]).strip()[:220] or "(sin descripción)"
        ref = str(fila[6]).strip()[:80]
        tipo = "debito" if valor < 0 else "credito"
        movs.append({
            "fecha": fecha,
            "descripcion": desc,
            "referencia": ref,
            "monto": monto,
            "tipo": tipo,
            "saldo": None,
            "fila_origen": n_fila,
            "hash_linea": _hash_linea(fecha, tipo, monto, desc, ref, n_fila),
        })
    return movs


def _es_consolidado_bancolombia(matrix: list[list]) -> bool:
    """¿Es el CSV consolidado de Bancolombia, sin encabezados y por posición?

    Forma: fecha AAAAMMDD · cuenta · secuencia · … · código · descripción · … ·
    monto · … · C/D. Se reconoce porque la primera columna es una fecha de 8
    dígitos y entre las descripciones aparecen las líneas de saldo, que ningún
    otro formato trae.
    """
    if not matrix:
        return False
    fechas_ok = descripciones = 0
    for fila in matrix[:20]:
        if len(fila) < 11:
            continue
        f = str(fila[0]).strip()
        if len(f) == 8 and f.isdigit():
            fechas_ok += 1
        if "SALDO" in str(fila[6]).upper():
            descripciones += 1
    return fechas_ok >= 5 and descripciones >= 1


def _parse_consolidado_bancolombia(matrix: list[list]) -> list[dict[str, Any]]:
    """Movimientos del consolidado, verificados contra los SALDO DIA del archivo.

    Esa verificación es el motivo de existir de este parser. El mismo agosto de
    2026 se había cargado antes desde el PDF del banco y quedó con 150
    movimientos en vez de 162, con fechas corridas un día y montos alterados —
    y nadie se enteró hasta que aparecieron 21 asientos contra líneas que en el
    banco no existían. El consolidado trae el saldo de cada día, así que se
    puede comprobar que lo leído reproduce exactamente lo que el banco dice:
    si no cuadra, es mejor fallar que importar datos que parecen buenos.
    """
    movs: list[dict[str, Any]] = []
    saldos: dict[str, float] = {}
    saldo_inicial = None

    for n_fila, fila in enumerate(matrix, start=1):
        if len(fila) < 11:
            continue
        f = str(fila[0]).strip()
        if len(f) != 8 or not f.isdigit():
            continue
        fecha = f"{f[:4]}-{f[4:6]}-{f[6:]}"
        desc = str(fila[6]).strip()
        try:
            monto = float(str(fila[8]).strip())
        except ValueError:
            continue
        if desc.upper().startswith("SALDO INICIAL"):
            saldo_inicial = monto
            continue
        if desc.upper().startswith("SALDO"):
            saldos[fecha] = monto
            continue
        ref = str(fila[5]).strip()
        tipo = "debito" if str(fila[10]).strip().upper() == "D" else "credito"
        movs.append({
            "fecha": fecha,
            "descripcion": desc,
            "referencia": ref,
            "monto": abs(monto),
            "tipo": tipo,
            "saldo": None,
            "fila_origen": n_fila,
            "hash_linea": _hash_linea(fecha, tipo, abs(monto), desc, ref, n_fila),
        })

    if saldo_inicial is not None and saldos:
        corriente = saldo_inicial
        for fecha in sorted({m["fecha"] for m in movs}):
            for m in movs:
                if m["fecha"] == fecha:
                    corriente += -m["monto"] if m["tipo"] == "debito" else m["monto"]
            esperado = saldos.get(fecha)
            # El último día puede no traer saldo (archivo generado a mitad del día).
            if esperado is not None and abs(corriente - esperado) > 0.01:
                raise ValueError(
                    f"El archivo no cuadra con sus propios saldos: al {fecha} "
                    f"los movimientos dan {corriente:,.2f} y el banco dice {esperado:,.2f}. "
                    "No se importa: los datos leídos no reproducen el extracto."
                )
    return movs


def _desempacar_zip(contenido: bytes, nombre: str) -> tuple[bytes, str]:
    """Sucursal Negocios entrega los movimientos dentro de un .zip.

    Pedirle a alguien que descomprima antes de arrastrar es un paso que se
    olvida y que además deja dos copias del mismo archivo dando vueltas. Si el
    zip trae un solo archivo de datos, se usa ese; si trae varios, se falla
    diciendo cuáles, porque elegir uno a la suerte sería peor.
    """
    with zipfile.ZipFile(io.BytesIO(contenido)) as z:
        candidatos = [
            i for i in z.infolist()
            if not i.is_dir()
            and not i.filename.startswith("__MACOSX/")
            and i.filename.lower().endswith((".csv", ".txt", ".tsv", ".xlsx", ".xlsm", ".pdf"))
        ]
        if not candidatos:
            raise ValueError("El .zip no trae ningún CSV, Excel ni PDF de extracto")
        if len(candidatos) > 1:
            cuales = ", ".join(sorted(c.filename for c in candidatos))
            raise ValueError(
                f"El .zip trae {len(candidatos)} archivos ({cuales}). "
                "Descomprímelo y sube el que corresponde."
            )
        return z.read(candidatos[0]), candidatos[0].filename


def parse_extracto_bytes(contenido: bytes, nombre: str) -> list[dict[str, Any]]:
    """Parsea CSV, XLSX, PDF o un .zip que contenga uno de esos."""
    if contenido[:2] == b"PK" and (nombre or "").lower().endswith(".zip"):
        contenido, nombre = _desempacar_zip(contenido, nombre)
    name = (nombre or "").lower()
    if name.endswith(".pdf") or (contenido[:4] == b"%PDF"):
        try:
            return _parse_pdf_extracto(contenido)
        except ValueError as e:
            _guardar_pdf_fallido(contenido, nombre, str(e))
            raise

    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
        except ImportError as e:
            raise ValueError("openpyxl no disponible para leer Excel") from e
        wb = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        ws = wb.active
        matrix = [list(row) for row in ws.iter_rows(values_only=True)]
        wb.close()
        return _rows_from_matrix(matrix)

    # CSV / TSV / texto
    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            text = contenido.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("No se pudo decodificar el archivo (UTF-8 / Latin-1)")

    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = ";" if sample.count(";") >= sample.count(",") else ","

    reader = csv.reader(io.StringIO(text), delimiter=delim)
    matrix = [list(r) for r in reader]

    if _es_consolidado_bancolombia(matrix):
        return _parse_consolidado_bancolombia(matrix)
    if _es_movimientos_bancolombia(matrix):
        return _parse_movimientos_bancolombia(matrix)
    return _rows_from_matrix(matrix)


def _guardar_archivo(contenido: bytes, nombre: str) -> str:
    os.makedirs(_EXTRACTOS_DIR, exist_ok=True)
    safe = re.sub(r"[^\w.\-]+", "_", (nombre or "extracto")[:80]) or "extracto"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"{ts}_{safe}"
    path = os.path.join(_EXTRACTOS_DIR, fname)
    with open(path, "wb") as f:
        f.write(contenido)
    return fname


def _clave_conciliacion(fecha: str, tipo: str, monto: float, orden: int) -> tuple:
    """Identidad de una línea del banco, estable entre descargas.

    El banco no da un identificador propio de movimiento, y la descripción
    cambia según de dónde se saque (el PDF trae «Pago A Proveedores», el CSV de
    movimientos «PAGO A PROVE MARCOS FIDEL RO»). Lo único que siempre coincide
    es fecha + dirección + monto; `orden` desempata los movimientos realmente
    repetidos del mismo día (dos giros de $2.500.000 el 21-sep son dos pagos
    distintos, y ambos deben quedar).
    """
    return (fecha, tipo, round(float(monto or 0), 2), orden)


def _con_orden(lineas: list[dict[str, Any]]) -> list[tuple[tuple, dict[str, Any]]]:
    """Empareja cada línea con su clave, numerando los repetidos del mismo día."""
    vistas: dict[tuple, int] = {}
    salida = []
    for ln in lineas:
        base = (ln["fecha"], ln["tipo"], round(float(ln["monto"] or 0), 2))
        vistas[base] = vistas.get(base, 0) + 1
        salida.append((_clave_conciliacion(*base, vistas[base]), ln))
    return salida


def _claves_ya_cargadas(
    desde: str, hasta: str, tercero_id: int | None
) -> dict[tuple, tuple]:
    """Líneas del mismo titular ya guardadas en el rango: clave → (id, desc, ref)."""
    w_tit, p_tit = _filtro_titular(tercero_id)
    with _conn() as con:
        rows = con.execute(
            f"""SELECT m.fecha, m.tipo, m.monto, m.id, m.descripcion, m.referencia
                  FROM extracto_movimientos m
                  JOIN extractos_bancarios e ON e.id = m.extracto_id
                 WHERE {w_tit} AND m.fecha BETWEEN ? AND ?
                 ORDER BY m.fecha, m.id""",
            (*p_tit, desde, hasta),
        ).fetchall()
    previas = [
        {"fecha": r[0], "tipo": r[1], "monto": r[2], "_id": r[3],
         "_desc": r[4], "_ref": r[5]}
        for r in rows
    ]
    return {
        k: (p["_id"], p["_desc"], p["_ref"]) for k, p in _con_orden(previas)
    }

def _mejorar_descripcion(clave_a_id: dict, clave: tuple, ln: dict[str, Any]) -> bool:
    """La misma línea, bajada de una fuente mejor, mejora la que ya estaba.

    El PDF del banco entrega «Pago A Proveedores» a secas; el CSV de
    movimientos, «PAGO A PROVE CYNTHIA ALEXAND». Es el mismo movimiento —por
    eso se descartó como repetido— pero una descripción sirve para clasificar
    y la otra no, así que la repetida no se tira: se usa para completar.
    """
    fila = clave_a_id.get(clave)
    if not fila:
        return False
    mov_id, desc_vieja, ref_vieja = fila
    desc_nueva = (ln.get("descripcion") or "").strip()
    ref_nueva = (ln.get("referencia") or "").strip()
    mejor_desc = len(desc_nueva) > len((desc_vieja or "").strip())
    mejor_ref = bool(ref_nueva) and not (ref_vieja or "").strip()
    if not (mejor_desc or mejor_ref):
        return False
    with _conn() as con:
        con.execute(
            "UPDATE extracto_movimientos SET descripcion = ?, referencia = ? WHERE id = ?",
            (
                desc_nueva if mejor_desc else desc_vieja,
                ref_nueva if mejor_ref else ref_vieja,
                mov_id,
            ),
        )
    return True


def importar_extracto(
    contenido: bytes,
    nombre_archivo: str,
    *,
    banco: str = "",
    cuenta: str = "",
    notas: str = "",
    nombre: str = "",
    tercero_id: int | None = None,
    fusionar: bool = True,
) -> dict[str, Any]:
    """Guarda un extracto. Con `fusionar` (por defecto) descarta las líneas que
    ya estaban cargadas para ese titular.

    La conciliación no se hace una vez al mes: se baja el archivo de Sucursal
    Negocios (Reportes y archivos → Saldos consolidados → Movimientos) desde el
    1 del mes hasta hoy, varias veces al mes. Sin esto, cada descarga volvía a
    insertar los días ya cargados y el banco aparecía con el doble de
    movimientos, cada copia pidiendo su propio asiento.
    """
    ensure_extracto_tables()
    lineas = parse_extracto_bytes(contenido, nombre_archivo)
    if not lineas:
        raise ValueError("El archivo no tiene movimientos reconocibles")

    fechas = sorted(l["fecha"] for l in lineas)
    periodo_desde, periodo_hasta = fechas[0], fechas[-1]
    leidas = len(lineas)
    repetidas = 0
    mejoradas = 0
    if fusionar:
        ya = _claves_ya_cargadas(periodo_desde, periodo_hasta, tercero_id)
        nuevas = []
        for clave, ln in _con_orden(lineas):
            if clave in ya:
                repetidas += 1
                if _mejorar_descripcion(ya, clave, ln):
                    mejoradas += 1
            else:
                nuevas.append(ln)
        lineas = nuevas
        if not lineas:
            extra = (
                f" Se mejoró la descripción de {mejoradas}."
                if mejoradas
                else ""
            )
            raise ValueError(
                f"Nada nuevo que cargar: las {leidas} líneas de este archivo "
                f"({periodo_desde} → {periodo_hasta}) ya están en el libro." + extra
            )

    archivo_path = _guardar_archivo(contenido, nombre_archivo)
    nombre_l = (nombre or "").strip()[:120]
    if not nombre_l:
        bits = [
            (banco or "").strip(),
            f"{periodo_desde}→{periodo_hasta}" if periodo_desde else "",
        ]
        nombre_l = " · ".join(b for b in bits if b) or (nombre_archivo or "Extracto")[:120]

    with _conn() as con:
        cur = con.execute(
            """INSERT INTO extractos_bancarios
                 (banco, cuenta, periodo_desde, periodo_hasta,
                  archivo_nombre, archivo_path, notas, lineas_count, nombre, tercero_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                (banco or "").strip()[:80],
                (cuenta or "").strip()[:40],
                periodo_desde,
                periodo_hasta,
                (nombre_archivo or "")[:160],
                archivo_path,
                (notas or "").strip()[:400],
                len(lineas),
                nombre_l,
                int(tercero_id) if tercero_id else None,
            ),
        )
        extracto_id = int(cur.lastrowid)
        insertadas = 0
        for ln in lineas:
            try:
                con.execute(
                    """INSERT INTO extracto_movimientos
                         (extracto_id, fecha, descripcion, referencia,
                          monto, tipo, saldo, fila_origen, hash_linea)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        extracto_id,
                        ln["fecha"],
                        ln["descripcion"],
                        ln["referencia"],
                        ln["monto"],
                        ln["tipo"],
                        ln["saldo"],
                        ln["fila_origen"],
                        ln["hash_linea"],
                    ),
                )
                insertadas += 1
            except Exception:
                # duplicado hash dentro del mismo extracto
                continue
        con.execute(
            "UPDATE extractos_bancarios SET lineas_count = ? WHERE id = ?",
            (insertadas, extracto_id),
        )

    base = obtener_extracto(extracto_id) or {
        "id": extracto_id,
        "nombre": nombre_l,
        "lineas_count": insertadas,
        "periodo_desde": periodo_desde,
        "periodo_hasta": periodo_hasta,
    }
    # Para que la pantalla pueda decir «12 nuevas, 98 ya estaban» en vez de
    # dejar creer que se cargó el archivo entero otra vez.
    base["lineas_leidas"] = leidas
    base["lineas_repetidas"] = repetidas
    base["lineas_mejoradas"] = mejoradas
    # El 4x1000 y los intereses de ahorros se causan solos (25-sep-2026): destino
    # sin duda, decenas de líneas de centavos. Solo en el extracto de la EMPRESA:
    # el banco personal de un socio nunca entra al libro de McKenna.
    # `EXTRACTO_CAUSAR_AUTOMATICO=0` lo apaga sin tocar código.
    if tercero_id is None and insertadas and os.getenv("EXTRACTO_CAUSAR_AUTOMATICO", "1").strip() != "0":
        try:
            from app.services.extracto_clasificador import causar_automaticos

            if periodo_desde and periodo_hasta:
                r = causar_automaticos(periodo_desde, periodo_hasta)
                base["causados_automaticos"] = {"n": r["aplicadas"], "monto": r["monto"], "errores": r["errores"]}
        except Exception as e:  # causar no puede tumbar el cargue del extracto
            base["causados_automaticos"] = {"error": str(e)}
    return base


def renombrar_extracto(extracto_id: int, nombre: str) -> dict[str, Any] | None:
    """Actualiza el nombre visible del extracto guardado."""
    nombre_l = (nombre or "").strip()[:120]
    if not nombre_l:
        raise ValueError("Indique un nombre para el extracto")
    ensure_extracto_tables()
    with _conn() as con:
        cur = con.execute(
            "UPDATE extractos_bancarios SET nombre = ? WHERE id = ?",
            (nombre_l, int(extracto_id)),
        )
        if cur.rowcount == 0:
            return None
    return obtener_extracto(int(extracto_id))


def listar_extractos(
    limit: int = 50, *, tercero_id: int | None = None, todos: bool = False
) -> list[dict[str, Any]]:
    """Extractos cargados. Por defecto SOLO los de la empresa; con
    `tercero_id` los personales de ese socio; `todos=True` sin filtro (uso
    administrativo/diagnóstico)."""
    ensure_extracto_tables()
    where, params = ("1=1", []) if todos else _filtro_titular(tercero_id)
    with _conn() as con:
        rows = con.execute(
            f"""SELECT e.*,
                      (SELECT COUNT(*) FROM extracto_movimientos m
                         WHERE m.extracto_id = e.id) AS movs,
                      (SELECT COUNT(*) FROM extracto_vinculos v
                         JOIN extracto_movimientos m ON m.id = v.extracto_mov_id
                        WHERE m.extracto_id = e.id) AS vinculados
               FROM extractos_bancarios e
               WHERE {where}
               ORDER BY e.id DESC
               LIMIT ?""",
            (*params, max(1, min(int(limit), 500))),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        out.append(
            {
                "id": d["id"],
                "created_at": d.get("created_at"),
                "nombre": (d.get("nombre") or "").strip()
                or (d.get("banco") or "")
                or (d.get("archivo_nombre") or f"Extracto #{d['id']}"),
                "banco": d.get("banco") or "",
                "cuenta": d.get("cuenta") or "",
                "periodo_desde": d.get("periodo_desde") or "",
                "periodo_hasta": d.get("periodo_hasta") or "",
                "archivo_nombre": d.get("archivo_nombre") or "",
                "notas": d.get("notas") or "",
                "lineas_count": int(d.get("movs") or d.get("lineas_count") or 0),
                "vinculados": int(d.get("vinculados") or 0),
                "tercero_id": d.get("tercero_id"),
            }
        )
    return out


def consultar_por_concepto(
    concepto: str,
    *,
    extracto_id: int | None = None,
    limit: int = 500,
    tercero_id: int | None = None,
) -> dict[str, Any]:
    """
    Busca líneas de extracto cuyo concepto/descripción/referencia contenga el texto.
    Devuelve coincidencias + sumas (débitos, créditos, neto).
    """
    q = (concepto or "").strip()
    if len(q) < 2:
        raise ValueError("Ingrese al menos 2 caracteres del concepto")

    ensure_extracto_tables()
    like = f"%{q}%"
    lim = max(1, min(int(limit or 500), 2000))
    params: list[Any] = [like, like]
    sql = """
        SELECT m.id, m.extracto_id, m.fecha, m.descripcion, m.referencia,
               m.monto, m.tipo, m.saldo,
               e.banco, e.cuenta, e.archivo_nombre
        FROM extracto_movimientos m
        JOIN extractos_bancarios e ON e.id = m.extracto_id
        WHERE (m.descripcion LIKE ? COLLATE NOCASE
               OR m.referencia LIKE ? COLLATE NOCASE)
    """
    if extracto_id is not None and int(extracto_id) > 0:
        sql += " AND m.extracto_id = ?"
        params.append(int(extracto_id))
    else:
        w, p = _filtro_titular(tercero_id)
        sql += f" AND {w}"
        params.extend(p)
    sql += " ORDER BY m.fecha DESC, m.id DESC LIMIT ?"
    params.append(lim)

    with _conn() as con:
        rows = con.execute(sql, params).fetchall()

    movimientos: list[dict[str, Any]] = []
    suma_debitos = 0.0
    suma_creditos = 0.0
    for r in rows:
        d = dict(r)
        monto = float(d.get("monto") or 0)
        tipo = (d.get("tipo") or "").strip().lower()
        if tipo == "debito":
            suma_debitos += monto
        else:
            suma_creditos += monto
        movimientos.append(
            {
                "id": d["id"],
                "extracto_id": d["extracto_id"],
                "fecha": d.get("fecha") or "",
                "descripcion": d.get("descripcion") or "",
                "referencia": d.get("referencia") or "",
                "monto": round(monto, 2),
                "tipo": tipo or "credito",
                "saldo": d.get("saldo"),
                "banco": d.get("banco") or "",
                "cuenta": d.get("cuenta") or "",
                "archivo_nombre": d.get("archivo_nombre") or "",
            }
        )

    return {
        "concepto": q,
        "extracto_id": int(extracto_id) if extracto_id else None,
        "cantidad": len(movimientos),
        "suma_debitos": round(suma_debitos, 2),
        "suma_creditos": round(suma_creditos, 2),
        "neto": round(suma_creditos - suma_debitos, 2),
        "total_absoluto": round(suma_debitos + suma_creditos, 2),
        "movimientos": movimientos,
    }


def obtener_extracto(extracto_id: int, *, solo_sin_vincular: bool = False) -> dict[str, Any] | None:
    ensure_extracto_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT * FROM extractos_bancarios WHERE id = ?",
            (int(extracto_id),),
        ).fetchone()
        if not row:
            return None
        e = dict(row)
        sql = """
            SELECT m.*, v.id AS vinculo_id, v.movimiento_id, v.notas AS vinculo_notas
            FROM extracto_movimientos m
            LEFT JOIN extracto_vinculos v ON v.extracto_mov_id = m.id
            WHERE m.extracto_id = ?
        """
        if solo_sin_vincular:
            sql += " AND v.id IS NULL"
        sql += " ORDER BY m.fecha DESC, m.id DESC"
        movs = con.execute(sql, (int(extracto_id),)).fetchall()
    movimientos = []
    for m in movs:
        d = dict(m)
        movimientos.append(
            {
                "id": d["id"],
                "fecha": d["fecha"],
                "descripcion": d.get("descripcion") or "",
                "referencia": d.get("referencia") or "",
                "monto": float(d["monto"] or 0),
                "tipo": d["tipo"],
                "saldo": d.get("saldo"),
                "fila_origen": d.get("fila_origen"),
                "vinculo_id": d.get("vinculo_id"),
                "movimiento_id": d.get("movimiento_id") or "",
                "vinculado": bool(d.get("vinculo_id")),
            }
        )
    vinculados = sum(1 for m in movimientos if m["vinculado"])
    return {
        "id": e["id"],
        "created_at": e.get("created_at"),
        "nombre": (e.get("nombre") or "").strip()
        or (e.get("banco") or "")
        or (e.get("archivo_nombre") or f"Extracto #{e['id']}"),
        "banco": e.get("banco") or "",
        "cuenta": e.get("cuenta") or "",
        "periodo_desde": e.get("periodo_desde") or "",
        "periodo_hasta": e.get("periodo_hasta") or "",
        "archivo_nombre": e.get("archivo_nombre") or "",
        "notas": e.get("notas") or "",
        "lineas_count": len(movimientos),
        "vinculados": vinculados,
        "tercero_id": e.get("tercero_id"),
        "movimientos": movimientos,
    }


def pendientes_por_clasificar(
    desde: str | None = None,
    hasta: str | None = None,
    *,
    limit: int = 200,
    tercero_id: int | None = None,
) -> list[dict[str, Any]]:
    """Líneas de banco (de cualquier extracto cargado) sin ningún vínculo, en un
    rango de fechas — la bandeja "Pendientes por clasificar" de Ingresos/Egresos.

    A diferencia de `obtener_extracto(..., solo_sin_vincular=True)` (un solo
    extracto), esto cruza todos los extractos del rango — es la vista que
    responde "¿estamos contabilizando todos los movimientos del banco?"."""
    ensure_extracto_tables()
    w_tit, p_tit = _filtro_titular(tercero_id)
    where = ["v.id IS NULL", w_tit]
    params: list[Any] = list(p_tit)
    if desde:
        where.append("m.fecha >= ?")
        params.append(desde)
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    sql = f"""
        SELECT m.*, e.banco, e.cuenta, e.nombre AS extracto_nombre, e.archivo_nombre,
               e.id AS extracto_id
        FROM extracto_movimientos m
        JOIN extractos_bancarios e ON e.id = m.extracto_id
        LEFT JOIN extracto_vinculos v ON v.extracto_mov_id = m.id
        WHERE {" AND ".join(where)}
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT ?
    """
    params.append(max(1, min(int(limit), 1000)))
    with _conn() as con:
        rows = con.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        out.append(
            {
                "id": d["id"],
                "extracto_id": d["extracto_id"],
                "extracto_nombre": (d.get("extracto_nombre") or "").strip()
                or (d.get("banco") or "")
                or (d.get("archivo_nombre") or f"Extracto #{d['extracto_id']}"),
                "fecha": d["fecha"],
                "descripcion": d.get("descripcion") or "",
                "referencia": d.get("referencia") or "",
                "monto": float(d["monto"] or 0),
                "tipo": d["tipo"],
                "banco": d.get("banco") or "",
                "cuenta": d.get("cuenta") or "",
            }
        )
    return out


def ruta_archivo_extracto(extracto_id: int) -> dict[str, Any] | None:
    """Ubica en disco el archivo original subido para un extracto (para verlo/descargarlo).

    Retorna ``{"path", "nombre_descarga"}`` o ``None`` si el extracto no existe
    o el archivo ya no está en disco (p. ej. borrado a mano fuera del panel).
    """
    ensure_extracto_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT archivo_path, archivo_nombre FROM extractos_bancarios WHERE id = ?",
            (int(extracto_id),),
        ).fetchone()
    if not row:
        return None
    stored = (row["archivo_path"] or "").strip()
    if not stored:
        return None
    full = os.path.join(_EXTRACTOS_DIR, os.path.basename(stored))
    if not os.path.isfile(full):
        return None
    return {
        "path": full,
        "nombre_descarga": (row["archivo_nombre"] or "").strip() or os.path.basename(full),
    }


def eliminar_extracto(extracto_id: int) -> bool:
    ensure_extracto_tables()
    with _conn() as con:
        row = con.execute(
            "SELECT archivo_path FROM extractos_bancarios WHERE id = ?",
            (int(extracto_id),),
        ).fetchone()
        if not row:
            return False
        path = (row["archivo_path"] or "").strip()
        con.execute("DELETE FROM extractos_bancarios WHERE id = ?", (int(extracto_id),))
    if path:
        full = os.path.join(_EXTRACTOS_DIR, os.path.basename(path))
        try:
            if os.path.isfile(full):
                os.remove(full)
        except OSError:
            pass
    return True


def saldo_bancario_mas_reciente() -> dict[str, Any] | None:
    """
    Último saldo conocido para "dinero en cuenta": del extracto más reciente
    (por periodo_hasta, luego created_at), la línea con `saldo` no nulo de
    fecha más reciente. None si no hay ningún extracto cargado o ninguna línea
    trae saldo (algunos CSV/Excel no exponen columna de saldo corrido).

    No hay saldo bancario en vivo en el sistema (ver app/services/contabilidad_core.py,
    Libro Mayor propio, aún sin rutas conectadas) — este es el proxy real más
    cercano hoy: tan fresco como el último extracto subido manualmente.
    """
    ensure_extracto_tables()
    with _conn() as con:
        extracto = con.execute(
            """SELECT * FROM extractos_bancarios
               WHERE tercero_id IS NULL
               ORDER BY periodo_hasta DESC, created_at DESC, id DESC
               LIMIT 1"""
        ).fetchone()
        if not extracto:
            return None
        e = dict(extracto)
        mov = con.execute(
            """SELECT fecha, saldo FROM extracto_movimientos
               WHERE extracto_id = ? AND saldo IS NOT NULL
               ORDER BY fecha DESC, id DESC
               LIMIT 1""",
            (e["id"],),
        ).fetchone()
        if not mov:
            return None
        m = dict(mov)
    return {
        "saldo": float(m["saldo"]),
        "fecha": m["fecha"],
        "banco": e.get("banco") or "",
        "cuenta": e.get("cuenta") or "",
        "extracto_id": e["id"],
        "extracto_nombre": (e.get("nombre") or "").strip()
        or (e.get("banco") or "")
        or (e.get("archivo_nombre") or f"Extracto #{e['id']}"),
    }


def vincular(extracto_mov_id: int, movimiento_id: str, notas: str = "") -> dict[str, Any]:
    ensure_extracto_tables()
    mid = (movimiento_id or "").strip()
    if not mid:
        raise ValueError("movimiento_id requerido")
    with _conn() as con:
        mov = con.execute(
            "SELECT id FROM extracto_movimientos WHERE id = ?",
            (int(extracto_mov_id),),
        ).fetchone()
        if not mov:
            raise ValueError("Línea de extracto no encontrada")
        # Liberar vínculos previos de cualquiera de los dos lados
        con.execute(
            "DELETE FROM extracto_vinculos WHERE extracto_mov_id = ? OR movimiento_id = ?",
            (int(extracto_mov_id), mid),
        )
        cur = con.execute(
            """INSERT INTO extracto_vinculos (extracto_mov_id, movimiento_id, notas)
               VALUES (?, ?, ?)""",
            (int(extracto_mov_id), mid, (notas or "").strip()[:200]),
        )
        vid = int(cur.lastrowid)
        row = con.execute(
            "SELECT * FROM extracto_vinculos WHERE id = ?", (vid,)
        ).fetchone()
    return dict(row) if row else {"id": vid, "extracto_mov_id": extracto_mov_id, "movimiento_id": mid}


def vincular_lote(pares: list[dict[str, Any]]) -> dict[str, Any]:
    """Aplica vincular() para varios pares {extracto_mov_id, movimiento_id} de una vez.

    Usado por el auto-match del panel: cada par se procesa por separado para que un
    par inválido (línea ya vinculada por otro, id mal formado) no tumbe el resto.
    """
    ok = 0
    errores: list[dict[str, Any]] = []
    for par in pares:
        try:
            mov_id = str(par.get("movimiento_id") or "")
            ext_mov_id = int(par.get("extracto_mov_id") or 0)
            if not mov_id or not ext_mov_id:
                raise ValueError("par incompleto")
            vincular(ext_mov_id, mov_id)
            ok += 1
        except Exception as e:
            errores.append(
                {
                    "movimiento_id": par.get("movimiento_id"),
                    "extracto_mov_id": par.get("extracto_mov_id"),
                    "error": str(e),
                }
            )
    return {"vinculados": ok, "errores": errores}


def desvincular(*, vinculo_id: int | None = None, movimiento_id: str | None = None) -> bool:
    ensure_extracto_tables()
    with _conn() as con:
        if vinculo_id:
            cur = con.execute(
                "DELETE FROM extracto_vinculos WHERE id = ?", (int(vinculo_id),)
            )
            return cur.rowcount > 0
        mid = (movimiento_id or "").strip()
        if not mid:
            return False
        cur = con.execute(
            "DELETE FROM extracto_vinculos WHERE movimiento_id = ?", (mid,)
        )
        return cur.rowcount > 0


def mapa_vinculos_por_movimiento(movimiento_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Para enriquecer el libro: movimiento_id → datos del extracto."""
    ensure_extracto_tables()
    ids = [m for m in movimiento_ids if m]
    if not ids:
        return {}
    placeholders = ",".join("?" * len(ids))
    with _conn() as con:
        rows = con.execute(
            f"""SELECT v.id AS vinculo_id, v.movimiento_id, v.notas,
                       m.id AS extracto_mov_id, m.fecha AS extracto_fecha,
                       m.descripcion AS extracto_descripcion, m.monto AS extracto_monto,
                       m.tipo AS extracto_tipo, m.referencia AS extracto_referencia,
                       e.id AS extracto_id, e.banco, e.cuenta, e.archivo_nombre
                FROM extracto_vinculos v
                JOIN extracto_movimientos m ON m.id = v.extracto_mov_id
                JOIN extractos_bancarios e ON e.id = m.extracto_id
                WHERE v.movimiento_id IN ({placeholders})""",
            ids,
        ).fetchall()
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = dict(r)
        out[str(d["movimiento_id"])] = {
            "vinculo_id": d["vinculo_id"],
            "extracto_id": d["extracto_id"],
            "extracto_mov_id": d["extracto_mov_id"],
            "fecha": d.get("extracto_fecha") or "",
            "descripcion": d.get("extracto_descripcion") or "",
            "monto": float(d.get("extracto_monto") or 0),
            "tipo": d.get("extracto_tipo") or "",
            "referencia": d.get("extracto_referencia") or "",
            "banco": d.get("banco") or "",
            "cuenta": d.get("cuenta") or "",
            "archivo_nombre": d.get("archivo_nombre") or "",
            "notas": d.get("notas") or "",
        }
    return out


def candidatos_para_movimiento(
    *,
    fecha: str,
    monto: float,
    tipo_libro: str,
    ventana_dias: int = 7,
    tolerancia: float = 1.0,
    limit: int = 30,
    tercero_id: int | None = None,
) -> list[dict[str, Any]]:
    """Sugiere líneas de extracto sin vincular cerca en fecha/monto/tipo.

    Solo mira extractos del titular indicado (por defecto la empresa): una
    línea del banco personal de un socio nunca es candidata para un asiento
    de McKenna."""
    ensure_extracto_tables()
    f = (fecha or "")[:10]
    if not f:
        return []
    try:
        base = datetime.strptime(f, "%Y-%m-%d")
    except ValueError:
        return []
    desde = (base - timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    hasta = (base + timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    # ingreso libro ↔ crédito banco; egreso ↔ débito
    tipo_banco = "credito" if tipo_libro == "ingreso" else "debito"
    monto = abs(float(monto or 0))
    w_tit, p_tit = _filtro_titular(tercero_id)
    with _conn() as con:
        rows = con.execute(
            f"""SELECT m.*, e.banco, e.cuenta, e.archivo_nombre, e.id AS extracto_id
               FROM extracto_movimientos m
               JOIN extractos_bancarios e ON e.id = m.extracto_id
               LEFT JOIN extracto_vinculos v ON v.extracto_mov_id = m.id
               WHERE v.id IS NULL
                 AND {w_tit}
                 AND m.fecha BETWEEN ? AND ?
                 AND m.tipo = ?
                 AND ABS(m.monto - ?) <= ?
               ORDER BY ABS(julianday(m.fecha) - julianday(?)), ABS(m.monto - ?)
               LIMIT ?""",
            (
                *p_tit,
                desde,
                hasta,
                tipo_banco,
                monto,
                tolerancia,
                f,
                monto,
                max(1, min(int(limit), 100)),
            ),
        ).fetchall()
    return [
        {
            "id": dict(r)["id"],
            "extracto_id": dict(r)["extracto_id"],
            "fecha": dict(r)["fecha"],
            "descripcion": dict(r).get("descripcion") or "",
            "referencia": dict(r).get("referencia") or "",
            "monto": float(dict(r)["monto"] or 0),
            "tipo": dict(r)["tipo"],
            "banco": dict(r).get("banco") or "",
            "cuenta": dict(r).get("cuenta") or "",
            "archivo_nombre": dict(r).get("archivo_nombre") or "",
        }
        for r in rows
    ]


def sugerencias_auto(
    movimientos_libro: list[dict[str, Any]],
    *,
    ventana_dias: int = 7,
    tolerancia: float = 0.5,
) -> list[dict[str, Any]]:
    """Empareja 1:1 libro↔extracto por monto+fecha (sin tocar DB).

    `ventana_dias=7` (antes 2): en datos reales, servicios/impuestos/cuentas de cobro y
    pagos a proveedores suelen registrarse en el libro 2-3 días antes o después del débito
    real en el banco (fecha de factura/registro vs. fecha de pago). Con 2 días se perdían
    la mayoría de esos casos aun con el monto exacto. 7 días no introdujo falsos positivos
    en pruebas contra datos reales (jul-ago 2026): cada candidato encontrado era único para
    ese monto en la ventana. Cuando SÍ hay más de un candidato al mismo monto, la sugerencia
    se marca `ambiguo=True` para que el operador la revise antes de confirmarla.
    """
    ensure_extracto_tables()
    if not movimientos_libro:
        return []
    usados_banco: set[int] = set()
    sugerencias: list[dict[str, Any]] = []
    for mov in movimientos_libro:
        mid = mov.get("id") or id_movimiento_ledger(mov)
        if mov.get("extracto"):
            continue
        cands = candidatos_para_movimiento(
            fecha=str(mov.get("fecha") or ""),
            monto=float(mov.get("monto") or 0),
            tipo_libro=str(mov.get("tipo") or ""),
            ventana_dias=ventana_dias,
            tolerancia=tolerancia,
            limit=5,
        )
        disponibles = [c for c in cands if c["id"] not in usados_banco]
        if not disponibles:
            continue
        elegido = disponibles[0]
        usados_banco.add(elegido["id"])
        sugerencias.append(
            {
                "movimiento_id": mid,
                "extracto_mov_id": elegido["id"],
                "libro": {
                    "fecha": mov.get("fecha"),
                    "tipo": mov.get("tipo"),
                    "concepto": mov.get("concepto"),
                    "monto": mov.get("monto"),
                    "fuente": mov.get("fuente"),
                },
                "extracto": elegido,
                "ambiguo": len(disponibles) > 1,
            }
        )
    return sugerencias


# ── Titulares distintos de la empresa (socios) ──────────────────────────────


def cobertura_mensual(tercero_id: int | None) -> dict[str, Any]:
    """Qué meses cubren los extractos de un titular, por cuenta bancaria.

    Devuelve ``{"cuentas": [{"banco", "cuenta", "meses": ["2025-01", ...],
    "desde", "hasta", "extractos": n, "lineas": n}], "anios": {2025: {"meses_con": 12,
    "faltan": []}}}``. Es la base del paso «Extractos» del wizard de socios:
    muestra los huecos (meses sin extracto) en vez de dejar que el usuario
    los descubra al declarar. Un mes cuenta como cubierto si al menos una
    línea de esa cuenta cae en él."""
    ensure_extracto_tables()
    w, p = _filtro_titular(tercero_id)
    with _conn() as con:
        rows = con.execute(
            f"""SELECT e.banco, e.cuenta, substr(m.fecha, 1, 7) AS mes,
                       COUNT(*) AS n, COUNT(DISTINCT e.id) AS n_ext
                FROM extracto_movimientos m
                JOIN extractos_bancarios e ON e.id = m.extracto_id
                WHERE {w}
                GROUP BY e.banco, e.cuenta, mes
                ORDER BY e.banco, e.cuenta, mes""",
            p,
        ).fetchall()
    cuentas: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        d = dict(r)
        key = ((d.get("banco") or "").strip(), (d.get("cuenta") or "").strip())
        c = cuentas.setdefault(
            key,
            {"banco": key[0], "cuenta": key[1], "meses": [], "lineas": 0, "extractos": 0},
        )
        if d["mes"]:
            c["meses"].append(d["mes"])
        c["lineas"] += int(d["n"] or 0)
        c["extractos"] = max(c["extractos"], int(d["n_ext"] or 0))
    out_cuentas = []
    anios: dict[int, set[str]] = {}
    for c in cuentas.values():
        meses = sorted(set(c["meses"]))
        c["meses"] = meses
        c["desde"] = meses[0] if meses else ""
        c["hasta"] = meses[-1] if meses else ""
        for m in meses:
            try:
                anios.setdefault(int(m[:4]), set()).add(m)
            except ValueError:
                continue
        out_cuentas.append(c)
    resumen_anios: dict[str, Any] = {}
    for anio, meses in sorted(anios.items()):
        todos = {f"{anio}-{i:02d}" for i in range(1, 13)}
        faltan = sorted(todos - meses)
        resumen_anios[str(anio)] = {"meses_con": len(meses), "faltan": faltan}
    return {"cuentas": out_cuentas, "anios": resumen_anios}


def lineas_por_titular(
    tercero_id: int | None,
    *,
    desde: str | None = None,
    hasta: str | None = None,
    tipo: str | None = None,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """Todas las líneas de extracto de un titular en un rango (sin importar
    de qué extracto vienen). Lo usa `declarador.cruces_socio_empresa` para
    cruzar el banco personal del socio contra los asientos de McKenna."""
    ensure_extracto_tables()
    w, p = _filtro_titular(tercero_id)
    where = [w]
    params: list[Any] = list(p)
    if desde:
        where.append("m.fecha >= ?")
        params.append(desde)
    if hasta:
        where.append("m.fecha <= ?")
        params.append(hasta)
    if tipo in ("debito", "credito"):
        where.append("m.tipo = ?")
        params.append(tipo)
    params.append(max(1, min(int(limit), 20000)))
    with _conn() as con:
        rows = con.execute(
            f"""SELECT m.id, m.extracto_id, m.fecha, m.descripcion, m.referencia,
                       m.monto, m.tipo, m.saldo, e.banco, e.cuenta
                FROM extracto_movimientos m
                JOIN extractos_bancarios e ON e.id = m.extracto_id
                WHERE {" AND ".join(where)}
                ORDER BY m.fecha, m.id
                LIMIT ?""",
            params,
        ).fetchall()
    return [
        {
            "id": r["id"],
            "extracto_id": r["extracto_id"],
            "fecha": r["fecha"],
            "descripcion": r["descripcion"] or "",
            "referencia": r["referencia"] or "",
            "monto": float(r["monto"] or 0),
            "tipo": r["tipo"],
            "saldo": r["saldo"],
            "banco": r["banco"] or "",
            "cuenta": r["cuenta"] or "",
        }
        for r in rows
    ]
