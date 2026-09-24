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
  | { tipo: "crear"; ref: string; nombre: string };
const VentanaCtx = createContext<(v: Ventana) => void>(() => {});
import { AccionRanura, BTN, BTN_SEC, CASILLA, EQUIPO, EtiquetaPng, cantidad, type Combo, type Eslabon, type MateriaPrima, type Respuesta } from "./comun";
import { celebrarAprobacion } from "../../lib/celebracionAprobado";

/**
 * El taller de combos: una guía caso a caso para completar lo que le falta a cada producto
 * de venta. Se abre desde la etapa «Preparar», que es donde empiezan los problemas.
 *
 * Todo gira alrededor del combo: su FOTO en el centro y, saliendo de ella, sus seis piezas
 * (receta, etiqueta en la receta, documento, código EAN, diseño de etiqueta, publicación).
 * Una conexión viva = pieza completa; punteada = ranura vacía. Al tocar una pieza se abre a
 * la derecha su inspector, donde se resuelve: crear el EAN, unir el documento por SKU, definir
 * tamaño y plantilla de la etiqueta y corregir sus textos. Lo que exige otra herramienta
 * (Códigos EAN, Docs técnicos, Publicaciones, el editor de etiquetas, el kit de Alegra, Crear en
 * Alegra) se abre en una VENTANA sobre el taller, que queda de fondo: el usuario no quiere salir
 * del combo. Solo «Abrir en el Studio completo» sigue saltando, a pedido explícito.
 *
 * El premio se ve: cada pieza resuelta enciende su conexión, el anillo de la foto avanza, y un
 * combo con las seis piezas se celebra y suma al marcador del día y al del catálogo.
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

const CLAVE_REF = "mck-mision-combo";
const CLAVE_DIA = "mck-mision-marcador";
const TOTAL = EQUIPO.length;

// Dónde va cada pieza alrededor de la foto (viewBox 1000×640, centro 500,320).
const POS: Record<string, { x: number; y: number }> = {
  receta: { x: 500, y: 62 },
  etiqueta_fisica: { x: 850, y: 190 },
  documento: { x: 850, y: 450 },
  ean: { x: 500, y: 578 },
  etiqueta: { x: 150, y: 450 },
  publicacion: { x: 150, y: 190 },
};
/** Con el tablero pequeño (portátil, ventana partida) el nombre largo no cabe en el nodo. */
const CORTO: Record<string, string> = { receta: "Receta", etiqueta_fisica: "Etq. física", documento: "Documento", ean: "EAN", etiqueta: "Diseño", publicacion: "Publicación" };
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

function hoyClave() {
  return new Date().toISOString().slice(0, 10);
}
function leerMarcador(): { dia: string; conexiones: number; combos: number } {
  try {
    const m = JSON.parse(localStorage.getItem(CLAVE_DIA) || "null");
    if (m && m.dia === hoyClave()) return m;
  } catch {
    /* sin almacenamiento */
  }
  return { dia: hoyClave(), conexiones: 0, combos: 0 };
}

/** La foto con la que se vende no está al día (no tiene, es de otra presentación, o muestra la etiqueta anterior). */
function fotoPendiente(c: Combo) {
  return Boolean(c.foto_estado && c.foto_estado !== "ok");
}
function completo(c: Combo) {
  return c.ok === TOTAL;
}
function pendientes(c: Combo) {
  return TOTAL - c.ok;
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
      {e.png && <EtiquetaPng nombre={e.png} />}
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

function Tablero({ c, sel, guia, destello, premio, onSel }: { c: Combo; sel: string; guia: string | null; destello: Set<string>; premio: boolean; onSel: (k: string) => void }) {
  const R = 86;
  const barbie = usePanelTheme((s) => s.skin) === "barbie";
  const avance = c.ok / TOTAL;
  const CIRC = 2 * Math.PI * (R + 9);
  return (
    <div className="mck-mision-tablero relative mx-auto aspect-[1000/640] w-full max-w-[860px]">
      <svg viewBox="0 0 1000 640" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {EQUIPO.map(({ clave }) => {
          const e = c.eslabones[clave];
          const p = POS[clave];
          if (!e || !p) return null;
          const d = `M500,320 L${p.x},${p.y}`;
          const vivo = e.estado === "ok";
          return (
            <g key={clave}>
              <path d={d} fill="none" strokeLinecap="round"
                className={`${vivo ? "stroke-accent-leaf" : e.estado === "aviso" ? "stroke-accent-sun" : "stroke-accent-rose/60"} ${destello.has(clave) ? "mck-mision-destello" : ""}`}
                strokeWidth={vivo ? 3.5 : 2} strokeDasharray={vivo ? undefined : "7 7"} />
              {vivo && (
                <circle r="5" className="fill-accent-leaf mck-mision-viajero">
                  <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
                </circle>
              )}
            </g>
          );
        })}
        {/* anillo de avance alrededor de la foto */}
        <circle cx="500" cy="320" r={R + 9} fill="none" className="stroke-border" strokeWidth="7" />
        <circle cx="500" cy="320" r={R + 9} fill="none" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 500 320)"
          className={premio ? "stroke-accent-sun" : "stroke-accent-leaf"} strokeDasharray={`${CIRC * avance} ${CIRC}`} style={{ transition: "stroke-dasharray 700ms ease" }} />
      </svg>

      {/* la foto, en el centro: se toca para ver y editar sus fotos */}
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-4 bg-white ${sel === "fotos" ? "border-accent" : fotoPendiente(c) ? "border-accent-sun" : "border-surface-panel"} ${premio ? "mck-mision-premio" : ""} ${completo(c) && fotoPendiente(c) ? "mck-mision-foto-parpadea" : ""}`} style={{ width: "17.2%", aspectRatio: "1" }}>
        <button onClick={() => onSel("fotos")} aria-pressed={sel === "fotos"} title={fotoPendiente(c) ? `Foto por actualizar — ${c.foto_motivo}` : "Ver y editar las fotos de esta presentación"} className="mck-btn-no-fx group block h-full w-full">
          {c.foto ? <img src={c.foto} alt={c.nombre} className="h-full w-full object-contain" /> : <span className="flex h-full items-center justify-center text-3xl text-muted">?</span>}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/60 py-0.5 text-center font-mono text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100">fotos{c.fotos && c.fotos.length > 1 ? ` · ${c.fotos.length}` : ""}</span>
        </button>
      </div>
      <div className="absolute left-1/2 top-[67.5%] flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-panel px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink">
        {c.ok}/{TOTAL}
        {fotoPendiente(c) && <span className="font-normal text-accent-sun">· foto por actualizar</span>}
      </div>

      {EQUIPO.map(({ clave, icono }) => {
        const e = c.eslabones[clave];
        const p = POS[clave];
        if (!e || !p) return null;
        const activo = sel === clave;
        const dato = clave === "ean" ? e.codigo : clave === "etiqueta" ? e.tamano : clave === "publicacion" && e.meli_id ? e.meli_id : "";
        return (
          // El botón va DENTRO de un div posicionado: index.css fuerza `position: relative` y
          // `overflow: hidden` en todos los botones (efecto de pulsación), así que un botón con
          // `absolute` se queda en el flujo y el «+1» quedaría recortado.
          <div
            key={clave}
            style={{ left: `${p.x / 10}%`, top: `${(p.y / 640) * 100}%`, width: "23%" }}
            className={`mck-mision-nodo absolute -translate-x-1/2 -translate-y-1/2 ${destello.has(clave) ? "mck-mision-gana" : ""}`}
          >
            <button
              onClick={() => onSel(clave)}
              aria-pressed={activo}
              className={`mck-flujo-nodo block w-full rounded-xl border-2 bg-surface-panel px-2 py-1.5 text-left transition ${
                e.estado === "ok" ? "border-accent-leaf/70" : e.estado === "aviso" ? "border-accent-sun/80" : "border-dashed border-accent-rose/70"
              } ${activo ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-panel" : "hover:border-accent"} ${guia === clave && !activo ? "mck-mision-pulso" : ""}`}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[15px] leading-none" aria-hidden="true"><Ico e={icono} /></span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink">
                  <span className="mck-nodo-largo">{e.titulo}</span>
                  <span className="mck-nodo-corto">{CORTO[clave] ?? e.titulo}</span>
                </span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.estado === "ok" ? "bg-accent-leaf" : e.estado === "aviso" ? "bg-accent-sun" : "bg-accent-rose"}`} />
              </span>
              <span className={`mt-0.5 block truncate font-mono text-[9.5px] ${e.estado === "ok" ? "text-muted" : e.estado === "aviso" ? "text-accent-sun" : "text-accent-rose"}`}>{dato || textoEstado(e)}</span>
            </button>
            {destello.has(clave) && <span className="mck-mision-sube pointer-events-none absolute -top-3 right-2 font-mono text-[11px] font-bold text-accent-leaf">+1 conexión</span>}
          </div>
        );
      })}

      {premio && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {barbie
            ? // Barbie Agenda: estrellas de hada que brotan por el tablero, titilan y suben.
              Array.from({ length: 34 }, (_, i) => (
                <span
                  key={i}
                  className="mck-mision-estrella"
                  style={{
                    left: `${(i * 37 + 7) % 96}%`,
                    top: `${(i * 53 + 11) % 88}%`,
                    fontSize: `${10 + ((i * 7) % 4) * 6}px`,
                    animationDelay: `${(i % 11) * 110}ms`,
                    color: ["#ff4fa3", "#ffd76a", "#c89bff", "#ffffff", "#ff9ecf"][i % 5],
                  }}
                >
                  {i % 3 ? "✦" : "★"}
                </span>
              ))
            : Array.from({ length: 26 }, (_, i) => (
                <span key={i} className="mck-mision-confeti" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 90}ms`, background: ["#0891b2", "#059669", "#d97706", "#7c3aed", "#e11d48"][i % 5] }} />
              ))}
        </div>
      )}
    </div>
  );
}

/**
 * El taller ocupa EXACTAMENTE lo que queda de ventana bajo el cabezote (que cambia de alto al
 * desplegar una etapa): así nada obliga a desplazar la página; solo la lista y el inspector tienen
 * su propio desplazamiento. Por debajo de 1024 px se apila y la página fluye normal (`null`).
 */
function useAltoDisponible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [alto, setAlto] = useState<number | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      setAlto(window.innerWidth < 1024 ? null : Math.max(440, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 10)));
    };
    medir();
    window.addEventListener("resize", medir);
    const ro = new ResizeObserver(medir);
    const cabezote = document.querySelector("header");
    if (cabezote) ro.observe(cabezote);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", medir);
      ro.disconnect();
    };
  }, []);
  return { ref, alto };
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
          <button className={BTN_SEC} onClick={onCerrar}>Volver al tablero</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const FILTROS_LISTA: { id: string; nombre: string; pasa: (c: Combo) => boolean }[] = [
  { id: "pendientes", nombre: "Por completar", pasa: (c) => !completo(c) },
  { id: "casi", nombre: "A una pieza", pasa: (c) => pendientes(c) === 1 },
  { id: "documento", nombre: "Sin documento", pasa: (c) => c.eslabones.documento?.estado !== "ok" },
  { id: "ean", nombre: "Sin código", pasa: (c) => c.eslabones.ean?.estado !== "ok" },
  { id: "etiqueta", nombre: "Sin etiqueta", pasa: (c) => c.eslabones.etiqueta?.estado !== "ok" },
  { id: "receta", nombre: "Receta rota", pasa: (c) => c.eslabones.receta?.estado === "falta" },
  { id: "completos", nombre: "Completos", pasa: completo },
  { id: "todos", nombre: "Todos", pasa: () => true },
  // No son combos: productos comprados que aún no tienen ninguna presentación de venta.
  { id: "huerfanos", nombre: "Sin combo", pasa: () => false },
];
const COLOR_SEG = { ok: "bg-accent-leaf", aviso: "bg-accent-sun", falta: "bg-accent-rose" } as const;

/**
 * Todos los combos, en la misma ventana del tablero. Es a la vez la galería y la cola del taller:
 * lo que se filtra aquí es lo que recorren «Anterior / Siguiente». Cada segmento de una fila es una
 * pieza de ese combo: tocarlo abre el combo directamente en esa pieza.
 */
function ListaCombos({ combos, total, actual, q, setQ, filtro, setFiltro, conteos, onElegir, huerfanos, onCrearCombo }: {
  combos: Combo[]; total: number; actual: string | null; q: string; setQ: (v: string) => void;
  filtro: string; setFiltro: (v: string) => void; conteos: Record<string, number>; onElegir: (ref: string, pieza?: string) => void;
  huerfanos: FilaProducto[]; onCrearCombo: (ref: string) => void;
}) {
  useEffect(() => {
    if (actual) document.getElementById(`mision-fila-${actual}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [actual, combos.length]);
  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-2">
      <div className="flex min-w-0 items-center gap-1.5 xl:block">
      <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar combo por nombre o SKU…" aria-label="Buscar combo" className="w-52 shrink-0 rounded-md border border-border bg-surface-input px-2 py-1.5 text-[12px] text-ink xl:w-full" />
      <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5 xl:mt-1.5 xl:flex-wrap xl:overflow-visible">
        {FILTROS_LISTA.filter((f) => f.id !== "huerfanos" || huerfanos.length > 0).map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
            className={`mck-flujo-nodo shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold ${filtro === f.id ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink-secondary hover:border-accent/50"}`}>
            {f.nombre} <span className="tabular-nums opacity-75">{conteos[f.id] ?? 0}</span>
          </button>
        ))}
      </div>
      </div>
      <p className="mt-1 hidden font-mono text-[9.5px] text-muted xl:block">
        {filtro === "huerfanos" ? `${huerfanos.length} productos comprados sin presentación de venta` : `${combos.length} de ${total} · primero los más cerca de quedar completos`}
      </p>
      {/* xl: columna con desplazamiento propio · más angosto: una franja horizontal sobre el tablero */}
      <div className="mt-1 flex min-h-0 flex-1 gap-1 overflow-x-auto pb-1 xl:block xl:space-y-1 xl:overflow-y-auto xl:overflow-x-hidden xl:pb-0 xl:pr-0.5">
        {filtro === "huerfanos" && huerfanos.map((f) => (
          <div key={f.ref} className="flex w-56 shrink-0 items-center gap-2 rounded-lg border border-dashed border-border bg-surface-input p-1.5 xl:w-auto">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-bold leading-tight text-ink">{f.nombre}</span>
              <code className="block truncate text-[9.5px] text-muted">{f.ref}</code>
            </span>
            <button className={BTN_SEC} onClick={() => onCrearCombo(f.ref)} title="No tiene combo: se crea en Alegra">Crear →</button>
          </div>
        ))}
        {filtro !== "huerfanos" && combos.map((c) => {
          const aqui = c.ref === actual;
          return (
            <div key={c.ref} id={`mision-fila-${c.ref}`} className={`w-56 shrink-0 rounded-lg border p-1.5 transition xl:w-auto ${aqui ? "border-accent bg-accent/10" : "border-border bg-surface-input hover:border-accent/50"}`}>
              <button onClick={() => onElegir(c.ref)} aria-current={aqui ? "true" : undefined} className="mck-btn-no-fx flex w-full items-center gap-2 text-left">
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-white">
                  {c.foto ? <img src={c.foto} alt="" loading="lazy" className="h-full w-full object-contain" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-bold leading-tight text-ink">{c.nombre}</span>
                  <code className="block truncate text-[9.5px] text-muted">{c.ref}</code>
                </span>
                <span className={`shrink-0 rounded-full px-1.5 font-mono text-[10px] font-bold tabular-nums ${completo(c) ? "bg-accent-leaf text-white" : pendientes(c) === 1 ? "bg-accent-sun/25 text-ink" : "bg-surface text-muted"}`}>{c.ok}/{TOTAL}</span>
              </button>
              <div className="mt-1 flex gap-0.5">
                {EQUIPO.map(({ clave }) => {
                  const e = c.eslabones[clave];
                  return (
                    <button key={clave} onClick={() => onElegir(c.ref, clave)} title={`${e?.titulo}: ${e ? textoEstado(e) : ""} — abrir en esta pieza`} aria-label={`${c.nombre}: ${e?.titulo}`}
                      className={`mck-btn-no-fx h-2 flex-1 rounded-full transition hover:scale-y-150 ${COLOR_SEG[e?.estado ?? "falta"]}`} />
                  );
                })}
              </div>
            </div>
          );
        })}
        {filtro !== "huerfanos" && combos.length === 0 && <p className="px-1 py-3 text-[11.5px] text-muted">Ningún combo coincide con ese filtro.</p>}
      </div>
    </div>
  );
}

export default function MisionCombos({ datos }: { datos: Respuesta }) {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const porRef = useMemo(() => new Map(datos.combos.map((c) => [c.ref, c])), [datos.combos]);

  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("pendientes");
  const orden = (a: Combo, b: Combo) => (completo(a) ? 1 : 0) - (completo(b) ? 1 : 0) || pendientes(a) - pendientes(b) || a.faltas - b.faltas || a.nombre.localeCompare(b.nombre, "es", { numeric: true });
  const [ref, setRef] = useState<string | null>(() => {
    try {
      const g = sessionStorage.getItem(CLAVE_REF);
      if (g && porRef.has(g)) return g;
    } catch {
      /* sin almacenamiento */
    }
    return [...datos.combos].filter((x) => !completo(x)).sort(orden)[0]?.ref ?? null;
  });
  // La lista ES la cola: lo que se filtra es lo que recorren «Anterior / Siguiente». El combo que
  // se está trabajando nunca desaparece de ella aunque deje de cumplir el filtro al completarse.
  const listaCombos = useMemo(() => {
    const texto = q.trim().toUpperCase();
    const pasa = FILTROS_LISTA.find((f) => f.id === filtro)?.pasa ?? (() => true);
    return datos.combos
      .filter((x) => x.ref === ref || (pasa(x) && (!texto || x.nombre.toUpperCase().includes(texto) || x.ref.toUpperCase().includes(texto))))
      .sort(orden);
  }, [datos.combos, q, filtro, ref]); // eslint-disable-line react-hooks/exhaustive-deps
  const conteos = useMemo(() => Object.fromEntries(FILTROS_LISTA.map((f) => [f.id, datos.combos.filter(f.pasa).length])), [datos.combos]);
  const cola = useMemo(() => listaCombos.map((x) => x.ref), [listaCombos]);
  const c = ref ? porRef.get(ref) ?? null : null;
  const pos = ref ? cola.indexOf(ref) : -1;
  useEffect(() => {
    try {
      if (ref) sessionStorage.setItem(CLAVE_REF, ref);
    } catch {
      /* sin almacenamiento */
    }
  }, [ref]);

  const guia = useMemo(() => (c ? ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "falta") ?? ORDEN_GUIA.find((k) => c.eslabones[k]?.estado === "aviso") ?? null : null), [c]);
  const [sel, setSel] = useState<string>("receta");
  const [pubAbierta, setPubAbierta] = useState(false);
  const [ventana, setVentana] = useState<Ventana | null>(null);
  const cerrarVentana = () => {
    if (ventana?.tipo === "docs") useAppStore.setState({ tallerRetorno: null, tallerSalto: null });
    setVentana(null);
    void alResolver();
    if (ventana?.tipo === "crear") void qc.invalidateQueries({ queryKey: ["mision-sin-combo"] });
  };
  // Tocar la pieza «Publicación» la abre en un emergente sobre el taller (no en el panel lateral).
  const [piezaAbierta, setPiezaAbierta] = useState(false);
  const [recien, setRecien] = useState<string | null>(null);
  // Tocar una pieza la abre en un emergente sobre el tablero (la publicación tiene el suyo propio).
  const tocarPieza = (k: string) => {
    setSel(k);
    setRecien(null);
    if (k === "publicacion") setPubAbierta(true);
    else setPiezaAbierta(true);
  };
  useEffect(() => {
    const pedida = piezaPedida.current;
    setSel(pedida ?? guia ?? "receta");
    setRecien(null);
    setPiezaAbierta(Boolean(pedida && pedida !== "publicacion"));
    piezaPedida.current = null;
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps

  // El premio: comparar cada combo con cómo estaba la última vez que se vio.
  const antes = useRef<Map<string, Record<string, string>>>(new Map());
  const [destello, setDestello] = useState<Set<string>>(new Set());
  const [premio, setPremio] = useState(false);
  const [marcador, setMarcador] = useState(leerMarcador);
  const [conSonido, setConSonido] = useState(sonidoActivo);
  useEffect(() => {
    if (!c) return;
    const ahora = Object.fromEntries(EQUIPO.map(({ clave }) => [clave, c.eslabones[clave]?.estado ?? "falta"]));
    const previo = antes.current.get(c.ref);
    antes.current.set(c.ref, ahora);
    if (!previo) {
      setPremio(false);
      return;
    }
    const ganadas = Object.keys(ahora).filter((k) => ahora[k] === "ok" && previo[k] !== "ok");
    if (!ganadas.length) return;
    const cerro = completo(c);
    setDestello(new Set(ganadas));
    setPremio(cerro);
    if (cerro) {
      sonarMoneda();
      celebrarAprobacion({ tipo: "moneda", titulo: "¡Combo completo!", detalle: c.ref, mision: "combo_completo", sonido: false });
    }
    setMarcador((m) => {
      const n = { dia: hoyClave(), conexiones: (m.dia === hoyClave() ? m.conexiones : 0) + ganadas.length, combos: (m.dia === hoyClave() ? m.combos : 0) + (cerro ? 1 : 0) };
      try {
        localStorage.setItem(CLAVE_DIA, JSON.stringify(n));
      } catch {
        /* sin almacenamiento */
      }
      return n;
    });
    const t = setTimeout(() => setDestello(new Set()), 2600);
    const siguientePieza = ORDEN_GUIA.find((k) => ahora[k] !== "ok");
    setRecien("Listo: " + ganadas.map((k) => c.eslabones[k]?.titulo ?? k).join(" y "));
    if (cerro || !siguientePieza || siguientePieza === "publicacion") setPiezaAbierta(false);
    if (siguientePieza) setSel(siguientePieza);
    return () => clearTimeout(t);
  }, [c]);

  const alResolver = async () => {
    await api.post("/api/mapa-sistema/invalidar").catch(() => null);
    await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    await qc.invalidateQueries({ queryKey: ["mapa-app-bloqueos"] });
  };
  const mover = (d: number) => {
    if (!cola.length) return;
    const i = pos < 0 ? 0 : (pos + d + cola.length) % cola.length;
    setPremio(false);
    setRef(cola[i]);
  };

  const piezaPedida = useRef<string | null>(null);
  const elegir = (r: string, pieza?: string) => {
    setPremio(false);
    if (pieza === "publicacion") setPubAbierta(true);
    if (r === ref) {
      if (pieza) tocarPieza(pieza);
      return;
    }
    piezaPedida.current = pieza ?? null;
    setRef(r);
  };
  // ← → recorren la lista · 1–6 abren una pieza · F las fotos. No actúan mientras se escribe.
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      // Con un emergente abierto (editor de etiqueta, documento, kit) las teclas son suyas:
      // una flecha cambiaría de combo por debajo y cerraría lo que se está editando.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (ev.key === "ArrowRight") mover(1);
      else if (ev.key === "ArrowLeft") mover(-1);
      else if (/^[1-6]$/.test(ev.key)) tocarPieza(ORDEN_GUIA[Number(ev.key) - 1]);
      else if (ev.key.toLowerCase() === "f") tocarPieza("fotos");
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const sinCombo = useQuery({ queryKey: ["mision-sin-combo"], queryFn: () => api.get<{ filas: FilaProducto[] }>("/api/mapa-sistema/productos"), staleTime: 300_000, retry: false });
  const huerfanos = (sinCombo.data?.filas ?? []).filter((f) => f.combo === "falta");

  // Las otras presentaciones del mismo producto (misma materia prima): cada una es su combo,
  // con su EAN, su etiqueta y su plantilla propios.
  const hermanas = useMemo(
    () => (c?.familia ? datos.combos.filter((x) => x.familia === c.familia).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })) : []),
    [c?.familia, datos.combos],
  );
  const { ref: raiz, alto } = useAltoDisponible<HTMLDivElement>();
  const completos = datos.combos.filter(completo).length;

  return (
    <VentanaCtx.Provider value={setVentana}>
    <div ref={raiz} style={alto ? { height: alto } : undefined} className="flex min-h-0 flex-col gap-2">
      {/* Marcador */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-surface-panel px-3 py-1.5">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-baseline justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            <span>Catálogo completo</span>
            <span className="tabular-nums text-ink">{completos} / {datos.total}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-input">
            <div className="h-full rounded-full bg-accent-leaf transition-all duration-700" style={{ width: `${(completos / Math.max(datos.total, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="mck-flujo-nodo text-[12px] text-ink"><b className="tabular-nums">{marcador.conexiones}</b> <span className="text-muted">conexiones hoy</span></div>
        <div className="mck-flujo-nodo text-[12px] text-ink"><Ico e="🏆" /> <b className="tabular-nums">{marcador.combos}</b> <span className="text-muted">combos completados hoy</span></div>
        <button
          onClick={() => { const v = !conSonido; setConSonido(v); ponerSonido(v); if (v) sonarMoneda(true); }}
          aria-pressed={conSonido}
          title={conSonido ? "Suena una vida extra al completar un combo. Toca para silenciar." : "Sonido apagado. Toca para activarlo (y oírlo)."}
          className={`mck-flujo-nodo rounded-md border px-2 py-0.5 text-[11px] font-bold ${conSonido ? "border-accent/50 text-accent" : "border-border text-muted"}`}
        >
          <Ico e="🔊" /> {conSonido ? "sonido" : "en silencio"}
        </button>
      </div>

      {!c ? (
        <div className="rounded-xl border border-accent-leaf/50 bg-accent-leaf/10 p-6 text-center text-sm text-ink"><Ico e="🏆" /> No queda ningún combo incompleto. El catálogo está al día.</div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-1 lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <ListaCombos combos={listaCombos} total={datos.total} actual={ref} q={q} setQ={setQ} filtro={filtro} setFiltro={setFiltro} conteos={{ ...conteos, huerfanos: huerfanos.length }} onElegir={elegir}
            huerfanos={huerfanos} onCrearCombo={(r) => setVentana({ tipo: "crear", ref: r, nombre: huerfanos.find((h) => h.ref === r)?.nombre ?? r })} />
          <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface-panel p-3">
            {/* Caso actual */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                  {`Caso ${pos + 1} de ${cola.length}`} · {FILTROS_LISTA.find((f) => f.id === filtro)?.nombre.toLowerCase()} · {c.linea || "sin línea en la web"}
                </p>
                <h3 className="flex min-w-0 items-baseline gap-2 text-base font-bold text-ink">
                  <span className="truncate">{c.nombre}</span>
                  <code className="shrink-0 text-[11px] font-normal text-ink-secondary">{c.ref}</code>
                </h3>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button className={BTN_SEC} onClick={() => mover(-1)}>← Anterior</button>
                <button className={completo(c) ? BTN : BTN_SEC} onClick={() => mover(1)}>{completo(c) ? "Siguiente combo →" : "Saltar →"}</button>
              </div>
            </div>

            {premio || completo(c) ? (
              <div className="mt-2 rounded-lg border border-accent-sun/60 bg-accent-sun/10 px-3 py-2 text-center text-[12.5px] font-bold text-ink"><Ico e="🏆" /> ¡Combo completo! Sus seis piezas están conectadas: ya se puede vender con todo su respaldo.{fotoPendiente(c) ? <span className="font-normal"> Solo queda la foto: toca la imagen que parpadea.</span> : null}</div>
            ) : guia ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-1.5 text-[12px] text-ink">
                <span className="min-w-0 flex-1 truncate" title={`${c.eslabones[guia].titulo}: ${c.eslabones[guia].detalle}`}>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">siguiente paso</span>{" "}
                  {c.eslabones[guia].titulo}: <span className="text-muted">{c.eslabones[guia].detalle}</span>
                </span>
                <button className={`${BTN} mck-mision-pulso shrink-0`} onClick={() => tocarPieza(guia)}>Resolver ahora →</button>
              </div>
            ) : null}

            {hermanas.length > 1 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-wider text-muted">{hermanas.length} presentaciones · cada una con su etiqueta y plantilla</span>
                {hermanas.map((h) => {
                  const aqui = h.ref === c.ref;
                  const etq = h.eslabones.etiqueta;
                  return (
                    <button
                      key={h.ref}
                      onClick={() => { setPremio(false); setRef(h.ref); }}
                      aria-current={aqui ? "true" : undefined}
                      title={`${h.nombre} · ${h.ok}/${TOTAL} piezas${etq?.tamano ? ` · etiqueta ${etq.tamano}` : " · sin etiqueta"}`}
                      className={`mck-flujo-nodo flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-bold ${aqui ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink-secondary hover:border-accent/60 hover:text-ink"}`}
                    >
                      {h.presentacion || h.nombre.split(" ").slice(-1)[0]}
                      <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${aqui ? "bg-white/25" : completo(h) ? "bg-accent-leaf text-white" : "bg-surface text-muted"}`}>{h.ok}/{TOTAL}</span>
                      <span className={`font-mono text-[9px] font-normal ${aqui ? "text-white/80" : etq?.tamano ? "text-muted" : "text-accent-rose"}`}>{etq?.tamano || "sin etiqueta"}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mck-mision-lienzo">
              <Tablero c={c} sel={sel} guia={guia} destello={destello} premio={premio} onSel={tocarPieza} />
            </div>
            <p className="mt-1 hidden shrink-0 text-center font-mono text-[9.5px] text-muted [@media(min-height:840px)]:block">toca una pieza para resolverla · ← → cambian de combo · 1–6 abren una pieza · F las fotos</p>
          </div>

          <div className="contents">
            {piezaAbierta && sel !== "publicacion" && (() => {
              const pend = ORDEN_GUIA.filter((k) => k !== sel && k !== "publicacion" && c.eslabones[k] && c.eslabones[k].estado !== "ok");
              const sig = pend[0] ? { clave: pend[0], titulo: c.eslabones[pend[0]].titulo } : null;
              return (
                <PiezaEmergente clave={sel} e={c.eslabones[sel]} recien={recien} siguiente={sig}
                  onSiguiente={() => { if (sig) { setRecien(null); setSel(sig.clave); } }} onCerrar={() => { setPiezaAbierta(false); setRecien(null); }}>
                  <Inspector c={c} clave={sel} hermanas={hermanas} alResolver={alResolver} abrirPublicacion={() => { setPiezaAbierta(false); setPubAbierta(true); }} irA={(k) => { setRecien(null); setSel(k); }} cerrarPieza={() => { setPiezaAbierta(false); setRecien(null); }} />
                </PiezaEmergente>
              );
            })()}
            {pubAbierta && (
              <PublicacionEmergente
                key={c.ref}
                sku={c.ref}
                nombre={c.nombre}
                precioLista={c.precio_lista}
                onCerrar={() => { setPubAbierta(false); void alResolver(); }}
              />
            )}
          </div>
        </div>
      )}

    </div>
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
      {ventana?.tipo === "crear" && (
        <VentanaTaller titulo="Crear en Alegra" combo={ventana.nombre} ancho="max-w-[900px]" onCerrar={cerrarVentana}
          ayuda={<>Este producto (<code>{ventana.ref}</code>) no tiene presentación de venta. Crea su combo; al cerrar aparece en la lista del taller.</>}>
          {/* Lo que falta es la presentación de VENTA: el formulario nace como combo (código C-…). */}
          <CrearProductosSiigoPanel compact inicial={{ codigo: ventana.ref.toUpperCase().startsWith("C-") ? ventana.ref : "C-", nombre: ventana.nombre }} onCreado={() => void alResolver()} />
        </VentanaTaller>
      )}
    </VentanaCtx.Provider>
  );
}
