# -*- coding: utf-8 -*-
"""Avisos de mensajes nuevos en los grupos del equipo (pedido del 5-oct-2026).

La app es un chat: cuando alguien escribe en un grupo, los demás deben enterarse.
  * App abierta: el panel consulta `novedades()` cuando sube el contador de no leídos
    y muestra una tarjeta con sonido (useAvisosMensajes.ts).
  * App cerrada o en segundo plano: Web Push al Service Worker (`sw-alarm.js`, tipo
    «chat-mensaje»), con las mismas claves VAPID de la alarma de tareas
    (push_scheduler). Suscripciones en `push_subscriptions` por `usuario_id`.

Sin spam: un push por persona y grupo cada `_VENTANA_S` segundos, y nada entre 22:00 y
07:00 (mismo horario de silencio que la alarma). Nunca por WhatsApp. Sin LLM.
A quien nombran con @ (7-oct-2026) le llega aparte, sin esa ventana: «Ana te mencionó · Bodega».
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

_VENTANA_S = 120
_ultimo: dict[tuple[int, int], float] = {}
_lock = threading.Lock()


def destinatarios(canal_id: int, autor_id: int | None) -> list[int]:
    """Miembros del grupo; si no tiene miembros, todo el equipo activo. Nunca el autor."""
    from app.services import canales_internos as CI

    with CI._conn() as c:
        miembros = CI._miembros(c, canal_id)
        if not miembros:
            miembros = [int(r[0]) for r in c.execute("SELECT id FROM usuarios WHERE COALESCE(activo,1)=1")]
    return [u for u in miembros if u != (autor_id or -1)]


def _toca(uid: int, canal_id: int, ahora: float) -> bool:
    with _lock:
        if ahora - _ultimo.get((uid, canal_id), 0) < _VENTANA_S:
            return False
        _ultimo[(uid, canal_id)] = ahora
        return True


def avisar_mensaje(canal_id: int, canal_nombre: str, autor_id: int | None, autor: str, texto: str, adjunto: bool = False,
                   *, mencionados: list[int] | None = None) -> None:
    """Se llama al guardar un mensaje; el envío corre en otro hilo para no frenar el chat."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    threading.Thread(
        target=_enviar, args=(canal_id, canal_nombre, autor_id, autor, texto, adjunto, list(mencionados or [])),
        name="canal-push", daemon=True,
    ).start()


def _enviar(canal_id: int, canal_nombre: str, autor_id: int | None, autor: str, texto: str, adjunto: bool,
            mencionados: list[int] | None = None) -> None:
    try:
        from app.services import push_scheduler as PS

        if not PS.push_disponible() or PS._en_horario_silencio():
            return
        ahora = time.time()
        nombrados = set(mencionados or [])
        # Los nombrados reciben su propio aviso (y reinician su ventana); el resto, el de siempre.
        for u in nombrados:
            with _lock:
                _ultimo[(u, canal_id)] = ahora
        uids = [u for u in destinatarios(canal_id, autor_id) if u not in nombrados and _toca(u, canal_id, ahora)]
        cuerpo = (texto or "").strip().replace("\n", " ")[:140] or ("📎 Adjunto" if adjunto else "Mensaje nuevo")
        base = {"type": "chat-mensaje", "cuerpo": cuerpo, "tag": f"canal-{canal_id}", "canal_id": canal_id}
        if nombrados:
            _empujar(PS, sorted(nombrados), {**base, "titulo": f"{autor or 'Alguien'} te mencionó · {canal_nombre}",
                                             "tag": f"mencion-{canal_id}"})
        if uids:
            _empujar(PS, uids, {**base, "titulo": f"{autor or 'Alguien'} · {canal_nombre}"})
    except Exception as exc:
        log.warning("[canal-push] no se pudo avisar: %s", exc)


def _empujar(PS, uids: list[int], payload: dict) -> None:
    """Web Push a todos los dispositivos de `uids`."""
    try:
        PS._ensure_table()
        marcas = ",".join("?" * len(uids))
        with PS._get_conn() as db:
            filas = db.execute(
                f"SELECT endpoint, subscription_json FROM push_subscriptions WHERE usuario_id IN ({marcas})", uids
            ).fetchall()
        datos = json.dumps(payload, ensure_ascii=False)
        from pywebpush import webpush

        for f in filas:
            try:
                webpush(subscription_info=json.loads(f[1]), data=datos,
                        vapid_private_key=PS._VAPID_PEM, vapid_claims={"sub": PS._VAPID_EMAIL})
            except Exception as exc:  # 404/410: la suscripción caducó
                msg = str(exc)
                if "410" in msg or "404" in msg:
                    PS._db_delete(f[0])
                else:
                    log.warning("[canal-push] %s", msg[:120])
    except Exception as exc:
        log.warning("[canal-push] no se pudo avisar: %s", exc)


def registrar_suscripcion(usuario_id: int, subscription: dict) -> None:
    """Guarda la suscripción del dispositivo sin tocar la programación de la alarma."""
    from app.services import push_scheduler as PS

    endpoint = str((subscription or {}).get("endpoint") or "")
    if not endpoint.startswith("https://"):
        raise ValueError("Suscripción inválida")
    PS._ensure_table()
    with PS._get_conn() as db:
        db.execute(
            "INSERT INTO push_subscriptions (endpoint, subscription_json, usuario_id, actualizado_en) "
            "VALUES (?,?,?,datetime('now')) ON CONFLICT(endpoint) DO UPDATE SET "
            "subscription_json=excluded.subscription_json, usuario_id=excluded.usuario_id, actualizado_en=excluded.actualizado_en",
            (endpoint, json.dumps(subscription, ensure_ascii=False), int(usuario_id)),
        )
        db.commit()


def novedades(usuario: dict, desde: int, *, inicio: bool = False) -> dict:
    """Mensajes de otros en los grupos que esta persona ve, posteriores a `desde`.
    Con `inicio=True` solo devuelve el último id: lo que ya existía al abrir la app no se avisa.
    (`desde=0` es válido: un servidor sin mensajes todavía empieza en 0.)"""
    from app.services import canales_internos as CI

    uid = int(usuario["id"])
    with CI._conn() as c:
        visibles = {int(r["id"]): r["nombre"] for r in c.execute("SELECT * FROM canales_internos WHERE archivado=0")
                    if CI._puede_ver(c, r, usuario)}
        ultimo = int(c.execute("SELECT COALESCE(MAX(id),0) FROM canal_mensajes").fetchone()[0])
        if inicio or not visibles:
            return {"ultimo_id": ultimo, "mensajes": []}
        marcas = ",".join("?" * len(visibles))
        filas = c.execute(
            f"SELECT id, canal_id, usuario_id, autor_nombre, texto, adjunto_nombre, tipo FROM canal_mensajes "
            f"WHERE id>? AND eliminado=0 AND canal_id IN ({marcas}) AND (usuario_id IS NULL OR usuario_id != ?) "
            "ORDER BY id DESC LIMIT 5",
            (int(desde), *visibles.keys(), uid),
        ).fetchall()
        # Los que nombran a esta persona: el panel avisa «te mencionó» y con su sonido.
        ids = [int(f["id"]) for f in filas]
        mios = {int(r[0]) for r in c.execute(
            f"SELECT mensaje_id FROM canal_menciones WHERE usuario_id=? AND mensaje_id IN ({','.join('?' * len(ids))})",
            (uid, *ids),
        )} if ids else set()
    return {
        "ultimo_id": ultimo,
        "mensajes": [{**dict(f), "canal_nombre": visibles.get(int(f["canal_id"]), ""), "mencion": int(f["id"]) in mios}
                     for f in filas],
    }
