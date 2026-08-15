"""Recorte de la rúbrica / línea de firma desde un COA escaneado."""

from __future__ import annotations

import base64
import io
import re
from typing import Any

from PIL import Image


def _parse_bbox(raw: Any) -> tuple[float, float, float, float] | None:
    """Acepta [ymin, xmin, ymax, xmax] en escala 0-1000 o 0-1."""
    if isinstance(raw, str):
        nums = re.findall(r"-?\d+(?:\.\d+)?", raw)
        vals = [float(x) for x in nums[:4]]
    elif isinstance(raw, (list, tuple)) and len(raw) >= 4:
        try:
            vals = [float(raw[i]) for i in range(4)]
        except (TypeError, ValueError):
            return None
    else:
        return None
    if len(vals) < 4:
        return None
    ymin, xmin, ymax, xmax = vals
    if ymax <= ymin or xmax <= xmin:
        return None
    # Normalizar a 0-1
    if max(vals) > 1.5:
        ymin, xmin, ymax, xmax = ymin / 1000.0, xmin / 1000.0, ymax / 1000.0, xmax / 1000.0
    ymin = max(0.0, min(1.0, ymin))
    xmin = max(0.0, min(1.0, xmin))
    ymax = max(0.0, min(1.0, ymax))
    xmax = max(0.0, min(1.0, xmax))
    if ymax - ymin < 0.01 or xmax - xmin < 0.01:
        return None
    return ymin, xmin, ymax, xmax


def _rasterizar(data: bytes, mime_type: str) -> Image.Image | None:
    mime = (mime_type or "").lower()
    try:
        if "pdf" in mime or data[:4] == b"%PDF":
            import fitz  # PyMuPDF

            doc = fitz.open(stream=data, filetype="pdf")
            try:
                if doc.page_count < 1:
                    return None
                # Última página suele tener la firma; si hay 1 sola, es esa.
                page = doc[-1]
                # 2x para mejor detalle de la rúbrica
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            finally:
                doc.close()
        img = Image.open(io.BytesIO(data))
        img.load()
        if img.mode not in ("RGB", "RGBA", "L"):
            img = img.convert("RGBA")
        return img
    except Exception:
        return None


def recortar_firma_a_data_url(
    data: bytes,
    mime_type: str,
    bbox_raw: Any,
    *,
    padding: float = 0.02,
) -> str | None:
    """Recorta la zona de firma y devuelve data URL PNG con el trazo sin fondo."""
    bbox = _parse_bbox(bbox_raw)
    if not bbox:
        return None
    img = _rasterizar(data, mime_type)
    if img is None:
        return None
    w, h = img.size
    ymin, xmin, ymax, xmax = bbox
    # padding relativo
    ymin = max(0.0, ymin - padding)
    xmin = max(0.0, xmin - padding)
    ymax = min(1.0, ymax + padding)
    xmax = min(1.0, xmax + padding)
    left, top, right, bottom = int(xmin * w), int(ymin * h), int(xmax * w), int(ymax * h)
    if right - left < 8 or bottom - top < 8:
        return None
    crop = img.crop((left, top, right, bottom))
    trazo = _trazo_transparente(crop)
    return _a_data_url_png(trazo if trazo is not None else crop.convert("RGBA"))


def extraer_trazo_firma(data: bytes, mime_type: str = "image/png") -> str | None:
    """Deja solo el trazo de una firma (fondo transparente) y recorta al contenido.

    Sirve tanto para el recorte del escáner como para una imagen pegada por el
    operador: el fondo del papel casi nunca es blanco puro (fotos con sombra,
    escaneos grises), por eso el umbral se calcula por imagen y no es fijo.
    """
    img = _rasterizar(data, mime_type)
    if img is None:
        return None
    trazo = _trazo_transparente(img)
    if trazo is None:
        return None
    return _a_data_url_png(trazo)


def extraer_trazo_firma_data_url(data_url: str) -> str | None:
    decoded = data_url_a_bytes(data_url)
    if not decoded:
        return None
    raw, mime = decoded
    return extraer_trazo_firma(raw, mime)


def _a_data_url_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _umbral_otsu(histograma: list[int]) -> int:
    """Umbral que mejor separa tinta de fondo (varianza inter-clase máxima).

    Entre dos picos separados hay muchos cortes con la misma varianza; se
    devuelve el centro de ese rango. Quedarse con el primero dejaba el umbral
    pegado al nivel de la tinta y el trazo salía semitransparente.
    """
    total = sum(histograma)
    if total <= 0:
        return 127
    suma_total = sum(i * n for i, n in enumerate(histograma))
    suma_fondo = 0.0
    peso_fondo = 0
    mejor_var = -1.0
    primero = 127
    ultimo = 127
    for i, n in enumerate(histograma):
        peso_fondo += n
        if peso_fondo == 0:
            continue
        peso_frente = total - peso_fondo
        if peso_frente == 0:
            break
        suma_fondo += i * n
        media_fondo = suma_fondo / peso_fondo
        media_frente = (suma_total - suma_fondo) / peso_frente
        var = peso_fondo * peso_frente * (media_fondo - media_frente) ** 2
        if var > mejor_var * 1.000001:
            mejor_var = var
            primero = ultimo = i
        elif var >= mejor_var * 0.999999:
            ultimo = i
    return (primero + ultimo) // 2


def _luminancia_fondo(gris: Image.Image) -> float:
    """Luminancia típica del borde de la imagen (el papel, no la rúbrica)."""
    w, h = gris.size
    borde = max(1, min(3, min(w, h) // 8))
    px = gris.load()
    valores: list[int] = []
    for x in range(w):
        for y in range(borde):
            valores.append(px[x, y])
            valores.append(px[x, h - 1 - y])
    for y in range(h):
        for x in range(borde):
            valores.append(px[x, y])
            valores.append(px[w - 1 - x, y])
    if not valores:
        return 255.0
    valores.sort()
    return float(valores[len(valores) // 2])


def _umbral_tinta(histograma: list[int]) -> int:
    """Umbral de tinta tolerante a fondos de varios niveles.

    Un recorte suele traer el blanco de la página y además el gris del papel
    fotografiado; con un solo Otsu la clase oscura se queda con todo el papel
    gris. Por eso se repite sobre la clase oscura mientras siga siendo
    demasiado grande para ser solo el trazo.
    """
    total = sum(histograma)
    if total <= 0:
        return 127
    umbral = _umbral_otsu(histograma)
    for _ in range(3):
        oscuros = sum(histograma[: umbral + 1])
        if oscuros <= total * 0.35 or oscuros == 0:
            break
        sub = list(histograma[: umbral + 1]) + [0] * (255 - umbral)
        nuevo = _umbral_otsu(sub)
        if nuevo <= 0 or nuevo >= umbral:
            break
        umbral = nuevo
    return umbral


def _mediana_sobre(histograma: list[int], desde: int) -> float:
    """Mediana de los niveles >= `desde` (nivel del papel más cercano al trazo)."""
    claros = [(i, n) for i, n in enumerate(histograma) if i >= desde and n]
    total = sum(n for _, n in claros)
    if not total:
        return 255.0
    objetivo = total // 2
    acum = 0
    for nivel, n in claros:
        acum += n
        if acum >= objetivo:
            return float(nivel)
    return float(claros[-1][0])


def _trazo_transparente(img: Image.Image, *, margen: int = 4) -> Image.Image | None:
    """Convierte el fondo en alpha 0 y deja el trazo opaco, recortado al contenido."""
    from PIL import ImageFilter

    rgba = img.convert("RGBA")
    w, h = rgba.size
    if w < 4 or h < 4:
        return None

    # Componer sobre blanco: si la imagen ya trae alpha, el análisis debe ver papel
    plano = Image.new("RGB", (w, h), (255, 255, 255))
    plano.paste(rgba, mask=rgba.split()[-1])
    alpha_previo = rgba.split()[-1]

    gris = plano.convert("L")
    # La mediana solo estima umbrales: aplicada al alpha adelgazaría el trazo
    suave = gris.filter(ImageFilter.MedianFilter(3)) if min(w, h) >= 3 else gris

    fondo_borde = _luminancia_fondo(suave)
    umbral = float(_umbral_tinta(suave.histogram()))

    # Firma clara sobre fondo oscuro: se invierte para tratarla igual
    invertida = fondo_borde < umbral
    if invertida:
        gris = Image.eval(gris, lambda v: 255 - v)
        suave = Image.eval(suave, lambda v: 255 - v)
        umbral = float(_umbral_tinta(suave.histogram()))

    papel = _mediana_sobre(suave.histogram(), int(umbral))
    separacion = papel - umbral
    if separacion < 10:
        # Sin contraste real (recorte en blanco o todo tinta): no tocar la imagen
        return None

    # Rampa estrecha centrada en el umbral: todo lo más claro se va, sin importar
    # si el papel es blanco puro o gris de fotografía.
    holgura = max(6.0, min(40.0, separacion * 0.25))
    limpio = umbral + holgura
    opaco = umbral - holgura
    rango = max(1.0, limpio - opaco)

    lum_px = gris.load()
    alpha = Image.new("L", (w, h), 0)
    alpha_px = alpha.load()
    prev_px = alpha_previo.load()
    tinta = 0
    for y in range(h):
        for x in range(w):
            v = lum_px[x, y]
            if v >= limpio:
                continue
            if v <= opaco:
                a = 255
            else:
                # Gamma <1: las rúbricas tenues quedan sólidas, no gris lavado
                a = int(255 * ((limpio - v) / rango) ** 0.6)
            a = a * prev_px[x, y] // 255
            if a > 8:
                alpha_px[x, y] = a
                tinta += 1

    if tinta == 0 or tinta > w * h * 0.6:
        # Nada detectado, o casi toda la imagen es "tinta" (recorte equivocado)
        return None

    base = gris
    # Tinta uniforme y oscura: las rúbricas escaneadas suelen quedar grises
    tinta_img = Image.merge(
        "RGBA",
        (
            Image.eval(base, lambda v: min(v, 40)),
            Image.eval(base, lambda v: min(v, 40)),
            Image.eval(base, lambda v: min(v, 45)),
            alpha,
        ),
    )

    caja = alpha.getbbox()
    if not caja:
        return None
    left = max(0, caja[0] - margen)
    top = max(0, caja[1] - margen)
    right = min(w, caja[2] + margen)
    bottom = min(h, caja[3] + margen)
    return tinta_img.crop((left, top, right, bottom))


def data_url_a_bytes(data_url: str) -> tuple[bytes, str] | None:
    s = (data_url or "").strip()
    if not s.startswith("data:") or ";base64," not in s:
        return None
    header, b64 = s.split(";base64,", 1)
    mime = header[5:] or "image/png"
    try:
        return base64.b64decode(b64), mime
    except Exception:
        return None
