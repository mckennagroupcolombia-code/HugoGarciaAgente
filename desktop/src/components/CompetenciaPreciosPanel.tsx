import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAnalizarCompetenciaPrecios,
  useActualizarPrecioBaseCompetencia,
  useBorrarObservacionCompetencia,
  useGuardarObservacionCompetencia,
  useReporteCapturaCompetencia,
  useUltimoAnalisisCompetencia,
  type ListadoCaptura,
  type ProductoCompetencia,
  type ReporteCaptura,
  type VeredictoCompetencia,
} from "../hooks/useCompetenciaPrecios";
import { imagenDesdePortapapeles } from "../lib/clipboardImage";
import {
  capturarPestanaComoJpeg,
  esCancelacionCaptura,
  mensajeErrorCaptura,
  puedeCapturarPestana,
} from "../lib/capturaCompetenciaMeli";
import MeliPromocionesItem from "./MeliPromocionesItem";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";

/** Token para abrir evidencias (Bearer en fetch). */
function tokenPanelImagen(): string | null {
  const tickets = useTicketsAuth.getState();
  return (
    tickets.apiToken ||
    tickets.token ||
    useAuthStore.getState().token ||
    null
  );
}

async function abrirEvidenciaCompetencia(itemId: string, download = false): Promise<void> {
  const token = tokenPanelImagen();
  const path = `/api/meli/competencia-precios/evidencia/${encodeURIComponent(itemId)}${
    download ? "?download=1" : ""
  }`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}${path}`;
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error || `No se pudo abrir la evidencia (${res.status})`,
      );
    }
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    if (download) {
      const a = document.createElement("a");
      a.href = obj;
      a.download = `evidencia-${itemId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(obj, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(obj), 60_000);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "No se pudo abrir la evidencia");
  }
}

function cop(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Math.round(Number(n)).toLocaleString("es-CO")}`;
}

/** Producto activo para Ctrl+V del pantallazo. */
let filaCapturaActiva: string | null = null;

type TabDetalle = "analisis" | "promos" | "anotar";

const VEREDICTO: Record<
  VeredictoCompetencia,
  { label: string; corto: string; className: string; dot: string }
> = {
  mas_caro: {
    label: "Nosotros más caros",
    corto: "Revisar",
    className: "bg-red-50 text-red-800 border-red-200",
    dot: "bg-red-500",
  },
  similar: {
    label: "Precio similar",
    corto: "Similar",
    className: "bg-amber-50 text-amber-900 border-amber-200",
    dot: "bg-amber-500",
  },
  mas_barato: {
    label: "Nosotros más baratos",
    corto: "Barato",
    className: "bg-green-50 text-green-800 border-green-200",
    dot: "bg-green-600",
  },
  sin_competencia: {
    label: "Sin anotar",
    corto: "Sin dato",
    className: "bg-gray-50 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
  },
};

function BadgeVeredicto({ v }: { v: VeredictoCompetencia }) {
  const meta = VEREDICTO[v] ?? VEREDICTO.sin_competencia;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 text-[9px] font-bold ${meta.className}`}
      title={meta.label}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      {meta.corto}
    </span>
  );
}

function cantidadDeTitulo(titulo: string): string {
  const m = (titulo || "").match(
    /\b(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|grs?|gramos?|ml|mls|cc|l|lts?|litros?)\b/i,
  );
  if (!m) return "—";
  const n = Number(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  if (u.startsWith("kg") || u.startsWith("kilo")) return `${n} kg`;
  if (u.startsWith("ml") || u === "cc") return `${Math.round(n)} ml`;
  if (u === "l" || u.startsWith("lt") || u.startsWith("litro")) return `${n} L`;
  return `${Math.round(n)} g`;
}

function BloqueReporte({
  r,
  nuestroNombre,
  nuestroPrecio,
}: {
  r: ReporteCaptura;
  nuestroNombre: string;
  nuestroPrecio: number;
}) {
  const token = useAuthStore((s) => s.token);
  const ticketsToken = useTicketsAuth((s) => s.token);
  const apiToken = useTicketsAuth((s) => s.apiToken);
  const itemId = r.item_id || "";
  const tieneEvidencia = Boolean(
    itemId && (r.evidencia_png || r.tabla?.length || r.listados?.length),
  );
  const hayAuth = Boolean(apiToken || ticketsToken || token);
  const listados = r.listados ?? [];
  const filas: ListadoCaptura[] =
    (r.tabla && r.tabla.length > 0
      ? r.tabla
      : [
          {
            titulo: nuestroNombre,
            nombre: nuestroNombre,
            precio: nuestroPrecio,
            cantidad: r.nuestra_cantidad || cantidadDeTitulo(nuestroNombre),
            valor_total: nuestroPrecio,
            es_nuestra: true,
            vendedor: "Nosotros",
          },
          ...listados.map((c) => ({
            ...c,
            nombre: c.nombre || c.titulo,
            cantidad: c.cantidad || cantidadDeTitulo(c.titulo),
            valor_total: c.valor_total ?? c.precio,
            es_nuestra: false,
          })),
        ]) as ListadoCaptura[];

  return (
    <div className="space-y-1.5">
      {r.resumen ? (
        <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink" title={r.resumen}>
          {r.resumen}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full min-w-[18rem] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-border bg-surface-panel text-[9px] uppercase text-muted">
              <th className="px-2 py-1 font-bold">Nombre</th>
              <th className="px-1.5 py-1 font-bold">Cant.</th>
              <th className="px-2 py-1 font-bold">Total</th>
              <th className="px-1.5 py-1" />
            </tr>
          </thead>
          <tbody>
            {filas.map((c, i) => {
              const nombre = c.nombre || c.titulo || "—";
              const cant = c.cantidad || cantidadDeTitulo(nombre);
              const total = c.valor_total ?? c.precio;
              return (
                <tr
                  key={`${nombre}-${i}`}
                  className={`border-b border-border/50 ${c.es_nuestra ? "bg-accent/10" : ""}`}
                >
                  <td className="max-w-[11rem] truncate px-2 py-1 font-semibold text-ink" title={nombre}>
                    {c.es_nuestra ? "★ Nosotros" : nombre}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1 tabular-nums text-ink">{cant}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-bold tabular-nums text-ink">
                    {cop(total)}
                  </td>
                  <td className="px-1.5 py-1">
                    {c.permalink ? (
                      <a
                        href={c.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-semibold text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Ver
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tieneEvidencia && itemId && hayAuth ? (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => void abrirEvidenciaCompetencia(itemId, true)}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => void abrirEvidenciaCompetencia(itemId, false)}
            className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white"
          >
            Ver
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ItemLista({
  p,
  selected,
  onSelect,
}: {
  p: ProductoCompetencia;
  selected: boolean;
  onSelect: () => void;
}) {
  const delta = p.delta_pct_vs_min;
  const mostrarDelta = delta != null && p.veredicto !== "sin_competencia";

  return (
    <button
      type="button"
      onClick={onSelect}
      title={p.titulo}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
        selected
          ? "bg-accent/10 ring-1 ring-accent/40"
          : "hover:bg-surface-panel"
      }`}
    >
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${VEREDICTO[p.veredicto]?.dot ?? "bg-gray-400"}`}
        title={VEREDICTO[p.veredicto]?.label}
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-ink">
          {p.titulo}
        </p>
      </div>
      <div className="shrink-0 pt-0.5 text-right">
        <p className="text-[12px] font-bold tabular-nums text-ink">{cop(p.precio)}</p>
        {mostrarDelta ? (
          <p
            className={`text-[10px] font-semibold tabular-nums ${
              delta! > 0 ? "text-red-600" : delta! < 0 ? "text-green-700" : "text-muted"
            }`}
          >
            {delta! > 0 ? "+" : ""}
            {delta}%
          </p>
        ) : null}
      </div>
    </button>
  );
}

function PanelDetalle({ p }: { p: ProductoCompetencia }) {
  const [tab, setTab] = useState<TabDetalle>("analisis");
  const [precio, setPrecio] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [permalink, setPermalink] = useState("");
  const [precioBase, setPrecioBase] = useState(String(Math.round(p.precio)));
  const [msgPrecio, setMsgPrecio] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [errorCaptura, setErrorCaptura] = useState<string | null>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const enviandoRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const guardar = useGuardarObservacionCompetencia();
  const borrar = useBorrarObservacionCompetencia();
  const reporteMut = useReporteCapturaCompetencia();
  const precioMut = useActualizarPrecioBaseCompetencia();
  const obs = p.observaciones_manual ?? [];
  const busqueda = p.url_busqueda_meli;
  const reporte = reporteMut.data?.reporte ?? p.reporte_captura;
  const pres = cantidadDeTitulo(p.titulo);

  async function enviarImagen(blob: Blob) {
    setErrorCaptura(null);
    reporteMut.reset();
    setHint(null);
    setTab("analisis");
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    await reporteMut.mutateAsync({
      item_id: p.item_id,
      titulo: p.titulo,
      precio: Number(precioBase) || p.precio,
      imagen: blob,
    });
  }

  function tomarArchivo(file: File | Blob | null | undefined) {
    if (!file || enviandoRef.current || reporteMut.isPending) return;
    enviandoRef.current = true;
    void enviarImagen(file)
      .catch(() => {})
      .finally(() => {
        enviandoRef.current = false;
      });
  }

  const mensajeErrorAnalisis =
    errorCaptura ??
    (reporteMut.isError
      ? reporteMut.error instanceof Error
        ? reporteMut.error.message
        : "No se pudo armar el reporte"
      : null);

  function abrirListadoMeli() {
    if (busqueda) {
      window.open(busqueda, "_blank", "noopener,noreferrer");
    }
    setHint("Pegá el pantallazo acá");
    setErrorCaptura(null);
    zonaRef.current?.focus();
  }

  async function onCapturarPestana() {
    let blob: Blob;
    try {
      blob = await capturarPestanaComoJpeg();
    } catch (e) {
      if (esCancelacionCaptura(e)) {
        setHint("Cancelaste — pegá o subí la imagen");
        return;
      }
      setErrorCaptura(mensajeErrorCaptura(e));
      return;
    }
    try {
      await enviarImagen(blob);
    } catch {
      /* reporteMut.isError */
    }
  }

  useEffect(() => {
    filaCapturaActiva = p.item_id;
    const t = window.setTimeout(() => zonaRef.current?.focus(), 100);
    return () => {
      window.clearTimeout(t);
      if (filaCapturaActiva === p.item_id) filaCapturaActiva = null;
    };
  }, [p.item_id]);

  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      if (filaCapturaActiva !== p.item_id) return;
      const activo = document.activeElement;
      if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) {
        return;
      }
      const file = imagenDesdePortapapeles(ev.clipboardData);
      if (!file) return;
      ev.preventDefault();
      ev.stopPropagation();
      tomarArchivo(file);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [p.item_id]);

  useEffect(() => {
    setPrecioBase(String(Math.round(Number(p.precio) || 0)));
    setTab("analisis");
    setHint(null);
    setErrorCaptura(null);
    setMsgPrecio(null);
  }, [p.item_id, p.precio]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function guardarPrecioBase() {
    const n = Number(precioBase);
    if (!(n > 0)) {
      setMsgPrecio("El precio base debe ser mayor que 0");
      return;
    }
    setMsgPrecio(null);
    precioMut.mutate(
      { item_id: p.item_id, precio: n, sku: p.sku },
      {
        onSuccess: (data) => {
          setMsgPrecio(data.aviso_meli || "Precio publicado en MeLi");
        },
        onError: (e) => {
          setMsgPrecio(e instanceof Error ? e.message : "No se pudo guardar el precio");
        },
      },
    );
  }

  const tabs: { id: TabDetalle; label: string; badge?: number }[] = [
    { id: "analisis", label: "Comparación" },
    { id: "promos", label: "Promociones" },
    { id: "anotar", label: "Anotar", badge: obs.length || undefined },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-1.5 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink" title={p.titulo}>
            {p.titulo}
          </h3>
          <BadgeVeredicto v={p.veredicto} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <label className="flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5">
            <span className="text-[9px] font-bold uppercase text-muted">$</span>
            <input
              type="number"
              min={1}
              value={precioBase}
              onChange={(e) => setPrecioBase(e.target.value)}
              className="w-20 bg-transparent text-[11px] font-bold tabular-nums text-ink outline-none"
            />
          </label>
          <button
            type="button"
            disabled={precioMut.isPending}
            onClick={guardarPrecioBase}
            className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-60"
          >
            {precioMut.isPending ? "…" : "Publicar"}
          </button>
          {p.permalink ? (
            <a
              href={p.permalink}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-ink"
            >
              MeLi ↗
            </a>
          ) : null}
        </div>
        {msgPrecio ? <p className="text-[10px] text-muted">{msgPrecio}</p> : null}
        {precioMut.isError ? (
          <p className="text-[10px] text-danger">
            {precioMut.error instanceof Error
              ? precioMut.error.message
              : "No se pudo guardar el precio"}
          </p>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {busqueda ? (
            <button
              type="button"
              onClick={abrirListadoMeli}
              disabled={reporteMut.isPending}
              className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-60"
            >
              Buscar MeLi
            </button>
          ) : null}
          <div
            ref={zonaRef}
            tabIndex={0}
            title={
              pres !== "—"
                ? `Pegá pantallazo (Ctrl+V). Solo ${pres}.`
                : "Pegá pantallazo (Ctrl+V)"
            }
            onFocus={() => {
              filaCapturaActiva = p.item_id;
            }}
            onPaste={(e) => {
              const file = imagenDesdePortapapeles(e.clipboardData);
              if (!file) return;
              e.preventDefault();
              e.stopPropagation();
              tomarArchivo(file);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
              tomarArchivo(f);
            }}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded border border-dashed px-1.5 py-0.5 outline-none ${
              reporteMut.isPending
                ? "border-accent bg-accent/10"
                : "border-accent/50 bg-surface focus:border-accent"
            }`}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="h-6 w-6 shrink-0 rounded object-cover"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
              {reporteMut.isPending
                ? "Analizando…"
                : hint || (pres !== "—" ? `Pegá captura (${pres})` : "Pegá captura")}
            </span>
            {puedeCapturarPestana() ? (
              <button
                type="button"
                onClick={() => void onCapturarPestana()}
                disabled={reporteMut.isPending}
                className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-60"
              >
                Capturar
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reporteMut.isPending}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-60"
            >
              Subir
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                tomarArchivo(f);
              }}
            />
          </div>
        </div>
        {mensajeErrorAnalisis ? (
          <p className="mt-1 text-[10px] text-danger">{mensajeErrorAnalisis}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-0 border-b border-border px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-2 py-1 text-[10px] font-bold transition-colors ${
              tab === t.id
                ? "text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-0.5 text-accent">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === "analisis" ? (
          reporte ? (
            <BloqueReporte
              r={reporte}
              nuestroNombre={p.titulo}
              nuestroPrecio={Number(precioBase) || p.precio}
            />
          ) : (
            <p className="py-4 text-center text-[11px] text-muted">
              Sin comparación — buscá en MeLi y pegá el pantallazo
              {pres !== "—" ? ` (${pres})` : ""}.
            </p>
          )
        ) : null}

        {tab === "promos" ? (
          <MeliPromocionesItem meliId={p.item_id} enabled={tab === "promos"} embedded />
        ) : null}

        {tab === "anotar" ? (
          <div className="space-y-2">
            <form
              className="grid grid-cols-2 gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!precio.trim()) return;
                guardar.mutate(
                  {
                    item_id: p.item_id,
                    precio: precio.trim(),
                    vendedor: vendedor.trim() || undefined,
                    permalink: permalink.trim() || undefined,
                    titulo:
                      pres !== "—"
                        ? `${p.titulo.split(" ").slice(0, 3).join(" ")} ${pres}`
                        : p.titulo,
                  },
                  {
                    onSuccess: () => {
                      setPrecio("");
                      setVendedor("");
                      setPermalink("");
                    },
                  },
                );
              }}
            >
              <input
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="Precio $"
                className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink"
                required
              />
              <input
                value={vendedor}
                onChange={(e) => setVendedor(e.target.value)}
                placeholder="Vendedor"
                className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink"
              />
              <input
                value={permalink}
                onChange={(e) => setPermalink(e.target.value)}
                placeholder="Link"
                className="col-span-2 rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink"
              />
              <button
                type="submit"
                disabled={guardar.isPending}
                className="col-span-2 rounded bg-accent px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60"
              >
                {guardar.isPending ? "…" : "Anotar"}
              </button>
            </form>
            {guardar.isError ? (
              <p className="text-[10px] text-danger">
                {guardar.error instanceof Error ? guardar.error.message : "No se pudo guardar"}
              </p>
            ) : null}
            {obs.length > 0 ? (
              <ul className="divide-y divide-border rounded border border-border bg-surface">
                {obs.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="min-w-0 truncate text-[11px]">
                      <span className="font-bold text-ink">{cop(o.precio)}</span>
                      {o.vendedor ? <span className="text-muted"> · {o.vendedor}</span> : null}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {o.permalink ? (
                        <a
                          href={o.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-semibold text-accent"
                        >
                          Ver
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => borrar.mutate(o.id)}
                        className="text-[10px] text-muted hover:text-danger"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CompetenciaPreciosPanel() {
  const ultimo = useUltimoAnalisisCompetencia();
  const mut = useAnalizarCompetenciaPrecios();
  const [topN, setTopN] = useState(12);
  const [dias, setDias] = useState(30);
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<VeredictoCompetencia | "todos">("todos");
  const [busquedaLista, setBusquedaLista] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const data = mut.data ?? ultimo.data;
  const productos = data?.productos ?? [];
  const visibles = useMemo(
    () =>
      filtro === "todos" ? productos : productos.filter((p) => p.veredicto === filtro),
    [filtro, productos],
  );
  const visiblesFiltrados = useMemo(() => {
    const q = busquedaLista.trim().toLowerCase();
    if (!q) return visibles;
    return visibles.filter(
      (p) =>
        p.titulo.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        p.item_id.toLowerCase().includes(q),
    );
  }, [visibles, busquedaLista]);

  const selected = useMemo(
    () => visiblesFiltrados.find((p) => p.item_id === selectedId) ?? null,
    [selectedId, visiblesFiltrados],
  );

  useEffect(() => {
    if (!visiblesFiltrados.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visiblesFiltrados.some((p) => p.item_id === selectedId)) {
      const prefer =
        visiblesFiltrados.find((p) => p.veredicto === "mas_caro") ?? visiblesFiltrados[0];
      setSelectedId(prefer.item_id);
    }
  }, [visiblesFiltrados, selectedId]);

  const r = data?.resumen;
  const cargando = mut.isPending;
  const error = mut.error
    ? mut.error instanceof Error
      ? mut.error.message
      : String(mut.error)
    : data && data.ok === false
      ? (data.error ?? "El análisis falló.")
      : ultimo.error instanceof Error
        ? ultimo.error.message
        : null;

  return (
    <div className="flex h-full min-h-[24rem] flex-col gap-1.5 overflow-hidden rounded-xl border border-border bg-surface-panel p-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <h2 className="text-xs font-black text-ink">Competencia</h2>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <input
            type="number"
            min={1}
            max={25}
            value={topN}
            title="Top"
            onChange={(e) => setTopN(Number(e.target.value) || 12)}
            className="w-9 rounded border border-border bg-surface px-1 py-0.5 text-center text-[10px] text-ink"
          />
          <input
            type="number"
            min={7}
            max={90}
            value={dias}
            title="Días"
            onChange={(e) => setDias(Number(e.target.value) || 30)}
            className="w-9 rounded border border-border bg-surface px-1 py-0.5 text-center text-[10px] text-ink"
          />
          <input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Filtrar…"
            className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-ink"
          />
          <button
            type="button"
            disabled={cargando}
            onClick={() =>
              mut.mutate({
                top_n: topN,
                dias,
                consulta: consulta.trim() || undefined,
              })
            }
            className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white disabled:opacity-60"
          >
            {cargando ? "…" : "Actualizar"}
          </button>
        </div>
      </div>

      {error ? <p className="shrink-0 text-[10px] text-danger">{error}</p> : null}

      {r ? (
        <div className="grid shrink-0 grid-cols-4 gap-0.5">
          {(
            [
              ["todos", r.productos, "Todos", ""],
              ["mas_caro", r.nosotros_mas_caros, "Revisar", "border-red-300 bg-red-50/80"],
              ["mas_barato", r.nosotros_mas_baratos, "Baratos", "border-green-300 bg-green-50/80"],
              ["sin_competencia", r.sin_match, "Sin dato", ""],
            ] as const
          ).map(([id, n, label, extra]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={`rounded border px-1 py-1 text-center ${
                filtro === id ? "border-accent" : extra || "border-border"
              }`}
            >
              <p className="text-sm font-black leading-none text-ink">{n}</p>
              <p className="mt-0.5 text-[9px] leading-none text-muted">{label}</p>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-80 xl:w-96">
          <input
            type="search"
            value={busquedaLista}
            onChange={(e) => setBusquedaLista(e.target.value)}
            placeholder="Buscar…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink"
          />
          <div className="min-h-[8rem] flex-1 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border bg-surface lg:min-h-0">
            {visiblesFiltrados.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted">Sin productos.</p>
            ) : (
              visiblesFiltrados.map((p) => (
                <ItemLista
                  key={p.item_id}
                  p={p}
                  selected={p.item_id === selectedId}
                  onSelect={() => setSelectedId(p.item_id)}
                />
              ))
            )}
          </div>
        </aside>

        <main className="min-h-[14rem] flex-1 overflow-hidden rounded border border-border bg-surface lg:min-h-0">
          {selected ? (
            <PanelDetalle key={selected.item_id} p={selected} />
          ) : (
            <p className="p-4 text-center text-[11px] text-muted">Elegí un producto</p>
          )}
        </main>
      </div>
    </div>
  );
}
