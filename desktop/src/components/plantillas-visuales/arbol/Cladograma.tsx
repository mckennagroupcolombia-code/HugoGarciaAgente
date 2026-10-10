/**
 * El cladograma: la materia prima es la raíz (con su documento técnico, que heredan todas
 * sus presentaciones), de ella sale una rama por presentación (combo C-…) y cada rama se
 * abre en sus hojas (las piezas); solo la elegida las muestra, para que el árbol quepa sin
 * scroll. Tocar la presentación la elige; tocar una hoja la resuelve en su emergente, encima
 * del árbol.
 *
 * Estilo pixel del Mapa (arbol.css, variables --ed-* que cada tema recolorea): nodos como
 * botones de juego, sprites por pieza y la rama elegida con hormigas en marcha.
 * Las ramas se dibujan con cajas (no SVG con coordenadas): cada fila lleva su tramo de
 * tronco, así el árbol se acomoda solo a cualquier número de presentaciones.
 */
import { Sprite, type SpriteId } from "../../colaboradores/pixel";
import { CambiarSku } from "./CambiarSku";
import { CopiarSku } from "./CopiarSku";
import { CAJA, PIEZAS, PUNTO, TOTAL_PIEZAS, estadoFamilia, type Categoria, type ClavePieza, type Familia, type Presentacion } from "./tipos";

/** El sprite de cada pieza (colaboradores/pixel.tsx). */
export const SPRITE_PIEZA: Record<ClavePieza, SpriteId> = {
  etiquetas: "datos",
  fotos: "foto",
  ean: "codigo",
  receta: "bolsa",
  envio: "camion",
  factura: "moneda",
  meli: "estrella",
  web: "ventana",
};

function Tronco({ primero, ultimo, viva }: { primero: boolean; ultimo: boolean; viva?: boolean }) {
  return (
    <div className="relative w-6 shrink-0" aria-hidden="true">
      {!(primero && ultimo) && (
        <div className="ap-rama absolute left-0 w-[3px]" style={{ top: primero ? "50%" : 0, bottom: ultimo ? "50%" : 0 }} />
      )}
      <div className={`${viva ? "ap-rama-viva" : "ap-rama"} absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2`} />
    </div>
  );
}

function Segmentos({ p }: { p: Presentacion }) {
  return (
    <span className="flex gap-[2px]" aria-hidden="true">
      {PIEZAS.map(({ clave }) => (
        <span key={clave} className={`h-2.5 w-3 ${PUNTO[p.piezas[clave].estado]}`} />
      ))}
    </span>
  );
}

export function CladogramaFamilia({ familia, categoria, sel, onElegir, onPieza, onDocumento, onEditarDocumento, onSkuCambiado }: {
  familia: Familia;
  categoria: string;
  sel: string | null;
  onElegir: (ref: string) => void;
  /** Se corrigió el SKU de un combo sin movimientos (✎ junto al código). */
  onSkuCambiado: (anterior: string, nuevo: string) => void | Promise<void>;
  onPieza: (ref: string, clave: ClavePieza) => void;
  /** El documento es de la materia prima (la raíz): se resuelve desde ella. Si ya hay PDF
   *  aprobado, lo abre; si no, abre el formulario. */
  onDocumento: () => void;
  /** Reabrir el formulario aunque ya haya PDF aprobado. */
  onEditarDocumento: () => void;
}) {
  const doc = familia.documento;
  const n = familia.presentaciones.length;
  return (
    <div className="flex min-h-full items-center py-4 pl-3 pr-4">
      {/* Raíz: la materia prima */}
      <div className="ap-carta flex w-44 shrink-0 flex-col">
        <div className="ap-cab ap-cab-navy"><Sprite s="cofre" px={2} />Materia prima</div>
        <div className="flex flex-col gap-2 p-2.5">
          <span className="text-[14px] font-extrabold leading-tight">{familia.nombre}</span>
          {familia.mp_sku && (
            <span className="flex items-center gap-1">
              <code className="text-[11px] text-ink-secondary">{familia.mp_sku}</code>
              <CopiarSku sku={familia.mp_sku} />
            </span>
          )}
          <button type="button" onClick={onDocumento}
            title={doc.pdf_nombre ? "Ver el PDF aprobado (FT · COA · SDS)" : "Revisar, unir o editar el documento técnico"}
            className={`ap-hoja flex flex-col items-start gap-0.5 p-2 text-left ${doc.pdf_nombre ? "ap-aprobado" : CAJA[doc.estado]}`}>
            <span className="flex items-center gap-1.5 text-[11.5px] font-extrabold"><Sprite s="doc" px={2} />Documento técnico</span>
            {doc.pdf_nombre && <span className="ap-sello-ok px-1.5 py-0.5 text-[10px] font-extrabold uppercase">✓ Aprobado</span>}
            <span className="text-[11px] text-ink-secondary">{doc.detalle || (doc.estado === "falta" ? "Sin documento" : "")}</span>
            {doc.pdf_nombre && <span className="text-[10.5px] font-bold">Ver PDF aprobado ↗</span>}
            {n > 1 && <span className="ap-t">lo heredan las {n}</span>}
          </button>
          {doc.pdf_nombre && (
            <button type="button" onClick={onEditarDocumento}
              className="-mt-1 self-start text-[10.5px] text-ink-secondary underline decoration-dotted hover:text-ink">
              Revisar o editar
            </button>
          )}
          <span className="ap-t">{categoria}</span>
        </div>
      </div>
      <div className="ap-rama h-[3px] w-6 shrink-0" aria-hidden="true" />

      {/* Ramas: una por presentación */}
      <div className="flex min-w-0 flex-1 flex-col">
        {familia.presentaciones.map((p, i) => {
          const aqui = p.ref === sel;
          return (
            <div key={p.ref} className={`flex items-stretch ${aqui ? "py-2" : "py-1"}`}>
              <Tronco primero={i === 0} ultimo={i === n - 1} viva={aqui} />
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => onElegir(p.ref)}
                  aria-pressed={aqui}
                  title={`${p.nombre} · ${p.listas}/${TOTAL_PIEZAS} piezas listas`}
                  className={`ap-nodo flex w-44 items-center gap-2 px-2 py-1.5 text-left ${aqui ? "ap-nodo-sel" : ""}`}
                >
                  {/* La foto con la que se vende (lo que el antiguo taller ponía al centro): late si no está al día. */}
                  <span className={`ap-foto ${p.piezas.fotos.estado !== "ok" ? "ap-foto-pendiente" : ""}`}
                    title={p.piezas.fotos.estado === "ok" ? "Foto al día" : p.piezas.fotos.detalle}>
                    {p.foto ? <img src={p.foto} alt="" loading="lazy" /> : <Sprite s="foto" px={3} titulo="Sin foto" />}
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span className="text-[17px] font-extrabold leading-none">{p.corto}</span>
                    <span className="flex max-w-full items-center gap-1">
                      <code className="min-w-0 truncate text-[10px] text-ink-secondary">{p.ref}</code>
                      <CopiarSku sku={p.ref} />
                      <CambiarSku sku={p.ref} onCambiado={(nuevo) => onSkuCambiado(p.ref, nuevo)} />
                    </span>
                    <ALaVenta p={p} />
                    <Segmentos p={p} />
                  </span>
                </button>
              </div>
              {/* Solo la presentación elegida abre sus hojas; las demás quedan en una fila compacta. */}
              {aqui ? (
              <>
              <div className="ap-rama-viva h-[3px] w-4 shrink-0 self-center" aria-hidden="true" />
              <div className="ap-piezas grid min-w-0 flex-1 grid-cols-4 gap-1.5 self-center p-1.5">
                {PIEZAS.map(({ clave, nombre }) => {
                  const pz = p.piezas[clave];
                  return (
                    <button
                      key={clave}
                      type="button"
                      onClick={() => onPieza(p.ref, clave)}
                      title={`${nombre}: ${pz.detalle}`}
                      className={`ap-hoja flex min-w-0 flex-col items-start px-1.5 py-1 text-left ${CAJA[pz.estado]}`}
                    >
                      <span className="flex max-w-full items-center gap-1.5 text-[11.5px] font-extrabold">
                        <Sprite s={SPRITE_PIEZA[clave]} px={2} />
                        <span className="truncate">{nombre}</span>
                      </span>
                      <span className="w-full truncate text-[10.5px] text-ink-secondary">{pz.detalle}</span>
                    </button>
                  );
                })}
              </div>
              </>
              ) : (
                <button type="button" onClick={() => onElegir(p.ref)} title="Elegir para ver sus piezas"
                  className="ml-2 self-center text-[11px] font-bold tabular-nums text-ink-secondary hover:underline">
                  {p.listas}/{TOTAL_PIEZAS} piezas ▸
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Zoom afuera: la categoría completa. Cada familia es una rama y cada presentación, una hoja
 *  con sus piezas en una barra. */
export function CladogramaCategoria({ categoria, familias, onFamilia }: {
  categoria: Categoria;
  familias: Familia[];
  onFamilia: (clave: string, ref?: string) => void;
}) {
  const n = familias.length;
  return (
    <div className="flex min-h-full items-center py-4 pl-3 pr-4">
      <div className="ap-carta ap-raiz-cat flex w-40 shrink-0 flex-col gap-1.5 p-3">
        <span className="ap-t flex items-center gap-1.5"><Sprite s="bloques" px={2} />Categoría</span>
        <span className="text-[16px] font-extrabold leading-tight">{categoria.nombre}</span>
        <span className="text-[11.5px]">{categoria.completas} de {categoria.total} presentaciones completas</span>
      </div>
      <div className="ap-rama h-[3px] w-6 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        {familias.map((f, i) => {
          const est = estadoFamilia(f);
          return (
            <div key={f.clave} className="flex items-stretch py-1">
              <Tronco primero={i === 0} ultimo={i === n - 1} />
              <button type="button" onClick={() => onFamilia(f.clave)}
                className="ap-nodo flex w-48 shrink-0 flex-col items-start gap-0.5 self-center px-2.5 py-1.5 text-left">
                <span className="flex max-w-full items-center gap-1.5 text-[12.5px] font-extrabold"><span className={`h-2.5 w-2.5 ${PUNTO[est]}`} /><span className="truncate">{f.nombre}</span></span>
                <span className="text-[10.5px] text-ink-secondary">{f.completas}/{f.total} completas · {f.mp_sku || "sin materia prima única"}</span>
              </button>
              <div className="ap-rama h-[3px] w-4 shrink-0 self-center" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {f.presentaciones.map((p) => (
                  <button key={p.ref} type="button" onClick={() => onFamilia(f.clave, p.ref)} title={`${p.nombre} · ${p.listas}/${TOTAL_PIEZAS}`}
                    className={`ap-hoja flex w-28 flex-col gap-1 px-2 py-1 text-left ${CAJA[p.listas === TOTAL_PIEZAS ? "ok" : Object.values(p.piezas).some((x) => x.estado === "falta") ? "falta" : "aviso"]}`}>
                    <span className="flex items-baseline justify-between text-[12px] font-extrabold"><span className="truncate">{p.corto}</span><span className="tabular-nums">{p.listas}/{TOTAL_PIEZAS}</span></span>
                    <ALaVenta p={p} />
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

/** Despliegue gradual tras el cese: «A la venta» si volvió a MeLi y la web (se factura). */
export function ALaVenta({ p }: { p: Presentacion }) {
  if (!p.desplegado) return null;
  return p.desplegado.activo ? (
    <span className="ap-ok px-1 text-[9.5px] font-extrabold leading-tight" title="Activo y publicado en MeLi y en la página web: su SKU se factura">
      A la venta · MeLi + web
    </span>
  ) : (
    <span className="ap-aviso px-1 text-[9.5px] font-bold leading-tight" title="No se vende todavía: vuelve cuando su SKU se pueda facturar">
      No a la venta
    </span>
  );
}
