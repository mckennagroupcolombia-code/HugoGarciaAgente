
import json
import os
import sqlite3
import threading
import time
import chromadb
from datetime import datetime

# --- Configuración de Bases de Datos ---

# 1. Base de Datos Local (SQLite - Datos Estructurados)
def get_sqlite_conn():
    """Establece y devuelve una conexión a la base de datos SQLite."""
    try:
        return sqlite3.connect('mckenna_business.db')
    except sqlite3.Error as e:
        print(f"❌ Error Crítico al conectar con SQLite: {e}")
        return None

_CHROMA_PATH = os.getenv("CHROMA_DB_PATH", "./memoria_vectorial")

# 2. Base de Datos Vectorial (ChromaDB - Memoria Experiencial)
try:
    chroma_client = chromadb.PersistentClient(path=_CHROMA_PATH)
    coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")
    coleccion_incidentes_fix = chroma_client.get_or_create_collection(name="incidentes_fix")
    # Colección dedicada a Q&A de productos (preventa y WhatsApp)
    coleccion_qa = chroma_client.get_or_create_collection(name="preventa_qa")
except Exception as e:
    print(f"❌ Error Crítico al inicializar ChromaDB: {e}")
    chroma_client = None
    coleccion_experiencia = None
    coleccion_incidentes_fix = None
    coleccion_qa = None

_qa_lock = threading.Lock()
# Distancia coseno máxima aceptable para considerar un recuerdo "relevante".
# ChromaDB cosine distance: 0 = idéntico, 2 = opuesto.
# Rango práctico: <1.0 muy similar, 1.0–1.4 relacionado, >1.5 poco relevante.
_DISTANCIA_MAX_RELEVANTE = float(os.getenv("CHROMA_DISTANCIA_MAX", "1.3"))

# --- Funciones de Consulta de Memoria ---

def query_sqlite(consulta_sql: str) -> str:
    """
    Ejecuta una consulta SQL en la base de datos local (SQLite) para obtener datos estructurados y precisos.
    Retorna los resultados como un string formateado.
    """
    print(f"🔍 [SQLITE] Ejecutando consulta: {consulta_sql}")
    conn = get_sqlite_conn()
    if not conn:
        return "Error: No se pudo establecer conexión con la base de datos local."

    try:
        cursor = conn.cursor()
        cursor.execute(consulta_sql)
        resultados = cursor.fetchall()
        conn.close()
        
        if resultados:
            # Formatear la salida para que sea más legible
            header = [description[0] for description in cursor.description]
            formatted_results = [dict(zip(header, row)) for row in resultados]
            return f"Resultados de la consulta SQLite:\n{formatted_results}"
        else:
            return "No se encontraron datos en la base de datos local para esta consulta."
            
    except sqlite3.Error as e:
        return f"Error al ejecutar la consulta en SQLite: {e}"
    finally:
        if conn:
            conn.close()

def _query_coleccion_con_score(
    coleccion,
    concepto: str,
    n: int = 5,
    distancia_max: float | None = None,
) -> list[str]:
    """Consulta una colección ChromaDB y filtra por distancia máxima."""
    if not coleccion:
        return []
    umbral = distancia_max if distancia_max is not None else _DISTANCIA_MAX_RELEVANTE
    try:
        res = coleccion.query(
            query_texts=[concepto[:500]],
            n_results=min(n, max(1, coleccion.count())),
            include=["documents", "distances"],
        )
        docs = (res.get("documents") or [[]])[0] or []
        dists = (res.get("distances") or [[]])[0] or []
        return [
            doc for doc, dist in zip(docs, dists)
            if dist <= umbral and doc and doc.strip()
        ]
    except Exception:
        return []


def query_vector_db(concepto: str) -> str:
    """
    Busca en la base de datos vectorial (ChromaDB) experiencias y Q&A relevantes.
    Consulta tanto mckenna_brain (experiencias generales) como preventa_qa (productos).
    Solo retorna resultados con alta similitud semántica (distancia ≤ CHROMA_DISTANCIA_MAX).
    """
    print(f"🧠 [VECTOR DB] Consultando memoria sobre: '{concepto[:80]}'")
    if not coleccion_experiencia and not coleccion_qa:
        return "Error: La base de datos vectorial (memoria) no está disponible."

    fragmentos: list[str] = []
    fragmentos += _query_coleccion_con_score(coleccion_qa, concepto, n=5)
    fragmentos += _query_coleccion_con_score(coleccion_experiencia, concepto, n=3)

    # Deduplicar (puede haber overlaps si se sembró en ambas)
    vistos: set[str] = set()
    unicos = []
    for f in fragmentos:
        key = f[:120]
        if key not in vistos:
            vistos.add(key)
            unicos.append(f)

    if not unicos:
        return "No tengo recuerdos o experiencias previas registradas sobre este tema específico."

    return "He encontrado los siguientes recuerdos o experiencias relevantes:\n- " + "\n- ".join(unicos[:6])


def guardar_incidente_fix(
    error: str,
    causa: str,
    solucion: str,
    origen: str = "desconocido",
    metadata: dict | None = None,
) -> str:
    """
    Guarda un incidente técnico resuelto en memoria vectorial para reuso futuro.
    """
    if not coleccion_incidentes_fix:
        return "Error: colección de incidentes no disponible."
    try:
        meta = dict(metadata or {})
        timestamp = datetime.utcnow().isoformat()
        incident_id = f"inc_{timestamp}_{abs(hash((error, solucion))) % 1000000}"
        documento = (
            f"Origen: {origen}\n"
            f"Error: {error}\n"
            f"Causa: {causa}\n"
            f"Solución: {solucion}\n"
            f"Timestamp: {timestamp}"
        )
        meta.update({"origen": origen, "timestamp": timestamp})
        coleccion_incidentes_fix.add(
            documents=[documento],
            metadatas=[meta],
            ids=[incident_id],
        )
        return f"Incidente guardado en memoria vectorial con ID {incident_id}."
    except Exception as e:
        return f"Error guardando incidente en memoria vectorial: {e}"


def query_memoria_pre_respuesta(
    pregunta: str,
    producto: str = "",
    historial_texto: str = "",
    n_por_query: int = 4,
) -> str:
    """
    Recupera memoria relevante ANTES de que el bot responda.

    Estrategia multi-query:
    1. Pregunta original                              → casos con misma duda
    2. Producto + pregunta (si se conoce el producto)  → casos del mismo SKU
    3. Solo producto                                   → contexto general del artículo
    4. Fragmento del historial reciente               → continuidad temática

    Devuelve un bloque de texto listo para inyectar en el prompt,
    o "" si no hay nada relevante.
    """
    pregunta = (pregunta or "").strip()
    if not pregunta:
        return ""

    queries: list[str] = [pregunta[:500]]

    prod = (producto or "").strip()
    if prod and prod.lower()[:20] not in pregunta.lower():
        queries.append(f"{prod}: {pregunta[:300]}")
        queries.append(prod)

    # Contexto de historial: últimas 2 líneas del cliente para mantener hilo
    if historial_texto:
        frag = historial_texto.strip()[-300:]
        if frag and frag not in queries:
            queries.append(frag)

    fragmentos: list[str] = []
    vistos: set[str] = set()

    for q in queries:
        for col in (coleccion_qa, coleccion_experiencia):
            for doc in _query_coleccion_con_score(col, q, n=n_por_query):
                key = doc[:100]
                if key not in vistos:
                    vistos.add(key)
                    fragmentos.append(doc)

    if not fragmentos:
        return ""

    bloques = "\n\n".join(f"• {f}" for f in fragmentos[:7])
    return f"[Casos similares recuperados de memoria]\n{bloques}"


def guardar_qa_exitoso(
    pregunta: str,
    respuesta: str,
    canal: str = "whatsapp",
    producto: str = "",
) -> None:
    """
    Guarda un par pregunta→respuesta exitoso en ChromaDB para aprendizaje futuro.
    El agente recuperará estos casos en conversaciones similares.
    Llámalo en hilo daemon — no bloquea; ignora errores silenciosamente.
    """
    if not coleccion_qa:
        return
    pregunta = (pregunta or "").strip()[:600]
    respuesta = (respuesta or "").strip()[:1200]
    if not pregunta or not respuesta:
        return
    # No guardar respuestas de error o muy cortas
    errores = ("tuve un problema técnico", "no pude procesar", "error:", "❌", "intente de nuevo")
    resp_lower = respuesta.lower()
    if len(respuesta) < 60 or any(e in resp_lower for e in errores):
        return
    try:
        with _qa_lock:
            ts = datetime.utcnow().isoformat()
            doc_id = f"qa_{int(time.time())}_{abs(hash(pregunta + respuesta)) % 1_000_000}"
            documento = f"Pregunta: {pregunta}\nRespuesta: {respuesta}"
            meta: dict = {"canal": canal, "ts": ts}
            if producto:
                meta["producto"] = producto[:100]
            coleccion_qa.add(
                documents=[documento],
                metadatas=[meta],
                ids=[doc_id],
            )
    except Exception as exc:
        print(f"[memoria] error guardando QA exitoso: {exc}")


def sembrar_casos_preventa(forzar: bool = False) -> int:
    """
    Importa app/training/casos_preventa.json a ChromaDB (colección preventa_qa).
    Solo corre si la colección tiene <10 entradas o si forzar=True.
    Retorna la cantidad de casos sembrados.
    """
    if not coleccion_qa:
        print("[memoria] ChromaDB no disponible, no se puede sembrar preventa.")
        return 0

    try:
        ya_tiene = coleccion_qa.count()
    except Exception:
        ya_tiene = 0

    if ya_tiene >= 10 and not forzar:
        print(f"[memoria] preventa_qa ya tiene {ya_tiene} entradas — siembra omitida.")
        return 0

    casos_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "training",
        "casos_preventa.json",
    )
    try:
        with open(casos_path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print(f"[memoria] No se pudo leer casos_preventa.json: {exc}")
        return 0

    casos = data.get("casos", [])
    if not casos:
        return 0

    sembrados = 0
    batch_docs, batch_metas, batch_ids = [], [], []
    for c in casos:
        pregunta = (c.get("pregunta") or "").strip()[:600]
        respuesta = (c.get("respuesta") or "").strip()[:1200]
        producto = (c.get("producto") or "").strip()[:100]
        ts = c.get("timestamp", "")
        if not pregunta or not respuesta:
            continue
        doc_id = f"preventa_{abs(hash(pregunta + respuesta)) % 10_000_000}"
        documento = f"Pregunta: {pregunta}\nRespuesta: {respuesta}"
        meta: dict = {"canal": "preventa", "ts": ts}
        if producto:
            meta["producto"] = producto
        batch_docs.append(documento)
        batch_metas.append(meta)
        batch_ids.append(doc_id)
        sembrados += 1

        # Escribir en lotes de 50 para evitar timeouts
        if len(batch_docs) >= 50:
            try:
                coleccion_qa.upsert(documents=batch_docs, metadatas=batch_metas, ids=batch_ids)
            except Exception as exc:
                print(f"[memoria] error en lote siembra: {exc}")
            batch_docs, batch_metas, batch_ids = [], [], []

    if batch_docs:
        try:
            coleccion_qa.upsert(documents=batch_docs, metadatas=batch_metas, ids=batch_ids)
        except Exception as exc:
            print(f"[memoria] error en lote final siembra: {exc}")

    print(f"[memoria] ✅ Sembrados {sembrados} casos preventa en ChromaDB (preventa_qa).")
    return sembrados


def buscar_incidentes_similares(problema: str, max_resultados: int = 3) -> list[dict]:
    """
    Recupera incidentes técnicos parecidos desde la colección de fixes.
    """
    if not coleccion_incidentes_fix:
        return []
    try:
        resultados = coleccion_incidentes_fix.query(
            query_texts=[problema],
            n_results=max(1, int(max_resultados)),
        )
        docs = (resultados or {}).get("documents", [[]])[0] or []
        metas = (resultados or {}).get("metadatas", [[]])[0] or []
        ids = (resultados or {}).get("ids", [[]])[0] or []
        out = []
        for idx, doc in enumerate(docs):
            out.append(
                {
                    "id": ids[idx] if idx < len(ids) else "",
                    "documento": doc,
                    "metadata": metas[idx] if idx < len(metas) else {},
                }
            )
        return out
    except Exception:
        return []


def ciclo_aprendizaje_diario() -> dict:
    """
    Ciclo automático de aprendizaje. Llamar una vez al día (ej. 3 AM desde monitor.py).

    Pasos:
    1. Aprende de interacciones recientes en MeLi (últimas 15 preguntas respondidas)
       → resume con Gemini y guarda en mckenna_brain (ChromaDB)
    2. Re-siembra casos_preventa.json (idempotente — solo agrega los que no existen)
    3. Reporta cuánto creció la memoria

    Retorna dict con resultados de cada paso.
    """
    resultado: dict = {"meli": "", "preventa": 0, "total_qa": 0, "total_brain": 0}

    # Paso 1: aprender de MeLi
    try:
        from app.services.meli import aprender_de_interacciones_meli
        resultado["meli"] = aprender_de_interacciones_meli()
        print(f"[memoria] aprendizaje MeLi: {str(resultado['meli'])[:120]}")
    except Exception as exc:
        resultado["meli"] = f"error: {exc}"
        print(f"[memoria] ⚠️ aprendizaje MeLi: {exc}")

    # Paso 2: re-sembrar casos preventa (agrega nuevos, no duplica)
    try:
        resultado["preventa"] = sembrar_casos_preventa(forzar=False)
    except Exception as exc:
        print(f"[memoria] ⚠️ siembra preventa: {exc}")

    # Paso 3: contar colecciones
    try:
        resultado["total_qa"] = coleccion_qa.count() if coleccion_qa else 0
        resultado["total_brain"] = coleccion_experiencia.count() if coleccion_experiencia else 0
    except Exception:
        pass

    print(
        f"[memoria] ✅ ciclo diario — preventa_qa: {resultado['total_qa']} docs, "
        f"mckenna_brain: {resultado['total_brain']} docs"
    )
    return resultado
