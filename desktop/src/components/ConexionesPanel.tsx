import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
import { api } from "../api/client";
import { Icon } from "../icons";

/**
 * Sistemas → Conexiones (28-sep-2026): todas las integraciones en un solo sitio,
 * probadas EN VIVO (app/services/conexiones.py), con el asistente para reconectar
 * cada una. Reemplaza en el menú a «Conexión MercadoLibre» y «Conexión Gmail», que
 * ahora se abren aquí dentro; los QR de WhatsApp salen de los mismos endpoints que
 * usan los paneles WhatsApp y Supervisor.
 */

const GmailOAuthPanel = lazy(() => import("./GmailOAuthPanel"));
const MeliOAuthPanel = lazy(() => import("./MeliOAuthPanel"));

type Estado = "ok" | "alerta" | "caido" | "sin_configurar";

type Conexion = {
  id: string;
  nombre: string;
  grupo: string;
  estado?: Estado;
  detalle?: string;
  verificado_en?: string;
  ms?: number;
  qr?: boolean;
  que_se_cae: string[];
  reconexion: { tipo: "qr" | "oauth_gmail" | "oauth_meli" | "guia"; qr_api?: string };
  pasos: string[];
};

type Respuesta = { items: Conexion[]; resumen: Record<Estado, number> };

const ESTILO: Record<Estado, { punto: string; chip: string; texto: string }> = {
  ok: { punto: "bg-emerald-500", chip: "bg-emerald-500/10 text-emerald-600", texto: "Conectado" },
  alerta: { punto: "bg-amber-500", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", texto: "Revisar" },
  caido: { punto: "bg-danger", chip: "bg-danger/10 text-danger", texto: "Desconectado" },
  sin_configurar: { punto: "bg-muted", chip: "bg-surface text-muted", texto: "Sin configurar" },
};
const ORDEN: Record<Estado, number> = { caido: 0, alerta: 1, sin_configurar: 2, ok: 3 };

function hora(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** Texto de un paso: lo que va entre `comillas invertidas` es un comando copiable. */
function TextoPaso({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const partes = texto.split(/(`[^`]+`)/g);
  return (
    <span>
      {partes.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <button
            key={i}
            type="button"
            title="Copiar"
            onClick={() => {
              const cmd = p.slice(1, -1);
              void navigator.clipboard.writeText(cmd).then(() => {
                setCopiado(cmd);
                window.setTimeout(() => setCopiado(null), 1500);
              });
            }}
            className="mx-0.5 inline rounded border border-border bg-surface px-1 py-0.5 font-mono text-[11px] text-ink hover:border-accent"
          >
            {copiado === p.slice(1, -1) ? "copiado ✓" : p.slice(1, -1)}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

/** Pasos con casilla: la persona va marcando por dónde va (solo en esta vista). */
function PasosGuiados({ pasos }: { pasos: string[] }) {
  const [hechos, setHechos] = useState<Set<number>>(new Set());
  return (
    <ol className="space-y-1.5">
      {pasos.map((p, i) => {
        const hecho = hechos.has(i);
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <button
              type="button"
              aria-label={hecho ? "Marcar como pendiente" : "Marcar como hecho"}
              onClick={() =>
                setHechos((prev) => {
                  const n = new Set(prev);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-extrabold ${
                hecho ? "border-emerald-500 bg-emerald-500 text-white" : "border-accent text-accent"
              }`}
            >
              {hecho ? <Icon name="check" size={12} weight="bold" /> : i + 1}
            </button>
            <span className={hecho ? "text-muted line-through" : "text-ink"}>
              <TextoPaso texto={p} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type QrStatus = {
  qr_data_url?: string | null;
  listo?: boolean;
  sesion?: { conectado?: boolean; qr_data_url?: string | null; mensaje?: string };
  mensaje?: string;
};

/** QR del puente de WhatsApp (principal o supervisor), refrescado cada 5 s hasta vincular. */
function QrWhatsapp({ ruta, onVinculado }: { ruta: string; onVinculado: () => void }) {
  const q = useQuery<QrStatus>({
    queryKey: ["conexiones-qr", ruta],
    queryFn: () => api.get(ruta),
    refetchInterval: (query) => {
      const d = query.state.data;
      const conectado = d?.sesion ? d.sesion.conectado : d?.listo;
      return conectado ? false : 5000;
    },
  });
  const d = q.data;
  const conectado = d?.sesion ? d.sesion.conectado : d?.listo;
  const qr = d?.sesion ? d.sesion.qr_data_url : d?.qr_data_url;
  const mensaje = d?.sesion?.mensaje ?? d?.mensaje;
  if (conectado) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600">
        <Icon name="check" size={14} weight="bold" /> Vinculado.
        <button type="button" className="underline" onClick={onVinculado}>
          Actualizar estado
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      {qr ? (
        <img src={qr} alt="QR de WhatsApp" className="h-48 w-48 rounded-lg border border-border bg-white p-2" />
      ) : (
        <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
          {q.isLoading ? "Buscando QR…" : "Aún no hay QR"}
        </div>
      )}
      <p className="max-w-xs text-xs text-muted">{mensaje || "Esperando el QR del puente…"}</p>
    </div>
  );
}

function Tarjeta({
  c,
  abierta,
  onToggle,
  onProbar,
  probando,
}: {
  c: Conexion;
  abierta: boolean;
  onToggle: () => void;
  onProbar: () => void;
  probando: boolean;
}) {
  const est = ESTILO[c.estado ?? "alerta"];
  return (
    <div className={`rounded-xl border bg-surface-panel ${c.estado === "caido" ? "border-danger/40" : "border-border"}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
        className="flex cursor-pointer items-start gap-3 p-3"
      >
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${est.punto}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">{c.nombre}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${est.chip}`}>{est.texto}</span>
          </div>
          <p className="mt-0.5 break-words text-xs text-muted">{c.detalle || "Verificando…"}</p>
        </div>
        <span className="shrink-0 text-[10px] text-muted">{hora(c.verificado_en)}</span>
        <Icon name={abierta ? "collapse" : "expand"} size={14} className="mt-1 shrink-0 text-muted" />
      </div>

      {abierta && (
        <div className="space-y-4 border-t border-border px-3 pb-4 pt-3">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Si se cae, deja de funcionar</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink">
              {c.que_se_cae.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Cómo reconectar, paso a paso</p>
            <PasosGuiados pasos={c.pasos} />
          </div>

          {c.reconexion.tipo === "qr" && c.reconexion.qr_api && c.estado !== "ok" && (
            <QrWhatsapp ruta={c.reconexion.qr_api} onVinculado={onProbar} />
          )}
          {c.reconexion.tipo === "oauth_gmail" && (
            <Suspense fallback={<p className="text-xs text-muted">Cargando asistente…</p>}>
              <GmailOAuthPanel embebido />
            </Suspense>
          )}
          {c.reconexion.tipo === "oauth_meli" && (
            <Suspense fallback={<p className="text-xs text-muted">Cargando asistente…</p>}>
              <MeliOAuthPanel embebido />
            </Suspense>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onProbar}
              disabled={probando}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
            >
              <Icon name="refresh" size={13} /> {probando ? "Probando…" : "Probar de nuevo"}
            </button>
            {typeof c.ms === "number" && <span className="text-[10px] text-muted">respondió en {c.ms} ms</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** `embebido`: dentro de Ajustes y Sistema (donde el equipo lo busca), sin ancho propio. */
export default function ConexionesPanel({ embebido = false }: { embebido?: boolean } = {}) {
  const qc = useQueryClient();
  const [abiertas, setAbiertas] = useState<Set<string> | null>(null);
  const [probando, setProbando] = useState<string | null>(null);

  const q = useQuery<Respuesta>({
    queryKey: ["conexiones"],
    queryFn: () => api.get("/api/conexiones"),
    refetchInterval: 60_000,
  });

  async function probar(id?: string) {
    setProbando(id ?? "todas");
    try {
      const r = await api.get<Respuesta>(`/api/conexiones?forzar=1${id ? `&id=${id}` : ""}`);
      qc.setQueryData<Respuesta>(["conexiones"], (prev) => {
        if (!prev || !id) return r;
        const items = prev.items.map((x) => r.items.find((n) => n.id === x.id) ?? x);
        return { ...prev, items };
      });
    } finally {
      setProbando(null);
    }
  }

  const items = q.data?.items ?? [];
  // Lo caído primero y abierto de entrada: es lo que hay que atender.
  const abiertasEf = abiertas ?? new Set(items.filter((c) => c.estado === "caido").map((c) => c.id));
  const grupos = useMemo(() => {
    const m = new Map<string, Conexion[]>();
    for (const c of [...items].sort((a, b) => ORDEN[a.estado ?? "alerta"] - ORDEN[b.estado ?? "alerta"])) {
      m.set(c.grupo, [...(m.get(c.grupo) ?? []), c]);
    }
    return [...m.entries()].sort(
      (a, b) => Math.min(...a[1].map((c) => ORDEN[c.estado ?? "alerta"])) - Math.min(...b[1].map((c) => ORDEN[c.estado ?? "alerta"])),
    );
  }, [items]);
  // Resumen contado aquí: «Probar de nuevo» de una sola tarjeta no trae el resumen completo.
  const r = q.data
    ? items.reduce(
        (acc, c) => ({ ...acc, [c.estado ?? "alerta"]: acc[c.estado ?? "alerta"] + 1 }),
        { ok: 0, alerta: 0, caido: 0, sin_configurar: 0 } as Record<Estado, number>,
      )
    : null;

  return (
    <div className={embebido ? "space-y-4" : "mx-auto max-w-3xl space-y-4"}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper border border-border bg-surface-panel">
          <Icon name="link" size={20} weight="bold" className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold tracking-tight text-ink">Conexiones e integraciones</h1>
          <p className="text-xs text-muted">
            Cada integración se prueba de verdad contra su servicio. Abre una para ver qué se cae y cómo reconectarla.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void probar()}
          disabled={probando !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          <Icon name="refresh" size={14} /> {probando === "todas" ? "Probando…" : "Probar todo"}
        </button>
      </div>

      {r && (
        <div className="flex flex-wrap gap-2 text-xs">
          {(["caido", "alerta", "ok", "sin_configurar"] as Estado[])
            .filter((e) => r[e] > 0)
            .map((e) => (
              <span key={e} className={`rounded-full px-2.5 py-1 font-bold ${ESTILO[e].chip}`}>
                {r[e]} {ESTILO[e].texto.toLowerCase()}
              </span>
            ))}
        </div>
      )}

      {q.isLoading && <p className="text-xs text-muted">Probando cada conexión (unos segundos)…</p>}
      {q.isError && <p className="text-xs text-danger">{(q.error as Error).message || "No se pudo consultar."}</p>}

      {grupos.map(([grupo, lista]) => (
        <section key={grupo} className="space-y-2">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted">{grupo}</h2>
          {lista.map((c) => (
            <Tarjeta
              key={c.id}
              c={c}
              abierta={abiertasEf.has(c.id)}
              probando={probando === c.id || probando === "todas"}
              onProbar={() => void probar(c.id)}
              onToggle={() => {
                const n = new Set(abiertasEf);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                setAbiertas(n);
              }}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
