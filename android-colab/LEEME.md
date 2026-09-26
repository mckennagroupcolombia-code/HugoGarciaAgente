# APK de colaboradores externos

App Android aparte para quien tiene el perfil `colaborador_externo` (primero Sebastián).
No es la APK del panel con otro nombre:

| | APK del panel (`android-twa/`) | APK de colaboradores (`android-colab/`) |
|---|---|---|
| Paquete | `co.mckennagroup.panel` | `co.mckennagroup.colaboradores` |
| Contenido | TWA + alarmas, micrófono, cámara, puentes JS | un WebView, nada más |
| Permisos | red, micrófono, cámara, notificaciones, alarmas | solo red |
| Retorno de Google | `mckennaapp://auth` | `mckennacolab://auth` |
| Firma | `mckenna.keystore` | `colaboradores.keystore` (propia) |
| Tamaño | ~4 MB | ~44 KB (R8, sin librerías) |

**Lo que se ve adentro lo decide el servidor, no la APK.** A un usuario con
`colaborador_externo`, `app/routes.py::serve_spa` le entrega `desktop/dist-colab/`
(build aparte: solo Colaboradores y su Agenda con Armando) y le niega los archivos del
panel. Si Sebastián instalara la APK del panel, igual vería solo lo suyo.

## Compilar

```bash
./compilar.sh        # → McKenna_Colaboradores.apk
```

Para una versión nueva: `./compilar.sh 1.1.0` (sube `versionCode` en `version.properties`) o el botón de /app → Ajustes → App de colaboradores.

## Llave de firma

`colaboradores.keystore` + `keystore.properties` (contraseña) **no están en git**. Si se
pierden, la próxima APK no instala encima de la vieja: hay que desinstalar e instalar de
nuevo (no se pierde nada, todo vive en el servidor). Para rehacerlas:

```bash
PASS=$(python3 -c "import secrets;print(secrets.token_urlsafe(24))")
keytool -genkeypair -keystore colaboradores.keystore -alias colaboradores -keyalg RSA \
  -keysize 3072 -validity 10000 -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=McKenna Group Colaboradores, O=McKenna Group S.A.S., C=CO"
printf "storeFile=colaboradores.keystore\nstorePassword=%s\nkeyAlias=colaboradores\nkeyPassword=%s\n" "$PASS" "$PASS" > keystore.properties
chmod 600 keystore.properties colaboradores.keystore
```

## Instalar en el celular del colaborador

Mandarle `McKenna_Colaboradores.apk` (WhatsApp o correo), abrirlo y permitir
«instalar apps de origen desconocido» para esa app. Entra con usuario y contraseña o con
Google (el login de Google se abre en el navegador y vuelve solo a la app).
