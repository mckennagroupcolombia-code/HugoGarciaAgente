import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

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

interface NavResp {
  ruta_actual: string;
  padre: string | null;
  carpetas: string[];
  pdfs: { nombre: string; ruta_completa: string; tamano_kb: number }[];
}

const ETIQUETAS = [
  "30 mL", "5 mL", "125 g", "250 g", "1 Lt",
  "10 g", "100 g", "Lactato", "Circular", "Circular 70", "5 g",
];

const FORMAS: { label: string; value: string }[] = [
  { label: "Troquelada — separación (gap)", value: "Diecut_Gap" },
  { label: "Troquelada — marca negra", value: "Diecut_Blackmark" },
  { label: "Continua — sin detección", value: "Contlabel_no_detection" },
];

const CALIDADES: { label: string; value: string }[] = [
  { label: "Máxima velocidad (Borrador)", value: "MaxSpeed" },
  { label: "Rápida", value: "Speed" },
  { label: "Normal", value: "Normal" },
  { label: "Alta calidad", value: "Quality" },
  { label: "Máxima calidad (Fotos / Logos)", value: "MaxQuality" },
];

const ROTACIONES = ["0", "90", "180", "270"];

const POSICIONES = [
  { value: "bottom-left",  label: "↙ Inf. Izq." },
  { value: "bottom-right", label: "↘ Inf. Der." },
  { value: "top-left",     label: "↖ Sup. Izq." },
  { value: "top-right",    label: "↗ Sup. Der." },
];

// ── Navegador de archivos ────────────────────────────────────────────────────

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
    queryKey: ["nav-archivos", rutaActual],
    queryFn: () =>
      api.get<NavResp>(
        `/api/etiquetas/navegar${rutaActual ? `?ruta=${encodeURIComponent(rutaActual)}` : ""}`,
      ),
  });

  const pdfsVisibles = (data?.pdfs ?? []).filter(
    (p) => !busqueda.trim() || p.nombre.toLowerCase().includes(busqueda.toLowerCase()),
  );

  // Armar breadcrumb
  const breadcrumb: { nombre: string; ruta: string }[] = [];
  if (data?.ruta_actual) {
    const partes = data.ruta_actual.split("/").filter(Boolean);
    let acum = "";
    for (const p of partes) {
      acum += "/" + p;
      breadcrumb.push({ nombre: p, ruta: acum });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex h-[80vh] w-full max-w-xl flex-col rounded-2xl border-2 border-border bg-surface-panel shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 flex-shrink-0">
          <h3 className="text-sm font-bold text-ink">Explorar archivos</h3>
          <button onClick={onCerrar} className="rounded p-1 text-muted hover:text-ink">✕</button>
        </div>

        {/* Breadcrumb */}
        {data?.ruta_actual && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 flex-shrink-0 text-xs">
            {data.padre !== null && (
              <button
                onClick={() => { setBusqueda(""); setRutaActual(data.padre); }}
                className="mr-1 rounded px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-ink"
              >
                ←
              </button>
            )}
            {breadcrumb.map((b, i) => (
              <span key={b.ruta} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted">/</span>}
                <button
                  onClick={() => { setBusqueda(""); setRutaActual(b.ruta); }}
                  className={`rounded px-1.5 py-0.5 transition hover:bg-surface-hover ${
                    i === breadcrumb.length - 1 ? "font-semibold text-ink" : "text-muted"
                  }`}
                >
                  {b.nombre}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Búsqueda */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar PDF en esta carpeta..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50"
          />
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Cargando...
            </div>
          )}
          {error && (
            <p className="py-4 text-center text-sm text-red-500">Error al leer directorio</p>
          )}

          {/* Carpetas */}
          {!busqueda && (data?.carpetas ?? []).map((c) => (
            <button
              key={c}
              onClick={() => { setBusqueda(""); setRutaActual(`${data!.ruta_actual}/${c}`); }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">📁</span>
              <span className="font-medium text-ink">{c}</span>
            </button>
          ))}

          {/* Separador */}
          {!busqueda && (data?.carpetas ?? []).length > 0 && pdfsVisibles.length > 0 && (
            <div className="my-2 border-t border-border" />
          )}

          {/* PDFs */}
          {pdfsVisibles.map((p) => (
            <button
              key={p.ruta_completa}
              onClick={() => onSeleccionar({ nombre: p.nombre, ruta_completa: p.ruta_completa })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-accent hover:text-white group"
            >
              <span className="text-base">📄</span>
              <span className="flex-1 font-medium">{p.nombre}</span>
              <span className="text-xs opacity-60">{p.tamano_kb} KB</span>
            </button>
          ))}

          {!isLoading && pdfsVisibles.length === 0 && (data?.carpetas ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin archivos PDF aquí</p>
          )}
          {!isLoading && busqueda && pdfsVisibles.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin resultados para "{busqueda}"</p>
          )}
        </div>

        {/* Footer */}
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

// ── Wizard de instalación ────────────────────────────────────────────────────

function InstaladorWizard({ onCerrar }: { onCerrar: () => void }) {
  const [instalLog, setInstalLog] = useState<string[]>([]);
  const [instalDone, setInstalDone] = useState(false);

  const { data: diagData, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: ["etiquetas-diagnostico"],
    queryFn: () => api.get<DiagResp>("/api/etiquetas/diagnostico"),
  });

  const instalarMut = useMutation({
    mutationFn: () => api.post<InstalResp>("/api/etiquetas/instalar", {}),
    onSuccess: (data) => {
      setInstalLog(data.log ?? []);
      setInstalDone(true);
      refetchDiag();
    },
    onError: (err) => {
      setInstalLog([`Error: ${err.message}`]);
      setInstalDone(true);
    },
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

          {diagData && !diagData.checks.find((c) => c.nombre === "PPD / driver Epson")?.ok && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 space-y-1">
              <p className="font-semibold">Driver Epson no encontrado</p>
              <p>Descarga e instala el driver CW-C4000u desde Epson → Soporte → Linux.</p>
              <p>Luego vuelve a hacer clic en "Instalar".</p>
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

// ── Hook debounce ────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ── Panel principal ──────────────────────────────────────────────────────────

export default function EtiquetasPanel() {
  const [producto, setProducto] = useState(ETIQUETAS[0]);
  const [forma, setForma] = useState(FORMAS[0].value);
  const [calidad, setCalidad] = useState("Normal");
  const [rotacion, setRotacion] = useState("0");
  const [cantidad, setCantidad] = useState(1);
  const [offsetV, setOffsetV] = useState(0.0);
  const [offsetH, setOffsetH] = useState(0.0);

  const [pdfSeleccionado, setPdfSeleccionado] = useState<{ nombre: string; ruta_completa: string } | null>(null);
  const [busquedaRapida, setBusquedaRapida] = useState("");
  const [mostrarNavegador, setMostrarNavegador] = useState(false);

  const [lote, setLote] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [lotePos, setLotePos] = useState("bottom-left");
  const [loteFont, setLoteFont] = useState(7);

  const [log, setLog] = useState<string[]>([]);
  const [mostrarInstalador, setMostrarInstalador] = useState(false);

  // Debounce para no llamar al preview en cada keystroke
  const loteDebounced = useDebounce(lote, 600);
  const vencDebounced = useDebounce(vencimiento, 600);
  const loteFontDebounced = useDebounce(loteFont, 400);

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
    queryKey: ["etiquetas-preview", pdfSeleccionado?.ruta_completa, loteDebounced, vencDebounced, lotePos, loteFontDebounced],
    queryFn: () =>
      api.post<PreviewResp>("/api/etiquetas/preview", {
        ruta_pdf: pdfSeleccionado!.ruta_completa,
        lote: loteDebounced || undefined,
        vencimiento: vencDebounced || undefined,
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
        lote: lote || undefined,
        vencimiento: vencimiento || undefined,
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
    const loteInfo = (lote || vencimiento) ? ` · Lote: ${lote || "–"} / Vence: ${vencimiento || "–"}` : "";
    setLog((prev) => [
      ...prev,
      `[${ts}] ${cantidad} cop. · ${producto} · ${calidad}${loteInfo}...`,
    ]);
    imprimirMut.mutate();
  }

  const sel = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";
  const inp = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent text-center";
  const inpL = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";

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

      <div className="mx-auto max-w-3xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Etiquetas de Producto</h2>
            <p className="text-xs text-muted">Epson ColorWorks CW-C4000u · MCKG Suite v8.0</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              impDeshabilitada ? "bg-orange-100 text-orange-700"
              : impConectada ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
            }`}>
              {impDeshabilitada ? "Desconectada" : impConectada ? "Impresora lista" : "Sin impresora"}
            </span>
            <button
              onClick={() => setMostrarInstalador(true)}
              className="flex items-center gap-1.5 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary transition hover:border-accent hover:text-accent"
            >
              🖨 Instalar impresora
            </button>
          </div>
        </div>

        {/* Banner si impresora no lista */}
        {!impConectada && estadoTxt && (
          <div className="rounded-xl border-2 border-orange-200 bg-orange-50 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-orange-800">Impresora no disponible</p>
              <p className="text-xs text-orange-600 mt-0.5">
                {impDeshabilitada ? "Conecta el cable USB y haz clic en \"Instalar impresora\"." : "La impresora no está configurada en este equipo."}
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
            {/* 1. Tipo de etiqueta */}
            <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">1 · Tipo de etiqueta</h3>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Producto / Tamaño</label>
                <select value={producto} onChange={(e) => setProducto(e.target.value)} className={sel}>
                  {ETIQUETAS.map((e) => <option key={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Sensor de papel</label>
                <select value={forma} onChange={(e) => setForma(e.target.value)} className={sel}>
                  {FORMAS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </section>

            {/* 2. Calidad y posición */}
            <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">2 · Calidad y posición</h3>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink">Calidad de impresión</label>
                <select value={calidad} onChange={(e) => setCalidad(e.target.value)} className={sel}>
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
                  <input type="number" step="0.1" value={offsetV} onChange={(e) => setOffsetV(parseFloat(e.target.value) || 0)} className={inp} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-ink">Offset H (mm)</label>
                  <input type="number" step="0.1" value={offsetH} onChange={(e) => setOffsetH(parseFloat(e.target.value) || 0)} className={inp} />
                </div>
              </div>
            </section>

            {/* 3. Lote y vencimiento */}
            <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">3 · Lote y vencimiento</h3>
                <span className="text-[10px] text-muted">Opcional — se imprime sobre el PDF</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">N° de lote</label>
                  <input
                    type="text"
                    value={lote}
                    onChange={(e) => setLote(e.target.value)}
                    placeholder="Ej: MCK-2026-001"
                    className={inpL}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink">Fecha vencimiento</label>
                  <input
                    type="text"
                    value={vencimiento}
                    onChange={(e) => setVencimiento(e.target.value)}
                    placeholder="Ej: 12/2028"
                    className={inpL}
                  />
                </div>
              </div>

              {(lote || vencimiento) && (
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
                    <input type="range" min={5} max={14} step={1} value={loteFont}
                      onChange={(e) => setLoteFont(Number(e.target.value))}
                      className="flex-1 accent-accent" />
                    <span className="w-8 text-right text-xs font-bold text-ink">{loteFont}pt</span>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono text-ink">
                    Vista previa: {lote && <span className="text-accent">Lote: {lote}</span>}{lote && vencimiento && " · "}{vencimiento && <span className="text-green-600">Vence: {vencimiento}</span>}
                  </div>
                </div>
              )}
            </section>

            {/* 4. Cantidad */}
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

          {/* Columna derecha — selector PDF y acción */}
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
                    <button
                      onClick={() => setMostrarNavegador(true)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover"
                    >
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

            {/* Previsualización */}
            {pdfSeleccionado && (
              <section className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
                    Vista previa
                  </h3>
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
                      alt="Vista previa de etiqueta"
                      className={`max-h-72 w-full object-contain transition-opacity duration-200 ${previewLoading ? "opacity-40" : "opacity-100"}`}
                      style={{ imageRendering: "auto" }}
                    />
                  ) : previewLoading ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-muted">
                      <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <span className="text-xs">Renderizando PDF...</span>
                    </div>
                  ) : (
                    <p className="py-8 text-xs text-muted">Selecciona un PDF para ver la vista previa</p>
                  )}

                  {/* Overlay de actualización encima de la imagen */}
                  {previewLoading && previewData?.imagen && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface/40">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    </div>
                  )}
                </div>

                {/* Info rápida debajo de la imagen */}
                {previewData?.imagen && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted">
                    <span>Archivo: <span className="text-ink font-medium truncate">{pdfSeleccionado.nombre}</span></span>
                    <span>Etiqueta: <span className="text-ink font-medium">{producto}</span></span>
                    <span>Calidad: <span className="text-ink font-medium">{calidad}</span></span>
                    {(lote || vencimiento) && (
                      <span>Lote/Vence: <span className="text-ink font-medium">{lote || "–"} / {vencimiento || "–"}</span></span>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Botón imprimir */}
            <button
              onClick={handleImprimir}
              disabled={imprimirMut.isPending || !pdfSeleccionado}
              className="w-full rounded-xl border-2 border-green-600 bg-green-600 py-4 text-base font-extrabold text-white shadow-[0_4px_0_#15803d] transition hover:bg-green-700 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
            >
              {imprimirMut.isPending ? "Imprimiendo..." : "🚀 IMPRIMIR AHORA"}
            </button>

            {/* Estado impresora — compact */}
            {estadoData?.estado && (
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Estado impresora</p>
                <p className="text-xs text-ink whitespace-pre-wrap">{estadoData.estado}</p>
              </div>
            )}
          </div>
        </div>

        {/* Log */}
        {log.length > 0 && (
          <section className="rounded-xl border border-border bg-surface-panel p-4">
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
      </div>
    </>
  );
}
