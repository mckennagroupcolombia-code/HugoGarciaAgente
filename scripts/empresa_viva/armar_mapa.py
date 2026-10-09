#!/usr/bin/env python3
"""Arma el barrio de «Empresa viva» en pixel art (estilo RPG de Super Nintendo) — se corre a mano.

Un solo plano (las constantes de abajo) produce TODO lo que el juego necesita, para que el dibujo y
la lógica no se desalineen nunca:

  desktop/public/empresa/pixel/
    suelo.png        el piso de todo el barrio: pasto, andenes, calle, pisos y muros de cada cuarto
    muebles.png/json atlas de muebles y objetos (se dibujan aparte y se ordenan por profundidad
                     con los personajes: quien pasa detrás de un estante queda detrás)
    techos/<casa>.png techo + fachada de cada casa (se desvanecen cuando el jugador entra)
    mapa.json        lugares, puestos, puntos con nombre, instancias de muebles, estantes de la
                     bodega, rejilla de choques (celdas de 16 px) — lo lee desktop/src/components/empresa/

Arte: pasto, árboles y arbustos del Liberated Pixel Cup (LPC Tile Atlas, CC-BY-SA 3.0 / GPL 3.0),
objetos de oficina de «LPC Revised: The Office» (CC-BY-SA 3.0 / OGA-BY 3.0); lo moderno que LPC no
trae (escritorios, estanterías, mesa de empaque, cocina, camas de hongos, moto, camión, Hugo, la
calle) se dibuja aquí mismo con la paleta y el contorno de LPC. Créditos en pixel/CREDITOS.md.

Uso:  python3 scripts/empresa_viva/armar_mapa.py [--cache DIR] [--vista vista.png]
Necesita red la primera vez (opengameart.org); las descargas quedan en ~/.cache/empresa_viva_lpc.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import random
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
SALIDA = REPO / "desktop" / "public" / "empresa" / "pixel"
T = 32            # baldosa
C = 16            # celda de choques
ANCHO_T, ALTO_T = 80, 70    # 46 de la empresa y el parque + 24 del vecindario (8-oct-2026)
W, H = ANCHO_T * T, ALTO_T * T
OGA = "https://opengameart.org/sites/default/files/"
FUENTES = {
    "atlas": ("Atlas_0.zip", "terrain_atlas.png"),
    "base": ("lpc_base_assets.zip", "LPC Base Assets/tiles/grass.png"),
    "oficina": ("lpc_-_the_office.zip", None),
}

# ─── Paleta (la de LPC: contorno vino oscuro, sombras cálidas) ───────────────
OUT = (39, 25, 32, 255)
SOMBRA = (20, 12, 18, 70)


def rgb(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mezclar(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)


def aclarar(c, t):
    return mezclar(c, (255, 255, 255), t)


def oscurecer(c, t):
    return mezclar(c, (20, 12, 18), t)


MADERA = [rgb("4a2c1d"), rgb("6e4128"), rgb("8f5a35"), rgb("b07848"), rgb("c99662")]
GRIS = [rgb("3b3d4a"), rgb("5a5e6e"), rgb("80869a"), rgb("a9b0c2"), rgb("d3d9e6")]
CREMA = [rgb("8a7a66"), rgb("b9a78c"), rgb("dccbb0"), rgb("efe3cc"), rgb("fbf4e4")]

rnd = random.Random(20261008)


# ─── Recursos LPC ────────────────────────────────────────────────────────────

class Fuentes:
    def __init__(self, cache: Path):
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self._zips: dict[str, zipfile.ZipFile] = {}

    def zip(self, nombre: str) -> zipfile.ZipFile:
        if nombre not in self._zips:
            ruta = self.cache / nombre
            if not ruta.exists():
                print(f"  bajando {nombre}…")
                with urllib.request.urlopen(OGA + nombre, timeout=120) as r:
                    ruta.write_bytes(r.read())
            self._zips[nombre] = zipfile.ZipFile(ruta)
        return self._zips[nombre]

    def imagen(self, zipname: str, ruta: str) -> Image.Image:
        z = self.zip(zipname)
        candidatos = [n for n in z.namelist() if n.endswith(ruta) and "__MACOSX" not in n]
        if not candidatos:
            raise FileNotFoundError(f"{ruta} no está en {zipname}")
        return Image.open(io.BytesIO(z.read(candidatos[0]))).convert("RGBA")


# ─── Primitivas de dibujo ────────────────────────────────────────────────────

def lienzo(w: int, h: int) -> Image.Image:
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def rect(im: Image.Image, x0, y0, x1, y1, color):
    """Rectángulo lleno [x0,x1) × [y0,y1)."""
    if x1 <= x0 or y1 <= y0:
        return
    ImageDraw.Draw(im).rectangle([x0, y0, x1 - 1, y1 - 1], fill=color)


def borde(im, x0, y0, x1, y1, color=OUT):
    d = ImageDraw.Draw(im)
    d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=color)


def caja(im, x, y, w, h_tapa, h_frente, tapa, frente, contorno=True, brillo=True):
    """Mueble visto desde arriba en 3/4: tapa (arriba) y frente (abajo, más oscuro)."""
    rect(im, x, y, x + w, y + h_tapa, tapa)
    rect(im, x, y + h_tapa, x + w, y + h_tapa + h_frente, frente)
    if brillo:
        rect(im, x + 1, y + 1, x + w - 1, y + 2, aclarar(tapa, 0.25))
    rect(im, x, y + h_tapa, x + w, y + h_tapa + 1, oscurecer(frente, 0.25))
    if contorno:
        borde(im, x, y, x + w, y + h_tapa + h_frente)


def ruido(im, x0, y0, x1, y1, colores, densidad=0.08, semilla=0):
    r = random.Random(semilla)
    px = im.load()
    for y in range(y0, y1):
        for x in range(x0, x1):
            if r.random() < densidad:
                px[x, y] = r.choice(colores)


def sombra_suelo(im, cx, cy, rx, ry, alfa=70):
    """Sombra elíptica bajo un mueble o un árbol."""
    s = lienzo(im.width, im.height)
    ImageDraw.Draw(s).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(20, 12, 18, alfa))
    im.alpha_composite(s)


# ─── Texturas de piso ────────────────────────────────────────────────────────

def textura_madera(w, h, base=None, semilla=1):
    base = base or [rgb("7a4a2c"), rgb("9a6038"), rgb("b4784a"), rgb("c88d5a")]
    im = lienzo(w, h)
    r = random.Random(semilla)
    alto = 8
    for fila, y in enumerate(range(0, h, alto)):
        desfase = (fila % 2) * 24 + r.randint(0, 8)
        x = -desfase
        while x < w:
            largo = r.choice([40, 48, 56, 64])
            c = r.choice(base[1:])
            rect(im, max(0, x), y, min(w, x + largo), min(h, y + alto), c)
            rect(im, max(0, x), y, min(w, x + largo), min(h, y + 1), aclarar(c, 0.12))
            rect(im, max(0, x), y + alto - 1, min(w, x + largo), min(h, y + alto), base[0])
            if 0 <= x < w:
                rect(im, x, y, x + 1, min(h, y + alto), base[0])
            # vetas
            for _ in range(2):
                vx = x + r.randint(4, largo - 4)
                if 0 <= vx < w:
                    rect(im, vx, y + 3, min(w, vx + r.randint(3, 9)), y + 4, oscurecer(c, 0.12))
            x += largo
    return im


def textura_baldosa(w, h, c1, c2, lado=16, junta=None):
    im = lienzo(w, h)
    junta = junta or oscurecer(c1, 0.2)
    for y in range(0, h, lado):
        for x in range(0, w, lado):
            c = c1 if ((x // lado) + (y // lado)) % 2 == 0 else c2
            rect(im, x, y, x + lado, y + lado, c)
            rect(im, x, y, x + lado, y + 1, junta)
            rect(im, x, y, x + 1, y + lado, junta)
            rect(im, x + 2, y + 2, x + 5, y + 3, aclarar(c, 0.35))
    return im


def textura_concreto(w, h, base, losa=64, semilla=3):
    im = lienzo(w, h)
    rect(im, 0, 0, w, h, base)
    ruido(im, 0, 0, w, h, [aclarar(base, 0.08), oscurecer(base, 0.07)], 0.12, semilla)
    for y in range(0, h, losa):
        rect(im, 0, y, w, y + 1, oscurecer(base, 0.22))
    for x in range(0, w, losa):
        rect(im, x, 0, x + 1, h, oscurecer(base, 0.22))
    return im


def textura_alfombra(w, h, base, borde_c):
    im = lienzo(w, h)
    rect(im, 0, 0, w, h, borde_c)
    rect(im, 3, 3, w - 3, h - 3, base)
    ruido(im, 3, 3, w - 3, h - 3, [aclarar(base, 0.1), oscurecer(base, 0.08)], 0.15, w * h)
    borde(im, 5, 5, w - 5, h - 5, aclarar(borde_c, 0.2))
    return im


# ─── Plano del barrio ────────────────────────────────────────────────────────
# Todo en baldosas de 32 px salvo que se diga otra cosa. x crece al oriente, y hacia la calle.

FILA_ANDEN_N = (32, 34)
FILA_CALLE = (34, 39)
FILA_ANDEN_S = (39, 41)
CARRIL_VUELTA_Y = int(35.5 * T)   # hacia el occidente (izquierda)
CARRIL_IDA_Y = int(37.7 * T)      # hacia el oriente (derecha)

# El vecindario (8-oct-2026): al sur del parque, terrenos de 8 × 8 baldosas donde cada quien compra el
# suyo y construye su casa (app/services/empresa_viva_vecindario.py; lo de cada casa lo dibuja el juego).
# Fila de arriba: la puerta mira al sur (a la calle de las casas); fila de abajo: mira al norte.
FILA_ANDEN_V = (46, 48)                       # andén del parque al vecindario
FILA_CALLE_V = (56, 59)                       # la calle de las casas (sin carros)
LOTE = 8                                      # baldosas por lado de un terreno
LOTES_X = [4, 13, 22, 31, 41, 50, 59, 68]     # x de cada terreno (en baldosas)
PASAJES_X = [(2, 4), (39, 41), (76, 78)]      # del andén a la calle, entre los terrenos de arriba
FILAS_LOTES = [(48, "abajo", 400, 450), (59, "arriba", 320, 360)]   # y, frente, precio, precio junto al pasaje central


@dataclass
class Cuarto:
    id: str
    casa: str
    titulo: str
    hace: str
    x0: int
    y0: int
    x1: int
    y1: int
    piso: str
    pared: str
    panel: str
    etapas: list[str] = field(default_factory=list)
    afuera: bool = False


@dataclass
class Casa:
    id: str
    titulo: str
    x0: int
    y0: int
    x1: int
    y1: int
    pared: str
    techo: str
    puerta_x: float      # centro de la puerta principal (baldosas), en el muro sur
    color_techo: str
    letrero: str


CASAS = [
    Casa("bunker", "Búnker Suba", 2, 3, 26, 28, "#e8e1d3", "plano", 13.5, "#6b7486", "BÚNKER SUBA"),
    Casa("sede", "Sede McKenna Sur", 28, 3, 56, 28, "#f1dfbf", "teja", 35.5, "#c0563b", "McKENNA SUR"),
    Casa("tienda", "Tienda digital", 66, 11, 79, 28, "#fff5dc", "toldo", 72.5, "#2d8fd5", "TIENDA DIGITAL"),
]
CASA = {c.id: c for c in CASAS}

CUARTOS = [
    # Búnker Suba
    Cuarto("gerencia", "bunker", "Gerencia", "El equipo y los números del negocio", 2, 3, 12, 14, "alfombra", "#dfe6ee", "dashboard", ["dirigir"]),
    Cuarto("pasillo_bunker", "bunker", "Pasillo", "", 12, 3, 15, 28, "madera", "#e8e1d3", ""),
    Cuarto("contabilidad", "bunker", "Contabilidad", "Pagos, Libro Mayor, terceros e impuestos", 15, 3, 26, 14, "madera", "#e9f0e2", "contabilidad-inicio", ["contar"]),
    Cuarto("estudio", "bunker", "Estudio de diseño", "El producto, sus fichas, etiquetas y fotos", 2, 14, 12, 21, "madera_clara", "#f4e9f2", "etiquetas", ["preparar", "publicar"]),
    Cuarto("sistemas", "bunker", "Sala de sistemas", "Conexiones, tareas automáticas, versiones y ajustes", 2, 21, 12, 28, "sistemas", "#e3ebf5", "mapa-sistema", ["sistema"]),
    Cuarto("cuarto_bunker_1", "bunker", "Cuarto", "Descanso", 15, 14, 26, 21, "madera", "#e6eef7", "hugo"),
    Cuarto("cuarto_bunker_2", "bunker", "Cuarto", "Descanso", 15, 21, 26, 28, "madera", "#f6e8e8", "hugo"),
    # Sede McKenna Sur
    Cuarto("oficina_sede", "sede", "Oficina de la sede", "Pedidos, empaque, guías y facturas (y la cocina)", 28, 3, 42, 19, "baldosa", "#f1dfbf", "empaque", ["entregar", "facturar"]),
    Cuarto("pasillo_sede", "sede", "Entrada", "", 34, 19, 37, 28, "madera", "#f1dfbf", ""),
    Cuarto("cuarto_sede_1", "sede", "Cuarto", "Descanso", 28, 19, 34, 28, "madera", "#e3efe6", "hugo"),
    Cuarto("cuarto_sede_2", "sede", "Cuarto", "Descanso", 37, 19, 42, 28, "madera", "#efe6dc", "hugo"),
    Cuarto("bodega", "sede", "Bodega", "Existencias: lo que hay, lo crítico y lo que hay que reponer", 42, 3, 56, 28, "concreto", "#d8d4cc", "control-inventario"),
    # Afuera de la sede
    Cuarto("recepcion", "sede", "Recepción y comercio exterior", "Proveedores, importaciones y lo que llega", 56, 8, 64, 28, "patio", "", "recepcion-mercancia", ["abastecer"], afuera=True),
    Cuarto("porton", "sede", "Portón de despacho", "Los mensajeros recogen los paquetes alistados", 28, 28, 43, 32, "patio", "", "entregas-flex", afuera=True),
    Cuarto("hongos", "sede", "Cultivo de hongos", "La línea de hongos: camas de cultivo y cosecha", 44, 28, 56, 32, "tierra", "", "control-inventario", afuera=True),
    # Tienda digital
    Cuarto("tienda", "tienda", "Tienda digital", "Preguntas de MercadoLibre y clientes de WhatsApp", 66, 11, 79, 28, "baldosa_tienda", "#fff5dc", "preventa", ["vender"]),
]
CUARTO = {c.id: c for c in CUARTOS}

# Puertas: (cuarto_a, cuarto_b, orientación, posición en baldosas a lo largo del muro, ancho en baldosas)
# «v» = muro vertical en x (entre a, al occidente, y b, al oriente); «h» = muro horizontal en y.
PUERTAS = [
    ("gerencia", "pasillo_bunker", "v", 12, 9.5, 1.5),
    ("pasillo_bunker", "contabilidad", "v", 15, 9.5, 1.5),
    ("estudio", "pasillo_bunker", "v", 12, 17.5, 1.5),
    ("sistemas", "pasillo_bunker", "v", 12, 24.5, 1.5),
    ("pasillo_bunker", "cuarto_bunker_1", "v", 15, 17.5, 1.5),
    ("pasillo_bunker", "cuarto_bunker_2", "v", 15, 24.5, 1.5),
    ("oficina_sede", "pasillo_sede", "h", 19, 35.5, 2),
    ("cuarto_sede_1", "pasillo_sede", "v", 34, 23.5, 1.5),
    ("pasillo_sede", "cuarto_sede_2", "v", 37, 23.5, 1.5),
    ("oficina_sede", "bodega", "v", 42, 12, 2),
    ("bodega", "recepcion", "v", 56, 14, 3),
]
GROSOR = 12            # muro visto desde arriba (px)
ALTO_PARED = 2 * T     # cara del muro norte de cada cuarto


# ─── Muebles (dibujados aquí) ────────────────────────────────────────────────
# Cada mueble devuelve (imagen, ancla) donde ancla = (x, y) del punto que toca el piso (centro
# abajo); el juego lo ordena por esa y.

def m_escritorio(ancho=64, color=None):
    color = color or MADERA
    im = lienzo(ancho, 44)
    sombra_suelo(im, ancho // 2, 41, ancho // 2 - 2, 3, 60)
    caja(im, 0, 8, ancho, 14, 18, color[3], color[1])
    # cajones a la derecha
    for k in range(2):
        rect(im, ancho - 22, 24 + k * 8, ancho - 4, 30 + k * 8, color[2])
        rect(im, ancho - 15, 26 + k * 8, ancho - 11, 27 + k * 8, CREMA[3])
    rect(im, 3, 40, 6, 44, color[0])
    rect(im, ancho - 6, 40, ancho - 3, 44, color[0])
    return im, (ancho // 2, 43)


def m_monitor_espalda():
    im = lienzo(26, 26)
    rect(im, 11, 18, 15, 24, GRIS[1])
    rect(im, 7, 23, 19, 25, GRIS[0])
    caja(im, 0, 0, 26, 3, 16, GRIS[1], GRIS[0])
    rect(im, 3, 6, 23, 7, GRIS[1])
    return im, (13, 25)


def m_silla_oficina(color="#2f3b55"):
    """Silla de oficina vista desde atrás-arriba: espaldar redondeado, asiento y la base de ruedas."""
    c = rgb(color)
    im = lienzo(26, 34)
    sombra_suelo(im, 13, 31, 10, 3, 60)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([5, 1, 21, 15], 4, fill=c, outline=OUT)
    rect(im, 7, 3, 19, 5, aclarar(c, 0.3))
    d.rounded_rectangle([3, 14, 23, 22], 3, fill=aclarar(c, 0.12), outline=OUT)
    rect(im, 12, 22, 14, 27, GRIS[0])
    for x in (5, 12, 19):
        rect(im, x, 27, x + 3, 30, GRIS[0])
    return im, (13, 30)


def m_estanteria(ancho=64, niveles=4, color="metal"):
    """Estantería vista de frente. «metal» = la de bodega (paral azul, vigas naranja, entrepaño
    galvanizado); «madera» = la de la tienda y las bibliotecas."""
    alto = 20 * niveles + 8
    im = lienzo(ancho, alto + 4)
    sombra_suelo(im, ancho // 2, alto + 1, ancho // 2, 3, 60)
    if color == "metal":
        fondo, entrepano, viga, paral = rgb("3a3f4b"), rgb("c9ced8"), rgb("f08c2e"), rgb("2f6fb5")
    else:
        fondo, entrepano, viga, paral = oscurecer(MADERA[1], 0.45), MADERA[3], MADERA[2], MADERA[2]
    rect(im, 0, 0, ancho, alto, fondo)
    for k in range(niveles):
        y = 4 + k * 20
        rect(im, 3, y, ancho - 3, y + 16, oscurecer(fondo, 0.25))
        rect(im, 0, y + 15, ancho, y + 18, viga)
        rect(im, 0, y + 15, ancho, y + 16, aclarar(viga, 0.3))
        rect(im, 0, y + 18, ancho, y + 20, entrepano)
    for x in (0, ancho - 4):
        rect(im, x, 0, x + 4, alto, paral)
        rect(im, x + 1, 0, x + 2, alto, aclarar(paral, 0.3))
        for y in range(4, alto, 6):
            rect(im, x + 2, y, x + 3, y + 2, oscurecer(paral, 0.4))
    rect(im, 0, 0, ancho, 3, viga if color == "metal" else MADERA[3])
    borde(im, 0, 0, ancho, alto)
    return im, (ancho // 2, alto)


def m_frasco(tapa="#ff6f3c", cuerpo="#f4f1ea", etiqueta="#2e86de"):
    im = lienzo(10, 14)
    rect(im, 2, 0, 8, 3, rgb(tapa))
    rect(im, 1, 3, 9, 13, rgb(cuerpo))
    rect(im, 1, 6, 9, 10, rgb(etiqueta))
    rect(im, 2, 4, 3, 12, aclarar(rgb(cuerpo), 0.4))
    borde(im, 1, 0, 9, 13)
    return im, (5, 13)


def m_bolsa(color="#c79a5b"):
    im = lienzo(12, 14)
    c = rgb(color)
    rect(im, 1, 2, 11, 14, c)
    rect(im, 3, 0, 9, 3, oscurecer(c, 0.1))
    rect(im, 3, 6, 9, 10, CREMA[4])
    rect(im, 2, 3, 3, 13, aclarar(c, 0.2))
    borde(im, 1, 2, 11, 14)
    return im, (6, 14)


def m_caja_carton(ancho=16, alto_tapa=6, alto_frente=10, etiqueta=None):
    im = lienzo(ancho, alto_tapa + alto_frente + 1)
    k = rgb("c8955a")
    caja(im, 0, 0, ancho, alto_tapa, alto_frente, aclarar(k, 0.12), oscurecer(k, 0.08))
    rect(im, ancho // 2 - 1, 0, ancho // 2 + 1, alto_tapa, rgb("e9d3a6"))
    if etiqueta:
        rect(im, 2, alto_tapa + 2, 8, alto_tapa + 6, rgb(etiqueta))
    return im, (ancho // 2, alto_tapa + alto_frente)


def m_mesa(ancho=96, fondo=40, color=None, patas=True):
    color = color or MADERA
    im = lienzo(ancho, fondo + 14)
    sombra_suelo(im, ancho // 2, fondo + 10, ancho // 2, 4, 55)
    caja(im, 0, 0, ancho, fondo - 8, 8, color[3], color[1])
    if patas:
        for x in (3, ancho - 7):
            rect(im, x, fondo, x + 4, fondo + 12, color[0])
    return im, (ancho // 2, fondo + 12)


def m_mesa_empaque():
    im, ancla = m_mesa(128, 44, [rgb("5d5f6b"), rgb("7d8090"), rgb("a2a6b6"), rgb("d0d4dc"), rgb("eef0f4")])
    # rollo de cinta, báscula y un rollo de papel burbuja
    rect(im, 10, 8, 26, 22, rgb("cfd8e3")); borde(im, 10, 8, 26, 22)
    rect(im, 13, 11, 23, 19, rgb("8f9bb0"))
    rect(im, 96, 6, 120, 20, GRIS[1]); borde(im, 96, 6, 120, 20)
    rect(im, 99, 9, 117, 13, rgb("9be7a5"))
    ImageDraw.Draw(im).ellipse([40, 8, 56, 24], fill=rgb("b48a52"), outline=OUT)
    ImageDraw.Draw(im).ellipse([45, 13, 51, 19], fill=rgb("e9d3a6"))
    return im, ancla


def m_biblioteca(ancho=64):
    im, ancla = m_estanteria(ancho, 4, "madera")
    r = random.Random(ancho)
    colores = ["#c0392b", "#2e86de", "#27ae60", "#f1c40f", "#8e44ad", "#e67e22", "#ecf0f1", "#34495e"]
    for k in range(4):
        y = 4 + k * 20
        x = 4
        while x < ancho - 6:
            w = r.randint(3, 5)
            hh = r.randint(10, 15)
            c = rgb(r.choice(colores))
            rect(im, x, y + 16 - hh, x + w, y + 16, c)
            rect(im, x, y + 16 - hh, x + 1, y + 16, aclarar(c, 0.3))
            x += w + (1 if r.random() < 0.8 else 4)
    return im, ancla


def m_archivador():
    im = lienzo(30, 52)
    sombra_suelo(im, 15, 49, 13, 3)
    caja(im, 0, 0, 30, 8, 42, GRIS[3], GRIS[2])
    for k in range(4):
        rect(im, 3, 11 + k * 10, 27, 19 + k * 10, GRIS[3])
        rect(im, 11, 14 + k * 10, 19, 16 + k * 10, GRIS[0])
        borde(im, 3, 11 + k * 10, 27, 19 + k * 10, GRIS[1])
    return im, (15, 50)


def m_sofa(ancho=96, color="#4f6d8f"):
    c = rgb(color)
    im = lienzo(ancho, 44)
    sombra_suelo(im, ancho // 2, 41, ancho // 2, 3)
    rect(im, 0, 4, ancho, 22, oscurecer(c, 0.1))         # espaldar
    rect(im, 2, 6, ancho - 2, 8, aclarar(c, 0.2))
    rect(im, 0, 20, ancho, 38, c)                        # cojines
    for k in range(1, 3):
        rect(im, ancho * k // 3, 20, ancho * k // 3 + 1, 34, oscurecer(c, 0.25))
    rect(im, 0, 14, 10, 40, oscurecer(c, 0.2))           # brazos
    rect(im, ancho - 10, 14, ancho, 40, oscurecer(c, 0.2))
    borde(im, 0, 4, ancho, 40)
    return im, (ancho // 2, 40)


def m_cama(color="#4a7fbf", doble=False):
    ancho = 64 if doble else 44
    c = rgb(color)
    im = lienzo(ancho, 86)
    sombra_suelo(im, ancho // 2, 82, ancho // 2, 4)
    rect(im, 0, 0, ancho, 14, MADERA[1]); borde(im, 0, 0, ancho, 14)       # cabecero
    rect(im, 2, 12, ancho - 2, 78, CREMA[4])
    for k in range(2 if doble else 1):
        x = 4 + k * 30
        rect(im, x, 16, x + (24 if doble else ancho - 8), 28, rgb("ffffff")); borde(im, x, 16, x + (24 if doble else ancho - 8), 28, CREMA[1])
    rect(im, 2, 34, ancho - 2, 78, c)                    # cobija
    rect(im, 2, 34, ancho - 2, 38, aclarar(c, 0.3))
    ruido(im, 3, 39, ancho - 3, 77, [oscurecer(c, 0.1)], 0.06, ancho)
    rect(im, 0, 76, ancho, 84, MADERA[0])
    borde(im, 0, 0, ancho, 84)
    return im, (ancho // 2, 84)


def m_mesa_noche():
    im = lienzo(26, 34)
    sombra_suelo(im, 13, 31, 12, 3)
    caja(im, 0, 6, 26, 8, 18, MADERA[3], MADERA[1])
    rect(im, 4, 18, 22, 19, MADERA[0])
    ImageDraw.Draw(im).ellipse([8, 0, 18, 8], fill=rgb("ffe9a8"), outline=OUT)   # lámpara
    rect(im, 12, 7, 14, 10, GRIS[1])
    return im, (13, 32)


def m_planta(alto=40, color="#3f8f3a"):
    c = rgb(color)
    im = lienzo(30, alto + 4)
    sombra_suelo(im, 15, alto + 1, 11, 3)
    rect(im, 8, alto - 12, 22, alto + 1, rgb("b0603c")); borde(im, 8, alto - 12, 22, alto + 1)
    rect(im, 8, alto - 12, 22, alto - 9, rgb("cf7a4f"))
    d = ImageDraw.Draw(im)
    r = random.Random(alto)
    for _ in range(14):
        x = r.randint(3, 21)
        y = r.randint(2, alto - 16)
        d.ellipse([x, y, x + 8, y + 9], fill=r.choice([c, aclarar(c, 0.15), oscurecer(c, 0.2)]), outline=oscurecer(c, 0.45))
    return im, (15, alto + 1)


def m_nevera():
    im = lienzo(32, 70)
    sombra_suelo(im, 16, 67, 14, 3)
    caja(im, 0, 0, 32, 6, 62, GRIS[4], GRIS[3])
    rect(im, 1, 26, 31, 27, GRIS[1])
    rect(im, 25, 12, 27, 22, GRIS[1]); rect(im, 25, 32, 27, 46, GRIS[1])
    return im, (16, 68)


def m_meson(ancho=96, con=("lavaplatos", "estufa")):
    """Mesón de cocina con muebles abajo, el lavaplatos con su grifo y la estufa de cuatro fogones."""
    im = lienzo(ancho, 52)
    sombra_suelo(im, ancho // 2, 49, ancho // 2, 3)
    caja(im, 0, 8, ancho, 14, 28, rgb("ece7dd"), MADERA[2])
    for k in range(ancho // 24):
        rect(im, k * 24 + 2, 25, k * 24 + 22, 48, MADERA[3])
        borde(im, k * 24 + 2, 25, k * 24 + 22, 48, MADERA[0])
        rect(im, k * 24 + 10, 28, k * 24 + 14, 29, CREMA[3])
    if "lavaplatos" in con:
        rect(im, 6, 10, 34, 20, GRIS[3]); rect(im, 8, 12, 32, 19, GRIS[1]); borde(im, 6, 10, 34, 20)
        rect(im, 18, 1, 21, 11, GRIS[3]); rect(im, 18, 1, 28, 4, GRIS[3]); rect(im, 26, 4, 28, 7, GRIS[2])
    if "estufa" in con:
        x = ancho - 40
        rect(im, x, 8, x + 34, 22, rgb("2d2f38")); borde(im, x, 8, x + 34, 22)
        d = ImageDraw.Draw(im)
        for k in range(4):
            cx = x + 6 + (k % 2) * 16 + (k // 2) * 4
            cy = 11 + (k // 2) * 5
            d.ellipse([cx - 3, cy - 2, cx + 5, cy + 3], outline=rgb("ff8a3c") if k == 0 else rgb("8a8f9e"))
        rect(im, x, 23, x + 34, 48, rgb("3a3d48")); borde(im, x, 23, x + 34, 48)
        rect(im, x + 4, 30, x + 30, 44, rgb("1d1f26")); rect(im, x + 6, 32, x + 16, 34, rgb("ffb066"))
        rect(im, x + 4, 25, x + 30, 27, GRIS[2])
    return im, (ancho // 2, 49)


def m_reloj():
    im = lienzo(18, 18)
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, 17, 17], fill=rgb("fbfaf4"), outline=OUT)
    d.line([(9, 9), (9, 4)], fill=OUT, width=1)
    d.line([(9, 9), (13, 10)], fill=rgb("c0392b"), width=1)
    return im, (9, 17)


def m_afiche(color="#2d8fd5", texto_c="#ffe14d"):
    im = lienzo(30, 38)
    rect(im, 0, 0, 30, 38, rgb(color)); borde(im, 0, 0, 30, 38)
    ImageDraw.Draw(im).ellipse([7, 6, 23, 22], fill=rgb(texto_c))
    rect(im, 5, 26, 25, 28, rgb("ffffff")); rect(im, 8, 31, 22, 33, rgb("ffffff"))
    return im, (15, 38)


def m_pantalla_tienda(ancho=128):
    """Pantalla grande detrás del mostrador: preguntas de MercadoLibre y chats de WhatsApp."""
    im = lienzo(ancho, 52)
    rect(im, 0, 0, ancho, 46, rgb("1b1d24")); borde(im, 0, 0, ancho, 46)
    rect(im, 4, 4, ancho // 2 - 2, 42, rgb("ffe600"))
    rect(im, ancho // 2 + 2, 4, ancho - 4, 42, rgb("25d366"))
    for k in range(4):
        rect(im, 8, 9 + k * 8, ancho // 2 - 8, 13 + k * 8, rgb("2d3277"))
        rect(im, ancho // 2 + 6, 9 + k * 8, ancho - 8 - (k % 2) * 14, 13 + k * 8, rgb("ffffff"))
    rect(im, ancho // 2 - 4, 46, ancho // 2 + 4, 52, GRIS[1])
    return im, (ancho // 2, 52)


def m_comedor():
    im, ancla = m_mesa(64, 40, [rgb("5b3a26"), rgb("7f5236"), rgb("a06c46"), rgb("c08a5c"), rgb("d8a879")])
    rect(im, 22, 10, 42, 14, CREMA[4])
    return im, ancla


def m_banca():
    im = lienzo(64, 30)
    sombra_suelo(im, 32, 27, 30, 3)
    rect(im, 0, 0, 64, 6, MADERA[2]); borde(im, 0, 0, 64, 6)
    rect(im, 0, 10, 64, 18, MADERA[3]); borde(im, 0, 10, 64, 18)
    for x in (4, 56):
        rect(im, x, 18, x + 4, 28, GRIS[0])
    return im, (32, 28)


def m_poste():
    im = lienzo(22, 110)
    sombra_suelo(im, 11, 106, 8, 3)
    rect(im, 9, 16, 13, 106, GRIS[1]); rect(im, 10, 16, 11, 106, GRIS[3])
    rect(im, 6, 102, 16, 108, GRIS[0])
    rect(im, 2, 6, 20, 16, GRIS[0]); borde(im, 2, 6, 20, 16)
    rect(im, 4, 12, 18, 16, rgb("ffe9a8"))
    return im, (11, 107)


def m_reja(ancho):
    im = lienzo(ancho, 40)
    for x in range(0, ancho, 8):
        rect(im, x + 2, 4, x + 4, 38, GRIS[0])
    rect(im, 0, 8, ancho, 11, GRIS[1]); rect(im, 0, 30, ancho, 33, GRIS[1])
    rect(im, 0, 0, 4, 40, GRIS[0]); rect(im, ancho - 4, 0, ancho, 40, GRIS[0])
    return im, (ancho // 2, 39)


def m_cama_hongos(ancho=96):
    """Estante de cultivo: bolsas blancas colgadas con racimos de orellanas grises."""
    im = lienzo(ancho, 70)
    sombra_suelo(im, ancho // 2, 66, ancho // 2, 4)
    rect(im, 0, 0, 4, 66, MADERA[1]); rect(im, ancho - 4, 0, ancho, 66, MADERA[1])
    rect(im, 0, 0, ancho, 4, MADERA[2]); borde(im, 0, 0, ancho, 4)
    d = ImageDraw.Draw(im)
    for k in range((ancho - 8) // 18):
        x = 6 + k * 18
        rect(im, x, 6, x + 13, 58, rgb("f4f2ec")); borde(im, x, 6, x + 13, 58, rgb("b9b4a8"))
        for j in range(3):
            y = 14 + j * 15
            d.ellipse([x - 3, y, x + 7, y + 7], fill=rgb("b8b2a6"), outline=rgb("6f6a60"))
            d.ellipse([x + 6, y + 4, x + 16, y + 11], fill=rgb("cdc7bb"), outline=rgb("6f6a60"))
    rect(im, 0, 58, ancho, 64, MADERA[2]); borde(im, 0, 58, ancho, 64)
    return im, (ancho // 2, 66)


def m_estiba():
    im = lienzo(64, 16)
    for k in range(4):
        rect(im, k * 16 + 1, 0, k * 16 + 14, 10, MADERA[3]); borde(im, k * 16 + 1, 0, k * 16 + 14, 10)
    rect(im, 0, 10, 64, 15, MADERA[1]); borde(im, 0, 10, 64, 15)
    return im, (32, 15)


def m_bultos():
    """Bultos de materia prima sobre una estiba (lo que llega del proveedor)."""
    est, _ = m_estiba()
    im = lienzo(64, 52)
    im.alpha_composite(est, (0, 36))
    r = random.Random(9)
    for k, (x, y) in enumerate([(2, 18), (22, 16), (42, 18), (10, 2), (32, 0)]):
        c = rgb(r.choice(["e8dcc0", "d9c9a4", "f2ead8"]))
        ImageDraw.Draw(im).rounded_rectangle([x, y, x + 20, y + 22], 6, fill=c, outline=OUT)
        rect(im, x + 5, y + 8, x + 15, y + 13, rgb("6d8fbf"))
    return im, (32, 51)


def m_cartelera():
    im = lienzo(64, 40)
    rect(im, 0, 0, 64, 40, MADERA[1]); rect(im, 3, 3, 61, 37, rgb("c9a06a"))
    r = random.Random(4)
    for _ in range(7):
        x, y = r.randint(5, 48), r.randint(5, 26)
        c = rgb(r.choice(["fff6a8", "ffd1dc", "c9f0ff", "ffffff"]))
        rect(im, x, y, x + 12, y + 10, c); rect(im, x + 5, y, x + 7, y + 2, rgb("d64545"))
    borde(im, 0, 0, 64, 40)
    return im, (32, 40)


def m_ventana(ancho=48, alto=36):
    im = lienzo(ancho, alto)
    rect(im, 0, 0, ancho, alto, CREMA[3])
    rect(im, 3, 3, ancho - 3, alto - 3, rgb("9fd3f0"))
    ImageDraw.Draw(im).polygon([(6, alto - 6), (ancho // 2, 5), (ancho // 2 + 6, 5), (12, alto - 6)], fill=rgb("c6e8fa"))
    rect(im, ancho // 2 - 1, 3, ancho // 2 + 1, alto - 3, CREMA[3])
    rect(im, 3, alto // 2 - 1, ancho - 3, alto // 2 + 1, CREMA[3])
    rect(im, -1, alto - 4, ancho + 1, alto, CREMA[2])
    borde(im, 0, 0, ancho, alto)
    return im, (ancho // 2, alto)


def m_cuadro(color="#3b7dd8"):
    im = lienzo(28, 22)
    rect(im, 0, 0, 28, 22, MADERA[1]); rect(im, 3, 3, 25, 19, rgb(color))
    ImageDraw.Draw(im).polygon([(3, 19), (12, 9), (18, 15), (25, 7), (25, 19)], fill=oscurecer(rgb(color), 0.3))
    ImageDraw.Draw(im).ellipse([16, 5, 21, 10], fill=rgb("ffe9a8"))
    borde(im, 0, 0, 28, 22)
    return im, (14, 22)


def m_mostrador(ancho=192):
    """Mostrador de la tienda: tapa de madera clara y vitrina de vidrio con frascos adentro."""
    im = lienzo(ancho, 50)
    sombra_suelo(im, ancho // 2, 47, ancho // 2, 3)
    roble = [rgb("8a5a36"), rgb("b07a4c"), rgb("d3a274"), rgb("e8c49b")]
    rect(im, 0, 0, ancho, 12, roble[2]); rect(im, 0, 0, ancho, 2, roble[3])
    rect(im, 0, 11, ancho, 13, roble[0])
    rect(im, 0, 13, ancho, 42, rgb("2b3a4a"))
    r = random.Random(ancho)
    for x0 in range(4, ancho - 4, 48):
        x1 = min(ancho - 4, x0 + 44)
        rect(im, x0, 15, x1, 38, rgb("bfe6f5"))
        rect(im, x0, 26, x1, 27, rgb("8fb8c9"))
        for fila, y in ((0, 16), (1, 27)):
            x = x0 + 3
            while x < x1 - 8:
                frasco, _ = m_frasco(r.choice(["#ff6f3c", "#2ecc71", "#3b7dd8", "#f1c40f", "#9b59b6"]))
                im.alpha_composite(frasco.resize((7, 10), Image.NEAREST), (x, y))
                x += 9
        ImageDraw.Draw(im).line([(x0 + 6, 37), (x0 + 22, 16)], fill=(255, 255, 255, 110))
    rect(im, 0, 40, ancho, 46, roble[1]); rect(im, 0, 40, ancho, 41, roble[3])
    borde(im, 0, 0, ancho, 46)
    return im, (ancho // 2, 46)


def m_moto():
    """Moto de domicilios con su caja, vista de lado (mira a la izquierda)."""
    im = lienzo(76, 56)
    sombra_suelo(im, 38, 51, 34, 4)
    d = ImageDraw.Draw(im)
    for cx in (14, 58):
        d.ellipse([cx - 11, 32, cx + 11, 54], fill=rgb("1f2026"), outline=OUT)
        d.ellipse([cx - 5, 38, cx + 5, 48], fill=GRIS[2])
    d.polygon([(10, 30), (24, 22), (54, 22), (62, 34), (46, 38), (24, 38)], fill=rgb("d93a3a"), outline=OUT)
    rect(im, 40, 2, 72, 26, rgb("ffcf33")); borde(im, 40, 2, 72, 26)
    rect(im, 44, 8, 68, 12, rgb("e0a800"))
    rect(im, 6, 14, 12, 24, GRIS[1]); rect(im, 2, 12, 12, 15, GRIS[0])
    return im, (38, 52)


def m_camion():
    """Camión de proveedor, de lado (mira a la derecha)."""
    im = lienzo(176, 104)
    sombra_suelo(im, 88, 98, 84, 6)
    d = ImageDraw.Draw(im)
    rect(im, 2, 8, 118, 82, rgb("eef1f6")); borde(im, 2, 8, 118, 82)
    rect(im, 2, 8, 118, 14, rgb("ffffff"))
    rect(im, 10, 34, 110, 52, rgb("2f8f5b"))
    d.polygon([(120, 30), (150, 30), (170, 52), (170, 84), (120, 84)], fill=rgb("2f6fb5"), outline=OUT)
    d.polygon([(128, 36), (148, 36), (162, 52), (128, 52)], fill=rgb("a9dcf5"), outline=OUT)
    rect(im, 0, 82, 174, 88, GRIS[0])
    for cx in (34, 92, 146):
        d.ellipse([cx - 14, 74, cx + 14, 102], fill=rgb("1f2026"), outline=OUT)
        d.ellipse([cx - 6, 82, cx + 6, 94], fill=GRIS[2])
    return im, (88, 99)


def m_hugo():
    """Hugo, el agente: un robot que flota. 4 cuadros: quieto, quieto, parpadea, salta."""
    cuadros = []
    for k in range(4):
        im = lienzo(48, 64)
        dy = [0, -1, 0, -6][k]
        sombra_suelo(im, 24, 60, 12, 3, 60)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([12, 32 + dy, 36, 52 + dy], 6, fill=rgb("f2f6ff"), outline=OUT)
        rect(im, 18, 40 + dy, 30, 44 + dy, rgb("5db8ff"))
        d.rounded_rectangle([8, 10 + dy, 40, 34 + dy], 9, fill=rgb("5db8ff"), outline=OUT)
        rect(im, 12, 14 + dy, 36, 16 + dy, rgb("9fd6ff"))
        rect(im, 13, 18 + dy, 35, 29 + dy, rgb("1b2a4a"))
        ojo = rgb("3fe0ff") if k != 2 else rgb("1b2a4a")
        rect(im, 17, 21 + dy, 21, 26 + dy, ojo); rect(im, 27, 21 + dy, 31, 26 + dy, ojo)
        rect(im, 23, 3 + dy, 25, 10 + dy, GRIS[3])
        d.ellipse([20, 0 + dy, 28, 7 + dy], fill=rgb("ffd34d") if k % 2 == 0 else rgb("ffb000"), outline=OUT)
        rect(im, 6, 36 + dy, 11, 46 + dy, rgb("f2f6ff")); rect(im, 37, 36 + dy, 42, 46 + dy, rgb("f2f6ff"))
        cuadros.append(im)
    tira = lienzo(48 * 4, 64)
    for k, c in enumerate(cuadros):
        tira.alpha_composite(c, (48 * k, 0))
    return tira, (24, 60)


def m_avion(color):
    im = lienzo(18, 12)
    ImageDraw.Draw(im).polygon([(0, 6), (17, 0), (8, 11)], fill=rgb("ffffff"), outline=OUT)
    ImageDraw.Draw(im).line([(2, 6), (17, 0)], fill=rgb(color), width=2)
    return im, (9, 6)


def m_papeles(n=1):
    im = lienzo(22, 6 + n * 2)
    for k in range(n):
        y = (n - 1 - k) * 2
        rect(im, 1 + (k % 2), y, 21 + (k % 2) - 1, y + 6, rgb("fbfaf4"))
        borde(im, 1 + (k % 2), y, 21 + (k % 2) - 1, y + 6, rgb("8a8273"))
    return im, (11, 5 + n * 2)


# ─── Íconos de los módulos (16×16) ────────────────────────────────────────────
# Cada módulo de la app tiene su objeto en el barrio; el ícono flota sobre el mueble y dice qué es.

def _ic():
    return lienzo(16, 16)


def _p(im, pts, color):
    ImageDraw.Draw(im).polygon(pts, fill=color, outline=OUT)


def _r(im, x0, y0, x1, y1, color, contorno=True):
    rect(im, x0, y0, x1, y1, color)
    if contorno:
        borde(im, x0, y0, x1, y1)


def _hoja(im, x0=3, y0=1, x1=13, y1=15, color=None):
    _r(im, x0, y0, x1, y1, color or rgb("fbfaf4"))
    for y in range(y0 + 3, y1 - 2, 2):
        rect(im, x0 + 2, y, x1 - 2, y + 1, rgb("9aa3b5"))


def iconos() -> dict[str, Image.Image]:
    I: dict[str, Image.Image] = {}
    d = lambda im: ImageDraw.Draw(im)

    im = _ic(); _r(im, 2, 1, 14, 15, rgb("2e7d4f")); rect(im, 4, 1, 6, 15, rgb("1f5c38")); rect(im, 8, 6, 13, 9, rgb("f1c40f")); I["libro"] = im
    im = _ic(); _r(im, 1, 4, 15, 14, rgb("f2b632")); _r(im, 1, 3, 7, 6, rgb("f6c95a")); I["carpeta"] = im
    im = _ic(); _hoja(im); I["documento"] = im
    im = _ic(); _hoja(im); rect(im, 6, 8, 10, 13, rgb("ffffff")); d(im).text((5, 5), "$", fill=rgb("2e7d4f")); I["factura"] = im
    im = _ic(); _r(im, 1, 4, 15, 13, rgb("f4f1ea")); d(im).line([(1, 4), (8, 9), (15, 4)], fill=OUT); I["sobre"] = im
    im = _ic(); _r(im, 1, 4, 15, 12, rgb("5fbf6a")); d(im).ellipse([6, 5, 10, 11], fill=rgb("a8e6a1"), outline=OUT); I["billete"] = im
    im = _ic()
    for k in range(4):
        d(im).ellipse([3, 9 - k * 2, 13, 14 - k * 2], fill=rgb("f1c40f"), outline=OUT)
    I["monedas"] = im
    im = _ic(); _p(im, [(1, 6), (8, 1), (15, 6)], rgb("c9ced8")); _r(im, 2, 13, 14, 15, rgb("c9ced8"))
    for x in (3, 7, 11):
        _r(im, x, 7, x + 2, 13, rgb("e8ebf0"))
    I["banco"] = im
    im = _ic(); d(im).ellipse([1, 4, 8, 11], fill=rgb("f1c40f"), outline=OUT); _r(im, 7, 7, 15, 9, rgb("f1c40f")); _r(im, 12, 9, 14, 12, rgb("f1c40f")); I["llave"] = im
    im = _ic(); _r(im, 6, 1, 10, 8, rgb("b5651d")); _r(im, 2, 8, 14, 12, rgb("8e44ad")); _r(im, 1, 12, 15, 15, rgb("c0392b")); I["sello"] = im
    im = _ic(); _r(im, 7, 2, 9, 14, rgb("8a8f9e")); _r(im, 2, 4, 14, 5, rgb("8a8f9e"))
    for x in (1, 10):
        d(im).pieslice([x, 5, x + 5, 11], 0, 180, fill=rgb("f1c40f"), outline=OUT)
    _r(im, 4, 13, 12, 15, rgb("8a8f9e")); I["balanza"] = im
    im = _ic(); _r(im, 3, 1, 13, 15, rgb("3b3d4a")); _r(im, 5, 3, 11, 6, rgb("9be7a5"))
    for y in (8, 11):
        for x in (5, 8, 11):
            rect(im, x, y, x + 2, y + 2, rgb("e8ebf0"))
    I["calculadora"] = im
    im = _ic(); rect(im, 1, 14, 15, 15, OUT)
    for x, h, c in ((2, 5, "3b7dd8"), (6, 9, "2ecc71"), (10, 12, "ff9f1c")):
        _r(im, x, 14 - h, x + 3, 14, rgb(c))
    I["grafica"] = im
    im = _ic(); _p(im, [(8, 14), (1, 6), (4, 2), (8, 5), (12, 2), (15, 6)], rgb("e74c3c")); d(im).line([(2, 8), (5, 8), (7, 5), (9, 11), (11, 8), (14, 8)], fill=rgb("ffffff")); I["corazon"] = im
    im = _ic()
    for x, c in ((1, "5dade2"), (8, "f5b041")):
        d(im).ellipse([x + 1, 2, x + 6, 7], fill=rgb("f0c8a0"), outline=OUT); _r(im, x, 8, x + 7, 15, rgb(c))
    I["personas"] = im
    im = _ic(); d(im).line([(4, 4), (12, 4), (8, 12)], fill=OUT, width=1); d(im).line([(4, 4), (8, 12)], fill=OUT)
    for x, y, c in ((1, 1, "ff77a8"), (9, 1, "5db8ff"), (5, 9, "ffe14d")):
        _r(im, x, y, x + 6, y + 6, rgb(c))
    I["proyectos"] = im
    im = _ic(); _r(im, 1, 2, 15, 11, rgb("2d3277")); _r(im, 3, 4, 13, 9, rgb("5db8ff"), False); _r(im, 6, 11, 10, 15, rgb("8a8f9e")); I["monitor"] = im
    im = _ic(); _r(im, 3, 1, 13, 15, rgb("3b3d4a"))
    for y in (3, 7, 11):
        rect(im, 5, y, 11, y + 2, rgb("1d1f26")); rect(im, 10, y, 11, y + 1, rgb("2ecc71"))
    I["servidor"] = im
    im = _ic(); _r(im, 4, 1, 6, 6, rgb("c9ced8")); _r(im, 10, 1, 12, 6, rgb("c9ced8")); _r(im, 2, 6, 14, 11, rgb("f1c40f")); _r(im, 7, 11, 9, 15, rgb("3b3d4a")); I["enchufe"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 15], fill=rgb("fbfaf4"), outline=OUT); d(im).line([(8, 8), (8, 3)], fill=OUT); d(im).line([(8, 8), (12, 10)], fill=rgb("c0392b")); I["reloj"] = im
    im = _ic(); d(im).line([(4, 2), (4, 14)], fill=OUT, width=2); d(im).line([(4, 9), (11, 5)], fill=OUT, width=2)
    for x, y, c in ((2, 1, "2ecc71"), (2, 12, "2ecc71"), (9, 3, "ff9f1c")):
        d(im).ellipse([x, y, x + 4, y + 4], fill=rgb(c), outline=OUT)
    I["ramas"] = im
    im = _ic(); _r(im, 1, 2, 15, 14, rgb("2e6fb5"))
    for k in range(3, 14, 3):
        rect(im, 2, k, 14, k + 1, rgb("5d9bd8"))
    d(im).rectangle([4, 5, 11, 11], outline=rgb("ffffff")); I["plano"] = im
    im = _ic(); _p(im, [(1, 3), (6, 1), (10, 3), (15, 1), (15, 13), (10, 15), (6, 13), (1, 15)], rgb("a8e6a1")); d(im).line([(6, 1), (6, 13)], fill=OUT); d(im).line([(10, 3), (10, 15)], fill=OUT)
    d(im).ellipse([10, 5, 13, 8], fill=rgb("e74c3c")); I["mapa"] = im
    im = _ic(); d(im).ellipse([2, 2, 14, 14], fill=rgb("8a8f9e"), outline=OUT); d(im).ellipse([5, 5, 11, 11], fill=rgb("d3d9e6"), outline=OUT)
    for x, y in ((7, 0), (7, 13), (0, 7), (13, 7)):
        rect(im, x, y, x + 3, y + 3, rgb("8a8f9e"))
    I["engranaje"] = im
    im = _ic(); _p(im, [(8, 1), (15, 14), (1, 14)], rgb("f1c40f")); _r(im, 7, 5, 9, 10, OUT, False); _r(im, 7, 11, 9, 13, OUT, False); I["alerta"] = im
    im = _ic(); _p(im, [(1, 9), (8, 5), (15, 9), (8, 13)], rgb("b9b5ad")); _p(im, [(1, 9), (8, 13), (8, 15), (1, 11)], rgb("8a867e")); _p(im, [(15, 9), (8, 13), (8, 15), (15, 11)], rgb("9e9a92")); I["placa"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 15], fill=rgb("3b7dd8"), outline=OUT); _p(im, [(4, 4), (8, 3), (9, 7), (5, 9)], rgb("2ecc71")); _p(im, [(9, 9), (12, 8), (12, 12), (9, 13)], rgb("2ecc71")); I["globo"] = im
    im = _ic(); _p(im, [(1, 9), (15, 9), (12, 14), (4, 14)], rgb("c0392b")); _r(im, 4, 4, 8, 9, rgb("f39c12")); _r(im, 8, 6, 12, 9, rgb("2e86de")); rect(im, 0, 14, 16, 16, rgb("5dade2")); I["barco"] = im
    im = _ic(); _r(im, 2, 1, 12, 15, rgb("1f5c8a")); d(im).ellipse([4, 4, 10, 10], outline=rgb("f1c40f")); rect(im, 4, 12, 10, 13, rgb("f1c40f")); _r(im, 10, 9, 15, 15, rgb("c0392b")); I["aduana"] = im
    im = _ic(); d(im).ellipse([1, 1, 10, 10], fill=rgb("bfe6f5"), outline=OUT); d(im).line([(9, 9), (14, 14)], fill=OUT, width=3); I["lupa"] = im
    im = _ic(); _r(im, 2, 1, 14, 15, rgb("8e44ad")); _r(im, 4, 3, 12, 6, rgb("fbfaf4"))
    for y in (8, 10, 12):
        rect(im, 4, y, 12, y + 1, rgb("d2b4de"))
    I["agenda"] = im
    im = _ic(); _r(im, 1, 6, 15, 15, rgb("c8955a")); _r(im, 1, 3, 15, 6, rgb("deb27a")); rect(im, 7, 3, 9, 15, rgb("e9d3a6")); I["caja"] = im
    im = _ic(); _hoja(im, 2, 1, 14, 15)
    for y in (4, 8, 12):
        _r(im, 3, y - 1, 6, y + 2, rgb("2ecc71") if y < 12 else rgb("ffffff"))
    I["lista"] = im
    im = _ic(); _p(im, [(1, 8), (6, 2), (15, 2), (15, 14), (6, 14)], rgb("ffe14d")); d(im).ellipse([5, 7, 8, 10], fill=rgb("ffffff"), outline=OUT); I["etiqueta"] = im
    im = _ic(); _hoja(im); _p(im, [(9, 8), (11, 8), (13, 14), (7, 14)], rgb("5db8ff")); I["ficha"] = im
    im = _ic(); _hoja(im, 2, 1, 14, 15, rgb("fff6a8")); d(im).rectangle([4, 4, 11, 11], outline=rgb("ff9f1c")); I["plantilla"] = im
    im = _ic(); _r(im, 1, 4, 15, 15, rgb("c8955a")); _r(im, 6, 6, 10, 13, rgb("ffffff"), False); _r(im, 4, 8, 12, 11, rgb("ffffff"), False); I["alta"] = im
    im = _ic(); _r(im, 1, 1, 15, 15, rgb("fbfaf4"))
    for x in (3, 9):
        for y in (3, 9):
            _r(im, x, y, x + 4, y + 4, rgb("5db8ff"))
    I["catalogo"] = im
    im = _ic(); _p(im, [(1, 7), (5, 2), (12, 2), (12, 12), (5, 12)], rgb("ffe14d")); d(im).ellipse([8, 8, 15, 15], fill=rgb("f1c40f"), outline=OUT); I["costos"] = im
    im = _ic(); _r(im, 1, 3, 15, 15, rgb("fbfaf4")); _r(im, 1, 1, 15, 5, rgb("ff6f3c"))
    for x in (2, 6, 10):
        rect(im, x, 1, x + 2, 5, rgb("ffffff"))
    _r(im, 4, 8, 12, 15, rgb("bfe6f5")); I["vitrina"] = im
    im = _ic(); _r(im, 1, 5, 15, 14, rgb("3b3d4a")); _r(im, 5, 3, 10, 5, rgb("3b3d4a")); d(im).ellipse([5, 7, 11, 13], fill=rgb("5db8ff"), outline=OUT); I["camara"] = im
    im = _ic(); _p(im, [(1, 6), (5, 6), (13, 1), (13, 15), (5, 10), (1, 10)], rgb("e74c3c")); I["megafono"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 12], fill=rgb("ffe600"), outline=OUT); _p(im, [(4, 11), (7, 11), (3, 15)], rgb("ffe600")); d(im).text((5, 1), "?", fill=OUT); I["pregunta"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 14], fill=rgb("25d366"), outline=OUT); d(im).ellipse([5, 4, 11, 10], outline=rgb("ffffff")); I["whatsapp"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 12], fill=rgb("3ba7ff"), outline=OUT); _p(im, [(10, 11), (13, 11), (13, 15)], rgb("3ba7ff")); rect(im, 4, 6, 12, 7, rgb("ffffff")); I["web"] = im
    im = _ic(); _r(im, 6, 1, 10, 10, rgb("8a8f9e")); d(im).arc([3, 5, 13, 13], 0, 180, fill=OUT); _r(im, 7, 12, 9, 15, rgb("3b3d4a")); I["microfono"] = im
    im = _ic(); d(im).rounded_rectangle([2, 3, 14, 13], 3, fill=rgb("5db8ff"), outline=OUT); _r(im, 4, 6, 12, 10, rgb("1b2a4a"), False); rect(im, 5, 7, 7, 9, rgb("3fe0ff")); rect(im, 9, 7, 11, 9, rgb("3fe0ff")); rect(im, 7, 0, 9, 3, rgb("ffd34d")); I["robot"] = im
    im = _ic(); d(im).ellipse([1, 4, 15, 12], fill=rgb("ffffff"), outline=OUT); d(im).ellipse([5, 5, 11, 11], fill=rgb("3b7dd8"), outline=OUT); I["ojo"] = im
    im = _ic(); _r(im, 1, 4, 10, 12, rgb("2f6fb5")); _p(im, [(10, 6), (13, 6), (15, 9), (15, 12), (10, 12)], rgb("2f6fb5")); d(im).ellipse([2, 11, 6, 15], fill=OUT); d(im).ellipse([10, 11, 14, 15], fill=OUT); I["camion"] = im
    im = _ic(); _r(im, 1, 6, 15, 13, rgb("c9ced8")); _r(im, 4, 2, 12, 6, rgb("fbfaf4")); _r(im, 4, 11, 12, 15, rgb("fbfaf4")); I["impresora"] = im
    im = _ic(); _p(im, [(1, 4), (4, 4), (6, 11), (14, 11), (15, 6), (5, 6)], rgb("8a8f9e")); d(im).ellipse([5, 12, 8, 15], fill=OUT); d(im).ellipse([11, 12, 14, 15], fill=OUT); I["carrito"] = im
    im = _ic(); d(im).ellipse([1, 1, 15, 13], fill=rgb("a8e6a1"), outline=OUT); d(im).line([(4, 7), (7, 10), (12, 4)], fill=OUT, width=2); I["posventa"] = im
    im = _ic(); d(im).arc([2, 2, 14, 14], 200, 340, fill=rgb("2e86de"), width=2); d(im).arc([2, 2, 14, 14], 20, 160, fill=rgb("2ecc71"), width=2)
    _p(im, [(12, 3), (15, 6), (11, 7)], rgb("2e86de")); _p(im, [(4, 13), (1, 10), (5, 9)], rgb("2ecc71")); I["sync"] = im
    im = _ic(); _hoja(im); d(im).ellipse([6, 7, 13, 14], fill=rgb("bfe6f5"), outline=OUT); I["rastreo"] = im
    im = _ic(); _hoja(im); d(im).line([(4, 5), (12, 13)], fill=rgb("c0392b"), width=2); d(im).line([(12, 5), (4, 13)], fill=rgb("c0392b"), width=2); I["anular"] = im
    im = _ic(); d(im).ellipse([1, 1, 11, 9], fill=rgb("ffffff"), outline=OUT); d(im).ellipse([5, 6, 15, 14], fill=rgb("ff77a8"), outline=OUT); I["charla"] = im
    im = _ic(); d(im).rounded_rectangle([1, 4, 15, 13], 3, fill=rgb("5d5f6b"), outline=OUT); rect(im, 3, 8, 7, 9, rgb("ffffff")); rect(im, 4, 7, 6, 10, rgb("ffffff")); d(im).ellipse([10, 6, 12, 8], fill=rgb("e74c3c")); d(im).ellipse([12, 9, 14, 11], fill=rgb("2ecc71")); I["control"] = im
    im = _ic(); _r(im, 1, 1, 15, 15, rgb("1d2b53")); rect(im, 3, 3, 13, 4, rgb("ffe14d"))
    for y in (6, 9, 12):
        rect(im, 3, y, 11, y + 1, rgb("ffffff"))
    I["directorio"] = im
    im = _ic()   # caballo de ajedrez (la mesa del parque)
    _p(im, [(4, 15), (12, 15), (12, 13), (10, 12), (10, 9), (13, 10), (14, 8), (11, 3), (8, 1), (7, 3), (5, 5), (4, 9), (6, 11), (5, 13)], rgb("3b3d4a"))
    rect(im, 9, 5, 10, 6, rgb("ffffff"))
    I["ajedrez"] = im
    im = _ic(); _p(im, [(3, 2), (13, 2), (12, 8), (9, 10), (7, 10), (4, 8)], rgb("f1c40f"))
    _r(im, 7, 10, 9, 12, rgb("c99a06")); _r(im, 4, 12, 12, 15, rgb("6e4128")); I["trofeo"] = im
    im = _ic(); d(im).ellipse([1, 1, 10, 10], fill=rgb("ff9f1c"), outline=OUT); d(im).ellipse([3, 3, 8, 8], fill=rgb("ffe0b0"))
    _r(im, 9, 9, 15, 11, rgb("6e4128")); d(im).ellipse([9, 9, 15, 15], fill=rgb("d9f75a"), outline=OUT)
    I["tenis"] = im
    im = _ic(); _p(im, [(1, 8), (8, 2), (15, 8)], rgb("c0563b")); _r(im, 3, 8, 13, 15, rgb("f3ead6")); _r(im, 7, 10, 10, 15, rgb("8f5a35"))
    I["casa"] = im
    # Marco para que el ícono se vea sobre cualquier mueble: placa clara con borde.
    out = {}
    for k, im in I.items():
        marco = lienzo(20, 20)
        ImageDraw.Draw(marco).rounded_rectangle([0, 0, 19, 19], 4, fill=(255, 250, 235, 235), outline=OUT)
        marco.alpha_composite(im, (2, 2))
        out[k] = marco
    return out


def m_rack():
    """Rack de servidores de la sala de sistemas (luces verdes y una que titila)."""
    im = lienzo(44, 92)
    sombra_suelo(im, 22, 89, 20, 3)
    caja(im, 0, 0, 44, 6, 82, GRIS[1], rgb("2b2d36"))
    for k in range(7):
        y = 10 + k * 11
        rect(im, 4, y, 40, y + 8, rgb("1d1f26")); borde(im, 4, y, 40, y + 8, GRIS[0])
        rect(im, 33, y + 3, 36, y + 5, rgb("2ecc71") if k % 3 else rgb("ffb000"))
        for x in range(7, 28, 4):
            rect(im, x, y + 3, x + 2, y + 5, GRIS[1])
    return im, (22, 88)


def m_contenedor():
    """Contenedor de carga convertido en oficina de comercio exterior (patio de recepción)."""
    w, h = 192, 84
    im = lienzo(w, h + 6)
    sombra_suelo(im, w // 2, h + 2, w // 2, 4)
    c = rgb("2f6fb5")
    rect(im, 0, 0, w, 14, aclarar(c, 0.15)); borde(im, 0, 0, w, 14)
    rect(im, 0, 14, w, h, c)
    for x in range(4, w - 4, 8):
        rect(im, x, 16, x + 4, h - 2, oscurecer(c, 0.12))
    borde(im, 0, 14, w, h)
    rect(im, 0, 14, 6, h, rgb("f08c2e")); rect(im, w - 6, 14, w, h, rgb("f08c2e"))
    # ventana y puerta
    rect(im, 20, 28, 70, 56, rgb("9fd3f0")); borde(im, 20, 28, 70, 56)
    rect(im, 150, 26, 178, h - 2, rgb("1f4f86")); borde(im, 150, 26, 178, h - 2); rect(im, 172, 54, 175, 58, rgb("ffd166"))
    rect(im, 80, 20, 140, 32, rgb("ffffff")); borde(im, 80, 20, 140, 32)
    return im, (w // 2, h)


def m_caja_fuerte():
    im = lienzo(30, 34)
    sombra_suelo(im, 15, 31, 13, 3)
    caja(im, 0, 0, 30, 6, 26, GRIS[2], GRIS[1])
    ImageDraw.Draw(im).ellipse([9, 12, 21, 24], fill=GRIS[3], outline=OUT)
    rect(im, 14, 17, 16, 19, OUT)
    return im, (15, 32)


def m_arcade():
    """Máquina de arcade (Agenda → Juegos)."""
    im = lienzo(30, 64)
    sombra_suelo(im, 15, 61, 13, 3)
    rect(im, 2, 0, 28, 60, rgb("6c3fa0")); borde(im, 2, 0, 28, 60)
    rect(im, 5, 4, 25, 10, rgb("ffe14d"))
    rect(im, 5, 13, 25, 30, rgb("1d1f26")); rect(im, 7, 15, 23, 28, rgb("2ecc71"))
    rect(im, 0, 32, 30, 40, rgb("8e5cc8")); borde(im, 0, 32, 30, 40)
    ImageDraw.Draw(im).ellipse([8, 33, 12, 37], fill=rgb("e74c3c")); ImageDraw.Draw(im).ellipse([17, 33, 21, 37], fill=rgb("3ba7ff"))
    return im, (15, 61)


def m_mesa_ajedrez():
    """Mesa de piedra con tablero, como las de los parques (Empresa viva → ajedrez entre dos)."""
    im = lienzo(40, 38)
    sombra_suelo(im, 20, 35, 16, 3)
    piedra = [rgb("6f6a62"), rgb("8d877d"), rgb("aaa498"), rgb("c9c3b6")]
    rect(im, 14, 22, 26, 36, piedra[1]); borde(im, 14, 22, 26, 36)
    rect(im, 15, 22, 17, 35, piedra[2])
    rect(im, 0, 0, 40, 24, piedra[2]); borde(im, 0, 0, 40, 24)
    rect(im, 0, 20, 40, 24, piedra[1]); borde(im, 0, 20, 40, 24)
    # El tablero visto en perspectiva: 8 columnas de 4 px y 8 filas de 2 px
    for fila in range(8):
        for col in range(8):
            claro = (fila + col) % 2 == 0
            rect(im, 4 + col * 4, 2 + fila * 2, 8 + col * 4, 4 + fila * 2, rgb("efe3c8") if claro else rgb("4a3b33"))
    borde(im, 3, 1, 37, 19)
    return im, (20, 36)


def m_repisa_trofeos():
    """Repisa de madera al lado de la cama: dos baldas donde el juego pone los trofeos ganados."""
    im = lienzo(48, 54)
    sombra_suelo(im, 24, 51, 22, 3)
    rect(im, 0, 0, 48, 52, MADERA[1]); borde(im, 0, 0, 48, 52)
    rect(im, 3, 3, 45, 49, oscurecer(MADERA[1], 0.15))          # el fondo
    for y in (22, 44):                                            # las baldas (encima se paran los trofeos)
        rect(im, 2, y, 46, y + 4, MADERA[3]); borde(im, 2, y, 46, y + 4)
    rect(im, 2, 48, 46, 52, MADERA[0])
    return im, (24, 52)


_TROFEO = [   # o contorno · c cuerpo · l luz · b brillo · s sombra · w placa de madera
    "..ooooooo..",
    "oocblcccsoo",
    "o.cblcccs.o",
    "o.cblcccs.o",
    ".ocblcccso.",
    "..ocbccso..",
    "...occso...",
    "....oso....",
    "....oso....",
    "...ocsco...",
    "..occcsso..",
    "..ooooooo..",
    ".owwwwwwwo.",
    ".ooooooooo.",
]


def m_trofeo(tonos):
    """Copa de trofeo (11 × 14): `tonos` = (sombra, cuerpo, luz, brillo)."""
    sombra, cuerpo, luz, brillo = (rgb(t) for t in tonos)
    color = {"o": OUT, "c": cuerpo, "l": luz, "b": brillo, "s": sombra, "w": MADERA[3]}
    im = lienzo(11, 14)
    for y, fila in enumerate(_TROFEO):
        for x, ch in enumerate(fila):
            if ch in color:
                im.putpixel((x, y), (*color[ch][:3], 255))
    return im, (5, 14)


def textura_cancha_tenis(w=176, h=96):
    """Cancha de tenis vista desde arriba (la red va de arriba abajo, como en el minijuego)."""
    im = lienzo(w, h)
    rect(im, 0, 0, w, h, rgb("2f7a45"))                       # el borde de la cancha
    rect(im, 8, 8, w - 8, h - 8, rgb("3f9a58"))                # la cancha
    ruido(im, 8, 8, w - 8, h - 8, [rgb("3a9152"), rgb("46a35f")], 0.12, 7)
    blanco = rgb("f4f1e8")
    for x0, y0, x1, y1 in ((8, 8, w - 8, 10), (8, h - 10, w - 8, h - 8), (8, 8, 10, h - 8), (w - 10, 8, w - 8, h - 8),
                           (8, 18, w - 8, 19), (8, h - 19, w - 8, h - 18),                    # pasillos de dobles
                           (40, 18, 41, h - 18), (w - 41, 18, w - 40, h - 18),               # líneas de saque
                           (40, h // 2, w - 40, h // 2 + 1)):                                 # línea central de saque
        rect(im, x0, y0, x1, y1, blanco)
    # La red (con su sombra) y los dos postes
    rect(im, w // 2 + 1, 4, w // 2 + 3, h - 4, rgb("1f5c35"))
    for y in range(4, h - 4, 3):
        rect(im, w // 2 - 1, y, w // 2 + 1, y + 2, rgb("d9dde6"))
    rect(im, w // 2 - 2, 2, w // 2 + 2, 6, GRIS[0]); rect(im, w // 2 - 2, h - 6, w // 2 + 2, h - 2, GRIS[0])
    return im


def m_flores(color):
    """Matica de flores (jardín): tres flores sobre un poco de hojas."""
    c = rgb(color)
    im = lienzo(22, 16)
    d = ImageDraw.Draw(im)
    for x, y in ((3, 7), (10, 9), (15, 6)):
        d.ellipse([x, y + 3, x + 6, y + 8], fill=rgb("3f8f3a"), outline=rgb("2a5f27"))
    for x, y in ((2, 2), (9, 4), (14, 1)):
        d.ellipse([x, y, x + 6, y + 6], fill=c, outline=oscurecer(c, 0.45))
        d.point((x + 3, y + 3), fill=rgb("ffe14d"))
    return im, (11, 15)


def m_fuente():
    im = lienzo(60, 44)
    sombra_suelo(im, 30, 40, 28, 4)
    d = ImageDraw.Draw(im)
    d.ellipse([0, 14, 59, 42], fill=rgb("a9a39a"), outline=OUT)
    d.ellipse([5, 17, 54, 37], fill=rgb("5db8ff"), outline=rgb("2d6fa8"))
    rect(im, 27, 4, 33, 26, rgb("c9c3b6")); borde(im, 27, 4, 33, 26)
    d.ellipse([22, 0, 38, 8], fill=rgb("c9c3b6"), outline=OUT)
    for x in (24, 30, 36):
        d.point((x, 12), fill=rgb("bfe6f5")); d.point((x - 2, 16), fill=rgb("bfe6f5"))
    return im, (30, 41)


def m_buzon():
    im = lienzo(16, 30)
    rect(im, 6, 12, 10, 30, MADERA[1])
    rect(im, 0, 0, 16, 13, rgb("c0392b")); borde(im, 0, 0, 16, 13)
    rect(im, 13, 2, 15, 7, rgb("ffe14d"))
    return im, (8, 29)


def m_casita_perro():
    im = lienzo(44, 40)
    sombra_suelo(im, 22, 37, 20, 3)
    rect(im, 4, 16, 40, 38, MADERA[2]); borde(im, 4, 16, 40, 38)
    ImageDraw.Draw(im).polygon([(0, 18), (22, 2), (44, 18)], fill=rgb("c0563b"), outline=OUT)
    ImageDraw.Draw(im).ellipse([15, 22, 29, 40], fill=rgb("2a1d17"))
    return im, (22, 38)


def m_huerta():
    im = lienzo(62, 30)
    rect(im, 0, 6, 62, 28, rgb("7a5a3c")); borde(im, 0, 6, 62, 28)
    ruido(im, 2, 8, 60, 26, [rgb("6a4c32"), rgb("8b6a48")], 0.25, 4)
    d = ImageDraw.Draw(im)
    for x in range(6, 58, 10):
        for y in (10, 18):
            d.ellipse([x, y - 6, x + 6, y + 2], fill=rgb("4fb04a"), outline=rgb("2a5f27"))
    return im, (31, 28)


def m_lampara():
    im = lienzo(18, 48)
    sombra_suelo(im, 9, 46, 7, 2)
    rect(im, 8, 12, 10, 46, GRIS[0])
    rect(im, 4, 44, 14, 47, GRIS[0])
    ImageDraw.Draw(im).polygon([(2, 14), (16, 14), (13, 2), (5, 2)], fill=rgb("ffe9a8"), outline=OUT)
    return im, (9, 46)


def m_pecera():
    im = lienzo(36, 40)
    sombra_suelo(im, 18, 37, 16, 3)
    rect(im, 4, 22, 32, 38, MADERA[1]); borde(im, 4, 22, 32, 38)
    rect(im, 2, 2, 34, 22, rgb("8fd3f5")); borde(im, 2, 2, 34, 22)
    rect(im, 3, 3, 33, 6, rgb("c7ecff"))
    d = ImageDraw.Draw(im)
    d.ellipse([10, 10, 18, 15], fill=rgb("ff9f1c")); d.ellipse([21, 13, 27, 17], fill=rgb("ff77a8"))
    rect(im, 4, 18, 32, 21, rgb("d8c7a0"))
    return im, (18, 38)


def m_tv_casa(base):
    """El televisor de LPC sobre un mueble bajo."""
    im = lienzo(64, 58)
    sombra_suelo(im, 32, 55, 30, 3)
    caja(im, 2, 32, 60, 6, 18, MADERA[3], MADERA[1])
    tv = base.resize((60, 40), Image.NEAREST) if base.width > 60 else base
    im.alpha_composite(tv, ((64 - tv.width) // 2, max(0, 34 - tv.height)))
    return im, (32, 56)


def m_letrero_lote():
    """El letrero de cada terreno (el texto lo pone el juego: «Se vende · 400», «Casa de …»)."""
    im = lienzo(80, 40)
    rect(im, 38, 18, 42, 40, MADERA[1])
    rect(im, 0, 0, 80, 20, MADERA[3]); borde(im, 0, 0, 80, 20)
    rect(im, 2, 2, 78, 4, aclarar(MADERA[3], 0.2))
    return im, (40, 39)


def m_banquito():
    """Banco de piedra redondo (la mesa de ajedrez tiene dos)."""
    im = lienzo(18, 16)
    sombra_suelo(im, 9, 14, 7, 2)
    rect(im, 5, 6, 13, 15, rgb("8d877d")); borde(im, 5, 6, 13, 15)
    ImageDraw.Draw(im).ellipse([0, 0, 17, 9], fill=rgb("aaa498"), outline=OUT)
    return im, (9, 15)


def m_directorio():
    """Atril con el directorio de la casa: qué cuarto tiene qué módulos."""
    im = lienzo(28, 46)
    sombra_suelo(im, 14, 43, 10, 3)
    rect(im, 12, 22, 16, 44, GRIS[1])
    rect(im, 0, 0, 28, 24, rgb("1d2b53")); borde(im, 0, 0, 28, 24)
    rect(im, 3, 3, 25, 5, rgb("ffe14d"))
    for y in (8, 12, 16, 20):
        rect(im, 4, y, 22, y + 1, rgb("ffffff"))
    rect(im, 6, 42, 22, 45, GRIS[0])
    return im, (14, 44)


def m_tripode():
    im = lienzo(26, 50)
    d = ImageDraw.Draw(im)
    d.line([(13, 22), (3, 48)], fill=GRIS[0], width=2); d.line([(13, 22), (23, 48)], fill=GRIS[0], width=2); d.line([(13, 22), (13, 48)], fill=GRIS[0], width=2)
    rect(im, 4, 6, 22, 22, rgb("3b3d4a")); borde(im, 4, 6, 22, 22)
    d.ellipse([9, 9, 18, 18], fill=rgb("5db8ff"), outline=OUT)
    rect(im, 8, 2, 14, 6, rgb("3b3d4a"))
    return im, (13, 48)


def m_atril():
    im = lienzo(26, 40)
    sombra_suelo(im, 13, 37, 9, 3)
    rect(im, 11, 14, 15, 38, MADERA[1])
    ImageDraw.Draw(im).polygon([(0, 14), (26, 14), (22, 2), (4, 2)], fill=MADERA[3], outline=OUT)
    rect(im, 7, 5, 19, 12, rgb("fbfaf4"))
    rect(im, 5, 36, 21, 39, MADERA[0])
    return im, (13, 38)


def m_pantalla_mapa(ancho=128):
    """Pantalla grande de la sala de sistemas con el flujo de la app dibujado."""
    im = lienzo(ancho, 52)
    rect(im, 0, 0, ancho, 46, rgb("1b1d24")); borde(im, 0, 0, ancho, 46)
    rect(im, 4, 4, ancho - 4, 42, rgb("102040"))
    cols = ["#ffe14d", "#ff9f1c", "#2ecc71", "#3ba7ff", "#ff77a8", "#b388ff"]
    for k in range(6):
        x = 8 + k * ((ancho - 24) // 6)
        rect(im, x, 18, x + 12, 28, rgb(cols[k]))
        if k < 5:
            rect(im, x + 12, 22, x + (ancho - 24) // 6 + 8, 24, rgb("ffffff"))
    rect(im, ancho // 2 - 4, 46, ancho // 2 + 4, 52, GRIS[1])
    return im, (ancho // 2, 52)


# ─── El atlas de muebles ─────────────────────────────────────────────────────

class Atlas:
    def __init__(self):
        self.cuadros: dict[str, tuple[Image.Image, tuple[int, int]]] = {}

    def agregar(self, nombre: str, im_ancla):
        self.cuadros[nombre] = im_ancla
        return nombre

    def empacar(self) -> tuple[Image.Image, dict]:
        orden = sorted(self.cuadros.items(), key=lambda kv: -kv[1][0].height)
        ancho = 1024
        x = y = fila = 0
        pos = {}
        for nombre, (im, ancla) in orden:
            if x + im.width + 2 > ancho:
                x, y, fila = 0, y + fila + 2, 0
            pos[nombre] = (x, y)
            x += im.width + 2
            fila = max(fila, im.height)
        alto = y + fila
        hoja = lienzo(ancho, alto)
        frames = {}
        for nombre, (im, ancla) in self.cuadros.items():
            px, py = pos[nombre]
            hoja.alpha_composite(im, (px, py))
            frames[nombre] = {"frame": {"x": px, "y": py, "w": im.width, "h": im.height},
                              "rotated": False, "trimmed": False,
                              "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
                              "sourceSize": {"w": im.width, "h": im.height},
                              "anchor": {"x": ancla[0] / im.width, "y": ancla[1] / im.height}}
        return hoja, {"frames": frames, "meta": {"image": "muebles.png", "size": {"w": ancho, "h": alto}, "scale": "1"}}


# ─── El armado ───────────────────────────────────────────────────────────────

class Barrio:
    def __init__(self, fuentes: Fuentes):
        self.f = fuentes
        self.suelo = lienzo(W, H)
        self.solido = [[0] * (W // C) for _ in range(H // C)]
        self.atlas = Atlas()
        self.instancias: list[dict] = []
        self.puestos: dict[str, list[dict]] = {}
        self.puntos: dict[str, dict] = {}
        self.techos: dict[str, dict] = {}
        self.estantes: list[dict] = []
        self.estaciones: list[dict] = []
        self.lotes: list[dict] = []
        self.pilas: dict[str, dict] = {}
        self.lpc_cargar()

    # ── LPC
    def lpc_cargar(self):
        terr = self.f.imagen(FUENTES["atlas"][0], FUENTES["atlas"][1])
        grass = self.f.imagen(FUENTES["base"][0], FUENTES["base"][1])
        self.pasto = [grass.crop((x * T, 5 * T, x * T + T, 6 * T)) for x in range(3)] + [grass.crop((T, 3 * T, 2 * T, 4 * T))]
        self.arbol_redondo = terr.crop((929, 901, 1024, 1019))
        self.arbol_joven = terr.crop((867, 930, 927, 1021))
        copa = terr.crop((870, 500, 955, 592))
        tronco = terr.crop((915, 607, 974, 647))
        pino = lienzo(85, 130)
        pino.alpha_composite(tronco, (14, 90))
        pino.alpha_composite(copa, (0, 0))
        self.pino = pino
        arbustos = terr.crop((760, 380, 1024, 480))
        self.arbusto = [self._recortar(arbustos.crop((0, 0, 110, 100))), self._recortar(arbustos.crop((105, 0, 205, 100)))]
        self.hongos_lpc = self._recortar(terr.crop((898, 896, 922, 926)))
        ofi = lambda n: self.f.imagen(FUENTES["oficina"][0], n)
        lap = ofi("Laptop.png")
        self.laptop_espalda = [lap.crop((x * 32, 96, x * 32 + 32, 128)) for x in range(4)]
        self.laptop_frente = [lap.crop((x * 32, 0, x * 32 + 32, 32)) for x in range(4)]
        self.fotocopiadora = self._recortar(ofi("Copy Machine.png"))
        agua = ofi("Water Cooler.png")
        self.agua = self._recortar(agua.crop((32, 0, 64, 64)))
        cafe = ofi("Coffee Maker.png")
        self.cafetera = self._recortar(cafe.crop((0, 0, 32, 32)))
        tv = ofi("TV, Widescreen.png")
        self.tv = self._recortar(tv.crop((96, 0, 192, 64)))
        canecas = ofi("Bins.png")
        self.caneca = self._recortar(canecas.crop((0, 0, 32, 64)))
        self.buzones = self._recortar(ofi("Mailboxes.png"))
        retratos = ofi("Office Portraits.png")
        self.retratos = [self._recortar(retratos.crop((x, y, x + 32, y + 32))) for x in (0, 32) for y in (0, 32)]

    @staticmethod
    def _recortar(im: Image.Image) -> Image.Image:
        caja_ = im.getbbox()
        return im.crop(caja_) if caja_ else im

    # ── Choques
    def bloquear(self, x0, y0, x1, y1):
        """Bloquea las celdas de 16 px que toca el rectángulo [x0,x1)×[y0,y1) en px."""
        for cy in range(max(0, int(y0) // C), min(H // C, (int(math.ceil(y1)) + C - 1) // C)):
            for cx in range(max(0, int(x0) // C), min(W // C, (int(math.ceil(x1)) + C - 1) // C)):
                self.solido[cy][cx] = 1

    def liberar(self, x0, y0, x1, y1):
        for cy in range(max(0, int(y0) // C), min(H // C, (int(math.ceil(y1)) + C - 1) // C)):
            for cx in range(max(0, int(x0) // C), min(W // C, (int(math.ceil(x1)) + C - 1) // C)):
                self.solido[cy][cx] = 0

    # ── Muebles
    def poner(self, nombre: str, im_ancla, x: float, y: float, solido=None, capa: str = "objeto",
              extra: dict | None = None):
        """Un mueble: `x, y` es dónde toca el piso (px). `solido` = (ancho, fondo) en px centrado
        en el ancla y hacia arriba, o None para que no estorbe (alfombras, cosas de pared)."""
        if nombre not in self.atlas.cuadros:
            self.atlas.agregar(nombre, im_ancla)
        inst = {"f": nombre, "x": int(x), "y": int(y)}
        if capa != "objeto":
            inst["capa"] = capa
        if extra:
            inst.update(extra)
        self.instancias.append(inst)
        if solido:
            w, fondo = solido
            self.bloquear(x - w / 2, y - fondo, x + w / 2, y)
        return inst

    def pegar_suelo(self, im: Image.Image, x: int, y: int):
        self.suelo.alpha_composite(im, (int(x), int(y)))

    # ── Afuera
    def afuera(self):
        # Pasto en todo el barrio, con baldosas variadas y matas más oscuras.
        r = random.Random(1)
        for ty in range(ALTO_T):
            for tx in range(ANCHO_T):
                self.suelo.alpha_composite(self.pasto[r.choice([0, 0, 1, 2, 3])], (tx * T, ty * T))
        d = ImageDraw.Draw(self.suelo)
        for _ in range(900):
            x, y = r.randint(0, W), r.randint(0, H)
            c = r.choice([rgb("3d7a33"), rgb("5c9c3f"), rgb("6fae4a")])
            d.line([(x, y), (x + 1, y - 3)], fill=c)
            d.line([(x + 2, y), (x + 3, y - 2)], fill=c)
        # Florecitas
        for _ in range(140):
            x, y = r.randint(0, W - 4), r.randint(0, H - 4)
            c = rgb(r.choice(["fff2a8", "ffffff", "ffb3c6", "c8b6ff", "ffd166"]))
            rect(self.suelo, x, y, x + 2, y + 2, c)
            rect(self.suelo, x + 1, y + 2, x + 2, y + 3, rgb("3d7a33"))
        # Calle
        y0, y1 = FILA_CALLE[0] * T, FILA_CALLE[1] * T
        asf = rgb("4a4c55")
        rect(self.suelo, 0, y0, W, y1, asf)
        ruido(self.suelo, 0, y0, W, y1, [rgb("54565f"), rgb("42444c"), rgb("5c5e68")], 0.18, 11)
        for x in range(0, W, 96):
            rect(self.suelo, x + 16, (y0 + y1) // 2 - 2, x + 64, (y0 + y1) // 2 + 2, rgb("f2d16b"))
        rect(self.suelo, 0, y0 + 6, W, y0 + 8, rgb("e8e8e8"))
        rect(self.suelo, 0, y1 - 8, W, y1 - 6, rgb("e8e8e8"))
        # Cebra frente a la tienda
        for k in range(7):
            rect(self.suelo, 70 * T + k * 14, y0 + 12, 70 * T + k * 14 + 8, y1 - 12, rgb("ececec"))
        # Andenes (con sardinel hacia la calle)
        for (a, b), lado in ((FILA_ANDEN_N, "abajo"), (FILA_ANDEN_S, "arriba")):
            and_ = textura_concreto(W, (b - a) * T, rgb("c9c6bf"), 32, a)
            self.pegar_suelo(and_, 0, a * T)
            yy = b * T - 6 if lado == "abajo" else a * T
            rect(self.suelo, 0, yy, W, yy + 6, rgb("9e9a92"))
            rect(self.suelo, 0, yy + (5 if lado == "abajo" else 0), W, yy + (6 if lado == "abajo" else 1), OUT)
        # Patios (portón, recepción) y entrada de carros a la recepción
        for cid in ("porton", "recepcion"):
            c = CUARTO[cid]
            self.pegar_suelo(textura_concreto((c.x1 - c.x0) * T, (c.y1 - c.y0) * T, rgb("b7b3aa"), 64, c.x0), c.x0 * T, c.y0 * T)
        self.pegar_suelo(textura_concreto(4 * T, 4 * T, rgb("b7b3aa"), 64, 7), 58 * T, 28 * T)
        # Caminos de piedra del andén a la puerta del búnker y de la tienda
        for casa in (CASA["bunker"], CASA["tienda"]):
            cx = int(casa.puerta_x * T)
            for k, y in enumerate(range(casa.y1 * T, FILA_ANDEN_N[0] * T, 20)):
                dx = (k % 2) * 6 - 3
                ImageDraw.Draw(self.suelo).rounded_rectangle([cx - 22 + dx, y + 2, cx + 22 + dx, y + 17], 5,
                                                             fill=rgb("cfc8b8"), outline=rgb("8f8778"))
        # Tierra del cultivo de hongos
        c = CUARTO["hongos"]
        rect(self.suelo, c.x0 * T, c.y0 * T, c.x1 * T, c.y1 * T, rgb("7a5a3c"))
        ruido(self.suelo, c.x0 * T, c.y0 * T, c.x1 * T, c.y1 * T, [rgb("6a4c32"), rgb("8b6a48")], 0.25, 5)
        # Parque al sur: senderos
        y = 43 * T
        rect(self.suelo, 0, y, W, y + 24, rgb("d8c7a0"))
        ruido(self.suelo, 0, y, W, y + 24, [rgb("c9b68c"), rgb("e5d6b2")], 0.25, 8)

        # Árboles y arbustos alrededor (con su tronco como choque)
        for x in list(range(1, 80, 5)):
            self.arbol(x * T + r.randint(-8, 8), 2 * T + r.randint(-6, 4), r.choice(["redondo", "pino", "joven"]))
        for x in (6, 18, 31, 47, 60, 74):
            self.arbol(x * T, 44 * T + 10, r.choice(["redondo", "pino"]))
        for x in (12, 40, 54, 68):
            self.poner("banca", m_banca(), x * T, 42 * T + 8, (60, 14))
        # La mesa de ajedrez del parque: dos bancos y quien juega se sienta de lado
        ax, ay = 25 * T, 42 * T + 8
        self.poner("mesa_ajedrez", m_mesa_ajedrez(), ax, ay, (34, 12))
        for dx in (-34, 34):
            self.poner("banquito", m_banquito(), ax + dx, ay - 2, None, extra={"zbase": ay - 12})
        self.estacion("ajedrez", "ajedrez", ax, ay - 50, ay + 1, (ax - 34, ay - 6, "derecha", "sentado"), tipo="ajedrez")
        self.punto("ajedrez_der", ax + 34, ay - 6, "izquierda")
        # La cancha de tenis del parque (minijuego en equipo): A juega a la izquierda de la red, B a la derecha
        tx_, ty_ = 35 * T, 41 * T + 4
        self.pegar_suelo(textura_cancha_tenis(), tx_ - 88, ty_)
        self.estacion("tenis", "tenis", tx_, ty_ + 40, ty_ + 41, (tx_, ty_ - 8, "abajo", "parado"), tipo="tenis")
        self.punto("tenis_A", tx_ - 60, ty_ + 52, "derecha", paso=24)
        self.punto("tenis_B", tx_ + 60, ty_ + 52, "izquierda", paso=24)
        for x in range(4, 80, 10):
            self.poner("poste", m_poste(), x * T, 33 * T + 8, (10, 10))
            self.poner("poste", m_poste(), x * T + 5 * T, 40 * T + 10, (10, 10))
        for (x, y) in ((1, 30), (26.5, 30), (64, 31), (79, 30), (64.5, 12), (65, 20)):
            self.poner(f"arbusto{int(x) % 2}", (self.arbusto[int(x) % 2], (self.arbusto[int(x) % 2].width // 2, self.arbusto[int(x) % 2].height - 6)),
                       x * T, y * T, (60, 20))
        # Fuera del mapa por los lados no se camina
        self.bloquear(0, 0, W, 2 * T)

    def vecindario(self):
        """Al sur del parque: andén, tres pasajes, la calle de las casas y 16 terrenos con su cerca."""
        r = random.Random(7)
        a, b = FILA_ANDEN_V
        self.pegar_suelo(textura_concreto(W, (b - a) * T, rgb("c9c6bf"), 32, a), 0, a * T)
        rect(self.suelo, 0, a * T, W, a * T + 3, rgb("9e9a92"))
        for x0, x1 in PASAJES_X:
            self.pegar_suelo(textura_concreto((x1 - x0) * T, (FILA_CALLE_V[0] - b) * T, rgb("c9c6bf"), 32, x0), x0 * T, b * T)
        y0, y1 = FILA_CALLE_V[0] * T, FILA_CALLE_V[1] * T
        rect(self.suelo, 0, y0, W, y1, rgb("55575f"))
        ruido(self.suelo, 0, y0, W, y1, [rgb("5f616a"), rgb("4c4e56")], 0.15, 21)
        for x in range(0, W, 80):
            rect(self.suelo, x + 20, (y0 + y1) // 2 - 2, x + 56, (y0 + y1) // 2 + 1, rgb("e8e8e8"))
        rect(self.suelo, 0, y0, W, y0 + 4, rgb("9e9a92")); rect(self.suelo, 0, y1 - 4, W, y1, rgb("9e9a92"))
        madera, poste = rgb("a8754a"), rgb("6e4128")
        n = 0
        for fy, frente, precio, precio_centro in FILAS_LOTES:
            for k, fx in enumerate(LOTES_X):
                n += 1
                lid = f"L{n:02d}"
                x0, ly0 = fx * T, fy * T
                x1, ly1 = x0 + LOTE * T, ly0 + LOTE * T
                # El terreno: pasto un poco más claro, para que se vea dónde empieza y termina
                velo = lienzo(LOTE * T, LOTE * T)
                rect(velo, 0, 0, LOTE * T, LOTE * T, (180, 220, 120, 34))
                self.pegar_suelo(velo, x0, ly0)
                # La cerca: tablas bajas por los cuatro lados, con la entrada (baldosas 3 y 4) hacia la calle
                ent0, ent1 = x0 + 3 * T, x0 + 5 * T
                lado_calle = ly1 if frente == "abajo" else ly0
                for (ax, ay, bx, by) in ((x0, ly0, x1, ly0), (x0, ly1, x1, ly1), (x0, ly0, x0, ly1), (x1, ly0, x1, ly1)):
                    horizontal = ay == by
                    if horizontal:
                        tramos = [(ax, bx)] if ay != lado_calle else [(ax, ent0), (ent1, bx)]
                        for t0, t1 in tramos:
                            yy = ay - 4 if ay == ly1 else ay
                            rect(self.suelo, t0, yy + 1, t1, yy + 3, madera)
                            for px in range(t0, t1 + 1, 16):
                                rect(self.suelo, px - 1, yy - 1, px + 2, yy + 5, poste)
                            self.bloquear(t0, yy - 2, t1, yy + 6)
                    else:
                        xx = ax - 4 if ax == x1 else ax
                        rect(self.suelo, xx + 1, ay, xx + 3, by, madera)
                        for py in range(ay, by + 1, 16):
                            rect(self.suelo, xx - 1, py - 1, xx + 5, py + 2, poste)
                        self.bloquear(xx - 2, ay, xx + 6, by)
                # Piedritas en la entrada
                for j in range(2):
                    yy = (ly1 - 20 - j * 18) if frente == "abajo" else (ly0 + 6 + j * 18)
                    ImageDraw.Draw(self.suelo).rounded_rectangle([x0 + 4 * T - 16, yy, x0 + 4 * T + 16, yy + 12], 4,
                                                                 fill=rgb("cfc8b8"), outline=rgb("8f8778"))
                entrada = {"x": x0 + 4 * T, "y": (ly1 + 16) if frente == "abajo" else (ly0 - 12)}
                letrero = {"x": x0 + 6 * T + 8, "y": (ly1 - 6) if frente == "abajo" else (ly0 + 44)}
                self.poner("letrero_lote", m_letrero_lote(), letrero["x"], letrero["y"], (10, 6))
                self.estacion("", "casa", letrero["x"], letrero["y"] - 44, letrero["y"] + 1,
                              (entrada["x"], entrada["y"], "arriba" if frente == "abajo" else "abajo", "parado"), tipo="lote", lote=lid)
                self.lotes.append({"id": lid, "x": x0, "y": ly0, "lado": LOTE, "baldosa": T, "frente": frente,
                                   "precio": precio_centro if k in (3, 4) else precio, "entrada": entrada, "letrero": letrero})
        # Árboles al fondo del vecindario y borde sur del mapa
        for x in range(3, ANCHO_T, 6):
            self.arbol(x * T + r.randint(-6, 6), 68 * T + 20, r.choice(["redondo", "pino", "joven"]))
        self.bloquear(0, H - T // 2, W, H)

    def arbol(self, x, y, tipo):
        im = {"redondo": self.arbol_redondo, "pino": self.pino, "joven": self.arbol_joven}[tipo]
        ancla = (im.width // 2, im.height - 6)
        self.poner(f"arbol_{tipo}", (im, ancla), x, y, (24, 14))

    # ── Casas por dentro
    def pisos_y_muros(self):
        for c in CUARTOS:
            if c.afuera:
                continue
            x0, y0, x1, y1 = c.x0 * T, c.y0 * T, c.x1 * T, c.y1 * T
            w, h = x1 - x0, y1 - y0
            if c.piso == "madera":
                tex = textura_madera(w, h, semilla=x0 + y0)
            elif c.piso == "madera_clara":
                tex = textura_madera(w, h, [rgb("a77a52"), rgb("c99c6c"), rgb("d8ae7e"), rgb("e4bf90")], x0)
            elif c.piso == "baldosa":
                tex = textura_baldosa(w, h, rgb("e9e4d8"), rgb("d6cfbf"), 32)
            elif c.piso == "baldosa_tienda":
                tex = textura_baldosa(w, h, rgb("f6f3ea"), rgb("dfe9f2"), 32)
            elif c.piso == "sistemas":
                tex = textura_baldosa(w, h, rgb("4a5878"), rgb("43506e"), 32, rgb("3a4560"))
            elif c.piso == "alfombra":
                tex = textura_madera(w, h, [rgb("5b4a63"), rgb("6e5a77"), rgb("7d688a"), rgb("8a7598")], x0)
            else:
                tex = textura_concreto(w, h, rgb("b9b5ad"), 64, x0)
            self.pegar_suelo(tex, x0, y0)
            # Cara del muro norte (la que se ve desde arriba): pintura, zócalo y moldura
            pared = rgb(c.pared)
            rect(self.suelo, x0, y0, x1, y0 + ALTO_PARED, pared)
            ruido(self.suelo, x0, y0, x1, y0 + ALTO_PARED, [oscurecer(pared, 0.04), aclarar(pared, 0.05)], 0.1, x0 * 7 + y0)
            rect(self.suelo, x0, y0, x1, y0 + 4, aclarar(pared, 0.25))
            rect(self.suelo, x0, y0 + ALTO_PARED - 10, x1, y0 + ALTO_PARED, MADERA[2])
            rect(self.suelo, x0, y0 + ALTO_PARED - 10, x1, y0 + ALTO_PARED - 9, MADERA[3])
            rect(self.suelo, x0, y0 + ALTO_PARED, x1, y0 + ALTO_PARED + 4, (20, 12, 18, 60))
            self.bloquear(x0, y0, x1, y0 + ALTO_PARED - 8)
        # Muros vistos desde arriba: el contorno de cada casa y las divisiones entre cuartos
        for casa in CASAS:
            self.muro_rect(casa.x0 * T, casa.y0 * T, casa.x1 * T, casa.y1 * T, casa.pared)
        for c in CUARTOS:
            if not c.afuera:
                self.muro_rect(c.x0 * T, c.y0 * T, c.x1 * T, c.y1 * T, CASA[c.casa].pared)
        # Puertas: se abre el muro (y la cara del muro, si la puerta va en un muro horizontal)
        for a, b, o, pos, centro, ancho in PUERTAS:
            self.abrir_puerta(a, b, o, pos, centro, ancho)
        for casa in CASAS:
            cx = casa.puerta_x * T
            y = casa.y1 * T
            self.abrir_hueco(cx - T, y - GROSOR, cx + T, y + 2, horizontal=True, casa=casa)

    def muro_rect(self, x0, y0, x1, y1, color):
        g = GROSOR
        for (a, b, c, d) in ((x0, y0, x1, y0 + g // 2), (x0, y1 - g // 2, x1, y1), (x0, y0, x0 + g // 2, y1), (x1 - g // 2, y0, x1, y1)):
            self.muro(a, b, c, d, color)

    def muro(self, x0, y0, x1, y1, color):
        tope = aclarar(rgb(color), 0.15)
        rect(self.suelo, x0, y0, x1, y1, tope)
        rect(self.suelo, x0, y0, x1, y0 + 1, OUT)
        rect(self.suelo, x0, y1 - 1, x1, y1, OUT)
        rect(self.suelo, x0, y0, x0 + 1, y1, OUT)
        rect(self.suelo, x1 - 1, y0, x1, y1, OUT)
        self.bloquear(x0, y0, x1, y1)

    def abrir_puerta(self, a, b, o, pos, centro, ancho):
        if o == "v":
            x = pos * T
            y0, y1 = (centro - ancho / 2) * T, (centro + ancho / 2) * T
            self.abrir_hueco(x - GROSOR, y0, x + GROSOR, y1, horizontal=False)
        else:
            y = pos * T
            x0, x1 = (centro - ancho / 2) * T, (centro + ancho / 2) * T
            self.abrir_hueco(x0, y - GROSOR, x1, y + ALTO_PARED, horizontal=True, cuarto_abajo=CUARTO[b])

    def abrir_hueco(self, x0, y0, x1, y1, horizontal, casa: Casa | None = None, cuarto_abajo: Cuarto | None = None):
        """Hueco de puerta: el piso sigue (umbral de madera) y se libera el paso."""
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        if cuarto_abajo is not None:
            # Puerta en la cara del muro norte del cuarto de abajo: un vano con marco.
            rect(self.suelo, x0, y0, x1, y1, rgb("3a2a22"))
            rect(self.suelo, x0 + 4, y0 + GROSOR, x1 - 4, y1, MADERA[1])
            textura = textura_baldosa(x1 - x0 - 8, y1 - y0 - GROSOR, rgb("e9e4d8"), rgb("d6cfbf"), 32)
            self.suelo.alpha_composite(textura, (x0 + 4, y0 + GROSOR))
            rect(self.suelo, x0, y0, x0 + 4, y1, MADERA[2]); rect(self.suelo, x1 - 4, y0, x1, y1, MADERA[2])
            rect(self.suelo, x0, y0, x1, y0 + 4, MADERA[2])
        else:
            umbral = MADERA[3]
            if horizontal:
                rect(self.suelo, x0, y0, x1, y1, umbral)
                rect(self.suelo, x0, y0, x0 + 3, y1, MADERA[1]); rect(self.suelo, x1 - 3, y0, x1, y1, MADERA[1])
            else:
                rect(self.suelo, x0, y0, x1, y1, umbral)
                rect(self.suelo, x0, y0, x1, y0 + 3, MADERA[1]); rect(self.suelo, x0, y1 - 3, x1, y1, MADERA[1])
        self.liberar(x0, y0, x1, y1)

    # ── Amoblar
    def puesto(self, lugar: str, x, y, dir_: str, pose: str):
        self.puestos.setdefault(lugar, []).append({"x": int(x), "y": int(y), "dir": dir_, "pose": pose})

    def punto(self, nombre: str, x, y, dir_: str = "abajo", **extra):
        self.puntos[nombre] = {"x": int(x), "y": int(y), "dir": dir_, **extra}

    def puesto_escritorio(self, lugar, x, y, laptop=0, silla="#2f3b55"):
        """Escritorio mirando a la calle: quien trabaja se sienta detrás (al norte) y se le ve la cara."""
        self.poner(f"silla_{silla}", m_silla_oficina(silla), x, y - 32, None, extra={"z": -2})
        self.puesto(lugar, x, y - 30, "abajo", "sentado")
        self.poner("escritorio", m_escritorio(), x, y, (64, 22))
        lap = self.laptop_espalda[laptop % 4]
        self.poner(f"laptop{laptop % 4}", (lap, (16, 28)), x - 8, y - 18, None, extra={"zbase": int(y) + 1})

    def amoblar(self):
        tx = lambda v: v * T
        # Cada módulo de la app tiene su objeto en el barrio (self.estacion): el ícono sobre el mueble,
        # y el sitio donde se para (o se sienta) quien lo usa. Las personas que no juegan van ahí
        # cuando tienen abierto ese módulo; el jugador lo examina con A y lo abre.
        # ── Gerencia: Dirigir
        self.puesto_escritorio("gerencia", tx(7), tx(9) + 8, 0)
        self.estacion("dashboard", "grafica", tx(7) + 22, tx(9) - 22, tx(9) + 9, (tx(7), tx(9) - 22, "abajo", "sentado"))
        self.poner("biblioteca", m_biblioteca(), tx(4), tx(5) + 30, (60, 18))
        self.estacion("rentabilidad", "monedas", tx(4), tx(5) - 46, tx(5) + 31, (tx(4), tx(7), "arriba", "parado"))
        self.poner("archivador", m_archivador(), tx(9) + 8, tx(5) + 30, (28, 14))
        self.estacion("rrhh", "personas", tx(9) + 8, tx(5) - 26, tx(5) + 31, (tx(9) + 8, tx(7), "arriba", "parado"))
        self.poner("tv", (self.tv, (self.tv.width // 2, self.tv.height)), tx(6) + 16, tx(4) + 46, None, extra={"z": -50})
        self.estacion("salud-negocio", "corazon", tx(6) + 16, tx(3) + 30, tx(4) + 47, (tx(6) + 16, tx(7), "arriba", "parado"))
        self.poner("sofa", m_sofa(96, "#4f6d8f"), tx(6) + 16, tx(13) - 4, (92, 20))
        self.puesto("gerencia", tx(5) + 16, tx(13) - 14, "abajo", "sentado")
        self.poner("mesa_proyectos", m_mesa(64, 32, [rgb("5b3a26"), rgb("7f5236"), rgb("a06c46"), rgb("c08a5c"), rgb("d8a879")]), tx(10) + 10, tx(11) + 4, (60, 20))
        self.estacion("colaboradores", "proyectos", tx(10) + 10, tx(10) + 10, tx(11) + 5, (tx(10) + 10, tx(12) - 2, "arriba", "parado"))
        self.poner("planta", m_planta(40), tx(11) - 4, tx(13) - 2, (20, 10))
        self.poner("planta", m_planta(40), tx(3) - 2, tx(13) - 2, (20, 10))
        self.poner("cuadro_azul", m_cuadro("#3b7dd8"), tx(10), tx(4) + 30, None, extra={"z": -50})
        self.pegar_suelo(textura_alfombra(5 * T, 3 * T, rgb("7d3c4a"), rgb("4a2230")), tx(4) + 16, tx(7) + 8)
        self.poner("reloj", m_reloj(), tx(8), tx(4) + 10, None, extra={"z": -50})
        # ── Contabilidad: Contar (y lo que se paga de Abastecer)
        self.puesto_escritorio("contabilidad", tx(18), tx(9) + 8, 1)
        self.estacion("ingresos-egresos", "monedas", tx(18) + 22, tx(9) - 22, tx(9) + 9, (tx(18), tx(9) - 22, "abajo", "sentado"))
        self.puesto_escritorio("contabilidad", tx(22) + 8, tx(9) + 8, 2)
        self.estacion("pagos", "billete", tx(22) + 30, tx(9) - 22, tx(9) + 9, (tx(22) + 8, tx(9) - 22, "abajo", "sentado"))
        self.poner("cartelera", m_cartelera(), tx(18), tx(4) + 26, None, extra={"z": -50})
        self.estacion("contabilidad-inicio", "lista", tx(18), tx(3) + 30, tx(4) + 27, (tx(18), tx(7), "arriba", "parado"))
        for k, (x, panel, icono) in enumerate(((tx(16) + 8, "facturas", "sobre"), (tx(17) + 12, "creditos-adquiridos", "banco"),
                                               (tx(23) + 4, "socios", "personas"))):
            self.poner("archivador", m_archivador(), x, tx(5) + 30, (28, 14))
            self.estacion(panel, icono, x, tx(5) - 26, tx(5) + 31, (x, tx(7), "arriba", "parado"))
        self.poner("biblioteca", m_biblioteca(64), tx(21), tx(5) + 30, (60, 18))
        self.estacion("libro-mayor", "libro", tx(21) - 16, tx(5) - 46, tx(5) + 31, (tx(21) - 16, tx(7), "arriba", "parado"))
        self.estacion("centros-costo", "carpeta", tx(21) + 16, tx(5) - 46, tx(5) + 31, (tx(21) + 16, tx(7), "arriba", "parado"))
        self.poner("fotocopiadora", (self.fotocopiadora, (self.fotocopiadora.width // 2, self.fotocopiadora.height)), tx(25), tx(5) + 40, (44, 16))
        self.estacion("servicios", "factura", tx(25), tx(5) - 4, tx(5) + 41, (tx(25), tx(7) + 6, "arriba", "parado"))
        self.poner("caja_fuerte", m_caja_fuerte(), tx(25) + 6, tx(10), (28, 14))
        self.estacion("prestamos", "llave", tx(25) + 6, tx(9) - 6, tx(10) + 1, (tx(24) + 4, tx(10), "derecha", "parado"))
        self.poner("mesa_reunion", m_mesa(112, 40), tx(20), tx(13), (108, 26))
        for x, panel, icono in ((tx(20) - 36, "operativos", "calculadora"), (tx(20), "impuestos", "sello"), (tx(20) + 36, "conciliacion-contador", "balanza")):
            self.estacion(panel, icono, x, tx(12) - 8, tx(13) + 1, (x, tx(14) - 10, "arriba", "parado"))
        self.puesto("contabilidad", tx(20), tx(12) - 30, "abajo", "parado")
        self.pegar_suelo(textura_alfombra(4 * T, 2 * T, rgb("3e6b5a"), rgb("234238")), tx(18), tx(11) + 16)
        self.poner("reloj", m_reloj(), tx(23), tx(4) + 10, None, extra={"z": -50})
        # ── Estudio de diseño: Preparar y Publicar
        self.puesto_escritorio("estudio", tx(5), tx(20), 3, "#8e44ad")
        self.estacion("etiquetas", "etiqueta", tx(5) + 22, tx(20) - 30, tx(20) + 1, (tx(5), tx(20) - 30, "abajo", "sentado"))
        self.puesto_escritorio("estudio", tx(9), tx(20), 0, "#8e44ad")
        self.estacion("productos-siigo", "alta", tx(9) + 22, tx(20) - 30, tx(20) + 1, (tx(9), tx(20) - 30, "abajo", "sentado"))
        self.estacion("costos-productos", "costos", tx(9) - 22, tx(20) - 30, tx(20) + 1, (tx(9), tx(20) - 30, "abajo", "sentado"))
        self.poner("biblioteca", m_biblioteca(64), tx(4), tx(16) + 30, (60, 18))
        self.estacion("fichas", "ficha", tx(4) - 16, tx(16) - 46, tx(16) + 31, (tx(4) - 16, tx(18), "arriba", "parado"))
        self.estacion("catalogo-alegra", "catalogo", tx(4) + 16, tx(16) - 46, tx(16) + 31, (tx(4) + 16, tx(18), "arriba", "parado"))
        self.poner("fotocopiadora", (self.fotocopiadora, (self.fotocopiadora.width // 2, self.fotocopiadora.height)), tx(10) + 4, tx(16) + 40, (44, 16))
        self.estacion("etiquetas-config", "plantilla", tx(10) + 4, tx(16), tx(16) + 41, (tx(10) + 4, tx(18) + 4, "arriba", "parado"))
        self.poner("cuadro_rosa", m_cuadro("#d85a9b"), tx(6) + 16, tx(14) + 30, None, extra={"z": -50})
        self.estacion("vitrina-web", "vitrina", tx(6) + 16, tx(14) + 4, tx(14) + 31, (tx(6) + 16, tx(17), "arriba", "parado"))
        self.poner("afiche_rosa", m_afiche("#d85a9b", "#fff6a8"), tx(8) + 8, tx(14) + 40, None, extra={"z": -50})
        self.estacion("publicidad", "megafono", tx(8) + 8, tx(14) + 6, tx(14) + 41, (tx(8) + 8, tx(17), "arriba", "parado"))
        self.poner("tripode", m_tripode(), tx(7), tx(18) + 22, (14, 8))
        self.estacion("contenido", "camara", tx(7), tx(17) - 2, tx(18) + 23, (tx(7), tx(19) + 14, "arriba", "parado"))
        # ── Sala de sistemas: Sistema
        for x, panel, icono in ((tx(3) + 14, "conexiones", "enchufe"), (tx(5), "telemetria", "alerta")):
            self.poner("rack", m_rack(), x, tx(23) + 28, (40, 16))
            self.estacion(panel, icono, x, tx(21) + 40, tx(23) + 29, (x, tx(24) + 14, "arriba", "parado"))
        self.poner("pantalla_mapa", m_pantalla_mapa(), tx(8), tx(22) + 22, None, extra={"z": -50})
        self.estacion("mapa-sistema", "mapa", tx(8) - 24, tx(21) + 8, tx(22) + 23, (tx(8) - 24, tx(24), "arriba", "parado"))
        self.estacion("mapa-vivo", "monitor", tx(8) + 24, tx(21) + 8, tx(22) + 23, (tx(8) + 24, tx(24), "arriba", "parado"))
        self.poner("reloj", m_reloj(), tx(11) - 4, tx(21) + 12, None, extra={"z": -50})
        self.estacion("tareas-programadas", "reloj", tx(11) - 4, tx(21) + 2 + 26, tx(21) + 13, (tx(11) - 4, tx(24), "arriba", "parado"))
        self.puesto_escritorio("sistemas", tx(6), tx(26) + 8, 1)
        self.estacion("control-versiones", "ramas", tx(6) - 22, tx(26) - 22, tx(26) + 9, (tx(6), tx(26) - 22, "abajo", "sentado"))
        self.estacion("arquitectura", "plano", tx(6) + 22, tx(26) - 22, tx(26) + 9, (tx(6), tx(26) - 22, "abajo", "sentado"))
        self.poner("mesa_ajustes", m_mesa(64, 30, [rgb("5d5f6b"), rgb("7d8090"), rgb("a2a6b6"), rgb("d0d4dc"), rgb("eef0f4")]), tx(10) + 4, tx(26) + 4, (60, 18))
        self.estacion("settings", "engranaje", tx(10) - 10, tx(25) + 14, tx(26) + 5, (tx(10) - 10, tx(27) + 6, "arriba", "parado"))
        self.estacion("placas-concreto", "placa", tx(10) + 18, tx(25) + 14, tx(26) + 5, (tx(10) + 18, tx(27) + 6, "arriba", "parado"))
        # ── Pasillo del búnker: la agenda, el tinto (chat del equipo), los juegos y el directorio
        self.poner("cartelera_agenda", m_cartelera(), tx(13), tx(4) + 26, None, extra={"z": -50})
        self.estacion("hugo", "agenda", tx(13) - 12, tx(3) + 28, tx(4) + 27, (tx(13) - 12, tx(7), "arriba", "parado"))
        self.poner("agua", (self.agua, (self.agua.width // 2, self.agua.height)), tx(14) + 6, tx(5) + 40, (24, 12))
        self.estacion("chat-equipo", "charla", tx(14) + 6, tx(4) + 8, tx(5) + 41, (tx(14) + 2, tx(7) + 6, "arriba", "parado"))
        self.punto("cafe_bunker", tx(13) + 26, tx(6) + 20, "arriba")
        self.poner("arcade", m_arcade(), tx(14) + 8, tx(16) + 8, (26, 12))
        self.estacion("juegos", "control", tx(14) + 8, tx(14) + 10, tx(16) + 9, (tx(13), tx(16) + 2, "derecha", "parado"))
        self.directorio("bunker", tx(14) + 10, tx(27) + 4, (tx(13), tx(27) + 8, "derecha", "parado"))
        # ── Cuartos del búnker
        self.cuarto_dormir("cuarto_bunker_1", 15, 14, 26, 21, "#4a7fbf", doble=True)
        self.cuarto_dormir("cuarto_bunker_2", 15, 21, 26, 28, "#c0567a")
        # ── Oficina de la sede: Entregar y Facturar (y la cocina)
        self.poner("meson", m_meson(128, ("lavaplatos", "estufa")), tx(33), tx(5) + 44, (128, 24))
        self.poner("nevera", m_nevera(), tx(30) + 4, tx(5) + 46, (30, 16))
        self.poner("cafetera", (self.cafetera, (self.cafetera.width // 2, self.cafetera.height)), tx(31) + 18, tx(5) + 18, None, extra={"zbase": tx(5) + 45})
        self.estacion("chat-equipo", "charla", tx(31) + 18, tx(4) + 4, tx(5) + 46, (tx(31) + 20, tx(6) + 30, "arriba", "parado"))
        self.punto("cocina", tx(34) + 8, tx(6) + 26, "arriba")
        self.punto("lavaplatos", tx(31) + 22, tx(6) + 26, "arriba")
        self.punto("cafe_sede", tx(31) + 20, tx(6) + 30, "arriba")
        self.poner("comedor", m_comedor(), tx(33), tx(10) + 8, (60, 22))
        self.puesto("oficina_sede", tx(32), tx(9) + 8, "abajo", "sentado")
        self.puesto_escritorio("oficina_sede", tx(38), tx(7) + 8, 1)
        self.estacion("pedidos", "carrito", tx(38) + 22, tx(7) - 22, tx(7) + 9, (tx(38), tx(7) - 22, "abajo", "sentado"))
        self.puesto_escritorio("oficina_sede", tx(38), tx(11) + 8, 2)
        self.estacion("facturacion", "factura", tx(38) - 22, tx(11) - 22, tx(11) + 9, (tx(38), tx(11) - 22, "abajo", "sentado"))
        self.estacion("sync", "sync", tx(38) + 22, tx(11) - 22, tx(11) + 9, (tx(38), tx(11) - 22, "abajo", "sentado"))
        self.puesto_escritorio("oficina_sede", tx(38), tx(15) + 8, 3)
        self.estacion("astro-killer", "rastreo", tx(38) - 22, tx(15) - 22, tx(15) + 9, (tx(38), tx(15) - 22, "abajo", "sentado"))
        self.estacion("anulaciones", "anular", tx(38) + 22, tx(15) - 22, tx(15) + 9, (tx(38), tx(15) - 22, "abajo", "sentado"))
        self.poner("mesa_empaque", m_mesa_empaque(), tx(32), tx(16), (126, 32))
        self.estacion("empaque", "camara", tx(31) - 2, tx(15) - 12, tx(16) + 1, (tx(31), tx(16) + 22, "arriba", "parado"))
        self.estacion("guias-envio", "impresora", tx(33) + 18, tx(15) - 12, tx(16) + 1, (tx(33) + 18, tx(16) + 22, "arriba", "parado"))
        self.punto("empacar", tx(31), tx(16) + 22, "arriba")
        self.punto("embalar", tx(34), tx(16) + 22, "arriba")
        self.punto("lote", tx(30), tx(16) + 22, "arriba")
        self.puesto("oficina_sede", tx(31), tx(16) + 22, "arriba", "parado")
        self.puesto("oficina_sede", tx(34), tx(16) + 22, "arriba", "parado")
        self.punto("guias", tx(38), tx(7) - 22, "abajo")
        self.punto("imprimir_et", tx(38), tx(11) - 22, "abajo")
        self.poner("agua", (self.agua, (self.agua.width // 2, self.agua.height)), tx(41) - 10, tx(5) + 40, (24, 12))
        self.poner("planta", m_planta(40), tx(29) - 6, tx(18) + 26, (20, 10))
        self.poner("ventana", m_ventana(), tx(37), tx(4) + 22, None, extra={"z": -50})
        self.poner("ventana", m_ventana(), tx(40), tx(4) + 22, None, extra={"z": -50})
        self.poner("reloj", m_reloj(), tx(29), tx(4) + 4, None, extra={"z": -50})
        self.poner("cartelera_agenda", m_cartelera(), tx(35) - 4, tx(4) + 26, None, extra={"z": -50})
        self.estacion("hugo", "agenda", tx(35) - 4, tx(3) + 28, tx(4) + 27, (tx(35) - 4, tx(7), "arriba", "parado"))
        self.pegar_suelo(textura_alfombra(3 * T, 2 * T, rgb("c79a5b"), rgb("8a6a3c")), tx(32) - 16, tx(9) + 8)
        # Paquetes por alistar: en la mesa de empaque (se dibujan en vivo)
        # «sobre» = la y de la mesa: lo que está encima se dibuja por delante de ella.
        self.punto("paquetes_por_alistar", tx(31) - 10, tx(15) + 4, "abajo", columnas=8, paso=14, sobre=tx(16) + 1)
        # ── Entrada y cuartos de la sede
        self.poner("planta", m_planta(40), tx(36) + 16, tx(21) + 30, (20, 10))
        self.directorio("sede", tx(36) + 18, tx(27) + 4, (tx(35) + 10, tx(27) + 8, "derecha", "parado"))
        self.cuarto_dormir("cuarto_sede_1", 28, 19, 34, 28, "#3f9e6b")
        self.cuarto_dormir("cuarto_sede_2", 37, 19, 42, 28, "#d9822b")
        # ── Bodega: tres hileras de estanterías; cada casilla es una parte del catálogo
        filas = [tx(6) + 40, tx(12) + 40, tx(18) + 40]
        for fy in filas:
            for k in range(5):
                x = tx(44) + 8 + k * 72
                self.poner("estanteria", m_estanteria(64, 4), x + 32, fy, (64, 22))
                for nivel in range(4):
                    for j in range(4):
                        self.estantes.append({"x": x + 8 + j * 15, "y": fy - 92 + 4 + nivel * 20 + 14, "z": fy})
        self.poner("bultos", m_bultos(), tx(45), tx(26), (60, 22))
        self.poner("bultos", m_bultos(), tx(47) + 8, tx(26), (60, 22))
        self.poner("estiba", m_estiba(), tx(52), tx(26) + 4, None)
        self.poner("cartelera", m_cartelera(), tx(50), tx(4) + 26, None, extra={"z": -50})
        self.estacion("stock", "caja", tx(50), tx(3) + 30, tx(4) + 27, (tx(50), tx(6) + 30, "arriba", "parado"))
        self.poner("atril", m_atril(), tx(43) + 20, tx(10) + 4, (14, 8))
        self.estacion("control-inventario", "lista", tx(43) + 20, tx(9) - 4, tx(10) + 5, (tx(43) + 20, tx(11) + 4, "arriba", "parado"))
        self.punto("aviso_bodega", tx(49), tx(3) + 8, "abajo")
        for k, (x, y) in enumerate([(tx(46), filas[0] + 20), (tx(51), filas[1] + 20), (tx(54), filas[2] + 20), (tx(48), filas[2] + 20)]):
            self.punto(f"ronda_alistar_{k}", x, y, "arriba")
        for k, (x, y) in enumerate([(tx(45), tx(8) + 8), (tx(55) - 8, tx(8) + 8), (tx(55) - 8, tx(23) + 8), (tx(45), tx(23) + 8)]):
            self.punto(f"ronda_aseo_{k}", x, y, "abajo")
        self.punto("envasar", tx(51), tx(25) - 4, "arriba")
        self.punto("preparar", tx(53), tx(25) - 4, "arriba")
        self.puesto("bodega", tx(46), filas[0] + 20, "arriba", "parado")
        self.puesto("bodega", tx(52), filas[1] + 20, "arriba", "parado")
        self.puesto("bodega", tx(49), tx(25) - 4, "arriba", "parado")
        # ── Patio de recepción: Abastecer. El contenedor es la oficina de comercio exterior.
        self.poner("contenedor", m_contenedor(), tx(60), tx(10) + 20, (192, 40))
        for k, (panel, icono) in enumerate((("logistica-proveedores", "agenda"), ("logistica-importaciones", "globo"),
                                            ("logistica-embarques", "barco"), ("logistica-aduanas", "aduana"),
                                            ("logistica-seguimiento", "lupa"), ("compras-exterior", "costos"))):
            x = tx(57) + 12 + k * 30
            self.estacion(panel, icono, x, tx(9) + 22, tx(10) + 21, (x, tx(11) + 18, "arriba", "parado"))
        self.poner("mesa_conteo", m_mesa(64, 32, [rgb("5b3a26"), rgb("7f5236"), rgb("a06c46"), rgb("c08a5c"), rgb("d8a879")]), tx(61), tx(14) + 8, (60, 20))
        self.estacion("recepcion-mercancia", "lista", tx(61), tx(13) + 14, tx(14) + 9, (tx(61), tx(15) + 8, "arriba", "parado"))
        self.poner("bultos", m_bultos(), tx(62) + 10, tx(18), (60, 22))
        self.poner("estiba", m_estiba(), tx(62) + 10, tx(19) + 6, None)
        self.punto("cajas_proveedor", tx(57) + 8, tx(16), "abajo", columnas=4, paso=20)
        self.punto("proveedor", tx(59), tx(19), "izquierda")
        self.puesto("recepcion", tx(58), tx(19), "derecha", "parado")
        self.puesto("recepcion", tx(58), tx(21) + 8, "derecha", "parado")
        self.punto("camion", tx(60), CARRIL_IDA_Y - 14, "derecha")
        # ── Portón: reja con el portón abierto, mesa de paquetes alistados, el mensajero
        reja = m_reja(4 * T)
        for x0 in (28, 32, 39):
            self.poner(f"reja{4 * T}", reja, x0 * T + 2 * T, 32 * T - 4, (4 * T, 8))
        self.poner("mesa_alistados", m_mesa(96, 36, [rgb("5d5f6b"), rgb("7d8090"), rgb("a2a6b6"), rgb("d0d4dc"), rgb("eef0f4")]), tx(31), tx(30) + 16, (92, 24))
        self.estacion("entregas-flex", "camion", tx(32) + 8, tx(29) + 12, tx(30) + 17, (tx(32) + 8, tx(31) + 12, "arriba", "parado"))
        self.punto("paquetes_alistados", tx(29) + 22, tx(29) + 22, "abajo", columnas=6, paso=14, sobre=tx(30) + 17)
        self.puesto("porton", tx(34), tx(30) + 12, "izquierda", "parado")
        self.punto("envio", tx(37), tx(31) + 8, "abajo")
        self.punto("mensajero", tx(37), tx(31) + 8, "arriba")
        self.punto("moto", tx(37), CARRIL_VUELTA_Y - 6, "izquierda")
        self.poner("caneca", (self.caneca, (self.caneca.width // 2, self.caneca.height)), tx(42) + 8, tx(29) + 4, (20, 10))
        # ── Cultivo de hongos (afuera, en el antejardín de la sede)
        for k in range(3):
            self.poner("cama_hongos", m_cama_hongos(96), tx(46) + k * 112, tx(30), (96, 18))
        self.puesto("hongos", tx(47), tx(30) + 28, "arriba", "parado")
        self.puesto("hongos", tx(51), tx(30) + 28, "arriba", "parado")
        self.punto("hongos", tx(47), tx(30) + 28, "arriba")
        # ── Tienda digital: Vender. Un portátil por canal en el mostrador, Hugo en el centro.
        self.poner("mostrador", m_mostrador(256), tx(72) + 16, tx(20), (256, 24))
        self.poner("pantalla_tienda", m_pantalla_tienda(), tx(72) + 16, tx(12) + 54, None, extra={"z": -50})
        self.pegar_suelo(textura_alfombra(4 * T, 3 * T, rgb("2d8fd5"), rgb("1b5f96")), tx(70) + 16, tx(24))
        canales = (("preventa", "pregunta"), ("whatsapp", "whatsapp"), ("webchat", "web"), ("ventas-email", "sobre"))
        for k, x in enumerate((69, 71, 74, 76)):
            lap = self.laptop_espalda[k % 4]
            self.poner(f"laptop{k % 4}", (lap, (16, 28)), tx(x) + 6, tx(20) - 30, None, extra={"zbase": tx(20) + 1})
            self.puesto("tienda", tx(x) + 6, tx(19) - 4, "abajo", "parado")
            self.estacion(canales[k][0], canales[k][1], tx(x) + 6, tx(20) - 58, tx(20) + 2, (tx(x) + 6, tx(19) - 4, "abajo", "parado"))
        self.estacion("voz", "microfono", tx(75) + 6, tx(20) - 34, tx(20) + 2, (tx(75) + 6, tx(19) - 4, "abajo", "parado"))
        self.punto("hugo", tx(72) + 22, tx(19) - 2, "abajo")
        self.punto("mostrador_cliente", tx(72) + 16, tx(21) + 18, "arriba")
        # Dos estantes a cada lado de la pantalla grande (preguntas de MeLi y chats de WhatsApp).
        for k, x in enumerate((tx(66) + 14, tx(68) + 22, tx(75) + 18, tx(77) + 26)):
            self.poner("estanteria_tienda", m_estanteria(64, 3, "madera"), x + 32, tx(13) + 46, (64, 20))
            for nivel in range(3):
                for j in range(4):
                    colores = ["#ff6f3c", "#2ecc71", "#3b7dd8", "#f1c40f", "#9b59b6", "#e74c3c"]
                    self.poner(f"frasco{(k + nivel + j) % 6}", m_frasco(colores[(k + nivel + j) % 6]),
                               x + 10 + j * 15, tx(13) + 46 - 68 + 4 + nivel * 20 + 14, None, extra={"zbase": tx(13) + 47})
        self.poner("mesa_posventa", m_mesa(56, 30, [rgb("1b5f96"), rgb("2d8fd5"), rgb("5db8ff"), rgb("bfe6f5"), rgb("eaf6ff")]), tx(77) + 16, tx(24) + 8, (52, 18))
        self.estacion("postventa", "posventa", tx(77) + 16, tx(23) + 12, tx(24) + 9, (tx(77) + 16, tx(25) + 10, "arriba", "parado"))
        self.directorio("tienda", tx(67) + 10, tx(27) + 4, (tx(68) + 8, tx(27) + 8, "izquierda", "parado"))
        self.poner("planta", m_planta(46, "#2f7d4a"), tx(78), tx(27) - 16, (20, 10))
        # La fila de clientes: de la puerta hacia el andén y por el andén hacia el oriente
        fila = [(tx(72) + 16, tx(23) + 10), (tx(72) + 16, tx(25)), (tx(72) + 16, tx(27) - 8)]
        fila += [(tx(72) + 16, tx(29) + 16), (tx(72) + 16, tx(31))]
        fila += [(tx(74) + k * 40, tx(33) - 4) for k in range(10)]
        self.puntos["fila"] = {"puntos": [{"x": int(x), "y": int(y)} for x, y in fila]}
        # Por dónde se entra y se sale del barrio
        self.punto("llegada_oeste", -T, tx(33) - 4, "derecha")
        self.punto("llegada_este", W + T, tx(33) - 4, "izquierda")

    def estacion(self, panel: str, icono: str, x, y, zbase, uso: tuple, tipo: str = "modulo", casa: str = "", **extra):
        """El objeto de un módulo de la app: el ícono en (x, y) por encima del mueble (zbase = la y
        del mueble) y `uso` = (x, y, dir, pose) donde se para o se sienta quien lo usa."""
        ux, uy, udir, upose = uso
        lugar = self.lugar_de(ux, uy) or self.lugar_de(x, zbase) or ""
        self.estaciones.append({"panel": panel, "icono": icono, "x": int(x), "y": int(y), "z": int(zbase), "lugar": lugar,
                                "uso": {"x": int(ux), "y": int(uy), "dir": udir, "pose": upose}, "tipo": tipo,
                                **({"casa": casa} if casa else {}), **extra})

    def directorio(self, casa: str, x, y, uso: tuple):
        """El directorio de la entrada: dice qué cuarto tiene qué módulos y te lleva."""
        self.poner("directorio", m_directorio(), x, y, (16, 8))
        self.estacion("", "directorio", x, y - 40, y + 1, uso, tipo="directorio", casa=casa)

    def lugar_de(self, x, y) -> str | None:
        for c in CUARTOS:
            if c.x0 * T <= x < c.x1 * T and c.y0 * T <= y < c.y1 * T:
                return c.id
        return None

    def cuarto_dormir(self, lugar, x0, y0, x1, y1, color, doble=False):
        cx = (x0 + x1) / 2 * T
        cama = m_cama(color, doble)
        self.poner(f"cama_{color}_{int(doble)}", cama, x0 * T + 50, y0 * T + 64 + 86, (cama[0].width, 70))
        mx = x0 * T + 50 + cama[0].width // 2 + 18
        self.poner("mesa_noche", m_mesa_noche(), mx, y0 * T + 64 + 34, (24, 12))
        # Al lado de la cama, la repisa de trofeos de quien duerme aquí (los dibuja el juego: ajedrez ganado).
        rx, ry = mx + 13 + 4 + 24, y0 * T + 64 + 34
        self.poner("repisa_trofeos", m_repisa_trofeos(), rx, ry, (44, 10))
        self.punto(f"trofeos_{lugar}", rx - 15, ry - 30, "abajo", columnas=4, paso=10, filas=2, alto_fila=22, sobre=ry + 1)
        self.estacion("", "trofeo", rx, ry - 56, ry + 1, (rx, ry + 16, "arriba", "parado"), tipo="trofeos")
        self.puesto(lugar, x0 * T + 50, y0 * T + 64 + 60, "abajo", "sentado")
        self.puesto(lugar, cx + 24, (y0 + 4) * T + 20, "abajo", "parado")
        alf = textura_alfombra(80, 56, rgb(color), oscurecer(rgb(color), 0.3))
        self.pegar_suelo(alf, int(cx), (y0 + 3) * T + 8)
        if x1 - x0 >= 6:
            self.poner("planta", m_planta(40), (x1 - 1) * T, (y1 - 1) * T + 8, (20, 10))
        self.poner("ventana", m_ventana(), int(cx + 40), y0 * T + 26, None, extra={"z": -50})

    # ── Techos y fachadas
    def techos_y_fachadas(self):
        for casa in CASAS:
            x0, y0, x1, y1 = casa.x0 * T, casa.y0 * T, casa.x1 * T, casa.y1 * T
            w = x1 - x0
            alto_fachada = 3 * T
            alero = 10
            im = lienzo(w + 2 * alero, (y1 - y0) + alero)
            ox, oy = alero, alero
            yf = (y1 - y0) - alto_fachada + oy       # donde empieza la fachada
            color = rgb(casa.color_techo)
            # Techo
            if casa.techo == "teja":
                rect(im, 0, 0, w + 2 * alero, yf + 6, oscurecer(color, 0.15))
                for k, y in enumerate(range(2, yf + 4, 10)):
                    for x in range((k % 2) * 8, w + 2 * alero, 16):
                        rect(im, x, y, x + 15, y + 9, color)
                        rect(im, x, y, x + 15, y + 2, aclarar(color, 0.25))
                        rect(im, x + 14, y, x + 15, y + 9, oscurecer(color, 0.3))
                    rect(im, 0, y + 9, w + 2 * alero, y + 10, oscurecer(color, 0.45))
                medio = (yf + 6) // 2
                rect(im, 0, medio - 5, w + 2 * alero, medio + 5, oscurecer(color, 0.25))
                rect(im, 0, medio - 5, w + 2 * alero, medio - 3, aclarar(color, 0.2))
            else:
                rect(im, 0, 0, w + 2 * alero, yf + 6, rgb("d7d9de"))
                ruido(im, 0, 0, w + 2 * alero, yf + 6, [rgb("cfd2d8"), rgb("e1e3e8")], 0.2, x0)
                rect(im, 0, 0, w + 2 * alero, 8, color)
                rect(im, 0, 0, 8, yf + 6, color); rect(im, w + 2 * alero - 8, 0, w + 2 * alero, yf + 6, color)
                rect(im, 0, yf - 2, w + 2 * alero, yf + 6, oscurecer(color, 0.15))
                if casa.id == "bunker":       # paneles solares
                    for k in range(4):
                        for j in range(2):
                            px, py = 40 + k * 120, 40 + j * 110
                            rect(im, px, py, px + 96, py + 70, rgb("24365c"))
                            for q in range(1, 4):
                                rect(im, px + q * 24, py, px + q * 24 + 1, py + 70, rgb("6f86b8"))
                            rect(im, px, py + 35, px + 96, py + 36, rgb("6f86b8"))
                            borde(im, px, py, px + 96, py + 70)
                # unidad de aire
                rect(im, w - 70, 30, w - 20, 66, GRIS[3]); borde(im, w - 70, 30, w - 20, 66)
                ImageDraw.Draw(im).ellipse([w - 60, 36, w - 32, 62], outline=GRIS[1])
            borde(im, 0, 0, w + 2 * alero, yf + 6)
            # Fachada: muro con ventanas, zócalo y la puerta
            pared = rgb(casa.pared)
            fx0, fx1 = ox, ox + w
            rect(im, fx0, yf + 6, fx1, oy + (y1 - y0), pared)
            ruido(im, fx0, yf + 6, fx1, oy + (y1 - y0), [oscurecer(pared, 0.04)], 0.1, y0)
            rect(im, fx0, oy + (y1 - y0) - 12, fx1, oy + (y1 - y0), oscurecer(pared, 0.35))
            borde(im, fx0, yf + 6, fx1, oy + (y1 - y0))
            puerta_cx = int((casa.puerta_x - casa.x0) * T) + ox
            for x in range(fx0 + 40, fx1 - 40, 112):
                if abs(x + 24 - puerta_cx) < 70:
                    continue
                v, _ = m_ventana(56, 40)
                im.alpha_composite(v, (x, yf + 26))
            # puerta
            pw = 2 * T
            py0 = oy + (y1 - y0) - 76
            if casa.techo == "toldo":
                rect(im, puerta_cx - pw // 2, py0, puerta_cx + pw // 2, py0 + 66, rgb("9fd3f0"))
                rect(im, puerta_cx - 1, py0, puerta_cx + 1, py0 + 66, GRIS[1])
            else:
                rect(im, puerta_cx - pw // 2, py0, puerta_cx + pw // 2, py0 + 66, MADERA[1])
                rect(im, puerta_cx - pw // 2 + 4, py0 + 4, puerta_cx + pw // 2 - 4, py0 + 62, MADERA[2])
                rect(im, puerta_cx + 18, py0 + 32, puerta_cx + 22, py0 + 36, rgb("ffd166"))
            borde(im, puerta_cx - pw // 2, py0, puerta_cx + pw // 2, py0 + 66)
            # letrero sobre la puerta (el texto lo pone el juego)
            rect(im, puerta_cx - 70, yf + 4, puerta_cx + 70, yf + 22, rgb("2b2d42")); borde(im, puerta_cx - 70, yf + 4, puerta_cx + 70, yf + 22)
            if casa.techo == "toldo":
                for k, x in enumerate(range(fx0, fx1, 16)):
                    rect(im, x, yf + 2, x + 16, yf + 20, rgb("ffffff") if k % 2 else color)
                ImageDraw.Draw(im).line([(fx0, yf + 20), (fx1, yf + 20)], fill=OUT)
            (SALIDA / "techos").mkdir(parents=True, exist_ok=True)
            im.save(SALIDA / "techos" / f"{casa.id}.png", optimize=True)
            self.techos[casa.id] = {
                "archivo": f"techos/{casa.id}.png", "x": x0 - alero, "y": y0 - alero, "w": im.width, "h": im.height,
                "letrero": {"x": x0 - alero + puerta_cx, "y": y0 - alero + yf + 13, "texto": casa.letrero},
                # La fachada tapa a quien está detrás: su borde de abajo es la y del orden de profundidad.
                "base_y": y1,
            }

    # ── Exportar
    def exportar(self):
        SALIDA.mkdir(parents=True, exist_ok=True)
        self.suelo.save(SALIDA / "suelo.png", optimize=True)
        hoja, frames = self.atlas.empacar()
        hoja.save(SALIDA / "muebles.png", optimize=True)
        (SALIDA / "muebles.json").write_text(json.dumps(frames, ensure_ascii=False), encoding="utf-8")
        # Sprites del juego que no son muebles fijos (van en otra hoja para cargarlos aparte)
        extras = Atlas()
        extras.agregar("moto", m_moto())
        extras.agregar("camion", m_camion())
        for canal, color in (("meli", "#ffe600"), ("web", "#3ba7ff"), ("whatsapp", "#25d366"), ("", None)):
            extras.agregar(f"caja_{canal or 'proveedor'}", m_caja_carton(16, 6, 10, color))
        for tipo, color in (("pregunta", "#ff9f1c"), ("solicitud", "#3ba7ff"), ("respuesta", "#2ecc71"), ("grupo", "#ffffff"),
                            ("idea", "#ffe14d"), ("chat", "#ff77a8")):
            extras.agregar(f"avion_{tipo}", m_avion(color))
        for k, c in enumerate(["#ff6f3c", "#2ecc71", "#3b7dd8", "#f1c40f", "#9b59b6", "#e74c3c"]):
            extras.agregar(f"frasco{k}", m_frasco(c))
        extras.agregar("bolsa", m_bolsa())
        extras.agregar("trofeo_oro", m_trofeo(("9a6a00", "e0a91b", "f6d55c", "fff6c2")))
        extras.agregar("trofeo_plata", m_trofeo(("6b7280", "a9b0c2", "d3d9e6", "ffffff")))
        extras.agregar("trofeo_tenis", m_trofeo(("1f6b3a", "3fae5b", "8fe08a", "e6ffd9")))
        # Lo que se compra para la casa propia (catálogo: app/data/empresa_viva_vecindario.json)
        for nombre, im_ancla in self.catalogo_casa().items():
            extras.agregar(f"casa_{nombre}", im_ancla)
        for n in (1, 3, 6, 10):
            extras.agregar(f"papeles{n}", m_papeles(n))
        for nombre, im in iconos().items():
            extras.agregar(f"ico_{nombre}", (im, (10, 20)))
        hugo, ancla = m_hugo()
        hugo.save(SALIDA / "hugo.png", optimize=True)
        hoja2, frames2 = extras.empacar()
        frames2["meta"]["image"] = "objetos.png"
        hoja2.save(SALIDA / "objetos.png", optimize=True)
        (SALIDA / "objetos.json").write_text(json.dumps(frames2, ensure_ascii=False), encoding="utf-8")

        lugares = {}
        for c in CUARTOS:
            if c.id.startswith("pasillo"):
                continue
            # El rótulo del cuarto: en la cara del muro norte (adentro) o a la entrada del patio (afuera).
            rotulo = {"x": int((c.x0 + c.x1) / 2 * T), "y": int(c.y0 * T + (14 if not c.afuera else 10))}
            lugares[c.id] = {"casa": c.casa, "titulo": c.titulo, "hace": c.hace, "panel": c.panel, "etapas": c.etapas,
                             "rect": [c.x0 * T, c.y0 * T, c.x1 * T, c.y1 * T], "afuera": c.afuera,
                             "puestos": self.puestos.get(c.id, []), "rotulo": rotulo}
        casas = {}
        for k in CASAS:
            casas[k.id] = {"titulo": k.titulo, "rect": [k.x0 * T, k.y0 * T, k.x1 * T, k.y1 * T],
                           "puerta": {"x": int(k.puerta_x * T), "y": k.y1 * T}, "techo": self.techos[k.id]}
        rejilla = ["".join(str(v) for v in fila) for fila in self.solido]
        mapa = {
            "_doc": "Generado por scripts/empresa_viva/armar_mapa.py: no editar a mano (se pisa).",
            "ancho": W, "alto": H, "baldosa": T, "celda": C,
            "calle": {"vuelta_y": CARRIL_VUELTA_Y, "ida_y": CARRIL_IDA_Y},
            "lugares": lugares, "casas": casas, "puntos": self.puntos, "pilas": self.pilas,
            "muebles": self.instancias, "estantes": self.estantes, "estaciones": self.estaciones, "solido": rejilla,
            "lotes": self.lotes,
            "hugo": {"archivo": "hugo.png", "cuadro": [48, 64], "ancla": [24, 60]},
        }
        (SALIDA / "mapa.json").write_text(json.dumps(mapa, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    def catalogo_casa(self) -> dict:
        """Los sprites de lo que cada quien compra para su casa: el id = el del catálogo del servidor."""
        arbusto = self.arbusto[0].resize((self.arbusto[0].width * 11 // 20, self.arbusto[0].height * 11 // 20), Image.NEAREST)
        arbolito = self.arbol_joven
        al = lambda im: (im, (im.width // 2, im.height - 4))
        c = {
            "flor_roja": m_flores("#e74c3c"), "flor_amarilla": m_flores("#f1c40f"), "flor_morada": m_flores("#9b59b6"),
            "flor_blanca": m_flores("#f4f1e8"), "maceta": m_planta(30, "#3f8f3a"), "arbusto": al(arbusto),
            "arbolito": al(arbolito), "cerca": m_reja(64), "banca": m_banca(), "farol": m_poste(), "fuente": m_fuente(),
            "buzon": m_buzon(), "casita_perro": m_casita_perro(),
            "mesa_jardin": m_mesa(56, 26, [rgb("8a8f9e"), rgb("c9ced8"), rgb("e8ebf0"), rgb("f4f6f8"), rgb("ffffff")]),
            "huerta": m_huerta(),
            "cama": m_cama("#4a7fbf"), "cama_doble": m_cama("#c0567a", doble=True), "sofa": m_sofa(64, "#4f6d8f"),
            "mesa": m_mesa(64, 30), "silla": m_silla_oficina("#8e5cc8"), "biblioteca": m_biblioteca(64), "nevera": m_nevera(),
            "cocina": m_meson(64, ("estufa",)), "escritorio": m_escritorio(64), "tv": m_tv_casa(self.tv),
            "mesa_noche": m_mesa_noche(), "arcade": m_arcade(), "repisa_trofeos": m_repisa_trofeos(),
            "alfombra_azul": (textura_alfombra(64, 64, rgb("3b7dd8"), rgb("1d4f8f")), (32, 63)),
            "alfombra_roja": (textura_alfombra(64, 64, rgb("c0392b"), rgb("7d2219")), (32, 63)),
            "lampara": m_lampara(), "planta_interior": m_planta(44, "#2f7d4a"), "pecera": m_pecera(),
        }
        return c

    def vista(self, ruta: Path, escala: float = 0.4, techos=False):
        """Imagen de control: el suelo + los muebles en su orden (y los techos, si se piden)."""
        im = self.suelo.copy()
        for inst in sorted(self.instancias, key=lambda i: (i.get("zbase", i["y"]) + i.get("z", 0) * 0.01)):
            spr, ancla = self.atlas.cuadros[inst["f"]]
            im.alpha_composite(spr, (int(inst["x"] - ancla[0]), int(inst["y"] - ancla[1])))
        if techos:
            for casa in CASAS:
                t = self.techos[casa.id]
                im.alpha_composite(Image.open(SALIDA / t["archivo"]).convert("RGBA"), (t["x"], t["y"]))
        im.convert("RGB").resize((int(W * escala), int(H * escala)), Image.LANCZOS).save(ruta)
        return im


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "empresa_viva_lpc"))
    ap.add_argument("--vista", help="guardar una imagen de control del barrio armado")
    ap.add_argument("--recorte", help="x0,y0,x1,y1 en px: guardar ese pedazo a tamaño real (con --vista)")
    args = ap.parse_args()
    b = Barrio(Fuentes(Path(args.cache)))
    b.afuera()
    b.vecindario()
    b.pisos_y_muros()
    b.amoblar()
    b.techos_y_fachadas()
    b.exportar()
    if args.vista:
        im = b.vista(Path(args.vista), 0.4, techos=False)
        b.vista(Path(args.vista).with_name(Path(args.vista).stem + "_techos.jpg"), 0.4, techos=True)
        if args.recorte:
            x0, y0, x1, y1 = (int(v) for v in args.recorte.split(","))
            im.crop((x0, y0, x1, y1)).convert("RGB").save(Path(args.vista).with_name(Path(args.vista).stem + "_recorte.png"))
    tam = {p.name: p.stat().st_size // 1024 for p in SALIDA.glob("*.png")}
    print("Listo:", tam)
    return 0


if __name__ == "__main__":
    sys.exit(main())
