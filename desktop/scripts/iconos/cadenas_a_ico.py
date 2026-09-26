"""Cadenas que empiezan por emoji DENTRO de una expresión hija de JSX: "🎫 Texto" → ico("🎫 Texto").
Solo en `{…}` de una línea que no es valor de atributo (no va tras `=`), fuera de templates y de
lo que dibuja etiquetas. tsc atrapa cualquier sitio donde se esperaba un string."""
import re, sys
from pathlib import Path
APLICAR = "--aplicar" in sys.argv
MAPEADOS = set(re.findall(r'^\s*"([^"]+)":\s*"', Path("icons/emojiMap.ts").read_text(encoding="utf-8"), flags=re.M))
FUERA = ("icons/", "etiqueta-", "VisualCanvasEditor", "GHSIconsPicker", "EtiquetaMckennaPreview", "EtiquetaDiagramEditor")
EMO = "(?:[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF]|[☀-➿⬀-⯿]️)️?"
CAD = re.compile(r'(?<![=\w])"(' + EMO + r')([^"\n]*)"')
total = 0; por = {}; sinperm = []
for f in sorted(Path(".").rglob("*.tsx")):
    if any(x in str(f) for x in FUERA): continue
    lineas = f.read_text(encoding="utf-8").split("\n"); n = 0; ticks = 0
    for i, l in enumerate(lineas):
        dentro_tpl = ticks % 2 == 1
        ticks += len(re.findall(r"(?<!\\)`", l))
        if dentro_tpl or "`" in l: continue
        s = l.strip()
        # una expresión hija completa en su línea:  {cond ? "🔄 x" : "y"}   (no `attr={…}`)
        m = re.match(r"^\{(?!/\*)(.*)\}$", s)
        if not m or re.search(r"=\s*\{", l.split("{", 1)[0] + "{") : continue
        if i and re.search(r"=\s*$", lineas[i - 1].rstrip()): continue
        cuerpo = m.group(1)
        if "=>" in cuerpo or ".map(" in cuerpo or "ico(" in cuerpo: continue
        def r(mm):
            global n
            if mm.group(1) not in MAPEADOS and mm.group(1).replace("️", "") not in MAPEADOS: return mm.group(0)
            n += 1; return "ico(" + mm.group(0) + ")"
        nuevo = CAD.sub(r, l)
        if nuevo != l and APLICAR: lineas[i] = nuevo
        elif nuevo != l and not APLICAR and total + n <= 12: print("  ", f.name[:26].ljust(26), s[:110])
    if n:
        total += n; por[str(f)] = n
        if APLICAR:
            t = "\n".join(lineas)
            if not re.search(r'import \{ ico \} from', t):
                rel = "../" * (len(f.parts) - 1) + "icons/icoTexto"
                pos = re.search(r"^import ", t, flags=re.M).start()
                t = t[:pos] + f'import {{ ico }} from "{rel}";\n' + t[pos:]
            try: f.write_text(t, encoding="utf-8")
            except PermissionError: sinperm.append(str(f))
print("cadenas:", total, "en", len(por), "archivos", "(APLICADO)" if APLICAR else "(en seco)", "| sin permiso:", sinperm)
