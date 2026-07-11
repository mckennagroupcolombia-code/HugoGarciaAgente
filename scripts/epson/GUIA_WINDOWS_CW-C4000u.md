# Epson CW-C4000u en Windows (McKenna)

El agente (panel `/app`) corre en **Linux**. La impresora puede ir por USB en ese Linux **o** en un PC **Windows** compartida por red (**SMB**, recomendado). El driver nativo de Windows es el oficial de Epson; no se usa el PPD Linux en el PC de Jenniffer.

## 0. Desinstalar (sesión Jenniffer — empezar limpio)

El script **no está en el PC Windows** por defecto: vive en el servidor Linux del agente.
Descárgalo o ejecútalo con el one-liner de abajo.

### Opción A — one-liner (recomendado)

PowerShell **como Administrador** en el PC de Jenniffer:

```powershell
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://bot.mckennagroup.co/api/etiquetas/impresora/script-windows' -OutFile '$env:TEMP\configurar_compartir_windows.ps1'; & '$env:TEMP\configurar_compartir_windows.ps1' -Desinstalar"
```

Luego, sin `-Desinstalar`, para preparar compartir SMB:

```powershell
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://bot.mckennagroup.co/api/etiquetas/impresora/script-windows' -OutFile '$env:TEMP\configurar_compartir_windows.ps1'; & '$env:TEMP\configurar_compartir_windows.ps1'"
```

### Opción B — descargar el archivo

1. En el navegador del Windows: https://bot.mckennagroup.co/api/etiquetas/impresora/script-windows
   (No uses `http://192.168.1.8:8081/...` si el PC no está en la misma LAN que el servidor.)
2. Guarda como `configurar_compartir_windows.ps1` (p. ej. en Descargas).
3. PowerShell Admin:

```powershell
cd $env:USERPROFILE\Downloads
powershell -ExecutionPolicy Bypass -File .\configurar_compartir_windows.ps1
```

O manual: *Configuración → Impresoras → CW-C4000u → Quitar dispositivo*.

En el panel McKenna: **Instalar (Windows 10 Pro)** → botón **Desinstalar** (quita la cola del servidor Linux).

Luego sigue los pasos 1–4 de abajo y pulsa **Instalar para Windows 10 Pro** con la IP del PC.

## 1. Driver oficial Windows

1. Enciende la CW-C4000u y conéctala por **USB directo** (sin hub) al PC Windows.
2. Espera a que el LCD diga **Listo**.
3. Descarga e instala el driver desde Epson (elige Windows 10/11):

   https://epson.com/Support/Printers/Label-Printers/ColorWorks-Series/Epson-ColorWorks-CW-C4000/s/SPT_C31CK03101

   Alternativa regional: https://www.epson-biz.com/ → ColorWorks CW-C4000 → Windows.

4. En *Configuración → Impresoras*, confirma que aparece **CW-C4000u** (o renómbrala exactamente a `CW-C4000u`).

## 2. Compartir la impresora (SMB)

1. Clic derecho en la impresora → **Propiedades de impresora** → pestaña **Compartir**.
2. Marca **Compartir esta impresora**.
3. Nombre del recurso compartido: **`CW-C4000u`** (sin espacios).
4. Acepta.

## 3. Red Privada + firewall

En PowerShell **como Administrador**:

```powershell
# Perfil Privado (necesario para compartir)
Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private

# Compartir archivos e impresoras (perfil Privado)
Set-NetFirewallRule -DisplayGroup "File and Printer Sharing" -Enabled True -Profile Private
# Si el sistema está en español:
# Set-NetFirewallRule -DisplayGroup "Compartir archivos e impresoras" -Enabled True -Profile Private
```

O ejecuta el script descargado desde el agente (no uses `scripts\epson\...` en Windows — esa ruta solo existe en el repo Linux):

```powershell
# Desde el PC Windows (Admin), descarga por URL pública (no uses 192.168.1.8):
powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://bot.mckennagroup.co/api/etiquetas/impresora/script-windows' -OutFile '$env:TEMP\configurar_compartir_windows.ps1'; & '$env:TEMP\configurar_compartir_windows.ps1'"
```

Anota la **IP LAN** del Windows (`ipconfig` → IPv4), p. ej. `192.168.5.116`.

## 4. Enlazar desde el panel (Linux)

1. Abre el panel → Etiquetas → **Instalar impresora**.
2. Pestaña **Windows 10 Pro**.
3. IP del Windows + nombre compartido `CW-C4000u` → **Instalar para Windows 10 Pro**.
4. Imprime una etiqueta de prueba.

Equivalente por API / script en el servidor Linux:

```bash
./scripts/configurar_impresora_windows_remota.sh 192.168.5.116 CW-C4000u
# URI resultante: smb://192.168.5.116/CW-C4000u
# o:
# POST /api/etiquetas/impresora/remoto  {"host":"192.168.5.116","share":"CW-C4000u"}
```

### Comprobar red antes de imprimir

El servidor Linux del agente debe alcanzar el PC Windows (misma LAN o Tailscale). Desde el Linux:

```bash
ping -c 2 IP_DEL_WINDOWS
# SMB (compartir impresoras):
timeout 3 bash -c "echo >/dev/tcp/IP_DEL_WINDOWS/445" && echo OK_SMB
lpstat -v CW-C4000u   # debe mostrar smb://IP/CW-C4000u
```

Si el Linux está en `192.168.1.x` y el Windows en `192.168.5.x` sin ruta entre ellas, la cola CUPS se crea pero **no imprimirá** hasta corregir IP/VLAN/Wi‑Fi o usar Tailscale en ambos.

## Compatibilidad

| Sistema | Qué instalar |
|---------|----------------|
| Windows 10 / 11 | Driver Epson CW-C4000 oficial + **compartir SMB** |
| Linux (agente) | Cola CUPS `smb://IP_WINDOWS/CW-C4000u` (PPD opcional) |

Misma red LAN (o Tailscale) entre el PC Linux del agente y el Windows.

### IPP (opcional, no recomendado)

Windows 10 Pro **no** sirve IPP en el puerto 631 solo con “Internet Printing Client”. Eso requiere rol de servidor de impresión / IIS. Si ya tienes IPP, puedes forzar:

```bash
./scripts/configurar_impresora_windows_remota.sh --uri ipp://192.168.5.116/printers/CW-C4000u
```

Para McKenna el camino soportado es **SMB**.
