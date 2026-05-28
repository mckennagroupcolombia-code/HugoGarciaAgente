import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface FichaDatosItem {
  id: string;
  archivo: string;
  titulo: string;
}

interface DriveConfig {
  client_email: string | null;
  creds_ok: boolean;
  impersonate_email: string | null;
  delegacion_configurada: boolean;
  parent_folder_id: string;
  folder_pdf_id: string | null;
  folder_word_id: string | null;
  folder_pdf_url: string | null;
  folder_word_url: string | null;
  parent_folder_url: string;
  instrucciones: string;
  ayuda_delegacion?: string;
  plantilla_ok: boolean;
}

interface GenerarResult {
  ok: boolean;
  titulo: string;
  docx: string;
  docx_nombre: string;
  pdf?: string;
  pdf_nombre?: string;
  drive_uploads?: Array<{
    tipo: string;
    webViewLink?: string;
    error?: string;
    nombre?: string;
  }>;
}

type ModoEditor = "formulario" | "yaml";

function filasDesdeTexto(texto: string): [string, string][] {
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

function textoDesdeFilas(filas: unknown): string {
  if (!Array.isArray(filas)) return "";
  return filas
    .map((f) => {
      if (Array.isArray(f) && f.length >= 2) return `${f[0]}|${f[1]}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function listaDesdeTexto(texto: string): string[] {
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

export default function FichasTecnicasPanel() {
  const [modo, setModo] = useState<ModoEditor>("formulario");
  const [slugSel, setSlugSel] = useState("");
  const [yamlText, setYamlText] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [aplicaciones, setAplicaciones] = useState("");
  const [identidad, setIdentidad] = useState("");
  const [propiedades, setPropiedades] = useState("");
  const [microbiologia, setMicrobiologia] = useState("");
  const [notaMicro, setNotaMicro] = useState("");
  const [estabilidad, setEstabilidad] = useState("");
  const [generarPdf, setGenerarPdf] = useState(true);
  const [subirDrive, setSubirDrive] = useState(true);
  const [guardarYaml, setGuardarYaml] = useState(true);
  const [slugYaml, setSlugYaml] = useState("");
  const [ultimo, setUltimo] = useState<GenerarResult | null>(null);

  const { data: config } = useQuery({
    queryKey: ["fichas-config"],
    queryFn: () => api.get<DriveConfig>("/api/fichas/config"),
  });

  const { data: lista } = useQuery({
    queryKey: ["fichas-datos"],
    queryFn: () => api.get<{ items: FichaDatosItem[] }>("/api/fichas/datos"),
  });

  const cargarDatos = useCallback((datos: Record<string, unknown>, yaml?: string) => {
    setTitulo(String(datos.titulo || ""));
    setDescripcion(String(datos.descripcion || ""));
    setAplicaciones(
      Array.isArray(datos.aplicaciones)
        ? (datos.aplicaciones as string[]).join("\n\n")
        : String(datos.aplicaciones || ""),
    );
    setIdentidad(textoDesdeFilas(datos.identidad));
    setPropiedades(textoDesdeFilas(datos.propiedades));
    setMicrobiologia(textoDesdeFilas(datos.microbiologia));
    setNotaMicro(String(datos.nota_micro || ""));
    setEstabilidad(
      Array.isArray(datos.estabilidad)
        ? (datos.estabilidad as string[]).join("\n\n")
        : String(datos.estabilidad || ""),
    );
    if (yaml) setYamlText(yaml);
  }, []);

  useEffect(() => {
    if (!slugSel) return;
    api
      .get<{ datos: Record<string, unknown>; yaml: string }>(`/api/fichas/datos/${slugSel}`)
      .then((r) => {
        cargarDatos(r.datos, r.yaml);
        setSlugYaml(slugSel);
      })
      .catch(() => {});
  }, [slugSel, cargarDatos]);

  const plantillaMut = useMutation({
    mutationFn: () => api.get<{ datos: Record<string, unknown>; yaml: string }>("/api/fichas/plantilla"),
    onSuccess: (r) => {
      setSlugSel("");
      cargarDatos(r.datos, r.yaml);
    },
  });

  const generarMut = useMutation({
    mutationFn: () => {
      if (modo === "yaml") {
        return api.post<GenerarResult>(
          "/api/fichas/generar",
          {
            yaml: yamlText,
            generar_pdf: generarPdf,
            subir_drive: subirDrive,
            guardar_yaml: guardarYaml,
            slug_yaml: guardarYaml ? slugYaml || slugSel || undefined : undefined,
          },
          { timeoutMs: 180000 },
        );
      }
      return api.post<GenerarResult>(
        "/api/fichas/generar",
        {
        datos: {
          titulo,
          descripcion,
          aplicaciones: listaDesdeTexto(aplicaciones),
          identidad: filasDesdeTexto(identidad),
          propiedades: filasDesdeTexto(propiedades),
          microbiologia: filasDesdeTexto(microbiologia),
          nota_micro: notaMicro,
          estabilidad: listaDesdeTexto(estabilidad),
        },
        generar_pdf: generarPdf,
        subir_drive: subirDrive,
        guardar_yaml: guardarYaml,
        slug_yaml: guardarYaml ? slugYaml || slugSel || undefined : undefined,
        },
        { timeoutMs: 180000 },
      );
    },
    onSuccess: (r) => setUltimo(r),
  });

  const descargar = async (nombre: string) => {
    const { resolvePanelApiUrl } = await import("../api/client");
    const { useTicketsAuth } = await import("../stores/ticketsAuth");
    const { useAuthStore } = await import("../stores/auth");
    const tickets = useTicketsAuth.getState();
    const token = tickets.apiToken || tickets.token || useAuthStore.getState().token;
    const path = `/api/fichas/descargar?archivo=${encodeURIComponent(nombre)}`;
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
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">Fichas técnicas</h2>
        <p className="mt-1 text-sm text-muted">
          Genera DOCX y PDF con el formato McKenna y súbelos a Drive (carpetas WORD y PDF).
        </p>
      </div>

      {config && (
        <section className="rounded-xl border border-border bg-surface-panel p-5 space-y-3">
          <h3 className="text-sm font-medium text-ink">Google Drive — cuenta de servicio</h3>
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
              Falta <code className="text-[11px]">TDS_DRIVE_IMPERSONATE</code> en .env (correo @mckennagroup.co
              dueño de las carpetas). Sin eso Google rechaza la subida aunque la carpeta esté compartida.
            </p>
          )}
          {config.ayuda_delegacion && !config.delegacion_configurada && (
            <p className="text-[11px] text-muted">{config.ayuda_delegacion}</p>
          )}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <span className="text-muted">Carpeta WORD: </span>
              {config.folder_word_url ? (
                <a href={config.folder_word_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Abrir
                </a>
              ) : (
                <span className="text-amber-600">No detectada (crear subcarpeta WORD)</span>
              )}
            </div>
            <div>
              <span className="text-muted">Carpeta PDF: </span>
              {config.folder_pdf_url ? (
                <a href={config.folder_pdf_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Abrir
                </a>
              ) : (
                <span className="text-amber-600">No detectada (crear subcarpeta PDF)</span>
              )}
            </div>
          </div>
          {!config.plantilla_ok && (
            <p className="text-xs text-danger">Falta plantilla DOCX en el servidor (FT CAOLIN COLOIDAL.docx).</p>
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

        {modo === "formulario" ? (
          <div className="space-y-3">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Título (ej. ARCILLA ROJA)"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
            />
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={4}
              placeholder="Descripción"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
            />
            <textarea
              value={aplicaciones}
              onChange={(e) => setAplicaciones(e.target.value)}
              rows={4}
              placeholder="Aplicaciones (un párrafo por línea)"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs text-muted">Identidad (campo|valor por línea)</label>
                <textarea value={identidad} onChange={(e) => setIdentidad(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted">Propiedades</label>
                <textarea value={propiedades} onChange={(e) => setPropiedades(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted">Microbiología</label>
                <textarea value={microbiologia} onChange={(e) => setMicrobiologia(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-xs font-mono" />
              </div>
            </div>
            <input
              value={notaMicro}
              onChange={(e) => setNotaMicro(e.target.value)}
              placeholder="Nota microbiológica"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
            />
            <textarea
              value={estabilidad}
              onChange={(e) => setEstabilidad(e.target.value)}
              rows={2}
              placeholder="Estabilidad y almacenamiento"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
            />
          </div>
        ) : (
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

        <button
          type="button"
          onClick={() => generarMut.mutate()}
          disabled={generarMut.isPending || !config?.plantilla_ok}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {generarMut.isPending ? "Generando…" : "Generar ficha técnica"}
        </button>
        {generarMut.isError && (
          <p className="text-sm text-danger">{generarMut.error.message}</p>
        )}
      </section>

      {ultimo?.ok && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
          <h3 className="text-sm font-medium text-ink">Generado: {ultimo.titulo}</h3>
          <ul className="text-sm space-y-1">
            <li>
              Word:{" "}
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => void descargar(ultimo.docx_nombre)}
              >
                {ultimo.docx_nombre}
              </button>
            </li>
            {ultimo.pdf_nombre && (
              <li>
                PDF:{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => void descargar(ultimo.pdf_nombre!)}
                >
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
    </div>
  );
}
