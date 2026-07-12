"""
Seguimiento agentico de publicaciones MeLi compliance — McKenna Group.

- Registra publicaciones nuevas creadas con contenido compliant
- Revision diaria: estado, sub_status, diagnostico de riesgo
- Alertas WhatsApp si pasan a forbidden/paused/under_review
- Plantilla de referencia basada en competidores activos (materia prima)
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import requests

from app.utils import enviar_whatsapp_reporte, jid_grupo_alertas_sistemas_wa, refrescar_token_meli

_APP_DIR = Path(__file__).resolve().parent.parent
_WATCHLIST_PATH = _APP_DIR / "data" / "meli_compliance_watchlist.json"
_LOG_PATH = _APP_DIR / "data" / "meli_compliance_monitor_log.jsonl"

# Referencia: competidor activo citrato magnesio 500g (Banquete / similares)
REFERENCIAS_COMPETIDOR: dict[str, dict] = {
    "citrato_magnesio": {
        "nombre": "Citrato de magnesio 500g (competidor activo)",
        "url": "https://www.mercadolibre.com.co/citrato-de-magnesio-puro-500-g/up/MCOU3419731823",
        "item_id_ejemplo": "MCO3127214600",
        "category_id": "MCO441116",
        "domain_id": "",
        "line": "Materias primas alimentarias",
        "family_name_ejemplo": "Citrato De Magnesio Puro 500 G",
        "evitar": ["sal de magnesio", "suplemento", "MCO-SALT", "LINE: Sal", "MCO8830", "MCO-SUPPLEMENTS"],
        "incluir": ["materia prima", "polvo puro", "formulación", "Res. 2674"],
        "nota": "Competidor histórico en MCO8830; McKenna NO publica en suplementos.",
    },
    "citrato_magnesio_1kg": {
        "nombre": "Citrato de magnesio 1kg (competidor activo)",
        "url": "https://www.mercadolibre.com.co/citrato-de-magnesio-1000-gramos-1000-gr-1000-gr-en-polvo-puro-1-kilo-1kg-1kg/up/MCOU3415632539",
        "item_id_ejemplo": "MCO1670758887",
        "category_id": "MCO441116",
        "domain_id": "",
        "line": "Materias primas alimentarias",
        "family_name_ejemplo": "Citrato De Magnesio 1000 Gramos Polvo Puro 1 Kilo",
        "evitar": ["sal de magnesio", "suplemento", "MCO-SALT", "LINE: Sal", "MCO8830", "MCO-SUPPLEMENTS"],
        "incluir": ["materia prima", "polvo puro", "formulación", "Res. 2674"],
        "nota": "Competidor histórico en MCO8830; McKenna NO publica en suplementos.",
    },
}

def _ahora_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _cargar_watchlist() -> dict:
    if _WATCHLIST_PATH.exists():
        try:
            with open(_WATCHLIST_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"publicaciones": [], "ultima_revision_global": None}


def _guardar_watchlist(data: dict) -> None:
    _WATCHLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_WATCHLIST_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _log_evento(evento: dict) -> None:
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps({**evento, "ts": _ahora_iso()}, ensure_ascii=False) + "\n")


def listar_watchlist(solo_activos: bool = True, origen: str = "") -> dict:
    data = _cargar_watchlist()
    pubs = data.get("publicaciones", [])
    if solo_activos:
        pubs = [p for p in pubs if p.get("seguimiento_activo", True)]
    origen_f = (origen or "").strip().lower()
    enriched = []
    for p in pubs:
        row = dict(p)
        # Inferir origen en entradas viejas sin el campo
        if not row.get("origen"):
            row["origen"] = "reemplazo" if (row.get("item_origen_id") or "").strip() else "desde_cero"
        if origen_f and row.get("origen") != origen_f:
            continue
        row["url_meli"] = permalink_meli(row.get("item_id", ""), row.get("permalink", ""))
        enriched.append(row)
    # Más recientes primero
    enriched.sort(key=lambda x: x.get("creado_en") or "", reverse=True)
    return {
        "publicaciones": enriched,
        "total": len(enriched),
        "ultima_revision_global": data.get("ultima_revision_global"),
        "origen_filtro": origen_f or None,
    }


def permalink_meli(item_id: str = "", permalink: str = "") -> str:
    """URL pública del artículo en MeLi (para abrir en navegador)."""
    if permalink:
        u = permalink.strip()
        if u.startswith("http://"):
            return "https://" + u[7:]
        if not u.startswith("https://"):
            return "https://" + u
        return u
    iid = (item_id or "").strip()
    if not iid:
        return ""
    return f"https://articulo.mercadolibre.com.co/{iid}"


def _prioridad_reemplazo(entry: dict) -> tuple:
    """Mayor = preferir como reemplazo vigente del SKU."""
    status = (entry.get("estado_actual") or "").lower()
    sub = [str(s).lower() for s in (entry.get("sub_status") or [])]
    activo = 3 if status == "active" else (1 if status == "paused" else 0)
    if "forbidden" in sub:
        activo = -1
    seguimiento = 1 if entry.get("seguimiento_activo", True) else 0
    return (activo, seguimiento, entry.get("creado_en") or "")


def indice_reemplazos() -> dict:
    """
    Índice de publicaciones compliance creadas como reemplazo.
    by_sku: mejor reemplazo por SKU · by_origen: reemplazo que sustituye ítem viejo.
    """
    pubs = listar_watchlist(solo_activos=False).get("publicaciones", [])
    by_sku: dict[str, dict] = {}
    by_origen: dict[str, dict] = {}
    for p in pubs:
        p = dict(p)
        p["url_meli"] = permalink_meli(p.get("item_id", ""), p.get("permalink", ""))
        sku = (p.get("sku") or "").strip()
        if sku:
            prev = by_sku.get(sku)
            if not prev or _prioridad_reemplazo(p) > _prioridad_reemplazo(prev):
                by_sku[sku] = p
        origen = (p.get("item_origen_id") or "").strip()
        if origen:
            by_origen[origen] = p
    return {"by_sku": by_sku, "by_origen": by_origen, "todas": pubs}


def resumen_reemplazo(entry: Optional[dict]) -> Optional[dict]:
    if not entry:
        return None
    return {
        "item_id": entry.get("item_id", ""),
        "permalink": entry.get("permalink", ""),
        "url_meli": entry.get("url_meli") or permalink_meli(
            entry.get("item_id", ""), entry.get("permalink", ""),
        ),
        "estado_actual": entry.get("estado_actual", "unknown"),
        "sub_status": entry.get("sub_status") or [],
        "item_origen_id": entry.get("item_origen_id", ""),
        "sku": entry.get("sku", ""),
        "nombre": entry.get("nombre", ""),
        "ultima_revision": entry.get("ultima_revision"),
        "creado_en": entry.get("creado_en"),
        "nivel_riesgo": entry.get("nivel_riesgo"),
    }


def registrar_seguimiento(
    *,
    item_id: str,
    sku: str,
    nombre: str,
    permalink: str = "",
    item_origen_id: str = "",
    referencia: str = "citrato_magnesio",
    categoria_catalogo: str = "",
    notas: str = "",
    origen: str = "",
    precio: float = 0,
    presentacion: str = "",
    perfil: str = "",
) -> dict:
    """Agrega o actualiza una publicación en la watchlist de monitoreo."""
    data = _cargar_watchlist()
    pubs: list[dict] = data.setdefault("publicaciones", [])
    existente = next((p for p in pubs if p.get("item_id") == item_id), None)
    ref = REFERENCIAS_COMPETIDOR.get(referencia, {})

    origen_norm = (origen or "").strip().lower()
    if origen_norm not in ("desde_cero", "reemplazo"):
        origen_norm = "reemplazo" if (item_origen_id or "").strip() else "desde_cero"

    entrada = {
        "id": existente.get("id") if existente else str(uuid.uuid4())[:12],
        "item_id": item_id,
        "sku": sku,
        "nombre": nombre,
        "permalink": permalink,
        "item_origen_id": item_origen_id,
        "origen": origen_norm,
        "referencia_competidor": referencia,
        "referencia_url": ref.get("url", ""),
        "categoria_catalogo": categoria_catalogo,
        "precio": float(precio or 0) or (existente.get("precio") if existente else 0),
        "presentacion": presentacion or (existente.get("presentacion") if existente else ""),
        "perfil": perfil or (existente.get("perfil") if existente else ""),
        "creado_en": existente.get("creado_en") if existente else _ahora_iso(),
        "ultima_revision": None,
        "estado_actual": "unknown",
        "sub_status": [],
        "nivel_riesgo": None,
        "score_riesgo": None,
        "seguimiento_activo": True,
        "notas": notas,
        "historial": existente.get("historial", []) if existente else [],
        "alertas_enviadas": existente.get("alertas_enviadas", []) if existente else [],
    }

    if existente:
        idx = pubs.index(existente)
        # Conservar revisión previa si re-registramos el mismo item
        entrada["ultima_revision"] = existente.get("ultima_revision")
        entrada["estado_actual"] = existente.get("estado_actual") or "unknown"
        entrada["sub_status"] = existente.get("sub_status") or []
        entrada["nivel_riesgo"] = existente.get("nivel_riesgo")
        entrada["score_riesgo"] = existente.get("score_riesgo")
        pubs[idx] = entrada
    else:
        pubs.append(entrada)

    _guardar_watchlist(data)
    _log_evento({"tipo": "registro_seguimiento", "item_id": item_id, "sku": sku, "origen": origen_norm})
    return entrada


def eliminar_de_watchlist(
    *,
    item_id: str = "",
    entry_id: str = "",
) -> dict:
    """
    Quita una entrada del historial/watchlist local.
    No cierra ni elimina la publicación en Mercado Libre.
    """
    iid = (item_id or "").strip()
    eid = (entry_id or "").strip()
    if not iid and not eid:
        return {"ok": False, "error": "Indica item_id o id de la entrada"}

    data = _cargar_watchlist()
    pubs: list[dict] = data.get("publicaciones") or []
    antes = len(pubs)
    removed: list[dict] = []
    kept: list[dict] = []
    for p in pubs:
        match = False
        if eid and str(p.get("id") or "") == eid:
            match = True
        elif iid and str(p.get("item_id") or "") == iid:
            match = True
        if match:
            removed.append(p)
        else:
            kept.append(p)

    if not removed:
        return {"ok": False, "error": "No se encontró la publicación en el historial"}

    data["publicaciones"] = kept
    _guardar_watchlist(data)
    _log_evento({
        "tipo": "eliminar_watchlist",
        "item_id": removed[0].get("item_id"),
        "id": removed[0].get("id"),
        "sku": removed[0].get("sku"),
    })
    return {
        "ok": True,
        "eliminados": len(removed),
        "restantes": len(kept),
        "antes": antes,
        "item_id": removed[0].get("item_id"),
        "nombre": removed[0].get("nombre"),
        "nota": "Quitada del historial local. La publicación en MeLi no se cerró.",
    }


def _headers_meli() -> Optional[dict]:
    token = refrescar_token_meli()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _fetch_item(item_id: str) -> Optional[dict]:
    headers = _headers_meli()
    if not headers:
        return None
    try:
        r = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}",
            headers=headers,
            timeout=12,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def _fetch_descripcion(item_id: str) -> str:
    headers = _headers_meli()
    if not headers:
        return ""
    try:
        r = requests.get(
            f"https://api.mercadolibre.com/items/{item_id}/description",
            headers=headers,
            timeout=10,
        )
        if r.status_code == 200:
            body = r.json()
            return body.get("plain_text") or body.get("text") or ""
    except Exception:
        pass
    return ""


def _estado_critico(status: str, sub_status: list) -> bool:
    sub = [str(s).lower() for s in (sub_status or [])]
    if "forbidden" in sub:
        return True
    return status in {"under_review", "closed"}


def revisar_publicacion_watch(entry: dict) -> dict:
    """Revisa una entrada de watchlist contra MeLi en vivo."""
    from app.tools.meli_compliance import _extraer_line_item, _extraer_sku_item, diagnosticar_riesgo

    item_id = entry.get("item_id", "")
    item = _fetch_item(item_id)
    if not item:
        return {
            "item_id": item_id,
            "ok": False,
            "error": "No se pudo leer el ítem en MeLi",
            "alerta": True,
        }

    status = item.get("status", "")
    sub = item.get("sub_status") or []
    desc = _fetch_descripcion(item_id)
    diag = diagnosticar_riesgo(
        sku=entry.get("sku") or _extraer_sku_item(item),
        nombre=entry.get("nombre", ""),
        titulo_meli=item.get("title") or item.get("family_name", ""),
        descripcion=desc,
        atributos_meli={
            "domain_id": item.get("domain_id", ""),
            "LINE": _extraer_line_item(item),
        },
    )

    alerta = _estado_critico(status, sub) or diag.get("nivel") == "alto"
    revision = {
        "fecha": _ahora_iso(),
        "status": status,
        "sub_status": sub,
        "nivel_riesgo": diag.get("nivel"),
        "score_riesgo": diag.get("score"),
        "alerta": alerta,
        "permalink": item.get("permalink", ""),
        "señales": diag.get("señales", [])[:6],
    }

    entry["ultima_revision"] = revision["fecha"]
    entry["estado_actual"] = status
    entry["sub_status"] = sub
    entry["nivel_riesgo"] = diag.get("nivel")
    entry["score_riesgo"] = diag.get("score")
    entry["permalink"] = item.get("permalink", entry.get("permalink", ""))
    entry.setdefault("historial", []).append(revision)
    entry["historial"] = entry["historial"][-60:]

    return {
        "item_id": item_id,
        "ok": True,
        "revision": revision,
        "diagnostico": diag,
        "alerta": alerta,
    }


def revisar_watchlist_diaria(enviar_whatsapp: bool = True) -> dict:
    """
    Revision diaria de todas las publicaciones en seguimiento.
    Envía alerta WhatsApp al grupo de sistemas si hay problemas nuevos.
    """
    data = _cargar_watchlist()
    pubs = [p for p in data.get("publicaciones", []) if p.get("seguimiento_activo", True)]
    resultados: list[dict] = []
    alertas_nuevas: list[dict] = []

    for entry in pubs:
        res = revisar_publicacion_watch(entry)
        resultados.append(res)
        if res.get("alerta"):
            clave = f"{entry['item_id']}:{res.get('revision', {}).get('status')}"
            ya = entry.get("alertas_enviadas", [])
            if clave not in ya:
                alertas_nuevas.append({**res, "nombre": entry.get("nombre"), "sku": entry.get("sku")})
                ya.append(clave)
                entry["alertas_enviadas"] = ya[-20:]

    data["ultima_revision_global"] = _ahora_iso()
    _guardar_watchlist(data)

    reporte = {
        "ok": True,
        "revisadas": len(resultados),
        "alertas": len(alertas_nuevas),
        "activas": sum(1 for r in resultados if r.get("revision", {}).get("status") == "active"),
        "problemas": sum(1 for r in resultados if r.get("alerta")),
        "resultados": resultados,
        "timestamp": _ahora_iso(),
    }
    _log_evento({"tipo": "revision_diaria", **{k: reporte[k] for k in ("revisadas", "alertas", "activas", "problemas")}})

    if enviar_whatsapp and alertas_nuevas and os.getenv("AGENTE_COMPLIANCE_MONITOR_SKIP_WA") != "1":
        lineas = [
            "🔴 *MeLi Compliance — alerta diaria*",
            "",
            f"Publicaciones con problema: *{len(alertas_nuevas)}*",
            "",
        ]
        for a in alertas_nuevas[:8]:
            rev = a.get("revision", {})
            lineas.append(
                f"• `{a.get('sku', '?')}` — {a.get('nombre', '')[:40]}\n"
                f"  {a.get('item_id')} · {rev.get('status')} {rev.get('sub_status')}\n"
                f"  Riesgo: {rev.get('nivel_riesgo')} ({rev.get('score_riesgo')}/10)"
            )
        lineas.append("\nPanel → Publicaciones → Republicar en MeLi")
        try:
            enviar_whatsapp_reporte("\n".join(lineas), jid_grupo_alertas_sistemas_wa())
        except Exception as e:
            reporte["whatsapp_error"] = str(e)

    return reporte


def crear_publicacion_nueva_compliance(
    *,
    sku: str,
    nombre: str,
    presentacion: str,
    precio: float,
    perfil: str = "materia_prima_alimentaria",
    ficha_tecnica: str = "",
    titulo_actual: str = "",
    descripcion_actual: str = "",
    item_origen_id: str = "",
    referencia: str = "citrato_magnesio",
    foto_url: Optional[str] = None,
    foto_urls: Optional[list] = None,
    stock: int = 10,
    contenido_generado: Optional[dict] = None,
    categoria_catalogo: str = "",
    category_id: str = "",
    domain_id: str = "",
    line: str = "",
    taxonomia_item_id: str = "",
    dry_run: bool = False,
) -> dict:
    """
    Crea una publicación MeLi nueva desde cero (modelo User Product / competidor activo)
    y la registra para seguimiento diario.

    Usar cuando la publicación anterior está prohibida y no se puede corregir por API.
    taxonomia_item_id: ítem MeLi de referencia solo para heredar category_id/domain/LINE
    (p. ej. al duplicar desde historial); no implica reemplazo.
    """
    from app.tools.meli_compliance import (
        buscar_publicaciones_pausadas,
        crear_publicacion_meli,
        diagnosticar_riesgo,
        generar_contenido_compliance,
        obtener_item_meli,
        _extraer_line_item,
        PERFILES,
        es_category_id_meli,
        es_domain_id_meli,
        es_taxonomia_suplementos,
        normalizar_category_id_meli,
        predecir_categoria_meli,
        CATEGORIA_FALLBACK_SIN_SUPLEMENTOS,
    )
    from app.utils import obtener_seller_id_meli

    resultado: dict[str, Any] = {
        "sku": sku,
        "nombre": nombre,
        "timestamp": _ahora_iso(),
        "referencia": REFERENCIAS_COMPETIDOR.get(referencia, {}),
        "diagnostico_origen": None,
        "contenido_generado": None,
        "publicacion": None,
        "seguimiento": None,
        "paso_fallido": None,
        "advertencias": [],
    }

    # Verificar activas existentes
    headers = _headers_meli()
    if headers and sku:
        try:
            seller = obtener_seller_id_meli()
            r = requests.get(
                f"https://api.mercadolibre.com/users/{seller}/items/search",
                params={"seller_sku": sku, "status": "active", "limit": 10},
                headers=headers,
                timeout=12,
            )
            activas = r.json().get("results", []) if r.status_code == 200 else []
            if activas:
                resultado["advertencias"].append(
                    f"Ya hay {len(activas)} publicación(es) activa(s) con SKU {sku}: {activas[:3]}"
                )
        except Exception:
            pass

    pausadas = buscar_publicaciones_pausadas(incluir_pausadas=False)
    forbidden_mismo_sku = [
        i for i in pausadas.get("items", [])
        if i.get("sku") == sku and "forbidden" in (i.get("sub_status") or [])
    ]
    if forbidden_mismo_sku:
        resultado["advertencias"].append(
            f"Hay {len(forbidden_mismo_sku)} publicación(es) prohibida(s) del mismo SKU "
            "(se creará una nueva; conviene cerrar las viejas cuando MeLi lo permita)."
        )

    if titulo_actual or descripcion_actual:
        resultado["diagnostico_origen"] = diagnosticar_riesgo(
            sku=sku,
            nombre=nombre,
            titulo_meli=titulo_actual,
            descripcion=descripcion_actual,
        )

    item_referencia = None
    if item_origen_id:
        from app.tools.meli_compliance import obtener_item_meli, _fotos_desde_item, _precio_desde_item
        item_referencia = obtener_item_meli(item_origen_id)
        if item_referencia:
            if not titulo_actual:
                titulo_actual = item_referencia.get("title") or item_referencia.get("family_name") or ""
            if precio <= 0:
                precio = _precio_desde_item(item_referencia, precio)
                resultado["precio_resuelto"] = precio
            if not foto_url and not foto_urls:
                fotos_ref = _fotos_desde_item(item_referencia)
                if fotos_ref:
                    foto_urls = fotos_ref
                    foto_url = fotos_ref[0]
                    resultado["foto_resuelta"] = True
                    resultado["fotos_resueltas"] = len(fotos_ref)
    if precio <= 0 and not dry_run:
        resultado["paso_fallido"] = "precio: no se pudo determinar precio (> 0 COP requerido)"
        return resultado

    contenido = contenido_generado
    if not contenido or contenido.get("error"):
        contenido = generar_contenido_compliance(
            sku=sku,
            nombre=nombre,
            presentacion=presentacion,
            perfil=perfil,
            ficha_tecnica=ficha_tecnica,
            titulo_actual=titulo_actual,
            descripcion_actual=descripcion_actual,
        )
    if not contenido or contenido.get("error"):
        resultado["paso_fallido"] = f"generacion_contenido: {contenido.get('error', 'error')}"
        return resultado
    resultado["contenido_generado"] = contenido

    ref = REFERENCIAS_COMPETIDOR.get(referencia, {})
    atrs = dict(contenido.get("atributos") or {})

    # La IA suele devolver category_id=MCO8830 (suplementos). NUNCA confiar en eso
    # si hay taxonomía de un ítem de referencia (duplicar) o category_id explícito.
    atrs.pop("category_id", None)

    cat_explicita = (category_id or "").strip()
    domain_explicito = (domain_id or "").strip()
    line_explicita = (line or "").strip()

    # Prioridad: taxonomía del ítem duplicado (si NO es suplementos)
    tax_id = (taxonomia_item_id or "").strip()
    item_tax = None
    item_attrs_src = None
    if tax_id:
        item_tax = obtener_item_meli(tax_id)
        if item_tax and not item_tax.get("error"):
            item_attrs_src = item_tax
            cat_tax = (item_tax.get("category_id") or "").strip()
            dom_tax = (item_tax.get("domain_id") or "").strip()
            if es_taxonomia_suplementos(cat_tax, dom_tax):
                resultado["advertencias"] = list(resultado.get("advertencias") or [])
                resultado["advertencias"].append(
                    f"La referencia {tax_id} está en suplementos ({cat_tax}); "
                    "se predice otra categoría alimentaria (nunca MCO8830)."
                )
            else:
                cat_explicita = cat_tax or cat_explicita
                domain_explicito = dom_tax or domain_explicito
                line_explicita = _extraer_line_item(item_tax) or line_explicita
                resultado["taxonomia_desde"] = tax_id

    if not cat_explicita and item_referencia:
        cat_ref = (item_referencia.get("category_id") or "").strip()
        dom_ref = (item_referencia.get("domain_id") or "").strip()
        if not es_taxonomia_suplementos(cat_ref, dom_ref):
            cat_explicita = cat_ref
            if not domain_explicito:
                domain_explicito = dom_ref
            if not line_explicita:
                line_explicita = _extraer_line_item(item_referencia)
        if not item_attrs_src:
            item_attrs_src = item_referencia

    # Rechazar suplementos aunque vengan en el body
    if es_taxonomia_suplementos(cat_explicita, domain_explicito):
        cat_explicita = ""
        domain_explicito = ""

    if cat_explicita and not es_category_id_meli(cat_explicita):
        if es_domain_id_meli(cat_explicita) and not domain_explicito:
            domain_explicito = cat_explicita
        cat_explicita = ""

    fallback_cat = CATEGORIA_FALLBACK_SIN_SUPLEMENTOS
    if ref.get("category_id") and not es_taxonomia_suplementos(str(ref.get("category_id")), str(ref.get("domain_id") or "")):
        fallback_cat = str(ref.get("category_id"))
    perfil_cat = PERFILES.get(perfil, {}).get("categoria_meli")
    if perfil_cat and not es_taxonomia_suplementos(str(perfil_cat), ""):
        fallback_cat = str(perfil_cat) or fallback_cat

    if cat_explicita and es_category_id_meli(cat_explicita) and not es_taxonomia_suplementos(cat_explicita, domain_explicito):
        dom_src = domain_explicito if es_domain_id_meli(domain_explicito) and not es_taxonomia_suplementos("", domain_explicito) else ""
        cat_final, dom_final = normalizar_category_id_meli(
            cat_explicita,
            domain_id=dom_src,
            fallback=cat_explicita,
        )
        atrs["category_id"] = cat_final
        if dom_final:
            atrs["domain_id"] = dom_final
        if line_explicita:
            atrs["LINE"] = line_explicita
        elif perfil == "materia_prima_alimentaria" and not atrs.get("LINE"):
            atrs["LINE"] = ref.get("line") or "Materias primas alimentarias"
    else:
        # Predecir (excluye suplementos) o Almacén > Otros
        titulo_pred = (
            (contenido.get("titulo") or "").strip()
            or f"{nombre} {presentacion}".strip()
            or nombre
        )
        pred = predecir_categoria_meli(
            titulo_pred,
            perfil=perfil,
            presentacion=presentacion,
        )
        resultado["prediccion_categoria"] = {
            k: pred.get(k)
            for k in (
                "ok", "category_id", "domain_id", "category_name", "line", "model",
                "consulta", "error", "fallback_sin_suplementos", "nota",
            )
            if k in pred
        }
        if pred.get("ok") and es_category_id_meli(str(pred.get("category_id") or "")):
            cat_final = str(pred["category_id"])
            dom_final = str(pred.get("domain_id") or "")
            if es_taxonomia_suplementos(cat_final, dom_final):
                cat_final = CATEGORIA_FALLBACK_SIN_SUPLEMENTOS
                dom_final = ""
            atrs["category_id"] = cat_final
            if dom_final and es_domain_id_meli(dom_final):
                atrs["domain_id"] = dom_final
            else:
                atrs.pop("domain_id", None)
            if pred.get("line"):
                atrs["LINE"] = pred["line"]
            elif perfil == "materia_prima_alimentaria":
                atrs["LINE"] = atrs.get("LINE") or "Materias primas alimentarias"
            if pred.get("model"):
                atrs.setdefault("MODEL", pred["model"])
        else:
            atrs["category_id"] = CATEGORIA_FALLBACK_SIN_SUPLEMENTOS
            atrs.pop("domain_id", None)
            atrs["LINE"] = atrs.get("LINE") or "Materias primas alimentarias"
            atrs.setdefault("MODEL", (nombre or titulo_pred or "Materia prima")[:60])

    contenido["atributos"] = atrs
    perfil_info_cat = atrs.get("category_id") or fallback_cat
    if (
        not es_category_id_meli(str(perfil_info_cat))
        or es_taxonomia_suplementos(str(perfil_info_cat), str(atrs.get("domain_id") or ""))
    ):
        perfil_info_cat = CATEGORIA_FALLBACK_SIN_SUPLEMENTOS
        atrs["category_id"] = perfil_info_cat
        atrs.pop("domain_id", None)
        contenido["atributos"] = atrs

    # Ítem para heredar atributos (MODEL, BRAND): duplicado > origen (aunque taxonomía sea suplementos)
    item_attrs = item_attrs_src or item_referencia
    if item_attrs:
        for aid in ("MODEL", "BRAND"):
            for a in item_attrs.get("attributes") or []:
                if a.get("id") == aid and (a.get("value_name") or "").strip():
                    atrs.setdefault(aid, a["value_name"].strip())
                    break
        contenido["atributos"] = atrs

    # Atributos exigidos por Almacén > Otros
    if str(perfil_info_cat) == CATEGORIA_FALLBACK_SIN_SUPLEMENTOS:
        atrs.setdefault("MANUFACTURER", "McKenna Group")
        atrs.setdefault("PRODUCT_NAME", (nombre or contenido.get("titulo") or sku or "Materia prima")[:60])
        atrs.setdefault("MODEL", atrs.get("PRODUCT_NAME") or nombre or "Materia prima")
        contenido["atributos"] = atrs

    resultado["category_id_usado"] = perfil_info_cat
    resultado["domain_id_usado"] = atrs.get("domain_id")
    resultado["line_usada"] = atrs.get("LINE")
    resultado["model_usado"] = atrs.get("MODEL")
    if es_taxonomia_suplementos(str(perfil_info_cat), str(atrs.get("domain_id") or "")):
        resultado["paso_fallido"] = "categoria: se bloqueó publicación en suplementos"
        return resultado

    if dry_run:
        resultado["publicacion"] = {
            "dry_run": True,
            "family_name": contenido.get("titulo", "")[:60],
            "category_id": perfil_info_cat,
            "mensaje": "Simulación — no se publicó en MeLi",
        }
        return resultado

    pub = crear_publicacion_meli(
        sku=sku,
        titulo=contenido["titulo"],
        descripcion=contenido["descripcion"],
        precio=precio,
        categoria_id=perfil_info_cat,
        atributos_compliance=contenido.get("atributos", {}),
        stock=stock,
        foto_url=foto_url,
        foto_urls=foto_urls,
        usar_user_product=True,
        presentacion=presentacion,
        nombre=nombre,
        item_referencia=item_attrs,
    )
    resultado["publicacion"] = pub

    if not pub.get("ok"):
        resultado["paso_fallido"] = f"publicacion_meli: {pub.get('error', 'error desconocido')}"
        return resultado

    seg = registrar_seguimiento(
        item_id=pub["item_id"],
        sku=sku,
        nombre=nombre,
        permalink=pub.get("permalink", ""),
        item_origen_id=item_origen_id,
        referencia=referencia,
        categoria_catalogo=categoria_catalogo,
        notas=(
            "Creada desde cero (panel Publicaciones)"
            if not (item_origen_id or "").strip()
            else "Creada por compliance monitor — publicación nueva (reemplazo)"
        ),
        origen="reemplazo" if (item_origen_id or "").strip() else "desde_cero",
        precio=precio,
        presentacion=presentacion,
        perfil=perfil,
    )
    resultado["seguimiento"] = seg

    data = _cargar_watchlist()
    entry = next((p for p in data.get("publicaciones", []) if p.get("item_id") == pub["item_id"]), seg)
    rev = revisar_publicacion_watch(entry)
    _guardar_watchlist(data)
    resultado["seguimiento"] = entry
    resultado["revision_inicial"] = rev

    _log_evento({
        "tipo": "publicacion_nueva",
        "item_id": pub.get("item_id"),
        "sku": sku,
        "origen": item_origen_id,
    })
    return resultado


def obtener_plantilla_referencia(clave: str = "citrato_magnesio") -> dict:
    return REFERENCIAS_COMPETIDOR.get(clave, {})
