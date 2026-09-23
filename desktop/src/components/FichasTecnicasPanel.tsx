import { ico } from "../icons/icoTexto";
import { Ico } from "../icons/Ico";
import EnlazarDocumento from "./combos/EnlazarDocumento";
import { useAppStore } from "../stores/app";
import { Fragment, useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import ImageLightbox from "./ImageLightbox";
import DocumentoGeneradorTab, {
  type GenerarDocResult,
  Field,
  filasDesdeTexto,
  filasTresDesdeTexto,
  listaDesdeTexto,
  textoDesdeFilas,
  textoDesdeFilasTres,
} from "./documentos/DocumentoGeneradorTab";
import { TablaComposicion } from "./documentos/TablaComposicion";
import FichaTecnicaForm from "./documentos/FichaTecnicaForm";
import CoaDocumentosScanner from "./documentos/CoaDocumentosScanner";
import CargarDocumentosWebButton from "./documentos/CargarDocumentosWebButton";
import FirmaPegable from "./documentos/FirmaPegable";
import SdsSeccion, { SDS_VACIA, sdsAPayload, sdsDesdeDatos, type ContextoFt, type SdsForm } from "./documentos/SdsSeccion";
import DocumentosCatalogoTab, { type ProductoDocumentacion } from "./documentos/DocumentosCatalogoTab";
import {
  PARAMETROS_COA_FALLBACK,
  parseParamRows,
  rowsToParamString,
  separarParametrosPegados,
  type ParamRow,
} from "../lib/coaParametros";
import { formatearFormulaMolecular } from "../lib/formulaMolecular";
import {
  GRADOS_SUGERIDOS,
  TIPOS_INSUMO,
  alternarGrado,
  casillasPorClasificacion,
  esTipoInsumo,
  gradoIncluye,
  type TipoInsumo,
} from "../lib/clasificacionInsumo";
import { esperarJobScan } from "../lib/scanJobPoll";
import { Icon, type UiIconName } from "../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";


interface ArchivoGenerado {
  nombre: string;
  tipo: "pdf" | "docx";
  tamano: number;
  fecha: number;
  /** "ft" = ficha simple; "completo" = FT+COA+SDS */
  categoria?: "ft" | "completo";
}

function fmt_bytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmt_fecha(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("es-CO", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

interface BibliotecaDatosResult {
  tipo: "ft" | "coa" | "sds" | "completo";
  titulo: string;
  datos: Record<string, unknown>;
  yaml: string;
  tiene_datos: boolean;
}

/** Primer tramo del «detalle» del taller («vacía · unido por SKU» → «vacía»). */
function estadoDoc(detalle?: string): string {
  return (detalle || "").split(" · ")[0].trim();
}

const ESTADO_DOC_TONO: Record<string, string> = {
  ok: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  aviso: "border-accent-sun/60 bg-accent-sun/15 text-ink",
  falta: "border-accent-rose/50 bg-accent-rose/10 text-accent-rose",
};

/**
 * Llegada desde el taller de combos: una sola tarjeta dice de qué producto se trata, qué documento
 * es, qué le falta y cuál es el siguiente paso. Antes se aterrizaba en la biblioteca de PDF con el
 * escáner de COA encima y un buscador que no encontraba nada (un documento sin PDF no aparece ahí).
 *
 * - Con documento encontrado: se abre solo en el editor (una vez por documento) y la tarjeta lista
 *   los pendientes que dejó quien lo redactó (`_vacio_pendientes` del YAML).
 * - Sin documento: dos salidas lado a lado — enlazar uno que ya existe o empezar desde cero.
 */
function DocDelCombo({ onAbrir, editando, onVolver }: {
  onAbrir: (datos: Record<string, unknown>) => void;
  editando: boolean;
  /** Dentro de la ventana del taller: cerrar la ventana en vez de navegar al taller. */
  onVolver?: () => void;
}) {
  const retorno = useAppStore((st) => st.tallerRetorno);
  const volverAlTaller = useAppStore((st) => st.volverAlTaller);
  const volver = onVolver ?? volverAlTaller;
  const setTab = useAppStore((st) => st.setDocsTab);
  const [archivoElegido, setArchivoElegido] = useState<string | null>(null);
  const [elegir, setElegir] = useState(false);
  const [verPendientes, setVerPendientes] = useState(true);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const abiertoRef = useRef<string | null>(null);

  const archivo = archivoElegido || retorno?.doc?.archivo || "";
  const slug = archivo.replace(/\.ya?ml$/i, "");
  const docQ = useQuery({
    queryKey: ["fichas-datos-slug", slug],
    queryFn: () => api.get<{ archivo: string; datos: Record<string, unknown> }>(`/api/fichas/datos/${encodeURIComponent(slug)}`),
    enabled: Boolean(slug),
    staleTime: 30_000,
  });

  // Abre el documento en el editor apenas llega, una sola vez por documento.
  useEffect(() => {
    if (!docQ.data || abiertoRef.current === slug) return;
    abiertoRef.current = slug;
    onAbrir(docQ.data.datos);
  }, [docQ.data, slug, onAbrir]);

  if (!retorno) return null;
  const mps = retorno.mps ?? [];
  const datos = docQ.data?.datos;
  const titulo = String(datos?.titulo || datos?.nombre_producto || retorno.doc?.titulo || "");
  const estado = archivoElegido ? "" : estadoDoc(retorno.doc?.detalle);
  const tono = retorno.doc?.estado ?? (archivo ? "aviso" : "falta");
  const pendientes = Array.isArray(datos?._vacio_pendientes) ? (datos!._vacio_pendientes as unknown[]).map(String) : [];
  const motivo = String(datos?._vacio_motivo || "");

  const desdeCero = () => {
    const mp = mps[0];
    // El nombre del combo sin su presentación («ALMENDRA NATURAL 250g» → «ALMENDRA NATURAL»); el de la
    // materia prima trae el empaque de compra («…AMERICANA CAJA 22.68 KG»).
    const nombre = retorno.nombre.replace(/\s+\d+([.,]\d+)?\s*(g|gr|kg|ml|l|un|und)$/i, "").trim().toUpperCase();
    abiertoRef.current = "__nuevo__";
    setNuevoAbierto(true);
    onAbrir({ titulo: nombre, nombre_producto: nombre, referencia: mp?.codigo || "" });
  };

  return (
    <section className="rounded-xl border border-accent/50 bg-surface-panel p-3 shadow-paper-sm" aria-label="Documento del combo">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-wide text-muted">Desde el taller de combos</p>
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
          {retorno.nombre} <code className="font-normal text-muted">{retorno.ref}</code>
        </p>
        <button type="button" onClick={volver} className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-accent">
          ← Volver al combo
        </button>
      </div>

      {archivo ? (
        <div className="mt-2 border-t border-border/70 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Ico e="📄" />
            <span className="text-[14px] font-bold text-ink">{titulo || archivo}</span>
            {estado && <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase ${ESTADO_DOC_TONO[tono] ?? ""}`}>{estado}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {docQ.isLoading && <span className="text-[12px] text-muted">Abriendo…</span>}
              {docQ.isError && <span className="text-[12px] text-accent-rose">No se pudo leer el documento ({archivo}).</span>}
              {datos && (editando ? (
                <span className="text-[12px] font-semibold text-accent">✓ Abierto en el editor, abajo</span>
              ) : (
                <button type="button" onClick={() => { onAbrir(datos); setTab("completo"); }} className="rounded-md border border-accent bg-accent px-3 py-1 text-[12px] font-bold text-white hover:opacity-90">
                  Abrir en el editor
                </button>
              ))}
              {mps.length > 0 && !elegir && (
                <button type="button" onClick={() => setElegir(true)} className="text-[11.5px] text-muted underline decoration-dotted hover:text-ink">
                  ¿No es este documento?
                </button>
              )}
            </span>
          </div>

          {(pendientes.length > 0 || motivo) && (
            <div className="mt-2 rounded-lg border border-accent-sun/50 bg-accent-sun/10 px-3 py-2">
              <button type="button" onClick={() => setVerPendientes((v) => !v)} className="flex w-full items-center justify-between text-left text-[12px] font-bold text-ink">
                <span>Lo que le falta para quedar listo{pendientes.length ? ` (${pendientes.length})` : ""}</span>
                <span className="text-muted">{verPendientes ? "▲" : "▼"}</span>
              </button>
              {verPendientes && (
                <ol className="mt-1.5 max-h-36 list-decimal space-y-1 overflow-y-auto pl-5 pr-1 text-[12px] leading-snug text-ink">
                  {(pendientes.length ? pendientes : [motivo]).map((t, k) => <li key={k}>{t}</li>)}
                </ol>
              )}
            </div>
          )}
          {datos && !pendientes.length && !motivo && (
            <p className="mt-1.5 text-[12px] text-muted">
              Revisa las tres secciones del editor (Ficha técnica → COA → SDS), guarda y genera el documento. Luego vuelve al combo.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 grid gap-3 border-t border-border/70 pt-2 md:grid-cols-2">
          <div>
            <p className="text-[12.5px] font-bold text-ink">1 · ¿Ya existe el documento?</p>
            <p className="mb-2 text-[11.5px] text-muted">Búscalo y asócialo: todas las presentaciones de la materia prima lo heredan.</p>
            <EnlazarDocumento
              mps={mps}
              inicial={mps[0]?.nombre.split(" ").slice(0, 2).join(" ") ?? ""}
              etiquetaBoton="Asociar y abrir"
              onHecho={(r) => { setArchivoElegido(r.archivo); setTab("completo"); }}
            />
          </div>
          <div className="md:border-l md:border-border/70 md:pl-3">
            <p className="text-[12.5px] font-bold text-ink">2 · ¿No existe?</p>
            <p className="mb-2 text-[11.5px] text-muted">
              Empieza uno nuevo con el nombre y el SKU de la materia prima ya puestos{mps[0] ? <> (<code>{mps[0].codigo}</code>)</> : null}.
            </p>
            <button type="button" onClick={desdeCero} className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90">
              Empezar desde cero
            </button>
            {nuevoAbierto && editando && (
              <p className="mt-2 text-[12px] font-semibold text-accent">✓ Documento nuevo abierto abajo. Al guardarlo queda unido a <code>{mps[0]?.codigo}</code>.</p>
            )}
          </div>
        </div>
      )}

      {archivo && elegir && (
        <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
          <EnlazarDocumento
            mps={mps}
            inicial={mps[0]?.nombre.split(" ").slice(0, 2).join(" ") ?? ""}
            etiquetaBoton="Usar este"
            onCancelar={() => setElegir(false)}
            onHecho={(r) => { setElegir(false); setArchivoElegido(r.archivo); setTab("completo"); }}
          />
        </div>
      )}
    </section>
  );
}

function BibliotecaTab({ onEditar }: { onEditar: (r: BibliotecaDatosResult) => void }) {
  const [busqueda, setBusqueda] = useState("");
  // Llegada desde el taller de combos: la biblioteca abre buscando el documento de ese producto.
  const tallerSalto = useAppStore((st) => st.tallerSalto);
  const consumirTallerSalto = useAppStore((st) => st.consumirTallerSalto);
  useEffect(() => {
    if (!tallerSalto || tallerSalto.panel !== "fichas") return;
    if (tallerSalto.buscar) setBusqueda(tallerSalto.buscar);
    consumirTallerSalto();
  }, [tallerSalto, consumirTallerSalto]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNombre, setPreviewNombre] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editandoNombre, setEditandoNombre] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const generarLotesMut = useMutation({
    mutationFn: () =>
      api.post<{
        ok: boolean;
        creados: Array<{ ref: string; nombre: string; lote_numero: string; codigo_verificacion: string }>;
        omitidos: Array<{ ref?: string; archivo: string; motivo: string }>;
      }>("/api/lotes/generar-faltantes", {}, { timeoutMs: 60000 }),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["fichas-biblioteca"],
    queryFn: () => api.get<{ archivos: ArchivoGenerado[] }>("/api/fichas/biblioteca"),
  });

  const getToken = async () => {
    const { useTicketsAuth } = await import("../stores/ticketsAuth");
    const { useAuthStore } = await import("../stores/auth");
    const t = useTicketsAuth.getState();
    return t.apiToken || t.token || useAuthStore.getState().token || "";
  };

  const getUrl = async (path: string, method = "GET") => {
    const { resolvePanelApiUrl } = await import("../api/client");
    return resolvePanelApiUrl(path, method);
  };

  const descargar = async (nombre: string, inline = false) => {
    const token = await getToken();
    const url = await getUrl(`/api/fichas/biblioteca/descargar?archivo=${encodeURIComponent(nombre)}${inline ? "&inline=1" : ""}`);
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    if (inline) {
      setPreviewNombre(nombre);
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const eliminar = async (nombre: string) => {
    setDeleting(nombre);
    setDeleteError(null);
    try {
      const token = await getToken();
      const url = await getUrl(`/api/fichas/biblioteca/eliminar?archivo=${encodeURIComponent(nombre)}`, "DELETE");
      let res = await fetch(url, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res.status === 405) {
        const alt = url.includes("/app/api/") ? url.replace("/app/api/", "/api/") : url.replace("/api/", "/app/api/");
        res = await fetch(alt, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error || `HTTP ${res.status}`));
      }
      void refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  };

  const editar = async (nombre: string) => {
    setEditandoNombre(nombre);
    setEditError(null);
    try {
      const r = await api.get<BibliotecaDatosResult>(`/api/fichas/biblioteca/datos?archivo=${encodeURIComponent(nombre)}`);
      onEditar(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Error cargando datos para editar:", err);
      setEditError(msg);
    } finally {
      setEditandoNombre(null);
    }
  };

  const archivos = (data?.archivos ?? [])
    .filter((a) => {
      if (a.tipo !== "pdf") return false;
      const q = busqueda.toLowerCase();
      if (q && !a.nombre.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.fecha - a.fecha || a.nombre.localeCompare(b.nombre, "es"));

  return (
    <div className="space-y-4">
      {/* La biblioteca es la lista de PDF generados. Escanear un COA y publicar en la web son tareas
          ocasionales: una fila compacta (el escáner plegado) en vez de media pantalla sobre la lista. */}
      <div className="grid gap-2 md:grid-cols-2">
        <details className="group rounded-xl border border-border bg-surface-panel open:md:col-span-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5">
            <span>
              <span className="block text-sm font-semibold text-ink"><Ico e="📷" /> Escanear el COA de un proveedor</span>
              <span className="block text-xs text-muted">Fotos o PDF → la IA llena el documento</span>
            </span>
            <span className="text-muted group-open:rotate-180">▼</span>
          </summary>
          <div className="border-t border-border px-2 pb-2 pt-2">
            <CoaDocumentosScanner archivos={data?.archivos ?? []} onEditar={onEditar} />
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-panel px-4 py-2.5">
          <span>
            <span className="block text-sm font-semibold text-ink">Publicar en la página web</span>
            <span className="block text-xs text-muted">Solo documentos completos (FT + COA + SDS)</span>
          </span>
          <CargarDocumentosWebButton />
        </div>
      </div>

      {deleteError && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">Error al eliminar: {deleteError}</p>
      )}
      {editError && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">Error al cargar para editar: {editError}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar documento…"
          className="flex-1 min-w-[180px] rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-ink"
        >
          ↻ Actualizar
        </button>
        <span className="text-xs text-muted">{archivos.length} documento{archivos.length !== 1 ? "s" : ""}</span>
        <button
          type="button"
          onClick={() => generarLotesMut.mutate()}
          disabled={generarLotesMut.isPending}
          title="Registra un lote autogenerado (4 letras + consecutivo) para cada ficha técnica guardada que aún no tenga uno"
          className="ml-auto rounded-lg border border-accent/50 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {generarLotesMut.isPending ? "Generando…" : ico("🔢 Generar lotes faltantes")}
        </button>
      </div>

      {generarLotesMut.isSuccess && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
          <p className="font-semibold">
            {generarLotesMut.data.creados.length} lote(s) nuevo(s) registrado(s)
            {generarLotesMut.data.omitidos.length > 0 && ` · ${generarLotesMut.data.omitidos.length} omitido(s)`}
          </p>
          {generarLotesMut.data.creados.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {generarLotesMut.data.creados.map((c) => (
                <li key={c.ref}>
                  <strong>{c.ref}</strong> — {c.nombre}: lote <code>{c.lote_numero}</code>, código{" "}
                  <code>{c.codigo_verificacion}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {generarLotesMut.isError && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {(generarLotesMut.error as Error).message}
        </p>
      )}

      {isLoading && <p className="text-sm text-muted">Cargando biblioteca…</p>}
      {error && <p className="text-sm text-danger">Error al cargar: {(error as Error).message}</p>}

      {!isLoading && archivos.length === 0 && (
        <p className="text-sm text-muted">No hay documentos que coincidan.</p>
      )}

      <div className="max-h-[min(70vh,800px)] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface-panel shadow-[0_1px_0_0_var(--color-border,rgba(0,0,0,0.08))] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-panel">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted uppercase tracking-wide">Documento</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted uppercase tracking-wide w-16">Tipo</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase tracking-wide w-20">Tamaño</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase tracking-wide w-28" title="Ordenado: más reciente primero">
                Fecha ↓
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase tracking-wide w-28">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {archivos.map((a, i) => {
              const isDeleting = deleting === a.nombre;
              const isConfirm = confirmDelete === a.nombre;
              const isEditing = editandoNombre === a.nombre;
              return (
                <tr key={a.nombre} className={`border-b border-border/50 transition-colors hover:bg-surface-panel ${i % 2 === 0 ? "" : "bg-surface/30"}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{a.nombre.replace(/\.(pdf|docx)$/i, "")}</span>
                      {a.categoria === "ft" && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-accent/15 text-accent">FT</span>
                      )}
                      {a.categoria === "completo" && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-800">Completo</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${a.tipo === "pdf" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                      {a.tipo}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted">{fmt_bytes(a.tamano)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted">{fmt_fecha(a.fecha)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {isConfirm ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-[10px] text-muted mr-1">¿Eliminar?</span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void eliminar(a.nombre)}
                          className="rounded bg-danger px-2 py-1 text-[10px] font-bold text-white hover:opacity-80 disabled:opacity-40"
                        >
                          {isDeleting ? "…" : "Sí"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-ink"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {a.tipo === "pdf" && (
                          <button
                            type="button"
                            onClick={() => void descargar(a.nombre, true)}
                            className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent"
                          >
                            Ver
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void descargar(a.nombre)}
                          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-accent"
                          title="Descargar"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={isEditing}
                          onClick={() => void editar(a.nombre)}
                          className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
                          title="Abrir en editor para modificar"
                        >
                          {isEditing ? "…" : "Editar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setConfirmDelete(a.nombre); setDeleteError(null); }}
                          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:border-danger hover:text-danger"
                          title="Eliminar archivo"
                        >
                          <Ico e="🗑" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal visor PDF */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-panel px-4 py-2.5 shadow">
            <h4 className="max-w-xs truncate text-sm font-semibold text-ink">{previewNombre}</h4>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void descargar(previewNombre)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
              >
                ↓ Descargar
              </button>
              <button
                type="button"
                onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-danger hover:text-danger"
              >
                ✕ Cerrar
              </button>
            </div>
          </div>
          <iframe
            title="Vista previa PDF"
            src={`${previewUrl}#toolbar=1&navpanes=0`}
            className="flex-1 w-full border-0 bg-white mck-paper-white"
          />
        </div>
      )}
    </div>
  );
}

function FichaTecnicaTabContent({
  producto,
  preload,
}: {
  producto: ProductoDocumentacion | null;
  preload: Record<string, unknown> | null;
}) {
  const buildRef = useRef<() => Record<string, unknown>>(() => ({}));
  const loadRef = useRef<(datos: Record<string, unknown>) => void>(() => {});
  const [ultimoGenerado, setUltimoGenerado] = useState<GenerarDocResult | null>(null);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    loadRef.current(datos);
  }, []);

  const buildDatos = useCallback(() => buildRef.current(), []);

  // Carga datos de preload cuando llegan desde la biblioteca
  useEffect(() => {
    if (preload) loadDatos(preload);
  }, [preload, loadDatos]);

  const registrarLoteMut = useMutation({
    mutationFn: () => {
      const datos = buildRef.current();
      const referencia = String(datos.referencia || producto?.ref || "").trim();
      // Si el campo «Lote» quedó vacío, el backend genera uno legible solo
      // (4 letras del producto + consecutivo, ej. CITR-001).
      const loteNumero = String(datos.lote || "").trim();
      if (!referencia) throw new Error("Falta la referencia/SKU del producto");
      return api.post<{ ok: boolean; lote: { estado: string; codigo_verificacion: string; lote_numero: string } }>(
        `/api/lotes/${encodeURIComponent(referencia)}`,
        {
          lote_numero: loteNumero,
          fabricante: String(datos.fabricante || ""),
          pais_origen: String(datos.pais_origen || ""),
          nombre_producto: String(datos.nombre_producto || datos.titulo || ""),
          ft_link: ultimoGenerado?.drive_uploads?.find((u) => u.tipo === "pdf")?.webViewLink ?? "",
        },
      );
    },
  });

  return (
    <Fragment>
    <DocumentoGeneradorTab
      apiPrefix="/api/fichas"
      queryKey="fichas"
      tituloSeccion="Ficha técnica (TDS)"
      descripcion="Complete los campos y genere el PDF."
      botonGenerar="Generar PDF"
      carpetaDriveLabel="TDS"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      showWordPdfFolders={false}
      showDrive={false}
      showYamlMode={false}
      showGuardarYaml={false}
      showProductoGuardado={false}
      permiteCompletar={false}
      productoRef={producto?.ref ?? ""}
      onGenerado={setUltimoGenerado}
    >
      <FichaTecnicaForm
        productoRef={producto?.ref}
        productoNombre={producto?.nombre_base}
        onBuildDatos={(fn) => {
          buildRef.current = fn;
        }}
        onLoadDatos={(fn) => {
          loadRef.current = fn;
        }}
      />
    </DocumentoGeneradorTab>
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
      <p className="text-xs text-muted">
        Al generar la ficha con referencia y lote, se registra automáticamente en el historial de
        trazabilidad y queda disponible en Imprimir etiquetas. Usa este botón solo para vincular una
        ficha ya existente. Si dejas vacío el campo «Lote», no se registra automáticamente.
      </p>
      <button
        type="button"
        onClick={() => registrarLoteMut.mutate()}
        disabled={registrarLoteMut.isPending}
        className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {registrarLoteMut.isPending ? "Registrando…" : "Registrar este lote en el historial"}
      </button>
      {registrarLoteMut.isSuccess && (
        <p className="text-xs text-emerald-600">
          Lote <strong>{registrarLoteMut.data.lote.lote_numero}</strong> registrado (estado «
          {registrarLoteMut.data.lote.estado}»). Código para la etiqueta:{" "}
          <strong className="font-mono text-sm">{registrarLoteMut.data.lote.codigo_verificacion}</strong>
        </p>
      )}
      {registrarLoteMut.isError && (
        <p className="text-xs text-danger">{(registrarLoteMut.error as Error).message}</p>
      )}
    </div>
    </Fragment>
  );
}

function CoaTabContent({
  producto,
  preload,
}: {
  producto: ProductoDocumentacion | null;
  preload: Record<string, unknown> | null;
}) {
  const [titulo, setTitulo] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [referencia, setReferencia] = useState("");
  const [inci, setInci] = useState("");
  const [cas, setCas] = useState("");
  const [formula, setFormula] = useState("");
  const [einces, setEinces] = useState("");
  const [concentracion, setConcentracion] = useState("");
  const [grado, setGrado] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [incluye, setIncluye] = useState("");
  const [loteNum, setLoteNum] = useState("");
  const [fab, setFab] = useState("");
  const [venc, setVenc] = useState("");
  const [vidaUtil, setVidaUtil] = useState("");
  const [tamanoLote, setTamanoLote] = useState("");
  const [pais, setPais] = useState("");
  const [fabricante, setFabricante] = useState("");
  const [fechaAnalisis, setFechaAnalisis] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [parametros, setParametros] = useState("");
  const [empaque, setEmpaque] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [precauciones, setPrecauciones] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [firmaNombre, setFirmaNombre] = useState("");
  const [firmaCargo, setFirmaCargo] = useState("");
  const [firmaOrganizacion, setFirmaOrganizacion] = useState("");
  const [firmaImagenB64, setFirmaImagenB64] = useState("");
  const [codigoVerif, setCodigoVerif] = useState("");
  const [ultimoGenerado, setUltimoGenerado] = useState<GenerarDocResult | null>(null);

  useEffect(() => {
    if (!producto) return;
    setTitulo(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref, producto?.nombre, producto?.nombre_base]);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    const ident = (datos.identificacion || {}) as Record<string, string>;
    const lote = (datos.lote || {}) as Record<string, string>;
    const emp = (datos.empaque || {}) as Record<string, string>;
    const firma = (datos.firma || {}) as Record<string, string>;
    setTitulo(String(datos.titulo || ""));
    setNombreComercial(String(ident.nombre_comercial || ""));
    setReferencia(String(ident.referencia_interna || ""));
    setInci(String(ident.nombre_inci || ""));
    setCas(String(ident.cas || ""));
    setFormula(formatearFormulaMolecular(String(ident.formula_molecular || "")));
    setEinces(String(ident.einces || ""));
    setConcentracion(String(ident.concentracion || ""));
    setGrado(String(ident.grado || ""));
    setPresentacion(String(ident.presentacion || ""));
    setIncluye(String(ident.incluye || ""));
    setLoteNum(String(lote.numero || ""));
    setFab(String(lote.fecha_fabricacion || ""));
    setVenc(String(lote.fecha_vencimiento || ""));
    setVidaUtil(String(lote.vida_util || ""));
    setTamanoLote(String(lote.tamano_lote || ""));
    setPais(String(lote.pais_origen || ""));
    setFabricante(String(lote.fabricante || ""));
    setFechaAnalisis(String(lote.fecha_analisis || ""));
    setFechaEmision(String(lote.fecha_emision || ""));
    setParametros(textoDesdeFilasTres(datos.parametros));
    setEmpaque(String(emp.empaque_original || ""));
    setAlmacenamiento(String(emp.almacenamiento || ""));
    setPrecauciones(String(emp.precauciones || ""));
    setObservaciones(String(emp.observaciones || ""));
    setFirmaNombre(String(firma.nombre || ""));
    setFirmaCargo(String(firma.cargo || ""));
    setFirmaOrganizacion(String(firma.organizacion || ""));
    setFirmaImagenB64(String(firma.imagen_b64 || ""));
    setCodigoVerif(String(datos.codigo_verificacion || ""));
  }, []);

  useEffect(() => {
    if (preload) loadDatos(preload);
  }, [preload, loadDatos]);

  const buildDatos = useCallback(
    () => ({
      titulo,
      identificacion: {
        nombre_comercial: titulo || nombreComercial,
        referencia_interna: referencia,
        nombre_inci: inci,
        cas,
        formula_molecular: formula,
        einces,
        concentracion,
        grado,
        presentacion,
        incluye,
      },
      lote: {
        numero: loteNum,
        fecha_fabricacion: fab,
        fecha_vencimiento: venc,
        vida_util: vidaUtil,
        tamano_lote: tamanoLote,
        pais_origen: pais,
        fabricante,
        fecha_analisis: fechaAnalisis,
        fecha_emision: fechaEmision,
      },
      parametros: filasTresDesdeTexto(parametros),
      empaque: {
        empaque_original: empaque,
        almacenamiento,
        precauciones,
        observaciones,
      },
      firma: {
        nombre: firmaNombre,
        cargo: firmaCargo,
        organizacion: firmaOrganizacion,
        imagen_b64: firmaImagenB64,
      },
      codigo_verificacion: codigoVerif,
    }),
    [
      titulo, nombreComercial, referencia, inci, cas, formula, einces, concentracion, grado,
      presentacion, incluye, loteNum, fab, venc, vidaUtil, tamanoLote, pais, fabricante, fechaAnalisis,
      fechaEmision, parametros, empaque, almacenamiento, precauciones, observaciones,
      firmaNombre, firmaCargo, firmaOrganizacion, firmaImagenB64, codigoVerif,
    ],
  );

  const sugerirParamsCoaMut = useMutation({
    mutationFn: async () => {
      const n = (titulo || nombreComercial || producto?.nombre_base || "").trim();
      if (!n) throw new Error("Indique el nombre del producto primero");
      try {
        const r = await api.post<{ valor?: string }>("/api/fichas/sugerir-campo", {
          campo: "coa_parametros",
          nombre: n,
        }, { timeoutMs: 180000 });
        const filas = (r.valor || "").trim();
        if (parseParamRows(filas).some((row) => row.parametro)) return filas;
      } catch {
        /* plantilla local si el API falla o el proceso aún no tiene el campo */
      }
      return PARAMETROS_COA_FALLBACK;
    },
    onSuccess: (filas) => {
      setParametros(filas);
    },
  });

  return (
    <Fragment>
    <DocumentoGeneradorTab
      apiPrefix="/api/coa"
      queryKey="coa"
      tituloSeccion="Certificado de análisis (COA)"
      descripcion="Genera el COA desde la plantilla McKenna y súbelo a la carpeta COA en Drive."
      botonGenerar="Generar COA"
      carpetaDriveLabel="COA"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      productoRef={producto?.ref ?? ""}
      onGenerado={setUltimoGenerado}
    >
      <div className="space-y-4">
        <Field value={titulo} onChange={setTitulo} placeholder="Título del producto" />
        <p className="text-xs font-medium text-muted">Identificación</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} formula />
          <Field label="EINECS" value={einces} onChange={setEinces} />
          <Field label="Pureza" value={concentracion} onChange={setConcentracion}
            placeholder="Ej. ≥ 99 %, 98.5 ~ 101.0 %" />
          <Field label="Presentación" value={presentacion} onChange={setPresentacion} />
          <Field label="Incluye" value={incluye} onChange={setIncluye} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Grado</p>
          <div className="flex flex-wrap gap-1.5">
            {["Cosmético", "Alimentos", "Industrial", "Grasas y Ceras", "Agro"].map((g) => (
              <button key={g} type="button"
                onClick={() => setGrado(grado === g ? "" : g)}
                className={`rounded-full px-3 py-0.5 text-[11px] font-medium border transition-colors ${grado === g ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/60 hover:text-accent"}`}
              >{g}</button>
            ))}
          </div>
          <Field value={grado} onChange={setGrado} placeholder="O escribe un grado personalizado…" />
        </div>
        <p className="text-xs font-medium text-muted">Lote</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="No. de lote" value={loteNum} onChange={setLoteNum} />
          <Field label="Fecha fabricación" value={fab} onChange={setFab} placeholder="DD / MM / AAAA" />
          <Field label="Fecha vencimiento" value={venc} onChange={setVenc} />
          <Field label="Vida útil" value={vidaUtil} onChange={setVidaUtil} />
          <Field label="Tamaño del lote" value={tamanoLote} onChange={setTamanoLote} />
          <Field label="País de origen" value={pais} onChange={setPais} />
          <Field label="Fabricante original" value={fabricante} onChange={setFabricante} placeholder="Nombre del fabricante o proveedor" />
          <Field label="Fecha análisis" value={fechaAnalisis} onChange={setFechaAnalisis} />
          <Field label="Fecha emisión COA" value={fechaEmision} onChange={setFechaEmision} />
        </div>
        <Field
          label="Parámetros (parámetro|especificación|resultado por línea)"
          value={parametros}
          onChange={setParametros}
          rows={8}
          mono
          actions={
            !parseParamRows(parametros).some((r) => r.parametro || r.especificacion || r.resultado) ? (
              <IaBtn
                label="Sugerir"
                loading={sugerirParamsCoaMut.isPending}
                onClick={() => sugerirParamsCoaMut.mutate()}
              />
            ) : undefined
          }
        />
        {sugerirParamsCoaMut.isError && (
          <p className="text-xs text-danger">{(sugerirParamsCoaMut.error as Error).message}</p>
        )}
        <p className="text-xs font-medium text-muted">Empaque y almacenamiento</p>
        <Field label="Empaque original" value={empaque} onChange={setEmpaque} rows={2} />
        <Field label="Almacenamiento" value={almacenamiento} onChange={setAlmacenamiento} rows={2} />
        <Field label="Precauciones" value={precauciones} onChange={setPrecauciones} rows={2} />
        <Field label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
        <p className="text-xs font-medium text-muted">Datos de la firma</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Nombre del firmante" value={firmaNombre} onChange={setFirmaNombre} />
          <Field label="Cargo del firmante" value={firmaCargo} onChange={setFirmaCargo} />
          <Field label="Organización / laboratorio" value={firmaOrganizacion} onChange={setFirmaOrganizacion} />
        </div>
        <FirmaPegable
          value={firmaImagenB64}
          onChange={setFirmaImagenB64}
          firmante={{ nombre: firmaNombre, cargo: firmaCargo, organizacion: firmaOrganizacion }}
          onDatosFirmante={(d) => {
            setFirmaNombre(d.nombre);
            setFirmaCargo(d.cargo);
            setFirmaOrganizacion(d.organizacion);
          }}
        />
        <Field
          label="Código de verificación (dejar vacío = se genera al registrar el lote)"
          value={codigoVerif}
          onChange={setCodigoVerif}
        />
      </div>
    </DocumentoGeneradorTab>
    <RegistrarLoteBoton
      referencia={referencia}
      loteNumero={loteNum}
      fabricante={fabricante}
      paisOrigen={pais}
      fechaFabricacion={fab}
      fechaVencimiento={venc}
      codigoVerificacion={codigoVerif}
      nombreProducto={nombreComercial || titulo}
      coaLink={ultimoGenerado?.drive_uploads?.find((u) => u.tipo === "pdf")?.webViewLink ?? ""}
      onCodigoAsignado={setCodigoVerif}
      onLoteAsignado={setLoteNum}
    />
    </Fragment>
  );
}

function RegistrarLoteBoton({
  referencia,
  loteNumero,
  fabricante,
  paisOrigen,
  fechaFabricacion,
  fechaVencimiento,
  codigoVerificacion,
  nombreProducto,
  coaLink,
  onCodigoAsignado,
  onLoteAsignado,
}: {
  referencia: string;
  loteNumero: string;
  fabricante: string;
  paisOrigen: string;
  fechaFabricacion: string;
  fechaVencimiento: string;
  codigoVerificacion: string;
  nombreProducto: string;
  coaLink: string;
  onCodigoAsignado: (codigo: string) => void;
  onLoteAsignado?: (lote: string) => void;
}) {
  const registrarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; lote: { estado: string; codigo_verificacion: string; lote_numero: string } }>(
        `/api/lotes/${encodeURIComponent(referencia)}`,
        {
          lote_numero: loteNumero,
          fabricante,
          pais_origen: paisOrigen,
          fecha_fabricacion: fechaFabricacion,
          fecha_vencimiento: fechaVencimiento,
          codigo_verificacion: codigoVerificacion,
          nombre_producto: nombreProducto,
          coa_link: coaLink,
        },
      ),
    onSuccess: (r) => {
      onCodigoAsignado(r.lote.codigo_verificacion);
      if (!loteNumero) onLoteAsignado?.(r.lote.lote_numero);
    },
  });

  if (!referencia) return null;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2">
      <p className="text-xs text-muted">
        Al generar el COA con número de lote, se vincula automáticamente al historial de{" "}
        <code>{referencia}</code> y a Imprimir etiquetas. Usa este botón solo para vincular un COA ya
        existente o corregir el registro. Se genera además un código único para que el cliente lo consulte
        en <code>mckennagroup.co/verificar</code>.
      </p>
      <button
        type="button"
        onClick={() => registrarMut.mutate()}
        disabled={registrarMut.isPending}
        className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {registrarMut.isPending ? "Registrando…" : "Registrar este lote en el historial"}
      </button>
      {registrarMut.isSuccess && (
        <p className="text-xs text-emerald-600">
          Lote <strong>{registrarMut.data.lote.lote_numero}</strong> registrado (estado «
          {registrarMut.data.lote.estado}»). Código para la etiqueta:{" "}
          <strong className="font-mono text-sm">{registrarMut.data.lote.codigo_verificacion}</strong>
        </p>
      )}
      {registrarMut.isError && (
        <p className="text-xs text-danger">{(registrarMut.error as Error).message}</p>
      )}
    </div>
  );
}

function SdsTabContent({
  producto,
  preload,
}: {
  producto: ProductoDocumentacion | null;
  preload: Record<string, unknown> | null;
}) {
  const [titulo, setTitulo] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [referencia, setReferencia] = useState("");
  const [inci, setInci] = useState("");
  const [cas, setCas] = useState("");
  const [formula, setFormula] = useState("");
  const [usos, setUsos] = useState("");
  const [telefono, setTelefono] = useState("");
  const [clasificacion, setClasificacion] = useState("");
  const [pictogramas, setPictogramas] = useState("");
  const [composicion, setComposicion] = useState("");
  const [primerosAuxilios, setPrimerosAuxilios] = useState("");
  const [manipulacion, setManipulacion] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [propiedades, setPropiedades] = useState("");
  const [normativa, setNormativa] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    if (!producto) return;
    setTitulo(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref, producto?.nombre, producto?.nombre_base]);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    const ident = (datos.identificacion || {}) as Record<string, string>;
    const pel = (datos.peligros || {}) as Record<string, string>;
    const man = (datos.manipulacion || {}) as Record<string, string>;
    const reg = (datos.regulatorio || {}) as Record<string, string>;
    setTitulo(String(datos.titulo || ""));
    setNombreComercial(String(ident.nombre_comercial || ""));
    setReferencia(String(ident.referencia_interna || ""));
    setInci(String(ident.nombre_inci || ""));
    setCas(String(ident.cas || ""));
    setFormula(formatearFormulaMolecular(String(ident.formula_molecular || "")));
    setUsos(String(ident.usos || ""));
    setTelefono(String(ident.telefono_emergencia || ""));
    setClasificacion(String(pel.clasificacion || ""));
    setPictogramas(String(pel.pictogramas || ""));
    setComposicion(textoDesdeFilasTres(datos.composicion));
    setPrimerosAuxilios(textoDesdeFilas(datos.primeros_auxilios));
    setManipulacion(String(man.manipulacion || ""));
    setAlmacenamiento(String(man.almacenamiento || ""));
    setPropiedades(textoDesdeFilas(datos.propiedades));
    setNormativa(String(reg.normativa || ""));
    setObservaciones(String(reg.observaciones || ""));
  }, []);

  useEffect(() => {
    if (preload) loadDatos(preload);
  }, [preload, loadDatos]);

  const buildDatos = useCallback(
    () => ({
      titulo,
      identificacion: {
        nombre_comercial: titulo || nombreComercial,
        referencia_interna: referencia,
        nombre_inci: inci,
        cas,
        formula_molecular: formula,
        usos,
        telefono_emergencia: telefono,
      },
      peligros: { clasificacion, pictogramas },
      composicion: filasTresDesdeTexto(composicion),
      primeros_auxilios: filasDesdeTexto(primerosAuxilios),
      manipulacion: { manipulacion, almacenamiento },
      propiedades: filasDesdeTexto(propiedades),
      regulatorio: { normativa, observaciones },
    }),
    [
      titulo, nombreComercial, referencia, inci, cas, formula, usos, telefono,
      clasificacion, pictogramas, composicion, primerosAuxilios, manipulacion,
      almacenamiento, propiedades, normativa, observaciones,
    ],
  );

  return (
    <DocumentoGeneradorTab
      apiPrefix="/api/sds"
      queryKey="sds"
      tituloSeccion="Hoja de datos de seguridad (SDS)"
      descripcion="Formato GHS estilo Ventós (referencia SDS ELEMI). Genera DOCX/PDF y súbelo a Drive. Use «Completar con literatura» para rellenar campos faltantes desde PubMed/PubChem."
      botonGenerar="Generar SDS"
      carpetaDriveLabel="SDS"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      productoRef={producto?.ref ?? ""}
    >
      <div className="space-y-4">
        <Field value={titulo} onChange={setTitulo} placeholder="Título del producto" />
        <p className="text-xs font-medium text-muted">Identificación</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} formula />
          <Field label="Usos recomendados" value={usos} onChange={setUsos} />
          <Field label="Teléfono emergencia" value={telefono} onChange={setTelefono} />
        </div>
        <p className="text-xs font-medium text-muted">Peligros</p>
        <Field label="Clasificación GHS" value={clasificacion} onChange={setClasificacion} rows={2} />
        <Field label="Pictogramas / frases H-P" value={pictogramas} onChange={setPictogramas} rows={2} />
        <TablaComposicion value={composicion} onChange={setComposicion} />
        <Field label="Primeros auxilios (caso|instrucción)" value={primerosAuxilios} onChange={setPrimerosAuxilios} rows={4} mono />
        <Field label="Manipulación" value={manipulacion} onChange={setManipulacion} rows={2} />
        <Field label="Almacenamiento" value={almacenamiento} onChange={setAlmacenamiento} rows={2} />
        <Field label="Propiedades (nombre|valor)" value={propiedades} onChange={setPropiedades} rows={6} mono />
        <Field label="Normativa" value={normativa} onChange={setNormativa} rows={2} />
        <Field label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
      </div>
    </DocumentoGeneradorTab>
  );
}

/* ── Separador de sección para el formulario completo ── */
function SeccionBanner({ titulo }: { titulo: string }) {
  return (
    <div className="mt-6 mb-4 flex items-center gap-3 border-b border-border pb-2">
      <span className="text-sm font-bold uppercase tracking-widest text-accent">{titulo}</span>
    </div>
  );
}

/** Traduce fallos de red/proxy a algo accionable; el resto pasa tal cual. */
function mensajeScanLegible(msg: string): string {
  if (/NetworkError|Failed to fetch|Network request failed|Load failed|ECONNREFUSED|connection refused/i.test(msg)) {
    return "No hay conexión con el agente (:8081). Reinicia el servicio y recarga el panel, luego vuelve a adjuntar la imagen.";
  }
  if (/JSON\.parse|unexpected character|Unexpected token|Failed to execute 'json'/i.test(msg)) {
    return "El servidor no devolvió JSON (el agente se reinició, se cayó o el proxy respondió una página de error). Recarga el panel y vuelve a intentar; si sigue, reinicia el agente en :8081.";
  }
  return msg;
}

function FtImageScanner({ onCamposExtraidos }: { onCamposExtraidos: (c: Record<string, unknown>) => void }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ url: string; name: string; isImage: boolean }[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [textoPagina, setTextoPagina] = useState("");
  const [mostrarPegar, setMostrarPegar] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFilesRef = useRef<File[]>([]);
  const scanGenRef = useRef(0);

  const MAX_ARCHIVOS = 8;
  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

  const enviar = async (files: File[]) => {
    if (!files.length) return;
    const gen = ++scanGenRef.current;
    setError(null); setOk(false); setScanning(true);
    setProgreso(files.length > 1 ? `Subiendo ${files.length} archivos…` : "Subiendo archivo…");
    try {
      const fd = new FormData();
      for (const file of files.slice(0, MAX_ARCHIVOS)) {
        fd.append("imagen", file);
      }
      const inicio = await api.upload<{
        ok?: boolean;
        job_id?: string;
        status?: string;
        campos?: Record<string, unknown>;
        error?: string;
        imagenes?: number;
        progreso?: string;
      }>("/api/fichas/ft/escanear-imagen", fd, { timeoutMs: 45000 });
      if (gen !== scanGenRef.current) return;
      if (inicio.error && !inicio.job_id) throw new Error(inicio.error);

      let json = inicio;
      if (inicio.job_id && !inicio.campos) {
        setProgreso(
          inicio.imagenes && inicio.imagenes > 1
            ? `Leyendo ${inicio.imagenes} archivos…`
            : "Leyendo el documento…",
        );
        json = await esperarJobScan(
          (id) => `/api/fichas/ft/escanear-imagen/${encodeURIComponent(id)}`,
          inicio.job_id,
          {
            onProgreso: (msg) => {
              if (gen === scanGenRef.current) setProgreso(msg);
            },
            isStale: () => gen !== scanGenRef.current,
          },
        );
      }
      if (gen !== scanGenRef.current) return;
      if (json.error) throw new Error(json.error);
      const campos = json.campos || {};
      const llenos = Object.entries(campos).filter(
        ([k, v]) => !k.startsWith("_") && v != null && String(v).trim() !== "",
      );
      if (!llenos.length) {
        throw new Error("La extracción no devolvió campos útiles. Pruebe otras imágenes/PDF.");
      }
      onCamposExtraidos(campos);
      setOk(true);
    } catch (e: unknown) {
      if (gen !== scanGenRef.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(mensajeScanLegible(msg));
    } finally {
      if (gen !== scanGenRef.current) return;
      setScanning(false);
      setProgreso(null);
    }
  };

  const enviarUrl = async () => {
    const u = linkUrl.trim();
    const texto = textoPagina.trim();
    if ((!u && !texto) || scanning) return;
    setError(null); setOk(false); setScanning(true);
    try {
      const { api } = await import("../api/client");
      const body: { url?: string; texto?: string } = {};
      if (u) body.url = u;
      if (texto.length >= 40) body.texto = texto;
      const json = await api.post<{ ok?: boolean; campos?: Record<string, unknown>; error?: string }>(
        "/api/fichas/ft/escanear-url",
        body,
        { timeoutMs: 120000 },
      );
      if (json.error) throw new Error(json.error);
      const campos = json.campos || {};
      const llenos = Object.entries(campos).filter(
        ([k, v]) => !k.startsWith("_") && v != null && String(v).trim() !== "",
      );
      if (!llenos.length) {
        throw new Error(
          "La extracción no devolvió campos. Si el sitio bloquea el servidor, pegue el texto de la página abajo.",
        );
      }
      onCamposExtraidos(campos);
      setOk(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(mensajeScanLegible(msg));
      if (/descarga|HTTP|bloque|Cloudflare|conexión|connect|reset/i.test(msg)) {
        setMostrarPegar(true);
      }
    } finally {
      setScanning(false);
    }
  };

  const fromFiles = (incoming: FileList | File[]) => {
    const nuevos = Array.from(incoming).filter(esValido);
    if (!nuevos.length) return;
    const merged: File[] = [...pendingFilesRef.current];
    for (const f of nuevos) {
      if (merged.length >= MAX_ARCHIVOS) break;
      const dup = merged.some(
        (p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified,
      );
      if (!dup) merged.push(f);
    }
    pendingFilesRef.current = merged;
    setOk(false); setError(null);
    setPreviews((prev) => {
      for (const p of prev) {
        if (p.isImage) URL.revokeObjectURL(p.url);
      }
      return merged.map((f) => ({
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
        name: f.name,
        isImage: f.type.startsWith("image/"),
      }));
    });
    void enviar(merged);
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || scanning) return;
      const imgs: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imgs.push(file);
        }
      }
      if (imgs.length) {
        fromFiles(imgs);
        e.preventDefault();
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [scanning]);

  const limpiar = () => {
    for (const p of previews) {
      if (p.isImage && p.url) URL.revokeObjectURL(p.url);
    }
    pendingFilesRef.current = [];
    scanGenRef.current += 1;
    setScanning(false);
    setPreviews([]); setOk(false); setError(null); setProgreso(null);
  };

  return (
    <div
      className="mb-4 rounded-lg border border-dashed border-accent/50 bg-accent/5 p-3 space-y-2"
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) fromFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-medium text-accent">Escanear ficha técnica</p>
          <p className="text-[10px] text-muted">
            Puedes ir agregando fotos (hasta {MAX_ARCHIVOS}); se acumulan y la IA fusiona todo sin borrar lo anterior.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {scanning ? (progreso || "Extrayendo…") : "Adjuntar imágenes / PDF"}
          </button>
          {previews.length > 0 && (
            <button type="button" onClick={limpiar}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger hover:border-danger">
              ✕ Limpiar
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) fromFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="url"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void enviarUrl(); } }}
          placeholder="https://… link de ficha técnica o PDF"
          disabled={scanning}
          className="min-w-[200px] flex-1 rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => void enviarUrl()}
          disabled={scanning || (!linkUrl.trim() && textoPagina.trim().length < 40)}
          className="rounded border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {scanning ? "Extrayendo…" : "Extraer desde link"}
        </button>
        <button
          type="button"
          onClick={() => setMostrarPegar((v) => !v)}
          className="rounded border border-border px-2 py-1.5 text-[10px] text-muted hover:border-accent hover:text-accent"
        >
          {mostrarPegar ? "Ocultar texto" : "Pegar texto"}
        </button>
      </div>
      {mostrarPegar && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted">
            Si el sitio bloquea el servidor (Cloudflare/Shopify), copie el texto de la ficha en el navegador y pégalo aquí.
          </p>
          <textarea
            value={textoPagina}
            onChange={(e) => setTextoPagina(e.target.value)}
            rows={5}
            placeholder="CAS, INCI, descripción, solubilidad, modo de uso…"
            disabled={scanning}
            className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink placeholder:text-muted"
          />
        </div>
      )}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((p, i) =>
            p.isImage && p.url ? (
              <img
                key={`${p.name}-${i}`}
                src={p.url}
                alt={p.name}
                title={`${p.name} — clic para ampliar`}
                onClick={() => setLightbox(p.url)}
                className="h-20 w-20 rounded border border-border object-cover cursor-zoom-in hover:opacity-90"
              />
            ) : (
              <div
                key={`${p.name}-${i}`}
                className="flex h-20 max-w-[140px] items-center gap-1 rounded border border-border bg-surface-input px-2"
              >
                <span className="text-[10px] text-muted"><Ico e="📄" /></span>
                <span className="truncate text-[10px] text-ink">{p.name}</span>
              </div>
            ),
          )}
        </div>
      )}
      {lightbox && <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />}
      {ok && (
        <p className="text-xs text-emerald-600 font-medium">
          Campos extraídos{previews.length > 1 ? ` de ${previews.length} archivos` : ""} y aplicados al formulario.
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function CoaSection({
  coaEinces,
  coaGrado,
  coaParametros, setCoaParametros,
  coaFirmaNombre, setCoaFirmaNombre,
  coaFirmaCargo, setCoaFirmaCargo,
  coaFirmaOrganizacion, setCoaFirmaOrganizacion,
  coaFirmaImagenB64, setCoaFirmaImagenB64,
  ia,
  onSugerir,
  sugiriendo,
  errorSugerir,
}: {
  coaEinces: string;
  coaGrado: string;
  coaParametros: string; setCoaParametros: (v: string) => void;
  coaFirmaNombre: string; setCoaFirmaNombre: (v: string) => void;
  coaFirmaCargo: string; setCoaFirmaCargo: (v: string) => void;
  coaFirmaOrganizacion: string; setCoaFirmaOrganizacion: (v: string) => void;
  coaFirmaImagenB64: string; setCoaFirmaImagenB64: (v: string) => void;
  ia: (campo: string) => { label: string; loading: boolean; onClick: () => void };
  nombreProducto: string;
  onSugerir: () => void;
  sugiriendo: boolean;
  errorSugerir: string | null;
}) {
  /* ── Tabla de parámetros ── */
  const rows = parseParamRows(coaParametros, { editable: true });
  const rowsParaTabla = rows.length ? rows : [{ parametro: "", especificacion: "", resultado: "" }];
  const tieneParametros = rows.some((r) => r.parametro || r.especificacion || r.resultado);
  const sinInfoCoa = !coaEinces.trim() && !coaGrado.trim() && !tieneParametros;

  const updateRow = (i: number, field: keyof ParamRow, val: string) => {
    const next = rowsParaTabla.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
    setCoaParametros(rowsToParamString(next));
  };

  const addRow = () => {
    const next = [...rowsParaTabla, { parametro: "", especificacion: "", resultado: "" }];
    setCoaParametros(rowsToParamString(next));
  };

  const removeRow = (i: number) => {
    const next = rowsParaTabla.filter((_, idx) => idx !== i);
    setCoaParametros(rowsToParamString(next.length ? next : [{ parametro: "", especificacion: "", resultado: "" }]));
  };

  /** Pegar la tabla de un COA («Peso molecular|121.16 g/mol» por línea) la reparte en filas. */
  const [avisoPegado, setAvisoPegado] = useState<string | null>(null);
  const onPasteRow = (i: number, ev: ReactClipboardEvent<HTMLInputElement>) => {
    const nuevas = separarParametrosPegados(ev.clipboardData.getData("text"));
    if (!nuevas.length) return; // texto normal: se pega como siempre
    ev.preventDefault();
    const actual = rowsParaTabla[i];
    const vacia = !actual.parametro.trim() && !actual.especificacion.trim() && !actual.resultado.trim();
    const antes = rowsParaTabla.slice(0, vacia ? i : i + 1);
    const despues = rowsParaTabla.slice(i + 1);
    setCoaParametros(rowsToParamString([...antes, ...nuevas, ...despues]));
    const sinResultado = nuevas.filter((r) => !r.resultado).length;
    setAvisoPegado(
      `Se separaron ${nuevas.length} parámetro${nuevas.length === 1 ? "" : "s"}.` +
        (sinResultado ? ` ${sinResultado} sin resultado: complete la columna «Resultado».` : "") +
        " Revise que cada valor haya quedado en su fila.",
    );
  };

  const cellCls = "w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-accent/5";

  return (
    <div className="space-y-4">
      {sinInfoCoa && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
          <p className="text-xs text-muted">
            No hay información COA. Puede sugerir parámetros de análisis típicos (especificaciones de literatura; el resultado queda en «Conforme», sin inventar un ensayo de laboratorio).
          </p>
          {errorSugerir && <p className="text-xs text-danger">{errorSugerir}</p>}
          <button
            type="button"
            onClick={onSugerir}
            disabled={sugiriendo}
            className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {sugiriendo ? "Sugiriendo…" : "Sugerir"}
          </button>
        </div>
      )}
      <p className="text-[11px] text-muted">
        EINECS y grado se editan arriba, en «Identificación del producto»: aplican a las tres secciones.
      </p>

      <div>
        <p className="mb-2 text-xs font-medium text-muted">Datos de la firma</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Nombre del firmante" value={coaFirmaNombre} onChange={setCoaFirmaNombre} />
          <Field label="Cargo del firmante" value={coaFirmaCargo} onChange={setCoaFirmaCargo} />
          <Field
            label="Organización / laboratorio"
            value={coaFirmaOrganizacion}
            onChange={setCoaFirmaOrganizacion}
          />
        </div>
        <div className="mt-2">
          <FirmaPegable
            value={coaFirmaImagenB64}
            onChange={setCoaFirmaImagenB64}
            firmante={{
              nombre: coaFirmaNombre,
              cargo: coaFirmaCargo,
              organizacion: coaFirmaOrganizacion,
            }}
            onDatosFirmante={(d) => {
              setCoaFirmaNombre(d.nombre);
              setCoaFirmaCargo(d.cargo);
              setCoaFirmaOrganizacion(d.organizacion);
            }}
          />
        </div>
      </div>

      {/* Tabla de parámetros */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Parámetros de análisis</p>
          <div className="flex items-center gap-2">
            {!tieneParametros && !sinInfoCoa && (
              <button
                type="button"
                onClick={onSugerir}
                disabled={sugiriendo}
                className="rounded border border-accent/40 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {sugiriendo ? "Sugiriendo…" : "Sugerir"}
              </button>
            )}
            {tieneParametros && (
            <button
              type="button"
              onClick={() => setCoaParametros("")}
              className="text-[10px] font-medium text-muted hover:text-danger"
            >
              Limpiar tabla
            </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                <th className="px-2 py-2 font-semibold text-ink w-[38%]">Parámetro</th>
                <th className="px-2 py-2 font-semibold text-ink w-[33%]">Especificación</th>
                <th className="px-2 py-2 font-semibold text-ink w-[22%]">Resultado</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rowsParaTabla.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/5">
                  <td className="border-r border-border">
                    <input
                      value={row.parametro}
                      onChange={(e) => updateRow(i, "parametro", e.target.value)}
                      onPaste={(e) => onPasteRow(i, e)}
                      placeholder="Ej. Aspecto"
                      className={cellCls}
                    />
                  </td>
                  <td className="border-r border-border">
                    <input
                      value={row.especificacion}
                      onChange={(e) => updateRow(i, "especificacion", e.target.value)}
                      onPaste={(e) => onPasteRow(i, e)}
                      placeholder="Ej. Polvo blanco"
                      className={cellCls}
                    />
                  </td>
                  <td className="border-r border-border">
                    <input
                      value={row.resultado}
                      onChange={(e) => updateRow(i, "resultado", e.target.value)}
                      onPaste={(e) => onPasteRow(i, e)}
                      placeholder="Ej. Cumple"
                      className={cellCls}
                    />
                  </td>
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-muted hover:text-danger text-[10px]"
                      title="Eliminar fila"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {avisoPegado && (
          <p className="mt-1 text-[10px] text-accent" role="status">
            {avisoPegado}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            title="Agregar fila"
            aria-label="Agregar fila"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border text-muted hover:border-accent hover:text-accent"
          >
            <Icon name="plus" size={14} weight="bold" />
          </button>
          <span className="text-[10px] text-muted">
            Puede pegar la tabla del COA en cualquier celda (un parámetro por línea: «Pureza|98.5 ~ 101.05»); se reparte en filas.
          </span>
        </div>
      </div>
    </div>
  );
}

function IaBtn({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="shrink-0 rounded border border-accent/40 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
    >
      {loading ? "IA…" : label}
    </button>
  );
}

function DocumentoCompletoTabContent({
  producto,
  preload,
  onVolver,
}: {
  producto: ProductoDocumentacion | null;
  preload: Record<string, unknown> | null;
  /** Dentro de la ventana del taller: volver al combo tras dar el visto bueno. */
  onVolver?: () => void;
}) {
  /* FT — delegado a FichaTecnicaForm mediante refs */
  const buildFtRef = useRef<() => Record<string, unknown>>(() => ({}));
  const loadFtRef = useRef<(d: Record<string, unknown>) => void>(() => {});
  const autoCompletarFtRef = useRef<(r: Record<string, string>) => void>(() => {});

  const registrarBuildFt = useCallback((fn: () => Record<string, unknown>) => {
    buildFtRef.current = fn;
  }, []);
  const registrarLoadFt = useCallback((fn: (d: Record<string, unknown>) => void) => {
    loadFtRef.current = fn;
  }, []);
  const registrarAutoCompletarFt = useCallback((fn: (r: Record<string, string>) => void) => {
    autoCompletarFtRef.current = fn;
  }, []);

  /* Campos vacíos detectados tras escanear el documento FT */
  const [camposVaciosEscan, setCamposVaciosEscan] = useState<string[]>([]);
  const [sugiriendoVacios, setSugiriendoVacios] = useState(false);
  const [sugerirVaciosError, setSugerirVaciosError] = useState<string | null>(null);

  const FT_CAMPOS_AUTOSUGERIR = ["descripcion", "apariencia", "olor", "ph", "solubilidad", "propiedades_lista", "aplicaciones", "modo_uso", "alergenos", "conservacion", "sinonimos"] as const;

  /* ── Campos compartidos (una sola vez en el formulario) ── */
  const [nombre, setNombre] = useState("");
  const desdeTaller = useAppStore((st) => Boolean(st.tallerRetorno));
  const [referencia, setReferencia] = useState("");
  const [cas, setCas] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [inci, setInci] = useState("");
  // El formato FT + COA + SDS lleva un único logo y color: el turquesa corporativo
  // (lo impone ficha_tecnica.LOGO_FORMATO / COLOR_FORMATO). Ya no se elige.
  const colorAcento = "#044D5C";
  const qc = useQueryClient();

  /* ── COA: solo campos exclusivos ── */
  const [coaEinces, setCoaEinces] = useState("");
  const [coaGrado, setCoaGrado] = useState("");
  /* Clasificación del insumo: decide qué casillas de identificación aplican */
  const [tipoInsumo, setTipoInsumo] = useState<TipoInsumo | "">("");
  const [ins, setIns] = useState("");
  const casillas = casillasPorClasificacion(tipoInsumo, coaGrado);
  const casGuardar = casillas.cas ? "No aplica" : cas;
  const einecsGuardar = casillas.einecs ? "No aplica" : coaEinces;
  const inciGuardar = casillas.inci ? "" : inci;
  const insGuardar = casillas.ins ? "" : ins;
  const [coaParametros, setCoaParametros] = useState("");
  /* Composición: se imprime en el COA (antes vivía en la SDS) */
  const [coaComposicion, setCoaComposicion] = useState("");
  const [coaFirmaNombre, setCoaFirmaNombre] = useState("");
  const [coaFirmaCargo, setCoaFirmaCargo] = useState("");
  const [coaFirmaOrganizacion, setCoaFirmaOrganizacion] = useState("");
  const [coaFirmaImagenB64, setCoaFirmaImagenB64] = useState("");

  /* ── SDS (esquema 2, ver documentos/SdsSeccion.tsx) ── */
  const [sdsForm, setSdsForm] = useState<SdsForm>(SDS_VACIA);
  const [sdsAvisos, setSdsAvisos] = useState<string[]>([]);
  const sdsCargaRef = useRef(0);
  const [sdsCargando, setSdsCargando] = useState(false);

  /* Generación */
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ pdf_nombre: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── IA sugerencias campos compartidos + SDS ── */
  const sugerirMut = useMutation({
    mutationFn: (campo: string) => {
      const n = nombre.trim();
      if (!n) throw new Error("Indique el nombre del producto primero");
      return api.post<{ valor: string }>("/api/fichas/sugerir-campo", { campo, nombre: n }, { timeoutMs: 180000 });
    },
    onSuccess: (r, campo) => {
      const v = r.valor || "";
      switch (campo) {
        case "cas":                    setCas(v); break;
        case "inci":                   setInci(v); break;
        case "nombre_comercial":       setNombreComercial(v); break;

        case "composicion":            setCoaComposicion(v); break;
        case "coa_einecs":             setCoaEinces(v); break;
        case "coa_grado":              setCoaGrado(v); break;
        case "coa_parametros":         setCoaParametros(v); break;
      }
    },
  });

  const ia = (campo: string) => ({
    label: "IA",
    loading: sugerirMut.isPending && sugerirMut.variables === campo,
    onClick: () => sugerirMut.mutate(campo),
  });

  const sugerirCoaMut = useMutation({
    mutationFn: async () => {
      const n = nombre.trim();
      if (!n) throw new Error("Indique el nombre del producto primero");
      let parametros = "";
      try {
        const r = await api.post<{ valor?: string; error?: string }>(
          "/api/fichas/sugerir-campo",
          { campo: "coa_parametros", nombre: n },
          { timeoutMs: 180000 },
        );
        if (r.error) throw new Error(r.error);
        parametros = (r.valor || "").trim();
      } catch {
        parametros = "";
      }
      if (!parseParamRows(parametros).some((row) => row.parametro)) {
        parametros = PARAMETROS_COA_FALLBACK;
      }
      const extras: string[] = [];
      if (!coaEinces.trim()) extras.push("coa_einecs");
      if (!coaGrado.trim()) extras.push("coa_grado");
      let einecs = "";
      let grado = "";
      if (extras.length) {
        try {
          const extra = await api.post<{ resultados?: Record<string, string | null> }>(
            "/api/fichas/sugerir-multiples",
            { nombre: n, campos: extras },
            { timeoutMs: 120000 },
          );
          einecs = (extra.resultados?.coa_einecs || "").trim();
          grado = (extra.resultados?.coa_grado || "").trim();
        } catch {
          /* EINECS/grado son opcionales; la tabla ya va llena */
        }
      }
      return { parametros, einecs, grado };
    },
    onSuccess: (res) => {
      if (res.parametros) setCoaParametros(res.parametros);
      if (res.einecs) setCoaEinces(res.einecs);
      if (res.grado) setCoaGrado(res.grado);
    },
  });

  /* Preload desde producto seleccionado */
  useEffect(() => {
    if (!producto) return;
    setNombre(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref]);

  const applyCompletoDatos = useCallback((datos: Record<string, unknown>) => {
    const coaData = (datos._coa as Record<string, unknown>) || null;
    const sdsData = (datos._sds as Record<string, unknown>) || null;
    const coaIdent = (coaData?.identificacion as Record<string, unknown>) || {};
    const coaFirma = (coaData?.firma as Record<string, unknown>) || {};
    const sdsIdent = (sdsData?.identificacion as Record<string, unknown>) || {};

    const nombreRaw = String(
      datos.nombre_producto || datos.titulo ||
      coaData?.titulo || sdsData?.titulo || ""
    );
    if (nombreRaw) setNombre(nombreRaw.toUpperCase());

    const ref = String(datos.referencia || coaIdent.referencia_interna || sdsIdent.referencia_interna || "");
    if (ref) setReferencia(ref);
    const casVal = String(datos.cas || coaIdent.cas || sdsIdent.cas || "");
    if (casVal) setCas(casVal);

    const nc = String(datos.nombre_comercial || coaIdent.nombre_comercial || "");
    if (nc) setNombreComercial(nc);
    const inciVal = String(datos.inci || coaIdent.nombre_inci || "");
    if (inciVal) setInci(inciVal);
    setTipoInsumo(esTipoInsumo(datos.tipo_insumo) ? datos.tipo_insumo : "");
    setIns(String(datos.ins || ""));


    // Promover lote/fechas del bloque COA al formulario FT (fuente del completo).
    // Preferir valores del escaneo (_coa.lote / top-level) para que sí se vean en el editor.
    const coaLote = (coaData?.lote as Record<string, unknown>) || {};
    const ftMerge: Record<string, unknown> = { ...datos };
    const pick = (...vals: unknown[]) => {
      for (const v of vals) {
        const s = v == null ? "" : String(v).trim();
        if (s) return s;
      }
      return "";
    };
    const loteN = pick(ftMerge.lote, coaLote.numero);
    const fab = pick(ftMerge.fecha_fabricacion, coaLote.fecha_fabricacion);
    const venc = pick(ftMerge.fecha_vencimiento, coaLote.fecha_vencimiento);
    const fabte = pick(ftMerge.fabricante, coaLote.fabricante);
    const pais = pick(ftMerge.pais_origen, coaLote.pais_origen);
    const present = pick(ftMerge.presentacion, coaLote.tamano_lote);
    if (loteN) ftMerge.lote = loteN;
    if (fab) ftMerge.fecha_fabricacion = fab;
    if (venc) ftMerge.fecha_vencimiento = venc;
    if (fabte) ftMerge.fabricante = fabte;
    if (pais) ftMerge.pais_origen = pais;
    if (present) ftMerge.presentacion = present;

    loadFtRef.current(ftMerge);

    if (coaData) {
      if (coaIdent.einces) setCoaEinces(String(coaIdent.einces));
      else if (sdsIdent.numero_ce) setCoaEinces(String(sdsIdent.numero_ce));
      if (coaIdent.grado) setCoaGrado(String(coaIdent.grado));
      if (coaData.parametros) setCoaParametros(textoDesdeFilasTres(coaData.parametros));
      if (coaData.composicion) setCoaComposicion(textoDesdeFilasTres(coaData.composicion));
      setCoaFirmaNombre(String(coaFirma.nombre || ""));
      setCoaFirmaCargo(String(coaFirma.cargo || ""));
      setCoaFirmaOrganizacion(String(coaFirma.organizacion || ""));
      setCoaFirmaImagenB64(String(coaFirma.imagen_b64 || ""));
    }

    // SDS: se convierte al esquema 2 en el backend (misma regla que el PDF).
    const carga = ++sdsCargaRef.current;
    setSdsAvisos([]);
    if (sdsData) {
      // Documentos anteriores guardaban la composición en la SDS: pasa al COA.
      if (sdsData.composicion && !coaData?.composicion) {
        setCoaComposicion(textoDesdeFilasTres(sdsData.composicion));
      }
      // Recomendaciones GHS históricas guardadas en la FT: entran a la SDS para repartirse.
      const recFt = String(datos.recomendaciones || "");
      const pel = (sdsData.peligros as Record<string, unknown>) || {};
      const sdsEntrada =
        recFt.trim() && sdsData.esquema !== 2 && !sdsData.recomendaciones && !pel.recomendaciones
          ? { ...sdsData, recomendaciones: recFt }
          : sdsData;
      setSdsForm(sdsDesdeDatos(sdsEntrada.esquema === 2 ? sdsEntrada : null));
      setSdsCargando(true);
      void api
        .post<{ sds: Record<string, unknown>; avisos: string[] }>("/api/fichas/sds/normalizar", { sds: sdsEntrada })
        .then((r) => {
          if (carga !== sdsCargaRef.current) return;
          setSdsForm(sdsDesdeDatos(r.sds));
          setSdsAvisos(r.avisos || []);
        })
        .catch(() => {
          if (carga === sdsCargaRef.current) setSdsAvisos(["No se pudo convertir la hoja del formato anterior; recargue el documento."]);
        })
        .finally(() => {
          if (carga === sdsCargaRef.current) setSdsCargando(false);
        });
    } else {
      setSdsForm(SDS_VACIA);
      setSdsCargando(false);
    }
  }, []);

  /* Preload desde biblioteca — FT individual, COA, SDS o documento completo */
  useEffect(() => {
    if (!preload) return;
    applyCompletoDatos(preload);
  }, [preload, applyCompletoDatos]);

  const { data: borradoresData, refetch: refetchBorradores } = useQuery({
    queryKey: ["fichas-borradores"],
    queryFn: () => api.get<{ borradores: Array<{ id: string; titulo: string; guardado_at?: string; archivo: string }> }>("/api/fichas/borradores"),
  });
  const borradores = borradoresData?.borradores ?? [];

  const [borradorMsg, setBorradorMsg] = useState<string | null>(null);
  const [borradorError, setBorradorError] = useState<string | null>(null);
  const [cargandoBorrador, setCargandoBorrador] = useState<string | null>(null);

  const buildCoaDatos = useCallback(() => {
    const ft = buildFtRef.current() as Record<string, unknown>;
    return {
      titulo: nombre,
      identificacion: {
        nombre_comercial: nombreComercial || nombre,
        referencia_interna: referencia,
        nombre_inci: inciGuardar,
        cas: casGuardar,
        einces: einecsGuardar,
        grado: coaGrado,
        ins: insGuardar,
      },
      lote: {
        numero: String(ft.lote || ""),
        fabricante: String(ft.fabricante || ""),
        pais_origen: String(ft.pais_origen || ""),
        fecha_fabricacion: String(ft.fecha_fabricacion || ""),
        fecha_vencimiento: String(ft.fecha_vencimiento || ""),
        tamano_lote: String(ft.presentacion || ""),
      },
      parametros: filasTresDesdeTexto(coaParametros),
      composicion: filasTresDesdeTexto(coaComposicion),
      firma: {
        nombre: coaFirmaNombre,
        cargo: coaFirmaCargo,
        organizacion: coaFirmaOrganizacion,
        imagen_b64: coaFirmaImagenB64,
      },
    };
  }, [
    nombre, nombreComercial, referencia, inciGuardar, casGuardar,
    einecsGuardar, insGuardar, coaGrado, coaParametros, coaComposicion,
    coaFirmaNombre, coaFirmaCargo, coaFirmaOrganizacion, coaFirmaImagenB64,
  ]);

  const buildSdsDatos = useCallback(() => sdsAPayload(sdsForm, {
    titulo: nombre,
    identificacion: {
      nombre_comercial: nombreComercial || nombre,
      referencia_interna: referencia,
      nombre_inci: inciGuardar,
      cas: casGuardar,
      numero_ce: einecsGuardar,
    },
  }), [nombre, nombreComercial, referencia, inciGuardar, casGuardar, einecsGuardar, sdsForm]);

  /** Lo que la FT ya dice: la SDS lo muestra como referencia y la IA no lo repite. */
  const obtenerFtParaSds = useCallback((): ContextoFt => {
    const ft = buildFtRef.current() as Record<string, unknown>;
    const cf = (ft.caracteristicas_fisicas as Record<string, unknown>) || {};
    return {
      conservacion: String(ft.conservacion || ""),
      propiedades: Object.entries(cf)
        .filter(([, v]) => String(v || "").trim())
        .map(([k, v]) => [k.replace(/_/g, " "), String(v)] as [string, string]),
    };
  }, []);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /** FT con la clasificación aplicada: lo que no aplica se guarda como tal. */
  const _buildFt = () => {
    const ft = { ...buildFtRef.current() } as Record<string, unknown>;
    ft.cas = casGuardar;
    ft.tipo_insumo = tipoInsumo;
    ft.ins = insGuardar;
    if (casillas.formula) {
      ft.caracteristicas_fisicas = {
        ...((ft.caracteristicas_fisicas as Record<string, unknown>) || {}),
        formula_quimica: "",
      };
    }
    return ft;
  };

  const _buildBody = () => ({
    ft: _buildFt(),
    coa: buildCoaDatos(),
    sds: buildSdsDatos(),
  });

  const _getToken = async () => {
    const { useTicketsAuth } = await import("../stores/ticketsAuth");
    const { useAuthStore } = await import("../stores/auth");
    const t = useTicketsAuth.getState();
    return t.apiToken || t.token || useAuthStore.getState().token || "";
  };

  const guardarBorradorMut = useMutation({
    mutationFn: async () => {
      const { resolvePanelApiUrl } = await import("../api/client");
      const token = await _getToken();
      const url = await resolvePanelApiUrl("/api/fichas/guardar-borrador", "POST");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(_buildBody()),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
      return json as { ok: boolean; slug: string; archivo: string; titulo: string; guardado_at: string };
    },
    onSuccess: (r) => {
      setBorradorError(null);
      setBorradorMsg(`Borrador guardado: ${r.titulo}`);
      void refetchBorradores();
      void qc.invalidateQueries({ queryKey: ["fichas-biblioteca"] });
    },
    onError: (e: Error) => {
      setBorradorMsg(null);
      setBorradorError(e.message);
    },
  });

  const cargarBorrador = async (slug: string) => {
    setCargandoBorrador(slug);
    setBorradorError(null);
    try {
      const r = await api.get<{ datos: Record<string, unknown> }>(`/api/fichas/datos/${encodeURIComponent(slug)}`);
      applyCompletoDatos(r.datos || {});
      setBorradorMsg(`Borrador cargado: ${String(r.datos?.titulo || slug)}`);
    } catch (e: unknown) {
      setBorradorError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargandoBorrador(null);
    }
  };

  const handleGenerar = async () => {
    setError(null);
    setResultado(null);
    if (sdsForm.sugeridaIa && !sdsForm.vistoBueno) {
      setError("La hoja de seguridad es una sugerencia de IA: revísela y dé el visto bueno en la Sección 3 antes de generar el documento final.");
      document.getElementById("sds-seccion")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setLoading(true);
    try {
      const { resolvePanelApiUrl } = await import("../api/client");
      const token = await _getToken();
      const url = await resolvePanelApiUrl("/api/fichas/generar-completo", "POST");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(_buildBody()),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
      setResultado(json);
      void refetchBorradores();
      // Desde el taller, generar el documento final ES el visto bueno de revisado: se marca en
      // todas las presentaciones que heredan el documento (es de la materia prima) y se vuelve al combo.
      const retornoTaller = useAppStore.getState().tallerRetorno;
      if (retornoTaller?.ref) {
        try {
          await api.post("/api/documentos/revision-checklist/marcar", {
            producto_ref: retornoTaller.ref,
            revisado: true,
            con_presentaciones: true,
            notas: `Visto bueno al generar el documento desde el taller de combos (${json.pdf_nombre || nombre})`,
          });
        } catch {
          /* el PDF ya quedó generado; la marca de revisión se puede poner desde Revisión guiada */
        }
        onVolver?.();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const previewMut = useMutation({
    mutationFn: async () => {
      const { resolvePanelApiUrl } = await import("../api/client");
      const token = await _getToken();
      const genUrl = await resolvePanelApiUrl("/api/fichas/generar-completo", "POST");
      const genRes = await fetch(genUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ..._buildBody(), vista_previa: true }),
      });
      const json = await genRes.json();
      if (!genRes.ok || json.error) throw new Error(json.error || `Error ${genRes.status}`);
      const pdfNombre: string = json.pdf_nombre;
      const dlUrl = await resolvePanelApiUrl(
        `/api/fichas/biblioteca/descargar?archivo=${encodeURIComponent(pdfNombre)}&inline=1`,
        "GET"
      );
      const dlRes = await fetch(dlUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!dlRes.ok) throw new Error(`No se pudo cargar el PDF (${dlRes.status})`);
      const blob = await dlRes.blob();
      return { blobUrl: URL.createObjectURL(blob), pdfNombre };
    },
    onSuccess: ({ blobUrl }) => {
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return blobUrl; });
    },
  });

  const handleDescargar = async () => {
    if (!resultado?.pdf_nombre) return;
    const { resolvePanelApiUrl } = await import("../api/client");
    const { useTicketsAuth } = await import("../stores/ticketsAuth");
    const { useAuthStore } = await import("../stores/auth");
    const t = useTicketsAuth.getState();
    const token = t.apiToken || t.token || useAuthStore.getState().token || "";
    const url = await resolvePanelApiUrl(
      `/api/fichas/biblioteca/descargar?archivo=${encodeURIComponent(resultado.pdf_nombre)}`,
      "GET"
    );
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = resultado.pdf_nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Desde el taller se trabaja UN producto: solo sus borradores, no la lista de todos.
  const normTitulo = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  const borradoresVisibles = desdeTaller
    ? nombre.trim() ? borradores.filter((b) => normTitulo(b.titulo) === normTitulo(nombre)) : []
    : borradores;

  return (
    <div className="relative space-y-4 pb-28">

      {borradoresVisibles.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-2">
          <p className="text-xs font-medium text-ink">{desdeTaller ? "Hay un borrador guardado de este producto" : "Borradores guardados"}</p>
          <ul className="space-y-1">
            {borradoresVisibles.slice(0, 8).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink">{b.titulo}</span>
                {b.guardado_at && (
                  <span className="shrink-0 text-[10px] text-muted">
                    {new Date(b.guardado_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
                <button
                  type="button"
                  disabled={cargandoBorrador === b.id}
                  onClick={() => void cargarBorrador(b.id)}
                  className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-accent hover:border-accent disabled:opacity-40"
                >
                  {cargandoBorrador === b.id ? "Cargando…" : "Continuar"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── IDENTIFICACIÓN COMPARTIDA ─── */}
      <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 space-y-4">
        <p className="text-xs font-bold uppercase tracking-widest text-accent">Identificación del producto</p>
        <p className="text-xs text-muted">Estos datos aplican a las tres secciones del documento.</p>
        <Field
          label="Nombre del producto"
          value={nombre}
          onChange={setNombre}
          placeholder="Ej. Ácido cítrico"
        />
        <div className="space-y-1.5">
          <p className="text-xs text-muted">Tipo de insumo</p>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {TIPOS_INSUMO.map((t) => {
              const activo = tipoInsumo === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTipoInsumo(activo ? "" : t.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    activo ? "border-accent bg-accent text-white" : "border-border text-ink hover:border-accent/60"
                  }`}
                >
                  <span className="block text-[11px] font-semibold">
                    {t.letra} · {t.nombre}
                  </span>
                  <span className={`block text-[10px] leading-tight ${activo ? "text-white/80" : "text-muted"}`}>
                    {t.ejemplos}
                  </span>
                </button>
              );
            })}
          </div>
          {!tipoInsumo && (
            <p className="text-[11px] text-amber-700">
              Sin clasificar: todas las casillas quedan habilitadas. Elige el tipo para dejar solo las que aplican.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              Grado <span className="text-muted/70">(puede ser más de uno)</span>
            </p>
            <IaBtn {...ia("coa_grado")} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {GRADOS_SUGERIDOS.map((g) => {
              const activo = gradoIncluye(coaGrado, g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setCoaGrado(alternarGrado(coaGrado, g))}
                  className={`rounded-full border px-3 py-0.5 text-[11px] font-medium transition-colors ${
                    activo
                      ? "border-accent bg-accent text-white"
                      : "border-border text-muted hover:border-accent/60 hover:text-accent"
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>
          <Field
            label="Grado (texto que va en el COA)"
            value={coaGrado}
            onChange={setCoaGrado}
            placeholder="O escríbelo a mano…"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Número CAS"
            value={cas}
            onChange={setCas}
            placeholder="0000-00-0"
            bloqueado={casillas.cas ?? undefined}
            actions={<IaBtn {...ia("cas")} />}
          />
          <Field
            label="EINECS / Número CE"
            value={coaEinces}
            onChange={setCoaEinces}
            placeholder="000-000-0"
            bloqueado={casillas.einecs ?? undefined}
            actions={<IaBtn {...ia("coa_einecs")} />}
          />
          <Field
            label="Nombre INCI"
            value={inci}
            onChange={setInci}
            placeholder="Ej. Panthenol"
            bloqueado={casillas.inci ?? undefined}
            actions={<IaBtn {...ia("inci")} />}
          />
          <Field
            label="Número INS (aditivo alimentario)"
            value={ins}
            onChange={setIns}
            placeholder="Ej. INS 330"
            bloqueado={casillas.ins ?? undefined}
          />
        </div>
        {sugerirMut.isError && (
          <p className="text-xs text-danger">{(sugerirMut.error as Error).message}</p>
        )}

        <FtImageScanner
          onCamposExtraidos={(campos) => {
            const strCampos: Record<string, string> = {};
            for (const [k, raw] of Object.entries(campos)) {
              if (k.startsWith("_")) continue;
              if (raw == null) continue;
              if (Array.isArray(raw)) {
                const joined = raw
                  .map((x) => (Array.isArray(x) ? x.join("|") : String(x)))
                  .filter(Boolean)
                  .join("\n");
                if (joined.trim()) strCampos[k] = joined;
              } else {
                const s = String(raw).trim();
                if (s) strCampos[k] = s;
              }
            }
            const nombreProd =
              strCampos.nombre_producto || strCampos.product_name || strCampos.titulo || "";
            const casVal = strCampos.cas || "";
            if (nombreProd) setNombre(nombreProd.toUpperCase());
            if (casVal) setCas(casVal);
            if (strCampos.nombre_comercial) setNombreComercial(strCampos.nombre_comercial);
            if (strCampos.inci) setInci(strCampos.inci);

            // Merge en el formulario FT (no reemplazar todo el estado)
            autoCompletarFtRef.current(strCampos);
            loadFtRef.current(campos);

            // Sección COA: la tabla de resultados del documento escaneado.
            // Solo rellena lo que esté vacío, para no pisar ediciones manuales.
            const paramsEscan = strCampos.parametros || "";
            if (
              paramsEscan &&
              parseParamRows(paramsEscan).some((r) => r.parametro) &&
              !parseParamRows(coaParametros).some((r) => r.parametro)
            ) {
              setCoaParametros(paramsEscan);
            }
            if (strCampos.einecs && !coaEinces.trim()) setCoaEinces(strCampos.einecs);
            if (strCampos.grado && !coaGrado.trim()) setCoaGrado(strCampos.grado);

            const vacios = FT_CAMPOS_AUTOSUGERIR.filter((c) => !strCampos[c]);
            setCamposVaciosEscan(vacios);
            setSugerirVaciosError(null);
          }}
        />

        {camposVaciosEscan.length > 0 && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
            <p className="text-xs text-muted">
              <span className="font-medium text-ink">{camposVaciosEscan.length} campos</span> no encontrados en el documento —
              la IA puede sugerirlos con PubChem.
            </p>
            {sugerirVaciosError && (
              <p className="text-xs text-danger">{sugerirVaciosError}</p>
            )}
            <button
              type="button"
              disabled={sugiriendoVacios || !nombre.trim()}
              onClick={async () => {
                if (!nombre.trim()) return;
                setSugiriendoVacios(true);
                setSugerirVaciosError(null);
                try {
                  const { resolvePanelApiUrl } = await import("../api/client");
                  const { useTicketsAuth } = await import("../stores/ticketsAuth");
                  const { useAuthStore } = await import("../stores/auth");
                  const t = useTicketsAuth.getState();
                  const token = t.apiToken || t.token || useAuthStore.getState().token || "";
                  const url = await resolvePanelApiUrl("/api/fichas/sugerir-multiples", "POST");
                  const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({ nombre: nombre.trim(), campos: camposVaciosEscan }),
                    signal: AbortSignal.timeout(120000),
                  });
                  const json = await res.json();
                  if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
                  autoCompletarFtRef.current(json.resultados || {});
                  setCamposVaciosEscan([]);
                } catch (e: unknown) {
                  setSugerirVaciosError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSugiriendoVacios(false);
                }
              }}
              className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {sugiriendoVacios ? "Sugiriendo con IA…" : `Completar ${camposVaciosEscan.length} campos vacíos con IA`}
            </button>
          </div>
        )}

      </div>

      {/* ─── FICHA TÉCNICA ─── */}
      <SeccionBanner titulo="Sección 1 — Ficha Técnica (TDS)" />
      <FichaTecnicaForm
        productoRef={producto?.ref ?? referencia}
        productoNombre={producto?.nombre_base}
        onBuildDatos={registrarBuildFt}
        onLoadDatos={registrarLoadFt}
        onAutoCompletarRef={registrarAutoCompletarFt}
        hideIdentificacion
        externalNombreProducto={nombre}
        externalCas={cas}
        externalReferencia={referencia}
        hideColorAcento
        externalColorAcento={colorAcento}
        hideRecomendaciones
        formulaBloqueada={casillas.formula}
      />

      {/* ─── COA: solo campos exclusivos ─── */}
      <SeccionBanner titulo="Sección 2 — Certificado de Análisis (COA)" />
      <CoaSection
        coaEinces={coaEinces}
        coaGrado={coaGrado}
        coaParametros={coaParametros} setCoaParametros={setCoaParametros}
        coaFirmaNombre={coaFirmaNombre} setCoaFirmaNombre={setCoaFirmaNombre}
        coaFirmaCargo={coaFirmaCargo} setCoaFirmaCargo={setCoaFirmaCargo}
        coaFirmaOrganizacion={coaFirmaOrganizacion} setCoaFirmaOrganizacion={setCoaFirmaOrganizacion}
        coaFirmaImagenB64={coaFirmaImagenB64} setCoaFirmaImagenB64={setCoaFirmaImagenB64}
        ia={ia}
        nombreProducto={nombre}
        onSugerir={() => sugerirCoaMut.mutate()}
        sugiriendo={sugerirCoaMut.isPending}
        errorSugerir={sugerirCoaMut.isError ? (sugerirCoaMut.error as Error).message : null}
      />
      <div className="mt-4">
        <TablaComposicion
          label={
            casillas.composicionRequerida
              ? "Composición · requerida para este tipo de insumo"
              : "Composición"
          }
          value={coaComposicion}
          onChange={setCoaComposicion}
          actions={<IaBtn {...ia("composicion")} />}
        />
      </div>

      {/* ─── SDS: solo campos exclusivos ─── */}
      <SeccionBanner titulo="Sección 3 — Hoja de Datos de Seguridad (SDS)" />
      <SdsSeccion
        value={sdsForm}
        onChange={setSdsForm}
        nombre={nombre}
        identificacion={{ cas: casGuardar, inci: inciGuardar }}
        obtenerFt={obtenerFtParaSds}
        avisos={sdsAvisos}
        cargando={sdsCargando}
      />

      {/* ─── Resultado / errores (sin botones de acción: van flotantes) ─── */}
      {(error || previewMut.isError || resultado || borradorMsg || borradorError) && (
        <div className="mt-6 space-y-2 rounded-lg border border-border p-4">
          {error && (
            <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          )}
          {previewMut.isError && (
            <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{(previewMut.error as Error).message}</p>
          )}
          {borradorError && (
            <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{borradorError}</p>
          )}
          {borradorMsg && (
            <p className="rounded bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{borradorMsg}</p>
          )}
          {resultado && (
            <div className="flex flex-wrap items-center gap-3 rounded bg-surface-alt px-3 py-2">
              <span className="text-sm text-ink">
                Generado: <span className="font-mono text-xs text-accent">{resultado.pdf_nombre}</span>
              </span>
              <button
                type="button"
                onClick={handleDescargar}
                className="ml-auto rounded bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                Descargar PDF
              </button>
              <CargarDocumentosWebButton compact />
            </div>
          )}
        </div>
      )}

      {/* Barra flotante permanente: borrador + vista previa + generar */}
      {!previewUrl && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[4.5rem] z-30 flex justify-center px-3 md:bottom-14 lg:px-10">
          <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-panel/95 p-2.5 shadow-lg backdrop-blur-md">
            <button
              type="button"
              onClick={() => guardarBorradorMut.mutate()}
              disabled={guardarBorradorMut.isPending || loading || previewMut.isPending || !nombre.trim()}
              className="min-w-[8rem] flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-40"
              title={!nombre.trim() ? "Indica el nombre del producto para guardar" : "Guarda el formulario sin generar PDF"}
            >
              {guardarBorradorMut.isPending ? "Guardando…" : "Guardar borrador"}
            </button>
            <button
              type="button"
              onClick={() => previewMut.mutate()}
              disabled={previewMut.isPending || loading}
              className="min-w-[8rem] flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-40"
            >
              {previewMut.isPending ? "Generando vista previa…" : "Vista previa"}
            </button>
            <button
              type="button"
              onClick={handleGenerar}
              disabled={loading || previewMut.isPending}
              className="min-w-[9rem] flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Generando documento…" : desdeTaller ? "Dar el visto bueno y generar el PDF" : "Generar PDF (FT · COA · SDS)"}
            </button>
          </div>
        </div>
      )}

      {/* ─── Modal vista previa PDF ─── */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80"
          onClick={(e) => { if (e.target === e.currentTarget) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } }}
        >
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-panel px-4 py-2.5 shadow">
              <h4 className="truncate max-w-xs text-sm font-semibold text-ink">Vista previa — {nombre || "Documento"}</h4>
              <div className="flex shrink-0 gap-2">
                <a
                  href={previewUrl}
                  download={`${nombre || "documento"}.pdf`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Descargar PDF
                </a>
                <button
                  type="button"
                  onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-danger hover:text-danger"
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>
            <iframe
              title="Vista previa PDF"
              src={`${previewUrl}#toolbar=1&navpanes=0`}
              className="flex-1 w-full border-0 bg-white mck-paper-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function FichasTecnicasPanel({ onVolver }: {
  /** Montado en la ventana del taller de combos: «Volver al combo» cierra la ventana. */
  onVolver?: () => void;
} = {}) {
  // La pestaña vive en el store: la barra está en el cabezote (DocsNavTabs).
  const tab = useAppStore((st) => st.docsTab);
  const setTab = useAppStore((st) => st.setDocsTab);
  const [ftPreload, setFtPreload] = useState<Record<string, unknown> | null>(null);
  const [coaPreload, setCoaPreload] = useState<Record<string, unknown> | null>(null);
  const [sdsPreload, setSdsPreload] = useState<Record<string, unknown> | null>(null);
  const [completoPreload, setCompletoPreload] = useState<Record<string, unknown> | null>(null);
  const [completoKey, setCompletoKey] = useState(0);

  const handleEditar = (r: BibliotecaDatosResult) => {
    const hoy = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();

    const stampFechaHoy = (datos: Record<string, unknown>): Record<string, unknown> => {
      const next: Record<string, unknown> = { ...datos, fecha_revision: hoy };

      // Tabla de identidad (algunos YAML guardan la fecha ahí)
      if (Array.isArray(next.identidad)) {
        next.identidad = (next.identidad as unknown[]).map((row) => {
          if (!Array.isArray(row) || row.length < 2) return row;
          const clave = String(row[0] || "");
          if (/fecha\s*(de\s*)?revisi[oó]n/i.test(clave)) {
            return [row[0], hoy];
          }
          return row;
        });
      }

      // Bloque COA anidado (documento completo / FT con _coa)
      if (next._coa && typeof next._coa === "object") {
        const coa = { ...(next._coa as Record<string, unknown>) };
        const lote = { ...((coa.lote as Record<string, unknown>) || {}) };
        lote.fecha_emision = hoy;
        coa.lote = lote;
        if (!coa.titulo && next.titulo) coa.titulo = next.titulo;
        next._coa = coa;
      }

      // COA puro (datos en raíz)
      if (r.tipo === "coa") {
        const lote = { ...((next.lote as Record<string, unknown>) || {}) };
        lote.fecha_emision = hoy;
        next.lote = lote;
      }

      return next;
    };

    let payload: Record<string, unknown>;
    if (r.tipo === "completo") {
      payload = stampFechaHoy(r.datos);
    } else if (r.tipo === "coa") {
      payload = stampFechaHoy({
        titulo: r.titulo,
        nombre_producto: r.titulo,
        _coa: stampFechaHoy(r.datos),
      });
    } else if (r.tipo === "sds") {
      payload = stampFechaHoy({ titulo: r.titulo, nombre_producto: r.titulo, _sds: r.datos });
    } else {
      payload = stampFechaHoy(r.datos); // ft
    }
    setCompletoPreload(payload);
    setCompletoKey((k) => k + 1);
    setTab("completo");
  };

  // Documento que llega desde el taller: editor limpio (key nueva) con ese YAML.
  const handleEditarRef = useRef(handleEditar);
  handleEditarRef.current = handleEditar;
  const abrirDesdeTaller = useCallback((datos: Record<string, unknown>) => {
    handleEditarRef.current({ tipo: "completo", titulo: String(datos.titulo || ""), datos, yaml: "", tiene_datos: true });
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-3 pb-4">
      <DocDelCombo onAbrir={abrirDesdeTaller} editando={tab === "completo"} onVolver={onVolver} />
      {tab === "ft" && <FichaTecnicaTabContent producto={null} preload={ftPreload} />}
      {tab === "coa" && <CoaTabContent producto={null} preload={coaPreload} />}
      {tab === "sds" && <SdsTabContent producto={null} preload={sdsPreload} />}
      {tab === "completo" && <DocumentoCompletoTabContent key={completoKey} producto={null} preload={completoPreload} onVolver={onVolver} />}
      {tab === "biblioteca" && <BibliotecaTab onEditar={handleEditar} />}
      {tab === "revision" && (
        <DocumentosCatalogoTab
          onGenerar={(producto) => {
            setCompletoPreload({ titulo: producto.nombre, nombre_producto: producto.nombre });
            setCompletoKey((k) => k + 1);
            setTab("completo");
          }}
        />
      )}
    </div>
  );
}
