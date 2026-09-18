import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import PopoverFlotante from "../etiqueta-ficha/PopoverFlotante";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import LemaLogo from "../etiqueta-30ml/LemaLogo";
import { EJEMPLO_ETIQUETA, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import BarcodeSection from "../etiqueta-30ml/BarcodeSection";
import { textoContenidoNeto } from "../etiqueta-30ml/etiqueta30mlTypes";
import { useVersionFuentes } from "../etiqueta-30ml/useAjusteTexto";
import type { CodigoEan } from "../../lib/etiquetasCodigosEan";
import {
  ALTO_FRANJA_CIRCULAR,
  arcoTexto,
  lineasAplicaciones,
  TRAMOS_CIRCULAR,
  unirAplicaciones,
  variablesCirculares,
  type ReticulaCircular,
} from "./etiquetaCircularTypes";
import "../etiqueta-30ml/etiqueta30ml.css";
import "./etiquetaCircular.css";

/** Ejemplos en gris de las casillas vacías, solo en edición (§ referencia). */
const EJEMPLO_CIRCULAR = {
  productName: "MANTECA KARITÉ",
  descripcionProducto:
    "Grasa vegetal de color marfil, extraída de la semilla del árbol del karité "
    + "(Butyrospermum parkii Kostchy, fam. Sapotáceas), un árbol de África Central.",
  aplicacionesTitulo: "Aplicaciones:",
  aplicacion: "En la fabricación de cremas hidratantes para piel…",
  empresa: "MCKENNA GROUP",
  registro: "SD2018919-20245917",
  controlCalidad:
    "Superados los 12 meses de almacenamiento debe solicitarse un nuevo análisis "
    + "de control de calidad antes de su uso.",
  netContent: "125 g",
} as const;

interface Props {
  data: ProductLabelData;
  reticula: ReticulaCircular;
  editMode: boolean;
  guias?: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
  onElegirCodigo?: (codigo: CodigoEan) => void;
}

/**
 * Etiqueta circular 53 × 53 mm — Ceras y mantecas.
 *
 *            ╭────── MANTECA KARITÉ ──────╮
 *          ╱      descripción del producto   ╲
 *        │           Aplicaciones:            │
 *   E  │  • … • … • …                          │  c
 *   M  │                                       │  o
 *   P  │            ▌▌▐▌▌▐▐▌▌                  │  n
 *   R  │               125 g                   │  t
 *        ╲        SD2018919-20245917         ╱
 *            ╰───────────────────────────╯
 *
 * Dos capas sobre un lienzo cuadrado con `border-radius: 50%`: el SVG con
 * los dos círculos y los cuatro textos curvos (`textPath`), y encima las
 * bandas HTML del bloque central. Los textos rectos se editan en el sitio
 * como en las demás etiquetas; los curvos, con un clic que abre su casilla
 * fuera de la etiqueta (no cabe una casilla sobre una curva).
 *
 * Es el nodo que se rasteriza para el PNG y la impresión, a su tamaño de
 * diseño; quien la muestra la escala desde afuera.
 */
const EtiquetaCircular = forwardRef<HTMLDivElement, Props>(function EtiquetaCircular(
  { data, reticula, editMode, guias, onChange, onElegirCodigo },
  ref,
) {
  const uid = useId().replace(/:/g, "");
  const editable = editMode && Boolean(onChange);
  const { centro, diametro, rExterior, rInterior, rAnillo, rTitulo, sepArco } = reticula;
  // Bandas y tamaños salen de la retícula: siguen al diámetro, no son px sueltos.
  const bandas = reticula.bandas;
  const tam = reticula.tam;

  const logoRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const bandaDescRef = useRef<HTMLDivElement>(null);
  const bandaListaRef = useRef<HTMLDivElement>(null);

  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  const aplicaciones = lineasAplicaciones(data.aplicaciones);
  const filas = editable && aplicaciones.length === 0 ? [""] : aplicaciones;
  const editarAplicacion = (i: number, v: string) => {
    const copia = [...filas];
    copia[i] = v;
    onChange?.({ aplicaciones: unirAplicaciones(copia) });
  };
  const quitarAplicacion = (i: number) =>
    onChange?.({ aplicaciones: unirAplicaciones(filas.filter((_, j) => j !== i)) });
  const anadirAplicacion = () => onChange?.({ aplicaciones: unirAplicaciones([...filas, ""]) });

  const idTitulo = `${uid}-titulo`;
  const idControl = `${uid}-control`;
  const idRegistro = `${uid}-registro`;
  const idEmpresa = `${uid}-empresa`;
  const idCiudad = `${uid}-ciudad`;

  return (
    <div
      ref={ref}
      lang="es"
      className={`ec-etiqueta${guias ? " ec-guias" : ""}${editMode ? " e30-editando ec-editando" : ""}`}
      style={{ width: diametro, height: diametro, ...variablesCirculares(reticula, data.accentColor) }}
    >
      <svg className="ec-svg" viewBox={`0 0 ${diametro} ${diametro}`} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <path id={idTitulo} fill="none" d={arcoTexto(centro, rTitulo, TRAMOS_CIRCULAR.titulo.desde, TRAMOS_CIRCULAR.titulo.hasta, true)} />
          <path id={idControl} fill="none" d={arcoTexto(centro, rAnillo, TRAMOS_CIRCULAR.control.desde, TRAMOS_CIRCULAR.control.hasta, true)} />
          <path id={idRegistro} fill="none" d={arcoTexto(centro, rAnillo, TRAMOS_CIRCULAR.registro.desde, TRAMOS_CIRCULAR.registro.hasta, false)} />
          <path id={idEmpresa} fill="none" d={arcoTexto(centro, rAnillo + sepArco, TRAMOS_CIRCULAR.empresa.desde, TRAMOS_CIRCULAR.empresa.hasta, true)} />
          <path id={idCiudad} fill="none" d={arcoTexto(centro, rAnillo - sepArco, TRAMOS_CIRCULAR.empresa.desde, TRAMOS_CIRCULAR.empresa.hasta, true)} />
        </defs>

        <circle className="ec-borde-exterior" cx={centro} cy={centro} r={rExterior} strokeWidth={reticula.lineaFina} />
        <circle className="ec-borde-interior" cx={centro} cy={centro} r={rInterior} strokeWidth={reticula.linea} />

        <TextoCurvo
          idPath={idTitulo}
          arco={{ r: rTitulo, ...TRAMOS_CIRCULAR.titulo }}
          valor={data.productName || ""}
          ejemplo={EJEMPLO_CIRCULAR.productName}
          tam={tam.titulo}
          rotulo="Nombre del producto"
          clase="ec-curvo ec-curvo-titulo"
          editable={editable}
          editMode={editMode}
          onChange={cambio("productName")}
        />
        <TextoCurvo
          idPath={idControl}
          arco={{ r: rAnillo, ...TRAMOS_CIRCULAR.control }}
          valor={data.controlCalidad || ""}
          ejemplo={EJEMPLO_CIRCULAR.controlCalidad}
          tam={tam.control}
          rotulo="Aviso de control de calidad"
          clase="ec-curvo ec-curvo-gris"
          editable={editable}
          editMode={editMode}
          multilinea
          onChange={cambio("controlCalidad")}
        />
        <TextoCurvo
          idPath={idRegistro}
          arco={{ r: rAnillo, ...TRAMOS_CIRCULAR.registro }}
          valor={data.registro || ""}
          ejemplo={EJEMPLO_CIRCULAR.registro}
          tam={tam.registro}
          rotulo="Número de registro"
          clase="ec-curvo"
          editable={editable}
          editMode={editMode}
          onChange={cambio("registro")}
        />
        <TextoCurvo
          idPath={idEmpresa}
          arco={{ r: rAnillo + sepArco, ...TRAMOS_CIRCULAR.empresa }}
          valor={data.empresa || ""}
          ejemplo={EJEMPLO_CIRCULAR.empresa}
          tam={tam.empresa}
          rotulo="Razón social"
          clase="ec-curvo"
          editable={editable}
          editMode={editMode}
          onChange={cambio("empresa")}
        />
        <TextoCurvo
          idPath={idCiudad}
          arco={{ r: rAnillo - sepArco, ...TRAMOS_CIRCULAR.empresa }}
          valor={data.city || ""}
          ejemplo={EJEMPLO_ETIQUETA.city}
          tam={tam.empresa}
          rotulo="Ciudad y país"
          clase="ec-curvo"
          editable={editable}
          editMode={editMode}
          onChange={cambio("city")}
        />
      </svg>

      <div className="ec-centro">
        {/* Lupa de fichas técnicas: fuera del recorrido de los textos, en el
            hueco que queda arriba a la derecha del anillo. */}
        {editable && onChange && (
          <div style={{ position: "absolute", top: diametro * 0.345, right: diametro * 0.115 }}>
            <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
          </div>
        )}

        {/* Logo y lema de la casa, igual que en las demás etiquetas: el logo se
            elige de DISEÑO CORPORATIVO y el lema es constante. */}
        <div
          ref={logoRef}
          className="ec-banda ec-logo"
          style={{ top: bandas.logo.top, height: bandas.logo.alto, width: bandas.logo.ancho }}
        >
          <button
            type="button"
            disabled={!editable}
            onClick={() => setMenuLogo((v) => !v)}
            title={editable ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
            className="e30-logo-caja ec-logo-caja mck-btn-no-fx"
          >
            {data.logoUrl ? (
              <img className="ec-logo-img" src={data.logoUrl} alt="Logotipo" />
            ) : editMode ? (
              <span className="e30-logo-vacio">McKenna Group</span>
            ) : null}
          </button>
          <LemaLogo logoRef={logoRef} logoUrl={data.logoUrl} className="ec-lema" />
          {onChange && (
            <MenuLogoCorporativo
              data={data}
              onChange={onChange}
              anchorRef={logoRef}
              abierto={editable && menuLogo}
              onCerrar={() => setMenuLogo(false)}
              alinear="centro"
            />
          )}
        </div>

        <div
          ref={bandaDescRef}
          className="ec-banda"
          style={{ top: bandas.descripcion.top, height: bandas.descripcion.alto, width: bandas.descripcion.ancho }}
        >
          <CampoEtiqueta
            valor={data.descripcionProducto || ""}
            onChange={cambio("descripcionProducto")}
            editMode={editMode}
            styleKey="ec_descripcion"
            ejemplo={EJEMPLO_CIRCULAR.descripcionProducto}
            tam={tam.descripcion}
            maxLineas={5}
            cajaRef={bandaDescRef}
            multilinea
            className="ec-descripcion"
          />
        </div>

        <div
          className="ec-banda"
          style={{ top: bandas.aplicacionesTitulo.top, height: bandas.aplicacionesTitulo.alto, width: bandas.aplicacionesTitulo.ancho }}
        >
          <CampoEtiqueta
            valor={data.aplicacionesTitulo || ""}
            onChange={cambio("aplicacionesTitulo")}
            editMode={editMode}
            styleKey="ec_aplicacionesTitulo"
            ejemplo={EJEMPLO_CIRCULAR.aplicacionesTitulo}
            tam={tam.aplicacionesTitulo}
            maxLineas={1}
            className="ec-aplicaciones-titulo"
          />
        </div>

        <div
          ref={bandaListaRef}
          className="ec-banda"
          style={{ top: bandas.aplicaciones.top, height: bandas.aplicaciones.alto, width: bandas.aplicaciones.ancho }}
        >
          <ul className="ec-lista">
            {filas.map((linea, i) => (
              <li key={i} className="ec-item">
                <span className="ec-item-vineta" aria-hidden="true" />
                <div className="ec-item-caja">
                  <CampoEtiqueta
                    valor={linea}
                    onChange={editable ? (v) => editarAplicacion(i, v) : undefined}
                    editMode={editMode}
                    styleKey="ec_aplicacion"
                    ejemplo={EJEMPLO_CIRCULAR.aplicacion}
                    tam={tam.aplicacion}
                    maxLineas={4}
                    cajaRef={bandaListaRef}
                    multilinea
                    className="ec-item-texto"
                  />
                  {editable && filas.length > 1 && (
                    <button
                      type="button"
                      className="ec-item-quitar mck-btn-no-fx"
                      title="Quitar esta aplicación"
                      onClick={() => quitarAplicacion(i)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {editable && (
            <button type="button" className="ec-anadir mck-btn-no-fx" onClick={anadirAplicacion}>
              + Añadir aplicación
            </button>
          )}
        </div>

        <div
          className="ec-banda"
          style={{ top: bandas.barras.top, height: bandas.barras.alto, width: bandas.barras.ancho }}
        >
          <div className="ec-barras-caja">
            <BarcodeSection
              value={data.barcode}
              editMode={editable}
              onChange={(v) => onChange?.({ barcode: v })}
              onElegirCodigo={onElegirCodigo}
              franja={{ alto: ALTO_FRANJA_CIRCULAR }}
            />
          </div>
        </div>

        <div
          className="ec-banda"
          style={{ top: bandas.neto.top, height: bandas.neto.alto, width: bandas.neto.ancho }}
        >
          <CampoEtiqueta
            valor={data.netContent || ""}
            onChange={cambio("netContent")}
            editMode={editMode}
            styleKey="ec_netContent"
            ejemplo={EJEMPLO_CIRCULAR.netContent}
            mostrar={textoContenidoNeto}
            tam={tam.neto}
            maxLineas={1}
            className="ec-neto"
          />
        </div>
      </div>
    </div>
  );
});

export default EtiquetaCircular;

// ── Texto curvo ────────────────────────────────────────────────────────────

/**
 * Un texto sobre un arco. El tamaño de letra se ajusta contra el LARGO DEL
 * ARCO (`getComputedTextLength`, no el ancho de una caja: aquí no hay caja),
 * bajando de medio en medio píxel hasta que cabe o llega al mínimo; si ni al
 * mínimo cabe, se marca en rojo como el resto de las casillas.
 *
 * En edición no se puede poner un <input> sobre una curva, así que el texto
 * se vuelve clicable y su casilla se abre en un popover anclado al propio
 * texto — sigue editándose sobre la etiqueta, como el logo o el código.
 */
function TextoCurvo({
  idPath,
  arco,
  valor,
  ejemplo,
  tam,
  rotulo,
  clase,
  editable,
  editMode,
  multilinea = false,
  onChange,
}: {
  idPath: string;
  arco: { r: number; desde: number; hasta: number };
  valor: string;
  ejemplo: string;
  tam: readonly [number, number];
  /** Nombre del dato, para el encabezado del popover. */
  rotulo: string;
  clase: string;
  editable: boolean;
  editMode: boolean;
  multilinea?: boolean;
  onChange?: (v: string) => void;
}) {
  const textoRef = useRef<SVGTextElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [desborda, setDesborda] = useState(false);
  const versionFuentes = useVersionFuentes();

  const vacio = !valor.trim();
  const visible = vacio ? (editMode ? ejemplo : "") : valor;
  // Largo del arco disponible, menos un respiro en las dos puntas.
  const largoArco = (arco.r * Math.abs(arco.hasta - arco.desde) * Math.PI) / 180 * 0.96;

  useLayoutEffect(() => {
    const el = textoRef.current;
    if (!el || !visible) {
      setDesborda(false);
      return;
    }
    let f = tam[0];
    el.style.fontSize = `${f}px`;
    const cabe = () => el.getComputedTextLength() <= largoArco;
    while (f > tam[1] && !cabe()) {
      f = Math.max(tam[1], f - 0.5);
      el.style.fontSize = `${f}px`;
    }
    setDesborda(!cabe());
  }, [visible, tam, largoArco, versionFuentes]);

  return (
    <>
      <text
        ref={textoRef}
        className={`${clase}${vacio ? " ec-curvo-ejemplo" : ""}`}
        dominantBaseline="central"
        onClick={editable ? () => setAbierto((v) => !v) : undefined}
        style={desborda && editMode && !vacio ? { fill: "#d33" } : undefined}
      >
        <title>
          {desborda && !vacio ? `${rotulo}: no cabe completo en su arco, acórtalo` : rotulo}
        </title>
        <textPath href={`#${idPath}`} startOffset="50%" textAnchor="middle">
          {visible}
        </textPath>
      </text>
      {editable && (
        <CasillaCurva
          anchorRef={textoRef}
          abierto={abierto}
          onCerrar={() => setAbierto(false)}
          rotulo={rotulo}
          valor={valor}
          ejemplo={ejemplo}
          multilinea={multilinea}
          desborda={desborda}
          onChange={onChange}
        />
      )}
    </>
  );
}

/** Casilla del texto curvo, portada fuera del SVG. */
function CasillaCurva({
  anchorRef,
  abierto,
  onCerrar,
  rotulo,
  valor,
  ejemplo,
  multilinea,
  desborda,
  onChange,
}: {
  anchorRef: RefObject<SVGTextElement | null>;
  abierto: boolean;
  onCerrar: () => void;
  rotulo: string;
  valor: string;
  ejemplo: string;
  multilinea: boolean;
  desborda: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <PopoverFlotante anchorRef={anchorRef} abierto={abierto} onCerrar={onCerrar} alinear="centro" ancho={320}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold text-ink">{rotulo}</p>
        <button type="button" onClick={onCerrar} className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      {multilinea ? (
        <textarea
          autoFocus
          rows={3}
          value={valor}
          placeholder={ejemplo}
          onChange={(e) => onChange?.(e.target.value)}
          className="mck-field-lg w-full resize-none rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
        />
      ) : (
        <input
          autoFocus
          type="text"
          value={valor}
          placeholder={ejemplo}
          onChange={(e) => onChange?.(e.target.value)}
          className="mck-field-lg w-full rounded-lg border border-border bg-surface-input px-2.5 py-1.5 text-xs"
        />
      )}
      <p className={`mt-1 text-[11px] ${desborda ? "text-red-600" : "text-muted"}`}>
        {desborda
          ? "No cabe completo en su arco ni al tamaño mínimo: acórtalo."
          : "Va sobre el arco; el tamaño se ajusta solo para que quepa."}
      </p>
    </PopoverFlotante>
  );
}
