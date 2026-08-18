import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  alinearElementos,
  agruparElementosPorIds,
  boundsElemento,
  clonarElementoIndependiente,
  desagruparElementosPorIds,
  esFuenteMontserrat,
  FUENTE_MONTSERRAT_FAMILY,
  elementoImagenDefecto,
  elementoLineaDefecto,
  elementoRectDefecto,
  elementoTextoDefecto,
  escalarPlantillaAFormato,
  TAMANO_TEXTO_DEFECTO,
  PASO_TAMANO_TEXTO,
  TAMANO_TEXTO_MIN,
  TAMANO_TEXTO_MAX,
  ajustarTamanoTexto,
  labelFormato,
  patchMoverElemento,
  posicionNuevoElemento,
  presetExportImpresionDefault,
  pesoMontserratVariante,
  resolverSeleccionAlClic,
  seleccionTieneGrupo,
  snapLinea90,
  unionBounds,
  idsSeleccionVentana,
  VARIANTES_MONTSERRAT,
  varianteDesdeFontWeight,
  zoomAjusteLienzo,
  pesoFontWeightCss,
  nuevoGroupId,
  type AlineacionObjetos,
  type ElementoTexto,
  type ElementoVisual,
  type FormatoCanvas,
  type PlantillaVisualDoc,
  contextoCapasParaDescripcion,
  inferirRolTextoCapa,
  labelCapaElemento,
  labelRolTextoCapa,
} from "../../lib/plantillasVisuales";
import { dimensionesImagenParaLienzo } from "../../lib/plantillasVisualesImagen";
import {
  autoCorregirConSeleccion,
  autoCorregirTextoContenido,
} from "../../lib/autoCorregirTexto";
import { GHSIconsPicker } from "../GHSIconsPicker";
import { CodigoBarrasEAN13 } from "../CodigoBarrasEAN13";
import GaleriaImagenesModal from "./GaleriaImagenesModal";
import CambiarFormatoModal from "./CambiarFormatoModal";
import ImagenCanvasElement from "./ImagenCanvasElement";
import BarraContenidoTexto from "./BarraContenidoTexto";
import TextoCapaLienzo from "./TextoCapaLienzo";
import { geometriaArco, alturaCajaTexto } from "./TextoArcoSvg";
import { buscarCasPorTitulo } from "../../lib/textoMagicoApi";
import { studio } from "./studioUi";

interface Props {
  doc: PlantillaVisualDoc;
  onChange: (doc: PlantillaVisualDoc) => void;
  onGuardar: () => void;
  onDuplicar?: () => void;
  onVolver: () => void;
  onExportar: (escala: number) => void;
  guardando?: boolean;
  duplicando?: boolean;
  exportando?: boolean;
  /** Hay cambios sin guardar desde el último `onGuardar` exitoso. */
  dirty?: boolean;
}

function ToolBtn({
  title,
  onClick,
  children,
  danger,
  active,
  className = "",
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-active={active || undefined}
      onClick={onClick}
      className={`${danger ? studio.toolBtnDanger : studio.toolBtn} ${className}`}
    >
      {children}
    </button>
  );
}

function ToolSep() {
  return <div className={`my-1 h-px w-6 ${studio.sep}`} />;
}

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type DragMode =
  | "move"
  | `resize-${ResizeCorner}`
  | "resize-line-end"
  | "resize-grupo"
  | "rotate"
  | null;

/** Nodos estilo Illustrator: cuadrado mínimo, hit area un poco mayor. */
const NODO_VIS_PX = 6;
/** Área clicable de asas (rotado/redimensionar). Antes 10px era impracticable con zoom. */
const NODO_HIT_PX = 22;
const MARCO_SELECCION_CSS = "1px solid rgba(1, 109, 130, 0.82)";
const MARCO_HOVER_CSS = "1px dashed rgba(1, 109, 130, 0.32)";
/** Espacio reservado para las barras de scroll del viewport del lienzo. */
const RESERVA_SCROLL_PX = 16;

const CORNERS: { id: ResizeCorner; cursor: string }[] = [
  { id: "nw", cursor: "nw-resize" },
  { id: "ne", cursor: "ne-resize" },
  { id: "sw", cursor: "sw-resize" },
  { id: "se", cursor: "se-resize" },
];

function esModoResizeEsquina(mode: DragMode): mode is `resize-${ResizeCorner}` {
  return (
    mode === "resize-nw" ||
    mode === "resize-ne" ||
    mode === "resize-sw" ||
    mode === "resize-se"
  );
}

export function estiloElemento(el: ElementoVisual): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.type === "line" ? Math.abs((el.x2 ?? el.x) - el.x) || el.width : el.width,
    height: el.type === "line" ? Math.abs((el.y2 ?? el.y) - el.y) || el.height : el.height,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
    zIndex: el.zIndex,
    cursor: el.locked ? "default" : "move",
  };
  return base;
}

/** Posición en el stage del editor (artboard + margen pasteboard para objetos fuera). */
export function estiloElementoEnStage(
  el: ElementoVisual,
  pasteboard: number,
): React.CSSProperties {
  const base = estiloElemento(el);
  return {
    ...base,
    left: (typeof base.left === "number" ? base.left : el.x) + pasteboard,
    top: (typeof base.top === "number" ? base.top : el.y) + pasteboard,
  };
}

/** Área clicable de un texto: cubre el glifo completo (sin tope artificial de 8 líneas). */
function tamanoHitTexto(el: ElementoTexto): { w: number; h: number } {
  const lh = el.lineHeight ?? 1.25;
  const raw = el.content ?? "";
  const lineasExplicitas = Math.max(1, raw.split("\n").length);
  const chars = Math.max(1, raw.replace(/\n/g, "").length);
  const anchoChar = Math.max(4.5, el.fontSize * 0.52);
  const anchoUtil = Math.max(el.width, 8);
  const lineasWrap = Math.max(1, Math.ceil((chars * anchoChar) / anchoUtil));
  const lineas = Math.max(lineasExplicitas, lineasWrap);
  const h = Math.max(
    el.height,
    Math.ceil(el.fontSize * lh * lineas) + 6,
    Math.ceil(el.fontSize * lh) + 4,
    16,
  );
  const w = Math.max(el.width, 16);
  return { w, h };
}

/**
 * Normaliza ángulo a 0 | 90 | 180 | 270 para colocar el arco en un borde.
 */
function snapRotacionCardinal(rotationDeg: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(rotationDeg) % 360) + 360) % 360;
  if (r <= 45 || r >= 315) return 0;
  if (r < 135) return 90;
  if (r < 225) return 180;
  return 270;
}

/** AABB del rectángulo w×h rotado 0/90/180/270° alrededor de su centro. */
function aabbArcoRotado(boxW: number, boxH: number, rotationDeg: number) {
  const snap = snapRotacionCardinal(rotationDeg);
  const swap = snap === 90 || snap === 270;
  return {
    snap,
    aabbW: swap ? boxH : boxW,
    aabbH: swap ? boxW : boxH,
  };
}

/**
 * Reduce el ancho del arco hasta que, con la rotación dada, el AABB quepa
 * entero en el artboard (con margen). Así 90°/270° no disparan el texto al gris.
 */
function dimensionarArcoEnArtboard(
  canvasW: number,
  canvasH: number,
  boxWDeseado: number,
  fontSize: number,
  arco: number,
  rotationDeg: number,
): { boxW: number; boxH: number } {
  const m = Math.max(8, Math.round(Math.min(canvasW, canvasH) * 0.04));
  const square = Math.abs(arco) >= 150;
  const maxSide = Math.max(48, Math.min(canvasW, canvasH) - 2 * m);

  if (square) {
    const d = Math.min(maxSide, Math.max(48, boxWDeseado));
    return { boxW: d, boxH: d };
  }

  // Con rotación 90/270, el ANCHO del arco pasa a ser la ALTURA del AABB.
  const snap = snapRotacionCardinal(rotationDeg);
  const maxWPorRot =
    snap === 90 || snap === 270 ? canvasH - 2 * m : canvasW - 2 * m;
  const maxHPorRot =
    snap === 90 || snap === 270 ? canvasW - 2 * m : canvasH - 2 * m;

  let boxW = Math.min(Math.max(48, boxWDeseado), maxWPorRot, maxSide);
  let boxH = Math.ceil(geometriaArco(boxW, fontSize, arco).altoTotal);

  // Encoger hasta que alto geométrico también quepa en el AABB permitido.
  let guard = 0;
  while (boxH > maxHPorRot && boxW > 48 && guard < 80) {
    boxW = Math.max(48, boxW - 6);
    boxH = Math.ceil(geometriaArco(boxW, fontSize, arco).altoTotal);
    guard += 1;
  }
  if (boxH > maxHPorRot) {
    boxH = Math.max(Math.ceil(fontSize * 1.5), Math.floor(maxHPorRot));
  }
  return { boxW: Math.round(boxW), boxH: Math.round(boxH) };
}

/**
 * Coloca el centro del elemento para que el AABB rotado quede DENTRO del
 * artboard. `ancla` fuerza el borde (p. ej. curvatura “Abajo” con rotación 0).
 */
function posicionArcoEnArtboard(
  canvasW: number,
  canvasH: number,
  boxW: number,
  boxH: number,
  rotationDeg: number,
  ancla?: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  const m = Math.max(8, Math.round(Math.min(canvasW, canvasH) * 0.04));
  const snap = ancla ?? snapRotacionCardinal(rotationDeg);
  const { aabbW, aabbH } = aabbArcoRotado(boxW, boxH, rotationDeg);

  const fitW = Math.min(aabbW, Math.max(8, canvasW - 2 * m));
  const fitH = Math.min(aabbH, Math.max(8, canvasH - 2 * m));

  let cx = canvasW / 2;
  let cy = canvasH / 2;
  if (snap === 0) cy = m + fitH / 2;
  else if (snap === 180) cy = canvasH - m - fitH / 2;
  else if (snap === 90) cx = canvasW - m - fitW / 2;
  else if (snap === 270) cx = m + fitW / 2;

  cx = Math.min(canvasW - m - fitW / 2, Math.max(m + fitW / 2, cx));
  cy = Math.min(canvasH - m - fitH / 2, Math.max(m + fitH / 2, cy));

  return {
    x: Math.round(cx - boxW / 2),
    y: Math.round(cy - boxH / 2),
  };
}

/** Recentra sin cambiar de borde: el AABB rotado debe quedar dentro. */
function centrarCajaEnArtboard(
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW: number,
  canvasH: number,
  rotationDeg = 0,
): { x: number; y: number } {
  const m = Math.max(8, Math.round(Math.min(canvasW, canvasH) * 0.04));
  const { aabbW, aabbH } = aabbArcoRotado(w, h, rotationDeg);
  const fitW = Math.min(aabbW, Math.max(8, canvasW - 2 * m));
  const fitH = Math.min(aabbH, Math.max(8, canvasH - 2 * m));
  let cx = x + w / 2;
  let cy = y + h / 2;
  cx = Math.min(canvasW - m - fitW / 2, Math.max(m + fitW / 2, cx));
  cy = Math.min(canvasH - m - fitH / 2, Math.max(m + fitH / 2, cy));
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
}

/** Margen alrededor del artboard para poder seleccionar/mover objetos fuera del área. */
export function margenPasteboard(
  elementos: ElementoVisual[],
  canvasW: number,
  canvasH: number,
  minimo = 120,
): number {
  let extra = minimo;
  for (const el of elementos) {
    if (el.visible === false) continue;
    const b = boundsElemento(el);
    extra = Math.max(
      extra,
      minimo - Math.min(0, b.left),
      minimo - Math.min(0, b.top),
      minimo + Math.max(0, b.right - canvasW),
      minimo + Math.max(0, b.bottom - canvasH),
    );
  }
  return Math.min(2400, Math.ceil(extra));
}

function mostrandoCajaArrastre(
  elId: string,
  sel: boolean,
  esPrincipal: boolean,
  drag: {
    ids: string[];
    mode: DragMode;
  } | null,
): boolean {
  return (
    sel &&
    esPrincipal &&
    !!drag &&
    drag.ids.includes(elId) &&
    (drag.mode === "move" ||
      esModoResizeEsquina(drag.mode) ||
      drag.mode === "rotate" ||
      drag.mode === "resize-line-end")
  );
}

function SeleccionChrome({
  width,
  height,
  showFrame,
  showHandles,
  hover,
  onRotate,
  onResize,
}: {
  width: number;
  height: number;
  showFrame: boolean;
  showHandles: boolean;
  hover?: boolean;
  onRotate: (e: ReactPointerEvent) => void;
  onResize: (e: ReactPointerEvent, corner: ResizeCorner) => void;
}) {
  if (!showFrame && !hover && !showHandles) return null;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const border = showHandles || showFrame ? MARCO_SELECCION_CSS : MARCO_HOVER_CSS;

  const startAsa = (
    e: ReactPointerEvent,
    fn: (ev: ReactPointerEvent) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  };

  return (
    <>
      {/* Solo marco visual: NUNCA captura clics (el arrastre lo hace el elemento). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w,
          height: h,
          boxSizing: "border-box",
          border,
          pointerEvents: "none",
          zIndex: 20,
          overflow: "visible",
        }}
      />
      {showHandles && (
        <>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: w / 2,
              top: -14,
              width: 1,
              height: 14,
              transform: "translateX(-50%)",
              background: "rgba(1, 109, 130, 0.4)",
              pointerEvents: "none",
              zIndex: 21,
            }}
          />
          <div
            role="button"
            tabIndex={-1}
            data-asa="rotate"
            title="Rotar (mantén Shift para 15°)"
            aria-label="Rotar"
            style={{
              position: "absolute",
              left: w / 2,
              top: -18,
              width: NODO_HIT_PX,
              height: NODO_HIT_PX,
              transform: "translate(-50%, -50%)",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "grab",
              pointerEvents: "auto",
              zIndex: 50,
              touchAction: "none",
            }}
            onPointerDown={(e) => startAsa(e, onRotate)}
          >
            <span
              style={{
                width: Math.max(NODO_VIS_PX, 10),
                height: Math.max(NODO_VIS_PX, 10),
                borderRadius: 999,
                border: "2px solid #016d82",
                background: "#fff",
                boxShadow: "0 0 0 2px rgba(1,109,130,0.25)",
                pointerEvents: "none",
              }}
            />
          </div>
          {CORNERS.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={-1}
              data-asa={c.id}
              title={`Redimensionar ${c.id}`}
              aria-label={`Redimensionar ${c.id}`}
              style={{
                position: "absolute",
                left: c.id.includes("w") ? 0 : w,
                top: c.id.includes("n") ? 0 : h,
                width: NODO_HIT_PX,
                height: NODO_HIT_PX,
                transform: "translate(-50%, -50%)",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: c.cursor,
                pointerEvents: "auto",
                zIndex: 30,
                touchAction: "none",
              }}
              onPointerDown={(e) => startAsa(e, (ev) => onResize(ev, c.id))}
            >
              <span
                style={{
                  width: NODO_VIS_PX,
                  height: NODO_VIS_PX,
                  borderRadius: 0.5,
                  border: "1px solid #016d82",
                  background: "#fff",
                  pointerEvents: "none",
                }}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

export default function VisualCanvasEditor({
  doc,
  onChange,
  onGuardar,
  onDuplicar,
  onVolver,
  onExportar,
  guardando,
  duplicando,
  exportando,
  dirty,
}: Props) {
  const [seleccionIds, setSeleccionIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const zoomManualRef = useRef(false);
  const [drag, setDrag] = useState<{
    ids: string[];
    mode: DragMode;
    startX: number;
    startY: number;
    origs: Map<string, ElementoVisual>;
    rotateStartAngle?: number;
    rotateOrig?: number;
    /** Redimensionar grupo: esquina fija (ancla) y esquina arrastrada. */
    grupoAnchor?: { x: number; y: number };
    grupoCorner0?: { x: number; y: number };
    /** true cuando el gesto ya superó el umbral de arrastre */
    moved?: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    shift: boolean;
    baseIds: string[];
  } | null>(null);
  const elementosRef = useRef(doc.elementos);
  elementosRef.current = doc.elementos;
  const seleccionIdsRef = useRef(seleccionIds);
  seleccionIdsRef.current = seleccionIds;
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const [cambiarFormatoAbierto, setCambiarFormatoAbierto] = useState(false);
  const [coloresAbierto, setColoresAbierto] = useState(false);
  const [colorDesde, setColorDesde] = useState<string | null>(null);
  const [colorHacia, setColorHacia] = useState("#0396f1");
  // Etiquetas: 600 DPI (Epson). Otros formatos: mejor preset disponible.
  const presetExportActivo = useMemo(
    () => presetExportImpresionDefault(doc.formato),
    [doc.formato],
  );
  const escalaExport = presetExportActivo?.escala ?? 1;
  const [ghsAbierto, setGhsAbierto] = useState(false);
  const [ean13Abierto, setEan13Abierto] = useState(false);
  // Ancho del panel derecho (ajustable). Capas + textos van en un solo scroll
  // para no dividir la mirada entre dos pantallas.
  const [panelAncho, setPanelAncho] = useState(340);
  const [capasAbiertas, setCapasAbiertas] = useState(false);
  const resizingPanelRef = useRef<{ kind: "ancho"; startPos: number; startVal: number } | null>(null);
  const suppressDeselectRef = useRef(false);
  const contenidoTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contenidoSeleccionRef = useRef<{ start: number; end: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [casAutoEstado, setCasAutoEstado] = useState<"idle" | "cargando" | "error">("idle");
  const [capaArrastradaId, setCapaArrastradaId] = useState<string | null>(null);
  const [capaSobreId, setCapaSobreId] = useState<string | null>(null);
  const [renombrandoCapaId, setRenombrandoCapaId] = useState<string | null>(null);
  const [renombrandoCapaTexto, setRenombrandoCapaTexto] = useState("");
  const renombrarCapaInputRef = useRef<HTMLInputElement | null>(null);
  const [editandoInlineId, setEditandoInlineId] = useState<string | null>(null);
  const [editandoInlineTexto, setEditandoInlineTexto] = useState("");
  const editandoInlineRef = useRef<HTMLTextAreaElement | null>(null);
  const editandoInlineBlurTimerRef = useRef<number | null>(null);
  const editandoInlineTextoRef = useRef("");
  const editandoInlineIdRef = useRef<string | null>(null);
  editandoInlineTextoRef.current = editandoInlineTexto;
  editandoInlineIdRef.current = editandoInlineId;

  function commitEditInline() {
    if (editandoInlineBlurTimerRef.current != null) {
      window.clearTimeout(editandoInlineBlurTimerRef.current);
      editandoInlineBlurTimerRef.current = null;
    }
    const id = editandoInlineIdRef.current;
    if (id) {
      patchElemento(id, {
        content: autoCorregirTextoContenido(editandoInlineTextoRef.current),
      });
    }
    setEditandoInlineId(null);
    setEditandoInlineTexto("");
    editandoInlineIdRef.current = null;
  }
  function cancelEditInline() {
    if (editandoInlineBlurTimerRef.current != null) {
      window.clearTimeout(editandoInlineBlurTimerRef.current);
      editandoInlineBlurTimerRef.current = null;
    }
    setEditandoInlineId(null);
    setEditandoInlineTexto("");
    editandoInlineIdRef.current = null;
  }

  const seleccionado = useMemo(() => {
    if (seleccionIds.length !== 1) return null;
    return doc.elementos.find((e) => e.id === seleccionIds[0]) ?? null;
  }, [doc.elementos, seleccionIds]);

  const seleccionPrincipalId = seleccionIds[seleccionIds.length - 1] ?? null;

  // Cuando la selección es exactamente un grupo (2+ elementos con el mismo
  // groupId), se dibuja una caja sobre toda su área para poder arrastrar el
  // grupo desde los huecos entre elementos, no solo desde encima de cada uno.
  const elementosGrupoActivo = useMemo(() => {
    if (seleccionIds.length < 2) return null;
    const elementos = seleccionIds
      .map((id) => doc.elementos.find((e) => e.id === id))
      .filter((e): e is ElementoVisual => !!e);
    if (elementos.length !== seleccionIds.length) return null;
    const gid = elementos[0].groupId;
    if (!gid) return null;
    if (!elementos.every((e) => e.groupId === gid)) return null;
    return elementos;
  }, [seleccionIds, doc.elementos]);

  const cajaGrupoActivo = useMemo(() => {
    if (!elementosGrupoActivo) return null;
    return unionBounds(elementosGrupoActivo.map(boundsElemento));
  }, [elementosGrupoActivo]);

  const maxZ = useMemo(
    () => doc.elementos.reduce((m, e) => Math.max(m, e.zIndex), 0),
    [doc.elementos],
  );

  const minZ = useMemo(
    () => doc.elementos.reduce((m, e) => Math.min(m, e.zIndex), 0),
    [doc.elementos],
  );

  const patchElementos = useCallback(
    (updater: (els: ElementoVisual[]) => ElementoVisual[]) => {
      onChange({ ...doc, elementos: updater(doc.elementos) });
    },
    [doc, onChange],
  );

  // Historial (Ctrl+Z / Ctrl+Shift+Z). Los cambios seguidos en menos de
  // HISTORIAL_DEBOUNCE_MS (arrastrar, escribir en "Contenido") se agrupan en
  // un solo paso, para que un gesto completo se deshaga de una vez.
  const HISTORIAL_DEBOUNCE_MS = 500;
  const MAX_HISTORIAL = 60;
  type SnapshotHistorial = { elementos: ElementoVisual[]; fondo: string };
  const historialRef = useRef<{ pasado: SnapshotHistorial[]; futuro: SnapshotHistorial[] }>({
    pasado: [],
    futuro: [],
  });
  const historialDocIdRef = useRef(doc.id);
  const historialAnteriorRef = useRef<SnapshotHistorial>({ elementos: doc.elementos, fondo: doc.fondo });
  const historialRafagaActivaRef = useRef(false);
  const historialAplicandoRef = useRef(false);
  const historialDebounceRef = useRef<number | null>(null);
  const [historialVersion, setHistorialVersion] = useState(0);

  useEffect(() => {
    // Plantilla distinta (duplicar/abrir otra sin desmontar el editor): el
    // historial de una no debe filtrarse a la otra.
    if (historialDocIdRef.current !== doc.id) {
      historialDocIdRef.current = doc.id;
      historialRef.current = { pasado: [], futuro: [] };
      historialRafagaActivaRef.current = false;
      historialAplicandoRef.current = false;
      if (historialDebounceRef.current) {
        window.clearTimeout(historialDebounceRef.current);
        historialDebounceRef.current = null;
      }
      historialAnteriorRef.current = { elementos: doc.elementos, fondo: doc.fondo };
      setHistorialVersion((v) => v + 1);
      return;
    }

    const anterior = historialAnteriorRef.current;
    historialAnteriorRef.current = { elementos: doc.elementos, fondo: doc.fondo };

    if (historialAplicandoRef.current) {
      historialAplicandoRef.current = false;
      return;
    }
    if (anterior.elementos === doc.elementos && anterior.fondo === doc.fondo) return;

    if (!historialRafagaActivaRef.current) {
      historialRef.current.pasado.push(anterior);
      if (historialRef.current.pasado.length > MAX_HISTORIAL) historialRef.current.pasado.shift();
      historialRef.current.futuro = [];
      historialRafagaActivaRef.current = true;
      setHistorialVersion((v) => v + 1);
    }
    if (historialDebounceRef.current) window.clearTimeout(historialDebounceRef.current);
    historialDebounceRef.current = window.setTimeout(() => {
      historialRafagaActivaRef.current = false;
      historialDebounceRef.current = null;
    }, HISTORIAL_DEBOUNCE_MS);
  }, [doc.id, doc.elementos, doc.fondo]);

  useEffect(
    () => () => {
      if (historialDebounceRef.current) window.clearTimeout(historialDebounceRef.current);
    },
    [],
  );

  const deshacer = useCallback(() => {
    const h = historialRef.current;
    if (h.pasado.length === 0) return;
    const previo = h.pasado.pop()!;
    h.futuro.push({ elementos: doc.elementos, fondo: doc.fondo });
    historialRafagaActivaRef.current = false;
    historialAplicandoRef.current = true;
    if (historialDebounceRef.current) {
      window.clearTimeout(historialDebounceRef.current);
      historialDebounceRef.current = null;
    }
    setHistorialVersion((v) => v + 1);
    onChange({ ...doc, elementos: previo.elementos, fondo: previo.fondo });
  }, [doc, onChange]);

  const rehacer = useCallback(() => {
    const h = historialRef.current;
    if (h.futuro.length === 0) return;
    const siguiente = h.futuro.pop()!;
    h.pasado.push({ elementos: doc.elementos, fondo: doc.fondo });
    historialRafagaActivaRef.current = false;
    historialAplicandoRef.current = true;
    if (historialDebounceRef.current) {
      window.clearTimeout(historialDebounceRef.current);
      historialDebounceRef.current = null;
    }
    setHistorialVersion((v) => v + 1);
    onChange({ ...doc, elementos: siguiente.elementos, fondo: siguiente.fondo });
  }, [doc, onChange]);

  const puedeDeshacer = historialVersion >= 0 && historialRef.current.pasado.length > 0;
  const puedeRehacer = historialVersion >= 0 && historialRef.current.futuro.length > 0;

  const aplicarNuevoFormato = useCallback(
    (formato: FormatoCanvas, categoriaId: string) => {
      setCambiarFormatoAbierto(false);
      if (
        formato.ancho_px === doc.formato.ancho_px &&
        formato.alto_px === doc.formato.alto_px &&
        formato.id === doc.formato.id
      ) {
        return;
      }
      // El historial solo versiona elementos+fondo; con otro lienzo esas
      // instantáneas quedan en coordenadas inválidas.
      historialRef.current = { pasado: [], futuro: [] };
      historialRafagaActivaRef.current = false;
      historialAplicandoRef.current = true;
      if (historialDebounceRef.current) {
        window.clearTimeout(historialDebounceRef.current);
        historialDebounceRef.current = null;
      }
      setHistorialVersion((v) => v + 1);
      onChange(escalarPlantillaAFormato(doc, formato, categoriaId));
    },
    [doc, onChange],
  );

  /** Colores usados en textos, líneas y recuadros (para reemplazo global). */
  const coloresPlantilla = useMemo(() => {
    const conteo = new Map<string, number>();
    const sumar = (c?: string) => {
      const k = (c || "").trim().toLowerCase();
      if (!k || k === "transparent" || k === "none") return;
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    };
    for (const el of doc.elementos) {
      if (el.type === "text") sumar(el.color);
      else if (el.type === "line") sumar(el.stroke);
      else if (el.type === "rect") {
        sumar(el.fill);
        sumar(el.stroke);
      }
    }
    return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  }, [doc.elementos]);

  /** Reemplaza un color en TODOS los elementos que lo usan (títulos,
   *  subtítulos, líneas, recuadros…). Un solo cambio → un solo deshacer. */
  const reemplazarColorGlobal = useCallback(
    (desde: string, hacia: string) => {
      const d = desde.trim().toLowerCase();
      const h = hacia.trim();
      if (!d || !h || d === h.toLowerCase()) return;
      onChange({
        ...doc,
        elementos: doc.elementos.map((el) => {
          if (el.type === "text" && (el.color || "").trim().toLowerCase() === d) {
            return { ...el, color: h };
          }
          if (el.type === "line" && (el.stroke || "").trim().toLowerCase() === d) {
            return { ...el, stroke: h };
          }
          if (el.type === "rect") {
            const f = (el.fill || "").trim().toLowerCase() === d;
            const s = (el.stroke || "").trim().toLowerCase() === d;
            if (f || s) {
              return { ...el, ...(f ? { fill: h } : null), ...(s ? { stroke: h } : null) };
            }
          }
          return el;
        }),
      });
      setColorDesde(null);
    },
    [doc, onChange],
  );

  /** Inicia el redimensionado proporcional de un grupo desde una esquina. */
  const iniciarResizeGrupo = (e: ReactPointerEvent, corner: ResizeCorner) => {
    if (!elementosGrupoActivo || !cajaGrupoActivo) return;
    e.preventDefault();
    e.stopPropagation();
    const b = cajaGrupoActivo;
    const esquinas = {
      nw: { x: b.left, y: b.top },
      ne: { x: b.right, y: b.top },
      sw: { x: b.left, y: b.bottom },
      se: { x: b.right, y: b.bottom },
    } as const;
    const opuesta = { nw: "se", ne: "sw", sw: "ne", se: "nw" } as const;
    const origs = new Map<string, ElementoVisual>();
    for (const el of elementosGrupoActivo) origs.set(el.id, structuredClone(el));
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const full = {
      ids: elementosGrupoActivo.map((el) => el.id),
      mode: "resize-grupo" as DragMode,
      startX: e.clientX,
      startY: e.clientY,
      origs,
      grupoAnchor: esquinas[opuesta[corner]],
      grupoCorner0: esquinas[corner],
      moved: true,
    };
    dragRef.current = full;
    setDrag(full);
  };

  const patchElemento = useCallback(
    (id: string, patch: Partial<ElementoVisual>) => {
      patchElementos((els) =>
        els.map((e) => (e.id === id ? ({ ...e, ...patch } as ElementoVisual) : e)),
      );
    },
    [patchElementos],
  );

  const actualizarContenidoTexto = useCallback(
    (id: string, valor: string, opts?: { autocorregir?: boolean; selStart?: number; selEnd?: number }) => {
      const autocorregir = opts?.autocorregir ?? false;
      if (!autocorregir) {
        patchElemento(id, { content: valor });
        return;
      }
      const start = opts?.selStart ?? valor.length;
      const end = opts?.selEnd ?? start;
      const { texto, selStart: ns, selEnd: ne } = autoCorregirConSeleccion(
        valor,
        start,
        end,
      );
      if (texto !== valor) {
        contenidoSeleccionRef.current = { start: ns, end: ne };
      }
      patchElemento(id, { content: texto });
    },
    [patchElemento],
  );

  useLayoutEffect(() => {
    const pos = contenidoSeleccionRef.current;
    const ta = contenidoTextareaRef.current;
    if (!pos || !ta) return;
    ta.setSelectionRange(pos.start, pos.end);
    contenidoSeleccionRef.current = null;
  }, [
    seleccionado?.type === "text" ? seleccionado.content : null,
    seleccionado?.id,
  ]);

  const alternarBloqueo = useCallback(
    (id: string) => {
      const el = doc.elementos.find((e) => e.id === id);
      if (!el) return;
      patchElemento(id, { locked: !el.locked });
    },
    [doc.elementos, patchElemento],
  );

  const agregarTexto = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 40, 20);
    const base = elementoTextoDefecto(x, y);
    const el: ElementoTexto = {
      ...base,
      fontSize: TAMANO_TEXTO_DEFECTO,
      height: Math.ceil(TAMANO_TEXTO_DEFECTO * 1.6),
      zIndex: maxZ + 1,
    };
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  /** Texto en arco simple (curvatura arriba/abajo), como antes. */
  const agregarTextoMarcoCircular = () => {
    const canvasW = doc.formato.ancho_px;
    const canvasH = doc.formato.alto_px;
    const fs = 16;
    const arco = 80;
    const deseado = Math.min(260, Math.max(120, Math.round(canvasW * 0.65)));
    const { boxW, boxH } = dimensionarArcoEnArtboard(
      canvasW,
      canvasH,
      deseado,
      fs,
      arco,
      0,
    );
    const pos = posicionArcoEnArtboard(canvasW, canvasH, boxW, boxH, 0);
    const base = elementoTextoDefecto(pos.x, pos.y);
    const el: ElementoTexto = {
      ...base,
      content: "NOMBRE DEL PRODUCTO",
      width: boxW,
      height: boxH,
      fontSize: fs,
      fontWeight: "700",
      align: "center",
      color: "#c4781a",
      arco,
      arcoGrados: undefined,
      arcoPosicion: undefined,
      forma: undefined,
      marcoAncho: 0,
      rotation: 0,
      zIndex: maxZ + 1,
    };
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  /**
   * Aplica curvatura/orientación y deja el texto DENTRO del artboard.
   * En 90°/270° el ancho del arco se convierte en alto visual: se reduce
   * para no salirse al área gris.
   */
  const aplicarArcoPreset = (
    arco: number,
    extras?: {
      rotation?: number;
      reposicionar?: boolean;
      ancla?: 0 | 90 | 180 | 270;
    },
  ) => {
    if (!seleccionado || seleccionado.type !== "text") return;
    const fs = seleccionado.fontSize || 12;
    const canvasW = doc.formato.ancho_px;
    const canvasH = doc.formato.alto_px;
    const rotation =
      extras?.rotation !== undefined
        ? extras.rotation
        : Math.round(seleccionado.rotation || 0);

    if (arco === 0) {
      const h = Math.ceil(fs * 1.6);
      const w = Math.min(
        Math.max(40, seleccionado.width),
        Math.max(40, canvasW - 16),
      );
      const pos = centrarCajaEnArtboard(
        seleccionado.x,
        seleccionado.y,
        w,
        h,
        canvasW,
        canvasH,
        rotation,
      );
      patchElemento(seleccionado.id, {
        arco: 0,
        arcoGrados: undefined,
        arcoPosicion: undefined,
        marcoAncho: 0,
        width: w,
        height: h,
        x: pos.x,
        y: pos.y,
        rotation,
      });
      return;
    }

    const { boxW, boxH } = dimensionarArcoEnArtboard(
      canvasW,
      canvasH,
      Math.max(40, seleccionado.width),
      fs,
      arco,
      rotation,
    );
    const reposicionar =
      extras?.reposicionar === true ||
      extras?.rotation !== undefined ||
      extras?.ancla !== undefined ||
      Math.abs(arco) >= 150;
    const ancla =
      extras?.ancla ??
      (reposicionar ? snapRotacionCardinal(rotation) : undefined);
    const pos = reposicionar
      ? posicionArcoEnArtboard(canvasW, canvasH, boxW, boxH, rotation, ancla)
      : centrarCajaEnArtboard(
          seleccionado.x,
          seleccionado.y,
          boxW,
          boxH,
          canvasW,
          canvasH,
          rotation,
        );

    patchElemento(seleccionado.id, {
      arco,
      arcoGrados: undefined,
      arcoPosicion: undefined,
      forma: undefined,
      width: boxW,
      height: boxH,
      x: pos.x,
      y: pos.y,
      rotation,
      marcoAncho:
        Math.abs(arco) >= 150
          ? seleccionado.marcoAncho && seleccionado.marcoAncho > 0
            ? seleccionado.marcoAncho
            : 1.5
          : seleccionado.marcoAncho ?? 0,
    });
  };

  const agregarRect = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 56, 96);
    const el = elementoRectDefecto(x, y);
    el.zIndex = maxZ + 1;
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const agregarCirculo = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 56, 96);
    const el = elementoRectDefecto(x, y);
    // Un círculo es un rect cuadrado con radio de borde a tope: mismo modelo
    // de datos, así hereda relleno/borde/rotación y todas las exportaciones.
    el.width = 90;
    el.height = 90;
    el.borderRadius = 9999;
    el.zIndex = maxZ + 1;
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const agregarLinea = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 40, 176);
    const el = elementoLineaDefecto(x, y);
    el.zIndex = maxZ + 1;
    patchElementos((els) => [...els, el]);
    setSeleccionIds([el.id]);
  };

  const insertarImagen = useCallback(
    (src: string) => {
      void (async () => {
        const { x, y } = posicionNuevoElemento(doc.elementos.length, 72, 72);
        const el = elementoImagenDefecto(src, x, y);
        try {
          const dims = await dimensionesImagenParaLienzo(src);
          el.width = dims.width;
          el.height = dims.height;
        } catch {
          /* mantiene tamaño por defecto */
        }
        el.zIndex = maxZ + 1;
        patchElementos((els) => [...els, el]);
        setSeleccionIds([el.id]);
      })();
    },
    [maxZ, patchElementos, doc.elementos.length],
  );

  const eliminarSeleccion = () => {
    if (!seleccionIds.length) return;
    const quitar = new Set(seleccionIds);
    patchElementos((els) => els.filter((e) => !quitar.has(e.id)));
    setSeleccionIds([]);
  };

  const duplicarSeleccion = () => {
    const ids =
      seleccionIds.length > 0 ? seleccionIds : seleccionado ? [seleccionado.id] : [];
    const fuente = doc.elementos.filter((e) => ids.includes(e.id));
    if (!fuente.length) return;
    const copias = fuente.map((el, i) => {
      const copia = clonarElementoIndependiente(el, { x: 20 + i * 8, y: 20 + i * 8 });
      copia.zIndex = maxZ + 1 + i;
      return copia;
    });
    if (copias.length > 1) {
      const gid = nuevoGroupId();
      copias.forEach((c) => {
        c.groupId = gid;
      });
    }
    patchElementos((els) => [...els, ...copias]);
    setSeleccionIds(copias.map((c) => c.id));
  };

  const agruparSeleccion = useCallback(() => {
    const ids = seleccionIds.filter((id) => doc.elementos.some((e) => e.id === id));
    if (ids.length < 2) return;
    patchElementos((els) => agruparElementosPorIds(els, ids));
  }, [doc.elementos, patchElementos, seleccionIds]);

  const desagruparSeleccion = useCallback(() => {
    const ids = seleccionIds.filter((id) => doc.elementos.some((e) => e.id === id));
    if (!ids.length) return;
    patchElementos((els) => desagruparElementosPorIds(els, ids));
  }, [doc.elementos, patchElementos, seleccionIds]);

  const traerAdelante = () => {
    if (!seleccionIds.length) return;
    let z = maxZ;
    seleccionIds.forEach((id) => {
      z += 1;
      patchElemento(id, { zIndex: z });
    });
  };

  const enviarAtras = () => {
    if (!seleccionIds.length) return;
    let z = minZ;
    [...seleccionIds].reverse().forEach((id) => {
      z -= 1;
      patchElemento(id, { zIndex: z });
    });
  };

  const aplicarAlineacion = useCallback(
    (tipo: AlineacionObjetos) => {
      const ids = seleccionIds.filter((id) => doc.elementos.some((e) => e.id === id));
      if (!ids.length) return;
      const seleccionados = doc.elementos.filter((e) => ids.includes(e.id));
      const ref =
        seleccionados.length === 1
          ? {
              left: 0,
              top: 0,
              right: doc.formato.ancho_px,
              bottom: doc.formato.alto_px,
            }
          : unionBounds(seleccionados.map(boundsElemento));
      patchElementos((els) => alinearElementos(els, ids, tipo, ref));
    },
    [doc.elementos, doc.formato.ancho_px, doc.formato.alto_px, patchElementos, seleccionIds],
  );

  const pasteboardRef = useRef(120);

  const punteroEnLienzo = useCallback(
    (ev: { clientX: number; clientY: number }) => {
      const node = canvasRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const pb = pasteboardRef.current;
      return {
        x: (ev.clientX - rect.left) / zoom - pb,
        y: (ev.clientY - rect.top) / zoom - pb,
      };
    },
    [zoom],
  );

  const dragRef = useRef<{
    ids: string[];
    mode: DragMode;
    startX: number;
    startY: number;
    origs: Map<string, ElementoVisual>;
    rotateStartAngle?: number;
    rotateOrig?: number;
    grupoAnchor?: { x: number; y: number };
    grupoCorner0?: { x: number; y: number };
    moved?: boolean;
  } | null>(null);
  /** Segundo clic en texto ya seleccionado → editar en lienzo (si no hubo arrastre). */
  const pendingTextEditRef = useRef<string | null>(null);

  const iniciarEdicionInline = useCallback((el: ElementoTexto) => {
    if (el.locked) return;
    pendingTextEditRef.current = null;
    dragRef.current = null;
    setDrag(null);
    editandoInlineIdRef.current = el.id;
    editandoInlineTextoRef.current = el.content ?? "";
    setEditandoInlineId(el.id);
    setEditandoInlineTexto(el.content ?? "");
    setSeleccionIds([el.id]);
  }, []);

  // Asegurar foco del textarea del lienzo al entrar en edición.
  useEffect(() => {
    if (!editandoInlineId) return;
    const t = window.setTimeout(() => {
      const ta = editandoInlineRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      const len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }, 20);
    return () => window.clearTimeout(t);
  }, [editandoInlineId]);

  const onPointerDownEl = (e: ReactPointerEvent, el: ElementoVisual, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();

    // Texto ya seleccionado: posible edición al soltar si no hubo arrastre.
    const textoYaSeleccionado =
      mode === "move" &&
      el.type === "text" &&
      !el.locked &&
      !e.shiftKey &&
      e.button === 0 &&
      seleccionIds.includes(el.id);
    pendingTextEditRef.current = textoYaSeleccionado ? el.id : null;

    const nextIds = resolverSeleccionAlClic(el, doc.elementos, seleccionIds, e.shiftKey);
    setSeleccionIds(nextIds);
    if (!nextIds.includes(el.id)) return;

    // Grupo completo seleccionado: se mueve ENTERO, incluidos los elementos
    // con candado (el candado protege ediciones individuales; mover el grupo
    // es una acción explícita). Sin esto, los grupos con capas bloqueadas se
    // desarmaban o directamente no se podían arrastrar.
    const gid = el.groupId;
    const esGrupoCompleto =
      mode === "move" &&
      !!gid &&
      (() => {
        const miembros = doc.elementos.filter((x) => x.groupId === gid).map((x) => x.id);
        return miembros.length >= 2 && miembros.every((id) => nextIds.includes(id));
      })();

    if (el.locked && !esGrupoCompleto) return;

    const idsDrag =
      mode === "move"
        ? nextIds.filter((id) => {
            const o = doc.elementos.find((x) => x.id === id);
            return o && (esGrupoCompleto || !o.locked);
          })
        : [el.id];

    if (!idsDrag.length) return;

    const origs = new Map<string, ElementoVisual>();
    for (const id of idsDrag) {
      const found = doc.elementos.find((x) => x.id === id);
      if (found) origs.set(id, structuredClone(found));
    }

    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const dragBase = {
      ids: mode === "move" ? idsDrag : [el.id],
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origs,
      moved: false,
    };

    if (mode === "rotate") {
      const pt = punteroEnLienzo(e);
      const o = origs.get(el.id);
      if (!pt || !o) return;
      // Centro visual de la caja (para texto en arco usar alto geométrico).
      let boxH = o.height;
      if (o.type === "text" && (o.arco ?? 0) !== 0) {
        boxH = alturaCajaTexto(o);
      } else if (o.type === "text" && o.forma === "circulo") {
        boxH = Math.max(o.height, o.width);
      }
      const cx = o.x + o.width / 2;
      const cy = o.y + boxH / 2;
      const full = {
        ...dragBase,
        rotateStartAngle: (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI,
        rotateOrig: o.rotation || 0,
        moved: true,
      };
      dragRef.current = full;
      setDrag(full);
      return;
    }

    dragRef.current = dragBase;
    setDrag(dragBase);
  };

  const iniciarMarquee = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (dragRef.current || marqueeRef.current) return;
    // Solo vacío del stage (artboard/grid son pointer-events:none → el target es el stage).
    if (e.target !== e.currentTarget) return;
    const pt = punteroEnLienzo(e);
    if (!pt) return;
    e.preventDefault();
    e.stopPropagation();
    cancelEditInline();
    const m = {
      x0: pt.x,
      y0: pt.y,
      x1: pt.x,
      y1: pt.y,
      shift: e.shiftKey,
      baseIds: e.shiftKey ? [...seleccionIdsRef.current] : [],
    };
    marqueeRef.current = m;
    setMarquee({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 });
    if (!e.shiftKey) setSeleccionIds([]);
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const aplicarMarqueeSeleccion = (m: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    shift: boolean;
    baseIds: string[];
  }) => {
    const left = Math.min(m.x0, m.x1);
    const right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1);
    const bottom = Math.max(m.y0, m.y1);
    if (right - left < 3 && bottom - top < 3) {
      if (!m.shift) setSeleccionIds([]);
      return;
    }
    const ids = idsSeleccionVentana(elementosRef.current, { left, right, top, bottom });
    if (m.shift) {
      setSeleccionIds([...new Set([...m.baseIds, ...ids])]);
    } else {
      setSeleccionIds(ids);
    }
  };

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const mq = marqueeRef.current;
      if (mq) {
        const pt = punteroEnLienzo(ev);
        if (!pt) return;
        const next = { ...mq, x1: pt.x, y1: pt.y };
        marqueeRef.current = next;
        setMarquee({ x0: next.x0, y0: next.y0, x1: next.x1, y1: next.y1 });
        aplicarMarqueeSeleccion(next);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const scale = zoom;
      const dx = (ev.clientX - d.startX) / scale;
      const dy = (ev.clientY - d.startY) / scale;
      if (d.mode === "move") {
        // Umbral: sin esto, un segundo clic para editar mueve el texto 1–2 px.
        if (!d.moved) {
          if (Math.hypot(dx, dy) < 5) return;
          d.moved = true;
          dragRef.current = d;
          pendingTextEditRef.current = null;
        }
        patchElementos((els) =>
          els.map((e) => {
            const o = d.origs.get(e.id);
            if (!o) return e;
            return { ...e, ...patchMoverElemento(o, dx, dy) } as ElementoVisual;
          }),
        );
        return;
      }
      if (d.mode === "resize-grupo" && d.grupoAnchor && d.grupoCorner0) {
        // Escala proporcional del grupo desde la esquina opuesta (ancla)
        const ax = d.grupoAnchor.x;
        const ay = d.grupoAnchor.y;
        const d0 = Math.hypot(d.grupoCorner0.x - ax, d.grupoCorner0.y - ay) || 1;
        const d1 = Math.hypot(d.grupoCorner0.x + dx - ax, d.grupoCorner0.y + dy - ay);
        const s = Math.min(20, Math.max(0.05, d1 / d0));
        patchElementos((els) =>
          els.map((e) => {
            const o = d.origs.get(e.id);
            if (!o) return e;
            const base = {
              x: ax + (o.x - ax) * s,
              y: ay + (o.y - ay) * s,
              width: Math.max(1, o.width * s),
              height: Math.max(1, o.height * s),
            };
            if (o.type === "text" && e.type === "text") {
              return { ...e, ...base, fontSize: ajustarTamanoTexto(o.fontSize * s) };
            }
            if (o.type === "line" && e.type === "line") {
              return {
                ...e,
                ...base,
                x2: ax + ((o.x2 ?? o.x + o.width) - ax) * s,
                y2: ay + ((o.y2 ?? o.y) - ay) * s,
              };
            }
            return { ...e, ...base } as ElementoVisual;
          }),
        );
        return;
      }
      const id = d.ids[0];
      const o = d.origs.get(id);
      if (!o) return;
      if (d.mode === "resize-line-end" && o.type === "line") {
        const ox2 = o.x2 ?? o.x + o.width;
        const oy2 = o.y2 ?? o.y;
        let nx2 = ox2 + dx;
        let ny2 = oy2 + dy;
        ({ x2: nx2, y2: ny2 } = snapLinea90(o.x, o.y, nx2, ny2, ev.ctrlKey));
        patchElemento(id, {
          x2: nx2,
          y2: ny2,
          width: Math.max(1, Math.hypot(nx2 - o.x, ny2 - o.y)),
        });
      } else if (esModoResizeEsquina(d.mode) && o.type !== "line") {
        const minW = 20;
        const minH = 12;
        let x = o.x;
        let y = o.y;
        let w = o.width;
        let h = o.height;
        const mode = d.mode;
        if (mode === "resize-se") {
          w = Math.max(minW, o.width + dx);
          h = Math.max(minH, o.height + dy);
        } else if (mode === "resize-sw") {
          w = Math.max(minW, o.width - dx);
          h = Math.max(minH, o.height + dy);
          x = o.x + (o.width - w);
        } else if (mode === "resize-ne") {
          w = Math.max(minW, o.width + dx);
          h = Math.max(minH, o.height - dy);
          y = o.y + (o.height - h);
        } else {
          w = Math.max(minW, o.width - dx);
          h = Math.max(minH, o.height - dy);
          x = o.x + (o.width - w);
          y = o.y + (o.height - h);
        }
        // Párrafo en círculo: el diámetro es el lado; mantener caja cuadrada.
        if (o.type === "text" && o.forma === "circulo") {
          const side = Math.max(w, h, 40);
          if (mode === "resize-sw" || mode === "resize-nw") {
            x = o.x + o.width - side;
          }
          if (mode === "resize-ne" || mode === "resize-nw") {
            y = o.y + o.height - side;
          }
          w = side;
          h = side;
        }
        patchElemento(id, { x, y, width: w, height: h });
      } else if (
        d.mode === "rotate" &&
        (o.type === "rect" || o.type === "image" || o.type === "text")
      ) {
        const pt = punteroEnLienzo(ev);
        if (!pt || d.rotateStartAngle === undefined || d.rotateOrig === undefined) {
          return;
        }
        let boxH = o.height;
        if (o.type === "text" && (o.arco ?? 0) !== 0) {
          boxH = alturaCajaTexto(o);
        } else if (o.type === "text" && o.forma === "circulo") {
          boxH = Math.max(o.height, o.width);
        }
        const cx = o.x + o.width / 2;
        const cy = o.y + boxH / 2;
        const angle = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
        let next = d.rotateOrig + (angle - d.rotateStartAngle);
        if (ev.shiftKey) {
          next = Math.round(next / 15) * 15;
        }
        patchElemento(id, { rotation: next });
      }
    }
    function onUp() {
      if (marqueeRef.current) {
        aplicarMarqueeSeleccion(marqueeRef.current);
        marqueeRef.current = null;
        setMarquee(null);
        suppressDeselectRef.current = true;
        pendingTextEditRef.current = null;
        return;
      }
      const d = dragRef.current;
      const pendingId = pendingTextEditRef.current;
      pendingTextEditRef.current = null;
      // Clic (sin arrastre) sobre texto ya seleccionado → editar en lienzo.
      if (pendingId && d && d.mode === "move" && !d.moved) {
        const el = elementosRef.current.find((x) => x.id === pendingId);
        if (el && el.type === "text" && !el.locked) {
          suppressDeselectRef.current = true;
          dragRef.current = null;
          setDrag(null);
          iniciarEdicionInline(el);
          return;
        }
      }
      if (dragRef.current) suppressDeselectRef.current = true;
      dragRef.current = null;
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [iniciarEdicionInline, patchElemento, patchElementos, punteroEnLienzo, zoom]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = (ev.target as HTMLElement)?.tagName;
      const editando = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (ev.key === "Escape") {
        if (editandoInlineId) {
          cancelEditInline();
          return;
        }
        setSeleccionIds([]);
        setMarquee(null);
        marqueeRef.current = null;
        return;
      }
      if (
        !editando &&
        !editandoInlineId &&
        ev.key === "Enter" &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        seleccionIds.length === 1
      ) {
        const el = doc.elementos.find((x) => x.id === seleccionIds[0]);
        if (el && el.type === "text" && !el.locked) {
          ev.preventDefault();
          iniciarEdicionInline(el);
          return;
        }
      }
      if (
        !editando &&
        (ev.ctrlKey || ev.metaKey) &&
        !ev.shiftKey &&
        ev.key.toLowerCase() === "z"
      ) {
        ev.preventDefault();
        deshacer();
        return;
      }
      if (
        !editando &&
        (ev.ctrlKey || ev.metaKey) &&
        ((ev.shiftKey && ev.key.toLowerCase() === "z") || ev.key.toLowerCase() === "y")
      ) {
        ev.preventDefault();
        rehacer();
        return;
      }
      if (
        !editando &&
        (ev.ctrlKey || ev.metaKey) &&
        ev.key.toLowerCase() === "g" &&
        !ev.shiftKey &&
        seleccionIds.length >= 2
      ) {
        ev.preventDefault();
        agruparSeleccion();
        return;
      }
      if (
        !editando &&
        (ev.ctrlKey || ev.metaKey) &&
        ev.shiftKey &&
        ev.key.toLowerCase() === "g" &&
        seleccionIds.length > 0 &&
        seleccionTieneGrupo(doc.elementos, seleccionIds)
      ) {
        ev.preventDefault();
        desagruparSeleccion();
        return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && !editando && !editandoInlineId && seleccionIds.length) {
        ev.preventDefault();
        const quitar = new Set(seleccionIds);
        patchElementos((els) => els.filter((e) => !quitar.has(e.id)));
        setSeleccionIds([]);
        return;
      }
      if (
        (ev.key === "ArrowUp" ||
          ev.key === "ArrowDown" ||
          ev.key === "ArrowLeft" ||
          ev.key === "ArrowRight") &&
        !editando &&
        !editandoInlineId &&
        seleccionIds.length
      ) {
        ev.preventDefault();
        const paso = ev.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (ev.key === "ArrowLeft") dx = -paso;
        if (ev.key === "ArrowRight") dx = paso;
        if (ev.key === "ArrowUp") dy = -paso;
        if (ev.key === "ArrowDown") dy = paso;
        const ids = new Set(seleccionIds);
        // Grupo completo seleccionado → las flechas mueven también las capas
        // con candado (mismo criterio que el arrastre de grupo).
        const grupoCompleto = !!elementosGrupoActivo;
        patchElementos((els) =>
          els.map((e) => {
            if (!ids.has(e.id) || (e.locked && !grupoCompleto)) return e;
            return { ...e, ...patchMoverElemento(e, dx, dy) } as ElementoVisual;
          }),
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    agruparSeleccion,
    deshacer,
    desagruparSeleccion,
    doc.elementos,
    editandoInlineId,
    elementosGrupoActivo,
    iniciarEdicionInline,
    patchElementos,
    rehacer,
    seleccionIds,
  ]);

  const canvasW = doc.formato.ancho_px;
  const canvasH = doc.formato.alto_px;
  const pasteboard = useMemo(
    () => margenPasteboard(doc.elementos, canvasW, canvasH),
    [doc.elementos, canvasW, canvasH],
  );
  pasteboardRef.current = pasteboard;
  const stageW = canvasW + pasteboard * 2;
  const stageH = canvasH + pasteboard * 2;
  const reglaPx = 18;
  const gridStepPx = 20;
  const rulerMinor = Math.max(6, Math.round(10 * zoom));
  const rulerMajor = Math.max(30, Math.round(50 * zoom));
  const formatoKey = `${doc.formato.id}-${canvasW}x${canvasH}`;
  const artboardLeft = reglaPx + pasteboard * zoom;
  const artboardTop = reglaPx + pasteboard * zoom;

  const aplicarZoomAjuste = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    // Se mide la caja de borde (no clientWidth/Height): esa medida no cambia
    // cuando aparece o desaparece una barra de scroll. Con clientWidth el zoom
    // dependía del scroll y el scroll del zoom, así que al crecer la barra de
    // Descripción MP el lienzo entraba en un bucle visible de parpadeo.
    const rect = vp.getBoundingClientRect();
    const next = zoomAjusteLienzo(
      canvasW,
      canvasH,
      rect.width - RESERVA_SCROLL_PX,
      rect.height - RESERVA_SCROLL_PX,
    );
    setZoom((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
  }, [canvasW, canvasH]);

  useEffect(() => {
    zoomManualRef.current = false;
  }, [formatoKey]);

  useLayoutEffect(() => {
    if (zoomManualRef.current) return;
    aplicarZoomAjuste();
  }, [aplicarZoomAjuste, formatoKey]);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (zoomManualRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => aplicarZoomAjuste());
    });
    ro.observe(vp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [aplicarZoomAjuste]);

  const setZoomManual = useCallback((next: number | ((z: number) => number)) => {
    zoomManualRef.current = true;
    setZoom(next);
  }, []);

  const capasOrdenadas = useMemo(
    () => [...doc.elementos].sort((a, b) => b.zIndex - a.zIndex),
    [doc.elementos],
  );

  // Reubica la capa `origenId` justo antes (encima, en la lista) de `destinoId`
  // reasignando zIndex a todas las capas según el nuevo orden visual.
  const reordenarCapa = useCallback(
    (origenId: string, destinoId: string) => {
      if (origenId === destinoId) return;
      const orden = [...capasOrdenadas];
      const fromIdx = orden.findIndex((e) => e.id === origenId);
      if (fromIdx === -1) return;
      const [movida] = orden.splice(fromIdx, 1);
      const toIdx = orden.findIndex((e) => e.id === destinoId);
      orden.splice(toIdx === -1 ? orden.length : toIdx, 0, movida);
      const total = orden.length;
      const nuevosZ = new Map(orden.map((e, i) => [e.id, total - i]));
      patchElementos((els) =>
        els.map((e) => (nuevosZ.has(e.id) ? ({ ...e, zIndex: nuevosZ.get(e.id)! } as ElementoVisual) : e)),
      );
    },
    [capasOrdenadas, patchElementos],
  );

  function labelCapa(el: ElementoVisual): string {
    return labelCapaElemento(el, doc.elementos);
  }

  function iniciarRenombrarCapa(el: ElementoVisual) {
    setRenombrandoCapaId(el.id);
    setRenombrandoCapaTexto((el.nombreCapa || "").trim() || labelCapaElemento(el, doc.elementos));
    setCapaArrastradaId(null);
    setCapaSobreId(null);
  }

  function commitRenombrarCapa() {
    const id = renombrandoCapaId;
    if (!id) return;
    const valor = renombrandoCapaTexto.replace(/\s+/g, " ").trim().slice(0, 80);
    patchElemento(id, { nombreCapa: valor || undefined });
    setRenombrandoCapaId(null);
    setRenombrandoCapaTexto("");
  }

  function cancelarRenombrarCapa() {
    setRenombrandoCapaId(null);
    setRenombrandoCapaTexto("");
  }

  useEffect(() => {
    if (!renombrandoCapaId) return;
    const t = window.setTimeout(() => {
      const input = renombrarCapaInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [renombrandoCapaId]);

  const fondoTransparente =
    !doc.fondo || doc.fondo === "transparent" || doc.fondo === "none";

  function deseleccionarViewport(e: ReactMouseEvent) {
    if (suppressDeselectRef.current) {
      suppressDeselectRef.current = false;
      return;
    }
    if (e.target === viewportRef.current) { setSeleccionIds([]); cancelEditInline(); }
  }

  const iniciarResizePanel = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      resizingPanelRef.current = {
        kind: "ancho",
        startPos: e.clientX,
        startVal: panelAncho,
      };
    },
    [panelAncho],
  );

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const r = resizingPanelRef.current;
      if (!r) return;
      const dx = r.startPos - ev.clientX;
      setPanelAncho(Math.min(480, Math.max(260, r.startVal + dx)));
    }
    function onUp() {
      resizingPanelRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const alineacionBtns = (
    [
      ["izquierda", "⫷", "Alinear izquierda"],
      ["centro-h", "↔", "Centro horizontal"],
      ["derecha", "⫸", "Alinear derecha"],
      ["arriba", "⫠", "Arriba"],
      ["centro-v", "↕", "Centro vertical"],
      ["abajo", "⫡", "Abajo"],
    ] as const
  ).map(([tipo, icono, titulo]) => (
    <button
      key={tipo}
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={() => aplicarAlineacion(tipo)}
      className="flex h-7 w-7 items-center justify-center rounded text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink"
    >
      {icono}
    </button>
  ));

  return (
    <div className={`flex h-full min-h-0 flex-col ${studio.workspace}`}>
      {/* Barra superior */}
      <header className={`flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 ${studio.topbar}`}>
        <ToolBtn title="Volver a biblioteca" onClick={onVolver} className="!h-10 !w-10">
          <span className="text-xl">←</span>
        </ToolBtn>
        <input
          value={doc.nombre}
          onChange={(e) => onChange({ ...doc, nombre: e.target.value })}
          className="min-w-[8rem] flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-sm font-medium text-white outline-none focus:border-accent/50"
        />
        <button
          type="button"
          onClick={() => setCambiarFormatoAbierto(true)}
          className="hidden items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400 transition hover:border-accent/60 hover:text-white sm:inline-flex"
          title="Cambiar tamaño del formato — el diseño se reescala proporcionalmente"
        >
          {labelFormato(doc.formato)}
          <span aria-hidden>✎</span>
        </button>
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => {
              setColoresAbierto((v) => !v);
              setColorDesde(null);
            }}
            title="Cambiar un color en toda la plantilla (títulos, subtítulos, líneas…)"
            className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400 transition hover:border-accent/60 hover:text-white"
          >
            <span className="flex gap-0.5">
              {coloresPlantilla.slice(0, 3).map(([c]) => (
                <span key={c} className="h-3 w-3 rounded-full border border-white/30" style={{ background: c }} />
              ))}
            </span>
            Colores
          </button>
          {coloresAbierto && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-white/10 bg-neutral-900 p-3 shadow-2xl">
              <p className="mb-2 text-[11px] leading-snug text-neutral-400">
                1. Elige el color a cambiar &nbsp;2. Escoge el nuevo &nbsp;3. Aplicar.
                Cambia ese color en todos los elementos a la vez (Ctrl+Z lo revierte).
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {coloresPlantilla.map(([col, n]) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setColorDesde(col)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
                      colorDesde === col
                        ? "border-accent bg-accent/15"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <span className="h-5 w-5 shrink-0 rounded border border-white/25" style={{ background: col }} />
                    <code className="flex-1 truncate text-[11px] text-neutral-300">{col}</code>
                    <span className="shrink-0 text-[10px] text-neutral-500">
                      {n} uso{n !== 1 ? "s" : ""}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
                <input
                  type="color"
                  value={colorHacia}
                  onChange={(e) => setColorHacia(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent"
                  title="Color nuevo"
                />
                <code className="flex-1 text-[11px] text-neutral-300">{colorHacia}</code>
                <button
                  type="button"
                  disabled={!colorDesde}
                  onClick={() => {
                    if (colorDesde) reemplazarColorGlobal(colorDesde, colorHacia);
                    setColoresAbierto(false);
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Aplicar
                </button>
              </div>
            </div>
          )}
        </div>
        <ToolBtn
          title="Deshacer (Ctrl+Z)"
          onClick={deshacer}
          className={`!h-10 !w-10 ${!puedeDeshacer ? "pointer-events-none opacity-30" : ""}`}
        >
          <span className="text-xl">↺</span>
        </ToolBtn>
        <ToolBtn
          title="Rehacer (Ctrl+Shift+Z)"
          onClick={rehacer}
          className={`!h-10 !w-10 ${!puedeRehacer ? "pointer-events-none opacity-30" : ""}`}
        >
          <span className="text-xl">↻</span>
        </ToolBtn>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomManual((z) => Math.max(0.25, z - 0.1))}
            className="rounded px-2 py-1 text-sm text-neutral-300 hover:bg-white/10"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => {
              zoomManualRef.current = false;
              aplicarZoomAjuste();
            }}
            className="min-w-[3rem] rounded px-1 py-1 text-center text-[11px] text-neutral-300 hover:bg-white/10"
            title="Clic para ajustar al lienzo"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoomManual((z) => Math.min(4, z + 0.1))}
            className="rounded px-2 py-1 text-sm text-neutral-300 hover:bg-white/10"
          >
            +
          </button>
          <button
            type="button"
            onClick={onGuardar}
            disabled={guardando}
            title={dirty && !guardando ? "Hay cambios sin guardar" : undefined}
            className="relative ml-2 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {guardando ? "…" : "Guardar"}
            {dirty && !guardando && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#333333]" />
            )}
          </button>
          {onDuplicar && (
            <button
              type="button"
              onClick={onDuplicar}
              disabled={duplicando}
              title="Crear una copia independiente de esta plantilla"
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
            >
              {duplicando ? "…" : "Duplicar"}
            </button>
          )}
          <div
            className="flex max-w-[11rem] items-center gap-1 rounded-md border border-white/15 px-2 py-1"
            title={`Exportar a resolución de impresión${presetExportActivo?.hint ? ` · ${presetExportActivo.hint}` : ""}`}
          >
            <span className="shrink-0 text-[10px] text-neutral-400">Export</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-200">
              {presetExportActivo?.label ?? "Máxima"}
            </span>
          </div>
          <button
            type="button"
            disabled={exportando}
            onClick={() => onExportar(escalaExport)}
            title={`Descargar PNG a ${presetExportActivo?.hint ?? "resolución del lienzo"}`}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            {exportando ? "…" : "Descargar PNG"}
          </button>
        </div>
      </header>

      <CambiarFormatoModal
        abierta={cambiarFormatoAbierto}
        formatoActual={doc.formato}
        onCerrar={() => setCambiarFormatoAbierto(false)}
        onElegir={aplicarNuevoFormato}
      />

      <div className="flex min-h-0 flex-1">
        {/* Herramientas — columna izquierda */}
        <aside className={`flex w-14 shrink-0 flex-col items-center gap-1.5 border-r py-2 ${studio.toolbar}`}>
          <ToolBtn title="Texto (T)" onClick={agregarTexto}>
            <span className="text-lg font-bold">T</span>
          </ToolBtn>
          <ToolBtn
            title="Texto en arco (curvatura arriba/abajo)"
            onClick={agregarTextoMarcoCircular}
          >
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <span className="absolute inset-x-0 top-0.5 h-3 rounded-t-full border border-b-0 border-current opacity-80" />
              <span className="text-[10px] font-black leading-none">T</span>
            </span>
          </ToolBtn>
          <ToolBtn title="Rectángulo" onClick={agregarRect}>
            <span className="text-2xl">▢</span>
          </ToolBtn>
          <ToolBtn title="Círculo / elipse" onClick={agregarCirculo}>
            <span className="text-2xl leading-none">◯</span>
          </ToolBtn>
          <ToolBtn title="Línea" onClick={agregarLinea}>
            <span className="text-2xl leading-none">─</span>
          </ToolBtn>
          <ToolBtn title="Imagen" onClick={() => setGaleriaAbierta(true)} active={galeriaAbierta}>
            <span className="text-xl">▣</span>
          </ToolBtn>
          <GaleriaImagenesModal
            abierta={galeriaAbierta}
            onCerrar={() => setGaleriaAbierta(false)}
            onElegir={insertarImagen}
          />
          <ToolSep />
          <ToolBtn
            title="Pictogramas GHS"
            onClick={() => {
              setGhsAbierto((v) => !v);
              setEan13Abierto(false);
            }}
            active={ghsAbierto}
          >
            <span className="text-[11px] font-black text-red-400">GHS</span>
          </ToolBtn>
          <ToolBtn
            title="Código EAN-13"
            onClick={() => {
              setEan13Abierto((v) => !v);
              setGhsAbierto(false);
            }}
            active={ean13Abierto}
          >
            <span className="text-[11px] font-black">EAN</span>
          </ToolBtn>
        </aside>

        {/* Lienzo */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={viewportRef}
            className={`flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 ${studio.canvasBg}`}
            onClick={deseleccionarViewport}
          >
          <div
            className="relative shrink-0"
            style={{
              width: stageW * zoom + reglaPx,
              height: stageH * zoom + reglaPx,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Regla horizontal — alineada al artboard */}
            <div
              className="absolute z-20 h-[18px] border-b border-white/10 bg-[#3a3a3a]"
              style={{
                left: artboardLeft,
                top: 0,
                width: canvasW * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            {/* Regla vertical */}
            <div
              className="absolute z-20 w-[18px] border-r border-white/10 bg-[#3a3a3a]"
              style={{
                left: 0,
                top: artboardTop,
                height: canvasH * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            <div
              className="absolute z-20 h-[18px] w-[18px] border-b border-r border-white/10 bg-[#3a3a3a]"
              style={{ left: 0, top: 0 }}
            />
            <div
              ref={canvasRef}
              className="relative origin-top-left overflow-visible"
              onPointerDown={iniciarMarquee}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/ghs-icon")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }
              }}
              onDrop={(e) => {
                const svg = e.dataTransfer.getData("application/ghs-icon");
                if (!svg || !canvasRef.current) return;
                e.preventDefault();
                const rect = canvasRef.current.getBoundingClientRect();
                const pb = pasteboardRef.current;
                const px = (e.clientX - rect.left) / zoom - pb;
                const py = (e.clientY - rect.top) / zoom - pb;
                // EAN-13 SVGs have monospace text — wide aspect ratio, base on canvas width
                const isEAN = svg.includes("monospace") && svg.includes("<rect");
                const w = isEAN ? canvasW * 0.80 : Math.min(canvasW, canvasH) * 0.18;
                const h = isEAN ? w * (114 / 339) : w;
                const src = (() => {
                  try {
                    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
                  } catch {
                    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
                  }
                })();
                const el = elementoImagenDefecto(src, px - w / 2, py - h / 2);
                el.width = w;
                el.height = h;
                el.zIndex = maxZ + 1;
                patchElementos((els) => [...els, el]);
                setSeleccionIds([el.id]);
              }}
              style={{
                position: "absolute",
                left: reglaPx,
                top: reglaPx,
                width: stageW,
                height: stageH,
                transform: `scale(${zoom})`,
              }}
            >
              {/* Artboard (área de trabajo) */}
              <div
                className="pointer-events-none absolute rounded-sm shadow-2xl ring-1 ring-black/20"
                style={{
                  left: pasteboard,
                  top: pasteboard,
                  width: canvasW,
                  height: canvasH,
                  backgroundColor: fondoTransparente ? undefined : doc.fondo,
                  backgroundImage: fondoTransparente
                    ? "repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%)"
                    : undefined,
                  backgroundSize: fondoTransparente ? "10px 10px" : undefined,
                }}
              />
              {/* Cuadrícula solo sobre el artboard */}
              <div
                className="pointer-events-none absolute"
                style={{
                  left: pasteboard,
                  top: pasteboard,
                  width: canvasW,
                  height: canvasH,
                  backgroundImage: [
                    "linear-gradient(to right, rgba(15,23,42,0.05) 1px, transparent 1px)",
                    "linear-gradient(to bottom, rgba(15,23,42,0.05) 1px, transparent 1px)",
                  ].join(", "),
                  backgroundSize: `${gridStepPx}px ${gridStepPx}px`,
                }}
              />
              {doc.elementos
                .slice()
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((el) => {
                  if (el.visible === false) return null;
                  const sel = seleccionIds.includes(el.id);
                  const esPrincipal = el.id === seleccionPrincipalId;
                  if (el.type === "text") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const editandoEste = editandoInlineId === el.id;
                    const esHover = hoveredId === el.id && !sel && !drag && !editandoEste;
                    const mostrarManijas =
                      !el.locked &&
                      !editandoEste &&
                      (mostrandoCaja || (sel && esPrincipal) || hoveredId === el.id);
                    const hitH = Math.max(el.height, tamanoHitTexto(el).h);
                    return (
                      <TextoCapaLienzo
                        key={el.id}
                        el={el}
                        left={el.x + pasteboard}
                        top={el.y + pasteboard}
                        seleccionado={sel}
                        esPrincipal={esPrincipal}
                        mostrandoCaja={mostrandoCaja || esHover}
                        locked={!!el.locked}
                        editando={editandoEste}
                        textoEdicion={editandoInlineTexto}
                        onHover={setHoveredId}
                        onPointerDownMove={(e) => onPointerDownEl(e, el, "move")}
                        onIniciarEdicion={() => {
                          pendingTextEditRef.current = null;
                          dragRef.current = null;
                          setDrag(null);
                          iniciarEdicionInline(el);
                        }}
                        onTextoEdicionChange={(v) => {
                          editandoInlineTextoRef.current = v;
                          setEditandoInlineTexto(v);
                        }}
                        onCommitEdicion={commitEditInline}
                        onCancelEdicion={cancelEditInline}
                        chrome={
                          <SeleccionChrome
                            width={el.width}
                            height={hitH}
                            showFrame={mostrandoCaja || (sel && esPrincipal) || esHover}
                            showHandles={mostrarManijas}
                            hover={esHover}
                            onRotate={(e) => onPointerDownEl(e, el, "rotate")}
                            onResize={(e, corner) =>
                              onPointerDownEl(e, el, `resize-${corner}`)
                            }
                          />
                        }
                      />
                    );
                  }
                  if (el.type === "rect") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const esHover = hoveredId === el.id && !sel && !drag;
                    const mostrarManijas =
                      !el.locked &&
                      (mostrandoCaja || (sel && esPrincipal) || hoveredId === el.id);
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElementoEnStage(el, pasteboard),
                          background: el.fill,
                          border:
                            el.strokeWidth > 0
                              ? `${el.strokeWidth}px solid ${el.stroke}`
                              : undefined,
                          borderRadius: el.borderRadius,
                          overflow: "visible",
                        }}
                        onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                        onPointerLeave={() => setHoveredId(null)}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        {esHover && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-[#016d82]/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            ▢ · {labelCapa(el)}
                          </div>
                        )}
                        <SeleccionChrome
                          width={el.width}
                          height={el.height}
                          showFrame={mostrandoCaja || (sel && esPrincipal) || esHover}
                          showHandles={mostrarManijas}
                          hover={esHover}
                          onRotate={(e) => onPointerDownEl(e, el, "rotate")}
                          onResize={(e, corner) => onPointerDownEl(e, el, `resize-${corner}`)}
                        />
                      </div>
                    );
                  }
                  if (el.type === "line") {
                    const x2 = el.x2 ?? el.x + el.width;
                    const y2 = el.y2 ?? el.y;
                    const pad = Math.max(10, el.strokeWidth + 8);
                    const minX = Math.min(el.x, x2);
                    const minY = Math.min(el.y, y2);
                    const maxX = Math.max(el.x, x2);
                    const maxY = Math.max(el.y, y2);
                    const svgW = Math.max(maxX - minX + pad * 2, 1);
                    const svgH = Math.max(maxY - minY + pad * 2, 1);
                    const lx1 = el.x - minX + pad;
                    const ly1 = el.y - minY + pad;
                    const lx2 = x2 - minX + pad;
                    const ly2 = y2 - minY + pad;
                    const hitStroke = Math.max(14, el.strokeWidth + 10);
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const mostrarManijas =
                      !el.locked &&
                      (mostrandoCaja || (sel && esPrincipal) || hoveredId === el.id);
                    const esHoverLinea = hoveredId === el.id && !sel && !drag;
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          position: "absolute",
                          left: minX - pad + pasteboard,
                          top: minY - pad + pasteboard,
                          width: svgW,
                          height: svgH,
                          zIndex: el.zIndex,
                        }}
                      >
                        {esHoverLinea && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-[#016d82]/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            ─ · {labelCapa(el)}
                          </div>
                        )}
                        <svg
                          style={{
                            position: "absolute",
                            inset: 0,
                            overflow: "visible",
                            pointerEvents: el.locked ? "none" : "auto",
                          }}
                          aria-hidden
                        >
                          <line
                            x1={lx1}
                            y1={ly1}
                            x2={lx2}
                            y2={ly2}
                            stroke="transparent"
                            strokeWidth={hitStroke}
                            strokeLinecap="round"
                            style={{ cursor: el.locked ? "default" : "move" }}
                            onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                            onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                            onPointerLeave={() => setHoveredId(null)}
                          />
                          <line
                            x1={lx1}
                            y1={ly1}
                            x2={lx2}
                            y2={ly2}
                            stroke={el.stroke}
                            strokeWidth={el.strokeWidth}
                            strokeLinecap="butt"
                            pointerEvents="none"
                          />
                        </svg>
                        {mostrarManijas && (
                          <>
                            <button
                              type="button"
                              title="Mover extremo"
                              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border-0 bg-transparent p-0 touch-none"
                              style={{
                                left: el.x - (minX - pad),
                                top: el.y - (minY - pad),
                                width: NODO_HIT_PX,
                                height: NODO_HIT_PX,
                                cursor: "move",
                              }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                            >
                              <span
                                className="block shrink-0 rounded-[1px] border border-[#016d82]/85 bg-white mck-paper-white shadow-[0_0_0_0.5px_rgba(255,255,255,0.95)]"
                                style={{ width: NODO_VIS_PX, height: NODO_VIS_PX }}
                              />
                            </button>
                            <button
                              type="button"
                              title="Estirar extremo"
                              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border-0 bg-transparent p-0 touch-none"
                              style={{
                                left: x2 - (minX - pad),
                                top: y2 - (minY - pad),
                                width: NODO_HIT_PX,
                                height: NODO_HIT_PX,
                                cursor: "crosshair",
                              }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "resize-line-end")}
                            >
                              <span
                                className="block shrink-0 rounded-[1px] border border-[#016d82]/85 bg-white mck-paper-white shadow-[0_0_0_0.5px_rgba(255,255,255,0.95)]"
                                style={{ width: NODO_VIS_PX, height: NODO_VIS_PX }}
                              />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  }
                  if (el.type === "image") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const esHover = hoveredId === el.id && !sel && !drag;
                    const mostrarManijas =
                      !el.locked &&
                      (mostrandoCaja || (sel && esPrincipal) || hoveredId === el.id);
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElementoEnStage(el, pasteboard),
                          overflow: "visible",
                        }}
                        onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                        onPointerLeave={() => setHoveredId(null)}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        {esHover && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-[#016d82]/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            🖼 · {labelCapa(el)}
                          </div>
                        )}
                        <div className="h-full w-full overflow-hidden">
                          <ImagenCanvasElement src={el.src} objectFit={el.objectFit} />
                        </div>
                        <SeleccionChrome
                          width={el.width}
                          height={el.height}
                          showFrame={mostrandoCaja || (sel && esPrincipal) || esHover}
                          showHandles={mostrarManijas}
                          hover={esHover}
                          onRotate={(e) => onPointerDownEl(e, el, "rotate")}
                          onResize={(e, corner) => onPointerDownEl(e, el, `resize-${corner}`)}
                        />
                      </div>
                    );
                  }
                  return null;
                })}
              {cajaGrupoActivo && elementosGrupoActivo && (
                <div
                  title="Arrastra para mover todo el grupo"
                  onPointerDown={(e) => onPointerDownEl(e, elementosGrupoActivo[0], "move")}
                  style={{
                    position: "absolute",
                    left: cajaGrupoActivo.left + pasteboard,
                    top: cajaGrupoActivo.top + pasteboard,
                    width: cajaGrupoActivo.right - cajaGrupoActivo.left,
                    height: cajaGrupoActivo.bottom - cajaGrupoActivo.top,
                    zIndex: Math.min(...elementosGrupoActivo.map((e) => e.zIndex)) - 0.01,
                    border: "1px dashed rgba(1, 109, 130, 0.55)",
                    cursor: "move",
                    background: "transparent",
                  }}
                />
              )}
              {cajaGrupoActivo &&
                elementosGrupoActivo &&
                CORNERS.map(({ id: corner, cursor }) => {
                  const cx = corner.includes("w") ? cajaGrupoActivo.left : cajaGrupoActivo.right;
                  const cy = corner.includes("n") ? cajaGrupoActivo.top : cajaGrupoActivo.bottom;
                  return (
                    <div
                      key={`grupo-${corner}`}
                      title="Arrastra para redimensionar el grupo (proporcional)"
                      onPointerDown={(e) => iniciarResizeGrupo(e, corner)}
                      style={{
                        position: "absolute",
                        left: cx + pasteboard - NODO_HIT_PX / 2,
                        top: cy + pasteboard - NODO_HIT_PX / 2,
                        width: NODO_HIT_PX,
                        height: NODO_HIT_PX,
                        zIndex: 9999,
                        cursor,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "transparent",
                        touchAction: "none",
                      }}
                    >
                      <div
                        style={{
                          width: NODO_VIS_PX + 2,
                          height: NODO_VIS_PX + 2,
                          background: "#fff",
                          border: "1.5px solid rgba(1, 109, 130, 0.9)",
                          borderRadius: 1,
                        }}
                      />
                    </div>
                  );
                })}
              {marquee && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: Math.min(marquee.x0, marquee.x1) + pasteboard,
                    top: Math.min(marquee.y0, marquee.y1) + pasteboard,
                    width: Math.max(1, Math.abs(marquee.x1 - marquee.x0)),
                    height: Math.max(1, Math.abs(marquee.y1 - marquee.y0)),
                    border: "1px solid rgba(1, 109, 130, 0.9)",
                    background: "rgba(1, 109, 130, 0.12)",
                    pointerEvents: "none",
                    zIndex: 10000,
                  }}
                />
              )}
            </div>
          </div>
          </div>

          {ghsAbierto && (
            <div className="absolute bottom-4 left-14 z-40 max-h-[min(420px,70vh)] overflow-auto rounded-lg border border-border bg-surface-panel shadow-xl">
              <GHSIconsPicker
                compact
                onCerrar={() => setGhsAbierto(false)}
                onInsertar={(src) => {
                  const size = Math.min(canvasW, canvasH) * 0.18;
                  const el = elementoImagenDefecto(src, canvasW / 2 - size / 2, canvasH / 2 - size / 2);
                  el.width = size;
                  el.height = size;
                  el.zIndex = maxZ + 1;
                  patchElementos((els) => [...els, el]);
                  setSeleccionIds([el.id]);
                  setGhsAbierto(false);
                }}
              />
            </div>
          )}
          {ean13Abierto && (
            <div className="absolute bottom-4 left-14 z-40 rounded-lg border border-border bg-surface-panel p-3 shadow-xl">
              <CodigoBarrasEAN13
                onCerrar={() => setEan13Abierto(false)}
                onInsertar={(src) => {
                  const w = canvasW * 0.8;
                  const h = w * (114 / 339);
                  const el = elementoImagenDefecto(src, canvasW / 2 - w / 2, canvasH / 2 - h / 2);
                  el.width = w;
                  el.height = h;
                  el.zIndex = maxZ + 1;
                  patchElementos((els) => [...els, el]);
                  setSeleccionIds([el.id]);
                  setEan13Abierto(false);
                }}
              />
            </div>
          )}

        {doc.elementos.some((e) => e.type === "text") && (
          <BarraContenidoTexto
            elementos={doc.elementos}
            seleccionado={seleccionado?.type === "text" ? seleccionado : null}
            seleccionId={seleccionIds.length === 1 ? seleccionIds[0] : null}
            nombrePlantilla={doc.nombre}
            textareaRef={contenidoTextareaRef}
            casAutoEstado={casAutoEstado}
            onSeleccionar={(id) => setSeleccionIds([id])}
            onCasAuto={async () => {
              if (!seleccionado || seleccionado.type !== "text") return;
              const ctx = contextoCapasParaDescripcion(
                doc.elementos,
                seleccionado.id,
                doc.nombre,
              );
              if (!ctx.titulo) return;
              setCasAutoEstado("cargando");
              try {
                const cas = await buscarCasPorTitulo(ctx.titulo);
                if (cas) {
                  patchElemento(seleccionado.id, { content: `CAS: ${cas}` });
                  setCasAutoEstado("idle");
                } else {
                  setCasAutoEstado("error");
                }
              } catch {
                setCasAutoEstado("error");
              }
            }}
            onPatchRol={(rol) => {
              if (!seleccionado || seleccionado.type !== "text") return;
              patchElemento(seleccionado.id, { textRole: rol });
            }}
            onLiveChange={(valor) => {
              if (!seleccionado || seleccionado.type !== "text") return;
              actualizarContenidoTexto(seleccionado.id, valor, { autocorregir: false });
            }}
            onCommit={(valor) => {
              if (!seleccionado || seleccionado.type !== "text") return;
              actualizarContenidoTexto(seleccionado.id, valor, { autocorregir: true });
            }}
            onEstructuradoChange={(texto) => {
              if (!seleccionado || seleccionado.type !== "text") return;
              patchElemento(seleccionado.id, {
                content: autoCorregirTextoContenido(texto),
              });
            }}
            onMagico={(texto) => {
              if (!seleccionado || seleccionado.type !== "text") return;
              patchElemento(seleccionado.id, {
                content: autoCorregirTextoContenido(texto),
              });
            }}
          />
        )}
        </div>

        {/* Panel derecho: estilo / arco / Capas. Textos + contenido van en la barra inferior. */}
        <div className="relative flex shrink-0" style={{ width: panelAncho }}>
          <div
            onPointerDown={iniciarResizePanel}
            title="Arrastra para cambiar el ancho del panel"
            className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-accent/40"
          />
          <aside className={`flex h-full w-full flex-col overflow-hidden border-l ${studio.panel}`}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <>
                {seleccionIds.length > 1 ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-xs text-muted">
                      {seleccionIds.length} elementos · Shift+clic para ampliar selección
                    </p>
                    <div className="flex flex-wrap gap-0.5">{alineacionBtns}</div>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={duplicarSeleccion} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-surface-hover">Duplicar</button>
                      <button type="button" onClick={agruparSeleccion} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-surface-hover">Agrupar</button>
                      {seleccionTieneGrupo(doc.elementos, seleccionIds) && (
                        <button type="button" onClick={desagruparSeleccion} className="rounded border border-border px-2 py-1 text-[10px] hover:bg-surface-hover">Desagrupar</button>
                      )}
                      <button type="button" onClick={eliminarSeleccion} className="rounded border border-red-200 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50">Eliminar</button>
                    </div>
                  </div>
                ) : !seleccionado ? (
                  <p className="py-6 text-center text-xs text-muted">
                    Elige un texto en la barra de abajo o en el lienzo.
                  </p>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold capitalize text-ink">{labelCapa(seleccionado)}</p>
                      <div className="flex shrink-0 gap-0.5">
                        <button type="button" onClick={duplicarSeleccion} className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover" title="Duplicar">⧉</button>
                        <button type="button" onClick={enviarAtras} className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover" title="Atrás">↓</button>
                        <button type="button" onClick={traerAdelante} className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover" title="Adelante">↑</button>
                        <button type="button" onClick={eliminarSeleccion} className="rounded px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50" title="Eliminar">✕</button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-0.5 border-b border-border pb-2">{alineacionBtns}</div>

            {seleccionado.groupId && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
                <span className="text-[10px] text-muted">⊞ En grupo</span>
                <button
                  type="button"
                  onClick={desagruparSeleccion}
                  className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-surface-hover"
                >
                  Desagrupar
                </button>
              </div>
            )}

            {/* En textos: posición debajo del contenido (colapsada). En formas: abierta. */}
            {seleccionado.type !== "text" && (
              <details open className="rounded-lg border border-border bg-surface px-2 py-1.5">
                <summary className="cursor-pointer text-xs font-medium text-ink">
                  Posición y tamaño
                </summary>
                <div className="mt-2 space-y-2">
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">Bloquear</span>
                    <button
                      type="button"
                      onClick={() => alternarBloqueo(seleccionado.id)}
                      className={`rounded-md border px-2 py-0.5 text-xs ${
                        seleccionado.locked
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-border hover:bg-surface-hover"
                      }`}
                    >
                      {seleccionado.locked ? "🔒 Bloqueado" : "🔓 Libre"}
                    </button>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["x", "y", "width", "height"] as const).map((k) => (
                      <label key={k}>
                        <span className="text-xs text-muted">{k}</span>
                        <input
                          type="number"
                          step={1}
                          disabled={seleccionado.locked && (k === "x" || k === "y")}
                          value={Math.round(Number(seleccionado[k]) || 0)}
                          onChange={(e) => {
                            const v = Math.round(Number(e.target.value));
                            if (!Number.isFinite(v)) return;
                            if (Math.round(Number(seleccionado[k]) || 0) === v) return;
                            patchElemento(seleccionado.id, { [k]: v });
                          }}
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            )}

            {seleccionado.type === "text" && (
              <>
                <p className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] leading-snug text-muted">
                  Elige y edita el texto en la <span className="font-semibold text-ink">barra clara de abajo</span>.
                  Aquí: tipografía, arco y círculo.
                </p>
                <label>
                  <span className="text-xs text-muted">Tipografía</span>
                  <select
                    value={
                      esFuenteMontserrat(seleccionado.fontFamily)
                        ? FUENTE_MONTSERRAT_FAMILY
                        : seleccionado.fontFamily
                    }
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        fontFamily: e.target.value,
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value={FUENTE_MONTSERRAT_FAMILY}>Montserrat</option>
                    <option value="system-ui, sans-serif">System UI</option>
                  </select>
                </label>
                {esFuenteMontserrat(seleccionado.fontFamily) && (
                  <div>
                    <span className="mb-1 block text-xs text-muted">Variante Montserrat</span>
                    <div className="flex flex-wrap gap-1">
                      {VARIANTES_MONTSERRAT.map((v) => {
                        const activa =
                          varianteDesdeFontWeight(seleccionado.fontWeight) === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            title={v.label}
                            onClick={() =>
                              patchElemento(seleccionado.id, {
                                fontWeight: String(pesoMontserratVariante(v.id)),
                              })
                            }
                            className={`rounded px-2 py-1 text-[10px] transition ${
                              activa
                                ? "bg-accent text-white"
                                : "border border-border text-ink-secondary hover:bg-surface-hover"
                            }`}
                            style={{
                              fontFamily: FUENTE_MONTSERRAT_FAMILY,
                              fontWeight: v.weight,
                            }}
                          >
                            {v.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <label>
                  <span className="text-xs text-muted">Tamaño</span>
                  <input
                    type="number"
                    min={TAMANO_TEXTO_MIN}
                    max={TAMANO_TEXTO_MAX}
                    step={PASO_TAMANO_TEXTO}
                    value={seleccionado.fontSize}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        fontSize: ajustarTamanoTexto(Number(e.target.value)),
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Color</span>
                  <input
                    type="color"
                    value={seleccionado.color}
                    onChange={(e) => patchElemento(seleccionado.id, { color: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Alineación</span>
                  <select
                    value={seleccionado.align}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        align: e.target.value as "left" | "center" | "right" | "justify",
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                    <option value="justify">Justificado</option>
                  </select>
                </label>
                <label>
                  <span className="text-xs text-muted">
                    Interlineado ({(seleccionado.lineHeight ?? 1.25).toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={2.5}
                    step={0.05}
                    value={seleccionado.lineHeight ?? 1.25}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { lineHeight: Number(e.target.value) })
                    }
                    className="w-full accent-accent"
                  />
                </label>
                <div className="space-y-1.5 rounded-md border border-border/80 bg-surface-hover/30 p-2">
                  <span className="block text-xs font-semibold text-ink">Texto en arco</span>
                  <span className="block text-[10px] leading-snug text-muted">
                    Curvatura con el deslizador. Gíralo con el punto arriba del marco, o con
                    los botones de orientación / rotación.
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { label: "Arriba", v: 80, rot: 0, ancla: 0 as const },
                        { label: "Media luna", v: 100, rot: 0, ancla: 0 as const },
                        { label: "Abajo", v: -80, rot: 0, ancla: 180 as const },
                        { label: "360°", v: 200, rot: 0, ancla: 0 as const },
                        { label: "Recto", v: 0, rot: 0, ancla: 0 as const },
                      ] as const
                    ).map((p) => {
                      const activo = (seleccionado.arco ?? 0) === p.v;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() =>
                            aplicarArcoPreset(p.v, {
                              rotation: p.rot,
                              reposicionar: true,
                              ancla: p.ancla,
                            })
                          }
                          className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                            activo
                              ? "border-accent bg-accent/15 text-accent"
                              : "border-border text-muted hover:bg-surface-hover"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <label className="block">
                    <span className="text-[10px] text-muted">
                      Curvatura ({seleccionado.arco ?? 0})
                      {Math.abs(seleccionado.arco ?? 0) >= 200
                        ? " · círculo"
                        : Math.abs(seleccionado.arco ?? 0) >= 100
                          ? " · media luna"
                          : (seleccionado.arco ?? 0) !== 0
                            ? " · arco"
                            : ""}
                    </span>
                    <input
                      type="range"
                      min={-200}
                      max={200}
                      step={5}
                      value={seleccionado.arco ?? 0}
                      onChange={(e) => aplicarArcoPreset(Number(e.target.value))}
                      className="w-full accent-accent"
                    />
                  </label>
                  <div>
                    <span className="mb-1 block text-[10px] text-muted">Orientación (gira el arco)</span>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { label: "↑ Arriba", deg: 0 },
                          { label: "→ Derecha", deg: 90 },
                          { label: "↓ Abajo", deg: 180 },
                          { label: "← Izquierda", deg: 270 },
                        ] as const
                      ).map((p) => {
                        const rot = ((Math.round(seleccionado.rotation || 0) % 360) + 360) % 360;
                        const activo = rot === p.deg;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            disabled={!!seleccionado.locked}
                            onClick={() => {
                              const arco =
                                (seleccionado.arco ?? 0) !== 0
                                  ? (seleccionado.arco as number)
                                  : 80;
                              aplicarArcoPreset(Math.abs(arco) || 80, {
                                rotation: p.deg,
                                reposicionar: true,
                                ancla: p.deg as 0 | 90 | 180 | 270,
                              });
                            }}
                            className={`rounded border px-2 py-0.5 text-[10px] font-medium disabled:opacity-40 ${
                              activo
                                ? "border-accent bg-accent/15 text-accent"
                                : "border-border text-muted hover:bg-surface-hover"
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                    <label className="mt-1.5 block">
                      <span className="text-[10px] text-muted">
                        Rotación ({Math.round(seleccionado.rotation || 0)}°)
                      </span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        disabled={!!seleccionado.locked}
                        value={(() => {
                          let r = Math.round(seleccionado.rotation || 0) % 360;
                          if (r > 180) r -= 360;
                          if (r < -180) r += 360;
                          return r;
                        })()}
                        onChange={(e) => {
                          const rot = Number(e.target.value);
                          aplicarArcoPreset(
                            (seleccionado.arco ?? 0) !== 0
                              ? (seleccionado.arco as number)
                              : 80,
                            { rotation: rot, reposicionar: true },
                          );
                        }}
                        className="w-full accent-accent"
                      />
                    </label>
                  </div>
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={seleccionado.forma === "circulo"}
                    onChange={(e) =>
                      patchElemento(
                        seleccionado.id,
                        e.target.checked
                          ? {
                              forma: "circulo",
                              arco: 0,
                              align: "justify",
                              // Banda central: como el cuerpo de la etiqueta
                              // (no llena todo el círculo).
                              circuloPorcion: "banda",
                              marcoAncho:
                                seleccionado.marcoAncho && seleccionado.marcoAncho > 0
                                  ? seleccionado.marcoAncho
                                  : 1.5,
                              marcoColor: seleccionado.marcoColor || seleccionado.color,
                              height: Math.max(seleccionado.width, seleccionado.height),
                              width: Math.max(seleccionado.width, 120),
                            }
                          : { forma: undefined, circuloPorcion: undefined },
                      )
                    }
                    className="mt-0.5 accent-accent"
                  />
                  <span className="text-xs text-muted">
                    <span className="font-semibold text-ink">Párrafo en círculo</span>
                    <span className="block text-[10px] leading-snug">
                      El diámetro del círculo lo marcas tú (control Diámetro o asas). El
                      tamaño de fuente solo cambia la letra, no el círculo.
                    </span>
                  </span>
                </label>
                {seleccionado.forma === "circulo" && (
                  <div className="ml-5 space-y-1.5">
                    <label className="block">
                      <span className="text-xs text-muted">
                        Diámetro del círculo ({Math.round(seleccionado.width)} px)
                      </span>
                      <input
                        type="range"
                        min={80}
                        max={Math.max(800, Math.round(doc.formato.ancho_px))}
                        step={2}
                        value={Math.round(seleccionado.width)}
                        onChange={(e) => {
                          const d = Math.max(40, Math.round(Number(e.target.value)));
                          // Solo tamaño del círculo: no toca fontSize.
                          patchElemento(seleccionado.id, { width: d, height: d });
                        }}
                        className="w-full accent-accent"
                      />
                      <span className="block text-[10px] leading-snug text-muted">
                        Agranda o achica el círculo con este control o con las asas del
                        lienzo. El tamaño de fuente es independiente.
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { id: "banda", label: "Banda central" },
                          { id: "superior", label: "Mitad arriba" },
                          { id: "inferior", label: "Mitad abajo" },
                          { id: "completo", label: "Círculo entero" },
                        ] as const
                      ).map((p) => {
                        const activo = (seleccionado.circuloPorcion ?? "completo") === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              patchElemento(seleccionado.id, { circuloPorcion: p.id })
                            }
                            className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                              activo
                                ? "border-accent bg-accent/15 text-accent"
                                : "border-border text-muted hover:bg-surface-hover"
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] leading-snug text-muted">
                      {(seleccionado.circuloPorcion ?? "completo") === "banda"
                        ? "Solo la franja del medio: deja arriba/abajo libres (título y código)."
                        : (seleccionado.circuloPorcion ?? "completo") === "superior"
                          ? "Solo la media luna de arriba."
                          : (seleccionado.circuloPorcion ?? "completo") === "inferior"
                            ? "Solo la media luna de abajo."
                            : "Usa todo el disco del diámetro elegido."}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Marco</span>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step={0.5}
                        value={seleccionado.marcoAncho ?? 0}
                        onChange={(e) =>
                          patchElemento(seleccionado.id, {
                            marcoAncho: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-16 rounded border border-border bg-surface-input px-2 py-1 text-xs text-ink"
                        title="Grosor del marco circular (0 = sin marco)"
                      />
                      <input
                        type="color"
                        value={seleccionado.marcoColor || seleccionado.color}
                        onChange={(e) =>
                          patchElemento(seleccionado.id, { marcoColor: e.target.value })
                        }
                        className="h-7 w-9 cursor-pointer rounded border border-border bg-surface-input p-0.5"
                        title="Color del marco circular"
                      />
                      <span className="text-[10px] text-muted">grosor · color</span>
                    </div>
                  </div>
                )}
                <label>
                  <span className="text-xs text-muted">Rotación (°)</span>
                  <input
                    type="number"
                    step={1}
                    disabled={seleccionado.locked}
                    value={Math.round(seleccionado.rotation || 0)}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { rotation: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
                  />
                </label>
                <details className="rounded-lg border border-border bg-surface px-2 py-1.5">
                  <summary className="cursor-pointer text-xs font-medium text-ink">
                    Posición y tamaño
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">Bloquear</span>
                      <button
                        type="button"
                        onClick={() => alternarBloqueo(seleccionado.id)}
                        className={`rounded-md border px-2 py-0.5 text-xs ${
                          seleccionado.locked
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-border hover:bg-surface-hover"
                        }`}
                      >
                        {seleccionado.locked ? "🔒 Bloqueado" : "🔓 Libre"}
                      </button>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["x", "y", "width", "height"] as const).map((k) => (
                        <label key={k}>
                          <span className="text-xs text-muted">{k}</span>
                          <input
                            type="number"
                            step={1}
                            disabled={seleccionado.locked && (k === "x" || k === "y")}
                            value={Math.round(Number(seleccionado[k]) || 0)}
                            onChange={(e) => {
                              const v = Math.round(Number(e.target.value));
                              if (!Number.isFinite(v)) return;
                              if (Math.round(Number(seleccionado[k]) || 0) === v) return;
                              patchElemento(seleccionado.id, { [k]: v });
                            }}
                            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
              </>
            )}

            {seleccionado.type === "rect" && (
              <>
                <label>
                  <span className="text-xs text-muted">Relleno</span>
                  <input
                    type="color"
                    value={seleccionado.fill.startsWith("#") ? seleccionado.fill : "#0891b2"}
                    onChange={(e) => patchElemento(seleccionado.id, { fill: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Borde</span>
                  <input
                    type="color"
                    value={seleccionado.stroke.startsWith("#") ? seleccionado.stroke : "#0e7490"}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        stroke: e.target.value,
                        ...(seleccionado.strokeWidth === 0 ? { strokeWidth: 2 } : {}),
                      })
                    }
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Esquinas</span>
                  <select
                    value={seleccionado.borderRadius > 0 ? "redondeadas" : "rectas"}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        borderRadius: e.target.value === "redondeadas"
                          ? Math.max(seleccionado.borderRadius || 8, 8)
                          : 0,
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="rectas">Rectas</option>
                    <option value="redondeadas">Redondeadas</option>
                  </select>
                </label>
                {seleccionado.borderRadius > 0 && (
                  <label>
                    <span className="text-xs text-muted">Radio esquina (px)</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.min(seleccionado.width, seleccionado.height) / 2}
                      value={seleccionado.borderRadius}
                      onChange={(e) =>
                        patchElemento(seleccionado.id, {
                          borderRadius: Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                    />
                  </label>
                )}
              </>
            )}

            {seleccionado.type === "rect" && (
              <>
                <label>
                  <span className="text-xs text-muted">Rotación (°)</span>
                  <input
                    type="number"
                    step={1}
                    value={Math.round(seleccionado.rotation || 0)}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { rotation: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  />
                </label>
                <label>
                  <span className="text-xs text-muted">Grosor borde (pasos de 0,25)</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={0.25}
                    value={seleccionado.strokeWidth}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      patchElemento(seleccionado.id, {
                        strokeWidth: Math.max(0, Number.isFinite(v) ? v : 0),
                      });
                    }}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  />
                </label>
              </>
            )}

            {seleccionado.type === "line" && (
              <label>
                <span className="text-xs text-muted">Grosor línea (0,15 – 5)</span>
                <input
                  type="number"
                  min={0.15}
                  max={5}
                  step={0.05}
                  value={seleccionado.strokeWidth}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    const clamped = Math.min(5, Math.max(0.15, Number.isFinite(v) ? v : 0.15));
                    patchElemento(seleccionado.id, { strokeWidth: clamped });
                  }}
                  className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                />
              </label>
            )}

            {seleccionado.type === "line" && (
              <>
                <p className="text-[10px] leading-snug text-muted">
                  Mantén <kbd className="rounded border border-border px-1">Ctrl</kbd> al
                  arrastrar el extremo para alinear horizontal o vertical (90°).
                </p>
                <label>
                  <span className="text-xs text-muted">Color línea</span>
                  <input
                    type="color"
                    value={seleccionado.stroke.startsWith("#") ? seleccionado.stroke : "#334155"}
                    onChange={(e) => patchElemento(seleccionado.id, { stroke: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded border border-border"
                  />
                </label>
              </>
            )}

            {seleccionado.type === "image" && (
              <>
                <label>
                  <span className="text-xs text-muted">Ajuste imagen</span>
                  <select
                    value={seleccionado.objectFit}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        objectFit: e.target.value as "contain" | "cover",
                      })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <option value="contain">Contener</option>
                    <option value="cover">Cubrir</option>
                  </select>
                </label>
                <label>
                  <span className="text-xs text-muted">Rotación (°)</span>
                  <input
                    type="number"
                    step={1}
                    value={Math.round(seleccionado.rotation || 0)}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { rotation: Number(e.target.value) })
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                  />
                </label>
              </>
            )}
                  </div>
                )}
              </>

              <div className="border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => setCapasAbiertas((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:bg-surface-hover"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Capas ({capasOrdenadas.length})
                  </span>
                  <span className="text-[10px] text-muted">{capasAbiertas ? "▾" : "▸"}</span>
                </button>
                {capasAbiertas && (
                  <div className="mt-2 space-y-2">
              <>
                  {capasOrdenadas.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted">
                      Usa las herramientas de la izquierda para añadir elementos.
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {capasOrdenadas.map((el) => {
                        const activa = seleccionIds.includes(el.id);
                        const oculto = el.visible === false;
                        const icon =
                          el.type === "text" ? "T" : el.type === "rect" ? "▢" : el.type === "line" ? "─" : "▣";
                        const arrastrando = capaArrastradaId === el.id;
                        const sobreEsta = capaSobreId === el.id && capaArrastradaId !== null && !arrastrando;
                        const renombrando = renombrandoCapaId === el.id;
                        return (
                          <li
                            key={el.id}
                            draggable={!renombrando}
                            onDragStart={(e) => {
                              if (renombrando) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.effectAllowed = "move";
                              setCapaArrastradaId(el.id);
                            }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              if (capaArrastradaId && capaArrastradaId !== el.id) setCapaSobreId(el.id);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (capaArrastradaId) reordenarCapa(capaArrastradaId, el.id);
                              setCapaArrastradaId(null);
                              setCapaSobreId(null);
                            }}
                            onDragEnd={() => {
                              setCapaArrastradaId(null);
                              setCapaSobreId(null);
                            }}
                            className={`flex items-center gap-0.5 rounded ${arrastrando ? "opacity-40" : ""} ${
                              sobreEsta ? "border-t-2 border-accent" : ""
                            }`}
                          >
                            {renombrando ? (
                              <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5">
                                <span className="w-5 shrink-0 text-center text-sm font-bold opacity-70">{icon}</span>
                                <input
                                  ref={renombrarCapaInputRef}
                                  value={renombrandoCapaTexto}
                                  maxLength={80}
                                  aria-label="Nombre de la capa"
                                  onChange={(e) => setRenombrandoCapaTexto(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitRenombrarCapa();
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelarRenombrarCapa();
                                    }
                                  }}
                                  onBlur={() => commitRenombrarCapa()}
                                  className="min-w-0 flex-1 rounded border border-accent/50 bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent"
                                />
                              </div>
                            ) : (
                              <button
                                type="button"
                                title="Clic para seleccionar · Doble clic para renombrar"
                                onClick={(e) => {
                                  const next = resolverSeleccionAlClic(
                                    el,
                                    doc.elementos,
                                    seleccionIds,
                                    e.shiftKey,
                                  );
                                  setSeleccionIds(next);
                                }}
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  iniciarRenombrarCapa(el);
                                }}
                                className={`flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition active:cursor-grabbing ${
                                  activa
                                    ? "bg-accent/15 text-accent font-medium"
                                    : oculto
                                      ? "text-muted/40 hover:bg-surface-hover"
                                      : "text-ink-secondary hover:bg-surface-hover"
                                }`}
                              >
                                <span className="w-5 shrink-0 text-center text-sm font-bold opacity-70">{icon}</span>
                                <span className={`min-w-0 truncate ${oculto ? "line-through" : ""}`}>
                                  {labelCapa(el)}
                                </span>
                                {el.type === "text" && (() => {
                                  const rol = inferirRolTextoCapa(el, doc.elementos);
                                  if (!rol || rol === "otro") return null;
                                  const short =
                                    rol === "descripcion" ? "MP" : rol === "titulo" ? "Tít" : "Sub";
                                  return (
                                    <span className="ml-auto shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-accent">
                                      {short}
                                    </span>
                                  );
                                })()}
                              </button>
                            )}
                            {!renombrando && (
                              <button
                                type="button"
                                title="Renombrar capa"
                                aria-label="Renombrar capa"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  iniciarRenombrarCapa(el);
                                }}
                                className="shrink-0 rounded p-1 text-[10px] text-muted hover:bg-surface-hover hover:text-ink"
                              >
                                ✎
                              </button>
                            )}
                            <button
                              type="button"
                              title={oculto ? "Mostrar" : "Ocultar"}
                              onClick={() => patchElemento(el.id, { visible: oculto ? true : false })}
                              className="shrink-0 rounded p-1 text-[10px] text-muted hover:bg-surface-hover"
                            >
                              {oculto ? "○" : "●"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <label className="mt-4 block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">Fondo</span>
                    <input
                      type="color"
                      value={doc.fondo.startsWith("#") ? doc.fondo : "#ffffff"}
                      onChange={(e) => onChange({ ...doc, fondo: e.target.value })}
                      className="h-8 w-full cursor-pointer rounded border border-border"
                    />
                  </label>
                  </>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
