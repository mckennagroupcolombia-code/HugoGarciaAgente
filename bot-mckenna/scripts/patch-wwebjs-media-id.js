#!/usr/bin/env node
/*
 * Parche de whatsapp-web.js 1.34.7: envío de archivos (PDF, imágenes).
 *
 * Desde las versiones de WhatsApp Web del 2026-09-17 (2.3000.10477+) todo
 * `sendMessage` con MessageMedia falla con «Data passed to getter must include
 * an id property (it's how we memoize) but got undefined»: el spread de
 * `mediaOptions` copia `__x_id: undefined` al mensaje y `Msg.initialize` lo toma
 * como id del modelo. Se perdieron así las facturas al cliente (TKT-2026-1548).
 *
 * Arreglo upstream (wwebjs PR #201923) sin publicar aún: borrar `__x_id` justo
 * después de armar el mensaje. Corre en `postinstall` (npm ci lo borraría) y es
 * idempotente. Cuando una versión nueva ya lo traiga, el ancla no cambia nada.
 */
const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const ANCLA = "        // Bot's won't reply if canonicalUrl is set (linking)\n";
const PARCHE = '        delete message.__x_id; // parche McKenna: scripts/patch-wwebjs-media-id.js\n';

if (!fs.existsSync(archivo)) {
    console.log('[patch-wwebjs] whatsapp-web.js no instalado; nada que parchar.');
    process.exit(0);
}
const src = fs.readFileSync(archivo, 'utf8');
if (src.includes('delete message.__x_id')) {
    console.log('[patch-wwebjs] ya aplicado.');
    process.exit(0);
}
if (!src.includes(ANCLA)) {
    console.error('[patch-wwebjs] ⚠️ no encontré el ancla: revisar si la versión nueva de whatsapp-web.js ya trae el arreglo.');
    process.exit(0);
}
fs.writeFileSync(archivo, src.replace(ANCLA, PARCHE + '\n' + ANCLA));
console.log('[patch-wwebjs] ✅ aplicado (delete message.__x_id).');
