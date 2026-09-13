import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { useAppStore } from "../stores/app";
import TerceroSelect from "./TerceroSelect";

/**
 * Solicitudes de pago con asiento contable automático.
 *
 * **Por qué existe.** Hasta sep-2026 los pagos se aprobaban como tickets de
 * texto libre ("APROBAR PAGO DE FACTORES") y el asiento dependía de que alguien
 * se acordara después. No se hacía: el Libro Mayor tenía las compras pero no los
 * pagos. Acá el asiento nace del acto de pagar.
 *
 * **El asiento se muestra ANTES de aprobar** — quien aprueba ve contra qué
 * cuenta va. Aprobar un monto sin ver el asiento es firmar a ciegas.
 */

type Categoria = {
  id: string; label: string; ayuda: string; icono: string;
  origen: string; requiere_tercero: boolean; elige_cuenta: boolean;
  con_productos?: boolean; requiere_factura?: boolean;
};

type Opcion = {
  id: number | string; label: string; identificacion?: string;
  monto_sugerido?: number; detalle?: string; tipo_servicio?: string;
};

type LineaAsiento = {
  cuenta_codigo: string; cuenta_nombre: string;
  debito: number; credito: number; descripcion: string;
};

type Previsualizacion = {
  categoria_label: string; concepto: string; fecha: string;
  monto: number; retencion: number; retencion_motivo: string; girado: number;
  tercero: { id: number; nombre: string } | null;
  medio_pago: string; lineas: LineaAsiento[]; cuadra: boolean;
  items?: Array<{ sku: string; nombre: string; cantidad: number; precio: number; subtotal: number; iva: number; total: number }>;
  total_items?: number; base_sin_iva?: number; iva_items?: number;
  // Solo en el recálculo de una solicitud guardada: avisa si el origen cambió.
  difiere_de_lo_guardado?: boolean; monto_guardado?: number;
};

type Solicitud = {
  id: number; categoria: string; categoria_label: string; icono: string;
  concepto: string; monto: number; retencion: number; girado: number;
  fecha: string; estado: string; referencia: string; notas: string;
  tercero: { id: number; nombre: string; identificacion: string } | null;
  movimiento_id: number | null; alegra_journal_id: string; ticket_id: number | null;
  items?: Array<{ sku: string; nombre: string; cantidad: number; precio: number; total?: number }>;
  factura_numero?: string; factura_nombre?: string; factura_archivo?: string;
  verificacion?: { fiel?: boolean; advertencias?: string[]; motivo_diferencia?: string; numero_documento?: string };
  es_plantilla?: number; frecuencia?: string; plantilla_id?: number | null;
  periodo?: string; origen_sistema?: string; origen_ref?: string;
};

type MedioPago = { id: number; nombre: string; cuenta_id: number; activo: number };

// Patrón de AstroKiller: cada estado con su etiqueta y color, y conjuntos que
// definen qué necesita atención y qué acciones caben.
const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "⏳ Esperando aprobación", cls: "bg-amber-500/15 text-amber-600" },
  aprobada: { label: "✅ Aprobada y contabilizada", cls: "bg-emerald-500/15 text-emerald-500" },
  pagada: { label: "✅ Pagada", cls: "bg-emerald-500/15 text-emerald-500" },
  rechazada: { label: "➖ Rechazada", cls: "bg-surface text-muted" },
  anulada: { label: "➖ Anulada", cls: "bg-surface text-muted" },
  borrador: { label: "📝 Borrador", cls: "bg-sky-500/15 text-sky-500" },
};
const NECESITA_ACCION = new Set(["pendiente"]);

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  }).format(n || 0);
}
const hoy = () => new Date().toISOString().slice(0, 10);

export default function PagosWizardPanel() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  // Llegada desde el Centro de Mando: abrir el wizard ya en la categoría pedida.
  const pagosBoot = useAppStore((s) => s.pagosBoot);
  const setPagosBoot = useAppStore((s) => s.setPagosBoot);
  const [catInicial, setCatInicial] = useState<string | null>(null);
  useEffect(() => {
    if (!pagosBoot?.abrir) return;
    setCatInicial(pagosBoot.categoria ?? null);
    setAbierto(true);
    setPagosBoot(null);
  }, [pagosBoot, setPagosBoot]);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<string>("");

  const listaQ = useQuery<{ solicitudes: Solicitud[]; resumen: { pendientes: { n: number; total: number }; aprobadas: { n: number; total: number } } }>({
    queryKey: ["pagos-solicitudes", filtro],
    queryFn: () => api.get(`/api/pagos/solicitudes${filtro ? `?estado=${filtro}` : ""}`),
  });

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  const solicitudes = listaQ.data?.solicitudes ?? [];
  const r = listaQ.data?.resumen;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Solicitudes de pago</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Cada pago aprobado genera su asiento en el Libro Mayor y su comprobante en Alegra.
            Un pago a proveedor se arma solo aquí: proveedor del listado, productos con su SKU y la
            factura o cotización cotejada antes de enviarla al aprobador.
          </p>
        </div>
        <button
          type="button" onClick={() => setAbierto((v) => !v)}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white hover:bg-accent-hover"
        >
          {abierto ? "Cancelar" : "+ Registrar un pago"}
        </button>
      </header>

      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs font-bold ${
          msg.tipo === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
        }`}>{msg.texto}</p>
      )}

      {r && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Kpi label="Esperando aprobación" valor={cop(r.pendientes.total)}
               sub={`${r.pendientes.n} solicitud(es)`} alerta={r.pendientes.n > 0} />
          <Kpi label="Aprobadas y contabilizadas" valor={cop(r.aprobadas.total)}
               sub={`${r.aprobadas.n} solicitud(es)`} />
        </div>
      )}

      {abierto && (
        <Wizard
          categoriaInicial={catInicial}
          onCerrar={() => { setAbierto(false); setCatInicial(null); }}
          onCreada={(texto) => {
            setMsg({ tipo: "ok", texto });
            setAbierto(false);
            void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
          }}
          onError={(texto) => setMsg({ tipo: "error", texto })}
        />
      )}

      <div className="flex gap-1 text-[11px]">
        {[["", "Todas"], ["borrador", "Borradores"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"], ["plantilla", "Recurrentes"]].map(([v, l]) => (
          <button
            key={v} type="button" onClick={() => setFiltro(v)}
            className={`rounded-lg px-2.5 py-1 font-bold ${filtro === v ? "bg-accent text-white" : "bg-surface text-muted"}`}
          >{l}</button>
        ))}
      </div>

      {filtro === "plantilla" ? (
        <ListaPlantillas onMensaje={setMsg} />
      ) : (
        <>
          {listaQ.isLoading && <p className="text-xs text-muted">Cargando…</p>}
          {!listaQ.isLoading && !solicitudes.length && (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
              No hay solicitudes {filtro ? `en estado «${filtro}»` : "todavía"}.
            </p>
          )}

          <div className="space-y-2">
            {solicitudes.map((s) => (
              <FichaSolicitud key={s.id} s={s} onMensaje={setMsg} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── El wizard ─────────────────────────────────────────────────────────────
//
// Dos recorridos según la categoría:
//   · Proveedor con productos (compra_proveedor / factura_proveedor): 5 pasos —
//     ¿qué se paga? → proveedor (libro + Alegra) → productos con SKU (catálogo
//     Alegra) → factura o cotización cotejada → asiento y envío.
//   · Cualquier otra categoría: los 3 pasos de siempre.
//
// Regla (sep-2026): un pago a proveedor no existe fuera de acá. El Centro de
// Mando redirige aquí y el backend rechaza la solicitud de texto libre.

type ItemLinea = { sku: string; nombre: string; cantidad: string; precio: string; iva_pct: string; unidad?: string };
type Proveedor = {
  id: number | null; nombre: string; identificacion: string; saldo_2205: number;
  en_libro: boolean; alegra_id: string | null; regimen_simple?: number; tipo_persona?: string;
};
type ProductoCat = { sku: string; nombre: string; costo_unitario: number; unidad: string; tipo: string };
type CotejoItem = { sku: string; nombre: string; encontrado: boolean; por?: string; cantidad_ok: boolean; precio_ok: boolean };
type Verificacion = {
  fiel: boolean; legible: boolean; origen: string; advertencias: string[]; numero_documento: string;
  fecha_documento?: string; nit_ok: boolean | null; total_ok: boolean; total_detectado: number | null;
  proveedor_documento?: string; items: CotejoItem[]; archivo_tmp: string; archivo_nombre: string;
};

const PASOS_PRODUCTOS = ["¿Qué se paga?", "Proveedor", "Productos", "Factura", "Revisar y enviar"];
const PASOS_SIMPLE = ["¿Qué se paga?", "Detalles", "Revisar el asiento"];

function num(s: string): number {
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function totalesItems(items: ItemLinea[]) {
  let subtotal = 0, iva = 0;
  for (const it of items) {
    const st = num(it.cantidad) * num(it.precio);
    subtotal += st;
    iva += st * (num(it.iva_pct) / 100);
  }
  return { subtotal: Math.round(subtotal * 100) / 100, iva: Math.round(iva * 100) / 100, total: Math.round((subtotal + iva) * 100) / 100 };
}

function Wizard({
  onCerrar, onCreada, onError, categoriaInicial,
}: {
  onCerrar: () => void;
  onCreada: (texto: string) => void;
  onError: (texto: string) => void;
  categoriaInicial?: string | null;
}) {
  const [paso, setPaso] = useState(1);
  const [cat, setCat] = useState<Categoria | null>(null);
  const [f, setF] = useState({
    monto: "", concepto: "", fecha: hoy(), tercero_id: "",
    medio_pago_id: "", cuenta_debito: "", tipo_servicio: "",
    referencia: "", origen_ref: "", notas: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [items, setItems] = useState<ItemLinea[]>([]);
  const [verif, setVerif] = useState<Verificacion | null>(null);
  const [motivoDif, setMotivoDif] = useState("");

  const catsQ = useQuery<{ categorias: Categoria[] }>({
    queryKey: ["pagos-categorias"],
    queryFn: () => api.get("/api/pagos/categorias"),
  });
  const conProductos = Boolean(cat?.con_productos);
  const pasos = conProductos ? PASOS_PRODUCTOS : PASOS_SIMPLE;

  // Llegada desde el Centro de Mando («Solicitud de pago a proveedor»): categoría ya elegida.
  useEffect(() => {
    if (!categoriaInicial || cat || !catsQ.data) return;
    const c = catsQ.data.categorias.find((x) => x.id === categoriaInicial);
    if (c) { setCat(c); setPaso(2); }
  }, [categoriaInicial, cat, catsQ.data]);

  const opcionesQ = useQuery<{ tipo: string; opciones: Opcion[] }>({
    queryKey: ["pagos-opciones", cat?.id],
    queryFn: () => api.get(`/api/pagos/opciones/${cat!.id}`),
    enabled: !!cat && cat.origen !== "libre" && !conProductos,
  });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
  const puedeQ = useQuery<{ puede: boolean; usuario: string }>({
    queryKey: ["pagos-puedo-registrar"],
    queryFn: () => api.get("/api/pagos/puedo-registrar"),
  });
  const puedeDirecto = Boolean(puedeQ.data?.puede);
  const cuentasQ = useQuery<{ cuentas: Array<{ codigo: string; nombre: string; tipo: string }> }>({
    queryKey: ["cc-plan-cuentas"],
    queryFn: () => api.get("/api/contabilidad/cc/plan-cuentas"),
    enabled: !!cat?.elige_cuenta,
  });
  const medios = (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo);

  const tot = useMemo(() => totalesItems(items), [items]);
  const itemsCuerpo = useMemo(() => items.map((it) => ({
    sku: it.sku, nombre: it.nombre, cantidad: num(it.cantidad), precio: num(it.precio),
    iva_pct: num(it.iva_pct), unidad: it.unidad || "",
  })), [items]);

  // Previsualización en vivo: el asiento se ve mientras se llena el formulario.
  const cuerpo = useMemo(() => ({
    categoria: cat?.id,
    monto: conProductos ? tot.total : (parseFloat(f.monto.replace(",", ".")) || 0),
    concepto: f.concepto, fecha: f.fecha,
    tercero_id: f.tercero_id ? Number(f.tercero_id) : null,
    medio_pago_id: f.medio_pago_id ? Number(f.medio_pago_id) : null,
    cuenta_debito: f.cuenta_debito, tipo_servicio: f.tipo_servicio,
    items: conProductos ? itemsCuerpo : undefined,
  }), [cat, f, conProductos, tot.total, itemsCuerpo]);

  const pasoFinal = pasos.length;
  const prevQ = useQuery<Previsualizacion>({
    queryKey: ["pagos-previsualizar", cuerpo],
    queryFn: () => api.post("/api/pagos/previsualizar", cuerpo),
    enabled: paso === pasoFinal && !!cat && cuerpo.monto > 0,
    retry: false,
  });

  const extra = () => ({
    ...cuerpo, referencia: f.referencia || verif?.numero_documento || "", origen_ref: f.origen_ref, notas: f.notas,
    archivo_tmp: verif?.archivo_tmp, archivo_nombre: verif?.archivo_nombre,
    verificacion: verif ? { ...verif, archivo_tmp: undefined } : undefined,
    verificacion_motivo: motivoDif, factura_numero: verif?.numero_documento || "",
  });

  const crearMut = useMutation({
    mutationFn: () => api.post<Solicitud & { error?: string }>("/api/pagos/solicitudes", extra()),
    onSuccess: (s) => {
      if (s.error) return onError(s.error);
      onCreada(`Solicitud #${s.id} creada — ${cop(s.monto)}. Ya le llegó el ticket al aprobador.`);
    },
    onError: (e) => onError((e as Error).message),
  });

  // Pago que se repite (quincena, arriendo, contador): se guarda una vez y de
  // ahí en adelante el cron monta el borrador de cada período. No es un pago:
  // por eso no abre ticket ni se puede aprobar.
  const [frecuencia, setFrecuencia] = useState("");
  const plantillaMut = useMutation({
    mutationFn: () => api.post<Solicitud & { error?: string }>("/api/pagos/solicitudes", {
      ...extra(), es_plantilla: true, frecuencia,
    }),
    onSuccess: (s) => {
      if (s.error) return onError(s.error);
      onCreada(
        `Plantilla «${s.concepto}» guardada (${frecuencia}). ` +
        "Cada período se montará sola como borrador; nada se gira sin que la revises.",
      );
    },
    onError: (e) => onError((e as Error).message),
  });

  const directoMut = useMutation({
    mutationFn: () => api.post<Solicitud & { error?: string; alegra?: { status: string; message?: string } }>(
      "/api/pagos/registrar", extra(),
    ),
    onSuccess: (s2) => {
      if (s2.error) return onError(s2.error);
      const al = s2.alegra?.status;
      onCreada(
        `Pago #${s2.id} registrado y contabilizado — ${cop(s2.monto)}.` + (
          al === "success" ? " Espejado en Alegra."
            : al === "bloqueado" ? " En Alegra quedó pendiente: falta el tipo de comprobante."
            : al === "error" ? ` Alegra falló (${s2.alegra?.message ?? ""}) — el asiento interno sí quedó.`
            : ""),
      );
    },
    onError: (e) => onError((e as Error).message),
  });

  const cats = catsQ.data?.categorias ?? [];
  const ops = opcionesQ.data?.opciones ?? [];
  const datosPagoOk = !!f.medio_pago_id && !!f.fecha;
  const facturaOk = !cat?.requiere_factura || (!!verif && (verif.fiel || motivoDif.trim().length > 3));

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-surface-panel p-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {pasos.map((label, i) => {
            const n = i + 1;
            return (
              <div key={label} className="flex items-center gap-1">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  paso === n ? "bg-accent text-white" : paso > n ? "bg-emerald-500/20 text-emerald-500" : "bg-surface text-muted"
                }`}>{paso > n ? "✓" : n}</div>
                <span className={`hidden text-[11px] sm:inline ${paso === n ? "font-bold text-ink" : "text-muted"}`}>{label}</span>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={onCerrar} className="text-xs text-muted">✕</button>
      </div>

      {/* PASO 1 — categoría */}
      {paso === 1 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c) => (
            <button
              key={c.id} type="button"
              onClick={() => { setCat(c); setPaso(2); setItems([]); setVerif(null); setProveedor(null); }}
              className={`rounded-lg border p-3 text-left hover:border-accent ${c.con_productos ? "border-accent/50 bg-accent/5" : "border-border"}`}
            >
              <p className="text-sm font-bold text-ink">{c.icono} {c.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted">{c.ayuda}</p>
              {c.con_productos && <p className="mt-1 text-[10px] font-bold text-accent">Proveedor · productos con SKU · factura cotejada</p>}
            </button>
          ))}
        </div>
      )}

      {/* ── Recorrido con productos ── */}
      {conProductos && cat && paso === 2 && (
        <PasoProveedor
          cat={cat} proveedor={proveedor}
          onElegir={(p) => { setProveedor(p); set("tercero_id", p.id ? String(p.id) : ""); if (!f.concepto) set("concepto", `Compra a ${p.nombre}`); }}
          f={f} set={set} medios={medios}
          onAtras={() => setPaso(1)}
          onSiguiente={() => setPaso(3)}
          puedeSeguir={!!f.tercero_id && datosPagoOk}
        />
      )}
      {conProductos && cat && paso === 3 && (
        <PasoProductos
          items={items} setItems={(v) => { setItems(v); setVerif(null); }} tot={tot}
          onAtras={() => setPaso(2)} onSiguiente={() => setPaso(4)}
        />
      )}
      {conProductos && cat && paso === 4 && (
        <PasoFactura
          items={itemsCuerpo} monto={tot.total} terceroId={f.tercero_id} verif={verif} setVerif={setVerif}
          motivo={motivoDif} setMotivo={setMotivoDif} requiere={Boolean(cat.requiere_factura)}
          onAtras={() => setPaso(3)} onSiguiente={() => setPaso(5)} puedeSeguir={facturaOk}
        />
      )}

      {/* ── Recorrido simple: PASO 2 detalles ── */}
      {!conProductos && paso === 2 && cat && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-accent">{cat.icono} {cat.label}</p>

          {cat.origen !== "libre" && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase text-muted">
                {opcionesQ.isLoading ? "Cargando pendientes…" : ops.length ? "Elige qué pagar" : "No hay pendientes en esta categoría"}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ops.map((o) => (
                  <button
                    key={String(o.id)} type="button"
                    onClick={() => {
                      if (typeof o.id === "number" && cat.requiere_tercero) set("tercero_id", String(o.id));
                      if (o.monto_sugerido) set("monto", String(Math.round(o.monto_sugerido)));
                      if (o.tipo_servicio) set("tipo_servicio", o.tipo_servicio);
                      if (!f.concepto) set("concepto", o.label);
                      set("origen_ref", String(o.id));
                    }}
                    className={`rounded-lg border p-2 text-left text-[11px] ${
                      f.origen_ref === String(o.id) ? "border-accent bg-accent/10" : "border-border hover:border-accent"
                    }`}
                  >
                    <p className="font-bold text-ink">{o.label}</p>
                    <p className="text-[10px] text-muted">{o.detalle}</p>
                    {o.monto_sugerido ? (
                      <p className="mt-0.5 font-bold tabular-nums text-accent">{cop(o.monto_sugerido)}</p>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo label="Monto a pagar">
              <input type="number" min="0" step="1000" required value={f.monto}
                     onChange={(e) => set("monto", e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Fecha">
              <input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="De qué cuenta sale">
              <select value={f.medio_pago_id} onChange={(e) => set("medio_pago_id", e.target.value)} className={inputCls}>
                <option value="">Selecciona…</option>
                {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Referencia (opcional)">
              <input value={f.referencia} onChange={(e) => set("referencia", e.target.value)}
                     placeholder="N° de factura o transferencia" className={inputCls} />
            </Campo>
          </div>

          <Campo label="Concepto">
            <input value={f.concepto} onChange={(e) => set("concepto", e.target.value)}
                   placeholder="Qué se está pagando" className={inputCls} />
          </Campo>

          {cat.requiere_tercero && cat.origen === "libre" && (
            <TerceroSelect label="¿A quién se le paga?" value={f.tercero_id}
                           onChange={(id) => set("tercero_id", id)} />
          )}

          {cat.elige_cuenta && (
            <Campo label="Cuenta contable del gasto">
              <select value={f.cuenta_debito} onChange={(e) => set("cuenta_debito", e.target.value)} className={inputCls}>
                <option value="">Selecciona…</option>
                {(cuentasQ.data?.cuentas ?? [])
                  .filter((c) => c.tipo === "gasto" || c.tipo === "costo")
                  .map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </Campo>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setPaso(1)}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Atrás</button>
            <button type="button" onClick={() => setPaso(3)}
                    disabled={!f.monto || !f.medio_pago_id}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
              Ver el asiento →
            </button>
          </div>
        </div>
      )}

      {/* PASO FINAL — revisar el asiento y enviar */}
      {paso === pasoFinal && cat && (
        <div className="space-y-3">
          {conProductos && (
            <ResumenPedido proveedor={proveedor} items={items} tot={tot} verif={verif} motivo={motivoDif} />
          )}
          {prevQ.isLoading && <p className="text-xs text-muted">Armando el asiento…</p>}
          {prevQ.error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">
              {(prevQ.error as Error).message}
            </p>
          )}
          {prevQ.data && <AsientoPreview p={prevQ.data} />}
          <Campo label="Notas para el aprobador (opcional)">
            <input value={f.notas} onChange={(e) => set("notas", e.target.value)} className={inputCls}
                   placeholder="Urgencia, condiciones de pago, a quién se le confirmó…" />
          </Campo>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPaso(pasoFinal - 1)}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Corregir</button>
            <button type="button" onClick={() => crearMut.mutate()}
                    disabled={!prevQ.data?.cuadra || crearMut.isPending || directoMut.isPending || !facturaOk}
                    className="rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent disabled:opacity-40">
              {crearMut.isPending ? "Enviando…" : "Enviar a aprobación"}
            </button>
            {puedeDirecto && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(
                    `Registrar y contabilizar ${cop(prevQ.data?.monto ?? 0)} de una vez, sin pasar por aprobación.\n\n` +
                    "Queda anotado que lo registraste tú. ¿Continuar?",
                  )) return;
                  directoMut.mutate();
                }}
                disabled={!prevQ.data?.cuadra || directoMut.isPending || crearMut.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {directoMut.isPending ? "Registrando…" : "Registrar y contabilizar ya"}
              </button>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-muted">
            Al enviar, el aprobador recibe el ticket con los productos, el cotejo de la factura y el asiento.
            {puedeDirecto && ` Como ${puedeQ.data?.usuario || "administrador"} también puedes registrarlo directo; queda anotado quién lo hizo.`}
          </p>

          <div className="rounded-lg border border-dashed border-border p-2">
            <p className="text-[11px] font-bold text-ink">¿Este pago se repite?</p>
            <p className="mb-2 text-[10px] leading-relaxed text-muted">
              Guárdalo como recurrente y cada período se montará solo como borrador, con
              estos mismos datos. Sigue pasando por tu revisión y por aprobación: lo que se
              ahorra es volver a teclearlo, no el control.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Campo label="Cada cuánto">
                <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} className={inputCls}>
                  <option value="">No se repite</option>
                  <option value="quincenal">Quincenal</option>
                  <option value="mensual">Mensual</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                </select>
              </Campo>
              <button type="button" onClick={() => plantillaMut.mutate()}
                      disabled={!frecuencia || !prevQ.data?.cuadra || plantillaMut.isPending}
                      className="rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-ink hover:border-accent disabled:opacity-40">
                {plantillaMut.isPending ? "Guardando…" : "Guardar como recurrente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Paso: proveedor (terceros del libro + contactos Alegra) ───────────────

function PasoProveedor({
  cat, proveedor, onElegir, f, set, medios, onAtras, onSiguiente, puedeSeguir,
}: {
  cat: Categoria; proveedor: Proveedor | null; onElegir: (p: Proveedor) => void;
  f: { fecha: string; medio_pago_id: string; concepto: string; referencia: string };
  set: (k: "fecha" | "medio_pago_id" | "concepto" | "referencia", v: string) => void;
  medios: MedioPago[]; onAtras: () => void; onSiguiente: () => void; puedeSeguir: boolean;
}) {
  const [q, setQ] = useState("");
  const [adoptando, setAdoptando] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const provQ = useQuery<{ proveedores: Proveedor[] }>({
    queryKey: ["pagos-proveedores", q],
    queryFn: () => api.get(`/api/pagos/proveedores?q=${encodeURIComponent(q)}`),
  });
  const lista = provQ.data?.proveedores ?? [];

  async function elegir(p: Proveedor) {
    setErr("");
    if (p.en_libro && p.id) return onElegir(p);
    // Contacto de Alegra que aún no es tercero: se adopta al Libro Mayor al elegirlo.
    setAdoptando(p.alegra_id);
    try {
      const r = await api.post<{ tercero?: { id: number; nombre: string; identificacion: string }; error?: string }>(
        "/api/pagos/proveedores/adoptar", { alegra_id: p.alegra_id },
      );
      if (r.error || !r.tercero) throw new Error(r.error || "No se pudo adoptar el contacto");
      onElegir({ ...p, id: r.tercero.id, en_libro: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdoptando(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-accent">{cat.icono} {cat.label} · ¿A qué proveedor?</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o NIT…" className={inputCls} autoFocus />
      {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">{err}</p>}
      <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {provQ.isLoading && <p className="text-xs text-muted">Buscando…</p>}
        {lista.map((p) => {
          const activo = proveedor && ((p.id && proveedor.id === p.id) || (p.alegra_id && proveedor.alegra_id === p.alegra_id));
          return (
            <button key={p.id ?? `a${p.alegra_id}`} type="button" onClick={() => void elegir(p)} disabled={adoptando !== null}
              className={`rounded-lg border p-2 text-left text-[11px] ${activo ? "border-accent bg-accent/10" : "border-border hover:border-accent"}`}>
              <p className="font-bold text-ink">{p.nombre}</p>
              <p className="text-[10px] text-muted">
                {p.identificacion || "sin identificación"}
                {p.en_libro ? " · en el Libro Mayor" : " · contacto Alegra (se adopta al elegir)"}
                {p.regimen_simple ? " · Régimen SIMPLE, sin retención" : ""}
              </p>
              {p.saldo_2205 ? <p className="mt-0.5 font-bold tabular-nums text-amber-600">debe {cop(p.saldo_2205)}</p> : null}
              {adoptando === p.alegra_id && <p className="text-[10px] text-accent">Adoptando…</p>}
            </button>
          );
        })}
        {!provQ.isLoading && !lista.length && <p className="text-xs text-muted">Nada con ese nombre. Créalo en Libro Mayor → Terceros o en Alegra.</p>}
      </div>

      <p className="text-[10px] font-bold uppercase text-muted">Datos del pago</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Fecha">
          <input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="De qué cuenta sale">
          <select value={f.medio_pago_id} onChange={(e) => set("medio_pago_id", e.target.value)} className={inputCls}>
            <option value="">Selecciona…</option>
            {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Concepto">
          <input value={f.concepto} onChange={(e) => set("concepto", e.target.value)} placeholder="Qué se compra" className={inputCls} />
        </Campo>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onAtras} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Atrás</button>
        <button type="button" onClick={onSiguiente} disabled={!puedeSeguir}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          Productos →
        </button>
      </div>
    </div>
  );
}

// ─── Paso: productos con SKU del catálogo Alegra ───────────────────────────

function PasoProductos({
  items, setItems, tot, onAtras, onSiguiente,
}: {
  items: ItemLinea[]; setItems: (v: ItemLinea[]) => void; tot: { subtotal: number; iva: number; total: number };
  onAtras: () => void; onSiguiente: () => void;
}) {
  const [q, setQ] = useState("");
  const prodQ = useQuery<{ productos: ProductoCat[] }>({
    queryKey: ["pagos-productos", q],
    queryFn: () => api.get(`/api/pagos/productos?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const resultados = prodQ.data?.productos ?? [];

  function agregar(p: ProductoCat) {
    if (items.some((it) => it.sku === p.sku)) return;
    setItems([...items, {
      sku: p.sku, nombre: p.nombre, cantidad: "1",
      precio: p.costo_unitario ? String(p.costo_unitario) : "", iva_pct: "19", unidad: p.unidad,
    }]);
    setQ("");
  }
  function editar(i: number, k: keyof ItemLinea, v: string) {
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  }
  const listo = items.length > 0 && items.every((it) => num(it.cantidad) > 0 && num(it.precio) > 0 && it.sku);

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-accent">¿Qué productos se compran? (SKU del catálogo Alegra)</p>
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por SKU o nombre…" className={inputCls} autoFocus />
        {q.trim().length >= 2 && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-lg">
            {prodQ.isLoading && <p className="px-3 py-2 text-xs text-muted">Buscando…</p>}
            {resultados.map((p) => (
              <button key={p.sku} type="button" onClick={() => agregar(p)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/10">
                <span><span className="font-mono text-accent">{p.sku}</span> <span className="text-ink">{p.nombre}</span></span>
                <span className="text-[10px] text-muted">{p.costo_unitario ? `costo ${cop(p.costo_unitario)}` : ""}</span>
              </button>
            ))}
            {!prodQ.isLoading && !resultados.length && (
              <p className="px-3 py-2 text-xs text-muted">Sin resultados en el catálogo Alegra. Si es un producto nuevo, créalo primero en Catálogo Alegra.</p>
            )}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-[11px]">
            <thead className="bg-surface text-[10px] uppercase text-muted">
              <tr>
                <th className="px-2 py-1.5">SKU</th><th className="px-2 py-1.5">Producto</th>
                <th className="px-2 py-1.5 text-right">Cant.</th><th className="px-2 py-1.5 text-right">Precio sin IVA</th>
                <th className="px-2 py-1.5 text-right">IVA %</th><th className="px-2 py-1.5 text-right">Subtotal</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.sku + i} className="border-t border-border/40">
                  <td className="px-2 py-1 font-mono text-accent">{it.sku}</td>
                  <td className="px-2 py-1 text-ink">{it.nombre}{it.unidad ? <span className="text-muted"> · {it.unidad}</span> : null}</td>
                  <td className="px-2 py-1 text-right"><input type="number" min="0" step="1" value={it.cantidad} onChange={(e) => editar(i, "cantidad", e.target.value)} className="w-20 rounded border border-border bg-surface-input px-1 py-0.5 text-right" /></td>
                  <td className="px-2 py-1 text-right"><input type="number" min="0" step="1" value={it.precio} onChange={(e) => editar(i, "precio", e.target.value)} className="w-28 rounded border border-border bg-surface-input px-1 py-0.5 text-right" /></td>
                  <td className="px-2 py-1 text-right">
                    <select value={it.iva_pct} onChange={(e) => editar(i, "iva_pct", e.target.value)} className="rounded border border-border bg-surface-input px-1 py-0.5">
                      <option value="19">19</option><option value="5">5</option><option value="0">0</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{cop(num(it.cantidad) * num(it.precio))}</td>
                  <td className="px-2 py-1"><button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-muted hover:text-red-500">✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-[11px]">
              <tr className="border-t border-border"><td colSpan={5} className="px-2 py-1 text-right text-muted">Subtotal</td><td className="px-2 py-1 text-right tabular-nums">{cop(tot.subtotal)}</td><td /></tr>
              <tr><td colSpan={5} className="px-2 py-1 text-right text-muted">IVA</td><td className="px-2 py-1 text-right tabular-nums">{cop(tot.iva)}</td><td /></tr>
              <tr className="font-bold"><td colSpan={5} className="px-2 py-1 text-right">Total a pagar</td><td className="px-2 py-1 text-right tabular-nums text-ink">{cop(tot.total)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      )}
      {!items.length && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">Busca y agrega los productos de la compra. Cada línea lleva su SKU.</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onAtras} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Atrás</button>
        <button type="button" onClick={onSiguiente} disabled={!listo}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          Cotejar la factura →
        </button>
      </div>
    </div>
  );
}

// ─── Paso: factura o cotización del proveedor, cotejada contra lo pedido ───

function PasoFactura({
  items, monto, terceroId, verif, setVerif, motivo, setMotivo, requiere, onAtras, onSiguiente, puedeSeguir,
}: {
  items: Array<Record<string, unknown>>; monto: number; terceroId: string;
  verif: Verificacion | null; setVerif: (v: Verificacion | null) => void;
  motivo: string; setMotivo: (v: string) => void; requiere: boolean;
  onAtras: () => void; onSiguiente: () => void; puedeSeguir: boolean;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const cotejar = useMutation({
    mutationFn: async () => {
      if (!archivo) throw new Error("Adjunta la factura o cotización");
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("items", JSON.stringify(items));
      fd.append("monto", String(monto));
      if (terceroId) fd.append("tercero_id", terceroId);
      return api.upload<Verificacion & { error?: string }>("/api/pagos/verificar-factura", fd, { timeoutMs: 90_000 });
    },
    onSuccess: (r) => { if (r.error) { setErr(r.error); setVerif(null); } else { setErr(""); setVerif(r); } },
    onError: (e) => setErr((e as Error).message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-accent">¿La factura o cotización dice lo mismo que pediste?</p>
      <p className="text-[11px] text-muted">
        Adjunta el PDF, el XML de la DIAN o el ZIP que manda el proveedor. Se coteja NIT, número, total ({cop(monto)}) y cada
        producto. No usa inteligencia artificial: si el archivo es una foto sin texto, lo dirá.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".pdf,.xml,.zip" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setVerif(null); }}
               className="text-xs text-ink" />
        <button type="button" onClick={() => cotejar.mutate()} disabled={!archivo || cotejar.isPending}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
          {cotejar.isPending ? "Cotejando…" : "Cotejar"}
        </button>
      </div>
      {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500">{err}</p>}

      {verif && (
        <div className={`space-y-2 rounded-xl border p-3 ${verif.fiel ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
          <p className={`text-sm font-bold ${verif.fiel ? "text-emerald-600" : "text-amber-600"}`}>
            {verif.fiel ? "✅ Fiel copia de lo solicitado" : verif.legible ? "⚠️ Hay diferencias con lo solicitado" : "⚠️ No se pudo leer el archivo"}
            {verif.numero_documento ? <span className="ml-2 font-mono text-xs text-muted">{verif.numero_documento}</span> : null}
          </p>
          <div className="grid gap-1 text-[11px] sm:grid-cols-3">
            <Check ok={verif.nit_ok} label="NIT del proveedor" nulo="sin NIT para cotejar" />
            <Check ok={verif.total_ok} label={`Total ${cop(monto)}`} />
            <Check ok={verif.items.length > 0 && verif.items.every((i) => i.encontrado)} label="Todos los productos aparecen" />
          </div>
          {verif.items.length > 0 && (
            <ul className="space-y-0.5 text-[11px]">
              {verif.items.map((i) => (
                <li key={i.sku + i.nombre} className="flex flex-wrap items-center gap-2">
                  <span>{i.encontrado ? "✓" : "✗"}</span>
                  <span className="font-mono text-accent">{i.sku}</span>
                  <span className="text-ink">{i.nombre}</span>
                  <span className="text-[10px] text-muted">
                    {i.encontrado ? `encontrado por ${i.por}` : "no aparece"}
                    {i.encontrado && !i.precio_ok ? " · precio distinto" : ""}
                    {i.encontrado && !i.cantidad_ok ? " · cantidad no vista" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {verif.advertencias.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-amber-700">
              {verif.advertencias.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          {!verif.fiel && (
            <Campo label="Si la diferencia es correcta, explícala (el aprobador la verá)">
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className={inputCls}
                        placeholder="Ej.: la cotización no incluye el flete que sí se paga; o: el proveedor cambió el precio y se aceptó." />
            </Campo>
          )}
        </div>
      )}
      {!requiere && !verif && <p className="text-[11px] text-muted">Esta categoría no exige factura; puedes seguir sin cotejar.</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onAtras} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink">← Atrás</button>
        <button type="button" onClick={onSiguiente} disabled={!puedeSeguir}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          Ver el asiento →
        </button>
      </div>
    </div>
  );
}

function Check({ ok, label, nulo }: { ok: boolean | null; label: string; nulo?: string }) {
  if (ok === null) return <span className="text-muted">— {label} ({nulo || "no aplica"})</span>;
  return <span className={ok ? "text-emerald-600" : "text-red-500"}>{ok ? "✓" : "✗"} {label}</span>;
}

function ResumenPedido({ proveedor, items, tot, verif, motivo }: {
  proveedor: Proveedor | null; items: ItemLinea[]; tot: { subtotal: number; iva: number; total: number };
  verif: Verificacion | null; motivo: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-[11px]">
      <p className="font-bold text-ink">{proveedor?.nombre ?? "—"} <span className="font-normal text-muted">· {items.length} producto(s)</span></p>
      <p className="text-muted">Subtotal {cop(tot.subtotal)} · IVA {cop(tot.iva)} · <span className="font-bold text-ink">Total {cop(tot.total)}</span></p>
      {verif && (
        <p className={`mt-1 font-bold ${verif.fiel ? "text-emerald-600" : "text-amber-600"}`}>
          {verif.fiel ? "✅ Factura cotejada: fiel copia" : "⚠️ Factura con diferencias"}{verif.numero_documento ? ` · ${verif.numero_documento}` : ""}
          {!verif.fiel && motivo ? <span className="block font-normal text-muted">Explicación: {motivo}</span> : null}
        </p>
      )}
    </div>
  );
}

// ─── El asiento a la vista ─────────────────────────────────────────────────

/**
 * Lo que hace que esto no sea firmar a ciegas: el asiento completo, con sus
 * cuentas y su cuadre, antes de que nadie apruebe nada.
 */
function AsientoPreview({ p }: { p: Previsualizacion }) {
  const totalD = p.lineas.reduce((a, l) => a + l.debito, 0);
  const totalC = p.lineas.reduce((a, l) => a + l.credito, 0);
  return (
    <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Mini label="Monto" valor={cop(p.monto)} />
        {p.retencion > 0 && <Mini label="Retención" valor={`− ${cop(p.retencion)}`} />}
        <Mini label="Se gira" valor={cop(p.girado)} acento />
      </div>
      {p.retencion_motivo && (
        <p className="rounded-lg bg-surface px-2 py-1.5 text-[10px] text-muted">{p.retencion_motivo}</p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <thead className="text-[10px] uppercase text-muted">
            <tr>
              <th className="py-1 pr-2 font-bold">Cuenta</th>
              <th className="py-1 pr-2 font-bold">Nombre</th>
              <th className="py-1 pr-2 text-right font-bold">Débito</th>
              <th className="py-1 text-right font-bold">Crédito</th>
            </tr>
          </thead>
          <tbody>
            {p.lineas.map((l, i) => (
              <tr key={`${l.cuenta_codigo}-${i}`} className="border-t border-border/40">
                <td className="py-1 pr-2 font-mono text-accent">{l.cuenta_codigo}</td>
                <td className="py-1 pr-2 text-ink">
                  {l.cuenta_nombre}
                  <span className="block text-[10px] text-muted">{l.descripcion}</span>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{l.debito ? cop(l.debito) : "—"}</td>
                <td className="py-1 text-right tabular-nums">{l.credito ? cop(l.credito) : "—"}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold">
              <td className="py-1" colSpan={2}>TOTAL</td>
              <td className="py-1 pr-2 text-right tabular-nums">{cop(totalD)}</td>
              <td className="py-1 text-right tabular-nums">{cop(totalC)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`text-[11px] font-bold ${p.cuadra ? "text-emerald-500" : "text-red-500"}`}>
        {p.cuadra ? "✓ El asiento cuadra" : "✗ No cuadra — no se puede enviar"}
      </p>
    </div>
  );
}

// ─── Ficha de cada solicitud ───────────────────────────────────────────────

function FichaSolicitud({
  s, onMensaje,
}: { s: Solicitud; onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void }) {
  const qc = useQueryClient();
  const [ocupado, setOcupado] = useState<"aprobar" | "rechazar" | "enviar" | null>(null);
  const [verAsiento, setVerAsiento] = useState(false);

  // El operador confirma que el pago procede; las validaciones completas
  // (productos, factura cotejada) corren en el backend, no acá.
  async function enviarAprobacion() {
    setOcupado("enviar");
    try {
      const r = await api.post<{ error?: string; estado?: string }>(
        `/api/pagos/solicitudes/${s.id}/enviar`, {},
      );
      if (r.error) onMensaje({ tipo: "error", texto: r.error });
      else onMensaje({ tipo: "ok", texto: "Enviada a aprobación — todavía sin asiento" });
      void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }
  const badge = ESTADO_BADGE[s.estado] ?? { label: s.estado, cls: "bg-surface text-muted" };

  async function accion(tipo: "aprobar" | "rechazar") {
    if (tipo === "aprobar" && !window.confirm(
      `Aprobar ${cop(s.monto)} — ${s.concepto}.\n\n` +
      "Al aprobar se crea el asiento en el Libro Mayor y el comprobante en Alegra. ¿Continuar?",
    )) return;
    const motivo = tipo === "rechazar" ? (window.prompt("Motivo del rechazo:") ?? "") : "";
    if (tipo === "rechazar" && !motivo) return;
    setOcupado(tipo);
    try {
      const r = await api.post<{ error?: string; estado?: string; alegra?: { status: string; message?: string } }>(
        `/api/pagos/solicitudes/${s.id}/${tipo}`, tipo === "rechazar" ? { motivo } : {},
      );
      if (r.error) onMensaje({ tipo: "error", texto: r.error });
      else if (tipo === "aprobar") {
        const al = r.alegra?.status;
        onMensaje({
          tipo: "ok",
          texto: `Aprobada y contabilizada.` + (
            al === "success" ? " Espejada en Alegra."
              : al === "bloqueado" ? " En Alegra quedó pendiente: falta el tipo de comprobante."
              : al === "error" ? ` Alegra falló: ${r.alegra?.message ?? ""} — el asiento interno sí quedó.`
              : ""),
        });
      } else onMensaje({ tipo: "ok", texto: "Solicitud rechazada — no quedó ningún asiento." });
      void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <article className={`rounded-xl border bg-surface-panel p-3 ${
      NECESITA_ACCION.has(s.estado) ? "border-amber-500/40" : "border-border"
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[14rem]">
          <p className="text-sm font-bold text-ink">
            {s.icono} {s.concepto}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {s.categoria_label} · {s.fecha}
            {s.tercero ? ` · ${s.tercero.nombre}` : ""}
            {s.referencia ? ` · ref ${s.referencia}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-extrabold tabular-nums text-ink">{cop(s.monto)}</p>
            {s.retencion > 0 && (
              <p className="text-[10px] text-muted">
                retención {cop(s.retencion)} · se gira {cop(s.girado)}
              </p>
            )}
          </div>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        {s.movimiento_id && <span>📒 asiento #{s.movimiento_id}</span>}
        {s.alegra_journal_id && <span className="text-emerald-500">✓ Alegra #{s.alegra_journal_id}</span>}
        {s.estado === "aprobada" && !s.alegra_journal_id && (
          <span className="text-amber-500">sin espejar en Alegra</span>
        )}
        {s.ticket_id && <span>🎫 ticket #{s.ticket_id}</span>}
        {s.items && s.items.length > 0 && <span>📦 {s.items.length} producto(s)</span>}
        {s.factura_archivo && (
          <button type="button" className="text-accent hover:underline"
            onClick={() => { void fetchAuthBlobUrl(`/api/pagos/solicitudes/${s.id}/factura`).then((u) => { if (u) window.open(u, "_blank"); }); }}>
            📎 {s.factura_numero || s.factura_nombre || "factura"}
          </button>
        )}
        {s.verificacion && typeof s.verificacion.fiel === "boolean" && (
          <span className={`rounded px-1.5 py-0.5 font-bold ${s.verificacion.fiel ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}
                title={(s.verificacion.advertencias || []).join(" · ") + (s.verificacion.motivo_diferencia ? ` · ${s.verificacion.motivo_diferencia}` : "")}>
            {s.verificacion.fiel ? "factura fiel" : "factura con diferencias"}
          </span>
        )}
        {/* Un pago auto-aprobado es válido, pero tuvo un solo par de ojos:
            en una revisión hay que poder distinguirlo de uno aprobado por otro. */}
        {s.notas?.includes("Registrado directamente") && (
          <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-bold text-sky-600">
            registro directo
          </span>
        )}
        {s.notas && !s.notas.includes("Registrado directamente") && (
          <span className="italic">{s.notas}</span>
        )}

        {s.estado === "borrador" && !s.es_plantilla && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setVerAsiento((v) => !v)}
                    className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted hover:border-accent hover:text-accent">
              {verAsiento ? "Ocultar asiento" : "Ver asiento"}
            </button>
            <button type="button" onClick={() => void enviarAprobacion()} disabled={!!ocupado}
                    className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40">
              {ocupado === "enviar" ? "…" : "Verificado — enviar a aprobación"}
            </button>
          </span>
        )}

        {NECESITA_ACCION.has(s.estado) && (
          <span className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => void accion("rechazar")} disabled={!!ocupado}
                    className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold text-muted hover:border-red-500 hover:text-red-500 disabled:opacity-40">
              Rechazar
            </button>
            <button type="button" onClick={() => void accion("aprobar")} disabled={!!ocupado}
                    className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40">
              {ocupado === "aprobar" ? "…" : "Aprobar y contabilizar"}
            </button>
          </span>
        )}
      </div>

      {verAsiento && <AsientoEnVivo sid={s.id} />}
    </article>
  );
}

/**
 * El asiento que dejaría esta solicitud, recalculado ahora contra su origen.
 *
 * No muestra lo que se guardó cuando el cron montó el borrador: vuelve a
 * pedirlo. Para una cuota de préstamo eso significa releer el cronograma, así
 * que si la cuota cambió el operador ve el asiento de hoy. Es la lección de
 * TKT-2026-1252, donde un valor copiado en un texto sobrevivió al cambio que
 * lo invalidaba.
 */
function AsientoEnVivo({ sid }: { sid: number }) {
  const q = useQuery<Previsualizacion>({
    queryKey: ["pago-previsualizacion", sid],
    queryFn: () => api.get(`/api/pagos/solicitudes/${sid}/previsualizacion`),
  });
  if (q.isLoading) return <p className="mt-2 text-[11px] text-muted">Calculando el asiento…</p>;
  if (q.error || !q.data)
    return <p className="mt-2 text-[11px] text-red-400">No se pudo calcular el asiento.</p>;
  const p = q.data;
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-input/40 p-2">
      {p.difiere_de_lo_guardado && (
        <p className="mb-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
          ⚠️ Las cifras cambiaron desde que se montó el borrador
          {typeof p.monto_guardado === "number" ? ` (era ${cop(p.monto_guardado)})` : ""}.
          Lo que vale es lo de abajo.
        </p>
      )}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase text-muted">
            <th className="py-0.5 text-left font-semibold">Cuenta</th>
            <th className="py-0.5 text-left font-semibold">Concepto</th>
            <th className="py-0.5 text-right font-semibold">Débito</th>
            <th className="py-0.5 text-right font-semibold">Crédito</th>
          </tr>
        </thead>
        <tbody>
          {p.lineas.map((l, i) => (
            <tr key={`${l.cuenta_codigo}-${i}`} className="border-t border-border/40">
              <td className="py-0.5 font-mono text-accent">{l.cuenta_codigo}</td>
              <td className="py-0.5 text-muted">{l.descripcion || l.cuenta_nombre}</td>
              <td className="py-0.5 text-right tabular-nums">{l.debito ? cop(l.debito) : "—"}</td>
              <td className="py-0.5 text-right tabular-nums">{l.credito ? cop(l.credito) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-muted">
        {p.cuadra ? "✅ El asiento cuadra." : "⚠️ El asiento NO cuadra."}
        {p.retencion > 0 ? ` Se gira ${cop(p.girado)}; ${cop(p.retencion)} van a la DIAN.` : ""}
        {" "}Nace en el Libro Mayor al aprobar, no ahora.
      </p>
    </div>
  );
}

/**
 * Pagos recurrentes guardados: lo que se repite cada período.
 *
 * Una plantilla no es un pago — no tiene ticket, no se aprueba y no mueve
 * nada. Es la respuesta a «a quién le pagamos cada quincena», que antes vivía
 * en la cabeza del operador o dentro de un script.
 */
function ListaPlantillas({ onMensaje }: { onMensaje: (m: { tipo: "ok" | "error"; texto: string }) => void }) {
  const qc = useQueryClient();
  const [ocupada, setOcupada] = useState<number | null>(null);
  const q = useQuery<{ plantillas: Solicitud[] }>({
    queryKey: ["pagos-plantillas"],
    queryFn: () => api.get("/api/pagos/plantillas"),
  });

  async function montar(p: Solicitud) {
    const periodo = window.prompt(
      `¿Para qué período montas «${p.concepto}»?\n\nEj. 2026-10 (mensual) o 2026-10-Q1 (quincena).`,
      new Date().toISOString().slice(0, 7),
    );
    if (!periodo) return;
    setOcupada(p.id);
    try {
      const r = await api.post<Solicitud & { error?: string; ya_existia?: boolean }>(
        `/api/pagos/plantillas/${p.id}/instanciar`, { periodo },
      );
      if (r.error) onMensaje({ tipo: "error", texto: r.error });
      else if (r.ya_existia)
        onMensaje({ tipo: "ok", texto: `Ese período ya estaba montado (borrador #${r.id}).` });
      else
        onMensaje({ tipo: "ok", texto: `Borrador #${r.id} montado para ${periodo}. Revísalo en «Borradores».` });
      void qc.invalidateQueries({ queryKey: ["pagos-solicitudes"] });
    } catch (e) {
      onMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setOcupada(null);
    }
  }

  const plantillas = q.data?.plantillas ?? [];
  if (q.isLoading) return <p className="text-xs text-muted">Cargando…</p>;
  if (!plantillas.length)
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
        Todavía no hay pagos recurrentes. Al crear una solicitud, marca «¿Este pago se
        repite?» en el último paso y quedará acá.
      </p>
    );

  return (
    <div className="space-y-2">
      {plantillas.map((p) => (
        <article key={p.id} className="rounded-xl border border-border bg-surface-panel p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-ink">{p.icono} {p.concepto}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {p.categoria_label}
                {p.frecuencia ? ` · ${p.frecuencia}` : ""}
                {p.tercero ? ` · ${p.tercero.nombre}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-extrabold tabular-nums text-ink">{cop(p.monto)}</p>
              <button type="button" onClick={() => void montar(p)} disabled={ocupada === p.id}
                      className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-40">
                {ocupada === p.id ? "…" : "Montar un período"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Monto de referencia: al montar el período queda como borrador y ahí se corrige
            contra el documento real antes de enviarlo a aprobación.
          </p>
        </article>
      ))}
    </div>
  );
}

// ─── Piezas ────────────────────────────────────────────────────────────────

const inputCls = "mt-1 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink";

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-[9rem] flex-1 text-xs">
      <span className="font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, valor, sub, alerta }: { label: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${alerta ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface-panel"}`}>
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${alerta ? "text-amber-600" : "text-ink"}`}>{valor}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

function Mini({ label, valor, acento }: { label: string; valor: string; acento?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-extrabold tabular-nums ${acento ? "text-accent" : "text-ink"}`}>{valor}</p>
    </div>
  );
}
