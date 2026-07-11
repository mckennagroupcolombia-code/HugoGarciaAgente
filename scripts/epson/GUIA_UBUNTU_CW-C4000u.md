# Epson CW-C4000u en Ubuntu (McKenna)

El panel `/app` ofrece dos caminos de instalación:

| Opción | Cuándo |
|--------|--------|
| **Ubuntu (.deb)** | La Epson va por USB al PC/servidor Linux del agente |
| **Windows 10** | La Epson va por USB al PC de Jenniffer y se comparte por SMB |

## Ubuntu — paquete `.deb`

### Desde el panel

Etiquetas → **Instalar impresora** → **Ubuntu (.deb)** → Descargar / Instalar.

### One-liner (en el servidor Linux)

```bash
curl -fsSL -o /tmp/mckenna-epson-cwc4000u_amd64.deb \
  https://bot.mckennagroup.co/api/etiquetas/impresora/paquete-ubuntu
sudo dpkg -i /tmp/mckenna-epson-cwc4000u_amd64.deb
sudo apt-get install -f -y   # si pide dependencias (cups, smbclient)
lpstat -v CW-C4000u
```

### Reconstruir el `.deb` (desarrolladores)

```bash
./scripts/epson/build_deb_mckenna_cwc4000u.sh
# Sale en: scripts/epson/dist/mckenna-epson-cwc4000u_*_amd64.deb
```

El paquete instala:

- PPD → `/usr/share/ppd/mckenna/CW-C4000u.ppd`
- `elpu` → `/opt/epson/epson-label-printer-utility/elpu`
- Cola CUPS `CW-C4000u` (USB si está conectada)

## Windows 10

Ver [GUIA_WINDOWS_CW-C4000u.md](GUIA_WINDOWS_CW-C4000u.md).
