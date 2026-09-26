/**
 * «Tu día»: la Agenda dentro del Mapa (25-sep-2026). El Mapa es la pantalla principal y la
 * Agenda convive con él en esta columna (en el celular, una hoja que sube desde abajo).
 *
 * - Me pidieron: las solicitudes asignadas a esta persona. Tocar una lleva la cámara a la
 *   etapa donde se resuelve (lib/flujoTickets, reglas por título, sin IA) y la destaca;
 *   «Abrir» la abre en la Agenda, con el mismo camino que el botón de solicitudes en proceso.
 * - Puedo iniciar / Me espera: acciones activas y recordatorios que vencen hoy.
 * - Pagos por confirmar, Mi quincena y el dólar: las MISMAS piezas de la Agenda (no copias),
 *   así que dicen lo mismo en los dos lugares.
 * La Agenda completa (Mensajes, crear solicitudes…) sigue a un toque: «Abrir la Agenda».
 */
import { etapaDeTicket } from "../lib/flujoTickets";
import { useAppStore } from "../stores/app";
import DolarHoraGadget from "./DolarHoraGadget";
import MiQuincena from "./MiQuincena";
import PagosClientes from "./PagosClientes";
import { Sprite } from "./colaboradores/pixel";

export type TareaTuDia = { id: number; titulo?: string | null; categoria?: string | null; prioridad?: string | null };
export type RecordatorioTuDia = { id?: number; titulo?: string | null; proxima_fecha?: string | null };

const MAX = 6;

export default function TuDia({
  token, mias, acciones, recordatorios, abierto, vertical, onAlternar, onVerEtapa, colorEtapa,
}: {
  token: string;
  mias: TareaTuDia[];
  acciones: TareaTuDia[];
  recordatorios: RecordatorioTuDia[];
  abierto: boolean;
  vertical: boolean;
  onAlternar: () => void;
  onVerEtapa: (etapaId: string) => void;
  colorEtapa: (etapaId: string) => { fondo: string; tinta: string };
}) {
  const setPanel = useAppStore((s) => s.setPanel);
  const setCentroMandoView = useAppStore((s) => s.setCentroMandoView);
  const setSolicitudBoot = useAppStore((s) => s.setSolicitudBoot);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);
  const setAccionesBootTab = useAppStore((s) => s.setAccionesBootTab);

  // Mismo camino que SolicitudesEnProcesoFab: vista «mensajes» con esa solicitud abierta.
  const abrirSolicitud = (id: number) => {
    setCentroMandoView("mensajes");
    setSolicitudBoot({ abrirTicketId: id });
    setPanel("hugo");
  };
  const abrirAgenda = () => {
    setAccionesBootTab(null);
    setTicketsBootView("home");
    setCentroMandoView("home");
    setPanel("hugo");
  };

  const urgentes = mias.filter((t) => t.prioridad === "urgente" || t.prioridad === "alta").length;
  const pendientes = mias.length + recordatorios.length;
  // Lo urgente primero; después, en el orden en que llegó.
  const ordenadas = [...mias].sort((a, b) => Number(esUrgente(b)) - Number(esUrgente(a)));

  if (!abierto) {
    // El DIV se posiciona, no el botón: index.css fuerza `position: relative` en todo <button>,
    // y la pestaña del celular (absoluta) terminaba debajo del lienzo, tapada por la barra.
    return (
      <div className={vertical ? "td-plegado-caja-movil" : "td-plegado-caja"}>
      <button type="button" className={`td-plegado ${vertical ? "td-plegado-movil" : ""} nodrag nopan`} onClick={onAlternar}
              aria-expanded="false" title="Ver tu día: lo que te pidieron, tus recordatorios, tu quincena">
        <Sprite s="jugador" px={2} colores={{ X: "#29ADFF" }} />
        <span className="td-plegado-t">Tu día</span>
        {pendientes > 0 && <span className={`td-cuenta ${urgentes ? "td-cuenta-urgente" : ""}`}>{pendientes}</span>}
        <span aria-hidden="true">{vertical ? "▲" : "«"}</span>
      </button>
      </div>
    );
  }

  return (
    <aside className={`td-panel ${vertical ? "td-panel-movil" : ""}`} aria-label="Tu día">
      <div className="td-cab">
        <Sprite s="jugador" px={2} colores={{ X: "#29ADFF" }} />
        <div className="min-w-0 flex-1">
          <p className="td-titulo">Tu día</p>
          <p className="td-fecha">{new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <button type="button" className="td-cerrar" onClick={onAlternar} aria-expanded="true" title="Plegar">
          {vertical ? "▼" : "»"}
        </button>
      </div>

      <div className="td-cuerpo">
        <section>
          <p className="td-seccion"><Sprite s="urna" px={2} /> Me pidieron <b>{mias.length}</b>
            {urgentes > 0 && <span className="td-urg">! {urgentes}</span>}</p>
          {mias.length === 0 && <p className="td-vacio">Nada asignado a tu nombre.</p>}
          <ul className="space-y-1">
            {ordenadas.slice(0, MAX).map((t) => {
              const u = etapaDeTicket(t);
              const c = u ? colorEtapa(u.etapa.id) : null;
              return (
                <li key={t.id} className={`td-item ${esUrgente(t) ? "td-item-urgente" : ""}`}>
                  <button type="button" className="td-fila" disabled={!u}
                          onClick={() => u && onVerEtapa(u.etapa.id)}
                          title={u ? `Ver en el mapa: se resuelve en ${u.etapa.titulo}` : "Sin etapa reconocida"}>
                    {u && c && <span className="td-etapa" style={{ background: c.fondo, color: c.tinta }}>{u.etapa.titulo}</span>}
                    <span className="td-texto">{t.titulo || `Solicitud ${t.id}`}</span>
                  </button>
                  <button type="button" className="td-abrir" onClick={() => abrirSolicitud(t.id)} title="Abrir en la Agenda">
                    Abrir
                  </button>
                </li>
              );
            })}
          </ul>
          {mias.length > MAX && (
            <button type="button" className="td-mas" onClick={abrirAgenda}>+{mias.length - MAX} más en la Agenda</button>
          )}
        </section>

        <section>
          <p className="td-seccion"><Sprite s="control" px={2} /> Puedo iniciar <b>{acciones.length}</b></p>
          {acciones.slice(0, 3).map((a) => (
            <button key={a.id} type="button" className="td-linea" onClick={abrirAgenda}>{a.titulo}</button>
          ))}
          {acciones.length === 0 && <p className="td-vacio">Sin acciones activas.</p>}
        </section>

        <section>
          <p className="td-seccion"><Sprite s="reloj" px={2} /> Me espera hoy <b>{recordatorios.length}</b></p>
          {recordatorios.slice(0, 3).map((r, i) => (
            <button key={r.id ?? i} type="button" className="td-linea" onClick={abrirAgenda}>{r.titulo}</button>
          ))}
          {recordatorios.length === 0 && <p className="td-vacio">Ningún recordatorio para hoy.</p>}
        </section>

        {/* Las piezas de la Agenda, tal cual: una sola fuente de verdad. */}
        <PagosClientes token={token} />
        <MiQuincena token={token} />
        <DolarHoraGadget />

        <button type="button" className="td-agenda" onClick={abrirAgenda}>▶ Abrir la Agenda completa</button>
      </div>
    </aside>
  );
}

function esUrgente(t: TareaTuDia): boolean {
  return t.prioridad === "urgente" || t.prioridad === "alta";
}
