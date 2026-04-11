"""
REC-07: Respaldo Automático Nocturno en Google Drive
Cada noche a las 2 AM comprime y sube a Drive:
  - app/data/*.json
  - app/*.db (SQLite)
  - memoria_vectorial/ (ChromaDB)

Tras el backup intenta commit + push a GitHub si hay cambios (AGENTE_NIGHTLY_GIT_PUSH=1).
Los avisos van a GRUPO_ALERTAS_SISTEMAS_WA (ver app.utils.jid_grupo_alertas_sistemas_wa).
"""

import os
import io
import tarfile
import threading
import time
import subprocess
from datetime import datetime
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    str(_REPO_ROOT / "mi-agente-ubuntu-9043f67d9755.json"),
)
DRIVE_FOLDER = os.getenv("DRIVE_BACKUP_FOLDER_ID", "")  # ID carpeta Drive para backups

ARCHIVOS_BACKUP = [
    str(_REPO_ROOT / "app/data"),
    str(_REPO_ROOT / "app/training"),
    str(_REPO_ROOT / "memoria_vectorial"),
]
ARCHIVOS_DB = [
    str(_REPO_ROOT / "app/data/clientes.db"),
    str(_REPO_ROOT / "app/data/seguimiento_postventa.db"),
    str(_REPO_ROOT / "app/data/despachos.db"),
    str(_REPO_ROOT / "app/tools/memoria.db"),
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


def _sincronizar_git_github() -> dict:
    """
    git add -A, commit, push al remoto `origin` en la rama actual, solo si hay cambios.
    Desactivar con AGENTE_NIGHTLY_GIT_PUSH=0.
    """
    if os.getenv("AGENTE_NIGHTLY_GIT_PUSH", "1").strip().lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return {"ok": True, "action": "disabled", "mensaje": "push nocturno desactivado"}

    repo = str(_REPO_ROOT)
    if not os.path.isdir(os.path.join(repo, ".git")):
        return {"ok": True, "action": "no_git", "mensaje": "sin repositorio .git"}

    def run_git(args: list, timeout: int = 90) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", repo] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    try:
        st = run_git(["status", "--porcelain"])
    except subprocess.TimeoutExpired:
        return {"ok": False, "action": "error", "error": "git status timeout"}
    if st.returncode != 0:
        return {
            "ok": False,
            "action": "error",
            "error": (st.stderr or st.stdout or "git status")[:400],
        }
    if not st.stdout.strip():
        return {"ok": True, "action": "sin_cambios", "mensaje": "sin cambios en el repo"}

    try:
        add = run_git(["add", "-A"])
    except subprocess.TimeoutExpired:
        return {"ok": False, "action": "error", "error": "git add timeout"}
    if add.returncode != 0:
        return {
            "ok": False,
            "action": "error",
            "error": (add.stderr or add.stdout or "git add")[:400],
        }

    fecha = datetime.now().strftime("%Y-%m-%d %H:%M")
    try:
        commit = run_git(["commit", "-m", f"Auto-commit: backup nocturno {fecha}"])
    except subprocess.TimeoutExpired:
        return {"ok": False, "action": "error", "error": "git commit timeout"}
    out = (commit.stdout or "") + (commit.stderr or "")
    if commit.returncode != 0:
        low = out.lower()
        if "nothing to commit" in low or "nada para hacer commit" in low:
            return {"ok": True, "action": "sin_cambios", "mensaje": "nada que commitear"}
        return {"ok": False, "action": "commit_fail", "error": out[:500]}

    try:
        br = run_git(["rev-parse", "--abbrev-ref", "HEAD"])
        branch = (br.stdout or "HEAD").strip() or "HEAD"
        push = run_git(["push", "origin", branch], timeout=180)
    except subprocess.TimeoutExpired:
        return {"ok": False, "action": "push_fail", "error": "git push timeout"}
    if push.returncode != 0:
        err = (push.stderr or push.stdout or "")[:500]
        return {
            "ok": False,
            "action": "push_fail",
            "error": err,
            "branch": branch,
        }
    return {
        "ok": True,
        "action": "push_ok",
        "branch": branch,
        "mensaje": f"push origin {branch}",
    }


def ejecutar_backup() -> dict:
    """
    Crea el backup y lo sube a Google Drive.
    Si no hay DRIVE_FOLDER_ID configurado, lo guarda localmente en backups_drive/.
    """
    ahora = datetime.now()
    nombre = f"backup_hugo_{ahora.strftime('%Y%m%d_%H%M%S')}.tar.gz"
    carpeta = str(_REPO_ROOT / "backups_drive")
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

                creds = sa.Credentials.from_service_account_file(
                    CREDS_PATH,
                    scopes=["https://www.googleapis.com/auth/drive.file"],
                )
                service = build("drive", "v3", credentials=creds)
                meta = {"name": nombre, "parents": [DRIVE_FOLDER]}
                media = MediaIoBaseUpload(io.BytesIO(datos), mimetype="application/gzip")
                service.files().create(body=meta, media_body=media, fields="id").execute()
                subido_drive = True
                print("☁️ [BACKUP] Subido a Google Drive correctamente")
            except Exception as e:
                print(f"⚠️ [BACKUP] No se pudo subir a Drive: {e}")
        else:
            print("ℹ️ [BACKUP] DRIVE_BACKUP_FOLDER_ID no configurado — solo backup local")

        # Limpiar backups locales con más de 7 días
        _limpiar_backups_antiguos(carpeta, dias=7)

        return {
            "ok": True,
            "archivo": nombre,
            "tamaño_kb": len(datos) // 1024,
            "drive": subido_drive,
        }

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


def _linea_git_whatsapp(git: dict) -> str:
    if git.get("action") == "disabled":
        return "📝 *Git:* desactivado (`AGENTE_NIGHTLY_GIT_PUSH=0`)"
    if git.get("action") == "no_git":
        return "📝 *Git:* (sin `.git` en el proyecto)"
    if git.get("action") == "sin_cambios":
        return "📝 *Git:* sin cambios pendientes"
    if git.get("action") == "push_ok":
        return f"📝 *Git:* ✅ {git.get('mensaje', 'push OK')}"
    err = (git.get("error") or "error")[:200]
    if git.get("action") == "push_fail":
        return f"📝 *Git:* ⚠️ push falló — {err}"
    if git.get("action") == "commit_fail":
        return f"📝 *Git:* ⚠️ commit falló — {err}"
    return f"📝 *Git:* ⚠️ {err}"


def iniciar_backup_nocturno():
    """Daemon que ejecuta el backup todos los días a las 2 AM."""
    def _loop():
        ultimo_dia = -1
        time.sleep(60)
        while True:
            ahora = datetime.now()
            if ahora.hour == 2 and ahora.day != ultimo_dia:
                resultado = ejecutar_backup()
                git_info = _sincronizar_git_github()
                ultimo_dia = ahora.day
                try:
                    from app.utils import (
                        enviar_whatsapp_reporte,
                        jid_grupo_alertas_sistemas_wa,
                    )

                    destino = jid_grupo_alertas_sistemas_wa()
                    git_linea = _linea_git_whatsapp(git_info)

                    if resultado["ok"]:
                        enviar_whatsapp_reporte(
                            f"💾 *Backup nocturno completado*\n"
                            f"📁 Archivo: `{resultado['archivo']}`\n"
                            f"📊 Tamaño: {resultado['tamaño_kb']} KB\n"
                            f"☁️ Drive: {'✅' if resultado.get('drive') else '📁 Solo local'}\n"
                            f"{git_linea}",
                            numero_destino=destino,
                        )
                    else:
                        enviar_whatsapp_reporte(
                            f"⚠️ *Backup fallido:* {resultado.get('error', '')}\n"
                            f"{git_linea}",
                            numero_destino=destino,
                        )
                except Exception:
                    pass
            time.sleep(60)

    t = threading.Thread(target=_loop, daemon=True, name="backup-nocturno")
    t.start()
    print("✅ Backup nocturno programado para las 2 AM")
