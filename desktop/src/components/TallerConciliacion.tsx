import { Ico } from "../icons/Ico";
import { Icon } from "../icons";
import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { usePanelTheme } from "../stores/panelTheme";
import { usePantallaCompleta, soportaPantallaCompleta } from "../hooks/usePantallaCompleta";
import TerceroSelect from "./TerceroSelect";
import { BTN, BTN_SEC } from "./combos/comun";
import { ponerSonido, sonarMoneda, sonidoActivo } from "./combos/sonidoMoneda";
import VentanaTaller from "./combos/VentanaTaller";

// Una compra no se causa desde acá con un formulario propio: entra por el MISMO
// wizard de solicitud de pago (proveedor del libro o de Alegra, productos con SKU
// del catálogo, factura cotejada, IVA descontable, espejo en Alegra). El taller
// lo abre encima, precargado con lo que ya sabe de la línea del banco.
const WizardPago = lazy(() => import("./PagosWizardPanel").then((m) => ({ default: m.Wizard })));
const CrearProductosSiigoPanel = lazy(() => import("./CrearProductosSiigoPanel"));

/**
 * Taller de conciliación: el extracto del banco, línea por línea, con la misma
 * disposición del Taller de Combos —una cola, un caso en foco, piezas que se
 * encienden— pero con el lenguaje del libro, no el de un diagrama: el caso se
 * muestra como **comprobante contable** (Cuenta · Debe · Haber · Tercero) y
 * como **cuentas T** con el saldo de cada cuenta antes y después, igual que se
 * revisa un asiento en Solicitudes de pago.
 *
 * Cada línea del banco es el caso. Sus piezas son las cuatro cosas que hay que
 * saber para que quede contabilizada: **quién** (tercero), **a dónde va**
 * (cuenta del PUC), **el asiento** en el libro y **el vínculo** con el banco.
 * Y al final **Comprobado**, que no es una pieza que se resuelva sino una
 * verificación: el asiento al que apunta el vínculo existe, balancea y gira lo
 * mismo que el banco, al peso.
 *
 * Se abre a ventana completa (`TallerVentana`) porque bajo el cabezote, las
 * pestañas del hub y los dos niveles del Libro Mayor quedaba en el tercio
 * inferior de la pantalla. Es el mismo mecanismo con que el Taller de Combos
 * abre sus apartados encima.
 */

/* ─── Tipos del tablero (app/services/conciliacion_taller.py) ────────────── */

// `revisando`: el libro todavía se está armando en el servidor; no se sabe.
type Estado = "vinculada" | "sugerida" | "sin_causar" | "revisando";

/** La factura o el pedido detrás de una venta, con su cliente. */
interface Documento {
  tipo: "factura" | "pedido web";
  numero: string;
  url?: string;
  cotizacion?: string;
  cliente: { nombre: string; identificacion: string; correo?: string };
}

interface Candidato {
  movimiento_id: string;
  documento?: Documento | null;
  fecha: string;
  tipo: "ingreso" | "egreso";
  concepto: string;
  contraparte: string;
  fuente: string;
  referencia: string;
  monto: number;
  diferencia: number;
  dias: number;
}

interface Propuesta {
  cuenta: string | null;
  concepto: string;
  confianza: "alta" | "revisar";
  nota: string;
  tercero: { id: number; nombre: string } | null;
}

/** El asiento real detrás de un vínculo, verificado (no creído). */
interface Comprobacion {
  fecha: string;
  concepto: string;
  fuente: string;
  monto: number;
  existe: boolean;
  diferencia: number;
  dias: number | null;
  cuadra: boolean;
  documento?: Documento | null;
  corregido?: boolean;
  ajustes?: Ajuste[];
  documento_soporte?: DocSoporte | null;
  patas_banco?: { movimiento_id: number; fecha: string; monto: number }[];
  /** Solo para asientos propios (`cc:`): cómo quedó, línea por línea. */
  lineas?: { cuenta: string; nombre: string; debito: number; credito: number; tercero: string; descripcion: string }[];
  cuentas?: string[];
  inventario?: boolean;
  iva_descontable?: boolean;
  items?: { sku: string; nombre: string; cantidad?: number; precio?: number }[];
  solicitud_id?: number | null;
  categoria?: string;
  factura_numero?: string;
  factura_nombre?: string;
  alegra_journal_id?: string;
  comprobante_nombre?: string;
}

type Categoria = { id: string; label: string; con_productos?: boolean; requiere_factura?: boolean };

/** El lote de MercadoPago detrás de un retiro al banco (app/services/mp_liberaciones.py). */
interface LoteMP {
  retiro: { linea_id: number; fecha: string; monto: number };
  retiro_anterior: { fecha: string; monto: number } | null;
  ventana: { desde: string; hasta: string };
  pagos: { payment_id: string; order_id: string; referencia: string; pack: string; fecha_pago: string; fecha_liberacion: string; bruto: number; comision: number; neto: number; descripcion: string;
    asiento: { movimiento_id: number; fecha: string; monto: number } | null; factura: { numero: string; fecha: string; total: number } | null }[];
  n_pagos: number; n_con_asiento: number; n_con_factura: number;
  liberado_bruto: number; comisiones: number; liberado_neto: number; retirado: number; queda_en_plataforma: number;
  cuenta_mp: string;
  saldo_111010_libro: number | null;
}

const esRetiroMP = (l: LineaBanco) => /MERCADO ?PAGO/i.test(l.descripcion) && l.tipo === "credito";

/** Una cuenta T como la arma pagos_wizard._cuentas_t: saldo antes → después según la naturaleza. */
interface CuentaT {
  cuenta_codigo: string; cuenta_nombre: string; naturaleza: "debito" | "credito"; tipo: string;
  debito: number; credito: number; saldo_antes: number; efecto: number; saldo_despues: number;
  movimientos: { descripcion: string; debito: number; credito: number }[];
}
interface LineaAsiento { cuenta_codigo: string; cuenta_nombre: string; debito: number; credito: number; descripcion: string; tercero: string }
/** El asiento que explica la línea del banco: el real, el candidato del libro, o el que se propone causar. */
/** Un ajuste que corrigió el asiento original (ajuste PUC, ajuste ICA…). */
interface Ajuste { id: number; fecha: string; concepto: string; referencia: string }
/** El documento soporte emitido a la DIAN por esta operación. */
interface DocSoporte { numero: string; estado: string; estado_dian: string; cuds: string; fecha: string; base?: number; retencion_ica?: number; girado?: number; cuenta_puc?: string }

interface AsientoVista {
  origen: "real" | "candidato" | "propuesto";
  titulo: string;
  lineas: LineaAsiento[];
  cuentas_t: CuentaT[];
  fuente?: string;
  monto?: number;
  confianza?: "alta" | "revisar";
  /** Si el asiento fue corregido: las líneas son el NETO de la cadena. */
  ajustes?: Ajuste[];
  documento_soporte?: DocSoporte | null;
  patas_banco?: { movimiento_id: number; fecha: string; monto: number }[];
}
type CompraAbierta = { tipo: "productos" | "servicios" };

interface LineaBanco {
  id: number;
  extracto_id: number;
  extracto_nombre: string;
  banco: string;
  cuenta: string;
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  tipo: "debito" | "credito";
  estado: Estado;
  vinculo: { vinculo_id: number; movimiento_id: string } | null;
  comprobacion: Comprobacion | null;
  asiento_vista: AsientoVista | null;
  candidatos: Candidato[];
  propuesta: Propuesta | null;
}

interface MovimientoHuerfano {
  movimiento_id: string;
  fecha: string;
  tipo: "ingreso" | "egreso";
  concepto: string;
  contraparte: string;
  fuente: string;
  monto: number;
}

interface Tablero {
  desde: string;
  hasta: string;
  /** false: el libro (Alegra/MeLi) se está armando detrás; hay que volver a pedir. */
  libro_listo: boolean;
  avisos: string[];
  totales: {
    lineas: number;
    vinculada: number;
    sugerida: number;
    sin_causar: number;
    revisando: number;
    dudosas: number;
    debitos: number;
    creditos: number;
    monto_sin_causar: number;
    libro_sin_banco: number;
  };
  comprobacion: {
    vinculadas: number;
    verificadas: number;
    cuadradas: number;
    descuadradas: number;
    sin_verificar: number;
    banco_conciliado: number;
    libro_conciliado: number;
    diferencia: number;
    banco_pendiente: number;
  };
  lineas: LineaBanco[];
  libro_sin_banco: MovimientoHuerfano[];
}

type PlanCuenta = { id: number; codigo: string; nombre: string; tipo: string };
type MedioPago = { id: number; nombre: string; activo: number };

/** Lo que el operador decidió sobre una línea antes de causarla (quién, a dónde). */
interface Ajuste {
  terceroId?: number;
  terceroNombre?: string;
  cuentaId?: number;
  cuentaCodigo?: string;
  cuentaNombre?: string;
  /** Entre varios asientos que calzan, el elegido. */
  candidato?: string;
}

/* ─── Utilidades ─────────────────────────────────────────────────────────── */

function formatCop(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Primer día del mes corriente: es el rango con el que se baja el archivo. */
function inicioDeMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function diaCorto(f: string): string {
  const [, m, d] = (f || "").split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return d && m ? `${d} ${meses[Number(m) - 1] ?? m}` : f;
}

/* ─── Las piezas de una línea ────────────────────────────────────────────── */

type EstadoPieza = "ok" | "aviso" | "falta";
type ClavePieza = "tercero" | "cuenta" | "asiento" | "vinculo";

interface Pieza {
  clave: ClavePieza;
  titulo: string;
  estado: EstadoPieza;
  /** Lo que se sabe: el nombre del tercero, el código de la cuenta, «calza uno»… */
  dato: string;
  /** Una línea de qué pasa, para la guía y el tooltip. */
  detalle: string;
}

const PIEZAS: { clave: ClavePieza; icono: string; titulo: string; corto: string }[] = [
  { clave: "tercero", icono: "👤", titulo: "Tercero", corto: "Quién" },
  { clave: "cuenta", icono: "📒", titulo: "Cuenta PUC", corto: "A dónde" },
  { clave: "asiento", icono: "🧾", titulo: "Asiento en el libro", corto: "Asiento" },
  { clave: "vinculo", icono: "🔗", titulo: "Vínculo con el banco", corto: "Vínculo" },
];
const TOTAL = PIEZAS.length;
const ORDEN_GUIA: ClavePieza[] = ["tercero", "cuenta", "asiento", "vinculo"];

const CLAVE_LINEA = "mck-conciliacion-linea";
const CLAVE_DIA = "mck-conciliacion-marcador";

function hoyClave() {
  return new Date().toISOString().slice(0, 10);
}

function leerMarcador(): { dia: string; conexiones: number; lineas: number } {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_DIA) || "null");
    if (m && m.dia === hoyClave()) return m;
  } catch {
    /* sin almacenamiento */
  }
  return { dia: hoyClave(), conexiones: 0, lineas: 0 };
}

/**
 * El estado de las cuatro piezas de una línea, con lo que el operador ya haya
 * decidido encima (`ajuste`).
 *
 * Una línea VINCULADA tiene las cuatro en verde por definición: el asiento
 * existe, está unido al banco, y quién y a dónde son los del asiento. Para las
 * demás, cada pieza se responde con lo que hay: la propuesta del clasificador,
 * el asiento del libro que calza, o lo que el operador eligió.
 */
function armarPiezas(l: LineaBanco, aj: Ajuste | undefined): Record<ClavePieza, Pieza> {
  const p = l.propuesta;
  const cand = l.candidatos.find((c) => c.movimiento_id === aj?.candidato) ?? l.candidatos[0];

  if (l.estado === "vinculada") {
    const c = l.comprobacion;
    return {
      tercero: { clave: "tercero", titulo: "Tercero", estado: "ok", dato: "en el asiento", detalle: "Lo dice el asiento del libro." },
      cuenta: { clave: "cuenta", titulo: "Cuenta PUC", estado: "ok", dato: "en el asiento", detalle: "Lo dice el asiento del libro." },
      asiento: { clave: "asiento", titulo: "Asiento en el libro", estado: "ok", dato: c?.concepto ? c.concepto.slice(0, 26) : l.vinculo?.movimiento_id ?? "", detalle: c ? `${c.concepto} · ${formatCop(c.monto)}` : "Registrado." },
      vinculo: { clave: "vinculo", titulo: "Vínculo con el banco", estado: "ok", dato: "conciliada", detalle: "La línea del banco y el asiento están unidos." },
    };
  }

  // Tercero
  let tercero: Pieza;
  if (aj?.terceroNombre) {
    tercero = { clave: "tercero", titulo: "Tercero", estado: "ok", dato: aj.terceroNombre, detalle: "Elegido para esta línea." };
  } else if (cand?.documento?.cliente?.nombre) {
    const d = cand.documento;
    tercero = { clave: "tercero", titulo: "Tercero", estado: "ok", dato: d.cliente.nombre, detalle: `Cliente de la ${d.tipo} ${d.numero}${d.cliente.identificacion ? ` · ${d.cliente.identificacion}` : ""}.` };
  } else if (cand) {
    tercero = cand.contraparte
      ? { clave: "tercero", titulo: "Tercero", estado: "ok", dato: cand.contraparte, detalle: "Es el del asiento que calza." }
      : { clave: "tercero", titulo: "Tercero", estado: "ok", dato: "el del asiento", detalle: "Lo tiene el asiento que calza." };
  } else if (p?.tercero) {
    tercero = { clave: "tercero", titulo: "Tercero", estado: "ok", dato: p.tercero.nombre, detalle: "Identificado por el nombre que trae el banco." };
  } else if (p?.confianza === "alta") {
    // GMF, intereses, costo bancario, DIAN: el «tercero» es el banco o el Estado y
    // el asiento no lo necesita. No es una pieza que falte.
    tercero = { clave: "tercero", titulo: "Tercero", estado: "ok", dato: "no aplica", detalle: "Esta operación no lleva tercero." };
  } else {
    tercero = { clave: "tercero", titulo: "Tercero", estado: "falta", dato: "", detalle: "El banco solo trae un nombre truncado. Hay que decir quién es." };
  }

  // Cuenta
  let cuenta: Pieza;
  if (aj?.cuentaCodigo) {
    cuenta = { clave: "cuenta", titulo: "Cuenta PUC", estado: "ok", dato: aj.cuentaCodigo, detalle: `${aj.cuentaCodigo} · ${aj.cuentaNombre ?? ""}` };
  } else if (cand) {
    cuenta = { clave: "cuenta", titulo: "Cuenta PUC", estado: "ok", dato: "la del asiento", detalle: "La trae el asiento que calza." };
  } else if (p?.cuenta && p.confianza === "alta") {
    cuenta = { clave: "cuenta", titulo: "Cuenta PUC", estado: "ok", dato: p.cuenta, detalle: `${p.cuenta} · ${p.concepto}` };
  } else if (p?.cuenta) {
    cuenta = { clave: "cuenta", titulo: "Cuenta PUC", estado: "aviso", dato: `${p.cuenta} ?`, detalle: `Parece ${p.cuenta} · ${p.concepto}, pero hay que confirmarlo.` };
  } else {
    cuenta = { clave: "cuenta", titulo: "Cuenta PUC", estado: "falta", dato: "", detalle: p?.concepto && p.concepto !== "Sin patrón conocido" ? `Parece «${p.concepto}». Falta decir la cuenta.` : "Ningún patrón reconoce esta descripción." };
  }

  // Asiento
  let asiento: Pieza;
  if (l.estado === "revisando") {
    asiento = { clave: "asiento", titulo: "Asiento en el libro", estado: "aviso", dato: "buscando…", detalle: "El libro se está armando (Alegra/MeLi). En unos segundos se sabe si hay asiento." };
  } else if (l.candidatos.length === 1) {
    asiento = { clave: "asiento", titulo: "Asiento en el libro", estado: "ok", dato: "calza uno", detalle: `${l.candidatos[0].concepto} · ${diaCorto(l.candidatos[0].fecha)}` };
  } else if (l.candidatos.length > 1) {
    asiento = aj?.candidato
      ? { clave: "asiento", titulo: "Asiento en el libro", estado: "ok", dato: "elegido", detalle: cand?.concepto ?? "" }
      : { clave: "asiento", titulo: "Asiento en el libro", estado: "aviso", dato: `${l.candidatos.length} calzan`, detalle: `Hay ${l.candidatos.length} asientos por el mismo monto. Hay que elegir cuál es.` };
  } else {
    asiento = { clave: "asiento", titulo: "Asiento en el libro", estado: "falta", dato: "", detalle: "Nadie registró esta operación. Hay que causarla." };
  }

  const vinculo: Pieza = { clave: "vinculo", titulo: "Vínculo con el banco", estado: "falta", dato: "", detalle: l.estado === "revisando" ? "Espera a que el libro esté listo." : cand ? "El asiento existe: falta unirlo a esta línea." : "Primero el asiento; el vínculo se hace solo al causar." };

  return { tercero, cuenta, asiento, vinculo };
}

/**
 * La última columna del flujo: no se resuelve, se verifica. Solo existe para
 * una línea vinculada, y dice si el asiento real cuadra con el banco al peso.
 */
function comprobado(l: LineaBanco): { estado: EstadoPieza; dato: string; detalle: string } {
  if (l.estado !== "vinculada") return { estado: "falta", dato: "", detalle: "Se comprueba cuando la línea quede vinculada." };
  const c = l.comprobacion;
  if (!c) return { estado: "aviso", dato: "sin verificar", detalle: "El asiento viene de una fuente que aún no está cargada (Alegra/MeLi). Espera al libro." };
  if (!c.existe) return { estado: "falta", dato: "asiento anulado", detalle: "El vínculo apunta a un asiento que ya no existe o está anulado. Hay que deshacerlo y volver a causar." };
  if (c.cuadra) return { estado: "ok", dato: "$0 dif.", detalle: `Banco ${formatCop(l.monto)} = libro ${formatCop(c.monto)}. Cuadra al peso.` };
  return { estado: "falta", dato: `dif. ${formatCop(Math.abs(c.diferencia))}`, detalle: `Banco ${formatCop(l.monto)} vs libro ${formatCop(c.monto)}: alguien cambió el asiento o el vínculo está mal.` };
}

function okDe(piezas: Record<ClavePieza, Pieza>): number {
  return ORDEN_GUIA.filter((k) => piezas[k].estado === "ok").length;
}

function textoEstado(e: { estado: EstadoPieza }): string {
  return e.estado === "ok" ? "conectada" : e.estado === "aviso" ? "por revisar" : "falta";
}

/** La pregunta con la que el taller guía cada pieza: qué pasa y qué se propone hacer. */
function preguntaGuia(clave: ClavePieza, l: LineaBanco, pz: Pieza): string {
  if (l.estado === "vinculada") {
    const c = comprobado(l);
    return c.estado === "ok" ? "Esta línea está conciliada y comprobada: el asiento dice la misma plata. Puedes pasar a la siguiente." : c.detalle;
  }
  if (l.estado === "revisando") return "El libro se está armando (Alegra y MeLi tardan ~30 s). Mientras tanto puedes decidir quién y a dónde.";
  if (clave === "tercero") {
    if (pz.estado === "ok") return pz.dato === "no aplica" ? "Esta operación no lleva tercero (es del banco o del Estado). Nada que decidir." : `Es ${pz.dato}. Si no es, elige otro.`;
    return "El banco solo trae un nombre truncado. ¿Quién es? Elígelo en el libro, o créalo si no existe.";
  }
  if (clave === "cuenta") {
    if (pz.estado === "ok") return `Va a ${pz.detalle}. Si no es, elige otra.`;
    if (pz.estado === "aviso") return `${pz.detalle} ¿La confirmamos o va a otra?`;
    return "¿A qué cuenta va esta plata? Ningún patrón lo resuelve solo.";
  }
  if (clave === "asiento" && esRetiroMP(l) && pz.estado === "falta") return `Es un retiro de MercadoPago: plata propia de ventas MeLi ya liberadas. Se causa como traslado (Debe Bancos / Haber la cuenta de MercadoPago). Abajo, qué ventas trae el lote.`;
  if (clave === "asiento") {
    if (pz.estado === "ok") return l.candidatos.length ? "Este asiento del libro calza por fecha y monto. Si es, pasa al vínculo." : "";
    if (pz.estado === "aviso") return "Hay más de un asiento por el mismo monto. ¿Cuál corresponde a este movimiento?";
    return l.propuesta?.confianza === "alta"
      ? `Nadie registró esta operación. Se propone causarla a ${l.propuesta.cuenta} — ${l.propuesta.concepto}. ¿La causamos así?`
      : "Nadie registró esta operación. Con quién y a dónde ya decididos, se causa desde acá.";
  }
  return l.candidatos.length
    ? "El asiento existe y calza. ¿Lo unimos a esta línea del banco?"
    : "Todavía no hay asiento que unir: primero hay que causarlo (pieza 3).";
}

/* ─── Guía: de dónde sale el archivo ─────────────────────────────────────── */

/**
 * La conciliación no se hace una vez al mes esperando el extracto: se baja el
 * detalle de movimientos cuando se quiera, desde el 1 hasta hoy. Como el camino
 * en Sucursal Negocios tiene cuatro clics que nadie recuerda, va escrito acá y
 * no en un documento aparte.
 */
function GuiaDescarga({ onCerrar }: { onCerrar: () => void }) {
  const pasos = [
    "Entra a Sucursal Virtual Negocios de Bancolombia.",
    "Menú «Reportes y archivos».",
    "«Saldos consolidados».",
    "«Movimientos».",
    "Elige el rango: desde el 1 del mes (o el día que quieras) hasta hoy.",
    "Descarga el archivo y suéltalo sobre el taller — llega como .zip o .csv.",
  ];
  return (
    <div className="rounded-lg border border-border bg-surface/60 px-3 py-2.5">
      <ol className="space-y-1 text-[12px] text-ink">
        {pasos.map((p, i) => (
          <li key={p} className="flex gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[9px] font-bold text-accent">{i + 1}</span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-muted">
        Se puede traer las veces que haga falta: los días ya cargados no se duplican, solo entran los nuevos. Si el archivo trae mejor descripción que la que había, la mejora.
      </p>
      <button className={`${BTN_SEC} mt-2`} onClick={onCerrar}>Entendido</button>
    </div>
  );
}

/* ─── Causar ─────────────────────────────────────────────────────────────── */

type ClasifTipo = "egreso" | "ingreso" | "proveedor";

interface Causacion {
  tipo: ClasifTipo;
  cuentaId: number;
  medioId: number;
  terceroId?: number;
  concepto: string;
}

/**
 * Crea el asiento de una línea del banco y lo deja vinculado, en un solo paso.
 *
 * La usan tanto el botón de un clic como el formulario: hay una sola forma de
 * escribir en el libro desde el taller, y usa las mismas plantillas de
 * `contabilidad_core` que la bandeja anterior.
 *
 * `referencia = "extracto:<id>"` es lo que hace el asiento idempotente: es la
 * misma marca que pone `extracto_clasificador.aplicar`, así que causar a mano
 * algo que después entra en el lote no lo duplica.
 */
async function causarLinea(linea: LineaBanco, d: Causacion): Promise<void> {
  const ref = `extracto:${linea.id}`;
  let movimiento: { id: number } | undefined;

  if (d.tipo === "proveedor") {
    if (!d.terceroId) throw new Error("Elige el proveedor");
    const r = await api.post<{ error?: string; movimiento?: { id: number } }>("/api/contabilidad/cc/plantillas/compra-proveedor", {
      fecha: linea.fecha, tercero_id: d.terceroId, concepto: d.concepto || linea.descripcion, valor: linea.monto,
      cuenta_destino_id: d.cuentaId, forma_pago: "contado", medio_pago_id: d.medioId, referencia: ref,
    });
    if (r.error || !r.movimiento) throw new Error(r.error || "No se pudo crear el asiento");
    movimiento = r.movimiento;
  } else {
    const cuerpo: Record<string, unknown> = {
      fecha: linea.fecha,
      // `registrar_ingreso`/`registrar_egreso` leen «valor»; las plantillas de
      // préstamos leen «monto». La ruta acepta las dos, pero acá se manda la
      // que de verdad usa la plantilla a la que se está llamando.
      valor: linea.monto,
      medio_pago_id: d.medioId,
      referencia: ref,
      concepto: d.concepto || linea.descripcion,
    };
    if (d.tipo === "ingreso") cuerpo.cuenta_ingreso_id = d.cuentaId;
    else cuerpo.cuenta_gasto_id = d.cuentaId;
    if (d.terceroId) cuerpo.tercero_id = d.terceroId;
    const r = await api.post<{ error?: string; movimiento?: { id: number } }>(`/api/contabilidad/cc/plantillas/${d.tipo}`, cuerpo);
    if (r.error || !r.movimiento) throw new Error(r.error || "No se pudo crear el asiento");
    movimiento = r.movimiento;
  }

  await api.post("/api/contabilidad/extractos/vincular", { extracto_mov_id: linea.id, movimiento_id: `cc:${movimiento.id}` });
}

function medioDelBanco(medios: MedioPago[]): MedioPago | undefined {
  return medios.find((m) => /bancolombia/i.test(m.nombre)) ?? medios[0];
}

/**
 * La causación que se puede hacer de un clic, o `null` si hay que decidir algo.
 *
 * Sale de lo que ya está resuelto en las piezas: la cuenta y el tercero que
 * eligió el operador, o —si no eligió— los que propuso el clasificador con
 * confianza `alta` (GMF, intereses de ahorros, costo bancario, DIAN), que son
 * la mayoría de las líneas. Obligar a abrir un formulario de cinco campos para
 * confirmar que el 4x1000 va a 5305, ochenta veces al mes, es justamente el
 * trabajo que este taller existe para quitar.
 */
function planDeUnClic(linea: LineaBanco, aj: Ajuste | undefined, cuentas: PlanCuenta[], medios: MedioPago[]): (Causacion & { etiqueta: string }) | null {
  const p = linea.propuesta;
  const medio = medioDelBanco(medios);
  if (!medio) return null;
  const cuenta = aj?.cuentaId
    ? cuentas.find((c) => c.id === aj.cuentaId)
    : p?.confianza === "alta" && p.cuenta
      ? cuentas.find((c) => c.codigo === p.cuenta)
      : undefined;
  if (!cuenta) return null;
  const concepto = p?.concepto && p.concepto !== "Sin patrón conocido" ? p.concepto : cuenta.nombre;
  return {
    tipo: linea.tipo === "debito" ? "egreso" : "ingreso",
    cuentaId: cuenta.id,
    medioId: medio.id,
    terceroId: aj?.terceroId ?? p?.tercero?.id,
    concepto: `${concepto} — ${linea.descripcion}`,
    etiqueta: `${cuenta.codigo} · ${concepto}`,
  };
}

/**
 * El formulario completo, para cuando el clic no alcanza: compra a proveedor,
 * otra cuenta, otro medio. Llega con lo que ya se decidió en las otras piezas.
 */
function FormCausar({ linea, ajuste, cuentas, medios, onHecho, onCerrar }: {
  linea: LineaBanco; ajuste: Ajuste | undefined; cuentas: PlanCuenta[]; medios: MedioPago[]; onHecho: () => void; onCerrar: () => void;
}) {
  const p = linea.propuesta;
  const esSalida = linea.tipo === "debito";
  const cuentaInicial = useMemo(
    () => (ajuste?.cuentaId ? cuentas.find((c) => c.id === ajuste.cuentaId) : p?.cuenta ? cuentas.find((c) => c.codigo === p.cuenta) : undefined),
    [ajuste?.cuentaId, p?.cuenta, cuentas],
  );
  const medioBanco = useMemo(() => medioDelBanco(medios), [medios]);

  const [tipo, setTipo] = useState<ClasifTipo>(esSalida ? "egreso" : "ingreso");
  const [cuentaId, setCuentaId] = useState(cuentaInicial ? String(cuentaInicial.id) : "");
  const [terceroId, setTerceroId] = useState(ajuste?.terceroId ? String(ajuste.terceroId) : p?.tercero ? String(p.tercero.id) : "");
  const [medioId, setMedioId] = useState(medioBanco ? String(medioBanco.id) : "");
  const [concepto, setConcepto] = useState(p?.concepto && p.concepto !== "Sin patrón conocido" ? `${p.concepto} — ${linea.descripcion}` : linea.descripcion);
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!medioId) throw new Error("Elige el medio de pago");
      if (!cuentaId) throw new Error("Elige la cuenta contable");
      await causarLinea(linea, { tipo, cuentaId: Number(cuentaId), medioId: Number(medioId), terceroId: terceroId ? Number(terceroId) : undefined, concepto: concepto.trim() });
    },
    onSuccess: onHecho,
    onError: (e: unknown) => setErr((e as Error).message || "No se pudo causar"),
  });

  const cuentasVisibles = useMemo(() => {
    const orden = (c: PlanCuenta) => (c.id === cuentaInicial?.id ? 0 : 1);
    return [...cuentas].sort((a, b) => orden(a) - orden(b) || a.codigo.localeCompare(b.codigo));
  }, [cuentas, cuentaInicial?.id]);

  const campo = "block w-full rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {([{ id: "egreso", nombre: "Gasto / costo" }, { id: "ingreso", nombre: "Ingreso" }, { id: "proveedor", nombre: "Compra a proveedor" }] as const).map((o) => (
          <button key={o.id} type="button" onClick={() => setTipo(o.id)} aria-pressed={tipo === o.id}
            className={`rounded-md border px-2 py-1 text-[11px] font-bold ${tipo === o.id ? "border-accent bg-accent text-white" : "border-border bg-surface text-ink hover:border-accent/50"}`}>
            {o.nombre}
          </button>
        ))}
      </div>
      <label className="block space-y-1 text-[11px] font-semibold text-ink-secondary">
        Cuenta contable
        <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className={campo}>
          <option value="">Elegir cuenta…</option>
          {cuentasVisibles.map((c) => (<option key={c.id} value={String(c.id)}>{c.codigo} · {c.nombre}{c.id === cuentaInicial?.id ? "  ← propuesta" : ""}</option>))}
        </select>
      </label>
      <TerceroSelect value={terceroId} onChange={setTerceroId} label={tipo === "proveedor" ? "Proveedor (obligatorio)" : "Tercero (opcional)"} />
      <label className="block space-y-1 text-[11px] font-semibold text-ink-secondary">
        Medio de pago
        <select value={medioId} onChange={(e) => setMedioId(e.target.value)} className={campo}>
          <option value="">Elegir…</option>
          {medios.map((m) => (<option key={m.id} value={String(m.id)}>{m.nombre}</option>))}
        </select>
      </label>
      <label className="block space-y-1 text-[11px] font-semibold text-ink-secondary">
        Concepto del asiento
        <input value={concepto} onChange={(e) => setConcepto(e.target.value)} className={campo} />
      </label>
      {err && <p className="text-[11.5px] font-semibold text-accent-rose">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" disabled={mut.isPending} onClick={() => { setErr(null); mut.mutate(); }}
          className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
          {mut.isPending ? "Causando…" : `Causar ${formatCop(linea.monto)} y vincular`}
        </button>
        <button type="button" onClick={onCerrar} className={BTN_SEC}>Volver</button>
      </div>
    </div>
  );
}

/* ─── Inspectores: el contenido de cada pieza ────────────────────────────── */

function CuadroCandidato({ c, elegido, onElegir }: { c: Candidato; elegido: boolean; onElegir: () => void }) {
  return (
    <button type="button" onClick={onElegir} aria-pressed={elegido}
      className={`mck-btn-no-fx block w-full rounded-lg border p-2 text-left transition ${elegido ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}>
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted">{c.fecha}</span>
        <span className="ml-auto font-mono text-[12px] font-bold tabular-nums text-ink">{formatCop(c.monto)}</span>
      </span>
      <span className="mt-0.5 block text-[12px] font-semibold leading-tight text-ink">{c.concepto}</span>
      {c.documento && (
        <span className="mt-0.5 block text-[11.5px] text-ink">
          <Ico e="🧾" /> {c.documento.tipo === "factura" ? "Factura" : "Pedido"} <b>{c.documento.numero}</b>
          {c.documento.cliente.nombre ? <> · {c.documento.cliente.nombre}</> : null}
          {c.documento.cliente.identificacion ? <span className="text-muted"> · {c.documento.cliente.identificacion}</span> : null}
          {c.documento.url && <a href={c.documento.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1.5 font-bold text-accent underline-offset-2 hover:underline">ver en Alegra ↗</a>}
        </span>
      )}
      <span className="mt-0.5 block font-mono text-[9.5px] text-muted">
        {c.fuente}{c.contraparte && !c.documento?.cliente?.nombre ? ` · ${c.contraparte}` : ""}
        {c.dias ? ` · ${c.dias} día${c.dias === 1 ? "" : "s"} de diferencia` : " · mismo día"}
        {c.diferencia >= 0.5 ? ` · dif. ${formatCop(c.diferencia)}` : " · $0 dif."}
      </span>
    </button>
  );
}

/** La comprobación de una línea vinculada, tal como se muestra en su emergente. */
function FichaComprobacion({ l }: { l: LineaBanco }) {
  const c = l.comprobacion;
  const v = comprobado(l);
  return (
    <div className={`rounded-lg border p-2.5 text-[12px] ${v.estado === "ok" ? "border-accent-leaf/50 bg-accent-leaf/10" : v.estado === "aviso" ? "border-accent-sun/50 bg-accent-sun/10" : "border-accent-rose/50 bg-accent-rose/10"}`}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Comprobación del vínculo</p>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink">
        <span className="text-muted">Banco</span><span className="font-mono tabular-nums">{diaCorto(l.fecha)} · {formatCop(l.monto)} · {l.descripcion}</span>
        <span className="text-muted">Asiento</span>
        <span className="font-mono tabular-nums">{c ? `${diaCorto(c.fecha)} · ${formatCop(c.monto)} · ${c.concepto}` : "sin verificar todavía"}{c?.fuente ? <span className="text-muted"> · {c.fuente}</span> : null}</span>
        {c?.documento && (<>
          <span className="text-muted">Documento</span>
          <span>{c.documento.tipo === "factura" ? "Factura" : "Pedido"} <b>{c.documento.numero}</b>{c.documento.cliente.nombre ? ` · ${c.documento.cliente.nombre}` : ""}{c.documento.cliente.identificacion ? <span className="text-muted"> · {c.documento.cliente.identificacion}</span> : null}{c.documento.url && <a href={c.documento.url} target="_blank" rel="noreferrer" className="ml-1.5 font-bold text-accent underline-offset-2 hover:underline">ver en Alegra ↗</a>}</span>
        </>)}
        <span className="text-muted">Resultado</span>
        <span className={`font-bold ${v.estado === "ok" ? "text-accent-leaf" : v.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>
          {v.estado === "ok" ? "✓ cuadra al peso" : v.estado === "aviso" ? "… sin verificar" : `✗ ${v.dato}`}
          {c?.dias ? <span className="font-normal text-muted"> · {c.dias} día{c.dias === 1 ? "" : "s"} entre fechas</span> : null}
        </span>
      </div>
      {v.estado !== "ok" && <p className="mt-1.5 text-[11.5px] text-ink">{v.detalle}</p>}
      {c?.corregido && <div className="mt-2"><Cadena ajustes={c.ajustes} ds={c.documento_soporte} patas={c.patas_banco} /></div>}

      {c?.lineas && c.lineas.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-surface-panel">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-surface text-[9.5px] uppercase text-muted"><tr><th className="px-2 py-1">Cuenta</th><th className="px-2 py-1 text-right">Débito</th><th className="px-2 py-1 text-right">Crédito</th><th className="px-2 py-1">Tercero</th></tr></thead>
            <tbody>
              {c.lineas.map((ln, i) => (
                <tr key={i} className="border-t border-border/60" title={ln.descripcion}>
                  <td className="px-2 py-1 text-ink"><code className="font-bold">{ln.cuenta}</code> <span className="text-muted">{ln.nombre}</span></td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{ln.debito ? formatCop(ln.debito) : ""}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{ln.credito ? formatCop(ln.credito) : ""}</td>
                  <td className="px-2 py-1 text-muted">{ln.tercero}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c?.lineas && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[9.5px]">
          <Insignia ok={Boolean(c.inventario)} si={`inventario 1435 · ${c.items?.length ?? 0} SKU`} no="sin inventario (gasto o cuenta auxiliar)" />
          <Insignia ok={Boolean(c.iva_descontable)} si="IVA descontable 240810" no="sin IVA separado" neutro />
          <Insignia ok={Boolean(c.alegra_journal_id)} si={`espejo Alegra #${c.alegra_journal_id}`} no="sin espejo en Alegra" />
          <Insignia ok={Boolean(c.factura_numero || c.factura_nombre)} si={`factura ${c.factura_numero || c.factura_nombre}`} no="sin factura cotejada" neutro />
          <Insignia ok={Boolean(c.comprobante_nombre)} si="comprobante adjunto" no="sin comprobante" neutro />
        </div>
      )}
      {c?.items && c.items.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-ink">
          {c.items.map((it, i) => (<li key={i}><code className="font-bold">{it.sku}</code> {it.nombre}{it.cantidad ? ` · ${it.cantidad}` : ""}{it.precio ? ` × ${formatCop(it.precio)}` : ""}</li>))}
        </ul>
      )}
      <p className="mt-1 font-mono text-[9.5px] text-muted">vínculo #{l.vinculo?.vinculo_id} → {l.vinculo?.movimiento_id}{c?.solicitud_id ? ` · solicitud #${c.solicitud_id}` : ""}</p>
    </div>
  );
}

/**
 * La cadena de una operación corregida: el original ya no dice la verdad solo;
 * los ajustes y el documento soporte sí. Se enseña para que nadie crea que el
 * pago está mal registrado cuando lo que está es corregido.
 */
function Cadena({ ajustes, ds, patas }: { ajustes?: Ajuste[]; ds?: DocSoporte | null; patas?: { movimiento_id: number; fecha: string; monto: number }[] }) {
  if (!ajustes?.length && !ds) return null;
  const dianOk = /ACCEPTED|success/i.test(ds?.estado_dian || ds?.estado || "");
  return (
    <div className="rounded-md border border-accent-leaf/50 bg-accent-leaf/10 px-2.5 py-1.5 text-[11.5px] text-ink">
      <p className="font-bold"><Ico e="✅" /> Corregido: lo que se muestra es el neto de la operación.</p>
      {ajustes && ajustes.length > 0 && (
        <p className="mt-0.5 text-muted">Ajustes: {ajustes.map((a) => `#${a.id} (${diaCorto(a.fecha)}) ${a.concepto.replace(/^Ajuste( PUC)? — /, "").slice(0, 60)}`).join(" · ")}</p>
      )}
      {ds && (
        <p className={`mt-0.5 font-mono ${dianOk ? "text-accent-leaf" : "text-accent-sun"}`}>
          Documento soporte <b>{ds.numero}</b> {dianOk ? "· aceptado por la DIAN" : `· ${ds.estado_dian || ds.estado}`}
          {ds.cuenta_puc ? ` · ${ds.cuenta_puc}` : ""}{ds.base ? ` · base ${formatCop(ds.base)}` : ""}{ds.retencion_ica ? ` · ICA ${formatCop(ds.retencion_ica)}` : ""}{ds.girado ? ` · girado ${formatCop(ds.girado)}` : ""}
        </p>
      )}
      {patas && patas.length > 1 && (
        <p className="mt-0.5 font-mono text-muted">Pagado en {patas.length} giros: {patas.map((p) => `${diaCorto(p.fecha)} ${formatCop(p.monto)}`).join(" + ")}. Esta línea es uno de ellos.</p>
      )}
    </div>
  );
}

/** Una marca de la comprobación: verde si se cumple; ámbar o gris si no, según importe. */
function Insignia({ ok, si, no, neutro }: { ok: boolean; si: string; no: string; neutro?: boolean }) {
  return (
    <span className={`rounded-full border px-1.5 py-0.5 ${ok ? "border-accent-leaf/50 bg-accent-leaf/10 text-ink" : neutro ? "border-border bg-surface text-muted" : "border-accent-sun/60 bg-accent-sun/10 text-ink"}`}>
      {ok ? "✓" : neutro ? "·" : "!"} {ok ? si : no}
    </span>
  );
}

function Inspector({ clave, l, piezas, ajuste, cuentas, medios, ocupado, onAjuste, onVincular, onDesvincular, onCausar, onRegistrarCompra, onCrearCliente, onHecho, irA }: {
  clave: ClavePieza; l: LineaBanco; piezas: Record<ClavePieza, Pieza>; ajuste: Ajuste | undefined; cuentas: PlanCuenta[]; medios: MedioPago[]; ocupado: boolean;
  onAjuste: (a: Partial<Ajuste>) => void; onVincular: (movimientoId: string) => void; onDesvincular: () => void; onCausar: (plan: Causacion) => void;
  /** Abre el wizard de pago encima del taller: la línea es una compra (productos) o un servicio. */
  onRegistrarCompra: (tipo: "productos" | "servicios") => void;
  /** Crea en el libro el cliente que trae la factura (tipo cliente) y lo deja elegido. */
  onCrearCliente: (doc: Documento) => void;
  /** El formulario causó por su cuenta: el taller tiene que volver a leer. */
  onHecho: () => void;
  /** Pasar a otra pieza de la misma línea. */
  irA: (k: ClavePieza) => void;
}) {
  const [formulario, setFormulario] = useState(false);
  const p = l.propuesta;
  const candElegido = l.candidatos.find((c) => c.movimiento_id === ajuste?.candidato) ?? l.candidatos[0];

  if (l.estado === "vinculada") {
    return (
      <div className="space-y-2">
        <FichaComprobacion l={l} />
        <button type="button" disabled={ocupado} onClick={onDesvincular}
          className="rounded-md border border-border px-2 py-1 text-[11px] font-bold text-muted hover:border-accent-rose hover:text-accent-rose disabled:opacity-50">
          Deshacer el vínculo
        </button>
      </div>
    );
  }

  if (clave === "tercero") {
    const doc = candElegido?.documento;
    return (
      <div className="space-y-2">
        {p?.nota && <p className="rounded-md border border-accent-sun/40 bg-accent-sun/10 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink"><Ico e="⚠️" /> {p.nota}</p>}
        {doc?.cliente?.nombre && (
          <div className="rounded-lg border border-accent-leaf/50 bg-accent-leaf/10 px-2.5 py-2 text-[12px] text-ink">
            <p><Ico e="🧾" /> La {doc.tipo} <b>{doc.numero}</b> ya dice quién es: <b>{doc.cliente.nombre}</b>{doc.cliente.identificacion ? ` · ${doc.cliente.identificacion}` : ""}. No hay que elegirlo.</p>
            {!ajuste?.terceroId && (
              <button type="button" disabled={ocupado} onClick={() => onCrearCliente(doc)} className={`${BTN} mt-1.5`}>
                Registrarlo como cliente del libro
              </button>
            )}
            {ajuste?.terceroId && <p className="mt-1 font-mono text-[10px] text-muted">tercero #{ajuste.terceroId} · {ajuste.terceroNombre}</p>}
          </div>
        )}
        <TerceroSelect value={ajuste?.terceroId ? String(ajuste.terceroId) : p?.tercero ? String(p.tercero.id) : ""} onChange={(id) => onAjuste({ terceroId: id ? Number(id) : undefined })} label={doc ? "O elige otro del libro" : "Quién es"}
          tiposPermitidos={l.tipo === "credito" ? ["cliente", "socio", "otro", "proveedor", "empleado"] : ["proveedor", "socio", "empleado", "otro", "cliente"]} />
        <div className="flex gap-2"><button className={BTN} onClick={() => irA("cuenta")}>Listo · a la cuenta →</button></div>
      </div>
    );
  }

  if (clave === "cuenta") {
    const propuestaId = cuentas.find((c) => c.codigo === p?.cuenta)?.id;
    const valor = ajuste?.cuentaId ?? propuestaId ?? "";
    const orden = [...cuentas].sort((a, b) => (a.id === propuestaId ? -1 : b.id === propuestaId ? 1 : a.codigo.localeCompare(b.codigo)));
    return (
      <div className="space-y-2">
        {p?.nota && <p className="rounded-md border border-accent-sun/40 bg-accent-sun/10 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink"><Ico e="⚠️" /> {p.nota}</p>}
        <label className="block space-y-1 text-[11px] font-semibold text-ink-secondary">
          A dónde va
          <select value={valor} onChange={(e) => { const c = cuentas.find((x) => String(x.id) === e.target.value); onAjuste(c ? { cuentaId: c.id, cuentaCodigo: c.codigo, cuentaNombre: c.nombre } : { cuentaId: undefined, cuentaCodigo: undefined, cuentaNombre: undefined }); }}
            className="block w-full rounded-lg border-2 border-border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent">
            <option value="">Elegir cuenta…</option>
            {orden.map((c) => (<option key={c.id} value={String(c.id)}>{c.codigo} · {c.nombre}{c.id === propuestaId ? "  ← propuesta" : ""}</option>))}
          </select>
        </label>
        <div className="flex gap-2"><button className={BTN} onClick={() => irA("asiento")}>Listo · al asiento →</button></div>
      </div>
    );
  }

  if (clave === "asiento" && l.estado === "revisando") {
    return <p className="text-[12.5px] text-muted">Buscando en el libro… el emergente se actualiza solo cuando esté.</p>;
  }

  if (clave === "asiento") {
    if (l.candidatos.length) {
      return (
        <div className="space-y-1.5">
          {l.candidatos.map((c) => (<CuadroCandidato key={c.movimiento_id} c={c} elegido={c.movimiento_id === candElegido?.movimiento_id} onElegir={() => onAjuste({ candidato: c.movimiento_id })} />))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={BTN} onClick={() => irA("vinculo")}>Es este · al vínculo →</button>
            <button className={BTN_SEC} onClick={() => setFormulario(true)}>No es ninguno · causar aparte</button>
          </div>
          {formulario && (
            <div className="mt-2 border-t border-border pt-2">
              <FormCausar linea={l} ajuste={ajuste} cuentas={cuentas} medios={medios} onCerrar={() => setFormulario(false)} onHecho={() => { setFormulario(false); onHecho(); }} />
            </div>
          )}
        </div>
      );
    }
    const plan = planDeUnClic(l, ajuste, cuentas, medios);
    const retiroMP = esRetiroMP(l);
    // Un giro a un proveedor no es un gasto de un clic: si fue mercancía, tiene
    // que entrar por la solicitud de compra para que quede contra inventario por
    // SKU, con su factura y su espejo. El clic rápido queda para lo que de verdad
    // es un gasto: GMF, intereses, costo bancario, DIAN.
    const pareceCompra = l.tipo === "debito" && /PAGO A PROVE|PAGO DE PROV|ABONO A PR|PAGO PSE/i.test(l.descripcion);
    return (
      <div className="space-y-2">
        {p?.nota && !formulario && <p className="rounded-md border border-accent-sun/40 bg-accent-sun/10 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink"><Ico e="⚠️" /> {p.nota}</p>}
        {!formulario && retiroMP && <LoteMercadoPago l={l} />}
        {!formulario && l.tipo === "debito" && (
          <div className={`rounded-lg border p-2.5 ${pareceCompra ? "border-accent/50 bg-accent/5" : "border-border bg-surface"}`}>
            <p className="text-[12px] font-bold text-ink">{pareceCompra ? "Parece una compra a un proveedor." : "¿Fue una compra o un servicio?"}</p>
            <p className="mt-0.5 text-[11.5px] text-muted">Entra por la solicitud de compra: proveedor, productos del catálogo (o uno nuevo), factura cotejada, IVA descontable, inventario 1435 y espejo en Alegra. Al registrarla queda vinculada a esta línea.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={pareceCompra ? "rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white" : BTN} onClick={() => onRegistrarCompra("productos")}><Ico e="📦" /> Compra con productos</button>
              <button className={BTN_SEC} onClick={() => onRegistrarCompra("servicios")}><Ico e="🛠️" /> Servicio</button>
            </div>
          </div>
        )}
        {!formulario ? (
          <div className="flex flex-wrap gap-2">
            {plan && (
              <button type="button" disabled={ocupado} onClick={() => onCausar(plan)} className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                title={`Crea el asiento contra ${plan.etiqueta} y lo deja vinculado a esta línea`}>
                {ocupado ? "Causando…" : `Causar así · ${plan.etiqueta}`}
              </button>
            )}
            <button className={plan ? BTN_SEC : BTN} onClick={() => setFormulario(true)}>{plan ? "Ajustar antes de causar" : "Causar el asiento"}</button>
            {!plan && piezas.cuenta.estado !== "ok" && <button className={BTN_SEC} onClick={() => irA("cuenta")}>Primero la cuenta (2) →</button>}
          </div>
        ) : (
          <FormCausar linea={l} ajuste={ajuste} cuentas={cuentas} medios={medios} onCerrar={() => setFormulario(false)} onHecho={() => { setFormulario(false); onHecho(); }} />
        )}
      </div>
    );
  }

  // vínculo
  return (
    <div className="space-y-2">
      {candElegido ? (
        <>
          <CuadroCandidato c={candElegido} elegido onElegir={() => undefined} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={ocupado} onClick={() => onVincular(candElegido.movimiento_id)} className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" title="Enter">
              {ocupado ? "Vinculando…" : "Vincular · es el mismo movimiento"}
            </button>
            {l.candidatos.length > 1 && <button className={BTN_SEC} onClick={() => irA("asiento")}>Ver los otros</button>}
          </div>
        </>
      ) : (
        <button className={BTN} onClick={() => irA("asiento")}>Ir al asiento (3) →</button>
      )}
    </div>
  );
}

/**
 * Un retiro de MercadoPago no es una venta: es el lote de ventas MeLi que
 * MercadoPago liberó desde el retiro anterior. Se enseña ese lote —cada pago
 * con su orden, su asiento de venta y su factura— y cuánto queda en la
 * plataforma, para que el traslado Debe Bancos / Haber 111010 se cause con
 * conocimiento de causa.
 */
function LoteMercadoPago({ l }: { l: LineaBanco }) {
  const q = useQuery<LoteMP & { error?: string }>({
    queryKey: ["mp-lote", l.id],
    queryFn: () => api.get(`/api/contabilidad/conciliacion/mp-lote?linea_id=${l.id}`, { timeoutMs: 60_000 }),
    retry: false,
    staleTime: 300_000,
  });
  if (q.isLoading) return <p className="text-[12px] text-muted">Pidiéndole a MercadoPago qué liberó en este lote…</p>;
  if (q.isError || q.data?.error) return <p className="rounded-md border border-accent-sun/40 bg-accent-sun/10 px-2.5 py-1.5 text-[11.5px] text-ink"><Ico e="⚠️" /> MercadoPago no respondió: {(q.error as Error)?.message || q.data?.error}. El traslado se puede causar igual; el lote se consulta después.</p>;
  const d = q.data!;
  const sinAsiento = d.pagos.filter((p) => p.order_id && !p.asiento);
  const sinFactura = d.pagos.filter((p) => p.order_id && !p.factura);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-input p-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Lote de MercadoPago · liberado del {diaCorto(d.ventana.desde)} al {diaCorto(d.ventana.hasta)}{d.retiro_anterior ? ` (desde el retiro anterior, ${diaCorto(d.retiro_anterior.fecha)})` : ""}</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[["Liberado bruto", d.liberado_bruto], ["Comisiones", -d.comisiones], ["Liberado neto", d.liberado_neto], ["Retirado", d.retirado]].map(([k, v]) => (
          <div key={String(k)} className="rounded-md border border-border bg-surface px-2 py-1"><p className="text-[9.5px] font-bold uppercase text-muted">{k}</p><p className="font-mono text-[12.5px] font-extrabold tabular-nums text-ink">{formatCop(Number(v))}</p></div>
        ))}
      </div>
      <p className={`font-mono text-[11.5px] ${Math.abs(d.queda_en_plataforma) < 1 ? "text-accent-leaf" : "text-ink"}`}>
        {d.n_pagos} pagos · {d.n_con_asiento} con asiento de venta · {d.n_con_factura} con factura ·{" "}
        {d.queda_en_plataforma >= 0 ? <>quedan <b>{formatCop(d.queda_en_plataforma)}</b> en la plataforma</> : <>se retiró <b>{formatCop(-d.queda_en_plataforma)}</b> más de lo liberado en la ventana (saldo de lotes anteriores)</>}
        {d.saldo_111010_libro != null && <span className="text-muted"> · {d.cuenta_mp} MercadoPago en el libro: {formatCop(d.saldo_111010_libro)}</span>}
      </p>
      {(sinAsiento.length > 0 || sinFactura.length > 0) && (
        <p className="text-[11px] text-accent-sun">{sinAsiento.length ? `${sinAsiento.length} pago(s) sin asiento de venta en el libro. ` : ""}{sinFactura.length ? `${sinFactura.length} sin factura en el índice MeLi.` : ""}</p>
      )}
      <div className="max-h-48 overflow-auto rounded-md border border-border bg-surface">
        <table className="w-full text-left text-[10.5px]">
          <thead className="sticky top-0 bg-surface-panel text-[9.5px] uppercase text-muted"><tr><th className="px-1.5 py-1">Liberado</th><th className="px-1.5 py-1">Orden MeLi</th><th className="px-1.5 py-1 text-right">Bruto</th><th className="px-1.5 py-1 text-right">Neto</th><th className="px-1.5 py-1">Asiento</th><th className="px-1.5 py-1">Factura</th></tr></thead>
          <tbody>
            {d.pagos.map((p) => (
              <tr key={p.payment_id} className="border-t border-border/60">
                <td className="whitespace-nowrap px-1.5 py-0.5 font-mono">{diaCorto(p.fecha_liberacion)}</td>
                <td className="px-1.5 py-0.5 font-mono text-ink" title={p.descripcion}>{p.order_id || p.referencia || p.payment_id}</td>
                <td className="px-1.5 py-0.5 text-right font-mono tabular-nums">{formatCop(p.bruto)}</td>
                <td className="px-1.5 py-0.5 text-right font-mono tabular-nums">{formatCop(p.neto)}</td>
                <td className={`px-1.5 py-0.5 font-mono ${p.asiento ? "text-accent-leaf" : "text-accent-rose"}`}>{p.asiento ? `✓ #${p.asiento.movimiento_id}` : p.order_id ? "✗" : "—"}</td>
                <td className={`px-1.5 py-0.5 font-mono ${p.factura ? "text-accent-leaf" : "text-muted"}`}>{p.factura ? `✓ ${p.factura.numero}` : p.order_id ? "sin factura" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Emergente de una pieza ─────────────────────────────────────────────── */

/**
 * Una pieza de la línea en un EMERGENTE sobre el tablero, igual que en Combos.
 * Arriba la pregunta que guía; abajo «siguiente pendiente», para recorrer las
 * piezas sin volver al tablero. Esc lo cierra si no hay otro encima.
 */
function PiezaEmergente({ pregunta, recien, siguiente, onSiguiente, onCerrar, children }: {
  pregunta: string; recien: string | null; siguiente: { clave: ClavePieza; titulo: string } | null; onSiguiente: () => void; onCerrar: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape" && document.querySelectorAll('[role="dialog"][aria-modal="true"][data-pieza]').length === 1) onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" data-pieza="1" aria-label="Pieza de la línea" onClick={onCerrar}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl" onClick={(ev) => ev.stopPropagation()}>
        {recien && <p className="mck-mision-gana-tira shrink-0 border-b border-accent-leaf/40 bg-accent-leaf/15 px-4 py-1.5 text-[12px] font-bold text-ink"><Ico e="✅" /> {recien} — seguimos con la siguiente pieza.</p>}
        {pregunta && <p className="shrink-0 border-b border-border bg-accent/5 px-4 py-2 text-[13px] leading-snug text-ink">{pregunta}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2">
          {siguiente && <button className={BTN_SEC} onClick={onSiguiente}>Siguiente pendiente: {siguiente.titulo} →</button>}
          <span className="flex-1" />
          <button className={BTN_SEC} onClick={onCerrar}>Volver al tablero</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Tablero contable ───────────────────────────────────────────────────── */

const COLOR_PIEZA = { ok: "border-accent-leaf/70", aviso: "border-accent-sun/80", falta: "border-dashed border-accent-rose/70" } as const;
const PUNTO_PIEZA = { ok: "bg-accent-leaf", aviso: "bg-accent-sun", falta: "bg-accent-rose" } as const;

/** Una cuenta T, calcada de la de Solicitudes de pago (`CuentaEnT`), con el saldo antes y después. */
function CuentaEnT({ t, posteado }: { t: CuentaT; posteado: boolean }) {
  const sube = t.efecto > 0;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-2 py-1">
        <p className="font-mono text-xs font-bold text-accent">{t.cuenta_codigo}</p>
        <p className="truncate text-xs font-semibold text-ink" title={t.cuenta_nombre}>{t.cuenta_nombre}</p>
        <p className="text-[10px] uppercase text-muted">{t.tipo} · naturaleza {t.naturaleza}</p>
      </div>
      <div className="grid grid-cols-2 border-b border-border text-[10px] font-bold uppercase text-muted">
        <span className="border-r border-border px-2 py-0.5 text-center">Debe</span>
        <span className="px-2 py-0.5 text-center">Haber</span>
      </div>
      <div className="grid min-h-[1.75rem] grid-cols-2">
        <div className="border-r border-border">
          {t.movimientos.filter((m) => m.debito > 0).map((m, i) => (<p key={i} className="px-2 py-1 text-right text-xs tabular-nums text-ink" title={m.descripcion}>{formatCop(m.debito)}</p>))}
        </div>
        <div>
          {t.movimientos.filter((m) => m.credito > 0).map((m, i) => (<p key={i} className="px-2 py-1 text-right text-xs tabular-nums text-ink" title={m.descripcion}>{formatCop(m.credito)}</p>))}
        </div>
      </div>
      <div className="border-t border-border bg-surface-panel px-2 py-1 text-[11px]">
        <p className="flex justify-between text-muted"><span>{posteado ? "Saldo antes" : "Saldo actual"}</span><span className="tabular-nums">{formatCop(t.saldo_antes)}</span></p>
        <p className="flex justify-between font-bold text-ink">
          <span>{posteado ? "Saldo actual" : "Queda en"}</span>
          <span className={`tabular-nums ${sube ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"}`}>{formatCop(t.saldo_despues)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * El caso en foco como lo leería un contador: arriba la línea del banco y las
 * cuatro piezas; en el centro el asiento que la explica —el real si está
 * vinculada, el candidato si el libro tiene uno que calza, o el que se propone
 * causar— como libro diario o como cuentas T; abajo, el cotejo banco ↔ asiento.
 */
function TableroContable({ l, piezas, sel, guia, destello, premio, onSel }: {
  l: LineaBanco; piezas: Record<ClavePieza, Pieza>; sel: ClavePieza; guia: ClavePieza | null; destello: Set<string>; premio: boolean; onSel: (k: ClavePieza) => void;
}) {
  const barbie = usePanelTheme((s) => s.skin) === "barbie";
  const salida = l.tipo === "debito";
  const ok = okDe(piezas);
  const comp = comprobado(l);
  const v = l.asiento_vista;
  // Diario o T: se recuerda como en Solicitudes de pago (misma clave).
  const [vista, setVista] = useState<"diario" | "t">(() => { try { return localStorage.getItem("pagos-vista-asiento") === "t" ? "t" : "diario"; } catch { return "diario"; } });
  const cambiarVista = (x: "diario" | "t") => { setVista(x); try { localStorage.setItem("pagos-vista-asiento", x); } catch { /* modo privado */ } };
  const totalD = (v?.lineas ?? []).reduce((a, x) => a + x.debito, 0);
  const totalC = (v?.lineas ?? []).reduce((a, x) => a + x.credito, 0);
  const enBanco = (v?.lineas ?? []).filter((x) => x.cuenta_codigo.startsWith("11"));
  const pata = v?.patas_banco?.find((p) => Math.round(p.monto) === Math.round(l.monto));
  const giraAsiento = pata ? pata.monto : enBanco.length ? Math.max(enBanco.reduce((a, x) => a + x.credito, 0), enBanco.reduce((a, x) => a + x.debito, 0)) : null;
  const posteado = v?.origen !== "propuesto";
  const ORIGEN = {
    real: { rotulo: "Asiento vinculado", tono: "border-accent-leaf/50 bg-accent-leaf/5" },
    candidato: { rotulo: "Calza este asiento del libro", tono: "border-accent-sun/50 bg-accent-sun/5" },
    propuesto: { rotulo: v?.confianza === "alta" ? "Se propone causar así" : "Se propondría causar así (por confirmar)", tono: "border-accent/40 bg-accent/5" },
  } as const;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {/* La línea del banco y las piezas, como una fila de comprobante. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <div className={`flex min-w-[220px] flex-1 items-center gap-3 rounded-lg border-2 px-3 py-2 ${salida ? "border-accent-rose/50 bg-accent-rose/5" : "border-accent-leaf/50 bg-accent-leaf/5"}`}>
          <span className="text-xl" aria-hidden><Ico e={salida ? "📤" : "📥"} /></span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Banco · {l.banco || "Bancolombia"} · {l.tipo === "debito" ? "débito (salió)" : "crédito (entró)"}</p>
            <p className={`font-mono text-lg font-extrabold tabular-nums ${salida ? "text-accent-rose" : "text-accent-leaf"}`}>{salida ? "−" : "+"}{formatCop(l.monto)}</p>
            <p className="truncate text-[12px] text-ink" title={l.descripcion}>{diaCorto(l.fecha)} · {l.descripcion}{l.referencia ? <span className="text-muted"> · cód {l.referencia}</span> : null}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
          {PIEZAS.map(({ clave, icono, titulo, corto }) => {
            const e = piezas[clave];
            const activo = sel === clave;
            return (
              <div key={clave} className={`mck-mision-nodo relative ${destello.has(clave) ? "mck-mision-gana" : ""}`}>
                <button onClick={() => onSel(clave)} aria-pressed={activo} title={`${titulo}: ${textoEstado(e)} — ${e.detalle}`}
                  className={`mck-flujo-nodo block h-full w-full rounded-lg border-2 bg-surface-panel px-2 py-1.5 text-left transition ${COLOR_PIEZA[e.estado]} ${activo ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-panel" : "hover:border-accent"} ${guia === clave && !activo ? "mck-mision-pulso" : ""}`}>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] leading-none" aria-hidden><Ico e={icono} /></span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink"><span className="mck-nodo-largo">{titulo}</span><span className="mck-nodo-corto">{corto}</span></span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_PIEZA[e.estado]}`} />
                  </span>
                  <span className={`mt-0.5 block truncate font-mono text-[9.5px] ${e.estado === "ok" ? "text-muted" : e.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{e.dato || textoEstado(e)}</span>
                </button>
                {destello.has(clave) && <span className="mck-mision-sube pointer-events-none absolute -top-3 right-2 font-mono text-[11px] font-bold text-accent-leaf">+1 conexión</span>}
              </div>
            );
          })}
          <div className={`mck-mision-nodo relative ${destello.has("comprobado") ? "mck-mision-gana" : ""}`}>
            <button onClick={l.estado === "vinculada" ? () => onSel("vinculo") : undefined} disabled={l.estado !== "vinculada"} title={`Comprobado: ${textoEstado(comp)} — ${comp.detalle}`}
              className={`mck-flujo-nodo block h-full w-full rounded-lg border-2 bg-surface-panel px-2 py-1.5 text-left transition ${COLOR_PIEZA[comp.estado]} ${l.estado === "vinculada" ? "hover:border-accent" : "cursor-default opacity-80"}`}>
              <span className="flex items-center gap-1.5">
                <span className="text-[13px] leading-none" aria-hidden><Ico e="✅" /></span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink">Comprobado</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${PUNTO_PIEZA[comp.estado]}`} />
              </span>
              <span className={`mt-0.5 block truncate font-mono text-[9.5px] ${comp.estado === "ok" ? "text-muted" : comp.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{comp.dato || (l.estado === "vinculada" ? textoEstado(comp) : `${ok}/${TOTAL} piezas`)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* El asiento. */}
      {v ? (
        <div className={`rounded-xl border p-3 ${ORIGEN[v.origen].tono}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">{ORIGEN[v.origen].rotulo}{v.fuente ? ` · ${v.fuente}` : ""}</p>
              <p className="truncate text-[13px] font-bold text-ink">{v.titulo}</p>
            </div>
            {v.cuentas_t.length > 0 && (
              <div className="flex gap-1" role="tablist" aria-label="Cómo ver el asiento">
                {([["diario", "Libro diario"], ["t", "Cuentas T"]] as const).map(([x, label]) => (
                  <button key={x} type="button" role="tab" aria-selected={vista === x} onClick={() => cambiarVista(x)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${vista === x ? "bg-accent text-white" : "border border-border bg-surface text-muted hover:text-ink"}`}>{label}</button>
                ))}
              </div>
            )}
          </div>

          {(v.ajustes?.length || v.documento_soporte) ? <div className="mt-2"><Cadena ajustes={v.ajustes} ds={v.documento_soporte} patas={v.patas_banco} /></div> : null}
          {v.lineas.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted">Es un asiento de {v.fuente || "otra fuente"} por {formatCop(v.monto ?? 0)}: sus cuentas viven en esa fuente, no en el libro propio.</p>
          ) : vista === "t" && v.cuentas_t.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {v.cuentas_t.map((t) => <CuentaEnT key={t.cuenta_codigo} t={t} posteado={posteado} />)}
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted"><tr><th className="py-1 pr-2 font-bold">Cuenta</th><th className="py-1 pr-2 font-bold">Nombre</th><th className="py-1 pr-2 text-right font-bold">Débito</th><th className="py-1 pr-2 text-right font-bold">Crédito</th><th className="py-1 font-bold">Tercero</th></tr></thead>
                <tbody>
                  {v.lineas.map((x, i) => (
                    <tr key={`${x.cuenta_codigo}-${i}`} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-mono text-accent">{x.cuenta_codigo}</td>
                      <td className="py-1 pr-2 text-ink">{x.cuenta_nombre}<span className="block text-xs text-muted">{x.descripcion}</span></td>
                      <td className="py-1 pr-2 text-right tabular-nums">{x.debito ? formatCop(x.debito) : "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{x.credito ? formatCop(x.credito) : "—"}</td>
                      <td className="py-1 text-xs text-muted">{x.tercero}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-border font-bold">
                  <td className="py-1 pr-2" colSpan={2}>Sumas iguales</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCop(totalD)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatCop(totalC)}</td>
                  <td className={`py-1 text-xs ${Math.abs(totalD - totalC) < 0.5 ? "text-accent-leaf" : "text-accent-rose"}`}>{Math.abs(totalD - totalC) < 0.5 ? "✓ balancea" : "✗ no balancea"}</td>
                </tr></tfoot>
              </table>
            </div>
          )}

          {/* El cotejo: lo que el asiento pasa por bancos contra lo que el banco dice. */}
          {giraAsiento != null && (
            <p className={`mt-2 flex flex-wrap items-center gap-x-3 rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px] ${Math.round(giraAsiento) === Math.round(l.monto) ? "border-accent-leaf/50 bg-accent-leaf/10 text-ink" : "border-accent-rose/50 bg-accent-rose/10 text-ink"}`}>
              <span>banco {formatCop(l.monto)}</span><span className="text-muted">↔</span><span>asiento en bancos {formatCop(giraAsiento)}</span>
              <b className={Math.round(giraAsiento) === Math.round(l.monto) ? "text-accent-leaf" : "text-accent-rose"}>{Math.round(giraAsiento) === Math.round(l.monto) ? "✓ al peso" : `✗ dif. ${formatCop(Math.abs(giraAsiento - l.monto))}`}</b>
              {totalD !== giraAsiento && <span className="text-muted">· total del comprobante {formatCop(totalD)}{totalD > giraAsiento ? " (retención o IVA aparte)" : ""}</span>}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-accent-rose/50 bg-accent-rose/5 p-4 text-center text-[12.5px] text-ink">
          {l.estado === "revisando" ? "Buscando en el libro un asiento que calce…" : "No hay asiento en el libro ni propuesta de cuenta para esta línea. Decide quién y a dónde (piezas 1 y 2) y cáusala en la pieza 3."}
        </div>
      )}

      {premio && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {barbie
            ? Array.from({ length: 34 }, (_, i) => (<span key={i} className="mck-mision-estrella" style={{ left: `${(i * 37 + 7) % 96}%`, top: `${(i * 53 + 11) % 88}%`, fontSize: `${10 + ((i * 7) % 4) * 6}px`, animationDelay: `${(i % 11) * 110}ms`, color: ["#ff4fa3", "#ffd76a", "#c89bff", "#ffffff", "#ff9ecf"][i % 5] }}>{i % 3 ? "✦" : "★"}</span>))
            : Array.from({ length: 26 }, (_, i) => (<span key={i} className="mck-mision-confeti" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 90}ms`, background: ["#0891b2", "#059669", "#d97706", "#7c3aed", "#e11d48"][i % 5] }} />))}
        </div>
      )}
    </div>
  );
}

/* ─── La cola ────────────────────────────────────────────────────────────── */

const COLOR_SEG = { ok: "bg-accent-leaf", aviso: "bg-accent-sun", falta: "bg-accent-rose" } as const;

const FILTROS_LISTA: { id: string; nombre: string; pasa: (l: LineaBanco, ok: number) => boolean }[] = [
  { id: "pendientes", nombre: "Por conciliar", pasa: (l) => l.estado !== "vinculada" },
  { id: "casi", nombre: "A una pieza", pasa: (l, ok) => l.estado !== "vinculada" && ok === TOTAL - 1 },
  { id: "sugerida", nombre: "Con asiento", pasa: (l) => l.estado === "sugerida" },
  { id: "sin_causar", nombre: "Por causar", pasa: (l) => l.estado === "sin_causar" },
  { id: "dudosas", nombre: "Dudosas", pasa: (l) => l.estado === "sugerida" && l.candidatos.length > 1 },
  { id: "alta", nombre: "Cuenta clara", pasa: (l) => l.estado === "sin_causar" && l.propuesta?.confianza === "alta" },
  { id: "descuadradas", nombre: "Descuadradas", pasa: (l) => l.estado === "vinculada" && comprobado(l).estado === "falta" },
  { id: "vinculada", nombre: "Conciliadas", pasa: (l) => l.estado === "vinculada" },
  { id: "todas", nombre: "Todas", pasa: () => true },
];

/**
 * Todas las líneas del rango, en la misma ventana del tablero. Es a la vez el
 * índice y la cola: lo que se filtra acá es lo que recorren «Anterior /
 * Siguiente». Cada segmento de una fila es una pieza de esa línea: tocarlo
 * abre la línea directamente en esa pieza. El quinto, más corto, es la comprobación.
 */
function ListaLineas({ lineas, piezasDe, total, actual, q, setQ, filtro, setFiltro, conteos, onElegir }: {
  lineas: LineaBanco[]; piezasDe: (l: LineaBanco) => Record<ClavePieza, Pieza>; total: number; actual: number | null; q: string; setQ: (v: string) => void;
  filtro: string; setFiltro: (v: string) => void; conteos: Record<string, number>; onElegir: (id: number, pieza?: ClavePieza) => void;
}) {
  useEffect(() => {
    if (actual != null) document.getElementById(`conc-fila-${actual}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [actual, lineas.length]);
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-2">
      <div className="flex min-w-0 items-center gap-1.5 xl:block">
        <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar por descripción o monto…" aria-label="Buscar línea del banco" className="w-52 shrink-0 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink xl:w-full" />
        <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5 xl:mt-1.5 xl:flex-wrap xl:overflow-visible">
          {FILTROS_LISTA.filter((f) => f.id !== "descuadradas" || (conteos.descuadradas ?? 0) > 0).map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`mck-flujo-nodo shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold ${filtro === f.id ? "border-accent bg-accent text-white" : f.id === "descuadradas" ? "border-accent-rose/60 bg-accent-rose/10 text-ink" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50"}`}>
              {f.nombre} <span className="tabular-nums opacity-75">{conteos[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 hidden font-mono text-[9.5px] text-muted xl:block">{lineas.length} de {total} · primero las más cerca de quedar conciliadas</p>
      <div className="mt-1 flex min-h-0 flex-1 gap-1 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-y-auto xl:overflow-x-hidden xl:pb-0 xl:pr-0.5">
        {lineas.map((l) => {
          const aqui = l.id === actual;
          const pz = piezasDe(l);
          const ok = okDe(pz);
          const salida = l.tipo === "debito";
          const comp = comprobado(l);
          return (
            <div key={l.id} id={`conc-fila-${l.id}`} className={`w-56 shrink-0 rounded-lg border p-1.5 transition xl:w-auto ${aqui ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}>
              <button onClick={() => onElegir(l.id)} aria-current={aqui ? "true" : undefined} className="mck-btn-no-fx flex w-full items-center gap-2 text-left">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center whitespace-pre rounded-md border text-center font-mono text-[9px] font-bold leading-tight ${salida ? "border-accent-rose/40 bg-accent-rose/10 text-accent-rose" : "border-accent-leaf/40 bg-accent-leaf/10 text-accent-leaf"}`}>
                  {diaCorto(l.fecha).replace(" ", "\n")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-bold leading-tight text-ink">{l.descripcion}</span>
                  <span className={`block truncate font-mono text-[9.5px] tabular-nums ${salida ? "text-accent-rose" : "text-accent-leaf"}`}>{salida ? "−" : "+"}{formatCop(l.monto)}</span>
                </span>
                <span className={`shrink-0 rounded-full px-1.5 font-mono text-[10px] font-bold tabular-nums ${l.estado === "vinculada" ? (comp.estado === "ok" ? "bg-accent-leaf text-white" : comp.estado === "falta" ? "bg-accent-rose text-white" : "bg-accent-sun/40 text-ink") : ok === TOTAL - 1 ? "bg-accent-sun/25 text-ink" : "bg-surface text-muted"}`}>
                  {l.estado === "vinculada" ? (comp.estado === "ok" ? "✓" : comp.estado === "falta" ? "✗" : "…") : `${ok}/${TOTAL}`}
                </span>
              </button>
              <div className="mt-1 flex gap-0.5">
                {PIEZAS.map(({ clave, titulo }) => (
                  <button key={clave} onClick={() => onElegir(l.id, clave)} title={`${titulo}: ${textoEstado(pz[clave])} — abrir en esta pieza`} aria-label={`${l.descripcion}: ${titulo}`} className={`mck-btn-no-fx h-2 flex-1 rounded-full transition hover:scale-y-150 ${COLOR_SEG[pz[clave].estado]}`} />
                ))}
                <span title={`Comprobado: ${textoEstado(comp)} — ${comp.detalle}`} className={`h-2 w-3 shrink-0 rounded-full ${l.estado === "vinculada" ? COLOR_SEG[comp.estado] : "bg-border"}`} />
              </div>
            </div>
          );
        })}
        {lineas.length === 0 && <p className="px-1 py-3 text-[11.5px] text-muted">Ninguna línea con ese filtro.</p>}
      </div>
    </div>
  );
}

/* ─── Alto disponible ────────────────────────────────────────────────────── */

/**
 * El taller ocupa EXACTAMENTE lo que queda de ventana bajo su cabecera, como
 * el Taller de Combos: nada obliga a desplazar; solo la lista y el tablero
 * tienen su propio desplazamiento. Por debajo de 1024 px se apila (`null`).
 */
function useAltoDisponible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      setAlto(window.innerWidth < 1024 ? null : Math.max(440, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 10)));
    };
    medir();
    window.addEventListener("resize", medir);
    const ro = new ResizeObserver(medir);
    ro.observe(document.body);
    return () => { window.removeEventListener("resize", medir); ro.disconnect(); };
  }, []);
  return { ref, alto };
}

/* ─── El taller ──────────────────────────────────────────────────────────── */

export default function TallerConciliacion() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [desde, setDesde] = useState(inicioDeMes);
  const [hasta, setHasta] = useState(hoy);
  const [incluirMeli, setIncluirMeli] = useState(true);
  const [incluirSiigo, setIncluirSiigo] = useState(true);
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [dropActivo, setDropActivo] = useState(false);
  const [huerfanosAbierto, setHuerfanosAbierto] = useState(false);
  // La compra abierta encima del taller, y el alta de producto encima de ella.
  const [compra, setCompra] = useState<CompraAbierta | null>(null);
  const [crearProducto, setCrearProducto] = useState(false);
  const categoriasQ = useQuery<{ categorias: Categoria[] }>({ queryKey: ["pagos-categorias"], queryFn: () => api.get("/api/pagos/categorias"), enabled: Boolean(compra) });
  // La categoría no se fija por id (cambian): productos = la que lleva SKU sin
  // exigir factura de entrada; servicios = la primera sin productos.
  const categoriaCompra = useMemo(() => {
    const cats = categoriasQ.data?.categorias ?? [];
    if (!compra) return null;
    return compra.tipo === "productos"
      ? (cats.find((c) => c.con_productos && !c.requiere_factura) ?? cats.find((c) => c.con_productos))?.id ?? null
      : cats.find((c) => !c.con_productos && /servic/i.test(c.label))?.id ?? cats.find((c) => !c.con_productos)?.id ?? null;
  }, [categoriasQ.data, compra]);

  const claveQ = ["conciliacion-taller", desde, hasta, incluirMeli, incluirSiigo] as const;
  const tableroQ = useQuery<Tablero>({
    queryKey: claveQ,
    queryFn: () => {
      const p = new URLSearchParams({ desde, hasta, meli: incluirMeli ? "1" : "0", siigo: incluirSiigo ? "1" : "0" });
      return api.get(`/api/contabilidad/conciliacion/taller?${p}`, { timeoutMs: 90_000 });
    },
    retry: 1,
    // Mientras el libro se arma en el servidor, se vuelve a preguntar cada 3 s.
    // En cuanto está, se deja de preguntar: ahí manda la caché de 5 min del servidor.
    refetchInterval: (q) => (q.state.data && !q.state.data.libro_listo ? 3000 : false),
  });
  const refrescarLibroMut = useMutation({
    mutationFn: () => {
      const p = new URLSearchParams({ desde, hasta, meli: incluirMeli ? "1" : "0", siigo: incluirSiigo ? "1" : "0", refrescar: "1" });
      return api.get<Tablero>(`/api/contabilidad/conciliacion/taller?${p}`, { timeoutMs: 90_000 });
    },
    onSuccess: (data) => qc.setQueryData(claveQ, data),
  });
  const cuentasQ = useQuery<{ cuentas: PlanCuenta[] }>({ queryKey: ["cc-plan-cuentas-taller"], queryFn: () => api.get("/api/contabilidad/cc/plan-cuentas?activas=0") });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({ queryKey: ["cc-medios-pago-taller"], queryFn: () => api.get("/api/contabilidad/cc/medios-pago") });
  // Misma consulta que TerceroSelect: acá solo para ponerle nombre al id elegido.
  const tercerosQ = useQuery<{ terceros: { id: number; nombre: string }[] }>({ queryKey: ["cc-terceros-select"], queryFn: () => api.get("/api/contabilidad/cc/terceros?activos=1") });
  const cuentas = useMemo(() => cuentasQ.data?.cuentas ?? [], [cuentasQ.data]);
  const medios = useMemo(() => (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo), [mediosQ.data]);

  const todas = useMemo(() => tableroQ.data?.lineas ?? [], [tableroQ.data]);
  const porId = useMemo(() => new Map(todas.map((l) => [l.id, l])), [todas]);

  // Lo que el operador decidió sobre cada línea (quién, a dónde, cuál asiento).
  // Vive acá y no en el servidor: se consume al causar o vincular.
  const [ajustes, setAjustes] = useState<Record<number, Ajuste>>({});
  const piezasDe = (l: LineaBanco) => armarPiezas(l, ajustes[l.id]);

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("pendientes");
  const orden = (a: LineaBanco, b: LineaBanco) => {
    const ca = a.estado === "vinculada" ? 1 : 0;
    const cb = b.estado === "vinculada" ? 1 : 0;
    return ca - cb || (TOTAL - okDe(piezasDe(a))) - (TOTAL - okDe(piezasDe(b))) || a.fecha.localeCompare(b.fecha) || a.id - b.id;
  };
  const [ref, setRef] = useState<number | null>(() => {
    try {
      const g = Number(sessionStorage.getItem(CLAVE_LINEA));
      if (g) return g;
    } catch {
      /* sin almacenamiento */
    }
    return null;
  });
  // La lista ES la cola. La línea que se está trabajando nunca desaparece de
  // ella aunque deje de cumplir el filtro al conciliarse.
  const listaLineas = useMemo(() => {
    const texto = q.trim().toLowerCase();
    const digitos = texto.replace(/\D/g, "");
    const pasa = FILTROS_LISTA.find((f) => f.id === filtro)?.pasa ?? (() => true);
    return todas
      .filter((l) => l.id === ref || (pasa(l, okDe(piezasDe(l))) && (!texto || l.descripcion.toLowerCase().includes(texto) || (digitos && String(Math.round(l.monto)).includes(digitos)))))
      .sort(orden);
  }, [todas, q, filtro, ref, ajustes]); // eslint-disable-line react-hooks/exhaustive-deps
  const conteos = useMemo(() => Object.fromEntries(FILTROS_LISTA.map((f) => [f.id, todas.filter((l) => f.pasa(l, okDe(piezasDe(l)))).length])), [todas, ajustes]); // eslint-disable-line react-hooks/exhaustive-deps
  const cola = useMemo(() => listaLineas.map((l) => l.id), [listaLineas]);

  useEffect(() => {
    if (todas.length === 0) return;
    if (ref == null || !porId.has(ref)) setRef(listaLineas[0]?.id ?? todas[0].id);
  }, [todas, porId, ref, listaLineas]);
  useEffect(() => {
    try { if (ref != null) sessionStorage.setItem(CLAVE_LINEA, String(ref)); } catch { /* sin almacenamiento */ }
  }, [ref]);

  const l = ref != null ? porId.get(ref) ?? null : null;
  const piezas = useMemo(() => (l ? armarPiezas(l, ajustes[l.id]) : null), [l, ajustes]);
  const pos = ref != null ? cola.indexOf(ref) : -1;
  const guia = useMemo<ClavePieza | null>(() => (piezas ? ORDEN_GUIA.find((k) => piezas[k].estado === "falta") ?? ORDEN_GUIA.find((k) => piezas[k].estado === "aviso") ?? null : null), [piezas]);

  const [sel, setSel] = useState<ClavePieza>("tercero");
  const [piezaAbierta, setPiezaAbierta] = useState(false);
  const [recien, setRecien] = useState<string | null>(null);
  const piezaPedida = useRef<ClavePieza | null>(null);
  const tocarPieza = (k: ClavePieza) => { setSel(k); setRecien(null); setPiezaAbierta(true); };
  useEffect(() => {
    const pedida = piezaPedida.current;
    setSel(pedida ?? guia ?? "tercero");
    setRecien(null);
    setPiezaAbierta(Boolean(pedida));
    piezaPedida.current = null;
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  // El premio: comparar cada línea con cómo estaba la última vez que se vio.
  const antes = useRef<Map<number, Record<string, string>>>(new Map());
  const [destello, setDestello] = useState<Set<string>>(new Set());
  const [premio, setPremio] = useState(false);
  const [marcador, setMarcador] = useState(leerMarcador);
  const [conSonido, setConSonido] = useState(sonidoActivo);
  useEffect(() => {
    if (!l || !piezas) return;
    const ahora: Record<string, string> = { ...Object.fromEntries(ORDEN_GUIA.map((k) => [k, piezas[k].estado])), comprobado: comprobado(l).estado };
    const previo = antes.current.get(l.id);
    antes.current.set(l.id, ahora);
    if (!previo) { setPremio(false); return; }
    const ganadas = Object.keys(ahora).filter((k) => ahora[k] === "ok" && previo[k] !== "ok");
    if (!ganadas.length) return;
    const cerro = l.estado === "vinculada" && ahora.comprobado === "ok";
    setDestello(new Set(ganadas));
    setPremio(cerro);
    if (cerro && conSonido) sonarMoneda();
    setMarcador((m) => {
      const n = { dia: hoyClave(), conexiones: (m.dia === hoyClave() ? m.conexiones : 0) + ganadas.filter((k) => k !== "comprobado").length, lineas: (m.dia === hoyClave() ? m.lineas : 0) + (cerro ? 1 : 0) };
      try { localStorage.setItem(CLAVE_DIA, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
      return n;
    });
    const t = setTimeout(() => setDestello(new Set()), 2600);
    const siguientePieza = ORDEN_GUIA.find((k) => ahora[k] !== "ok");
    setRecien("Listo: " + ganadas.filter((k) => k !== "comprobado").map((k) => piezas[k as ClavePieza]?.titulo ?? k).join(" y "));
    if (cerro || !siguientePieza) setPiezaAbierta(false);
    if (siguientePieza) setSel(siguientePieza);
    return () => clearTimeout(t);
  }, [l, piezas]); // eslint-disable-line react-hooks/exhaustive-deps

  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ["conciliacion-taller"] });
    await qc.invalidateQueries({ queryKey: ["ingresos-egresos"] });
    await qc.invalidateQueries({ queryKey: ["extractos-bancarios"] });
    await qc.invalidateQueries({ queryKey: ["extractos-pendientes"] });
  };
  const mover = (d: number) => {
    if (!cola.length) return;
    const i = pos < 0 ? 0 : (pos + d + cola.length) % cola.length;
    setPremio(false);
    setRef(cola[i]);
  };
  const elegir = (id: number, pieza?: ClavePieza) => {
    setPremio(false);
    if (id === ref) { if (pieza) tocarPieza(pieza); return; }
    piezaPedida.current = pieza ?? null;
    setRef(id);
  };
  const ajustar = (id: number, a: Partial<Ajuste>) => {
    if ("terceroId" in a) a.terceroNombre = a.terceroId ? tercerosQ.data?.terceros.find((t) => t.id === a.terceroId)?.nombre ?? "(elegido)" : undefined;
    setAjustes((prev) => ({ ...prev, [id]: { ...prev[id], ...a } }));
  };

  const vincularMut = useMutation({
    mutationFn: async ({ linea, movimientoId }: { linea: LineaBanco; movimientoId: string }) => { await api.post("/api/contabilidad/extractos/vincular", { extracto_mov_id: linea.id, movimiento_id: movimientoId }); },
    onSuccess: async () => { setMsg(null); await refrescar(); },
    onError: (e: unknown) => setMsg((e as Error).message || "No se pudo vincular"),
  });
  const desvincularMut = useMutation({
    mutationFn: async (linea: LineaBanco) => { await api.post("/api/contabilidad/extractos/desvincular", { vinculo_id: linea.vinculo?.vinculo_id }); },
    onSuccess: async () => { setPiezaAbierta(false); await refrescar(); },
    onError: (e: unknown) => setMsg((e as Error).message || "No se pudo desvincular"),
  });
  const causarMut = useMutation({
    mutationFn: async ({ linea, plan }: { linea: LineaBanco; plan: Causacion }) => causarLinea(linea, plan),
    onSuccess: async () => { setMsg(null); await refrescar(); },
    onError: (e: unknown) => setMsg((e as Error).message || "No se pudo causar"),
  });
  // El cliente de la factura, al libro: tipo «cliente», jurídica si el NIT lo parece.
  const crearClienteMut = useMutation({
    mutationFn: async ({ lineaId, doc }: { lineaId: number; doc: Documento }) => {
      const ident = (doc.cliente.identificacion || "").replace(/\D/g, "");
      const t = await api.post<{ id: number; nombre: string; error?: string }>("/api/contabilidad/cc/terceros", {
        nombre: doc.cliente.nombre, tipo: "cliente", tipo_persona: ident.length === 9 ? "juridica" : "natural",
        identificacion: doc.cliente.identificacion || "", email: doc.cliente.correo || "",
      });
      if (t.error || !t.id) throw new Error(t.error || "No se pudo crear el cliente");
      return { lineaId, t };
    },
    onSuccess: ({ lineaId, t }) => {
      ajustar(lineaId, { terceroId: t.id, terceroNombre: t.nombre });
      void qc.invalidateQueries({ queryKey: ["cc-terceros-select"] });
      void qc.invalidateQueries({ queryKey: ["cc-terceros"] });
    },
    onError: (e: unknown) => setMsg((e as Error).message || "No se pudo crear el cliente"),
  });
  const ocupado = vincularMut.isPending || desvincularMut.isPending || causarMut.isPending || crearClienteMut.isPending;

  // ← → recorren la lista · 1–4 abren una pieza · Enter vincula lo que calza.
  // No actúan mientras se escribe ni con un emergente abierto.
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      // Con otro diálogo encima (una pieza, el wizard de compra, el alta de
      // producto) las teclas son suyas. El taller mismo es el primer diálogo.
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      if (ev.key === "ArrowRight") mover(1);
      else if (ev.key === "ArrowLeft") mover(-1);
      else if (/^[1-4]$/.test(ev.key)) tocarPieza(ORDEN_GUIA[Number(ev.key) - 1]);
      else if (ev.key === "Enter" && l && l.estado === "sugerida" && !ocupado) {
        const c = l.candidatos.find((x) => x.movimiento_id === ajustes[l.id]?.candidato) ?? l.candidatos[0];
        if (c) vincularMut.mutate({ linea: l, movimientoId: c.movimiento_id });
      } else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  /* ── Carga del archivo ── */
  const subir = async (archivos: File[]) => {
    if (!archivos.length) return;
    setSubiendo(true);
    setMsg(null);
    const partes: string[] = [];
    try {
      for (const file of archivos) {
        const fd = new FormData();
        fd.append("archivo", file);
        fd.append("banco", "Bancolombia");
        try {
          const r = await api.upload<{ error?: string; extracto?: { id: number; lineas_count: number; lineas_leidas?: number; lineas_repetidas?: number; lineas_mejoradas?: number; periodo_desde: string; periodo_hasta: string } }>("/api/contabilidad/extractos", fd, { timeoutMs: 180_000 });
          if (r.error) throw new Error(r.error);
          const e = r.extracto!;
          partes.push(`«${file.name}»: ${e.lineas_count} movimientos nuevos` + (e.lineas_repetidas ? `, ${e.lineas_repetidas} que ya estaban` : "") + (e.lineas_mejoradas ? ` (${e.lineas_mejoradas} con mejor descripción)` : "") + ` · ${e.periodo_desde} → ${e.periodo_hasta}`);
        } catch (err) {
          partes.push(`«${file.name}»: ${(err as Error).message}`);
        }
      }
      setMsg(partes.join(" · "));
      await refrescar();
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const hayArchivos = (dt: DataTransfer) => Array.from(dt.types || []).includes("Files");

  const { ref: raiz, alto } = useAltoDisponible<HTMLDivElement>();
  const t = tableroQ.data?.totales;
  const comp = tableroQ.data?.comprobacion;
  const conciliadas = t?.vinculada ?? 0;
  const totalLineas = t?.lineas ?? 0;
  const campoFecha = "rounded-md border border-border bg-surface-input px-1.5 py-0.5 text-[11.5px] text-ink outline-none focus:border-accent";

  return (
    <div
      ref={raiz}
      style={alto ? { height: alto } : undefined}
      className="flex min-h-0 flex-col gap-2"
      onDragEnter={(e) => { if (hayArchivos(e.dataTransfer)) { e.preventDefault(); setDropActivo(true); } }}
      onDragOver={(e) => { if (hayArchivos(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActivo(false); }}
      onDrop={(e) => { e.preventDefault(); setDropActivo(false); if (!subiendo) void subir(Array.from(e.dataTransfer.files)); }}
    >
      {/* Marcador — igual que en Combos: avance del extracto y lo hecho hoy. */}
      <div className={`flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border px-3 py-1.5 transition ${dropActivo ? "border-accent bg-accent/10" : "border-border bg-surface-panel"}`}>
        <div className="min-w-[220px] flex-1">
          <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            <span>{dropActivo ? "Suelta el archivo del banco" : "Extracto conciliado"}</span>
            <span className="tabular-nums text-ink">{conciliadas} / {totalLineas}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-input">
            <div className="h-full rounded-full bg-accent-leaf transition-all duration-700" style={{ width: `${(conciliadas / Math.max(totalLineas, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="mck-flujo-nodo text-[12px] text-ink"><b className="tabular-nums">{marcador.conexiones}</b> <span className="text-muted">conexiones hoy</span></div>
        <div className="mck-flujo-nodo text-[12px] text-ink"><Ico e="🏆" /> <b className="tabular-nums">{marcador.lineas}</b> <span className="text-muted">líneas conciliadas hoy</span></div>
        {t && <div className="mck-flujo-nodo font-mono text-[11px] text-accent-rose">sin causar {formatCop(t.monto_sin_causar)}</div>}
        {t && t.libro_sin_banco > 0 && (
          <button onClick={() => setHuerfanosAbierto((v) => !v)} className="mck-flujo-nodo rounded-md border border-accent-sun/60 bg-accent-sun/10 px-2 py-0.5 text-[11px] font-bold text-ink hover:bg-accent-sun/20" title="Asientos del libro en este rango que ningún movimiento del banco respalda">
            {t.libro_sin_banco} en el libro sin banco {huerfanosAbierto ? "▾" : "▸"}
          </button>
        )}
        <button onClick={() => { const v = !conSonido; setConSonido(v); ponerSonido(v); if (v) sonarMoneda(true); }} aria-pressed={conSonido}
          title={conSonido ? "Suena una moneda al conciliar una línea. Toca para silenciar." : "Sonido apagado. Toca para activarlo (y oírlo)."}
          className={`mck-flujo-nodo rounded-md border px-2 py-0.5 text-[11px] font-bold ${conSonido ? "border-accent/50 text-accent" : "border-border text-muted"}`}>
          <Ico e="🔊" /> {conSonido ? "sonido" : "en silencio"}
        </button>
      </div>

      {/* Comprobación: los dos lados de lo conciliado, sumados aparte. Si no dan lo
          mismo, hay un vínculo apuntando a un asiento con otra plata. */}
      {comp && comp.vinculadas > 0 && (
        <div className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-1.5 font-mono text-[11px] ${comp.descuadradas ? "border-accent-rose/60 bg-accent-rose/10" : "border-accent-leaf/50 bg-accent-leaf/10"}`}>
          <span className="font-bold uppercase tracking-wider text-muted">Comprobación</span>
          <span className="text-ink">{comp.cuadradas}/{comp.vinculadas} cuadran al peso</span>
          {comp.descuadradas > 0 && <button onClick={() => setFiltro("descuadradas")} className="rounded-md border border-accent-rose/60 bg-accent-rose/15 px-1.5 py-0.5 font-bold text-ink hover:bg-accent-rose/25">✗ {comp.descuadradas} descuadrada{comp.descuadradas === 1 ? "" : "s"} · ver</button>}
          {comp.sin_verificar > 0 && <span className="text-accent-sun">… {comp.sin_verificar} sin verificar (libro cargando)</span>}
          <span className="ml-auto text-ink">banco {formatCop(comp.banco_conciliado)} · libro {formatCop(comp.libro_conciliado)} · <b className={comp.diferencia ? "text-accent-rose" : "text-accent-leaf"}>dif. {formatCop(comp.diferencia)}</b></span>
        </div>
      )}

      {/* Rango y carga: del 1 del mes hasta hoy, como se pide en Sucursal Negocios. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-panel px-3 py-1.5 text-[11.5px]">
        <label className="flex items-center gap-1 text-muted">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={campoFecha} /></label>
        <label className="flex items-center gap-1 text-muted">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={campoFecha} /></label>
        <button className={BTN_SEC} onClick={() => { setDesde(inicioDeMes()); setHasta(hoy()); }} title="Lo mismo que se pide en Sucursal Negocios: del 1 del mes hasta hoy">Este mes hasta hoy</button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,.txt,.tsv,.pdf,.zip" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) void subir(f); }} />
        <button className={BTN} disabled={subiendo} onClick={() => fileRef.current?.click()}><Ico e="📥" /> {subiendo ? "Cargando…" : "Traer movimientos"}</button>
        <button className={`${BTN_SEC} ${guiaAbierta ? "border-accent text-accent" : ""}`} onClick={() => setGuiaAbierta((v) => !v)} aria-expanded={guiaAbierta}><Ico e="❓" /> ¿Cómo los bajo?</button>
        <button className={BTN_SEC} disabled={refrescarLibroMut.isPending || !tableroQ.data?.libro_listo} onClick={() => refrescarLibroMut.mutate()} title="Vuelve a pedir los asientos a Alegra y MeLi (el taller los guarda 5 min)"><Ico e="🔄" /> {refrescarLibroMut.isPending ? "Pidiendo…" : "Actualizar libro"}</button>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-ink"><input type="checkbox" checked={incluirSiigo} onChange={(e) => setIncluirSiigo(e.target.checked)} /> Alegra</label>
        <label className="flex items-center gap-1 text-ink"><input type="checkbox" checked={incluirMeli} onChange={(e) => setIncluirMeli(e.target.checked)} /> MeLi</label>
        {msg && <span className="basis-full text-[11.5px] text-ink">{msg}</span>}
        {(tableroQ.data?.avisos?.length ?? 0) > 0 && <span className="basis-full text-[11px] text-accent-sun">{tableroQ.data!.avisos.join(" · ")}</span>}
      </div>
      {guiaAbierta && <div className="shrink-0"><GuiaDescarga onCerrar={() => setGuiaAbierta(false)} /></div>}

      {tableroQ.data && !tableroQ.data.libro_listo && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-1.5 text-[12px] text-ink">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
          Armando el libro (Alegra y MeLi tardan ~30 s). Las líneas del banco ya están; los asientos que calzan aparecen solos cuando esté.
        </div>
      )}

      {huerfanosAbierto && (tableroQ.data?.libro_sin_banco?.length ?? 0) > 0 && (
        <div className="max-h-40 shrink-0 overflow-auto rounded-xl border border-border bg-surface-panel">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface-panel text-[10px] uppercase text-muted"><tr><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Concepto</th><th className="px-2 py-1.5">Fuente</th><th className="px-2 py-1.5 text-right">Monto</th></tr></thead>
            <tbody>
              {tableroQ.data!.libro_sin_banco.map((m) => (
                <tr key={m.movimiento_id} className="border-t border-border/70">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{m.fecha}</td><td className="px-2 py-1 text-ink">{m.concepto}</td><td className="px-2 py-1 text-muted">{m.fuente}</td>
                  <td className={`px-2 py-1 text-right font-mono font-semibold ${m.tipo === "egreso" ? "text-accent-rose" : "text-accent-leaf"}`}>{formatCop(m.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-2 py-1.5 text-[10.5px] text-muted">O el banco todavía no lo ejecutó, o el asiento está mal, o llegó partido en varios movimientos (un préstamo que entra en dos consignaciones no calza con ninguna sola).</p>
        </div>
      )}

      {tableroQ.isLoading ? (
        <p className="px-3 py-8 text-center text-sm text-muted">Leyendo el banco…</p>
      ) : tableroQ.isError ? (
        <p className="px-3 py-8 text-center text-sm text-accent-rose">{(tableroQ.error as Error)?.message || "No se pudo armar el tablero"}</p>
      ) : todas.length === 0 ? (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 text-center text-sm text-ink"><Ico e="📥" /> Todavía no hay movimientos del banco en este rango. Trae el detalle desde Sucursal Negocios con el botón de arriba, o suelta el archivo aquí.</div>
      ) : !l || !piezas ? (
        <div className="rounded-xl border border-accent-leaf/50 bg-accent-leaf/10 p-6 text-center text-sm text-ink"><Ico e="🏆" /> No queda ninguna línea sin conciliar. El extracto está al día.</div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-1 lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <ListaLineas lineas={listaLineas} piezasDe={piezasDe} total={todas.length} actual={ref} q={q} setQ={setQ} filtro={filtro} setFiltro={setFiltro} conteos={conteos} onElegir={elegir} />
          <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-3">
            {/* Caso actual */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                  {`Caso ${pos + 1} de ${cola.length}`} · {FILTROS_LISTA.find((f) => f.id === filtro)?.nombre.toLowerCase()} · {l.extracto_nombre || l.banco || "extracto"}
                </p>
                <h3 className="flex min-w-0 items-baseline gap-2 text-base font-bold text-ink">
                  <span className="truncate">{l.descripcion}</span>
                  <code className="shrink-0 text-[11px] font-normal text-ink-secondary">{l.fecha}{l.referencia ? ` · cód ${l.referencia}` : ""}</code>
                </h3>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button className={BTN_SEC} onClick={() => mover(-1)}>← Anterior</button>
                <button className={l.estado === "vinculada" ? BTN : BTN_SEC} onClick={() => mover(1)}>{l.estado === "vinculada" ? "Siguiente línea →" : "Saltar →"}</button>
              </div>
            </div>

            {l.estado === "vinculada" ? (
              comprobado(l).estado === "ok" ? (
                <div className="mt-2 rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-center text-[12.5px] font-bold text-ink"><Ico e="🏆" /> ¡Línea conciliada y comprobada! Banco y libro dicen la misma plata: {formatCop(l.monto)}.</div>
              ) : (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent-rose/50 bg-accent-rose/10 px-3 py-1.5 text-[12px] text-ink">
                  <span className="min-w-0 flex-1">{comprobado(l).detalle}</span>
                  <button className={`${BTN} shrink-0`} onClick={() => tocarPieza("vinculo")}>Ver la comprobación →</button>
                </div>
              )
            ) : guia ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-[12px] text-ink">
                <span className="min-w-0 flex-1 truncate" title={`${piezas[guia].titulo}: ${piezas[guia].detalle}`}>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">siguiente paso</span>{" "}
                  {piezas[guia].titulo}: <span className="text-muted">{piezas[guia].detalle}</span>
                </span>
                <button className={`${BTN} mck-mision-pulso shrink-0`} onClick={() => tocarPieza(guia)}>Resolver ahora →</button>
              </div>
            ) : null}

            <div className="mt-2 flex min-h-0 flex-1 flex-col">
              <TableroContable l={l} piezas={piezas} sel={sel} guia={guia} destello={destello} premio={premio} onSel={tocarPieza} />
            </div>
            <p className="mt-1 hidden shrink-0 text-center font-mono text-[9.5px] text-muted [@media(min-height:840px)]:block">toca una pieza para resolverla · ← → cambian de línea · 1–4 abren una pieza · Enter vincula lo que calza</p>
          </div>

          {piezaAbierta && (() => {
            const pend = ORDEN_GUIA.filter((k) => k !== sel && piezas[k].estado !== "ok");
            const sig = pend[0] ? { clave: pend[0], titulo: piezas[pend[0]].titulo } : null;
            return (
              <PiezaEmergente pregunta={preguntaGuia(sel, l, piezas[sel])} recien={recien} siguiente={sig} onSiguiente={() => { if (sig) { setRecien(null); setSel(sig.clave); } }} onCerrar={() => { setPiezaAbierta(false); setRecien(null); }}>
                <Inspector clave={sel} l={l} piezas={piezas} ajuste={ajustes[l.id]} cuentas={cuentas} medios={medios} ocupado={ocupado}
                  onAjuste={(a) => ajustar(l.id, a)} onVincular={(mid) => vincularMut.mutate({ linea: l, movimientoId: mid })} onDesvincular={() => desvincularMut.mutate(l)}
                  onCausar={(plan) => causarMut.mutate({ linea: l, plan })} onHecho={() => { setMsg(null); void refrescar(); }} irA={(k) => { setRecien(null); setSel(k); }}
                  onRegistrarCompra={(tipo) => { setPiezaAbierta(false); setRecien(null); setCompra({ tipo }); }}
                  onCrearCliente={(doc) => crearClienteMut.mutate({ lineaId: l.id, doc })} />
              </PiezaEmergente>
            );
          })()}
        </div>
      )}

      {compra && l && (
        <VentanaTaller titulo={compra.tipo === "productos" ? "Compra con productos" : "Servicio"} combo={`${diaCorto(l.fecha)} · ${formatCop(l.monto)} · ${l.descripcion}`} ancho="max-w-[1300px]"
          onCerrar={() => { setCompra(null); setCrearProducto(false); }}
          ayuda={<>
            Proveedor, fecha, monto y medio ya vienen de la línea del banco. Agrega los productos por su referencia del catálogo de Alegra
            {compra.tipo === "productos" && <> — o <button type="button" className="font-bold text-accent underline-offset-2 hover:underline" onClick={() => setCrearProducto(true)}>crea el producto</button> si no existe</>}
            , coteja la factura y registra. No pasa por aprobación ni por dos tokens: el pago ya salió del banco y el extracto es la aprobación. Lo único que se exige es que del banco salgan exactamente {formatCop(l.monto)}: si la factura es por otro valor, la diferencia queda como anticipo a favor o saldo por pagar con el proveedor.
          </>}>
          {categoriaCompra ? (
            <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo la solicitud de compra…</p>}>
              <WizardPago
                categoriaInicial={categoriaCompra}
                inicial={{ tercero_id: ajustes[l.id]?.terceroId ?? l.propuesta?.tercero?.id ?? null, monto: l.monto, fecha: l.fecha, medio_pago_id: medioDelBanco(medios)?.id ?? null, origen_ref: `extracto:${l.id}` }}
                onCerrar={() => { setCompra(null); setCrearProducto(false); }}
                onError={(t) => setMsg(t)}
                onCreada={(t) => setMsg(t)}
                onRegistrado={(s) => {
                  setCompra(null);
                  setCrearProducto(false);
                  if (s.movimiento_id) vincularMut.mutate({ linea: l, movimientoId: `cc:${s.movimiento_id}` });
                  else { setMsg("La compra quedó en aprobación: cuando se apruebe nace el asiento y podrás vincularla aquí."); void refrescar(); }
                }}
              />
            </Suspense>
          ) : (
            <p className="p-6 text-sm text-muted">{categoriasQ.isLoading ? "Leyendo las categorías de pago…" : "No hay una categoría de compra configurada en Solicitudes de pago."}</p>
          )}
        </VentanaTaller>
      )}
      {crearProducto && l && (
        <VentanaTaller titulo="Crear producto en Alegra" combo={l.descripcion} ancho="max-w-[900px]" onCerrar={() => setCrearProducto(false)}
          ayuda="El producto no existe en el catálogo: créalo aquí y vuelve a la compra; aparecerá al buscarlo por su referencia.">
          <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo…</p>}>
            <CrearProductosSiigoPanel compact onCreado={() => setCrearProducto(false)} />
          </Suspense>
        </VentanaTaller>
      )}
    </div>
  );
}

/* ─── Ventana completa y lanzador ────────────────────────────────────────── */

/**
 * El taller ENCIMA de la app, a ventana completa — el mismo mecanismo con que
 * el Taller de Combos abre sus apartados (`VentanaTaller`). Bajo el cabezote,
 * las pestañas del hub y los dos niveles del Libro Mayor, el tablero quedaba
 * en el tercio inferior de la pantalla. Solo se cierra con «Cerrar»: dentro
 * hay emergentes que guardan por acciones y un clic afuera no debe cortarlos.
 */
export function TallerVentana({ onCerrar }: { onCerrar: () => void }) {
  const { activa, alternar } = usePantallaCompleta();
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="Taller de conciliación">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-panel px-4 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon name="receipt" size={16} weight="duotone" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Libro Mayor · Conciliar banco</p>
          <h2 className="truncate text-[15px] font-bold leading-tight text-ink">Taller de conciliación</h2>
        </div>
        {soportaPantallaCompleta() && (
          <button type="button" onClick={() => void alternar()} aria-pressed={activa} className="mck-press shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label={activa ? "Salir de pantalla completa" : "Pantalla completa"} title={activa ? "Salir de pantalla completa (F11 o Esc)" : "Pantalla completa (F11)"}>
            <Icon name={activa ? "collapse" : "expand"} size={18} weight="regular" />
          </button>
        )}
        <button onClick={onCerrar} aria-label="Cerrar" className="shrink-0 rounded-md border border-border px-3 py-1 text-[12px] font-semibold text-ink hover:bg-surface-hover">Cerrar · volver al Libro Mayor</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <TallerConciliacion />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Lo que se ve en el Libro Mayor cuando se elige «Taller de conciliación»: el
 * avance del mes y el botón que abre la ventana. Al llegar por la pestaña se
 * abre solo; al cerrar, queda el lanzador y no se vuelve a abrir hasta que se
 * pida.
 */
export function TallerLanzador() {
  const [abierto, setAbierto] = useState(true);
  const desde = inicioDeMes();
  const hasta = hoy();
  const resumenQ = useQuery<Tablero>({
    queryKey: ["conciliacion-taller", desde, hasta, true, true],
    queryFn: () => api.get(`/api/contabilidad/conciliacion/taller?${new URLSearchParams({ desde, hasta, meli: "1", siigo: "1" })}`, { timeoutMs: 90_000 }),
    enabled: !abierto,
  });
  const t = resumenQ.data?.totales;
  const c = resumenQ.data?.comprobacion;
  return (
    <div className="lm-card flex flex-wrap items-center gap-4 p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name="receipt" size={26} weight="duotone" /></span>
      <div className="min-w-[240px] flex-1">
        <h3 className="text-sm font-bold text-ink">Taller de conciliación</h3>
        <p className="text-[11.5px] text-muted">Cada línea del banco contra el libro, una por una, a ventana completa. Este mes: {diaCorto(desde)} → hoy.</p>
        {t && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
            <span className="text-ink"><b>{t.vinculada}</b>/{t.lineas} conciliadas</span>
            <span className="text-accent-sun">{t.sugerida} con asiento por unir</span>
            <span className="text-accent-rose">{t.sin_causar} por causar · {formatCop(t.monto_sin_causar)}</span>
            {c && c.vinculadas > 0 && <span className={c.descuadradas ? "text-accent-rose" : "text-accent-leaf"}>{c.descuadradas ? `✗ ${c.descuadradas} descuadradas` : `✓ ${c.cuadradas} cuadran al peso`}</span>}
          </div>
        )}
      </div>
      <button onClick={() => setAbierto(true)} className="mck-flujo-nodo mck-mision-pulso flex items-center gap-2 rounded-full border-2 border-white/70 bg-accent px-4 py-2 text-[13px] font-bold text-white shadow-paper-lg hover:opacity-90">
        <Icon name="expand" size={16} weight="bold" /> Abrir el taller
      </button>
      {abierto && <TallerVentana onCerrar={() => setAbierto(false)} />}
    </div>
  );
}
