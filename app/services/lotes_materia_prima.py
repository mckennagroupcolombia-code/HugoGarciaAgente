"""
Historial de lotes de materia prima por producto (SKU/referencia): fabricante,
país de origen, fechas y documentos (FT/COA) asociados a cada lote recibido.

Se apoya en el mismo archivo de mapeo por producto que ya usa
`app.services.documentos_catalogo` (documentos_producto.json), agregando una
lista `lotes` por referencia. No reemplaza ese registro (ft/coa/sds "vigente"
por producto): añade la dimensión temporal/por-lote que faltaba.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services.documentos_catalogo import _guardar_mapa, _leer_mapa

ESTADOS_VALIDOS = ("nuevo", "actualizado", "sin_cambios")

# Sin 0/O/1/I ni vocales que formen palabras raras — pensado para imprimir en
# la etiqueta del producto y que el cliente lo transcriba sin ambigüedad.
_ALFABETO_CODIGO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_LARGO_CODIGO = 6

# Número de lote: 3 letras + 3 dígitos al azar (ej. GXO765) — nada de
# prefijos derivados del nombre del producto, para que sea corto y fácil de
# transcribir por el cliente en /verificar (acepta lote o código, cualquiera
# de los dos sirve).
_ALFABETO_LOTE_LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_ALFABETO_LOTE_DIGITOS = "23456789"


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _ref_key(ref: str) -> str:
    key = (ref or "").strip().upper()
    if not key:
        raise ValueError("Se requiere ref (SKU / referencia interna)")
    return key


def _normalizar_codigo(codigo: str) -> str:
    return re.sub(r"\s+", "", (codigo or "").strip().upper())


def lote_vigente(ref: str) -> dict[str, Any] | None:
    """Último lote marcado vigente=True para esa referencia, o None."""
    prod = _leer_mapa().get("productos", {}).get(_ref_key(ref), {})
    for lote in reversed(prod.get("lotes") or []):
        if lote.get("vigente"):
            return lote
    return None


def listar_lotes(ref: str) -> list[dict[str, Any]]:
    """Historial completo (más reciente primero) para una referencia."""
    prod = _leer_mapa().get("productos", {}).get(_ref_key(ref), {})
    return list(reversed(prod.get("lotes") or []))


def _codigo_en_uso(codigo: str, productos: dict) -> bool:
    codigo_n = _normalizar_codigo(codigo)
    for prod in productos.values():
        for lote in prod.get("lotes") or []:
            if _normalizar_codigo(lote.get("codigo_verificacion") or "") == codigo_n:
                return True
    return False


def _generar_codigo_verificacion(productos: dict) -> str:
    """Código corto listo para imprimir en la etiqueta (ver Studio Etiquetas)."""
    for _ in range(50):
        candidato = "".join(secrets.choice(_ALFABETO_CODIGO) for _ in range(_LARGO_CODIGO))
        if not _codigo_en_uso(candidato, productos):
            return candidato
    raise RuntimeError("No se pudo generar un código de verificación único")


def _lote_numero_en_uso(lote_numero: str, productos: dict) -> bool:
    ln = (lote_numero or "").strip().upper()
    for prod in productos.values():
        for lote in prod.get("lotes") or []:
            if (lote.get("lote_numero") or "").strip().upper() == ln:
                return True
    return False


def _generar_lote_numero(productos: dict) -> str:
    """Número de lote corto y aleatorio (3 letras + 3 dígitos, ej. GXO765),
    único en todo el sistema — el cliente puede usarlo indistintamente del
    código de verificación en /verificar."""
    for _ in range(50):
        letras = "".join(secrets.choice(_ALFABETO_LOTE_LETRAS) for _ in range(3))
        digitos = "".join(secrets.choice(_ALFABETO_LOTE_DIGITOS) for _ in range(3))
        candidato = f"{letras}{digitos}"
        if not _lote_numero_en_uso(candidato, productos):
            return candidato
    raise RuntimeError("No se pudo generar un número de lote único")


def _inferir_estado(anterior: dict[str, Any] | None, lote_numero: str, fabricante: str) -> str:
    if not anterior:
        return "nuevo"
    if (anterior.get("lote_numero") or "").strip().lower() == (lote_numero or "").strip().lower():
        return "sin_cambios"
    if (anterior.get("fabricante") or "").strip().lower() == (fabricante or "").strip().lower():
        return "actualizado"
    return "nuevo"


def registrar_lote(
    ref: str,
    *,
    lote_numero: str = "",
    fabricante: str = "",
    pais_origen: str = "",
    fecha_fabricacion: str = "",
    fecha_vencimiento: str = "",
    fecha_recepcion: str = "",
    estado: str | None = None,
    ft_link: str = "",
    coa_link: str = "",
    codigo_verificacion: str = "",
    nombre_producto: str | None = None,
) -> dict[str, Any]:
    """
    Registra un lote nuevo en el historial de la referencia. Si `estado` no se
    indica explícitamente, se infiere comparando contra el último lote vigente
    (mismo número de lote → "sin_cambios"; mismo fabricante pero lote distinto
    → "actualizado"; fabricante distinto (o sin historial previo) → "nuevo").
    Marca el lote anterior como no vigente.

    Si no se indica `lote_numero`, se genera uno corto y aleatorio (3 letras
    + 3 dígitos, ej. GXO765), único en todo el sistema. Si no se indica
    `codigo_verificacion`, se genera otro corto aparte (mismo formato de
    alfabeto). En /verificar el cliente puede usar cualquiera de los dos.
    """
    ref_key = _ref_key(ref)

    data = _leer_mapa()
    productos = data.setdefault("productos", {})
    prod = productos.setdefault(ref_key, {"ref": ref_key})
    if nombre_producto:
        prod["nombre"] = nombre_producto

    lotes = prod.setdefault("lotes", [])

    lote_numero = (lote_numero or "").strip()
    if not lote_numero:
        lote_numero = _generar_lote_numero(productos)

    anterior = lotes[-1] if lotes else None
    if estado not in ESTADOS_VALIDOS:
        estado = _inferir_estado(anterior, lote_numero, fabricante)

    for l in lotes:
        l["vigente"] = False

    codigo_verificacion = (codigo_verificacion or "").strip()
    if not codigo_verificacion:
        codigo_verificacion = _generar_codigo_verificacion(productos)

    entry = {
        "lote_numero": lote_numero,
        "estado": estado,
        "fabricante": (fabricante or "").strip(),
        "pais_origen": (pais_origen or "").strip(),
        "fecha_fabricacion": (fecha_fabricacion or "").strip(),
        "fecha_vencimiento": (fecha_vencimiento or "").strip(),
        "fecha_recepcion": (fecha_recepcion or "").strip() or _ahora_iso()[:10],
        "codigo_verificacion": codigo_verificacion,
        "ft_webViewLink": (ft_link or "").strip(),
        "coa_webViewLink": (coa_link or "").strip(),
        "vigente": True,
        "registrado_en": _ahora_iso(),
    }
    lotes.append(entry)
    prod["updated_at"] = _ahora_iso()
    _guardar_mapa(data)
    return entry


def buscar_lote_publico(codigo: str) -> dict[str, Any] | None:
    """
    Búsqueda para la página pública de verificación: acepta indistintamente el
    código de verificación o el número de lote (ambos impresos en la
    etiqueta) — el cliente puede escribir cualquiera de los dos. Retorna
    {ref, nombre, lote} o None.
    """
    codigo_n = _normalizar_codigo(codigo)
    if not codigo_n:
        return None
    productos = _leer_mapa().get("productos", {})
    for ref_key, prod in productos.items():
        for lote in prod.get("lotes") or []:
            if _normalizar_codigo(lote.get("codigo_verificacion") or "") == codigo_n:
                return {"ref": ref_key, "nombre": prod.get("nombre") or "", "lote": lote}
            if _normalizar_codigo(lote.get("lote_numero") or "") == codigo_n:
                return {"ref": ref_key, "nombre": prod.get("nombre") or "", "lote": lote}
    return None


def _catalogo_siigo_para_match() -> list[dict[str, str]]:
    try:
        from app.services.siigo import _combo_item_desde_raw, listar_productos_combo_siigo

        raw_list = listar_productos_combo_siigo()
        return [_combo_item_desde_raw(r) for r in raw_list if r.get("active", True)]
    except Exception:
        return []


_CODIGOS_EAN_PATH = Path(__file__).resolve().parents[1] / "data" / "etiquetas_codigos_ean.json"


def _catalogo_codigos_ean_para_match() -> list[dict[str, str]]:
    """SKU↔nombre ya registrados en Códigos EAN (Studio Etiquetas) — cubre
    productos con etiqueta/código de barras asignado que no siempre están
    activos en el catálogo Siigo."""
    import json

    try:
        data = json.loads(_CODIGOS_EAN_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = data.get("codigos") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        ref = (it.get("sku") or "").strip()
        nombre = (it.get("nombre_producto") or "").strip()
        if ref and nombre:
            out.append({"ref": ref, "name": nombre})
    return out


def _catalogo_productos_para_match() -> list[dict[str, str]]:
    """Combina Siigo + Códigos EAN — cualquiera de los dos alcanza para
    resolver el SKU de una ficha técnica que no trae referencia guardada."""
    return _catalogo_siigo_para_match() + _catalogo_codigos_ean_para_match()


_UNIDADES_TAMANO = {"kg", "g", "gr", "ml", "mg", "lb", "lt", "l", "oz"}
_RE_TOKEN_TAMANO = re.compile(
    r"^\d+(" + "|".join(sorted(_UNIDADES_TAMANO, key=len, reverse=True)) + r")$"
)


def _es_token_tamano(token: str) -> bool:
    """Reconoce tokens de tamaño/presentación (500g, 250ml, 1kg, kg, ml…)
    para distinguir "mismo ingrediente en otra presentación" de "otro
    producto". Exige una unidad reconocida al final (no cualquier dígito +
    letras) — un token como "80p" (ej. Tween 80P vs Tween 20, potencias
    distintas, NO tamaños) no debe colarse como si fuera tamaño."""
    return bool(_RE_TOKEN_TAMANO.match(token)) or token in _UNIDADES_TAMANO


_STOPWORDS_MATCH_LOTE = frozenset({"de", "del", "para", "la", "el", "los", "las", "y", "en", "con"})


def _tokens_producto_para_match(nombre: str) -> list[str]:
    """Tokeniza un nombre de producto para resolver su referencia por
    nombre. A propósito NO reutiliza `drive_documentos._palabras_clave`
    (pensada para búsqueda de PDFs en Drive): esa función descarta cualquier
    token de 2 caracteres o menos, lo que fusiona productos realmente
    distintos que solo se diferencian por un sufijo corto — "VITAMINA B3"
    vs "VITAMINA C" vs "VITAMINA E" quedan todas como {"vitamina"}, y
    "POLISORBATO 20" pierde el "20" que lo distingue de "POLISORBATO 80P".
    Aquí solo se filtran conectores genéricos, conservando tokens cortos
    que sí distinguen identidad de producto."""
    from app.services.drive_documentos import normalizar_nombre_producto

    palabras = normalizar_nombre_producto(nombre).split()
    return [p for p in palabras if p and p not in _STOPWORDS_MATCH_LOTE]


def _resolver_referencias_por_nombre(nombre_producto: str, catalogo: list[dict[str, str]]) -> list[str]:
    """
    Si la ficha técnica no trae referencia/SKU guardada, busca por nombre en
    el catálogo Siigo. Conservador: exige que TODAS las palabras clave del
    nombre de la ficha estén en el nombre del producto Siigo.

    Un mismo ingrediente suele tener varios SKUs por presentación (250g,
    500g, 1kg…) — vienen del mismo lote físico reenvasado, así que se
    devuelven TODOS esos matches (para compartir el mismo lote/código). Se
    excluyen productos combinados que agregan otro ingrediente distinto
    (ej. "Citrato Potasio 250g Magnesio 250g"): si las palabras "extra" del
    candidato frente al nombre buscado no son todas de tamaño/presentación,
    se descarta ese candidato por ambigüedad real de producto — salvo que
    TODOS los candidatos con esa palabra "extra" compartan exactamente el
    mismo descriptor (ej. "extracto", "vegetal", "refinada"): ahí no hay
    ambigüedad real, es el mismo producto con un descriptor que la ficha no
    incluye. Si hay descriptores distintos entre candidatos (ej. "alto peso"
    vs "bajo peso", "tween 20" vs "tween 80"), sí son productos distintos y
    se descarta todo.
    """
    claves = set(_tokens_producto_para_match(nombre_producto))
    if not claves:
        return []
    limpios: list[str] = []
    con_modificador: list[tuple[str, frozenset]] = []
    for it in catalogo:
        claves_it = set(_tokens_producto_para_match(it.get("name") or ""))
        if not claves_it or not claves.issubset(claves_it):
            continue
        ref = (it.get("ref") or "").strip()
        if not ref:
            continue
        extra = claves_it - claves
        no_tamano = frozenset(t for t in extra if not _es_token_tamano(t))
        if not no_tamano:
            limpios.append(ref)
        else:
            con_modificador.append((ref, no_tamano))

    if limpios:
        return limpios

    grupos = {g for _, g in con_modificador}
    if len(grupos) == 1:
        return [ref for ref, _ in con_modificador]
    return []


def generar_lotes_faltantes() -> dict[str, list[dict[str, Any]]]:
    """
    Recorre las fichas técnicas ya guardadas (YAML en fichas_word/datos/) y
    registra un lote autogenerado — con fabricante/país de origen ya cargados
    en la ficha, si existen — para cada producto (por referencia/SKU) que
    todavía no tenga ningún lote en su historial. No duplica: si ya hay un
    lote (de cualquier estado), se omite. Si la ficha no trae referencia
    guardada (común en fichas antiguas), la busca por nombre en Siigo y en
    Códigos EAN (Studio Etiquetas) antes de omitirla.
    """
    from app.services.ficha_tecnica import DATOS_DIR, cargar_datos_desde_archivo

    creados: list[dict[str, Any]] = []
    omitidos: list[dict[str, Any]] = []
    if not DATOS_DIR.is_dir():
        return {"creados": creados, "omitidos": omitidos}

    catalogo = _catalogo_productos_para_match()
    vistos: set[str] = set()
    archivos = sorted(DATOS_DIR.glob("*.yaml")) + sorted(DATOS_DIR.glob("*.yml"))
    for p in archivos:
        if p.name.startswith("plantilla") or p.stem.startswith("coa_") or p.stem.startswith("sds_"):
            continue
        try:
            d = cargar_datos_desde_archivo(p)
        except Exception:
            omitidos.append({"archivo": p.name, "motivo": "no se pudo leer el archivo"})
            continue

        nombre = (d.get("nombre_producto") or d.get("titulo") or "").strip()
        referencia = (d.get("referencia") or "").strip()
        resuelta_por_nombre = False
        referencias: list[str] = [referencia] if referencia else []
        if not referencia and nombre and catalogo:
            referencias = _resolver_referencias_por_nombre(nombre, catalogo)
            resuelta_por_nombre = bool(referencias)
        if not referencias or not nombre:
            omitidos.append({
                "archivo": p.name,
                "motivo": (
                    "sin referencia o nombre de producto (y no se encontró un match único "
                    "en Siigo/Códigos EAN)"
                ),
            })
            continue

        # Varias presentaciones (250g/500g/1kg…) del mismo ingrediente
        # comparten un único lote/código — se genera una sola vez y se
        # replica en las demás referencias del mismo grupo.
        fabricante = (d.get("fabricante") or "").strip()
        pais_origen = (d.get("pais_origen") or "").strip()
        lote_compartido: str | None = None
        codigo_compartido: str | None = None
        for referencia in referencias:
            ref_key = referencia.strip().upper()
            if ref_key in vistos:
                continue
            vistos.add(ref_key)

            if lote_vigente(referencia):
                omitidos.append({"archivo": p.name, "ref": referencia, "motivo": "ya tiene lote registrado"})
                continue

            entry = registrar_lote(
                referencia,
                lote_numero=lote_compartido or "",
                fabricante=fabricante,
                pais_origen=pais_origen,
                nombre_producto=nombre,
                codigo_verificacion=codigo_compartido or "",
            )
            lote_compartido = lote_compartido or entry["lote_numero"]
            codigo_compartido = codigo_compartido or entry["codigo_verificacion"]
            creados.append({
                "ref": referencia,
                "nombre": nombre,
                "lote_numero": entry["lote_numero"],
                "codigo_verificacion": entry["codigo_verificacion"],
                "referencia_inferida": resuelta_por_nombre,
            })

    return {"creados": creados, "omitidos": omitidos}
