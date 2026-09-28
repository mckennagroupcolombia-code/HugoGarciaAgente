# Ventas directas

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

### R. Ventas directas por WhatsApp (cotizar y facturar desde /app)

```
/app → Facturación → Cotizar/Facturar   (CotizarFacturarPanel.tsx, wizard de 5 pasos)
  1 Origen    ⚡ pedido del agente IA (ventas_wa, solo modo activo) → salta a Revisar
              🪄 chat de WhatsApp (extracción con IA, llm_budget) · ✍️ desde cero · ventas recientes
  2 Cliente   buscador de contactos Alegra; cédula/NIT obligatoria solo para facturar
  3 Productos precio sugerido = WEB (decisión 11-sep), MeLi de referencia; IVA por línea; envío sin IVA
  4 Revisar   base / IVA / total calculados en el backend
  5 Acción    Cotizar (PDF + cotización en Alegra + WhatsApp) · Facturar (DIAN, doble confirmación)

app/services/ventas_directas.py   SQLite app/data/ventas_directas.db (gitignored)
                                  borrador → cotizada → facturando → facturada (o anulada)
app/routes_ventas_directas.py     /api/ventas-directas/*, permiso `cotizar-facturar` o admin
```

**Por qué (16-sep-2026):** Jenniffer cotizaba en la interfaz de Alegra y el IVA salía dos veces.
**La lista de precios de Alegra guarda el precio FINAL con IVA** (`precios_canales` y `precios_trm`
le copian el de MeLi) y cada ítem trae además IVA 19%: la interfaz de Alegra toma ese precio como
base y le vuelve a sumar el impuesto (LECITINA SOYA 500g: lista $19.800 → sugiere $23.562). Las
facturas por API no sufren esto porque `crear_factura_venta_alegra` saca el IVA antes
(`_precio_base_con_impuesto`); `ventas_directas.crear_cotizacion_alegra` hace lo mismo con
`POST /estimates` y avisa si el total de Alegra difiere más de $5 del de la app. **No cotizar ni
facturar a mano en Alegra mientras la lista siga con IVA incluido.** Cambiar la lista a precios
base es la corrección de fondo, pero toca todo lo que lee `price` de Alegra como precio final
(precios_canales, precios_trm, rentabilidad, picker del panel) — decisión pendiente.

**Venta de MeLi con RUT (22-sep-2026):** empresas compran en MeLi y mandan el RUT para que la
factura salga a su nombre; MeLi no da correo ni teléfono. En el paso 1, «Venta de Mercado Libre»
(`GET /api/ventas-directas/meli/<pack u orden>`) trae comprador (billing_info) y productos y deja
`origen=meli`, `origen_ref=pack_id`. Al facturar se aplican las barreras de «Facturar ahora»
(registro local, documento fiscal en MeLi, factura en Alegra por `purchase_order`), la factura
sale con `purchase_order=pack_id`, el PDF se sube a MeLi y las órdenes quedan `facturada` en
`meli_facturas_entrega.json` — así ninguna de las dos vías emite otra. El **WhatsApp del cliente
es opcional** (antes era obligatorio: el operador ponía «.» y cotizar/facturar fallaba con
«Teléfono inválido»). **Tipo de documento:** `identificacion_fiscal()` manda NIT/CC a Alegra
(selector en el paso 2, o deducido por nombre de empresa / forma de NIT) y comprueba el DV; sin
esto Alegra adivinaba por longitud y EQUISURE S.A.S (FE465) quedó como CC.

**Comisión WhatsApp (23-sep-2026):** `comisiones_mes()` / `GET /api/ventas-directas/comisiones` — 3 %
(`VENTAS_DIRECTAS_COMISION_PCT`) sobre productos sin IVA ni envío de las ventas facturadas del mes, a quien
creó la venta; excluye origen `meli`. Chip en la barra del módulo y detalle en «Ventas recientes».

Facturar marca la venta `facturando` **antes** de llamar a Alegra (un segundo clic o una pestaña
duplicada no emite otra factura) y la devuelve a su estado si Alegra falla. Un pedido IA facturado
se cierra en `ventas_wa`. Los endpoints viejos `/api/facturacion/cotizar` y `/facturar-directo`
siguen vivos (el segundo ahora sí pasa `medio_pago`), pero el panel ya no los usa.

**Soporte de pago con Ctrl+V (28-sep-2026):** hasta ese día ninguna de las 35 facturas tenía soporte:
el Ctrl+V se descartaba en silencio si el cursor estaba en «Notas» (viene prellenado desde «Por
facturar») y el recuadro desaparecía al emitir. Ahora una imagen pegada en el paso 3 siempre va al
soporte, el aviso «Falta el soporte» aparece al pedir la confirmación DIAN, y con la factura ya emitida
se puede adjuntar **una vez** (llega al grupo de facturación con el número de factura); después no se
reemplaza ni se borra (`guardar_soporte` / `eliminar_soporte`).
