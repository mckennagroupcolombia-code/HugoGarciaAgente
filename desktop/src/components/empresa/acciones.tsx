/**
 * Lo que se hace DESDE el juego, siempre por los caminos de siempre de la app:
 * - Hablarle a alguien (preguntarle algo, conversar) → el chat directo de los dos (ChatPersona.tsx,
 *   POST /api/canales/directo): queda guardado, le llega con aviso y nadie más lo lee.
 * - Pedirle una tarea → una solicitud de la Agenda (POST /api/tickets/), con su aviso de siempre.
 * - Compartir una idea o un mensaje con un grupo → el chat del equipo (POST /api/canales/<id>/mensajes).
 *   Si el grupo tiene espejo a WhatsApp, se avisa antes: el mensaje sale también allá.
 * - Cambiar mi avatar → preferencias_ui.empresa {pixel, color} (PUT /api/tickets/auth/me/preferencias),
 *   validado en tickets_db._limpiar_avatar_empresa contra el catálogo de personajes.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import {
  COLORES_PELO, COLORES_TELA, OJOS, PIELES, cargarCatalogo, componerAvatar, type Catalogo,
} from "./personajes";
import type { AvatarPixel } from "./tipos";

const COLORES_NOMBRE = ["", "#FFE14D", "#FF9F1C", "#FF77A8", "#5DB8FF", "#2ECC71", "#B388FF"];

export function Modal({ titulo, onCerrar, children, ancho = "30rem" }: { titulo: string; onCerrar: () => void; children: React.ReactNode; ancho?: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-3" onClick={onCerrar}>
      <div className="ev-ventana max-h-full w-full overflow-y-auto p-4 text-[15px]" style={{ maxWidth: ancho }}
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="ev-nombre-dialogo flex-1 text-lg">{titulo}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="ev-boton mck-btn-no-fx">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Mi avatar ───────────────────────────────────────────────────────────────

/** El avatar caminando hacia abajo (o de frente quieto) en un canvas que se repinta solo. */
export function VistaAvatar({ avatar, tam = 128, caminar = true }: { avatar: AvatarPixel; tam?: number; caminar?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let vivo = true;
    let t = 0;
    let tira: HTMLCanvasElement | null = null;
    void componerAvatar(avatar).then((c) => { tira = c; });
    const pintar = () => {
      const c = ref.current?.getContext("2d");
      if (!vivo || !c) return;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, tam, tam);
      if (tira) {
        const col = caminar ? 1 + (t % 8) : 9 + (Math.floor(t / 4) % 2);
        const dir = caminar ? [2, 2, 2, 2, 3, 3, 1, 1][Math.floor(t / 16) % 8] : 2;
        c.drawImage(tira, col * 64, dir * 64, 64, 64, 0, 0, tam, tam);
      }
      t++;
    };
    const id = window.setInterval(pintar, 110);
    pintar();
    return () => { vivo = false; window.clearInterval(id); };
  }, [avatar, tam, caminar]);
  return <canvas ref={ref} width={tam} height={tam} className="ev-retrato" style={{ width: tam, height: tam }} />;
}

function Fila({ etiqueta, valor, opciones, onCambio }: {
  etiqueta: string; valor: string; opciones: [string, string][]; onCambio: (v: string) => void;
}) {
  const i = Math.max(0, opciones.findIndex(([id]) => id === valor));
  const mover = (d: number) => onCambio(opciones[(i + d + opciones.length) % opciones.length][0]);
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[#b9c2ff]">{etiqueta}</span>
      <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => mover(-1)} aria-label={`${etiqueta}: anterior`}>◀</button>
      <span className="min-w-0 flex-1 truncate text-center">{opciones[i]?.[1] ?? "—"}</span>
      <button type="button" className="ev-boton mck-btn-no-fx" onClick={() => mover(1)} aria-label={`${etiqueta}: siguiente`}>▶</button>
    </div>
  );
}

export function EditorAvatar({ inicial, colorInicial, onCerrar, onGuardado }: {
  inicial: AvatarPixel; colorInicial: string; onCerrar: () => void; onGuardado: () => void;
}) {
  const token = useTicketsAuth((s) => s.token);
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [a, setA] = useState<AvatarPixel>(inicial);
  const [color, setColor] = useState(colorInicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void cargarCatalogo().then(setCat).catch(() => setError("No cargó el catálogo de personajes.")); }, []);
  const piezas = (p: string): [string, string][] => (cat?.piezas[p] ?? []).map((x) => [x.id, x.nombre]);
  const poner = (k: keyof AvatarPixel) => (v: string) => setA((x) => ({ ...x, [k]: v }));

  async function guardar() {
    if (!token) return;
    setGuardando(true);
    setError("");
    try {
      const r = await fetch("/api/tickets/auth/me/preferencias", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: { pixel: a, color } }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Mi personaje" onCerrar={onCerrar} ancho="44rem">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="rounded-lg border-2 border-[#8a95d6] bg-[#3f7d3a] p-1"><VistaAvatar avatar={a} tam={160} /></div>
          <p className="text-center text-xs text-[#b9c2ff]">Así te ven los demás en el barrio.</p>
        </div>
        <div className="grid min-w-0 flex-1 gap-1.5 text-sm">
          <Fila etiqueta="Cuerpo" valor={a.cuerpo} opciones={[["hombre", "Hombre"], ["mujer", "Mujer"]]} onCambio={(v) => setA((x) => ({ ...x, cuerpo: v as AvatarPixel["cuerpo"] }))} />
          <Fila etiqueta="Piel" valor={a.piel} opciones={PIELES} onCambio={poner("piel")} />
          <Fila etiqueta="Ojos" valor={a.ojos} opciones={OJOS} onCambio={poner("ojos")} />
          <Fila etiqueta="Pelo" valor={a.pelo} opciones={piezas("pelo")} onCambio={poner("pelo")} />
          <Fila etiqueta="Color del pelo" valor={a.color_pelo} opciones={COLORES_PELO} onCambio={poner("color_pelo")} />
          <Fila etiqueta="Barba" valor={a.barba} opciones={piezas("barba")} onCambio={poner("barba")} />
          <Fila etiqueta="Camisa" valor={a.torso} opciones={piezas("torso")} onCambio={poner("torso")} />
          <Fila etiqueta="Color" valor={a.color_torso} opciones={COLORES_TELA} onCambio={poner("color_torso")} />
          <Fila etiqueta="Pantalón" valor={a.piernas} opciones={piezas("piernas")} onCambio={poner("piernas")} />
          <Fila etiqueta="Color" valor={a.color_piernas} opciones={COLORES_TELA} onCambio={poner("color_piernas")} />
          <Fila etiqueta="Zapatos" valor={a.zapatos} opciones={piezas("zapatos")} onCambio={poner("zapatos")} />
          <Fila etiqueta="Color" valor={a.color_zapatos} opciones={COLORES_TELA} onCambio={poner("color_zapatos")} />
          <Fila etiqueta="Overol" valor={a.delantal} opciones={piezas("delantal")} onCambio={poner("delantal")} />
          {a.delantal && <Fila etiqueta="Color" valor={a.color_delantal} opciones={COLORES_TELA} onCambio={poner("color_delantal")} />}
          <Fila etiqueta="Gafas" valor={a.gafas} opciones={piezas("gafas")} onCambio={poner("gafas")} />
          <div className="mt-1 flex items-center gap-2">
            <span className="w-28 shrink-0 text-[#b9c2ff]">Tu nombre</span>
            {COLORES_NOMBRE.map((c) => (
              <button key={c || "blanco"} type="button" onClick={() => setColor(c)} aria-label={c || "Blanco"} aria-pressed={color === c}
                      className={`mck-btn-no-fx h-6 w-6 rounded-full border-2 ${color === c ? "border-[#ffe14d]" : "border-[#8a95d6]"}`}
                      style={{ background: c || "#FFFFFF" }} />
            ))}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-[#ffb4b4]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="ev-boton mck-btn-no-fx">Cancelar</button>
        <button type="button" onClick={guardar} disabled={guardando} className="ev-boton mck-btn-no-fx" aria-pressed="true">
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Pedirle una tarea a alguien ─────────────────────────────────────────────

/** Una TAREA para esa persona (solicitud de la Agenda, le llega con aviso). Preguntar o conversar
 *  no es esto: eso va por el chat de los dos (ChatPersona.tsx). Devuelve el id del ticket. */
export async function pedirTarea(personaId: number, que: string): Promise<number> {
  const t = await api.post<{ id: number }>("/api/tickets/", {
    titulo: que.slice(0, 140), descripcion: que.length > 140 ? que : "", categoria: "logistica", prioridad: "media",
    asignado_a: personaId, tipo: "solicitud",
  });
  return t.id;
}

// ─── Compartir una idea con un grupo ─────────────────────────────────────────

type Canal = { id: number; nombre: string; descripcion: string; miembros: number[]; espejo_salida: boolean; wa_jid: string; wa_nombre: string };

export function CompartirEnGrupo({ onCerrar, onEnviado }: {
  onCerrar: () => void; onEnviado: (mensajeId: number, canal: Canal, texto: string, esIdea: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["empresa-viva-canales"],
    queryFn: () => api.get<{ canales: Canal[] }>("/api/canales"),
    staleTime: 60_000,
  });
  const canales = data?.canales ?? [];
  const [canalId, setCanalId] = useState<number | null>(null);
  const [esIdea, setEsIdea] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const canal = canales.find((c) => c.id === canalId) ?? null;
  const vaAWhatsapp = Boolean(canal?.espejo_salida && canal?.wa_jid);

  async function enviar() {
    if (!canal || !texto.trim()) return;
    setEnviando(true);
    setError("");
    const cuerpo = esIdea ? `Idea: ${texto.trim()}` : texto.trim();
    try {
      const m = await api.post<{ id: number }>(`/api/canales/${canal.id}/mensajes`, { texto: cuerpo });
      onEnviado(m.id, canal, cuerpo, esIdea);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Compartir con un grupo" onCerrar={onCerrar}>
      <div className="mb-3 flex gap-1.5">
        {([[true, "Una idea"], [false, "Un mensaje"]] as const).map(([v, t]) => (
          <button key={t} type="button" onClick={() => setEsIdea(v)} aria-pressed={esIdea === v} className="ev-boton mck-btn-no-fx">{t}</button>
        ))}
      </div>
      <p className="mb-1 text-[#b9c2ff]">¿En qué grupo?</p>
      {isLoading && <p className="text-[#b9c2ff]">Cargando grupos…</p>}
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {canales.map((c) => (
          <button key={c.id} type="button" onClick={() => setCanalId(c.id)} aria-pressed={canalId === c.id} title={c.descripcion || c.nombre}
                  className="ev-boton mck-btn-no-fx">
            {c.nombre}{c.espejo_salida && c.wa_jid ? " · WhatsApp" : ""}
          </button>
        ))}
      </div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="ev-campo mt-3"
                placeholder={esIdea ? "Cuéntale tu idea al grupo" : "Escribe tu mensaje"} />
      {vaAWhatsapp && (
        <p className="mt-2 rounded border border-[#ffe14d] px-2.5 py-1.5 text-xs text-[#ffe14d]">
          Este grupo está enlazado con WhatsApp{canal?.wa_nombre ? ` («${canal.wa_nombre}»)` : ""}: el mensaje también se publica allá.
        </p>
      )}
      {error && <p className="mt-2 text-[#ffb4b4]">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className="ev-boton mck-btn-no-fx">Cancelar</button>
        <button type="button" onClick={enviar} disabled={enviando || !canal || !texto.trim()} className="ev-boton mck-btn-no-fx" aria-pressed="true">
          {enviando ? "Enviando…" : esIdea ? "Compartir idea" : "Enviar"}
        </button>
      </div>
    </Modal>
  );
}
