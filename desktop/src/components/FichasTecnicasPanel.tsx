import { Fragment, useCallback, useEffect, useState } from "react";
import DocumentoGeneradorTab, {
  Field,
  filasDesdeTexto,
  filasTresDesdeTexto,
  listaDesdeTexto,
  textoDesdeFilas,
  textoDesdeFilasTres,
} from "./documentos/DocumentoGeneradorTab";
import DocumentosCatalogoTab, {
  type ProductoDocumentacion,
} from "./documentos/DocumentosCatalogoTab";

type TabDoc = "catalogo" | "ft" | "coa" | "sds";

const TABS: { id: TabDoc; label: string }[] = [
  { id: "catalogo", label: "Catálogo productos" },
  { id: "ft", label: "Ficha técnica (TDS)" },
  { id: "coa", label: "COA" },
  { id: "sds", label: "SDS" },
];

function FichaTecnicaTabContent({
  producto,
}: {
  producto: ProductoDocumentacion | null;
}) {
  const [titulo, setTitulo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [aplicaciones, setAplicaciones] = useState("");
  const [identidad, setIdentidad] = useState("");
  const [propiedades, setPropiedades] = useState("");
  const [microbiologia, setMicrobiologia] = useState("");
  const [notaMicro, setNotaMicro] = useState("");
  const [estabilidad, setEstabilidad] = useState("");

  useEffect(() => {
    if (!producto) return;
    setTitulo(producto.nombre_base.toUpperCase());
    setReferencia(producto.ref);
  }, [producto?.ref, producto?.nombre_base]);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    setTitulo(String(datos.titulo || ""));
    setDescripcion(String(datos.descripcion || ""));
    setAplicaciones(
      Array.isArray(datos.aplicaciones)
        ? (datos.aplicaciones as string[]).join("\n\n")
        : String(datos.aplicaciones || ""),
    );
    setIdentidad(textoDesdeFilas(datos.identidad));
    setPropiedades(textoDesdeFilas(datos.propiedades));
    setMicrobiologia(textoDesdeFilas(datos.microbiologia));
    setNotaMicro(String(datos.nota_micro || ""));
    setEstabilidad(
      Array.isArray(datos.estabilidad)
        ? (datos.estabilidad as string[]).join("\n\n")
        : String(datos.estabilidad || ""),
    );
  }, []);

  const buildDatos = useCallback(
    () => ({
      titulo,
      referencia,
      descripcion,
      aplicaciones: listaDesdeTexto(aplicaciones),
      identidad: filasDesdeTexto(identidad),
      propiedades: filasDesdeTexto(propiedades),
      microbiologia: filasDesdeTexto(microbiologia),
      nota_micro: notaMicro,
      estabilidad: listaDesdeTexto(estabilidad),
    }),
    [titulo, referencia, descripcion, aplicaciones, identidad, propiedades, microbiologia, notaMicro, estabilidad],
  );

  return (
    <DocumentoGeneradorTab
      apiPrefix="/api/fichas"
      queryKey="fichas"
      tituloSeccion="Ficha técnica (TDS)"
      descripcion="Genera DOCX y PDF con el formato McKenna y súbelos a Drive (carpetas TDS WORD y TDS PDF)."
      botonGenerar="Generar ficha técnica"
      carpetaDriveLabel="TDS"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      showWordPdfFolders
      productoRef={producto?.ref ?? ""}
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field value={titulo} onChange={setTitulo} placeholder="Título (ej. ARCILLA ROJA)" />
          <Field label="Referencia SIIGO" value={referencia} onChange={setReferencia} placeholder="C-…" />
        </div>
        <Field value={descripcion} onChange={setDescripcion} rows={4} placeholder="Descripción" />
        <Field value={aplicaciones} onChange={setAplicaciones} rows={4} placeholder="Aplicaciones (un párrafo por línea)" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Identidad (campo|valor)" value={identidad} onChange={setIdentidad} rows={6} mono />
          <Field label="Propiedades" value={propiedades} onChange={setPropiedades} rows={6} mono />
          <Field label="Microbiología" value={microbiologia} onChange={setMicrobiologia} rows={6} mono />
        </div>
        <Field value={notaMicro} onChange={setNotaMicro} placeholder="Nota microbiológica" />
        <Field value={estabilidad} onChange={setEstabilidad} rows={2} placeholder="Estabilidad y almacenamiento" />
      </div>
    </DocumentoGeneradorTab>
  );
}

function CoaTabContent({
  producto,
}: {
  producto: ProductoDocumentacion | null;
}) {
  const [titulo, setTitulo] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [referencia, setReferencia] = useState("");
  const [inci, setInci] = useState("");
  const [cas, setCas] = useState("");
  const [formula, setFormula] = useState("");
  const [einces, setEinces] = useState("");
  const [concentracion, setConcentracion] = useState("");
  const [grado, setGrado] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [incluye, setIncluye] = useState("");
  const [loteNum, setLoteNum] = useState("");
  const [fab, setFab] = useState("");
  const [venc, setVenc] = useState("");
  const [vidaUtil, setVidaUtil] = useState("");
  const [tamanoLote, setTamanoLote] = useState("");
  const [pais, setPais] = useState("");
  const [fechaAnalisis, setFechaAnalisis] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [parametros, setParametros] = useState("");
  const [empaque, setEmpaque] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [precauciones, setPrecauciones] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [codigoVerif, setCodigoVerif] = useState("");

  useEffect(() => {
    if (!producto) return;
    setTitulo(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref, producto?.nombre, producto?.nombre_base]);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    const ident = (datos.identificacion || {}) as Record<string, string>;
    const lote = (datos.lote || {}) as Record<string, string>;
    const emp = (datos.empaque || {}) as Record<string, string>;
    setTitulo(String(datos.titulo || ""));
    setNombreComercial(String(ident.nombre_comercial || ""));
    setReferencia(String(ident.referencia_interna || ""));
    setInci(String(ident.nombre_inci || ""));
    setCas(String(ident.cas || ""));
    setFormula(String(ident.formula_molecular || ""));
    setEinces(String(ident.einces || ""));
    setConcentracion(String(ident.concentracion || ""));
    setGrado(String(ident.grado || ""));
    setPresentacion(String(ident.presentacion || ""));
    setIncluye(String(ident.incluye || ""));
    setLoteNum(String(lote.numero || ""));
    setFab(String(lote.fecha_fabricacion || ""));
    setVenc(String(lote.fecha_vencimiento || ""));
    setVidaUtil(String(lote.vida_util || ""));
    setTamanoLote(String(lote.tamano_lote || ""));
    setPais(String(lote.pais_origen || ""));
    setFechaAnalisis(String(lote.fecha_analisis || ""));
    setFechaEmision(String(lote.fecha_emision || ""));
    setParametros(textoDesdeFilasTres(datos.parametros));
    setEmpaque(String(emp.empaque_original || ""));
    setAlmacenamiento(String(emp.almacenamiento || ""));
    setPrecauciones(String(emp.precauciones || ""));
    setObservaciones(String(emp.observaciones || ""));
    setCodigoVerif(String(datos.codigo_verificacion || ""));
  }, []);

  const buildDatos = useCallback(
    () => ({
      titulo,
      identificacion: {
        nombre_comercial: nombreComercial || titulo,
        referencia_interna: referencia,
        nombre_inci: inci,
        cas,
        formula_molecular: formula,
        einces,
        concentracion,
        grado,
        presentacion,
        incluye,
      },
      lote: {
        numero: loteNum,
        fecha_fabricacion: fab,
        fecha_vencimiento: venc,
        vida_util: vidaUtil,
        tamano_lote: tamanoLote,
        pais_origen: pais,
        fecha_analisis: fechaAnalisis,
        fecha_emision: fechaEmision,
      },
      parametros: filasTresDesdeTexto(parametros),
      empaque: {
        empaque_original: empaque,
        almacenamiento,
        precauciones,
        observaciones,
      },
      codigo_verificacion: codigoVerif,
    }),
    [
      titulo, nombreComercial, referencia, inci, cas, formula, einces, concentracion, grado,
      presentacion, incluye, loteNum, fab, venc, vidaUtil, tamanoLote, pais, fechaAnalisis,
      fechaEmision, parametros, empaque, almacenamiento, precauciones, observaciones, codigoVerif,
    ],
  );

  return (
    <DocumentoGeneradorTab
      apiPrefix="/api/coa"
      queryKey="coa"
      tituloSeccion="Certificado de análisis (COA)"
      descripcion="Genera el COA desde la plantilla McKenna y súbelo a la carpeta COA en Drive."
      botonGenerar="Generar COA"
      carpetaDriveLabel="COA"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      productoRef={producto?.ref ?? ""}
    >
      <div className="space-y-4">
        <Field value={titulo} onChange={setTitulo} placeholder="Título del producto" />
        <p className="text-xs font-medium text-muted">Identificación</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Nombre comercial" value={nombreComercial} onChange={setNombreComercial} />
          <Field label="Referencia interna" value={referencia} onChange={setReferencia} />
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} />
          <Field label="EINECS" value={einces} onChange={setEinces} />
          <Field label="Concentración" value={concentracion} onChange={setConcentracion} />
          <Field label="Grado" value={grado} onChange={setGrado} />
          <Field label="Presentación" value={presentacion} onChange={setPresentacion} />
          <Field label="Incluye" value={incluye} onChange={setIncluye} />
        </div>
        <p className="text-xs font-medium text-muted">Lote</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="No. de lote" value={loteNum} onChange={setLoteNum} />
          <Field label="Fecha fabricación" value={fab} onChange={setFab} placeholder="DD / MM / AAAA" />
          <Field label="Fecha vencimiento" value={venc} onChange={setVenc} />
          <Field label="Vida útil" value={vidaUtil} onChange={setVidaUtil} />
          <Field label="Tamaño del lote" value={tamanoLote} onChange={setTamanoLote} />
          <Field label="País de origen" value={pais} onChange={setPais} />
          <Field label="Fecha análisis" value={fechaAnalisis} onChange={setFechaAnalisis} />
          <Field label="Fecha emisión COA" value={fechaEmision} onChange={setFechaEmision} />
        </div>
        <Field
          label="Parámetros (parámetro|especificación|resultado por línea)"
          value={parametros}
          onChange={setParametros}
          rows={8}
          mono
        />
        <p className="text-xs font-medium text-muted">Empaque y almacenamiento</p>
        <Field label="Empaque original" value={empaque} onChange={setEmpaque} rows={2} />
        <Field label="Almacenamiento" value={almacenamiento} onChange={setAlmacenamiento} rows={2} />
        <Field label="Precauciones" value={precauciones} onChange={setPrecauciones} rows={2} />
        <Field label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
        <Field label="Código verificación (MKG-COA-…)" value={codigoVerif} onChange={setCodigoVerif} />
      </div>
    </DocumentoGeneradorTab>
  );
}

function SdsTabContent({
  producto,
}: {
  producto: ProductoDocumentacion | null;
}) {
  const [titulo, setTitulo] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [referencia, setReferencia] = useState("");
  const [inci, setInci] = useState("");
  const [cas, setCas] = useState("");
  const [formula, setFormula] = useState("");
  const [usos, setUsos] = useState("");
  const [telefono, setTelefono] = useState("");
  const [clasificacion, setClasificacion] = useState("");
  const [pictogramas, setPictogramas] = useState("");
  const [composicion, setComposicion] = useState("");
  const [primerosAuxilios, setPrimerosAuxilios] = useState("");
  const [manipulacion, setManipulacion] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [propiedades, setPropiedades] = useState("");
  const [normativa, setNormativa] = useState("");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    if (!producto) return;
    setTitulo(producto.nombre_base.toUpperCase());
    setNombreComercial(producto.nombre);
    setReferencia(producto.ref);
  }, [producto?.ref, producto?.nombre, producto?.nombre_base]);

  const loadDatos = useCallback((datos: Record<string, unknown>) => {
    const ident = (datos.identificacion || {}) as Record<string, string>;
    const pel = (datos.peligros || {}) as Record<string, string>;
    const man = (datos.manipulacion || {}) as Record<string, string>;
    const reg = (datos.regulatorio || {}) as Record<string, string>;
    setTitulo(String(datos.titulo || ""));
    setNombreComercial(String(ident.nombre_comercial || ""));
    setReferencia(String(ident.referencia_interna || ""));
    setInci(String(ident.nombre_inci || ""));
    setCas(String(ident.cas || ""));
    setFormula(String(ident.formula_molecular || ""));
    setUsos(String(ident.usos || ""));
    setTelefono(String(ident.telefono_emergencia || ""));
    setClasificacion(String(pel.clasificacion || ""));
    setPictogramas(String(pel.pictogramas || ""));
    setComposicion(textoDesdeFilasTres(datos.composicion));
    setPrimerosAuxilios(textoDesdeFilas(datos.primeros_auxilios));
    setManipulacion(String(man.manipulacion || ""));
    setAlmacenamiento(String(man.almacenamiento || ""));
    setPropiedades(textoDesdeFilas(datos.propiedades));
    setNormativa(String(reg.normativa || ""));
    setObservaciones(String(reg.observaciones || ""));
  }, []);

  const buildDatos = useCallback(
    () => ({
      titulo,
      identificacion: {
        nombre_comercial: nombreComercial || titulo,
        referencia_interna: referencia,
        nombre_inci: inci,
        cas,
        formula_molecular: formula,
        usos,
        telefono_emergencia: telefono,
      },
      peligros: { clasificacion, pictogramas },
      composicion: filasTresDesdeTexto(composicion),
      primeros_auxilios: filasDesdeTexto(primerosAuxilios),
      manipulacion: { manipulacion, almacenamiento },
      propiedades: filasDesdeTexto(propiedades),
      regulatorio: { normativa, observaciones },
    }),
    [
      titulo, nombreComercial, referencia, inci, cas, formula, usos, telefono,
      clasificacion, pictogramas, composicion, primerosAuxilios, manipulacion,
      almacenamiento, propiedades, normativa, observaciones,
    ],
  );

  return (
    <DocumentoGeneradorTab
      apiPrefix="/api/sds"
      queryKey="sds"
      tituloSeccion="Hoja de datos de seguridad (SDS)"
      descripcion="Formato GHS estilo Ventós (referencia SDS ELEMI). Genera DOCX/PDF y súbelo a Drive. Use «Completar con literatura» para rellenar campos faltantes desde PubMed/PubChem."
      botonGenerar="Generar SDS"
      carpetaDriveLabel="SDS"
      loadDatos={loadDatos}
      buildDatos={buildDatos}
      productoRef={producto?.ref ?? ""}
    >
      <div className="space-y-4">
        <Field value={titulo} onChange={setTitulo} placeholder="Título del producto" />
        <p className="text-xs font-medium text-muted">Identificación</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Nombre comercial" value={nombreComercial} onChange={setNombreComercial} />
          <Field label="Referencia interna" value={referencia} onChange={setReferencia} />
          <Field label="INCI / químico" value={inci} onChange={setInci} />
          <Field label="CAS" value={cas} onChange={setCas} />
          <Field label="Fórmula molecular" value={formula} onChange={setFormula} />
          <Field label="Usos recomendados" value={usos} onChange={setUsos} />
          <Field label="Teléfono emergencia" value={telefono} onChange={setTelefono} />
        </div>
        <p className="text-xs font-medium text-muted">Peligros</p>
        <Field label="Clasificación GHS" value={clasificacion} onChange={setClasificacion} rows={2} />
        <Field label="Pictogramas / frases H-P" value={pictogramas} onChange={setPictogramas} rows={2} />
        <Field label="Composición (componente|CAS|conc.)" value={composicion} onChange={setComposicion} rows={4} mono />
        <Field label="Primeros auxilios (caso|instrucción)" value={primerosAuxilios} onChange={setPrimerosAuxilios} rows={4} mono />
        <Field label="Manipulación" value={manipulacion} onChange={setManipulacion} rows={2} />
        <Field label="Almacenamiento" value={almacenamiento} onChange={setAlmacenamiento} rows={2} />
        <Field label="Propiedades (nombre|valor)" value={propiedades} onChange={setPropiedades} rows={6} mono />
        <Field label="Normativa" value={normativa} onChange={setNormativa} rows={2} />
        <Field label="Observaciones" value={observaciones} onChange={setObservaciones} rows={2} />
      </div>
    </DocumentoGeneradorTab>
  );
}

export default function FichasTecnicasPanel() {
  const [tab, setTab] = useState<TabDoc>("catalogo");
  const [producto, setProducto] = useState<ProductoDocumentacion | null>(null);

  const abrirGenerador = (tipo: "ft" | "coa" | "sds", p: ProductoDocumentacion) => {
    setProducto(p);
    setTab(tipo);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">Documentos técnicos</h2>
        <p className="mt-1 text-sm text-muted">
          Catálogo de combos SIIGO, estado FT/COA/SDS, vista previa antes de generar y subida a Drive.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "catalogo" && <DocumentosCatalogoTab onGenerar={abrirGenerador} />}
      {tab === "ft" && <FichaTecnicaTabContent producto={producto} />}
      {tab === "coa" && <CoaTabContent producto={producto} />}
      {tab === "sds" && <SdsTabContent producto={producto} />}
    </div>
  );
}
