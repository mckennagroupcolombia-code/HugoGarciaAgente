# Fichas vacías — pendientes de una persona

Fichas cuyo dato estaba equivocado y no tiene fuente verificable. El campo se dejó **vacío** a propósito: no se inventa ni se deja el valor incorrecto. No cuentan como ficha completa, ni como borrador, ni como ficha antigua pendiente de convertir.

Generado por `scripts/reporte_fichas_vacias.py`. No editar a mano: los datos viven en `fichas_word/datos/*.yaml` bajo las claves `_estado`, `_vacio_motivo` y `_vacio_pendientes`.

**Total: 21**

## ÁCIDO KÓJICO

- **Producto en catálogo:** ACIDO KOJICO D PALMITATO 30 mL (`C-ACIKOJDPAL30mL`)
- **Archivo:** `fichas_word/datos/acido_kojico.yaml`
- **Campos vacíos:** `cas`, `sinonimos`, `composicion`, `grado`
- **Por qué:** El CAS de la ficha (501-30-4, acido kojico) no corresponde al producto del catalogo (SKU C-ACIKOJDPAL30mL = kojico dipalmitato), y la descripcion habla de una dilucion al 5 %. Son tres productos distintos y no hay forma de saber cual se vende.

**Qué hay que conseguir:**

- [ ] Definir que producto es: acido kojico puro, kojico dipalmitato o una dilucion al 5 %.
- [ ] Segun eso, CAS e INCI de la SDS del proveedor (el dipalmitato no comparte CAS con el acido kojico).
- [ ] Corregir la descripcion, que hoy describe una dilucion al 5 % que no coincide con el SKU.

## ARCILLA ROJA

- **Producto en catálogo:** Arcilla  Roja  1 kg (`CARJ`)
- **Archivo:** `fichas_word/datos/arcilla_roja.yaml`
- **Campos vacíos:** `cas`, `sinonimos`, `composicion`, `grado`
- **Por qué:** Ficha incompleta: solo trae descripcion, aplicaciones, propiedades, estabilidad y microbiologia. Le faltan CAS, sinonimos, caracteristicas fisicas, modo de uso, recomendaciones y fecha de revision. Las arcillas de color no tienen un CAS unico (dependen de la composicion mineral del yacimiento), asi que no se puede completar sin la ficha del proveedor.

**Qué hay que conseguir:**

- [ ] Composicion mineral y CAS (o declarar que es una mezcla y va con Composicion, no con CAS), de la ficha del proveedor.
- [ ] Caracteristicas fisicas: apariencia, pH en suspension, granulometria, humedad.
- [ ] Modo de uso, recomendaciones y fecha de revision.
- [ ] Faltan ademas las fichas de ARCILLA VERDE y ARCILLA AMARILLA, que si estan en el catalogo (ARCV250g, ARCAM250g) y no tienen ninguna ficha.

## GUSANO DE SEDA

- **Producto en catálogo:** GUSANO DE SEDA 30 mL (`C-GUSSED30mL`)
- **Archivo:** `fichas_word/datos/gusano_de_seda.yaml`
- **Campos vacíos:** `cas`, `composicion`, `grado`
- **Por qué:** El CAS 900-66-6 no es valido (falla el digito de control) y no hay fuente confiable del CAS de la seda hidrolizada en las referencias consultadas.

**Qué hay que conseguir:**

- [ ] CAS e INCI de la seda hidrolizada segun la SDS del proveedor (INCI probable: Hydrolyzed Silk).
- [ ] Confirmar la concentracion de la suspension y el conservante que lleva.

## ÓXIDO DE HIERRO

- **Producto en catálogo:** Oxido de Hierro  Verde  1000 GR (`OXVD`)
- **Archivo:** `fichas_word/datos/oxido_de_hierro.yaml`
- **Campos vacíos:** `cas`, `sinonimos`, `composicion`, `grado`
- **Por qué:** La ficha describe oxido de hierro rojo (Fe2O3, hematita, CAS 1309-37-1) pero el producto del catalogo es 'Oxido de Hierro Verde 1000 GR'. Cada pigmento de hierro tiene CAS, formula y Color Index propios.

**Qué hay que conseguir:**

- [ ] Confirmar que pigmento se vende (verde, rojo, amarillo o negro); si son varios, una ficha por color.
- [ ] CAS, formula y Color Index (CI 77xxx) del pigmento real, de la SDS del proveedor.
- [ ] Corregir la descripcion y la formula Fe2O3, que son del rojo.

## ACEITE DE NEEM

- **Producto en catálogo:** Aceite De Neem  120 Ml (`MCO832545524`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_de_neem.yaml`
- **Campos vacíos:** `cas`, `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. Faltan dos datos esenciales imposibles de verificar: el CAS/EINECS (Wikidata no devuelve resultados para 8002-65-1 ni para el ítem 'neem oil') y la clasificación GHS. No se puede afirmar que no está clasificado: los aceites de neem del comercio suelen llevar peligro por aspiración y peligro acuático, y el producto se ofrece además para uso agrícola.
- [ ] CAS y EINECS del aceite de neem: no los da ninguna de las fuentes consultadas. Tomarlos de la SDS del proveedor antes de publicar.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Incluye el contenido de azadiractina, que es el dato que respalda el uso agrícola.
- [ ] Confirmar el punto de fusión o de solidificación real del lote (la ficha antigua decía 29.0 – 34.0 °C, incompatible con un producto líquido a temperatura ambiente).
- [ ] Decisión del cliente: si el producto se vende para control de plagas en Colombia, las afirmaciones de eficacia y la dosis requieren registro ICA como bioinsumo o plaguicida; mientras no exista ese registro, la ficha se queda en el uso general como insumo agrícola.
- [ ] Confirmar si el lote es apto para uso cosmético (grado cosmético, certificado de análisis) o solo para uso agrícola.

## ACEITE DE ROSA MOSQUETA

- **Producto en catálogo:** Aceite Esencial de Rosa Mosqueta 30 mL (`OILESNRSM30mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_de_rosa_mosqueta.yaml`
- **Campos vacíos:** `cas`, `composicion`, `grado`
- **Por qué:** No esta definido que producto es: la ficha antigua se llamaba 'ACEITE ESENCIAL ROSA MOSQUETA' pero esta redactada como aceite vegetal, y ademas existe la referencia ACEITE ESENCIAL ROSAS. Del producto real dependen el nombre, el CAS, el INCI y la SDS.

**Qué hay que conseguir:**

- [ ] Decisión del cliente: confirmar que el producto es aceite vegetal de rosa mosqueta y aprobar el cambio de nombre de 'ACEITE ESENCIAL ROSA MOSQUETA' a 'ACEITE DE ROSA MOSQUETA'. Si lo que se vende es realmente un aceite esencial de rosa (Rosa damascena) o una dilución aromática, la ficha debe rehacerse por completo.
- [ ] Confirmar la especie (Rosa canina o Rosa rubiginosa) y la parte usada, para fijar el INCI definitivo (Rosa Canina Fruit Oil / Rosa Rubiginosa Seed Oil).
- [ ] Confirmar con la SDS del proveedor que el producto no está clasificado según el SGA, como se declara en esta ficha.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el perfil de ácidos grasos, el índice de peróxidos y el método de extracción (prensado en frío o refinado).
- [ ] Revisar que no se solape con la ficha antigua ACEITE ESENCIAL ROSAS, que sí sería un aceite esencial de flores de rosa.

## ACEITE ESENCIAL ALBAHACA

- **Producto en catálogo:** ACEITE ESENCIAL ALBAHACA 5mL (`C-ACEESEALB5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_albahaca.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. No se puede verificar la clasificación GHS: el aceite de albahaca no la tiene registrada en Wikidata ni en Wikipedia, PubChem no lo indexa y la clasificación depende del quimiotipo (un aceite rico en estragol arrastraría H341/H351, que no se pueden afirmar sin el perfil GC del lote). Un aceite esencial inflamable y sensibilizante no puede publicarse con la sección 2 en blanco.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. En albahaca es clave el quimiotipo (contenido de estragol/metilchavicol o de linalol), que determina las restricciones de uso.
- [ ] Confirmar con el proveedor el quimiotipo y el origen del aceite, y los límites de dosificación IFRA aplicables.
- [ ] Si el cliente quiere venderlo también como saborizante alimentario, se requiere documentación de grado alimentario; la ficha actual está redactada para grado cosmético.

## ACEITE ESENCIAL ÁRBOL DE TÉ

- **Producto en catálogo:** Aceite Esencial Mckenna Group Árbol De Té Herbal 5ml (`MCO3141419058`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_arbol_de_te.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. No se puede verificar la clasificación GHS: el artículo 'Tea tree oil' no trae Chembox, Wikidata no registra GHS y PubChem responde 'no encontrado' para 68647-73-4. El terpinen-4-ol, su constituyente mayoritario, tampoco trae GHS en Wikipedia, así que no hay fuente para una sustancia que en el comercio va clasificada como inflamable, sensibilizante y peligrosa por aspiración.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Para el árbol de té la norma ISO 4730 fija el contenido de terpinen-4-ol y el máximo de 1,8-cineol: pedir el perfil GC del lote.
- [ ] En Wikidata el mismo ítem trae dos CAS (68647-73-4 y 85085-48-9) asociados al EC 285-377-1: confirmar con el proveedor cuál par CAS/EC usa su SDS.
- [ ] Confirmar con el proveedor la especie (Melaleuca alternifolia) y el país de origen.

## ACEITE ESENCIAL BERGAMOTA

- **Producto en catálogo:** Aceite Esencial Bergamota 5 Ml Mckenna Group Aromaterapia Y Masajes (`C-ACEESEBER5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_bergamota.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Limonene (d-limoneno)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Confirmar con el proveedor el método de obtención (prensado en frío de la cáscara, que es lo habitual, o destilación) y si el aceite es FCF (sin bergapteno): de ello depende la advertencia de fotosensibilización y el límite de uso en productos que quedan sobre la piel.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Limonene (d-limoneno) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Líquido inflamable, categoría 3 (H226); peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); peligro acuático crónico, categoría 1 (H410). Palabra de advertencia: Peligro.

```
GHS02 - Llama
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H226: Líquidos y vapores inflamables.
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H410: Muy tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P210: Mantener alejado del calor, de superficies calientes, de chispas, de llamas abiertas y de cualquier otra fuente de ignición. No fumar.
P233: Mantener el recipiente herméticamente cerrado.
P240: Conectar a tierra y enlace equipotencial del recipiente y del equipo receptor.
P264: Lavarse concienzudamente las manos tras la manipulación.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P370 + P378: En caso de incendio: Utilizar un agente extintor adecuado (polvo químico, espuma o CO₂) para apagarlo.
P391: Recoger el vertido.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL CANELA

- **Producto en catálogo:** Aceite Esencial Canela Mckenna Group 5ml Apto Difusor Masajes (`MCO1672155703`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_canela.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Cinnamaldehyde (cinamaldehido)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor. El perfil publicado no aporta peligro acuatico; varias SDS comerciales del aceite de corteza de canela anaden H411 y toxicidad aguda por via oral.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] El perfil GHS publicado proviene del cinamaldehído, que no aporta peligro acuático; varias SDS comerciales del aceite de corteza de canela añaden H411 y toxicidad aguda por vía oral. Confirmar con el proveedor antes de imprimir la etiqueta.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de cinamaldehído y de eugenol del lote.
- [ ] Confirmar con el proveedor la especie (Cinnamomum verum o Cinnamomum aromaticum/cassia) y la parte usada (corteza u hoja): cambian el CAS, el INCI y el perfil de componentes.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Cinnamaldehyde (cinamaldehido) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); lesiones oculares graves o irritación ocular, categoría 2 (H319); toxicidad específica en determinados órganos (exposición única), categoría 3, vías respiratorias (H335). Palabra de advertencia: Atención.

```
GHS07 - Signo de exclamación
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H319: Provoca irritación ocular grave.
H335: Puede irritar las vías respiratorias.
P261: Evitar respirar los vapores o las nieblas.
P264: Lavarse concienzudamente las manos tras la manipulación.
P271: Utilizar únicamente en exteriores o en un lugar bien ventilado.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P305 + P351 + P338: EN CASO DE CONTACTO CON LOS OJOS: Enjuagar con agua cuidadosamente durante varios minutos. Quitar las lentes de contacto cuando estén presentes y pueda hacerse con facilidad. Proseguir con el lavado.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P337 + P313: Si persiste la irritación ocular: Consultar a un médico.
P362 + P364: Quitar las prendas contaminadas y lavarlas antes de volver a usarlas.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL CLAVOS

- **Producto en catálogo:** Aceite Esencial De Clavos (`MCO1732025061`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_clavos.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. Dos datos esenciales sin verificar: el EINECS (Wikidata asocia 616-772-2 y 616-969-3 al mismo aceite, sin poder escoger) y la clasificación GHS (el artículo 'Oil of clove' no trae Chembox, el de 'Eugenol' tampoco, y PubChem devolvió HTTP 503 para 97-53-0). No se puede publicar sin sección 2 un aceite irritante y sensibilizante por su contenido de eugenol.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar. Es especialmente importante en este producto: los aceites de clavo suelen ir clasificados como irritantes y sensibilizantes cutáneos por su contenido de eugenol.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de eugenol y de acetato de eugenilo del lote.
- [ ] Definir el EINECS: Wikidata asocia 616-772-2 y 616-969-3 al mismo aceite; tomar el que use la SDS del proveedor.
- [ ] Confirmar con el proveedor la parte de la planta destilada (botón floral, hoja o tallo): cambia el INCI y el perfil de eugenol.

## ACEITE ESENCIAL EUCALIPTO

- **Producto en catálogo:** ACEITE ESENCIAL EUCALIPTO 5 mL (`C-ACEESEEUC5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_eucalipto.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Eucalyptol (1,8-cineol)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de 1,8-cineol del lote, que es el parámetro de calidad del aceite de eucalipto.
- [ ] Confirmar con el proveedor la especie exacta (Eucalyptus globulus u otra) y el país de origen.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Eucalyptol (1,8-cineol) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Líquido inflamable, categoría 3 (H226); peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); lesiones oculares graves o irritación ocular, categoría 2 (H319); peligro acuático crónico, categoría 2 (H411). Palabra de advertencia: Peligro.

```
GHS02 - Llama
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H226: Líquidos y vapores inflamables.
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H319: Provoca irritación ocular grave.
H411: Tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P210: Mantener alejado del calor, de superficies calientes, de chispas, de llamas abiertas y de cualquier otra fuente de ignición. No fumar.
P233: Mantener el recipiente herméticamente cerrado.
P240: Conectar a tierra y enlace equipotencial del recipiente y del equipo receptor.
P264: Lavarse concienzudamente las manos tras la manipulación.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P305 + P351 + P338: EN CASO DE CONTACTO CON LOS OJOS: Enjuagar con agua cuidadosamente durante varios minutos. Quitar las lentes de contacto cuando estén presentes y pueda hacerse con facilidad. Proseguir con el lavado.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P337 + P313: Si persiste la irritación ocular: Consultar a un médico.
P370 + P378: En caso de incendio: Utilizar un agente extintor adecuado (polvo químico, espuma o CO₂) para apagarlo.
P391: Recoger el vertido.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL HIERBA BUENA

- **Producto en catálogo:** ACEITE ESENCIAL HIERBA BUENA 5mL (`C-ACEESEHIEBUE5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_hierba_buena.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Carvone (carvona)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de carvona del lote.
- [ ] Confirmar con el proveedor que el producto es efectivamente aceite de Mentha spicata (menta verde) y no de Mentha × piperita, porque los sinónimos de la ficha de ACEITE ESENCIAL MENTA mezclan los nombres de ambas.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Carvone (carvona) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); peligro acuático crónico, categoría 2 (H411). Palabra de advertencia: Peligro.

```
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H411: Tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P261: Evitar respirar los vapores o las nieblas.
P264: Lavarse concienzudamente las manos tras la manipulación.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P362 + P364: Quitar las prendas contaminadas y lavarlas antes de volver a usarlas.
P391: Recoger el vertido.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL JAZMÍN

- **Producto en catálogo:** ACEITE ESENCIAL JAZMIN 5mL (`C-ACEESEJAZ5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_jazmin.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. Producto dudoso además de GHS sin fuente: no está definido si lo que se vende es aceite esencial destilado, absoluto extraído con solventes o una dilución en aceite portador, y de ello dependen el CAS, el INCI y la propia SDS. Ninguna fuente consultada da la clasificación GHS (el acetato de bencilo solo aporta H412, insuficiente para clasificar el producto).
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Definir con el proveedor qué es exactamente el producto: aceite esencial destilado, absoluto de jazmín (extracción con solvente) o una dilución en aceite portador. De ello dependen el INCI (Oil frente a Flower Extract), el CAS y la descripción; el precio de un absoluto puro rara vez corresponde a una presentación de 5 mL de línea general.
- [ ] Confirmar la especie (Jasminum officinale o Jasminum grandiflorum/sambac) y el país de origen.

## ACEITE ESENCIAL JENGIBRE

- **Producto en catálogo:** ACEITE ESENCIAL JENGIBRE 5mL (`C-ACEESEJEN5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_jengibre.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. No se puede verificar la clasificación GHS: Wikidata no la registra, 'Ginger oil' redirige a Ginger#Chemistry sin Chembox, el zingibereno no trae GHS en Wikipedia y PubChem no indexa 8007-08-7. No hay fuente para un aceite esencial que en el comercio va clasificado como inflamable y sensibilizante.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Confirmar con el proveedor el método de obtención (destilación del rizoma fresco o seco) y el país de origen.

## ACEITE ESENCIAL MANDARINA

- **Producto en catálogo:** Aceite Esencial Puro De Mandarina Mckenna Group 5ml Relajante (`C-ACEESENMAN5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_mandarina.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Limonene (d-limoneno)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Confirmar con el proveedor el método de obtención (prensado en frío de la cáscara, que es lo habitual, o arrastre con vapor como decía la ficha antigua) y si el aceite es fotosensibilizante.
- [ ] Confirmar si el producto se denomina mandarina o tangerina en la etiqueta: el INCI de Citrus reticulata se escribe como 'Tangerine Peel Oil', mientras que 'Citrus Nobilis (Mandarin Orange) Peel Oil' corresponde a otra especie.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Limonene (d-limoneno) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Líquido inflamable, categoría 3 (H226); peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); peligro acuático crónico, categoría 1 (H410). Palabra de advertencia: Peligro.

```
GHS02 - Llama
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H226: Líquidos y vapores inflamables.
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H410: Muy tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P210: Mantener alejado del calor, de superficies calientes, de chispas, de llamas abiertas y de cualquier otra fuente de ignición. No fumar.
P233: Mantener el recipiente herméticamente cerrado.
P240: Conectar a tierra y enlace equipotencial del recipiente y del equipo receptor.
P264: Lavarse concienzudamente las manos tras la manipulación.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P370 + P378: En caso de incendio: Utilizar un agente extintor adecuado (polvo químico, espuma o CO₂) para apagarlo.
P391: Recoger el vertido.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL MANZANILLA

- **Producto en catálogo:** ACEITE ESENCIAL MANZANILLA 5mL (`C-ACEESEMAN5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_manzanilla.yaml`
- **Campos vacíos:** `cas`, `composicion`, `grado`
- **Por qué:** La seccion 2 (clasificacion GHS) quedo vacia: ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa. Es un aceite que en el comercio va clasificado como inflamable y/o sensibilizante, asi que no se puede publicar una SDS sin clasificacion ni deducirla del componente mayoritario.

**Qué hay que conseguir:**

- [ ] BLOQUEADA. Faltan dos datos esenciales imposibles de verificar con las fuentes disponibles: el CAS/EINECS (Wikidata no registra identificadores para el aceite de Chamaemelum nobile y el 8015-92-7 corresponde a la manzanilla azul de Matricaria chamomilla) y la clasificación GHS (el camazuleno no trae GHS y no hay artículo 'Chamomile oil'). Se suma la duda de especie (romana frente a alemana) que la propia ficha deja abierta.
- [ ] CAS y EINECS del aceite de manzanilla romana: no los da ninguna de las fuentes consultadas. Tomarlos de la SDS del proveedor antes de publicar.
- [ ] Clasificación GHS (pictogramas, palabra de advertencia, frases H y P): ni Wikidata ni Wikipedia la registran para este aceite y PubChem no lo indexa como compuesto. Tomarla de la SDS del proveedor y completar la sección 2 y las líneas SEÑAL DE PELIGRO / INDICACIONES H antes de publicar.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Confirmar con el proveedor la especie: manzanilla romana (Chamaemelum nobile) o manzanilla alemana/azul (Matricaria chamomilla, aceite de color azul por el camazuleno). La ficha antigua declara la romana, pero el color y el CAS cambian según la especie.

## ACEITE ESENCIAL MENTA

- **Producto en catálogo:** ACEITE ESENCIAL MENTA 5 mL (`C-ACEESEMEN5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_menta.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Menthol (mentol)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor. El perfil publicado no aporta inflamabilidad ni peligro por aspiracion; muchas SDS comerciales del aceite de menta piperita anaden H226, H304 y H411.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] El perfil GHS publicado proviene del mentol, que no aporta inflamabilidad ni peligro por aspiración; muchas SDS comerciales del aceite de menta piperita añaden H226, H304 y H411. Mientras el proveedor no lo confirme, la manipulación mantiene por precaución las medidas de producto inflamable.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de mentol y de mentona del lote.
- [ ] Confirmar con el proveedor la especie del aceite que se vende como 'menta' (Mentha × piperita, Mentha arvensis o Mentha spicata): de ello dependen el CAS, el EINECS y el INCI de esta ficha y su diferencia con la referencia ACEITE ESENCIAL HIERBA BUENA.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Menthol (mentol) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Irritación cutánea, categoría 2 (H315); lesiones oculares graves o irritación ocular, categoría 2 (H319). Palabra de advertencia: Atención.

```
GHS07 - Signo de exclamación
H315: Provoca irritación cutánea.
H319: Provoca irritación ocular grave.
P264: Lavarse concienzudamente las manos tras la manipulación.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P305 + P351 + P338: EN CASO DE CONTACTO CON LOS OJOS: Enjuagar con agua cuidadosamente durante varios minutos. Quitar las lentes de contacto cuando estén presentes y pueda hacerse con facilidad. Proseguir con el lavado.
P332 + P313: En caso de irritación cutánea: Consultar a un médico.
P337 + P313: Si persiste la irritación ocular: Consultar a un médico.
P362 + P364: Quitar las prendas contaminadas y lavarlas antes de volver a usarlas.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL NARANJA

- **Producto en catálogo:** ACEITE ESENCIAL NARANJA 5mL (`C-ACEESENAR5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_naranja.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Limonene (d-limoneno)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente. Pedir el contenido de limoneno del lote.
- [ ] Definir el EINECS: Wikidata asocia el EC 232-433-8 a un ítem 'Orange Oil' con CAS 8028-48-6 distinto del 8008-57-9 usado aquí; tomar el par CAS/EC que use la SDS del proveedor.
- [ ] Confirmar con el proveedor el método de obtención (prensado en frío de la cáscara, que es lo habitual, o arrastre con vapor como decía la ficha antigua).

<details><summary>Clasificación GHS que traía, descartada por deducirse de Limonene (d-limoneno) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Líquido inflamable, categoría 3 (H226); peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); peligro acuático crónico, categoría 1 (H410). Palabra de advertencia: Peligro.

```
GHS02 - Llama
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H226: Líquidos y vapores inflamables.
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H410: Muy tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P210: Mantener alejado del calor, de superficies calientes, de chispas, de llamas abiertas y de cualquier otra fuente de ignición. No fumar.
P233: Mantener el recipiente herméticamente cerrado.
P240: Conectar a tierra y enlace equipotencial del recipiente y del equipo receptor.
P264: Lavarse concienzudamente las manos tras la manipulación.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P370 + P378: En caso de incendio: Utilizar un agente extintor adecuado (polvo químico, espuma o CO₂) para apagarlo.
P391: Recoger el vertido.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## ACEITE ESENCIAL PINO

- **Producto en catálogo:** ACEITE ESENCIAL PINO 5mL (`C-ACEESNPIN5mL`)
- **Archivo:** `fichas_word/datos/vacio_ft_coa_sds_aceite_esencial_pino.yaml`
- **Campos vacíos:** `composicion`, `grado`
- **Por qué:** La clasificacion GHS que traia se dedujo de su componente mayoritario (Alpha-Pinene (alfa-pineno)) y no de un ensayo sobre el aceite, que es justo lo que la regla no permite. Se vacio la seccion 2 y se guardo lo que decia en `_ghs_derivado_descartado` para poder compararlo con la SDS del proveedor.

**Qué hay que conseguir:**

- [ ] Clasificacion GHS completa (pictogramas, palabra de advertencia, frases H y P) de la SDS del proveedor.
- [ ] Composición: los constituyentes principales con su rango (cromatografía GC del lote) deben venir del COA/SDS del proveedor; no se incluyen porcentajes sin fuente.
- [ ] Confirmar con el proveedor la especie y el par CAS/EINECS de su SDS: Wikidata asigna 8023-99-2 a Pinus sylvestris y 8000-26-8 (EC 616-768-0) a Pinus mugo, y muchas SDS comerciales usan el 8000-26-8 para el aceite de pino silvestre. No debe confundirse con el aceite de pino industrial (8002-09-3).
- [ ] Confirmar que el producto es aceite esencial de acículas y no aceite de pino industrial obtenido de tocones, que tiene otro uso y otro perfil de peligros.

<details><summary>Clasificación GHS que traía, descartada por deducirse de Alpha-Pinene (alfa-pineno) — sirve para contrastar con la del proveedor</summary>

**Clasificación:** Líquido inflamable, categoría 3 (H226); toxicidad aguda por vía oral, categoría 4 (H302); peligro por aspiración, categoría 1 (H304); irritación cutánea, categoría 2 (H315); sensibilización cutánea, categoría 1 (H317); peligro acuático crónico, categoría 1 (H410). Palabra de advertencia: Peligro.

```
GHS02 - Llama
GHS07 - Signo de exclamación
GHS08 - Peligro para la salud
GHS09 - Medio ambiente
H226: Líquidos y vapores inflamables.
H302: Nocivo en caso de ingestión.
H304: Puede ser mortal en caso de ingestión y penetración en las vías respiratorias.
H315: Provoca irritación cutánea.
H317: Puede provocar una reacción alérgica en la piel.
H410: Muy tóxico para los organismos acuáticos, con efectos nocivos duraderos.
P210: Mantener alejado del calor, de superficies calientes, de chispas, de llamas abiertas y de cualquier otra fuente de ignición. No fumar.
P233: Mantener el recipiente herméticamente cerrado.
P240: Conectar a tierra y enlace equipotencial del recipiente y del equipo receptor.
P264: Lavarse concienzudamente las manos tras la manipulación.
P270: No comer, beber ni fumar mientras se manipula este producto.
P272: Las prendas de trabajo contaminadas no podrán sacarse del lugar de trabajo.
P273: Evitar su liberación al medio ambiente.
P280: Llevar guantes de protección y gafas de protección o protección facial.
P301 + P310: EN CASO DE INGESTIÓN: Llamar inmediatamente a un CENTRO DE TOXICOLOGÍA o a un médico.
P331: No provocar el vómito.
P302 + P352: EN CASO DE CONTACTO CON LA PIEL: Lavar con abundante agua y jabón.
P333 + P313: En caso de irritación o erupción cutánea: Consultar a un médico.
P370 + P378: En caso de incendio: Utilizar un agente extintor adecuado (polvo químico, espuma o CO₂) para apagarlo.
P391: Recoger el vertido.
P403 + P235: Almacenar en un lugar bien ventilado. Mantener en lugar fresco.
P501: Eliminar el contenido y el recipiente conforme a la reglamentación local vigente.
```

</details>

## VITAMINA C

- **Producto en catálogo:** Vitamina C Solución Al 30% 30ml Mixta Noche (`MCO1347147843`)
- **Archivo:** `fichas_word/datos/vitamina_c.yaml`
- **Campos vacíos:** `cas`, `composicion`, `grado`
- **Por qué:** El producto es una solucion al 30 %, es decir una mezcla (tipo C), y la ficha traia el CAS del acido ascorbico puro (50-81-7). Por la regla de identificacion, una mezcla no lleva CAS unico sino composicion.

**Qué hay que conseguir:**

- [ ] Composicion de la solucion: % de acido ascorbico y vehiculo (agua, propilenglicol, conservante).
- [ ] Confirmar el grado (cosmetico) para decidir si ademas lleva INCI.

