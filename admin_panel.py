from flask import Flask, request, jsonify, render_template_string
import subprocess
import os
import re

app = Flask(__name__)
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')

ADMIN_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>Admin · McKenna Group</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117; color: #e6edf3;
      font-family: 'SF Mono', monospace;
      height: 100dvh; display: flex; flex-direction: column;
    }
    header {
      padding: 12px 16px; background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex; align-items: center; gap: 10px;
    }
    .badge {
      background: #238636; color: #fff;
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
    }
    #terminal {
      flex: 1; overflow-y: auto; padding: 16px;
      font-size: 13px; line-height: 1.6;
    }
    .line-out  { color: #e6edf3; }
    .line-err  { color: #f85149; }
    .line-info { color: #58a6ff; }
    .line-cmd  { color: #3fb950; }
    #input-row {
      display: flex; gap: 8px; padding: 10px 16px;
      background: #161b22; border-top: 1px solid #30363d;
    }
    #cmd-input {
      flex: 1; background: #1c2128; border: 1px solid #30363d;
      border-radius: 8px; padding: 10px 14px; color: #e6edf3;
      font-family: 'SF Mono', monospace; font-size: 14px;
      outline: none;
    }
    #cmd-input:focus { border-color: #58a6ff; }
    #run-btn {
      background: #238636; border: none; color: #fff;
      border-radius: 8px; padding: 10px 16px; cursor: pointer;
      font-size: 14px;
    }
    #auth-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.85);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    #auth-box {
      background: #161b22; border: 1px solid #30363d;
      border-radius: 12px; padding: 28px; width: 320px;
      display: flex; flex-direction: column; gap: 14px;
    }
    #auth-box h2 { font-size: 16px; }
    #auth-box input {
      background: #1c2128; border: 1px solid #30363d;
      border-radius: 8px; padding: 10px 14px; color: #e6edf3;
      font-family: monospace; font-size: 13px; outline: none; width: 100%;
    }
    #auth-box button {
      background: #238636; border: none; color: #fff;
      border-radius: 8px; padding: 11px; cursor: pointer; font-size: 14px;
    }
    #auth-error { color: #f85149; font-size: 12px; min-height: 16px; }
    .quick-cmds {
      display: flex; gap: 6px; padding: 8px 16px;
      background: #161b22; overflow-x: auto; flex-shrink: 0;
      scrollbar-width: none;
    }
    .quick-cmds::-webkit-scrollbar { display: none; }
    .qc-btn {
      flex-shrink: 0; background: #1c2128; border: 1px solid #30363d;
      border-radius: 14px; color: #e6edf3; font-size: 11px;
      padding: 4px 10px; cursor: pointer; white-space: nowrap;
      font-family: monospace;
    }
    .qc-btn:hover { background: #30363d; }
    .mode-btn {
      background: #1c2128; border: 1px solid #30363d;
      border-radius: 8px; color: #8b949e; padding: 5px 12px;
      font-size: 12px; cursor: pointer; font-family: monospace;
    }
    .mode-btn.active { background: #238636; color: #fff; border-color: #238636; }
  </style>
</head>
<body>

<div id="auth-overlay">
  <div id="auth-box">
    <h2>🔐 Panel Administrador</h2>
    <p style="font-size:12px;color:#8b949e">Acceso exclusivo para administradores</p>
    <input id="auth-input" type="password" placeholder="Token de administrador..." />
    <div id="auth-error"></div>
    <button id="auth-btn">Ingresar</button>
  </div>
</div>

<header>
  <span style="font-size:15px;font-weight:600">⚡ Admin Panel</span>
  <span class="badge">McKenna Group</span>
  <div id="mode-toggle" style="display:flex;gap:4px;margin-left:auto;">
    <button id="btn-terminal" class="mode-btn active" onclick="setMode('terminal')">💻 Terminal</button>
    <button id="btn-claude" class="mode-btn" onclick="setMode('claude')">🤖 Claude</button>
  </div>
  <span style="font-size:11px;color:#8b949e;margin-left:8px;" id="cwd"></span>
</header>

<div class="quick-cmds">
  <button class="qc-btn" onclick="runCmd('sudo systemctl status webhook-meli agente-pro whatsapp-bridge --no-pager')">📊 Status</button>
  <button class="qc-btn" onclick="runCmd('sudo systemctl restart webhook-meli agente-pro')">🔄 Restart</button>
  <button class="qc-btn" onclick="runCmd('sudo journalctl -u webhook-meli -n 20 --no-pager')">📋 Logs Webhook</button>
  <button class="qc-btn" onclick="runCmd('sudo journalctl -u agente-pro -n 20 --no-pager')">📋 Logs Agente</button>
  <button class="qc-btn" onclick="runCmd('git status')">🔍 Git Status</button>
  <button class="qc-btn" onclick="runCmd('git add -A && git commit -m \\"Auto: cambios del panel admin\\" && git push origin master:main')">📤 Git Push</button>
  <button class="qc-btn" onclick="runCmd('ps aux | grep python3 | grep -v grep')">🐍 Procesos</button>
  <button class="qc-btn" onclick="runCmd('sudo lsof -i :8080 -i :8081 -i :3000')">🔌 Puertos</button>
</div>

<div id="terminal">
  <div class="line-info">Sistema listo. Escribe comandos o usa los botones rápidos.</div>
</div>

<div id="input-row">
  <input id="cmd-input" placeholder="$ comando bash..." autocomplete="off" />
  <button id="run-btn">▶</button>
</div>

<script>
const ADMIN_TOKEN_KEY = 'mckg_admin_token';
let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
const terminal = document.getElementById('terminal');
const cmdInput = document.getElementById('cmd-input');

let currentMode = 'terminal';
let claudeHistory = [];

function setMode(mode) {
  currentMode = mode;
  document.getElementById('btn-terminal').classList.toggle('active', mode === 'terminal');
  document.getElementById('btn-claude').classList.toggle('active', mode === 'claude');
  cmdInput.placeholder = mode === 'terminal'
    ? '$ comando bash...'
    : '💬 Escribe en español qué necesitas...';
  cmdInput.focus();
}

function addLine(text, cls) {
  text.split('\\n').forEach(line => {
    if (!line.trim()) return;
    const div = document.createElement('div');
    div.className = 'line-' + cls;
    div.textContent = line;
    terminal.appendChild(div);
  });
  terminal.scrollTop = terminal.scrollHeight;
}

function runCmd(cmd) {
  if (!cmd) cmd = cmdInput.value.trim();
  if (!cmd) return;
  cmdInput.value = '';
  addLine('$ ' + cmd, 'cmd');

  fetch('/admin/exec', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminToken
    },
    body: JSON.stringify({ cmd })
  })
  .then(r => r.json())
  .then(data => {
    if (data.stdout) addLine(data.stdout, 'out');
    if (data.stderr) addLine(data.stderr, 'err');
    if (data.error)  addLine(data.error, 'err');
    if (data.cwd) document.getElementById('cwd').textContent = data.cwd;
  })
  .catch(() => addLine('Error de conexión', 'err'));
}

async function runClaude(texto) {
  if (!texto) texto = cmdInput.value.trim();
  if (!texto) return;
  cmdInput.value = '';

  addLine('👤 ' + texto, 'cmd');
  const procesandoDiv = document.createElement('div');
  procesandoDiv.className = 'line-info';
  procesandoDiv.textContent = '🤖 Procesando...';
  terminal.appendChild(procesandoDiv);
  terminal.scrollTop = terminal.scrollHeight;

  claudeHistory.push({role: 'user', content: texto});

  try {
    const res = await fetch('/admin/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + adminToken
      },
      body: JSON.stringify({
        mensaje: texto,
        historial: claudeHistory.slice(-10)
      })
    });

    const data = await res.json();
    procesandoDiv.remove();

    if (data.error) {
      addLine('❌ ' + data.error, 'err');
      return;
    }

    if (data.respuesta) {
      // Mostrar respuesta sin las etiquetas <cmd>
      const textoLimpio = data.respuesta.replace(/<cmd>[^]*?<\/cmd>/g, '').trim();
      if (textoLimpio) addLine('🤖 ' + textoLimpio, 'info');
      claudeHistory.push({role: 'assistant', content: data.respuesta});
    }

    // Ejecutar comandos sugeridos
    if (data.comandos && data.comandos.length > 0) {
      for (const cmd of data.comandos) {
        addLine('⚡ Ejecutando: ' + cmd, 'cmd');
        const execRes = await fetch('/admin/exec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminToken
          },
          body: JSON.stringify({ cmd })
        });
        const execData = await execRes.json();
        if (execData.stdout) addLine(execData.stdout, 'out');
        if (execData.stderr) addLine(execData.stderr, 'err');
        if (execData.error)  addLine(execData.error, 'err');
      }
    }

  } catch(e) {
    procesandoDiv.remove();
    addLine('Error conectando con Claude: ' + e.message, 'err');
  }
}

function handleSubmit() {
  const val = cmdInput.value.trim();
  if (!val) return;
  if (currentMode === 'claude') {
    runClaude(val);
  } else {
    runCmd(val);
  }
}

cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleSubmit();
});
document.getElementById('run-btn').addEventListener('click', handleSubmit);

// Auth
function checkAuth() {
  if (adminToken) {
    document.getElementById('auth-overlay').style.display = 'none';
    cmdInput.focus();
    runCmd('echo "✅ Conectado como administrador" && pwd');
  }
}

document.getElementById('auth-btn').addEventListener('click', async () => {
  const val = document.getElementById('auth-input').value.trim();
  if (!val) return;
  const res = await fetch('/admin/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + val },
    body: JSON.stringify({ cmd: 'echo ok' })
  });
  if (res.status === 401) {
    document.getElementById('auth-error').textContent = 'Token incorrecto';
  } else {
    adminToken = val;
    localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
    document.getElementById('auth-overlay').style.display = 'none';
    cmdInput.focus();
    runCmd('echo "✅ Acceso concedido" && pwd');
  }
});

document.getElementById('auth-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('auth-btn').click();
});

checkAuth();
</script>
</body>
</html>
"""

SYSTEM_PROMPT_BASE = """Eres un asistente DevOps experto para McKenna Group S.A.S.
El servidor es Ubuntu 24, Python/Flask en /home/mckg/mi-agente.
- Número WhatsApp empresa: 573222554354
- Grupo contabilidad: 120363407538342427@g.us
- Productos: materias primas farmacéuticas
- Transportadora: Interrapidísimo únicamente
- Facturación: SIIGO ERP
- Inventario: Google Sheets
- Agente: Hugo García, español colombiano
- Comandos grupo: ok confirmado {numero}, pausar {numero}, activar {numero}, resp {numero}: {mensaje}
Servicios activos: webhook-meli (8080), agente-pro (8081), whatsapp-bridge (3000), admin-panel (8082).
Cloudflare tunnel apunta a bot.mckennagroup.co.

Cuando el usuario pida algo en lenguaje natural:
1. Explica brevemente qué vas a hacer
2. Incluye los comandos a ejecutar entre etiquetas <cmd>comando</cmd>
3. Si son varios comandos secuenciales, un <cmd> por línea
4. Si es solo información o explicación, responde sin <cmd>
5. Para usar CHAT_API_TOKEN en curl, usa: export CHAT_API_TOKEN=valor antes del curl, no source .env

Ejemplos:
Usuario: 'reinicia el webhook'
Respuesta: 'Voy a reiniciar el servicio webhook-meli.
<cmd>sudo systemctl restart webhook-meli</cmd>
<cmd>sudo systemctl status webhook-meli --no-pager</cmd>'

Usuario: 'muéstrame los últimos errores'
Respuesta: 'Revisando los logs de errores recientes.
<cmd>sudo journalctl -u webhook-meli -n 30 --no-pager | grep -i error</cmd>'

Usuario: 'cuánta memoria está usando el sistema'
Respuesta: 'Verificando el uso de memoria.
<cmd>free -h</cmd>
<cmd>ps aux --sort=-%mem | head -10</cmd>'"""


def run_context_cmd(cmd):
    """Ejecuta un comando de contexto y retorna su stdout (truncado a 3000 chars)."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=10, cwd='/home/mckg/mi-agente'
        )
        output = result.stdout.strip() or result.stderr.strip() or '(sin output)'
        return output[:3000]
    except Exception as e:
        return f'(error: {e})'


def build_system_prompt():
    """Construye el system prompt con contexto en vivo del sistema."""
    claude_md = run_context_cmd("cat /home/mckg/mi-agente/CLAUDE.md")
    chat_token = run_context_cmd("grep CHAT_API_TOKEN /home/mckg/mi-agente/.env | cut -d= -f2")
    endpoints = run_context_cmd(
        "grep -A1 '@app.route' /home/mckg/mi-agente/webhook_meli.py | grep 'def\\|route' 2>/dev/null || echo '(webhook_meli.py no encontrado)'"
    )

    contexto = f"""=== CONTEXTO DEL SISTEMA ===
CLAUDE.md:
{claude_md}

CHAT_API_TOKEN: {chat_token}

ENDPOINTS DISPONIBLES:
{endpoints}
=== FIN CONTEXTO ===

"""
    return contexto + SYSTEM_PROMPT_BASE


@app.route('/admin')
def admin():
    return render_template_string(ADMIN_HTML)


@app.route('/admin/exec', methods=['POST'])
def exec_cmd():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if token != ADMIN_TOKEN:
        return jsonify({'error': 'No autorizado'}), 401

    data = request.get_json()
    cmd = data.get('cmd', '').strip()
    if not cmd:
        return jsonify({'error': 'Comando vacío'}), 400

    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=60, cwd='/home/mckg/mi-agente'
        )
        return jsonify({
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode,
            'cwd': '/home/mckg/mi-agente'
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Comando tardó más de 60 segundos'})
    except Exception as e:
        return jsonify({'error': str(e)})


@app.route('/admin/claude', methods=['POST'])
def claude_cmd():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if token != ADMIN_TOKEN:
        return jsonify({'error': 'No autorizado'}), 401

    data = request.get_json()
    mensaje = data.get('mensaje', '')
    historial = data.get('historial', [])

    api_key = os.getenv('ANTHROPIC_API_KEY', '')
    if not api_key:
        return jsonify({'error': 'ANTHROPIC_API_KEY no configurada en .env'}), 500

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        messages = historial + [{"role": "user", "content": mensaje}]
        system_prompt = build_system_prompt()

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            system=system_prompt,
            messages=messages
        )

        respuesta = response.content[0].text
        comandos = [c.strip() for c in re.findall(r'<cmd>(.*?)</cmd>', respuesta, re.DOTALL)]

        return jsonify({
            'respuesta': respuesta,
            'comandos': comandos
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8082, debug=False)
