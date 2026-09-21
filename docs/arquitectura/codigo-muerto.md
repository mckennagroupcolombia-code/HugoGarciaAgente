# Código muerto

Generado el 2026-09-21 desde el grafo de codebase-memory-mcp (40.456 nodos, 98.283 aristas). Regenerar con `python3 scripts/arquitectura_cbm.py`; se ve en el panel **Sistemas → Arquitectura del código**.

## Cómo se llegó al número

El dato crudo del grafo no sirve: CBM no crea arista `CALLS` para dos patrones muy comunes en este repo, así que marca como huérfanas funciones que sí se usan.

| Paso | Funciones |
|---|---:|
| Sin llamadores según el grafo | 2940 |
| Quitando tests y entry points | 983 |
| − referenciadas en otro lugar (≥2 menciones en el repo) | −745 |
| − invocadas por un decorador (`@app.route` y similares) | −42 |
| **Confirmadas** | **196** |

Verificado contra los 1.220 archivos fuente versionados. Las dos fuentes de falsos positivos:

1. **Referencias JSX.** `onChange={toggleSelectAll}` pasa la función como prop; no es una
   llamada, así que el grafo la ve huérfana aunque React la invoque.
2. **Rutas Flask.** `@app.route("/api/x")` sobre `def api_x()` — quien invoca es Flask por
   la URL, y el nombre de la función no aparece en ningún lado.

> **Esto no es una orden de borrar.** Lo que queda son funciones con una sola mención en
> todo el repo: su propia definición. Antes de borrar, confirma que no se invoque por un
> camino que el grafo no ve — reflexión, `getattr`, registros por nombre o llamadas desde
> una plantilla.

## Reparto por lenguaje

| Lenguaje | Funciones |
|---|---:|
| `.py` | 102 |
| `.tsx` | 65 |
| `.ts` | 27 |
| `.html` | 2 |

## Por archivo

| Archivo | Muertas |
|---|---:|
| `desktop/src/components/EtiquetasPanel.tsx` | 28 |
| `desktop/src/components/TicketsPanel.tsx` | 15 |
| `app/tools/etiquetas_ai_engine.py` | 13 |
| `PAGINA_WEB/site/website.py` | 9 |
| `app/tools/plantillas_texto_ia.py` | 6 |
| `desktop/src/components/etiqueta-ficha/iconosLineales.tsx` | 6 |
| `app/services/alegra.py` | 5 |
| `desktop/src/components/documentos/FichaTecnicaForm.tsx` | 5 |
| `desktop/src/lib/etiquetasNormativa.ts` | 5 |
| `app/core.py` | 4 |
| `app/services/drive_documentos.py` | 4 |
| `app/tools/tema_web.py` | 4 |
| `app/tools/web_pedidos.py` | 4 |
| `app/tools/despacho.py` | 3 |
| `desktop/src/lib/cmykColor.ts` | 3 |
| `PAGINA_WEB/site/templates/recetario.html` | 2 |
| `app/panel_activity.py` | 2 |
| `app/services/alegra_espejo.py` | 2 |
| `app/services/contabilidad_db.py` | 2 |
| `app/services/siigo.py` | 2 |
| `app/services/tickets_db.py` | 2 |
| `app/services/tts_voicebox.py` | 2 |
| `app/tools/importar_productos_siigo.py` | 2 |
| `app/tools/knowledge_agent.py` | 2 |
| `desktop/src/components/PublicacionesPanel.tsx` | 2 |
| `desktop/src/hooks/useCompetenciaPrecios.ts` | 2 |
| `desktop/src/hooks/usePanelLogs.ts` | 2 |
| `desktop/src/hooks/usePublicaciones.ts` | 2 |
| `desktop/src/lib/hubNav.ts` | 2 |
| `desktop/src/lib/plantillaFichaTecnicaMp.ts` | 2 |
| `desktop/src/lib/plantillasVisualesExport.tsx` | 2 |
| `app/agent/ventas_wa/pedido.py` | 1 |
| `app/memory/episodic.py` | 1 |
| `app/memory/semantic.py` | 1 |
| `app/monitor.py` | 1 |
| `app/observability.py` | 1 |
| `app/services/alegra_puc.py` | 1 |
| `app/services/catalogo_faltantes.py` | 1 |
| `app/services/cinco_s.py` | 1 |
| `app/services/coa_firma.py` | 1 |
| `app/services/compra_exterior_ocr.py` | 1 |
| `app/services/contabilidad_core.py` | 1 |
| `app/services/documento_cientifico.py` | 1 |
| `app/services/documentos_revision.py` | 1 |
| `app/services/facturacion_ventas_cache.py` | 1 |
| `app/services/ficha_tecnica.py` | 1 |
| `app/services/ficha_tecnica_word.py` | 1 |
| `app/services/llm_budget.py` | 1 |
| `app/services/meli_ads.py` | 1 |
| `app/services/mensajeria_pagos.py` | 1 |
| `app/services/panel_presencia.py` | 1 |
| `app/services/publicaciones.py` | 1 |
| `app/services/rentabilidad.py` | 1 |
| `app/services/tickets_notificaciones.py` | 1 |
| `app/services/wa_chats.py` | 1 |
| `app/services/web_chat_consultas.py` | 1 |
| `app/tools/etiquetas_categorias.py` | 1 |
| `app/tools/meli_compliance.py` | 1 |
| `app/tools/pipeline_contenido_facebook.py` | 1 |
| `app/tools/project_indexer.py` | 1 |
| `app/tools/seguimiento_postventa.py` | 1 |
| `app/tools/tema_web_fondos.py` | 1 |
| `app/web_chat_documentos.py` | 1 |
| `app/web_chat_escalacion.py` | 1 |
| `desktop/src/components/ComprasExteriorPanel.tsx` | 1 |
| `desktop/src/components/InventarioCarrito.tsx` | 1 |
| `desktop/src/components/RecetasPanel.tsx` | 1 |
| `desktop/src/components/SociosPanel.tsx` | 1 |
| `desktop/src/components/StockPanelSimple.tsx` | 1 |
| `desktop/src/components/etiquetas/EtiquetaDiagramEditor.tsx` | 1 |
| `desktop/src/components/etiquetas/RecursoPngViewer.tsx` | 1 |
| `desktop/src/hooks/useChat.ts` | 1 |
| `desktop/src/lib/clasificacionInsumo.ts` | 1 |
| `desktop/src/lib/etiquetaFormulario.ts` | 1 |
| `desktop/src/lib/etiquetasStudioHelpers.ts` | 1 |
| `desktop/src/lib/etiquetasTipos.ts` | 1 |
| `desktop/src/lib/navStructure.ts` | 1 |
| `desktop/src/lib/plantillasVisuales.ts` | 1 |
| `desktop/src/lib/studioVisualAccess.ts` | 1 |
| `desktop/src/stores/ticketsAuth.ts` | 1 |
| `scripts/corregir_iva_duplicado_meli.py` | 1 |

## Listado completo

### `PAGINA_WEB/site/templates/recetario.html`

- `initials` — línea 38
- `fmtQ` — línea 41

### `PAGINA_WEB/site/website.py`

- `fetch_meli_photo_urls` — línea 401
- `_core_photo_tokens` — línea 488
- `_score_nombre_producto` — línea 526
- `_load_catalogo_familias_config` — línea 1093
- `_strip_sheet_nombre_noise` — línea 1126
- `_majority_stem` — línea 1500
- `_catalog_group_token` — línea 1508
- `_parse_precio_sheet` — línea 2142
- `_sheet_row_to_line` — línea 2154

### `app/agent/ventas_wa/pedido.py`

- `quitar_pausa` — línea 314

### `app/core.py`

- `_sanitizar_turno_usuario_binario` — línea 751
- `_serializar_content` — línea 772
- `_contexto_historial_web` — línea 1912
- `_responder_con_gemini_primario` — línea 2664

### `app/memory/episodic.py`

- `purge_old_runs` — línea 91

### `app/memory/semantic.py`

- `query_incidents` — línea 166

### `app/monitor.py`

- `sync_stock_diario` — línea 277

### `app/observability.py`

- `new_request_id` — línea 33

### `app/panel_activity.py`

- `get_count` — línea 40
- `get_lines` — línea 45

### `app/services/alegra.py`

- `autenticar_alegra` — línea 107
- `_stamp_info_alegra` — línea 2064
- `mayusculizar_nombres_productos_alegra` — línea 2815
- `listar_retenciones_alegra` — línea 3289
- `crear_item_servicio_alegra` — línea 3578

### `app/services/alegra_espejo.py`

- `plan_cuentas_alegra` — línea 128
- `cuenta_retencion_alegra` — línea 228

### `app/services/alegra_puc.py`

- `en_catalogo_puc` — línea 221

### `app/services/catalogo_faltantes.py`

- `top_sin_resultado` — línea 72

### `app/services/cinco_s.py`

- `asistente_5s` — línea 952

### `app/services/coa_firma.py`

- `extraer_trazo_firma_data_url` — línea 113

### `app/services/compra_exterior_ocr.py`

- `extraer_compra_desde_imagen` — línea 867

### `app/services/contabilidad_core.py`

- `eliminar_cuenta` — línea 667

### `app/services/contabilidad_db.py`

- `regenerar_cuenta_cobro_compra` — línea 1622
- `_unidades_totales_lineas` — línea 1939

### `app/services/documento_cientifico.py`

- `_sinonimos_pubchem` — línea 414

### `app/services/documentos_revision.py`

- `obtener_revision` — línea 34

### `app/services/drive_documentos.py`

- `buscar_ficha_tecnica_pdf` — línea 180
- `buscar_coa_pdf` — línea 189
- `buscar_sds_pdf` — línea 198
- `buscar_registro_invima_pdf` — línea 207

### `app/services/facturacion_ventas_cache.py`

- `obtener_venta` — línea 197

### `app/services/ficha_tecnica.py`

- `_cabezote_src_html` — línea 1102

### `app/services/ficha_tecnica_word.py`

- `procesar_word_a_ficha` — línea 440

### `app/services/llm_budget.py`

- `estimar_tokens` — línea 102

### `app/services/meli_ads.py`

- `es_marca_ajena_por_nombre` — línea 132

### `app/services/mensajeria_pagos.py`

- `obtener_envio` — línea 201

### `app/services/panel_presencia.py`

- `get_db_path` — línea 357

### `app/services/publicaciones.py`

- `_meli_fetch_item` — línea 417

### `app/services/rentabilidad.py`

- `reclasificar_categorias_componentes` — línea 655

### `app/services/siigo.py`

- `_listar_centros_costo_siigo_legado` — línea 191
- `editar_factura_siigo` — línea 1125

### `app/services/tickets_db.py`

- `_zona_profundidad` — línea 5165
- `puede_ver_studio_visual` — línea 5890

### `app/services/tickets_notificaciones.py`

- `_desc_corta` — línea 134

### `app/services/tts_voicebox.py`

- `estado_modelos_voicebox` — línea 247
- `limpiar_generaciones_fallidas_voicebox` — línea 274

### `app/services/wa_chats.py`

- `reparar_duplicados_salida_en_db` — línea 571

### `app/services/web_chat_consultas.py`

- `buscar_consulta_por_sufijo` — línea 101

### `app/tools/despacho.py`

- `crear_guia_despacho` — línea 53
- `obtener_estado_despacho` — línea 110
- `marcar_entregado` — línea 124

### `app/tools/etiquetas_ai_engine.py`

- `_ajustar_spec_overlays_ai` — línea 74
- `_dimensiones_barcode_embebido` — línea 135
- `_transform_desarrollado_original` — línea 160
- `_partir_lineas_desarrollado` — línea 167
- `_normalizar_bloque_desarrollado_ai` — línea 194
- `_reinsertar_barcode_antes_lote_ai` — línea 220
- `_normalizar_texto_rsn_ai` — línea 274
- `_elevar_elementos_columna_derecha_svg` — línea 285
- `_inyectar_lote_exp_recuadro_ai` — línea 383
- `_ajustar_pie_y_columna_ai` — línea 439
- `_ajustar_columna_derecha_ai` — línea 450
- `_es_bloque_texto_protegido` — línea 1761
- `_corregir_typos_plantilla_ai` — línea 2691

### `app/tools/etiquetas_categorias.py`

- `id_categoria_desde_nombre` — línea 144

### `app/tools/importar_productos_siigo.py`

- `_siigo_request_con_reintentos` — línea 619
- `podar_pendientes_fuera_de_anio` — línea 1072

### `app/tools/knowledge_agent.py`

- `sintetizar_con_gemini` — línea 517
- `buscar_conocimiento_local` — línea 571

### `app/tools/meli_compliance.py`

- `_foto_desde_item` — línea 1783

### `app/tools/pipeline_contenido_facebook.py`

- `_fal_queue` — línea 493

### `app/tools/plantillas_texto_ia.py`

- `_asegurar_dos_parrafos` — línea 501
- `_primera_oracion` — línea 1266
- `_relleno_p2` — línea 1567
- `_uso_generico_p2` — línea 1571
- `_oracion_propiedades_mp` — línea 2015
- `_oraciones_desde_ficha` — línea 2038

### `app/tools/project_indexer.py`

- `buscar_en_proyecto` — línea 133

### `app/tools/seguimiento_postventa.py`

- `registrar_venta_para_seguimiento` — línea 40

### `app/tools/tema_web.py`

- `restaurar_tema_pureza` — línea 913
- `restaurar_diseno` — línea 937
- `restaurar_layout` — línea 942
- `restaurar_layout_clasico` — línea 947

### `app/tools/tema_web_fondos.py`

- `listar_fondos` — línea 76

### `app/tools/web_pedidos.py`

- `orders_db_path` — línea 78
- `reenviar_correo_confirmacion_pedido` — línea 557
- `send_order_confirmation_preview_test` — línea 596
- `_infer_siigo_city_codes_from_web_order` — línea 1249

### `app/web_chat_documentos.py`

- `_nota_whatsapp_opcional` — línea 269

### `app/web_chat_escalacion.py`

- `manejar_escalacion_tecnica_web` — línea 82

### `desktop/src/components/ComprasExteriorPanel.tsx`

- `calcularLandedCliente` — línea 267

### `desktop/src/components/EtiquetasPanel.tsx`

- `seleccionDesdeClick` — línea 461
- `seleccionUnica` — línea 468
- `capturarOrigenesGrupo` — línea 567
- `alinearSeleccionPlantilla` — línea 593
- `elementosEnMarquee` — línea 667
- `nuevaImagenPlantilla` — línea 813
- `nuevoRectangulo` — línea 839
- `rectNormalizado` — línea 855
- `dimensioensPlantillaMm` — línea 874
- `rotarPlantillaContenido` — línea 895
- `rotacionDesdePlantilla` — línea 921
- `snapLineaRecta` — línea 926
- `calcularCajaRedimension` — línea 1058
- `SeparadorToolbar` — línea 1101
- `BarraIconos` — línea 1105
- `PanelLateralApariencia` — línea 1287
- `PanelSuperiorEdicion` — línea 1482
- `BtnIconoToolbar` — línea 1568
- `MarcoSeleccionSimple` — línea 1603
- `PanelAlineacion` — línea 1621
- `MarcoRedimensionable` — línea 1654
- `esTeclaEliminarElemento` — línea 1713
- `enCampoEditable` — línea 1724
- `ImgRecursoPng` — línea 1734
- `BotonImportarImagenRecurso` — línea 1786
- `EditorEtiqueta` — línea 3742
- `resolverPdfDesdeCatalogo` — línea 5107
- `handoffDesdeDatos` — línea 7153

### `desktop/src/components/InventarioCarrito.tsx`

- `InventarioCarritoNavBtn` — línea 93

### `desktop/src/components/PublicacionesPanel.tsx`

- `SyncBadge` — línea 67
- `ImagenesTab` — línea 450

### `desktop/src/components/RecetasPanel.tsx`

- `esRecetaPropia` — línea 569

### `desktop/src/components/SociosPanel.tsx`

- `MarcarHechoInline` — línea 3517

### `desktop/src/components/StockPanelSimple.tsx`

- `aplicarEstadoEnCache` — línea 1570

### `desktop/src/components/TicketsPanel.tsx`

- `navScopeActivo` — línea 1706
- `LoginView` — línea 2674
- `ReinoBoardStickyItems` — línea 3790
- `ParticipantesSection` — línea 6681
- `eliminarAliado` — línea 11626
- `subirAdjuntoTicket` — línea 14103
- `promoverProtocolo` — línea 26045
- `cargarPasosAccion` — línea 29538
- `goTablero` — línea 30439
- `salirDeAgente` — línea 30451
- `goInventario` — línea 30508
- `goReinos` — línea 30509
- `goWorkload` — línea 30510
- `goRecetas` — línea 30511
- `goCreateMision` — línea 30512

### `desktop/src/components/documentos/FichaTecnicaForm.tsx`

- `IaChips` — línea 160
- `parseChips` — línea 601
- `updateComp` — línea 638
- `addComp` — línea 646
- `removeComp` — línea 648

### `desktop/src/components/etiqueta-ficha/iconosLineales.tsx`

- `IconoOrigen` — línea 15
- `IconoApariencia` — línea 25
- `IconoOlor` — línea 33
- `IconoComposicion` — línea 43
- `IconoGrado` — línea 52
- `IconoConservacion` — línea 61

### `desktop/src/components/etiquetas/EtiquetaDiagramEditor.tsx`

- `posicionAsaRedimension` — línea 258

### `desktop/src/components/etiquetas/RecursoPngViewer.tsx`

- `VistaPreviaPngGrande` — línea 85

### `desktop/src/hooks/useChat.ts`

- `useChatMutation` — línea 14

### `desktop/src/hooks/useCompetenciaPrecios.ts`

- `useGuardarObservacionCompetencia` — línea 142
- `useBorrarObservacionCompetencia` — línea 245

### `desktop/src/hooks/usePanelLogs.ts`

- `usePanelLogs` — línea 8
- `useClearPanelLogs` — línea 17

### `desktop/src/hooks/usePublicaciones.ts`

- `useSyncMeli` — línea 307
- `useRefreshWeb` — línea 367

### `desktop/src/lib/clasificacionInsumo.ts`

- `valorSiNoAplica` — línea 104

### `desktop/src/lib/cmykColor.ts`

- `cmykToHex` — línea 12
- `hexToHsl` — línea 45
- `hslToHex` — línea 64

### `desktop/src/lib/etiquetaFormulario.ts`

- `valoresFormularioADatos` — línea 591

### `desktop/src/lib/etiquetasNormativa.ts`

- `aplicarDefaultsAlternativa` — línea 180
- `perfilSubtitulo` — línea 215
- `puedeExportarEtiqueta` — línea 467
- `erroresExportarEtiqueta` — línea 471
- `borradorMeliCompleto` — línea 487

### `desktop/src/lib/etiquetasStudioHelpers.ts`

- `tipoDesdeNombrePlantilla` — línea 25

### `desktop/src/lib/etiquetasTipos.ts`

- `tiposEtiquetaMap` — línea 75

### `desktop/src/lib/hubNav.ts`

- `esPanelDeHub` — línea 101
- `esCategoriaHub` — línea 107

### `desktop/src/lib/navStructure.ts`

- `navSectionDef` — línea 204

### `desktop/src/lib/plantillaFichaTecnicaMp.ts`

- `fichaMpFormatoAprietado` — línea 716
- `plantillaFormatoEtiqueta` — línea 1200

### `desktop/src/lib/plantillasVisuales.ts`

- `escalaParaDpiImpresion` — línea 662

### `desktop/src/lib/plantillasVisualesExport.tsx`

- `guardarPlantillaEnGaleria` — línea 1010
- `descargarBase64` — línea 1049

### `desktop/src/lib/studioVisualAccess.ts`

- `puedeVerStudioVisual` — línea 39

### `desktop/src/stores/ticketsAuth.ts`

- `waitForTicketsAuthHydration` — línea 93

### `scripts/corregir_iva_duplicado_meli.py`

- `_redondear_cop` — línea 99
