#!/usr/bin/env python3
"""
Instala el tema McKenna Group en WordPress via wp-admin upload.
Empaqueta el tema en ZIP y lo sube al endpoint de WordPress admin.

Uso:
    python3 instalar_tema_wp.py

Requiere:
    pip install requests python-dotenv
"""

import os
import io
import sys
import zipfile
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

WP_URL    = os.getenv('WC_URL', 'https://mckennagroup.co')
WP_USER   = os.getenv('WP_USER', 'Administrador')
WP_PASS   = os.getenv('WP_APP_PASSWORD', '')
THEME_DIR = Path(__file__).parent / 'mckennagroup-theme'
THEME_ZIP = Path(__file__).parent / 'mckennagroup-theme.zip'
UA        = {'User-Agent': 'McKennaAgent/1.0'}

AUTH      = (WP_USER, WP_PASS)


def empaquetar_tema() -> bytes:
    """Crea el ZIP del tema en memoria y lo guarda en disco."""
    print('📦 Empaquetando tema...')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(THEME_DIR.rglob('*')):
            if file_path.is_file():
                arcname = 'mckennagroup-theme/' + str(file_path.relative_to(THEME_DIR))
                zf.write(file_path, arcname)
                print(f'   + {arcname}')
    data = buf.getvalue()

    # Guardar copia en disco
    THEME_ZIP.write_bytes(data)
    print(f'   ✅ ZIP creado: {THEME_ZIP} ({len(data):,} bytes)\n')
    return data


def obtener_nonce(session: requests.Session) -> str | None:
    """Obtiene el nonce de WordPress para la subida de temas."""
    # Intentar via REST API primero
    r = session.get(
        f'{WP_URL}/wp-json/wp/v2/settings',
        auth=AUTH, headers=UA, timeout=10
    )
    if r.status_code == 200:
        # WP REST nonce
        nonce_r = session.get(
            f'{WP_URL}/wp-admin/admin-ajax.php?action=rest-nonce',
            auth=AUTH, headers=UA, timeout=10
        )
        if nonce_r.status_code == 200:
            return nonce_r.text.strip()

    # Fallback: obtener nonce de la página de temas
    r2 = session.get(
        f'{WP_URL}/wp-admin/theme-install.php',
        auth=AUTH, headers={**UA, 'Accept': 'text/html'}, timeout=15
    )
    if r2.status_code == 200:
        import re
        m = re.search(r'_wpnonce["\']?\s*[:=]\s*["\']([a-f0-9]+)["\']', r2.text)
        if m:
            return m.group(1)
    return None


def instalar_via_rest(zip_data: bytes) -> bool:
    """Intenta instalar via endpoint WP REST API (puede estar bloqueado por ModSecurity)."""
    print('🔌 Intentando instalación via REST API...')
    r = requests.post(
        f'{WP_URL}/wp-json/wp/v2/themes',
        auth=AUTH,
        headers={**UA, 'Content-Disposition': 'attachment; filename="mckennagroup-theme.zip"'},
        data=zip_data,
        timeout=60
    )
    print(f'   Status: {r.status_code}')
    if r.status_code in (200, 201):
        print('   ✅ Tema instalado via REST API')
        return True
    print(f'   ❌ REST falló: {r.text[:300]}')
    return False


def instalar_via_admin(session: requests.Session, zip_data: bytes) -> bool:
    """Sube el tema via wp-admin/update.php (método tradicional)."""
    print('🔑 Intentando instalación via wp-admin...')

    # Obtener página de subida para extraer nonce
    r = session.get(
        f'{WP_URL}/wp-admin/theme-install.php?browse=upload',
        auth=AUTH,
        headers={**UA, 'Accept': 'text/html'},
        timeout=15
    )
    print(f'   Página subida: {r.status_code}')

    nonce = None
    if r.status_code == 200:
        import re
        # Buscar nonce en el formulario de subida
        patterns = [
            r'name="_wpnonce"\s+value="([a-f0-9]+)"',
            r'"_wpnonce":"([a-f0-9]+)"',
            r'install_theme_information.*?_wpnonce.*?"([a-f0-9]+)"',
        ]
        for pat in patterns:
            m = re.search(pat, r.text)
            if m:
                nonce = m.group(1)
                print(f'   Nonce encontrado: {nonce[:8]}...')
                break

    # Hacer POST al endpoint de instalación
    files = {'themezip': ('mckennagroup-theme.zip', zip_data, 'application/zip')}
    data  = {'action': 'upload-theme'}
    if nonce:
        data['_wpnonce'] = nonce

    r2 = session.post(
        f'{WP_URL}/wp-admin/update.php?action=upload-theme',
        auth=AUTH,
        headers=UA,
        files=files,
        data=data,
        timeout=60,
        allow_redirects=True
    )
    print(f'   Status upload: {r2.status_code}')

    if r2.status_code == 200 and ('mckennagroup' in r2.text.lower() or 'instalado' in r2.text.lower() or 'installed' in r2.text.lower()):
        print('   ✅ Tema instalado via wp-admin')
        return True

    if r2.status_code in (301, 302):
        print(f'   Redirect a: {r2.headers.get("Location", "?")}')

    print(f'   Respuesta: {r2.text[:500]}')
    return False


def activar_tema(session: requests.Session, theme_slug: str = 'mckennagroup-theme') -> bool:
    """Activa el tema recién instalado."""
    print(f'\n🎨 Activando tema "{theme_slug}"...')

    # Intentar via REST API
    r = requests.post(
        f'{WP_URL}/wp-json/wp/v2/themes/{theme_slug}',
        auth=AUTH,
        headers=UA,
        json={'status': 'active'},
        timeout=20
    )
    print(f'   REST activar: {r.status_code}')
    if r.status_code in (200, 201):
        print(f'   ✅ Tema activado via REST')
        return True

    # Fallback: wp-admin
    r2 = session.get(
        f'{WP_URL}/wp-admin/themes.php?action=activate&stylesheet={theme_slug}',
        auth=AUTH, headers=UA, timeout=20, allow_redirects=True
    )
    print(f'   Admin activar: {r2.status_code}')
    if r2.status_code == 200:
        print('   ✅ Tema activado via wp-admin')
        return True

    return False


def crear_categorias_wc(session: requests.Session):
    """Crea categorías de productos estándar para materias primas."""
    print('\n📂 Verificando categorías WooCommerce...')

    CATEGORIAS = [
        {'name': 'Ácidos', 'description': 'Ácidos orgánicos e inorgánicos para formulación cosmética y farmacéutica'},
        {'name': 'Bases y Alcalis', 'description': 'Bases y compuestos alcalinos para formulación'},
        {'name': 'Emulsificantes', 'description': 'Agentes emulsificantes y estabilizantes'},
        {'name': 'Conservantes', 'description': 'Conservantes para formulaciones cosméticas y farmacéuticas'},
        {'name': 'Humectantes', 'description': 'Agentes humectantes y activos hidratantes'},
        {'name': 'Espesantes', 'description': 'Agentes espesantes y gelificantes'},
        {'name': 'Tensoactivos', 'description': 'Surfactantes y agentes limpiadores'},
        {'name': 'Activos Cosméticos', 'description': 'Ingredientes activos para formulación cosmética'},
        {'name': 'Pigmentos y Colorantes', 'description': 'Pigmentos, óxidos y colorantes'},
        {'name': 'Aceites y Ceras', 'description': 'Aceites vegetales, ceras y emolientes'},
        {'name': 'Excipientes Farmacéuticos', 'description': 'Excipientes para formas farmacéuticas sólidas y líquidas'},
        {'name': 'Polímeros', 'description': 'Polímeros y derivados celulósicos'},
        {'name': 'Minerales', 'description': 'Minerales y sales inorgánicas'},
        {'name': 'Antioxidantes', 'description': 'Antioxidantes y vitaminas'},
        {'name': 'Fragancias y Aromas', 'description': 'Fragancias, aceites esenciales y aromas'},
    ]

    auth_basic = (WP_USER, WP_PASS)
    wc_key    = os.getenv('WC_KEY', '')
    wc_secret = os.getenv('WC_SECRET', '')

    creadas = 0
    for cat in CATEGORIAS:
        r = requests.get(
            f'{WP_URL}/wp-json/wc/v3/products/categories',
            auth=(wc_key, wc_secret),
            params={'search': cat['name'], 'per_page': 5},
            headers=UA, timeout=10
        )
        if r.status_code == 200:
            existing = [c for c in r.json() if c['name'].lower() == cat['name'].lower()]
            if existing:
                print(f'   ✓ Ya existe: {cat["name"]}')
                continue

        r2 = requests.post(
            f'{WP_URL}/wp-json/wc/v3/products/categories',
            auth=(wc_key, wc_secret),
            json=cat,
            headers=UA, timeout=10
        )
        if r2.status_code in (200, 201):
            print(f'   ✅ Creada: {cat["name"]} (ID: {r2.json().get("id")})')
            creadas += 1
        else:
            print(f'   ⚠️ Error creando {cat["name"]}: {r2.status_code}')

    print(f'\n   Total categorías nuevas: {creadas}')


def main():
    if not WP_PASS:
        print('❌ WP_APP_PASSWORD no configurado en .env')
        sys.exit(1)

    print('🚀 INSTALACIÓN TEMA McKENNA GROUP\n')
    print(f'   WordPress: {WP_URL}')
    print(f'   Usuario:   {WP_USER}')
    print()

    # 1. Empaquetar tema
    zip_data = empaquetar_tema()

    session = requests.Session()

    # 2. Intentar instalación
    installed = False

    # Método 1: REST API
    installed = instalar_via_rest(zip_data)

    # Método 2: wp-admin (si REST falló)
    if not installed:
        installed = instalar_via_admin(session, zip_data)

    if installed:
        # 3. Activar tema
        activar_tema(session)
    else:
        print('\n⚠️  La instalación automática no pudo completarse.')
        print('   Opciones manuales:')
        print(f'   1. Subir el ZIP manualmente:')
        print(f'      {THEME_ZIP}')
        print(f'   2. Ir a: {WP_URL}/wp-admin/theme-install.php')
        print(f'      → "Subir tema" → seleccionar el ZIP')
        print(f'   3. Via FTP: subir la carpeta mckennagroup-theme/ a')
        print(f'      /public_html/wp-content/themes/')

    # 4. Crear categorías WC (independiente del tema)
    try:
        crear_categorias_wc(session)
    except Exception as e:
        print(f'\n⚠️ Error creando categorías: {e}')

    print('\n✅ Proceso completado.')
    if THEME_ZIP.exists():
        print(f'📁 ZIP de respaldo: {THEME_ZIP}')


if __name__ == '__main__':
    main()
