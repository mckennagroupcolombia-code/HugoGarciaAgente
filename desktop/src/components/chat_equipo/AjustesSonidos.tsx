import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useCanalesEquipo } from "../../hooks/useCanalesEquipo";
import { useUsuariosEquipo } from "../../hooks/useConversaciones";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { CATALOGO_SONIDOS, SILENCIO, reproducirSonido, sonidoDeCanal, sonidoPorId, useAlertasSonido, type Juego } from "../../lib/alertasSonido";
import { colorDePersona, iniciales } from "../../lib/personaColor";
import "./chatEquipo.css";

const JUEGOS: Juego[] = ["Duck Hunt", "Circus Charlie"];

/**
 * Elegir un sonido: lista desplegable agrupada por juego + ▶ para oírlo.
 * `heredado` es lo que sonaría sin regla propia (se muestra como primera opción).
 */
export function SelectorSonido({ valor, onCambiar, heredado, etiqueta }: {
  valor: string | null;
  onCambiar: (v: string | null) => void;
  heredado?: string;
  etiqueta: string;
}) {
  const efectivo = valor ?? heredado ?? null;
  return (
    <span className="flex items-center gap-1.5">
      <select
        value={valor ?? ""}
        aria-label={etiqueta}
        onChange={(e) => {
          const v = e.target.value || null;
          onCambiar(v);
          if (v && v !== SILENCIO) reproducirSonido(v, { forzar: true });
        }}
        className={`min-w-0 max-w-[13.5rem] flex-1 rounded-lg border px-2 py-2 text-[14px] ${valor ? "border-accent bg-accent/10 font-bold text-ink" : "border-border bg-surface-input text-ink-secondary"}`}
      >
        {heredado !== undefined && (
          <option value="">Por defecto{sonidoPorId(heredado) ? ` · ${sonidoPorId(heredado)!.icono} ${sonidoPorId(heredado)!.nombre}` : ""}</option>
        )}
        {JUEGOS.map((j) => (
          <optgroup key={j} label={j}>
            {CATALOGO_SONIDOS.filter((s) => s.juego === j).map((s) => (
              <option key={s.id} value={s.id}>{s.icono} {s.nombre}</option>
            ))}
          </optgroup>
        ))}
        <option value={SILENCIO}>🔇 Sin sonido</option>
      </select>
      <button
        type="button"
        data-sin-sonido
        disabled={!efectivo || efectivo === SILENCIO}
        onClick={() => efectivo && reproducirSonido(efectivo, { forzar: true })}
        className="mck-btn-no-fx flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[15px] text-accent hover:border-accent disabled:opacity-30"
        aria-label={`Oír el sonido de ${etiqueta}`}
        title="Oír"
      >
        ▶
      </button>
    </span>
  );
}

type Pestana = "personas" | "grupos";

/**
 * Ajustes de alertas sonoras: general, por persona (quién te pide algo o te escribe) y por
 * grupo del chat. Modal a pantalla completa en el celular, centrado en escritorio.
 */
export default function AjustesSonidos({ onCerrar, canalInicial }: { onCerrar: () => void; canalInicial?: number }) {
  const ajustes = useAlertasSonido((s) => s.ajustes);
  const cambiar = useAlertasSonido((s) => s.cambiar);
  const ponerPersona = useAlertasSonido((s) => s.ponerPersona);
  const ponerCanal = useAlertasSonido((s) => s.ponerCanal);
  const yo = useTicketsAuth((s) => s.user?.id);
  const usuarios = useUsuariosEquipo();
  const canales = useCanalesEquipo();
  const [pestana, setPestana] = useState<Pestana>(canalInicial != null ? "grupos" : "personas");
  const [q, setQ] = useState("");

  const personas = useMemo(
    () => (usuarios.data ?? [])
      .filter((u) => u.id !== yo && u.activo !== 0)
      .filter((u) => !q.trim() || u.nombre.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => Number(Boolean(ajustes.personas[String(b.id)])) - Number(Boolean(ajustes.personas[String(a.id)])) || a.nombre.localeCompare(b.nombre)),
    [usuarios.data, yo, q, ajustes.personas],
  );
  const grupos = useMemo(
    () => (canales.data?.canales ?? [])
      .filter((c) => !q.trim() || c.nombre.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => (a.id === canalInicial ? -1 : b.id === canalInicial ? 1 : 0)),
    [canales.data, q, canalInicial],
  );

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={onCerrar}>
      <div role="dialog" aria-label="Sonidos de los avisos" onMouseDown={(e) => e.stopPropagation()}
        className="mck-sonidos-modal flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface-panel shadow-paper-lg sm:rounded-3xl">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="text-[28px] leading-none" aria-hidden>🎮</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-black text-ink">Sonidos de los avisos</h2>
            <p className="text-[13px] text-muted">Reconoce de oído quién te pide algo o dónde te escriben. Sonidos de Duck Hunt y Circus Charlie.</p>
          </div>
          <button onClick={onCerrar} className="mck-btn-no-fx flex h-10 w-10 items-center justify-center rounded-full text-[18px] text-muted hover:bg-surface-hover hover:text-ink" aria-label="Cerrar">✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-[15px] font-bold text-ink">Avisos con sonido</span>
                <span className="block text-[13px] text-muted">Suenan con la app abierta en este dispositivo.</span>
              </span>
              <input type="checkbox" checked={ajustes.activo} onChange={(e) => cambiar({ activo: e.target.checked })}
                className="h-6 w-6 accent-[rgb(var(--mck-accent))]" />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[14px] font-bold text-ink">Volumen</span>
              <input type="range" min={5} max={100} step={5} value={ajustes.volumen} disabled={!ajustes.activo}
                onChange={(e) => cambiar({ volumen: Number(e.target.value) })}
                onPointerUp={() => reproducirSonido(ajustes.general, { forzar: true })}
                className="min-w-0 flex-1 accent-[rgb(var(--mck-accent))]" aria-label="Volumen" />
              <span className="w-10 text-right font-mono text-[13px] text-muted">{ajustes.volumen}%</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[13px] font-bold text-ink-secondary">📋 Te hacen una solicitud</p>
                <SelectorSonido etiqueta="solicitudes" valor={ajustes.solicitud} onCambiar={(v) => cambiar({ solicitud: v ?? "dh_ronda" })} />
              </div>
              <div>
                <p className="mb-1 text-[13px] font-bold text-ink-secondary">💬 Te escriben en un grupo</p>
                <label className="mb-1.5 flex items-center gap-2 text-[13.5px] text-ink">
                  <input type="checkbox" checked={ajustes.tono_por_grupo !== false} onChange={(e) => cambiar({ tono_por_grupo: e.target.checked })} />
                  Cada grupo con su propio tono (se reconoce de oído)
                </label>
                {ajustes.tono_por_grupo === false && (
                  <SelectorSonido etiqueta="mensajes de grupo" valor={ajustes.general} onCambiar={(v) => cambiar({ general: v ?? "dh_ladrido" })} />
                )}
              </div>
            </div>
          </section>

          <div className="mt-4 flex items-center gap-2">
            <div className="flex rounded-full border border-border bg-surface p-1" role="tablist">
              {(["personas", "grupos"] as Pestana[]).map((p) => (
                <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}
                  className={`mck-btn-no-fx rounded-full px-4 py-1.5 text-[14px] font-bold ${pestana === p ? "bg-accent text-white" : "text-ink-secondary"}`}>
                  {p === "personas" ? "Por persona" : "Por grupo"}
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
              className="min-w-0 flex-1 rounded-full border border-border bg-surface-input px-3 py-2 text-[14px]" />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {pestana === "personas"
              ? "Cuando esta persona te pida algo o escriba en un grupo, suena su sonido (si el grupo no tiene uno propio)."
              : "Todo lo que se escriba en este grupo suena así, sin importar quién lo escriba."}
          </p>

          <ul className="mt-3 space-y-2">
            {pestana === "personas" && personas.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-black text-white"
                  style={{ background: colorDePersona(u.nombre) }}>{iniciales(u.nombre)}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{u.nombre}</span>
                <SelectorSonido etiqueta={u.nombre} valor={ajustes.personas[String(u.id)] ?? null}
                  heredado={ajustes.solicitud} onCambiar={(v) => ponerPersona(u.id, v)} />
              </li>
            ))}
            {pestana === "grupos" && grupos.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2.5 ${c.id === canalInicial ? "border-accent bg-accent/5" : "border-border bg-surface"}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-[15px] font-black text-accent">
                  {c.nombre.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{c.nombre}</span>
                <SelectorSonido etiqueta={c.nombre} valor={ajustes.canales[String(c.id)] ?? null}
                  heredado={sonidoDeCanal({ ...ajustes, canales: {} }, c.id)} onCambiar={(v) => ponerCanal(c.id, v)} />
              </li>
            ))}
            {pestana === "personas" && usuarios.isLoading && <li className="text-[14px] text-muted">Cargando el equipo…</li>}
            {pestana === "grupos" && canales.isLoading && <li className="text-[14px] text-muted">Cargando grupos…</li>}
          </ul>
        </div>
      </div>
    </div>,
    document.body,
  );
}
