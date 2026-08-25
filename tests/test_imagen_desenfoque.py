"""Tests puros de desenfoque de regiones (sin API MeLi)."""
from __future__ import annotations

from io import BytesIO


def _png_gradiente(w: int = 200, h: int = 200) -> bytes:
    from PIL import Image

    im = Image.new("RGB", (w, h), (240, 240, 240))
    # Franja inferior con patrón de alto contraste (texto simulado)
    for y in range(int(h * 0.85), h):
        for x in range(w):
            im.putpixel((x, y), (20, 20, 20) if (x // 4 + y // 2) % 2 == 0 else (220, 220, 40))
    # Marca en zona media con patrón (blur sí cambia píxeles)
    for y in range(40, 60):
        for x in range(50, 150):
            im.putpixel(
                (x, y),
                (180, 30, 30) if (x + y) % 3 == 0 else (30, 180, 80),
            )
    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_region_pie_defaults():
    from app.services.imagen_desenfoque import region_pie

    r = region_pie(0.15)
    assert r["x"] == 0.0
    assert r["w"] == 1.0
    assert abs(r["y"] - 0.85) < 1e-9
    assert abs(r["h"] - 0.15) < 1e-9


def test_aplicar_desenfoque_cambia_pie():
    from PIL import Image

    from app.services.imagen_desenfoque import aplicar_desenfoque, region_pie

    raw = _png_gradiente(200, 200)
    out, meta = aplicar_desenfoque(raw, [region_pie(0.15)], radio=20, out_format="PNG")
    assert meta["width"] == 200
    assert meta["height"] == 200
    assert len(out) > 100

    with Image.open(BytesIO(raw)) as a, Image.open(BytesIO(out)) as b:
        a = a.convert("RGB")
        b = b.convert("RGB")
        # Pixel en el pie debe diferir tras blur
        pa = a.getpixel((100, 190))
        pb = b.getpixel((100, 190))
        assert pa != pb
        # Zona superior sin región no debe cambiar (mismo color sólido)
        assert a.getpixel((10, 10)) == b.getpixel((10, 10))


def test_aplicar_desenfoque_rectangulo_medio():
    from PIL import Image

    from app.services.imagen_desenfoque import aplicar_desenfoque

    raw = _png_gradiente(200, 200)
    reg = {"x": 0.25, "y": 0.2, "w": 0.5, "h": 0.1}
    out, _ = aplicar_desenfoque(raw, [reg], radio=16, out_format="PNG")
    with Image.open(BytesIO(raw)) as a, Image.open(BytesIO(out)) as b:
        a, b = a.convert("RGB"), b.convert("RGB")
        assert a.getpixel((100, 50)) != b.getpixel((100, 50))
        # Pie sin tocar
        assert a.getpixel((100, 190)) == b.getpixel((100, 190))


def test_normalizar_regiones_modo_pie_y_extra():
    from app.services.imagen_desenfoque import normalizar_regiones

    regs = normalizar_regiones(
        [{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}],
        modo="pie",
        pie_pct=0.2,
    )
    assert len(regs) == 2
    assert abs(regs[0]["h"] - 0.2) < 1e-9


def test_resolver_picture_ids():
    from app.services.imagen_desenfoque import resolver_picture_ids

    pics = [{"id": "A"}, {"id": "B"}, {"id": "C"}]
    assert resolver_picture_ids(pics, None) == ["A"]
    assert resolver_picture_ids(pics, "principal") == ["A"]
    assert resolver_picture_ids(pics, "todas") == ["A", "B", "C"]
    assert resolver_picture_ids(pics, ["B", "C"]) == ["B", "C"]


def test_preview_base64():
    from app.services.imagen_desenfoque import aplicar_desenfoque, preview_base64, region_pie

    raw = _png_gradiente()
    out, meta = aplicar_desenfoque(raw, [region_pie()], radio=12, out_format="JPEG")
    prev = preview_base64(out, meta)
    assert prev["ok"]
    assert prev["preview_base64"].startswith("data:image/jpeg;base64,")
