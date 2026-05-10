"""
Clasificación de tópicos de notificaciones HTTP de Mercado Libre.

MeLi usa nombres distintos según flujo (clásico vs marketplace / global selling).
Antes solo se aceptaba topic == "questions" y topic.startswith("messages"),
lo que dejaba fuera marketplace_questions y marketplace_messages → cero preventa/postventa.
"""

from __future__ import annotations

from typing import Any


def meli_webhook_es_preventa(topic: str | None) -> bool:
    t = (topic or "").strip().lower()
    return t in ("questions", "marketplace_questions")


def meli_webhook_es_mensajes_postventa(topic: str | None) -> bool:
    t = (topic or "").strip().lower()
    if not t:
        return False
    if t in ("messages", "marketplace_messages"):
        return True
    # messages_v2, messages_foo (futuro)
    return t.startswith("messages")


def meli_webhook_question_id_desde_resource(resource: str) -> str:
    """Último segmento de la ruta o el id suelto (MeLi: /questions/…, /marketplace/questions/…)."""
    r = (resource or "").strip().strip("/")
    if not r:
        return ""
    return r.split("/")[-1]


# Acciones que típicamente no implican mensaje nuevo del comprador (solo estado de entrega/lectura).
_PASSIVE_MESSAGE_WEBHOOK_ACTIONS = frozenset(
    {"read", "delivered", "seen", "viewed", "opened"}
)


def meli_webhook_ignorar_order_pasiva(data: dict | None) -> bool:
    """
    MeLi envía `orders_v2` por cambios de tags/documentos sobre órdenes antiguas.
    Esos eventos no son una venta nueva y no deben disparar sync de stock.
    """
    if not isinstance(data, dict):
        return False
    actions = data.get("actions")
    if not isinstance(actions, list):
        return False
    normalizadas = {str(a).strip().lower() for a in actions if a is not None}
    return "action:new_tag" in normalizadas


def meli_webhook_ignorar_messages_sin_created(data: dict | None) -> bool:
    """
    Notificaciones topic messages a veces traen solo actions de lectura/entrega — sin mensaje nuevo.
    Antes se exigía el string exacto "created"; MeLi/Nuevo formato puede usar otros nombres
    (p. ej. variantes con "creat"), y entonces se ignoraban todas → cero alerta WhatsApp.

    Si no hay campo `actions` (integraciones viejas), no ignorar.

    Regla: ignorar solo si todas las actions son "pasivas" conocidas. Cualquier otra cosa
    o subcadena "creat" → no ignorar (procesar postventa).
    """
    if not isinstance(data, dict):
        return False
    actions = data.get("actions")
    if not isinstance(actions, list) or len(actions) == 0:
        return False
    partes: list[str] = []
    for a in actions:
        if a is None:
            continue
        s = str(a).strip().lower()
        if s:
            partes.append(s)
    if not partes:
        return False
    for s in partes:
        if "creat" in s:
            return False
        if s not in _PASSIVE_MESSAGE_WEBHOOK_ACTIONS:
            return False
    return True


def meli_webhook_evaluar_despacho(
    topic: str | None, resource: str, data: dict | None
) -> dict[str, Any]:
    """
    Decisión pura (sin I/O): qué flujo corresponde a una notificación MeLi.
    Debe coincidir con /notifications en webhook_meli y app/routes — tests de regresión.
    """
    if not data:
        return {"tipo": "invalido", "detalle": "body_vacio_o_json_invalido"}
    res = (resource or "").strip()
    if meli_webhook_es_preventa(topic):
        if not res:
            return {"tipo": "preventa_sin_resource", "topic": topic}
        qid = meli_webhook_question_id_desde_resource(res)
        if not qid:
            return {
                "tipo": "preventa_sin_question_id",
                "topic": topic,
                "resource": res,
            }
        return {"tipo": "preventa", "question_id": qid, "topic": topic}
    if (topic or "").strip() == "orders_v2":
        if not res:
            return {"tipo": "orden_sin_resource", "topic": topic}
        if meli_webhook_ignorar_order_pasiva(data):
            return {
                "tipo": "orden_omitir_accion_pasiva",
                "topic": topic,
                "resource": res,
                "actions": data.get("actions"),
            }
        return {"tipo": "orden", "order_id": res.split("/")[-1], "topic": topic}
    if meli_webhook_es_mensajes_postventa(topic):
        if meli_webhook_ignorar_messages_sin_created(data):
            return {
                "tipo": "postventa_omitir_lectura",
                "topic": topic,
                "actions": data.get("actions"),
            }
        if not res:
            return {"tipo": "postventa_sin_resource", "topic": topic}
        return {"tipo": "postventa", "resource": res, "topic": topic}
    return {"tipo": "topic_no_manejado", "topic": topic, "resource": res or None}
