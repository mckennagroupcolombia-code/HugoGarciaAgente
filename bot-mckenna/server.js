const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
// Raíz del repo (.env compartido con Flask) + .env local del bot
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const app = express();
app.use(express.json());

// Comprobantes: raíz del repo (un nivel arriba de bot-mckenna/) o variable de entorno
const DIR_COMPROBANTES = process.env.COMPROBANTES_DIR
    ? path.resolve(process.env.COMPROBANTES_DIR)
    : path.join(__dirname, '..', 'comprobantes');

// ==========================================
// MONITOR — Buffer circular de actividad
// ==========================================
const MAX_LOG = 200;
const activityLog = [];

function logActividad(tipo, datos) {
    const entrada = {
        ts: new Date().toISOString(),
        tipo,   // 'ENTRANTE' | 'SALIENTE' | 'COMANDO' | 'ERROR' | 'SISTEMA'
        ...datos
    };
    activityLog.unshift(entrada);
    if (activityLog.length > MAX_LOG) activityLog.pop();
}

// ==========================================
// 1. LIMPIEZA DE CANDADOS CHROMIUM (anti "browser is already running")
// ==========================================
// Puppeteer usa `.wwebjs_auth_nueva/session` como userDataDir. Si el proceso anterior
// murió sin cerrar, o hay otro node usando el mismo perfil, quedan Singleton* / DevToolsActivePort.
function limpiarCandadosSesionWhatsapp() {
    const sessionDir = path.join(__dirname, '.wwebjs_auth_nueva', 'session');
    if (!fs.existsSync(sessionDir)) return;

    const basura = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];
    for (const name of basura) {
        const p = path.join(sessionDir, name);
        try {
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                console.log(`🧹 Eliminado candado de sesión: ${name}`);
            }
        } catch (e) {
            console.error(`❌ No se pudo eliminar ${name}:`, e.message);
        }
    }
}

limpiarCandadosSesionWhatsapp();

// ==========================================
// 2. CONFIGURACIÓN DEL CLIENTE
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth_nueva' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

let sistemaListo = false;

// --- EVENTOS DE CONEXIÓN ---
client.on('qr', qr => {
    console.log('📱 QR DETECTADO: Escanee para iniciar sesión.');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp conectado.');
    console.log('⏳ Esperando 15 segundos para estabilidad...');
    logActividad('SISTEMA', { texto: 'WhatsApp conectado. Esperando estabilidad...' });

    setTimeout(() => {
        sistemaListo = true;
        console.log('🚀 SISTEMA TOTALMENTE LISTO - Escuchando mensajes y API');
        logActividad('SISTEMA', { texto: 'Sistema listo. Escuchando mensajes.' });
    }, 15000);
});

client.on('auth_failure', msg => {
    console.error('❌ Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
    sistemaListo = false;
    console.warn('⚠️ WhatsApp desconectado:', reason);
    logActividad('SISTEMA', { texto: `Desconectado: ${reason || 'sin detalle'}. Reiniciar el bridge si no reconecta solo.` });
});

// ==========================================
// 3. ESCUCHADOR DE MENSAJES ENTRANTES (IA)
// ==========================================

// Systemd inyecta EnvironmentFile con comentarios inline incluidos en el valor.
// Esta función los elimina: "120363...@g.us # comentario" → "120363...@g.us"
function envLimpio(nombre, fallback) {
    const val = process.env[nombre];
    if (!val) return fallback;
    return val.split('#')[0].trim();
}

const GRUPO_CONTABILIDAD = envLimpio('GRUPO_CONTABILIDAD_WA', '120363407538342427@g.us');
const GRUPO_COMPRAS      = envLimpio('GRUPO_FACTURACION_COMPRAS_WA', '120363408323873426@g.us');
/** Pedidos web: notificaciones + facturar/envio — solo este JID (Guias_Envios pagina web). */
const GRUPO_PEDIDOS_WEB  = envLimpio('GRUPO_PEDIDOS_WEB_WA', '120363391665421264@g.us');
const GRUPOS_ADMIN       = [GRUPO_CONTABILIDAD, GRUPO_COMPRAS];
/** Contabilidad/compras + grupo exclusivo pedidos web. No mezclar otros grupos aquí. */
const GRUPOS_COMANDO     = [...GRUPOS_ADMIN, GRUPO_PEDIDOS_WEB];

// Función compartida: procesar comandos de grupos admin
async function procesarComandoGrupo(msg) {
    const texto = msg.body.toLowerCase().trim();
    const esComando = (
        texto.includes('ok confirmado') ||
        texto === 'ok' ||
        texto.startsWith('ok ') ||
        texto.startsWith('no ') ||
        texto.includes('pausar') ||
        texto.includes('activar') ||
        texto.startsWith('resp ') ||
        texto.includes('hugo dale ok') ||
        texto.startsWith('inv ') ||
        texto.startsWith('posventa ') ||
        texto.startsWith('facturar') ||
        texto.startsWith('envio ')
    );
    if (!esComando) return;

    console.log(`📨 Comando del grupo (fromMe=${msg.fromMe}): ${msg.body}`);
    logActividad('COMANDO', { de: msg.from, fromMe: msg.fromMe, texto: msg.body });
    try {
        await axios.post('http://localhost:8081/whatsapp', {
            sender: msg.from,
            remoteJid: msg.from,
            mensaje: msg.body,
            es_grupo_contabilidad: GRUPOS_ADMIN.includes(msg.from),
            hasMedia: false
        });
    } catch (error) {
        console.error("❌ Error enviando comando al agente:", error.message);
        logActividad('ERROR', { texto: `Comando al agente: ${error.message}` });
    }
}

// message_create captura mensajes enviados desde el propio número (fromMe=true).
// En grupos, msg.from es el chat del grupo y msg.author es el remitente.
client.on('message_create', async (msg) => {
    if (!sistemaListo) return;
    if (!msg.fromMe) return;
    const chatId = msg.from || (msg.id && msg.id.remote);
    if (!GRUPOS_COMANDO.includes(chatId)) return;
    await procesarComandoGrupo(msg);
});

client.on('message', async (msg) => {
    if (!sistemaListo) return;

    // Filtro 1: ignorar estados y broadcasts
    if (msg.from === 'status@broadcast') return;
    if (msg.type === 'e2e_notification') return;
    if (msg.type === 'notification_template') return;
    if (msg.type === 'call_log') return;

    // Filtro 2: ignorar mensajes del propio agente a clientes
    if (msg.fromMe && !GRUPOS_COMANDO.includes(msg.from)) return;

    // Filtro 3: ignorar grupos que no sean de admin
    if (msg.from.includes('@g.us') && !GRUPOS_COMANDO.includes(msg.from)) {
        console.log(`👥 GRUPO DESCONOCIDO [${msg.from}]: ${msg.body || '[media]'}`);
        logActividad('SISTEMA', {
            de: msg.from,
            texto: `[Grupo no está en GRUPOS_COMANDO] ${msg.body || '[media]'}`,
        });
        return;
    }

    // Filtro 4: ignorar mensajes vacíos o sin texto
    if (!msg.body || msg.body.trim() === '') {
        if (!msg.hasMedia) return;
    }

    // Filtro 5: ignorar mensajes muy antiguos (más de 60 segundos)
    const ahora = Math.floor(Date.now() / 1000);
    if (ahora - msg.timestamp > 60) {
        console.log(`⏭️ Mensaje antiguo ignorado de ${msg.from}`);
        return;
    }

    // Filtro 6: ignorar tipos de mensaje no relevantes
    const tiposIgnorados = [
        'revoked',
        'sticker',
        'reaction',
        'poll_creation',
        'order',
        'product',
        'broadcast',
    ];
    if (tiposIgnorados.includes(msg.type)) return;

    console.log(`📩 Procesando mensaje - De: ${msg.from} | Tipo: ${msg.type} | fromMe: ${msg.fromMe}`);
    logActividad('ENTRANTE', { de: msg.from, tipo: msg.type, texto: msg.body || '[media]', hasMedia: msg.hasMedia });

    const esGrupoComando = GRUPOS_COMANDO.includes(msg.from);

    // Grupos de comando (contabilidad, compras, pedidos web) — solo comandos
    if (esGrupoComando) {
        await procesarComandoGrupo(msg);
        return;
    }

    // Mensajes de clientes — solo chats individuales
    try {
        let hasMedia = false;
        let mediaPath = '';
        let mediaType = '';

        if (msg.hasMedia) {
            hasMedia = true;
            const media = await msg.downloadMedia();
            if (media) {
                let extension = 'bin';
                if (media.mimetype.includes('image/')) {
                    mediaType = 'image';
                    extension = media.mimetype.split('/')[1].split(';')[0];
                } else if (media.mimetype.includes('application/pdf')) {
                    mediaType = 'document';
                    extension = 'pdf';
                }

                if (mediaType === 'image') {
                    const timestamp = Date.now();
                    const numero = msg.from.split('@')[0];
                    if (!fs.existsSync(DIR_COMPROBANTES)) {
                        fs.mkdirSync(DIR_COMPROBANTES, { recursive: true });
                    }
                    mediaPath = path.join(DIR_COMPROBANTES, `${numero}_${timestamp}.${extension}`);
                    fs.writeFileSync(mediaPath, media.data, 'base64');
                    console.log(`📁 Archivo multimedia guardado en: ${mediaPath}`);
                }
            }
        }

        const responseIA = await axios.post('http://localhost:8081/whatsapp', {
            sender: msg.from,
            mensaje: msg.body,
            hasMedia: hasMedia,
            mediaPath: mediaPath,
            mediaType: mediaType,
            es_grupo_contabilidad: false
        });

        if (responseIA.data && responseIA.data.respuesta) {
            await client.sendMessage(msg.from, responseIA.data.respuesta);
            console.log(`📤 Respuesta de IA enviada a ${msg.from}`);
            logActividad('SALIENTE', { para: msg.from, texto: responseIA.data.respuesta });
        }
    } catch (error) {
        console.error("❌ Error de comunicación con el agente Python:", error.message);
        logActividad('ERROR', { texto: `Comunicación con Python: ${error.message}`, de: msg.from });
    }
});

// ==========================================
// 4. API PARA PYTHON (REPORTES MELI)
// ==========================================
app.post('/enviar', async (req, res) => {
    const { numero, mensaje } = req.body;

    try {
        if (!sistemaListo || !client.info || !client.info.wid) {
             return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }

        const chatId = numero.includes('@') ? numero : (numero.length > 15 ? `${numero}@g.us` : `${numero}@c.us`);

        await client.sendMessage(chatId, mensaje);
        console.log(`📤 Reporte enviado a: ${chatId}`);
        logActividad('SALIENTE', { para: chatId, texto: mensaje, origen: 'API /enviar' });
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("❌ Error de envío API:", error.message);
        res.status(500).json({ status: "error", error: error.message });
    }
});

// Endpoint para enviar archivos (PDF, imágenes, etc.)
app.post('/enviar-archivo', async (req, res) => {
    const { numero, mensaje, filePath, fileName } = req.body;
    try {
        if (!sistemaListo || !client.info || !client.info.wid) {
            return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }
        const { MessageMedia } = require('whatsapp-web.js');
        const chatId = numero.includes('@') ? numero : (numero.length > 15 ? `${numero}@g.us` : `${numero}@c.us`);
        const fileData = fs.readFileSync(filePath);
        const mimeType = filePath.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
        const resolvedName = fileName || path.basename(filePath);
        const media = new MessageMedia(mimeType, fileData.toString('base64'), resolvedName);
        await client.sendMessage(chatId, media, { caption: mensaje || '' });
        console.log(`📎 Archivo enviado a: ${chatId} — ${filePath}`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("❌ Error enviando archivo:", error.message);
        res.status(500).json({ status: "error", error: error.message });
    }
});

client.initialize().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.error('\n❌ Fallo al iniciar WhatsApp (Puppeteer):', msg);
    if (msg.includes('already running') || msg.includes('userDataDir')) {
        console.error(`
→ Suele ser: otro bridge con este MISMO perfil (otro terminal, systemd, o carpeta ~/bot-mckenna).
→ Solución:
    1) Parar duplicados:
       systemctl --user stop bot-mckenna 2>/dev/null || true
       sudo systemctl stop bot-mckenna 2>/dev/null || true
       pgrep -af 'bot-mckenna|server\\.js'
       # Si ves otro node en ~/bot-mckenna o duplicado, mátalo (pkill -f …) con cuidado.
    2) Si no hay otro proceso, candados stale: volver a ejecutar npm start
       (esta versión ya borra SingletonLock/Socket/Cookie/DevToolsActivePort al arrancar).
`);
    }
    process.exit(1);
});

// ==========================================
// ENDPOINT: Listar grupos
// ==========================================
function waSesionOperativa() {
    return !!(client && client.info && client.info.wid);
}

app.get('/grupos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (!waSesionOperativa()) {
        return res.status(503).json({
            error: 'WhatsApp no conectado',
            detalle: 'Sin sesión activa (esperar evento ready / revisar QR). Los mensajes siguen usando el flag de 15s aparte.',
            sistemaListo,
        });
    }
    try {
        const chats = await client.getChats();
        const grupos = chats
            .filter(c => c.isGroup)
            .map(c => ({
                id: c.id._serialized,
                nombre: (c.name && String(c.name).trim()) || '(sin nombre)',
                participantes: c.participants ? c.participants.length : '?',
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        res.json({
            actualizado: new Date().toISOString(),
            total: grupos.length,
            grupos,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// ENDPOINT: Monitor de actividad (HTML)
// ==========================================
app.get('/monitor', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const colores = {
        ENTRANTE: '#1a9e6e',
        SALIENTE: '#2563eb',
        COMANDO:  '#d97706',
        ERROR:    '#dc2626',
        SISTEMA:  '#6b7280',
    };
    const iconos = {
        ENTRANTE: '📩',
        SALIENTE: '📤',
        COMANDO:  '⚡',
        ERROR:    '❌',
        SISTEMA:  '🔧',
    };

    const filas = activityLog.map(e => {
        const color = colores[e.tipo] || '#333';
        const icono = iconos[e.tipo] || '•';
        const hora  = e.ts.replace('T', ' ').substring(0, 19);
        const de    = e.de   ? `<span style="color:#888;font-size:12px">${e.de}</span>` : '';
        const para  = e.para ? `<span style="color:#888;font-size:12px">→ ${e.para}</span>` : '';
        const texto = (e.texto || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<tr>
            <td style="color:#aaa;white-space:nowrap;padding:6px 10px;font-size:12px">${hora}</td>
            <td style="padding:6px 10px"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${icono} ${e.tipo}</span></td>
            <td style="padding:6px 10px;font-size:12px">${de}${para}</td>
            <td style="padding:6px 10px;font-size:13px;max-width:500px;word-break:break-word">${texto}</td>
        </tr>`;
    }).join('');

    const estadoWA = sistemaListo
        ? '<span style="background:#1a9e6e;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px">● Conectado</span>'
        : '<span style="background:#dc2626;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px">● No listo</span>';

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monitor WhatsApp — McKenna Group</title>
<meta http-equiv="refresh" content="5">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0f0f0f;color:#e5e5e5}
  h1{margin:0;font-size:18px;font-weight:700}
  header{background:#141414;border-bottom:2px solid #2E8B7A;padding:16px 24px;display:flex;align-items:center;gap:16px;justify-content:space-between}
  .brand{color:#4DB3A0;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:700}
  table{width:100%;border-collapse:collapse}
  tr:nth-child(even){background:#181818}
  tr:hover{background:#1f1f1f}
  th{background:#1a1a1a;padding:8px 10px;text-align:left;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#666;border-bottom:1px solid #2a2a2a}
  .wrap{padding:16px 24px}
  .meta{font-size:12px;color:#555;margin-bottom:12px}
  a{color:#4DB3A0;text-decoration:none;font-size:13px}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<header>
  <div>
    <div class="brand">McKenna Group</div>
    <h1>Monitor WhatsApp Bridge</h1>
  </div>
  <div style="display:flex;gap:12px;align-items:center">
    ${estadoWA}
    <a href="/grupos" target="_blank" rel="noopener">JSON grupos →</a>
  </div>
</header>
<div class="wrap">
  <div class="meta">Últimas ${activityLog.length} entradas · Recarga automática cada 5s (sin caché) · Grupos: <code>getChats()</code> en cada carga · Puerto 3000</div>
  <table>
    <thead><tr><th>Hora</th><th>Tipo</th><th>Número</th><th>Mensaje</th></tr></thead>
    <tbody>${filas || '<tr><td colspan="4" style="padding:24px;color:#555;text-align:center">Sin actividad registrada aún</td></tr>'}</tbody>
  </table>
  <h2 style="font-size:14px;color:#888;margin:28px 0 8px">Grupos (sesión WhatsApp actual)</h2>
  <p class="meta" id="gmeta" style="margin-top:0">Cargando lista de grupos…</p>
  <table>
    <thead><tr><th>Nombre</th><th>JID</th><th>Miembros</th></tr></thead>
    <tbody id="gtb"><tr><td colspan="3" style="padding:16px;color:#555">…</td></tr></tbody>
  </table>
</div>
<script>
(function(){
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  var gtb=document.getElementById('gtb'), gmeta=document.getElementById('gmeta');
  fetch('/grupos',{cache:'no-store'}).then(function(r){ return r.json().then(function(j){ return {r:r,j:j}; }); }).then(function(x){
    var r=x.r, j=x.j;
    if(!r.ok){
      gtb.innerHTML='<tr><td colspan="3" style="padding:12px;color:#f87171">'+esc(j.error||j.detalle||r.status)+'</td></tr>';
      gmeta.textContent='';
      return;
    }
    gmeta.textContent=(j.actualizado||'')+' · '+j.total+' grupo(s)';
    var rows=(j.grupos||[]).map(function(g){
      return '<tr><td style="padding:8px">'+esc(g.nombre)+'</td><td style="padding:8px"><code style="font-size:11px;word-break:break-all">'+esc(g.id)+'</code></td><td style="padding:8px">'+(g.participantes!=null?esc(g.participantes):'?')+'</td></tr>';
    }).join('');
    gtb.innerHTML=rows||'<tr><td colspan="3" style="padding:12px;color:#555">Ningún grupo en esta sesión</td></tr>';
  }).catch(function(e){
    gtb.innerHTML='<tr><td colspan="3" style="padding:12px;color:#f87171">'+esc(e)+'</td></tr>';
    gmeta.textContent='';
  });
})();
</script>
</body>
</html>`);
});

// ==========================================
// ENDPOINT: JSON de actividad (para integraciones)
// ==========================================
app.get('/monitor/json', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
        actualizado: new Date().toISOString(),
        sistemaListo,
        waSesionOperativa: waSesionOperativa(),
        total: activityLog.length,
        actividad: activityLog,
    });
});

// Escuchamos en el puerto 3000 para no chocar con el 8080 ni el 8081
app.listen(3000, '0.0.0.0', () => {
    console.log('🌐 Servidor Node (Puente) escuchando en puerto 3000');
    logActividad('SISTEMA', { texto: 'Servidor Node iniciado en puerto 3000' });
});
