/**
 * Diseño de producto → Studio → «Árbol del producto»: todo lo de un producto de venta en UNA
 * pantalla, sin vistas aparte.
 *
 * Absorbió lo que estaba repartido: la lista de «Categorías» del Studio, «Etiquetas para
 * publicaciones» (el par web nítida + MeLi desenfocada, cada una con las FOTOS de producto de su
 * canal, que se pegan con Ctrl+V), el antiguo «Taller de combos» (ya no es panel: sus piezas son
 * las hojas del árbol y cada una se resuelve en su emergente, encima, con la misma guía y el mismo
 * premio al completar) y Canales del producto (MeLi, web y si Alegra lo factura).
 * Categoría → familia (materia prima) → presentación (combo) → pieza.
 *
 * Datos: `GET /api/mapa-sistema/arbol-producto` (app/services/arbol_producto.py), que junta el
 * taller, Canales y las fotos; no calcula nada propio. Ninguna escritura nace aquí: los emergentes
 * son los de siempre (components/combos/PiezasCombo.tsx) y editar la etiqueta abre el editor del Studio.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAuthBlobUrl } from "../../../api/client";
import { useAppStore } from "../../../stores/app";
import { CrearComboVentana, ResolverPieza } from "../../combos/PiezasCombo";
import { Sprite } from "../../colaboradores/pixel";
import "../../colaboradores/pixel.css";
import type { Respuesta } from "../../combos/comun";
import { CladogramaCategoria, CladogramaFamilia } from "./Cladograma";
import { CambiarSku } from "./CambiarSku";
import { CopiarSku } from "./CopiarSku";
import { VarianteEtiqueta } from "./ParEtiquetas";
import { FotosCanal, imagenesDe, useFotosProducto, type Canal } from "./FotosCanal";
import {
  CAJA, PUNTO, TOTAL_PIEZAS, estadoFamilia, familiaCoincide, norm, pesos, piezaTaller,
  type ClavePieza, type Estado, type Familia, type Presentacion, type RespuestaArbol,
} from "./tipos";
import "./arbol.css";

const CLAVE_SEL = "mck-arbol-producto-sel";
/** Entrada especial del árbol: productos comprados sin ninguna presentación de venta. */
const SIN_COMBO = "__sin_combo__";

type Seleccion = { cat: string; fam: string | null; ref: string | null };
type SinCombo = { ref: string; nombre: string; combo: string };

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

/** La primera pieza que falta, en el orden de la guía, traducida a la pieza del emergente. */
function siguientePieza(p: Presentacion, f: Familia): string | null {
  const orden: [Estado, string][] = [
    [p.piezas.receta.estado, p.piezas.receta.pieza_taller || "receta"],
    [f.documento.estado, "documento"],
    [p.piezas.ean.estado, "ean"],
    [p.piezas.etiquetas.estado, "etiqueta"],
    [p.piezas.meli.estado === "ok" && p.piezas.web.estado === "ok" ? "ok" : "aviso", "publicacion"],
  ];
  return orden.find(([e]) => e === "falta")?.[1] ?? orden.find(([e]) => e === "aviso")?.[1] ?? null;
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
  const sinCombo = useQuery({
    queryKey: ["arbol-sin-combo"],
    queryFn: () => api.get<{ filas: SinCombo[] }>("/api/mapa-sistema/productos"),
    staleTime: 300_000,
    retry: false,
  });
  const huerfanos = useMemo(() => (sinCombo.data?.filas ?? []).filter((f) => f.combo === "falta"), [sinCombo.data]);
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
  const huerfanosVisibles = useMemo(
    () => huerfanos.filter((h) => !q || norm(h.nombre).includes(q) || norm(h.ref).includes(q)),
    [huerfanos, q],
  );

  const [sel, setSel] = useState<Seleccion>(() => leerSel() ?? { cat: "", fam: null, ref: null });
  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_SEL, JSON.stringify(sel));
    } catch {
      /* sin almacenamiento */
    }
  }, [sel]);

  // Llegada con un combo pedido (enlaces viejos del taller, Canales, «← Seguir con…»).
  const arbolRef = useAppStore((s) => s.arbolRef);
  useEffect(() => {
    if (!arbolRef || !cats.length) return;
    const buscado = arbolRef.toUpperCase();
    for (const c of cats)
      for (const f of c.familias)
        if (f.presentaciones.some((p) => p.ref.toUpperCase() === buscado)) {
          const p = f.presentaciones.find((x) => x.ref.toUpperCase() === buscado)!;
          setSel({ cat: c.nombre, fam: f.clave, ref: p.ref });
        }
    useAppStore.setState({ arbolRef: null });
  }, [arbolRef, cats]);

  // Una selección que ya no existe (o que la búsqueda escondió) cae en la primera visible.
  useEffect(() => {
    if (sel.cat === SIN_COMBO || !visibles.length) return;
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

  const enSinCombo = sel.cat === SIN_COMBO;
  const categoria = enSinCombo ? null : visibles.find((c) => c.nombre === sel.cat) ?? null;
  const familia = categoria?.familias.find((f) => f.clave === sel.fam) ?? null;
  const pres = familia?.presentaciones.find((p) => p.ref === sel.ref) ?? familia?.presentaciones[0] ?? null;

  // Resolver una pieza: su emergente se abre ENCIMA del árbol (nada cambia de pantalla).
  const [resolver, setResolver] = useState<{ ref: string; pieza: string; n: number } | null>(null);
  const combos = useQuery({
    queryKey: ["mapa-sistema-combos"],
    queryFn: () => api.get<Respuesta>("/api/mapa-sistema/combos"),
    enabled: Boolean(resolver),
    staleTime: 30_000,
  });
  const abrirPieza = (ref: string, pieza: string) => setResolver((r) => ({ ref, pieza, n: (r?.n ?? 0) + 1 }));
  /** Documento técnico ya generado: el botón muestra el PDF aprobado, no el formulario. La
   *  pestaña se abre antes del fetch (dentro del clic) para que el navegador no la bloquee. */
  const verPdfAprobado = async (archivo: string) => {
    const w = window.open("", "_blank");
    const url = await fetchAuthBlobUrl(`/api/fichas/biblioteca/descargar?archivo=${encodeURIComponent(archivo)}&inline=1`);
    if (url && w) w.location.href = url;
    else {
      w?.close();
      window.alert("No se pudo abrir el PDF aprobado.");
    }
  };
  const [crearCombo, setCrearCombo] = useState<SinCombo | null>(null);

  const saltarDesdeTaller = useAppStore((s) => s.saltarDesdeTaller);
  const verCanales = (p: Presentacion) =>
    saltarDesdeTaller({ ref: p.ref, nombre: p.nombre, origen: "etiquetas" }, { panel: "canales-producto", sku: p.ref, buscar: p.ref });

  // Columna de fotos donde cae el Ctrl+V (web o MeLi).
  const [destinoFoto, setDestinoFoto] = useState<Canal>("web");
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  const tocarPieza = (p: Presentacion, clave: ClavePieza) => {
    setSel((s) => ({ ...s, ref: p.ref }));
    if (clave === "fotos") {
      const c = p.piezas.fotos.canales;
      setDestinoFoto(!c?.web?.n || c.web.desactualizada ? "web" : "meli");
      setAviso("Copia la foto del producto (Ctrl+C) y pégala con Ctrl+V: va a la columna marcada, bajo su etiqueta.");
      return;
    }
    const pz = piezaTaller(p, clave);
    if (pz) abrirPieza(p.ref, pz);
    else verCanales(p);
  };

  const { ref: raiz, alto } = useAltoDisponible<HTMLDivElement>();

  if (datos.isLoading) return <p className="text-xs text-muted">Armando el árbol: combos, etiquetas, fotos y canales…</p>;
  if (datos.isError)
    return (
      <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">
        No se pudo leer el árbol del producto: {(datos.error as Error)?.message}
      </div>
    );

  // Código corregido en Alegra (combo sin movimientos): seguir en el mismo combo con su código nuevo.
  const skuCambiado = async (anterior: string, nuevo: string) => {
    setSel((s) => (s.ref === anterior ? { ...s, ref: nuevo } : s));
    setAviso(`Código cambiado: ${anterior} → ${nuevo}`);
    await qc.invalidateQueries({ queryKey: ["arbol-producto"] });
  };

  const centro = editor ? (
    <div className="min-h-0 min-w-0 overflow-auto lg:col-span-2">{editor}</div>
  ) : (
    <div className="ap-carta flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="ap-cab ap-cab-amarilla shrink-0 flex-wrap">
        <Sprite s={enSinCombo ? "alerta" : familia ? "cofre" : "bloques"} px={2} />
        <span className="min-w-0 flex-1 truncate">
          {enSinCombo ? "Comprados sin presentación de venta" : categoria ? `${categoria.nombre}${familia ? ` ⇢ ${familia.nombre}` : ""}` : "—"}
        </span>
        {familia && (
          <span className="shrink-0 tabular-nums">
            {familia.presentaciones.reduce((a, p) => a + p.listas, 0)}/{familia.total * TOTAL_PIEZAS} piezas
          </span>
        )}
      </div>
      <div className="ap-lienzo min-h-0 flex-1 overflow-auto">
        {enSinCombo ? (
          <ListaSinCombo filas={huerfanosVisibles} onCrear={setCrearCombo} />
        ) : familia ? (
          <CladogramaFamilia
            familia={familia}
            categoria={categoria?.nombre ?? ""}
            sel={pres?.ref ?? null}
            onElegir={(ref) => setSel((s) => ({ ...s, ref }))}
            onSkuCambiado={skuCambiado}
            onPieza={(ref, clave) => {
              const p = familia.presentaciones.find((x) => x.ref === ref);
              if (p) tocarPieza(p, clave);
            }}
            onDocumento={() => {
              const pdf = familia.documento.pdf_nombre;
              if (pdf) return verPdfAprobado(pdf);
              if (familia.presentaciones[0]) abrirPieza(pres?.ref ?? familia.presentaciones[0].ref, "documento");
            }}
            onEditarDocumento={() => familia.presentaciones[0] && abrirPieza(pres?.ref ?? familia.presentaciones[0].ref, "documento")}
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
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-[3px] border-ink px-3 py-1.5 text-[11px] font-bold">
        {(["ok", "aviso", "falta"] as Estado[]).map((e) => (
          <span key={e} className="flex items-center gap-1.5"><span className={`h-3 w-3 ${PUNTO[e]}`} />{e === "ok" ? "Lista" : e === "aviso" ? "Revisar" : "Falta"}</span>
        ))}
        <span className="ml-auto text-ink-secondary">Tocar una presentación la elige · tocar una pieza la resuelve aquí mismo</span>
      </div>
    </div>
  );

  const derecha = editor ? null : (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
      {aviso && <p role="status" className="ap-mensaje">{aviso}</p>}
      {pres && familia ? (
        <DetallePresentacion
          key={pres.ref}
          p={pres}
          familia={familia}
          categoria={categoria?.nombre ?? ""}
          destino={destinoFoto}
          setDestino={setDestinoFoto}
          onAviso={setAviso}
          onPieza={(pieza) => abrirPieza(pres.ref, pieza)}
          onCanales={() => verCanales(pres)}
          onEditarEtiqueta={onEditarEtiqueta}
          onFotosCambiaron={() => void qc.invalidateQueries({ queryKey: ["arbol-producto"] })}
          onSkuCambiado={(nuevo) => skuCambiado(pres.ref, nuevo)}
        />
      ) : (
        <div className="ap-carta p-4 text-[12.5px]">
          {enSinCombo
            ? "Estos productos se compraron pero no tienen ninguna presentación de venta (combo C-…): sin combo no hay SKU de venta, ni EAN, ni etiqueta. «Crear su combo» lo arma en Alegra y al cerrar aparece en su categoría."
            : "Elige una familia en el árbol para ver sus presentaciones, el par de etiquetas con sus fotos y si cada una se puede vender y facturar."}
        </div>
      )}
    </div>
  );

  return (
    <div ref={raiz} style={alto ? { height: alto } : undefined} className="colab-pixel arbol-pixel flex min-h-0 flex-col gap-3">
      {/* La barra del árbol: el marcador del Mapa (mismo navy/amarillo del tema). */}
      <div className="ap-hud shrink-0">
        <Sprite s="cofre" px={2} titulo="Árbol del producto" />
        <span className="ap-hud-titulo min-w-0 flex-1 truncate">Árbol del producto</span>
        <span className="ap-hud-dato hidden sm:inline">{datos.data?.completas ?? 0} de {datos.data?.total ?? 0} combos completos</span>
        {huerfanos.length > 0 && <span className="ap-hud-dato hidden md:inline">· {huerfanos.length} sin combo</span>}
        {!enSinCombo && (
          <div className="flex shrink-0 gap-1" role="group" aria-label="Nivel del árbol">
            <button type="button" onClick={() => setSel((s) => ({ ...s, fam: null, ref: null }))} aria-pressed={!familia}
              className={`ap-nivel ${!familia ? "ap-nivel-on" : ""}`}>Categoría</button>
            <button type="button" disabled={!categoria?.familias.length} aria-pressed={Boolean(familia)}
              onClick={() => {
                if (familia || !categoria?.familias[0]) return;
                const f = categoria.familias[0];
                setSel((s) => ({ ...s, fam: f.clave, ref: f.presentaciones[0]?.ref ?? null }));
              }}
              className={`ap-nivel ${familia ? "ap-nivel-on" : ""}`}>Familia</button>
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[240px_minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]">
      <ListaArbol
        categorias={visibles}
        total={datos.data?.total ?? 0}
        completas={datos.data?.completas ?? 0}
        sel={sel}
        abiertasTodas={Boolean(q)}
        sinCombo={huerfanosVisibles.length}
        onCategoria={(nombre) => setSel((s) => (s.cat === nombre ? { ...s, fam: null, ref: null } : { cat: nombre, fam: null, ref: null }))}
        onFamilia={(cat, f) => setSel({ cat, fam: f.clave, ref: f.presentaciones[0]?.ref ?? null })}
      />
      {centro}
      {derecha}
      </div>
      {resolver && combos.isLoading && (
        <p role="status" className="ap-mensaje fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">Abriendo la pieza…</p>
      )}
      {resolver && combos.data && (
        <ResolverPieza key={resolver.n} datos={combos.data} refCombo={resolver.ref} pieza={resolver.pieza}
          onCerrar={() => { setResolver(null); void qc.invalidateQueries({ queryKey: ["arbol-producto"] }); }} />
      )}
      {crearCombo && <CrearComboVentana refProducto={crearCombo.ref} nombre={crearCombo.nombre} onCerrar={() => setCrearCombo(null)} />}
      {datos.data?.sin_senal?.length ? (
        <p className="text-[11px] text-ink-secondary">Sin señal de: {datos.data.sin_senal.map((s) => s.fuente).join(", ")}.</p>
      ) : null}
    </div>
  );
}

function ListaSinCombo({ filas, onCrear }: { filas: SinCombo[]; onCrear: (f: SinCombo) => void }) {
  if (!filas.length) return <p className="p-4 text-sm font-bold">Todo lo comprado tiene al menos una presentación de venta.</p>;
  return (
    <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {filas.map((f) => (
        <li key={f.ref} className="ap-hoja ap-falta flex items-center gap-2 px-2.5 py-1.5">
          <Sprite s="alerta" px={2} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-extrabold" title={f.nombre}>{f.nombre}</span>
            <span className="flex items-center gap-1">
              <code className="text-[10.5px] text-ink-secondary">{f.ref}</code>
              <CopiarSku sku={f.ref} />
            </span>
          </span>
          <button type="button" className="ap-btn" onClick={() => onCrear(f)}>Crear su combo</button>
        </li>
      ))}
    </ul>
  );
}

function ListaArbol({ categorias, total, completas, sel, abiertasTodas, sinCombo, onCategoria, onFamilia }: {
  categorias: RespuestaArbol["categorias"];
  total: number;
  completas: number;
  sel: Seleccion;
  abiertasTodas: boolean;
  sinCombo: number;
  onCategoria: (nombre: string) => void;
  onFamilia: (cat: string, f: Familia) => void;
}) {
  // La categoría elegida se abre sola; volver a tocarla la recoge (y otra vez la abre).
  const [recogida, setRecogida] = useState<string | null>(null);
  return (
    <nav aria-label="Categorías" className="ap-carta flex max-h-[45vh] min-h-0 flex-col overflow-hidden lg:max-h-none">
      <div className="ap-cab ap-cab-navy shrink-0">
        <span className="min-w-0 flex-1">Categorías</span>
        <span className="tabular-nums">{completas}/{total}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {categorias.map((c) => {
          const abierta = abiertasTodas || (c.nombre === sel.cat && recogida !== c.nombre);
          const pct = c.total ? Math.round((c.completas / c.total) * 100) : 0;
          return (
            <div key={c.nombre}>
              <button type="button" aria-expanded={abierta}
                onClick={() => {
                  if (c.nombre === sel.cat) {
                    setRecogida(abierta ? c.nombre : null);
                    if (abierta) return;
                  } else {
                    setRecogida(null);
                  }
                  onCategoria(c.nombre);
                }}
                className={`ap-cat ${c.nombre === sel.cat ? "ap-cat-on" : ""}`}>
                <span className="w-3 text-[9px]">{abierta ? "▼" : "▶"}</span>
                <span className="min-w-0 flex-1 truncate">{c.nombre}</span>
                <span className="ap-barra" title={`${c.completas} de ${c.total} completos`}>
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="ap-cuenta w-6 shrink-0 text-right">{c.total}</span>
              </button>
              {abierta && (
                <div className="ap-rama-lista">
                  {c.familias.map((f) => {
                    const aqui = c.nombre === sel.cat && f.clave === sel.fam;
                    return (
                      <button key={f.clave} type="button" onClick={() => onFamilia(c.nombre, f)} aria-current={aqui ? "true" : undefined}
                        title={`${f.nombre}${f.mp_sku ? ` · ${f.mp_sku}` : ""} · ${f.completas}/${f.total} completos`}
                        className={`ap-fam ${aqui ? "ap-fam-on" : ""}`}>
                        <span className={`h-2.5 w-2.5 ${PUNTO[estadoFamilia(f)]}`} />
                        <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
                        <span className="ap-cuenta">{f.total}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {sinCombo > 0 && (
          <button type="button" onClick={() => onCategoria(SIN_COMBO)} aria-pressed={sel.cat === SIN_COMBO}
            className={`ap-cat ap-sin-combo mt-1 ${sel.cat === SIN_COMBO ? "ap-cat-on" : ""}`}>
            <Sprite s="alerta" px={2} />
            <span className="min-w-0 flex-1">Comprados sin combo</span>
            <span className="ap-cuenta">{sinCombo}</span>
          </button>
        )}
      </div>
    </nav>
  );
}

function Fila({ estado, titulo, valor, onClick, accion }: { estado: Estado; titulo: string; valor: ReactNode; onClick?: () => void; accion?: string }) {
  const cuerpo = (
    <>
      <span className={`h-3 w-3 ${PUNTO[estado]}`} />
      <span className="w-16 shrink-0 text-[12px] font-extrabold">{titulo}</span>
      <span className="min-w-0 flex-1 text-[11.5px] text-ink-secondary">{valor}</span>
      {onClick && accion && <span className="ap-ir">{accion} →</span>}
    </>
  );
  const clase = `ap-fila ${CAJA[estado]}`;
  return onClick ? <button type="button" onClick={onClick} className={clase}>{cuerpo}</button> : <div className={clase}>{cuerpo}</div>;
}

function DetallePresentacion({ p, familia, categoria, destino, setDestino, onAviso, onPieza, onCanales, onEditarEtiqueta, onFotosCambiaron, onSkuCambiado }: {
  p: Presentacion;
  familia: Familia;
  categoria: string;
  destino: Canal;
  setDestino: (c: Canal) => void;
  onAviso: (t: string) => void;
  /** Abrir el emergente de una pieza de este combo (encima del árbol). */
  onPieza: (pieza: string) => void;
  onCanales: () => void;
  onEditarEtiqueta: (fichaId: string) => void;
  onFotosCambiaron: () => void;
  /** Se corrigió el SKU del combo en Alegra (solo sin movimientos). */
  onSkuCambiado: (nuevo: string) => void | Promise<void>;
}) {
  const e = p.piezas.etiquetas;
  const otraCarpeta = e.categoria_png && e.categoria_png !== categoria ? e.categoria_png : "";
  const precioMeli = p.piezas.meli.precio;
  const fotos = useFotosProducto(p.ref, onFotosCambiaron);
  const pendiente = siguientePieza(p, familia);

  // Ctrl+V en cualquier parte del árbol pega la imagen en la columna de fotos marcada. Un
  // emergente abierto (editor, documento, kit del taller) o un campo de texto se quedan su pegado.
  useEffect(() => {
    const alPegar = (ev: ClipboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const files = imagenesDe(ev.clipboardData);
      if (!files.length) return;
      ev.preventDefault();
      void fotos.subir(files, destino);
    };
    window.addEventListener("paste", alPegar);
    return () => window.removeEventListener("paste", alPegar);
  }, [fotos, destino]);
  useEffect(() => {
    if (fotos.aviso) onAviso(fotos.aviso.texto);
  }, [fotos.aviso]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="ap-carta flex flex-col">
        <div className="ap-cab ap-cab-navy">
          <span className="min-w-0 flex-1 truncate" title={p.nombre}>{p.nombre}</span>
          <code className="shrink-0 normal-case">{p.ref}</code>
          <CopiarSku sku={p.ref} />
          <CambiarSku sku={p.ref} onCambiado={onSkuCambiado} />
        </div>
        <div className="flex flex-col gap-2 p-2.5">
        <p className="ap-t">
          Etiqueta y foto por canal{e.tamano ? ` · ${e.tamano}` : ""}
        </p>
        {/* Cada canal es una columna: su etiqueta (para hacer la foto) y debajo las fotos ya hechas con ella. */}
        <div className="grid grid-cols-2 gap-2">
          {(["web", "meli"] as Canal[]).map((c) => (
            <div key={c} className="flex min-w-0 flex-col gap-1.5">
              <VarianteEtiqueta p={p} v={c} onAviso={onAviso} onCrear={() => onPieza("etiqueta")} />
              <FotosCanal canal={c} fotos={fotos} pieza={p.piezas.fotos} activo={destino === c} onActivar={() => setDestino(c)} />
            </div>
          ))}
        </div>
        {fotos.subiendo > 0 && <p className="ap-mensaje">Guardando {fotos.subiendo} foto(s)…</p>}
        {e.estado !== "ok" && <p className={`ap-nota ${CAJA[e.estado]}`}>{e.detalle}</p>}
        {otraCarpeta && (
          <p className="ap-nota ap-aviso">
            Los PNG están en la carpeta «{otraCarpeta}» del Studio, no en «{categoria}».
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {e.etiqueta_id ? (
            <button type="button" className="ap-btn ap-btn-sec" onClick={() => onEditarEtiqueta(e.etiqueta_id!)}>Editar etiqueta</button>
          ) : (
            <button type="button" className="ap-btn ap-btn-sec" onClick={() => onPieza("etiqueta")}>Crear etiqueta →</button>
          )}
          {pendiente ? (
            <button type="button" className="ap-btn ap-btn-amarillo" onClick={() => onPieza(pendiente)} title="Abre la primera pieza que falta, con su guía">
              Resolver lo que falta →
            </button>
          ) : p.piezas.fotos.estado !== "ok" ? (
            <button type="button" className="ap-btn ap-btn-amarillo" title="Pega la foto de producto bajo su etiqueta"
              onClick={() => {
                const c = p.piezas.fotos.canales;
                setDestino(!c?.web?.n || c.web.desactualizada ? "web" : "meli");
                onAviso("Solo falta la foto: cópiala (Ctrl+C) y pégala con Ctrl+V en la columna marcada.");
              }}>
              Solo falta la foto ↑
            </button>
          ) : (
            <button type="button" className="ap-btn" disabled>Todo conectado</button>
          )}
        </div>
        </div>
      </div>

      <div className="ap-carta flex flex-col">
        <div className="ap-cab ap-cab-amarilla">
          <Sprite s="moneda" px={2} />
          <span className="min-w-0 flex-1">¿Se puede vender y facturar?</span>
          <span className="tabular-nums">{p.listas}/{TOTAL_PIEZAS}</span>
        </div>
        <div className="flex flex-col gap-1.5 p-2.5">
        {p.desplegado && (
          <p className={`ap-nota ${p.desplegado.activo ? "ap-ok" : "ap-aviso"}`}>
            {p.desplegado.activo
              ? "Activo y publicado en MeLi y en la página web: su SKU ya se factura. Fotos o documentos pendientes no lo frenan."
              : "No está a la venta: en el despliegue solo vuelven los productos cuyo SKU se puede facturar."}
          </p>
        )}
        <Fila estado={p.alegra.estado} titulo="Alegra" valor={`${p.alegra.detalle}${p.precio_lista ? ` · lista ${pesos(p.precio_lista)}` : ""}`} onClick={() => onPieza("receta")} accion="resolver" />
        <Fila estado={p.piezas.receta.estado} titulo="Receta" valor={p.piezas.receta.detalle} onClick={() => onPieza(p.piezas.receta.pieza_taller || "receta")} accion="resolver" />
        <Fila estado={p.piezas.factura.estado} titulo="Factura" valor={p.piezas.factura.detalle} onClick={onCanales} accion="canales" />
        <Fila estado={p.piezas.ean.estado} titulo="EAN" valor={p.piezas.ean.codigo || p.piezas.ean.detalle} onClick={() => onPieza("ean")} accion="resolver" />
        <Fila estado={familia.documento.estado} titulo="Doc. técnico" valor={familia.documento.detalle || "Sin documento"} onClick={() => onPieza("documento")} accion="resolver" />
        <Fila estado={p.piezas.fotos.estado} titulo="Fotos" valor={p.piezas.fotos.detalle} />
        <Fila estado={p.piezas.meli.estado} titulo="MeLi"
          valor={p.piezas.meli.permalink
            ? <a href={p.piezas.meli.permalink} target="_blank" rel="noreferrer" className="underline" onClick={(ev) => ev.stopPropagation()}>{p.piezas.meli.detalle}{precioMeli ? ` · ${pesos(precioMeli)}` : ""}</a>
            : <>{p.piezas.meli.detalle}{precioMeli ? ` · ${pesos(precioMeli)}` : ""}</>}
          onClick={() => onPieza("publicacion")} accion="publicar" />
        <Fila estado={p.piezas.web.estado} titulo="Web" valor={p.piezas.web.detalle} onClick={() => onPieza("publicacion")} accion="publicar" />
        <button type="button" className="ap-btn ap-btn-sec mt-1" onClick={onCanales}>Ver en Canales del producto</button>
        </div>
      </div>
    </>
  );
}
