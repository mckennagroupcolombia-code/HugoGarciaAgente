import { Ico } from "../icons/Ico";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

/**
 * Facturación → Cotizar/Facturar: wizard de venta directa por WhatsApp.
 *
 * Reemplaza cotizar en la interfaz de Alegra, donde el IVA salía dos veces: la
 * lista de precios de Alegra ya trae el IVA incluido y Alegra le suma el 19%
 * encima. Aquí el precio que se escribe es SIEMPRE el que paga el cliente; el
 * backend (app/services/ventas_directas.py) saca el IVA línea por línea y le
 * manda a Alegra el precio base.
 *
 * Dos caminos, un solo motor:
 *  - Automático: se elige un pedido que armó el agente IA de WhatsApp y el
 *    wizard salta directo a «Revisar» con cliente, productos y envío puestos.
 *  - Manual: desde una conversación de WhatsApp (extracción con IA) o desde cero.
 */

interface ClienteResultado {
  id: string;
  nombre: string;
  identificacion: string;
  email: string;
  telefono: string;
  direccion: string;
}

interface ProductoResultado {
  codigo: string;
  nombre: string;
  type: string;
}

interface Linea {
  codigo: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  iva_pct?: number;
  base?: number;
  iva?: number;
  total?: number;
  existe_en_alegra?: boolean;
  precio_web?: number | null;
  precio_lista?: number | null;
}

interface Calculo {
  lineas: Linea[];
  envio: number;
  subtotal: number;
  iva: number;
  total: number;
  errores: string[];
  sin_alegra: string[];
}

interface Cliente {
  nombre: string;
  identificacion: string;
  /** "NIT" | "CC" | "" (vacío = el backend lo deduce del nombre y el número). */
  tipo_documento?: string;
  correo: string;
  direccion: string;
  ciudad: string;
}

type Estado = "borrador" | "cotizada" | "facturando" | "facturada" | "anulada";
type Origen = "manual" | "pedido_ia" | "conversacion" | "meli";

interface Venta {
  id: number;
  numero: string;
  estado: Estado;
  origen: Origen;
  origen_ref: string;
  cliente: Cliente;
  telefono: string;
  lineas: Linea[];
  envio: number;
  subtotal: number;
  iva: number;
  total: number;
  notas: string;
  medio_pago: string;
  alegra_cotizacion_numero?: string | null;
  factura_numero?: string | null;
  factura_url?: string | null;
  factura_cufe?: string | null;
  enviado_whatsapp: boolean;
  avisos: string[];
  creado_por: string;
  actualizado: string;
}

interface PedidoIA {
  id: number;
  jid: string;
  display: string;
  estado: string;
  items: { ref: string; nombre: string; precio: number; cantidad: number; subtotal: number }[];
  cliente: Record<string, string>;
  subtotal: number;
  envio: number | null;
  total: number | null;
  faltantes: string[];
  actualizado: number;
  venta_directa?: { id: number; numero: string; estado: Estado } | null;
}

interface ProductoExtraido {
  nombre: string;
  cantidad: number;
  candidatos: ProductoResultado[];
}

interface ConversacionWA {
  usuario_id: string;
  telefono: string;
  resumen: string;
  ultimo: string;
}

const PASOS = [
  { id: 1, label: "Origen" },
  { id: 2, label: "Cliente" },
  { id: 3, label: "Productos" },
  { id: 4, label: "Revisar" },
  { id: 5, label: "Cotizar o facturar" },
] as const;

const MEDIOS_PAGO = [
  { id: "CREDIT_TRANSFER", label: "Transferencia / Nequi / Daviplata" },
  { id: "DEBIT_TRANSFER", label: "PSE / botón de banco" },
  { id: "BANK_DEPOSIT", label: "Consignación" },
  { id: "CREDIT_CARD", label: "Tarjeta de crédito" },
  { id: "DEBIT_CARD", label: "Tarjeta débito" },
  { id: "CASH", label: "Efectivo" },
];

const ESTADO_UI: Record<Estado, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "bg-surface-hover text-muted" },
  cotizada: { label: "Cotizada · esperando pago", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  facturando: { label: "Facturando…", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  facturada: { label: "Facturada", cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  anulada: { label: "Anulada", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

const CLIENTE_VACIO: Cliente = { nombre: "", identificacion: "", tipo_documento: "", correo: "", direccion: "", ciudad: "" };

const input =
  "w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const card = "rounded-xl border border-border bg-surface-panel p-4";
const btn =
  "rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimario =
  "rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

function pesos(v: number | null | undefined) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v ?? 0);
}

function hace(ts: number | string): string {
  const ms = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  const mins = Math.round((Date.now() - ms) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  if (mins < 1440) return `hace ${Math.round(mins / 60)} h`;
  return `hace ${Math.round(mins / 1440)} d`;
}

function telefonoVisible(tel: string): string {
  if (!tel.replace(/\D/g, "") && !tel.includes("@")) return "sin WhatsApp — no se envía el PDF";
  if (tel.includes("@")) return tel.endsWith("@lid") ? "chat de WhatsApp" : tel.split("@")[0];
  const d = tel.replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("57") ? d.slice(2) : d;
  return local.length === 10 ? `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : tel;
}

function useDebounced<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export default function CotizarFacturarPanel() {
  const [paso, setPaso] = useState(1);
  const [ventaId, setVentaId] = useState<number | null>(null);
  const [venta, setVenta] = useState<Venta | null>(null);

  const [origen, setOrigen] = useState<Origen>("manual");
  const [origenRef, setOrigenRef] = useState("");
  const [cliente, setCliente] = useState<Cliente>(CLIENTE_VACIO);
  const [telefono, setTelefono] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [envio, setEnvio] = useState(0);
  const [notas, setNotas] = useState("");
  const [medioPago, setMedioPago] = useState("CREDIT_TRANSFER");

  const [calc, setCalc] = useState<Calculo | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [confirmarFactura, setConfirmarFactura] = useState(false);
  const [pendientes, setPendientes] = useState<ProductoExtraido[]>([]);

  const soloLectura = venta?.estado === "facturada" || venta?.estado === "anulada" || venta?.estado === "facturando";

  const reiniciar = useCallback(() => {
    setPaso(1);
    setVentaId(null);
    setVenta(null);
    setOrigen("manual");
    setOrigenRef("");
    setCliente(CLIENTE_VACIO);
    setTelefono("");
    setLineas([]);
    setEnvio(0);
    setNotas("");
    setMedioPago("CREDIT_TRANSFER");
    setCalc(null);
    setError(null);
    setAvisos([]);
    setConfirmarFactura(false);
    setPendientes([]);
  }, []);

  const cargarVenta = useCallback((v: Venta, irA?: number) => {
    setVentaId(v.id);
    setVenta(v);
    setOrigen(v.origen);
    setOrigenRef(v.origen_ref);
    setCliente({ ...CLIENTE_VACIO, ...v.cliente });
    setTelefono(v.telefono);
    setLineas(v.lineas);
    setEnvio(v.envio);
    setNotas(v.notas);
    if (v.medio_pago) setMedioPago(v.medio_pago);
    setAvisos(v.avisos ?? []);
    setError(null);
    setConfirmarFactura(false);
    if (irA) setPaso(irA);
  }, []);

  // Totales siempre desde el backend: el IVA de cada línea sale de Alegra.
  const firmaCalculo = useDebounced(JSON.stringify({ lineas: lineas.map(({ codigo, cantidad, precio_unitario }) => ({ codigo, cantidad, precio_unitario })), envio }), 350);
  useEffect(() => {
    const body = JSON.parse(firmaCalculo) as { lineas: Linea[]; envio: number };
    if (!body.lineas.length && !body.envio) {
      setCalc(null);
      return;
    }
    let cancelado = false;
    api
      .post<Calculo>("/api/ventas-directas/calcular", body)
      .then((c) => !cancelado && setCalc(c))
      .catch(() => !cancelado && setCalc(null));
    return () => {
      cancelado = true;
    };
  }, [firmaCalculo]);

  async function guardar(): Promise<Venta | null> {
    if (soloLectura && venta) return venta;
    const body = { origen, origen_ref: origenRef, cliente, telefono, lineas, envio, notas, medio_pago: medioPago };
    try {
      const r = ventaId
        ? await api.put<{ venta: Venta }>(`/api/ventas-directas/${ventaId}`, body)
        : await api.post<{ venta: Venta }>("/api/ventas-directas", body);
      setVentaId(r.venta.id);
      setVenta(r.venta);
      return r.venta;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function avanzar(a: number) {
    setError(null);
    if (a >= 4) {
      setOcupado("guardar");
      const v = await guardar();
      setOcupado(null);
      if (!v) return;
    }
    setPaso(a);
  }

  // El WhatsApp es opcional: una venta de MeLi no lo trae y sin él solo no se envía el PDF.
  const clienteOk = cliente.nombre.trim().length > 0;
  const productosOk = lineas.length > 0 && lineas.every((l) => l.cantidad > 0 && l.precio_unitario >= 0);
  const puedeFacturar =
    clienteOk && cliente.identificacion.trim().length > 0 && productosOk && !(calc?.sin_alegra.length) && !(calc?.errores.length);

  const pasoHabilitado = (id: number) =>
    id === 1 || (id === 2) || (id === 3 && clienteOk) || (id >= 4 && clienteOk && productosOk);

  async function cotizar() {
    setOcupado("cotizar");
    setError(null);
    const v = await guardar();
    if (!v) return setOcupado(null);
    try {
      const r = await api.post<{ venta: Venta; avisos: string[] }>(`/api/ventas-directas/${v.id}/cotizar`, {});
      cargarVenta(r.venta);
      setAvisos(r.avisos ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function facturar() {
    if (!confirmarFactura) {
      setConfirmarFactura(true);
      return;
    }
    setConfirmarFactura(false);
    setOcupado("facturar");
    setError(null);
    const v = await guardar();
    if (!v) return setOcupado(null);
    try {
      const r = await api.post<{ venta: Venta; avisos: string[] }>(`/api/ventas-directas/${v.id}/facturar`, {
        medio_pago: medioPago,
        // Una venta de MeLi revisa antes en Alegra que no exista otra factura (~30 s).
      }, { timeoutMs: origen === "meli" ? 150_000 : 90_000 });
      cargarVenta(r.venta);
      setAvisos(r.avisos ?? []);
    } catch (e) {
      setError((e as Error).message);
      // Refresca: si Alegra alcanzó a emitir, la venta ya no debe verse editable.
      api.get<Venta>(`/api/ventas-directas/${v.id}`).then((x) => cargarVenta(x)).catch(() => undefined);
    } finally {
      setOcupado(null);
    }
  }

  async function anular() {
    if (!ventaId) return;
    try {
      await api.post(`/api/ventas-directas/${ventaId}/anular`, {});
      const v = await api.get<Venta>(`/api/ventas-directas/${ventaId}`);
      cargarVenta(v);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function verPdf() {
    if (!ventaId) return;
    const url = await fetchAuthBlobUrl(`/api/ventas-directas/${ventaId}/pdf`);
    if (url) window.open(url, "_blank", "noopener");
    else setError("No se encontró el PDF de la cotización.");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Cotizar / Facturar venta directa</h2>
          <p className="max-w-2xl text-xs text-muted">
            Ventas por WhatsApp de principio a fin. Escribe siempre el precio que paga el cliente (IVA incluido):
            el sistema saca el IVA de cada producto y registra la cotización en Alegra con el precio correcto.
            No cotices directamente en Alegra: allá el IVA se suma dos veces.
          </p>
        </div>
        {(ventaId || paso > 1) && (
          <button type="button" onClick={reiniciar} className={btn}>
            + Nueva venta
          </button>
        )}
      </div>

      {/* Stepper */}
      <ol className="grid grid-cols-5 gap-2" aria-label="Pasos">
        {PASOS.map((p) => {
          const activo = p.id === paso;
          const hecho = p.id < paso || (venta?.estado === "facturada" && p.id <= 5);
          const habil = pasoHabilitado(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!habil}
                aria-current={activo ? "step" : undefined}
                onClick={() => void avanzar(p.id)}
                className={`flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  activo ? "border-accent ring-2 ring-accent" : "border-border hover:border-accent/60"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                    hecho ? "bg-accent text-white" : activo ? "bg-accent/15 text-accent" : "bg-surface-hover text-muted"
                  }`}
                >
                  {hecho ? "✓" : p.id}
                </span>
                <span className="hidden truncate text-xs font-bold text-ink sm:inline">{p.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {venta && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono font-semibold text-ink">{venta.numero}</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${ESTADO_UI[venta.estado].cls}`}>
            {ESTADO_UI[venta.estado].label}
          </span>
          {venta.alegra_cotizacion_numero && <span className="text-muted">Alegra cotización #{venta.alegra_cotizacion_numero}</span>}
          {venta.factura_numero && <span className="text-muted">· Factura {venta.factura_numero}</span>}
          {venta.origen === "pedido_ia" && <span className="text-muted">· desde pedido IA #{venta.origen_ref}</span>}
          {venta.origen === "meli" && <span className="text-muted">· venta MeLi {venta.origen_ref}</span>}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          ❌ {error}
        </div>
      )}

      {paso === 1 && (
        <PasoOrigen
          onPedido={(v) => cargarVenta(v, 4)}
          onVenta={(v) => cargarVenta(v, v.estado === "borrador" ? 3 : 5)}
          onManual={() => {
            setOrigen("manual");
            setPaso(2);
          }}
          onMeli={(d) => {
            setOrigen("meli");
            setOrigenRef(d.pack_id);
            setCliente((c) => ({
              ...c,
              nombre: d.cliente.nombre || c.nombre,
              identificacion: d.cliente.identificacion || c.identificacion,
              tipo_documento: d.cliente.tipo_documento || c.tipo_documento,
              direccion: d.cliente.direccion || c.direccion,
              correo: c.correo || d.cliente.correo,
            }));
            setLineas(d.lineas);
            setAvisos(d.avisos ?? []);
            setPaso(2);
          }}
          onConversacion={(datos) => {
            setOrigen("conversacion");
            setOrigenRef(datos.ref);
            setCliente((c) => ({
              ...c,
              nombre: c.nombre || datos.cliente.nombre,
              identificacion: c.identificacion || datos.cliente.identificacion,
              correo: c.correo || datos.cliente.correo,
              direccion: c.direccion || datos.cliente.direccion,
            }));
            if (datos.telefono) setTelefono((t) => t || datos.telefono);
            if (datos.notas) setNotas((n) => n || datos.notas);
            setLineas((prev) => [...prev, ...datos.lineas.filter((l) => !prev.some((p) => p.codigo === l.codigo))]);
            setPendientes((prev) => [...prev, ...datos.pendientes]);
            setPaso(2);
          }}
        />
      )}

      {paso === 2 && origen === "meli" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <Ico e="🧾" /> Venta de Mercado Libre {origenRef}: los datos vienen de la facturación que el comprador cargó en MeLi.
          Compáralos con el RUT que envió y escribe el <b>correo</b> del RUT (MeLi no lo entrega). La factura queda ligada a
          la venta, se sube a MeLi y «Facturar ahora» ya no emite otra.
        </p>
      )}

      {paso === 2 && (
        <PasoCliente
          cliente={cliente}
          telefono={telefono}
          soloLectura={soloLectura}
          onCliente={setCliente}
          onTelefono={setTelefono}
          onSiguiente={() => void avanzar(3)}
          habilitado={clienteOk}
        />
      )}

      {paso === 3 && (
        <PasoProductos
          lineas={lineas}
          calc={calc}
          envio={envio}
          soloLectura={soloLectura}
          onLineas={setLineas}
          onEnvio={setEnvio}
          pendientes={pendientes}
          onPendientes={setPendientes}
          onAtras={() => setPaso(2)}
          onSiguiente={() => void avanzar(4)}
          habilitado={productosOk}
          ocupado={ocupado === "guardar"}
        />
      )}

      {paso === 4 && (
        <div className={`${card} space-y-4`}>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Revisar antes de enviar</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 p-3 text-sm">
              <p className="font-semibold text-ink">{cliente.nombre || "—"}</p>
              <p className="text-xs text-muted">
                {cliente.identificacion
                  ? `${cliente.tipo_documento || "CC/NIT"} ${cliente.identificacion}`
                  : "Sin identificación — solo se puede cotizar"}
              </p>
              <p className="text-xs text-muted"><Ico e="📱" /> {telefonoVisible(telefono)}</p>
              {cliente.correo && <p className="text-xs text-muted"><Ico e="✉️" /> {cliente.correo}</p>}
              {cliente.direccion && <p className="text-xs text-muted"><Ico e="📍" /> {cliente.direccion}</p>}
            </div>
            <Totales calc={calc} />
          </div>
          <TablaResumen calc={calc} />
          {calc && calc.sin_alegra.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Ico e="⚠️" /> No existen en Alegra: {calc.sin_alegra.join(", ")}. Se puede cotizar (solo PDF), pero no facturar.
            </p>
          )}
          <textarea
            value={notas}
            disabled={soloLectura}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Notas para el cliente (condiciones, tiempo de entrega, descuento acordado…)"
            rows={2}
            className={input}
          />
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={btn} onClick={() => setPaso(3)}>
              ← Productos
            </button>
            <button type="button" className={btnPrimario} disabled={ocupado !== null} onClick={() => void avanzar(5)}>
              {ocupado === "guardar" ? "Guardando…" : "Continuar →"}
            </button>
          </div>
        </div>
      )}

      {paso === 5 && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`${card} space-y-3`}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted"><Ico e="📋" /> Cotizar</p>
            <p className="text-xs text-muted">
              PDF sin efecto ante la DIAN, válido 15 días. Se envía al WhatsApp del cliente y queda registrado en
              Alegra{cliente.identificacion ? "" : " (esto último solo si hay identificación)"}.
            </p>
            <p className="text-2xl font-bold text-ink">{pesos(calc?.total ?? venta?.total)}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btn}
                disabled={ocupado !== null || soloLectura || !clienteOk || !productosOk}
                onClick={() => void cotizar()}
              >
                {ocupado === "cotizar" ? "Enviando…" : venta?.estado === "cotizada" ? "Reenviar cotización" : "Enviar cotización"}
              </button>
              {(venta?.estado === "cotizada" || venta?.alegra_cotizacion_numero) && (
                <button type="button" className="text-xs text-muted underline" onClick={() => void verPdf()}>
                  Ver PDF
                </button>
              )}
            </div>
          </div>

          <div className={`${card} space-y-3`}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted"><Ico e="🧾" /> Facturar (el cliente ya pagó)</p>
            {venta?.estado === "facturada" ? (
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-green-700 dark:text-green-400">✅ Factura {venta.factura_numero} emitida</p>
                <p className="text-xs text-muted">
                  {venta.enviado_whatsapp ? "Enviada por WhatsApp al cliente." : "Revisa el envío al cliente."}
                </p>
                {venta.factura_url && (
                  <a href={venta.factura_url} target="_blank" rel="noreferrer" className="text-xs underline">
                    Ver en Alegra
                  </a>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Factura electrónica real ante la DIAN. Solo se corrige con nota crédito: confirma el pago antes.
                </p>
                <label className="block text-xs font-semibold text-ink">
                  ¿Cómo pagó?
                  <select
                    value={medioPago}
                    onChange={(e) => setMedioPago(e.target.value)}
                    disabled={soloLectura}
                    className={`${input} mt-1`}
                  >
                    {MEDIOS_PAGO.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!cliente.identificacion.trim() && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">Falta la identificación del cliente (paso 2).</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!puedeFacturar || ocupado !== null || soloLectura}
                    onClick={() => void facturar()}
                    className={`rounded-paper border-2 px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      confirmarFactura
                        ? "border-red-500 bg-red-500 text-white hover:bg-red-600"
                        : "border-border text-ink hover:border-red-400 hover:text-red-600"
                    }`}
                  >
                    {ocupado === "facturar"
                      ? "Facturando…"
                      : confirmarFactura
                        ? `⚠️ Confirmar factura DIAN por ${pesos(calc?.total)}`
                        : "Facturar"}
                  </button>
                  {confirmarFactura && (
                    <button type="button" onClick={() => setConfirmarFactura(false)} className="text-xs text-muted underline">
                      Cancelar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {avisos.length > 0 && (
            <div className="rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300 md:col-span-2">
              {avisos.map((a) => (
                <p key={a}><Ico e="⚠️" /> {a}</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2 md:col-span-2">
            <button type="button" className={btn} onClick={() => setPaso(4)}>
              ← Revisar
            </button>
            {venta && venta.estado !== "facturada" && venta.estado !== "anulada" && venta.estado !== "facturando" && (
              <button type="button" className="text-xs text-muted underline hover:text-red-600" onClick={() => void anular()}>
                Anular esta venta
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── Paso 1 · Origen ─────────────────────────────── */

interface VentaMeli {
  ok: boolean;
  error?: string;
  pack_id: string;
  order_ids: string[];
  cliente: { nombre: string; identificacion: string; tipo_documento: string; direccion: string; correo: string };
  lineas: Linea[];
  bloqueo: string | null;
  avisos: string[];
}

interface DatosConversacion {
  ref: string;
  cliente: Cliente;
  telefono: string;
  notas: string;
  lineas: Linea[];
  pendientes: ProductoExtraido[];
}

async function precioDe(p: ProductoResultado, cantidad = 1): Promise<Linea> {
  try {
    const d = await api.get<{ precio: number; precio_web: number | null; precio_lista: number | null; iva_pct: number }>(
      `/api/ventas-directas/precio?codigo=${encodeURIComponent(p.codigo)}`,
    );
    return { codigo: p.codigo, nombre: p.nombre, cantidad, precio_unitario: d.precio, precio_web: d.precio_web, precio_lista: d.precio_lista, iva_pct: d.iva_pct };
  } catch {
    return { codigo: p.codigo, nombre: p.nombre, cantidad, precio_unitario: 0 };
  }
}

function PasoOrigen({
  onPedido,
  onVenta,
  onManual,
  onMeli,
  onConversacion,
}: {
  onPedido: (v: Venta) => void;
  onVenta: (v: Venta) => void;
  onManual: () => void;
  onMeli: (d: VentaMeli) => void;
  onConversacion: (d: DatosConversacion) => void;
}) {
  const [pedidos, setPedidos] = useState<PedidoIA[] | null>(null);
  const [ventas, setVentas] = useState<Venta[] | null>(null);
  const [filtroVentas, setFiltroVentas] = useState("");
  const [conversaciones, setConversaciones] = useState<ConversacionWA[] | null>(null);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useDebounced(filtroVentas, 300);
  const [refMeli, setRefMeli] = useState("");
  const [bloqueoMeli, setBloqueoMeli] = useState<string | null>(null);

  async function traerMeli() {
    setOcupado("meli");
    setError(null);
    setBloqueoMeli(null);
    try {
      const d = await api.get<VentaMeli>(`/api/ventas-directas/meli/${encodeURIComponent(refMeli.replace(/\D/g, ""))}`, {
        timeoutMs: 60_000,
      });
      if (!d.ok) throw new Error(d.error || "No se pudo leer la venta de MeLi.");
      if (d.bloqueo) setBloqueoMeli(d.bloqueo);
      else onMeli(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  useEffect(() => {
    api
      .get<{ pedidos: PedidoIA[] }>("/api/ventas-directas/pedidos-ia")
      .then((r) => setPedidos(r.pedidos))
      .catch(() => setPedidos([]));
  }, []);

  useEffect(() => {
    api
      .get<{ ventas: Venta[] }>(`/api/ventas-directas?limit=30&q=${encodeURIComponent(q)}`)
      .then((r) => setVentas(r.ventas))
      .catch(() => setVentas([]));
  }, [q]);

  async function usarPedido(p: PedidoIA) {
    setOcupado(`p${p.id}`);
    setError(null);
    try {
      const r = await api.post<{ venta: Venta }>(`/api/ventas-directas/desde-pedido/${p.id}`, {});
      onPedido(r.venta);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function extraer(payload: { texto: string } | { usuario_id: string }, telefono = "", ref = "") {
    setOcupado("extraer");
    setError(null);
    try {
      const data = await api.post<{
        ok: boolean;
        error?: string;
        cliente?: { nombre: string; identificacion: string; telefono: string; correo: string; direccion: string };
        productos?: ProductoExtraido[];
        notas?: string;
      }>("/api/facturacion/extraer-conversacion", payload);
      if (!data.ok) throw new Error(data.error || "No se pudo extraer la información.");
      const lineas: Linea[] = [];
      const porConfirmar: ProductoExtraido[] = [];
      for (const p of data.productos ?? []) {
        if (p.candidatos.length === 1) lineas.push(await precioDe(p.candidatos[0], p.cantidad || 1));
        else porConfirmar.push(p);
      }
      const c = data.cliente;
      const tel = telefono || (c?.telefono ?? "");
      onConversacion({
        ref,
        cliente: { ...CLIENTE_VACIO, ...(c ?? {}) },
        telefono: tel,
        notas: data.notas ?? "",
        lineas,
        pendientes: porConfirmar,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const abiertos = (pedidos ?? []).filter((p) => !p.venta_directa || p.venta_directa.estado !== "facturada");

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">⚡ Automático · pedidos que armó el agente IA</p>
          <span className="text-[10px] text-muted">cliente, productos y envío ya puestos</span>
        </div>
        {pedidos === null ? (
          <p className="text-xs text-muted">Cargando…</p>
        ) : abiertos.length === 0 ? (
          <p className="text-xs text-muted">
            No hay pedidos del agente IA por facturar. (Mientras el agente de WhatsApp esté en modo sombra, sus
            borradores no aparecen aquí: el cliente nunca los vio.)
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {abiertos.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={ocupado !== null}
                onClick={() => void usarPedido(p)}
                className="rounded-lg border border-border/70 p-3 text-left text-xs transition hover:border-accent disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{p.cliente?.nombre || p.display}</span>
                  <span className="text-[10px] text-muted">{hace(p.actualizado)}</span>
                </div>
                <p className="mt-0.5 truncate text-muted">
                  {p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(" · ")}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-bold text-ink">{pesos(p.total ?? p.subtotal)}</span>
                  {p.venta_directa ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADO_UI[p.venta_directa.estado].cls}`}>
                      {p.venta_directa.numero}
                    </span>
                  ) : p.faltantes.length > 0 ? (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400">falta: {p.faltantes.join(", ")}</span>
                  ) : (
                    <span className="text-[10px] text-green-700 dark:text-green-400">datos completos</span>
                  )}
                </div>
                {ocupado === `p${p.id}` && <p className="mt-1 text-muted">Armando…</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted"><Ico e="🧾" /> Venta de Mercado Libre · el cliente envió su RUT</p>
        <p className="mb-2 text-[11px] text-muted">
          Trae comprador y productos de la venta, y liga la factura a ella (sin duplicar con «Facturar ahora»).
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={refMeli}
            onChange={(e) => setRefMeli(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refMeli.trim() && void traerMeli()}
            placeholder="Venta # (pack u orden, ej. 2000015079567449)"
            className={`${input} min-w-0 flex-1`}
          />
          <button type="button" className={btn} disabled={ocupado !== null || !refMeli.replace(/\D/g, "")} onClick={() => void traerMeli()}>
            {ocupado === "meli" ? "Consultando…" : "Traer de MeLi"}
          </button>
        </div>
        {bloqueoMeli && <p className="mt-2 text-xs text-red-600"><Ico e="⚠️" /> {bloqueoMeli}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted"><Ico e="🪄" /> Manual · desde una conversación</p>
          <button
            type="button"
            className={btn}
            disabled={ocupado !== null}
            onClick={() => {
              if (conversaciones) return setConversaciones(null);
              api
                .get<{ items: ConversacionWA[] }>("/api/facturacion/conversaciones-wa?limit=40")
                .then((r) => setConversaciones(r.items ?? []))
                .catch(() => setConversaciones([]));
            }}
          >
            {conversaciones ? "Ocultar chats" : "Elegir chat reciente"}
          </button>
          {conversaciones && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border/70">
              {conversaciones.length === 0 && <p className="px-3 py-2 text-xs text-muted">Sin conversaciones recientes.</p>}
              {conversaciones.map((c) => (
                <button
                  key={c.usuario_id}
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => void extraer({ usuario_id: c.usuario_id }, c.telefono.replace(/\D/g, ""), c.usuario_id)}
                  className="block w-full border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 hover:bg-surface-hover"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-ink">{telefonoVisible(c.telefono)}</span>
                    <span className="text-[10px] text-muted">{hace(c.ultimo.includes("T") ? c.ultimo : `${c.ultimo.replace(" ", "T")}Z`)}</span>
                  </div>
                  {c.resumen && <p className="truncate text-muted">{c.resumen}</p>}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="…o pega aquí el texto del chat"
            className={`${input} mt-2`}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={btn}
              disabled={!texto.trim() || ocupado !== null}
              onClick={() => void extraer({ texto })}
            >
              {ocupado === "extraer" ? "Leyendo…" : "Extraer datos"}
            </button>
            <span className="text-[10px] text-muted">usa IA (unos pocos pesos por chat)</span>
          </div>
        </div>

        <div className={`${card} flex flex-col justify-between gap-3`}>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted"><Ico e="✍️" /> Manual · desde cero</p>
            <p className="text-xs text-muted">Buscas el cliente, agregas los productos y listo.</p>
          </div>
          <button type="button" className={btnPrimario} onClick={onManual}>
            Empezar →
          </button>
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted"><Ico e="🗂" /> Ventas directas recientes</p>
          <input
            value={filtroVentas}
            onChange={(e) => setFiltroVentas(e.target.value)}
            placeholder="Buscar cliente, número o factura…"
            className="w-60 rounded border border-border bg-surface px-2 py-1 text-xs text-ink"
          />
        </div>
        {ventas === null ? (
          <p className="text-xs text-muted">Cargando…</p>
        ) : ventas.length === 0 ? (
          <p className="text-xs text-muted">Aún no hay ventas directas registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/60">
                {ventas.map((v) => (
                  <tr key={v.id} className="cursor-pointer hover:bg-surface-hover" onClick={() => onVenta(v)}>
                    <td className="py-1.5 font-mono text-ink">{v.numero}</td>
                    <td className="py-1.5 text-ink-secondary">{v.cliente?.nombre || "—"}</td>
                    <td className="py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADO_UI[v.estado].cls}`}>
                        {v.factura_numero || ESTADO_UI[v.estado].label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-semibold text-ink">{pesos(v.total)}</td>
                    <td className="py-1.5 text-right text-muted">{hace(v.actualizado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Paso 2 · Cliente ─────────────────────────────── */

function PasoCliente({
  cliente,
  telefono,
  soloLectura,
  onCliente,
  onTelefono,
  onSiguiente,
  habilitado,
}: {
  cliente: Cliente;
  telefono: string;
  soloLectura: boolean;
  onCliente: (c: Cliente) => void;
  onTelefono: (t: string) => void;
  onSiguiente: () => void;
  habilitado: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ClienteResultado[]>([]);
  const q = useDebounced(busqueda.trim(), 250);

  useEffect(() => {
    if (q.length < 2) return setResultados([]);
    let cancelado = false;
    api
      .get<{ items: ClienteResultado[] }>(`/api/facturacion/clientes/buscar?q=${encodeURIComponent(q)}`)
      .then((r) => !cancelado && setResultados(r.items ?? []))
      .catch(() => !cancelado && setResultados([]));
    return () => {
      cancelado = true;
    };
  }, [q]);

  const set = (k: keyof Cliente) => (e: ChangeEvent<HTMLInputElement>) => onCliente({ ...cliente, [k]: e.target.value });

  return (
    <div className={`${card} space-y-3`}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">¿A quién le vendemos?</p>
      {!soloLectura && (
        <div className="relative">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente en Alegra por nombre o cédula/NIT…"
            className={input}
          />
          {q.length >= 2 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
              {resultados.length === 0 && <p className="px-3 py-2 text-xs text-muted">Sin resultados — se creará como cliente nuevo.</p>}
              {resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onCliente({ ...cliente, nombre: c.nombre, identificacion: c.identificacion, correo: c.email, direccion: c.direccion });
                    if (c.telefono && !telefono) onTelefono(c.telefono);
                    setBusqueda("");
                  }}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover"
                >
                  <span className="font-semibold text-ink">{c.nombre}</span> <span className="text-muted">— {c.identificacion}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={cliente.nombre} onChange={set("nombre")} disabled={soloLectura} placeholder="Nombre o razón social *" className={input} />
        <div className="flex gap-2">
          <select
            value={cliente.tipo_documento ?? ""}
            onChange={(e) => onCliente({ ...cliente, tipo_documento: e.target.value })}
            disabled={soloLectura}
            title="Una empresa se factura con NIT. «Detectar» lo decide por el nombre (S.A.S, LTDA…) y el número."
            className={`${input} w-28 shrink-0`}
          >
            <option value="">Detectar</option>
            <option value="NIT">NIT</option>
            <option value="CC">CC</option>
          </select>
          <input
            value={cliente.identificacion}
            onChange={set("identificacion")}
            disabled={soloLectura}
            placeholder="Cédula / NIT con DV, ej. 900409216-6 (para facturar)"
            className={`${input} min-w-0 flex-1`}
          />
        </div>
        <input
          value={telefono.includes("@") ? telefonoVisible(telefono) : telefono}
          onChange={(e) => onTelefono(e.target.value)}
          disabled={soloLectura || telefono.includes("@")}
          title={telefono.includes("@") ? "Se responde en el mismo chat donde el cliente hizo el pedido" : undefined}
          placeholder="WhatsApp del cliente (opcional, 3001234567)"
          className={input}
        />
        <input value={cliente.correo} onChange={set("correo")} disabled={soloLectura} placeholder="Correo (opcional)" className={input} />
        <input
          value={cliente.direccion}
          onChange={set("direccion")}
          disabled={soloLectura}
          placeholder="Dirección y ciudad (opcional)"
          className={`${input} sm:col-span-2`}
        />
      </div>
      <div className="flex justify-end">
        <button type="button" className={btnPrimario} disabled={!habilitado} onClick={onSiguiente}>
          Productos →
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Paso 3 · Productos ─────────────────────────────── */

function PasoProductos({
  lineas,
  calc,
  envio,
  soloLectura,
  onLineas,
  onEnvio,
  onAtras,
  onSiguiente,
  habilitado,
  ocupado,
  pendientes,
  onPendientes,
}: {
  pendientes: ProductoExtraido[];
  onPendientes: (p: ProductoExtraido[]) => void;
  lineas: Linea[];
  calc: Calculo | null;
  envio: number;
  soloLectura: boolean;
  onLineas: (fn: (prev: Linea[]) => Linea[]) => void;
  onEnvio: (v: number) => void;
  onAtras: () => void;
  onSiguiente: () => void;
  habilitado: boolean;
  ocupado: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ProductoResultado[]>([]);
  const q = useDebounced(busqueda.trim(), 220);

  useEffect(() => {
    if (!q) return setResultados([]);
    let cancelado = false;
    api
      .get<{ items: ProductoResultado[] }>(`/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=20&excluir_combos=0`)
      .then((r) => !cancelado && setResultados(r.items ?? []))
      .catch(() => !cancelado && setResultados([]));
    return () => {
      cancelado = true;
    };
  }, [q]);

  const porCodigo = useMemo(() => new Map((calc?.lineas ?? []).map((l) => [l.codigo, l])), [calc]);

  async function agregar(p: ProductoResultado, cantidad = 1) {
    setBusqueda("");
    setResultados([]);
    if (lineas.some((l) => l.codigo === p.codigo)) return;
    const l = await precioDe(p, cantidad);
    onLineas((prev) => (prev.some((x) => x.codigo === l.codigo) ? prev : [...prev, l]));
  }

  const actualizar = (codigo: string, campo: "cantidad" | "precio_unitario", valor: number) =>
    onLineas((prev) => prev.map((l) => (l.codigo === codigo ? { ...l, [campo]: valor } : l)));

  return (
    <div className={`${card} space-y-3`}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">¿Qué lleva?</p>
      {!soloLectura && (
        <div className="relative">
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto por nombre o SKU…" className={input} />
          {q && resultados.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
              {resultados.map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => void agregar(p)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover"
                >
                  <span className="font-mono text-ink">{p.codigo}</span> <span className="text-ink-secondary">— {p.nombre}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          <p className="font-semibold text-ink">El chat menciona estos productos; elige el correcto:</p>
          {pendientes.map((p, idx) => (
            <div key={`${p.nombre}-${idx}`}>
              <p className="text-ink">
                &ldquo;{p.nombre}&rdquo; <span className="text-muted">× {p.cantidad}</span>{" "}
                <button type="button" className="text-muted underline" onClick={() => onPendientes(pendientes.filter((_, i) => i !== idx))}>
                  descartar
                </button>
              </p>
              {p.candidatos.length === 0 ? (
                <p className="text-muted">Sin coincidencia en Alegra — búscalo arriba.</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.candidatos.map((c) => (
                    <button
                      key={c.codigo}
                      type="button"
                      onClick={() => {
                        void agregar(c, p.cantidad || 1);
                        onPendientes(pendientes.filter((_, i) => i !== idx));
                      }}
                      className="rounded border border-border bg-surface px-2 py-1 hover:border-accent hover:text-accent"
                    >
                      {c.codigo} — {c.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {lineas.length === 0 ? (
        <p className="text-xs text-muted">Sin productos todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="py-1">Producto</th>
                <th className="py-1 text-right">Cant</th>
                <th className="py-1 text-right">Precio c/u (con IVA)</th>
                <th className="py-1 text-right">IVA</th>
                <th className="py-1 text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {lineas.map((l) => {
                const c = porCodigo.get(l.codigo);
                return (
                  <tr key={l.codigo}>
                    <td className="py-1.5">
                      <p className="text-ink">{l.nombre}</p>
                      <p className="font-mono text-[10px] text-muted">
                        {l.codigo}
                        {c && !c.existe_en_alegra && <span className="ml-1 text-amber-600">· no está en Alegra</span>}
                      </p>
                      {(l.precio_web || l.precio_lista) && !soloLectura && (
                        <p className="text-[10px] text-muted">
                          {l.precio_web ? (
                            <button type="button" className="underline" onClick={() => actualizar(l.codigo, "precio_unitario", l.precio_web ?? 0)}>
                              web {pesos(l.precio_web)}
                            </button>
                          ) : null}
                          {l.precio_web && l.precio_lista ? " · " : ""}
                          {l.precio_lista ? (
                            <button type="button" className="underline" onClick={() => actualizar(l.codigo, "precio_unitario", l.precio_lista ?? 0)}>
                              MeLi {pesos(l.precio_lista)}
                            </button>
                          ) : null}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        value={l.cantidad}
                        disabled={soloLectura}
                        onChange={(e) => actualizar(l.codigo, "cantidad", Number(e.target.value) || 0)}
                        className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs text-ink"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.precio_unitario}
                        disabled={soloLectura}
                        onChange={(e) => actualizar(l.codigo, "precio_unitario", Number(e.target.value) || 0)}
                        className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs text-ink"
                      />
                    </td>
                    <td className="py-1.5 text-right text-muted">{c ? `${c.iva_pct ?? 0}%` : "…"}</td>
                    <td className="py-1.5 text-right font-semibold text-ink">{pesos(l.cantidad * l.precio_unitario)}</td>
                    <td className="py-1.5 text-right">
                      {!soloLectura && (
                        <button
                          type="button"
                          aria-label="Quitar"
                          onClick={() => onLineas((prev) => prev.filter((x) => x.codigo !== l.codigo))}
                          className="text-muted hover:text-danger"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
        <label className="text-xs font-semibold text-ink">
          Envío (sin IVA)
          <input
            type="number"
            min={0}
            step={500}
            value={envio}
            disabled={soloLectura}
            onChange={(e) => onEnvio(Number(e.target.value) || 0)}
            className="ml-2 w-28 rounded border border-border bg-surface px-1.5 py-1 text-right text-xs text-ink"
          />
        </label>
        <Totales calc={calc} compacto />
      </div>

      <div className="flex justify-between gap-2">
        <button type="button" className={btn} onClick={onAtras}>
          ← Cliente
        </button>
        <button type="button" className={btnPrimario} disabled={!habilitado || ocupado} onClick={onSiguiente}>
          {ocupado ? "Guardando…" : "Revisar →"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Piezas compartidas ─────────────────────────────── */

function Totales({ calc, compacto = false }: { calc: Calculo | null; compacto?: boolean }) {
  if (!calc) return <p className="text-xs text-muted">Sin totales todavía.</p>;
  return (
    <div className={`text-right text-sm ${compacto ? "" : "rounded-lg border border-border/70 p-3"}`}>
      <p className="text-xs text-muted">
        Base {pesos(calc.subtotal)} · IVA {pesos(calc.iva)}
        {calc.envio ? ` · envío ${pesos(calc.envio)}` : ""}
      </p>
      <p className="text-xl font-bold text-ink">{pesos(calc.total)}</p>
      <p className="text-[10px] text-muted">Total que paga el cliente</p>
    </div>
  );
}

function TablaResumen({ calc }: { calc: Calculo | null }) {
  if (!calc?.lineas.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
            <th className="py-1">Producto</th>
            <th className="py-1 text-right">Cant</th>
            <th className="py-1 text-right">Base</th>
            <th className="py-1 text-right">IVA</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {calc.lineas.map((l) => (
            <tr key={l.codigo || l.nombre}>
              <td className="py-1.5 text-ink">{l.nombre}</td>
              <td className="py-1.5 text-right">{l.cantidad}</td>
              <td className="py-1.5 text-right text-muted">{pesos(l.base)}</td>
              <td className="py-1.5 text-right text-muted">
                {pesos(l.iva)} <span className="text-[10px]">({l.iva_pct}%)</span>
              </td>
              <td className="py-1.5 text-right font-semibold text-ink">{pesos(l.total)}</td>
            </tr>
          ))}
          {calc.envio > 0 && (
            <tr>
              <td className="py-1.5 text-ink">Envío</td>
              <td className="py-1.5 text-right">1</td>
              <td className="py-1.5 text-right text-muted">{pesos(calc.envio)}</td>
              <td className="py-1.5 text-right text-muted">—</td>
              <td className="py-1.5 text-right font-semibold text-ink">{pesos(calc.envio)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
