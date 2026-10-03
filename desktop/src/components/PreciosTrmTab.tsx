import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

// Precios indexados a la TRM BanRep — ver app/services/precios_trm.py.
// El cron diario propone; aquí un administrador aprueba o descarta.

interface Config {
  traslado_pct: number;
  umbral_pct: number;
  redondeo: number;
  trm_base_inicial: number | null;
  conservar_900: boolean;
}

interface Ajuste {
  id: number;
  sku: string;
  nombre: string;
  meli_estado: string | null;
  precio_anterior: number;
  precio_nuevo: number;
  trm_base: number;
  trm_actual: number;
  variacion_trm_pct: number;
  ajuste_pct: number;
  estado: string;
  detalle: string | null;
  resuelto_en: string | null;
  resuelto_por: string | null;
}

interface EstadoResp {
  config: Config;
  trm: { valor?: number; vigencia?: string; error?: string };
  pendientes: Ajuste[];
  historial: Ajuste[];
  anclas: { total: number; trm_base_promedio: number | null };
  activo: boolean;
}

const cop = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;

const ESTADO_LABEL: Record<string, string> = {
  aplicado: "Aplicado",
  error: "Error",
  descartado: "Descartado",
  desactualizado: "No aplicado (precio cambió)",
};

export default function PreciosTrmTab() {
  const [data, setData] = useState<EstadoResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cfg, setCfg] = useState<Record<Exclude<keyof Config, "conservar_900">, string>>({
    traslado_pct: "",
    umbral_pct: "",
    redondeo: "",
    trm_base_inicial: "",
  });
  const [conservar900, setConservar900] = useState(true);
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<EstadoResp>("/api/precios-trm");
      setData(d);
      setError(null);
      setSel((prev) => new Set(d.pendientes.filter((p) => p.estado === "propuesto" && (prev.size === 0 || prev.has(p.id))).map((p) => p.id)));
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void cargar().then((d) => {
      if (!d) return;
      setCfg({
        traslado_pct: String(d.config.traslado_pct),
        umbral_pct: String(d.config.umbral_pct),
        redondeo: String(d.config.redondeo),
        trm_base_inicial: d.config.trm_base_inicial == null ? "" : String(d.config.trm_base_inicial),
      });
      setConservar900(d.config.conservar_900);
    });
  }, [cargar]);

  const aplicando = (data?.pendientes ?? []).some((p) => p.estado === "aplicando");
  useEffect(() => {
    if (!aplicando) return;
    const t = setInterval(() => void cargar(), 4000);
    return () => clearInterval(t);
  }, [aplicando, cargar]);

  const propuestas = useMemo(() => (data?.pendientes ?? []).filter((p) => p.estado === "propuesto"), [data]);
  const seleccionadas = propuestas.filter((p) => sel.has(p.id));

  // Vista previa en vivo: el mismo cálculo del backend con los valores del formulario.
  const ejemplo = useMemo(() => {
    const trm = data?.trm.valor;
    const base = data?.anclas.trm_base_promedio;
    const traslado = Number(cfg.traslado_pct);
    if (!trm || !base || !Number.isFinite(traslado)) return null;
    const variacion = (trm / base - 1) * 100;
    return { trm, base, variacion, ajuste: (variacion * traslado) / 100 };
  }, [data, cfg.traslado_pct]);

  const accion = async (fn: () => Promise<string>) => {
    setOcupado(true);
    setMsg(null);
    setError(null);
    try {
      setMsg(await fn());
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const guardarConfig = () =>
    accion(async () => {
      await api.put("/api/precios-trm/config", {
        traslado_pct: Number(cfg.traslado_pct),
        umbral_pct: Number(cfg.umbral_pct),
        redondeo: Number(cfg.redondeo),
        trm_base_inicial: cfg.trm_base_inicial.trim() === "" ? null : Number(cfg.trm_base_inicial),
        conservar_900: conservar900,
      });
      return "Configuración guardada. Recalcula la propuesta para verla con estos valores.";
    });

  const proponer = () =>
    accion(async () => {
      const r = await api.post<{ propuestas: number; suben: number; bajan: number; anclas_nuevas: number; reancladas: number }>(
        "/api/precios-trm/proponer",
        {},
        { timeoutMs: 60_000 },
      );
      setSel(new Set());
      const extra = [
        r.anclas_nuevas ? `${r.anclas_nuevas} productos nuevos anclados a la TRM de referencia` : "",
        r.reancladas ? `${r.reancladas} con precio cambiado a mano, anclados a la TRM de hoy` : "",
      ].filter(Boolean);
      return `${r.propuestas} propuesta(s): ${r.suben} suben, ${r.bajan} bajan.${extra.length ? ` ${extra.join(" · ")}.` : ""}`;
    });

  const aplicar = () => {
    if (!seleccionadas.length) return;
    const ok = window.confirm(
      `Se cambiará el precio de ${seleccionadas.length} producto(s) en MercadoLibre y Alegra (la web se actualiza después). ¿Continuar?`,
    );
    if (!ok) return;
    void accion(async () => {
      const r = await api.post<{ en_proceso: number }>("/api/precios-trm/aplicar", { ids: seleccionadas.map((p) => p.id) });
      setSel(new Set());
      return `Aplicando ${r.en_proceso} precio(s)… el estado se actualiza solo.`;
    });
  };

  const descartar = () =>
    accion(async () => {
      const r = await api.post<{ descartadas: number }>("/api/precios-trm/descartar", { ids: seleccionadas.map((p) => p.id) });
      setSel(new Set());
      return `${r.descartadas} propuesta(s) descartada(s).`;
    });

  const toggle = (id: number) =>
    setSel((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const input =
    "w-full rounded-paper border-2 border-border bg-surface-input px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";
  const boton =
    "rounded-paper border-2 border-border px-3 py-2 text-sm font-semibold text-ink hover:border-accent disabled:opacity-40";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Cada precio guarda la <strong className="text-ink">TRM del día en que se fijó</strong>. Cuando la TRM oficial
        (BanRep) se aleja más que el umbral, se propone mover el precio: variación de la TRM × traslado. Sube y baja.
        Una tarea diaria calcula la propuesta; <strong className="text-ink">nada cambia hasta que la apruebes aquí</strong>.
        Si alguien cambia un precio a mano, ese precio se toma como nueva base con la TRM de ese día.
      </p>

      {error && <div className="rounded-paper border-2 border-red-400 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
      {msg && <div className="rounded-paper border-2 border-border bg-surface-hover p-3 text-sm text-ink">{msg}</div>}
      {data && !data.activo && (
        <div className="rounded-paper border-2 border-orange-400 p-3 text-sm text-orange-800 dark:text-orange-200">
          La tarea diaria está apagada (PRECIOS_TRM_ACTIVO=0). Puedes recalcular a mano.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="rounded-paper border-2 border-border bg-surface-panel p-3">
          <div className="text-xs font-semibold uppercase text-muted">TRM oficial hoy</div>
          <div className="text-2xl font-bold text-ink">
            {data?.trm.valor ? cop(data.trm.valor).replace("$", "$ ") : "—"}
          </div>
          <div className="text-xs text-muted">
            {data?.trm.error ?? (data?.trm.vigencia ? `Vigente desde ${data.trm.vigencia}` : "")}
          </div>
          {data && (
            <div className="mt-2 text-xs text-muted">
              {data.anclas.total} productos anclados · TRM base promedio{" "}
              {data.anclas.trm_base_promedio ? cop(data.anclas.trm_base_promedio) : "—"}
            </div>
          )}
          {ejemplo && (
            <div className="mt-2 text-xs text-ink">
              Promedio: TRM {pct(ejemplo.variacion)} → precios {pct(ejemplo.ajuste)}
            </div>
          )}
        </div>

        <div className="rounded-paper border-2 border-border bg-surface-panel p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-muted">
              Traslado %
              <input className={input} inputMode="decimal" value={cfg.traslado_pct}
                onChange={(e) => setCfg({ ...cfg, traslado_pct: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Umbral TRM %
              <input className={input} inputMode="decimal" value={cfg.umbral_pct}
                onChange={(e) => setCfg({ ...cfg, umbral_pct: e.target.value })} />
            </label>
            <label className="text-xs text-muted">
              Redondear a
              <select className={input} value={cfg.redondeo} onChange={(e) => setCfg({ ...cfg, redondeo: e.target.value })}>
                {[1, 10, 50, 100, 500, 1000].map((v) => (
                  <option key={v} value={v}>{cop(v)}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted" title="TRM con la que se anclan los productos que aún no tienen base. Vacío = la de hoy.">
              TRM de referencia inicial
              <input className={input} inputMode="decimal" placeholder="la de hoy" value={cfg.trm_base_inicial}
                onChange={(e) => setCfg({ ...cfg, trm_base_inicial: e.target.value })} />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={conservar900} onChange={(e) => setConservar900(e.target.checked)} />
            Conservar precios terminados en 900 (11.900 → 12.900, al 900 más cercano)
          </label>
          <p className="mt-2 text-xs text-muted">
            Traslado 60 % = si la TRM sube 5 %, el precio sube 3 %. La TRM de referencia inicial solo se usa la primera vez
            que se ve un producto; después cuenta la base de cada uno.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={boton} disabled={ocupado} onClick={() => void guardarConfig()}>Guardar</button>
            <button type="button" className={boton} disabled={ocupado} onClick={() => void proponer()}>
              {ocupado ? "Calculando…" : "Recalcular propuesta"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-ink">
          Propuesta pendiente ({propuestas.length})
          {aplicando && <span className="ml-2 text-xs font-normal text-muted">aplicando…</span>}
        </h3>
        <button type="button" className={boton} disabled={!propuestas.length}
          onClick={() => setSel(sel.size === propuestas.length ? new Set() : new Set(propuestas.map((p) => p.id)))}>
          {sel.size === propuestas.length && propuestas.length ? "Ninguno" : "Todos"}
        </button>
        <button type="button" className={boton} disabled={ocupado || !seleccionadas.length} onClick={() => void descartar()}>
          Descartar
        </button>
        <button type="button" disabled={ocupado || !seleccionadas.length} onClick={aplicar}
          className="rounded-paper border-2 border-accent bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Aplicar {seleccionadas.length || ""}
        </button>
      </div>

      {(data?.pendientes.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">No hay ajustes pendientes: la TRM no se ha movido más que el umbral.</p>
      ) : (
        <div className="overflow-x-auto rounded-paper border-2 border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-hover text-left text-xs text-muted">
              <tr>
                <th className="p-2" />
                <th className="p-2">Producto</th>
                <th className="p-2 text-right">TRM base → hoy</th>
                <th className="p-2 text-right">Precio actual</th>
                <th className="p-2 text-right">Nuevo</th>
                <th className="p-2 text-right">Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {data!.pendientes.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="p-2">
                    <input type="checkbox" disabled={p.estado !== "propuesto"} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="p-2">
                    <div className="text-ink">{p.nombre}</div>
                    <div className="text-xs text-muted">
                      {p.sku}{p.meli_estado && p.meli_estado !== "active" ? ` · ${p.meli_estado}` : ""}
                      {p.estado === "aplicando" ? " · aplicando…" : ""}
                    </div>
                  </td>
                  <td className="p-2 text-right text-xs text-muted">
                    {cop(p.trm_base)} → {cop(p.trm_actual)}
                    <div>{pct(p.variacion_trm_pct)}</div>
                  </td>
                  <td className="p-2 text-right">{cop(p.precio_anterior)}</td>
                  <td className="p-2 text-right font-semibold text-ink">{cop(p.precio_nuevo)}</td>
                  <td className={`p-2 text-right font-semibold ${p.ajuste_pct > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300"}`}>
                    {pct(p.ajuste_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button type="button" className="text-sm font-semibold text-accent" onClick={() => setVerHistorial(!verHistorial)}>
          {verHistorial ? "Ocultar" : "Ver"} historial ({data?.historial.length ?? 0})
        </button>
        {verHistorial && (
          <ul className="mt-2 space-y-1 text-sm">
            {data?.historial.map((h) => (
              <li key={h.id} className="rounded-paper border border-border p-2">
                <span className="font-semibold text-ink">{ESTADO_LABEL[h.estado] ?? h.estado}</span>{" "}
                · {h.nombre} · {cop(h.precio_anterior)} → {cop(h.precio_nuevo)} ({pct(h.ajuste_pct)})
                <div className="text-xs text-muted">
                  {h.resuelto_en?.slice(0, 16).replace("T", " ")} {h.resuelto_por ? `· ${h.resuelto_por}` : ""}
                  {h.detalle ? ` · ${h.detalle}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
