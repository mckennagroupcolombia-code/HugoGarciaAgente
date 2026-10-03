#!/usr/bin/env python3
"""Aplica la traducción al español sobre la ROM original de Bassin's Black Bass (SNES).

Los textos van en ASCII plano; el juego los localiza con tablas de punteros de 16 bits, así que
cada mensaje traducido se escribe EN EL MISMO SITIO y con el MISMO largo en bytes que el original
(lo que sobre se rellena con espacios, invisibles en la caja). Códigos: FC 00 = salto de línea,
FC 01 = fin de página, FE xx xx xx = variable (se conserva tal cual), 00 = fin del mensaje.

Uso:  python3 traducir_rom.py extraer   → mensajes.json con todos los mensajes (en) y "es" vacío
      python3 traducir_rom.py aplicar   → rom/bassin_es.sfc con los "es" que existan (verifica el largo)
"""
import json, re, sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ORIGINAL = AQUI.parent / "rom" / "bassin.sfc"
SALIDA = AQUI.parent / "rom" / "bassin_es.sfc"
JSON = AQUI / "mensajes.json"
ANCHO = 19                     # caracteres por línea que caben en la caja (medido en el emulador: 3 líneas de ~19)

def decodificar(b: bytes) -> str:
    out, i = [], 0
    while i < len(b):
        c = b[i]
        if c == 0xFC and i + 1 < len(b):
            out.append({0: "\n", 1: "\n¶\n"}.get(b[i + 1], "<FC%02X>" % b[i + 1])); i += 2; continue
        if c == 0xFE and i + 3 < len(b):
            out.append("<VAR %s>" % b[i + 1:i + 4].hex()); i += 4; continue
        out.append(chr(c) if 32 <= c < 127 else "<%02X>" % c); i += 1
    return "".join(out)

def codificar(t: str) -> bytes:
    out, i = bytearray(), 0
    while i < len(t):
        if t.startswith("\n¶\n", i): out += b"\xfc\x01"; i += 3; continue
        if t.startswith("\n¶", i) and i + 2 == len(t): out += b"\xfc\x01"; i += 2; continue
        if t[i] == "\n": out += b"\xfc\x00"; i += 1; continue
        m = re.match(r"<VAR ([0-9a-f]{6})>", t[i:])
        if m: out += b"\xfe" + bytes.fromhex(m.group(1)); i += m.end(); continue
        m = re.match(r"<([0-9A-F]{2})>", t[i:])
        if m: out += bytes([int(m.group(1), 16)]); i += m.end(); continue
        m = re.match(r"<FC([0-9A-F]{2})>", t[i:])
        if m: out += b"\xfc" + bytes([int(m.group(1), 16)]); i += m.end(); continue
        c = ord(t[i])
        if not 32 <= c < 127: raise ValueError("carácter fuera de ASCII: %r" % t[i])
        out.append(c); i += 1
    return bytes(out)

def es_texto(b: bytes) -> bool:
    letras = sum(1 for c in b if 65 <= c <= 90)
    ok = sum(1 for c in b if 32 <= c < 127 or c in (0xFC, 0xFE, 0x00, 0x01, 0x09))
    return len(b) >= 4 and letras >= 3 and ok / len(b) > 0.9

def extraer(d: bytes):
    """Mensajes = tramos de texto hasta un 00 terminador (no el 00 de un salto FC 00 ni el de una
    variable FE xx xx xx) dentro de las zonas de texto de los bancos 31/35/3C."""
    mensajes = []
    for ini, fin in ((0x188000, 0x190000), (0x1A8000, 0x1B0000), (0x1E0000, 0x1E8000)):
        i = ini
        while i < fin:
            j = i
            while j < fin:
                c = d[j]
                if c == 0xFC: j += 2; continue
                if c == 0xFE: j += 4; continue
                if c == 0x00: break
                j += 1
            cuerpo = d[i:j]
            if cuerpo[:1] == b"\xfb": cuerpo = cuerpo[2:]; i += 2          # FB id: cabecera del hablante
            if es_texto(cuerpo): mensajes.append({"off": "%06X" % i, "bytes": len(cuerpo), "en": decodificar(cuerpo), "es": ""})
            i = j + 1
    return mensajes

def aplicar(d: bytearray, mensajes):
    problemas, hechos = [], 0
    for m in mensajes:
        es = m.get("es") or ""
        if not es.strip(): continue
        off, largo = int(m["off"], 16), m["bytes"]
        try: b = codificar(es)
        except ValueError as e: problemas.append("%s: %s" % (m["off"], e)); continue
        # ancho por mensaje: la caja normal admite 19; las tablas y cabeceras del original ya son más anchas
        ancho = max(ANCHO, max((len(re.sub(r"<[^>]+>", "", l)) for l in m["en"].replace("\n¶\n", "\n").split("\n")), default=0))
        for linea in es.replace("\n¶\n", "\n").split("\n"):
            if len(re.sub(r"<[^>]+>", "", linea)) > ancho: problemas.append("%s: línea de %d > %d: %r" % (m["off"], len(linea), ancho, linea))
        if len(b) > largo: problemas.append("%s: %d bytes > %d disponibles" % (m["off"], len(b), largo)); continue
        # relleno con espacios antes del final de página (o al final si no lo hay)
        relleno = b" " * (largo - len(b))
        k = b.rfind(b"\xfc\x01")
        b = (b[:k] + relleno + b[k:]) if k >= 0 else b + relleno
        assert len(b) == largo and d[off + largo] == 0
        d[off:off + largo] = b; hechos += 1
    return hechos, problemas

def checksum(d: bytearray):
    """Suma de comprobación de la cabecera LoROM (por si el juego o el emulador la miran)."""
    d[0x7FDC:0x7FE0] = b"\xff\xff\x00\x00"
    s = sum(d) & 0xFFFF
    d[0x7FDE:0x7FE0] = s.to_bytes(2, "little"); d[0x7FDC:0x7FDE] = (s ^ 0xFFFF).to_bytes(2, "little")

if __name__ == "__main__":
    d = bytearray(ORIGINAL.read_bytes())
    if sys.argv[1:2] == ["extraer"]:
        ms = extraer(bytes(d))
        if JSON.exists():   # conservar traducciones ya hechas
            viejas = {m["off"]: m.get("es", "") for m in json.loads(JSON.read_text(encoding="utf-8"))}
            for m in ms: m["es"] = viejas.get(m["off"], "")
        JSON.write_text(json.dumps(ms, ensure_ascii=False, indent=1), encoding="utf-8")
        print("mensajes:", len(ms), "caracteres:", sum(len(m["en"]) for m in ms))
    elif sys.argv[1:2] == ["aplicar"]:
        ms = json.loads(JSON.read_text(encoding="utf-8"))
        hechos, problemas = aplicar(d, ms)
        for p in problemas: print("PROBLEMA", p)
        checksum(d)
        SALIDA.write_bytes(bytes(d))
        print("aplicados:", hechos, "de", sum(1 for m in ms if m.get("es")), "· problemas:", len(problemas), "·", SALIDA.name)
        sys.exit(1 if problemas else 0)
    else:
        print(__doc__)
