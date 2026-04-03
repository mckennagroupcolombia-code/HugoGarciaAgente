"""
Automatización de Extracción de Datos de Facturas Electrónicas
y Carga en Plantilla de Siigo (Importación de Productos).

Flujo:
  Gmail "FACTURAS MCKG" → ZIP → XML DIAN
    → extraer productos + cantidades + IVA
    → generar código (3init×3palabras + unidad)
    → convertir a unidad mínima (mL / g / Un)
    → calcular precio/unidad con IVA proporcional
    → verificar duplicados en SIIGO
    → generar Excel compatible con importación SIIGO
    → notificar por WhatsApp con archivo adjunto
"""

import os
import re
import unicodedata
import requests
from datetime import datetime

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

from app.tools.sincronizar_facturas_de_compra_siigo import (
    get_gmail_service,
    leer_correos_no_descargados,
    descargar_y_extraer_zip,
    extraer_datos_xml_dian,
    CARPETA_FACTURAS_LOCAL,
)
from app.services.siigo import autenticar_siigo, PARTNER_ID
from app.utils import enviar_whatsapp_reporte, enviar_whatsapp_archivo

# ─────────────────────────────────────────────
#  Configuración
# ─────────────────────────────────────────────

CARPETA_IMPORTACIONES = os.path.join("/home/mckg/mi-agente", "importaciones_productos")
os.makedirs(CARPETA_IMPORTACIONES, exist_ok=True)

# Palabras que se ignoran al generar el código del producto
STOPWORDS = {
    'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'con',
    'por', 'a', 'en', 'al', 'y', 'e', 'o', 'u', 'al', 'se',
}

# Conversión desde código DIAN de la factura → (unidad_mínima, factor_multiplicador)
# La unidad mínima es la que se registra en SIIGO
CONVERSION_UNIDADES = {
    # Volumen → mL
    'LTR': ('mL', 1_000),        # Litro
    'MLT': ('mL', 1),             # Mililitro
    'CLT': ('mL', 10),            # Centilitro
    'GLL': ('mL', 3_785.41),      # Galón US
    'OZA': ('mL', 29.5735),       # Onza fluida
    # Masa → g
    'KGM': ('g', 1_000),          # Kilogramo
    'GRM': ('g', 1),              # Gramo
    'MGM': ('g', 0.001),          # Miligramo
    'CGM': ('g', 0.01),           # Centigramo
    'LBR': ('g', 453.592),        # Libra
    'ONZ': ('g', 28.3495),        # Onza masa
    # Unidades
    'NAR': ('Un', 1),             # Número de artículo (unidad estándar DIAN)
    'UN':  ('Un', 1),
    'UNI': ('Un', 1),
    'C62': ('Un', 1),             # Another DIAN unit code
    'BX':  ('Un', 1),             # Caja (se registra por caja)
    'PAR': ('Un', 1),             # Par
    'SET': ('Un', 1),             # Set
    'DZN': ('Un', 12),            # Docena → 12 unidades
    'XBX': ('Un', 1),
}

# Código DIAN oficial para la unidad mínima
DIAN_MIN_CODE = {
    'mL': 'MLT',
    'g':  'GRM',
    'Un': 'NAR',
}

# Colores corporativos para Excel
COLOR_HEADER_BG = "1F4E79"   # Azul oscuro McKenna
COLOR_HEADER_FG = "FFFFFF"   # Blanco
COLOR_ALT_ROW   = "D9E2F3"   # Azul muy claro para filas alternas


# ─────────────────────────────────────────────
#  Lógica de generación de código
# ─────────────────────────────────────────────

def _normalizar(texto: str) -> str:
    """Elimina tildes y convierte a mayúsculas."""
    return ''.join(
        c for c in unicodedata.normalize('NFD', texto.upper())
        if unicodedata.category(c) != 'Mn'
    )


def generar_codigo_producto(nombre: str, unidad_minima: str) -> str:
    """
    Genera código de producto SIIGO:
      → 3 primeras letras de cada una de las 3 palabras clave (sin stopwords)
      → + sufijo de unidad: mL | g | Un

    Ejemplo:
      "ACEITE DE RICINO"  + mL  →  ACERICmL
      "GLICERINA VEGETAL REFINADA" + g → GLIVEGREFg
    """
    nombre_norm = _normalizar(nombre)
    # Limpiar caracteres no alfanuméricos (guiones, paréntesis, etc.)
    palabras_raw = re.split(r'[\s\-_/,.()+]+', nombre_norm)
    palabras_clave = [
        p for p in palabras_raw
        if p and p.lower() not in STOPWORDS and len(p) >= 2
    ]

    # Tomar hasta 3 palabras clave y sus 3 primeras letras
    fragmentos = [p[:3] for p in palabras_clave[:3]]
    # Si hay menos de 3 palabras útiles, completar con las disponibles
    codigo = ''.join(fragmentos) + unidad_minima
    return codigo


# ─────────────────────────────────────────────
#  Conversión de unidades
# ─────────────────────────────────────────────

def _extraer_unit_code_de_xml(xml_content: str, descripcion_item: str) -> str:
    """
    Extrae el unitCode de la línea InvoiceLine que corresponde a la descripción dada.
    Fallback: intenta inferirlo por palabras clave en la descripción.
    """
    import xml.etree.ElementTree as ET

    def tag(elem):
        return elem.tag.split('}')[-1]

    unidades_encontradas = {}
    try:
        root = ET.fromstring(xml_content)
        for elem in root.iter():
            if tag(elem) == 'InvoiceLine':
                # buscar descripción y cantidad
                desc = ''
                unit_code = ''
                for sub in elem.iter():
                    if tag(sub) == 'Description' and sub.text:
                        desc = sub.text.strip()
                    if tag(sub) == 'InvoicedQuantity':
                        unit_code = sub.get('unitCode', '')
                if desc and unit_code:
                    unidades_encontradas[desc.upper()] = unit_code.upper()
    except Exception:
        pass

    # Buscar coincidencia exacta o parcial con la descripción del ítem
    desc_up = descripcion_item.upper()
    if desc_up in unidades_encontradas:
        return unidades_encontradas[desc_up]
    for k, v in unidades_encontradas.items():
        if desc_up[:20] in k or k[:20] in desc_up:
            return v

    # Inferencia por palabras clave si no se encontró en XML
    d = descripcion_item.lower()
    if any(w in d for w in ['litro', 'liter', 'l ', ' l']):
        return 'LTR'
    if any(w in d for w in ['galon', 'galón', 'gal']):
        return 'GLL'
    if any(w in d for w in ['gramo', 'gram', 'gr ']):
        return 'GRM'
    if any(w in d for w in ['kilo', 'kg']):
        return 'KGM'
    if any(w in d for w in ['ml', 'mililitro']):
        return 'MLT'
    return 'NAR'  # Default: unidad


def convertir_a_unidad_minima(cantidad: float, unit_code: str) -> tuple[float, str, str]:
    """
    Convierte cantidad y unidad DIAN a unidad mínima de inventario.
    Retorna (cantidad_min, unidad_min_simbolo, codigo_dian_min).
    """
    unit_code = (unit_code or 'NAR').upper().strip()
    unidad_min, factor = CONVERSION_UNIDADES.get(unit_code, ('Un', 1))
    cantidad_min = round(cantidad * factor, 6)
    codigo_dian_min = DIAN_MIN_CODE.get(unidad_min, 'NAR')
    return cantidad_min, unidad_min, codigo_dian_min


# ─────────────────────────────────────────────
#  Cálculo de precio por unidad mínima
# ─────────────────────────────────────────────

def calcular_precio_unitario_min(subtotal_linea: float, iva_linea: float, cantidad_min: float) -> float:
    """
    Precio de venta por unidad mínima = (subtotal + IVA proporcional) / cantidad_min.
    Redondea al entero más cercano (COP no usa decimales en SIIGO).
    """
    if cantidad_min <= 0:
        return 0.0
    total_con_iva = subtotal_linea + iva_linea
    return round(total_con_iva / cantidad_min, 2)


# ─────────────────────────────────────────────
#  Verificación de duplicados en SIIGO
# ─────────────────────────────────────────────

def verificar_producto_en_siigo(codigo: str) -> bool:
    """
    Consulta SIIGO API para saber si ya existe un producto con ese código.
    Retorna True si YA existe (duplicado), False si es nuevo.
    """
    try:
        token = autenticar_siigo()
        if not token:
            return False
        res = requests.get(
            f"https://api.siigo.com/v1/products?code={codigo}&page_size=1",
            headers={"Authorization": f"Bearer {token}", "Partner-Id": PARTNER_ID},
            timeout=10
        )
        if res.status_code == 200:
            data = res.json()
            results = data.get('results', [])
            return len(results) > 0 and any(
                p.get('code', '').upper() == codigo.upper()
                for p in results
            )
    except Exception as e:
        print(f"⚠️ [SIIGO] Error verificando producto {codigo}: {e}")
    return False


# ─────────────────────────────────────────────
#  Generación del Excel de importación
# ─────────────────────────────────────────────

HEADERS_SIIGO = [
    "Tipo de producto",          # A → P-Producto
    "Categoría de inventarios",  # B → 1
    "Código",                    # C → generado
    "Nombre",                    # D → descripción factura
    "Inventariable",             # E → SI
    "Unidad de medida (Código DIAN)",  # F → MLT | GRM | NAR
    "Precio de venta",           # G → calculado
]


def generar_excel_importacion(productos: list, numero_factura: str) -> str:
    """
    Genera el archivo Excel para importación de productos en SIIGO.
    Retorna la ruta del archivo generado.
    """
    nombre_archivo = f"{numero_factura} registro productos.xlsx"
    ruta = os.path.join(CARPETA_IMPORTACIONES, nombre_archivo)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Productos"

    # — Encabezados con estilo
    header_fill = PatternFill("solid", fgColor=COLOR_HEADER_BG)
    header_font = Font(bold=True, color=COLOR_HEADER_FG, size=11)
    for col_idx, header in enumerate(HEADERS_SIIGO, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)

    ws.row_dimensions[1].height = 30

    # — Datos
    alt_fill = PatternFill("solid", fgColor=COLOR_ALT_ROW)
    for row_idx, p in enumerate(productos, 2):
        fill = alt_fill if row_idx % 2 == 0 else None
        valores = [
            "P-Producto",
            1,
            p['codigo'],
            p['nombre'],
            "SI",
            p['codigo_dian_min'],
            p['precio_unitario'],
        ]
        for col_idx, valor in enumerate(valores, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=valor)
            if fill:
                cell.fill = fill
            cell.alignment = Alignment(vertical='center')

    # — Anchos de columna
    anchos = [18, 24, 16, 50, 14, 26, 18]
    for col_idx, ancho in enumerate(anchos, 1):
        ws.column_dimensions[
            openpyxl.utils.get_column_letter(col_idx)
        ].width = ancho

    # — Hoja de instrucciones
    ws_instr = wb.create_sheet("Instrucciones")
    ws_instr['A1'] = "INSTRUCCIONES PARA CARGAR EN SIIGO"
    ws_instr['A1'].font = Font(bold=True, size=13)
    instrucciones = [
        "",
        "1. Ingresa a SIIGO Nube.",
        "2. Ve al módulo de Inventario → Productos.",
        "3. Haz clic en el botón ▶ Importación.",
        "4. En el Paso 2, selecciona este archivo Excel.",
        "5. Verifica la vista previa y confirma la importación.",
        "",
        "NOTA: Los productos marcados como DUPLICADO en la hoja",
        "      'Productos' ya existen en SIIGO — revisa antes de importar.",
    ]
    for i, linea in enumerate(instrucciones, 2):
        ws_instr[f'A{i}'] = linea
    ws_instr.column_dimensions['A'].width = 65

    wb.save(ruta)
    print(f"📊 [IMPORTACIÓN] Excel generado: {ruta}")
    return ruta


# ─────────────────────────────────────────────
#  Orquestador principal
# ─────────────────────────────────────────────

def procesar_facturas_para_importar_productos(dias: int = 30) -> str:
    """
    Función principal. Lee facturas del correo, extrae productos,
    genera Excel de importación y notifica por WhatsApp.

    Args:
        dias: no se usa para filtrar (Gmail usa etiqueta), pero se muestra en el log.
    """
    print(f"\n🚀 [IMPORTACIÓN] Iniciando extracción de productos desde facturas de proveedor...")

    correos = leer_correos_no_descargados()
    if not correos:
        return "No se encontraron facturas nuevas en el correo (label: FACTURAS MCKG)."

    service = get_gmail_service()
    archivos_generados = []

    for correo in correos:
        print(f"\n📩 Procesando: '{correo['asunto']}'")

        for adjunto in correo['adjuntos_zip']:
            print(f"  📥 Descargando {adjunto['filename']}...")
            xml_content, _pdf, _pdf_name = descargar_y_extraer_zip(
                service, correo['id'], adjunto['id'], adjunto['filename']
            )

            if not xml_content:
                print("  ⚠️ No se encontró XML válido en el ZIP.")
                continue

            datos = extraer_datos_xml_dian(xml_content)
            if not datos:
                print("  ⚠️ No se pudo parsear el XML DIAN.")
                continue

            numero_factura = f"{datos['prefix']}{datos['number']}"
            proveedor = datos['proveedor']
            print(f"  📄 Factura: {numero_factura} | Proveedor: {proveedor}")

            # ── Procesar cada ítem de la factura
            productos_nuevos = []
            productos_duplicados = []

            for item in datos['items']:
                nombre = item['description'].strip()
                subtotal = item['subtotal']
                cantidad_original = item['quantity']

                # IVA de la línea (solo impuesto id=01)
                iva_linea = sum(
                    imp['valor'] for imp in item.get('impuestos', [])
                    if imp.get('id_dian') == '01'
                )

                # Obtener unidad desde el XML
                unit_code = _extraer_unit_code_de_xml(xml_content, nombre)

                # Convertir a unidad mínima
                cantidad_min, unidad_min, codigo_dian_min = convertir_a_unidad_minima(
                    cantidad_original, unit_code
                )

                # Precio por unidad mínima con IVA proporcional
                precio_unitario = calcular_precio_unitario_min(subtotal, iva_linea, cantidad_min)

                # Generar código
                codigo = generar_codigo_producto(nombre, unidad_min)

                # Verificar duplicado en SIIGO
                es_duplicado = verificar_producto_en_siigo(codigo)

                producto = {
                    'nombre': nombre,
                    'codigo': codigo,
                    'cantidad_original': cantidad_original,
                    'unidad_original': unit_code,
                    'cantidad_min': cantidad_min,
                    'unidad_min': unidad_min,
                    'codigo_dian_min': codigo_dian_min,
                    'subtotal': subtotal,
                    'iva': iva_linea,
                    'precio_unitario': precio_unitario,
                    'duplicado': es_duplicado,
                }

                if es_duplicado:
                    productos_duplicados.append(producto)
                    print(f"  ⚠️ DUPLICADO en SIIGO: {codigo} — {nombre[:40]}")
                else:
                    productos_nuevos.append(producto)
                    print(f"  ✅ Nuevo: {codigo} — {nombre[:40]} → ${precio_unitario:.2f}/{unidad_min}")

            todos = productos_nuevos + productos_duplicados
            if not todos:
                print(f"  ℹ️ Sin ítems procesables en {numero_factura}.")
                continue

            # ── Generar Excel (incluye todos; duplicados visibles para revisión)
            ruta_excel = generar_excel_importacion(todos, numero_factura)
            archivos_generados.append({
                'ruta': ruta_excel,
                'numero_factura': numero_factura,
                'proveedor': proveedor,
                'nuevos': len(productos_nuevos),
                'duplicados': len(productos_duplicados),
            })

    if not archivos_generados:
        return "Se leyeron correos pero no se generó ningún archivo (verifica que los ZIP contengan XML DIAN válido)."

    # ── Notificar y enviar archivos por WhatsApp
    resumen_total = []
    for arch in archivos_generados:
        lineas_resumen = _construir_resumen_whatsapp(arch)
        enviar_whatsapp_reporte(lineas_resumen)
        enviar_whatsapp_archivo(
            arch['ruta'],
            f"📊 Importación SIIGO — Factura {arch['numero_factura']}"
        )
        resumen_total.append(
            f"✅ {arch['numero_factura']}: {arch['nuevos']} nuevos, {arch['duplicados']} duplicados"
        )

    return "\n".join(resumen_total)


def _construir_resumen_whatsapp(arch: dict) -> str:
    return (
        f"📦 *Importación de Productos SIIGO*\n\n"
        f"🔢 *Factura:* {arch['numero_factura']}\n"
        f"🏢 *Proveedor:* {arch['proveedor']}\n\n"
        f"✅ *Productos nuevos:* {arch['nuevos']}\n"
        f"⚠️ *Ya en SIIGO (duplicados):* {arch['duplicados']}\n\n"
        f"📎 *Archivo adjunto:* `{os.path.basename(arch['ruta'])}`\n\n"
        f"📋 *Pasos para cargar en SIIGO:*\n"
        f"   1. Inventario → Productos\n"
        f"   2. Clic en ▶ *Importación*\n"
        f"   3. Paso 2: selecciona el archivo adjunto\n"
        f"   4. Verifica la vista previa y confirma"
    )


if __name__ == "__main__":
    resultado = procesar_facturas_para_importar_productos()
    print(f"\n{resultado}")
