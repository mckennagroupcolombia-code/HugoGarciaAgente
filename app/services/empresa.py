"""
Identidad fiscal de McKenna Group S.A.S. — una sola fuente.

Existe porque el NIT estaba escrito a mano en cuatro sitios y en dos de ellos
estaba MAL: `cuenta_cobro_cuota_manejo.datos_pagador()` y
`CuentaCobroAprobacion.tsx` traían "901.952.087-1", con lo que las 41 cuentas de
cobro emitidas hasta el 2026-09-10 salieron con un NIT que no es el de la
empresa. El módulo de préstamos heredó el error al copiarlo de ahí.

Cualquier módulo que necesite razón social, NIT o ciudad de McKenna debe
llamarlas de acá y NO volver a escribir el literal. Los `os.getenv` específicos
de cada módulo se siguen respetando por compatibilidad, pero el default sale de
un solo lugar.

NIT verificado contra `GET /company` de Alegra el 2026-09-10:
identification 901316016, dv 3.
"""

from __future__ import annotations

import os
import re

RAZON_SOCIAL_DEFAULT = "McKenna Group S.A.S."
NIT_DEFAULT = "901.316.016-3"
CIUDAD_DEFAULT = "Bogotá D.C."


# ─── Representante legal y su firma ─────────────────────────────────────────
# Datos del RUT 2026 (renglón 984/985: "GARCIA VELANDIA HUGO ARMANDO,
# Representante legal Certificado"). La cédula sale de su perfil del panel.
REPRESENTANTE_LEGAL_DEFAULT = "Hugo Armando García Velandia"
REPRESENTANTE_CEDULA_DEFAULT = "1013630698"
REPRESENTANTE_CARGO_DEFAULT = "Representante Legal"

# La firma vive FUERA del repo a propósito: es un activo sensible —con ella se
# puede firmar cualquier cosa— y el repo está en git. Convención nivel 3 de
# CLAUDE.md: archivo que un humano gestiona desde el explorador y el código
# consume por ruta. Si falta, `firma_representante()` devuelve None y quien la
# use debe decirlo, no emitir un documento sin firma como si nada.
FIRMA_REPRESENTANTE_PATH_DEFAULT = (
    "/home/mckg/Documentos/Documentos Legales MCKENNA GROUP/FIRMA REPRESENTANTE LEGAL.png"
)


def representante_legal() -> dict:
    """Quién firma a nombre de McKenna, y con qué firma."""
    return {
        "nombre": (os.getenv("EMPRESA_REPRESENTANTE") or REPRESENTANTE_LEGAL_DEFAULT).strip(),
        "cedula": (os.getenv("EMPRESA_REPRESENTANTE_CEDULA") or REPRESENTANTE_CEDULA_DEFAULT).strip(),
        "cargo": (os.getenv("EMPRESA_REPRESENTANTE_CARGO") or REPRESENTANTE_CARGO_DEFAULT).strip(),
        "firma_path": firma_representante(),
    }


def firma_representante() -> str | None:
    """Ruta del PNG de la firma, o None si no está donde se espera.

    Devuelve None en vez de fallar: un documento sin firma se puede firmar a
    mano, pero un proceso que revienta a mitad deja al usuario sin nada.
    """
    ruta = (os.getenv("EMPRESA_FIRMA_PATH") or FIRMA_REPRESENTANTE_PATH_DEFAULT).strip()
    return ruta if ruta and os.path.isfile(ruta) else None


def razon_social(override_env: str = "") -> str:
    return (
        (os.getenv(override_env) if override_env else "")
        or os.getenv("EMPRESA_RAZON_SOCIAL")
        or RAZON_SOCIAL_DEFAULT
    ).strip()


def nit(override_env: str = "") -> str:
    """NIT con dígito de verificación, formateado (901.316.016-3)."""
    return (
        (os.getenv(override_env) if override_env else "")
        or os.getenv("EMPRESA_NIT")
        or NIT_DEFAULT
    ).strip()


def nit_sin_dv(override_env: str = "") -> str:
    """Solo la base, sin puntos ni dígito de verificación (901316016).

    Es lo que esperan las APIs (Alegra guarda el dv aparte) y lo que manda en
    el calendario tributario.
    """
    base = re.split(r"[-–]", nit(override_env))[0]
    digits = re.sub(r"\D", "", base)
    # Vino corrido y sin separador: los 10 dígitos son base(9)+DV
    if len(digits) == 10 and "-" not in nit(override_env):
        digits = digits[:-1]
    return digits


def ciudad(override_env: str = "") -> str:
    return (
        (os.getenv(override_env) if override_env else "")
        or os.getenv("EMPRESA_CIUDAD")
        or CIUDAD_DEFAULT
    ).strip()
