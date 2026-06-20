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
        "category_id": "MCO8830",
        "domain_id": "MCO-SUPPLEMENTS",
        "line": "Citrato de Magnesio",
        "family_name_ejemplo": "Citrato De Magnesio Puro 500 G",
        "evitar": ["sal de magnesio", "suplemento", "MCO-SALT", "LINE: Sal"],
        "incluir": ["materia prima", "polvo puro", "formulación", "Res. 2674"],
    },
    "citrato_magnesio_1kg": {
        "nombre": "Citrato de magnesio 1kg (competidor activo)",
        "url": "https://www.mercadolibre.com.co/citrato-de-magnesio-1000-gramos-1000-gr-1000-gr-en-polvo-puro-1-kilo-1kg-1kg/up/MCOU3415632539",
        "item_id_ejemplo": "MCO1670758887",
        "category_id": "MCO8830",
        "domain_id": "MCO-SUPPLEMENTS",
        "line": "Citrato de Magnesio",
        "family_name_ejemplo": "Citrato De Magnesio 1000 Gramos Polvo Puro 1 Kilo",
        "evitar": ["sal de magnesio", "suplemento", "MCO-SALT", "LINE: Sal"],
        "incluir": ["materia prima", "polvo puro", "formulación", "Res. 2674"],
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


def listar_watchlist(solo_activos: bool = True) -> dict:
    data = _cargar_watchlist()
    pubs = data.get("publicaciones", [])
    if solo_activos:
        pubs = [p for p in pubs if p.get("seguimiento_activo", True)]
    enriched = []
    for p in pubs:
        row = dict(p)
        row["url_meli"] = permalink_meli(row.get("item_id", ""), row.get("permalink", ""))
        enriched.append(row)
    return {
        "publicaciones": enriched,
        "total": len(enriched),
        "ultima_revision_global": data.get("ultima_revision_global"),
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
) -> dict:
    """Agrega o actualiza una publicación en la watchlist de monitoreo."""
    data = _cargar_watchlist()
    pubs: list[dict] = data.setdefault("publicaciones", [])
    existente = next((p for p in pubs if p.get("item_id") == item_id), None)
    ref = REFERENCIAS_COMPETIDOR.get(referencia, {})

    entrada = {
        "id": existente.get("id") if existente else str(uuid.uuid4())[:12],
        "item_id": item_id,
        "sku": sku,
        "nombre": nombre,
        "permalink": permalink,
        "item_origen_id": item_origen_id,
        "referencia_competidor": referencia,
        "referencia_url": ref.get("url", ""),
        "categoria_catalogo": categoria_catalogo,
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
        pubs[idx] = entrada
    else:
        pubs.append(entrada)

    _guardar_watchlist(data)
    _log_evento({"tipo": "registro_seguimiento", "item_id": item_id, "sku": sku})
    return entrada


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
    stock: int = 10,
    contenido_generado: Optional[dict] = None,
    categoria_catalogo: str = "",
    dry_run: bool = False,
) -> dict:
    """
    Crea una publicación MeLi nueva desde cero (modelo User Product / competidor activo)
    y la registra para seguimiento diario.

    Usar cuando la publicación anterior está prohibida y no se puede corregir por API.
    """
    from app.tools.meli_compliance import (
        buscar_publicaciones_pausadas,
        crear_publicacion_meli,
        diagnosticar_riesgo,
        generar_contenido_compliance,
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
        from app.tools.meli_compliance import obtener_item_meli, _foto_desde_item, _precio_desde_item
        item_referencia = obtener_item_meli(item_origen_id)
        if item_referencia:
            if not titulo_actual:
                titulo_actual = item_referencia.get("title") or item_referencia.get("family_name") or ""
            if precio <= 0:
                precio = _precio_desde_item(item_referencia, precio)
                resultado["precio_resuelto"] = precio
            if not foto_url:
                foto_url = _foto_desde_item(item_referencia)
                if foto_url:
                    resultado["foto_resuelta"] = True

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
    if perfil == "materia_prima_alimentaria":
        atrs["category_id"] = ref.get("category_id") or "MCO8830"
        atrs["LINE"] = ref.get("line") or atrs.get("LINE") or "Materias primas alimentarias"
        atrs["domain_id"] = ref.get("domain_id") or "MCO-SUPPLEMENTS"
    contenido["atributos"] = atrs
    perfil_info_cat = atrs.get("category_id", "MCO8830")

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
        usar_user_product=True,
        presentacion=presentacion,
        nombre=nombre,
        item_referencia=item_referencia,
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
        notas="Creada por compliance monitor — publicación nueva",
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
