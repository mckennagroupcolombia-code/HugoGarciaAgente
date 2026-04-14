#!/usr/bin/env python3
"""Consulta memoria vectorial de bugs resueltos."""

from __future__ import annotations

import argparse
from pathlib import Path

import chromadb


REPO_ROOT = Path(__file__).resolve().parents[1]
VECTOR_PATH = REPO_ROOT / "memoria_vectorial"
COLLECTION_NAME = "mckenna_debug_memory"


def main() -> int:
    parser = argparse.ArgumentParser(description="Consultar memoria debug (ChromaDB).")
    parser.add_argument("--q", required=True, help="Consulta semantica")
    parser.add_argument("--n", type=int, default=5, help="Resultados maximos")
    args = parser.parse_args()

    client = chromadb.PersistentClient(path=str(VECTOR_PATH))
    collection = client.get_or_create_collection(name=COLLECTION_NAME)
    result = collection.query(query_texts=[args.q], n_results=max(1, args.n))

    docs = (result.get("documents") or [[]])[0]
    metas = (result.get("metadatas") or [[]])[0]
    ids = (result.get("ids") or [[]])[0]
    dists = (result.get("distances") or [[]])[0]

    if not docs:
        print("Sin resultados en memoria debug.")
        return 0

    for i, doc in enumerate(docs, start=1):
        meta = metas[i - 1] if i - 1 < len(metas) else {}
        doc_id = ids[i - 1] if i - 1 < len(ids) else "sin_id"
        dist = dists[i - 1] if i - 1 < len(dists) else None
        score = "n/a" if dist is None else f"{dist:.4f}"
        print("=" * 72)
        print(f"[{i}] id={doc_id} distancia={score}")
        print(f"titulo={meta.get('titulo', '')}")
        print(f"tags={meta.get('tags', '')}")
        print(doc)
    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
