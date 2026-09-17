"""Puente entre el PUC del libro propio y el catálogo PUC de Alegra.

Hasta sep-2026 la cuenta de Alegra estaba en el catálogo **NIIF**, cuyas cuentas
no tienen código PUC (`code: null`), así que el puente era `alegra_espejo.MAPA_PUC`:
un diccionario escrito a mano de código PUC → id interna de Alegra. Funcionaba,
pero era una traducción manual de 40 líneas que había que recordar actualizar.

Al pasar Alegra al catálogo **PUC**, cada cuenta trae su `code` real y las ids
cambian todas. Eso rompe el mapa a mano de una vez — y a la vez lo vuelve
innecesario: si las dos puntas hablan PUC, el puente es el código, no una tabla.

`construir_mapa()` recorre el árbol de Alegra y empareja por código, con una
cadena de respaldo explícita porque **el catálogo de Alegra es parcial** (981
cuentas; no trae el grupo 52 «operacionales de ventas», ni 1405, ni 3115):

1. código exacto;
2. el único descendiente que admite movimiento, a cualquier profundidad (nuestro
   4135 → su 413505; nuestro 1435 → su 14350501, porque el 143505 intermedio
   también es agrupadora). Si hay más de uno, NO se elige: son cuentas distintas
   y adivinar cuál es clasificar por sorteo;
3. si el nuestro es de 6 dígitos, la cuenta de 4 que lo contiene, si admite
   movimiento (nuestro 530595 → su 5305);
4. nada: queda **reportado** en `sin_equivalente`, nunca resuelto a una cuenta
   parecida. Espejar un gasto de ventas contra una cuenta de administración
   porque "se le acerca" es lo que hace que los estados no cuadren y nadie sepa
   por qué.

Ninguna función de acá escribe en Alegra.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

import requests

_BASE = "https://api.alegra.com/api/v1"
_CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "alegra_puc_catalogo.json")


def _headers() -> dict:
    user = os.getenv("ALEGRA_EMAIL") or os.getenv("ALEGRA_USER") or ""
    token = os.getenv("ALEGRA_TOKEN") or os.getenv("ALEGRA_API_KEY") or ""
    if not (user and token):
        from dotenv import dotenv_values

        env = dotenv_values(os.path.join(os.path.dirname(_CACHE), "..", "..", ".env"))
        user = user or env.get("ALEGRA_EMAIL") or env.get("ALEGRA_USER") or ""
        token = token or env.get("ALEGRA_TOKEN") or env.get("ALEGRA_API_KEY") or ""
    if not (user and token):
        raise RuntimeError("Faltan credenciales de Alegra (ALEGRA_EMAIL / ALEGRA_TOKEN)")
    cred = base64.b64encode(f"{user}:{token}".encode()).decode()
    return {"Authorization": f"Basic {cred}", "Accept": "application/json"}


def descargar_catalogo() -> dict[str, dict]:
    """Catálogo de cuentas de Alegra, aplanado por código PUC. Lo cachea en disco."""
    árbol = requests.get(f"{_BASE}/categories", headers=_headers(), timeout=60).json()
    plano: dict[str, dict] = {}

    def _recorrer(nodos: list, padre: str | None) -> None:
        for c in nodos or []:
            codigo = str(c.get("code") or "").strip()
            if codigo:
                plano[codigo] = {
                    "id": str(c.get("id")),
                    "nombre": c.get("name"),
                    "tipo": c.get("type"),
                    "naturaleza": c.get("nature"),
                    "movimiento": c.get("use") == "movement",
                    "padre": padre,
                }
            _recorrer(c.get("children") or [], codigo or padre)

    _recorrer(árbol if isinstance(árbol, list) else [], None)
    if not plano:
        raise RuntimeError(
            "Alegra no devolvió ninguna cuenta con código PUC. ¿La cuenta sigue en el "
            "catálogo NIIF? Se elige en app.alegra.com/category y no tiene endpoint."
        )
    os.makedirs(os.path.dirname(_CACHE), exist_ok=True)
    with open(_CACHE, "w", encoding="utf-8") as f:
        json.dump({"cuentas": plano}, f, ensure_ascii=False, indent=1)
    return plano


def catalogo(refrescar: bool = False) -> dict[str, dict]:
    if not refrescar:
        try:
            with open(_CACHE, encoding="utf-8") as f:
                cuentas = json.load(f).get("cuentas") or {}
            if cuentas:
                return cuentas
        except (OSError, ValueError):
            pass
    return descargar_catalogo()


# Cuando Alegra ofrece varias subcuentas igual de válidas, la elección es
# contable, no técnica: se decide acá una vez, a la vista, en vez de dejar que
# el emparejador sortee. Solo van las que tienen UNA respuesta evidente para
# McKenna; lo ambiguo de verdad se queda en `sin_equivalente` a propósito.
OVERRIDES: dict[str, str] = {
    # McKenna vende mercancía: sus ingresos operacionales son «Ingresos por
    # ventas». El otro candidato (41350101 «Ventas») cuelga de 413501, que es
    # otra actividad del CIIU.
    "4135": "413505",
    # Son socios, no accionistas: Alegra separa las dos y la 1325 las agrupa.
    "1325": "132505",
    # Cajón de sastre legítimo de Servicios mientras el gasto no se clasifique.
    "5135": "513595",
}


def _descendientes_movibles(plano: dict[str, dict], codigo: str) -> list[str]:
    """Descendientes de `codigo` que admiten movimiento, a cualquier profundidad.

    Alegra anida más que el decreto: bajo `1435` cuelga `143505`, que TAMBIÉN es
    agrupadora, y el movimiento vive en `14350501`. Buscar solo a 6 dígitos
    dejaba $144M de inventario sin cuenta donde asentar.
    """
    movibles = sorted(
        k for k in plano
        if k != codigo and k.startswith(codigo) and plano[k].get("movimiento")
    )
    # Quedarse solo con los más altos: Alegra repite la misma cuenta anidada
    # (413505 «Ingresos por ventas» y debajo 41350501, idéntica). Contar las dos
    # las hace parecer dos opciones distintas y el emparejamiento se declara
    # ambiguo cuando en realidad hay una sola.
    return [k for k in movibles if not any(k != o and k.startswith(o) for o in movibles)]


def construir_mapa(refrescar: bool = False) -> dict[str, Any]:
    """Empareja el PUC del libro con el de Alegra. Devuelve el mapa y lo que falta."""
    from app.services.puc_colombia import PUC_MCKENNA

    plano = catalogo(refrescar=refrescar)
    mapa: dict[str, str] = {}
    detalle: list[dict] = []
    sin_equivalente: list[dict] = []

    for codigo, nombre, _tipo in PUC_MCKENNA:
        destino, via = None, ""
        forzado = OVERRIDES.get(codigo)
        if forzado and forzado in plano and plano[forzado].get("movimiento"):
            destino, via = plano[forzado], f"elección explícita ({forzado})"
        elif codigo in plano and plano[codigo].get("movimiento"):
            destino, via = plano[codigo], "código exacto"
        else:
            hijas = _descendientes_movibles(plano, codigo)
            if len(hijas) == 1:
                destino, via = plano[hijas[0]], f"único descendiente ({hijas[0]})"
        if destino is None and len(codigo) == 6:
            padre = codigo[:4]
            if padre in plano and plano[padre].get("movimiento"):
                destino, via = plano[padre], f"cuenta padre ({padre})"
        if destino is None and codigo in plano:
            # Existe pero es agrupadora: no se puede asentar contra ella.
            sin_equivalente.append({
                "codigo": codigo, "nombre": nombre,
                "motivo": f"en Alegra existe pero es agrupadora ({plano[codigo]['nombre']})",
            })
            continue
        if destino is None:
            sin_equivalente.append({
                "codigo": codigo, "nombre": nombre,
                "motivo": "no está en el catálogo PUC de Alegra",
            })
            continue
        mapa[codigo] = destino["id"]
        detalle.append({
            "codigo": codigo, "nombre": nombre,
            "alegra_id": destino["id"], "alegra_nombre": destino["nombre"], "via": via,
        })

    return {
        "mapa": mapa,
        "detalle": detalle,
        "sin_equivalente": sin_equivalente,
        "cuentas_alegra": len(plano),
    }


def en_catalogo_puc() -> bool:
    """True si la cuenta de Alegra ya está en el catálogo PUC (y no en NIIF)."""
    try:
        return bool(catalogo())
    except Exception:
        return False
