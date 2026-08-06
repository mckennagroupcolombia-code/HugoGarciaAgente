"""Reportes visuales de stock / rotación / ventas → WhatsApp (imagen + caption corto).

Tipos: rotacion | estadistica | inventario
Periodos: semanal (7) | quincenal (15) | mensual (30)
"""
from __future__ import annotations

import os
import tempfile
from datetime import datetime
from typing import Any

from app.sync import obtener_estado_stock_meli, obtener_ventas_meli_por_item
from app.utils import (
    enviar_whatsapp_archivo,
    enviar_whatsapp_reporte,
    jid_grupo_inventario_wa,
)

PERIODOS: dict[str, dict[str, Any]] = {
    "semanal": {"dias": 7, "label": "Semanal · 7 días"},
    "quincenal": {"dias": 15, "label": "Quincenal · 15 días"},
    "mensual": {"dias": 30, "label": "Mensual · 30 días"},
}

TIPOS: dict[str, str] = {
    "rotacion": "Baja rotación / sin ventas",
    "estadistica": "Estadística de ventas",
    "inventario": "Sin inventario / pronto a agotar",
}

# Paleta panel McKenna (oscuro)
_BG = (22, 25, 32)
_PANEL = (36, 40, 50)
_PANEL2 = (44, 49, 62)
_BORDER = (58, 64, 78)
_TEXT = (241, 245, 249)
_MUTED = (148, 163, 184)
_ACCENT = (225, 29, 122)
_DANGER = (239, 68, 68)
_WARN = (245, 158, 11)
_OK = (16, 185, 129)
_SKY = (56, 189, 248)

_FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _out_dir() -> str:
    """Directorio escribible por el usuario del servicio (mckg), no el del IDE."""
    preferred = (os.getenv("AGENTE_REPORTES_STOCK_DIR") or "").strip()
    if preferred:
        os.makedirs(preferred, mode=0o755, exist_ok=True)
        return preferred
    # /tmp es siempre escribible por el proceso del agente
    d = os.path.join(tempfile.gettempdir(), "mckenna_reportes_stock")
    os.makedirs(d, mode=0o755, exist_ok=True)
    return d


def _fmt_cop(n: float | int | None) -> str:
    try:
        v = int(round(float(n or 0)))
    except (TypeError, ValueError):
        return "$0"
    return f"${v:,}".replace(",", ".")


def _nombre(it: dict) -> str:
    return (it.get("nombre") or it.get("sku") or it.get("meli_id") or "—").strip()


def _venta_de(it: dict, por_item: dict) -> dict | None:
    mid = str(it.get("meli_id") or "").strip().upper()
    if not mid:
        return None
    return por_item.get(mid) or por_item.get(it.get("meli_id") or "")


def _font(size: int, bold: bool = False):
    from PIL import ImageFont

    path = _FONT_BOLD if bold else _FONT_REG
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def _fit_text(draw, text: str, font, max_w: int) -> str:
    """Recorta por píxeles para aprovechar todo el ancho disponible."""
    text = (text or "").strip() or "—"
    if draw.textbbox((0, 0), text, font=font)[2] <= max_w:
        return text
    ell = "…"
    lo, hi = 0, len(text)
    best = ell
    while lo <= hi:
        mid = (lo + hi) // 2
        cand = text[:mid].rstrip() + ell
        w = draw.textbbox((0, 0), cand, font=font)[2]
        if w <= max_w:
            best = cand
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _rounded(draw, xy, radius: int, fill):
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def _collect_rotacion(items: list[dict], por_item: dict, dias: int) -> dict[str, Any]:
    sin_ventas: list[dict] = []
    baja: list[dict] = []
    for it in items:
        stock = it.get("stock")
        if stock is None:
            continue
        v = _venta_de(it, por_item)
        uds = int((v or {}).get("unidades") or 0)
        nivel = (v or {}).get("nivel") or ("sin_ventas" if uds <= 0 else "baja")
        stock_i = int(stock)
        row = {"nombre": _nombre(it), "stock": stock_i, "uds": uds}
        if uds <= 0:
            sin_ventas.append(row)
        elif nivel == "baja" or uds <= 2:
            baja.append(row)
    sin_ventas.sort(key=lambda r: r["stock"], reverse=True)
    baja.sort(key=lambda r: r["stock"], reverse=True)
    capital = sum(1 for r in sin_ventas if r["stock"] >= 6)
    return {
        "kpis": [
            {"label": "Sin ventas", "value": str(len(sin_ventas)), "color": _DANGER},
            {"label": "Baja rotación", "value": str(len(baja)), "color": _WARN},
            {"label": "Stock parado ≥6", "value": str(capital), "color": _ACCENT},
            {"label": "Periodo", "value": f"{dias}d", "color": _SKY},
        ],
        "tabla_titulo": "Mayor stock sin movimiento",
        "tabla_cols": ("Stock", "Vend.", "Producto"),
        "filas": [
            (str(r["stock"]), str(r["uds"]), r["nombre"])
            for r in (sin_ventas[:22] or baja[:22])
        ],
        "nota": f"Top por stock · sin ventas / baja rotación ({dias}d).",
    }


def _collect_estadistica(
    items: list[dict], por_item: dict, dias: int, ordenes: int
) -> dict[str, Any]:
    total_uds = 0
    total_monto = 0.0
    con_venta = 0
    ranking: list[tuple[int, float, str, int]] = []
    meli_ids = {str(it.get("meli_id") or "").upper() for it in items if it.get("meli_id")}
    nombres = {
        str(it.get("meli_id") or "").upper(): _nombre(it) for it in items if it.get("meli_id")
    }
    stocks = {
        str(it.get("meli_id") or "").upper(): it.get("stock") for it in items if it.get("meli_id")
    }
    for mid, v in (por_item or {}).items():
        mid_u = str(mid).upper()
        if meli_ids and mid_u not in meli_ids:
            continue
        uds = int(v.get("unidades") or 0)
        monto = float(v.get("monto") or 0)
        if uds <= 0:
            continue
        con_venta += 1
        total_uds += uds
        total_monto += monto
        ranking.append(
            (uds, monto, nombres.get(mid_u) or mid_u, int(stocks.get(mid_u) or 0))
        )
    sin_venta = max(0, len(meli_ids) - con_venta) if meli_ids else 0
    ranking.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return {
        "kpis": [
            {"label": "Órdenes", "value": str(ordenes), "color": _SKY},
            {"label": "Unidades", "value": str(total_uds), "color": _OK},
            {"label": "Monto approx.", "value": _fmt_cop(total_monto), "color": _ACCENT},
            {"label": "Con / sin venta", "value": f"{con_venta}/{sin_venta}", "color": _WARN},
        ],
        "tabla_titulo": f"Top ventas · {dias} días",
        "tabla_cols": ("Uds", "Monto", "Producto"),
        "filas": [
            (str(uds), _fmt_cop(monto), nom)
            for uds, monto, nom, _stk in ranking[:22]
        ],
        "nota": f"Ventas pagadas MeLi · {dias} días.",
    }


def _collect_inventario(items: list[dict], por_item: dict, dias: int) -> dict[str, Any]:
    agotados: list[dict] = []
    ultima: list[dict] = []
    bajos: list[dict] = []
    por_ritmo: list[dict] = []
    for it in items:
        stock = it.get("stock")
        if stock is None:
            continue
        stock_i = int(stock)
        v = _venta_de(it, por_item)
        uds = int((v or {}).get("unidades") or 0)
        ritmo = float((v or {}).get("ritmo_diario") or 0)
        row = {"nombre": _nombre(it), "stock": stock_i, "uds": uds, "cob": None}
        if stock_i <= 0:
            agotados.append(row)
        elif stock_i == 1:
            ultima.append(row)
        elif stock_i <= 5:
            bajos.append(row)
        elif ritmo > 0:
            dias_cob = stock_i / ritmo
            if dias_cob <= float(dias):
                row["cob"] = int(round(dias_cob))
                por_ritmo.append(row)
    por_ritmo.sort(key=lambda r: r["cob"] if r["cob"] is not None else 999)
    # Prioridad: agotados → última → bajos → cobertura corta
    # Orden columnas: Stock | Señal | Producto (números primero, sin hueco vacío)
    filas: list[tuple[str, str, str]] = []
    for r in agotados[:10]:
        filas.append(("0", f"{r['uds']} vend", r["nombre"]))
    for r in ultima[:6]:
        filas.append(("1", f"{r['uds']} vend", r["nombre"]))
    for r in bajos[:6]:
        filas.append((str(r["stock"]), f"{r['uds']} vend", r["nombre"]))
    for r in por_ritmo[:6]:
        filas.append((str(r["stock"]), f"~{r['cob']}d", r["nombre"]))
    return {
        "kpis": [
            {"label": "Agotados", "value": str(len(agotados)), "color": _DANGER},
            {"label": "Última ud.", "value": str(len(ultima)), "color": _WARN},
            {"label": "Bajos 2–5", "value": str(len(bajos)), "color": _ACCENT},
            {"label": f"≤{dias}d cobertura", "value": str(len(por_ritmo)), "color": _SKY},
        ],
        "tabla_titulo": "Prioridad reposición",
        "tabla_cols": ("Stock", "Señal", "Producto"),
        "filas": filas[:22],
        "nota": "Críticos primero · cobertura = stock ÷ ritmo diario.",
    }


def render_reporte_imagen(
    *,
    tipo: str,
    periodo: str,
    dias: int,
    data: dict[str, Any],
) -> str:
    """Dibuja dashboard PNG denso (sin gráfico redundante) y retorna ruta absoluta."""
    from PIL import Image, ImageDraw

    del dias  # reservado por firma pública; el periodo ya viene en data/label

    W = 1080
    PAD = 10
    GAP = 5
    header_h = 44
    kpi_h = 36
    row_h = 22
    filas = data.get("filas") or []
    n_rows = max(1, len(filas))
    table_h = 26 + n_rows * row_h + 2
    footer_h = 20
    H = PAD + header_h + GAP + kpi_h + GAP + table_h + footer_h + PAD

    img = Image.new("RGB", (W, H), _BG)
    draw = ImageDraw.Draw(img)
    f_title = _font(17, True)
    f_sub = _font(10, False)
    f_kpi_v = _font(16, True)
    f_kpi_l = _font(10, False)
    f_sec = _font(11, True)
    f_row = _font(11, False)
    f_row_b = _font(11, True)
    f_small = _font(9, False)

    # Header compacto
    _rounded(draw, (PAD, PAD, W - PAD, PAD + header_h), 5, _PANEL)
    draw.text((PAD + 8, PAD + 4), "McKenna Group", font=f_sub, fill=_ACCENT)
    draw.text((PAD + 8, PAD + 16), TIPOS.get(tipo, tipo), font=f_title, fill=_TEXT)
    ahora = datetime.now().strftime("%d/%m/%Y %H:%M")
    draw.text((PAD + 8, PAD + 33), ahora, font=f_small, fill=_MUTED)

    badge = PERIODOS[periodo]["label"]
    bb = draw.textbbox((0, 0), badge, font=f_small)
    bw = bb[2] - bb[0] + 10
    bx0 = W - PAD - 6 - bw
    by0 = PAD + 12
    _rounded(draw, (bx0, by0, bx0 + bw, by0 + 18), 5, _ACCENT)
    draw.text((bx0 + 5, by0 + 3), badge, font=f_small, fill=_TEXT)

    y = PAD + header_h + GAP

    # KPIs en franja única (sin cards altos con vacío)
    kpis = data.get("kpis") or []
    _rounded(draw, (PAD, y, W - PAD, y + kpi_h), 5, _PANEL)
    n = max(1, len(kpis))
    slot = (W - 2 * PAD) // n
    for i, k in enumerate(kpis):
        x0 = PAD + i * slot
        color = k.get("color") or _ACCENT
        draw.rectangle((x0, y + 4, x0 + 3, y + kpi_h - 4), fill=color)
        label = k.get("label") or ""
        val = str(k.get("value") or "—")
        draw.text((x0 + 8, y + 4), label, font=f_kpi_l, fill=_MUTED)
        draw.text((x0 + 8, y + 16), val, font=f_kpi_v, fill=_TEXT)
    y += kpi_h + GAP

    # Tabla densa — Stock | Señal | Producto (métricas primero, nombre llena el resto)
    _rounded(draw, (PAD, y, W - PAD, y + table_h), 6, _PANEL)
    draw.text((PAD + 8, y + 4), data.get("tabla_titulo") or "Detalle", font=f_sec, fill=_TEXT)

    col_stock = PAD + 10
    col_senal = PAD + 58
    col_prod = PAD + 148
    name_max_w = W - PAD - col_prod - 8
    ty = y + 18
    cols = data.get("tabla_cols") or ("Stock", "Señal", "Producto")
    draw.text((col_stock, ty), cols[0], font=f_small, fill=_MUTED)
    draw.text((col_senal, ty), cols[1] if len(cols) > 1 else "", font=f_small, fill=_MUTED)
    draw.text((col_prod, ty), cols[2] if len(cols) > 2 else "", font=f_small, fill=_MUTED)
    ty += 12
    draw.line((PAD + 4, ty, W - PAD - 4, ty), fill=_BORDER, width=1)
    ty += 2

    rows = filas or []
    if not rows:
        draw.text((col_prod, ty + 2), "Sin ítems en esta categoría", font=f_row, fill=_MUTED)
    for idx, fila in enumerate(rows):
        c_stock = str(fila[0] if len(fila) > 0 else "—")
        c_senal = str(fila[1] if len(fila) > 1 else "—")
        nom_raw = str(fila[2] if len(fila) > 2 else "—")
        nom = _fit_text(draw, nom_raw, f_row, name_max_w)

        bg = _PANEL2 if idx % 2 == 0 else _PANEL
        _rounded(draw, (PAD + 3, ty, W - PAD - 3, ty + row_h - 1), 2, bg)
        if c_stock == "0":
            stock_color, bar = _DANGER, _DANGER
        elif c_stock == "1":
            stock_color, bar = _WARN, _WARN
        else:
            stock_color, bar = _TEXT, _BORDER
        draw.rectangle((PAD + 3, ty + 2, PAD + 5, ty + row_h - 3), fill=bar)
        draw.text((col_stock + 2, ty + 4), c_stock, font=f_row_b, fill=stock_color)
        draw.text((col_senal, ty + 4), c_senal, font=f_row_b, fill=_TEXT)
        draw.text((col_prod, ty + 4), nom, font=f_row, fill=_TEXT)
        ty += row_h

    fy = H - footer_h + 3
    draw.text((PAD, fy), data.get("nota") or "", font=f_small, fill=_MUTED)
    draw.text((W - PAD - 190, fy), "Reporte · grupo Inventario", font=f_small, fill=_MUTED)

    os.makedirs(_out_dir(), exist_ok=True)
    fname = f"reporte_{tipo}_{periodo}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    path = os.path.join(_out_dir(), fname)
    img.save(path, "PNG", optimize=True)
    return path


def _caption(tipo: str, periodo: str, data: dict[str, Any]) -> str:
    kpis = data.get("kpis") or []
    bits = " · ".join(f"{k['label']}: *{k['value']}*" for k in kpis[:4])
    return (
        f"📊 *{TIPOS.get(tipo, tipo)}*\n"
        f"{PERIODOS[periodo]['label']}\n"
        f"{bits}\n"
        f"_Imagen adjunta para lectura rápida_"
    )


def generar_reporte_stock(
    tipo: str,
    periodo: str,
    *,
    enviar_wa: bool = True,
    refresh_ventas: bool = False,
) -> dict[str, Any]:
    """Genera imagen del reporte y la envía al grupo de inventario."""
    tipo = (tipo or "").strip().lower()
    periodo = (periodo or "").strip().lower()
    if tipo not in TIPOS:
        raise ValueError(f"tipo inválido: {tipo}. Use: {', '.join(TIPOS)}")
    if periodo not in PERIODOS:
        raise ValueError(f"periodo inválido: {periodo}. Use: {', '.join(PERIODOS)}")

    dias = int(PERIODOS[periodo]["dias"])
    items = obtener_estado_stock_meli()
    ventas = obtener_ventas_meli_por_item(dias=dias, refresh=refresh_ventas)
    por_item = ventas.get("por_item") or {}
    ordenes = int(ventas.get("ordenes") or 0)

    if tipo == "rotacion":
        data = _collect_rotacion(items, por_item, dias)
    elif tipo == "estadistica":
        data = _collect_estadistica(items, por_item, dias, ordenes)
    else:
        data = _collect_inventario(items, por_item, dias)

    img_path = render_reporte_imagen(tipo=tipo, periodo=periodo, dias=dias, data=data)
    caption = _caption(tipo, periodo, data)
    dest = jid_grupo_inventario_wa()

    wa_ok = None
    if enviar_wa:
        wa_ok = bool(
            enviar_whatsapp_archivo(
                img_path,
                texto_mensaje=caption,
                file_name=os.path.basename(img_path),
                numero_destino=dest,
            )
        )
        if not wa_ok:
            # Fallback texto corto si falla el archivo
            texto_fb = caption + "\n_(No se pudo adjuntar la imagen)_"
            wa_ok = bool(enviar_whatsapp_reporte(texto_fb, numero_destino=dest))
            if not wa_ok:
                return {
                    "ok": False,
                    "tipo": tipo,
                    "periodo": periodo,
                    "dias": dias,
                    "wa_ok": False,
                    "imagen": img_path,
                    "error": "Imagen generada pero WhatsApp no la entregó (bridge :3000).",
                }

    return {
        "ok": True,
        "tipo": tipo,
        "periodo": periodo,
        "dias": dias,
        "wa_ok": wa_ok,
        "imagen": img_path,
        "mensaje": (
            f"Reporte visual «{TIPOS[tipo]}» ({PERIODOS[periodo]['label']}) "
            f"{'enviado al grupo Inventario' if wa_ok else 'generado'}."
        ),
        "kpis": data.get("kpis"),
    }
