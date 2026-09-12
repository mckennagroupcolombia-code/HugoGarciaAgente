/**
 * Formulario de la etiqueta física: replica el grid visual
 * (título naranja + valor negro). No mueve cajas; solo `content` / src.
 *
 * Solo la parte "corta" (nombre/categoría/logo/peso/código de barras) vive
 * aquí, en el sidebar angosto. Los grids de Ficha/Especificaciones (varios
 * campos cortos, se ven mejor con más columnas) van en la barra inferior —
 * ver `FormularioEtiquetaCamposPanel` — usando el mismo estado compartido
 * de `useFormularioEtiqueta` para no duplicar edición del mismo campo en
 * dos sitios.
 */
import {
  CONTENIDOS_NETOS_SUGERIDOS,
  limitarPalabras,
  PALETA_LOGO_LINEA,
  urlLogoRecurso,
  type BloqueFormularioEtiqueta,
} from "../../lib/etiquetaFormulario";
import ImagenCanvasElement from "./ImagenCanvasElement";
import type { FormularioEtiqueta } from "./useFormularioEtiqueta";

function contarPalabras(texto: string): number {
  return (texto || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Casilla del formulario: marco definido (borde sólido, no solo el de
 * abajo del input) que llena TODA la altura de su celda de grid — así,
 * cuando una fila mezcla textarea "largo" con inputs cortos, las cajas
 * siguen alineadas de borde a borde en vez de dejar espacio suelto.
 *
 * `bloque.maxPalabras`, si está definido, recorta lo que se escriba o
 * pegue (nunca deja superar el tope) y muestra un contador — la casilla
 * comparte grilla con otras 5 del mismo tamaño, un párrafo largo desborda.
 */
export function CampoBloque({
  bloque,
  valor,
  onChange,
}: {
  bloque: BloqueFormularioEtiqueta;
  valor: string;
  onChange: (v: string) => void;
}) {
  const max = bloque.maxPalabras;
  const aplicarCambio = (v: string) => {
    if (!max) {
      onChange(v);
      return;
    }
    if (contarPalabras(v) <= max) {
      onChange(v);
      return;
    }
    // Al tope y escribiendo una tecla a la vez (cambio de largo chico): no
    // aceptar el caracter en vez de recortar — recortar aquí dejaría el
    // cursor al final de la última palabra permitida, y las letras
    // siguientes se pegarían a esa palabra en vez de bloquearse (probado:
    // "diez" + escribir "once" letra a letra terminaba en "dieznce...").
    // Un salto grande (pegar un párrafo, cargar una ficha) sí se recorta.
    if (Math.abs(v.length - valor.length) <= 3) {
      onChange(valor);
      return;
    }
    onChange(limitarPalabras(v, max));
  };

  const listId = bloque.sugerencias ? `sugerencias-${bloque.id}` : undefined;

  return (
    <label className="flex h-full flex-col rounded-lg border border-[#ffa348]/70 bg-white/90 p-2">
      <span className="flex items-baseline justify-between gap-1 text-[9px] font-bold uppercase tracking-wide text-[#c86a12]">
        {bloque.titulo}
        {max && (
          <span className="font-normal normal-case text-muted">
            {contarPalabras(valor)}/{max} palabras
          </span>
        )}
      </span>
      {bloque.largo ? (
        <textarea
          rows={2}
          value={valor}
          onChange={(e) => aplicarCambio(e.target.value)}
          className="mt-0.5 w-full flex-1 resize-none rounded border border-border bg-surface px-2 py-1 text-[11px] font-semibold leading-snug text-ink"
        />
      ) : (
        <>
          <input
            type="text"
            list={listId}
            value={valor}
            onChange={(e) => aplicarCambio(e.target.value)}
            placeholder={bloque.sugerencias ? "Escribe o elige…" : undefined}
            className="mt-0.5 w-full flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-ink"
          />
          {listId && (
            <datalist id={listId}>
              {bloque.sugerencias!.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
    </label>
  );
}

export default function FormularioEtiquetaPanel({ formulario: f }: { formulario: FormularioEtiqueta }) {
  if (!f.disponible) return null;
  const usados = new Set(f.campos);

  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Formulario de etiqueta</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted">
          Igual que el sticker: título naranja + dato negro. Las cajas no se mueven.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[10px] font-medium text-muted">Cargar ficha técnica</label>
        <div className="flex gap-1">
          <select
            value={f.fichaId}
            onChange={(e) => f.setFichaId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px]"
          >
            <option value="">Elegir ficha…</option>
            {f.fichas.map((ficha) => (
              <option key={ficha.id} value={ficha.id}>
                {ficha.titulo}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!f.fichaId || f.cargando}
            onClick={() => void f.cargarFicha()}
            className="shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {f.cargando ? "…" : "Cargar"}
          </button>
        </div>
      </div>

      {f.pendiente ? (
        <div className="space-y-1.5 rounded-lg border border-amber-400 bg-amber-50 p-2 dark:bg-amber-950/40">
          <p className="text-[10px] font-semibold leading-snug text-amber-800 dark:text-amber-300">
            ⚠️ {f.msg}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={f.cancelarCargaPendiente}
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-ink hover:bg-surface-hover"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={f.confirmarCargaPendiente}
              className="flex-1 rounded border border-amber-500 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200"
            >
              Cargar de todas formas
            </button>
          </div>
        </div>
      ) : (
        f.msg && <p className="text-[10px] leading-snug text-ink">{f.msg}</p>
      )}

      {usados.has("nombre") && (
        <CampoBloque
          bloque={{ id: "nombre", titulo: "NOMBRE", campo: "nombre", largo: true }}
          valor={f.valores.nombre ?? ""}
          onChange={(v) => f.patchCampo("nombre", v)}
        />
      )}
      {usados.has("tagline") && (
        <CampoBloque
          bloque={{ id: "tagline", titulo: "CATEGORÍA", campo: "tagline" }}
          valor={f.valores.tagline ?? ""}
          onChange={(v) => f.patchCampo("tagline", v)}
        />
      )}

      {f.logoEl && (
        <div className="rounded-lg border border-[#ffa348]/40 bg-white/80 p-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#c86a12]">LOGO</p>
          <p className="mb-1.5 text-[10px] text-muted">Color de la línea comercial</p>
          <div className="flex flex-wrap gap-1.5">
            {PALETA_LOGO_LINEA.map((linea) => {
              const activa = f.logoActivo?.id === linea.id;
              return (
                <button
                  key={linea.id}
                  type="button"
                  title={linea.label}
                  onClick={() => f.aplicarLogo(linea)}
                  className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 bg-white ${
                    activa ? "ring-2 ring-offset-1" : "opacity-80 hover:opacity-100"
                  }`}
                  style={{
                    borderColor: linea.hex,
                    outlineColor: linea.hex,
                  }}
                >
                  <div className="h-7 w-7">
                    <ImagenCanvasElement
                      src={urlLogoRecurso(linea.archivo)}
                      objectFit="contain"
                      alt={linea.label}
                    />
                  </div>
                </button>
              );
            })}
          </div>
          {f.logoActivo && <p className="mt-1 text-[10px] font-medium text-ink">{f.logoActivo.label}</p>}
        </div>
      )}

      {(f.fichaGrid.length > 0 || f.specs.length > 0) && (
        <p className="rounded-lg border border-dashed border-[#ffa348]/40 bg-white/60 px-2.5 py-2 text-[10px] leading-snug text-muted">
          Ficha y especificaciones se editan en la{" "}
          <span className="font-semibold text-ink">barra de abajo</span> (hay más espacio para los campos).
        </p>
      )}

      {usados.has("peso") && (
        <div className="space-y-1">
          <CampoBloque
            bloque={{ id: "peso", titulo: "CONTENIDO NETO", campo: "peso" }}
            valor={f.valores.peso ?? ""}
            onChange={(v) => f.patchCampo("peso", v)}
          />
          {f.pesoSugerido && f.pesoSugerido !== (f.valores.peso ?? "").trim() && (
            <button
              type="button"
              onClick={() => f.patchCampo("peso", f.pesoSugerido!)}
              className="flex w-full items-center justify-between rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] text-accent hover:bg-accent/20"
            >
              <span>Según el SKU: {f.pesoSugerido}</span>
              <span className="font-semibold">Usar</span>
            </button>
          )}
          <label className="block">
            <span className="text-[10px] text-muted">Contenidos que manejamos</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) f.patchCampo("peso", e.target.value);
              }}
              className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink"
            >
              <option value="">Elegir presentación…</option>
              <optgroup label="Gramos">
                {CONTENIDOS_NETOS_SUGERIDOS.filter((c) => c.grupo === "Gramos").map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.valor}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Mililitros">
                {CONTENIDOS_NETOS_SUGERIDOS.filter((c) => c.grupo === "Mililitros").map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.valor}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      )}

      {f.barcodeEl && (
        <div className="rounded-lg border border-[#ffa348]/40 bg-white/80 p-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#c86a12]">
            CÓDIGO DE BARRAS
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted">
            O clica el código de barras en el lienzo → «🔍 Buscar SKU».
          </p>
          <label className="mt-1 block">
            <span className="text-[10px] text-muted">EAN-13</span>
            <input
              type="text"
              inputMode="numeric"
              value={f.eanManual}
              onChange={(e) => f.aplicarEan(e.target.value)}
              placeholder="770…"
              className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink"
            />
          </label>
          {f.eanSugeridos.length > 0 && (
            <label className="mt-1.5 block">
              <span className="text-[10px] text-muted">Según nombre / SKU</span>
              <select
                value={f.eanSugeridos.some((c) => c.codigo === f.eanActual) ? f.eanActual : ""}
                onChange={(e) => {
                  if (e.target.value) f.aplicarEan(e.target.value);
                }}
                className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-[11px]"
              >
                <option value="">Elegir código registrado…</option>
                {f.eanSugeridos.map((c) => (
                  <option key={c.id} value={c.codigo}>
                    {c.codigo} · {c.nombre_producto || c.sku}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
