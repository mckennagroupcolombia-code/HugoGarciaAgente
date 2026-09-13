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
    # Las dos categorías de proveedor llevan el flujo completo del wizard (sep-2026):
    # proveedor del listado (libro + Alegra), productos con SKU del catálogo Alegra y la
    # factura/cotización cotejada contra lo pedido antes de enviar. `con_productos` es lo que
    # lo activa en el panel; `requiere_factura` obliga a adjuntar y cotejar el documento.
    "compra_proveedor": {
        "label": "Compra a proveedor",
        "ayuda": "Pagar una compra de productos a un proveedor: se eligen los productos con su SKU y se coteja la factura o cotización.",
        "cuenta_debito": "1435",
        "origen": "proveedores",
        "requiere_tercero": True,
        "icono": "🧾",
        "con_productos": True,
        "requiere_factura": True,
        "concepto_retencion": "compras",
    },
    "factura_proveedor": {
        "label": "Factura de proveedor ya registrada",
        "ayuda": "Paga una factura que ya está en el libro (baja la deuda en 2205). También pide productos y factura.",
        "cuenta_debito": "2205",
        "origen": "saldos_proveedores",
        "requiere_tercero": True,
        "icono": "📄",
        "con_productos": True,
        "requiere_factura": True,
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
        cols = {r["name"] for r in con.execute("PRAGMA table_info(cc_solicitudes_pago)")}
        for col, ddl in (
            ("items_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("factura_numero", "TEXT NOT NULL DEFAULT ''"),
            ("factura_archivo", "TEXT NOT NULL DEFAULT ''"),
            ("factura_nombre", "TEXT NOT NULL DEFAULT ''"),
            ("verificacion_json", "TEXT NOT NULL DEFAULT '{}'"),
            # Pagos recurrentes: una solicitud puede guardarse como plantilla y
            # el cron la instancia cada período con los datos ya cargados.
            ("es_plantilla", "INTEGER NOT NULL DEFAULT 0"),
            ("frecuencia", "TEXT NOT NULL DEFAULT ''"),
            ("plantilla_id", "INTEGER"),
            ("periodo", "TEXT NOT NULL DEFAULT ''"),
            ("origen_sistema", "TEXT NOT NULL DEFAULT ''"),
        ):
            if col not in cols:
                con.execute(f"ALTER TABLE cc_solicitudes_pago ADD COLUMN {col} {ddl}")
        # Un mismo pago no puede entrar dos veces. La idempotencia vive en la
        # base, no en el cron: si el cron corre dos veces, o corren dos crons,
        # el segundo choca contra el índice en vez de duplicar la solicitud.
        con.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_solicitudes_origen"
            " ON cc_solicitudes_pago(origen_ref) WHERE origen_ref <> ''"
        )
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

    if origen == "proveedores":
        from app.services.pagos_proveedor import proveedores

        return {"tipo": "proveedores", "opciones": [
            {"id": p["id"] or f"alegra:{p['alegra_id']}", "label": p["nombre"],
             "identificacion": p["identificacion"], "monto_sugerido": p["saldo_2205"] or None,
             "detalle": ("saldo pendiente " + f"{p['saldo_2205']:,}".replace(",", ".")) if p["saldo_2205"] else
                        ("en el Libro Mayor" if p["en_libro"] else "contacto de Alegra (se adopta al elegirlo)"),
             "en_libro": p["en_libro"], "alegra_id": p["alegra_id"]}
            for p in proveedores()
        ]}

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

    from app.services.pagos_proveedor import normalizar_items

    items = normalizar_items(payload.get("items")) if cat.get("con_productos") else []
    total_items = round(sum(i["total"] for i in items), 2)          # con IVA: lo que cobra la factura
    base_sin_iva = round(sum(i["subtotal"] for i in items), 2)     # base de la retención
    iva_items = round(sum(i["iva"] for i in items), 2)
    monto = round(float(payload.get("monto") or 0), 2)
    if items and monto <= 0:
        monto = total_items
    if monto <= 0:
        raise ValueError("El monto debe ser mayor que cero")
    if items and abs(total_items - monto) > 1:
        raise ValueError(
            f"El monto ({monto:,.0f}) no coincide con la suma de los productos ({total_items:,.0f})".replace(",", ".")
        )
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
    if not cuenta_debito and categoria == "cuota_prestamo":
        # La arma el módulo de préstamos más abajo, con las cuatro líneas
        # reales; esta es solo la que encabeza el asiento.
        cuenta_debito = "2295"
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
        if tercero and int(tercero.get("regimen_simple") or 0):
            # Art. 911 ET: a un contribuyente del SIMPLE no se le practica retención.
            ret_info = {"retencion": 0, "motivo": f"{tercero.get('nombre')} está en Régimen SIMPLE: no se le practica retención (Art. 911 ET)."}
        else:
            ret_info = calcular(concepto_ret, base_sin_iva if items else monto, anio=int(fecha[:4]), declarante=declarante)
        retencion = round(float(ret_info.get("retencion") or 0), 2)

    with cc._conn() as con:
        id_debito = cc._cuenta_id_por_codigo(con, cuenta_debito)
        id_retencion = cc._cuenta_id_por_codigo(con, "2365") if retencion > 0 else None
    if not id_debito:
        raise ValueError(f"La cuenta {cuenta_debito} no existe en el plan")

    nombre_tercero = (tercero or {}).get("nombre") or ""
    girado = round(monto - retencion, 2)

    # Una cuota de préstamo no es un gasto contra una sola cuenta: separa
    # capital (baja el pasivo), interés (gasto financiero) y retención. Mostrar
    # el asiento genérico «débito X / crédito banco» sería enseñarle al operador
    # un asiento que no es el que se va a crear.
    lineas_cuota = _lineas_cuota_prestamo(payload, cc, medio, tercero_id, nombre_tercero)
    if lineas_cuota is not None:
        lineas = lineas_cuota
        retencion = round(sum(l["credito"] for l in lineas if l["cuenta_codigo"] == "2365"), 2)
        girado = round(sum(l["credito"] for l in lineas if l["cuenta_codigo"] == "1110"), 2)
        monto = round(sum(l["debito"] for l in lineas), 2)
        ret_info = ret_info or {"motivo": "Retención de rendimientos financieros del cronograma"}
    else:
        lineas = [{
            "cuenta_codigo": cuenta_debito,
            "cuenta_id": id_debito,
            "debito": monto, "credito": 0,
            "tercero_id": tercero_id,
            "descripcion": concepto or cat["label"],
        }]
    if lineas_cuota is None:
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
        "items": items,
        "total_items": total_items,
        "base_sin_iva": base_sin_iva,
        "iva_items": iva_items,
        "con_productos": bool(cat.get("con_productos")),
        "requiere_factura": bool(cat.get("requiere_factura")),
        "cuadra": abs(sum(l["debito"] for l in lineas) - sum(l["credito"] for l in lineas)) < 0.01,
    }


def _lineas_cuota_prestamo(payload: dict, cc, medio: dict, tercero_id, nombre_tercero: str):
    """Las cuatro líneas reales de una cuota de préstamo, o None si no aplica.

    Las cifras se leen del cronograma **en vivo** por (préstamo, número), no de
    lo que venga en el payload: una cuota recalculada —un mes de gracia, un
    capital corregido— cambia el asiento, y el operador tiene que ver el de hoy.
    """
    if str(payload.get("categoria") or "") != "cuota_prestamo":
        return None
    ref = str(payload.get("origen_ref") or payload.get("opcion_id") or "")
    partes = ref.replace("prestamo:", "").replace("cuota:", "").split(":")
    partes = [x for x in partes if x.strip().isdigit()]
    if len(partes) < 2:
        return None
    from app.services.prestamos import obtener_prestamo

    prestamo = obtener_prestamo(int(partes[0]))
    if not prestamo:
        return None
    cuota = next((c for c in prestamo["cuotas"] if c["numero"] == int(partes[1])), None)
    if not cuota:
        return None

    codigo_pasivo = "2380" if (prestamo.get("tercero") or {}).get("tipo") == "socio" else "2295"
    gasto = cuota["interes_bruto"] + (cuota["retencion"] if prestamo.get("gross_up") else 0)
    with cc._conn() as con:
        id_pasivo = cc._cuenta_id_por_codigo(con, codigo_pasivo)
        id_gasto = cc._cuenta_id_por_codigo(con, "5305")
        id_ret = cc._cuenta_id_por_codigo(con, "2365")
    n, total = cuota["numero"], prestamo["plazo_meses"]
    lineas = [
        {"cuenta_codigo": codigo_pasivo, "cuenta_id": id_pasivo,
         "debito": cuota["abono_capital"], "credito": 0, "tercero_id": tercero_id,
         "descripcion": f"Abono a capital cuota {n}/{total}"},
        {"cuenta_codigo": "5305", "cuenta_id": id_gasto,
         "debito": round(gasto, 2), "credito": 0, "tercero_id": tercero_id,
         "descripcion": f"Intereses cuota {n}/{total}"},
    ]
    if cuota["retencion"] > 0:
        lineas.append({
            "cuenta_codigo": "2365", "cuenta_id": id_ret,
            "debito": 0, "credito": cuota["retencion"], "tercero_id": tercero_id,
            "descripcion": f"Retención 7% rendimientos — {nombre_tercero}",
        })
    lineas.append({
        "cuenta_codigo": "1110", "cuenta_id": medio["cuenta_id"],
        "debito": 0, "credito": cuota["cuota_girada"],
        "descripcion": f"Salida vía {medio['nombre']} — {nombre_tercero}",
    })
    return lineas


# ─── Paso 3: crear la solicitud (todavía sin asiento) ───────────────────────

def crear_solicitud(payload: dict, created_by: int | None = None) -> dict:
    """Guarda la solicitud y abre el ticket de aprobación.

    **No crea el asiento todavía**: se crea al aprobar. Una solicitud rechazada
    no debe dejar rastro contable.

    `estado="borrador"` la deja en la bandeja del operador sin abrir ticket ni
    exigir la factura todavía: es lo que dejan los crons con los pagos que el
    mes trae (cuotas, nómina, contador). El operador la coteja contra el
    documento real y la manda a aprobación con `enviar_a_aprobacion()`, que es
    donde se aplican las validaciones completas. Nada se contabiliza sin que un
    humano lo haya mirado.

    `es_plantilla=True` la guarda como pago recurrente reutilizable en vez de
    como un pago del mes; `instanciar_plantilla()` la copia cada período.
    """
    _ensure()
    prev = previsualizar(payload)   # valida todo antes de guardar

    categoria = prev["categoria"]
    cat = CATEGORIAS[categoria]
    cuenta_debito = prev["lineas"][0]["cuenta_codigo"]

    # Proveedor con productos: sin líneas y sin factura cotejada no hay solicitud. Es la regla
    # que evita que un pago a proveedor entre como texto libre por el Centro de Mando.
    verificacion = payload.get("verificacion") if isinstance(payload.get("verificacion"), dict) else {}
    archivo_tmp = str(payload.get("archivo_tmp") or "").strip()
    estado = str(payload.get("estado") or "pendiente").strip()
    if estado not in ("pendiente", "borrador"):
        raise ValueError("estado debe ser 'pendiente' o 'borrador' al crear")
    es_plantilla = bool(payload.get("es_plantilla"))
    if es_plantilla:
        estado = "borrador"   # una plantilla no es un pago: no se aprueba ni se gira
    # Un borrador todavía no tiene la factura: el operador la adjunta al
    # cotejarla. Las exigencias completas corren en enviar_a_aprobacion().
    if cat.get("con_productos") and not payload.get("_sin_ticket") and estado == "pendiente":
        if not prev["items"]:
            raise ValueError("Agrega al menos un producto con su SKU")
        if cat.get("requiere_factura"):
            if not archivo_tmp:
                raise ValueError("Adjunta la factura o cotización del proveedor y cotéjala antes de enviar")
            if not verificacion:
                raise ValueError("Falta cotejar la factura contra lo solicitado")
            if not verificacion.get("fiel") and not str(payload.get("verificacion_motivo") or "").strip():
                raise ValueError(
                    "La factura no es fiel copia de lo solicitado. Corrige los productos o explica la diferencia "
                    "para que el aprobador la vea"
                )
    factura_numero = str(payload.get("factura_numero") or verificacion.get("numero_documento") or "").strip()
    verificacion_guardar = {**verificacion, "motivo_diferencia": str(payload.get("verificacion_motivo") or "").strip()} if verificacion else {}

    with _conn() as con:
        cur = con.execute(
            """INSERT INTO cc_solicitudes_pago
                 (categoria, concepto, monto, fecha, tercero_id, cuenta_debito,
                  medio_pago_id, referencia, origen_ref, retencion, retencion_concepto,
                  estado, notas, creada_por, items_json, factura_numero, verificacion_json,
                  es_plantilla, frecuencia, plantilla_id, periodo, origen_sistema)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                categoria, prev["concepto"], prev["monto"], prev["fecha"],
                (prev["tercero"] or {}).get("id"), cuenta_debito,
                int(payload.get("medio_pago_id") or 0) or None,
                str(payload.get("referencia") or factura_numero or ""), str(payload.get("origen_ref") or ""),
                prev["retencion"], str(cat.get("concepto_retencion") or ""),
                estado,
                str(payload.get("notas") or ""), created_by,
                json.dumps(prev["items"], ensure_ascii=False), factura_numero,
                json.dumps(verificacion_guardar, ensure_ascii=False),
                1 if es_plantilla else 0,
                str(payload.get("frecuencia") or ""),
                int(payload.get("plantilla_id") or 0) or None,
                str(payload.get("periodo") or ""),
                str(payload.get("origen_sistema") or ""),
            ),
        )
        sid = int(cur.lastrowid)
    if archivo_tmp:
        from app.services.pagos_proveedor import consolidar_archivo

        res = consolidar_archivo(archivo_tmp, sid, str(payload.get("archivo_nombre") or ""))
        if res:
            with _conn() as con:
                con.execute("UPDATE cc_solicitudes_pago SET factura_archivo=?, factura_nombre=? WHERE id=?",
                            (res[0], res[1], sid))
    prev["factura_numero"] = factura_numero
    prev["verificacion"] = verificacion_guardar

    # El registro directo se aprueba solo: un ticket de aprobación que nace
    # resuelto es ruido en la bandeja de alguien.
    ticket_id = (
        None
        if (payload.get("_sin_ticket") or estado == "borrador")
        else _abrir_ticket(sid, prev, created_by)
    )
    if ticket_id:
        with _conn() as con:
            con.execute("UPDATE cc_solicitudes_pago SET ticket_id=? WHERE id=?", (ticket_id, sid))
    return {**obtener(sid), "previsualizacion": prev}


def previsualizacion_de(sid: int) -> dict:
    """El asiento que dejaría esta solicitud, recalculado ahora.

    No devuelve lo que se guardó al crearla: lo vuelve a calcular desde el
    origen. Para una cuota de préstamo eso significa releer el cronograma, así
    que si la cuota cambió —un mes de gracia, un capital corregido— el operador
    ve el asiento de hoy y no el del día en que el cron montó el borrador.
    """
    _ensure()
    sol = obtener(sid)
    if not sol:
        raise ValueError("Solicitud no encontrada")
    prev = previsualizar(
        {
            "categoria": sol["categoria"],
            "monto": sol["monto"],
            "fecha": sol["fecha"],
            "tercero_id": sol.get("tercero_id"),
            "concepto": sol["concepto"],
            "medio_pago_id": sol.get("medio_pago_id"),
            "cuenta_debito": sol.get("cuenta_debito"),
            "origen_ref": sol.get("origen_ref"),
        }
    )
    # Lo que cambió desde que se guardó: es la señal de que el borrador quedó
    # viejo y hay que mirarlo, no aprobarlo de corrido.
    prev["difiere_de_lo_guardado"] = (
        abs(float(prev["monto"]) - float(sol["monto"])) > 0.5
        or abs(float(prev["retencion"]) - float(sol["retencion"])) > 0.5
    )
    prev["monto_guardado"] = sol["monto"]
    return prev


def enviar_a_aprobacion(sid: int, payload: dict | None = None, por: int | None = None) -> dict:
    """Pasa un borrador a `pendiente` y abre el ticket de aprobación.

    Es el punto donde el operador dice «verifiqué que esto hay que pagarlo»:
    acá corren las exigencias que el borrador no pedía todavía (productos con
    SKU, factura adjunta y cotejada) y acá nace el ticket. Antes de esto la
    solicitud es una propuesta del sistema, no una petición de nadie.
    """
    _ensure()
    sol = obtener(sid)
    if not sol:
        raise ValueError("Solicitud no encontrada")
    if sol.get("es_plantilla"):
        raise ValueError(
            "Esto es una plantilla de pago recurrente, no un pago: "
            "instánciala para el período y envía esa copia"
        )
    if sol["estado"] != "borrador":
        raise ValueError(f"La solicitud ya está en estado «{sol['estado']}»")

    datos = dict(payload or {})
    cat = CATEGORIAS.get(sol["categoria"]) or {}
    items = sol.get("items") or []
    if cat.get("con_productos"):
        if not items:
            raise ValueError("Agrega al menos un producto con su SKU")
        if cat.get("requiere_factura") and not (
            sol.get("factura_archivo") or datos.get("archivo_tmp")
        ):
            raise ValueError("Adjunta la factura o cotización del proveedor antes de enviar")

    campos, valores = [], []
    for col, clave in (
        ("monto", "monto"),
        ("fecha", "fecha"),
        ("medio_pago_id", "medio_pago_id"),
        ("referencia", "referencia"),
        ("notas", "notas"),
    ):
        if clave in datos:
            campos.append(f"{col}=?")
            valores.append(datos[clave])
    campos.append("estado='pendiente'")
    with _conn() as con:
        con.execute(
            f"UPDATE cc_solicitudes_pago SET {', '.join(campos)} WHERE id=?", (*valores, sid)
        )

    sol = obtener(sid)
    prev = previsualizar(
        {
            "categoria": sol["categoria"],
            "monto": sol["monto"],
            "fecha": sol["fecha"],
            "tercero_id": sol.get("tercero_id"),
            "concepto": sol["concepto"],
            "medio_pago_id": sol.get("medio_pago_id"),
        }
    )
    ticket_id = _abrir_ticket(sid, prev, por)
    if ticket_id:
        with _conn() as con:
            con.execute("UPDATE cc_solicitudes_pago SET ticket_id=? WHERE id=?", (ticket_id, sid))
    return {**obtener(sid), "previsualizacion": prev}


def instanciar_plantilla(
    plantilla_id: int, periodo: str, payload: dict | None = None, created_by: int | None = None
) -> dict:
    """Copia una plantilla de pago recurrente como borrador de un período.

    Idempotente por `origen_ref`: si el cron corre dos veces, o corren dos
    crons a la vez, el segundo choca contra el índice único y devuelve la
    solicitud que ya existía en vez de duplicar el pago.
    """
    _ensure()
    plan = obtener(plantilla_id)
    if not plan:
        raise ValueError("Plantilla no encontrada")
    if not plan.get("es_plantilla"):
        raise ValueError("Esa solicitud no es una plantilla de pago recurrente")
    periodo = str(periodo or "").strip()
    if not periodo:
        raise ValueError("periodo requerido (ej. 2026-10)")

    origen_ref = f"plantilla:{plantilla_id}:{periodo}"
    ya = _por_origen_ref(origen_ref)
    if ya:
        return {**ya, "ya_existia": True}

    datos = dict(payload or {})
    return crear_solicitud(
        {
            "categoria": plan["categoria"],
            "concepto": datos.get("concepto") or plan["concepto"],
            "monto": datos.get("monto", plan["monto"]),
            "fecha": datos.get("fecha") or f"{periodo}-01",
            "tercero_id": plan.get("tercero_id"),
            "medio_pago_id": plan.get("medio_pago_id"),
            "notas": plan.get("notas") or "",
            "estado": "borrador",
            "origen_ref": origen_ref,
            "plantilla_id": plantilla_id,
            "periodo": periodo,
            "origen_sistema": plan.get("origen_sistema") or "plantilla",
        },
        created_by=created_by,
    )


def _por_origen_ref(origen_ref: str) -> dict | None:
    """La solicitud que ya cubre ese origen, si existe."""
    if not origen_ref:
        return None
    with _conn() as con:
        row = con.execute(
            "SELECT id FROM cc_solicitudes_pago WHERE origen_ref=?", (origen_ref,)
        ).fetchone()
    return obtener(int(row["id"])) if row else None


def crear_borrador_idempotente(payload: dict, created_by: int | None = None) -> dict:
    """Borrador de un pago que el sistema detectó, sin duplicar si ya existe.

    Lo usan los crons: `origen_ref` identifica el pago concreto (una cuota, una
    quincena) y no el momento en que se generó, así que volver a correr el cron
    no crea una segunda solicitud.
    """
    _ensure()
    origen_ref = str(payload.get("origen_ref") or "").strip()
    if not origen_ref:
        raise ValueError("origen_ref requerido para un borrador del sistema")
    ya = _por_origen_ref(origen_ref)
    if ya:
        return {**ya, "ya_existia": True}
    return crear_solicitud({**payload, "estado": "borrador"}, created_by=created_by)


def listar_plantillas() -> list[dict]:
    """Pagos recurrentes guardados, para ofrecerlos al montar un pago del mes."""
    _ensure()
    with _conn() as con:
        ids = [int(r["id"]) for r in con.execute(
            "SELECT id FROM cc_solicitudes_pago WHERE es_plantilla=1 ORDER BY concepto"
        )]
    return [obtener(i) for i in ids if obtener(i)]


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
        productos = ""
        if prev.get("items"):
            productos = "\n**Productos solicitados (precios sin IVA):**\n" + "\n".join(
                f"- {i['sku'] or '(sin SKU)'} · {i['nombre']} × {i['cantidad']:g} @ {_fmt(i['precio'])} = {_fmt(i['subtotal'])}"
                + (f" + IVA {i['iva_pct']:g}%" if i.get('iva_pct') else " (sin IVA)")
                for i in prev["items"]
            ) + (f"\nSubtotal {_fmt(prev.get('base_sin_iva'))} · IVA {_fmt(prev.get('iva_items'))} · "
                 f"**Total {_fmt(prev.get('total_items'))}**\n")
        ver = prev.get("verificacion") or {}
        cotejo = ""
        if ver:
            cotejo = (
                "\n**Factura / cotización cotejada:** "
                + ("✅ fiel copia de lo solicitado" if ver.get("fiel") else "⚠️ CON DIFERENCIAS")
                + (f" · documento {ver.get('numero_documento')}" if ver.get("numero_documento") else "")
                + "\n" + "\n".join(f"  - {a}" for a in (ver.get("advertencias") or []))
                + (f"\n  Explicación de quien solicita: {ver.get('motivo_diferencia')}" if ver.get("motivo_diferencia") else "")
                + "\n"
            )
        desc = (
            f"**Solicitud de pago #{sid} — {prev['categoria_label']}**\n\n"
            f"Concepto: {prev['concepto']}\n"
            f"Fecha: {prev['fecha']} · Medio: {prev['medio_pago']}\n"
            + (f"A nombre de: {prev['tercero']['nombre']}\n" if prev.get("tercero") else "")
            + f"\n**Monto: {_fmt(prev['monto'])}**"
            + (f" · retención {_fmt(prev['retencion'])} → **se gira {_fmt(prev['girado'])}**"
               if prev["retencion"] > 0 else "")
            + productos + cotejo
            + "\n\n**Asiento contable que va a quedar al aprobar:**\n```\n"
            + filas + "\n```\n"
            + (f"\n_{prev['retencion_motivo']}_\n" if prev.get("retencion_motivo") else "")
            + "\nAl aprobar se registra en el Libro Mayor y se espeja a Alegra.\n\n"
            f"{MARCA_SOLICITUD} {sid}"
        )
        creador = created_by or _usuario_id(_tdb.DB_PATH, "admin")
        if not creador:
            return None
        aprobador = _aprobador_id(_tdb)
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


def _aprobador_id(_tdb) -> int | None:
    """Quien aprueba: el aliado asignado a «Solicitudes de pago» en Sistemas → Aliados; si no,
    PAGOS_APROBADOR (default armando)."""
    try:
        uid = (_tdb.get_aliados_asignaciones().get(getattr(_tdb, "TAREA_PAGOS_APROBADOR", "pagos_aprobador")) or {}).get("usuario_id")
        if uid:
            return int(uid)
    except Exception:
        pass
    return _usuario_id(_tdb.DB_PATH, os.getenv("PAGOS_APROBADOR", "armando"))


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
    try:
        d["items"] = json.loads(d.pop("items_json", None) or "[]")
    except Exception:
        d["items"] = []
    try:
        d["verificacion"] = json.loads(d.pop("verificacion_json", None) or "{}")
    except Exception:
        d["verificacion"] = {}
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
    # La factura/cotización del proveedor queda como soporte del asiento.
    if s.get("factura_archivo"):
        try:
            from pathlib import Path as _P

            ruta = _P(__file__).resolve().parents[2] / s["factura_archivo"]
            if ruta.exists():
                mime = "application/pdf" if ruta.suffix.lower() == ".pdf" else "application/octet-stream"
                cc.guardar_comprobante(int(mov["id"]), ruta.read_bytes(), s.get("factura_nombre") or ruta.name, mime)
        except Exception as e:
            print(f"⚠️ Solicitud {sid}: no se pudo adjuntar la factura al asiento: {e}", flush=True)

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
