import { Ico } from "../../icons/Ico";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, lazy, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { usePanelTheme } from "../../stores/panelTheme";
import AsignarEan from "./AsignarEan";
import InspectorEtiquetaReceta from "./InspectorEtiquetaReceta";
import InspectorReceta from "./InspectorReceta";
import EnlazarDocumento from "./EnlazarDocumento";
import { ponerSonido, sonarMoneda, sonidoActivo } from "./sonidoMoneda";
import EtiquetaEmergente from "./EtiquetaEmergente";
import type { EntradaFormularioEtiqueta } from "../etiqueta-ficha/ProductLabelForm";
import KitEmergente from "./KitEmergente";
import PublicacionEmergente from "./PublicacionEmergente";
import VentanaTaller from "./VentanaTaller";

// Los apartados que resuelven piezas, montados en ventanas sobre el taller (cargados al abrirlas).
const CodigosEanPanel = lazy(() => import("../etiquetas/CodigosEanPanel").then((m) => ({ default: m.CodigosEanPanel })));
const FichasTecnicasPanel = lazy(() => import("../FichasTecnicasPanel"));
const CrearProductosSiigoPanel = lazy(() => import("../CrearProductosSiigoPanel"));
const CatalogoAlegraPanel = lazy(() => import("../CatalogoAlegraPanel"));

/** Qué apartado está abierto en ventana sobre el taller. */
type Ventana =
  | { tipo: "ean"; combo: Combo }
  | { tipo: "docs"; combo: Combo }
  | { tipo: "componente"; combo: Combo; codigo: string; nombre: string }
const VentanaCtx = createContext<(v: Ventana) => void>(() => {});
import { AccionRanura, BTN, BTN_SEC, CASILLA, EQUIPO, EtiquetaPng, cantidad, type Combo, type Eslabon, type MateriaPrima, type Respuesta } from "./comun";
import { celebrarAprobacion } from "../../lib/celebracionAprobado";

/**
 * Las piezas de un combo y cómo se resuelve cada una. Antes era el «taller de combos» (un panel
 * aparte con su tablero); desde el 27-sep-2026 vive dentro de Diseño de producto → Studio →
 * Árbol del producto: el árbol muestra el combo y sus piezas, y al tocar una se abre AQUÍ su
 * emergente, sobre el árbol, sin cambiar de pantalla.
 *
 * Seis piezas: receta, etiqueta en la receta, documento, código EAN, diseño de etiqueta y
 * publicación (y las fotos de la vitrina). Cada emergente lleva arriba la pregunta que guía y
 * abajo «siguiente pendiente». Lo que exige otra herramienta (Códigos EAN, Docs técnicos, el kit
 * de Alegra, Crear en Alegra) se abre en una VENTANA encima. Al completar las seis piezas suena
 * la moneda y se celebra.
 *
 * No crea una segunda vía de escritura: usa POST /api/etiquetas/codigos-ean, fijar-sku y
 * app/tools/etiquetas_fichas (vía /api/mapa-sistema/etiqueta/<id>), con sus mismos permisos.
 */

type Propuesta = { sku: string; nombre_producto: string; numero_producto: number; presentacion: string; anio: number; bimestre: number; codigo_previsto: string };
type FichaEtiqueta = { id: string; nombre: string; tipo_nombre?: string; plantilla_id?: string; categoria?: string; data: Record<string, string> };
type RespEtiqueta = { ficha: FichaEtiqueta; opciones: { tamanos: string[]; plantillas: { id: string; nombre: string; categoria: string; tipo_nombre: string }[] } };
type FilaProducto = { ref: string; nombre: string; combo: string };

/** Ir a editar una pieza en SU apartado, dejando en el cabezote el botón para volver a este combo. */
function useSalto(c: Combo) {
  const saltar = useAppStore((s) => s.saltarDesdeTaller);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const setDocsTab = useAppStore((s) => s.setDocsTab);
  const setEanPrefill = useAppStore((s) => s.setEanPrefill);
  const abrir = useContext(VentanaCtx);
  const accionDoc = c.eslabones.documento?.accion;
  // Si el documento aún no está unido por SKU, Docs técnicos ofrecerá asociarlo a este combo.
  const docEsl = c.eslabones.documento;
  const mpsReceta = c.componentes.filter((x) => x.casilla === "materia_prima").map((x) => ({ codigo: x.codigo, nombre: x.nombre }));
  const retorno = {
    ref: c.ref,
    nombre: c.nombre,
    mps: (accionDoc && "mps" in accionDoc && accionDoc.mps) || mpsReceta,
    asociarDoc: Boolean(accionDoc),
    doc: docEsl ? { archivo: docEsl.archivo, titulo: docEsl.doc_titulo, detalle: docEsl.detalle, estado: docEsl.estado } : undefined,
  };
  return {
    studio: (fichaId?: string) => {
      setEtiquetasTab("studio");
      saltar(retorno, { panel: "etiquetas", fichaId, buscar: fichaId ? undefined : c.nombre });
    },
    // EAN, documento y componentes se resuelven en una ventana sobre el taller: no se sale del combo.
    ean: () => {
      // Sin código: el formulario de alta ya escrito. Con código: solo la lista filtrada en ese combo
      // (precargar el alta invitaría a registrarle un segundo código).
      if (c.eslabones.ean?.estado !== "ok") setEanPrefill({ sku: c.ref, nombre: c.nombre });
      abrir({ tipo: "ean", combo: c });
    },
    docs: (_buscar?: string) => {
      // Docs técnicos lee el combo del store (tarjeta «Documento del combo») y abre el editor.
      useAppStore.setState({ tallerRetorno: retorno, tallerSalto: null });
      setDocsTab("completo");
      abrir({ tipo: "docs", combo: c });
    },
    publicaciones: () => {
      const e = c.eslabones.publicacion;
      const pieza = e ? { clave: "publicacion", titulo: e.titulo, estado: e.estado, detalle: e.detalle, meli_id: e.meli_id, precio: e.precio } : undefined;
      saltar({ ...retorno, pieza, precioLista: c.precio_lista ?? undefined }, { panel: "publicaciones", sku: c.ref });
    },
    inventario: (codigo: string) => {
      // Catálogo Alegra lee la búsqueda de `tallerSalto` al montarse (solo consulta; editar es explícito allí).
      useAppStore.setState({ tallerSalto: { panel: "catalogo-alegra", buscar: codigo } });
      abrir({ tipo: "componente", combo: c, codigo, nombre: c.componentes.find((x) => x.codigo === codigo)?.nombre ?? codigo });
    },
    alegra: () => {
      navigator.clipboard?.writeText(c.ref).catch(() => null);
      saltar(retorno, { panel: "catalogo-alegra", buscar: c.ref });
    },
  };
}

const TOTAL = EQUIPO.length;
const ORDEN_GUIA = ["receta", "etiqueta_fisica", "documento", "ean", "etiqueta", "publicacion"];

const CAMPOS_ETIQUETA: { clave: string; nombre: string; largo?: boolean }[] = [
  { clave: "productName", nombre: "Nombre en la etiqueta", largo: true },
  { clave: "netContent", nombre: "Contenido neto" },
  { clave: "barcode", nombre: "Código de barras" },
  { clave: "classification", nombre: "Clasificación" },
  { clave: "composition", nombre: "Composición", largo: true },
  { clave: "origin", nombre: "Origen" },
  { clave: "storage", nombre: "Conservación", largo: true },
];

/** La foto con la que se vende no está al día (no tiene, es de otra presentación, o muestra la etiqueta anterior). */
function fotoPendiente(c: Combo) {
  return Boolean(c.foto_estado && c.foto_estado !== "ok");
}
function completo(c: Combo) {
  return c.ok === TOTAL;
}
function textoEstado(e: Eslabon) {
  return e.estado === "ok" ? "conectado" : e.estado === "aviso" ? "por revisar" : "ranura vacía";
}

function InspectorEan({ c, alResolver }: { c: Combo; alResolver: () => Promise<void> }) {
  const salto = useSalto(c);
  const e = c.eslabones.ean;
  const puedeProponer = e.estado === "falta" && Boolean(e.accion);
  const prop = useQuery({
    queryKey: ["mision-ean-propuesto", c.ref],
    queryFn: () => api.get<Propuesta>(`/api/mapa-sistema/combos/${encodeURIComponent(c.ref)}/ean-propuesto`),
    enabled: puedeProponer,
    retry: false,
  });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asignando, setAsignando] = useState(false);
  useEffect(() => setAsignando(false), [c.ref]);
  const irAEan = salto.ean;

  if (e.estado === "ok")
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-accent-leaf/50 bg-accent-leaf/10 p-3 text-center font-mono text-lg tracking-[0.25em] text-ink">{e.codigo}</div>
        <button className={BTN_SEC} onClick={irAEan}>Ver o corregir el código…</button>
      </div>
    );
  if (!puedeProponer) return <p className="text-[11.5px] text-muted">Primero hay que arreglar la receta: a un combo con la receta rota no se le gasta un código.</p>;
  // Antes de gastar un número nuevo: ¿ya hay un código registrado que sea de este producto?
  if (asignando) return <AsignarEan c={c} onCancelar={() => setAsignando(false)} onHecho={async () => { setAsignando(false); await alResolver(); }} />;
  return (
    <div className="space-y-2">
      {prop.isLoading && <p className="text-[11.5px] text-muted">Calculando el siguiente código libre…</p>}
      {prop.isError && <p className="text-[11.5px] text-accent-rose">{(prop.error as Error)?.message}</p>}
      {prop.data && (
        <>
          <div className="rounded-lg border border-dashed border-accent/60 bg-accent/5 p-3 text-center">
            <div className="font-mono text-lg tracking-[0.25em] text-ink">{prop.data.codigo_previsto}</div>
            <div className="mt-1 font-mono text-[9.5px] text-muted">
              770 · producto {String(prop.data.numero_producto).padStart(3, "0")} · presentación {prop.data.presentacion} · {prop.data.anio}/{prop.data.bimestre}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={BTN}
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                setError(null);
                try {
                  const { codigo_previsto: _previsto, ...cuerpo } = prop.data!;
                  await api.post("/api/etiquetas/codigos-ean", cuerpo);
                  await alResolver();
                } catch (err) {
                  setError((err as Error)?.message || "No se pudo crear el código");
                } finally {
                  setOcupado(false);
                }
              }}
            >
              {ocupado ? "Creando…" : "Crear este código"}
            </button>
            <button className={BTN_SEC} onClick={irAEan}>Ajustarlo antes de crearlo…</button>
          </div>
        </>
      )}
      <button className={`${BTN_SEC} w-full`} onClick={() => setAsignando(true)}>
        ¿Ya tiene un código registrado? Buscarlo y asignarlo…
      </button>
      {error && <p className="text-[11.5px] text-accent-rose">{error}</p>}
    </div>
  );
}

/**
 * La etiqueta se diseña en un emergente dentro del taller (EtiquetaEmergente), no saltando al Studio.
 * El emergente vive en este envoltorio y no en el cuerpo: al crear la etiqueta el combo cambia de
 * rama (sin etiqueta → con etiqueta) y el emergente se cerraría a mitad de edición. El taller se
 * vuelve a leer al cerrarlo.
 * Si el combo ya tiene etiqueta, tocar la pieza abre de una vez el editor (formato y exportación);
 * al cerrarlo se cierra también la pieza. Sin etiqueta queda el cuerpo, que ofrece crearla.
 */
function InspectorEtiqueta({ c, hermanas, alResolver, cerrarPieza }: {
  c: Combo; hermanas: Combo[]; alResolver: () => Promise<void>; cerrarPieza?: () => void;
}) {
  const salto = useSalto(c);
  const qc = useQueryClient();
  const idInicial = c.eslabones.etiqueta?.etiqueta_id;
  const [editor, setEditor] = useState<EntradaFormularioEtiqueta | null>(idInicial ? { fichaId: idInicial } : null);
  const directo = useRef(Boolean(idInicial));
  const cerrar = () => {
    setEditor(null);
    if (directo.current) {
      directo.current = false;
      cerrarPieza?.();
    }
    void qc.invalidateQueries({ queryKey: ["mision-etiqueta"] });
    void alResolver();
  };
  return (
    <>
      <InspectorEtiquetaCuerpo c={c} hermanas={hermanas} alResolver={alResolver} abrirEditor={setEditor} />
      {editor && (
        <EtiquetaEmergente
          entrada={editor}
          combo={c.presentacion ? `${c.nombre} · ${c.presentacion}` : c.nombre}
          aprobados={c.eslabones.etiqueta}
          onCerrar={cerrar}
          onAbrirEnStudio={() => {
            const fichaId = editor.fichaId ?? undefined;
            setEditor(null);
            salto.studio(fichaId);
          }}
        />
      )}
    </>
  );
}

function InspectorEtiquetaCuerpo({ c, hermanas, alResolver, abrirEditor }: {
  c: Combo; hermanas: Combo[]; alResolver: () => Promise<void>; abrirEditor: (entrada: EntradaFormularioEtiqueta) => void;
}) {
  const e = c.eslabones.etiqueta;
  const ean = c.eslabones.ean?.codigo || "";
  const ficha = useQuery({
    queryKey: ["mision-etiqueta", e.etiqueta_id],
    queryFn: () => api.get<RespEtiqueta>(`/api/mapa-sistema/etiqueta/${e.etiqueta_id}`),
    enabled: Boolean(e.etiqueta_id),
    retry: false,
  });
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [tamano, setTamano] = useState("");
  const [plantilla, setPlantilla] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => {
    const f = ficha.data?.ficha;
    if (!f) return;
    setCampos(Object.fromEntries(CAMPOS_ETIQUETA.map(({ clave }) => [clave, f.data[clave] ?? ""])));
    setTamano(f.tipo_nombre ?? "");
    setPlantilla(f.plantilla_id ?? "");
    setMsg(null);
  }, [ficha.data]);

  const irAlStudio = () => abrirEditor({ fichaId: e.etiqueta_id });

  if (!e.etiqueta_id)
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-muted">{e.detalle}</p>
        {hermanas.filter((h) => h.ref !== c.ref && h.eslabones.etiqueta?.etiqueta_id).map((h) => (
          <div key={h.ref} className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
            La presentación <b>{h.presentacion || h.nombre}</b> ya tiene etiqueta{h.eslabones.etiqueta.tamano ? <> en tamaño <b>{h.eslabones.etiqueta.tamano}</b></> : null}. Sirve de punto de partida, pero esta presentación lleva la suya, con su propio tamaño y plantilla.
            <button className={`${BTN_SEC} mt-1.5`} onClick={() => abrirEditor({ fichaId: h.eslabones.etiqueta.etiqueta_id })}>Ver la de {h.presentacion || h.ref} →</button>
          </div>
        ))}
        {e.accion ? (
          <button className={BTN} onClick={() => abrirEditor({ sku: c.ref })}>Diseñar la de esta presentación</button>
        ) : (
          <p className="text-[11.5px] text-muted">La etiqueta se diseña cuando el combo ya tiene su código EAN.</p>
        )}
      </div>
    );
  if (ficha.isLoading) return <p className="text-[11.5px] text-muted">Abriendo la etiqueta…</p>;
  if (ficha.isError || !ficha.data)
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-accent-rose">{(ficha.error as Error)?.message || "No se pudo abrir la etiqueta"}</p>
        <button className={BTN_SEC} onClick={irAlStudio}>Abrir el editor de la etiqueta</button>
      </div>
    );

  const f = ficha.data.ficha;
  const cambios = Object.fromEntries(CAMPOS_ETIQUETA.filter(({ clave }) => (campos[clave] ?? "") !== (f.data[clave] ?? "")).map(({ clave }) => [clave, campos[clave] ?? ""]));
  const hayCambios = Object.keys(cambios).length > 0 || tamano !== (f.tipo_nombre ?? "") || plantilla !== (f.plantilla_id ?? "");
  const guardar = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      await api.post(`/api/mapa-sistema/etiqueta/${f.id}`, {
        campos: cambios,
        ...(tamano !== (f.tipo_nombre ?? "") ? { tipo_nombre: tamano } : {}),
        ...(plantilla !== (f.plantilla_id ?? "") ? { plantilla_id: plantilla } : {}),
      });
      await ficha.refetch();
      await alResolver();
      setMsg({ ok: true, texto: "Guardado en la etiqueta. Para volver a sacar el PNG, ábrela en el editor." });
    } catch (err) {
      setMsg({ ok: false, texto: (err as Error)?.message || "No se pudo guardar" });
    } finally {
      setOcupado(false);
    }
  };
  const entrada = "w-full rounded-md border border-border bg-surface-input px-2 py-1 text-[12px] text-ink";

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted">«{f.nombre}»</p>
      <PngAprobados e={e} variantes={["impresion"]} />
      {ean && (campos.barcode ?? "") !== ean && (
        <div className="rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11px] text-ink">
          La etiqueta {campos.barcode ? <>lleva el código <code>{campos.barcode}</code></> : "no lleva código"} y el combo tiene <code>{ean}</code>. Por eso no están conectados.
          <button className={`${BTN} ml-2`} onClick={() => setCampos((v) => ({ ...v, barcode: ean }))}>Usar el del combo</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          Tamaño de etiqueta
          <select className={`${entrada} mt-0.5`} value={tamano} onChange={(ev) => setTamano(ev.target.value)}>
            {!tamano && <option value="">— sin definir —</option>}
            {ficha.data.opciones.tamanos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          Plantilla
          <select className={`${entrada} mt-0.5`} value={plantilla} onChange={(ev) => setPlantilla(ev.target.value)}>
            {!plantilla && <option value="">— sin plantilla —</option>}
            {ficha.data.opciones.plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre.replace(/^Plantilla de /, "")}</option>)}
          </select>
        </label>
      </div>
      {CAMPOS_ETIQUETA.map(({ clave, nombre, largo }) => (
        <label key={clave} className="block text-[10px] font-bold uppercase tracking-wide text-muted">
          {nombre}
          {largo ? (
            <textarea rows={2} className={`${entrada} mt-0.5 font-normal normal-case`} value={campos[clave] ?? ""} onChange={(ev) => setCampos((v) => ({ ...v, [clave]: ev.target.value }))} />
          ) : (
            <input className={`${entrada} mt-0.5 font-normal normal-case`} value={campos[clave] ?? ""} onChange={(ev) => setCampos((v) => ({ ...v, [clave]: ev.target.value }))} />
          )}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className={BTN} disabled={!hayCambios || ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar en la etiqueta"}</button>
        <button className={BTN_SEC} onClick={irAlStudio}>Diseñar la etiqueta (formato y exportación)</button>
      </div>
      {msg && <p className={`text-[11px] ${msg.ok ? "text-accent-leaf" : "text-accent-rose"}`}>{msg.texto}</p>}
    </div>
  );
}

/** Los archivos de «Terminar y aprobar»: Diseño muestra solo el PNG de impresión; Publicación
 *  muestra los dos, porque el de impresión también va a la web y el digital (marca desenfocada)
 *  a las publicaciones. Aprobar otra vez los reescribe. */
function PngAprobados({ e, variantes }: { e?: Eslabon; variantes: ("impresion" | "digital")[] }) {
  if (!e?.png && !e?.png_digital)
    return e?.etiqueta_id ? <p className="text-[11px] text-muted">La etiqueta aún no tiene PNG aprobados (los aprueba Cynthia con «Terminar y aprobar»).</p> : null;
  const archivos = variantes.map((v) => (v === "impresion" ? { titulo: "Impresión", nombre: e.png } : { titulo: "Digital", nombre: e.png_digital }));
  const uno = archivos.length === 1;
  return (
    <div>
      <p className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">
        Etiqueta aprobada{uno ? ` · ${archivos[0].titulo.toLowerCase()}` : ""}{e.aprobado_at ? ` · ${e.aprobado_at.slice(0, 10)}` : ""}
      </p>
      <div className={uno ? "" : "grid grid-cols-2 gap-1.5"}>
        {archivos.map(({ titulo, nombre }) => (
          <div key={titulo} className="min-w-0 rounded-md border border-border bg-surface p-1">
            {nombre ? <EtiquetaPng nombre={nombre} /> : <div className="flex h-28 items-center justify-center text-[11px] text-muted">Sin PNG {titulo.toLowerCase()}</div>}
            {!uno && <p className="truncate px-0.5 pt-0.5 text-[10px] text-muted" title={nombre || undefined}>{titulo}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectorDocumento({ c, alResolver }: { c: Combo; alResolver: () => Promise<void> }) {
  const salto = useSalto(c);
  const e = c.eslabones.documento;
  const a = e.accion;
  const mps: MateriaPrima[] = (a && "mps" in a && a.mps) || [];
  const [elegir, setElegir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    setElegir(false);
    setError(null);
    setMotivo("");
  }, [c.ref]);

  const marcarNoRequiere = async (valor: boolean) => {
    setOcupado(true);
    setError(null);
    try {
      await api.post(`/api/mapa-sistema/combos/${encodeURIComponent(c.ref)}/documento-no-requerido`, { no_requiere: valor, motivo });
      await alResolver();
    } catch (err) {
      setError((err as Error)?.message || "No se pudo guardar");
    } finally {
      setOcupado(false);
    }
  };

  if (e.no_requiere) {
    return (
      <div className="space-y-2.5">
        <p className="text-[11.5px] text-muted">{e.detalle}</p>
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked disabled={ocupado} onChange={() => marcarNoRequiere(false)} />
          No requiere documento técnico
        </label>
        <p className="text-[11px] text-muted">Desmárcala si esta publicación sí debe llevar ficha técnica, COA y SDS.</p>
        {error && <p className="text-[11px] text-accent-rose">{error}</p>}
      </div>
    );
  }

  const unir = async (archivo: string, codigo: string, compartir: boolean) => {
    setOcupado(true);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; errores: { error: string }[] }>("/api/mapa-sistema/documentos/fijar-sku", { items: [{ archivo, sku: codigo, compartir }] });
      if (!r.ok) throw new Error(r.errores[0]?.error || "No se pudo unir");
      setElegir(false);
      await alResolver();
    } catch (err) {
      setError((err as Error)?.message || "No se pudo unir");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {e.doc_titulo && <p className="text-[12px] font-bold text-ink"><Ico e="📄" /> {e.doc_titulo}</p>}
      <p className="text-[11.5px] text-muted">{e.detalle}</p>
      {/* Un solo botón: revisar, completar y dar el visto bueno se hace en el editor de Docs técnicos
          (en una ventana sobre el taller). Generar el documento final marca revisadas todas las
          presentaciones que lo heredan. */}
      <button className={BTN} onClick={() => salto.docs(e.doc_titulo || mps[0]?.nombre.split(" ").slice(0, 2).join(" ") || c.nombre)}>
        {e.estado === "falta" ? "Redactar el documento…" : e.estado === "ok" ? "Abrir el documento…" : "Revisar, completar y dar el visto bueno…"}
      </button>

      {!c.componentes.some((x) => x.casilla === "materia_prima") && e.estado !== "ok" && (
        <p className="rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11px] text-ink">
          Este combo no tiene una materia prima reconocible en su receta, y el documento se une a la materia prima. Arregla primero la pieza «Receta».
        </p>
      )}
      {!a && e.estado !== "ok" && c.componentes.some((x) => x.casilla === "materia_prima") && (
        <p className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
          El documento <b>ya está unido</b> a su materia prima; lo que falta es su contenido (está como «{e.detalle.split(" · ")[0]}»). Se completa y se firma en Docs técnicos.
        </p>
      )}

      {/* Lo que el sistema encontró por nombre */}
      {a?.tipo === "fijar_sku" && !elegir && (
        <div className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
          <div><Ico e="⚗️" /> <b>{a.mp_nombre}</b> <code className="text-muted">{a.sku}</code></div>
          <div className="mt-1 text-muted">
            {a.modo === "reemplazar" ? (
              <>El documento declara <code>{a.referencia_actual}</code>, que <b>no es un producto activo</b> en Alegra: era un enlace roto. Se corrige a <code>{a.sku}</code>.</>
            ) : a.modo === "compartir" ? (
              <>El documento ya pertenece a <code>{a.referencia_actual}</code>, otro producto activo. Si los dos son la misma sustancia, se comparte; si no, elige otro documento.</>
            ) : (
              <>¿Son el mismo producto? Se escribe <code>referencia: {a.sku}</code> en el documento y todos los combos de esa materia prima lo heredan.</>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={BTN} disabled={ocupado} onClick={() => unir(a.archivo, a.sku, a.modo === "compartir")}>
              {ocupado ? "Uniendo…" : a.modo === "reemplazar" ? "Sí, corregir el enlace" : a.modo === "compartir" ? "Sí, compartir el documento" : "Sí, unir por SKU"}
            </button>
            <button className={BTN_SEC} onClick={() => setElegir(true)}>No es ese: elegir otro…</button>
          </div>
        </div>
      )}

      {/* Elegir el documento a mano */}
      {mps.length > 0 && a?.tipo !== "fijar_sku" && !elegir && e.estado !== "ok" && (
        <button className={BTN} onClick={() => setElegir(true)}>Enlazar un documento que ya existe…</button>
      )}
      {elegir && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-2">
          <EnlazarDocumento mps={mps} inicial="" onCancelar={() => setElegir(false)} onHecho={async () => { setElegir(false); await alResolver(); }} />
        </div>
      )}
      {error && <p className="text-[11px] text-accent-rose">{error}</p>}

      {/* Hay publicaciones que no llevan documento técnico (empaques, accesorios…). */}
      {e.estado !== "ok" && (
        <div className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={false} disabled={ocupado} onChange={() => marcarNoRequiere(true)} />
            No requiere documento técnico
          </label>
          <input
            className="mt-1.5 w-full rounded border border-border bg-surface-input px-2 py-1 text-[11px]"
            placeholder="Motivo (opcional): p. ej. es un envase vacío"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function Inspector({ c, clave, hermanas, alResolver, abrirPublicacion, irA, cerrarPieza }: {
  c: Combo; clave: string; hermanas: Combo[]; alResolver: () => Promise<void>;
  /** La publicación se revisa en un emergente sobre el taller, no saltando a Publicaciones. */
  abrirPublicacion: () => void;
  /** Pasar a otra pieza del mismo combo (p. ej. de «Etiqueta en la receta» a «Receta»). */
  irA?: (clave: string) => void;
  /** Cerrar el emergente de la pieza (el editor de etiqueta lo usa al cerrarse). */
  cerrarPieza?: () => void;
}) {
  const salto = useSalto(c);
  const [kitAbierto, setKitAbierto] = useState(false);
  useEffect(() => setKitAbierto(false), [c.ref, clave]);
  const e = c.eslabones[clave];
  if (clave === "fotos") {
    const fotos = c.fotos?.length ? c.fotos : c.foto ? [c.foto] : [];
    return (
      <div className="space-y-2.5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-lg leading-none"><Ico e="🖼️" /></span>
          <h4 className="mck-flujo-nodo text-[13px] font-bold text-ink">Fotos del producto</h4>
          <span className={`ml-auto font-mono text-[9.5px] font-bold uppercase ${fotos.length ? "text-accent-leaf" : "text-accent-rose"}`}>{fotos.length ? `${fotos.length} foto${fotos.length === 1 ? "" : "s"}` : "sin foto"}</span>
        </div>
        {fotoPendiente(c) && (
          <p className="rounded-md border border-accent-sun/60 bg-accent-sun/10 p-2 text-[11.5px] text-ink"><b>Foto por actualizar.</b> {c.foto_motivo}</p>
        )}
        {fotos.length === 0 ? (
          <p className="text-[11.5px] text-muted">Esta presentación no tiene foto en la vitrina. Se sube en Publicaciones (web y MeLi).</p>
        ) : (
          <>
            <div>
              <p className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">Principal</p>
              <img src={fotos[0]} alt={`Foto principal de ${c.nombre}`} className="max-h-56 w-full rounded-lg border border-border bg-white object-contain" />
            </div>
            {fotos.length > 1 && (
              <div>
                <p className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">Secundarias</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {fotos.slice(1).map((f) => <img key={f} src={f} alt="" loading="lazy" className="aspect-square w-full rounded-md border border-border bg-white object-contain" />)}
                </div>
              </div>
            )}
          </>
        )}
        <button className={BTN} onClick={abrirPublicacion}>Cambiar, ordenar o agregar fotos…</button>
        <p className="text-[10.5px] text-muted">Se editan en Publicaciones: principal (★), orden y fotos de la web y de MeLi por separado.</p>
      </div>
    );
  }
  if (!e) return null;
  const cuerpo = () => {
    if (clave === "ean") return <InspectorEan c={c} alResolver={alResolver} />;
    if (clave === "etiqueta") return <InspectorEtiqueta c={c} hermanas={hermanas} alResolver={alResolver} cerrarPieza={cerrarPieza} />;
    if (clave === "etiqueta_fisica")
      return (
        <>
          <InspectorEtiquetaReceta c={c} alResolver={alResolver} irAReceta={() => irA?.("receta")} abrirKit={() => setKitAbierto(true)} />
          {kitAbierto && <KitEmergente sku={c.ref} nombre={c.nombre} precio={c.precio_lista} onCerrar={() => setKitAbierto(false)} onGuardado={alResolver} />}
        </>
      );
    if (clave === "receta" && e.estado !== "ok")
      return (
        <>
          <InspectorReceta c={c} alResolver={alResolver} abrirKit={() => setKitAbierto(true)} />
          {kitAbierto && <KitEmergente sku={c.ref} nombre={c.nombre} precio={c.precio_lista} onCerrar={() => setKitAbierto(false)} onGuardado={alResolver} />}
        </>
      );
    if (clave === "receta" || clave === "etiqueta_fisica") {
      const lista = clave === "receta" ? c.componentes : c.componentes.filter((x) => x.casilla === "etiqueta");
      return (
        <div className="space-y-2">
          <p className="text-[11.5px] text-muted">{e.detalle}</p>
          {lista.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {lista.map((x, i) => (
                <button
                  key={`${x.codigo}-${i}`}
                  onClick={() => salto.inventario(x.codigo)}
                  title={`${x.nombre} — consultar en el inventario`}
                  className={`mck-btn-no-fx relative rounded-md border p-1.5 text-left transition hover:border-accent ${x.casilla === "materia_prima" ? "border-accent/70 bg-accent/10" : "border-border bg-surface-input"} ${x.existe ? "" : "border-dashed border-accent-rose/70"}`}
                >
                  <span className="absolute right-1 top-1 rounded bg-surface px-1 text-[9.5px] font-bold tabular-nums text-ink">{cantidad(x)}</span>
                  <span className="block text-base leading-none"><Ico e={CASILLA[x.casilla].icono} /></span>
                  <span className="mt-0.5 block text-[8.5px] font-bold uppercase tracking-wide text-muted">{CASILLA[x.casilla].nombre}</span>
                  <span className="line-clamp-2 block text-[10.5px] leading-tight text-ink">{x.nombre}</span>
                  <code className="block text-[9px] text-muted">{x.codigo}</code>
                  <span className="mt-0.5 flex items-center justify-between gap-1 font-mono text-[9px]">
                    {x.existencias == null ? (
                      <span className="text-muted">sin dato de existencias</span>
                    ) : (
                      <span className={x.existencias > 0 ? "text-accent-leaf" : "text-accent-rose"}>{x.existencias.toLocaleString("es-CO")} en inventario</span>
                    )}
                    <span className="text-accent">ver →</span>
                  </span>
                  {!x.existe && <span className="block text-[9px] font-bold text-accent-rose">ya no existe en Alegra</span>}
                </button>
              ))}
            </div>
          )}
          {e.accion && <AccionRanura c={c} accion={e.accion} />}
          {e.estado !== "ok" && <p className="text-[11px] text-muted">La receta vive en Alegra, en el kit <code>{c.ref}</code>.</p>}
          {lista.some((x) => (x.existencias ?? 0) < 0) && (
            <p className="text-[10.5px] text-muted">Las existencias son la referencia de Siigo que usa el panel de Inventario; un número negativo es empaque que se descuenta pero nunca se cargó.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={e.estado === "ok" ? BTN_SEC : BTN} onClick={() => setKitAbierto(true)}>
              {clave === "etiqueta_fisica" && e.estado !== "ok" ? "Agregar la etiqueta a la receta…" : "Ver y editar la receta del kit…"}
            </button>
          </div>
          {kitAbierto && <KitEmergente sku={c.ref} nombre={c.nombre} precio={c.precio_lista} onCerrar={() => setKitAbierto(false)} onGuardado={alResolver} />}
        </div>
      );
    }
    if (clave === "documento") return <InspectorDocumento c={c} alResolver={alResolver} />;
    return (
      <div className="space-y-2">
        <p className="text-[11.5px] text-muted">{e.detalle}</p>
        <PngAprobados e={c.eslabones.etiqueta} variantes={["impresion", "digital"]} />
        {e.precio ? <p className="text-[12px] tabular-nums text-ink">${Math.round(e.precio).toLocaleString("es-CO")} en la web</p> : null}
        <button className={e.estado === "ok" ? BTN_SEC : BTN} onClick={abrirPublicacion}>{e.estado === "ok" ? "Revisar la publicación…" : "Resolver la publicación…"}</button>
      </div>
    );
  };
  const icono = EQUIPO.find((x) => x.clave === clave)?.icono;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg leading-none"><Ico e={icono ?? ""} /></span>
        <h4 className="mck-flujo-nodo text-[13px] font-bold text-ink">{e.titulo}</h4>
        <span className={`ml-auto font-mono text-[9.5px] font-bold uppercase ${e.estado === "ok" ? "text-accent-leaf" : e.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{textoEstado(e)}</span>
      </div>
      {cuerpo()}
    </div>
  );
}

/** La pregunta con la que el taller guía cada pieza: dice qué pasa y qué se propone hacer. */
function preguntaGuia(clave: string, e: Eslabon | undefined): string {
  if (clave === "fotos") return "Estas son las fotos con las que se vende. ¿Las cambiamos o agregamos más?";
  if (!e) return "";
  if (e.estado === "ok") return "Esta pieza ya está conectada. Puedes revisarla o pasar a la siguiente.";
  const a = e.accion?.tipo;
  if (clave === "receta") return e.estado === "falta" ? "Este combo no descuenta su materia prima al venderse. ¿Arreglamos la receta del kit?" : "La receta tiene algo por revisar. ¿La miramos?";
  if (clave === "etiqueta_fisica") return "La receta no descuenta una etiqueta por unidad. ¿Se la agregamos al kit?";
  if (clave === "documento") {
    if (a === "fijar_sku") return "Encontré este documento por parecido de nombre. ¿Es el de su materia prima? Revísalo y, si es, lo unimos.";
    if (e.estado === "falta") return "No encontré su documento técnico. ¿Existe con otro nombre? Búscalo y lo enlazamos; si no existe, hay que redactarlo (o márcalo como «no requiere documento»).";
    return "El documento ya está unido, pero todavía no está listo para publicarse. ¿Lo revisamos y completamos?";
  }
  if (clave === "ean") return a ? "No tiene código de barras. Este es el siguiente número libre: ¿lo creamos?" : "Aún no se le puede crear código: primero hay que arreglar su receta.";
  if (clave === "etiqueta") return e.etiqueta_id ? "La etiqueta existe, pero no está unida al combo por su código de barras. ¿La conectamos?" : "No tiene etiqueta diseñada. ¿La diseñamos ahora?";
  return "No aparece publicado. ¿Revisamos su publicación?";
}

/**
 * Una pieza del combo en un EMERGENTE sobre el tablero. El taller no tiene barra lateral: la mayoría
 * de las piezas se resuelven con un solo botón y una columna entera para eso era espacio muerto. Arriba
 * va la pregunta que guía; abajo, «siguiente pendiente», para recorrer la misión sin volver al tablero.
 */
function PiezaEmergente({ clave, e, recien, siguiente, onSiguiente, onCerrar, children }: {
  clave: string; e: Eslabon | undefined; recien: string | null; siguiente: { clave: string; titulo: string } | null;
  onSiguiente: () => void; onCerrar: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    // Esc cierra ESTE emergente solo si no hay otro encima (documento, kit, etiqueta).
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape" && document.querySelectorAll('[role="dialog"][aria-modal="true"]').length === 1) onCerrar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);
  return createPortal(
    <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Pieza del combo" onClick={onCerrar}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-xl" onClick={(ev) => ev.stopPropagation()}>
        {recien && (
          <p className="mck-mision-gana-tira shrink-0 border-b border-accent-leaf/40 bg-accent-leaf/15 px-4 py-1.5 text-[12px] font-bold text-ink"><Ico e="✅" /> {recien} — seguimos con la siguiente pieza.</p>
        )}
        <p className="shrink-0 border-b border-border bg-accent/5 px-4 py-2 text-[13px] leading-snug text-ink">{preguntaGuia(clave, e)}</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2">
          {siguiente && <button className={BTN_SEC} onClick={onSiguiente}>Siguiente pendiente: {siguiente.titulo} →</button>}
          <span className="flex-1" />
          <button className={BTN_SEC} onClick={onCerrar}>Volver al árbol</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Solo completo / no completo: cuántas piezas le faltan a cada uno se ve en el tablero, no en la lista.

/** Orden en que se guía: la primera pieza sin conectar es la que se propone resolver. */
export function primeraPendiente(c: Combo): string | null {
  return ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "falta") ?? ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "aviso") ?? null;
}

/**
 * Resolver una pieza de un combo en su emergente (y las ventanas que abre), encima de quien lo
 * monte. Al resolverla pasa sola a la siguiente pendiente; si el combo queda completo, suena la
 * moneda, se celebra y se cierra.
 */
export function ResolverPieza({ datos, refCombo, pieza, onCerrar }: {
  datos: Respuesta;
  refCombo: string;
  pieza: string;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const c = datos.combos.find((x) => x.ref === refCombo) ?? null;
  const [sel, setSel] = useState(pieza);
  const [pubAbierta, setPubAbierta] = useState(pieza === "publicacion");
  const [piezaAbierta, setPiezaAbierta] = useState(pieza !== "publicacion");
  const [recien, setRecien] = useState<string | null>(null);
  const [ventana, setVentana] = useState<Ventana | null>(null);

  const alResolver = async () => {
    await api.post("/api/mapa-sistema/invalidar").catch(() => null);
    await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    await qc.invalidateQueries({ queryKey: ["arbol-producto"] });
    await qc.invalidateQueries({ queryKey: ["mapa-app-bloqueos"] });
  };
  const cerrarVentana = () => {
    if (ventana?.tipo === "docs") useAppStore.setState({ tallerRetorno: null, tallerSalto: null });
    setVentana(null);
    void alResolver();
  };

  // El premio: al conectar una pieza se anuncia y se pasa a la siguiente; con las seis, moneda.
  const antes = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    if (!c) return;
    const ahora = Object.fromEntries(EQUIPO.map(({ clave }) => [clave, c.eslabones[clave]?.estado ?? "falta"]));
    const previo = antes.current;
    antes.current = ahora;
    if (!previo) return;
    const ganadas = Object.keys(ahora).filter((k) => ahora[k] === "ok" && previo[k] !== "ok");
    if (!ganadas.length) return;
    setRecien("Listo: " + ganadas.map((k) => c.eslabones[k]?.titulo ?? k).join(" y "));
    if (completo(c)) {
      sonarMoneda();
      celebrarAprobacion({ tipo: "moneda", titulo: "¡Combo completo!", detalle: c.ref, mision: "combo_completo", sonido: false });
      setPiezaAbierta(false);
      onCerrar();
      return;
    }
    const siguiente = ORDEN_GUIA.find((k) => ahora[k] !== "ok");
    if (!siguiente || siguiente === "publicacion") setPiezaAbierta(false);
    else setSel(siguiente);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null;
  const hermanas = c.familia
    ? datos.combos.filter((x) => x.familia === c.familia).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }))
    : [];
  const cerrarTodo = () => {
    setPiezaAbierta(false);
    setPubAbierta(false);
    onCerrar();
  };
  const pend = ORDEN_GUIA.filter((k) => k !== sel && k !== "publicacion" && c.eslabones[k] && c.eslabones[k].estado !== "ok");
  const sig = pend[0] ? { clave: pend[0], titulo: c.eslabones[pend[0]].titulo } : null;

  return (
    <VentanaCtx.Provider value={setVentana}>
      {piezaAbierta && sel !== "publicacion" && (
        <PiezaEmergente clave={sel} e={c.eslabones[sel]} recien={recien} siguiente={sig}
          onSiguiente={() => { if (sig) { setRecien(null); setSel(sig.clave); } }} onCerrar={cerrarTodo}>
          <Inspector c={c} clave={sel} hermanas={hermanas} alResolver={alResolver}
            abrirPublicacion={() => { setPiezaAbierta(false); setPubAbierta(true); }}
            irA={(k) => { setRecien(null); setSel(k); }} cerrarPieza={cerrarTodo} />
        </PiezaEmergente>
      )}
      {pubAbierta && (
        <PublicacionEmergente key={c.ref} sku={c.ref} nombre={c.nombre} precioLista={c.precio_lista} etiqueta={c.eslabones.etiqueta}
          onCerrar={() => { setPubAbierta(false); void alResolver(); if (!piezaAbierta) onCerrar(); }} />
      )}
      {ventana?.tipo === "ean" && (
        <VentanaTaller titulo="Código EAN" combo={ventana.combo.nombre} ancho="max-w-[1100px]" onCerrar={cerrarVentana}
          ayuda={ventana.combo.eslabones.ean?.estado === "ok"
            ? <>Este combo ya tiene código (<code>{ventana.combo.eslabones.ean.codigo}</code>): la lista está filtrada en él. Corrígelo con el lápiz; no registres otro.</>
            : <>El formulario ya tiene el SKU <code>{ventana.combo.ref}</code>. Registra el código y cierra: la pieza se enciende sola.</>}>
          <CodigosEanPanel buscarInicial={ventana.combo.eslabones.ean?.estado === "ok" ? ventana.combo.ref : ""} />
        </VentanaTaller>
      )}
      {ventana?.tipo === "docs" && (
        <VentanaTaller titulo="Documento técnico" combo={ventana.combo.nombre} ancho="max-w-[1100px]" onCerrar={cerrarVentana}
          ayuda="Ficha técnica, COA y SDS en un solo documento. Arriba ves lo que le falta; guarda o genera el PDF y cierra.">
          <FichasTecnicasPanel onVolver={cerrarVentana} />
        </VentanaTaller>
      )}
      {ventana?.tipo === "componente" && (
        <VentanaTaller titulo="Componente de la receta" combo={ventana.combo.nombre} onCerrar={cerrarVentana}
          ayuda={<>{ventana.nombre} (<code>{ventana.codigo}</code>) en el catálogo de Alegra: existencias, precio y en qué recetas va.</>}>
          <CatalogoAlegraPanel />
        </VentanaTaller>
      )}
    </VentanaCtx.Provider>
  );
}

/** Crear en Alegra el combo de un producto comprado que aún no tiene presentación de venta. */
export function CrearComboVentana({ refProducto, nombre, onCerrar }: { refProducto: string; nombre: string; onCerrar: () => void }) {
  const qc = useQueryClient();
  const cerrar = () => {
    void api.post("/api/mapa-sistema/invalidar").catch(() => null);
    void qc.invalidateQueries({ queryKey: ["arbol-producto"] });
    void qc.invalidateQueries({ queryKey: ["arbol-sin-combo"] });
    onCerrar();
  };
  return (
    <VentanaTaller titulo="Crear en Alegra" combo={nombre} ancho="max-w-[900px]" onCerrar={cerrar}
      ayuda={<>Este producto (<code>{refProducto}</code>) no tiene presentación de venta. Crea su combo; al cerrar aparece en el árbol.</>}>
      {/* Lo que falta es la presentación de VENTA: el formulario nace como combo (código C-…). */}
      <CrearProductosSiigoPanel compact inicial={{ codigo: refProducto.toUpperCase().startsWith("C-") ? refProducto : "C-", nombre }} onCreado={() => void qc.invalidateQueries({ queryKey: ["arbol-sin-combo"] })} />
    </VentanaTaller>
  );
}
