# MANUAL TÉCNICO — AGENTE MCKENNA GROUP

> Nivel: desarrollador junior que ve el código por primera vez.
> Objetivo: entender qué hace cada archivo, cada función, y por qué está escrito así.

---

## ÍNDICE

1. [agente_pro.py](#1-agente_propy)
2. [webhook_meli.py](#2-webhook_melipy)
3. [app/core.py](#3-appcorepy)
4. [app/routes.py](#4-approutespy)
5. [app/cli.py](#5-appclipy)
6. [app/services/meli.py](#6-appservicesmelipy)
7. [app/services/siigo.py](#7-appservicessiigopy)
8. [app/tools/system_tools.py](#8-apptoolssystem_toolspy)
9. [APIs de Generación Multimedia (consola)](#9-apis-de-generación-de-contenido-multimedia-consola)
10. [Nuevas Skills (Herramientas Autónomas)](#10-nuevas-skills-herramientas-autónomas)

---

## 1. `agente_pro.py`

### ¿Para qué sirve?

Este es el **archivo de entrada principal** del sistema. Piénsalo como el interruptor maestro de luz: no hace el trabajo pesado, solo enciende todo lo demás en el orden correcto.

Su trabajo es:
1. Cargar las contraseñas y claves desde el archivo `.env`
2. Crear la aplicación web (Flask)
3. Conectar el cerebro de IA al servidor
4. Lanzar el menú de consola **en paralelo** con el servidor web
5. Encender el servidor web en el puerto 8081

**Analogía:** Es como el gerente de apertura de un restaurante. No cocina, no atiende mesas, pero llega primero, abre la puerta, enciende las luces y llama a cada persona a su puesto.

---

### Explicación línea por línea

```python
import os
import threading
import logging
from flask import Flask
from dotenv import load_dotenv
```

- `os` — para leer variables del sistema operativo
- `threading` — para ejecutar dos cosas al mismo tiempo (el servidor web y el menú de consola)
- `logging` — para controlar qué mensajes se imprimen en pantalla
- `Flask` — el framework que convierte este programa en un servidor web que puede recibir peticiones HTTP
- `load_dotenv` — función que lee el archivo `.env` y carga todas las variables (como `GOOGLE_API_KEY`) al entorno del proceso

```python
load_dotenv()
```

Esta línea se ejecuta apenas arranca el programa. Lee el archivo `.env` y hace que todas las claves API queden disponibles con `os.getenv("NOMBRE_CLAVE")` en cualquier parte del código. Si esta línea no existiera, todas las claves serían `None` y nada funcionaría.

```python
from app.routes import register_routes
from app.cli import iniciar_cli
from app.core import configurar_ia
```

Importa tres funciones de otros módulos:
- `register_routes` — registra las URLs que el servidor web va a escuchar (ej: `/whatsapp`)
- `iniciar_cli` — arranca el menú interactivo de la consola
- `configurar_ia` — inicializa el modelo de Gemini con todas sus herramientas

```python
def create_app():
```

Esta es una **fábrica de aplicaciones** (Application Factory). En lugar de crear `app = Flask(__name__)` directamente en el módulo global, se hace dentro de una función. ¿Por qué? Porque así es más fácil de probar y de configurar sin efectos secundarios al importar el módulo.

```python
    app = Flask(__name__)
```

Crea la instancia de Flask. `__name__` le dice a Flask el nombre del módulo actual, para que sepa dónde buscar archivos de configuración y plantillas.

```python
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
```

`werkzeug` es la librería interna de Flask que imprime en consola cada petición HTTP que llega (por ejemplo: `POST /whatsapp 200`). Aquí se silencia para que esos mensajes no ensucien el menú de consola con el que interactúa el operador. Solo se mostrarán errores reales.

```python
    configurar_ia(app)
```

Llama a la función de `app/core.py` que conecta el modelo Gemini y registra todas las herramientas disponibles. Se pasa `app` como parámetro porque en el futuro podría necesitarse la instancia de Flask para guardar el modelo en `app.config`.

```python
    register_routes(app)
```

Le dice a Flask qué URLs escuchar y qué función ejecutar cuando llegue cada petición. Esto se define en `app/routes.py`.

```python
if __name__ == "__main__":
```

Esta condición significa: "solo ejecuta este bloque si alguien corre este archivo directamente con `python3 agente_pro.py`". Si otro archivo importa `agente_pro`, este bloque no se ejecuta.

```python
    app = create_app()
    print("🚀 Iniciando el Agente de McKenna Group...")
```

Crea la aplicación usando la fábrica y muestra un mensaje de bienvenida.

```python
    cli_thread = threading.Thread(target=iniciar_cli, daemon=True)
    cli_thread.start()
```

Aquí está el truco del paralelismo. `threading.Thread` crea un hilo secundario que ejecuta `iniciar_cli` al mismo tiempo que el hilo principal corre el servidor web. `daemon=True` significa que si el programa principal se cierra, este hilo también muere automáticamente (no queda colgado en memoria).

```python
    app.run(host='0.0.0.0', port=8081, debug=False)
```

Arranca el servidor web Flask:
- `host='0.0.0.0'` — escucha peticiones de cualquier IP de la red (no solo `localhost`)
- `port=8081` — usa el puerto 8081
- `debug=False` — modo producción: no recarga automáticamente el servidor al guardar un archivo

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/core.py` → `configurar_ia()` | Inicializar el modelo Gemini |
| `app/routes.py` → `register_routes()` | Registrar URLs del servidor |
| `app/cli.py` → `iniciar_cli()` | Lanzar el menú de consola |
| `.env` (vía `load_dotenv`) | Leer claves API y configuración |

---

### ¿Por qué se hizo así?

**Patrón Application Factory:** En proyectos Flask profesionales, no se crea `app` como variable global al importar el módulo. Se usa una función `create_app()` porque permite crear múltiples instancias de la app (útil para testing) y evita problemas de importación circular.

**Hilos (threading):** El menú de consola necesita `input()` que bloquea el hilo. Si corriera en el mismo hilo que el servidor, el servidor dejaría de responder peticiones mientras espera que el usuario escriba. Al poner el CLI en un hilo separado, ambos funcionan independientemente.

---

## 2. `webhook_meli.py`

### ¿Para qué sirve?

Este archivo es un **servidor web paralelo y autónomo** diseñado específicamente para recibir preguntas de clientes que llegan desde las publicaciones de Mercado Libre. Cuando alguien hace una pregunta en una publicación del vendedor, MeLi envía una notificación a este servidor, que la procesa con IA y publica la respuesta automáticamente.

**Analogía:** Imagina que tienes un empleado dedicado exclusivamente a revisar el buzón de preguntas de MeLi, leer cada pregunta, consultarle al gerente (la IA) qué responder, y escribir la respuesta. Este archivo es ese empleado.

**Nota importante:** Este archivo corre en el puerto **8080**, separado del servidor principal que corre en el **8081**. Son dos servidores distintos.

---

### Explicación línea por línea

```python
import os
import requests
import threading
import time
from flask import Flask, request, jsonify
from app.core import obtener_respuesta_ia
from app.utils import enviar_whatsapp_reporte, refrescar_token_meli
```

Importaciones clave:
- `obtener_respuesta_ia` — la función del cerebro central que procesa texto con Gemini
- `refrescar_token_meli` — renueva el token de autenticación con la API de MeLi antes de usarlo
- `enviar_whatsapp_reporte` — envía un resumen de lo que hizo la IA al grupo de WhatsApp del equipo

```python
app = Flask(__name__)
```

Aquí se crea `app` directamente como variable global, a diferencia de `agente_pro.py` que usa una fábrica. Esto es más simple pero menos flexible (no se puede usar en tests fácilmente).

---

#### Función `obtener_nombre_producto(item_id)`

```python
def obtener_nombre_producto(item_id):
    """Obtiene el título de la publicación de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
```

Llama a `refrescar_token_meli()` para obtener un token válido. Si esa función falla y retorna `None`, usa `or` para intentar obtener el token directamente de la variable de entorno como respaldo.

```python
    url = f"https://api.mercadolibre.com/items/{item_id}"
    headers = {"Authorization": f"Bearer {token_actual}"}
    try:
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            return res.json().get('title', 'Producto desconocido')
    except Exception as e:
        print(f"Error obteniendo nombre del producto: {e}")
    return "Producto desconocido"
```

Consulta la API de MeLi para obtener el título de la publicación (ej: "Ácido Cítrico 500g"). Si algo falla, retorna `"Producto desconocido"` en lugar de romper el programa. Esto se llama **manejo defensivo de errores**.

---

#### Función `responder_en_mercado_libre(question_id, texto)`

```python
def responder_en_mercado_libre(question_id, texto):
    """Envía la respuesta final a la API de Mercado Libre."""
    token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
    url = "https://api.mercadolibre.com/answers"
    headers = {
        "Authorization": f"Bearer {token_actual}",
        "Content-Type": "application/json"
    }
    data = {"question_id": question_id, "text": texto}
    try:
        response = requests.post(url, json=data, headers=headers)
        return response.status_code
    except Exception as e:
        print(f"Error al responder en MeLi: {e}")
        return 500
```

Publica la respuesta generada por la IA en la publicación de MeLi. El endpoint `/answers` de MeLi recibe el ID de la pregunta y el texto de la respuesta. Retorna el código HTTP de la respuesta (200/201 = éxito, 500 = error).

---

#### Función `tarea_procesar_pregunta(data)`

Esta es la función más importante del archivo. Se ejecuta en un hilo secundario para no bloquear el servidor.

```python
def tarea_procesar_pregunta(data):
    """Hilo secundario para procesar la IA sin bloquear el webhook."""
    try:
        resource = data.get('resource')
        question_id = resource.split('/')[-1]
```

MeLi envía una notificación con una clave `resource` que tiene el formato `/questions/12345678`. Se separa por `/` y se toma el último elemento (`[-1]`) para obtener solo el ID numérico de la pregunta.

```python
        token_actual = refrescar_token_meli() or os.environ.get("MELI_ACCESS_TOKEN")
        url_q = f"https://api.mercadolibre.com/questions/{question_id}"
        headers = {"Authorization": f"Bearer {token_actual}"}
        q_res = requests.get(url_q, headers=headers).json()
        pregunta_cliente = q_res.get('text', '')
        item_id = q_res.get('item_id', '')
        user_id = q_res.get('from', {}).get('id', 'desconocido')
```

Con el ID de la pregunta, hace una segunda llamada a la API de MeLi para obtener el texto completo de la pregunta, el ID del producto y el ID del usuario que preguntó.

```python
        if not pregunta_cliente:
            return
```

Si la pregunta está vacía (notificación sin texto), abandona silenciosamente.

```python
        nombre_producto = obtener_nombre_producto(item_id)
        pregunta_con_contexto = f"El cliente pregunta sobre el producto '{nombre_producto}': {pregunta_cliente}"
        respuesta_ia = obtener_respuesta_ia(pregunta_con_contexto, user_id)
```

Enriquece la pregunta añadiendo el nombre del producto como contexto antes de enviársela a la IA. Así la IA sabe exactamente sobre qué producto está hablando sin tener que adivinarlo.

```python
        status = responder_en_mercado_libre(question_id, respuesta_ia)
```

Publica la respuesta de la IA directamente en la publicación de MeLi.

```python
        emoji_status = "✅" if status == 200 or status == 201 else "❌"
        mensaje_ws = (f"🔔 *REPORTE BOT MCKENNA*\n\n"
                     f"📦 *Producto:* {nombre_producto}\n"
                     f"🗣 *Cliente:* {pregunta_cliente}\n"
                     f"🤖 *IA:* {respuesta_ia}\n\n"
                     f"Status MeLi: {emoji_status}")
        enviar_whatsapp_reporte(mensaje_ws)
```

Construye un resumen de todo lo que pasó y lo envía al grupo de WhatsApp del equipo como notificación.

---

#### Endpoint `POST /notifications`

```python
@app.route('/notifications', methods=['POST'])
def notifications():
    """Recibe la notificación y responde 'OK' de inmediato a MeLi."""
    data = request.get_json()
    if data and data.get('topic') == 'questions':
        hilo = threading.Thread(target=tarea_procesar_pregunta, args=(data,))
        hilo.start()
    return jsonify({"status": "ok"}), 200
```

Este es el endpoint que MeLi llama cuando llega una pregunta. **Regla crítica de webhooks:** MeLi exige recibir una respuesta `200 OK` en menos de 5 segundos, o reintenta la notificación. Por eso el procesamiento real (que puede demorar varios segundos con la IA) se lanza en un hilo separado, y se responde `200 OK` de inmediato.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/core.py` → `obtener_respuesta_ia()` | Generar respuesta con Gemini |
| `app/utils.py` → `refrescar_token_meli()` | Obtener token válido de MeLi |
| `app/utils.py` → `enviar_whatsapp_reporte()` | Notificar al equipo por WhatsApp |
| API de MeLi (externa) | Leer preguntas y publicar respuestas |

---

### ¿Por qué se hizo así?

**Respuesta inmediata + procesamiento en segundo plano:** MeLi tiene un timeout muy corto para los webhooks. Si el servidor demora en responder, MeLi asume que el servidor está caído y reintenta, generando respuestas duplicadas. Al separar la recepción (instantánea) del procesamiento (lento), se evita este problema.

**Servidor separado en puerto 8080:** Permite desplegar este webhook en una URL diferente al agente principal, o correrlos en servidores distintos si se necesita escalar.

---

## 3. `app/core.py`

### ¿Para qué sirve?

Este es el **cerebro de la aplicación**. Es donde se configura la inteligencia artificial (Gemini), se definen las reglas de comportamiento del agente "Hugo García" y se procesa cada mensaje que llega.

**Analogía:** Si el proyecto fuera una persona, `core.py` sería el cerebro: contiene la personalidad, los conocimientos, la memoria de la conversación y la capacidad de decidir qué hacer ante cada mensaje.

---

### Explicación línea por línea

#### Importaciones de herramientas

```python
from app.tools.memoria import query_sqlite, query_vector_db
from app.services.google_services import leer_datos_hoja
from app.services.siigo import *
from app.services.meli import (
    aprender_de_interacciones_meli,
    consultar_devoluciones_meli,
    ...
)
from app.tools.system_tools import (
    enviar_email_reporte,
    listar_archivos_proyecto,
    ...
)
from app.sync import (
    sincronizar_manual_por_id,
    sincronizar_inteligente,
    ...
)
```

Cada función importada aquí es una **herramienta que la IA puede usar**. Gemini no las usa automáticamente — las invoca cuando considera que son necesarias para responder al usuario. Es como darle a un empleado una caja de herramientas: el empleado decide cuál usar según el problema.

`from app.services.siigo import *` importa **todo** lo que está en `siigo.py`. El asterisco (`*`) es conveniente pero peligroso porque puede traer funciones con el mismo nombre que las de otros módulos y sobreescribirlas sin avisar.

---

#### El Prompt Maestro `INSTRUCCIONES_MCKENNA`

```python
INSTRUCCIONES_MCKENNA = """
Rol: Hugo García (McKenna Group). Operador Ejecutivo de ventas...
"""
```

Este texto largo es el **system prompt** o "instrucciones del sistema". Es el primer mensaje que recibe Gemini antes de cualquier conversación. Define:

- **Quién es el agente:** Hugo García, vendedor ejecutivo de McKenna Group
- **Reglas antibucle:** Le prohíbe ejecutar sincronizaciones cuando no se le piden, para no desperdiciar tokens
- **Tono:** Directo, colombiano, sin rodeos
- **Reglas de ventas:** Cómo saludar, cómo consultar inventario (sin revelar stock exacto), cómo cotizar paso a paso
- **Reglas de herramientas:** Qué herramientas usar en cada situación

**¿Por qué es importante?** Sin este prompt, Gemini respondería como un asistente genérico de Google. Con él, adopta el rol específico de un vendedor farmacéutico colombiano con acceso a herramientas de negocio.

---

#### Variable global `modelo_ia`

```python
modelo_ia = None
```

Esta variable almacena la instancia del modelo de Gemini. Es global para que todas las funciones del módulo puedan acceder a ella. Se inicializa como `None` y se asigna en `configurar_ia()`. Si algo falla durante la configuración, queda como `None` y las funciones que la usan retornan un mensaje de error.

---

#### Función `configurar_ia(app)`

```python
def configurar_ia(app):
    global modelo_ia
    try:
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
```

Crea el cliente de la API de Google Gemini usando la clave del archivo `.env`. `global modelo_ia` le dice a Python que la variable `modelo_ia` que vamos a asignar es la del módulo, no una nueva variable local.

```python
        todas_las_herramientas = [
            query_sqlite, query_vector_db, leer_datos_hoja,
            aprender_de_interacciones_meli, ...
        ]
```

Una lista de referencias a funciones (no se ejecutan aquí, solo se pasan). Gemini analiza la firma y el docstring de cada función para saber cuándo usarla.

```python
        modelo_ia = client.chats.create(
            model="gemini-2.5-pro",
            config=genai.types.GenerateContentConfig(
                tools=todas_las_herramientas,
                system_instruction=INSTRUCCIONES_MCKENNA,
            )
        )
```

Crea una **sesión de chat** con Gemini (no solo una llamada puntual). Una sesión de chat mantiene el historial de la conversación automáticamente, por lo que en la siguiente llamada Gemini recuerda lo que se dijo antes. Se configura con las herramientas disponibles y el prompt maestro.

---

#### Función `obtener_respuesta_ia(pregunta, usuario_id, historial)`

```python
def obtener_respuesta_ia(pregunta: str, usuario_id: str, historial: list = None):
    if not modelo_ia:
        return "Error: El modelo de IA no está configurado...", []
```

Verificación de guardia: si la IA no se inicializó (porque falló `configurar_ia`), retorna inmediatamente con un error claro en lugar de lanzar una excepción críptica.

```python
    response = modelo_ia.send_message(f"Usuario_{usuario_id}: {pregunta}")
```

Envía el mensaje a Gemini. Se prefija con `Usuario_{usuario_id}:` para que Gemini distinga quién está hablando cuando hay múltiples usuarios (útil en el contexto de WhatsApp donde muchas personas pueden escribir al mismo número).

```python
    if hasattr(response, 'usage_metadata'):
        usage = response.usage_metadata
        print(f"💰 Tokens Usados: Entrada={usage.prompt_token_count}...")
```

Imprime cuántos tokens consumió la llamada. Esto es crucial para monitorear costos: la API de Gemini cobra por tokens usados.

```python
    if not pregunta.startswith("BOT_"):
        respuesta_texto = response.text if hasattr(response, 'text') and response.text else "✅ Tarea ejecutada en segundo plano."
        return respuesta_texto, modelo_ia.get_history()
    else:
        return "", modelo_ia.get_history()
```

Si el mensaje que generó la llamada comienza con `"BOT_"`, significa que fue un mensaje interno del sistema (no de un humano real) y no debe responderse. Este es un mecanismo para ejecutar herramientas silenciosamente en segundo plano.

```python
    except Exception as e:
        error_str = str(e)
        if "function response turn" in error_str:
            return "❌ Se produjo un error con el historial...", []
```

Este manejo específico del error `"function response turn"` es importante: ocurre cuando el historial de chat queda en un estado inconsistente (por ejemplo, la IA pidió ejecutar una herramienta pero el resultado nunca llegó). La solución es retornar un historial vacío `[]`, lo que reinicia efectivamente la memoria de la conversación.

---

### Conexiones con otros archivos

| Este archivo es usado por... | ¿Para qué? |
|---|---|
| `agente_pro.py` | Inicializar la IA al arrancar |
| `app/routes.py` | Procesar mensajes de WhatsApp |
| `app/cli.py` | Procesar mensajes del menú de consola |
| `webhook_meli.py` | Procesar preguntas de MeLi |

| Este archivo llama a... | ¿Para qué? |
|---|---|
| Todos los `app/services/` | Registrar herramientas de negocio |
| Todos los `app/tools/` | Registrar herramientas de sistema |
| `app/sync.py` | Registrar herramientas de sincronización |

---

### ¿Por qué se hizo así?

**Sesión de chat en lugar de llamadas individuales:** `client.chats.create()` crea una sesión con memoria. Esto es más natural para conversaciones largas que `generate_content()` (que no recuerda nada). El trade-off es que si el servidor se reinicia, el historial se pierde.

**Todas las herramientas en un solo lugar:** Centralizar las herramientas en `core.py` facilita agregar o quitar capacidades. Para que la IA pueda hacer algo nuevo, solo hay que importar la función y agregarla a `todas_las_herramientas`.

---

## 4. `app/routes.py`

### ¿Para qué sirve?

Define las **puertas de entrada** del servidor web. Cada "ruta" (URL) es una puerta diferente:
- `/whatsapp` — por donde entran los mensajes de WhatsApp
- `/status` — por donde se puede verificar si el sistema está vivo
- `/chat` — por donde se puede hablar con la IA via HTTP con autenticación

**Analogía:** Es la recepción del edificio. Cada ventanilla atiende un tipo diferente de visitante y los dirige al lugar correcto.

---

### Explicación línea por línea

```python
borradores_aprobacion = {}
```

Un diccionario en memoria RAM que actúa como sala de espera temporal. Cuando la IA genera una respuesta de posventa o se recibe un comprobante de pago, se guarda aquí hasta que un humano la aprueba. La clave es el ID del cliente o de la orden, y el valor es el mensaje en espera.

**Limitación:** Si el servidor se reinicia, este diccionario se borra y se pierden todos los borradores pendientes. El código tiene un comentario `TODO` indicando que debería usarse Redis o una base de datos.

---

#### Función `register_routes(app)`

```python
def register_routes(app):
```

Recibe la instancia de Flask y le añade las rutas. Este patrón (en lugar de usar `@app.route` directamente) permite que `routes.py` no tenga que importar `app` como global, evitando importaciones circulares.

---

#### Endpoint `POST /whatsapp`

Esta función tiene cuatro flujos posibles dependiendo del tipo de mensaje recibido:

**Flujo 1 — Aprobación de pago:**
```python
if message_text.lower().startswith("pago ok"):
    target_sender = message_text.split()[-1]
    if target_sender in borradores_aprobacion:
        borradores_aprobacion.pop(target_sender)
        return jsonify({"status": "success", "respuesta": "¡Perfecto! ..."})
```

Si el mensaje dice `"pago ok 573001234567"`, el operador humano está confirmando que el pago de ese número fue válido. Se elimina de `borradores_aprobacion` (el cliente ya no está en espera) y se responde con confirmación. `message_text.split()[-1]` separa el mensaje por espacios y toma el último elemento (el número de teléfono).

**Flujo 2 — Detección de comprobante de pago:**
```python
if has_media and media_type == 'image':
    keywords_pago = ["bancolombia", "tarjeta", "nequi", ...]
    is_payment = any(keyword in message_text.lower() for keyword in keywords_pago)
    if is_payment or message_text == "":
        borradores_aprobacion[sender_id] = "esperando_validacion_pago"
        mensaje_aprobacion = (f"💰 *COMPROBANTE DE PAGO RECIBIDO*\n ...")
        enviar_whatsapp_reporte(mensaje_aprobacion)
```

Si llega un mensaje con imagen y menciona palabras relacionadas con pagos (o si la imagen viene sin texto), se asume que es un comprobante. Se pone al cliente en "sala de espera", se notifica al equipo por WhatsApp para que valide manualmente, y se le dice al cliente que están revisando.

**Flujo 3 — Aprobación de respuesta de posventa:**
```python
if message_text.lower().startswith("hugo dale ok"):
    target_order_id = message_text.split()[-1]
    if target_order_id in borradores_aprobacion:
        message_to_send = borradores_aprobacion.pop(target_order_id)
        resultado_envio = responder_mensaje_posventa(target_order_id, message_to_send)
```

Cuando el operador escribe `"hugo dale ok 1234567890"`, aprueba el envío de la respuesta de posventa que la IA generó para esa orden. Se saca el borrador de `borradores_aprobacion` y se envía a MeLi.

**Flujo 4 — Mensaje normal:**
```python
respuesta_ia, _ = obtener_respuesta_ia(message_text, sender_id)

if is_after_sale:
    borradores_aprobacion[order_id] = respuesta_ia
    enviar_whatsapp_reporte(mensaje_aprobacion)
    return jsonify({"status": "waiting_for_approval", ...})
else:
    return jsonify({"status": "success", "respuesta": respuesta_ia})
```

Para mensajes normales, se obtiene la respuesta de la IA. Si es un mensaje de posventa (`is_after_sale=True`), no se envía automáticamente: se guarda como borrador y se notifica al equipo para revisión humana. Si es un mensaje de ventas normal, se responde de inmediato.

---

#### Endpoint `GET /status`

```python
@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        "estado": "activo",
        "timestamp": datetime.now().isoformat(),
        "servicios": {
            "mercadolibre": os.path.exists("credenciales_meli.json"),
            "google": os.path.exists("credenciales_google.json"),
            "siigo": os.path.exists("credenciales_SIIGO.json")
        },
        "version": "1.0.0"
    })
```

Endpoint de salud. Verifica si los archivos de credenciales existen (no si las credenciales son válidas, solo si el archivo está presente). Útil para monitoreo externo: si `curl http://localhost:8081/status` devuelve `200`, el servidor está vivo.

---

#### Endpoint `POST /chat`

```python
token = request.headers.get('Authorization', '').replace('Bearer ', '')
if token != os.getenv('CHAT_API_TOKEN', ''):
    return jsonify({"error": "No autorizado"}), 401
```

Autenticación básica con token Bearer. El token debe pasarse en el header HTTP `Authorization: Bearer <token>`. Si no coincide con la variable `CHAT_API_TOKEN` del `.env`, rechaza la petición con error 401.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/core.py` → `obtener_respuesta_ia()` | Generar respuesta de la IA |
| `modulo_posventa.py` → `responder_mensaje_posventa()` | Enviar respuesta aprobada a MeLi |
| `app/utils.py` → `enviar_whatsapp_reporte()` | Notificar al equipo |

---

### ¿Por qué se hizo así?

**Flujo de aprobación humana:** Para mensajes de posventa, la IA no responde automáticamente. Esto es una decisión de negocio importante: una respuesta incorrecta a un cliente que acaba de comprar puede dañar la reputación. El humano tiene la última palabra.

**Palabras clave como comandos:** Los comandos `"pago ok"`, `"pago no"`, `"hugo dale ok"` son comandos que el operador envía desde WhatsApp al mismo número del bot. Es una forma ingeniosa de crear un flujo de aprobación sin necesidad de construir una interfaz web separada.

---

## 5. `app/cli.py`

### ¿Para qué sirve?

Es la **interfaz de consola** (menú de texto) que el operador usa desde la terminal. Permite ejecutar operaciones de negocio escribiendo un número, sin necesidad de abrir un navegador o una app. Corre en paralelo con el servidor web gracias al hilo secundario iniciado en `agente_pro.py`.

**Analogía:** Es el panel de control en la sala del servidor. El servidor web atiende clientes externos, y este menú es para el operador interno que necesita hacer mantenimiento o consultas directas.

---

### Menú principal (8 opciones)

```
══════════════════════════════════════════════════════════════
  🛠️  CENTRO DE MANDO — McKenna Group S.A.S.
══════════════════════════════════════════════════════════════
  1. 💬 CHAT         Conversa directo con el Agente (Hugo IA)
  2. 🔄 FACTURAS     Sync facturas MeLi ↔ Siigo — elige período
  3. 📊 STOCK        Reporte y sync de inventario entre plataformas
  4. 🔍 CONSULTA     Busca un producto en el catálogo de Google Sheets
  5. 🎓 APRENDIZAJE  Fuerza aprendizaje de Q&A recientes en MeLi
  6. 🧾 COMPRAS      Registra facturas de compra en SIIGO desde Gmail
  7. 🔬 CIENCIA      Genera contenido científico y publica en WordPress
  8. 🚪 SALIR        Apagar el Centro de Mando
══════════════════════════════════════════════════════════════
```

Las opciones con múltiples variantes (2 y 3) tienen **submenús** propios que se despliegan al seleccionarlas. Siempre se puede volver al menú principal con `[0]`.

---

### Explicación línea por línea

```python
import time
from app.sync import (
    sincronizar_inteligente,
    sincronizar_facturas_recientes,
    ejecutar_sincronizacion_y_reporte_stock,
    sincronizar_manual_por_id,
    sincronizar_por_dia_especifico
)
from app.services.google_services import leer_datos_hoja
from app.services.meli import aprender_de_interacciones_meli
from app.services.woocommerce import obtener_todos_los_productos_woocommerce, sincronizar_catalogo_woocommerce
from app.tools.verificacion_sync_skus import verificar_sync_skus
from app.core import obtener_respuesta_ia
```

Importa todas las funciones de negocio que el operador puede ejecutar. Al estar en `cli.py`, estas funciones no se ejecutan al importarse, solo se registran para usarse cuando el operador elija una opción.

---

#### Función `mostrar_menu()`

```python
def mostrar_menu():
    W = 62
    print("\n" + "═"*W)
    print("  🛠️  CENTRO DE MANDO — McKenna Group S.A.S.")
    print("═"*W)
    print("  1. 💬 CHAT         Conversa directo con el Agente (Hugo IA)")
    ...
```

Solo imprime texto formateado en pantalla. No tiene lógica. `W = 62` define el ancho de las líneas decorativas en un solo lugar — si se quiere cambiar el ancho, basta con cambiar ese número.

---

#### Función `_submenu_facturas()`

Agrupa todas las variantes de sincronización de facturas MeLi ↔ Siigo en un solo lugar. Al seleccionar la opción 2 desde el menú principal, se despliega este submenú:

```
  [1] Inteligente    Cruza pendientes MeLi vs Siigo (recomendado)
  [2] Últimas 24 h   Facturas emitidas en el último día
  [3] Últimos N días Tú ingresas cuántos días atrás buscar
  [4] Fecha exacta   Tú ingresas la fecha (AAAA-MM-DD)
  [5] Por Pack ID    Sincroniza una venta/pack específico
  [0] Volver al menú principal
```

- **Inteligente** → `sincronizar_inteligente()`: cruza las órdenes MeLi sin factura contra Siigo y sube los PDFs.
- **Últimas 24h** → `sincronizar_facturas_recientes(dias=1)`: caso más común para el cierre diario.
- **Últimos N días** → `sincronizar_facturas_recientes(dias=N)`: el operador ingresa cuántos días.
- **Fecha exacta** → `sincronizar_por_dia_especifico("AAAA-MM-DD")`: útil para re-procesar un día específico.
- **Por Pack ID** → `sincronizar_manual_por_id(pack_id)`: para casos puntuales de una sola venta.

---

#### Función `_submenu_stock()`

Agrupa las operaciones de inventario. Al seleccionar la opción 3:

```
  [1] Reporte completo   Sync total MeLi+WC y reporte de stock por WhatsApp
  [2] WooCommerce        Ver catálogo WC y sincronizar masivamente
  [3] Verificar SKUs     Auditoría de sincronización SKUs MeLi / SIIGO / WC
  [0] Volver al menú principal
```

- **Reporte completo** → `ejecutar_sincronizacion_y_reporte_stock()`: corre la sincronización full y envía un resumen al grupo de WhatsApp.
- **WooCommerce** → consulta todos los productos de WC con `obtener_todos_los_productos_woocommerce()`, los muestra en pantalla y pregunta si se quiere sincronizar masivamente.
- **Verificar SKUs** → `verificar_sync_skus(notificar_wa=True)`: audita que todos los SKUs estén sincronizados entre MeLi, SIIGO y WooCommerce, y notifica las discrepancias por WhatsApp.

---

#### Función `iniciar_cli()`

```python
def iniciar_cli():
    time.sleep(2)
```

Pausa 2 segundos antes de mostrar el menú. Esto asegura que Flask haya terminado de iniciar y que el mensaje `"🤖 Cerebro del Agente (IA) configurado y listo."` aparezca antes que el menú, para que la consola se vea ordenada.

```python
    import sys
    if not sys.stdin.isatty():
        print("[CLI] Sin terminal interactiva (systemd), menú deshabilitado.")
        return
```

Cuando el proceso corre como servicio de systemd (sin terminal real), `sys.stdin.isatty()` retorna `False`. En ese caso, el menú se desactiva automáticamente porque no hay nadie escribiendo en el teclado — el `input()` fallaría.

```python
    while True:
        mostrar_menu()
        opcion = input("  Seleccione una opción (1-8): ").strip()
```

Bucle infinito que muestra el menú y espera que el operador escriba un número. El `input()` bloquea el hilo hasta que se presiona Enter. `.strip()` elimina espacios o saltos de línea accidentales antes de comparar.

**Opción 1 — Modo chat:**
```python
        if opcion == "1":
            sesion_historial = []
            while True:
                user_input = input("👤 Tú: ")
                if user_input.lower() in ["salir", "exit", "menu", "volver"]:
                    break
                respuesta, nuevo_historial = obtener_respuesta_ia(
                    pregunta=user_input,
                    usuario_id="usuario_terminal_cli",
                    historial=sesion_historial
                )
                if nuevo_historial:
                    sesion_historial = nuevo_historial
                print(f"\n🤖 Agente: {respuesta}\n")
```

Entra en un sub-bucle de chat. `sesion_historial` se reinicia cada vez que se entra al modo chat (no es persistente entre sesiones). El `usuario_id` fijo `"usuario_terminal_cli"` le dice a la IA que el origen es la terminal, no un cliente de WhatsApp.

**Opciones 2 y 3 — Submenús:**
```python
        elif opcion == "2":
            _submenu_facturas()
        elif opcion == "3":
            _submenu_stock()
```

Delegan a las funciones de submenú. Cuando esas funciones retornan, el bucle principal muestra el menú principal de nuevo.

**Opción 8 — Salir:**
```python
        elif opcion == "8":
            print("👋 Apagando el Centro de Mando...")
            break
```

`break` sale del `while True` y termina la función `iniciar_cli()`. Como el hilo CLI tenía `daemon=True`, su terminación no afecta al servidor web.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/core.py` → `obtener_respuesta_ia()` | Modo chat (opción 1) |
| `app/sync.py` → varias funciones | Submenú de facturas (opción 2) |
| `app/services/woocommerce.py` → varias funciones | Submenú de stock (opción 3) |
| `app/tools/verificacion_sync_skus.py` → `verificar_sync_skus()` | Auditoría SKUs (opción 3) |
| `app/services/google_services.py` → `leer_datos_hoja()` | Consultar producto (opción 4) |
| `app/services/meli.py` → `aprender_de_interacciones_meli()` | Aprendizaje (opción 5) |
| `_ejecutar_opcion_10()` (interno) | Facturas de compra SIIGO (opción 6) |
| `_ejecutar_opcion_14()` (interno) | Contenido científico WP (opción 7) |

---

### ¿Por qué se hizo así?

**Menú numérico con submenús:** Agrupa funciones relacionadas (todas las variantes de sync de facturas juntas, todas las de stock juntas) en lugar de listarlas todas al mismo nivel. Reduce el menú principal de 14 a 8 opciones sin perder funcionalidad.

**Submenús como funciones separadas (`_submenu_facturas`, `_submenu_stock`):** Mantiene `iniciar_cli()` limpio y fácil de leer. Cada submenú puede crecer o modificarse sin tocar el bucle principal.

**Hilo separado:** Si el CLI corriera en el hilo principal, el servidor web se bloquearía mientras el operador espera en el menú. Al correr en un hilo separado, ambos coexisten sin interferirse.

---

## 6. `app/services/meli.py`

### ¿Para qué sirve?

Contiene todas las funciones que se comunican con la **API de Mercado Libre**. Es el "traductor" entre el proyecto y MeLi: toma pedidos en lenguaje Python y los convierte en llamadas HTTP que MeLi entiende.

**Analogía:** Es como un intérprete en una reunión de negocios. El resto del sistema habla "Python" y MeLi habla "HTTP/REST". Este archivo es quien traduce entre ambos.

---

### Explicación línea por línea

#### Función `consultar_devoluciones_meli()`

```python
def consultar_devoluciones_meli():
    token = refrescar_token_meli()
    if not token:
        return "❌ Error: No se pudo obtener el token de Mercado Libre."

    fecha_inicio = "2026-01-01T00:00:00.000-00:00"
    url = f"https://api.mercadolibre.com/orders/search?seller=me&order.date_created.from={fecha_inicio}"
    headers = {"Authorization": f"Bearer {token}"}
```

Primero renueva el token. Si falla, retorna error inmediatamente (patrón **early return**). La `fecha_inicio` está hardcodeada — esto significa que si el año cambia, esta fecha quedaría desactualizada y habría que actualizarla manualmente.

```python
    data = res.json().get('results', [])
    devoluciones = [o for o in data if o.get('status') in ['cancelled', 'invalid']]
```

Filtra las órdenes usando **list comprehension** (una forma compacta de crear listas con condiciones). Solo guarda las órdenes cuyo estado es `cancelled` o `invalid`.

---

#### Función `consultar_detalle_venta_meli(pack_id)`

```python
def consultar_detalle_venta_meli(pack_id: str):
    url = f"https://api.mercadolibre.com/orders/{pack_id}"
    res = requests.get(url, headers=headers, timeout=10)
    if res.status_code == 200:
        data = res.json()
        return (f"✅ Venta {pack_id} encontrada.\n"
                f"- Fecha: {data.get('date_created')}\n"
                f"- Estado: {data.get('status')}\n"
                f"- Valor: ${data.get('total_amount')}")
```

Consulta los detalles de una venta específica por su ID. `timeout=10` significa que si MeLi no responde en 10 segundos, lanza un error en lugar de esperar indefinidamente. Retorna un texto formateado listo para mostrar al usuario.

---

#### Función `subir_factura_meli(pack_id, pdf_base64)`

```python
def subir_factura_meli(pack_id, pdf_base64):
    pdf_puro = str(pdf_base64).strip().replace("\n", "").replace("\r", "")
    if "," in pdf_puro:
        pdf_puro = pdf_puro.split(",")[1]
    pdf_decodificado = base64.b64decode(pdf_puro)
```

El PDF llega como texto en formato base64 (base64 convierte archivos binarios en texto para poder transmitirlos como JSON). Aquí se limpia ese texto (eliminando saltos de línea y posibles prefijos como `data:application/pdf;base64,`) y luego se decodifica de vuelta a bytes binarios.

```python
    url = f"https://api.mercadolibre.com/packs/{pack_id}/fiscal_documents"
    files = {'file': (f"Fac_{pack_id}.pdf", pdf_decodificado, 'application/pdf')}
    res = requests.post(url, headers=headers, files=files, timeout=30)
```

Sube el PDF a MeLi como un archivo adjunto. El diccionario `files` le dice a `requests` que esto es una subida de archivo multipart (como cuando subes una foto en un formulario web). `timeout=30` porque las subidas de archivos pueden tardar más que una consulta simple.

---

#### Función `aprender_de_interacciones_meli()`

Esta es la función más compleja del archivo. Implementa el ciclo de **aprendizaje automático** del agente.

```python
chroma_client = chromadb.PersistentClient(path="./memoria_vectorial")
coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")
```

Conecta a ChromaDB, una base de datos vectorial que almacena texto de forma que se puede buscar por similitud semántica (no solo por palabras exactas). La colección `"mckenna_brain"` es donde vive el conocimiento aprendido.

```python
url = "https://api.mercadolibre.com/my/received_questions/search?status=ANSWERED&limit=15"
preguntas = res.json().get('questions', [])
texto_bruto = "Historial de interacciones recientes con clientes en Mercado Libre:\n"
for q in preguntas:
    texto_bruto += f"- Pregunta del cliente: {q.get('text')}\n  - Nuestra respuesta: {q.get('answer', {}).get('text')}\n\n"
```

Descarga las últimas 15 preguntas respondidas de MeLi y las convierte en un texto continuo que incluye tanto la pregunta como la respuesta.

```python
prompt = (
    f"Actúa como un técnico en farmacología experto... "
    f"Identifica los patrones, las dudas más comunes..."
    f"Resume esto en un párrafo conciso como una 'lección aprendida'..."
    f"\n--- HISTORIAL ---\n{texto_bruto}"
)
response = client.models.generate_content(model='gemini-2.0-flash-lite', contents=prompt)
aprendizaje_generado = response.text
```

Envía las 15 preguntas+respuestas a Gemini Flash (un modelo más económico y rápido que el principal) y le pide que lo convierta en una sola "lección aprendida" densa.

```python
doc_id = f"exp_meli_{int(time.time())}"
coleccion_experiencia.add(
    documents=[aprendizaje_generado],
    metadatas=[{"fuente": "meli_qa_auto", "fecha": str(datetime.now().date())}],
    ids=[doc_id]
)
```

Guarda la lección generada en ChromaDB con un ID único basado en el timestamp. En el futuro, cuando llegue una pregunta similar, la función `query_vector_db` puede recuperar esta lección para que Hugo García responda con más contexto.

---

#### Función `responder_solicitud_rut(order_id)`

```python
def responder_solicitud_rut(order_id):
    clean_id = str(order_id).replace("Venta #", "").strip()
    print(f"📦 [MELI-RUT] Enviando mensaje de RUT a la orden: {clean_id}")
    return f"✅ Solicitud de RUT procesada para la orden {clean_id}."
```

Esta función está **incompleta** — tiene un `TODO` en el código que indica que la lógica real de enviar el mensaje a MeLi todavía no está implementada. Por ahora solo limpia el ID y retorna un mensaje de éxito sin hacer nada real.

---

#### Función `buscar_ventas_acordar_entrega(dias=3)`

```python
res_me = requests.get("https://api.mercadolibre.com/users/me", headers=headers)
res_me.raise_for_status()
seller_id = res_me.json().get('id')
```

Primero obtiene el ID del vendedor consultando el endpoint `/users/me` de MeLi. `raise_for_status()` lanza una excepción automáticamente si el status HTTP es 4xx o 5xx, evitando tener que verificar manualmente.

```python
         for orden in res.get('results', []):
             shipping_type = shipping_info.get('substatus') or shipping_info.get('shipping_mode')

---

## 10. Nuevas Skills (Herramientas Autónomas)

### ¿Para qué sirve?

El agente "Hugo García" ha evolucionado. Originalmente dependía de scripts que se ejecutaban manualmente desde la consola. Ahora posee **Skills nativas**, es decir, scripts refactorizados en funciones estructurales (`app/tools/`) que la IA (Claude/Gemini) puede invocar autónomamente cuando entiende que las necesitas, usando *Tool Calling*.

### Arquitectura e Interacción

En `app/core.py`, la función `_fn_to_tool_schema()` traduce automáticamente cada función de Python con Type Hints y Docstrings a un esquema JSON compatible con el modelo de IA. 
Cuando conversas con el agente y le pides una tarea:
1. La IA evalúa su lista de herramientas.
2. Emite un *tool_call* con los argumentos necesarios (por ejemplo, el slug del producto, o el email destino).
3. El sistema ejecuta la función en `app/tools/`.
4. El resultado (texto de éxito o error) se envía de vuelta a la IA, quien genera la respuesta conversacional final.

### Ejemplos de Skills

| Nombre de Skill | Archivo | Descripción | Ejemplo de uso en el chat |
|---|---|---|---|
| `sincronizar_precios_meli_sheets` | `sincronizar_precios.py` | Sincroniza precios desde MercadoLibre hacia Google Sheets e invalida el caché web. | *"Hugo, actualiza los precios en el Sheets usando los de MeLi"* |
| `generar_catalogo_pdf` | `generar_catalogo.py` | Genera PDF corporativo leyendo de Sheets y bajando fotos de MeLi. Opcional envío WA. | *"Genera el catálogo PDF corporativo de este mes"* |
| `generar_reporte_skus_woocommerce` | `generar_reporte_skus.py` | Genera y envía un correo HTML con el reporte de discrepancias de SKUs (MeLi-SIIGO-WC). | *"Revisa los SKUs de WooCommerce y mándame el reporte"* |
| `sincronizar_catalogo_wc_desde_meli` | `sincronizar_wc_desde_meli.py` | Elimina el catálogo de WC y lo reconstruye basado en publicaciones activas de MeLi. | *"Hugo, reconstruye el catálogo de WooCommerce desde MeLi"* |
| `publicar_contenido_redes_sociales_ia` | `pipeline_contenido_facebook.py` | Corre el pipeline multimedia (Gemini→Ideogram→ElevenLabs→Kling) y publica en Facebook. | *"Haz un nuevo post para Facebook"* |
| `generar_guias_masivas_web` | `generar_guias_masivas.py` | Consume PubMed y Gemini para crear guías técnicas en JSON para el frontend web. | *"Hugo, genera las guías masivas que faltan en la web"* |

### ¿Cómo agregar una nueva Skill?
1. Escribe tu función en un nuevo archivo dentro de `app/tools/`.
2. Añade docstrings claros (`"""..."""`) y Type Hints (ej: `def mi_skill(param: str) -> str:`).
3. Importa la función en `app/core.py` y agrégala a la lista `todas_las_herramientas` dentro de `configurar_ia()`.
4. ¡El agente inmediatamente sabrá que existe y cómo usarla!
    if orden.get('status') == 'paid' and shipping_type in ['to_agree', 'custom', 'not_specified']:
        ordenes_encontradas.append(str(orden.get('id')))
```

Filtra órdenes que están pagadas pero cuyo envío es "a acordar con el comprador" (no usan el sistema de envíos de MeLi). Estas necesitan coordinación manual con el comprador.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/utils.py` → `refrescar_token_meli()` | Obtener token válido antes de cada llamada |
| API de MeLi (externa) | Todas las operaciones |
| ChromaDB (base de datos local) | Guardar aprendizajes |
| Gemini API (Google) | Generar resúmenes de aprendizaje |

| Es llamado desde... | ¿Para qué? |
|---|---|
| `app/core.py` | Registrar funciones como herramientas de la IA |
| `app/cli.py` | Opción 8 del menú (aprendizaje) |
| `app/sync.py` | Subir facturas a órdenes de MeLi |

---

### ¿Por qué se hizo así?

**Refrescar token antes de cada llamada:** Los tokens de OAuth expiran. En lugar de verificar si expiró y luego refrescar, se refresca siempre antes de usarlo. Esto garantiza que nunca se haga una llamada con un token vencido, a costa de una pequeña llamada extra ocasional.

**Retornar strings en lugar de lanzar excepciones:** Las funciones retornan mensajes de error como `"❌ Error: ..."` en lugar de lanzar excepciones. Esto facilita el uso desde la IA: Gemini puede leer el mensaje de error y decidir qué hacer, mientras que una excepción no capturada rompería la conversación.

---

## 7. `app/services/siigo.py`

### ¿Para qué sirve?

Contiene todas las funciones que se comunican con **SIIGO**, el sistema ERP (Enterprise Resource Planning) usado para crear facturas electrónicas oficiales, cotizaciones y gestionar documentos contables. Es el módulo más grande y crítico del proyecto porque maneja dinero real y documentos con validez ante la DIAN (entidad fiscal colombiana).

**Analogía:** Si MeLi es la vitrina donde los clientes compran, SIIGO es el contador de la empresa que genera los recibos oficiales y los reporta al gobierno.

---

### Explicación línea por línea

#### Función `autenticar_siigo(forzar=False)`

```python
def autenticar_siigo(forzar=False):
    ruta_json = os.path.expanduser("~/mi-agente/credenciales_SIIGO.json")
    with open(ruta_json, "r") as f:
        creds = json.load(f)
```

Lee las credenciales desde el archivo JSON. `os.path.expanduser("~")` convierte `~` en la ruta completa del directorio home del usuario (ej: `/home/mckg`).

```python
    if not forzar and time.time() < creds.get("token_vencimiento", 0):
        return creds["access_token"]
```

Si el token guardado todavía no ha expirado (y no se forzó el refresco), lo devuelve directamente sin hacer una llamada a SIIGO. Este es un **caché de token**: evita autenticarse en cada llamada, lo cual sería lento e innecesario.

```python
    res = requests.post(
        "https://api.siigo.com/auth",
        json={"username": creds["username"], "access_key": creds["api_key"]},
        headers={"Partner-Id": PARTNER_ID},
        timeout=10
    )
```

Si el token expiró, hace una nueva autenticación. `Partner-Id` es un header requerido por SIIGO para identificar que la llamada viene de una integración externa (no del portal web de SIIGO).

```python
    if res.status_code == 200:
        token = res.json().get("access_token")
        creds.update({"access_token": token, "token_vencimiento": time.time() + (23 * 3600)})
        with open(ruta_json, "w") as f:
            json.dump(creds, f)
        return token
```

Guarda el nuevo token en el mismo archivo JSON junto con su tiempo de expiración (23 horas desde ahora). Así el próximo uso no requiere autenticación.

---

#### Función `obtener_facturas_siigo_paginadas(fecha_inicio)`

```python
page = 1
while True:
    res = requests.get(
        f"https://api.siigo.com/v1/invoices?created_start={fecha_inicio}&page={page}",
        ...
    )
    facturas_pagina = data.get("results")
    if facturas_pagina:
        todas_las_facturas.extend(facturas_pagina)
        if not data.get("pagination") or data["pagination"]["total_results"] == len(todas_las_facturas):
            break
        page += 1
    else:
        break
```

La API de SIIGO devuelve las facturas de a páginas (por ejemplo, 50 por página). Este bucle sigue pidiendo páginas hasta que el total de facturas descargadas sea igual al `total_results` que SIIGO reporta. `extend()` agrega todos los elementos de una lista a otra (a diferencia de `append()` que agrega la lista como un solo elemento).

---

#### Función `descargar_factura_pdf_siigo(id_factura)`

```python
res = requests.get(
    f"https://api.siigo.com/v1/invoices/{id_factura}/pdf",
    ...
)
if res.status_code == 200:
    return res.json().get("base64", "")
```

Descarga el PDF de una factura en formato base64 (texto que representa el PDF binario). Este texto luego se convierte de nuevo a binario para guardarlo como archivo o subirlo a MeLi.

---

#### Función `crear_cotizacion_siigo(nombre_cliente, ...)`

```python
cliente_data = {
    "person_type": "Person",
    "id_type": "13",  # Cédula de ciudadanía
    "identification": identificacion,
    ...
}
```

Construye el objeto "cliente" con la estructura que espera la API de SIIGO. `id_type: "13"` es el código de SIIGO para cédula de ciudadanía colombiana.

```python
payload = {
    "document": {"id": 5804},  # Factura de Venta estándar
    "seller": 704,  # Vendedor: Victor Hugo Garcia Barrero
    "observations": "COTIZACIÓN: Este documento es una factura en estado de borrador...",
    ...
}
```

Los valores `5804` y `704` son IDs específicos configurados en SIIGO para esta empresa. Si se cambia de empresa o de SIIGO, estos IDs cambiarían. Las observaciones dejan claro que es una cotización, no una factura real.

```python
resultado_email = enviar_email_reporte("Cotización McKenna Group", mensaje_email, email)
from app.utils import enviar_whatsapp_reporte
enviar_whatsapp_reporte(mensaje_wa)
```

Después de crear la cotización en SIIGO, envía una copia por correo al cliente y notifica al equipo por WhatsApp. Nótese la importación local (`from app.utils import ...` dentro de la función) para evitar importaciones circulares entre módulos.

---

#### Función `crear_cotizacion_preliminar(nombre_cliente, ...)`

```python
cotizacion = {
    "id_preliminar": f"PRE-{int(time.time())}",
    ...
}
os.makedirs("cotizaciones_preliminares", exist_ok=True)
file_path = f"cotizaciones_preliminares/{cotizacion['id_preliminar']}.json"
with open(file_path, "w") as f:
    json.dump(cotizacion, f, indent=4)
```

A diferencia de `crear_cotizacion_siigo`, esta función **no llama a la API de SIIGO**. Guarda la cotización como un archivo JSON local. El `id_preliminar` usa el timestamp Unix (`int(time.time())`) para garantizar que sea único. `exist_ok=True` evita un error si la carpeta ya existe.

**¿Por qué existe esta función?** Crear una factura en SIIGO es un proceso irreversible desde el punto de vista fiscal. Se usa esta función como "borrador" mientras el cliente confirma y paga, y solo se crea la factura real en SIIGO cuando el pago está confirmado.

---

#### Función `crear_factura_completa_siigo(cotizacion_data, comprobante_pago_path)`

Esta es la función más larga y la más crítica. Hace cuatro cosas encadenadas:

**Paso 1 — Crear factura en SIIGO:**
```python
payload = {
    "document": {"id": 26670},  # ID de Documento para Factura Electrónica de Venta
    "customer": {
        "id_type": "13" if len(identificacion) <= 10 else "31",  # 13: Cédula, 31: NIT
        "person_type": "Person" if len(identificacion) <= 10 else "Company",
        ...
    },
    ...
}
```

Detecta si el cliente es persona natural (cédula, máximo 10 dígitos) o empresa (NIT, más de 10 dígitos) para asignar el tipo correcto en SIIGO. Esto es un requisito de la DIAN colombiana.

**Paso 2 — Verificar estado ante la DIAN:**
```python
time.sleep(2)  # Dar tiempo a que se procese en la DIAN
res_get = requests.get(f"https://api.siigo.com/v1/invoices/{factura_id}", ...)
estado_factura = factura_siigo.get("stamp", {}).get("status", "Desconocido")
if estado_factura == "Rejected":
    observaciones_adicionales = f"\n⚠️ *Estado DIAN:* RECHAZADA. Inconsistencias: {inconsistencias}"
```

Espera 2 segundos y luego consulta el estado de la factura ante la DIAN. La DIAN puede aceptar o rechazar facturas electrónicas. Si es rechazada, se incluye el motivo en el reporte.

**Paso 3 — Adjuntar comprobante de pago:**
```python
if comprobante_pago_path and os.path.exists(comprobante_pago_path):
    with open(comprobante_pago_path, "rb") as f:
        encoded_file = base64.b64encode(f.read()).decode('utf-8')
    att_res = requests.post(
        f"https://api.siigo.com/v1/invoices/{factura_id}/attachments",
        json={"file_name": ..., "base64": encoded_file},
        ...
    )
```

Si se proporcionó una imagen de comprobante de pago, la convierte a base64 y la sube como adjunto a la factura en SIIGO.

**Paso 4 — Enviar reportes:**
```python
enviar_whatsapp_reporte(mensaje_wa)  # Resumen de texto
if pdf_path:
    enviar_whatsapp_archivo(pdf_path, ...)  # PDF de la factura
if comprobante_pago_path:
    enviar_whatsapp_archivo(comprobante_pago_path, ...)  # Comprobante
```

Envía tres cosas al grupo de WhatsApp del equipo: el resumen de texto, el PDF de la factura y el comprobante del cliente.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/tools/system_tools.py` → `enviar_email_reporte()` | Enviar cotización por email |
| `app/utils.py` → `enviar_whatsapp_reporte()` | Notificar al equipo |
| API de SIIGO (externa) | Todas las operaciones contables |
| DIAN (implícito via SIIGO) | Validación fiscal de facturas |

| Es llamado desde... | ¿Para qué? |
|---|---|
| `app/core.py` | Registrar funciones como herramientas de la IA |
| `app/sync.py` | Obtener facturas para sincronizar con MeLi |

---

### ¿Por qué se hizo así?

**Caché de token en archivo JSON:** Los tokens de SIIGO duran 24 horas. Guardar el token en el mismo archivo de credenciales evita tener que autenticarse en cada llamada (que sería lento). El archivo JSON actúa como un almacén de estado persistente entre ejecuciones del programa.

**Dos tipos de cotización:** `crear_cotizacion_preliminar` (local) y `crear_cotizacion_siigo` (en el ERP) responden a diferentes momentos del proceso de venta. La local es para "apartarle al cliente" sin comprometer nada fiscalmente.

---

## 8. `app/tools/system_tools.py`

### ¿Para qué sirve?

Contiene herramientas que le dan a la IA capacidades de **administración del sistema**: leer y editar código del propio proyecto, hacer backups, ejecutar scripts, y enviar correos. Son herramientas "meta" — la IA puede usarlas para modificarse a sí misma o para comunicarse.

**Analogía:** Si las otras herramientas son el trabajo del día a día, estas son las herramientas del taller de mantenimiento. Con ellas, el agente puede hacer ajustes al sistema mientras está corriendo.

**Nota de seguridad:** `parchear_funcion` y `ejecutar_script_python` son herramientas poderosas. Permiten que la IA modifique y ejecute código arbitrario. En producción, esto debe usarse con mucho cuidado.

---

### Explicación línea por línea

#### Función `listar_archivos_proyecto(path)`

```python
def listar_archivos_proyecto(path: str = '.') -> str:
    archivos = os.listdir(path)
    resultado = f"Contenido de '{path}':\n"
    for i, nombre in enumerate(sorted(os.listdir(path))):
        ruta_completa = os.path.join(path, nombre)
        es_dir = "[DIR]" if os.path.isdir(ruta_completa) else "[FILE]"
        resultado += f"{i+1}. {es_dir:6} {nombre}\n"
    return resultado
```

Lista el contenido de un directorio. `sorted()` ordena alfabéticamente. `os.path.isdir()` detecta si es una carpeta o un archivo. `{es_dir:6}` formatea el texto con 6 caracteres de ancho para que las columnas queden alineadas. Retorna texto plano para que la IA pueda leerlo y describírselo al usuario.

---

#### Función `crear_backup(ruta_archivo)`

```python
def crear_backup(ruta_archivo: str) -> str:
    os.makedirs("backups", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nombre_base = os.path.basename(ruta_archivo)
    ruta_backup = os.path.join("backups", f"{nombre_base}.{timestamp}.bak")
    shutil.copy2(ruta_archivo, ruta_backup)
    return f"✅ Éxito: Backup creado en {ruta_backup}"
```

Copia un archivo a la carpeta `/backups/` con el timestamp en el nombre para que nunca se sobreescriba un backup anterior. `shutil.copy2` copia el archivo preservando los metadatos (fecha de creación, permisos). Esta función se llama automáticamente antes de `parchear_funcion` como medida de seguridad.

---

#### Función `leer_funcion(ruta_archivo, nombre_funcion)`

```python
def leer_funcion(ruta_archivo: str, nombre_funcion: str) -> str:
    with open(ruta_archivo, 'r', encoding='utf-8') as f:
        source_code = f.read()
    tree = ast.parse(source_code)
    for nodo in ast.walk(tree):
        if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
            return f"""python\n{ast.unparse(nodo)}\n"""
```

Usa el módulo `ast` (Abstract Syntax Tree) de Python para analizar el código fuente como un árbol de objetos en lugar de texto plano. `ast.parse()` convierte el texto del archivo en un árbol de nodos. `ast.walk()` recorre todos los nodos del árbol. `isinstance(nodo, ast.FunctionDef)` verifica si el nodo es una definición de función. `ast.unparse()` convierte el nodo de vuelta a código Python legible.

**¿Por qué usar AST en lugar de buscar con texto?** Porque buscar la función con `"def nombre_funcion"` en texto podría encontrar comentarios o cadenas que contengan esas palabras. AST analiza el código como Python realmente lo interpreta, sin confusiones.

---

#### Función `parchear_funcion(ruta_archivo, nombre_funcion, nuevo_codigo_funcion)`

```python
def parchear_funcion(ruta_archivo: str, nombre_funcion: str, nuevo_codigo_funcion: str) -> str:
    ast.parse(nuevo_codigo_funcion)  # Verificar sintaxis antes de tocar el archivo
    backup_msg = crear_backup(ruta_archivo)
    if "❌" in backup_msg:
        return f"No se pudo aplicar el parche porque falló la creación del backup: {backup_msg}"
```

Primero verifica que el nuevo código sea sintácticamente válido con `ast.parse()`. Si el código tiene errores de Python, `ast.parse()` lanza un `SyntaxError` que se captura más abajo. Luego crea un backup. Si el backup falla, cancela toda la operación — no tiene sentido modificar el archivo si no podemos revertirlo.

```python
    with open(ruta_archivo, 'r', encoding='utf-8') as f:
        lineas = f.readlines()
    tree = ast.parse("".join(lineas))
    inicio, fin = -1, -1
    for nodo in ast.walk(tree):
        if isinstance(nodo, ast.FunctionDef) and nodo.name == nombre_funcion:
            inicio, fin = nodo.lineno - 1, nodo.end_lineno
            break
```

Busca la función en el árbol AST para obtener los números de línea exactos donde empieza (`lineno`) y termina (`end_lineno`). Se resta 1 a `lineno` porque las líneas en Python empiezan en 1 pero los índices de lista empiezan en 0.

```python
    nuevas_lineas = lineas[:inicio] + [nuevo_codigo_funcion + "\n"] + lineas[fin:]
    with open(ruta_archivo, 'w', encoding='utf-8') as f:
        f.writelines(nuevas_lineas)
```

Reemplaza las líneas de la función antigua con el nuevo código usando slicing de listas: toma todo lo que está antes de la función, agrega el nuevo código, y agrega todo lo que está después. Luego escribe el resultado de vuelta al archivo.

---

#### Función `crear_nuevo_script(nombre_archivo, codigo_completo)`

```python
def crear_nuevo_script(nombre_archivo: str, codigo_completo: str) -> str:
    if not nombre_archivo.endswith('.py'):
        return "❌ Error: El nombre debe terminar en '.py'."
    ast.parse(codigo_completo)
    with open(nombre_archivo, 'w', encoding='utf-8') as f:
        f.write(codigo_completo)
    return f"✅ Script '{nombre_archivo}' creado."
```

Crea un nuevo archivo Python. Valida que el nombre termine en `.py` y que el código sea sintácticamente válido antes de crear el archivo. Nótese que no crea un backup porque el archivo es nuevo (no hay nada que respaldar).

---

#### Función `ejecutar_script_python(nombre_archivo)`

```python
def ejecutar_script_python(nombre_archivo: str) -> str:
    resultado = subprocess.run(
        [sys.executable, nombre_archivo],
        capture_output=True,
        text=True,
        timeout=45,
        check=False
    )
    salida = f"--- Salida de {nombre_archivo} ---\n{resultado.stdout}\n"
    if resultado.stderr:
        salida += f"--- Errores de {nombre_archivo} ---\n{resultado.stderr}\n"
    salida += f"--- Código de salida: {resultado.returncode} ---"
    return salida
```

- `sys.executable` es la ruta al intérprete de Python actual (el mismo que está corriendo el agente). Esto asegura que el script use el mismo Python y el mismo entorno virtual.
- `capture_output=True` captura `stdout` y `stderr` en lugar de imprimirlos en la consola.
- `text=True` convierte la salida de bytes a string.
- `timeout=45` mata el proceso si tarda más de 45 segundos.
- `check=False` no lanza excepción si el script falla (el error queda en `returncode`).

La función captura tanto la salida normal como los errores y los retorna juntos para que la IA pueda interpretarlos.

---

#### Función `enviar_email_reporte(destinatario, asunto, cuerpo)`

```python
def enviar_email_reporte(destinatario: str, asunto: str, cuerpo: str) -> str:
    remitente = os.getenv("EMAIL_SENDER")
    password = os.getenv("EMAIL_PASSWORD")

    msg = MIMEMultipart()
    msg['From'] = remitente
    msg['To'] = destinatario
    msg['Subject'] = asunto
    msg.attach(MIMEText(cuerpo, 'plain'))

    server = smtplib.SMTP('smtp.gmail.com', 587)
    server.starttls()
    server.login(remitente, password)
    server.send_message(msg)
    server.quit()
```

Envía un correo usando Gmail como servidor SMTP. `MIME` (Multipurpose Internet Mail Extensions) es el estándar para formatear correos. `MIMEMultipart` permite adjuntar múltiples partes (texto, archivos). `starttls()` activa el cifrado TLS para que la contraseña no viaje en texto plano. `587` es el puerto estándar para SMTP con TLS.

**Requisito:** En Gmail debe activarse "Acceso de apps menos seguras" o crear una "Contraseña de aplicación" para que el login funcione.

---

#### Función `enviar_reporte_controlado(mensaje)`

```python
def enviar_reporte_controlado(mensaje):
    print("\n" + "═"*40 + f"\n📋 REPORTE GENERADO:\n{mensaje}\n" + "═"*40)
    if True:  # ← Bug conocido
        from app.utils import enviar_whatsapp_reporte
        return enviar_whatsapp_reporte(mensaje)
    print("Envío cancelado por el usuario.")  # ← Esta línea nunca se ejecuta
    return False
```

Esta función tiene un **bug evidente**: la condición `if True:` siempre es verdadera, así que el `print("Envío cancelado")` y el `return False` son código inalcanzable (dead code). El comentario `TODO` en el código indica que originalmente debía pedir confirmación con `input()`, pero fue simplificado. Actualmente siempre envía el mensaje sin preguntar.

---

### Conexiones con otros archivos

| Este archivo llama a... | ¿Para qué? |
|---|---|
| `app/utils.py` → `enviar_whatsapp_reporte()` | Enviar reportes por WhatsApp |

| Es llamado desde... | ¿Para qué? |
|---|---|
| `app/core.py` | Registrar funciones como herramientas de la IA |
| `app/services/siigo.py` → `crear_cotizacion_siigo()` | Enviar email de cotización |

---

### ¿Por qué se hizo así?

**AST en lugar de regex para el código:** Manipular código fuente con expresiones regulares es frágil (¿qué pasa si hay una función con el mismo nombre dentro de otra clase? ¿O dentro de un string multiline?). AST entiende la estructura real del código Python y no se confunde con estos casos.

**Backup obligatorio antes de parchear:** Cualquier modificación de código en producción sin red de seguridad es peligrosa. Al forzar el backup, siempre hay un punto de restauración si el parche rompe algo.

**Timeout en la ejecución de scripts:** Sin timeout, un script con un bucle infinito bloquearía el hilo del agente para siempre. 45 segundos es suficiente para la mayoría de las tareas de negocio pero evita bloqueos indefinidos.

---

## RESUMEN DE FLUJO COMPLETO

```
┌─────────────────────────────────────────────────────────────────┐
│                    INICIO: agente_pro.py                        │
│   1. load_dotenv()  →  2. configurar_ia()  →  3. CLI + Flask   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼──────────────────┐
         ↓                 ↓                  ↓
  Puerto 8081          Puerto 8080        Terminal
  routes.py          webhook_meli.py      cli.py
  /whatsapp             /notifications    Menú 1-11
  /chat                 /status
  /status
         │                 │                  │
         └─────────────────┼──────────────────┘
                           ↓
                      core.py
                   Gemini AI + Tools
                           │
           ┌───────────────┼───────────────────┐
           ↓               ↓                   ↓
       meli.py          siigo.py         system_tools.py
    API MeLi           API SIIGO         Email/Files/Code
    (ventas,           (facturas,
    preguntas,         cotizaciones,
    aprendizaje)       PDF)
```

---

*Este manual fue generado el 2026-03-28 para el proyecto McKenna Group Agente v1. Última actualización: 2026-04-06.*

---

## 9. APIs de Generación de Contenido Multimedia (consola)

> **Nota:** Estas integraciones **no forman parte del menú del Centro de Mando**. Se usan directamente desde la terminal con scripts independientes. Se documentan aquí como recordatorio de que ya están implementadas y listas para usar cuando se necesite crear contenido.

### APIs integradas

| API | Proveedor | Para qué se usa |
|-----|-----------|-----------------|
| **Ideogram** | Ideogram AI | Generación de imágenes con texto — fondos visuales para infografías |
| **ElevenLabs** | ElevenLabs | Síntesis de voz (TTS) — narración en español colombiano para videos |
| **fal.ai / Kling** | fal.ai | Generación de video desde imagen o texto (Kling text-to-video v1.6) |
| **PIL / Pillow** | Python | Composición de infografías — superpone texto y logo sobre las imágenes |
| **ffmpeg** | ffmpeg | Fallback de video local — efecto Ken Burns y concatenación de clips |
| **Facebook Graph API** | Meta | Publicación de fotos, posts y videos en la página de McKenna Group |

### Scripts disponibles

| Script | Comando | ¿Qué hace? |
|--------|---------|------------|
| `pipeline_contenido_facebook.py` | `python3 pipeline_contenido_facebook.py --tipo ficha --slug acido-ascorbico` | Pipeline completo: copy (Gemini) → imagen (Ideogram) → voz (ElevenLabs) → video (Kling) → publica en Facebook |
| `generar_infografias_facebook.py` | `python3 generar_infografias_facebook.py --tipo ficha --n 3` | Genera infografías estáticas con PIL y las publica en Facebook (sin video ni audio) |
| `sincronizar_facebook.py` | `python3 sincronizar_facebook.py` | Limpia la página de Facebook y la republica con productos, guías y blog posts actuales |

### Tipos de contenido del pipeline

- **`ficha`** — Infografía de un ingrediente (beneficios, concentración, compatibilidad)
- **`receta`** — Fórmula paso a paso con ingredientes visuales
- **`comparativa`** — Dos ingredientes frente a frente
- **`tip`** — Consejo profesional de formulación
- **`--auto`** — El sistema elige automáticamente qué contenido publicar a continuación

### Credenciales requeridas (en `.env`)

```
GOOGLE_API_KEY        # Gemini — generación de copy
IDEOGRAM_API_KEY      # Ideogram — generación de imágenes
ELEVENLABS_API_KEY    # ElevenLabs — síntesis de voz
FAL_KEY               # fal.ai — generación de video con Kling
FB_PAGE_TOKEN         # Facebook Graph API — publicación en página
FB_PAGE_ID            # ID de la página de Facebook de McKenna Group
```
