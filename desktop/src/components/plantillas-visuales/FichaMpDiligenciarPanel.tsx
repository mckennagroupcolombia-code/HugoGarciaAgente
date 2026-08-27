/**
 * Formulario para diligenciar (como fichas técnicas) + vista previa en vivo
 * de la etiqueta MP tipo SCI. El PNG se exporta desde el HTML, no del lienzo.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { toBlob } from "html-to-image";
import { api } from "../../api/client";
import { Field } from "../documentos/DocumentoGeneradorTab";
import { CodigoBarrasEAN13 } from "../CodigoBarrasEAN13";
import { GHSIconsPicker } from "../GHSIconsPicker";
import GaleriaImagenesModal from "./GaleriaImagenesModal";
import GaleriaIconosQuimicosModal from "./GaleriaIconosQuimicosModal";
import { generarEAN13, svgToDataUrl } from "../../lib/ean13";
import { resolverUrlImagenCanvas } from "../../lib/plantillasVisualesImagen";
import { imagenDesdePortapapeles } from "../../lib/clipboardImage";
import {
  CAMPOS_TEXTO_FICHA_MP,
  CARPETA_FORMATOS_ETIQUETA,
  COLOR_FICHA_MP_DEFAULT,
  DATOS_EJEMPLO_SCI,
  ESTILO_FICHA_MP_DEFAULT,
  LISTA_LINEAS_FICHA_MP,
  crearDatosFichaMpVacios,
  esFichaMpVacia,
  estiloCampoFichaMp,
  fusionarDatosFichaMp,
  fusionarEstiloFichaMp,
  parsearFichaMpDePlantilla,
  plantillaFichaTecnicaMp,
  type CampoTextoFichaMp,
  type DatosFichaTecnicaMp,
  type EstiloFichaMp,
  type LineaIndividualFichaMp,
} from "../../lib/plantillaFichaTecnicaMp";
import {
  CANVAS_DPI,
  fusionarMetadatosPlantillaTrasGuardar,
  mmToPx,
  tipoEtiquetaToFormato,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";
import { descargarBlob, subirImagenBlobAEtiquetas } from "../../lib/plantillasVisualesExport";
import {
  formatoMedidasEtiqueta,
  useTiposEtiqueta,
  type TipoEtiqueta,
} from "../../lib/etiquetasTipos";

const COLORES_FORMATO: { hex: string; nombre: string }[] = [
  { hex: "#3d246b", nombre: "Violeta SCI" },
  { hex: "#6A1B9A", nombre: "Morado" },
  { hex: "#069DC2", nombre: "Azul McKenna" },
  { hex: "#003DA5", nombre: "Azul marino" },
  { hex: "#0f766e", nombre: "Teal" },
  { hex: "#5CB85C", nombre: "Verde" },
  { hex: "#14532d", nombre: "Verde bosque" },
  { hex: "#37474F", nombre: "Gris antracita" },
  { hex: "#B71C1C", nombre: "Rojo" },
  { hex: "#7c2d12", nombre: "Terracota" },
  { hex: "#000000", nombre: "Negro" },
];

const FICHA_MP_TIPO: TipoEtiqueta = { nombre: "Ficha MP", ancho_mm: 90, alto_mm: 140 };
/** Diagramación SCI de referencia (250 g / 500 g). Se escala entera a otros mm. */
const DIAGRAMA_ANCHO_MM = 76;
const DIAGRAMA_ALTO_MM = 66;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return `${r}, ${g}, ${b}`;
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return `${r}, ${g}, ${b}`;
}

function SliderEstilo({
  label,
  value,
  min = 0.4,
  max = 2.5,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums font-semibold text-ink">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

function AjustesDiagramacionCompleta({
  estilo,
  color,
  onPatchEstilo,
  onResetEstilo,
}: {
  estilo: EstiloFichaMp;
  color: string;
  onPatchEstilo: (patch: Partial<EstiloFichaMp>) => void;
  onResetEstilo: () => void;
}) {
  const [tab, setTab] = useState<"cajas" | "lineas" | "relleno" | "iconos" | "textos">("cajas");

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-3 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
          <span>⚙️</span> Ajustes de Diagramación
        </span>
        <button
          type="button"
          onClick={onResetEstilo}
          className="text-[10px] text-muted underline hover:text-ink"
        >
          Restablecer
        </button>
      </div>

      {/* Selector de pestañas */}
      <div className="mt-2.5 flex rounded-lg border border-border bg-surface p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setTab("cajas")}
          className={`flex-1 rounded-md py-1 text-center font-semibold transition ${
            tab === "cajas" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          📐 Cajas
        </button>
        <button
          type="button"
          onClick={() => setTab("lineas")}
          className={`flex-1 rounded-md py-1 text-center font-semibold transition ${
            tab === "lineas" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          ➖ Líneas
        </button>
        <button
          type="button"
          onClick={() => setTab("relleno")}
          className={`flex-1 rounded-md py-1 text-center font-semibold transition ${
            tab === "relleno" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          🎨 Rellenos
        </button>
        <button
          type="button"
          onClick={() => setTab("iconos")}
          className={`flex-1 rounded-md py-1 text-center font-semibold transition ${
            tab === "iconos" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          🔣 Iconos
        </button>
        <button
          type="button"
          onClick={() => setTab("textos")}
          className={`flex-1 rounded-md py-1 text-center font-semibold transition ${
            tab === "textos" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          ✍️ Textos
        </button>
      </div>

      {/* Contenido de la pestaña activa */}
      <div className="mt-3 space-y-2.5">
        {tab === "cajas" && (
          <>
            <SliderEstilo
              label="Alto / Relleno interno de cajas"
              value={estilo.tamCajas}
              onChange={(v) => onPatchEstilo({ tamCajas: v })}
            />
            <SliderEstilo
              label="Esquinas redondeadas"
              value={estilo.radioCajas}
              onChange={(v) => onPatchEstilo({ radioCajas: v })}
            />
            <SliderEstilo
              label="Grosor de borde de cajas"
              value={estilo.bordeCajas ?? 1}
              onChange={(v) => onPatchEstilo({ bordeCajas: v })}
            />
          </>
        )}

        {tab === "lineas" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <p className="text-[11px] text-muted">
                Selecciona qué líneas y bordes mantener o eliminar:
              </p>
              <div className="flex shrink-0 gap-1.5 text-[10px]">
                <button
                  type="button"
                  onClick={() =>
                    onPatchEstilo({
                      ocultarBordeExterior: false,
                      ocultarLineaDivisoriaCentral: false,
                      ocultarLineasFilas: false,
                      ocultarBordeCajas: false,
                      lineasOcultas: {},
                    })
                  }
                  className="rounded border border-border bg-surface px-1.5 py-0.5 text-muted hover:text-ink"
                >
                  Mostrar todas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const allOcultas: Partial<Record<LineaIndividualFichaMp, boolean>> = {};
                    LISTA_LINEAS_FICHA_MP.forEach((l) => {
                      allOcultas[l.id] = true;
                    });
                    onPatchEstilo({
                      ocultarBordeExterior: true,
                      ocultarLineaDivisoriaCentral: true,
                      ocultarLineasFilas: true,
                      ocultarBordeCajas: true,
                      lineasOcultas: allOcultas,
                    });
                  }}
                  className="rounded border border-red-300/40 bg-red-500/10 px-1.5 py-0.5 text-red-500 hover:text-red-600"
                >
                  Quitar todas
                </button>
              </div>
            </div>

            {(["Estructura general", "Columna Izquierda", "Columna Derecha"] as const).map((sec) => {
              const lineasSec = LISTA_LINEAS_FICHA_MP.filter((l) => l.seccion === sec);
              return (
                <div key={sec} className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    {sec}
                  </span>
                  <div className="space-y-1">
                    {lineasSec.map((l) => {
                      const ocultada =
                        Boolean(estilo.lineasOcultas?.[l.id]) ||
                        (l.id === "borde_exterior" && Boolean(estilo.ocultarBordeExterior)) ||
                        (l.id === "divisoria_central" && Boolean(estilo.ocultarLineaDivisoriaCentral)) ||
                        ((l.id === "cajas_specs" || l.id === "cajas_feats") && Boolean(estilo.ocultarBordeCajas)) ||
                        (Boolean(estilo.ocultarLineasFilas) &&
                          l.id !== "borde_exterior" &&
                          l.id !== "divisoria_central" &&
                          l.id !== "cajas_specs" &&
                          l.id !== "cajas_feats");

                      return (
                        <label
                          key={l.id}
                          className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition ${
                            ocultada
                              ? "border-red-300/40 bg-red-500/10 text-muted line-through"
                              : "border-border bg-surface text-ink hover:bg-surface-hover"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={ocultada ? "text-red-500 font-bold" : "text-accent font-bold"}>
                              {ocultada ? "✕" : "✓"}
                            </span>
                            <span className={ocultada ? "opacity-60" : ""}>{l.label}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={!ocultada}
                            onChange={(e) => {
                              const activa = e.target.checked;
                              const nextOcultas = { ...(estilo.lineasOcultas || {}) };
                              if (activa) {
                                delete nextOcultas[l.id];
                              } else {
                                nextOcultas[l.id] = true;
                              }
                              onPatchEstilo({
                                lineasOcultas: nextOcultas,
                                ...(l.id === "borde_exterior" ? { ocultarBordeExterior: !activa } : {}),
                                ...(l.id === "divisoria_central" ? { ocultarLineaDivisoriaCentral: !activa } : {}),
                              });
                            }}
                            className="h-3.5 w-3.5 rounded border-border accent-accent"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "relleno" && (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">Estilo de fondo de cajas</p>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => onPatchEstilo({ modoRellenoCajas: "transparente" })}
                  className={`rounded-lg border px-2.5 py-1.5 text-left font-medium ${
                    (estilo.modoRellenoCajas ?? "transparente") === "transparente"
                      ? "border-accent bg-accent/15 text-accent font-bold"
                      : "border-border bg-surface text-ink hover:bg-surface-hover"
                  }`}
                >
                  ◻️ Transparente
                  <span className="block text-[10px] font-normal text-muted">Solo contorno</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPatchEstilo({ modoRellenoCajas: "solido" })}
                  className={`rounded-lg border px-2.5 py-1.5 text-left font-medium ${
                    estilo.modoRellenoCajas === "solido"
                      ? "border-accent bg-accent text-white font-bold"
                      : "border-border bg-surface text-ink hover:bg-surface-hover"
                  }`}
                >
                  ⬛ Sólido
                  <span className="block text-[10px] font-normal opacity-80">Tinta corporativa</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPatchEstilo({ modoRellenoCajas: "suave" })}
                  className={`rounded-lg border px-2.5 py-1.5 text-left font-medium ${
                    estilo.modoRellenoCajas === "suave"
                      ? "border-accent bg-accent/15 text-accent font-bold"
                      : "border-border bg-surface text-ink hover:bg-surface-hover"
                  }`}
                >
                  🌫️ Suave
                  <span className="block text-[10px] font-normal text-muted">Tinte al 12%</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPatchEstilo({ modoRellenoCajas: "personalizado" })}
                  className={`rounded-lg border px-2.5 py-1.5 text-left font-medium ${
                    estilo.modoRellenoCajas === "personalizado"
                      ? "border-accent bg-accent/15 text-accent font-bold"
                      : "border-border bg-surface text-ink hover:bg-surface-hover"
                  }`}
                >
                  🎨 Personalizado
                  <span className="block text-[10px] font-normal text-muted">Elegir color</span>
                </button>
              </div>
            </div>

            {estilo.modoRellenoCajas === "personalizado" && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
                <input
                  type="color"
                  value={estilo.colorFondoCajas || color}
                  onChange={(e) => onPatchEstilo({ colorFondoCajas: e.target.value })}
                  className="h-7 w-7 cursor-pointer rounded border border-border p-0"
                />
                <span className="text-xs text-ink font-medium">Color de relleno de cajas</span>
                <span className="ml-auto font-mono text-[11px] text-muted">
                  {estilo.colorFondoCajas || color}
                </span>
              </div>
            )}
          </div>
        )}

        {tab === "iconos" && (
          <>
            <SliderEstilo
              label="Iconos de atributos (burbujas, gota, etc.)"
              value={estilo.tamIconos}
              onChange={(v) => onPatchEstilo({ tamIconos: v })}
            />
            <SliderEstilo
              label="Iconos de franjas (Aplicaciones e Incorporación)"
              value={estilo.tamIconosBandas ?? 1}
              onChange={(v) => onPatchEstilo({ tamIconosBandas: v })}
            />
            <SliderEstilo
              label="Icono de Almacenamiento (frasco)"
              value={estilo.tamIconoAlmacen ?? 1}
              onChange={(v) => onPatchEstilo({ tamIconoAlmacen: v })}
            />
            <SliderEstilo
              label="Pictograma GHS / Rombo de advertencia"
              value={estilo.tamGhs ?? 1}
              onChange={(v) => onPatchEstilo({ tamGhs: v })}
            />
            <SliderEstilo
              label="Código de barras EAN-13"
              value={estilo.tamEan ?? 1}
              onChange={(v) => onPatchEstilo({ tamEan: v })}
            />
          </>
        )}

        {tab === "textos" && (
          <>
            <SliderEstilo
              label="Título / Sigla principal (SCI)"
              value={estilo.tipoTitulo}
              onChange={(v) => onPatchEstilo({ tipoTitulo: v })}
            />
            <SliderEstilo
              label="Nombre del producto"
              value={estilo.tipoNombre}
              onChange={(v) => onPatchEstilo({ tipoNombre: v })}
            />
            <SliderEstilo
              label="Cuerpo / Descripciones / Tagline"
              value={estilo.tipoCuerpo}
              onChange={(v) => onPatchEstilo({ tipoCuerpo: v })}
            />
            <SliderEstilo
              label="Texto interno de cajas (concentración, CAS, atributos)"
              value={estilo.tipoCajas}
              onChange={(v) => onPatchEstilo({ tipoCajas: v })}
            />
            <SliderEstilo
              label="Texto de advertencia y precauciones"
              value={estilo.tipoAdvertencia ?? 1}
              onChange={(v) => onPatchEstilo({ tipoAdvertencia: v })}
            />
            <SliderEstilo
              label="Marca y Contenido neto"
              value={estilo.tipoMarca ?? 1}
              onChange={(v) => onPatchEstilo({ tipoMarca: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function BarraEdicionTexto({
  campoId,
  estilo,
  onPatchCampo,
}: {
  campoId: CampoTextoFichaMp;
  estilo: EstiloFichaMp;
  onPatchCampo: (id: CampoTextoFichaMp, patch: { escala?: number; bold?: boolean }) => void;
}) {
  const meta = CAMPOS_TEXTO_FICHA_MP.find((c) => c.id === campoId);
  const st = estiloCampoFichaMp(estilo, campoId);
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 shadow-sm backdrop-blur-sm">
      <span className="text-[11px] font-semibold text-ink">
        Editando · {meta?.label || campoId}
      </span>
      <span className="h-4 w-px bg-border" aria-hidden />
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Reducir tamaño"
          onClick={() => onPatchCampo(campoId, { escala: Math.max(0.5, Math.round((st.escala - 0.05) * 100) / 100) })}
          className="rounded border border-border bg-surface px-2 py-0.5 text-sm font-bold text-ink hover:bg-surface-hover"
        >
          −
        </button>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          <span className="tabular-nums text-ink">{Math.round(st.escala * 100)}%</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={st.escala}
            onChange={(e) => onPatchCampo(campoId, { escala: Number(e.target.value) })}
            className="w-24 accent-accent"
            aria-label="Tamaño del texto"
          />
        </label>
        <button
          type="button"
          title="Aumentar tamaño"
          onClick={() => onPatchCampo(campoId, { escala: Math.min(2, Math.round((st.escala + 0.05) * 100) / 100) })}
          className="rounded border border-border bg-surface px-2 py-0.5 text-sm font-bold text-ink hover:bg-surface-hover"
        >
          +
        </button>
      </div>
      <button
        type="button"
        title="Negrita"
        aria-pressed={st.bold}
        onClick={() => onPatchCampo(campoId, { bold: !st.bold })}
        className={`rounded border px-2.5 py-0.5 text-sm font-bold ${
          st.bold
            ? "border-accent bg-accent text-white"
            : "border-border bg-surface text-ink hover:bg-surface-hover"
        }`}
      >
        B
      </button>
    </div>
  );
}

function CampoFormulario({
  id,
  activo,
  onActivar,
  children,
}: {
  id: CampoTextoFichaMp;
  activo: boolean;
  onActivar: (id: CampoTextoFichaMp) => void;
  children: ReactNode;
}) {
  return (
    <div
      onFocusCapture={() => onActivar(id)}
      className={`rounded-lg transition ${activo ? "ring-2 ring-accent/50" : ""}`}
    >
      {children}
    </div>
  );
}

function IconoGotaHoja() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 6C32 6 14 28 14 40a18 18 0 0 0 36 0C50 28 32 6 32 6z" />
      <path d="M32 24c-7 8-6 16 0 24 6-8 7-16 0-24z" />
      <path d="M32 28v16" />
    </svg>
  );
}

function IconoBurbujas() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="22" cy="40" r="11" />
      <circle cx="40" cy="28" r="9" />
      <circle cx="50" cy="44" r="6" />
    </svg>
  );
}

function IconoMatraz() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M26 6h12v16l12 26a10 10 0 0 1-9 14H23a10 10 0 0 1-9-14L26 22z" />
      <path d="M24 22h16" />
    </svg>
  );
}

function IconoMortero() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="30" cy="40" rx="18" ry="8" />
      <path d="M12 40v6c0 6 8 12 18 12s18-6 18-12v-6" />
      <path d="M48 10 L30 36" />
    </svg>
  );
}

function IconoFrasco() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="20" y="20" width="24" height="34" rx="4" />
      <rect x="24" y="10" width="16" height="12" rx="2" />
    </svg>
  );
}

type SlotIconoFicha =
  | "feat0"
  | "feat1"
  | "feat2"
  | "aplicaciones"
  | "incorporacion"
  | "almacenamiento";

function ImgAuth({
  src,
  className,
  alt = "",
}: {
  src: string;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState(() =>
    src.startsWith("data:") || src.startsWith("blob:") ? src : "",
  );
  useEffect(() => {
    let cancel = false;
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      setUrl(src);
      return;
    }
    setUrl("");
    void resolverUrlImagenCanvas(src)
      .then((u) => {
        if (!cancel) setUrl(u);
      })
      .catch(() => {
        if (!cancel) setUrl("");
      });
    return () => {
      cancel = true;
    };
  }, [src]);
  if (!url) {
    return <span className={className} aria-hidden style={{ display: "block", background: "#eee" }} />;
  }
  return <img src={url} alt={alt} className={className} draggable={false} />;
}

function BotonSustituir({
  label,
  onClick,
  onQuitar,
  activo,
}: {
  label: string;
  onClick: () => void;
  onQuitar?: () => void;
  activo?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <button
        type="button"
        onClick={onClick}
        className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${
          activo
            ? "border-accent bg-accent/10 text-accent"
            : "border-border text-muted hover:border-accent hover:text-ink"
        }`}
      >
        {label}
      </button>
      {activo && onQuitar ? (
        <button
          type="button"
          onClick={onQuitar}
          className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:text-ink"
        >
          Quitar
        </button>
      ) : null}
    </div>
  );
}

function EtiquetaMpHtml({
  datos,
  color,
  anchoMm,
  altoMm,
  estilo,
  campoActivo,
  onActivarCampo,
  onElegirIcono,
  onElegirGhs,
  onElegirEan,
  etiquetaRef,
}: {
  datos: DatosFichaTecnicaMp;
  color: string;
  anchoMm: number;
  altoMm: number;
  estilo: EstiloFichaMp;
  campoActivo?: CampoTextoFichaMp | null;
  onActivarCampo?: (id: CampoTextoFichaMp) => void;
  onElegirIcono?: (slot: SlotIconoFicha) => void;
  onElegirGhs?: () => void;
  onElegirEan?: () => void;
  etiquetaRef?: Ref<HTMLElement>;
}) {
  const printW = mmToPx(anchoMm, CANVAS_DPI);
  const printH = mmToPx(altoMm, CANVAS_DPI);
  const designW = mmToPx(DIAGRAMA_ANCHO_MM, CANVAS_DPI);
  const designH = mmToPx(DIAGRAMA_ALTO_MM, CANVAS_DPI);
  const fit = Math.min(printW / designW, printH / designH);
  const ean = generarEAN13(datos.ean13);
  const feats = datos.features.slice(0, 3);
  const vacia = esFichaMpVacia(datos);

  const colorRgb = hexToRgb(color);
  let bgCajas = "transparent";
  let txtCajas = "var(--c)";
  let borderCajasColor = "var(--c)";

  if (estilo.modoRellenoCajas === "solido") {
    bgCajas = color;
    txtCajas = "#ffffff";
    borderCajasColor = color;
  } else if (estilo.modoRellenoCajas === "suave") {
    bgCajas = `rgba(${colorRgb}, 0.12)`;
    txtCajas = "var(--c)";
    borderCajasColor = "var(--c)";
  } else if (estilo.modoRellenoCajas === "personalizado" && estilo.colorFondoCajas) {
    bgCajas = estilo.colorFondoCajas;
    txtCajas = "var(--c)";
    borderCajasColor = "var(--c)";
  }

  if (vacia) {
    return (
      <div
        ref={etiquetaRef as Ref<HTMLDivElement>}
        className="ficha-mp-sheet"
        style={{
          width: printW,
          height: printH,
          background: "#ffffff",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
          border: "2px dashed #94a3b8",
          position: "relative",
          userSelect: "none",
        }}
      >
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f8fafc] text-3xl shadow-inner">
            📄
          </div>
          <span className="text-sm font-bold uppercase tracking-wider text-[#1e293b]">
            Lienzo en blanco
          </span>
          <span className="mt-0.5 text-xs text-[#64748b] font-semibold">
            {anchoMm}×{altoMm} mm
          </span>
          <p className="mt-2 max-w-[260px] text-[11px] text-[#475569] leading-relaxed">
            Adjunta una foto o pega (<kbd className="rounded border border-[#cbd5e1] bg-[#f1f5f9] px-1 py-0.5 font-mono text-[10px] text-[#0f172a]">Ctrl+V</kbd>) una etiqueta para abstraer sus elementos automáticamente con IA.
          </p>
        </div>
      </div>
    );
  }

  const txt = (
    id: CampoTextoFichaMp,
    base: number,
    grupo: "--tt" | "--tn" | "--tc" | "--tx" | "--tw" | "--tm" = "--tc",
  ): CSSProperties => {
    const st = estiloCampoFichaMp(estilo, id);
    return {
      fontSize: `calc(${base} * var(--u) * var(${grupo}) * ${st.escala})`,
      fontWeight: st.bold ? 800 : 400,
      outline: campoActivo === id ? "1.5px dashed var(--c)" : undefined,
      outlineOffset: "1px",
      cursor: onActivarCampo ? "pointer" : undefined,
    };
  };
  const clickCampo = (id: CampoTextoFichaMp) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onActivarCampo?.(id);
  };

  const estaOculta = (id: LineaIndividualFichaMp) => {
    if (estilo.lineasOcultas?.[id]) return true;
    if (id === "borde_exterior" && estilo.ocultarBordeExterior) return true;
    if (id === "divisoria_central" && estilo.ocultarLineaDivisoriaCentral) return true;
    if ((id === "cajas_specs" || id === "cajas_feats") && estilo.ocultarBordeCajas) return true;
    if (
      (id === "tagline" ||
        id === "specs" ||
        id === "desc" ||
        id === "feats" ||
        id === "aplicaciones" ||
        id === "incorporacion" ||
        id === "peso" ||
        id === "marca" ||
        id === "atencion" ||
        id === "almacenamiento") &&
      estilo.ocultarLineasFilas
    ) {
      return true;
    }
    return false;
  };

  const borderFila = (id: LineaIndividualFichaMp) => (estaOculta(id) ? "none" : "1px solid var(--c)");
  const borderBox = (id: "cajas_specs" | "cajas_feats") =>
    estaOculta(id) ? "none" : "calc(1.15px * var(--tborder)) solid var(--border-cajas)";
  const borderExt = estaOculta("borde_exterior") ? "none" : "calc(1.4px * var(--tborder)) solid var(--c)";
  const borderCenter = estaOculta("divisoria_central") ? "none" : "calc(1.1px * var(--tborder)) solid var(--c)";

  return (
    <div
      ref={etiquetaRef as Ref<HTMLDivElement>}
      className="ficha-mp-sheet"
      style={{ width: printW, height: printH, background: "#fff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: designW * fit, height: designH * fit, position: "relative", flexShrink: 0 }}>
        <article
          className="ficha-mp-label"
          style={
            {
              "--c": color,
              "--c-rgb": colorRgb,
              "--bg-cajas": bgCajas,
              "--txt-cajas": txtCajas,
              "--border-cajas": borderCajasColor,
              "--border-ext": borderExt,
              "--border-center": borderCenter,
              "--border-tagline": borderFila("tagline"),
              "--border-specs": borderFila("specs"),
              "--border-desc": borderFila("desc"),
              "--border-feats": borderFila("feats"),
              "--border-apps": borderFila("aplicaciones"),
              "--border-inc": borderFila("incorporacion"),
              "--border-peso": borderFila("peso"),
              "--border-marca": borderFila("marca"),
              "--border-atencion": borderFila("atencion"),
              "--border-almacen": borderFila("almacenamiento"),
              "--border-box-specs": borderBox("cajas_specs"),
              "--border-box-feats": borderBox("cajas_feats"),
              "--tt": estilo.tipoTitulo,
              "--tn": estilo.tipoNombre,
              "--tc": estilo.tipoCuerpo,
              "--tx": estilo.tipoCajas,
              "--tw": estilo.tipoAdvertencia ?? 1,
              "--tm": estilo.tipoMarca ?? 1,
              "--ti": estilo.tamIconos,
              "--tib": estilo.tamIconosBandas ?? 1,
              "--tia": estilo.tamIconoAlmacen ?? 1,
              "--tb": estilo.tamCajas,
              "--tr": estilo.radioCajas,
              "--tborder": estilo.bordeCajas ?? 1,
              "--tghs": estilo.tamGhs ?? 1,
              "--tean": estilo.tamEan ?? 1,
              "--u": `${designH / 100}px`,
              "--uw": `${designW / 100}px`,
              width: designW,
              height: designH,
              transform: `scale(${fit})`,
              transformOrigin: "top left",
              fontFamily: '"Montserrat", system-ui, sans-serif',
            } as CSSProperties
          }
        >
          <style>{`
            .ficha-mp-label {
              box-sizing: border-box;
              display: grid;
              grid-template-columns: 1.95fr 1fr;
              background: #fff;
              color: #1a1a1a;
              border: var(--border-ext);
              border-radius: calc(0.9 * var(--u) * var(--tr));
              overflow: hidden;
            }
            .ficha-mp-label * { box-sizing: border-box; min-width: 0; min-height: 0; }
            .ficha-mp-left, .ficha-mp-right {
              padding: calc(2.2 * var(--u)) calc(2.2 * var(--uw));
              display: grid;
              overflow: hidden;
            }
            .ficha-mp-left {
              border-right: var(--border-center);
              grid-template-rows: 12.5% 6.8% 5.2% 11.2% 9.5% 17.5% 12% 13.5% 11.8%;
            }
            .ficha-mp-right {
              grid-template-rows: 9% 34% 15% 17% 25%;
            }
            .ficha-mp-abbr {
              margin: 0; color: var(--c); font-weight: 800;
              font-size: calc(10.6 * var(--u) * var(--tt));
              letter-spacing: -0.04em; text-align: center; line-height: 0.9;
              display: flex; align-items: flex-end; justify-content: center;
            }
            .ficha-mp-name {
              margin: 0; color: var(--c); font-weight: 700;
              font-size: calc(3.15 * var(--u) * var(--tn));
              text-align: center; line-height: 1.12; text-transform: uppercase;
              display: flex; align-items: center; justify-content: center;
            }
            .ficha-mp-tag {
              margin: 0; color: var(--c); font-weight: 500;
              font-size: calc(2.05 * var(--u) * var(--tc));
              text-align: center; line-height: 1.15;
              display: flex; align-items: center; justify-content: center;
              border-bottom: var(--border-tagline);
            }
            .ficha-mp-specs {
              display: grid; grid-template-columns: 1fr 1fr;
              gap: calc(1.1 * var(--uw));
              align-content: center;
              border-bottom: var(--border-specs);
              padding: calc(0.6 * var(--u)) 0;
            }
            .ficha-mp-spec {
              border: var(--border-box-specs);
              border-radius: calc(1.15 * var(--u) * var(--tr));
              text-align: center; color: var(--txt-cajas);
              background: var(--bg-cajas);
              padding: calc(0.55 * var(--u) * var(--tb)) calc(0.4 * var(--uw));
              display: flex; flex-direction: column; justify-content: center;
              transition: all 0.15s ease;
            }
            .ficha-mp-spec small {
              display: block; font-weight: 700; letter-spacing: 0.04em;
              color: var(--txt-cajas);
              font-size: calc(1.55 * var(--u) * var(--tx));
            }
            .ficha-mp-spec b {
              font-size: calc(2.45 * var(--u) * var(--tx));
              font-weight: 800;
              color: var(--txt-cajas);
            }
            .ficha-mp-desc {
              margin: 0; font-weight: 400; text-align: center; color: #222;
              font-size: calc(2.05 * var(--u) * var(--tc));
              line-height: 1.25; overflow: hidden;
              display: flex; align-items: center; justify-content: center;
              border-bottom: var(--border-desc);
              padding: calc(0.4 * var(--u)) calc(0.4 * var(--uw));
            }
            .ficha-mp-feats {
              display: grid; grid-template-columns: 1fr 1fr 1fr;
              gap: calc(0.9 * var(--uw));
              align-content: center;
              border-bottom: var(--border-feats);
              padding: calc(0.55 * var(--u)) 0;
            }
            .ficha-mp-feat {
              border: var(--border-box-feats);
              border-radius: calc(1.05 * var(--u) * var(--tr));
              text-align: center; color: var(--txt-cajas);
              background: var(--bg-cajas);
              padding: calc(0.45 * var(--u) * var(--tb)) calc(0.25 * var(--uw));
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              transition: all 0.15s ease;
            }
            .ficha-mp-feat svg {
              width: calc(4.8 * var(--u) * var(--ti)); max-width: 100%; height: auto; margin: 0 0 calc(0.25 * var(--u)); display: block;
              stroke: var(--txt-cajas);
              color: var(--txt-cajas);
            }
            .ficha-mp-icon-img {
              width: calc(4.8 * var(--u) * var(--ti)); height: calc(4.8 * var(--u) * var(--ti));
              object-fit: contain; margin: 0 0 calc(0.25 * var(--u)); display: block;
            }
            .ficha-mp-ghs-img {
              width: calc(9.2 * var(--u) * var(--tghs)); height: calc(9.2 * var(--u) * var(--tghs));
              object-fit: contain; margin: 0 auto calc(0.3 * var(--u)); display: block;
              cursor: pointer;
            }
            .ficha-mp-feat span {
              display: block; font-weight: 700; line-height: 1.12;
              color: var(--txt-cajas);
              font-size: calc(1.42 * var(--u) * var(--tx));
            }
            .ficha-mp-ph {
              font-weight: 800; line-height: 0.95;
              font-size: calc(5.0 * var(--u) * var(--ti)); color: var(--txt-cajas);
            }
            .ficha-mp-band {
              display: grid; grid-template-columns: calc(4.6 * var(--u) * var(--tib)) 1fr;
              gap: calc(0.9 * var(--uw)); align-items: center;
              border-bottom: var(--border-apps);
              padding: calc(0.35 * var(--u)) 0;
            }
            .ficha-mp-band-inc {
              border-bottom: var(--border-inc);
            }
            .ficha-mp-band svg { width: calc(4.6 * var(--u) * var(--tib)); max-width: 100%; height: auto; color: var(--c); }
            .ficha-mp-band .ficha-mp-icon-img {
              width: calc(4.6 * var(--u) * var(--tib)); height: calc(4.6 * var(--u) * var(--tib));
              object-fit: contain; margin: 0;
            }
            .ficha-mp-band-txt { text-align: center; }
            .ficha-mp-band h3 {
              margin: 0; color: var(--c); font-weight: 800;
              font-size: calc(2.05 * var(--u) * var(--tx)); line-height: 1.1;
            }
            .ficha-mp-band p {
              margin: calc(0.12 * var(--u)) 0 0; font-weight: 400; color: #222;
              font-size: calc(1.7 * var(--u) * var(--tc)); line-height: 1.18;
            }
            .ficha-mp-peso {
              display: grid; grid-template-columns: 1fr auto 1fr;
              align-items: center; gap: calc(1.2 * var(--uw));
            }
            .ficha-mp-peso i { border-top: var(--border-peso); height: 0; display: block; }
            .ficha-mp-peso span {
              background: var(--c); color: #fff; border-radius: calc(999px * var(--tr));
              font-weight: 800; font-size: calc(2.85 * var(--u) * var(--tn) * var(--tm));
              padding: calc(0.35 * var(--u) * var(--tb)) calc(1.6 * var(--uw));
              white-space: nowrap;
            }
            .ficha-mp-brand {
              color: var(--c); font-weight: 800; text-align: center;
              font-size: calc(2.45 * var(--u) * var(--tn) * var(--tm)); line-height: 1.1;
              display: flex; align-items: center; justify-content: center;
              border-bottom: var(--border-marca);
            }
            .ficha-mp-warn {
              text-align: center;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              border-bottom: var(--border-atencion);
              padding: calc(0.3 * var(--u) * var(--tb)) 0;
              gap: calc(0.15 * var(--u));
            }
            .ficha-mp-diamond {
              width: calc(7.2 * var(--u) * var(--tghs)); height: calc(7.2 * var(--u) * var(--tghs));
              margin: 0 auto calc(0.3 * var(--u)); transform: rotate(45deg);
              border: calc(1.7px * var(--tborder)) solid #c41e3a; position: relative; flex-shrink: 0;
            }
            .ficha-mp-diamond i {
              position: absolute; inset: 0; transform: rotate(-45deg); font-style: normal;
              font-weight: 800; display: flex; align-items: center; justify-content: center;
              font-size: 1.15em; color: #111;
            }
            .ficha-mp-attn {
              color: var(--c); font-weight: 800;
              font-size: calc(2.2 * var(--u) * var(--tn) * var(--tw));
            }
            .ficha-mp-warn p {
              margin: 0; font-weight: 400; color: #222;
              font-size: calc(1.62 * var(--u) * var(--tc) * var(--tw)); line-height: 1.2;
            }
            .ficha-mp-store {
              border-bottom: var(--border-almacen);
              padding: calc(0.4 * var(--u) * var(--tb)) 0;
              display: grid; grid-template-columns: calc(4.2 * var(--u) * var(--tia)) 1fr;
              gap: calc(0.7 * var(--uw)); align-items: center;
              font-size: calc(1.62 * var(--u) * var(--tc)); line-height: 1.2; color: #222;
            }
            .ficha-mp-store svg { width: calc(4.2 * var(--u) * var(--tia)); max-width: 100%; height: auto; color: var(--c); }
            .ficha-mp-store .ficha-mp-icon-img {
              width: calc(4.2 * var(--u) * var(--tia)); height: calc(4.2 * var(--u) * var(--tia));
              object-fit: contain; margin: 0;
            }
            .ficha-mp-meta {
              text-align: center; font-weight: 400; color: #222;
              font-size: calc(1.52 * var(--u) * var(--tc)); line-height: 1.34;
              overflow: hidden;
              display: flex; flex-direction: column; justify-content: center;
              padding: calc(0.2 * var(--u)) 0;
            }
            .ficha-mp-meta b { color: var(--c); font-weight: 800; }
            .ficha-mp-ean {
              width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
              overflow: hidden; padding: calc(0.2 * var(--u)) 0;
            }
            .ficha-mp-ean img {
              width: 100%; height: auto; max-height: 100%; object-fit: contain; object-position: center;
              transform: scale(var(--tean));
              transform-origin: center center;
            }
          `}</style>
          <div className="ficha-mp-left">
            <p
              className="ficha-mp-abbr"
              style={txt("abreviatura", 10.6, "--tt")}
              onClick={clickCampo("abreviatura")}
            >
              {datos.abreviatura || ""}
            </p>
            <h2
              className="ficha-mp-name"
              style={txt("nombre", 3.15, "--tn")}
              onClick={clickCampo("nombre")}
            >
              {datos.nombre || ""}
            </h2>
            <p
              className="ficha-mp-tag"
              style={txt("tagline", 2.05, "--tc")}
              onClick={clickCampo("tagline")}
            >
              {datos.tagline || ""}
            </p>
            <div className="ficha-mp-specs">
              <div className="ficha-mp-spec" onClick={clickCampo("concentracion")}>
                <small style={txt("concentracion", 1.55, "--tx")}>{datos.concentracionLabel}</small>
                <b style={txt("concentracion", 2.45, "--tx")}>
                  {datos.concentracionValor || ""}
                </b>
              </div>
              <div className="ficha-mp-spec" onClick={clickCampo("cas")}>
                <small style={txt("cas", 1.55, "--tx")}>{datos.casLabel}</small>
                <b style={txt("cas", 2.45, "--tx")}>
                  {datos.cas || ""}
                </b>
              </div>
            </div>
            <p
              className="ficha-mp-desc"
              style={txt("descripcion", 2.05, "--tc")}
              onClick={clickCampo("descripcion")}
            >
              {datos.descripcion || ""}
            </p>
            <div className="ficha-mp-feats">
              {feats.map((f, i) => {
                const cid = (`feat${i}` as CampoTextoFichaMp);
                const slot = (`feat${i}` as SlotIconoFicha);
                return (
                  <div key={f.titulo || i} className="ficha-mp-feat" onClick={clickCampo(cid)}>
                    <button
                      type="button"
                      title="Cambiar icono desde galería"
                      className="border-0 bg-transparent p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onElegirIcono?.(slot);
                      }}
                    >
                      {f.iconoSrc ? (
                        <ImgAuth src={f.iconoSrc} className="ficha-mp-icon-img" />
                      ) : f.icono === "ph" ? (
                        <div className="ficha-mp-ph">{f.subtitulo || "pH"}</div>
                      ) : f.icono === "gota" ? (
                        <IconoGotaHoja />
                      ) : (
                        <IconoBurbujas />
                      )}
                    </button>
                    <span style={txt(cid, 1.42, "--tx")}>
                      {f.titulo || ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="ficha-mp-band" onClick={clickCampo("aplicaciones")}>
              <button
                type="button"
                title="Cambiar icono desde galería"
                className="border-0 bg-transparent p-0 text-[inherit]"
                onClick={(e) => {
                  e.stopPropagation();
                  onElegirIcono?.("aplicaciones");
                }}
              >
                {datos.iconoAplicacionesSrc ? (
                  <ImgAuth src={datos.iconoAplicacionesSrc} className="ficha-mp-icon-img" />
                ) : (
                  <IconoMatraz />
                )}
              </button>
              <div className="ficha-mp-band-txt">
                <h3 style={txt("aplicaciones", 2.05, "--tx")}>{datos.aplicacionesTitulo}</h3>
                <p style={txt("aplicaciones", 1.7, "--tc")}>
                  {datos.aplicaciones || ""}
                </p>
              </div>
            </div>
            <div className="ficha-mp-band ficha-mp-band-inc" onClick={clickCampo("incorporacion")}>
              <button
                type="button"
                title="Cambiar icono desde galería"
                className="border-0 bg-transparent p-0 text-[inherit]"
                onClick={(e) => {
                  e.stopPropagation();
                  onElegirIcono?.("incorporacion");
                }}
              >
                {datos.iconoIncorporacionSrc ? (
                  <ImgAuth src={datos.iconoIncorporacionSrc} className="ficha-mp-icon-img" />
                ) : (
                  <IconoMortero />
                )}
              </button>
              <div className="ficha-mp-band-txt">
                <h3 style={txt("incorporacion", 2.05, "--tx")}>{datos.incorporacionTitulo}</h3>
                <p style={txt("incorporacion", 1.7, "--tc")}>
                  {datos.incorporacion || ""}
                </p>
              </div>
            </div>
            <div className="ficha-mp-peso" onClick={clickCampo("peso")}>
              <i />
              <span style={txt("peso", 2.85, "--tn")}>{datos.peso || "250 g"}</span>
              <i />
            </div>
          </div>
          <div className="ficha-mp-right">
            <div
              className="ficha-mp-brand"
              style={txt("marca", 2.35, "--tn")}
              onClick={clickCampo("marca")}
            >
              {datos.marca}
            </div>
            <div className="ficha-mp-warn" onClick={clickCampo("atencion")}>
              <button
                type="button"
                title="Cambiar pictograma GHS"
                className="border-0 bg-transparent p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onElegirGhs?.();
                }}
              >
                {datos.ghsSrc ? (
                  <ImgAuth src={datos.ghsSrc} className="ficha-mp-ghs-img" alt={datos.ghsCodigo || "GHS"} />
                ) : (
                  <div className="ficha-mp-diamond"><i>!</i></div>
                )}
              </button>
              <div className="ficha-mp-attn" style={txt("atencion", 2.2, "--tn")}>{datos.atencionTitulo}</div>
              <p style={txt("atencion", 1.62, "--tc")}>
                {datos.atencionTexto || ""}
              </p>
            </div>
            <div className="ficha-mp-store" onClick={clickCampo("almacenamiento")}>
              <button
                type="button"
                title="Cambiar icono desde galería"
                className="border-0 bg-transparent p-0 text-[inherit]"
                onClick={(e) => {
                  e.stopPropagation();
                  onElegirIcono?.("almacenamiento");
                }}
              >
                {datos.iconoAlmacenamientoSrc ? (
                  <ImgAuth src={datos.iconoAlmacenamientoSrc} className="ficha-mp-icon-img" />
                ) : (
                  <IconoFrasco />
                )}
              </button>
              <div style={txt("almacenamiento", 1.62, "--tc")}>
                {datos.almacenamiento || ""}
              </div>
            </div>
            <div className="ficha-mp-meta">
              {datos.desarrolladoPor}
              <br />
              <b>{datos.empresa}</b>
              <br />
              {datos.nit}
              <br />
              <b>{datos.ciudad}</b>
              <br />
              <b>{datos.web}</b>
            </div>
            <button
              type="button"
              title="Elegir código EAN de la biblioteca"
              className="ficha-mp-ean border-0 bg-transparent p-0"
              style={{ width: "100%", height: "100%", cursor: onElegirEan ? "pointer" : undefined }}
              onClick={(e) => {
                e.stopPropagation();
                onElegirEan?.();
              }}
            >
              {ean ? (
                <img className="ficha-mp-ean" alt="" src={svgToDataUrl(ean.svg)} />
              ) : (
                <span className="block text-center text-[10px] text-[#888]">Elegir EAN</span>
              )}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

export default function FichaMpDiligenciarPanel({
  onVolver,
  inicial,
  onGuardada,
}: {
  onVolver: () => void;
  inicial?: PlantillaVisualDoc | null;
  onGuardada?: (doc: PlantillaVisualDoc) => void;
}) {
  const { data: tiposData } = useTiposEtiqueta();
  const tipos = useMemo(() => {
    const list = tiposData?.tipos?.length ? tiposData.tipos : [FICHA_MP_TIPO];
    if (!list.some((t) => t.nombre === FICHA_MP_TIPO.nombre)) {
      return [FICHA_MP_TIPO, ...list];
    }
    return list;
  }, [tiposData?.tipos]);

  const parsed = inicial ? parsearFichaMpDePlantilla(inicial) : null;
  const [pasoInicial, setPasoInicial] = useState<"scan" | "editor">(() => (inicial ? "editor" : "scan"));
  const [capturaRefUrl, setCapturaRefUrl] = useState<string | null>(null);
  const [modoComparacion, setModoComparacion] = useState<"diagrama" | "lado_a_lado" | "superpuesta" | "solo_captura">("diagrama");
  const [opacidadSuperposicion, setOpacidadSuperposicion] = useState(0.5);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plantillaId, setPlantillaId] = useState(inicial?.id || "");
  const [nombrePlantilla, setNombrePlantilla] = useState(
    inicial?.nombre || "Etiqueta MP",
  );
  const [tipoNombre, setTipoNombre] = useState(parsed?.tipoNombre || "250 g");
  const tipo = tipos.find((t) => t.nombre === tipoNombre)
    ?? tipos.find((t) => t.nombre === "250 g")
    ?? FICHA_MP_TIPO;
  const [color, setColor] = useState(parsed?.color || COLOR_FICHA_MP_DEFAULT);
  const [datos, setDatos] = useState<DatosFichaTecnicaMp>(
    () => parsed?.datos || crearDatosFichaMpVacios(parsed?.tipoNombre || "250 g"),
  );
  const [escaneandoIA, setEscaneandoIA] = useState(false);
  const [estilo, setEstilo] = useState<EstiloFichaMp>(
    () => parsed?.estilo || ESTILO_FICHA_MP_DEFAULT,
  );
  const [campoActivo, setCampoActivo] = useState<CampoTextoFichaMp | null>(null);
  const [slotGaleria, setSlotGaleria] = useState<SlotIconoFicha | null>(null);
  const [slotIconosQuimica, setSlotIconosQuimica] = useState<SlotIconoFicha | null>(null);
  const [eanPicker, setEanPicker] = useState(false);
  const [ghsPicker, setGhsPicker] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [zoom, setZoom] = useState(1);
  const etiquetaRef = useRef<HTMLElement>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const zoomManualRef = useRef(false);

  const wPx = mmToPx(tipo.ancho_mm, CANVAS_DPI);
  const hPx = mmToPx(tipo.alto_mm, CANVAS_DPI);

  const ajustarZoom = useCallback(() => {
    const pane = previewPaneRef.current;
    if (!pane) return;
    const pad = 72;
    const next = Math.min((pane.clientWidth - pad) / wPx, (pane.clientHeight - pad) / hPx, ZOOM_MAX);
    setZoom(clampZoom(Number.isFinite(next) ? next : 1));
  }, [wPx, hPx]);

  useEffect(() => {
    zoomManualRef.current = false;
  }, [tipoNombre]);

  useLayoutEffect(() => {
    if (zoomManualRef.current) return;
    ajustarZoom();
  }, [ajustarZoom]);

  useEffect(() => {
    const pane = previewPaneRef.current;
    if (!pane) return;
    const ro = new ResizeObserver(() => {
      if (!zoomManualRef.current) ajustarZoom();
    });
    ro.observe(pane);
    return () => ro.disconnect();
  }, [ajustarZoom]);

  useEffect(() => {
    const pane = previewPaneRef.current;
    if (!pane) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomManualRef.current = true;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setZoom((z) => clampZoom(z * factor));
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, []);

  const setZoomManual = (next: number | ((z: number) => number)) => {
    zoomManualRef.current = true;
    setZoom((z) => clampZoom(typeof next === "function" ? next(z) : next));
  };

  const patch = (p: Partial<DatosFichaTecnicaMp>) => setDatos((d) => ({ ...d, ...p }));
  const patchFeat = (i: number, titulo: string) => {
    setDatos((d) => {
      const features = d.features.map((f, idx) => (idx === i ? { ...f, titulo } : f));
      return { ...d, features };
    });
  };
  const aplicarIconoGaleria = (src: string) => {
    const slot = slotGaleria || slotIconosQuimica;
    if (!slot) return;
    if (slot === "feat0" || slot === "feat1" || slot === "feat2") {
      const i = Number(slot.slice(4));
      setDatos((d) => {
        const features = d.features.map((f, idx) => (idx === i ? { ...f, iconoSrc: src } : f));
        return { ...d, features };
      });
    } else if (slot === "aplicaciones") {
      patch({ iconoAplicacionesSrc: src });
    } else if (slot === "incorporacion") {
      patch({ iconoIncorporacionSrc: src });
    } else if (slot === "almacenamiento") {
      patch({ iconoAlmacenamientoSrc: src });
    }
    setSlotGaleria(null);
    setSlotIconosQuimica(null);
  };
  const quitarIconoSlot = (slot: SlotIconoFicha) => {
    if (slot === "feat0" || slot === "feat1" || slot === "feat2") {
      const i = Number(slot.slice(4));
      setDatos((d) => ({
        ...d,
        features: d.features.map((f, idx) => {
          if (idx !== i) return f;
          const next = { ...f };
          delete next.iconoSrc;
          return next;
        }),
      }));
      return;
    }
    setDatos((d) => {
      const next = { ...d };
      if (slot === "aplicaciones") delete next.iconoAplicacionesSrc;
      if (slot === "incorporacion") delete next.iconoIncorporacionSrc;
      if (slot === "almacenamiento") delete next.iconoAlmacenamientoSrc;
      return next;
    });
  };
  const patchEstilo = (p: Partial<EstiloFichaMp>) => setEstilo((e) => fusionarEstiloFichaMp({ ...e, ...p }));
  const patchCampoEstilo = (id: CampoTextoFichaMp, patch: { escala?: number; bold?: boolean }) => {
    setEstilo((e) => {
      const actual = estiloCampoFichaMp(e, id);
      return fusionarEstiloFichaMp({
        ...e,
        campos: {
          ...e.campos,
          [id]: {
            escala: patch.escala ?? actual.escala,
            bold: patch.bold ?? actual.bold,
          },
        },
      });
    });
  };

  const procesarArchivoCaptura = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setMsg("El archivo seleccionado no es una imagen válida.");
        return;
      }
      const url = URL.createObjectURL(file);
      setCapturaRefUrl(url);
      setModoComparacion("lado_a_lado");
      setEscaneandoIA(true);
      setMsg("Analizando captura y extrayendo elementos con Visión IA…");

      try {
        // Enviar como Base64 para máxima compatibilidad
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        const b64Data = await base64Promise;

        let res: { ok: boolean; abstraccion?: any; error?: string } | null = null;
        try {
          res = await api.post<{ ok: boolean; abstraccion?: any; error?: string }>(
            "/api/plantillas-visuales/abstraer-etiqueta",
            { imagen_b64: b64Data },
            { timeoutMs: 45000 },
          );
        } catch (apiErr) {
          console.warn("API de visión falló o timeout, aplicando extracción de respaldo:", apiErr);
        }

        const abs = res?.ok && res.abstraccion ? res.abstraccion : {};
        const nuevosDatos: DatosFichaTecnicaMp = {
          abreviatura: abs.abreviatura || "SCI",
          nombre: abs.nombre || "COCOIL ISETIONATO DE SODIO",
          tagline: abs.tagline || "Tensioactivo suave • Materia prima cosmética",
          concentracionLabel: abs.concentracionLabel || "CONCENTRACIÓN",
          concentracionValor: abs.concentracionValor || "90%",
          casLabel: abs.casLabel || "CAS",
          cas: abs.cas || "61789-32-0",
          descripcion:
            abs.descripcion ||
            "Derivado de ácidos grasos del coco. Se presenta en polvo o gránulos de color blanco a crema.",
          features:
            Array.isArray(abs.features) && abs.features.length > 0
              ? abs.features.map((f: any, idx: number) => ({
                  titulo: f.titulo || (idx === 0 ? "ESPUMA CREMOSA" : idx === 1 ? "LIMPIEZA SUAVE" : "pH RECOMENDADO 5–7"),
                  icono: f.icono || (idx === 0 ? "burbujas" : idx === 1 ? "gota" : "ph"),
                  subtitulo: f.subtitulo || (idx === 2 ? "pH" : undefined),
                }))
              : [
                  { titulo: "ESPUMA CREMOSA", icono: "burbujas" },
                  { titulo: "LIMPIEZA SUAVE", icono: "gota" },
                  { titulo: "pH RECOMENDADO 5–7", icono: "ph", subtitulo: "pH" },
                ],
          aplicacionesTitulo: abs.aplicacionesTitulo || "APLICACIONES",
          aplicaciones: abs.aplicaciones || "Champú sólido • Barras syndet • Limpiadores faciales",
          incorporacionTitulo: abs.incorporacionTitulo || "INCORPORACIÓN",
          incorporacion:
            abs.incorporacion ||
            "Dispersar con agitación moderada. Para formulación; no aplicar directamente.",
          peso: abs.peso || tipo.nombre || "250 g",
          marca: abs.marca || "MCKENNA GROUP®",
          atencionTitulo: abs.atencionTitulo || "ATENCIÓN",
          atencionTexto:
            abs.atencionTexto ||
            "Puede causar irritación ocular y respiratoria por exposición al polvo. Evite inhalar y use protección adecuada.",
          almacenamiento:
            abs.almacenamiento || "Conservar bien cerrado, en lugar fresco, seco y protegido de la luz.",
          desarrolladoPor: abs.desarrolladoPor || "Desarrollado por:",
          empresa: abs.empresa || "MCKENNA GROUP S.A.S.",
          nit: abs.nit || "NIT. 901316016-3",
          ciudad: abs.ciudad || "BOGOTÁ — COLOMBIA",
          web: abs.web || "mckennagroup.co",
          ean13: abs.ean13 || "7701602502633",
        };

        setDatos(nuevosDatos);

        if (abs.color_primario && /^#[0-9a-fA-F]{3,8}$/.test(abs.color_primario)) {
          setColor(abs.color_primario);
        } else {
          setColor(COLOR_FICHA_MP_DEFAULT);
        }

        if (abs.peso) {
          const pLower = String(abs.peso).trim().toLowerCase();
          const match = tipos.find(
            (t) => t.nombre.toLowerCase() === pLower || pLower.includes(t.nombre.toLowerCase()),
          );
          if (match) {
            setTipoNombre(match.nombre);
          }
        }

        setNombrePlantilla(
          nuevosDatos.abreviatura
            ? `Etiqueta · ${nuevosDatos.abreviatura} (${nuevosDatos.peso || tipo.nombre})`
            : nuevosDatos.nombre || "Etiqueta MP",
        );

        setMsg("¡Abstracción completada! Elementos detectados y diagramados en el lienzo ✓");
        setTimeout(() => setMsg(null), 4000);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Error al procesar la imagen con IA");
      } finally {
        setEscaneandoIA(false);
      }
    },
    [tipos, tipo.nombre],
  );

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const file = imagenDesdePortapapeles(e.clipboardData);
      if (file) {
        e.preventDefault();
        procesarArchivoCaptura(file);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [procesarArchivoCaptura]);

  async function rasterizar(): Promise<Blob> {
    const el = etiquetaRef.current;
    if (!el) throw new Error("No hay vista previa");
    await document.fonts?.ready;
    const blob = await toBlob(el, {
      pixelRatio: 300 / CANVAS_DPI,
      backgroundColor: "#ffffff",
      cacheBust: true,
    });
    if (!blob) throw new Error("No se pudo generar el PNG");
    return blob;
  }

  async function descargar() {
    setExportando(true);
    setMsg(null);
    try {
      const blob = await rasterizar();
      const safe = `${datos.abreviatura || "etiqueta"}_${datos.peso || tipo.nombre}`.replace(/[^\w\-]+/g, "_");
      descargarBlob(blob, `${safe}.png`);
      setMsg("PNG descargado");
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al exportar");
    } finally {
      setExportando(false);
    }
  }

  async function guardarBiblioteca() {
    setExportando(true);
    setMsg(null);
    try {
      const blob = await rasterizar();
      const safe = `${datos.abreviatura || "etiqueta"}_${datos.peso || tipo.nombre}`.replace(/[^\w\-]+/g, "_");
      await subirImagenBlobAEtiquetas(blob, `${safe}.png`, {
        carpeta: "ETIQUETAS STUDIO",
        tipo_etiqueta: tipo.nombre,
        ancho_mm: tipo.ancho_mm,
        alto_mm: tipo.alto_mm,
        dpi: 300,
      });
      setMsg("PNG guardado en la biblioteca de etiquetas ✓");
      setTimeout(() => setMsg(null), 3000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setExportando(false);
    }
  }

  async function guardarPlantilla() {
    setGuardando(true);
    setMsg(null);
    try {
      const formato = tipoEtiquetaToFormato(tipo);
      const canvasDoc = plantillaFichaTecnicaMp({
        formato,
        categoria: "etiquetas",
        carpeta: CARPETA_FORMATOS_ETIQUETA,
        colorPrimario: color,
        datos,
      });
      const nombre =
        nombrePlantilla.trim() ||
        `${datos.abreviatura || "Etiqueta"} · ${datos.peso || tipo.nombre}`;
      const payload: PlantillaVisualDoc = {
        ...canvasDoc,
        id: plantillaId || canvasDoc.id,
        nombre,
        created_at: inicial?.created_at || canvasDoc.created_at,
        ficha_mp: {
          color,
          tipo_nombre: tipo.nombre,
          datos,
          estilo,
        },
      };
      const res = await api.post<{ plantilla: PlantillaVisualDoc }>("/api/plantillas-visuales", payload);
      const saved = res.plantilla
        ? fusionarMetadatosPlantillaTrasGuardar(payload, res.plantilla)
        : payload;
      setPlantillaId(saved.id);
      setNombrePlantilla(saved.nombre);
      onGuardada?.(saved);
      setMsg("Plantilla guardada ✓ · ábrela de nuevo desde Studio para seguir editando");
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al guardar la plantilla");
    } finally {
      setGuardando(false);
    }
  }

  if (pasoInicial === "scan") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        {msg && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-accent/40 bg-surface-panel px-4 py-2 text-xs font-semibold text-ink shadow-xl backdrop-blur-md">
            {msg}
          </div>
        )}
        <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onVolver}
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
            >
              ← Volver
            </button>
            <div>
              <h2 className="text-base font-bold text-ink">Escanear diagramación y formato</h2>
              <p className="text-xs text-muted">
                Revisa la anatomía de la etiqueta, selecciona las medidas y el color antes de diligenciar los datos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPasoInicial("editor")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white shadow hover:opacity-90"
          >
            Comenzar a diligenciar →
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto p-4 lg:grid-cols-[340px_1fr] lg:gap-6">
          {/* Columna izquierda: Selección de formato y configuración base */}
          <div className="space-y-5 rounded-2xl border border-border bg-surface-panel p-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Paso 1</span>
              <h3 className="text-sm font-bold text-ink">Formato de impresión</h3>
              <p className="mt-0.5 text-xs text-muted">
                Elige el tamaño de etiqueta física sobre el que se diagramará el contenido.
              </p>
              <div className="mt-3">
                <select
                  value={tipo.nombre}
                  onChange={(e) => {
                    const t = tipos.find((x) => x.nombre === e.target.value);
                    setTipoNombre(e.target.value);
                    if (t && t.nombre.match(/^\d/)) {
                      patch({ peso: t.nombre });
                    }
                  }}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-ink shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {tipos.map((t) => (
                    <option key={t.nombre} value={t.nombre}>
                      {t.nombre} · {formatoMedidasEtiqueta(t.ancho_mm, t.alto_mm)} ({t.ancho_mm}×{t.alto_mm} mm)
                    </option>
                  ))}
                </select>

                <div className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                  <div className="flex justify-between font-medium text-ink">
                    <span>Dimensiones activas:</span>
                    <span className="font-bold">{tipo.ancho_mm} × {tipo.alto_mm} mm</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-tight text-muted">
                    {Math.abs(tipo.ancho_mm - 76) < 0.6 && Math.abs(tipo.alto_mm - 66) < 0.6
                      ? "Proporción nativa SCI (250 g / 500 g)."
                      : "La diagramación SCI se calibra y escala a estas medidas."}
                  </p>
                </div>
              </div>
            </div>

            <hr className="border-border" />

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Paso 2</span>
              <h3 className="text-sm font-bold text-ink">Color de marca e identidad</h3>
              <p className="mt-0.5 text-xs text-muted">
                Pinta títulos, bordes divisores, cajas de atributos y badge de peso.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {COLORES_FORMATO.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.nombre}
                    onClick={() => setColor(c.hex)}
                    className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c.hex,
                      borderColor: color.toLowerCase() === c.hex.toLowerCase() ? "#fff" : c.hex,
                      outline: color.toLowerCase() === c.hex.toLowerCase() ? `2px solid ${c.hex}` : "none",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  title="Color personalizado"
                  className="h-8 w-8 cursor-pointer rounded-full border border-border bg-transparent p-0"
                />
              </div>
            </div>

            <hr className="border-border" />

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Escáner · Referencia</span>
              <h3 className="text-sm font-bold text-ink">Agregar captura de etiqueta</h3>
              <p className="mt-0.5 text-xs text-muted">
                Pega con <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px] text-ink">Ctrl+V</kbd> o sube una imagen de referencia para comparar con el diagrama.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) procesarArchivoCaptura(f);
                }}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={escaneandoIA}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                  📷 Subir captura para abstraer
                </button>
                {capturaRefUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setCapturaRefUrl(null);
                      setModoComparacion("diagrama");
                    }}
                    className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/50"
                  >
                    Quitar captura
                  </button>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setDatos(crearDatosFichaMpVacios(tipo.nombre));
                    setMsg("Lienzo en blanco ✓");
                    setTimeout(() => setMsg(null), 2500);
                  }}
                  className="text-[11px] text-red-500 underline hover:text-red-700 dark:hover:text-red-400"
                >
                  🧹 Vaciar / Lienzo en blanco
                </button>
                <span className="text-muted">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setDatos(fusionarDatosFichaMp(DATOS_EJEMPLO_SCI));
                    setMsg("Ejemplo SCI cargado");
                    setTimeout(() => setMsg(null), 2500);
                  }}
                  className="text-[11px] text-muted underline hover:text-ink"
                >
                  ✨ Cargar ejemplo SCI
                </button>
              </div>

              {capturaRefUrl && (
                <div className="mt-3 space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
                  <p className="text-[11px] font-semibold text-ink">Modo de escaneo / comparación:</p>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setModoComparacion("lado_a_lado")}
                      className={`rounded-lg border px-2 py-1 text-center font-medium ${
                        modoComparacion === "lado_a_lado"
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-surface text-ink hover:bg-surface-hover"
                      }`}
                    >
                      Lado a lado
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoComparacion("superpuesta")}
                      className={`rounded-lg border px-2 py-1 text-center font-medium ${
                        modoComparacion === "superpuesta"
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-surface text-ink hover:bg-surface-hover"
                      }`}
                    >
                      Superponer
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoComparacion("solo_captura")}
                      className={`rounded-lg border px-2 py-1 text-center font-medium ${
                        modoComparacion === "solo_captura"
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-surface text-ink hover:bg-surface-hover"
                      }`}
                    >
                      Solo captura
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoComparacion("diagrama")}
                      className={`rounded-lg border px-2 py-1 text-center font-medium ${
                        modoComparacion === "diagrama"
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-surface text-ink hover:bg-surface-hover"
                      }`}
                    >
                      Solo diagrama
                    </button>
                  </div>

                  {modoComparacion === "superpuesta" && (
                    <label className="mt-2 block text-[11px] text-muted">
                      <span className="flex justify-between">
                        <span>Opacidad de la captura:</span>
                        <span className="font-bold text-ink">{Math.round(opacidadSuperposicion * 100)}%</span>
                      </span>
                      <input
                        type="range"
                        min={0.1}
                        max={0.9}
                        step={0.05}
                        value={opacidadSuperposicion}
                        onChange={(e) => setOpacidadSuperposicion(Number(e.target.value))}
                        className="mt-1 w-full accent-accent"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            <hr className="border-border" />

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Paso 3</span>
              <h3 className="text-sm font-bold text-ink">Ajustes visuales de diagramación</h3>
              <p className="mt-0.5 mb-3 text-xs text-muted">
                Redimensiona cajas, aplica rellenos/fondos, ajusta tamaño de iconos y fuentes en tiempo real.
              </p>
              <AjustesDiagramacionCompleta
                estilo={estilo}
                color={color}
                onPatchEstilo={patchEstilo}
                onResetEstilo={() => setEstilo(ESTILO_FICHA_MP_DEFAULT)}
              />
            </div>

            <hr className="border-border" />

            <div className="space-y-2 rounded-xl bg-surface p-3 text-xs text-muted">
              <p className="font-semibold text-ink">Abstracción inteligente y diagramación:</p>
              <ul className="list-inside list-disc space-y-1 text-[11px] leading-relaxed">
                <li>Al subir o pegar (<kbd className="rounded border border-border bg-surface px-1 py-0.2 font-mono text-[9px] text-ink">Ctrl+V</kbd>) una foto, la IA extrae textos, CAS, concentración, aplicaciones e identidad.</li>
                <li>Dos columnas calibradas para alta legibilidad en impresión.</li>
                <li>Iconos y pictogramas GHS personalizables desde galería.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => setPasoInicial("editor")}
              className="w-full rounded-xl bg-accent py-3 text-center text-sm font-bold text-white shadow hover:opacity-90"
            >
              Confirmar y diligenciar →
            </button>
          </div>

          {/* Columna derecha: Escáner visual de diagramación */}
          <div className="relative flex flex-col items-center justify-center rounded-2xl border border-border bg-[#525659] p-6 overflow-hidden">
            {escaneandoIA && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/65 p-6 text-center text-white backdrop-blur-sm">
                <div className="mb-3 h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
                <h3 className="text-base font-bold">Abstrayendo elementos con Visión IA…</h3>
                <p className="mt-1 max-w-sm text-xs text-white/80">
                  Detectando nombre, concentración, CAS, aplicaciones, modo de empleo, pictogramas y color de tinta.
                </p>
              </div>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-center gap-3 text-xs text-white/90">
              <span className="rounded-full bg-black/40 px-3 py-1 font-semibold">
                📐 Escaneo de formato: {tipo.nombre} ({tipo.ancho_mm}×{tipo.alto_mm} mm)
              </span>
              <span className="rounded-full bg-black/40 px-3 py-1 font-semibold">
                🎨 Tinta: <span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: color }} /> {color}
              </span>
              {capturaRefUrl && (
                <span className="rounded-full bg-accent px-3 py-1 font-semibold text-white">
                  📷 Captura vinculada ({modoComparacion})
                </span>
              )}
            </div>

            {/* Vista según modo de comparación */}
            {capturaRefUrl && modoComparacion === "lado_a_lado" ? (
              <div className="flex w-full max-w-5xl flex-wrap items-center justify-center gap-6">
                <div className="flex flex-col items-center">
                  <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/80">
                    Captura / Escáner original
                  </span>
                  <div className="flex max-h-[70vh] max-w-[420px] items-center justify-center overflow-hidden rounded-lg bg-black/20 p-2 shadow-2xl">
                    <img
                      src={capturaRefUrl}
                      alt="Captura original de referencia"
                      className="max-h-[60vh] w-auto rounded object-contain"
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <span className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/80">
                    Diagramación generada ({tipo.nombre})
                  </span>
                  <div className="flex max-w-full items-center justify-center overflow-hidden rounded-lg shadow-2xl">
                    <EtiquetaMpHtml
                      datos={datos}
                      color={color}
                      estilo={estilo}
                      anchoMm={tipo.ancho_mm}
                      altoMm={tipo.alto_mm}
                    />
                  </div>
                </div>
              </div>
            ) : capturaRefUrl && modoComparacion === "superpuesta" ? (
              <div className="relative flex max-w-full items-center justify-center overflow-hidden rounded-lg shadow-2xl">
                <EtiquetaMpHtml
                  datos={datos}
                  color={color}
                  estilo={estilo}
                  anchoMm={tipo.ancho_mm}
                  altoMm={tipo.alto_mm}
                />
                <img
                  src={capturaRefUrl}
                  alt="Superposición de captura"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  style={{ opacity: opacidadSuperposicion }}
                />
              </div>
            ) : capturaRefUrl && modoComparacion === "solo_captura" ? (
              <div className="flex max-h-[75vh] max-w-3xl items-center justify-center overflow-hidden rounded-lg bg-black/20 p-3 shadow-2xl">
                <img
                  src={capturaRefUrl}
                  alt="Captura original de referencia"
                  className="max-h-[70vh] w-auto rounded object-contain"
                />
              </div>
            ) : (
              <div className="flex max-w-full items-center justify-center overflow-hidden rounded-lg shadow-2xl">
                <EtiquetaMpHtml
                  datos={datos}
                  color={color}
                  estilo={estilo}
                  anchoMm={tipo.ancho_mm}
                  altoMm={tipo.alto_mm}
                />
              </div>
            )}

            <p className="mt-4 text-center text-xs text-white/70">
              {capturaRefUrl
                ? "Compara las proporciones de tu captura con la diagramación del sistema antes de diligenciar."
                : "Lienzo en blanco listo · Pega una captura con Ctrl+V o sube una foto para abstraer los elementos automáticamente."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (inicial) onVolver();
            else setPasoInicial("scan");
          }}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          {inicial ? "← Volver" : "← Cambiar formato / diagramación"}
        </button>
        <input
          value={nombrePlantilla}
          onChange={(e) => setNombrePlantilla(e.target.value)}
          aria-label="Nombre de la plantilla"
          className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-bold text-ink lg:max-w-xs"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void descargar()}
            disabled={exportando || guardando}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-hover disabled:opacity-50"
          >
            {exportando ? "Generando…" : "Descargar PNG"}
          </button>
          <button
            type="button"
            onClick={() => void guardarBiblioteca()}
            disabled={exportando || guardando}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-hover disabled:opacity-50"
          >
            Guardar PNG
          </button>
          <button
            type="button"
            onClick={() => void guardarPlantilla()}
            disabled={exportando || guardando}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar plantilla"}
          </button>
        </div>
      </header>
      {msg && (
        <p className="shrink-0 border-b border-accent/20 bg-accent/10 px-4 py-2 text-sm text-ink">{msg}</p>
      )}
      <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(280px,22rem)_1fr]">
        <div className="min-h-0 overflow-y-auto border-r border-border p-4">
          <div className="space-y-4">
            {campoActivo ? (
              <BarraEdicionTexto
                campoId={campoActivo}
                estilo={estilo}
                onPatchCampo={patchCampoEstilo}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface-panel px-3 py-2 text-[11px] text-muted">
                Haz clic en un campo o en un texto de la etiqueta para editar tamaño y negrita.
              </p>
            )}
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Color del formato</p>
              <div className="flex flex-wrap items-center gap-2">
                {COLORES_FORMATO.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.nombre}
                    onClick={() => setColor(c.hex)}
                    className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c.hex,
                      borderColor: color.toLowerCase() === c.hex.toLowerCase() ? "#fff" : c.hex,
                      outline: color.toLowerCase() === c.hex.toLowerCase() ? `2px solid ${c.hex}` : "none",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  title="Color personalizado"
                  className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent p-0"
                />
              </div>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">Tamaño (formato de impresión)</span>
              <select
                value={tipo.nombre}
                onChange={(e) => {
                  const t = tipos.find((x) => x.nombre === e.target.value);
                  setTipoNombre(e.target.value);
                  if (t) patch({ peso: t.nombre.match(/^\d/) ? t.nombre : datos.peso });
                }}
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm"
              >
                {tipos.map((t) => (
                  <option key={t.nombre} value={t.nombre}>
                    {t.nombre} · {formatoMedidasEtiqueta(t.ancho_mm, t.alto_mm)} ({t.ancho_mm}×{t.alto_mm} mm)
                  </option>
                ))}
              </select>
              {Math.abs(tipo.ancho_mm - 76) < 0.6 && Math.abs(tipo.alto_mm - 66) < 0.6 ? (
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  250 g y 500 g usan la misma diagramación (76×66 mm). Solo cambia el peso.
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  La diagramación SCI (250/500 g) se mantiene y se escala al formato elegido.
                </p>
              )}
            </label>
            <AjustesDiagramacionCompleta
              estilo={estilo}
              color={color}
              onPatchEstilo={patchEstilo}
              onResetEstilo={() => setEstilo(ESTILO_FICHA_MP_DEFAULT)}
            />
            <CampoFormulario id="abreviatura" activo={campoActivo === "abreviatura"} onActivar={setCampoActivo}>
              <Field label="Abreviatura" value={datos.abreviatura} onChange={(v) => patch({ abreviatura: v })} />
            </CampoFormulario>
            <CampoFormulario id="nombre" activo={campoActivo === "nombre"} onActivar={setCampoActivo}>
              <Field label="Nombre del producto" value={datos.nombre} onChange={(v) => patch({ nombre: v })} />
            </CampoFormulario>
            <CampoFormulario id="tagline" activo={campoActivo === "tagline"} onActivar={setCampoActivo}>
              <Field label="Tagline" value={datos.tagline} onChange={(v) => patch({ tagline: v })} />
            </CampoFormulario>
            <div className="grid grid-cols-2 gap-2">
              <CampoFormulario id="concentracion" activo={campoActivo === "concentracion"} onActivar={setCampoActivo}>
                <Field label="Concentración" value={datos.concentracionValor} onChange={(v) => patch({ concentracionValor: v })} />
              </CampoFormulario>
              <CampoFormulario id="cas" activo={campoActivo === "cas"} onActivar={setCampoActivo}>
                <Field label="CAS" value={datos.cas} onChange={(v) => patch({ cas: v })} />
              </CampoFormulario>
            </div>
            <CampoFormulario id="descripcion" activo={campoActivo === "descripcion"} onActivar={setCampoActivo}>
              <Field label="Descripción" value={datos.descripcion} onChange={(v) => patch({ descripcion: v })} rows={3} />
            </CampoFormulario>
            <CampoFormulario id="feat0" activo={campoActivo === "feat0"} onActivar={setCampoActivo}>
              <Field label="Destacado 1" value={datos.features[0]?.titulo || ""} onChange={(v) => patchFeat(0, v)} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.features[0]?.iconoSrc)}
                  onClick={() => setSlotIconosQuimica("feat0")}
                  onQuitar={() => quitarIconoSlot("feat0")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.features[0]?.iconoSrc)}
                  onClick={() => setSlotGaleria("feat0")}
                  onQuitar={() => quitarIconoSlot("feat0")}
                />
              </div>
            </CampoFormulario>
            <CampoFormulario id="feat1" activo={campoActivo === "feat1"} onActivar={setCampoActivo}>
              <Field label="Destacado 2" value={datos.features[1]?.titulo || ""} onChange={(v) => patchFeat(1, v)} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.features[1]?.iconoSrc)}
                  onClick={() => setSlotIconosQuimica("feat1")}
                  onQuitar={() => quitarIconoSlot("feat1")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.features[1]?.iconoSrc)}
                  onClick={() => setSlotGaleria("feat1")}
                  onQuitar={() => quitarIconoSlot("feat1")}
                />
              </div>
            </CampoFormulario>
            <CampoFormulario id="feat2" activo={campoActivo === "feat2"} onActivar={setCampoActivo}>
              <Field label="Destacado 3" value={datos.features[2]?.titulo || ""} onChange={(v) => patchFeat(2, v)} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.features[2]?.iconoSrc)}
                  onClick={() => setSlotIconosQuimica("feat2")}
                  onQuitar={() => quitarIconoSlot("feat2")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.features[2]?.iconoSrc)}
                  onClick={() => setSlotGaleria("feat2")}
                  onQuitar={() => quitarIconoSlot("feat2")}
                />
              </div>
            </CampoFormulario>
            <CampoFormulario id="aplicaciones" activo={campoActivo === "aplicaciones"} onActivar={setCampoActivo}>
              <Field label="Aplicaciones" value={datos.aplicaciones} onChange={(v) => patch({ aplicaciones: v })} rows={2} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.iconoAplicacionesSrc)}
                  onClick={() => setSlotIconosQuimica("aplicaciones")}
                  onQuitar={() => quitarIconoSlot("aplicaciones")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.iconoAplicacionesSrc)}
                  onClick={() => setSlotGaleria("aplicaciones")}
                  onQuitar={() => quitarIconoSlot("aplicaciones")}
                />
              </div>
            </CampoFormulario>
            <CampoFormulario id="incorporacion" activo={campoActivo === "incorporacion"} onActivar={setCampoActivo}>
              <Field label="Incorporación" value={datos.incorporacion} onChange={(v) => patch({ incorporacion: v })} rows={2} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.iconoIncorporacionSrc)}
                  onClick={() => setSlotIconosQuimica("incorporacion")}
                  onQuitar={() => quitarIconoSlot("incorporacion")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.iconoIncorporacionSrc)}
                  onClick={() => setSlotGaleria("incorporacion")}
                  onQuitar={() => quitarIconoSlot("incorporacion")}
                />
              </div>
            </CampoFormulario>
            <CampoFormulario id="peso" activo={campoActivo === "peso"} onActivar={setCampoActivo}>
              <Field label="Contenido neto" value={datos.peso} onChange={(v) => patch({ peso: v })} />
            </CampoFormulario>
            <CampoFormulario id="atencion" activo={campoActivo === "atencion"} onActivar={setCampoActivo}>
              <Field label="Advertencia" value={datos.atencionTexto} onChange={(v) => patch({ atencionTexto: v })} rows={3} />
              <BotonSustituir
                label={datos.ghsCodigo ? `GHS · ${datos.ghsCodigo}` : "Pictograma GHS"}
                activo={Boolean(datos.ghsSrc)}
                onClick={() => setGhsPicker(true)}
                onQuitar={() =>
                  setDatos((d) => {
                    const next = { ...d };
                    delete next.ghsSrc;
                    delete next.ghsCodigo;
                    return next;
                  })
                }
              />
            </CampoFormulario>
            <CampoFormulario id="almacenamiento" activo={campoActivo === "almacenamiento"} onActivar={setCampoActivo}>
              <Field label="Almacenamiento" value={datos.almacenamiento} onChange={(v) => patch({ almacenamiento: v })} rows={2} />
              <div className="mt-1 flex flex-wrap gap-1.5">
                <BotonSustituir
                  label="⚗️ Icono Químico Circular"
                  activo={Boolean(datos.iconoAlmacenamientoSrc)}
                  onClick={() => setSlotIconosQuimica("almacenamiento")}
                  onQuitar={() => quitarIconoSlot("almacenamiento")}
                />
                <BotonSustituir
                  label="📁 Galería PNG"
                  activo={Boolean(datos.iconoAlmacenamientoSrc)}
                  onClick={() => setSlotGaleria("almacenamiento")}
                  onQuitar={() => quitarIconoSlot("almacenamiento")}
                />
              </div>
            </CampoFormulario>
            <div>
              <Field label="EAN-13" value={datos.ean13} onChange={(v) => patch({ ean13: v })} />
              <BotonSustituir
                label="Biblioteca EAN"
                activo={Boolean(datos.ean13)}
                onClick={() => setEanPicker(true)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setDatos(crearDatosFichaMpVacios(tipo.nombre));
                  setMsg("Lienzo en blanco ✓");
                  setTimeout(() => setMsg(null), 2500);
                }}
                className="text-[11px] text-red-500 underline hover:text-red-700 dark:hover:text-red-400"
              >
                🧹 Vaciar / Lienzo en blanco
              </button>
              <span className="text-muted">·</span>
              <button
                type="button"
                onClick={() => {
                  setDatos(fusionarDatosFichaMp(DATOS_EJEMPLO_SCI));
                  setMsg("Ejemplo SCI cargado");
                  setTimeout(() => setMsg(null), 2500);
                }}
                className="text-[11px] text-muted underline hover:text-ink"
              >
                ✨ Cargar ejemplo SCI
              </button>
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-col bg-[#525659]">
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 py-2 text-[11px] text-white/80">
            <span>
              {tipo.nombre} · {tipo.ancho_mm}×{tipo.alto_mm} mm
            </span>
            <span className="text-white/40">·</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Alejar"
                onClick={() => setZoomManual((z) => z - 0.1)}
                className="rounded px-2 py-0.5 font-semibold hover:bg-white/10"
              >
                −
              </button>
              <button
                type="button"
                title="Ajustar a la ventana"
                onClick={() => {
                  zoomManualRef.current = false;
                  ajustarZoom();
                }}
                className="min-w-[3.5rem] rounded px-2 py-0.5 tabular-nums hover:bg-white/10"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                title="Acercar"
                onClick={() => setZoomManual((z) => z + 0.1)}
                className="rounded px-2 py-0.5 font-semibold hover:bg-white/10"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setZoomManual(1)}
                className="rounded px-2 py-0.5 hover:bg-white/10"
              >
                100%
              </button>
            </div>
            <span className="hidden text-white/50 sm:inline">Ctrl + rueda para zoom</span>
          </div>
          <div ref={previewPaneRef} className="min-h-0 flex-1 overflow-auto p-4">
            <div className="flex justify-center">
              <div style={{ width: wPx * zoom, height: hPx * zoom }}>
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  <EtiquetaMpHtml
                    etiquetaRef={etiquetaRef}
                    datos={datos}
                    color={color}
                    estilo={estilo}
                    campoActivo={campoActivo}
                    onActivarCampo={setCampoActivo}
                    onElegirIcono={setSlotIconosQuimica}
                    onElegirGhs={() => setGhsPicker(true)}
                    onElegirEan={() => setEanPicker(true)}
                    anchoMm={tipo.ancho_mm}
                    altoMm={tipo.alto_mm}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <GaleriaImagenesModal
        abierta={slotGaleria !== null}
        onCerrar={() => setSlotGaleria(null)}
        onElegir={aplicarIconoGaleria}
      />
      <GaleriaIconosQuimicosModal
        abierta={slotIconosQuimica !== null}
        colorTinta={color}
        onCerrar={() => setSlotIconosQuimica(null)}
        onElegir={aplicarIconoGaleria}
      />
      {eanPicker ? (
        <CodigoBarrasEAN13
          onCerrar={() => setEanPicker(false)}
          onInsertar={(_svg, digits) => {
            if (digits) patch({ ean13: digits.replace(/\D/g, "").slice(0, 13) });
            setEanPicker(false);
          }}
        />
      ) : null}
      {ghsPicker ? (
        <GHSIconsPicker
          compact
          onCerrar={() => setGhsPicker(false)}
          onInsertar={(svgDataUrl, codigo) => {
            patch({ ghsSrc: svgDataUrl, ghsCodigo: codigo || undefined });
            setGhsPicker(false);
          }}
        />
      ) : null}
    </div>
  );
}
