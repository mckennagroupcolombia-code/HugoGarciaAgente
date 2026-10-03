/**
 * Tablero del proyecto (3-oct-2026): la vista principal de Colaboradores. El edificio queda como
 * pestaña secundaria.
 *
 * Por qué. Entre Armando y un colaborador no hay módulos que poner en pisos: hay una conversación
 * que deja ideas, pruebas, decisiones y tropiezos. El tablero responde en orden: de dónde
 * partimos, la meta, quién hace qué, qué salió, qué nos frena, qué decidimos, qué sigue y a quién
 * le toca — y el ritmo: cuánto tarda cada uno desde que ve lo del otro hasta que responde.
 *
 * Cada tarjeta se guarda sola (PATCH con lo que cambió): dos personas editando a la vez no se pisan.
 * «Traer del chat» lee el chat exportado de WhatsApp y deja convertir mensajes en tarjetas uno a
 * uno; el texto del chat no se guarda en el servidor. Backend: app/services/colab_tablero.py.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { AuthImg, INP, MINI } from "./campos";
import type { Adjunto } from "./modelo";
import { Sprite, type SpriteId } from "./pixel";

type TipoT = "origen" | "meta" | "rol" | "resultado" | "obstaculo" | "decision" | "tarea" | "idea" | "acuerdo";
type Rel = "viene_de" | "resuelve" | "bloquea";
type Fuente = { canal: string; autor: string; fecha: string; texto: string };
export type Tarjeta = {
  id: number; tipo: TipoT; titulo: string; texto: string; porque: string;
  estado: "abierto" | "hecho" | "descartado"; turno_de: number | null; turno_desde: string | null;
  fecha_hecho: string | null; fuente: Fuente | null; adjuntos: Adjunto[]; enlaces: { a: number; rel: Rel }[];
  acuerdos: Record<string, string>; creado_por: number; creado_en: string; actualizado_por: number; actualizado_en: string;
};
type Resumen = { n: number; mediana_min?: number; p75_min?: number; p90_min?: number };
type RitmoPersona = {
  nombre: string; en_ver: Resumen; en_responder: Resumen; total: Resumen;
  esperando_desde: string | null; visto_pendiente: boolean; espera_min: number | null;
};
type RitmoChat = {
  desde: string | null; hasta: string | null; mensajes: number; guardado_en?: string;
  personas: Record<string, Resumen & { bajo_5_min?: number; mas_de_12_h?: number; nombre?: string }>;
};
type Tablero = {
  tarjetas: Tarjeta[]; participantes: Record<string, string>;
  ritmo: { app: Record<string, RitmoPersona>; chat: RitmoChat | null };
};
type Mensaje = { i: number; fecha: string; autor: string; texto: string };

const SECCIONES: { tipo: TipoT; titulo: string; pregunta: string; sprite: SpriteId }[] = [
  { tipo: "origen", titulo: "De dónde partimos", pregunta: "¿Cómo empezó esto y con qué contamos?", sprite: "cofre" },
  { tipo: "meta", titulo: "La meta", pregunta: "¿Qué tiene que pasar para decir que funcionó?", sprite: "trofeo" },
  { tipo: "rol", titulo: "Quién hace qué", pregunta: "¿Qué pone cada uno y qué recibe?", sprite: "jugador" },
  { tipo: "obstaculo", titulo: "Lo que nos frena", pregunta: "Problemas abiertos y cómo se resolvieron", sprite: "alerta" },
  { tipo: "decision", titulo: "Decisiones", pregunta: "Lo que hay que acordar entre los dos", sprite: "urna" },
  { tipo: "tarea", titulo: "Próxima jugada", pregunta: "Qué sigue y a quién le toca", sprite: "reloj" },
  { tipo: "resultado", titulo: "Resultados", pregunta: "Lo que ya salió, con fecha y prueba", sprite: "estrella" },
  { tipo: "acuerdo", titulo: "Acuerdos", pregunta: "Precios, comisiones y reglas que ya quedaron", sprite: "pulgar" },
  { tipo: "idea", titulo: "Ideas", pregunta: "Para después: sin compromiso todavía", sprite: "gema" },
];
const NOMBRE_TIPO: Record<TipoT, string> = {
  origen: "Punto de partida", meta: "Meta", rol: "Quién hace qué", resultado: "Resultado", obstaculo: "Obstáculo",
  decision: "Decisión", tarea: "Próxima jugada", idea: "Idea", acuerdo: "Acuerdo",
};
const SPRITE_TIPO = Object.fromEntries(SECCIONES.map((s) => [s.tipo, s.sprite])) as Record<TipoT, SpriteId>;
const REL_TXT: Record<Rel, string> = { viene_de: "viene de", resuelve: "resuelve", bloquea: "bloquea" };
const CON_TURNO: TipoT[] = ["obstaculo", "decision", "tarea", "idea"];
const CON_ACUERDO: TipoT[] = ["meta", "rol", "decision", "acuerdo"];

/** Los momentos del servidor son UTC sin zona («2026-10-03 14:00:00»). */
function utc(s?: string | null) {
  return s ? new Date(s.replace(" ", "T") + (s.length > 10 ? "Z" : "T00:00:00")) : null;
}
export function fmtMin(m?: number | null) {
  if (m == null) return "—";
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const coma = (x: number, u: string) => `${String(Math.round(x * 10) / 10).replace(".", ",")} ${u}`;
  if (m < 60 * 24) return coma(m / 60, "h");
  return coma(m / 1440, "d");
}
function hace(s?: string | null) {
  const d = utc(s);
  return d ? fmtMin((Date.now() - d.getTime()) / 60000) : "—";
}
function fechaCorta(s?: string | null) {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${Number(d)}-${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(m) - 1]}${y === String(new Date().getFullYear()) ? "" : ` ${y}`}`;
}

// ─── Ritmo ───────────────────────────────────────────────────────────────────

function RitmoBar({ t, yoId }: { t: Tablero; yoId: number }) {
  const ids = Object.keys(t.participantes).sort((a, b) => Number(Number(b) === yoId) - Number(Number(a) === yoId));
  const abiertas = t.tarjetas.filter((x) => x.estado === "abierto" && x.turno_de);
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="ritmo">
      {ids.map((id) => {
        const r = t.ritmo.app[id];
        const suyas = abiertas.filter((x) => String(x.turno_de) === id)
          .sort((a, b) => (a.turno_desde || "").localeCompare(b.turno_desde || ""));
        const chat = t.ritmo.chat?.personas[id];
        const nombre = t.participantes[id]?.split(" ")[0] || "—";
        return (
          <div key={id} className="rounded-xl border border-border bg-surface-panel p-2.5 text-sm">
            <p className="px-t flex items-center justify-between font-bold text-ink">
              <span>{Number(id) === yoId ? "Tú" : nombre}</span>
              {suyas.length > 0 && (
                <span className="rounded bg-accent px-1.5 text-[11px] text-white">
                  {suyas.length === 1 ? "le toca 1" : `le tocan ${suyas.length}`} · la más vieja hace {hace(suyas[0].turno_desde)}
                </span>
              )}
            </p>
            {r && (r.total.n > 0 || r.esperando_desde) ? (
              <p className="mt-1 text-xs text-ink-secondary">
                {r.total.n > 0 && <>Ve lo nuevo en <b>{fmtMin(r.en_ver.mediana_min)}</b> y responde en <b>{fmtMin(r.en_responder.mediana_min)}</b> (mediana, {r.total.n} {r.total.n === 1 ? "vez" : "veces"}). </>}
                {r.esperando_desde && (
                  <span className="font-bold text-ink">
                    {r.visto_pendiente ? "Ya lo vio; " : "Sin ver; "}hay algo esperando respuesta hace {fmtMin(r.espera_min)}.
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">Aún no hay idas y vueltas en el tablero para medir.</p>
            )}
            {chat && chat.n > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                En WhatsApp ({fechaCorta(t.ritmo.chat?.desde)} → {fechaCorta(t.ritmo.chat?.hasta)}): responde en {fmtMin(chat.mediana_min)} la
                mitad de las veces; 9 de cada 10 antes de {fmtMin(chat.p90_min)}; {chat.mas_de_12_h ?? 0} esperas de más de 12 h.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tarjeta (vista) ─────────────────────────────────────────────────────────

function Chip({ children, fuerte }: { children: React.ReactNode; fuerte?: boolean }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${fuerte ? "border-accent bg-accent text-white" : "border-border text-ink-secondary"}`}>{children}</span>;
}

function CartaT({ t, did, part, yoId, todas, onAbrir }: {
  t: Tarjeta; did: number; part: Record<string, string>; yoId: number; todas: Tarjeta[]; onAbrir: () => void;
}) {
  const foto = t.adjuntos.find((a) => a.tipo === "imagen");
  const quien = (uid?: number | null) => (uid === yoId ? "ti" : part[String(uid)]?.split(" ")[0] || "—");
  const ids = Object.keys(part);
  const resueltaPor = todas.filter((o) => o.enlaces.some((e) => e.a === t.id && e.rel === "resuelve"));
  return (
    <button type="button" onClick={onAbrir} data-tarjeta={t.id}
            className={`block w-full rounded-xl border bg-surface-panel p-2 text-left hover:bg-surface-hover ${t.estado === "abierto" ? "border-border" : "border-dashed border-border opacity-75"}`}>
      <span className="flex gap-2">
        {foto && (
          <span className="h-14 w-14 shrink-0 overflow-hidden rounded border border-border">
            <AuthImg did={did} mid={foto.id} className="h-full w-full object-cover" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <b className={`block text-sm text-ink ${t.estado === "descartado" ? "line-through" : ""}`}>{t.titulo || t.texto.slice(0, 80)}</b>
          {t.texto && t.titulo && <span className="line-clamp-2 block text-xs text-ink-secondary">{t.texto}</span>}
        </span>
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        {t.fecha_hecho && <Chip>{fechaCorta(t.fecha_hecho)}</Chip>}
        {t.estado === "abierto" && t.turno_de && <Chip fuerte>le toca a {quien(t.turno_de)} · {hace(t.turno_desde)}</Chip>}
        {t.estado === "hecho" && CON_TURNO.includes(t.tipo) && <Chip>{t.tipo === "obstaculo" ? "resuelto" : "hecho"}</Chip>}
        {t.estado === "descartado" && <Chip>descartado</Chip>}
        {CON_ACUERDO.includes(t.tipo) && (
          <Chip>{ids.map((id) => `${t.acuerdos[id] ? "✓" : "○"} ${quien(Number(id)) === "ti" ? "tú" : quien(Number(id))}`).join("  ")}</Chip>
        )}
        {resueltaPor.length > 0 && <Chip>lo resuelve: {resueltaPor.map((o) => o.titulo || "…").join(", ").slice(0, 60)}</Chip>}
        {t.enlaces.length > 0 && <Chip>↔ {t.enlaces.length}</Chip>}
        {t.adjuntos.length > 0 && <Chip>📎 {t.adjuntos.length}</Chip>}
        {t.fuente && <Chip>💬 {t.fuente.autor.split(" ")[0]}</Chip>}
      </span>
    </button>
  );
}

// ─── Hoja de edición ─────────────────────────────────────────────────────────

type Borrador = Omit<Partial<Tarjeta>, "id"> & { tipo: TipoT };

function HojaTarjeta({ did, inicial, id, todas, part, yoId, subir, onCerrar, onCambio }: {
  did: number; inicial: Borrador; id: number | null; todas: Tarjeta[]; part: Record<string, string>; yoId: number;
  subir: (f: File) => Promise<Adjunto | null>; onCerrar: () => void; onCambio: () => void;
}) {
  const [b, setB] = useState<Borrador>(inicial);
  const [cambiado, setCambiado] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nuevoEnlace, setNuevoEnlace] = useState<{ a: string; rel: Rel }>({ a: "", rel: "resuelve" });
  const fileRef = useRef<HTMLInputElement>(null);
  const actual = id != null ? todas.find((x) => x.id === id) : undefined;
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => {
    setB((x) => ({ ...x, [k]: v }));
    setCambiado((c) => new Set(c).add(k as string));
  };

  async function adjuntar(files: File[]) {
    const nuevos: Adjunto[] = [];
    for (const f of files) { const a = await subir(f); if (a) nuevos.push(a); }
    if (nuevos.length) set("adjuntos", [...(b.adjuntos ?? []), ...nuevos]);
  }

  async function guardar(cerrar = true) {
    setError(null);
    setOcupado(true);
    try {
      if (id == null) {
        if (!(b.titulo || "").trim() && !(b.texto || "").trim()) { setError("Ponle un título o un texto"); return; }
        await api.post(`/api/colaboradores/diagramas/${did}/tarjetas`, b);
      } else if (cambiado.size) {
        const cambios = Object.fromEntries([...cambiado].map((k) => [k, b[k as keyof Borrador] ?? null]));
        await api.patch(`/api/colaboradores/diagramas/${did}/tarjetas/${id}`, cambios);
      }
      setCambiado(new Set());
      onCambio();
      if (cerrar) onCerrar();
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }

  async function acordar(si: boolean) {
    if (id == null) return;
    if (cambiado.size) await guardar(false);
    try {
      await api.post(`/api/colaboradores/diagramas/${did}/tarjetas/${id}/acuerdo`, { de_acuerdo: si });
      onCambio();
    } catch (e) { setError((e as Error).message); }
  }

  async function borrar() {
    if (id == null || !window.confirm("¿Quitar esta tarjeta del tablero?")) return;
    try { await api.delete(`/api/colaboradores/diagramas/${did}/tarjetas/${id}`); onCambio(); onCerrar(); }
    catch (e) { setError((e as Error).message); }
  }

  const ids = Object.keys(part);
  const otras = todas.filter((x) => x.id !== id);
  const enlaces = b.enlaces ?? [];
  const nom = (uid: string) => (Number(uid) === yoId ? "Tú" : part[uid]?.split(" ")[0] || uid);

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/20" onClick={() => void guardar()} aria-hidden="true" />
      <div className="px-hoja fixed inset-x-0 bottom-0 z-[60] mx-auto max-h-[85dvh] w-full max-w-lg space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
           style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }} role="dialog" aria-label="Tarjeta">
        <div className="flex items-center gap-2">
          <Sprite s={SPRITE_TIPO[b.tipo]} px={2} />
          <select value={b.tipo} onChange={(e) => set("tipo", e.target.value as TipoT)} className={`${MINI} min-w-0 flex-1 font-bold`} aria-label="Tipo">
            {SECCIONES.map((s) => <option key={s.tipo} value={s.tipo}>{NOMBRE_TIPO[s.tipo]}</option>)}
          </select>
          <button type="button" onClick={() => void guardar()} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
        </div>
        <input value={b.titulo ?? ""} onChange={(e) => set("titulo", e.target.value)} placeholder="En una línea: ¿qué es?"
               className="w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm font-bold text-ink" />
        <textarea value={b.texto ?? ""} rows={4} onChange={(e) => set("texto", e.target.value)}
                  onPaste={(e) => {
                    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                    if (imgs.length) { e.preventDefault(); void adjuntar(imgs); }
                  }}
                  placeholder="El detalle. Puedes pegar aquí una captura (Ctrl+V)." className={INP} />
        <textarea value={b.porque ?? ""} rows={2} onChange={(e) => set("porque", e.target.value)}
                  placeholder="¿Por qué? (lo que alguien de fuera necesita para entenderlo)" className={INP} />

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Cuándo pasó
            <input type="date" value={(b.fecha_hecho ?? "").slice(0, 10)} onChange={(e) => set("fecha_hecho", e.target.value || null)}
                   className={`${MINI} mt-0.5 w-full`} />
          </label>
          {CON_TURNO.includes(b.tipo) && (
            <label className="text-xs text-muted">
              Estado
              <select value={b.estado ?? "abierto"} onChange={(e) => set("estado", e.target.value as Tarjeta["estado"])}
                      className={`${MINI} mt-0.5 w-full`}>
                <option value="abierto">abierto</option>
                <option value="hecho">{b.tipo === "obstaculo" ? "resuelto" : "hecho"}</option>
                <option value="descartado">descartado</option>
              </select>
            </label>
          )}
          {CON_TURNO.includes(b.tipo) && (b.estado ?? "abierto") === "abierto" && (
            <label className="col-span-2 text-xs text-muted">
              Le toca a
              <select value={b.turno_de ?? ""} onChange={(e) => set("turno_de", e.target.value ? Number(e.target.value) : null)}
                      className={`${MINI} mt-0.5 w-full`}>
                <option value="">nadie por ahora</option>
                {ids.map((uid) => <option key={uid} value={uid}>{nom(uid)}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* Capturas y archivos */}
        <div>
          <div className="flex items-center justify-between">
            <p className="px-t text-xs font-bold uppercase text-muted">Pruebas · capturas</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-bold text-accent">＋ Agregar</button>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden"
                   onChange={(e) => { void adjuntar(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </div>
          {(b.adjuntos ?? []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(b.adjuntos ?? []).map((a) => (
                <div key={a.id} className="relative h-20 w-20 overflow-hidden rounded border border-border">
                  {a.tipo === "imagen" ? <AuthImg did={did} mid={a.id} className="h-full w-full object-cover" />
                    : <span className="flex h-full items-center justify-center p-1 text-center text-[10px]">{a.nombre || "PDF"}</span>}
                  <button type="button" aria-label="Quitar" onClick={() => set("adjuntos", (b.adjuntos ?? []).filter((x) => x.id !== a.id))}
                          className="absolute right-0 top-0 bg-black/60 px-1 text-xs text-white">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* De dónde salió: la cita del chat, tal cual */}
        {b.fuente && (
          <blockquote className="rounded border-l-4 border-accent bg-surface px-2 py-1 text-xs text-ink-secondary">
            <span className="block font-bold text-ink">{b.fuente.autor} · {b.fuente.fecha.slice(0, 16)}</span>
            <span className="whitespace-pre-wrap">{b.fuente.texto}</span>
          </blockquote>
        )}

        {/* Enlaces con otras tarjetas */}
        <div>
          <p className="px-t text-xs font-bold uppercase text-muted">Se conecta con</p>
          {enlaces.map((e) => {
            const o = todas.find((x) => x.id === e.a);
            return (
              <div key={`${e.a}-${e.rel}`} className="mt-1 flex items-center gap-1.5 text-sm">
                <span className="text-xs text-muted">{REL_TXT[e.rel]}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{o ? `${NOMBRE_TIPO[o.tipo]}: ${o.titulo || o.texto.slice(0, 50)}` : "(quitada)"}</span>
                <button type="button" onClick={() => set("enlaces", enlaces.filter((x) => x !== e))} className="text-xs text-muted" aria-label="Quitar enlace">×</button>
              </div>
            );
          })}
          {otras.length > 0 && (
            <div className="mt-1 flex gap-1">
              <select value={nuevoEnlace.rel} onChange={(e) => setNuevoEnlace((x) => ({ ...x, rel: e.target.value as Rel }))} className={MINI}>
                {(Object.keys(REL_TXT) as Rel[]).map((r) => <option key={r} value={r}>{REL_TXT[r]}</option>)}
              </select>
              <select value={nuevoEnlace.a} onChange={(e) => setNuevoEnlace((x) => ({ ...x, a: e.target.value }))} className={`${MINI} min-w-0 flex-1`}>
                <option value="">elige una tarjeta…</option>
                {otras.map((o) => <option key={o.id} value={o.id}>{NOMBRE_TIPO[o.tipo]}: {(o.titulo || o.texto).slice(0, 60)}</option>)}
              </select>
              <button type="button" disabled={!nuevoEnlace.a} className="rounded border border-border px-2 text-sm font-bold disabled:opacity-40"
                      onClick={() => { set("enlaces", [...enlaces, { a: Number(nuevoEnlace.a), rel: nuevoEnlace.rel }]); setNuevoEnlace((x) => ({ ...x, a: "" })); }}>
                ＋
              </button>
            </div>
          )}
        </div>

        {/* De acuerdo: cada uno marca lo suyo; editar el texto lo reinicia */}
        {id != null && actual && CON_ACUERDO.includes(b.tipo) && (
          <div className="rounded border border-border p-2">
            <p className="text-xs text-muted">
              {ids.map((uid) => `${actual.acuerdos[uid] ? "✓" : "○"} ${nom(uid)}`).join("   ")}
              {b.tipo === "decision" && " — con los dos, queda tomada"}
            </p>
            <button type="button" onClick={() => void acordar(!actual.acuerdos[String(yoId)])}
                    className={`mt-1 w-full rounded-lg px-3 py-1.5 text-sm font-bold ${actual.acuerdos[String(yoId)] ? "border border-border text-ink" : "bg-accent text-white"}`}>
              {actual.acuerdos[String(yoId)] ? "Ya no estoy de acuerdo" : "Estoy de acuerdo"}
            </button>
          </div>
        )}

        {actual && (
          <p className="text-[11px] text-muted">
            La puso {nom(String(actual.creado_por))} hace {hace(actual.creado_en)}
            {actual.actualizado_por !== actual.creado_por || actual.actualizado_en !== actual.creado_en
              ? ` · último cambio de ${nom(String(actual.actualizado_por))} hace ${hace(actual.actualizado_en)}` : ""}
          </p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          {id != null && (
            <button type="button" onClick={() => void borrar()} className="rounded-lg border border-red-400 px-3 py-1.5 text-sm font-bold text-red-500">Quitar</button>
          )}
          <button type="button" disabled={ocupado} onClick={() => void guardar()}
                  className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
            {id == null ? "Poner en el tablero" : cambiado.size ? "Guardar" : "Listo"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Traer del chat de WhatsApp ──────────────────────────────────────────────

function HojaChat({ did, part, yoId, onCrear, onCerrar, onRitmo }: {
  did: number; part: Record<string, string>; yoId: number;
  onCrear: (b: Borrador) => void; onCerrar: () => void; onRitmo: () => void;
}) {
  const [origen, setOrigen] = useState<{ archivo?: File; texto?: string } | null>(null);
  const [pegado, setPegado] = useState("");
  const [res, setRes] = useState<{ mensajes: Mensaje[]; autores: Record<string, number>; nombres: string[]; ritmo: RitmoChat } | null>(null);
  const [autores, setAutores] = useState<Record<string, number>>({});
  const [buscar, setBuscar] = useState("");
  const [sinMedia, setSinMedia] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function leer(o: { archivo?: File; texto?: string }, guardarRitmo = false, mapa?: Record<string, number>) {
    setError(null);
    setOcupado(true);
    try {
      let r;
      if (o.archivo) {
        const fd = new FormData();
        fd.append("archivo", o.archivo);
        if (mapa) fd.append("autores", JSON.stringify(mapa));
        if (guardarRitmo) fd.append("guardar_ritmo", "1");
        r = await api.upload<NonNullable<typeof res>>(`/api/colaboradores/diagramas/${did}/chat`, fd, { timeoutMs: 120_000 });
      } else {
        r = await api.post<NonNullable<typeof res>>(`/api/colaboradores/diagramas/${did}/chat`,
          { texto: o.texto, autores: mapa, guardar_ritmo: guardarRitmo }, { timeoutMs: 120_000 });
      }
      setOrigen(o);
      setRes(r);
      setAutores(r.autores);
      if (guardarRitmo) { setAviso("Ritmo guardado (solo los números, sin el texto del chat)."); onRitmo(); }
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (res?.mensajes ?? []).filter((m) =>
      (!sinMedia || !/^<[^>]*omitid[oa]>$/i.test(m.texto.trim())) && (!q || m.texto.toLowerCase().includes(q)));
  }, [res, buscar, sinMedia]);

  const nombreDe = (autor: string) => {
    const uid = autores[autor];
    return uid ? (uid === yoId ? "Tú" : part[String(uid)]?.split(" ")[0] || autor) : autor;
  };

  function crearCon(tipo: TipoT) {
    const ms = (res?.mensajes ?? []).filter((m) => sel.has(m.i));
    if (!ms.length) return;
    const texto = ms.length === 1 ? ms[0].texto : ms.map((m) => `${nombreDe(m.autor)}: ${m.texto}`).join("\n");
    onCrear({
      tipo, titulo: ms[0].texto.split("\n")[0].slice(0, 90), texto, fecha_hecho: ms[0].fecha.slice(0, 10),
      fuente: { canal: "whatsapp", autor: ms.length === 1 ? nombreDe(ms[0].autor) : ms.map((m) => nombreDe(m.autor)).filter((v, i, a) => a.indexOf(v) === i).join(" y "),
                fecha: ms[0].fecha, texto },
    });
    setSel(new Set());
  }

  let diaPrevio = "";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface p-2 sm:p-4" role="dialog" aria-label="Traer del chat">
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Sprite s="doc" px={2} />
          <p className="flex-1 font-bold text-ink">Traer del chat de WhatsApp</p>
          <button type="button" onClick={onCerrar} className="rounded-lg border border-border px-3 py-1 text-sm font-bold text-ink">Cerrar</button>
        </div>
        {!res ? (
          <div className="space-y-2 text-sm">
            <p className="text-ink-secondary">
              En WhatsApp: chat → ⋮ → Más → Exportar chat (sin archivos). Sube el .zip o pega el texto. Se lee aquí para
              que elijas qué mensajes pasan al tablero; <b>el chat no se guarda</b>.
            </p>
            <input type="file" accept=".zip,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer({ archivo: f }); }}
                   className="block w-full text-sm" />
            <textarea value={pegado} onChange={(e) => setPegado(e.target.value)} rows={6} className={INP}
                      placeholder="…o pega aquí un pedazo del chat exportado" />
            <button type="button" disabled={!pegado.trim() || ocupado} onClick={() => void leer({ texto: pegado })}
                    className="rounded-lg bg-accent px-3 py-1.5 font-bold text-white disabled:opacity-50">{ocupado ? "Leyendo…" : "Leer"}</button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{res.mensajes.length} mensajes · {fechaCorta(res.ritmo.desde)} → {fechaCorta(res.ritmo.hasta)}</span>
              {res.nombres.map((n) => (
                <label key={n} className="flex items-center gap-1">
                  <span className="max-w-[9rem] truncate">«{n}» es</span>
                  <select value={autores[n] ?? ""} className={MINI}
                          onChange={(e) => setAutores((a) => { const x = { ...a }; if (e.target.value) x[n] = Number(e.target.value); else delete x[n]; return x; })}>
                    <option value="">nadie</option>
                    {Object.keys(part).map((uid) => <option key={uid} value={uid}>{Number(uid) === yoId ? "Tú" : part[uid]}</option>)}
                  </select>
                </label>
              ))}
              <button type="button" disabled={ocupado} onClick={() => origen && void leer(origen, true, autores)}
                      className="rounded border border-border px-2 py-0.5 font-bold text-ink disabled:opacity-50">Guardar ritmo de este chat</button>
            </div>
            {aviso && <p className="text-xs text-ink">{aviso}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar en el chat (ej. broche, precio, aros)"
                     className={`${MINI} min-w-0 flex-1`} />
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={sinMedia} onChange={(e) => setSinMedia(e.target.checked)} /> ocultar «omitido»
              </label>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded border border-border bg-surface-panel p-2">
              {visibles.slice(-1500).map((m) => {
                const dia = m.fecha.slice(0, 10);
                const sep = dia !== diaPrevio;
                diaPrevio = dia;
                const mio = autores[m.autor] === yoId;
                return (
                  <div key={m.i}>
                    {sep && <p className="px-t my-1 text-center text-[11px] text-muted">{fechaCorta(dia)}</p>}
                    <label className={`flex max-w-[92%] cursor-pointer gap-1.5 rounded-lg px-2 py-1 text-sm ${mio ? "ml-auto bg-accent/10" : "border border-border bg-surface"} ${sel.has(m.i) ? "ring-2 ring-accent" : ""}`}>
                      <input type="checkbox" checked={sel.has(m.i)} className="mt-1 shrink-0"
                             onChange={() => setSel((s) => { const x = new Set(s); if (x.has(m.i)) x.delete(m.i); else x.add(m.i); return x; })} />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-bold text-muted">{nombreDe(m.autor)} · {m.fecha.slice(11, 16)}</span>
                        <span className="whitespace-pre-wrap break-words text-ink">{m.texto}</span>
                      </span>
                    </label>
                  </div>
                );
              })}
              {visibles.length > 1500 && <p className="text-center text-xs text-muted">Se muestran los últimos 1.500: usa el buscador.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">{sel.size ? `${sel.size} elegido${sel.size > 1 ? "s" : ""} → crear` : "Marca uno o varios mensajes y crea la tarjeta:"}</span>
              {SECCIONES.map((s) => (
                <button key={s.tipo} type="button" disabled={!sel.size} onClick={() => crearCon(s.tipo)}
                        className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs font-bold text-ink disabled:opacity-40">
                  <Sprite s={s.sprite} px={1} /> {NOMBRE_TIPO[s.tipo]}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}

// ─── El tablero ──────────────────────────────────────────────────────────────

export default function TableroProyecto({ did, yoId, subir }: {
  did: number; yoId: number; subir: (f: File) => Promise<Adjunto | null>;
}) {
  const qc = useQueryClient();
  const clave = ["colab-tablero", did];
  const q = useQuery<Tablero>({
    queryKey: clave,
    queryFn: () => api.get(`/api/colaboradores/diagramas/${did}/tablero`),
    refetchInterval: 4000,
  });
  const [hoja, setHoja] = useState<{ id: number | null; b: Borrador } | null>(null);
  const [chat, setChat] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const refrescar = () => void qc.invalidateQueries({ queryKey: clave });

  // «Lo vi»: el servidor solo lo anota si hay algo nuevo del otro que no habías visto.
  const ultimo = q.data?.tarjetas.reduce((m, t) => (t.actualizado_en > m ? t.actualizado_en : m), "") ?? "";
  useEffect(() => {
    if (!q.data || document.hidden) return;
    void api.post(`/api/colaboradores/diagramas/${did}/tablero/visto`, {}).catch(() => {});
  }, [did, ultimo, q.data]);

  if (q.isLoading) return <p className="text-sm text-muted">Cargando el tablero…</p>;
  if (q.error || !q.data) return <p className="text-sm text-red-500">{(q.error as Error)?.message || "No se pudo cargar"}</p>;
  const t = q.data;
  const abrir = (x: Tarjeta) => setHoja({ id: x.id, b: { ...x } });
  const nueva = (tipo: TipoT) => setHoja({ id: null, b: { tipo } });
  const ordenar = (xs: Tarjeta[], tipo: TipoT) => tipo === "resultado"
    ? [...xs].sort((a, b) => (a.fecha_hecho || a.creado_en).localeCompare(b.fecha_hecho || b.creado_en))
    : [...xs].sort((a, b) => Number(a.estado !== "abierto") - Number(b.estado !== "abierto"));
  const vacio = t.tarjetas.length === 0;

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-6" data-testid="tablero">
      <RitmoBar t={t} yoId={yoId} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-chat onClick={() => setChat(true)} className="px-btn flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-sm font-bold text-ink">
          <Sprite s="doc" px={1} /> Traer del chat
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver resueltas y descartadas
        </label>
      </div>
      {vacio && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Empiecen por arriba: de dónde parten y cuál es la meta. Lo demás sale de la conversación — «Traer del chat».
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {SECCIONES.map((s) => {
          const todas = t.tarjetas.filter((x) => x.tipo === s.tipo);
          const xs = ordenar(verCerradas || !CON_TURNO.includes(s.tipo) ? todas : todas.filter((x) => x.estado === "abierto"), s.tipo);
          const ocultas = todas.length - xs.length;
          return (
            <section key={s.tipo} className="rounded-xl border border-border bg-surface p-2.5" data-seccion={s.tipo}>
              <header className="mb-1.5 flex items-start gap-2">
                <Sprite s={s.sprite} px={2} />
                <div className="min-w-0 flex-1">
                  <h3 className="px-t text-sm font-bold uppercase text-ink">{s.titulo} <span className="text-muted">{todas.length || ""}</span></h3>
                  <p className="text-[11px] text-muted">{s.pregunta}</p>
                </div>
                <button type="button" onClick={() => nueva(s.tipo)} aria-label={`Agregar: ${s.titulo}`}
                        className="rounded border border-border px-2 text-sm font-bold text-ink">＋</button>
              </header>
              <div className="space-y-1.5">
                {xs.map((x) => <CartaT key={x.id} t={x} did={did} part={t.participantes} yoId={yoId} todas={t.tarjetas} onAbrir={() => abrir(x)} />)}
                {!xs.length && <p className="text-xs text-muted">{ocultas ? `${ocultas} resuelta${ocultas > 1 ? "s" : ""} (marca «ver resueltas»)` : "Nada todavía."}</p>}
                {xs.length > 0 && ocultas > 0 && <p className="text-[11px] text-muted">+{ocultas} resuelta{ocultas > 1 ? "s" : ""}</p>}
              </div>
            </section>
          );
        })}
      </div>

      {chat && (
        <HojaChat did={did} part={t.participantes} yoId={yoId} onCerrar={() => setChat(false)} onRitmo={refrescar}
                  onCrear={(b) => setHoja({ id: null, b })} />
      )}
      {hoja && (
        <HojaTarjeta key={hoja.id ?? `n-${hoja.b.tipo}-${hoja.b.fuente?.fecha ?? ""}`} did={did} id={hoja.id} inicial={hoja.b}
                     todas={t.tarjetas} part={t.participantes} yoId={yoId} subir={subir}
                     onCerrar={() => setHoja(null)} onCambio={refrescar} />
      )}
    </div>
  );
}
