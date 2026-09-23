/**
 * Ficha/etiqueta de materia prima — reemplaza el flujo anterior de
 * "Formularios etiquetados" (formato+categoría+lienzo canvas). Réplica
 * fiel de la etiqueta impresa como formulario web: fondo blanco, naranja
 * corporativo, retícula editorial, sin cards/sombras/degradados.
 *
 * FLUJO: es un FORMULARIO, no un ejemplo. Primero se elige el Formato de
 * la etiqueta y el SKU (pantalla de inicio); solo entonces se abre la ficha
 * y se carga la información de ese SKU (código de barras, contenido neto,
 * título y ficha técnica enlazada por palabras clave). Las partes fijas de
 * la empresa —logo, acento, contacto, textos fijos, íconos, tipografías— se
 * guardan como "plantilla del formulario" (ficha reservada `__plantilla__`
 * en el mismo almacén) y toda ficha nueva arranca desde ella.
 *
 * VIEW MODE: se ve como la etiqueta terminada. EDIT MODE: cada valor se
 * vuelve editable in-place sin cambiar el tamaño de ningún bloque.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ProductHeader from "./ProductHeader";
import ProductAttributeGrid, { type IconoKey } from "./ProductAttributeGrid";
import GhsBadge from "./GhsBadge";
import TechnicalDocuments from "./TechnicalDocuments";
import TechnicalIdentity from "./TechnicalIdentity";
import CucharaMedidora from "./CucharaMedidora";
import EtiquetaVertical from "../etiqueta-vertical/EtiquetaVertical";
import {
  esFormatoVertical,
  reticulaVertical,
} from "../etiqueta-vertical/etiquetaVerticalTypes";
import NetContent from "./NetContent";
import BarcodeBlock from "./BarcodeBlock";
import { ESCALA_MAXIMA_MESA, ESCALA_MINIMA, MARGEN_MESA, useEscalaAjuste } from "./useEscalaAjuste";
import { ajustarAltoTextarea } from "./EditableField";
import ContactFooter from "./ContactFooter";
import { desenfocarBlobLocal } from "../../lib/desenfoqueLocal";
import { CARPETA_PUBLICACIONES_DIGITALES } from "../plantillas-visuales/studioEtiquetasData";
import { TextStyleProvider, useTextStyleCtx } from "./TextStyleContext";
import {
  ALTO_FRANJA_FICHA,
  CAMPOS_PLANTILLA,
  PRODUCTO_VACIO,
  RETICULA_MAESTRA,
  UNIDADES_CUCHARA,
  sinDatosDeProducto,
  tieneDatosDeProducto,
  variablesAcento,
  type ProductLabelData,
} from "./productLabelTypes";
import { useCodigosEan, type CodigoEan } from "../../lib/etiquetasCodigosEan";
import { cargarPatchDesdeFichaTecnica, listarFichasTecnicas } from "../../lib/fichaTecnicaAplicar";
import { cambiosDesdeFicha, fotoFicha, NOMBRE_CAMPO } from "../../lib/fichaTecnicaSync";
import { api } from "../../api/client";
import { contenidoNetoDesdeCodigo, filtrarCodigosEanPorTexto } from "../../lib/fichaTecnicaCampos";
import {
  candidatasParaTitulo,
  discrepanciaProducto,
  mejorFichaParaTitulo,
  nombreArchivoDesdeTitulo,
  palabrasClave,
  UMBRAL_ENLACE_AUTOMATICO,
} from "../../lib/fichaTecnicaMatch";
import {
  etiquetaTamanoFormato,
  etiquetaTamanoTipoNombre,
  nombreTipoEtiquetaCanonico,
  useTiposEtiqueta,
  type TipoEtiqueta,
} from "../../lib/etiquetasTipos";
import {
  useEliminarFichaEtiqueta,
  useFichasEtiquetaGuardadas,
  useGuardarFichaEtiqueta,
  type FichaEtiquetaGuardada,
} from "../../lib/etiquetasFichas";
import { palabraRecipiente, recipientePara, useRecipientes } from "../../lib/recipienteEtiqueta";
import {
  CATEGORIAS_ETIQUETA,
  CATEGORIA_ETIQUETA_OTROS,
  nombrePlantillaCategoria,
  useCategoriasEtiqueta,
  categoriaDeIdPlantilla,
  detectarCategoriaEtiqueta,
  esIdPlantillaFicha,
  etiquetaCategoria,
  etiquetaCategoriaEn,
  idPlantillaCategoria,
  PLANTILLA_FICHA_ID,
} from "../../lib/categoriasEtiqueta";
import LabelPreview from "../etiqueta-30ml/LabelPreview";
import Marco30ml from "../etiqueta-30ml/Marco30ml";
import { ANCHO_30ML, esFormato30ml, esPeligrosoGhs, reticula30ml } from "../etiqueta-30ml/etiqueta30mlTypes";
import EtiquetaSimple from "../etiqueta-simple/EtiquetaSimple";
import {
  parcheOrtografia,
  revisarOrtografiaEtiqueta,
  type CampoOrtografia,
} from "../../lib/ortografiaEtiqueta";
import { ANCHO_SIMPLE, esFormatoSimple, reticulaSimple } from "../etiqueta-simple/etiquetaSimpleTypes";
import Etiqueta5ml from "../etiqueta-5ml/Etiqueta5ml";
import { ANCHO_5ML, esFormato5ml, reticula5ml } from "../etiqueta-5ml/etiqueta5mlTypes";
import EtiquetaCircular from "../etiqueta-circular/EtiquetaCircular";
import {
  DIAMETRO_CIRCULAR,
  esFormatoCircular,
  reticulaCircular,
} from "../etiqueta-circular/etiquetaCircularTypes";
import { nombreArchivoSvg, svgEtiquetaCircular } from "../etiqueta-circular/exportarSvgCircular";

/** Espera de inactividad antes de autoguardar — evita un PUT por cada tecla. */
const AUTOGUARDADO_DEBOUNCE_MS = 1500;
/** Id reservado de la plantilla global (respaldo de toda categoría sin plantilla propia). */
const PLANTILLA_ID = PLANTILLA_FICHA_ID;
const PLANTILLA_NOMBRE = "Plantilla base (todas las categorías)";

/** Partes fijas de la plantilla aplicadas sobre la ficha vacía. */
function fichaDesdePlantilla(plantilla: FichaEtiquetaGuardada | undefined): ProductLabelData {
  const base: ProductLabelData = { ...PRODUCTO_VACIO };
  if (!plantilla?.data) return base;
  const destino = base as unknown as Record<string, unknown>;
  const origen = plantilla.data as unknown as Record<string, unknown>;
  for (const k of CAMPOS_PLANTILLA) {
    const v = origen[k];
    if (v !== undefined && v !== null && v !== "") destino[k] = v;
  }
  return base;
}

const PATRON_RETICULA: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(0deg, rgba(17,17,17,0.06) 0px, rgba(17,17,17,0.06) 1px, transparent 1px, transparent 24px),"
    + "repeating-linear-gradient(90deg, rgba(17,17,17,0.06) 0px, rgba(17,17,17,0.06) 1px, transparent 1px, transparent 24px)",
};

/** Ancho fijo al que se diseñó la ficha (rango 900-1100px de la
 *  especificación) — se mide siempre a este ancho y luego se escala
 *  completa para caber en el marco del formato elegido, sin reflujar la
 *  composición (un jarrón casi cuadrado y una etiqueta de 5 mL muy
 *  apaisada no pueden compartir el mismo layout interno). */
const ANCHO_DISENO = 960;
/** Ancho del marco de formato: el mismo del diseño, o sea el 100 %. La
 *  etiqueta se MAQUETA siempre a esta medida —encogerla cambiando medidas
 *  rompía la edición— y, si no cabe en la ventana, se DIBUJA escalada con un
 *  `transform` sobre el lienzo entero (`useEscalaAjuste`), que no altera ni
 *  la maquetación ni dónde caen los clics. */
const MARCO_MAX_ANCHO = ANCHO_DISENO;
/** Tope de ensanche de la maquetación (`anchoLayout`). Al dibujarse escalada a
 *  `ANCHO_DISENO`, ensanchar al doble es ver la etiqueta a la mitad de tamaño:
 *  más allá el texto ya no se lee y es mejor que el marco enseñe que no cabe. */
const ANCHO_LAYOUT_MAX = ANCHO_DISENO * 2;
/** Filas del cuerpo (atributos + columna derecha). Alto mínimo = ícono 64 +
 *  título ~26 + 3 renglones de texto (~51 px a 14 px) + relleno 20 → 160 px:
 *  las tres filas miden lo mismo aunque una tenga 1 renglón y otra 3, y solo
 *  crecen pasados los 3. */
const FILAS_CUERPO = "repeat(3, minmax(160px, auto))";
/** Con un formato elegido el lienzo mide al menos el alto del marco, así que
 *  las tres filas se reparten a partes iguales lo que sobra tras cabecera,
 *  código de barras y pie — normalmente más que los 160 px mínimos de
 *  `FILAS_CUERPO`. El mínimo es `min-content` y no 0: la fila reparte el
 *  sobrante pero nunca queda por debajo de lo que su texto necesita, así no
 *  se recorta ningún renglón cuando el contenido es largo. */
const FILAS_CUERPO_REPARTIDAS = "repeat(3, minmax(min-content, 1fr))";

export interface EntradaFormularioEtiqueta {
  /** Abrir una plantilla o etiqueta guardada por su id. */
  fichaId?: string | null;
  /** Nueva etiqueta de producto a partir de esta plantilla (pide el SKU). */
  nuevaEtiquetaDePlantilla?: string | null;
  /** Nueva plantilla para esta categoría (pide el tamaño). */
  nuevaPlantillaCategoria?: string | null;
  /** Etiqueta nueva para este SKU: el creador arranca con el producto ya elegido
   *  (lo usa el taller de combos). */
  sku?: string | null;
}

/** Ventana de desenfoque por recuadro (la misma de Studio Visual), cargada
 *  aparte para no arrastrar la librería de exportación al chunk de la ficha. */
/** Editor de Docs técnicos, para corregir la ficha técnica enlazada sin salir de la etiqueta. */
const FichasTecnicasPanel = lazy(() => import("../FichasTecnicasPanel"));
/** Radio del desenfoque del PNG digital de la etiqueta (automático y a mano). */
const RADIO_DESENFOQUE_ETIQUETA = 10;
const DesenfoquePlantillaModal = lazy(() => import("../plantillas-visuales/DesenfoquePlantillaModal"));

/** Escala de rasterizado para imprimir. Debe ser un entero PAR: las líneas de
 *  la tabla miden 1,5 px de diseño y solo con escala par caen en píxeles
 *  enteros (×2 → 3 px). Con la escala "exacta" de 300/600 dpi (0,94 · 1,89)
 *  unas líneas salían de 1 px y otras de 2, y las finas se perdían al
 *  reducir la imagen en Diseño → Imprimir. El tamaño físico no depende de
 *  esto: el PDF se arma con los mm del formato. */
function escalaRasterImpresion(anchoMm: number, anchoDiseno: number): number {
  const a600 = ((anchoMm / 25.4) * 600) / anchoDiseno;
  return a600 <= 2 ? 2 : 4;
}

function dpiDeEscala(anchoMm: number, anchoDiseno: number, escala: number): number {
  return Math.round((anchoDiseno * escala) / (anchoMm / 25.4));
}

interface PropsFormulario {
  onVolver: () => void;
  entrada?: EntradaFormularioEtiqueta | null;
  /** Dónde se corrige la ficha técnica. Sin esto, el botón «Ficha técnica» la
   *  abre en un emergente; el Espacio de producto la tiene en su propia pestaña. */
  onAbrirFichaTecnica?: () => void;
  /** Cómo estaba la ficha técnica antes de que se editara en otra pestaña (Espacio
   *  de producto): sirve de punto de comparación si la etiqueta aún no tiene el suyo. */
  fichaAntes?: { id: string; foto: Record<string, string> } | null;
}

export default function ProductLabelForm(props: PropsFormulario) {
  return (
    <TextStyleProvider>
      <ProductLabelFormInner {...props} />
    </TextStyleProvider>
  );
}

function ProductLabelFormInner({
  onVolver,
  entrada,
  onAbrirFichaTecnica,
  fichaAntes = null,
}: PropsFormulario) {
  const { data: tiposData, isLoading: tiposLoading } = useTiposEtiqueta();
  const tipos = tiposData?.tipos ?? [];

  const [tipoNombre, setTipoNombre] = useState("");
  const tipo: TipoEtiqueta | undefined = tipos.find((t) => t.nombre === tipoNombre);
  /** El formato 30 mL es otra composición (tres paneles horizontales) con
   *  su propio formulario; el resto de formatos usa la ficha de 76 × 66. */
  const es30ml = esFormato30ml(tipoNombre, tipo);
  /** 69 × 51 mm ("100 g"): diagramación simple de dos columnas. */
  const esSimple = esFormatoSimple(tipoNombre, tipo);
  /** 66 × 22 mm ("5 mL"): los tres paneles del 30 mL, reducidos a dos filas
   *  (frascos de Aceites Esenciales). */
  const es5ml = esFormato5ml(tipoNombre, tipo);
  /** 53 × 53 mm: etiqueta redonda de ceras y mantecas (composición radial). */
  const esCircular = esFormatoCircular(tipoNombre, tipo);
  const esVertical = esFormatoVertical(tipoNombre, tipo);
  /** Diámetro final de impresión de la etiqueta redonda, en mm (§14). Es lo
   *  único físico que el operador puede mover: el diseño se maqueta siempre
   *  1:1 a `DIAMETRO_CIRCULAR` y solo cambia a cuántos milímetros se rasteriza
   *  o se vectoriza. `null` = el del Formato elegido. */
  const [diametroMm, setDiametroMm] = useState<number | null>(null);
  /** Formatos que se maquetan como la ficha de dos columnas dentro del marco
   *  punteado (todo lo que no tiene composición propia). */
  const usaMarcoFicha = Boolean(
    tipo && tipo.ancho_mm && tipo.alto_mm && !es30ml && !es5ml && !esSimple && !esCircular && !esVertical,
  );
  /** Ancho al que se MAQUETA la ficha. Arranca en el de diseño y solo crece
   *  cuando el texto ya no cabe en el alto del formato: al maquetar más ancho,
   *  los párrafos ocupan menos renglones y la ficha vuelve a caber; luego se
   *  dibuja escalada a `ANCHO_DISENO`, así que se ve más pequeña pero LLENA el
   *  marco. Encogerla sin ensanchar la maquetación —lo que se hacía antes— la
   *  reducía en alto y en ancho a la vez y dejaba la banda blanca a la derecha
   *  (y el PNG salía con otra proporción que la del formato). */
  const [anchoLayout, setAnchoLayout] = useState(ANCHO_DISENO);
  /** Alto exacto del marco al ancho de maquetación actual: el lienzo se fija a
   *  esa medida y las filas del cuerpo se reparten el alto sobrante, así la
   *  etiqueta llena el marco en vez de quedarse corta (hueco abajo). */
  const altoMarcoFicha =
    usaMarcoFicha && tipo ? anchoLayout / (tipo.ancho_mm! / tipo.alto_mm!) : undefined;
  const anchoDiseno = es30ml
    ? ANCHO_30ML
    : es5ml
      ? ANCHO_5ML
      : esSimple
      ? ANCHO_SIMPLE
      : esCircular
        ? DIAMETRO_CIRCULAR
        : anchoLayout;
  /** Medidas físicas con las que se imprime: las del Formato, salvo que en la
   *  redonda se haya fijado otro diámetro. Cuadrada siempre, nunca se deforma. */
  const anchoImpresionMm = esCircular ? (diametroMm ?? tipo?.ancho_mm) : tipo?.ancho_mm;
  const altoImpresionMm = esCircular ? (diametroMm ?? tipo?.alto_mm ?? tipo?.ancho_mm) : tipo?.alto_mm;

  // "inicio": elegir Formato + SKU (o abrir una ficha guardada) — la ficha
  // no se muestra ni carga nada hasta entonces. "formulario": la ficha.
  const [etapa, setEtapa] = useState<"inicio" | "formulario">("inicio");
  const [data, setData] = useState<ProductLabelData>(PRODUCTO_VACIO);
  const [editMode, setEditMode] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [attributeIcons, setAttributeIcons] = useState<Partial<Record<IconoKey, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const [guardarMsg, setGuardarMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  /** PNG ya renderizado, a la espera de que el operador lo confirme en la
   *  vista previa (nada se sube hasta entonces). */
  const [previa, setPrevia] = useState<{
    blob: Blob;
    url: string;
    anchoPx: number;
    altoPx: number;
    anchoMm?: number;
    altoMm?: number;
    dpi?: number;
    pixelRatio: number;
  } | null>(null);
  const cerrarPrevia = () => {
    setPrevia((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
    cerrarDigital();
  };

  /** Casilla "Desenfoque" de la cabecera. Marcada por defecto: cada etiqueta
   *  necesita sus dos PNG. Al terminar se generan a la vez el de impresión y el
   *  digital (OCR de "MCKENNA GROUP" + desenfoque local, sin marcar nada a mano);
   *  la persona solo revisa las dos vistas previas y aprueba. El digital va a
   *  PUBLICACIONES DIGITALES/<Categoría>, fuera de impresión. */
  const [desenfoqueActivo, setDesenfoqueActivo] = useState(true);
  /** Versión desenfocada que acompaña a `previa`. */
  const [digital, setDigital] = useState<{
    estado: "preparando" | "listo" | "error";
    blob?: Blob;
    url?: string;
    msg?: string;
  } | null>(null);
  const turnoDigitalRef = useRef(0);
  const cerrarDigital = () => {
    turnoDigitalRef.current++;
    setDigital((d) => {
      if (d?.url) URL.revokeObjectURL(d.url);
      return null;
    });
  };
  /** Ventana de desenfoque a mano: solo si el automático no tapó algo. */
  const [ajusteManual, setAjusteManual] = useState(false);
  const fijarDigital = (blob: Blob, msg?: string) => {
    setDigital((d) => {
      if (d?.url) URL.revokeObjectURL(d.url);
      return { estado: "listo", blob, url: URL.createObjectURL(blob), msg };
    });
  };
  /** OCR → zonas de la marca → desenfoque en el navegador, con el mismo radio
   *  que la ventana manual (RADIO_DESENFOQUE_ETIQUETA). Sin zonas, se pide
   *  marcarlas a mano. */
  const prepararDigital = async (blob: Blob) => {
    const turno = ++turnoDigitalRef.current;
    setDigital({ estado: "preparando" });
    try {
      const { detectarMarcaPorOcr } = await import("../../lib/ocrMarca");
      const zonas = await detectarMarcaPorOcr(blob);
      if (turno !== turnoDigitalRef.current) return;
      if (!zonas.length) {
        setDigital({ estado: "error", msg: 'El OCR no encontró "MCKENNA GROUP". Marca las zonas a mano.' });
        return;
      }
      const b = await desenfocarBlobLocal(blob, zonas, { radio: RADIO_DESENFOQUE_ETIQUETA, formato: "png" });
      if (turno !== turnoDigitalRef.current) return;
      fijarDigital(b, `${zonas.length} ${zonas.length === 1 ? "zona desenfocada" : "zonas desenfocadas"} automáticamente.`);
    } catch (e) {
      if (turno !== turnoDigitalRef.current) return;
      setDigital({ estado: "error", msg: `No se pudo desenfocar solo (${e instanceof Error ? e.message : "error"}). Marca las zonas a mano.` });
    }
  };

  /** Cambios del GHS hechos a mano (galería): la ficha técnica llega en
   *  segundo plano tras elegir el SKU y no debe pisar un pictograma que el
   *  operador eligió mientras tanto. */
  const cambiosGhsRef = useRef(0);
  const onChange = (patch: Partial<ProductLabelData>) => {
    if ("ghs" in patch || "ghsIconSvg" in patch) cambiosGhsRef.current += 1;
    setData((d) => {
      const next = { ...d, ...patch };
      // Al aplicar una ficha técnica manda la conservación de la FAMILIA (la que
      // fija la plantilla), no la de la ficha: cada ficha la redacta distinto y
      // la categoría quiere una sola. Escribir en la casilla no pasa por aquí.
      if (patch.fichaTecnicaId && d.storageSugerido) next.storage = d.storageSugerido;
      return next;
    });
  };
  const onIconChange = (campo: IconoKey, svgDataUrl: string) =>
    setAttributeIcons((prev) => ({ ...prev, [campo]: svgDataUrl }));

  // ── Fichas guardadas: nombre elegido a mano por el operador (nunca
  // derivado de data.productName) + autoguardado en backend por cada ficha.
  const { estilos, reemplazarEstilos } = useTextStyleCtx();
  const { data: fichasTodas } = useFichasEtiquetaGuardadas();
  const plantillaBase = fichasTodas?.find((f) => f.id === PLANTILLA_ID);
  // Plantillas por categoría: las etiquetas marcadas con `es_plantilla_categoria`.
  // (El criterio viejo era el id `__plantilla__:<cat>`, que solo guardaba campos
  // fijos de marca y no servía como formato de la familia.)
  const plantillasPorCategoria = useMemo(() => {
    const m = new Map<string, FichaEtiquetaGuardada>();
    for (const f of fichasTodas ?? []) {
      if (!f.es_plantilla_categoria || !f.categoria) continue;
      if (!m.has(f.categoria)) m.set(f.categoria, f);
    }
    return m;
  }, [fichasTodas]);
  /** Todo lo guardado que no sea plantilla ni resto del mecanismo viejo. */
  const fichasGuardadas = fichasTodas?.filter(
    (f) => !esIdPlantillaFicha(f.id) && !f.es_plantilla_categoria,
  );
  const plantillasGuardadas = fichasTodas?.filter((f) => f.es_plantilla_categoria) ?? [];
  const [categoria, setCategoria] = useState<string>(CATEGORIA_ETIQUETA_OTROS);
  const plantilla = plantillasPorCategoria.get(categoria) ?? plantillaBase;
  const guardarFichaMutation = useGuardarFichaEtiqueta();
  const recipientes = useRecipientes().data;
  const eliminarFichaMutation = useEliminarFichaEtiqueta();
  const [plantillaMsg, setPlantillaMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const [nombreFicha, setNombreFicha] = useState("");
  /** La ficha en edición se guardará como plantilla de su categoría. */
  const [esPlantillaNueva, setEsPlantillaNueva] = useState(false);
  /** Plantilla de la que salió la etiqueta en edición. */
  const [plantillaOrigenId, setPlantillaOrigenId] = useState<string | null>(null);
  const { data: catsData } = useCategoriasEtiqueta();
  const categorias = Array.isArray(catsData) ? catsData : CATEGORIAS_ETIQUETA;
  /** Nombre VIGENTE de la categoría (el que editó el operador). `etiquetaCategoria`
   *  a secas lee la lista fija del código: con ella el lote guardaba en
   *  «Semillas» lo que el panel llama «Semillas & Frutos Secos», y en el id
   *  crudo las categorías creadas desde el panel. */
  const nombreCategoria = (id: string | undefined | null) => etiquetaCategoriaEn(categorias, id);
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [autoguardado, setAutoguardado] = useState<
    { estado: "idle" | "pendiente" | "guardando" | "ok" | "error"; texto?: string }
  >({ estado: "idle" });

  // El id vive también en un ref porque el efecto de autoguardado NO lo lleva en
  // sus dependencias: sin esto, escribir mientras el primer POST está en vuelo
  // creaba una SEGUNDA ficha (el closure seguía viendo fichaId=null). Se notaba
  // como pares de etiquetas creadas con 2 segundos de diferencia, una de ellas
  // congelada a medio escribir.
  const fichaIdRef = useRef<string | null>(null);
  useEffect(() => {
    fichaIdRef.current = fichaId;
  }, [fichaId]);
  /** Hay un alta en vuelo: no se puede lanzar otra o se duplica. */
  const creandoRef = useRef(false);
  const [reintentoGuardado, setReintentoGuardado] = useState(0);

  useEffect(() => {
    const nombre = nombreFicha.trim();
    if (!nombre || etapa !== "formulario") {
      setAutoguardado({ estado: "idle" });
      return;
    }
    setAutoguardado({ estado: "pendiente" });
    const t = setTimeout(() => {
      const idActual = fichaIdRef.current;
      if (!idActual && creandoRef.current) {
        // El alta va en camino: se reintenta en breve, cuando el id exista. Sin
        // el reintento, dejar de escribir justo aquí perdía el último cambio.
        setReintentoGuardado((n) => n + 1);
        return;
      }
      if (!idActual) creandoRef.current = true;
      setAutoguardado({ estado: "guardando" });
      guardarFichaMutation.mutate(
        {
          id: idActual ?? undefined,
          nombre,
          data,
          tipo_nombre: tipoNombre || undefined,
          categoria: categoria || undefined,
          es_plantilla_categoria: esPlantillaNueva || undefined,
          plantilla_id: plantillaOrigenId || undefined,
          attribute_icons: attributeIcons,
          text_styles: estilos,
        },
        {
          onSuccess: (res) => {
            fichaIdRef.current = res.ficha.id;
            setFichaId(res.ficha.id);
            setAutoguardado({ estado: "ok", texto: "Guardado" });
          },
          onError: (err) => {
            setAutoguardado({
              estado: "error",
              texto: err instanceof Error ? err.message : "No se pudo guardar",
            });
          },
          onSettled: () => {
            creandoRef.current = false;
          },
        },
      );
    }, AUTOGUARDADO_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nombreFicha,
    data,
    tipoNombre,
    categoria,
    esPlantillaNueva,
    plantillaOrigenId,
    attributeIcons,
    estilos,
    etapa,
    reintentoGuardado,
  ]);

  // Crear plantillas dejó de vivir aquí: la plantilla de una categoría es de
  // lienzo (única que genera etiquetas de muchos SKU de golpe y con ajuste caja
  // por caja). Esta pantalla hace UNA etiqueta suelta. Las plantillas que se
  // crearon antes por aquí (`__plantilla__:<categoría>`) siguen visibles en la
  // portada de Studio y se abren desde ahí.

  const abrirFichaGuardada = (f: FichaEtiquetaGuardada) => {
    setData(f.data);
    setTipoNombre(nombreTipoEtiquetaCanonico(f.tipo_nombre));
    setAttributeIcons(f.attribute_icons || {});
    reemplazarEstilos(f.text_styles || {});
    setNombreFicha(f.nombre);
    fichaIdRef.current = f.id;
    creandoRef.current = false;
    setEsPlantillaNueva(Boolean(f.es_plantilla_categoria));
    setPlantillaOrigenId(f.plantilla_id ?? null);
    setCategoria(f.categoria || detectarCategoriaEtiqueta(f.data?.productName || f.nombre));
    setFichaId(f.id);
    setAutoguardado({ estado: "idle" });
    setEnlace(null);
    setEtapa("formulario");
  };

  /** Vuelve a la pantalla de inicio (Formato + SKU) sin información cargada. */
  const nuevaFicha = () => {
    setData(PRODUCTO_VACIO);
    setTipoNombre("");
    setAttributeIcons({});
    reemplazarEstilos({});
    setNombreFicha("");
    setCategoria(CATEGORIA_ETIQUETA_OTROS);
    setFichaId(null);
    fichaIdRef.current = null;
    creandoRef.current = false;
    setAutoguardado({ estado: "idle" });
    setEnlace(null);
    setPlantillaMsg(null);
    setEtapa("inicio");
  };

  /** Inicio → formulario: ficha vacía + plantilla, y la información del SKU.
   *
   *  La categoría llega desde la pantalla de inicio (detectada del nombre del
   *  SKU y corregible a mano); hay que resolver la plantilla con ESE valor y no
   *  con el estado `categoria`, que aún no se ha actualizado en este render. */
  const crearFichaDesdeSku = async (tipoNom: string, codigo: CodigoEan, categoriaElegida: string) => {
    const plantillaInicial = plantillasPorCategoria.get(categoriaElegida) ?? plantillaBase;
    setCategoria(categoriaElegida);
    setData(fichaDesdePlantilla(plantillaInicial));
    setAttributeIcons(plantillaInicial?.attribute_icons ?? {});
    reemplazarEstilos(plantillaInicial?.text_styles ?? {});
    setTipoNombre(tipoNom);
    setFichaId(null);
    setEditMode(true);
    setPlantillaMsg(null);
    setEtapa("formulario");
    onChange({ barcode: (codigo.codigo || "").replace(/\D/g, "").slice(0, 13) });
    await onElegirCodigo(codigo, true);
  };

  // Abrir directo lo que se pidió desde Studio, sin pasar por pantallas
  // intermedias: llegar a una etiqueta concreta eran tres saltos.
  const abiertaRef = useRef(false);
  useEffect(() => {
    const id = entrada?.fichaId;
    if (abiertaRef.current || !id) return;
    const f = fichasTodas?.find((x) => x.id === id);
    if (!f) return;
    abiertaRef.current = true;
    abrirFichaGuardada(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada?.fichaId, fichasTodas]);

  const plantillaDeEntrada = entrada?.nuevaEtiquetaDePlantilla
    ? fichasTodas?.find((f) => f.id === entrada.nuevaEtiquetaDePlantilla)
    : undefined;

  /** Nueva plantilla de una categoría.
   *
   *  `baseId` es la plantilla de la que se copia el ajuste — puede ser de OTRA
   *  categoría: el diseño ya afinado de una familia suele servir de punto de
   *  partida para la siguiente. Sin base, arranca en blanco. */
  const crearPlantillaDeCategoria = (
    categoriaId: string,
    tamano: string,
    baseId?: string | null,
  ) => {
    const previa = baseId
      ? fichasTodas?.find((f) => f.id === baseId)
      : plantillasPorCategoria.get(categoriaId);
    const nombre = nombrePlantillaCategoria(categorias, categoriaId, tamano);
    // De la misma familia se copia todo el diseño; de otra categoría, SOLO la
    // parte fija de marca — logo, acento, contacto, documentos —. En ningún
    // caso los datos del producto: una plantilla no es de ningún producto.
    const mismaFamilia = Boolean(previa && previa.categoria === categoriaId);
    setCategoria(categoriaId);
    setTipoNombre(tamano);
    setData(
      previa?.data
        ? mismaFamilia
          ? sinDatosDeProducto(previa.data)
          : fichaDesdePlantilla(previa)
        : fichaDesdePlantilla(plantillaBase),
    );
    // La etiqueta de 30 mL tiene su propio juego de íconos (matraz, medalla,
    // termómetro…): partiendo de una plantilla de otro formato no se heredan.
    const mismoDiseno = esFormato30ml(tamano) === esFormato30ml(previa?.tipo_nombre);
    setAttributeIcons(
      mismoDiseno ? (previa?.attribute_icons ?? plantillaBase?.attribute_icons ?? {}) : {},
    );
    reemplazarEstilos(previa?.text_styles ?? plantillaBase?.text_styles ?? {});
    setNombreFicha(nombre);
    setFichaId(null);
    fichaIdRef.current = null;
    creandoRef.current = false;
    setEsPlantillaNueva(true);
    setPlantillaOrigenId(null);
    setEditMode(true);
    setEnlace(null);
    setEtapa("formulario");
  };

  /** Nueva etiqueta de un producto: toma el diseño de la plantilla de la
   *  categoría con los datos de producto EN BLANCO, y los llena con el SKU
   *  elegido y su ficha técnica. Si la ficha no aparece, quedan casillas
   *  vacías a la vista, nunca los datos del producto de la plantilla. */
  const crearEtiquetaDesdePlantilla = async (
    plantilla: FichaEtiquetaGuardada,
    codigo: CodigoEan,
  ) => {
    setCategoria(plantilla.categoria || CATEGORIA_ETIQUETA_OTROS);
    setTipoNombre(nombreTipoEtiquetaCanonico(plantilla.tipo_nombre));
    setData(sinDatosDeProducto(plantilla.data));
    setAttributeIcons(plantilla.attribute_icons ?? {});
    reemplazarEstilos(plantilla.text_styles ?? {});
    setFichaId(null);
    fichaIdRef.current = null;
    creandoRef.current = false;
    setEsPlantillaNueva(false);
    setPlantillaOrigenId(plantilla.id);
    setEditMode(true);
    setEtapa("formulario");
    onChange({ barcode: (codigo.codigo || "").replace(/\D/g, "").slice(0, 13) });
    await onElegirCodigo(codigo, true);
  };

  /** Copia una etiqueta guardada conservando su formato ya ajustado: es la forma
   *  de reusar una etiqueta bien terminada para otro producto. */
  const duplicarFichaGuardada = (f: FichaEtiquetaGuardada) => {
    guardarFichaMutation.mutate(
      {
        nombre: `${f.nombre} (copia)`,
        data: f.data,
        tipo_nombre: f.tipo_nombre,
        categoria: f.categoria,
        attribute_icons: f.attribute_icons,
        text_styles: f.text_styles,
      },
      { onSuccess: (res) => abrirFichaGuardada(res.ficha) },
    );
  };

  const eliminarFichaGuardada = (f: FichaEtiquetaGuardada) => {
    eliminarFichaMutation.mutate(f.id);
    if (f.id === fichaId) nuevaFicha();
  };

  // ── Código de barras elegido: su título nombra el archivo (PNG y ficha
  // guardada) y busca, por palabras clave, la ficha técnica que le
  // corresponde para autorellenar la etiqueta (ver lib/fichaTecnicaMatch).
  const [enlace, setEnlace] = useState<{ tipo: "ok" | "info" | "error"; texto: string } | null>(null);
  /** Elegir un SKU dentro de una PLANTILLA no la toca: se abre una etiqueta
   *  nueva con su diseño (y los datos de producto en blanco) que se guarda
   *  aparte con el nombre del SKU. Antes el autoguardado escribía sobre la
   *  plantilla, que quedaba llamándose como el producto ("COCO DESHIDRATADO
   *  HILOS 250g" en vez de "Plantilla de Sales minerales tamaño 500 g").
   *  `yaEsEtiquetaNueva`: lo pasan las funciones que crean la etiqueta, porque
   *  `esPlantillaNueva` de este render todavía no refleja su cambio. */
  const onElegirCodigo = async (codigo: CodigoEan, yaEsEtiquetaNueva = false) => {
    const titulo = (codigo.nombre_producto || codigo.sku || "").trim();
    if (!titulo) return;
    if (esPlantillaNueva && !yaEsEtiquetaNueva) {
      const plantillaId = fichaIdRef.current;
      fichaIdRef.current = null;
      creandoRef.current = false;
      setFichaId(null);
      setEsPlantillaNueva(false);
      setPlantillaOrigenId(plantillaId);
      setData((d) => ({
        ...sinDatosDeProducto(d),
        barcode: (codigo.codigo || "").replace(/\D/g, "").slice(0, 13),
      }));
      setPlantillaMsg({
        ok: true,
        texto: `Etiqueta nueva «${titulo}» a partir de la plantilla: se guarda aparte y la plantilla no cambia.`,
      });
    }
    setNombreFicha(titulo);
    // Contenido neto = presentación del SKU ("30mL", "500g", "1 Kg"); si la
    // ficha técnica también trae uno, manda el del SKU (es el envase real).
    const neto = contenidoNetoDesdeCodigo(codigo);
    onChange({ barcodeTitle: titulo, ...(neto ? { netContent: neto } : {}) });
    const claves = palabrasClave(titulo);
    setEnlace({ tipo: "info", texto: `Buscando ficha técnica para "${titulo}"…` });
    const ghsAntes = cambiosGhsRef.current;
    try {
      const fichas = await listarFichasTecnicas();
      const mejor = mejorFichaParaTitulo(fichas, titulo);
      if (!mejor || mejor.puntaje < UMBRAL_ENLACE_AUTOMATICO) {
        onChange({ fichaTecnicaId: "", fichaTecnicaTitulo: "" });
        setEnlace({
          tipo: "info",
          texto:
            `Sin ficha técnica que coincida con "${titulo}" (palabras clave: ${claves.join(", ") || "ninguna"})`
            + (mejor ? ` — la más parecida es "${mejor.ficha.titulo}" (${Math.round(mejor.puntaje * 100)} %)` : "")
            + ". Usa la lupa junto al nombre para elegirla a mano.",
        });
        return;
      }
      const patch = await cargarPatchDesdeFichaTecnica(mejor.ficha.id);
      if (cambiosGhsRef.current !== ghsAntes) {
        // Se eligió un pictograma a mano mientras cargaba la ficha: manda ese.
        delete patch.ghs;
        delete patch.ghsIconSvg;
        delete patch.clasificacionTexto;
      }
      onChange({
        ...patch,
        ...(neto ? { netContent: neto } : {}),
        fichaTecnicaId: mejor.ficha.id,
        fichaTecnicaTitulo: mejor.ficha.titulo,
        fichaTecnicaBase: fotoFicha(patch),
      });
      // Hay productos con dos fichas (p. ej. "GLICERINA" y "GLICERINA
      // VEGETAL"): la del título más parecido gana, pero puede no ser la que
      // tiene los datos. Se nombran las otras para poder corregir con la lupa.
      const otras = candidatasParaTitulo(fichas, titulo)
        .filter((c) => c.ficha.id !== mejor.ficha.id)
        .slice(0, 2);
      setEnlace({
        tipo: "ok",
        texto:
          `Ficha técnica enlazada: ${mejor.ficha.titulo} (coincidencia ${Math.round(mejor.puntaje * 100)} % por: ${claves.join(", ")}).`
          + (otras.length > 0
            ? ` También coincide${otras.length > 1 ? "n" : ""} ${otras
                .map((c) => `«${c.ficha.titulo}» (${Math.round(c.puntaje * 100)} %)`)
                .join(" y ")} — usa la lupa junto al nombre si esa es la correcta.`
            : ""),
      });
    } catch (e) {
      setEnlace({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo enlazar la ficha técnica" });
    }
  };

  // Alto real de la ficha a su ancho de maquetación (varía con el texto que se
  // escriba) — se mide para poder escalarla completa dentro del marco del
  // formato sin romper la composición interna.
  const fichaRef = useRef<HTMLDivElement>(null);
  const [altoDiseno, setAltoDiseno] = useState(700);
  const proporcionMarco = usaMarcoFicha && tipo ? tipo.ancho_mm! / tipo.alto_mm! : undefined;

  // Ancho de maquetación: el MENOR (desde el de diseño) al que el contenido
  // cabe en el alto del formato. Se busca de cero en cada cambio, probando
  // anchos directamente sobre el lienzo antes de pintar: al maquetar más ancho
  // los párrafos ocupan menos renglones, así que el exceso baja en cada vuelta
  // hasta caber; el tope evita iterar con un texto imposible de encajar (ahí
  // se dibuja escalada por alto y el marco enseña que no cabe).
  //
  // Antes esto se iteraba con estado (medir → ensanchar → volver a medir) y
  // fallaba de dos maneras: se medía con los campos de texto todavía al alto
  // del ancho anterior (ensanchaba de más), y tras reducir un texto o su
  // tamaño de letra el ancho ya no volvía a bajar — la etiqueta se quedaba
  // pequeña, con una banda blanca debajo del pie.
  useLayoutEffect(() => {
    const el = fichaRef.current;
    if (!el) return;
    if (!proporcionMarco) {
      const medir = () => setAltoDiseno(el.offsetHeight);
      medir();
      const ro = new ResizeObserver(medir);
      ro.observe(el);
      return () => ro.disconnect();
    }
    const campos = () => el.querySelectorAll("textarea").forEach(ajustarAltoTextarea);
    const ajustar = () => {
      // Alto natural: sin el alto mínimo del marco, que lo taparía.
      el.style.minHeight = "0px";
      // Menos de 1 px de etiqueta: con más holgura la ficha se escalaba por
      // alto y asomaba un filo vacío a la derecha.
      const HOLGURA = 1.001;
      const excesoA = (ancho: number) => {
        el.style.width = `${ancho}px`;
        campos();
        return el.offsetHeight / (ancho / proporcionMarco);
      };
      // 1) Ensanchar en la proporción del exceso hasta que quepa (se pasa de
      //    largo: el texto refluye y el alto baja más de lo calculado)…
      let ancho = ANCHO_DISENO;
      let noCabe = 0;
      for (let vuelta = 0; vuelta < 8; vuelta++) {
        const exceso = excesoA(ancho);
        if (exceso <= HOLGURA || ancho >= ANCHO_LAYOUT_MAX) break;
        noCabe = ancho;
        ancho = Math.min(ANCHO_LAYOUT_MAX, Math.ceil(ancho * exceso));
      }
      // 2) …y afinar por bisección entre el último ancho que no cupo y ese:
      //    cada píxel de más es texto más pequeño de lo necesario.
      if (noCabe && excesoA(ancho) <= HOLGURA) {
        let cabe = ancho;
        while (cabe - noCabe > 6) {
          const medio = Math.round((cabe + noCabe) / 2);
          if (excesoA(medio) <= HOLGURA) cabe = medio;
          else noCabe = medio;
        }
        ancho = cabe;
      }
      excesoA(ancho);
      // El lienzo queda como lo va a dejar React (que solo reescribe un estilo
      // cuando su valor cambia): ancho final y alto mínimo del marco.
      el.style.minHeight = `${ancho / proporcionMarco}px`;
      setAnchoLayout(ancho);
      setAltoDiseno(el.offsetHeight);
    };
    ajustar();
    // Lo que cambia el alto sin pasar por el estado: fuentes e imágenes que
    // terminan de cargar.
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, estilos, attributeIcons, editMode, proporcionMarco]);

  const discrepancia = discrepanciaProducto(data.barcodeTitle, data.fichaTecnicaTitulo, data.productName);
  const [confirmarDiscrepancia, setConfirmarDiscrepancia] = useState(false);

  const marco = useMemo(() => {
    if (!tipo || !tipo.ancho_mm || !tipo.alto_mm) return null;
    const ratio = tipo.ancho_mm / tipo.alto_mm;
    const ancho = MARCO_MAX_ANCHO;
    const alto = ancho / ratio;
    // A tamaño completo la escala es 1; baja cuando la ficha se maquetó más
    // ancha para que el texto cupiera (y entonces llena el marco justo), o
    // —último recurso, con el ancho ya en el tope— porque sigue sin caber de
    // alto, que es lo que el marco tiene que enseñar. Nunca por el tamaño de
    // la ventana: de eso se encarga `ajusteFicha`.
    const escala = Math.min(1, ancho / Math.max(anchoLayout, 1), alto / Math.max(altoDiseno, 1));
    return { ancho, alto, escala };
  }, [tipo, altoDiseno, anchoLayout]);

  // Y encima de esa escala, la que haga falta para que el marco entero quepa
  // en el hueco disponible (el mismo criterio que usa `Marco30ml` para los
  // demás formatos): la etiqueta se ve completa, sin barras que recorrer.
  const ajusteFicha = useEscalaAjuste(marco?.ancho ?? 0, marco?.alto ?? 0, {
    llenar: true,
    maximo: ESCALA_MAXIMA_MESA,
    margen: MARGEN_MESA,
  });

  /** Renderiza el PNG listo para imprimir (300 DPI si hay Formato elegido;
   *  si no, una escala fija alta) y lo muestra en una vista previa. La
   *  subida a Diseño → Imprimir (`ETIQUETAS STUDIO`, mismo destino que usa
   *  Estudio Visual) solo ocurre al confirmar en esa vista previa. */
  const generarPng = async (aunConDiscrepancia = false) => {
    const el = fichaRef.current;
    if (!el || guardando) return;
    // Código de barras de un producto y datos de otro: se pide confirmar en el
    // aviso rojo en vez de dejar imprimir la etiqueta así sin más.
    if (discrepancia && !aunConDiscrepancia) {
      setConfirmarDiscrepancia(true);
      return;
    }
    setConfirmarDiscrepancia(false);
    setGuardando(true);
    setGuardarMsg(null);
    const estabaEditando = editMode;
    try {
      // Capturar en modo vista: en edición se vería el borde punteado de
      // foco de cada casilla en vez del texto terminado.
      if (estabaEditando) {
        setEditMode(false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;

      const anchoMm = anchoImpresionMm;
      const altoMm = altoImpresionMm;
      // Con Formato elegido: escala para que el PNG mida exactamente
      // ancho_mm a 600dpi (a 300 las líneas de 1,5 px salían de 1 px y se perdían al reducir la imagen). Sin Formato ("tamaño libre"): escala fija alta
      // (960px de diseño × 3 ≈ 2880px), suficiente para imprimir bien sin
      // un tamaño físico de referencia.
      const pixelRatio = anchoMm ? escalaRasterImpresion(anchoMm, anchoDiseno) : 3;

      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(el, {
        pixelRatio,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      if (!blob) throw new Error("No se pudo generar la imagen de la ficha");

      const url = URL.createObjectURL(blob);
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = url;
      });
      cerrarPrevia();
      setPrevia({
        blob,
        url,
        anchoPx: dims.w,
        altoPx: dims.h,
        anchoMm,
        altoMm,
        dpi: anchoMm ? dpiDeEscala(anchoMm, anchoDiseno, pixelRatio) : undefined,
        pixelRatio,
      });
      // La versión digital se prepara mientras se revisa la de impresión.
      if (desenfoqueActivo) void prepararDigital(blob);
    } catch (e) {
      setGuardarMsg({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PNG" });
    } finally {
      if (estabaEditando) setEditMode(true);
      setGuardando(false);
    }
  };

  // ── Plantilla de categoría y generación en lote ───────────────────────────
  //
  // Este formato es "un formato unificado", no la etiqueta de un producto: se
  // marca como plantilla de su categoría y se despliega sobre varios SKU. El
  // render es del navegador (html-to-image), así que el lote se hace aquí,
  // secuencialmente: por cada SKU se aplican sus datos, se espera al repintado,
  // se rasteriza y se sube. No hay motor de servidor para esta ficha.

  const esPlantillaDeCategoria = Boolean(
    fichaId && fichasTodas?.find((f) => f.id === fichaId)?.es_plantilla_categoria,
  );

  // CONSERVACIÓN: «envase» si el combo de esta etiqueta va en frasco, «empaque» si va en
  // bolsa (lib/recipienteEtiqueta). Una plantilla no es de ningún combo: se deja como está.
  const recipiente = esPlantillaDeCategoria ? "" : recipientePara(recipientes, data.barcode, fichaId);
  useEffect(() => {
    if (!recipiente) return;
    setData((d) => {
      const actual = d.storage ?? "";
      const nuevo = palabraRecipiente(actual, recipiente);
      return nuevo === actual ? d : { ...d, storage: nuevo };
    });
  }, [recipiente, data.storage]);

  const marcarComoPlantilla = () => {
    if (!fichaId || !nombreFicha.trim()) return;
    setPlantillaMsg(null);
    guardarFichaMutation.mutate(
      {
        id: fichaId,
        nombre: nombreFicha.trim(),
        data,
        tipo_nombre: tipoNombre || undefined,
        categoria: categoria || undefined,
        es_plantilla_categoria: true,
        attribute_icons: attributeIcons,
        text_styles: estilos,
      },
      {
        onSuccess: () =>
          setPlantillaMsg({
            ok: true,
            texto: `Ya es la plantilla de «${nombreCategoria(categoria)}»: desde Studio → Categorías puedes generar con ella las etiquetas de la familia.`,
          }),
        onError: (err) =>
          setPlantillaMsg({
            ok: false,
            texto: err instanceof Error ? err.message : "No se pudo marcar como plantilla",
          }),
      },
    );
  };

  /** Una plantilla es diseño, no un producto: vacía los datos de producto
   *  (nombre, composición, CAS, código de barras, ficha técnica…) y deja
   *  logo, colores, tipografías, íconos, GHS, títulos y cuchara. */
  const [confirmarLimpiar, setConfirmarLimpiar] = useState(false);
  const plantillaConDatos = tieneDatosDeProducto(data);
  const limpiarPlantilla = () => {
    setData((d) => sinDatosDeProducto(d));
    setEnlace(null);
    setConfirmarLimpiar(false);
    setPlantillaMsg({ ok: true, texto: "Plantilla limpia: quedó solo el diseño." });
  };

  const [loteAbierto, setLoteAbierto] = useState(false);
  const [loteSeleccion, setLoteSeleccion] = useState<CodigoEan[]>([]);
  const [loteProgreso, setLoteProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [loteResultado, setLoteResultado] = useState<string[]>([]);

  const esperarRepintado = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /** Rasteriza la ficha tal como está ahora mismo en pantalla. */
  const rasterizarFichaActual = async (): Promise<{ blob: Blob; anchoMm?: number; altoMm?: number; ratio: number }> => {
    const el = fichaRef.current;
    if (!el) throw new Error("La ficha no está montada");
    if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
    const anchoMm = anchoImpresionMm;
    const altoMm = altoImpresionMm;
    const ratio = anchoMm ? escalaRasterImpresion(anchoMm, anchoDiseno) : 3;
    const { toBlob } = await import("html-to-image");
    const blob = await toBlob(el, { pixelRatio: ratio, backgroundColor: "#ffffff", cacheBust: true });
    if (!blob) throw new Error("No se pudo rasterizar la ficha");
    return { blob, anchoMm, altoMm, ratio };
  };

  /** Exporta la etiqueta redonda como SVG VECTORIAL (§16): los textos siguen
   *  siendo texto —los curvos con su `textPath`—, las barras siguen siendo
   *  barras y el archivo trae sus milímetros escritos, así que la imprenta lo
   *  abre a tamaño real sin escalar nada. No se rasteriza nada: el PNG sigue
   *  existiendo aparte para lo que sí necesita un mapa de bits.
   *
   *  Se captura en modo vista, como el PNG: en edición saldrían los bordes
   *  punteados de las casillas y los ejemplos grises. */
  const [exportandoSvg, setExportandoSvg] = useState(false);
  const exportarSvg = async () => {
    const el = fichaRef.current;
    if (!el || exportandoSvg || guardando) return;
    setExportandoSvg(true);
    setGuardarMsg(null);
    const estabaEditando = editMode;
    try {
      if (estabaEditando) {
        setEditMode(false);
        await esperarRepintado();
      }
      // Fuentes incrustadas: sin esto, la máquina que abra el SVG cae a su
      // sans-serif y Montserrat —que es parte del diseño— se pierde.
      let fuentesCss = "";
      try {
        const { getFontEmbedCSS } = await import("html-to-image");
        fuentesCss = await getFontEmbedCSS(el);
      } catch {
        fuentesCss = "";
      }
      const mm = anchoImpresionMm ?? 53;
      const svg = await svgEtiquetaCircular(el, { diametroMm: mm, fuentesCss });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivoSvg(data.barcodeTitle || data.productName || nombreFicha);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setGuardarMsg({ ok: true, texto: `SVG vectorial descargado, ${mm} mm de diámetro.` });
    } catch (e) {
      setGuardarMsg({ ok: false, texto: e instanceof Error ? e.message : "No se pudo exportar el SVG" });
    } finally {
      if (estabaEditando) setEditMode(true);
      setExportandoSvg(false);
    }
  };

  /** Restablecer: borra lo escrito a mano en los datos de producto y, en una
   *  etiqueta con SKU, los vuelve a cargar de su código de barras y su ficha
   *  técnica. El diseño (logo, color, contacto, íconos) no se toca. */
  const { data: codigosEan } = useCodigosEan();
  const esPlantillaEnEdicion = esPlantillaDeCategoria || esPlantillaNueva;
  const [confirmarRestablecer, setConfirmarRestablecer] = useState(false);

  /** Ortografía: se revisa TODA la etiqueta sola, sin botón que apretar. El
   *  corrector del navegador solo marca la casilla que se está editando, y
   *  casi todo lo que se imprime llegó de la ficha técnica sin que nadie lo
   *  escribiera aquí. Avisa; no bloquea imprimir. */
  const ortografia = useMemo(() => revisarOrtografiaEtiqueta(data), [data]);
  const [detalleOrto, setDetalleOrto] = useState(false);
  /** Menú «Más» de la barra de herramientas (acciones ocasionales). */
  const [menuMas, setMenuMas] = useState(false);
  /** Ficha técnica enlazada abierta en un emergente para corregirla. */
  const [fichaTecnicaAbierta, setFichaTecnicaAbierta] = useState(false);
  /** Foto de la ficha tomada al abrir el emergente, por si la etiqueta aún no
   *  tiene la suya guardada: sin punto de comparación no se sabría qué cambió. */
  const fotoAntesRef = useRef<{ id: string; foto: Record<string, string> } | null>(fichaAntes);
  /** Datos vigentes para después de un `await` (el cierre de la función ve los de antes). */
  const dataVigenteRef = useRef(data);
  dataVigenteRef.current = data;

  /** Ficha técnica → etiqueta: aplica lo que cambió en la ficha desde la última
   *  vez (ver lib/fichaTecnicaSync). Sin foto previa solo la toma, no cambia nada. */
  const sincronizarConFicha = async () => {
    const id = data.fichaTecnicaId;
    if (!id) return;
    // ¿Sigue siendo ESTE el documento del producto? Guardar un documento con otro
    // título crea otro archivo con el mismo SKU (el viejo se queda), y la etiqueta
    // seguía leyendo el viejo: lo editado no le llegaba nunca.
    let vigenteId = id;
    let vigenteTitulo = data.fichaTecnicaTitulo || "";
    try {
      const v = await api.get<{ id: string; titulo: string }>(`/api/fichas/datos/${encodeURIComponent(id)}/vigente`);
      if (v.id) {
        vigenteId = v.id;
        vigenteTitulo = v.titulo || vigenteTitulo;
      }
    } catch {
      /* sin respuesta: se sigue con el documento enlazado */
    }
    const relinkado = vigenteId !== id;
    let patch: Partial<ProductLabelData>;
    let fotoDelEnlazado: Record<string, string> | undefined;
    try {
      patch = await cargarPatchDesdeFichaTecnica(vigenteId);
      // Al cambiar de documento, lo que la etiqueta trajo del viejo es el punto de
      // comparación si todavía no guarda el suyo.
      if (relinkado) fotoDelEnlazado = fotoFicha(await cargarPatchDesdeFichaTecnica(id).catch(() => ({})));
    } catch {
      return; // sin conexión con la ficha: la etiqueta queda como estaba
    }
    const respaldo = (fotoAntesRef.current?.id === id ? fotoAntesRef.current.foto : undefined) ?? fotoDelEnlazado;
    fotoAntesRef.current = null;
    const foto = fotoFicha(patch);
    const actual = dataVigenteRef.current;
    if (actual.fichaTecnicaId !== id) return;
    const cambiados = Object.keys(cambiosDesdeFicha(actual, patch, actual.fichaTecnicaBase ?? respaldo));
    setData((d) => {
      if (d.fichaTecnicaId !== id) return d;
      const cambios = cambiosDesdeFicha(d, patch, d.fichaTecnicaBase ?? respaldo);
      const mismaFoto = JSON.stringify(d.fichaTecnicaBase ?? null) === JSON.stringify(foto);
      if (!relinkado && Object.keys(cambios).length === 0 && mismaFoto) return d;
      return {
        ...d,
        ...cambios,
        fichaTecnicaBase: foto,
        ...(relinkado ? { fichaTecnicaId: vigenteId, fichaTecnicaTitulo: vigenteTitulo } : {}),
      };
    });
    if (relinkado || cambiados.length > 0) {
      setGuardarMsg({
        ok: true,
        texto:
          (relinkado ? `Ahora sigue el documento vigente «${vigenteTitulo}». ` : "")
          + (cambiados.length > 0
            ? `Actualizado desde la ficha técnica: ${cambiados.map((k) => NOMBRE_CAMPO[k] ?? k).join(", ")}.`
            : "Sin datos distintos que traer."),
      });
    }
  };

  // Al abrir una etiqueta con ficha técnica enlazada, traer lo que cambió allá.
  const sincronizadaRef = useRef<string | null>(null);
  useEffect(() => {
    if (etapa !== "formulario" || !fichaId || !data.fichaTecnicaId) return;
    const clave = `${fichaId}:${data.fichaTecnicaId}`;
    if (sincronizadaRef.current === clave) return;
    sincronizadaRef.current = clave;
    void sincronizarConFicha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, fichaId, data.fichaTecnicaId]);

  const abrirFichaTecnica = async () => {
    if (onAbrirFichaTecnica) {
      onAbrirFichaTecnica();
      return;
    }
    const id = data.fichaTecnicaId;
    if (!id) return;
    if (!data.fichaTecnicaBase) {
      try {
        fotoAntesRef.current = { id, foto: fotoFicha(await cargarPatchDesdeFichaTecnica(id)) };
      } catch {
        fotoAntesRef.current = null;
      }
    }
    setFichaTecnicaAbierta(true);
  };
  const cerrarFichaTecnica = () => {
    setFichaTecnicaAbierta(false);
    void sincronizarConFicha();
  };

  const corregirOrtografia = (campos: CampoOrtografia[]) => {
    if (!campos.length) return;
    onChange(parcheOrtografia(campos));
  };

  /** Retícula de la etiqueta 30 mL, calculada de las medidas del formato. */
  const reticula30 = useMemo(() => reticula30ml(tipo?.ancho_mm, tipo?.alto_mm), [tipo?.ancho_mm, tipo?.alto_mm]);
  const retSimple = useMemo(() => reticulaSimple(tipo?.ancho_mm, tipo?.alto_mm), [tipo?.ancho_mm, tipo?.alto_mm]);
  const ret5ml = useMemo(() => reticula5ml(tipo?.ancho_mm, tipo?.alto_mm), [tipo?.ancho_mm, tipo?.alto_mm]);
  const retCircular = useMemo(() => reticulaCircular(tipo?.ancho_mm, tipo?.alto_mm), [tipo?.ancho_mm, tipo?.alto_mm]);
  const retVertical = useMemo(() => reticulaVertical(tipo?.ancho_mm, tipo?.alto_mm), [tipo?.ancho_mm, tipo?.alto_mm]);
  const clasificacionContradice =
    esPeligrosoGhs(data.ghs) && /no\s+est[aá]\s+clasificad/i.test(data.clasificacionTexto || "");
  const restablecerDatos = () => {
    const digitos = (data.barcode || "").replace(/\D/g, "");
    const codigo = esPlantillaEnEdicion
      ? undefined
      : (codigosEan ?? []).find((c) => (c.codigo || "").replace(/\D/g, "").slice(0, 13) === digitos);
    setData((d) => ({ ...sinDatosDeProducto(d), barcode: esPlantillaEnEdicion ? "" : d.barcode }));
    setEnlace(null);
    if (codigo) void onElegirCodigo(codigo, true);
  };

  const generarLoteCategoria = async () => {
    if (loteSeleccion.length === 0 || guardando) return;
    setGuardando(true);
    setLoteResultado([]);
    setLoteProgreso({ hechos: 0, total: loteSeleccion.length });
    const datosBase = data;
    const nombreBase = nombreFicha;
    const estabaEditando = editMode;
    const hechos: string[] = [];
    const sinFicha: string[] = [];
    try {
      if (estabaEditando) {
        setEditMode(false);
        await esperarRepintado();
      }
      const { subirImagenBlobAEtiquetas } = await import("../../lib/plantillasVisualesExport");
      const fichasTecnicas = await listarFichasTecnicas();
      for (const [i, codigo] of loteSeleccion.entries()) {
        const titulo = (codigo.nombre_producto || codigo.sku || "").trim();
        const neto = contenidoNetoDesdeCodigo(codigo);
        const mejor = mejorFichaParaTitulo(fichasTecnicas, titulo);
        const patch =
          mejor && mejor.puntaje >= UMBRAL_ENLACE_AUTOMATICO
            ? await cargarPatchDesdeFichaTecnica(mejor.ficha.id).catch(() => null)
            : null;
        // Sin ficha técnica no se genera: saldría una etiqueta en blanco para
        // imprimir. Se reporta al final para hacerla a mano.
        if (!patch || !mejor) {
          sinFicha.push(titulo || codigo.sku || "(sin nombre)");
          setLoteProgreso({ hechos: i + 1, total: loteSeleccion.length });
          continue;
        }
        // El diseño es el de la plantilla; los datos de producto, solo los de
        // este SKU y su ficha técnica (nunca los que traiga la plantilla).
        const datosSku: ProductLabelData = {
          ...sinDatosDeProducto(datosBase),
          ...patch,
          barcode: (codigo.codigo || "").replace(/\D/g, "").slice(0, 13),
          barcodeTitle: titulo,
          fichaTecnicaId: mejor.ficha.id,
          fichaTecnicaTitulo: mejor.ficha.titulo,
          fichaTecnicaBase: fotoFicha(patch),
          ...(neto ? { netContent: neto } : {}),
          // Conservación de la familia, igual que en `onChange`, con «envase» o «empaque»
          // según la receta del combo de este código.
          ...(datosBase.storageSugerido
            ? { storage: palabraRecipiente(datosBase.storageSugerido, recipientePara(recipientes, codigo.codigo)) }
            : {}),
        };
        setData(datosSku);
        // La etiqueta del SKU también se GUARDA (no solo su PNG): queda enlazada
        // a su plantilla, su código de barras y su ficha técnica, y se puede
        // abrir después para corregirla. Si ya existía una con el mismo nombre
        // en esta categoría y formato, se actualiza en vez de duplicarla.
        if (titulo) {
          const previa = (fichasTodas ?? []).find(
            (f) =>
              !f.es_plantilla_categoria &&
              f.categoria === categoria &&
              (f.tipo_nombre || "") === (tipoNombre || "") &&
              f.nombre.trim().toLowerCase() === titulo.toLowerCase(),
          );
          await guardarFichaMutation
            .mutateAsync({
              ...(previa ? { id: previa.id } : {}),
              nombre: titulo,
              data: datosSku,
              tipo_nombre: tipoNombre || undefined,
              categoria: categoria || undefined,
              plantilla_id: fichaId || undefined,
              attribute_icons: attributeIcons,
              text_styles: estilos,
            })
            .catch(() => undefined); // el PNG sale igual; la ficha se puede guardar a mano
        }
        await esperarRepintado();
        await esperarRepintado();
        const { blob, anchoMm, altoMm, ratio } = await rasterizarFichaActual();
        const nombreArchivo = `${nombreArchivoDesdeTitulo(titulo) || codigo.sku || "etiqueta"}.png`;
        await subirImagenBlobAEtiquetas(blob, nombreArchivo, {
          carpeta: `ETIQUETAS STUDIO/${nombreCategoria(categoria)}`,
          tipo_etiqueta: tipo?.nombre,
          ancho_mm: anchoMm,
          alto_mm: altoMm,
          dpi: anchoMm ? dpiDeEscala(anchoMm, anchoDiseno, ratio) : undefined,
          escala: ratio,
        });
        hechos.push(nombreArchivo);
        setLoteProgreso({ hechos: i + 1, total: loteSeleccion.length });
      }
      setLoteResultado(hechos);
      setGuardarMsg({
        ok: sinFicha.length === 0,
        texto:
          `${hechos.length} etiqueta(s) generadas en ETIQUETAS STUDIO/${nombreCategoria(categoria)}.`
          + (sinFicha.length > 0
            ? ` Sin ficha técnica, no se generaron (hazlas a mano): ${sinFicha.join(", ")}.`
            : ""),
      });
    } catch (e) {
      setGuardarMsg({
        ok: false,
        texto: `${hechos.length} de ${loteSeleccion.length} generadas. ${e instanceof Error ? e.message : "Error en el lote"}`,
      });
    } finally {
      // Se restaura la plantilla tal como estaba: el lote no la modifica.
      setData(datosBase);
      setNombreFicha(nombreBase);
      if (estabaEditando) setEditMode(true);
      setLoteProgreso(null);
      setGuardando(false);
    }
  };

  /** Nombre del archivo: título del código de barras elegido (catálogo
   *  EAN); sin código, nombre de la ficha guardada o del producto. */
  const nombreArchivoPng = () =>
    `${nombreArchivoDesdeTitulo(data.barcodeTitle || nombreFicha || data.productName) || "ficha"}.png`;

  /** «Aprobar»: sube a la vez el PNG de impresión (Diseño → Imprimir) y, con
   *  Desenfoque, el digital (PUBLICACIONES DIGITALES). Cada uno informa su
   *  resultado: si falla uno, el otro queda guardado igual. */
  const confirmarGuardarPng = async () => {
    if (!previa || guardando) return;
    if (desenfoqueActivo && digital?.estado !== "listo") return;
    setGuardando(true);
    try {
      const { subirImagenBlobAEtiquetas } = await import("../../lib/plantillasVisualesExport");
      const formato = {
        tipo_etiqueta: tipo?.nombre,
        ancho_mm: previa.anchoMm,
        alto_mm: previa.altoMm,
        dpi: previa.dpi,
        escala: previa.pixelRatio,
      };
      const [imp, dig] = await Promise.allSettled([
        subirImagenBlobAEtiquetas(previa.blob, nombreArchivoPng(), {
          // Subcarpeta por categoría: así la etiqueta aparece dentro de su
          // categoría en Studio y no se mezcla con el catálogo viejo de la raíz.
          carpeta: `ETIQUETAS STUDIO/${nombreCategoria(categoria)}`,
          ...formato,
        }),
        desenfoqueActivo && digital?.blob
          ? subirImagenBlobAEtiquetas(digital.blob, nombreArchivoPngDigital(), {
              carpeta: carpetaPublicacionesDigitales(),
              ...formato,
            })
          : Promise.resolve(null),
      ]);
      const partes: string[] = [];
      let ok = true;
      if (imp.status === "fulfilled") {
        partes.push(
          tipo
            ? `Impresión: ${imp.value.nombre} (${tipo.nombre}, ${previa.dpi} dpi) en Diseño → Imprimir.`
            : `Impresión: ${imp.value.nombre} en Diseño → Imprimir.`,
        );
      } else {
        ok = false;
        partes.push(`No se guardó el PNG de impresión: ${imp.reason instanceof Error ? imp.reason.message : "error"}.`);
      }
      if (dig.status === "fulfilled" && dig.value) {
        partes.push(`Digital: ${dig.value.nombre} en ${carpetaPublicacionesDigitales()}.`);
      } else if (dig.status === "rejected") {
        ok = false;
        partes.push(`No se guardó el PNG desenfocado: ${dig.reason instanceof Error ? dig.reason.message : "error"}.`);
      }
      setGuardarMsg({ ok, texto: partes.join(" ") });
      if (ok) cerrarPrevia();
    } finally {
      setGuardando(false);
    }
  };

  const descargarPrevia = async () => {
    if (!previa) return;
    const { descargarBlob } = await import("../../lib/etiquetaAssets");
    descargarBlob(previa.blob, nombreArchivoPng());
  };

  /** Versión desenfocada: mismo nombre que el PNG de impresión con sufijo
   *  "_digital" (los nombres son únicos en toda la biblioteca). */
  const nombreArchivoPngDigital = () => `${nombreArchivoPng().replace(/\.png$/i, "")}_digital.png`;
  const carpetaPublicacionesDigitales = () =>
    `${CARPETA_PUBLICACIONES_DIGITALES}/${nombreCategoria(categoria)}`;

  const ficha = (
    <div
      ref={fichaRef}
      lang="es"
      className={`relative overflow-hidden rounded-[6px] border border-[#111111]/10 bg-white mck-paper-white text-[#111111] shadow-none${
        altoMarcoFicha ? " flex flex-col" : ""
      }`}
      style={{ width: anchoDiseno, minHeight: altoMarcoFicha, ...variablesAcento(data.accentColor) }}
    >
      {showGrid && <div className="pointer-events-none absolute inset-0" style={PATRON_RETICULA} />}

      {/* `flex-1` y no `h-full`: el lienzo solo tiene alto MÍNIMO, y contra eso
          un porcentaje no se resuelve — las filas nunca llegaban a repartirse
          el sobrante y quedaba blanco bajo el pie. */}
      <div className={altoMarcoFicha ? "relative flex flex-1 flex-col" : "relative"}>
        {/* 1-2. Cabecera */}
        <ProductHeader
          data={data}
          onChange={onChange}
          editMode={editMode}
        />

        {/* 4. Cuerpo principal + 7. columna derecha */}
        <div
          className={`${RETICULA_MAESTRA} border-t-[1.5px] border-[color:var(--acento)]${
            altoMarcoFicha ? " min-h-0 flex-1" : ""
          }`}
          style={{ gridTemplateRows: altoMarcoFicha ? FILAS_CUERPO_REPARTIDAS : FILAS_CUERPO }}
        >
          <ProductAttributeGrid
            data={data}
            onChange={onChange}
            editMode={editMode}
            attributeIcons={attributeIcons}
            onIconChange={onIconChange}
          />

          {/* pl 13px + borde 3px = pr 16px: el contenido queda centrado en
              el eje de la columna de la retícula (con px-4 simétrico el
              borde lo corría 1.5px). La columna hereda las 3 filas de los
              atributos (subgrid): GHS + información técnica se centran en
              vertical en las filas 1-2, y el cuadro Pureza/CAS + cuchara en
              la fila 3 (Grado / Conservación). */}
          <div
            className="grid border-l-[3px] border-[color:var(--acento)] pl-[13px] pr-4"
            style={{ gridRow: "span 3", gridTemplateRows: "subgrid" }}
          >
            <div className="row-span-2 flex flex-col items-center justify-center gap-[14px] py-4">
              <GhsBadge
                value={data.ghs}
                onChange={(v) => onChange({ ghs: v })}
                iconSvg={data.ghsIconSvg}
                onIconChange={(svg) => onChange({ ghsIconSvg: svg })}
                desplazamiento={data.ghsDesplazamiento ?? 0}
                onDesplazamientoChange={(v) => onChange({ ghsDesplazamiento: v })}
                editMode={editMode}
              />
              <TechnicalDocuments
                technicalDocuments={data.technicalDocuments}
                website={data.website}
                onTechnicalDocumentsChange={(v) => onChange({ technicalDocuments: v })}
                onWebsiteChange={(v) => onChange({ website: v })}
                editMode={editMode}
              />
            </div>
            <div className="flex flex-col items-center justify-center gap-[14px] py-4">
              <TechnicalIdentity
                concentration={data.concentration}
                cas={data.cas}
                onConcentrationChange={(v) => onChange({ concentration: v })}
                onCasChange={(v) => onChange({ cas: v })}
                casTitulo={data.casTitulo}
                onCasTituloChange={(v) => onChange({ casTitulo: v })}
                editMode={editMode}
              />
              <CucharaMedidora
                cantidad={data.cucharaCantidad ?? ""}
                unidad={data.cucharaUnidad || UNIDADES_CUCHARA[0]}
                titulo={data.cucharaUtensilio}
                onCantidadChange={(v) => onChange({ cucharaCantidad: v })}
                onUnidadChange={(v) => onChange({ cucharaUnidad: v })}
                onTituloChange={(v) => onChange({ cucharaUtensilio: v })}
                editMode={editMode}
              />
            </div>
          </div>
        </div>

        {/* 8. Contenido neto + código de barras — misma retícula de 3
            columnas: Contenido Neto en col. 1 (su borde derecho coincide
            con la división Origen/Apariencia), col. 2 vacía sin borde,
            código de barras en col. 3 — así columnas 2+3 se ven como una
            sola zona sin partir el código a la mitad. Sin mx-6: el ancho
            debe ser el mismo que el del cuerpo de arriba para que las
            divisiones coincidan (ver retícula maestra). */}
        <div className={`${RETICULA_MAESTRA} my-2.5 overflow-hidden rounded-[4px] border-[1.5px] border-[color:var(--acento)] bg-white`}>
          <NetContent value={data.netContent} onChange={(v) => onChange({ netContent: v })} editMode={editMode} />
          <div aria-hidden="true" />
          <BarcodeBlock
            value={data.barcode}
            onChange={(v) => onChange({ barcode: v })}
            onElegirCodigo={(c) => void onElegirCodigo(c)}
            editMode={editMode}
            franja={{ alto: ALTO_FRANJA_FICHA }}
          />
        </div>

        {/* 9. Pie de página */}
        <ContactFooter
          city={data.city}
          phone={data.phone}
          email={data.email}
          onCityChange={(v) => onChange({ city: v })}
          onPhoneChange={(v) => onChange({ phone: v })}
          onEmailChange={(v) => onChange({ email: v })}
          editMode={editMode}
        />
      </div>
    </div>
  );

  // Nueva plantilla de una categoría: solo falta el tamaño.
  if (etapa === "inicio" && entrada?.nuevaPlantillaCategoria) {
    return (
      <ElegirTamanoPlantilla
        categoriaId={entrada.nuevaPlantillaCategoria}
        categoriaLabel={nombreCategoria(entrada.nuevaPlantillaCategoria)}
        tipos={tipos}
        tiposLoading={tiposLoading}
        yaUsados={(fichasTodas ?? [])
          .filter(
            (f) =>
              f.es_plantilla_categoria && f.categoria === entrada.nuevaPlantillaCategoria,
          )
          .map((f) => f.tipo_nombre || "")}
        plantillasBase={(fichasTodas ?? []).filter((f) => f.es_plantilla_categoria)}
        etiquetaDeCategoria={etiquetaCategoria}
        onVolver={onVolver}
        onElegir={(tamano, baseId) =>
          crearPlantillaDeCategoria(entrada.nuevaPlantillaCategoria!, tamano, baseId)
        }
      />
    );
  }

  // Nueva etiqueta de producto: la plantilla ya está elegida, falta el SKU.
  if (etapa === "inicio" && plantillaDeEntrada) {
    return (
      <ElegirProductoParaEtiqueta
        plantilla={plantillaDeEntrada}
        categoriaLabel={nombreCategoria(plantillaDeEntrada.categoria || "")}
        onVolver={onVolver}
        onElegir={(codigo) => void crearEtiquetaDesdePlantilla(plantillaDeEntrada, codigo)}
      />
    );
  }

  if (etapa === "inicio") {
    return (
      <PantallaInicio
        onVolver={onVolver}
        tipos={tipos}
        tiposLoading={tiposLoading}
        fichasGuardadas={fichasGuardadas ?? []}
        plantillasGuardadas={plantillasGuardadas}
        tienePlantillaBase={Boolean(plantillaBase)}
        categoriasConPlantilla={plantillasPorCategoria}
        skuInicial={entrada?.sku ?? null}
        onCrear={(tipoNom, codigo, cat) => void crearFichaDesdeSku(tipoNom, codigo, cat)}
        onAbrir={abrirFichaGuardada}
        onDuplicar={duplicarFichaGuardada}
        onEliminar={eliminarFichaGuardada}
      />
    );
  }

  // ── Maqueta del editor: el lienzo es lo protagonista ─────────────────────
  // Tres franjas: una barra de herramientas de UNA línea (lo que se usa en
  // cada etiqueta), la mesa de trabajo, que se queda con todo el alto y ancho
  // restante y agranda la etiqueta hasta llenarlo, y una barra de estado con
  // los datos y los avisos en fichas que se despliegan. Lo ocasional (plantilla,
  // restablecer, retícula, desenfoque, SVG…) vive en el menú «Más».
  const formatoCorto = tipo ? etiquetaTamanoFormato(tipo.nombre, tipo.ancho_mm, tipo.alto_mm) : "tamaño libre";
  const descripcionFormato = es30ml
    ? "Los tres paneles del 30 mL. En edición, lo gris es un ejemplo de referencia y no se imprime."
    : es5ml
      ? "Los tres paneles del 30 mL en dos filas: matriz técnica de 2×2, marca con el nombre y el contenido neto, y pictograma GHS + Pureza/CAS sobre el código de barras."
      : esSimple
        ? "Diagramación simple de dos columnas. En edición, lo gris es un ejemplo de referencia y no se imprime."
        : esVertical
          ? "Etiqueta vertical de siete bloques: cabecera, dos filas de casillas, beneficios, contenido neto, marca con el código de barras y pie de contacto."
          : esCircular
            ? "Etiqueta redonda: el nombre y los datos del borde van sobre arcos (se editan con un clic) y el bloque central se apila dentro del círculo."
            : marco
              ? "El marco punteado es el tamaño real de la etiqueta; lo que quede fuera de foco no cabe a ese tamaño."
              : "Sin Formato: se ve a su tamaño de diseño. Elige un Formato para imprimir a tamaño real.";
  const mensaje = discrepancia ? null : (guardarMsg ?? plantillaMsg ?? (enlace ? { ok: enlace.tipo !== "error", texto: enlace.texto } : null));
  const itemMenu =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-surface-hover disabled:opacity-40";

  let lienzo: ReactNode;
  if (es30ml) {
    lienzo = (
      <Marco30ml reticula={reticula30}>
        <LabelPreview
          ref={fichaRef}
          data={data}
          reticula={reticula30}
          editMode={editMode}
          attributeIcons={attributeIcons}
          guias={showGrid && editMode}
          onChange={onChange}
          onIconChange={onIconChange}
          onElegirCodigo={(c) => void onElegirCodigo(c)}
        />
      </Marco30ml>
    );
  } else if (es5ml) {
    lienzo = (
      <Marco30ml reticula={ret5ml}>
        <Etiqueta5ml
          ref={fichaRef}
          data={data}
          reticula={ret5ml}
          editMode={editMode}
          guias={showGrid && editMode}
          onChange={onChange}
          onElegirCodigo={(c) => void onElegirCodigo(c)}
          attributeIcons={attributeIcons}
          onIconChange={onIconChange}
        />
      </Marco30ml>
    );
  } else if (esSimple) {
    lienzo = (
      <Marco30ml reticula={retSimple}>
        <EtiquetaSimple
          ref={fichaRef}
          data={data}
          reticula={retSimple}
          editMode={editMode}
          guias={showGrid && editMode}
          onChange={onChange}
          onElegirCodigo={(c) => void onElegirCodigo(c)}
          attributeIcons={attributeIcons}
          onIconChange={onIconChange}
        />
      </Marco30ml>
    );
  } else if (esVertical) {
    lienzo = (
      <Marco30ml reticula={retVertical}>
        <EtiquetaVertical
          ref={fichaRef}
          data={data}
          reticula={retVertical}
          editMode={editMode}
          guias={showGrid && editMode}
          onChange={onChange}
          onElegirCodigo={(c) => void onElegirCodigo(c)}
          attributeIcons={attributeIcons}
          onIconChange={onIconChange}
        />
      </Marco30ml>
    );
  } else if (esCircular) {
    lienzo = (
      <Marco30ml reticula={{ ancho: retCircular.diametro, alto: retCircular.diametro }}>
        <EtiquetaCircular
          ref={fichaRef}
          data={data}
          reticula={retCircular}
          editMode={editMode}
          guias={showGrid && editMode}
          onChange={onChange}
          onElegirCodigo={(c) => void onElegirCodigo(c)}
        />
      </Marco30ml>
    );
  } else if (marco) {
    lienzo = (
      <div
        ref={ajusteFicha.ref}
        className={`flex h-full w-full items-center justify-center ${ajusteFicha.escala <= ESCALA_MINIMA ? "overflow-auto" : "overflow-hidden"}`}
      >
        {/* Caja del tamaño YA escalado: un `transform` no cambia el hueco
            que el elemento reserva en la maqueta. */}
        <div
          className="shrink-0 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          style={{ width: marco.ancho * ajusteFicha.escala, height: marco.alto * ajusteFicha.escala }}
        >
          <div
            className="relative overflow-hidden border-2 border-dashed border-[color:var(--acento-60)] bg-[#f4f4f2]"
            style={{
              width: marco.ancho,
              height: marco.alto,
              transform: `scale(${ajusteFicha.escala})`,
              transformOrigin: "top left",
            }}
          >
            {/* Centrada: solo se nota con el ancho ya en el tope y la ficha
                escalada por alto, que si no dejaba todo el hueco a la derecha. */}
            <div
              className="absolute top-0"
              style={{
                left: Math.max(0, (marco.ancho - anchoLayout * marco.escala) / 2),
                width: anchoLayout,
                transform: `scale(${marco.escala})`,
                transformOrigin: "top left",
              }}
            >
              {ficha}
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    lienzo = <div className="flex min-h-full w-full items-start justify-center overflow-auto p-6">{ficha}</div>;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3"
      style={variablesAcento(data.accentColor)}
    >
      {/* ── Barra de herramientas: una sola línea ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onVolver}
          title="Volver"
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-hover"
        >
          ← Volver
        </button>
        <input
          type="text"
          value={nombreFicha}
          onChange={(e) => setNombreFicha(e.target.value)}
          placeholder="Nombre de esta etiqueta…"
          title="Nombre de esta etiqueta (para guardarla)"
          className="w-48 min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-bold text-ink placeholder:font-normal placeholder:text-muted hover:border-border focus:border-accent/60 sm:w-64"
        />
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            autoguardado.estado === "error"
              ? "bg-red-500"
              : autoguardado.estado === "ok"
                ? "bg-emerald-500"
                : autoguardado.estado === "idle"
                  ? "bg-border"
                  : "animate-pulse bg-amber-400"
          }`}
          title={
            autoguardado.estado === "pendiente"
              ? "Sin guardar…"
              : autoguardado.estado === "guardando"
                ? "Guardando…"
                : autoguardado.estado === "ok"
                  ? "Guardado"
                  : autoguardado.estado === "error"
                    ? `No se guardó: ${autoguardado.texto}`
                    : "Se guarda sola al cambiar algo"
          }
        />
        {autoguardado.estado === "error" && <span className="text-[11px] text-red-600">No se guardó</span>}

        <select
          value={tipoNombre}
          onChange={(e) => setTipoNombre(e.target.value)}
          disabled={tiposLoading}
          title="Formato (tamaño de la etiqueta)"
          className="max-w-[13rem] rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink disabled:opacity-50"
        >
          <option value="">{tiposLoading ? "Cargando…" : "Sin ajustar (tamaño libre)"}</option>
          {tipos.map((t) => (
            <option key={t.nombre} value={t.nombre}>
              {etiquetaTamanoFormato(t.nombre, t.ancho_mm, t.alto_mm)}
            </option>
          ))}
        </select>
        {/* Diámetro de impresión (§14): solo la redonda. Cambia el tamaño
            FÍSICO del PNG, del SVG y de la impresión; el diseño no se mueve. */}
        {esCircular && (
          <label
            className="flex items-center gap-1 text-xs text-muted"
            title="Diámetro final impreso. El diseño no cambia: cambia a cuántos milímetros se exporta e imprime."
          >
            ⌀
            <input
              type="number"
              min={20}
              max={200}
              step={1}
              value={diametroMm ?? tipo?.ancho_mm ?? 53}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDiametroMm(Number.isFinite(n) && n >= 20 && n <= 200 ? n : null);
              }}
              className="w-14 rounded-lg border border-border bg-surface px-1.5 py-1 text-xs text-ink"
            />
            mm
            {diametroMm !== null && diametroMm !== tipo?.ancho_mm && (
              <button
                type="button"
                onClick={() => setDiametroMm(null)}
                title={`Volver al diámetro del Formato (${tipo?.ancho_mm ?? 53} mm)`}
                className="rounded border border-border px-1.5 py-0.5 font-semibold text-ink hover:bg-surface-hover"
              >
                ↺
              </button>
            )}
          </label>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void abrirFichaTecnica()}
            disabled={!onAbrirFichaTecnica && !data.fichaTecnicaId}
            title={
              data.fichaTecnicaId
                ? `Corregir la ficha técnica «${data.fichaTecnicaTitulo || data.fichaTecnicaId}» de donde salen los datos de la etiqueta`
                : "Esta etiqueta no tiene ficha técnica enlazada (usa la lupa junto al nombre)"
            }
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-hover disabled:opacity-40"
          >
            Ficha técnica
          </button>
          {/* Editar / Vista como interruptor de dos posiciones. */}
          <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold" role="group" aria-label="Modo">
            <button
              type="button"
              onClick={() => setEditMode(true)}
              aria-pressed={editMode}
              className={`rounded-md px-2.5 py-1 ${editMode ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => setEditMode(false)}
              aria-pressed={!editMode}
              className={`rounded-md px-2.5 py-1 ${!editMode ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
            >
              Vista
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuMas((v) => !v)}
              aria-expanded={menuMas}
              className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-hover"
            >
              Más ▾
            </button>
            {menuMas && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuMas(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl">
                  <label className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-muted">
                    Categoría
                    <select
                      value={categoria}
                      onChange={(e) => setCategoria(e.target.value)}
                      title="Categoría de producto: decide de qué plantilla parten las fichas nuevas"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink"
                    >
                      {CATEGORIAS_ETIQUETA.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.etiqueta}
                          {plantillasPorCategoria.has(c.id) ? " ✓" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={itemMenu}>
                    <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="h-3.5 w-3.5" />
                    Retícula
                  </label>
                  <label
                    className={itemMenu}
                    title={`Al terminar se genera también la versión con la marca desenfocada (automático), en ${CARPETA_PUBLICACIONES_DIGITALES}.`}
                  >
                    <input
                      type="checkbox"
                      checked={desenfoqueActivo}
                      onChange={(e) => setDesenfoqueActivo(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    Desenfoque (PNG digital)
                  </label>
                  <div className="my-1 border-t border-border" />
                  {esPlantillaDeCategoria ? (
                    <button
                      type="button"
                      className={itemMenu}
                      disabled={guardando}
                      onClick={() => {
                        setMenuMas(false);
                        setLoteAbierto(true);
                      }}
                    >
                      Generar etiquetas de la categoría…
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={itemMenu}
                      disabled={!fichaId || guardarFichaMutation.isPending}
                      onClick={() => {
                        setMenuMas(false);
                        marcarComoPlantilla();
                      }}
                      title="Este formato pasa a ser la plantilla de su categoría"
                    >
                      Usar como plantilla de «{nombreCategoria(categoria)}»
                    </button>
                  )}
                  {esPlantillaEnEdicion ? (
                    confirmarLimpiar ? (
                      <div className="rounded-md bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-950/30 dark:text-red-200">
                        ¿Borrar nombre, composición, CAS, código y demás datos de producto? El diseño se conserva.
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              limpiarPlantilla();
                              setMenuMas(false);
                            }}
                            className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-700"
                          >
                            Sí, limpiar
                          </button>
                          <button type="button" onClick={() => setConfirmarLimpiar(false)} className="rounded border border-red-300 px-2 py-0.5 font-semibold">
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={itemMenu}
                        onClick={() => setConfirmarLimpiar(true)}
                        disabled={!plantillaConDatos}
                        title="Quita los datos del producto con que se armó la plantilla y deja solo el diseño"
                      >
                        {plantillaConDatos ? "Limpiar plantilla…" : "✓ Plantilla limpia"}
                      </button>
                    )
                  ) : confirmarRestablecer ? (
                    <div className="rounded-md bg-red-50 p-2 text-[11px] text-red-800 dark:bg-red-950/30 dark:text-red-200">
                      ¿Borrar lo escrito a mano y volver a cargar los datos del SKU y su ficha técnica? El diseño se conserva.
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            restablecerDatos();
                            setConfirmarRestablecer(false);
                            setMenuMas(false);
                          }}
                          className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-700"
                        >
                          Sí, restablecer
                        </button>
                        <button type="button" onClick={() => setConfirmarRestablecer(false)} className="rounded border border-red-300 px-2 py-0.5 font-semibold">
                          No
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={itemMenu}
                      onClick={() => setConfirmarRestablecer(true)}
                      title="Vuelve a cargar los datos del SKU y su ficha técnica"
                    >
                      Restablecer datos…
                    </button>
                  )}
                  {esCircular && (
                    <button
                      type="button"
                      className={itemMenu}
                      onClick={() => {
                        setMenuMas(false);
                        void exportarSvg();
                      }}
                      disabled={exportandoSvg || guardando}
                      title="Descarga la etiqueta como SVG vectorial, con sus milímetros, para la imprenta"
                    >
                      {exportandoSvg ? "Exportando…" : "Exportar SVG"}
                    </button>
                  )}
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    className={itemMenu}
                    onClick={() => {
                      setMenuMas(false);
                      nuevaFicha();
                    }}
                    title="Volver a la lista de etiquetas guardadas"
                  >
                    ← Lista de etiquetas guardadas
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => void generarPng()}
            disabled={guardando}
            title={
              desenfoqueActivo
                ? "Genera el PNG para imprimir (≥ 600 dpi si hay Formato) y a la vez el PNG con la marca desenfocada. Revisas las dos vistas previas y, al aprobar, cada uno se guarda en su carpeta"
                : "Genera el PNG para imprimir (≥ 600 dpi si hay Formato), lo revisas en vista previa y, al aprobar, se guarda en Diseño → Imprimir"
            }
            className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {guardando && !previa ? "Generando…" : desenfoqueActivo ? "Terminar y aprobar los PNG" : "Terminar y aprobar el PNG"}
          </button>
        </div>
      </header>

      {/* Lo único que puede ocupar una franja propia: una etiqueta con el código
          de un producto y los datos de otro no se debe imprimir sin mirarla. */}
      {discrepancia && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-[12px] text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
        >
          <span className="font-semibold">
            ⚠ El código de barras es de «{data.barcodeTitle}», pero{" "}
            {discrepancia.origen === "ficha"
              ? `la ficha técnica enlazada es «${discrepancia.contra}»`
              : `el nombre en la etiqueta es «${discrepancia.contra}»`}
            .
          </span>
          <span>Usa la lupa junto al nombre para elegir la ficha técnica correcta.</span>
          {confirmarDiscrepancia && (
            <span className="flex items-center gap-1.5">
              <b>¿Generar así de todos modos?</b>
              <button
                type="button"
                onClick={() => void generarPng(true)}
                disabled={guardando}
                className="rounded-md bg-red-600 px-2.5 py-0.5 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Sí, generar igual
              </button>
              <button
                type="button"
                onClick={() => setConfirmarDiscrepancia(false)}
                className="rounded-md border border-red-300 bg-white px-2.5 py-0.5 font-semibold text-red-700 hover:bg-red-100 dark:bg-transparent"
              >
                Cancelar
              </button>
            </span>
          )}
        </div>
      )}

      {/* ── Mesa de trabajo: todo el espacio que queda ── */}
      <div
        className="relative min-h-[55dvh] flex-1 overflow-hidden rounded-xl border border-border bg-[#e7e7e3] dark:bg-[#1c1f22] lg:min-h-0"
        style={{
          backgroundImage: "radial-gradient(rgba(0,0,0,0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="absolute inset-0">{lienzo}</div>

        {/* Detalle de ortografía: se abre sobre la mesa, sin empujar el lienzo. */}
        {detalleOrto && ortografia.length > 0 && (
          <div className="absolute inset-x-3 bottom-3 z-10 max-h-[45%] overflow-auto rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 shadow-lg dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-semibold">Ortografía — tildes, espacios y palabras repetidas</span>
              <button
                type="button"
                onClick={() => corregirOrtografia(ortografia)}
                className="rounded bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-700"
              >
                Corregir todo
              </button>
              <button type="button" onClick={() => setDetalleOrto(false)} className="ml-auto px-1 font-semibold" aria-label="Cerrar">
                ✕
              </button>
            </div>
            <ul className="space-y-1">
              {ortografia.map((c) => (
                <li key={c.campo as string} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{c.titulo}:</span>
                  {c.hallazgos.map((h, i) => (
                    <span key={i} className="rounded bg-white/70 px-1 dark:bg-black/20">
                      <s className="opacity-60">{h.original}</s> → <b>{h.sugerencia}</b>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => corregirOrtografia([c])}
                    className="rounded border border-amber-400 px-1.5 py-0.5 font-semibold text-amber-800 hover:bg-amber-100 dark:text-amber-100"
                  >
                    Corregir
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Barra de estado ── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
        <span title={descripcionFormato}>
          <span className="font-semibold text-ink">{formatoCorto}</span>
          {esCircular && diametroMm !== null && diametroMm !== tipo?.ancho_mm && ` · se imprime a ⌀ ${diametroMm} mm`}
        </span>
        {(data.barcodeTitle || data.fichaTecnicaTitulo) && (
          <span className="min-w-0 truncate">
            Código: <span className="text-ink">{data.barcodeTitle || "—"}</span> · Ficha técnica:{" "}
            <span className="text-ink">{data.fichaTecnicaTitulo || "sin enlazar"}</span>
          </span>
        )}
        {nombreCategoria(categoria) && <span>{nombreCategoria(categoria)}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {es30ml && clasificacionContradice && (
            <span
              role="alert"
              className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-200"
              title={`El producto tiene pictograma de peligro (${data.ghs}), pero la clasificación dice que no está clasificado como peligroso. Corrige el texto antes de imprimir.`}
            >
              ⚠ GHS contradice la clasificación
            </span>
          )}
          {ortografia.length > 0 && (
            <button
              type="button"
              onClick={() => setDetalleOrto((v) => !v)}
              className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-200"
            >
              ⚠ Ortografía: {ortografia.length}
            </button>
          )}
          {mensaje && (
            <span className={`max-w-[42rem] truncate ${mensaje.ok ? "text-accent" : "text-red-600"}`} title={mensaje.texto}>
              {mensaje.ok ? "✓ " : "✗ "}
              {mensaje.texto}
            </span>
          )}
        </span>
      </footer>

      {fichaTecnicaAbierta &&
        data.fichaTecnicaId &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[640] flex items-center justify-center bg-black/45 p-2 sm:p-3" role="dialog" aria-modal="true" aria-label="Ficha técnica">
            <div className="flex h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl">
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Ficha técnica · {data.fichaTecnicaTitulo || data.fichaTecnicaId}
                  </p>
                  <p className="text-[12px] text-ink">
                    Corrige el dato aquí, en su origen. Al cerrar, la etiqueta toma solo lo que cambiaste.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cerrarFichaTecnica}
                  className="shrink-0 rounded-md border border-border px-3 py-1 text-[12px] font-semibold text-ink hover:bg-surface-hover"
                >
                  Cerrar · volver a la etiqueta
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-3">
                <Suspense fallback={<p className="p-6 text-sm text-muted">Abriendo la ficha técnica…</p>}>
                  <FichasTecnicasPanel
                    archivoInicial={data.fichaTecnicaId}
                    onVolver={cerrarFichaTecnica}
                  />
                </Suspense>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {previa &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[650] flex items-center justify-center bg-ink/60 p-3 backdrop-blur-sm"
            onClick={cerrarPrevia}
          >
            <div
              className={`flex max-h-[94vh] w-full ${desenfoqueActivo ? "max-w-6xl" : "max-w-4xl"} flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-bold text-ink">
                    {desenfoqueActivo ? "Revisa y aprueba los dos PNG" : "Revisa y aprueba el PNG para imprimir"}
                  </h3>
                  <p className="text-[11px] text-muted">
                    {previa.anchoPx} × {previa.altoPx} px
                    {previa.anchoMm && previa.altoMm
                      ? ` · ${previa.anchoMm} × ${previa.altoMm} mm a ${previa.dpi} dpi`
                      : " · tamaño libre (sin Formato elegido)"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cerrarPrevia}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>
              {/* Fondo gris neutro: deja ver el borde real de la etiqueta blanca. */}
              <div className={`grid min-h-0 flex-1 gap-3 overflow-auto bg-[#e9e9e6] p-4 ${desenfoqueActivo ? "md:grid-cols-2" : ""}`}>
                <figure className="flex min-h-0 flex-col items-center gap-2">
                  <figcaption className="text-center text-[11px] text-ink">
                    <span className="font-bold">Para imprimir</span> · {nombreArchivoPng()}
                    <span className="block text-muted">→ ETIQUETAS STUDIO/{nombreCategoria(categoria)} (Diseño → Imprimir)</span>
                  </figcaption>
                  <img
                    src={previa.url}
                    alt="Vista previa de la etiqueta para imprimir"
                    className={`${desenfoqueActivo ? "max-h-[58vh]" : "max-h-[70vh]"} max-w-full object-contain shadow-lg`}
                    style={{ background: "#fff" }}
                  />
                </figure>
                {desenfoqueActivo && (
                  <figure className="flex min-h-0 flex-col items-center gap-2">
                    <figcaption className="text-center text-[11px] text-ink">
                      <span className="font-bold">Digital, con la marca desenfocada</span> · {nombreArchivoPngDigital()}
                      <span className="block text-muted">→ {carpetaPublicacionesDigitales()}</span>
                    </figcaption>
                    {digital?.estado === "listo" && digital.url ? (
                      <img
                        src={digital.url}
                        alt="Vista previa de la etiqueta desenfocada"
                        className="max-h-[58vh] max-w-full object-contain shadow-lg"
                        style={{ background: "#fff" }}
                      />
                    ) : (
                      <div className="flex min-h-[160px] w-full flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-surface/70 p-4 text-center text-[12px] text-muted">
                        {digital?.estado === "error" ? (
                          <span className="text-accent-rose">{digital.msg}</span>
                        ) : (
                          "Buscando la marca y desenfocando…"
                        )}
                      </div>
                    )}
                    {digital?.estado === "listo" && digital.msg && <p className="text-[11px] text-muted">{digital.msg}</p>}
                    {digital && digital.estado !== "preparando" && (
                      <button
                        type="button"
                        onClick={() => setAjusteManual(true)}
                        className="rounded-lg border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-ink hover:bg-surface-hover"
                      >
                        {digital.estado === "error" ? "Marcar zonas a mano…" : "¿Falta tapar algo? Ajustar a mano…"}
                      </button>
                    )}
                  </figure>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
                <p className="text-[11px] text-muted">
                  Si algo no cuadra, cancela, corrige la etiqueta y vuelve a terminar.
                  {desenfoqueActivo && " Al aprobar se guardan los dos, cada uno en su carpeta."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void descargarPrevia()}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-hover"
                  >
                    Descargar PNG
                  </button>
                  <button
                    type="button"
                    onClick={cerrarPrevia}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-hover"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmarGuardarPng()}
                    disabled={guardando || (desenfoqueActivo && digital?.estado !== "listo")}
                    title={desenfoqueActivo && digital?.estado !== "listo" ? "Falta la versión desenfocada" : undefined}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {guardando
                      ? "Guardando…"
                      : desenfoqueActivo
                        ? digital?.estado === "preparando"
                          ? "Preparando el desenfocado…"
                          : "Aprobar y guardar los dos"
                        : "Aprobar y guardar"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {ajusteManual &&
        previa &&
        typeof document !== "undefined" &&
        createPortal(
          <Suspense fallback={null}>
            <DesenfoquePlantillaModal
              open
              onClose={() => setAjusteManual(false)}
              blobOriginal={previa.blob}
              imageUrl={previa.url}
              formato="png"
              titulo="Desenfocar datos para publicaciones digitales"
              subtitulo={`Arrastra un recuadro sobre lo que falte tapar. Reemplaza la versión automática; se guarda en ${carpetaPublicacionesDigitales()} al aprobar`}
              desenfocar={desenfocarBlobLocal}
              radioInicial={RADIO_DESENFOQUE_ETIQUETA}
              onAplicado={(b) => {
                // Reemplaza la versión automática en la vista previa; se guarda al aprobar.
                turnoDigitalRef.current++;
                fijarDigital(b, "Ajustada a mano.");
                setAjusteManual(false);
              }}
            />
          </Suspense>,
          document.body,
        )}

      {loteAbierto && (
        <LotePorCategoria
          categoriaLabel={nombreCategoria(categoria)}
          seleccion={loteSeleccion}
          onSeleccionChange={setLoteSeleccion}
          progreso={loteProgreso}
          resultado={loteResultado}
          generando={guardando}
          onGenerar={() => void generarLoteCategoria()}
          onCerrar={() => {
            if (guardando) return;
            setLoteAbierto(false);
            setLoteResultado([]);
          }}
        />
      )}
    </div>
  );
}

/** Selector de SKU para desplegar la plantilla sobre toda una categoría.
 *  El render corre en el navegador, uno por uno: el progreso se muestra porque
 *  con 20-40 productos la espera se nota. */
function LotePorCategoria({
  categoriaLabel,
  seleccion,
  onSeleccionChange,
  progreso,
  resultado,
  generando,
  onGenerar,
  onCerrar,
}: {
  categoriaLabel: string;
  seleccion: CodigoEan[];
  onSeleccionChange: (v: CodigoEan[]) => void;
  progreso: { hechos: number; total: number } | null;
  resultado: string[];
  generando: boolean;
  onGenerar: () => void;
  onCerrar: () => void;
}) {
  const [q, setQ] = useState("");
  const { data: codigos, isLoading } = useCodigosEan();
  const sugeridos = useMemo(
    () => filtrarCodigosEanPorTexto(codigos ?? [], q, 40),
    [codigos, q],
  );
  const marcados = new Set(seleccion.map((c) => c.id));

  return createPortal(
    <div className="fixed inset-0 z-[800] flex items-center justify-center bg-black/60 p-4" onClick={onCerrar}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-bold text-ink">Generar etiquetas de «{categoriaLabel}»</p>
          <p className="text-[11px] text-muted">
            Se aplica este mismo formato a cada producto que elijas: cambian los datos, no el
            diseño. Las etiquetas quedan en ETIQUETAS STUDIO/{categoriaLabel}.
          </p>
        </div>

        <div className="border-b border-border px-4 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto, SKU o código…"
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
          />
        </div>

        <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {isLoading && <li className="px-2 py-1 text-xs text-muted">Cargando catálogo…</li>}
          {!isLoading && sugeridos.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted">Sin resultados.</li>
          )}
          {sugeridos.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-hover">
                <input
                  type="checkbox"
                  checked={marcados.has(c.id)}
                  disabled={generando}
                  onChange={() =>
                    onSeleccionChange(
                      marcados.has(c.id)
                        ? seleccion.filter((x) => x.id !== c.id)
                        : [...seleccion, c],
                    )
                  }
                />
                <span className="font-mono text-[10px] text-muted">{c.codigo}</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {c.nombre_producto || c.sku}
                </span>
                {c.presentacion && (
                  <span className="shrink-0 text-[10px] text-muted">{c.presentacion}</span>
                )}
              </label>
            </li>
          ))}
        </ul>

        {resultado.length > 0 && (
          <p className="border-t border-border px-4 py-2 text-[11px] text-accent">
            ✓ {resultado.length} etiqueta(s): {resultado.slice(0, 4).join(", ")}
            {resultado.length > 4 ? "…" : ""}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-[11px] text-muted">
            {progreso
              ? `Generando ${progreso.hechos} de ${progreso.total}…`
              : `${seleccion.length} producto(s) seleccionados`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCerrar}
              disabled={generando}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={onGenerar}
              disabled={generando || seleccion.length === 0}
              className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {generando ? "Generando…" : `Generar ${seleccion.length || ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}


/** Pantalla de inicio del formulario: Formato + SKU obligatorios antes de
 *  abrir la ficha (nada se carga hasta entonces), o abrir una guardada. */
function PantallaInicio({
  onVolver,
  tipos,
  tiposLoading,
  fichasGuardadas,
  plantillasGuardadas,
  tienePlantillaBase,
  categoriasConPlantilla,
  skuInicial,
  onCrear,
  onAbrir,
  onDuplicar,
  onEliminar,
}: {
  onVolver: () => void;
  tipos: TipoEtiqueta[];
  tiposLoading: boolean;
  fichasGuardadas: FichaEtiquetaGuardada[];
  plantillasGuardadas: FichaEtiquetaGuardada[];
  tienePlantillaBase: boolean;
  categoriasConPlantilla: Map<string, FichaEtiquetaGuardada>;
  skuInicial?: string | null;
  onCrear: (tipoNombre: string, codigo: CodigoEan, categoria: string) => void;
  onAbrir: (f: FichaEtiquetaGuardada) => void;
  onDuplicar: (f: FichaEtiquetaGuardada) => void;
  onEliminar: (f: FichaEtiquetaGuardada) => void;
}) {
  const [tipoNombre, setTipoNombre] = useState("");
  const [q, setQ] = useState("");
  const [sku, setSku] = useState<CodigoEan | null>(null);
  // Categoría corregida a mano; mientras sea null manda la detectada del SKU,
  // para que cambiar de SKU vuelva a detectar en vez de arrastrar la anterior.
  const [categoriaManual, setCategoriaManual] = useState<string | null>(null);
  const { data: codigos, isLoading: codigosLoading } = useCodigosEan();
  const sugeridos = useMemo(() => filtrarCodigosEanPorTexto(codigos ?? [], q, 12), [codigos, q]);
  // Llegada con el SKU ya decidido (taller de combos): se elige solo, una vez.
  const skuPrecargado = useRef(false);
  useEffect(() => {
    if (skuPrecargado.current || !skuInicial || !codigos?.length) return;
    const obj = skuInicial.trim().toUpperCase();
    const hallado = codigos.find((c) => (c.sku || "").trim().toUpperCase() === obj);
    skuPrecargado.current = true;
    setQ(skuInicial);
    if (hallado) setSku(hallado);
  }, [skuInicial, codigos]);
  const categoriaDetectada = useMemo(
    () => (sku ? detectarCategoriaEtiqueta(sku.nombre_producto || sku.sku) : CATEGORIA_ETIQUETA_OTROS),
    [sku],
  );
  const categoria = categoriaManual ?? categoriaDetectada;
  const listo = Boolean(tipoNombre) && Boolean(sku);

  return (
    <div className="mx-auto flex h-full max-w-[1100px] min-h-0 flex-col overflow-auto p-4">
      <header className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Etiqueta suelta</h2>
        <span className="text-[11px] text-muted">
          Las plantillas viven en Studio → Categorías; aquí solo se consultan las etiquetas
          que ya se guardaron.
        </span>
      </header>

      {/* El apartado "Nueva ficha" (formato + SKU + categoría) se retiró: guardaba
          una ficha suelta sin asignar plantilla a la categoría, así que prometía
          algo que no hacía. Las etiquetas de una categoría se generan desde su
          plantilla de lienzo (Studio → Categorías → Crear etiquetas). Aquí solo
          quedan las etiquetas ya guardadas, para consultarlas o editarlas. */}
      <div className="grid gap-4">

        <section className="rounded-xl border border-border bg-surface-panel p-4">
          {plantillasGuardadas.length > 0 && (
            <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <h3 className="text-xs font-bold text-ink">Plantillas</h3>
              <p className="mb-2 text-[11px] text-muted">
                Un formulario por categoría y tamaño. Se ajusta una vez y sirve para todos los
                productos de la familia.
              </p>
              <ul className="space-y-1">
                {plantillasGuardadas.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => onAbrir(f)}
                      className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-ink hover:bg-surface-hover"
                    >
                      {f.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="text-sm font-bold text-ink">Etiquetas guardadas</h3>
          <p className="mb-3 text-[11px] text-muted">
            Cada una es la etiqueta de un SKU, no una plantilla. Ábrelas para consultarlas o
            seguir editándolas.
          </p>
          {fichasGuardadas.length === 0 && <p className="text-xs text-muted">Todavía no hay etiquetas guardadas.</p>}
          <ul className="max-h-[420px] space-y-1 overflow-y-auto">
            {fichasGuardadas.map((f) => (
              <li key={f.id} className="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-surface-hover">
                <button
                  type="button"
                  onClick={() => onAbrir(f)}
                  className="min-w-0 flex-1 truncate text-left text-xs text-ink"
                  title={f.nombre}
                >
                  {f.nombre}
                  {etiquetaTamanoTipoNombre(f.tipo_nombre, tipos) && (
                    <span className="ml-1 text-[10px] text-muted">· {etiquetaTamanoTipoNombre(f.tipo_nombre, tipos)}</span>
                  )}
                  {f.categoria && (
                    <span className="ml-1 text-[10px] text-muted">· {etiquetaCategoria(f.categoria)}</span>
                  )}
                  <span className="ml-1 text-[10px] text-muted">
                    {new Date(f.actualizado).toLocaleString("es-CO", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicar(f)}
                  title="Duplicar conservando el formato ya ajustado"
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-ink-secondary hover:bg-surface-hover"
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => onEliminar(f)}
                  title="Eliminar etiqueta guardada"
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}


/** Paso único para una plantilla nueva: el tamaño de etiqueta.
 *  La categoría ya viene de la tarjeta y el contenido se hereda de la plantilla
 *  que ya exista en esa familia, para no rehacer el ajuste. */
function ElegirTamanoPlantilla({
  categoriaId,
  categoriaLabel,
  tipos,
  tiposLoading,
  yaUsados,
  plantillasBase,
  etiquetaDeCategoria,
  onVolver,
  onElegir,
}: {
  categoriaId: string;
  categoriaLabel: string;
  tipos: TipoEtiqueta[];
  tiposLoading: boolean;
  yaUsados: string[];
  /** Todas las plantillas existentes, de cualquier categoría. */
  plantillasBase: FichaEtiquetaGuardada[];
  etiquetaDeCategoria: (id: string) => string;
  onVolver: () => void;
  onElegir: (tamano: string, baseId: string | null) => void;
}) {
  const [tamano, setTamano] = useState("");
  // Por defecto, la plantilla de esta misma categoría; si no hay, la primera que
  // exista. Solo se ofrecen plantillas como base, nunca etiquetas de producto.
  const [baseId, setBaseId] = useState<string>(
    () =>
      plantillasBase.find((f) => f.categoria === categoriaId)?.id
      ?? plantillasBase[0]?.id
      ?? "",
  );
  const usados = new Set(yaUsados.filter(Boolean));
  return (
    <div className="mx-auto flex h-full max-w-xl min-h-0 flex-col overflow-auto p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Nueva plantilla · {categoriaLabel}</h2>
      </header>

      <section className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-3 text-[11px] text-muted">
          Una plantilla sirve para toda la categoría en un tamaño concreto. Si ya hay una en
          esta familia, la nueva parte de ella y solo cambia el tamaño.
        </p>
        <label className="mb-3 block text-xs text-muted">
          <span className="mb-1 block font-semibold text-ink">Tamaño de etiqueta</span>
          <select
            value={tamano}
            onChange={(e) => setTamano(e.target.value)}
            disabled={tiposLoading}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink disabled:opacity-50"
          >
            <option value="">{tiposLoading ? "Cargando…" : "Elegir tamaño…"}</option>
            {tipos.map((t) => (
              <option key={t.nombre} value={t.nombre} disabled={usados.has(t.nombre)}>
                {etiquetaTamanoFormato(t.nombre, t.ancho_mm, t.alto_mm)}
                {usados.has(t.nombre) ? " — ya tiene plantilla" : ""}
              </option>
            ))}
          </select>
          {esFormatoCircular(tamano) && (
            <span className="mt-1 block text-[11px] text-accent">
              53 × 53 mm usa la etiqueta redonda de ceras y mantecas (nombre y datos sobre arcos;
              descripción, aplicaciones con viñeta, código de barras y peso en el centro).
            </span>
          )}
          {esFormatoSimple(tamano) && (
            <span className="mt-1 block text-[11px] text-accent">
              69 × 51 mm usa la diagramación simple de dos columnas (nombre, contenido neto,
              conservación y alérgenos · logo y código de barras).
            </span>
          )}
          {esFormato30ml(tamano) && (
            <span className="mt-1 block text-[11px] text-accent">
              30 mL usa la etiqueta horizontal de tres paneles; se edita igual que las demás,
              directamente sobre la etiqueta.
            </span>
          )}
        </label>
        <label className="mb-3 block text-xs text-muted">
          <span className="mb-1 block font-semibold text-ink">Partir de</span>
          <select
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
          >
            <option value="">Lienzo en blanco (datos corporativos)</option>
            {plantillasBase.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
                {f.categoria !== categoriaId
                  ? ` — de ${etiquetaDeCategoria(f.categoria || "")}`
                  : ""}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted">
            De la misma categoría se copia todo. De otra categoría se copia solo la parte
            de marca (logo, color, contacto, tipografías): los datos del producto no se
            arrastran.
          </span>
        </label>

        <button
          type="button"
          disabled={!tamano}
          onClick={() => onElegir(tamano, baseId || null)}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {tamano
            ? `Crear «Plantilla de ${categoriaLabel} tamaño ${tamano}»`
            : "Elige un tamaño para continuar"}
        </button>
        <p className="mt-2 text-[10px] text-muted">Categoría: {categoriaId}</p>
      </section>
    </div>
  );
}

/** Paso único para una etiqueta nueva: el producto. El formato lo pone la plantilla. */
function ElegirProductoParaEtiqueta({
  plantilla,
  categoriaLabel,
  onVolver,
  onElegir,
}: {
  plantilla: FichaEtiquetaGuardada;
  categoriaLabel: string;
  onVolver: () => void;
  onElegir: (codigo: CodigoEan) => void;
}) {
  const [q, setQ] = useState("");
  const { data: codigos, isLoading } = useCodigosEan();
  const { data: tiposData } = useTiposEtiqueta();
  const tamanoPlantilla = etiquetaTamanoTipoNombre(plantilla.tipo_nombre, tiposData?.tipos ?? []);
  const sugeridos = useMemo(() => filtrarCodigosEanPorTexto(codigos ?? [], q, 25), [codigos, q]);
  return (
    <div className="mx-auto flex h-full max-w-2xl min-h-0 flex-col overflow-auto p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Nueva etiqueta · {categoriaLabel}</h2>
        <span className="text-[11px] text-muted">
          {plantilla.nombre}
          {tamanoPlantilla ? ` · ${tamanoPlantilla}` : ""}
        </span>
      </header>

      <section className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-3 text-[11px] text-muted">
          Elige el producto: se aplica esta plantilla y se completa sola con su código de
          barras, su contenido neto y la ficha técnica que le corresponda. Después puedes
          ajustar cualquier campo.
        </p>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre, SKU o código de 12-13 dígitos…"
          className="mb-2 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
        />
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1">
          {isLoading && <li className="px-2 py-1 text-xs text-muted">Cargando catálogo…</li>}
          {!isLoading && sugeridos.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted">Sin resultados.</li>
          )}
          {sugeridos.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onElegir(c)}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
              >
                <span className="font-mono text-[11px] text-muted">{c.codigo}</span>
                <span className="ml-1.5 font-medium">{c.nombre_producto || c.sku}</span>
                {c.presentacion && (
                  <span className="ml-1.5 text-[10px] text-muted">{c.presentacion}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
