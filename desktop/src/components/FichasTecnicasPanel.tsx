import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import ImageLightbox from "./ImageLightbox";
import DocumentoGeneradorTab, {
  type DocLayoutOpciones,
  type GenerarDocResult,
  Field,
  filasDesdeTexto,
  filasTresDesdeTexto,
  listaDesdeTexto,
  textoDesdeFilas,
  textoDesdeFilasTres,
} from "./documentos/DocumentoGeneradorTab";
import FichaTecnicaForm from "./documentos/FichaTecnicaForm";
import DocumentosCatalogoTab, {
  type ProductoDocumentacion,
} from "./documentos/DocumentosCatalogoTab";

type TabDoc = "catalogo" | "ft" | "coa" | "sds" | "completo" | "biblioteca";

const TABS: { id: TabDoc; label: string }[] = [
  { id: "biblioteca", label: "Biblioteca" },
  { id: "completo", label: "Ficha Técnica COA SDS" },
  { id: "catalogo", label: "Catálogo productos" },
];

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

function BibliotecaTab({ onEditar }: { onEditar: (r: BibliotecaDatosResult) => void }) {
  const [busqueda, setBusqueda] = useState("");
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

  const archivos = (data?.archivos ?? []).filter((a) => {
    if (a.tipo !== "pdf") return false;
    const q = busqueda.toLowerCase();
    if (q && !a.nombre.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
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
          {generarLotesMut.isPending ? "Generando…" : "🔢 Generar lotes faltantes"}
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

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-panel">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted uppercase tracking-wide">Documento</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted uppercase tracking-wide w-16">Tipo</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase tracking-wide w-20">Tamaño</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted uppercase tracking-wide w-28">Fecha</th>
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
                          🗑
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
      showFichaLayout
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
        Guarda el lote de esta ficha técnica en el historial de trazabilidad y genera un código único
        consultable por el cliente en <code>mckennagroup.co/verificar</code>. Si dejas vacío el campo
        «Lote» de arriba, se genera solo (4 letras del producto + consecutivo, ej. CITR-001).
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
    setTitulo(String(datos.titulo || ""));
    setNombreComercial(String(ident.nombre_comercial || ""));
    setReferencia(String(ident.referencia_interna || ""));
    setInci(String(ident.nombre_inci || ""));
    setCas(String(ident.cas || ""));
    setFormula(String(ident.formula_molecular || ""));
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
    setCodigoVerif(String(datos.codigo_verificacion || ""));
  }, []);

  useEffect(() => {
    if (preload) loadDatos(preload);
  }, [preload, loadDatos]);

  const buildDatos = useCallback(
    () => ({
      titulo,
      identificacion: {
        nombre_comercial: nombreComercial || titulo,
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
      codigo_verificacion: codigoVerif,
    }),
    [
      titulo, nombreComercial, referencia, inci, cas, formula, einces, concentracion, grado,
      presentacion, incluye, loteNum, fab, venc, vidaUtil, tamanoLote, pais, fabricante, fechaAnalisis,
      fechaEmision, parametros, empaque, almacenamiento, precauciones, observaciones, codigoVerif,
    ],
  );

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
          <Field label="Nombre comercial" value={nombreComercial} onChange={setNombreComercial} />
          <Field label="Referencia interna" value={referencia} onChange={setReferencia} />
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} />
          <Field label="EINECS" value={einces} onChange={setEinces} />
          <Field label="Concentración" value={concentracion} onChange={setConcentracion} />
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
        />
        <p className="text-xs font-medium text-muted">Empaque y almacenamiento</p>
        <Field label="Empaque original" value={empaque} onChange={setEmpaque} rows={2} />
        <Field label="Almacenamiento" value={almacenamiento} onChange={setAlmacenamiento} rows={2} />
        <Field label="Precauciones" value={precauciones} onChange={setPrecauciones} rows={2} />
        <Field label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
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
        Guarda este lote en el historial de trazabilidad de <code>{referencia}</code>. Si dejas vacío el
        campo «No. de lote» de arriba, se genera solo (4 letras del producto + consecutivo, ej.
        CITR-001). Se genera además un código único para que el cliente lo consulte en{" "}
        <code>mckennagroup.co/verificar</code> — imprímelo en la etiqueta (Studio Etiquetas).
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
    setFormula(String(ident.formula_molecular || ""));
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
        nombre_comercial: nombreComercial || titulo,
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
          <Field label="Nombre comercial" value={nombreComercial} onChange={setNombreComercial} />
          <Field label="Referencia interna" value={referencia} onChange={setReferencia} />
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} />
          <Field label="Usos recomendados" value={usos} onChange={setUsos} />
          <Field label="Teléfono emergencia" value={telefono} onChange={setTelefono} />
        </div>
        <p className="text-xs font-medium text-muted">Peligros</p>
        <Field label="Clasificación GHS" value={clasificacion} onChange={setClasificacion} rows={2} />
        <Field label="Pictogramas / frases H-P" value={pictogramas} onChange={setPictogramas} rows={2} />
        <Field label="Composición (componente|concentración)" value={composicion} onChange={setComposicion} rows={4} mono />
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

function FtImageScanner({ onCamposExtraidos }: { onCamposExtraidos: (c: Record<string, unknown>) => void }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [ok, setOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const enviar = async (file: File) => {
    setError(null); setOk(false); setScanning(true);
    try {
      const { resolvePanelApiUrl } = await import("../api/client");
      const { useTicketsAuth } = await import("../stores/ticketsAuth");
      const { useAuthStore } = await import("../stores/auth");
      const t = useTicketsAuth.getState();
      const token = t.apiToken || t.token || useAuthStore.getState().token || "";
      const url = await resolvePanelApiUrl("/api/fichas/ft/escanear-imagen", "POST");
      const fd = new FormData();
      fd.append("imagen", file);
      const res = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
      onCamposExtraidos(json.campos || {});
      setOk(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const [fileName, setFileName] = useState<string | null>(null);

  const fromFile = (file: File) => {
    setOk(false); setError(null);
    if (file.type.startsWith("image/")) {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }
    setFileName(file.name);
    enviar(file);
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) { fromFile(file); e.preventDefault(); }
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const limpiar = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null); setFileName(null); setOk(false); setError(null);
  };

  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

  return (
    <div
      className="mb-4 rounded-lg border border-dashed border-accent/50 bg-accent/5 p-3 space-y-2"
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && esValido(f)) fromFile(f); }}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-medium text-accent">Escanear ficha técnica desde imagen o PDF</p>
          <p className="text-[10px] text-muted">Pega con Ctrl+V, arrastra o adjunta — la IA extrae los campos automáticamente.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {scanning ? "Extrayendo…" : "Adjuntar imagen / PDF"}
          </button>
          {(preview || fileName) && (
            <button type="button" onClick={limpiar}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger hover:border-danger">
              ✕ Limpiar
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && esValido(f)) fromFile(f); }} />
      </div>
      {preview && (
        <img
          src={preview}
          alt="Vista previa"
          title="Clic para ampliar"
          onClick={() => setLightbox(true)}
          className="max-h-36 rounded border border-border object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
        />
      )}
      {lightbox && preview && <ImageLightbox url={preview} onClose={() => setLightbox(false)} />}
      {!preview && fileName && (
        <div className="flex items-center gap-2 rounded border border-border bg-surface-input px-3 py-2">
          <span className="text-[10px] text-muted">📄</span>
          <span className="text-xs text-ink truncate">{fileName}</span>
        </div>
      )}
      {ok && <p className="text-xs text-emerald-600 font-medium">Campos extraídos y aplicados al formulario.</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type ParamRow = { parametro: string; especificacion: string; resultado: string };

function parseParamRows(text: string): ParamRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (!lines.length) return [{ parametro: "", especificacion: "", resultado: "" }];
  return lines.map((line) => {
    const parts = line.split("|");
    return {
      parametro:     (parts[0] ?? "").trim(),
      especificacion:(parts[1] ?? "").trim(),
      resultado:     (parts[2] ?? "").trim(),
    };
  });
}

function rowsToParamString(rows: ParamRow[]): string {
  return rows.map((r) => `${r.parametro}|${r.especificacion}|${r.resultado}`).join("\n");
}

function CoaSection({
  coaEinces, setCoaEinces,
  coaGrado, setCoaGrado,
  coaParametros, setCoaParametros,
  ia,
}: {
  coaEinces: string; setCoaEinces: (v: string) => void;
  coaGrado: string; setCoaGrado: (v: string) => void;
  coaParametros: string; setCoaParametros: (v: string) => void;
  ia: (campo: string) => { label: string; loading: boolean; onClick: () => void };
  nombreProducto: string;
}) {
  const scanFileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanLightbox, setScanLightbox] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /* ── Tabla de parámetros ── */
  const rows = parseParamRows(coaParametros);

  const updateRow = (i: number, field: keyof ParamRow, val: string) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r);
    setCoaParametros(rowsToParamString(next));
  };

  const addRow = () => {
    const next = [...rows, { parametro: "", especificacion: "", resultado: "" }];
    setCoaParametros(rowsToParamString(next));
  };

  const removeRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setCoaParametros(rowsToParamString(next.length ? next : [{ parametro: "", especificacion: "", resultado: "" }]));
  };

  /* ── Escáner ── */
  const handleScanImage = async (file: File) => {
    setScanError(null);
    setScanning(true);
    try {
      const { resolvePanelApiUrl } = await import("../api/client");
      const { useTicketsAuth } = await import("../stores/ticketsAuth");
      const { useAuthStore } = await import("../stores/auth");
      const t = useTicketsAuth.getState();
      const token = t.apiToken || t.token || useAuthStore.getState().token || "";
      const url = await resolvePanelApiUrl("/api/fichas/coa/escanear-parametros", "POST");
      const fd = new FormData();
      fd.append("imagen", file);
      const res = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);
      setCoaParametros(json.parametros || "");
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") setScanPreview(URL.createObjectURL(file));
    handleScanImage(file);
    e.target.value = "";
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            setScanPreview(URL.createObjectURL(file));
            handleScanImage(file);
            e.preventDefault();
          }
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const cellCls = "w-full bg-transparent px-2 py-1.5 text-xs outline-none focus:bg-accent/5";

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">EINECS</span>
            <IaBtn {...ia("coa_einecs")} />
          </div>
          <Field value={coaEinces} onChange={setCoaEinces} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Grado</span>
            <IaBtn {...ia("coa_grado")} />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {["Cosmético", "Alimentos", "Industrial", "Grasas y Ceras", "Agro"].map((g) => (
              <button key={g} type="button"
                onClick={() => setCoaGrado(coaGrado === g ? "" : g)}
                className={`rounded-full px-3 py-0.5 text-[11px] font-medium border transition-colors ${coaGrado === g ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent/60 hover:text-accent"}`}
              >{g}</button>
            ))}
          </div>
          <Field value={coaGrado} onChange={setCoaGrado} placeholder="O escribe un grado personalizado…" />
        </div>
      </div>

      {/* Escáner de imagen COA */}
      <div
        className={`rounded-lg border border-dashed p-3 space-y-2 transition-colors ${dragOver ? "border-accent bg-accent/15" : "border-accent/50 bg-accent/5"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (!file) return;
          if (file.type !== "application/pdf") setScanPreview(URL.createObjectURL(file));
          handleScanImage(file);
        }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-medium text-accent">
            {dragOver ? "Suelta la imagen o PDF aquí" : "Escanear COA desde imagen o PDF"}
          </p>
          <button
            type="button"
            onClick={() => scanFileRef.current?.click()}
            disabled={scanning}
            className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {scanning ? "Extrayendo…" : "Adjuntar archivo"}
          </button>
          <input ref={scanFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
        </div>
        <p className="text-[10px] text-muted">
          Pega con Ctrl+V, arrastra una imagen o PDF, o usa el botón. La IA extraerá y completará la tabla de parámetros automáticamente.
        </p>
        {scanLightbox && scanPreview && <ImageLightbox url={scanPreview} onClose={() => setScanLightbox(false)} />}
        {scanPreview && (
          <div className="relative inline-block">
            <img
              src={scanPreview}
              alt="Vista previa COA"
              title="Clic para ampliar"
              onClick={() => setScanLightbox(true)}
              className="max-h-40 rounded border border-border object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
            />
            <button
              type="button"
              onClick={() => { URL.revokeObjectURL(scanPreview); setScanPreview(null); setScanError(null); }}
              className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold hover:opacity-80"
              title="Eliminar imagen"
            >
              ✕
            </button>
          </div>
        )}
        {scanError && <p className="text-xs text-danger">{scanError}</p>}
      </div>

      {/* Tabla de parámetros */}
      <div>
        <p className="text-xs text-muted mb-2">Parámetros de análisis</p>
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
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0 hover:bg-accent/5">
                  <td className="border-r border-border">
                    <input
                      value={row.parametro}
                      onChange={(e) => updateRow(i, "parametro", e.target.value)}
                      placeholder="Ej. Aspecto"
                      className={cellCls}
                    />
                  </td>
                  <td className="border-r border-border">
                    <input
                      value={row.especificacion}
                      onChange={(e) => updateRow(i, "especificacion", e.target.value)}
                      placeholder="Ej. Polvo blanco"
                      className={cellCls}
                    />
                  </td>
                  <td className="border-r border-border">
                    <input
                      value={row.resultado}
                      onChange={(e) => updateRow(i, "resultado", e.target.value)}
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
        <button
          type="button"
          onClick={addRow}
          className="mt-2 rounded border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent"
        >
          + Agregar fila
        </button>
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
}: {
  producto: ProductoDocumentacion | null;
  preload: Record<string, unknown> | null;
}) {
  /* FT — delegado a FichaTecnicaForm mediante refs */
  const buildFtRef = useRef<() => Record<string, unknown>>(() => ({}));
  const loadFtRef = useRef<(d: Record<string, unknown>) => void>(() => {});
  const autoCompletarFtRef = useRef<(r: Record<string, string>) => void>(() => {});

  /* Campos vacíos detectados tras escanear el documento FT */
  const [camposVaciosEscan, setCamposVaciosEscan] = useState<string[]>([]);
  const [sugiriendoVacios, setSugiriendoVacios] = useState(false);
  const [sugerirVaciosError, setSugerirVaciosError] = useState<string | null>(null);

  const FT_CAMPOS_AUTOSUGERIR = ["descripcion", "apariencia", "olor", "ph", "solubilidad", "propiedades_lista", "aplicaciones", "modo_uso", "sinonimos"] as const;

  /* ── Campos compartidos (una sola vez en el formulario) ── */
  const [nombre, setNombre] = useState("");
  const [referencia, setReferencia] = useState("");
  const [cas, setCas] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [inci, setInci] = useState("");
  const [colorAcento, setColorAcento] = useState("#069DC2");
  const [cabezoteId, setCabezoteId] = useState("default");

  const qc = useQueryClient();
  const cabezoteFileRef = useRef<HTMLInputElement>(null);
  const [cabezoteConfirmDelete, setCabezoteConfirmDelete] = useState<string | null>(null);
  const [cabezoteDeleting, setCabezoteDeleting] = useState<string | null>(null);
  const [cabezoteDeleteError, setCabezoteDeleteError] = useState<string | null>(null);
  const [cabezotePreview, setCabezotePreview] = useState<{ src: string; nombre: string } | null>(null);

  const { data: layoutOpciones } = useQuery({
    queryKey: ["fichas-opciones"],
    queryFn: () => api.get<DocLayoutOpciones>("/api/fichas/opciones"),
  });

  const cabezoteUploadMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("archivo", file);
      const base = file.name.replace(/\.[^.]+$/, "");
      if (base.trim()) fd.append("nombre", base.trim());
      return api.upload<{ ok: boolean; cabezote: { id: string; nombre: string } }>("/api/fichas/cabezotes/subir", fd);
    },
    onSuccess: (r) => {
      setCabezoteId(r.cabezote.id);
      void qc.invalidateQueries({ queryKey: ["fichas-opciones"] });
    },
  });

  const handleCabezoteDelete = async (id: string) => {
    if (cabezoteDeleting) return;
    setCabezoteDeleting(id);
    setCabezoteDeleteError(null);
    try {
      const { resolvePanelApiUrl } = await import("../api/client");
      const { useTicketsAuth } = await import("../stores/ticketsAuth");
      const { useAuthStore } = await import("../stores/auth");
      const t = useTicketsAuth.getState();
      const token = t.apiToken || t.token || useAuthStore.getState().token || "";
      const url = resolvePanelApiUrl(`/api/fichas/cabezotes/${encodeURIComponent(id)}/eliminar`, "DELETE");
      const res = await fetch(url, { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (cabezoteId === id) setCabezoteId("default");
      void qc.invalidateQueries({ queryKey: ["fichas-opciones"] });
    } catch (err) {
      setCabezoteDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setCabezoteDeleting(null);
      setCabezoteConfirmDelete(null);
    }
  };

  /* ── COA: solo campos exclusivos ── */
  const [coaEinces, setCoaEinces] = useState("");
  const [coaGrado, setCoaGrado] = useState("");
  const [coaParametros, setCoaParametros] = useState("");

  /* ── SDS: solo campos exclusivos ── */
  const [sdsClasificacion, setSdsClasificacion] = useState("");
  const [sdsPictogramas, setSdsPictogramas] = useState("");
  const [sdsComposicion, setSdsComposicion] = useState("");
  const [sdsPrimeros, setSdsPrimeros] = useState("");
  const [sdsManipulacion, setSdsManipulacion] = useState("");

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

        case "sds_clasificacion_ghs":  setSdsClasificacion(v); break;
        case "sds_pictogramas":        setSdsPictogramas(v); break;
        case "composicion":            setSdsComposicion(v); break;
        case "sds_primeros_auxilios":  setSdsPrimeros(v); break;
        case "sds_manipulacion":       setSdsManipulacion(v); break;
        case "coa_einecs":             setCoaEinces(v); break;
        case "coa_grado":              setCoaGrado(v); break;
      }
    },
  });

  const ia = (campo: string) => ({
    label: "IA",
    loading: sugerirMut.isPending && sugerirMut.variables === campo,
    onClick: () => sugerirMut.mutate(campo),
  });

  /* Preload desde producto seleccionado */
  useEffect(() => {
    if (!producto) return;
    setNombre(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref]);

  /* Preload desde biblioteca — FT individual, COA, SDS o documento completo */
  useEffect(() => {
    if (!preload) return;

    const coaData = (preload._coa as Record<string, unknown>) || null;
    const sdsData = (preload._sds as Record<string, unknown>) || null;
    const coaIdent = (coaData?.identificacion as Record<string, unknown>) || {};
    const sdsIdent = (sdsData?.identificacion as Record<string, unknown>) || {};

    // Nombre del producto: raíz FT > _coa.titulo > _sds.titulo
    const nombreRaw = String(
      preload.nombre_producto || preload.titulo ||
      coaData?.titulo || sdsData?.titulo || ""
    );
    if (nombreRaw) setNombre(nombreRaw.toUpperCase());

    // Referencia y CAS: raíz FT > identificación COA > identificación SDS
    const ref = String(preload.referencia || coaIdent.referencia_interna || sdsIdent.referencia_interna || "");
    if (ref) setReferencia(ref);
    const casVal = String(preload.cas || coaIdent.cas || sdsIdent.cas || "");
    if (casVal) setCas(casVal);

    // Cabezote guardado
    if (preload._cabezote_id) setCabezoteId(String(preload._cabezote_id));

    // Color de acento (se controla desde el padre, no desde FichaTecnicaForm)
    if (preload.color_acento) setColorAcento(String(preload.color_acento));

    // Cargar formulario FT (solo aplica si hay datos FT al nivel raíz)
    loadFtRef.current(preload);

    // Sección COA
    if (coaData) {
      if (coaIdent.einces) setCoaEinces(String(coaIdent.einces));
      if (coaIdent.grado)  setCoaGrado(String(coaIdent.grado));
      if (coaData.parametros) setCoaParametros(textoDesdeFilasTres(coaData.parametros));
    }

    // Sección SDS
    if (sdsData) {
      const peligros = (sdsData.peligros as Record<string, unknown>) || {};
      const manip    = (sdsData.manipulacion as Record<string, unknown>) || {};
      if (peligros.clasificacion) setSdsClasificacion(String(peligros.clasificacion));
      if (peligros.pictogramas)   setSdsPictogramas(String(peligros.pictogramas));
      if (sdsData.composicion)    setSdsComposicion(textoDesdeFilasTres(sdsData.composicion));
      if (sdsData.primeros_auxilios) setSdsPrimeros(textoDesdeFilas(sdsData.primeros_auxilios));
      if (manip.manipulacion)     setSdsManipulacion(String(manip.manipulacion));
    }
  }, [preload]);

  const buildCoaDatos = useCallback(() => ({
    titulo: nombre,
    identificacion: {
      nombre_comercial: nombreComercial || nombre,
      referencia_interna: referencia,
      nombre_inci: inci,
      cas,
      einces: coaEinces,
      grado: coaGrado,
    },
    parametros: filasTresDesdeTexto(coaParametros),
  }), [
    nombre, nombreComercial, referencia, inci, cas,
    coaEinces, coaGrado, coaParametros,
  ]);

  const buildSdsDatos = useCallback(() => ({
    titulo: nombre,
    identificacion: {
      nombre_comercial: nombreComercial || nombre,
      referencia_interna: referencia,
      nombre_inci: inci,
      cas,
    },
    peligros: { clasificacion: sdsClasificacion, pictogramas: sdsPictogramas },
    composicion: filasTresDesdeTexto(sdsComposicion),
    primeros_auxilios: filasDesdeTexto(sdsPrimeros),
    manipulacion: { manipulacion: sdsManipulacion },
  }), [
    nombre, nombreComercial, referencia, inci, cas,
    sdsClasificacion, sdsPictogramas, sdsComposicion,
    sdsPrimeros, sdsManipulacion,
  ]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const _buildBody = () => ({
    ft: buildFtRef.current(),
    coa: buildCoaDatos(),
    sds: buildSdsDatos(),
    cabezote_id: cabezoteId,
  });

  const _getToken = async () => {
    const { useTicketsAuth } = await import("../stores/ticketsAuth");
    const { useAuthStore } = await import("../stores/auth");
    const t = useTicketsAuth.getState();
    return t.apiToken || t.token || useAuthStore.getState().token || "";
  };

  const handleGenerar = async () => {
    setLoading(true);
    setError(null);
    setResultado(null);
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
        body: JSON.stringify(_buildBody()),
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

  return (
    <div className="space-y-4">

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
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Referencia interna" value={referencia} onChange={setReferencia} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted">Número CAS</span>
              <IaBtn {...ia("cas")} />
            </div>
            <Field value={cas} onChange={setCas} placeholder="0000-00-0" />
          </div>

        </div>
        {sugerirMut.isError && (
          <p className="text-xs text-danger">{(sugerirMut.error as Error).message}</p>
        )}

        <FtImageScanner
          onCamposExtraidos={(campos) => {
            if (campos.nombre_producto) setNombre(String(campos.nombre_producto).toUpperCase());
            if (campos.cas) setCas(String(campos.cas));
            if (campos.nombre_comercial) setNombreComercial(String(campos.nombre_comercial));
            if (campos.inci) setInci(String(campos.inci));
            loadFtRef.current(campos);
            const vacios = FT_CAMPOS_AUTOSUGERIR.filter(c => !campos[c] || String(campos[c]).trim() === "");
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

        {/* Color del formato */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">Color del formato</p>
          <div className="flex flex-wrap gap-2">
            {[
              { hex: "#069DC2", nombre: "Azul McKenna" },
              { hex: "#003DA5", nombre: "Azul marino" },
              { hex: "#5CB85C", nombre: "Verde claro" },
              { hex: "#37474F", nombre: "Gris antracita" },
              { hex: "#6A1B9A", nombre: "Morado" },
              { hex: "#B71C1C", nombre: "Rojo" },
              { hex: "#FFA040", nombre: "Naranja claro" },
              { hex: "#000000", nombre: "Negro" },
            ].map(({ hex, nombre: n }) => (
              <button
                key={hex}
                type="button"
                title={n}
                onClick={() => setColorAcento(hex)}
                className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: hex,
                  borderColor: colorAcento === hex ? "#fff" : hex,
                  outline: colorAcento === hex ? `2px solid ${hex}` : "none",
                }}
              />
            ))}
            <input
              type="color"
              value={colorAcento}
              onChange={(e) => setColorAcento(e.target.value)}
              title="Color personalizado"
              className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent p-0"
            />
          </div>
        </div>

        {/* Cabezote */}
        {layoutOpciones && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted">Cabezote del encabezado</p>
              <button
                type="button"
                onClick={() => cabezoteFileRef.current?.click()}
                disabled={cabezoteUploadMut.isPending}
                className="shrink-0 rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                {cabezoteUploadMut.isPending ? "Subiendo…" : "+ Subir imagen"}
              </button>
            </div>
            <input
              ref={cabezoteFileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) cabezoteUploadMut.mutate(file);
              }}
            />
            <div className="flex flex-wrap gap-3">
              {layoutOpciones.cabezotes.map((c) => {
                const imgSrc = `/api/fichas/cabezotes/${encodeURIComponent(c.id)}/imagen`;
                const selected = cabezoteId === c.id;
                const isDeleting = cabezoteDeleting === c.id;
                const isConfirming = cabezoteConfirmDelete === c.id;
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isConfirming && !isDeleting && setCabezoteId(c.id)}
                    onKeyDown={(e) => e.key === "Enter" && !isConfirming && !isDeleting && setCabezoteId(c.id)}
                    className={`group relative w-36 cursor-pointer select-none overflow-hidden rounded-xl border-2 transition-all ${
                      selected ? "border-accent shadow-[0_0_0_3px] shadow-accent/20" : "border-border hover:border-accent/60"
                    }`}
                  >
                    {c.id === "default" ? (
                      <div className={`flex h-14 w-full flex-col items-center justify-center gap-1 ${selected ? "bg-accent/10 text-accent" : "bg-surface-input text-muted"}`}>
                        <span className="text-[10px] font-medium">Sin cabezote</span>
                      </div>
                    ) : (
                      <div className="relative h-14 w-full bg-white mck-paper-white">
                        <img src={imgSrc} alt={c.nombre} className="h-full w-full object-contain p-1.5" />
                        <button
                          type="button"
                          title="Vista previa"
                          onClick={(e) => { e.stopPropagation(); setCabezotePreview({ src: imgSrc, nombre: c.nombre }); }}
                          className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-ink shadow opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
                        </button>
                      </div>
                    )}
                    {selected && (
                      <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white shadow-sm">✓</div>
                    )}
                    <div className="flex h-7 items-center gap-1 border-t border-border/40 bg-surface-panel px-2" onClick={(e) => e.stopPropagation()}>
                      <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-ink">{c.nombre}</span>
                      {c.id !== "default" && !isDeleting && !isConfirming && (
                        <button
                          type="button"
                          title="Eliminar"
                          onClick={(e) => { e.stopPropagation(); setCabezoteConfirmDelete(c.id); setCabezoteDeleteError(null); }}
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted/50 hover:bg-danger/10 hover:text-danger"
                        >
                          <svg width="10" height="10" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M1 3h9M4 3V2h3v1M1.5 3l.7 6.3a1 1 0 001 .9h3.6a1 1 0 001-.9L8.5 3"/></svg>
                        </button>
                      )}
                    </div>
                    {isConfirming && !isDeleting && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-panel/95" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[10px] font-semibold text-ink">¿Eliminar?</p>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={(e) => { e.stopPropagation(); void handleCabezoteDelete(c.id); }} className="rounded bg-danger px-2.5 py-1 text-[10px] font-bold text-white hover:opacity-85">Sí</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setCabezoteConfirmDelete(null); }} className="rounded border border-border bg-surface-input px-2 py-1 text-[10px] text-ink">No</button>
                        </div>
                      </div>
                    )}
                    {isDeleting && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-surface-panel/90">
                        <span className="text-[10px] text-muted">Eliminando…</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {cabezoteDeleteError && <p className="text-xs text-danger">{cabezoteDeleteError}</p>}
            {cabezotePreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCabezotePreview(null)}>
                <div className="relative max-w-xl rounded-xl bg-white mck-paper-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <img src={cabezotePreview.src} alt={cabezotePreview.nombre} className="max-h-64 w-full object-contain" />
                  <p className="mt-2 text-center text-xs text-muted">{cabezotePreview.nombre}</p>
                  <button type="button" onClick={() => setCabezotePreview(null)} className="absolute right-2 top-2 rounded bg-surface-input px-2 py-1 text-xs text-ink hover:bg-border">✕ Cerrar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── FICHA TÉCNICA ─── */}
      <SeccionBanner titulo="Sección 1 — Ficha Técnica (TDS)" />
      <FichaTecnicaForm
        productoRef={producto?.ref ?? referencia}
        productoNombre={producto?.nombre_base}
        onBuildDatos={(fn) => { buildFtRef.current = fn; }}
        onLoadDatos={(fn) => { loadFtRef.current = fn; }}
        onAutoCompletarRef={(fn) => { autoCompletarFtRef.current = fn; }}
        hideIdentificacion
        externalNombreProducto={nombre}
        externalCas={cas}
        externalReferencia={referencia}
        hideColorAcento
        externalColorAcento={colorAcento}
        hideRecomendaciones
      />

      {/* ─── COA: solo campos exclusivos ─── */}
      <SeccionBanner titulo="Sección 2 — Certificado de Análisis (COA)" />
      <CoaSection
        coaEinces={coaEinces} setCoaEinces={setCoaEinces}
        coaGrado={coaGrado} setCoaGrado={setCoaGrado}
        coaParametros={coaParametros} setCoaParametros={setCoaParametros}
        ia={ia}
        nombreProducto={nombre}
      />

      {/* ─── SDS: solo campos exclusivos ─── */}
      <SeccionBanner titulo="Sección 3 — Hoja de Datos de Seguridad (SDS)" />
      <div className="space-y-4">
        <p className="text-xs font-medium text-muted">Peligros</p>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Clasificación GHS</span>
            <IaBtn {...ia("sds_clasificacion_ghs")} />
          </div>
          <Field value={sdsClasificacion} onChange={setSdsClasificacion} rows={2} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Pictogramas / frases H-P</span>
            <IaBtn {...ia("sds_pictogramas")} />
          </div>
          <Field value={sdsPictogramas} onChange={setSdsPictogramas} rows={2} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Composición (componente|concentración)</span>
            <IaBtn {...ia("composicion")} />
          </div>
          <Field value={sdsComposicion} onChange={setSdsComposicion} rows={4} mono />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Primeros auxilios (caso|instrucción)</span>
            <IaBtn {...ia("sds_primeros_auxilios")} />
          </div>
          <Field value={sdsPrimeros} onChange={setSdsPrimeros} rows={4} mono />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted">Manipulación</span>
            <IaBtn {...ia("sds_manipulacion")} />
          </div>
          <Field value={sdsManipulacion} onChange={setSdsManipulacion} rows={2} />
        </div>
      </div>

      {/* ─── Generar ─── */}
      <div className="mt-6 rounded-lg border border-border p-4 space-y-3">
        {error && (
          <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {previewMut.isError && (
          <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{(previewMut.error as Error).message}</p>
        )}
        {resultado && (
          <div className="flex items-center gap-3 rounded bg-surface-alt px-3 py-2">
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
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending || loading}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-40"
          >
            {previewMut.isPending ? "Generando vista previa…" : "Vista previa"}
          </button>
          <button
            type="button"
            onClick={handleGenerar}
            disabled={loading || previewMut.isPending}
            className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Generando documento…" : "Ficha Técnica COA SDS"}
          </button>
        </div>
      </div>

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

export default function FichasTecnicasPanel() {
  const [tab, setTab] = useState<TabDoc>("biblioteca");
  const [producto, setProducto] = useState<ProductoDocumentacion | null>(null);
  const [ftPreload, setFtPreload] = useState<Record<string, unknown> | null>(null);
  const [coaPreload, setCoaPreload] = useState<Record<string, unknown> | null>(null);
  const [sdsPreload, setSdsPreload] = useState<Record<string, unknown> | null>(null);
  const [completoPreload, setCompletoPreload] = useState<Record<string, unknown> | null>(null);

  const abrirGenerador = (p: ProductoDocumentacion) => {
    setProducto(p);
    setTab("completo");
  };

  const handleEditar = (r: BibliotecaDatosResult) => {
    let payload: Record<string, unknown>;
    if (r.tipo === "completo") {
      payload = r.datos;
    } else if (r.tipo === "coa") {
      payload = { titulo: r.titulo, nombre_producto: r.titulo, _coa: r.datos };
    } else if (r.tipo === "sds") {
      payload = { titulo: r.titulo, nombre_producto: r.titulo, _sds: r.datos };
    } else {
      payload = r.datos; // ft — FT data al nivel raíz
    }
    setCompletoPreload(payload);
    setTab("completo");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">Documentos técnicos</h2>
        <p className="mt-1 text-sm text-muted">
          Catálogo de combos SIIGO, estado FT/COA/SDS, vista previa antes de generar y subida a Drive.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "catalogo" && <DocumentosCatalogoTab onGenerar={abrirGenerador} />}
      {tab === "ft" && <FichaTecnicaTabContent producto={producto} preload={ftPreload} />}
      {tab === "coa" && <CoaTabContent producto={producto} preload={coaPreload} />}
      {tab === "sds" && <SdsTabContent producto={producto} preload={sdsPreload} />}
      {tab === "completo" && <DocumentoCompletoTabContent producto={producto} preload={completoPreload} />}
      {tab === "biblioteca" && <BibliotecaTab onEditar={handleEditar} />}
    </div>
  );
}
