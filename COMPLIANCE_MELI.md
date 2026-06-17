# COMPLIANCE_MELI.md — Paradigma de Publicación McKenna Group

> **Este documento define la naturaleza de los productos McKenna y las reglas
> estrictas de publicación en Mercado Libre y etiquetas físicas.
> Toda IA, script o proceso que genere contenido de producto DEBE respetar
> estas reglas sin excepción.**

---

## Rol y contexto del negocio

**McKenna Group S.A.S.** reempaca y fracciona **materias primas** (alimentarias,
cosméticas e industriales). **NO vende suplementos dietarios terminados ni
medicamentos al consumidor final.**

Marco legal habilitante: **Resolución 2674/2013 Art. 37 numeral 3 — Reenvase y
fraccionamiento de materia prima alimentaria**. Esta resolución es la que permite
la actividad y debe mencionarse en etiqueta y publicación.

---

## Por qué esto importa: el problema con MeLi

Mercado Libre **no tiene categoría "materia prima"**. El moderador (humano o
automático) infiere la categoría por señales cruzadas en:

- Título y family name
- Dominio y categoría del catálogo (`domain_id` / `category_id`)
- Atributos (`LINE`, `MAIN_SUPPLEMENT`, `INGREDIENTS`, etc.)
- Descripción y bullets
- **Foto principal** — el OCR y visión leen el texto de la etiqueta impresa
- Palabras clave implícitas (farmacológico, dosis, beneficios, % mineral absorbible)

**Error que bajó publicaciones McKenna (ej. citrato de magnesio):**
- `domain_id: MCO-SALT` + categoría "Sal" + título "Sal de magnesio" + `LINE: Sal`
- Etiqueta con "grado farmacológico Ph. Eur. USP", descripción de suplemento/laxante,
  % magnesio elemental, absorción, salud ósea
→ Algoritmo lee **suplemento/sal alimentaria de consumo directo**, no materia prima

**Modelo que funciona (competidores activos + MadreTierra + creatina SYG):**
- Identidad explícita: **"Materia prima / insumo alimentario para formulación"**
- Marco legal visible en etiqueta y descripción
- Taxonomía MeLi coherente con dominio `MCO-SUPPLEMENTS`, LINE correcto
- Nombre químico correcto (nunca "sal de magnesio")

---

## Perfiles de producto

| Perfil | Cuándo aplica | Descriptor clave |
|--------|--------------|-----------------|
| `materia_prima_alimentaria` | Minerales, aminoácidos, almidones, vitaminas en polvo | "Insumo alimentario 100% puro" |
| `insumo_cosmetico` | Aceites esenciales, activos cosméticos, emolientes | "Insumo cosmético — materia prima para formulación" |
| `insumo_tecnico` | Uso industrial, no consumo humano | "Materia prima técnica para uso industrial" |

---

## Identidad del producto — qué decir y qué no

| ✅ Sí decir | ❌ No decir / evitar |
|------------|---------------------|
| Materia prima alimentaria | Suplemento dietario (como producto vendido) |
| Insumo para formulación | Tomar / consumir / dosis diaria / porción |
| Reenvase y fraccionamiento | Medicamento / tratamiento / cura |
| Res. 2674/2013 Art. 37 num. 3 | Registro sanitario INVIMA del producto terminado |
| COA y ficha técnica por lote | Beneficios para la salud / propiedades terapéuticas |
| Uso en elaboración de alimentos, bebidas, cosmética e industria | Antiácidos, laxantes, dolores, estreñimiento, salud ósea |
| Contenido neto (250 g, 500 g…) | Cuchara para consumo (solo "dosificación en formulación") |
| Concentración / pureza técnica | % mineral elemental absorbible por el cuerpo |
| # CAS (opcional, trazabilidad) | Grado farmacológico / Ph. Eur. / USP en etiqueta MeLi |
| Citrato de magnesio | Sal de magnesio |

---

## Palabras y frases PROHIBIDAS en etiqueta + descripción MeLi

Cualquiera de estas señales puede gatillar moderación automática:

- `grado farmacológico` / `Ph. Eur.` / `USP` (en contexto de producto terminado)
- `suplementos dietéticos` / `antiácidos` / `laxante` / `estreñimiento`
- `salud ósea` / `muscular` / `cardiovascular` / `dolores musculares`
- `magnesio elemental` / `16,2%` / `mg por gramo` / `absorbido por el organismo`
- `ciclo de Krebs` / `organismo humano` / `diálisis` / `procedimientos médicos`
- `dosis recomendada` / `porción diaria` / `tómalo` / `consumir de una a dos veces`
- `tratamiento` / `cura` / `medicamento para…`
- `registro INVIMA` (como si fuera producto terminado registrado)
- `Sal de magnesio` (usar "Citrato de magnesio")
- Claims cosméticos al consumidor: `acné`, `arrugas`, `colágeno`, `exfoliante`, `antienvejecimiento`
- `Cuchara medidora` sin aclarar "para dosificación en formulación"

---

## Reglas para ETIQUETA FÍSICA (versión alternativa para foto MeLi)

### Encabezado
- **Título:** nombre del ingrediente en mayúsculas (ej. CITRATO DE MAGNESIO, ÁCIDO CÍTRICO)
- **Subtítulo según perfil:**
  - Alimentario: `"Insumo alimentario 100% puro · Res. 2674/2013 Art. 37-3"`
  - Cosmético: `"Insumo cosmético — materia prima para formulación"`
  - Técnico: `"Materia prima técnica para uso industrial"`
- **Eliminar:** "Materia prima grado farmacológico Ph. Eur. JPC. USP; COA" del encabezado

### Bloque descriptivo
- Describir: forma física, origen/naturaleza del compuesto
- Usos: elaboración (encurtidos, bebidas, panadería, industria, formulación cosmética genérica)
- Cierre legal obligatorio: "No es suplemento terminado ni medicamento"
- **No copiar** párrafos de ficha que hablen del organismo humano, absorción, piel, ciclo de Krebs

### Caja técnica
- ✅ Concentración (ej. 99 %)
- ✅ # CAS (trazabilidad)
- ❌ Fórmula molecular (señal farmacéutica — omitir en versión MeLi)

### Pie legal (obligatorio)
```
Distribuidor: McKenna Group S.A.S · NIT 901.234.567-8 · Bogotá, Colombia
Reenvase amparado por Res. 2674/2013 Art. 37 num. 3
No es medicamento · No es suplemento dietario terminado
Uso exclusivo en formulación y elaboración de productos
```

---

## Reglas para PUBLICACIÓN MERCADO LIBRE

### Taxonomía (minerales, aminoácidos, vitaminas en polvo)
- **`domain_id`:** `MCO-SUPPLEMENTS` (NO `MCO-SALT` para citrato/zinc/magnesio en polvo)
- **`category_id`:** `MCO8830` — Suplementos Alimenticios (contenedor taxonómico MeLi;
  el texto aclara que es materia prima, no suplemento terminado)
- **`LINE`:** `"Materias primas alimentarias"` o `"Insumos alimentarios"` — NUNCA `"Sal"`
- **`INGREDIENTS`:** nombre químico correcto del ingrediente
- **Una sola publicación activa por SKU** (evitar duplicados)

### Título (máx. ~60 caracteres)
```
{Ingrediente} En Polvo Puro {presentación} — Materia Prima
```
Ejemplos:
- ✅ `Citrato De Magnesio En Polvo Puro 250g — Materia Prima`
- ✅ `Ácido Cítrico En Polvo Puro 500g — Materia Prima`
- ❌ `Sal De Magnesio Citrato 500g`
- ❌ `Citrato De Magnesio Premium Suplemento 250g`

### Estructura obligatoria de descripción MeLi
1. **Encabezado:** `NOMBRE — MATERIA PRIMA ALIMENTARIA + contenido neto`
2. **¿Qué es?** Reenvase para formulación. No suplemento terminado ni medicamento.
3. **Aplicaciones:** formulación alimentaria, cosmética e industrial (sin claims de salud)
4. **Calidad:** pureza, COA por lote, ficha técnica en web
5. **Marco regulatorio Colombia:** Res. 2674/2013 Art. 37-3
6. **Advertencias:** no medicamento; responsabilidad del fabricante del producto final
7. **Distribuidor:** McKenna Group S.A.S, NIT, Bogotá

### Foto principal
- Usar **etiqueta alternativa** (no la .ai original con texto farmacológico)
- Debe ser legible el bloque Res. 2674 y "no es suplemento terminado"
- Sin texto de dosis, beneficios ni % mineral para el cuerpo

---

## Checklist pre-publicación (10 ítems)

- [ ] Título usa nombre químico correcto (no "sal de X")
- [ ] Título incluye "Materia Prima" o "Insumo"
- [ ] Descripción no menciona dosis, consumo directo ni beneficios de salud
- [ ] Descripción incluye marco Res. 2674/2013 Art. 37-3
- [ ] `domain_id` es `MCO-SUPPLEMENTS` (no `MCO-SALT`)
- [ ] `LINE` es "Materias primas alimentarias" o "Insumos alimentarios"
- [ ] Etiqueta en foto no tiene texto farmacológico (Ph. Eur., USP, % elemental)
- [ ] No hay claims al consumidor (salud ósea, muscular, absorción)
- [ ] Pie legal de McKenna Group visible en etiqueta
- [ ] Una sola publicación activa por SKU

---

## Herramienta de autopublicación

Ver: `app/tools/meli_compliance.py`

Funciones principales:
- `diagnosticar_riesgo(sku, nombre, titulo_meli, descripcion, texto_etiqueta)` — Analiza y puntúa riesgo
- `generar_contenido_compliance(sku, nombre, presentacion, perfil, ficha_tecnica)` — Genera título, descripción y atributos compliant
- `buscar_publicaciones_pausadas()` — Lista publicaciones pausadas/bajadas en MeLi
- `autopublicar_producto(sku, nombre, presentacion, perfil, ...)` — Pipeline completo: diagnóstico → corrección → publicación en MeLi

---

## Principio rector

> En Colombia vendemos materia prima reenvasada con respaldo legal (Res. 2674/2013 Art. 37-3).
> En MeLi debemos ocupar la categoría disponible sin mentir:
> el producto ES un insumo alimentario/mineral en polvo, NO un suplemento empaquetado para tomar.
> Toda palabra que invite a ingestión directa o beneficio corporal es un riesgo de baja.
>
> **Si hay duda entre sonar a suplemento o a insumo, siempre elegir insumo/formulación.**
