"""
Editor de Plantillas Visuales — persistencia JSON y exportación PDF/PNG/JPG.
"""
from __future__ import annotations

import base64
import copy
import io
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[2]
_DATA_PATH = _REPO / "app" / "data" / "plantillas_visuales.json"
_CARPETAS_PATH = _REPO / "app" / "data" / "plantillas_visuales_carpetas.json"
_ASSETS_DIR = _REPO / "uploads" / "plantillas_visuales"
_MAX_PLANTILLAS = 500
_MAX_ASSET_BYTES = 8 * 1024 * 1024

# Cache en memoria de plantillas_visuales.json, invalidada por mtime: cada
# tecla en el buscador del Studio listaba y filtraba el catálogo completo
# releyendo y re-parseando el JSON desde disco. `_load_all` devuelve una
# copia profunda del cache para que las mutaciones in-place de otras
# funciones (p. ej. `mover_plantillas`) nunca contaminen el estado cacheado.
_cache: dict[str, Any] = {"mtime": None, "items": None}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load_all() -> list[dict]:
    try:
        mtime = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
        _cache["items"] = []
        return []
    if _cache["items"] is None or _cache["mtime"] != mtime:
        try:
            with open(_DATA_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
        items = data.get("plantillas") if isinstance(data, dict) else data
        _cache["items"] = items if isinstance(items, list) else []
        _cache["mtime"] = mtime
    return copy.deepcopy(_cache["items"])


def _save_all(items: list[dict]) -> None:
    _DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    trimmed = items[:_MAX_PLANTILLAS]
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump({"plantillas": trimmed}, f, ensure_ascii=False, indent=2)
    # Actualiza el cache de inmediato: el mtime del filesystem puede tener
    # resolución de 1s, insuficiente para distinguir un guardado de la
    # lectura inmediatamente posterior (p. ej. autoguardado + refresco de lista).
    try:
        _cache["mtime"] = _DATA_PATH.stat().st_mtime
    except OSError:
        _cache["mtime"] = None
    _cache["items"] = copy.deepcopy(trimmed)


def listar_plantillas(q: str = "", carpeta: str | None = None) -> list[dict]:
    items = _load_all()
    q = (q or "").strip().lower()
    if carpeta is not None:
        if q:
            # Con búsqueda activa se incluye también lo que está DENTRO de las
            # subcarpetas (p. ej. "Generadas AI" al buscar desde la raíz).
            prefijo = f"{carpeta}/" if carpeta else ""
            items = [
                p for p in items
                if (c := (p.get("carpeta") or "")) == carpeta
                or (not carpeta and c)
                or (prefijo and c.startswith(prefijo))
            ]
        else:
            items = [p for p in items if (p.get("carpeta") or "") == carpeta]
    if not q:
        return sorted(items, key=lambda x: x.get("updated_at") or "", reverse=True)
    out = []
    for p in items:
        nombre = (p.get("nombre") or "").lower()
        cat = (p.get("categoria") or "").lower()
        fmt = (p.get("formato") or {}).get("nombre", "").lower()
        carp = (p.get("carpeta") or "").lower()
        if q in nombre or q in cat or q in fmt or q in carp:
            out.append(p)
    return sorted(out, key=lambda x: x.get("updated_at") or "", reverse=True)


def _load_carpetas_registro() -> list[str]:
    if not _CARPETAS_PATH.exists():
        return []
    try:
        with open(_CARPETAS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return []
    items = data.get("carpetas") if isinstance(data, dict) else []
    return [c for c in items if isinstance(c, str) and c.strip()] if isinstance(items, list) else []


def _save_carpetas_registro(carpetas: list[str]) -> None:
    _CARPETAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_CARPETAS_PATH, "w", encoding="utf-8") as f:
        json.dump({"carpetas": sorted(set(carpetas))}, f, ensure_ascii=False, indent=2)


def _nombre_carpeta_plantilla_segura(nombre: str) -> str:
    nombre = re.sub(r"[\\/]+", " ", (nombre or "").strip())
    nombre = re.sub(r"[^\w.\- áéíóúÁÉÍÓÚñÑ]", "_", nombre, flags=re.UNICODE).strip()
    return nombre[:80]


def listar_carpetas_plantillas(carpeta_padre: str = "") -> list[str]:
    """Subcarpetas inmediatas de `carpeta_padre`: unión de las que ya tienen
    alguna plantilla y las creadas vacías (registro aparte, ya que las
    plantillas son solo registros JSON, no archivos)."""
    carpeta_padre = (carpeta_padre or "").strip().strip("/")
    prefijo = f"{carpeta_padre}/" if carpeta_padre else ""
    vistas: set[str] = set()

    todas = {(p.get("carpeta") or "").strip() for p in _load_all()}
    todas |= set(_load_carpetas_registro())

    for c in todas:
        c = c.strip("/")
        if not c or not c.startswith(prefijo):
            continue
        resto = c[len(prefijo):]
        if not resto:
            continue
        hijo = resto.split("/", 1)[0]
        if hijo:
            vistas.add(hijo)
    return sorted(vistas, key=str.lower)


def listar_todas_carpetas_plantillas() -> list[str]:
    """Todas las rutas de carpeta (para el selector "Mover a…")."""
    todas: set[str] = set()
    for p in _load_all():
        c = (p.get("carpeta") or "").strip().strip("/")
        if c:
            todas.add(c)
    for c in _load_carpetas_registro():
        c = c.strip("/")
        if c:
            todas.add(c)
    return sorted(todas, key=str.lower)


def crear_carpeta_plantilla(carpeta_padre: str, nombre: str) -> str:
    nombre = _nombre_carpeta_plantilla_segura(nombre)
    if not nombre:
        raise ValueError("Nombre de carpeta inválido")
    carpeta_padre = (carpeta_padre or "").strip().strip("/")
    nueva = f"{carpeta_padre}/{nombre}" if carpeta_padre else nombre
    registro = _load_carpetas_registro()
    if nueva not in registro:
        registro.append(nueva)
        _save_carpetas_registro(registro)
    return nueva


def mover_plantillas(ids: list[str], carpeta_destino: str) -> tuple[list[str], dict[str, str]]:
    carpeta_destino = (carpeta_destino or "").strip().strip("/")
    items = _load_all()
    por_id = {p.get("id"): p for p in items if p.get("id")}
    movidos: list[str] = []
    errores: dict[str, str] = {}
    for pid in ids:
        p = por_id.get(pid)
        if not p:
            errores[pid] = "Plantilla no encontrada"
            continue
        p["carpeta"] = carpeta_destino
        movidos.append(pid)
    if movidos:
        _save_all(items)
    return movidos, errores


def renombrar_carpeta_plantilla(carpeta: str, nombre_nuevo: str) -> str:
    """Renombra la carpeta (y sus subcarpetas, ya que 'carpeta' es solo un
    campo de texto): reemplaza el prefijo en cada plantilla y en el registro
    de carpetas vacías."""
    carpeta = (carpeta or "").strip().strip("/")
    if not carpeta:
        raise ValueError("Falta 'carpeta'")
    nombre_nuevo = _nombre_carpeta_plantilla_segura(nombre_nuevo)
    if not nombre_nuevo:
        raise ValueError("Nombre nuevo inválido")

    partes = carpeta.split("/")
    carpeta_padre = "/".join(partes[:-1])
    nueva = f"{carpeta_padre}/{nombre_nuevo}" if carpeta_padre else nombre_nuevo
    if nueva == carpeta:
        return carpeta

    todas_existentes = set(listar_todas_carpetas_plantillas())
    if carpeta not in todas_existentes:
        raise ValueError("Carpeta no encontrada")
    if nueva in todas_existentes:
        raise ValueError("Ya existe una carpeta con ese nombre")

    def _reemplazar_prefijo(valor: str) -> str:
        if valor == carpeta:
            return nueva
        if valor.startswith(carpeta + "/"):
            return nueva + valor[len(carpeta):]
        return valor

    items = _load_all()
    cambiado = False
    for p in items:
        actual = (p.get("carpeta") or "").strip().strip("/")
        if not actual:
            continue
        nuevo_valor = _reemplazar_prefijo(actual)
        if nuevo_valor != actual:
            p["carpeta"] = nuevo_valor
            cambiado = True
    if cambiado:
        _save_all(items)

    registro = _load_carpetas_registro()
    registro_nuevo = [_reemplazar_prefijo(c.strip("/")) for c in registro]
    if registro_nuevo != registro:
        _save_carpetas_registro(registro_nuevo)

    return nueva


def obtener_plantilla(pid: str) -> dict | None:
    pid = (pid or "").strip()
    if not pid:
        return None
    for p in _load_all():
        if p.get("id") == pid:
            return p
    return None


def _copia_fiel_json(val: Any) -> Any:
    """Copia profunda sin alterar números ni orden de capas."""
    return json.loads(json.dumps(val, ensure_ascii=False))


def guardar_plantilla(body: dict) -> dict:
    pid = (body.get("id") or "").strip() or uuid.uuid4().hex[:12]
    nombre = (body.get("nombre") or "").strip() or "Sin título"
    now = _now()
    formato = body.get("formato")
    elementos = body.get("elementos")
    todas = _load_all()
    existente = next((p for p in todas if p.get("id") == pid), None)
    # Si el body no manda 'carpeta' (p. ej. un guardado que no la conoce),
    # conserva la que ya tenía la plantilla en vez de devolverla a la raíz.
    carpeta = body.get("carpeta")
    if carpeta is None:
        carpeta = (existente or {}).get("carpeta") or ""
    entry = {
        "id": pid,
        "nombre": nombre,
        "categoria": (body.get("categoria") or "general").strip(),
        "carpeta": str(carpeta).strip().strip("/"),
        "formato": _copia_fiel_json(formato) if isinstance(formato, dict) else {},
        "fondo": body.get("fondo") or "#ffffff",
        "elementos": _copia_fiel_json(elementos) if isinstance(elementos, list) else [],
        "created_at": body.get("created_at") or now,
        "updated_at": now,
    }
    items = [p for p in todas if p.get("id") != pid]
    items.insert(0, entry)
    _save_all(items)
    return entry


def eliminar_plantilla(pid: str) -> bool:
    pid = (pid or "").strip()
    if not pid:
        return False
    items = [p for p in _load_all() if p.get("id") != pid]
    if len(items) == len(_load_all()):
        return False
    _save_all(items)
    return True


def _nombre_asset_seguro(nombre: str) -> str:
    base = Path((nombre or "").strip()).name or "imagen.png"
    base = re.sub(r"[^\w.\-]+", "_", base)
    if not base.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        base += ".png"
    return base


def guardar_asset(nombre: str, data_b64: str) -> dict:
    raw = (data_b64 or "").strip()
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception as exc:
        raise ValueError("Imagen inválida") from exc
    if len(blob) > _MAX_ASSET_BYTES:
        raise ValueError("Imagen demasiado grande (máx 8 MB)")
    _ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex[:10]}_{_nombre_asset_seguro(nombre)}"
    path = _ASSETS_DIR / fname
    path.write_bytes(blob)
    return {"nombre": fname, "url": f"/api/plantillas-visuales/assets/{fname}"}


def listar_assets(limite: int = 200) -> list[dict]:
    if not _ASSETS_DIR.is_dir():
        return []
    out: list[dict] = []
    archivos = sorted(
        (p for p in _ASSETS_DIR.iterdir() if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for path in archivos:
        ext = path.suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".jpe"):
            continue
        out.append({
            "nombre": path.name,
            "url": f"/api/plantillas-visuales/assets/{path.name}",
            "bytes": path.stat().st_size,
            "subido_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
        })
        if len(out) >= limite:
            break
    return out


def eliminar_asset(nombre: str) -> bool:
    path = ruta_asset(nombre)
    if not path:
        return False
    try:
        path.unlink()
    except OSError:
        return False
    return True


def ruta_asset(nombre: str) -> Path | None:
    fname = _nombre_asset_seguro(nombre)
    path = _ASSETS_DIR / fname
    if path.is_file():
        return path
    # Buscar por sufijo (uuid_nombre)
    for p in _ASSETS_DIR.glob(f"*_{fname}"):
        if p.is_file():
            return p
    direct = _ASSETS_DIR / (nombre or "")
    return direct if direct.is_file() else None


def _hex_color(color: str, default: str = "#000000"):
    from reportlab.lib.colors import HexColor, black

    c = (color or "").strip()
    if not c or c.lower() in ("transparent", "none"):
        return None
    try:
        return HexColor(c)
    except Exception:
        return HexColor(default) if default else black


def _cargar_imagen_rl(src: str):
    from reportlab.lib.utils import ImageReader

    src = (src or "").strip()
    if not src:
        return None
    if src.startswith("data:"):
        raw = src.split(",", 1)[1] if "," in src else ""
        try:
            return ImageReader(io.BytesIO(base64.b64decode(raw)))
        except Exception:
            return None
    if src.startswith("/api/plantillas-visuales/assets/"):
        fname = src.rsplit("/", 1)[-1]
        path = ruta_asset(fname)
        if path:
            return ImageReader(str(path))
    path = Path(src)
    if path.is_file():
        return ImageReader(str(path))
    return None


def exportar_pdf(plantilla: dict) -> bytes:
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas as rl_canvas

    fmt = plantilla.get("formato") or {}
    w_px = float(fmt.get("ancho_px") or 800)
    h_px = float(fmt.get("alto_px") or 600)
    dpi = float(fmt.get("dpi") or 96)
    w_pt = w_px / dpi * 72
    h_pt = h_px / dpi * 72

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(w_pt, h_pt))

    fondo = _hex_color(plantilla.get("fondo") or "#ffffff", "#ffffff")
    if fondo:
        c.setFillColor(fondo)
        c.rect(0, 0, w_pt, h_pt, fill=1, stroke=0)

    elementos = sorted(
        plantilla.get("elementos") or [],
        key=lambda e: int(e.get("zIndex") or 0),
    )

    for el in elementos:
        tipo = (el.get("type") or "").strip()
        x = float(el.get("x") or 0) / dpi * 72
        y_top = float(el.get("y") or 0) / dpi * 72
        w = float(el.get("width") or 0) / dpi * 72
        h = float(el.get("height") or 0) / dpi * 72
        y = h_pt - y_top - h

        if tipo == "rect":
            fill = _hex_color(el.get("fill") or "transparent")
            stroke = _hex_color(el.get("stroke") or "transparent")
            sw = float(el.get("strokeWidth") or 0) / dpi * 72
            if fill:
                c.setFillColor(fill)
            if stroke and sw > 0:
                c.setStrokeColor(stroke)
                c.setLineWidth(sw)
            c.roundRect(
                x, y, w, h,
                float(el.get("borderRadius") or 0) / dpi * 72,
                fill=1 if fill else 0,
                stroke=1 if stroke and sw > 0 else 0,
            )

        elif tipo == "line":
            stroke = _hex_color(el.get("stroke") or "#000000")
            if not stroke:
                continue
            x2 = float(el.get("x2") or el.get("x") or 0) / dpi * 72
            y2_top = float(el.get("y2") or el.get("y") or 0) / dpi * 72
            y2 = h_pt - y2_top
            c.setStrokeColor(stroke)
            c.setLineWidth(float(el.get("strokeWidth") or 1) / dpi * 72)
            c.line(x, h_pt - y_top, x2, y2)

        elif tipo == "text":
            color = _hex_color(el.get("color") or "#000000")
            if not color:
                continue
            c.setFillColor(color)
            size = float(el.get("fontSize") or 16) / dpi * 72
            font = "Helvetica-Bold" if str(el.get("fontWeight") or "") in ("bold", "700") else "Helvetica"
            c.setFont(font, max(4, size))
            texto = str(el.get("content") or "")
            align = (el.get("align") or "left").strip()
            for i, linea in enumerate(texto.split("\n")):
                ly = y + h - size * (i + 1) * 1.2
                if align == "center":
                    c.drawCentredString(x + w / 2, ly, linea)
                elif align == "right":
                    c.drawRightString(x + w, ly, linea)
                else:
                    c.drawString(x, ly, linea)

        elif tipo == "image":
            img = _cargar_imagen_rl(el.get("src") or "")
            if img:
                c.drawImage(img, x, y, width=w, height=h, preserveAspectRatio=True, mask="auto")

    c.showPage()
    c.save()
    return buf.getvalue()


_FUENTES_RASTER = {
    # El editor DOM usa Montserrat; DejaVu queda de respaldo.
    "400": ("montserrat/Montserrat-Regular.ttf", "dejavu/DejaVuSans.ttf"),
    "500": ("montserrat/Montserrat-Medium.ttf", "dejavu/DejaVuSans.ttf"),
    "600": ("montserrat/Montserrat-SemiBold.ttf", "dejavu/DejaVuSans-Bold.ttf"),
    "700": ("montserrat/Montserrat-Bold.ttf", "dejavu/DejaVuSans-Bold.ttf"),
}


def _fuente_raster(weight: str, size: int):
    from PIL import ImageFont

    w = str(weight or "400")
    if w in ("bold",):
        w = "700"
    if w not in _FUENTES_RASTER:
        w = "700" if w in ("800", "900") else "400"
    for rel in _FUENTES_RASTER[w]:
        try:
            return ImageFont.truetype(f"/usr/share/fonts/truetype/{rel}", max(4, size))
        except Exception:
            continue
    return ImageFont.load_default()


def _texto_arco_raster(img, el: dict, contenido: str, fnt, medidor, ss: int) -> None:
    """Texto sobre un arco (misma geometría que TextoArcoSvg.tsx):
    arco ∈ [-200, 200]; hasta ±100 la sagitta crece a semicírculo
    (diámetro = ancho de la caja); de ±100 a ±200 el radio queda fijo en
    ancho/2 y el barrido crece de 180° a 360° (±200 = círculo completo)."""
    import math

    from PIL import Image, ImageDraw

    texto = " ".join((contenido or "").split())
    if not texto:
        return
    x = float(el.get("x") or 0) * ss
    y = float(el.get("y") or 0) * ss
    w = float(el.get("width") or 0) * ss
    fs = float(el.get("fontSize") or 16) * ss
    arco = max(-200.0, min(200.0, float(el.get("arco") or 0)))
    mag = abs(arco)
    sag = (min(mag, 100.0) / 100.0) * (w / 2.0)
    if sag <= 0 or w <= 0:
        return
    up = arco > 0
    if mag > 100.0:
        R = w / 2.0
        theta = math.pi * (1.0 + (mag - 100.0) / 100.0)
    else:
        R = sag / 2.0 + (w * w) / (8.0 * sag)
        theta = 2.0 * math.asin(min(1.0, (w / 2.0) / R))
    y0 = (sag + fs) if up else fs
    L = R * theta

    anchos = [medidor.textlength(ch, font=fnt) for ch in texto]
    W = sum(anchos)
    cx = x + w / 2.0
    cy = (y + y0 + (R - sag)) if up else (y + y0 + sag - R)

    s = max(0.0, L / 2.0 - W / 2.0)  # centrado como textAnchor=middle
    for ch, cw in zip(texto, anchos):
        centro_s = s + cw / 2.0
        s += cw
        a = (centro_s / L) * theta - theta / 2.0  # ángulo respecto al ápice
        if up:
            px = cx + R * math.sin(a)
            py = cy - R * math.cos(a)
            radial = (math.sin(a), -math.cos(a))
            rot = -math.degrees(a)
        else:
            px = cx + R * math.sin(a)
            py = cy + R * math.cos(a)
            radial = (math.sin(a), math.cos(a))
            rot = math.degrees(a)
        # centro del glifo ligeramente hacia afuera de la línea base
        gx = px + radial[0] * fs * 0.35
        gy = py + radial[1] * fs * 0.35

        lado = int(math.ceil(max(cw, fs) * 2))
        tile = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text(
            (lado / 2, lado / 2), ch, font=fnt, fill=el.get("color") or "#000", anchor="mm"
        )
        tile = tile.rotate(rot, resample=Image.Resampling.BICUBIC, expand=False)
        img.paste(tile, (int(gx - lado / 2), int(gy - lado / 2)), tile)


def _wrap_texto_raster(texto: str, fnt, medidor, ancho: float) -> list[str]:
    """Word-wrap equivalente al DOM (rompe en espacios, respeta \\n)."""
    lineas: list[str] = []
    for parrafo in (texto or "").split("\n"):
        actual = ""
        for palabra in parrafo.split(" "):
            cand = (actual + " " + palabra).strip()
            if actual and medidor.textlength(cand, font=fnt) > ancho:
                lineas.append(actual)
                actual = palabra
            else:
                actual = cand
        lineas.append(actual)
    return lineas


def exportar_raster(plantilla: dict, formato: str = "png", escala: float = 1.0) -> bytes:
    """Render fiel al editor DOM: Montserrat con word-wrap y line-height 1.2,
    alineación por línea e imágenes con objectFit contain (incluye SVG data-URI
    vía cairosvg cuando está disponible). Se dibuja a 3× y se reescala."""
    from PIL import Image, ImageDraw

    escala = max(0.25, min(8.0, float(escala or 1)))
    ss = 3  # supersampling interno para nitidez de texto
    fmt = plantilla.get("formato") or {}
    w = int(fmt.get("ancho_px") or 800)
    h = int(fmt.get("alto_px") or 600)
    fondo = (plantilla.get("fondo") or "#ffffff").strip()
    if fondo.lower() in ("transparent", "none"):
        img = Image.new("RGBA", (w * ss, h * ss), (255, 255, 255, 0))
    else:
        img = Image.new("RGBA", (w * ss, h * ss), fondo)
    draw = ImageDraw.Draw(img)
    medidor = ImageDraw.Draw(Image.new("RGB", (8, 8)))

    elementos = sorted(
        plantilla.get("elementos") or [],
        key=lambda e: int(e.get("zIndex") or 0),
    )

    for el in elementos:
        if el.get("visible") is False:
            continue
        tipo = (el.get("type") or "").strip()
        x = float(el.get("x") or 0)
        y = float(el.get("y") or 0)
        ew = float(el.get("width") or 0)
        eh = float(el.get("height") or 0)

        if tipo == "rect":
            fill = el.get("fill") or None
            stroke = el.get("stroke") or None
            # strokeWidth admite fracciones (pasos de 0.25 en el editor)
            sw = float(el.get("strokeWidth") or 0)
            sw_px = max(1, int(round(sw * ss))) if sw > 0 else 0
            caja = [x * ss, y * ss, (x + ew) * ss, (y + eh) * ss]
            # borderRadius como en CSS: se limita a la mitad del lado menor,
            # de modo que un cuadrado con radio grande es un círculo.
            radio = min(
                float(el.get("borderRadius") or 0) * ss,
                min(ew, eh) * ss / 2,
            )
            kwargs = {}
            if fill and str(fill).lower() not in ("transparent", "none"):
                kwargs["fill"] = fill
            if stroke and sw_px:
                kwargs.update(outline=stroke, width=sw_px)
            if kwargs:
                if radio > 0:
                    draw.rounded_rectangle(caja, radius=radio, **kwargs)
                else:
                    draw.rectangle(caja, **kwargs)

        elif tipo == "line":
            x2 = float(el.get("x2") or x)
            y2 = float(el.get("y2") or y)
            draw.line(
                [x * ss, y * ss, x2 * ss, y2 * ss],
                fill=el.get("stroke") or "#000000",
                width=max(1, int(float(el.get("strokeWidth") or 1) * ss)),
            )

        elif tipo == "text":
            contenido = str(el.get("content") or "")
            if not contenido:
                continue
            size = float(el.get("fontSize") or 16)
            lh = float(el.get("lineHeight") or 1.2)
            align = (el.get("align") or "left").lower()
            fnt = _fuente_raster(str(el.get("fontWeight") or ""), int(round(size * ss)))
            if float(el.get("arco") or 0):
                _texto_arco_raster(img, el, contenido, fnt, medidor, ss)
                continue
            lineas = _wrap_texto_raster(contenido, fnt, medidor, ew * ss)
            cy = y * ss
            for linea in lineas:
                ancho_ln = medidor.textlength(linea, font=fnt)
                if align == "center":
                    cx = x * ss + (ew * ss - ancho_ln) / 2
                elif align == "right":
                    cx = x * ss + ew * ss - ancho_ln
                else:
                    cx = x * ss
                draw.text((cx, cy), linea, fill=el.get("color") or "#000000", font=fnt)
                cy += size * lh * ss

        elif tipo == "image":
            src = (el.get("src") or "").strip()
            if not src:
                continue
            try:
                bw, bh = max(1, int(ew * ss)), max(1, int(eh * ss))
                if src.startswith("data:image/svg+xml"):
                    import cairosvg

                    svg = base64.b64decode(src.split(",", 1)[1])
                    png = cairosvg.svg2png(bytestring=svg, output_width=bw, output_height=bh)
                    piece = Image.open(io.BytesIO(png)).convert("RGBA")
                elif src.startswith("data:"):
                    piece = Image.open(io.BytesIO(base64.b64decode(src.split(",", 1)[1]))).convert("RGBA")
                else:
                    path = None
                    m = re.match(r"^/(?:app/)?api/etiquetas/recursos-png/archivo/(.+)$", src)
                    if m:
                        from urllib.parse import unquote

                        from app.tools.etiquetas_studio import _carpeta_recursos_png

                        nombre = unquote(m.group(1))
                        base = _carpeta_recursos_png()
                        for cand in [base / nombre, *base.rglob(nombre)]:
                            if cand.is_file():
                                path = cand
                                break
                    elif src.startswith("/api/plantillas-visuales/assets/") or src.startswith("/app/api/plantillas-visuales/assets/"):
                        path = ruta_asset(src.rsplit("/", 1)[-1])
                    elif Path(src).is_file():
                        path = Path(src)
                    if not path:
                        continue
                    piece = Image.open(path).convert("RGBA")
                # objectFit contain (comportamiento del editor): conserva proporción
                if (el.get("objectFit") or "contain").lower() == "fill":
                    piece = piece.resize((bw, bh))
                    ox = oy = 0
                else:
                    ratio = min(bw / piece.width, bh / piece.height)
                    nw, nh = max(1, int(piece.width * ratio)), max(1, int(piece.height * ratio))
                    piece = piece.resize((nw, nh))
                    ox, oy = (bw - nw) // 2, (bh - nh) // 2
                img.paste(piece, (int(x * ss) + ox, int(y * ss) + oy), piece)
            except Exception:
                continue

    new_w = max(1, int(round(w * escala)))
    new_h = max(1, int(round(h * escala)))
    if (new_w, new_h) != img.size:
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    out = io.BytesIO()
    formato = (formato or "png").lower()
    if formato in ("jpg", "jpeg"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
        img.save(out, format="JPEG", quality=92)
    else:
        img.save(out, format="PNG")
    return out.getvalue()
