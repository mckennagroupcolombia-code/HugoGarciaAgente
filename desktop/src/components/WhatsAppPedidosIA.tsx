import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Icon } from "../icons";

// Pedidos que arma el agente de ventas WA (app/agent/ventas_wa). El bot NO cierra
// la venta: los "listos para cerrar" esperan que un asesor confirme el total,
// comparta los datos de pago y cierre por WhatsApp.

interface ItemPedido {
  ref: string;
  nombre: string;
  precio: number;
  cantidad: number;
  subtotal: number;
}

interface PedidoIA {
  id: number;
  jid: string;
  display: string;
  estado: "abierto" | "esperando_asesor" | "cerrado" | "cancelado";
  items: ItemPedido[];
  cliente: Record<string, string>;
  subtotal: number;
  envio: number | null;
  envio_zona: string | null;
  total: number | null;
  faltantes: string[];
  handoff_ts: number | null;
  handoff_motivo: string | null;
  actualizado: number;
}

interface TurnoIA {
  id: number;
  ts: number;
  jid: string;
  display: string;
  entrada: string | null;
  respuesta: string | null;
  herramientas: string | null;
  llamadas: number;
  error: string | null;
}

type Modo = "activo" | "sombra";

interface Hallazgo {
  tipo: string;
  severidad: "alta" | "media" | "baja";
  detalle: string;
}

interface Auditoria {
  ultimo: { fecha: string; hallazgos: Hallazgo[] } | null;
  auditoria_diaria: { fecha: string; turnos: number; informe: string } | null;
}

function PanelAuditor() {
  const [a, setA] = useState<Auditoria | null>(null);
  const [verInforme, setVerInforme] = useState(false);
  useEffect(() => {
    const cargar = () => api.get<Auditoria>("/api/bot/auditoria").then(setA).catch(() => {});
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!a?.ultimo) return null;
  const color = { alta: "text-red-500", media: "text-amber-600", baja: "text-muted" } as const;
  return (
    <div className="rounded-xl border border-border bg-surface-panel p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">Auditor de canales</span>
        <span className="text-muted">{a.ultimo.fecha.replace("T", " ")}</span>
      </div>
      {a.ultimo.hallazgos.length === 0 ? (
        <p className="text-muted">Sin novedades en la última revisión.</p>
      ) : (
        <ul className="space-y-1">
          {a.ultimo.hallazgos.map((h, i) => (
            <li key={i} className={color[h.severidad]}>
              ● {h.detalle}
            </li>
          ))}
        </ul>
      )}
      {a.auditoria_diaria && (
        <div>
          <button type="button" className="underline text-muted" onClick={() => setVerInforme((v) => !v)}>
            {verInforme ? "Ocultar" : "Ver"} auditoría diaria con IA ({a.auditoria_diaria.fecha.slice(0, 10)})
          </button>
          {verInforme && <p className="mt-1 whitespace-pre-wrap text-ink">{a.auditoria_diaria.informe}</p>}
        </div>
      )}
    </div>
  );
}

const MOTIVOS: Record<string, string> = {
  pedido_listo: "Pedido listo",
  cliente_pide_asesor: "Pidió asesor",
  conversacion_dificil: "Conversación difícil",
  consulta_tecnica: "Consulta técnica",
  producto_no_disponible: "Producto fuera de la web",
  otro: "Revisar",
};

const pesos = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("es-CO")}`;

function hace(ts: number) {
  const min = Math.round((Date.now() / 1000 - ts) / 60);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

function TarjetaPedido({
  p,
  modo,
  onAbrirChat,
  onEstado,
}: {
  p: PedidoIA;
  modo: Modo;
  onAbrirChat: (jid: string) => void;
  onEstado: (id: number, estado: PedidoIA["estado"]) => void;
}) {
  const nombre = p.cliente.nombre || p.display;
  return (
    <div className="rounded-xl border border-border bg-surface-panel p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{nombre}</p>
          <p className="text-[11px] text-muted truncate">
            {p.display}
            {p.cliente.ciudad ? ` · ${p.cliente.ciudad}` : ""} · {hace(p.actualizado)}
          </p>
        </div>
        {p.handoff_motivo && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
            {MOTIVOS[p.handoff_motivo] ?? p.handoff_motivo}
          </span>
        )}
      </div>

      {p.items.length > 0 && (
        <ul className="text-xs text-ink space-y-0.5">
          {p.items.map((i) => (
            <li key={i.ref} className="flex justify-between gap-2">
              <span className="truncate">
                {i.nombre} ×{i.cantidad}
              </span>
              <span className="tabular-nums text-muted">{pesos(i.subtotal)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="text-xs border-t border-border pt-2 space-y-0.5">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="tabular-nums">{pesos(p.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Envío referencial{p.envio_zona ? ` (${p.envio_zona})` : ""}</span>
          <span className="tabular-nums">{pesos(p.envio)}</span>
        </div>
        <div className="flex justify-between font-semibold text-ink">
          <span>Total referencial</span>
          <span className="tabular-nums">{pesos(p.total)}</span>
        </div>
      </div>

      {p.faltantes.length > 0 && (
        <p className="text-[11px] text-amber-600">Faltan datos: {p.faltantes.join(", ")}</p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => onAbrirChat(p.jid)}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-white"
        >
          <Icon name="chat" size={14} /> Abrir chat
        </button>
        {modo === "activo" && (p.estado === "abierto" || p.estado === "esperando_asesor") && (
          <>
            <button
              type="button"
              onClick={() => onEstado(p.id, "cerrado")}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-ink hover:bg-surface"
            >
              Venta cerrada
            </button>
            <button
              type="button"
              onClick={() => onEstado(p.id, "cancelado")}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface"
            >
              No se concretó
            </button>
          </>
        )}
        {modo === "activo" && (p.estado === "cerrado" || p.estado === "cancelado") && (
          <button
            type="button"
            onClick={() => onEstado(p.id, "abierto")}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface"
          >
            Reabrir
          </button>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppPedidosIA({ onAbrirChat }: { onAbrirChat: (jid: string) => void }) {
  const [modo, setModo] = useState<Modo | null>(null);
  const [modoVigente, setModoVigente] = useState<string>("off");
  const [pedidos, setPedidos] = useState<PedidoIA[]>([]);
  const [turnos, setTurnos] = useState<TurnoIA[]>([]);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const q = modo ? `?modo=${modo}` : "";
      const d = await api.get<{ modo: Modo; modo_vigente: string; pedidos: PedidoIA[] }>(`/api/bot/pedidos-wa${q}`);
      setPedidos(d.pedidos ?? []);
      setModoVigente(d.modo_vigente);
      if (!modo) setModo(d.modo);
      if ((modo ?? d.modo) === "sombra") {
        const t = await api.get<{ turnos: TurnoIA[] }>("/api/bot/turnos-wa?modo=sombra&limit=40");
        setTurnos(t.turnos ?? []);
      } else {
        setTurnos([]);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los pedidos");
    }
  }, [modo]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  async function cambiarEstado(id: number, estado: PedidoIA["estado"]) {
    try {
      await api.post(`/api/bot/pedidos-wa/${id}/estado`, { estado, modo });
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar");
    }
  }

  const grupos: { titulo: string; ayuda: string; lista: PedidoIA[] }[] = [
    {
      titulo: "Listos para cerrar",
      ayuda: "El cliente ya tiene productos y datos: confirma total, comparte datos de pago y cierra por WhatsApp.",
      lista: pedidos.filter((p) => p.estado === "esperando_asesor"),
    },
    {
      titulo: "En curso",
      ayuda: "El agente sigue armando el pedido con el cliente.",
      lista: pedidos.filter((p) => p.estado === "abierto"),
    },
    {
      titulo: "Cerrados y no concretados (7 días)",
      ayuda: "",
      lista: pedidos.filter((p) => p.estado === "cerrado" || p.estado === "cancelado"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Agente de ventas IA: <strong className="text-ink">{modoVigente}</strong>. Arma el pedido con precios de la web
          y avisa al asesor; el cierre y los datos de pago los maneja una persona.
        </p>
        <div className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["activo", "sombra"] as Modo[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded-md px-2.5 py-1 ${modo === m ? "bg-accent text-white" : "text-muted"}`}
            >
              {m === "activo" ? "Reales" : "Sombra"}
            </button>
          ))}
        </div>
      </div>

      <PanelAuditor />

      {modo === "sombra" && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-ink">
          Modo sombra: estos pedidos y respuestas son borradores del agente. El cliente <strong>no</strong> los vio y
          no se avisó a nadie; sirven para compararlos con lo que respondió el asesor.
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}

      {grupos.map((g) => (
        <section key={g.titulo} className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {g.titulo} <span className="text-muted font-normal">({g.lista.length})</span>
            </h3>
            {g.ayuda && <p className="text-[11px] text-muted">{g.ayuda}</p>}
          </div>
          {g.lista.length === 0 ? (
            <p className="text-xs text-muted">Nada por ahora.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {g.lista.map((p) => (
                <TarjetaPedido key={p.id} p={p} modo={modo ?? "activo"} onAbrirChat={onAbrirChat} onEstado={cambiarEstado} />
              ))}
            </div>
          )}
        </section>
      ))}

      {modo === "sombra" && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Qué habría respondido el agente</h3>
          {turnos.length === 0 ? (
            <p className="text-xs text-muted">Sin turnos todavía.</p>
          ) : (
            <div className="space-y-2">
              {turnos.map((t) => (
                <div key={t.id} className="rounded-xl border border-border bg-surface-panel p-3 text-xs space-y-1">
                  <div className="flex justify-between gap-2 text-muted">
                    <button type="button" className="truncate text-left underline" onClick={() => onAbrirChat(t.jid)}>
                      {t.display}
                    </button>
                    <span className="shrink-0">
                      {hace(t.ts)} · {t.llamadas} llamadas
                    </span>
                  </div>
                  <p className="text-ink">
                    <span className="text-muted">Cliente:</span> {t.entrada}
                  </p>
                  <p className="whitespace-pre-wrap text-ink">
                    <span className="text-muted">Agente:</span> {t.respuesta}
                  </p>
                  {t.herramientas && <p className="text-[10px] text-muted">Herramientas: {t.herramientas}</p>}
                  {t.error && <p className="text-[10px] text-red-500">Error: {t.error}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
