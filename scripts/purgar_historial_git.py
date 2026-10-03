#!/usr/bin/env python3
"""
Purga del historial de git los archivos que ya no existen en HEAD y que nunca
debieron versionarse: bases de datos, binarios, respaldos, datos de runtime y
—lo importante— las credenciales y la sesión de WhatsApp que estuvieron
expuestas en un repo público.

QUÉ PROBLEMA RESUELVE
El repositorio pesa ~900 MB en GitHub y 401 MB de .git en disco, contra 177 MB
de contenido vivo. La diferencia es peso muerto: 292 rutas que ya no están en
HEAD y suman ~123 MB de objetos. La causa fue el `git add -A` de los
auto-commits nocturnos, que arrastró durante meses bases de datos, logs y
cachés que cambian a diario. Eso ya se cortó (ver .gitignore, auditorías de
sep-2026), pero lo que entró al historial sigue ahí.

QUÉ NO RESUELVE
Reescribir el historial NO desactiva una credencial expuesta. Las llaves que
estuvieron en este repo público hay que rotarlas en su consola —y según la
verificación del 21-sep-2026 ya se rotaron—; esto solo deja de distribuirlas.
Y GitHub conserva los objetos inalcanzables hasta que pase su recolector: para
forzarlo hay que abrir un ticket a GitHub Support.

LA INVARIANTE QUE HACE ESTO SEGURO
Toda ruta que se purga está ausente de HEAD. Por lo tanto el árbol de cada
rama debe quedar BYTE A BYTE IDÉNTICO: cambian los SHA de los commits, no el
contenido. El script compara el hash del árbol de cada rama antes y después y
aborta si alguno cambió. Si esa comparación falla, algo se entendió mal y no se
empuja nada.

    python3 scripts/purgar_historial_git.py              # analiza, no toca nada
    python3 scripts/purgar_historial_git.py --con-media  # incluye imágenes/PDF
    python3 scripts/purgar_historial_git.py --ejecutar   # reescribe en un espejo

Ni con --ejecutar empuja a GitHub: deja el espejo reescrito y verificado, e
imprime los comandos finales para que los corra una persona.
"""

from __future__ import annotations

import argparse
import collections
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path("/home/mckg/mi-agente")
TRABAJO = Path.home() / "purga-historial"
ESPEJO = TRABAJO / "mi-agente.git"

SECRETOS = (
    r"(^\.wwebjs_auth|/\.wwebjs_auth"
    r"|^credenciales_(meli|SIIGO|google)\.json$"
    r"|^client_secret_cloud\.json$"
    r"|^mi-agente-ubuntu-[0-9a-f]+\.json$"
    r"|token_gmail\.json$)"
)

# Orden significativo: gana la primera que coincide.
CATEGORIAS_BASE: list[tuple[str, str]] = [
    ("secretos", SECRETOS),
    ("bases de datos", r"\.(db|sqlite3?)(-wal|-shm|-journal)?$"),
    ("binarios y media", r"\.(deb|apk|aab|mp4|mov|avi|zip|tar\.gz|tgz|whl|so|wasm)$"),
    ("logs", r"(^|/)(log_[^/]*\.txt|[^/]*\.log|[^/]*\.jsonl)$"),
    ("respaldos", r"(^backups?_drive/|^backups?/|\.bak[^/]*$|\.tmp$|_backup_\d+/)"),
    ("datos runtime (json)", r"^(app/data|PAGINA_WEB/site/data)/.*\.json$"),
    (
        "build y cache",
        r"(^desktop/dist|/__pycache__/|^\.playwright-mcp/|^pipeline_temp/"
        r"|^memoria_vectorial/|^\.cache/|tsconfig\.tsbuildinfo$|^\.venv/|^node_modules/)",
    ),
]

# Aparte porque es criterio, no técnica: un PDF de catálogo borrado puede
# seguir siendo el único registro de una versión del catálogo.
CATEGORIA_MEDIA = ("imagenes y PDF", r"\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|ttf|otf|woff2?)$")


def git(*args: str, cwd: Path = REPO, check: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.exit(f"git {' '.join(args)} falló:\n{r.stderr.strip()}")
    return r.stdout


def mb(n: int) -> str:
    return f"{n / 1048576:.2f} MB"


def pesos_por_ruta() -> tuple[collections.Counter, collections.Counter]:
    """Bytes en disco y número de versiones de cada ruta, en todo el historial."""
    p1 = subprocess.Popen(["git", "rev-list", "--objects", "--all"], cwd=REPO, stdout=subprocess.PIPE)
    p2 = subprocess.Popen(
        ["git", "cat-file", "--batch-check=%(objecttype) %(objectsize:disk) %(rest)"],
        cwd=REPO, stdin=p1.stdout, stdout=subprocess.PIPE, text=True,
    )
    assert p1.stdout is not None
    p1.stdout.close()
    peso: collections.Counter = collections.Counter()
    vers: collections.Counter = collections.Counter()
    assert p2.stdout is not None
    for linea in p2.stdout:
        q = linea.rstrip("\n").split(" ", 2)
        if len(q) == 3 and q[0] == "blob" and q[2]:
            peso[q[2]] += int(q[1])
            vers[q[2]] += 1
    p2.wait()
    return peso, vers


def clasificar(con_media: bool):
    peso, vers = pesos_por_ruta()
    en_head = set(git("ls-files").splitlines())
    muertas = {p: b for p, b in peso.items() if p not in en_head}

    def cat(ruta: str) -> str:
        for nombre, patron in CATEGORIAS_BASE:
            if re.search(patron, ruta):
                return nombre
        if re.search(CATEGORIA_MEDIA[1], ruta):
            return CATEGORIA_MEDIA[0]
        return "fuente y otros"

    por: dict[str, dict] = collections.defaultdict(lambda: {"bytes": 0, "rutas": []})
    for ruta, bytes_ in muertas.items():
        c = cat(ruta)
        por[c]["bytes"] += bytes_
        por[c]["rutas"].append(ruta)

    a_purgar = [n for n, _ in CATEGORIAS_BASE] + ([CATEGORIA_MEDIA[0]] if con_media else [])
    rutas = sorted(r for c in a_purgar for r in por.get(c, {}).get("rutas", []))
    return por, rutas, muertas, vers, a_purgar


def informe(por, rutas, muertas, vers, a_purgar, con_media: bool) -> None:
    print("=" * 66)
    print("ANÁLISIS — rutas ausentes de HEAD, agrupadas por qué son")
    print("=" * 66)
    total = 0
    for c in [n for n, _ in CATEGORIAS_BASE] + [CATEGORIA_MEDIA[0], "fuente y otros"]:
        d = por.get(c)
        if not d:
            continue
        marca = "PURGA    " if c in a_purgar else "CONSERVA "
        print(f"  {marca} {mb(d['bytes']):>10}  {len(d['rutas']):4d} rutas  {c}")
        if c in a_purgar:
            total += d["bytes"]
    print("-" * 66)
    print(f"  A purgar: {mb(total)} en {len(rutas)} rutas")
    if not con_media:
        m = por.get(CATEGORIA_MEDIA[0], {"bytes": 0, "rutas": []})
        print(f"  (--con-media añadiría {mb(m['bytes'])} en {len(m['rutas'])} rutas de imagen/PDF)")
    print("\n  Las 10 más pesadas que se purgan:")
    for r in sorted(rutas, key=lambda x: -muertas[x])[:10]:
        print(f"    {mb(muertas[r]):>10}  {vers[r]:4d} ver  {r}")
    f = por.get("fuente y otros", {"bytes": 0, "rutas": []})
    print(f"\n  Se conserva la historia de {len(f['rutas'])} rutas de fuente borrada ({mb(f['bytes'])}).")


def preparar_espejo() -> None:
    if ESPEJO.exists():
        sys.exit(f"{ESPEJO} ya existe. Bórralo o muévelo antes de repetir la operación.")
    TRABAJO.mkdir(parents=True, exist_ok=True)
    print(f"\nClonando espejo en {ESPEJO} (--no-local: copia objetos, no hardlinks)…")
    subprocess.run(
        ["git", "clone", "--no-local", "--mirror", str(REPO), str(ESPEJO)],
        check=True,
    )


def arboles(cwd: Path) -> dict[str, str]:
    """Hash del árbol de cada rama. Es la invariante que se verifica."""
    salida = git("for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", cwd=cwd)
    fuera = {}
    for linea in salida.splitlines():
        ref, sha = linea.split(" ", 1)
        fuera[ref] = git("rev-parse", f"{sha}^{{tree}}", cwd=cwd).strip()
    return fuera


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--con-media", action="store_true", help="incluye imágenes y PDF borrados")
    ap.add_argument("--ejecutar", action="store_true", help="reescribe el espejo (no empuja)")
    args = ap.parse_args()

    if not (REPO / ".git").is_dir():
        sys.exit(f"No encuentro el repositorio en {REPO}")

    por, rutas, muertas, vers, a_purgar = clasificar(args.con_media)
    informe(por, rutas, muertas, vers, a_purgar, args.con_media)

    if not args.ejecutar:
        print("\nAnálisis solamente. Nada fue modificado. Añade --ejecutar para reescribir.")
        return 0

    if not shutil.which("git-filter-repo"):
        sys.exit("Falta git-filter-repo. Instálalo antes de continuar.")

    print("\n" + "=" * 66)
    print("ANTES DE REESCRIBIR — verifica a mano y con calma:")
    print("=" * 66)
    print("  1. El hilo `iniciar_backup_nocturno` de agente_pro.py empuja a las 02:00")
    print("     con `git add -A`. Si corre a mitad de esto, reintroduce el historial")
    print("     viejo. Hazlo fuera de esa hora, o detén la app.")
    print("  2. Todo clon existente queda inservible: hay que rehacerlo. No hay")
    print("     `git pull` que arregle un historial reescrito.")
    print("  3. Cambian los ~700 SHA desde el primer commit afectado. Cualquier")
    print("     enlace a un commit queda roto.")
    print("  4. Esto no revoca credenciales expuestas. Eso se hace en su consola.")
    resp = input("\n¿Continuar? Escribe exactamente: reescribir\n> ").strip()
    if resp != "reescribir":
        print("Cancelado. Nada fue modificado.")
        return 1

    antes = arboles(REPO)
    tam_antes = int(git("count-objects", "-v").split("size-pack:")[1].split()[0])

    preparar_espejo()

    lista = TRABAJO / "rutas-a-purgar.txt"
    lista.write_text("\n".join(rutas) + "\n", encoding="utf-8")
    print(f"Lista escrita en {lista} ({len(rutas)} rutas)")

    print("\nReescribiendo con git-filter-repo…")
    subprocess.run(
        ["git", "filter-repo", "--invert-paths", "--paths-from-file", str(lista), "--force"],
        cwd=ESPEJO, check=True,
    )

    despues = arboles(ESPEJO)
    tam_despues = int(git("count-objects", "-v", cwd=ESPEJO).split("size-pack:")[1].split()[0])

    print("\n" + "=" * 66)
    print("VERIFICACIÓN DE LA INVARIANTE — el contenido no debe haber cambiado")
    print("=" * 66)
    fallo = False
    for ref, arbol in antes.items():
        nuevo = despues.get(ref)
        if nuevo is None:
            print(f"  ! {ref}: desapareció del espejo")
            fallo = True
        elif nuevo != arbol:
            print(f"  ! {ref}: el árbol CAMBIÓ  {arbol[:12]} -> {nuevo[:12]}")
            fallo = True
        else:
            print(f"  ✓ {ref}: árbol idéntico ({arbol[:12]})")

    print(f"\n  Pack: {tam_antes / 1024:.0f} MB -> {tam_despues / 1024:.0f} MB "
          f"({(1 - tam_despues / max(tam_antes, 1)) * 100:.0f}% menos)")

    if fallo:
        print("\nLA VERIFICACIÓN FALLÓ. No empujes nada. El espejo queda para inspección")
        print(f"en {ESPEJO}; el repositorio de trabajo está intacto.")
        return 1

    ramas = " ".join(r.replace("refs/heads/", "") for r in sorted(despues))
    print("\n" + "=" * 66)
    print("LISTO Y VERIFICADO. Los pasos finales los da una persona:")
    print("=" * 66)
    print(f"  # 1. Empujar el historial reescrito (destructivo, en GitHub)")
    print(f"  cd {ESPEJO}")
    print(f"  git push --force origin {ramas}")
    print()
    print("  # 2. En el repo de trabajo: reemplazar el historial sin tocar archivos.")
    print("  #    El árbol es idéntico, así que --soft no mueve ni un byte del disco")
    print("  #    y conserva lo que esté sin commitear.")
    print(f"  cd {REPO}")
    print("  git fetch origin --force --prune")
    print("  git reset --soft origin/$(git rev-parse --abbrev-ref HEAD)")
    print()
    print("  # 3. Rehacer cualquier otro clon (Cursor, otras máquinas).")
    print("  # 4. Pedirle a GitHub Support que recolecte los objetos inalcanzables:")
    print("  #    hasta entonces siguen accesibles por SHA.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
