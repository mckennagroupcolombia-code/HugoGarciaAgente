/**
 * Declaraciones de retención que se preparan con el contador: el 350 de la DIAN
 * (retefuente + reteIVA, mensual) y el RTICA de Bogotá (ReteICA, bimestral).
 *
 * El borrador sale del Libro Mayor (cuentas 2365*, 2367 y 2368) y se revisa con
 * el contador ANTES de que lo presente: cada renglón con su detalle por tercero
 * y los asientos que lo soportan, las alertas de base/tarifa y la comparación
 * con lo que él declaró el período anterior. Los renglones que no salen del
 * libro (reteIVA que él identifique, retenciones en exceso, sanciones) se
 * ajustan a mano con nota obligatoria. Backend: app/services/declaraciones_impuestos.py.
 *
 * Una sola vista: la lista de formularios de estas fechas a la izquierda y el
 * borrador del elegido al lado. El perfil contador lo ve en solo lectura.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { esContador } from "../lib/contadorAccess";
import { useTicketsAuth } from "../stores/ticketsAuth";
import ContrasteContador from "./ContrasteContador";
import CruceFuentesFiscales from "./CruceFuentesFiscales";

type Formulario = "350" | "rtica" | "300";
type EstadoBorrador = "borrador" | "revisado" | "enviado_contador" | "presentado";

type Vencimiento = {
  conocido: boolean; fecha?: string; dias_restantes?: number; estado: string; motivo?: string;
};
type Presentado = {
  anio: number; periodo: number; numero_formulario?: string; fecha_presentacion?: string;
  renglones: Record<string, number>; total?: number;
} | null;
type Obligacion = {
  formulario: Formulario; periodo: string; nombre_periodo: string; titulo: string;
  estado: "vencido" | "pendiente" | "en_curso" | "presentado";
  estado_borrador?: EstadoBorrador; borrador_disponible: boolean; vencimiento?: Vencimiento;
  presentado_contador?: Presentado; pago_en_libro?: { id: number; fecha: string; valor: number } | null;
  nota?: string;
};
type Linea = {
  movimiento_id: number; fecha: string; asiento: string; descripcion: string; cuenta?: string;
  base: number; base_origen: "descripción" | "asiento" | "estimada"; retencion: number;
  tarifa_efectiva?: number | null; asumida_por_mckenna?: boolean;
};
type Tercero = {
  tercero_id: number | null; tercero: string; identificacion: string; persona: string;
  concepto?: string; tarifa_por_mil?: number | null; base: number; retencion: number; lineas: Linea[];
};
type Fila350 = {
  concepto: string; etiqueta: string;
  pj: { renglon_base: number; renglon_ret: number; base: number; retencion: number };
  pn: { renglon_base: number; renglon_ret: number; base: number; retencion: number };
};
type Ajuste = { valor: number; nota: string; por?: string; fecha?: string };
type Borrador = {
  formulario: "350" | "rtica"; periodo: string; nombre_periodo: string; titulo: string;
  desde: string; hasta: string;
  filas?: Fila350[]; terceros: Tercero[]; anulados_en_el_mes?: Tercero[];
  detalle_reteiva?: { movimiento_id: number; fecha: string; tercero: string; descripcion: string; valor: number }[];
  renglones: Record<string, number>; renglones_calculados: Record<string, number>;
  ajustes: Record<string, Ajuste>; ajustados: string[]; editables: string[];
  etiquetas_rtica?: [string, string][] | null;
  estado: EstadoBorrador; notas: string; numero_formulario: string; actualizado_por: string; updated_at?: string | null;
  alertas: { nivel: string; texto: string; movimiento_id?: number }[];
  vencimiento: Vencimiento; presentado_contador: Presentado; anterior_contador: Presentado;
  pago_en_libro: { id: number; fecha: string; valor: number } | null;
  total_a_pagar: number;
};

const PASOS: { id: EstadoBorrador; label: string; ayuda: string }[] = [
  { id: "borrador", label: "Borrador", ayuda: "Sale del libro; se revisan alertas y ajustes" },
  { id: "revisado", label: "Revisado", ayuda: "Cifras revisadas en McKenna" },
  { id: "enviado_contador", label: "Con el contador", ayuda: "Enviado a William para presentarlo" },
  { id: "presentado", label: "Presentado", ayuda: "Con número de formulario" },
];

const RENGLONES_350_TOTALES: [string, string][] = [
  ["129", "Menos retenciones practicadas en exceso o indebidas (períodos anteriores)"],
  ["130", "Total retenciones renta y complementario"],
  ["131", "ReteIVA — a responsables del impuesto sobre las ventas"],
  ["132", "ReteIVA — servicios a no residentes o no domiciliados"],
  ["133", "Menos reteIVA practicada en exceso o indebida"],
  ["134", "Total retenciones IVA"],
  ["136", "Total retenciones"],
  ["137", "Sanciones"],
  ["138", "Total retenciones más sanciones"],
];

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
}

function fechaCorta(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

const CHIP: Record<Obligacion["estado"], string> = {
  vencido: "bg-red-500/15 text-red-700 dark:text-red-300",
  pendiente: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  en_curso: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  presentado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const CHIP_LABEL: Record<Obligacion["estado"], string> = {
  vencido: "Vencido", pendiente: "Por presentar", en_curso: "En curso", presentado: "Presentado",
};

function textoVencimiento(v?: Vencimiento): string {
  if (!v) return "";
  if (!v.conocido) return "Fecha: confirmar con el contador";
  const d = v.dias_restantes ?? 0;
  const cuando = d < 0 ? `venció hace ${-d} día(s)` : d === 0 ? "vence hoy" : `faltan ${d} día(s)`;
  return `Vence ${fechaCorta(v.fecha)} · ${cuando}`;
}

type Modo = "preparar" | "contraste" | "cruce";

/** Dos caras de lo mismo, en la misma vista: lo que falta presentar y lo que ya presentó William. */
export default function DeclaracionesImpuestosTab() {
  const soloLecturaModo = esContador(useTicketsAuth((st) => st.user));
  const [modo, setModo] = useState<Modo>(() => {
    try { return (localStorage.getItem("mck.declaraciones.modo") as Modo) || "preparar"; } catch { return "preparar"; }
  });
  function elegir(m: Modo) {
    setModo(m);
    try { localStorage.setItem("mck.declaraciones.modo", m); } catch { /* sin almacenamiento */ }
  }
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist">
        {([["preparar", "Por preparar"], ["contraste", "Lo que declaró William"], ["cruce", "Cruce DIAN y banco"]] as [Modo, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={modo === id} onClick={() => elegir(id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-bold ${modo === id ? "bg-accent text-white" : "text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {modo === "preparar" && <PorPreparar />}
      {modo === "contraste" && <ContrasteContador />}
      {modo === "cruce" && <CruceFuentesFiscales soloLectura={soloLecturaModo} />}
    </div>
  );
}

function PorPreparar() {
  const soloLectura = esContador(useTicketsAuth((s) => s.user));
  const q = useQuery<{ obligaciones: Obligacion[] }>({
    queryKey: ["contabilidad-declaraciones"],
    queryFn: () => api.get("/api/contabilidad/declaraciones"),
  });
  const lista = q.data?.obligaciones ?? [];
  const [sel, setSel] = useState<{ formulario: Formulario; periodo: string } | null>(null);

  // Arranca en lo más urgente que tenga borrador (la lista ya viene ordenada así).
  useEffect(() => {
    if (!sel && lista.length) {
      const primero = lista.find((o) => o.borrador_disponible);
      if (primero) setSel({ formulario: primero.formulario, periodo: primero.periodo });
    }
  }, [lista, sel]);

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
      <section className="lm-card space-y-2 p-3">
        <h3 className="text-sm font-bold text-ink">Declaraciones de estas fechas</h3>
        <p className="text-xs text-muted">
          Borradores armados desde el Libro Mayor para revisar con el contador antes de presentar. La reteIVA va
          dentro del 350.
        </p>
        {q.isLoading && <p className="text-sm text-muted">Cargando…</p>}
        {q.error && <p className="text-sm text-red-500">{(q.error as Error).message}</p>}
        <ul className="space-y-1.5">
          {lista.map((o) => {
            const activo = sel?.formulario === o.formulario && sel?.periodo === o.periodo;
            return (
              <li key={`${o.formulario}-${o.periodo}`}>
                <div
                  role={o.borrador_disponible ? "button" : undefined}
                  tabIndex={o.borrador_disponible ? 0 : -1}
                  onClick={() => o.borrador_disponible && setSel({ formulario: o.formulario, periodo: o.periodo })}
                  onKeyDown={(e) => {
                    if (o.borrador_disponible && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setSel({ formulario: o.formulario, periodo: o.periodo });
                    }
                  }}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    activo ? "border-accent bg-accent/10" : "border-border hover:bg-surface-input"
                  } ${o.borrador_disponible ? "cursor-pointer" : "opacity-70"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink">{o.titulo}</span>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${CHIP[o.estado]}`}>
                      {CHIP_LABEL[o.estado]}
                    </span>
                  </div>
                  <p className="text-xs capitalize text-ink">{o.nombre_periodo}</p>
                  {o.estado !== "presentado" && o.vencimiento && (
                    <p className="text-[11px] text-muted">{textoVencimiento(o.vencimiento)}</p>
                  )}
                  {o.estado === "presentado" && (
                    <p className="text-[11px] text-muted">
                      {o.presentado_contador?.numero_formulario
                        ? `Form. ${o.presentado_contador.numero_formulario} · ${cop(o.presentado_contador.total)}`
                        : o.pago_en_libro ? `Pagado ${fechaCorta(o.pago_en_libro.fecha)} · ${cop(o.pago_en_libro.valor)}` : ""}
                    </p>
                  )}
                  {o.nota && <p className="text-[11px] text-muted">{o.nota}</p>}
                  {o.borrador_disponible && o.estado !== "presentado" && o.estado_borrador && o.estado_borrador !== "borrador" && (
                    <p className="text-[11px] font-bold text-accent">
                      {PASOS.find((p) => p.id === o.estado_borrador)?.label}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {sel ? (
        <BorradorVista key={`${sel.formulario}-${sel.periodo}`} formulario={sel.formulario} periodo={sel.periodo}
                       soloLectura={soloLectura} />
      ) : (
        !q.isLoading && <p className="text-sm text-muted">Elige una declaración.</p>
      )}
    </div>
  );
}

function BorradorVista({ formulario, periodo, soloLectura }: {
  formulario: Formulario; periodo: string; soloLectura: boolean;
}) {
  const qc = useQueryClient();
  const clave = ["contabilidad-declaracion", formulario, periodo];
  const q = useQuery<Borrador>({
    queryKey: clave,
    queryFn: () => api.get(`/api/contabilidad/declaraciones/${formulario}/${periodo}`),
  });
  const b = q.data;
  const [notas, setNotas] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<Borrador>(`/api/contabilidad/declaraciones/${formulario}/${periodo}`, body),
    onSuccess: (data) => {
      qc.setQueryData(clave, data);
      qc.invalidateQueries({ queryKey: ["contabilidad-declaraciones"] });
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });
  const enviar = useMutation({
    mutationFn: (body: { destinatario?: string; nota?: string }) =>
      api.post<{ ok: boolean; destinatario: string }>(`/api/contabilidad/declaraciones/${formulario}/${periodo}/enviar`, body),
    onSuccess: (r) => {
      setAviso(`Enviado a ${r.destinatario}.`);
      qc.invalidateQueries({ queryKey: clave });
      qc.invalidateQueries({ queryKey: ["contabilidad-declaraciones"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  async function descargarCsv() {
    const url = await fetchAuthBlobUrl(`/api/contabilidad/declaraciones/${formulario}/${periodo}/csv`);
    if (!url) { setError("No se pudo descargar el CSV."); return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = `borrador_${formulario}_${periodo}.csv`;
    a.click();
  }

  if (q.isLoading) return <p className="text-sm text-muted">Armando el borrador desde el libro…</p>;
  if (q.error || !b) return <p className="text-sm text-red-500">{(q.error as Error)?.message ?? "Sin datos"}</p>;

  const pasoActual = PASOS.findIndex((p) => p.id === b.estado);
  const notasVal = notas ?? b.notas;
  const numeroVal = numero ?? b.numero_formulario;

  return (
    <div className="min-w-0 space-y-3">
      {/* Cabecera: qué es, cuánto da y cuándo vence */}
      <section className="lm-card space-y-3 p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink">{b.titulo}</h3>
            <p className="text-sm capitalize text-muted">
              {b.nombre_periodo} · {fechaCorta(b.desde)} – {fechaCorta(b.hasta)}
            </p>
            <p className={`mt-1 text-xs ${b.vencimiento.estado === "vencido" ? "font-bold text-red-600" : "text-muted"}`}>
              {b.vencimiento.conocido ? textoVencimiento(b.vencimiento) : b.vencimiento.motivo}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Total a pagar (borrador)</p>
            <p className="font-mono text-2xl font-bold text-ink">{cop(b.total_a_pagar)}</p>
            {b.presentado_contador && (
              <p className="text-xs text-emerald-600">
                Presentado por el contador: {cop(b.presentado_contador.total)}
                {b.presentado_contador.fecha_presentacion && ` el ${fechaCorta(b.presentado_contador.fecha_presentacion)}`}
              </p>
            )}
            {!b.presentado_contador && b.pago_en_libro && (
              <p className="text-xs text-emerald-600">Pago registrado en el libro: {cop(b.pago_en_libro.valor)} el {fechaCorta(b.pago_en_libro.fecha)}</p>
            )}
          </div>
        </div>

        {/* Avance con el contador */}
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {PASOS.map((p, i) => {
            const hecho = i <= pasoActual;
            return (
              <li key={p.id}>
                <div
                  role={soloLectura ? undefined : "button"}
                  tabIndex={soloLectura ? -1 : 0}
                  title={p.ayuda}
                  onClick={() => !soloLectura && !guardar.isPending && guardar.mutate({ estado: p.id })}
                  onKeyDown={(e) => {
                    if (!soloLectura && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); guardar.mutate({ estado: p.id }); }
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs ${
                    hecho ? "border-accent bg-accent/10 text-ink" : "border-border text-muted"
                  } ${soloLectura ? "" : "cursor-pointer hover:bg-surface-input"}`}
                >
                  <span className="font-bold">{i + 1}. {p.label}</span>
                  <span className="block text-[10px] text-muted">{p.ayuda}</span>
                </div>
              </li>
            );
          })}
        </ol>
        {b.actualizado_por && b.updated_at && (
          <p className="text-[10px] text-muted">Último cambio: {b.actualizado_por} · {b.updated_at}</p>
        )}
      </section>

      {/* Alertas: lo que hay que hablar con el contador */}
      {b.alertas.length > 0 && (
        <section className="lm-card space-y-1.5 p-3">
          <h4 className="text-sm font-bold text-ink">Revisar antes de presentar ({b.alertas.length})</h4>
          {b.alertas.map((a, i) => (
            <p key={i} className={`rounded-md border-l-4 px-2 py-1 text-xs ${
              a.nivel === "alta" ? "border-red-500 bg-red-500/5 text-ink" : "border-amber-500 bg-amber-500/5 text-ink"
            }`}>{a.texto}</p>
          ))}
        </section>
      )}

      {b.formulario === "350" ? (
        <Renglones350 b={b} soloLectura={soloLectura} onAjustar={(ajustes) => guardar.mutate({ ajustes })} />
      ) : (
        <RenglonesRtica b={b} soloLectura={soloLectura} onAjustar={(ajustes) => guardar.mutate({ ajustes })} />
      )}

      <DetalleTerceros b={b} />

      {b.formulario === "350" && (b.detalle_reteiva?.length ?? 0) > 0 && (
        <section className="lm-card p-3">
          <h4 className="mb-1 text-sm font-bold text-ink">ReteIVA causada en el libro (2367)</h4>
          {b.detalle_reteiva!.map((d) => (
            <p key={`${d.movimiento_id}-${d.descripcion}`} className="text-xs text-muted">
              #{d.movimiento_id} · {d.fecha} · {d.tercero} — {d.descripcion}: <b className="text-ink">{cop(d.valor)}</b>
            </p>
          ))}
        </section>
      )}

      {/* Cierre: notas, número del formulario, CSV y correo */}
      <section className="lm-card space-y-2 p-3">
        <h4 className="text-sm font-bold text-ink">Notas para el contador</h4>
        <textarea
          value={notasVal}
          readOnly={soloLectura}
          onChange={(e) => setNotas(e.target.value)}
          rows={3}
          placeholder="Qué se habló, qué falta, qué confirmó él…"
          className="w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            N.º de formulario (cuando lo presente)
            <input
              value={numeroVal}
              readOnly={soloLectura}
              onChange={(e) => setNumero(e.target.value)}
              className="mt-0.5 block w-56 rounded-lg border border-border bg-surface-input px-2 py-1 font-mono text-sm text-ink"
            />
          </label>
          {!soloLectura && (
            <button type="button" disabled={guardar.isPending}
                    onClick={() => guardar.mutate({ notas: notasVal, numero_formulario: numeroVal })}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
              Guardar
            </button>
          )}
          <button type="button" onClick={descargarCsv}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-input">
            Descargar CSV
          </button>
          {!soloLectura && (
            <button type="button" disabled={enviar.isPending}
                    onClick={() => {
                      const dest = window.prompt(
                        "Correo del contador (vacío = el configurado en EMAIL_CONTADOR):", "") ?? null;
                      if (dest === null) return;
                      enviar.mutate({ destinatario: dest.trim(), nota: notasVal });
                    }}
                    className="rounded-lg border border-accent px-3 py-1.5 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-50">
              {enviar.isPending ? "Enviando…" : "Enviar al contador"}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {aviso && <p className="text-xs text-emerald-600">{aviso}</p>}
      </section>
    </div>
  );
}

/* ─── Renglones ─────────────────────────────────────────────────────────── */

function CeldaEditable({ renglon, b, soloLectura, onAjustar }: {
  renglon: string; b: Borrador; soloLectura: boolean;
  onAjustar: (a: Record<string, { valor: number; nota: string } | null>) => void;
}) {
  const valor = b.renglones[renglon] ?? 0;
  const ajuste = b.ajustes[renglon];
  const editable = !soloLectura && b.editables.includes(renglon);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-mono ${ajuste ? "text-accent" : "text-ink"}`} title={ajuste ? `Ajuste: ${ajuste.nota}` : undefined}>
        {cop(valor)}
      </span>
      {editable && (
        <button type="button" className="rounded border border-border px-1.5 text-[10px] text-muted hover:text-ink"
                onClick={() => {
                  const v = window.prompt(`Valor del renglón ${renglon} (vacío = quitar el ajuste):`, ajuste ? String(ajuste.valor) : "");
                  if (v === null) return;
                  if (!v.trim()) { onAjustar({ [renglon]: null }); return; }
                  const n = Number(v.replace(/[^\d-]/g, ""));
                  if (!Number.isFinite(n)) return;
                  const nota = window.prompt("¿Quién lo indicó y por qué? (obligatorio)", ajuste?.nota ?? "");
                  if (!nota?.trim()) return;
                  onAjustar({ [renglon]: { valor: n, nota: nota.trim() } });
                }}>
          {ajuste ? "editar" : "ajustar"}
        </button>
      )}
    </span>
  );
}

function Comparacion({ r, b }: { r: string; b: Borrador }) {
  const ant = b.anterior_contador?.renglones?.[r];
  const pres = b.presentado_contador?.renglones?.[r];
  return (
    <>
      <td className="py-1 pl-2 text-right font-mono text-xs text-muted">{ant ? cop(ant) : "—"}</td>
      {b.presentado_contador && <td className="py-1 pl-2 text-right font-mono text-xs text-emerald-600">{pres ? cop(pres) : "—"}</td>}
    </>
  );
}

function Renglones350({ b, soloLectura, onAjustar }: {
  b: Borrador; soloLectura: boolean;
  onAjustar: (a: Record<string, { valor: number; nota: string } | null>) => void;
}) {
  const [todos, setTodos] = useState(false);
  const filas = useMemo(
    () => (b.filas ?? []).filter((f) => todos || f.pj.retencion || f.pn.retencion || f.pj.base || f.pn.base),
    [b.filas, todos],
  );
  const R = (n: number) => cop(b.renglones[String(n)]);
  return (
    <section className="lm-card space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-ink">Retenciones a título de renta</h4>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Ver todos los conceptos
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted">
              <th className="py-1 pr-2">Concepto</th>
              <th className="py-1 pr-2 text-right">PJ · base</th>
              <th className="py-1 pr-2 text-right">PJ · retención</th>
              <th className="py-1 pr-2 text-right">PN · base</th>
              <th className="py-1 text-right">PN · retención</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.concepto} className="border-b border-border/40">
                <td className="py-1 pr-2 text-ink">{f.etiqueta}</td>
                <td className="py-1 pr-2 text-right font-mono"><span className="text-[10px] text-muted">{f.pj.renglon_base} </span>{R(f.pj.renglon_base)}</td>
                <td className="py-1 pr-2 text-right font-mono font-bold"><span className="text-[10px] font-normal text-muted">{f.pj.renglon_ret} </span>{R(f.pj.renglon_ret)}</td>
                <td className="py-1 pr-2 text-right font-mono"><span className="text-[10px] text-muted">{f.pn.renglon_base} </span>{R(f.pn.renglon_base)}</td>
                <td className="py-1 text-right font-mono font-bold"><span className="text-[10px] font-normal text-muted">{f.pn.renglon_ret} </span>{R(f.pn.renglon_ret)}</td>
              </tr>
            ))}
            {!filas.length && (
              <tr><td colSpan={5} className="py-3 text-center text-xs text-muted">Sin retenciones a título de renta en el período.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted">
              <th className="py-1 pr-2">Renglón</th>
              <th className="py-1 text-right">Borrador</th>
              <th className="py-1 pl-2 text-right">Contador, período anterior</th>
              {b.presentado_contador && <th className="py-1 pl-2 text-right">Presentado</th>}
            </tr>
          </thead>
          <tbody>
            {RENGLONES_350_TOTALES.map(([r, label]) => {
              const total = ["130", "134", "136", "138"].includes(r);
              return (
                <tr key={r} className={`border-b border-border/40 ${total ? "font-bold" : ""}`}>
                  <td className="py-1 pr-2 text-ink"><span className="font-mono text-[10px] text-muted">{r} </span>{label}</td>
                  <td className="py-1 text-right"><CeldaEditable renglon={r} b={b} soloLectura={soloLectura} onAjustar={onAjustar} /></td>
                  <Comparacion r={r} b={b} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {b.ajustados.length > 0 && (
        <div className="space-y-0.5">
          {b.ajustados.map((r) => (
            <p key={r} className="text-[11px] text-muted">
              Renglón {r} ajustado a mano ({cop(b.ajustes[r].valor)}, el libro da {cop(b.renglones_calculados[r])}):
              {" "}{b.ajustes[r].nota}{b.ajustes[r].por ? ` — ${b.ajustes[r].por}` : ""}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted">
        Valores del formulario redondeados al múltiplo de mil (Art. 577 E.T.); el detalle por tercero va al peso.
        PJ = persona jurídica, PN = persona natural.
      </p>
    </section>
  );
}

function RenglonesRtica({ b, soloLectura, onAjustar }: {
  b: Borrador; soloLectura: boolean;
  onAjustar: (a: Record<string, { valor: number; nota: string } | null>) => void;
}) {
  return (
    <section className="lm-card space-y-2 p-3">
      <h4 className="text-sm font-bold text-ink">Liquidación del bimestre</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted">
              <th className="py-1 pr-2">Casilla</th>
              <th className="py-1 text-right">Borrador</th>
              <th className="py-1 pl-2 text-right">Contador, bimestre anterior</th>
              {b.presentado_contador && <th className="py-1 pl-2 text-right">Presentado</th>}
            </tr>
          </thead>
          <tbody>
            {(b.etiquetas_rtica ?? []).map(([r, label]) => (
              <tr key={r} className={`border-b border-border/40 ${["BH", "HA"].includes(r) ? "font-bold" : ""}`}>
                <td className="py-1 pr-2 text-ink"><span className="font-mono text-[10px] text-muted">{r} </span>{label}</td>
                <td className="py-1 text-right"><CeldaEditable renglon={r} b={b} soloLectura={soloLectura} onAjustar={onAjustar} /></td>
                <Comparacion r={r} b={b} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        Sale de la cuenta 2368. Incluye el ReteICA que McKenna asume (honorarios del equipo): se declara igual.
      </p>
    </section>
  );
}

/* ─── Detalle por tercero ───────────────────────────────────────────────── */

const ORIGEN: Record<Linea["base_origen"], string> = {
  "descripción": "base anotada en el asiento",
  asiento: "base = costo/gasto del asiento",
  estimada: "base estimada (retención ÷ tarifa)",
};

function DetalleTerceros({ b }: { b: Borrador }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const llave = (t: Tercero) => `${t.tercero_id}-${t.concepto ?? t.tarifa_por_mil}-${t.persona}`;
  return (
    <section className="lm-card space-y-2 p-3">
      <h4 className="text-sm font-bold text-ink">Detalle por tercero ({b.terceros.length})</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted">
              <th className="py-1 pr-2">Tercero</th>
              <th className="py-1 pr-2">{b.formulario === "350" ? "Concepto" : "Tarifa"}</th>
              <th className="py-1 pr-2 text-right">Base</th>
              <th className="py-1 text-right">Retención</th>
            </tr>
          </thead>
          <tbody>
            {b.terceros.map((t) => {
              const k = llave(t);
              const abiertoT = abierto === k;
              return (
                <Fragment key={k}>
                  <tr className="cursor-pointer border-b border-border/40 hover:bg-surface-input"
                      onClick={() => setAbierto(abiertoT ? null : k)}>
                    <td className="py-1 pr-2 text-ink">
                      {abiertoT ? "▾" : "▸"} {t.tercero}
                      <span className="ml-1 text-[10px] text-muted">{t.identificacion} · {t.persona === "juridica" ? "PJ" : "PN"}</span>
                    </td>
                    <td className="py-1 pr-2 text-xs text-muted">
                      {b.formulario === "350" ? (t.concepto ?? "").replace(/_/g, " ") : `${t.tarifa_por_mil ?? "?"} ‰`}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{cop(t.base)}</td>
                    <td className="py-1 text-right font-mono font-bold">{cop(t.retencion)}</td>
                  </tr>
                  {abiertoT && (
                    <tr>
                      <td colSpan={4} className="bg-surface-input/50 px-3 py-2">
                        {t.lineas.map((l, i) => (
                          <p key={i} className="text-xs text-muted">
                            <span className="font-mono">#{l.movimiento_id}</span> · {l.fecha} · {l.descripcion || l.asiento}
                            {" — "}base {cop(l.base)} <i>({ORIGEN[l.base_origen]})</i> → <b className="text-ink">{cop(l.retencion)}</b>
                            {l.tarifa_efectiva != null && ` · ${l.tarifa_efectiva}%`}
                            {l.asumida_por_mckenna && " · asumida por McKenna"}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!b.terceros.length && (
              <tr><td colSpan={4} className="py-3 text-center text-xs text-muted">Sin retenciones causadas en el período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(b.anulados_en_el_mes?.length ?? 0) > 0 && (
        <p className="text-[11px] text-muted">
          No van al formulario porque se practicaron y se reversaron dentro del mismo período:{" "}
          {b.anulados_en_el_mes!.map((t) => t.tercero).join(", ")}.
        </p>
      )}
    </section>
  );
}
