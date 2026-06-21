import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import DocumentoGeneradorTab, {
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

type TabDoc = "catalogo" | "ft" | "coa" | "sds" | "biblioteca";

const TABS: { id: TabDoc; label: string }[] = [
  { id: "catalogo", label: "Catálogo productos" },
  { id: "ft", label: "Ficha técnica (TDS)" },
  { id: "coa", label: "COA" },
  { id: "sds", label: "SDS" },
  { id: "biblioteca", label: "📁 Biblioteca" },
];

interface ArchivoGenerado {
  nombre: string;
  tipo: "pdf" | "docx";
  tamano: number;
  fecha: number;
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
  tipo: "ft" | "coa" | "sds";
  titulo: string;
  datos: Record<string, unknown>;
  yaml: string;
  tiene_datos: boolean;
}

function BibliotecaTab({ onEditar }: { onEditar: (r: BibliotecaDatosResult) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "pdf" | "docx">("todos");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNombre, setPreviewNombre] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editandoNombre, setEditandoNombre] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

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
    const q = busqueda.toLowerCase();
    if (q && !a.nombre.toLowerCase().includes(q)) return false;
    if (filtroTipo !== "todos" && a.tipo !== filtroTipo) return false;
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
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(["todos", "pdf", "docx"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltroTipo(t)}
              className={`px-3 py-2 transition-colors ${filtroTipo === t ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              {t === "todos" ? "Todos" : t.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-ink"
        >
          ↻ Actualizar
        </button>
        <span className="text-xs text-muted">{archivos.length} documento{archivos.length !== 1 ? "s" : ""}</span>
      </div>

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
                    <span className="font-medium text-ink">{a.nombre.replace(/\.(pdf|docx)$/i, "")}</span>
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
            className="flex-1 w-full border-0 bg-white"
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

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    loadRef.current(datos);
  }, []);

  const buildDatos = useCallback(() => buildRef.current(), []);

  // Carga datos de preload cuando llegan desde la biblioteca
  useEffect(() => {
    if (preload) loadDatos(preload);
  }, [preload, loadDatos]);

  return (
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
  const [fechaAnalisis, setFechaAnalisis] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [parametros, setParametros] = useState("");
  const [empaque, setEmpaque] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [precauciones, setPrecauciones] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [codigoVerif, setCodigoVerif] = useState("");

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
      presentacion, incluye, loteNum, fab, venc, vidaUtil, tamanoLote, pais, fechaAnalisis,
      fechaEmision, parametros, empaque, almacenamiento, precauciones, observaciones, codigoVerif,
    ],
  );

  return (
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
          <Field label="Grado" value={grado} onChange={setGrado} />
          <Field label="Presentación" value={presentacion} onChange={setPresentacion} />
          <Field label="Incluye" value={incluye} onChange={setIncluye} />
        </div>
        <p className="text-xs font-medium text-muted">Lote</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="No. de lote" value={loteNum} onChange={setLoteNum} />
          <Field label="Fecha fabricación" value={fab} onChange={setFab} placeholder="DD / MM / AAAA" />
          <Field label="Fecha vencimiento" value={venc} onChange={setVenc} />
          <Field label="Vida útil" value={vidaUtil} onChange={setVidaUtil} />
          <Field label="Tamaño del lote" value={tamanoLote} onChange={setTamanoLote} />
          <Field label="País de origen" value={pais} onChange={setPais} />
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
        <Field label="Código verificación (MKG-COA-…)" value={codigoVerif} onChange={setCodigoVerif} />
      </div>
    </DocumentoGeneradorTab>
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
        <Field label="Composición (componente|CAS|conc.)" value={composicion} onChange={setComposicion} rows={4} mono />
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

export default function FichasTecnicasPanel() {
  const [tab, setTab] = useState<TabDoc>("catalogo");
  const [producto, setProducto] = useState<ProductoDocumentacion | null>(null);
  const [ftPreload, setFtPreload] = useState<Record<string, unknown> | null>(null);
  const [coaPreload, setCoaPreload] = useState<Record<string, unknown> | null>(null);
  const [sdsPreload, setSdsPreload] = useState<Record<string, unknown> | null>(null);

  const abrirGenerador = (tipo: "ft" | "coa" | "sds", p: ProductoDocumentacion) => {
    setProducto(p);
    setTab(tipo);
  };

  const handleEditar = (r: BibliotecaDatosResult) => {
    setTab(r.tipo as TabDoc);
    if (r.tipo === "ft") setFtPreload(r.datos);
    else if (r.tipo === "coa") setCoaPreload(r.datos);
    else if (r.tipo === "sds") setSdsPreload(r.datos);
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
      {tab === "biblioteca" && <BibliotecaTab onEditar={handleEditar} />}
    </div>
  );
}
