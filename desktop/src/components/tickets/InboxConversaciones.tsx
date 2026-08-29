import { useEffect, useMemo, useState } from "react";
import type { TicketsUser } from "../../stores/ticketsAuth";
import {
  useConversaciones, usePresenciaEnLinea, useUsuariosEquipo,
  type Conversacion,
} from "../../hooks/useConversaciones";
import HiloConversacion, { Avatar } from "./HiloConversacion";
import { tiempoRelativo, ESTADO_LABEL, ESTADO_PILL_CLASS, estaAbierta, uidEq } from "./ticketsFormat";

type TipoTab = "solicitud" | "accion";

function puedeVerTipo(
  permisos: Record<string, boolean> | null | undefined,
  nivel: number,
  tab: "acciones" | "solicitudes",
): boolean {
  if (nivel >= 3) return true;
  if (!permisos) return true;
  return Boolean(permisos[`tickets_${tab}`]);
}

function chipCls(activo: boolean) {
  return `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
    activo ? "bg-accent text-white" : "bg-surface-panel text-muted hover:text-ink border border-border"
  }`;
}

function ConversacionRow({
  c, activa, propio, enLinea, onClick,
}: { c: Conversacion; activa: boolean; propio: boolean; enLinea: boolean; onClick: () => void }) {
  const abierta = estaAbierta(c.estado);
  const previewAutor = c.ultimo_usuario_id != null && !propio ? `${c.ultimo_autor}: ` : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-b border-border/40 transition ${
        activa ? "bg-accent/10" : "hover:bg-surface-panel/60"
      } ${!abierta ? "opacity-70" : ""}`}
    >
      <Avatar nombre={c.contraparte_nombre} enLinea={enLinea} size={9} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={`truncate text-[13px] ${c.no_leidos > 0 ? "font-bold text-ink" : "font-semibold text-ink/90"}`}>
            {c.titulo}
          </p>
        </div>
        <p className={`truncate text-[12px] ${c.no_leidos > 0 ? "text-ink/80 font-medium" : "text-muted"}`}>
          {c.ultimo_texto ? `${previewAutor}${c.ultimo_texto}` : (abierta ? "Sin mensajes aún" : "Sin mensajes")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${ESTADO_PILL_CLASS[c.estado] ?? "bg-muted/10 text-muted"}`}>
            {abierta ? "●" : "✓"} {ESTADO_LABEL[c.estado] ?? c.estado}
          </span>
          <span className="min-w-0 max-w-[9rem] truncate text-muted/80">{c.contraparte_nombre}</span>
          {c.adjuntos_total > 0 && <span className="shrink-0 text-muted/80">📎{c.adjuntos_total}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] text-muted/70">{tiempoRelativo(c.ultima_actividad)}</span>
        {c.no_leidos > 0 && (
          <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
            {c.no_leidos > 99 ? "99+" : c.no_leidos}
          </span>
        )}
      </div>
    </button>
  );
}

export default function InboxConversaciones({
  token, user, onAbrirDetalleCompleto, bootTicketId, onBootConsumed, bootTipo, onBootTipoConsumed,
}: {
  token: string;
  user: TicketsUser;
  onAbrirDetalleCompleto: (ticketId: number) => void;
  bootTicketId?: number | null;
  onBootConsumed?: () => void;
  /** Filtro de tipo a aplicar una vez al entrar (ej. desde una tarjeta del dashboard que distingue Acciones/Solicitudes). */
  bootTipo?: TipoTab | null;
  onBootTipoConsumed?: () => void;
}) {
  const nivel = user.rol?.nivel ?? 1;
  const permisos = user.permisos_secciones;
  const verAcciones = puedeVerTipo(permisos, nivel, "acciones");
  const verSolicitudes = puedeVerTipo(permisos, nivel, "solicitudes");
  const tipoPorDefecto: TipoTab = verSolicitudes ? "solicitud" : "accion";

  const [tipo, setTipo] = useState<TipoTab>(() => {
    const guardado = localStorage.getItem("mck_inbox_tipo");
    return guardado === "solicitud" || guardado === "accion" ? guardado : tipoPorDefecto;
  });
  const [busqueda, setBusqueda] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => { localStorage.setItem("mck_inbox_tipo", tipo); }, [tipo]);

  useEffect(() => {
    if (bootTicketId != null) {
      setSelectedId(bootTicketId);
      onBootConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTicketId]);

  useEffect(() => {
    if (bootTipo) {
      setTipo(bootTipo);
      onBootTipoConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTipo]);

  // Bandeja personal siempre: mías (creadas por mí, asignadas a mí, o donde participo),
  // activas e histórico juntos — nada se oculta ni desaparece, solo baja en la lista.
  const { data: conversaciones = [], isLoading, isError, error, refetch } = useConversaciones(tipo, "mias");
  const { data: presencia } = usePresenciaEnLinea();
  const { data: usuariosEquipo = [] } = useUsuariosEquipo();
  const enLineaIds = useMemo(() => new Set(presencia?.usuario_ids ?? []), [presencia]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return conversaciones;
    return conversaciones.filter((c) =>
      c.titulo.toLowerCase().includes(q) ||
      (c.contraparte_nombre ?? "").toLowerCase().includes(q) ||
      c.numero.toLowerCase().includes(q));
  }, [conversaciones, busqueda]);

  const totalNoLeidos = conversaciones.reduce((acc, c) => acc + c.no_leidos, 0);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className={`flex w-full flex-col border-r border-border lg:w-[360px] lg:shrink-0 ${selectedId != null ? "hidden lg:flex" : "flex"}`}>
        <div className="border-b border-border px-3 py-2.5">
          <p className="mb-2 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">
            Equipo conectado
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {usuariosEquipo.map((u) => (
              <div key={u.id} className="flex shrink-0 flex-col items-center gap-1" title={u.nombre}>
                <Avatar nombre={u.nombre} enLinea={enLineaIds.has(u.id)} size={8} />
              </div>
            ))}
            {usuariosEquipo.length === 0 && <p className="text-[11px] text-muted italic py-1">Sin datos de equipo</p>}
          </div>
        </div>

        <div className="border-b border-border p-2.5 space-y-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar conversación…"
            className="w-full rounded-xl border border-border bg-surface-panel px-3 py-2 text-[13px] text-ink outline-none focus:border-accent/50"
          />
          <div className="flex flex-wrap gap-1.5">
            {verSolicitudes && (
              <button type="button" className={chipCls(tipo === "solicitud")} onClick={() => setTipo("solicitud")}>Solicitudes</button>
            )}
            {verAcciones && (
              <button type="button" className={chipCls(tipo === "accion")} onClick={() => setTipo("accion")}>Acciones</button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && conversaciones.length === 0 && !isError && (
            <p className="p-4 text-center text-[12px] text-muted">Cargando conversaciones…</p>
          )}
          {isError && conversaciones.length === 0 && (
            <div className="p-4 text-center text-[12px] text-red-500">
              <p className="font-semibold">No se pudo cargar el inbox.</p>
              <p className="mt-1 text-muted">{error instanceof Error ? error.message : "Error de conexión."}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-ink hover:bg-surface-panel"
              >
                Reintentar
              </button>
            </div>
          )}
          {!isLoading && !isError && filtradas.length === 0 && (
            <p className="p-4 text-center text-[12px] text-muted italic">
              {busqueda ? "Sin resultados para tu búsqueda." : `No tienes ${tipo === "accion" ? "acciones" : "solicitudes"} todavía.`}
            </p>
          )}
          {filtradas.map((c) => (
            <ConversacionRow
              key={c.id}
              c={c}
              activa={c.id === selectedId}
              propio={uidEq(c.ultimo_usuario_id, user.id)}
              enLinea={c.contraparte_id != null && enLineaIds.has(c.contraparte_id)}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
        </div>
        {totalNoLeidos > 0 && (
          <div className="border-t border-border px-3 py-1.5 text-center text-[11px] text-muted">
            {totalNoLeidos} mensaje{totalNoLeidos === 1 ? "" : "s"} sin leer
          </div>
        )}
      </div>

      <div className={`min-w-0 flex-1 min-h-0 flex-col ${selectedId != null ? "flex" : "hidden lg:flex"}`}>
        {selectedId != null ? (
          <HiloConversacion
            key={selectedId}
            ticketId={selectedId}
            token={token}
            user={user}
            enLineaIds={enLineaIds}
            onVerDetalleCompleto={onAbrirDetalleCompleto}
            onCerrar={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted italic">
            Selecciona una conversación para ver el chat
          </div>
        )}
      </div>
    </div>
  );
}
