import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { clipboardPastedImageFile, imagenDesdePortapapeles } from "../../lib/clipboardImage";

type DatosFirmante = { nombre: string; cargo: string; organizacion: string };

type Props = {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
  className?: string;
  /** Rellena nombre/cargo/organización al elegir una firma ya archivada. */
  onDatosFirmante?: (datos: DatosFirmante) => void;
  firmante?: Partial<DatosFirmante>;
};

type RespuestaTrazo = { ok: boolean; imagen_b64: string };
type FirmaGuardada = DatosFirmante & { id: string; imagen_b64: string; usada_en?: string };
type RespuestaFirmas = { ok: boolean; firmas: FirmaGuardada[] };
type RespuestaGuardar = { ok: boolean; firma: FirmaGuardada };

/**
 * Casilla para adjuntar la firma manuscrita: Ctrl+V, arrastrar o archivo.
 * El trazo se extrae en el backend (mismo algoritmo que el escáner de COA)
 * y se guarda como PNG con fondo transparente. Las firmas archivadas quedan
 * disponibles para reutilizarlas en cualquier otro formulario de documentos.
 */
export default function FirmaPegable({
  value,
  onChange,
  label = "Firma / rúbrica",
  className = "",
  onDatosFirmante,
  firmante,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [firmasGuardadas, setFirmasGuardadas] = useState<FirmaGuardada[]>([]);
  const [cargandoFirmas, setCargandoFirmas] = useState(true);
  const [errorFirmas, setErrorFirmas] = useState<string | null>(null);
  const datosFirmante = useRef(firmante);
  const ultimaFirmaArchivada = useRef("");
  datosFirmante.current = firmante;

  const cargarFirmas = useCallback(async () => {
    setCargandoFirmas(true);
    setErrorFirmas(null);
    try {
      const r = await api.get<RespuestaFirmas>("/api/fichas/firmas");
      setFirmasGuardadas(r.firmas ?? []);
    } catch (e) {
      setFirmasGuardadas([]);
      setErrorFirmas(
        e instanceof Error
          ? e.message
          : "No se pudo cargar la biblioteca de firmas. Reinicie el agente o recargue el panel.",
      );
    } finally {
      setCargandoFirmas(false);
    }
  }, []);

  useEffect(() => {
    void cargarFirmas();
  }, [cargarFirmas]);

  const archivarFirma = useCallback(async (imagen: string) => {
    if (!imagen.startsWith("data:image/") || ultimaFirmaArchivada.current === imagen) return;
    ultimaFirmaArchivada.current = imagen;
    try {
      const r = await api.post<RespuestaGuardar>("/api/fichas/firmas/guardar", {
        imagen_b64: imagen,
        nombre: datosFirmante.current?.nombre ?? "",
        cargo: datosFirmante.current?.cargo ?? "",
        organizacion: datosFirmante.current?.organizacion ?? "",
      });
      setFirmasGuardadas((previas) => [r.firma, ...previas.filter((f) => f.id !== r.firma.id)]);
    } catch {
      ultimaFirmaArchivada.current = "";
      // Archivar es un extra: la firma adjunta al documento no se pierde.
    }
  }, []);

  // También archiva firmas cargadas por un borrador o detectadas por el escáner.
  // Esas firmas no pasan por procesarArchivo(), por lo que antes se perdían al
  // cambiar de formulario aunque sí se vieran en el formulario actual.
  useEffect(() => {
    if (value.startsWith("data:image/")) void archivarFirma(value);
  }, [value, archivarFirma]);

  const aplicarFirma = useCallback(
    (imagen: string) => {
      onChange(imagen);
      if (imagen.startsWith("data:image/")) void archivarFirma(imagen);
    },
    [onChange, archivarFirma],
  );

  const procesarArchivo = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Solo se admiten imágenes (PNG, JPG, WebP…)");
        return;
      }
      setBusy(true);
      setError(null);
      setAviso(null);
      try {
        const fd = new FormData();
        fd.append("imagen", file);
        const r = await api.upload<RespuestaTrazo>("/api/fichas/firma/extraer-trazo", fd, {
          timeoutMs: 60000,
        });
        aplicarFirma(r.imagen_b64);
      } catch (e) {
        // Sin contraste suficiente: conservar la imagen tal cual antes que perderla
        const original = await leerComoDataUrl(file).catch(() => "");
        if (original) {
          aplicarFirma(original);
          setAviso(
            `No se pudo aislar el trazo (${e instanceof Error ? e.message : String(e)}). Se guardó la imagen sin recortar.`,
          );
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(false);
      }
    },
    [aplicarFirma],
  );

  const limpiarFondo = useCallback(async () => {
    if (!value.startsWith("data:image/")) return;
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const r = await api.post<RespuestaTrazo>(
        "/api/fichas/firma/extraer-trazo",
        { imagen_b64: value },
        { timeoutMs: 60000 },
      );
      aplicarFirma(r.imagen_b64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [value, aplicarFirma]);

  const onPaste = (e: React.ClipboardEvent) => {
    const file = clipboardPastedImageFile(e);
    if (file) void procesarArchivo(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = imagenDesdePortapapeles(e.dataTransfer) || e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) void procesarArchivo(file);
  };

  const tieneFirma = value.startsWith("data:image/");

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {tieneFirma && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void limpiarFondo()}
              title="Vuelve a extraer el trazo y quita el fondo"
              className="text-[10px] font-medium text-accent hover:underline disabled:opacity-40"
            >
              {busy ? "Procesando…" : "Quitar fondo"}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setError(null);
                setAviso(null);
              }}
              className="text-[10px] font-medium text-muted hover:text-danger"
            >
              Quitar firma
            </button>
          </div>
        )}
      </div>

      <div
        ref={zonaRef}
        tabIndex={0}
        role="button"
        aria-label="Pegar o adjuntar imagen de firma"
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => zonaRef.current?.focus()}
        className={`rounded-lg border-2 border-dashed p-3 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/40 ${
          dragOver
            ? "border-accent bg-accent/15"
            : tieneFirma
              ? "border-border bg-white"
              : "border-accent/50 bg-accent/5"
        }`}
      >
        {tieneFirma ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* Damero: deja ver si el fondo quedó realmente transparente */}
            <div
              className="inline-flex max-h-24 items-center justify-center rounded border border-border p-2"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)",
                backgroundSize: "12px 12px",
                backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
                backgroundColor: "#fff",
              }}
            >
              <img src={value} alt="Firma" className="max-h-20 max-w-full object-contain" />
            </div>
            <div className="space-y-1 text-[10px] text-muted">
              <p>Ctrl+V o arrastra otra imagen para reemplazar.</p>
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
                className="rounded border border-border px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {busy ? "Procesando…" : "Elegir archivo…"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-accent">Pegar firma con Ctrl+V</p>
              <p className="text-[10px] text-muted">
                Haz clic aquí, pega una captura o arrastra una imagen. Se extrae solo el trazo, sin fondo.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
              className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {busy ? "Procesando…" : "Adjuntar imagen"}
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void procesarArchivo(f);
        }}
      />

      <div className="space-y-1.5 rounded-lg border border-border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-accent">
            Seleccionar una firma guardada
          </p>
          <button
            type="button"
            onClick={() => void cargarFirmas()}
            disabled={cargandoFirmas}
            className="text-[10px] font-medium text-muted hover:text-accent disabled:opacity-40"
          >
            {cargandoFirmas ? "Cargando…" : "Actualizar"}
          </button>
        </div>
        {errorFirmas && (
          <p className="text-[10px] text-danger">
            No se pudo leer la biblioteca: {errorFirmas}
          </p>
        )}
        {firmasGuardadas.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {firmasGuardadas.map((firma) => (
              <div key={firma.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    onChange(firma.imagen_b64);
                    if (onDatosFirmante && (firma.nombre || firma.cargo || firma.organizacion)) {
                      onDatosFirmante({
                        nombre: firma.nombre,
                        cargo: firma.cargo,
                        organizacion: firma.organizacion,
                      });
                    }
                    setError(null);
                    setAviso(null);
                  }}
                  title={firma.nombre ? `Usar la firma de ${firma.nombre}` : "Usar esta firma"}
                  className={`flex h-14 w-32 items-center justify-center rounded border bg-white p-1.5 transition-colors hover:border-accent hover:bg-accent/5 ${
                    firma.imagen_b64 === value ? "border-accent ring-1 ring-accent/40" : "border-border"
                  }`}
                >
                  <img
                    src={firma.imagen_b64}
                    alt={firma.nombre || "Firma guardada"}
                    className="max-h-full max-w-full object-contain"
                  />
                </button>
                <button
                  type="button"
                  title="Quitar de la biblioteca"
                  onClick={() => {
                    void api
                      .delete(`/api/fichas/firmas/${firma.id}/eliminar`)
                      .then(() => setFirmasGuardadas((previas) => previas.filter((f) => f.id !== firma.id)))
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
                  }}
                  className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] text-muted hover:border-danger hover:text-danger group-hover:flex"
                >
                  ✕
                </button>
                {firma.nombre && (
                  <p className="mt-0.5 max-w-32 truncate text-[9px] text-muted" title={firma.nombre}>
                    {firma.nombre}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted">
            {cargandoFirmas
              ? "Cargando firmas guardadas…"
              : "Aún no hay firmas archivadas. Adjunta una firma o escanea un COA firmado y aparecerá aquí."}
          </p>
        )}
      </div>

      {aviso && <p className="text-xs text-amber-600">{aviso}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}
