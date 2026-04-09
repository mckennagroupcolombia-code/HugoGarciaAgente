import re

with open('app/monitor.py', 'r') as f:
    monitor_code = f.read()

with open('monitor_meli_temp.py', 'r') as f:
    monitor_logic = f.read()

# remove the threading.Thread part at the end of monitor_logic
monitor_logic = monitor_logic.replace("threading.Thread(target=_monitor_preguntas_sin_responder, daemon=True).start()", "")

# We will replace verificar_preguntas_meli with _monitor_preguntas_sin_responder
# But wait, monitor_logic has its own while loop!
# It says:
# def _monitor_preguntas_sin_responder():
#     while True:
#         time.sleep(INTERVALO)
#
# So it is a blocking loop! It shouldn't be called every 30 minutes from monitor_loop,
# it should be started once as a separate thread in iniciar_monitor().

if 'def iniciar_monitor():' in monitor_code:
    parts = monitor_code.split('def iniciar_monitor():')
    # add monitor_logic before it
    new_code = parts[0] + "\n# --- Monitor avanzado de preventa MeLi (Migrado) ---\n" + \
               "from preventa_meli import procesar_nueva_pregunta\n" + \
               "import requests\n" + \
               monitor_logic + "\n" + \
               "def iniciar_monitor():\n" + \
               "    threading.Thread(target=_monitor_preguntas_sin_responder, daemon=True, name='monitor-preventa-meli').start()\n" + \
               parts[1]
    
    with open('app/monitor.py', 'w') as f:
        f.write(new_code)
    print("Monitor patched.")
else:
    print("iniciar_monitor not found")
