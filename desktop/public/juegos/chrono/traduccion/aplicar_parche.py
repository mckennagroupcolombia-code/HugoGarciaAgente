#!/usr/bin/env python3
"""Arma la ROM en español de Chrono Trigger (SNES) aplicando el parche de Rod Mérida (v1.07).

El parche (CRONO_SP.IPS, formato IPS) va sobre la ROM norteamericana SIN cabecera de copiadora:
4.194.304 bytes, CRC32 2D206BF7 (la de No-Intro, «Chrono Trigger (USA).sfc»). Si la ROM trae la
cabecera SMC de 512 bytes (4.194.816 bytes) se le quita antes. Con cualquier otra ROM el parche
sale «churro» (lo advierte el propio autor), así que se verifica antes de escribir nada.

Formato IPS: "PATCH", luego registros [desplazamiento 3 bytes][largo 2 bytes][datos]; largo 0 =
registro RLE [repeticiones 2 bytes][byte]; termina en "EOF", opcionalmente seguido de 3 bytes con
el tamaño final (extensión de truncado de Lunar IPS).

Uso:  python3 aplicar_parche.py   (lee ~/Descargas/Chrono Trigger (USA).zip)  →  ../rom/chrono_es.sfc
      python3 aplicar_parche.py "~/Descargas/Chrono Trigger (USA).sfc"   (ROM original; también .zip)
"""
import hashlib
import sys
import zipfile
import zlib
from pathlib import Path

AQUI = Path(__file__).resolve().parent
PARCHE = AQUI / "CRONO_SP.IPS"
SALIDA = AQUI.parent / "rom" / "chrono_es.sfc"
TAMANO = 4 * 1024 * 1024          # 32 Mbit, HiROM
CRC_ORIGINAL = 0x2D206BF7         # Chrono Trigger (USA), sin cabecera


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
    if len(datos) == TAMANO + 512:
        datos = datos[512:]       # cabecera SMC de copiadora: fuera
    return datos


def aplicar_ips(rom: bytes, ips: bytes) -> bytes:
    if ips[:5] != b"PATCH":
        raise SystemExit("CRONO_SP.IPS no es un parche IPS (falta «PATCH»)")
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
    origen = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.home() / "Descargas" / "Chrono Trigger (USA).zip"
    rom = leer_rom(origen)
    crc = zlib.crc32(rom)
    if len(rom) != TAMANO or crc != CRC_ORIGINAL:
        raise SystemExit(f"ROM equivocada: {len(rom)} bytes, CRC32 {crc:08X} (se espera {TAMANO} bytes y {CRC_ORIGINAL:08X})")
    es = aplicar_ips(rom, PARCHE.read_bytes())
    if len(es) != TAMANO:
        raise SystemExit(f"La ROM parcheada quedó de {len(es)} bytes (el parche no la expande: deberían ser {TAMANO})")
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_bytes(es)
    print(f"{SALIDA.name}: {len(es)} bytes · CRC32 {zlib.crc32(es):08X} · SHA-256 {hashlib.sha256(es).hexdigest()}")


if __name__ == "__main__":
    main()
