"""
Entregas Flex de MercadoLibre: a qué hora llegan los envíos y cómo evoluciona
eso semana a semana.

Flex (`logistic.type == "self_service"`) es el reparto propio de McKenna en
Bogotá («MCKENNAGROUP Super Express»): MeLi no lo lleva, lo lleva nuestro
mensajero, así que la única forma de saber cómo va el servicio es mirar el
historial de cada envío. `GET /shipments/{id}/history` trae la hora de
impresión, de salida (`date_shipped`, cuando el mensajero escanea el paquete)
y de entrega; `GET /shipments/{id}` trae la localidad y la fecha límite que
MeLi le prometió al comprador.

Por qué se guarda en una base propia y no se consulta en vivo: son 2 llamadas
por envío (~1.700 para 90 días) y MeLi solo deja buscar órdenes de los
últimos meses. Acumular desde ya es lo que permite ver la evolución de
semanas y meses sin repetir miles de llamadas cada vez que alguien abre el
panel. Estudio de partida (17-sep-2026, 843 entregas): una sola ruta al día
que sale ~14:45, hora mediana de entrega 17:20, corte real del mismo día
~12:20, el sur de Bogotá queda de último (~19:30).

Todas las horas se guardan ya pasadas a hora de Bogotá: MeLi responde en
-04:00 y leerlas sin convertir corre todo una hora.

Sin LLM. Base: app/data/entregas_flex.db (gitignored, se regenera con
`sincronizar(dias=90)`).
"""

from __future__ import annotations

import sqlite3
import statistics
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

BOGOTA = ZoneInfo("America/Bogota")
_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "entregas_flex.db"
_API = "https://api.mercadolibre.com"

# Estados en los que un envío ya no cambia: no se vuelve a consultar.
_ESTADOS_CERRADOS = {"delivered", "cancelled", "not_delivered", "returned"}

# Por debajo de esto una semana no dice nada (festivos, arranque del registro):
# se muestra pero no entra a las comparaciones de «patrones».
_MIN_ENVIOS_SEMANA = 10

_LOCK_SYNC = threading.Lock()
_ESTADO_SYNC: dict = {"corriendo": False}

_MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

# Menos entregas que esto en alguno de los dos períodos y el «cambio» por
# localidad es ruido (una sola entrega tardía mueve la mediana horas).
_MIN_ENVIOS_CAMBIO_LOCALIDAD = 8

DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


# ── Base ─────────────────────────────────────────────────────────────────────


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(_DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS envios_flex (
            shipment_id    TEXT PRIMARY KEY,
            order_id       TEXT,
            compra         TEXT,   -- ISO hora Bogotá
            total          REAL,
            estado         TEXT,
            subestado      TEXT,
            metodo         TEXT,   -- «Prioritario a domicilio» / «Normal a domicilio»
            promesa        TEXT,   -- same_day / next_day / two_days …
            localidad      TEXT,
            ciudad         TEXT,
            lat            REAL,
            lon            REAL,
            limite         TEXT,   -- fecha límite prometida al comprador
            impreso        TEXT,
            listo          TEXT,
            salida         TEXT,
            entregado      TEXT,
            no_entregado   TEXT,
            devuelto       TEXT,
            actualizado_en TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_flex_entregado ON envios_flex(entregado);
        CREATE INDEX IF NOT EXISTS ix_flex_compra ON envios_flex(compra);
        -- Envíos que NO son Flex (cross-docking, Full): se anotan para no
        -- volver a pedirlos en cada corrida.
        CREATE TABLE IF NOT EXISTS envios_otros (
            shipment_id TEXT PRIMARY KEY,
            tipo        TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            inicio    TEXT,
            fin       TEXT,
            dias      INTEGER,
            revisados INTEGER,
            nuevos    INTEGER,
            error     TEXT
        );
        """
    )
    return con


def _bog(valor: str | None) -> str | None:
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.isoformat(timespec="seconds")
    return dt.astimezone(BOGOTA).replace(tzinfo=None).isoformat(timespec="seconds")


def _dt(valor: str | None) -> datetime | None:
    return datetime.fromisoformat(valor) if valor else None


# ── Sincronización con MeLi ──────────────────────────────────────────────────


def _sesion() -> requests.Session:
    from requests.adapters import HTTPAdapter, Retry

    s = requests.Session()
    s.mount(
        "https://",
        HTTPAdapter(
            max_retries=Retry(
                total=5, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=None
            )
        ),
    )
    return s


def _ordenes(sesion: requests.Session, token: str, dias: int) -> list[dict]:
    """Órdenes pagadas de los últimos `dias`, en tramos de 30 días (/orders/search
    rechaza offset > 10000).

    No usa `meli.listar_ordenes_meli_por_estado` a propósito: esa corta la
    paginación en silencio ante un error de red y devuelve lo que alcanzó a
    traer. Pasó en la primera prueba (18-sep-2026, un SSLEOFError): el
    backfill de 90 días vio 1.709 órdenes de ~3.450 y la corrida quedó «ok».
    Acá la sesión reintenta y, si igual falla, se lanza la excepción — una
    sincronización fallida se reintenta mañana; una a medias no se nota."""
    from app.services.meli import _obtener_seller_id_meli

    seller = _obtener_seller_id_meli(token)
    if not seller:
        raise RuntimeError("No se pudo obtener el seller_id de MercadoLibre")
    h = {"Authorization": f"Bearer {token}"}
    ahora = datetime.now()
    ordenes: list[dict] = []
    inicio = dias
    while inicio > 0:
        fin = max(0, inicio - 30)
        params = {
            "seller": seller,
            "order.status": "paid",
            "order.date_created.from": (ahora - timedelta(days=inicio)).strftime("%Y-%m-%dT00:00:00.000-05:00"),
            "order.date_created.to": (ahora - timedelta(days=fin)).strftime("%Y-%m-%dT23:59:59.999-05:00")
            if fin
            else ahora.strftime("%Y-%m-%dT23:59:59.999-05:00"),
            "sort": "date_asc",
            "limit": 50,
            "offset": 0,
        }
        if fin:
            # tramos sin solaparse: el siguiente arranca en 00:00 del día `fin`
            params["order.date_created.to"] = (ahora - timedelta(days=fin + 1)).strftime(
                "%Y-%m-%dT23:59:59.999-05:00"
            )
        while True:
            r = sesion.get(f"{_API}/orders/search", headers=h, params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
            res = data.get("results") or []
            ordenes += res
            params["offset"] += len(res)
            if not res or params["offset"] >= (data.get("paging") or {}).get("total", 0):
                break
        inicio = fin
    return ordenes


def _consultar_envio(sesion: requests.Session, token: str, sid: str) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    s = sesion.get(f"{_API}/shipments/{sid}", headers={**h, "x-format-new": "true"}, timeout=20)
    s.raise_for_status()
    envio = s.json()
    tipo = (envio.get("logistic") or {}).get("type") or envio.get("logistic_type") or ""
    if tipo != "self_service":
        return {"flex": False, "tipo": tipo}
    hist = sesion.get(f"{_API}/shipments/{sid}/history", headers=h, timeout=20)
    hist.raise_for_status()
    fechas = (hist.json() or {}).get("date_history") or {}
    dest = (envio.get("destination") or {}).get("shipping_address") or {}
    lead = envio.get("lead_time") or {}
    metodo = lead.get("shipping_method") or {}
    return {
        "flex": True,
        "estado": envio.get("status"),
        "subestado": envio.get("substatus"),
        "metodo": metodo.get("name"),
        "promesa": metodo.get("type"),
        "localidad": (dest.get("city") or {}).get("name"),
        "ciudad": (dest.get("state") or {}).get("name"),
        "lat": dest.get("latitude"),
        "lon": dest.get("longitude"),
        "limite": _bog((lead.get("estimated_delivery_limit") or {}).get("date")),
        "impreso": _bog(fechas.get("date_first_printed")),
        "listo": _bog(fechas.get("date_ready_to_ship")),
        "salida": _bog(fechas.get("date_shipped")),
        "entregado": _bog(fechas.get("date_delivered")),
        "no_entregado": _bog(fechas.get("date_not_delivered")),
        "devuelto": _bog(fechas.get("date_returned")),
    }


def sincronizar(dias: int = 10, *, hilos: int = 5) -> dict:
    """Trae de MeLi los envíos Flex de las órdenes de los últimos `dias`.

    Solo consulta lo que falta: envíos nunca vistos y envíos Flex que siguen
    abiertos (sin entregar). Lo cerrado y lo que no es Flex no se vuelve a
    pedir, así que la corrida diaria cuesta unas decenas de llamadas.
    `dias=90` es el backfill completo."""
    from app.utils import refrescar_token_meli

    if not _LOCK_SYNC.acquire(blocking=False):
        return {"ok": False, "error": "Ya hay una sincronización en curso"}
    inicio = datetime.now().isoformat(timespec="seconds")
    _ESTADO_SYNC.update({"corriendo": True, "inicio": inicio, "dias": dias, "avance": 0, "total": 0})
    try:
        token = refrescar_token_meli()
        if not token:
            raise RuntimeError("No hay token de MercadoLibre")
        sesion = _sesion()
        ordenes = _ordenes(sesion, token, dias)

        por_envio: dict[str, dict] = {}
        for o in ordenes:
            sid = str((o.get("shipping") or {}).get("id") or "")
            if sid and sid not in por_envio:
                por_envio[sid] = o

        with _conn() as con:
            otros = {r[0] for r in con.execute("SELECT shipment_id FROM envios_otros")}
            cerrados = {
                r[0]
                for r in con.execute(
                    f"SELECT shipment_id FROM envios_flex WHERE estado IN ({','.join('?' * len(_ESTADOS_CERRADOS))})",
                    tuple(_ESTADOS_CERRADOS),
                )
            }
            # Abiertos que ya quedaron fuera de la ventana de órdenes: sin esto un
            # envío que se demora más que `dias` quedaría «en camino» para siempre.
            abiertos = {
                r[0]
                for r in con.execute(
                    f"SELECT shipment_id FROM envios_flex WHERE estado NOT IN ({','.join('?' * len(_ESTADOS_CERRADOS))})",
                    tuple(_ESTADOS_CERRADOS),
                )
            }
        pendientes = [sid for sid in por_envio if sid not in otros and sid not in cerrados]
        pendientes += [sid for sid in abiertos if sid not in por_envio]
        _ESTADO_SYNC["total"] = len(pendientes)

        resultados: list[tuple[str, dict]] = []
        errores = 0

        def trabajo(sid: str):
            try:
                return sid, _consultar_envio(sesion, token, sid)
            except Exception as e:  # un envío que falla no tumba la corrida
                return sid, {"error": str(e)}

        with ThreadPoolExecutor(hilos) as ex:
            for i, (sid, r) in enumerate(ex.map(trabajo, pendientes), 1):
                _ESTADO_SYNC["avance"] = i
                if "error" in r:
                    errores += 1
                    continue
                resultados.append((sid, r))

        ahora = datetime.now().isoformat(timespec="seconds")
        nuevos_flex = 0
        with _conn() as con:
            for sid, r in resultados:
                if not r["flex"]:
                    con.execute("INSERT OR REPLACE INTO envios_otros VALUES (?, ?)", (sid, r["tipo"]))
                    continue
                nuevos_flex += 1
                o = por_envio.get(sid)
                if o:
                    con.execute(
                        "INSERT OR IGNORE INTO envios_flex (shipment_id, order_id, compra, total) VALUES (?,?,?,?)",
                        (sid, str(o.get("id") or ""), _bog(o.get("date_created")), o.get("total_amount")),
                    )
                campos = [k for k in r if k != "flex"]
                con.execute(
                    f"UPDATE envios_flex SET {', '.join(f'{k} = ?' for k in campos)}, actualizado_en = ? "
                    "WHERE shipment_id = ?",
                    (*[r[k] for k in campos], ahora, sid),
                )
            con.execute(
                "INSERT INTO sync_log (inicio, fin, dias, revisados, nuevos, error) VALUES (?,?,?,?,?,?)",
                (inicio, ahora, dias, len(pendientes), nuevos_flex, f"{errores} envíos con error" if errores else None),
            )
        return {
            "ok": True,
            "ordenes": len(ordenes),
            "envios": len(por_envio),
            "consultados": len(pendientes),
            "flex_actualizados": nuevos_flex,
            "errores": errores,
        }
    except Exception as e:
        with _conn() as con:
            con.execute(
                "INSERT INTO sync_log (inicio, fin, dias, revisados, nuevos, error) VALUES (?,?,?,?,?,?)",
                (inicio, datetime.now().isoformat(timespec="seconds"), dias, 0, 0, str(e)[:300]),
            )
        return {"ok": False, "error": str(e)}
    finally:
        _ESTADO_SYNC["corriendo"] = False
        _LOCK_SYNC.release()


def sincronizar_en_segundo_plano(dias: int = 10) -> dict:
    if _ESTADO_SYNC.get("corriendo"):
        return {"ok": False, "error": "Ya hay una sincronización en curso"}
    threading.Thread(target=sincronizar, kwargs={"dias": dias}, daemon=True).start()
    time.sleep(0.2)
    return {"ok": True, "iniciado": True}


def estado_sync() -> dict:
    with _conn() as con:
        ultima = con.execute("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").fetchone()
        total = con.execute("SELECT COUNT(*), MIN(entregado), MAX(entregado) FROM envios_flex").fetchone()
    return {
        **_ESTADO_SYNC,
        "ultima": dict(ultima) if ultima else None,
        "registrados": total[0],
        "primera_entrega": total[1],
        "ultima_entrega": total[2],
    }


# ── Análisis ─────────────────────────────────────────────────────────────────


def _hora(dt: datetime) -> float:
    return dt.hour + dt.minute / 60


def _mediana(xs: list[float]) -> float | None:
    return round(statistics.median(xs), 2) if xs else None


def _pct(parte: int, total: int) -> float | None:
    return round(100 * parte / total, 1) if total else None


def _percentil(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(p * len(s)))], 2)


def _lunes(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _cargar(desde: date) -> list[dict]:
    with _conn() as con:
        filas = con.execute(
            "SELECT * FROM envios_flex WHERE compra >= ? OR entregado >= ? OR entregado IS NULL",
            (desde.isoformat(), desde.isoformat()),
        ).fetchall()
    out = []
    for f in filas:
        r = dict(f)
        for k in ("compra", "impreso", "listo", "salida", "entregado", "no_entregado", "devuelto", "limite"):
            r[k] = _dt(r[k])
        out.append(r)
    return out


def _corte_config() -> float:
    """Hora de corte para salir el mismo día (decimal). Del estudio: 12:20."""
    import os

    try:
        return float(os.getenv("ENTREGAS_FLEX_CORTE_HORA", "12.33"))
    except ValueError:
        return 12.33


def _metricas(envios: list[dict]) -> dict:
    """Indicadores de un grupo de envíos (una semana, un período)."""
    entregados = [r for r in envios if r["entregado"]]
    horas = [_hora(r["entregado"]) for r in entregados]
    con_salida = [r for r in entregados if r["salida"] and r["entregado"] >= r["salida"]]
    transito = [(r["entregado"] - r["salida"]).total_seconds() / 3600 for r in con_salida]
    salidas = [_hora(r["salida"]) for r in envios if r["salida"]]

    por_dia: dict[date, list[datetime]] = defaultdict(list)
    for r in entregados:
        por_dia[r["entregado"].date()].append(r["entregado"])
    fin_ruta = [_hora(max(v)) for v in por_dia.values()]

    con_limite = [r for r in entregados if r["limite"]]
    tarde = [r for r in con_limite if r["entregado"].date() > r["limite"].date()]

    corte = _corte_config()
    # Compras de lunes a viernes antes del corte: deberían salir ese mismo día.
    antes_corte = [
        r for r in entregados if r["compra"] and r["compra"].weekday() < 5 and _hora(r["compra"]) < corte
    ]
    mismo_dia_corte = [r for r in antes_corte if r["entregado"].date() == r["compra"].date()]
    mismo_dia = [r for r in entregados if r["compra"] and r["entregado"].date() == r["compra"].date()]

    return {
        "envios": len(envios),
        "entregados": len(entregados),
        "dias_reparto": len(por_dia),
        "envios_por_dia": _mediana([float(len(v)) for v in por_dia.values()]),
        "hora_mediana": _mediana(horas),
        "hora_p90": _percentil(horas, 0.9),
        "pct_antes_18": _pct(sum(1 for h in horas if h < 18), len(horas)),
        "pct_despues_20": _pct(sum(1 for h in horas if h >= 20), len(horas)),
        "salida_mediana": _mediana(salidas),
        "transito_mediano": _mediana(transito),
        "fin_ruta_mediano": _mediana(fin_ruta),
        "fin_ruta_max": round(max(fin_ruta), 2) if fin_ruta else None,
        "pct_mismo_dia": _pct(len(mismo_dia), len(entregados)),
        "pct_mismo_dia_antes_corte": _pct(len(mismo_dia_corte), len(antes_corte)),
        "compras_antes_corte": len(antes_corte),
        "perdidas_corte": len(antes_corte) - len(mismo_dia_corte),
        "pct_a_tiempo": _pct(len(con_limite) - len(tarde), len(con_limite)),
        "tarde": len(tarde),
    }


def _histograma(envios: list[dict]) -> list[int]:
    c = Counter(r["entregado"].hour for r in envios if r["entregado"])
    return [c.get(h, 0) for h in range(24)]


def _patrones(semanas: list[dict]) -> list[dict]:
    """Compara las últimas 4 semanas completas contra las 4 anteriores y lista
    lo que cambió de verdad. Umbrales pensados para no gritar por ruido:
    15 minutos en la hora, 5 puntos en porcentajes."""
    completas = [s for s in semanas if not s["en_curso"] and s["metricas"]["entregados"] >= _MIN_ENVIOS_SEMANA]
    if len(completas) < 2:
        return [
            {
                "tipo": "info",
                "texto": "Todavía no hay suficientes semanas completas para comparar. "
                "Con 2 semanas se empieza a ver la tendencia; con 8, los patrones.",
            }
        ]
    n = min(4, len(completas) // 2)
    reciente, anterior = completas[-n:], completas[-2 * n : -n]

    def prom(grupo, clave):
        vals = [s["metricas"][clave] for s in grupo if s["metricas"][clave] is not None]
        return sum(vals) / len(vals) if vals else None

    out: list[dict] = []

    def comparar(clave, etiqueta, unidad, umbral, peor_si_sube):
        a, b = prom(anterior, clave), prom(reciente, clave)
        if a is None or b is None:
            return
        delta = b - a
        if abs(delta) < umbral:
            return
        peor = (delta > 0) == peor_si_sube
        if unidad == "hora":
            txt_delta = f"{abs(delta) * 60:.0f} min {'más tarde' if delta > 0 else 'más temprano'}"
            txt = f"{etiqueta}: {_fmt_hora(a)} → {_fmt_hora(b)} ({txt_delta})"
        else:
            txt = f"{etiqueta}: {a:.0f}% → {b:.0f}% ({'+' if delta > 0 else '−'}{abs(delta):.0f} pts)"
        out.append({"tipo": "alerta" if peor else "mejora", "texto": txt})

    rango = f"últimas {n} semanas vs. las {n} anteriores"
    comparar("hora_mediana", "Hora mediana de entrega", "hora", 0.25, True)
    comparar("salida_mediana", "Hora de salida de la ruta", "hora", 0.25, True)
    comparar("fin_ruta_mediano", "Última entrega del día", "hora", 0.25, True)
    comparar("pct_despues_20", "Entregas después de las 20 h", "pct", 5, True)
    comparar("pct_mismo_dia_antes_corte", "Compras antes del corte entregadas el mismo día", "pct", 5, False)
    comparar("pct_a_tiempo", "Entregas a tiempo", "pct", 3, False)
    for p in out:
        p["texto"] += f" — {rango}"

    # Semana puntual fuera de lo normal: la hora mediana a más de 30 min del promedio.
    base = [s["metricas"]["hora_mediana"] for s in completas if s["metricas"]["hora_mediana"] is not None]
    if len(base) >= 4:
        media = sum(base) / len(base)
        for s in completas[-4:]:
            h = s["metricas"]["hora_mediana"]
            if h is not None and abs(h - media) >= 0.5:
                out.append(
                    {
                        "tipo": "alerta" if h > media else "mejora",
                        "texto": f"Semana del {s['semana']}: hora mediana {_fmt_hora(h)}, "
                        f"{abs(h - media) * 60:.0f} min {'por encima' if h > media else 'por debajo'} "
                        f"del promedio ({_fmt_hora(media)}).",
                    }
                )
    if not out:
        out.append({"tipo": "info", "texto": f"Sin cambios relevantes ({rango}): el servicio está estable."})
    return out


def _fmt_hora(h: float | None) -> str:
    if h is None:
        return "—"
    hh = int(h)
    mm = int(round((h - hh) * 60))
    if mm == 60:
        hh, mm = hh + 1, 0
    return f"{hh:02d}:{mm:02d}"


def resumen(semanas: int = 12) -> dict:
    """Todo lo que muestra el panel: serie semanal, período actual vs. anterior,
    histograma, día de la semana, localidades, corte, carga vs. fin de ruta,
    pendientes y patrones detectados."""
    semanas = max(2, min(int(semanas or 12), 52))
    hoy = date.today()
    lunes_actual = _lunes(hoy)
    desde = lunes_actual - timedelta(weeks=semanas - 1)
    envios = _cargar(desde - timedelta(days=7))

    # La semana de un envío es la de su entrega (o de la compra si no se ha entregado).
    def semana_de(r) -> date | None:
        ref = r["entregado"] or r["compra"]
        return _lunes(ref.date()) if ref else None

    grupos: dict[date, list[dict]] = defaultdict(list)
    for r in envios:
        s = semana_de(r)
        if s and s >= desde:
            grupos[s].append(r)

    serie = []
    for i in range(semanas):
        lunes = desde + timedelta(weeks=i)
        serie.append(
            {
                "semana": lunes.isoformat(),
                "etiqueta": f"{lunes.day} {_MESES[lunes.month - 1]}",
                "en_curso": lunes == lunes_actual,
                "metricas": _metricas(grupos.get(lunes, [])),
            }
        )

    # Período actual = últimas 4 semanas (incluida la en curso); anterior = las 4 previas.
    corte_actual = lunes_actual - timedelta(weeks=3)
    corte_prev = corte_actual - timedelta(weeks=4)
    actuales = [r for s, g in grupos.items() if s >= corte_actual for r in g]
    previos = [r for s, g in grupos.items() if corte_prev <= s < corte_actual for r in g]
    periodo_total = [r for g in grupos.values() for r in g]

    por_dia = []
    for d in range(7):
        g = [r for r in periodo_total if r["entregado"] and r["entregado"].weekday() == d]
        if g:
            m = _metricas(g)
            por_dia.append({"dia": DIAS[d], **m})

    def localidades(grupo):
        loc: dict[str, list[dict]] = defaultdict(list)
        for r in grupo:
            if r["entregado"]:
                loc[r["localidad"] or "Sin localidad"].append(r)
        return loc

    loc_act, loc_prev = localidades(actuales), localidades(previos)
    por_localidad = []
    for nombre, g in sorted(localidades(periodo_total).items(), key=lambda x: -len(x[1])):
        m = _metricas(g)
        ma = _metricas(loc_act.get(nombre, []))
        mp = _metricas(loc_prev.get(nombre, []))
        por_localidad.append(
            {
                "localidad": nombre,
                "envios": m["entregados"],
                "hora_mediana": m["hora_mediana"],
                "transito_mediano": m["transito_mediano"],
                "pct_despues_20": m["pct_despues_20"],
                "hora_actual": ma["hora_mediana"],
                "hora_anterior": mp["hora_mediana"],
                "cambio_confiable": min(ma["entregados"], mp["entregados"]) >= _MIN_ENVIOS_CAMBIO_LOCALIDAD,
            }
        )

    tramos = [(0, 8), (8, 10), (10, 11), (11, 12), (12, 13), (13, 14), (14, 17), (17, 24)]
    corte = []
    for a, b in tramos:
        g = [
            r
            for r in periodo_total
            if r["entregado"] and r["compra"] and r["compra"].weekday() < 5 and a <= r["compra"].hour < b
        ]
        corte.append(
            {
                "tramo": f"{a:02d}–{b:02d} h",
                "compras": len(g),
                "pct_mismo_dia": _pct(sum(1 for r in g if r["entregado"].date() == r["compra"].date()), len(g)),
            }
        )

    rutas_dia: dict[date, list[dict]] = defaultdict(list)
    for r in periodo_total:
        if r["entregado"]:
            rutas_dia[r["entregado"].date()].append(r)
    rutas = []
    for d, g in sorted(rutas_dia.items()):
        salidas = [r["salida"] for r in g if r["salida"]]
        rutas.append(
            {
                "fecha": d.isoformat(),
                "dia": DIAS[d.weekday()],
                "envios": len(g),
                "salida": round(_hora(min(salidas)), 2) if salidas else None,
                "primera": round(_hora(min(r["entregado"] for r in g)), 2),
                "ultima": round(_hora(max(r["entregado"] for r in g)), 2),
            }
        )

    # Lo que hay que mirar hoy: abiertos de más de un día, o listos antes del
    # corte de hoy que no han salido.
    ahora = datetime.now(BOGOTA).replace(tzinfo=None)
    abiertos = []
    for r in envios:
        if r["estado"] in _ESTADOS_CERRADOS or not r["compra"]:
            continue
        edad_h = (ahora - r["compra"]).total_seconds() / 3600
        motivo = None
        if r["estado"] == "shipped" and r["salida"] and (ahora - r["salida"]).total_seconds() > 12 * 3600:
            motivo = "Salió hace más de 12 h y no figura entregado"
        elif r["subestado"] == "not_visited":
            motivo = "El mensajero no lo visitó"
        elif r["estado"] == "ready_to_ship" and edad_h > 30:
            motivo = "Lleva más de un día sin salir"
        abiertos.append(
            {
                "shipment_id": r["shipment_id"],
                "order_id": r["order_id"],
                "compra": r["compra"].isoformat(),
                "estado": r["estado"],
                "subestado": r["subestado"],
                "localidad": r["localidad"],
                "limite": r["limite"].date().isoformat() if r["limite"] else None,
                "alerta": motivo,
            }
        )
    abiertos.sort(key=lambda x: (x["alerta"] is None, x["compra"]))

    tardios = [
        {
            "shipment_id": r["shipment_id"],
            "compra": r["compra"].isoformat() if r["compra"] else None,
            "limite": r["limite"].date().isoformat(),
            "entregado": r["entregado"].isoformat(),
            "dias_tarde": (r["entregado"].date() - r["limite"].date()).days,
            "localidad": r["localidad"],
        }
        for r in actuales
        if r["entregado"] and r["limite"] and r["entregado"].date() > r["limite"].date()
    ]
    tardios.sort(key=lambda x: x["entregado"], reverse=True)

    # Marcas raras: «entregado» entre 22:00 y 07:00 casi siempre es el mensajero
    # cerrando en la app días después, no una entrega real a esa hora.
    madrugada = [
        {"shipment_id": r["shipment_id"], "entregado": r["entregado"].isoformat(), "localidad": r["localidad"]}
        for r in periodo_total
        if r["entregado"] and (r["entregado"].hour >= 22 or r["entregado"].hour < 7)
    ]

    return {
        "generado": datetime.now().isoformat(timespec="seconds"),
        "semanas": semanas,
        "corte_hora": _corte_config(),
        "serie": serie,
        "actual": _metricas(actuales),
        "anterior": _metricas(previos),
        "histograma_actual": _histograma(actuales),
        "histograma_anterior": _histograma(previos),
        "por_dia": por_dia,
        "por_localidad": por_localidad,
        "corte": corte,
        "rutas": rutas,
        "abiertos": abiertos,
        "tardios": tardios,
        "madrugada": madrugada,
        "patrones": _patrones(serie),
        "sync": estado_sync(),
    }
