#!/usr/bin/env python3
"""Arma la ROM en español de Super Bomberman 4 (SNES, Hudson 1996) con la traducción de Max1323 v1.1.

El parche (SB4_ES_1.1.ips, formato IPS) va sobre la ROM japonesa SIN cabecera de copiadora,
«Super Bomberman 4 (Japan).sfc», CRC32 3BBAEB19 (lo dice el léame del parche: MD5
DF33E261104EFEE409DE8F294D80AD6E). Si trae la cabecera SMC de 512 bytes se le quita antes. Con otra
ROM el parche sale dañado, así que se verifica el CRC32 antes de escribir nada.

El 8-oct-2026 el usuario trajo a Descargas solo el parche («Super Bomberman 4 (S).zip»); falta la ROM.

Uso:  python3 aplicar_parche.py   (lee ~/Descargas/Super Bomberman 4 (Japan).zip o .sfc)  →  ../rom/bomberman4_es.sfc
      python3 aplicar_parche.py "~/Descargas/otra ruta.sfc"   (también .zip con un solo .sfc)
"""
import hashlib
import sys
import zipfile
import zlib
from pathlib import Path

AQUI = Path(__file__).resolve().parent
PARCHE = AQUI / "SB4_ES_1.1.ips"
SALIDA = AQUI.parent / "rom" / "bomberman4_es.sfc"
CRC_ORIGINAL = 0x3BBAEB19         # Super Bomberman 4 (Japan), sin cabecera


def leer_rom(ruta: Path) -> bytes:
    """La ROM original, desde el .sfc o directo del .zip de Descargas (TorrentZip con un .sfc)."""
    if ruta.suffix.lower() == ".zip":
        with zipfile.ZipFile(ruta) as z:
            nombres = [n for n in z.namelist() if n.lower().endswith((".sfc", ".smc"))]
            if len(nombres) != 1:
                raise SystemExit(f"El zip debe traer un solo .sfc/.smc (trae {nombres})")
            datos = z.read(nombres[0])
    else:
        datos = ruta.read_bytes()
    if len(datos) % 0x8000 == 512:
        datos = datos[512:]       # cabecera SMC de copiadora: fuera
    return datos


def aplicar_ips(rom: bytes, ips: bytes) -> bytes:
    if ips[:5] != b"PATCH":
        raise SystemExit(f"{PARCHE.name} no es un parche IPS (falta «PATCH»)")
    out = bytearray(rom)
    i = 5
    while True:
        if ips[i:i + 3] == b"EOF":
            i += 3
            break
        if i + 5 > len(ips):
            raise SystemExit("Parche IPS cortado: no llegó al «EOF»")
        desde = int.from_bytes(ips[i:i + 3], "big")
        largo = int.from_bytes(ips[i + 3:i + 5], "big")
        i += 5
        if largo == 0:            # registro RLE: un byte repetido
            veces = int.from_bytes(ips[i:i + 2], "big")
            datos = ips[i + 2:i + 3] * veces
            i += 3
        else:
            datos = ips[i:i + largo]
            i += largo
        if desde + len(datos) > len(out):
            out.extend(b"\x00" * (desde + len(datos) - len(out)))
        out[desde:desde + len(datos)] = datos
    if len(ips) - i == 3:         # extensión de truncado: tamaño final del archivo
        del out[int.from_bytes(ips[i:i + 3], "big"):]
    return bytes(out)


def main() -> None:
    if len(sys.argv) > 1:
        origen = Path(sys.argv[1]).expanduser()
    else:
        base = Path.home() / "Descargas"
        candidatos = [base / "Super Bomberman 4 (Japan).zip", base / "Super Bomberman 4 (Japan).sfc"]
        origen = next((c for c in candidatos if c.exists()), candidatos[0])
    if not origen.exists():
        raise SystemExit(f"No está la ROM original: {origen}")
    rom = leer_rom(origen)
    crc = zlib.crc32(rom)
    if crc != CRC_ORIGINAL:
        raise SystemExit(f"ROM equivocada: {len(rom)} bytes, CRC32 {crc:08X} (se espera {CRC_ORIGINAL:08X}, «Super Bomberman 4 (Japan)»)")
    es = aplicar_ips(rom, PARCHE.read_bytes())
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_bytes(es)
    print(f"{SALIDA.name}: {len(es)} bytes · CRC32 {zlib.crc32(es):08X} · SHA-256 {hashlib.sha256(es).hexdigest()}")


if __name__ == "__main__":
    main()
