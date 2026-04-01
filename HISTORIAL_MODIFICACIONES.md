# Historial de Modificaciones — McKenna Agent

Registro cronológico de cambios significativos al proyecto. Cada entrada incluye el contexto, el error/motivación, la solución implementada y lecciones para no repetir errores.

---

## Sesión 2026-04-01

### 1. Sincronización bidireccional de stock MeLi ↔ WooCommerce

**Motivación:** El stock entre MeLi y WooCommerce estaba desincronizado. Una venta en cualquier canal no se reflejaba en el otro.

**Diseño adoptado:**
- Cada plataforma es fuente de verdad de su propio stock post-venta (ambas decrementan automáticamente al registrar la venta).
- Al recibir notificación de venta: leer el stock resultante de la plataforma que vendió → propagarlo a la otra.
- NO se integrará SIIGO en este flujo (decisión explícita del equipo).

**Archivos modificados:**

`app/services/meli.py` — Nueva función `actualizar_stock_meli(sku, nuevo_stock)`:
- Obtiene `seller_id` desde `/users/me`
- Busca publicaciones activas por `seller_sku` (campo `seller_custom_field` en MeLi)
- Actualiza `available_quantity` via PUT `/items/{item_id}`

`app/sync.py` — `sincronizar_stock_todas_las_plataformas(sku, nuevo_stock)`:
- Antes: solo llamaba `actualizar_stock_woocommerce`
- Después: llama a ambas (`actualizar_stock_woocommerce` + `actualizar_stock_meli`)

`webhook_meli.py` — `_procesar_orden_meli()`:
- **Error previo:** Calculaba `nuevo_stock = stock_woocommerce - cantidad_vendida`. Esto era incorrecto porque MeLi ya había decrementado su propio stock, y WC podía estar desincronizado → resultado incorrecto.
- **Fix:** Leer `available_quantity` directamente del ítem en MeLi (post-venta) y usarlo como valor a propagar. Fallback: `max(0, stock_woocommerce - cantidad)` si la API de MeLi no responde.

`app/routes.py` — `_procesar_webhook_woocommerce()`:
- **Error previo:** Leía el stock de WC y restaba `cantidad` vendida → doble descuento (WC ya lo había decrementado).
- **Fix:** Leer `stock_quantity` del payload del webhook (ya es el stock post-venta) y propagarlo a MeLi.
- Eliminada la llamada a SIIGO en este flujo (no requerida).

**Lección:** Nunca recalcular manualmente el stock restando cantidades cuando la plataforma ya lo hizo. Siempre leer el stock resultante directamente de la fuente.

---

### 2. Catálogo PDF con fotos de MeLi

**Motivación:** El catálogo en PDF no tenía fotos de productos. Se requería incluir la primera foto de cada publicación de MeLi.

**Primer intento (fallido):**
- Se buscaron fotos usando `seller_custom_field` (campo SKU en MeLi) con valores tipo "AS-2", "AS-9".
- El catálogo usa SKUs internos tipo "OILESNMNT5mL", "CREMADERM200g".
- Resultado: solo 11/233 productos con foto (los pocos con SKU coincidente).

**Causa raíz del fallo:** El campo `seller_custom_field` de MeLi almacena el SKU en formato "AS-XX" (número secuencial), incompatible con los SKUs del catálogo de Google Sheets.

**Fix:** Leer el ID de publicación MeLi (formato MCOxxxxxxxxx) desde la columna A de Google Sheets. Usar ese ID para hacer batch-fetch de fotos (20 items por petición a `/items?ids=`). El mapeo `meli_item_id → sku_catalogo` es el puente correcto entre plataformas.

**Archivo nuevo: `generar_catalogo.py`**
- Diseño: A4, 2 columnas, estilo artístico con colores corporativos McKenna
- `CARD_H = 82pt`, `PHOTO_SIZE = 58pt`, `PHOTO_ZONE_W = 68pt`
- Foto a la izquierda (fondo azul claro `#f5f8f9`), texto a la derecha
- Función `fetch_meli_photos(token, meli_id_to_sku)`: recibe dict `{meli_id: sku}`, retorna `{sku: ruta_local_imagen}`
- Función `leer_productos_sheets(photo_map)`: lee col A (MeLi ID) además de cols B-J
- Resultado final: 233/233 productos con foto

**Lección:** Para relacionar fotos de MeLi con productos del catálogo, siempre usar el ID de publicación MCO (col A de Sheets), nunca `seller_custom_field`.

---

### 3. Bug de respuesta genérica en preventa MeLi

**Síntoma:** El agente respondía a clientes con texto genérico ("Hola veci, en breve nuestros asesores te contactarán...") en vez de delegar al grupo cuando no tenía información técnica o cuando Gemini fallaba.

**Causa raíz:** `generar_respuesta_con_ficha()` capturaba excepciones (ej: Gemini 503) y retornaba un string de fallback genérico. Ese string era enviado al cliente como si fuera una respuesta válida de IA.

**Archivos modificados: `app/services/meli_preventa.py`**

Flujo correcto implementado:
1. Sin ficha técnica → guardar pendiente + alertar grupo → NO responder al cliente
2. Con ficha técnica, IA genera respuesta → enviar al cliente + guardar como aprendizaje
3. Con ficha técnica, IA falla (excepción) → `generar_respuesta_con_ficha()` retorna `None` → guardar pendiente + alertar grupo con nota "(IA no pudo generar respuesta automática)" → NO responder al cliente

`generar_respuesta_con_ficha()`:
- Antes: `except Exception: return "Hola veci, gracias por tu pregunta..."` ← BUG
- Después: `except Exception: return None`

`manejar_pregunta_preventa()`:
- Agregado bloque `if respuesta is None:` → delegar al grupo

**Lección:** En flujos donde `None` significa "no hay respuesta", NUNCA retornar un string de fallback como respuesta válida. Retornar `None` y manejar la delegación en el caller.

---

### 4. Simplificación del comando de confirmación de pagos

**Motivación:** El comando `ok confirmado 573182432463@c.us` era muy largo e inconveniente para escribir en WhatsApp.

**Nuevo sistema implementado en `app/routes.py`:**

Funciones helper agregadas:
- `_sufijo_pago(numero)`: extrae los últimos 3 dígitos del número de teléfono (ej: `573182432463@c.us` → `"463"`)
- `_buscar_pago_por_sufijo(sufijo)`: busca en `pagos_pendientes_confirmacion` el número que termina en ese sufijo

Nuevos comandos reconocidos:
- `ok 463` → confirmar pago del cliente cuyo número termina en 463
- `no 463` → rechazar pago

Mensaje de alerta mejorado:
```
🔔 *ALERTA DE PAGO*
Cliente *...XXXXXXX* envió un comprobante de pago.

✅ *Para CONFIRMAR:*
   Escribe: *ok 463*

❌ *Para RECHAZAR:*
   Escribe: *no 463*

📎 Comprobante: /ruta/archivo
```

Compatibilidad mantenida: el comando antiguo `ok confirmado <número_completo>` sigue funcionando.

**Lección:** El patrón de sufijo de 3 dígitos es consistente con el sistema de preventa (`resp 463: respuesta`). Mantener consistencia entre sistemas reduce fricción cognitiva del equipo.

---

### 5. Push forzado al repositorio remoto

**Situación:** `git push origin master` rechazado con "non-fast-forward". El remoto tenía un historial completamente diferente (había sido forzado previamente a un estado distinto).

**Solución:** `git push --force origin master` (confirmado explícitamente por el usuario).

**Advertencia para el futuro:** El historial del remoto fue reescrito. Si hay otros colaboradores con copias del repo, necesitarán hacer `git fetch --force && git reset --hard origin/master`.

---

### 6. Actualización de CLAUDE.md

**Motivación:** El archivo de instrucciones estaba desactualizado y no reflejaba la arquitectura real del proyecto.

**Contenido agregado/actualizado:**
- Estructura de directorios completa con descripción de cada archivo
- Tabla de endpoints Flask con método, ruta, descripción y autenticación
- 5 flujos de datos documentados:
  1. Venta WhatsApp → Factura → MeLi
  2. Venta MeLi → Sync stock bidireccional
  3. Venta WooCommerce → Sync stock bidireccional
  4. Preventa MeLi (árbol de decisión completo)
  5. Confirmación de pagos (comandos cortos)
- Variables de entorno requeridas (tabla completa)
- Sistemas de almacenamiento (SQLite, ChromaDB, Sheets, archivos locales)
- Decisiones de diseño y anti-patrones a evitar
- Detalles de generación del catálogo PDF

---

## Sesión anterior (2026-03-31)

### Correcciones de seguridad

- Removidas credenciales de MeLi y SIIGO del repositorio (commit `e3656c4`)
- Preventa: manejo de errores Gemini 503
- Respuestas preventa: sin respuesta automática si no hay información técnica

---

## Anti-patrones identificados (NO repetir)

| Anti-patrón | Por qué es incorrecto | Alternativa correcta |
|-------------|----------------------|----------------------|
| Calcular stock como `stock_actual - cantidad` al recibir webhook | La plataforma ya decrementó; resultado es doble descuento | Leer `available_quantity` o `stock_quantity` del payload/API post-venta |
| Buscar fotos MeLi por `seller_custom_field` | El formato "AS-XX" es incompatible con SKUs del catálogo | Usar MeLi item IDs (MCO...) desde col A de Google Sheets |
| Retornar string genérico en `except` de funciones de IA | El caller no puede distinguir respuesta válida de error | Retornar `None` y manejar delegación en el caller |
| Comandos de aprobación con números de teléfono completos | Difícil de escribir en móvil | Usar sufijo de 3 dígitos consistente con otros comandos del sistema |
| Hacer `git pull --rebase` cuando el remoto tiene historial incompatible | Genera conflictos en archivos de credenciales | Confirmar con el usuario y hacer `push --force` si es intencional |
