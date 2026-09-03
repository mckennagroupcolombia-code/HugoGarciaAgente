"""
Cuenta de cobro por compras en el exterior.

Liquidación: valor de la mercancía (COP) + cuota de manejo (5 %).
El PDF solo se genera al aprobar en el panel. El color de acento es el del tema
guardado del emisor (preferencias_ui); si no tiene, el accent_rgb del request.
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

CUOTA_PCT_DEFAULT = 5.0

# Totales de factura por debajo de este umbral, etiquetados como COP, son
# casi siempre USD (p. ej. $532). Un pedido real en pesos de laboratorio
# queda muy por encima. La cuenta de cobro siempre se liquida en COP.
UMBRAL_NETO_ORIGEN_COP = 50_000.0

_CARPETA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "cuentas_cobro_cuota_manejo",
)

# Fallback si no llega acento del tema
_ACCENT_DEFAULT = colors.HexColor("#0c6069")
_INK = colors.HexColor("#0f172a")
_MUTED = colors.HexColor("#64748b")


def _asegurar_carpeta_pdfs() -> None:
    """Crea la carpeta de PDFs con permisos amplios (agente suele correr como nobody)."""
    os.makedirs(_CARPETA, exist_ok=True)
    try:
        os.chmod(_CARPETA, 0o777)
    except OSError:
        pass


def _guardar_pdf(doc: SimpleDocTemplate, story: list, full: str) -> None:
    """Escribe a temporal y reemplaza, para no chocar con permisos de un PDF viejo."""
    import tempfile

    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=_CARPETA)
    os.close(fd)
    try:
        doc.filename = tmp
        doc.build(story)
        os.replace(tmp, full)
        try:
            os.chmod(full, 0o666)
        except OSError:
            pass
    except Exception:
        try:
            if os.path.isfile(tmp):
                os.unlink(tmp)
        except OSError:
            pass
        raise


def cuota_pct() -> float:
    raw = (os.getenv("CUOTA_MANEJO_PCT") or "").strip()
    if not raw:
        return CUOTA_PCT_DEFAULT
    try:
        v = float(raw.replace(",", "."))
        return v if v > 0 else CUOTA_PCT_DEFAULT
    except ValueError:
        return CUOTA_PCT_DEFAULT


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key) or default).strip()


def parse_emisor_usuario_id(raw) -> int | None:
    """Id de usuario del panel para emitir la cuenta de cobro, o None."""
    if raw in (None, "", 0, "0"):
        return None
    try:
        uid = int(raw)
    except (TypeError, ValueError):
        return None
    return uid if uid > 0 else None


def perfil_emisor_por_id(usuario_id: int | None) -> dict | None:
    """Perfil del panel (nombre, documento, email, tel) para emitir el PDF."""
    uid = parse_emisor_usuario_id(usuario_id)
    if not uid:
        return None
    try:
        from app.services.tickets_db import get_usuario_by_id

        return get_usuario_by_id(uid)
    except Exception:
        return None


def accent_rgb_de_perfil(perfil: dict | None) -> str:
    """Acento RGB del tema guardado del usuario (preferencias_ui.panel.accentRgb)."""
    if not perfil or not isinstance(perfil, dict):
        return ""
    prefs = perfil.get("preferencias_ui")
    if isinstance(prefs, str) and prefs.strip():
        try:
            import json as _json

            prefs = _json.loads(prefs)
        except Exception:
            prefs = None
    if not isinstance(prefs, dict):
        return ""
    panel = prefs.get("panel")
    if not isinstance(panel, dict):
        return ""
    raw = str(panel.get("accentRgb") or panel.get("accent_rgb") or "").strip()
    if not raw:
        return ""
    if raw.startswith("#") and len(raw) >= 7:
        h = raw.lstrip("#")[:6]
        try:
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            return f"{r} {g} {b}"
        except ValueError:
            return ""
    parts = raw.replace(",", " ").split()
    if len(parts) != 3:
        return ""
    try:
        r, g, b = (max(0, min(255, int(float(x)))) for x in parts)
        return f"{r} {g} {b}"
    except ValueError:
        return ""


def resolver_accent_cuenta_cobro(
    accent_rgb: str | None = None,
    *,
    emisor_perfil: dict | None = None,
) -> str:
    """
    Color del PDF. Preferencia:
    1) acento del tema del emisor (preferencias_ui) — p. ej. Armando → su color
    2) accent_rgb del request (fallback / override si el emisor no tiene tema)
    3) McKenna teal
    """
    de_emisor = accent_rgb_de_perfil(emisor_perfil)
    if de_emisor:
        return de_emisor
    enviado = (accent_rgb or "").strip()
    if enviado:
        return enviado
    return "12 96 105"


def listar_emisores_cuenta_cobro() -> list[dict]:
    """Usuarios activos del panel que pueden figurar como emisor de la cuenta."""
    try:
        from app.services.tickets_db import listar_usuarios
    except Exception:
        return []
    out: list[dict] = []
    try:
        usuarios = listar_usuarios() or []
    except Exception:
        return []
    for u in usuarios:
        if not u or not u.get("activo", True):
            continue
        out.append(
            {
                "id": u["id"],
                "nombre": str(u.get("nombre") or u.get("username") or "").strip(),
                "username": str(u.get("username") or "").strip(),
                "documento_identidad": str(u.get("documento_identidad") or "").strip(),
                "email": str(u.get("email") or "").strip(),
                "accent_rgb": accent_rgb_de_perfil(u),
            }
        )
    out.sort(key=lambda x: (x["nombre"] or "").lower())
    return out


def datos_emisor(perfil: dict | None = None) -> dict[str, str]:
    """
    Datos del emisor en la cuenta de cobro.
    Si se pasa ``perfil`` (usuario del panel asignado), nombre/documento/email/tel
    del perfil tienen prioridad sobre las variables de entorno.
    """
    out = {
        "nombre": _env("CUOTA_MANEJO_EMISOR_NOMBRE", "Cynthia Ruiz"),
        "documento": _env("CUOTA_MANEJO_EMISOR_DOC", ""),
        "ciudad": _env("CUOTA_MANEJO_EMISOR_CIUDAD", "Bogotá D.C."),
        "banco": _env("CUOTA_MANEJO_EMISOR_BANCO", ""),
        "tipo_cuenta": _env("CUOTA_MANEJO_EMISOR_TIPO_CUENTA", ""),
        "cuenta": _env("CUOTA_MANEJO_EMISOR_CUENTA", ""),
        "email": _env("CUOTA_MANEJO_EMISOR_EMAIL", ""),
        "telefono": _env("CUOTA_MANEJO_EMISOR_TELEFONO", ""),
    }
    if not perfil:
        return out
    nombre = str(perfil.get("nombre") or "").strip()
    if nombre:
        out["nombre"] = nombre
    doc = str(
        perfil.get("documento_identidad")
        or perfil.get("documento")
        or ""
    ).strip()
    if doc:
        out["documento"] = doc
    email = str(perfil.get("email") or "").strip()
    if email:
        out["email"] = email
    tel = str(perfil.get("telefono") or "").strip()
    if tel:
        out["telefono"] = tel
    return out


def datos_pagador() -> dict[str, str]:
    return {
        "razon": _env("CUOTA_MANEJO_PAGADOR_RAZON", "McKenna Group S.A.S."),
        "nit": _env("CUOTA_MANEJO_PAGADOR_NIT", "901.952.087-1"),
        "ciudad": _env("CUOTA_MANEJO_PAGADOR_CIUDAD", "Bogotá D.C."),
    }


def neto_origen_lineas(lineas: list | None) -> float:
    """Suma neta de mercancía en la moneda de la factura (sin TRM)."""
    total = 0.0
    for ln in lineas or []:
        if not isinstance(ln, dict):
            continue
        try:
            s = float(ln.get("subtotal") or 0)
        except (TypeError, ValueError):
            s = 0.0
        if s <= 0:
            try:
                s = float(ln.get("cantidad") or 0) * float(ln.get("precio_unit") or 0)
            except (TypeError, ValueError):
                s = 0.0
        try:
            desc = float(ln.get("descuento") or 0)
        except (TypeError, ValueError):
            desc = 0.0
        total += max(s - max(desc, 0.0), 0.0)
    return round(total, 4)


def parece_compra_en_divisa(
    moneda: str,
    trm: float = 0.0,
    lineas: list | None = None,
) -> bool:
    """True si la factura está (o debió estar) en USD/divisa, no en COP."""
    mon = (moneda or "USD").strip().upper() or "USD"
    try:
        tasa = float(trm or 0)
    except (TypeError, ValueError):
        tasa = 0.0
    if mon != "COP":
        return True
    if tasa > 1.5:
        return True
    neto = neto_origen_lineas(lineas)
    return 0 < neto < UMBRAL_NETO_ORIGEN_COP


def resolver_tasa_cuenta_cobro(
    *,
    moneda: str,
    trm: float = 0.0,
    fecha_compra: str = "",
    lineas: list | None = None,
    consultar_banrep: bool = True,
) -> dict[str, Any]:
    """
    Tasa para liquidar la cuenta de cobro en COP.

    Compras exterior en dólares (o mal etiquetadas como COP con montos de
    factura en USD) usan la TRM BanRep del día de la compra.
    """
    mon = (moneda or "USD").strip().upper() or "USD"
    try:
        tasa = float(trm or 0)
    except (TypeError, ValueError):
        tasa = 0.0
    fuente = ""
    corregido = False
    aviso = ""
    fecha_trm = (fecha_compra or "").strip()[:10]
    error = None

    if mon == "COP" and not parece_compra_en_divisa(mon, tasa, lineas):
        return {
            "moneda": "COP",
            "trm": 1.0,
            "trm_fuente": "cop",
            "fecha_trm": fecha_trm,
            "corregido": False,
            "aviso": "",
            "error": None,
        }

    if mon == "COP":
        mon = "USD"
        corregido = True
        aviso = (
            "La factura está en dólares; la cuenta de cobro se liquida en "
            "pesos con la TRM del día de la compra"
        )
        if tasa <= 1.5:
            tasa = 0.0

    if mon != "COP" and tasa <= 1.5:
        if not consultar_banrep:
            return {
                "moneda": mon,
                "trm": 0.0,
                "trm_fuente": "",
                "fecha_trm": fecha_trm,
                "corregido": corregido,
                "aviso": aviso,
                "error": "Se requiere la TRM del día de la compra para liquidar en pesos",
            }
        from app.services.trm import normalizar_fecha, obtener_trm

        data = obtener_trm(normalizar_fecha(fecha_compra) if fecha_compra else None)
        if data.get("error"):
            return {
                "moneda": mon,
                "trm": 0.0,
                "trm_fuente": "",
                "fecha_trm": fecha_trm,
                "corregido": corregido,
                "aviso": aviso,
                "error": str(data.get("error") or "No se pudo consultar la TRM BanRep"),
            }
        try:
            tasa = float(data.get("valor") or 0)
        except (TypeError, ValueError):
            tasa = 0.0
        if tasa <= 1.5:
            return {
                "moneda": mon,
                "trm": 0.0,
                "trm_fuente": "",
                "fecha_trm": fecha_trm,
                "corregido": corregido,
                "aviso": aviso,
                "error": "TRM BanRep inválida para liquidar en pesos",
            }
        fuente = "banrep"
        if data.get("fecha"):
            fecha_trm = str(data.get("fecha"))[:10]
        corregido = True
    elif mon != "COP":
        fuente = "banrep" if fecha_compra else "manual"

    return {
        "moneda": mon,
        "trm": round(tasa, 4),
        "trm_fuente": fuente,
        "fecha_trm": fecha_trm,
        "corregido": corregido,
        "aviso": aviso,
        "error": error,
    }


def valor_mercancia_cop(
    *,
    moneda: str,
    trm: float,
    lineas: list | None,
) -> float:
    """Valor de la compra (mercancía neta) en COP. No incluye flete."""
    return round(sum(p["valor_cop"] for p in detalle_productos_cop(moneda=moneda, trm=trm, lineas=lineas)), 2)


def detalle_productos_cop(
    *,
    moneda: str,
    trm: float,
    lineas: list | None,
) -> list[dict[str, Any]]:
    """
    Productos adquiridos con valor neto en COP (uno por línea).
    {nombre, cantidad, unidad, valor_origen, valor_cop}
    """
    mon = (moneda or "USD").strip().upper()
    tasa = float(trm or 0)
    if mon == "COP":
        tasa = 1.0
    elif tasa <= 0:
        return []
    out: list[dict[str, Any]] = []
    for ln in lineas or []:
        if not isinstance(ln, dict):
            continue
        nombre = (ln.get("nombre") or ln.get("nombre_ocr") or "").strip()
        s = float(ln.get("subtotal") or 0)
        desc = float(ln.get("descuento") or 0)
        if s <= 0:
            packs = float(ln.get("cantidad") or 0)
            s = packs * float(ln.get("precio_unit") or 0)
        neto = max(s - max(desc, 0.0), 0.0)
        if neto <= 0:
            continue
        if not nombre:
            nombre = "Producto adquirido"
        cant = ln.get("cantidad")
        try:
            cant_f = float(cant) if cant is not None else None
        except (TypeError, ValueError):
            cant_f = None
        unidad = str(ln.get("unidad") or "").strip()
        out.append(
            {
                "nombre": nombre,
                "codigo": (ln.get("codigo") or "").strip() or None,
                "cantidad": cant_f,
                "unidad": unidad,
                "valor_origen": round(neto, 4),
                "valor_cop": round(neto * tasa, 2),
            }
        )
    return out


def _etiqueta_producto(p: dict[str, Any]) -> str:
    nombre = p.get("nombre") or "Producto"
    bits = [nombre]
    cant = p.get("cantidad")
    unidad = (p.get("unidad") or "").strip()
    if cant is not None and float(cant) > 0:
        c = float(cant)
        c_s = str(int(c)) if c == int(c) else f"{c:g}"
        bits.append(f"{c_s} {unidad}".strip() if unidad else c_s)
    codigo = p.get("codigo")
    if codigo:
        bits.append(f"Ref. {codigo}")
    return " · ".join(bits)


def flete_en_cop(
    *,
    moneda: str,
    trm: float,
    flete: float = 0.0,
    moneda_flete: str = "",
) -> float:
    """Flete convertido a COP (cuenta de cobro aparte)."""
    f = float(flete or 0)
    if f <= 0:
        return 0.0
    mon = (moneda or "USD").strip().upper()
    mf = (moneda_flete or moneda or "USD").strip().upper()
    tasa = float(trm or 0)
    if mon == "COP":
        tasa = 1.0
    if mf == "COP":
        return round(f, 2)
    if tasa <= 0:
        return 0.0
    return round(f * tasa, 2)


def calcular_cuota(
    *,
    moneda: str,
    trm: float,
    lineas: list | None,
    pct: float | None = None,
    flete: float = 0.0,
    moneda_flete: str = "",
) -> dict[str, float]:
    """
    Cuenta mercancía: valor + cuota %.
    Cuenta flete (aparte): flete_cop (mismo dict, no suma al total de mercancía).
    """
    p = float(pct if pct is not None else cuota_pct())
    valor = valor_mercancia_cop(moneda=moneda, trm=trm, lineas=lineas)
    flete_c = flete_en_cop(moneda=moneda, trm=trm, flete=flete, moneda_flete=moneda_flete)
    cuota = round(valor * (p / 100.0))
    total = round(valor + float(cuota), 2)
    return {
        "pct": p,
        "valor_compra_cop": valor,
        "flete_cop": flete_c,
        "cuota_manejo_cop": float(cuota),
        "total_cobro_cop": total,
    }


def accent_to_hex(accent: str | None) -> str:
    """Acepta '12 96 105', 'rgb(12,96,105)' o '#0c6069' → '#rrggbb'."""
    s = (accent or "").strip()
    if not s:
        return "#0c6069"
    if s.startswith("#") and len(s) == 7:
        return s.lower()
    m = re.match(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", s, re.I)
    if m:
        r, g, b = (int(m.group(i)) for i in (1, 2, 3))
        return f"#{r:02x}{g:02x}{b:02x}"
    parts = s.replace(",", " ").split()
    if len(parts) == 3:
        try:
            r, g, b = (max(0, min(255, int(float(x)))) for x in parts)
            return f"#{r:02x}{g:02x}{b:02x}"
        except ValueError:
            pass
    return "#0c6069"


def _fmt_cop(n: float) -> str:
    try:
        v = int(round(float(n)))
    except (TypeError, ValueError):
        v = 0
    return f"$ {v:,}".replace(",", ".")


def _fmt_fecha(iso: str) -> str:
    s = (iso or "").strip()[:10]
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        y, m, d = s.split("-")
        return f"{d}/{m}/{y}"
    return datetime.now().strftime("%d/%m/%Y")


def numero_cuenta_cobro(compra_id: int, *, flete: bool = False) -> str:
    """Número interno mostrado en el PDF (p. ej. CC-CE-00009)."""
    base = f"CC-CE-{int(compra_id):05d}"
    return f"{base}-FLETE" if flete else base


def nombre_archivo_cuenta_cobro(compra_id: int, *, flete: bool = False) -> str:
    """
    Nombre de descarga/archivo:
    'Cuenta de cobro numero 00009 compra en el exterior.pdf'
    (flete: '… numero 00009 flete compra en el exterior.pdf')
    """
    n = f"{int(compra_id):05d}"
    if flete:
        raw = f"Cuenta de cobro numero {n} flete compra en el exterior.pdf"
    else:
        raw = f"Cuenta de cobro numero {n} compra en el exterior.pdf"
    # Caracteres seguros para filesystem / Content-Disposition
    safe = re.sub(r'[\\/:*?"<>|]+', " ", raw)
    safe = re.sub(r"\s+", " ", safe).strip()
    return safe or f"cuenta-cobro-{n}.pdf"


def _etiqueta_pedido_cuenta(
    compra_id: int,
    numero_pedido: str = "",
    *,
    compras_ids: list[int] | None = None,
) -> str:
    """Texto visible: número de compra del documento, o id interno como respaldo."""
    pedido = (numero_pedido or "").strip()
    if pedido:
        return f"Pedido {pedido}"
    if compras_ids:
        return "Pedidos " + ", ".join(f"Nº {int(i)}" for i in compras_ids)
    return f"Pedido Nº {int(compra_id)}"


def generar_pdf_cuenta_cobro(
    *,
    compra_id: int,
    moneda: str,
    trm: float,
    proveedor: str = "",
    fecha_compra: str = "",
    lineas: list | None = None,
    pct: float | None = None,
    flete: float = 0.0,
    moneda_flete: str = "",
    numero: str | None = None,
    accent_rgb: str | None = None,
    emisor_perfil: dict | None = None,
    numero_pedido: str = "",
    output_filename: str | None = None,
) -> dict[str, Any]:
    """
    Genera PDF. Colores del encabezado = acento del tema.
    Siempre liquida en COP; si la factura es USD, aplica TRM del día de compra.
    ``output_filename`` permite escribir un borrador de vista previa sin pisar el PDF aprobado.
    """
    resolved = resolver_tasa_cuenta_cobro(
        moneda=moneda,
        trm=trm,
        fecha_compra=fecha_compra,
        lineas=lineas,
    )
    if resolved.get("error"):
        return {
            "pct": float(pct if pct is not None else cuota_pct()),
            "valor_compra_cop": 0.0,
            "flete_cop": 0.0,
            "cuota_manejo_cop": 0.0,
            "total_cobro_cop": 0.0,
            "numero": "",
            "path": "",
            "filename": "",
            "error": resolved["error"],
        }
    moneda = str(resolved["moneda"])
    trm = float(resolved["trm"])
    calc = calcular_cuota(
        moneda=moneda,
        trm=trm,
        lineas=lineas,
        pct=pct,
        flete=flete,
        moneda_flete=moneda_flete,
    )
    if calc["valor_compra_cop"] <= 0 or calc["total_cobro_cop"] <= 0:
        return {
            **calc,
            "numero": "",
            "path": "",
            "filename": "",
            "error": "Sin valor de compra para calcular cuota",
        }

    accent_hex = accent_to_hex(accent_rgb)
    try:
        accent = colors.HexColor(accent_hex)
    except Exception:
        accent = _ACCENT_DEFAULT
        accent_hex = "#0c6069"

    _asegurar_carpeta_pdfs()
    num = numero or numero_cuenta_cobro(int(compra_id), flete=False)
    filename = (output_filename or "").strip() or nombre_archivo_cuenta_cobro(
        int(compra_id), flete=False
    )
    full = os.path.join(_CARPETA, filename)

    emisor = datos_emisor(emisor_perfil)
    if emisor_perfil is not None and not (emisor.get("documento") or "").strip():
        return {
            **calc,
            "numero": "",
            "path": "",
            "filename": "",
            "error": "Falta documento de identidad del emisor en el perfil",
        }
    pagador = datos_pagador()
    fecha_doc = _fmt_fecha(fecha_compra) if fecha_compra else datetime.now().strftime("%d/%m/%Y")
    mon_u = (moneda or "USD").strip().upper()

    styles = getSampleStyleSheet()
    st = {
        "titulo": ParagraphStyle(
            "cc_titulo",
            parent=styles["Normal"],
            fontSize=16,
            fontName="Helvetica-Bold",
            textColor=accent,
            alignment=TA_CENTER,
        ),
        "h": ParagraphStyle(
            "cc_h",
            parent=styles["Normal"],
            fontSize=10,
            fontName="Helvetica-Bold",
            textColor=accent,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "n": ParagraphStyle(
            "cc_n",
            parent=styles["Normal"],
            fontSize=9,
            fontName="Helvetica",
            textColor=_INK,
            leading=13,
            alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            "cc_small",
            parent=styles["Normal"],
            fontSize=8,
            fontName="Helvetica",
            textColor=_MUTED,
            leading=11,
        ),
        "total": ParagraphStyle(
            "cc_total",
            parent=styles["Normal"],
            fontSize=12,
            fontName="Helvetica-Bold",
            textColor=accent,
            alignment=TA_RIGHT,
        ),
        "center": ParagraphStyle(
            "cc_center",
            parent=styles["Normal"],
            fontSize=9,
            fontName="Helvetica",
            textColor=_INK,
            alignment=TA_CENTER,
            leading=13,
        ),
        "num": ParagraphStyle(
            "cc_num",
            parent=styles["Normal"],
            fontSize=9,
            fontName="Helvetica",
            textColor=_INK,
            leading=13,
        ),
    }

    doc = SimpleDocTemplate(
        full,
        pagesize=letter,
        topMargin=1.5 * cm,
        bottomMargin=2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
    )
    ancho = letter[0] - 4 * cm
    story: list = []

    story.append(Paragraph("<b>CUENTA DE COBRO · MERCANCÍA</b>", st["titulo"]))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.2, color=accent, spaceAfter=8))
    pedido_lbl = _etiqueta_pedido_cuenta(int(compra_id), numero_pedido)
    story.append(
        Paragraph(
            f"<font color='{accent_hex}'><b>Nº {num}</b></font>"
            f" &nbsp;&nbsp;|&nbsp;&nbsp; <b>{pedido_lbl}</b>"
            f" &nbsp;&nbsp;|&nbsp;&nbsp; Fecha: {fecha_doc}",
            st["num"],
        )
    )
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.4, color=accent, spaceAfter=8))

    story.append(Paragraph("EMISOR (quien cobra)", st["h"]))
    emisor_lines = [f"<b>{emisor['nombre'] or '[Nombre del cobrador]'}</b>"]
    if emisor["documento"]:
        emisor_lines.append(f"Documento: {emisor['documento']}")
    if emisor["ciudad"]:
        emisor_lines.append(f"Ciudad: {emisor['ciudad']}")
    if emisor["email"]:
        emisor_lines.append(f"Correo: {emisor['email']}")
    if emisor["telefono"]:
        emisor_lines.append(f"Teléfono: {emisor['telefono']}")
    story.append(Paragraph("<br/>".join(emisor_lines), st["n"]))

    story.append(Paragraph("DIRIGIDA A (pagador)", st["h"]))
    story.append(
        Paragraph(
            f"<b>{pagador['razon']}</b><br/>NIT: {pagador['nit']}<br/>Ciudad: {pagador['ciudad']}",
            st["n"],
        )
    )

    story.append(Paragraph("CONCEPTO", st["h"]))
    prov = (proveedor or "").strip() or "proveedor exterior"
    productos = detalle_productos_cop(moneda=moneda, trm=trm, lineas=lineas)
    if productos:
        nombres = ", ".join(_etiqueta_producto(p) for p in productos[:12])
        if len(productos) > 12:
            nombres += f" y {len(productos) - 12} más"
        trm_txt = (
            f", factura {mon_u}, TRM BanRep {trm:g} del día de la compra. Valores en pesos (COP)"
            if mon_u != "COP" and trm
            else ". Valores en pesos (COP)"
        )
        concepto = (
            f"Adquisición de: {nombres}. "
            f"Incluye cuota de manejo del {calc['pct']:.0f}% sobre el valor de los productos. "
            f"{pedido_lbl} ({prov}"
            + (f", {fecha_compra}" if fecha_compra else "")
            + f"){trm_txt}."
        )
    else:
        trm_txt = (
            f", factura {mon_u}, TRM BanRep {trm:g} del día de la compra. Valores en pesos (COP)"
            if mon_u != "COP" and trm
            else ". Valores en pesos (COP)"
        )
        concepto = (
            f"Adquisición de productos en el exterior y cuota de manejo "
            f"del {calc['pct']:.0f}% sobre su valor. {pedido_lbl} ({prov}"
            + (f", {fecha_compra}" if fecha_compra else "")
            + f"){trm_txt}."
        )
    story.append(Paragraph(concepto, st["n"]))

    story.append(Paragraph("LIQUIDACIÓN", st["h"]))
    rows = [
        [
            Paragraph("<b>Producto / concepto</b>", st["n"]),
            Paragraph("<b>Valor COP</b>", st["n"]),
        ],
    ]
    for p in productos:
        rows.append(
            [
                Paragraph(_etiqueta_producto(p), st["n"]),
                Paragraph(_fmt_cop(p["valor_cop"]), st["n"]),
            ]
        )
    if not productos:
        rows.append(
            [
                Paragraph("Productos adquiridos", st["n"]),
                Paragraph(_fmt_cop(calc["valor_compra_cop"]), st["n"]),
            ]
        )
    rows.append(
        [
            Paragraph(
                f"Cuota de manejo ({calc['pct']:.0f}% sobre valor de los productos)",
                st["n"],
            ),
            Paragraph(_fmt_cop(calc["cuota_manejo_cop"]), st["n"]),
        ]
    )
    rows.append(
        [
            Paragraph(
                f"<font color='{accent_hex}'><b>TOTAL A COBRAR</b></font>",
                st["n"],
            ),
            Paragraph(
                f"<font color='{accent_hex}'><b>{_fmt_cop(calc['total_cobro_cop'])}</b></font>",
                st["n"],
            ),
        ],
    )
    t = Table(rows, colWidths=[ancho * 0.68, ancho * 0.32])
    t.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, accent),
                ("LINEABOVE", (0, -1), (-1, -1), 1.2, accent),
                ("GRID", (0, 0), (-1, -2), 0.3, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 10))
    story.append(
        Paragraph(
            f"<b>VALOR A PAGAR: {_fmt_cop(calc['total_cobro_cop'])} COP</b>",
            st["total"],
        )
    )

    if emisor["banco"] or emisor["cuenta"]:
        story.append(Paragraph("DATOS PARA EL PAGO", st["h"]))
        pago_bits = []
        if emisor["banco"]:
            pago_bits.append(f"Banco: {emisor['banco']}")
        if emisor["tipo_cuenta"]:
            pago_bits.append(f"Tipo: {emisor['tipo_cuenta']}")
        if emisor["cuenta"]:
            pago_bits.append(f"Cuenta: {emisor['cuenta']}")
        pago_bits.append(f"A nombre de: {emisor['nombre'] or '[Nombre]'}")
        story.append(Paragraph("<br/>".join(pago_bits), st["n"]))

    story.append(Spacer(1, 28))
    story.append(HRFlowable(width="40%", thickness=0.5, color=_MUTED, spaceBefore=4, spaceAfter=4))
    story.append(Paragraph(emisor["nombre"] or "________________________", st["center"]))
    story.append(Paragraph("Firma / Emisor", st["small"]))
    story.append(Spacer(1, 16))
    story.append(
        Paragraph(
            "Cuenta de cobro por productos adquiridos + cuota de manejo. "
            "No es factura electrónica DIAN. Aprobada desde el panel de operaciones.",
            st["small"],
        )
    )

    _guardar_pdf(doc, story, full)
    return {
        **calc,
        "numero": num,
        "path": full,
        "filename": filename,
        "accent_hex": accent_hex,
        "error": None,
    }


def generar_pdf_cuenta_flete(
    *,
    compra_id: int,
    moneda: str,
    trm: float,
    flete: float,
    moneda_flete: str = "",
    proveedor: str = "",
    fecha_compra: str = "",
    numero: str | None = None,
    accent_rgb: str | None = None,
    emisor_perfil: dict | None = None,
    filename: str | None = None,
    etiqueta_fecha: str = "compra",
    compras_ids: list[int] | None = None,
    numero_pedido: str = "",
) -> dict[str, Any]:
    """PDF cuenta de cobro aparte solo por el flete/envío."""
    resolved = resolver_tasa_cuenta_cobro(
        moneda=moneda,
        trm=trm,
        fecha_compra=fecha_compra,
        lineas=None,
        consultar_banrep=True,
    )
    if not resolved.get("error") and float(resolved.get("trm") or 0) > 0:
        moneda = str(resolved["moneda"])
        trm = float(resolved["trm"])
        if (moneda_flete or "").strip().upper() in ("", "COP") and resolved.get("corregido"):
            moneda_flete = moneda
    flete_c = flete_en_cop(
        moneda=moneda, trm=trm, flete=flete, moneda_flete=moneda_flete
    )
    if flete_c <= 0:
        return {
            "flete_cop": 0.0,
            "numero": "",
            "path": "",
            "filename": "",
            "error": "Sin flete para cuenta de cobro",
        }

    accent_hex = accent_to_hex(accent_rgb)
    try:
        accent = colors.HexColor(accent_hex)
    except Exception:
        accent = _ACCENT_DEFAULT
        accent_hex = "#0c6069"

    _asegurar_carpeta_pdfs()
    num = numero or numero_cuenta_cobro(int(compra_id), flete=True)
    filename = (filename or "").strip() or nombre_archivo_cuenta_cobro(int(compra_id), flete=True)
    full = os.path.join(_CARPETA, filename)

    emisor = datos_emisor(emisor_perfil)
    if emisor_perfil is not None and not (emisor.get("documento") or "").strip():
        return {
            "flete_cop": flete_c,
            "numero": "",
            "path": "",
            "filename": "",
            "error": "Falta documento de identidad del emisor en el perfil",
        }
    pagador = datos_pagador()
    fecha_doc = _fmt_fecha(fecha_compra) if fecha_compra else datetime.now().strftime("%d/%m/%Y")
    mon_u = (moneda or "USD").strip().upper()
    mf = (moneda_flete or moneda or "USD").strip().upper()

    styles = getSampleStyleSheet()
    st = {
        "titulo": ParagraphStyle(
            "cf_titulo", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold",
            textColor=accent, alignment=TA_CENTER,
        ),
        "h": ParagraphStyle(
            "cf_h", parent=styles["Normal"], fontSize=10, fontName="Helvetica-Bold",
            textColor=accent, spaceBefore=10, spaceAfter=4,
        ),
        "n": ParagraphStyle(
            "cf_n", parent=styles["Normal"], fontSize=9, fontName="Helvetica",
            textColor=_INK, leading=13, alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            "cf_small", parent=styles["Normal"], fontSize=8, fontName="Helvetica",
            textColor=_MUTED, leading=11,
        ),
        "total": ParagraphStyle(
            "cf_total", parent=styles["Normal"], fontSize=12, fontName="Helvetica-Bold",
            textColor=accent, alignment=TA_RIGHT,
        ),
        "center": ParagraphStyle(
            "cf_center", parent=styles["Normal"], fontSize=9, fontName="Helvetica",
            textColor=_INK, alignment=TA_CENTER, leading=13,
        ),
    }

    doc = SimpleDocTemplate(
        full, pagesize=letter,
        topMargin=1.5 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm,
    )
    ancho = letter[0] - 4 * cm
    story: list = []

    story.append(Paragraph("<b>CUENTA DE COBRO · FLETE</b>", st["titulo"]))
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1.2, color=accent, spaceAfter=8))
    pedido_lbl = _etiqueta_pedido_cuenta(
        int(compra_id), numero_pedido, compras_ids=compras_ids
    )
    story.append(Paragraph(
        f"<font color='{accent_hex}'><b>Nº {num}</b></font>"
        f" &nbsp;&nbsp;|&nbsp;&nbsp; <b>{pedido_lbl}</b>"
        f" &nbsp;&nbsp;|&nbsp;&nbsp; Fecha: {fecha_doc}",
        st["n"],
    ))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=0.4, color=accent, spaceAfter=8))

    story.append(Paragraph("EMISOR (quien cobra)", st["h"]))
    emisor_lines = [f"<b>{emisor['nombre'] or '[Nombre del cobrador]'}</b>"]
    if emisor["documento"]:
        emisor_lines.append(f"Documento: {emisor['documento']}")
    if emisor["ciudad"]:
        emisor_lines.append(f"Ciudad: {emisor['ciudad']}")
    story.append(Paragraph("<br/>".join(emisor_lines), st["n"]))

    story.append(Paragraph("DIRIGIDA A (pagador)", st["h"]))
    story.append(Paragraph(
        f"<b>{pagador['razon']}</b><br/>NIT: {pagador['nit']}<br/>Ciudad: {pagador['ciudad']}",
        st["n"],
    ))

    prov = (proveedor or "").strip() or "proveedor exterior"
    etiqueta = (etiqueta_fecha or "compra").strip() or "compra"
    story.append(Paragraph("CONCEPTO", st["h"]))
    story.append(Paragraph(
        f"Reembolso del flete / envío de {pedido_lbl} ({prov}"
        + (f", {fecha_compra}" if fecha_compra else "")
        + f"). Flete original: {flete:g} {mf}"
        + (
            f", TRM BanRep {trm:g} del día del {etiqueta}. Valor en pesos (COP)"
            if mf != "COP" and mon_u != "COP" and trm
            else ". Valor en pesos (COP)"
        )
        + ".",
        st["n"],
    ))

    story.append(Paragraph("LIQUIDACIÓN", st["h"]))
    rows = [
        [Paragraph("<b>Descripción</b>", st["n"]), Paragraph("<b>Valor</b>", st["n"])],
        [
            Paragraph("Flete / envío (reembolso) en COP", st["n"]),
            Paragraph(_fmt_cop(flete_c), st["n"]),
        ],
        [
            Paragraph(f"<font color='{accent_hex}'><b>TOTAL A COBRAR</b></font>", st["n"]),
            Paragraph(
                f"<font color='{accent_hex}'><b>{_fmt_cop(flete_c)}</b></font>",
                st["n"],
            ),
        ],
    ]
    t = Table(rows, colWidths=[ancho * 0.68, ancho * 0.32])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, accent),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, accent),
        ("GRID", (0, 0), (-1, -2), 0.3, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))
    story.append(Paragraph(f"<b>VALOR A PAGAR: {_fmt_cop(flete_c)} COP</b>", st["total"]))

    if emisor["banco"] or emisor["cuenta"]:
        story.append(Paragraph("DATOS PARA EL PAGO", st["h"]))
        bits = []
        if emisor["banco"]:
            bits.append(f"Banco: {emisor['banco']}")
        if emisor["tipo_cuenta"]:
            bits.append(f"Tipo: {emisor['tipo_cuenta']}")
        if emisor["cuenta"]:
            bits.append(f"Cuenta: {emisor['cuenta']}")
        bits.append(f"A nombre de: {emisor['nombre'] or '[Nombre]'}")
        story.append(Paragraph("<br/>".join(bits), st["n"]))

    story.append(Spacer(1, 28))
    story.append(HRFlowable(width="40%", thickness=0.5, color=_MUTED, spaceBefore=4, spaceAfter=4))
    story.append(Paragraph(emisor["nombre"] or "________________________", st["center"]))
    story.append(Paragraph("Firma / Emisor", st["small"]))
    story.append(Spacer(1, 16))
    story.append(Paragraph(
        "Cuenta de cobro aparte por flete/envío. No incluye mercancía ni cuota de manejo. "
        "No es factura electrónica DIAN.",
        st["small"],
    ))

    _guardar_pdf(doc, story, full)
    return {
        "flete_cop": flete_c,
        "numero": num,
        "path": full,
        "filename": filename,
        "accent_hex": accent_hex,
        "error": None,
    }


def carpeta_pdfs() -> str:
    return _CARPETA
