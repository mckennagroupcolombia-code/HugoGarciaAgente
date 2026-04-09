#!/bin/bash
cd /home/mckg/mi-agente
source venv/bin/activate

# Iniciar webhook_meli (8080)
pgrep -f "webhook_meli.py" > /dev/null || nohup python3 webhook_meli.py > .webhook.log 2>&1 &
echo "webhook_meli.py: $!"

# Iniciar agente_pro (8081)
pgrep -f "agente_pro.py" > /dev/null || nohup python3 agente_pro.py > .agente.log 2>&1 &
echo "agente_pro.py: $!"

# Iniciar website (8083)
pgrep -f "website.py" > /dev/null || nohup python3 PAGINA_WEB/site/website.py > .website.log 2>&1 &
echo "website.py: $!"

echo "Todos los servicios iniciados"
