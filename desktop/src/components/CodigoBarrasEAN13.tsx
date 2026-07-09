import { useEffect, useMemo, useRef, useState } from "react";
import { calcCheck, generarEAN13, svgToDataUrl, type EAN13Result } from "../lib/ean13";
import { useCodigosEan, type CodigoEan } from "../lib/etiquetasCodigosEan";

// ── Component ───────────────────────────────────────────────────────────────
interface Props {
  onCerrar: () => void;
  onInsertar?: (svgDataUrl: string) => void;
}

function coincide(c: CodigoEan, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return (
    c.sku.toLowerCase().includes(t) ||
    (c.nombre_producto || "").toLowerCase().includes(t) ||
    String(c.numero_producto).includes(t) ||
    c.codigo.includes(t)
  );
}

export function CodigoBarrasEAN13({ onCerrar, onInsertar }: Props) {
  const [modo, setModo] = useState<"registrados" | "manual">("registrados");

  // ── Modo "registrados": buscar en la tabla ya persistida ──────────────────
  const { data: codigos, isLoading } = useCodigosEan();
  const [busqueda, setBusqueda] = useState("");
  const [seleccionado, setSeleccionado] = useState<CodigoEan | null>(null);
  const buscarRef = useRef<HTMLInputElement>(null);

  const coincidencias = useMemo(
    () => (codigos ?? []).filter((c) => coincide(c, busqueda)),
    [codigos, busqueda],
  );

  // ── Modo "manual": escribir dígitos directamente ───────────────────────────
  const [valor, setValor] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modo === "registrados") buscarRef.current?.focus();
    else inputRef.current?.focus();
  }, [modo]);

  const raw = valor.replace(/\D/g, "").slice(0, 13);
  const resultadoManual = raw.length >= 12 ? generarEAN13(raw) : null;
  const checkPreview = raw.length === 12 ? calcCheck(raw) : null;
  const errorCheck =
    raw.length === 13
      ? calcCheck(raw.slice(0, 12)) !== parseInt(raw[12])
        ? `Dígito verificador incorrecto (correcto: ${calcCheck(raw.slice(0, 12))})`
        : null
      : null;

  const resultado: EAN13Result | null =
    modo === "registrados" ? (seleccionado ? generarEAN13(seleccionado.codigo) : null) : resultadoManual;
  const esValido = resultado !== null;

  function onDragStart(e: React.DragEvent) {
    if (!resultado) return;
    e.dataTransfer.setData("application/ghs-icon", resultado.svg);
    e.dataTransfer.effectAllowed = "copy";
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:50px;height:20px;background:#e5e7eb;border-radius:4px;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 25, 10);
    setTimeout(() => ghost.remove(), 0);
  }

  const tabCls = (m: "registrados" | "manual") =>
    `flex-1 rounded-lg py-1 text-[10px] font-bold transition ${
      modo === m ? "bg-accent text-white" : "text-ink-secondary hover:bg-surface-hover"
    }`;

  return (
    <div
      className="fixed right-4 top-20 z-40 flex max-h-[80vh] w-80 flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-paper-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-bold text-ink">Código de barras EAN-13</span>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-hover"
        >
          ✕
        </button>
      </div>

      <div className="flex-shrink-0 border-b border-border p-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
          <button type="button" className={tabCls("registrados")} onClick={() => setModo("registrados")}>
            Registrados
          </button>
          <button type="button" className={tabCls("manual")} onClick={() => setModo("manual")}>
            Escribir manual
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {modo === "registrados" ? (
          <>
            <input
              ref={buscarRef}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por SKU, producto o número…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {isLoading ? (
                <p className="py-4 text-center text-[10px] text-muted">Cargando…</p>
              ) : coincidencias.length === 0 ? (
                <p className="py-4 text-center text-[10px] text-muted">
                  {codigos && codigos.length === 0
                    ? "Aún no hay códigos registrados (pestaña «Códigos EAN»)."
                    : "Sin coincidencias."}
                </p>
              ) : (
                coincidencias.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSeleccionado((prev) => (prev?.id === c.id ? null : c))}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition ${
                      seleccionado?.id === c.id
                        ? "border-accent bg-accent/10"
                        : "border-border hover:bg-surface-hover"
                    }`}
                  >
                    <p className="truncate text-xs font-semibold text-ink">
                      {c.sku} <span className="font-normal text-muted">· {String(c.numero_producto).padStart(3, "0")}</span>
                    </p>
                    {c.nombre_producto && (
                      <p className="truncate text-[10px] text-muted">{c.nombre_producto}</p>
                    )}
                    <p className="mt-0.5 font-mono text-[9px] tracking-wide text-muted">{c.codigo}</p>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Código EAN-13
            </label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={14}
              placeholder="7 700000 000000"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/[^\d\s]/g, ""))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm tracking-widest text-ink focus:border-accent focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-muted">{raw.length}/13 dígitos</span>
              {checkPreview !== null && (
                <span className="text-[10px] font-semibold text-accent">
                  Dígito verificador: {checkPreview}
                </span>
              )}
              {errorCheck && (
                <span className="text-[10px] text-danger">{errorCheck}</span>
              )}
            </div>
          </div>
        )}

        {/* Preview barcode */}
        <div className="flex min-h-[56px] items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-2 dark:bg-zinc-50">
          {esValido && resultado ? (
            <div
              draggable
              onDragStart={onDragStart}
              title="Arrastra al lienzo"
              className="w-full cursor-grab active:cursor-grabbing [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: resultado.svg }}
            />
          ) : (
            <span className="text-[10px] text-muted">
              {modo === "registrados"
                ? "Elige un código de la lista"
                : raw.length === 0
                ? "Ingresa 12 o 13 dígitos"
                : raw.length < 12
                ? `Faltan ${12 - raw.length} dígitos`
                : "Procesando…"}
            </span>
          )}
        </div>

        {esValido && resultado && (
          <p className="text-center font-mono text-[10px] tracking-widest text-muted">
            {resultado.digits}
          </p>
        )}

        {/* Acciones */}
        <div className="flex gap-2">
          {onInsertar && (
            <button
              type="button"
              disabled={!esValido}
              onClick={() => {
                if (!resultado) return;
                onInsertar(svgToDataUrl(resultado.svg));
              }}
              className="flex-1 rounded-lg bg-accent py-1.5 text-xs font-bold text-white disabled:opacity-40 hover:opacity-90"
            >
              ↳ Insertar en lienzo
            </button>
          )}
          <button
            type="button"
            disabled={!esValido}
            onClick={() => {
              if (!resultado) return;
              const a = document.createElement("a");
              a.href = svgToDataUrl(resultado.svg);
              a.download = `EAN13_${resultado.digits}.svg`;
              a.click();
            }}
            className="flex-1 rounded-lg border border-border py-1.5 text-xs text-ink-secondary disabled:opacity-40 hover:bg-surface-hover"
          >
            Descargar SVG
          </button>
        </div>

        <p className="text-[9px] text-muted">
          {modo === "registrados"
            ? "Haz clic en un código para previsualizarlo, o arrástralo directo al lienzo."
            : "Con 12 dígitos el verificador se calcula automáticamente. Arrastra la previsualización al lienzo."}
        </p>
      </div>
    </div>
  );
}
