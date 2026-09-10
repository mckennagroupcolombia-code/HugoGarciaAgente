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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import ProductHeader from "./ProductHeader";
import ProductAttributeGrid, { type AttributeKey } from "./ProductAttributeGrid";
import GhsBadge from "./GhsBadge";
import TechnicalDocuments from "./TechnicalDocuments";
import TechnicalIdentity from "./TechnicalIdentity";
import NetContent from "./NetContent";
import BarcodeBlock from "./BarcodeBlock";
import ContactFooter from "./ContactFooter";
import { TextStyleProvider, useTextStyleCtx } from "./TextStyleContext";
import {
  CAMPOS_PLANTILLA,
  PRODUCTO_VACIO,
  RETICULA_MAESTRA,
  variablesAcento,
  type ProductLabelData,
} from "./productLabelTypes";
import { useCodigosEan, type CodigoEan } from "../../lib/etiquetasCodigosEan";
import { cargarPatchDesdeFichaTecnica, listarFichasTecnicas } from "../../lib/fichaTecnicaAplicar";
import { contenidoNetoDesdeCodigo, filtrarCodigosEanPorTexto } from "../../lib/fichaTecnicaCampos";
import {
  mejorFichaParaTitulo,
  nombreArchivoDesdeTitulo,
  palabrasClave,
  UMBRAL_ENLACE_AUTOMATICO,
} from "../../lib/fichaTecnicaMatch";
import { formatoMedidasEtiqueta, useTiposEtiqueta, type TipoEtiqueta } from "../../lib/etiquetasTipos";
import {
  useEliminarFichaEtiqueta,
  useFichasEtiquetaGuardadas,
  useGuardarFichaEtiqueta,
  type FichaEtiquetaGuardada,
} from "../../lib/etiquetasFichas";

/** Espera de inactividad antes de autoguardar — evita un PUT por cada tecla. */
const AUTOGUARDADO_DEBOUNCE_MS = 1500;
/** Id reservado de la plantilla del formulario en el almacén de fichas. */
const PLANTILLA_ID = "__plantilla__";
const PLANTILLA_NOMBRE = "Plantilla del formulario";

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
/** Ancho máximo del marco de formato en pantalla. */
const MARCO_MAX_ANCHO = 640;

export default function ProductLabelForm({ onVolver }: { onVolver: () => void }) {
  return (
    <TextStyleProvider>
      <ProductLabelFormInner onVolver={onVolver} />
    </TextStyleProvider>
  );
}

function ProductLabelFormInner({ onVolver }: { onVolver: () => void }) {
  const { data: tiposData, isLoading: tiposLoading } = useTiposEtiqueta();
  const tipos = tiposData?.tipos ?? [];

  const [tipoNombre, setTipoNombre] = useState("");
  const tipo: TipoEtiqueta | undefined = tipos.find((t) => t.nombre === tipoNombre);

  // "inicio": elegir Formato + SKU (o abrir una ficha guardada) — la ficha
  // no se muestra ni carga nada hasta entonces. "formulario": la ficha.
  const [etapa, setEtapa] = useState<"inicio" | "formulario">("inicio");
  const [data, setData] = useState<ProductLabelData>(PRODUCTO_VACIO);
  const [editMode, setEditMode] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [attributeIcons, setAttributeIcons] = useState<Partial<Record<AttributeKey, string>>>({});
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
  };

  const onChange = (patch: Partial<ProductLabelData>) => setData((d) => ({ ...d, ...patch }));
  const onIconChange = (campo: AttributeKey, svgDataUrl: string) =>
    setAttributeIcons((prev) => ({ ...prev, [campo]: svgDataUrl }));

  // ── Fichas guardadas: nombre elegido a mano por el operador (nunca
  // derivado de data.productName) + autoguardado en backend por cada ficha.
  const { estilos, reemplazarEstilos } = useTextStyleCtx();
  const { data: fichasTodas } = useFichasEtiquetaGuardadas();
  const plantilla = fichasTodas?.find((f) => f.id === PLANTILLA_ID);
  const fichasGuardadas = fichasTodas?.filter((f) => f.id !== PLANTILLA_ID);
  const guardarFichaMutation = useGuardarFichaEtiqueta();
  const eliminarFichaMutation = useEliminarFichaEtiqueta();
  const [plantillaMsg, setPlantillaMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const [nombreFicha, setNombreFicha] = useState("");
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [autoguardado, setAutoguardado] = useState<
    { estado: "idle" | "pendiente" | "guardando" | "ok" | "error"; texto?: string }
  >({ estado: "idle" });

  useEffect(() => {
    const nombre = nombreFicha.trim();
    if (!nombre || etapa !== "formulario") {
      setAutoguardado({ estado: "idle" });
      return;
    }
    setAutoguardado({ estado: "pendiente" });
    const t = setTimeout(() => {
      setAutoguardado({ estado: "guardando" });
      guardarFichaMutation.mutate(
        {
          id: fichaId ?? undefined,
          nombre,
          data,
          tipo_nombre: tipoNombre || undefined,
          attribute_icons: attributeIcons,
          text_styles: estilos,
        },
        {
          onSuccess: (res) => {
            setFichaId(res.ficha.id);
            setAutoguardado({ estado: "ok", texto: "Guardado" });
          },
          onError: (err) => {
            setAutoguardado({
              estado: "error",
              texto: err instanceof Error ? err.message : "No se pudo guardar",
            });
          },
        },
      );
    }, AUTOGUARDADO_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombreFicha, data, tipoNombre, attributeIcons, estilos, etapa]);

  /** Guarda las partes fijas actuales (logo, acento, contacto, textos
   *  fijos, íconos de atributo y tipografías) como plantilla del formulario. */
  const guardarPlantilla = () => {
    const fijos: Partial<ProductLabelData> = {};
    const origen = data as unknown as Record<string, unknown>;
    const destino = fijos as unknown as Record<string, unknown>;
    for (const k of CAMPOS_PLANTILLA) destino[k] = origen[k];
    setPlantillaMsg(null);
    guardarFichaMutation.mutate(
      {
        id: PLANTILLA_ID,
        nombre: PLANTILLA_NOMBRE,
        data: { ...PRODUCTO_VACIO, ...fijos },
        attribute_icons: attributeIcons,
        text_styles: estilos,
      },
      {
        onSuccess: () => setPlantillaMsg({ ok: true, texto: "Plantilla del formulario guardada: las fichas nuevas partirán de ella." }),
        onError: (err) =>
          setPlantillaMsg({ ok: false, texto: err instanceof Error ? err.message : "No se pudo guardar la plantilla" }),
      },
    );
  };

  const abrirFichaGuardada = (f: FichaEtiquetaGuardada) => {
    setData(f.data);
    setTipoNombre(f.tipo_nombre || "");
    setAttributeIcons(f.attribute_icons || {});
    reemplazarEstilos(f.text_styles || {});
    setNombreFicha(f.nombre);
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
    setFichaId(null);
    setAutoguardado({ estado: "idle" });
    setEnlace(null);
    setPlantillaMsg(null);
    setEtapa("inicio");
  };

  /** Inicio → formulario: ficha vacía + plantilla, y la información del SKU. */
  const crearFichaDesdeSku = async (tipoNom: string, codigo: CodigoEan) => {
    setData(fichaDesdePlantilla(plantilla));
    setAttributeIcons(plantilla?.attribute_icons ?? {});
    reemplazarEstilos(plantilla?.text_styles ?? {});
    setTipoNombre(tipoNom);
    setFichaId(null);
    setEditMode(true);
    setPlantillaMsg(null);
    setEtapa("formulario");
    onChange({ barcode: (codigo.codigo || "").replace(/\D/g, "").slice(0, 13) });
    await onElegirCodigo(codigo);
  };

  const eliminarFichaGuardada = (f: FichaEtiquetaGuardada) => {
    eliminarFichaMutation.mutate(f.id);
    if (f.id === fichaId) nuevaFicha();
  };

  // ── Código de barras elegido: su título nombra el archivo (PNG y ficha
  // guardada) y busca, por palabras clave, la ficha técnica que le
  // corresponde para autorellenar la etiqueta (ver lib/fichaTecnicaMatch).
  const [enlace, setEnlace] = useState<{ tipo: "ok" | "info" | "error"; texto: string } | null>(null);
  const onElegirCodigo = async (codigo: CodigoEan) => {
    const titulo = (codigo.nombre_producto || codigo.sku || "").trim();
    if (!titulo) return;
    setNombreFicha(titulo);
    // Contenido neto = presentación del SKU ("30mL", "500g", "1 Kg"); si la
    // ficha técnica también trae uno, manda el del SKU (es el envase real).
    const neto = contenidoNetoDesdeCodigo(codigo);
    onChange({ barcodeTitle: titulo, ...(neto ? { netContent: neto } : {}) });
    const claves = palabrasClave(titulo);
    setEnlace({ tipo: "info", texto: `Buscando ficha técnica para "${titulo}"…` });
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
      onChange({
        ...patch,
        ...(neto ? { netContent: neto } : {}),
        fichaTecnicaId: mejor.ficha.id,
        fichaTecnicaTitulo: mejor.ficha.titulo,
      });
      setEnlace({
        tipo: "ok",
        texto: `Ficha técnica enlazada: ${mejor.ficha.titulo} (coincidencia ${Math.round(mejor.puntaje * 100)} % por: ${claves.join(", ")}).`,
      });
    } catch (e) {
      setEnlace({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo enlazar la ficha técnica" });
    }
  };

  // Alto real de la ficha a su ancho de diseño (varía con el texto que se
  // escriba) — se mide para poder escalarla completa dentro del marco del
  // formato sin romper la composición interna.
  const fichaRef = useRef<HTMLDivElement>(null);
  const [altoDiseno, setAltoDiseno] = useState(700);
  useLayoutEffect(() => {
    const el = fichaRef.current;
    if (!el) return;
    const medir = () => setAltoDiseno(el.offsetHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, editMode]);

  const marco = useMemo(() => {
    if (!tipo || !tipo.ancho_mm || !tipo.alto_mm) return null;
    const ratio = tipo.ancho_mm / tipo.alto_mm;
    const ancho = MARCO_MAX_ANCHO;
    const alto = ancho / ratio;
    const escala = Math.min(ancho / ANCHO_DISENO, alto / Math.max(altoDiseno, 1));
    return { ancho, alto, escala };
  }, [tipo, altoDiseno]);

  /** Renderiza el PNG listo para imprimir (300 DPI si hay Formato elegido;
   *  si no, una escala fija alta) y lo muestra en una vista previa. La
   *  subida a Diseño → Imprimir (`ETIQUETAS STUDIO`, mismo destino que usa
   *  Estudio Visual) solo ocurre al confirmar en esa vista previa. */
  const generarPng = async () => {
    const el = fichaRef.current;
    if (!el || guardando) return;
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

      const DPI_IMPRESION = 300;
      const anchoMm = tipo?.ancho_mm;
      const altoMm = tipo?.alto_mm;
      // Con Formato elegido: escala para que el PNG mida exactamente
      // ancho_mm a 300dpi. Sin Formato ("tamaño libre"): escala fija alta
      // (960px de diseño × 3 ≈ 2880px), suficiente para imprimir bien sin
      // un tamaño físico de referencia.
      const pixelRatio = anchoMm ? (anchoMm / 25.4) * DPI_IMPRESION / ANCHO_DISENO : 3;

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
        dpi: anchoMm ? DPI_IMPRESION : undefined,
        pixelRatio,
      });
    } catch (e) {
      setGuardarMsg({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PNG" });
    } finally {
      if (estabaEditando) setEditMode(true);
      setGuardando(false);
    }
  };

  /** Nombre del archivo: título del código de barras elegido (catálogo
   *  EAN); sin código, nombre de la ficha guardada o del producto. */
  const nombreArchivoPng = () =>
    `${nombreArchivoDesdeTitulo(data.barcodeTitle || nombreFicha || data.productName) || "ficha"}.png`;

  /** Confirmación de la vista previa: sube el PNG a Diseño → Imprimir. */
  const confirmarGuardarPng = async () => {
    if (!previa || guardando) return;
    setGuardando(true);
    try {
      const { subirImagenBlobAEtiquetas } = await import("../../lib/plantillasVisualesExport");
      const res = await subirImagenBlobAEtiquetas(previa.blob, nombreArchivoPng(), {
        carpeta: "ETIQUETAS STUDIO",
        tipo_etiqueta: tipo?.nombre,
        ancho_mm: previa.anchoMm,
        alto_mm: previa.altoMm,
        dpi: previa.dpi,
        escala: previa.pixelRatio,
      });
      setGuardarMsg({
        ok: true,
        texto: tipo
          ? `Guardado como ${res.nombre} (${tipo.nombre}, ${previa.dpi} dpi) — ya está en Diseño → Imprimir.`
          : `Guardado como ${res.nombre} — ya está en Diseño → Imprimir.`,
      });
      cerrarPrevia();
    } catch (e) {
      setGuardarMsg({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar el PNG" });
    } finally {
      setGuardando(false);
    }
  };

  const descargarPrevia = async () => {
    if (!previa) return;
    const { descargarBlob } = await import("../../lib/etiquetaAssets");
    descargarBlob(previa.blob, nombreArchivoPng());
  };

  const ficha = (
    <div
      ref={fichaRef}
      lang="es"
      className="relative overflow-hidden rounded-[6px] border border-[#111111]/10 bg-white text-[#111111] shadow-none"
      style={{ width: ANCHO_DISENO, ...variablesAcento(data.accentColor) }}
    >
      {showGrid && <div className="pointer-events-none absolute inset-0" style={PATRON_RETICULA} />}

      <div className="relative">
        {/* 1-2. Cabecera */}
        <ProductHeader
          data={data}
          onChange={onChange}
          editMode={editMode}
        />

        {/* 4. Cuerpo principal + 7. columna derecha */}
        <div className={`${RETICULA_MAESTRA} border-t-[1.5px] border-[color:var(--acento)]`}>
          <ProductAttributeGrid
            data={data}
            onChange={onChange}
            editMode={editMode}
            attributeIcons={attributeIcons}
            onIconChange={onIconChange}
          />

          {/* pl 13px + borde 3px = pr 16px: el contenido queda centrado en
              el eje de la columna de la retícula (con px-4 simétrico el
              borde lo corría 1.5px). justify-center: el bloque GHS /
              documentos / pureza se centra también en vertical respecto al
              alto que impone la cuadrícula de atributos. */}
          <div className="flex flex-col items-center justify-center gap-[14px] border-l-[3px] border-[color:var(--acento)] py-4 pl-[13px] pr-4">
            <GhsBadge
              value={data.ghs}
              onChange={(v) => onChange({ ghs: v })}
              iconSvg={data.ghsIconSvg}
              onIconChange={(svg) => onChange({ ghsIconSvg: svg })}
              editMode={editMode}
            />
            <TechnicalDocuments
              technicalDocuments={data.technicalDocuments}
              website={data.website}
              onTechnicalDocumentsChange={(v) => onChange({ technicalDocuments: v })}
              onWebsiteChange={(v) => onChange({ website: v })}
              editMode={editMode}
            />
            <TechnicalIdentity
              concentration={data.concentration}
              cas={data.cas}
              onConcentrationChange={(v) => onChange({ concentration: v })}
              onCasChange={(v) => onChange({ cas: v })}
              editMode={editMode}
            />
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

  if (etapa === "inicio") {
    return (
      <PantallaInicio
        onVolver={onVolver}
        tipos={tipos}
        tiposLoading={tiposLoading}
        fichasGuardadas={fichasGuardadas ?? []}
        tienePlantilla={Boolean(plantilla)}
        onCrear={(tipoNom, codigo) => void crearFichaDesdeSku(tipoNom, codigo)}
        onAbrir={abrirFichaGuardada}
        onEliminar={eliminarFichaGuardada}
      />
    );
  }

  return (
    <div
      className="mx-auto flex h-full max-w-[1100px] min-h-0 flex-col overflow-auto p-4"
      style={variablesAcento(data.accentColor)}
    >
      <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Ficha de etiqueta</h2>

        <input
          type="text"
          value={nombreFicha}
          onChange={(e) => setNombreFicha(e.target.value)}
          placeholder="Nombre de esta ficha (para guardarla)…"
          className="w-56 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-muted"
        />
        <span className="text-[11px] text-muted">
          {autoguardado.estado === "pendiente" && "Sin guardar…"}
          {autoguardado.estado === "guardando" && "Guardando…"}
          {autoguardado.estado === "ok" && "✓ Guardado"}
          {autoguardado.estado === "error" && (
            <span className="text-red-600">✗ {autoguardado.texto}</span>
          )}
        </span>

        <button
          type="button"
          onClick={nuevaFicha}
          title="Volver al inicio para elegir otro Formato y SKU, o abrir una ficha guardada"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-hover"
        >
          + Nueva ficha
        </button>

        <button
          type="button"
          onClick={guardarPlantilla}
          disabled={!editMode || guardarFichaMutation.isPending}
          title="Guarda logo, acento, contacto, textos fijos, íconos y tipografías actuales como plantilla: toda ficha nueva partirá de ellos"
          className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          Guardar como plantilla
        </button>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Formato:
          <select
            value={tipoNombre}
            onChange={(e) => setTipoNombre(e.target.value)}
            disabled={tiposLoading}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink disabled:opacity-50"
          >
            <option value="">{tiposLoading ? "Cargando…" : "Sin ajustar (tamaño libre)"}</option>
            {tipos.map((t) => (
              <option key={t.nombre} value={t.nombre}>
                {t.nombre} ({formatoMedidasEtiqueta(t.ancho_mm, t.alto_mm)})
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Retícula
          </label>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              editMode ? "bg-accent text-white hover:opacity-90" : "border border-border text-ink hover:bg-surface-hover"
            }`}
          >
            {editMode ? "Terminar edición" : "Editar"}
          </button>
          <button
            type="button"
            onClick={generarPng}
            disabled={guardando}
            title="Genera un PNG listo para imprimir (300 dpi si hay Formato elegido), lo muestra en vista previa y, al confirmar, lo guarda junto con el Formato en Diseño → Imprimir"
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60"
          >
            {guardando && !previa ? "Generando…" : "Guardar PNG para imprimir"}
          </button>
        </div>
      </header>

      {guardarMsg && (
        <p className={`mb-2 text-[12px] ${guardarMsg.ok ? "text-accent" : "text-red-600"}`}>
          {guardarMsg.ok ? "✓ " : "✗ "}
          {guardarMsg.texto}
        </p>
      )}
      {plantillaMsg && (
        <p className={`mb-2 text-[12px] ${plantillaMsg.ok ? "text-accent" : "text-red-600"}`}>
          {plantillaMsg.ok ? "✓ " : "✗ "}
          {plantillaMsg.texto}
        </p>
      )}
      {enlace && (
        <p
          className={`mb-2 text-[12px] ${
            enlace.tipo === "error" ? "text-red-600" : enlace.tipo === "ok" ? "text-accent" : "text-muted"
          }`}
        >
          {enlace.tipo === "ok" ? "✓ " : enlace.tipo === "error" ? "✗ " : "ℹ "}
          {enlace.texto}
        </p>
      )}
      {(data.barcodeTitle || data.fichaTecnicaTitulo) && (
        <p className="mb-2 text-[11px] text-muted">
          Código de barras: <span className="font-semibold text-ink">{data.barcodeTitle || "—"}</span>
          {" · "}
          Ficha técnica: <span className="font-semibold text-ink">{data.fichaTecnicaTitulo || "sin enlazar"}</span>
        </p>
      )}

      {marco && (
        <p className="mb-2 text-[11px] text-muted">
          Ajustada a {tipo?.nombre} ({tipo && formatoMedidasEtiqueta(tipo.ancho_mm, tipo.alto_mm)}) — el marco
          punteado es el tamaño real de la etiqueta; lo que quede fuera de foco no cabe a ese tamaño.
        </p>
      )}

      {marco ? (
        <div
          className="relative mx-auto overflow-hidden border-2 border-dashed border-[color:var(--acento-60)] bg-[#f4f4f2]"
          style={{ width: marco.ancho, height: marco.alto }}
        >
          <div
            className="absolute left-0 top-0"
            style={{ width: ANCHO_DISENO, transform: `scale(${marco.escala})`, transformOrigin: "top left" }}
          >
            {ficha}
          </div>
        </div>
      ) : (
        ficha
      )}

      {previa &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[650] flex items-center justify-center bg-ink/60 p-3 backdrop-blur-sm"
            onClick={cerrarPrevia}
          >
            <div
              className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-bold text-ink">Vista previa del PNG para imprimir</h3>
                  <p className="text-[11px] text-muted">
                    {nombreArchivoPng()} · {previa.anchoPx} × {previa.altoPx} px
                    {previa.anchoMm && previa.altoMm
                      ? ` · ${previa.anchoMm} × ${previa.altoMm} mm a ${previa.dpi} dpi (${tipo?.nombre})`
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
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#e9e9e6] p-4">
                <img
                  src={previa.url}
                  alt="Vista previa de la etiqueta"
                  className="max-h-[70vh] max-w-full object-contain shadow-lg"
                  style={{ background: "#fff" }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
                <p className="text-[11px] text-muted">
                  Así quedará impresa. Si algo no cuadra, cierra, corrige la ficha y vuelve a generar.
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
                    disabled={guardando}
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                  >
                    {guardando ? "Guardando…" : "Guardar en Diseño → Imprimir"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}


/** Pantalla de inicio del formulario: Formato + SKU obligatorios antes de
 *  abrir la ficha (nada se carga hasta entonces), o abrir una guardada. */
function PantallaInicio({
  onVolver,
  tipos,
  tiposLoading,
  fichasGuardadas,
  tienePlantilla,
  onCrear,
  onAbrir,
  onEliminar,
}: {
  onVolver: () => void;
  tipos: TipoEtiqueta[];
  tiposLoading: boolean;
  fichasGuardadas: FichaEtiquetaGuardada[];
  tienePlantilla: boolean;
  onCrear: (tipoNombre: string, codigo: CodigoEan) => void;
  onAbrir: (f: FichaEtiquetaGuardada) => void;
  onEliminar: (f: FichaEtiquetaGuardada) => void;
}) {
  const [tipoNombre, setTipoNombre] = useState("");
  const [q, setQ] = useState("");
  const [sku, setSku] = useState<CodigoEan | null>(null);
  const { data: codigos, isLoading: codigosLoading } = useCodigosEan();
  const sugeridos = useMemo(() => filtrarCodigosEanPorTexto(codigos ?? [], q, 12), [codigos, q]);
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
        <h2 className="text-base font-bold text-ink">Ficha de etiqueta</h2>
        <span className="text-[11px] text-muted">
          {tienePlantilla
            ? "Las fichas nuevas parten de la plantilla del formulario guardada."
            : "Aún no hay plantilla del formulario: las fichas nuevas parten de los datos corporativos por defecto."}
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-surface-panel p-4">
          <h3 className="text-sm font-bold text-ink">Nueva ficha</h3>
          <p className="mb-3 text-[11px] text-muted">
            Elige el Formato de la etiqueta y el SKU. La ficha se abre vacía y carga solo la información de ese
            SKU: código de barras, contenido neto, título y la ficha técnica que coincida.
          </p>

          <label className="mb-3 block text-xs text-muted">
            <span className="mb-1 block font-semibold text-ink">1. Formato de la etiqueta</span>
            <select
              value={tipoNombre}
              onChange={(e) => setTipoNombre(e.target.value)}
              disabled={tiposLoading}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink disabled:opacity-50"
            >
              <option value="">{tiposLoading ? "Cargando…" : "Elegir formato…"}</option>
              {tipos.map((t) => (
                <option key={t.nombre} value={t.nombre}>
                  {t.nombre} ({formatoMedidasEtiqueta(t.ancho_mm, t.alto_mm)})
                </option>
              ))}
            </select>
          </label>

          <div className="mb-3 text-xs text-muted">
            <span className="mb-1 block font-semibold text-ink">2. SKU (código de barras)</span>
            {sku ? (
              <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-muted">{sku.codigo}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{sku.nombre_producto || sku.sku}</span>
                <button
                  type="button"
                  onClick={() => setSku(null)}
                  className="text-muted hover:text-ink"
                  title="Cambiar SKU"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Nombre, SKU o código de 12-13 dígitos…"
                  className="mb-1.5 w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
                />
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1">
                  {codigosLoading && <li className="px-2 py-1 text-xs text-muted">Cargando catálogo…</li>}
                  {!codigosLoading && sugeridos.length === 0 && (
                    <li className="px-2 py-1 text-xs text-muted">Sin resultados.</li>
                  )}
                  {sugeridos.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSku(c)}
                        className="w-full rounded px-2 py-1.5 text-left text-xs text-ink hover:bg-accent/10"
                      >
                        <span className="font-mono text-[11px] text-muted">{c.codigo}</span>
                        <span className="ml-1.5 font-medium">{c.nombre_producto || c.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={!listo}
            onClick={() => sku && onCrear(tipoNombre, sku)}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {listo ? "Abrir ficha con este SKU" : "Elige Formato y SKU para continuar"}
          </button>
        </section>

        <section className="rounded-xl border border-border bg-surface-panel p-4">
          <h3 className="text-sm font-bold text-ink">Fichas guardadas</h3>
          <p className="mb-3 text-[11px] text-muted">Se guardan solas con el título del SKU mientras las editas.</p>
          {fichasGuardadas.length === 0 && <p className="text-xs text-muted">Todavía no hay fichas guardadas.</p>}
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
                  {f.tipo_nombre && <span className="ml-1 text-[10px] text-muted">· {f.tipo_nombre}</span>}
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
                  onClick={() => onEliminar(f)}
                  title="Eliminar ficha guardada"
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
