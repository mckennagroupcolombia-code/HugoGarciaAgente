#!/usr/bin/env python3
"""
Genera el snapshot de arquitectura que consume el panel (/app → Arquitectura).

Por qué un snapshot y no consultar en vivo: el binario de codebase-memory-mcp y
su índice viven en el home de otro usuario (`drwxr-x---`), así que el proceso de
la app —que corre como mckg— no puede ejecutarlo ni leer su caché. Este script
corre del lado que sí tiene acceso, deja tres JSON en app/data/arquitectura_cbm/
y las rutas de app/routes_arquitectura.py solo los sirven. De paso el panel
abre instantáneo en vez de esperar los ~20 s que tarda una consulta al grafo.

Los JSON son derivados: van a .gitignore. Se regeneran con este script.

    python3 scripts/arquitectura_cbm.py                # usa el índice existente
    python3 scripts/arquitectura_cbm.py --reindexar    # reindexa primero

SOBRE EL CÓDIGO MUERTO
El grafo marca ~3.500 funciones sin llamadores, y ese número crudo no sirve:
CBM no crea aristas CALLS para dos patrones muy comunes en este repo.

  1. Referencias JSX. `onChange={toggleSelectAll}` pasa la función como prop;
     no es una llamada, así que el grafo la ve huérfana aunque React la invoque.
  2. Rutas Flask. `@app.route("/api/x")` sobre `def api_x()` — quien invoca es
     Flask por la URL, y el nombre de la función no aparece en ninguna parte.

Por eso cada candidato pasa dos filtros antes de reportarse:

  · MENCIONES — se cuenta el identificador en todo el fuente versionado,
    incluidos strings (para no perder despachos dinámicos tipo getattr o
    registros por nombre). Si aparece dos o más veces, algo lo referencia.
  · DECORADOR — si justo encima de la definición hay un `@...`, alguien la
    invoca por registro y no por nombre.

Lo que sobrevive tiene exactamente una mención en el repo: su propia
definición. Medido el 21-sep-2026: 3.530 → 983 → 196.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "app" / "data" / "arquitectura_cbm"
PROYECTO = os.getenv("CBM_PROYECTO", "home-mckg-mi-agente")

# Extensiones que cuentan como fuente al verificar menciones. Incluye .json,
# .md y .html a propósito: un nombre citado en una plantilla o en un registro
# de cron es una referencia real aunque no sea código.
EXTS_FUENTE = (
    ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx",
    ".html", ".sh", ".json", ".md", ".yml", ".yaml",
)

IDENTIFICADOR = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def binario() -> str:
    """Ruta al ejecutable de CBM. CBM_BIN manda; si no, se busca en el PATH."""
    if os.getenv("CBM_BIN"):
        return os.environ["CBM_BIN"]
    hallado = shutil.which("codebase-memory-mcp")
    if hallado:
        return hallado
    for c in (Path.home() / ".local/bin/codebase-memory-mcp", Path("/usr/local/bin/codebase-memory-mcp")):
        if c.exists():
            return str(c)
    sys.exit("No encuentro codebase-memory-mcp. Instálalo o define CBM_BIN.")


def cbm(tool: str, *flags: str, timeout: int = 600) -> dict:
    """Ejecuta una herramienta de CBM y devuelve su JSON."""
    cmd = [binario(), "cli", "--quiet", tool, *flags, "--format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{tool} falló: {(r.stderr or r.stdout)[:400]}")
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"{tool} devolvió algo que no es JSON: {r.stdout[:200]}") from e


def consulta(cypher: str, timeout: int = 600) -> list[list]:
    return cbm("query_graph", "--project", PROYECTO, "--query", cypher, timeout=timeout).get("rows", [])


def consulta_paginada(plantilla: str, total: int, paso: int = 120) -> list[list]:
    """Pagina con SKIP/LIMIT: CBM trunca por presupuesto de salida, no por LIMIT.

    `plantilla` debe traer un %d donde va el SKIP.
    """
    filas: list[list] = []
    for skip in range(0, total, paso):
        filas.extend(consulta(plantilla % skip))
    # Dedupe conservando el orden: los bordes de página pueden solaparse.
    vistas, unicas = set(), []
    for f in filas:
        k = tuple(f)
        if k not in vistas:
            vistas.add(k)
            unicas.append(f)
    return unicas


# ---------------------------------------------------------------- fuentes

def archivos_fuente() -> list[str]:
    salida = subprocess.run(
        ["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True
    ).stdout.splitlines()
    return [f for f in salida if f.endswith(EXTS_FUENTE) and not f.startswith("desktop/dist")]


def contar_mencion_por_identificador(archivos: list[str]) -> collections.Counter:
    cuenta: collections.Counter = collections.Counter()
    for rel in archivos:
        try:
            cuenta.update(IDENTIFICADOR.findall((RAIZ / rel).read_text(encoding="utf-8", errors="ignore")))
        except OSError:
            continue
    return cuenta


def lineas_de(rel: str, cache: dict[str, list[str]]) -> list[str]:
    if rel not in cache:
        try:
            cache[rel] = (RAIZ / rel).read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            cache[rel] = []
    return cache[rel]


def tiene_decorador(rel: str, linea: int, cache: dict[str, list[str]]) -> bool:
    """¿Hay un `@algo` inmediatamente encima de la definición?

    Sube saltando blancos, comentarios y la cola de una firma multilínea. Seis
    líneas no vacías de margen: de ahí para arriba ya es otro bloque.
    """
    ls = lineas_de(rel, cache)
    if not ls:
        return False
    i, vistos = linea - 2, 0
    while i >= 0 and vistos < 6:
        s = ls[i].strip()
        if not s:
            i -= 1
            continue
        if s.startswith("@"):
            return True
        if s.startswith("#") or s.startswith(")") or s.endswith(",") or s.endswith("("):
            i -= 1
            vistos += 1
            continue
        return False
    return False


# ---------------------------------------------------------------- piezas

def snapshot_resumen() -> dict:
    a = cbm("get_architecture", "--project", PROYECTO, "--aspects", "overview")
    tabla = lambda k: {"cols": (a.get(k) or {}).get("cols", []), "rows": (a.get(k) or {}).get("rows", [])}
    return {
        "proyecto": a.get("project"),
        "nodos": a.get("total_nodes"),
        "aristas": a.get("total_edges"),
        "etiquetas": tabla("node_labels"),
        "tipos_arista": tabla("edge_types"),
        "lenguajes": tabla("languages"),
        "paquetes": tabla("packages"),
        "entry_points": tabla("entry_points"),
        "rutas": tabla("routes"),
        "hotspots": tabla("hotspots"),
        "capas": tabla("layers"),
        "fronteras": tabla("boundaries"),
        "clusters": tabla("clusters"),
    }


def snapshot_codigo_muerto() -> dict:
    total = consulta(
        "MATCH (f:Function) WHERE NOT EXISTS { (f)<-[:CALLS]-() } "
        "RETURN count(f) AS n"
    )
    sin_llamadores = int(total[0][0]) if total else 0

    filtro = (
        "MATCH (f:Function) WHERE "
        "NOT EXISTS { (f)<-[:CALLS]-() } AND "
        "NOT EXISTS { (f)<-[:CALL_REFERENCE]-() } AND "
        "NOT EXISTS { (f)<-[:TESTS]-() } AND "
        "NOT EXISTS { (f)<-[:HANDLES]-() } AND "
        "NOT EXISTS { (f)<-[:USAGE]-() } AND "
        "NOT EXISTS { (f)<-[:DECORATES]-() } AND "
        'NOT (f.file_path STARTS WITH "tests/") AND '
        'NOT (f.name STARTS WITH "test_") '
    )
    n_cand = consulta(filtro + "RETURN count(f) AS n")
    n_cand = int(n_cand[0][0]) if n_cand else 0

    candidatos = consulta_paginada(
        filtro
        + "RETURN f.name AS nombre, f.file_path AS archivo, f.start_line AS linea "
        + "ORDER BY f.file_path, f.start_line SKIP %d LIMIT 120",
        total=n_cand,
    )

    archivos = archivos_fuente()
    menciones = contar_mencion_por_identificador(archivos)
    cache: dict[str, list[str]] = {}

    muertas, n_referenciadas, n_decoradas = [], 0, 0
    for fila in candidatos:
        if len(fila) != 3:
            continue
        nombre, archivo, linea = fila[0], fila[1], int(fila[2])
        if menciones.get(nombre, 0) > 1:
            n_referenciadas += 1
        elif tiene_decorador(archivo, linea, cache):
            n_decoradas += 1
        else:
            muertas.append({
                "nombre": nombre,
                "archivo": archivo,
                "linea": linea,
                "lenguaje": Path(archivo).suffix.lstrip(".") or "?",
            })

    muertas.sort(key=lambda m: (m["archivo"], m["linea"]))
    por_archivo = collections.Counter(m["archivo"] for m in muertas)
    por_lenguaje = collections.Counter(m["lenguaje"] for m in muertas)

    return {
        "embudo": {
            "sin_llamadores": sin_llamadores,
            "candidatos": len(candidatos),
            "descartadas_por_mencion": n_referenciadas,
            "descartadas_por_decorador": n_decoradas,
            "confirmadas": len(muertas),
        },
        "archivos_escaneados": len(archivos),
        "por_archivo": [{"archivo": a, "muertas": n} for a, n in por_archivo.most_common()],
        "por_lenguaje": [{"lenguaje": l, "muertas": n} for l, n in por_lenguaje.most_common()],
        "funciones": muertas,
    }


def snapshot_grafo(max_aristas: int = 900) -> dict:
    """Grafo archivo→archivo, con el peso = cuántas llamadas cruzan.

    A nivel de función el grafo tiene 36 mil aristas y no se lee. A nivel de
    archivo cabe en pantalla y responde la pregunta que de verdad importa:
    quién depende de quién.
    """
    n = consulta("MATCH (f:Function)-[:CALLS]->(g:Function) RETURN count(g) AS n")
    n = int(n[0][0]) if n else 0
    filas = consulta_paginada(
        "MATCH (f:Function)-[:CALLS]->(g:Function) "
        "RETURN f.file_path AS origen, g.file_path AS destino, count(g) AS llamadas "
        "ORDER BY llamadas DESC SKIP %d LIMIT 120",
        total=min(n, 4800),
    )

    aristas, auto = [], {}
    for fila in filas:
        if len(fila) != 3:
            continue
        origen, destino, llamadas = fila[0], fila[1], int(fila[2])
        if not origen or not destino:
            continue
        # CBM usa pseudo-archivos como <python-builtins> para lo que no es del
        # repo. En un mapa de dependencias internas son ruido.
        if origen.startswith("<") or destino.startswith("<"):
            continue
        if origen == destino:
            # Cohesión interna del archivo: no es una arista, es un atributo.
            auto[origen] = llamadas
            continue
        aristas.append({"origen": origen, "destino": destino, "llamadas": llamadas})

    aristas.sort(key=lambda a: -a["llamadas"])
    aristas = aristas[:max_aristas]

    grados: collections.Counter = collections.Counter()
    entrantes: collections.Counter = collections.Counter()
    for a in aristas:
        grados[a["origen"]] += a["llamadas"]
        entrantes[a["destino"]] += a["llamadas"]

    rutas = sorted(set([a["origen"] for a in aristas] + [a["destino"] for a in aristas]))
    nodos = [{
        "archivo": p,
        "modulo": p.split("/")[0] if "/" in p else ".",
        "lenguaje": Path(p).suffix.lstrip(".") or "?",
        "sale": grados.get(p, 0),
        "entra": entrantes.get(p, 0),
        "interno": auto.get(p, 0),
    } for p in rutas]

    return {"nodos": nodos, "aristas": aristas, "aristas_totales_encontradas": len(filas)}


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Snapshot de arquitectura para el panel")
    ap.add_argument("--reindexar", action="store_true", help="reindexa el repo antes de consultar")
    args = ap.parse_args()

    if args.reindexar:
        print("Reindexando…", flush=True)
        r = cbm("index_repository", "--repo-path", str(RAIZ), timeout=1800)
        print(f"  {r.get('nodes')} nodos · {r.get('edges')} aristas · {r.get('status')}")

    DESTINO.mkdir(parents=True, exist_ok=True)
    generado = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    for nombre, construir in (
        ("resumen", snapshot_resumen),
        ("codigo_muerto", snapshot_codigo_muerto),
        ("grafo", snapshot_grafo),
    ):
        print(f"Generando {nombre}…", flush=True)
        datos = construir()
        datos["generado"] = generado
        datos["proyecto_cbm"] = PROYECTO
        destino = DESTINO / f"{nombre}.json"
        tmp = destino.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(destino)  # atómico: el panel nunca lee un JSON a medio escribir
        print(f"  → {destino.relative_to(RAIZ)} ({destino.stat().st_size // 1024} KB)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
