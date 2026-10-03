"""Cupones de la tienda web (mckennagroup.co).

Hoy hay uno solo, BIENVENIDO10: 10 % sobre los productos (no sobre el envío) en la
primera compra. Se entrega en la ventana «Regístrate» que sale al entrar a la web
(templates/_popup_bono.html → /registro-bono), y solo vale con el correo registrado.
«Primera compra» = ni el correo, ni la cédula, ni el celular tienen un pedido web
pagado (status approved en orders.db).

El descuento se reparte en el precio de cada ítem (se guarda `precio_lista` al lado):
así MercadoPago cobra el valor rebajado y la factura automática, que factura
`price` como precio final, sale bien sin línea de descuento aparte.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime

from app.tools.web_pedidos import orders_db_path

log = logging.getLogger(__name__)

CUPON_REGISTRO = "BIENVENIDO10"

CUPONES: dict[str, dict] = {
    CUPON_REGISTRO: {"pct": 10, "solo_primera_compra": True, "requiere_registro": True,
                     "texto": "10 % en tu primera compra"},
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def normalizar_codigo(codigo: str) -> str:
    return re.sub(r"\s+", "", codigo or "").upper()


def _digitos(txt: str) -> str:
    return re.sub(r"\D", "", txt or "")


def _celular(txt: str) -> str:
    # «+57 319 518 3596» y «3195183596» son el mismo número.
    d = _digitos(txt)
    return d[-10:] if len(d) >= 10 else d


# ── Registro de la ventana emergente ──────────────────────────────────────────
def _con() -> sqlite3.Connection:
    con = sqlite3.connect(orders_db_path())
    con.execute(
        """CREATE TABLE IF NOT EXISTS registros_bono (
               email      TEXT PRIMARY KEY,
               nombre     TEXT,
               celular    TEXT,
               codigo     TEXT,
               acepta_datos_at TEXT,
               created_at TEXT,
               origen     TEXT
           )"""
    )
    return con


def esta_registrado(email: str) -> bool:
    email = (email or "").strip().lower()
    if not email:
        return False
    try:
        con = _con()
        row = con.execute("SELECT 1 FROM registros_bono WHERE email = ?", (email,)).fetchone()
        con.close()
        return bool(row)
    except sqlite3.Error:
        return False


def registrar(nombre: str, email: str, celular: str, *, origen: str = "") -> tuple[dict | None, str]:
    """Guarda el registro (con la autorización de datos) y devuelve el cupón.
    (None, motivo) si el correo no sirve o esa persona ya compró."""
    email = (email or "").strip().lower()
    nombre = (nombre or "").strip()[:120]
    if not _EMAIL_RE.match(email):
        return None, "Escribe un correo válido."
    if not nombre:
        return None, "Escribe tu nombre."
    if ya_compro(email, "", celular):
        return None, "Ya eres cliente de McKenna Group: el bono es para la primera compra. ¡Gracias por volver!"
    ahora = datetime.now().isoformat(timespec="seconds")
    con = _con()
    nuevo = con.execute("SELECT 1 FROM registros_bono WHERE email = ?", (email,)).fetchone() is None
    con.execute(
        """INSERT INTO registros_bono (email, nombre, celular, codigo, acepta_datos_at, created_at, origen)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(email) DO UPDATE SET nombre=excluded.nombre, celular=excluded.celular,
               acepta_datos_at=excluded.acepta_datos_at""",
        (email, nombre, _celular(celular), CUPON_REGISTRO, ahora, ahora, origen[:200]),
    )
    con.commit()
    con.close()
    return {"codigo": CUPON_REGISTRO, "nuevo": nuevo, **CUPONES[CUPON_REGISTRO]}, ""


def enviar_correo_bono(nombre: str, email: str) -> None:
    """Correo con el código (se llama en un hilo: si el SMTP falla, la ventana ya lo mostró)."""
    from app.tools.web_pedidos import _send_smtp, _wrap_mckenna_email

    primer = (nombre or "").split()[0] if nombre else ""
    saludo = f"Hola {primer}," if primer else "Hola,"
    texto = (
        f"{saludo}\n\nGracias por registrarte en McKenna Group. Tu código para la primera compra es "
        f"{CUPON_REGISTRO}: 10 % de descuento en los productos.\n\n"
        f"Escríbelo al pagar en https://mckennagroup.co, con este mismo correo ({email}).\n"
    )
    inner = (
        f"<p style=\"margin:0 0 14px;\">{saludo}</p>"
        "<p style=\"margin:0 0 18px;\">Gracias por registrarte en McKenna Group. Este es tu código para la primera compra:</p>"
        f"<p style=\"margin:0 0 18px;text-align:center;font-size:26px;font-weight:800;letter-spacing:3px;"
        f"color:#045159;border:2px dashed #0c6069;padding:14px;\">{CUPON_REGISTRO}</p>"
        "<p style=\"margin:0 0 14px;\"><strong>10 % de descuento</strong> en los productos. Escríbelo en la casilla "
        f"«¿Tienes un código de descuento?» al pagar, usando este mismo correo ({email}).</p>"
        "<p style=\"margin:0;\"><a href=\"https://mckennagroup.co/tienda\" style=\"color:#0c6069;font-weight:700;\">Ir a la tienda →</a></p>"
    )
    try:
        _send_smtp(email, f"Tu código de bienvenida: {CUPON_REGISTRO}", texto,
                   _wrap_mckenna_email(preheader=f"{CUPON_REGISTRO}: 10 % en tu primera compra", inner_html=inner))
    except Exception:
        log.warning("correo del bono a %s no salió", email, exc_info=True)


# ── Validación y descuento ────────────────────────────────────────────────────
def ya_compro(email: str = "", cedula: str = "", celular: str = "") -> bool:
    """True si el correo, la cédula o el celular aparecen en un pedido web pagado."""
    email = (email or "").strip().lower()
    cedula = _digitos(cedula)
    celular = _celular(celular)
    if not (email or cedula or celular):
        return False
    try:
        con = sqlite3.connect(orders_db_path())
        rows = con.execute(
            "SELECT buyer_email, buyer_phone, items_json FROM orders WHERE status = 'approved'"
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return False
    for mail, tel, items_json in rows:
        if email and (mail or "").strip().lower() == email:
            return True
        if celular and len(celular) >= 7 and _celular(tel) == celular:
            return True
        if cedula and len(cedula) >= 5:
            try:
                data = json.loads(items_json or "{}")
            except ValueError:
                continue
            ced_pedido = {_digitos(data.get("cedula") or ""), _digitos((data.get("billing") or {}).get("nit") or "")}
            if cedula in ced_pedido:
                return True
    return False


def validar(codigo: str, *, email: str = "", cedula: str = "", celular: str = "") -> tuple[dict | None, str]:
    """(cupón, "") si aplica; (None, motivo para el cliente) si no."""
    cod = normalizar_codigo(codigo)
    cupon = CUPONES.get(cod)
    if not cupon:
        return None, "Ese código no existe o ya no está vigente."
    if cupon.get("solo_primera_compra") or cupon.get("requiere_registro"):
        if not (email or "").strip():
            return None, "Escribe tu correo para validar el código."
    if cupon.get("requiere_registro") and not esta_registrado(email):
        return None, "Este código es para quienes se registran en la web. Usa el mismo correo con el que te registraste."
    if cupon.get("solo_primera_compra") and ya_compro(email, cedula, celular):
        return None, "Este código es solo para la primera compra, y ya tienes un pedido con nosotros."
    return {"codigo": cod, **cupon}, ""


def aplicar(cart: dict, cupon: dict) -> tuple[dict, float]:
    """Copia del carrito con el descuento repartido en cada ítem y el total descontado."""
    pct = float(cupon.get("pct") or 0) / 100
    nuevo: dict = {}
    descuento = 0.0
    for key, item in cart.items():
        lista = float(item.get("precio_lista") or item["price"])
        rebajado = round(lista * (1 - pct))
        descuento += (lista - rebajado) * int(item.get("qty") or 1)
        nuevo[key] = {**item, "precio_lista": lista, "price": rebajado}
    return nuevo, descuento
