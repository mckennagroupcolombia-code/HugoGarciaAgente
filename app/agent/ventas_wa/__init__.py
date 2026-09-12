"""
Agente de ventas por WhatsApp (v2).

Reemplaza, detrás de la bandera WA_AGENTE_V2, la cadena de interceptores regex
+ LLM sin herramientas que atendía el canal directo de WhatsApp. Diseño
(decisiones del negocio, sep-2026):

- Un solo agente por turno (Claude con herramientas). Nada de respuestas
  enlatadas en el camino de venta.
- El pedido vive en SQLite (pedido.py), no en el texto del historial: los
  precios salen del catálogo de la página web y los totales los calcula Python.
- El bot responde a cualquier hora, se presenta como asistente IA y ofrece
  pasar a un asesor cuando la conversación se complica.
- El bot NO cierra la venta: arma el pedido y pasa la tarjeta al grupo de
  ventas; el asesor confirma total, comparte datos de pago y cierra.
- La fuente de verdad del historial es wa_chats.db (lo que realmente pasó en
  WhatsApp, incluidos los mensajes que el asesor escribe desde el teléfono).
  No se mezcla con la memoria del chat web (burbuja del sitio).
"""
