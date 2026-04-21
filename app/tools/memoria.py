
import sqlite3
import chromadb
from datetime import datetime

# --- Configuración de Bases de Datos ---

# 1. Base de Datos Local (SQLite - Datos Estructurados)
def get_sqlite_conn():
    """Establece y devuelve una conexión a la base de datos SQLite."""
    try:
        # TODO: Hacer el nombre/ruta de la DB configurable.
        return sqlite3.connect('mckenna_business.db')
    except sqlite3.Error as e:
        print(f"❌ Error Crítico al conectar con SQLite: {e}")
        return None

# 2. Base de Datos Vectorial (ChromaDB - Memoria Experiencial)
try:
    # TODO: Hacer la ruta de la DB vectorial configurable.
    chroma_client = chromadb.PersistentClient(path="./memoria_vectorial")
    coleccion_experiencia = chroma_client.get_or_create_collection(name="mckenna_brain")
    coleccion_incidentes_fix = chroma_client.get_or_create_collection(
        name="incidentes_fix"
    )
except Exception as e:
    print(f"❌ Error Crítico al inicializar ChromaDB: {e}")
    chroma_client = None
    coleccion_experiencia = None
    coleccion_incidentes_fix = None

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

def query_vector_db(concepto: str) -> str:
    """ 
    Busca en la base de datos vectorial (ChromaDB) para encontrar conceptos, 
    historial de interacciones y experiencias de aprendizaje previas.
    """
    print(f"🧠 [VECTOR DB] Consultando memoria experiencial sobre: '{concepto}'")
    if not coleccion_experiencia:
        return "Error: La base de datos vectorial (memoria) no está disponible."

    try:
        # TODO: Hacer el número de resultados (n_results) configurable.
        resultados = coleccion_experiencia.query(query_texts=[concepto], n_results=3)
        
        if resultados and resultados.get('documents') and resultados['documents'][0]:
            # Unir los documentos encontrados en una sola respuesta coherente.
            experiencias_encontradas = "\n- ".join(resultados['documents'][0])
            return f"He encontrado los siguientes recuerdos o experiencias relevantes:\n- {experiencias_encontradas}"
        else:
            return "No tengo recuerdos o experiencias previas registradas sobre este tema específico."
            
    except Exception as e:
        return f"Error al acceder a la memoria vectorial: {e}"


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
