#!/usr/bin/env python3
"""Aplica la traducción al español sobre la ROM original de Chessmaster (GBA).

Los textos van en ASCII terminado en 00 (los rótulos de menú con 2 bytes de etiqueta delante) y el
juego los localiza por posición dentro de recursos serializados, así que cada texto se escribe EN EL
MISMO SITIO. Cabe en el espacio del original más los bytes 00 de relleno que le siguen (alineación a 4):
lo que sobre se rellena con espacios. Sin acentos ni Ñ (no se ha verificado la fuente).

es.txt: una línea por texto → OFFSET|texto original|traducción. Se comprueba que el original esté
donde se dice antes de escribir nada.

Uso:  python3 traducir_rom.py aplicar   → rom/chessmaster_es.gba
"""
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ORIGINAL = AQUI.parent / "rom" / "chessmaster.gba"
SALIDA = AQUI.parent / "rom" / "chessmaster_es.gba"

def espacio_disponible(d: bytes, off: int, largo: int) -> int:
    """Bytes utilizables: el texto original + los 00 de relleno que lo siguen (menos el terminador)."""
    fin = off + largo
    assert d[fin] == 0, "el original no termina en 00 en %06X" % off
    j = fin + 1
    while j < len(d) and d[j] == 0 and (j - fin) < 4:
        j += 1
    return j - 1 - off      # posiciones para caracteres, dejando un 00 al final

def aplicar(d: bytearray, lineas):
    hechos, problemas = 0, []
    for n, linea in enumerate(lineas, 1):
        if not linea.strip() or linea.startswith("#"): continue
        try:
            off_s, en, es = linea.rstrip("\n").split("|", 2)
        except ValueError:
            problemas.append("línea %d: formato" % n); continue
        off = int(off_s, 16)
        if d[off:off + len(en)] != en.encode("ascii") or d[off + len(en)] != 0:
            problemas.append("%s: el original no coincide: %r" % (off_s, bytes(d[off:off + len(en) + 1]))); continue
        try:
            b = es.encode("ascii")
        except UnicodeEncodeError:
            problemas.append("%s: fuera de ASCII: %r" % (off_s, es)); continue
        disp = espacio_disponible(bytes(d), off, len(en))
        if len(b) > disp:
            problemas.append("%s: %d caracteres > %d disponibles: %r" % (off_s, len(b), disp, es)); continue
        # centrados/anchos fijos: si el original tenía exactamente ese largo sin relleno, se conserva el largo
        relleno = b" " * (len(en) - len(b)) if len(b) < len(en) else b""
        b = b + relleno
        d[off:off + len(b)] = b
        for k in range(off + len(b), off + disp + 1): d[k] = 0
        hechos += 1
    return hechos, problemas

if __name__ == "__main__":
    d = bytearray(ORIGINAL.read_bytes())
    lineas = (AQUI / "es.txt").read_text(encoding="utf-8").splitlines()
    hechos, problemas = aplicar(d, lineas)
    for p in problemas: print("PROBLEMA", p)
    SALIDA.write_bytes(bytes(d))
    print("aplicados:", hechos, "· problemas:", len(problemas), "·", SALIDA.name)
    sys.exit(1 if problemas else 0)
