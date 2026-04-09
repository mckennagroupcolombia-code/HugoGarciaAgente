with open('app/routes.py', 'r') as f:
    routes_code = f.read()

with open('meli_logic_temp.py', 'r') as f:
    meli_logic = f.read()

with open('meli_route_temp.py', 'r') as f:
    meli_route = f.read()

# Remove the @app.route decorator and def notifications(): and indent
meli_route_lines = meli_route.split('\n')
indented_route = []
for line in meli_route_lines:
    indented_route.append('    ' + line)
route_str = '\n'.join(indented_route)

# Inject meli_logic before def register_routes(app):
parts = routes_code.split('def register_routes(app):')

new_code = parts[0] + "\n# --- Lógica de MercadoLibre (Migrada de webhook_meli.py) ---\n" + \
           "import time\n" + \
           "from preventa_meli import procesar_nueva_pregunta\n" + \
           "from app.utils import refrescar_token_meli\n\n" + \
           meli_logic + "\n\n" + \
           "def register_routes(app):\n" + route_str + "\n" + parts[1]

with open('app/routes.py', 'w') as f:
    f.write(new_code)
print("Patch 2 applied.")
