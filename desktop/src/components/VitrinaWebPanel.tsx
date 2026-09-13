import { useMemo, useState } from "react";
import {
  LINEAS_ORIGEN,
  useActualizarBanner,
  useBanners,
  useCrearBanner,
  useEliminarBanner,
  useGuardarOrigenMaterias,
  useMetricasContenido,
  useOrigenMaterias,
  type Banner,
  type BannerInput,
  type BannerLinkTipo,
} from "../hooks/useVitrinaWeb";
import { AddIconButton } from "./AddIconButton";

type Tab = "banners" | "origen" | "uso";

const LINK_TIPO_LABEL: Record<BannerLinkTipo, string> = {
  catalogo: "Catálogo",
  producto: "Producto (slug)",
  whatsapp: "WhatsApp",
  url: "URL externa",
};

const PAISES_SUGERIDOS = [
  "China", "India", "Estados Unidos", "Alemania", "España",
  "Malasia", "Indonesia", "Brasil", "Colombia",
];

const BANNER_VACIO: BannerInput = {
  titulo: "",
  texto: "",
  etiqueta: "",
  activo: true,
  vigente_desde: null,
  vigente_hasta: null,
  link_tipo: "catalogo",
  link_valor: "",
};

function BannerForm({
  inicial,
  onGuardar,
  onCancelar,
  guardando,
}: {
  inicial: BannerInput;
  onGuardar: (datos: BannerInput) => void;
  onCancelar: () => void;
  guardando: boolean;
}) {
  const [datos, setDatos] = useState<BannerInput>(inicial);
  const set = <K extends keyof BannerInput>(k: K, v: BannerInput[K]) =>
    setDatos((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-2 rounded-paper border border-border bg-surface-hover/50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          placeholder="Título (ej: Envío gratis en pedidos +$300.000)"
          value={datos.titulo ?? ""}
          onChange={(e) => set("titulo", e.target.value)}
          className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent sm:col-span-2"
        />
        <input
          placeholder="Texto corto (ej: Válido esta semana)"
          value={datos.texto ?? ""}
          onChange={(e) => set("texto", e.target.value)}
          className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          placeholder="Etiqueta (ej: -10%, NUEVO)"
          value={datos.etiqueta ?? ""}
          onChange={(e) => set("etiqueta", e.target.value)}
          className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={datos.link_tipo ?? "catalogo"}
          onChange={(e) => set("link_tipo", e.target.value as BannerLinkTipo)}
          className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {Object.entries(LINK_TIPO_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <input
          placeholder={
            datos.link_tipo === "producto" ? "slug del producto"
            : datos.link_tipo === "whatsapp" ? "mensaje (opcional)"
            : datos.link_tipo === "url" ? "https://…"
            : "(no aplica para catálogo)"
          }
          value={datos.link_valor ?? ""}
          onChange={(e) => set("link_valor", e.target.value)}
          disabled={datos.link_tipo === "catalogo"}
          className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-40"
        />
        <label className="flex flex-col gap-1 text-xs text-muted">
          Vigente desde
          <input
            type="date"
            value={datos.vigente_desde ?? ""}
            onChange={(e) => set("vigente_desde", e.target.value || null)}
            className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Vigente hasta
          <input
            type="date"
            value={datos.vigente_hasta ?? ""}
            onChange={(e) => set("vigente_hasta", e.target.value || null)}
            className="rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={datos.activo ?? true}
          onChange={(e) => set("activo", e.target.checked)}
        />
        Activo
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={guardando || !datos.titulo?.trim()}
          onClick={() => onGuardar(datos)}
          className="rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-paper border border-border px-3 py-1.5 text-xs font-semibold text-muted"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function BannerCard({ banner }: { banner: Banner }) {
  const [editando, setEditando] = useState(false);
  const actualizar = useActualizarBanner();
  const eliminar = useEliminarBanner();

  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = !!banner.vigente_hasta && banner.vigente_hasta < hoy;
  const futuro = !!banner.vigente_desde && banner.vigente_desde > hoy;

  if (editando) {
    return (
      <BannerForm
        inicial={banner}
        guardando={actualizar.isPending}
        onCancelar={() => setEditando(false)}
        onGuardar={(datos) =>
          actualizar.mutateAsync({ id: banner.id, datos }).then(() => setEditando(false))
        }
      />
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-paper border-2 border-border bg-surface-panel p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {banner.etiqueta && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-extrabold text-accent">
              {banner.etiqueta}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
              banner.activo && !vencido
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-muted/20 text-muted"
            }`}
          >
            {!banner.activo ? "Inactivo" : vencido ? "Vencido" : futuro ? "Programado" : "Vigente"}
          </span>
          <span className="text-[10px] text-muted">{LINK_TIPO_LABEL[banner.link_tipo]}</span>
        </div>
        <p className="mt-1 font-bold text-ink">{banner.titulo}</p>
        {banner.texto && <p className="text-sm text-muted">{banner.texto}</p>}
        {(banner.vigente_desde || banner.vigente_hasta) && (
          <p className="mt-1 text-xs text-muted">
            {banner.vigente_desde || "…"} → {banner.vigente_hasta || "…"}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="rounded-paper border border-border px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-accent"
        >
          Editar
        </button>
        <button
          type="button"
          disabled={eliminar.isPending}
          onClick={() => {
            if (confirm(`¿Eliminar el banner "${banner.titulo}"?`)) eliminar.mutate(banner.id);
          }}
          className="rounded-paper border border-danger/40 px-2.5 py-1.5 text-xs font-semibold text-danger disabled:opacity-40"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

function BannersTab() {
  const { data, isLoading, error } = useBanners();
  const crear = useCrearBanner();
  const [creando, setCreando] = useState(false);
  const banners = useMemo(
    () => [...(data?.banners ?? [])].sort((a, b) => a.orden - b.orden),
    [data],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Se muestran en el carrusel del inicio solo los que están activos y dentro de su rango de fechas.
        </p>
        {!creando && (
          <AddIconButton title="Nuevo banner" onClick={() => setCreando(true)} />
        )}
      </div>

      {creando && (
        <BannerForm
          inicial={BANNER_VACIO}
          guardando={crear.isPending}
          onCancelar={() => setCreando(false)}
          onGuardar={(datos) => crear.mutateAsync(datos).then(() => setCreando(false))}
        />
      )}

      {isLoading && <p className="py-6 text-center text-sm text-muted">Cargando banners…</p>}
      {error && (
        <p className="rounded-paper border-2 border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">
          {error instanceof Error ? error.message : "No se pudieron cargar los banners."}
        </p>
      )}
      {!isLoading && banners.length === 0 && !creando && (
        <p className="py-6 text-center text-sm text-muted">Sin banners todavía.</p>
      )}
      <div className="space-y-2">
        {banners.map((b) => (
          <BannerCard key={b.id} banner={b} />
        ))}
      </div>
    </div>
  );
}

function OrigenTab() {
  const { data, isLoading, error } = useOrigenMaterias();
  const guardar = useGuardarOrigenMaterias();
  const [lineaDraft, setLineaDraft] = useState<Record<string, string>>({});
  const [guardandoLinea, setGuardandoLinea] = useState<string | null>(null);
  const [skuNuevo, setSkuNuevo] = useState("");
  const [paisNuevo, setPaisNuevo] = useState("");

  const lineasActuales = data?.lineas_default ?? {};
  const overrides = data?.overrides_sku ?? {};
  const resumen = data?.resumen;
  const paisesConocidos = useMemo(() => {
    const set = new Set(PAISES_SUGERIDOS);
    (resumen?.paises_usados ?? []).forEach((p) => set.add(p));
    return Array.from(set).sort();
  }, [resumen]);

  async function guardarLinea(lineaId: string) {
    const pais = (lineaDraft[lineaId] ?? lineasActuales[lineaId] ?? "").trim();
    setGuardandoLinea(lineaId);
    try {
      await guardar.mutateAsync({ lineas_default: { ...lineasActuales, [lineaId]: pais } });
    } finally {
      setGuardandoLinea(null);
    }
  }

  async function agregarOverride() {
    const sku = skuNuevo.trim();
    const pais = paisNuevo.trim();
    if (!sku || !pais) return;
    await guardar.mutateAsync({ overrides_sku: { ...overrides, [sku]: pais } });
    setSkuNuevo("");
    setPaisNuevo("");
  }

  async function quitarOverride(sku: string) {
    const resto = { ...overrides };
    delete resto[sku];
    await guardar.mutateAsync({ overrides_sku: resto });
  }

  if (isLoading) return <p className="py-6 text-center text-sm text-muted">Cargando…</p>;
  if (error) {
    return (
      <p className="rounded-paper border-2 border-danger/40 bg-danger/10 p-3 text-sm font-semibold text-danger">
        {error instanceof Error ? error.message : "No se pudo cargar el origen de materias."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {resumen && (
        <p className="rounded-paper border border-border bg-surface-hover/50 p-3 text-sm text-ink">
          <strong>{resumen.lineas_cubiertas}/{resumen.total_lineas}</strong> líneas con país asignado ·{" "}
          <strong>{resumen.overrides_sku}</strong> SKU con país propio ·{" "}
          {resumen.paises_usados.length > 0
            ? `países en uso: ${resumen.paises_usados.join(", ")}`
            : "aún sin países asignados"}
        </p>
      )}

      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-muted">
          País por línea comercial
        </h2>
        <p className="mb-2 text-xs text-muted">
          Cada línea resuelve el país de todos sus SKUs, salvo que tengan un país propio abajo. Con estas 6 filas
          ya queda cubierto todo el catálogo.
        </p>
        <div className="space-y-2">
          {LINEAS_ORIGEN.map((l) => {
            const valor = lineaDraft[l.id] ?? lineasActuales[l.id] ?? "";
            return (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-paper border border-border bg-surface-panel p-2.5">
                <span className="w-44 shrink-0 text-sm font-semibold text-ink">{l.label}</span>
                <input
                  list="vitrina-paises"
                  placeholder="País de origen"
                  value={valor}
                  onChange={(e) => setLineaDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                  className="min-w-[10rem] flex-1 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={guardandoLinea === l.id}
                  onClick={() => void guardarLinea(l.id)}
                  className="rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {guardandoLinea === l.id ? "Guardando…" : "Guardar"}
                </button>
              </div>
            );
          })}
        </div>
        <datalist id="vitrina-paises">
          {paisesConocidos.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-muted">
          Países propios por SKU (afinar después)
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            placeholder="SKU"
            value={skuNuevo}
            onChange={(e) => setSkuNuevo(e.target.value)}
            className="w-40 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <input
            list="vitrina-paises"
            placeholder="País de origen"
            value={paisNuevo}
            onChange={(e) => setPaisNuevo(e.target.value)}
            className="min-w-[10rem] flex-1 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={guardar.isPending || !skuNuevo.trim() || !paisNuevo.trim()}
            onClick={() => void agregarOverride()}
            className="rounded-paper border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            Agregar
          </button>
        </div>
        {Object.keys(overrides).length === 0 ? (
          <p className="mt-2 text-xs text-muted">Sin overrides por SKU todavía.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {Object.entries(overrides).map(([sku, pais]) => (
              <div key={sku} className="flex items-center justify-between rounded-paper border border-border bg-surface-panel px-3 py-1.5 text-sm">
                <span><strong className="text-ink">{sku}</strong> <span className="text-muted">→ {pais}</span></span>
                <button
                  type="button"
                  onClick={() => void quitarOverride(sku)}
                  className="text-xs font-semibold text-danger"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Cifra({ label, valor, sub }: { label: string; valor: number; sub?: string }) {
  return (
    <div className="rounded-paper border border-border bg-surface-panel px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-xl font-bold tabular-nums text-ink dark:text-white">{valor.toLocaleString("es-CO")}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

function pct(parte: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((parte / total) * 100)} %`;
}

function UsoTab() {
  const [dias, setDias] = useState(14);
  const { data, isLoading, isError } = useMetricasContenido(dias);

  if (isLoading) return <p className="text-sm text-muted">Cargando…</p>;
  if (isError || !data) return <p className="text-sm text-red-500">No se pudieron leer las métricas de contenido.</p>;

  const e = data.embudo;
  const sinDatos = Object.keys(data.totales).length === 0;
  const maxSerie = Math.max(1, ...data.serie.map((d) => Math.max(d.recetas, d.guias, d.carrito)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Uso de recetas paso a paso y guías vivas en mckennagroup.co. Cuenta sesiones reales (con JavaScript); los robots quedan fuera.</span>
        <div className="ml-auto flex gap-1">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={`min-h-8 rounded-paper border px-2 text-xs font-bold ${dias === d ? "border-accent bg-accent text-white" : "border-border text-ink"}`}
            >
              {d} días
            </button>
          ))}
        </div>
      </div>

      {sinDatos ? (
        <p className="rounded-paper border border-dashed border-border p-3 text-sm text-muted">
          Todavía no hay eventos en estos {dias} días. Los eventos empiezan a llegar cuando alguien abre una receta o una guía viva en la web.
        </p>
      ) : null}

      <section>
        <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Embudo del recetario</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cifra label="Abrieron una receta" valor={e.abrieron} />
          <Cifra label="Empezaron los pasos" valor={e.empezaron} sub={pct(e.empezaron, e.abrieron)} />
          <Cifra label="Terminaron" valor={e.terminaron} sub={pct(e.terminaron, e.abrieron)} />
          <Cifra label="Mandaron al carrito" valor={e.al_carrito} sub={`${e.unidades_al_carrito} unidades · ${pct(e.al_carrito, e.abrieron)}`} />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Guías vivas</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cifra label="Abrieron una guía" valor={data.sesiones.guia_abierta ?? 0} />
          <Cifra label="Usaron el dosificador" valor={data.sesiones.guia_dosificador ?? 0} sub={pct(data.sesiones.guia_dosificador ?? 0, data.sesiones.guia_abierta ?? 0)} />
          <Cifra label="Movieron el pH" valor={data.sesiones.guia_ph ?? 0} sub={pct(data.sesiones.guia_ph ?? 0, data.sesiones.guia_abierta ?? 0)} />
          <Cifra label="Saltaron a una receta" valor={data.sesiones.guia_receta_click ?? 0} />
        </div>
      </section>

      {data.serie.length ? (
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Por día (sesiones)</h2>
          <div className="flex h-24 items-end gap-1 rounded-paper border border-border bg-surface-panel p-2">
            {data.serie.map((d) => (
              <div key={d.dia} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.dia}: ${d.recetas} recetas · ${d.guias} guías · ${d.carrito} al carrito`}>
                <div className="flex w-full items-end justify-center gap-px">
                  <div className="w-1/3 rounded-t bg-accent" style={{ height: `${(d.recetas / maxSerie) * 72}px` }} />
                  <div className="w-1/3 rounded-t bg-accent/50" style={{ height: `${(d.guias / maxSerie) * 72}px` }} />
                  <div className="w-1/3 rounded-t bg-emerald-500" style={{ height: `${(d.carrito / maxSerie) * 72}px` }} />
                </div>
                <span className="text-[9px] text-muted">{d.dia.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[11px] text-muted">
            <span><i className="inline-block h-2 w-2 rounded-sm bg-accent" /> recetas</span>
            <span><i className="inline-block h-2 w-2 rounded-sm bg-accent/50" /> guías</span>
            <span><i className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> al carrito</span>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Recetas más usadas</h2>
          {data.recetas.length ? (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1">Receta</th><th className="py-1 text-right">Abiertas</th><th className="py-1 text-right">Terminadas</th><th className="py-1 text-right">Carrito</th></tr></thead>
              <tbody>
                {data.recetas.map((r) => (
                  <tr key={r.slug} className="border-t border-border/60">
                    <td className="py-1"><a className="text-accent hover:underline" href={`https://mckennagroup.co/recetario/${r.slug}`} target="_blank" rel="noreferrer">{r.slug}</a></td>
                    <td className="py-1 text-right tabular-nums">{r.abiertas}</td>
                    <td className="py-1 text-right tabular-nums">{r.terminadas}</td>
                    <td className="py-1 text-right tabular-nums">{r.carrito}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-xs text-muted">Sin recetas abiertas en el período.</p>}
        </section>
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Guías más usadas</h2>
          {data.guias.length ? (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1">Guía</th><th className="py-1 text-right">Abiertas</th><th className="py-1 text-right">Dosificador</th><th className="py-1 text-right">pH</th><th className="py-1 text-right">A receta</th></tr></thead>
              <tbody>
                {data.guias.map((g) => (
                  <tr key={g.slug} className="border-t border-border/60">
                    <td className="py-1"><a className="text-accent hover:underline" href={`https://mckennagroup.co/guias/${g.slug}`} target="_blank" rel="noreferrer">{g.slug}</a></td>
                    <td className="py-1 text-right tabular-nums">{g.abiertas}</td>
                    <td className="py-1 text-right tabular-nums">{g.dosificador}</td>
                    <td className="py-1 text-right tabular-nums">{g.ph}</td>
                    <td className="py-1 text-right tabular-nums">{g.a_receta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-xs text-muted">Sin guías abiertas en el período.</p>}
        </section>
      </div>

      {data.productos.length ? (
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink dark:text-white">Desde la ficha de producto ("Aprende a usarlo")</h2>
          <ul className="flex flex-wrap gap-2 text-xs">
            {data.productos.map((p) => (
              <li key={p.slug} className="rounded-full border border-border px-2 py-1">{p.slug} <b className="tabular-nums">{p.clics}</b></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function VitrinaWebPanel() {
  const [tab, setTab] = useState<Tab>("banners");

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2 sm:p-3">
      <header>
        <h1 className="text-base font-bold text-ink dark:text-white">🖥️ Vitrina Web</h1>
      </header>

      <div className="flex gap-2">
        {([
          ["banners", "Banners"],
          ["origen", "Origen de materias"],
          ["uso", "Uso de guías y recetas"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-10 rounded-paper border-2 px-3 py-2 text-sm font-bold transition ${
              tab === id
                ? "border-accent bg-accent text-white"
                : "border-border bg-surface-panel text-ink hover:border-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "banners" ? <BannersTab /> : tab === "origen" ? <OrigenTab /> : <UsoTab />}
    </div>
  );
}
