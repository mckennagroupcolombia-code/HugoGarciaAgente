# Proveedores

> Movido tal cual desde CLAUDE.md el 27-sep-2026 al comprimirlo; allí queda un resumen con enlace aquí.

### I. Red de proveedores → sección "Cotizar" de la web + mapamundi

```
/app → Logística Internacional → Proveedores   (desktop/src/components/ProveedoresPanel.tsx)
  ├─ Directorio: proveedores + ficha (productos que maneja, último precio, historial de compras)
  ├─ ¿Quién vende…?: un producto (clave normalizada) → todos los proveedores que lo manejan,
  │    último precio, mínimo, nº de compras → a quién pedir cotización para el mejor precio
  ├─ Catálogos: escanea Gmail (adjuntos PDF/XLSX/CSV con "catálogo", "lista de precios",
  │    "portafolio", "cotización") → extracción heurística SIN LLM → el operador marca líneas
  │    → se guardan como productos del proveedor (también desde la URL de un proveedor)
  ├─ Oferta web: productos con publicar_web=1 → POST /api/proveedores/publicar-web
  │    → PAGINA_WEB/site/data/oferta_proveedores.json  (SIN nombres de proveedor)
  └─ Cotizaciones: solicitudes que llegan desde mckennagroup.co/cotizar + respuesta por correo

Fuentes automáticas (POST /api/proveedores/importar, repetible sin duplicar):
  app/data/facturas_compra_historial.json · Siigo /v1/purchases · contabilidad.db → compras_exterior

Web (website.py :8083):
  /cotizar            listado ampliado (oferta publicada + catálogo en stock) agrupado por línea;
                      lo que no está en stock solo se cotiza ("Bajo pedido"); lo que sí, enlaza a la tienda
  /cotizar/solicitar  POST → solicitudes_cotizacion (proveedores.db) → aviso al agente :8081
                      (/api/proveedores/cotizaciones/notificar, Bearer CHAT_API_TOKEN) → WhatsApp a
                      GRUPO_COTIZACIONES_WA (default GRUPO_PEDIDOS_WEB_WA) + correo de confirmación al cliente
  Inicio → "Del origen a tu fórmula": mapamundi real (_world_land.svg.html, Natural Earth) con dos
  capas: `stock` (origen_materias.json, editable en /app → Vitrina Web → Origen de materias) y
  `red` (países de origen de la oferta publicada). Paquetes animados (<animateMotion>) sobre cada ruta.
```

**Experiencia ilustrada en la web (sep-2026):** `_ruta_origen.html` ("Del origen a tu fórmula": KPIs
animados, cadena de custodia Origen → Tránsito → Calidad → Distribución, filtro por línea, mapamundi con
trama de puntos, rutas animadas con barco/avión, panel por país con productos + badges TDS/COA, tour
automático) y `_cobertura.html` ("Colombia, de punta a punta": mapa por departamentos
`_colombia_map.svg.html` (@svg-maps/colombia, MIT; centros en `app/data/colombia_departamentos_svg.json`),
coropleta con cobertura REAL de pedidos, tramado en los departamentos por impactar, pulsos de despachos
de la semana, puertos y bodega). JS: `static/js/trazabilidad.js`. Datos: `website.py::_construir_ruta_origen`
(cache 5 min; cruza `origen_materias.json` + oferta publicada + `documentos_web` para TDS/COA) y
`_construir_colombia_mapa`. Los **países de origen del catálogo son de referencia** (sembrados por
palabra clave el 2026-09-03 en `origen_materias.json`; el usuario autorizó datos de origen aproximados) —
se corrigen por SKU en /app → Vitrina Web → Origen de materias. `proveedores_db.clasificar_nombre()` /
`autoclasificar_productos()` sugieren línea y origen de productos de proveedores por reglas de nombre;
`es_materia_prima()` excluye empaques/servicios de la publicación; `nombre_publico()` limpia el nombre.

**Catálogos web de proveedores** (`app/tools/catalogos_proveedores_web.py`): extractores por dominio, sin LLM
(glotracol.com WooCommerce, interkrol.com Duda `ul.defaultList`, cadiep.com Webflow h4/h5, productos3a.com Webflow
`.text-block-3`, globalquimia.com.co page-sitemap; fallback heurístico). `CATALOGOS_CONOCIDOS` mapea proveedor →
URL. Cargados el 2026-09-03: Global Trading 123, Interkrol 344, Cadiep 81, Productos 3A 110, Globalquimia 8.
Factores y Mercadeo NO publica su portafolio en la web (solo categorías): pedir lista de precios y cargarla por
Catálogos. **Comparador** (`comparar_proveedores`, `matriz_coincidencias`, `clave_canon` = `nombre_publico`
normalizado): `GET /api/proveedores/comparador?ids=&q=&minimo=` y `GET /api/proveedores/coincidencias`; pestaña
Comparador en el panel. En la web pública (`/cotizar`) los productos bajo pedido se muestran SOLO con el nombre
genérico de la materia prima (`nombre_publico`: sin marca, presentación ni cantidad); la presentación solo se
muestra en productos de la tienda.

**Subcategorías en la web:** `proveedores_db.SUBCATEGORIAS` + `subcategoria_de(nombre, linea)` (segundo nivel
por familia: frutos secos y semillas, vitaminas y minerales, óxidos y oxidantes, sales, tensoactivos, solventes,
cápsulas y excipientes…). `/cotizar` agrupa línea → familia con navegación por chips, bloques de 24 con "ver más"
y buscador instantáneo. Se calcula al publicar (`oferta_proveedores.json`) y para el stock en `website.py`.
**Ojo:** no poner `reveal` en contenedores de listas largas (bloques >10.000 px nunca alcanzan el 10% de
intersección y quedan invisibles; pasó con Alimentario el 2026-09-03).

Datos: `app/services/proveedores_db.py` (SQLite `app/data/proveedores.db`, no versionado). Rutas:
`app/routes_proveedores.py` (`/api/proveedores/*` y alias `/app/api/...`, permiso
`logistica-internacional`). **Regla:** el sitio público nunca muestra el nombre del proveedor; McKenna
es el puente. Ningún endpoint del módulo llama a un LLM (una extracción de catálogos con Claude sería
un paso aparte, gateado por `llm_budget`).
