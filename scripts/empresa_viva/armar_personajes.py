#!/usr/bin/env python3
"""Arma las capas de los personajes de «Empresa viva» (pixel art LPC) — se corre a mano, una vez.

Los personajes del juego se componen EN EL NAVEGADOR (desktop/src/components/empresa/personajes.ts)
apilando capas del Universal LPC Spritesheet Character Generator (cuerpo, cabeza, pelo, barba,
camisa, pantalón, zapatos, gafas, delantal) y recoloreando cada una con las paletas del generador
(piel, pelo, tela, ojos). Así cada quien arma su avatar sin que haya que guardar una imagen por
combinación.

Este script baja del repositorio del generador SOLO las piezas del catálogo de abajo, y por cada
pieza y tipo de cuerpo empaca sus animaciones en una tira de 64×64 por cuadro:

    columnas  0-8   caminar (walk)      9-10  quieto (idle)     11-13 sentado (sit)
             14-16  gesto (emote)      17-24  correr (run)
    filas     0 arriba · 1 izquierda · 2 abajo · 3 derecha

Escribe en desktop/public/empresa/pixel/personajes/:
  <pieza>/<variante>_<cuerpo>.png  (las tiras)
  personajes.json                  (catálogo: piezas, capas con su zPos, paletas, animaciones)
  CREDITOS.md                      (autores y licencias de cada pieza: CC-BY-SA 3.0 / OGA-BY / GPL 3.0)

Uso:  python3 scripts/empresa_viva/armar_personajes.py [--cache DIR]
Necesita red (raw.githubusercontent.com). Las descargas quedan en ~/.cache/empresa_viva_lpc.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SALIDA = REPO / "desktop" / "public" / "empresa" / "pixel" / "personajes"
RAW = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master"
CUADRO = 64
ANIMACIONES = [("walk", 0, 9), ("idle", 9, 2), ("sit", 11, 3), ("emote", 14, 3), ("run", 17, 8)]
COLUMNAS = 25
CUERPOS = {"hombre": "male", "mujer": "female"}

# Catálogo: (id, etiqueta en español, archivo de definición del generador). El id es lo que se
# guarda en preferencias_ui.empresa.pixel (tickets_db._limpiar_avatar_empresa lo valida contra
# personajes.json). Se eligieron piezas de ciudad de hoy: nada de armaduras ni capas.
CATALOGO: dict[str, list[tuple[str, str, str]]] = {
    "cuerpo": [("hombre", "Hombre", "body/body.json"), ("mujer", "Mujer", "body/body.json")],
    "cabeza": [("hombre", "Hombre", "head/heads/human/heads_human_male.json"),
               ("mujer", "Mujer", "head/heads/human/heads_human_female.json")],
    "pelo": [
        ("", "Sin pelo", ""),
        ("corto", "Corto", "hair/short/hair_plain.json"),
        ("despeinado", "Despeinado", "hair/short/hair_bedhead.json"),
        ("raya", "Con raya", "hair/short/hair_parted.json"),
        ("flequillo", "Flequillo", "hair/short/hair_bangs.json"),
        ("pixie", "Pixie", "hair/short/hair_pixie.json"),
        ("ondas_cortas", "Ondas cortas", "hair/short/hair_swoop.json"),
        ("puntas", "En puntas", "hair/spiky/hair_spiked.json"),
        ("crespo", "Crespo corto", "hair/curly/hair_curly_short.json"),
        ("afro", "Afro", "hair/afro/hair_afro.json"),
        ("bob", "Bob", "hair/bob/hair_bob.json"),
        ("melena", "Melena", "hair/bob/hair_lob.json"),
        ("largo", "Largo", "hair/long/hair_long.json"),
        ("largo_liso", "Largo liso", "hair/long/hair_long_straight.json"),
        ("ondulado", "Ondulado", "hair/long/hair_wavy.json"),
        ("crespo_largo", "Crespo largo", "hair/curly/hair_curly_long.json"),
        ("cola", "Cola de caballo", "hair/braids/hair_ponytail.json"),
        ("mono", "Moño", "hair/braids/hair_bangs_bun.json"),
        ("trenza", "Trenza", "hair/braids/hair_braid.json"),
    ],
    "barba": [
        ("", "Sin barba", ""),
        ("sombra", "Sombra de barba", "hair/beards/beards_5oclock_shadow.json"),
        ("candado", "Barba corta", "hair/beards/beards_trimmed.json"),
        ("barba", "Barba", "hair/beards/beards_beard.json"),
        ("poblada", "Barba poblada", "hair/beards/beards_medium.json"),
    ],
    "torso": [
        ("camiseta", "Camiseta", "torso/shirts/shortsleeve/torso_clothes_tshirt.json"),
        ("camiseta_v", "Camiseta cuello V", "torso/shirts/shortsleeve/torso_clothes_tshirt_vneck.json"),
        ("polo", "Polo", "torso/shirts/shortsleeve/torso_clothes_shortsleeve_polo.json"),
        ("polo_manga", "Polo manga larga", "torso/shirts/longsleeve/torso_clothes_longsleeve2_polo.json"),
        ("camisa", "Camisa", "torso/shirts/longsleeve/torso_clothes_longsleeve2_buttoned.json"),
        ("buzo", "Buzo", "torso/shirts/longsleeve/torso_clothes_longsleeve.json"),
        ("cardigan", "Cárdigan", "torso/shirts/longsleeve/torso_clothes_longsleeve2_cardigan.json"),
        ("esqueleto", "Esqueleto", "torso/shirts/sleeveless/torso_clothes_sleeveless2.json"),
    ],
    # Blusa, chaqueta, chaleco y delantal del generador solo traen «caminar» (sin quieto, sentado
    # ni correr): al sentarse desaparecerían. El overol sí trae todas.
    "delantal": [
        ("", "Sin overol", ""),
        ("overol", "Overol", "torso/aprons/torso_aprons_overalls.json"),
    ],
    "piernas": [
        ("pantalon", "Pantalón", "legs/pants/legs_pants.json"),
        ("jean", "Jean", "legs/pants/legs_pants2.json"),
        ("formal", "Pantalón formal", "legs/pants/legs_formal.json"),
        ("bermuda", "Bermuda", "legs/shorts/legs_shorts.json"),
        ("leggins", "Leggins", "legs/leggings/legs_leggings.json"),
        ("falda", "Falda", "legs/skirts/legs_skirts_plain.json"),
    ],
    "zapatos": [
        ("zapatos", "Zapatos", "feet/shoes/feet_shoes_basic.json"),
        ("tenis", "Tenis", "feet/shoes/feet_shoes_revised.json"),
    ],
    "gafas": [
        ("", "Sin gafas", ""),
        ("gafas", "Gafas", "headwear/accessories/glasses/facial_glasses.json"),
        ("redondas", "Gafas redondas", "headwear/accessories/glasses/facial_glasses_round.json"),
        ("sol", "Gafas de sol", "headwear/accessories/glasses/facial_glasses_sunglasses.json"),
    ],
}

# Material de la paleta con que se recolorea cada pieza (el del generador) cuando la definición
# no trae «recolors» (las piezas con «variants» vienen ya pintadas: se usa una variante fija).
VARIANTE_FIJA = {"gafas": {"gafas": "black", "redondas": "brown", "sol": "black"}}


def bajar(url: str, cache: Path) -> bytes | None:
    destino = cache / url.replace(RAW + "/", "").replace("/", "__")
    if destino.exists():
        return destino.read_bytes() or None
    for intento in range(3):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                datos = r.read()
            destino.write_bytes(datos)
            return datos
        except urllib.error.HTTPError as e:
            if e.code == 404:
                destino.write_bytes(b"")
                return None
            time.sleep(1 + intento)
        except Exception:
            time.sleep(1 + intento)
    raise RuntimeError(f"no se pudo bajar {url}")


def capas_de(defin: dict) -> list[dict]:
    """layer_1, layer_2…: cada capa con su zPos y su carpeta por tipo de cuerpo."""
    out = []
    for k in sorted(k for k in defin if k.startswith("layer_")):
        out.append(defin[k])
    return out


def material_de(defin: dict) -> dict:
    """{'color_1': 'body', 'color_2': 'eye'} o {'color_1': 'hair'}…; vacío si no se recolorea."""
    rc = defin.get("recolors")
    if not rc:
        return {}
    if "material" in rc:
        return {"color_1": rc["material"]}
    return {k: v.get("material") for k, v in rc.items() if isinstance(v, dict) and v.get("material")}


def tira(carpeta: str, variante: str | None, cache: Path) -> tuple[Image.Image, list[str]]:
    """Las animaciones de una carpeta del generador, empacadas en la tira de 25 columnas."""
    img = Image.new("RGBA", (COLUMNAS * CUADRO, 4 * CUADRO), (0, 0, 0, 0))
    hay = []
    for anim, col, n in ANIMACIONES:
        rutas = [f"{carpeta}{anim}.png"]
        if variante:
            rutas = [f"{carpeta}{anim}/{variante}.png", f"{carpeta}{variante}/{anim}.png"]
        datos = None
        for r in rutas:
            datos = bajar(f"{RAW}/spritesheets/{r}", cache)
            if datos:
                break
        if not datos:
            continue
        im = Image.open(io.BytesIO(datos)).convert("RGBA")
        cuadros = min(n, im.width // CUADRO)
        filas = min(4, im.height // CUADRO)
        # Algunas animaciones de una sola fila (p. ej. «hurt») no sirven: se necesitan 4 direcciones.
        if filas < 4:
            continue
        img.paste(im.crop((0, 0, cuadros * CUADRO, 4 * CUADRO)), (col * CUADRO, 0))
        hay.append(anim)
    return img, hay


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=str(Path.home() / ".cache" / "empresa_viva_lpc"))
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    SALIDA.mkdir(parents=True, exist_ok=True)

    paletas = {}
    for material, archivo in (("body", "body/body_ulpc.json"), ("hair", "hair/hair_ulpc.json"),
                              ("cloth", "cloth/cloth_ulpc.json"), ("eye", "eye/eye_ulpc.json")):
        paletas[material] = json.loads(bajar(f"{RAW}/palette_definitions/{archivo}", cache))
    bases = {"body": "light", "hair": "orange", "cloth": "white", "eye": "blue"}

    catalogo: dict[str, list[dict]] = {}
    creditos: dict[str, dict] = {}
    for pieza, opciones in CATALOGO.items():
        catalogo[pieza] = []
        for vid, etiqueta, archivo in opciones:
            if not archivo:
                catalogo[pieza].append({"id": vid, "nombre": etiqueta, "capas": []})
                continue
            defin = json.loads(bajar(f"{RAW}/sheet_definitions/{archivo}", cache))
            variante = VARIANTE_FIJA.get(pieza, {}).get(vid)
            capas_json = []
            cuerpos = [vid] if pieza in ("cuerpo", "cabeza") else list(CUERPOS)
            for i, capa in enumerate(capas_de(defin)):
                archivos = {}
                for cuerpo in cuerpos:
                    carpeta = capa.get(CUERPOS[cuerpo])
                    if not carpeta:
                        continue
                    img, hay = tira(carpeta, variante, cache)
                    if "walk" not in hay:
                        print(f"  ⚠ {pieza}/{vid} ({cuerpo}) sin caminar: se omite", file=sys.stderr)
                        continue
                    nombre = f"{pieza}/{vid}{'_' + str(i + 1) if i else ''}_{cuerpo}.png"
                    (SALIDA / pieza).mkdir(exist_ok=True)
                    img.save(SALIDA / nombre, optimize=True)
                    archivos[cuerpo] = {"archivo": nombre, "anims": hay}
                if archivos:
                    capas_json.append({"z": int(capa.get("zPos", 50)), "archivos": archivos})
            if not capas_json:
                print(f"  ⚠ {pieza}/{vid}: sin capas útiles", file=sys.stderr)
                continue
            catalogo[pieza].append({"id": vid, "nombre": etiqueta, "capas": capas_json,
                                    "material": material_de(defin) if not variante else {}})
            for c in defin.get("credits") or []:
                clave = c.get("file", archivo)
                creditos.setdefault(clave, {"autores": c.get("authors", []), "licencias": c.get("licenses", []),
                                            "urls": c.get("urls", []), "notas": c.get("notes", "")})
            print(f"✓ {pieza}/{vid}: {len(capas_json)} capa(s)")

    manifiesto = {
        "_doc": "Generado por scripts/empresa_viva/armar_personajes.py. Tiras de 64x64: columnas walk 0-8, idle 9-10, "
                "sit 11-13, emote 14-16, run 17-24; filas arriba, izquierda, abajo, derecha. Paletas del generador "
                "LPC (base = la que traen pintada las capas).",
        "cuadro": CUADRO, "columnas": COLUMNAS,
        "animaciones": {a: {"col": c, "n": n} for a, c, n in ANIMACIONES},
        "paletas": paletas, "bases": bases, "piezas": catalogo,
    }
    (SALIDA / "personajes.json").write_text(json.dumps(manifiesto, ensure_ascii=False, indent=1), encoding="utf-8")

    lineas = ["# Créditos de los personajes (LPC)", "",
              "Capas del [Universal LPC Spritesheet Character Generator]"
              "(https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator), "
              "arte del Liberated Pixel Cup y sus continuadores. Licencias: CC-BY-SA 3.0, OGA-BY 3.0 y/o GPL 3.0 "
              "según cada pieza (abajo). Uso interno en /app → Empresa viva; si alguna vez se publicara, "
              "estas atribuciones tienen que ir con el juego.", ""]
    for clave in sorted(creditos):
        c = creditos[clave]
        lineas.append(f"- **{clave}** — {', '.join(c['autores'])}. Licencias: {', '.join(c['licencias'])}.")
        for u in c["urls"]:
            lineas.append(f"  - {u}")
    (SALIDA / "CREDITOS.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in SALIDA.rglob("*.png"))
    print(f"Listo: {sum(1 for _ in SALIDA.rglob('*.png'))} tiras, {total / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
