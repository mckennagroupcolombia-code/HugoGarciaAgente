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
app.use(express.json({ limit: "10mb" }));

// Comprobantes: raíz del repo (un nivel arriba de bot-mckenna/) o variable de entorno
const DIR_COMPROBANTES = process.env.COMPROBANTES_DIR
    ? path.resolve(process.env.COMPROBANTES_DIR)
    : path.join(__dirname, '..', 'comprobantes');

// ==========================================
// MONITOR — Buffer circular de actividad
// ==========================================
const MAX_LOG = 200;
const activityLog = [];
const comandosRecientes = new Map();

function logActividad(tipo, datos) {
    const entrada = {
        ts: new Date().toISOString(),
        tipo,   // 'ENTRANTE' | 'SALIENTE' | 'COMANDO' | 'ERROR' | 'SISTEMA'
        ...datos
    };
    activityLog.unshift(entrada);
    if (activityLog.length > MAX_LOG) activityLog.pop();
}

function normalizarComando(texto) {
    return String(texto || '')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[*_~`]+/g, '')
        .trim()
        .replace(/\s+/g, ' ');
}

function esComandoMeliOperativo(textoLower) {
    return (
        textoLower.startsWith('posventa ') ||
        textoLower.startsWith('resp preventa ') ||
        /^resp\s+\d{2,}:/.test(textoLower) ||
        /^ok\s+\d{3,}$/.test(textoLower) ||
        // Aprobación de borradores postventa (tolera el typo "sale")
        /^hugo\s+(dale|sale)\s+ok\b/.test(textoLower)
    );
}

function comandoDuplicado(msg, textoNorm) {
    const id = msg && msg.id && msg.id._serialized ? msg.id._serialized : '';
    const chatId = obtenerChatIdComando(msg) || msg.from || '';
    const key = id || `${chatId}|${textoNorm}`;
    const now = Date.now();
    for (const [k, ts] of comandosRecientes.entries()) {
        if (now - ts > 120000) comandosRecientes.delete(k);
    }
    if (comandosRecientes.has(key)) return true;
    comandosRecientes.set(key, now);
    return false;
}

function _serializarChatId(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val._serialized) return val._serialized;
    return String(val);
}

function obtenerChatIdComando(msg) {
    const candidatos = [
        _serializarChatId(msg && msg.chatId),
        _serializarChatId(msg && msg.id && msg.id.remote),
        msg && msg.to,
        msg && msg.from,
    ];
    return candidatos.find(x => typeof x === 'string' && x.includes('@g.us')) || (msg && msg.from);
}

async function obtenerChatIdComandoAsync(msg) {
    let chatId = obtenerChatIdComando(msg);
    if (typeof chatId === 'string' && chatId.includes('@g.us')) return chatId;
    try {
        const chat = await msg.getChat();
        const cid = _serializarChatId(chat && chat.id);
        if (cid.includes('@g.us')) return cid;
    } catch (_) { /* sesión aún sincronizando */ }
    return chatId || (msg && msg.from);
}

async function expandirComandoDesdeCita(msg, textoNorm) {
    if (!msg.hasQuotedMsg) return textoNorm;
    const t = textoNorm.toLowerCase();
    if (t.startsWith('posventa ') || t.startsWith('resp ') || /^ok\s+\d/.test(t)) return textoNorm;
    try {
        const quoted = await msg.getQuotedMessage();
        const qb = String((quoted && quoted.body) || '');
        const codigo =
            (qb.match(/c[oó]digo[:\s*]*\*?(\d{3,8})\*?/i) || [])[1] ||
            (qb.match(/posventa\s+(\d{3,8})\s*:/i) || [])[1] ||
            (qb.match(/resp\s+(\d{3,12})\s*:/i) || [])[1] ||
            (qb.match(/\*ok\s+(\d{3,})\*/i) || [])[1] ||
            (qb.match(/ok\s+(\d{3,})/i) || [])[1];
        if (!codigo) return textoNorm;
        if (/SUPERVISOR POSTVENTA|MENSAJE POSTVENTA/i.test(qb)) {
            return `posventa ${codigo}: ${textoNorm.trim()}`;
        }
        if (/SUPERVISOR PREVENTA|MENSAJE PREVENTA|BORRADOR IA|pregunta.*meli/i.test(qb)) {
            if (/^ok\s*$/i.test(textoNorm.trim())) {
                return `ok ${codigo}`;
            }
            return `resp preventa ${codigo}: ${textoNorm.trim()}`;
        }
    } catch (e) {
        console.warn('⚠️ No pude leer mensaje citado:', e.message);
    }
    return textoNorm;
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
let ultimoQr = null;
let ultimoQrTs = 0;
let sesionReseteando = false;

function bridgeAuthOk(req) {
    const expected = (process.env.WHATSAPP_BRIDGE_INTERNAL_TOKEN || '').trim();
    if (!expected) return true;
    return req.get('X-Bridge-Token') === expected;
}

function borrarCarpetaAuthWhatsapp() {
    const authDir = path.join(__dirname, '.wwebjs_auth_nueva');
    if (!fs.existsSync(authDir)) return;
    fs.rmSync(authDir, { recursive: true, force: true });
    console.log('🧹 Carpeta de sesión WhatsApp eliminada (.wwebjs_auth_nueva)');
    logActividad('SISTEMA', { texto: 'Sesión local eliminada; requiere nuevo QR.' });
}

function infoNumeroConectado() {
    const wid = client && client.info && client.info.wid;
    if (!wid) return { numero: null, pushname: null };
    const user = wid.user || (typeof wid === 'string' ? wid.split('@')[0] : null);
    const pushname = (client.info.pushname && String(client.info.pushname).trim()) || null;
    return { numero: user || null, pushname };
}

async function promoverSistemaListoSiSesionFunciona(origen = 'watchdog') {
    if (sistemaListo || !client.info || !client.info.wid) return false;
    try {
        await client.getChats();
        sistemaListo = true;
        console.log(`🚀 SISTEMA LISTO por ${origen} - sesión WhatsApp operativa`);
        logActividad('SISTEMA', { texto: `Sistema listo por ${origen}.` });
        return true;
    } catch (e) {
        console.warn(`⏳ WhatsApp aún no listo (${origen}):`, e.message);
        return false;
    }
}

setInterval(() => {
    promoverSistemaListoSiSesionFunciona('watchdog');
}, 10000);

// --- EVENTOS DE CONEXIÓN ---
client.on('qr', qr => {
    console.log('📱 QR DETECTADO: Escanee para iniciar sesión.');
    qrcode.generate(qr, { small: true });
    ultimoQr = qr;
    ultimoQrTs = Date.now();
    logActividad('SISTEMA', { texto: 'QR de vinculación generado (panel o terminal).' });
});

client.on('authenticated', () => {
    ultimoQr = null;
    ultimoQrTs = 0;
    logActividad('SISTEMA', { texto: 'WhatsApp autenticado.' });
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
    logActividad('SISTEMA', { texto: `Desconectado: ${reason || 'sin detalle'}. Auto-reconectando en 10s…` });

    setTimeout(() => {
        console.log('🔄 Intentando reconexión automática…');
        logActividad('SISTEMA', { texto: 'Reconexión automática iniciada.' });
        client.initialize().catch(err => {
            console.error('❌ Reconexión falló:', err.message);
            logActividad('ERROR', { texto: `Reconexión falló: ${err.message}. systemd reiniciará el proceso.` });
            process.exit(1);
        });
    }, 10000);
});

// Shutdown limpio: evita SIGKILL de systemd que deja el evento `ready` sin disparar al reiniciar
async function _shutdown(signal) {
    console.log(`🛑 ${signal} recibido — cerrando cliente WhatsApp...`);
    logActividad('SISTEMA', { texto: `Shutdown por ${signal}.` });
    sistemaListo = false;
    try {
        await Promise.race([
            client.destroy(),
            new Promise(r => setTimeout(r, 8000)),
        ]);
    } catch (_) {}
    process.exit(0);
}
process.on('SIGTERM', () => _shutdown('SIGTERM'));
process.on('SIGINT',  () => _shutdown('SIGINT'));

// ==========================================
// 3. ESCUCHADOR DE MENSAJES ENTRANTES (IA)
// ==========================================

// Systemd inyecta EnvironmentFile con comentarios inline incluidos en el valor.
// Esta función los elimina: "120363...@g.us # comentario" → "120363...@g.us"
function envLimpio(nombre, fallback) {
    const val = process.env[nombre];
    if (!val) return fallback;
    // systemd no soporta comentarios inline: "VAR=   # nota" llega con el "#"
    // como valor. Tras limpiar, un valor vacío debe caer al fallback — si no,
    // el grupo queda como "" y el bridge lo trata como GRUPO DESCONOCIDO
    // (comandos como "hugo dale ok" nunca llegan a Flask).
    const limpio = val.split('#')[0].trim();
    return limpio || fallback;
}

const GRUPO_CONTABILIDAD = envLimpio('GRUPO_CONTABILIDAD_WA', '120363407538342427@g.us');
const GRUPO_COMPRAS      = envLimpio('GRUPO_FACTURACION_COMPRAS_WA', '120363408323873426@g.us');
/** Pedidos web: notificaciones + facturar/envio — solo este JID (Guias_Envios pagina web). */
const GRUPO_PEDIDOS_WEB  = envLimpio('GRUPO_PEDIDOS_WEB_WA', '120363391665421264@g.us');
/** MeLi — mismos defaults que app/utils.py (jid_grupo_*_wa). Sin esto, posventa/resp nunca llegan a Flask. */
const GRUPO_PREVENTA_MELI = envLimpio('GRUPO_PREVENTA_WA', '120363393955474672@g.us');
const GRUPO_POSTVENTA_MELI = envLimpio('GRUPO_POSTVENTA_WA', '120363406693905719@g.us');
/** SEDE SUR: agente interno — reenvía todos los mensajes al agente (no solo comandos). */
const GRUPO_SEDE_SUR = envLimpio('GRUPO_SEDE_SUR_WA', '120363023555909043@g.us');
// IDs de mensajes enviados por el bot al grupo SEDE SUR (para evitar loop fromMe).
const sedeSurBotSentIds = new Set();
/** Respuestas IA a clientes — evitar que message_create las marque como humano. */
const panelBotSentIds = new Set();
/** Texto recién enviado por el bot (evita marcar humano si wa_id difiere). */
const panelBotSentContent = new Map();
const GRUPOS_ADMIN       = [GRUPO_CONTABILIDAD, GRUPO_COMPRAS];
/** Contabilidad/compras + pedidos web + preventa/postventa MeLi (comandos resp / posventa). */
const GRUPOS_COMANDO     = [...GRUPOS_ADMIN, GRUPO_PEDIDOS_WEB, GRUPO_PREVENTA_MELI, GRUPO_POSTVENTA_MELI];

function claveContenidoBot(chatJid, texto) {
    const t = String(texto || '').trim().slice(0, 240);
    return `${chatJid}::${t}`;
}

function marcarEnvioBot(replyTo, texto, waId) {
    if (waId) {
        panelBotSentIds.add(waId);
        setTimeout(() => panelBotSentIds.delete(waId), 120000);
    }
    const key = claveContenidoBot(replyTo, texto);
    panelBotSentContent.set(key, Date.now() + 120000);
    setTimeout(() => panelBotSentContent.delete(key), 120000);
}

function esRespuestaBotReciente(chatJid, replyTo, texto, waId) {
    if (waId && panelBotSentIds.has(waId)) return true;
    const keys = [
        claveContenidoBot(chatJid, texto),
        claveContenidoBot(replyTo, texto),
    ];
    const now = Date.now();
    for (const k of keys) {
        const until = panelBotSentContent.get(k);
        if (until && now < until) return true;
    }
    return false;
}

async function ingestarFromMeCliente(msg) {
    const sidProbe = serializarWaId(msg);
    if (sidProbe && panelBotSentIds.has(sidProbe)) {
        return;
    }
    const payload = await mensajeAPayloadHistorial(msg);
    if (!payload || payload.revoke) {
        if (payload && payload.revoke && payload.wa_id) {
            try {
                await axios.post(
                    PANEL_INGEST_URL.replace('/ingest', '/revoke'),
                    { wa_id: payload.wa_id },
                    { headers: panelAuthHeaders(), timeout: 8000 }
                );
            } catch (_) { /* ignore */ }
        }
        return;
    }
    await enviarHistorialPanel([payload]);
}

// Función compartida: procesar comandos de grupos admin
async function procesarComandoGrupo(msg, chatIdOverride) {
    const chatId = chatIdOverride || await obtenerChatIdComandoAsync(msg);
    let textoNorm = normalizarComando(msg.body);
    textoNorm = await expandirComandoDesdeCita(msg, textoNorm);
    const texto = textoNorm.toLowerCase();
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
    if (comandoDuplicado(msg, textoNorm)) {
        console.log(`⏭️ Comando duplicado ignorado: ${textoNorm}`);
        logActividad('SISTEMA', { de: chatId, texto: `Comando duplicado ignorado: ${textoNorm}` });
        return;
    }

    console.log(`📨 Comando del grupo (fromMe=${msg.fromMe}): ${textoNorm}`);
    logActividad('COMANDO', { de: chatId, fromMe: msg.fromMe, texto: textoNorm });
    try {
        await axios.post('http://localhost:8081/whatsapp', {
            sender: chatId,
            remoteJid: chatId,
            mensaje: textoNorm,
            es_grupo_contabilidad: GRUPOS_ADMIN.includes(chatId),
            hasMedia: false
        }, { timeout: 120000 });
    } catch (error) {
        console.error("❌ Error enviando comando al agente:", error.message);
        logActividad('ERROR', { texto: `Comando al agente: ${error.message}` });
    }
}

// MCKG SEDE SUR: todos los mensajes (texto y media) van al agente sin filtro de comandos.
async function procesarMensajeSedeSur(msg, chatId) {
    const texto = msg.body || '';
    if (!texto && !msg.hasMedia) return;

    logActividad('ENTRANTE', { de: chatId, tipo: msg.type, texto: texto || '[media]', hasMedia: msg.hasMedia });
    console.log(`🏢 SEDE SUR [${msg.from}]: ${texto.substring(0, 80)}`);

    let hasMedia = false, mediaPath = '', mediaType = '';
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media) {
                hasMedia = true;
                if (media.mimetype.startsWith('audio/') || media.mimetype === 'application/ogg') {
                    mediaType = 'audio';
                    const ts = Date.now();
                    mediaPath = path.join(DIR_COMPROBANTES, `sedeSur_${ts}.ogg`);
                    fs.writeFileSync(mediaPath, media.data, 'base64');
                } else if (media.mimetype.startsWith('image/')) {
                    mediaType = 'image';
                    const ext = media.mimetype.split('/')[1].split(';')[0];
                    const ts = Date.now();
                    mediaPath = path.join(DIR_COMPROBANTES, `sedeSur_${ts}.${ext}`);
                    fs.writeFileSync(mediaPath, media.data, 'base64');
                }
            }
        } catch (e) {
            console.error('⚠️  SEDE SUR media download error:', e.message);
        }
    }

    try {
        const responseIA = await axios.post('http://localhost:8081/whatsapp', {
            sender:               msg.from,
            remoteJid:            chatId,
            mensaje:              texto,
            hasMedia,
            mediaPath,
            mediaType,
            es_grupo_contabilidad: false,
        }, { timeout: 120000 });
        if (responseIA.data && responseIA.data.respuesta) {
            const sentResp = await client.sendMessage(chatId, responseIA.data.respuesta);
            // Registrar ID para que message_create no procese la propia respuesta del bot
            if (sentResp && sentResp.id) {
                const sid = sentResp.id._serialized || sentResp.id.id || '';
                if (sid) {
                    sedeSurBotSentIds.add(sid);
                    setTimeout(() => sedeSurBotSentIds.delete(sid), 30000);
                }
            }
            logActividad('SALIENTE', { para: chatId, texto: responseIA.data.respuesta });
        }
    } catch (error) {
        console.error('❌ Error procesando mensaje SEDE SUR:', error.message);
        logActividad('ERROR', { texto: `SEDE SUR: ${error.message}`, de: chatId });
    }
}

// message_create captura mensajes creados en WhatsApp Web. En algunos entornos
// los mensajes de otros participantes llegan aquí antes que en `message`.
// `comandoDuplicado` evita procesar dos veces si también llega el evento message.
client.on('message_create', async (msg) => {
    if (!sistemaListo) return;
    const chatId = await obtenerChatIdComandoAsync(msg);
    const textoProbe = normalizarComando(msg.body || '').toLowerCase();
    const enGrupoCmd = GRUPOS_COMANDO.includes(chatId);

    // Mensajes enviados desde el celular (fromMe) a clientes → historial del panel, sin IA
    if (msg.fromMe && !enGrupoCmd && !esComandoMeliOperativo(textoProbe)) {
        await ingestarFromMeCliente(msg);
        return;
    }

    // SEDE SUR: interceptar mensajes humanos (incluye fromMe si el admin usa el mismo teléfono)
    if (chatId === GRUPO_SEDE_SUR) {
        const sid = (msg.id && (msg.id._serialized || msg.id.id)) || '';
        if (sedeSurBotSentIds.has(sid)) return; // respuesta del bot, evitar loop
        await procesarMensajeSedeSur(msg, chatId);
        return;
    }
    if (!enGrupoCmd && !esComandoMeliOperativo(textoProbe)) return;
    await procesarComandoGrupo(msg, enGrupoCmd ? chatId : GRUPO_POSTVENTA_MELI);
});

client.on('message_revoke', async (msg) => {
    const waId = serializarWaId(msg);
    if (!waId) return;
    try {
        await axios.post(
            PANEL_INGEST_URL.replace('/ingest', '/revoke'),
            { wa_id: waId },
            { headers: panelAuthHeaders(), timeout: 8000 }
        );
        logActividad('SISTEMA', { texto: `Mensaje eliminado en WA: ${waId}` });
    } catch (e) {
        console.warn('⚠️ Revoke no registrado en panel:', e.message);
    }
});

client.on('message', async (msg) => {
    if (!sistemaListo) return;

    // Filtro 1: ignorar estados y broadcasts
    if (msg.from === 'status@broadcast') return;
    if (msg.type === 'e2e_notification') return;
    if (msg.type === 'notification_template') return;
    if (msg.type === 'call_log') return;

    const chatIdComando = await obtenerChatIdComandoAsync(msg);
    const esGrupoComando = GRUPOS_COMANDO.includes(chatIdComando);
    const textoProbe = normalizarComando(msg.body || '').toLowerCase();
    const esCmdMeli = esComandoMeliOperativo(textoProbe);

    // Algunos mensajes enviados desde el celular llegan por `message` con
    // fromMe=true y el grupo en msg.to/id.remote, no en msg.from.
    if (msg.fromMe && (esGrupoComando || esCmdMeli)) {
        await procesarComandoGrupo(
            msg,
            esGrupoComando ? chatIdComando : GRUPO_POSTVENTA_MELI
        );
        return;
    }

    // Mensajes del operador al cliente → historial del panel (fallback si message_create no dispara)
    if (msg.fromMe && !esGrupoComando && !esCmdMeli) {
        await ingestarFromMeCliente(msg);
        return;
    }

    // MCKG SEDE SUR: equipo interno — reenviar todos los mensajes al agente
    if (chatIdComando === GRUPO_SEDE_SUR) {
        const sid = (msg.id && (msg.id._serialized || msg.id.id)) || '';
        if (!sedeSurBotSentIds.has(sid)) {
            await procesarMensajeSedeSur(msg, chatIdComando);
        }
        return;
    }

    // Filtro 3: ignorar grupos que no sean de admin
    if (chatIdComando.includes('@g.us') && !esGrupoComando) {
        const cuerpo = msg.body || '[media]';
        console.log(`👥 GRUPO DESCONOCIDO [${chatIdComando}]: ${cuerpo}`);
        const logTxt = esCmdMeli
            ? `[Comando MeLi fuera de grupo operativo — reenviando] ${cuerpo}`
            : `[Grupo no está en GRUPOS_COMANDO] ${cuerpo}`;
        logActividad('SISTEMA', { de: chatIdComando, texto: logTxt });
        if (esCmdMeli) {
            await procesarComandoGrupo(msg, GRUPO_POSTVENTA_MELI);
        }
        return;
    }

    // Filtro 4: ignorar mensajes vacíos o sin texto
    if (!msg.body || msg.body.trim() === '') {
        if (!msg.hasMedia) return;
    }

    // Los comandos de grupos operativos pueden llegar con timestamp viejo
    // tras reconexión/sincronización de WhatsApp Web. Procesarlos antes
    // del filtro de antigüedad evita perder respuestas MeLi `resp ...`.
    if (esGrupoComando) {
        await procesarComandoGrupo(msg, chatIdComando);
        return;
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

                if (mediaType === 'image' || mediaType === 'document') {
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

        const ident = await resolverIdentidadCliente(msg);
        const histIn = await mensajeAPayloadHistorial(msg);
        if (histIn && !histIn.revoke) {
            if (mediaPath) {
                const rel = mediaPath.includes('comprobantes')
                    ? 'comprobantes/' + path.basename(mediaPath)
                    : path.basename(mediaPath);
                histIn.media_path = rel;
                histIn.nombre_arch = path.basename(mediaPath);
                if (mediaType === 'image') histIn.media_mime = 'image/jpeg';
                else if (mediaType === 'document') histIn.media_mime = 'application/pdf';
            }
            await enviarHistorialPanel([histIn]);
        }
        const responseIA = await axios.post('http://localhost:8081/whatsapp', {
            sender: ident.sender,
            sender_lid: ident.sender_lid,
            sender_phone: ident.sender_phone,
            reply_to: ident.replyTo,
            wa_id: serializarWaId(msg),
            ts: msg.timestamp,
            mensaje: msg.body,
            hasMedia: hasMedia,
            mediaPath: mediaPath,
            mediaType: mediaType,
            es_grupo_contabilidad: false
        }, { timeout: 120000 });

        if (responseIA.data && responseIA.data.respuesta) {
            const respuestaBot = responseIA.data.respuesta;
            marcarEnvioBot(ident.replyTo, respuestaBot, '');
            const sent = await client.sendMessage(ident.replyTo, respuestaBot);
            console.log(`📤 Respuesta de IA enviada a ${msg.from}`);
            logActividad('SALIENTE', { para: msg.from, texto: respuestaBot });
            const outPayload = {
                wa_id: sent && sent.id ? (sent.id._serialized || sent.id.id || '') : '',
                jid: ident.sender,
                ts: Math.floor(Date.now() / 1000),
                from_me: true,
                texto: respuestaBot,
                tiene_media: false,
                enviado_por: 'bot',
            };
            marcarEnvioBot(ident.replyTo, respuestaBot, outPayload.wa_id);
            await enviarHistorialPanel([outPayload]);
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
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListoSiSesionFunciona('API /enviar');
        }
        if (!sistemaListo || !client.info || !client.info.wid) {
             return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }

        const chatId = numero.includes('@') ? numero : (numero.length > 15 ? `${numero}@g.us` : `${numero}@c.us`);

        const sentMsg = await client.sendMessage(chatId, mensaje);
        // Registrar ID para evitar loop en SEDE SUR (mensaje fromMe del propio bot)
        if (chatId === GRUPO_SEDE_SUR && sentMsg && sentMsg.id) {
            const sid = sentMsg.id._serialized || sentMsg.id.id || '';
            if (sid) {
                sedeSurBotSentIds.add(sid);
                setTimeout(() => sedeSurBotSentIds.delete(sid), 30000);
            }
        }
        const ackInicial = sentMsg && typeof sentMsg.ack !== 'undefined' ? sentMsg.ack : 'sin dato';
        const idSerial = sentMsg && sentMsg.id ? (sentMsg.id._serialized || sentMsg.id.id || '') : '';
        console.log(`📤 Reporte enviado a: ${chatId} | ack inicial=${ackInicial} | id=${idSerial}`);
        if (idSerial) {
            setTimeout(async () => {
                try {
                    const msgCheck = await client.getMessageById(idSerial);
                    console.log(`🔎 [DIAG ACK] ${chatId} tras 6s: ack=${msgCheck ? msgCheck.ack : 'mensaje no encontrado'}`);
                } catch (e) {
                    console.log(`🔎 [DIAG ACK] ${chatId} error al verificar: ${e.message}`);
                }
            }, 6000);
        }
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
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListoSiSesionFunciona('API /enviar-archivo');
        }
        if (!sistemaListo || !client.info || !client.info.wid) {
            return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }
        const { MessageMedia } = require('whatsapp-web.js');
        const chatId = numero.includes('@') ? numero : (numero.length > 15 ? `${numero}@g.us` : `${numero}@c.us`);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(400).json({ status: "error", error: `Archivo no encontrado: ${filePath}` });
        }
        const fileData = fs.readFileSync(filePath);
        const lower = String(filePath).toLowerCase();
        let mimeType = 'application/octet-stream';
        if (lower.endsWith('.pdf')) mimeType = 'application/pdf';
        else if (lower.endsWith('.png')) mimeType = 'image/png';
        else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (lower.endsWith('.webp')) mimeType = 'image/webp';
        else if (lower.endsWith('.gif')) mimeType = 'image/gif';
        const resolvedName = fileName || path.basename(filePath);
        const media = new MessageMedia(mimeType, fileData.toString('base64'), resolvedName);
        await client.sendMessage(chatId, media, { caption: mensaje || '' });
        console.log(`📎 Archivo enviado a: ${chatId} — ${filePath} (${mimeType})`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("❌ Error enviando archivo:", error.message);
        res.status(500).json({ status: "error", error: error.message });
    }
});

// ── Perfil de WhatsApp (foto + "Info"/about) ─────────────────────────────────
app.post('/perfil/foto', async (req, res) => {
    const { filePath } = req.body;
    try {
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListoSiSesionFunciona('API /perfil/foto');
        }
        if (!sistemaListo || !client.info || !client.info.wid) {
            return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(400).json({ status: "error", error: `Archivo no encontrado: ${filePath}` });
        }
        const { MessageMedia } = require('whatsapp-web.js');
        const fileData = fs.readFileSync(filePath);
        const lower = String(filePath).toLowerCase();
        let mimeType = 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (lower.endsWith('.webp')) mimeType = 'image/webp';
        const media = new MessageMedia(mimeType, fileData.toString('base64'), path.basename(filePath));
        const ok = await client.setProfilePicture(media);
        console.log(`🖼️ Foto de perfil actualizada: ${filePath} — ok=${ok}`);
        res.status(200).json({ status: "success", ok });
    } catch (error) {
        console.error("❌ Error actualizando foto de perfil:", error.message);
        res.status(500).json({ status: "error", error: error.message });
    }
});

app.post('/perfil/about', async (req, res) => {
    const { texto } = req.body;
    if (!texto) {
        return res.status(400).json({ status: "error", error: "Falta texto" });
    }
    try {
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListoSiSesionFunciona('API /perfil/about');
        }
        if (!sistemaListo || !client.info || !client.info.wid) {
            return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }
        await client.setStatus(texto);
        console.log(`📝 Info de perfil (about) actualizada: "${texto}"`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("❌ Error actualizando info de perfil:", error.message);
        res.status(500).json({ status: "error", error: error.message });
    }
});

// ── Enviar nota de voz (PTT) ─────────────────────────────────────────────────
app.post('/enviar-ptt', async (req, res) => {
    const { numero, audioBase64, mimeType } = req.body;
    if (!numero || !audioBase64) {
        return res.status(400).json({ status: "error", error: "Faltan numero o audioBase64" });
    }
    try {
        if (!sistemaListo && client.info && client.info.wid) {
            await promoverSistemaListoSiSesionFunciona('API /enviar-ptt');
        }
        if (!sistemaListo || !client.info || !client.info.wid) {
            return res.status(503).json({ status: "error", error: "Sincronizando..." });
        }
        const { MessageMedia } = require('whatsapp-web.js');
        const chatId = numero.includes('@') ? numero : `${numero}@c.us`;
        const mime = mimeType || 'audio/mpeg';
        const media = new MessageMedia(mime, audioBase64, 'voice.mp3');
        await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
        console.log(`🎙️ PTT enviado a: ${chatId}`);
        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("❌ Error enviando PTT:", error.message);
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

const PANEL_INGEST_URL = (
    process.env.PANEL_INGEST_URL || 'http://127.0.0.1:8081/api/bot/chats/ingest'
).replace(/\/$/, '');
const CHAT_API_TOKEN = (process.env.CHAT_API_TOKEN || '').split('#')[0].trim();
const NUMERO_NEGOCIO_WA = String(
    process.env.MCKENNA_WA_PUBLIC || process.env.WEB_WA_NUMBER || '573195183596'
).replace(/\D/g, '');

function esTelefonoNegocio(phoneJid) {
    const n = String(phoneJid || '').split('@')[0].replace(/\D/g, '');
    return n.length >= 10 && n === NUMERO_NEGOCIO_WA;
}

function panelAuthHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (CHAT_API_TOKEN) {
        h.Authorization = `Bearer ${CHAT_API_TOKEN}`;
    }
    return h;
}

function serializarWaId(msg) {
    if (!msg || !msg.id) return '';
    return msg.id._serialized || msg.id.id || '';
}

async function jidChatCliente(msg) {
    if (msg.fromMe) {
        try {
            const chat = await msg.getChat();
            if (chat && chat.id) {
                return typeof chat.id === 'string' ? chat.id : chat.id._serialized;
            }
        } catch (_) { /* sync aún cargando */ }
        if (msg.to) {
            return typeof msg.to === 'string' ? msg.to : msg.to._serialized;
        }
        if (msg.id && msg.id.remote) {
            return typeof msg.id.remote === 'string' ? msg.id.remote : msg.id.remote._serialized;
        }
    }
    return msg.from || '';
}

/** Colombia móvil: 57 + 10 dígitos empezando en 3. Rechaza 57+lid_digits. */
function normalizarPhoneJidColombia(rawDigits) {
    const n = String(rawDigits || '').replace(/\D/g, '');
    if (n.length === 10 && n.startsWith('3')) {
        return `57${n}@c.us`;
    }
    if (n.length === 12 && n.startsWith('57') && n[2] === '3') {
        return `${n}@c.us`;
    }
    return '';
}

async function resolverTelefonoDesdeContacto(contact) {
    if (!contact) return '';
    if (contact.number) {
        const p = normalizarPhoneJidColombia(String(contact.number).replace(/\D/g, ''));
        if (p && !esTelefonoNegocio(p)) return p;
    }
    if (typeof contact.getFormattedNumber === 'function') {
        try {
            const f = await contact.getFormattedNumber();
            const p = normalizarPhoneJidColombia(String(f || '').replace(/\D/g, ''));
            if (p && !esTelefonoNegocio(p)) return p;
        } catch (_) { /* ignore */ }
    }
    return '';
}

/** @c.us opaco (57+dígitos lid) → @lid para historial del panel. */
function lidDesdeJidCusFalso(jid) {
    const num = String(jid || '').split('@')[0].replace(/\D/g, '');
    if (num.startsWith('57') && num.length > 12) {
        return `${num.slice(2)}@lid`;
    }
    return '';
}

/** WhatsApp @lid → teléfono @c.us cuando el contacto lo expone (evita chats duplicados en panel). */
async function resolverIdentidadCliente(msg) {
    const from = (msg && msg.from) ? String(msg.from) : '';
    let phoneJid = '';
    if (from.endsWith('@lid')) {
        try {
            const c = await msg.getContact();
            phoneJid = await resolverTelefonoDesdeContacto(c);
            if (phoneJid) {
                console.log(`📇 LID ${from} → ${phoneJid}`);
            }
        } catch (e) {
            console.warn('⚠️ No se pudo resolver teléfono desde @lid:', e.message);
        }
    } else if (from.endsWith('@c.us')) {
        phoneJid = normalizarPhoneJidColombia(from.split('@')[0]);
        if (!phoneJid) {
            const lid = lidDesdeJidCusFalso(from);
            if (lid) {
                return {
                    replyTo: from,
                    sender: lid,
                    sender_lid: lid,
                    sender_phone: '',
                };
            }
        }
    }
    return {
        replyTo: from,
        sender: phoneJid || from,
        sender_lid: from.endsWith('@lid') ? from : (lidDesdeJidCusFalso(from) || ''),
        sender_phone: phoneJid,
    };
}

async function resolverIdentidadDesdeChat(chatJid, msg) {
    const cj = String(chatJid || '').trim();
    let phoneJid = '';
    if (cj.endsWith('@c.us')) {
        phoneJid = normalizarPhoneJidColombia(cj.split('@')[0]);
        if (!phoneJid) {
            const lid = lidDesdeJidCusFalso(cj);
            if (lid) {
                return {
                    canon: lid,
                    replyTo: cj,
                    sender_lid: lid,
                    sender_phone: '',
                };
            }
        }
    } else if (cj.endsWith('@lid') && msg) {
        try {
            const c = await msg.getContact();
            phoneJid = await resolverTelefonoDesdeContacto(c);
        } catch (_) { /* ignore */ }
    }
    return {
        canon: phoneJid || cj,
        replyTo: cj,
        sender_lid: cj.endsWith('@lid') ? cj : '',
        sender_phone: phoneJid,
    };
}

async function mensajeAPayloadHistorial(msg) {
    const chatJid = await jidChatCliente(msg);
    if (!chatJid || chatJid.includes('@g.us') || chatJid === 'status@broadcast') {
        return null;
    }
    const tipo = msg.type || '';
    if (['revoked', 'e2e_notification', 'notification_template', 'call_log'].includes(tipo)) {
        return { revoke: true, wa_id: serializarWaId(msg) };
    }
    const ident = await resolverIdentidadDesdeChat(chatJid, msg);
    let texto = (msg.body || '').trim();
    if (!texto && msg.hasMedia) {
        texto = '[adjunto]';
    }
    if (!texto) {
        return null;
    }
    const enviado = msg.fromMe ? 'humano' : 'cliente';
    let enviadoFinal = enviado;
    if (msg.fromMe) {
        const sid = serializarWaId(msg);
        if (esRespuestaBotReciente(chatJid, ident.replyTo || chatJid, texto, sid)) {
            enviadoFinal = 'bot';
        }
    }
    return {
        wa_id: serializarWaId(msg),
        jid: ident.canon,
        ts: msg.timestamp || Math.floor(Date.now() / 1000),
        from_me: !!msg.fromMe,
        texto,
        tiene_media: !!msg.hasMedia,
        nombre_arch: '',
        type: tipo,
        enviado_por: enviadoFinal,
        sender_lid: ident.sender_lid || '',
        sender_phone: ident.sender_phone || '',
    };
}

async function enviarHistorialPanel(items) {
    const mensajes = (items || []).filter(Boolean);
    if (!mensajes.length) return;
    try {
        await axios.post(
            PANEL_INGEST_URL,
            { mensajes },
            { headers: panelAuthHeaders(), timeout: 12000 }
        );
    } catch (e) {
        console.warn('⚠️ Historial panel no guardado:', e.message);
    }
}

// ==========================================
// Sesión WhatsApp (panel Agente WA vía Flask)
// ==========================================
app.post('/chats/sync', async (req, res) => {
    if (!bridgeAuthOk(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const jid = String((req.body && req.body.jid) || '').trim();
    const limit = Math.min(parseInt((req.body && req.body.limit) || '50', 10) || 50, 80);
    if (!jid) {
        return res.status(400).json({ error: 'jid requerido' });
    }
    if (!waSesionOperativa()) {
        return res.status(503).json({ error: 'WhatsApp no conectado' });
    }
    try {
        const chat = await client.getChatById(jid);
        if (!chat) {
            return res.status(404).json({ error: 'Chat no encontrado' });
        }
        const msgs = await chat.fetchMessages({ limit });
        const batch = [];
        const revocados = [];
        for (const m of msgs) {
            const payload = await mensajeAPayloadHistorial(m);
            if (!payload) continue;
            if (payload.revoke && payload.wa_id) {
                revocados.push(payload.wa_id);
            } else {
                batch.push(payload);
            }
        }
        if (revocados.length) {
            try {
                await axios.post(
                    PANEL_INGEST_URL.replace('/ingest', '/revoke'),
                    { wa_ids: revocados },
                    { headers: panelAuthHeaders(), timeout: 12000 }
                );
            } catch (_) { /* ignore */ }
        }
        let ingest = { insertados: 0, actualizados: 0, omitidos: 0, total: 0 };
        let aliasRegistrado = null;
        const lidSync = jid.endsWith('@lid') ? jid : lidDesdeJidCusFalso(jid);
        if (lidSync) {
            try {
                let phoneAlias = '';
                if (chat.contact) {
                    phoneAlias = await resolverTelefonoDesdeContacto(chat.contact);
                }
                if (!phoneAlias) {
                    const c = await client.getContactById(lidSync);
                    phoneAlias = await resolverTelefonoDesdeContacto(c);
                }
                if (phoneAlias) {
                    aliasRegistrado = { lid: lidSync, phone: phoneAlias };
                }
            } catch (_) { /* contacto no resuelto */ }
        }
        if (batch.length || aliasRegistrado) {
            const r = await axios.post(
                PANEL_INGEST_URL,
                { mensajes: batch, alias: aliasRegistrado || undefined },
                { headers: panelAuthHeaders(), timeout: 30000 }
            );
            ingest = r.data || ingest;
        }
        return res.json({
            ok: true,
            jid,
            sincronizados: batch.length,
            revocados: revocados.length,
            ingest,
            alias: aliasRegistrado,
        });
    } catch (e) {
        console.error('❌ /chats/sync:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.get('/session/status', (req, res) => {
    if (!bridgeAuthOk(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    res.set('Cache-Control', 'no-store');
    const { numero, pushname } = infoNumeroConectado();
    const conectado = waSesionOperativa();
    const qrPendiente = !!(ultimoQr && !conectado);
    res.json({
        actualizado: new Date().toISOString(),
        sesionReseteando,
        sistemaListo,
        waSesionOperativa: conectado,
        conectado,
        numero,
        pushname,
        qrPendiente,
        qrGeneradoEn: ultimoQrTs ? new Date(ultimoQrTs).toISOString() : null,
    });
});

app.get('/session/qr', (req, res) => {
    if (!bridgeAuthOk(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    res.set('Cache-Control', 'no-store');
    if (waSesionOperativa()) {
        return res.json({
            qrPendiente: false,
            qrRaw: null,
            mensaje: 'Ya hay una sesión activa.',
        });
    }
    if (!ultimoQr) {
        return res.json({
            qrPendiente: false,
            qrRaw: null,
            mensaje: sesionReseteando
                ? 'Reiniciando sesión…'
                : 'Sin QR aún. Espera unos segundos o reinicia el puente.',
        });
    }
    return res.json({
        qrPendiente: true,
        qrRaw: ultimoQr,
        qrGeneradoEn: ultimoQrTs ? new Date(ultimoQrTs).toISOString() : null,
    });
});

app.post('/session/logout', (req, res) => {
    if (!bridgeAuthOk(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    if (sesionReseteando) {
        return res.status(409).json({ error: 'Ya hay un cambio de cuenta en curso.' });
    }
    sesionReseteando = true;
    sistemaListo = false;
    ultimoQr = null;
    res.json({
        status: 'iniciado',
        mensaje: 'Desvinculando sesión. El servicio se reiniciará; escanea el nuevo QR en 1–2 min.',
    });
    logActividad('SISTEMA', { texto: 'Desvinculación solicitada desde panel.' });

    setImmediate(async () => {
        try {
            if (waSesionOperativa()) {
                try {
                    await client.logout();
                } catch (e) {
                    console.warn('⚠️ client.logout():', e.message);
                }
            }
            try {
                await Promise.race([
                    client.destroy(),
                    new Promise((r) => setTimeout(r, 8000)),
                ]);
            } catch (_) { /* ignore */ }
            borrarCarpetaAuthWhatsapp();
        } catch (e) {
            console.error('❌ Error en logout de sesión:', e.message);
        }
        process.exit(0);
    });
});

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
  <h2 style="font-size:14px;color:#888;margin:28px 0 8px">💸 Costos IA vía API (Gemini / Claude)</h2>
  <p class="meta" id="cmeta" style="margin-top:0">Cargando costos…</p>
  <div id="ctarjetas" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"></div>
  <table>
    <thead><tr><th>Día</th><th>Gasto (USD)</th><th>Llamadas</th><th>Por canal</th></tr></thead>
    <tbody id="ctb"><tr><td colspan="4" style="padding:16px;color:#555">…</td></tr></tbody>
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
  function usd(v){ return 'US$' + Number(v||0).toFixed(2); }
  var ctb=document.getElementById('ctb'), cmeta=document.getElementById('cmeta'), ctar=document.getElementById('ctarjetas');
  function tarjeta(titulo, valor, sub){
    return '<div style="background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;min-width:150px">'
      + '<div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px">'+esc(titulo)+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:#4DB3A0;margin:4px 0">'+esc(valor)+'</div>'
      + '<div style="font-size:11px;color:#888">'+esc(sub||'')+'</div></div>';
  }
  fetch('/costos-ia',{cache:'no-store'}).then(function(r){ return r.json(); }).then(function(j){
    if(j.error){ cmeta.textContent='⚠️ '+j.error; ctb.innerHTML=''; return; }
    var hoy=j.hoy||{}, sem=j.semana||{}, lim=j.limites||{};
    cmeta.textContent='Semana '+(sem.desde||'?')+' → '+(sem.hasta||'?')
      +' · Alerta diaria: '+usd(lim.alerta_diaria_usd)+' · Bloqueo: '+usd(lim.tope_diario_usd)
      +' · Resumen semanal al grupo de sistemas los lunes';
    ctar.innerHTML =
      tarjeta('Hoy', usd(hoy.gasto_usd), (hoy.llamadas||0)+' llamadas') +
      tarjeta('Semana (7 días)', usd(sem.total_usd), (sem.llamadas||0)+' llamadas') +
      tarjeta('Promedio / día', usd(sem.promedio_dia_usd), 'últimos 7 días');
    var dias=(j.historial_30d||[]).slice(-10).reverse();
    ctb.innerHTML = dias.map(function(d){
      var pc = d.por_contexto||{};
      var canales = Object.keys(pc).sort(function(a,b){ return pc[b]-pc[a]; })
        .map(function(k){ return esc(k)+': '+usd(pc[k]); }).join(' · ');
      return '<tr><td style="padding:8px">'+esc(d.fecha)+'</td>'
        + '<td style="padding:8px;font-weight:700;color:'+((d.gasto_usd||0)>=(lim.alerta_diaria_usd||1)?'#f59e0b':'#e5e5e5')+'">'+usd(d.gasto_usd)+'</td>'
        + '<td style="padding:8px">'+(d.llamadas||0)+'</td>'
        + '<td style="padding:8px;font-size:12px;color:#aaa">'+(canales||'—')+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="padding:12px;color:#555">Sin llamadas registradas aún</td></tr>';
  }).catch(function(e){ cmeta.textContent='⚠️ '+e; ctb.innerHTML=''; });
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
// ENDPOINT: Costos IA vía API (proxy al Flask :8081)
// El presupuesto vive en Python (app/services/llm_budget.py); aquí solo
// lo re-exponemos para que el monitor (puerto 3000) lo muestre sin CORS.
// ==========================================
app.get('/costos-ia', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
        const r = await axios.get('http://127.0.0.1:8081/api/costos-ia', { timeout: 8000 });
        res.json(r.data);
    } catch (e) {
        res.status(502).json({ error: 'No se pudo consultar /api/costos-ia en :8081', detalle: String(e.message || e) });
    }
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
