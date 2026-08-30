"""
Mensajes de texto WA del panel de tickets a operadores (antes: notas de voz).

Eventos:
- Nueva acción/solicitud asignada
- Compras delegadas asignadas
- Solicitud emitida resuelta por otro usuario
- Lista de compras esperada completada
- Recordatorio del día
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_TELEFONOS_JSON = _REPO / "app" / "data" / "tickets_telefonos_operadores.json"


def _notif_habilitada() -> bool:
    return os.getenv("TICKETS_NOTIF_OPERADOR", "1").strip().lower() not in ("0", "false", "no")


def normalizar_telefono_wa(raw: str) -> str:
    s = re.sub(r"\D", "", (raw or "").strip())
    if not s:
        return ""
    if "@c.us" in (raw or ""):
        return raw.strip()
    if len(s) == 10 and s.startswith("3"):
        return "57" + s
    if len(s) == 12 and s.startswith("57"):
        return s
    return s


def _telefono_desde_env(usuario_id: int) -> str:
    key = f"TICKETS_VOZ_TELEFONO_{usuario_id}"
    return normalizar_telefono_wa(os.getenv(key, ""))


def _telefono_desde_json(usuario_id: int) -> str:
    if not _TELEFONOS_JSON.is_file():
        return ""
    try:
        data = json.loads(_TELEFONOS_JSON.read_text(encoding="utf-8"))
        raw = data.get(str(usuario_id)) or data.get(usuario_id)
        return normalizar_telefono_wa(str(raw or ""))
    except Exception:
        return ""


def telefono_operador(usuario_id: int | None) -> str:
    if not usuario_id:
        return ""
    with _conn_ctx() as db:
        row = db.execute(
            "SELECT telefono FROM usuarios WHERE id=? AND activo=1", (int(usuario_id),),
        ).fetchone()
        if row and row["telefono"]:
            tel = normalizar_telefono_wa(str(row["telefono"]))
            if tel:
                return tel
    tel = _telefono_desde_env(int(usuario_id))
    if tel:
        return tel
    return _telefono_desde_json(int(usuario_id))


def _conn_ctx():
    from app.services.tickets_db import _conn
    return _conn()


def _nombre_usuario(db, uid: int | None) -> str:
    if not uid:
        return "Operador"
    row = db.execute("SELECT nombre FROM usuarios WHERE id=?", (uid,)).fetchone()
    return (row["nombre"] if row else None) or "Operador"


def _primer_nombre(nombre: str) -> str:
    return (nombre or "Operador").strip().split(" ")[0]


def enviar_texto_operador(usuario_id: int | None, texto: str) -> bool:
    if not _notif_habilitada():
        return False
    numero = telefono_operador(usuario_id)
    if not numero:
        print(f"[tickets-notif] Sin teléfono para usuario {usuario_id}")
        return False
    # Bridge supervisor (573196529076) — dedicado a estas alertas automatizadas de
    # operadores, distinto del bridge principal (573195183596, `enviar_whatsapp_reporte`)
    # que usan los grupos operativos y reportes.
    from app.utils import enviar_texto_supervisor
    ok = enviar_texto_supervisor(numero, texto.strip())
    if ok:
        print(f"[tickets-notif] Enviado a usuario {usuario_id} ({numero[:6]}…)")
    return ok


def _programar(usuario_id: int | None, texto: str) -> None:
    if not usuario_id or not texto.strip():
        return
    try:
        from app.observability import spawn_thread
        spawn_thread(
            enviar_texto_operador,
            (int(usuario_id), texto),
            daemon=True,
        )
    except Exception as exc:
        print(f"[tickets-notif] programar: {exc}")


def _ticket_row(db, ticket_id: int) -> dict | None:
    row = db.execute(
        "SELECT id, numero, titulo, descripcion, tipo, subtipo, estado, creado_por, asignado_a, ticket_padre_id "
        "FROM tickets WHERE id=?",
        (ticket_id,),
    ).fetchone()
    return dict(row) if row else None


def _titulo_corto(t: str, n: int = 48) -> str:
    t = (t or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def _desc_corta(t: dict, n: int = 64) -> str:
    """Devuelve la descripción del ticket truncada, o '' si es igual al título o está vacía."""
    desc = (t.get("descripcion") or "").strip()
    titulo = (t.get("titulo") or "").strip()
    if not desc or desc.lower() == titulo.lower():
        return ""
    return desc if len(desc) <= n else desc[: n - 1] + "…"


def notificar_ticket_creado(ticket_id: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] not in ("accion", "solicitud"):
            return
        asig = t.get("asignado_a")
        if not asig or asig == t.get("creado_por"):
            return
        creador = _primer_nombre(_nombre_usuario(db, t.get("creado_por")))
        subtipo = (t.get("subtipo") or "").strip()
        titulo = _titulo_corto(t.get("titulo") or "una tarea", 60)

        if subtipo == "compra":
            texto = f"Compras: {creador} te solicita {titulo}."
        elif subtipo == "etiqueta":
            texto = f"Etiquetas: {creador} pidió {titulo}."
        elif t["tipo"] == "solicitud":
            texto = f"{creador} te ha hecho una solicitud: {titulo}"
        else:
            texto = f"Acciones: {creador} te asignó {titulo}."
        _programar(asig, texto)


def notificar_compra_delegada(solicitud_id: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, solicitud_id)
        if not t or (t.get("subtipo") or "").strip() != "compra":
            return
        asig = t.get("asignado_a")
        if not asig:
            return
        padre = ""
        if t.get("ticket_padre_id"):
            p = _ticket_row(db, int(t["ticket_padre_id"]))
            padre = _titulo_corto((p or {}).get("titulo") or "", 40)
        texto = f"Compras: te delegaron la lista para {padre}." if padre else "Compras: te delegaron una lista de compras."
        _programar(asig, texto)


def notificar_ticket_resuelto(ticket_id: int, resolvio_uid: int) -> None:
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t:
            return
        resolvio = _primer_nombre(_nombre_usuario(db, resolvio_uid))
        titulo = _titulo_corto(t.get("titulo") or "una tarea", 60)
        subtipo = (t.get("subtipo") or "").strip()

        creador = t.get("creado_por")
        if t["tipo"] == "solicitud" and creador and creador != resolvio_uid:
            if subtipo == "compra":
                texto = f"{resolvio} completó las compras de {titulo}."
                if t.get("ticket_padre_id"):
                    p = _ticket_row(db, int(t["ticket_padre_id"]))
                    if p:
                        texto += f" Puedes seguir con {_titulo_corto(p.get('titulo') or 'pendiente', 40)}."
            elif t.get("ticket_padre_id"):
                # Intervención/pregunta resuelta: el que espera es quien la pidió
                p = _ticket_row(db, int(t["ticket_padre_id"])) or {}
                padre_titulo = _titulo_corto(p.get("titulo") or "tu solicitud", 40)
                verbo = "respondió tu pregunta" if subtipo == "pregunta" else "resolvió la intervención"
                texto = (
                    f"{resolvio} {verbo}: {titulo}. "
                    f"«{padre_titulo}» se reactivó, puedes continuar."
                )
            else:
                texto = f"{resolvio} resolvió tu solicitud: {titulo}"
            _programar(creador, texto)

        if subtipo == "compra" and t.get("ticket_padre_id"):
            padre = _ticket_row(db, int(t["ticket_padre_id"]))
            if padre:
                esperan = {padre.get("creado_por"), padre.get("asignado_a")} - {
                    None, resolvio_uid,
                }
                for uid in esperan:
                    if uid == creador:
                        continue
                    texto = (
                        f"{resolvio} completó las compras para "
                        f"{_titulo_corto(padre.get('titulo') or 'pendiente', 40)}."
                    )
                    _programar(uid, texto)


def notificar_intervencion_solicitada(intervencion_id: int) -> None:
    """Avisa a quien debe responder que una solicitud quedó PAUSADA esperándolo.

    `intervencion_id` es el sub-ticket creado por `pedir_intervencion`. Si el
    destinatario es quien pidió la solicitud original (caso `subtipo='pregunta'`),
    el texto lo dice explícitamente: están esperando su respuesta para continuar.
    """
    with _conn_ctx() as db:
        t = _ticket_row(db, intervencion_id)
        if not t or not t.get("ticket_padre_id"):
            return
        destino = t.get("asignado_a")
        if not destino or destino == t.get("creado_por"):
            return
        padre = _ticket_row(db, int(t["ticket_padre_id"])) or {}
        quien = _primer_nombre(_nombre_usuario(db, t.get("creado_por")))
        padre_titulo = _titulo_corto(padre.get("titulo") or "una solicitud", 48)
        detalle = _titulo_corto(t.get("titulo") or "", 120)
        es_pregunta = (t.get("subtipo") or "").strip() == "pregunta"
        es_solicitante = padre.get("creado_por") == destino

        if es_pregunta and es_solicitante:
            texto = (
                f"{quien} está atendiendo tu solicitud «{padre_titulo}» y necesita tu "
                f"respuesta para continuar:\n\n“{detalle}”\n\n"
                f"La solicitud quedó en pausa hasta que respondas en el panel."
            )
        elif es_pregunta:
            texto = (
                f"{quien} necesita tu respuesta para continuar con «{padre_titulo}»:\n\n"
                f"“{detalle}”\n\nEsa solicitud quedó en pausa hasta que respondas."
            )
        else:
            texto = (
                f"{quien} necesita tu intervención para continuar «{padre_titulo}»: "
                f"{detalle}. Esa solicitud quedó en pausa hasta que la resuelvas."
            )
    _programar(destino, texto)


def notificar_revision_solicitada(ticket_id: int, resolvio_uid: int) -> None:
    """Avisa al creador de la solicitud que el ejecutor pide su revisión/aprobación."""
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] != "solicitud":
            return
        creador = t.get("creado_por")
        if not creador or creador == resolvio_uid:
            return
        resolvio = _primer_nombre(_nombre_usuario(db, resolvio_uid))
        titulo = _titulo_corto(t.get("titulo") or "una tarea", 60)
        texto = f"{resolvio} terminó {titulo} y pide tu aprobación."
        _programar(creador, texto)


def notificar_ticket_reabierto(ticket_id: int, reabrio_uid: int) -> None:
    """Avisa a quien resolvió la solicitud que el solicitante la reabrió."""
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] != "solicitud":
            return
        asig = t.get("asignado_a")
        if not asig or asig == reabrio_uid:
            return
        reabrio = _primer_nombre(_nombre_usuario(db, reabrio_uid))
        titulo = _titulo_corto(t.get("titulo") or "una tarea", 60)
        texto = f"{reabrio} reabrió tu solicitud: {titulo}"
        _programar(asig, texto)


def notificar_comentario_agregado(ticket_id: int, autor_uid: int) -> None:
    """Aviso liviano a la contraparte de una solicitud cuando le escriben un mensaje
    nuevo en el chat — no se dispara para notas internas (es_interno) ni para el
    propio autor del mensaje."""
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] != "solicitud":
            return
        creador = t.get("creado_por")
        asignado = t.get("asignado_a")
        if autor_uid == creador:
            contraparte = asignado
        elif autor_uid == asignado:
            contraparte = creador
        else:
            contraparte = None
        if not contraparte or contraparte == autor_uid:
            return
        autor = _primer_nombre(_nombre_usuario(db, autor_uid))
        titulo = _titulo_corto(t.get("titulo") or "una solicitud", 60)
        texto = f"{autor} escribió en la solicitud: {titulo}"
        _programar(contraparte, texto)


def notificar_ticket_reasignado(ticket_id: int, nuevo_asignado: int | None) -> None:
    if not nuevo_asignado:
        return
    with _conn_ctx() as db:
        t = _ticket_row(db, ticket_id)
        if not t or t["tipo"] not in ("accion", "solicitud"):
            return
        titulo = _titulo_corto(t.get("titulo") or "una tarea", 60)
        texto = f"Te reasignaron: {titulo}."
        _programar(nuevo_asignado, texto)


def notificar_recordatorios_hoy(usuario_id: int) -> list[str]:
    """Envía un mensaje de texto por WhatsApp por cada recordatorio vencido o de hoy.

    Retorna lista de títulos notificados.
    """
    from datetime import date as _date
    hoy = _date.today().isoformat()
    notificados: list[str] = []
    with _conn_ctx() as db:
        rows = db.execute(
            """SELECT titulo FROM recordatorios
               WHERE usuario_id=? AND activo=1 AND proxima_fecha<=?
               ORDER BY proxima_fecha ASC""",
            (usuario_id, hoy),
        ).fetchall()
    for row in rows:
        titulo = _titulo_corto(row["titulo"], 60)
        texto = f"Recordatorio: {titulo}."
        _programar(usuario_id, texto)
        notificados.append(row["titulo"])
    return notificados
