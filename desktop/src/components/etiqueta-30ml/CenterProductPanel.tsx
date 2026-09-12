import { useRef, useState } from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import { EditableLabel } from "../etiqueta-ficha/EditableField";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import PopoverFlotante from "../etiqueta-ficha/PopoverFlotante";
import { TITULOS_CAS, type ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import CampoEtiqueta from "./CampoEtiqueta";
import {
  EJEMPLO_30ML,
  GRADOS_INSUMO,
  GRADO_INSUMO_POR_DEFECTO,
  PREFIJO_SUBTITULO,
  TAM_30ML,
  textoContenidoNeto,
} from "./etiqueta30mlTypes";

/** Panel central, de arriba abajo: logo · nombre + subtítulo + tabla técnica ·
 *  contenido neto. La fila del logo mide lo mismo que una fila de los paneles
 *  laterales, así la línea bajo el logo cae a la altura de las otras dos.
 *
 *  Mismo manejo que la cabecera de la ficha de 76 × 66: clic en el logo abre
 *  los logos corporativos, la lupa junto al nombre busca la ficha técnica y
 *  cada dato se escribe en el sitio. */
export default function CenterProductPanel({
  data,
  editMode,
  onChange,
}: {
  data: ProductLabelData;
  editMode: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
}) {
  const nombreCajaRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const editable = editMode && Boolean(onChange);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <section className="e30-panel e30-panel-centro">
      <div ref={logoRef} className="e30-logo e30-linea-inf">
        <button
          type="button"
          disabled={!editable}
          onClick={() => setMenuLogo((v) => !v)}
          title={editable ? "Elegir logo (carpeta DISEÑO CORPORATIVO)" : undefined}
          className="e30-logo-caja mck-btn-no-fx"
        >
          {data.logoUrl ? (
            <img src={data.logoUrl} alt="Logotipo" />
          ) : editMode ? (
            <span className="e30-logo-vacio">McKenna Group</span>
          ) : null}
        </button>
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

      <div className="e30-identidad">
        <div ref={nombreCajaRef} className="e30-nombre-caja">
          <CampoEtiqueta
            as="h1"
            valor={data.productName || ""}
            onChange={cambio("productName")}
            editMode={editMode}
            styleKey="e30_productName"
            ejemplo={EJEMPLO_30ML.productName}
            tam={TAM_30ML.nombre}
            maxLineas={2}
            cajaRef={nombreCajaRef}
            multilinea
            className="e30-nombre"
          />
          {editable && onChange && (
            <div className="e30-lupa">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
        </div>
        <p className="e30-subtitulo">
          {PREFIJO_SUBTITULO}{" "}
          <GradoInsumo
            valor={data.gradoInsumo || GRADO_INSUMO_POR_DEFECTO}
            editMode={editable}
            onElegir={(v) => onChange?.({ gradoInsumo: v })}
          />
        </p>
        <div className="e30-tabla">
          <div className="e30-tabla-campo e30-tabla-fila1">
            <EditableLabel
              texto="PUREZA:"
              editMode={editMode}
              styleKey="e30_concentrationTitulo"
              defaultFontSize={13}
            />
          </div>
          <div className="e30-tabla-valor e30-tabla-fila1">
            <CampoEtiqueta
              as="span"
              valor={data.concentration || ""}
              onChange={cambio("concentration")}
              editMode={editMode}
              styleKey="e30_concentration"
              ejemplo={EJEMPLO_30ML.concentration}
              tam={TAM_30ML.tabla}
              maxLineas={1}
            />
          </div>
          <div className="e30-tabla-campo">
            <EditableLabel
              texto={`${data.casTitulo || TITULOS_CAS[0]}:`}
              editMode={editMode}
              styleKey="e30_casTitulo"
              defaultFontSize={13}
              opciones={TITULOS_CAS}
              valorOpcion={data.casTitulo || TITULOS_CAS[0]}
              onElegirOpcion={(v) => onChange?.({ casTitulo: v })}
            />
          </div>
          <div className="e30-tabla-valor">
            <CampoEtiqueta
              as="span"
              valor={data.cas || ""}
              onChange={cambio("cas")}
              editMode={editMode}
              styleKey="e30_cas"
              ejemplo={EJEMPLO_30ML.cas}
              tam={TAM_30ML.tabla}
              maxLineas={1}
            />
          </div>
        </div>
      </div>

      <div className="e30-neto e30-linea-sup">
        <EditableLabel
          texto="Contenido neto:"
          editMode={editMode}
          styleKey="e30_netoTitulo"
          defaultFontSize={14}
          as="p"
          className="e30-neto-titulo"
        />
        <CampoEtiqueta
          valor={data.netContent || ""}
          onChange={cambio("netContent")}
          editMode={editMode}
          styleKey="e30_netContent"
          ejemplo={EJEMPLO_30ML.netContent}
          mostrar={textoContenidoNeto}
          tam={TAM_30ML.neto}
          maxLineas={1}
          className="e30-neto-valor"
        />
      </div>
    </section>
  );
}

/** «COSMÉTICO» del subtítulo: en edición despliega ALIMENTARIO, AGRO,
 *  INDUSTRIAL. El menú se porta fuera de la etiqueta (no sale en el PNG).
 *  Lo usa también la etiqueta de 69 × 51 mm. */
export function GradoInsumo({
  valor,
  editMode,
  onElegir,
}: {
  valor: string;
  editMode: boolean;
  onElegir: (v: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  if (!editMode) return <span>{valor}</span>;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="e30-grado-boton mck-btn-no-fx"
        onClick={() => setAbierto((v) => !v)}
        title="Cambiar el grado del insumo"
      >
        {valor} ▾
      </button>
      <PopoverFlotante anchorRef={ref} abierto={abierto} onCerrar={() => setAbierto(false)} ancho={200}>
        <p className="mb-1 text-[11px] font-semibold text-muted">Insumo grado…</p>
        <ul className="space-y-0.5">
          {GRADOS_INSUMO.map((g) => (
            <li key={g}>
              <button
                type="button"
                onClick={() => {
                  onElegir(g);
                  setAbierto(false);
                }}
                className={`w-full rounded px-2 py-1.5 text-left text-xs font-semibold ${
                  g === valor ? "bg-accent/15 text-accent" : "text-ink hover:bg-surface-hover"
                }`}
              >
                {g}
              </button>
            </li>
          ))}
        </ul>
      </PopoverFlotante>
    </>
  );
}
