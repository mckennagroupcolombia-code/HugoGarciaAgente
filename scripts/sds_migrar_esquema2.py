#!/usr/bin/env python3
"""Pasa las hojas de seguridad guardadas al esquema 2 (sin información repetida).

    python3 scripts/sds_migrar_esquema2.py                 # solo informa, no escribe
    python3 scripts/sds_migrar_esquema2.py --informe docs/auditoria_sds_esquema2.md
    python3 scripts/sds_migrar_esquema2.py --aplicar       # respalda y escribe

No hace falta migrar para que el PDF, la web y el formulario se vean en el
formato nuevo: los tres convierten al vuelo con `sds_estructura.normalizar_sds`.
Migrar deja el YAML limpio (sin los tres textos que se repetían) y saca a la
luz, documento por documento, lo que no cuadraba: frases H que aparecían en
un lado y no en el otro, frases P sin peligro clasificado, texto de la FT
metido en las recomendaciones.

Qué cambia en cada YAML con `_sds` en el formato anterior:
- `_sds.peligros` → clasificacion + senal + pictogramas_ghs + frases_h + frases_p;
  se retiran `peligros.pictogramas` y `recomendaciones`.
- `_sds.composicion` → `_coa.composicion` si el COA no tenía (la composición se
  imprime en el COA desde el 21-sep-2026).
- `recomendaciones` de la FT, si la SDS no tenía las suyas, entran a la SDS
  (como ya hacía el PDF) y se retiran de la FT.

Respaldo: `fichas_word/datos/_respaldo_sds_esquema2/<fecha>/`. Sin LLM.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

import yaml  # noqa: E402

from app.services.ficha_tecnica import DATOS_DIR  # noqa: E402
from app.services.sds_estructura import ESQUEMA_ACTUAL, normalizar_sds  # noqa: E402


def migrar_datos(datos: dict) -> tuple[dict, list[str]] | None:
    """Devuelve (datos_nuevos, avisos) o None si no hay nada que migrar."""
    sds = datos.get("_sds")
    if not isinstance(sds, dict) or sds.get("esquema") == ESQUEMA_ACTUAL:
        return None
    nuevo = dict(datos)
    entrada = dict(sds)
    pel = entrada.get("peligros") if isinstance(entrada.get("peligros"), dict) else {}
    recs_ft = nuevo.get("recomendaciones")
    usa_recs_ft = bool(recs_ft) and not entrada.get("recomendaciones") and not pel.get("recomendaciones")
    if usa_recs_ft:
        entrada["recomendaciones"] = recs_ft
    sds_nueva, avisos = normalizar_sds(entrada)
    if usa_recs_ft:
        nuevo.pop("recomendaciones", None)
        avisos.insert(0, "Las recomendaciones GHS estaban en la FT: se repartieron en la SDS.")

    comp = sds_nueva.pop("composicion", None)
    if comp:
        coa = nuevo.get("_coa") if isinstance(nuevo.get("_coa"), dict) else None
        if coa is not None and not coa.get("composicion"):
            nuevo["_coa"] = {**coa, "composicion": comp}
        elif coa is None:
            sds_nueva["composicion"] = comp  # sin COA la composición se queda en la SDS
            avisos.append("Sin COA: la composición se queda en la SDS.")
        else:
            avisos.append("El COA ya tenía composición: se descartó la copia de la SDS.")
    nuevo["_sds"] = sds_nueva
    return nuevo, avisos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aplicar", action="store_true", help="escribir los YAML (con respaldo)")
    ap.add_argument("--informe", type=Path, help="escribir el informe en Markdown en esta ruta")
    args = ap.parse_args()

    archivos = sorted(p for p in DATOS_DIR.glob("*.y*ml") if p.is_file())
    respaldo = DATOS_DIR / "_respaldo_sds_esquema2" / datetime.now().strftime("%Y%m%d-%H%M%S")
    cambios: list[tuple[Path, list[str]]] = []
    for path in archivos:
        try:
            datos = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:  # un YAML roto no frena el resto
            print(f"✖ {path.name}: no se pudo leer ({exc})")
            continue
        r = migrar_datos(datos)
        if not r:
            continue
        nuevo, avisos = r
        cambios.append((path, avisos))
        if args.aplicar:
            respaldo.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, respaldo / path.name)
            path.write_text(yaml.dump(nuevo, allow_unicode=True, sort_keys=False), encoding="utf-8")

    con_avisos = [(p, a) for p, a in cambios if a]
    lineas = [
        "# Hojas de seguridad → esquema 2",
        "",
        f"{len(cambios)} documento(s) en el formato anterior; {len(con_avisos)} con puntos para revisar.",
        "Modo: " + ("**aplicado**, respaldo en `" + str(respaldo.relative_to(RAIZ)) + "`" if args.aplicar else "solo informe (no se escribió nada)"),
        "",
    ]
    for path, avisos in con_avisos:
        lineas.append(f"## {path.stem}")
        lineas.extend(f"- {a}" for a in avisos)
        lineas.append("")
    texto = "\n".join(lineas)
    if args.informe:
        args.informe.parent.mkdir(parents=True, exist_ok=True)
        args.informe.write_text(texto, encoding="utf-8")
        print(f"Informe: {args.informe}")
    print("\n".join(lineas[:4]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
