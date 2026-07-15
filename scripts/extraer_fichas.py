#!/usr/bin/env python3
"""
Extrae fichas técnicas de los archivos Word en fichas_word/ y de las fichas
estructuradas en fichas_word/datos/*.yaml (formato FT/COA/SDS más reciente),
y genera PAGINA_WEB/site/data/fichas_tecnicas.json — el caché que lee el
"texto mágico" de Studio (app/tools/plantillas_texto_ia.py).

La extracción Word vive en app.services.ficha_tecnica_word.
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from app.services.ficha_tecnica import DATOS_DIR, FICHAS_DIR  # noqa: E402
from app.services.ficha_tecnica_word import (  # noqa: E402
    clave_desde_archivo,
    clave_desde_nombre,
    extraer_ficha,
    extraer_ficha_yaml,
    listar_ft_docx,
)

OUTPUT = REPO / "PAGINA_WEB" / "site" / "data" / "fichas_tecnicas.json"


def construir_cache_fichas() -> tuple[dict, list[tuple[str, str]]]:
    """Construye el dict clave→ficha desde Word + YAML. Retorna (resultado, errores)."""
    archivos = listar_ft_docx(FICHAS_DIR)
    print(f"Encontrados {len(archivos)} archivos FT *.docx")

    resultado: dict = {}
    errores: list[tuple[str, str]] = []

    for archivo in archivos:
        clave = clave_desde_archivo(archivo.name)
        try:
            ficha = extraer_ficha(archivo)
            resultado[clave] = ficha
            print(
                f"  OK  {clave[:50]:<50}  "
                f"secciones={len(ficha['secciones'])}  props={len(ficha['propiedades'])}"
            )
        except Exception as e:
            errores.append((archivo.name, str(e)))
            print(f"  ERR {archivo.name}: {e}")

    yamls = sorted(
        p for p in DATOS_DIR.glob("*.yaml") if "plantilla_ejemplo" not in p.stem.lower()
    )
    print(f"\nEncontrados {len(yamls)} archivos datos/*.yaml")
    for archivo in yamls:
        try:
            ficha = extraer_ficha_yaml(archivo)
            nombre = ficha["titulo"] or archivo.stem
            clave = clave_desde_nombre(nombre)
            if not clave or clave == "nombre del producto":
                raise ValueError("sin titulo/nombre_producto real (plantilla sin completar)")
            score_nueva = (
                len(ficha["secciones"])
                + len(ficha["propiedades"])
                + len(ficha["identidad"])
                + bool(ficha["descripcion"])
            )
            existente = resultado.get(clave)
            if existente:
                score_existente = (
                    len(existente.get("secciones") or [])
                    + len(existente.get("propiedades") or [])
                    + len(existente.get("identidad") or [])
                    + bool(existente.get("descripcion"))
                )
                if score_nueva < score_existente:
                    print(
                        f"  --  '{clave}' de {archivo.name} tiene menos datos que la ficha "
                        f"existente; se conserva la existente"
                    )
                    continue
                print(f"  (sobrescribe entrada existente '{clave}' con datos de {archivo.name})")
            resultado[clave] = ficha
            print(
                f"  OK  {clave[:50]:<50}  "
                f"secciones={len(ficha['secciones'])}  props={len(ficha['propiedades'])}"
            )
        except Exception as e:
            errores.append((archivo.name, str(e)))
            print(f"  ERR {archivo.name}: {e}")

    return resultado, errores


def main() -> int:
    resultado, errores = construir_cache_fichas()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ Guardado: {OUTPUT}")
    print(f"  {len(resultado)} fichas  |  {len(errores)} errores")
    if errores:
        for n, e in errores:
            print(f"  ! {n}: {e}")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
