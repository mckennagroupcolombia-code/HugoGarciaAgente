import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, resolvePanelApiUrl, ticketsSessionHeaders } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAppStore, type EtiquetasHandoff, type EtiquetasTab, type EtiquetasSolicitudActiva } from "../stores/app";
import {
  esSolicitudEtiqueta,
  esLineaProsaPedidoEtiqueta,
  parseLineasPedidoEtiqueta,
  inferirTipoEtiqueta,
  fmtUnidadesEtiqueta,
  extraerComentarioPedido,
  type SolicitudEtiquetaBasica,
} from "../lib/etiquetasSolicitudes";
import {
  type InventarioConsumible,
  type InventarioPapel,
  type InventarioTinta,
  esInventarioPapel,
  mmAPulgadas,
  totalEtiquetasPapel,
  papelBajoMinimo,
  bodyPapelInventario,
  papelDesdeItem,
  inventarioPapelCompleto,
  normalizarInventarioItems,
  guardarCachePapelInventario,
  eliminarCachePapelInventario,
  PAPEL_VACIO,
} from "../lib/etiquetasInventarioPapel";
import {
  type CmykColor,
  hexToCmyk,
  CMYK_NEGRO,
} from "../lib/cmykColor";
import {
  mmParaTipoEtiqueta,
  TIPOS_ETIQUETA_DEFAULT,
  useTiposEtiqueta,
  formatoMedidasEtiqueta,
  formatoMedidasEtiquetaTitle,
  mmAPulgadasDisplay,
  pulgadasAMm,
} from "../lib/etiquetasTipos";
import { SelectorFormatoEtiqueta, type FormatoEtiquetaValor } from "./etiquetas/SelectorFormatoEtiqueta";
import {
  EtiquetasStudioCatalogo,
  type CatalogoStudioFila,
  type RecursoPngCatalogo,
} from "./etiquetas/EtiquetasStudioCatalogo";
import { EtiquetaMckennaPreview } from "./etiquetas/EtiquetaMckennaPreview";
import { CodigosEanPanel } from "./etiquetas/CodigosEanPanel";
import {
  ETIQUETA_STUDIO_DEFAULT,
  type EtiquetaStudioDatos,
} from "../lib/etiquetasNormativa";
import { studioDatosDesdeCatalogo, presentacionDesdeTipoEtiqueta } from "../lib/etiquetasStudioHelpers";
import { Icon } from "../icons";
import { IllustrationIcon } from "../icons/IllustrationIcon";
import { Banner, Badge, Card, StatTile, Button, IconButton, Modal, Spinner } from "./etiquetas/ui";
import { ProseTextarea } from "./ProseTextarea";
import { EditorPanel } from "./PublicacionesPanel";
import { useGuardarPublicacion } from "../hooks/usePublicaciones";
import PlantillasVisualesPanel from "./plantillas-visuales/PlantillasVisualesPanel";
import { ImpresionEtiquetasHeader } from "./etiquetas/ImpresionEtiquetasHeader";
import { codificarRutaRecursoPng } from "./etiquetas/RecursoPngViewer";
import { resolverUrlImagenCanvas } from "../lib/plantillasVisualesImagen";
import { AjusteOffsetImpresion } from "./etiquetas/AjusteOffsetImpresion";
import { useCodigosEan, type CodigoEan } from "../lib/etiquetasCodigosEan";
import { puedeVerTabEtiquetas, puedeVerEtiquetasAvanzado, esTabEtiquetasSoloCynthia } from "../lib/studioVisualAccess";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PdfItem {
  nombre: string;
  ruta: string;
  ruta_completa: string;
  guardado?: boolean;
  subido_at?: string;
}

interface PdfsResp {
  pdfs: PdfItem[];
  guardados?: PdfItem[];
  total: number;
  carpeta_guardados?: string;
}

interface PrintResult {
  ok: boolean;
  log: string[];
  error?: string;
  solucion?: string;
  codigo?: string;
}

interface ErrorImpresora {
  error: string;
  solucion: string;
  codigo?: string;
}

interface LoteRegistrado {
  lote_numero?: string;
  fecha_vencimiento?: string;
  vigente?: boolean;
  fabricante?: string;
}

const CODIGOS_INSTALAR_IMPRESORA = new Set([
  "no_registrada",
  "deshabilitada",
  "pausada",
  "sin_conexion",
  "sin_usb",
  "ipp_sin_respuesta",
  "smb_sin_respuesta",
  "backend_incorrecto",
  "elpu",
  "cups_inactivo",
  "sudo",
  "preflight",
  "remoto_sin_uri",
]);

const DRIVER_EPSON_WINDOWS_URL =
  "https://epson.com/Support/Printers/Label-Printers/ColorWorks-Series/Epson-ColorWorks-CW-C4000/s/SPT_C31CK03101";

/** Driver Epson CW-C4000 para Windows 10 Pro 64-bit (PC Jenniffer). */
const DRIVER_EPSON_WINDOWS_10_PRO_URL =
  "https://epson.com/Support/Printers/Label-Printers/ColorWorks-Series/Epson-ColorWorks-CW-C4000/s/SPT_C31CK03101?review-filter=Windows+10+64-bit";

const WINDOWS_10_PRO_LABEL = "Windows 10 Pro";
const WINDOWS_10_PRO_HOST_DEFAULT = "192.168.5.116";
const WINDOWS_10_PRO_SHARE = "CW-C4000u";
const SESION_JENNIFFER_LABEL = "Jenniffer";
const UBUNTU_LABEL = "Ubuntu (.deb)";
/** Descarga el .ps1 desde el agente (URL pública: el PC Windows no ve la LAN 192.168.1.8). */
const SCRIPT_WINDOWS_PS1_URL = "/api/etiquetas/impresora/script-windows";
const SCRIPT_WINDOWS_PS1_PUBLIC =
  "https://bot.mckennagroup.co/api/etiquetas/impresora/script-windows";
const SCRIPT_WINDOWS_PS1_ONELINER =
  `powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '${SCRIPT_WINDOWS_PS1_PUBLIC}' -OutFile '$env:TEMP\\configurar_compartir_windows.ps1'; & '$env:TEMP\\configurar_compartir_windows.ps1'"`;
/** Misma preparación (SMB + firewall) pero además instala/activa Tailscale — para PCs
 * en una sede distinta a la del servidor (sin LAN/VPN corporativa entre ambas). */
const SCRIPT_WINDOWS_PS1_ONELINER_TAILSCALE =
  `powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '${SCRIPT_WINDOWS_PS1_PUBLIC}' -OutFile '$env:TEMP\\configurar_compartir_windows.ps1'; & '$env:TEMP\\configurar_compartir_windows.ps1' -Tailscale"`;
const DEB_UBUNTU_URL = "/api/etiquetas/impresora/paquete-ubuntu";
const DEB_UBUNTU_PUBLIC =
  "https://bot.mckennagroup.co/api/etiquetas/impresora/paquete-ubuntu";
const DEB_UBUNTU_ONELINER =
  `curl -fsSL -o /tmp/mckenna-epson-cwc4000u_amd64.deb '${DEB_UBUNTU_PUBLIC}' && sudo dpkg -i /tmp/mckenna-epson-cwc4000u_amd64.deb && sudo apt-get install -f -y`;


interface ImpResp {
  impresora: string;
  estado: string;
  estado_legible?: string;
  cups_codigo?: string;
  trabajos_en_cola?: number;
  impresora_conectada?: boolean;
  comunicacion_usb?: boolean;
  modo_red?: boolean;
  uri_dispositivo?: string;
  remoto?: {
    activo?: boolean;
    modo?: string;
    host?: string;
    share?: string;
    uri?: string;
  };
  niveles_tinta?: NivelesTintaResp;
}

interface DiagCheck {
  nombre: string;
  ok: boolean;
  detalle: string;
}

interface DiagResp {
  checks: DiagCheck[];
  todo_ok: boolean;
  usb_detectado: string | null;
  remoto?: ImpResp["remoto"];
  modo_red?: boolean;
}

interface RemotoResp {
  ok: boolean;
  uri?: string;
  log?: string[];
  mensaje?: string;
  error?: string;
  detalle?: string;
  solucion?: string;
  remoto?: ImpResp["remoto"] & {
    sistema_operativo?: string;
    sesion?: string;
  };
  modo_red?: boolean;
  uri_actual?: string;
}

interface InstalResp {
  ok: boolean;
  log: string[];
  errores: string[];
}

interface DiagRedEvento {
  ok: boolean | null;
  mensaje: string;
  detalle?: string;
  host?: string;
  protocolo?: string;
  verificado_at: string;
}

interface DiagRedResp {
  ok: boolean | null;
  actual: DiagRedEvento;
  historial: DiagRedEvento[];
  remoto?: ImpResp["remoto"];
}

interface TailscalePeer {
  hostname: string;
  ip: string;
  os: string;
  online: boolean;
}

interface TailscalePeersResp {
  ok: boolean;
  peers: TailscalePeer[];
  error?: string;
}

interface PreviewResp {
  imagen: string;
  mime: string;
  error?: string;
}

interface DiscoItem {
  nombre: string;
  ruta: string;
  icono?: "home" | "disco" | "usb" | "sistema";
}

interface NavResp {
  ruta_actual: string;
  padre: string | null;
  modo_raiz?: boolean;
  discos?: DiscoItem[];
  carpetas: string[];
  pdfs: { nombre: string; ruta_completa: string; tamano_kb: number }[];
}

function iconoDisco(icono?: DiscoItem["icono"]): string {
  switch (icono) {
    case "home": return "🏠";
    case "usb": return "💾";
    case "sistema": return "🖥️";
    default: return "💿";
  }
}

type EstadoMeliConfig = "" | "omitir" | "por_publicar";
type FiltroConfigProductos = "todos" | "con_meli" | "por_publicar" | "omitidos" | "pendientes";

interface ComboSiigo {
  code: string;
  name: string;
  precio_lista: number;
  meli_id?: string;
  estado_meli_config?: EstadoMeliConfig;
}

interface SpanPDF {
  id: string;
  pagina: number;
  texto_original: string;
  texto_editado: string;
  origin_x: number;
  origin_y: number;
  bbox: [number, number, number, number];
  font_name: string;
  font_file: string | null;
  font_size: number;
  color_hex: string;
  color_int: number;
  flags: number;
}

type MontserratVariant = "light" | "regular" | "medium" | "semibold" | "bold" | "extrabold" | "black";

const VARIANTES_MONTSERRAT: { id: MontserratVariant; label: string; weight: number }[] = [
  { id: "light", label: "Light", weight: 300 },
  { id: "regular", label: "Regular", weight: 400 },
  { id: "medium", label: "Medium", weight: 500 },
  { id: "semibold", label: "SemiBold", weight: 600 },
  { id: "bold", label: "Bold", weight: 700 },
  { id: "extrabold", label: "ExtraBold", weight: 800 },
  { id: "black", label: "Black", weight: 900 },
];

function varianteMontserratCampo(c: CampoTexto): MontserratVariant {
  if (c.font_variant) return c.font_variant;
  return c.bold ? "bold" : "light";
}

function pesoMontserratVariante(v: MontserratVariant): number {
  return VARIANTES_MONTSERRAT.find((x) => x.id === v)?.weight ?? 400;
}

interface CampoTexto {
  id: string;
  etiqueta: string;
  texto: string;
  x_pct: number;
  y_pct: number;
  font_size: number;
  /** Variante Montserrat (preferida sobre bold legacy) */
  font_variant?: MontserratVariant;
  bold: boolean;
  align: "left" | "center" | "right" | "justify";
  /** Alerta ortográfica del navegador (español) */
  ortografia?: boolean;
  fondo_blanco: boolean;
  /** Relleno del texto */
  color: string;
  color_cmyk?: CmykColor;
  /** Trazo/contorno del texto */
  color_trazo?: string;
  color_trazo_cmyk?: CmykColor;
  grosor_trazo?: number;
  /** Caja de texto redimensionable (% del lienzo) */
  ancho_caja_pct?: number;
  alto_caja_pct?: number;
}

interface RectanguloPlantilla {
  id: string;
  x_pct: number;
  y_pct: number;
  ancho_pct: number;
  alto_pct: number;
  relleno: boolean;
  color_relleno: string;
  color_relleno_cmyk?: CmykColor;
  color_trazo: string;
  color_trazo_cmyk?: CmykColor;
  grosor_trazo: number;
}

interface LineaPlantilla {
  id: string;
  x1_pct: number;
  y1_pct: number;
  x2_pct: number;
  y2_pct: number;
  grosor: number;
  color: string;
  color_cmyk?: CmykColor;
}

interface RecursoPng {
  id: string;
  nombre: string;
  ruta: string;
  ruta_completa: string;
  subido_at?: string;
  bytes?: number;
  thumb_b64?: string | null;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
}

interface ImagenPlantilla {
  id: string;
  recurso_id: string;
  nombre: string;
  ruta_completa: string;
  x_pct: number;
  y_pct: number;
  ancho_pct: number;
  alto_pct?: number;
}

type OrientacionPlantilla = "horizontal" | "vertical";

interface PlantillaEtiqueta {
  id: string;
  nombre: string;
  tipo_etiqueta: string;
  ancho_mm?: number;
  alto_mm?: number;
  orientacion?: OrientacionPlantilla;
  campos_texto: CampoTexto[];
  lineas: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  updated_at?: string;
}

type HerramientaPlantilla = "seleccionar" | "texto" | "linea" | "rectangulo";
type ModoCreacionTexto = "clic" | "caja";
type TipoElementoPlantilla = "texto" | "linea" | "imagen" | "rectangulo";
type ItemPlantillaRef = { tipo: TipoElementoPlantilla; id: string };
type SeleccionPlantilla = ItemPlantillaRef[];

interface BoundsPct {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface OrigenesGrupoArrastre {
  textos: Record<string, { x_pct: number; y_pct: number }>;
  imagenes: Record<string, { x_pct: number; y_pct: number }>;
  rectangulos: Record<string, { x_pct: number; y_pct: number }>;
  lineas: Record<string, { x1_pct: number; y1_pct: number; x2_pct: number; y2_pct: number }>;
}

type AlineacionPlantilla = "izq" | "centro-h" | "der" | "arriba" | "medio-v" | "abajo";

function estaEnSeleccion(sel: SeleccionPlantilla, item: ItemPlantillaRef): boolean {
  return sel.some((s) => s.tipo === item.tipo && s.id === item.id);
}

function toggleEnSeleccion(sel: SeleccionPlantilla, item: ItemPlantillaRef): SeleccionPlantilla {
  if (estaEnSeleccion(sel, item)) {
    return sel.filter((s) => !(s.tipo === item.tipo && s.id === item.id));
  }
  return [...sel, item];
}

function agregarASeleccion(sel: SeleccionPlantilla, item: ItemPlantillaRef): SeleccionPlantilla {
  if (estaEnSeleccion(sel, item)) return sel;
  return [...sel, item];
}

function seleccionarSolo(item: ItemPlantillaRef): SeleccionPlantilla {
  return [item];
}

function seleccionDesdeClick(e: React.MouseEvent | MouseEvent, sel: SeleccionPlantilla, item: ItemPlantillaRef): SeleccionPlantilla {
  if (e.ctrlKey || e.metaKey) return toggleEnSeleccion(sel, item);
  if (e.shiftKey) return agregarASeleccion(sel, item);
  if (estaEnSeleccion(sel, item) && sel.length > 1) return sel;
  return seleccionarSolo(item);
}

function seleccionUnica(sel: SeleccionPlantilla): ItemPlantillaRef | null {
  return sel.length === 1 ? sel[0] : null;
}

function altoImagenPct(im: ImagenPlantilla): number {
  return im.alto_pct ?? im.ancho_pct * 0.75;
}

function boundsTexto(c: CampoTexto): BoundsPct {
  const w = c.ancho_caja_pct ?? CAJA_TEXTO_CLIC_ANCHO_PCT;
  const h = c.alto_caja_pct ?? CAJA_TEXTO_CLIC_ALTO_PCT;
  return {
    left: c.x_pct,
    top: c.y_pct,
    right: c.x_pct + w,
    bottom: c.y_pct + h,
    width: w,
    height: h,
    centerX: c.x_pct + w / 2,
    centerY: c.y_pct + h / 2,
  };
}

function boundsImagen(im: ImagenPlantilla): BoundsPct {
  const w = im.ancho_pct;
  const h = altoImagenPct(im);
  return {
    left: im.x_pct,
    top: im.y_pct,
    right: im.x_pct + w,
    bottom: im.y_pct + h,
    width: w,
    height: h,
    centerX: im.x_pct + w / 2,
    centerY: im.y_pct + h / 2,
  };
}

function boundsRect(rc: RectanguloPlantilla): BoundsPct {
  return {
    left: rc.x_pct,
    top: rc.y_pct,
    right: rc.x_pct + rc.ancho_pct,
    bottom: rc.y_pct + rc.alto_pct,
    width: rc.ancho_pct,
    height: rc.alto_pct,
    centerX: rc.x_pct + rc.ancho_pct / 2,
    centerY: rc.y_pct + rc.alto_pct / 2,
  };
}

function boundsLinea(ln: LineaPlantilla): BoundsPct {
  const left = Math.min(ln.x1_pct, ln.x2_pct);
  const top = Math.min(ln.y1_pct, ln.y2_pct);
  const right = Math.max(ln.x1_pct, ln.x2_pct);
  const bottom = Math.max(ln.y1_pct, ln.y2_pct);
  const w = Math.max(0.5, right - left);
  const h = Math.max(0.5, bottom - top);
  return { left, top, right, bottom, width: w, height: h, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

function boundsElemento(
  item: ItemPlantillaRef,
  campos: CampoTexto[],
  lineas: LineaPlantilla[],
  imagenes: ImagenPlantilla[],
  rectangulos: RectanguloPlantilla[],
): BoundsPct | null {
  if (item.tipo === "texto") {
    const c = campos.find((x) => x.id === item.id);
    return c ? boundsTexto(c) : null;
  }
  if (item.tipo === "linea") {
    const ln = lineas.find((x) => x.id === item.id);
    return ln ? boundsLinea(ln) : null;
  }
  if (item.tipo === "imagen") {
    const im = imagenes.find((x) => x.id === item.id);
    return im ? boundsImagen(im) : null;
  }
  const rc = rectangulos.find((x) => x.id === item.id);
  return rc ? boundsRect(rc) : null;
}

function unionBounds(bounds: BoundsPct[]): BoundsPct | null {
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((b) => b.left));
  const top = Math.min(...bounds.map((b) => b.top));
  const right = Math.max(...bounds.map((b) => b.right));
  const bottom = Math.max(...bounds.map((b) => b.bottom));
  const width = right - left;
  const height = bottom - top;
  return { left, top, right, bottom, width, height, centerX: left + width / 2, centerY: top + height / 2 };
}

function intersectaBounds(a: BoundsPct, b: BoundsPct): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function capturarOrigenesGrupo(
  items: ItemPlantillaRef[],
  campos: CampoTexto[],
  lineas: LineaPlantilla[],
  imagenes: ImagenPlantilla[],
  rectangulos: RectanguloPlantilla[],
): OrigenesGrupoArrastre {
  const orig: OrigenesGrupoArrastre = { textos: {}, imagenes: {}, rectangulos: {}, lineas: {} };
  for (const item of items) {
    if (item.tipo === "texto") {
      const c = campos.find((x) => x.id === item.id);
      if (c) orig.textos[item.id] = { x_pct: c.x_pct, y_pct: c.y_pct };
    } else if (item.tipo === "imagen") {
      const im = imagenes.find((x) => x.id === item.id);
      if (im) orig.imagenes[item.id] = { x_pct: im.x_pct, y_pct: im.y_pct };
    } else if (item.tipo === "rectangulo") {
      const rc = rectangulos.find((x) => x.id === item.id);
      if (rc) orig.rectangulos[item.id] = { x_pct: rc.x_pct, y_pct: rc.y_pct };
    } else {
      const ln = lineas.find((x) => x.id === item.id);
      if (ln) orig.lineas[item.id] = { x1_pct: ln.x1_pct, y1_pct: ln.y1_pct, x2_pct: ln.x2_pct, y2_pct: ln.y2_pct };
    }
  }
  return orig;
}

function alinearSeleccionPlantilla(
  seleccion: ItemPlantillaRef[],
  modo: AlineacionPlantilla,
  campos: CampoTexto[],
  lineas: LineaPlantilla[],
  imagenes: ImagenPlantilla[],
  rectangulos: RectanguloPlantilla[],
): {
  campos: CampoTexto[];
  lineas: LineaPlantilla[];
  imagenes: ImagenPlantilla[];
  rectangulos: RectanguloPlantilla[];
} {
  const boundsSel = seleccion
    .map((item) => boundsElemento(item, campos, lineas, imagenes, rectangulos))
    .filter((b): b is BoundsPct => !!b);
  const grupo = unionBounds(boundsSel);
  if (!grupo || seleccion.length < 2) {
    return { campos, lineas, imagenes, rectangulos };
  }

  let camposOut = campos;
  let lineasOut = lineas;
  let imagenesOut = imagenes;
  let rectangulosOut = rectangulos;

  for (const item of seleccion) {
    const b = boundsElemento(item, campos, lineas, imagenes, rectangulos);
    if (!b) continue;
    let dx = 0;
    let dy = 0;
    if (modo === "izq") dx = grupo.left - b.left;
    else if (modo === "der") dx = grupo.right - b.right;
    else if (modo === "centro-h") dx = grupo.centerX - b.centerX;
    else if (modo === "arriba") dy = grupo.top - b.top;
    else if (modo === "abajo") dy = grupo.bottom - b.bottom;
    else if (modo === "medio-v") dy = grupo.centerY - b.centerY;

    if (item.tipo === "texto") {
      camposOut = camposOut.map((c) =>
        c.id === item.id
          ? { ...c, x_pct: clampLotePct(c.x_pct + dx), y_pct: clampLotePct(c.y_pct + dy) }
          : c,
      );
    } else if (item.tipo === "imagen") {
      imagenesOut = imagenesOut.map((im) =>
        im.id === item.id
          ? { ...im, x_pct: clampLotePct(im.x_pct + dx), y_pct: clampLotePct(im.y_pct + dy) }
          : im,
      );
    } else if (item.tipo === "rectangulo") {
      rectangulosOut = rectangulosOut.map((rc) =>
        rc.id === item.id
          ? { ...rc, x_pct: clampLotePct(rc.x_pct + dx), y_pct: clampLotePct(rc.y_pct + dy) }
          : rc,
      );
    } else {
      lineasOut = lineasOut.map((ln) =>
        ln.id === item.id
          ? {
              ...ln,
              x1_pct: clampLotePct(ln.x1_pct + dx),
              y1_pct: clampLotePct(ln.y1_pct + dy),
              x2_pct: clampLotePct(ln.x2_pct + dx),
              y2_pct: clampLotePct(ln.y2_pct + dy),
            }
          : ln,
      );
    }
  }

  return { campos: camposOut, lineas: lineasOut, imagenes: imagenesOut, rectangulos: rectangulosOut };
}

function elementosEnMarquee(
  box: BoundsPct,
  campos: CampoTexto[],
  lineas: LineaPlantilla[],
  imagenes: ImagenPlantilla[],
  rectangulos: RectanguloPlantilla[],
): ItemPlantillaRef[] {
  const items: ItemPlantillaRef[] = [];
  for (const c of campos) {
    if (intersectaBounds(boundsTexto(c), box)) items.push({ tipo: "texto", id: c.id });
  }
  for (const ln of lineas) {
    if (intersectaBounds(boundsLinea(ln), box)) items.push({ tipo: "linea", id: ln.id });
  }
  for (const im of imagenes) {
    if (intersectaBounds(boundsImagen(im), box)) items.push({ tipo: "imagen", id: im.id });
  }
  for (const rc of rectangulos) {
    if (intersectaBounds(boundsRect(rc), box)) items.push({ tipo: "rectangulo", id: rc.id });
  }
  return items;
}

interface DatosEtiqueta {
  siigo_code?: string;
  siigo_name?: string;
  nombre_etiqueta?: string;
  presentacion?: string;
  pdf_ruta?: string;
  pdf_nombre?: string;
  lote_defecto?: string;
  vencimiento_defecto?: string;
  tipo_etiqueta?: string;
  ancho_mm?: number;
  alto_mm?: number;
  forma?: string;
  calidad?: string;
  rotacion?: string;
  lote_pos?: string;
  lote_font?: number;
  lote_x_pct?: number;
  lote_y_pct?: number;
  /** Posición independiente del vencimiento — a veces se sella a mano aparte del lote. */
  venc_x_pct?: number;
  venc_y_pct?: number;
  campos_texto?: CampoTexto[];
  lineas?: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  updated_at?: string;
}

interface ImpresionEtiquetaPayload {
  producto: string;
  ancho_mm?: number;
  alto_mm?: number;
  forma: string;
  calidad: string;
  rotacion: string;
  cantidad: number;
  offset_v: number;
  offset_h: number;
  ruta_pdf?: string;
  studio_datos?: EtiquetaStudioDatos;
  campos_texto?: CampoTexto[];
  lineas?: LineaPlantilla[];
  imagenes?: ImagenPlantilla[];
  rectangulos?: RectanguloPlantilla[];
  lote?: string;
  vencimiento?: string;
  lote_font: number;
  lote_x_pct: number;
  lote_y_pct: number;
  venc_x_pct?: number;
  venc_y_pct?: number;
}

function payloadDesdeFormularioEtiqueta(
  form: DatosEtiqueta,
  cantidad = 1,
  offsetV = 0,
  offsetH = 0,
): ImpresionEtiquetaPayload | null {
  if (!form.pdf_ruta || !form.tipo_etiqueta) return null;
  const [anchoFb, altoFb] = mmParaTipoEtiqueta(form.tipo_etiqueta, TIPOS_ETIQUETA_DEFAULT);
  return {
    producto: form.tipo_etiqueta,
    ancho_mm: form.ancho_mm ?? anchoFb,
    alto_mm: form.alto_mm ?? altoFb,
    forma: form.forma ?? "Diecut_Gap",
    calidad: form.calidad ?? "Normal",
    rotacion: rotacionValida(form.rotacion),
    cantidad,
    offset_v: offsetV,
    offset_h: offsetH,
    ruta_pdf: form.pdf_ruta,
    campos_texto: form.campos_texto?.length ? form.campos_texto : undefined,
    lineas: form.lineas?.length ? form.lineas : undefined,
    imagenes: form.imagenes?.length ? form.imagenes : undefined,
    rectangulos: form.rectangulos?.length ? form.rectangulos : undefined,
    lote: loteParaEtiqueta(form.lote_defecto),
    vencimiento: expParaEtiqueta(form.vencimiento_defecto),
    lote_font: form.lote_font ?? 7,
    lote_x_pct: form.lote_x_pct ?? 5,
    lote_y_pct: form.lote_y_pct ?? 88,
    venc_x_pct: form.venc_x_pct ?? form.lote_x_pct,
    venc_y_pct: form.venc_y_pct,
  };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ETIQUETAS_LISTA = [
  "30 mL", "5 mL", "125 g", "250 g", "1 Lt",
  "100 g", "Lactato", "Circular", "Circular 50", "Circle 50", "CIRCLE", "Circular 70", "5 g", "54mm",
];

/** Ancho × alto mm (misma tabla que Flask _ETIQUETAS). */
const ETIQUETAS_MM: Record<string, [number, number]> = {
  "30 mL": [102, 38], "5 mL": [66, 22], "125 g": [70, 70],
  "250 g": [76, 66], "1 Lt": [108, 76],
  "100 g": [69, 51], Lactato: [38, 140], Circular: [55, 55],
  "Circular 50": [50, 50], "Circle 50": [50, 50], CIRCLE: [53.9, 53.9], "Circular 70": [70, 70], "5 g": [50, 42], "54mm": [54, 58],
};

const TAMANO_TEXTO_PT_MIN = 3;
const TAMANO_TEXTO_PT_MAX = 40;
/** Caja por defecto al crear texto con un clic (% del lienzo) */
const CAJA_TEXTO_CLIC_ANCHO_PCT = 22;
const CAJA_TEXTO_CLIC_ALTO_PCT = 6;

function clampTamanoTextoPt(n: number): number {
  return Math.max(TAMANO_TEXTO_PT_MIN, Math.min(TAMANO_TEXTO_PT_MAX, Math.round(n)));
}

const GROSOR_LINEA_MIN = 0.1;
const GROSOR_LINEA_MAX = 20;

function clampGrosorLinea(n: number): number {
  return Math.max(GROSOR_LINEA_MIN, Math.min(GROSOR_LINEA_MAX, Math.round(n * 10) / 10));
}

function idPlantilla() {
  return Math.random().toString(36).slice(2, 11);
}

function nuevaImagenPlantilla(recurso: RecursoPng): ImagenPlantilla {
  return {
    id: idPlantilla(),
    recurso_id: recurso.id,
    nombre: recurso.nombre,
    ruta_completa: recurso.ruta_completa,
    x_pct: 35,
    y_pct: 35,
    ancho_pct: 28,
    alto_pct: 22,
  };
}

function plantillaVacia(nombre = "Nueva plantilla"): PlantillaEtiqueta {
  return {
    id: idPlantilla(),
    nombre,
    tipo_etiqueta: ETIQUETAS_LISTA[0],
    orientacion: "horizontal",
    campos_texto: [],
    lineas: [],
    imagenes: [],
    rectangulos: [],
  };
}

function nuevoRectangulo(x = 25, y = 25, w = 35, h = 22): RectanguloPlantilla {
  return {
    id: idPlantilla(),
    x_pct: x,
    y_pct: y,
    ancho_pct: w,
    alto_pct: h,
    relleno: true,
    color_relleno: "#ffffff",
    color_relleno_cmyk: { c: 0, m: 0, y: 0, k: 0 },
    color_trazo: "#000000",
    color_trazo_cmyk: CMYK_NEGRO,
    grosor_trazo: 1.2,
  };
}

function rectNormalizado(x1: number, y1: number, x2: number, y2: number, cuadrado: boolean) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (cuadrado) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -s : s;
    dy = dy < 0 ? -s : s;
  }
  const x = clampLotePct(dx >= 0 ? x1 : x1 + dx);
  const y = clampLotePct(dy >= 0 ? y1 : y1 + dy);
  const w = clampLotePct(Math.abs(dx));
  const h = clampLotePct(Math.abs(dy));
  return { x_pct: x, y_pct: y, ancho_pct: Math.max(1, w), alto_pct: Math.max(1, h) };
}

function orientacionPlantilla(p: PlantillaEtiqueta): OrientacionPlantilla {
  return p.orientacion === "vertical" ? "vertical" : "horizontal";
}

function dimensioensPlantillaMm(
  tipo: string,
  orientacion: OrientacionPlantilla,
  anchoOverride?: number,
  altoOverride?: number,
): [number, number] {
  const base: [number, number] = anchoOverride && altoOverride
    ? [anchoOverride, altoOverride]
    : (ETIQUETAS_MM[tipo] ?? [76, 66]);
  if (orientacion === "vertical") return [base[1], base[0]];
  return base;
}

function rotarPctCW(x: number, y: number) {
  return { x: clampLotePct(y), y: clampLotePct(100 - x) };
}

function rotarPctCCW(x: number, y: number) {
  return { x: clampLotePct(100 - y), y: clampLotePct(x) };
}

function rotarPlantillaContenido(
  p: PlantillaEtiqueta,
  sentido: "cw" | "ccw",
): Pick<PlantillaEtiqueta, "campos_texto" | "lineas" | "imagenes" | "rectangulos"> {
  const rot = sentido === "cw" ? rotarPctCW : rotarPctCCW;
  return {
    campos_texto: p.campos_texto.map((c) => {
      const { x, y } = rot(c.x_pct, c.y_pct);
      return { ...c, x_pct: x, y_pct: y };
    }),
    lineas: p.lineas.map((ln) => {
      const a = rot(ln.x1_pct, ln.y1_pct);
      const b = rot(ln.x2_pct, ln.y2_pct);
      return { ...ln, x1_pct: a.x, y1_pct: a.y, x2_pct: b.x, y2_pct: b.y };
    }),
    imagenes: (p.imagenes ?? []).map((im) => {
      const { x, y } = rot(im.x_pct, im.y_pct);
      return { ...im, x_pct: x, y_pct: y };
    }),
    rectangulos: (p.rectangulos ?? []).map((rc) => {
      const { x, y } = rot(rc.x_pct, rc.y_pct);
      return { ...rc, x_pct: x, y_pct: y };
    }),
  };
}

function rotacionDesdePlantilla(p: PlantillaEtiqueta): string {
  if (orientacionPlantilla(p) === "vertical") return "90";
  return rotacionDefaultEtiqueta(p.tipo_etiqueta);
}

function snapLineaRecta(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx >= dy) return { x2, y2: y1 };
  return { x2: x1, y2 };
}

type ArrastrePlantilla =
  | { tipo: "texto"; id: string; ox: number; oy: number }
  | { tipo: "imagen"; id: string; ox: number; oy: number }
  | { tipo: "rectangulo"; id: string; ox: number; oy: number }
  | {
      tipo: "linea";
      id: string;
      startX: number;
      startY: number;
      orig: { x1: number; y1: number; x2: number; y2: number };
    }
  | { tipo: "grupo"; startX: number; startY: number; orig: OrigenesGrupoArrastre };

type AsaRedimensionId = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

type RedimensionPlantilla =
  | {
      tipo: "rectangulo" | "imagen" | "texto";
      id: string;
      asa: AsaRedimensionId;
      orig: { x: number; y: number; w: number; h: number };
    }
  | {
      tipo: "linea";
      id: string;
      punto: "inicio" | "fin";
      orig: { x1: number; y1: number; x2: number; y2: number };
    };

const ASA_VIS_PX = 4;
const ASA_HIT_PX = 10;
const MARCO_SELECCION_CSS = "1px solid rgba(1, 109, 130, 0.82)";

const ASAS_REDIMENSION: { id: AsaRedimensionId; cursor: string }[] = [
  { id: "nw", cursor: "nw-resize" },
  { id: "ne", cursor: "ne-resize" },
  { id: "sw", cursor: "sw-resize" },
  { id: "se", cursor: "se-resize" },
];

const ASAS_LATERALES: { id: AsaRedimensionId; cursor: string }[] = [
  { id: "n", cursor: "n-resize" },
  { id: "s", cursor: "s-resize" },
  { id: "e", cursor: "e-resize" },
  { id: "w", cursor: "w-resize" },
];

function estiloAsaEsquina(id: AsaRedimensionId): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    width: ASA_HIT_PX,
    height: ASA_HIT_PX,
    minWidth: ASA_HIT_PX,
    minHeight: ASA_HIT_PX,
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    transform: "translate(-50%, -50%)",
  };
  switch (id) {
    case "nw":
      return { ...base, left: 0, top: 0 };
    case "ne":
      return { ...base, left: "100%", top: 0 };
    case "sw":
      return { ...base, left: 0, top: "100%" };
    case "se":
      return { ...base, left: "100%", top: "100%" };
    default:
      return base;
  }
}

function estiloAsaLado(id: AsaRedimensionId): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    width: ASA_HIT_PX,
    height: ASA_HIT_PX,
    minWidth: ASA_HIT_PX,
    minHeight: ASA_HIT_PX,
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    transform: "translate(-50%, -50%)",
  };
  switch (id) {
    case "n":
      return { ...base, left: "50%", top: 0 };
    case "s":
      return { ...base, left: "50%", top: "100%" };
    case "e":
      return { ...base, left: "100%", top: "50%" };
    case "w":
      return { ...base, left: 0, top: "50%" };
    default:
      return base;
  }
}

function estiloNodoVisualAsa(id: AsaRedimensionId): CSSProperties {
  const esLado = id === "n" || id === "s" || id === "e" || id === "w";
  if (esLado) {
    if (id === "n" || id === "s") return { width: 8, height: 5 };
    return { width: 5, height: 8 };
  }
  return { width: ASA_VIS_PX, height: ASA_VIS_PX };
}

function estiloAsaRedimension(id: AsaRedimensionId): CSSProperties {
  if (id === "n" || id === "s" || id === "e" || id === "w") return estiloAsaLado(id);
  return estiloAsaEsquina(id);
}

function calcularCajaRedimension(
  orig: { x: number; y: number; w: number; h: number },
  asa: AsaRedimensionId,
  p: { x: number; y: number },
  lockRatio: boolean,
) {
  const x2 = orig.x + orig.w;
  const y2 = orig.y + orig.h;
  let x = orig.x;
  let y = orig.y;
  let w = orig.w;
  let h = orig.h;

  if (asa.includes("e")) w = p.x - orig.x;
  if (asa.includes("w")) { x = p.x; w = x2 - p.x; }
  if (asa.includes("s")) h = p.y - orig.y;
  if (asa.includes("n")) { y = p.y; h = y2 - p.y; }

  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }

  w = Math.max(2, w);
  h = Math.max(2, h);
  x = clampLotePct(x);
  y = clampLotePct(y);
  w = clampLotePct(w);
  h = clampLotePct(h);

  if (lockRatio && orig.w > 0 && orig.h > 0) {
    const ratio = orig.w / orig.h;
    if (asa === "e" || asa === "w") h = w / ratio;
    else if (asa === "n" || asa === "s") w = h * ratio;
    else if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    w = Math.max(2, clampLotePct(w));
    h = Math.max(2, clampLotePct(h));
    if (asa.includes("w")) x = clampLotePct(x2 - w);
    if (asa.includes("n")) y = clampLotePct(y2 - h);
  }

  return { x, y, w, h };
}

function SeparadorToolbar() {
  return <div className="mx-1.5 my-0.5 border-t border-border/80" />;
}

function BarraIconos({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-px p-1">{children}</div>;
}

const COLOR_SIN = "transparent";
const CMYK_TRANSPARENTE: CmykColor = { c: 0, m: 0, y: 0, k: 0 };

interface ColorEtiquetaGuardado {
  id: string;
  hex: string;
  cmyk?: CmykColor;
  guardado_at?: string;
}

function normalizarHexColor(hex: string): string | null {
  let h = hex.trim().toLowerCase();
  if (!h) return null;
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-f]{6}$/.test(h)) return h;
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return null;
}

function esSinColor(color?: string): boolean {
  if (!color) return true;
  const s = color.trim().toLowerCase();
  return s === "transparent" || s === "none";
}

function SelectorColorCompact({
  label,
  color,
  onChange,
  allowSinColor = true,
  onGuardarColor,
  guardandoColor = false,
  onActivar,
}: {
  label: string;
  color: string;
  onChange: (hex: string, cmyk: CmykColor) => void;
  allowSinColor?: boolean;
  onGuardarColor?: (hex: string, cmyk: CmykColor) => void;
  guardandoColor?: boolean;
  onActivar?: () => void;
}) {
  const sinColor = esSinColor(color);
  const colorInput = sinColor ? "#000000" : color;

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {allowSinColor && (
        <button
          type="button"
          onClick={() =>
            onChange(
              sinColor ? "#000000" : COLOR_SIN,
              sinColor ? hexToCmyk("#000000") : CMYK_TRANSPARENTE,
            )
          }
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold transition ${
            sinColor
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-muted hover:border-accent hover:text-accent"
          }`}
        >
          Sin color
        </button>
      )}
      {!sinColor ? (
        <>
          <input
            type="color"
            value={colorInput}
            onFocus={onActivar}
            onClick={onActivar}
            onChange={(e) => onChange(e.target.value, hexToCmyk(e.target.value))}
            className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          {onGuardarColor && (
            <button
              type="button"
              title="Guardar color en paleta"
              disabled={guardandoColor}
              onClick={() => onGuardarColor(colorInput, hexToCmyk(colorInput))}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              ★
            </button>
          )}
          <span className="truncate font-mono text-[9px] text-muted">{color}</span>
        </>
      ) : (
        <span className="text-[9px] italic text-muted">Transparente</span>
      )}
    </div>
  );
}

function PaletaColoresGuardados({
  colores,
  colorActivo,
  onElegir,
  onEliminar,
  cargando,
}: {
  colores: ColorEtiquetaGuardado[];
  colorActivo?: string;
  onElegir: (color: ColorEtiquetaGuardado) => void;
  onEliminar: (id: string) => void;
  cargando?: boolean;
}) {
  const activo = colorActivo ? normalizarHexColor(colorActivo) : null;

  return (
    <div className="space-y-1.5 border-b border-border pb-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Colores guardados</p>
      {cargando ? (
        <p className="text-[10px] text-muted">Cargando…</p>
      ) : colores.length === 0 ? (
        <p className="text-[10px] leading-snug text-muted">
          Pulsa ★ junto a un color para guardarlo y reutilizarlo.
        </p>
      ) : (
        <div className="grid grid-cols-6 gap-1">
          {colores.map((c) => (
            <button
              key={c.id}
              type="button"
              title={`${c.hex} · clic derecho quitar`}
              onClick={() => onElegir(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEliminar(c.id);
              }}
              className={`relative aspect-square rounded border transition hover:scale-105 ${
                activo === c.hex ? "border-accent ring-2 ring-accent/40" : "border-border"
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SliderCompacto({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px]">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-7 shrink-0 text-right font-mono text-[9px]">{value.toFixed(1)}</span>
    </label>
  );
}

function PanelLateralApariencia({
  campo,
  linea,
  rect,
  multiseleccion = 0,
  onPatchCampo,
  onPatchLinea,
  onPatchRect,
}: {
  campo?: CampoTexto;
  linea?: LineaPlantilla;
  rect?: RectanguloPlantilla;
  multiseleccion?: number;
  onPatchCampo: (patch: Partial<CampoTexto>) => void;
  onPatchLinea: (patch: Partial<LineaPlantilla>) => void;
  onPatchRect: (patch: Partial<RectanguloPlantilla>) => void;
}) {
  const qc = useQueryClient();
  const haySeleccion = !!(campo || linea || rect);
  const [destinoColor, setDestinoColor] = useState<"texto" | "borde" | "linea" | "relleno" | "rect-borde">("texto");

  useEffect(() => {
    if (campo) setDestinoColor("texto");
    else if (linea) setDestinoColor("linea");
    else if (rect) setDestinoColor("relleno");
  }, [campo?.id, linea?.id, rect?.id]);

  const { data: coloresData, isLoading: cargandoColores } = useQuery({
    queryKey: ["etiquetas-colores-guardados"],
    queryFn: () => api.get<{ colores: ColorEtiquetaGuardado[] }>("/api/etiquetas/colores"),
  });
  const coloresGuardados = coloresData?.colores ?? [];

  const guardarColorMut = useMutation({
    mutationFn: (payload: { hex: string; cmyk: CmykColor }) =>
      api.post<ColorEtiquetaGuardado & { ok: boolean }>("/api/etiquetas/colores", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["etiquetas-colores-guardados"] }),
  });

  const eliminarColorMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/etiquetas/colores/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["etiquetas-colores-guardados"] }),
  });

  function guardarEnPaleta(hex: string, cmyk: CmykColor) {
    const norm = normalizarHexColor(hex);
    if (!norm || esSinColor(norm)) return;
    guardarColorMut.mutate({ hex: norm, cmyk });
  }

  function aplicarColorGuardado(color: ColorEtiquetaGuardado) {
    if (multiseleccion > 1 || !haySeleccion) return;
    const cmyk = color.cmyk ?? hexToCmyk(color.hex);
    if (campo) {
      if (destinoColor === "borde") {
        onPatchCampo({ color_trazo: color.hex, color_trazo_cmyk: cmyk, grosor_trazo: Math.max(campo.grosor_trazo ?? 0, 0.2) });
      } else {
        onPatchCampo({ color: color.hex, color_cmyk: cmyk });
      }
      return;
    }
    if (linea) {
      onPatchLinea({ color: color.hex, color_cmyk: cmyk });
      return;
    }
    if (rect) {
      if (destinoColor === "rect-borde") {
        onPatchRect({ color_trazo: color.hex, color_trazo_cmyk: cmyk, grosor_trazo: Math.max(rect.grosor_trazo ?? 0, 0.2) });
      } else {
        onPatchRect({ relleno: true, color_relleno: color.hex, color_relleno_cmyk: cmyk });
      }
    }
  }

  const colorActivoPaleta =
    campo && destinoColor === "borde"
      ? campo.color_trazo
      : campo
        ? campo.color
        : linea
          ? linea.color
          : rect && destinoColor === "rect-borde"
            ? rect.color_trazo
            : rect?.relleno && !esSinColor(rect.color_relleno)
              ? rect.color_relleno
              : rect?.color_trazo;

  const propsGuardar = {
    onGuardarColor: guardarEnPaleta,
    guardandoColor: guardarColorMut.isPending,
  };

  return (
    <div className="space-y-2">
      <PaletaColoresGuardados
        colores={coloresGuardados}
        colorActivo={colorActivoPaleta}
        onElegir={aplicarColorGuardado}
        onEliminar={(id) => eliminarColorMut.mutate(id)}
        cargando={cargandoColores}
      />

      <div className="space-y-2 border-b border-border pb-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Color y trazo</p>
      {multiseleccion > 1 ? (
        <p className="text-[10px] leading-snug text-muted">
          {multiseleccion} elementos seleccionados. Usa los botones de alineación o elige uno solo para editar color.
        </p>
      ) : !haySeleccion ? (
        <p className="text-[10px] leading-snug text-muted">Selecciona texto, línea o rectángulo en el lienzo.</p>
      ) : campo ? (
        <div className="space-y-2">
          <SelectorColorCompact
            label="Texto"
            color={campo.color}
            onChange={(hex, cmyk) => onPatchCampo({ color: hex, color_cmyk: cmyk })}
            onActivar={() => setDestinoColor("texto")}
            {...propsGuardar}
          />
          <SliderCompacto
            label="Trazo"
            value={campo.grosor_trazo ?? 0}
            min={0}
            max={4}
            step={0.2}
            onChange={(v) => onPatchCampo({ grosor_trazo: v })}
          />
          {(campo.grosor_trazo ?? 0) > 0 && (
            <SelectorColorCompact
              label="Borde"
              color={campo.color_trazo ?? "#000000"}
              onChange={(hex, cmyk) => onPatchCampo({ color_trazo: hex, color_trazo_cmyk: cmyk })}
              onActivar={() => setDestinoColor("borde")}
              {...propsGuardar}
            />
          )}
        </div>
      ) : linea ? (
        <div className="space-y-2">
          <SelectorColorCompact
            label="Línea"
            color={linea.color}
            onChange={(hex, cmyk) => onPatchLinea({ color: hex, color_cmyk: cmyk })}
            onActivar={() => setDestinoColor("linea")}
            {...propsGuardar}
          />
          <SliderCompacto
            label="Grosor"
            value={clampGrosorLinea(linea.grosor)}
            min={GROSOR_LINEA_MIN}
            max={GROSOR_LINEA_MAX}
            step={0.1}
            onChange={(v) => onPatchLinea({ grosor: clampGrosorLinea(v) })}
          />
        </div>
      ) : rect ? (
        <div className="space-y-2">
          <SelectorColorCompact
            label="Relleno"
            color={rect.relleno && !esSinColor(rect.color_relleno) ? rect.color_relleno : COLOR_SIN}
            onChange={(hex, cmyk) => {
              if (esSinColor(hex)) {
                onPatchRect({ relleno: false, color_relleno: COLOR_SIN, color_relleno_cmyk: CMYK_TRANSPARENTE });
              } else {
                onPatchRect({ relleno: true, color_relleno: hex, color_relleno_cmyk: cmyk });
              }
            }}
            onActivar={() => setDestinoColor("relleno")}
            {...propsGuardar}
          />
          <SliderCompacto
            label="Trazo"
            value={rect.grosor_trazo}
            min={0}
            max={4}
            step={0.1}
            onChange={(v) => onPatchRect({ grosor_trazo: v })}
          />
          {(rect.grosor_trazo ?? 0) > 0 && (
            <SelectorColorCompact
              label="Borde"
              color={rect.color_trazo}
              onChange={(hex, cmyk) => onPatchRect({ color_trazo: hex, color_trazo_cmyk: cmyk })}
              onActivar={() => setDestinoColor("rect-borde")}
              {...propsGuardar}
            />
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}

function PanelSuperiorEdicion({
  campo,
  onPatch,
}: {
  campo?: CampoTexto;
  onPatch: (patch: Partial<CampoTexto>) => void;
}) {
  const variante = campo ? varianteMontserratCampo(campo) : "regular";

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2">
      <span className="w-24 shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted">Edición</span>
      {!campo ? (
        <p className="text-[10px] text-muted">Selecciona un texto en el lienzo.</p>
      ) : (
        <>
          <input
            type="text"
            value={campo.texto}
            lang="es"
            spellCheck={campo.ortografia !== false}
            onChange={(e) => onPatch({ texto: e.target.value })}
            className="min-w-[10rem] flex-1 rounded border border-border bg-surface-panel px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="Contenido del texto"
          />
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {VARIANTES_MONTSERRAT.map((v) => (
              <button
                key={v.id}
                type="button"
                title={v.label}
                onClick={() => onPatch({ font_variant: v.id, bold: v.weight >= 700 })}
                className={`shrink-0 rounded px-2 py-1 text-[10px] transition ${
                  variante === v.id
                    ? "bg-accent text-white"
                    : "border border-border text-ink-secondary hover:bg-surface-hover"
                }`}
                style={{ fontFamily: '"Montserrat", sans-serif', fontWeight: v.weight }}
              >
                {v.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <span className="text-muted">Pt</span>
            <input
              type="range"
              min={TAMANO_TEXTO_PT_MIN}
              max={TAMANO_TEXTO_PT_MAX}
              step={1}
              value={clampTamanoTextoPt(campo.font_size)}
              onChange={(e) => onPatch({ font_size: clampTamanoTextoPt(Number(e.target.value)) })}
              className="w-20 accent-accent"
            />
            <span className="w-5 font-mono">{clampTamanoTextoPt(campo.font_size)}</span>
          </label>
          <div className="flex shrink-0 gap-0.5">
            {ALINEACIONES_TEXTO.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.title}
                onClick={() => onPatch({ align: a.id })}
                className={`rounded border px-1.5 py-0.5 text-sm font-bold ${
                  campo.align === a.id ? "border-accent bg-accent text-white" : "border-border"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <label className="flex shrink-0 items-center gap-1 text-[10px]">
            <input
              type="checkbox"
              checked={campo.ortografia !== false}
              onChange={(e) => onPatch({ ortografia: e.target.checked })}
              className="accent-accent"
            />
            Ortografía
          </label>
        </>
      )}
    </div>
  );
}

function BtnIconoToolbar({
  activo,
  onClick,
  icon,
  title,
  disabled = false,
  danger = false,
}: {
  activo?: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex aspect-square w-full items-center justify-center rounded-sm text-[15px] leading-none transition disabled:opacity-30 ${
        activo
          ? "bg-accent text-white shadow-inner ring-1 ring-accent/50"
          : danger
            ? "text-danger hover:bg-danger/15"
            : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
      }`}
    >
      {icon}
    </button>
  );
}

function MarcoSeleccionSimple({ onMover }: { onMover?: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 box-border"
      style={{ overflow: "visible", border: MARCO_SELECCION_CSS }}
    >
      {onMover && (
        <button
          type="button"
          title="Mover"
          className="pointer-events-auto absolute inset-0 z-40 m-0 cursor-move border-0 bg-transparent p-0"
          onMouseDown={onMover}
        />
      )}
    </div>
  );
}

function PanelAlineacion({
  cantidad,
  onAlinear,
}: {
  cantidad: number;
  onAlinear: (modo: AlineacionPlantilla) => void;
}) {
  if (cantidad < 2) return null;
  const btn = (modo: AlineacionPlantilla, icon: string, title: string) => (
    <button
      key={modo}
      type="button"
      title={title}
      onClick={() => onAlinear(modo)}
      className="flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-xs text-ink hover:border-accent hover:bg-accent/10"
    >
      {icon}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-panel px-3 py-2">
      <span className="mr-1 text-[10px] font-semibold text-muted">{cantidad} seleccionados</span>
      {btn("izq", "⬅", "Alinear izquierda")}
      {btn("centro-h", "↔", "Centrar horizontal")}
      {btn("der", "➡", "Alinear derecha")}
      <span className="mx-0.5 w-px self-stretch bg-border" aria-hidden />
      {btn("arriba", "⬆", "Alinear arriba")}
      {btn("medio-v", "↕", "Centrar vertical")}
      {btn("abajo", "⬇", "Alinear abajo")}
    </div>
  );
}

function MarcoRedimensionable({
  activo,
  onMover,
  onRedimensionar,
  redimensionLibre = false,
  children,
}: {
  activo: boolean;
  onMover: (e: React.MouseEvent) => void;
  onRedimensionar: (e: React.MouseEvent, asa: AsaRedimensionId) => void;
  /** Esquinas + lados (estirar ancho/alto por separado; sin mantener proporción). */
  redimensionLibre?: boolean;
  children?: React.ReactNode;
}) {
  if (!activo) return <>{children}</>;
  const asas = redimensionLibre ? [...ASAS_REDIMENSION, ...ASAS_LATERALES] : ASAS_REDIMENSION;
  const marco = (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ overflow: "visible" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 box-border"
        style={{ border: MARCO_SELECCION_CSS }}
      />
      <button
        type="button"
        title="Mover"
        className="pointer-events-auto absolute inset-0 z-30 m-0 cursor-move border-0 bg-transparent p-0"
        onMouseDown={onMover}
      />
      {asas.map((a) => (
        <button
          key={a.id}
          type="button"
          title={redimensionLibre ? `Redimensionar ${a.id}` : `Redimensionar esquina ${a.id}`}
          className="pointer-events-auto m-0 block appearance-none border-0 bg-transparent p-0"
          style={{ ...estiloAsaRedimension(a.id), cursor: a.cursor }}
          onMouseDown={(e) => onRedimensionar(e, a.id)}
        >
          <span
            className="pointer-events-none block shrink-0 rounded-[0.5px] border border-[#016d82]/90 bg-white mck-paper-white shadow-[0_0_0_0.5px_rgba(255,255,255,0.9)]"
            style={estiloNodoVisualAsa(a.id)}
          />
        </button>
      ))}
    </div>
  );
  if (!children) return marco;
  return (
    <div className="relative h-full w-full overflow-visible">
      {children}
      {marco}
    </div>
  );
}

/** Solo Suprimir (Delete) elimina el objeto; Retroceso edita texto. */
function esTeclaEliminarElemento(e: { key: string; code: string }) {
  return e.key === "Delete" || e.code === "Delete";
}

const ALINEACIONES_TEXTO: { id: CampoTexto["align"]; label: string; title: string }[] = [
  { id: "left", label: "⫷", title: "Izquierda" },
  { id: "center", label: "☰", title: "Centro" },
  { id: "right", label: "⫸", title: "Derecha" },
  { id: "justify", label: "≡", title: "Justificado" },
];

function enCampoEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable='true']");
}

function panelBearerToken(): string | null {
  const tickets = useTicketsAuth.getState();
  return tickets.apiToken || tickets.token || useAuthStore.getState().token || null;
}

function ImgRecursoPng({
  nombre,
  thumbB64,
  className = "",
  style,
}: {
  nombre: string;
  thumbB64?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const [src, setSrc] = useState<string | null>(
    thumbB64 ? `data:image/png;base64,${thumbB64}` : null,
  );
  useEffect(() => {
    if (thumbB64) {
      setSrc(`data:image/png;base64,${thumbB64}`);
      return;
    }
    let alive = true;
    const token = panelBearerToken();
    const url = resolvePanelApiUrl(
      `/api/etiquetas/recursos-png/archivo/${encodeURIComponent(nombre)}`,
    );
    fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...ticketsSessionHeaders(),
      },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!alive || !blob) return;
        setSrc(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [nombre, thumbB64]);
  if (!src) {
    return <div className={`bg-surface-hover ${className}`} style={style} />;
  }
  return <img src={src} alt={nombre} className={className} style={style} draggable={false} />;
}

function esImagenPngJpg(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".jpe")) {
    return true;
  }
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/jpg";
}

function BotonImportarImagenRecurso({
  onSubido,
  className = "",
  label = "Importar imagen",
  compact = false,
}: {
  onSubido: (item: RecursoPng) => void;
  className?: string;
  label?: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const subirMut = useMutation({
    mutationFn: (file: File) => {
      if (!esImagenPngJpg(file)) throw new Error("Solo se permiten archivos JPG o PNG.");
      const fd = new FormData();
      fd.append("archivo", file);
      return api.upload<RecursoPng & { ok: boolean }>("/api/etiquetas/recursos-png", fd);
    },
    onSuccess: (data) => {
      setErrorLocal(null);
      qc.invalidateQueries({ queryKey: ["etiquetas-recursos-png"] });
      onSubido(data);
    },
    onError: (err: Error) => setErrorLocal(err.message),
  });

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,.jpg,.jpeg,.jpe,.png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subirMut.mutate(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={subirMut.isPending}
        onClick={() => inputRef.current?.click()}
        title="Importar JPG o PNG"
        className={`inline-flex items-center gap-1 rounded border border-border bg-surface font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50 ${
          compact ? `h-8 px-2.5 ${RIB_FONT_BTN}` : "px-3 py-2 text-sm"
        }`}
      >
        {subirMut.isPending ? "Importando…" : label}
      </button>
      {errorLocal && <p className="mt-1 text-[10px] text-danger">{errorLocal}</p>}
    </div>
  );
}

/** Rotación por defecto al elegir formato (PDF apaisado → rollo estrecho). */
const ETIQUETAS_ROTACION_DEFAULT: Record<string, string> = {
  Lactato: "90",
};

function rotacionDefaultEtiqueta(tipo: string): string {
  return ETIQUETAS_ROTACION_DEFAULT[tipo] ?? "0";
}

/** Solo 0° y 90° están disponibles en el panel. */
function rotacionValida(r: string | undefined): string {
  return r === "90" ? "90" : "0";
}

const LOTE_PREFIJO = "LOT.";
const EXP_PREFIJO = "EXP.";

/** Normaliza a `LOT. CÓDIGO` / `EXP. FECHA` (espacio tras el punto). */
function conPrefijoEspaciado(val: string | undefined, prefijo: string, alt: string): string {
  const v = (val ?? "").trim();
  if (!v) return prefijo;
  const vu = v.toUpperCase();
  const prefU = prefijo.toUpperCase();
  let resto: string;
  if (vu.startsWith(prefU)) {
    resto = v.slice(prefijo.length).replace(/^[.\s]+/, "").trim();
  } else if (vu.startsWith(alt.toUpperCase())) {
    resto = v.slice(alt.length).replace(/^[.\s]+/, "").trim();
  } else {
    resto = v;
  }
  return resto ? `${prefijo} ${resto}` : prefijo;
}

function conPrefijoLote(val: string | undefined): string {
  return conPrefijoEspaciado(val, LOTE_PREFIJO, "LOT");
}

function conPrefijoExp(val: string | undefined): string {
  return conPrefijoEspaciado(val, EXP_PREFIJO, "EXP");
}

function editarConPrefijo(valor: string, prefijo: string): string {
  const upper = valor.toUpperCase();
  const prefUpper = prefijo.toUpperCase();
  if (valor.length < prefijo.length && prefUpper.startsWith(upper)) {
    return prefijo;
  }
  if (!upper.startsWith(prefUpper)) {
    const stripped = valor
      .replace(new RegExp(`^${prefijo.replace(".", "\\.")}`, "i"), "")
      .replace(/^[.\s]+/, "")
      .trimStart();
    return stripped ? `${prefijo} ${stripped}` : prefijo;
  }
  const resto = valor.slice(prefijo.length);
  if (!resto) return prefijo;
  if (resto.startsWith(" ")) return prefijo + resto;
  return `${prefijo} ${resto.replace(/^[.\s]+/, "")}`;
}

function loteParaEtiqueta(val: string | undefined): string | undefined {
  const normalizado = conPrefijoLote(val);
  if (!normalizado || normalizado === LOTE_PREFIJO) return undefined;
  return normalizado;
}

function expParaEtiqueta(val: string | undefined): string | undefined {
  const normalizado = conPrefijoExp(val);
  if (!normalizado || normalizado === EXP_PREFIJO) return undefined;
  return normalizado;
}

const FORMAS = [
  { label: "Gap", value: "Diecut_Gap" },
  { label: "Marca negra", value: "Diecut_Blackmark" },
  { label: "Continua", value: "Contlabel_no_detection" },
];

function esFormatoCircularImpresion(formato: { nombre: string; anchoMm: number; altoMm: number }): boolean {
  const n = (formato.nombre || "").trim().toLowerCase();
  if (n.includes("circular") || n.includes("circle")) return true;
  const w = formato.anchoMm;
  const h = formato.altoMm;
  return w > 0 && h > 0 && Math.abs(w - h) <= 1 && w >= 48 && w <= 57;
}

const CALIDADES = [
  { label: "Borrador (máx. velocidad)", value: "MaxSpeed" },
  { label: "Rápida", value: "Speed" },
  { label: "Normal", value: "Normal" },
  { label: "Alta calidad", value: "Quality" },
  { label: "Máxima (fotos / logos)", value: "MaxQuality" },
];

const ROTACIONES = [
  { label: "0°", value: "0" },
  { label: "90°", value: "90" },
];

const LOTE_POS_PCT: Record<string, { x: number; y: number }> = {
  "center": { x: 50, y: 48 },
  "bottom-left": { x: 5, y: 88 },
  "bottom-right": { x: 58, y: 88 },
  "top-left": { x: 5, y: 6 },
  "top-right": { x: 58, y: 6 },
};

/** Separación vertical (en % de alto) entre línea LOT y EXP dentro del bloque único. */
const LOTE_EXP_GAP_PCT = 5.5;

/** Tamaño por defecto al imprimir: bloque único grande y legible. */
const LOTE_FONT_IMPRIMIR_DEFAULT = 14;

function lotePctInicial(pos: string | undefined, x?: number, y?: number): { x: number; y: number } {
  if (typeof x === "number" && typeof y === "number") return { x, y };
  return LOTE_POS_PCT[pos ?? "center"] ?? LOTE_POS_PCT["center"];
}

/** Posición inicial del vencimiento: debajo del lote en el mismo bloque centrado. */
function vencPctInicial(loteX: number, loteY: number, x?: number, y?: number): { x: number; y: number } {
  if (typeof x === "number" && typeof y === "number") return { x, y };
  return { x: loteX, y: clampLotePct(loteY + LOTE_EXP_GAP_PCT) };
}

function clampLotePct(n: number): number {
  return Math.max(0, Math.min(98, Math.round(n * 10) / 10));
}

const PREVIEW_IMG_LARGE =
  "block max-h-full max-w-full w-auto h-auto object-contain rounded-md shadow-sm transition-opacity duration-200";
const PREVIEW_CONTAINER_LARGE =
  "flex items-center justify-center w-full h-full min-h-0 overflow-hidden p-2";
/** PNG de Studio: caber completo en el lienzo (contain), sin scroll forzado. */
const PREVIEW_IMG_ETIQUETA_PNG =
  "block h-auto w-auto max-h-full max-w-full object-contain rounded-md shadow-sm transition-opacity duration-200";
const PREVIEW_CONTAINER_ETIQUETA_PNG =
  "flex items-center justify-center w-full h-full min-h-0 overflow-hidden p-2";
/** Misma resolución que `_pdf_a_imagen` en Flask (180 DPI). */
const PREVIEW_DPI = 180;

type EditorRibbonTab = "inicio" | "lote" | "impresion" | "texto" | "editar-pdf";

/** Tipografía cinta — compacta para dejar espacio al lienzo */
const RIB_FONT_INP = "text-[11px]";
const RIB_FONT_LBL = "text-[9px]";
const RIB_FONT_GRP = "text-[8px]";
const RIB_FONT_TAB = "text-[12px]";
const RIB_FONT_BTN = "text-[11px]";
const RIB_FONT_META = "text-[10px]";
const RIB_FONT_HINT = "text-[9px]";

const RIB_INP =
  `h-7 min-w-[4.5rem] rounded border border-border bg-surface px-1.5 ${RIB_FONT_INP} text-ink outline-none focus:border-accent`;
const RIB_SEL = RIB_INP;
const RIB_LBL = `mb-0 block ${RIB_FONT_LBL} font-medium uppercase tracking-wide text-muted whitespace-nowrap`;

function RibbonGroup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-center border-r border-border/50 px-2 py-1 ${className}`}
      aria-label={label}
    >
      <div className="flex flex-wrap items-end gap-1.5">{children}</div>
    </div>
  );
}

/** Desplegable compacto para opciones cortas (Sensor, Calidad, Rotación). */
function RibbonSelect({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={RIB_LBL}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${RIB_SEL} max-w-[10.5rem]`}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function BannerErrorImpresora({
  error,
  onCerrar,
  onInstalar,
  onWindowsRemoto,
}: {
  error: ErrorImpresora;
  onCerrar: () => void;
  onInstalar?: () => void;
  onWindowsRemoto?: () => void;
}) {
  const mostrarInstalar = onInstalar && (!error.codigo || CODIGOS_INSTALAR_IMPRESORA.has(error.codigo));
  const esSinUsb = error.codigo === "sin_usb" || error.codigo === "remoto_sin_uri" || error.codigo === "smb_sin_respuesta";
  return (
    <Banner tone="danger" className="flex-shrink-0 items-start rounded-none border-x-0 border-t-0 px-4 py-3" onClose={onCerrar}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg leading-none" aria-hidden>⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{error.error}</p>
          <p className="mt-1 text-xs leading-relaxed">
            <span className="font-semibold">Posible solución: </span>
            {error.solucion}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {mostrarInstalar && (
              <Button variant="secondary" size="sm" onClick={onInstalar}>
                {esSinUsb ? "USB en este PC" : "Instalar impresora"}
              </Button>
            )}
            {esSinUsb && onWindowsRemoto && (
              <Button variant="primary" size="sm" onClick={onWindowsRemoto}>
                Instalar Windows 10 Pro
              </Button>
            )}
            {esSinUsb && (
              <a
                href={DRIVER_EPSON_WINDOWS_10_PRO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center rounded border border-border bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface-hover"
              >
                Driver Windows 10 Pro
              </a>
            )}
          </div>
        </div>
      </div>
    </Banner>
  );
}

function errorDesdePrintResult(data: PrintResult): ErrorImpresora | null {
  if (data.ok) return null;
  return {
    error: data.error ?? "Error al imprimir",
    solucion: data.solucion ?? "Revisa la conexión USB y el estado de la impresora.",
    codigo: data.codigo,
  };
}

function errorDesdeExcepcion(msg: string): ErrorImpresora {
  const ml = msg.toLowerCase();
  if (ml.includes("no autorizado")) {
    return { error: msg, solucion: "Cierra sesión y vuelve a ingresar con tu token.", codigo: "auth" };
  }
  if (ml.includes("timeout")) {
    return { error: "La impresión tardó demasiado", solucion: "Verifica que la impresora esté encendida y vuelve a intentar.", codigo: "timeout" };
  }
  return { error: msg, solucion: "Revisa cable USB, rollo de etiquetas y pulsa «Instalar impresora».", codigo: "desconocido" };
}

function RibbonTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; disabled?: boolean; hint?: string; emphasize?: boolean }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-end gap-0 border-b border-border bg-surface-panel px-2 pt-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={t.disabled}
          title={t.hint}
          onClick={() => onChange(t.id)}
          className={`relative rounded-t-md px-4 py-2.5 ${RIB_FONT_TAB} font-semibold transition disabled:opacity-40 ${
            active === t.id
              ? "z-10 -mb-px border border-border border-b-surface bg-surface text-accent"
              : t.emphasize
                ? "border border-b-0 border-amber-500/60 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "text-muted hover:bg-surface-hover/70 hover:text-ink"
          }`}
        >
          {t.label}
          {t.emphasize && active !== t.id && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" aria-hidden />
          )}
        </button>
      ))}
    </div>
  );
}

function pctDesdePuntero(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { x: clampLotePct(x), y: clampLotePct(y) };
}

const _PALABRAS_IGNORAR_MATCH_PNG = new Set([
  "de", "del", "la", "el", "los", "las", "en", "con", "para", "gr", "kg", "ml", "lb",
]);

function _tokensSignificativos(texto: string): string[] {
  const norm = (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return norm
    .split(/\s+/)
    .filter((p) => p.length > 2 && !_PALABRAS_IGNORAR_MATCH_PNG.has(p) && !/^\d+$/.test(p));
}

/**
 * Asocia el nombre de un archivo PNG/PDF de la biblioteca (sin SKU propio) con
 * un producto ya registrado en Códigos EAN, para poder traer su lote vigente.
 * Conservador a propósito (riesgo de trazabilidad si se imprime el lote de
 * OTRO producto): exige que TODAS las palabras clave del nombre del producto
 * aparezcan en el nombre del archivo, y descarta si hay más de un match único
 * con la mayor cantidad de palabras (ambigüedad → no autocompletar).
 */
function mejorCoincidenciaEanPorNombreArchivo(
  nombreArchivo: string,
  codigos: CodigoEan[] | undefined,
): CodigoEan | null {
  if (!codigos?.length) return null;
  const base = (nombreArchivo.split("/").pop() || nombreArchivo).replace(/\.[a-z0-9]+$/i, "");
  const tokensArchivo = new Set(_tokensSignificativos(base));
  if (!tokensArchivo.size) return null;

  let mejor: CodigoEan | null = null;
  let mejorScore = 0;
  let empatados = 0;
  for (const c of codigos) {
    const tokensProd = _tokensSignificativos(c.nombre_producto);
    if (tokensProd.length < 2) continue;
    if (!tokensProd.every((t) => tokensArchivo.has(t))) continue;
    // Bonus si la presentación (500g, 1kg, 30mL…) también aparece en el archivo —
    // desempata entre distintas presentaciones del mismo nombre de producto.
    const tokensPres = _tokensSignificativos(c.presentacion || "");
    const presCoincide = tokensPres.length > 0 && tokensPres.every((t) => tokensArchivo.has(t));
    const score = tokensProd.length + (presCoincide ? tokensPres.length : 0);
    if (score > mejorScore) {
      mejor = c;
      mejorScore = score;
      empatados = 1;
    } else if (score === mejorScore) {
      empatados += 1;
    }
  }
  return empatados === 1 ? mejor : null;
}

/** Un solo bloque LOTE + EXP (dos líneas), grande y centrado en la etiqueta.
 * Se arrastra como unidad; la posición enviada es el centro del bloque. */
function BloqueLoteExpPreview({
  loteText,
  vencText,
  xPct,
  yPct,
  fontPx,
  stageRef,
  onPositionChange,
}: {
  loteText?: string;
  vencText?: string;
  xPct: number;
  yPct: number;
  fontPx: number;
  stageRef: RefObject<HTMLDivElement | null>;
  onPositionChange?: (x: number, y: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const arrastrable = Boolean(onPositionChange);
  /** Solo líneas con dato real — no cabecera «LOTE · EXP» ni «EXP.» vacío (evita info repetida). */
  const lineaLote = loteText?.trim() || undefined;
  const lineaExp = vencText?.trim() || undefined;
  const visible = Boolean(lineaLote || lineaExp);
  const fontMostrar = Math.max(fontPx * 1.35, 16);

  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stageRef.current) return;
    const { x, y } = pctDesdePuntero(stageRef.current.getBoundingClientRect(), e.clientX, e.clientY);
    onPositionChange?.(x, y);
  };

  if (!visible) return null;

  return (
    <div
      role="presentation"
      title={arrastrable ? "Bloque LOTE / EXP — arrastra para mover" : "Bloque LOTE / EXP"}
      aria-label="Bloque de lote y vencimiento"
      className={`absolute select-none touch-none ${
        arrastrable ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""
      }`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 10,
      }}
      onPointerDown={(e) => {
        if (!arrastrable) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
        mover(e);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        e.preventDefault();
        mover(e);
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <div
        className="text-center"
        style={{
          fontFamily: '"Montserrat", sans-serif',
          fontWeight: 300,
          fontSize: `${fontMostrar}px`,
          lineHeight: 1.35,
          color: "#000",
          background: "transparent",
          border: "none",
          padding: 0,
          boxShadow: "none",
          outline: dragging ? "1px dashed rgba(1,109,130,0.45)" : "none",
          outlineOffset: 3,
        }}
      >
        {lineaLote ? <div className="whitespace-nowrap">{lineaLote}</div> : null}
        {lineaExp ? <div className="whitespace-nowrap">{lineaExp}</div> : null}
      </div>
    </div>
  );
}

function VistaPreviaConLote({
  imagen,
  srcUrl,
  mime = "image/png",
  loading,
  emptyText = "Selecciona un PDF para ver la vista previa",
  loteText,
  vencText,
  loteFont,
  loteXPct,
  loteYPct,
  onLotePositionChange,
  vencXPct: _vencXPct,
  vencYPct: _vencYPct,
  onVencPositionChange,
  imgClassName = "block max-w-full max-h-full w-auto h-auto rounded-lg shadow transition-opacity duration-200",
  containerClassName = "flex items-center justify-center w-full h-full min-h-[8rem]",
}: {
  imagen?: string;
  srcUrl?: string;
  mime?: string;
  loading?: boolean;
  emptyText?: string;
  loteText?: string;
  vencText?: string;
  loteFont: number;
  loteXPct: number;
  loteYPct: number;
  onLotePositionChange?: (x: number, y: number) => void;
  vencXPct: number;
  vencYPct: number;
  onVencPositionChange?: (x: number, y: number) => void;
  imgClassName?: string;
  containerClassName?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgMetrics, setImgMetrics] = useState({ displayH: 0, naturalH: 0, displayW: 0, naturalW: 0 });

  /** Escala la imagen para que quepa completa en el contenedor (contain). */
  const syncImgMetrics = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const box = stage?.parentElement ?? stage;
    const pad = 8;
    const contW = Math.max(40, (box?.clientWidth ?? 640) - pad);
    const contH = Math.max(40, (box?.clientHeight ?? 360) - pad);
    const scale = Math.min(contW / img.naturalWidth, contH / img.naturalHeight, 1);
    const displayW = Math.max(1, Math.round(img.naturalWidth * scale));
    const displayH = Math.max(1, Math.round(img.naturalHeight * scale));
    setImgMetrics({
      displayH,
      naturalH: img.naturalHeight,
      displayW,
      naturalW: img.naturalWidth,
    });
  }, []);

  useEffect(() => {
    syncImgMetrics();
    const box = stageRef.current?.parentElement ?? stageRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => syncImgMetrics());
    ro.observe(box);
    return () => ro.disconnect();
  }, [syncImgMetrics, imagen, srcUrl]);

  const imgSrc = srcUrl ?? (imagen ? `data:${mime};base64,${imagen}` : undefined);
  const fontPx =
    imgMetrics.naturalH > 0 && imgMetrics.displayH > 0
      ? Math.max(TAMANO_TEXTO_PT_MIN, loteFont * (PREVIEW_DPI / 72) * (imgMetrics.displayH / imgMetrics.naturalH))
      : Math.max(TAMANO_TEXTO_PT_MIN, loteFont);

  const moverBloque = onLotePositionChange || onVencPositionChange
    ? (x: number, y: number) => {
        onLotePositionChange?.(x, y);
        onVencPositionChange?.(x, clampLotePct(y + LOTE_EXP_GAP_PCT));
      }
    : undefined;

  const tieneMedida = imgMetrics.displayW > 0 && imgMetrics.displayH > 0;

  return (
    <div className={containerClassName}>
      {imgSrc ? (
        <div
          ref={stageRef}
          className="relative inline-block max-h-full max-w-full leading-none"
          style={tieneMedida ? { width: imgMetrics.displayW, height: imgMetrics.displayH } : undefined}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt="Vista previa"
            className={`${imgClassName} ${loading ? "opacity-50" : "opacity-100"}`}
            style={
              tieneMedida
                ? { width: imgMetrics.displayW, height: imgMetrics.displayH }
                : { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }
            }
            onLoad={syncImgMetrics}
            draggable={false}
          />
          <BloqueLoteExpPreview
            loteText={loteText}
            vencText={vencText}
            xPct={loteXPct}
            yPct={loteYPct}
            fontPx={fontPx}
            stageRef={stageRef}
            onPositionChange={moverBloque}
          />
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner size="lg" />
          <span className="text-xs">Renderizando...</span>
        </div>
      ) : (
        <p className="text-xs text-muted text-center px-8">{emptyText}</p>
      )}
    </div>
  );
}

function VistaPreviaPngConLote({
  nombre,
  loteText,
  vencText,
  loteFont,
  loteXPct,
  loteYPct,
  onLotePositionChange,
  vencXPct,
  vencYPct,
  onVencPositionChange,
  imgClassName = PREVIEW_IMG_ETIQUETA_PNG,
  containerClassName = PREVIEW_CONTAINER_ETIQUETA_PNG,
}: {
  nombre: string;
  loteText?: string;
  vencText?: string;
  loteFont: number;
  loteXPct: number;
  loteYPct: number;
  onLotePositionChange?: (x: number, y: number) => void;
  vencXPct: number;
  vencYPct: number;
  onVencPositionChange?: (x: number, y: number) => void;
  imgClassName?: string;
  containerClassName?: string;
}) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setSrcUrl(null);
    setFallo(false);
    resolverUrlImagenCanvas(`/api/etiquetas/recursos-png/archivo/${codificarRutaRecursoPng(nombre)}`)
      .then((url) => {
        if (!cancelado) setSrcUrl(url);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [nombre]);

  if (fallo) {
    return <p className="px-6 text-center text-xs text-danger">No se pudo cargar la imagen.</p>;
  }

  return (
    <VistaPreviaConLote
      srcUrl={srcUrl ?? undefined}
      loading={!srcUrl}
      emptyText="Cargando PNG…"
      loteText={loteText}
      vencText={vencText}
      loteFont={loteFont}
      loteXPct={loteXPct}
      loteYPct={loteYPct}
      onLotePositionChange={onLotePositionChange}
      vencXPct={vencXPct}
      vencYPct={vencYPct}
      onVencPositionChange={onVencPositionChange}
      imgClassName={imgClassName}
      containerClassName={containerClassName}
    />
  );
}

// ── Navegador de archivos ─────────────────────────────────────────────────────

function BotonSubirPdfEtiqueta({
  onSubido,
  className = "",
  label = "📤 Subir PDF",
  disabled = false,
  compact = false,
}: {
  onSubido: (item: PdfItem) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const subirMut = useMutation({
    mutationFn: (file: File) => {
      const esPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!esPdf) throw new Error("Solo se permiten archivos PDF.");
      const fd = new FormData();
      fd.append("archivo", file);
      return api.upload<{
        ok: boolean;
        nombre: string;
        ruta: string;
        ruta_completa: string;
        guardado?: boolean;
      }>("/api/etiquetas/subir-pdf", fd);
    },
    onSuccess: (data) => {
      setErrorLocal(null);
      qc.invalidateQueries({ queryKey: ["etiquetas-pdfs"] });
      onSubido({
        nombre: data.nombre,
        ruta: data.ruta,
        ruta_completa: data.ruta_completa,
        guardado: true,
      });
    },
    onError: (err) => setErrorLocal(err.message),
  });

  function procesarArchivos(files: FileList | null) {
    const f = files?.[0];
    if (f) subirMut.mutate(f);
    if (inputRef.current) inputRef.current.value = "";
  }

  const btnCls = compact
    ? `inline-flex h-8 items-center gap-1 rounded border-2 border-accent bg-accent px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-50`
    : `inline-flex items-center gap-1.5 rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-sm font-bold text-white transition hover:bg-accent/90 disabled:opacity-50`;

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => procesarArchivos(e.target.files)}
      />
      <button
        type="button"
        disabled={disabled || subirMut.isPending}
        onClick={() => inputRef.current?.click()}
        className={btnCls}
      >
        {subirMut.isPending ? "Guardando…" : label}
      </button>
      {errorLocal && (
        <p className="mt-1 text-[11px] text-danger">{errorLocal}</p>
      )}
    </div>
  );
}

function NavegadorArchivos({
  onSeleccionar,
  onCerrar,
}: {
  onSeleccionar: (item: { nombre: string; ruta_completa: string }) => void;
  onCerrar: () => void;
}) {
  const [rutaActual, setRutaActual] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["nav-archivos", rutaActual ?? "__raiz__"],
    queryFn: () =>
      api.get<NavResp>(
        `/api/etiquetas/navegar?ruta=${encodeURIComponent(rutaActual ?? "__raiz__")}`,
      ),
  });

  const pdfsVisibles = (data?.pdfs ?? []).filter(
    (p) => !busqueda.trim() || p.nombre.toLowerCase().includes(busqueda.toLowerCase()),
  );

  function irA(ruta: string | null) {
    setBusqueda("");
    setRutaActual(ruta);
  }

  const breadcrumb: { nombre: string; ruta: string }[] = [];
  if (data?.ruta_actual) {
    const partes = data.ruta_actual.split("/").filter(Boolean);
    let acum = "";
    for (const p of partes) {
      acum += "/" + p;
      breadcrumb.push({ nombre: p, ruta: acum });
    }
  }

  const discos = data?.discos ?? [];
  const enRaiz = !!data?.modo_raiz;
  const apiSinDiscos =
    !isLoading && !error && !enRaiz && rutaActual === null && !!data?.ruta_actual;

  return (
    <Modal
      onClose={onCerrar}
      maxWidthClassName="max-w-xl"
      fixedHeight
      title={
        <>
          <h3 className="text-sm font-bold text-ink">Explorar archivos PDF</h3>
          <p className="truncate text-xs font-normal text-muted">
            {enRaiz ? "Selecciona un disco o sube un PDF (queda guardado en Documentos)" : data?.ruta_actual}
          </p>
        </>
      }
      headerExtra={
        <BotonSubirPdfEtiqueta
          compact
          label="📤 Subir"
          onSubido={(item) => {
            onSeleccionar({ nombre: item.nombre, ruta_completa: item.ruta_completa });
            onCerrar();
          }}
        />
      }
      footer={
        <Button variant="secondary" className="w-full" onClick={onCerrar}>
          Cancelar
        </Button>
      }
    >
      <div className="flex h-full flex-col">
        {(enRaiz || data?.ruta_actual) && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 flex-shrink-0 text-xs">
            {data?.padre != null && (
              <button
                onClick={() => irA(data.padre === "__raiz__" ? null : data.padre)}
                className="mr-1 rounded px-1.5 py-0.5 text-muted hover:bg-surface-hover hover:text-ink"
              >
                ←
              </button>
            )}
            {!enRaiz && (
              <button
                onClick={() => irA(null)}
                className="mr-1 rounded px-1.5 py-0.5 font-semibold text-accent hover:bg-surface-hover"
              >
                💿 Este equipo
              </button>
            )}
            {enRaiz ? (
              <span className="rounded px-1.5 py-0.5 font-semibold text-ink">Discos y ubicaciones</span>
            ) : (
              breadcrumb.map((b, i) => (
                <span key={b.ruta} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted">/</span>}
                  <button
                    onClick={() => irA(b.ruta)}
                    className={`rounded px-1.5 py-0.5 transition hover:bg-surface-hover ${
                      i === breadcrumb.length - 1 ? "font-semibold text-ink" : "text-muted"
                    }`}
                  >
                    {b.nombre}
                  </button>
                </span>
              ))
            )}
          </div>
        )}

        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar PDF en esta carpeta..."
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {apiSinDiscos && (
            <Banner tone="warning" className="mb-3 text-xs">
              El servidor aún no tiene la vista de discos. Reinicia el servicio:{" "}
              <code className="font-mono">sudo systemctl restart agente-pro</code>
              {" "}y recarga el panel (Ctrl+Shift+R).
            </Banner>
          )}
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted gap-2">
              <Spinner />
              Cargando...
            </div>
          )}
          {error && <p className="py-4 text-center text-sm text-danger">Error al leer directorio</p>}

          {!busqueda && enRaiz && discos.map((d) => (
            <button
              key={d.ruta}
              onClick={() => irA(d.ruta)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">{iconoDisco(d.icono)}</span>
              <span className="font-medium text-ink">{d.nombre}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).map((c) => (
            <button
              key={c}
              onClick={() => irA(`${data!.ruta_actual}/${c}`)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-surface-hover"
            >
              <span className="text-base">📁</span>
              <span className="font-medium text-ink">{c}</span>
            </button>
          ))}

          {!busqueda && !enRaiz && (data?.carpetas ?? []).length > 0 && pdfsVisibles.length > 0 && (
            <div className="my-2 border-t border-border" />
          )}

          {!enRaiz && pdfsVisibles.map((p) => (
            <button
              key={p.ruta_completa}
              onClick={() => onSeleccionar({ nombre: p.nombre, ruta_completa: p.ruta_completa })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-accent hover:text-white"
            >
              <span className="text-base">📄</span>
              <span className="flex-1 font-medium">{p.nombre}</span>
              <span className="text-xs opacity-60">{p.tamano_kb} KB</span>
            </button>
          ))}

          {!isLoading && !enRaiz && pdfsVisibles.length === 0 && (data?.carpetas ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin archivos PDF aquí</p>
          )}
          {!isLoading && enRaiz && discos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">No se detectaron discos montados</p>
          )}
          {!isLoading && busqueda && pdfsVisibles.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Sin resultados para "{busqueda}"</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Wizard instalación ────────────────────────────────────────────────────────

type InstaladorTab = "ubuntu" | "windows10pro";

function esSesionJennifer(nombre?: string | null, username?: string | null): boolean {
  const n = `${nombre || ""} ${username || ""}`.toLowerCase();
  // Jenniffer Garcia (tickets), variantes de escritura, username jerry
  return (
    n.includes("jenniffer")
    || n.includes("jennifer")
    || n.includes("jenifer")
    || n.trim() === "jerry"
    || n.split(/\s+/).includes("jerry")
  );
}

function nombreSesionRemoto(
  sesionJennifer: boolean,
  nombre?: string | null,
  username?: string | null,
): string {
  if (sesionJennifer) {
    return (nombre || "").trim() || "Jenniffer Garcia";
  }
  return (nombre || username || "operador").trim() || "operador";
}

function InstaladorWizard({
  onCerrar,
  tabInicial = "windows10pro",
}: {
  onCerrar: () => void;
  tabInicial?: InstaladorTab;
}) {
  const ticketsUser = useTicketsAuth((s) => s.user);
  const sesionJennifer = esSesionJennifer(ticketsUser?.nombre, ticketsUser?.username);
  const [tab, setTab] = useState<InstaladorTab>(
    tabInicial === "ubuntu" ? "ubuntu" : "windows10pro",
  );
  const [instalLog, setInstalLog] = useState<string[]>([]);
  const [instalDone, setInstalDone] = useState(false);
  const [hostWin, setHostWin] = useState(WINDOWS_10_PRO_HOST_DEFAULT);
  const [shareWin, setShareWin] = useState(WINDOWS_10_PRO_SHARE);
  const [remotoMsg, setRemotoMsg] = useState<string | null>(null);
  const [pasosWin, setPasosWin] = useState<string[]>([]);
  const [usarTailscale, setUsarTailscale] = useState(false);

  const { data: diagData, isLoading: diagLoading, refetch: refetchDiag } = useQuery({
    queryKey: ["etiquetas-diagnostico"],
    queryFn: () => api.get<DiagResp>("/api/etiquetas/diagnostico"),
  });

  const { data: remotoGet, refetch: refetchRemoto } = useQuery({
    queryKey: ["etiquetas-impresora-remoto"],
    queryFn: () => api.get<RemotoResp>("/api/etiquetas/impresora/remoto"),
  });

  const { data: tailscalePeers, isLoading: peersLoading } = useQuery({
    queryKey: ["etiquetas-impresora-tailscale-peers"],
    queryFn: () => api.get<TailscalePeersResp>("/api/etiquetas/impresora/tailscale-peers"),
    enabled: usarTailscale,
    refetchInterval: usarTailscale ? 15000 : false,
  });

  const {
    data: diagRed,
    refetch: refetchDiagRed,
    isFetching: diagRedFetching,
  } = useQuery({
    queryKey: ["etiquetas-impresora-diag-red"],
    queryFn: () => api.get<DiagRedResp>("/api/etiquetas/impresora/diagnostico-red"),
    enabled: false,
  });

  const scriptOneliner = usarTailscale
    ? SCRIPT_WINDOWS_PS1_ONELINER_TAILSCALE
    : SCRIPT_WINDOWS_PS1_ONELINER;

  useEffect(() => {
    const r = remotoGet?.remoto ?? diagData?.remoto;
    if (r?.host) setHostWin(String(r.host));
    else setHostWin(WINDOWS_10_PRO_HOST_DEFAULT);
    if (r?.share) setShareWin(String(r.share) || WINDOWS_10_PRO_SHARE);
  }, [remotoGet, diagData]);

  const instalarUbuntuMut = useMutation({
    mutationFn: () =>
      api.post<InstalResp & { mensaje?: string; uri_actual?: string }>(
        "/api/etiquetas/impresora/instalar-ubuntu",
        {},
      ),
    onSuccess: (data) => {
      setInstalLog(data.log ?? []);
      setInstalDone(true);
      setRemotoMsg(data.mensaje ?? "Ubuntu (.deb) instalado");
      void refetchDiag();
      void refetchRemoto();
    },
    onError: (err) => {
      setInstalLog([`Error: ${err.message}`]);
      setInstalDone(true);
      setRemotoMsg(err.message);
    },
  });

  const instalarMut = useMutation({
    mutationFn: () => api.post<InstalResp>("/api/etiquetas/instalar", {}),
    onSuccess: (data) => { setInstalLog(data.log ?? []); setInstalDone(true); refetchDiag(); },
    onError: (err) => { setInstalLog([`Error: ${err.message}`]); setInstalDone(true); },
  });

  const desinstalarMut = useMutation({
    mutationFn: () =>
      api.post<{
        ok: boolean;
        log?: string[];
        mensaje?: string;
        pasos_windows?: string[];
        driver_windows_url?: string;
      }>("/api/etiquetas/desinstalar", {}),
    onSuccess: (data) => {
      setInstalLog(data.log ?? []);
      setInstalDone(true);
      setRemotoMsg(data.mensaje ?? "Impresora desinstalada");
      setPasosWin(data.pasos_windows ?? []);
      void refetchDiag();
      void refetchRemoto();
    },
    onError: (err) => {
      setInstalLog([`Error: ${err.message}`]);
      setInstalDone(true);
      setRemotoMsg(err.message);
    },
  });

  const remotoMut = useMutation({
    mutationFn: () =>
      api.post<RemotoResp>("/api/etiquetas/impresora/remoto", {
        host: hostWin.trim(),
        share: shareWin.trim() || WINDOWS_10_PRO_SHARE,
        sistema_operativo: "windows_10_pro",
        sesion: nombreSesionRemoto(
          sesionJennifer,
          ticketsUser?.nombre,
          ticketsUser?.username,
        ),
      }),
    onSuccess: (data) => {
      setInstalLog(data.log ?? []);
      setInstalDone(true);
      setRemotoMsg(
        data.mensaje
          ?? `Instalado para ${WINDOWS_10_PRO_LABEL} → ${data.uri ?? "SMB"}`,
      );
      setPasosWin([]);
      void refetchDiag();
      void refetchRemoto();
    },
    onError: (err) => {
      setInstalLog([`Error: ${err.message}`]);
      setInstalDone(true);
      setRemotoMsg(err.message);
    },
  });

  const todoOk = diagData?.todo_ok ?? false;
  const modoRedOk = Boolean(diagData?.modo_red || remotoGet?.modo_red);
  const busy =
    instalarMut.isPending
    || instalarUbuntuMut.isPending
    || remotoMut.isPending
    || desinstalarMut.isPending;
  const tituloSesion = sesionJennifer
    ? `Sesión ${SESION_JENNIFFER_LABEL} · elige Ubuntu o Windows 10`
    : `Epson CW-C4000u · Ubuntu (.deb) o ${WINDOWS_10_PRO_LABEL}`;

  return (
    <Modal
      onClose={onCerrar}
      maxWidthClassName="max-w-lg"
      title={
        <>
          <h3 className="text-base font-bold text-ink">Instalación de impresora</h3>
          <p className="text-xs font-normal text-muted">{tituloSesion}</p>
        </>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar} disabled={busy}>
            {instalDone || todoOk || modoRedOk ? "Cerrar" : "Cancelar"}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            loading={desinstalarMut.isPending}
            disabled={busy}
            onClick={() => {
              if (!window.confirm("¿Desinstalar cola CW-C4000u del servidor y reiniciar instalación?")) return;
              setInstalLog([]);
              setInstalDone(false);
              setRemotoMsg(null);
              setPasosWin([]);
              desinstalarMut.mutate();
            }}
          >
            Desinstalar
          </Button>
          {tab === "ubuntu" && (
            <Button
              variant="primary"
              className="flex-1"
              loading={instalarUbuntuMut.isPending || instalarMut.isPending}
              disabled={diagLoading || busy}
              onClick={() => {
                setInstalLog([]);
                setInstalDone(false);
                setRemotoMsg(null);
                instalarUbuntuMut.mutate();
              }}
            >
              {instalarUbuntuMut.isPending ? "Instalando .deb..." : `Instalar ${UBUNTU_LABEL}`}
            </Button>
          )}
          {tab === "windows10pro" && (
            <Button
              variant="primary"
              className="flex-1"
              loading={remotoMut.isPending}
              disabled={!hostWin.trim() || busy}
              onClick={() => {
                setInstalLog([]);
                setInstalDone(false);
                setRemotoMsg(null);
                setPasosWin([]);
                remotoMut.mutate();
              }}
            >
              {remotoMut.isPending ? "Instalando..." : `Instalar ${WINDOWS_10_PRO_LABEL}`}
            </Button>
          )}
        </div>
      }
    >
      <div className="px-6 py-5 space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Sistema operativo</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setTab("ubuntu")}
              className={`rounded-lg border-2 px-3 py-3 text-left transition ${
                tab === "ubuntu"
                  ? "border-accent bg-accent/5 shadow-sm"
                  : "border-border bg-surface hover:border-accent/40"
              }`}
            >
              <p className="text-sm font-bold text-ink">{UBUNTU_LABEL}</p>
              <p className="mt-0.5 text-[10px] text-muted">
                Paquete .deb · USB en este servidor Linux
              </p>
              {tab === "ubuntu" && (
                <span className="mt-2 inline-block rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                  Seleccionado
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("windows10pro")}
              className={`rounded-lg border-2 px-3 py-3 text-left transition ${
                tab === "windows10pro"
                  ? "border-accent bg-accent/5 shadow-sm"
                  : "border-border bg-surface hover:border-accent/40"
              }`}
            >
              <p className="text-sm font-bold text-ink">{WINDOWS_10_PRO_LABEL}</p>
              <p className="mt-0.5 text-[10px] text-muted">
                PC {SESION_JENNIFFER_LABEL} · driver Epson · SMB
              </p>
              {tab === "windows10pro" && (
                <span className="mt-2 inline-block rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
                  Seleccionado
                </span>
              )}
            </button>
          </div>
        </div>

        {tab === "ubuntu" && (
          <div className="space-y-4">
            <Banner tone="accent" className="text-xs leading-relaxed">
              Instalación <strong>{UBUNTU_LABEL}</strong>: descarga el paquete McKenna
              (<span className="font-mono"> mckenna-epson-cwc4000u</span> (PPD + elpu + cola CUPS)
              o pulsa <strong>Instalar</strong> en este servidor.
            </Banner>

            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Paquete Ubuntu</p>
              <a
                href={DEB_UBUNTU_PUBLIC}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-xs font-semibold text-accent underline"
              >
                Descargar mckenna-epson-cwc4000u_amd64.deb
              </a>
              <p className="text-[10px] text-muted">
                También:{" "}
                <a href={DEB_UBUNTU_URL} download="mckenna-epson-cwc4000u_amd64.deb" className="underline text-accent">
                  descarga desde este panel
                </a>
              </p>
              <p className="text-[10px] text-muted">One-liner en el servidor:</p>
              <button
                type="button"
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-left font-mono text-[10px] text-ink break-all hover:border-accent"
                title="Clic para copiar"
                onClick={() => { void navigator.clipboard?.writeText(DEB_UBUNTU_ONELINER); }}
              >
                {DEB_UBUNTU_ONELINER}
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Diagnóstico del sistema</p>
              {diagLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner />
                  Verificando componentes...
                </div>
              ) : (
                <div className="space-y-1.5">
                  {diagData?.checks.map((c) => (
                    <div key={c.nombre} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                      <span className="mt-0.5 text-base leading-none">{c.ok ? "✅" : "❌"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink">{c.nombre}</p>
                        {c.detalle && <p className="truncate text-[10px] text-muted">{c.detalle}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {diagData?.usb_detectado && (
              <Banner tone="success" className="text-xs">
                Impresora USB detectada: <span className="font-mono">{diagData.usb_detectado}</span>
              </Banner>
            )}

            {!diagData?.usb_detectado && !diagLoading && (
              <Banner tone="warning" className="text-xs">
                Sin USB en este servidor. Si la Epson está en el PC de {SESION_JENNIFFER_LABEL}, elige{" "}
                <strong>{WINDOWS_10_PRO_LABEL}</strong>.
              </Banner>
            )}

            {remotoMsg && tab === "ubuntu" && (
              <Banner tone={instalarUbuntuMut.isError ? "danger" : "success"} className="text-xs">
                {remotoMsg}
              </Banner>
            )}
          </div>
        )}

        {tab === "windows10pro" && (
          <div className="space-y-4">
            <Banner tone="accent" className="text-xs leading-relaxed">
              Instalación para <strong>{WINDOWS_10_PRO_LABEL}</strong> en el PC de {SESION_JENNIFFER_LABEL}:
              driver Epson oficial → compartir <span className="font-mono">{WINDOWS_10_PRO_SHARE}</span> (SMB) →
              conectar desde el panel.
            </Banner>

            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Driver para este SO</p>
              <p className="mt-1 text-sm font-semibold text-ink">Epson ColorWorks CW-C4000 · {WINDOWS_10_PRO_LABEL} 64-bit</p>
              <a
                href={DRIVER_EPSON_WINDOWS_10_PRO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex text-xs font-semibold text-accent underline"
              >
                Descargar driver Windows 10 Pro
              </a>
              <p className="mt-1 text-[10px] text-muted">
                También:{" "}
                <a href={DRIVER_EPSON_WINDOWS_URL} target="_blank" rel="noopener noreferrer" className="underline">
                  página general Epson CW-C4000
                </a>
              </p>
            </div>

            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Script en el PC Windows (no uses la IP 192.168.1.8)
              </p>
              <a
                href={SCRIPT_WINDOWS_PS1_PUBLIC}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-xs font-semibold text-accent underline"
              >
                Descargar configurar_compartir_windows.ps1 (URL pública)
              </a>
              <p className="text-[10px] text-muted">
                También:{" "}
                <a href={SCRIPT_WINDOWS_PS1_URL} download="configurar_compartir_windows.ps1" className="underline text-accent">
                  descarga relativa
                </a>
              </p>

              <label className="mt-2 flex items-start gap-2 rounded border border-border bg-surface px-2.5 py-2 text-[11px] text-ink-secondary">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={usarTailscale}
                  onChange={(e) => setUsarTailscale(e.target.checked)}
                />
                <span>
                  <strong>Sede en otra red (ej. Sede Sur)</strong> — sin LAN/VPN corporativa
                  hacia este servidor. El script instala y une <strong>Tailscale</strong> y al
                  final reporta la IP a usar (no la de LAN).
                </span>
              </label>

              {usarTailscale && (
                <div className="rounded border border-border bg-surface p-2 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted">
                    PCs ya conectados por Tailscale — clic para usar su IP
                  </p>
                  {peersLoading && (
                    <div className="flex items-center gap-2 text-[10px] text-muted">
                      <Spinner size="sm" /> Buscando...
                    </div>
                  )}
                  {!peersLoading && (tailscalePeers?.peers?.length ?? 0) === 0 && (
                    <p className="text-[10px] text-muted">
                      Ninguno visible todavía. Corre el script en el PC Windows con{" "}
                      <span className="font-mono">-Tailscale</span> e inicia sesión con la
                      cuenta del tailnet; aparecerá aquí en unos segundos.
                    </p>
                  )}
                  {tailscalePeers?.peers?.map((p) => (
                    <button
                      key={p.ip}
                      type="button"
                      onClick={() => setHostWin(p.ip)}
                      className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition ${
                        hostWin === p.ip
                          ? "border-accent bg-accent/5"
                          : "border-border hover:border-accent/40"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-ink">
                        <span>{p.online ? "🟢" : "⚪"}</span>
                        {p.hostname}
                        <span className="text-muted">({p.os || "?"})</span>
                      </span>
                      <span className="font-mono text-muted">{p.ip}</span>
                    </button>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-muted leading-relaxed">
                O en PowerShell <strong>como Administrador</strong>:
              </p>
              <button
                type="button"
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-left font-mono text-[10px] text-ink break-all hover:border-accent"
                title="Clic para copiar"
                onClick={() => {
                  void navigator.clipboard?.writeText(scriptOneliner);
                }}
              >
                {scriptOneliner}
              </button>
              <p className="text-[10px] text-muted">Clic en el comando para copiarlo.</p>
            </div>

            <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-secondary">
              <li>
                Descargar el script (enlace de arriba) o pegar el one-liner en PowerShell Admin
              </li>
              <li>Instalar el driver Epson para Windows 10 Pro</li>
              <li>USB + LCD Listo → el script comparte como <span className="font-mono">{WINDOWS_10_PRO_SHARE}</span></li>
              <li>
                Anotar la IP que muestra el script ({usarTailscale ? "IP de Tailscale" : "IP de LAN"}) → aquí pulsar{" "}
                <strong>Instalar {WINDOWS_10_PRO_LABEL}</strong>
              </li>
            </ol>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">
                  IP del PC ({WINDOWS_10_PRO_LABEL})
                </label>
                <input
                  type="text"
                  value={hostWin}
                  onChange={(e) => setHostWin(e.target.value)}
                  placeholder={WINDOWS_10_PRO_HOST_DEFAULT}
                  className="h-9 w-full rounded border border-border bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">Nombre compartido</label>
                <input
                  type="text"
                  value={shareWin}
                  onChange={(e) => setShareWin(e.target.value)}
                  placeholder={WINDOWS_10_PRO_SHARE}
                  className="h-9 w-full rounded border border-border bg-surface px-2.5 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
            </div>
            {(remotoGet?.uri_actual || remotoGet?.remoto?.uri) && (
              <p className="text-[11px] text-muted">
                URI actual:{" "}
                <span className="font-mono text-ink">
                  {remotoGet?.uri_actual || remotoGet?.remoto?.uri}
                </span>
                {modoRedOk ? ` · ${WINDOWS_10_PRO_LABEL} activo` : ""}
                {remotoGet?.remoto?.sistema_operativo
                  ? ` · SO: ${remotoGet.remoto.sistema_operativo}`
                  : ""}
              </p>
            )}
            {remotoMsg && (
              <Banner tone={remotoMut.isError || desinstalarMut.isError ? "danger" : "success"} className="text-xs">
                {remotoMsg}
              </Banner>
            )}
            {pasosWin.length > 0 && (
              <ol className="list-decimal space-y-1 rounded-lg border border-border bg-surface p-3 pl-7 text-[11px] text-ink-secondary">
                {pasosWin.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            )}

            <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                  Conectividad en línea
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={diagRedFetching}
                  onClick={() => { void refetchDiagRed(); }}
                >
                  Verificar conectividad
                </Button>
              </div>

              {diagRed?.actual && (
                <Banner
                  tone={diagRed.actual.ok === true ? "success" : diagRed.actual.ok === false ? "danger" : "warning"}
                  className="text-xs"
                >
                  {diagRed.actual.mensaje}
                  {diagRed.actual.host ? ` · ${diagRed.actual.host}` : ""}
                </Banner>
              )}

              {!diagRed && (
                <p className="text-[10px] text-muted">
                  Pulsa «Verificar conectividad» para probar en vivo si el PC remoto responde
                  (SMB/IPP) y guardar el resultado en el historial de diagnóstico.
                </p>
              )}

              {diagRed && diagRed.historial.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted">Historial (más reciente primero)</p>
                  <div className="max-h-32 overflow-y-auto rounded border border-border">
                    {diagRed.historial.map((h, i) => (
                      <div
                        key={`${h.verificado_at}-${i}`}
                        className="flex items-start gap-2 border-b border-border px-2 py-1 text-[10px] last:border-b-0"
                      >
                        <span className="mt-0.5">{h.ok === true ? "✅" : h.ok === false ? "❌" : "⚠️"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-ink">{h.mensaje}</p>
                          <p className="truncate text-muted">
                            {h.verificado_at}
                            {h.detalle ? ` · ${h.detalle}` : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {instalLog.length > 0 && (
          <div className="rounded-lg border border-border bg-surface">
            <p className="border-b border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">Log</p>
            <div className="max-h-40 overflow-y-auto p-3 font-mono text-[11px] text-ink space-y-0.5">
              {instalLog.map((l, i) => (
                <div key={i} className={l.startsWith("✗") || l.startsWith("⚠") || l.startsWith("Error") ? "text-warning" : ""}>{l}</div>
              ))}
            </div>
          </div>
        )}

        {todoOk && !instalarUbuntuMut.isPending && tab === "ubuntu" && (
          <Banner tone="success" className="justify-center text-center text-sm font-semibold">
            ✅ Ubuntu listo (USB / .deb)
          </Banner>
        )}
        {modoRedOk && tab === "windows10pro" && !remotoMut.isPending && (
          <Banner tone="success" className="justify-center text-center text-sm font-semibold">
            ✅ Instalado para {WINDOWS_10_PRO_LABEL} (SMB)
          </Banner>
        )}
      </div>
    </Modal>
  );
}

// ── Hook debounce ─────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return deb;
}

// ── Tab: edición directa de texto dentro del PDF ──────────────────────────────

interface EditarPDFTabProps {
  rutaPdf: string;
  onGuardado: (nuevaRuta: string, nuevoNombre: string) => void;
}

function EditarPDFTab({ rutaPdf, onGuardado }: EditarPDFTabProps) {
  const [spans, setSpans] = useState<SpanPDF[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [guardandoModo, setGuardandoModo] = useState<"original" | "nuevo">("nuevo");
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const { isLoading, error, refetch } = useQuery({
    queryKey: ["extraer-texto-pdf", rutaPdf],
    queryFn: async () => {
      const data = await api.get<{ spans: SpanPDF[]; total: number }>(
        `/api/etiquetas/extraer-texto?ruta_pdf=${encodeURIComponent(rutaPdf)}`,
      );
      setSpans(data.spans);
      return data;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; ruta: string; nombre: string; cambios: number }>(
        "/api/etiquetas/guardar-pdf-editado",
        { ruta_pdf: rutaPdf, spans, modo: guardandoModo },
      ),
    onSuccess: (res) => {
      setResultado({ ok: true, msg: `✅ Guardado: ${res.nombre} (${res.cambios} cambio${res.cambios !== 1 ? "s" : ""})` });
      onGuardado(res.ruta, res.nombre);
      refetch();
    },
    onError: (err) => {
      setResultado({ ok: false, msg: `❌ ${err.message}` });
    },
  });

  const cambiosCount = spans.filter((s) => s.texto_editado !== s.texto_original).length;

  function updateSpan(id: string, texto: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: texto } : s)));
    setResultado(null);
  }

  function resetSpan(id: string) {
    setSpans((prev) => prev.map((s) => (s.id === id ? { ...s, texto_editado: s.texto_original } : s)));
  }

  function resetTodo() {
    setSpans((prev) => prev.map((s) => ({ ...s, texto_editado: s.texto_original })));
    setResultado(null);
  }

  const spansFiltrados = spans.filter(
    (s) => !busqueda || s.texto_original.toLowerCase().includes(busqueda.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
        <Spinner size="lg" />
        <span className="text-xs">Extrayendo texto del PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Banner tone="danger" className="rounded-paper-lg px-4 py-4 text-sm">
        Error al leer el PDF: {(error as Error).message}
      </Banner>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barra superior */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar texto en la etiqueta..."
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent placeholder:text-muted/50"
        />
        {cambiosCount > 0 && (
          <button onClick={resetTodo} className="text-xs text-muted hover:text-danger whitespace-nowrap">
            Revertir todo
          </button>
        )}
        <span className="text-[10px] text-muted whitespace-nowrap">{spans.length} textos</span>
      </div>

      {/* Lista de spans */}
      <div className="max-h-[340px] overflow-y-auto space-y-1 pr-1">
        {spansFiltrados.map((span) => {
          const modificado = span.texto_editado !== span.texto_original;
          return (
            <div
              key={span.id}
              className={`rounded-lg border px-3 py-2 transition ${
                modificado ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Badge de fuente + tamaño */}
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-hover text-muted">
                      {span.font_name.split("-").slice(-1)[0] || span.font_name}
                    </span>
                    <span className="text-[9px] text-muted">{span.font_size.toFixed(1)}pt</span>
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-border flex-shrink-0"
                      style={{ backgroundColor: span.color_hex }}
                      title={span.color_hex}
                    />
                    {!span.font_file && (
                      <span className="text-[9px] text-warning" title="Fuente no encontrada en el sistema — se usará Helvetica">⚠ fuente approx.</span>
                    )}
                  </div>
                  <ProseTextarea
                    value={span.texto_editado}
                    onChange={(e) => updateSpan(span.id, e.target.value)}
                    rows={span.texto_editado.split("\n").length}
                    className="w-full rounded border border-border bg-surface-input px-2 py-1 text-xs text-ink outline-none focus:border-accent resize-none font-mono leading-relaxed"
                    style={{ minHeight: "28px" }}
                  />
                  {modificado && (
                    <p className="mt-0.5 text-[9px] text-muted line-through opacity-60 truncate">
                      Original: {span.texto_original}
                    </p>
                  )}
                </div>
                {modificado && (
                  <button
                    onClick={() => resetSpan(span.id)}
                    className="mt-5 flex-shrink-0 text-[10px] text-muted hover:text-danger"
                    title="Revertir este campo"
                  >
                    ↩
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {spansFiltrados.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "Sin texto extraído"}
          </p>
        )}
      </div>

      {/* Resultado y botón guardar */}
      {resultado && (
        <Banner tone={resultado.ok ? "success" : "danger"} className="text-xs font-medium">
          {resultado.msg}
        </Banner>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <div className="flex gap-1 flex-shrink-0">
          {(["nuevo", "original"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setGuardandoModo(m)}
              className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition ${
                guardandoModo === m
                  ? "border-accent bg-accent text-white"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              {m === "nuevo" ? "Guardar como copia" : "Sobreescribir original"}
            </button>
          ))}
        </div>
        <button
          onClick={() => guardarMut.mutate()}
          disabled={cambiosCount === 0 || guardarMut.isPending}
          className="flex-1 rounded-lg border-2 border-accent bg-accent py-2 text-xs font-bold text-white shadow-[0_2px_0_#045159] hover:bg-accent-hover active:translate-y-0.5 active:shadow-none disabled:opacity-40 transition"
        >
          {guardarMut.isPending
            ? "Guardando..."
            : cambiosCount === 0
            ? "Sin cambios"
            : `Guardar ${cambiosCount} cambio${cambiosCount !== 1 ? "s" : ""} en PDF`}
        </button>
      </div>
    </div>
  );
}

// ── Editor de datos de etiqueta ───────────────────────────────────────────────

function nuevoCampo(): CampoTexto {
  return {
    id: Math.random().toString(36).slice(2, 9),
    etiqueta: "Campo nuevo",
    texto: "",
    x_pct: 5,
    y_pct: 10,
    font_size: 8,
    font_variant: "regular",
    bold: false,
    align: "left",
    ortografia: true,
    fondo_blanco: false,
    color: "#000000",
    color_trazo: "#000000",
    grosor_trazo: 0,
    ancho_caja_pct: CAJA_TEXTO_CLIC_ANCHO_PCT,
    alto_caja_pct: CAJA_TEXTO_CLIC_ALTO_PCT,
  };
}

interface EditorProps {
  combo: ComboSiigo;
  datosIniciales: DatosEtiqueta;
  onGuardado: (datos: DatosEtiqueta) => void;
  onImprimir: (datos: DatosEtiqueta) => void;
  onCerrar: () => void;
}

function EditorEtiqueta({ combo, datosIniciales, onGuardado, onImprimir, onCerrar }: EditorProps) {
  const qc = useQueryClient();
  const [mostrarNavegador, setMostrarNavegador] = useState(false);
  const [tabEditor, setTabEditor] = useState<EditorRibbonTab>("inicio");
  const [campoExpandido, setCampoExpandido] = useState<string | null>(null);
  const [errorImpresion, setErrorImpresion] = useState<ErrorImpresora | null>(null);

  const lotePctInit = lotePctInicial(
    datosIniciales.lote_pos,
    datosIniciales.lote_x_pct,
    datosIniciales.lote_y_pct,
  );
  const vencPctInit = vencPctInicial(
    lotePctInit.x,
    lotePctInit.y,
    datosIniciales.venc_x_pct,
    datosIniciales.venc_y_pct,
  );
  const tipoInit = datosIniciales.tipo_etiqueta ?? ETIQUETAS_LISTA[0];
  const [mmInitW, mmInitH] = mmParaTipoEtiqueta(tipoInit, TIPOS_ETIQUETA_DEFAULT);
  const [form, setForm] = useState<DatosEtiqueta>({
    siigo_code: combo.code,
    siigo_name: combo.name,
    nombre_etiqueta: datosIniciales.nombre_etiqueta ?? combo.name,
    presentacion: datosIniciales.presentacion ?? "",
    pdf_ruta: datosIniciales.pdf_ruta ?? "",
    pdf_nombre: datosIniciales.pdf_nombre ?? "",
    lote_defecto: conPrefijoLote(datosIniciales.lote_defecto),
    vencimiento_defecto: conPrefijoExp(datosIniciales.vencimiento_defecto),
    tipo_etiqueta: tipoInit,
    ancho_mm: datosIniciales.ancho_mm ?? mmInitW,
    alto_mm: datosIniciales.alto_mm ?? mmInitH,
    forma: datosIniciales.forma ?? "Diecut_Gap",
    calidad: datosIniciales.calidad ?? "Normal",
    rotacion: rotacionValida(datosIniciales.rotacion),
    lote_pos: datosIniciales.lote_pos ?? "bottom-left",
    lote_font: datosIniciales.lote_font ?? 7,
    lote_x_pct: lotePctInit.x,
    lote_y_pct: lotePctInit.y,
    venc_x_pct: vencPctInit.x,
    venc_y_pct: vencPctInit.y,
    campos_texto: datosIniciales.campos_texto ?? [],
  });

  const set = (k: keyof DatosEtiqueta, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Debounce de campos_texto para el preview
  const camposDebounced = useDebounce(form.campos_texto, 700);
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["editor-preview", form.pdf_ruta, camposDebounced],
    queryFn: () =>
      api.post<{ imagen: string; mime: string; error?: string }>("/api/etiquetas/preview", {
        ruta_pdf: form.pdf_ruta,
        campos_texto: camposDebounced,
      }),
    enabled: !!form.pdf_ruta,
    staleTime: 0,
  });

  const guardarMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; datos: DatosEtiqueta }>(`/api/etiquetas/datos/${combo.code}`, form),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["etiquetas-datos"] });
      onGuardado(res.datos);
    },
  });

  const imprimirEditorMut = useMutation({
    mutationFn: (payload: ImpresionEtiquetaPayload) =>
      api.post<PrintResult>("/api/etiquetas/imprimir", payload, { timeoutMs: 90_000 }),
    onError: (err) => setErrorImpresion(errorDesdeExcepcion(err.message)),
  });

  function handleImprimirEditor() {
    const payload = payloadDesdeFormularioEtiqueta(form);
    if (!payload) return;
    void imprimirEditorMut.mutateAsync(payload).then((res) => {
      const err = errorDesdePrintResult(res);
      setErrorImpresion(err);
      if (!err) {
        qc.invalidateQueries({ queryKey: ["etiquetas-inventario-consumibles"] });
        onImprimir(form);
      }
    });
  }

  // ── Helpers campos de texto ───────────────────────────────────────────────

  function agregarCampo() {
    const c = nuevoCampo();
    set("campos_texto", [...(form.campos_texto ?? []), c]);
    setCampoExpandido(c.id);
  }

  const [errorCodigoVerificacion, setErrorCodigoVerificacion] = useState<string | null>(null);
  const [cargandoCodigoVerificacion, setCargandoCodigoVerificacion] = useState(false);

  async function agregarCampoCodigoVerificacion() {
    setErrorCodigoVerificacion(null);
    setCargandoCodigoVerificacion(true);
    try {
      const r = await api.get<{ ref: string; lotes: Array<{ codigo_verificacion?: string }> }>(
        `/api/lotes/${encodeURIComponent(combo.code)}`,
      );
      const codigo = r.lotes?.[0]?.codigo_verificacion;
      if (!codigo) {
        setErrorCodigoVerificacion(
          "No hay ningún lote registrado para este SKU. Regístralo primero en Fichas Técnicas (COA).",
        );
        return;
      }
      const c: CampoTexto = { ...nuevoCampo(), etiqueta: "Código verificación", texto: codigo };
      set("campos_texto", [...(form.campos_texto ?? []), c]);
      setCampoExpandido(c.id);
    } catch {
      setErrorCodigoVerificacion("No se pudo consultar el lote vigente de este SKU.");
    } finally {
      setCargandoCodigoVerificacion(false);
    }
  }

  function eliminarCampo(id: string) {
    set("campos_texto", (form.campos_texto ?? []).filter((c) => c.id !== id));
    if (campoExpandido === id) setCampoExpandido(null);
  }

  function actualizarCampo(id: string, patch: Partial<CampoTexto>) {
    set(
      "campos_texto",
      (form.campos_texto ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  function moverCampo(id: string, dir: -1 | 1) {
    const arr = [...(form.campos_texto ?? [])];
    const idx = arr.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    set("campos_texto", arr);
  }

  const campos = form.campos_texto ?? [];
  const ribbonTabs: { id: EditorRibbonTab; label: string; disabled?: boolean }[] = [
    { id: "inicio", label: "Inicio" },
    { id: "lote", label: "Lote" },
    { id: "impresion", label: "Impresión" },
    { id: "texto", label: "Overlay" },
    { id: "editar-pdf", label: "Editar PDF", disabled: !form.pdf_ruta },
  ];

  return (
    <>
      {mostrarNavegador && (
        <NavegadorArchivos
          onSeleccionar={(item) => {
            set("pdf_ruta", item.ruta_completa);
            set("pdf_nombre", item.nombre);
            setMostrarNavegador(false);
          }}
          onCerrar={() => setMostrarNavegador(false)}
        />
      )}

      <Modal
        onClose={onCerrar}
        variant="fullscreen"
        headerTone="accent"
        maxWidthClassName="max-w-[min(100vw,1440px)]"
        title={
          <>
            <p className="truncate text-sm font-bold">{combo.name}</p>
            <p className="font-mono text-[10px] opacity-75">{combo.code}</p>
          </>
        }
        headerExtra={
          form.pdf_nombre ? (
            <span className="hidden max-w-[200px] truncate text-[10px] opacity-80 sm:inline">
              📄 {form.pdf_nombre}
            </span>
          ) : undefined
        }
        footer={
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCerrar} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-hover">
              Cerrar
            </button>
            <div className="flex-1 truncate text-[10px] text-muted">
              {form.pdf_nombre ? `📄 ${form.pdf_nombre}` : "Editor de etiquetas"}
            </div>
            <Button
              variant="primary"
              size="sm"
              icon="floppyDisk"
              loading={guardarMut.isPending}
              onClick={() => guardarMut.mutate()}
            >
              Guardar
            </Button>
            <Button
              variant="success"
              size="sm"
              icon="printer"
              disabled={!form.pdf_ruta}
              loading={imprimirEditorMut.isPending}
              onClick={handleImprimirEditor}
            >
              Imprimir
            </Button>
          </div>
        }
      >
          {errorImpresion && (
            <BannerErrorImpresora
              error={errorImpresion}
              onCerrar={() => setErrorImpresion(null)}
            />
          )}

          {/* Cinta — pestañas */}
          <RibbonTabs tabs={ribbonTabs} active={tabEditor} onChange={setTabEditor} />

          {/* Cinta — herramientas por pestaña */}
          {tabEditor !== "texto" && tabEditor !== "editar-pdf" && (
            <div className="flex flex-shrink-0 flex-wrap border-b border-border bg-surface">
              {tabEditor === "inicio" && (
                <>
                  <RibbonGroup label="Archivo">
                    <BotonSubirPdfEtiqueta
                      compact
                      label="📤 Subir"
                      onSubido={(item) => {
                        set("pdf_ruta", item.ruta_completa);
                        set("pdf_nombre", item.nombre);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarNavegador(true)}
                      className={`inline-flex h-8 items-center gap-1 rounded border border-border bg-surface px-2.5 ${RIB_FONT_BTN} font-semibold text-ink hover:border-accent hover:text-accent`}
                    >
                      📂 Elegir PDF
                    </button>
                    {form.pdf_ruta && (
                      <button
                        type="button"
                        onClick={() => { set("pdf_ruta", ""); set("pdf_nombre", ""); }}
                        className={`h-8 rounded border border-border px-2 ${RIB_FONT_BTN} text-muted hover:text-danger`}
                        title="Quitar PDF"
                      >
                        ✕
                      </button>
                    )}
                    <span className={`max-w-[140px] truncate ${RIB_FONT_META} text-muted self-center`}>
                      {form.pdf_nombre || "Sin archivo"}
                    </span>
                  </RibbonGroup>
                  <RibbonGroup label="Identidad">
                    <div>
                      <label className={RIB_LBL}>Nombre</label>
                      <input
                        type="text"
                        value={form.nombre_etiqueta ?? ""}
                        onChange={(e) => set("nombre_etiqueta", e.target.value)}
                        className={RIB_INP}
                        placeholder="Nombre en etiqueta"
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Presentación</label>
                      <input
                        type="text"
                        value={form.presentacion ?? ""}
                        onChange={(e) => set("presentacion", e.target.value)}
                        className={RIB_INP}
                        placeholder="250 g"
                      />
                    </div>
                  </RibbonGroup>
                  <RibbonGroup label="Acciones">
                    <button
                      type="button"
                      onClick={() => guardarMut.mutate()}
                      disabled={guardarMut.isPending}
                      className={`inline-flex h-8 items-center gap-1 rounded border-2 border-accent bg-accent px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-50`}
                    >
                      <Icon name="floppyDisk" size={13} weight="bold" />
                      {guardarMut.isPending ? "…" : "Guardar"}
                    </button>
                    <button
                      type="button"
                      onClick={handleImprimirEditor}
                      disabled={!form.pdf_ruta || imprimirEditorMut.isPending}
                      className={`inline-flex h-8 items-center gap-1 rounded border-2 border-success bg-success px-3 ${RIB_FONT_BTN} font-bold text-white disabled:opacity-40`}
                    >
                      <Icon name="printer" size={13} weight="bold" />
                      {imprimirEditorMut.isPending ? "…" : "Imprimir"}
                    </button>
                  </RibbonGroup>
                </>
              )}
              {tabEditor === "lote" && (
                <>
                  <RibbonGroup label="Texto">
                    <div>
                      <label className={RIB_LBL}>Lote</label>
                      <input
                        type="text"
                        value={form.lote_defecto ?? LOTE_PREFIJO}
                        onChange={(e) => set("lote_defecto", editarConPrefijo(e.target.value, LOTE_PREFIJO))}
                        className={RIB_INP}
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Vencimiento</label>
                      <input
                        type="text"
                        value={form.vencimiento_defecto ?? EXP_PREFIJO}
                        onChange={(e) => set("vencimiento_defecto", editarConPrefijo(e.target.value, EXP_PREFIJO))}
                        className={RIB_INP}
                      />
                    </div>
                  </RibbonGroup>
                  <RibbonGroup label="Posición">
                    <div>
                      <label className={RIB_LBL}>X %</label>
                      <input
                        type="number"
                        min={0}
                        max={98}
                        step={0.5}
                        value={form.lote_x_pct ?? 5}
                        onChange={(e) => { set("lote_x_pct", Number(e.target.value)); set("lote_pos", "custom"); }}
                        className={`${RIB_INP} w-16`}
                      />
                    </div>
                    <div>
                      <label className={RIB_LBL}>Y %</label>
                      <input
                        type="number"
                        min={0}
                        max={98}
                        step={0.5}
                        value={form.lote_y_pct ?? 88}
                        onChange={(e) => { set("lote_y_pct", Number(e.target.value)); set("lote_pos", "custom"); }}
                        className={`${RIB_INP} w-16`}
                      />
                    </div>
                    <p className={`max-w-[120px] self-center ${RIB_FONT_HINT} leading-tight text-muted`}>
                      Arrastra en la vista previa
                    </p>
                  </RibbonGroup>
                  <RibbonGroup label="Tipografía">
                    <div className="flex min-w-[140px] flex-col gap-0.5">
                      <label className={RIB_LBL}>Tamaño · Montserrat Light</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={TAMANO_TEXTO_PT_MIN}
                          max={TAMANO_TEXTO_PT_MAX}
                          step={1}
                          value={clampTamanoTextoPt(form.lote_font ?? 7)}
                          onChange={(e) => set("lote_font", clampTamanoTextoPt(Number(e.target.value)))}
                          className="w-24 accent-accent"
                        />
                        <span className={`${RIB_FONT_BTN} font-bold text-ink`}>{clampTamanoTextoPt(form.lote_font ?? 7)}pt</span>
                      </div>
                    </div>
                  </RibbonGroup>
                </>
              )}
              {tabEditor === "impresion" && (
                <>
                  <RibbonGroup label="Formato">
                    <SelectorFormatoEtiqueta
                      readOnly
                      value={{
                        nombre: form.tipo_etiqueta ?? "",
                        anchoMm: form.ancho_mm ?? mmInitW,
                        altoMm: form.alto_mm ?? mmInitH,
                      }}
                      inputClass={RIB_INP}
                      selectClass={RIB_SEL}
                      labelClass={RIB_LBL}
                      compact
                    />
                    <RibbonSelect
                      label="Sensor"
                      value={form.forma ?? "Diecut_Gap"}
                      options={FORMAS}
                      onChange={(v) => set("forma", v)}
                    />
                    <RibbonSelect
                      label="Impresión"
                      value={form.calidad ?? "Normal"}
                      options={CALIDADES}
                      onChange={(v) => set("calidad", v)}
                    />
                    <RibbonSelect
                      label="Rotación"
                      value={form.rotacion ?? "0"}
                      options={ROTACIONES}
                      onChange={(v) => set("rotacion", v)}
                    />
                  </RibbonGroup>
                </>
              )}
            </div>
          )}

          {/* Panel secundario: overlay / editar PDF */}
          {tabEditor === "texto" && (
            <div className="max-h-[38vh] flex-shrink-0 overflow-y-auto border-b border-border bg-surface px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-ink">Campos de texto sobre la etiqueta</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void agregarCampoCodigoVerificacion()}
                    disabled={cargandoCodigoVerificacion}
                    className={`rounded border-2 border-accent px-2.5 py-1 ${RIB_FONT_BTN} font-bold text-accent hover:bg-accent hover:text-white disabled:opacity-40`}
                    title="Trae el código de verificación del lote vigente (Fichas Técnicas / COA)"
                  >
                    {cargandoCodigoVerificacion ? "Consultando…" : "+ Código verificación"}
                  </button>
                  <button
                    type="button"
                    onClick={agregarCampo}
                    className={`rounded border-2 border-accent px-2.5 py-1 ${RIB_FONT_BTN} font-bold text-accent hover:bg-accent hover:text-white`}
                  >
                    + Añadir campo
                  </button>
                </div>
              </div>
              {errorCodigoVerificacion && (
                <p className="mb-2 text-[11px] text-danger">{errorCodigoVerificacion}</p>
              )}
              {campos.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">Sin campos. Pulsa «+ Añadir campo».</p>
              ) : (
                <div className="space-y-2">
                  {campos.map((campo, idx) => {
                    const expandido = campoExpandido === campo.id;
                    return (
                      <div key={campo.id} className="rounded-lg border border-border bg-surface-panel overflow-hidden">
                        <div
                          className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-hover"
                          onClick={() => setCampoExpandido(expandido ? null : campo.id)}
                        >
                          <span className="text-sm">{expandido ? "▾" : "▸"}</span>
                          <span className="flex-1 truncate text-xs font-semibold">{campo.etiqueta || "Campo"}</span>
                          <button type="button" aria-label="Mover arriba" onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, -1); }} disabled={idx === 0} className="p-1 text-muted disabled:opacity-30">↑</button>
                          <button type="button" aria-label="Mover abajo" onClick={(e) => { e.stopPropagation(); moverCampo(campo.id, 1); }} disabled={idx === campos.length - 1} className="p-1 text-muted disabled:opacity-30">↓</button>
                          <button type="button" aria-label="Eliminar campo" onClick={(e) => { e.stopPropagation(); eliminarCampo(campo.id); }} className="p-1 text-muted hover:text-danger">✕</button>
                        </div>
                        {expandido && (
                          <div className="space-y-2 border-t border-border px-3 py-3">
                            <input type="text" value={campo.etiqueta} onChange={(e) => actualizarCampo(campo.id, { etiqueta: e.target.value })} className={RIB_INP} placeholder="Nombre del campo" />
                            <ProseTextarea value={campo.texto} onChange={(e) => actualizarCampo(campo.id, { texto: e.target.value })} rows={2} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs resize-none" />
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <label className="flex items-center gap-1"><input type="checkbox" checked={campo.bold} onChange={(e) => actualizarCampo(campo.id, { bold: e.target.checked })} className="accent-accent" /> Negrita</label>
                              <input type="color" value={campo.color} onChange={(e) => actualizarCampo(campo.id, { color: e.target.value })} className="h-6 w-8" />
                              <label className="flex items-center gap-1.5">
                                <span className="text-muted">Pt</span>
                                <input
                                  type="range"
                                  min={TAMANO_TEXTO_PT_MIN}
                                  max={TAMANO_TEXTO_PT_MAX}
                                  step={1}
                                  value={clampTamanoTextoPt(campo.font_size)}
                                  onChange={(e) => actualizarCampo(campo.id, { font_size: clampTamanoTextoPt(Number(e.target.value)) })}
                                  className="w-20 accent-accent"
                                />
                                <span className="font-mono">{clampTamanoTextoPt(campo.font_size)}</span>
                              </label>
                              <span className="text-muted">X {campo.x_pct}% Y {campo.y_pct}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {tabEditor === "editar-pdf" && form.pdf_ruta && (
            <div className="max-h-[38vh] flex-shrink-0 overflow-y-auto border-b border-border bg-surface px-4 py-3">
              <EditarPDFTab
                rutaPdf={form.pdf_ruta}
                onGuardado={(nuevaRuta, nuevoNombre) => {
                  set("pdf_ruta", nuevaRuta);
                  set("pdf_nombre", nuevoNombre);
                }}
              />
            </div>
          )}

          {/* Lienzo — vista previa */}
          <div className="flex min-h-0 flex-1 flex-col bg-surface-hover/25">
            {form.pdf_ruta ? (
              <>
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface-panel/80 px-4 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Documento</span>
                  <span className="font-mono text-[10px] text-muted">
                    Lote X {(form.lote_x_pct ?? 5).toFixed(1)}% · Y {(form.lote_y_pct ?? 88).toFixed(1)}%
                    {" · "}Venc. X {(form.venc_x_pct ?? form.lote_x_pct ?? 5).toFixed(1)}% · Y{" "}
                    {(form.venc_y_pct ?? 94).toFixed(1)}%
                    {previewLoading && " · actualizando…"}
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-auto p-3">
                  <VistaPreviaConLote
                    imagen={previewData?.imagen}
                    mime={previewData?.mime}
                    loading={previewLoading}
                    loteText={loteParaEtiqueta(form.lote_defecto)}
                    vencText={expParaEtiqueta(form.vencimiento_defecto)}
                    loteFont={form.lote_font ?? 7}
                    loteXPct={form.lote_x_pct ?? 5}
                    loteYPct={form.lote_y_pct ?? 88}
                    vencXPct={form.venc_x_pct ?? form.lote_x_pct ?? 5}
                    vencYPct={form.venc_y_pct ?? 94}
                    imgClassName={PREVIEW_IMG_LARGE}
                    containerClassName={PREVIEW_CONTAINER_LARGE}
                    onLotePositionChange={(x, y) => {
                      setForm((f) => ({ ...f, lote_x_pct: x, lote_y_pct: y, lote_pos: "custom" }));
                    }}
                    onVencPositionChange={(x, y) => {
                      setForm((f) => ({ ...f, venc_x_pct: x, venc_y_pct: y }));
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium text-muted">Sin PDF asociado</p>
                <p className="text-xs text-muted">Pestaña <strong>Inicio</strong> → Archivo → Elegir PDF</p>
                <button type="button" onClick={() => { setTabEditor("inicio"); setMostrarNavegador(true); }} className="mt-2 rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent hover:bg-accent hover:text-white">
                  📂 Elegir PDF
                </button>
              </div>
            )}
          </div>
      </Modal>
    </>
  );
}

// ── Tab: Configurar Productos ─────────────────────────────────────────────────

function TabConfigurar() {
  const [busqueda, setBusqueda] = useState("");
  const busquedaDebounced = useDebounce(busqueda, 500);
  const [comboSeleccionado, setComboSeleccionado] = useState<ComboSiigo | null>(null);
  const [meliDraft, setMeliDraft] = useState<Record<string, string>>({});
  const [meliVinculadoLocal, setMeliVinculadoLocal] = useState<Record<string, string>>({});
  const [estadoLocal, setEstadoLocal] = useState<Record<string, EstadoMeliConfig>>({});
  const [vinculandoSku, setVinculandoSku] = useState<string | null>(null);
  const [errorVinculo, setErrorVinculo] = useState<{ sku: string; msg: string } | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<FiltroConfigProductos>("todos");

  const { data: combosData, isLoading: cargandoCombos, error: errorCombos } = useQuery({
    queryKey: ["combos-siigo", busquedaDebounced],
    queryFn: () =>
      api.get<{ combos: ComboSiigo[]; total: number }>(
        `/api/etiquetas/combos-siigo${busquedaDebounced ? `?q=${encodeURIComponent(busquedaDebounced)}` : ""}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  const guardarMut = useGuardarPublicacion();

  function cfgCombo(c: ComboSiigo) {
    const meli = meliVinculadoLocal[c.code] ?? c.meli_id ?? "";
    const estado = estadoLocal[c.code] ?? c.estado_meli_config ?? "";
    return { meli, estado };
  }

  const combos = combosData?.combos ?? [];
  const combosConMeli = combos.filter((c) => cfgCombo(c).meli);
  const combosPorPublicar = combos.filter(
    (c) => !cfgCombo(c).meli && cfgCombo(c).estado === "por_publicar",
  );
  const combosOmitidos = combos.filter(
    (c) => !cfgCombo(c).meli && cfgCombo(c).estado === "omitir",
  );
  const combosPendientes = combos.filter((c) => {
    const { meli, estado } = cfgCombo(c);
    return !meli && estado !== "omitir" && estado !== "por_publicar";
  });

  const combosVisibles = useMemo(() => {
    switch (filtroCategoria) {
      case "con_meli":
        return combosConMeli;
      case "por_publicar":
        return combosPorPublicar;
      case "omitidos":
        return combosOmitidos;
      case "pendientes":
        return combosPendientes;
      default:
        return combos;
    }
  }, [filtroCategoria, combos, combosConMeli, combosPorPublicar, combosOmitidos, combosPendientes]);

  function renderComboItem(c: ComboSiigo) {
    const { meli, estado } = cfgCombo(c);
    if (meli) return renderComboConfigurado(c);
    if (estado === "por_publicar") return renderComboMarcado(c, "por_publicar");
    if (estado === "omitir") return renderComboMarcado(c, "omitir");
    return renderComboSinConfigurar(c);
  }

  function toggleFiltroCategoria(cat: FiltroConfigProductos) {
    setFiltroCategoria((prev) => (prev === cat ? "todos" : cat));
  }

  function claseTarjetaFiltro(activo: boolean, extra = "") {
    return `rounded-xl border px-4 py-3 text-center transition cursor-pointer select-none ${
      activo
        ? "border-accent bg-accent/10 ring-2 ring-accent/25 shadow-sm"
        : "border-border bg-surface-panel hover:border-accent/40 hover:bg-surface-hover"
    } ${extra}`;
  }

  async function vincularMeli(sku: string) {
    const id = (meliDraft[sku] ?? "").trim();
    if (!id) return;
    setVinculandoSku(sku);
    setErrorVinculo(null);
    try {
      const res = await guardarMut.mutateAsync({ sku, campos: { meli_item_id: id } });
      const guardado =
        (res as { override?: { meli_item_id?: string } })?.override?.meli_item_id?.trim() || id;
      setMeliVinculadoLocal((prev) => ({ ...prev, [sku]: guardado }));
      setMeliDraft((prev) => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
    } catch (e) {
      setErrorVinculo({ sku, msg: (e as Error)?.message ?? "No se pudo vincular" });
    } finally {
      setVinculandoSku(null);
    }
  }

  function renderComboMarcado(c: ComboSiigo, tipo: "por_publicar" | "omitir") {
    const esPorPublicar = tipo === "por_publicar";
    return (
      <div
        key={c.code}
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          esPorPublicar
            ? "border-warning/30 bg-warning/10"
            : "border-border bg-surface"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{c.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted">{c.code}</span>
            <span
              className={`text-[10px] font-semibold ${
                esPorPublicar ? "text-warning" : "text-muted"
              }`}
            >
              {esPorPublicar ? "Por publicar" : "Omitido"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setComboSeleccionado(c)}
          className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-ink"
        >
          Más opciones
        </button>
      </div>
    );
  }

  function renderComboConfigurado(c: ComboSiigo) {
    const meliId = cfgCombo(c).meli;

    return (
      <div
        key={c.code}
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:bg-surface-hover group"
        onClick={() => setComboSeleccionado(c)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{c.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted">{c.code}</span>
            <span className="text-[10px] font-medium text-accent">MeLi {meliId}</span>
          </div>
        </div>
        <span className="text-xs text-muted transition group-hover:text-accent">Editar →</span>
      </div>
    );
  }

  function renderComboSinConfigurar(c: ComboSiigo) {
    const { meli } = cfgCombo(c);
    if (meli) return renderComboConfigurado(c);

    const draft = meliDraft[c.code] ?? "";
    const guardando = vinculandoSku === c.code && guardarMut.isPending;

    return (
      <div
        key={c.code}
        className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 min-w-0">
          <p className="truncate text-sm font-medium text-ink">{c.name}</p>
          <span className="font-mono text-[10px] text-muted">{c.code}</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={draft}
            onChange={(e) => setMeliDraft((prev) => ({ ...prev, [c.code]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void vincularMeli(c.code);
            }}
            placeholder="ID publicación MeLi (MCO… o solo números)"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none placeholder:text-muted/50 focus:border-accent"
          />
          <button
            type="button"
            disabled={!draft.trim() || guardando}
            onClick={() => void vincularMeli(c.code)}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white transition hover:bg-accent-hover disabled:opacity-40"
          >
            {guardando ? "Vinculando…" : "Vincular MeLi"}
          </button>
          <button
            type="button"
            onClick={() => setComboSeleccionado(c)}
            className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-ink"
          >
            Más opciones
          </button>
        </div>
        {errorVinculo?.sku === c.code && (
          <p className="mt-1.5 text-xs text-danger">{errorVinculo.msg}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Barra de búsqueda */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto Alegra Combo..."
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent placeholder:text-muted/50 pr-10"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        {cargandoCombos && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Spinner />
          </span>
        )}
      </div>

      {/* Resumen — clic para filtrar lista */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => setFiltroCategoria("todos")}
          className={claseTarjetaFiltro(filtroCategoria === "todos")}
        >
          <p className="text-xl font-extrabold text-ink">{combos.length}</p>
          <p className="text-xs text-muted mt-0.5">Combos Alegra</p>
        </button>
        <button
          type="button"
          onClick={() => toggleFiltroCategoria("con_meli")}
          className={claseTarjetaFiltro(filtroCategoria === "con_meli")}
        >
          <p className="text-xl font-extrabold text-success">{combosConMeli.length}</p>
          <p className="text-xs text-muted mt-0.5">Con MeLi</p>
        </button>
        <button
          type="button"
          onClick={() => toggleFiltroCategoria("por_publicar")}
          className={claseTarjetaFiltro(filtroCategoria === "por_publicar")}
        >
          <p className="text-xl font-extrabold text-warning">{combosPorPublicar.length}</p>
          <p className="text-xs text-muted mt-0.5">Por publicar</p>
        </button>
        <button
          type="button"
          onClick={() => toggleFiltroCategoria("omitidos")}
          className={claseTarjetaFiltro(filtroCategoria === "omitidos")}
        >
          <p className="text-xl font-extrabold text-muted">{combosOmitidos.length}</p>
          <p className="text-xs text-muted mt-0.5">Omitidos</p>
        </button>
        <button
          type="button"
          onClick={() => toggleFiltroCategoria("pendientes")}
          className={claseTarjetaFiltro(filtroCategoria === "pendientes", "col-span-2 sm:col-span-1")}
        >
          <p className="text-xl font-extrabold text-warning">{combosPendientes.length}</p>
          <p className="text-xs text-muted mt-0.5">Pendientes</p>
        </button>
      </div>

      {filtroCategoria !== "todos" && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <p className="text-xs text-ink">
            Mostrando:{" "}
            <span className="font-semibold">
              {filtroCategoria === "con_meli" && "Con MeLi vinculado"}
              {filtroCategoria === "por_publicar" && "Por publicar en MeLi"}
              {filtroCategoria === "omitidos" && "Omitidos"}
              {filtroCategoria === "pendientes" && "Pendientes"}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setFiltroCategoria("todos")}
            className="shrink-0 text-xs font-semibold text-accent hover:underline"
          >
            Ver todos
          </button>
        </div>
      )}

      {errorCombos && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Error cargando productos: {(errorCombos as Error).message}
        </div>
      )}

      {/* Lista */}
      {combos.length === 0 && !cargandoCombos && !errorCombos && (
        <div className="rounded-xl border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted">
            {busqueda ? `Sin resultados para "${busqueda}"` : "No se encontraron combos Alegra"}
          </p>
        </div>
      )}

      {combos.length > 0 && (
        <div className="space-y-2">
          {combosVisibles.length > 0 ? (
            combosVisibles.map(renderComboItem)
          ) : (
            <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted">
              {filtroCategoria === "con_meli" && "No hay productos con MeLi vinculado"}
              {filtroCategoria === "por_publicar" && "No hay productos marcados por publicar"}
              {filtroCategoria === "omitidos" && "No hay productos omitidos"}
              {filtroCategoria === "pendientes" && "No hay productos pendientes"}
            </p>
          )}
        </div>
      )}

      {/* Editor de catálogo (condiciones, características, precios/stock) */}
      {comboSeleccionado && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6">
          <div className="my-auto w-full max-w-2xl rounded-2xl border border-border bg-surface-panel p-4 shadow-2xl sm:p-5">
            <EditorPanel
              sku={comboSeleccionado.code}
              layout="config-productos"
              onClose={() => setComboSeleccionado(null)}
              onEstadoMarcado={(estado: EstadoMeliConfig) =>
                setEstadoLocal((prev) => ({ ...prev, [comboSeleccionado.code]: estado }))
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}


// ── Pedidos de etiquetas → Solicitudes ────────────────────────────────────────

interface SolicitudEtiquetaRow extends SolicitudEtiquetaBasica {}

async function ticketsApi(path: string, token: string, options: RequestInit = {}) {
  const isForm = options.body instanceof FormData;
  const hasJsonBody = options.body != null && options.body !== "" && !isForm;
  const method = (options.method ?? "GET").toUpperCase();
  let url = `/api/tickets${path}`;
  if (method === "GET" || method === "HEAD") {
    url += `${path.includes("?") ? "&" : "?"}_t=${Date.now()}`;
  }
  const r = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Pragma: "no-cache",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return {};
  }
  if (!r.ok) throw new Error((data as { error?: string })?.error || `Error ${r.status}`);
  return data;
}

interface ItemPedidoEtiqueta {
  id: number;
  nombre: string;
  cantidad: number;
  unidad: string;
  comprado: number;
  notas: string | null;
}

function mapItemsPedido(raw: unknown[]): ItemPedidoEtiqueta[] {
  return raw.map((row) => {
    const r = row as ItemPedidoEtiqueta & { material_nombre?: string };
    return {
      ...r,
      nombre: (r.nombre || r.material_nombre || "").trim(),
    };
  });
}

function ChecklistPedidoEtiquetas({
  pedido,
  token,
  onVolver,
  onActualizado,
  onAplicarLinea,
}: {
  pedido: SolicitudEtiquetaRow;
  token: string;
  onVolver?: () => void;
  onActualizado?: () => void;
  onAplicarLinea?: (pedido: SolicitudEtiquetaRow, linea: ReturnType<typeof parseLineasPedidoEtiqueta>[number]) => void;
}) {
  const ticketsUser = useTicketsAuth((s) => s.user);
  const [items, setItems] = useState<ItemPedidoEtiqueta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notaEditId, setNotaEditId] = useState<number | null>(null);
  const [notaDraft, setNotaDraft] = useState("");
  const resolviendoRef = useRef(false);
  const autoCierreRef = useRef(false);

  const activos = items.filter((i) => i.nombre.trim() && !esLineaProsaPedidoEtiqueta(i.nombre));
  const hechos = activos.filter((i) => !!i.comprado).length;
  const todosMarcados = activos.length > 0 && hechos === activos.length;
  const comentarioPedido = extraerComentarioPedido(pedido.descripcion || "");

  useEffect(() => {
    autoCierreRef.current = false;
  }, [pedido.id]);

  const cargarItems = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      let data = await ticketsApi(`/${pedido.id}/lista-compras`, token);
      let raw = Array.isArray(data) ? data : [];
      if (raw.length === 0 && pedido.descripcion?.trim()) {
        const lineas = parseLineasPedidoEtiqueta(pedido.descripcion);
        for (const linea of lineas) {
          await ticketsApi(`/${pedido.id}/lista-compras`, token, {
            method: "POST",
            body: JSON.stringify({
              nombre: linea.label,
              cantidad: linea.cantidad || 1,
              unidad: "und",
            }),
          });
        }
        data = await ticketsApi(`/${pedido.id}/lista-compras`, token);
        raw = Array.isArray(data) ? data : [];
      }
      setItems(mapItemsPedido(raw));
    } catch (e: unknown) {
      setItems([]);
      setMsg(e instanceof Error ? e.message : "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }, [pedido.id, pedido.descripcion, token]);

  useEffect(() => { void cargarItems(); }, [cargarItems]);

  async function toggleItem(item: ItemPedidoEtiqueta) {
    setBusy(true);
    try {
      const data = await ticketsApi(`/lista-compras/${item.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ comprado: item.comprado ? 0 : 1 }),
      });
      setItems(Array.isArray(data) ? mapItemsPedido(data) : items);
      onActualizado?.();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function guardarNota(itemId: number, notas: string) {
    setBusy(true);
    try {
      const data = await ticketsApi(`/lista-compras/${itemId}`, token, {
        method: "PUT",
        body: JSON.stringify({ notas: notas.trim() || null }),
      });
      setItems(Array.isArray(data) ? mapItemsPedido(data) : items);
      setNotaEditId(null);
      onActualizado?.();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  async function resolverPedido(force = false) {
    if (resolviendoRef.current) return;
    if (!force && activos.length > 0 && !todosMarcados) return;
    resolviendoRef.current = true;
    setBusy(true);
    setMsg("");
    try {
      const nombre = ticketsUser?.nombre || "Operador";
      await ticketsApi(`/${pedido.id}/comentarios`, token, {
        method: "POST",
        body: JSON.stringify({
          texto: `✅ Pedido de etiquetas completado por ${nombre} (${activos.length || 1} ítem${activos.length !== 1 ? "s" : ""}).`,
          es_interno: false,
        }),
      });
      await ticketsApi(`/${pedido.id}/estado`, token, {
        method: "PUT",
        body: JSON.stringify({ estado: "resuelto" }),
      });
      onActualizado?.();
      setMsg("✅ Pedido completado");
    } catch (e: unknown) {
      autoCierreRef.current = false;
      setMsg(e instanceof Error ? e.message : "Error al cerrar el pedido");
    } finally {
      setBusy(false);
      resolviendoRef.current = false;
    }
  }

  useEffect(() => {
    if (loading || busy || !todosMarcados || autoCierreRef.current) return;
    autoCierreRef.current = true;
    void resolverPedido();
  }, [items, loading, busy, todosMarcados]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        {onVolver && (
          <button type="button" onClick={onVolver} className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-bold text-muted hover:border-accent">
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{pedido.titulo || "Pedido de etiquetas"}</p>
          <p className="text-[10px] text-muted">
            {pedido.numero ?? `#${pedido.id}`}
            {pedido.creado_por_nombre ? ` · de ${pedido.creado_por_nombre}` : ""}
          </p>
        </div>
        {activos.length > 0 && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-[10px] font-black text-accent">
            {hechos}/{activos.length}
          </span>
        )}
      </div>

      {comentarioPedido && (
        <div className="rounded-xl border-2 border-dashed border-border px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-accent mb-1">Comentarios</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{comentarioPedido}</p>
        </div>
      )}

      {loading && <p className="py-6 text-center text-sm text-muted italic">Cargando lista…</p>}

      {!loading && activos.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted">
          Este pedido no tiene ítems en la lista.
        </p>
      )}

      {!loading && activos.map((item) => {
        const linea = {
          label: item.nombre,
          cantidad: Math.max(1, Math.floor(Number(item.cantidad) || 1)),
          tipoEtiqueta: inferirTipoEtiqueta(item.nombre),
        };
        const editandoNota = notaEditId === item.id;
        return (
          <div
            key={item.id}
            className={`rounded-xl border-2 transition ${item.comprado ? "border-accent/40 bg-accent/5" : "border-border bg-surface"}`}
          >
            <div className="flex items-start gap-3 px-3 py-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleItem(item)}
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold transition
                  ${item.comprado ? "border-accent bg-accent text-white" : "border-border text-muted hover:border-accent"}`}
              >
                {item.comprado ? "✓" : ""}
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onAplicarLinea?.(pedido, linea)}
                  className="w-full text-left"
                  title="Usar en impresión"
                >
                  <p className={`text-sm font-bold ${item.comprado ? "text-accent line-through" : "text-ink"}`}>
                    {item.nombre}
                    {fmtUnidadesEtiqueta(item.cantidad) && (
                      <span className="ml-1.5 font-semibold text-accent">· {fmtUnidadesEtiqueta(item.cantidad)}</span>
                    )}
                  </p>
                  {linea.tipoEtiqueta && (
                    <p className="text-[10px] text-muted">Formato sugerido: {linea.tipoEtiqueta}</p>
                  )}
                </button>
                {item.notas && !editandoNota && (
                  <p className="mt-1 text-xs italic text-muted">📝 {item.notas}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editandoNota) {
                    setNotaEditId(null);
                    return;
                  }
                  setNotaEditId(item.id);
                  setNotaDraft(item.notas || "");
                }}
                className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold transition
                  ${editandoNota || item.notas ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-hover"}`}
                title="Anotación"
              >
                📝
              </button>
            </div>
            {editandoNota && (
              <div className="border-t border-border/60 px-3 pb-3 pt-2">
                <input
                  type="text"
                  autoFocus
                  value={notaDraft}
                  onChange={(e) => setNotaDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void guardarNota(item.id, notaDraft);
                    }
                    if (e.key === "Escape") setNotaEditId(null);
                  }}
                  onBlur={() => void guardarNota(item.id, notaDraft)}
                  placeholder="Anotación sobre este ítem…"
                  className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-ink outline-none focus:border-accent"
                />
              </div>
            )}
          </div>
        );
      })}

      {msg && (
        <p className={`text-center text-xs font-semibold ${msg.startsWith("✅") ? "text-accent" : "text-danger"}`}>
          {msg}
        </p>
      )}
      {!loading && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          {activos.length > 0 && (
            <p className="text-center text-[10px] text-muted">
              Marca cada ítem al imprimirlo · 📝 para anotar
              {todosMarcados ? " · listo para cerrar" : ` · ${hechos}/${activos.length} impresos`}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (activos.length > 0 && !todosMarcados) {
                const faltan = activos.length - hechos;
                if (!window.confirm(`Faltan ${faltan} ítem${faltan !== 1 ? "s" : ""} sin marcar. ¿Cerrar el pedido igual?`)) return;
                void resolverPedido(true);
                return;
              }
              void resolverPedido(true);
            }}
            className="w-full rounded-xl bg-accent py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Cerrando…" : "✅ Cerrar pedido"}
          </button>
        </div>
      )}
    </div>
  );
}

function ModalPedidosEtiquetasEnCurso({
  onCerrar,
  onActualizado,
  onAplicarLinea,
}: {
  onCerrar: () => void;
  onActualizado?: () => void;
  onAplicarLinea?: (pedido: SolicitudEtiquetaRow, linea: ReturnType<typeof parseLineasPedidoEtiqueta>[number]) => void;
}) {
  const token = panelBearerToken();
  const ticketsUser = useTicketsAuth((s) => s.user);
  const [pendientes, setPendientes] = useState<SolicitudEtiquetaRow[]>([]);
  const [pedidoSel, setPedidoSel] = useState<SolicitudEtiquetaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("Inicia sesión en el Centro de Mando para ver pedidos.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const sols = await ticketsApi("/?tipo=solicitud&activas=1", token) as SolicitudEtiquetaRow[];
      const filtradas = (Array.isArray(sols) ? sols : [])
        .filter(esSolicitudEtiqueta)
        .filter((s) => !ticketsUser?.id || s.asignado_a === ticketsUser.id);
      setPendientes(filtradas);
      setPedidoSel((prev) => {
        if (prev && filtradas.some((p) => p.id === prev.id)) return prev;
        return filtradas.length === 1 ? filtradas[0] : null;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los pedidos");
    } finally {
      setLoading(false);
    }
  }, [token, ticketsUser?.id]);

  useEffect(() => { void cargar(); }, [cargar]);

  function handleActualizado() {
    void cargar();
    onActualizado?.();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface-panel shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border bg-accent px-4 py-3 text-white">
          <div>
            <p className="text-sm font-bold">{pedidoSel ? "Checklist del pedido" : "Pedidos en curso"}</p>
            <p className="text-[10px] opacity-80">
              {pedidoSel ? "Marca, anota y guarda el avance" : "Etiquetas asignadas a ti"}
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded px-2 py-1 text-lg leading-none hover:bg-white/15">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <Banner tone="danger" className="mb-3 text-xs">{error}</Banner>
          )}
          {loading && !pedidoSel && (
            <p className="py-8 text-center text-sm text-muted italic">Cargando…</p>
          )}
          {!loading && !pedidoSel && pendientes.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted">
              Sin pedidos de etiquetas en curso.
            </p>
          )}
          {!loading && !pedidoSel && pendientes.length > 1 && (
            <ul className="space-y-2">
              {pendientes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setPedidoSel(s)}
                    className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-left transition hover:border-accent"
                  >
                    <p className="truncate text-sm font-bold text-ink">{s.titulo || "Pedido de etiquetas"}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.numero ?? `#${s.id}`}
                      {s.creado_por_nombre ? ` · de ${s.creado_por_nombre}` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pedidoSel && token && (
            <ChecklistPedidoEtiquetas
              pedido={pedidoSel}
              token={token}
              onVolver={pendientes.length > 1 ? () => setPedidoSel(null) : undefined}
              onActualizado={handleActualizado}
              onAplicarLinea={(pedido, linea) => {
                onAplicarLinea?.(pedido, linea);
                onCerrar();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Imprimir ─────────────────────────────────────────────────────────────

type PrecargarImpresion = Partial<DatosEtiqueta>;

function normNombreEtiquetaPdf(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.(ai|pdf)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolverPdfDesdeCatalogo(
  fila: CatalogoStudioFila,
  pdfs: PdfItem[],
  datos?: { pdf_ruta?: string; pdf_nombre?: string },
): PdfItem | null {
  const vistos = new Set<string>();
  const uniq = pdfs.filter((p) => {
    if (vistos.has(p.ruta_completa)) return false;
    vistos.add(p.ruta_completa);
    return true;
  });
  const rutaDatos = (datos?.pdf_ruta || "").trim();
  if (rutaDatos) {
    const hit = uniq.find(
      (p) => p.ruta_completa === rutaDatos || p.ruta === rutaDatos || p.nombre === datos?.pdf_nombre,
    );
    if (hit) return hit;
    if (datos?.pdf_nombre) {
      return {
        nombre: datos.pdf_nombre,
        ruta: rutaDatos,
        ruta_completa: rutaDatos,
        guardado: true,
      };
    }
  }
  const hints = [fila.archivo_ai?.replace(/\.ai$/i, ""), fila.nombre, fila.sku]
    .map((h) => normNombreEtiquetaPdf(h || ""))
    .filter(Boolean);
  for (const hint of hints) {
    const hit = uniq.find((p) => {
      const np = normNombreEtiquetaPdf(p.nombre);
      return np.includes(hint) || hint.includes(np);
    });
    if (hit) return hit;
  }
  return null;
}

interface TabImprimirProps {
  precargar?: PrecargarImpresion | null;
  solicitudInicial?: EtiquetasSolicitudActiva | null;
  onPrecargarConsumido: () => void;
  onSolicitudInicialConsumida?: () => void;
  onIrInventarioTinta?: () => void;
}

function TabImprimir({
  precargar,
  solicitudInicial,
  onPrecargarConsumido,
  onSolicitudInicialConsumida,
  onIrInventarioTinta,
}: TabImprimirProps) {
  const ticketsUser = useTicketsAuth((s) => s.user);
  const ticketsToken = useTicketsAuth((s) => s.token);
  const [formato, setFormato] = useState<FormatoEtiquetaValor>(() => {
    const nombre = ETIQUETAS_LISTA[0];
    const [anchoMm, altoMm] = mmParaTipoEtiqueta(nombre, TIPOS_ETIQUETA_DEFAULT);
    return { nombre, anchoMm, altoMm };
  });
  const [forma, setForma] = useState(FORMAS[0].value);
  const [calidad, setCalidad] = useState("Normal");
  const [rotacion, setRotacion] = useState("0");
  const [cantidad, setCantidad] = useState(1);
  const [offsetV, setOffsetV] = useState(0.0);
  const [offsetH, setOffsetH] = useState(0.0);
  const [vistaImpresion, setVistaImpresion] = useState<"catalogo" | "documento">("catalogo");
  const [skuActivoImpresion, setSkuActivoImpresion] = useState("");
  const [filaActiva, setFilaActiva] = useState<CatalogoStudioFila | null>(null);
  const [studioDatos, setStudioDatos] = useState<EtiquetaStudioDatos>({ ...ETIQUETA_STUDIO_DEFAULT });
  const [lote, setLote] = useState(LOTE_PREFIJO);
  const [vencimiento, setVencimiento] = useState(EXP_PREFIJO);
  const [lotesRegistrados, setLotesRegistrados] = useState<LoteRegistrado[]>([]);
  const [lotePos, setLotePos] = useState("center");
  const [loteFont, setLoteFont] = useState(LOTE_FONT_IMPRIMIR_DEFAULT);
  const [loteXPct, setLoteXPct] = useState(LOTE_POS_PCT["center"].x);
  const [loteYPct, setLoteYPct] = useState(LOTE_POS_PCT["center"].y);
  const [vencXPct, setVencXPct] = useState(LOTE_POS_PCT["center"].x);
  const [vencYPct, setVencYPct] = useState(clampLotePct(LOTE_POS_PCT["center"].y + LOTE_EXP_GAP_PCT));
  const [matchEanPng, setMatchEanPng] = useState<CodigoEan | null | "sin-match">(null);
  const { data: codigosEan } = useCodigosEan();
  const [camposTexto, setCamposTexto] = useState<CampoTexto[]>([]);
  const [lineasPlantilla, setLineasPlantilla] = useState<LineaPlantilla[]>([]);
  const [imagenesPlantilla, setImagenesPlantilla] = useState<ImagenPlantilla[]>([]);
  const [rectangulosPlantilla, setRectangulosPlantilla] = useState<RectanguloPlantilla[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [mostrarInstalador, setMostrarInstalador] = useState(false);
  const [instaladorTab, setInstaladorTab] = useState<InstaladorTab>("windows10pro");
  const abrirInstalador = (tab: InstaladorTab = "windows10pro") => {
    setInstaladorTab(tab);
    setMostrarInstalador(true);
  };
  const [incluirLoteExp, setIncluirLoteExp] = useState(false);
  const [errorImpresion, setErrorImpresion] = useState<ErrorImpresora | null>(null);
  const [mostrarPedidoEtiquetas, setMostrarPedidoEtiquetas] = useState(false);
  const [pdfStudioRuta, setPdfStudioRuta] = useState("");
  const [pdfStudioNombre, setPdfStudioNombre] = useState("");
  const [pngImpresion, setPngImpresion] = useState<RecursoPngCatalogo | null>(null);
  const [preparandoPngImpresion, setPreparandoPngImpresion] = useState(false);
  const tokenTickets = ticketsToken || panelBearerToken();

  const { data: solicitudesImprimir = [], refetch: refetchSolicitudesImprimir } = useQuery({
    queryKey: ["etiquetas-solicitudes-imprimir", ticketsUser?.id],
    queryFn: async () => {
      if (!tokenTickets || !ticketsUser?.id) return [] as SolicitudEtiquetaRow[];
      const sols = await ticketsApi("/?tipo=solicitud&activas=1", tokenTickets) as SolicitudEtiquetaRow[];
      return (Array.isArray(sols) ? sols : [])
        .filter(esSolicitudEtiqueta)
        .filter((s) => s.asignado_a === ticketsUser.id);
    },
    refetchInterval: 20000,
    enabled: !!tokenTickets && !!ticketsUser?.id,
  });

  useEffect(() => {
    if (!solicitudInicial?.id) return;
    const lineas = parseLineasPedidoEtiqueta(solicitudInicial.descripcion || "");
    if (lineas.length > 0) {
      const linea = lineas[0];
      if (linea.tipoEtiqueta) {
        const [anchoMm, altoMm] = mmParaTipoEtiqueta(linea.tipoEtiqueta, TIPOS_ETIQUETA_DEFAULT);
        setFormato({ nombre: linea.tipoEtiqueta, anchoMm, altoMm });
        setRotacion(rotacionDefaultEtiqueta(linea.tipoEtiqueta));
      }
      if (linea.cantidad > 0) setCantidad(Math.min(999, linea.cantidad));
    }
    onSolicitudInicialConsumida?.();
  }, [solicitudInicial, onSolicitudInicialConsumida]);

  const qc = useQueryClient();
  const loteVacio = !loteParaEtiqueta(lote);
  const expVacio = !expParaEtiqueta(vencimiento);
  /** Solo avisa si el usuario activó Lote·EXP y falta dato. */
  const loteExpPendiente = incluirLoteExp && (loteVacio || expVacio);
  const loteParaImpresion = incluirLoteExp ? loteParaEtiqueta(lote) : undefined;
  const expParaImpresion = incluirLoteExp ? expParaEtiqueta(vencimiento) : undefined;

  const studioDatosImpresion = useMemo((): EtiquetaStudioDatos => {
    const pres = presentacionDesdeTipoEtiqueta(formato.nombre);
    return {
      ...studioDatos,
      modo_etiqueta: "original",
      descripcion_etiqueta: studioDatos.descripcion_etiqueta ?? "",
      tipo_etiqueta: formato.nombre,
      ancho_mm: formato.anchoMm,
      alto_mm: formato.altoMm,
      contenido_neto: pres.contenido_neto ?? studioDatos.contenido_neto,
      unidad: pres.unidad ?? studioDatos.unidad,
      lote: incluirLoteExp ? (loteParaEtiqueta(lote) || "") : "",
      vencimiento: incluirLoteExp ? (expParaEtiqueta(vencimiento) || "") : "",
      mostrar_lote_vencimiento: incluirLoteExp,
    };
  }, [studioDatos, formato, lote, vencimiento, incluirLoteExp]);

  useEffect(() => {
    if (vistaImpresion !== "documento" || !studioDatosImpresion.sku.trim()) return;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({
        sku: studioDatosImpresion.sku,
        nombre_producto: studioDatosImpresion.nombre_producto,
        ingrediente: studioDatosImpresion.ingrediente,
        contenido_neto: studioDatosImpresion.contenido_neto,
        unidad: studioDatosImpresion.unidad,
        tipo_etiqueta: studioDatosImpresion.tipo_etiqueta,
      });
      void api
        .get<{ archivo_ai?: string | null }>(`/api/etiquetas/studio/resolver-ai?${p.toString()}`)
        .then((r) => {
          if (!r.archivo_ai) return;
          const ai = r.archivo_ai;
          setStudioDatos((d) => (d.archivo_ai === ai ? d : { ...d, archivo_ai: ai }));
          setFilaActiva((f) => (f && f.archivo_ai !== ai ? { ...f, archivo_ai: ai } : f));
        })
        .catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [
    vistaImpresion,
    studioDatosImpresion.sku,
    studioDatosImpresion.tipo_etiqueta,
    studioDatosImpresion.contenido_neto,
    studioDatosImpresion.unidad,
    studioDatosImpresion.nombre_producto,
    studioDatosImpresion.ingrediente,
  ]);

  // Precargar desde configuración de producto
  useEffect(() => {
    if (!precargar) return;
    setPdfStudioRuta(precargar.pdf_ruta || "");
    setPdfStudioNombre(precargar.pdf_nombre || "");
    if (precargar.pdf_ruta) {
      setVistaImpresion("documento");
      // Lote/EXP no se precargan: el operador marca «Lote» y digita a mano.
    }
    if (precargar.tipo_etiqueta) {
      const [anchoMm, altoMm] = mmParaTipoEtiqueta(precargar.tipo_etiqueta, TIPOS_ETIQUETA_DEFAULT);
      setFormato({
        nombre: precargar.tipo_etiqueta,
        anchoMm: precargar.ancho_mm ?? anchoMm,
        altoMm: precargar.alto_mm ?? altoMm,
      });
    }
    if (precargar.forma) setForma(precargar.forma);
    if (precargar.calidad) setCalidad(precargar.calidad);
    if (precargar.rotacion) setRotacion(rotacionValida(precargar.rotacion));
    if (precargar.lote_pos) setLotePos(precargar.lote_pos);
    if (precargar.lote_font) setLoteFont(precargar.lote_font);
    const pct = lotePctInicial(precargar.lote_pos, precargar.lote_x_pct, precargar.lote_y_pct);
    setLoteXPct(pct.x);
    setLoteYPct(pct.y);
    const pctVenc = vencPctInicial(pct.x, pct.y, precargar.venc_x_pct, precargar.venc_y_pct);
    setVencXPct(pctVenc.x);
    setVencYPct(pctVenc.y);
    setLote(LOTE_PREFIJO);
    setVencimiento(EXP_PREFIJO);
    setIncluirLoteExp(false);
    // Siempre reasignar (no solo cuando vienen datos): si no, quedan overlays
    // de un producto/PDF anterior "pegados" sobre el PDF nuevo (p. ej. el
    // handoff de Studio no manda estos campos y el PDF ya trae todo su
    // propio texto — no debe mostrarse nada superpuesto encima).
    setCamposTexto(precargar.campos_texto ?? []);
    setLineasPlantilla(precargar.lineas ?? []);
    setImagenesPlantilla(precargar.imagenes ?? []);
    setRectangulosPlantilla(precargar.rectangulos ?? []);
    onPrecargarConsumido();
  }, [precargar]);

  // Render plano del PDF de Studio, sin overlays: el diseño ya viene
  // completo (todas las capas de texto) desde el editor visual, así que la
  // vista previa debe verse exactamente igual que en el Studio.
  const { data: pdfStudioPreview, isFetching: pdfStudioPreviewLoading } = useQuery({
    queryKey: ["etiquetas-pdf-studio-preview", pdfStudioRuta],
    queryFn: () =>
      api.post<{ imagen: string; mime: string; error?: string }>("/api/etiquetas/preview", {
        ruta_pdf: pdfStudioRuta,
      }),
    enabled: !!pdfStudioRuta,
    staleTime: 0,
  });

  const { data: estadoData, refetch: refetchImpresora } = useQuery({
    queryKey: ["etiquetas-impresora"],
    queryFn: () => api.get<ImpResp>("/api/etiquetas/impresora"),
    refetchInterval: 30000,
  });

  const imprimirMut = useMutation({
    mutationFn: (payload: ImpresionEtiquetaPayload) =>
      api.post<PrintResult>("/api/etiquetas/imprimir", payload, { timeoutMs: 90_000 }),
    onSuccess: (data) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const err = errorDesdePrintResult(data);
      setErrorImpresion(err);
      setLog((prev) => [
        ...prev,
        ...(data.log ?? []).map((l) => `[${ts}] ${l}`),
        err
          ? `[${ts}] ❌ ${err.error}`
          : `[${ts}] ✅ Impresión enviada`,
      ]);
      refetchImpresora();
      void refetchSolicitudesImprimir();
      if (!err) qc.invalidateQueries({ queryKey: ["etiquetas-inventario-consumibles"] });
    },
    onError: (err) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const det = errorDesdeExcepcion(err.message);
      setErrorImpresion(det);
      setLog((prev) => [...prev, `[${ts}] ❌ ${det.error}`]);
    },
  });

  const skuParaCodigoPdf = skuActivoImpresion || precargar?.siigo_code || "";
  const actualizarCodigoPdfMut = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; cambios: number; codigo: string; mensaje?: string | null }>(
        `/api/etiquetas/studio/${encodeURIComponent(skuParaCodigoPdf)}/actualizar-codigo-pdf`,
        { ruta_pdf: pdfStudioRuta },
      ),
    onSuccess: (r) => {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const msg = r.cambios > 0
        ? `Código actualizado a ${r.codigo} (${r.cambios} cambio(s))`
        : r.mensaje || "El PDF ya tenía el código vigente";
      setLog((prev) => [...prev, `[${ts}] ✅ ${msg}`]);
    },
  });

  function aplicarLoteRegistrado(loteRegistrado: LoteRegistrado) {
    setLote(conPrefijoLote(loteRegistrado.lote_numero));
    setVencimiento(conPrefijoExp(loteRegistrado.fecha_vencimiento));
    setIncluirLoteExp(Boolean(loteRegistrado.lote_numero || loteRegistrado.fecha_vencimiento));
  }

  async function seleccionarDesdeCatalogo(fila: CatalogoStudioFila) {
    setSkuActivoImpresion(fila.sku);
    setFilaActiva(fila);
    setMatchEanPng(null);
    let datos: Partial<DatosEtiqueta> = {};
    let guardado: Partial<EtiquetaStudioDatos> | null = null;
    try {
      datos = await api.get<Partial<DatosEtiqueta>>(`/api/etiquetas/datos/${encodeURIComponent(fila.sku)}`);
    } catch {
      datos = {};
    }
    try {
      const r = await api.get<{ datos: EtiquetaStudioDatos | null }>(
        `/api/etiquetas/studio/${encodeURIComponent(fila.sku)}`,
      );
      guardado = r.datos;
    } catch {
      guardado = null;
    }

    // Lote vigente de Fichas Técnicas / COA (historial por SKU). Prioridad sobre
    // defaults legacy de etiquetas_datos.json para que el lote registrado en la
    // ficha completa se refleje al imprimir.
    let loteVigenteNum = "";
    let vencVigente = "";
    try {
      const rLote = await api.get<{ lotes: LoteRegistrado[] }>(
        `/api/lotes/${encodeURIComponent(fila.sku)}`,
      );
      const lotes = rLote.lotes ?? [];
      setLotesRegistrados(lotes);
      const vigente = lotes.find((l) => l.vigente) ?? lotes[0];
      loteVigenteNum = vigente?.lote_numero ?? "";
      vencVigente = vigente?.fecha_vencimiento ?? "";
    } catch {
      setLotesRegistrados([]);
      /* sin lote registrado o error de red: se usa el default legacy */
    }
    setMatchEanPng(
      loteVigenteNum
        ? ({ sku: fila.sku, nombre_producto: fila.nombre ?? fila.sku } as CodigoEan)
        : "sin-match",
    );

    const base = studioDatosDesdeCatalogo(fila, guardado);
    const loteFinal = loteVigenteNum || datos.lote_defecto || base.lote;
    const vencFinal = vencVigente || datos.vencimiento_defecto || base.vencimiento;
    setStudioDatos({ ...base, lote: loteFinal, vencimiento: vencFinal });

    const tipo = datos.tipo_etiqueta || fila.tipo_etiqueta || base.tipo_etiqueta;
    if (tipo) {
      const [anchoMm, altoMm] = mmParaTipoEtiqueta(tipo, TIPOS_ETIQUETA_DEFAULT);
      setFormato({ nombre: tipo, anchoMm, altoMm });
      setRotacion(rotacionDefaultEtiqueta(tipo));
    }
    if (datos.forma) setForma(datos.forma);
    if (datos.calidad) setCalidad(datos.calidad);
    if (datos.rotacion) setRotacion(rotacionValida(datos.rotacion));
    // En Imprimir: bloque LOTE·EXP grande al centro, salvo que ya haya posición custom guardada.
    if (datos.lote_pos === "custom" && typeof datos.lote_x_pct === "number" && typeof datos.lote_y_pct === "number") {
      if (datos.lote_font) setLoteFont(datos.lote_font);
      setLotePos("custom");
      setLoteXPct(datos.lote_x_pct);
      setLoteYPct(datos.lote_y_pct);
      const pctVenc = vencPctInicial(datos.lote_x_pct, datos.lote_y_pct, datos.venc_x_pct, datos.venc_y_pct);
      setVencXPct(pctVenc.x);
      setVencYPct(pctVenc.y);
    } else {
      setLotePos("center");
      setLoteFont(datos.lote_font && datos.lote_font >= 12 ? datos.lote_font : LOTE_FONT_IMPRIMIR_DEFAULT);
      setLoteXPct(LOTE_POS_PCT["center"].x);
      setLoteYPct(LOTE_POS_PCT["center"].y);
      setVencXPct(LOTE_POS_PCT["center"].x);
      setVencYPct(clampLotePct(LOTE_POS_PCT["center"].y + LOTE_EXP_GAP_PCT));
    }
    setLote(conPrefijoLote(loteFinal));
    setVencimiento(conPrefijoExp(vencFinal));
    setVistaImpresion("documento");
    setIncluirLoteExp(Boolean(loteFinal || vencFinal));
  }

  async function abrirPngParaImprimir(item: RecursoPngCatalogo) {
    setPngImpresion(item);
    setPdfStudioRuta("");
    setPdfStudioNombre("");
    setSkuActivoImpresion("");
    setFilaActiva(null);
    setStudioDatos({ ...ETIQUETA_STUDIO_DEFAULT });
    setCamposTexto([]);
    setLineasPlantilla([]);
    setImagenesPlantilla([]);
    setRectangulosPlantilla([]);
    setLote(LOTE_PREFIJO);
    setVencimiento(EXP_PREFIJO);
    setLotesRegistrados([]);
    setLotePos("center");
    setLoteFont(LOTE_FONT_IMPRIMIR_DEFAULT);
    setLoteXPct(LOTE_POS_PCT["center"].x);
    setLoteYPct(LOTE_POS_PCT["center"].y);
    setVencXPct(LOTE_POS_PCT["center"].x);
    setVencYPct(clampLotePct(LOTE_POS_PCT["center"].y + LOTE_EXP_GAP_PCT));
    setMatchEanPng(null);

    // PNG sin SKU propio: match por título/nombre de archivo → Códigos EAN
    // (todas las palabras clave del producto, sin ambigüedad) y luego el lote
    // vigente de la ficha técnica completa registrada para ese SKU.
    const match = mejorCoincidenciaEanPorNombreArchivo(item.nombre, codigosEan);
    let loteDelMatch = "";
    let vencDelMatch = "";
    if (match) {
      setSkuActivoImpresion(match.sku);
      setMatchEanPng(match);
      try {
        const r = await api.get<{ lotes: LoteRegistrado[] }>(
          `/api/lotes/${encodeURIComponent(match.sku)}`,
        );
        const lotes = r.lotes ?? [];
        setLotesRegistrados(lotes);
        const vigente = lotes.find((l) => l.vigente) ?? lotes[0];
        if (vigente?.lote_numero) {
          loteDelMatch = vigente.lote_numero;
          setLote(conPrefijoLote(vigente.lote_numero));
        }
        if (vigente?.fecha_vencimiento) {
          vencDelMatch = vigente.fecha_vencimiento;
          setVencimiento(conPrefijoExp(vigente.fecha_vencimiento));
        }
      } catch {
        /* sin lote registrado o error de red: se deja para llenar a mano */
      }
    } else {
      setMatchEanPng("sin-match");
    }

    const tipo = (item.tipo_etiqueta || "").trim();
    if (tipo) {
      const [anchoMm, altoMm] = mmParaTipoEtiqueta(tipo, TIPOS_ETIQUETA_DEFAULT);
      const next = {
        nombre: tipo,
        anchoMm: item.ancho_mm ?? anchoMm,
        altoMm: item.alto_mm ?? altoMm,
      };
      setFormato(next);
      setRotacion(rotacionDefaultEtiqueta(tipo));
      if (esFormatoCircularImpresion(next)) setForma("Diecut_Gap");
    } else if (item.ancho_mm != null && item.alto_mm != null && item.ancho_mm > 0 && item.alto_mm > 0) {
      setFormato((f) => {
        const next = {
          nombre: f.nombre,
          anchoMm: item.ancho_mm!,
          altoMm: item.alto_mm!,
        };
        if (esFormatoCircularImpresion(next)) setForma("Diecut_Gap");
        return next;
      });
    }
    setVistaImpresion("documento");
    setIncluirLoteExp(Boolean(loteDelMatch || vencDelMatch));
  }

  function volverACatalogoPng() {
    setPngImpresion(null);
    setPdfStudioRuta("");
    setPdfStudioNombre("");
    setVistaImpresion("catalogo");
  }

  const productoListo = !!pngImpresion
    || !!pdfStudioRuta
    || (!!studioDatosImpresion.sku.trim() && !!studioDatosImpresion.nombre_producto.trim());

  const estadoTxt = estadoData?.estado ?? "";
  const impConectada = impresoraConectadaDesdeEstado(estadoTxt, estadoData?.impresora_conectada);
  const impDeshabilitada = estadoTxt.toLowerCase().includes("deshabilitad") || estadoTxt.toLowerCase().includes("disabled");
  const avisoRollo = estadoData?.niveles_tinta?.alerta_impresora?.codigo === "sin_papel"
    && impConectada
    && estadoData?.comunicacion_usb !== false;

  function handleImprimir() {
    if (!productoListo) {
      const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setLog((prev) => [...prev, `[${ts}] ⚠️  Selecciona un producto del catálogo primero`]);
      return;
    }
    const ts = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const loteVal = loteParaEtiqueta(lote);
    const expVal = expParaEtiqueta(vencimiento);
    const loteInfo = (loteVal || expVal) ? ` · ${loteVal || "–"} / ${expVal || "–"}` : "";
    const plantilla = pngImpresion?.nombre
      || pdfStudioNombre
      || filaActiva?.archivo_ai
      || studioDatosImpresion.archivo_ai
      || "SVG";
    setLog((prev) => [
      ...prev,
      `[${ts}] ${cantidad} cop. · ${formato.nombre} (${formatoMedidasEtiqueta(formato.anchoMm, formato.altoMm) || `${formato.anchoMm}×${formato.altoMm}`}) · ${calidad}${loteInfo} · ${plantilla}...`,
    ]);
    setErrorImpresion(null);

    const formaImpresion = esFormatoCircularImpresion(formato) ? "Diecut_Gap" : forma;
    if (pngImpresion) {
      void (async () => {
        setPreparandoPngImpresion(true);
        try {
          const body: Record<string, unknown> = { nombre: pngImpresion.nombre };
          if (formato.nombre) body.tipo_etiqueta = formato.nombre;
          body.ancho_mm = formato.anchoMm;
          body.alto_mm = formato.altoMm;
          if (pngImpresion.dpi != null && Number(pngImpresion.dpi) > 0) body.dpi = pngImpresion.dpi;

          const res = await api.post<{
            ok: boolean;
            nombre: string;
            ruta_completa: string;
            tipo_etiqueta?: string;
            ancho_mm?: number;
            alto_mm?: number;
            error?: string;
          }>("/api/etiquetas/recursos-png/imprimir-pdf", body);

          imprimirMut.mutate({
            producto: formato.nombre,
            ancho_mm: Number(res.ancho_mm) > 0 ? Number(res.ancho_mm) : formato.anchoMm,
            alto_mm: Number(res.alto_mm) > 0 ? Number(res.alto_mm) : formato.altoMm,
            forma: formaImpresion,
            calidad,
            rotacion,
            cantidad,
            offset_v: offsetV,
            offset_h: offsetH,
            ruta_pdf: res.ruta_completa,
            lote: loteParaImpresion,
            vencimiento: expParaImpresion,
            lote_font: loteFont,
            lote_x_pct: loteXPct,
            lote_y_pct: loteYPct,
            venc_x_pct: vencXPct,
            venc_y_pct: vencYPct,
          });
        } catch (err) {
          const det = errorDesdeExcepcion(err instanceof Error ? err.message : "Error al preparar PNG");
          setErrorImpresion(det);
          setLog((prev) => [...prev, `[${ts}] ❌ ${det.error}`]);
        } finally {
          setPreparandoPngImpresion(false);
        }
      })();
      return;
    }

    imprimirMut.mutate({
      producto: formato.nombre,
      ancho_mm: formato.anchoMm,
      alto_mm: formato.altoMm,
      forma: formaImpresion,
      calidad,
      rotacion,
      cantidad,
      offset_v: offsetV,
      offset_h: offsetH,
      ruta_pdf: pdfStudioRuta || undefined,
      studio_datos: pdfStudioRuta ? undefined : studioDatosImpresion,
      lote: loteParaImpresion,
      vencimiento: expParaImpresion,
      lote_font: loteFont,
      lote_x_pct: loteXPct,
      lote_y_pct: loteYPct,
      venc_x_pct: vencXPct,
      venc_y_pct: vencYPct,
    });
  }

  return (
    <>
      {mostrarPedidoEtiquetas && (
        <ModalPedidosEtiquetasEnCurso
          onCerrar={() => setMostrarPedidoEtiquetas(false)}
          onActualizado={() => void refetchSolicitudesImprimir()}
          onAplicarLinea={(_pedido, linea) => {
            if (linea.tipoEtiqueta) {
              const [anchoMm, altoMm] = mmParaTipoEtiqueta(linea.tipoEtiqueta, TIPOS_ETIQUETA_DEFAULT);
              setFormato({ nombre: linea.tipoEtiqueta, anchoMm, altoMm });
              setRotacion(rotacionDefaultEtiqueta(linea.tipoEtiqueta));
            }
            if (linea.cantidad > 0) setCantidad(Math.min(999, linea.cantidad));
          }}
        />
      )}
      {mostrarInstalador && (
        <InstaladorWizard
          key={`instalador-${instaladorTab}`}
          tabInicial={instaladorTab}
          onCerrar={() => { setMostrarInstalador(false); refetchImpresora(); }}
        />
      )}

      {vistaImpresion === "catalogo" ? (
        <div className="mck-card overflow-hidden shadow-paper-sm">
          <ImpresionEtiquetasHeader
            vista="catalogo"
            onVistaChange={setVistaImpresion}
            solicitudesCount={solicitudesImprimir.length}
            onPedidosClick={() => setMostrarPedidoEtiquetas(true)}
            onInstalarClick={() => abrirInstalador("windows10pro")}
          />
          <div className="p-4">
            <EtiquetasStudioCatalogo
              onSeleccionar={(f) => void seleccionarDesdeCatalogo(f)}
              onAbrirPng={abrirPngParaImprimir}
              skuActivo={skuActivoImpresion}
              modoSeleccion="fila"
              accionLabel={null}
              mostrarDiagramacion={false}
              layout="stack"
              soloArchivosPng
            />
          </div>
        </div>
      ) : (
      <div className="mck-card flex h-[calc(100dvh-7.5rem)] max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden shadow-paper-sm">
        <ImpresionEtiquetasHeader
          vista="documento"
          skuActivo={skuActivoImpresion}
          onVistaChange={(v) => {
            setVistaImpresion(v);
            if (v === "catalogo") volverACatalogoPng();
          }}
          solicitudesCount={solicitudesImprimir.length}
          onPedidosClick={() => setMostrarPedidoEtiquetas(true)}
          onInstalarClick={() => abrirInstalador("windows10pro")}
          impConectada={impConectada}
          impDeshabilitada={impDeshabilitada}
          avisoRollo={avisoRollo}
        />

        {errorImpresion && (
          <BannerErrorImpresora
            error={errorImpresion}
            onCerrar={() => setErrorImpresion(null)}
            onInstalar={() => abrirInstalador("ubuntu")}
            onWindowsRemoto={() => abrirInstalador("windows10pro")}
          />
        )}

        {!impConectada && estadoTxt && !errorImpresion && (
          <Banner tone="warning" className="flex-shrink-0 rounded-none border-x-0 border-t-0 !py-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px]">
                {impDeshabilitada
                  ? "Impresora desinstalada o sin USB. Instala para Windows 10 Pro (sesión Jenniffer)."
                  : "Impresora no registrada. Pulsa Instalar para Windows 10 Pro."}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button variant="warning" size="sm" onClick={() => abrirInstalador("windows10pro")}>
                  Instalar
                </Button>
              </div>
            </div>
          </Banner>
        )}

        {impConectada && avisoRollo && estadoData?.niveles_tinta?.alerta_impresora && !errorImpresion && (
          <Banner tone="warning" className="flex-shrink-0 rounded-none border-x-0 border-t-0 !py-1 text-[10px]">
            {estadoData.niveles_tinta.alerta_impresora.error}
          </Banner>
        )}

        <NivelesTintaImpresora compact onExpand={onIrInventarioTinta} />

        {/* Cinta — controles compactos (desplegables) */}
        <div className="flex flex-shrink-0 flex-wrap items-center gap-y-0.5 border-b border-border bg-surface">
          <RibbonGroup label="Formato">
            <SelectorFormatoEtiqueta
              readOnly
              value={formato}
              inputClass={RIB_INP}
              selectClass={RIB_SEL}
              labelClass={RIB_LBL}
              labelNombre="Producto"
              compact
            />
            <RibbonSelect label="Sensor" value={forma} options={FORMAS} onChange={setForma} />
            <RibbonSelect label="Impresión" value={calidad} options={CALIDADES} onChange={setCalidad} />
            <RibbonSelect label="Rotación" value={rotacion} options={ROTACIONES} onChange={setRotacion} />
          </RibbonGroup>
          <RibbonGroup label="Posición">
            <AjusteOffsetImpresion
              offsetV={offsetV}
              offsetH={offsetH}
              onOffsetVChange={setOffsetV}
              onOffsetHChange={setOffsetH}
            />
          </RibbonGroup>
          <RibbonGroup label="Cantidad">
            <div className="flex items-center gap-0.5">
              <button type="button" aria-label="Restar cantidad" onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="h-6 w-5 rounded border border-border text-[11px] font-semibold hover:bg-surface-hover">−</button>
              <input
                type="number"
                min={1}
                max={999}
                value={cantidad}
                onChange={(e) => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                className={`${RIB_INP} w-10 text-center font-semibold`}
              />
              <button type="button" aria-label="Sumar cantidad" onClick={() => setCantidad((c) => Math.min(999, c + 1))} className="h-6 w-5 rounded border border-border text-[11px] font-semibold hover:bg-surface-hover">+</button>
            </div>
          </RibbonGroup>
          <RibbonGroup label="Trazabilidad">
            <label
              className={`mck-press relative inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 text-[10px] font-semibold transition ${
                incluirLoteExp
                  ? loteExpPendiente
                    ? "border-amber-500/70 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-accent bg-accent text-white"
                  : "border-border text-ink-secondary hover:bg-surface-hover hover:text-ink"
              }`}
              title={incluirLoteExp ? "Quitar lote/EXP de la etiqueta" : "Incluir lote/EXP en la etiqueta"}
            >
              <input
                type="checkbox"
                className="h-3 w-3 accent-accent"
                checked={incluirLoteExp}
                onChange={(e) => {
                  const on = e.target.checked;
                  setIncluirLoteExp(on);
                  if (on && loteVacio && expVacio) {
                    setLote(LOTE_PREFIJO);
                    setVencimiento(EXP_PREFIJO);
                  }
                }}
                aria-label="Incluir lote y vencimiento"
              />
              <span>Lote</span>
              {loteExpPendiente && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              )}
            </label>
            {incluirLoteExp && (
              <>
                <input
                  id="imprimir-lote-input"
                  type="text"
                  value={lote}
                  onChange={(e) => setLote(editarConPrefijo(e.target.value, LOTE_PREFIJO))}
                  placeholder="LOT. …"
                  className={`${RIB_INP} w-[7.5rem] ${loteVacio ? "border-amber-500" : ""}`}
                  aria-label="Lote"
                  title="Lote"
                />
                <input
                  id="imprimir-exp-input"
                  type="text"
                  value={vencimiento}
                  onChange={(e) => setVencimiento(editarConPrefijo(e.target.value, EXP_PREFIJO))}
                  placeholder="EXP. …"
                  className={`${RIB_INP} w-[6.5rem] ${expVacio ? "border-amber-500" : ""}`}
                  aria-label="Vencimiento"
                  title="Vencimiento"
                />
                {lotesRegistrados.length > 1 && (
                  <select
                    value={loteParaEtiqueta(lote)}
                    onChange={(e) => {
                      const elegido = lotesRegistrados.find(
                        (item) => item.lote_numero === e.target.value,
                      );
                      if (elegido) aplicarLoteRegistrado(elegido);
                    }}
                    className={`${RIB_INP} max-w-[10rem]`}
                    aria-label="Lote registrado de documentos técnicos"
                    title="Lote registrado en documentos técnicos"
                  >
                    {lotesRegistrados.map((item) => (
                      <option key={item.lote_numero} value={item.lote_numero ?? ""}>
                        {item.vigente ? "Vigente · " : ""}
                        {item.lote_numero || "Sin número"}
                        {item.fecha_vencimiento ? ` · EXP ${item.fecha_vencimiento}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1" title="Tamaño del texto">
                  <input
                    type="range"
                    min={TAMANO_TEXTO_PT_MIN}
                    max={TAMANO_TEXTO_PT_MAX}
                    step={1}
                    value={clampTamanoTextoPt(loteFont)}
                    onChange={(e) => setLoteFont(clampTamanoTextoPt(Number(e.target.value)))}
                    className="h-4 w-14 accent-accent"
                    aria-label="Tamaño del texto"
                  />
                  <span className={`${RIB_FONT_BTN} tabular-nums text-ink`}>{clampTamanoTextoPt(loteFont)}pt</span>
                </div>
              </>
            )}
          </RibbonGroup>
        </div>

        {/* Lienzo — ocupa el resto del alto */}
        <div className="flex min-h-0 flex-1 flex-col bg-surface-hover/20">
          <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-surface-panel/80 px-2.5 py-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
              Vista previa
            </span>
            <div className="flex items-center gap-2">
              {filaActiva?.archivo_ai && (
                <span className="truncate font-mono text-[9px] text-muted" title={filaActiva.archivo_ai}>
                  {filaActiva.archivo_ai}
                </span>
              )}
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
            {pngImpresion ? (
              <div className="flex h-full min-h-0 w-full flex-col items-center gap-1">
                <div className="flex w-full shrink-0 items-center justify-between gap-2 px-0.5">
                  <p className="min-w-0 truncate text-[10px] font-semibold text-ink" title={pngImpresion.nombre}>
                    {pngImpresion.nombre.includes("/") ? pngImpresion.nombre.split("/").pop() : pngImpresion.nombre}
                  </p>
                  <button
                    type="button"
                    onClick={volverACatalogoPng}
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted hover:border-accent hover:text-accent"
                  >
                    Archivos
                  </button>
                </div>
                {matchEanPng === "sin-match" ? (
                  <p className="w-full shrink-0 px-0.5 text-[10px] text-amber-600">
                    Sin match EAN — escribe lote/EXP manualmente.
                  </p>
                ) : matchEanPng ? (
                  <p className="w-full shrink-0 truncate px-0.5 text-[10px] text-emerald-600" title={`${matchEanPng.sku} — ${matchEanPng.nombre_producto}`}>
                    {matchEanPng.sku} — {matchEanPng.nombre_producto}
                    {loteParaEtiqueta(lote) ? " · lote OK" : " · sin lote"}
                  </p>
                ) : null}
                <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
                <VistaPreviaPngConLote
                  nombre={pngImpresion.nombre}
                  loteText={incluirLoteExp ? loteParaEtiqueta(lote) : undefined}
                  vencText={incluirLoteExp ? expParaEtiqueta(vencimiento) : undefined}
                  loteFont={loteFont}
                  loteXPct={loteXPct}
                  loteYPct={loteYPct}
                  vencXPct={vencXPct}
                  vencYPct={vencYPct}
                  imgClassName={PREVIEW_IMG_ETIQUETA_PNG}
                  containerClassName={PREVIEW_CONTAINER_ETIQUETA_PNG}
                  onLotePositionChange={(x, y) => {
                    setLoteXPct(x);
                    setLoteYPct(y);
                    setLotePos("custom");
                  }}
                  onVencPositionChange={(x, y) => {
                    setVencXPct(x);
                    setVencYPct(y);
                  }}
                />
                </div>
              </div>
            ) : pdfStudioRuta ? (
              <div className="flex h-full w-full flex-col items-center gap-2">
                <div className="flex w-full items-center justify-between gap-2 px-1">
                  <p className="min-w-0 truncate text-xs font-semibold text-ink" title={pdfStudioNombre}>
                    📄 {pdfStudioNombre || "PDF de Studio"}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {skuParaCodigoPdf && (
                      <button
                        type="button"
                        onClick={() => actualizarCodigoPdfMut.mutate()}
                        disabled={actualizarCodigoPdfMut.isPending}
                        title="Trae el código de verificación del lote vigente y lo parchea en este PDF sin regenerar el diseño"
                        className="rounded-lg border border-accent/50 px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
                      >
                        {actualizarCodigoPdfMut.isPending ? "Actualizando…" : "Actualizar código del lote"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPdfStudioRuta("");
                        setPdfStudioNombre("");
                        setVistaImpresion("catalogo");
                      }}
                      className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-semibold text-muted hover:border-accent hover:text-accent"
                    >
                      Quitar y elegir del catálogo
                    </button>
                  </div>
                </div>
                {actualizarCodigoPdfMut.isError && (
                  <p className="w-full px-1 text-[11px] text-danger">
                    {(actualizarCodigoPdfMut.error as Error).message}
                  </p>
                )}
                {pdfStudioPreview?.error ? (
                  <p className="px-6 text-center text-xs text-danger">{pdfStudioPreview.error}</p>
                ) : (
                  <VistaPreviaConLote
                    imagen={pdfStudioPreview?.imagen}
                    mime={pdfStudioPreview?.mime}
                    loading={pdfStudioPreviewLoading}
                    loteText={incluirLoteExp ? loteParaEtiqueta(lote) : undefined}
                    vencText={incluirLoteExp ? expParaEtiqueta(vencimiento) : undefined}
                    loteFont={loteFont}
                    loteXPct={loteXPct}
                    loteYPct={loteYPct}
                    vencXPct={vencXPct}
                    vencYPct={vencYPct}
                    imgClassName={PREVIEW_IMG_LARGE}
                    containerClassName={PREVIEW_CONTAINER_LARGE}
                    onLotePositionChange={(x, y) => {
                      setLoteXPct(x);
                      setLoteYPct(y);
                      setLotePos("custom");
                    }}
                    onVencPositionChange={(x, y) => {
                      setVencXPct(x);
                      setVencYPct(y);
                    }}
                  />
                )}
              </div>
            ) : productoListo ? (
              <div className="flex h-full w-full flex-col items-center gap-2">
                {matchEanPng === "sin-match" ? (
                  <p className="w-full px-1 text-[11px] text-amber-600">
                    ⚠️ Sin lote registrado para este SKU — el lote no se autocompletó. Regístralo en Fichas
                    Técnicas (COA) → «Registrar este lote en el historial».
                  </p>
                ) : matchEanPng ? (
                  <p className="w-full px-1 text-[11px] text-emerald-600">
                    ✅ Lote vigente autocompletado para <strong>{skuActivoImpresion}</strong>
                  </p>
                ) : null}
                <EtiquetaMckennaPreview
                  datos={studioDatosImpresion}
                  marcoFormato
                  raw
                  className="w-full max-w-[420px]"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <span className="text-4xl opacity-40">🏷️</span>
                <p className="text-sm font-medium text-muted">Sin producto seleccionado</p>
                <button
                  type="button"
                  onClick={() => setVistaImpresion("catalogo")}
                  className="rounded-lg border-2 border-accent px-4 py-2 text-xs font-bold text-accent hover:bg-accent hover:text-white"
                >
                  Elegir del catálogo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Barra inferior — imprimir (compacta, resalta en verde) */}
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-panel px-2.5 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[10px] text-muted">
            {pngImpresion
              ? (pngImpresion.nombre.includes("/") ? pngImpresion.nombre.split("/").pop() : pngImpresion.nombre)
              : pdfStudioRuta
              ? (pdfStudioNombre || "PDF de Studio")
              : productoListo
              ? `${skuActivoImpresion} · ${filaActiva?.archivo_ai || studioDatosImpresion.archivo_ai || "plantilla SVG"}`
              : "Selecciona un PNG del catálogo"}
            {estadoImpresoraLegible(estadoData) && ` · ${estadoImpresoraLegible(estadoData)}`}
          </p>
          <button
            type="button"
            onClick={handleImprimir}
            disabled={imprimirMut.isPending || preparandoPngImpresion || !productoListo}
            className="mck-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-success px-3 text-[11px] font-bold tracking-wide text-white shadow-sm ring-1 ring-success/40 transition hover:brightness-110 disabled:opacity-40"
          >
            {imprimirMut.isPending || preparandoPngImpresion ? (
              "Imprimiendo…"
            ) : (
              <>
                <Icon name="printer" size={14} />
                Imprimir
              </>
            )}
          </button>
        </div>

        {log.length > 0 && (
          <div className="flex-shrink-0 border-t border-border bg-surface px-4 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Log</span>
              <button type="button" onClick={() => setLog([])} className="text-[10px] text-muted hover:text-danger">Limpiar</button>
            </div>
            <div className="max-h-28 overflow-y-auto rounded bg-surface-panel p-2 font-mono text-[10px] text-ink space-y-0.5">
              {log.map((l, i) => (
                <div key={i} className={l.includes("❌") || l.includes("✗") ? "text-danger" : l.includes("✅") ? "text-success" : l.includes("⚠") ? "text-warning" : ""}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}

// ── Inventario papel y tinta ──────────────────────────────────────────────────

interface CartuchoTinta {
  codigo: string;
  etiqueta: string;
  color: string;
  nombre?: string | null;
  nivel?: number | null;
  raw?: string | null;
  origen?: "impresora" | "manual" | null;
  estado_codigo?: string | null;
  estado_etiqueta?: string | null;
}

interface AlertaImpresora {
  error: string;
  solucion: string;
  codigo?: string;
  severidad?: "error" | "warning" | "info";
  detalle?: string;
}

interface NivelesTintaResp {
  disponible?: boolean;
  impresora?: string;
  status?: string;
  status_group?: string;
  estado_cups?: string;
  estado_ok?: boolean;
  impresora_conectada?: boolean;
  comunicacion_usb?: boolean;
  alerta_impresora?: AlertaImpresora | null;
  unsettled?: boolean;
  niveles_legibles?: boolean;
  desde_cache?: boolean;
  mensaje?: string;
  cartuchos?: CartuchoTinta[];
  error?: string;
  solucion?: string;
  codigo?: string;
  consultado_at?: string;
  origen_niveles?: "impresora" | "manual" | "mixto" | "ninguno";
  niveles_manuales?: Record<string, number>;
  rapido?: boolean;
}

interface ImpresoraConTintasResp extends ImpResp {
  niveles_tinta?: NivelesTintaResp;
}

const CARTUCHOS_TINTA_DEFAULT: CartuchoTinta[] = [
  { codigo: "K", etiqueta: "Negro", color: "#1a1a1a", nombre: null, nivel: null },
  { codigo: "C", etiqueta: "Cian", color: "#06b6d4", nombre: null, nivel: null },
  { codigo: "M", etiqueta: "Magenta", color: "#ec4899", nombre: null, nivel: null },
  { codigo: "Y", etiqueta: "Amarillo", color: "#eab308", nombre: null, nivel: null },
  { codigo: "MN", etiqueta: "Mantenimiento", color: "#6b7280", nombre: null, nivel: null },
];

async function fetchNivelesTintaResumen(): Promise<NivelesTintaResp> {
  return api.get<NivelesTintaResp>("/api/etiquetas/niveles-tinta");
}

async function fetchNivelesTintaUsb(): Promise<NivelesTintaResp> {
  return api.get<NivelesTintaResp>("/api/etiquetas/niveles-tinta?refresh=1", { timeoutMs: 25_000 });
}

function nivelTintaBarraClase(pct: number | null | undefined): string {
  if (pct == null) return "bg-muted/40";
  if (pct <= 15) return "bg-danger";
  if (pct <= 30) return "bg-warning";
  return "bg-accent";
}

function alertaImpresoraDesdeDatos(data?: NivelesTintaResp | null): AlertaImpresora | null {
  if (!data) return null;
  if (data.alerta_impresora?.error) return data.alerta_impresora;
  if (!data.disponible && data.error) {
    return {
      error: data.error,
      solucion: data.solucion ?? "Revisa cable USB, rollo de etiquetas y pulsa «Instalar impresora».",
      codigo: data.codigo,
      severidad: "error",
    };
  }
  return null;
}

/** CUPS «inactiva» = idle (lista); solo falla si está deshabilitada o no registrada. */
function impresoraConectadaDesdeEstado(estado: string, explicito?: boolean): boolean {
  if (explicito === true) return true;
  if (explicito === false) return false;
  const el = estado.trim().toLowerCase();
  if (!el || el.startsWith("error:")) return false;
  if (
    el.includes("unknown")
    || el.includes("does not exist")
    || el.includes("no existe")
    || el.includes("deshabilitad")
    || el.includes("disabled")
    || el.includes("no encontrad")
  ) {
    return false;
  }
  if (/\b(en pausa|paused|pausada|pausado)\b/.test(el)) return false;
  if (el.includes("inactiva") || el.includes("idle")) return true;
  return true;
}

function estadoImpresoraLegible(data?: ImpResp | null): string {
  if (data?.estado_legible) return data.estado_legible;
  const el = (data?.estado ?? "").trim().toLowerCase();
  if (!el) return "";
  if (el.includes("inactiva") || el.includes("idle")) return "Lista para imprimir";
  if (/\b(en pausa|paused|pausada|pausado)\b/.test(el)) return "En pausa";
  if (el.includes("imprim") || el.includes("printing")) return "Imprimiendo…";
  if (el.includes("deshabilitad") || el.includes("disabled")) return "Deshabilitada";
  return data?.estado.split("\n")[0] ?? "";
}

function PanelAlertaEstadoImpresora({
  alerta,
  onInstalar,
  onWindowsRemoto,
}: {
  alerta: AlertaImpresora;
  onInstalar?: () => void;
  onWindowsRemoto?: () => void;
}) {
  const sev = alerta.severidad ?? "error";
  const tone = sev === "info" ? "accent" : sev === "warning" ? "warning" : "danger";
  const mostrarInstalar = onInstalar && (!alerta.codigo || CODIGOS_INSTALAR_IMPRESORA.has(alerta.codigo));
  const esSinUsb = alerta.codigo === "sin_usb" || alerta.codigo === "remoto_sin_uri" || alerta.codigo === "smb_sin_respuesta";

  return (
    <Banner tone={tone} className="mb-3 text-xs">
      <div className="flex flex-wrap items-start gap-3">
        <span className="text-base leading-none" aria-hidden>
          {sev === "info" ? "ℹ️" : sev === "warning" ? "⚠️" : "🛑"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{alerta.error}</p>
          <p className="mt-1.5 leading-relaxed">
            <span className="font-semibold">Posible solución: </span>
            {alerta.solucion}
          </p>
          {alerta.detalle ? (
            <p className="mt-2 font-mono text-[10px] opacity-70">{alerta.detalle}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {mostrarInstalar && (
              <Button variant="secondary" size="sm" onClick={onInstalar}>
                {esSinUsb ? "USB en este PC" : "Instalar impresora"}
              </Button>
            )}
            {esSinUsb && onWindowsRemoto && (
              <Button variant="primary" size="sm" onClick={onWindowsRemoto}>
                Instalar Windows 10 Pro
              </Button>
            )}
          </div>
        </div>
      </div>
    </Banner>
  );
}

function NivelesTintaImpresora({
  compact = false,
  onExpand,
}: {
  compact?: boolean;
  onExpand?: () => void;
}) {
  const qc = useQueryClient();
  const [mostrarInstalador, setMostrarInstalador] = useState(false);
  const [instaladorTab, setInstaladorTab] = useState<InstaladorTab>("windows10pro");
  const abrirInstalador = (tab: InstaladorTab = "windows10pro") => {
    setInstaladorTab(tab);
    setMostrarInstalador(true);
  };
  const [leyendoUsb, setLeyendoUsb] = useState(false);
  const [errorUsb, setErrorUsb] = useState<string | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, number>>(() =>
    Object.fromEntries(CARTUCHOS_TINTA_DEFAULT.map((c) => [c.codigo, 50])),
  );
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["etiquetas-niveles-tinta"],
    queryFn: fetchNivelesTintaResumen,
    retry: 1,
    staleTime: 30_000,
  });

  async function leerImpresora() {
    setLeyendoUsb(true);
    setErrorUsb(null);
    try {
      const fresh = await fetchNivelesTintaUsb();
      qc.setQueryData(["etiquetas-niveles-tinta"], fresh);
    } catch (e) {
      setErrorUsb((e as Error)?.message ?? "No se pudo leer la impresora");
    } finally {
      setLeyendoUsb(false);
    }
  }

  useEffect(() => {
    const lista = data?.cartuchos;
    if (!lista) return;
    setManualDraft((prev) => {
      const next = { ...prev };
      for (const c of lista) {
        if (c.nivel != null) next[c.codigo] = c.nivel;
        else if (next[c.codigo] == null) next[c.codigo] = 50;
      }
      return next;
    });
  }, [data?.cartuchos, data?.niveles_manuales, data?.consultado_at]);

  const guardarManualMut = useMutation({
    mutationFn: (niveles: Record<string, number>) =>
      api.put<{ ok: boolean; cartuchos: CartuchoTinta[]; origen_niveles?: string }>(
        "/api/etiquetas/niveles-tinta/manual",
        { niveles },
      ),
    onSuccess: (resp) => {
      qc.setQueryData<NivelesTintaResp>(["etiquetas-niveles-tinta"], (prev) => ({
        ...(prev ?? {}),
        cartuchos: resp.cartuchos,
        origen_niveles: (resp.origen_niveles as NivelesTintaResp["origen_niveles"]) ?? "manual",
        niveles_legibles: true,
        desde_cache: true,
        rapido: true,
      }));
    },
  });

  const cartuchos = data?.cartuchos?.length ? data.cartuchos : CARTUCHOS_TINTA_DEFAULT;
  const soloUsb = data?.origen_niveles === "impresora";
  const mostrarEditorManual = !compact && !soloUsb;
  const alerta = alertaImpresoraDesdeDatos(data);
  const consultado = data?.consultado_at
    ? new Date(data.consultado_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : null;

  function pctVisible(c: CartuchoTinta): number {
    return c.nivel ?? manualDraft[c.codigo] ?? 50;
  }

  function barraAncho(c: CartuchoTinta): string {
    const pct = pctVisible(c);
    return `${Math.max(pct > 0 ? 4 : 0, pct)}%`;
  }

  if (compact) {
    return (
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-2.5 py-1">
        <span className="text-[8px] font-bold uppercase tracking-wide text-muted">Tinta</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {cartuchos.map((c) => {
            const pct = pctVisible(c);
            return (
              <div key={c.codigo} className="flex min-w-[2.75rem] flex-col gap-0" title={`${c.etiqueta}: ${pct}%`}>
                <span className="font-mono text-[8px] font-semibold text-ink">{c.codigo} {pct}%</span>
                <div className="h-1 w-10 overflow-hidden rounded-full bg-surface-panel ring-1 ring-border">
                  <div
                    className={`h-full rounded-full ${nivelTintaBarraClase(c.nivel ?? pct)}`}
                    style={{ width: barraAncho(c), backgroundColor: c.nivel == null ? c.color : undefined }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted hover:bg-surface-hover hover:text-ink"
          >
            Inventario
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {mostrarInstalador && (
        <InstaladorWizard
          key={`instalador-tinta-${instaladorTab}`}
          tabInicial={instaladorTab}
          onCerrar={() => { setMostrarInstalador(false); void leerImpresora(); }}
        />
      )}
      <div className="rounded-xl border-2 border-accent/30 bg-surface-panel p-4 shadow-paper-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">Niveles en impresora</p>
          <p className="text-[10px] text-muted">
            Epson ColorWorks · {data?.impresora ?? "CW-C4000u"}
            {consultado ? ` · guardado ${consultado}` : ""}
            {data?.origen_niveles === "manual"
              ? " · manual (LCD)"
              : data?.origen_niveles === "impresora"
                ? " · leído de impresora"
                : ""}
            {leyendoUsb ? " · leyendo USB…" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void leerImpresora()}
            disabled={leyendoUsb}
            className="rounded-lg bg-accent px-3 py-1 text-[10px] font-bold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {leyendoUsb ? "Leyendo…" : "Leer impresora"}
          </button>
        </div>
      </div>

      {isLoading && !data && (
        <p className="mb-3 text-xs text-muted">Cargando niveles guardados…</p>
      )}

      {isError && (
        <PanelAlertaEstadoImpresora
          alerta={{
            error: (error as Error)?.message ?? "Error al cargar niveles",
            solucion: "Recarga la página. Si persiste, reinicia agente-pro.",
            severidad: "error",
            codigo: "desconocido",
          }}
          onInstalar={() => abrirInstalador("ubuntu")}
          onWindowsRemoto={() => abrirInstalador("windows10pro")}
        />
      )}

      {errorUsb && (
        <Banner tone="danger" className="mb-3 text-xs">
          {errorUsb}
        </Banner>
      )}

      {!isError && alerta && (
        <PanelAlertaEstadoImpresora
          alerta={alerta}
          onInstalar={() => abrirInstalador("ubuntu")}
          onWindowsRemoto={() => abrirInstalador("windows10pro")}
        />
      )}

      {!isError && data?.mensaje && !alerta && (
        <Banner tone="warning" className="mb-3 text-xs">
          {data.mensaje}
        </Banner>
      )}

      {soloUsb && !isError && (
        <Banner tone="success" className="mb-3 text-xs">
          Niveles según el estado que reporta la Epson (misma lógica que las barras del LCD). Pulsa <strong>Leer impresora</strong> para actualizar.
        </Banner>
      )}

      {mostrarEditorManual && !isError && (
        <p className="mb-3 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
          Sin lectura USB. Mira el <strong className="text-ink">panel LCD</strong> de la Epson, ajusta las barras y pulsa <strong className="text-ink">Guardar</strong>.
        </p>
      )}

      <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${isLoading && !data ? "opacity-70" : ""}`}>
        {cartuchos.map((c) => {
          const pct = pctVisible(c);
          return (
          <Card key={c.codigo} padding="sm">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink">
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/20"
                  style={{ backgroundColor: c.color }}
                />
                {c.etiqueta}
                {c.codigo !== "MN" ? (
                  <span className="ml-1 font-mono text-[10px] text-muted">({c.codigo})</span>
                ) : null}
                {c.estado_etiqueta ? (
                  <Badge tone="neutral" className="ml-1">
                    {c.estado_etiqueta}
                  </Badge>
                ) : c.origen === "manual" ? (
                  <Badge tone="warning" solid className="ml-1">manual</Badge>
                ) : c.origen === "impresora" ? (
                  <Badge tone="success" solid className="ml-1">USB</Badge>
                ) : null}
              </span>
              <span className={`font-mono text-sm font-extrabold tabular-nums ${
                pct <= 15 ? "text-danger" : "text-ink"
              }`}>
                {`${pct}%`}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-hover ring-1 ring-border">
              <div
                className={`h-full rounded-full transition-all ${nivelTintaBarraClase(c.nivel ?? pct)}`}
                style={{
                  width: barraAncho(c),
                  backgroundColor: c.nivel != null ? undefined : c.color,
                }}
              />
            </div>
            {(mostrarEditorManual || c.origen === "manual") && (
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={manualDraft[c.codigo] ?? pct}
                onChange={(e) =>
                  setManualDraft((d) => ({ ...d, [c.codigo]: Number(e.target.value) }))
                }
                className="mt-2 w-full accent-accent"
                aria-label={`Nivel ${c.etiqueta}`}
              />
            )}
            {c.nombre ? (
              <p className="mt-1 truncate font-mono text-[10px] text-muted">{c.nombre}</p>
            ) : null}
          </Card>
          );
        })}
      </div>

      {mostrarEditorManual && !isError && (
        <Button
          variant="primary"
          className="mt-3 w-full"
          loading={guardarManualMut.isPending}
          onClick={() => guardarManualMut.mutate(manualDraft)}
        >
          {guardarManualMut.isPending ? "Guardando…" : "Guardar niveles de tinta"}
        </Button>
      )}
    </div>
    </>
  );
}

function FormularioPapelInventario({
  inicial,
  formatos,
  onGuardar,
  onCancelar,
  busy,
  titulo,
}: {
  inicial: typeof PAPEL_VACIO;
  formatos: string[];
  onGuardar: (datos: typeof PAPEL_VACIO) => void;
  onCancelar?: () => void;
  busy?: boolean;
  titulo: string;
}) {
  const [draft, setDraft] = useState(inicial);

  useEffect(() => {
    setDraft(inicial);
  }, [inicial]);

  function setMm(ancho: number, alto: number) {
    setDraft((d) => ({
      ...d,
      ancho_mm: ancho,
      alto_mm: alto,
      ancho_pulg: mmAPulgadas(ancho),
      alto_pulg: mmAPulgadas(alto),
    }));
  }

  function setPulgadas(anchoIn: number, altoIn: number) {
    setMm(pulgadasAMm(anchoIn), pulgadasAMm(altoIn));
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="mb-3 text-xs font-bold text-ink">{titulo}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-muted sm:col-span-2">
          Ref. papel
          <input
            type="text"
            value={draft.ref}
            onChange={(e) => setDraft((d) => ({ ...d, ref: e.target.value }))}
            placeholder="Ej. ETQ-5ML-22x60"
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted">
          Ancho (in)
          <input
            type="number"
            min={0.04}
            step={0.01}
            value={draft.ancho_pulg || mmAPulgadasDisplay(draft.ancho_mm) || ""}
            onChange={(e) => setPulgadas(Number(e.target.value), draft.alto_pulg || mmAPulgadasDisplay(draft.alto_mm))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted">
          Alto (in)
          <input
            type="number"
            min={0.04}
            step={0.01}
            value={draft.alto_pulg || mmAPulgadasDisplay(draft.alto_mm) || ""}
            onChange={(e) => setPulgadas(draft.ancho_pulg || mmAPulgadasDisplay(draft.ancho_mm), Number(e.target.value))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <p className="text-[10px] text-muted sm:col-span-2" title={formatoMedidasEtiquetaTitle(draft.ancho_mm, draft.alto_mm)}>
          Equivale a {draft.ancho_mm || "—"}×{draft.alto_mm || "—"} mm
        </p>
        <label className="text-[10px] text-muted">
          Etiquetas por rollo
          <input
            type="number"
            min={1}
            step={1}
            value={draft.unidades_por_rollo || ""}
            onChange={(e) => setDraft((d) => ({ ...d, unidades_por_rollo: Number(e.target.value) }))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted">
          Rollos en stock
          <input
            type="number"
            min={0}
            step={1}
            value={draft.rollos ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, rollos: Number(e.target.value) }))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted">
          Sueltas (rollo abierto)
          <input
            type="number"
            min={0}
            step={1}
            value={draft.etiquetas_sueltas ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, etiquetas_sueltas: Number(e.target.value) }))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted">
          Mín. rollos
          <input
            type="number"
            min={0}
            step={1}
            value={draft.minimo_rollos ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, minimo_rollos: Number(e.target.value) }))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="text-[10px] text-muted sm:col-span-2">
          Formato vinculado (opcional)
          <select
            value={draft.formato_etiqueta || ""}
            onChange={(e) => {
              const fmt = e.target.value;
              setDraft((d) => ({ ...d, formato_etiqueta: fmt }));
              if (fmt && ETIQUETAS_MM[fmt]) {
                const [aw, ah] = ETIQUETAS_MM[fmt];
                setMm(aw, ah);
              }
            }}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          >
            <option value="">— Sin vincular —</option>
            {formatos.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] text-muted sm:col-span-2">
          Notas
          <input
            type="text"
            value={draft.notas || ""}
            onChange={(e) => setDraft((d) => ({ ...d, notas: e.target.value }))}
            className="mt-1 w-full rounded border border-border bg-surface-input px-2 py-1.5 text-xs text-ink"
          />
        </label>
      </div>
      <p className="mt-2 text-[10px] text-muted">
        Total disponible: <strong>{totalEtiquetasPapel(draft)}</strong> etiquetas
        {draft.unidades_por_rollo > 0 ? ` (${draft.rollos} rollos + ${draft.etiquetas_sueltas} sueltas)` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !draft.ref.trim() || draft.ancho_mm <= 0 || draft.alto_mm <= 0}
          onClick={() => onGuardar(draft)}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted hover:bg-surface-hover">
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

function TabInventarioPapelTinta() {
  const qc = useQueryClient();
  const { data: tiposData } = useTiposEtiqueta();
  const nombresFormatos = useMemo(
    () => (tiposData?.tipos?.length ? tiposData.tipos.map((t) => t.nombre) : ETIQUETAS_LISTA),
    [tiposData?.tipos],
  );
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nuevoPapel, setNuevoPapel] = useState({ ...PAPEL_VACIO });
  const [tipoNuevo, setTipoNuevo] = useState<"papel" | "tinta">("papel");
  const [nombreTintaNuevo, setNombreTintaNuevo] = useState("");
  const [cantTintaNuevo, setCantTintaNuevo] = useState(1);
  const [minTintaNuevo, setMinTintaNuevo] = useState(1);
  const [notasTintaNuevo, setNotasTintaNuevo] = useState("");
  const [errorInventario, setErrorInventario] = useState("");
  const [okInventario, setOkInventario] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["etiquetas-inventario-consumibles"],
    queryFn: async () => {
      const res = await api.get<{ items: InventarioConsumible[] }>("/api/etiquetas/inventario-consumibles");
      return { items: normalizarInventarioItems(res.items ?? []) };
    },
  });

  const crearMut = useMutation({
    mutationFn: (body: Partial<InventarioConsumible>) =>
      api.post<{ ok: boolean; item: InventarioConsumible }>("/api/etiquetas/inventario-consumibles", body),
    onSuccess: (res) => {
      setErrorInventario("");
      setOkInventario("Ítem guardado correctamente.");
      if (res?.item?.tipo === "papel") guardarCachePapelInventario(res.item);
      qc.invalidateQueries({ queryKey: ["etiquetas-inventario-consumibles"] });
      setNuevoPapel({ ...PAPEL_VACIO });
      setNombreTintaNuevo("");
      setCantTintaNuevo(1);
      setMinTintaNuevo(1);
      setNotasTintaNuevo("");
    },
    onError: (e: Error) => setErrorInventario(e.message || "No se pudo guardar el ítem"),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<InventarioConsumible> }) =>
      api.put<{ ok: boolean; item: InventarioConsumible }>(`/api/etiquetas/inventario-consumibles/${id}`, patch),
    onSuccess: (res) => {
      setErrorInventario("");
      setOkInventario("Ítem guardado correctamente.");
      if (res?.item?.tipo === "papel") guardarCachePapelInventario(res.item);
      qc.invalidateQueries({ queryKey: ["etiquetas-inventario-consumibles"] });
      setEditandoId(null);
    },
    onError: (e: Error) => setErrorInventario(e.message || "No se pudo actualizar el ítem"),
  });

  const eliminarMut = useMutation({
    mutationFn: (id: string) => api.delete(`/api/etiquetas/inventario-consumibles/${id}`),
    onSuccess: (_data, id) => {
      eliminarCachePapelInventario(id);
      setErrorInventario("");
      setOkInventario("Ítem eliminado.");
      qc.invalidateQueries({ queryKey: ["etiquetas-inventario-consumibles"] });
      setEditandoId(null);
    },
    onError: (e: Error) => setErrorInventario(e.message || "No se pudo eliminar el ítem"),
  });

  const items = data?.items ?? [];
  const papeles = items.filter(esInventarioPapel);
  const tintas = items.filter((i): i is InventarioTinta => i.tipo === "tinta");

  function papelADraft(p: InventarioPapel): typeof PAPEL_VACIO {
    return papelDesdeItem(p);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 mck-animate-enter">
      <div className="flex items-center gap-3">
        <IllustrationIcon name="package" size={36} tone="leaf" className="mck-illus-icon--hoverable shrink-0" />
        <div>
          <h2 className="text-lg font-bold text-ink">Inventario de papel y tinta</h2>
          <p className="text-xs text-muted">
            Registra rollos por ref. y medida. Al imprimir, el sistema descuenta etiquetas del rollo que coincida con el tamaño.
          </p>
        </div>
      </div>

      <NivelesTintaImpresora />

      {errorInventario && (
        <Banner tone="danger" className="text-xs font-semibold">
          {errorInventario}
        </Banner>
      )}
      {okInventario && (
        <Banner tone="success" className="text-xs font-semibold">
          {okInventario}
        </Banner>
      )}

      {isLoading && <p className="text-sm text-muted">Cargando inventario…</p>}
      {isError && (
        <Banner tone="danger" className="text-xs font-semibold">
          No se pudo cargar el inventario: {(error as Error)?.message || "error de red o sesión"}.
          Cierra sesión y vuelve a entrar si el mensaje habla de autorización.
        </Banner>
      )}

      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
          <Icon name="file" size={16} className="text-accent" />
          Papel / etiquetas
        </p>
        {!isLoading && !isError && papeles.length === 0 ? (
          <p className="mb-3 text-xs text-muted">Sin rollos registrados.</p>
        ) : papeles.length === 0 ? null : (
          <div className="space-y-2">
            {papeles.map((p) => {
              const v = inventarioPapelCompleto(p);
              const total = v.total_etiquetas ?? totalEtiquetasPapel(v);
              const bajo = papelBajoMinimo(v);
              const editando = editandoId === p.id;
              return (
                <div key={p.id} className={`rounded-lg border ${bajo ? "border-warning/30 bg-warning/10" : "border-border bg-surface"}`}>
                  {editando ? (
                    <div className="p-2">
                      <FormularioPapelInventario
                        titulo={`Editar ${v.ref || v.nombre || "rollo"}`}
                        inicial={papelADraft(v)}
                        formatos={nombresFormatos}
                        busy={patchMut.isPending}
                        onCancelar={() => setEditandoId(null)}
                        onGuardar={(datos) => {
                          const patch = bodyPapelInventario(datos);
                          guardarCachePapelInventario({ ...p, ...patch, id: p.id, tipo: "papel" });
                          patchMut.mutate({ id: p.id, patch });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start gap-2 px-3 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-ink">{v.ref}</p>
                        <p className="mt-0.5 text-muted">
                          {formatoMedidasEtiqueta(v.ancho_mm, v.alto_mm) || `${v.ancho_pulg}×${v.alto_pulg} in`}
                          <span className="text-muted"> · {v.ancho_mm}×{v.alto_mm} mm</span>
                        </p>
                        <p className="mt-0.5 text-muted">
                          {v.unidades_por_rollo} u/rollo · {v.rollos} rollos
                          {v.etiquetas_sueltas ? ` + ${v.etiquetas_sueltas} sueltas` : ""}
                        </p>
                        <p className={`mt-1 font-mono font-semibold ${bajo ? "text-warning" : "text-accent"}`}>
                          {total} etiquetas disponibles
                        </p>
                        {v.formato_etiqueta && (
                          <p className="text-[10px] text-muted">Formato impresión: {v.formato_etiqueta}</p>
                        )}
                        {v.notas && <p className="text-[10px] text-muted">{v.notas}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditandoId(p.id)}
                          className="rounded border border-border px-2 py-1 font-semibold hover:bg-surface-hover"
                        >
                          Editar
                        </button>
                        <IconButton
                          icon="trash"
                          label={`Eliminar rollo ${v.ref || v.nombre || ""}`}
                          size="sm"
                          tone="danger"
                          onClick={() => eliminarMut.mutate(p.id)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
          <Icon name="palette" size={16} className="text-accent-plum" />
          Tintas
        </p>
        {tintas.length === 0 ? (
          <p className="text-xs text-muted">Sin registros.</p>
        ) : (
          <div className="space-y-2">
            {tintas.map((it) => {
              const bajo = it.minimo > 0 && it.cantidad <= it.minimo;
              return (
                <div
                  key={it.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    bajo ? "border-warning/30 bg-warning/10" : "border-border bg-surface"
                  }`}
                >
                  <span className="min-w-0 flex-1 font-semibold text-ink">{it.nombre}</span>
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon="minus"
                      label={`Restar unidad a ${it.nombre}`}
                      size="sm"
                      variant="outline"
                      onClick={() => patchMut.mutate({ id: it.id, patch: { cantidad: Math.max(0, it.cantidad - 1) } })}
                    />
                    <span className={`min-w-[4rem] text-center font-mono ${bajo ? "text-warning" : ""}`}>
                      {it.cantidad} {it.unidad}
                    </span>
                    <IconButton
                      icon="plus"
                      label={`Sumar unidad a ${it.nombre}`}
                      size="sm"
                      variant="outline"
                      onClick={() => patchMut.mutate({ id: it.id, patch: { cantidad: it.cantidad + 1 } })}
                    />
                  </div>
                  <span className="text-[10px] text-muted">mín. {it.minimo}</span>
                  {it.notas && <span className="w-full text-[10px] text-muted">{it.notas}</span>}
                  <button
                    type="button"
                    title="Eliminar"
                    onClick={() => eliminarMut.mutate(it.id)}
                    className="ml-auto rounded px-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-3 text-sm font-bold text-ink">Registrar nuevo ítem</p>
        <select
          value={tipoNuevo}
          onChange={(e) => setTipoNuevo(e.target.value as "papel" | "tinta")}
          className="mb-3 rounded border border-border bg-surface px-2 py-1.5 text-xs"
        >
          <option value="papel">Papel / etiquetas</option>
          <option value="tinta">Tinta</option>
        </select>
        {tipoNuevo === "papel" ? (
          <FormularioPapelInventario
            titulo="Nuevo rollo de papel"
            inicial={nuevoPapel}
            formatos={nombresFormatos}
            busy={crearMut.isPending}
            onGuardar={(datos) => {
              const body = bodyPapelInventario(datos);
              crearMut.mutate(body, {
                onSuccess: (res) => {
                  if (res?.item?.id) {
                    guardarCachePapelInventario({ ...body, id: res.item.id, tipo: "papel" });
                  }
                },
              });
            }}
          />
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={nombreTintaNuevo}
              onChange={(e) => setNombreTintaNuevo(e.target.value)}
              placeholder="Ej. Cartucho negro"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1 text-xs text-muted">
                Cant.
                <input type="number" min={0} value={cantTintaNuevo} onChange={(e) => setCantTintaNuevo(Number(e.target.value))} className="w-16 rounded border border-border bg-surface px-2 py-1 text-xs" />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                Mín.
                <input type="number" min={0} value={minTintaNuevo} onChange={(e) => setMinTintaNuevo(Number(e.target.value))} className="w-16 rounded border border-border bg-surface px-2 py-1 text-xs" />
              </label>
            </div>
            <input
              type="text"
              value={notasTintaNuevo}
              onChange={(e) => setNotasTintaNuevo(e.target.value)}
              placeholder="Notas (opcional)"
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!nombreTintaNuevo.trim() || crearMut.isPending}
              onClick={() =>
                crearMut.mutate({
                  tipo: "tinta",
                  nombre: nombreTintaNuevo.trim(),
                  cantidad: cantTintaNuevo,
                  minimo: minTintaNuevo,
                  notas: notasTintaNuevo.trim() || undefined,
                })
              }
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {crearMut.isPending ? "Guardando…" : "Agregar tinta"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function handoffDesdeDatos(datos: DatosEtiqueta): EtiquetasHandoff {
  return {
    tipo_etiqueta: datos.tipo_etiqueta,
    forma: datos.forma,
    calidad: datos.calidad,
    rotacion: datos.rotacion,
    pdf_ruta: datos.pdf_ruta,
    pdf_nombre: datos.pdf_nombre,
    lote_defecto: datos.lote_defecto,
    vencimiento_defecto: datos.vencimiento_defecto,
    lote_pos: datos.lote_pos,
    lote_font: datos.lote_font,
    lote_x_pct: datos.lote_x_pct,
    lote_y_pct: datos.lote_y_pct,
    campos_texto: datos.campos_texto,
    lineas: datos.lineas,
    imagenes: datos.imagenes,
    rectangulos: datos.rectangulos,
  };
}

/** Panel lateral: configurar productos (MeLi, catálogo web). */
export function ConfigurarProductosPanel() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-1 sm:px-0">
      <div>
        <h2 className="text-lg font-bold text-ink">Configurar productos</h2>
        <p className="text-xs text-muted">
          Vincula el ID de publicación MeLi o edita condiciones, características, precios y stock
        </p>
      </div>
      <TabConfigurar />
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────

export default function EtiquetasPanel() {
  const storeTab = useAppStore((s) => s.etiquetasTab);
  const setStoreTab = useAppStore((s) => s.setEtiquetasTab);
  const handoff = useAppStore((s) => s.etiquetasHandoff);
  const setHandoff = useAppStore((s) => s.setEtiquetasHandoff);
  const solicitudActivaStore = useAppStore((s) => s.etiquetasSolicitudActiva);
  const setSolicitudActivaStore = useAppStore((s) => s.setEtiquetasSolicitudActiva);
  const ticketsUser = useTicketsAuth((s) => s.user);
  const verAvanzado = puedeVerEtiquetasAvanzado(ticketsUser);
  const [tab, setTabLocal] = useState<EtiquetasTab>(() => {
    const t = useAppStore.getState().etiquetasTab;
    const user = useTicketsAuth.getState().user;
    if (esTabEtiquetasSoloCynthia(t) && !puedeVerEtiquetasAvanzado(user)) return "imprimir";
    return t === "imprimir" || t === "inventario" || t === "studio" || t === "codigos_ean"
      ? t
      : "imprimir";
  });
  const [precargarImpresion, setPrecargarImpresion] = useState<PrecargarImpresion | null>(null);
  const [solicitudInicial, setSolicitudInicial] = useState<EtiquetasSolicitudActiva | null>(null);
  const setStudioInmersivoStore = useAppStore((s) => s.setEtiquetasStudioInmersivo);
  const [studioInmersivo, setStudioInmersivoLocal] = useState(false);
  const setStudioInmersivo = useCallback((v: boolean) => {
    setStudioInmersivoLocal(v);
    setStudioInmersivoStore(v);
  }, [setStudioInmersivoStore]);

  useEffect(() => () => setStudioInmersivoStore(false), [setStudioInmersivoStore]);

  useEffect(() => {
    if (esTabEtiquetasSoloCynthia(storeTab) && !verAvanzado) {
      setTabLocal("imprimir");
      setStoreTab("imprimir");
      return;
    }
    if (storeTab === "imprimir" || storeTab === "inventario" || storeTab === "studio" || storeTab === "codigos_ean") {
      setTabLocal(storeTab);
      return;
    }
    setTabLocal("imprimir");
    setStoreTab("imprimir");
  }, [storeTab, setStoreTab, verAvanzado]);

  useEffect(() => {
    if (!handoff) return;
    setPrecargarImpresion(handoff as PrecargarImpresion);
    setHandoff(null);
  }, [handoff, setHandoff]);

  useEffect(() => {
    if (!solicitudActivaStore) return;
    setSolicitudInicial(solicitudActivaStore);
    setTab("imprimir");
    setSolicitudActivaStore(null);
  }, [solicitudActivaStore, setSolicitudActivaStore]);

  function setTab(t: EtiquetasTab) {
    if (!puedeVerTabEtiquetas(ticketsUser, t)) {
      setTabLocal("imprimir");
      setStoreTab("imprimir");
      return;
    }
    setTabLocal(t);
    setStoreTab(t);
  }

  const studioFullscreen = tab === "studio" && verAvanzado && studioInmersivo;

  return (
    <div className={`mck-animate-enter px-1 sm:px-0 ${
      studioFullscreen
        ? "flex h-full min-h-0 flex-1 flex-col"
        : tab === "imprimir"
          ? "mx-auto max-w-[min(100%,1600px)]"
          : "mx-auto max-w-6xl space-y-5"
    }`}>
      {tab === "imprimir" && (
        <TabImprimir
          precargar={precargarImpresion}
          solicitudInicial={solicitudInicial}
          onPrecargarConsumido={() => setPrecargarImpresion(null)}
          onSolicitudInicialConsumida={() => setSolicitudInicial(null)}
          onIrInventarioTinta={verAvanzado ? () => setTab("inventario") : undefined}
        />
      )}
      {tab === "studio" && verAvanzado && (
        <PlantillasVisualesPanel onInmersivoChange={setStudioInmersivo} />
      )}
      {tab === "inventario" && verAvanzado && <TabInventarioPapelTinta />}
      {tab === "codigos_ean" && verAvanzado && <CodigosEanPanel />}
    </div>
  );
}
