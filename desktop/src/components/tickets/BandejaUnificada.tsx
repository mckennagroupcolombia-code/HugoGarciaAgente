import { useEffect, useMemo, useState } from "react";
import type { TicketsUser } from "../../stores/ticketsAuth";
import { usePresenciaEnLinea } from "../../hooks/useConversaciones";
import { useBandeja, type ItemBandeja, type SeccionBandeja } from "../../lib/bandeja";
import { colorDePersona } from "../../lib/personaColor";
import HiloConversacion from "./HiloConversacion";
import HiloCanal from "../chat_equipo/HiloCanal";
import { ESTADO_LABEL, iniciales, tiempoRelativo, uidEq } from "./ticketsFormat";
import { irAVistaMensajes } from "../chat_equipo/SelectorMensajes";
import "./bandeja.css";

/**
 * Bandeja unificada del celular (7-oct-2026): solicitudes, acciones y grupos en UNA lista,
 * en tres pestañas con su número — Te toca · Enterarte · Haciendo (reglas en lib/bandeja.ts).
 * Filas de dos líneas; al tocar una, el hilo ocupa la pantalla (solicitud o grupo). Reemplaza en
 * pantallas angostas a la bandeja de escritorio (InboxConversaciones) y al selector Solicitudes/Grupos.
 */
type Tab = Exclude<SeccionBandeja, "hechas">;
type Abierto = { kind: "solicitud"; id: number } | { kind: "grupo"; id: number } | null;

const TABS: { id: Tab; label: string; vacio: string }[] = [
  { id: "te_toca", label: "Te toca", vacio: "Nada te toca ahora. ¡Al día! ★" },
  { id: "enterarte", label: "Enterarte", vacio: "Nada nuevo por leer." },
  { id: "haciendo", label: "Haciendo", vacio: "No tienes nada en curso." },
];

const CLAVE_TAB = "mck-bandeja-tab";
function leerTab(): Tab | null {
  try {
    const v = sessionStorage.getItem(CLAVE_TAB);
    return v === "te_toca" || v === "enterarte" || v === "haciendo" ? v : null;
  } catch { return null; }
}

function haceMs(ts: number): string {
  if (!ts) return "";
  const min = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d} d` : new Date(ts).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

/** Vista previa de una línea: sin los *asteriscos* del formato de WhatsApp. */
function sinFormato(t: string): string {
  return (t || "").replace(/(^|[^\p{L}\p{N}])[*_~]([^*_~\n]+)[*_~](?![\p{L}\p{N}])/gu, "$1$2");
}

function Fila({ it, uid, onAbrir }: { it: ItemBandeja; uid: number; onAbrir: () => void }) {
  const nuevo = it.noLeidos > 0;
  if (it.kind === "grupo") {
    const g = it.g;
    const u = g.ultimo;
    return (
      <button type="button" onClick={onAbrir} className={`bj-fila ${nuevo ? "bj-nuevo" : ""}`}>
        <span className="bj-avatar bj-avatar-grupo" style={{ background: colorDePersona(g.nombre) }} aria-hidden>
          {g.nombre.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="bj-linea">
            <span className="bj-titulo">{g.nombre}</span>
            <span className="bj-hora">{haceMs(it.ts)}</span>
          </span>
          <span className="bj-linea">
            <span className="bj-sub">
              <span className="bj-chip bj-chip-grupo">Grupo</span>
              {u ? <><b>{u.autor_nombre.split(" ")[0]}:</b> {sinFormato(u.texto) || (u.adjunto_nombre ? "📎 adjunto" : "📷 foto")}</> : "Sin mensajes"}
            </span>
            {nuevo && <span className="bj-badge">{it.noLeidos > 99 ? "99+" : it.noLeidos}</span>}
          </span>
        </span>
      </button>
    );
  }
  const c = it.c;
  const propio = uidEq(c.ultimo_usuario_id, uid);
  const autor = c.ultimo_texto ? (propio ? "Tú: " : c.ultimo_autor ? `${c.ultimo_autor.split(" ")[0]}: ` : "") : "";
  return (
    <button type="button" onClick={onAbrir} className={`bj-fila ${nuevo ? "bj-nuevo" : ""}`}>
      <span className="bj-avatar" style={{ background: colorDePersona(c.contraparte_nombre || "?") }} aria-hidden>
        {iniciales(c.contraparte_nombre)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="bj-linea">
          <span className="bj-titulo">{c.titulo}</span>
          <span className="bj-hora">{tiempoRelativo(c.ultima_actividad).replace(/^hace /, "")}</span>
        </span>
        <span className="bj-linea">
          <span className="bj-sub">
            <span className={`bj-chip bj-estado-${c.estado}`}>{ESTADO_LABEL[c.estado] ?? c.estado}</span>
            {c.ultimo_texto
              ? <>{autor && <b>{autor}</b>}{c.ultimo_texto}</>
              : <>{c.tipo === "accion" ? "Tarea" : "Solicitud"} · {c.contraparte_nombre ?? "—"}</>}
          </span>
          {nuevo && <span className="bj-badge">{it.noLeidos > 99 ? "99+" : it.noLeidos}</span>}
        </span>
      </span>
    </button>
  );
}

export default function BandejaUnificada({
  token, user, bootTicketId, onBootConsumed, onCrearSolicitud, onCrearAccion,
}: {
  token: string;
  user: TicketsUser;
  bootTicketId?: number | null;
  onBootConsumed?: () => void;
  onCrearSolicitud?: () => void;
  onCrearAccion?: () => void;
}) {
  const b = useBandeja();
  const { data: presencia } = usePresenciaEnLinea();
  const enLineaIds = useMemo(() => new Set(presencia?.usuario_ids ?? []), [presencia]);
  const [tabElegida, setTabElegida] = useState<Tab | null>(leerTab);
  const [abierto, setAbierto] = useState<Abierto>(null);
  const [q, setQ] = useState("");
  const [verHechas, setVerHechas] = useState(false);
  const [verGrupos, setVerGrupos] = useState(false);
  const [menuCrear, setMenuCrear] = useState(false);

  useEffect(() => {
    if (bootTicketId != null) {
      setAbierto({ kind: "solicitud", id: bootTicketId });
      onBootConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTicketId]);

  // Sin elección guardada, abre donde haya algo: primero lo que toca, luego lo nuevo.
  const tab: Tab = tabElegida ?? (b.te_toca.length ? "te_toca" : b.enterarte.length ? "enterarte" : b.haciendo.length ? "haciendo" : "te_toca");
  const elegir = (t: Tab) => {
    setTabElegida(t);
    try { sessionStorage.setItem(CLAVE_TAB, t); } catch { /* sin almacenamiento */ }
  };

  if (abierto?.kind === "solicitud") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HiloConversacion key={abierto.id} ticketId={abierto.id} token={token} user={user} enLineaIds={enLineaIds}
                          onCerrar={() => setAbierto(null)} />
      </div>
    );
  }
  const grupoAbierto = abierto?.kind === "grupo" ? b.grupos.find((i) => i.kind === "grupo" && i.g.id === abierto.id) : undefined;
  if (grupoAbierto?.kind === "grupo") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <HiloCanal key={grupoAbierto.g.id} canal={grupoAbierto.g} onVolver={() => setAbierto(null)} />
      </div>
    );
  }

  const texto = q.trim().toLowerCase();
  const coincide = (it: ItemBandeja) => !texto || (it.kind === "grupo"
    ? it.g.nombre.toLowerCase().includes(texto)
    : it.c.titulo.toLowerCase().includes(texto) || (it.c.contraparte_nombre ?? "").toLowerCase().includes(texto) || it.c.numero.toLowerCase().includes(texto));
  // Buscando, se busca en todo (pestañas, historial y grupos) en una sola lista.
  const resultados = texto
    ? [...b.te_toca, ...b.enterarte, ...b.haciendo, ...b.hechas, ...b.grupos.filter((g) => g.noLeidos === 0)].filter(coincide)
    : null;
  const abrir = (it: ItemBandeja) => setAbierto(it.kind === "grupo" ? { kind: "grupo", id: it.g.id } : { kind: "solicitud", id: it.c.id });
  const fila = (it: ItemBandeja) => <Fila key={it.key} it={it} uid={user.id} onAbrir={() => abrir(it)} />;
  const lista = b[tab];
  const otrosGrupos = b.grupos.filter((g) => g.noLeidos === 0);
  const puedeCrear = Boolean(onCrearSolicitud || onCrearAccion);

  return (
    <div className="bj flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="bj-cabeza">
        <div className="bj-tabs" role="tablist" aria-label="Tu bandeja">
          {TABS.map((t) => {
            const n = b[t.id].length;
            const nuevos = b[t.id].some((i) => i.noLeidos > 0);
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => elegir(t.id)}
                      className={`bj-tab ${tab === t.id ? "bj-tab-on" : ""}`}>
                <b>{n}</b><span>{t.label}</span>
                {nuevos && <i className="bj-punto" aria-label="hay mensajes nuevos" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar solicitud, persona o grupo…"
                 className="bj-buscar min-w-0 flex-1" aria-label="Buscar" />
          {puedeCrear && (
            <div className="relative">
              <button type="button" className="bj-crear" aria-expanded={menuCrear} onClick={() => setMenuCrear((v) => !v)}
                      aria-label="Crear">＋</button>
              {menuCrear && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuCrear(false)} aria-hidden />
                  <div className="bj-menu" role="menu">
                    {onCrearSolicitud && (
                      <button type="button" role="menuitem" onClick={() => { setMenuCrear(false); onCrearSolicitud(); }}>Pedir algo a alguien</button>
                    )}
                    {onCrearAccion && (
                      <button type="button" role="menuitem" onClick={() => { setMenuCrear(false); onCrearAccion(); }}>Nueva tarea</button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {b.cargando && lista.length === 0 && <p className="bj-vacio">Cargando…</p>}
        {b.error != null && lista.length === 0 && (
          <div className="bj-vacio">
            <p className="font-bold">No se pudo cargar la bandeja.</p>
            <button type="button" className="bj-mas mt-2" onClick={b.reintentar}>Reintentar</button>
          </div>
        )}

        {resultados ? (
          resultados.length ? resultados.map(fila) : <p className="bj-vacio">Nada coincide con «{q.trim()}».</p>
        ) : (
          <>
            {!b.cargando && b.error == null && lista.length === 0 && <p className="bj-vacio">{TABS.find((t) => t.id === tab)?.vacio}</p>}
            {lista.map(fila)}

            {/* Los grupos sin nada nuevo siguen a la mano, plegados, al final de «Enterarte». */}
            {tab === "enterarte" && otrosGrupos.length > 0 && (
              <>
                <button type="button" className="bj-pliegue" onClick={() => setVerGrupos((v) => !v)} aria-expanded={verGrupos}>
                  <span className="flex-1">Todos los grupos · {otrosGrupos.length}</span><span aria-hidden>{verGrupos ? "▲" : "▼"}</span>
                </button>
                {verGrupos && otrosGrupos.map(fila)}
              </>
            )}
            {tab === "enterarte" && b.puedeAdministrarGrupos && (
              <button type="button" className="bj-pliegue text-accent" onClick={() => irAVistaMensajes("grupos")}>
                <span className="flex-1">Administrar grupos (crear, enlazar a WhatsApp) →</span>
              </button>
            )}
            {/* El historial: plegado, al final de «Haciendo». */}
            {tab === "haciendo" && b.hechas.length > 0 && (
              <>
                <button type="button" className="bj-pliegue" onClick={() => setVerHechas((v) => !v)} aria-expanded={verHechas}>
                  <span className="flex-1">★ Hechas · {b.hechas.length}</span><span aria-hidden>{verHechas ? "▲" : "▼"}</span>
                </button>
                {verHechas && b.hechas.map(fila)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
