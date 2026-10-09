import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cara } from "../../lib/fotoPersona";
import { nodosConEmojisPixel, soloEmojisPixel } from "./emojiPixel";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import { useAppStore } from "../../stores/app";
import {
  useCanalesEquipo,
  useEnviarCanal,
  useMarcarCanalLeido,
  useMencionables,
  useMensajesCanal,
  type CanalEquipo,
  type CitaMensaje,
  type MensajeCanal,
  type ModuloCanal,
  type RefMensaje,
} from "../../hooks/useCanalesEquipo";
import { ChipVinculo, SelectorVinculo } from "./VinculoModulo";
import SolicitudesDelGrupo from "./SolicitudesDelGrupo";
import { canalesEnPantalla } from "../../hooks/useAvisosMensajes";
import BarraEscritura, { BotonCaja, IconoCamara, IconoClip, IconoEnlace } from "./BarraEscritura";
import AjustesSonidos from "./AjustesSonidos";
import { sonidoDeMensaje, sonidoPorId, useAlertasSonido, SILENCIO } from "../../lib/alertasSonido";
import { colorDePersona, colorTextoPersona, iniciales } from "../../lib/personaColor";
import { tramosMencion, type Persona } from "../../lib/menciones";
import "./chatEquipo.css";
import VisorFotos, { type FotoVisor } from "../tickets/VisorFotos";

type Letra = "normal" | "grande" | "enorme";
const CLAVE_LETRA = "mck-chat-letra";
const LETRAS: Letra[] = ["normal", "grande", "enorme"];

function leerLetra(): Letra {
  try {
    const v = localStorage.getItem(CLAVE_LETRA) as Letra | null;
    return v && LETRAS.includes(v) ? v : "grande";
  } catch {
    return "grande";
  }
}

/** «Hoy», «Ayer» o «lunes 5 de octubre»: separa los mensajes por día. */
function etiquetaDia(ts: number): string {
  const d = new Date(ts * 1000);
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  const txt = d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long",
    ...(d.getFullYear() !== hoy.getFullYear() ? { year: "numeric" } : {}) });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function horaCorta(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

/** Mensajes seguidos de la misma persona (≤ 5 min) van juntos: nombre y avatar solo en el primero. */
function mismaRacha(a: MensajeCanal | undefined, b: MensajeCanal): boolean {
  return Boolean(a && a.tipo !== "sistema" && b.tipo !== "sistema" && a.autor_nombre === b.autor_nombre
    && a.origen === b.origen && b.creado_en - a.creado_en < 300
    && new Date(a.creado_en * 1000).toDateString() === new Date(b.creado_en * 1000).toDateString());
}

function hora(ts: number): string {
  const d = new Date(ts * 1000);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function esImagen(m: MensajeCanal): boolean {
  const mime = m.adjunto_mime || "";
  if (mime.startsWith("image/")) return true;
  const n = (m.adjunto_nombre || m.adjunto_archivo || m.wa_media_path || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|heic)$/.test(n);
}

/** Nota de voz grabada en el panel o audio que llegó por el grupo de WhatsApp enlazado. */
function esAudio(m: MensajeCanal): boolean {
  if ((m.adjunto_mime || "").startsWith("audio/")) return true;
  const n = (m.adjunto_nombre || m.adjunto_archivo || m.wa_media_path || "").toLowerCase();
  return /\.(webm|ogg|oga|opus|mp3|m4a|aac|wav)$/.test(n);
}

function urlAdjunto(m: MensajeCanal, token: string): string | null {
  const t = encodeURIComponent(token);
  if (m.adjunto_archivo) return `/api/canales/uploads/${encodeURIComponent(m.adjunto_archivo)}?token=${t}`;
  if (m.wa_media_path) return `/api/canales/media-wa/${m.id}?token=${t}`;
  return null;
}

/** Resumen de una línea de lo citado: texto, o qué tipo de adjunto era. */
function resumenCita(c: Pick<CitaMensaje, "texto" | "adjunto_nombre" | "adjunto_mime"> & { eliminado?: boolean }): string {
  if (c.eliminado) return "Mensaje eliminado";
  if (c.texto) return c.texto;
  const mime = c.adjunto_mime || "";
  if (mime.startsWith("audio/")) return "🎤 Nota de voz";
  if (mime.startsWith("image/")) return "📷 Foto";
  return c.adjunto_nombre ? `📎 ${c.adjunto_nombre}` : "Adjunto";
}

/** Cita al estilo WhatsApp: franja de color con el autor y el texto citado. */
function Cita({ cita, onClick, onQuitar }: { cita: CitaMensaje; onClick?: () => void; onQuitar?: () => void }) {
  return (
    <div className="flex items-stretch gap-1 overflow-hidden rounded-lg border-l-4 border-accent bg-accent/10">
      <button type="button" onClick={onClick} disabled={!onClick}
        className="mck-btn-no-fx min-w-0 flex-1 px-2 py-1 text-left disabled:cursor-default"
        title={onClick ? "Ver el mensaje original" : undefined}>
        <span className="block truncate text-[10.5px] font-bold text-accent">{cita.autor_nombre}</span>
        <span className={`line-clamp-2 block break-words text-[12px] leading-snug text-muted ${cita.eliminado ? "italic" : ""}`}>{resumenCita(cita)}</span>
      </button>
      {onQuitar && (
        <button type="button" onClick={onQuitar} className="mck-btn-no-fx shrink-0 px-2 text-[13px] text-muted hover:text-ink" aria-label="Cancelar respuesta">✕</button>
      )}
    </div>
  );
}

/**
 * Formato de WhatsApp en el texto (*negrita*, _cursiva_, ~tachado~) y enlaces tocables: los
 * mensajes que llegan de los grupos traen los asteriscos y se leían como «*Acción nueva*».
 */
const RE_FORMATO = /(https?:\/\/[^\s]+)|(?<![\p{L}\p{N}])\*([^*\n]+)\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])~([^~\n]+)~(?![\p{L}\p{N}])/gu;
/** Un pedazo de texto plano con sus @ resaltados (el tuyo, más fuerte). */
function conMenciones(trozo: string, menciones: Persona[], yo: number | undefined, base: number): ReactNode[] {
  const tramos = tramosMencion(trozo, menciones);
  if (!tramos.length) return [trozo];
  const out: ReactNode[] = [];
  let ultimo = 0;
  tramos.forEach((t, j) => {
    if (t.inicio > ultimo) out.push(trozo.slice(ultimo, t.inicio));
    const mio = t.persona ? t.persona.id === yo : menciones.some((p) => p.id === yo);
    out.push(
      <span key={`m${base}-${j}`} className={`mck-mencion ${mio ? "mck-mencion-mia" : ""}`}
            title={t.persona ? `Nombra a ${t.persona.nombre}` : undefined}>
        {t.persona && /^@\d/.test(trozo.slice(t.inicio, t.fin)) ? `@${t.persona.nombre}` : trozo.slice(t.inicio, t.fin)}
      </span>,
    );
    ultimo = t.fin;
  });
  if (ultimo < trozo.length) out.push(trozo.slice(ultimo));
  return out;
}

function TextoChat({ texto, menciones = [], yo }: { texto: string; menciones?: Persona[]; yo?: number }) {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  let k = 0;
  const plano = (t: string) => nodosConEmojisPixel(menciones.length ? conMenciones(t, menciones, yo, k++) : [t], `p${k++}-`);
  for (const m of texto.matchAll(RE_FORMATO)) {
    const i = m.index ?? 0;
    if (i > ultimo) partes.push(...plano(texto.slice(ultimo, i)));
    if (m[1]) partes.push(<a key={k++} href={m[1]} target="_blank" rel="noreferrer" className="break-all font-semibold text-accent underline">{m[1]}</a>);
    else if (m[2]) partes.push(<strong key={k++} className="font-extrabold">{m[2]}</strong>);
    else if (m[3]) partes.push(<em key={k++}>{m[3]}</em>);
    else if (m[4]) partes.push(<s key={k++}>{m[4]}</s>);
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) partes.push(...plano(texto.slice(ultimo)));
  return <>{partes}</>;
}

function citaDe(m: MensajeCanal): CitaMensaje {
  return { id: m.id, autor_nombre: m.autor_nombre, texto: m.texto, adjunto_nombre: m.adjunto_nombre, adjunto_mime: m.adjunto_mime, eliminado: false };
}

/** Un mensaje del chat → solicitud en la Agenda (con responsable y cronómetro), ya llenada. */
function reportarIncidente(canal: CanalEquipo, m?: MensajeCanal) {
  const st = useAppStore.getState();
  const enlace = m?.ref && typeof m.ref.titulo === "string" ? `\nVinculado: ${m.ref.titulo}${m.ref.detalle ? ` (${String(m.ref.detalle)})` : ""}` : "";
  const origen = (m ? `${m.autor_nombre} escribió en «${canal.nombre}»: ${m.texto || "(foto)"}` : `Reportado desde el canal «${canal.nombre}».`) + enlace;
  st.setSolicitudBoot({
    abrirWizard: true,
    prefillTitulo: m?.texto ? `Incidente: ${m.texto.slice(0, 70)}` : "Incidente: ",
    prefillDescripcion: origen,
  });
  st.setTicketsBootView("solicitudes");
  st.setPanel("hugo");
}

function Burbuja({ m, propio, token, modulos, onIncidente, onResponder, onIrA, onVerFoto, resaltado, primero, yo }: {
  m: MensajeCanal; propio: boolean; token: string; modulos: ModuloCanal[];
  onIncidente: () => void; onResponder: () => void; onIrA: (id: number) => void; onVerFoto: (src: string) => void; resaltado: boolean;
  /** Primero de una racha del mismo autor: lleva nombre y avatar. */
  primero: boolean;
  yo?: number;
}) {
  const url = urlAdjunto(m, token);
  const menciones = m.menciones ?? [];
  const meNombra = !propio && menciones.some((p) => p.id === yo);
  // Deslizar la burbuja a la derecha (celular) responde, como en WhatsApp.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const [arrastre, setArrastre] = useState(0);
  // En pantallas táctiles «Responder / Tarea» se esconden: aparecen al tocar la burbuja.
  const [acciones, setAcciones] = useState(false);
  if (m.tipo === "sistema") {
    return (
      <div id={`msg-canal-${m.id}`} className="mx-auto my-2 max-w-[92%] rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2 text-center text-ink sm:max-w-[80%]">
        <span className="mck-chat-meta block font-bold uppercase tracking-wide text-muted">{m.autor_nombre} · {hora(m.creado_en)}</span>
        <p className="mck-chat-texto whitespace-pre-wrap break-words"><TextoChat texto={m.texto} /></p>
        <div className="flex justify-center"><ChipVinculo refm={m.ref} modulos={modulos} /></div>
      </div>
    );
  }
  return (
    <div id={`msg-canal-${m.id}`} className={`mck-msg group flex items-end gap-2 ${propio ? "flex-row-reverse" : ""} ${primero ? "mt-3" : "mt-0.5"} ${acciones ? "mck-acciones-on" : ""}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button, audio, img")) setAcciones((v) => !v); }}
      onTouchStart={(e) => { toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={(e) => {
        const t = toque.current;
        if (!t) return;
        const dx = e.touches[0].clientX - t.x;
        if (Math.abs(e.touches[0].clientY - t.y) > 30) { toque.current = null; setArrastre(0); return; }
        setArrastre(Math.max(0, Math.min(dx, 80)));
      }}
      onTouchEnd={() => { if (arrastre > 55) onResponder(); toque.current = null; setArrastre(0); }}>
      {!propio && (
        primero
          ? <Cara uid={m.origen === "panel" ? m.usuario_id : null} nombre={m.autor_nombre}
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-full text-[13px] font-black text-white shadow-sm"
              style={{ background: colorDePersona(m.autor_nombre) }} fallback={iniciales(m.autor_nombre)} />
          : <span className="w-9 shrink-0" aria-hidden />
      )}
      <div style={arrastre ? { transform: `translateX(${arrastre}px)` } : undefined}
        className={`mck-burbuja min-w-0 max-w-[86%] rounded-2xl px-3.5 py-2 sm:max-w-[72%] ${arrastre ? "" : "transition-[box-shadow] duration-700"} ${resaltado ? "ring-2 ring-accent" : ""} ${meNombra ? "mck-burbuja-mencion" : ""} ${
          propio ? `mck-burbuja-propia ${primero ? "rounded-tr-md" : ""}` : `mck-burbuja-otra ${primero ? "rounded-tl-md" : ""}`}`}>
        {!propio && primero && (
          <p className="mck-chat-autor mb-0.5 font-extrabold" style={{ color: colorTextoPersona(m.autor_nombre) }}>
            {m.autor_nombre}
            {m.origen === "wa" && <span className="ml-1.5 rounded-full bg-[#25d366]/15 px-1.5 py-px align-middle text-[0.78em] font-bold text-[#128c7e]" title="Llegó por el grupo de WhatsApp enlazado">WhatsApp</span>}
          </p>
        )}
        {m.cita && <div className="mb-1.5 mt-0.5"><Cita cita={m.cita} onClick={() => onIrA(m.cita!.id)} /></div>}
        {url && esImagen(m) && (
          <div className="my-1">
            <img src={url} alt={m.adjunto_nombre || "foto"} loading="lazy" onClick={() => onVerFoto(url)} title="Ver foto"
              className="max-h-80 w-auto max-w-full cursor-zoom-in rounded-xl border border-border object-contain" />
          </div>
        )}
        {url && esAudio(m) && (
          <audio src={url} controls preload="metadata" className="my-1 h-11 w-72 max-w-full" />
        )}
        {url && !esImagen(m) && !esAudio(m) && (
          <a href={url} target="_blank" rel="noreferrer" className="mck-chat-texto my-1 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 font-bold text-ink hover:border-accent/60">
            <span className="text-[1.3em]" aria-hidden>📎</span><span className="min-w-0 truncate">{m.adjunto_nombre || "archivo"}</span>
          </a>
        )}
        {meNombra && <p className="mck-chat-meta mb-0.5 font-black uppercase tracking-wide text-accent">@ Te nombró</p>}
        {m.texto && <p className={`mck-chat-texto whitespace-pre-wrap break-words text-ink ${soloEmojisPixel(m.texto) ? "mck-emoji-solo" : ""}`}><TextoChat texto={m.texto} menciones={menciones} yo={yo} /></p>}
        <ChipVinculo refm={m.ref} modulos={modulos} />
        <div className="mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span className="mck-chat-acciones flex items-center gap-1">
            <button onClick={onResponder} className="mck-btn-no-fx rounded-full px-2 py-0.5 font-bold text-muted hover:bg-accent/10 hover:text-accent"
              title="Responder a este mensaje">↩ Responder</button>
            <button onClick={onIncidente} className="mck-btn-no-fx rounded-full px-2 py-0.5 font-bold text-muted hover:bg-accent/10 hover:text-accent"
              title="Convertir este mensaje en una solicitud de este grupo (responsable y fecha límite)">→ Tarea</button>
          </span>
          <span className="mck-chat-meta font-mono text-muted" title={new Date(m.creado_en * 1000).toLocaleString("es-CO")}>{horaCorta(m.creado_en)}</span>
        </div>
      </div>
      {arrastre > 0 && <span className="self-center text-[20px] text-accent" style={{ opacity: arrastre / 55 }} aria-hidden>↩</span>}
    </div>
  );
}

/** Un canal del equipo: se escribe sin cronómetro (a diferencia del hilo de un ticket). */
export default function HiloCanal({ canal, onVolver, compacto }: { canal: CanalEquipo; onVolver?: () => void; compacto?: boolean }) {
  const token = useTicketsAuth((s) => s.token) || "";
  const yo = useTicketsAuth((s) => s.user?.id);
  const mensajes = useMensajesCanal(canal.id);
  const mencionables = useMencionables(canal.id).data?.personas;
  const modulos = useCanalesEquipo().data?.modulos ?? [];
  const moduloCanal = modulos.find((x) => x.clave === canal.modulo) ?? null;
  const [vinculo, setVinculo] = useState<RefMensaje | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  // «→ tarea» en un mensaje: abre el formulario de solicitud del grupo con ese mensaje.
  const [tareaDesde, setTareaDesde] = useState<MensajeCanal | null>(null);
  // «↩ responder»: el mensaje citado va arriba de la caja hasta enviar o cancelar.
  const [respondiendo, setRespondiendo] = useState<MensajeCanal | null>(null);
  const [resaltado, setResaltado] = useState<number | null>(null);
  const cajaRef = useRef<HTMLTextAreaElement>(null);
  const enviar = useEnviarCanal(canal.id);
  const leido = useMarcarCanalLeido();
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const lista = mensajes.data?.mensajes ?? [];
  // Todas las fotos del grupo en orden: tocar una abre el visor y se pasa a la anterior o la siguiente.
  const [visor, setVisor] = useState<number | null>(null);
  const fotos = useMemo<FotoVisor[]>(() => lista.flatMap((m) => {
    const url = urlAdjunto(m, token);
    return url && esImagen(m) ? [{ src: url, pie: `${m.autor_nombre} · ${hora(m.creado_en)}` }] : [];
  }), [lista, token]);
  const verFoto = (src: string) => { const i = fotos.findIndex((f) => f.src === src); if (i >= 0) setVisor(i); };
  const [letra, setLetra] = useState<Letra>(leerLetra);
  const [ajustesSonido, setAjustesSonido] = useState(false);
  const sonidoCanal = useAlertasSonido((st) => st.ajustes.canales[String(canal.id)] ?? null);
  const sonidoEfectivo = useAlertasSonido((st) => sonidoDeMensaje(st.ajustes, canal.id, null));
  const scrollRef = useRef<HTMLDivElement>(null);
  // ¿La persona está abajo del todo? Si subió a leer algo viejo, lo nuevo no la arrastra.
  const abajo = useRef(true);
  const [nuevosSinVer, setNuevosSinVer] = useState(0);
  // Línea «Mensajes nuevos»: lo que no había leído al abrir el grupo.
  const [primerNoLeido, setPrimerNoLeido] = useState<number | null>(null);
  const cambiarLetra = () => {
    const sig = LETRAS[(LETRAS.indexOf(letra) + 1) % LETRAS.length];
    setLetra(sig);
    try {
      localStorage.setItem(CLAVE_LETRA, sig);
    } catch {
      /* sin almacenamiento */
    }
  };

  // Mientras este grupo está abierto no sale la tarjeta de aviso por sus propios mensajes.
  useEffect(() => {
    canalesEnPantalla.add(canal.id);
    document.documentElement.dataset.chatAbierto = "1";
    return () => {
      canalesEnPantalla.delete(canal.id);
      if (!canalesEnPantalla.size) delete document.documentElement.dataset.chatAbierto;
    };
  }, [canal.id]);
  const ultimoId = lista.length ? lista[lista.length - 1].id : 0;

  const ultimoPrevio = useRef(0);
  useEffect(() => {
    if (!ultimoId) return;
    const primeraCarga = ultimoPrevio.current === 0;
    if (primeraCarga && canal.no_leidos > 0 && lista.length > canal.no_leidos) {
      setPrimerNoLeido(lista[lista.length - canal.no_leidos].id);
    }
    const ultimo = lista[lista.length - 1];
    const mio = ultimo && ultimo.origen === "panel" && ultimo.usuario_id === yo;
    if (primeraCarga || abajo.current || mio) {
      requestAnimationFrame(() => {
        const marca = primeraCarga && canal.no_leidos > 0 ? document.getElementById("mck-chat-nuevos") : null;
        if (marca) marca.scrollIntoView({ block: "center" });
        else finRef.current?.scrollIntoView({ block: "end", behavior: primeraCarga ? "auto" : "smooth" });
      });
      setNuevosSinVer(0);
    } else if (ultimoPrevio.current && ultimoId > ultimoPrevio.current) {
      setNuevosSinVer((n) => n + lista.filter((x) => x.id > ultimoPrevio.current).length);
    }
    ultimoPrevio.current = ultimoId;
    if (canal.no_leidos > 0) leido.mutate(canal.id);
  }, [ultimoId, canal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const alDesplazar = () => {
    const el = scrollRef.current;
    if (!el) return;
    abajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (abajo.current && nuevosSinVer) setNuevosSinVer(0);
  };
  const bajar = () => {
    finRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setNuevosSinVer(0);
  };

  const vistaPrevia = useMemo(() => (archivo && archivo.type.startsWith("image/") ? URL.createObjectURL(archivo) : null), [archivo]);
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  const mandar = async () => {
    if (!texto.trim() && !archivo && !vinculo) return;
    setError(null);
    try {
      await enviar.mutateAsync({ texto: texto.trim(), archivo, ref: vinculo, respondeA: respondiendo?.id ?? null });
      setTexto("");
      setArchivo(null);
      setVinculo(null);
      setRespondiendo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // La nota de voz sale sola al terminar de grabar; lo escrito y el vínculo se quedan en la caja.
  const mandarVoz = async (voz: File) => {
    setError(null);
    try {
      await enviar.mutateAsync({ texto: "", archivo: voz, ref: null, respondeA: respondiendo?.id ?? null });
      setRespondiendo(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const responder = (m: MensajeCanal) => {
    setRespondiendo(m);
    setTimeout(() => cajaRef.current?.focus(), 0);
  };

  // Tocar una cita lleva al mensaje original y lo resalta un momento.
  const irA = (id: number) => {
    const el = document.getElementById(`msg-canal-${id}`);
    if (!el) { setError("El mensaje original es más antiguo que los que se muestran aquí."); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setResaltado(id);
    setTimeout(() => setResaltado((r) => (r === id ? null : r)), 1600);
  };

  // Al cambiar de grupo no se arrastra la respuesta pendiente.
  useEffect(() => { setRespondiendo(null); }, [canal.id]);

  const iconoSonido = sonidoEfectivo === SILENCIO ? "🔇" : sonidoPorId(sonidoEfectivo)?.icono ?? "🔔";
  const botonesCabecera = (
    <>
      <button onClick={cambiarLetra} data-sin-sonido
        className="mck-btn-no-fx flex h-10 min-w-10 items-center justify-center rounded-full border border-border bg-surface px-2.5 font-black text-ink hover:border-accent max-sm:h-8 max-sm:min-w-8 max-sm:px-1.5"
        title={`Tamaño de la letra: ${letra}. Toca para cambiar.`} aria-label={`Tamaño de la letra: ${letra}`}>
        <span className="text-[12px]">A</span><span className={letra === "normal" ? "text-[15px]" : letra === "grande" ? "text-[18px]" : "text-[21px]"}>A</span>
      </button>
      <button onClick={() => setAjustesSonido(true)} data-sin-sonido
        className={`mck-btn-no-fx flex h-10 items-center gap-1 rounded-full border px-3 text-[13px] font-bold max-sm:h-8 max-sm:px-2 ${sonidoCanal ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-ink-secondary"} hover:border-accent`}
        title="Con qué sonido te avisa este grupo" aria-label="Sonido de este grupo">
        <span className="text-[17px] leading-none" aria-hidden>{iconoSonido}</span>
        <span className="max-sm:hidden">Sonido</span>
      </button>
    </>
  );

  return (
    <div data-letra={letra} className={`mck-chat flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface ${compacto ? "" : "rounded-2xl border border-border"}`}>
      {/* En la burbuja flotante (compacto) el nombre ya va en su propia cabecera. */}
      {!compacto ? <div className="flex items-center gap-2.5 border-b border-border bg-surface-panel px-3 py-2.5 max-sm:gap-2 max-sm:px-2 max-sm:py-1.5">
        {onVolver && (
          <button onClick={onVolver} className="mck-btn-no-fx flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-[18px] max-sm:h-8 max-sm:w-8 max-sm:text-[16px] lg:hidden" aria-label="Volver a los canales">←</button>
        )}
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-[18px] font-black text-white max-sm:hidden" aria-hidden>
          {canal.nombre.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-black leading-tight text-ink max-sm:text-[15px]">{canal.nombre}</p>
          <p className="truncate text-[12.5px] text-muted max-sm:text-[11.5px]">
            {moduloCanal && <span className="mr-1 rounded bg-accent/15 px-1 font-bold text-accent" title="Grupo de trabajo vinculado a este módulo">↔ {moduloCanal.nombre}</span>}
            {canal.descripcion || (canal.miembros.length ? `${canal.miembros.length} miembros` : "Todo el equipo")}
            {canal.wa_jid && (
              <span title="Lo que se escribe en el grupo de WhatsApp aparece aquí">
                {" "}· enlazado a «{canal.wa_nombre || "grupo de WhatsApp"}»{canal.espejo_salida ? " (ida y vuelta)" : " (solo llegada)"}
              </span>
            )}
          </p>
        </div>
        {botonesCabecera}
      </div> : (
        <div className="flex items-center justify-end gap-1.5 border-b border-border bg-surface-panel px-2 py-1.5">{botonesCabecera}</div>
      )}
      {ajustesSonido && <AjustesSonidos canalInicial={canal.id} onCerrar={() => setAjustesSonido(false)} />}
      {visor !== null && fotos.length > 0 && (
        <VisorFotos fotos={fotos} inicio={Math.min(visor, fotos.length - 1)} onCerrar={() => setVisor(null)} />
      )}

      <SolicitudesDelGrupo canal={canal} modulo={moduloCanal} desde={tareaDesde} onDesdeUsado={() => setTareaDesde(null)} />

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={alDesplazar} className="mck-chat-fondo absolute inset-0 overflow-y-auto px-2.5 pb-4 pt-2 sm:px-5">
          {mensajes.isLoading && <p className="mck-chat-texto py-6 text-center text-muted">Cargando…</p>}
          {!mensajes.isLoading && lista.length === 0 && (
            <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-dashed border-border bg-surface-panel/80 p-6 text-center">
              <p className="text-[34px]" aria-hidden>💬</p>
              <p className="mck-chat-texto mt-1 font-bold text-ink">Todavía no hay mensajes</p>
              <p className="mt-1 text-[14px] text-muted">Lo que se escriba aquí queda registrado y cuenta como actividad.</p>
            </div>
          )}
          <div className="mx-auto max-w-[980px]">
            {lista.map((m, i) => {
              const previo = lista[i - 1];
              const nuevoDia = !previo || new Date(previo.creado_en * 1000).toDateString() !== new Date(m.creado_en * 1000).toDateString();
              const esNuevo = m.id === primerNoLeido;
              return (
                <div key={m.id}>
                  {nuevoDia && (
                    <div className="mck-separador-dia my-3 flex justify-center">
                      <span className="rounded-full border border-border bg-surface-panel px-3.5 py-1 text-[13px] font-bold text-ink-secondary shadow-sm">
                        {etiquetaDia(m.creado_en)}
                      </span>
                    </div>
                  )}
                  {esNuevo && (
                    <div id="mck-chat-nuevos" className="my-3 flex items-center gap-2" role="separator">
                      <span className="h-px flex-1 bg-accent-rose" />
                      <span className="rounded-full bg-accent-rose px-3 py-0.5 text-[12.5px] font-bold text-white">Mensajes nuevos</span>
                      <span className="h-px flex-1 bg-accent-rose" />
                    </div>
                  )}
                  <Burbuja m={m} propio={m.origen === "panel" && m.usuario_id === yo} token={token} modulos={modulos} yo={yo}
                    primero={nuevoDia || esNuevo || !mismaRacha(previo, m)}
                    onIncidente={() => setTareaDesde(m)} onResponder={() => responder(m)} onIrA={irA} onVerFoto={verFoto} resaltado={resaltado === m.id} />
                </div>
              );
            })}
          </div>
          <div ref={finRef} />
        </div>
        {nuevosSinVer > 0 && (
          <button onClick={bajar} data-sin-sonido
            className="mck-btn-no-fx absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-[14px] font-bold text-white shadow-paper-lg">
            ↓ {nuevosSinVer} mensaje{nuevosSinVer === 1 ? "" : "s"} nuevo{nuevosSinVer === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <div className="border-t border-border bg-surface-panel p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {archivo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-input p-1.5">
            {vistaPrevia ? <img src={vistaPrevia} alt="" className="h-12 w-12 rounded object-cover" /> : <span className="text-[18px]">📎</span>}
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{archivo.name}</span>
            <button onClick={() => setArchivo(null)} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Quitar adjunto">✕</button>
          </div>
        )}
        {eligiendo && modulos.length > 0 && (
          <SelectorVinculo modulos={modulos} moduloInicial={canal.modulo} onCerrar={() => setEligiendo(false)}
            onElegir={(r) => { setVinculo(r); setEligiendo(false); }} />
        )}
        {vinculo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-surface-input p-1.5">
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-accent">
              {modulos.find((x) => x.clave === vinculo.modulo)?.item || "Enlace"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{vinculo.titulo}</span>
            <button onClick={() => setVinculo(null)} className="rounded px-2 text-[12px] text-muted hover:text-ink" aria-label="Quitar vínculo">✕</button>
          </div>
        )}
        {respondiendo && (
          <div className="mb-2">
            <Cita cita={citaDe(respondiendo)} onClick={() => irA(respondiendo.id)} onQuitar={() => setRespondiendo(null)} />
          </div>
        )}
        {error && <p className="mb-1 text-[11.5px] text-accent-rose">{error}</p>}
        <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <input ref={archivoRef} type="file" className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <BarraEscritura
          texto={texto} onTexto={setTexto} onEnviar={() => void mandar()} onVoz={(f) => void mandarVoz(f)}
          hayAdjunto={Boolean(archivo || vinculo)} enviando={enviar.isPending} onError={setError} textareaRef={cajaRef}
          placeholder={respondiendo ? `Responder a ${respondiendo.autor_nombre}` : "Mensaje"}
          personas={mencionables}
          onImagenPegada={setArchivo}
          iconos={<>
            {modulos.length > 0 && (
              <BotonCaja onClick={() => setEligiendo((v) => !v)} activo={eligiendo || Boolean(vinculo)}
                titulo={`Vincular ${moduloCanal ? moduloCanal.item.toLowerCase() : "un elemento"} a este mensaje`}><IconoEnlace /></BotonCaja>
            )}
            <BotonCaja onClick={() => archivoRef.current?.click()} titulo="Adjuntar archivo"><IconoClip /></BotonCaja>
          </>}
          iconosSinTexto={<BotonCaja onClick={() => fotoRef.current?.click()} titulo="Tomar o subir una foto"><IconoCamara /></BotonCaja>}
        />
      </div>
    </div>
  );
}
