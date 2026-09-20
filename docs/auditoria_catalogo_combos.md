# Auditoría de catálogo — inventario ↔ combos ↔ documentos técnicos

Generado por `scripts/auditar_catalogo_combos.py` el 2026-09-19 15:49. No editar a mano.

**316 productos · 231 combos · 189 materias primas a granel.**

La ficha técnica se hace **una vez por materia prima** (producto de inventario); sus combos `C-…` la heredan.

## Errores de estructura en los combos

### B. Combo sin materia prima — solo lleva empaque, el producto vendido no se descuenta (3)

- `C-ACDKOJDPAL30mL` ACIDO KOJICO D PALMITATO 30mL
- `C-SURLECDULKg` SUERO LECHE DULCE KG
- `C-VITC30P30mL` VITAMINA C 30% 30mL

### C. La cantidad de materia prima no coincide con la presentación (8)

- `C-ACDLAC85P30mL` ACIDO LACTICO 85% 30mL → descuenta **301** de `FOR-ACILAC85PmL` (la presentación dice 30)
- `C-ACEESECORCED5mL` ACEITE ESENCIALCORTEZA CEDRO 5mL → descuenta **51** de `ACECORCEDmL` (la presentación dice 5)
- `C-ACEESEROM5mL` ACETE ESENCIAL ROMERO 5mL → descuenta **51** de `ACEESENROMmL` (la presentación dice 5)
- `C-ACIKOJ5P30mL` ACIDO KOJICO 5% 30mL → descuenta **1** de `FOR-ACIKOJmL` (la presentación dice 30)
- `C-ACISAL50g` ACIDO SALICILICO 50g → descuenta **1** de `ACISALg` (la presentación dice 50)
- `C-ALBHUE500g` ALBUMINA DE HUEVO 500g → descuenta **1** de `ALBHUEg` (la presentación dice 500)
- `C-CRETAR500g` CREMOR TARTARO 500g → descuenta **1** de `CRETARg` (la presentación dice 500)
- `C-MANCACNAT500g` MANTECA DE CACAO NATURAL 500g → descuenta **5001** de `MANCACg` (la presentación dice 500)

### E. Combo sin etiqueta de producto entre sus componentes (8)

- `C-ACEESEBER5mL` ACEITE ESENCIAL BERGAMOTA 5 mL
- `C-AGUROS250mL` AGUA DE ROSAS 250 mL
- `C-DEXKg` DEXTROSA KG
- `C-EXTTEMATVER100g` EXTRACTO TE MATCHA 100g
- `C-GLIVEGLt` GLICERINA VEGETAL 1000mL
- `C-INU250g` INULINA 250g
- `C-LAN250g` LANOLINA 250g
- `C-SUC100g` SUCRALOSA 100g

### A. Combo sin componentes — al venderse no descuenta inventario ni tiene costo (14)

- `C-ACENEE60mL` ACEITE NEEM 60mL
- `C-ACISORKG` ALULOSA KG (COPIA)
- `C-ALFARB10g` ALFA ARBUTINA 10g
- `C-CERABREFKg` CERA ABEJAS REFINADA AMARILLA KG
- `C-CITPOT250g` CITRATO POTASIO 250g
- `C-CITPOT500g` CITRATO POTASIO 500g
- `C-COL50g` COLORANTE ALIMENTARIO 50g
- `C-FLOSECLAV100g` FLORES SECAS LAVANDA 100g
- `C-GELSILCRI250g` GEL SILICA 250g
- `C-LPRO100g` L PROLINA 100g
- `C-MAL500g` MALTODEXTRINA 500g
- `C-POLTWE20P500mL` POLISORBATO TWEEN 20 500mL
- `C-REVVID6mm` REVOLVEDOR VIDRIO 20 X 6 MM
- `C-VAS900g` VASELINA 900g

### D. La materia prima del combo no se parece a su nombre (revisar a ojo) (3)

- `C-ACISAL100g` ACISAL100g → `ACISALg` ACIDO SALICILICO G
- `C-CERLAN500g` CERA LANETTE 500g → `ALCCETESTg` ALCOHOL CETO ESTEARILICO LANET
- `C-CIA100g` CIANOCOBALAMINA 100g → `C-CIAg` CIANOCOBALAMINAG

### G. El nombre del combo es su propio código (1)

- `C-ACISAL100g` ACISAL100g

### I. SKU de venta `C-…` creado como producto simple y no como combo — se vende sin descontar materia prima ni empaque (13)

- `C-ACEESENHIEBUE5mL` ACEITE ESENCIAL HIERBABUENA 5mL MCKENNA GROUP PARA AROMATERAPIA Y MASAJES
- `C-ARCVRT250g` ARCILLA VERDE
- `C-CEBCOR150g` CEBO DE CORDERO 125g
- `C-CIAg` CIANOCOBALAMINAG
- `C-CREMON250g` CREATINA MONOHIDRATO 250g
- `C-DHA10g` AUTOBRONCEADOR POLVO DHA 10g
- `C-EXTMAL500g` EXTRACTO DE MALTA POLVO 500 GR
- `C-FRBSGL120mL` FRAGANCIA BASE GLICERIA 120mL
- `C-KITACIHIA30mL` KIT HIDRATANTE ÁCIDO HIALURÓNICO
- `C-LTEA100g` L TEANINA 100GR N/A
- `C-LTRI100g` L TRIPTOFANO 100GR N/A
- `C-VERMAL30mL` VERDE MALAQUITA 30mL
- `C-VITCACIASC100g` VITAMINA C ACIDO ASCORBICO 100g

### H. Posible materia prima duplicada (mismo nombre, dos códigos) (3)

- `ACEESEPINmL` / `ACEESNPINmL` — ACEITE ESENCIAL DE PINO mL
- `AGDSTgL` / `AGUDESmL` — AGUA DESTILADA GL
- `EMBPATmL` / `EMBPT30ML` — EMBRION PATO ML

## Estado documental por materia prima

| Estado | Materias primas |
|---|---|
| TDS+COA+SDS | 61 |
| completo SIN PUBLICAR | 9 |
| TDS+COA | 10 |
| TDS | 0 |
| borrador | 1 |
| antigua (solo TDS) | 45 |
| vacía | 20 |
| — | 43 |

| Código inventario | Materia prima | Combos que la usan | Documento | Archivo |
|---|---|---|---|---|
| `ACETEATREg` | ACEITE DE ARBOL DE TE ML | 2 | vacía | vacio_ft_coa_sds_aceite_esencial_arbol_de_te.yaml |
| `ACEARGmL` | ACEITE DE ARGAN mL | 1 | TDS+COA+SDS | ft_coa_sds_aceite_argan.yaml |
| `ACECOCmL` | ACEITE DE COCO mL | 2 | — |  |
| `ACEGIRg` | ACEITE DE GIRASOL | 1 | borrador | borrador_ft_coa_sds_aceite_de_girasol.yaml |
| `ACEJOJGOLg` | ACEITE DE JOJOBA GOLDEN ML | 1 | TDS+COA+SDS | ft_coa_sds_aceite_de_jojoba.yaml |
| `ACERICg` | ACEITE DE RICINO G/ML | 3 | TDS+COA+SDS | ft_coa_sds_aceite_de_ricino.yaml |
| `ACEESEALBmL` | ACEITE ESENCIAL ALBAHACA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_albahaca.yaml |
| `ACEESEBERmL` | ACEITE ESENCIAL BERGAMOTA mL | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_bergamota.yaml |
| `ACEESECANmL` | ACEITE ESENCIAL CANELA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_canela.yaml |
| `ACEESECLAmL` | ACEITE ESENCIAL CLAVO ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_clavos.yaml |
| `ACECORCEDmL` | ACEITE ESENCIAL DE CORTEZA DE CEDRO mL | 1 | TDS+COA+SDS | ft_coa_sds_aceite_esencial_corteza_de_cedro.yaml |
| `ACEESEJENmL` | ACEITE ESENCIAL DE JENGIBRE mL | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_jengibre.yaml |
| `ACEESNPINmL` | ACEITE ESENCIAL DE PINO mL | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_pino.yaml |
| `ACEESEEUCg` | ACEITE ESENCIAL EUCALIPTO ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_eucalipto.yaml |
| `ACEESEHIRBUEmL` | ACEITE ESENCIAL HIERBA BUENA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_hierba_buena.yaml |
| `C-ACEESENHIEBUE5mL` | ACEITE ESENCIAL HIERBABUENA 5mL MCKENNA GROUP PARA AROMATERAPIA Y MASAJES | 0 — sin publicar | — |  |
| `ACEESEJAZmL` | ACEITE ESENCIAL JAZMIN ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_jazmin.yaml |
| `ACEESELAVmL` | ACEITE ESENCIAL LAVANDA mL | 1 | TDS+COA+SDS | ft_coa_sds_aceite_esencial_organico_de_lavanda.yaml |
| `ACEESELIMmL` | ACEITE ESENCIAL LIMON ML | 1 | — |  |
| `ACEESEMANmL` | ACEITE ESENCIAL MANDARINA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_mandarina.yaml |
| `ACEESEMANZg` | ACEITE ESENCIAL MANZANILLA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_manzanilla.yaml |
| `ACEESENMENTmL` | ACEITE ESENCIAL MENTA ML | 2 | vacía | vacio_ft_coa_sds_aceite_esencial_menta.yaml |
| `ACEESENARmL` | ACEITE ESENCIAL NARANJA ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_naranja.yaml |
| `ACEESEPINmL` | ACEITE ESENCIAL PINO ML | 1 | vacía | vacio_ft_coa_sds_aceite_esencial_pino.yaml |
| `ACEESENROMmL` | ACEITE ESENCIAL ROMERO ML | 1 | antigua (solo TDS) | acete_esencial_romero.yaml |
| `ACEESNTOMmL` | ACEITE ESENCIAL TOMILLO ML | 1 | antigua (solo TDS) | aceite_esencial_tomillo.yaml |
| `ACEESEYLAmL` | ACEITE ESENCIAL YLANG YLANG | 1 | antigua (solo TDS) | aceite_esencial_ylang_ylang.yaml |
| `ACELINmL` | ACEITE LINAZA ML | 1 | — |  |
| `ACENEEmL` | ACEITE NEEM ML | 3 | vacía | vacio_ft_coa_sds_aceite_de_neem.yaml |
| `ACIAZEg` | ACIDO AZELAICO G | 1 | TDS+COA+SDS | ft_coa_sds_acido_azelaico.yaml |
| `ACICITg` | ACIDO CITRICO G | 2 | TDS+COA+SDS | ft_coa_sds_acido_citrico.yaml |
| `ACIGLIg` | ACIDO GLICOLICO | 0 — sin publicar | antigua (solo TDS) | acido_glicolico.yaml |
| `FOR-ACIGLI50PmL` | ACIDO GLICOLICO 50% ML | 2 | antigua (solo TDS) | acido_glicolico.yaml |
| `ACIHIAALTPESg` | ACIDO HALURONICO ALTO PESO G | 0 — sin publicar | — |  |
| `FOR-ACIHIABAJPESmL` | ACIDO HIALURINICO BAJO PESO ML | 1 | — |  |
| `FOR-ACIHIAALTPESmL` | ACIDO HIALURONICO ALTO PESO ML | 3 | completo SIN PUBLICAR | acido_hialuronico.yaml |
| `ACIHIABAPESg` | ACIDO HIALURONICO BAJO PESO ML | 0 — sin publicar | completo SIN PUBLICAR | acido_hialuronico.yaml |
| `FOR-ACIKOJmL` | ACIDO KOJICO ML | 1 | vacía | acido_kojico.yaml |
| `ACIKOJg` | ACIDO KOJICO POLVO G | 0 — sin publicar | vacía | acido_kojico.yaml |
| `FOR-ACILAC85PmL` | ACIDO LACTICO 85% ML | 1 | antigua (solo TDS) | acido_lactico.yaml |
| `ACLCTGLC30mL` | ÁCIDO LÁCTICO + ÁCIDO GLICÓLICO 30 mL | 0 — sin publicar | antigua (solo TDS) | acido_glicolico.yaml |
| `ACIMALg` | ACIDO MALICO G | 1 | TDS+COA+SDS | ft_coa_sds_acido_malico.yaml |
| `ACIMANg` | ACIDO MANDELICO G | 1 | — |  |
| `ACISALg` | ACIDO SALICILICO G | 3 | TDS+COA+SDS | ft_coa_sds_acido_salicilico.yaml |
| `ACISORg` | ACIDO SORBICO G | 0 — sin publicar | antigua (solo TDS) | acido_sorbico.yaml |
| `ACITRAg` | ACIDO TRANEXAMICO G | 1 | TDS+COA | ft_coa_sds_acido_tranexamico.yaml |
| `AGDSTgL` | AGUA DESTILADA GL | 0 — sin publicar | — |  |
| `AGUDESmL` | AGUA DESTILADA ML | 1 | — |  |
| `AGUROSmL` | AGUA ROSAS ML | 1 | antigua (solo TDS) | agua_de_rosas.yaml |
| `AJONEGSACg` | AJONJOLI NEGRO g | 2 | TDS+COA | ft_coa_sds_ajonjoli_negro.yaml |
| `ALAg` | ALANTOINA | 1 | completo SIN PUBLICAR | alantoina.yaml |
| `ALBHUEg` | ALBUMINA DE HUEVO G | 2 | antigua (solo TDS) | albumina_de_huevo.yaml |
| `ALCCETg` | ALCOHOL CETILICO | 3 | TDS+COA+SDS | ft_coa_sds_alcohol_cetilico.yaml |
| `ALCCETESTg` | ALCOHOL CETO ESTEARILICO LANET | 1 | antigua (solo TDS) | alcohol_ceto_estearilico.yaml |
| `ALCPERmL` | ALCOHOL PERFUMERIA ML | 0 — sin publicar | — |  |
| `ALFARBg` | ALFA ARBUTINA G | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_alfa_arbutina.yaml |
| `ALGSODg` | ALGINATO DE SODIO G | 2 | TDS+COA+SDS | ft_coa_sds_alginato_de_sodio.yaml |
| `ALMNATg` | ALMENDRA NATURAL AMERICANA CAJA 22.68 KG | 2 | — |  |
| `ALUALLg` | ALULOSA/ALLULOSE | 3 | TDS+COA+SDS | ft_coa_sds_alulosa.yaml |
| `AMIBCAg` | AMINOACIDO BCAA INSTANT POWDER | 1 | TDS+COA+SDS | ft_coa_sds_aminoacido_bcaa_instant_m.yaml |
| `AMILARGBASg` | AMINOACIDO L ARGININA G | 1 | TDS+COA+SDS | ft_coa_sds_l_arginina.yaml |
| `AMITEAg` | AMINOACIDO L - TEANINA | 1 | TDS+COA | ft_coa_sds_l_teanina.yaml |
| `AMILTRIg` | AMINOACIDO L - TRIPTOFANO G | 1 | TDS+COA+SDS | ft_coa_sds_l_triptofano.yaml |
| `AMILLISg` | AMIOACIDO L LISINA G | 0 — sin publicar | antigua (solo TDS) | l_lisina.yaml |
| `ARADESg` | ARANDANOS DESHIDRATADOS CAJA 11.34 KG OCEAN SPRAY | 1 | TDS+COA+SDS | ft_coa_sds_arandanos_deshidratados.yaml |
| `ARCRJ250g` | ARCILLA ROJA 250g | 0 — sin publicar | vacía | arcilla_roja.yaml |
| `C-ARCVRT250g` | ARCILLA VERDE | 0 — sin publicar | — |  |
| `C-DHA10g` | AUTOBRONCEADOR POLVO DHA 10g | 0 — sin publicar | — |  |
| `AZUMETg` | AZUL METILENO G | 0 — sin publicar | antigua (solo TDS) | azul_de_metileno.yaml |
| `FOR-AZUMETmL` | AZUL METILENO ML | 1 | antigua (solo TDS) | azul_de_metileno.yaml |
| `BALPET250mL` | BALA PET 250 mL | 1 | — |  |
| `OLTKLt` | BASE OLEATO POTASIO LITRO | 0 — sin publicar | — |  |
| `BAYGOJBERg` | BAYAS DE GOJI BERRY g | 2 | TDS+COA+SDS | ft_coa_sds_bayas_de_goji.yaml |
| `BKR100mL` | BEAKER DE VIDRIO 100mL LABORATORIO VASO DE PRECIPITADO | 1 | — |  |
| `BKR25ML` | BEAKER DE VIDRIO 25mL LABORATORIO VASO DE PRECIPITADO | 0 — sin publicar | — |  |
| `BKR50mL` | BEAKER DE VIDRIO 50mL LABORATORIO VASO DE PRECIPITADO | 1 | — |  |
| `BENSODg` | BENZOATO SODIO G | 1 | antigua (solo TDS) | benzoato_de_sodio.yaml |
| `BICSODg` | BICARBONATO DE SODIO G | 1 | antigua (solo TDS) | bicarbonato_de_sodio.yaml |
| `BOTGLILt` | BOTERO GLICERINA LT | 1 | — |  |
| `BTM50g` | BTMS-50 | 3 | antigua (solo TDS) | btms_50.yaml |
| `CAFANHCHIg` | CAFEINA G | 3 | antigua (solo TDS) | cafeina.yaml |
| `CAOARCg` | CAOLIN ARCILLA G | 2 | TDS+COA+SDS | ft_coa_sds_arcilla_blanca_caolin.yaml |
| `CARACTBITPELg` | CARBON ACTIVADO BITUMINOSO PELLETS G | 1 | antigua (solo TDS) | carbon_activado.yaml |
| `CARCALg` | CARBONATO DE CALCIO G | 1 | TDS+COA+SDS | ft_coa_sds_carbonato_de_calcio.yaml |
| `CARMAGg` | CARBONATO DE MAGNASIO G | 1 | — |  |
| `CEBCORg` | CEBO CORDERO G | 1 | — |  |
| `C-CEBCOR150g` | CEBO DE CORDERO 125g | 0 — sin publicar | — |  |
| `CERANBENATg` | CERA ABEJAS NATURAL G | 1 | — |  |
| `CERCARg` | CERA CARNAUBA G | 3 | antigua (solo TDS) | cera_carnauba.yaml |
| `CERABEREFAMAg` | CERA DE ABEJAS AMARILLA G | 2 | TDS+COA+SDS | ft_coa_sds_cera_abejas_refinada_amarilla.yaml |
| `CERABEREFBLAg` | CERA DE ABEJAS BLANCA G | 2 | TDS+COA+SDS | ft_coa_sds_cera_de_abejas_refinada_blanca.yaml |
| `C-CIAg` | CIANOCOBALAMINAG | 1 | — |  |
| `CITCALg` | CITRATO DE CALCIO | 1 | TDS+COA | ft_coa_sds_citrato_de_calcio.yaml |
| `CITMAGFCCg` | CITRATO DE MAGNESIO FCC/MAGNESIUM CITRATE | 4 | TDS+COA+SDS | ft_coa_sds_citrato_de_magnesio.yaml |
| `CITPOTPOTg` | CITRATO DE POTASIO/POTASSIUM CITRATE | 2 | TDS+COA+SDS | ft_coa_sds_citrato_de_potasio.yaml |
| `CITZINg` | CITRATO ZINC G | 1 | antigua (solo TDS) | citrato_de_zinc.yaml |
| `CLOCALg` | CLORURO CALCIO G | 2 | TDS+COA+SDS | ft_coa_sds_cloruro_de_calcio.yaml |
| `CLOMAGHEXg` | CLORURO MAGNESIO HEXAHIDRATADO G | 1 | antigua (solo TDS) | cloruro_de_magnesio.yaml |
| `COCDESHILg` | COCO DESHIDRATADO HILOS BULTO 25 KG ELMAR | 1 | TDS+COA+SDS | ft_coa_sds_coco_deshidratado_en_hilos.yaml |
| `COCDEAg` | COCOAMIDA DEA G | 1 | antigua (solo TDS) | cocoamida_dea.yaml |
| `COLHIDmL` | COLAGENO HIDROLIZADO ML | 1 | TDS+COA+SDS | ft_coa_sds_colageno_hidrolizado.yaml |
| `COLHIDg` | COLAGENO POLVO HIDROLIZADO | 1 | TDS+COA+SDS | ft_coa_sds_colageno_hidrolizado.yaml |
| `COLPERSIL` | COLLAR PERRO SILICONA | 0 — sin publicar | — |  |
| `COPDOS30mL` | COPA DOSIFICADORA NATU 30,L FARMECEUTICA (IDL11) | 17 | — |  |
| `C-CREMON250g` | CREATINA MONOHIDRATO 250g | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_creatina_monohidrato.yaml |
| `AMICREMONg` | CREATINA MONOHIDRATO G | 3 | TDS+COA+SDS | ft_coa_sds_creatina_monohidrato.yaml |
| `CRETARg` | CREMOR TARTARO G | 1 | — |  |
| `DPANg` | D-PANTENOL G ML | 2 | TDS+COA+SDS | ft_coa_sds_d_pantenol.yaml |
| `DATSAYg` | DATILES SAYED g | 2 | — |  |
| `DEXMONg` | DEXTROSA MONOHIDRATADA | 1 | antigua (solo TDS) | dextrosa.yaml |
| `DHIg` | DIHIDROXIACETONA G | 1 | — |  |
| `DIOTITg` | DIOXIDO TITANIO G | 1 | antigua (solo TDS) | dioxido_de_titanio.yaml |
| `DIPg` | DIPROPILENGLICOL G | 1 | — |  |
| `DOSGOT30mL` | DOSIFICADOR GOTERO PLASTICO 30mL | 1 | — |  |
| `ELAHIDg` | ELASTINA HIDROLIZADA G ML | 3 | antigua (solo TDS) | elastina.yaml |
| `EMBPT30ML` | EMBRIÓN DE PATO 30 mL | 0 — sin publicar | antigua (solo TDS) | embrion_de_pato.yaml |
| `EMBPATmL` | EMBRION PATO ML | 1 | antigua (solo TDS) | embrion_de_pato.yaml |
| `ERLMYR250ML` | ERLEN MEYER MATRAZ 250mL | 0 — sin publicar | — |  |
| `EXTALOVERg` | EXTRACTO ALOE VERA G | 2 | antigua (solo TDS) | aloe_vera.yaml |
| `C-EXTMAL500g` | EXTRACTO DE MALTA POLVO 500 GR | 0 — sin publicar | antigua (solo TDS) | extracto_de_malta.yaml |
| `EXTMALg` | EXTRACTO MALTA G | 1 | antigua (solo TDS) | extracto_de_malta.yaml |
| `EXTTEMATVERg` | EXTRACTO TE MATCHA VERDE G | 1 | TDS+COA+SDS | ft_coa_sds_extracto_de_te_verde.yaml |
| `FLOSECLAVg` | FLORES SECAS LAVANDA G | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_flores_de_lavanda_secas.yaml |
| `FOR-ACISALmL` | FORMULA ACIDO SALICILICO 20% ML | 1 | TDS+COA+SDS | ft_coa_sds_acido_salicilico.yaml |
| `FOR-VITC20PmL` | FORMULA VITAMINA C 20% ML | 2 | TDS+COA+SDS | ft_coa_sds_vitamina_e.yaml |
| `C-FRBSGL120mL` | FRAGANCIA BASE GLICERIA 120mL | 0 — sin publicar | — |  |
| `FRUg` | FRUCTOSA G | 1 | antigua (solo TDS) | fructosa.yaml |
| `GELSILg` | GEL SILICA G | 0 — sin publicar | — |  |
| `GELSINSABg` | GELATINA SIN SABOR G | 1 | TDS+COA | ft_coa_sds_gelatina_sin_sabor_bloom_280.yaml |
| `GLIVEGg` | GLICERINA VEGETAL G | 3 | TDS+COA+SDS | ft_coa_sds_glicerina.yaml |
| `GLUMONMALg` | GLUTAMATO MONOSODICO MALLA 100 | 2 | TDS+COA+SDS | ft_coa_sds_glutamato_monosodico.yaml |
| `FOR-GLUTAR2PmL` | GLUTARALDEHIDO 2% ML | 1 | — |  |
| `GLUTARmL` | GLUTARALDEHIDO ML | 0 — sin publicar | — |  |
| `GOMGUAg` | GOMA GUAR | 1 | antigua (solo TDS) | goma_guar.yaml |
| `GOMXANg` | GOMA XANTANA G | 2 | TDS+COA+SDS | ft_coa_sds_goma_xantana.yaml |
| `GUSSEDmL` | GUSANO SEDA ML | 1 | vacía | gusano_de_seda.yaml |
| `HIDg` | HIDANTATOINAG | 0 — sin publicar | — |  |
| `INU90Pg` | INULINA 90% G | 3 | TDS+COA+SDS | ft_coa_sds_inulina.yaml |
| `C-KITACIHIA30mL` | KIT HIDRATANTE ÁCIDO HIALURÓNICO | 0 — sin publicar | completo SIN PUBLICAR | acido_hialuronico.yaml |
| `L-AMIPROg` | L AMINOACIDO PROLINA G | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_l_prolina.yaml |
| `AMILGLUg` | L-GLUTAMINA G | 1 | antigua (solo TDS) | l_glutamina.yaml |
| `LHST100G` | L HISTIDINA 100 g | 0 — sin publicar | antigua (solo TDS) | l_histidina.yaml |
| `C-LTEA100g` | L TEANINA 100GR N/A | 0 — sin publicar | TDS+COA | ft_coa_sds_l_teanina.yaml |
| `C-LTRI100g` | L TRIPTOFANO 100GR N/A | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_l_triptofano.yaml |
| `LACCALg` | LACTATO CALCIO G | 3 | TDS+COA | ft_coa_sds_lactato_de_calcio.yaml |
| `LANg` | LANOLINA G | 2 | TDS+COA+SDS | ft_coa_sds_lanolina_anhidra.yaml |
| `LECSOYg` | LECITINA SOYA G | 1 | TDS+COA+SDS | ft_coa_sds_lecitina_de_soya_en_polvo.yaml |
| `MALM15MALg` | MALTODEXTRINA M150 / MALTRIN M150g | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_maltodextrina.yaml |
| `MANTOSNATg` | MANI TOSTADO NATURAL CAJA 25 KG RMCA | 1 | TDS+COA | ft_coa_sds_mani_natural_tostado.yaml |
| `MANCACg` | MANTECA CACAO NATURAL G | 1 | antigua (solo TDS) | manteca_cacao.yaml |
| `MANCACREFg` | MANTECA CACAO REFINADA G | 2 | TDS+COA+SDS | ft_coa_sds_manteca_de_cacao_refinada.yaml |
| `MANKARAMAg` | MANTECA KARITE AMARILLA G | 4 | completo SIN PUBLICAR | manteca_karite.yaml |
| `MANKARBLAg` | MANTECA KARITE BLANCA G | 3 | completo SIN PUBLICAR | manteca_karite.yaml |
| `MENCRIg` | MENTOL CRISTAL G | 1 | TDS+COA+SDS | ft_coa_sds_mentol.yaml |
| `NIAg` | NIACINAMIDA G | 1 | completo SIN PUBLICAR | vitamina_b3.yaml |
| `NUEBRAPARg` | NUEZ DEL BRASIL PARTIDA CAJA 20 KG BROKEN A | 2 | TDS+COA | ft_coa_sds_nuez_del_brasil_partida.yaml |
| `OXIZINg` | OXIDO DE ZINC | 1 | antigua (solo TDS) | oxido_de_zinc.yaml |
| `PAPg` | PAPAINA G | 1 | TDS+COA+SDS | ft_coa_sds_papaina.yaml |
| `PARg` | PARAFINA G | 1 | antigua (solo TDS) | parafina.yaml |
| `PISTOSSALg` | PISTACHOS TOSTADOS SALADOS WONDERFUL CAJA 11.34 KG | 2 | TDS+COA+SDS | ft_coa_sds_pistachos_tostados.yaml |
| `POLTWE20Pg` | POLISORBATO 20% G | 0 — sin publicar | antigua (solo TDS) | polisorbato_20.yaml |
| `POLTWE80g` | POLISORBATO 80P G | 1 | antigua (solo TDS) | polisorbato_20.yaml |
| `PROAISSOYg` | PROTEINA AISLADA SOYA G | 1 | TDS+COA+SDS | ft_coa_sds_proteina_aislada_de_soya.yaml |
| `PROCONSUEg` | PROTEINA CONCENTRADA SUERO 80% WPC (LW) | 1 | — |  |
| `FOR-RET5PmL` | RETINOL 5% ML | 1 | — |  |
| `SABCARAHUg` | SABOR CARNE AHUMADA G | 1 | antigua (solo TDS) | sabor_carne_ahumada.yaml |
| `SALROSHIMFINg` | SAL ROSADA DEL HIMALAYA GRANO FINO g | 2 | TDS+COA | ft_coa_sds_sal_rosada_del_himalaya_grano_fino_20_50.yaml |
| `SALROSHIMGRUg` | SAL ROSADA DEL HIMALAYA GRANO GRUESO g | 2 | — |  |
| `SEMCALGRAg` | SEMILLA DE CALABAZA CAJA 25 KG GRADO AA | 2 | TDS+COA+SDS | ft_coa_sds_semillas_de_calabaza.yaml |
| `SEMCHIg` | SEMILLA DE CHIA g | 2 | TDS+COA+SDS | ft_coa_sds_chia.yaml |
| `SHA705mL` | SHAROMIX 705 mL | 3 | TDS+COA+SDS | ft_coa_sds_sharomix_705.yaml |
| `SORPOTg` | SORBATO POTASIO G | 4 | TDS+COA+SDS | ft_coa_sds_sorbato_de_potasio.yaml |
| `SORmL` | SORBITOL ML | 1 | TDS+COA+SDS | ft_coa_sds_sorbitol_polvo.yaml |
| `SORPOLg` | SORBITOL POLVO | 1 | TDS+COA+SDS | ft_coa_sds_sorbitol_polvo.yaml |
| `SUCg` | SUCRALOSA | 1 | TDS+COA+SDS | ft_coa_sds_sucralosa.yaml |
| `TARKARKg` | TARRINA KARITE KG | 2 | — |  |
| `TARTAPVASKg` | TARRINA + TAPA VASELINA KG | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_vaselina.yaml |
| `TAUg` | TAURINA G | 1 | TDS+COA+SDS | ft_coa_sds_taurina.yaml |
| `TEGBETg` | TEGO BETAINA COCO G | 2 | antigua (solo TDS) | betaina_de_coco.yaml |
| `TSSCC500mL` | TENSOACITVO COCO 500mL | 0 — sin publicar | — |  |
| `TENSCIg` | TENSOACTIVO SCI G | 4 | antigua (solo TDS) | sci.yaml |
| `UREg` | UREA G | 2 | antigua (solo TDS) | urea.yaml |
| `VASBLAUSPg` | VASELINA BLANCA USP INDIA X 17 | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_vaselina_blanca.yaml |
| `BKR10ML` | VASO DE PRECIPITADO BEAKER 10mL | 0 — sin publicar | — |  |
| `C-VERMAL30mL` | VERDE MALAQUITA 30mL | 0 — sin publicar | antigua (solo TDS) | verde_malaquita.yaml |
| `VITAg` | VITAMINA A G | 0 — sin publicar | TDS+COA+SDS | ft_coa_sds_vitamina_e.yaml |
| `C-VITCACIASC100g` | VITAMINA C ACIDO ASCORBICO 100g | 0 — sin publicar | completo SIN PUBLICAR | acido_ascorbico.yaml |
| `VITCACIASCg` | VITAMINA C ACIDO ASCORBICO G | 2 | completo SIN PUBLICAR | acido_ascorbico.yaml |
| `VITETOC99Pg` | VITAMINA E ATFA G | 1 | TDS+COA+SDS | ft_coa_sds_vitamina_e.yaml |
