# -*- coding: utf-8 -*-
"""Carga un lote de documentos técnicos (FT + COA + SDS) escritos a mano en YAML.

Cada archivo de `fichas_word/autor/<lote>/*.yaml` trae:

    modo: borrador | completar | reescribir     (default: borrador)
    ft:   {...}     datos de la ficha técnica (mismas claves que el formulario)
    coa:  {...}     opcional
    sds:  {...}     opcional — NO va en alimentos (frutos secos, semillas…)
    _fuentes:     [ "de dónde salió cada dato" ]
    _pendientes:  [ "qué falta y quién lo tiene" ]
    _sku_propuesto: {...}   solo si el producto aún no está publicado

`borrador`   → guarda `borrador_ft_coa_sds_<slug>.yaml` (lo lista el panel en
               Documentos técnicos → Borradores) y una vista previa en
               `fichas_word/previews/`. NO publica ni firma nada: el PDF
               definitivo lo genera una persona desde el panel.
`reescribir` → reemplaza ENTERO un documento publicado cuyos datos eran de otro
               producto (respalda el YAML viejo). Solo con autorización expresa.
`completar`  → mezcla `sds`/`coa`/`ft` dentro de un documento YA publicado
               (`ft_coa_sds_<slug>.yaml`), respalda el YAML y regenera su PDF.

Reglas que este script hace cumplir (no las relaje):
  * El fabricante no se publica: si `ft.fabricante` o `coa.lote.fabricante`
    vienen, se conservan solo como dato interno de trazabilidad.
  * Un COA sin resultados de lote no es un COA: los parámetros con la columna
    «resultado» vacía se quedan en el borrador y se anotan en `_pendientes`.
    Los resultados salen del COA del proveedor, nunca de la bibliografía.
  * Sin LLM: no llama a ningún modelo (nada que pasar por llm_budget).

Uso:
    python3 scripts/fichas_lote_autor.py fichas_word/autor/2026-09-19
    python3 scripts/fichas_lote_autor.py <dir> --solo-preview   # no guarda nada
"""
from __future__ import annotations

import argparse
import copy
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml  # noqa: E402

from app.services import ficha_tecnica as ft  # noqa: E402

PREVIEWS = ft.FICHAS_DIR / "previews"
RESPALDO = ft.FICHAS_DIR / "_respaldo_yaml"


def _slug(titulo: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", ft._normalizar(titulo).lower()).strip("_") or "ft"


def _mezclar(base: dict, extra: dict) -> dict:
    """Mezcla recursiva: lo que trae `extra` gana, salvo que venga vacío."""
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _mezclar(out[k], v)
        elif v not in ("", None, [], {}):
            out[k] = v
    return out


def _coa_sin_resultados(coa: dict | None) -> int:
    n = 0
    for clave in ("parametros", "metales", "microbiologia"):
        for fila in (coa or {}).get(clave) or []:
            if isinstance(fila, (list, tuple)) and len(fila) >= 2 and not str((list(fila) + [""])[2]).strip():
                n += 1
    return n


def _filas_mal_formadas(src: dict) -> list[str]:
    """Una coma sin comillas en `[a, Máx. 0,5 %, '']` parte la celda en dos y el
    PDF sale con «Máx. 0» en la especificación y «5 %» como resultado. Pasó en el
    primer lote (2026-09-19): mejor frenar que imprimir un dato corrido."""
    esperado = {("coa", "parametros"): 3, ("coa", "metales"): 3, ("coa", "microbiologia"): 3,
                ("sds", "composicion"): 3, ("sds", "propiedades"): 2, ("ft", "composicion"): 2}
    malas = []
    for (sec, clave), n in esperado.items():
        for fila in ((src.get(sec) or {}).get(clave) or []):
            if isinstance(fila, (list, tuple)) and len(fila) != n:
                malas.append(f"{sec}.{clave}: {fila!r}")
    return malas


def procesar(path: Path, solo_preview: bool) -> dict:
    src = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    malas = _filas_mal_formadas(src)
    if malas:
        return {"archivo": path.name, "ok": False, "motivo": "filas con nº de celdas inesperado (¿coma sin comillas?)", "filas": malas}
    modo = (src.get("modo") or "borrador").strip()
    datos_ft = src.get("ft") or {}
    coa, sds = src.get("coa"), src.get("sds")
    titulo = (datos_ft.get("titulo") or datos_ft.get("nombre_producto") or "").strip()
    if not titulo:
        return {"archivo": path.name, "ok": False, "motivo": "ft.titulo vacío"}
    slug = _slug(titulo)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    if modo == "completar":
        destino = ft.DATOS_DIR / f"ft_coa_sds_{slug}.yaml"
        if not destino.is_file():
            return {"archivo": path.name, "ok": False, "motivo": f"no existe {destino.name}"}
        actual = ft.cargar_datos_desde_archivo(destino)
        nuevo = _mezclar(actual, {k: v for k, v in datos_ft.items() if k not in ("titulo", "nombre_producto")})
        if datos_ft.get("propiedades_lista") or datos_ft.get("caracteristicas_fisicas"):
            # `propiedades` es un derivado (físicas + funcionales): se rehace con la
            # misma normalización del panel para que no queden las viñetas viejas.
            privadas = {k: v for k, v in nuevo.items() if k.startswith("_")}
            nuevo["propiedades"] = []
            nuevo = {**ft.normalizar_datos_ficha(nuevo), **privadas}
        if coa:
            nuevo["_coa"] = _mezclar(actual.get("_coa") or {}, coa)
        if sds:
            nuevo["_sds"] = _mezclar(actual.get("_sds") or {}, sds)
        nuevo["_fuentes"] = list(dict.fromkeys((actual.get("_fuentes") or []) + (src.get("_fuentes") or [])))
        nuevo["_completado_at"] = datetime.now(timezone.utc).isoformat()
        pdf = ft.COMPLETO_PDF_DIR / ("FT COA SDS " + re.sub(r"^FT\s+", "", ft.nombre_archivo_desde_titulo(actual.get("titulo") or titulo).replace(".docx", ".pdf")))
        salida = (PREVIEWS / pdf.name) if solo_preview else pdf
        if not solo_preview:
            RESPALDO.mkdir(exist_ok=True)
            shutil.copy2(destino, RESPALDO / f"{destino.stem}.{datetime.now():%Y%m%d-%H%M%S}.yaml")
            destino.write_text(yaml.safe_dump(nuevo, allow_unicode=True, sort_keys=False, width=88), encoding="utf-8")
        ft.generar_pdf_completo(nuevo, nuevo.get("_coa"), nuevo.get("_sds"), cabezote_id=nuevo.get("_cabezote_id"), salida=salida)
        return {"archivo": path.name, "ok": True, "modo": modo, "yaml": destino.name, "pdf": str(salida)}

    if modo == "reescribir":
        # Documento publicado cuyos datos eran de OTRO producto: no se mezcla nada,
        # se reemplaza entero. El YAML viejo queda respaldado.
        destino = ft.DATOS_DIR / f"ft_coa_sds_{slug}.yaml"
        if not destino.is_file():
            return {"archivo": path.name, "ok": False, "motivo": f"no existe {destino.name}"}
        actual = ft.cargar_datos_desde_archivo(destino)
        nuevo = ft.normalizar_datos_ficha(datos_ft)
        nuevo["_tipo"] = "completo"
        nuevo["_cabezote_id"] = actual.get("_cabezote_id") or "logotipo_turquesa"
        if coa:
            nuevo["_coa"] = coa
        if sds:
            nuevo["_sds"] = sds
        for k in ("_fuentes", "_pendientes"):
            if src.get(k):
                nuevo[k] = src[k]
        nuevo["_reescrito_at"] = datetime.now(timezone.utc).isoformat()
        pdf = ft.COMPLETO_PDF_DIR / ("FT COA SDS " + re.sub(r"^FT\s+", "", ft.nombre_archivo_desde_titulo(titulo).replace(".docx", ".pdf")))
        salida = (PREVIEWS / pdf.name) if solo_preview else pdf
        if not solo_preview:
            RESPALDO.mkdir(exist_ok=True)
            shutil.copy2(destino, RESPALDO / f"{destino.stem}.{datetime.now():%Y%m%d-%H%M%S}.yaml")
            destino.write_text(yaml.safe_dump(nuevo, allow_unicode=True, sort_keys=False, width=88), encoding="utf-8")
        ft.generar_pdf_completo(nuevo, coa, sds, cabezote_id=nuevo["_cabezote_id"], salida=salida)
        return {"archivo": path.name, "ok": True, "modo": modo, "yaml": destino.name, "pdf": str(salida)}

    # ── borrador ──
    guardar = ft.normalizar_datos_ficha(datos_ft)
    guardar["_tipo"] = "completo"
    guardar["_borrador"] = True
    guardar["_guardado_at"] = datetime.now(timezone.utc).isoformat()
    guardar["_cabezote_id"] = src.get("cabezote_id") or "logotipo_turquesa"
    if coa:
        guardar["_coa"] = coa
    if sds:
        guardar["_sds"] = sds
    pendientes = list(src.get("_pendientes") or [])
    vacios = _coa_sin_resultados(coa)
    if vacios:
        pendientes.append(
            f"COA: {vacios} parámetros con especificación pero sin resultado — copiar del COA del proveedor para el lote recibido."
        )
    for k in ("_fuentes", "_sku_propuesto"):
        if src.get(k):
            guardar[k] = src[k]
    if pendientes:
        guardar["_pendientes"] = pendientes
    preview = PREVIEWS / f"PREVIEW FT COA SDS {slug.upper().replace('_', ' ')}.pdf"
    ft.generar_pdf_completo(datos_ft, coa, sds, cabezote_id=guardar["_cabezote_id"], salida=preview, borrador=True)
    out = {"archivo": path.name, "ok": True, "modo": modo, "pdf": str(preview), "pendientes": len(pendientes)}
    if not solo_preview:
        out["yaml"] = ft.guardar_yaml_datos(guardar, slug=f"borrador_ft_coa_sds_{slug}").name
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("directorio")
    ap.add_argument("--solo-preview", action="store_true", help="renderiza a previews/ sin guardar YAML ni tocar PDF publicados")
    a = ap.parse_args()
    archivos = sorted(Path(a.directorio).glob("*.yaml"))
    if not archivos:
        print("No hay .yaml en", a.directorio)
        return 1
    mal = 0
    for p in archivos:
        try:
            r = procesar(p, a.solo_preview)
        except Exception as e:  # un archivo malo no tumba el lote
            r = {"archivo": p.name, "ok": False, "motivo": repr(e)}
        mal += 0 if r.get("ok") else 1
        print(("✔" if r.get("ok") else "✖"), r)
    return 1 if mal else 0


if __name__ == "__main__":
    raise SystemExit(main())
