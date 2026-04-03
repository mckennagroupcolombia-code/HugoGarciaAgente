"""
REC-07: Respaldo Automático Nocturno en Google Drive
Cada noche a las 2 AM comprime y sube a Drive:
  - app/data/*.json
  - app/*.db (SQLite)
  - memoria_vectorial/ (ChromaDB)
"""

import os
import io
import tarfile
import threading
import time
from datetime import datetime

CREDS_PATH   = os.getenv("GOOGLE_SERVICE_ACCOUNT_PATH",
                          "/home/mckg/mi-agente/mi-agente-ubuntu-9043f67d9755.json")
DRIVE_FOLDER = os.getenv("DRIVE_BACKUP_FOLDER_ID", "")   # ID carpeta Drive para backups

ARCHIVOS_BACKUP = [
    "/home/mckg/mi-agente/app/data",
    "/home/mckg/mi-agente/app/training",
    "/home/mckg/mi-agente/memoria_vectorial",
]
ARCHIVOS_DB = [
    "/home/mckg/mi-agente/app/data/clientes.db",
    "/home/mckg/mi-agente/app/data/seguimiento_postventa.db",
    "/home/mckg/mi-agente/app/data/despachos.db",
    "/home/mckg/mi-agente/app/tools/memoria.db",
]


def _crear_tar_en_memoria() -> bytes:
    """Crea un .tar.gz en memoria con todos los archivos críticos."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for ruta in ARCHIVOS_BACKUP:
            if os.path.exists(ruta):
                tar.add(ruta, arcname=os.path.basename(ruta))
        for db in ARCHIVOS_DB:
            if os.path.exists(db):
                tar.add(db, arcname=os.path.basename(db))
    return buf.getvalue()


def ejecutar_backup() -> dict:
    """
    Crea el backup y lo sube a Google Drive.
    Si no hay DRIVE_FOLDER_ID configurado, lo guarda localmente en backups/.
    """
    ahora    = datetime.now()
    nombre   = f"backup_hugo_{ahora.strftime('%Y%m%d_%H%M%S')}.tar.gz"
    carpeta  = "/home/mckg/mi-agente/backups_drive"
    os.makedirs(carpeta, exist_ok=True)

    print(f"💾 [BACKUP] Iniciando respaldo — {ahora.strftime('%d/%m/%Y %H:%M')}")

    try:
        datos = _crear_tar_en_memoria()
        ruta_local = os.path.join(carpeta, nombre)

        # Siempre guardar local
        with open(ruta_local, "wb") as f:
            f.write(datos)
        print(f"💾 [BACKUP] Guardado local: {ruta_local} ({len(datos)//1024} KB)")

        # Subir a Drive si hay credenciales y folder configurado
        subido_drive = False
        if os.path.exists(CREDS_PATH) and DRIVE_FOLDER:
            try:
                import google.oauth2.service_account as sa
                from googleapiclient.discovery import build
                from googleapiclient.http import MediaIoBaseUpload

                creds   = sa.Credentials.from_service_account_file(
                    CREDS_PATH,
                    scopes=["https://www.googleapis.com/auth/drive.file"]
                )
                service = build("drive", "v3", credentials=creds)
                meta    = {"name": nombre, "parents": [DRIVE_FOLDER]}
                media   = MediaIoBaseUpload(io.BytesIO(datos), mimetype="application/gzip")
                service.files().create(body=meta, media_body=media, fields="id").execute()
                subido_drive = True
                print(f"☁️ [BACKUP] Subido a Google Drive correctamente")
            except Exception as e:
                print(f"⚠️ [BACKUP] No se pudo subir a Drive: {e}")
        else:
            print("ℹ️ [BACKUP] DRIVE_BACKUP_FOLDER_ID no configurado — solo backup local")

        # Limpiar backups locales con más de 7 días
        _limpiar_backups_antiguos(carpeta, dias=7)

        return {"ok": True, "archivo": nombre, "tamaño_kb": len(datos)//1024,
                "drive": subido_drive}

    except Exception as e:
        print(f"❌ [BACKUP] Error: {e}")
        return {"ok": False, "error": str(e)}


def _limpiar_backups_antiguos(carpeta: str, dias: int = 7):
    """Elimina backups locales de más de `dias` días."""
    import time as _time
    limite = _time.time() - dias * 86400
    eliminados = 0
    for f in os.listdir(carpeta):
        ruta = os.path.join(carpeta, f)
        if os.path.isfile(ruta) and os.path.getmtime(ruta) < limite:
            os.remove(ruta)
            eliminados += 1
    if eliminados:
        print(f"🗑️ [BACKUP] {eliminados} backup(s) antiguo(s) eliminado(s)")


def iniciar_backup_nocturno():
    """Daemon que ejecuta el backup todos los días a las 2 AM."""
    def _loop():
        ultimo_dia = -1
        time.sleep(60)
        while True:
            ahora = datetime.now()
            if ahora.hour == 2 and ahora.day != ultimo_dia:
                resultado = ejecutar_backup()
                ultimo_dia = ahora.day
                try:
                    from app.utils import enviar_whatsapp_reporte
                    if resultado["ok"]:
                        enviar_whatsapp_reporte(
                            f"💾 *Backup nocturno completado*\n"
                            f"📁 Archivo: {resultado['archivo']}\n"
                            f"📊 Tamaño: {resultado['tamaño_kb']} KB\n"
                            f"☁️ Drive: {'✅' if resultado.get('drive') else '📁 Solo local'}"
                        )
                    else:
                        enviar_whatsapp_reporte(f"⚠️ *Backup fallido:* {resultado.get('error','')}")
                except Exception:
                    pass
            time.sleep(60)

    t = threading.Thread(target=_loop, daemon=True, name="backup-nocturno")
    t.start()
    print("✅ Backup nocturno programado para las 2 AM")
