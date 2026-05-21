"""
supervisor_actions.py
Ejecuta acciones de automatización disparadas por comandos "Hugo ..." en el chat del supervisor.

Sintaxis reconocida:
  Hugo envía [mensaje de voz|nota de voz|audio] a <contacto> con: <texto>
  Hugo envía [mensaje|texto] a <contacto> con: <texto>
  Hugo agenda [nota de voz|mensaje] a <contacto> para <fecha/hora> con: <texto>
"""
import json
import os
import re
import base64
import subprocess
import tempfile
import requests as _req
from datetime import datetime, timedelta, date as _date

_DIR = os.path.dirname(__file__)
_REPO = os.path.normpath(os.path.join(_DIR, "..", ".."))
_CONTACTOS_PATH      = os.path.join(_REPO, "app", "data", "contactos_supervisor.json")
_GRUPOS_PATH         = os.path.join(_REPO, "app", "data", "grupos_whatsapp_oficiales.json")
_RECORDATORIOS_PATH  = os.path.join(_REPO, "app", "data", "recordatorios_programados.json")
_BOT_URL = "http://localhost:3000"

# Perfil Voicebox activo para TTS (Hugo Garcia)
_VOICEBOX_URL     = os.getenv("VOICEBOX_URL", "http://localhost:17493")
_VOICEBOX_PROFILE = "3762e0ae-ae88-4f5e-8d77-af4f8eb7cc23"  # Hugo Garcia


# ── Contactos ──────────────────────────────────────────────────────────────────

def _cargar_contactos() -> dict:
    try:
        return json.load(open(_CONTACTOS_PATH, encoding="utf-8"))
    except Exception:
        return {}


def _resolver_contacto(nombre: str) -> tuple[str, str] | tuple[None, None]:
    """Retorna (numero_o_jid, tipo) donde tipo es 'contacto' o 'grupo', o (None, None)."""
    clave = nombre.strip().lower()

    # 1. Buscar en contactos personales
    contactos = _cargar_contactos()
    numero = contactos.get(clave)
    if numero and "X" not in numero:
        return numero, "contacto"
    for k, v in contactos.items():
        if k != "_nota" and k.startswith(clave[:4]) and "X" not in v:
            return v, "contacto"

    # 2. Buscar en grupos WhatsApp
    try:
        grupos_raw = json.load(open(_GRUPOS_PATH, encoding="utf-8"))
        # Alias simples para grupos comunes
        _ALIAS_GRUPOS: dict[str, str] = {
            "preventa":     "Preventa_Meli",
            "postventa":    "Postventa_Meli",
            "posventa":     "Postventa_Meli",
            "inventario":   "Sincronizacion_Inventario",
            "contabilidad": "Facturacion_Compras_SIIGO",
            "pedidos":      "MCKG PEDIDOS / COMPRAS",
            "pedidosweb":   "Guias_Envios pagina web",
            "pedidos_web":  "Guias_Envios pagina web",
            "sistemas":     "Sincronizacion_Inventario",
            "sede":         "MCKG SEDE SUR",
            "sedesur":      "MCKG SEDE SUR",
            "sede_sur":     "MCKG SEDE SUR",
            "todos":        "MCKG SEDE SUR",
            "general":      "MCKG SEDE SUR",
        }
        buscar_nombre = _ALIAS_GRUPOS.get(clave, clave)

        todos_grupos = []
        excl = grupos_raw.get("pedidos_web_exclusivo")
        if excl:
            todos_grupos.append(excl)
        todos_grupos.extend(grupos_raw.get("grupos", []))

        for g in todos_grupos:
            nombre_g = g.get("nombre", "")
            if (buscar_nombre.lower() in nombre_g.lower()
                    or nombre_g.lower().startswith(clave[:6])
                    or clave in nombre_g.lower().replace(" ", "").replace("_", "")):
                return g["jid"], "grupo"
    except Exception:
        pass

    return None, None


# ── TTS con Voicebox/Qwen3 (voz clonada Hugo Garcia) ──────────────────────────

def _tts_voicebox(texto: str) -> bytes:
    """Genera WAV con Voicebox usando el perfil Hugo Garcia (Qwen3 1.7B)."""
    payload = {
        "profile_id": _VOICEBOX_PROFILE,
        "text":       texto,
        "language":   "es",
        "engine":     "qwen",
        "model_size": "1.7B",
    }
    r = _req.post(f"{_VOICEBOX_URL}/generate", json=payload, timeout=300)
    r.raise_for_status()
    gen_id = r.json()["id"]

    import time
    deadline = time.time() + 300
    while time.time() < deadline:
        hr = _req.get(f"{_VOICEBOX_URL}/history/{gen_id}", timeout=10)
        hr.raise_for_status()
        st = hr.json().get("status", "")
        if st == "completed":
            break
        if st in ("failed", "error"):
            raise RuntimeError(f"Voicebox falló: {hr.json().get('error')}")
        time.sleep(1.5)
    else:
        raise TimeoutError("Voicebox: timeout esperando generación")

    ar = _req.get(f"{_VOICEBOX_URL}/audio/{gen_id}", timeout=60)
    ar.raise_for_status()
    return ar.content  # WAV bytes


def _wav_to_ogg_opus(wav_bytes: bytes) -> bytes:
    """Convierte WAV a OGG/Opus con ffmpeg (formato que WhatsApp acepta como PTT)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wf:
        wf.write(wav_bytes)
        wav_path = wf.name

    ogg_path = wav_path.replace(".wav", ".ogg")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path,
             "-c:a", "libopus", "-b:a", "64k", "-ar", "48000",
             ogg_path],
            check=True, capture_output=True,
        )
        return open(ogg_path, "rb").read()
    finally:
        for p in (wav_path, ogg_path):
            try:
                os.unlink(p)
            except Exception:
                pass


# ── Envío WhatsApp ─────────────────────────────────────────────────────────────

def _enviar_ptt(numero: str, ogg_bytes: bytes) -> bool:
    audio_b64 = base64.b64encode(ogg_bytes).decode()
    r = _req.post(
        f"{_BOT_URL}/enviar-ptt",
        json={"numero": numero, "audioBase64": audio_b64, "mimeType": "audio/ogg; codecs=opus"},
        timeout=30,
    )
    return r.ok


def _enviar_texto(numero: str, texto: str) -> bool:
    r = _req.post(
        f"{_BOT_URL}/enviar",
        json={"numero": numero, "mensaje": texto},
        timeout=30,
    )
    return r.ok


# ── Recordatorios programados ──────────────────────────────────────────────────

_DIAS_SEMANA = {
    "lunes": 0, "martes": 1, "miercoles": 2, "miércoles": 2,
    "jueves": 3, "viernes": 4, "sabado": 5, "sábado": 5, "domingo": 6,
}
_MESES_ES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
_DIAS_ES   = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES_NOM = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
              "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _parsear_fecha_hora(texto: str) -> datetime | None:
    """Parsea expresiones de fecha/hora en español. Devuelve datetime o None."""
    s = texto.lower().strip()
    ahora = datetime.now()

    # ── Hora (requiere "a las N" o "Nam/pm" para no confundir con números de día) ──
    hora_t: tuple[int, int] | None = None

    # "a las 10", "a las 10:30", "a las 10am", "a las 10:30pm"
    m_h = re.search(r"a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", s)
    if m_h:
        h = int(m_h.group(1))
        mins = int(m_h.group(2) or 0)
        ap = (m_h.group(3) or "").lower()
        if ap == "pm" and h < 12:
            h += 12
        elif ap == "am" and h == 12:
            h = 0
        if 0 <= h <= 23 and 0 <= mins <= 59:
            hora_t = (h, mins)

    # "10am", "3pm", "10:30am", "3:30pm" — sin "a las" pero con am/pm explícito
    if hora_t is None:
        m_h2 = re.search(r"(?<!\d)(\d{1,2})(?::(\d{2}))?\s*(am|pm)", s)
        if m_h2:
            h = int(m_h2.group(1))
            mins = int(m_h2.group(2) or 0)
            ap = m_h2.group(3).lower()
            if ap == "pm" and h < 12:
                h += 12
            elif ap == "am" and h == 12:
                h = 0
            if 0 <= h <= 23 and 0 <= mins <= 59:
                hora_t = (h, mins)

    # ── Fecha base ──
    fecha_base: _date | None = None

    if "hoy" in s:
        fecha_base = ahora.date()
    elif "pasado mañana" in s or "pasado manana" in s:
        fecha_base = (ahora + timedelta(days=2)).date()
    elif "mañana" in s or "manana" in s:
        fecha_base = (ahora + timedelta(days=1)).date()
    else:
        # Día de la semana: "el martes", "este viernes"
        for dia, num in _DIAS_SEMANA.items():
            if re.search(r'\b' + dia + r'\b', s):
                days_ahead = (num - ahora.weekday()) % 7
                if days_ahead == 0:
                    days_ahead = 7
                fecha_base = (ahora + timedelta(days=days_ahead)).date()
                break

    if fecha_base is None:
        # Número de día: "el 25", "el 25 de junio", "25 de mayo"
        m_d = re.search(r'\b(\d{1,2})\s+de\s+(\w+)', s)
        if not m_d:
            m_d = re.search(r'\bel\s+(\d{1,2})\b', s)
            if m_d:
                dia_num = int(m_d.group(1))
                mes_num = None
            else:
                dia_num = None
                mes_num = None
        else:
            dia_num = int(m_d.group(1))
            mes_num = _MESES_ES.get(m_d.group(2).lower())

        if dia_num:
            try:
                if mes_num:
                    year = ahora.year
                    cand = _date(year, mes_num, dia_num)
                    if cand <= ahora.date():
                        cand = _date(year + 1, mes_num, dia_num)
                    fecha_base = cand
                else:
                    y, mo = ahora.year, ahora.month
                    cand = _date(y, mo, dia_num)
                    if cand <= ahora.date():
                        mo += 1
                        if mo > 12:
                            mo, y = 1, y + 1
                        cand = _date(y, mo, dia_num)
                    fecha_base = cand
            except ValueError:
                pass

    if fecha_base is None:
        return None

    if hora_t:
        h, m = hora_t
        try:
            return datetime(fecha_base.year, fecha_base.month, fecha_base.day, h, m)
        except ValueError:
            return None
    # Sin hora → 9 AM por defecto
    return datetime(fecha_base.year, fecha_base.month, fecha_base.day, 9, 0)


def _formatear_fecha_es(dt: datetime) -> str:
    dia_s = _DIAS_ES[dt.weekday()]
    mes_s = _MESES_NOM[dt.month - 1]
    hora_s = f"{dt.hour:02d}:{dt.minute:02d}"
    return f"{dia_s} {dt.day} de {mes_s} a las {hora_s}"


def _cargar_recordatorios() -> dict:
    try:
        return json.load(open(_RECORDATORIOS_PATH, encoding="utf-8"))
    except Exception:
        return {"recordatorios": []}


def _guardar_recordatorios(data: dict) -> None:
    with open(_RECORDATORIOS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def verificar_y_disparar_recordatorios() -> None:
    """Llamado por monitor.py cada minuto. Ejecuta recordatorios vencidos."""
    try:
        data = _cargar_recordatorios()
        ahora = datetime.now()
        modificado = False

        for r in data.get("recordatorios", []):
            if r.get("ejecutado"):
                continue
            try:
                ejecutar_en = datetime.fromisoformat(r["ejecutar_en"])
            except Exception:
                continue
            if ahora >= ejecutar_en:
                cmd = {
                    "accion":    r["accion"],
                    "contacto":  r["contacto"],
                    "numero":    r["numero"],
                    "tipo_dest": r.get("tipo_dest", "contacto"),
                    "texto":     r["texto"],
                    "error":     None,
                }
                try:
                    resultado = ejecutar_accion(cmd)
                except Exception as exc:
                    resultado = f"Error al ejecutar recordatorio: {exc}"
                r["ejecutado"] = True
                r["resultado"] = resultado[:300]
                modificado = True
                print(f"⏰ Recordatorio ejecutado: {r['id']} → {resultado[:80]}")

        if modificado:
            _guardar_recordatorios(data)
    except Exception as e:
        print(f"❌ Error verificando recordatorios: {e}")


# ── Parser de intención ────────────────────────────────────────────────────────

_PATRON_HUGO = re.compile(
    r"hugo\s+"
    r"(?:env[ií]a|manda|dile|escribe)\s+"
    r"(?:un\s+)?(?P<tipo>[\w\s]+?)\s+"
    r"(?:a|al)\s+(?:(?:grupo|el|la|los|las)\s+)?(?P<contacto>\w+)\s+"
    r"con:\s*(?P<texto>.+)",
    re.IGNORECASE | re.DOTALL,
)

# "Hugo agenda nota de voz a todos para el martes 25 a las 10am con: ..."
_PATRON_HUGO_AGENDA = re.compile(
    r"hugo\s+"
    r"(?:agenda|programa|agend[aá]|program[aá]|recuérdame|recuerdame)\s+"
    r"(?:un\s+)?(?P<tipo>[\w\s]+?)\s+"
    r"(?:a|al)\s+(?:(?:grupo|el|la|los|las)\s+)?(?P<contacto>\w+)\s+"
    r"para\s+(?P<cuando>.+?)\s+con:\s*(?P<texto>.+)",
    re.IGNORECASE | re.DOTALL,
)

_VOZ_KEYWORDS = {"voz", "audio", "nota", "ptt"}


def interpretar_comando(mensaje: str) -> dict | None:
    msg = mensaje.strip()
    if not msg.lower().startswith("hugo"):
        return None

    # ── Comando de agenda (scheduleo) ──
    m_a = _PATRON_HUGO_AGENDA.search(msg)
    if m_a:
        tipo_raw = m_a.group("tipo").lower().strip()
        contacto = m_a.group("contacto").strip()
        cuando   = m_a.group("cuando").strip()
        texto    = m_a.group("texto").strip()
        es_voz   = any(k in tipo_raw for k in _VOZ_KEYWORDS)
        accion   = "voz" if es_voz else "texto"
        numero, tipo_dest = _resolver_contacto(contacto)

        if not numero:
            return {
                "accion": accion, "contacto": contacto, "numero": None, "tipo_dest": None,
                "texto": texto, "modo": "agenda",
                "error": (
                    f"'{contacto}' no encontrado en contactos ni en grupos.\n"
                    f"Grupos disponibles: preventa, postventa, inventario, contabilidad, pedidos, pedidosweb, sede"
                ),
            }

        ejecutar_en = _parsear_fecha_hora(cuando)
        if not ejecutar_en:
            return {
                "accion": accion, "contacto": contacto, "numero": numero,
                "tipo_dest": tipo_dest, "texto": texto, "modo": "agenda",
                "error": (
                    f"No entendí la fecha/hora: '{cuando}'.\n"
                    f"Prueba: 'para mañana a las 10am', 'para el martes a las 3pm' o 'para el 25 de junio a las 9am'"
                ),
            }

        return {
            "accion": accion, "contacto": contacto, "numero": numero,
            "tipo_dest": tipo_dest, "texto": texto,
            "modo": "agenda", "ejecutar_en": ejecutar_en.isoformat(),
            "error": None,
        }

    # ── Comando de envío inmediato ──
    m = _PATRON_HUGO.search(msg)
    if not m:
        return None

    tipo_raw = m.group("tipo").lower().strip()
    contacto = m.group("contacto").strip()
    texto    = m.group("texto").strip()
    es_voz   = any(k in tipo_raw for k in _VOZ_KEYWORDS)
    accion   = "voz" if es_voz else "texto"
    numero, tipo_dest = _resolver_contacto(contacto)

    if not numero:
        return {
            "accion": accion, "contacto": contacto, "numero": None, "tipo_dest": None,
            "texto": texto,
            "error": (
                f"'{contacto}' no encontrado en contactos ni en grupos.\n"
                f"Contactos: edita `app/data/contactos_supervisor.json`\n"
                f"Grupos disponibles: preventa, postventa, inventario, contabilidad, pedidos, pedidosweb"
            ),
        }

    return {"accion": accion, "contacto": contacto, "numero": numero,
            "tipo_dest": tipo_dest, "texto": texto, "error": None}


def ejecutar_accion(cmd: dict) -> str:
    if cmd.get("error"):
        return (
            f"No pude ejecutar la acción: {cmd['error']}\n\n"
            f'Ejemplo: `"{cmd["contacto"].lower()}": "57300XXXXXXX"`'
        )

    # ── Agendar para después ──────────────────────────────────────────────────
    if cmd.get("modo") == "agenda":
        ejecutar_en = datetime.fromisoformat(cmd["ejecutar_en"])
        data = _cargar_recordatorios()
        rid = f"r_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        data["recordatorios"].append({
            "id":          rid,
            "accion":      cmd["accion"],
            "contacto":    cmd["contacto"],
            "numero":      cmd["numero"],
            "tipo_dest":   cmd.get("tipo_dest", "contacto"),
            "texto":       cmd["texto"],
            "ejecutar_en": cmd["ejecutar_en"],
            "creado_en":   datetime.now().isoformat(),
            "ejecutado":   False,
        })
        _guardar_recordatorios(data)
        tipo_dest_a = cmd.get("tipo_dest", "contacto")
        dest_lbl = f"grupo **{cmd['contacto']}**" if tipo_dest_a == "grupo" else f"**{cmd['contacto']}**"
        tipo_msg = "nota de voz" if cmd["accion"] == "voz" else "mensaje de texto"
        fecha_s  = _formatear_fecha_es(ejecutar_en)
        preview  = cmd["texto"][:100] + ("..." if len(cmd["texto"]) > 100 else "")
        return (
            f"⏰ *Recordatorio agendado*\n"
            f"📨 Tipo: {tipo_msg} al {dest_lbl}\n"
            f"📅 Se enviará el {fecha_s}\n"
            f"💬 _{preview}_\n"
            f"🔖 ID: `{rid}`"
        )

    # ── Envío inmediato ───────────────────────────────────────────────────────
    numero    = cmd["numero"]
    texto     = cmd["texto"]
    contacto  = cmd["contacto"]
    tipo_dest = cmd.get("tipo_dest", "contacto")
    destino_label = f"grupo **{contacto}**" if tipo_dest == "grupo" else f"**{contacto}**"

    if cmd["accion"] == "voz":
        try:
            wav = _tts_voicebox(texto)
        except Exception as exc:
            return f"TTS Voicebox (Hugo Garcia) falló: {exc}"
        try:
            ogg = _wav_to_ogg_opus(wav)
        except Exception as exc:
            return f"Conversión WAV→OGG falló: {exc}"
        try:
            ok = _enviar_ptt(numero, ogg)
            if ok:
                return (f"Nota de voz enviada al {destino_label} (`{numero}`) "
                        f"con voz de Hugo Garcia (Qwen3 1.7B):\n_{texto}_")
            return "OGG generado pero falló el envío al bridge WhatsApp."
        except Exception as exc:
            return f"Error enviando PTT: {exc}"

    elif cmd["accion"] == "texto":
        try:
            ok = _enviar_texto(numero, texto)
            if ok:
                return f"Mensaje enviado al {destino_label} (`{numero}`):\n_{texto}_"
            return "Falló el envío al bridge WhatsApp."
        except Exception as exc:
            return f"Error al enviar mensaje: {exc}"

    return "Acción no reconocida."
