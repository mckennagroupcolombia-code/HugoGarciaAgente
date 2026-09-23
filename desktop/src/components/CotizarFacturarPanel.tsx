import { Ico } from "../icons/Ico";
import { Icon } from "../icons/Icon";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { api, fetchAuthBlobUrl, postAuthBlobUrl } from "../api/client";
import { useAppStore } from "../stores/app";
import { usePantallaCompleta, soportaPantallaCompleta } from "../hooks/usePantallaCompleta";
import logotipo from "../assets/marca/logotipo-turquesa.png";

/**
 * Facturación → Cotizar/Facturar: módulo de venta directa.
 *
 * Reemplaza cotizar en la interfaz de Alegra, donde el IVA salía dos veces: la
 * lista de precios de Alegra ya trae el IVA incluido y Alegra le suma el 19%
 * encima. Aquí el precio que se escribe es SIEMPRE el que paga el cliente; el
 * backend (app/services/ventas_directas.py) saca el IVA línea por línea y le
 * manda a Alegra el precio base.
 *
 * Organización (23-sep-2026): el flujo normal es el de cualquier cotización —
 * 1 Cliente (con los datos que exige Alegra, y se crea ahí mismo en Alegra y en
 * el Libro Mayor) → 2 Productos → 3 Cotizar o facturar—, con la cotización
 * dibujándose a la derecha mientras se llena. Traer datos de un chat de
 * WhatsApp, de una venta de Mercado Libre o de un pedido del agente IA es una
 * HERRAMIENTA dentro de los pasos («Completar desde…»), no la puerta de
 * entrada: antes el paso 1 obligaba a elegir un «origen» y confundía.
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

/** Cliente enlazado con Alegra en esta sesión (buscado o recién creado). */
interface EnlaceAlegra {
  id: string;
  /** Identificación (solo dígitos) con la que quedó enlazado: si cambia, el enlace ya no vale. */
  ident: string;
  como: "existente" | "creado" | "encontrado";
  tercero: boolean;
}

const PASOS = [
  { id: 1, label: "Cliente", ayuda: "a quién le vendemos" },
  { id: 2, label: "Productos", ayuda: "qué lleva y a qué precio" },
  { id: 3, label: "Cotizar o facturar", ayuda: "enviar al cliente" },
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
const VIGENCIA_DIAS = 15;

const input =
  "w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-70";
const card = "rounded-xl border border-border bg-surface-panel p-4";
const btn =
  "rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimario =
  "rounded-paper border-2 border-accent bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const btnHerramienta =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-accent/60 hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-white";

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

const soloDigitos = (s: string) => s.replace(/\D/g, "");

/** Dígito de verificación del NIT con el algoritmo de la DIAN (mismo que `empresa.digito_verificacion`). */
function digitoVerificacion(base: string): number | null {
  const d = soloDigitos(base);
  if (!d || d.length > 15) return null;
  const pesosDian = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let suma = 0;
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * pesosDian[i];
  const r = suma % 11;
  return r >= 2 ? 11 - r : r;
}

/** Lectura del NIT tal como lo escribió el operador: base, DV y si cuadra. */
function leerNit(crudo: string): { base: string; dv: number | null; escrito: number | null; ok: boolean | null } {
  const t = crudo.trim();
  if (t.includes("-")) {
    const i = t.lastIndexOf("-");
    const base = soloDigitos(t.slice(0, i));
    const esc = soloDigitos(t.slice(i + 1));
    const dv = digitoVerificacion(base);
    return { base, dv, escrito: esc ? Number(esc) : null, ok: esc ? dv === Number(esc) : null };
  }
  const d = soloDigitos(t);
  if (d.length === 10) {
    // Como lo entrega MeLi: base de 9 + DV pegado.
    const dv = digitoVerificacion(d.slice(0, 9));
    if (dv === Number(d[9])) return { base: d.slice(0, 9), dv, escrito: dv, ok: true };
  }
  return { base: d, dv: digitoVerificacion(d), escrito: null, ok: null };
}

function useDebounced<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms]);
  return v;
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

/* ═══════════════════════════════ Módulo ═══════════════════════════════ */

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
  const [enlace, setEnlace] = useState<EnlaceAlegra | null>(null);

  const [calc, setCalc] = useState<Calculo | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [confirmarFactura, setConfirmarFactura] = useState(false);
  const [pendientes, setPendientes] = useState<ProductoExtraido[]>([]);
  const [importado, setImportado] = useState<string | null>(null);
  const [verRecientes, setVerRecientes] = useState(false);
  const [verPreviaMovil, setVerPreviaMovil] = useState(false);

  // Sin menú superior / pantalla completa: para trabajar la cotización con todo el espacio.
  const enfoque = useAppStore((s) => s.cotizarEnfoque);
  const setEnfoque = useAppStore((s) => s.setCotizarEnfoque);
  const { activa: pantallaCompleta, alternar: alternarPantalla } = usePantallaCompleta();
  useEffect(() => () => setEnfoque(false), [setEnfoque]);
  useEffect(() => {
    if (!enfoque) return;
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !document.fullscreenElement && !verRecientes) setEnfoque(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [enfoque, setEnfoque, verRecientes]);

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
    setEnlace(null);
    setCalc(null);
    setError(null);
    setAvisos([]);
    setConfirmarFactura(false);
    setPendientes([]);
    setImportado(null);
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
  const firmaCalculo = useDebounced(
    JSON.stringify({ lineas: lineas.map(({ codigo, cantidad, precio_unitario }) => ({ codigo, cantidad, precio_unitario })), envio }),
    350,
  );
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

  async function irAPaso(a: number) {
    setError(null);
    if (a === 3 && !soloLectura) {
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
  const pasoHabilitado = (id: number) => id === 1 || (id === 2 && clienteOk) || (id === 3 && clienteOk && productosOk);
  const enlaceVigente = enlace && enlace.ident === soloDigitos(leerNit(cliente.identificacion).base || cliente.identificacion) ? enlace : null;

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
      const r = await api.post<{ venta: Venta; avisos: string[] }>(
        `/api/ventas-directas/${v.id}/facturar`,
        { medio_pago: medioPago },
        // Una venta de MeLi revisa antes en Alegra que no exista otra factura (~30 s).
        { timeoutMs: origen === "meli" ? 150_000 : 90_000 },
      );
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

  async function verPdfEnviado() {
    if (!ventaId) return;
    const url = await fetchAuthBlobUrl(`/api/ventas-directas/${ventaId}/pdf`);
    if (url) window.open(url, "_blank", "noopener");
    else setError("No se encontró el PDF de la cotización.");
  }

  async function verPdfExacto() {
    setOcupado("previa");
    const r = await postAuthBlobUrl("/api/ventas-directas/vista-previa.pdf", {
      numero: venta?.numero || "",
      cliente,
      telefono,
      lineas,
      envio,
      notas,
    });
    setOcupado(null);
    if ("url" in r) window.open(r.url, "_blank", "noopener");
    else setError(r.error);
  }

  /* ── Completar desde otra fuente: solo llena lo que está vacío ── */

  function usarConversacion(datos: DatosConversacion) {
    const llenos: string[] = [];
    const n = { ...cliente };
    const campos: [keyof Cliente, string, string][] = [
      ["nombre", datos.cliente.nombre, "nombre"],
      ["identificacion", datos.cliente.identificacion, "documento"],
      ["correo", datos.cliente.correo, "correo"],
      ["direccion", datos.cliente.direccion, "dirección"],
    ];
    for (const [k, v, etiqueta] of campos) {
      if (!String(n[k] ?? "").trim() && v?.trim()) {
        (n[k] as string) = v.trim();
        llenos.push(etiqueta);
      }
    }
    setCliente(n);
    if (datos.telefono && !telefono) {
      setTelefono(datos.telefono);
      llenos.push("WhatsApp");
    }
    if (datos.notas && !notas) setNotas(datos.notas);
    const nuevas = datos.lineas.filter((l) => !lineas.some((p) => p.codigo === l.codigo));
    setLineas((prev) => [...prev, ...nuevas.filter((l) => !prev.some((p) => p.codigo === l.codigo))]);
    setPendientes((prev) => [...prev, ...datos.pendientes]);
    if (origen === "manual") {
      setOrigen("conversacion");
      setOrigenRef(datos.ref);
    }
    const partes = [
      llenos.length ? `se completaron ${llenos.join(", ")}` : "los datos del cliente ya estaban llenos",
      nuevas.length ? `${nuevas.length} producto(s) agregado(s)` : "",
      datos.pendientes.length ? `${datos.pendientes.length} producto(s) por confirmar en el paso 2` : "",
    ].filter(Boolean);
    setImportado(`Del chat: ${partes.join(" · ")}.`);
  }

  function usarMeli(d: VentaMeli) {
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
    setImportado(`Venta de Mercado Libre ${d.pack_id}: comprador y ${d.lineas.length} producto(s) cargados. Compáralos con el RUT.`);
  }

  const vence = new Date(Date.now() + VIGENCIA_DIAS * 86_400_000).toLocaleDateString("es-CO");

  return (
    <div className={`mx-auto w-full space-y-3 ${enfoque ? "max-w-[1600px] px-3 py-3 sm:px-5" : "max-w-7xl"}`}>
      {/* ── Barra del módulo ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-bold tracking-tight text-ink">Cotizar / Facturar</h2>
          {venta ? (
            <>
              <span className="font-mono text-xs font-semibold text-ink">{venta.numero}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_UI[venta.estado].cls}`}>
                {ESTADO_UI[venta.estado].label}
              </span>
              {venta.alegra_cotizacion_numero && <span className="text-[11px] text-muted">Alegra #{venta.alegra_cotizacion_numero}</span>}
              {venta.factura_numero && <span className="text-[11px] text-muted">Factura {venta.factura_numero}</span>}
            </>
          ) : (
            <span className="text-[11px] text-muted">Venta nueva · el precio que escribes es el que paga el cliente, con IVA</span>
          )}
          {origen === "meli" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">MeLi {origenRef}</span>}
          {origen === "pedido_ia" && <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-muted">pedido IA #{origenRef}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={btnHerramienta} onClick={() => setVerRecientes(true)}>
            <Icon name="clock" size={14} weight="bold" /> Ventas recientes
          </button>
          {(ventaId || clienteOk || lineas.length > 0) && (
            <button type="button" className={btnHerramienta} onClick={reiniciar}>
              <Icon name="plus" size={14} weight="bold" /> Nueva
            </button>
          )}
          <button
            type="button"
            className={btnHerramienta}
            aria-pressed={enfoque}
            onClick={() => setEnfoque(!enfoque)}
            title={enfoque ? "Volver a mostrar el menú de la app (Esc)" : "Ocultar el menú de la app y trabajar con todo el espacio"}
          >
            <Icon name={enfoque ? "collapse" : "menu"} size={14} weight="bold" /> {enfoque ? "Mostrar menú" : "Ocultar menú"}
          </button>
          {soportaPantallaCompleta() && (
            <button
              type="button"
              className={btnHerramienta}
              aria-pressed={pantallaCompleta}
              onClick={() => void alternarPantalla()}
              title="Pantalla completa del navegador (F11)"
            >
              <Icon name="expand" size={14} weight="bold" /> {pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
            </button>
          )}
        </div>
      </div>

      {/* ── Pasos ── */}
      <ol className="grid grid-cols-3 gap-2" aria-label="Pasos">
        {PASOS.map((p) => {
          const activo = p.id === paso;
          const hecho = p.id < paso || venta?.estado === "facturada";
          const habil = pasoHabilitado(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!habil}
                aria-current={activo ? "step" : undefined}
                onClick={() => void irAPaso(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  activo ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-border bg-surface-panel hover:border-accent/60"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                    hecho ? "bg-accent text-white" : activo ? "bg-accent/15 text-accent" : "bg-surface-hover text-muted"
                  }`}
                >
                  {hecho ? "✓" : p.id}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink">{p.label}</span>
                  <span className="hidden truncate text-[11px] text-muted sm:block">{p.ayuda}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          <Icon name="xCircle" size={18} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1">{error}</p>
          <button type="button" aria-label="Cerrar" className="shrink-0 text-xs underline" onClick={() => setError(null)}>
            cerrar
          </button>
        </div>
      )}

      {/* ── Trabajo a la izquierda, cotización a la derecha ── */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] 2xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-3">
          {importado && (
            <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink">
              <Icon name="check" size={14} weight="bold" className="mt-0.5 shrink-0 text-accent" />
              <p className="min-w-0 flex-1">{importado}</p>
              <button type="button" className="shrink-0 text-muted underline" onClick={() => setImportado(null)}>
                ok
              </button>
            </div>
          )}

          {paso === 1 && (
            <>
              {origen === "meli" && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  <Ico e="🧾" /> Venta de Mercado Libre {origenRef}: los datos vienen de la facturación que el comprador cargó en
                  MeLi. Compáralos con el RUT que envió y escribe el <b>correo</b> del RUT (MeLi no lo entrega). La factura queda
                  ligada a la venta, se sube a MeLi y «Facturar ahora» ya no emite otra.
                </p>
              )}
              <PasoCliente
                cliente={cliente}
                telefono={telefono}
                soloLectura={soloLectura}
                enlace={enlaceVigente}
                onEnlace={setEnlace}
                onCliente={setCliente}
                onTelefono={setTelefono}
              />
              {!soloLectura && (
                <CompletarDesde
                  onConversacion={usarConversacion}
                  onMeli={usarMeli}
                  onPedido={(v) => {
                    cargarVenta(v, 3);
                    setImportado(`Pedido del agente IA cargado: ${v.cliente?.nombre || "cliente"} · ${v.lineas.length} producto(s).`);
                  }}
                />
              )}
              <div className="flex justify-end">
                <button type="button" className={btnPrimario} disabled={!clienteOk} onClick={() => void irAPaso(2)}>
                  Continuar a productos →
                </button>
              </div>
            </>
          )}

          {paso === 2 && (
            <>
              <PasoProductos
                lineas={lineas}
                calc={calc}
                envio={envio}
                soloLectura={soloLectura}
                onLineas={setLineas}
                onEnvio={setEnvio}
                pendientes={pendientes}
                onPendientes={setPendientes}
                onAtras={() => setPaso(1)}
                onSiguiente={() => void irAPaso(3)}
                habilitado={productosOk}
                ocupado={ocupado === "guardar"}
              />
              {!soloLectura && (
                <CompletarDesde
                  soloChat
                  onConversacion={usarConversacion}
                  onMeli={usarMeli}
                  onPedido={(v) => cargarVenta(v, 3)}
                />
              )}
            </>
          )}

          {paso === 3 && (
            <PasoEnviar
              venta={venta}
              cliente={cliente}
              calc={calc}
              notas={notas}
              onNotas={setNotas}
              medioPago={medioPago}
              onMedioPago={setMedioPago}
              soloLectura={soloLectura}
              ocupado={ocupado}
              puedeCotizar={clienteOk && productosOk}
              puedeFacturar={puedeFacturar}
              confirmarFactura={confirmarFactura}
              onCancelarFactura={() => setConfirmarFactura(false)}
              onCotizar={() => void cotizar()}
              onFacturar={() => void facturar()}
              onVerPdf={() => void verPdfEnviado()}
              onAnular={() => void anular()}
              onAtras={() => setPaso(2)}
              avisos={avisos}
            />
          )}
        </div>

        {/* Vista previa: al lado en pantallas anchas; plegable en el celular. */}
        <aside className="min-w-0 lg:sticky lg:top-2">
          <button
            type="button"
            className={`${btn} mb-2 w-full lg:hidden`}
            onClick={() => setVerPreviaMovil((v) => !v)}
            aria-expanded={verPreviaMovil}
          >
            {verPreviaMovil ? "Ocultar la cotización" : `Ver cómo va la cotización · ${pesos(calc?.total)}`}
          </button>
          <div className={`${verPreviaMovil ? "block" : "hidden"} lg:block`}>
            <VistaPrevia
              numero={venta?.numero || ""}
              vence={vence}
              cliente={cliente}
              telefono={telefono}
              lineas={lineas}
              calc={calc}
              notas={notas}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">Así la recibe el cliente. El PDF usa exactamente estos datos.</p>
              <button
                type="button"
                className={btnHerramienta}
                disabled={!clienteOk || ocupado === "previa"}
                onClick={() => void verPdfExacto()}
              >
                <Icon name="eye" size={14} weight="bold" /> {ocupado === "previa" ? "Generando…" : "Ver PDF exacto"}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {verRecientes && (
        <PanelRecientes
          onCerrar={() => setVerRecientes(false)}
          onVenta={(v) => {
            setEnlace(null);
            setImportado(null);
            cargarVenta(v, v.estado === "borrador" ? 2 : 3);
            setVerRecientes(false);
          }}
          onPedido={(v) => {
            setEnlace(null);
            cargarVenta(v, 3);
            setImportado(`Pedido del agente IA cargado: ${v.cliente?.nombre || "cliente"} · ${v.lineas.length} producto(s).`);
            setVerRecientes(false);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════ Paso 1 · Cliente ═══════════════════════════════ */

function Campo({ label, ayuda, requerido, children, className = "" }: { label: string; ayuda?: ReactNode; requerido?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold text-ink">
        <span>
          {label}
          {requerido && <span className="ml-0.5 text-accent">*</span>}
        </span>
        {ayuda && <span className="truncate text-[10px] font-normal text-muted">{ayuda}</span>}
      </span>
      {children}
    </label>
  );
}

function PasoCliente({
  cliente,
  telefono,
  soloLectura,
  enlace,
  onEnlace,
  onCliente,
  onTelefono,
}: {
  cliente: Cliente;
  telefono: string;
  soloLectura: boolean;
  enlace: EnlaceAlegra | null;
  onEnlace: (e: EnlaceAlegra | null) => void;
  onCliente: (c: Cliente) => void;
  onTelefono: (t: string) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ClienteResultado[] | null>(null);
  const q = useDebounced(busqueda.trim(), 250);
  const [creando, setCreando] = useState(false);
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  useEffect(() => {
    if (q.length < 2) return setResultados(null);
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
  const tipo = (cliente.tipo_documento || "").toUpperCase();
  const esEmpresa = tipo === "NIT";
  const nit = esEmpresa ? leerNit(cliente.identificacion) : null;
  const docOk = cliente.identificacion.trim().length > 0 && !(nit && nit.ok === false);
  const correoOk = /.+@.+\..+/.test(cliente.correo.trim());
  const puedeGuardar = !soloLectura && cliente.nombre.trim().length > 0 && docOk;

  async function guardarEnAlegra() {
    setCreando(true);
    setErrorAlta(null);
    try {
      const r = await api.post<{
        ok: boolean;
        error?: string;
        cliente?: Cliente & { telefono?: string };
        alegra_id?: string;
        alegra_creado?: boolean;
        tercero_id?: number | null;
        avisos?: string[];
      }>("/api/ventas-directas/clientes", { ...cliente, telefono });
      if (!r.ok || !r.alegra_id) throw new Error(r.error || "No se pudo guardar el cliente.");
      let actualizado = cliente;
      if (r.cliente) {
        const { telefono: _tel, ...datos } = r.cliente;
        void _tel;
        actualizado = { ...cliente, ...datos };
        onCliente(actualizado);
      }
      onEnlace({
        id: r.alegra_id,
        ident: soloDigitos(leerNit(actualizado.identificacion).base || actualizado.identificacion),
        como: r.alegra_creado ? "creado" : "encontrado",
        tercero: Boolean(r.tercero_id),
      });
      if (r.avisos?.length) setErrorAlta(r.avisos.join(" · "));
    } catch (e) {
      setErrorAlta((e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  function elegir(c: ClienteResultado) {
    const d = soloDigitos(c.identificacion);
    const pareceNit = d.length >= 9 && /^[89]/.test(d);
    onCliente({
      ...cliente,
      nombre: c.nombre,
      identificacion: c.identificacion,
      tipo_documento: cliente.tipo_documento || (pareceNit ? "NIT" : "CC"),
      correo: c.email || cliente.correo,
      direccion: c.direccion || cliente.direccion,
    });
    if (c.telefono && !telefono) onTelefono(c.telefono);
    onEnlace({ id: String(c.id), ident: soloDigitos(leerNit(c.identificacion).base || c.identificacion), como: "existente", tercero: false });
    setBusqueda("");
  }

  return (
    <div className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">¿A quién le vendemos?</p>
          <p className="text-xs text-muted">Busca el cliente en Alegra. Si no existe, llena sus datos y guárdalo: queda en Alegra y en el Libro Mayor.</p>
        </div>
        <EstadoAlegra enlace={enlace} />
      </div>

      {!soloLectura && (
        <div className="relative">
          <div className="flex items-center gap-2">
            <Icon name="search" size={18} className="shrink-0 text-muted" />
            <input
              id="cf-buscar-cliente"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar en Alegra por nombre, cédula o NIT…"
              className={input}
            />
          </div>
          {resultados !== null && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
              {resultados.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-muted">
                  No está en Alegra. Llena los datos de abajo y pulsa <b>Guardar cliente en Alegra</b>.
                </p>
              ) : (
                resultados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => elegir(c)}
                    className="flex w-full items-baseline justify-between gap-3 border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 hover:bg-surface-hover"
                  >
                    <span className="min-w-0 truncate font-semibold text-ink">{c.nombre}</span>
                    <span className="shrink-0 font-mono text-muted">{c.identificacion}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <fieldset disabled={soloLectura} className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink">
            Tipo de cliente <span className="font-normal text-muted">· define cómo lo registra Alegra ante la DIAN</span>
          </p>
          <div className="inline-flex rounded-paper border-2 border-border p-0.5" role="radiogroup" aria-label="Tipo de cliente">
            {[
              { id: "NIT", label: "Empresa", sub: "NIT" },
              { id: "CC", label: "Persona natural", sub: "cédula" },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={tipo === o.id}
                onClick={() => onCliente({ ...cliente, tipo_documento: tipo === o.id ? "" : o.id })}
                className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold transition ${
                  tipo === o.id ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                {o.label} <span className="font-normal opacity-80">· {o.sub}</span>
              </button>
            ))}
          </div>
          {!tipo && <p className="mt-1 text-[11px] text-muted">Sin elegir, se deduce del nombre (S.A.S, LTDA…) y del número.</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo
            label={esEmpresa ? "NIT" : tipo === "CC" ? "Cédula" : "Cédula o NIT"}
            requerido
            ayuda={esEmpresa ? "con o sin dígito de verificación" : "obligatorio para facturar"}
          >
            <input
              id="cf-identificacion"
              value={cliente.identificacion}
              onChange={set("identificacion")}
              inputMode="numeric"
              placeholder={esEmpresa ? "Ej.: 900409216-6" : "Ej.: 1013630698"}
              className={`${input} font-mono ${nit?.ok === false ? "border-red-400 focus:border-red-500" : ""}`}
            />
            {nit && nit.base && nit.dv !== null && (
              <span
                className={`mt-1 block text-[11px] ${
                  nit.ok === false ? "text-red-600 dark:text-red-400" : nit.ok ? "text-green-700 dark:text-green-400" : "text-muted"
                }`}
              >
                {nit.ok === false
                  ? `El dígito de verificación de ${nit.base} es ${nit.dv}, no ${nit.escrito}. Revísalo en el RUT.`
                  : nit.ok
                    ? `NIT ${nit.base}-${nit.dv} · dígito de verificación correcto`
                    : `Dígito de verificación: ${nit.dv} → ${nit.base}-${nit.dv}`}
              </span>
            )}
          </Campo>
          <Campo label={esEmpresa ? "Razón social" : tipo === "CC" ? "Nombres y apellidos" : "Nombre o razón social"} requerido ayuda="tal como aparece en el RUT o la cédula">
            <input id="cf-nombre" value={cliente.nombre} onChange={set("nombre")} placeholder={esEmpresa ? "Ej.: Laboratorios Andinos S.A.S." : "Ej.: Juan Pérez Gómez"} className={input} />
          </Campo>
          <Campo label="Correo para la factura electrónica" ayuda={correoOk ? undefined : "recomendado: la DIAN la envía aquí"}>
            <input id="cf-correo" type="email" value={cliente.correo} onChange={set("correo")} placeholder="Ej.: facturacion@empresa.com" className={input} />
          </Campo>
          <Campo label="WhatsApp" ayuda="opcional · para enviarle el PDF">
            <input
              id="cf-whatsapp"
              value={telefono.includes("@") ? telefonoVisible(telefono) : telefono}
              onChange={(e) => onTelefono(e.target.value)}
              disabled={soloLectura || telefono.includes("@")}
              title={telefono.includes("@") ? "Se responde en el mismo chat donde el cliente hizo el pedido" : undefined}
              placeholder="Ej.: 300 123 4567"
              inputMode="tel"
              className={input}
            />
          </Campo>
          <Campo label="Dirección" ayuda="opcional · para el despacho">
            <input id="cf-direccion" value={cliente.direccion} onChange={set("direccion")} placeholder="Ej.: Cra 71 D # 49 A - 28" className={input} />
          </Campo>
          <Campo label="Ciudad" ayuda="opcional">
            <input id="cf-ciudad" value={cliente.ciudad} onChange={set("ciudad")} placeholder="Ej.: Bogotá D.C." className={input} />
          </Campo>
        </div>
      </fieldset>

      {/* Qué falta para cada acción, sin tener que adivinar. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-[11px]">
        <Requisito ok={cliente.nombre.trim().length > 0}>Para cotizar: nombre</Requisito>
        <Requisito ok={cliente.nombre.trim().length > 0 && docOk}>Para facturar: nombre y documento válido</Requisito>
        <Requisito ok={correoOk} opcional>
          Correo para recibir la factura
        </Requisito>
      </div>

      {!soloLectura && !enlace && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-hover/60 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-muted">
            Guardarlo ahora crea el contacto en Alegra con el tipo de documento correcto y el tercero en el Libro Mayor, para que
            la venta se contabilice a su nombre al facturar. Si ya existe, lo reutiliza.
          </p>
          <button type="button" className={btnPrimario} disabled={!puedeGuardar || creando} onClick={() => void guardarEnAlegra()}>
            {creando ? "Guardando…" : "Guardar cliente en Alegra"}
          </button>
        </div>
      )}
      {errorAlta && <p className="text-xs text-red-600 dark:text-red-400">{errorAlta}</p>}
    </div>
  );
}

function Requisito({ ok, opcional, children }: { ok: boolean; opcional?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-green-700 dark:text-green-400" : opcional ? "text-muted" : "text-amber-700 dark:text-amber-400"}`}>
      <span aria-hidden="true">{ok ? "✓" : opcional ? "○" : "•"}</span>
      {children}
    </span>
  );
}

function EstadoAlegra({ enlace }: { enlace: EnlaceAlegra | null }) {
  if (!enlace) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted">
        <span className="h-2 w-2 rounded-full bg-muted/50" /> Sin guardar en Alegra
      </span>
    );
  }
  const texto =
    enlace.como === "creado" ? "Creado en Alegra" : enlace.como === "encontrado" ? "Ya estaba en Alegra" : "Cliente de Alegra";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
      title={
        enlace.tercero
          ? "Contacto de Alegra y tercero del Libro Mayor listos"
          : "El tercero del Libro Mayor se registra solo al cotizar o facturar"
      }
    >
      <span className="h-2 w-2 rounded-full bg-green-600" /> {texto} · #{enlace.id}
      {enlace.tercero ? " · Libro Mayor ✓" : ""}
    </span>
  );
}

/* ═══════════════════════════ Completar desde otra fuente ═══════════════════════════ */

type Fuente = "whatsapp" | "meli" | "pedido";

function CompletarDesde({
  onConversacion,
  onMeli,
  onPedido,
  soloChat = false,
}: {
  onConversacion: (d: DatosConversacion) => void;
  onMeli: (d: VentaMeli) => void;
  onPedido: (v: Venta) => void;
  /** En el paso de productos solo tiene sentido el chat (traer lo que pidió). */
  soloChat?: boolean;
}) {
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [conversaciones, setConversaciones] = useState<ConversacionWA[] | null>(null);
  const [texto, setTexto] = useState("");
  const [refMeli, setRefMeli] = useState("");
  const [pedidos, setPedidos] = useState<PedidoIA[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fuente === "whatsapp" && conversaciones === null) {
      api
        .get<{ items: ConversacionWA[] }>("/api/facturacion/conversaciones-wa?limit=40")
        .then((r) => setConversaciones(r.items ?? []))
        .catch(() => setConversaciones([]));
    }
    if (fuente === "pedido" && pedidos === null) {
      api
        .get<{ pedidos: PedidoIA[] }>("/api/ventas-directas/pedidos-ia")
        .then((r) => setPedidos(r.pedidos))
        .catch(() => setPedidos([]));
    }
  }, [fuente, conversaciones, pedidos]);

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
      onConversacion({
        ref,
        cliente: { ...CLIENTE_VACIO, ...(c ?? {}) },
        telefono: telefono || (c?.telefono ?? ""),
        notas: data.notas ?? "",
        lineas,
        pendientes: porConfirmar,
      });
      setFuente(null);
      setTexto("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function traerMeli() {
    setOcupado("meli");
    setError(null);
    try {
      const d = await api.get<VentaMeli>(`/api/ventas-directas/meli/${encodeURIComponent(soloDigitos(refMeli))}`, { timeoutMs: 60_000 });
      if (!d.ok) throw new Error(d.error || "No se pudo leer la venta de MeLi.");
      if (d.bloqueo) throw new Error(d.bloqueo);
      onMeli(d);
      setFuente(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

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

  const fuentes: { id: Fuente; label: string; icono: "chat" | "receipt" | "robot" }[] = soloChat
    ? [{ id: "whatsapp", label: "Traer productos de un chat de WhatsApp", icono: "chat" }]
    : [
        { id: "whatsapp", label: "Chat de WhatsApp", icono: "chat" },
        { id: "meli", label: "Venta de Mercado Libre", icono: "receipt" },
        { id: "pedido", label: "Pedido del agente IA", icono: "robot" },
      ];
  const abiertos = (pedidos ?? []).filter((p) => !p.venta_directa || p.venta_directa.estado !== "facturada");

  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-panel/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">{soloChat ? "¿El pedido llegó por chat?" : "Completar desde:"}</span>
        {fuentes.map((f) => (
          <button
            key={f.id}
            type="button"
            className={btnHerramienta}
            aria-pressed={fuente === f.id}
            onClick={() => setFuente(fuente === f.id ? null : f.id)}
          >
            <Icon name={f.icono} size={14} weight="bold" /> {f.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {fuente === "whatsapp" && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold text-ink">Chats recientes</p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border/70 bg-surface">
              {conversaciones === null && <p className="px-3 py-2 text-xs text-muted">Cargando…</p>}
              {conversaciones?.length === 0 && <p className="px-3 py-2 text-xs text-muted">Sin conversaciones recientes.</p>}
              {conversaciones?.map((c) => (
                <button
                  key={c.usuario_id}
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => void extraer({ usuario_id: c.usuario_id }, soloDigitos(c.telefono), c.usuario_id)}
                  className="block w-full border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 hover:bg-surface-hover disabled:opacity-50"
                >
                  <span className="flex justify-between gap-2">
                    <span className="font-semibold text-ink">{telefonoVisible(c.telefono)}</span>
                    <span className="text-[10px] text-muted">{hace(c.ultimo.includes("T") ? c.ultimo : `${c.ultimo.replace(" ", "T")}Z`)}</span>
                  </span>
                  {c.resumen && <span className="block truncate text-muted">{c.resumen}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            <p className="mb-1 text-[11px] font-semibold text-ink">…o pega el texto del chat</p>
            <textarea
              id="cf-texto-chat"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={6}
              placeholder="Pega aquí la conversación con el cliente"
              className={`${input} flex-1 text-xs`}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted">Usa IA (unos pocos pesos por chat). Solo llena lo que esté vacío.</span>
              <button type="button" className={btn} disabled={!texto.trim() || ocupado !== null} onClick={() => void extraer({ texto })}>
                {ocupado === "extraer" ? "Leyendo…" : "Extraer datos"}
              </button>
            </div>
          </div>
          {ocupado === "extraer" && <p className="text-xs text-muted md:col-span-2">Leyendo la conversación…</p>}
        </div>
      )}

      {fuente === "meli" && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted">
            Para empresas que compraron en Mercado Libre y enviaron el RUT: trae comprador y productos, y liga la factura a esa
            venta (no se duplica con «Facturar ahora»).
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              id="cf-ref-meli"
              value={refMeli}
              onChange={(e) => setRefMeli(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && soloDigitos(refMeli) && void traerMeli()}
              placeholder="Venta # (pack u orden, ej. 2000015079567449)"
              className={`${input} min-w-0 flex-1 font-mono`}
            />
            <button type="button" className={btn} disabled={ocupado !== null || !soloDigitos(refMeli)} onClick={() => void traerMeli()}>
              {ocupado === "meli" ? "Consultando…" : "Traer de MeLi"}
            </button>
          </div>
        </div>
      )}

      {fuente === "pedido" && (
        <div className="mt-3">
          {pedidos === null ? (
            <p className="text-xs text-muted">Cargando…</p>
          ) : abiertos.length === 0 ? (
            <p className="text-xs text-muted">
              No hay pedidos del agente IA por facturar. Mientras el agente de WhatsApp esté en modo sombra, sus borradores no
              aparecen aquí: el cliente nunca los vio.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {abiertos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() => void usarPedido(p)}
                  className="rounded-lg border border-border/70 bg-surface p-3 text-left text-xs transition hover:border-accent disabled:opacity-50"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{p.cliente?.nombre || p.display}</span>
                    <span className="text-[10px] text-muted">{hace(p.actualizado)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-muted">{p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(" · ")}</span>
                  <span className="mt-1 flex items-center justify-between">
                    <span className="font-bold text-ink">{pesos(p.total ?? p.subtotal)}</span>
                    {p.faltantes.length > 0 ? (
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">falta: {p.faltantes.join(", ")}</span>
                    ) : (
                      <span className="text-[10px] text-green-700 dark:text-green-400">datos completos</span>
                    )}
                  </span>
                  {ocupado === `p${p.id}` && <span className="mt-1 block text-muted">Armando…</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════ Paso 3 · Enviar ═══════════════════════════════ */

function PasoEnviar({
  venta,
  cliente,
  calc,
  notas,
  onNotas,
  medioPago,
  onMedioPago,
  soloLectura,
  ocupado,
  puedeCotizar,
  puedeFacturar,
  confirmarFactura,
  onCancelarFactura,
  onCotizar,
  onFacturar,
  onVerPdf,
  onAnular,
  onAtras,
  avisos,
}: {
  venta: Venta | null;
  cliente: Cliente;
  calc: Calculo | null;
  notas: string;
  onNotas: (n: string) => void;
  medioPago: string;
  onMedioPago: (m: string) => void;
  soloLectura: boolean;
  ocupado: string | null;
  puedeCotizar: boolean;
  puedeFacturar: boolean;
  confirmarFactura: boolean;
  onCancelarFactura: () => void;
  onCotizar: () => void;
  onFacturar: () => void;
  onVerPdf: () => void;
  onAnular: () => void;
  onAtras: () => void;
  avisos: string[];
}) {
  return (
    <div className="space-y-3">
      <div className={card}>
        <Campo label="Notas para el cliente" ayuda="salen en la cotización">
          <textarea
            id="cf-notas"
            value={notas}
            disabled={soloLectura}
            onChange={(e) => onNotas(e.target.value)}
            placeholder="Tiempo de entrega, descuento acordado, condiciones especiales…"
            rows={2}
            className={input}
          />
        </Campo>
        {calc && calc.sin_alegra.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <Ico e="⚠️" /> No existen en Alegra: {calc.sin_alegra.join(", ")}. Se puede cotizar (solo PDF), pero no facturar.
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${card} flex flex-col gap-3`}>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Icon name="file" size={16} /> Cotizar
            </p>
            <p className="mt-1 text-xs text-muted">
              PDF sin efecto ante la DIAN, válido {VIGENCIA_DIAS} días. Se envía al WhatsApp del cliente y queda registrado en
              Alegra{cliente.identificacion ? "" : " (esto último solo si hay documento)"}.
            </p>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimario} disabled={ocupado !== null || soloLectura || !puedeCotizar} onClick={onCotizar}>
              {ocupado === "cotizar" ? "Enviando…" : venta?.estado === "cotizada" ? "Reenviar cotización" : "Enviar cotización"}
            </button>
            {(venta?.estado === "cotizada" || venta?.alegra_cotizacion_numero) && (
              <button type="button" className="text-xs text-muted underline" onClick={onVerPdf}>
                Ver PDF enviado
              </button>
            )}
          </div>
        </div>

        <div className={`${card} flex flex-col gap-3`}>
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <Icon name="receipt" size={16} /> Facturar <span className="text-xs font-normal text-muted">· el cliente ya pagó</span>
          </p>
          {venta?.estado === "facturada" ? (
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-green-700 dark:text-green-400">✓ Factura {venta.factura_numero} emitida</p>
              <p className="text-xs text-muted">
                {venta.enviado_whatsapp ? "Enviada por WhatsApp al cliente." : "Revisa el envío al cliente."} La venta quedó causada en
                el Libro Mayor a nombre del cliente.
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
                Factura electrónica ante la DIAN; se contabiliza en el Libro Mayor al emitirse. Solo se corrige con nota crédito:
                confirma el pago antes.
              </p>
              <Campo label="¿Cómo pagó?">
                <select id="cf-medio-pago" value={medioPago} onChange={(e) => onMedioPago(e.target.value)} disabled={soloLectura} className={input}>
                  {MEDIOS_PAGO.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Campo>
              {!cliente.identificacion.trim() && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Falta el documento del cliente (paso 1).</p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!puedeFacturar || ocupado !== null || soloLectura}
                  onClick={onFacturar}
                  className={`rounded-paper border-2 px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    confirmarFactura
                      ? "border-red-500 bg-red-500 text-white hover:bg-red-600"
                      : "border-border text-ink hover:border-red-400 hover:text-red-600"
                  }`}
                >
                  {ocupado === "facturar" ? "Facturando…" : confirmarFactura ? `Confirmar factura DIAN por ${pesos(calc?.total)}` : "Facturar"}
                </button>
                {confirmarFactura && (
                  <button type="button" onClick={onCancelarFactura} className="text-xs text-muted underline">
                    Cancelar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {avisos.length > 0 && (
        <div className="rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {avisos.map((a) => (
            <p key={a}>
              <Ico e="⚠️" /> {a}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={btn} onClick={onAtras}>
          ← Productos
        </button>
        {venta && venta.estado !== "facturada" && venta.estado !== "anulada" && venta.estado !== "facturando" && (
          <button type="button" className="text-xs text-muted underline hover:text-red-600" onClick={onAnular}>
            Anular esta venta
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Vista previa ═══════════════════════════════ */

/** Réplica en HTML del PDF (app/tools/cotizacion_pdf.py): mismos colores de la
 * web, mismo logotipo y mismo orden. Es papel: se ve igual en tema claro u oscuro. */
function VistaPrevia({
  numero,
  vence,
  cliente,
  telefono,
  lineas,
  calc,
  notas,
}: {
  numero: string;
  vence: string;
  cliente: Cliente;
  telefono: string;
  lineas: Linea[];
  calc: Calculo | null;
  notas: string;
}) {
  // El cálculo solo recibe código, cantidad y precio: el nombre sale de las líneas.
  const nombres = new Map(lineas.map((l) => [l.codigo, l.nombre]));
  const filas = calc?.lineas.length ? calc.lineas.map((l) => ({ ...l, nombre: nombres.get(l.codigo) || l.nombre })) : lineas;
  const envio = calc?.envio ?? 0;
  const vacio = <span className="italic text-[#9bb8bc]">—</span>;
  const tel = telefono && !telefono.includes("@") ? telefonoVisible(telefono) : "";
  const pct = (v?: number) => (v === undefined ? "…" : `${v} %`);

  return (
    // Colores en `style`: la piel oscura del panel repinta `bg-white`, y el papel debe verse como el PDF.
    <div className="overflow-hidden rounded-lg border border-border shadow-paper-lg" style={{ background: "#ffffff", color: "#022d33", colorScheme: "light" }}>
      <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto p-5 text-[11px] leading-snug">
        <div className="flex items-end justify-between gap-3 border-b-2 border-[#0c6069] pb-2">
          <img src={logotipo} alt="McKenna Group" className="h-auto w-36 max-w-[45%]" />
          <div className="text-right">
            <p className="text-lg font-bold leading-none tracking-tight text-[#0c6069]">COTIZACIÓN</p>
            <p className="mt-1 font-mono text-[10px] font-semibold">{numero || "Borrador"}</p>
            <p className="text-[10px] text-[#3a7e87]">
              Fecha <span className="text-[#022d33]">{new Date().toLocaleDateString("es-CO")}</span>
            </p>
            <p className="text-[10px] text-[#3a7e87]">
              Válida hasta <span className="text-[#022d33]">{vence}</span>
            </p>
          </div>
        </div>
        <p className="mt-1 text-[10px] font-medium text-[#0c6069]">Proveemos a tus ideas</p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="border-l-2 border-[#0c6069] pl-2">
            <p className="text-[9px] font-semibold text-[#3a7e87]">DE</p>
            <p className="font-semibold">McKenna Group S.A.S.</p>
            <p className="text-[10px]"><span className="text-[#3a7e87]">NIT</span> 901.316.016-3</p>
            <p className="text-[10px]">Bogotá D.C.</p>
          </div>
          <div className="min-w-0 border-l-2 border-[#0c6069] pl-2">
            <p className="text-[9px] font-semibold text-[#3a7e87]">PARA</p>
            <p className="break-words font-semibold">{cliente.nombre || <span className="italic font-normal text-[#9bb8bc]">Nombre del cliente</span>}</p>
            <p className="break-words text-[10px]">
              <span className="text-[#3a7e87]">{(cliente.tipo_documento || "").toUpperCase() === "NIT" ? "NIT" : "NIT / Cédula"}</span>{" "}
              {cliente.identificacion || vacio}
            </p>
            {cliente.direccion && <p className="break-words text-[10px]"><span className="text-[#3a7e87]">Dirección</span> {cliente.direccion}{cliente.ciudad ? `, ${cliente.ciudad}` : ""}</p>}
            {tel && <p className="text-[10px]"><span className="text-[#3a7e87]">WhatsApp</span> {tel}</p>}
            {cliente.correo && <p className="break-all text-[10px]"><span className="text-[#3a7e87]">Correo</span> {cliente.correo}</p>}
          </div>
        </div>

        <table className="mt-4 w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-[#0c6069] text-left text-white">
              <th className="px-1.5 py-1 font-semibold">Producto</th>
              <th className="px-1.5 py-1 text-right font-semibold">Cant.</th>
              <th className="px-1.5 py-1 text-right font-semibold">Precio</th>
              <th className="px-1.5 py-1 text-right font-semibold">IVA</th>
              <th className="px-1.5 py-1 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-1.5 py-4 text-center italic text-[#9bb8bc]">
                  Los productos aparecen aquí a medida que los agregas
                </td>
              </tr>
            )}
            {filas.map((l, i) => (
              <tr key={l.codigo || `${l.nombre}-${i}`} className={`border-b border-[#d3e3e5] align-top ${i % 2 ? "bg-[#f5f6f7]" : ""}`}>
                <td className="px-1.5 py-1">
                  <span className="block break-words">{l.nombre}</span>
                  {l.codigo && <span className="text-[9px] text-[#3a7e87]">Ref. {l.codigo}</span>}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">{l.cantidad}</td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{pesos(l.precio_unitario)}</td>
                <td className="px-1.5 py-1 text-right tabular-nums">{pct(l.iva_pct)}</td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold tabular-nums">{pesos(l.total ?? l.cantidad * l.precio_unitario)}</td>
              </tr>
            ))}
            {envio > 0 && (
              <tr className="border-b border-[#d3e3e5]">
                <td className="px-1.5 py-1">Envío</td>
                <td className="px-1.5 py-1 text-right">1</td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right tabular-nums">{pesos(envio)}</td>
                <td className="px-1.5 py-1 text-right">0 %</td>
                <td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold tabular-nums">{pesos(envio)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="ml-auto mt-3 w-3/5 min-w-[180px] text-[10px]">
          <div className="flex justify-between py-0.5">
            <span className="text-[#3a7e87]">Subtotal sin IVA</span>
            <span className="tabular-nums">{pesos(calc?.subtotal)}</span>
          </div>
          <div className="flex justify-between border-b border-[#d3e3e5] py-0.5">
            <span className="text-[#3a7e87]">IVA</span>
            <span className="tabular-nums">{pesos(calc?.iva)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between bg-[#045159] px-2 py-1.5 text-white">
            <span className="text-[10px] font-semibold">TOTAL A PAGAR</span>
            <span className="text-sm font-bold tabular-nums">{pesos(calc?.total)}</span>
          </div>
        </div>

        <div className="mt-4 border-l-2 border-[#0c6069] bg-[#eef6f7] px-3 py-2 text-[10px]">
          <p className="font-semibold text-[#045159]">CONDICIONES</p>
          {notas.trim() && (
            <p className="break-words">
              <b>Nota:</b> {notas}
            </p>
          )}
          <p>• Precios con IVA incluido. Válida hasta el {vence}.</p>
          <p>• Para confirmar, envíe el comprobante de pago por WhatsApp; con el pago emitimos la factura electrónica.</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ Ventas recientes ═══════════════════════════════ */

function PanelRecientes({
  onCerrar,
  onVenta,
  onPedido,
}: {
  onCerrar: () => void;
  onVenta: (v: Venta) => void;
  onPedido: (v: Venta) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const [ventas, setVentas] = useState<Venta[] | null>(null);
  const q = useDebounced(filtro, 300);

  useEffect(() => {
    api
      .get<{ ventas: Venta[] }>(`/api/ventas-directas?limit=40&q=${encodeURIComponent(q)}`)
      .then((r) => setVentas(r.ventas))
      .catch(() => setVentas([]));
  }, [q]);

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => ev.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Ventas recientes" onClick={onCerrar}>
      <div
        className="flex h-full w-[min(520px,100vw)] flex-col border-l border-border bg-surface-panel shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-bold text-ink">Ventas recientes</p>
          <button type="button" className="text-muted hover:text-ink" aria-label="Cerrar" onClick={onCerrar}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <input
            id="cf-filtro-recientes"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por cliente, número o factura…"
            className={input}
            autoFocus
          />
          {ventas === null ? (
            <p className="text-xs text-muted">Cargando…</p>
          ) : ventas.length === 0 ? (
            <p className="text-xs text-muted">Sin ventas directas que coincidan.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {ventas.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => onVenta(v)} className="flex w-full items-center gap-3 px-1 py-2 text-left text-xs hover:bg-surface-hover">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{v.cliente?.nombre || "Sin cliente"}</span>
                      <span className="font-mono text-[10px] text-muted">
                        {v.numero} · {hace(v.actualizado)}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${ESTADO_UI[v.estado].cls}`}>
                      {v.factura_numero || ESTADO_UI[v.estado].label}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-ink">{pesos(v.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border pt-3">
            <CompletarDesdePedidos onPedido={onPedido} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Solo la lista de pedidos del agente IA, para el panel de recientes. */
function CompletarDesdePedidos({ onPedido }: { onPedido: (v: Venta) => void }) {
  const [pedidos, setPedidos] = useState<PedidoIA[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ pedidos: PedidoIA[] }>("/api/ventas-directas/pedidos-ia")
      .then((r) => setPedidos(r.pedidos))
      .catch(() => setPedidos([]));
  }, []);
  const abiertos = useMemo(() => (pedidos ?? []).filter((p) => !p.venta_directa || p.venta_directa.estado !== "facturada"), [pedidos]);
  if (pedidos === null || abiertos.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink">Pedidos del agente IA por facturar</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-border/60">
        {abiertos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-1 py-2 text-left text-xs hover:bg-surface-hover"
              onClick={() =>
                api
                  .post<{ venta: Venta }>(`/api/ventas-directas/desde-pedido/${p.id}`, {})
                  .then((r) => onPedido(r.venta))
                  .catch((e) => setError((e as Error).message))
              }
            >
              <span className="min-w-0 flex-1 truncate text-ink">{p.cliente?.nombre || p.display}</span>
              <span className="shrink-0 font-semibold tabular-nums">{pesos(p.total ?? p.subtotal)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── Paso 2 · Productos ─────────────────────────────── */

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
      <div><p className="text-sm font-bold text-ink">¿Qué lleva?</p><p className="text-xs text-muted">Busca en el catálogo de Alegra. Escribe el precio que paga el cliente, con IVA; el IVA de cada producto sale de Alegra.</p></div>
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
          {ocupado ? "Guardando…" : "Continuar a cotizar o facturar →"}
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
