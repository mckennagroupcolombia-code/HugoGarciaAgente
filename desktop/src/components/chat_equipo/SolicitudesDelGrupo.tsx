import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useUsuariosEquipo } from "../../hooks/useConversaciones";
import {
  useCanalesEquipo,
  useSolicitudesCanal,
  type CanalEquipo,
  type MensajeCanal,
  type ModuloCanal,
  type RefMensaje,
} from "../../hooks/useCanalesEquipo";
import { abrirSolicitud } from "./SelectorMensajes";
import { ChipVinculo, SelectorVinculo } from "./VinculoModulo";

/**
 * «Solicitar a…» dentro de un grupo (pedido del 5-oct-2026): a quién, qué se necesita y de
 * qué tipo (Pago, Compra, Publicación, Etiqueta…; viene elegido según el grupo), con enlace
 * opcional al elemento del módulo (p. ej. la solicitud de pago #61) para ver el detalle.
 * Se crea con POST /api/tickets/ —los avisos de siempre— y queda en el grupo
 * (POST /api/canales/<id>/solicitudes). Arriba del chat se ven las abiertas.
 */

const ESTADO: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  esperando_aprobacion: "Por aprobar",
};

const PRIORIDADES = [
  { v: "alta", t: "Alta" },
  { v: "media", t: "Media" },
  { v: "baja", t: "Baja" },
] as const;

function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

export default function SolicitudesDelGrupo({
  canal, modulo, desde, onDesdeUsado, abrirSenal = 0,
}: {
  canal: CanalEquipo;
  modulo: ModuloCanal | null;
  /** Mensaje del chat que se quiere volver solicitud («→ tarea»). */
  desde: MensajeCanal | null;
  onDesdeUsado: () => void;
  /** Cambia cada vez que se toca «Solicitar a…» en la cabecera del grupo. */
  abrirSenal?: number;
}) {
  const qc = useQueryClient();
  const datos = useSolicitudesCanal(canal.id);
  const catalogo = useCanalesEquipo().data;
  const tipos = catalogo?.tipos_solicitud ?? [];
  const modulos = catalogo?.modulos ?? [];
  const usuarios = useUsuariosEquipo();
  const lista = datos.data?.solicitudes ?? [];
  const tipoDelGrupo = modulo?.tipo_solicitud || "otra";

  // En el celular empieza plegada (una línea): desplegada se comía media pantalla del chat.
  const [abierto, setAbierto] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 639px)").matches);
  const [creando, setCreando] = useState(false);
  const [para, setPara] = useState<number | "">("");
  const [tipo, setTipo] = useState(tipoDelGrupo);
  const [texto, setTexto] = useState("");
  const [prioridad, setPrioridad] = useState("media");
  const [fecha, setFecha] = useState("");
  const [vinculo, setVinculo] = useState<RefMensaje | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [mensajeId, setMensajeId] = useState<number | null>(null);
  const [origen, setOrigen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const abrirFormulario = () => {
    setCreando(true);
    setAbierto(true);
    setTipo(tipoDelGrupo);
  };

  useEffect(() => {
    if (abrirSenal) abrirFormulario();
  }, [abrirSenal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!desde) return;
    abrirFormulario();
    setTexto(desde.texto || "");
    setMensajeId(desde.id);
    const r = desde.ref;
    if (r && typeof r.modulo === "string" && r.id != null) {
      setVinculo({ modulo: r.modulo, id: String(r.id), titulo: String(r.titulo || ""), detalle: String(r.detalle || "") });
    }
    setOrigen(`${desde.autor_nombre} escribió en «${canal.nombre}»: ${desde.texto || "(adjunto)"}`);
    onDesdeUsado();
  }, [desde]); // eslint-disable-line react-hooks/exhaustive-deps

  const limpiar = () => {
    setCreando(false);
    setPara("");
    setTexto("");
    setPrioridad("media");
    setFecha("");
    setVinculo(null);
    setEligiendo(false);
    setMensajeId(null);
    setOrigen("");
    setError(null);
  };

  const crear = async () => {
    if (!texto.trim() || para === "" || guardando) return;
    setGuardando(true);
    setError(null);
    const lineas = texto.trim().split("\n");
    const titulo = lineas[0].slice(0, 90);
    const infoTipo = tipos.find((t) => t.clave === tipo);
    // En Compras en el exterior, una compra queda con la categoría de Importaciones para seguir saliendo ahí.
    const categoria = modulo?.categoria && tipo === tipoDelGrupo ? modulo.categoria : infoTipo?.categoria || "logistica";
    const descripcion = [
      texto.trim(),
      vinculo ? `Detalle: ${modulos.find((m) => m.clave === vinculo.modulo)?.item ?? "Enlace"} ${vinculo.titulo}` : "",
      origen || `Solicitado en el grupo «${canal.nombre}».`,
    ].filter(Boolean).join("\n\n");
    try {
      const t = await api.post<{ id: number }>("/api/tickets/", {
        titulo,
        descripcion,
        categoria,
        prioridad,
        asignado_a: para,
        tipo: "solicitud",
      });
      await api.post(`/api/canales/${canal.id}/solicitudes`, {
        ticket_id: t.id, mensaje_id: mensajeId, fecha_limite: fecha, tipo, ref: vinculo,
      });
      void qc.invalidateQueries({ queryKey: ["canales-equipo-solicitudes", canal.id] });
      void qc.invalidateQueries({ queryKey: ["canales-equipo-mensajes", canal.id] });
      void qc.invalidateQueries({ queryKey: ["tickets-conversaciones"] });
      limpiar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const personas = ((usuarios.data ?? []) as { id: number; nombre: string; activo?: number | boolean }[])
    .filter((u) => u.activo !== 0 && u.activo !== false);
  const hoy = hoyISO();
  const campo = "rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink";
  const moduloDelTipo = tipos.find((t) => t.clave === tipo)?.modulo || canal.modulo || null;

  return (
    <div className="shrink-0 border-b border-border bg-surface-panel px-2 py-1.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
          className="mck-btn-no-fx flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-bold text-ink">
          <span className="text-muted">{abierto ? "▾" : "▸"}</span>
          Solicitudes abiertas ({lista.length})
        </button>
        {!creando && (
          <button type="button" onClick={abrirFormulario}
            className="mck-btn-no-fx rounded-full bg-accent px-2.5 py-0.5 text-[11.5px] font-bold text-white">
            Solicitar a…
          </button>
        )}
      </div>

      {abierto && creando && (
        <div className="mt-1.5 space-y-1.5 rounded-lg border border-accent/40 bg-surface-input p-2">
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink">
            Solicitar a
            <select autoFocus value={para} onChange={(e) => setPara(e.target.value ? Number(e.target.value) : "")}
              aria-label="Solicitar a" className={`${campo} min-w-0 flex-1`}>
              <option value="">Elige a la persona…</option>
              {personas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tipo de solicitud">
            {tipos.map((t) => (
              <button key={t.clave} type="button" role="radio" aria-checked={tipo === t.clave} onClick={() => setTipo(t.clave)}
                className={`mck-btn-no-fx rounded-full border px-2 py-0.5 text-[11px] ${
                  tipo === t.clave ? "border-accent bg-accent text-white" : "border-border bg-surface text-ink hover:border-accent/60"
                }`}>
                {t.nombre}
              </button>
            ))}
          </div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3}
            placeholder="¿Qué necesitas? La primera línea es el título de la solicitud."
            aria-label="Qué necesitas" className={`${campo} mck-field-lg w-full resize-y`} />

          {vinculo ? (
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1"><ChipVinculo refm={vinculo} modulos={modulos} /></span>
              <button type="button" onClick={() => setVinculo(null)} className="mck-btn-no-fx px-1 text-[12px] text-muted hover:text-ink" aria-label="Quitar enlace">✕</button>
            </div>
          ) : eligiendo ? (
            <SelectorVinculo modulos={modulos} moduloInicial={moduloDelTipo}
              onCerrar={() => setEligiendo(false)} onElegir={(r) => { setVinculo(r); setEligiendo(false); }} />
          ) : (
            modulos.length > 0 && (
              <button type="button" onClick={() => setEligiendo(true)}
                className="mck-btn-no-fx text-[11.5px] font-bold text-accent hover:underline">
                🔗 Enlazar el detalle ({modulos.find((m) => m.clave === moduloDelTipo)?.item.toLowerCase() || "elemento"})
              </button>
            )
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} aria-label="Prioridad" className={campo}>
              {PRIORIDADES.map((p) => <option key={p.v} value={p.v}>Prioridad {p.t.toLowerCase()}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11.5px] text-muted">
              Vence
              <input type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className={campo} />
            </label>
          </div>
          {mensajeId && <p className="truncate text-[10.5px] text-muted">Desde el mensaje: {origen}</p>}
          {error && <p className="text-[11.5px] text-accent-rose">{error}</p>}
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void crear()} disabled={!texto.trim() || para === "" || guardando}
              className="mck-btn-no-fx rounded-md bg-accent px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">
              {guardando ? "Enviando…" : "Enviar solicitud"}
            </button>
            <button type="button" onClick={limpiar} className="mck-btn-no-fx rounded-md border border-border px-3 py-1 text-[12px] text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {abierto && (
        <div className="mt-1 max-h-44 space-y-1 overflow-y-auto">
          {datos.isLoading && <p className="px-1 text-[11.5px] text-muted">Cargando…</p>}
          {!datos.isLoading && lista.length === 0 && !creando && (
            <p className="px-1 text-[11.5px] text-muted">Ninguna abierta. Usa «Solicitar a…» o «→ tarea» en un mensaje.</p>
          )}
          {lista.map((s) => {
            const vencida = !!s.fecha_limite && s.fecha_limite < hoy;
            const nombreTipo = tipos.find((t) => t.clave === s.tipo)?.nombre;
            return (
              <div key={s.id} className="rounded-md border border-border bg-surface px-2 py-1">
                <button type="button" onClick={() => abrirSolicitud(s.id)} title="Ver el detalle de la solicitud"
                  className="mck-btn-no-fx flex w-full items-center gap-2 text-left">
                  <span className="text-[12px]">📋</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-bold text-ink">{s.numero} · {s.titulo}</span>
                    <span className="block truncate text-[10.5px] text-muted">
                      {nombreTipo ? `${nombreTipo} · ` : ""}a {s.asignado_nombre || "sin responsable"} · {ESTADO[s.estado] ?? s.estado}
                      {s.prioridad === "alta" || s.prioridad === "urgente" ? ` · ${s.prioridad}` : ""}
                      {s.origen === "modulo" && modulo ? ` · de ${modulo.nombre}` : ""}
                    </span>
                  </span>
                  {s.fecha_limite && (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${vencida ? "bg-accent-rose/15 font-bold text-accent-rose" : "bg-surface-input text-muted"}`}>
                      {vencida ? "venció " : "vence "}{fechaCorta(s.fecha_limite)}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] font-bold text-accent">Ver →</span>
                </button>
                {s.ref && <ChipVinculo refm={s.ref} modulos={modulos} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
