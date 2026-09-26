import { useRef, useState } from "react";
import BuscadorFichaTecnica from "../etiqueta-ficha/BuscadorFichaTecnica";
import MenuLogoCorporativo from "../etiqueta-ficha/MenuLogoCorporativo";
import type { ProductLabelData } from "../etiqueta-ficha/productLabelTypes";
import CampoEtiqueta from "../etiqueta-30ml/CampoEtiqueta";
import LemaLogo from "../etiqueta-30ml/LemaLogo";
import { CasillaDato } from "./CasillasCapsulas";
import { EJEMPLO_CAPSULAS, TAM_CAPSULAS, soloDigitos } from "./etiquetaCapsulasTypes";

/** Panel principal (izquierda), tres franjas: cabecera de marca (43 %) ·
 *  nombre y subtítulo (39 %) · presentación, Tamaño | Contenido (18 %).
 *
 *  El logo es el archivo original de DISEÑO CORPORATIVO (`MenuLogoCorporativo`,
 *  el mismo menú de las demás etiquetas, que también deja cargar uno); el
 *  lema va debajo con el ancho del logo (`LemaLogo`). */
export default function PanelPrincipalCapsulas({
  data,
  editMode,
  onChange,
}: {
  data: ProductLabelData;
  editMode: boolean;
  onChange?: (patch: Partial<ProductLabelData>) => void;
}) {
  const logoRef = useRef<HTMLDivElement>(null);
  const nombreCajaRef = useRef<HTMLDivElement>(null);
  const [menuLogo, setMenuLogo] = useState(false);
  const editable = editMode && Boolean(onChange);
  const cambio = (campo: keyof ProductLabelData) =>
    onChange ? (v: string) => onChange({ [campo]: v }) : undefined;

  return (
    <section className="ecap-panel ecap-panel-principal" aria-label="Marca y presentación">
      <div ref={logoRef} className="e30-logo e30-logo-con-lema ecap-marca e30-linea-inf">
        <button
          type="button"
          disabled={!editable}
          onClick={() => setMenuLogo((v) => !v)}
          title={editable ? "Elegir o cargar logo (carpeta DISEÑO CORPORATIVO)" : undefined}
          className="e30-logo-caja mck-btn-no-fx"
        >
          {data.logoUrl ? (
            <img src={data.logoUrl} alt="McKenna Group" />
          ) : editMode ? (
            <span className="e30-logo-vacio">Elegir logo</span>
          ) : null}
        </button>
        <LemaLogo logoRef={logoRef} logoUrl={data.logoUrl} className="ecap-lema" />
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

      <div className="e30-identidad ecap-identidad e30-linea-inf">
        <div ref={nombreCajaRef} className="e30-nombre-caja">
          <CampoEtiqueta
            as="h1"
            valor={data.productName || ""}
            onChange={cambio("productName")}
            editMode={editMode}
            styleKey="ecap_productName"
            ejemplo={EJEMPLO_CAPSULAS.productName}
            tam={TAM_CAPSULAS.nombre}
            maxLineas={2}
            cajaRef={nombreCajaRef}
            multilinea
            className="e30-nombre ecap-nombre"
          />
          {editable && onChange && (
            <div className="e30-lupa">
              <BuscadorFichaTecnica onAplicar={onChange} consultaInicial={data.barcodeTitle || ""} />
            </div>
          )}
        </div>
        <CampoEtiqueta
          valor={data.capsulasSubtitulo || ""}
          onChange={cambio("capsulasSubtitulo")}
          editMode={editMode}
          styleKey="ecap_capsulasSubtitulo"
          ejemplo={EJEMPLO_CAPSULAS.capsulasSubtitulo}
          tam={TAM_CAPSULAS.subtitulo}
          maxLineas={1}
          className="ecap-subtitulo"
        />
      </div>

      <div className="ecap-presentacion">
        <CasillaDato
          campo="capsulasTamano"
          titulo="TAMAÑO:"
          valor={data.capsulasTamano || ""}
          ejemplo={EJEMPLO_CAPSULAS.capsulasTamano}
          editMode={editMode}
          tam={TAM_CAPSULAS.valorDato}
          lineas="e30-linea-der"
          onChange={cambio("capsulasTamano")}
        />
        <CasillaDato
          campo="netContent"
          titulo="CONTENIDO:"
          valor={soloDigitos(data.netContent || "")}
          ejemplo={EJEMPLO_CAPSULAS.netContent}
          editMode={editMode}
          tam={TAM_CAPSULAS.valorDato}
          destacado
          sufijo="UNIDADES"
          onChange={onChange ? (v) => onChange({ netContent: soloDigitos(v) }) : undefined}
        />
      </div>
    </section>
  );
}
