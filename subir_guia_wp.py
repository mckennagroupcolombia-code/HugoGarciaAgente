"""
Sube guia-kit-acidos.html como página de WordPress via REST API.
Uso: python3 subir_guia_wp.py <wp_usuario> <app_password>
"""
import sys, os, re, requests
from dotenv import load_dotenv

load_dotenv()
WC_URL = os.getenv('WC_URL', 'https://mckennagroup.co')
UA     = {'User-Agent': 'McKennaAgent/1.0', 'Accept': 'application/json'}

HTML_PATH = '/home/mckg/mi-agente/PAGINA_WEB/guia-kit-acidos.html'
PAGE_SLUG  = 'guia-kit-acidos'
PAGE_TITLE = 'Guía de Uso — Kit de Ácidos Profesionales'
PARENT_ID  = 0   # 0 = página de nivel raíz


def subir_pagina(usuario: str, app_password: str):
    auth = (usuario, app_password)

    # 1. ¿Ya existe la página?
    r = requests.get(
        f'{WC_URL}/wp-json/wp/v2/pages?slug={PAGE_SLUG}&per_page=1',
        auth=auth, headers=UA, timeout=10
    )
    if r.status_code != 200:
        print(f'❌ Error consultando WP REST API: {r.status_code} — {r.text[:200]}')
        sys.exit(1)

    pages = r.json()
    page_id = pages[0]['id'] if pages else None

    # 2. Leer el HTML y extraerlo todo (sin envolver en más HTML)
    with open(HTML_PATH, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # 3. Crear o actualizar la página
    payload = {
        'title':   PAGE_TITLE,
        'slug':    PAGE_SLUG,
        'status':  'publish',
        'content': html_content,
        'template': '',   # plantilla en blanco para que no aplique header/footer del theme
    }

    if page_id:
        r2 = requests.post(
            f'{WC_URL}/wp-json/wp/v2/pages/{page_id}',
            auth=auth, headers=UA, json=payload, timeout=30
        )
        accion = 'actualizada'
    else:
        r2 = requests.post(
            f'{WC_URL}/wp-json/wp/v2/pages',
            auth=auth, headers=UA, json=payload, timeout=30
        )
        accion = 'creada'

    if r2.status_code in (200, 201):
        data = r2.json()
        url  = data.get('link', f'{WC_URL}/{PAGE_SLUG}/')
        print(f'✅ Página {accion} correctamente.')
        print(f'🔗 URL pública: {url}')

        # 4. Guardar URL en .env para referencia del agente
        env_path = '/home/mckg/mi-agente/.env'
        with open(env_path, 'r') as ef:
            env_text = ef.read()
        if 'GUIA_KIT_ACIDOS_URL' not in env_text:
            with open(env_path, 'a') as ef:
                ef.write(f'\nGUIA_KIT_ACIDOS_URL={url}\n')
            print(f'📌 URL guardada en .env → GUIA_KIT_ACIDOS_URL')
    else:
        print(f'❌ Error subiendo página: {r2.status_code}')
        print(r2.text[:500])
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Uso: python3 subir_guia_wp.py <wp_usuario> <app_password>')
        print('Ejemplo: python3 subir_guia_wp.py admin "abcd 1234 efgh 5678"')
        sys.exit(1)
    subir_pagina(sys.argv[1], sys.argv[2])
