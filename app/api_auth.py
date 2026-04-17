"""
Normalización de CHAT_API_TOKEN (Bearer) para evitar fallos por espacios o comillas en .env / systemd.
"""

import os
from flask import request


def normalize_api_token(value: str | None) -> str:
    if value is None:
        return ""
    t = str(value).strip()
    if len(t) >= 2 and t[0] in "\"'" and t[0] == t[-1]:
        t = t[1:-1].strip()
    return t


def chat_api_token_expected() -> str:
    return normalize_api_token(os.getenv("CHAT_API_TOKEN"))


def bearer_token_from_request() -> str:
    h = (request.headers.get("Authorization") or "").strip()
    if h.lower().startswith("bearer "):
        return normalize_api_token(h[7:])
    return normalize_api_token(h)


def chat_api_token_matches_request() -> bool:
    return bearer_token_from_request() == chat_api_token_expected()
