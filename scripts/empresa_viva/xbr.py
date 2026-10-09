"""2xBR (Hyllian, nivel 2): escala pixel art al doble suavizando bordes y diagonales sin emborronar.

Empresa viva pasó a un estilo HD-2D (9-oct-2026, pedido: «menos pixelado, más píxeles»): todo el arte
del barrio se dibuja como siempre en armar_mapa.py y aquí se lleva al doble antes de empacarlo, para
que en pantalla cada píxel de arte se vea con cuatro (las diagonales y las curvas quedan suaves).
Los personajes se escalan en el navegador con el mismo algoritmo (desktop/src/components/empresa/xbr.ts),
porque se recolorean por piezas al armarlos.

Algoritmo: el 2xBR de Hyllian (lv2), como el `xbr.c` de libretro. Para cada píxel E se mira su vecindario
de 5 × 5, se comparan los pesos de los dos posibles bordes diagonales de cada esquina y, si hay borde, la
esquina (y a veces sus vecinas) se mezcla con el color del otro lado. Las distancias van en YUV (más
peso al brillo) y con el alfa; las mezclas en alfa premultiplicado, para que los bordes de los sprites
no queden con un halo oscuro. Vectorizado con numpy, por bloques (el suelo del barrio es grande).
"""
from __future__ import annotations

import numpy as np
from PIL import Image

_BLOQUE = 384


def _yuva(p: np.ndarray) -> np.ndarray:
    """RGBA premultiplicado (float) → (Y, U, V, A) para las distancias."""
    r, g, b, a = p[..., 0], p[..., 1], p[..., 2], p[..., 3]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.169 * r - 0.331 * g + 0.5 * b
    v = 0.5 * r - 0.419 * g - 0.081 * b
    return np.stack([y, u, v, a], axis=-1)


def _df(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = np.abs(a - b)
    return 48 * d[..., 0] + 7 * d[..., 1] + 6 * d[..., 2] + 48 * d[..., 3]


def _eq(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = np.abs(a - b)
    return (d[..., 0] <= 48) & (d[..., 1] <= 7) & (d[..., 2] <= 6) & (d[..., 3] <= 48)


def _ne(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Distinto de verdad (los cuatro canales), como el `PE != PH` del original."""
    return np.any(a != b, axis=-1)


def _bloque(rgba: np.ndarray) -> np.ndarray:
    """2xBR de un bloque RGBA premultiplicado (float32, alto × ancho × 4) con 2 px de margen ya puestos."""
    H, W = rgba.shape[0] - 4, rgba.shape[1] - 4
    yuv = _yuva(rgba)

    def n(dx: int, dy: int) -> tuple[np.ndarray, np.ndarray]:
        """(color, yuv) del vecino en (dx, dy) para todo el bloque."""
        return rgba[2 + dy:2 + dy + H, 2 + dx:2 + dx + W], yuv[2 + dy:2 + dy + H, 2 + dx:2 + dx + W]

    # Vecindario (nombres del original):
    #        A1 B1 C1
    #     A0 PA PB PC C4
    #     D0 PD PE PF F4
    #     G0 PG PH PI I4
    #        G5 H5 I5
    V = {
        "A1": n(-1, -2), "B1": n(0, -2), "C1": n(1, -2),
        "A0": n(-2, -1), "PA": n(-1, -1), "PB": n(0, -1), "PC": n(1, -1), "C4": n(2, -1),
        "D0": n(-2, 0), "PD": n(-1, 0), "PE": n(0, 0), "PF": n(1, 0), "F4": n(2, 0),
        "G0": n(-2, 1), "PG": n(-1, 1), "PH": n(0, 1), "PI": n(1, 1), "I4": n(2, 1),
        "G5": n(-1, 2), "H5": n(0, 2), "I5": n(1, 2),
    }
    pe = V["PE"][0]
    E = [pe.copy(), pe.copy(), pe.copy(), pe.copy()]   # 0 arriba-izq, 1 arriba-der, 2 abajo-izq, 3 abajo-der

    def mezcla(i: int, mask: np.ndarray, color: np.ndarray, peso: float):
        m = mask[..., None]
        E[i] = np.where(m, E[i] + (color - E[i]) * peso, E[i])

    def filtro(PE, PI, PH, PF, PG, PC, PD, PB, PA, G5, C4, G0, D0, C1, B1, F4, I4, H5, I5, A0, A1, N0, N1, N2, N3):
        c = lambda k: V[k][0]
        y = lambda k: V[k][1]
        df = lambda a, b: _df(y(a), y(b))
        eq = lambda a, b: _eq(y(a), y(b))
        ne = lambda a, b: _ne(c(a), c(b))
        base = ne(PE, PH) & ne(PE, PF)
        e = df(PE, PC) + df(PE, PG) + df(PI, H5) + df(PI, F4) + 4 * df(PH, PF)
        i = df(PH, PD) + df(PH, I5) + df(PF, I4) + df(PF, PB) + 4 * df(PE, PI)
        cond = (e < i) & ((~eq(PF, PB) & ~eq(PH, PD)) | (eq(PE, PI) & ~eq(PF, I4) & ~eq(PH, I5)) | eq(PE, PG) | eq(PE, PC))
        borde = base & cond
        ke, ki = df(PF, PG), df(PH, PC)
        ex2 = ne(PE, PC) & ne(PB, PC)
        ex3 = ne(PE, PG) & ne(PD, PG)
        px = np.where((df(PE, PF) <= df(PE, PH))[..., None], c(PF), c(PH))
        izq = (2 * ke <= ki) & ex3
        arr = (ke >= 2 * ki) & ex2
        ambos = borde & izq & arr
        solo_izq = borde & izq & ~arr
        solo_arr = borde & arr & ~izq
        dia = borde & ~izq & ~arr
        # LEFT_UP_2_2X: N3 192/256, N2 64/256 y N1 = N2
        mezcla(N3, ambos | solo_izq | solo_arr, px, 0.75)
        mezcla(N2, ambos | solo_izq, px, 0.25)
        mezcla(N1, solo_arr, px, 0.25)
        E[N1] = np.where(ambos[..., None], E[N2], E[N1])
        mezcla(N3, dia, px, 0.5)
        suave = base & ~borde & (e <= i)
        mezcla(N3, suave, px, 0.5)

    filtro("PE", "PI", "PH", "PF", "PG", "PC", "PD", "PB", "PA", "G5", "C4", "G0", "D0", "C1", "B1", "F4", "I4", "H5", "I5", "A0", "A1", 0, 1, 2, 3)
    filtro("PE", "PC", "PF", "PB", "PI", "PA", "PH", "PD", "PG", "I4", "A1", "I5", "H5", "A0", "D0", "B1", "C1", "F4", "C4", "G5", "G0", 2, 0, 3, 1)
    filtro("PE", "PA", "PB", "PD", "PC", "PG", "PF", "PH", "PI", "C1", "G0", "C4", "F4", "G5", "H5", "D0", "A0", "B1", "A1", "I4", "I5", 3, 2, 1, 0)
    filtro("PE", "PG", "PD", "PH", "PA", "PI", "PB", "PF", "PC", "A0", "I5", "A1", "B1", "I4", "F4", "H5", "G5", "D0", "G0", "C1", "C4", 1, 3, 0, 2)
    out = np.empty((H * 2, W * 2, 4), dtype=np.float32)
    out[0::2, 0::2], out[0::2, 1::2], out[1::2, 0::2], out[1::2, 1::2] = E[0], E[1], E[2], E[3]
    return out


def xbr2x(im: Image.Image) -> Image.Image:
    """La imagen al doble con 2xBR (RGBA)."""
    im = im.convert("RGBA")
    a = np.asarray(im, dtype=np.float32)
    alfa = a[..., 3:4] / 255.0
    pre = np.concatenate([a[..., :3] * alfa, a[..., 3:4]], axis=-1)      # premultiplicado
    H, W = pre.shape[:2]
    # Margen de 2 px repitiendo el borde (como las texturas que se repiten, sin inventar transparencia).
    pad = np.pad(pre, ((2, 2), (2, 2), (0, 0)), mode="edge")
    out = np.empty((H * 2, W * 2, 4), dtype=np.float32)
    for y0 in range(0, H, _BLOQUE):
        for x0 in range(0, W, _BLOQUE):
            y1, x1 = min(H, y0 + _BLOQUE), min(W, x0 + _BLOQUE)
            trozo = pad[y0:y1 + 4, x0:x1 + 4]
            out[y0 * 2:y1 * 2, x0 * 2:x1 * 2] = _bloque(trozo)
    a2 = out[..., 3:4]
    rgb = np.where(a2 > 0, out[..., :3] * 255.0 / np.maximum(a2, 1e-6), 0)
    res = np.concatenate([np.clip(rgb, 0, 255), np.clip(a2, 0, 255)], axis=-1).round().astype(np.uint8)
    return Image.fromarray(res, "RGBA")


def xbr2x_sprite(im: Image.Image, ancla: tuple[int, int]) -> tuple[Image.Image, tuple[int, int]]:
    """Un sprite suelto: con un margen transparente (para que el borde no se repita) y el ancla al doble."""
    m = 2
    con = Image.new("RGBA", (im.width + 2 * m, im.height + 2 * m), (0, 0, 0, 0))
    con.alpha_composite(im.convert("RGBA"), (m, m))
    g = xbr2x(con).crop((2 * m, 2 * m, 2 * m + im.width * 2, 2 * m + im.height * 2))
    return g, (ancla[0] * 2, ancla[1] * 2)
