import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ProseTextarea } from "../ProseTextarea";

export interface DocDatosItem {
  id: string;
  archivo: string;
  titulo: string;
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
  permiteCompletar = true,
  productoRef = "",
}: DocumentoGeneradorTabProps) {
  const [modo, setModo] = useState<ModoEditor>("formulario");
  const [slugSel, setSlugSel] = useState("");
  const [yamlText, setYamlText] = useState("");
  const [generarPdf, setGenerarPdf] = useState(true);
  const [subirDrive, setSubirDrive] = useState(true);
  const [guardarYaml, setGuardarYaml] = useState(true);
  const [slugYaml, setSlugYaml] = useState("");
  const [ultimo, setUltimo] = useState<GenerarDocResult | null>(null);
  const [fuentesCompletar, setFuentesCompletar] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitulo, setPreviewTitulo] = useState("");

  const { data: config } = useQuery({
    queryKey: [`${queryKey}-config`],
    queryFn: () => api.get<DocDriveConfig>(`${apiPrefix}/config`),
  });

  const { data: lista } = useQuery({
    queryKey: [`${queryKey}-datos`],
    queryFn: () => api.get<{ items: DocDatosItem[] }>(`${apiPrefix}/datos`),
  });

  useEffect(() => {
    if (!slugSel) return;
    api
      .get<{ datos: Record<string, unknown>; yaml: string }>(`${apiPrefix}/datos/${slugSel}`)
      .then((r) => {
        loadDatos(r.datos);
        setYamlText(r.yaml);
        setSlugYaml(slugSel);
      })
      .catch(() => {});
  }, [slugSel, loadDatos, apiPrefix]);

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
            }
          : {
              datos: buildDatos(),
              generar_pdf: generarPdf,
              subir_drive: subirDrive,
              guardar_yaml: guardarYaml,
              slug_yaml: guardarYaml ? slugYaml || slugSel || undefined : undefined,
              producto_ref: productoRef || undefined,
            };
      return api.post<GenerarDocResult>(`${apiPrefix}/generar`, body, { timeoutMs: 180000 });
    },
    onSuccess: (r) => setUltimo(r),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const body =
        modo === "yaml"
          ? { yaml: yamlText, generar_pdf: true }
          : { datos: buildDatos(), generar_pdf: true };
      return api.post<GenerarDocResult>(`${apiPrefix}/preview`, body, { timeoutMs: 180000 });
    },
    onSuccess: async (r) => {
      setPreviewTitulo(r.titulo);
      const nombre = r.pdf_nombre || r.docx_nombre;
      if (!nombre) return;
      const { resolvePanelApiUrl } = await import("../../api/client");
      const { useTicketsAuth } = await import("../../stores/ticketsAuth");
      const { useAuthStore } = await import("../../stores/auth");
      const tickets = useTicketsAuth.getState();
      const token = tickets.apiToken || tickets.token || useAuthStore.getState().token;
      const inline = r.pdf_nombre ? "&inline=1" : "";
      const path = `${apiPrefix}/descargar?archivo=${encodeURIComponent(nombre)}${inline}`;
      const url = resolvePanelApiUrl(path, "GET");
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("No se pudo cargar la vista previa");
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
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

      {config && (
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
            <p className="text-xs text-danger">Falta plantilla DOCX en el servidor.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-4">
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

        {modo === "formulario" ? children : (
          <textarea
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            rows={18}
            className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs font-mono"
            spellCheck={false}
          />
        )}

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={generarPdf} onChange={(e) => setGenerarPdf(e.target.checked)} />
            Generar PDF
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={subirDrive} onChange={(e) => setSubirDrive(e.target.checked)} />
            Subir a Drive
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={guardarYaml} onChange={(e) => setGuardarYaml(e.target.checked)} />
            Guardar YAML en servidor
          </label>
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
            disabled={previewMut.isPending || !config?.plantilla_ok}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-ink hover:border-accent disabled:opacity-40"
          >
            {previewMut.isPending ? "Generando vista previa…" : "Vista previa"}
          </button>
          <button
            type="button"
            onClick={() => generarMut.mutate()}
            disabled={generarMut.isPending || !config?.plantilla_ok}
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
            <li>
              Word:{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => void descargar(ultimo.docx_nombre)}>
                {ultimo.docx_nombre}
              </button>
            </li>
            {ultimo.pdf_nombre && (
              <li>
                PDF:{" "}
                <button type="button" className="text-accent hover:underline" onClick={() => void descargar(ultimo.pdf_nombre!)}>
                  {ultimo.pdf_nombre}
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
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60 p-4">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col rounded-xl border border-border bg-surface-panel shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h4 className="text-sm font-medium text-ink">Vista previa — {previewTitulo}</h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => generarMut.mutate()}
                  disabled={generarMut.isPending}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
                >
                  Generar y subir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
                >
                  Cerrar
                </button>
              </div>
            </div>
            <iframe title="Vista previa documento" src={previewUrl} className="flex-1 w-full bg-white min-h-[70vh]" />
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
