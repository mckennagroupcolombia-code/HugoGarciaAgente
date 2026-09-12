# Pedido a proveedores — fichas que no se pueden publicar

Una seccion por proveedor. Cada producto lista solo lo que falta para poder publicar su ficha tecnica, su COA y su SDS. Nada de esto se puede deducir ni buscar en fuentes publicas: o lo manda el proveedor, o la ficha no sale.

Generado por `scripts/pedido_proveedores_fichas.py` desde las fichas con `_estado: vacio`. El detalle completo de cada una esta en `docs/fichas_vacias_pendientes.md`.

**21 productos, 5 grupos.**

## Lo que se pide para todos

- [ ] SDS (hoja de seguridad) vigente, con la seccion 2 completa: pictogramas, palabra de advertencia, frases H y P.
- [ ] COA del lote que nos despacharon, con los parametros que certifican.
- [ ] CAS y numero EC/EINECS que ustedes declaran para el producto.

---

## QUIMICA INTERKROL LIMITADA

Consta en factura: ACEITE ESENCIAL ÁRBOL DE TÉ (2026-07-16), ACEITE ESENCIAL EUCALIPTO (2026-04-21), ACEITE ESENCIAL JAZMÍN (2026-03-05), ACEITE ESENCIAL MANZANILLA (2026-04-15).

4 producto(s): ACEITE ESENCIAL ÁRBOL DE TÉ, ACEITE ESENCIAL EUCALIPTO, ACEITE ESENCIAL JAZMÍN, ACEITE ESENCIAL MANZANILLA

### ACEITE ESENCIAL ÁRBOL DE TÉ

SKU `MCO3141419058` — Aceite Esencial Mckenna Group Árbol De Té Herbal 5ml

- [ ] Especie botanica (confirmar si es Melaleuca alternifolia) y pais de origen.
- [ ] Perfil cromatografico del lote, con contenido de terpinen-4-ol y maximo de 1,8-cineol segun ISO 4730.
- [ ] Cual par CAS / EC usan en su SDS: 68647-73-4 o 85085-48-9, ambos asociados al EC 285-377-1.

### ACEITE ESENCIAL EUCALIPTO

SKU `C-ACEESEEUC5mL` — ACEITE ESENCIAL EUCALIPTO 5 mL

- [ ] Especie botanica exacta (Eucalyptus globulus u otra) y pais de origen.
- [ ] Contenido de 1,8-cineol del lote.

### ACEITE ESENCIAL JAZMÍN

SKU `C-ACEESEJAZ5mL` — ACEITE ESENCIAL JAZMIN 5mL

- [ ] Que producto es exactamente: aceite esencial destilado, absoluto obtenido con solvente, o una dilucion en aceite portador. De esto dependen el CAS y el INCI.
- [ ] Si es dilucion, el porcentaje y el aceite portador.
- [ ] Especie (Jasminum officinale, grandiflorum o sambac) y pais de origen.

### ACEITE ESENCIAL MANZANILLA

SKU `C-ACEESEMAN5mL` — ACEITE ESENCIAL MANZANILLA 5mL

- [ ] Especie: manzanilla romana (Chamaemelum nobile) o alemana/azul (Matricaria chamomilla). Cambian el color y el CAS.
- [ ] CAS y numero EC que declaran para la especie que nos despachan.
- [ ] Pais de origen.

---

## Aceites esenciales — proveedor por confirmar

_Sin factura que lo confirme: asignar el proveedor antes de enviar._

10 producto(s): ACEITE ESENCIAL ALBAHACA, ACEITE ESENCIAL BERGAMOTA, ACEITE ESENCIAL CANELA, ACEITE ESENCIAL CLAVOS, ACEITE ESENCIAL HIERBA BUENA, ACEITE ESENCIAL JENGIBRE, ACEITE ESENCIAL MANDARINA, ACEITE ESENCIAL MENTA, ACEITE ESENCIAL NARANJA, ACEITE ESENCIAL PINO

### ACEITE ESENCIAL ALBAHACA

SKU `C-ACEESEALB5mL` — ACEITE ESENCIAL ALBAHACA 5mL

- [ ] Quimiotipo del aceite, con el porcentaje de estragol (metilchavicol) y de linalol del lote: define las restricciones de uso.
- [ ] Limites de dosificacion IFRA aplicables.
- [ ] Si tienen version con documentacion de grado alimentario.

### ACEITE ESENCIAL BERGAMOTA

SKU `C-ACEESEBER5mL` — Aceite Esencial Bergamota 5 Ml Mckenna Group Aromaterapia Y Masajes

- [ ] Metodo de obtencion: prensado en frio de la cascara o destilacion.
- [ ] Si el aceite es FCF (libre de bergapteno) y, si no lo es, el contenido de bergapteno: define la advertencia de fotosensibilizacion.

### ACEITE ESENCIAL CANELA

SKU `MCO1672155703` — Aceite Esencial Canela Mckenna Group 5ml Apto Difusor Masajes

- [ ] Especie (Cinnamomum verum o Cinnamomum cassia) y parte usada (corteza u hoja): cambian el CAS, el INCI y el perfil.
- [ ] Contenido de cinamaldehido y de eugenol del lote.
- [ ] Confirmar si su clasificacion incluye peligro acuatico (H411) y toxicidad aguda por via oral.

### ACEITE ESENCIAL CLAVOS

SKU `MCO1732025061` — Aceite Esencial De Clavos

- [ ] Parte de la planta destilada: boton floral, hoja o tallo. Cambia el INCI y el perfil de eugenol.
- [ ] Contenido de eugenol y de acetato de eugenilo del lote.
- [ ] Cual numero EC usan: 616-772-2 o 616-969-3.

### ACEITE ESENCIAL HIERBA BUENA

SKU `C-ACEESEHIEBUE5mL` — ACEITE ESENCIAL HIERBA BUENA 5mL

- [ ] Confirmar que es Mentha spicata (menta verde) y no Mentha x piperita.
- [ ] Contenido de carvona del lote.

### ACEITE ESENCIAL JENGIBRE

SKU `C-ACEESEJEN5mL` — ACEITE ESENCIAL JENGIBRE 5mL

- [ ] Metodo de obtencion: destilacion de rizoma fresco o seco.
- [ ] Pais de origen.

### ACEITE ESENCIAL MANDARINA

SKU `C-ACEESENMAN5mL` — Aceite Esencial Puro De Mandarina Mckenna Group 5ml Relajante

- [ ] Metodo de obtencion: prensado en frio de la cascara o arrastre con vapor.
- [ ] Si el aceite es fotosensibilizante.
- [ ] Especie: Citrus reticulata (tangerina) o Citrus nobilis (mandarina). Cambia el INCI.

### ACEITE ESENCIAL MENTA

SKU `C-ACEESEMEN5mL` — ACEITE ESENCIAL MENTA 5 mL

- [ ] Especie del aceite que nos venden como menta: Mentha x piperita, Mentha arvensis o Mentha spicata. Cambian el CAS, el EC y el INCI.
- [ ] Contenido de mentol y de mentona del lote.
- [ ] Confirmar si su clasificacion incluye inflamabilidad (H226), peligro por aspiracion (H304) y peligro acuatico (H411).

### ACEITE ESENCIAL NARANJA

SKU `C-ACEESENAR5mL` — ACEITE ESENCIAL NARANJA 5mL

- [ ] Metodo de obtencion: prensado en frio de la cascara o arrastre con vapor.
- [ ] Cual par CAS / EC usan: 8008-57-9 o 8028-48-6 (EC 232-433-8).
- [ ] Contenido de limoneno del lote.

### ACEITE ESENCIAL PINO

SKU `C-ACEESNPIN5mL` — ACEITE ESENCIAL PINO 5mL

- [ ] Especie y par CAS / EC que usan: 8023-99-2 (Pinus sylvestris) u 8000-26-8 (Pinus mugo, EC 616-768-0).
- [ ] Confirmar que es aceite esencial de aciculas y no aceite de pino industrial de tocones (8002-09-3), que tiene otro perfil de peligros.

---

## Aceites vegetales — proveedor por confirmar

_Sin factura que lo confirme: asignar el proveedor antes de enviar._

2 producto(s): ACEITE DE NEEM, ACEITE DE ROSA MOSQUETA

### ACEITE DE NEEM

SKU `MCO832545524` — Aceite De Neem  120 Ml

- [ ] CAS y numero EC que declaran para el aceite de neem.
- [ ] Contenido de azadiractina del lote.
- [ ] Punto de fusion o de solidificacion real del lote.
- [ ] Si el lote es apto para uso cosmetico o solo para uso agricola.

### ACEITE DE ROSA MOSQUETA

SKU `OILESNRSM30mL` — Aceite Esencial de Rosa Mosqueta 30 mL

- [ ] Confirmar si el producto es aceite vegetal de rosa mosqueta o aceite esencial de rosa: son productos distintos.
- [ ] Especie (Rosa canina o Rosa rubiginosa) y parte usada, para fijar el INCI.
- [ ] Metodo de extraccion (prensado en frio o refinado), perfil de acidos grasos e indice de peroxidos.

---

## Arcillas y minerales — proveedor por confirmar

_Sin factura que lo confirme: asignar el proveedor antes de enviar._

1 producto(s): ARCILLA ROJA

### ARCILLA ROJA

SKU `CARJ` — Arcilla  Roja  1 kg

- [ ] Composicion mineral de la arcilla y, si aplica, su CAS.
- [ ] Apariencia, pH en suspension, granulometria y humedad.
- [ ] Enviar tambien la ficha de la arcilla verde y de la arcilla amarilla, que tambien les compramos.

---

## Otros insumos — proveedor por confirmar

_Sin factura que lo confirme: asignar el proveedor antes de enviar._

4 producto(s): ÁCIDO KÓJICO, GUSANO DE SEDA, ÓXIDO DE HIERRO, VITAMINA C

### ÁCIDO KÓJICO

SKU `C-ACIKOJDPAL30mL` — ACIDO KOJICO D PALMITATO 30 mL

- [ ] Confirmar que producto nos despachan: acido kojico puro, kojico dipalmitato, o una dilucion (indicar el porcentaje).
- [ ] CAS e INCI correspondientes al producto real.
- [ ] Si es dilucion, el vehiculo y el conservante.

### GUSANO DE SEDA

SKU `C-GUSSED30mL` — GUSANO DE SEDA 30 mL

- [ ] CAS e INCI de la seda hidrolizada (INCI probable: Hydrolyzed Silk).
- [ ] Concentracion de la suspension y conservante que lleva.

### ÓXIDO DE HIERRO

SKU `OXVD` — Oxido de Hierro  Verde  1000 GR

- [ ] Confirmar que pigmento nos despachan: verde, rojo, amarillo o negro.
- [ ] CAS, formula y Color Index (CI 77xxx) del pigmento.
- [ ] Si nos surten varios colores, la ficha de cada uno por separado.

### VITAMINA C

SKU `MCO1347147843` — Vitamina C Solución Al 30% 30ml Mixta Noche

- [ ] Composicion de la solucion: porcentaje de acido ascorbico y vehiculo.
- [ ] Conservante que lleva, si lleva.
- [ ] Grado del producto (cosmetico, alimentario o farmaceutico).

---

