"""Emoji pictográfico → <Ico e="…" />, SOLO cuando es texto JSX inequívoco:
  a) en su línea, lo que hay antes del emoji termina en el cierre de una etiqueta (<x …>, </x>, />), o
  b) el emoji abre la línea y la línea anterior no vacía termina en '>' (no '=>') o en '}' de una expresión JSX,
y nunca dentro de un template literal (paridad de backticks), ni en <option>/<title>/<text>, ni en
lo que dibuja etiquetas imprimibles. Un emoji sin icono asignado se deja como está."""
import re, sys, collections
from pathlib import Path
APLICAR = "--aplicar" in sys.argv
PICTO = re.compile("(?:[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF]|[☀-➿⬀-⯿]️)️?(?:‍[\U0001F300-\U0001FAFF]️?)*")
MAPEADOS = set(re.findall(r'^\s*"([^"]+)":\s*"', Path("icons/emojiMap.ts").read_text(encoding="utf-8"), flags=re.M))
FUERA = ("icons/", "etiqueta-", "VisualCanvasEditor", "GHSIconsPicker", "EtiquetaMckennaPreview", "EtiquetaDiagramEditor")
CIERRE = re.compile(r"(<[A-Za-z][^<>]*>|</[A-Za-z.]*>|/>)\s*$")
total = 0; por = {}; faltan = collections.Counter(); muestra = []; sinperm = []
for f in sorted(Path(".").rglob("*.tsx")):
    if any(x in str(f) for x in FUERA): continue
    t = f.read_text(encoding="utf-8")
    cambios = []
    for m in PICTO.finditer(t):
        a, b = m.span(); e = m.group(0)
        ini = t.rfind("\n", 0, a) + 1; fin = t.find("\n", b); fin = len(t) if fin < 0 else fin
        antes, linea = t[ini:a], t[ini:fin]
        if len(re.findall(r"(?<!\\)`", t[:a])) % 2: continue            # dentro de un template literal
        if antes.strip() == "":
            prev = t[:ini].rstrip().split("\n")[-1].rstrip() if ini else ""
            if not (prev.endswith(">") and not prev.endswith("=>")) and not re.search(r"^\s*\{.*\}$|\)\}$", prev): continue
            if not re.search(r"[<{]", t[b:fin] + t[fin:fin + 200]): continue
        elif not CIERRE.search(antes):
            continue
        ultima_etq = t[t.rfind("<", 0, a):a]
        if re.match(r"<(option|title|text|tspan|textarea)\b", ultima_etq): continue
        if antes.count('"') % 2 or antes.count("'") % 2 and "'" not in CIERRE.sub("", antes)[-1:]:
            # comilla abierta en lo que precede (fuera de la etiqueta que cierra): probable cadena
            resto = CIERRE.sub("", antes)
            if resto.count('"') % 2 or resto.count("'") % 2: continue
        if e not in MAPEADOS and e.replace("️", "") not in MAPEADOS: faltan[e] += 1; continue
        cambios.append((a, b, e, linea.strip()[:140]))
    if not cambios: continue
    if APLICAR:
        for a, b, e, _ in reversed(cambios): t = t[:a] + f'<Ico e="{e}" />' + t[b:]
        if not re.search(r'import \{[^}]*\bIco\b[^}]*\} from', t):
            rel = "../" * (len(f.parts) - 1) + "icons/Ico"
            pos = re.search(r"^import ", t, flags=re.M); pos = pos.start() if pos else 0
            t = t[:pos] + f'import {{ Ico }} from "{rel}";\n' + t[pos:]
        try: f.write_text(t, encoding="utf-8")
        except PermissionError: sinperm.append(str(f)); continue
    total += len(cambios); por[str(f)] = len(cambios); muestra += [(f.name, c[2], c[3]) for c in cambios[:1]]
print("reemplazos:", total, "en", len(por), "archivos", "(APLICADO)" if APLICAR else "(en seco)")
print("sin icono:", faltan.most_common(12)); print("sin permiso:", sinperm)
if not APLICAR:
    for n, e, l in muestra[:60]: print(f"  {e} {n[:26]:26} {l[:105]}")
