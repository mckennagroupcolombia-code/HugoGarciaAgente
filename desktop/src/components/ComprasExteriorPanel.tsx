import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { api, resolvePanelApiUrl } from "../api/client";
import { useEmisoresCuentaCobro } from "../hooks/useEmisoresCuentaCobro";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAuthStore } from "../stores/auth";
import { usePanelTheme } from "../stores/panelTheme";
import CuentaCobroAccentPicker, {
  leerAccentCuentaCobro,
} from "./CuentaCobroAccentPicker";
import CompraExteriorRevisionModal from "./CompraExteriorRevisionModal";
import { Modal } from "./etiquetas/ui/Modal";

type LineaEditable = {
  id: string;
  seleccionada: boolean;
  nombre: string;
  nombre_ocr: string;
  sku: string;
  cantidad: number;
  unidades_por_pack: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  descuento: number;
  categoria: string;
  costo_unitario_cop: number | null;
};

type LineaApi = {
  id?: string;
  nombre: string;
  cantidad: number;
  unidades_por_pack?: number;
  unidades_totales?: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  descuento?: number | null;
  descuento_pct?: number | null;
  descuento_pedido_asignado?: number | null;
  subtotal_neto?: number | null;
  costo_unitario_cop?: number | null;
};

type ExtractResp = {
  moneda: string;
  fecha_compra?: string | null;
  fecha_detectada_ocr?: string | null;
  proveedor?: string;
  referencia?: string;
  numero_pedido?: string;
  flete_detectado?: number | null;
  flete_bruto?: number | null;
  flete_neto?: number | null;
  flete_usado?: number | null;
  flete_neteado?: boolean;
  descuento_flete_detectado?: number | null;
  descuento_flete_aplicado?: number | null;
  moneda_flete_detectada?: string | null;
  descuento_detectado?: number | null;
  descuento_detectado_bruto?: number | null;
  descuento_pct?: number | null;
  lineas: LineaApi[];
  lineas_landed?: LineaApi[];
  trm_usada?: number | null;
  trm_fuente?: string | null;
  trm_detalle?: {
    valor?: number;
    vigencia_desde?: string;
    vigencia_hasta?: string;
    aproximada?: boolean;
    aviso?: string;
  } | null;
  trm_error?: string | null;
  imagenes_procesadas?: number;
  error?: string;
};

type TrmResp = {
  valor: number;
  fecha?: string;
  vigencia_desde?: string;
  vigencia_hasta?: string;
  fuente?: string;
  aproximada?: boolean;
  aviso?: string;
  error?: string;
};

function n(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  let s = String(v ?? "").trim().replace(/[^\d.,\-]/g, "");
  if (!s) return fallback;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    s = parts.length === 2 && parts[1].length === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : fallback;
}

type UnidadBase = "ml" | "g" | "un";

function normalizarUnidadBase(unidad: string): UnidadBase | null {
  const u = unidad.trim().toLowerCase().replace(/\s+/g, "");
  if (u === "ml" || u === "g" || u === "un") return u;
  if (/^(m\.?l\.?|mililitros?|l|lt|litros?)$/.test(u)) return "ml";
  if (/^(grs?|gramos?|kg|kilos?|kilogramos?)$/.test(u)) return "g";
  if (/^(pcs?|piezas?|uds?|unidades?|units?|set|pack|bottle|frasco|tubo)$/.test(u)) return "un";
  return null;
}

/** Detecta ml | g | un y el contenido por pack desde el texto del producto. */
export function inferirUnidadYContenido(
  nombre: string,
  unidad: string,
  explicit?: number,
): { unidad: UnidadBase; contenido: number } {
  const blob = `${nombre} ${unidad}`;
  const num = (m: RegExpMatchArray | null) => {
    if (!m?.[1]) return null;
    const v = parseFloat(m[1].replace(",", "."));
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  let ml = num(blob.match(/(\d+(?:[.,]\d+)?)\s*(?:m\.?\s*l\.?|mililitros?)\b/i));
  if (ml == null) {
    const litros = num(blob.match(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?\b|l)\b(?!\s*b\b)/i));
    if (litros != null) ml = litros * 1000;
  }
  let g = num(blob.match(/(\d+(?:[.,]\d+)?)\s*(?:gramos?|grs?|g)\b(?!\s*[/.a-z])/i));
  const kg = num(blob.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|kilogramos?)\b/i));
  if (kg != null) g = g == null ? kg * 1000 : Math.max(g, kg * 1000);

  const pack =
    blob.match(/(\d+)\s*(?:pcs|pc|pieces?|piezas?|uds?|unidades?|units?)\b/i) ||
    blob.match(/(?:pack|set|juego|caja|box)\s*(?:de|of)?\s*(\d+)/i);
  const pcs = pack?.[1] ? parseInt(pack[1], 10) : null;
  const pcsOk = pcs != null && pcs > 0 ? pcs : null;

  const unidadNorm = normalizarUnidadBase(unidad);
  // Solo confiar en explicit si aporta contenido real (>1) o no hay señal en el texto
  const explicitOk = explicit != null && explicit > 0 ? explicit : null;

  const esMateria = /\b(glycer|oil|acid|extract|serum|agua|water|alcohol|urea|powder|sal|aceite|glicer|manteca|butter|clay|arcilla|polvo)\b/i.test(
    blob,
  );
  const esEmpaque = /\b(bottle|tubo|tube|frasco|vial|jar|dropper|gotero|tapa|cap|bag|bolsa|sachet)\b/i.test(
    blob,
  );

  if (ml != null) {
    if (pcsOk != null && pcsOk >= 10 && ml <= 1000 && esEmpaque && !esMateria) {
      return { unidad: "un", contenido: explicitOk && explicitOk > 1 ? explicitOk : pcsOk };
    }
    return { unidad: "ml", contenido: explicitOk && explicitOk > 1 ? explicitOk : ml };
  }
  if (g != null) {
    if (pcsOk != null && pcsOk >= 10 && g <= 5000 && esEmpaque && !esMateria) {
      return { unidad: "un", contenido: explicitOk && explicitOk > 1 ? explicitOk : pcsOk };
    }
    return { unidad: "g", contenido: explicitOk && explicitOk > 1 ? explicitOk : g };
  }
  if (pcsOk != null) {
    return {
      unidad: "un",
      contenido: explicitOk && explicitOk > 1 ? explicitOk : pcsOk,
    };
  }
  if (unidadNorm && explicitOk) return { unidad: unidadNorm, contenido: explicitOk };
  if (unidadNorm) return { unidad: unidadNorm, contenido: 1 };
  return { unidad: "un", contenido: explicitOk || 1 };
}

/** Costo unitario COP = (precio_neto_pack × TRM + flete_del_pack) ÷ contenido.

Neto = subtotal − descuento_línea − descuento_pedido_prorrateado.
Flete total se reparte por unidades compradas (packs × contenido), no por valor $.
*/
export type LandedDetalle = {
  costo: number;
  fleteAsignadoCop: number;
  fletePorUnidadCop: number;
  precioPackCop: number;
};

export function calcularLandedDetalleCliente(
  lineas: Array<
    Pick<LineaEditable, "cantidad" | "unidades_por_pack" | "precio_unit" | "subtotal" | "descuento">
  >,
  opts: {
    trm: number;
    flete: number;
    moneda: string;
    monedaFlete: string;
    descuentoPedido?: number;
    descuentoPct?: number;
  },
): LandedDetalle[] {
  const mon = (opts.moneda || "USD").toUpperCase();
  const monF = (opts.monedaFlete || mon).toUpperCase();
  const rate = mon === "COP" ? 1 : Math.max(opts.trm, 0);
  let fleteCop = 0;
  if (opts.flete > 0) {
    if (monF === "COP") fleteCop = opts.flete;
    else fleteCop = opts.flete * (rate || 0);
  }
  const brutos = lineas.map((l) => {
    const packs = Math.max(Number(l.cantidad) || 0, 0) || 1;
    const sub = l.subtotal > 0 ? l.subtotal : packs * Math.max(l.precio_unit, 0);
    return Math.max(sub, 0);
  });
  const unidades = lineas.map((l) => {
    const packs = Math.max(Number(l.cantidad) || 0, 0) || 1;
    const contenido = Math.max(Number(l.unidades_por_pack) || 0, 0) || 1;
    return packs * contenido;
  });
  const sumaUnidades = unidades.reduce((a, u) => a + u, 0);
  const descLineas = lineas.map((l, i) => {
    const d = Math.max(l.descuento || 0, 0);
    return Math.min(d, brutos[i]);
  });
  const sumaBruta = brutos.reduce((a, s) => a + s, 0);
  const sumaTrasLinea = Math.max(
    brutos.reduce((a, s, i) => a + (s - descLineas[i]), 0),
    0,
  );
  let descPedido = Math.max(opts.descuentoPedido || 0, 0);
  if (descPedido <= 0 && (opts.descuentoPct || 0) > 0) {
    descPedido = (sumaBruta * Math.min(opts.descuentoPct || 0, 100)) / 100;
  }
  descPedido = Math.min(descPedido, sumaTrasLinea);
  const nLin = lineas.length || 1;

  return lineas.map((l, i) => {
    const packs = Math.max(Number(l.cantidad) || 0, 0) || 1;
    const contenido = Math.max(Number(l.unidades_por_pack) || 0, 0);
    if (contenido <= 0 || (rate <= 0 && mon !== "COP")) {
      return { costo: NaN, fleteAsignadoCop: 0, fletePorUnidadCop: 0, precioPackCop: 0 };
    }
    const bruto = brutos[i];
    const dLin = descLineas[i];
    const base = Math.max(bruto - dLin, 0);
    const pesoPed = sumaTrasLinea > 0 ? base / sumaTrasLinea : 1 / nLin;
    const dPed = descPedido > 0 ? descPedido * pesoPed : 0;
    const neto = Math.max(bruto - dLin - dPed, 0);
    const precioNetoPack = packs > 0 ? neto / packs : 0;
    const precioPackCop = precioNetoPack * rate;
    const pesoFlete = sumaUnidades > 0 ? unidades[i] / sumaUnidades : 1 / nLin;
    const fleteAsignadoCop = fleteCop > 0 ? fleteCop * pesoFlete : 0;
    const fletePorPack = packs > 0 ? fleteAsignadoCop / packs : 0;
    const unidadesTotales = packs * contenido;
    const costo = Math.round(((precioPackCop + fletePorPack) / contenido) * 1e4) / 1e4;
    return {
      costo,
      fleteAsignadoCop: Math.round(fleteAsignadoCop * 1e4) / 1e4,
      fletePorUnidadCop:
        unidadesTotales > 0 ? Math.round((fleteAsignadoCop / unidadesTotales) * 1e4) / 1e4 : 0,
      precioPackCop: Math.round(precioPackCop * 1e4) / 1e4,
    };
  });
}

export function calcularLandedCliente(
  lineas: Array<
    Pick<LineaEditable, "cantidad" | "unidades_por_pack" | "precio_unit" | "subtotal" | "descuento">
  >,
  opts: {
    trm: number;
    flete: number;
    moneda: string;
    monedaFlete: string;
    descuentoPedido?: number;
    descuentoPct?: number;
  },
): number[] {
  return calcularLandedDetalleCliente(lineas, opts).map((d) => d.costo);
}

/** Precio de un pack ya convertido a COP (sin flete). */
export function precioPackCop(
  precioUnit: number,
  trm: number,
  moneda: string,
): number {
  const mon = (moneda || "USD").toUpperCase();
  const rate = mon === "COP" ? 1 : Math.max(trm, 0);
  return Math.round(Math.max(precioUnit, 0) * rate * 1e4) / 1e4;
}

function etiquetaUnidad(u: string): string {
  const n = normalizarUnidadBase(u) || "un";
  return n.toUpperCase();
}

function fmtCop(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  }).format(v);
}

type CatalogoItem = { codigo: string; nombre: string };

type EnvioExterior = {
  id: number;
  fecha_envio?: string;
  flete: number;
  moneda_flete: string;
  trm?: number;
  trm_fuente?: string;
  notas?: string;
  compra_ids?: number[];
  emisor_usuario_id?: number | null;
  emisor_nombre?: string;
  flete_cobro_cop?: number;
  cuenta_flete_estado?: string;
  tiene_cuenta_flete?: boolean;
  cuenta_flete_pendiente?: boolean;
  cuenta_flete_url?: string | null;
};

type CompraHistorial = {
  id: number;
  created_at: string;
  moneda: string;
  trm: number;
  trm_fuente?: string;
  fecha_compra?: string;
  numero_pedido?: string;
  flete: number;
  moneda_flete: string;
  proveedor: string;
  tiene_soporte: boolean;
  soporte_nombre: string;
  soporte_url: string | null;
  soporte_urls?: string[];
  soportes_count?: number;
  lineas: Array<{
    nombre: string;
    codigo?: string | null;
    nombre_ocr?: string;
    costo_unitario?: number;
    cantidad?: number;
    unidades_por_pack?: number;
    unidades_totales?: number;
    unidad?: string;
    precio_unit?: number;
    subtotal?: number;
    descuento?: number;
    categoria?: string;
    ok?: boolean;
  }>;
  total_guardados: number;
  tiene_cuenta_cobro?: boolean;
  cuenta_cobro_pendiente?: boolean;
  cuenta_cobro_estado?: string;
  cuota_manejo_cop?: number;
  valor_compra_cop?: number;
  flete_cobro_cop?: number;
  total_cobro_cop?: number;
  cuota_pct?: number;
  cuenta_cobro_url?: string | null;
  cuenta_flete_estado?: string;
  tiene_cuenta_flete?: boolean;
  cuenta_flete_pendiente?: boolean;
  cuenta_flete_url?: string | null;
  emisor_usuario_id?: number | null;
  emisor_nombre?: string;
  emisor_documento?: string;
  envio_id?: number | null;
  envio?: EnvioExterior | null;
};

type BorradorCompra = {
  id: number;
  created_at: string;
  updated_at: string;
  titulo: string;
  moneda: string;
  trm: number;
  trm_fuente?: string;
  fecha_compra?: string;
  flete: number;
  moneda_flete: string;
  descuento_pedido?: number;
  descuento_pct?: number;
  proveedor: string;
  lineas: LineaEditable[];
  lineas_count: number;
  tiene_soporte: boolean;
  soportes_count?: number;
  soporte_urls?: string[];
  estado?: { lineas?: LineaEditable[]; numero_pedido?: string };
};

function bearerPanel(): string {
  const t = useTicketsAuth.getState();
  return t.apiToken || t.token || useAuthStore.getState().token || "";
}

async function fetchAuthBlobUrl(apiPath: string): Promise<string | null> {
  try {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const url = resolvePanelApiUrl(path, "GET");
    const res = await fetch(url, {
      headers: bearerPanel() ? { Authorization: `Bearer ${bearerPanel()}` } : {},
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function fetchSoporteBlobUrl(compraId: number): Promise<string | null> {
  return fetchAuthBlobUrl(`/api/rentabilidad/compras-exterior/${compraId}/soporte`);
}

function agruparHistorial(
  items: CompraHistorial[],
): Array<
  | { kind: "envio"; envio: EnvioExterior; compras: CompraHistorial[] }
  | { kind: "compra"; compra: CompraHistorial }
> {
  const used = new Set<number>();
  const out: Array<
    | { kind: "envio"; envio: EnvioExterior; compras: CompraHistorial[] }
    | { kind: "compra"; compra: CompraHistorial }
  > = [];
  for (const c of items) {
    if (used.has(c.id)) continue;
    const env = c.envio;
    if (env?.id) {
      const mates = items.filter((x) => x.envio?.id === env.id);
      mates.forEach((m) => used.add(m.id));
      out.push({ kind: "envio", envio: { ...env, compra_ids: mates.map((m) => m.id) }, compras: mates });
    } else {
      used.add(c.id);
      out.push({ kind: "compra", compra: c });
    }
  }
  return out;
}

const CUOTA_MANEJO_PCT_DEFAULT = 5;

/** Valor mercancía neta en COP (sin flete) — base de la cuota de manejo. */
function valorMercanciaCopPreview(
  lineas: LineaEditable[],
  moneda: string,
  trm: number,
): number {
  const mon = moneda.toUpperCase();
  const tasa = mon === "COP" ? 1 : Math.max(trm, 0);
  if (tasa <= 0) return 0;
  let sub = 0;
  for (const l of lineas) {
    if (!l.seleccionada) continue;
    let s = l.subtotal || l.cantidad * l.precio_unit;
    s = Math.max(s - Math.max(l.descuento || 0, 0), 0);
    sub += s;
  }
  return Math.round(sub * tasa * 100) / 100;
}

async function descargarCuentaCobro(
  compraId: number,
  tipo: "mercancia" | "flete" = "mercancia",
): Promise<void> {
  const q = tipo === "flete" ? "?tipo=flete" : "";
  const blobUrl = await fetchAuthBlobUrl(
    `/api/rentabilidad/compras-exterior/${compraId}/cuenta-cobro${q}`,
  );
  if (!blobUrl) throw new Error("No se pudo descargar la cuenta de cobro");
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download =
    tipo === "flete"
      ? `Cuenta de cobro numero ${String(compraId).padStart(5, "0")} flete compra en el exterior.pdf`
      : `Cuenta de cobro numero ${String(compraId).padStart(5, "0")} compra en el exterior.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}

async function descargarCuentaFleteEnvio(envioId: number): Promise<void> {
  const blobUrl = await fetchAuthBlobUrl(
    `/api/rentabilidad/compras-exterior/envios/${envioId}/cuenta-cobro`,
  );
  if (!blobUrl) throw new Error("No se pudo descargar la cuenta de flete del paquete");
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = `Cuenta de cobro numero ENV-${String(envioId).padStart(5, "0")} flete paquete compra en el exterior.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}

type GaleriaItem = {
  id: string;
  preview: string | null;
  file: File | null;
  /** Índice original en el servidor (borrador); null si es archivo nuevo. */
  serverIndex: number | null;
  name: string;
};

async function galeriaDesdeSoporteUrls(urls: string[]): Promise<GaleriaItem[]> {
  const out: GaleriaItem[] = [];
  for (let i = 0; i < urls.length; i++) {
    const preview = await fetchAuthBlobUrl(urls[i]);
    if (!preview) continue;
    out.push({
      id: `srv-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      preview,
      file: null,
      serverIndex: i,
      name: `soporte-${i + 1}`,
    });
  }
  return out;
}

function revokeGaleria(items: GaleriaItem[]) {
  items.forEach((g) => {
    if (g.preview?.startsWith("blob:")) URL.revokeObjectURL(g.preview);
  });
}

async function fileDesdeGaleriaItem(g: GaleriaItem): Promise<File | null> {
  if (g.file) return g.file;
  if (!g.preview) return null;
  try {
    const res = await fetch(g.preview);
    const blob = await res.blob();
    const ext =
      blob.type === "application/pdf"
        ? "pdf"
        : blob.type === "image/png"
          ? "png"
          : blob.type === "image/webp"
            ? "webp"
            : "jpg";
    return new File([blob], g.name.includes(".") ? g.name : `${g.name}.${ext}`, {
      type: blob.type || "image/jpeg",
    });
  } catch {
    return null;
  }
}

function ProductoSkuAsociar({
  linea,
  onChange,
}: {
  linea: LineaEditable;
  onChange: (patch: Partial<LineaEditable>) => void;
}) {
  const [q, setQ] = useState(linea.sku || linea.nombre);
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // Solo sincronizar cuando hay asociación confirmada (evitar pisar lo que escribe el usuario)
    if (linea.sku) {
      setQ(`${linea.sku} — ${linea.nombre}`);
    }
  }, [linea.sku, linea.nombre]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const asociar = (it: CatalogoItem) => {
    onChangeRef.current({ sku: it.codigo, nombre: it.nombre });
    setQ(`${it.codigo} — ${it.nombre}`);
    setAbierto(false);
    setErrorBusqueda(null);
  };

  const terminoBusqueda = (texto: string) => {
    const t = texto.trim();
    if (t.includes("—")) return t.split("—")[0].trim();
    if (t.includes(" - ")) return t.split(" - ")[0].trim();
    return t;
  };

  const ejecutarBusqueda = async (texto: string, autoAsociarExacto: boolean) => {
    const term = terminoBusqueda(texto);
    if (term.length < 1) {
      setItems([]);
      return;
    }
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const res = await api.get<{ items: CatalogoItem[] }>(
        `/api/rentabilidad/componentes-buscar?q=${encodeURIComponent(term)}`,
      );
      const list = res.items || [];
      setItems(list);
      if (autoAsociarExacto && list.length > 0) {
        const exact = list.find((it) => it.codigo.toUpperCase() === term.toUpperCase());
        if (exact) {
          asociar(exact);
          return;
        }
      }
    } catch (e: unknown) {
      setItems([]);
      setErrorBusqueda(e instanceof Error ? e.message : "Error buscando SKU");
    } finally {
      setBuscando(false);
    }
  };

  const buscar = (texto: string) => {
    setQ(texto);
    setAbierto(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const term = terminoBusqueda(texto);
    if (term.length < 1) {
      setItems([]);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      void ejecutarBusqueda(texto, true);
    }, 180);
  };

  const limpiarAsoc = () => {
    onChange({ sku: "", nombre: linea.nombre_ocr || linea.nombre });
    setQ(linea.nombre_ocr || "");
    setItems([]);
  };

  const confirmarConEnter = () => {
    const term = terminoBusqueda(q);
    const exact = items.find((it) => it.codigo.toUpperCase() === term.toUpperCase());
    if (exact) {
      asociar(exact);
      return;
    }
    if (items.length === 1) {
      asociar(items[0]);
      return;
    }
    void ejecutarBusqueda(q, true);
  };

  return (
    <div ref={wrapRef} className="relative min-w-[14rem]">
      <div className="flex gap-1">
        <input
          value={q}
          onChange={(e) => buscar(e.target.value)}
          onFocus={() => {
            setAbierto(true);
            if (terminoBusqueda(q)) void ejecutarBusqueda(q, false);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              void ejecutarBusqueda(q, true);
            }, 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmarConEnter();
            }
            if (e.key === "Escape") setAbierto(false);
          }}
          placeholder="Escribe SKU (ej. TBPST10mL)…"
          className={`w-full rounded border bg-surface-input px-1.5 py-1 ${
            linea.sku ? "border-accent/60" : "border-border"
          }`}
        />
        {linea.sku && (
          <button
            type="button"
            title="Quitar asociación"
            onClick={limpiarAsoc}
            className="shrink-0 rounded border border-border px-1.5 text-muted hover:text-danger"
          >
            ×
          </button>
        )}
      </div>
      {linea.sku ? (
        <p className="mt-0.5 font-mono text-[9px] font-bold text-accent">
          ✓ Asociado {linea.sku}
          {linea.nombre_ocr && linea.nombre_ocr !== linea.nombre
            ? ` · OCR: ${linea.nombre_ocr.slice(0, 36)}`
            : ""}
        </p>
      ) : (
        <p className="mt-0.5 text-[9px] text-amber-700 dark:text-amber-400">
          Escribe el SKU y elige de la lista (o Enter si es exacto)
        </p>
      )}
      {errorBusqueda && (
        <p className="mt-0.5 text-[9px] text-danger">{errorBusqueda}</p>
      )}
      {abierto && (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
          {buscando && (
            <li className="px-2 py-1.5 text-[10px] text-muted">Buscando…</li>
          )}
          {!buscando && items.length === 0 && (
            <li className="px-2 py-1.5 text-[10px] text-muted">
              Sin coincidencias en catálogo Alegra
            </li>
          )}
          {items.map((it) => (
            <li key={it.codigo}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-accent/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => asociar(it)}
              >
                <span className="font-mono text-[10px] font-bold text-accent">{it.codigo}</span>
                <span className="text-[11px] text-ink">{it.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function esImagenPortapapeles(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  if ((!f.type || f.type === "application/octet-stream") && f.size > 0) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name);
}

function normalizarImagenPegada(raw: File): File {
  const mime = raw.type.startsWith("image/") ? raw.type : "image/png";
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const nombre =
    raw.name && !/^image\.(png|jpe?g)$/i.test(raw.name)
      ? raw.name
      : `pantallazo-${Date.now()}.${ext}`;
  if (raw.name === nombre && raw.type === mime) return raw;
  return new File([raw], nombre, { type: mime });
}

/** Extrae imagen del portapapeles (Ctrl+V / captura de pantalla). */
function imagenDesdePortapapeles(cd: DataTransfer | null | undefined): File | null {
  if (!cd) return null;
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" || item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f && esImagenPortapapeles(f)) return normalizarImagenPegada(f);
    }
  }
  for (const f of Array.from(cd.files)) {
    if (esImagenPortapapeles(f)) return normalizarImagenPegada(f);
  }
  return null;
}

export default function ComprasExteriorPanel() {
  const [scanning, setScanning] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [galeria, setGaleria] = useState<GaleriaItem[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [moneda, setMoneda] = useState("USD");
  const [trm, setTrm] = useState("");
  const [trmFuente, setTrmFuente] = useState<string>("");
  const [trmDetalle, setTrmDetalle] = useState<string>("");
  const [fechaCompra, setFechaCompra] = useState(() => new Date().toISOString().slice(0, 10));
  const [trmLoading, setTrmLoading] = useState(false);
  const [flete, setFlete] = useState("");
  const [descuentoPedido, setDescuentoPedido] = useState("");
  const [descuentoPct, setDescuentoPct] = useState("");
  const [cuotaManejoPct, setCuotaManejoPct] = useState(String(CUOTA_MANEJO_PCT_DEFAULT));
  const [monedaFlete, setMonedaFlete] = useState("USD");
  const [proveedor, setProveedor] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [lineas, setLineas] = useState<LineaEditable[]>([]);
  const [zonaActiva, setZonaActiva] = useState(true);
  const [historial, setHistorial] = useState<CompraHistorial[]>([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [borradores, setBorradores] = useState<BorradorCompra[]>([]);
  const [borradorId, setBorradorId] = useState<number | null>(null);
  const [compraIdEditando, setCompraIdEditando] = useState<number | null>(null);
  const [guardandoBorrador, setGuardandoBorrador] = useState(false);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [soporteThumbs, setSoporteThumbs] = useState<Record<number, string>>({});
  const [cuentaCobroId, setCuentaCobroId] = useState<number | null>(null);
  const [modalVerificar, setModalVerificar] = useState(false);
  const [seleccionIds, setSeleccionIds] = useState<number[]>([]);
  const [envioModal, setEnvioModal] = useState<"crear" | EnvioExterior | null>(null);
  const [fechaEnvio, setFechaEnvio] = useState(() => new Date().toISOString().slice(0, 10));
  const [fleteEnvio, setFleteEnvio] = useState("");
  const [monedaFleteEnvio, setMonedaFleteEnvio] = useState("USD");
  const [trmEnvio, setTrmEnvio] = useState("");
  const [envioBusy, setEnvioBusy] = useState(false);
  const [resetCobroBusy, setResetCobroBusy] = useState(false);
  const themeAccentRgb = usePanelTheme((s) => s.accentRgb);
  const [pdfAccentRgb, setPdfAccentRgb] = useState(() =>
    leerAccentCuentaCobro(themeAccentRgb),
  );
  const emisorSesion = useTicketsAuth((s) => s.user);
  const { data: emisoresData } = useEmisoresCuentaCobro();
  const emisores = emisoresData?.emisores || [];
  const [emisorUsuarioId, setEmisorUsuarioId] = useState<number | "">(
    () => emisorSesion?.id ?? "",
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const addFilesRef = useRef<(files: File[]) => void>(() => {});
  const trmManualRef = useRef(false);

  const cargarHistorial = useCallback(async () => {
    setHistorialLoading(true);
    try {
      const [res, bor] = await Promise.all([
        api.get<{ compras: CompraHistorial[] }>("/api/rentabilidad/compras-exterior?limit=80"),
        api.get<{ borradores: BorradorCompra[] }>(
          "/api/rentabilidad/compras-exterior/borradores?limit=30",
        ).catch(() => ({ borradores: [] as BorradorCompra[] })),
      ]);
      setHistorial(res.compras || []);
      setBorradores(bor.borradores || []);
    } catch {
      /* silencioso al abrir */
    } finally {
      setHistorialLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargarHistorial();
  }, [cargarHistorial]);

  useEffect(() => {
    if (emisorUsuarioId === "" && emisorSesion?.id) setEmisorUsuarioId(emisorSesion.id);
  }, [emisorSesion?.id]);

  useEffect(() => {
    const em = emisores.find((e) => e.id === emisorUsuarioId);
    const deEmisor = (em?.accent_rgb || "").trim();
    if (deEmisor) {
      setPdfAccentRgb(deEmisor);
      return;
    }
    if (emisorUsuarioId && emisorUsuarioId === emisorSesion?.id) {
      setPdfAccentRgb(themeAccentRgb);
      return;
    }
    setPdfAccentRgb(leerAccentCuentaCobro(themeAccentRgb));
  }, [emisorUsuarioId, emisores, emisorSesion?.id, themeAccentRgb]);

  useEffect(() => {
    if (cuentaCobroId == null && !modalVerificar) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [cuentaCobroId, modalVerificar]);

  const gruposHistorial = useMemo(() => agruparHistorial(historial), [historial]);

  const toggleSeleccion = (id: number) => {
    setSeleccionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const abrirCrearEnvio = () => {
    if (seleccionIds.length < 1) return;
    const sel = historial.filter((c) => seleccionIds.includes(c.id));
    const suma = sel.reduce((a, c) => a + (Number(c.flete) || 0), 0);
    setFleteEnvio(suma > 0 ? String(suma) : "");
    setMonedaFleteEnvio((sel[0]?.moneda_flete || sel[0]?.moneda || "USD").toUpperCase());
    setFechaEnvio(new Date().toISOString().slice(0, 10));
    setTrmEnvio("");
    setEnvioModal("crear");
  };

  const abrirEditarEnvio = (env: EnvioExterior) => {
    setFechaEnvio(env.fecha_envio || new Date().toISOString().slice(0, 10));
    setFleteEnvio(env.flete ? String(env.flete) : "");
    setMonedaFleteEnvio((env.moneda_flete || "USD").toUpperCase());
    setTrmEnvio(env.trm ? String(env.trm) : "");
    setEnvioModal(env);
  };

  useEffect(() => {
    if (!envioModal) return;
    if (!fechaEnvio || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvio)) return;
    if ((monedaFleteEnvio || "USD").toUpperCase() === "COP") return;
    let cancel = false;
    void (async () => {
      try {
        const data = await api.get<TrmResp>(
          `/api/rentabilidad/trm?fecha=${encodeURIComponent(fechaEnvio)}`,
        );
        if (cancel || data.error) return;
        setTrmEnvio(String(data.valor));
      } catch {
        /* BanRep opcional */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [envioModal, fechaEnvio, monedaFleteEnvio]);

  const guardarEnvio = async () => {
    const ids =
      envioModal === "crear"
        ? seleccionIds
        : envioModal && typeof envioModal === "object"
          ? envioModal.compra_ids || []
          : [];
    if (ids.length < 1) {
      setError("Selecciona al menos una compra.");
      return;
    }
    setEnvioBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        compra_ids: ids,
        fecha_envio: fechaEnvio,
        flete: n(fleteEnvio),
        moneda_flete: monedaFleteEnvio || "USD",
        emisor_usuario_id: emisorUsuarioId || undefined,
      };
      if (n(trmEnvio) > 0) body.trm = n(trmEnvio);
      if (envioModal === "crear") {
        await api.post("/api/rentabilidad/compras-exterior/envios", body);
        setOkMsg(
          `Envío creado: ${ids.length} compra(s) · flete con TRM del ${fechaEnvio}. Usa «Actualizar costos unitarios» si quieres volver a aplicar el flete a cada referencia.`,
        );
      } else if (envioModal && typeof envioModal === "object") {
        await api.patch(`/api/rentabilidad/compras-exterior/envios/${envioModal.id}`, body);
        setOkMsg(`Envío #${envioModal.id} actualizado.`);
      }
      setEnvioModal(null);
      setSeleccionIds([]);
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvioBusy(false);
    }
  };

  const desenlazarEnvio = async (envioId: number) => {
    if (!confirm("¿Desenlazar este paquete? El flete volverá a cada compra por separado (en 0).")) {
      return;
    }
    try {
      await api.delete(`/api/rentabilidad/compras-exterior/envios/${envioId}`);
      setOkMsg(`Envío #${envioId} desenlazado.`);
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const resetearCuentasCobro = async () => {
    if (
      !confirm(
        "¿Borrar todos los PDF de cuentas de cobro (mercancía + flete + paquetes) y dejarlas pendientes para reaprobar?\n\nÚtil tras corregir envíos con descuento de flete.",
      )
    ) {
      return;
    }
    setResetCobroBusy(true);
    setError(null);
    try {
      const res = await api.post<{
        ok?: boolean;
        compras_limpiadas?: number;
        envios_limpiados?: number;
        pdfs_eliminados?: number;
        repreparadas?: number;
      }>("/api/rentabilidad/compras-exterior/cuentas-cobro/reset", {});
      setOkMsg(
        `Cuentas limpiadas: ${res.compras_limpiadas ?? 0} compras, ${res.envios_limpiados ?? 0} envíos, ${res.pdfs_eliminados ?? 0} PDF. Pendientes listas para revisar.`,
      );
      setCuentaCobroId(null);
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetCobroBusy(false);
    }
  };

  const aprobarFleteEnvio = async (env: EnvioExterior) => {
    setEnvioBusy(true);
    setError(null);
    try {
      const body: Record<string, string | number> = { accent_rgb: pdfAccentRgb };
      if (emisorUsuarioId) body.emisor_usuario_id = emisorUsuarioId;
      await api.post(`/api/rentabilidad/compras-exterior/envios/${env.id}/cuenta-cobro`, body);
      setOkMsg(`Cuenta de flete del envío #${env.id} generada.`);
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvioBusy(false);
    }
  };

  const actualizarCostosEnvio = async (env: EnvioExterior) => {
    setEnvioBusy(true);
    setError(null);
    try {
      const res = await api.post<{
        ok?: boolean;
        mensaje?: string;
        compras?: CompraHistorial[];
      }>(`/api/rentabilidad/compras-exterior/envios/${env.id}/recalcular-costos`, {});
      const nRefs = (res.compras || []).reduce(
        (acc, c) => acc + (c.lineas?.length || 0),
        0,
      );
      setOkMsg(
        res.mensaje ||
          `Costos unitarios actualizados (${nRefs || "todas las"} referencias) con el flete del envío #${env.id}.`,
      );
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvioBusy(false);
    }
  };

  const cargarTrmBanrep = useCallback(
    async (fecha: string, { forzar = false }: { forzar?: boolean } = {}) => {
      if (moneda.toUpperCase() !== "USD") return;
      if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
      if (trmManualRef.current && !forzar) return;
      setTrmLoading(true);
      try {
        const data = await api.get<TrmResp>(
          `/api/rentabilidad/trm?fecha=${encodeURIComponent(fecha)}`,
        );
        if (data.error) throw new Error(data.error);
        setTrm(String(data.valor));
        setTrmFuente("banrep");
        trmManualRef.current = false;
        const vig =
          data.vigencia_desde && data.vigencia_hasta
            ? `vigente ${data.vigencia_desde} → ${data.vigencia_hasta}`
            : "";
        setTrmDetalle(
          [vig, data.aproximada ? "aproximada" : "", data.aviso || ""]
            .filter(Boolean)
            .join(" · ") || "BanRep (datos.gov.co)",
        );
      } catch (e: unknown) {
        setTrmDetalle(e instanceof Error ? e.message : "No se pudo cargar TRM BanRep");
      } finally {
        setTrmLoading(false);
      }
    },
    [moneda],
  );

  useEffect(() => {
    if (moneda.toUpperCase() !== "USD") {
      if (moneda.toUpperCase() === "COP") {
        setTrm("1");
        setTrmFuente("cop");
        setTrmDetalle("");
      }
      return;
    }
    void cargarTrmBanrep(fechaCompra);
  }, [moneda, fechaCompra, cargarTrmBanrep]);

  useEffect(() => {
    let cancelled = false;
    const pending = historial.filter((c) => c.tiene_soporte && !soporteThumbs[c.id]).slice(0, 12);
    if (!pending.length) return;
    void (async () => {
      const next: Record<number, string> = {};
      for (const c of pending) {
        const url = await fetchSoporteBlobUrl(c.id);
        if (url) next[c.id] = url;
      }
      if (!cancelled && Object.keys(next).length) {
        setSoporteThumbs((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historial]);

  useEffect(() => {
    return () => {
      Object.values(soporteThumbs).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trmNum = n(trm);
  const fleteNum = n(flete);
  const descuentoPedidoNum = n(descuentoPedido);
  const descuentoPctNum = n(descuentoPct);
  const necesitaTrm = moneda.toUpperCase() !== "COP";

  // Solo campos que afectan el landed cost (evita bucles al escribir costo_unitario_cop)
  const landedInputsKey = useMemo(
    () =>
      JSON.stringify({
        trm: necesitaTrm ? trmNum : 1,
        flete: fleteNum,
        moneda: moneda.toUpperCase(),
        monedaFlete: (monedaFlete || moneda).toUpperCase(),
        descuentoPedido: descuentoPedidoNum,
        descuentoPct: descuentoPctNum,
        rows: lineas.map((l) => [
          l.id,
          l.cantidad,
          l.unidades_por_pack,
          l.precio_unit,
          l.subtotal,
          l.descuento,
        ]),
      }),
    [
      lineas,
      trmNum,
      fleteNum,
      descuentoPedidoNum,
      descuentoPctNum,
      moneda,
      monedaFlete,
      necesitaTrm,
    ],
  );

  const landedDetalle = useMemo(() => {
    if (!lineas.length) return [] as LandedDetalle[];
    if (necesitaTrm && trmNum <= 0) {
      return lineas.map(() => ({
        costo: NaN,
        fleteAsignadoCop: 0,
        fletePorUnidadCop: 0,
        precioPackCop: 0,
      }));
    }
    return calcularLandedDetalleCliente(lineas, {
      trm: necesitaTrm ? trmNum : 1,
      flete: fleteNum,
      moneda,
      monedaFlete: monedaFlete || moneda,
      descuentoPedido: descuentoPedidoNum,
      descuentoPct: descuentoPctNum,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landedInputsKey]);

  const costosRecalc = useMemo(
    () => landedDetalle.map((d) => d.costo),
    [landedDetalle],
  );

  const fleteTotalCop = useMemo(() => {
    if (fleteNum <= 0) return 0;
    const mon = moneda.toUpperCase();
    const monF = (monedaFlete || moneda).toUpperCase();
    const rate = mon === "COP" ? 1 : Math.max(trmNum, 0);
    if (monF === "COP") return fleteNum;
    return fleteNum * rate;
  }, [fleteNum, moneda, monedaFlete, trmNum]);

  const preciosNetoPack = useMemo(() => {
    const brutos = lineas.map((x) => Math.max(x.subtotal || x.cantidad * x.precio_unit, 0));
    const tras = brutos.map((b, i) => Math.max(b - (lineas[i]?.descuento || 0), 0));
    const sumaTras = tras.reduce((a, b) => a + b, 0);
    const sumaBruta = brutos.reduce((a, b) => a + b, 0);
    let ped = descuentoPedidoNum;
    if (ped <= 0 && descuentoPctNum > 0) {
      ped = (sumaBruta * Math.min(descuentoPctNum, 100)) / 100;
    }
    ped = Math.min(ped, sumaTras);
    return lineas.map((l, i) => {
      const packs = Math.max(l.cantidad, 0) || 1;
      const base = tras[i];
      const dPed = sumaTras > 0 ? (ped * base) / sumaTras : 0;
      const neto = Math.max(brutos[i] - (l.descuento || 0) - dPed, 0);
      return neto / packs;
    });
  }, [lineas, descuentoPedidoNum, descuentoPctNum]);

  const cuotaManejoPctNum = useMemo(() => {
    const v = n(cuotaManejoPct);
    if (!Number.isFinite(v) || v <= 0) return CUOTA_MANEJO_PCT_DEFAULT;
    return Math.min(v, 100);
  }, [cuotaManejoPct]);

  const cuotaManejoPreview = useMemo(() => {
    const valor = valorMercanciaCopPreview(lineas, moneda, trmNum);
    const cuota = Math.round(valor * (cuotaManejoPctNum / 100));
    const total = Math.round((valor + cuota) * 100) / 100;
    return { valor, cuota, total, pct: cuotaManejoPctNum };
  }, [lineas, moneda, trmNum, cuotaManejoPctNum]);

  // Al cambiar flete / TRM / cantidades, forzar costo unitario desde la fórmula
  useEffect(() => {
    setLineas((prev) => {
      if (!prev.length || costosRecalc.length !== prev.length) return prev;
      let changed = false;
      const next = prev.map((l, i) => {
        const c = costosRecalc[i];
        const nextC = Number.isFinite(c) ? c : null;
        const same =
          (l.costo_unitario_cop == null && nextC == null) ||
          (l.costo_unitario_cop != null &&
            nextC != null &&
            Math.abs(l.costo_unitario_cop - nextC) < 1e-9);
        if (same) return l;
        changed = true;
        return { ...l, costo_unitario_cop: nextC };
      });
      return changed ? next : prev;
    });
  }, [landedInputsKey, costosRecalc]);

  const aplicarExtract = useCallback((json: ExtractResp) => {
    const mon = (json.moneda || "USD").toUpperCase();
    setMoneda(mon);
    setMonedaFlete((json.moneda_flete_detectada || mon).toUpperCase());
    setProveedor(json.proveedor || "");
    setNumeroPedido(
      (json.numero_pedido || json.referencia || "").trim(),
    );
    if (json.fecha_detectada_ocr || json.fecha_compra) {
      setFechaCompra(json.fecha_detectada_ocr || json.fecha_compra || "");
      trmManualRef.current = false;
    }
    if (json.trm_usada != null && json.trm_usada > 0) {
      setTrm(String(json.trm_usada));
      setTrmFuente(json.trm_fuente || (mon === "USD" ? "banrep" : "manual"));
      trmManualRef.current = json.trm_fuente === "manual";
      const d = json.trm_detalle;
      if (d) {
        const vig =
          d.vigencia_desde && d.vigencia_hasta
            ? `vigente ${d.vigencia_desde} → ${d.vigencia_hasta}`
            : "";
        setTrmDetalle(
          [vig, d.aproximada ? "aproximada" : "", d.aviso || ""]
            .filter(Boolean)
            .join(" · ") || "BanRep",
        );
      } else if (json.trm_fuente === "banrep") {
        setTrmDetalle("BanRep (datos.gov.co)");
      }
    } else if (json.trm_error) {
      setTrmDetalle(json.trm_error);
    }
    if (json.flete_usado != null && Number(json.flete_usado) >= 0 && json.flete_neteado) {
      setFlete(String(json.flete_usado));
    } else if (json.flete_neto != null && Number(json.flete_neto) >= 0 && json.flete_neteado) {
      setFlete(String(json.flete_neto));
    } else if (json.flete_detectado != null && json.flete_detectado > 0) {
      setFlete(String(json.flete_detectado));
    }
    if (json.descuento_detectado != null && json.descuento_detectado > 0) {
      setDescuentoPedido(String(json.descuento_detectado));
      setDescuentoPct("");
    } else if (json.flete_neteado && (json.descuento_detectado_bruto ?? 0) > 0) {
      // El descuento era de envío (o match flete≈descuento): no cargar como desc. mercancía
      setDescuentoPedido("");
      if (json.descuento_pct != null && json.descuento_pct > 0) {
        setDescuentoPct(String(json.descuento_pct));
      } else {
        setDescuentoPct("");
      }
    } else if (json.descuento_pct != null && json.descuento_pct > 0) {
      setDescuentoPct(String(json.descuento_pct));
    }
    if (json.flete_neteado) {
      const bruto = json.flete_bruto ?? json.flete_detectado;
      const descF = json.descuento_flete_aplicado ?? json.descuento_flete_detectado;
      setOkMsg(
        `Flete neteado: cobrado ${bruto ?? "?"} − desc. envío ${descF ?? "?"} = ${json.flete_usado ?? json.flete_neto ?? 0} (no suma al costo).`,
      );
    }
    const src = json.lineas_landed?.length ? json.lineas_landed : json.lineas;
    setLineas(
      (src || []).map((l, i) => {
        const cantidad = n(l.cantidad, 1);
        const inferred = inferirUnidadYContenido(
          l.nombre,
          l.unidad || "",
          n(l.unidades_por_pack, 0) || undefined,
        );
        const unidad = (normalizarUnidadBase(l.unidad || "") || inferred.unidad) as UnidadBase;
        const upp =
          n(l.unidades_por_pack, 0) > 0 ? n(l.unidades_por_pack) : inferred.contenido;
        const subtotal = n(l.subtotal) || cantidad * n(l.precio_unit);
        let desc = n(l.descuento);
        if (desc <= 0 && l.descuento_pct != null && n(l.descuento_pct) > 0) {
          desc = Math.round(subtotal * Math.min(n(l.descuento_pct), 100) / 100 * 1e6) / 1e6;
        }
        return {
          id: l.id || `L${i + 1}`,
          seleccionada: true,
          nombre: l.nombre,
          nombre_ocr: l.nombre,
          sku: "",
          cantidad,
          unidades_por_pack: upp,
          unidad,
          precio_unit: n(l.precio_unit),
          subtotal,
          descuento: desc,
          categoria: unidad === "un" ? "empaque" : "material",
          costo_unitario_cop:
            l.costo_unitario_cop != null && Number.isFinite(l.costo_unitario_cop)
              ? Number(l.costo_unitario_cop)
              : null,
        };
      }),
    );
  }, []);

  const enviar = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setError(null);
      setOkMsg(null);
      setScanning(true);
      try {
        const fd = new FormData();
        for (const f of files) fd.append("imagenes", f);
        if (fechaCompra.trim()) fd.append("fecha_compra", fechaCompra.trim());
        if (trmManualRef.current && trm.trim()) fd.append("trm", trm.trim());
        if (flete.trim()) fd.append("flete", flete.trim());
        if (monedaFlete.trim()) fd.append("moneda_flete", monedaFlete.trim());
        const json = await api.upload<ExtractResp>("/api/rentabilidad/extraer-compra-imagen", fd);
        if (json.error) throw new Error(json.error);
        aplicarExtract(json);
        const nImg = json.imagenes_procesadas ?? files.length;
        const trmMsg =
          json.trm_fuente === "banrep" && json.trm_usada
            ? ` TRM BanRep ${json.trm_usada} (${json.fecha_compra || fechaCompra}).`
            : "";
        setOkMsg(
          `Extraídas ${json.lineas?.length ?? 0} líneas desde ${nImg} imagen(es).${trmMsg} Revisa y confirma.`,
        );
        if ((json.lineas?.length ?? 0) > 0 || (json.lineas_landed?.length ?? 0) > 0) {
          setModalVerificar(true);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [aplicarExtract, fechaCompra, flete, monedaFlete, trm],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const valid = incoming.filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf" || esImagenPortapapeles(f),
      );
      if (!valid.length) return;
      setOkMsg(null);
      setError(null);
      setGaleria((prev) => {
        const added: GaleriaItem[] = valid.map((file) => ({
          id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          preview:
            file.type.startsWith("image/") || esImagenPortapapeles(file)
              ? URL.createObjectURL(file)
              : null,
          serverIndex: null,
          name: file.name || "imagen",
        }));
        const next = [...prev, ...added];
        const locales = next.filter((g) => g.file).map((g) => g.file as File);
        if (locales.length) queueMicrotask(() => void enviar(locales));
        return next;
      });
    },
    [enviar],
  );

  addFilesRef.current = addFiles;

  const quitarDeGaleria = (id: string) => {
    setGaleria((prev) => {
      const victim = prev.find((g) => g.id === id);
      if (victim?.preview?.startsWith("blob:")) URL.revokeObjectURL(victim.preview);
      const next = prev.filter((g) => g.id !== id);
      const locales = next.filter((g) => g.file).map((g) => g.file as File);
      if (locales.length) void enviar(locales);
      else if (!next.length) setLineas([]);
      return next;
    });
  };

  const reordenarGaleria = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setGaleria((prev) => {
      const from = prev.findIndex((g) => g.id === fromId);
      const to = prev.findIndex((g) => g.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  /** Ctrl+V en toda la pestaña (capture), mientras el panel esté montado. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imagenDesdePortapapeles(e.clipboardData);
      if (!file) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        panelRef.current &&
        !panelRef.current.contains(active) &&
        active !== document.body &&
        active !== document.documentElement
      ) {
        const tag = active.tagName;
        if ((tag === "INPUT" || tag === "TEXTAREA") && !panelRef.current?.contains(active)) {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      addFilesRef.current([file]);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, []);

  useEffect(() => {
    zonaRef.current?.focus();
  }, []);

  const manejarPasteZona = (e: ReactClipboardEvent) => {
    const file = imagenDesdePortapapeles(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    addFiles([file]);
  };

  const limpiar = () => {
    setGaleria((prev) => {
      revokeGaleria(prev);
      return [];
    });
    setLineas([]);
    setOkMsg(null);
    setError(null);
    setProveedor("");
    setNumeroPedido("");
    setDescuentoPedido("");
    setDescuentoPct("");
    setBorradorId(null);
    setCompraIdEditando(null);
    setEmisorUsuarioId(emisorSesion?.id ?? "");
    setModalVerificar(false);
  };

  const guardarBorrador = async () => {
    if (!lineas.length && !galeria.length) {
      setError("No hay nada que guardar: agrega imágenes o líneas primero.");
      return;
    }
    setGuardandoBorrador(true);
    setError(null);
    setOkMsg(null);
    try {
      const estado = {
        numero_pedido: numeroPedido.trim(),
        lineas: lineas.map((l, i) => ({
          id: l.id,
          seleccionada: l.seleccionada,
          nombre: l.nombre,
          nombre_ocr: l.nombre_ocr,
          sku: l.sku,
          cantidad: l.cantidad,
          unidades_por_pack: l.unidades_por_pack,
          unidad: l.unidad,
          precio_unit: l.precio_unit,
          subtotal: l.subtotal,
          descuento: l.descuento,
          categoria: l.categoria,
          costo_unitario_cop: Number.isFinite(costosRecalc[i])
            ? costosRecalc[i]
            : l.costo_unitario_cop,
        })),
      };
      const fd = new FormData();
      fd.append("estado", JSON.stringify(estado));
      if (borradorId) fd.append("borrador_id", String(borradorId));
      fd.append("moneda", moneda);
      fd.append("trm", String(trmNum || 0));
      fd.append("trm_fuente", trmFuente || "");
      fd.append("fecha_compra", fechaCompra || "");
      fd.append("numero_pedido", numeroPedido.trim());
      fd.append("flete", String(fleteNum || 0));
      fd.append("moneda_flete", monedaFlete || moneda);
      fd.append("descuento_pedido", String(descuentoPedidoNum || 0));
      fd.append("descuento_pct", String(descuentoPctNum || 0));
      fd.append("proveedor", proveedor);
      fd.append("titulo", proveedor || lineas[0]?.nombre || "Borrador compra exterior");

      // Solo índices de servidor = reordenar/eliminar sin re-subir.
      // Si hay archivos nuevos o mezcla → reemplazar toda la galería en orden.
      const soloServidor =
        galeria.length === 0 ||
        galeria.every((g) => g.serverIndex != null && !g.file);
      if (soloServidor) {
        fd.append(
          "soportes_indices",
          JSON.stringify(galeria.map((g) => g.serverIndex as number)),
        );
        fd.append("append_soportes", "1");
      } else {
        fd.append("replace_soportes", "1");
        fd.append("append_soportes", "0");
        fd.append("soportes_indices", "[]");
        for (const g of galeria) {
          const f = await fileDesdeGaleriaItem(g);
          if (f) fd.append("imagenes", f);
        }
      }

      const res = await api.upload<{ ok: boolean; borrador: BorradorCompra }>(
        "/api/rentabilidad/compras-exterior/borrador",
        fd,
      );
      setBorradorId(res.borrador.id);
      setGaleria((prev) => {
        revokeGaleria(prev);
        return [];
      });
      const thumbs = await galeriaDesdeSoporteUrls(res.borrador.soporte_urls || []);
      setGaleria(thumbs);
      setOkMsg(
        `Borrador #${res.borrador.id} guardado. Puedes cerrar y retomar después desde la lista.`,
      );
      await cargarHistorial();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardandoBorrador(false);
    }
  };

  const retomarBorrador = async (id: number) => {
    setError(null);
    setOkMsg(null);
    try {
      const b = await api.get<BorradorCompra>(
        `/api/rentabilidad/compras-exterior/borrador/${id}`,
      );
      const rawLineas = (b.estado?.lineas || b.lineas || []) as LineaEditable[];
      setBorradorId(b.id);
      setCompraIdEditando(null);
      setMoneda((b.moneda || "USD").toUpperCase());
      setTrm(b.trm ? String(b.trm) : "");
      setTrmFuente(b.trm_fuente || (b.moneda === "USD" ? "banrep" : ""));
      trmManualRef.current = b.trm_fuente === "manual";
      setFechaCompra(b.fecha_compra || new Date().toISOString().slice(0, 10));
      setFlete(b.flete != null && Number(b.flete) !== 0 ? String(b.flete) : b.flete === 0 ? "0" : "");
      setMonedaFlete((b.moneda_flete || b.moneda || "USD").toUpperCase());
      setDescuentoPedido(b.descuento_pedido ? String(b.descuento_pedido) : "");
      setDescuentoPct(b.descuento_pct ? String(b.descuento_pct) : "");
      setProveedor(b.proveedor || "");
      setNumeroPedido(String(b.estado?.numero_pedido || "").trim());
      setLineas(
        rawLineas.map((l, i) => ({
          id: l.id || `L${i + 1}`,
          seleccionada: l.seleccionada !== false,
          nombre: l.nombre || "",
          nombre_ocr: l.nombre_ocr || l.nombre || "",
          sku: l.sku || "",
          cantidad: n(l.cantidad, 1),
          unidades_por_pack: n(l.unidades_por_pack, 1),
          unidad: l.unidad || "un",
          precio_unit: n(l.precio_unit),
          subtotal: n(l.subtotal) || n(l.cantidad, 1) * n(l.precio_unit),
          descuento: n(l.descuento),
          categoria: l.categoria || "material",
          costo_unitario_cop:
            l.costo_unitario_cop != null && Number.isFinite(Number(l.costo_unitario_cop))
              ? Number(l.costo_unitario_cop)
              : null,
        })),
      );
      setGaleria((prev) => {
        revokeGaleria(prev);
        return [];
      });
      const thumbs = await galeriaDesdeSoporteUrls(b.soporte_urls || []);
      setGaleria(thumbs);
      setOkMsg(
        `Borrador #${b.id} retomado (${rawLineas.length} líneas). Arrastra las fotos para reordenar o quítalas con ✕.`,
      );
      setModalVerificar(true);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const eliminarBorrador = async (id: number) => {
    if (!confirm(`¿Eliminar borrador #${id}?`)) return;
    try {
      await api.delete(`/api/rentabilidad/compras-exterior/borrador/${id}`);
      if (borradorId === id) limpiar();
      await cargarHistorial();
      setOkMsg(`Borrador #${id} eliminado.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const eliminarCompra = async (id: number) => {
    if (!confirm(`¿Eliminar la compra #${id} del historial? Se borrarán también los pantallazos de soporte.`)) {
      return;
    }
    try {
      await api.delete(`/api/rentabilidad/compras-exterior/${id}`);
      if (compraIdEditando === id) limpiar();
      setDetalleId((prev) => (prev === id ? null : prev));
      setSoporteThumbs((prev) => {
        const next = { ...prev };
        const u = next[id];
        if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
        delete next[id];
        return next;
      });
      await cargarHistorial();
      setOkMsg(`Compra #${id} eliminada del historial.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const editarCompra = async (id: number) => {
    setError(null);
    setOkMsg(null);
    try {
      const c = await api.get<CompraHistorial>(
        `/api/rentabilidad/compras-exterior/${id}`,
      );
      setCompraIdEditando(c.id);
      setBorradorId(null);
      setMoneda((c.moneda || "USD").toUpperCase());
      setTrm(c.trm ? String(c.trm) : "");
      setTrmFuente(c.trm_fuente || (c.moneda === "USD" ? "banrep" : ""));
      trmManualRef.current = c.trm_fuente === "manual";
      setFechaCompra(c.fecha_compra || new Date().toISOString().slice(0, 10));
      setFlete(c.flete != null && Number(c.flete) !== 0 ? String(c.flete) : c.flete === 0 ? "0" : "");
      setMonedaFlete((c.moneda_flete || c.moneda || "USD").toUpperCase());
      setProveedor(c.proveedor || "");
      setNumeroPedido((c.numero_pedido || "").trim());
      setCuotaManejoPct(
        c.cuota_pct != null && Number(c.cuota_pct) > 0
          ? String(c.cuota_pct)
          : String(CUOTA_MANEJO_PCT_DEFAULT),
      );
      setEmisorUsuarioId(c.emisor_usuario_id || emisorSesion?.id || "");
      setDescuentoPedido("");
      setDescuentoPct("");
      setLineas(
        (c.lineas || []).map((l, i) => {
          const cant = n(l.cantidad, 1);
          const upp = n(l.unidades_por_pack, 1) || 1;
          const precio = n(l.precio_unit);
          const sub = n(l.subtotal) || cant * precio;
          return {
            id: `H${c.id}-${i + 1}`,
            seleccionada: true,
            nombre: l.nombre || "",
            nombre_ocr: l.nombre_ocr || l.nombre || "",
            sku: (l.codigo || "").trim(),
            cantidad: cant,
            unidades_por_pack: upp,
            unidad: l.unidad || "un",
            precio_unit: precio,
            subtotal: sub,
            descuento: n(l.descuento),
            categoria: l.categoria || "material",
            costo_unitario_cop:
              l.costo_unitario != null && Number.isFinite(Number(l.costo_unitario))
                ? Number(l.costo_unitario)
                : null,
          };
        }),
      );
      setGaleria((prev) => {
        revokeGaleria(prev);
        return [];
      });
      const thumbs = await galeriaDesdeSoporteUrls(c.soporte_urls || []);
      setGaleria(thumbs);
      setDetalleId(c.id);
      setOkMsg(
        `Editando compra #${c.id}. Cambia líneas, fotos o TRM y pulsa «Actualizar costos».`,
      );
      setModalVerificar(true);
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const patchLinea = (id: string, patch: Partial<LineaEditable>) => {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (
          (patch.nombre != null || patch.unidad != null) &&
          patch.unidades_por_pack == null
        ) {
          const inferred = inferirUnidadYContenido(next.nombre, next.unidad);
          if (patch.unidad == null) next.unidad = inferred.unidad;
          if (inferred.contenido > 1 && l.unidades_por_pack <= 1) {
            next.unidades_por_pack = inferred.contenido;
          }
        }
        if (patch.cantidad != null || patch.precio_unit != null) {
          next.subtotal = Math.round(next.cantidad * next.precio_unit * 1e6) / 1e6;
          if (next.descuento > next.subtotal) next.descuento = next.subtotal;
        }
        if (patch.descuento != null && next.descuento < 0) next.descuento = 0;
        return next;
      }),
    );
  };

  const seleccionadas = lineas.filter((l) => l.seleccionada);
  const costoDeLinea = (l: LineaEditable) => {
    const idx = lineas.findIndex((x) => x.id === l.id);
    if (idx >= 0 && Number.isFinite(costosRecalc[idx])) return costosRecalc[idx];
    return l.costo_unitario_cop;
  };
  const puedenGuardar =
    seleccionadas.length > 0 &&
    seleccionadas.every((l) => {
      const c = costoDeLinea(l);
      return l.nombre.trim() && c != null && Number.isFinite(c) && c >= 0;
    }) &&
    (!necesitaTrm || trmNum > 0);

  const guardar = async () => {
    if (!puedenGuardar) return;
    setGuardando(true);
    setError(null);
    setOkMsg(null);
    try {
      const items = seleccionadas.map((l) => {
        const costoLive = costoDeLinea(l);
        return {
          nombre: l.nombre.trim(),
          codigo: l.sku.trim() || undefined,
          sku: l.sku.trim() || undefined,
          nombre_ocr: l.nombre_ocr,
          cantidad: l.cantidad,
          unidades_por_pack: l.unidades_por_pack,
          unidades_totales: l.cantidad * Math.max(l.unidades_por_pack, 1),
          unidad: normalizarUnidadBase(l.unidad) || "un",
          precio_unit: l.precio_unit,
          subtotal: l.subtotal,
          descuento: l.descuento,
          costo_unitario: costoLive,
          categoria: l.categoria || "material",
          iva_incluido: false,
        };
      });

      const fd = new FormData();
      fd.append("items", JSON.stringify(items));
      fd.append("moneda", moneda);
      fd.append("trm", String(necesitaTrm ? trmNum : 1));
      fd.append("trm_fuente", trmFuente || (moneda.toUpperCase() === "USD" ? "banrep" : ""));
      fd.append("fecha_compra", fechaCompra || "");
      fd.append("numero_pedido", numeroPedido.trim());
      fd.append("flete", String(fleteNum || 0));
      fd.append("moneda_flete", monedaFlete || moneda);
      fd.append("descuento_pedido", String(descuentoPedidoNum || 0));
      fd.append("descuento_pct", String(descuentoPctNum || 0));
      fd.append("cuota_pct", String(cuotaManejoPctNum));
      fd.append("proveedor", proveedor);
      if (emisorUsuarioId) fd.append("emisor_usuario_id", String(emisorUsuarioId));
      if (borradorId) fd.append("borrador_id", String(borradorId));
      if (compraIdEditando) fd.append("compra_id", String(compraIdEditando));

      const soloServidor =
        galeria.length > 0 &&
        galeria.every((g) => g.serverIndex != null && !g.file);
      if (soloServidor) {
        fd.append(
          "soportes_indices",
          JSON.stringify(galeria.map((g) => g.serverIndex as number)),
        );
      } else {
        for (const g of galeria) {
          const f = await fileDesdeGaleriaItem(g);
          if (f) fd.append("imagenes", f);
        }
      }

      const res = await api.upload<{
        ok: boolean;
        total: number;
        editado?: boolean;
        errores: Array<{ nombre: string; error: string }>;
        historial?: CompraHistorial | null;
      }>("/api/rentabilidad/confirmar-compra-exterior", fd);

      if (res.errores?.length) {
        setError(
          `Guardados ${res.total}. Errores: ${res.errores.map((e) => `${e.nombre}: ${e.error}`).join("; ")}`,
        );
      } else {
        const verbo = res.editado || compraIdEditando ? "Actualizados" : "Guardados";
        const cuotaMsg =
          res.historial?.cuenta_cobro_pendiente || res.historial?.total_cobro_cop
            ? ` Cuentas listas para aprobar: mercancía+${res.historial.cuota_pct ?? 5}%${
                (res.historial.flete_cobro_cop ?? 0) > 0
                  ? ` y flete ${fmtCop(res.historial.flete_cobro_cop ?? 0)}`
                  : ""
              }.`
            : "";
        setOkMsg(
          `${verbo} ${res.total} costos` +
            (res.historial?.tiene_soporte
              ? ` y ${galeria.length || res.historial.soportes_count || 1} soporte(s) en el historial.`
              : galeria.length
                ? "."
                : " (sin pantallazo: vuelve a pegarlo antes de guardar para adjuntar soporte).") +
            cuotaMsg,
        );
        setBorradorId(null);
        setCompraIdEditando(null);
        setGaleria((prev) => {
          revokeGaleria(prev);
          return [];
        });
        setLineas([]);
        setModalVerificar(false);
      }
      await cargarHistorial();
      if (res.historial?.id) {
        setDetalleId(res.historial.id);
        if (res.historial.total_cobro_cop && res.historial.total_cobro_cop > 0) {
          setCuentaCobroId(res.historial.id);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf" || esImagenPortapapeles(f);

  return (
    <div ref={panelRef} className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* Captura + casillas a un lado */}
        <aside className="flex w-full shrink-0 flex-col gap-2 xl:w-[20rem] xl:max-w-[22rem]">
      <div
        ref={zonaRef}
        tabIndex={0}
        role="button"
        aria-label="Zona para pegar o adjuntar varias imágenes"
        onFocus={() => setZonaActiva(true)}
        onBlur={() => setZonaActiva(false)}
        onClick={() => zonaRef.current?.focus()}
        onPaste={manejarPasteZona}
        className={`rounded-xl border border-dashed bg-accent/5 p-2.5 space-y-1.5 outline-none transition ${
          zonaActiva ? "border-accent ring-2 ring-accent/30" : "border-accent/50"
        }`}
        onDrop={(e) => {
          e.preventDefault();
          const list = Array.from(e.dataTransfer.files || []).filter(esValido);
          if (list.length) addFiles(list);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-accent">Pegar / adjuntar</p>
            <p className="text-[10px] leading-snug text-muted">
              Ctrl+V o Adjuntar… · arrastra para ordenar
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
              disabled={scanning}
              className="rounded border border-accent/40 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {scanning ? "…" : "Adjuntar…"}
            </button>
            {(galeria.length > 0 || lineas.length > 0 || borradorId || compraIdEditando) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  limpiar();
                }}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-danger hover:border-danger"
              >
                Limpiar
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files || []).filter(esValido);
              e.target.value = "";
              if (list.length) addFiles(list);
            }}
          />
        </div>
        {galeria.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {galeria.map((g, idx) => (
              <div
                key={g.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDragId(g.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", g.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const from = e.dataTransfer.getData("text/plain") || dragId;
                  if (from) reordenarGaleria(from, g.id);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className={`relative w-[4.5rem] cursor-grab active:cursor-grabbing rounded border bg-surface overflow-hidden ${
                  dragId === g.id
                    ? "border-accent opacity-60 ring-2 ring-accent/40"
                    : g.serverIndex != null
                      ? "border-accent/40"
                      : "border-border"
                }`}
                title="Arrastra para reordenar"
              >
                {g.preview ? (
                  <img
                    src={g.preview}
                    alt={g.name}
                    className="h-12 w-full object-contain bg-surface-input pointer-events-none"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-12 items-center justify-center px-1 text-[9px] text-muted truncate pointer-events-none">
                    {g.name}
                  </div>
                )}
                <div className="flex items-center justify-between gap-0.5 px-0.5 py-px text-[9px]">
                  <span className="truncate text-muted">
                    #{idx + 1}
                    {g.serverIndex != null ? " · ok" : ""}
                  </span>
                  <button
                    type="button"
                    title="Quitar imagen"
                    onClick={(e) => {
                      e.stopPropagation();
                      quitarDeGaleria(g.id);
                    }}
                    className="rounded px-0.5 font-bold text-danger hover:bg-danger/10"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {scanning && (
          <p className="text-[10px] text-accent animate-pulse">
            Analizando con IA…
          </p>
        )}
        {!galeria.length && !scanning && (
          <p className="py-3 text-center text-[11px] font-medium text-muted">
            Ctrl+V o Adjuntar…
          </p>
        )}
        {borradorId && (
          <p className="text-[10px] text-accent">
            Borrador #{borradorId} en edición.
          </p>
        )}
        {compraIdEditando && (
          <p className="text-[10px] text-accent">
            Compra #{compraIdEditando} en edición.
          </p>
        )}
      </div>

      {(lineas.length > 0 || scanning) && (
        <button
          type="button"
          onClick={() => setModalVerificar(true)}
          className="w-full rounded-xl border border-accent/50 bg-accent/10 px-3 py-2.5 text-left hover:bg-accent/15"
        >
          <p className="text-xs font-semibold text-accent">
            {scanning ? "Analizando imagen…" : "Verificar extracción"}
          </p>
          <p className="text-[10px] text-muted">
            {scanning
              ? "La IA está leyendo el pantallazo"
              : `${lineas.length} línea(s) · fecha ${fechaCompra || "—"} · ${moneda}${trmNum ? ` · TRM ${trmNum}` : ""}`}
          </p>
        </button>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-2 py-1.5 text-[10px] text-danger">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
          {okMsg}
        </div>
      )}
        </aside>

        {/* Listado amplio */}
        <div className="min-w-0 flex-1 space-y-3">
      {borradores.length > 0 && (
        <section className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Borradores pendientes</h3>
              <p className="text-[11px] text-muted">
                Compras a medias: retoma, edita y confirma cuando esté listo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void cargarHistorial()}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
            >
              Actualizar
            </button>
          </div>
          <ul className="space-y-1.5">
            {borradores.map((b) => {
              const fecha = b.updated_at
                ? new Date(b.updated_at).toLocaleString("es-CO")
                : "";
              const activo = borradorId === b.id;
              return (
                <li
                  key={b.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-2 ${
                    activo ? "border-accent bg-accent/10" : "border-border bg-surface"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink">
                      #{b.id} · {b.titulo || b.proveedor || "Sin título"}
                      {activo ? " · en edición" : ""}
                    </p>
                    <p className="text-[10px] text-muted">
                      {fecha}
                      {b.moneda ? ` · ${b.moneda}` : ""}
                      {b.lineas_count != null ? ` · ${b.lineas_count} líneas` : ""}
                      {b.soportes_count ? ` · ${b.soportes_count} foto(s)` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void retomarBorrador(b.id)}
                    className="rounded border border-accent/40 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
                  >
                    Retomar
                  </button>
                  <button
                    type="button"
                    onClick={() => void eliminarBorrador(b.id)}
                    className="rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-danger hover:border-danger"
                  >
                    Eliminar
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface-panel p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Historial de compras exterior</h3>
            <p className="text-[11px] text-muted">
              Marca varias compras del mismo paquete para enlazarlas: el flete se liquida
              con la TRM BanRep de la <strong>fecha de envío</strong> y se reparte por{" "}
              <strong>% de paquetes</strong> (sube el costo de cada referencia). La mercancía
              sigue con la TRM de cada compra. Hay <strong>cuenta de mercancía</strong> por
              compra y <strong>una de flete</strong> por paquete.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={resetCobroBusy}
              onClick={() => void resetearCuentasCobro()}
              className="rounded border border-amber-600/50 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
              title="Borra PDF generados y deja cuentas pendientes para reaprobar (p. ej. tras fletes con descuento)"
            >
              {resetCobroBusy ? "Limpiando…" : "Limpiar PDF cuentas"}
            </button>
            <button
              type="button"
              onClick={() => void cargarHistorial()}
              className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
            >
              {historialLoading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {seleccionIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
            <span className="text-[11px] text-ink">
              {seleccionIds.length} compra(s) seleccionada(s)
            </span>
            <button
              type="button"
              onClick={abrirCrearEnvio}
              className="rounded bg-accent px-3 py-1 text-[11px] font-semibold text-white"
            >
              Enlazar en un envío
            </button>
            <button
              type="button"
              onClick={() => setSeleccionIds([])}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted"
            >
              Quitar selección
            </button>
          </div>
        )}

        {historial.length === 0 && !historialLoading && (
          <p className="text-xs text-muted py-4 text-center">
            Aún no hay compras confirmadas. Usa «Guardar para después» si quieres retomar más tarde.
          </p>
        )}

        <ul className="space-y-2">
          {gruposHistorial.map((g) => {
            const compras = g.kind === "envio" ? g.compras : [g.compra];
            const envio = g.kind === "envio" ? g.envio : null;
            const filas = compras.map((c) => {
            const abierto = detalleId === c.id;
            const thumb = soporteThumbs[c.id];
            const fecha = c.created_at ? new Date(c.created_at).toLocaleString("es-CO") : "";
            const editando = compraIdEditando === c.id;
            return (
              <div
                key={c.id}
                className={`overflow-hidden ${
                  envio
                    ? "border-t border-border/70 first:border-t-0"
                    : `rounded-lg border bg-surface ${
                        editando ? "border-accent ring-1 ring-accent/30" : "border-border"
                      }`
                }`}
              >
                <div className="flex items-start gap-2 p-2">
                  <label className="mt-1 shrink-0" title="Seleccionar para enlazar en un envío">
                    <input
                      type="checkbox"
                      checked={seleccionIds.includes(c.id)}
                      onChange={() => toggleSeleccion(c.id)}
                      className="accent-accent"
                    />
                  </label>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-3 text-left hover:opacity-90"
                    onClick={() => {
                      setCuentaCobroId(c.id);
                      setDetalleId(c.id);
                    }}
                    title="Revisar adjunto, datos y PDF"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-border bg-surface-input">
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[9px] text-muted">
                          {c.tiene_soporte ? "…" : "sin foto"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink">
                        #{c.id} · {fecha}
                        {c.proveedor ? ` · ${c.proveedor}` : ""}
                        {c.numero_pedido ? ` · ped. ${c.numero_pedido}` : ""}
                        {editando ? " · en edición" : ""}
                      </p>
                      <p className="text-[10px] text-muted">
                        {c.moneda}
                        {c.fecha_compra ? ` · compra ${c.fecha_compra}` : ""}
                        {c.trm
                          ? ` · TRM ${c.trm}${c.trm_fuente === "banrep" ? " BanRep" : ""}`
                          : ""}
                        {c.flete && !c.envio ? ` · flete ${c.flete} ${c.moneda_flete || c.moneda}` : ""}
                        {" · "}
                        {c.total_guardados} costo(s)
                        {c.total_cobro_cop != null && c.total_cobro_cop > 0
                          ? c.cuenta_cobro_estado === "aprobada" || c.tiene_cuenta_cobro
                            ? ` · merc. OK ${fmtCop(c.total_cobro_cop)}`
                            : ` · merc. pend. ${fmtCop(c.total_cobro_cop)}`
                          : ""}
                        {c.flete_cobro_cop != null && c.flete_cobro_cop > 0 && !c.envio
                          ? c.cuenta_flete_estado === "aprobada" || c.tiene_cuenta_flete
                            ? ` · flete OK ${fmtCop(c.flete_cobro_cop)}`
                            : ` · flete pend. ${fmtCop(c.flete_cobro_cop)}`
                          : ""}
                        {c.emisor_nombre ? ` · a nombre de ${c.emisor_nombre}` : ""}
                      </p>
                      <p className="truncate text-[10px] text-muted">
                        {(c.lineas || [])
                          .map((l) => `${l.codigo ? l.codigo + " " : ""}${l.nombre}`)
                          .join(" · ") || "Sin líneas"}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted">{abierto ? "▲" : "▼"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void editarCompra(c.id)}
                    className="shrink-0 rounded border border-accent/40 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCuentaCobroId(c.id);
                      setDetalleId(c.id);
                    }}
                    className="shrink-0 rounded border border-accent/40 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
                    title="Ver / aprobar cuenta de cobro"
                  >
                    {c.tiene_cuenta_cobro || c.cuenta_cobro_estado === "aprobada"
                      ? "Ver cobro"
                      : "Aprobar cobro"}
                  </button>
                  {(c.tiene_cuenta_cobro || c.cuenta_cobro_estado === "aprobada") && (
                    <button
                      type="button"
                      onClick={() => {
                        void descargarCuentaCobro(c.id, "mercancia").catch((e: unknown) =>
                          setError(e instanceof Error ? e.message : String(e)),
                        );
                      }}
                      className="shrink-0 rounded border border-emerald-600/40 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      PDF merc.
                    </button>
                  )}
                  {(c.tiene_cuenta_flete || c.cuenta_flete_estado === "aprobada") && !c.envio && (
                    <button
                      type="button"
                      onClick={() => {
                        void descargarCuentaCobro(c.id, "flete").catch((e: unknown) =>
                          setError(e instanceof Error ? e.message : String(e)),
                        );
                      }}
                      className="shrink-0 rounded border border-emerald-600/40 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    >
                      PDF flete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void eliminarCompra(c.id)}
                    className="shrink-0 rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-danger hover:border-danger"
                  >
                    Eliminar
                  </button>
                </div>
                {abierto && (
                  <div className="border-t border-border bg-surface-input/40 p-2 space-y-2">
                    {thumb && (
                      <a href={thumb} target="_blank" rel="noreferrer" className="block">
                        <img
                          src={thumb}
                          alt="Soporte de compra"
                          className="max-h-56 w-full rounded border border-border object-contain bg-surface"
                        />
                      </a>
                    )}
                    <table className="min-w-full text-left text-[10px]">
                      <thead className="text-muted uppercase">
                        <tr>
                          <th className="px-1 py-1">SKU</th>
                          <th className="px-1 py-1">Producto</th>
                          <th className="px-1 py-1">Total</th>
                          <th className="px-1 py-1">Costo/ud</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(c.lineas || []).map((l, i) => {
                          const ud = etiquetaUnidad(l.unidad || "un").toLowerCase();
                          return (
                          <tr key={i} className="border-t border-border/60">
                            <td className="px-1 py-1 font-mono text-accent">{l.codigo || "—"}</td>
                            <td className="px-1 py-1">{l.nombre}</td>
                            <td className="px-1 py-1 font-mono">
                              {l.unidades_totales ?? l.cantidad ?? "—"} {ud}
                            </td>
                            <td className="px-1 py-1 font-mono">
                              {l.costo_unitario != null
                                ? `${fmtCop(Number(l.costo_unitario))}/${ud}`
                                : "—"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
            });
            if (envio) {
              return (
                <li
                  key={`e-${envio.id}`}
                  className="rounded-lg border border-accent/50 bg-surface overflow-hidden"
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 py-2">
                    <span className="text-xs font-semibold text-ink">
                      Envío #{envio.id}
                      {envio.fecha_envio ? ` · ${envio.fecha_envio}` : ""}
                    </span>
                    <span className="text-[10px] text-muted">
                      flete {envio.flete} {envio.moneda_flete}
                      {envio.trm
                        ? ` · TRM ${envio.trm}${envio.trm_fuente === "banrep" ? " BanRep" : ""}`
                        : ""}
                      {envio.flete_cobro_cop
                        ? envio.tiene_cuenta_flete
                          ? ` · flete OK ${fmtCop(envio.flete_cobro_cop)}`
                          : ` · flete pend. ${fmtCop(envio.flete_cobro_cop)}`
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => abrirEditarEnvio(envio)}
                      className="rounded border border-accent/40 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10"
                    >
                      Editar envío
                    </button>
                    <button
                      type="button"
                      disabled={envioBusy || !(envio.flete > 0)}
                      onClick={() => void actualizarCostosEnvio(envio)}
                      className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
                      title="Reparte el flete por % de paquetes y actualiza el costo unitario de cada referencia"
                    >
                      {envioBusy ? "Actualizando…" : "Actualizar costos unitarios"}
                    </button>
                    {envio.tiene_cuenta_flete ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <CuentaCobroAccentPicker
                          value={pdfAccentRgb}
                          onChange={setPdfAccentRgb}
                          disabled={envioBusy}
                          compact
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void descargarCuentaFleteEnvio(envio.id).catch((e: unknown) =>
                              setError(e instanceof Error ? e.message : String(e)),
                            );
                          }}
                          className="rounded border border-emerald-600/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                        >
                          PDF flete paquete
                        </button>
                        <button
                          type="button"
                          disabled={envioBusy}
                          onClick={() => void aprobarFleteEnvio(envio)}
                          className="rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted hover:text-ink disabled:opacity-50"
                          title="Regenera el PDF con el color de acento elegido"
                        >
                          Regenerar PDF
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <CuentaCobroAccentPicker
                          value={pdfAccentRgb}
                          onChange={setPdfAccentRgb}
                          disabled={envioBusy}
                          compact
                        />
                        <button
                          type="button"
                          disabled={envioBusy || !(envio.flete > 0)}
                          onClick={() => void aprobarFleteEnvio(envio)}
                          className="rounded border border-accent/40 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                        >
                          Aprobar flete paquete
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void desenlazarEnvio(envio.id)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-danger hover:border-danger"
                    >
                      Desenlazar
                    </button>
                  </div>
                  {filas}
                </li>
              );
            }
            return (
              <li key={compras[0].id} className="list-none">
                {filas}
              </li>
            );
          })}
        </ul>
      </section>
        </div>
      </div>

      {modalVerificar && (
        <Modal
          onClose={() => setModalVerificar(false)}
          title={compraIdEditando
            ? `Verificar compra #${compraIdEditando}`
            : borradorId
              ? `Verificar borrador #${borradorId}`
              : "Verificar extracción de compra"}
          maxWidthClassName="max-w-6xl"
          fixedHeight
          footer={(
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted max-w-md">
                Costo / ud = (P. pack neto × TRM + flete) ÷ Contenido. La cuenta de cobro se abre al confirmar.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setModalVerificar(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted"
                >
                  Seguir después
                </button>
                {!compraIdEditando && (
                  <button
                    type="button"
                    disabled={guardandoBorrador || (!lineas.length && !galeria.length)}
                    onClick={() => void guardarBorrador()}
                    className="rounded-lg border-2 border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink hover:border-accent disabled:opacity-40"
                  >
                    {guardandoBorrador
                      ? "Guardando…"
                      : borradorId
                        ? `Actualizar borrador #${borradorId}`
                        : "Guardar para después"}
                  </button>
                )}
                {lineas.length > 0 && (
                  <button
                    type="button"
                    disabled={!puedenGuardar || guardando}
                    onClick={() => void guardar()}
                    className="rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 hover:bg-accent-hover"
                  >
                    {guardando
                      ? "Guardando…"
                      : compraIdEditando
                        ? `Actualizar costos (#${compraIdEditando})`
                        : `Confirmar costos (${seleccionadas.length})`}
                  </button>
                )}
              </div>
            </div>
          )}
        >
          <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Fecha compra</span>
          <input
            type="date"
            value={fechaCompra}
            onChange={(e) => {
              trmManualRef.current = false;
              setFechaCompra(e.target.value);
            }}
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="block text-[10px] md:col-span-2">
          <span className="font-bold text-muted">Nº pedido / factura</span>
          <input
            value={numeroPedido}
            onChange={(e) => setNumeroPedido(e.target.value)}
            placeholder="Order ID / Invoice No del documento"
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Moneda factura</span>
          <input
            value={moneda}
            onChange={(e) => setMoneda(e.target.value.toUpperCase())}
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="col-span-2 block text-[10px]">
          <span className="font-bold text-muted">
            TRM{" "}
            {moneda.toUpperCase() === "USD"
              ? "(BanRep)"
              : necesitaTrm
                ? "(obligatoria)"
                : "(N/A si COP)"}
          </span>
          <div className="mt-0.5 flex gap-1">
            <input
              type="number"
              min={0}
              step="0.01"
              value={trm}
              disabled={!necesitaTrm || trmLoading}
              onChange={(e) => {
                trmManualRef.current = true;
                setTrmFuente("manual");
                setTrmDetalle("manual (override)");
                setTrm(e.target.value);
              }}
              placeholder={necesitaTrm ? "Auto BanRep" : "1"}
              className="w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono disabled:opacity-40"
            />
            {moneda.toUpperCase() === "USD" && (
              <button
                type="button"
                title="Recargar TRM BanRep de la fecha"
                disabled={trmLoading || !fechaCompra}
                onClick={() => {
                  trmManualRef.current = false;
                  void cargarTrmBanrep(fechaCompra, { forzar: true });
                }}
                className="shrink-0 rounded-lg border border-accent/50 bg-accent/10 px-2 text-[10px] font-bold text-accent disabled:opacity-40"
              >
                {trmLoading ? "…" : "↻"}
              </button>
            )}
          </div>
          {necesitaTrm && trmDetalle && (
            <span className="mt-0.5 block truncate text-[9px] text-muted" title={trmDetalle}>
              {trmFuente === "banrep" ? "BanRep · " : ""}
              {trmDetalle}
            </span>
          )}
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Flete</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={flete}
            onChange={(e) => setFlete(e.target.value)}
            onBlur={() => {
              if (flete.trim() !== "" && !Number.isFinite(n(flete))) setFlete("");
            }}
            placeholder="0"
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Moneda flete</span>
          <input
            value={monedaFlete}
            onChange={(e) => setMonedaFlete(e.target.value.toUpperCase())}
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Cuota manejo %</span>
          <input
            type="number"
            min={0.01}
            max={100}
            step="0.1"
            value={cuotaManejoPct}
            onChange={(e) => setCuotaManejoPct(e.target.value)}
            onBlur={() => {
              const v = n(cuotaManejoPct);
              if (!Number.isFinite(v) || v <= 0) {
                setCuotaManejoPct(String(CUOTA_MANEJO_PCT_DEFAULT));
              } else if (v > 100) {
                setCuotaManejoPct("100");
              }
            }}
            title="Porcentaje de cuota de manejo sobre la mercancía (editable)"
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="col-span-2 block text-[10px]">
          <span className="font-bold text-muted">Cuenta de cobro a nombre de</span>
          <div className="mt-0.5 flex items-center gap-2">
            <select
              value={emisorUsuarioId === "" ? "" : String(emisorUsuarioId)}
              onChange={(e) => setEmisorUsuarioId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs"
              title="Usuario del panel que figura como emisor en el PDF (también define el color de acento)"
            >
              <option value="">Elegir usuario…</option>
              {emisores.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.documento_identidad ? "" : " — falta documento"}
                </option>
              ))}
            </select>
            <span
              className="h-6 w-6 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: `rgb(${pdfAccentRgb.replace(/\s+/g, ",")})` }}
              title={`Acento del PDF: ${pdfAccentRgb}`}
            />
          </div>
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Desc. $ pedido</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={descuentoPedido}
            onChange={(e) => {
              setDescuentoPedido(e.target.value);
              if (e.target.value) setDescuentoPct("");
            }}
            placeholder="Cupón $"
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
        <label className="block text-[10px]">
          <span className="font-bold text-muted">Desc. % pedido</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={descuentoPct}
            onChange={(e) => {
              setDescuentoPct(e.target.value);
              if (e.target.value) setDescuentoPedido("");
            }}
            placeholder="ej. 10"
            className="mt-0.5 w-full rounded-lg border border-border bg-surface-input px-1.5 py-1 text-xs font-mono"
          />
        </label>
      </div>

      {moneda.toUpperCase() === "USD" && (
        <div
          className={`rounded-lg border px-2 py-1.5 text-[10px] leading-snug ${
            trmNum > 0
              ? "border-emerald-500/40 bg-emerald-500/5 text-ink"
              : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300"
          }`}
        >
          {trmLoading ? (
            <span>Consultando TRM BanRep…</span>
          ) : trmNum > 0 ? (
            <span>
              <strong className="font-mono">1 USD = {trmNum.toLocaleString("es-CO", { maximumFractionDigits: 2 })} COP</strong>
              {trmFuente === "banrep" ? " · BanRep" : trmFuente === "manual" ? " · manual" : ""}
            </span>
          ) : (
            <span>
              Sin TRM: elige fecha y ↻, o escribe la tasa.
            </span>
          )}
        </div>
      )}

      {fleteNum > 0 && lineas.length > 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5 text-[10px] text-ink">
          Flete{" "}
          <strong className="font-mono">
            {fleteNum.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
            {(monedaFlete || moneda).toUpperCase()}
          </strong>
          {necesitaTrm && (monedaFlete || moneda).toUpperCase() !== "COP" ? (
            <>
              {" "}
              → <strong className="font-mono">{fmtCop(fleteTotalCop)}</strong>
            </>
          ) : (
            <>
              {" "}
              = <strong className="font-mono">{fmtCop(fleteTotalCop)}</strong>
            </>
          )}
        </div>
      )}
      {fleteNum === 0 && flete.trim() === "0" && lineas.length > 0 && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-500/5 px-2 py-1.5 text-[10px] text-ink">
          Flete neto <strong className="font-mono">0</strong> — envío cobrado y descontado en el
          recibo (no entra al costo unitario).
        </div>
      )}

      {(descuentoPedidoNum > 0 || descuentoPctNum > 0 || lineas.some((l) => l.descuento > 0)) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-ink">
          Desc. aplicado
          {descuentoPedidoNum > 0 && (
            <strong className="font-mono"> −{descuentoPedidoNum}</strong>
          )}
          {descuentoPctNum > 0 && (
            <strong className="font-mono"> −{descuentoPctNum}%</strong>
          )}
        </div>
      )}

      {(proveedor || numeroPedido) && (
        <p className="text-[10px] text-muted">
          {proveedor ? (
            <>
              Proveedor: <span className="font-semibold text-ink">{proveedor}</span>
            </>
          ) : null}
          {proveedor && numeroPedido ? " · " : null}
          {numeroPedido ? (
            <>
              Pedido: <span className="font-semibold text-ink font-mono">{numeroPedido}</span>
            </>
          ) : null}
        </p>
      )}

      {lineas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface-panel text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={lineas.every((l) => l.seleccionada)}
                    onChange={(e) =>
                      setLineas((prev) => prev.map((l) => ({ ...l, seleccionada: e.target.checked })))
                    }
                  />
                </th>
                <th className="px-2 py-2">Producto / SKU</th>
                <th className="px-2 py-2" title="Cantidad de packs/ítems comprados (xN)">
                  Packs
                </th>
                <th className="px-2 py-2" title="Unidad base del costo: ml, g o un">
                  Ud.
                </th>
                <th className="px-2 py-2" title="Contenido por pack en la unidad base (500ml → 500)">
                  Contenido
                </th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2" title="Precio de un pack en moneda factura">
                  P. pack
                </th>
                <th className="px-2 py-2" title="Descuento de la línea (monto)">
                  Desc. línea
                </th>
                <th className="px-2 py-2" title="P. pack neto × TRM → COP">
                  P. pack COP
                </th>
                <th className="px-2 py-2" title="(P. pack neto COP + flete/ud) ÷ Contenido">
                  Costo / ud COP
                </th>
                <th className="px-2 py-2">Cat.</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, idx) => {
                const ud = etiquetaUnidad(l.unidad);
                const totalUds = Math.round(l.cantidad * Math.max(l.unidades_por_pack, 1) * 1e4) / 1e4;
                return (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={l.seleccionada}
                      onChange={(e) => patchLinea(l.id, { seleccionada: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1.5 min-w-[14rem]">
                    <ProductoSkuAsociar
                      linea={l}
                      onChange={(patch) => patchLinea(l.id, patch)}
                    />
                  </td>
                  <td className="px-2 py-1.5 w-16">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.cantidad}
                      onChange={(e) => patchLinea(l.id, { cantidad: n(e.target.value, 1) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-16">
                    <select
                      value={normalizarUnidadBase(l.unidad) || "un"}
                      onChange={(e) => {
                        const unidad = e.target.value as UnidadBase;
                        const inferred = inferirUnidadYContenido(l.nombre, unidad);
                        patchLinea(l.id, {
                          unidad,
                          unidades_por_pack:
                            l.unidades_por_pack > 1 ? l.unidades_por_pack : inferred.contenido,
                          categoria: unidad === "un" ? l.categoria : "material",
                        });
                      }}
                      className="w-full rounded border border-accent/40 bg-accent/5 px-1 py-1 font-mono font-semibold"
                      title="Unidad base del costo real"
                    >
                      <option value="ml">ml</option>
                      <option value="g">g</option>
                      <option value="un">un</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={l.unidades_por_pack}
                      onChange={(e) =>
                        patchLinea(l.id, { unidades_por_pack: Math.max(0.001, n(e.target.value, 1)) })
                      }
                      className="w-full rounded border border-accent/40 bg-accent/5 px-1.5 py-1 font-mono font-semibold"
                      title={`Contenido por pack en ${ud}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono font-bold text-ink whitespace-nowrap">
                    {totalUds} {ud}
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.precio_unit}
                      onChange={(e) => patchLinea(l.id, { precio_unit: n(e.target.value) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.descuento}
                      onChange={(e) =>
                        patchLinea(l.id, {
                          descuento: Math.min(Math.max(0, n(e.target.value)), l.subtotal || 0),
                        })
                      }
                      className="w-full rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-1 font-mono"
                      title="Descuento de esta línea"
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-ink whitespace-nowrap">
                    {trmNum > 0 || moneda.toUpperCase() === "COP"
                      ? fmtCop(precioPackCop(preciosNetoPack[idx] ?? l.precio_unit, trmNum, moneda))
                      : "—"}
                    <div className="text-[9px] text-muted">
                      {l.descuento > 0 || descuentoPedidoNum > 0 || descuentoPctNum > 0
                        ? "neto tras desc."
                        : moneda.toUpperCase() === "COP"
                          ? "COP"
                          : trmNum > 0
                            ? `× TRM ${trmNum}`
                            : "sin TRM"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      key={`costo-${l.id}-${Number.isFinite(costosRecalc[idx]) ? costosRecalc[idx] : "x"}-${fleteNum}`}
                      type="number"
                      min={0}
                      step="any"
                      value={
                        Number.isFinite(costosRecalc[idx])
                          ? costosRecalc[idx]
                          : (l.costo_unitario_cop ?? "")
                      }
                      onChange={(e) =>
                        patchLinea(l.id, {
                          costo_unitario_cop: e.target.value === "" ? null : n(e.target.value),
                        })
                      }
                      title="Se recalcula al cambiar flete, TRM, cantidades o descuentos"
                      className="w-28 rounded border border-accent/40 bg-accent/5 px-1.5 py-1 font-mono font-semibold"
                    />
                    <div className="text-[9px] text-muted">
                      {fmtCop(
                        Number.isFinite(costosRecalc[idx])
                          ? costosRecalc[idx]
                          : l.costo_unitario_cop,
                      )}
                      /{ud.toLowerCase()}
                      {(landedDetalle[idx]?.fletePorUnidadCop || 0) > 0 ? (
                        <span className="text-accent">
                          {" "}
                          · flete {fmtCop(landedDetalle[idx].fletePorUnidadCop)}/{ud.toLowerCase()}
                        </span>
                      ) : fleteNum > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400"> · flete pendiente TRM</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <select
                      value={l.categoria}
                      onChange={(e) => patchLinea(l.id, { categoria: e.target.value })}
                      className="w-full rounded border border-border bg-surface-input px-1 py-1"
                    >
                      <option value="material">material</option>
                      <option value="empaque">empaque</option>
                      <option value="servicio">servicio</option>
                      <option value="otro">otro</option>
                    </select>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

          </div>
        </Modal>
      )}

      {cuentaCobroId != null && (() => {
        const c = historial.find((h) => h.id === cuentaCobroId);
        if (!c) return null;
        return (
          <CompraExteriorRevisionModal
            compra={c}
            onClose={() => setCuentaCobroId(null)}
            onEditar={() => {
              setCuentaCobroId(null);
              void editarCompra(c.id);
            }}
            onAprobada={(h) => {
              setHistorial((prev) =>
                prev.map((x) => (x.id === h.id ? { ...x, ...h, envio: x.envio } : x)),
              );
              setOkMsg(`Cuenta #${h.id} actualizada.`);
            }}
            onDescargar={(tipo) => {
              void descargarCuentaCobro(c.id, tipo).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : String(e)),
              );
            }}
          />
        );
      })()}

      {envioModal && (
        <Modal
          onClose={() => !envioBusy && setEnvioModal(null)}
          title={envioModal === "crear" ? "Enlazar compras en un envío" : `Editar envío #${envioModal.id}`}
          maxWidthClassName="max-w-lg"
        >
          <div className="space-y-3 p-4">
            <p className="text-[11px] text-muted">
              Varias facturas, un solo paquete. La mercancía conserva la TRM de cada fecha de
              compra. El flete se convierte a COP con la TRM BanRep del día del envío y se
              reparte por porcentaje de paquetes entre las referencias (cantidad de cada
              ítem ÷ total de packs del envío). Así sube el costo unitario de cada referencia.
            </p>
            <label className="block text-[11px] font-semibold text-muted">
              Fecha del envío
              <input
                type="date"
                value={fechaEnvio}
                onChange={(e) => setFechaEnvio(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] font-semibold text-muted">
                Flete
                <input
                  type="text"
                  inputMode="decimal"
                  value={fleteEnvio}
                  onChange={(e) => setFleteEnvio(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 font-mono text-sm text-ink"
                />
              </label>
              <label className="block text-[11px] font-semibold text-muted">
                Moneda flete
                <select
                  value={monedaFleteEnvio}
                  onChange={(e) => setMonedaFleteEnvio(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="COP">COP</option>
                </select>
              </label>
            </div>
            {trmEnvio && monedaFleteEnvio !== "COP" && (
              <p className="text-[11px] text-muted">
                TRM BanRep {fechaEnvio}: {trmEnvio}
                {n(fleteEnvio) > 0
                  ? ` → flete ${fmtCop(n(fleteEnvio) * n(trmEnvio))}`
                  : ""}
              </p>
            )}
            <p className="text-[11px] text-ink">
              Compras:{" "}
              {(envioModal === "crear"
                ? seleccionIds
                : envioModal.compra_ids || []
              )
                .map((id) => `#${id}`)
                .join(", ")}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={envioBusy}
                onClick={() => setEnvioModal(null)}
                className="rounded border border-border px-3 py-1.5 text-[11px] text-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={envioBusy || !fechaEnvio}
                onClick={() => void guardarEnvio()}
                className="rounded bg-accent px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                {envioBusy ? "Guardando…" : envioModal === "crear" ? "Enlazar envío" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </Modal>
      )}


    </div>
  );
}
