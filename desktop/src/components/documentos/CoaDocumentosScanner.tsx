import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import {
  filasTresDesdeTexto,
  textoDesdeFilasTres,
} from "./DocumentoGeneradorTab";
import { mergeParamStrings, parseParamRows } from "../../lib/coaParametros";
import CamaraCapturaModal, { abrirCamaraCaptura } from "./CamaraCapturaModal";
import ImageLightbox from "../ImageLightbox";

interface ArchivoBiblioteca {
  nombre: string;
  categoria?: "ft" | "completo";
}

interface BibliotecaDatosResult {
  tipo: "ft" | "coa" | "sds" | "completo";
  titulo: string;
  datos: Record<string, unknown>;
  yaml: string;
  tiene_datos: boolean;
}

function normalizarTitulo(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(pdf|docx)$/i, "")
    .replace(
      /\b(ft|coa|sds|completo|ficha tecnica|certificado de analisis|tds|hoja de datos)\b/gi,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensTitulo(s: string): string[] {
  return normalizarTitulo(s).split(/\s+/).filter((t) => t.length > 1);
}

/** Devuelve el mejor documento de biblioteca para el nombre de materia prima detectado. */
export function encontrarDocumentoPorMateriaPrima(
  archivos: ArchivoBiblioteca[],
  nombreProducto: string,
): { archivo: ArchivoBiblioteca; score: number } | null {
  const query = normalizarTitulo(nombreProducto);
  if (!query) return null;
  const qTokens = tokensTitulo(nombreProducto);
  if (!qTokens.length) return null;

  let best: { archivo: ArchivoBiblioteca; score: number } | null = null;

  for (const a of archivos) {
    if (!a.nombre.toLowerCase().endsWith(".pdf")) continue;
    const tituloArchivo = a.nombre.replace(/\.(pdf|docx)$/i, "");
    const cand = normalizarTitulo(tituloArchivo);
    if (!cand) continue;

    let score = 0;
    if (cand === query) score = 100;
    else if (cand.includes(query) || query.includes(cand)) score = 85;
    else {
      const cTokens = tokensTitulo(tituloArchivo);
      if (!cTokens.length) continue;
      const overlap = qTokens.filter((t) => cTokens.some((c) => c.includes(t) || t.includes(c))).length;
      score = Math.round((overlap / Math.max(qTokens.length, cTokens.length)) * 70);
    }

    // Preferir documentos "completo" cuando hay empate
    if (a.categoria === "completo") score += 2;

    if (!best || score > best.score) best = { archivo: a, score };
  }

  if (!best || best.score < 40) return null;
  return best;
}

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
    return coa;
  };

  const complementarFt = (next: Record<string, unknown>) => {
    fillEmpty(next, "nombre_producto", c.nombre_producto, filled, "nombre producto");
    fillEmpty(next, "titulo", c.nombre_producto ? String(c.nombre_producto).toUpperCase() : "", filled, "título");
    fillEmpty(next, "nombre_comercial", c.nombre_comercial, filled, "nombre comercial");
    fillEmpty(next, "inci", c.inci, filled, "INCI");
    fillEmpty(next, "cas", c.cas, filled, "CAS");
    fillEmpty(next, "lote", c.lote, filled, "lote");
    fillEmpty(next, "pais_origen", c.pais_origen, filled, "país origen");
    fillEmpty(next, "fabricante", c.fabricante, filled, "fabricante");

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
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanLightbox, setScanLightbox] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [camaraOpen, setCamaraOpen] = useState(false);
  const [parametros, setParametros] = useState("");
  const [fotosCapturadas, setFotosCapturadas] = useState(0);
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

  const escanearArchivo = useCallback(
    async (file: File) => {
      setScanError(null);
      setAplicarOk(false);
      setAsociacionMsg(null);
      setCamposComplementados([]);
      setScanning(true);
      try {
        const { resolvePanelApiUrl } = await import("../../api/client");
        const { useTicketsAuth } = await import("../../stores/ticketsAuth");
        const { useAuthStore } = await import("../../stores/auth");
        const t = useTicketsAuth.getState();
        const token = t.apiToken || t.token || useAuthStore.getState().token || "";
        const url = await resolvePanelApiUrl("/api/fichas/coa/escanear-parametros", "POST");
        const fd = new FormData();
        fd.append("imagen", file);
        const res = await fetch(url, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status}`);

        const nuevosParams = String(json.parametros || "");
        const camposIn: CoaScanCampos =
          json.campos && typeof json.campos === "object"
            ? Object.fromEntries(
                Object.entries(json.campos as Record<string, unknown>)
                  .filter(([, v]) => v != null && String(v).trim())
                  .map(([k, v]) => [k, String(v).trim()]),
              )
            : {};

        // Acumular campos: no sobrescribir con vacío; valor nuevo gana si llega
        const acumulados: CoaScanCampos = { ...camposRef.current };
        for (const [k, v] of Object.entries(camposIn)) {
          if (k === "parametros") continue;
          if (v) acumulados[k] = v;
        }
        camposRef.current = acumulados;

        const nombreDetectado = String(
          acumulados.nombre_producto || json.nombre_producto || "",
        ).trim();

        const merged = mergeParamStrings(parametrosRef.current, nuevosParams);
        parametrosRef.current = merged;
        setParametros(merged);
        setFotosCapturadas((n) => n + 1);

        const extras = Object.keys(acumulados).filter((k) => k !== "parametros" && k !== "nombre_producto");
        const extrasTxt = extras.length
          ? ` · ${extras.length} dato${extras.length !== 1 ? "s" : ""} para complementar casillas`
          : "";

        if (nombreDetectado) {
          setMateriaPrima(nombreDetectado);
          const hit = encontrarDocumentoPorMateriaPrima(archivos, nombreDetectado);
          if (hit) {
            setDocSeleccionado(hit.archivo.nombre);
            setMatchScore(hit.score);
            setAsociacionMsg(
              `IA detectó «${nombreDetectado}» → asociado a «${hit.archivo.nombre.replace(/\.pdf$/i, "")}»${extrasTxt}`,
            );
            await aplicarADocumento(hit.archivo.nombre, merged);
          } else {
            setMatchScore(null);
            setAsociacionMsg(
              `IA detectó «${nombreDetectado}»${extrasTxt}, pero no hay documento en la biblioteca con ese título. Elige uno manualmente.`,
            );
          }
        } else {
          setAsociacionMsg(
            `No se pudo leer el nombre de la materia prima.${extrasTxt || " Elige el documento manualmente."}`,
          );
        }
      } catch (e: unknown) {
        setScanError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [archivos, aplicarADocumento],
  );

  const procesarArchivo = useCallback(
    (file: File) => {
      if (file.type.startsWith("image/")) {
        if (scanPreview) URL.revokeObjectURL(scanPreview);
        setScanPreview(URL.createObjectURL(file));
      }
      void escanearArchivo(file);
    },
    [escanearArchivo, scanPreview],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    procesarArchivo(file);
    e.target.value = "";
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            procesarArchivo(file);
            e.preventDefault();
          }
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [procesarArchivo]);

  const limpiar = () => {
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanPreview(null);
    setParametros("");
    parametrosRef.current = "";
    camposRef.current = {};
    setFotosCapturadas(0);
    setScanError(null);
    setAplicarError(null);
    setAplicarOk(false);
    setMateriaPrima("");
    setAsociacionMsg(null);
    setMatchScore(null);
    setCamposComplementados([]);
  };

  const filas = parseParamRows(parametros);
  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

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
        const file = e.dataTransfer.files[0];
        if (file && esValido(file)) procesarArchivo(file);
      }}
    >
      <CamaraCapturaModal
        open={camaraOpen}
        titulo="Escáner de documentos COA"
        onClose={() => setCamaraOpen(false)}
        onCapture={procesarArchivo}
        mantenerAbierto
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-accent">
            Escáner de documentos COA
          </h3>
          <p className="mt-1 text-xs text-muted">
            Al subir la foto, la IA identifica la materia prima, completa casillas vacías del formulario
            (CAS, lote, fabricante, grado, apariencia, etc.) y asocia el documento de la biblioteca.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => abrirCamaraCaptura({ cameraInputRef, setCamaraOpen })}
            disabled={scanning || aplicando}
            className="rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {scanning ? "Analizando COA…" : aplicando ? "Asociando…" : "📷 Escáner de documentos COA"}
          </button>
          <button
            type="button"
            onClick={() => scanFileRef.current?.click()}
            disabled={scanning || aplicando}
            className="rounded-lg border border-accent/40 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            Adjuntar imagen / PDF
          </button>
          {(parametros || scanPreview || fotosCapturadas > 0 || materiaPrima) && (
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
        También puedes pegar con Ctrl+V o arrastrar. Varios COA de la misma materia prima se fusionan en una sola tabla.
      </p>

      {scanPreview && (
        <img
          src={scanPreview}
          alt="Última captura"
          title="Clic para ampliar"
          onClick={() => setScanLightbox(true)}
          className="max-h-32 rounded border border-border object-contain cursor-zoom-in"
        />
      )}
      {scanLightbox && scanPreview && (
        <ImageLightbox url={scanPreview} onClose={() => setScanLightbox(false)} />
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

      {fotosCapturadas > 0 && (
        <p className="text-xs font-medium text-emerald-600">
          {fotosCapturadas} foto{fotosCapturadas !== 1 ? "s" : ""} procesada{fotosCapturadas !== 1 ? "s" : ""}
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
          Documento a actualizar
          <select
            value={docSeleccionado}
            onChange={(e) => {
              setDocSeleccionado(e.target.value);
              setAplicarOk(false);
              setAplicarError(null);
            }}
            className="rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
          >
            <option value="">— Elegir documento —</option>
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
          onClick={() => void aplicarADocumento(docSeleccionado, parametros)}
          disabled={aplicando || scanning || !parametros.trim() || !docSeleccionado}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {aplicando ? "Abriendo editor…" : "Actualizar documento"}
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
