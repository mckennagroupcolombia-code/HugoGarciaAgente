import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { esperarJobScan } from "../../lib/scanJobPoll";
import {
  filasTresDesdeTexto,
  textoDesdeFilasTres,
} from "./DocumentoGeneradorTab";
import { mergeParamStrings, parseParamRows } from "../../lib/coaParametros";
import {
  decidirAsociacionCoa,
  type ArchivoBibliotecaMatch,
} from "../../lib/coaBibliotecaMatch";
import CamaraCapturaModal, { abrirCamaraCaptura } from "./CamaraCapturaModal";
import ImageLightbox from "../ImageLightbox";

type ArchivoBiblioteca = ArchivoBibliotecaMatch;

interface BibliotecaDatosResult {
  tipo: "ft" | "coa" | "sds" | "completo";
  titulo: string;
  datos: Record<string, unknown>;
  yaml: string;
  tiene_datos: boolean;
}

export {
  encontrarDocumentoPorMateriaPrima,
  resolverArchivoBiblioteca,
  decidirAsociacionCoa,
} from "../../lib/coaBibliotecaMatch";

function vacio(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function fillEmpty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  filled: string[],
  label?: string,
) {
  if (vacio(value) || !vacio(target[key])) return;
  target[key] = typeof value === "string" ? value.trim() : value;
  filled.push(label || key);
}

export type CoaScanCampos = Record<string, string>;

type CoaScanApi = {
  ok?: boolean;
  error?: string;
  job_id?: string;
  status?: string;
  progreso?: string;
  parametros?: string;
  campos?: Record<string, unknown>;
  nombre_producto?: string;
  archivo_biblioteca?: string;
  imagenes_procesadas?: number;
  imagenes?: number;
};

/** Complementa casillas vacías del documento con datos extraídos del COA. */
export function mergeCoaEnDatos(
  datos: Record<string, unknown>,
  tipo: BibliotecaDatosResult["tipo"],
  parametrosText: string,
  campos: CoaScanCampos = {},
): { datos: Record<string, unknown>; filled: string[] } {
  const filled: string[] = [];
  const c = { ...campos };
  if (c.einecs && !c.einces) c.einces = c.einecs;

  const aplicarCamposCoa = (coa: Record<string, unknown>) => {
    const ident = { ...((coa.identificacion as Record<string, unknown>) || {}) };
    const lote = { ...((coa.lote as Record<string, unknown>) || {}) };
    const emp = { ...((coa.empaque as Record<string, unknown>) || {}) };
    const firma = { ...((coa.firma as Record<string, unknown>) || {}) };

    if (c.nombre_producto) {
      fillEmpty(coa, "titulo", String(c.nombre_producto).toUpperCase(), filled, "título COA");
      fillEmpty(ident, "nombre_comercial", c.nombre_comercial || c.nombre_producto, filled, "nombre comercial");
    }
    fillEmpty(ident, "nombre_inci", c.inci, filled, "INCI");
    fillEmpty(ident, "cas", c.cas, filled, "CAS");
    fillEmpty(ident, "einces", c.einces || c.einecs, filled, "EINECS");
    fillEmpty(ident, "formula_molecular", c.formula_quimica, filled, "fórmula");
    fillEmpty(ident, "grado", c.grado, filled, "grado");
    fillEmpty(ident, "concentracion", c.concentracion, filled, "concentración");
    fillEmpty(ident, "presentacion", c.presentacion, filled, "presentación");

    fillEmpty(lote, "numero", c.lote, filled, "lote");
    fillEmpty(lote, "fecha_fabricacion", c.fecha_fabricacion, filled, "fecha fabricación");
    fillEmpty(lote, "fecha_vencimiento", c.fecha_vencimiento, filled, "fecha vencimiento");
    fillEmpty(lote, "fecha_analisis", c.fecha_analisis, filled, "fecha análisis");
    fillEmpty(lote, "fecha_emision", c.fecha_emision, filled, "fecha emisión");
    fillEmpty(lote, "vida_util", c.vida_util, filled, "vida útil");
    fillEmpty(lote, "tamano_lote", c.tamano_lote, filled, "tamaño lote");
    fillEmpty(lote, "pais_origen", c.pais_origen, filled, "país origen");
    fillEmpty(lote, "fabricante", c.fabricante, filled, "fabricante");

    fillEmpty(emp, "empaque_original", c.presentacion, filled, "empaque");
    fillEmpty(emp, "almacenamiento", c.almacenamiento, filled, "almacenamiento");

    fillEmpty(firma, "nombre", c.firma_nombre, filled, "nombre del firmante");
    fillEmpty(firma, "cargo", c.firma_cargo, filled, "cargo del firmante");
    fillEmpty(firma, "organizacion", c.firma_organizacion, filled, "organización del firmante");
    if (c.firma_imagen_b64 && String(c.firma_imagen_b64).startsWith("data:image/")) {
      fillEmpty(firma, "imagen_b64", c.firma_imagen_b64, filled, "línea de firma");
    }

    if (parametrosText.trim()) {
      const existing = coa.parametros ? textoDesdeFilasTres(coa.parametros) : "";
      const merged = mergeParamStrings(existing, parametrosText);
      if (merged.trim() && merged !== (existing || "").trim()) {
        coa.parametros = filasTresDesdeTexto(merged);
        if (!existing.trim()) filled.push("parámetros COA");
        else filled.push("parámetros COA (fusionados)");
      }
    }

    coa.identificacion = ident;
    coa.lote = lote;
    coa.empaque = emp;
    coa.firma = firma;
    return coa;
  };

  const complementarFt = (next: Record<string, unknown>) => {
    fillEmpty(next, "nombre_producto", c.nombre_producto, filled, "nombre producto");
    fillEmpty(next, "titulo", c.nombre_producto ? String(c.nombre_producto).toUpperCase() : "", filled, "título");
    fillEmpty(next, "nombre_comercial", c.nombre_comercial, filled, "nombre comercial");
    fillEmpty(next, "inci", c.inci, filled, "INCI");
    fillEmpty(next, "cas", c.cas, filled, "CAS");
    fillEmpty(next, "lote", c.lote, filled, "lote");
    fillEmpty(next, "fecha_fabricacion", c.fecha_fabricacion, filled, "fecha fabricación");
    fillEmpty(next, "fecha_vencimiento", c.fecha_vencimiento, filled, "fecha vencimiento");
    fillEmpty(next, "presentacion", c.presentacion || c.tamano_lote, filled, "presentación");
    fillEmpty(next, "pais_origen", c.pais_origen, filled, "país origen");
    fillEmpty(next, "fabricante", c.fabricante, filled, "fabricante");
    if (c.almacenamiento) {
      fillEmpty(next, "recomendaciones", c.almacenamiento, filled, "almacenamiento");
    }

    const cf = { ...((next.caracteristicas_fisicas as Record<string, unknown>) || {}) };
    fillEmpty(cf, "apariencia", c.apariencia, filled, "apariencia");
    fillEmpty(cf, "olor", c.olor, filled, "olor");
    fillEmpty(cf, "ph", c.ph, filled, "pH");
    fillEmpty(cf, "formula_quimica", c.formula_quimica, filled, "fórmula");
    fillEmpty(cf, "solubilidad", c.solubilidad, filled, "solubilidad");
    if (c.humedad && vacio(cf.humedad)) {
      // humedad no siempre tiene casilla propia; si hay lista de propiedades, se anexa
      fillEmpty(cf, "humedad", c.humedad, filled, "humedad");
    }
    next.caracteristicas_fisicas = cf;

    if (c.humedad && vacio(next.propiedades_lista) && typeof next.propiedades_lista !== "string") {
      // noop — ya en cf
    } else if (c.humedad) {
      const props = String(next.propiedades_lista || "");
      if (!/humedad/i.test(props)) {
        const line = `Humedad|${c.humedad}`;
        next.propiedades_lista = props.trim() ? `${props.trim()}\n${line}` : line;
        if (!filled.includes("humedad")) filled.push("humedad");
      }
    }
    return next;
  };

  if (tipo === "completo" || tipo === "ft") {
    let next = complementarFt({ ...datos });
    next._coa = aplicarCamposCoa({ ...((next._coa as Record<string, unknown>) || {}) });
    return { datos: next, filled: [...new Set(filled)] };
  }

  if (tipo === "coa") {
    const next = aplicarCamposCoa({ ...datos });
    return { datos: next, filled: [...new Set(filled)] };
  }

  // SDS u otro
  let next = complementarFt({ ...datos });
  next._coa = aplicarCamposCoa({
    parametros: [],
    identificacion: {},
    lote: {},
    empaque: {},
  });
  return { datos: next, filled: [...new Set(filled)] };
}

export default function CoaDocumentosScanner({
  archivos,
  onEditar,
}: {
  archivos: ArchivoBiblioteca[];
  onEditar: (r: BibliotecaDatosResult) => void;
}) {
  const scanFileRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgreso, setScanProgreso] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanPreviews, setScanPreviews] = useState<{ url: string; name: string }[]>([]);
  const [scanLightbox, setScanLightbox] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [camaraOpen, setCamaraOpen] = useState(false);
  const [parametros, setParametros] = useState("");
  const [fotosCapturadas, setFotosCapturadas] = useState(0);
  const [pendienteAbrir, setPendienteAbrir] = useState(false);
  const pendingFilesRef = useRef<File[]>([]);
  const [docSeleccionado, setDocSeleccionado] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [aplicarError, setAplicarError] = useState<string | null>(null);
  const [aplicarOk, setAplicarOk] = useState(false);
  const [materiaPrima, setMateriaPrima] = useState("");
  const [asociacionMsg, setAsociacionMsg] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [camposComplementados, setCamposComplementados] = useState<string[]>([]);
  const camposRef = useRef<CoaScanCampos>({});
  const parametrosRef = useRef("");
  const scanningRef = useRef(false);
  const scanGenRef = useRef(0);
  const rescanPendienteRef = useRef(false);

  const opcionesDoc = archivos.filter((a) => a.nombre.toLowerCase().endsWith(".pdf"));

  const aplicarADocumento = useCallback(
    async (nombreArchivo: string, parametrosText: string) => {
      if (!nombreArchivo) {
        setAplicarError("No se encontró un documento con el título de esta materia prima.");
        return;
      }
      const tieneAlgo =
        parametrosText.trim() ||
        Object.keys(camposRef.current).some((k) => k !== "parametros" && camposRef.current[k]);
      if (!tieneAlgo) {
        setAplicarError("Escanea al menos un COA antes de actualizar.");
        return;
      }
      setAplicando(true);
      setAplicarError(null);
      setAplicarOk(false);
      try {
        const r = await api.get<BibliotecaDatosResult>(
          `/api/fichas/biblioteca/datos?archivo=${encodeURIComponent(nombreArchivo)}`,
        );
        const { datos, filled } = mergeCoaEnDatos(
          r.datos,
          r.tipo,
          parametrosText,
          camposRef.current,
        );
        setCamposComplementados(filled);
        onEditar({ ...r, datos });
        setAplicarOk(true);
      } catch (e: unknown) {
        setAplicarError(e instanceof Error ? e.message : String(e));
      } finally {
        setAplicando(false);
      }
    },
    [onEditar],
  );

  const abrirDesdeCamposIa = useCallback(
    (nombreDetectado: string, parametrosText: string) => {
      const c = camposRef.current;
      const base: Record<string, unknown> = {
        titulo: nombreDetectado.toUpperCase(),
        nombre_producto: nombreDetectado,
        nombre_comercial: c.nombre_comercial || nombreDetectado,
        inci: c.inci || "",
        cas: c.cas || "",
        lote: c.lote || "",
        fecha_fabricacion: c.fecha_fabricacion || "",
        fecha_vencimiento: c.fecha_vencimiento || "",
        presentacion: c.presentacion || c.tamano_lote || "",
        pais_origen: c.pais_origen || "",
        fabricante: c.fabricante || "",
        recomendaciones: c.almacenamiento || "",
        caracteristicas_fisicas: {
          apariencia: c.apariencia || "",
          olor: c.olor || "",
          ph: c.ph || "",
          formula_quimica: c.formula_quimica || "",
          solubilidad: c.solubilidad || "",
          humedad: c.humedad || "",
        },
        _coa: {
          titulo: nombreDetectado.toUpperCase(),
          parametros: [],
          identificacion: {},
          lote: {
            numero: c.lote || "",
            fecha_fabricacion: c.fecha_fabricacion || "",
            fecha_vencimiento: c.fecha_vencimiento || "",
            fecha_analisis: c.fecha_analisis || "",
            fecha_emision: c.fecha_emision || "",
            tamano_lote: c.tamano_lote || c.presentacion || "",
            pais_origen: c.pais_origen || "",
            fabricante: c.fabricante || "",
          },
          empaque: {
            empaque_original: c.presentacion || "",
            almacenamiento: c.almacenamiento || "",
          },
        },
      };
      const { datos, filled } = mergeCoaEnDatos(
        base,
        "completo",
        parametrosText,
        camposRef.current,
      );
      setCamposComplementados(filled);
      onEditar({
        tipo: "completo",
        titulo: nombreDetectado,
        datos,
        yaml: "",
        tiene_datos: true,
      });
      setAplicarOk(true);
      setDocSeleccionado("");
      setMatchScore(null);
      setAsociacionMsg(
        `IA detectó «${nombreDetectado}». No había PDF en biblioteca: se abrió un documento nuevo con los datos del COA.`,
      );
    },
    [onEditar],
  );

  const escanearArchivo = useCallback(
    async (files: File[]) => {
      const lote = files.slice(0, 8);
      if (!lote.length) return;
      const gen = ++scanGenRef.current;
      scanningRef.current = true;
      setScanError(null);
      setAplicarOk(false);
      setAsociacionMsg(null);
      setCamposComplementados([]);
      setPendienteAbrir(false);
      setScanning(true);
      setScanProgreso("Subiendo fotos…");
      try {
        const fd = new FormData();
        for (const file of lote) {
          fd.append("imagen", file);
        }
        const catalogo = archivos
          .filter((a) => a.nombre.toLowerCase().endsWith(".pdf"))
          .map((a) => a.nombre);
        if (catalogo.length) {
          fd.append("catalogo", JSON.stringify(catalogo));
        }
        const inicio = await api.upload<CoaScanApi>(
          "/api/fichas/coa/escanear-parametros",
          fd,
          { timeoutMs: 45000 },
        );
        if (gen !== scanGenRef.current) return;
        if (inicio.error && !inicio.job_id) throw new Error(inicio.error);

        let json: CoaScanApi = inicio;
        if (inicio.job_id && !inicio.parametros && !inicio.campos) {
          setScanProgreso(
            inicio.imagenes && inicio.imagenes > 1
              ? `Leyendo ${inicio.imagenes} fotos…`
              : "Leyendo el documento…",
          );
          json = await esperarJobScan<CoaScanApi>(
            (id) => `/api/fichas/coa/escanear-parametros/${encodeURIComponent(id)}`,
            inicio.job_id,
            {
              onProgreso: (msg) => {
                if (gen === scanGenRef.current) setScanProgreso(msg);
              },
              isStale: () => gen !== scanGenRef.current,
            },
          );
        }
        if (gen !== scanGenRef.current) return;
        if (json.error) throw new Error(json.error);

        const nuevosParams = String(json.parametros || "");
        const camposIn: CoaScanCampos =
          json.campos && typeof json.campos === "object"
            ? Object.fromEntries(
                Object.entries(json.campos as Record<string, unknown>)
                  .filter(([, v]) => v != null && String(v).trim())
                  .map(([k, v]) => [k, String(v).trim()]),
              )
            : {};

        const acumulados: CoaScanCampos = { ...camposIn };
        for (const [k, v] of Object.entries(camposRef.current)) {
          if (k === "parametros" || k === "archivo_biblioteca") continue;
          if (!acumulados[k] && v) acumulados[k] = v;
        }
        camposRef.current = acumulados;

        const nombreDetectado = String(
          acumulados.nombre_producto || json.nombre_producto || "",
        ).trim();

        const paramsFinal = mergeParamStrings(parametrosRef.current, nuevosParams);
        parametrosRef.current = paramsFinal;
        setParametros(paramsFinal);
        const nProc = Number(json.imagenes_procesadas);
        setFotosCapturadas(
          Number.isFinite(nProc) && nProc > 0 ? nProc : lote.length,
        );

        const loteTxt = acumulados.lote ? `lote ${acumulados.lote}` : "";
        const vencTxt = acumulados.fecha_vencimiento
          ? `vence ${acumulados.fecha_vencimiento}`
          : "";
        const fabTxt = acumulados.fecha_fabricacion
          ? `fab. ${acumulados.fecha_fabricacion}`
          : "";
        const claveTxt = [loteTxt, fabTxt, vencTxt].filter(Boolean).join(" · ");

        const sugeridoIa = String(json.archivo_biblioteca || "").trim();
        const asociacion = decidirAsociacionCoa(archivos, nombreDetectado, sugeridoIa);
        const archivoHit = asociacion?.archivo ?? null;
        const score: number | null = asociacion?.score ?? null;

        if (archivoHit) {
          setMateriaPrima(nombreDetectado || archivoHit.nombre.replace(/\.pdf$/i, ""));
          setDocSeleccionado(archivoHit.nombre);
          setMatchScore(score);
          setAsociacionMsg(
            `Listo${claveTxt ? ` (${claveTxt})` : ""}. Materia prima → «${archivoHit.nombre.replace(/\.pdf$/i, "")}». Puedes agregar más fotos o pulsar «Abrir documento».`,
          );
        } else if (nombreDetectado) {
          setMateriaPrima(nombreDetectado);
          setDocSeleccionado("");
          setMatchScore(null);
          setAsociacionMsg(
            `Listo${claveTxt ? ` (${claveTxt})` : ""}. Detectó «${nombreDetectado}» (sin PDF en biblioteca). Agrega más fotos si hace falta y pulsa «Abrir documento».`,
          );
        } else {
          setAsociacionMsg(
            `Se leyeron datos${claveTxt ? ` (${claveTxt})` : ""}, pero no el nombre del producto. Sube otra foto del encabezado o elige el documento abajo.`,
          );
        }
        setPendienteAbrir(true);
      } catch (e: unknown) {
        if (gen !== scanGenRef.current) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setScanError(e instanceof Error ? e.message : String(e));
      } finally {
        if (gen !== scanGenRef.current) return;
        scanningRef.current = false;
        setScanning(false);
        setScanProgreso(null);
        if (rescanPendienteRef.current) {
          rescanPendienteRef.current = false;
          void escanearArchivo(pendingFilesRef.current);
        }
      }
    },
    [archivos],
  );

  const abrirConDatosExtraidos = useCallback(() => {
    const params = parametrosRef.current;
    const nombre = (camposRef.current.nombre_producto || materiaPrima || "").trim();
    if (docSeleccionado) {
      void aplicarADocumento(docSeleccionado, params);
      return;
    }
    if (nombre) {
      abrirDesdeCamposIa(nombre, params);
      return;
    }
    setAplicarError("Indica el documento de la lista o adjunta una foto donde se lea el nombre del producto.");
  }, [aplicarADocumento, abrirDesdeCamposIa, docSeleccionado, materiaPrima]);

  const procesarArchivos = useCallback(
    (incoming: FileList | File[]) => {
      const nuevos = Array.from(incoming).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf",
      );
      if (!nuevos.length) return;

      const prev = pendingFilesRef.current;
      const mergedFiles: File[] = [...prev];
      for (const f of nuevos) {
        if (mergedFiles.length >= 8) break;
        const dup = mergedFiles.some(
          (p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified,
        );
        if (!dup) mergedFiles.push(f);
      }
      pendingFilesRef.current = mergedFiles;

      setScanPreviews((old) => {
        for (const p of old) URL.revokeObjectURL(p.url);
        return mergedFiles
          .filter((f) => f.type.startsWith("image/"))
          .map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
      });

      if (scanningRef.current) {
        rescanPendienteRef.current = true;
        return;
      }
      void escanearArchivo(mergedFiles);
    },
    [escanearArchivo],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) procesarArchivos(e.target.files);
    e.target.value = "";
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imgs.push(file);
        }
      }
      if (imgs.length) {
        procesarArchivos(imgs);
        e.preventDefault();
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [procesarArchivos]);

  const limpiar = () => {
    for (const p of scanPreviews) URL.revokeObjectURL(p.url);
    setScanPreviews([]);
    setScanLightbox(null);
    pendingFilesRef.current = [];
    scanGenRef.current += 1;
    rescanPendienteRef.current = false;
    scanningRef.current = false;
    setScanning(false);
    setScanProgreso(null);
    setParametros("");
    parametrosRef.current = "";
    camposRef.current = {};
    setFotosCapturadas(0);
    setPendienteAbrir(false);
    setScanError(null);
    setAplicarError(null);
    setAplicarOk(false);
    setMateriaPrima("");
    setAsociacionMsg(null);
    setMatchScore(null);
    setCamposComplementados([]);
    setDocSeleccionado("");
  };

  const filas = parseParamRows(parametros);

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-4 space-y-3 transition-colors ${
        dragOver ? "border-accent bg-accent/15" : "border-accent/60 bg-accent/5"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) procesarArchivos(e.dataTransfer.files);
      }}
    >
      <CamaraCapturaModal
        open={camaraOpen}
        titulo="Escáner de documentos COA"
        onClose={() => setCamaraOpen(false)}
        onCapture={(file) => procesarArchivos([file])}
        mantenerAbierto
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-accent">
            Escáner de documentos COA
          </h3>
          <p className="mt-1 text-xs text-muted">
            Sube varias fotos del COA (páginas distintas, zoom de tablas…). Cada foto se lee
            por separado y se fusiona. Si agregas más mientras analiza, espera y se reanaliza
            el lote completo. Al terminar, pulsa «Abrir documento».
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => abrirCamaraCaptura({ cameraInputRef, setCamaraOpen })}
            disabled={aplicando}
            className="rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {aplicando ? "Asociando…" : scanning ? "📷 Agregar otra foto…" : "📷 Escáner de documentos COA"}
          </button>
          <button
            type="button"
            onClick={() => scanFileRef.current?.click()}
            disabled={aplicando}
            className="rounded-lg border border-accent/40 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            Adjuntar imágenes / PDF
          </button>
          {(parametros || scanPreviews.length > 0 || fotosCapturadas > 0 || materiaPrima) && (
            <button
              type="button"
              onClick={limpiar}
              className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:border-danger hover:text-danger"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      <input
        ref={scanFileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <p className="text-[10px] text-muted">
        Hasta 8 fotos: puedes adjuntarlas de una en una; cada nueva se suma al lote y se
        reanaliza todo junto. Ctrl+V y arrastrar también acumulan.
      </p>

      {scanPreviews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scanPreviews.map((p) => (
            <button
              key={p.url}
              type="button"
              title={p.name}
              onClick={() => setScanLightbox(p.url)}
              className="rounded border border-border overflow-hidden hover:border-accent"
            >
              <img src={p.url} alt={p.name} className="h-20 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}
      {scanLightbox && (
        <ImageLightbox url={scanLightbox} onClose={() => setScanLightbox(null)} />
      )}

      {materiaPrima && (
        <div className="rounded-lg border border-accent/30 bg-surface-panel px-3 py-2 text-xs">
          <p className="font-semibold text-ink">
            Materia prima detectada: <span className="text-accent">{materiaPrima}</span>
            {matchScore != null && (
              <span className="ml-2 font-normal text-muted">· coincidencia {matchScore}%</span>
            )}
          </p>
          {asociacionMsg && <p className="mt-1 text-muted">{asociacionMsg}</p>}
        </div>
      )}
      {!materiaPrima && asociacionMsg && (
        <p className="text-xs text-amber-700 dark:text-amber-300">{asociacionMsg}</p>
      )}

      {scanPreviews.length > 0 && (
        <p className="text-xs font-medium text-emerald-600">
          {scanPreviews.length} foto{scanPreviews.length !== 1 ? "s" : ""} adjuntada
          {scanPreviews.length !== 1 ? "s" : ""}
          {scanning
            ? ` · ${scanProgreso || "leyendo cada una…"}`
            : fotosCapturadas > 0
              ? ` · ${fotosCapturadas} procesada${fotosCapturadas !== 1 ? "s" : ""}`
              : ""}
          {filas.length > 0
            ? ` · ${filas.length} parámetro${filas.length !== 1 ? "s" : ""} acumulado${filas.length !== 1 ? "s" : ""}`
            : ""}
        </p>
      )}
      {scanPreviews.length === 0 && fotosCapturadas > 0 && (
        <p className="text-xs font-medium text-emerald-600">
          {fotosCapturadas} foto{fotosCapturadas !== 1 ? "s" : ""} procesada
          {fotosCapturadas !== 1 ? "s" : ""}
          · {filas.length} parámetro{filas.length !== 1 ? "s" : ""} acumulado{filas.length !== 1 ? "s" : ""}
        </p>
      )}
      {scanError && <p className="text-xs text-danger">{scanError}</p>}

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-panel">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                <th className="px-2 py-2 font-semibold text-ink">Parámetro</th>
                <th className="px-2 py-2 font-semibold text-ink">Especificación</th>
                <th className="px-2 py-2 font-semibold text-ink">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1.5">{row.parametro}</td>
                  <td className="px-2 py-1.5">{row.especificacion}</td>
                  <td className="px-2 py-1.5">{row.resultado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-muted">
          Documento destino (opcional)
          <select
            value={docSeleccionado}
            onChange={(e) => {
              setDocSeleccionado(e.target.value);
              setAplicarOk(false);
              setAplicarError(null);
              setPendienteAbrir(true);
            }}
            className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          >
            <option value="">— Nuevo / el que detectó la IA —</option>
            {opcionesDoc.map((a) => (
              <option key={a.nombre} value={a.nombre}>
                {a.nombre.replace(/\.pdf$/i, "")}
                {a.categoria === "completo" ? " (Completo)" : a.categoria === "ft" ? " (FT)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => abrirConDatosExtraidos()}
          disabled={
            aplicando ||
            scanning ||
            (!parametros.trim() && !Object.keys(camposRef.current).length) ||
            (!docSeleccionado && !(materiaPrima || camposRef.current.nombre_producto))
          }
          className="rounded-lg bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {aplicando
            ? "Abriendo editor…"
            : pendienteAbrir
              ? "Abrir documento con estos datos"
              : "Abrir documento"}
        </button>
      </div>

      {aplicarOk && (
        <p className="text-xs text-emerald-600">
          Documento abierto con datos del COA de «{materiaPrima || "la materia prima"}».
          {camposComplementados.length > 0 && (
            <> Casillas complementadas: {camposComplementados.join(", ")}.</>
          )}{" "}
          Revisa y genera el PDF actualizado.
        </p>
      )}
      {aplicarError && <p className="text-xs text-danger">{aplicarError}</p>}
    </div>
  );
}
