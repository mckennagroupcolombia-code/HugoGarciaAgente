/**
 * Mapa del proyecto (3-oct-2026): la ÚNICA vista de un proyecto de Colaboradores. Todo el proyecto
 * es un gran cladograma por LINAJE: la raíz es el proyecto y cada tarjeta cuelga de la que la
 * originó (el obstáculo sale del resultado donde apareció, la decisión del obstáculo que resuelve,
 * el siguiente resultado de la decisión). Se lee de izquierda a derecha cómo evolucionó.
 *
 * Por qué. Entre Armando y un colaborador no hay módulos que poner en pisos: hay una conversación
 * que deja ideas, pruebas, decisiones y tropiezos. El edificio quedó absorbido como una rama
 * «Proceso» (colab_tablero.absorber_edificio) y el tablero por secciones se descartó: el usuario
 * quiere todo en el mismo apartado visual.
 *
 * Cada tarjeta se guarda sola (PATCH con lo que cambió): dos personas editando a la vez no se pisan.
 * «＋» en un nodo brota una rama; «Sale de» la cambia de lugar (el servidor impide ciclos).
 * «Traer del chat» lee el chat exportado de WhatsApp y deja convertir mensajes en tarjetas; el
 * texto del chat no se guarda. Backend: app/services/colab_tablero.py.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { AuthImg, INP, MINI } from "./campos";
import type { Adjunto } from "./modelo";
import { Sprite } from "./pixel";
import { COLOR_TIPO, HIJO_DE, NOMBRE_TIPO, SECCIONES, SPRITE_TIPO, type TipoT } from "./mapaTipos";
import GuiaMapa, { guiaYaVista } from "./GuiaMapa";

type Rel = "viene_de" | "resuelve" | "bloquea";
type Fuente = { canal: string; autor: string; fecha: string; texto: string };
export type Tarjeta = {
  id: number; padre_id: number | null; tipo: TipoT; titulo: string; texto: string; porque: string;
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
              <p className="mt-1 text-xs text-muted">Aún no hay idas y vueltas en el mapa para medir.</p>
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

/** Un nodo del cladograma: cabeza de color por tipo, título, foto y lo que importa de un vistazo. */
function Nodo({ t, did, part, yoId, hijos, plegado, apagado, onAbrir, onBrotar, onPlegar }: {
  t: Tarjeta; did: number; part: Record<string, string>; yoId: number; hijos: number; plegado: boolean; apagado: boolean;
  onAbrir: () => void; onBrotar: () => void; onPlegar: () => void;
}) {
  const foto = t.adjuntos.find((a) => a.tipo === "imagen");
  const quien = (uid?: number | null) => (uid === yoId ? "ti" : part[String(uid)]?.split(" ")[0] || "—");
  const ids = Object.keys(part);
  const [fondo, letra] = COLOR_TIPO[t.tipo];
  const cerrada = t.estado !== "abierto" && CON_TURNO.includes(t.tipo);
  return (
    <div className={`mp-nodo relative w-60 shrink-0 border-2 border-ink bg-surface-panel shadow-[3px_3px_0_rgb(var(--mck-ink))] transition-opacity ${apagado ? "opacity-35" : ""} ${t.turno_de === yoId && t.estado === "abierto" ? "outline outline-[3px] outline-offset-2 outline-accent" : ""}`}
         data-tarjeta={t.id}>
      <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] font-extrabold uppercase" style={{ background: fondo, color: letra }}>
        <Sprite s={SPRITE_TIPO[t.tipo]} px={1} />
        <span className="min-w-0 flex-1 truncate">{NOMBRE_TIPO[t.tipo]}{cerrada ? (t.estado === "hecho" ? " ✓" : " ✗") : ""}</span>
        {t.fecha_hecho && <span className="font-bold normal-case">{fechaCorta(t.fecha_hecho)}</span>}
      </div>
      <button type="button" onClick={onAbrir} className="block w-full p-1.5 text-left hover:bg-surface-hover">
        <span className="flex gap-1.5">
          {foto && (
            <span className="h-11 w-11 shrink-0 overflow-hidden border border-border">
              <AuthImg did={did} mid={foto.id} className="h-full w-full object-cover" />
            </span>
          )}
          <b className={`line-clamp-3 min-w-0 flex-1 text-[13px] leading-tight text-ink ${t.estado === "descartado" ? "line-through" : ""}`}>
            {t.titulo || t.texto.slice(0, 90)}
          </b>
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {t.estado === "abierto" && t.turno_de && <Chip fuerte>le toca a {quien(t.turno_de)} · {hace(t.turno_desde)}</Chip>}
          {CON_ACUERDO.includes(t.tipo) && (
            <Chip>{ids.map((id) => `${t.acuerdos[id] ? "✓" : "○"} ${quien(Number(id)) === "ti" ? "tú" : quien(Number(id))}`).join(" ")}</Chip>
          )}
          {t.adjuntos.length > 1 && <Chip>📎 {t.adjuntos.length}</Chip>}
          {t.fuente && t.fuente.canal === "whatsapp" && <Chip>💬</Chip>}
          {t.enlaces.length > 0 && <Chip>↔ {t.enlaces.length}</Chip>}
        </span>
      </button>
      <div className="flex border-t border-border text-[11px] font-bold">
        <button type="button" onClick={onBrotar} className="flex-1 px-1 py-0.5 text-ink hover:bg-surface-hover" title="Brotar una rama de aquí">＋ rama</button>
        {hijos > 0 && (
          <button type="button" onClick={onPlegar} className="border-l border-border px-2 py-0.5 text-ink hover:bg-surface-hover"
                  title={plegado ? "Desplegar sus ramas" : "Plegar sus ramas"}>
            {plegado ? `▸ ${hijos}` : "◂"}
          </button>
        )}
      </div>
    </div>
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
  // No puede salir de sí misma ni de una de sus ramas (el servidor también lo impide).
  const posiblesPadres = useMemo(() => {
    if (id == null) return todas;
    const fuera = new Set<number>([id]);
    let creció = true;
    while (creció) {
      creció = false;
      for (const x of todas) if (x.padre_id != null && fuera.has(x.padre_id) && !fuera.has(x.id)) { fuera.add(x.id); creció = true; }
    }
    return todas.filter((x) => !fuera.has(x.id));
  }, [todas, id]);
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

        {/* De qué tarjeta sale: su lugar en el cladograma */}
        <label className="block text-xs text-muted">
          Sale de
          <select value={b.padre_id ?? ""} onChange={(e) => set("padre_id", e.target.value ? Number(e.target.value) : null)}
                  className={`${MINI} mt-0.5 w-full`}>
            <option value="">la raíz (el proyecto)</option>
            {posiblesPadres.map((o) => <option key={o.id} value={o.id}>{NOMBRE_TIPO[o.tipo]}: {(o.titulo || o.texto).slice(0, 60)}</option>)}
          </select>
        </label>

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
          <p className="px-t text-xs font-bold uppercase text-muted">También se conecta con</p>
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

// ─── El mapa ─────────────────────────────────────────────────────────────────

type Filtro = "todo" | "mio" | "abiertos";

/** Un tramo del tronco: la línea vertical que une a los hermanos y el brazo hacia cada uno. */
function Tronco({ primero, ultimo }: { primero: boolean; ultimo: boolean }) {
  return (
    <div className="relative w-6 shrink-0 self-stretch" aria-hidden="true">
      {!(primero && ultimo) && (
        <div className="absolute left-0 w-[3px] bg-ink" style={{ top: primero ? "50%" : 0, bottom: ultimo ? "50%" : 0 }} />
      )}
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 bg-ink" />
    </div>
  );
}

function guardado<T>(clave: string, defecto: T): T {
  try { const v = localStorage.getItem(clave); return v ? (JSON.parse(v) as T) : defecto; } catch { return defecto; }
}

export default function MapaProyecto({ did, yoId, titulo, subir }: {
  did: number; yoId: number; titulo: string; subir: (f: File) => Promise<Adjunto | null>;
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
  const [verRitmo, setVerRitmo] = useState(false);
  const [guia, setGuia] = useState(() => !guiaYaVista());   // la primera vez, sola
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [zoom, setZoomState] = useState<number>(() => guardado(`colab-mapa-zoom-${did}`, typeof window !== "undefined" && window.innerWidth < 768 ? 0.65 : 1));
  const [plegados, setPlegadosState] = useState<number[] | null>(() => guardado<number[] | null>(`colab-mapa-plegados-${did}`, null));
  const lienzo = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const refrescar = () => void qc.invalidateQueries({ queryKey: clave });
  const setZoom = (z: number) => { const v = Math.min(1.6, Math.max(0.4, Math.round(z * 10) / 10)); setZoomState(v); try { localStorage.setItem(`colab-mapa-zoom-${did}`, JSON.stringify(v)); } catch { /* */ } };
  const setPlegados = (xs: number[]) => { setPlegadosState(xs); try { localStorage.setItem(`colab-mapa-plegados-${did}`, JSON.stringify(xs)); } catch { /* */ } };

  // «Lo vi»: el servidor solo lo anota si hay algo nuevo del otro que no habías visto.
  const ultimo = q.data?.tarjetas.reduce((m, t) => (t.actualizado_en > m ? t.actualizado_en : m), "") ?? "";
  useEffect(() => {
    if (!q.data || document.hidden) return;
    void api.post(`/api/colaboradores/diagramas/${did}/tablero/visto`, {}).catch(() => {});
  }, [did, ultimo, q.data]);

  // Al abrir, la raíz a la vista (en un árbol alto queda centrada muy abajo).
  const centrado = useRef(false);
  useEffect(() => {
    if (centrado.current || !q.data || !lienzo.current) return;
    centrado.current = true;
    const raiz = lienzo.current.querySelector<HTMLElement>("[data-raiz]");
    if (raiz) lienzo.current.scrollTop = Math.max(0, raiz.offsetTop * zoom - lienzo.current.clientHeight / 2 + 60);
  }, [q.data, zoom]);

  const tarjetas = q.data?.tarjetas;
  const arbol = useMemo(() => {
    const xs = tarjetas ?? [];
    const ids = new Set(xs.map((x) => x.id));
    const hijos = new Map<number | null, Tarjeta[]>();
    for (const x of xs) {
      const p = x.padre_id != null && ids.has(x.padre_id) ? x.padre_id : null;
      hijos.set(p, [...(hijos.get(p) ?? []), x]);
    }
    const cuando = (x: Tarjeta) => x.fecha_hecho || x.creado_en.slice(0, 10);
    for (const [k, v] of hijos) {
      // Primero lo que da contexto (partida, meta, roles), luego por fecha; el proceso al final.
      const peso: Partial<Record<TipoT, number>> = { origen: 0, meta: 1, rol: 2, paso: 9 };
      hijos.set(k, [...v].sort((a, b) => (peso[a.tipo] ?? 5) - (peso[b.tipo] ?? 5) || cuando(a).localeCompare(cuando(b)) || a.id - b.id));
    }
    return hijos;
  }, [tarjetas]);

  if (q.isLoading) return <p className="text-sm text-muted">Cargando el mapa…</p>;
  if (q.error || !q.data) return <p className="text-sm text-red-500">{(q.error as Error)?.message || "No se pudo cargar"}</p>;
  const t = q.data;

  // Plegados por defecto: las ramas de «Proceso» (vienen del edificio y son muchas).
  const plegadosEf = new Set(plegados ?? t.tarjetas.filter((x) => x.tipo === "paso" && (arbol.get(x.id)?.length ?? 0) > 0).map((x) => x.id));
  const marcada = (x: Tarjeta) => filtro === "todo" || (x.estado === "abierto" && (filtro === "abiertos"
    ? CON_TURNO.includes(x.tipo) : x.turno_de === yoId));
  // Con un filtro, una rama plegada que esconde algo marcado se abre sola.
  const conMarcadas = new Set<number>();
  if (filtro !== "todo") {
    const subir_ = (x: Tarjeta) => { let p = x.padre_id; while (p != null && !conMarcadas.has(p)) { conMarcadas.add(p); p = t.tarjetas.find((y) => y.id === p)?.padre_id ?? null; } };
    t.tarjetas.filter(marcada).forEach(subir_);
  }
  const plegar = (id: number) => {
    const s = new Set(plegadosEf);
    if (s.has(id)) s.delete(id); else s.add(id);
    setPlegados([...s]);
  };
  const brotar = (padre: Tarjeta | null) => setHoja({ id: null, b: { tipo: HIJO_DE[padre?.tipo ?? "raiz"], padre_id: padre?.id ?? null } });
  const n = t.tarjetas.length;
  const miasAbiertas = t.tarjetas.filter((x) => x.estado === "abierto" && x.turno_de === yoId).length;
  const meta = t.tarjetas.find((x) => x.tipo === "meta" && x.estado !== "descartado");

  const rama = (x: Tarjeta): React.ReactNode => {
    const hs = arbol.get(x.id) ?? [];
    const plegado = plegadosEf.has(x.id) && !conMarcadas.has(x.id);
    return (
      <div className="flex items-center">
        <Nodo t={x} did={did} part={t.participantes} yoId={yoId} hijos={hs.length} plegado={plegado} apagado={!marcada(x)}
              onAbrir={() => setHoja({ id: x.id, b: { ...x } })} onBrotar={() => brotar(x)} onPlegar={() => plegar(x.id)} />
        {hs.length > 0 && !plegado && ramas(hs)}
      </div>
    );
  };
  const ramas = (hs: Tarjeta[]) => (
    <>
      <div className="h-[3px] w-5 shrink-0 bg-ink" aria-hidden="true" />
      <div className="flex flex-col">
        {hs.map((h, i) => (
          <div key={h.id} className="flex items-stretch">
            <Tronco primero={i === 0} ultimo={i === hs.length - 1} />
            <div className="py-1.5">{rama(h)}</div>
          </div>
        ))}
      </div>
    </>
  );
  const raices = arbol.get(null) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mapa">
      {/* Barra del mapa */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setVerRitmo((v) => !v)} aria-expanded={verRitmo}
                className={`px-btn rounded-lg border border-border px-2.5 py-1 text-sm font-bold ${verRitmo ? "bg-accent text-white" : "text-ink"}`}>
          Ritmo {miasAbiertas > 0 && <span className="ml-1 rounded bg-[var(--ed-rojo,#FF004D)] px-1 text-[11px] text-white">te tocan {miasAbiertas}</span>}
        </button>
        <button type="button" data-chat onClick={() => setChat(true)} className="px-btn flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm font-bold text-ink">
          <Sprite s="doc" px={1} /> Traer del chat
        </button>
        <button type="button" data-guia-abrir onClick={() => setGuia(true)} className="px-btn flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm font-bold text-ink">
          <Sprite s="bandera" px={1} /> Guía
        </button>
        <div className="flex overflow-hidden rounded-lg border border-border text-sm font-bold" role="radiogroup" aria-label="Resaltar">
          {([["todo", "Todo"], ["mio", "Me toca"], ["abiertos", "Abiertos"]] as [Filtro, string][]).map(([k, txt]) => (
            <button key={k} type="button" role="radio" aria-checked={filtro === k} onClick={() => setFiltro(k)}
                    className={`px-2 py-1 ${filtro === k ? "bg-accent text-white" : "text-ink"}`}>{txt}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center overflow-hidden rounded-lg border border-border text-sm font-bold">
          <button type="button" onClick={() => setZoom(zoom - 0.1)} className="px-2 py-1 text-ink" aria-label="Alejar">−</button>
          <button type="button" onClick={() => setZoom(1)} className="px-1 py-1 text-xs text-muted" title="Tamaño normal">{Math.round(zoom * 100)} %</button>
          <button type="button" onClick={() => setZoom(zoom + 0.1)} className="px-2 py-1 text-ink" aria-label="Acercar">＋</button>
        </div>
      </div>
      {verRitmo && <RitmoBar t={t} yoId={yoId} />}

      {/* El lienzo: se arrastra con el mouse para moverse; en el celular, con el dedo. */}
      <div ref={lienzo} className="mp-lienzo relative min-h-0 flex-1 cursor-grab overflow-auto border-2 border-ink active:cursor-grabbing"
           style={{ backgroundColor: "rgb(var(--mck-surface))", backgroundImage: "radial-gradient(rgb(var(--mck-ink) / 0.18) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
           onPointerDown={(e) => {
             if ((e.target as HTMLElement).closest("button, a, input, select, textarea") || e.pointerType !== "mouse") return;
             const el = lienzo.current!;
             arrastre.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
           }}
           onPointerMove={(e) => {
             const a = arrastre.current;
             if (!a) return;
             lienzo.current!.scrollLeft = a.l - (e.clientX - a.x);
             lienzo.current!.scrollTop = a.t - (e.clientY - a.y);
           }}
           onPointerUp={() => { arrastre.current = null; }} onPointerLeave={() => { arrastre.current = null; }}>
        <div className="inline-flex min-w-full items-center p-6" style={{ zoom }}>
          {/* La raíz: el proyecto */}
          <div className="w-56 shrink-0 border-2 border-ink bg-accent text-white shadow-[4px_4px_0_rgb(var(--mck-ink))]" data-raiz>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-extrabold uppercase"><Sprite s="bandera" px={1} /> Proyecto</div>
            <div className="px-2 pb-2">
              <b className="block text-[15px] leading-tight">{titulo}</b>
              {meta && <span className="mt-1 block text-[11px] opacity-90">Meta: {meta.titulo}</span>}
              <span className="mt-1 block text-[11px] opacity-80">{n} tarjeta{n === 1 ? "" : "s"}</span>
            </div>
            <button type="button" onClick={() => brotar(null)} className="block w-full border-t border-white/40 px-2 py-0.5 text-left text-[11px] font-bold hover:bg-white/10">＋ rama</button>
          </div>
          {raices.length > 0 ? ramas(raices) : (
            <p className="ml-6 max-w-xs text-sm text-muted">Empiecen por la primera rama: de dónde parten. Lo demás brota de ahí — o tráiganlo del chat.</p>
          )}
        </div>
      </div>

      {guia && <GuiaMapa onCerrar={() => setGuia(false)} />}
      {chat && (
        <HojaChat did={did} part={t.participantes} yoId={yoId} onCerrar={() => setChat(false)} onRitmo={refrescar}
                  onCrear={(b) => setHoja({ id: null, b })} />
      )}
      {hoja && (
        <HojaTarjeta key={hoja.id ?? `n-${hoja.b.tipo}-${hoja.b.padre_id ?? "r"}-${hoja.b.fuente?.fecha ?? ""}`} did={did} id={hoja.id} inicial={hoja.b}
                     todas={t.tarjetas} part={t.participantes} yoId={yoId} subir={subir}
                     onCerrar={() => setHoja(null)} onCambio={refrescar} />
      )}
    </div>
  );
}
