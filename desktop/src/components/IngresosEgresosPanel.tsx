import { Fragment, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

const EXTRACTO_EXTS = [".csv", ".xlsx", ".xlsm", ".txt", ".tsv", ".pdf"];

function esArchivoExtracto(file: File): boolean {
  const name = (file.name || "").toLowerCase();
  if (EXTRACTO_EXTS.some((ext) => name.endsWith(ext))) return true;
  const t = (file.type || "").toLowerCase();
  return (
    t === "text/csv" ||
    t === "text/plain" ||
    t === "text/tab-separated-values" ||
    t === "application/pdf" ||
    t.includes("spreadsheet") ||
    t.includes("excel")
  );
}

function primerArchivoExtracto(files: FileList | File[]): File | null {
  return Array.from(files).find(esArchivoExtracto) ?? null;
}

function hayArchivosArrastrados(dt: DataTransfer): boolean {
  const types = Array.from(dt.types || []);
  return types.includes("Files") || types.includes("application/x-moz-file");
}

function tipoArchivoExtracto(nombre: string): "pdf" | "excel" | "csv" | "otro" {
  const n = (nombre || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".xlsx") || n.endsWith(".xlsm") || n.endsWith(".xls")) return "excel";
  if (n.endsWith(".csv") || n.endsWith(".tsv") || n.endsWith(".txt")) return "csv";
  return "otro";
}

const TIPO_ARCHIVO_UI: Record<
  ReturnType<typeof tipoArchivoExtracto>,
  { label: string; className: string }
> = {
  pdf: { label: "PDF", className: "bg-rose-500/15 text-rose-700" },
  excel: { label: "Excel", className: "bg-emerald-500/15 text-emerald-700" },
  csv: { label: "CSV", className: "bg-sky-500/15 text-sky-800" },
  otro: { label: "Archivo", className: "bg-muted/20 text-muted" },
};

type ExtractoLink = {
  vinculo_id: number;
  extracto_id: number;
  extracto_mov_id: number;
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: string;
  referencia?: string;
  banco?: string;
  cuenta?: string;
  archivo_nombre?: string;
};

type Movimiento = {
  id?: string;
  fecha: string;
  tipo: "ingreso" | "egreso";
  fuente: string;
  concepto: string;
  monto: number;
  referencia: string;
  contraparte: string;
  extra?: Record<string, unknown>;
  extracto?: ExtractoLink | null;
};

type Libro = {
  desde: string;
  hasta: string;
  movimientos: Movimiento[];
  totales: {
    ingresos: number;
    egresos: number;
    neto: number;
    cantidad: number;
    vinculados_extracto?: number;
  };
  por_fuente?: Record<string, { ingreso: number; egreso: number }>;
  avisos?: string[];
  error?: string;
};

type ExtractoResumen = {
  id: number;
  nombre?: string;
  banco: string;
  cuenta: string;
  periodo_desde: string;
  periodo_hasta: string;
  archivo_nombre: string;
  lineas_count: number;
  vinculados: number;
  created_at?: string;
};

type Candidato = {
  id: number;
  extracto_id: number;
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  tipo: string;
  banco?: string;
  cuenta?: string;
  archivo_nombre?: string;
};

type Sugerencia = {
  movimiento_id: string;
  extracto_mov_id: number;
  libro: {
    fecha: string;
    tipo: "ingreso" | "egreso";
    concepto: string;
    monto: number;
    fuente: string;
  };
  extracto: Candidato;
  ambiguo?: boolean;
};

type ConsultaExtractoResp = {
  concepto: string;
  extracto_id?: number | null;
  cantidad: number;
  suma_debitos: number;
  suma_creditos: number;
  neto: number;
  total_absoluto: number;
  movimientos: Array<{
    id: number;
    extracto_id: number;
    fecha: string;
    descripcion: string;
    referencia: string;
    monto: number;
    tipo: string;
    banco?: string;
    cuenta?: string;
  }>;
  error?: string;
};

/** Agrupa por fecha + fuente + tipo + concepto (mismo concepto → una casilla con sumatoria). */
const FUENTE_LABEL: Record<string, string> = {
  siigo_venta: "Venta ERP",
  meli_venta: "Venta MeLi",
  meli_cobro: "Cobro MeLi",
  web_venta: "Venta página web",
  compra_gmail: "Pago factura compra",
  compra_exterior: "Compra exterior",
  cuenta_cobro_correo: "Cuenta de cobro (correo)",
  operativos_impuestos: "Impuestos",
  operativos_servicios: "Servicios (operativos)",
  creditos_adquiridos: "Créditos adquiridos",
};

type RowView =
  | { kind: "single"; m: Movimiento; key: string }
  | {
      kind: "group";
      key: string;
      fecha: string;
      tipo: "ingreso" | "egreso";
      fuente: string;
      concepto: string;
      monto: number;
      count: number;
      detalle: Movimiento[];
    };

function groupLabel(row: Extract<RowView, { kind: "group" }>): string {
  return `${row.concepto} · ${row.count} del día`;
}

function groupContraparte(detalle: Movimiento[]): string {
  const vals = [...new Set(detalle.map((m) => (m.contraparte || "").trim()).filter(Boolean))];
  if (vals.length === 0) return "—";
  if (vals.length === 1) return vals[0];
  return `Varios (${vals.length})`;
}

function detalleConcepto(m: Movimiento): string {
  const ref = (m.referencia || "").trim();
  const oid = typeof m.extra?.order_id === "string" ? m.extra.order_id : "";
  if (m.fuente === "siigo_venta" && ref) return `Factura ${ref}`;
  if (m.fuente === "compra_gmail" && ref) return `Factura ${ref}`;
  if (m.fuente === "web_venta" && ref) return `Pedido ${ref}`;
  if (m.fuente === "meli_venta") return oid ? `Orden #${oid}` : ref ? `Pack ${ref}` : m.concepto;
  if (m.fuente === "meli_cobro") return oid ? `Comisión orden #${oid}` : ref ? `Pack ${ref}` : m.concepto;
  if (m.fuente === "compra_exterior" && ref) return `Compra #${ref}`;
  if (ref && ref !== m.concepto) return `${m.concepto} · ${ref}`;
  return m.concepto;
}

function haceNDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

/**
 * Misma regla para todas las fuentes: si comparten concepto en la misma fecha,
 * una casilla con sumatoria; clic despliega el detalle del día.
 */
function agruparParaVista(rows: Movimiento[]): RowView[] {
  const buckets = new Map<string, Movimiento[]>();

  for (const m of rows) {
    const k = `${m.fecha}|${m.fuente}|${m.tipo}|${m.concepto}`;
    const list = buckets.get(k) ?? [];
    list.push(m);
    buckets.set(k, list);
  }

  const views: RowView[] = [];
  for (const [key, list] of buckets) {
    if (list.length === 1) {
      views.push({ kind: "single", m: list[0], key });
      continue;
    }
    const first = list[0];
    views.push({
      kind: "group",
      key,
      fecha: first.fecha,
      tipo: first.tipo,
      fuente: first.fuente,
      concepto: first.concepto,
      monto: list.reduce((a, m) => a + m.monto, 0),
      count: list.length,
      detalle: list,
    });
  }

  views.sort((a, b) => {
    const fa = a.kind === "single" ? a.m.fecha : a.fecha;
    const fb = b.kind === "single" ? b.m.fecha : b.fecha;
    if (fa !== fb) return fb.localeCompare(fa);
    const ca = a.kind === "single" ? a.m.concepto : a.concepto;
    const cb = b.kind === "single" ? b.m.concepto : b.concepto;
    return ca.localeCompare(cb);
  });
  return views;
}

function ExtractoCell({
  m,
  onVincular,
  onDesvincular,
  busy,
}: {
  m: Movimiento;
  onVincular: (m: Movimiento) => void;
  onDesvincular: (m: Movimiento) => void;
  busy: boolean;
}) {
  const ex = m.extracto;
  if (ex) {
    const tip = `${ex.fecha} · ${ex.descripcion}${ex.banco ? ` · ${ex.banco}` : ""}`;
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span
          className="inline-flex rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-800"
          title={tip}
        >
          Banco
        </span>
        <button
          type="button"
          disabled={busy || !m.id}
          onClick={(e) => {
            e.stopPropagation();
            onDesvincular(m);
          }}
          className="text-[10px] font-semibold text-muted underline-offset-2 hover:text-rose-600 hover:underline disabled:opacity-40"
        >
          Quitar
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={busy || !m.id}
      onClick={(e) => {
        e.stopPropagation();
        onVincular(m);
      }}
      className="rounded border border-border px-2 py-0.5 text-[10px] font-bold text-ink hover:border-accent hover:text-accent disabled:opacity-40"
    >
      Vincular
    </button>
  );
}

/**
 * Tabla contable de ingresos y egresos con fecha + vínculo a extracto bancario.
 */
export default function IngresosEgresosPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [desde, setDesde] = useState(() => haceNDias(30));
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "ingreso" | "egreso">("todos");
  const [filtroFuente, setFiltroFuente] = useState<string>("todas");
  const [filtroExtracto, setFiltroExtracto] = useState<"todos" | "vinculados" | "sin">("todos");
  const [q, setQ] = useState("");
  const [incluirMeli, setIncluirMeli] = useState(true);
  const [incluirSiigo, setIncluirSiigo] = useState(true);
  const [syncCobroMsg, setSyncCobroMsg] = useState<string | null>(null);
  const [syncCobroBusy, setSyncCobroBusy] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [banco, setBanco] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [nombreExtracto, setNombreExtracto] = useState("");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dropActivo, setDropActivo] = useState(false);
  const [biblioAbierta, setBiblioAbierta] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [modalMov, setModalMov] = useState<Movimiento | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [candError, setCandError] = useState<string | null>(null);
  const [autoAbierto, setAutoAbierto] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [autoMsg, setAutoMsg] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [sugSeleccion, setSugSeleccion] = useState<Record<string, boolean>>({});
  const [consultaConcepto, setConsultaConcepto] = useState("");
  const [consultaExtractoId, setConsultaExtractoId] = useState<string>("todos");
  const [consultaBusy, setConsultaBusy] = useState(false);
  const [consultaErr, setConsultaErr] = useState<string | null>(null);
  const [consultaRes, setConsultaRes] = useState<ConsultaExtractoResp | null>(null);

  const queryKey = ["ingresos-egresos", desde, hasta, incluirMeli, incluirSiigo] as const;

  const libroQ = useQuery<Libro>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({
        desde,
        hasta,
        meli: incluirMeli ? "1" : "0",
        siigo: incluirSiigo ? "1" : "0",
      });
      return api.get(`/api/contabilidad/ingresos-egresos?${params}`, { timeoutMs: 60_000 });
    },
    retry: 1,
  });

  const extractosQ = useQuery<{ extractos: ExtractoResumen[] }>({
    queryKey: ["extractos-bancarios"],
    queryFn: () => api.get("/api/contabilidad/extractos"),
  });

  const movimientos = useMemo(() => {
    let rows = libroQ.data?.movimientos ?? [];
    if (filtroTipo !== "todos") rows = rows.filter((r) => r.tipo === filtroTipo);
    if (filtroFuente !== "todas") rows = rows.filter((r) => r.fuente === filtroFuente);
    if (filtroExtracto === "vinculados") rows = rows.filter((r) => !!r.extracto);
    if (filtroExtracto === "sin") rows = rows.filter((r) => !r.extracto);
    const qq = q.trim().toLowerCase();
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.concepto.toLowerCase().includes(qq) ||
          r.contraparte.toLowerCase().includes(qq) ||
          r.referencia.toLowerCase().includes(qq) ||
          (r.extracto?.descripcion || "").toLowerCase().includes(qq),
      );
    }
    return rows;
  }, [libroQ.data, filtroTipo, filtroFuente, filtroExtracto, q]);

  const filas = useMemo(() => agruparParaVista(movimientos), [movimientos]);

  const fuentes = useMemo(() => {
    const set = new Set((libroQ.data?.movimientos ?? []).map((m) => m.fuente));
    return Array.from(set).sort();
  }, [libroQ.data]);

  const totFiltrado = useMemo(() => {
    const ing = movimientos.filter((m) => m.tipo === "ingreso").reduce((a, m) => a + m.monto, 0);
    const egr = movimientos.filter((m) => m.tipo === "egreso").reduce((a, m) => a + m.monto, 0);
    return { ing, egr, neto: ing - egr };
  }, [movimientos]);

  const totales = libroQ.data?.totales;

  const toggle = (key: string) => {
    setAbiertos((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ingresos-egresos"] }),
      qc.invalidateQueries({ queryKey: ["extractos-bancarios"] }),
    ]);
  };

  const openVincular = async (m: Movimiento) => {
    setModalMov(m);
    setCandidatos([]);
    setCandError(null);
    setCandLoading(true);
    try {
      const params = new URLSearchParams({
        fecha: m.fecha,
        tipo: m.tipo,
        monto: String(m.monto),
      });
      const r = await api.get<{ candidatos: Candidato[] }>(
        `/api/contabilidad/extractos/candidatos?${params}`,
      );
      setCandidatos(r.candidatos ?? []);
    } catch (e) {
      setCandError((e as Error).message || "Error al buscar candidatos");
    } finally {
      setCandLoading(false);
    }
  };

  const doVincular = async (extractoMovId: number) => {
    if (!modalMov?.id) return;
    setLinkBusy(true);
    try {
      await api.post("/api/contabilidad/extractos/vincular", {
        extracto_mov_id: extractoMovId,
        movimiento_id: modalMov.id,
      });
      setModalMov(null);
      await refreshAll();
    } catch (e) {
      setCandError((e as Error).message || "No se pudo vincular");
    } finally {
      setLinkBusy(false);
    }
  };

  const doDesvincular = async (m: Movimiento) => {
    if (!m.id && !m.extracto?.vinculo_id) return;
    setLinkBusy(true);
    try {
      await api.post("/api/contabilidad/extractos/desvincular", {
        vinculo_id: m.extracto?.vinculo_id,
        movimiento_id: m.id,
      });
      await refreshAll();
    } catch (e) {
      setUploadMsg((e as Error).message || "No se pudo desvincular");
    } finally {
      setLinkBusy(false);
    }
  };

  const sugKey = (s: Sugerencia) => `${s.movimiento_id}|${s.extracto_mov_id}`;

  const abrirAutoVincular = async () => {
    setAutoAbierto(true);
    setAutoErr(null);
    setAutoMsg(null);
    setSugerencias([]);
    setSugSeleccion({});
    setAutoBusy(true);
    try {
      const params = new URLSearchParams({
        desde,
        hasta,
        meli: incluirMeli ? "1" : "0",
        siigo: incluirSiigo ? "1" : "0",
      });
      const r = await api.get<{ sugerencias: Sugerencia[] }>(
        `/api/contabilidad/extractos/sugerencias?${params}`,
        { timeoutMs: 60_000 },
      );
      const lista = r.sugerencias ?? [];
      setSugerencias(lista);
      setSugSeleccion(Object.fromEntries(lista.map((s) => [sugKey(s), !s.ambiguo])));
    } catch (e) {
      setAutoErr((e as Error).message || "No se pudieron calcular sugerencias");
    } finally {
      setAutoBusy(false);
    }
  };

  const confirmarAutoVincular = async () => {
    const pares = sugerencias
      .filter((s) => sugSeleccion[sugKey(s)])
      .map((s) => ({ extracto_mov_id: s.extracto_mov_id, movimiento_id: s.movimiento_id }));
    if (pares.length === 0) {
      setAutoErr("Seleccione al menos una sugerencia para vincular");
      return;
    }
    setAutoBusy(true);
    setAutoErr(null);
    try {
      const r = await api.post<{
        vinculados: number;
        errores: Array<{ movimiento_id?: string; extracto_mov_id?: number; error: string }>;
      }>("/api/contabilidad/extractos/vincular-lote", { pares });
      setAutoMsg(
        `${r.vinculados} movimiento${r.vinculados === 1 ? "" : "s"} vinculado${r.vinculados === 1 ? "" : "s"}` +
          (r.errores?.length ? ` · ${r.errores.length} con error` : ""),
      );
      await refreshAll();
      if (!r.errores?.length) {
        setAutoAbierto(false);
      } else {
        const conError = new Set(r.errores.map((er) => er.movimiento_id));
        const vinculadosKeys = new Set(
          pares
            .filter((p) => !conError.has(p.movimiento_id))
            .map((p) => `${p.movimiento_id}|${p.extracto_mov_id}`),
        );
        setSugerencias((prev) => prev.filter((s) => !vinculadosKeys.has(sugKey(s))));
      }
    } catch (e) {
      setAutoErr((e as Error).message || "No se pudo vincular el lote");
    } finally {
      setAutoBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setUploadBusy(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      if (nombreExtracto.trim()) fd.append("nombre", nombreExtracto.trim());
      if (banco.trim()) fd.append("banco", banco.trim());
      if (cuenta.trim()) fd.append("cuenta", cuenta.trim());
      const r = await api.upload<{
        ok?: boolean;
        extracto?: {
          id?: number;
          nombre?: string;
          lineas_count?: number;
          periodo_desde?: string;
          periodo_hasta?: string;
        };
        error?: string;
      }>("/api/contabilidad/extractos", fd, { timeoutMs: 180_000 });
      if (r.error) throw new Error(r.error);
      const ex = r.extracto;
      const etiqueta = ex?.nombre ? ` «${ex.nombre}»` : "";
      setUploadMsg(
        `Extracto${etiqueta} guardado (#${ex?.id ?? "?"}): ${ex?.lineas_count ?? 0} líneas (${ex?.periodo_desde ?? "?"} → ${ex?.periodo_hasta ?? "?"}). Queda en la base de datos.`,
      );
      setNombreExtracto("");
      await refreshAll();
    } catch (e) {
      setUploadMsg((e as Error).message || "Error al subir extracto");
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDragEnterExtracto = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploadBusy) return;
    if (hayArchivosArrastrados(e.dataTransfer)) {
      setDropActivo(true);
    }
  };

  const onDragOverExtracto = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploadBusy) return;
    if (hayArchivosArrastrados(e.dataTransfer)) {
      e.dataTransfer.dropEffect = "copy";
      setDropActivo(true);
    }
  };

  const onDragLeaveExtracto = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropActivo(false);
  };

  const onDropExtracto = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActivo(false);
    if (uploadBusy) return;
    const file = primerArchivoExtracto(e.dataTransfer.files);
    if (!file) {
      setUploadMsg("Arrastre un CSV, Excel o PDF de extracto bancario.");
      return;
    }
    void onUpload(file);
  };

  const onConsultarExtracto = async () => {
    const concepto = consultaConcepto.trim();
    if (concepto.length < 2) {
      setConsultaErr("Escriba al menos 2 caracteres del concepto");
      setConsultaRes(null);
      return;
    }
    setConsultaBusy(true);
    setConsultaErr(null);
    try {
      const params = new URLSearchParams({ concepto });
      if (consultaExtractoId !== "todos") params.set("extracto_id", consultaExtractoId);
      const r = await api.get<ConsultaExtractoResp>(
        `/api/contabilidad/extractos/consultar?${params}`,
      );
      setConsultaRes(r);
    } catch (e) {
      setConsultaRes(null);
      setConsultaErr((e as Error).message || "No se pudo consultar");
    } finally {
      setConsultaBusy(false);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4"
      onDragEnter={onDragEnterExtracto}
      onDragOver={onDragOverExtracto}
      onDragLeave={onDragLeaveExtracto}
      onDrop={onDropExtracto}
    >
      <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
        <div>
          <h2 className="text-base font-bold text-ink">Tabla de contabilidad</h2>
          <p className="text-xs text-muted">
            Ingresos y egresos por fecha. Arrastra el extracto bancario (CSV/Excel/PDF) a esta
            pantalla o elige el archivo, y vincula cada movimiento contable con la línea del banco.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-semibold text-ink-secondary">
            Desde
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="block rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-ink-secondary">
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="block rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "7 días", n: 7 },
              { label: "30 días", n: 30 },
              { label: "90 días", n: 90 },
            ].map(({ label, n }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setDesde(haceNDias(n));
                  setHasta(new Date().toISOString().slice(0, 10));
                }}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-accent hover:text-accent"
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <input type="checkbox" checked={incluirSiigo} onChange={(e) => setIncluirSiigo(e.target.checked)} />
            Alegra
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <input type="checkbox" checked={incluirMeli} onChange={(e) => setIncluirMeli(e.target.checked)} />
            MeLi
          </label>
          <button
            type="button"
            onClick={() => void libroQ.refetch()}
            disabled={libroQ.isFetching}
            className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {libroQ.isFetching ? "Cargando…" : "Actualizar"}
          </button>
          <button
            type="button"
            disabled={syncCobroBusy}
            onClick={() => {
              void (async () => {
                setSyncCobroBusy(true);
                setSyncCobroMsg(null);
                try {
                  const r = await api.post<{
                    ok?: boolean;
                    cobros?: number;
                    correos_revisados?: number;
                    william?: number;
                    fidel_rocha?: number;
                    error?: string;
                  }>("/api/contabilidad/cuentas-cobro/sincronizar", {});
                  if (r.error) throw new Error(r.error);
                  setSyncCobroMsg(
                    `Correo: ${r.cobros ?? 0} cobros (William ${r.william ?? "—"} · Fidel/NEXT ${r.fidel_rocha ?? "—"})`,
                  );
                  await libroQ.refetch();
                } catch (e) {
                  setSyncCobroMsg((e as Error).message || "Error al leer correo");
                } finally {
                  setSyncCobroBusy(false);
                }
              })();
            }}
            className="rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {syncCobroBusy ? "Leyendo correo…" : "Revisar cuentas de cobro (correo)"}
          </button>
        </div>
        {syncCobroMsg && <p className="text-xs text-muted">{syncCobroMsg}</p>}

        <div
          className={`rounded-lg border-2 border-dashed p-3 space-y-2 transition ${
            dropActivo
              ? "border-sky-500 bg-sky-500/10"
              : "border-border bg-surface/60"
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Extracto bancario
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1 space-y-1 text-xs font-semibold text-ink-secondary">
              Nombre del extracto
              <input
                value={nombreExtracto}
                onChange={(e) => setNombreExtracto(e.target.value)}
                placeholder="Ej. Bancolombia julio 2026"
                className="block w-full rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-ink-secondary">
              Banco
              <input
                value={banco}
                onChange={(e) => setBanco(e.target.value)}
                placeholder="Bancolombia…"
                className="block w-36 rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-ink-secondary">
              Cuenta
              <input
                value={cuenta}
                onChange={(e) => setCuenta(e.target.value)}
                placeholder="****1234"
                className="block w-28 rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xlsm,.txt,.tsv,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
              }}
            />
            <div
              role="button"
              tabIndex={uploadBusy ? -1 : 0}
              aria-disabled={uploadBusy}
              aria-label="Arrastrar o elegir extracto bancario"
              title="Arrastra el CSV, Excel o PDF, o haz clic para elegirlo"
              onClick={() => {
                if (!uploadBusy) fileRef.current?.click();
              }}
              onKeyDown={(e) => {
                if (uploadBusy) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              className={`mb-0.5 inline-flex h-8 w-[5.75rem] shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed text-[10px] font-semibold transition ${
                uploadBusy ? "cursor-wait opacity-50" : ""
              } ${
                dropActivo
                  ? "border-sky-600 bg-sky-500/20 text-sky-900"
                  : "border-sky-500/70 bg-sky-500/10 text-sky-800 hover:border-sky-600 hover:bg-sky-500/15"
              }`}
            >
              {uploadBusy ? "Subiendo…" : dropActivo ? "Suelta" : "Arrastrar"}
            </div>
            <button
              type="button"
              onClick={() => setBiblioAbierta(true)}
              className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[10px] font-bold text-ink hover:border-accent hover:text-accent"
              title="Abrir carpeta de extractos guardados"
            >
              <span aria-hidden className="text-sm leading-none">
                📁
              </span>
              Biblioteca
              {(extractosQ.data?.extractos?.length ?? 0) > 0 && (
                <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-800">
                  {extractosQ.data!.extractos.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => void abrirAutoVincular()}
              className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600/10 px-2.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-600/20"
              title="Buscar movimientos del libro y líneas del extracto que calzan por fecha y monto, para confirmarlos en bloque"
            >
              <span aria-hidden className="text-sm leading-none">
                🔗
              </span>
              Vincular automáticamente
            </button>
          </div>
          <p className="text-[11px] text-muted">
            El archivo es el que descargaste o generaste tú — se sube al soltarlo o al
            seleccionarlo, no se trae de ningún lado automáticamente. Encabezados típicos: Fecha,
            Descripción, Débito, Crédito (o Valor). Separador ; o ,. Si el PDF de Bancolombia no se
            lee como texto, el sistema intenta leerlo con IA (puede tardar unos segundos).
          </p>
          {uploadMsg && (
            <p
              className={`text-xs ${
                /error|no se|inválid|fall|protegido|encontraron|seleccionable/i.test(uploadMsg)
                  ? "font-semibold text-rose-600"
                  : "text-ink"
              }`}
            >
              {uploadMsg}
            </p>
          )}

          <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">
              Consultar extracto
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 space-y-1 text-xs font-semibold text-ink-secondary">
                Concepto
                <input
                  value={consultaConcepto}
                  onChange={(e) => setConsultaConcepto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onConsultarExtracto();
                    }
                  }}
                  placeholder="Ej. PSE, nómina, proveedor…"
                  className="block w-full rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-ink-secondary">
                Extracto
                <select
                  value={consultaExtractoId}
                  onChange={(e) => setConsultaExtractoId(e.target.value)}
                  className="block rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="todos">Todos</option>
                  {(extractosQ.data?.extractos ?? []).map((ex) => (
                    <option key={ex.id} value={String(ex.id)}>
                      #{ex.id} {ex.nombre || ex.banco || ex.archivo_nombre || "extracto"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={consultaBusy}
                onClick={() => void onConsultarExtracto()}
                className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {consultaBusy ? "Consultando…" : "Consultar extracto"}
              </button>
            </div>
            {consultaErr && (
              <p className="text-xs font-semibold text-rose-600">{consultaErr}</p>
            )}
            {consultaRes && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="font-semibold text-ink">
                    {consultaRes.cantidad} resultado{consultaRes.cantidad === 1 ? "" : "s"}
                  </span>
                  <span className="text-rose-600">
                    Débitos {formatCop(consultaRes.suma_debitos)}
                  </span>
                  <span className="text-emerald-600">
                    Créditos {formatCop(consultaRes.suma_creditos)}
                  </span>
                  <span className="font-bold text-accent">
                    Neto {formatCop(consultaRes.neto)}
                  </span>
                  <span className="text-muted">
                    Suma abs. {formatCop(consultaRes.total_absoluto)}
                  </span>
                </div>
                {consultaRes.movimientos.length === 0 ? (
                  <p className="text-xs text-muted">
                    Sin coincidencias para «{consultaRes.concepto}».
                  </p>
                ) : (
                  <div className="max-h-56 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-surface-panel text-[10px] uppercase text-muted">
                        <tr>
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Concepto</th>
                          <th className="px-2 py-1.5">Tipo</th>
                          <th className="px-2 py-1.5 text-right">Monto</th>
                          <th className="px-2 py-1.5">Extracto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consultaRes.movimientos.map((m) => (
                          <tr key={m.id} className="border-t border-border/70">
                            <td className="whitespace-nowrap px-2 py-1 font-mono">{m.fecha}</td>
                            <td className="px-2 py-1 text-ink">
                              {m.descripcion}
                              {m.referencia ? (
                                <span className="text-muted"> · {m.referencia}</span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1">
                              {m.tipo === "debito" ? "Débito" : "Crédito"}
                            </td>
                            <td
                              className={`px-2 py-1 text-right font-mono font-semibold ${
                                m.tipo === "debito" ? "text-rose-600" : "text-emerald-600"
                              }`}
                            >
                              {formatCop(m.monto)}
                            </td>
                            <td className="px-2 py-1 text-muted">
                              #{m.extracto_id}
                              {m.banco ? ` ${m.banco}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-accent bg-accent/5 text-[11px] font-bold">
                        <tr>
                          <td className="px-2 py-2" colSpan={3}>
                            Totales («{consultaRes.concepto}»)
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-accent">
                            Neto {formatCop(consultaRes.neto)}
                          </td>
                          <td className="px-2 py-2 text-muted">
                            D {formatCop(consultaRes.suma_debitos)} · C{" "}
                            {formatCop(consultaRes.suma_creditos)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {totales && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Ingresos</div>
              <div className="text-sm font-bold text-emerald-600">{formatCop(totales.ingresos)}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Egresos</div>
              <div className="text-sm font-bold text-rose-600">{formatCop(totales.egresos)}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Neto</div>
              <div className={`text-sm font-bold ${totales.neto >= 0 ? "text-ink" : "text-rose-600"}`}>
                {formatCop(totales.neto)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Movimientos</div>
              <div className="text-sm font-bold text-ink">{totales.cantidad}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-[10px] font-bold uppercase text-muted">Con extracto</div>
              <div className="text-sm font-bold text-sky-700">
                {totales.vinculados_extracto ?? 0}
              </div>
            </div>
          </div>
        )}

        {(libroQ.data?.avisos?.length ?? 0) > 0 && (
          <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4">
            {libroQ.data!.avisos!.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        {libroQ.isError && (
          <p className="text-sm text-rose-600">{(libroQ.error as Error)?.message || "Error al cargar"}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as "todos" | "ingreso" | "egreso")}
          className="rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs font-semibold text-ink"
        >
          <option value="todos">Todos</option>
          <option value="ingreso">Solo ingresos</option>
          <option value="egreso">Solo egresos</option>
        </select>
        <select
          value={filtroFuente}
          onChange={(e) => setFiltroFuente(e.target.value)}
          className="rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs font-semibold text-ink"
        >
          <option value="todas">Todas las fuentes</option>
          <option value="operativos_impuestos">Impuestos</option>
          <option value="operativos_servicios">Servicios (operativos)</option>
          <option value="creditos_adquiridos">Créditos adquiridos</option>
          <option value="compra_gmail">Pago factura compra</option>
          <option value="compra_exterior">Compra exterior</option>
          <option value="meli_venta">Venta MeLi</option>
          <option value="meli_cobro">Cobro MeLi</option>
          {fuentes
            .filter(
              (f) =>
                ![
                  "operativos_impuestos",
                  "operativos_servicios",
                  "creditos_adquiridos",
                  "compra_gmail",
                  "compra_exterior",
                  "meli_venta",
                  "meli_cobro",
                ].includes(f),
            )
            .map((f) => (
              <option key={f} value={f}>
                {FUENTE_LABEL[f] || f}
              </option>
            ))}
        </select>
        <select
          value={filtroExtracto}
          onChange={(e) => setFiltroExtracto(e.target.value as "todos" | "vinculados" | "sin")}
          className="rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs font-semibold text-ink"
        >
          <option value="todos">Extracto: todos</option>
          <option value="vinculados">Con extracto</option>
          <option value="sin">Sin extracto</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar concepto, proveedor, ref…"
          className="min-w-[12rem] flex-1 rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
        />
        {(filtroTipo !== "todos" || filtroFuente !== "todas" || q || filtroExtracto !== "todos") && (
          <span className="text-[11px] text-muted">
            Vista: {formatCop(totFiltrado.ing)} / {formatCop(totFiltrado.egr)} · neto{" "}
            {formatCop(totFiltrado.neto)} · {filas.length} filas
          </span>
        )}
      </div>

        <div className="mck-table-wrap min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface-panel">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-surface-panel text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-bold">Fecha</th>
              <th className="px-3 py-2 font-bold">Tipo</th>
              <th className="px-3 py-2 font-bold">Fuente</th>
              <th className="px-3 py-2 font-bold">Concepto</th>
              <th className="px-3 py-2 font-bold">Contraparte</th>
              <th className="px-3 py-2 font-bold">Ref.</th>
              <th className="px-3 py-2 font-bold">Extracto</th>
              <th className="px-3 py-2 font-bold text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {libroQ.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  Cargando movimientos (Alegra/MeLi ~30s)…
                </td>
              </tr>
            )}
            {libroQ.isError && !libroQ.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-rose-600">
                  {(libroQ.error as Error)?.message || "Error al cargar el libro"}
                </td>
              </tr>
            )}
            {!libroQ.isLoading && !libroQ.isError && filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  No hay movimientos en este rango.
                </td>
              </tr>
            )}
            {filas.map((row) => {
              if (row.kind === "single") {
                const m = row.m;
                return (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 hover:bg-surface-hover/50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-ink">{m.fecha}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          m.tipo === "ingreso"
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-rose-500/15 text-rose-700"
                        }`}
                      >
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{FUENTE_LABEL[m.fuente] || m.fuente}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-xs text-ink" title={detalleConcepto(m)}>
                      {detalleConcepto(m)}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-xs text-muted" title={m.contraparte}>
                      {m.contraparte || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{m.referencia || "—"}</td>
                    <td className="px-3 py-2">
                      <ExtractoCell
                        m={m}
                        busy={linkBusy}
                        onVincular={(mov) => void openVincular(mov)}
                        onDesvincular={(mov) => void doDesvincular(mov)}
                      />
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right text-xs font-bold ${
                        m.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {m.tipo === "egreso" ? "−" : ""}
                      {formatCop(m.monto)}
                    </td>
                  </tr>
                );
              }

              const open = !!abiertos[row.key];
              const label = groupLabel(row);
              const vinculadosGrupo = row.detalle.filter((d) => d.extracto).length;
              return (
                <Fragment key={row.key}>
                  <tr
                    className="border-b border-border/60 bg-accent/5 hover:bg-accent/10 cursor-pointer"
                    onClick={() => toggle(row.key)}
                    title="Clic para ver / ocultar detalle del día"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-ink">
                      <span className="mr-1.5 inline-block w-3 text-accent" aria-hidden>
                        {open ? "▾" : "▸"}
                      </span>
                      {row.fecha}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          row.tipo === "ingreso"
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-rose-500/15 text-rose-700"
                        }`}
                      >
                        {row.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{FUENTE_LABEL[row.fuente] || row.fuente}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-ink">{label}</td>
                    <td className="px-3 py-2 text-xs text-muted">{groupContraparte(row.detalle)}</td>
                    <td className="px-3 py-2 text-xs text-muted">{row.count} ítems</td>
                    <td className="px-3 py-2 text-[10px] text-muted">
                      {vinculadosGrupo}/{row.count} banco
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right text-xs font-bold ${
                        row.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {row.tipo === "egreso" ? "−" : ""}
                      {formatCop(row.monto)}
                    </td>
                  </tr>
                  {open &&
                    row.detalle.map((m, i) => (
                      <tr
                        key={`${row.key}-d-${i}`}
                        className="border-b border-border/40 bg-surface/80"
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 pl-8 text-[11px] text-muted">
                          {m.fecha}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">{m.tipo}</td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">detalle</td>
                        <td
                          className="max-w-[280px] truncate px-3 py-1.5 text-[11px] text-ink"
                          title={detalleConcepto(m)}
                        >
                          {detalleConcepto(m)}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-1.5 text-[11px] text-muted" title={m.contraparte}>
                          {m.contraparte || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">{m.referencia || "—"}</td>
                        <td className="px-3 py-1.5">
                          <ExtractoCell
                            m={m}
                            busy={linkBusy}
                            onVincular={(mov) => void openVincular(mov)}
                            onDesvincular={(mov) => void doDesvincular(mov)}
                          />
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold ${
                            m.tipo === "ingreso" ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {m.tipo === "egreso" ? "−" : ""}
                          {formatCop(m.monto)}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {biblioAbierta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBiblioAbierta(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <span aria-hidden>📁</span>
                  Carpeta de extractos
                </h3>
                <p className="text-[11px] text-muted">
                  {extractosQ.data?.extractos?.length ?? 0} archivo
                  {(extractosQ.data?.extractos?.length ?? 0) === 1 ? "" : "s"} guardado
                  {(extractosQ.data?.extractos?.length ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted hover:text-ink"
                onClick={() => setBiblioAbierta(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {(extractosQ.data?.extractos?.length ?? 0) === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted">
                  La carpeta está vacía. Arrastra o elige un extracto para guardarlo aquí.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {extractosQ.data!.extractos.map((ex) => {
                    const tipo = tipoArchivoExtracto(ex.archivo_nombre);
                    const tipoUi = TIPO_ARCHIVO_UI[tipo];
                    const titulo =
                      ex.nombre || ex.banco || ex.archivo_nombre || `Extracto #${ex.id}`;
                    const pct =
                      ex.lineas_count > 0
                        ? Math.round((100 * (ex.vinculados || 0)) / ex.lineas_count)
                        : 0;
                    return (
                      <li
                        key={ex.id}
                        className="rounded-lg border border-border bg-surface px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 inline-flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-[10px] font-black uppercase ${tipoUi.className}`}
                            title={ex.archivo_nombre}
                          >
                            {tipoUi.label}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span
                                className="truncate text-xs font-bold text-ink"
                                title={titulo}
                              >
                                {titulo}
                              </span>
                              <span className="text-[10px] font-mono text-muted">#{ex.id}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted">
                              {(ex.periodo_desde || ex.periodo_hasta) && (
                                <span>
                                  {ex.periodo_desde || "?"} → {ex.periodo_hasta || "?"}
                                </span>
                              )}
                              {ex.banco ? <span>{ex.banco}</span> : null}
                              {ex.cuenta ? <span>{ex.cuenta}</span> : null}
                            </div>
                            <div
                              className="truncate text-[10px] text-muted"
                              title={ex.archivo_nombre}
                            >
                              {ex.archivo_nombre}
                            </div>
                            <div className="flex items-center gap-2 pt-0.5">
                              <div className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-border/70">
                                <div
                                  className={`h-full rounded-full ${
                                    pct >= 100
                                      ? "bg-emerald-500"
                                      : pct > 0
                                        ? "bg-sky-500"
                                        : "bg-muted/40"
                                  }`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="shrink-0 text-[10px] font-semibold text-ink">
                                {ex.vinculados}/{ex.lineas_count} vinculados
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              <button
                                type="button"
                                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:border-accent hover:text-accent"
                                onClick={() => {
                                  void (async () => {
                                    const actual = ex.nombre || "";
                                    const nuevo = window.prompt(
                                      "Nombre del extracto en la biblioteca:",
                                      actual,
                                    );
                                    if (nuevo == null) return;
                                    const n = nuevo.trim();
                                    if (!n) {
                                      setUploadMsg("El nombre no puede quedar vacío");
                                      return;
                                    }
                                    try {
                                      await api.post(
                                        `/api/contabilidad/extractos/${ex.id}/nombre`,
                                        { nombre: n },
                                      );
                                      setUploadMsg(`Extracto #${ex.id} renombrado a «${n}»`);
                                      await refreshAll();
                                    } catch (e) {
                                      setUploadMsg((e as Error).message);
                                    }
                                  })();
                                }}
                              >
                                Renombrar
                              </button>
                              <button
                                type="button"
                                className="rounded border border-rose-200 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 hover:border-rose-400 hover:bg-rose-50"
                                onClick={() => {
                                  void (async () => {
                                    if (
                                      !confirm(`¿Eliminar extracto #${ex.id} y sus vínculos?`)
                                    )
                                      return;
                                    try {
                                      await api.delete(`/api/contabilidad/extractos/${ex.id}`);
                                      await refreshAll();
                                    } catch (e) {
                                      setUploadMsg((e as Error).message);
                                    }
                                  })();
                                }}
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {autoAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !autoBusy && setAutoAbierto(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <span aria-hidden>🔗</span>
                  Vincular automáticamente
                </h3>
                <p className="text-[11px] text-muted">
                  Coincidencias por monto exacto entre el libro ({desde} → {hasta}) y las líneas de
                  extracto sin vincular, con hasta 7 días de diferencia entre la fecha registrada y
                  la del banco (la factura/cuenta de cobro suele registrarse unos días antes o
                  después del pago real). Las marcadas ⚠ Revisar tienen más de una línea posible
                  con el mismo monto — quedan sin seleccionar. Desmarca lo que no corresponda antes
                  de confirmar.
                </p>
              </div>
              <button
                type="button"
                disabled={autoBusy}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted hover:text-ink disabled:opacity-50"
                onClick={() => setAutoAbierto(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {autoBusy && sugerencias.length === 0 && (
                <p className="px-2 py-8 text-center text-xs text-muted">Buscando coincidencias…</p>
              )}
              {autoErr && (
                <p className="mb-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700">
                  {autoErr}
                </p>
              )}
              {autoMsg && (
                <p className="mb-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700">
                  {autoMsg}
                </p>
              )}
              {!autoBusy && !autoErr && sugerencias.length === 0 && (
                <p className="px-2 py-8 text-center text-xs text-muted">
                  No hay coincidencias nuevas para el rango de fechas actual. Amplía el rango
                  (desde/hasta) si el extracto cubre un período distinto al que estás viendo.
                </p>
              )}
              {sugerencias.length > 0 && (
                <>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={sugerencias.every((s) => sugSeleccion[sugKey(s)])}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setSugSeleccion(
                            Object.fromEntries(sugerencias.map((s) => [sugKey(s), v])),
                          );
                        }}
                      />
                      Seleccionar todas ({sugerencias.length})
                    </label>
                    <span className="text-[11px] text-muted">
                      {Object.values(sugSeleccion).filter(Boolean).length} seleccionadas
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {sugerencias.map((s) => {
                      const key = sugKey(s);
                      const checked = !!sugSeleccion[key];
                      return (
                        <li
                          key={key}
                          className={`rounded-lg border px-3 py-2 text-[11px] transition ${
                            s.ambiguo
                              ? "border-amber-500/60 bg-amber-500/5"
                              : checked
                                ? "border-emerald-500/60 bg-emerald-500/5"
                                : "border-border"
                          }`}
                        >
                          <label className="flex cursor-pointer items-start gap-2.5">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={(e) =>
                                setSugSeleccion((prev) => ({ ...prev, [key]: e.target.checked }))
                              }
                            />
                            <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:grid-cols-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-muted">
                                  Libro
                                  {s.ambiguo && (
                                    <span
                                      className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-amber-800"
                                      title="Hay más de una línea de extracto con este mismo monto en la ventana de fechas — revisa cuál corresponde antes de confirmar"
                                    >
                                      ⚠ Revisar
                                    </span>
                                  )}
                                </div>
                                <div className="truncate font-semibold text-ink" title={s.libro.concepto}>
                                  {s.libro.concepto}
                                </div>
                                <div className="text-muted">
                                  {s.libro.fecha} · {s.libro.tipo} · {formatCop(s.libro.monto)}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-[9px] font-bold uppercase tracking-wide text-muted">
                                  Extracto {s.extracto.banco ? `· ${s.extracto.banco}` : ""}
                                </div>
                                <div
                                  className="truncate font-semibold text-ink"
                                  title={s.extracto.descripcion}
                                >
                                  {s.extracto.descripcion || "—"}
                                </div>
                                <div className="text-muted">
                                  {s.extracto.fecha} · {s.extracto.tipo} ·{" "}
                                  {formatCop(s.extracto.monto)}
                                </div>
                              </div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
            {sugerencias.length > 0 && (
              <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
                <button
                  type="button"
                  disabled={autoBusy}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted hover:text-ink disabled:opacity-50"
                  onClick={() => setAutoAbierto(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    autoBusy || Object.values(sugSeleccion).filter(Boolean).length === 0
                  }
                  className="rounded-lg border-2 border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  onClick={() => void confirmarAutoVincular()}
                >
                  {autoBusy
                    ? "Vinculando…"
                    : `Vincular ${Object.values(sugSeleccion).filter(Boolean).length} seleccionadas`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {modalMov && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setModalMov(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-surface-panel p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-ink">Vincular extracto</h3>
                <p className="text-xs text-muted">
                  {modalMov.fecha} · {modalMov.tipo} · {formatCop(modalMov.monto)} ·{" "}
                  {detalleConcepto(modalMov)}
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-bold text-muted hover:text-ink"
                onClick={() => setModalMov(null)}
              >
                Cerrar
              </button>
            </div>
            {candLoading && <p className="text-xs text-muted">Buscando líneas cercanas…</p>}
            {candError && <p className="text-xs text-rose-600">{candError}</p>}
            {!candLoading && !candError && candidatos.length === 0 && (
              <p className="text-xs text-muted">
                No hay líneas de extracto sin vincular con monto y fecha cercanos. Sube el CSV/Excel/PDF
                del banco primero.
              </p>
            )}
            <ul className="space-y-2">
              {candidatos.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 text-xs">
                    <div className="font-semibold text-ink">
                      {c.fecha} · {c.tipo === "credito" ? "Crédito" : "Débito"} ·{" "}
                      {formatCop(c.monto)}
                    </div>
                    <div className="truncate text-muted" title={c.descripcion}>
                      {c.descripcion}
                      {c.referencia ? ` · ref ${c.referencia}` : ""}
                    </div>
                    {(c.banco || c.archivo_nombre) && (
                      <div className="text-[10px] text-muted">
                        {[c.banco, c.cuenta, c.archivo_nombre].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={linkBusy}
                    onClick={() => void doVincular(c.id)}
                    className="shrink-0 rounded-lg border-2 border-sky-600 bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    Usar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
