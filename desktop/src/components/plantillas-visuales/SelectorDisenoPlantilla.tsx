import { useMemo, useState } from "react";
import {
  COLOR_FICHA_MP_DEFAULT,
  COLORES_FICHA_MP_PRESET,
  DATOS_EJEMPLO_SCI,
  fichaMpFormatoAprietado,
  fusionarDatosFichaMp,
  plantillaFichaTecnicaMp,
  type DatosFichaTecnicaMp,
} from "../../lib/plantillaFichaTecnicaMp";
import {
  labelFormato,
  plantillaVacia,
  type FormatoCanvas,
  type PlantillaVisualDoc,
} from "../../lib/plantillasVisuales";

interface Props {
  formato: FormatoCanvas;
  categoriaId: string;
  carpeta?: string;
  onCrear: (doc: PlantillaVisualDoc) => void;
  onVolver: () => void;
}

type DisenoId = "vacio" | "ficha-mp";

function MiniFicha({ color }: { color: string }) {
  return (
    <div
      className="mx-auto grid h-[148px] w-[104px] grid-cols-[1.7fr_1fr] overflow-hidden rounded-sm border bg-white shadow-sm"
      style={{ borderColor: color }}
    >
      <div className="flex flex-col items-center px-1 py-1.5" style={{ borderRight: `1px solid ${color}` }}>
        <span className="text-[11px] font-black leading-none" style={{ color }}>
          SCI
        </span>
        <span className="mt-0.5 text-[4px] font-bold leading-tight" style={{ color }}>
          COCOIL ISETIONATO
        </span>
        <div className="mt-1 flex w-full gap-0.5">
          <div className="h-3 flex-1 rounded-[2px] border" style={{ borderColor: color }} />
          <div className="h-3 flex-1 rounded-[2px] border" style={{ borderColor: color }} />
        </div>
        <div className="mt-1 flex w-full gap-0.5">
          <div className="h-5 flex-1 rounded-[2px] border" style={{ borderColor: color }} />
          <div className="h-5 flex-1 rounded-[2px] border" style={{ borderColor: color }} />
          <div className="h-5 flex-1 rounded-[2px] border" style={{ borderColor: color }} />
        </div>
        <div className="mt-auto mb-0.5 h-2.5 w-8 rounded-full" style={{ background: color }} />
      </div>
      <div className="flex flex-col items-center px-0.5 py-1.5">
        <span className="text-[4px] font-extrabold" style={{ color }}>
          MCKENNA
        </span>
        <div
          className="mt-1 h-4 w-4 rotate-45 border"
          style={{ borderColor: "#c41e3a" }}
        />
        <div className="mt-2 h-6 w-full border-y" style={{ borderColor: color }} />
        <div className="mt-auto h-4 w-full bg-neutral-800" />
      </div>
    </div>
  );
}

export default function SelectorDisenoPlantilla({
  formato,
  categoriaId,
  carpeta = "",
  onCrear,
  onVolver,
}: Props) {
  const [diseno, setDiseno] = useState<DisenoId>("ficha-mp");
  const [color, setColor] = useState(COLOR_FICHA_MP_DEFAULT);
  const [datos, setDatos] = useState<DatosFichaTecnicaMp>(() => fusionarDatosFichaMp());
  const apretado = fichaMpFormatoAprietado(formato);

  const patch = (p: Partial<DatosFichaTecnicaMp>) => setDatos((d) => ({ ...d, ...p }));

  const crear = () => {
    if (diseno === "vacio") {
      onCrear(plantillaVacia(formato, categoriaId, carpeta));
      return;
    }
    onCrear(
      plantillaFichaTecnicaMp({
        formato,
        categoria: categoriaId,
        carpeta,
        colorPrimario: color,
        datos,
      }),
    );
  };

  const campos = useMemo(
    () =>
      [
        ["abreviatura", "Abreviatura", datos.abreviatura],
        ["nombre", "Nombre", datos.nombre],
        ["tagline", "Tagline", datos.tagline],
        ["concentracionValor", "Concentración", datos.concentracionValor],
        ["cas", "CAS", datos.cas],
        ["peso", "Peso / neto", datos.peso],
        ["ean13", "EAN-13", datos.ean13],
      ] as const,
    [datos],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">Diseño de la plantilla</h2>
          <p className="mt-0.5 text-sm text-muted">
            Formato: <strong className="text-ink">{labelFormato(formato)}</strong>.
            Elige un lienzo vacío o la ficha técnica de dos columnas.
          </p>
        </div>
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-ink"
        >
          ← Cambiar tamaño
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setDiseno("ficha-mp")}
          className={`rounded-xl border p-4 text-left transition ${
            diseno === "ficha-mp"
              ? "border-accent bg-accent/5 ring-1 ring-accent/40"
              : "border-border bg-surface-panel hover:border-accent/40"
          }`}
        >
          <MiniFicha color={color} />
          <p className="mt-3 font-semibold text-ink">Ficha técnica MP</p>
          <p className="mt-0.5 text-xs text-muted">
            Layout tipo SCI: dos columnas, pictogramas, advertencia y código de barras.
            Color y textos se editan aquí y después en el lienzo.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setDiseno("vacio")}
          className={`rounded-xl border p-4 text-left transition ${
            diseno === "vacio"
              ? "border-accent bg-accent/5 ring-1 ring-accent/40"
              : "border-border bg-surface-panel hover:border-accent/40"
          }`}
        >
          <div className="mx-auto flex h-[148px] w-[104px] items-center justify-center rounded-sm border border-dashed border-border bg-white text-xs text-muted">
            Vacío
          </div>
          <p className="mt-3 font-semibold text-ink">Lienzo vacío</p>
          <p className="mt-0.5 text-xs text-muted">
            Empieza de cero con texto, recuadros, líneas e imágenes.
          </p>
        </button>
      </div>

      {diseno === "ficha-mp" && (
        <div className="mt-5 space-y-4 rounded-xl border border-border bg-surface-panel p-4">
          {apretado && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-ink-secondary">
              Este formato es pequeño para tanto texto. Funciona, pero se lee mejor en{" "}
              <strong>Fichas técnicas → Ficha MP 90×140 mm</strong> o un personalizado vertical.
            </p>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Color primario</p>
            <div className="flex flex-wrap items-center gap-2">
              {COLORES_FICHA_MP_PRESET.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(c.hex)}
                  className={`h-8 w-8 rounded-full border-2 ${
                    color.toLowerCase() === c.hex ? "border-ink" : "border-white/40"
                  }`}
                  style={{ background: c.hex }}
                />
              ))}
              <label className="ml-1 flex items-center gap-2 text-xs text-muted">
                Personalizado
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
              <code className="text-[11px] text-muted">{color}</code>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Datos del producto (el resto se edita en el lienzo)
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {campos.map(([key, label, value]) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block text-xs text-muted">{label}</span>
                  <input
                    value={value}
                    onChange={(e) => patch({ [key]: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
                  />
                </label>
              ))}
            </div>
            <label className="mt-2 block text-sm sm:col-span-2">
              <span className="mb-1 block text-xs text-muted">Descripción</span>
              <textarea
                value={datos.descripcion}
                onChange={(e) => patch({ descripcion: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => setDatos(fusionarDatosFichaMp(DATOS_EJEMPLO_SCI))}
              className="mt-2 text-xs text-muted underline hover:text-ink"
            >
              Restaurar ejemplo SCI
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-surface-hover"
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={crear}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          {diseno === "vacio" ? "Crear lienzo vacío" : "Crear ficha y abrir editor"}
        </button>
      </div>
    </div>
  );
}
