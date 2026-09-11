"""
Espeja los asientos del Libro Mayor propio hacia los comprobantes contables de
Alegra.

**Por qué existe.** La decisión #8 del CLAUDE.md dice que el Libro Mayor es la
fuente de verdad interna y que Alegra queda como herramienta de consulta para el
contador. El problema es que el contador **calcula impuestos y retenciones
extrayendo de Alegra**: si una retención solo vive en el libro propio, no llega a
la declaración. Verificado el 2026-09-10: había $96.251 de retención en la cuenta
2365 del libro y **cero** en Alegra.

Este módulo cierra ese hueco posteando cada asiento como un **comprobante
contable** (`POST /journals`), que es el equivalente exacto: débito y crédito por
línea, cuenta contable, tercero y descripción.

**Formato de la API** (verificado a mano contra Alegra el 2026-09-10, porque la
documentación pública no lo detalla):

    {"date": "YYYY-MM-DD",
     "observations": "...",
     "entries": [{"id": "5120",            # id de la cuenta, DIRECTO
                  "type": "category",
                  "debit": 0, "credit": 54150,
                  "description": "...",
                  "client": {"id": "34"}}]}  # tercero de la línea: `client`

Formato confirmado leyendo por API el comprobante AC-1 que se creó a mano en la
interfaz el 2026-09-10. Antes de eso el módulo enviaba `{"account": {"id": ...}}`
y `contact`, y Alegra respondía "debe contener al menos 2 cuentas contables
diferentes" — no leía ninguna cuenta.

⚠️ **Requiere que exista al menos un tipo de comprobante contable en la cuenta.**
`POST /journals/types` devuelve 403: solo se crea desde la interfaz de Alegra
(Contabilidad → Comprobantes contables). Sin un tipo, este módulo no postea y lo
dice — no inventa uno ni cae a otro mecanismo en silencio.
"""

from __future__ import annotations

import json
import os

_MAPA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "alegra_plan_cuentas.json")

# PUC del Libro Mayor propio -> cuenta contable de Alegra.
# Alegra trae el PUC colombiano completo, así que el mapeo es uno a uno. Se hace
# explícito y no por nombre: los nombres se editan desde la interfaz y romperían
# el match en silencio.
# Verificado contra el plan real de Alegra (app/data/alegra_plan_cuentas.json,
# 298 cuentas cacheadas el 2026-09-10). NO adivinar ids: en la primera versión de
# este mapa se pusieron a ojo y "1110 Bancos" apuntaba a «Cuentas por cobrar
# empleados» y "1435 Mercancías" a «Retención servicio 6%». Un espejo con cuentas
# equivocadas es peor que no tener espejo, porque parece correcto.
MAPA_PUC: dict[str, str] = {
    "1110": "5297",   # Bancos -> "Banco 1"
    "1435": "5047",   # Inventarios - Mercancías -> "Inventario de mercancías"
    # Alegra no trae una cuenta por pagar a SOCIOS (solo «por cobrar a socios»),
    # así que ambas van a proveedores nacionales. El detalle por tercero se
    # conserva en la descripción de cada línea y en el Libro Mayor propio.
    "2380": "5070",   # Cuentas por pagar - socios
    "2295": "5070",   # Préstamos por pagar - terceros
    "2365": "5120",   # Retenciones compra 2,5% por pagar
    "5305": "5252",   # Gastos financieros -> "Gastos por Intereses financieros"
    "4135": "5150",   # Ingresos por venta de mercancías -> "Ventas"
    # ── Gastos por naturaleza (2026-09-11) ────────────────────────────────
    # Todos verificados contra app/data/alegra_plan_cuentas.json: existen y
    # aceptan movimientos. Antes todo gasto caía en 5135 y en Alegra quedaba
    # igual de indiferenciado.
    "5105": "5181",     # Sueldos y salarios
    "5110": "5202",     # Honorarios -> "Otros honorarios"
    "5120": "5205",     # Arrendamientos -> "Arrendamiento de Oficinas"
    "5130": "5225",     # Seguros -> "Seguro de vida" (la genérica de seguros)
    "5145": "5242",     # Mantenimiento -> "Otros gastos generales"
    "5155": "5220",     # Gastos de viaje -> "Taxis y buses"
    "513525": "5211",   # Acueducto -> "Alcantarillado/ Acueducto"
    "513530": "5212",   # Energía eléctrica
    "513535": "5213",   # Teléfono / Internet
    "513550": "5214",   # Transporte, fletes y acarreos -> "Transporte y acarreo"
    "513555": "5207",   # Gas
    "513560": "5231",   # SaaS -> "Cuotas y suscripciones"
    "513595": "5215",   # Otros servicios
    "5135": "5215",     # Servicios genérico -> "Otros servicios"
    "5195": "5242",     # Gastos diversos -> "Otros gastos generales"
    "5299": "5255",     # Comisiones plataformas -> "Comisiones bancarias"
    # ── Resto del plan, para que ningún asiento quede sin poder espejarse ──
    "1105": "5296",     # Caja -> "Caja general"
    "1355": "5011",     # Cuentas por cobrar - socios
    "1290": "5017",     # Préstamos por cobrar - terceros -> "por cobrar empleados"
    "2105": "5095",     # Obligaciones financieras -> "Préstamos a corto plazo bancos"
    "2205": "5070",     # Proveedores nacionales
    "2367": "5079",     # Costos y gastos por pagar -> "Salarios por pagar"
    "3115": "5134",     # Aportes sociales -> "Capital social suscrito"
    "4175": "5151",     # Devoluciones en ventas
    "4295": "5154",     # Ingresos diversos -> "Ingresos por Intereses financieros"
    "6135": "5266",     # Costo de mercancía vendida
    # 1436 (materia prima cacao) y 6205 (costo transformación) no tienen
    # equivalente en el plan de Alegra: van al inventario/costo genérico.
    "1436": "5047",     # -> "Inventario de mercancías"
    "6205": "5266",     # -> "Costos de la mercancía vendida"
}

# Retenciones: cada tarifa tiene su propia cuenta en Alegra, y usar la genérica
# obligaría al contador a desglosarlas a mano para el formulario 350.
MAPA_RETENCIONES: dict[tuple[str, float], str] = {
    ("compras", 2.5): "5120",
    ("servicios", 4.0): "5115",
    ("servicios", 6.0): "5116",
    ("honorarios", 10.0): "5112",
    ("honorarios", 11.0): "5113",
    # No hay cuenta específica para rendimientos financieros: va a la genérica.
    ("rendimientos_financieros", 7.0): "5123",
}


def _activo() -> bool:
    return (os.getenv("ALEGRA_ESPEJO_ACTIVO", "0") or "0").strip() == "1"


def plan_cuentas_alegra() -> dict:
    """Plan de cuentas cacheado (`app/data/alegra_plan_cuentas.json`)."""
    try:
        with open(_MAPA_PATH, encoding="utf-8") as f:
            return json.load(f).get("cuentas") or {}
    except (OSError, ValueError):
        return {}


def tipos_comprobante() -> tuple[list, str]:
    """Tipos de comprobante contable configurados en Alegra.

    Vacío significa que hay que crear uno **desde la interfaz** — por API da 403.
    """
    import requests

    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    try:
        r = requests.get(f"{_ALEGRA_BASE}/journals/types", headers=_alegra_headers(), timeout=15)
    except Exception as e:
        return [], str(e)
    if r.status_code != 200:
        return [], f"HTTP {r.status_code}: {r.text[:200]}"
    d = r.json()
    return (d if isinstance(d, list) else (d.get("data") or [])), ""


def cuenta_alegra(codigo_puc: str) -> str | None:
    """Cuenta de Alegra para un código del PUC propio."""
    return MAPA_PUC.get(str(codigo_puc or "").strip())


def cuenta_retencion_alegra(concepto: str, tarifa_pct: float) -> str | None:
    return MAPA_RETENCIONES.get(
        (str(concepto or "").strip().lower(), round(float(tarifa_pct or 0), 2))
    )


def _entradas_desde_movimiento(mov: dict) -> tuple[list, list]:
    """Traduce las líneas de un asiento propio a `entries` de Alegra.

    Devuelve (entries, faltantes). Si alguna cuenta no está mapeada la reporta en
    `faltantes` en vez de omitirla: un comprobante al que le falta una línea no
    cuadra, y postearlo incompleto sería peor que no postearlo.
    """
    entries, faltantes = [], []
    for l in mov.get("lineas") or []:
        codigo = str(l.get("cuenta_codigo") or "")
        destino = cuenta_alegra(codigo)
        if not destino:
            faltantes.append(codigo)
            continue
        entrada = {
            "id": destino,
            "type": "category",
            "debit": round(float(l.get("debito") or 0), 2),
            "credit": round(float(l.get("credito") or 0), 2),
            "description": (l.get("descripcion") or mov.get("concepto") or "")[:200],
        }
        # Tercero de la línea. Es lo que permite saber a quién se le retuvo
        # cuando la cuenta contable es genérica (p. ej. proveedores nacionales,
        # porque Alegra no tiene "cuentas por pagar a socios").
        contacto = _contacto_alegra(l.get("tercero_id"))
        if contacto:
            entrada["client"] = {"id": contacto}
        entries.append(entrada)
    return entries, faltantes


def _contacto_alegra(tercero_id) -> str | None:
    """Id del contacto en Alegra para un tercero del Libro Mayor, o None.

    Solo consulta: crear el contacto acá metería en Alegra terceros que quizá
    nunca reciban un documento. Si no existe, la línea va sin `client` y el
    comprobante se postea igual — perder el detalle del tercero es mejor que no
    postear la retención.
    """
    if not tercero_id:
        return None
    try:
        import app.services.contabilidad_core as cc
        from app.services.alegra import consultar_contacto_alegra

        t = cc.obtener_tercero(int(tercero_id))
        if not t or not (t.get("identificacion") or "").strip():
            return None
        tipo_doc = "NIT" if t.get("tipo_persona") == "juridica" else "CC"
        r = consultar_contacto_alegra(t["identificacion"], tipo_doc)
        return r.get("id") if r.get("existe") else None
    except Exception:
        return None


# ─── Trazabilidad ───────────────────────────────────────────────────────────
# Qué asiento del libro corresponde a qué comprobante de Alegra. Sin esto, correr
# el espejo dos veces duplica comprobantes contables — y en contabilidad un
# duplicado no se "deshace": hay que anularlo y queda el rastro.

def _ensure_tabla_espejo() -> None:
    import app.services.contabilidad_core as cc

    cc._ensure()
    with cc._conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS cc_alegra_espejo (
                movimiento_id INTEGER PRIMARY KEY REFERENCES cc_movimientos(id),
                alegra_journal_id TEXT NOT NULL,
                fecha TEXT NOT NULL,
                total REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)


def espejo_existente(movimiento_id: int) -> str | None:
    """Id del comprobante en Alegra si este asiento ya se espejó."""
    import app.services.contabilidad_core as cc

    _ensure_tabla_espejo()
    with cc._conn() as con:
        row = con.execute(
            "SELECT alegra_journal_id FROM cc_alegra_espejo WHERE movimiento_id=?",
            (int(movimiento_id),),
        ).fetchone()
    return row["alegra_journal_id"] if row else None


def _registrar_espejo(movimiento_id: int, journal_id: str, fecha: str, total: float) -> None:
    import app.services.contabilidad_core as cc

    _ensure_tabla_espejo()
    with cc._conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO cc_alegra_espejo"
            " (movimiento_id, alegra_journal_id, fecha, total) VALUES (?,?,?,?)",
            (int(movimiento_id), str(journal_id), str(fecha)[:10], round(float(total or 0), 2)),
        )


def espejar_movimiento(movimiento_id: int, *, forzar: bool = False, reespejar: bool = False) -> dict:
    """Postea un asiento del Libro Mayor como comprobante contable en Alegra.

    Idempotente: si el asiento ya tiene comprobante no crea otro (usar
    `reespejar=True` solo para rehacer uno anulado en Alegra).
    """
    import requests

    import app.services.contabilidad_core as cc
    from app.services.alegra import _ALEGRA_BASE, _alegra_headers

    # Consulta directa: cargar miles de asientos con sus líneas para encontrar uno
    # se rompe en silencio en cuanto el libro supera el `limit` — y el libro crece
    # todos los días con las ventas de MeLi.
    mov = cc.obtener_movimiento(int(movimiento_id))
    if not mov:
        raise ValueError(f"Movimiento {movimiento_id} no encontrado")

    ya = espejo_existente(movimiento_id)
    if ya and not reespejar:
        return {"status": "ya_espejado", "id": ya,
                "message": f"El asiento {movimiento_id} ya es el comprobante {ya} en Alegra."}
    if mov.get("estado") == "anulado":
        return {"status": "no_aplica", "motivo": "El asiento está anulado."}

    entries, faltantes = _entradas_desde_movimiento(mov)
    if faltantes:
        return {
            "status": "error",
            "message": (
                f"Faltan cuentas de Alegra para el PUC {', '.join(sorted(set(faltantes)))}. "
                "Agrégalas a MAPA_PUC en alegra_espejo.py — postear el comprobante sin esas "
                "líneas lo dejaría descuadrado."
            ),
        }
    if len(entries) < 2:
        return {"status": "error", "message": "Un comprobante contable necesita al menos 2 cuentas."}

    tipos, err = tipos_comprobante()
    if err:
        return {"status": "error", "message": f"No se pudieron leer los tipos de comprobante: {err}"}
    if not tipos:
        return {
            "status": "bloqueado",
            "message": (
                "Alegra no tiene ningún tipo de comprobante contable configurado. "
                "Créalo en Contabilidad → Comprobantes contables (por API devuelve 403). "
                "Sin un tipo no se puede postear."
            ),
        }
    tipo_id = str(tipos[0].get("id"))

    payload = {
        "date": str(mov.get("fecha"))[:10],
        "observations": (
            f"{mov.get('concepto')} · ref {mov.get('referencia') or mov['id']} "
            f"· espejo del Libro Mayor (asiento {mov['id']})"
        )[:500],
        "entries": entries,
    }

    if not (_activo() or forzar):
        return {"status": "dry_run", "payload": payload, "tipo_comprobante": tipo_id}

    try:
        r = requests.post(f"{_ALEGRA_BASE}/journals", headers=_alegra_headers(), json=payload, timeout=25)
    except Exception as e:
        return {"status": "error", "message": f"Error de red posteando el comprobante: {e}"}
    if r.status_code in (200, 201):
        d = r.json()
        _registrar_espejo(movimiento_id, d.get("id"), mov.get("fecha"), d.get("total"))
        return {"status": "success", "id": str(d.get("id")), "numero": d.get("number"), "data": d}
    return {"status": "error", "message": f"HTTP {r.status_code}: {r.text[:300]}"}


def previsualizar_periodo(desde: str, hasta: str, tipos_origen: tuple[str, ...] | None = None) -> dict:
    """Qué se espejaría en un rango, sin postear nada."""
    import app.services.contabilidad_core as cc

    # El filtro de fecha y tipo_origen lo hace SQL, no Python sobre una lista
    # truncada por `limit`.
    if tipos_origen:
        movs = []
        for t in tipos_origen:
            movs.extend(cc.listar_movimientos(desde=desde, hasta=hasta, tipo_origen=t, limit=2000))
    else:
        movs = cc.listar_movimientos(desde=desde, hasta=hasta, limit=2000)
    movs = [m for m in movs if m.get("estado") != "anulado"]
    listos, bloqueados = [], []
    for m in movs:
        entries, faltantes = _entradas_desde_movimiento(m)
        if faltantes or len(entries) < 2:
            bloqueados.append({
                "movimiento_id": m["id"], "fecha": m["fecha"], "concepto": m["concepto"],
                "cuentas_sin_mapear": sorted(set(faltantes)),
            })
        else:
            listos.append({
                "movimiento_id": m["id"], "fecha": m["fecha"], "concepto": m["concepto"],
                "lineas": len(entries),
                "total": round(sum(e["debit"] for e in entries), 2),
                "alegra_journal_id": espejo_existente(m["id"]),
            })
    tipos, err = tipos_comprobante()
    return {
        "activo": _activo(),
        "tipos_comprobante": tipos,
        "tipo_error": err,
        "puede_postear": bool(tipos) and not err,
        "listos": listos,
        "bloqueados": bloqueados,
        "total_listos": round(sum(x["total"] for x in listos), 2),
        "ya_espejados": sum(1 for x in listos if x["alegra_journal_id"]),
        "pendientes": sum(1 for x in listos if not x["alegra_journal_id"]),
    }
