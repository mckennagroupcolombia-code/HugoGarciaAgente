import os
import json
from datetime import datetime
from google import genai

PENDIENTES_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'preguntas_pendientes_preventa.json')
CASOS_PATH = os.path.join(os.path.dirname(__file__), '..', 'training', 'casos_preventa.json')
GRUPO = os.getenv('GRUPO_CONTABILIDAD_WA', '120363407538342427@g.us')


# ---------------------------------------------------------------------------
# Persistencia — preguntas pendientes
# ---------------------------------------------------------------------------

def _leer_pendientes():
    try:
        with open(PENDIENTES_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('preguntas', [])
    except Exception:
        return []


def _guardar_pendientes(lista):
    try:
        with open(PENDIENTES_PATH, 'w', encoding='utf-8') as f:
            json.dump({'preguntas': lista}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"❌ Preventa: error guardando pendientes: {e}")


def guardar_pregunta_pendiente(question_id: str, titulo_producto: str, pregunta: str):
    pendientes = _leer_pendientes()
    # Evitar duplicados: si ya existe (pendiente o respondida), no re-notificar
    if any(str(p.get('question_id')) == str(question_id) for p in pendientes):
        print(f"⚠️ Preventa: question_id {question_id} ya registrado, omitiendo duplicado")
        return
    pendientes.append({
        'question_id': str(question_id),
        'titulo_producto': titulo_producto,
        'pregunta': pregunta,
        'timestamp': datetime.now().isoformat(),
        'respondida': False,
    })
    _guardar_pendientes(pendientes)


def obtener_pregunta_pendiente(question_id: str):
    """Busca una pregunta pendiente y la marca como respondida. Retorna el dict o None."""
    pendientes = _leer_pendientes()
    for p in pendientes:
        if str(p.get('question_id')) == str(question_id):
            p['respondida'] = True
            _guardar_pendientes(pendientes)
            return p
    return None


# ---------------------------------------------------------------------------
# Persistencia — casos aprendidos
# ---------------------------------------------------------------------------

def _leer_casos():
    try:
        with open(CASOS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('casos', [])
    except Exception:
        return []


def guardar_caso_preventa(producto: str, pregunta: str, respuesta: str):
    casos = _leer_casos()
    casos.append({
        'producto': producto,
        'pregunta': pregunta,
        'respuesta': respuesta,
        'timestamp': datetime.now().isoformat(),
    })
    try:
        with open(CASOS_PATH, 'w', encoding='utf-8') as f:
            json.dump({'casos': casos}, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"❌ Preventa: error guardando caso: {e}")


def _ejemplos_fewshot(titulo_producto: str) -> str:
    casos = _leer_casos()
    titulo_norm = titulo_producto.lower()
    similares = [
        c for c in casos
        if titulo_norm in c.get('producto', '').lower()
        or c.get('producto', '').lower() in titulo_norm
    ]
    if not similares:
        return ""
    lineas = ["\nEjemplos de respuestas anteriores validadas para este producto:"]
    for c in similares[-3:]:
        lineas.append(f"P: {c['pregunta']}\nR: {c['respuesta']}\n")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------
# Función principal
# ---------------------------------------------------------------------------

def manejar_pregunta_preventa(question_id: str, titulo_producto: str, pregunta_cliente: str):
    """
    Flujo completo de preventa:
    - Con ficha técnica → responde automáticamente con IA.
    - Sin ficha técnica → delega al grupo, NO responde al cliente.
    Retorna (respuesta_texto, fue_respondida):
      - (str, True)  si se generó respuesta para enviar al cliente
      - (None, False) si quedó delegada al grupo
    """
    from app.services.google_services import buscar_ficha_tecnica_producto

    ficha = buscar_ficha_tecnica_producto(titulo_producto)

    if not ficha:
        # Sin ficha → guardar pendiente y alertar al grupo. NO responder al cliente.
        print(f"⚠️ Preventa: sin ficha para '{titulo_producto}' — delegando al grupo")
        guardar_pregunta_pendiente(question_id, titulo_producto, pregunta_cliente)

        try:
            from app.utils import enviar_whatsapp_reporte
            sufijo = str(question_id)[-3:]
            enviar_whatsapp_reporte(
                f"❓ CONSULTA PREVENTA PENDIENTE\n"
                f"📦 Producto: {titulo_producto}\n"
                f"🗣 Cliente preguntó: {pregunta_cliente}\n\n"
                f"✍️ Para responder escribe:\n"
                f"resp {sufijo}: tu respuesta\n\n"
                f"Ejemplo:\n"
                f"resp {sufijo}: Se aplica 5ml por litro de agua",
                numero_destino=GRUPO
            )
        except Exception as e:
            print(f"❌ Preventa: error alertando al grupo: {e}")

        return None, False

    # Con ficha → generar respuesta con IA
    respuesta = generar_respuesta_con_ficha(titulo_producto, pregunta_cliente, ficha)

    if respuesta is None:
        # IA falló (ej: Gemini 503) → delegar al grupo, NO responder al cliente
        print(f"⚠️ Preventa: IA falló para '{titulo_producto}' — delegando al grupo")
        guardar_pregunta_pendiente(question_id, titulo_producto, pregunta_cliente)
        try:
            from app.utils import enviar_whatsapp_reporte
            sufijo = str(question_id)[-3:]
            enviar_whatsapp_reporte(
                f"❓ CONSULTA PREVENTA PENDIENTE\n"
                f"📦 Producto: {titulo_producto}\n"
                f"🗣 Cliente preguntó: {pregunta_cliente}\n"
                f"⚠️ (IA no pudo generar respuesta automática)\n\n"
                f"✍️ Para responder escribe:\n"
                f"resp {sufijo}: tu respuesta",
                numero_destino=GRUPO
            )
        except Exception as e:
            print(f"❌ Preventa: error alertando al grupo por fallo IA: {e}")
        return None, False

    # Guardar como aprendizaje
    guardar_caso_preventa(titulo_producto, pregunta_cliente, respuesta)

    return respuesta, True


def generar_respuesta_con_ficha(titulo_producto: str, pregunta: str, ficha_tecnica: str):
    """
    Genera respuesta usando Gemini con la ficha técnica real.
    Retorna el texto de respuesta, o None si la IA falla.
    """
    try:
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        ejemplos = _ejemplos_fewshot(titulo_producto)

        prompt = f"""Eres Hugo Garcia, asistente virtual de McKenna Group en Mercado Libre.

PRODUCTO: {titulo_producto}
NUNCA menciones un producto diferente al indicado arriba.

FICHA TÉCNICA:
{ficha_tecnica}
{ejemplos}

PREGUNTA DEL CLIENTE:
"{pregunta}"

REGLAS:
1. Tono: Rolo, cálido pero formal (ej: "Hola veci", "con gusto le colaboro").
2. Responde EXACTAMENTE lo que pregunta el cliente. Máximo 3 párrafos cortos.
3. SOLO usa información de la ficha técnica. No inventes datos.
4. MÁXIMO 2000 caracteres (límite de Mercado Libre).
5. NO menciones que tienes una "ficha técnica" — habla naturalmente.

Genera únicamente la respuesta para el cliente, sin comillas ni texto introductorio."""

        resp = client.models.generate_content(model='gemini-2.5-pro', contents=prompt)
        texto = resp.text.strip()
        return texto[:1997] + "..." if len(texto) > 2000 else texto

    except Exception as e:
        print(f"❌ Preventa: error generando respuesta IA: {e}")
        return None
