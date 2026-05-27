# Instalar McKenna APK en Xiaomi (MIUI / HyperOS)

## Error `INSTALL_FAILED_USER_RESTRICTED`

MIUI bloquea `adb install` aunque la depuración USB esté activa.

### En el teléfono

1. **Ajustes → Ajustes adicionales → Opciones de desarrollador**
2. Activa **Depuración USB** (ya la tienes).
3. Activa **Instalar vía USB** (o **Depuración USB (configuración de seguridad)**).
4. Conecta el cable; si sale **¿Permitir depuración USB?** → **Permitir** y **Siempre**.
5. Al ejecutar `adb install`, mira el teléfono: puede aparecer **¿Permitir instalar esta aplicación?** → **Permitir**.

Si sigue fallando:

- **Ajustes → Privacidad → Permisos especiales → Instalar aplicaciones desconocidas** → **Archivos** / **Explorador** → permitir.
- Desactiva temporalmente **Optimización MIUI** (opciones de desarrollador).
- Reinicia el teléfono y el cable USB.

### Instalar sin `adb` (recomendado en Xiaomi)

1. En la PC:
   ```bash
   cd ~/mi-agente/android-twa
   ./gradlew assembleRelease
   ./scripts/firmar_apk.sh
   ```
2. Copia `McKenna_Group_latest.apk` al teléfono (USB MTP o Telegram/Drive).
3. En el teléfono abre el APK con **Archivos** y confirma instalar.

### Con adb (cuando MIUI lo permita)

```bash
adb install -r ~/mi-agente/android-twa/McKenna_Group_latest.apk
```
