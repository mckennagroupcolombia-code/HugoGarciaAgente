"""
Rendimiento por persona — la «ficha» de cada usuario en la Agenda de /app.

Qué hace cada quien, cuántas veces, cuánto tarda en promedio y cuántas horas le
dedica al mes, calculado con lo que ya registra el panel (tickets.db):

  - tareas cronometradas (`ticket_corridas`: inicio → fin, se descartan las de
    más de 10 h porque son cronómetros que nadie cerró);
  - tiempo en cada módulo del panel (`panel_eventos_operativos`: tiempo hasta la
    siguiente acción de la misma sesión, máximo 30 min);
  - tareas asignadas sin cronómetro (solo cuentan como «veces»).

Si una función tiene tiempo cronometrado y tiempo en el panel, se toma el mayor
para no contarla dos veces. Sin LLM. Solo lectura.

Origen: revisión de honorarios del 23-sep-2026 (artefacto «Mapa de funciones»).
Lo que importa es el tiempo que la persona aporta por tipo de función: las
funciones puntuales cambian de un mes a otro, los tipos se mantienen.

Dos reglas de clasificación que vienen de esa revisión:
  - Quien desarrolla el sistema (RENDIMIENTO_DESARROLLADORES) no hace las tareas
    operativas: su tiempo en empaque, envíos, stock o atención cuenta como
    «trabaja el módulo con IA».
  - Quien usa el Studio de etiquetas para imprimir (RENDIMIENTO_IMPRIMEN) no
    diseña: ese tiempo cuenta como imprimir.
"""

from __future__ import annotations

import os
import re
import sqlite3
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta

from app.services import tickets_db

NIVELES = {
    1: "Servicios generales",
    2: "Operativo",
    3: "Operativo técnico",
    4: "Administrativo con responsabilidad",
    5: "Especializado",
}
JORNADA_H = 176
MAX_TAREA_H = 10
MAX_GAP_H = 0.5

# id, nombre, qué implica, nivel, regex sobre el título de la tarea, módulos del panel.
# El orden importa: gana la primera regla que coincide.
CATALOGO: list[tuple[str, str, str, int, str, tuple[str, ...]]] = [
    ("hongos", "Produce la línea de hongos", "Esteriliza sustrato, inocula micelio, arma y airea monotubes.", 3,
     r"hongo|gongo|micelio|monotub|inocul|sustrato|vasos", ()),
    ("almuerzo", "Hace el almuerzo del equipo", "Cocina para el equipo en días hábiles.", 1, r"almuerzo", ()),
    ("desayuno", "Hace el desayuno", "Prepara el desayuno del equipo.", 1, r"desayuno|tinto", ()),
    ("aseo", "Hace el aseo de las áreas", "Limpia bodega, cocina y áreas de trabajo.", 1,
     r"aseo|basura|losa|nevera|ordenar cocina|limpiar la", ()),
    ("embalar", "Embala el despacho del día", "Arma las cajas de lo que sale ese día.", 2,
     r"embal|alistar productos y embalar", ("empaque",)),
    ("alistar", "Alista los envíos de Colecta y Flex", "Recoge cada pedido, verifica productos y cantidades y lo deja listo para la guía.", 2,
     r"alist|alistamiento|colecta|flex", ()),
    ("guias", "Imprime las guías de envío", "Descarga e imprime la guía de cada pedido y la pega en el paquete.", 2,
     r"imprimir guias|impresion y anotacion|imprimir y registrar las guias", ("guias-envio",)),
    ("cuaderno", "Anota las guías en el cuaderno", "Copia a mano el número de cada guía para el control diario.", 2,
     r"anotar guias|cuaderno", ()),
    ("envio", "Lleva los envíos a la transportadora", "Sale a la transportadora con los paquetes.", 1,
     r"salgo a|interrapidisimo a llevar|llevar envios|evia|deprisa|transportar", ()),
    ("nc", "Gestiona anulaciones y notas crédito", "Revisa la cancelación, emite o valida la nota crédito.", 4,
     r"anulacion|nota credito|anular", ()),
    ("imprimir_et", "Imprime etiquetas de producto", "Envía las etiquetas aprobadas a la impresora y revisa que salgan bien.", 2,
     r"imprimir etiquetas|imprimir  etiquetas", ()),
    ("empacar", "Empaca, sella y etiqueta producto", "Pesa o mide, envasa, sella y pega la etiqueta.", 2,
     r"empac|sell|etiquetar|etiqueta productos|termo|tarro|pastiller|gotero|polvo|capsul", ()),
    ("envasar", "Envasa líquidos y porciona", "Pasa líquidos a envases de venta y porciona ceras por peso.", 2,
     r"envas|porcion|garrafa|ricino|glicerina", ()),
    ("preparar", "Prepara fórmulas y soluciones", "Prepara soluciones antes de envasar.", 3,
     r"prepar(?!acion para hacer vasos)|formula|esencia", ()),
    ("lote", "Pone fecha y lote a lo empacado", "Marca fecha y lote en cada producto y en las bolsas.", 2,
     r"fecha|lote|marcar bolsas|marcacion|marcar productos", ()),
    ("clientes", "Atiende clientes por WhatsApp y chat web", "Responde, cotiza, arma el pedido y hace seguimiento.", 3,
     r"wasap|wsap|whatsapp|contestar|cliente", ("whatsapp", "webchat")),
    ("meli_qa", "Responde preventa y postventa de MeLi", "Contesta preguntas y reclamos de compradores de MeLi.", 3,
     r"preventa|posventa|postventa|reclamo", ("preventa", "postventa")),
    ("facturar", "Factura y resuelve facturas pendientes", "Emite facturas y corrige las que no se dejan facturar.", 4,
     r"factur|sync facturas|siigo|astros|dejan facturar|dejarse facturar", ("facturacion", "astro-killer", "facturas", "cotizar-facturar")),
    ("aprobar", "Aprueba pagos", "Revisa el soporte y la cuenta y aprueba la solicitud de pago.", 4,
     r"aprobar pago|aprobar pagos", ()),
    ("sol_pago", "Cotiza y monta solicitudes de pago", "Pide la cotización, revisa la factura, escoge la cuenta y digita la solicitud.", 4,
     r"crear pagos|montar pago|pago de servicios|pago dian|proformas", ("pagos",)),
    ("compras", "Compra insumos y actualiza stock", "Revisa qué falta, pide a proveedores y ajusta el stock.", 3,
     r"comprar|insumos|pedido de interkrol|stock|stcock|inventario|bodega", ("stock", "control-inventario")),
    ("diseno", "Diseña etiquetas", "Arma y corrige etiquetas en el Studio: textos, formato y aprobación.", 5,
     r"etiqueta nueva|alinearla|intervin.*etiquetado|disen", ("etiquetas", "plantillas-visuales", "etiquetas-config")),
    ("docs", "Hace fichas técnicas, COA y SDS", "Carga datos del proveedor, completa y firma los documentos técnicos.", 5,
     r"ft |fts|coa|ficha|documentos tecnicos", ("fichas",)),
    ("publica", "Publica productos y fotos", "Crea y corrige publicaciones, cambia fotos.", 4,
     r"public|foto|video", ("publicaciones", "sitioweb", "contenido", "publicidad")),
    ("catalogo", "Arma combos y catálogo", "Crea combos, recetas y códigos y los enlaza.", 4,
     r"combo|skus|codigos|vinculacion", ("combos", "catalogo-alegra", "productos-siigo", "mapa-sistema")),
    ("analisis", "Analiza rentabilidad y salud del negocio", "Revisa márgenes, costos y el estado general.", 5,
     r"rentabil", ("rentabilidad", "salud-negocio", "dashboard")),
    ("exterior", "Registra compras al exterior", "Registra compras con tarjeta personal y su reintegro.", 4,
     r"exterior|amazon", ("compras-exterior", "socios")),
    ("contab", "Lleva el Libro Mayor y los impuestos", "Revisa asientos, retenciones, conciliación y la relación con el contador.", 5,
     r"libro mayor|retencion|contador|conciliac", ("libro-mayor", "ingresos-egresos", "conciliacion-contador", "impuestos")),
]
_POR_ID = {c[0]: c for c in CATALOGO}
# Tareas operativas que, para quien desarrolla el sistema, son trabajo sobre el módulo.
_AREA_MODULO = {
    "empacar": "empaque", "envasar": "empaque", "lote": "empaque", "preparar": "empaque", "imprimir_et": "empaque",
    "envio": "envíos", "alistar": "envíos", "embalar": "envíos", "guias": "envíos", "cuaderno": "envíos",
    "clientes": "atención a clientes", "meli_qa": "preventa y postventa", "compras": "stock e inventario",
}


def _lista_env(nombre: str, defecto: str) -> set[str]:
    return {x.strip().lower() for x in (os.getenv(nombre, defecto) or "").split(",") if x.strip()}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def clasificar(titulo: str) -> str | None:
    t = _norm(titulo)
    for cid, *_resto in CATALOGO:
        if re.search(_resto[3], t):
            return cid
    return None


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(f"file:{tickets_db.DB_PATH}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "").split(".")[0])


def _periodo(conn: sqlite3.Connection, usuario_id: int, desde: str, hasta: str) -> dict:
    """Horas y veces por función en [desde, hasta) — fechas UTC como las guarda tickets.db."""
    fx: dict[str, dict] = defaultdict(lambda: {"veces": 0, "h_tarea": 0.0, "n_crono": 0, "h_panel": 0.0})
    for r in conn.execute(
        """SELECT c.iniciada_en, c.finalizada_en, t.titulo FROM ticket_corridas c
           JOIN tickets t ON t.id = c.ticket_id
           WHERE c.usuario_id=? AND c.finalizada_en IS NOT NULL AND c.iniciada_en>=? AND c.iniciada_en<?""",
        (usuario_id, desde, hasta),
    ):
        h = (_dt(r["finalizada_en"]) - _dt(r["iniciada_en"])).total_seconds() / 3600
        if h < 0 or h >= MAX_TAREA_H:
            continue
        k = clasificar(r["titulo"])
        if k:
            fx[k]["veces"] += 1
            fx[k]["h_tarea"] += h
            fx[k]["n_crono"] += 1
    for r in conn.execute(
        """SELECT titulo FROM tickets WHERE asignado_a=? AND creado_en>=? AND creado_en<?
           AND id NOT IN (SELECT ticket_id FROM ticket_corridas WHERE finalizada_en IS NOT NULL)""",
        (usuario_id, desde, hasta),
    ):
        k = clasificar(r["titulo"])
        if k:
            fx[k]["veces"] += 1
    # Tiempo por módulo: hasta la siguiente acción de la misma sesión (máx. 30 min).
    filas = conn.execute(
        """SELECT session_uuid, creado_en, tipo, panel FROM panel_eventos_operativos
           WHERE usuario_id=? AND creado_en>=? AND creado_en<? ORDER BY session_uuid, creado_en""",
        (usuario_id, desde, hasta),
    ).fetchall()
    por_modulo: dict[str, float] = defaultdict(float)
    dias = set()
    for i, r in enumerate(filas):
        dias.add((_dt(r["creado_en"]) - timedelta(hours=5)).date())
        if r["tipo"] == "sesion_fin":
            continue
        sig = filas[i + 1] if i + 1 < len(filas) else None
        gap = 0.05
        if sig is not None and sig["session_uuid"] == r["session_uuid"]:
            gap = min((_dt(sig["creado_en"]) - _dt(r["creado_en"])).total_seconds() / 3600, MAX_GAP_H)
        por_modulo[r["panel"] or ""] += max(gap, 0)
    for cid, *_r in CATALOGO:
        mods = _POR_ID[cid][5]
        h = sum(por_modulo.get(m, 0.0) for m in mods)
        if h:
            fx[cid]["h_panel"] += h
    agenda = por_modulo.get("hugo", 0.0) + por_modulo.get("tickets", 0.0)
    return {"fx": fx, "dias": len(dias), "agenda_h": agenda}


def _filas(fx: dict, *, desarrolla: bool, imprime: bool, factor: float) -> list[dict]:
    filas: list[dict] = []
    modulos: dict[str, dict] = {}
    for cid, r in fx.items():
        h = max(r["h_tarea"], r["h_panel"])
        if h < 0.05 and not r["veces"]:
            continue
        _id, nombre, implica, nivel, _rx, _m = _POR_ID[cid]
        fuente = "cronómetro" if r["h_tarea"] >= r["h_panel"] and r["h_tarea"] > 0 else ("panel" if r["h_panel"] > 0 else "sin tiempo")
        prom = round(r["h_tarea"] * 60 / r["n_crono"]) if r["n_crono"] else None
        if desarrolla and cid in _AREA_MODULO:
            area = _AREA_MODULO[cid]
            m = modulos.setdefault(area, {"id": f"modulo_{area}", "funcion": f"Trabaja el módulo de {area} con IA",
                                          "implica": f"Construye o ajusta el apartado de {area}; no hace la tarea operativa.",
                                          "nivel": 4, "veces": 0, "horas": 0.0, "promedio_min": None, "fuente": "reclasificado"})
            m["veces"] += r["veces"]
            m["horas"] += h * factor
            continue
        if imprime and cid == "diseno":
            cid = "imprimir_studio"
            nombre, implica, nivel = "Imprime y consulta etiquetas en el Studio", "Busca la etiqueta aprobada y la manda a la impresora.", 2
        if imprime and cid == "docs":
            nombre, implica, nivel = "Consulta y adjunta fichas técnicas", "Busca la ficha o el COA de un producto.", 3
        filas.append({"id": cid, "funcion": nombre, "implica": implica, "nivel": nivel, "veces": r["veces"],
                      "horas": h * factor, "promedio_min": prom, "fuente": fuente})
    filas += list(modulos.values())
    for f in filas:
        f["horas"] = round(f["horas"], 1)
    filas.sort(key=lambda f: (-f["horas"], -f["veces"]))
    return [f for f in filas if f["horas"] >= 0.1 or f["veces"]]


def rendimiento_usuario(usuario_id: int, *, dias: int = 30, hoy: datetime | None = None) -> dict:
    """Ficha de rendimiento de los últimos `dias` días, llevada a un mes (30 días)."""
    hoy = hoy or datetime.utcnow()
    fin = hoy.replace(microsecond=0)
    ini = fin - timedelta(days=dias)
    ini_ant = ini - timedelta(days=dias)
    fmt = lambda d: d.strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    with _conn() as conn:
        u = conn.execute("SELECT id, nombre, username FROM usuarios WHERE id=?", (int(usuario_id),)).fetchone()
        if not u:
            raise ValueError("Usuario no encontrado")
        actual = _periodo(conn, u["id"], fmt(ini), fmt(fin))
        anterior = _periodo(conn, u["id"], fmt(ini_ant), fmt(ini))
    user = (u["username"] or "").lower()
    desarrolla = user in _lista_env("RENDIMIENTO_DESARROLLADORES", "armando,@cynthia")
    imprime = user in _lista_env("RENDIMIENTO_IMPRIMEN", "jerry,vitor")
    factor = 30 / dias
    funciones = _filas(actual["fx"], desarrolla=desarrolla, imprime=imprime, factor=factor)
    previas = _filas(anterior["fx"], desarrolla=desarrolla, imprime=imprime, factor=factor)
    horas = round(sum(f["horas"] for f in funciones), 1)
    horas_ant = round(sum(f["horas"] for f in previas), 1)
    tipos = []
    for n, nombre in NIVELES.items():
        h = sum(f["horas"] for f in funciones if f["nivel"] == n)
        if h >= 0.1 and horas and round(h / horas * 100) >= 1:
            tipos.append({"nivel": n, "nombre": nombre, "horas": round(h, 1),
                          "porcentaje": round(h / horas * 100) if horas else 0})
    return {
        "usuario": {"id": u["id"], "nombre": u["nombre"], "username": u["username"]},
        "periodo": {"desde": ini.date().isoformat(), "hasta": fin.date().isoformat(), "dias": dias},
        "horas_mes": horas,
        "horas_mes_anterior": horas_ant,
        "variacion_pct": round((horas - horas_ant) / horas_ant * 100) if horas_ant else None,
        "dias_activos": actual["dias"],
        "jornada_referencia": JORNADA_H,
        "funciones": funciones,
        "tipos": tipos,
        "agenda_horas": round(actual["agenda_h"] * factor, 1),
        "nota": ("Horas registradas en el panel: tareas con cronómetro y tiempo en cada módulo. "
                 "El trabajo que no se registra no aparece."
                 + (" El desarrollo del sistema (sesiones con IA y cambios de código) ocurre fuera del panel y no está sumado aquí."
                    if desarrolla else "")),
    }


def equipo_para_selector() -> list[dict]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, nombre, username FROM usuarios WHERE activo=1 AND username NOT IN ('tester','prueba','hugo_ia_bot','admin') ORDER BY nombre"
        )]


def horas_entre(usuario_id: int, desde_local: datetime, hasta_local: datetime) -> dict:
    """Horas registradas entre dos instantes en hora de Bogotá (sin llevar a mes).
    Devuelve el total y las funciones, con las mismas reglas de la ficha."""
    fmt = lambda d: (d + timedelta(hours=5)).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731  Bogotá → UTC
    with _conn() as conn:
        u = conn.execute("SELECT id, username FROM usuarios WHERE id=?", (int(usuario_id),)).fetchone()
        if not u:
            raise ValueError("Usuario no encontrado")
        per = _periodo(conn, u["id"], fmt(desde_local), fmt(hasta_local))
    user = (u["username"] or "").lower()
    funciones = _filas(per["fx"], desarrolla=user in _lista_env("RENDIMIENTO_DESARROLLADORES", "armando,@cynthia"),
                       imprime=user in _lista_env("RENDIMIENTO_IMPRIMEN", "jerry,vitor"), factor=1.0)
    return {"horas": round(sum(f["horas"] for f in funciones), 2), "funciones": funciones}
