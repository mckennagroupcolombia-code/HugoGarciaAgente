/**
 * El cladograma: la materia prima es la raíz (con su documento técnico, que heredan todas
 * sus presentaciones), de ella sale una rama por presentación (combo C-…) y cada rama se
 * abre en sus seis hojas. Tocar la presentación la elige; tocar una hoja la resuelve en el
 * taller de combos, en esa pieza.
 *
 * Las ramas se dibujan con cajas (no SVG con coordenadas): cada fila lleva su tramo de
 * tronco, así el árbol se acomoda solo a cualquier número de presentaciones.
 */
import { CAJA, PIEZAS, PUNTO, TOTAL_PIEZAS, estadoFamilia, type Categoria, type ClavePieza, type Familia, type Presentacion } from "./tipos";

function Tronco({ primero, ultimo }: { primero: boolean; ultimo: boolean }) {
  return (
    <div className="relative w-6 shrink-0" aria-hidden="true">
      {!(primero && ultimo) && (
        <div className="mck-arbol-rama absolute left-0 w-[3px]" style={{ top: primero ? "50%" : 0, bottom: ultimo ? "50%" : 0 }} />
      )}
      <div className="mck-arbol-rama absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2" />
    </div>
  );
}

function Segmentos({ p }: { p: Presentacion }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {PIEZAS.map(({ clave }) => (
        <span key={clave} className={`h-2 w-3.5 border border-ink/60 ${PUNTO[p.piezas[clave].estado]}`} />
      ))}
    </span>
  );
}

export function CladogramaFamilia({ familia, categoria, sel, onElegir, onPieza }: {
  familia: Familia;
  categoria: string;
  sel: string | null;
  onElegir: (ref: string) => void;
  onPieza: (ref: string, clave: ClavePieza) => void;
}) {
  const doc = familia.documento;
  const n = familia.presentaciones.length;
  return (
    <div className="flex min-h-full items-center py-3 pl-3 pr-4">
      {/* Raíz: la materia prima */}
      <div className="flex w-44 shrink-0 flex-col gap-2 rounded-lg border-2 border-ink/70 bg-surface p-3">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">Materia prima · raíz</span>
        <span className="text-[14px] font-bold leading-tight text-ink">{familia.nombre}</span>
        {familia.mp_sku && <code className="text-[11px] text-ink-secondary">{familia.mp_sku}</code>}
        <div className={`flex flex-col gap-0.5 rounded-md border p-2 ${CAJA[doc.estado]}`}>
          <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink"><span className={`h-2 w-2 ${PUNTO[doc.estado]}`} />Documento técnico</span>
          <span className="text-[11px] text-ink-secondary">{doc.detalle || (doc.estado === "falta" ? "Sin documento" : "")}</span>
          {n > 1 && <span className="text-[10.5px] text-muted">lo heredan las {n}</span>}
        </div>
        <span className="text-[10.5px] text-muted">{categoria}</span>
      </div>
      <div className="mck-arbol-rama h-[3px] w-6 shrink-0" aria-hidden="true" />

      {/* Ramas: una por presentación */}
      <div className="flex min-w-0 flex-1 flex-col">
        {familia.presentaciones.map((p, i) => {
          const aqui = p.ref === sel;
          return (
            <div key={p.ref} className="flex items-stretch py-1.5">
              <Tronco primero={i === 0} ultimo={i === n - 1} />
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => onElegir(p.ref)}
                  aria-pressed={aqui}
                  title={`${p.nombre} · ${p.listas}/${TOTAL_PIEZAS} piezas listas`}
                  className={`mck-arbol-hoja flex w-32 flex-col items-start gap-1 rounded-md border-2 px-2.5 py-2 text-left ${aqui ? "border-accent bg-accent-sun/40 shadow-[4px_4px_0_rgb(var(--mck-ink)/0.8)]" : "border-ink/60 bg-surface shadow-[2px_2px_0_rgb(var(--mck-ink)/0.6)]"}`}
                >
                  <span className="text-[17px] font-bold leading-none text-ink">{p.corto}</span>
                  <code className="max-w-full truncate text-[10.5px] text-ink-secondary">{p.ref}</code>
                  <Segmentos p={p} />
                </button>
              </div>
              <div className="mck-arbol-rama h-[3px] w-4 shrink-0 self-center" aria-hidden="true" />
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 self-center rounded-md border-2 border-dashed border-ink/40 bg-surface/70 p-1.5">
                {PIEZAS.map(({ clave, nombre }) => {
                  const pz = p.piezas[clave];
                  return (
                    <button
                      key={clave}
                      type="button"
                      onClick={() => onPieza(p.ref, clave)}
                      title={`${nombre}: ${pz.detalle}`}
                      className={`mck-arbol-hoja flex min-w-0 flex-col items-start rounded-md border px-2 py-1 text-left ${CAJA[pz.estado]}`}
                    >
                      <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-ink"><span className={`h-2 w-2 shrink-0 ${PUNTO[pz.estado]}`} />{nombre}</span>
                      <span className="w-full truncate text-[10.5px] text-ink-secondary">{pz.detalle}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Zoom afuera: la categoría completa. Cada familia es una rama y cada presentación, una hoja
 *  con sus seis piezas en una barra. */
export function CladogramaCategoria({ categoria, familias, onFamilia }: {
  categoria: Categoria;
  familias: Familia[];
  onFamilia: (clave: string, ref?: string) => void;
}) {
  const n = familias.length;
  return (
    <div className="flex min-h-full items-center py-3 pl-3 pr-4">
      <div className="flex w-40 shrink-0 flex-col gap-1.5 rounded-lg border-2 border-ink/70 bg-accent/15 p-3">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">Categoría</span>
        <span className="text-[16px] font-bold leading-tight text-ink">{categoria.nombre}</span>
        <span className="text-[11.5px] text-ink-secondary">{categoria.completas} de {categoria.total} presentaciones con las seis piezas</span>
      </div>
      <div className="mck-arbol-rama h-[3px] w-6 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        {familias.map((f, i) => {
          const est = estadoFamilia(f);
          return (
            <div key={f.clave} className="flex items-stretch py-1">
              <Tronco primero={i === 0} ultimo={i === n - 1} />
              <button type="button" onClick={() => onFamilia(f.clave)}
                className="mck-arbol-hoja flex w-48 shrink-0 flex-col items-start gap-0.5 self-center rounded-md border-2 border-ink/60 bg-surface px-2.5 py-1.5 text-left">
                <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink"><span className={`h-2 w-2 shrink-0 ${PUNTO[est]}`} /><span className="truncate">{f.nombre}</span></span>
                <span className="text-[10.5px] text-muted">{f.completas}/{f.total} completas · {f.mp_sku || "sin materia prima única"}</span>
              </button>
              <div className="mck-arbol-rama h-[3px] w-4 shrink-0 self-center" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {f.presentaciones.map((p) => (
                  <button key={p.ref} type="button" onClick={() => onFamilia(f.clave, p.ref)} title={`${p.nombre} · ${p.listas}/${TOTAL_PIEZAS}`}
                    className={`mck-arbol-hoja flex w-28 flex-col gap-1 rounded-md border px-2 py-1 text-left ${CAJA[p.listas === TOTAL_PIEZAS ? "ok" : Object.values(p.piezas).some((x) => x.estado === "falta") ? "falta" : "aviso"]}`}>
                    <span className="flex items-baseline justify-between text-[12px] font-bold text-ink"><span className="truncate">{p.corto}</span><span className="tabular-nums">{p.listas}/{TOTAL_PIEZAS}</span></span>
                    <Segmentos p={p} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
