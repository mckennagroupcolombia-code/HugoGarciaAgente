/**
 * Studio → «Árbol del producto»: todo lo de un producto de venta en una pantalla.
 *
 * Reúne lo que antes estaba repartido: la lista de «Categorías» del Studio, «Etiquetas para
 * publicaciones» (ahora el PAR: web nítida + MeLi desenfocada, lado a lado), el taller de
 * combos (incrustado: sus emergentes resuelven cada pieza) y Canales del producto (MeLi, web y
 * si Alegra lo factura). Categoría → familia (materia prima) → presentación → pieza.
 *
 * Datos: `GET /api/mapa-sistema/arbol-producto` (app/services/arbol_producto.py), que junta el
 * taller y Canales; no calcula nada propio. Ninguna escritura nace aquí: editar la etiqueta abre
 * el editor del Studio, y cada pieza se resuelve en el emergente del taller.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { useAppStore } from "../../../stores/app";
import MisionCombos from "../../combos/MisionCombos";
import { BTN, BTN_SEC, type Respuesta } from "../../combos/comun";
import { CladogramaCategoria, CladogramaFamilia } from "./Cladograma";
import { ParEtiquetasModal, VarianteEtiqueta } from "./ParEtiquetas";
import {
  CAJA, PUNTO, TOTAL_PIEZAS, estadoFamilia, familiaCoincide, norm, pesos, piezaTaller,
  type ClavePieza, type Estado, type Familia, type Presentacion, type RespuestaArbol,
} from "./tipos";
import "./arbol.css";

const CLAVE_SEL = "mck-arbol-producto-sel";

type Seleccion = { cat: string; fam: string | null; ref: string | null };

function leerSel(): Seleccion | null {
  try {
    const s = sessionStorage.getItem(CLAVE_SEL);
    return s ? (JSON.parse(s) as Seleccion) : null;
  } catch {
    return null;
  }
}

/** Alto que queda bajo el cabezote: el árbol cabe en la ventana y cada columna desplaza sola. */
function useAltoDisponible<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el || window.innerWidth < 1024) return setAlto(null);
      const top = el.getBoundingClientRect().top;
      setAlto(Math.max(520, Math.floor(window.innerHeight - top - 12)));
    };
    medir();
    window.addEventListener("resize", medir);
    const ro = new ResizeObserver(medir);
    if (ref.current?.parentElement) ro.observe(ref.current.parentElement);
    return () => {
      window.removeEventListener("resize", medir);
      ro.disconnect();
    };
  }, []);
  return { ref, alto };
}

export default function ArbolProductoPanel({ buscar, editor, onEditarEtiqueta }: {
  buscar: string;
  /** El editor de etiqueta del Studio, cuando hay una abierta: ocupa el lugar del árbol. */
  editor?: ReactNode;
  onEditarEtiqueta: (fichaId: string) => void;
}) {
  const qc = useQueryClient();
  const datos = useQuery({
    queryKey: ["arbol-producto"],
    queryFn: () => api.get<RespuestaArbol>("/api/mapa-sistema/arbol-producto", { timeoutMs: 90_000 }),
    refetchInterval: 90_000,
  });
  const cats = datos.data?.categorias ?? [];
  const q = norm(buscar);

  // Con búsqueda, el árbol muestra solo lo que coincide (categorías y familias).
  const visibles = useMemo(
    () =>
      cats
        .map((c) => ({ ...c, familias: c.familias.filter((f) => familiaCoincide(f, q)) }))
        .filter((c) => !q || c.familias.length > 0 || norm(c.nombre).includes(q)),
    [cats, q],
  );

  const [sel, setSel] = useState<Seleccion>(() => leerSel() ?? { cat: "", fam: null, ref: null });
  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_SEL, JSON.stringify(sel));
    } catch {
      /* sin almacenamiento */
    }
  }, [sel]);

  // Una selección que ya no existe (o que la búsqueda escondió) cae en la primera visible.
  useEffect(() => {
    if (!visibles.length) return;
    const c = visibles.find((x) => x.nombre === sel.cat);
    if (!c) {
      const primera = visibles[0];
      const f = q ? primera.familias[0] : null;
      setSel({ cat: primera.nombre, fam: f?.clave ?? null, ref: f?.presentaciones[0]?.ref ?? null });
      return;
    }
    if (sel.fam && !c.familias.some((f) => f.clave === sel.fam)) {
      const f = q ? c.familias[0] : null;
      setSel({ cat: c.nombre, fam: f?.clave ?? null, ref: f?.presentaciones[0]?.ref ?? null });
    }
  }, [visibles, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoria = visibles.find((c) => c.nombre === sel.cat) ?? null;
  const familia = categoria?.familias.find((f) => f.clave === sel.fam) ?? null;
  const pres = familia?.presentaciones.find((p) => p.ref === sel.ref) ?? familia?.presentaciones[0] ?? null;

  // El taller, incrustado en el lugar del árbol (el mismo MisionCombos, sin su lista).
  const [taller, setTaller] = useState<{ ref: string; pieza?: string; n: number } | null>(null);
  const combos = useQuery({
    queryKey: ["mapa-sistema-combos"],
    queryFn: () => api.get<Respuesta>("/api/mapa-sistema/combos"),
    enabled: Boolean(taller),
    refetchInterval: taller ? 60_000 : false,
  });
  const abrirTaller = (ref: string, pieza?: string) => setTaller((t) => ({ ref, pieza, n: (t?.n ?? 0) + 1 }));
  const cerrarTaller = () => {
    setTaller(null);
    void qc.invalidateQueries({ queryKey: ["arbol-producto"] });
  };

  const saltarDesdeTaller = useAppStore((s) => s.saltarDesdeTaller);
  const verCanales = (p: Presentacion) =>
    saltarDesdeTaller({ ref: p.ref, nombre: p.nombre, origen: "etiquetas" }, { panel: "canales-producto", sku: p.ref, buscar: p.ref });

  const tocarPieza = (p: Presentacion, clave: ClavePieza) => {
    setSel((s) => ({ ...s, ref: p.ref }));
    const pz = piezaTaller(p, clave);
    if (pz) abrirTaller(p.ref, pz);
    else verCanales(p);
  };

  const [parAbierto, setParAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const { ref: raiz, alto } = useAltoDisponible<HTMLDivElement>();

  if (datos.isLoading) return <p className="text-xs text-muted">Armando el árbol: taller de combos + canales…</p>;
  if (datos.isError)
    return (
      <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">
        No se pudo leer el árbol del producto: {(datos.error as Error)?.message}
      </div>
    );

  const centro = editor ? (
    <div className="min-h-0 min-w-0 overflow-auto lg:col-span-2">{editor}</div>
  ) : taller ? (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 lg:col-span-2">
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className={BTN_SEC} onClick={cerrarTaller}>← Volver al árbol</button>
        <span className="text-[12px] text-muted">El taller de combos, en este producto: cada pieza se resuelve en su emergente.</span>
      </div>
      <div className="min-h-0 flex-1">
        {combos.isLoading && <p className="text-xs text-muted">Abriendo el taller…</p>}
        {combos.isError && <p className="text-xs text-ink">No se pudo abrir el taller: {(combos.error as Error)?.message}</p>}
        {combos.data && (
          <MisionCombos
            key={taller.n}
            datos={combos.data}
            refInicial={taller.ref}
            piezaInicial={taller.pieza}
            incrustado
            onCambiarRef={(r) => {
              const f = categoria?.familias.find((x) => x.presentaciones.some((p) => p.ref === r));
              if (f) setSel((s) => ({ ...s, fam: f.clave, ref: r }));
            }}
          />
        )}
      </div>
    </div>
  ) : (
    <>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
              {categoria?.nombre ?? "—"}{familia ? " ⇢ familia" : " ⇢ todas sus familias"}
            </p>
            <h2 className="truncate text-[15px] font-bold text-ink">
              {familia ? `${familia.nombre} · ${familia.total} ${familia.total === 1 ? "presentación" : "presentaciones"}` : categoria?.nombre}
            </h2>
          </div>
          {familia && (
            <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11.5px] font-bold text-ink">
              {familia.presentaciones.reduce((a, p) => a + p.listas, 0)} de {familia.total * TOTAL_PIEZAS} piezas listas
            </span>
          )}
          <div className="flex overflow-hidden rounded-md border border-border text-[11.5px] font-bold" role="group" aria-label="Nivel del árbol">
            <button type="button" onClick={() => setSel((s) => ({ ...s, fam: null, ref: null }))} aria-pressed={!familia}
              className={`px-2.5 py-1 ${!familia ? "bg-accent text-white" : "bg-surface text-ink-secondary hover:text-ink"}`}>Categoría</button>
            <button type="button" disabled={!categoria?.familias.length} aria-pressed={Boolean(familia)}
              onClick={() => {
                if (familia || !categoria?.familias[0]) return;
                const f = categoria.familias[0];
                setSel((s) => ({ ...s, fam: f.clave, ref: f.presentaciones[0]?.ref ?? null }));
              }}
              className={`border-l border-border px-2.5 py-1 ${familia ? "bg-accent text-white" : "bg-surface text-ink-secondary hover:text-ink"}`}>Familia</button>
            <button type="button" disabled={!pres} onClick={() => setParAbierto(true)}
              className="border-l border-border bg-surface px-2.5 py-1 text-ink-secondary hover:text-ink disabled:opacity-50">Presentación</button>
          </div>
        </div>
        <div className="mck-arbol-lienzo min-h-0 flex-1 overflow-auto">
          {familia ? (
            <CladogramaFamilia
              familia={familia}
              categoria={categoria?.nombre ?? ""}
              sel={pres?.ref ?? null}
              onElegir={(ref) => setSel((s) => ({ ...s, ref }))}
              onPieza={(ref, clave) => {
                const p = familia.presentaciones.find((x) => x.ref === ref);
                if (p) tocarPieza(p, clave);
              }}
            />
          ) : categoria ? (
            <CladogramaCategoria
              categoria={categoria}
              familias={categoria.familias}
              onFamilia={(clave, ref) => {
                const f = categoria.familias.find((x) => x.clave === clave);
                setSel((s) => ({ ...s, fam: clave, ref: ref ?? f?.presentaciones[0]?.ref ?? null }));
              }}
            />
          ) : (
            <p className="p-4 text-sm text-muted">Nada coincide con la búsqueda.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted">
          {(["ok", "aviso", "falta"] as Estado[]).map((e) => (
            <span key={e} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 ${PUNTO[e]}`} />{e === "ok" ? "Lista" : e === "aviso" ? "Revisar" : "Falta"}</span>
          ))}
          <span className="ml-auto">Tocar una presentación la elige · tocar una pieza la resuelve en el taller</span>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
        {pres ? (
          <DetallePresentacion
            p={pres}
            familia={familia!}
            categoria={categoria?.nombre ?? ""}
            onAviso={setAviso}
            onPar={() => setParAbierto(true)}
            onTaller={(pieza) => abrirTaller(pres.ref, pieza)}
            onCanales={() => verCanales(pres)}
            onEditarEtiqueta={onEditarEtiqueta}
          />
        ) : (
          <div className="rounded-xl border border-border bg-surface-panel p-4 text-[12.5px] text-ink-secondary">
            Elige una familia en el árbol para ver sus presentaciones, el par de etiquetas y si cada una se puede vender y facturar.
          </div>
        )}
        {aviso && <p role="status" className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] text-ink">{aviso}</p>}
      </div>
    </>
  );

  return (
    <div ref={raiz} style={alto ? { height: alto } : undefined}
      className="grid min-h-0 gap-3 lg:grid-cols-[250px_minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
      <ListaArbol
        categorias={visibles}
        total={datos.data?.total ?? 0}
        completas={datos.data?.completas ?? 0}
        sel={sel}
        abiertasTodas={Boolean(q)}
        onCategoria={(nombre) => { setTaller(null); setSel((s) => (s.cat === nombre ? { ...s, fam: null, ref: null } : { cat: nombre, fam: null, ref: null })); }}
        onFamilia={(cat, f) => { setTaller(null); setSel({ cat, fam: f.clave, ref: f.presentaciones[0]?.ref ?? null }); }}
      />
      {centro}
      {parAbierto && familia && pres && (
        <ParEtiquetasModal hermanas={familia.presentaciones} inicial={pres.ref} onCerrar={() => setParAbierto(false)} />
      )}
      {datos.data?.sin_senal?.length ? (
        <p className="text-[11px] text-muted lg:col-span-3">Sin señal de: {datos.data.sin_senal.map((s) => s.fuente).join(", ")}.</p>
      ) : null}
    </div>
  );
}

function ListaArbol({ categorias, total, completas, sel, abiertasTodas, onCategoria, onFamilia }: {
  categorias: RespuestaArbol["categorias"];
  total: number;
  completas: number;
  sel: Seleccion;
  abiertasTodas: boolean;
  onCategoria: (nombre: string) => void;
  onFamilia: (cat: string, f: Familia) => void;
}) {
  return (
    <nav aria-label="Categorías" className="flex max-h-[45vh] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-panel lg:max-h-none">
      <div className="flex shrink-0 items-baseline justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-ink">Categorías</span>
        <span className="text-[11px] text-muted">{completas} de {total} completas</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {categorias.map((c) => {
          const abierta = abiertasTodas || c.nombre === sel.cat;
          const pct = c.total ? Math.round((c.completas / c.total) * 100) : 0;
          return (
            <div key={c.nombre}>
              <button type="button" onClick={() => onCategoria(c.nombre)} aria-expanded={abierta}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${c.nombre === sel.cat ? "bg-accent/10 font-bold text-ink" : "text-ink-secondary hover:bg-surface-hover hover:text-ink"}`}>
                <span className="w-3 text-[9px] text-muted">{abierta ? "▼" : "▶"}</span>
                <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                <span className="flex h-1.5 w-10 shrink-0 border border-ink/40 bg-surface-input" title={`${c.completas} de ${c.total} completas`}>
                  <span className="bg-accent-leaf" style={{ width: `${pct}%` }} />
                </span>
                <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted">{c.total}</span>
              </button>
              {abierta && (
                <div className="mb-1 ml-6 border-l-2 border-dashed border-ink/30">
                  {c.familias.map((f) => {
                    const aqui = c.nombre === sel.cat && f.clave === sel.fam;
                    return (
                      <button key={f.clave} type="button" onClick={() => onFamilia(c.nombre, f)} aria-current={aqui ? "true" : undefined}
                        title={`${f.nombre}${f.mp_sku ? ` · ${f.mp_sku}` : ""} · ${f.completas}/${f.total} completas`}
                        className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] ${aqui ? "bg-accent-sun/40 font-bold text-ink" : "text-ink-secondary hover:bg-surface-hover hover:text-ink"}`}>
                        <span className={`h-2 w-2 shrink-0 ${PUNTO[estadoFamilia(f)]}`} />
                        <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
                        <span className="text-[10.5px] tabular-nums text-muted">{f.total}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function Fila({ estado, titulo, valor, onClick, accion }: { estado: Estado; titulo: string; valor: ReactNode; onClick?: () => void; accion?: string }) {
  const cuerpo = (
    <>
      <span className={`h-2.5 w-2.5 shrink-0 ${PUNTO[estado]}`} />
      <span className="w-16 shrink-0 text-[12px] font-bold text-ink">{titulo}</span>
      <span className="min-w-0 flex-1 text-[11.5px] text-ink-secondary">{valor}</span>
      {onClick && accion && <span className="shrink-0 text-[10.5px] font-bold text-accent">{accion} →</span>}
    </>
  );
  const clase = `flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left ${CAJA[estado]}`;
  return onClick ? <button type="button" onClick={onClick} className={clase}>{cuerpo}</button> : <div className={clase}>{cuerpo}</div>;
}

function DetallePresentacion({ p, familia, categoria, onAviso, onPar, onTaller, onCanales, onEditarEtiqueta }: {
  p: Presentacion;
  familia: Familia;
  categoria: string;
  onAviso: (t: string) => void;
  onPar: () => void;
  onTaller: (pieza?: string) => void;
  onCanales: () => void;
  onEditarEtiqueta: (fichaId: string) => void;
}) {
  const e = p.piezas.etiquetas;
  const otraCarpeta = e.categoria_png && e.categoria_png !== categoria ? e.categoria_png : "";
  const foto: Estado = !p.foto_estado || p.foto_estado === "ok" ? "ok" : "aviso";
  const precioMeli = p.piezas.meli.precio;
  return (
    <>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-panel p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-bold text-ink" title={p.nombre}>{p.nombre}</h3>
          <code className="shrink-0 text-[11px] text-ink-secondary">{p.ref}</code>
        </div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">El par de etiquetas{e.tamano ? ` · ${e.tamano}` : ""}</p>
        <div className="grid grid-cols-2 gap-2">
          <VarianteEtiqueta p={p} v="web" onAviso={onAviso} onCrear={() => onTaller("etiqueta")} />
          <VarianteEtiqueta p={p} v="meli" onAviso={onAviso} onCrear={() => onTaller("etiqueta")} />
        </div>
        {e.estado !== "ok" && <p className={`rounded-md border px-2 py-1 text-[11.5px] text-ink ${CAJA[e.estado]}`}>{e.detalle}</p>}
        {otraCarpeta && (
          <p className="rounded-md border border-accent-sun/70 bg-accent-sun/15 px-2 py-1 text-[11.5px] text-ink">
            Los PNG están en la carpeta «{otraCarpeta}» del Studio, no en «{categoria}».
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className={BTN} onClick={onPar} disabled={!e.png && !e.png_digital}>Para la foto de producto</button>
          {e.etiqueta_id ? (
            <button type="button" className={BTN_SEC} onClick={() => onEditarEtiqueta(e.etiqueta_id!)}>Editar etiqueta</button>
          ) : (
            <button type="button" className={BTN_SEC} onClick={() => onTaller("etiqueta")}>Crear etiqueta →</button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-panel p-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">¿Se puede vender y facturar?</p>
        <Fila estado={p.alegra.estado} titulo="Alegra" valor={`${p.alegra.detalle}${p.precio_lista ? ` · lista ${pesos(p.precio_lista)}` : ""}`} onClick={() => onTaller("receta")} accion="taller" />
        <Fila estado={p.piezas.receta.estado} titulo="Receta" valor={p.piezas.receta.detalle} onClick={() => onTaller(p.piezas.receta.pieza_taller || "receta")} accion="taller" />
        <Fila estado={p.piezas.factura.estado} titulo="Factura" valor={p.piezas.factura.detalle} onClick={onCanales} accion="canales" />
        <Fila estado={p.piezas.ean.estado} titulo="EAN" valor={p.piezas.ean.codigo || p.piezas.ean.detalle} onClick={() => onTaller("ean")} accion="taller" />
        <Fila estado={familia.documento.estado} titulo="Doc. técnico" valor={familia.documento.detalle || "Sin documento"} onClick={() => onTaller("documento")} accion="taller" />
        <Fila estado={p.piezas.meli.estado} titulo="MeLi"
          valor={p.piezas.meli.permalink
            ? <a href={p.piezas.meli.permalink} target="_blank" rel="noreferrer" className="underline" onClick={(ev) => ev.stopPropagation()}>{p.piezas.meli.detalle}{precioMeli ? ` · ${pesos(precioMeli)}` : ""}</a>
            : <>{p.piezas.meli.detalle}{precioMeli ? ` · ${pesos(precioMeli)}` : ""}</>}
          onClick={() => onTaller("publicacion")} accion="publicar" />
        <Fila estado={p.piezas.web.estado} titulo="Web" valor={p.piezas.web.detalle} onClick={() => onTaller("publicacion")} accion="publicar" />
        <Fila estado={foto} titulo="Foto" valor={foto === "ok" ? "Al día con la etiqueta" : p.foto_motivo || "Por actualizar"} onClick={() => onTaller("publicacion")} accion="fotos" />
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          <button type="button" className={BTN} onClick={() => onTaller()}>Abrir en el taller</button>
          <button type="button" className={BTN_SEC} onClick={onCanales}>Ver en Canales</button>
        </div>
      </div>
    </>
  );
}
