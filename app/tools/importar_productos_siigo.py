"""
Automatización de Extracción de Datos de Facturas Electrónicas
y Carga en Plantilla de Siigo (Importación de Productos).

═══════════════════════════════════════════════════════════════
ATENCIÓN — DOS FLUJOS COMPLETAMENTE INDEPENDIENTES EN SIIGO:
═══════════════════════════════════════════════════════════════

  FLUJO A — REGISTRO DE COMPRA (este módulo):
    Solo aplica a proveedores de MATERIAS PRIMAS que se inventarían.
    Gmail → ZIP → XML DIAN → codificar → XML McKenna → importar en SIIGO
    como "Crear compra o gasto desde XML o ZIP".

    NO aplica a: consumibles, gastos de envío, servicios generales.
    Esos se registran directamente en SIIGO como gasto/costo sin
    pasar por este proceso de codificación de inventario.

  FLUJO B — FACTURACIÓN DE VENTA (módulo separado: siigo.py):
    Cuando un cliente compra, se crea la factura de venta en SIIGO.
    Ese proceso es completamente distinto y no tiene relación con
    el registro de compra de este módulo.

═══════════════════════════════════════════════════════════════

Pipeline de este módulo (solo proveedores especiales):
  Gmail "FACTURAS MCKG" → ZIP → XML DIAN
    → verificar si proveedor está en lista de proveedores especiales
    → extraer productos + cantidades + IVA
    → generar código McKenna (3init×3palabras + unidad)
    → convertir a unidad mínima (mL / g / Un)
    → calcular precio/unidad con IVA proporcional
    → verificar duplicados en SIIGO
    → generar Excel de registro de productos
    → generar XML de compra con códigos SIIGO internos
    → notificar por WhatsApp con protocolo de carga en SIIGO
"""

import os
import re
import json
import threading
import unicodedata
import requests
import xml.etree.ElementTree as ET
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

GRUPO_COMPRAS = os.getenv("GRUPO_FACTURACION_COMPRAS_WA", "120363408323873426@g.us")

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

# ─────────────────────────────────────────────
#  Lista de proveedores especiales
#  (requieren codificación de inventario McKenna)
# ─────────────────────────────────────────────

_RUTA_PROVEEDORES = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'proveedores_especiales.json'
)

def cargar_proveedores_especiales() -> dict:
    """
    Carga la lista de proveedores que requieren codificación especial de inventario.
    Retorna dict con estructura:
      {
        "proveedores": [
          {"nit": "900123456", "nombre": "PROVEEDOR S.A.S.", "activo": true, "nota": "..."},
          ...
        ]
      }
    Si el archivo no existe, crea uno vacío con comentario de uso.
    """
    if not os.path.exists(_RUTA_PROVEEDORES):
        plantilla = {
            "_instrucciones": (
                "Agrega aquí los NITs de los proveedores que venden MATERIAS PRIMAS "
                "que se deben inventariar en SIIGO con el proceso de codificación McKenna. "
                "Los proveedores NO listados aquí se ignoran en el flujo de importación de productos. "
                "Sus facturas (consumibles, gastos de envío, servicios) se deben registrar "
                "directamente en SIIGO como compra/gasto normal, sin pasar por este módulo."
            ),
            "proveedores": []
        }
        os.makedirs(os.path.dirname(_RUTA_PROVEEDORES), exist_ok=True)
        with open(_RUTA_PROVEEDORES, 'w', encoding='utf-8') as f:
            json.dump(plantilla, f, indent=2, ensure_ascii=False)
        print(f"📋 [IMPORTACIÓN] Creado archivo de proveedores especiales vacío: {_RUTA_PROVEEDORES}")
    try:
        with open(_RUTA_PROVEEDORES, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ [IMPORTACIÓN] Error leyendo proveedores especiales: {e}")
        return {"proveedores": []}


def es_proveedor_especial(nit: str, nombre: str = '') -> bool:
    """
    Verifica si un proveedor debe procesarse con codificación especial de inventario.
    Compara por NIT (exacto) o por nombre (parcial, case-insensitive).
    Si la lista está vacía, acepta TODOS los proveedores (comportamiento por defecto
    hasta que se configure la lista).
    """
    data = cargar_proveedores_especiales()
    proveedores = [p for p in data.get('proveedores', []) if p.get('activo', True)]

    # Lista vacía → proveedor desconocido: siempre preguntar al operador
    if not proveedores:
        return False

    nit_limpio = re.sub(r'\D', '', nit or '')
    nombre_up  = (nombre or '').upper().strip()

    for p in proveedores:
        nit_p = re.sub(r'\D', '', p.get('nit', ''))
        if nit_limpio and nit_p and nit_limpio == nit_p:
            return True
        nombre_p = p.get('nombre', '').upper().strip()
        if nombre_up and nombre_p and (nombre_p in nombre_up or nombre_up in nombre_p):
            return True
    return False


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
#  Generación del XML de compra para SIIGO
# ─────────────────────────────────────────────

def generar_xml_compra_siigo(datos: dict, productos: list, numero_factura: str) -> str:
    """
    Genera el archivo XML de compra para importar en SIIGO mediante
    "Crear compra o gasto desde un XML o ZIP".

    El XML reemplaza los códigos del proveedor por los códigos internos
    McKenna-SIIGO y las cantidades por los valores en unidad mínima.

    Nomenclatura obligatoria: [Número de Factura] codigos siigo.xml

    Retorna la ruta del archivo generado.
    """
    fecha_hoy = datetime.now().strftime('%Y-%m-%d')
    fecha_factura = datos.get('fecha', fecha_hoy)
    nit_proveedor  = datos.get('nit_proveedor', '')
    nombre_prov    = datos.get('proveedor', '')
    moneda         = datos.get('moneda', 'COP')

    # ── Construir árbol XML ──────────────────────────────────────
    root = ET.Element('RegistroCompra')
    root.set('xmlns:mckg', 'https://mckennagroup.co/siigo-import/v1')
    root.set('generadoPor', 'Agente Hugo Garcia - McKenna Group S.A.S.')
    root.set('fecha_generacion', fecha_hoy)

    # Aviso separación de flujos
    aviso = ET.SubElement(root, 'Aviso')
    aviso.text = (
        'FLUJO DE REGISTRO DE COMPRA — Independiente del flujo de facturación de venta. '
        'Este XML es para registrar la compra del proveedor en SIIGO con códigos internos McKenna. '
        'NO confundir con las facturas de venta a clientes (módulo siigo.py).'
    )

    # Cabecera
    cab = ET.SubElement(root, 'Cabecera')
    ET.SubElement(cab, 'NumeroFacturaProveedor').text = numero_factura
    ET.SubElement(cab, 'FechaFactura').text           = str(fecha_factura)
    ET.SubElement(cab, 'Moneda').text                 = moneda

    prov = ET.SubElement(cab, 'Proveedor')
    ET.SubElement(prov, 'NIT').text    = nit_proveedor
    ET.SubElement(prov, 'Nombre').text = nombre_prov

    # Detalle de ítems con códigos McKenna
    detalle = ET.SubElement(root, 'Detalle')
    detalle.set('totalItems', str(len(productos)))

    subtotal_global = 0.0
    iva_global      = 0.0

    for idx, p in enumerate(productos, 1):
        item = ET.SubElement(detalle, 'Item')
        item.set('numero', str(idx))

        ET.SubElement(item, 'CodigoSiigo').text = p['codigo']

        desc_orig = ET.SubElement(item, 'DescripcionOriginalProveedor')
        desc_orig.text = p['nombre']

        unidad = ET.SubElement(item, 'Unidad')
        unidad_orig = ET.SubElement(unidad, 'CantidadOriginal')
        unidad_orig.text = str(p['cantidad_original'])
        unidad_orig.set('codigoDIAN', p['unidad_original'])

        unidad_conv = ET.SubElement(unidad, 'CantidadConvertida')
        unidad_conv.text = str(round(p['cantidad_min'], 6))
        unidad_conv.set('codigoDIAN', p['codigo_dian_min'])
        unidad_conv.set('simbolo',    p['unidad_min'])

        conv_info = ET.SubElement(unidad, 'ReglaConversion')
        factor_str = str(
            CONVERSION_UNIDADES.get(p['unidad_original'].upper(), ('?', '?'))[1]
        )
        conv_info.text = (
            f"1 {p['unidad_original']} = {factor_str} {p['unidad_min']} "
            f"| {p['cantidad_original']} × {factor_str} = {round(p['cantidad_min'], 6)} {p['unidad_min']}"
        )

        precios = ET.SubElement(item, 'Precios')
        precios.set('moneda', moneda)
        ET.SubElement(precios, 'Subtotal').text         = f"{p['subtotal']:.2f}"
        ET.SubElement(precios, 'IVA').text              = f"{p['iva']:.2f}"
        total_item = p['subtotal'] + p['iva']
        ET.SubElement(precios, 'Total').text            = f"{total_item:.2f}"
        ET.SubElement(precios, 'PrecioUnitarioMin').text = f"{p['precio_unitario']:.4f}"
        pu_desc = ET.SubElement(precios, 'PrecioUnitarioMinDesc')
        pu_desc.text = (
            f"Precio por 1 {p['unidad_min']} "
            f"(total {total_item:.2f} COP / {round(p['cantidad_min'], 2)} {p['unidad_min']})"
        )

        if p.get('duplicado'):
            ET.SubElement(item, 'EstadoSiigo').text = 'DUPLICADO - Ya existe en SIIGO, revisar antes de importar'
        else:
            ET.SubElement(item, 'EstadoSiigo').text = 'NUEVO'

        subtotal_global += p['subtotal']
        iva_global      += p['iva']

    # Totales globales
    totales = ET.SubElement(root, 'Totales')
    totales.set('moneda', moneda)
    ET.SubElement(totales, 'Subtotal').text   = f"{subtotal_global:.2f}"
    ET.SubElement(totales, 'TotalIVA').text   = f"{iva_global:.2f}"
    ET.SubElement(totales, 'TotalGeneral').text = f"{subtotal_global + iva_global:.2f}"
    ET.SubElement(totales, 'Verificacion').text = (
        'IMPORTANTE: Confirmar que el TotalGeneral coincide con el total '
        'de la factura física del proveedor antes de asentar en SIIGO.'
    )

    # Protocolo de carga en SIIGO
    protocolo = ET.SubElement(root, 'ProtocoloRegistroSIIGO')
    pasos = [
        ('Paso1', 'Ingresar a SIIGO Nube → módulo Compras o Contabilidad.'),
        ('Paso2', 'Hacer clic en el botón: "Crear compra o gasto desde un XML o ZIP".'),
        ('Paso3', f'Cargar el archivo: {numero_factura} codigos siigo.xml'),
        ('Paso4', 'Verificar que el TotalGeneral en SIIGO coincide con el total de la factura original del proveedor.'),
        ('Paso5', 'Si los valores son correctos, asentar el documento para registrar la compra.'),
        ('Paso6', (
            'NOTA: Este proceso registra la COMPRA de inventario. '
            'Es independiente del proceso de facturación de VENTA a clientes. '
            'No mezclar estos dos flujos.'
        )),
    ]
    for tag, texto in pasos:
        ET.SubElement(protocolo, tag).text = texto

    # ── Serializar con indentación ──────────────────────────────
    _indentar_xml(root)

    nombre_archivo = f"{numero_factura} codigos siigo.xml"
    ruta = os.path.join(CARPETA_IMPORTACIONES, nombre_archivo)

    tree = ET.ElementTree(root)
    with open(ruta, 'wb') as f:
        tree.write(f, encoding='utf-8', xml_declaration=True)

    print(f"📄 [IMPORTACIÓN] XML compra SIIGO generado: {ruta}")
    return ruta


def _indentar_xml(elem, nivel=0):
    """Agrega sangría al árbol XML para que sea legible."""
    sangria = '\n' + '  ' * nivel
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = sangria + '  '
        if not elem.tail or not elem.tail.strip():
            elem.tail = sangria
        for hijo in elem:
            _indentar_xml(hijo, nivel + 1)
        if not hijo.tail or not hijo.tail.strip():
            hijo.tail = sangria
    else:
        if nivel and (not elem.tail or not elem.tail.strip()):
            elem.tail = sangria
    if not nivel:
        elem.tail = '\n'


# ─────────────────────────────────────────────
#  Cola de aprobación (facturas pendientes)
# ─────────────────────────────────────────────

import base64

_RUTA_PENDIENTES = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'facturas_compra_pendientes.json'
)


def _sufijo_factura(numero_factura: str) -> str:
    """Últimos 4 caracteres alfanuméricos del número de factura (para comando corto)."""
    alnum = re.sub(r'\W', '', numero_factura)
    return alnum[-4:].upper() if len(alnum) >= 4 else alnum.upper()


def _cargar_pendientes() -> dict:
    try:
        if os.path.exists(_RUTA_PENDIENTES):
            with open(_RUTA_PENDIENTES, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {"pendientes": {}}


def _guardar_pendientes(data: dict):
    os.makedirs(os.path.dirname(_RUTA_PENDIENTES), exist_ok=True)
    with open(_RUTA_PENDIENTES, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _encolar_factura(numero_factura: str, datos: dict, xml_content: str,
                     es_nuevo_proveedor: bool) -> str:
    """
    Guarda la factura en la cola de pendientes para aprobación por WhatsApp.
    Retorna el sufijo (código corto) asignado.
    """
    sufijo = _sufijo_factura(numero_factura)
    total = sum(
        item.get('subtotal', 0) + sum(
            imp.get('valor', 0) for imp in item.get('impuestos', [])
        )
        for item in datos.get('items', [])
    )
    state = _cargar_pendientes()
    state['pendientes'][sufijo] = {
        'numero_factura':     numero_factura,
        'proveedor':          datos.get('proveedor', ''),
        'nit':                datos.get('nit_proveedor', ''),
        'es_nuevo_proveedor': es_nuevo_proveedor,
        'items_count':        len(datos.get('items', [])),
        'total':              round(total, 2),
        'estado':             'esperando_clasificacion' if es_nuevo_proveedor else 'esperando_confirmacion',
        'xml_b64':            base64.b64encode(xml_content.encode('utf-8')).decode('ascii'),
        'datos_json':         json.dumps(datos, ensure_ascii=False, default=str),
        'timestamp':          datetime.now().isoformat(),
    }
    _guardar_pendientes(state)
    return sufijo


def _buscar_pendiente(sufijo: str):
    """Retorna (key, entrada) o (None, None) si no hay coincidencia."""
    state = _cargar_pendientes()
    sufijo_up = sufijo.strip().upper()
    if sufijo_up in state['pendientes']:
        return sufijo_up, state['pendientes'][sufijo_up]
    # Búsqueda parcial: el sufijo que el usuario escribió coincide con el final de la clave
    for k, v in state['pendientes'].items():
        if k.endswith(sufijo_up) or sufijo_up.endswith(k):
            return k, v
    return None, None


def _quitar_pendiente(sufijo: str):
    state = _cargar_pendientes()
    state['pendientes'].pop(sufijo, None)
    _guardar_pendientes(state)


# ─────────────────────────────────────────────
#  Motor de procesamiento (interno)
# ─────────────────────────────────────────────

def _ejecutar_procesamiento(numero_factura: str, datos: dict, xml_content: str) -> dict:
    """
    Extrae productos, genera Excel + XML y envía por WhatsApp.
    Retorna un dict con los archivos generados y el resumen.
    """
    proveedor = datos.get('proveedor', '')
    productos_nuevos = []
    productos_duplicados = []

    for item in datos.get('items', []):
        nombre = item.get('description', '').strip()
        subtotal = item.get('subtotal', 0)
        cantidad_original = item.get('quantity', 1)

        iva_linea = sum(
            imp['valor'] for imp in item.get('impuestos', [])
            if imp.get('id_dian') == '01'
        )
        unit_code = _extraer_unit_code_de_xml(xml_content, nombre)
        cantidad_min, unidad_min, codigo_dian_min = convertir_a_unidad_minima(
            cantidad_original, unit_code
        )
        precio_unitario = calcular_precio_unitario_min(subtotal, iva_linea, cantidad_min)
        codigo      = generar_codigo_producto(nombre, unidad_min)
        es_duplicado = verificar_producto_en_siigo(codigo)

        producto = {
            'nombre':           nombre,
            'codigo':           codigo,
            'cantidad_original': cantidad_original,
            'unidad_original':  unit_code,
            'cantidad_min':     cantidad_min,
            'unidad_min':       unidad_min,
            'codigo_dian_min':  codigo_dian_min,
            'subtotal':         subtotal,
            'iva':              iva_linea,
            'precio_unitario':  precio_unitario,
            'duplicado':        es_duplicado,
        }
        if es_duplicado:
            productos_duplicados.append(producto)
            print(f"  ⚠️ DUPLICADO: {codigo} — {nombre[:40]}")
        else:
            productos_nuevos.append(producto)
            print(f"  ✅ Nuevo: {codigo} — {nombre[:40]} → ${precio_unitario:.2f}/{unidad_min}")

    todos = productos_nuevos + productos_duplicados
    if not todos:
        print(f"  ℹ️ Sin ítems procesables en {numero_factura}.")
        return {}

    ruta_excel = generar_excel_importacion(todos, numero_factura)
    ruta_xml   = generar_xml_compra_siigo(datos, todos, numero_factura)

    arch = {
        'ruta':           ruta_excel,
        'ruta_xml':       ruta_xml,
        'numero_factura': numero_factura,
        'proveedor':      proveedor,
        'nuevos':         len(productos_nuevos),
        'duplicados':     len(productos_duplicados),
    }

    enviar_whatsapp_reporte(_construir_resumen_whatsapp(arch), numero_destino=GRUPO_COMPRAS)
    enviar_whatsapp_archivo(
        arch['ruta'],
        f"📊 *Excel productos SIIGO* — Factura {numero_factura}",
        numero_destino=GRUPO_COMPRAS,
    )
    if ruta_xml and os.path.exists(ruta_xml):
        enviar_whatsapp_archivo(
            ruta_xml,
            (
                f"📄 *XML de compra SIIGO* — Factura {numero_factura}\n"
                f"Usa: Compras → *Crear compra o gasto desde un XML o ZIP*"
            ),
            numero_destino=GRUPO_COMPRAS,
        )
    return arch


# ─────────────────────────────────────────────
#  Notificación de la siguiente factura en cola
# ─────────────────────────────────────────────

def _notificar_siguiente_factura_pendiente():
    """
    Envía al grupo la notificación de la primera factura pendiente en la cola.
    Se llama después de encolar nuevas facturas o tras procesar una existente,
    para mantener el flujo de una factura a la vez.
    """
    state = _cargar_pendientes()
    pendientes = state.get('pendientes', {})
    if not pendientes:
        return

    # Tomar la primera entrada (orden de inserción, Python 3.7+)
    sufijo, entrada = next(iter(pendientes.items()))
    numero_factura = entrada['numero_factura']
    proveedor      = entrada['proveedor']
    nit            = entrada.get('nit', '')
    n_items        = entrada.get('items_count', 0)
    total          = entrada.get('total', 0)
    es_nuevo       = entrada.get('es_nuevo_proveedor', False)

    if es_nuevo:
        msg = (
            f"📦 *FACTURA DE COMPRA DETECTADA*\n\n"
            f"🔢 *Factura:* {numero_factura}  _(código: *{sufijo}*)_\n"
            f"🏢 *Proveedor:* {proveedor}\n"
            f"🆔 *NIT:* {nit or '—'}\n"
            f"📦 *Ítems:* {n_items}  |  💰 *Total:* ${total:,.0f} COP\n\n"
            f"⚠️ *Proveedor NO registrado* en la lista de materias primas.\n\n"
            f"¿Esta factura corresponde a?\n\n"
            f"   *inv inventario {sufijo}*\n"
            f"   → Materias primas · se inventaría en SIIGO\n\n"
            f"   *inv gasto {sufijo}*\n"
            f"   → Consumibles/gastos · registrar directo en SIIGO"
        )
    else:
        msg = (
            f"📦 *FACTURA DE COMPRA — PROVEEDOR ESPECIAL*\n\n"
            f"🔢 *Factura:* {numero_factura}  _(código: *{sufijo}*)_\n"
            f"🏢 *Proveedor:* {proveedor}\n"
            f"📦 *Ítems:* {n_items}  |  💰 *Total:* ${total:,.0f} COP\n\n"
            f"✅ Proveedor registrado como proveedor de materias primas.\n\n"
            f"¿Proceder con la codificación e importación?\n\n"
            f"   *inv ok {sufijo}* → Sí, procesar\n"
            f"   *inv skip {sufijo}* → No, omitir"
        )

    # Separador visual antes de la siguiente factura
    pendientes_restantes = len(pendientes)
    if pendientes_restantes > 1:
        cabecera = f"─────────────────────────\n⏭️ *Siguiente factura en cola ({pendientes_restantes - 1} más después):*\n\n"
        msg = cabecera + msg

    enviar_whatsapp_reporte(msg, numero_destino=GRUPO_COMPRAS)
    print(f"  ✉️  Notificación enviada al grupo — código: {sufijo}")


# ─────────────────────────────────────────────
#  Orquestador principal — fase 1: escaneo
# ─────────────────────────────────────────────

def procesar_facturas_para_importar_productos(dias: int = 30) -> str:
    """
    Fase 1: Lee facturas del correo y las encola para aprobación manual por WhatsApp.
    Para cada factura detectada envía un mensaje al grupo preguntando si es
    materia prima (inventariar) o gasto/consumible — sin procesar nada aún.

    La fase 2 (procesamiento real) ocurre cuando el operador responde con:
      inv ok <código>          → proveedor conocido, procesar
      inv skip <código>        → omitir esta factura
      inv inventario <código>  → proveedor nuevo, tratar como materia prima
      inv gasto <código>       → proveedor nuevo, tratar como gasto/consumible
    """
    print(f"\n🚀 [IMPORTACIÓN] Escaneando facturas de proveedor en Gmail...")

    correos = leer_correos_no_descargados()
    if not correos:
        return "No se encontraron facturas nuevas en el correo (label: FACTURAS MCKG)."

    service  = get_gmail_service()
    encoladas = []

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
            proveedor      = datos.get('proveedor', '')
            nit            = datos.get('nit_proveedor', '')
            n_items        = len(datos.get('items', []))
            total          = round(sum(
                item.get('subtotal', 0) + sum(
                    imp.get('valor', 0) for imp in item.get('impuestos', [])
                )
                for item in datos.get('items', [])
            ), 2)
            print(f"  📄 Factura: {numero_factura} | Proveedor: {proveedor} | NIT: {nit}")

            es_nuevo = not es_proveedor_especial(nit, proveedor)
            sufijo   = _encolar_factura(numero_factura, datos, xml_content, es_nuevo)

            if es_nuevo:
                msg = (
                    f"📦 *FACTURA DE COMPRA DETECTADA*\n\n"
                    f"🔢 *Factura:* {numero_factura}  _(código: *{sufijo}*)_\n"
                    f"🏢 *Proveedor:* {proveedor}\n"
                    f"🆔 *NIT:* {nit or '—'}\n"
                    f"📦 *Ítems:* {n_items}  |  💰 *Total:* ${total:,.0f} COP\n\n"
                    f"⚠️ *Proveedor NO registrado* en la lista de materias primas.\n\n"
                    f"¿Esta factura corresponde a?\n\n"
                    f"   *inv inventario {sufijo}*\n"
                    f"   → Materias primas · se inventaría en SIIGO\n\n"
                    f"   *inv gasto {sufijo}*\n"
                    f"   → Consumibles/gastos · registrar directo en SIIGO"
                )
            else:
                msg = (
                    f"📦 *FACTURA DE COMPRA — PROVEEDOR ESPECIAL*\n\n"
                    f"🔢 *Factura:* {numero_factura}  _(código: *{sufijo}*)_\n"
                    f"🏢 *Proveedor:* {proveedor}\n"
                    f"📦 *Ítems:* {n_items}  |  💰 *Total:* ${total:,.0f} COP\n\n"
                    f"✅ Proveedor registrado como proveedor de materias primas.\n\n"
                    f"¿Proceder con la codificación e importación?\n\n"
                    f"   *inv ok {sufijo}* → Sí, procesar\n"
                    f"   *inv skip {sufijo}* → No, omitir"
                )

            encoladas.append(f"⏳ {numero_factura} ({proveedor}) — código: {sufijo}")
            print(f"  📥 Factura encolada — código: {sufijo}")

    if not encoladas:
        return "Se leyeron correos pero no se encontraron XML DIAN válidos."

    # Enviar notificación solo de la primera factura pendiente (procesamiento uno a uno)
    _notificar_siguiente_factura_pendiente()

    return (
        f"✅ {len(encoladas)} factura(s) encoladas. Se notificó la primera al grupo.\n"
        + "\n".join(encoladas)
    )


# ─────────────────────────────────────────────
#  Orquestador principal — fase 2: respuesta
# ─────────────────────────────────────────────

def procesar_respuesta_factura_compra(comando: str, sufijo: str) -> str:
    """
    Fase 2: Procesa la respuesta del operador a una factura pendiente.

    Comandos válidos (llegan desde el grupo de contabilidad):
      ok          → proveedor ya registrado, procesar factura
      skip        → omitir esta factura (no procesar)
      inventario  → proveedor nuevo, clasificar como materia prima + procesar
                    (se agrega automáticamente a proveedores_especiales.json)
      gasto       → proveedor nuevo, clasificar como gasto/consumible (no procesar)
    """
    key, entrada = _buscar_pendiente(sufijo)
    if not entrada:
        return f"⚠️ No encontré factura pendiente con código *{sufijo}*.\nUsa *inv lista* para ver las pendientes."

    numero_factura = entrada['numero_factura']
    proveedor      = entrada['proveedor']
    nit            = entrada['nit']
    cmd = comando.strip().lower()

    # ── Omitir / Gasto ───────────────────────────────────────────
    if cmd == 'skip':
        _quitar_pendiente(key)
        threading.Timer(4, _notificar_siguiente_factura_pendiente).start()
        return f"⏭️ Factura *{numero_factura}* omitida. No se registró nada en SIIGO."

    if cmd == 'gasto':
        datos = json.loads(entrada['datos_json'])
        total = entrada.get('total', 0)
        n_items = entrada.get('items_count', 0)

        enviar_whatsapp_reporte(
            f"⚙️ Registrando factura *{numero_factura}* ({proveedor}) en SIIGO…",
            numero_destino=GRUPO_COMPRAS,
        )

        from app.services.siigo import crear_factura_compra_siigo
        payload_siigo = {
            "document": {"id": 24446},
            "date": datos.get("fecha", datetime.now().strftime("%Y-%m-%d")),
            "supplier": {"identification": datos.get("nit", "999999999"), "branch_office": 0},
            "provider_invoice": {
                "prefix": datos.get("prefix", ""),
                "number": datos.get("number", "0")
            },
            "items": [
                {
                    "type": "Service",
                    "code": "GASTO-GEN",
                    "description": it.get("description", "Gasto")[:100],
                    "quantity": it.get("quantity", 1),
                    "price": it.get("price", 0),
                    "taxes": []
                }
                for it in datos.get("items", [])
            ],
            "payments": [{"id": 5636, "value": datos.get("total_neto", total)}],
            "observations": f"Gasto/consumible — {numero_factura} — {proveedor}"
        }

        resultado = crear_factura_compra_siigo(payload_siigo)

        _quitar_pendiente(key)
        threading.Timer(4, _notificar_siguiente_factura_pendiente).start()

        if resultado.get("status") == "success":
            siigo_id = resultado.get("data", {}).get("id", "—")
            return (
                f"✅ *Factura {numero_factura} registrada en SIIGO*\n"
                f"🏢 Proveedor: {proveedor}\n"
                f"📦 {n_items} ítem(s)  |  💰 Total: ${total:,.0f} COP\n"
                f"🆔 ID SIIGO: {siigo_id}"
            )
        else:
            error = resultado.get("message", str(resultado))
            return (
                f"❌ *Error al registrar {numero_factura} en SIIGO*\n"
                f"🏢 Proveedor: {proveedor}\n"
                f"⚠️ Error: {error[:200]}\n\n"
                f"Registra manualmente: SIIGO → Compras → Nueva compra o gasto"
            )

    # ── Inventario (proveedor nuevo) ─────────────────────────────
    if cmd == 'inventario':
        # Agregar automáticamente a la lista de proveedores especiales
        data_prov = cargar_proveedores_especiales()
        nit_limpio = re.sub(r'\D', '', nit or '')
        ya_existe = any(
            re.sub(r'\D', '', p.get('nit', '')) == nit_limpio
            for p in data_prov.get('proveedores', [])
            if nit_limpio
        )
        if not ya_existe:
            data_prov['proveedores'].append({
                'nit':    nit,
                'nombre': proveedor,
                'activo': True,
                'nota':   f'Agregado automáticamente el {datetime.now().strftime("%Y-%m-%d")} vía WhatsApp',
            })
            with open(_RUTA_PROVEEDORES, 'w', encoding='utf-8') as f:
                json.dump(data_prov, f, indent=2, ensure_ascii=False)
            print(f"📋 [IMPORTACIÓN] Proveedor agregado a lista especial: {proveedor} ({nit})")

    # ── Procesar (ok o inventario) ───────────────────────────────
    if cmd in ('ok', 'inventario'):
        xml_content = base64.b64decode(entrada['xml_b64']).decode('utf-8')
        datos       = json.loads(entrada['datos_json'])

        _quitar_pendiente(key)

        nota_prov = (
            f"\n✅ *{proveedor}* agregado a la lista de proveedores especiales."
            if cmd == 'inventario' and not ya_existe
            else ""
        ) if cmd == 'inventario' else ""

        enviar_whatsapp_reporte(
            f"⚙️ Procesando factura *{numero_factura}* ({proveedor})…\n"
            f"Generando códigos McKenna, Excel y XML de compra SIIGO.{nota_prov}",
            numero_destino=GRUPO_COMPRAS,
        )

        arch = _ejecutar_procesamiento(numero_factura, datos, xml_content)
        if not arch:
            threading.Timer(4, _notificar_siguiente_factura_pendiente).start()
            return f"⚠️ Factura *{numero_factura}*: no se encontraron ítems procesables."

        # Notificar la siguiente factura en cola (si existe) con pausa
        threading.Timer(4, _notificar_siguiente_factura_pendiente).start()

        return (
            f"✅ *Factura {numero_factura} procesada*\n"
            f"🏢 {proveedor}\n"
            f"📦 Nuevos: {arch['nuevos']} | Duplicados: {arch['duplicados']}\n"
            f"📎 Excel + XML enviados al grupo."
        )

    return f"⚠️ Comando no reconocido: *{comando}*. Usa: inv ok / inv skip / inv inventario / inv gasto"


def listar_facturas_pendientes() -> str:
    """Retorna un resumen de las facturas en cola de aprobación."""
    state = _cargar_pendientes()
    pendientes = state.get('pendientes', {})
    if not pendientes:
        return "✅ No hay facturas de compra pendientes de clasificación."
    lineas = ["📋 *Facturas pendientes de clasificación:*\n"]
    for sufijo, e in pendientes.items():
        estado = "❓ nuevo proveedor" if e.get('es_nuevo_proveedor') else "✅ proveedor conocido"
        lineas.append(
            f"  • *{sufijo}* — {e['numero_factura']} | {e['proveedor']} | "
            f"{e['items_count']} ítems | ${e['total']:,.0f} COP | {estado}"
        )
    return "\n".join(lineas)


def _construir_resumen_whatsapp(arch: dict) -> str:
    xml_nombre  = os.path.basename(arch.get('ruta_xml', '')) or '—'
    excel_nombre = os.path.basename(arch.get('ruta', '')) or '—'
    return (
        f"📦 *FLUJO DE COMPRA — Registro de Inventario SIIGO*\n"
        f"_(Independiente del flujo de facturación de venta a clientes)_\n\n"
        f"🔢 *Factura proveedor:* {arch['numero_factura']}\n"
        f"🏢 *Proveedor:* {arch['proveedor']}\n\n"
        f"✅ *Productos nuevos:* {arch['nuevos']}\n"
        f"⚠️ *Ya en SIIGO (duplicados):* {arch['duplicados']}\n\n"
        f"📎 *Archivos generados:*\n"
        f"   • Excel: `{excel_nombre}`\n"
        f"   • XML:   `{xml_nombre}`\n\n"
        f"📋 *Protocolo de carga en SIIGO:*\n"
        f"\n"
        f"   *— Paso A: Registrar los productos (Excel) —*\n"
        f"   1. SIIGO → Inventario → Productos\n"
        f"   2. Clic en ▶ *Importación*\n"
        f"   3. Selecciona el Excel adjunto\n"
        f"   4. Verifica la vista previa y confirma\n"
        f"   _(Omitir si todos son duplicados)_\n\n"
        f"   *— Paso B: Registrar la compra (XML) —*\n"
        f"   1. SIIGO → Compras\n"
        f"   2. Clic en ▶ *Crear compra o gasto desde un XML o ZIP*\n"
        f"   3. Carga el archivo XML adjunto\n"
        f"   4. Verifica que el total coincide con la factura del proveedor\n"
        f"   5. Asienta el documento\n\n"
        f"⚠️ *Nota:* Si hay duplicados, revísalos antes de importar el Excel."
    )


if __name__ == "__main__":
    resultado = procesar_facturas_para_importar_productos()
    print(f"\n{resultado}")
