# -*- coding: utf-8 -*-
"""Grupos de trabajo: un canal del equipo vinculado a un módulo del panel.

Cada canal puede tener un `modulo` (COA y fichas técnicas → Documentos técnicos,
Fórmulas, Solicitudes de pago, Compras en el exterior → Importaciones, Guías de
envío). Un mensaje puede llevar en `ref` el elemento concreto del módulo del que se
habla —{"modulo", "id", "titulo", "detalle"}— y el chat lo pinta como un enlace que
abre ese módulo.

`buscar()` ofrece los candidatos para vincular. Respeta los permisos del panel: quien
no ve Solicitudes de pago no puede buscar pagos desde el chat. Sin LLM.
"""
from __future__ import annotations

import os
import sqlite3
from typing import Any

MODULOS: dict[str, dict[str, str]] = {
    "documentos_tecnicos": {"nombre": "Documentos técnicos", "panel": "fichas", "item": "Documento técnico"},
    "formulas": {"nombre": "Fórmulas", "panel": "formulas", "item": "Fórmula"},
    "solicitudes_pago": {"nombre": "Solicitudes de pago", "panel": "pagos", "item": "Solicitud de pago"},
    "importaciones": {"nombre": "Compras en el exterior", "panel": "logistica-importaciones", "item": "Importación",
                      # Los procesos de importación ya son solicitudes con esta categoría: el grupo los muestra.
                      "categoria": "importaciones"},
    "guias_envio": {"nombre": "Guías de envío", "panel": "guias-envio", "item": "Guía"},
}

_LIMITE = 25

# «Solicitar a…» en un grupo: el tipo clasifica la solicitud. `categoria` es la de tickets
# (las que ya existen en producción); el tipo fino queda en canal_solicitudes.tipo.
TIPOS_SOLICITUD: dict[str, dict[str, str]] = {
    "pago": {"nombre": "Pago", "categoria": "contabilidad", "modulo": "solicitudes_pago"},
    "compra": {"nombre": "Compra", "categoria": "compras", "modulo": "importaciones"},
    "publicacion": {"nombre": "Publicación", "categoria": "ventas", "modulo": ""},
    "etiqueta": {"nombre": "Etiqueta", "categoria": "diseno", "modulo": ""},
    "documento_tecnico": {"nombre": "Documento técnico", "categoria": "diseno", "modulo": "documentos_tecnicos"},
    "formula": {"nombre": "Fórmula", "categoria": "produccion", "modulo": "formulas"},
    "envio": {"nombre": "Envío", "categoria": "logistica", "modulo": "guias_envio"},
    "otra": {"nombre": "Otra", "categoria": "logistica", "modulo": ""},
}

# El tipo que propone cada grupo según su módulo.
TIPO_POR_MODULO = {
    "solicitudes_pago": "pago",
    "importaciones": "compra",
    "documentos_tecnicos": "documento_tecnico",
    "formulas": "formula",
    "guias_envio": "envio",
}


def tipos_solicitud() -> list[dict]:
    return [{"clave": k, **v} for k, v in TIPOS_SOLICITUD.items()]


def catalogo() -> list[dict]:
    return [{"clave": k, **v, "tipo_solicitud": TIPO_POR_MODULO.get(k, "otra")} for k, v in MODULOS.items()]


def puede_usar(usuario: dict | None, modulo: str) -> bool:
    info = MODULOS.get(modulo)
    if not info:
        return False
    try:
        from app.services.acceso_paneles import puede_ver_panel

        return bool(puede_ver_panel(usuario, info["panel"]))
    except Exception:
        return False


def normalizar_ref(ref: Any) -> dict | None:
    """El enlace que manda el panel con un mensaje: solo módulos conocidos y textos cortos."""
    if not isinstance(ref, dict):
        return None
    modulo = str(ref.get("modulo") or "").strip()
    rid = str(ref.get("id") or "").strip()[:80]
    if modulo not in MODULOS or not rid:
        return None
    return {
        "modulo": modulo,
        "id": rid,
        "titulo": str(ref.get("titulo") or "").strip()[:160] or f"{MODULOS[modulo]['item']} {rid}",
        "detalle": str(ref.get("detalle") or "").strip()[:200],
    }


def _coincide(q: str, *textos: Any) -> bool:
    if not q:
        return True
    return any(q in str(t or "").lower() for t in textos)


def _documentos(q: str) -> list[dict]:
    from app.services.ficha_tecnica import listar_yaml_datos

    items = sorted(listar_yaml_datos(), key=lambda d: d.get("guardado_at") or "", reverse=True)
    return [
        {"id": d["id"], "titulo": d.get("titulo") or d["id"], "detalle": "Borrador" if d.get("borrador") else "Documento técnico"}
        for d in items if _coincide(q, d.get("titulo"), d.get("id"))
    ]


def _formulas(q: str) -> list[dict]:
    from app.services import formulas_db

    out = []
    for f in formulas_db.listar():
        if not _coincide(q, f.get("nombre"), f.get("id")):
            continue
        n = len(f.get("ingredientes") or [])
        out.append({"id": str(f.get("id")), "titulo": f.get("nombre") or str(f.get("id")),
                    "detalle": f"{n} ingrediente{'s' if n != 1 else ''}"})
    return out


def _pagos(q: str) -> list[dict]:
    import app.services.contabilidad_core as cc
    from app.services import pagos_wizard

    ruta = os.path.abspath(pagos_wizard._DB_PATH)
    con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        filas = con.execute(
            "SELECT id, concepto, monto, estado, fecha, tercero_id FROM cc_solicitudes_pago "
            "WHERE COALESCE(es_plantilla,0)=0 ORDER BY fecha DESC, id DESC LIMIT 300"
        ).fetchall()
    finally:
        con.close()
    nombres: dict[int, str] = {}
    out = []
    for r in filas:
        tid = r["tercero_id"]
        if tid and tid not in nombres:
            try:
                nombres[tid] = (cc.obtener_tercero(int(tid)) or {}).get("nombre") or ""
            except Exception:
                nombres[tid] = ""
        tercero = nombres.get(tid, "") if tid else ""
        if not _coincide(q, r["id"], f"#{r['id']}", r["concepto"], tercero):
            continue
        monto = f"${float(r['monto'] or 0):,.0f}".replace(",", ".")
        out.append({
            "id": str(r["id"]),
            "titulo": f"#{r['id']} · {tercero or r['concepto'] or 'Sin tercero'}",
            "detalle": " · ".join(x for x in (r["concepto"] if tercero else "", monto, r["estado"] or "") if x),
        })
    return out


def _importaciones(q: str, usuario: dict) -> list[dict]:
    from app.services.tickets_db import listar_tickets
    from app.tools.importaciones import CATEGORIA_IMPORTACIONES

    out = []
    for t in listar_tickets(usuario, {"categoria": CATEGORIA_IMPORTACIONES}) or []:
        num = t.get("numero") or t.get("id")
        if not _coincide(q, t.get("titulo"), num, t.get("descripcion")):
            continue
        out.append({"id": str(t.get("id")), "titulo": f"{num} · {t.get('titulo') or 'Importación'}",
                    "detalle": str(t.get("estado") or "").replace("_", " ")})
    return out


def _guias(q: str) -> list[dict]:
    from app.tools.guias_envio import historial

    out = []
    for g in historial(30):
        if not _coincide(q, g.get("destinatario"), g.get("ciudad"), g.get("guia"), g.get("pedido_id")):
            continue
        partes = [f"Guía {g['guia']}" if g.get("guia") else "", f"pedido {g['pedido_id']}" if g.get("pedido_id") else "",
                  g.get("canal") or "", str(g.get("creado_en") or "")[:10]]
        out.append({"id": str(g.get("id")),
                    "titulo": " · ".join(x for x in (g.get("destinatario"), g.get("ciudad")) if x) or f"Rótulo {g.get('id')}",
                    "detalle": " · ".join(x for x in partes if x)})
    return out


def buscar(modulo: str, q: str, usuario: dict) -> list[dict]:
    """Candidatos para vincular en un mensaje. PermissionError si el usuario no ve ese módulo."""
    if modulo not in MODULOS:
        raise ValueError("Módulo desconocido")
    if not puede_usar(usuario, modulo):
        raise PermissionError(f"No tienes acceso a {MODULOS[modulo]['nombre']}")
    q = (q or "").strip().lower()
    if modulo == "documentos_tecnicos":
        items = _documentos(q)
    elif modulo == "formulas":
        items = _formulas(q)
    elif modulo == "solicitudes_pago":
        items = _pagos(q)
    elif modulo == "importaciones":
        items = _importaciones(q, usuario)
    else:
        items = _guias(q)
    return items[:_LIMITE]
