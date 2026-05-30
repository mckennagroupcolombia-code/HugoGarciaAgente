/**
 * bot-supervisor/server.js
 * Segundo puente WhatsApp — Supervisor y Voz IA
 *
 * Puerto: SUPERVISOR_PORT (default 3001)
 * Sesión: .wwebjs_auth_supervisor/ (independiente del puente principal :3000)
 *
 * Comandos que procesa (mensajes de números autorizados):
 *   "hugo, envia nota de voz a [destino] con: [texto]"  → TTS + PTT
 *   "hugo, envía nota de voz a [destino]: [texto]"       → TTS + PTT
 *   "hugo, manda voz a [destino]: [texto]"               → TTS + PTT
 *   "hugo, di a [destino]: [texto]"                      → TTS + PTT
 *   cualquier otro mensaje                               → chat Gemma4 (supervisor)
 *
 * [destino] puede ser:
 *   - Número con código de país: 573001234567
 *   - Nombre en contactos.json (minúsculas, sin tildes)
 *
 * Variables de entorno relevantes (se leen del .env raíz):
 *   SUPERVISOR_PORT                default 3001
 *   SUPERVISOR_NUMEROS_AUTORIZADOS números separados por coma (solo estos pueden dar comandos)
 *   SUPERVISOR_GEMMA_MODEL         default gemma4:27b
 *   CHAT_API_TOKEN                 Bearer token para Flask /api/*
 *   FLASK_URL                      default http://localhost:8081
 *   WHATSAPP_SUPERVISOR_TOKEN      token interno para endpoints REST de este bridge
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode   = require('qrcode-terminal');
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const { spawn } = require('child_process');

// .env raíz del repo + .env local del bot-supervisor (si existe)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

// ──────────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────────
const PORT         = parseInt(process.env.SUPERVISOR_PORT   || '3001', 10);
const FLASK        = (process.env.FLASK_URL                 || 'http://localhost:8081').replace(/\/$/, '');
const API_TOKEN    = (process.env.CHAT_API_TOKEN            || '').trim();
const GEMMA_MODEL  = (process.env.SUPERVISOR_GEMMA_MODEL    || 'gemma4:27b').trim();
const BRIDGE_TOKEN = (process.env.WHATSAPP_SUPERVISOR_TOKEN || '').trim();

// Números autorizados: cualquier formato, guardamos solo dígitos
function _normalizarNumero(n) {
    return String(n || '').replace(/[^0-9]/g, '');
}
const NUMEROS_AUTORIZADOS = new Set(
    (process.env.SUPERVISOR_NUMEROS_AUTORIZADOS || '')
        .split(',')
        .map(_normalizarNumero)
        .filter(Boolean)
);

function esAutorizado(from) {
    if (NUMEROS_AUTORIZADOS.size === 0) return true;  // sin filtro si no se configura
    const num = (from || '').split('@')[0].replace(/[^0-9]/g, '');
    return NUMEROS_AUTORIZADOS.has(num);
}

// Contactos: nombre → número completo
const CONTACTOS_PATH = path.join(__dirname, 'contactos.json');
function cargarContactos() {
    try {
        if (fs.existsSync(CONTACTOS_PATH)) {
            const raw = JSON.parse(fs.readFileSync(CONTACTOS_PATH, 'utf8'));
            const resultado = {};
            for (const [k, v] of Object.entries(raw)) {
                if (!k.startsWith('_')) resultado[k.toLowerCase()] = String(v);
            }
            return resultado;
        }
    } catch (_) {}
    return {};
}

// ──────────────────────────────────────────────────────────────────────────────
// Registro de actividad en memoria
// ──────────────────────────────────────────────────────────────────────────────
const MAX_LOG    = 100;
const activityLog = [];

function logActividad(tipo, datos) {
    activityLog.unshift({ ts: new Date().toISOString(), tipo, ...datos });
    if (activityLog.length > MAX_LOG) activityLog.pop();
}

// ──────────────────────────────────────────────────────────────────────────────
// Limpieza de candados Chromium (igual que bot-mckenna)
// ──────────────────────────────────────────────────────────────────────────────
function limpiarCandadosSesion() {
    const sessionDir = path.join(__dirname, '.wwebjs_auth_supervisor', 'session');
    if (!fs.existsSync(sessionDir)) return;
    const basura = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];
    for (const name of basura) {
        const p = path.join(sessionDir, name);
        try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`🧹 Candado eliminado: ${name}`); } }
        catch (e) { console.error(`❌ No se pudo eliminar ${name}:`, e.message); }
    }
}
limpiarCandadosSesion();

// ──────────────────────────────────────────────────────────────────────────────
// Cliente WhatsApp — sesión propia .wwebjs_auth_supervisor
// ──────────────────────────────────────────────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth_supervisor' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
});

let sistemaListo   = false;
let ultimoQr       = null;
let ultimoQrTs     = 0;

// Detecta el error Puppeteer "Execution context was destroyed" que ocurre
// mientras WhatsApp Web navega/recarga durante autenticación.
function esErrorContextoPuppeteer(err) {
    const msg = (err && err.message) ? err.message.toLowerCase() : '';
    return msg.includes('execution context was destroyed')
        || msg.includes('navigation')
        || msg.includes('target closed')
        || msg.includes('session closed');
}

async function promoverSistemaListo(origen = 'watchdog') {
    if (sistemaListo || !client.info || !client.info.wid) return false;
    try {
        await client.getChats();
        sistemaListo = true;
        console.log(`🚀 [supervisor] SISTEMA LISTO por ${origen}`);
        logActividad('SISTEMA', { texto: `Sistema listo por ${origen}.` });
        return true;
    } catch (e) {
        if (esErrorContextoPuppeteer(e)) {
            console.warn(`⏳ [supervisor] (${origen}) WhatsApp aún inicializando — contexto Puppeteer no listo`);
        } else {
            console.warn(`⏳ [supervisor] aún no listo (${origen}):`, e.message);
        }
        return false;
    }
}

setInterval(() => promoverSistemaListo('watchdog'), 10000);

client.on('qr', qr => {
    console.log('\n📱 [supervisor] QR — escanea para vincular la cuenta supervisora:');
    qrcode.generate(qr, { small: true });
    ultimoQr   = qr;
    ultimoQrTs = Date.now();
    logActividad('SISTEMA', { texto: 'QR generado.' });
});
client.on('authenticated', () => { ultimoQr = null; ultimoQrTs = 0; logActividad('SISTEMA', { texto: 'Autenticado.' }); });
client.on('ready', () => {
    console.log('✅ [supervisor] WhatsApp conectado. Esperando 15s…');
    setTimeout(() => {
        sistemaListo = true;
        console.log('🚀 [supervisor] LISTO. Escuchando comandos de voz e IA.');
        logActividad('SISTEMA', { texto: 'Listo.' });
    }, 15000);
});
client.on('auth_failure', msg => console.error('❌ [supervisor] Error de autenticación:', msg));
client.on('disconnected', reason => {
    sistemaListo = false;
    console.warn('⚠️ [supervisor] Desconectado:', reason, '— reconectando en 10s…');
    logActividad('SISTEMA', { texto: `Desconectado: ${reason}. Reconectando en 10s…` });
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('❌ [supervisor] Reconexión falló:', err.message);
            process.exit(1);
        });
    }, 10000);
});

// Shutdown limpio
async function _shutdown(signal) {
    console.log(`🛑 [supervisor] ${signal} — cerrando…`);
    sistemaListo = false;
    try { await Promise.race([client.destroy(), new Promise(r => setTimeout(r, 8000))]); }
    catch (_) {}
    process.exit(0);
}
process.on('SIGTERM', () => _shutdown('SIGTERM'));
process.on('SIGINT',  () => _shutdown('SIGINT'));

// ──────────────────────────────────────────────────────────────────────────────
// Parser de comandos de voz
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Intenta parsear un comando de voz.
 * Retorna { destino, texto } o null si no coincide.
 *
 * Patrones soportados (case-insensitive, ignora tildes en verbos):
 *   hugo[,] (envia|envía|manda|di|dile|avísale|recuérdales?) [una] (nota de voz|voz|audio) a [DEST] (con|:) [TEXTO]
 *   hugo[,] (envia|envía|manda) voz a [DEST]: [TEXTO]
 *   hugo[,] nota de voz a [DEST]: [TEXTO]
 */
const RE_VOZ = /^hugo[\s,]+(?:env[ií]a|manda(?:me)?|di(?:le)?|av[ií]sale|recu[eé]rdal[ae]s?)\s+(?:una\s+)?(?:nota\s+de\s+voz|voz|audio)\s+a\s+(.+?)\s*(?:con\s*:?|:)\s*(.+)$/is;
const RE_VOZ_CORTA = /^hugo[\s,]+(?:voz|nota\s+de\s+voz)\s+a\s+(.+?)\s*:\s*(.+)$/is;
const RE_VOZ_DILE  = /^hugo[\s,]+(?:di(?:le)?|av[ií]sale|recu[eé]rdal[ae]s?)\s+a\s+(.+?)\s*(?:que\s+)?(?::)?\s*(.+)$/is;

function parsearComandoVoz(texto) {
    const normalizado = texto.trim().replace(/ /g, ' ').replace(/\s+/g, ' ');
    for (const re of [RE_VOZ, RE_VOZ_CORTA, RE_VOZ_DILE]) {
        const m = normalizado.match(re);
        if (m) {
            return {
                destino: m[1].trim(),
                texto:   m[2].trim(),
            };
        }
    }
    return null;
}

/**
 * Resuelve destino (nombre o número) a chatId de WhatsApp.
 * - Si ya es un número (solo dígitos, ≥7 chars) → number@c.us
 * - Si tiene @ → lo usa directo
 * - Si es nombre → busca en contactos.json
 * Devuelve null si no puede resolver.
 */
function resolverDestino(destino) {
    const limpio = destino.trim();

    if (limpio.includes('@')) return limpio;

    const soloDigitos = limpio.replace(/[^0-9]/g, '');
    if (soloDigitos.length >= 7) {
        return soloDigitos.length > 15
            ? `${soloDigitos}@g.us`
            : `${soloDigitos}@c.us`;
    }

    // Intentar en contactos
    const contactos = cargarContactos();
    const clave = limpio.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');  // quita tildes
    const numero = contactos[clave];
    if (numero) {
        const d = _normalizarNumero(numero);
        return d.length > 15 ? `${d}@g.us` : `${d}@c.us`;
    }

    return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Integraciones con Flask
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Convierte audio en memoria a OGG Opus via ffmpeg (pipe stdin→stdout).
 * WhatsApp solo acepta OGG Opus para notas de voz.
 * Retorna { audioBase64, mimeType } con el audio convertido.
 */
function convertirAOggOpus(audioBase64, mimeTypeOrig) {
    if (mimeTypeOrig && mimeTypeOrig.includes('ogg')) {
        return Promise.resolve({ audioBase64, mimeType: mimeTypeOrig });
    }
    return new Promise((resolve, reject) => {
        const inputBuf = Buffer.from(audioBase64, 'base64');
        const chunks   = [];

        const ff = spawn('ffmpeg', [
            '-y', '-i', 'pipe:0',
            '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
            '-ar', '24000', '-ac', '1',
            '-f', 'ogg', 'pipe:1',
        ]);

        ff.stdout.on('data', (chunk) => chunks.push(chunk));
        ff.stdout.on('end', () => {
            const out = Buffer.concat(chunks);
            if (!out.length) return reject(new Error('ffmpeg no produjo salida'));
            resolve({ audioBase64: out.toString('base64'), mimeType: 'audio/ogg; codecs=opus' });
        });
        ff.on('error', (err) => reject(new Error(`ffmpeg no disponible: ${err.message}`)));
        ff.stderr.on('data', () => {});  // suprimir logs de ffmpeg

        ff.stdin.write(inputBuf);
        ff.stdin.end();
    });
}

/** Llama a /api/voz/sintetizar y retorna { audioBase64, mimeType } o null */
async function sintetizarVoz(texto) {
    if (!API_TOKEN) {
        console.warn('[supervisor] CHAT_API_TOKEN no configurado — no puedo llamar TTS');
        return null;
    }
    try {
        const resp = await axios.post(
            `${FLASK}/api/voz/sintetizar`,
            { texto },
            {
                headers: { Authorization: `Bearer ${API_TOKEN}` },
                responseType: 'arraybuffer',
                timeout: 60000,
            }
        );
        const contentType = resp.headers['content-type'] || 'audio/wav';
        const mimeType    = contentType.split(';')[0].trim();
        const audioBase64 = Buffer.from(resp.data).toString('base64');
        const motor       = resp.headers['x-tts-motor'] || 'desconocido';
        console.log(`🎙️ [supervisor] Audio sintetizado (${motor}, ${resp.data.byteLength} bytes)`);
        return { audioBase64, mimeType };
    } catch (err) {
        const msg = err.response
            ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
            : err.message;
        console.error('[supervisor] Error TTS:', msg);
        return null;
    }
}

/** Llama a /api/chat-panel con Gemma4 y retorna texto de respuesta */
async function chatGemma4(mensaje, sessionId = 'supervisor') {
    if (!API_TOKEN) return '(CHAT_API_TOKEN no configurado)';
    try {
        const resp = await axios.post(
            `${FLASK}/api/chat-panel`,
            { mensaje, modelo_id: GEMMA_MODEL, session_id: sessionId },
            { headers: { Authorization: `Bearer ${API_TOKEN}` }, timeout: 120000 }
        );
        return (resp.data && resp.data.respuesta) || '(sin respuesta)';
    } catch (err) {
        const msg = err.response
            ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
            : err.message;
        console.error('[supervisor] Error Gemma4:', msg);
        return `❌ Error consultando ${GEMMA_MODEL}: ${msg}`;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Manejador de mensajes entrantes
// ──────────────────────────────────────────────────────────────────────────────
client.on('message', async msg => {
    // Solo mensajes de texto o sticker (no media entrante)
    if (!msg.body || msg.hasMedia) return;
    // Ignorar mensajes propios
    if (msg.fromMe) return;

    const from  = msg.from || '';
    const texto = msg.body.trim();

    if (!esAutorizado(from)) {
        console.log(`[supervisor] Número no autorizado: ${from} — ignorando`);
        return;
    }

    logActividad('ENTRANTE', { de: from, texto });
    console.log(`[supervisor] Mensaje de ${from}: ${texto.substring(0, 80)}`);

    // ── ¿Es comando de voz? ───────────────────────────────────────────────────
    const cmdVoz = parsearComandoVoz(texto);
    if (cmdVoz) {
        const { destino: destinoRaw, texto: textoVoz } = cmdVoz;
        const chatIdDestino = resolverDestino(destinoRaw);

        if (!chatIdDestino) {
            await msg.reply(
                `❓ No pude resolver el destino *"${destinoRaw}"*.\n` +
                `• Usa un número con código de país (ej: *573001234567*)\n` +
                `• O agrégalo a *contactos.json* en bot-supervisor/`
            );
            return;
        }

        await msg.reply(`⏳ Generando nota de voz para _${destinoRaw}_…`);

        const audio = await sintetizarVoz(textoVoz);
        if (!audio) {
            await msg.reply('❌ Error al sintetizar el audio. Verifica que el servicio TTS esté activo en /api/voz/status');
            return;
        }

        // WhatsApp requiere OGG Opus para notas de voz
        let audioFinal = audio;
        try {
            audioFinal = await convertirAOggOpus(audio.audioBase64, audio.mimeType);
        } catch (convErr) {
            console.error('[supervisor] Conversión OGG falló:', convErr.message);
            await msg.reply(`❌ No pude convertir el audio: ${convErr.message}`);
            return;
        }

        try {
            if (!sistemaListo && client.info && client.info.wid) {
                await promoverSistemaListo('enviar-ptt');
            }
            if (!sistemaListo) {
                await msg.reply('⏳ WhatsApp aún está sincronizando. Espera ~15 s e intenta de nuevo.');
                return;
            }

            const media = new MessageMedia(audioFinal.mimeType, audioFinal.audioBase64, 'voice.ogg');
            await client.sendMessage(chatIdDestino, media, { sendAudioAsVoice: true });

            await msg.reply(`✅ Nota de voz enviada a *${destinoRaw}* (${chatIdDestino})`);
            logActividad('SALIENTE', { para: chatIdDestino, tipo: 'PTT', texto: textoVoz.substring(0, 60) });
            console.log(`🎙️ [supervisor] PTT enviado a: ${chatIdDestino}`);
        } catch (err) {
            if (esErrorContextoPuppeteer(err)) {
                await msg.reply('⏳ WhatsApp está reconectando. Espera ~15 s e intenta de nuevo.');
            } else {
                console.error('[supervisor] Error enviando PTT:', err.message);
                await msg.reply(`❌ No pude enviar la nota de voz: ${err.message}`);
            }
        }
        return;
    }

    // ── Chat con Gemma4 (supervisor IA) ────────────────────────────────────────
    const sessionId = `supervisor-${_normalizarNumero(from)}`;
    try {
        const respuesta = await chatGemma4(texto, sessionId);
        await msg.reply(respuesta);
        logActividad('IA', { de: from, modelo: GEMMA_MODEL, chars: respuesta.length });
    } catch (err) {
        console.error('[supervisor] Error en chat Gemma4:', err.message);
        await msg.reply('❌ Error consultando el modelo. Intenta de nuevo.');
    }
});

// ──────────────────────────────────────────────────────────────────────────────
// API REST del bridge (llamada desde Flask o scripts externos)
// ──────────────────────────────────────────────────────────────────────────────
const appExpress = express();
appExpress.use(express.json({ limit: '10mb' }));

function bridgeAuthOk(req) {
    if (!BRIDGE_TOKEN) return true;
    return req.get('X-Bridge-Token') === BRIDGE_TOKEN;
}

/** POST /enviar-ptt  { numero, audioBase64, mimeType? }
 *  Flask puede llamar este endpoint para que el supervisor envíe un PTT. */
appExpress.post('/enviar-ptt', async (req, res) => {
    if (!bridgeAuthOk(req)) return res.status(401).json({ error: 'No autorizado' });
    const { numero, audioBase64, mimeType } = req.body;
    if (!numero || !audioBase64) return res.status(400).json({ error: 'Faltan numero o audioBase64' });

    try {
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListo('API /enviar-ptt');
        }
        if (!sistemaListo) {
            return res.status(503).json({
                error: 'WhatsApp supervisor aún sincronizando. Espera ~15 s tras conectar y vuelve a intentarlo.',
            });
        }

        const chatId = numero.includes('@') ? numero
            : (_normalizarNumero(numero).length > 15 ? `${_normalizarNumero(numero)}@g.us` : `${_normalizarNumero(numero)}@c.us`);

        // Convertir a OGG Opus si no lo es ya (WhatsApp requiere OGG para notas de voz)
        let finalB64  = audioBase64;
        let finalMime = mimeType || 'audio/ogg; codecs=opus';
        try {
            const converted = await convertirAOggOpus(audioBase64, mimeType);
            finalB64  = converted.audioBase64;
            finalMime = converted.mimeType;
        } catch (convErr) {
            console.error('[supervisor] /enviar-ptt: conversión OGG falló:', convErr.message);
            return res.status(500).json({ error: `Conversión de audio falló: ${convErr.message}` });
        }

        const media = new MessageMedia(finalMime, finalB64, 'voice.ogg');
        await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
        console.log(`🎙️ [supervisor] PTT (API) → ${chatId}`);
        logActividad('SALIENTE', { para: chatId, tipo: 'PTT', origen: 'API' });
        res.json({ status: 'success' });
    } catch (err) {
        if (esErrorContextoPuppeteer(err)) {
            console.error('[supervisor] PTT rechazado — WhatsApp reiniciando contexto Puppeteer:', err.message);
            return res.status(503).json({
                error: 'WhatsApp está reconectando su sesión. Espera ~15 s e intenta de nuevo.',
            });
        }
        console.error('[supervisor] Error /enviar-ptt:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/** POST /enviar  { numero, mensaje }
 *  Enviar texto plano desde la cuenta supervisora. */
appExpress.post('/enviar', async (req, res) => {
    if (!bridgeAuthOk(req)) return res.status(401).json({ error: 'No autorizado' });
    const { numero, mensaje } = req.body;
    if (!numero || !mensaje) return res.status(400).json({ error: 'Faltan numero o mensaje' });

    try {
        if (!sistemaListo && client.info && client.info.wid) await promoverSistemaListo('API /enviar');
        if (!sistemaListo) return res.status(503).json({ error: 'Sincronizando…' });

        const chatId = numero.includes('@') ? numero
            : (_normalizarNumero(numero).length > 15 ? `${_normalizarNumero(numero)}@g.us` : `${_normalizarNumero(numero)}@c.us`);
        await client.sendMessage(chatId, mensaje);
        logActividad('SALIENTE', { para: chatId, texto: mensaje.substring(0, 60), origen: 'API' });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** GET /status */
appExpress.get('/status', (req, res) => {
    const wid = client && client.info && client.info.wid;
    res.json({
        listo:           sistemaListo,
        numero:          wid ? (wid.user || null) : null,
        pushname:        (client.info && client.info.pushname) || null,
        gemma_model:     GEMMA_MODEL,
        autorizados:     NUMEROS_AUTORIZADOS.size,
        ultimoQr:        ultimoQr ? 'pendiente' : null,
        ultimoQrTs:      ultimoQrTs || null,
        timestamp:       new Date().toISOString(),
    });
});

/** GET /monitor */
appExpress.get('/monitor', (req, res) => {
    res.json({ actividad: activityLog.slice(0, 50) });
});

/** GET /qr — QR en texto para escaneo remoto */
appExpress.get('/qr', (req, res) => {
    if (!ultimoQr) return res.status(404).json({ error: 'Sin QR activo' });
    if (Date.now() - ultimoQrTs > 60000) return res.status(410).json({ error: 'QR expirado' });
    res.json({ qr: ultimoQr, ts: ultimoQrTs });
});

/** POST /contactos  { nombre, numero }  — agrega o actualiza contacto */
appExpress.post('/contactos', (req, res) => {
    if (!bridgeAuthOk(req)) return res.status(401).json({ error: 'No autorizado' });
    const { nombre, numero } = req.body;
    if (!nombre || !numero) return res.status(400).json({ error: 'Faltan nombre o numero' });
    try {
        const contactos = cargarContactos();
        contactos[nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] = _normalizarNumero(numero);
        fs.writeFileSync(CONTACTOS_PATH, JSON.stringify(contactos, null, 2));
        res.json({ status: 'ok', contactos: Object.keys(contactos).filter(k => !k.startsWith('_')).length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** GET /contactos */
appExpress.get('/contactos', (req, res) => {
    res.json(cargarContactos());
});

/** POST /session/logout — desvincular cuenta y reinicializar (muestra QR nuevo) */
appExpress.post('/session/logout', async (req, res) => {
    if (!bridgeAuthOk(req)) return res.status(401).json({ error: 'No autorizado' });

    console.log('🔄 [supervisor] Desvinculando sesión por petición del panel…');
    logActividad('SISTEMA', { texto: 'Desvinculando sesión para re-vincular.' });
    sistemaListo = false;
    ultimoQr     = null;
    ultimoQrTs   = 0;

    // 1. Destruir cliente actual
    try {
        await Promise.race([client.destroy(), new Promise(r => setTimeout(r, 6000))]);
    } catch (_) {}

    // 2. Borrar carpeta de sesión
    const authDir = path.join(__dirname, '.wwebjs_auth_supervisor');
    try {
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('🧹 [supervisor] Carpeta de sesión eliminada.');
        }
    } catch (e) {
        console.error('[supervisor] No se pudo borrar la sesión:', e.message);
    }

    // 3. Reinicializar (genera QR nuevo en ~30s)
    setTimeout(() => {
        limpiarCandadosSesion();
        client.initialize().catch(err => {
            console.error('[supervisor] Reinicialización falló:', err.message);
            logActividad('ERROR', { texto: `Reinicialización falló: ${err.message}` });
        });
    }, 2000);

    res.json({
        status: 'ok',
        mensaje: 'Sesión eliminada. Genera el QR en el panel en ~30 segundos.',
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Arranque
// ──────────────────────────────────────────────────────────────────────────────
appExpress.listen(PORT, () => {
    console.log(`\n🤖 bot-supervisor escuchando en :${PORT}`);
    console.log(`   Gemma4 model : ${GEMMA_MODEL}`);
    console.log(`   Flask URL    : ${FLASK}`);
    const autorizadosStr = NUMEROS_AUTORIZADOS.size
        ? [...NUMEROS_AUTORIZADOS].join(', ')
        : '⚠️  Sin filtro (todos los números pueden enviar comandos)';
    console.log(`   Autorizados  : ${autorizadosStr}`);
    console.log('');
});

client.initialize().catch(err => {
    console.error('\n❌ [supervisor] Fallo al iniciar WhatsApp:', err.message);
    if (err.message.includes('already running') || err.message.includes('userDataDir')) {
        console.error('→ Otro proceso usa .wwebjs_auth_supervisor/. Detén los duplicados.');
    }
    process.exit(1);
});
