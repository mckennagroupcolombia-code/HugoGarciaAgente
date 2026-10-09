"""Descripción comercial-educativa de cada producto en la tienda web (oct-2026).

Un párrafo de ~70 palabras que se redacta con la IA a partir del documento
técnico publicado (FT + COA): qué es, de dónde y cómo se obtiene, sus
propiedades, para qué se usa y cómo. Se guarda en
`PAGINA_WEB/site/data/descripciones_web.json` por documento, con una firma de
los campos de origen: si el documento cambia, el párrafo se vuelve a redactar.

- La ficha de producto lo muestra cuando el producto no trae descripción propia
  y, si falta o está vencido, pide redactarlo en segundo plano (`asegurar_en_segundo_plano`).
- `python -m app.services.descripcion_web [--forzar] [--autorizar-gasto-usd N] [nombre…]`
  los redacta todos (≈ US$0,003 por párrafo; más de 25 llamadas pide autorizar el gasto).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

RUTA = Path(__file__).resolve().parents[2] / "PAGINA_WEB" / "site" / "data" / "descripciones_web.json"
PALABRAS = 70
_MIN, _MAX = 60, 80

#: Promesas médicas o dosis para ingerir: la descripción de una tienda no las lleva.
_RE_MEDICO = re.compile(
    r"\b(laxante\w*|purgante\w*|cura\w*|curativ\w*|tratamiento\w*|tratar\b|trata\b|enfermedad\w*|"
    r"antiinflamatori\w*|antibacterian\w*|antimicrobian\w*|antisépti\w*|antifúngic\w*|"
    r"medicinal\w*|terapéutic\w*|síntoma\w*|digesti[óo]n|estreñimiento|"
    r"(ingiere|ingerir|toma|tomar|consume|consumir)\s+(de\s+)?\d|dosis|en ayunas|est[óo]mago vac[ií]o)\b",
    re.IGNORECASE,
)

_lock = threading.Lock()
_en_curso: set[str] = set()
_cache: dict = {"mtime": None, "datos": {}}


def _leer() -> dict:
    try:
        mtime = RUTA.stat().st_mtime
    except OSError:
        return {}
    if _cache["mtime"] != mtime:
        try:
            _cache["datos"] = json.loads(RUTA.read_text(encoding="utf-8")) or {}
        except (OSError, ValueError):
            _cache["datos"] = {}
        _cache["mtime"] = mtime
    return _cache["datos"]


def _guardar(clave: str, entrada: dict) -> None:
    with _lock:
        try:
            datos = json.loads(RUTA.read_text(encoding="utf-8")) if RUTA.exists() else {}
        except (OSError, ValueError):
            datos = {}
        datos[clave] = entrada
        tmp = RUTA.with_suffix(".tmp")
        tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        tmp.replace(RUTA)


def _fuente(doc: dict) -> dict:
    """Solo los datos del documento que alimentan el párrafo (y su firma)."""
    ft, coa = doc.get("ft") or {}, doc.get("coa") or {}

    def pares(v):
        return [f"{a}: {b}" for a, b in (v or []) if a and b]

    return {
        "producto": (ft.get("titulo") or doc.get("titulo") or "").strip(),
        "sinonimos": ft.get("sinonimos") or "",
        "inci": coa.get("inci") or "",
        "grado": coa.get("grado") or "",
        "origen": ft.get("pais_origen") or coa.get("pais_origen") or "",
        "concentracion": ft.get("concentracion") or "",
        "descripcion": ft.get("descripcion") or "",
        "caracteristicas": pares(ft.get("propiedades")),
        "propiedades": pares(ft.get("propiedades_extra")),
        "modo_uso": ft.get("modo_uso") or "",
        "conservacion": ft.get("conservacion") or "",
    }


def _clave(doc: dict) -> str:
    return (doc.get("clave") or doc.get("referencia") or doc.get("titulo") or "").strip()


def _firma(fuente: dict) -> str:
    return hashlib.sha1(json.dumps(fuente, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def descripcion_para(doc: dict | None) -> str:
    """Párrafo guardado para ese documento ('' si aún no hay)."""
    if not doc:
        return ""
    return (_leer().get(_clave(doc)) or {}).get("texto") or ""


def _contar(t: str) -> int:
    return len(re.findall(r"\S+", t or ""))


def _prompt(f: dict, aviso: str = "") -> str:
    from app.services.documento_cientifico import _con_regla_proceso, es_solo_cosmetico

    datos = "\n".join(
        f"- {k}: {'; '.join(v) if isinstance(v, list) else v}" for k, v in f.items() if v
    )
    reglas_grado = (
        "Es de grado cosmético: SOLO uso externo. Prohibido sugerir ingerirlo, tomarlo, "
        "cocinar con él o usarlo como suplemento."
        if es_solo_cosmetico(f.get("grado", ""))
        else "Respeta el grado indicado; no sugieras usos de otro grado."
    )
    p = f"""Redacta la descripción comercial y educativa de un producto para la tienda en línea
de un proveedor colombiano de materias primas para cosmética, alimentos y formulación artesanal.

DATOS DEL DOCUMENTO TÉCNICO (única fuente; no inventes datos que no estén aquí):
{datos}

REGLAS:
- Un solo párrafo en español de Colombia, de {PALABRAS} palabras (entre {_MIN + 5} y {_MAX - 5}).
- Comercial y educativo: qué es y cómo se obtiene, qué lo hace valioso (propiedades),
  en qué productos o preparaciones se usa y un consejo práctico de uso.
- Tono cercano y profesional, tuteando al lector. Sin títulos, viñetas, comillas, emojis,
  precios, nombres de marca ni llamados como «compra ya».
- Nada de promesas médicas o terapéuticas (curar, tratar, prevenir enfermedades,
  laxante, antiinflamatorio, antibacteriano, efectos en el organismo) ni dosis para
  ingerir, aunque el documento las mencione. Habla de usos y propiedades cosméticas,
  culinarias o funcionales.
- {reglas_grado}
- Devuelve solo el párrafo."""
    p = _con_regla_proceso(p, f.get("producto", ""))
    return p + (f"\n{aviso}" if aviso else "")


def redactar(doc: dict) -> str:
    """Pide el párrafo a la IA; reintenta una vez si se sale del rango de palabras."""
    from app.services.documento_cientifico import _sintetizar_texto

    f = _fuente(doc)
    mejor, aviso = "", ""
    for _ in range(3):
        t = re.sub(r"\s+", " ", _sintetizar_texto(_prompt(f, aviso))).strip().strip('"«»')
        t = re.sub(r"[*_`#]+", "", t)  # la web lo muestra como texto plano, sin Markdown
        n = _contar(t)
        medico = _RE_MEDICO.search(t)
        if medico:
            aviso = (f"OJO: tu respuesta anterior decía «{medico.group(0)}»: prohibido "
                     "hablar de efectos médicos o dosis para ingerir. Reescríbela.")
            continue
        if _MIN <= n <= _MAX:
            return t
        if not mejor or abs(n - PALABRAS) < abs(_contar(mejor) - PALABRAS):
            mejor = t
        aviso = f"OJO: tu respuesta anterior tenía {n} palabras; debe tener {PALABRAS}."
    if 50 <= _contar(mejor) <= 90:
        return mejor
    raise RuntimeError(f"la IA no respetó las {PALABRAS} palabras ({_contar(mejor)})")


def actualizar(doc: dict, *, forzar: bool = False) -> str | None:
    """Redacta y guarda el párrafo si falta o el documento cambió. Devuelve el texto nuevo."""
    clave = _clave(doc)
    if not clave:
        return None
    f = _fuente(doc)
    firma = _firma(f)
    previo = _leer().get(clave) or {}
    if not forzar and previo.get("firma") == firma and previo.get("texto"):
        return None
    texto = redactar(doc)
    _guardar(clave, {
        "texto": texto,
        "palabras": _contar(texto),
        "producto": f["producto"],
        "referencia": doc.get("referencia") or "",
        "firma": firma,
        "fecha": datetime.now().isoformat(timespec="seconds"),
    })
    return texto


def asegurar_en_segundo_plano(doc: dict | None) -> None:
    """Desde la ficha pública: si falta o está vencido, se redacta en otro hilo
    (la visita no espera a la IA; el párrafo sale en la siguiente)."""
    if not doc:
        return
    clave = _clave(doc)
    previo = _leer().get(clave) or {}
    if not clave or clave in _en_curso:
        return
    if previo.get("texto") and previo.get("firma") == _firma(_fuente(doc)):
        return
    _en_curso.add(clave)

    def _run():
        try:
            actualizar(doc)
        except Exception as exc:
            log.warning("Descripción web de %s no generada: %s", clave, exc)
        finally:
            _en_curso.discard(clave)

    threading.Thread(target=_run, daemon=True, name=f"desc-web-{clave[:20]}").start()


if __name__ == "__main__":
    import sys

    try:  # fuera de systemd (EnvironmentFile) la clave de la IA viene del .env
        from dotenv import load_dotenv
        load_dotenv(RUTA.parents[3] / ".env")
    except ImportError:
        pass
    from app.services.documentos_web import listar_documentos_completos_web

    args = sys.argv[1:]
    forzar = "--forzar" in args
    if "--autorizar-gasto-usd" in args:  # decisión humana: tope de gasto de este lote
        from app.services.llm_budget import autorizar_lote

        i = args.index("--autorizar-gasto-usd")
        autorizar_lote(float(args[i + 1]), "descripciones web desde documento técnico")
        del args[i:i + 2]
    solo = [a for a in args if not a.startswith("--")]
    docs = listar_documentos_completos_web(forzar=True)
    ok = err = igual = 0
    for d in docs:
        if solo and not any(s.lower() in f"{d.get('titulo') or ''} {_clave(d)}".lower() for s in solo):
            continue
        try:
            t = actualizar(d, forzar=forzar)
        except Exception as exc:
            err += 1
            print(f"✗ {d.get('titulo')}: {exc}", flush=True)
            continue
        if t:
            ok += 1
            print(f"✓ {d.get('titulo')} ({_contar(t)} palabras)", flush=True)
        else:
            igual += 1
    print(f"Listo: {ok} redactadas, {igual} sin cambios, {err} con error, de {len(docs)} documentos.")
