"""
Indexa el código fuente del proyecto McKenna en ChromaDB (colección proyecto_codigo).
Usar una vez para construir el índice; re-ejecutar tras cambios grandes.

Uso directo:
    source venv/bin/activate && python3 -m app.tools.project_indexer
"""
import hashlib
from pathlib import Path
from typing import Generator

import chromadb

REPO_ROOT = Path(__file__).parent.parent.parent
CHROMA_PATH = REPO_ROOT / "memoria_vectorial"
COLLECTION_NAME = "proyecto_codigo"

_INCLUDE_EXTENSIONS = {".py", ".ts", ".tsx"}
_INCLUDE_JSON_DIRS = {"app/data", "app/training"}  # JSON de datos del proyecto (sin credenciales)
_SKIP_JSON_FILES = {
    "credenciales_meli.json", "credenciales_google.json", "credenciales_SIIGO.json",
    "tickets.db",
}
_SKIP_DIRS = {
    "venv", "node_modules", "__pycache__", ".git", "memoria_vectorial",
    "backups_drive", "dist", ".venv", "facturas_descargadas", "comprobantes",
    "cotizaciones_preliminares", "DISENO CORPORATIVO",
}
_MAX_CHUNK = 1500


def _chunks(content: str, filepath: str, comment_prefix: str) -> Generator[dict, None, None]:
    lines = content.splitlines(keepends=True)
    current: list[str] = []
    start = 1

    def _flush(end_line: int):
        text = "".join(current)
        if len(text.strip()) > 50:
            yield {
                "text": f"{comment_prefix} {filepath} (líneas {start}-{end_line})\n" + text,
                "file": filepath,
                "lines": f"{start}-{end_line}",
            }

    for i, line in enumerate(lines, 1):
        current.append(line)
        chunk_text = "".join(current)

        stripped = line.strip()
        is_boundary = (
            stripped.startswith(("def ", "async def ", "class ", "export ", "function ", "const ", "interface "))
            and len(current) > 8
        )

        if (len(chunk_text) >= _MAX_CHUNK and is_boundary) or len(chunk_text) >= _MAX_CHUNK * 1.8:
            yield from _flush(i)
            current = current[-8:]  # overlap
            start = i - 7

    if current:
        yield from _flush(len(lines))


def _iter_files() -> Generator[Path, None, None]:
    # Archivos de código fuente
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel_parts = set(path.relative_to(REPO_ROOT).parts)
        if rel_parts & _SKIP_DIRS:
            continue
        if path.suffix in _INCLUDE_EXTENSIONS:
            yield path
            continue
        # JSON de datos del proyecto (solo directorios permitidos)
        if path.suffix == ".json" and path.name not in _SKIP_JSON_FILES:
            rel = path.relative_to(REPO_ROOT)
            parent = str(rel.parent)
            if any(parent == d or parent.startswith(d + "/") for d in _INCLUDE_JSON_DIRS):
                yield path


def indexar_proyecto(verbose: bool = True) -> dict:
    """
    Indexa todos los archivos .py / .ts / .tsx del repo en la colección
    `proyecto_codigo` de ChromaDB. Usa upsert: es idempotente.
    """
    cc = chromadb.PersistentClient(path=str(CHROMA_PATH))
    col = cc.get_or_create_collection(COLLECTION_NAME)

    total_files = 0
    total_chunks = 0
    errors: list[str] = []

    for filepath in _iter_files():
        rel = str(filepath.relative_to(REPO_ROOT))
        try:
            content = filepath.read_text(encoding="utf-8", errors="replace")
            if not content.strip():
                continue

            if filepath.suffix == ".json":
                prefix = "//"
                # JSON pequeño: indexar completo como un chunk
                header = f"// {rel} (datos JSON del proyecto)\n"
                chunks = [{"text": header + content, "file": rel, "lines": "completo"}] if len(content) < _MAX_CHUNK * 3 else list(_chunks(content, rel, "//"))
            else:
                prefix = "#" if filepath.suffix == ".py" else "//"
                chunks = list(_chunks(content, rel, prefix))

            for chunk in chunks:
                doc_id = hashlib.md5(f"{rel}:{chunk['lines']}".encode()).hexdigest()
                col.upsert(
                    documents=[chunk["text"]],
                    ids=[doc_id],
                    metadatas=[{"file": chunk["file"], "lines": chunk["lines"], "tipo": "codigo_fuente"}],
                )
                total_chunks += 1

            total_files += 1
            if verbose:
                print(f"  ✓ {rel} ({len(chunks)} chunks)")

        except Exception as exc:
            errors.append(f"{rel}: {exc}")
            if verbose:
                print(f"  ✗ {rel}: {exc}")

    return {"archivos": total_files, "chunks": total_chunks, "errores": errors}


def buscar_en_proyecto(query: str, n: int = 5) -> list[str]:
    """RAG: retorna los n fragmentos de código más relevantes para la query."""
    try:
        cc = chromadb.PersistentClient(path=str(CHROMA_PATH))
        col = cc.get_collection(COLLECTION_NAME)
        res = col.query(query_texts=[query], n_results=n)
        docs = res.get("documents", [[]])[0]
        metas = res.get("metadatas", [[]])[0]
        out = []
        for doc, meta in zip(docs, metas):
            header = f"[{meta.get('file','')} L{meta.get('lines','')}]"
            out.append(f"{header}\n{doc}")
        return out
    except Exception:
        return []


if __name__ == "__main__":
    print(f"Indexando proyecto McKenna desde {REPO_ROOT}…")
    stats = indexar_proyecto(verbose=True)
    print(f"\n✅ Listo: {stats['archivos']} archivos · {stats['chunks']} chunks")
    if stats["errores"]:
        print(f"⚠️  Errores ({len(stats['errores'])}): {stats['errores'][:5]}")
