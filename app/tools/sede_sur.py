"""
Herramientas SEDE SUR: gestión de tickets y tareas internas del equipo McKenna.
Se llaman directamente desde routes.py (sin pasar por tool-use del LLM)
y también quedan registradas como tools de Claude para escalación futura.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime
from typing import Optional

_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tickets.db")

_BOT_USERNAME = "hugo_ia_bot"
_BOT_NOMBRE = "Hugo IA"

# Misión TICKETS SEDE MCKENNA en reino MCKENNA (ID fijo, creado en el panel)
_MISION_SEDE_SUR_ID = 24

# ── Keywords para inferencia de categoría ────────────────────────────────────

_CATEGORIA_KEYWORDS: list[tuple[str, list[str]]] = [
    ("ventas",      ["publicar", "publicación", "producto", "precio", "meli", "mercadolibre",
                     "ventas", "venta", "listing", "anuncio"]),
    ("compras",     ["comprar", "compra", "materia prima", "proveedor", "pedido", "reposicion",
                     "reposición", "pedir", "adquirir", "stock", "inventario"]),
    ("logistica",   ["caja", "cajas", "despacho", "envio", "envío", "entrega", "recibir",
                     "llegan", "llega", "usa", "china", "importacion", "importación",
                     "recepcion", "recepción", "bodega"]),
    ("mantenimiento", ["reparar", "mantenimiento", "arreglar", "dañado", "roto", "falla",
                       "máquina", "equipo", "instalacion"]),
    ("rrhh",        ["permiso", "vacaciones", "ausencia", "turno", "horario", "contrato",
                     "nómina", "nomina"]),
    ("contabilidad", ["factura", "pago", "cobro", "recaudo", "cuenta", "contabilidad"]),
]

_PRIORIDAD_KEYWORDS: dict[str, list[str]] = {
    "urgente": ["urgente", "urgente!", "ahora", "inmediato", "ya", "hoy mismo", "emergencia"],
    "alta":    ["importante", "pronto", "rápido", "rapido", "prioritario", "esta semana"],
    "baja":    ["cuando puedas", "sin afán", "sin afan", "luego", "tranquilo"],
}


def _inferir_categoria(texto: str) -> str:
    texto_lower = texto.lower()
    for categoria, keywords in _CATEGORIA_KEYWORDS:
        if any(kw in texto_lower for kw in keywords):
            return categoria
    return "logistica"


def _inferir_prioridad(texto: str) -> str:
    texto_lower = texto.lower()
    for prioridad, keywords in _PRIORIDAD_KEYWORDS.items():
        if any(kw in texto_lower for kw in keywords):
            return prioridad
    return "media"


# ── Usuario bot (Hugo IA) ─────────────────────────────────────────────────────

def _bot_usuario_id() -> int:
    """Obtiene o crea el usuario bot Hugo IA para crear tickets en nombre del agente."""
    from app.services.tickets_db import listar_usuarios, crear_usuario

    for u in listar_usuarios():
        if u.get("username") == _BOT_USERNAME:
            return u["id"]

    # Crear rol y depto por defecto si es necesario
    with sqlite3.connect(_DB_PATH) as db:
        db.row_factory = sqlite3.Row
        rol = db.execute("SELECT id FROM roles ORDER BY nivel ASC LIMIT 1").fetchone()
        rol_id = rol["id"] if rol else 1

    usuario, err = crear_usuario(
        nombre=_BOT_NOMBRE,
        username=_BOT_USERNAME,
        password=f"Hugo_IA_Bot_{os.urandom(8).hex()}",
        rol_id=rol_id,
        departamento_id=None,
    )
    return usuario["id"] if usuario else 1


# ── Búsqueda de usuario ───────────────────────────────────────────────────────

def buscar_usuario_por_nombre(nombre: str) -> dict | None:
    """
    Busca un usuario por nombre (fuzzy) o por número de teléfono.
    Acepta menciones nativas de WhatsApp (e.g. '278275326791853') buscando
    por el campo phone/telefono del usuario.
    """
    from app.services.tickets_db import listar_usuarios

    nombre_q = nombre.strip().lower()
    if not nombre_q:
        return None

    usuarios = listar_usuarios()

    # 0. Si parece un número de teléfono (mención nativa WA), buscar por teléfono
    if nombre_q.isdigit() and len(nombre_q) >= 8:
        for u in usuarios:
            telefono = str(u.get("telefono") or u.get("phone") or "").replace("+", "").replace(" ", "")
            if telefono and (telefono in nombre_q or nombre_q.endswith(telefono[-9:])):
                return u

    # 1. Exacto
    for u in usuarios:
        if u.get("nombre", "").lower() == nombre_q:
            return u
    # 2. Inicio de nombre o apellido
    for u in usuarios:
        partes = u.get("nombre", "").lower().split()
        if any(p.startswith(nombre_q) for p in partes):
            return u
    # 3. Substring
    for u in usuarios:
        if nombre_q in u.get("nombre", "").lower():
            return u
    return None


# ── Tool: crear ticket ────────────────────────────────────────────────────────

def crear_ticket_sede_sur(
    titulo: str,
    descripcion: str,
    asignado_a_nombre: str,
    categoria: str = "",
    prioridad: str = "",
) -> str:
    """
    Crea un ticket en el centro de mando asignado a un miembro del equipo.
    Usa cuando alguien menciona @Nombre y pide una tarea.
    asignado_a_nombre: nombre del usuario según el panel (puede ser parcial).
    categoria: ventas, compras, logistica, mantenimiento, rrhh, contabilidad.
    prioridad: baja, media, alta, urgente.
    """
    from app.services.tickets_db import crear_ticket

    usuario_destino = buscar_usuario_por_nombre(asignado_a_nombre)
    if not usuario_destino:
        return json.dumps({
            "ok": False,
            "error": (
                f"No encontré al usuario '{asignado_a_nombre}' en el panel. "
                "Debe estar registrado en http://localhost:8081/app para recibir tickets."
            ),
        }, ensure_ascii=False)

    cat_final = categoria.strip() or _inferir_categoria(f"{titulo} {descripcion}")
    pri_final = prioridad.strip() or _inferir_prioridad(f"{titulo} {descripcion}")

    bot_id = _bot_usuario_id()
    ticket, err = crear_ticket(
        data={
            "titulo": titulo.strip()[:200],
            "descripcion": descripcion.strip(),
            "categoria": cat_final,
            "prioridad": pri_final,
            "asignado_a": usuario_destino["id"],
            "tipo": "accion",
        },
        usuario_id=bot_id,
    )
    if err:
        return json.dumps({"ok": False, "error": err}, ensure_ascii=False)

    return json.dumps({
        "ok": True,
        "ticket_numero": ticket["numero"],
        "ticket_id": ticket["id"],
        "titulo": ticket["titulo"],
        "asignado_a": usuario_destino["nombre"],
        "categoria": cat_final,
        "prioridad": pri_final,
        "estado": ticket["estado"],
    }, ensure_ascii=False)


# ── Tool: resolver ticket ─────────────────────────────────────────────────────

def resolver_ticket_sede_sur(ticket_numero: str, usuario_nombre: str = "") -> str:
    """
    Marca un ticket como resuelto desde WhatsApp SEDE SUR.
    ticket_numero: número tipo 'TICK-001'.
    usuario_nombre: nombre de quien lo resolvió (opcional, para log).
    """
    from app.services.tickets_db import cambiar_estado

    num = ticket_numero.strip().upper()
    with sqlite3.connect(_DB_PATH) as db:
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT id, titulo, estado, asignado_a FROM tickets WHERE numero=?", (num,)
        ).fetchone()

    if not row:
        return json.dumps({"ok": False, "error": f"No encontré el ticket {num}"}, ensure_ascii=False)

    if row["estado"] == "resuelto":
        return json.dumps({
            "ok": False,
            "error": f"El ticket {num} ya estaba resuelto.",
        }, ensure_ascii=False)

    # Resolver con permiso de administrador (nivel 3)
    resolutor_id = _bot_usuario_id()
    if usuario_nombre:
        u = buscar_usuario_por_nombre(usuario_nombre)
        if u:
            resolutor_id = u["id"]

    usuario_dict = {"id": resolutor_id, "rol": {"nivel": 3}}
    ok, err = cambiar_estado(
        row["id"], "resuelto", usuario_dict,
        motivo=f"Resuelto vía WhatsApp SEDE SUR{'por ' + usuario_nombre if usuario_nombre else ''}",
    )
    if not ok:
        return json.dumps({"ok": False, "error": err}, ensure_ascii=False)

    return json.dumps({
        "ok": True,
        "ticket_numero": num,
        "titulo": row["titulo"],
        "resuelto_por": usuario_nombre or "equipo",
    }, ensure_ascii=False)


# ── Tool: listar tickets ──────────────────────────────────────────────────────

def listar_tickets_sede_sur(usuario_nombre: str = "", estado: str = "") -> str:
    """
    Lista tickets del equipo. Filtra por usuario o estado si se especifican.
    estado: pendiente, en_proceso, resuelto (vacío = todos abiertos).
    """
    from app.services.tickets_db import listar_tickets

    bot_id = _bot_usuario_id()
    usuario_dict = {"id": bot_id, "rol": {"nivel": 3}}

    filtros: dict = {}
    if estado:
        filtros["estado"] = estado
    if usuario_nombre:
        u = buscar_usuario_por_nombre(usuario_nombre)
        if u:
            filtros["asignado_a"] = u["id"]

    tickets = listar_tickets(usuario_dict, filtros)

    resumen = [
        {
            "numero": t["numero"],
            "titulo": t["titulo"],
            "estado": t["estado"],
            "prioridad": t["prioridad"],
            "asignado_a": t.get("asignado_a_nombre") or "Sin asignar",
            "categoria": t.get("categoria", ""),
        }
        for t in tickets[:15]
    ]
    return json.dumps(
        {"ok": True, "tickets": resumen, "total": len(tickets)},
        ensure_ascii=False,
    )


# ── Parseo de mensaje (usado por routes.py) ───────────────────────────────────

_RE_TICKET_NUM = re.compile(r'\b(TKT-[\w-]+|\bTICK-\d+)\b', re.IGNORECASE)
_RE_RESUELTO = re.compile(
    r'\b(?:resuelto|listo|hecho|done|completado|terminado)\s+(TKT-[\w-]+|TICK-\d+)\b',
    re.IGNORECASE,
)
_RE_MENCION = re.compile(r'@([\w]+)')

# Palabras que activan al bot explícitamente (sin @mención ni ticket)
_TRIGGERS_EXPLÍCITOS = re.compile(
    r'\b(hugo|bot|asistente|ayuda|help|ticket|tickets|tarea|tareas|pendiente|pendientes)\b',
    re.IGNORECASE,
)

# Respuestas sociales que el bot debe ignorar (mensajes cortos de conversación)
_IGNORAR_PATRON = re.compile(
    r'^[\s🙏👍👌✅🤝😊🙌💪🫡🫶]+$'  # solo emojis
    r'|^(r|ok|okay|dale|listo|gracias|claro|sí|si|no|buenas|hola|hola!|'
    r'buenos días|buenas tardes|buenas noches|perfecto|entendido|recibido|'
    r'copy|roger|ya|voy|vamos|espera|ahí voy|ahí te cuento|'
    r'jeje|jaja|aja|ah|oh|uy|oye|oiga|bien|genial|excelente|'
    r'np|np!|👋|oki|okis|de una|va|listo pues|claro que sí)[.!?\s]*$',
    re.IGNORECASE,
)


def _debe_activar_bot(texto: str) -> bool:
    """
    True solo si el mensaje requiere respuesta del agente en SEDE SUR.
    El bot NO responde a conversación social normal del equipo.
    """
    t = texto.strip()
    if not t or len(t) < 3:
        return False
    # Ignorar las propias confirmaciones del bot (evitar loop)
    if t.startswith(('✅', '⚠️')):
        return False
    # Siempre ignorar respuestas sociales cortas
    if _IGNORAR_PATRON.match(t):
        return False
    # Siempre activar si hay @mención o número de ticket
    if _RE_MENCION.search(t) or _RE_TICKET_NUM.search(t):
        return True
    # Activar si hay trigger explícito
    if _TRIGGERS_EXPLÍCITOS.search(t):
        return True
    # Activar si es una pregunta
    if '?' in t:
        return True
    return False


def procesar_accion_sede_sur(texto: str) -> tuple[str, dict | None, bool]:
    """
    Detecta y ejecuta acciones estructuradas en mensajes de SEDE SUR.
    Retorna (texto_enriquecido_para_agente, resultado_accion | None, activar_ia).

    activar_ia=False → el mensaje es conversación social; el bot no responde.

    Prioridad:
      1. "resuelto TKT-XXX" → resolver ticket (siempre activa IA)
      2. "@Nombre + tarea"   → crear ticket (siempre activa IA)
      3. Sin patrón          → solo activa si _debe_activar_bot()
    """
    # 1. Resolver ticket
    m = _RE_RESUELTO.search(texto)
    if m:
        ticket_num = m.group(1).upper()
        resultado = json.loads(resolver_ticket_sede_sur(ticket_num))
        if resultado["ok"]:
            enriquecido = (
                f"[TICKET RESUELTO: {resultado['ticket_numero']} — "
                f"'{resultado['titulo']}' — marcado como RESUELTO]\n"
                f"Mensaje: {texto}"
            )
        else:
            enriquecido = (
                f"[ERROR al resolver ticket {ticket_num}: {resultado['error']}]\n"
                f"Mensaje: {texto}"
            )
        return enriquecido, resultado, True

    # 2. Crear ticket por @mención
    menciones = _RE_MENCION.findall(texto)
    if menciones:
        nombre_raw = menciones[0].strip()
        descripcion = _RE_MENCION.sub("", texto, count=1).strip()
        descripcion = re.sub(r'\s+', ' ', descripcion).strip(", ").strip()
        if not descripcion:
            descripcion = texto.strip()

        titulo = descripcion[:100] if len(descripcion) > 100 else descripcion
        resultado = json.loads(crear_ticket_sede_sur(titulo, descripcion, nombre_raw))

        if resultado["ok"]:
            enriquecido = (
                f"[TICKET CREADO: {resultado['ticket_numero']} asignado a "
                f"{resultado['asignado_a']} | Prioridad: {resultado['prioridad']} | "
                f"Categoría: {resultado['categoria']}]\n"
                f"Mensaje: {texto}"
            )
        else:
            enriquecido = (
                f"[NO SE PUDO CREAR TICKET: {resultado['error']}]\n"
                f"Mensaje: {texto}"
            )
        return enriquecido, resultado, True

    # 3. Sin acción estructurada → solo responder si el mensaje lo requiere
    return texto, None, _debe_activar_bot(texto)
