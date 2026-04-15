# bot-mckenna — Puente WhatsApp

Servicio **Node.js** (`whatsapp-web.js`) en el **puerto 3000**: recibe mensajes, reenvía a `POST http://localhost:8081/whatsapp`, expone `POST /enviar` y `POST /enviar-archivo` para Python (`app/utils.py`).

## Qué tienes que hacer (resumen)

1. **Instalar dependencias** (desde la raíz del repo o aquí):

   ```bash
   cd /home/mckg/mi-agente/bot-mckenna
   npm ci
   ```

2. **Ruta oficial única del bridge**: `/home/mckg/mi-agente/bot-mckenna`.
   - No usar ni recrear `/home/mckg/bot-mckenna`.
   - La carpeta legacy ya fue retirada para evitar procesos duplicados en el puerto 3000.

3. **Arrancar** (manual):

   ```bash
   npm start
   ```

  O instalar **systemd** (unidad **`mckenna-whatsapp-bridge.service`** — no uses `bot-mckenna.service` si en tu PC ese nombre ya es **otro** servicio, p. ej. Python).

   ```bash
  # 1) Desactivar units viejas que no sean mckenna-whatsapp-bridge (si aplica)
  sudo systemctl disable --now whatsapp-bridge whatsapp-server 2>/dev/null || true

  # 2) Instalar el puente Node desde ESTE repo
   chmod +x instalar_systemd.sh
   sudo ./instalar_systemd.sh
   sudo systemctl enable --now mckenna-whatsapp-bridge
   sudo systemctl status mckenna-whatsapp-bridge --no-pager -l
   ```

   Comprobar que **no** arrancaste por error `bot-mckenna.service` (en muchos equipos es Python, no WhatsApp):

   ```bash
   systemctl cat bot-mckenna.service | head -5
   ```

4. **Apaga** cualquier otro proceso en el puerto 3000 que no sea `mckenna-whatsapp-bridge` para no duplicar el bridge.

Monitor: `http://localhost:3000/monitor` · Grupos (JSON): `http://localhost:3000/grupos`

---

## Sobre los mensajes de `npm` que viste

| Mensaje | Qué significa |
|--------|----------------|
| `deprecated inflight`, `rimraf`, `glob`, `fstream`, `fluent-ffmpeg` | Vienen de **dependencias internas** de `whatsapp-web.js` / Puppeteer. **No los controlamos**; son avisos, no errores. |
| `npm audit` mostró vulnerabilidades | En el repo el **`package-lock.json` está alineado** con `npm audit fix`; tras `npm ci`, si `npm audit` aún avisara, ejecuta **`npm audit fix`** (sin `--force`). |

Después de `npm ci` no necesitas hacer nada más con esos *warnings* de paquetes deprecados.

---

## Variables opcionales

- `COMPROBANTES_DIR` — carpeta para imágenes de comprobantes (por defecto `../comprobantes` respecto a este directorio).
- Grupos admin: `GRUPO_CONTABILIDAD_WA`, `GRUPO_FACTURACION_COMPRAS_WA`, etc. Puedes usar un `.env` **solo en esta carpeta** (`dotenv`) o el `EnvironmentFile` de systemd apuntando al `.env` del repo.

## Error: `The browser is already running for ... userDataDir`

Significa que **Chrome de whatsapp-web.js cree que el perfil está en uso**: casi siempre hay **otro `node server.js`** o un **systemd** duplicado, o quedaron candados tras un corte.

1. Busca y para procesos duplicados:

   ```bash
   pgrep -af 'bot-mckenna|server\.js'
   systemctl status mckenna-whatsapp-bridge --no-pager 2>/dev/null
   ```

  Detén cualquier servicio/proceso duplicado **antes** de arrancar el del repo.

2. Vuelve a ejecutar `npm start`: el `server.js` actual elimina al arrancar `SingletonLock`, `SingletonSocket`, `SingletonCookie` y `DevToolsActivePort` bajo `.wwebjs_auth_nueva/session/`.

3. Si sigue igual, cierra cualquier Chromium que esté usando esa ruta (menos habitual en servidor sin escritorio).

## Prueba rápida

Con el bridge en marcha y sincronizado (~15 s tras conectar):

```bash
python3 prueba_envio_wa.py
```
