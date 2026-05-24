"""
Memoria Semántica — ChromaDB con score híbrido coseno + recencia.

Reemplaza la consulta cruda de query_vector_db() en memoria.py añadiendo:
  - Peso de recencia (decay exponencial por edad en días)
  - Re-ranking antes de devolver al LLM
  - Almacenamiento con timestamp obligatorio
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

try:
    import chromadb

    _chroma_client = chromadb.PersistentClient(
        path=os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "memoria_vectorial",
        )
    )
    _col_experience = _chroma_client.get_or_create_collection(name="mckenna_brain")
    _col_incidents = _chroma_client.get_or_create_collection(name="incidentes_fix")
    _CHROMA_OK = True
except Exception as _e:
    _chroma_client = None
    _col_experience = None
    _col_incidents = None
    _CHROMA_OK = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _recency_score(timestamp_iso: str, half_life_days: int = 90) -> float:
    """
    Score de recencia entre 0 y 1. Decae a 0.5 en half_life_days.
    Documentos sin timestamp reciben 0.5 (neutral).
    """
    if not timestamp_iso:
        return 0.5
    try:
        ts = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - ts).days
        return 0.5 ** (age_days / half_life_days)
    except Exception:
        return 0.5


def _hybrid_score(cosine_dist: float, timestamp_iso: str, recency_weight: float = 0.25) -> float:
    """
    Score final combinado. ChromaDB devuelve distancia (menor = más similar).
    Convertimos a similitud: sim = 1 - dist (asumiendo distancia L2 normalizada).
    """
    similarity = max(0.0, 1.0 - cosine_dist)
    recency = _recency_score(timestamp_iso)
    return similarity * (1 - recency_weight) + recency * recency_weight


def query(
    texto: str,
    n: int = 3,
    collection: str = "experience",
    recency_weight: float = 0.25,
    max_chars: int = 1800,
) -> str:
    """
    Consulta semántica con re-ranking híbrido.
    Retorna texto concatenado listo para inyectar al prompt.
    """
    col = _col_experience if collection != "incidents" else _col_incidents
    if col is None:
        return ""
    if not texto or not texto.strip():
        return ""
    try:
        raw = col.query(
            query_texts=[texto[:500]],
            n_results=min(n * 3, 20),
            include=["documents", "metadatas", "distances"],
        )
    except Exception:
        return ""

    docs = (raw.get("documents") or [[]])[0] or []
    metas = (raw.get("metadatas") or [[]])[0] or []
    dists = (raw.get("distances") or [[]])[0] or []

    if not docs:
        return ""

    # Re-ranking híbrido
    scored: list[tuple[float, str]] = []
    for doc, meta, dist in zip(docs, metas, dists):
        ts = (meta or {}).get("timestamp", "")
        score = _hybrid_score(float(dist), ts, recency_weight)
        scored.append((score, doc))

    scored.sort(key=lambda x: -x[0])
    top = [doc for _, doc in scored[:n]]

    resultado = "\n- ".join(top)
    if resultado:
        resultado = "- " + resultado
    return resultado[:max_chars]


def store(
    text: str,
    doc_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    collection: str = "experience",
) -> str:
    """
    Almacena un documento con timestamp automático.
    Retorna el doc_id usado.
    """
    col = _col_experience if collection != "incidents" else _col_incidents
    if col is None:
        return ""
    if not text or not text.strip():
        return ""
    ts = _now_iso()
    meta = dict(metadata or {})
    meta["timestamp"] = ts
    if doc_id is None:
        doc_id = f"doc_{ts}_{abs(hash(text)) % 1_000_000}"
    try:
        col.add(documents=[text], metadatas=[meta], ids=[doc_id])
    except Exception as e:
        # Si ya existe, actualizar
        try:
            col.update(documents=[text], metadatas=[meta], ids=[doc_id])
        except Exception:
            return f"error: {e}"
    return doc_id


def store_incident(
    error: str,
    causa: str,
    solucion: str,
    origen: str = "desconocido",
    metadata: dict[str, Any] | None = None,
) -> str:
    """Guarda un incidente resuelto en la colección de incidentes."""
    ts = _now_iso()
    doc_id = f"inc_{ts}_{abs(hash((error, solucion))) % 1_000_000}"
    texto = (
        f"Origen: {origen}\n"
        f"Error: {error}\n"
        f"Causa: {causa}\n"
        f"Solución: {solucion}"
    )
    meta = dict(metadata or {})
    meta.update({"origen": origen, "timestamp": ts})
    return store(texto, doc_id=doc_id, metadata=meta, collection="incidents")


def query_incidents(problema: str, n: int = 3) -> list[dict]:
    """Recupera incidentes similares con metadata. Compatibilidad con autocorrector."""
    col = _col_incidents
    if col is None:
        return []
    try:
        raw = col.query(
            query_texts=[problema[:500]],
            n_results=max(1, n),
            include=["documents", "metadatas", "distances"],
        )
    except Exception:
        return []
    docs = (raw.get("documents") or [[]])[0] or []
    metas = (raw.get("metadatas") or [[]])[0] or []
    ids = (raw.get("ids") or [[]])[0] or []
    out = []
    for i, doc in enumerate(docs):
        out.append(
            {
                "id": ids[i] if i < len(ids) else "",
                "documento": doc,
                "metadata": metas[i] if i < len(metas) else {},
            }
        )
    return out


def is_available() -> bool:
    return _CHROMA_OK
