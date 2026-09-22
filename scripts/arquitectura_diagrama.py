#!/usr/bin/env python3
"""
Diagrama de Archify «Cómo se compone el código»: los grupos de archivos del repo
y cuántas llamadas van de uno a otro, derivado del snapshot de codebase-memory-mcp.

Lee app/data/arquitectura_cbm/grafo.json (archivo → archivo, con nº de llamadas)
y escribe docs/arquitectura/07-codigo.architecture.json; el HTML lo genera
`python3 scripts/diagramas_arquitectura.py entregar` como a los demás diagramas.

Por qué un diagrama y no la nube 3D del binario: la nube dibuja 40.000 nodos y
no responde ninguna pregunta; esto responde una: quién depende de quién y con
qué peso. La posición de cada grupo es fija (se eligió a mano para que las
rutas no se crucen); lo que cambia con cada snapshot son las cifras.

Reglas:
  · Solo llamadas dentro del mismo lenguaje. CBM también resuelve nombres entre
    Python y TypeScript (p. ej. «app/services → desktop/src: 68»), y eso no es
    una dependencia real: son funciones que se llaman igual en los dos lados.
  · Los tests entran como grupo aparte y con trazo punteado: dependen de todo y
    de ellos no depende nada; sin ese trazo distinto tapaban el resto.
  · Se dibujan solo las aristas de ARISTAS (10); el resto de pesos sale en la
    tabla del panel. Un grafo con todas las aristas no pasa el validador de
    Archify (cruces) y tampoco se lee.
  · Panel React ↔ Flask no aparece como llamada (es HTTP): se dibuja punteado
    con esa etiqueta para no mentir con el grafo.
  · Cada caja trae sus funciones muertas confirmadas (mismo dato que la pestaña
    «Código muerto»), con recorrido guiado y tarjeta propios.
Sin LLM.
"""

from __future__ import annotations

import collections
import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SNAPSHOT = RAIZ / "app" / "data" / "arquitectura_cbm"
SALIDA = RAIZ / "docs" / "arquitectura" / "07-codigo.architecture.json"

PY = {"py"}
TS = {"ts", "tsx", "js", "mjs", "cjs", "jsx"}

# Grupo → (tipo Archify, etiqueta, subtítulo, posición, tamaño, archivo de referencia).
# Tres filas: arriba quién entra (procesos, panel, agente, cron, tienda); en medio el
# núcleo (app/ ↔ app/services); abajo herramientas y tests. Las columnas se eligieron
# para que ninguna arista atraviese un nodo ajeno ni se cruce con otra.
GRUPOS = {
    "procesos":     ("backend",  "raíz: webhook, posventa", "webhook_meli.py :8080", (40, 40),   (170, 64), "webhook_meli.py"),
    "panel":        ("frontend", "desktop/src/",        "panel React /app",          (260, 40),  (170, 64), "desktop/src/App.tsx"),
    "agente":       ("backend",  "app/agent/ · memory/", "agente de ventas v2",      (480, 40),  (170, 64), "app/agent/ventas_wa/agente.py"),
    "scripts":      ("backend",  "scripts/",            "cron y utilidades",         (700, 40),  (170, 64), "scripts/instalar_cron_mcKenna.sh"),
    "tienda":       ("backend",  "PAGINA_WEB/site/",    "website.py :8083",          (920, 40),  (170, 64), "PAGINA_WEB/site/website.py"),
    "rutas":        ("backend",  "app/ (rutas y núcleo)", "routes.py · core.py · utils.py", (250, 250), (190, 76), "app/routes.py"),
    "servicios":    ("backend",  "app/services/",       "dominio y contabilidad",    (690, 250), (190, 76), "app/services/contabilidad_core.py"),
    "herramientas": ("backend",  "app/tools/",          "integraciones y lotes",     (480, 430), (190, 76), "app/tools/backup_drive.py"),
    "tests":        ("backend",  "tests/",              "pruebas pytest",            (920, 436), (170, 64), "tests/test_smoke.py"),
}
# Etiquetas que el validador encontró encimadas con un nodo o con la arista gemela.
DESPLAZAR_ETIQUETA = {("scripts", "servicios"): 24}
# Las dos aristas gemelas app/ ↔ services/ van paralelas: sus etiquetas se fijan a mano,
# una encima y otra debajo del par, lejos de la subida de tools/ → services/.
ETIQUETA_FIJA = {("rutas", "servicios"): [500, 240], ("servicios", "rutas"): [500, 338]}
# Las aristas que se DIBUJAN (las demás quedan en la tabla del panel): la historia es
# «todo converge en app/services», más el ciclo services ↔ app/ y el paso por tools/.
ARISTAS = [
    ("procesos", "rutas"), ("agente", "servicios"), ("scripts", "servicios"), ("tienda", "servicios"),
    ("rutas", "servicios"), ("servicios", "rutas"), ("rutas", "herramientas"), ("herramientas", "servicios"),
    ("tests", "servicios"), ("tests", "herramientas"),
]
ORDEN = list(GRUPOS)


def grupo_de(archivo: str) -> str | None:
    if archivo.startswith("desktop/"):
        return "panel"
    if archivo.startswith("app/services/"):
        return "servicios"
    if archivo.startswith("app/tools/"):
        return "herramientas"
    if archivo.startswith(("app/agent/", "app/memory/")):
        return "agente"
    if archivo.startswith("app/"):
        return "rutas"
    if archivo.startswith("PAGINA_WEB/"):
        return "tienda"
    if archivo.startswith("scripts/"):
        return "scripts"
    if archivo.startswith("tests/"):
        return "tests"
    if "/" not in archivo:
        return "procesos"
    return None  # .agents, reportes: fuera del diagrama


def agregar(grafo: dict) -> tuple[dict, dict, dict, dict]:
    lang = {n["archivo"]: n.get("lenguaje") for n in grafo["nodos"]}
    archivos = collections.Counter(g for n in grafo["nodos"] if (g := grupo_de(n["archivo"])))
    entre: collections.Counter = collections.Counter()
    dentro: collections.Counter = collections.Counter()
    cruzadas: collections.Counter = collections.Counter()
    for a in grafo["aristas"]:
        o, d = grupo_de(a["origen"]), grupo_de(a["destino"])
        if not o or not d:
            continue
        lo, ld = lang.get(a["origen"]), lang.get(a["destino"])
        mismo = (lo in PY and ld in PY) or (lo in TS and ld in TS)
        if o == d:
            dentro[o] += a["llamadas"]
        elif mismo:
            entre[(o, d)] += a["llamadas"]
        else:
            cruzadas[(o, d)] += a["llamadas"]
    return archivos, entre, dentro, cruzadas


def revision_git() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=RAIZ, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return "0" * 40


def muertas_por_grupo(codigo_muerto: dict) -> collections.Counter:
    """Funciones muertas CONFIRMADAS (ya pasadas por el embudo de menciones y
    decoradores) por grupo. Es el mismo dato de la pestaña «Código muerto»."""
    c: collections.Counter = collections.Counter()
    for f in codigo_muerto.get("funciones") or []:
        g = grupo_de(str(f.get("archivo", "")))
        if g:
            c[g] += 1
    return c


def construir(grafo: dict, resumen: dict, codigo_muerto: dict | None = None) -> dict:
    archivos, entre, dentro, cruzadas = agregar(grafo)
    muertas = muertas_por_grupo(codigo_muerto or {})
    embudo = (codigo_muerto or {}).get("embudo") or {}

    componentes = []
    for gid in ORDEN:
        tipo, label, sub, pos, size, fuente = GRUPOS[gid]
        n = archivos.get(gid, 0)
        comp = {
            "id": gid, "type": tipo, "label": label, "sublabel": sub,
            "pos": list(pos), "size": list(size),
            "tag": f"{n} archivos · {muertas.get(gid, 0)} muertas",
            "sources": [{"path": fuente, "label": label}],
        }
        componentes.append(comp)

    conexiones = []
    for o, d in ARISTAS:
        n = entre.get((o, d), 0)
        c = {"id": f"{o}-{d}", "from": o, "to": d, "label": f"{n}×"}
        if o == "tests":
            c["variant"] = "dashed"
        if {o, d} == {"rutas", "servicios"}:
            c["variant"] = "emphasis"
        if (o, d) in DESPLAZAR_ETIQUETA:
            c["labelDy"] = DESPLAZAR_ETIQUETA[(o, d)]
        if (o, d) in ETIQUETA_FIJA:
            c["labelAt"] = ETIQUETA_FIJA[(o, d)]
        conexiones.append(c)
    # El panel habla con Flask por HTTP, no por import: se declara, no se deduce.
    conexiones.append({"id": "panel-rutas", "from": "panel", "to": "rutas",
                       "label": "HTTP /api", "variant": "dashed", "labelDy": 24})

    entrantes = collections.Counter()
    for (o, d), n in entre.items():
        entrantes[d] += n
    ciclo = entre.get(("rutas", "servicios"), 0), entre.get(("servicios", "rutas"), 0)
    cruz_total = sum(cruzadas.values())
    top_cruz = cruzadas.most_common(1)[0] if cruzadas else (("", ""), 0)

    cards = [
        {"dot": "emerald", "title": "Dónde se concentra la lógica", "items": [
            f"app/services/ recibe {entrantes['servicios']} llamadas de fuera; app/tools/ {entrantes['herramientas']} y app/ (rutas) {entrantes['rutas']}",
            f"ciclo app/ ↔ services/: {ciclo[0]} y {ciclo[1]} llamadas; por eso hay imports dentro de funciones",
        ]},
        {"dot": "rose", "title": f"Código muerto: {embudo.get('confirmadas', sum(muertas.values()))} funciones confirmadas", "items": [
            ", ".join(f"{GRUPOS[g][1]} {n}" for g, n in muertas.most_common(4)) or "sin datos",
            f"de {embudo.get('sin_llamadores', '?')} sin llamadores, {embudo.get('descartadas_por_mencion', '?')} sí se mencionan (JSX, rutas Flask) y {embudo.get('descartadas_por_decorador', '?')} llevan decorador",
        ]},
        {"dot": "cyan", "title": "Lo que el grafo NO dice", "items": [
            f"{cruz_total} «llamadas» Python↔TypeScript descartadas (nombres iguales); la mayor {top_cruz[0][0]} → {top_cruz[0][1]} ({top_cruz[1]})",
            f"snapshot del {str(resumen.get('generado') or '')[:16].replace('T', ' ')} · scripts/arquitectura_diagrama.py",
        ]},
    ]

    return {
        "schema_version": 1,
        "diagram_type": "architecture",
        "meta": {
            "title": "Cómo se compone el código — quién depende de quién",
            "output": "07-codigo.html",
            "quality_profile": "showcase",
            "viewBox": [1130, 552],
            "views": [
                {"id": "centro", "label": "El centro: app/services", "focus": ["rutas", "herramientas", "servicios", "agente"],
                 "note": f"Rutas, herramientas y el agente apuntan a services/; y services/ devuelve {ciclo[1]} llamadas a app/: un ciclo."},
                {"id": "entradas", "label": "Quién entra desde fuera de app/", "focus": ["scripts", "tienda", "procesos", "rutas", "servicios"],
                 "note": "Los cron, la tienda y el webhook llegan directo a servicios sin pasar por el panel."},
                {"id": "muerto", "label": "Dónde está el código muerto",
                 "focus": [g for g, _ in muertas.most_common(4)] or ["panel"],
                 "note": ("Funciones que nadie llama ni menciona: " + ", ".join(f"{GRUPOS[g][1]} {n}" for g, n in muertas.most_common(3)) + ". Lista por archivo en «Código muerto».")[:140]},
                {"id": "pruebas", "label": "Qué cubren los tests", "focus": ["tests", "servicios", "herramientas", "rutas"],
                 "note": f"Los tests llaman {entrantes and entre.get(('tests', 'servicios'), 0)} veces a services/ y {entre.get(('tests', 'herramientas'), 0)} a tools/; al panel React no lo prueban desde Python."},
            ],
            "repository": {
                "url": "https://github.com/mckennagroupcolombia-code/HugoGarciaAgente",
                "provider": "github", "link_mode": "local-only", "revision": revision_git(),
            },
        },
        "components": componentes,
        "boundaries": [
            {"kind": "region", "label": "Paquete app/ — lo que corre en agente_pro.py :8081",
             "wraps": ["rutas", "agente", "herramientas", "servicios"]},
        ],
        "connections": conexiones,
        "cards": cards,
    }


def main() -> int:
    try:
        grafo = json.loads((SNAPSHOT / "grafo.json").read_text("utf-8"))
        resumen = json.loads((SNAPSHOT / "resumen.json").read_text("utf-8"))
        codigo_muerto = json.loads((SNAPSHOT / "codigo_muerto.json").read_text("utf-8"))
    except OSError as e:
        sys.exit(f"Falta el snapshot ({e}). Genera primero: python3 scripts/arquitectura_cbm.py")
    datos = construir(grafo, resumen, codigo_muerto)
    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"→ {SALIDA.relative_to(RAIZ)}  ({len(datos['components'])} grupos, {len(datos['connections'])} aristas)")
    print("Ahora: python3 scripts/diagramas_arquitectura.py entregar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
