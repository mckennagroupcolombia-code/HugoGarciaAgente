"""
Retención en la fuente: tarifas, cuantías mínimas y UVT.

Centraliza el cálculo para que cada módulo no invente su propia tarifa. Hoy lo
usan la compra a socios (concepto `compras`), los pagos a familiares por
servicios (`servicios`) y los intereses de préstamos (`rendimientos_financieros`).

Dos cosas que se equivocan seguido y este módulo resuelve:

1. **La cuantía mínima.** No toda operación lleva retención. Las compras solo la
   llevan desde 27 UVT y los servicios desde 4 UVT; los rendimientos financieros
   no tienen mínimo. Aplicar retención por debajo del tope es tan incorrecto como
   no aplicarla por encima.
2. **Declarante vs. no declarante.** Cambia la tarifa (2,5% vs 3,5% en compras,
   4% vs 6% en servicios). Es un dato del tercero, no del módulo que paga.

⚠️ REGLA DURA, igual que en `calendario_tributario`: **no se extrapola la UVT**.
La fija la DIAN por resolución cada año. Para un año sin valor cargado se devuelve
`None` y quien llame debe decirlo, no inventar una cifra: una UVT equivocada
mueve la cuantía mínima y hace retener de más o de menos.
"""

from __future__ import annotations

import os

# Valor de la UVT por año (Resolución DIAN anual). Cargar el año nuevo acá
# cuando salga la resolución, o pasarlo por `UVT_<año>` en el entorno.
_UVT: dict[int, float] = {
    2023: 42_412.0,
    2024: 47_065.0,
    2025: 49_799.0,
    # Resolución DIAN 000238 del 15-dic-2025 (IPC 5,17% certificado por el DANE
    # para oct/2024–oct/2025; 49.799 + 2.575).
    2026: 52_374.0,
}

ANIOS_UVT_CARGADOS = tuple(sorted(_UVT))

# concepto -> (tarifa declarante, tarifa NO declarante, cuantía mínima en UVT, norma)
CONCEPTOS: dict[str, tuple[float, float, float, str]] = {
    # Compra de bienes muebles. Es el caso de la mercancía que el socio compró
    # con su tarjeta y le vende a McKenna.
    "compras": (2.5, 3.5, 27.0, "Art. 401 E.T."),
    # Servicios generales (no calificados). Familiares que prestan servicios.
    "servicios": (4.0, 6.0, 4.0, "Art. 392 E.T."),
    # Honorarios y comisiones a persona natural.
    "honorarios": (10.0, 11.0, 0.0, "Art. 392 E.T."),
    # Intereses de préstamos. Tarifa única, sin cuantía mínima.
    "rendimientos_financieros": (7.0, 7.0, 0.0, "Art. 395 E.T."),
}


def uvt(anio: int) -> float | None:
    """UVT del año, o None si no está cargada. Nunca se extrapola."""
    env = (os.getenv(f"UVT_{int(anio)}") or "").strip().replace(".", "").replace(",", ".")
    if env:
        try:
            valor = float(env)
            if valor > 0:
                return valor
        except ValueError:
            pass
    return _UVT.get(int(anio))


def calcular(
    concepto: str,
    base: float,
    *,
    anio: int,
    declarante: bool = True,
) -> dict:
    """Retención sobre `base` para un concepto y año.

    Devuelve siempre una explicación legible (`motivo`), porque el panel y los
    tickets tienen que poder decir **por qué** se retuvo o por qué no — que es
    la pregunta que llega cuando el tercero reclama.
    """
    concepto = (concepto or "").strip().lower()
    if concepto not in CONCEPTOS:
        raise ValueError(
            f"Concepto de retención desconocido: {concepto!r}. "
            f"Disponibles: {', '.join(sorted(CONCEPTOS))}"
        )
    base = round(float(base or 0), 2)
    tarifa_dec, tarifa_no_dec, minimo_uvt, norma = CONCEPTOS[concepto]
    tarifa = tarifa_dec if declarante else tarifa_no_dec

    valor_uvt = uvt(anio)
    if valor_uvt is None:
        return {
            "aplica": False,
            "retencion": 0.0,
            "base": base,
            "tarifa_pct": tarifa,
            "concepto": concepto,
            "norma": norma,
            "uvt": None,
            "minimo_uvt": minimo_uvt,
            "minimo_cop": None,
            "motivo": (
                f"No hay UVT cargada para {anio}, así que no se puede saber si la base "
                f"supera la cuantía mínima de {minimo_uvt:g} UVT. "
                f"Años disponibles: {', '.join(str(a) for a in ANIOS_UVT_CARGADOS)}. "
                f"Cárgala en `retenciones._UVT` o en la variable UVT_{anio}."
            ),
            "indeterminado": True,
        }

    minimo_cop = round(minimo_uvt * valor_uvt, 2)
    if base <= 0:
        return {
            "aplica": False, "retencion": 0.0, "base": base, "tarifa_pct": tarifa,
            "concepto": concepto, "norma": norma, "uvt": valor_uvt,
            "minimo_uvt": minimo_uvt, "minimo_cop": minimo_cop,
            "motivo": "La base es cero.", "indeterminado": False,
        }
    if minimo_uvt > 0 and base < minimo_cop:
        return {
            "aplica": False, "retencion": 0.0, "base": base, "tarifa_pct": tarifa,
            "concepto": concepto, "norma": norma, "uvt": valor_uvt,
            "minimo_uvt": minimo_uvt, "minimo_cop": minimo_cop,
            "motivo": (
                f"No se retiene: la base (${base:,.0f}) está por debajo de la cuantía "
                f"mínima de {minimo_uvt:g} UVT (${minimo_cop:,.0f} en {anio}). "
                f"{norma}"
            ).replace(",", "."),
            "indeterminado": False,
        }

    retencion = round(base * tarifa / 100, 2)
    calidad = "declarante" if declarante else "NO declarante"
    return {
        "aplica": True, "retencion": retencion, "base": base, "tarifa_pct": tarifa,
        "concepto": concepto, "norma": norma, "uvt": valor_uvt,
        "minimo_uvt": minimo_uvt, "minimo_cop": minimo_cop,
        "motivo": (
            f"Retención de {tarifa:g}% por {concepto} sobre ${base:,.0f} "
            f"(beneficiario {calidad}). {norma}"
        ).replace(",", "."),
        "indeterminado": False,
    }


def resumen_conceptos(anio: int) -> list[dict]:
    """Tabla de conceptos vigentes, para mostrarla en el panel."""
    valor_uvt = uvt(anio)
    out = []
    for concepto, (dec, no_dec, minimo, norma) in sorted(CONCEPTOS.items()):
        out.append({
            "concepto": concepto,
            "tarifa_declarante_pct": dec,
            "tarifa_no_declarante_pct": no_dec,
            "minimo_uvt": minimo,
            "minimo_cop": round(minimo * valor_uvt, 2) if valor_uvt else None,
            "norma": norma,
        })
    return out


# ─── Resumen del período para la declaración ───────────────────────────────
# Fuente única: los créditos a la cuenta 2365 del Libro Mayor. Leerlo del libro
# y no de cada módulo (préstamos, compras a socios, servicios…) evita que un
# concepto nuevo quede fuera de la declaración sin que nadie lo note — que es
# justo como se pierden estas cosas.

CUENTA_RETENCION_PUC = "2365"


def resumen_periodo(anio: int, mes: int) -> dict:
    """Retención practicada en el mes, por tercero y por concepto.

    Devuelve lo que el contador necesita para el formulario 350, más el
    vencimiento del período según el calendario tributario.
    """
    import calendar as _cal
    import re as _re

    import app.services.contabilidad_core as cc

    cc._ensure()
    desde = f"{int(anio):04d}-{int(mes):02d}-01"
    hasta = f"{int(anio):04d}-{int(mes):02d}-{_cal.monthrange(int(anio), int(mes))[1]:02d}"

    with cc._conn() as con:
        filas = [
            dict(r)
            for r in con.execute(
                """
                SELECT m.id AS movimiento_id, m.fecha, m.concepto, m.tipo_origen,
                       l.credito, l.debito, l.descripcion,
                       t.id AS tercero_id, t.nombre AS tercero, t.identificacion,
                       t.tipo_persona, t.declarante
                  FROM cc_movimiento_lineas l
                  JOIN cc_movimientos m ON m.id = l.movimiento_id AND m.estado <> 'anulado'
                  JOIN cc_plan_cuentas c ON c.id = l.cuenta_id
                  LEFT JOIN cc_terceros t ON t.id = l.tercero_id
                 WHERE c.codigo = ?
                   AND m.fecha BETWEEN ? AND ?
                 ORDER BY m.fecha, t.nombre
                """,
                (CUENTA_RETENCION_PUC, desde, hasta),
            )
        ]

    def _concepto(f: dict) -> str:
        """Concepto tributario a partir de la descripción del asiento."""
        d = (f.get("descripcion") or "").lower()
        if "rendimiento" in d or "financier" in d:
            return "rendimientos_financieros"
        if "compra" in d:
            return "compras"
        if "servicio" in d:
            return "servicios"
        if "honorario" in d:
            return "honorarios"
        return "otros"

    detalle: dict[tuple, dict] = {}
    for f in filas:
        neto = round(float(f["credito"] or 0) - float(f["debito"] or 0), 2)
        if neto == 0:
            continue
        concepto = _concepto(f)
        clave = (f.get("tercero_id"), concepto)
        acc = detalle.setdefault(clave, {
            "tercero_id": f.get("tercero_id"),
            "tercero": f.get("tercero") or "(sin tercero)",
            "identificacion": f.get("identificacion") or "",
            "tipo_persona": f.get("tipo_persona") or "",
            "declarante": bool(f["declarante"]) if f.get("declarante") is not None else None,
            "concepto": concepto,
            "norma": CONCEPTOS.get(concepto, (0, 0, 0, ""))[3],
            "retencion": 0.0,
            "movimientos": [],
        })
        acc["retencion"] = round(acc["retencion"] + neto, 2)
        acc["movimientos"].append({
            "id": f["movimiento_id"], "fecha": f["fecha"],
            "concepto": f["concepto"], "valor": neto,
        })

    items = sorted(detalle.values(), key=lambda a: -a["retencion"])
    total = round(sum(a["retencion"] for a in items), 2)
    por_concepto: dict[str, float] = {}
    for a in items:
        por_concepto[a["concepto"]] = round(por_concepto.get(a["concepto"], 0) + a["retencion"], 2)

    try:
        from app.services.calendario_tributario import info_vencimiento_retencion

        vencimiento = info_vencimiento_retencion(int(anio), int(mes))
    except Exception:
        vencimiento = {"conocido": False, "estado": "desconocido", "motivo": "Calendario no disponible."}

    sin_tercero = [a for a in items if not a["tercero_id"]]
    return {
        "periodo": f"{int(anio):04d}-{int(mes):02d}",
        "desde": desde, "hasta": hasta,
        "terceros": items,
        "por_concepto": por_concepto,
        "total_retencion": total,
        "vencimiento": vencimiento,
        "sin_tercero": len(sin_tercero),
        "uvt": uvt(anio),
    }


def enviar_correo_contador(anio: int, mes: int, destinatario: str = "", nota: str = "") -> dict:
    """Envía al contador el detalle de la retención del período.

    Va aparte del ticket interno a propósito: el ticket es para quien coordina
    dentro de McKenna; este correo es para quien presenta la declaración, y lleva
    el desglose por tercero y concepto tal como va al formulario 350.
    """
    import os as _os

    from app.services.calendario_tributario import FUENTE_CALENDARIO
    from app.tools.web_pedidos import _send_smtp, _smtp_ready

    correo = (destinatario or _os.getenv("EMAIL_CONTADOR") or "").strip()
    if not correo:
        raise ValueError(
            "No hay correo del contador. Configúralo en EMAIL_CONTADOR o pásalo como destinatario."
        )
    if not _smtp_ready():
        raise ValueError("SMTP no configurado (SMTP_HOST / SMTP_USER / SMTP_PASSWORD / EMAIL_FROM)")

    r = resumen_periodo(anio, mes)
    if r["total_retencion"] <= 0:
        return {"ok": True, "enviado": False, "motivo": f"No hubo retención en {r['periodo']}."}

    from app.services import empresa

    v = r["vencimiento"]
    venc = (
        f"{v['fecha']} (quedan {v['dias_restantes']} día(s))"
        if v.get("conocido")
        else v.get("motivo", "sin confirmar")
    )

    def _cop(n):
        return "$" + f"{round(float(n or 0)):,}".replace(",", ".")

    filas = [
        (t["tercero"], t["identificacion"] or "—", t["concepto"].replace("_", " "),
         t["norma"], _cop(t["retencion"]))
        for t in r["terceros"]
    ]
    conceptos = ", ".join(f"{c.replace('_', ' ')} {_cop(v2)}" for c, v2 in sorted(r["por_concepto"].items()))

    texto = (
        f"Cordial saludo.\n\n"
        f"Enviamos el detalle de la retención en la fuente practicada por "
        f"{empresa.razon_social()} (NIT {empresa.nit()}) en el período {r['periodo']}, "
        f"para la declaración mensual (formulario 350).\n\n"
        f"TOTAL A DECLARAR Y PAGAR: {_cop(r['total_retencion'])}\n"
        f"Por concepto: {conceptos}\n"
        f"Vencimiento: {venc}\n"
        f"({FUENTE_CALENDARIO} — último dígito del NIT: {v.get('ultimo_digito')})\n\n"
        "Detalle por beneficiario:\n"
        + "\n".join(f"- {n} (CC/NIT {i}) — {c} [{nm}]: {val}" for n, i, c, nm, val in filas)
        + (f"\n\n{nota.strip()}" if nota and nota.strip() else "")
        + "\n\nEl valor ya está contabilizado en la cuenta 2365 del libro y, cuando aplica, "
        "quedó registrado en el documento soporte correspondiente en Alegra.\n\n"
        f"{empresa.razon_social()}\nNIT {empresa.nit()}"
    )
    filas_html = "".join(
        f'<tr><td style="padding:5px 10px 5px 0;">{n}</td>'
        f'<td style="padding:5px 10px 5px 0;color:#64748b;">{i}</td>'
        f'<td style="padding:5px 10px 5px 0;">{c}</td>'
        f'<td style="padding:5px 10px 5px 0;color:#64748b;font-size:12px;">{nm}</td>'
        f'<td style="padding:5px 0;text-align:right;font-weight:600;">{val}</td></tr>'
        for n, i, c, nm, val in filas
    )
    html = (
        f'<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:640px;">'
        f'<p>Cordial saludo.</p>'
        f'<p>Detalle de la retención en la fuente practicada por <strong>{empresa.razon_social()}</strong> '
        f'(NIT {empresa.nit()}) en el período <strong>{r["periodo"]}</strong>, para la declaración '
        f'mensual (formulario 350).</p>'
        f'<p style="background:#ecfdf5;padding:12px 14px;border-radius:10px;">'
        f'<strong style="font-size:16px;">Total a declarar y pagar: {_cop(r["total_retencion"])}</strong><br>'
        f'<span style="color:#64748b;font-size:13px;">Por concepto: {conceptos}</span><br>'
        f'<span style="color:#64748b;font-size:13px;">Vencimiento: {venc}</span></p>'
        f'<table style="border-collapse:collapse;width:100%;font-size:13px;">'
        f'<thead><tr style="text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;">'
        f'<th style="padding-bottom:4px;">Beneficiario</th><th>CC/NIT</th><th>Concepto</th>'
        f'<th>Norma</th><th style="text-align:right;">Retención</th></tr></thead>'
        f'<tbody>{filas_html}</tbody></table>'
        + (f'<p style="background:#f8fafc;padding:12px 14px;border-radius:10px;font-size:13px;">'
           f'{nota.strip()}</p>' if nota and nota.strip() else "")
        + f'<p style="font-size:13px;color:#64748b;">El valor ya está contabilizado en la cuenta 2365 '
        f'del libro y, cuando aplica, quedó registrado en el documento soporte correspondiente en Alegra. '
        f'{FUENTE_CALENDARIO} — último dígito del NIT: {v.get("ultimo_digito")}.</p>'
        f'<p style="color:#0c6069;"><strong>{empresa.razon_social()}</strong><br>'
        f'<span style="font-size:13px;color:#64748b;">NIT {empresa.nit()}</span></p></div>'
    )

    if not _send_smtp(correo, f"Retención en la fuente {r['periodo']} — {empresa.razon_social()}", texto, html):
        raise ValueError("Falló el envío SMTP (revisa credenciales y red)")
    return {
        "ok": True, "enviado": True, "destinatario": correo, "periodo": r["periodo"],
        "total_retencion": r["total_retencion"], "terceros": len(r["terceros"]),
    }
