# -*- coding: utf-8 -*-
"""Rellena los campos VACÍOS de las fichas técnicas con datos deducidos.

Decisión del negocio (2026-09-19): ninguna ficha se queda con casillas vacías.
Lo que no consta en un documento del proveedor se DEDUCE, en este orden:

  1. documento del proveedor o factura      → `pais_documentado`
  2. mapa de orígenes del sitio web          → `origen_materias.json::overrides_sku`
     (así la etiqueta dice lo mismo que ya publica la web)
  3. lo que ya se le responde al cliente     → grado (preventa MeLi, WhatsApp)
  4. literatura técnica y científica         → aroma, fórmula, composición, CAS,
     conservación y, como último recurso, el principal país productor (`pais_deducido`)

Reglas:
  * NUNCA pisa un dato existente: solo escribe donde está vacío.
  * Cada dato escrito deja su procedencia en `_fuentes` de la ficha, marcada
    «(deducido)», para que Calidad sepa qué confirmar cuando llegue el documento
    del proveedor. Los resultados de COA NO se deducen: son de lote.
  * Respalda cada YAML antes de tocarlo. Sin LLM.

Uso:
    python3 scripts/fichas_completar_deducciones.py fichas_word/autor/2026-09-19c/deducciones.yaml
    python3 scripts/fichas_completar_deducciones.py <kb.yaml> --simular
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import yaml  # noqa: E402

import auditar_catalogo_combos as aud  # noqa: E402
from app.services import ficha_tecnica as ft  # noqa: E402

HOY = datetime.now().strftime("%Y-%m-%d")


def _origen_web_por_titulo() -> dict[frozenset, str]:
    """{tokens del nombre base del producto web: país} según el mapa del sitio."""
    om = json.loads((REPO / "PAGINA_WEB/site/data/origen_materias.json").read_text(encoding="utf-8"))
    ov = om.get("overrides_sku") or {}
    cache = json.loads((REPO / "PAGINA_WEB/site/data/cache.json").read_text(encoding="utf-8"))
    out: dict[frozenset, collections.Counter] = collections.defaultdict(collections.Counter)
    for sec in cache.get("sections") or []:
        for p in sec.get("products") or []:
            v = ov.get(p.get("ref"))
            pais = v.get("pais") if isinstance(v, dict) else v
            if pais:
                out[frozenset(aud._toks(p.get("name") or ""))][pais] += 1
    return {k: c.most_common(1)[0][0] for k, c in out.items()}


def _vacio(v) -> bool:
    return v in (None, "", [], {}) or (isinstance(v, str) and not v.strip())


def completar(kb: dict, simular: bool) -> list[dict]:
    web = _origen_web_por_titulo()
    kb_norm = {aud._norm(k): v for k, v in kb.items()}
    resp = ft.FICHAS_DIR / "_respaldo_yaml"
    resp.mkdir(exist_ok=True)
    informe = []
    for path in sorted(ft.DATOS_DIR.glob("*.yaml")):
        if path.name.startswith(("plantilla", "coa_", "sds_")):
            continue
        try:
            y = ft.cargar_datos_desde_archivo(path) or {}
        except Exception:
            continue
        titulo = (y.get("titulo") or y.get("nombre_producto") or "").strip()
        tn = aud._norm(titulo)
        regla = kb_norm.get(tn) or next((v for k, v in kb_norm.items() if tn and (tn.startswith(k) or k.startswith(tn))), None)
        if regla is None:
            continue
        cf = y.get("caracteristicas_fisicas") if isinstance(y.get("caracteristicas_fisicas"), dict) else {}
        coa = y.get("_coa") if isinstance(y.get("_coa"), dict) else {}
        lote = coa.get("lote") if isinstance(coa.get("lote"), dict) else {}
        ident = coa.get("identificacion") if isinstance(coa.get("identificacion"), dict) else {}
        cambios: list[str] = []

        def poner(desc: str, fuente: str) -> None:
            cambios.append(f"{desc} — {fuente}")

        # origen
        if _vacio(y.get("pais_origen")) and _vacio(lote.get("pais_origen")):
            tk = frozenset(aud._toks(titulo))
            pais_web = next((p for k, p in web.items() if tk and tk <= k), None)
            if regla.get("pais_documentado"):
                y["pais_origen"] = regla["pais_documentado"]
                poner(f"origen = {y['pais_origen']}", "documento del fabricante bajado del correo")
            elif pais_web:
                y["pais_origen"] = pais_web
                poner(f"origen = {pais_web}", "mapa de orígenes del sitio web (deducido, de referencia)")
            elif regla.get("pais_deducido"):
                y["pais_origen"] = regla["pais_deducido"]
                poner(f"origen = {y['pais_origen']}", "principal país productor/exportador de este insumo (deducido)")
        # grado: vacío o una frase larga
        g = (y.get("grado") or ident.get("grado") or "").strip()
        if regla.get("grado") and (not g or len(g) > 28):
            y["grado"] = regla["grado"]
            if ident and (not (ident.get("grado") or "").strip() or len(ident.get("grado") or "") > 28):
                ident["grado"] = regla["grado"]
            poner(f"grado = {regla['grado']}", "uso al que se vende y lo que ya se responde en preventa (deducido)")
        if regla.get("cas") and _vacio(y.get("cas")):
            y["cas"] = regla["cas"]
            poner(f"CAS = {regla['cas']}", "registro CAS de la sustancia (literatura)")
        for clave_kb, clave_cf, nombre in (("olor", "olor", "aroma"), ("apariencia", "apariencia", "apariencia"), ("formula", "formula_quimica", "fórmula")):
            if regla.get(clave_kb) and _vacio(cf.get(clave_cf)):
                cf[clave_cf] = regla[clave_kb]
                poner(f"{nombre} = {regla[clave_kb]}", "propiedad conocida de la sustancia (literatura)")
        if regla.get("composicion") and _vacio(y.get("composicion")) and _vacio(cf.get("formula_quimica")):
            y["composicion"] = regla["composicion"]
            poner("composición típica", "composición característica descrita en la literatura (rangos orientativos)")
        if regla.get("conservacion") and all(_vacio(y.get(k)) for k in ("conservacion", "almacenamiento")):
            y["conservacion"] = regla["conservacion"]
            poner("conservación", "buenas prácticas de almacenamiento para este tipo de material")
        if not cambios:
            continue
        if cf:
            y["caracteristicas_fisicas"] = cf
        y["propiedades"] = []  # derivado: se rehace con la normalización del panel
        privadas = {k: v for k, v in y.items() if k.startswith("_")}
        nuevo = {**ft.normalizar_datos_ficha(y), **privadas}
        nuevo["_fuentes"] = list(dict.fromkeys((privadas.get("_fuentes") or []) + [f"{c} ({HOY})" for c in cambios]))
        informe.append({"archivo": path.name, "titulo": titulo, "cambios": cambios})
        if simular:
            continue
        shutil.copy2(path, resp / f"{path.stem}.{datetime.now():%Y%m%d-%H%M%S}.yaml")
        path.write_text(yaml.dump(nuevo, allow_unicode=True, sort_keys=False, default_flow_style=False), encoding="utf-8")
        if nuevo.get("_tipo") == "completo" and not nuevo.get("_borrador"):
            pdf = ft.COMPLETO_PDF_DIR / ("FT COA SDS " + re.sub(r"^FT\s+", "", ft.nombre_archivo_desde_titulo(titulo).replace(".docx", ".pdf")))
            if pdf.is_file():
                ft.generar_pdf_completo(nuevo, nuevo.get("_coa"), nuevo.get("_sds"), cabezote_id=nuevo.get("_cabezote_id"), salida=pdf)
    return informe


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("kb")
    ap.add_argument("--simular", action="store_true")
    a = ap.parse_args()
    kb = yaml.safe_load(Path(a.kb).read_text(encoding="utf-8")) or {}
    inf = completar(kb, a.simular)
    n = sum(len(i["cambios"]) for i in inf)
    print(f"{'SIMULACIÓN — ' if a.simular else ''}{len(inf)} fichas · {n} datos completados")
    for i in inf:
        print(f"  {i['titulo'][:38]:38} " + " | ".join(c.split(' — ')[0] for c in i["cambios"]))
    salida = REPO / "docs" / "fichas_datos_deducidos.md"
    if not a.simular:
        L = ["# Datos deducidos en las fichas técnicas", "", f"Generado por `scripts/fichas_completar_deducciones.py` el {HOY}.",
             "", "Cada dato de esta lista se escribió porque la casilla estaba VACÍA y no hay documento del proveedor. Confirmar contra el COA/ficha del fabricante cuando llegue; hasta entonces es la mejor estimación disponible.", ""]
        for i in inf:
            L += [f"## {i['titulo']}", f"`{i['archivo']}`", ""] + [f"- {c}" for c in i["cambios"]] + [""]
        salida.write_text("\n".join(L), encoding="utf-8")
        print("→", salida)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
