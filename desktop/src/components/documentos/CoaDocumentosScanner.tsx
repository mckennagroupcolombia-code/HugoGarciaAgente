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

function mergeCoaEnDatos(
  datos: Record<string, unknown>,
  tipo: BibliotecaDatosResult["tipo"],
  parametrosText: string,
): Record<string, unknown> {
  if (!parametrosText.trim()) return datos;

  if (tipo === "completo" || tipo === "ft") {
    const next = { ...datos };
    const coa = { ...((next._coa as Record<string, unknown>) || {}) };
    const existing = coa.parametros ? textoDesdeFilasTres(coa.parametros) : "";
    coa.parametros = filasTresDesdeTexto(mergeParamStrings(existing, parametrosText));
    next._coa = coa;
    return next;
  }

  if (tipo === "coa") {
    const next = { ...datos };
    const existing = next.parametros ? textoDesdeFilasTres(next.parametros) : "";
    next.parametros = filasTresDesdeTexto(mergeParamStrings(existing, parametrosText));
    return next;
  }

  // SDS u otro: adjuntar bloque COA al abrir en editor completo
  return {
    ...datos,
    titulo: datos.titulo || "",
    _coa: {
      parametros: filasTresDesdeTexto(parametrosText),
      identificacion: {},
    },
  };
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

  const opcionesDoc = archivos.filter((a) => a.nombre.toLowerCase().endsWith(".pdf"));

  useEffect(() => {
    if (!docSeleccionado && opcionesDoc.length === 1) {
      setDocSeleccionado(opcionesDoc[0].nombre);
    }
  }, [docSeleccionado, opcionesDoc]);

  const escanearArchivo = useCallback(async (file: File) => {
    setScanError(null);
    setAplicarOk(false);
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
      setParametros((prev) => mergeParamStrings(prev, json.parametros || ""));
      setFotosCapturadas((n) => n + 1);
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

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
    setFotosCapturadas(0);
    setScanError(null);
    setAplicarError(null);
    setAplicarOk(false);
  };

  const aplicarADocumento = async () => {
    if (!docSeleccionado) {
      setAplicarError("Elige un documento de la biblioteca.");
      return;
    }
    if (!parametros.trim()) {
      setAplicarError("Escanea al menos un COA antes de actualizar.");
      return;
    }
    setAplicando(true);
    setAplicarError(null);
    setAplicarOk(false);
    try {
      const r = await api.get<BibliotecaDatosResult>(
        `/api/fichas/biblioteca/datos?archivo=${encodeURIComponent(docSeleccionado)}`,
      );
      const datos = mergeCoaEnDatos(r.datos, r.tipo, parametros);
      onEditar({ ...r, datos });
      setAplicarOk(true);
    } catch (e: unknown) {
      setAplicarError(e instanceof Error ? e.message : String(e));
    } finally {
      setAplicando(false);
    }
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
            Fotografía cada COA que llegue, acumula parámetros y actualiza el documento elegido en la biblioteca.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => abrirCamaraCaptura({ cameraInputRef, setCamaraOpen })}
            disabled={scanning}
            className="rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {scanning ? "Extrayendo…" : "📷 Escáner de documentos COA"}
          </button>
          <button
            type="button"
            onClick={() => scanFileRef.current?.click()}
            disabled={scanning}
            className="rounded-lg border border-accent/40 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            Adjuntar imagen / PDF
          </button>
          {(parametros || scanPreview || fotosCapturadas > 0) && (
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
        También puedes pegar con Ctrl+V o arrastrar archivos. Varios COA del mismo producto se fusionan en una sola tabla.
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
          onClick={() => void aplicarADocumento()}
          disabled={aplicando || scanning || !parametros.trim() || !docSeleccionado}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {aplicando ? "Abriendo editor…" : "Actualizar documento"}
        </button>
      </div>

      {aplicarOk && (
        <p className="text-xs text-emerald-600">
          Documento abierto en el editor con los parámetros COA aplicados. Revisa y genera el PDF actualizado.
        </p>
      )}
      {aplicarError && <p className="text-xs text-danger">{aplicarError}</p>}
    </div>
  );
}
