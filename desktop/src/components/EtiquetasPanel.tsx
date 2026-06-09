import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { ProseTextarea } from "./ProseTextarea";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PdfItem {
  nombre: string;
  ruta: string;
  ruta_completa: string;
}

interface PrintResult {
  ok: boolean;
  log: string[];
  error?: string;
}

interface ImpResp {
  impresora: string;
  estado: string;
}

interface DiagCheck {
  nombre: string;
  ok: boolean;
  detalle: string;
}

interface DiagResp {
  checks: DiagCheck[];
  todo_ok: boolean;
  usb_detectado: string | null;
}

interface InstalResp {
  ok: boolean;
  log: string[];
  errores: string[];
}

interface PreviewResp {
  imagen: string;
  mime: string;
  error?: string;
}

interface DiscoItem {
  nombre: string;
  ruta: string;
  icono?: "home" | "disco" | "usb" | "sistema";
}

interface NavResp {
  ruta_actual: string;
  padre: string | null;
  modo_raiz?: boolean;
  discos?: DiscoItem[];
  carpetas: string[];
  pdfs: { nombre: string; ruta_completa: string; tamano_kb: number }[];
}

function iconoDisco(icono?: DiscoItem["icono"]): string {
  switch (icono) {
    case "home": return "🏠";
    case "usb": return "💾";
    case "sistema": return "🖥️";
    default: return "💿";
  }
}

interface ComboSiigo {
  code: string;
  name: string;
  precio_lista: number;
}

interface SpanPDF {
  id: string;
  pagina: number;
  texto_original: string;
  texto_editado: string;
  origin_x: number;
  origin_y: number;
  bbox: [number, number, number, number];
  font_name: string;
  font_file: string | null;
  font_size: number;
  color_hex: string;
  color_int: number;
  flags: number;
}

interface CampoTexto {
  id: string;
  etiqueta: string;
  texto: string;
  x_pct: number;
  y_pct: number;
  font_size: number;
  bold: boolean;
  align: "left" | "center" | "right";
  fondo_blanco: boolean;
  color: string;
}

interface DatosEtiqueta {
  siigo_code?: string;
  siigo_name?: string;
  nombre_etiqueta?: string;
  presentacion?: string;
  pdf_ruta?: string;
  pdf_nombre?: string;
  lote_defecto?: string;
  vencimiento_defecto?: string;
  tipo_etiqueta?: string;
  forma?: string;
  calidad?: string;
  rotacion?: string;
  lote_pos?: string;
  lote_font?: number;
  campos_texto?: CampoTexto[];
  updated_at?: string;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ETIQUETAS_LISTA = [
  "30 mL", "5 mL", "125 g", "250 g", "1 Lt",
  "100 g", "Lactato", "Circular", "Circular 70", "5 g", "54mm",
];

/** Rotación por defecto al elegir formato (PDF apaisado → rollo estrecho). */
const ETIQUETAS_ROTACION_DEFAULT: Record<string, string> = {
  Lactato: "90",
};

function rotacionDefaultEtiqueta(tipo: string): string {
  return ETIQUETAS_ROTACION_DEFAULT[tipo] ?? "0";
}

/** Solo 0° y 90° están disponibles en el panel. */
function rotacionValida(r: string | undefined): string {
  return r === "90" ? "90" : "0";
}

const LOTE_PREFIJO = "LOT.";
const EXP_PREFIJO = "EXP.";

function conPrefijoLote(val: string | undefined): string {
  const v = (val ?? "").trim();
  if (!v) return LOTE_PREFIJO;
  if (v.toUpperCase().startsWith(LOTE_PREFIJO)) return v;
  if (v.toUpperCase().startsWith("LOT")) return LOTE_PREFIJO + v.slice(3).replace(/^[.\s]+/, "");
  return LOTE_PREFIJO + v;
}

function conPrefijoExp(val: string | undefined): string {
  const v = (val ?? "").trim();
  if (!v) return EXP_PREFIJO;
  if (v.toUpperCase().startsWith(EXP_PREFIJO)) return v;
  if (v.toUpperCase().startsWith("EXP")) return EXP_PREFIJO + v.slice(3).replace(/^[.\s]+/, "");
  return EXP_PREFIJO + v;
}

function editarConPrefijo(valor: string, prefijo: string): string {
  const upper = valor.toUpperCase();
  const prefUpper = prefijo.toUpperCase();
  if (!upper.startsWith(prefUpper)) {
    const stripped = valor.replace(new RegExp(`^${prefijo.replace(".", "\\.")}`, "i"), "");
    return prefijo + stripped;
  }
  if (valor.length < prefijo.length) return prefijo;
  return valor;
}

function loteParaEtiqueta(val: string): string | undefined {
  const v = val.trim();
  if (!v || v === LOTE_PREFIJO) return undefined;
  return v;
}

function expParaEtiqueta(val: string): string | undefined {
  const v = val.trim();
  if (!v || v === EXP_PREFIJO) return undefined;
  return v;
}

const FORMAS = [
  { label: "Troquelada — separación (gap)", value: "Diecut_Gap" },
  { label: "Troquelada — marca negra", value: "Diecut_Blackmark" },
  { label: "Continua — sin detección", value: "Contlabel_no_detection" },
];

const CALIDADES = [
  { label: "Máxima velocidad (Borrador)", value: "MaxSpeed" },
  { label: "Rápida", value: "Speed" },
  { label: "Normal", value: "Normal" },
  { label: "Alta calidad", value: "Quality" },
  { label: "Máxima calidad (Fotos / Logos)", value: "MaxQuality" },
];

const ROTACIONES = ["0", "90"];

const POSICIONES = [
  { value: "bottom-left",  label: "↙ Inf. Izq." },
  { value: "bottom-right", label: "↘ Inf. Der." },
  { value: "top-left",     label: "↖ Sup. Izq." },
  { value: "top-right",    label: "↗ Sup. Der." },
];

// ── Navegador de archivos ─────────────────────────────────────────────────────

function NavegadorArchivos({
  onSeleccionar,
  onCerrar,
}: {
  onSeleccionar: (item: { nombre: string; ruta_completa: string }) => void;
  onCerrar: () => void;
}) {
  const [rutaActual, setRutaActual] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["nav-archivos", rutaActual ?? "__raiz__"],
    queryFn: () =>
      api.get<NavResp>(
        `/api/etiquetas/navegar?ruta=${encodeURIComponent(rutaActual ?? "__raiz__")}`,
      ),
  });

  const pdfsVisibles = (data?.pdfs ?? []).filter(
    (p) => !busqueda.trim() || p.nombre.toLowerCase().includes(busqueda.toLowerCase()),
  );

  function irA(ruta: string | null) {
    setBusqueda("");
    setRutaActual(ruta);
  }

  const breadcrumb: { nombre: string; ruta: string }[] = [];
  if (data?.ruta_actual) {
    const partes = data.ruta_actual.split("/").filter(Boolean);
    let acum = "";
    for (const p of partes) {
      acum += "/" + p;
      breadcrumb.push({ nombre: p, ruta: acum });
    }
  }

  const discos = data?.discos ?? [];
  const enRaiz = !!data?.modo_raiz;
  const apiSinDiscos =
    !isLoading && !error && !enRaiz && rutaActual === null && !!data?.ruta_actual;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex h-[80vh] w-full max-w-xl flex-col rounded-2xl border-2 border-border bg-surface-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-ink">Explorar archivos PDF</h3>
            <p className="text-xs text-muted">{enRaiz ? "Selecciona un disco o ubicación" : data?.ruta_actual}</p>
          </div>
          <button onClick={onCerrar} className="rounded p-1 text-muted hover:text-ink">✕</button>
        </div>

        {(enRaiz || data?.ruta_actual) && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 flex-shrink-0 text-xs">
            {data?.padre != null && (
              <button
                onClick={() => irA(data.padre === "__raiz__" ? null : data.padre)}
                className="mr-1 rounded px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-ink"
              >
                ←
              </button>
            )}
            {!enRaiz && (
              <button
                onClick={() => irA(null)}
                className="mr-1 rounded px-1.5 py-0.5 font-semibold text-accent hover:bg-surface-hover"
              >
                💿 Este equipo
              </button>
            )}
            {enRaiz ? (
              <span className="rounded px-1.5 py-0.5 font-semibold text-ink">Discos y ubicaciones</span>
            ) : (
              breadcrumb.map((b, i) => (
                <span key={b.ruta} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted">/</span>}
                  <button
                    onClick={() => irA(b.ruta)}
                    className={`rounded px-1.5 py-0.5 transition hover:bg-surface-hover ${
                      i === breadcrumb.length - 1 ? "font-semibold text-ink" : "text-muted"
                    }`}
                  >
                    {b.nombre}
                  </button>
                </span>
              ))
            )}
          </div>
        )}

        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar PDF en esta carpeta..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {apiSinDiscos && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
              El servidor aún no tiene la vista de discos. Reinicia el servicio:{" "}
              <code className="font-mono">sudo systemctl restart agente-pro</code>
              {" "}y recarga el panel (Ctrl+Shift+R).
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Cargando...
            </div>
          )}
          {error && <p className="py-4 text-center text-sm text-red-500">Error al leer directorio</p>}

          {!busqueda && enRaiz && discos.map((d) => (
            <button
              key={d.ruta}
              onClick={() => irA(d.ruta)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">{iconoDisco(d.icono)}</span>
              <span className="font-medium text-ink">{d.nombre}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).map((c) => (
            <button
              key={c}
              onClick={() => irA(`${data!.ruta_actual}/${c}`)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">📁</span>
              <span className="font-medium text-ink">{c}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).length > 0 && pdfsVisibles.length > 0 && (
            <div className="my-2 border-t border-border" />
          )}

          {!enRaiz && pdfsVisibles.map((p) => (
            <button
              key={p.ruta_completa}
              onClick={() => onSeleccionar({ nombre: p.nombre, ruta_completa: p.ruta_completa })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-accent hover:text-white"
            >
              <span className="text-base">📄</span>
              <span className="flex-1 font-medium">{p.nombre}</span>
              <span className="text-xs opacity-60">{p.tamano_kb} KB</span>
            </button>
          ))}

          {!isLoading && !enRaiz && pdfsVisibles.length === 0 && (data?.carpetas ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin archivos PDF aquí</p>
          )}
          {!isLoading && enRaiz && discos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">No se detectaron discos montados</p>
          )}
          {!isLoading && busqueda && pdfsVisibles.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin resultados para "{busqueda}"</p>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 flex-shrink-0">
          <button
            onClick={onCerrar}
            className="w-full rounded-lg border-2 border-border py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-hover"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Wizard instalación ────────────────────────────────────────────────────────

function InstaladorWizard({ onCerrar }: { onCerrar: () => void }) {
  const [instalLog, setInstalLog] = useState<string[]>([]);
  const [instalDone, setInstalDone] = useState(false);

  const { data: diagData, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: ["etiquetas-diagnostico"],
    queryFn: () => api.get<DiagResp>("/api/etiquetas/diagnostico"),
  });

  const instalarMut = useMutation({
    mutationFn: () => api.post<InstalResp>("/api/etiquetas/instalar", {}),
    onSuccess: (data) => { setInstalLog(data.log ?? []); setInstalDone(true); refetchDiag(); },
    onError: (err) => { setInstalLog([`Error: ${err.message}`]); setInstalDone(true); },
  });

  const todoOk = diagData?.todo_ok ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl border-2 border-border bg-surface-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">Instalación de impresora</h3>
            <p className="text-xs text-muted">Epson ColorWorks CW-C4000u</p>
          </div>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Diagnóstico del sistema</p>
            {diagLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block" />
                Verificando componentes...
              </div>
            ) : (
              <div className="space-y-1.5">
                {diagData?.checks.map((c) => (
                  <div key={c.nombre} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                    <span className="mt-0.5 text-base leading-none">{c.ok ? "✅" : "❌"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink">{c.nombre}</p>
                      {c.detalle && <p className="truncate text-[10px] text-muted">{c.detalle}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {diagData?.usb_detectado && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
              Impresora USB detectada: <span className="font-mono">{diagData.usb_detectado}</span>
            </div>
          )}

          {instalLog.length > 0 && (
            <div className="rounded-lg border border-border bg-surface">
              <p className="border-b border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Log de instalación</p>
              <div className="max-h-40 overflow-y-auto p-3 font-mono text-[11px] text-ink space-y-0.5">
                {instalLog.map((l, i) => (
                  <div key={i} className={l.startsWith("✗") || l.startsWith("⚠") ? "text-orange-600" : ""}>{l}</div>
                ))}
              </div>
            </div>
          )}

          {todoOk && !instalarMut.isPending && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm font-semibold text-green-700 text-center">
              ✅ Todo está correctamente instalado
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button onClick={onCerrar} className="flex-1 rounded-lg border-2 border-border py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-hover">
            {instalDone || todoOk ? "Cerrar" : "Cancelar"}
          </button>
          {!todoOk && (
            <button
              onClick={() => { setInstalLog([]); setInstalDone(false); instalarMut.mutate(); }}
              disabled={instalarMut.isPending || diagLoading}
              className="flex-1 rounded-lg border-2 border-accent bg-accent py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] transition hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40"
            >
              {instalarMut.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Instalando...
                </span>
              ) : "Instalar automáticamente"}
            </button>
          )}
          {todoOk && (
            <button onClick={() => refetchDiag()} className="flex-1 rounded-lg border-2 border-border py-2.5 text-sm font-semibold text-ink hover:bg-surface-hover">
              Actualizar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hook debounce ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ── Tab: edición directa de texto dentro del PDF ──────────────────────────────

interface EditarPDFTabProps {
  rutaPdf: string;
  onGuardado: (nuevaRuta: string, nuevoNombre: string) => void;
}

function EditarPDFTab({ rutaPdf, onGuardado }: EditarPDFTabProps) {
  const [spans, setSpans] = useState<SpanPDF[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [guardandoModo, setGuardandoModo] = useState<"original" | "nuevo">("nuevo");
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const { isLoading, error, refetch } = useQuery({
    queryKey: ["extraer-texto-pdf", rutaPdf],
    queryFn: async () => {
      const data = await api.get<{ spans: SpanPDF[]; total: number }>(
        `/api/etiquetas/extraer-texto?ruta_pdf=${encodeURIComponent(rutaPdf)}`,
      );
      setSpans(data.spans);
      return data;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; ruta: string; nombre: string; cambios: number }>(
        "/api/etiquetas/guardar-pdf-editado",
        { ruta_pdf: rutaPdf, spans, modo: guardandoModo },
      ),
    onSuccess: (res) => {
      setResultado({ ok: true, msg: `✅ Guardado: ${res.nombre} (${res.cambios} cambio${res.cambios !== 1 ? "s" : ""})` });
      onGuardado(res.ruta, res.nombre);
      refetch();
    },
    onError: (err) => {
      setResultado({ ok: false, msg: `❌ ${err.message}` });
    },
  });

  const cambiosCount = spans.filter((s) => s.texto_editado !== s.texto_original).length;

  function updateSpan(id: string, texto: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: texto } : s)));
    setResultado(null);
  }

  function resetSpan(id: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: s.texto_original } : s)));
  }

  function resetTodo() {
    setSpans((prev) => prev.map((s) => ({ ...s, texto_editado: s.texto_original })));
    setResultado(null);
  }

  const spansFiltrados = spans.filter(
    (s) => !busqueda || s.texto_original.toLowerCase().includes(busqueda.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-xs">Extrayendo texto del PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
        Error al leer el PDF: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barra superior */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar texto en la etiqueta..."
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent placeholder:text-muted/50"
        />
        {cambiosCount > 0 && (
          <button onClick={resetTodo} className="text-xs text-muted hover:text-danger whitespace-nowrap">
            Revertir todo
          </button>
        )}
        <span className="text-[10px] text-muted whitespace-nowrap">{spans.length} textos</span>
      </div>

      {/* Lista de spans */}
      <div className="max-h-[340px] overflow-y-auto space-y-1 pr-1">
        {spansFiltrados.map((span) => {
          const modificado = span.texto_editado !== span.texto_original;
          return (
            <div
              key={span.id}
              className={`rounded-lg border px-3 py-2 transition ${
                modificado ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Badge de fuente + tamaño */}
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-hover text-muted">
                      {span.font_name.split("-").slice(-1)[0] || span.font_name}
                    </span>
                    <span className="text-[9px] text-muted">{span.font_size.toFixed(1)}pt</span>
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                      style={{ backgroundColor: span.color_hex }}
                      title={span.color_hex}
                    />
                    {!span.font_file && (
                      <span className="text-[9px] text-orange-500" title="Fuente no encontrada en el sistema — se usará Helvetica">⚠ fuente approx.</span>
                    )}
                  </div>
                  <ProseTextarea
                    value={span.texto_editado}
                    onChange={(e) => updateSpan(span.id, e.target.value)}
                    rows={span.texto_editado.split("\n").length}
                    className="w-full rounded border border-border bg-white px-2 py-1 text-xs text-ink outline-none focus:border-accent resize-none font-mono leading-relaxed"
                    style={{ minHeight: "28px" }}
                  />
                  {modificado && (
                    <p className="mt-0.5 text-[9px] text-muted line-through opacity-60 truncate">
                      Original: {span.texto_original}
                    </p>
                  )}
                </div>
                {modificado && (
                  <button
                    onClick={() => resetSpan(span.id)}
                    className="mt-5 flex-shrink-0 text-[10px] text-muted hover:text-danger"
                    title="Revertir este campo"
                  >
                    ↩
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {spansFiltrados.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "Sin texto extraído"}
          </p>
        )}
      </div>

      {/* Resultado y botón guardar */}
      {resultado && (
        <p className={`rounded-lg px-3 py-2 text-xs font-medium ${resultado.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {resultado.msg}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <div className="flex gap-1 flex-shrink-0">
          {(["nuevo", "original"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setGuardandoModo(m)}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                guardandoModo === m
                  ? "border-accent bg-accent text-white"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {m === "nuevo" ? "Guardar como copia" : "Sobreescribir original"}
            </button>
          ))}
        </div>
        <button
          onClick={() => guardarMut.mutate()}
          disabled={cambiosCount === 0 || guardarMut.isPending}
          className="flex-1 rounded-lg border-2 border-accent bg-accent py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40 transition"
        >
          {guardarMut.isPending
            ? "Guardando..."
            : cambiosCount === 0
            ? "Sin cambios"
            : `Guardar ${cambiosCount} cambio${cambiosCount !== 1 ? "s" : ""} en PDF`}
        </button>
      </div>
    </div>
  );
}

// ── Editor de datos de etiqueta ───────────────────────────────────────────────

function nuevoCampo(): CampoTexto {
  return {
    id: Math.random().toString(36).slice(2, 9),
    etiqueta: "Campo nuevo",
    texto: "",
    x_pct: 5,
    y_pct: 10,
    font_size: 8,
    bold: false,
    align: "left",
    fondo_blanco: true,
    color: "#000000",
  };
}

interface EditorProps {
  combo: ComboSiigo;
  datosIniciales: DatosEtiqueta;
  onGuardado: (datos: DatosEtiqueta) => void;
  onImprimir: (datos: DatosEtiqueta) => void;
  onCerrar: () => void;
}

function EditorEtiqueta({ combo, datosIniciales, onGuardado, onImprimir, onCerrar }: EditorProps) {
  const qc = useQueryClient();
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [tabEditor, setTabEditor] = useState<"config" | "texto" | "editar-pdf">("config");
  const [campoExpandido, setCampoExpandido] = useState<string | null>(null);

  const [form, setForm] = useState<DatosEtiqueta>({
    siigo_code: combo.code,
    siigo_name: combo.name,
    nombre_etiqueta: datosIniciales.nombre_etiqueta ?? combo.name,
    presentacion: datosIniciales.presentacion ?? "",
    pdf_ruta: datosIniciales.pdf_ruta ?? "",
    pdf_nombre: datosIniciales.pdf_nombre ?? "",
    lote_defecto: conPrefijoLote(datosIniciales.lote_defecto),
    vencimiento_defecto: conPrefijoExp(datosIniciales.vencimiento_defecto),
    tipo_etiqueta: datosIniciales.tipo_etiqueta ?? ETIQUETAS_LISTA[0],
    forma: datosIniciales.forma ?? "Diecut_Gap",
    calidad: datosIniciales.calidad ?? "Normal",
    rotacion: rotacionValida(datosIniciales.rotacion),
    lote_pos: datosIniciales.lote_pos ?? "bottom-left",
    lote_font: datosIniciales.lote_font ?? 7,
    campos_texto: datosIniciales.campos_texto ?? [],
  });

  const set = (k: keyof DatosEtiqueta, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Debounce de campos_texto para el preview
  const camposDebounced = useDebounce(form.campos_texto, 700);
  const loteDebounced = useDebounce(form.lote_defecto, 600);
  const vencDebounced = useDebounce(form.vencimiento_defecto, 600);

  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["editor-preview", form.pdf_ruta, camposDebounced, loteDebounced, vencDebounced, form.lote_pos, form.lote_font],
    queryFn: () =>
      api.post<{ imagen: string; mime: string; error?: string }>("/api/etiquetas/preview", {
        ruta_pdf: form.pdf_ruta,
        campos_texto: camposDebounced,
        lote: loteParaEtiqueta(loteDebounced),
        vencimiento: expParaEtiqueta(vencDebounced),
        lote_pos: form.lote_pos,
        lote_font: form.lote_font,
      }),
    enabled: !!form.pdf_ruta,
    staleTime: 0,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; datos: DatosEtiqueta }>(`/api/etiquetas/datos/${combo.code}`, form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["etiquetas-datos"] });
      onGuardado(res.datos);
    },
  });

  // ── Helpers campos de texto ───────────────────────────────────────────────

  function agregarCampo() {
    const c = nuevoCampo();
    set("campos_texto", [...(form.campos_texto ?? []), c]);
    setCampoExpandido(c.id);
  }

  function eliminarCampo(id: string) {
    set("campos_texto", (form.campos_texto ?? []).filter((c) => c.id !== id));
    if (campoExpandido === id) setCampoExpandido(null);
  }

  function actualizarCampo(id: string, patch: Partial<CampoTexto>) {
    set(
      "campos_texto",
      (form.campos_texto ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function moverCampo(id: string, dir: -1 | 1) {
    const arr = [...(form.campos_texto ?? [])];
    const idx = arr.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    set("campos_texto", arr);
  }

  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";
  const sel = inp;
  const tabCls = (t: "config" | "texto" | "editar-pdf") =>
    `flex-1 rounded-md py-1.5 text-xs font-semibold transition ${tabEditor === t ? "bg-accent text-white" : "text-muted hover:text-ink"}`;

  const campos = form.campos_texto ?? [];

  return (
    <>
      {mostrarNavegador && (
        <NavegadorArchivos
          onSeleccionar={(item) => {
            set("pdf_ruta", item.ruta_completa);
            set("pdf_nombre", item.nombre);
            setMostrarNavegador(false);
          }}
          onCerrar={() => setMostrarNavegador(false)}
        />
      )}

      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-3">
        {/* Modal — layout horizontal cuando hay PDF */}
        <div className={`flex max-h-[95vh] w-full flex-col rounded-2xl border-2 border-border bg-surface-panel shadow-2xl ${form.pdf_ruta ? "max-w-5xl" : "max-w-2xl"}`}>
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border px-6 py-4 flex-shrink-0">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-ink truncate">{combo.name}</h3>
              <p className="text-[10px] font-mono text-muted mt-0.5">{combo.code}</p>
            </div>
            <button onClick={onCerrar} className="ml-4 flex-shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-ink">✕</button>
          </div>

          {/* Cuerpo — columna izquierda (form) + derecha (preview) */}
          <div className={`flex flex-1 min-h-0 ${form.pdf_ruta ? "flex-row" : "flex-col"}`}>

            {/* Formulario */}
            <div className={`flex flex-col ${form.pdf_ruta ? "w-[420px] flex-shrink-0 border-r border-border" : "w-full"}`}>
              {/* Sub-tabs */}
              <div className="flex gap-1 border-b border-border px-3 py-2 flex-shrink-0 bg-surface-panel">
                <button onClick={() => setTabEditor("config")} className={tabCls("config")}>⚙️ Config</button>
                <button onClick={() => setTabEditor("texto")} className={tabCls("texto")}>
                  ✏️ Overlay
                  {campos.length > 0 && (
                    <span className="ml-1 rounded-full bg-accent/20 px-1 py-0.5 text-[9px] font-bold text-accent">{campos.length}</span>
                  )}
                </button>
                <button
                  onClick={() => setTabEditor("editar-pdf")}
                  disabled={!form.pdf_ruta}
                  className={`${tabCls("editar-pdf")} disabled:opacity-40`}
                  title={!form.pdf_ruta ? "Asocia un PDF primero" : ""}
                >
                  📝 Editar PDF
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

                {tabEditor === "config" && (
                  <>
                    {/* Identidad */}
                    <section className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Identidad</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Nombre en etiqueta</label>
                          <input type="text" value={form.nombre_etiqueta ?? ""} onChange={(e) => set("nombre_etiqueta", e.target.value)} className={inp} placeholder="Ej: Ácido Azelaico" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Presentación</label>
                          <input type="text" value={form.presentacion ?? ""} onChange={(e) => set("presentacion", e.target.value)} className={inp} placeholder="Ej: 250 g" />
                        </div>
                      </div>
                    </section>

                    {/* PDF */}
                    <section className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Archivo PDF base</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink min-w-0">
                          {form.pdf_nombre
                            ? <span className="truncate block font-medium text-xs">{form.pdf_nombre}</span>
                            : <span className="text-muted text-xs">Sin PDF asociado</span>}
                        </div>
                        <button onClick={() => setMostrarNavegador(true)} className="flex-shrink-0 flex items-center gap-1 rounded-lg border-2 border-border px-2.5 py-1.5 text-xs font-semibold text-ink-secondary hover:border-accent hover:text-accent transition">
                          📂 Elegir
                        </button>
                        {form.pdf_ruta && (
                          <button onClick={() => { set("pdf_ruta", ""); set("pdf_nombre", ""); }} className="flex-shrink-0 rounded-lg border border-border p-1.5 text-muted hover:text-danger hover:border-danger transition" title="Quitar PDF">✕</button>
                        )}
                      </div>
                    </section>

                    {/* Lote y vencimiento defecto */}
                    <section className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Lote / Vencimiento (defecto)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">N° de lote</label>
                          <input type="text" value={form.lote_defecto ?? LOTE_PREFIJO} onChange={(e) => set("lote_defecto", editarConPrefijo(e.target.value, LOTE_PREFIJO))} className={inp} placeholder="LOT.MCK-2026-001" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Vencimiento</label>
                          <input type="text" value={form.vencimiento_defecto ?? EXP_PREFIJO} onChange={(e) => set("vencimiento_defecto", editarConPrefijo(e.target.value, EXP_PREFIJO))} className={inp} placeholder="EXP.12/2028" />
                        </div>
                      </div>
                    </section>

                    {/* Impresión */}
                    <section className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Configuración de impresión</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Tipo etiqueta</label>
                          <select value={form.tipo_etiqueta ?? ""} onChange={(e) => {
                            const tipo = e.target.value;
                            set("tipo_etiqueta", tipo);
                            set("rotacion", rotacionDefaultEtiqueta(tipo));
                          }} className={sel}>
                            {ETIQUETAS_LISTA.map((e) => <option key={e}>{e}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Calidad</label>
                          <select value={form.calidad ?? "Normal"} onChange={(e) => set("calidad", e.target.value)} className={sel}>
                            {CALIDADES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Sensor papel</label>
                          <select value={form.forma ?? "Diecut_Gap"} onChange={(e) => set("forma", e.target.value)} className={sel}>
                            {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink">Rotación</label>
                          <div className="flex gap-1">
                            {ROTACIONES.map((r) => (
                              <button key={r} onClick={() => set("rotacion", r)}
                                className={`flex-1 rounded-lg border-2 py-1.5 text-xs font-bold transition ${form.rotacion === r ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:bg-surface-hover"}`}>
                                {r}°
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink">Posición lote</label>
                        <div className="grid grid-cols-4 gap-1">
                          {POSICIONES.map((p) => (
                            <button key={p.value} onClick={() => set("lote_pos", p.value)}
                              className={`rounded-lg border-2 py-1.5 text-[10px] font-semibold transition ${form.lote_pos === p.value ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:bg-surface-hover"}`}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-medium text-ink whitespace-nowrap">Fuente lote</label>
                        <input type="range" min={5} max={14} step={1} value={form.lote_font ?? 7} onChange={(e) => set("lote_font", Number(e.target.value))} className="flex-1 accent-accent" />
                        <span className="w-8 text-right text-xs font-bold text-ink">{form.lote_font ?? 7}pt</span>
                      </div>
                    </section>
                  </>
                )}

                {tabEditor === "texto" && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Campos de texto sobre la etiqueta</p>
                        <p className="text-[10px] text-muted mt-0.5">Posición en % del tamaño de la etiqueta. Usa "Fondo blanco" para tapar texto existente del PDF.</p>
                      </div>
                      <button
                        onClick={agregarCampo}
                        className="flex-shrink-0 flex items-center gap-1 rounded-lg border-2 border-accent px-2.5 py-1.5 text-xs font-bold text-accent hover:bg-accent hover:text-white transition"
                      >
                        + Añadir
                      </button>
                    </div>

                    {campos.length === 0 && (
                      <div className="rounded-xl border-2 border-dashed border-border py-8 text-center">
                        <p className="text-sm text-muted">Sin campos de texto configurados</p>
                        <p className="text-xs text-muted mt-1">Haz clic en "+ Añadir" para crear un campo</p>
                      </div>
                    )}

                    {campos.map((campo, idx) => {
                      const expandido = campoExpandido === campo.id;
                      return (
                        <div key={campo.id} className="rounded-xl border border-border bg-surface overflow-hidden">
                          {/* Cabecera del campo */}
                          <div
                            className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-surface-hover"
                            onClick={() => setCampoExpandido(expandido ? null : campo.id)}
                          >
                            <span className="text-sm">{expandido ? "▾" : "▸"}</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold text-ink truncate block">
                                {campo.etiqueta || "Campo sin nombre"}
                              </span>
                              {campo.texto && (
                                <span className="text-[10px] text-muted truncate block">{campo.texto.split("\n")[0]}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, -1); }} disabled={idx === 0} className="p-1 text-muted hover:text-ink disabled:opacity-30">↑</button>
                              <button onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, 1); }} disabled={idx === campos.length - 1} className="p-1 text-muted hover:text-ink disabled:opacity-30">↓</button>
                              <button onClick={(e) => { e.stopPropagation(); eliminarCampo(campo.id); }} className="p-1 text-muted hover:text-danger">✕</button>
                            </div>
                          </div>

                          {/* Contenido expandido */}
                          {expandido && (
                            <div className="border-t border-border px-3 py-3 space-y-3 bg-surface-panel">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-muted">Nombre del campo</label>
                                  <input
                                    type="text"
                                    value={campo.etiqueta}
                                    onChange={(e) => actualizarCampo(campo.id, { etiqueta: e.target.value })}
                                    className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                                    placeholder="Ej: Nombre, Ingredientes..."
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-muted">Tamaño fuente</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min={4} max={24} step={0.5} value={campo.font_size}
                                      onChange={(e) => actualizarCampo(campo.id, { font_size: Number(e.target.value) })}
                                      className="flex-1 accent-accent" />
                                    <span className="w-10 text-right text-xs font-bold text-ink">{campo.font_size}pt</span>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <label className="mb-1 block text-[10px] font-medium text-muted">Texto (Enter = nueva línea)</label>
                                <ProseTextarea
                                  value={campo.texto}
                                  onChange={(e) => actualizarCampo(campo.id, { texto: e.target.value })}
                                  rows={3}
                                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent resize-none font-mono"
                                  placeholder="Escribe el texto aquí..."
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-muted">Posición X (%)</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min={0} max={100} step={0.5} value={campo.x_pct}
                                      onChange={(e) => actualizarCampo(campo.id, { x_pct: Number(e.target.value) })}
                                      className="flex-1 accent-accent" />
                                    <input type="number" min={0} max={100} step={0.5} value={campo.x_pct}
                                      onChange={(e) => actualizarCampo(campo.id, { x_pct: Number(e.target.value) })}
                                      className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-center text-xs text-ink outline-none focus:border-accent" />
                                  </div>
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-muted">Posición Y (% desde arriba)</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min={0} max={100} step={0.5} value={campo.y_pct}
                                      onChange={(e) => actualizarCampo(campo.id, { y_pct: Number(e.target.value) })}
                                      className="flex-1 accent-accent" />
                                    <input type="number" min={0} max={100} step={0.5} value={campo.y_pct}
                                      onChange={(e) => actualizarCampo(campo.id, { y_pct: Number(e.target.value) })}
                                      className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-center text-xs text-ink outline-none focus:border-accent" />
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 flex-wrap">
                                {/* Negrita */}
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <input type="checkbox" checked={campo.bold} onChange={(e) => actualizarCampo(campo.id, { bold: e.target.checked })} className="accent-accent" />
                                  <span className="text-xs text-ink font-semibold">Negrita</span>
                                </label>

                                {/* Alineación */}
                                <div className="flex gap-1">
                                  {(["left", "center", "right"] as const).map((a) => (
                                    <button key={a} onClick={() => actualizarCampo(campo.id, { align: a })}
                                      className={`rounded px-2 py-1 text-xs font-bold transition ${campo.align === a ? "bg-accent text-white" : "border border-border text-muted hover:text-ink"}`}>
                                      {a === "left" ? "⇤" : a === "center" ? "⇔" : "⇥"}
                                    </button>
                                  ))}
                                </div>

                                {/* Color */}
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <span className="text-xs text-muted">Color:</span>
                                  <input type="color" value={campo.color} onChange={(e) => actualizarCampo(campo.id, { color: e.target.value })}
                                    className="h-6 w-8 cursor-pointer rounded border border-border bg-surface p-0.5" />
                                </label>

                                {/* Fondo blanco */}
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <input type="checkbox" checked={campo.fondo_blanco} onChange={(e) => actualizarCampo(campo.id, { fondo_blanco: e.target.checked })} className="accent-accent" />
                                  <span className="text-xs text-ink">Fondo blanco</span>
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                )}
              </div>

              {tabEditor === "editar-pdf" && form.pdf_ruta && (
                <div className="border-t border-border px-5 py-4">
                  <EditarPDFTab
                    rutaPdf={form.pdf_ruta}
                    onGuardado={(nuevaRuta, nuevoNombre) => {
                      set("pdf_ruta", nuevaRuta);
                      set("pdf_nombre", nuevoNombre);
                    }}
                  />
                </div>
              )}
            </div>

            {/* Preview en tiempo real */}
            {form.pdf_ruta && (
              <div className="flex-1 min-w-0 flex flex-col bg-surface min-h-0">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Vista previa en tiempo real</p>
                  {previewLoading && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      Actualizando...
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                  {previewData?.imagen ? (
                    <img
                      src={`data:${previewData.mime};base64,${previewData.imagen}`}
                      alt="Vista previa"
                      className={`max-w-full max-h-full object-contain rounded-lg shadow transition-opacity duration-200 ${previewLoading ? "opacity-50" : "opacity-100"}`}
                      style={{ imageRendering: "auto" }}
                    />
                  ) : previewLoading ? (
                    <div className="flex flex-col items-center gap-3 text-muted">
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <span className="text-xs">Renderizando...</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted text-center px-8">Selecciona un PDF para ver la vista previa</p>
                  )}
                </div>
                {form.pdf_nombre && (
                  <p className="px-4 py-2 text-[10px] text-muted border-t border-border truncate flex-shrink-0">
                    📄 {form.pdf_nombre}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-border px-6 py-4 flex-shrink-0">
            <button onClick={onCerrar} className="flex-1 rounded-lg border-2 border-border py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-hover">
              Cancelar
            </button>
            <button
              onClick={() => { if (form.pdf_ruta) onImprimir(form); }}
              disabled={!form.pdf_ruta}
              className="flex-1 rounded-lg border-2 border-green-600 bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40 transition"
            >
              🖨 Imprimir ahora
            </button>
            <button
              onClick={() => guardarMut.mutate()}
              disabled={guardarMut.isPending}
              className="flex-1 rounded-lg border-2 border-accent bg-accent py-2.5 text-sm font-bold text-white shadow-[0_3px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40 transition"
            >
              {guardarMut.isPending ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Tab: Configurar Productos ─────────────────────────────────────────────────

interface ConfiguradorProps {
  onImprimirProducto: (datos: DatosEtiqueta) => void;
}

function TabConfigurar({ onImprimirProducto }: ConfiguradorProps) {
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const busquedaDebounced = useDebounce(busqueda, 500);
  const [comboSeleccionado, setComboSeleccionado] = useState<ComboSiigo | null>(null);
  const [eliminandoSku, setEliminandoSku] = useState<string | null>(null);

  const { data: combosData, isLoading: cargandoCombos } = useQuery({
    queryKey: ["combos-siigo", busquedaDebounced],
    queryFn: () =>
      api.get<{ combos: ComboSiigo[]; total: number }>(
        `/api/etiquetas/combos-siigo${busquedaDebounced ? `?q=${encodeURIComponent(busquedaDebounced)}` : ""}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: datosData } = useQuery({
    queryKey: ["etiquetas-datos"],
    queryFn: () => api.get<{ datos: Record<string, DatosEtiqueta>; total: number }>("/api/etiquetas/datos"),
    staleTime: 30 * 1000,
  });

  const eliminarMut = useMutation({
    mutationFn: (sku: string) => api.delete(`/api/etiquetas/datos/${sku}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["etiquetas-datos"] }); setEliminandoSku(null); },
  });

  const combos = combosData?.combos ?? [];
  const datos = datosData?.datos ?? {};
  const totalConfigurados = Object.keys(datos).length;

  const combosConfigurados = combos.filter((c) => datos[c.code]);
  const combosNoConfigurados = combos.filter((c) => !datos[c.code]);

  const renderCombo = (c: ComboSiigo) => {
    const config = datos[c.code];
    const tieneConfig = !!config;
    const tienePdf = !!config?.pdf_nombre;

    return (
      <div
        key={c.code}
        className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 hover:bg-surface-hover transition cursor-pointer group"
        onClick={() => setComboSeleccionado(c)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-ink truncate">{config?.nombre_etiqueta || c.name}</span>
            {config?.presentacion && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-muted font-mono">{config.presentacion}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] font-mono text-muted">{c.code}</span>
            {tieneConfig && (
              <>
                {tienePdf
                  ? <span className="text-[10px] text-green-600 font-medium">📄 {config.pdf_nombre}</span>
                  : <span className="text-[10px] text-orange-500">Sin PDF</span>}
                {config.lote_defecto && (
                  <span className="text-[10px] text-muted">Lote: {config.lote_defecto}</span>
                )}
              </>
            )}
            {!tieneConfig && <span className="text-[10px] text-muted">Sin configurar</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {tieneConfig && tienePdf && (
            <button
              onClick={(e) => { e.stopPropagation(); onImprimirProducto(config); }}
              className="rounded-lg border border-green-500 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 transition opacity-0 group-hover:opacity-100"
            >
              🖨
            </button>
          )}
          {tieneConfig && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (eliminandoSku === c.code) {
                  eliminarMut.mutate(c.code);
                } else {
                  setEliminandoSku(c.code);
                  setTimeout(() => setEliminandoSku(null), 3000);
                }
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition opacity-0 group-hover:opacity-100 ${
                eliminandoSku === c.code
                  ? "border-red-500 bg-red-500 text-white"
                  : "border-border text-muted hover:border-red-400 hover:text-red-500"
              }`}
              title={eliminandoSku === c.code ? "Clic para confirmar" : "Eliminar configuración"}
            >
              {eliminandoSku === c.code ? "¿Eliminar?" : "✕"}
            </button>
          )}
          <span className="text-xs text-muted group-hover:text-accent transition">Editar →</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Barra de búsqueda */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto SIIGO Combo..."
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50 pr-10"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        {cargandoCombos && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </span>
        )}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-ink">{combos.length}</p>
          <p className="text-xs text-muted mt-0.5">Combos SIIGO</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-green-600">{totalConfigurados}</p>
          <p className="text-xs text-muted mt-0.5">Configurados</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-panel px-4 py-3 text-center">
          <p className="text-xl font-extrabold text-orange-500">{combosNoConfigurados.length}</p>
          <p className="text-xs text-muted mt-0.5">Sin configurar</p>
        </div>
      </div>

      {/* Lista */}
      {combos.length === 0 && !cargandoCombos && (
        <div className="rounded-xl border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "No se encontraron combos SIIGO"}
          </p>
        </div>
      )}

      {combosConfigurados.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Configurados</p>
          {combosConfigurados.map(renderCombo)}
        </div>
      )}

      {combosNoConfigurados.length > 0 && (
        <div className="space-y-2">
          {combosConfigurados.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Sin configurar</p>
          )}
          {combosNoConfigurados.map(renderCombo)}
        </div>
      )}

      {/* Editor */}
      {comboSeleccionado && (
        <EditorEtiqueta
          combo={comboSeleccionado}
          datosIniciales={datos[comboSeleccionado.code] ?? {}}
          onGuardado={() => setComboSeleccionado(null)}
          onImprimir={(d) => { onImprimirProducto(d); setComboSeleccionado(null); }}
          onCerrar={() => setComboSeleccionado(null)}
        />
      )}
    </div>
  );
}

// ── Tab: Imprimir ─────────────────────────────────────────────────────────────

interface TabImprimirProps {
  precargar?: DatosEtiqueta | null;
  onPrecargarConsumido: () => void;
}

function TabImprimir({ precargar, onPrecargarConsumido }: TabImprimirProps) {
  const [producto, setProducto] = useState(ETIQUETAS_LISTA[0]);
  const [forma, setForma] = useState(FORMAS[0].value);
  const [calidad, setCalidad] = useState("Normal");
  const [rotacion, setRotacion] = useState("0");
  const [cantidad, setCantidad] = useState(1);
  const [offsetV, setOffsetV] = useState(0.0);
  const [offsetH, setOffsetH] = useState(0.0);
  const [pdfSeleccionado, setPdfSeleccionado] = useState<{ nombre: string; ruta_completa: string } | null>(null);
  const [busquedaRapida, setBusquedaRapida] = useState("");
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [lote, setLote] = useState(LOTE_PREFIJO);
  const [vencimiento, setVencimiento] = useState(EXP_PREFIJO);
  const [lotePos, setLotePos] = useState("bottom-left");
  const [loteFont, setLoteFont] = useState(7);
  const [camposTexto, setCamposTexto] = useState<CampoTexto[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [mostrarInstalador, setMostrarInstalador] = useState(false);

  const loteDebounced = useDebounce(lote, 600);
  const vencDebounced = useDebounce(vencimiento, 600);
  const loteFontDebounced = useDebounce(loteFont, 400);
  const camposDebounced = useDebounce(camposTexto, 700);

  // Precargar desde configuración de producto
  useEffect(() => {
    if (!precargar) return;
    if (precargar.tipo_etiqueta) setProducto(precargar.tipo_etiqueta);
    if (precargar.forma) setForma(precargar.forma);
    if (precargar.calidad) setCalidad(precargar.calidad);
    if (precargar.rotacion) setRotacion(rotacionValida(precargar.rotacion));
    if (precargar.lote_pos) setLotePos(precargar.lote_pos);
    if (precargar.lote_font) setLoteFont(precargar.lote_font);
    setLote(conPrefijoLote(precargar.lote_defecto));
    setVencimiento(conPrefijoExp(precargar.vencimiento_defecto));
    if (precargar.pdf_ruta && precargar.pdf_nombre) {
      setPdfSeleccionado({ nombre: precargar.pdf_nombre, ruta_completa: precargar.pdf_ruta });
    }
    if (precargar.campos_texto) setCamposTexto(precargar.campos_texto);
    onPrecargarConsumido();
  }, [precargar]);

  const { data: estadoData, refetch: refetchImpresora } = useQuery({
    queryKey: ["etiquetas-impresora"],
    queryFn: () => api.get<ImpResp>("/api/etiquetas/impresora"),
    refetchInterval: 30000,
  });

  const { data: pdfsData, isLoading: cargandoPdfs } = useQuery({
    queryKey: ["etiquetas-pdfs"],
    queryFn: () => api.get<{ pdfs: PdfItem[]; total: number }>("/api/etiquetas/pdfs"),
  });

  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["etiquetas-preview", pdfSeleccionado?.ruta_completa, loteDebounced, vencDebounced, lotePos, loteFontDebounced, camposDebounced],
    queryFn: () =>
      api.post<PreviewResp>("/api/etiquetas/preview", {
        ruta_pdf: pdfSeleccionado!.ruta_completa,
        campos_texto: camposDebounced.length ? camposDebounced : undefined,
        lote: loteParaEtiqueta(loteDebounced),
        vencimiento: expParaEtiqueta(vencDebounced),
        lote_pos: lotePos,
        lote_font: loteFontDebounced,
      }),
    enabled: !!pdfSeleccionado,
    staleTime: 0,
  });

  const imprimirMut = useMutation({
    mutationFn: () =>
      api.post<PrintResult>("/api/etiquetas/imprimir", {
        producto, forma, calidad, rotacion, cantidad,
        offset_v: offsetV, offset_h: offsetH,
        ruta_pdf: pdfSeleccionado?.ruta_completa ?? "",
        campos_texto: camposTexto.length ? camposTexto : undefined,
        lote: loteParaEtiqueta(lote),
        vencimiento: expParaEtiqueta(vencimiento),
        lote_pos: lotePos,
        lote_font: loteFont,
      }),
    onSuccess: (data) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLog((prev) => [
        ...prev,
        ...(data.log ?? []).map((l) => `[${ts}] ${l}`),
        data.ok ? `[${ts}] ✅ Impresión enviada` : `[${ts}] ❌ Error al imprimir`,
      ]);
      refetchImpresora();
    },
    onError: (err) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLog((prev) => [...prev, `[${ts}] ❌ ${err.message}`]);
    },
  });

  const pdfsFiltrados = (pdfsData?.pdfs ?? []).filter(
    (p) => !busquedaRapida.trim() || p.nombre.toLowerCase().includes(busquedaRapida.toLowerCase()),
  );

  const estadoTxt = estadoData?.estado ?? "";
  const impConectada = estadoTxt.length > 0 && !estadoTxt.toLowerCase().includes("error") && !estadoTxt.toLowerCase().includes("no encontrad");
  const impDeshabilitada = estadoTxt.toLowerCase().includes("deshabilitad") || estadoTxt.toLowerCase().includes("disabled");

  function handleImprimir() {
    if (!pdfSeleccionado) {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLog((prev) => [...prev, `[${ts}] ⚠️  Selecciona un PDF primero`]);
      return;
    }
    const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const loteVal = loteParaEtiqueta(lote);
    const expVal = expParaEtiqueta(vencimiento);
    const loteInfo = (loteVal || expVal) ? ` · ${loteVal || "–"} / ${expVal || "–"}` : "";
    setLog((prev) => [...prev, `[${ts}] ${cantidad} cop. · ${producto} · ${calidad}${loteInfo}...`]);
    imprimirMut.mutate();
  }

  const inp_c = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent text-center";
  const inp_l = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";
  const sel_s = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <>
      {mostrarNavegador && (
        <NavegadorArchivos
          onSeleccionar={(item) => { setPdfSeleccionado(item); setMostrarNavegador(false); }}
          onCerrar={() => setMostrarNavegador(false)}
        />
      )}
      {mostrarInstalador && (
        <InstaladorWizard onCerrar={() => { setMostrarInstalador(false); refetchImpresora(); }} />
      )}

      {/* Estado impresora + botón instalar */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
            impDeshabilitada ? "bg-orange-100 text-orange-700"
            : impConectada ? "bg-green-100 text-green-700"
            : "bg-red-100 text-red-700"
          }`}>
            {impDeshabilitada ? "Desconectada" : impConectada ? "Impresora lista" : "Sin impresora"}
          </span>
        </div>
        <button
          onClick={() => setMostrarInstalador(true)}
          className="flex items-center gap-1.5 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary transition hover:border-accent hover:text-accent"
        >
          🖨 Instalar impresora
        </button>
      </div>

      {!impConectada && estadoTxt && (
        <div className="rounded-xl border-2 border-orange-200 bg-orange-50 px-4 py-3 flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-sm font-semibold text-orange-800">Impresora no disponible</p>
            <p className="text-xs text-orange-600 mt-0.5">
              {impDeshabilitada ? "Conecta el cable USB y haz clic en \"Instalar impresora\"." : "La impresora no está configurada."}
            </p>
          </div>
          <button onClick={() => setMostrarInstalador(true)} className="flex-shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-600">
            Configurar →
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Columna izquierda */}
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">1 · Tipo de etiqueta</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Producto / Tamaño</label>
              <select value={producto} onChange={(e) => {
                const tipo = e.target.value;
                setProducto(tipo);
                setRotacion(rotacionDefaultEtiqueta(tipo));
              }} className={sel_s}>
                {ETIQUETAS_LISTA.map((e) => <option key={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Sensor de papel</label>
              <select value={forma} onChange={(e) => setForma(e.target.value)} className={sel_s}>
                {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">2 · Calidad y posición</h3>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Calidad de impresión</label>
              <select value={calidad} onChange={(e) => setCalidad(e.target.value)} className={sel_s}>
                {CALIDADES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink">Rotación</label>
              <div className="flex gap-2">
                {ROTACIONES.map((r) => (
                  <button key={r} onClick={() => setRotacion(r)}
                    className={`flex-1 rounded-lg border-2 py-1.5 text-xs font-bold transition ${rotacion === r ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:bg-surface-hover"}`}>
                    {r}°
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-ink">Offset V (mm)</label>
                <input type="number" step="0.1" value={offsetV} onChange={(e) => setOffsetV(parseFloat(e.target.value) || 0)} className={inp_c} />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-ink">Offset H (mm)</label>
                <input type="number" step="0.1" value={offsetH} onChange={(e) => setOffsetH(parseFloat(e.target.value) || 0)} className={inp_c} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">3 · Lote y vencimiento</h3>
              <span className="text-[10px] text-muted">Opcional</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">N° de lote</label>
                <input type="text" value={lote} onChange={(e) => setLote(editarConPrefijo(e.target.value, LOTE_PREFIJO))} placeholder="LOT.MCK-2026-001" className={inp_l} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Fecha vencimiento</label>
                <input type="text" value={vencimiento} onChange={(e) => setVencimiento(editarConPrefijo(e.target.value, EXP_PREFIJO))} placeholder="EXP.12/2028" className={inp_l} />
              </div>
            </div>

            {(loteParaEtiqueta(lote) || expParaEtiqueta(vencimiento)) && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-ink">Posición en la etiqueta</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {POSICIONES.map((p) => (
                    <button key={p.value} onClick={() => setLotePos(p.value)}
                      className={`rounded-lg border-2 py-1.5 text-xs font-semibold transition ${lotePos === p.value ? "border-accent bg-accent text-white" : "border-border text-ink-secondary hover:bg-surface-hover"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-ink whitespace-nowrap">Tamaño fuente</label>
                  <input type="range" min={5} max={14} step={1} value={loteFont} onChange={(e) => setLoteFont(Number(e.target.value))} className="flex-1 accent-accent" />
                  <span className="w-8 text-right text-xs font-bold text-ink">{loteFont}pt</span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">4 · Cantidad</h3>
            <div className="flex items-center gap-3">
              <button onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                className="h-10 w-10 rounded-lg border-2 border-border text-xl font-bold text-ink hover:bg-surface-hover">−</button>
              <input type="number" min={1} max={999} value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-10 w-24 rounded-lg border-2 border-accent bg-surface px-2 text-center text-2xl font-bold text-ink outline-none" />
              <button onClick={() => setCantidad((c) => Math.min(999, c + 1))}
                className="h-10 w-10 rounded-lg border-2 border-border text-xl font-bold text-ink hover:bg-surface-hover">+</button>
              <span className="text-sm text-muted">copias</span>
            </div>
          </section>
        </div>

        {/* Columna derecha */}
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">5 · Archivo PDF</h3>
              <button
                onClick={() => setMostrarNavegador(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-ink-secondary transition hover:border-accent hover:text-accent"
              >
                📂 Explorar
              </button>
            </div>

            <input
              type="text"
              placeholder="Buscar en Documentos..."
              value={busquedaRapida}
              onChange={(e) => setBusquedaRapida(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50"
            />

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface">
              {cargandoPdfs ? (
                <p className="p-3 text-xs text-muted">Cargando...</p>
              ) : pdfsFiltrados.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <p className="text-xs text-muted">Sin resultados en Documentos</p>
                  <button onClick={() => setMostrarNavegador(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover">
                    📂 Buscar en otro lugar
                  </button>
                </div>
              ) : (
                pdfsFiltrados.map((p) => (
                  <button
                    key={p.ruta}
                    onClick={() => setPdfSeleccionado({ nombre: p.nombre, ruta_completa: p.ruta_completa })}
                    className={`block w-full px-3 py-2 text-left text-xs transition ${
                      pdfSeleccionado?.ruta_completa === p.ruta_completa ? "bg-accent text-white" : "text-ink hover:bg-surface-hover"
                    }`}
                  >
                    {p.nombre}
                  </button>
                ))
              )}
            </div>

            {pdfSeleccionado && (
              <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5">
                <span className="text-xs text-accent">✓</span>
                <span className="flex-1 truncate text-xs font-medium text-ink">{pdfSeleccionado.nombre}</span>
                <button onClick={() => setPdfSeleccionado(null)} className="text-xs text-muted hover:text-danger">✕</button>
              </div>
            )}
          </section>

          {pdfSeleccionado && (
            <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Vista previa</h3>
                {previewLoading && (
                  <span className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    Generando...
                  </span>
                )}
              </div>

              <div className="relative flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface overflow-hidden min-h-32">
                {previewData?.imagen ? (
                  <img
                    src={`data:${previewData.mime};base64,${previewData.imagen}`}
                    alt="Vista previa"
                    className={`max-h-72 w-full object-contain transition-opacity duration-200 ${previewLoading ? "opacity-40" : "opacity-100"}`}
                  />
                ) : previewLoading ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-muted">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    <span className="text-xs">Renderizando PDF...</span>
                  </div>
                ) : (
                  <p className="py-8 text-xs text-muted">Selecciona un PDF para ver la vista previa</p>
                )}
                {previewLoading && previewData?.imagen && (
                  <div className="absolute inset-0 flex items-center justify-center bg-surface/40">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  </div>
                )}
              </div>
            </section>
          )}

          <button
            onClick={handleImprimir}
            disabled={imprimirMut.isPending || !pdfSeleccionado}
            className="w-full rounded-xl border-2 border-green-600 bg-green-600 py-4 text-base font-extrabold text-white shadow-[0_4px_0_#15803d] transition hover:bg-green-700 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
          >
            {imprimirMut.isPending ? "Imprimiendo..." : "🚀 IMPRIMIR AHORA"}
          </button>

          {estadoData?.estado && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Estado impresora</p>
              <p className="text-xs text-ink whitespace-pre-wrap">{estadoData.estado}</p>
            </div>
          )}
        </div>
      </div>

      {log.length > 0 && (
        <section className="rounded-xl border border-border bg-surface-panel p-4 mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Log</h3>
            <button onClick={() => setLog([])} className="text-xs text-muted hover:text-danger">Limpiar</button>
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink space-y-0.5">
            {log.map((l, i) => (
              <div key={i} className={l.includes("❌") || l.includes("✗") ? "text-red-600" : l.includes("✅") ? "text-green-600" : l.includes("⚠") ? "text-orange-500" : ""}>
                {l}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────

export default function EtiquetasPanel() {
  const [tab, setTab] = useState<"imprimir" | "configurar">("imprimir");
  const [precargarImpresion, setPrecargarImpresion] = useState<DatosEtiqueta | null>(null);

  function irAImprimir(datos: DatosEtiqueta) {
    setPrecargarImpresion(datos);
    setTab("imprimir");
  }

  const tabCls = (t: typeof tab) =>
    `flex-1 rounded-lg py-2 text-sm font-semibold transition ${tab === t ? "bg-accent text-white shadow" : "text-ink-secondary hover:bg-surface-hover"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-ink">Etiquetas de Producto</h2>
        <p className="text-xs text-muted">Epson ColorWorks CW-C4000u · MCKG Suite v8.0</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 rounded-xl border border-border bg-surface-panel p-1">
        <button onClick={() => setTab("imprimir")} className={tabCls("imprimir")}>
          🖨 Imprimir
        </button>
        <button onClick={() => setTab("configurar")} className={tabCls("configurar")}>
          ⚙️ Configurar Productos
        </button>
      </div>

      {tab === "imprimir" && (
        <TabImprimir
          precargar={precargarImpresion}
          onPrecargarConsumido={() => setPrecargarImpresion(null)}
        />
      )}
      {tab === "configurar" && (
        <TabConfigurar onImprimirProducto={irAImprimir} />
      )}
    </div>
  );
}
