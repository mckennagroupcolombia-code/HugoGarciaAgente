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
  TAMANO_TEXTO_DEFECTO,
  PASO_TAMANO_TEXTO,
  TAMANO_TEXTO_MIN,
  TAMANO_TEXTO_MAX,
  ajustarTamanoTexto,
  escalarPlantillaAFormato,
  labelFormato,
  patchMoverElemento,
  posicionNuevoElemento,
  presetsResolucionExport,
  pesoMontserratVariante,
  resolverSeleccionAlClic,
  seleccionTieneGrupo,
  snapLinea90,
  unionBounds,
  VARIANTES_MONTSERRAT,
  varianteDesdeFontWeight,
  zoomAjusteLienzo,
  pesoFontWeightCss,
  nuevoGroupId,
  type AlineacionObjetos,
  type ElementoTexto,
  type ElementoVisual,
  type PlantillaVisualDoc,
  type RolTextoCapa,
  contextoCapasParaDescripcion,
  esCapaDescripcionMateriaPrima,
  inferirRolTextoCapa,
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
import SugerenciasTextoMagico from "./SugerenciasTextoMagico";
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

type DragMode = "move" | "resize-se" | "resize-line-end" | "rotate" | null;

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
      drag.mode === "resize-se" ||
      drag.mode === "rotate" ||
      drag.mode === "resize-line-end")
  );
}

const OUTLINE_CAJA_ARRASTRE = "1px solid rgba(8, 145, 178, 0.45)";
const SOMBRA_HOVER = "0 0 0 2px rgba(99,102,241,0.75)";

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
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const [formatoModalAbierto, setFormatoModalAbierto] = useState(false);
  const presetsExport = useMemo(() => presetsResolucionExport(doc.formato), [doc.formato]);
  // Export siempre a máxima resolución: se quitó el selector de escala.
  const presetExportActivo = useMemo(
    () => presetsExport.find((p) => p.id === "4x") ?? presetsExport[presetsExport.length - 1],
    [presetsExport],
  );
  const escalaExport = presetExportActivo?.escala ?? 4;
  const [ghsAbierto, setGhsAbierto] = useState(false);
  const [ean13Abierto, setEan13Abierto] = useState(false);
  // Ancho del panel derecho y alto de la sección "Capas" (Inspector ocupa el resto),
  // ambos ajustables arrastrando los separadores — ver `iniciarResizePanel`.
  const [panelAncho, setPanelAncho] = useState(240);
  const [capasAltura, setCapasAltura] = useState(200);
  const resizingPanelRef = useRef<{ kind: "ancho" | "altura"; startPos: number; startVal: number } | null>(null);
  const suppressDeselectRef = useRef(false);
  const contenidoTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contenidoSeleccionRef = useRef<{ start: number; end: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [casAutoEstado, setCasAutoEstado] = useState<"idle" | "cargando" | "error">("idle");
  const [capaArrastradaId, setCapaArrastradaId] = useState<string | null>(null);
  const [capaSobreId, setCapaSobreId] = useState<string | null>(null);
  const [editandoInlineId, setEditandoInlineId] = useState<string | null>(null);
  const [editandoInlineTexto, setEditandoInlineTexto] = useState("");
  const editandoInlineRef = useRef<HTMLTextAreaElement | null>(null);

  function commitEditInline() {
    if (editandoInlineId) {
      patchElemento(editandoInlineId, {
        content: autoCorregirTextoContenido(editandoInlineTexto),
      });
    }
    setEditandoInlineId(null);
    setEditandoInlineTexto("");
  }
  function cancelEditInline() {
    setEditandoInlineId(null);
    setEditandoInlineTexto("");
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

  const patchElemento = useCallback(
    (id: string, patch: Partial<ElementoVisual>) => {
      patchElementos((els) =>
        els.map((e) => (e.id === id ? ({ ...e, ...patch } as ElementoVisual) : e)),
      );
    },
    [patchElementos],
  );

  const actualizarContenidoTexto = useCallback(
    (id: string, valor: string, selStart?: number, selEnd?: number) => {
      const start = selStart ?? valor.length;
      const end = selEnd ?? start;
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

  const agregarRect = () => {
    const { x, y } = posicionNuevoElemento(doc.elementos.length, 56, 96);
    const el = elementoRectDefecto(x, y);
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

  const punteroEnLienzo = useCallback(
    (ev: { clientX: number; clientY: number }) => {
      const node = canvasRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left) / zoom,
        y: (ev.clientY - rect.top) / zoom,
      };
    },
    [zoom],
  );

  const onPointerDownEl = (e: ReactPointerEvent, el: ElementoVisual, mode: DragMode) => {
    e.stopPropagation();

    const nextIds = resolverSeleccionAlClic(el, doc.elementos, seleccionIds, e.shiftKey);
    setSeleccionIds(nextIds);
    if (!nextIds.includes(el.id)) return;

    if (el.locked) return;

    const idsDrag =
      mode === "move"
        ? nextIds.filter((id) => {
            const o = doc.elementos.find((x) => x.id === id);
            return o && !o.locked;
          })
        : [el.id];

    if (!idsDrag.length) return;

    const origs = new Map<string, ElementoVisual>();
    for (const id of idsDrag) {
      const found = doc.elementos.find((x) => x.id === id);
      if (found) origs.set(id, structuredClone(found));
    }

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const dragBase = {
      ids: mode === "move" ? idsDrag : [el.id],
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origs,
    };

    if (mode === "rotate") {
      const pt = punteroEnLienzo(e);
      const o = origs.get(el.id);
      if (!pt || !o) return;
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      setDrag({
        ...dragBase,
        rotateStartAngle: (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI,
        rotateOrig: o.rotation || 0,
      });
      return;
    }

    setDrag(dragBase);
  };

  useEffect(() => {
    if (!drag) return;
    const scale = zoom;
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - drag!.startX) / scale;
      const dy = (ev.clientY - drag!.startY) / scale;
      if (drag!.mode === "move") {
        patchElementos((els) =>
          els.map((e) => {
            const o = drag!.origs.get(e.id);
            if (!o) return e;
            return { ...e, ...patchMoverElemento(o, dx, dy) } as ElementoVisual;
          }),
        );
        return;
      }
      const id = drag!.ids[0];
      const o = drag!.origs.get(id);
      if (!o) return;
      if (drag!.mode === "resize-line-end" && o.type === "line") {
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
      } else if (drag!.mode === "resize-se" && o.type !== "line") {
        patchElemento(id, {
          width: Math.max(20, o.width + dx),
          height: Math.max(12, o.height + dy),
        });
      } else if (
        drag!.mode === "rotate" &&
        (o.type === "rect" || o.type === "image" || o.type === "text")
      ) {
        const pt = punteroEnLienzo(ev);
        if (
          !pt ||
          drag!.rotateStartAngle === undefined ||
          drag!.rotateOrig === undefined
        ) {
          return;
        }
        const cx = o.x + o.width / 2;
        const cy = o.y + o.height / 2;
        const angle = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
        let next = drag!.rotateOrig + (angle - drag!.rotateStartAngle);
        if (ev.shiftKey) {
          next = Math.round(next / 15) * 15;
        }
        patchElemento(id, { rotation: next });
      }
    }
    function onUp() {
      if (drag) suppressDeselectRef.current = true;
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, patchElemento, patchElementos, punteroEnLienzo, zoom]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const tag = (ev.target as HTMLElement)?.tagName;
      const editando = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (ev.key === "Escape") {
        setSeleccionIds([]);
        return;
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
      if ((ev.key === "Delete" || ev.key === "Backspace") && !editando && seleccionIds.length) {
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
        patchElementos((els) =>
          els.map((e) => {
            if (!ids.has(e.id) || e.locked) return e;
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
    patchElementos,
    rehacer,
    seleccionIds,
  ]);

  const canvasW = doc.formato.ancho_px;
  const canvasH = doc.formato.alto_px;
  const reglaPx = 18;
  const gridStepPx = 20;
  const rulerMinor = Math.max(6, Math.round(10 * zoom));
  const rulerMajor = Math.max(30, Math.round(50 * zoom));
  const formatoKey = `${doc.formato.id}-${canvasW}x${canvasH}`;

  const aplicarZoomAjuste = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    setZoom(zoomAjusteLienzo(canvasW, canvasH, vp.clientWidth, vp.clientHeight));
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
    const ro = new ResizeObserver(() => {
      if (zoomManualRef.current) return;
      aplicarZoomAjuste();
    });
    ro.observe(vp);
    return () => ro.disconnect();
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
    if (el.type === "text") {
      const palabras = (el.content || "").trim().split(/\s+/).filter(Boolean);
      if (palabras.length > 0) return palabras.slice(0, 2).join(" ");
      const rol = inferirRolTextoCapa(el, doc.elementos);
      if (rol === "descripcion") return "Descripción MP";
      if (rol && rol !== "otro") return labelRolTextoCapa(rol);
      return "Texto";
    }
    if (el.type === "image") return "Imagen";
    if (el.type === "rect") return "Rectángulo";
    if (el.type === "line") return "Línea";
    return "Elemento";
  }

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
    (e: ReactPointerEvent, kind: "ancho" | "altura") => {
      e.preventDefault();
      resizingPanelRef.current = {
        kind,
        startPos: kind === "ancho" ? e.clientX : e.clientY,
        startVal: kind === "ancho" ? panelAncho : capasAltura,
      };
    },
    [panelAncho, capasAltura],
  );

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const r = resizingPanelRef.current;
      if (!r) return;
      if (r.kind === "ancho") {
        // El panel está a la derecha: arrastrar el borde hacia la izquierda lo ensancha.
        const dx = r.startPos - ev.clientX;
        setPanelAncho(Math.min(460, Math.max(220, r.startVal + dx)));
      } else {
        const dy = ev.clientY - r.startPos;
        setCapasAltura(Math.min(560, Math.max(120, r.startVal + dy)));
      }
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
          onClick={() => setFormatoModalAbierto(true)}
          title="Cambiar el formato de esta plantilla"
          className="hidden rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/10 hover:text-white sm:inline"
        >
          {labelFormato(doc.formato)} ✎
        </button>
        <CambiarFormatoModal
          abierta={formatoModalAbierto}
          formatoActual={doc.formato}
          onCerrar={() => setFormatoModalAbierto(false)}
          onElegir={(formato, categoriaId) => {
            onChange(escalarPlantillaAFormato(doc, formato, categoriaId));
            setFormatoModalAbierto(false);
          }}
        />
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
            title={`Escala fija a máxima resolución${presetExportActivo?.hint ? ` · ${presetExportActivo.hint}` : ""}`}
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

      <div className="flex min-h-0 flex-1">
        {/* Herramientas — columna izquierda */}
        <aside className={`flex w-14 shrink-0 flex-col items-center gap-1.5 border-r py-2 ${studio.toolbar}`}>
          <ToolBtn title="Texto (T)" onClick={agregarTexto}>
            <span className="text-lg font-bold">T</span>
          </ToolBtn>
          <ToolBtn title="Rectángulo" onClick={agregarRect}>
            <span className="text-2xl">▢</span>
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
              width: canvasW * zoom + reglaPx,
              height: canvasH * zoom + reglaPx,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Regla horizontal */}
            <div
              className="absolute left-[18px] top-0 z-20 h-[18px] border-b border-white/10 bg-[#3a3a3a]"
              style={{
                width: canvasW * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to right, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            {/* Regla vertical */}
            <div
              className="absolute left-0 top-[18px] z-20 w-[18px] border-r border-white/10 bg-[#3a3a3a]"
              style={{
                height: canvasH * zoom,
                backgroundImage: [
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.24) 0 1px, transparent 1px ${rulerMajor}px)`,
                  `repeating-linear-gradient(to bottom, rgba(15,23,42,0.12) 0 1px, transparent 1px ${rulerMinor}px)`,
                ].join(", "),
              }}
            />
            <div className="absolute left-0 top-0 z-20 h-[18px] w-[18px] border-b border-r border-white/10 bg-[#3a3a3a]" />
            <div
              ref={canvasRef}
              className="relative origin-top-left overflow-visible rounded-sm shadow-2xl ring-1 ring-black/20"
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
                const px = (e.clientX - rect.left) / zoom;
                const py = (e.clientY - rect.top) / zoom;
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
                width: canvasW,
                height: canvasH,
                transform: `scale(${zoom})`,
                backgroundColor: fondoTransparente ? undefined : doc.fondo,
                backgroundImage: fondoTransparente
                  ? "repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%)"
                  : undefined,
                backgroundSize: fondoTransparente ? "10px 10px" : undefined,
              }}
            >
              {/* Cuadrícula casi invisible para guía de alineación */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
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
                    const estiloTexto: React.CSSProperties = {
                      ...estiloElemento(el),
                      color: el.color,
                      fontSize: `${el.fontSize}px`,
                      fontFamily: el.fontFamily,
                      fontWeight: pesoFontWeightCss(el.fontWeight),
                      textAlign: el.align,
                      lineHeight: el.lineHeight ?? 1.2,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflow: "visible",
                      outline: mostrandoCaja && !editandoEste ? OUTLINE_CAJA_ARRASTRE : undefined,
                      boxShadow: esHover ? SOMBRA_HOVER : undefined,
                    };
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={estiloTexto}
                        onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                        onPointerLeave={() => setHoveredId(null)}
                        onPointerDown={(e) => {
                          if (editandoEste) { e.stopPropagation(); return; }
                          onPointerDownEl(e, el, "move");
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (el.locked) return;
                          setEditandoInlineId(el.id);
                          setEditandoInlineTexto(el.content);
                          setTimeout(() => {
                            const ta = editandoInlineRef.current;
                            if (ta) { ta.focus(); ta.select(); }
                          }, 0);
                        }}
                      >
                        {esHover && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            T · {labelCapa(el)}
                          </div>
                        )}
                        {editandoEste ? (
                          <textarea
                            ref={editandoInlineRef}
                            value={editandoInlineTexto}
                            onChange={(e) => setEditandoInlineTexto(e.target.value)}
                            onBlur={commitEditInline}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Escape") { e.preventDefault(); cancelEditInline(); }
                              if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); commitEditInline(); }
                              // Enter solo inserta línea nueva (comportamiento nativo del textarea)
                            }}
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              height: "100%",
                              color: el.color,
                              fontSize: `${el.fontSize}px`,
                              fontFamily: el.fontFamily,
                              fontWeight: pesoFontWeightCss(el.fontWeight),
                              textAlign: el.align,
                              whiteSpace: "pre-wrap",
                              lineHeight: el.lineHeight ?? 1.2,
                              wordBreak: "break-word",
                              resize: "none",
                              background: "rgba(255,255,255,0.93)",
                              border: "2px solid #6366f1",
                              borderRadius: "2px",
                              outline: "none",
                              padding: 0,
                              margin: 0,
                              overflow: "hidden",
                              zIndex: 9999,
                            }}
                          />
                        ) : (
                          <>
                            {el.content}
                            {(mostrandoCaja || (sel && esPrincipal)) && !el.locked && (
                              <>
                                <span
                                  aria-hidden
                                  className={`pointer-events-none absolute left-1/2 z-10 w-px -translate-x-1/2 bg-accent/50 ${
                                    mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                                  }`}
                                  style={{ top: -22, height: 22 }}
                                />
                                <span
                                  title="Rotar (mantén Shift para 15°)"
                                  className={`absolute left-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white/80 bg-accent shadow-sm active:cursor-grabbing ${
                                    mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                                  }`}
                                  style={{ top: -30 }}
                                  onPointerDown={(e) => onPointerDownEl(e, el, "rotate")}
                                />
                                <span
                                  className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent ${
                                    mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                                  }`}
                                  onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                                />
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }
                  if (el.type === "rect") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const manijasVisibles =
                      mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100";
                    const mostrarManijas =
                      (mostrandoCaja || (sel && esPrincipal)) && !el.locked;
                    const esHover = hoveredId === el.id && !sel && !drag;
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElemento(el),
                          background: el.fill,
                          border:
                            el.strokeWidth > 0
                              ? `${el.strokeWidth}px solid ${el.stroke}`
                              : undefined,
                          borderRadius: el.borderRadius,
                          outline: mostrandoCaja ? OUTLINE_CAJA_ARRASTRE : undefined,
                          boxShadow: esHover ? SOMBRA_HOVER : undefined,
                          overflow: "visible",
                        }}
                        onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                        onPointerLeave={() => setHoveredId(null)}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        {esHover && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            ▢ · {labelCapa(el)}
                          </div>
                        )}
                        {mostrarManijas && (
                          <>
                            <span
                              aria-hidden
                              className={`pointer-events-none absolute left-1/2 z-10 w-px -translate-x-1/2 bg-accent/50 ${manijasVisibles}`}
                              style={{ top: -22, height: 22 }}
                            />
                            <span
                              title="Rotar (mantén Shift para 15°)"
                              className={`absolute left-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white/80 bg-accent shadow-sm active:cursor-grabbing ${manijasVisibles}`}
                              style={{ top: -30 }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "rotate")}
                            />
                            <span
                              className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent ${manijasVisibles}`}
                              onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                            />
                          </>
                        )}
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
                    const manijasVisibles =
                      mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100";
                    const mostrarManijas =
                      (mostrandoCaja || (sel && esPrincipal)) && !el.locked;
                    const nodoLinea =
                      "absolute z-10 flex h-2 w-2 -translate-x-1/2 -translate-y-1/2 items-center justify-center";
                    const puntoLinea =
                      "h-1.5 w-1.5 rounded-full border border-accent/35 bg-white/90 shadow-sm dark:border-accent/50 dark:bg-zinc-900/90";
                    const esHoverLinea = hoveredId === el.id && !sel && !drag;
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          position: "absolute",
                          left: minX - pad,
                          top: minY - pad,
                          width: svgW,
                          height: svgH,
                          zIndex: el.zIndex,
                        }}
                      >
                        {esHoverLinea && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
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
                            <span
                              className={`${nodoLinea} cursor-move ${manijasVisibles}`}
                              style={{ left: el.x - (minX - pad), top: el.y - (minY - pad) }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                            >
                              <span className={puntoLinea} />
                            </span>
                            <span
                              className={`${nodoLinea} cursor-crosshair ${manijasVisibles}`}
                              style={{ left: x2 - (minX - pad), top: y2 - (minY - pad) }}
                              onPointerDown={(e) => onPointerDownEl(e, el, "resize-line-end")}
                            >
                              <span className={puntoLinea} />
                            </span>
                          </>
                        )}
                      </div>
                    );
                  }
                  if (el.type === "image") {
                    const mostrandoCaja = mostrandoCajaArrastre(el.id, sel, esPrincipal, drag);
                    const esHover = hoveredId === el.id && !sel && !drag;
                    const manijasVisibles =
                      mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100";
                    const mostrarManijas =
                      (mostrandoCaja || (sel && esPrincipal)) && !el.locked;
                    return (
                      <div
                        key={el.id}
                        className="group/elem"
                        style={{
                          ...estiloElemento(el),
                          overflow: "visible",
                          outline: mostrandoCaja ? OUTLINE_CAJA_ARRASTRE : undefined,
                          boxShadow: esHover ? SOMBRA_HOVER : undefined,
                        }}
                        onPointerEnter={(e) => { e.stopPropagation(); setHoveredId(el.id); }}
                        onPointerLeave={() => setHoveredId(null)}
                        onPointerDown={(e) => onPointerDownEl(e, el, "move")}
                      >
                        {esHover && (
                          <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:3, pointerEvents:"none", zIndex:9999, whiteSpace:"nowrap" }}
                            className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow">
                            🖼 · {labelCapa(el)}
                          </div>
                        )}
                        <div className="h-full w-full overflow-hidden">
                          <ImagenCanvasElement src={el.src} objectFit={el.objectFit} />
                        </div>
                        {mostrarManijas && (
                          <span
                            aria-hidden
                            className={`pointer-events-none absolute left-1/2 z-10 w-px -translate-x-1/2 bg-accent/50 ${manijasVisibles}`}
                            style={{ top: -22, height: 22 }}
                          />
                        )}
                        {mostrarManijas && (
                          <span
                            title="Rotar (mantén Shift para 15°)"
                            className={`absolute left-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white/80 bg-accent shadow-sm active:cursor-grabbing ${manijasVisibles}`}
                            style={{ top: -30 }}
                            onPointerDown={(e) => onPointerDownEl(e, el, "rotate")}
                          />
                        )}
                        {(mostrandoCaja || (sel && esPrincipal)) && !el.locked && (
                          <span
                            className={`absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-accent ${
                              mostrandoCaja ? "opacity-100" : "opacity-0 group-hover/elem:opacity-100"
                            }`}
                            onPointerDown={(e) => onPointerDownEl(e, el, "resize-se")}
                          />
                        )}
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
                    left: cajaGrupoActivo.left,
                    top: cajaGrupoActivo.top,
                    width: cajaGrupoActivo.right - cajaGrupoActivo.left,
                    height: cajaGrupoActivo.bottom - cajaGrupoActivo.top,
                    zIndex: Math.min(...elementosGrupoActivo.map((e) => e.zIndex)) - 0.01,
                    border: "1px dashed rgba(99,102,241,0.6)",
                    cursor: elementosGrupoActivo.some((e) => e.locked) ? "default" : "move",
                    background: "transparent",
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
        </div>

        {/* Panel derecho: Capas e Inspector visibles a la vez (antes eran pestañas
            excluyentes). Ancho del panel y alto de "Capas" se arrastran con los
            separadores — ver `iniciarResizePanel`. */}
        <div className="relative flex shrink-0" style={{ width: panelAncho }}>
          <div
            onPointerDown={(e) => iniciarResizePanel(e, "ancho")}
            title="Arrastra para cambiar el ancho del panel"
            className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-accent/40"
          />
          <aside className={`flex w-full flex-col border-l ${studio.panel}`}>
          <div
            className="flex shrink-0 flex-col overflow-y-auto border-b border-border p-3"
            style={{ height: capasAltura }}
          >
            <p className="mb-2 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Capas
            </p>
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
                      return (
                        <li
                          key={el.id}
                          draggable
                          onDragStart={(e) => {
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
                          <button
                            type="button"
                            onClick={(e) => {
                              const next = resolverSeleccionAlClic(
                                el,
                                doc.elementos,
                                seleccionIds,
                                e.shiftKey,
                              );
                              setSeleccionIds(next);
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
                          </button>
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
          <div
            onPointerDown={(e) => iniciarResizePanel(e, "altura")}
            title="Arrastra para cambiar el alto de Capas"
            className="h-1.5 shrink-0 cursor-row-resize hover:bg-accent/40"
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Inspector
            </p>
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
                  <p className="py-8 text-center text-xs text-muted">
                    Selecciona un elemento en el lienzo o en Capas.
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

            <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2 py-1.5">
              <span className="text-xs text-muted">Bloquear posición</span>
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
                    step="any"
                    disabled={seleccionado.locked && (k === "x" || k === "y")}
                    value={seleccionado[k] as number}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      patchElemento(seleccionado.id, { [k]: v });
                    }}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs disabled:opacity-50"
                  />
                </label>
              ))}
            </div>

            {seleccionado.type === "text" && (
              <>
                {(() => {
                  const rolTexto = inferirRolTextoCapa(seleccionado, doc.elementos);
                  const esDescripcion = esCapaDescripcionMateriaPrima(
                    seleccionado,
                    doc.elementos,
                  );
                  return (
                    <>
                      <label>
                        <span className="text-xs text-muted">Rol de capa</span>
                        <select
                          value={seleccionado.textRole ?? rolTexto ?? "otro"}
                          onChange={(e) =>
                            patchElemento(seleccionado.id, {
                              textRole: e.target.value as RolTextoCapa,
                            })
                          }
                          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
                        >
                          <option value="descripcion">Capa 1 · Descripción materia prima</option>
                          <option value="titulo">Título producto</option>
                          <option value="subtitulo">Subtítulo / línea</option>
                          <option value="otro">Otro texto</option>
                        </select>
                      </label>
                      {esDescripcion && (
                        <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-2 py-1.5 text-[10px] leading-snug text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                          Texto de descripción para etiqueta: describe la materia prima en tono
                          técnico de formulación. Evita repetir título/subtítulo y claims de
                          consumo (dosis, suplemento, salud) que MeLi puede marcar como
                          infracción.
                        </p>
                      )}
                    </>
                  );
                })()}
                <label>
                  <span className="text-xs text-muted">Contenido</span>
                  <textarea
                    ref={contenidoTextareaRef}
                    rows={Math.min(16, Math.max(3, (seleccionado.content || "").split("\n").length))}
                    value={seleccionado.content}
                    onChange={(e) =>
                      actualizarContenidoTexto(
                        seleccionado.id,
                        e.target.value,
                        e.target.selectionStart,
                        e.target.selectionEnd,
                      )
                    }
                    onBlur={(e) =>
                      actualizarContenidoTexto(
                        seleccionado.id,
                        e.target.value,
                        e.target.selectionStart,
                        e.target.selectionEnd,
                      )
                    }
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-xs leading-relaxed"
                  />
                  {(() => {
                    const esDescripcionMP = esCapaDescripcionMateriaPrima(
                      seleccionado,
                      doc.elementos,
                    );
                    const contextoCapas = contextoCapasParaDescripcion(
                      doc.elementos,
                      seleccionado.id,
                    );
                    // Capa "CAS: ..." → el número CAS es un dato puntual, no
                    // prosa: se asocia por título con la ficha FT/COA/SDS del
                    // Studio (lookup determinístico), no con sugerencias de IA.
                    const esCapaCas = /^\s*#?\s*cas\b/i.test(seleccionado.content || "");
                    if (esCapaCas) {
                      return (
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!contextoCapas.titulo || casAutoEstado === "cargando"}
                            onClick={async () => {
                              if (!contextoCapas.titulo) return;
                              setCasAutoEstado("cargando");
                              try {
                                const cas = await buscarCasPorTitulo(contextoCapas.titulo);
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
                            className="rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
                          >
                            {casAutoEstado === "cargando"
                              ? "Buscando CAS…"
                              : "🔎 Asociar CAS con el título"}
                          </button>
                          {casAutoEstado === "error" && (
                            <span className="text-[10px] text-red-500">
                              No se encontró CAS para «{contextoCapas.titulo}»
                            </span>
                          )}
                        </div>
                      );
                    }
                    // Cualquier otra capa de texto identifica el producto por
                    // el título de la etiqueta, no por lo que haya escrito en
                    // su propio contenido — así no hay que repetir el nombre,
                    // y la búsqueda de ficha técnica no depende de que la capa
                    // se haya clasificado (heurística o manual) como "descripción".
                    const fragmentoTextoMagico = contextoCapas.titulo
                      ? [contextoCapas.titulo, seleccionado.content]
                          .filter(Boolean)
                          .join(" ")
                      : seleccionado.content;
                    return (
                      <SugerenciasTextoMagico
                        fragmento={fragmentoTextoMagico}
                        modoDescripcionMateriaPrima={esDescripcionMP}
                        contextoCapas={contextoCapas}
                        onElegir={(texto) =>
                          patchElemento(seleccionado.id, {
                            content: autoCorregirTextoContenido(texto),
                          })
                        }
                      />
                    );
                  })()}
                </label>
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
                    Interlineado ({(seleccionado.lineHeight ?? 1.2).toFixed(1)})
                  </span>
                  <input
                    type="range"
                    min={0.8}
                    max={2.5}
                    step={0.1}
                    value={seleccionado.lineHeight ?? 1.2}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, { lineHeight: Number(e.target.value) })
                    }
                    className="w-full accent-accent"
                  />
                </label>
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
                  <span className="text-xs text-muted">Grosor borde</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={seleccionado.strokeWidth}
                    onChange={(e) =>
                      patchElemento(seleccionado.id, {
                        strokeWidth: Math.max(0, Number(e.target.value)),
                      })
                    }
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
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
