import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ProseTextarea } from "../ProseTextarea";

export interface DocDatosItem {
  id: string;
  archivo: string;
  titulo: string;
}

export interface DocLayoutOption {
  id: string;
  nombre: string;
  archivo: string;
  descripcion?: string;
}

export interface DocLayoutOpciones {
  plantillas: DocLayoutOption[];
  cabezotes: DocLayoutOption[];
  plantilla_default_id: string;
  cabezote_default_id: string;
  plantillas_dir?: string;
  cabezotes_dir?: string;
}

export interface DocDriveConfig {
  client_email: string | null;
  creds_ok: boolean;
  impersonate_email: string | null;
  delegacion_configurada: boolean;
  parent_folder_id: string;
  parent_folder_url: string;
  instrucciones: string;
  ayuda_delegacion?: string;
  plantilla_ok: boolean;
  folder_pdf_id?: string | null;
  folder_word_id?: string | null;
  folder_pdf_url?: string | null;
  folder_word_url?: string | null;
  folder_id?: string | null;
  folder_url?: string | null;
}

export interface GenerarDocResult {
  ok: boolean;
  titulo: string;
  docx: string;
  docx_nombre: string;
  pdf?: string;
  pdf_nombre?: string;
  preview_pdf?: string;
  preview_docx?: string;
  drive_uploads?: Array<{
    tipo: string;
    webViewLink?: string;
    error?: string;
    nombre?: string;
  }>;
}

export type ModoEditor = "formulario" | "yaml";

export function filasDesdeTexto(texto: string): [string, string][] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      if (i === -1) return [l, ""] as [string, string];
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
}

export function filasTresDesdeTexto(texto: string): [string, string, string][] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      return [parts[0] || "", parts[1] || "", parts[2] || ""] as [string, string, string];
    });
}

export function textoDesdeFilas(filas: unknown): string {
  if (!Array.isArray(filas)) return "";
  return filas
    .map((f) => {
      if (Array.isArray(f) && f.length >= 2) return `${f[0]}|${f[1]}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function textoDesdeFilasTres(filas: unknown): string {
  if (!Array.isArray(filas)) return "";
  return filas
    .map((f) => {
      if (Array.isArray(f) && f.length >= 3) return `${f[0]}|${f[1]}|${f[2]}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function listaDesdeTexto(texto: string): string[] {
  return texto.split("\n").map((l) => l.trim()).filter(Boolean);
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
      className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] font-medium text-muted hover:text-accent"
    >
      {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

interface DocumentoGeneradorTabProps {
  apiPrefix: string;
  queryKey: string;
  tituloSeccion: string;
  descripcion: string;
  botonGenerar: string;
  carpetaDriveLabel: string;
  children: ReactNode;
  buildDatos: () => Record<string, unknown>;
  loadDatos: (datos: Record<string, unknown>) => void;
  showWordPdfFolders?: boolean;
  showFichaLayout?: boolean;
  showDrive?: boolean;
  showYamlMode?: boolean;
  showGuardarYaml?: boolean;
  showProductoGuardado?: boolean;
  permiteCompletar?: boolean;
  productoRef?: string;
}

export default function DocumentoGeneradorTab({
  apiPrefix,
  queryKey,
  tituloSeccion,
  descripcion,
  botonGenerar,
  carpetaDriveLabel,
  children,
  buildDatos,
  loadDatos,
  showWordPdfFolders = false,
  showFichaLayout = false,
  showDrive = true,
  showYamlMode = true,
  showGuardarYaml = true,
  showProductoGuardado = true,
  permiteCompletar = true,
  productoRef = "",
}: DocumentoGeneradorTabProps) {
  const qc = useQueryClient();
  const cabezoteFileRef = useRef<HTMLInputElement>(null);
  const [cabezotePreview, setCabezotePreview] = useState<{ src: string; nombre: string } | null>(null);
  const [cabezoteConfirmDelete, setCabezoteConfirmDelete] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoEditor>("formulario");
  const [slugSel, setSlugSel] = useState("");
  const [yamlText, setYamlText] = useState("");
  const [plantillaId, setPlantillaId] = useState("default");
  const [cabezoteId, setCabezoteId] = useState("default");
  const [generarPdf, setGenerarPdf] = useState(true);
  const [subirDrive, setSubirDrive] = useState(showDrive);
  const [guardarYaml, setGuardarYaml] = useState(true);
  const [slugYaml, setSlugYaml] = useState("");
  const [ultimo, setUltimo] = useState<GenerarDocResult | null>(null);
  const [fuentesCompletar, setFuentesCompletar] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitulo, setPreviewTitulo] = useState("");

  const { data: config } = useQuery({
    queryKey: [`${queryKey}-config`],
    queryFn: () => api.get<DocDriveConfig>(`${apiPrefix}/config`),
    enabled: showDrive,
  });

  const { data: lista } = useQuery({
    queryKey: [`${queryKey}-datos`],
    queryFn: () => api.get<{ items: DocDatosItem[] }>(`${apiPrefix}/datos`),
  });

  const { data: layoutOpciones } = useQuery({
    queryKey: [`${queryKey}-opciones`],
    queryFn: () => api.get<DocLayoutOpciones>(`${apiPrefix}/opciones`),
    enabled: showFichaLayout,
  });

  useEffect(() => {
    if (!layoutOpciones) return;
    if (!layoutOpciones.plantillas.some((p) => p.id === plantillaId)) {
      setPlantillaId(layoutOpciones.plantilla_default_id);
    }
    if (!layoutOpciones.cabezotes.some((c) => c.id === cabezoteId)) {
      setCabezoteId(layoutOpciones.cabezote_default_id);
    }
  }, [layoutOpciones, plantillaId, cabezoteId]);

  const layoutBody = showFichaLayout
    ? { plantilla_id: plantillaId, cabezote_id: cabezoteId }
    : {};

  useEffect(() => {
    if (!slugSel) return;
    api
      .get<{ datos: Record<string, unknown>; yaml: string }>(`${apiPrefix}/datos/${slugSel}`)
      .then((r) => {
        loadDatos(r.datos);
        setYamlText(r.yaml);
        setSlugYaml(slugSel);
        const d = r.datos as Record<string, unknown>;
        if (showFichaLayout) {
          if (typeof d.plantilla_id === "string" && d.plantilla_id) setPlantillaId(d.plantilla_id);
          if (typeof d.cabezote_id === "string" && d.cabezote_id) setCabezoteId(d.cabezote_id);
        }
      })
      .catch(() => {});
  }, [slugSel, loadDatos, apiPrefix, showFichaLayout]);

  const [cabezoteThumb, setCabezoteThumb] = useState<string | null>(null);
  const [cabezoteUploadError, setCabezoteUploadError] = useState<string | null>(null);
  const [cabezoteDeleteError, setCabezoteDeleteError] = useState<string | null>(null);
  const [cabezoteDeleting, setCabezoteDeleting] = useState<string | null>(null);

  const cabezoteUploadMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("archivo", file);
      const base = file.name.replace(/\.[^.]+$/, "");
      if (base.trim()) fd.append("nombre", base.trim());
      return api.upload<{ ok: boolean; cabezote: DocLayoutOption }>(
        `${apiPrefix}/cabezotes/subir`,
        fd,
      );
    },
    onSuccess: (r) => {
      setCabezoteUploadError(null);
      setCabezoteId(r.cabezote.id);
      void qc.invalidateQueries({ queryKey: [`${queryKey}-opciones`] });
    },
    onError: (err: Error) => setCabezoteUploadError(err.message),
  });

  const handleCabezoteDelete = async (id: string) => {
    if (cabezoteDeleting) return;
    setCabezoteDeleting(id);
    setCabezoteDeleteError(null);
    try {
      const { resolvePanelApiUrl } = await import("../../api/client");
      const { useTicketsAuth } = await import("../../stores/ticketsAuth");
      const { useAuthStore } = await import("../../stores/auth");
      const tickets = useTicketsAuth.getState();
      const token = tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
      const path = `${apiPrefix}/cabezotes/${encodeURIComponent(id)}/eliminar`;
      const url = resolvePanelApiUrl(path, "DELETE");
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      let res = await fetch(url, { method: "DELETE", headers });
      if (res.status === 405) {
        const alt = url.includes("/app/api/")
          ? url.replace("/app/api/", "/api/")
          : url.replace("/api/", "/app/api/");
        res = await fetch(alt, { method: "DELETE", headers });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(String(body.error || body.mensaje || `HTTP ${res.status}`));
      }
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "El servidor no confirmó la eliminación");
      if (cabezoteId === id) setCabezoteId("default");
      void qc.invalidateQueries({ queryKey: [`${queryKey}-opciones`] });
    } catch (err) {
      console.error("[cabezote delete]", err);
      setCabezoteDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setCabezoteDeleting(null);
    }
  };

  useEffect(() => {
    if (!showFichaLayout || !cabezoteId || cabezoteId === "default") {
      setCabezoteThumb(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { resolvePanelApiUrl } = await import("../../api/client");
      const { useTicketsAuth } = await import("../../stores/ticketsAuth");
      const { useAuthStore } = await import("../../stores/auth");
      const tickets = useTicketsAuth.getState();
      const token = tickets.apiToken || tickets.token || useAuthStore.getState().token;
      const path = `${apiPrefix}/cabezotes/${encodeURIComponent(cabezoteId)}/imagen`;
      const url = resolvePanelApiUrl(path, "GET");
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      if (cancelled) return;
      setCabezoteThumb((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [showFichaLayout, cabezoteId, apiPrefix]);

  const plantillaMut = useMutation({
    mutationFn: () => api.get<{ datos: Record<string, unknown>; yaml: string }>(`${apiPrefix}/plantilla`),
    onSuccess: (r) => {
      setSlugSel("");
      loadDatos(r.datos);
      setYamlText(r.yaml);
      setFuentesCompletar(null);
    },
  });

  const completarMut = useMutation({
    mutationFn: () => {
      const datos = buildDatos();
      const titulo = String(datos.titulo || "").trim();
      return api.post<{
        ok: boolean;
        datos: Record<string, unknown>;
        yaml?: string;
        fuentes: {
          pubmed_count: number;
          pubchem: boolean;
          ficha_sheets: boolean;
          referencias: string[];
        };
      }>(
        `${apiPrefix}/completar`,
        { titulo, datos },
        { timeoutMs: 180000 },
      );
    },
    onSuccess: (r) => {
      loadDatos(r.datos);
      if (r.yaml) setYamlText(r.yaml);
      const f = r.fuentes;
      setFuentesCompletar(
        `PubMed: ${f.pubmed_count} · PubChem: ${f.pubchem ? "sí" : "no"} · Ficha Sheets: ${f.ficha_sheets ? "sí" : "no"}`,
      );
    },
  });

  const generarMut = useMutation({
    mutationFn: () => {
      const body =
        modo === "yaml"
          ? {
              yaml: yamlText,
              generar_pdf: generarPdf,
              subir_drive: subirDrive,
              guardar_yaml: guardarYaml,
              slug_yaml: guardarYaml ? slugYaml || slugSel || undefined : undefined,
              producto_ref: productoRef || undefined,
              ...layoutBody,
            }
          : {
              datos: {
                ...buildDatos(),
                ...(showFichaLayout
                  ? { plantilla_id: plantillaId, cabezote_id: cabezoteId }
                  : {}),
              },
              generar_pdf: generarPdf,
              subir_drive: subirDrive,
              guardar_yaml: guardarYaml,
              slug_yaml: guardarYaml ? slugYaml || slugSel || undefined : undefined,
              producto_ref: productoRef || undefined,
              ...layoutBody,
            };
      return api.post<GenerarDocResult>(`${apiPrefix}/generar`, body, { timeoutMs: 180000 });
    },
    onSuccess: (r) => {
      setUltimo(r);
      void qc.invalidateQueries({ queryKey: ["fichas-biblioteca"] });
    },
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const body =
        modo === "yaml"
          ? { yaml: yamlText, generar_pdf: true, ...layoutBody }
          : {
              datos: {
                ...buildDatos(),
                ...(showFichaLayout
                  ? { plantilla_id: plantillaId, cabezote_id: cabezoteId }
                  : {}),
              },
              generar_pdf: true,
              ...layoutBody,
            };
      const r = await api.post<GenerarDocResult>(`${apiPrefix}/preview`, body, { timeoutMs: 180000 });
      const nombre = r.pdf_nombre || r.docx_nombre;
      if (!nombre) throw new Error("El servidor no devolvió archivo para previsualizar");
      const { resolvePanelApiUrl } = await import("../../api/client");
      const { useTicketsAuth } = await import("../../stores/ticketsAuth");
      const { useAuthStore } = await import("../../stores/auth");
      const tickets = useTicketsAuth.getState();
      const token = tickets.apiToken || tickets.token || useAuthStore.getState().token;
      const inline = r.pdf_nombre ? "&inline=1" : "";
      const path = `${apiPrefix}/descargar?archivo=${encodeURIComponent(nombre)}${inline}`;
      const url = resolvePanelApiUrl(path, "GET");
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`No se pudo obtener el PDF (${res.status})`);
      const blob = await res.blob();
      return { titulo: r.titulo, blobUrl: URL.createObjectURL(blob) };
    },
    onSuccess: ({ titulo, blobUrl }) => {
      setPreviewTitulo(titulo);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return blobUrl;
      });
    },
  });

  const descargar = async (nombre: string) => {
    const { resolvePanelApiUrl } = await import("../../api/client");
    const { useTicketsAuth } = await import("../../stores/ticketsAuth");
    const { useAuthStore } = await import("../../stores/auth");
    const tickets = useTicketsAuth.getState();
    const token = tickets.apiToken || tickets.token || useAuthStore.getState().token;
    const path = `${apiPrefix}/descargar?archivo=${encodeURIComponent(nombre)}`;
    const url = resolvePanelApiUrl(path, "GET");
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("No se pudo descargar");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-ink">{tituloSeccion}</h3>
        <p className="mt-1 text-sm text-muted">{descripcion}</p>
      </div>

      {showDrive && config && (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
          <h4 className="text-sm font-medium text-ink">Google Drive — {carpetaDriveLabel}</h4>
          <p className="text-xs text-muted">{config.instrucciones}</p>
          {config.client_email && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2">
              <span className="text-[10px] text-muted shrink-0">Cuenta servicio:</span>
              <code className="text-xs text-ink break-all">{config.client_email}</code>
              <CopyBtn text={config.client_email} />
            </div>
          )}
          {config.delegacion_configurada ? (
            <p className="text-xs text-emerald-600">
              Subida delegada como <strong>{config.impersonate_email}</strong>
            </p>
          ) : (
            <p className="text-xs text-amber-600">
              Falta <code className="text-[11px]">TDS_DRIVE_IMPERSONATE</code> en .env.
            </p>
          )}
          {showWordPdfFolders ? (
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted">Carpeta WORD: </span>
                {config.folder_word_url ? (
                  <a href={config.folder_word_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Abrir
                  </a>
                ) : (
                  <span className="text-amber-600">No detectada</span>
                )}
              </div>
              <div>
                <span className="text-muted">Carpeta PDF: </span>
                {config.folder_pdf_url ? (
                  <a href={config.folder_pdf_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Abrir
                  </a>
                ) : (
                  <span className="text-amber-600">No detectada</span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs">
              <span className="text-muted">Carpeta {carpetaDriveLabel}: </span>
              {config.folder_url ? (
                <a href={config.folder_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Abrir en Drive
                </a>
              ) : (
                <span className="text-amber-600">No detectada</span>
              )}
            </div>
          )}
          {!config.plantilla_ok && (
            <p className="text-xs text-danger">Falta plantilla en el servidor.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
        {showProductoGuardado && (
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-sm text-muted">Producto guardado:</label>
            <select
              value={slugSel}
              onChange={(e) => setSlugSel(e.target.value)}
              className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
            >
              <option value="">— Nuevo —</option>
              {(lista?.items ?? []).map((it) => (
                <option key={it.id} value={it.id}>
                  {it.titulo} ({it.archivo})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => plantillaMut.mutate()}
              disabled={plantillaMut.isPending}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-ink hover:border-accent"
            >
              Plantilla vacía
            </button>
          </div>
        )}

        {showFichaLayout && layoutOpciones && (
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-ink">Cabezote del encabezado</h4>
                <p className="mt-0.5 text-[11px] text-muted">
                  Haz clic en una tarjeta para seleccionarla · La lupa abre vista ampliada
                </p>
              </div>
              <button
                type="button"
                onClick={() => cabezoteFileRef.current?.click()}
                disabled={cabezoteUploadMut.isPending}
                className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
              >
                {cabezoteUploadMut.isPending ? "Subiendo…" : "+ Subir imagen"}
              </button>
            </div>

            {/* Input file oculto */}
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

            {/* Cuadrícula de tarjetas */}
            <div className="flex flex-wrap gap-3">
              {layoutOpciones.cabezotes.map((c) => {
                const imgSrc = `${apiPrefix}/cabezotes/${encodeURIComponent(c.id)}/imagen`;
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
                    className={`group relative w-40 cursor-pointer select-none overflow-hidden rounded-xl border-2 transition-all duration-150 ${
                      selected
                        ? "border-accent shadow-[0_0_0_3px] shadow-accent/20"
                        : "border-border hover:border-accent/60 hover:shadow-sm"
                    }`}
                  >
                    {/* Área de imagen */}
                    {c.id === "default" ? (
                      <div className={`flex h-16 w-full flex-col items-center justify-center gap-1 transition-colors ${selected ? "bg-accent/10 text-accent" : "bg-surface-input text-muted group-hover:bg-accent/5 group-hover:text-accent"}`}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                        </svg>
                        <span className="text-[10px] font-medium">Sin cabezote</span>
                      </div>
                    ) : (
                      <div className="relative h-16 w-full bg-white">
                        <img
                          src={imgSrc}
                          alt={c.nombre}
                          className="h-full w-full object-contain p-2"
                        />
                        {/* Botón lupa — pequeño, esquina superior izquierda, solo en hover */}
                        <button
                          type="button"
                          title="Ver imagen completa"
                          onClick={(e) => { e.stopPropagation(); setCabezotePreview({ src: imgSrc, nombre: c.nombre }); }}
                          className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-ink shadow opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Badge ✓ seleccionado */}
                    {selected && (
                      <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white shadow-sm">
                        ✓
                      </div>
                    )}

                    {/* Barra inferior: nombre + papelera */}
                    <div
                      className="flex h-8 items-center gap-1 border-t border-border/40 bg-surface-panel px-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-[10px] font-medium text-ink"
                        title={c.nombre}
                      >
                        {c.nombre}
                      </span>
                      {c.id !== "default" && !isDeleting && !isConfirming && (
                        <button
                          type="button"
                          title="Eliminar"
                          onClick={(e) => { e.stopPropagation(); setCabezoteConfirmDelete(c.id); setCabezoteDeleteError(null); }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted/50 transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                            <path d="M1 3h9M4 3V2h3v1M1.5 3l.7 6.3a1 1 0 001 .9h3.6a1 1 0 001-.9L8.5 3"/>
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Overlay: confirmar eliminación */}
                    {isConfirming && !isDeleting && (
                      <div
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-panel/95"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-[11px] font-semibold text-ink">¿Eliminar?</p>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setCabezoteConfirmDelete(null); void handleCabezoteDelete(c.id); }}
                            className="rounded-md bg-danger px-3 py-1 text-[10px] font-bold text-white hover:opacity-85"
                          >
                            Sí, eliminar
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setCabezoteConfirmDelete(null); }}
                            className="rounded-md border border-border bg-white px-2.5 py-1 text-[10px] text-ink hover:border-accent"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Overlay: eliminando */}
                    {isDeleting && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-surface-panel/90">
                        <span className="text-[10px] text-muted">Eliminando…</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Vista previa de la imagen seleccionada */}
            {cabezoteId && cabezoteId !== "default" && (() => {
              const cab = layoutOpciones.cabezotes.find(c => c.id === cabezoteId);
              if (!cab) return null;
              const previewSrc = `${apiPrefix}/cabezotes/${encodeURIComponent(cabezoteId)}/imagen`;
              return (
                <div className="flex items-center gap-4 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
                  <img
                    src={previewSrc}
                    alt={cab.nombre}
                    className="h-14 max-w-[200px] rounded-lg object-contain"
                    style={{ background: "white", padding: "6px" }}
                  />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">Seleccionado</p>
                    <p className="mt-0.5 text-sm font-medium text-ink">{cab.nombre}</p>
                    <p className="mt-0.5 text-[10px] text-muted">Aparecerá en la esquina superior del PDF</p>
                  </div>
                </div>
              );
            })()}

            {cabezoteUploadError && (
              <p className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger">{cabezoteUploadError}</p>
            )}
            {cabezoteDeleteError && (
              <p className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger">Error al eliminar: {cabezoteDeleteError}</p>
            )}
          </div>
        )}

        {/* Modal previsualización cabezote */}
        {cabezotePreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
            onClick={() => setCabezotePreview(null)}
            onKeyDown={(e) => e.key === "Escape" && setCabezotePreview(null)}
            tabIndex={-1}
          >
            <div
              className="relative max-w-[85vw] rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wider text-muted">
                {cabezotePreview.nombre}
              </p>
              <img
                src={cabezotePreview.src}
                alt={cabezotePreview.nombre}
                className="max-h-[70vh] max-w-[80vw] rounded-lg object-contain shadow-sm"
              />
              <button
                type="button"
                onClick={() => setCabezotePreview(null)}
                className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-input text-sm text-muted shadow hover:border-accent hover:text-ink"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {showYamlMode ? (
          <div className="flex gap-2 border-b border-border pb-2">
            <button
              type="button"
              onClick={() => setModo("formulario")}
              className={`text-sm font-medium px-2 py-1 ${modo === "formulario" ? "text-accent border-b-2 border-accent" : "text-muted"}`}
            >
              Formulario
            </button>
            <button
              type="button"
              onClick={() => setModo("yaml")}
              className={`text-sm font-medium px-2 py-1 ${modo === "yaml" ? "text-accent border-b-2 border-accent" : "text-muted"}`}
            >
              YAML
            </button>
          </div>
        ) : null}

        {(!showYamlMode || modo === "formulario") ? children : (
          <textarea
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            rows={18}
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs font-mono"
            spellCheck={false}
          />
        )}

        <div className="flex flex-wrap gap-4 text-sm">
          {showDrive && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={subirDrive} onChange={(e) => setSubirDrive(e.target.checked)} />
              Subir a Drive
            </label>
          )}
          {showGuardarYaml && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={guardarYaml} onChange={(e) => setGuardarYaml(e.target.checked)} />
              Guardar YAML en servidor
            </label>
          )}
        </div>
        {guardarYaml && (
          <input
            value={slugYaml}
            onChange={(e) => setSlugYaml(e.target.value)}
            placeholder="Slug archivo datos (ej. arcilla_roja)"
            className="w-full max-w-xs rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
          />
        )}

        {productoRef && (
          <p className="text-xs text-emerald-600">
            Vinculado al producto SIIGO: <code className="font-mono">{productoRef}</code>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending || (showDrive && !config?.plantilla_ok)}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-40"
          >
            {previewMut.isPending ? "Generando vista previa…" : "Vista previa"}
          </button>
          <button
            type="button"
            onClick={() => generarMut.mutate()}
            disabled={generarMut.isPending || (showDrive && !config?.plantilla_ok)}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {generarMut.isPending ? "Generando…" : botonGenerar}
          </button>
        </div>
        {previewMut.isError && (
          <p className="text-sm text-danger">{previewMut.error.message}</p>
        )}
        {permiteCompletar && (
          <button
            type="button"
            onClick={() => completarMut.mutate()}
            disabled={completarMut.isPending}
            className="rounded-lg border border-accent px-5 py-2.5 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {completarMut.isPending ? "Buscando literatura…" : "Completar con literatura científica"}
          </button>
        )}
        {completarMut.isError && (
          <p className="text-sm text-danger">{completarMut.error.message}</p>
        )}
        {fuentesCompletar && (
          <p className="text-xs text-emerald-600">Fuentes usadas: {fuentesCompletar}</p>
        )}
        {generarMut.isError && (
          <p className="text-sm text-danger">{generarMut.error.message}</p>
        )}
      </section>

      {ultimo?.ok && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
          <h4 className="text-sm font-medium text-ink">Generado: {ultimo.titulo}</h4>
          <ul className="text-sm space-y-1">
            {ultimo.pdf_nombre && (
              <li>
                <button type="button" className="text-accent hover:underline" onClick={() => void descargar(ultimo.pdf_nombre!)}>
                  Descargar PDF — {ultimo.pdf_nombre}
                </button>
              </li>
            )}
            {ultimo.docx_nombre && (
              <li>
                <button type="button" className="text-accent hover:underline" onClick={() => void descargar(ultimo.docx_nombre)}>
                  Descargar DOCX — {ultimo.docx_nombre}
                </button>
              </li>
            )}
          </ul>
          {(ultimo.drive_uploads ?? []).map((u) => (
            <div key={u.tipo} className="text-xs">
              Drive {u.tipo}:{" "}
              {u.webViewLink ? (
                <a href={u.webViewLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {u.nombre || "Ver archivo"}
                </a>
              ) : (
                <span className="text-danger">{u.error}</span>
              )}
            </div>
          ))}
        </section>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={(e) => { if (e.target === e.currentTarget) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); } }}>
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-panel px-4 py-2.5 shadow">
              <h4 className="text-sm font-semibold text-ink truncate max-w-xs">Vista previa — {previewTitulo}</h4>
              <div className="flex gap-2 shrink-0">
                <a
                  href={previewUrl}
                  download={`${previewTitulo || "preview"}.pdf`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:border-accent"
                >
                  Descargar PDF
                </a>
                <button
                  type="button"
                  onClick={() => generarMut.mutate()}
                  disabled={generarMut.isPending}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {generarMut.isPending ? "Generando…" : "Generar y subir a Drive"}
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
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  rows = 1,
  placeholder,
  mono,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  const cls = `w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm ${mono ? "font-mono text-xs" : ""}`;
  if (rows > 1) {
    return (
      <div>
        {label && <label className="text-xs text-muted">{label}</label>}
        <ProseTextarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={`mt-1 ${cls}`} />
      </div>
    );
  }
  return (
    <div>
      {label && <label className="text-xs text-muted">{label}</label>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`mt-1 ${cls}`} />
    </div>
  );
}
