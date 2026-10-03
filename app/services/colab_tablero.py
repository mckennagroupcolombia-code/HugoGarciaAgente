"""Tablero del proyecto de Colaboradores (3-oct-2026).

Por qué existe. El edificio (colaboradores.py) se pensó como el Mapa de la empresa: pisos con
módulos reales adentro. Entre Armando y un colaborador no hay módulos: hay una conversación que va
dejando ideas, pruebas, decisiones y tropiezos. En el edificio eso terminaba como cajas sueltas
«tipo acción» (27 cajas, 0 flechas, consenso vacío en el primer proyecto) mientras lo que de verdad
pasaba —los aros equivocados, el broche que se abre, la publicación activa, la primera venta— se
quedaba en WhatsApp.

El tablero responde, en este orden: de dónde partimos, cuál es la meta, quién hace qué, qué
resultados hay, qué obstáculos siguen abiertos, qué se decidió, qué sigue y a quién le toca, y el
ritmo (cuánto tarda cada uno desde que ve lo del otro hasta que responde).

**Unidad: la tarjeta** (una fila de `colab_tarjetas`, no un documento entero): cada una se edita por
separado, así dos personas trabajando a la vez no se pisan ni hace falta combinar documentos.
Enlaces entre tarjetas (viene de / resuelve / bloquea), capturas pegadas y la cita textual del chat
de donde salió (`fuente`).

**Ritmo**: `colab_eventos` guarda cada «escribió» y el primer «vio» después de algo nuevo del otro.
De ahí sale «tardó en verlo» y «tardó en responder desde que lo vio».

**Chat de WhatsApp**: se lee para convertir mensajes en tarjetas uno por uno; el texto del chat NO
se guarda (mezcla el proyecto con la vida personal de cada uno). Solo se pueden guardar los
números agregados del ritmo, sin contenido.

Sin LLM.
"""

from __future__ import annotations

import io
import json
import re
import statistics
import zipfile
from datetime import datetime, timezone

from app.services import colaboradores as col

TIPOS = {
    "origen": "Punto de partida",
    "meta": "Meta",
    "rol": "Quién hace qué",
    "resultado": "Resultado",
    "obstaculo": "Obstáculo",
    "decision": "Decisión",
    "tarea": "Próxima jugada",
    "idea": "Idea",
    "acuerdo": "Acuerdo",
}
ESTADOS = ("abierto", "hecho", "descartado")
RELACIONES = ("viene_de", "resuelve", "bloquea")
MAX_TARJETAS = 500
MAX_ADJUNTOS = 12
MAX_ENLACES = 12
# Un «vio» sin nada nuevo del otro no aporta: se guarda solo el primero tras cada novedad.
_VISTO_MIN_SEG = 60


def _ensure() -> None:
    col._ensure()
    with col._conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS colab_tarjetas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagrama_id INTEGER NOT NULL,
                tipo TEXT NOT NULL,
                titulo TEXT NOT NULL DEFAULT '',
                texto TEXT NOT NULL DEFAULT '',
                porque TEXT NOT NULL DEFAULT '',
                estado TEXT NOT NULL DEFAULT 'abierto',
                turno_de INTEGER,
                turno_desde TEXT,
                fecha_hecho TEXT,
                fuente_json TEXT NOT NULL DEFAULT '',
                adjuntos_json TEXT NOT NULL DEFAULT '[]',
                enlaces_json TEXT NOT NULL DEFAULT '[]',
                acuerdos_json TEXT NOT NULL DEFAULT '{}',
                orden REAL NOT NULL DEFAULT 0,
                creado_por INTEGER,
                creado_en TEXT NOT NULL DEFAULT (datetime('now')),
                actualizado_por INTEGER,
                actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
                borrado INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS ix_colab_tarjetas_d ON colab_tarjetas (diagrama_id, borrado);
            CREATE TABLE IF NOT EXISTS colab_eventos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagrama_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                tipo TEXT NOT NULL,
                tarjeta_id INTEGER,
                en TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS ix_colab_eventos_d ON colab_eventos (diagrama_id, en);
            CREATE TABLE IF NOT EXISTS colab_ritmo_chat (
                diagrama_id INTEGER PRIMARY KEY,
                datos_json TEXT NOT NULL,
                actualizado_por INTEGER,
                actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
            );
        """)


# ─── Saneo ───────────────────────────────────────────────────────────────────

def _utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ahora() -> str:
    """UTC, en el mismo formato que `datetime('now')` de SQLite (eventos, creado_en…)."""
    return _utc().strftime("%Y-%m-%d %H:%M:%S")


def _fecha(v) -> str | None:
    """'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM[:SS]'; cualquier otra cosa → None."""
    s = str(v or "").strip().replace("T", " ")[:19]
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime(fmt)
        except ValueError:
            continue
    return None


def _participante(did: int, v) -> int | None:
    try:
        uid = int(v)
    except (TypeError, ValueError):
        return None
    return uid if uid in _pareja(did) else None


def _pareja(did: int) -> list[int]:
    with col._conn() as con:
        r = con.execute("SELECT colaborador_id FROM colab_diagramas WHERE id=?", (int(did),)).fetchone()
    return col._participantes_ids(r["colaborador_id"] if r else None)


def _adjuntos(did: int, v) -> list[dict]:
    out = []
    for a in (v if isinstance(v, list) else [])[:MAX_ADJUNTOS]:
        if not isinstance(a, dict):
            continue
        mid = str(a.get("id") or "")
        if not col.media_de_diagrama(mid, did):        # solo media de ESTE proyecto
            continue
        out.append({"id": mid, "tipo": a.get("tipo") if a.get("tipo") in col.MEDIA_TIPOS else "imagen",
                    "nombre": col._texto(a.get("nombre"), 120)})
    return out


def _enlaces(v, ids_validos: set[int], propio: int | None) -> list[dict]:
    out, vistos = [], set()
    for e in (v if isinstance(v, list) else []):
        if not isinstance(e, dict) or e.get("rel") not in RELACIONES:
            continue
        try:
            a = int(e.get("a"))
        except (TypeError, ValueError):
            continue
        if a not in ids_validos or a == propio or (a, e["rel"]) in vistos:
            continue
        vistos.add((a, e["rel"]))
        out.append({"a": a, "rel": e["rel"]})
        if len(out) >= MAX_ENLACES:
            break
    return out


def _fuente(v) -> str:
    """La cita del chat de donde salió la tarjeta: quién, cuándo y el texto tal cual."""
    if not isinstance(v, dict):
        return ""
    texto = col._texto(v.get("texto"), 2000)
    if not texto:
        return ""
    return json.dumps({"canal": col._texto(v.get("canal") or "whatsapp", 20),
                       "autor": col._texto(v.get("autor"), 80),
                       "fecha": _fecha(v.get("fecha")) or "",
                       "texto": texto}, ensure_ascii=False)


def _a_dict(r) -> dict:
    d = dict(r)
    d["fuente"] = json.loads(d.pop("fuente_json") or "null") if d.get("fuente_json") else None
    d["adjuntos"] = json.loads(d.pop("adjuntos_json") or "[]")
    d["enlaces"] = json.loads(d.pop("enlaces_json") or "[]")
    d["acuerdos"] = json.loads(d.pop("acuerdos_json") or "{}")
    d.pop("borrado", None)
    return d


# ─── Tarjetas ────────────────────────────────────────────────────────────────

def listar(did: int) -> list[dict]:
    _ensure()
    with col._conn() as con:
        filas = con.execute("SELECT * FROM colab_tarjetas WHERE diagrama_id=? AND borrado=0"
                            " ORDER BY orden, id", (int(did),)).fetchall()
    return [_a_dict(f) for f in filas]


def _ids(con, did: int) -> set[int]:
    return {int(r["id"]) for r in con.execute(
        "SELECT id FROM colab_tarjetas WHERE diagrama_id=? AND borrado=0", (int(did),))}


def _registrar(con, did: int, uid: int, tipo: str, tarjeta_id: int | None = None) -> None:
    con.execute("INSERT INTO colab_eventos (diagrama_id, usuario_id, tipo, tarjeta_id) VALUES (?,?,?,?)",
                (int(did), int(uid), tipo, tarjeta_id))
    con.execute("UPDATE colab_diagramas SET actualizado_por=?, actualizado_en=datetime('now') WHERE id=?",
                (int(uid), int(did)))


def _otro(did: int, uid: int) -> int | None:
    resto = [p for p in _pareja(did) if p != int(uid)]
    return resto[0] if resto else None


def crear(did: int, uid: int, datos: dict, *, registrar: bool = True) -> dict:
    _ensure()
    tipo = datos.get("tipo")
    if tipo not in TIPOS:
        raise ValueError("Tipo de tarjeta no válido")
    titulo = col._texto(datos.get("titulo"), 200)
    texto = col._texto(datos.get("texto"), 4000)
    if not titulo and not texto:
        raise ValueError("La tarjeta necesita un título o un texto")
    with col._conn() as con:
        if len(_ids(con, did)) >= MAX_TARJETAS:
            raise ValueError(f"El tablero ya tiene {MAX_TARJETAS} tarjetas")
        # Por defecto la jugada es del otro: quien escribe deja la pelota en su cancha.
        turno = _participante(did, datos["turno_de"]) if "turno_de" in datos else (
            _otro(did, uid) if tipo in ("obstaculo", "decision", "tarea") else None)
        estado = datos.get("estado") if datos.get("estado") in ESTADOS else "abierto"
        orden = con.execute("SELECT COALESCE(MAX(orden),0)+1 o FROM colab_tarjetas WHERE diagrama_id=?",
                            (int(did),)).fetchone()["o"]
        cur = con.execute(
            "INSERT INTO colab_tarjetas (diagrama_id, tipo, titulo, texto, porque, estado, turno_de, turno_desde,"
            " fecha_hecho, fuente_json, adjuntos_json, enlaces_json, orden, creado_por, actualizado_por)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (int(did), tipo, titulo, texto, col._texto(datos.get("porque"), 2000), estado, turno,
             _ahora() if turno else None,
             _fecha(datos.get("fecha_hecho")), _fuente(datos.get("fuente")),
             json.dumps(_adjuntos(did, datos.get("adjuntos")), ensure_ascii=False),
             json.dumps(_enlaces(datos.get("enlaces"), _ids(con, did), None), ensure_ascii=False),
             orden, int(uid), int(uid)))
        tid = cur.lastrowid
        if registrar:
            _registrar(con, did, uid, "escribio", tid)
        r = con.execute("SELECT * FROM colab_tarjetas WHERE id=?", (tid,)).fetchone()
    return _a_dict(r)


def editar(did: int, tid: int, uid: int, cambios: dict) -> dict:
    """Aplica SOLO los campos que llegan: dos personas editando tarjetas distintas no se pisan."""
    _ensure()
    with col._conn() as con:
        r = con.execute("SELECT * FROM colab_tarjetas WHERE id=? AND diagrama_id=? AND borrado=0",
                        (int(tid), int(did))).fetchone()
        if not r:
            raise ValueError("Tarjeta no encontrada")
        sets: dict = {}
        if "tipo" in cambios:
            if cambios["tipo"] not in TIPOS:
                raise ValueError("Tipo de tarjeta no válido")
            sets["tipo"] = cambios["tipo"]
        for campo, tope in (("titulo", 200), ("texto", 4000), ("porque", 2000)):
            if campo in cambios:
                sets[campo] = col._texto(cambios[campo], tope)
        if "estado" in cambios and cambios["estado"] in ESTADOS:
            sets["estado"] = cambios["estado"]
            if sets["estado"] != "abierto":           # resuelta o descartada: ya no le toca a nadie
                cambios = {**cambios, "turno_de": None}
        if "turno_de" in cambios:
            nuevo = _participante(did, cambios["turno_de"])
            sets["turno_de"] = nuevo
            if nuevo != r["turno_de"]:
                sets["turno_desde"] = _ahora() if nuevo else None
        if "fecha_hecho" in cambios:
            sets["fecha_hecho"] = _fecha(cambios["fecha_hecho"])
        if "adjuntos" in cambios:
            sets["adjuntos_json"] = json.dumps(_adjuntos(did, cambios["adjuntos"]), ensure_ascii=False)
        if "enlaces" in cambios:
            sets["enlaces_json"] = json.dumps(_enlaces(cambios["enlaces"], _ids(con, did), int(tid)),
                                              ensure_ascii=False)
        if "orden" in cambios:
            o = col._num(cambios["orden"])
            if o is not None:
                sets["orden"] = o
        if not sets:
            return _a_dict(r)
        # Cambiar el texto de una decisión o acuerdo invalida los «de acuerdo» que ya tenía.
        if any(k in sets and sets[k] != r[k] for k in ("titulo", "texto")) and r["acuerdos_json"] not in ("", "{}"):
            sets["acuerdos_json"] = "{}"
        sets["actualizado_por"] = int(uid)
        con.execute(
            "UPDATE colab_tarjetas SET " + ", ".join(f"{k}=?" for k in sets) + ", actualizado_en=datetime('now')"
            " WHERE id=?", (*sets.values(), int(tid)))
        _registrar(con, did, uid, "escribio", int(tid))
        r = con.execute("SELECT * FROM colab_tarjetas WHERE id=?", (int(tid),)).fetchone()
    return _a_dict(r)


def borrar(did: int, tid: int, uid: int) -> None:
    _ensure()
    with col._conn() as con:
        cur = con.execute("UPDATE colab_tarjetas SET borrado=1, actualizado_por=?, actualizado_en=datetime('now')"
                          " WHERE id=? AND diagrama_id=? AND borrado=0", (int(uid), int(tid), int(did)))
        if not cur.rowcount:
            raise ValueError("Tarjeta no encontrada")
        # Los enlaces que apuntaban a ella se caen solos al leer (no son ids válidos).
        for f in con.execute("SELECT id, enlaces_json FROM colab_tarjetas WHERE diagrama_id=? AND borrado=0",
                             (int(did),)).fetchall():
            en = [e for e in json.loads(f["enlaces_json"] or "[]") if int(e.get("a") or 0) != int(tid)]
            con.execute("UPDATE colab_tarjetas SET enlaces_json=? WHERE id=?", (json.dumps(en), f["id"]))
        _registrar(con, did, uid, "escribio", int(tid))


def acordar(did: int, tid: int, uid: int, de_acuerdo: bool) -> dict:
    """El «de acuerdo» es de quien está autenticado, no de lo que diga el cliente."""
    _ensure()
    with col._conn() as con:
        r = con.execute("SELECT * FROM colab_tarjetas WHERE id=? AND diagrama_id=? AND borrado=0",
                        (int(tid), int(did))).fetchone()
        if not r:
            raise ValueError("Tarjeta no encontrada")
        ac = json.loads(r["acuerdos_json"] or "{}")
        if de_acuerdo:
            ac[str(int(uid))] = _ahora()
        else:
            ac.pop(str(int(uid)), None)
        sets = {"acuerdos_json": json.dumps(ac)}
        # Con los dos de acuerdo, una decisión abierta queda tomada y ya no le toca a nadie.
        if all(str(p) in ac for p in _pareja(did)) and r["estado"] == "abierto" and r["tipo"] in ("decision", "acuerdo"):
            sets.update(estado="hecho", turno_de=None, turno_desde=None)
        con.execute("UPDATE colab_tarjetas SET " + ", ".join(f"{k}=?" for k in sets) + ", actualizado_por=?,"
                    " actualizado_en=datetime('now') WHERE id=?", (*sets.values(), int(uid), int(tid)))
        _registrar(con, did, uid, "escribio", int(tid))
        r = con.execute("SELECT * FROM colab_tarjetas WHERE id=?", (int(tid),)).fetchone()
    return _a_dict(r)


def resumenes(dids: list[int]) -> dict[int, dict]:
    """Para la lista de proyectos: la meta vigente, cuántas tarjetas y a quién le toca cuánto."""
    _ensure()
    if not dids:
        return {}
    out: dict[int, dict] = {int(d): {"tarjetas": 0, "meta": "", "turno": {}} for d in dids}
    marcas = ",".join("?" * len(dids))
    with col._conn() as con:
        filas = con.execute(f"SELECT diagrama_id, tipo, titulo, estado, turno_de FROM colab_tarjetas"
                            f" WHERE borrado=0 AND diagrama_id IN ({marcas}) ORDER BY orden, id",
                            [int(d) for d in dids]).fetchall()
    for f in filas:
        r = out[int(f["diagrama_id"])]
        r["tarjetas"] += 1
        if f["tipo"] == "meta" and f["estado"] != "descartado" and not r["meta"]:
            r["meta"] = f["titulo"]
        if f["estado"] == "abierto" and f["turno_de"]:
            k = str(f["turno_de"])
            r["turno"][k] = r["turno"].get(k, 0) + 1
    return out


# ─── Ritmo: visto → respuesta ────────────────────────────────────────────────

def _dt(s: str) -> datetime:
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def marcar_visto(did: int, uid: int) -> bool:
    """Registra que `uid` tiene el tablero abierto, solo si hay algo del otro que aún no había visto."""
    _ensure()
    with col._conn() as con:
        ult_visto = con.execute("SELECT MAX(en) m FROM colab_eventos WHERE diagrama_id=? AND usuario_id=? AND tipo='visto'",
                                (int(did), int(uid))).fetchone()["m"]
        ult_otro = con.execute("SELECT MAX(en) m FROM colab_eventos WHERE diagrama_id=? AND usuario_id<>? AND tipo='escribio'",
                               (int(did), int(uid))).fetchone()["m"]
        if not ult_otro or (ult_visto and ult_visto >= ult_otro):
            return False
        if ult_visto and (_utc() - _dt(ult_visto)).total_seconds() < _VISTO_MIN_SEG:
            return False
        con.execute("INSERT INTO colab_eventos (diagrama_id, usuario_id, tipo) VALUES (?,?, 'visto')",
                    (int(did), int(uid)))
    return True


def _resumen_min(valores: list[float]) -> dict:
    if not valores:
        return {"n": 0}
    q = sorted(valores)
    return {"n": len(q), "mediana_min": round(statistics.median(q), 1),
            "p75_min": round(q[min(len(q) - 1, int(len(q) * 0.75))], 1),
            "p90_min": round(q[min(len(q) - 1, int(len(q) * 0.9))], 1)}


def calcular_ritmo(eventos: list[tuple[int, str, datetime]], pareja: list[int],
                   ahora: datetime | None = None) -> dict:
    """Para cada persona: cuánto tarda en ver lo nuevo del otro y en responder desde que lo vio.

    `eventos` = (usuario_id, 'visto'|'escribio', momento), en orden. Una «ronda» empieza con la
    primera escritura del otro después de la última respuesta propia; se cierra con la siguiente
    escritura propia. Si sigue abierta, cuenta como «esperando».
    """
    ahora = ahora or _utc()
    out = {}
    for uid in pareja:
        ver, responder, total = [], [], []
        inicio = visto = None
        for quien, tipo, en in eventos:
            if quien != uid and tipo == "escribio":
                if inicio is None:
                    inicio, visto = en, None
            elif quien == uid and tipo == "visto":
                if inicio is not None and visto is None:
                    visto = en
            elif quien == uid and tipo == "escribio" and inicio is not None:
                v = visto or en                       # respondió sin «visto» previo: lo vio al responder
                ver.append((v - inicio).total_seconds() / 60)
                responder.append((en - v).total_seconds() / 60)
                total.append((en - inicio).total_seconds() / 60)
                inicio = visto = None
        out[str(uid)] = {
            "nombre": col._nombre(uid),
            "en_ver": _resumen_min(ver), "en_responder": _resumen_min(responder), "total": _resumen_min(total),
            "esperando_desde": inicio.strftime("%Y-%m-%d %H:%M:%S") if inicio else None,
            "visto_pendiente": bool(inicio and visto),
            "espera_min": round((ahora - inicio).total_seconds() / 60, 1) if inicio else None,
        }
    return out


def ritmo(did: int) -> dict:
    _ensure()
    with col._conn() as con:
        filas = con.execute("SELECT usuario_id, tipo, en FROM colab_eventos WHERE diagrama_id=? ORDER BY en, id",
                            (int(did),)).fetchall()
        chat = con.execute("SELECT datos_json, actualizado_en FROM colab_ritmo_chat WHERE diagrama_id=?",
                           (int(did),)).fetchone()
    ev = [(int(f["usuario_id"]), f["tipo"], _dt(f["en"])) for f in filas]
    return {"app": calcular_ritmo(ev, _pareja(did)),
            "chat": ({**json.loads(chat["datos_json"]), "guardado_en": chat["actualizado_en"]} if chat else None)}


# ─── Chat de WhatsApp exportado ──────────────────────────────────────────────
# iOS:     [8/7/26, 11:28:25 AM] Nombre: texto
# Android: 7/8/26, 11:28 - Nombre: texto   (también «a. m.» / «p. m.» y 24 h)
_RX_IOS = re.compile(r"^\[(\d{1,2}/\d{1,2}/\d{2,4}),? (\d{1,2}:\d{2}(?::\d{2})?)\s*([ap]\.?\s?m\.?)?\] ([^:]{1,80}): (.*)$", re.I)
_RX_AND = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4}),? (\d{1,2}:\d{2})\s*([ap]\.?\s?m\.?)? - ([^:]{1,80}): (.*)$", re.I)
_INVISIBLES = dict.fromkeys(map(ord, "‎‏‪‬﻿"), None)
MAX_MENSAJES = 20000


def _parse_fecha(fecha: str, hora: str, ampm: str | None, dia_primero: bool) -> datetime | None:
    p = fecha.split("/")
    try:
        a, b, y = int(p[0]), int(p[1]), int(p[2])
    except (ValueError, IndexError):
        return None
    y = y + 2000 if y < 100 else y
    mes, dia = (b, a) if dia_primero else (a, b)
    hh = hora.split(":")
    h, m, s = int(hh[0]), int(hh[1]), int(hh[2]) if len(hh) > 2 else 0
    if ampm:
        pm = ampm.lower().startswith("p")
        h = (h % 12) + (12 if pm else 0)
    try:
        return datetime(y, mes, dia, h, m, s)
    except ValueError:
        return None


def leer_chat(contenido: bytes | str, nombre: str = "") -> list[dict]:
    """Mensajes de un chat exportado (.txt o el .zip de WhatsApp). No guarda nada."""
    if isinstance(contenido, bytes):
        if contenido[:2] == b"PK" or nombre.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(contenido)) as z:
                    txts = [n for n in z.namelist() if n.lower().endswith(".txt")]
                    if not txts:
                        raise ValueError("El .zip no trae el chat (.txt)")
                    contenido = z.read(txts[0])
            except zipfile.BadZipFile:
                raise ValueError("El .zip está dañado") from None
        texto = contenido.decode("utf-8", errors="replace")
    else:
        texto = contenido
    lineas = [l.translate(_INVISIBLES).replace(" ", " ").replace(" ", " ").rstrip("\r")
              for l in texto.split("\n")]
    crudos = []
    for l in lineas:
        m = _RX_IOS.match(l) or _RX_AND.match(l)
        if m:
            crudos.append([m.group(1), m.group(2), m.group(3), m.group(4).strip(), m.group(5)])
        elif crudos and l.strip():
            crudos[-1][4] += "\n" + l
        if len(crudos) > MAX_MENSAJES:
            raise ValueError(f"El chat pasa de {MAX_MENSAJES} mensajes")
    # ¿Día primero (Android en español) o mes primero (iOS en inglés)? Si algún primer número
    # pasa de 12 es día; si el segundo pasa de 12 es mes primero; si no, se prueba el orden.
    primeros = [int(c[0].split("/")[0]) for c in crudos]
    segundos = [int(c[0].split("/")[1]) for c in crudos]
    if any(x > 12 for x in primeros):
        dia_primero = True
    elif any(x > 12 for x in segundos):
        dia_primero = False
    else:
        # Ambiguo: gana el orden con menos saltos hacia atrás y menos fechas en el futuro; si
        # empatan, «AM/PM» en inglés es el formato de EE. UU. (mes primero) y si no, día primero.
        hoy = _utc()

        def costo(dp):
            fs = [_parse_fecha(c[0], c[1], c[2], dp) for c in crudos]
            return (sum(1 for a, b in zip(fs, fs[1:]) if a and b and b < a) + sum(1 for f in fs if not f or f > hoy),
                    0 if dp != any((c[2] or "").upper() in ("AM", "PM") for c in crudos) else 1)
        dia_primero = costo(True) <= costo(False)
    out = []
    for i, (f, h, ap, autor, txt) in enumerate(crudos):
        dt = _parse_fecha(f, h, ap, dia_primero)
        if not dt:
            continue
        out.append({"i": i, "fecha": dt.strftime("%Y-%m-%d %H:%M:%S"), "autor": autor, "texto": txt.strip()})
    return out


def ritmo_chat(mensajes: list[dict], autores: dict[str, int]) -> dict:
    """Tiempo entre el último mensaje de uno y la primera respuesta del otro (el chat no trae «visto»)."""
    seq = [(autores.get(m["autor"]), datetime.strptime(m["fecha"], "%Y-%m-%d %H:%M:%S"))
           for m in mensajes if autores.get(m["autor"])]
    por: dict[int, list[float]] = {}
    largas: dict[int, int] = {}
    for (a, ta), (b, tb) in zip(seq, seq[1:]):
        if a != b:
            mins = (tb - ta).total_seconds() / 60
            por.setdefault(b, []).append(mins)
            if mins > 12 * 60:
                largas[b] = largas.get(b, 0) + 1
    out = {"desde": seq[0][1].strftime("%Y-%m-%d") if seq else None,
           "hasta": seq[-1][1].strftime("%Y-%m-%d") if seq else None,
           "mensajes": len(seq), "personas": {}}
    for uid, v in por.items():
        r = _resumen_min(v)
        r["bajo_5_min"] = round(sum(1 for x in v if x < 5) / len(v), 2)
        r["mas_de_12_h"] = largas.get(uid, 0)
        r["nombre"] = col._nombre(uid)
        out["personas"][str(uid)] = r
    return out


def guardar_ritmo_chat(did: int, uid: int, datos: dict) -> None:
    """Solo números: el contenido del chat no se guarda."""
    _ensure()
    limpio = {"desde": datos.get("desde"), "hasta": datos.get("hasta"), "mensajes": int(datos.get("mensajes") or 0),
              "personas": {str(k): {kk: vv for kk, vv in (v or {}).items()
                                    if kk in ("n", "mediana_min", "p75_min", "p90_min", "bajo_5_min", "mas_de_12_h", "nombre")}
                           for k, v in (datos.get("personas") or {}).items() if str(k).isdigit()}}
    with col._conn() as con:
        con.execute("INSERT INTO colab_ritmo_chat (diagrama_id, datos_json, actualizado_por) VALUES (?,?,?)"
                    " ON CONFLICT(diagrama_id) DO UPDATE SET datos_json=excluded.datos_json,"
                    " actualizado_por=excluded.actualizado_por, actualizado_en=datetime('now')",
                    (int(did), json.dumps(limpio, ensure_ascii=False), int(uid)))


def autores_sugeridos(mensajes: list[dict], did: int, uid: int) -> dict[str, int]:
    """«Tú» es quien exportó el chat (normalmente quien lo sube); el otro autor, su pareja."""
    nombres = []
    for m in mensajes:
        if m["autor"] not in nombres:
            nombres.append(m["autor"])
    sug: dict[str, int] = {}
    otro = _otro(did, uid)
    for n in nombres:
        if n.lower() in ("tú", "tu", "you"):
            sug[n] = int(uid)
        elif otro and len(nombres) == 2:
            sug[n] = otro
    return sug

