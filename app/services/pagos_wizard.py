"""
Solicitudes de pago con asiento contable automático.

**El problema que resuelve.** Hasta sep-2026 los pagos se aprobaban como tickets
de texto libre ("APROBAR PAGO DE FACTORES", "APROBAR PAGO INTERRAPIDISIMO") y el
asiento contable dependía de que alguien se acordara de hacerlo después. No se
hacía: el Libro Mayor tenía las compras pero no los pagos, y por eso Bancos
quedaba descuadrado.

Acá el asiento **nace del acto de pagar**, no de un paso posterior que se olvida.
Es el mismo patrón que ya falló tres veces en este repo cuando se dejó como tarea
manual: notas crédito (6 semanas sin trabajar), compras Gmail (96 sin postear),
pagos a proveedores.

**Flujo:**

    1. Jenniffer crea la solicitud eligiendo QUÉ se paga (categoría)
    2. El wizard resuelve cuenta contable y tercero, y arma el asiento
    3. **Se muestra el asiento ANTES de aprobar** — quien aprueba ve
       "Débito 2205 Interkrol / Crédito 1110 Bancos" y confirma con eso a la vista
    4. Al aprobar: asiento en el Libro Mayor + comprobante contable en Alegra

El paso 3 es deliberado: un asiento que se crea invisible es un asiento que nadie
revisa, y acá se está moviendo plata real.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import date

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "contabilidad.db")
_initialized = False

ESTADOS = ("borrador", "pendiente", "aprobada", "pagada", "rechazada", "anulada")


@contextmanager
def _conn():
    con = sqlite3.connect(_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


# ─── Categorías de pago ─────────────────────────────────────────────────────
# Sacadas de lo que McKenna paga de verdad (tickets históricos, módulos de
# mensajería/servicios, saldos de 2205 y 2380), no de una lista genérica.
#
# Cada categoría sabe:
#   cuenta_debito  — contra qué se carga (pasivo que se extingue, o gasto)
#   origen         — de dónde salen las opciones a elegir (si las hay)
#   requiere_tercero — si el asiento debe llevar tercero
#
# `None` en cuenta_debito significa que la elige el usuario (categoría "otro").

CATEGORIAS: dict[str, dict] = {
    "factura_proveedor": {
        "label": "Factura de proveedor",
        "ayuda": "Paga una factura ya registrada. Baja la deuda con el proveedor.",
        "cuenta_debito": "2205",
        "origen": "saldos_proveedores",
        "requiere_tercero": True,
        "icono": "📄",
    },
    "flete_transporte": {
        "label": "Flete o transporte",
        "ayuda": "Interrapidísimo, guías, acarreos, envíos. Va a gasto, no baja ninguna deuda previa.",
        "cuenta_debito": "513550",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "🚚",
    },
    "servicio_publico": {
        "label": "Servicio público",
        "ayuda": "Energía, acueducto, gas, teléfono e internet. Cada uno a su cuenta.",
        "cuenta_debito": None,   # depende del servicio elegido
        "origen": "servicios",
        "requiere_tercero": False,
        "icono": "💡",
        "cuentas_por_tipo": {
            "luz": "513530", "energia": "513530",
            "agua": "513525", "acueducto": "513525",
            "gas": "513555",
            "internet": "513535", "telefono": "513535",
            "saas": "513560",
        },
    },
    "honorarios": {
        "label": "Honorarios",
        "ayuda": "Contador, abogado, asesorías. Lleva retención si supera la cuantía mínima.",
        "cuenta_debito": "5110",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "👔",
        "concepto_retencion": "honorarios",
    },
    "prestacion_servicios": {
        "label": "Prestación de servicios",
        "ayuda": (
            "Personas que le prestan servicios a McKenna sin ser nómina: calidad, "
            "empaque, apoyo operativo. Retención de servicios (4% declarante / 6% no "
            "declarante), NO la de honorarios."
        ),
        "cuenta_debito": "5135",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "🧰",
        "concepto_retencion": "servicios",
    },
    "arrendamiento": {
        "label": "Arrendamiento",
        "ayuda": "Oficina, bodega, equipos.",
        "cuenta_debito": "5120",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "🏢",
    },
    "nomina": {
        "label": "Nómina",
        "ayuda": "Sueldos y salarios del personal.",
        "cuenta_debito": "5105",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "👥",
    },
    "cuota_prestamo": {
        "label": "Cuota de préstamo",
        "ayuda": "Toma la cuota del cronograma: separa capital, interés y retención.",
        "cuenta_debito": None,   # el módulo de préstamos arma el asiento
        "origen": "cuotas_prestamo",
        "requiere_tercero": True,
        "icono": "🤝",
    },
    "reintegro_socio": {
        "label": "Reintegro a socio",
        "ayuda": "Devuelve al socio lo que puso con su tarjeta personal.",
        "cuenta_debito": "2380",
        "origen": "saldos_socios",
        "requiere_tercero": True,
        "icono": "💳",
    },
    "impuestos": {
        "label": "Impuestos y retenciones",
        "ayuda": "Declaración de retención en la fuente, IVA, ICA.",
        "cuenta_debito": "2365",
        "origen": "saldos_impuestos",
        "requiere_tercero": False,
        "icono": "🏛️",
    },
    "seguros": {
        "label": "Seguros",
        "ayuda": "Pólizas de vida, vehículos, incendios.",
        "cuenta_debito": "5130",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "🛡️",
    },
    "mantenimiento": {
        "label": "Mantenimiento y reparaciones",
        "ayuda": "Arreglos de equipos, locativos.",
        "cuenta_debito": "5145",
        "origen": "libre",
        "requiere_tercero": True,
        "icono": "🔧",
    },
    "otro": {
        "label": "Otro gasto",
        "ayuda": "Cuando no encaja en ninguna de arriba. Hay que elegir la cuenta a mano.",
        "cuenta_debito": None,
        "origen": "libre",
        "requiere_tercero": False,
        "icono": "📌",
    },
}


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    import app.services.contabilidad_core as cc

    cc.init_db()
    with _conn() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS cc_solicitudes_pago (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoria TEXT NOT NULL,
            concepto TEXT NOT NULL,
            monto REAL NOT NULL,
            fecha TEXT NOT NULL,
            tercero_id INTEGER REFERENCES cc_terceros(id),
            cuenta_debito TEXT NOT NULL DEFAULT '',
            medio_pago_id INTEGER REFERENCES cc_medios_pago(id),
            referencia TEXT NOT NULL DEFAULT '',
            origen_ref TEXT NOT NULL DEFAULT '',
            retencion REAL NOT NULL DEFAULT 0,
            retencion_concepto TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL DEFAULT 'pendiente',
            notas TEXT NOT NULL DEFAULT '',
            ticket_id INTEGER,
            movimiento_id INTEGER REFERENCES cc_movimientos(id),
            alegra_journal_id TEXT NOT NULL DEFAULT '',
            creada_por INTEGER,
            aprobada_por INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            aprobada_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_cc_solicitudes_estado
            ON cc_solicitudes_pago(estado, fecha);
        """)
    _initialized = True


def _ensure() -> None:
    if not _initialized:
        init_db()


# ─── Paso 1: qué se puede pagar en cada categoría ───────────────────────────

def opciones(categoria: str) -> dict:
    """Lo que el wizard ofrece a elegir dentro de una categoría.

    Sale de los saldos y módulos reales, no de una lista escrita a mano: así lo
    que se ofrece pagar es lo que de verdad está pendiente.
    """
    _ensure()
    cat = CATEGORIAS.get(categoria)
    if not cat:
        raise ValueError(f"Categoría desconocida: {categoria}")
    origen = cat["origen"]

    if origen == "saldos_proveedores":
        import app.services.contabilidad_core as cc

        with cc._conn() as con:
            filas = [
                {
                    "id": r["tercero_id"], "label": r["nombre"],
                    "identificacion": r["identificacion"] or "",
                    "monto_sugerido": round(float(r["saldo"] or 0), 2),
                    "detalle": f"saldo pendiente {round(float(r['saldo'] or 0)):,}".replace(",", "."),
                }
                for r in con.execute(
                    """SELECT t.id AS tercero_id, t.nombre, t.identificacion,
                              SUM(l.credito - l.debito) AS saldo
                         FROM cc_movimiento_lineas l
                         JOIN cc_movimientos m ON m.id=l.movimiento_id AND m.estado<>'anulado'
                         JOIN cc_plan_cuentas c ON c.id=l.cuenta_id
                         JOIN cc_terceros t ON t.id=l.tercero_id
                        WHERE c.codigo='2205'
                        GROUP BY t.id HAVING ROUND(SUM(l.credito-l.debito),2) > 0
                        ORDER BY saldo DESC"""
                )
            ]
        return {"tipo": "lista", "opciones": filas}

    if origen == "saldos_socios":
        from app.services.compras_socios import saldo_socios

        return {"tipo": "lista", "opciones": [
            {"id": s["tercero_id"], "label": s["nombre"], "identificacion": s["identificacion"],
             "monto_sugerido": s["saldo"],
             "detalle": f"se le deben {round(s['saldo']):,}".replace(",", ".")}
            for s in saldo_socios()
        ]}

    if origen == "cuotas_prestamo":
        from app.services.prestamos import cuotas_del_mes

        hoy = date.today()
        cuotas = cuotas_del_mes(hoy.year, hoy.month) + cuotas_del_mes(
            hoy.year + (hoy.month == 12), (hoy.month % 12) + 1
        )
        return {"tipo": "lista", "opciones": [
            {"id": f"{c['prestamo_id']}:{c['numero']}", "label": c["tercero_nombre"],
             "identificacion": c["identificacion"] or "",
             "monto_sugerido": round(float(c["cuota_girada"]), 2),
             "detalle": f"cuota {c['numero']}/{c['plazo_meses']} vence {c['fecha_vencimiento']}"}
            for c in cuotas
        ]}

    if origen == "servicios":
        import sqlite3 as _sq

        try:
            db = _sq.connect(_DB_PATH); db.row_factory = _sq.Row
            filas = [
                {"id": r["id"], "label": r["empresa"], "tipo_servicio": r["tipo"],
                 "detalle": f"{r['tipo']}" + (f" · vence día {r['dia_vencimiento']}" if r["dia_vencimiento"] else "")}
                for r in db.execute(
                    "SELECT id, empresa, tipo, dia_vencimiento FROM servicios WHERE activo=1 ORDER BY tipo, empresa")
            ]
            db.close()
        except Exception:
            filas = []
        return {"tipo": "lista", "opciones": filas}

    if origen == "saldos_impuestos":
        from app.services.retenciones import resumen_periodo

        hoy = date.today()
        anio, mes = (hoy.year - 1, 12) if hoy.month == 1 else (hoy.year, hoy.month - 1)
        r = resumen_periodo(anio, mes)
        if r["total_retencion"] <= 0:
            return {"tipo": "lista", "opciones": []}
        return {"tipo": "lista", "opciones": [{
            "id": r["periodo"], "label": f"Retención en la fuente {r['periodo']}",
            "monto_sugerido": r["total_retencion"],
            "detalle": (f"vence {r['vencimiento'].get('fecha')}"
                        if r["vencimiento"].get("conocido") else "vencimiento sin confirmar"),
        }]}

    return {"tipo": "libre", "opciones": []}


# ─── Paso 2: armar el asiento (sin guardarlo) ───────────────────────────────

def _cuenta_servicio(tipo_servicio: str) -> str:
    """Cuenta según el tipo de servicio público. Cae a «otros servicios» si no
    se reconoce, en vez de fallar: el pago tiene que poder registrarse."""
    mapa = CATEGORIAS["servicio_publico"]["cuentas_por_tipo"]
    return mapa.get(str(tipo_servicio or "").strip().lower(), "513595")


def previsualizar(payload: dict) -> dict:
    """Arma el asiento que se crearía, **sin guardarlo**.

    Es el corazón del diseño: quien aprueba ve el asiento antes de firmar. Un
    asiento que se crea invisible es un asiento que nadie revisa, y acá se está
    moviendo plata real.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    categoria = str(payload.get("categoria") or "").strip()
    cat = CATEGORIAS.get(categoria)
    if not cat:
        raise ValueError(f"Categoría desconocida: {categoria}")

    monto = round(float(payload.get("monto") or 0), 2)
    if monto <= 0:
        raise ValueError("El monto debe ser mayor que cero")
    fecha = str(payload.get("fecha") or date.today().isoformat())[:10]
    concepto = str(payload.get("concepto") or "").strip()
    tercero_id = int(payload.get("tercero_id") or 0) or None
    medio_pago_id = int(payload.get("medio_pago_id") or 0) or None

    # Cuenta de débito: la de la categoría, la del servicio, o la que eligió el
    # usuario en las categorías abiertas.
    cuenta_debito = cat["cuenta_debito"]
    if categoria == "servicio_publico":
        cuenta_debito = _cuenta_servicio(payload.get("tipo_servicio"))
    if not cuenta_debito:
        cuenta_debito = str(payload.get("cuenta_debito") or "").strip()
    if not cuenta_debito:
        raise ValueError("Falta elegir la cuenta contable del gasto")

    if cat["requiere_tercero"] and not tercero_id:
        raise ValueError(f"«{cat['label']}» necesita un tercero: es a quien se le paga")
    if not medio_pago_id:
        raise ValueError("Falta el medio de pago (de qué cuenta sale la plata)")

    medio = cc.obtener_medio_pago(medio_pago_id)
    if not medio:
        raise ValueError("Medio de pago no encontrado")
    tercero = cc.obtener_tercero(tercero_id) if tercero_id else None

    # Retención, si la categoría la lleva y supera la cuantía mínima.
    retencion, ret_info = 0.0, None
    concepto_ret = cat.get("concepto_retencion")
    if concepto_ret and not payload.get("sin_retencion"):
        from app.services.retenciones import calcular

        declarante = bool(tercero.get("declarante", 1)) if tercero else True
        ret_info = calcular(concepto_ret, monto, anio=int(fecha[:4]), declarante=declarante)
        retencion = round(float(ret_info.get("retencion") or 0), 2)

    with cc._conn() as con:
        id_debito = cc._cuenta_id_por_codigo(con, cuenta_debito)
        id_retencion = cc._cuenta_id_por_codigo(con, "2365") if retencion > 0 else None
    if not id_debito:
        raise ValueError(f"La cuenta {cuenta_debito} no existe en el plan")

    nombre_tercero = (tercero or {}).get("nombre") or ""
    girado = round(monto - retencion, 2)
    lineas = [{
        "cuenta_codigo": cuenta_debito,
        "cuenta_id": id_debito,
        "debito": monto, "credito": 0,
        "tercero_id": tercero_id,
        "descripcion": concepto or cat["label"],
    }]
    if retencion > 0:
        lineas.append({
            "cuenta_codigo": "2365", "cuenta_id": id_retencion,
            "debito": 0, "credito": retencion, "tercero_id": tercero_id,
            "descripcion": f"Retención {concepto_ret} {ret_info.get('tarifa_pct')}% — {nombre_tercero}",
        })
    lineas.append({
        "cuenta_codigo": "1110", "cuenta_id": medio["cuenta_id"],
        "debito": 0, "credito": girado,
        "descripcion": f"Salida vía {medio['nombre']}" + (f" — {nombre_tercero}" if nombre_tercero else ""),
    })

    nombres = {c["codigo"]: c["nombre"] for c in cc.listar_plan_cuentas(solo_activas=False)}
    for l in lineas:
        l["cuenta_nombre"] = nombres.get(l["cuenta_codigo"], "")

    return {
        "categoria": categoria,
        "categoria_label": cat["label"],
        "concepto": concepto or cat["label"],
        "fecha": fecha,
        "monto": monto,
        "retencion": retencion,
        "retencion_motivo": (ret_info or {}).get("motivo", ""),
        "girado": girado,
        "tercero": {"id": tercero_id, "nombre": nombre_tercero} if tercero_id else None,
        "medio_pago": medio["nombre"],
        "lineas": lineas,
        "cuadra": abs(sum(l["debito"] for l in lineas) - sum(l["credito"] for l in lineas)) < 0.01,
    }


# ─── Paso 3: crear la solicitud (todavía sin asiento) ───────────────────────

def crear_solicitud(payload: dict, created_by: int | None = None) -> dict:
    """Guarda la solicitud en estado `pendiente` y abre el ticket de aprobación.

    **No crea el asiento todavía**: se crea al aprobar. Una solicitud rechazada
    no debe dejar rastro contable.
    """
    _ensure()
    prev = previsualizar(payload)   # valida todo antes de guardar

    categoria = prev["categoria"]
    cuenta_debito = prev["lineas"][0]["cuenta_codigo"]
    with _conn() as con:
        cur = con.execute(
            """INSERT INTO cc_solicitudes_pago
                 (categoria, concepto, monto, fecha, tercero_id, cuenta_debito,
                  medio_pago_id, referencia, origen_ref, retencion, retencion_concepto,
                  estado, notas, creada_por)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'pendiente',?,?)""",
            (
                categoria, prev["concepto"], prev["monto"], prev["fecha"],
                (prev["tercero"] or {}).get("id"), cuenta_debito,
                int(payload.get("medio_pago_id") or 0) or None,
                str(payload.get("referencia") or ""), str(payload.get("origen_ref") or ""),
                prev["retencion"], str(CATEGORIAS[categoria].get("concepto_retencion") or ""),
                str(payload.get("notas") or ""), created_by,
            ),
        )
        sid = int(cur.lastrowid)

    # El registro directo se aprueba solo: un ticket de aprobación que nace
    # resuelto es ruido en la bandeja de alguien.
    ticket_id = None if payload.get("_sin_ticket") else _abrir_ticket(sid, prev, created_by)
    if ticket_id:
        with _conn() as con:
            con.execute("UPDATE cc_solicitudes_pago SET ticket_id=? WHERE id=?", (ticket_id, sid))
    return {**obtener(sid), "previsualizacion": prev}


def _fmt(n) -> str:
    return "$" + f"{round(float(n or 0)):,}".replace(",", ".")


def _abrir_ticket(sid: int, prev: dict, created_by: int | None) -> int | None:
    """Ticket de aprobación con el asiento a la vista.

    Quien aprueba tiene que ver qué va a quedar contabilizado — aprobar un monto
    sin ver contra qué cuenta va es firmar a ciegas.
    """
    try:
        from app.services import tickets_db as _tdb

        _tdb.init_db()
        filas = "\n".join(
            f"  {l['cuenta_codigo']:<8} {l['cuenta_nombre'][:34]:<34} "
            f"D {_fmt(l['debito']):>14}  C {_fmt(l['credito']):>14}"
            for l in prev["lineas"]
        )
        desc = (
            f"**Solicitud de pago #{sid} — {prev['categoria_label']}**\n\n"
            f"Concepto: {prev['concepto']}\n"
            f"Fecha: {prev['fecha']} · Medio: {prev['medio_pago']}\n"
            + (f"A nombre de: {prev['tercero']['nombre']}\n" if prev.get("tercero") else "")
            + f"\n**Monto: {_fmt(prev['monto'])}**"
            + (f" · retención {_fmt(prev['retencion'])} → **se gira {_fmt(prev['girado'])}**"
               if prev["retencion"] > 0 else "")
            + "\n\n**Asiento contable que va a quedar al aprobar:**\n```\n"
            + filas + "\n```\n"
            + (f"\n_{prev['retencion_motivo']}_\n" if prev.get("retencion_motivo") else "")
            + "\nAl aprobar se registra en el Libro Mayor y se espeja a Alegra.\n\n"
            f"{MARCA_SOLICITUD} {sid}"
        )
        creador = created_by or _usuario_id(_tdb.DB_PATH, "admin")
        if not creador:
            return None
        aprobador = _usuario_id(_tdb.DB_PATH, os.getenv("PAGOS_APROBADOR", "armando"))
        t, err = _tdb.crear_ticket(
            {"tipo": "solicitud", "subtipo": "pago",
             "titulo": f"Aprobar pago — {prev['categoria_label']}: {_fmt(prev['monto'])}",
             "categoria": "contabilidad", "descripcion": desc,
             "prioridad": "alta", "asignado_a": aprobador},
            creador, None,
        )
        return t.get("id") if not err else None
    except Exception as e:
        print(f"⚠️ Solicitud {sid}: no se pudo abrir el ticket: {e}", flush=True)
        return None


MARCA_SOLICITUD = "SYS_SOLICITUD_PAGO:"


def _usuario_id(db_path: str, username: str) -> int | None:
    try:
        db = sqlite3.connect(db_path); db.row_factory = sqlite3.Row
        r = db.execute("SELECT id FROM usuarios WHERE username=? AND activo=1", (username,)).fetchone()
        return int(r["id"]) if r else None
    except Exception:
        return None
    finally:
        try: db.close()
        except Exception: pass


def obtener(sid: int) -> dict | None:
    _ensure()
    import app.services.contabilidad_core as cc

    with _conn() as con:
        r = con.execute("SELECT * FROM cc_solicitudes_pago WHERE id=?", (int(sid),)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["categoria_label"] = CATEGORIAS.get(d["categoria"], {}).get("label", d["categoria"])
    d["icono"] = CATEGORIAS.get(d["categoria"], {}).get("icono", "📌")
    d["girado"] = round(float(d["monto"] or 0) - float(d["retencion"] or 0), 2)
    if d.get("tercero_id"):
        t = cc.obtener_tercero(d["tercero_id"])
        d["tercero"] = {"id": t["id"], "nombre": t["nombre"], "identificacion": t["identificacion"]} if t else None
    else:
        d["tercero"] = None
    return d


def listar(estado: str | None = None, limit: int = 200) -> list[dict]:
    _ensure()
    with _conn() as con:
        sql = "SELECT id FROM cc_solicitudes_pago"
        params: list = []
        if estado:
            sql += " WHERE estado=?"; params.append(estado)
        sql += " ORDER BY fecha DESC, id DESC LIMIT ?"; params.append(int(limit))
        ids = [r["id"] for r in con.execute(sql, params)]
    return [obtener(i) for i in ids]


# ─── Paso 4: aprobar → asiento en el libro + comprobante en Alegra ──────────

def aprobar(sid: int, aprobada_por: int | None = None, *, espejar: bool = True) -> dict:
    """Aprueba la solicitud y **ahí sí** crea el asiento.

    El espejo a Alegra no es condición para aprobar: si Alegra falla, el asiento
    del Libro Mayor ya quedó y el espejo se reintenta. Perder el registro interno
    por un problema de red con un tercero sería el peor de los dos mundos.
    """
    _ensure()
    import app.services.contabilidad_core as cc

    s = obtener(sid)
    if not s:
        raise ValueError(f"Solicitud {sid} no encontrada")
    if s["estado"] == "aprobada":
        return {**s, "ya_aprobada": True}
    if s["estado"] in ("rechazada", "anulada"):
        raise ValueError(f"La solicitud está {s['estado']}, no se puede aprobar")

    # Se rearma el asiento con los datos guardados: así lo que se contabiliza es
    # lo que se aprobó, no lo que el frontend mande en el momento de aprobar.
    prev = previsualizar({
        "categoria": s["categoria"], "monto": s["monto"], "fecha": s["fecha"],
        "concepto": s["concepto"], "tercero_id": s["tercero_id"],
        "medio_pago_id": s["medio_pago_id"], "cuenta_debito": s["cuenta_debito"],
        "sin_retencion": True,   # la retención ya está fijada en la solicitud
    })
    lineas = [
        {k: v for k, v in l.items() if k in ("cuenta_id", "debito", "credito", "tercero_id", "descripcion")}
        for l in prev["lineas"]
    ]
    # Reinyectar la retención tal como se aprobó
    if float(s["retencion"] or 0) > 0:
        with cc._conn() as con:
            id_ret = cc._cuenta_id_por_codigo(con, "2365")
        ret = round(float(s["retencion"]), 2)
        lineas = [lineas[0],
                  {"cuenta_id": id_ret, "debito": 0, "credito": ret,
                   "tercero_id": s["tercero_id"],
                   "descripcion": f"Retención {s['retencion_concepto']} — {(s.get('tercero') or {}).get('nombre','')}"},
                  {**lineas[-1], "credito": round(float(s["monto"]) - ret, 2)}]

    mov = cc.crear_movimiento(
        fecha=s["fecha"],
        concepto=f"{s['concepto']} — {s['categoria_label']}",
        lineas=lineas,
        tercero_id=s["tercero_id"],
        referencia=s["referencia"] or f"pago:{sid}",
        tipo_origen="solicitud_pago",
        plantilla_datos={"solicitud_id": sid, "categoria": s["categoria"]},
        created_by=aprobada_por,
    )

    with _conn() as con:
        con.execute(
            "UPDATE cc_solicitudes_pago SET estado='aprobada', movimiento_id=?,"
            " aprobada_por=?, aprobada_at=datetime('now') WHERE id=?",
            (mov.get("id"), aprobada_por, int(sid)),
        )

    espejo = {"status": "omitido"}
    if espejar:
        try:
            from app.services.alegra_espejo import espejar_movimiento

            # `forzar`: aprobar ES la autorización explícita, con el asiento a la
            # vista. ALEGRA_ESPEJO_ACTIVO protege los posteos masivos; sin forzar,
            # cada pago aprobado quedaba en sombra y el panel —que promete el
            # comprobante en Alegra— lo marcaba «sin espejar».
            espejo = espejar_movimiento(mov["id"], forzar=True)
            if espejo.get("status") == "success":
                with _conn() as con:
                    con.execute("UPDATE cc_solicitudes_pago SET alegra_journal_id=? WHERE id=?",
                                (espejo.get("id"), int(sid)))
        except Exception as e:
            espejo = {"status": "error", "message": str(e)}

    _comentar_ticket(
        s.get("ticket_id"), aprobada_por,
        f"✅ Pago aprobado (solicitud #{sid}). Asiento #{mov.get('id')} en el Libro Mayor"
        + (f" · comprobante Alegra #{espejo.get('id')}" if espejo.get("status") == "success"
           else f" · Alegra: {espejo.get('status')}")
        + f". Girar {_fmt(s['girado'])} a {(s.get('tercero') or {}).get('nombre') or 'el beneficiario'}"
        f" desde {prev['medio_pago']} — ese es el valor que debe aparecer en el extracto.",
    )
    return {**obtener(sid), "movimiento": mov, "alegra": espejo}


def _comentar_ticket(ticket_id, usuario_id, texto: str) -> None:
    """Deja en el ticket de la solicitud lo que pasó con ella.

    Aprobar desde el panel de pagos no tocaba el ticket: quedaba «pendiente» en
    la bandeja aunque el pago ya estuviera contabilizado, y quien tiene que girar
    no se enteraba. Best-effort — el asiento ya quedó y no depende de esto.
    """
    if not ticket_id:
        return
    try:
        from app.services import tickets_db as _tdb

        uid = usuario_id or _usuario_id(_tdb.DB_PATH, "admin")
        if uid:
            _tdb.agregar_comentario(int(ticket_id), int(uid), texto)
    except Exception as e:
        print(f"⚠️ No se pudo comentar el ticket {ticket_id}: {e}", flush=True)


def rechazar(sid: int, motivo: str = "", por: int | None = None) -> dict:
    """Rechaza sin dejar rastro contable — ese es el punto de no crear el
    asiento al solicitar."""
    _ensure()
    s = obtener(sid)
    if not s:
        raise ValueError(f"Solicitud {sid} no encontrada")
    if s["estado"] == "aprobada":
        raise ValueError("Ya está aprobada: para revertirla hay que anular el asiento en el Libro Mayor")
    with _conn() as con:
        con.execute(
            "UPDATE cc_solicitudes_pago SET estado='rechazada',"
            " notas = TRIM(notas || ' | Rechazada: ' || ?), aprobada_por=? WHERE id=?",
            (motivo or "sin motivo", por, int(sid)),
        )
    _comentar_ticket(s.get("ticket_id"), por,
                     f"❌ Solicitud de pago #{sid} rechazada: {motivo or 'sin motivo'}. "
                     "No quedó ningún asiento contable.")
    return obtener(sid)


def resumen() -> dict:
    """KPIs para la cabecera del panel."""
    _ensure()
    with _conn() as con:
        filas = list(con.execute(
            "SELECT estado, COUNT(*) n, COALESCE(SUM(monto),0) total"
            " FROM cc_solicitudes_pago GROUP BY estado"))
    por_estado = {r["estado"]: {"n": r["n"], "total": round(float(r["total"] or 0), 2)} for r in filas}
    return {
        "por_estado": por_estado,
        "pendientes": por_estado.get("pendiente", {"n": 0, "total": 0}),
        "aprobadas": por_estado.get("aprobada", {"n": 0, "total": 0}),
    }


# ─── Registro directo (sin ciclo de aprobación) ─────────────────────────────
# Los socios montan y aprueban sus propios pagos: pedirles que se auto-aprueben
# en dos pasos es burocracia sin control real. Lo que NO se salta es ver el
# asiento antes de confirmar — eso sigue igual para todos.
#
# Queda registrado quién lo hizo y que fue auto-aprobado (`autoaprobada`), para
# que en una revisión se pueda distinguir de un pago que sí pasó por otro par de
# ojos. Saltarse el control es válido; ocultarlo no.

def puede_registrar_directo(usuario: dict | None) -> bool:
    """Solo nivel administrador. A diferencia de `es_admin_vista_equipo`, acá
    Cynthia SÍ entra: es socia y registra sus propios pagos."""
    if not usuario:
        return False
    return int((usuario.get("rol") or {}).get("nivel") or 0) >= 3


def registrar_pago_directo(
    payload: dict, usuario: dict | None = None, *, espejar: bool = True
) -> dict:
    """Crea la solicitud YA aprobada y su asiento, en un solo paso.

    Mismo motor que el flujo con aprobación: `previsualizar` valida y arma, y
    `aprobar` contabiliza. Acá solo se encadenan, así no hay dos caminos que
    puedan divergir en cómo queda el asiento.
    """
    _ensure()
    if not puede_registrar_directo(usuario):
        raise ValueError(
            "Solo un administrador puede registrar un pago sin aprobación. "
            "Usa «Solicitar un pago» para que alguien lo apruebe."
        )
    uid = int(usuario.get("id")) if usuario and usuario.get("id") else None

    s = crear_solicitud({**payload, "_sin_ticket": True}, created_by=uid)
    with _conn() as con:
        nota = "Registrado directamente por " + str((usuario or {}).get("nombre") or "admin")
        con.execute(
            "UPDATE cc_solicitudes_pago SET notas = TRIM(COALESCE(notas,'') || ' | ' || ?) WHERE id=?",
            (nota, s["id"]),
        )
    return {**aprobar(s["id"], aprobada_por=uid, espejar=espejar), "autoaprobada": True}
