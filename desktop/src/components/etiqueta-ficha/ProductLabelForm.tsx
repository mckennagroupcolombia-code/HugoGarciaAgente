/**
 * Ficha/etiqueta de materia prima — reemplaza el flujo anterior de
 * "Formularios etiquetados" (formato+categoría+lienzo canvas). Réplica
 * fiel de la etiqueta impresa como formulario web: fondo blanco, naranja
 * corporativo, retícula editorial, sin cards/sombras/degradados.
 *
 * VIEW MODE: se ve como la etiqueta terminada. EDIT MODE: cada valor se
 * vuelve editable in-place sin cambiar el tamaño de ningún bloque.
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ProductHeader from "./ProductHeader";
import ProductAttributeGrid, { type AttributeKey } from "./ProductAttributeGrid";
import GhsBadge from "./GhsBadge";
import TechnicalDocuments from "./TechnicalDocuments";
import TechnicalIdentity from "./TechnicalIdentity";
import NetContent from "./NetContent";
import BarcodeBlock from "./BarcodeBlock";
import ContactFooter from "./ContactFooter";
import { TextStyleProvider } from "./TextStyleContext";
import { PRODUCTO_EJEMPLO, RETICULA_MAESTRA, type ProductLabelData } from "./productLabelTypes";
import { formatoMedidasEtiqueta, useTiposEtiqueta, type TipoEtiqueta } from "../../lib/etiquetasTipos";

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

  const [data, setData] = useState<ProductLabelData>(PRODUCTO_EJEMPLO);
  const [editMode, setEditMode] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [attributeIcons, setAttributeIcons] = useState<Partial<Record<AttributeKey, string>>>({});
  const [guardando, setGuardando] = useState(false);
  const [guardarMsg, setGuardarMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const onChange = (patch: Partial<ProductLabelData>) => setData((d) => ({ ...d, ...patch }));
  const onIconChange = (campo: AttributeKey, svgDataUrl: string) =>
    setAttributeIcons((prev) => ({ ...prev, [campo]: svgDataUrl }));

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

  /** Guarda un PNG listo para imprimir (300 DPI si hay Formato elegido; si
   *  no, una escala fija alta) junto con el Formato como metadata — mismo
   *  destino que usa Estudio Visual (`ETIQUETAS STUDIO`), así que aparece
   *  de una en Diseño → Imprimir sin duplicar el mecanismo de guardado. */
  const guardarPng = async () => {
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

      const { subirImagenBlobAEtiquetas } = await import("../../lib/plantillasVisualesExport");
      const nombreBase = (data.productName || "ficha")
        .replace(/\s+/g, "_")
        .replace(/[^\w\-]+/g, "")
        .slice(0, 60) || "ficha";
      const res = await subirImagenBlobAEtiquetas(blob, `${nombreBase}.png`, {
        carpeta: "ETIQUETAS STUDIO",
        tipo_etiqueta: tipo?.nombre,
        ancho_mm: anchoMm,
        alto_mm: altoMm,
        dpi: anchoMm ? DPI_IMPRESION : undefined,
        escala: pixelRatio,
      });
      setGuardarMsg({
        ok: true,
        texto: tipo
          ? `Guardado como ${res.nombre} (${tipo.nombre}, ${DPI_IMPRESION} dpi) — ya está en Diseño → Imprimir.`
          : `Guardado como ${res.nombre} — ya está en Diseño → Imprimir.`,
      });
    } catch (e) {
      setGuardarMsg({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar el PNG" });
    } finally {
      if (estabaEditando) setEditMode(true);
      setGuardando(false);
    }
  };

  const ficha = (
    <div
      ref={fichaRef}
      className="relative overflow-hidden rounded-[6px] border border-[#111111]/10 bg-white text-[#111111] shadow-none"
      style={{ width: ANCHO_DISENO }}
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
        <div className={`${RETICULA_MAESTRA} border-t-[1.5px] border-[#FFA500]`}>
          <ProductAttributeGrid
            data={data}
            onChange={onChange}
            editMode={editMode}
            attributeIcons={attributeIcons}
            onIconChange={onIconChange}
          />

          <div className="flex flex-col items-center gap-[14px] border-l-[3px] border-[#FFA500] px-4 py-4">
            <GhsBadge value={data.ghs} onChange={(v) => onChange({ ghs: v })} editMode={editMode} />
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
        <div className={`${RETICULA_MAESTRA} my-2.5 overflow-hidden rounded-[4px] border-[1.5px] border-[#FFA500] bg-white`}>
          <NetContent value={data.netContent} onChange={(v) => onChange({ netContent: v })} editMode={editMode} />
          <div aria-hidden="true" />
          <BarcodeBlock value={data.barcode} onChange={(v) => onChange({ barcode: v })} editMode={editMode} />
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

  return (
    <div className="mx-auto flex h-full max-w-[1100px] min-h-0 flex-col overflow-auto p-4">
      <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Volver
        </button>
        <h2 className="text-base font-bold text-ink">Ficha de etiqueta</h2>

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
            onClick={guardarPng}
            disabled={guardando}
            title="Genera un PNG listo para imprimir (300 dpi si hay Formato elegido) y lo guarda junto con el Formato en Diseño → Imprimir"
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60"
          >
            {guardando ? "Guardando…" : "Guardar PNG para imprimir"}
          </button>
        </div>
      </header>

      {guardarMsg && (
        <p className={`mb-2 text-[12px] ${guardarMsg.ok ? "text-accent" : "text-red-600"}`}>
          {guardarMsg.ok ? "✓ " : "✗ "}
          {guardarMsg.texto}
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
          className="relative mx-auto overflow-hidden border-2 border-dashed border-[#FFA500]/60 bg-[#f4f4f2]"
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
    </div>
  );
}
