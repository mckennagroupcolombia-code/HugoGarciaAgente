import re

with open('app/routes.py', 'r') as f:
    routes_code = f.read()

with open('meli_logic_temp.py', 'r') as f:
    meli_logic = f.read()

with open('meli_route_temp.py', 'r') as f:
    meli_route = f.read()

# Remove the @app.route decorator and def notifications(): and indent
meli_route_lines = meli_route.split('\n')
indented_route = []
in_route = False
for line in meli_route_lines:
    if line.startswith('@app.route'):
        in_route = True
        indented_route.append('    ' + line)
    elif in_route:
        indented_route.append('    ' + line)

# Let's just fix it manually.
route_str = '\n'.join(indented_route)

# Inject meli_logic before def register_routes(app):
if 'def register_routes(app):' in routes_code:
    # also add imports needed: time, requests, threading are mostly there, we will add time and threading at top if not there
    # actually time is imported later.
    
    parts = routes_code.split('def register_routes(app):')
    
    new_code = parts[0] + "\n# --- Lógica de MercadoLibre (Migrada de webhook_meli.py) ---\n" + \
               "import time\n" + \
               "from preventa_meli import procesar_nueva_pregunta\n" + \
               "from app.utils import refrescar_token_meli\n\n" + \
               meli_logic + "\n\n" + \
               "def register_routes(app):\n" + parts[1]
               
    # inject route right after def register_routes(app):
    parts2 = new_code.split('def register_routes(app):')
    new_code2 = parts2[0] + "def register_routes(app):\n" + route_str + "\n" + parts2[1]
    
    with open('app/routes.py', 'w') as f:
        f.write(new_code2)
        
    print("Patch applied.")
else:
    print("Could not find register_routes.")
