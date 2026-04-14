#!/usr/bin/env python3
"""Guarda bugs resueltos en JSONL y memoria vectorial (ChromaDB)."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path

import chromadb


REPO_ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = REPO_ROOT / "app" / "data" / "debugging_resuelto.jsonl"
VECTOR_PATH = REPO_ROOT / "memoria_vectorial"
COLLECTION_NAME = "mckenna_debug_memory"


def _norm_csv(value: str) -> str:
    return ", ".join([x.strip() for x in value.split(",") if x.strip()])


def _make_document(entry: dict) -> str:
    return (
        f"titulo: {entry['titulo']}\n"
        f"problema: {entry['problema']}\n"
        f"causa_raiz: {entry['causa_raiz']}\n"
        f"solucion: {entry['solucion']}\n"
        f"archivos: {entry['archivos']}\n"
        f"tags: {entry['tags']}\n"
        f"fuente: {entry['fuente']}\n"
        f"fecha: {entry['fecha']}"
    )


def _entry_id(entry: dict) -> str:
    base = f"{entry['titulo']}|{entry['problema']}|{entry['solucion']}"
    return "dbg_" + hashlib.sha256(base.encode("utf-8")).hexdigest()[:20]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guardar bug resuelto en dataset y ChromaDB."
    )
    parser.add_argument("--titulo", required=True)
    parser.add_argument("--problema", required=True)
    parser.add_argument("--causa-raiz", required=True, dest="causa_raiz")
    parser.add_argument("--solucion", required=True)
    parser.add_argument("--archivos", default="")
    parser.add_argument("--tags", default="")
    parser.add_argument("--fuente", default="manual")
    args = parser.parse_args()

    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "fecha": dt.datetime.now().isoformat(timespec="seconds"),
        "titulo": args.titulo.strip(),
        "problema": args.problema.strip(),
        "causa_raiz": args.causa_raiz.strip(),
        "solucion": args.solucion.strip(),
        "archivos": _norm_csv(args.archivos),
        "tags": _norm_csv(args.tags),
        "fuente": args.fuente.strip(),
    }
    doc_id = _entry_id(entry)
    doc = _make_document(entry)

    with DATASET_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"id": doc_id, **entry}, ensure_ascii=False) + "\n")

    client = chromadb.PersistentClient(path=str(VECTOR_PATH))
    collection = client.get_or_create_collection(name=COLLECTION_NAME)
    collection.upsert(
        ids=[doc_id],
        documents=[doc],
        metadatas=[
            {
                "fecha": entry["fecha"],
                "titulo": entry["titulo"][:180],
                "tags": entry["tags"][:250],
                "fuente": entry["fuente"][:120],
                "archivos": entry["archivos"][:400],
            }
        ],
    )

    print(f"OK memoria debug guardada: {doc_id}")
    print(f"Dataset: {DATASET_PATH}")
    print(f"Coleccion: {COLLECTION_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
