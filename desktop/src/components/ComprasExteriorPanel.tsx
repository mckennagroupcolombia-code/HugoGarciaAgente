import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { api, resolvePanelApiUrl } from "../api/client";
import { useTicketsAuth } from "../stores/ticketsAuth";
import { useAuthStore } from "../stores/auth";

type LineaEditable = {
  id: string;
  seleccionada: boolean;
  nombre: string;
  nombre_ocr: string;
  sku: string;
  cantidad: number;
  unidades_por_pack: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  categoria: string;
  costo_unitario_cop: number | null;
};

type LineaApi = {
  id?: string;
  nombre: string;
  cantidad: number;
  unidades_por_pack?: number;
  unidades_totales?: number;
  unidad: string;
  precio_unit: number;
  subtotal: number;
  costo_unitario_cop?: number | null;
};

type ExtractResp = {
  moneda: string;
  proveedor?: string;
  referencia?: string;
  flete_detectado?: number | null;
  moneda_flete_detectada?: string | null;
  lineas: LineaApi[];
  lineas_landed?: LineaApi[];
  error?: string;
};

function n(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  let s = String(v ?? "").trim().replace(/[^\d.,\-]/g, "");
  if (!s) return fallback;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const parts = s.split(",");
    s = parts.length === 2 && parts[1].length === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : fallback;
}

function inferirPcs(nombre: string, unidad: string, explicit?: number): number {
  if (explicit != null && explicit > 0) return explicit;
  const blob = `${nombre} ${unidad}`;
  const m =
    blob.match(/(\d+)\s*(?:pcs|pc|pieces?|piezas?|uds?|unidades?|units?)\b/i) ||
    blob.match(/(?:pack|set|juego|caja|box)\s*(?:de|of)?\s*(\d+)/i);
  if (m?.[1]) {
    const v = parseInt(m[1], 10);
    if (v > 0) return v;
  }
  return 1;
}

/** Costo por unidad mínima: (subtotal_cop + flete) / (sets × pcs_por_set). */
export function calcularLandedCliente(
  lineas: Array<Pick<LineaEditable, "cantidad" | "unidades_por_pack" | "precio_unit" | "subtotal">>,
  opts: { trm: number; flete: number; moneda: string; monedaFlete: string },
): number[] {
  const mon = (opts.moneda || "USD").toUpperCase();
  const monF = (opts.monedaFlete || mon).toUpperCase();
  const rate = mon === "COP" ? 1 : Math.max(opts.trm, 0);
  let fleteCop = 0;
  if (opts.flete > 0) {
    if (monF === "COP") fleteCop = opts.flete;
    else fleteCop = opts.flete * (rate || 0);
  }
  const suma = lineas.reduce((a, l) => a + Math.max(l.subtotal, 0), 0);
  return lineas.map((l) => {
    const sets = Math.max(l.cantidad, 0) || 1;
    const upp = Math.max(l.unidades_por_pack, 1);
    const unidades = sets * upp;
    const peso = suma > 0 ? Math.max(l.subtotal, 0) / suma : 1 / (lineas.length || 1);
    const subtotalCop = l.subtotal * (mon === "COP" ? 1 : rate);
    const fleteAsig = fleteCop > 0 ? fleteCop * peso : 0;
    return Math.round(((subtotalCop + fleteAsig) / unidades) * 1e4) / 1e4;
  });
}

function fmtCop(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  }).format(v);
}

type CatalogoItem = { codigo: string; nombre: string };

type CompraHistorial = {
  id: number;
  created_at: string;
  moneda: string;
  trm: number;
  flete: number;
  moneda_flete: string;
  proveedor: string;
  tiene_soporte: boolean;
  soporte_nombre: string;
  soporte_url: string | null;
  lineas: Array<{
    nombre: string;
    codigo?: string | null;
    costo_unitario?: number;
    cantidad?: number;
    unidades_totales?: number;
    ok?: boolean;
  }>;
  total_guardados: number;
};

function bearerPanel(): string {
  const t = useTicketsAuth.getState();
  return t.apiToken || t.token || useAuthStore.getState().token || "";
}

async function fetchSoporteBlobUrl(compraId: number): Promise<string | null> {
  try {
    const url = resolvePanelApiUrl(`/api/rentabilidad/compras-exterior/${compraId}/soporte`, "GET");
    const res = await fetch(url, {
      headers: bearerPanel() ? { Authorization: `Bearer ${bearerPanel()}` } : {},
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function ProductoSkuAsociar({
  linea,
  onChange,
}: {
  linea: LineaEditable;
  onChange: (patch: Partial<LineaEditable>) => void;
}) {
  const [q, setQ] = useState(linea.sku || linea.nombre);
  const [abierto, setAbierto] = useState(false);
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // Solo sincronizar cuando hay asociación confirmada (evitar pisar lo que escribe el usuario)
    if (linea.sku) {
      setQ(`${linea.sku} — ${linea.nombre}`);
    }
  }, [linea.sku, linea.nombre]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const asociar = (it: CatalogoItem) => {
    onChangeRef.current({ sku: it.codigo, nombre: it.nombre });
    setQ(`${it.codigo} — ${it.nombre}`);
    setAbierto(false);
    setErrorBusqueda(null);
  };

  const terminoBusqueda = (texto: string) => {
    const t = texto.trim();
    if (t.includes("—")) return t.split("—")[0].trim();
    if (t.includes(" - ")) return t.split(" - ")[0].trim();
    return t;
  };

  const ejecutarBusqueda = async (texto: string, autoAsociarExacto: boolean) => {
    const term = terminoBusqueda(texto);
    if (term.length < 1) {
      setItems([]);
      return;
    }
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const res = await api.get<{ items: CatalogoItem[] }>(
        `/api/rentabilidad/componentes-buscar?q=${encodeURIComponent(term)}`,
      );
      const list = res.items || [];
      setItems(list);
      if (autoAsociarExacto && list.length > 0) {
        const exact = list.find((it) => it.codigo.toUpperCase() === term.toUpperCase());
        if (exact) {
          asociar(exact);
          return;
        }
      }
    } catch (e: unknown) {
      setItems([]);
      setErrorBusqueda(e instanceof Error ? e.message : "Error buscando SKU");
    } finally {
      setBuscando(false);
    }
  };

  const buscar = (texto: string) => {
    setQ(texto);
    setAbierto(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const term = terminoBusqueda(texto);
    if (term.length < 1) {
      setItems([]);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      void ejecutarBusqueda(texto, true);
    }, 180);
  };

  const limpiarAsoc = () => {
    onChange({ sku: "", nombre: linea.nombre_ocr || linea.nombre });
    setQ(linea.nombre_ocr || "");
    setItems([]);
  };

  const confirmarConEnter = () => {
    const term = terminoBusqueda(q);
    const exact = items.find((it) => it.codigo.toUpperCase() === term.toUpperCase());
    if (exact) {
      asociar(exact);
      return;
    }
    if (items.length === 1) {
      asociar(items[0]);
      return;
    }
    void ejecutarBusqueda(q, true);
  };

  return (
    <div ref={wrapRef} className="relative min-w-[14rem]">
      <div className="flex gap-1">
        <input
          value={q}
          onChange={(e) => buscar(e.target.value)}
          onFocus={() => {
            setAbierto(true);
            if (terminoBusqueda(q)) void ejecutarBusqueda(q, false);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              void ejecutarBusqueda(q, true);
            }, 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmarConEnter();
            }
            if (e.key === "Escape") setAbierto(false);
          }}
          placeholder="Escribe SKU (ej. TBPST10mL)…"
          className={`w-full rounded border bg-surface-input px-1.5 py-1 ${
            linea.sku ? "border-accent/60" : "border-border"
          }`}
        />
        {linea.sku && (
          <button
            type="button"
            title="Quitar asociación"
            onClick={limpiarAsoc}
            className="shrink-0 rounded border border-border px-1.5 text-muted hover:text-danger"
          >
            ×
          </button>
        )}
      </div>
      {linea.sku ? (
        <p className="mt-0.5 font-mono text-[9px] font-bold text-accent">
          ✓ Asociado {linea.sku}
          {linea.nombre_ocr && linea.nombre_ocr !== linea.nombre
            ? ` · OCR: ${linea.nombre_ocr.slice(0, 36)}`
            : ""}
        </p>
      ) : (
        <p className="mt-0.5 text-[9px] text-amber-700 dark:text-amber-400">
          Escribe el SKU y elige de la lista (o Enter si es exacto)
        </p>
      )}
      {errorBusqueda && (
        <p className="mt-0.5 text-[9px] text-danger">{errorBusqueda}</p>
      )}
      {abierto && (
        <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
          {buscando && (
            <li className="px-2 py-1.5 text-[10px] text-muted">Buscando…</li>
          )}
          {!buscando && items.length === 0 && (
            <li className="px-2 py-1.5 text-[10px] text-muted">
              Sin coincidencias en catálogo Siigo
            </li>
          )}
          {items.map((it) => (
            <li key={it.codigo}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-accent/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => asociar(it)}
              >
                <span className="font-mono text-[10px] font-bold text-accent">{it.codigo}</span>
                <span className="text-[11px] text-ink">{it.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function esImagenPortapapeles(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  if ((!f.type || f.type === "application/octet-stream") && f.size > 0) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name);
}

function normalizarImagenPegada(raw: File): File {
  const mime = raw.type.startsWith("image/") ? raw.type : "image/png";
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const nombre =
    raw.name && !/^image\.(png|jpe?g)$/i.test(raw.name)
      ? raw.name
      : `pantallazo-${Date.now()}.${ext}`;
  if (raw.name === nombre && raw.type === mime) return raw;
  return new File([raw], nombre, { type: mime });
}

/** Extrae imagen del portapapeles (Ctrl+V / captura de pantalla). */
function imagenDesdePortapapeles(cd: DataTransfer | null | undefined): File | null {
  if (!cd) return null;
  for (const item of Array.from(cd.items)) {
    if (item.kind === "file" || item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f && esImagenPortapapeles(f)) return normalizarImagenPegada(f);
    }
  }
  for (const f of Array.from(cd.files)) {
    if (esImagenPortapapeles(f)) return normalizarImagenPegada(f);
  }
  return null;
}

export default function ComprasExteriorPanel() {
  const [scanning, setScanning] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [archivoActual, setArchivoActual] = useState<File | null>(null);
  const [moneda, setMoneda] = useState("USD");
  const [trm, setTrm] = useState("");
  const [flete, setFlete] = useState("");
  const [monedaFlete, setMonedaFlete] = useState("USD");
  const [proveedor, setProveedor] = useState("");
  const [lineas, setLineas] = useState<LineaEditable[]>([]);
  const [zonaActiva, setZonaActiva] = useState(true);
  const [historial, setHistorial] = useState<CompraHistorial[]>([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [soporteThumbs, setSoporteThumbs] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const zonaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fromFileRef = useRef<(file: File) => void>(() => {});

  const cargarHistorial = useCallback(async () => {
    setHistorialLoading(true);
    try {
      const res = await api.get<{ compras: CompraHistorial[] }>(
        "/api/rentabilidad/compras-exterior?limit=30",
      );
      setHistorial(res.compras || []);
    } catch {
      /* silencioso al abrir */
    } finally {
      setHistorialLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargarHistorial();
  }, [cargarHistorial]);

  useEffect(() => {
    let cancelled = false;
    const pending = historial.filter((c) => c.tiene_soporte && !soporteThumbs[c.id]).slice(0, 12);
    if (!pending.length) return;
    void (async () => {
      const next: Record<number, string> = {};
      for (const c of pending) {
        const url = await fetchSoporteBlobUrl(c.id);
        if (url) next[c.id] = url;
      }
      if (!cancelled && Object.keys(next).length) {
        setSoporteThumbs((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historial]);

  useEffect(() => {
    return () => {
      Object.values(soporteThumbs).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trmNum = n(trm);
  const fleteNum = n(flete);
  const necesitaTrm = moneda.toUpperCase() !== "COP";

  const costosRecalc = useMemo(() => {
    if (!lineas.length) return [] as number[];
    if (necesitaTrm && trmNum <= 0) return lineas.map(() => NaN);
    return calcularLandedCliente(lineas, {
      trm: necesitaTrm ? trmNum : 1,
      flete: fleteNum,
      moneda,
      monedaFlete,
    });
  }, [lineas, trmNum, fleteNum, moneda, monedaFlete, necesitaTrm]);

  useEffect(() => {
    if (!lineas.length) return;
    setLineas((prev) =>
      prev.map((l, i) => {
        const c = costosRecalc[i];
        const next = Number.isFinite(c) ? c : null;
        if (l.costo_unitario_cop === next) return l;
        return { ...l, costo_unitario_cop: next };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costosRecalc]);

  const aplicarExtract = useCallback((json: ExtractResp) => {
    const mon = (json.moneda || "USD").toUpperCase();
    setMoneda(mon);
    setMonedaFlete((json.moneda_flete_detectada || mon).toUpperCase());
    setProveedor(json.proveedor || "");
    if (json.flete_detectado != null && json.flete_detectado > 0) {
      setFlete(String(json.flete_detectado));
    }
    const src = json.lineas_landed?.length ? json.lineas_landed : json.lineas;
    setLineas(
      (src || []).map((l, i) => {
        const cantidad = n(l.cantidad, 1);
        const upp = inferirPcs(l.nombre, l.unidad || "", n(l.unidades_por_pack, 0) || undefined);
        return {
          id: l.id || `L${i + 1}`,
          seleccionada: true,
          nombre: l.nombre,
          nombre_ocr: l.nombre,
          sku: "",
          cantidad,
          unidades_por_pack: upp,
          unidad: l.unidad || "un",
          precio_unit: n(l.precio_unit),
          subtotal: n(l.subtotal) || cantidad * n(l.precio_unit),
          categoria: "material",
          costo_unitario_cop:
            l.costo_unitario_cop != null && Number.isFinite(l.costo_unitario_cop)
              ? Number(l.costo_unitario_cop)
              : null,
        };
      }),
    );
  }, []);

  const enviar = useCallback(
    async (file: File) => {
      setError(null);
      setOkMsg(null);
      setScanning(true);
      try {
        const fd = new FormData();
        fd.append("imagen", file);
        if (trm.trim()) fd.append("trm", trm.trim());
        if (flete.trim()) fd.append("flete", flete.trim());
        if (monedaFlete.trim()) fd.append("moneda_flete", monedaFlete.trim());
        const json = await api.upload<ExtractResp>("/api/rentabilidad/extraer-compra-imagen", fd);
        if (json.error) throw new Error(json.error);
        aplicarExtract(json);
        setOkMsg(`Extraídas ${json.lineas?.length ?? 0} líneas. Revisa TRM/flete y confirma.`);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setScanning(false);
      }
    },
    [aplicarExtract, flete, monedaFlete, trm],
  );

  const fromFile = useCallback(
    (file: File) => {
      setOkMsg(null);
      setError(null);
      setArchivoActual(file);
      if (file.type.startsWith("image/") || esImagenPortapapeles(file)) {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(URL.createObjectURL(file));
      } else {
        setPreview(null);
      }
      setFileName(file.name);
      void enviar(file);
    },
    [enviar, preview],
  );

  fromFileRef.current = fromFile;

  /** Ctrl+V en toda la pestaña (capture), mientras el panel esté montado. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imagenDesdePortapapeles(e.clipboardData);
      if (!file) return;
      // Si el foco está en otro panel fuera de Contabilidad, no interferir
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        panelRef.current &&
        !panelRef.current.contains(active) &&
        active !== document.body &&
        active !== document.documentElement
      ) {
        // Aún así, si estamos viendo esta pestaña lazy-montada, aceptamos la imagen
        // salvo que sea un input de texto con selección de texto (pegar texto).
        const tag = active.tagName;
        if ((tag === "INPUT" || tag === "TEXTAREA") && !panelRef.current?.contains(active)) {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
      fromFileRef.current(file);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, []);

  useEffect(() => {
    // Foco en la zona para que Ctrl+V sea obvio al abrir la pestaña
    zonaRef.current?.focus();
  }, []);

  const manejarPasteZona = (e: ReactClipboardEvent) => {
    const file = imagenDesdePortapapeles(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    fromFile(file);
  };

  const limpiar = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileName(null);
    setArchivoActual(null);
    setLineas([]);
    setOkMsg(null);
    setError(null);
    setProveedor("");
  };

  const patchLinea = (id: string, patch: Partial<LineaEditable>) => {
    setLineas((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.nombre != null && patch.unidades_por_pack == null) {
          const inferred = inferirPcs(next.nombre, next.unidad);
          if (inferred > 1 && l.unidades_por_pack <= 1) next.unidades_por_pack = inferred;
        }
        if (patch.cantidad != null || patch.precio_unit != null) {
          next.subtotal = Math.round(next.cantidad * next.precio_unit * 1e6) / 1e6;
        }
        return next;
      }),
    );
  };

  const seleccionadas = lineas.filter((l) => l.seleccionada);
  const puedenGuardar =
    seleccionadas.length > 0 &&
    seleccionadas.every((l) => l.nombre.trim() && l.costo_unitario_cop != null && l.costo_unitario_cop >= 0) &&
    (!necesitaTrm || trmNum > 0);

  const guardar = async () => {
    if (!puedenGuardar) return;
    setGuardando(true);
    setError(null);
    setOkMsg(null);
    try {
      const items = seleccionadas.map((l) => ({
        nombre: l.nombre.trim(),
        codigo: l.sku.trim() || undefined,
        sku: l.sku.trim() || undefined,
        nombre_ocr: l.nombre_ocr,
        cantidad: l.cantidad,
        unidades_por_pack: l.unidades_por_pack,
        unidades_totales: l.cantidad * Math.max(l.unidades_por_pack, 1),
        precio_unit: l.precio_unit,
        subtotal: l.subtotal,
        costo_unitario: l.costo_unitario_cop,
        categoria: l.categoria || "material",
        iva_incluido: false,
      }));

      const fd = new FormData();
      fd.append("items", JSON.stringify(items));
      fd.append("moneda", moneda);
      fd.append("trm", String(necesitaTrm ? trmNum : 1));
      fd.append("flete", String(fleteNum || 0));
      fd.append("moneda_flete", monedaFlete || moneda);
      fd.append("proveedor", proveedor);
      if (archivoActual) fd.append("imagen", archivoActual);

      const res = await api.upload<{
        ok: boolean;
        total: number;
        errores: Array<{ nombre: string; error: string }>;
        historial?: CompraHistorial | null;
      }>("/api/rentabilidad/confirmar-compra-exterior", fd);

      if (res.errores?.length) {
        setError(
          `Guardados ${res.total}. Errores: ${res.errores.map((e) => `${e.nombre}: ${e.error}`).join("; ")}`,
        );
      } else {
        setOkMsg(
          `Guardados ${res.total} costos` +
            (res.historial?.tiene_soporte
              ? " y el pantallazo quedó en el historial como soporte."
              : archivoActual
                ? "."
                : " (sin pantallazo: vuelve a pegarlo antes de guardar para adjuntar soporte)."),
        );
      }
      await cargarHistorial();
      if (res.historial?.id) setDetalleId(res.historial.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const esValido = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf" || esImagenPortapapeles(f);

  return (
    <div ref={panelRef} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Compras exterior</h2>
        <p className="text-sm text-muted">
          Pega el pantallazo con <kbd className="rounded border border-border bg-surface-input px-1 font-mono text-[11px]">Ctrl</kbd>
          +
          <kbd className="rounded border border-border bg-surface-input px-1 font-mono text-[11px]">V</kbd>
          . Si compras sets (ej. 3×100 pcs = 300 uds), el costo guardado es por unidad suelta.
        </p>
      </div>

      <div
        ref={zonaRef}
        tabIndex={0}
        role="button"
        aria-label="Zona para pegar pantallazo con Control V"
        onFocus={() => setZonaActiva(true)}
        onBlur={() => setZonaActiva(false)}
        onClick={() => zonaRef.current?.focus()}
        onPaste={manejarPasteZona}
        className={`rounded-xl border border-dashed bg-accent/5 p-4 space-y-2 outline-none transition ${
          zonaActiva ? "border-accent ring-2 ring-accent/30" : "border-accent/50"
        }`}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f && esValido(f)) fromFile(f);
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-accent">Pegar pantallazo aquí</p>
            <p className="text-xs text-muted">
              Haz clic en esta zona y pulsa <strong>Ctrl+V</strong> (también funciona en cualquier
              parte de esta pestaña). Arrastra o adjunta imagen/PDF.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
              disabled={scanning}
              className="rounded border border-accent/40 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {scanning ? "Extrayendo…" : "Adjuntar"}
            </button>
            {(preview || fileName) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  limpiar();
                }}
                className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-danger hover:border-danger"
              >
                Limpiar
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f && esValido(f)) fromFile(f);
            }}
          />
        </div>
        {preview && (
          <img
            src={preview}
            alt="Vista previa"
            className="max-h-40 rounded border border-border object-contain"
          />
        )}
        {!preview && fileName && (
          <p className="text-xs text-ink truncate">{fileName}</p>
        )}
        {scanning && (
          <p className="text-xs text-accent animate-pulse">Analizando con IA…</p>
        )}
        {!preview && !scanning && !fileName && (
          <p className="py-6 text-center text-sm font-medium text-muted">
            Ctrl+V para pegar el pantallazo
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs">
          <span className="font-bold text-muted">Moneda factura</span>
          <input
            value={moneda}
            onChange={(e) => setMoneda(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">
            TRM {necesitaTrm ? "(obligatoria)" : "(N/A si COP)"}
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={trm}
            disabled={!necesitaTrm}
            onChange={(e) => setTrm(e.target.value)}
            placeholder={necesitaTrm ? "Ej. 4100" : "1"}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono disabled:opacity-40"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">Flete (opcional)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={flete}
            onChange={(e) => setFlete(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">Moneda flete</span>
          <input
            value={monedaFlete}
            onChange={(e) => setMonedaFlete(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-1.5 text-sm font-mono"
          />
        </label>
      </div>

      {proveedor && (
        <p className="text-xs text-muted">
          Proveedor detectado: <span className="font-semibold text-ink">{proveedor}</span>
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          {okMsg}
        </div>
      )}

      {lineas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface-panel text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={lineas.every((l) => l.seleccionada)}
                    onChange={(e) =>
                      setLineas((prev) => prev.map((l) => ({ ...l, seleccionada: e.target.checked })))
                    }
                  />
                </th>
                <th className="px-2 py-2">Producto / SKU</th>
                <th className="px-2 py-2" title="Cantidad de sets/packs comprados">
                  Sets
                </th>
                <th className="px-2 py-2" title="Piezas por cada set">
                  Pcs/set
                </th>
                <th className="px-2 py-2">Total uds</th>
                <th className="px-2 py-2">P. set</th>
                <th className="px-2 py-2">Subtotal</th>
                <th className="px-2 py-2">Costo / ud COP</th>
                <th className="px-2 py-2">Cat.</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const totalUds = Math.round(l.cantidad * Math.max(l.unidades_por_pack, 1) * 1e4) / 1e4;
                return (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={l.seleccionada}
                      onChange={(e) => patchLinea(l.id, { seleccionada: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1.5 min-w-[14rem]">
                    <ProductoSkuAsociar
                      linea={l}
                      onChange={(patch) => patchLinea(l.id, patch)}
                    />
                  </td>
                  <td className="px-2 py-1.5 w-16">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.cantidad}
                      onChange={(e) => patchLinea(l.id, { cantidad: n(e.target.value, 1) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={l.unidades_por_pack}
                      onChange={(e) =>
                        patchLinea(l.id, { unidades_por_pack: Math.max(1, n(e.target.value, 1)) })
                      }
                      className="w-full rounded border border-accent/40 bg-accent/5 px-1.5 py-1 font-mono font-semibold"
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono font-bold text-ink whitespace-nowrap">
                    {totalUds}
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.precio_unit}
                      onChange={(e) => patchLinea(l.id, { precio_unit: n(e.target.value) })}
                      className="w-full rounded border border-border bg-surface-input px-1.5 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-muted whitespace-nowrap">
                    {l.subtotal.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={l.costo_unitario_cop ?? ""}
                      onChange={(e) =>
                        patchLinea(l.id, {
                          costo_unitario_cop: e.target.value === "" ? null : n(e.target.value),
                        })
                      }
                      className="w-28 rounded border border-accent/40 bg-accent/5 px-1.5 py-1 font-mono font-semibold"
                    />
                    <div className="text-[9px] text-muted">{fmtCop(l.costo_unitario_cop)}</div>
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <select
                      value={l.categoria}
                      onChange={(e) => patchLinea(l.id, { categoria: e.target.value })}
                      className="w-full rounded border border-border bg-surface-input px-1 py-1"
                    >
                      <option value="material">material</option>
                      <option value="empaque">empaque</option>
                      <option value="servicio">servicio</option>
                      <option value="otro">otro</option>
                    </select>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lineas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            Costo por unidad = (subtotal + flete) ÷ (sets × pcs/set). Asocia cada línea a un
            componente Siigo por SKU para que el costo quede en el insumo correcto.
          </p>
          <button
            type="button"
            disabled={!puedenGuardar || guardando}
            onClick={() => void guardar()}
            className="rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-accent-hover"
          >
            {guardando ? "Guardando…" : `Guardar seleccionados (${seleccionadas.length})`}
          </button>
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface-panel p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">Historial de compras exterior</h3>
            <p className="text-[11px] text-muted">
              Cada guardado conserva el pantallazo como soporte y las líneas/costos asociados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cargarHistorial()}
            className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
          >
            {historialLoading ? "Cargando…" : "Actualizar"}
          </button>
        </div>

        {historial.length === 0 && !historialLoading && (
          <p className="text-xs text-muted py-4 text-center">
            Aún no hay compras guardadas. Pega un pantallazo, asocia SKU y guarda.
          </p>
        )}

        <ul className="space-y-2">
          {historial.map((c) => {
            const abierto = detalleId === c.id;
            const thumb = soporteThumbs[c.id];
            const fecha = c.created_at ? new Date(c.created_at).toLocaleString("es-CO") : "";
            return (
              <li
                key={c.id}
                className="rounded-lg border border-border bg-surface overflow-hidden"
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-3 p-2 text-left hover:bg-surface-hover"
                  onClick={() => setDetalleId(abierto ? null : c.id)}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-border bg-surface-input">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[9px] text-muted">
                        {c.tiene_soporte ? "…" : "sin foto"}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink">
                      #{c.id} · {fecha}
                      {c.proveedor ? ` · ${c.proveedor}` : ""}
                    </p>
                    <p className="text-[10px] text-muted">
                      {c.moneda}
                      {c.trm ? ` · TRM ${c.trm}` : ""}
                      {c.flete ? ` · flete ${c.flete} ${c.moneda_flete || c.moneda}` : ""}
                      {" · "}
                      {c.total_guardados} costo(s)
                    </p>
                    <p className="truncate text-[10px] text-muted">
                      {(c.lineas || [])
                        .map((l) => `${l.codigo ? l.codigo + " " : ""}${l.nombre}`)
                        .join(" · ") || "Sin líneas"}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted">{abierto ? "▲" : "▼"}</span>
                </button>
                {abierto && (
                  <div className="border-t border-border bg-surface-input/40 p-2 space-y-2">
                    {thumb && (
                      <a href={thumb} target="_blank" rel="noreferrer" className="block">
                        <img
                          src={thumb}
                          alt="Soporte de compra"
                          className="max-h-56 w-full rounded border border-border object-contain bg-surface"
                        />
                      </a>
                    )}
                    <table className="min-w-full text-left text-[10px]">
                      <thead className="text-muted uppercase">
                        <tr>
                          <th className="px-1 py-1">SKU</th>
                          <th className="px-1 py-1">Producto</th>
                          <th className="px-1 py-1">Uds</th>
                          <th className="px-1 py-1">Costo/ud</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(c.lineas || []).map((l, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="px-1 py-1 font-mono text-accent">{l.codigo || "—"}</td>
                            <td className="px-1 py-1">{l.nombre}</td>
                            <td className="px-1 py-1 font-mono">{l.unidades_totales ?? l.cantidad ?? "—"}</td>
                            <td className="px-1 py-1 font-mono">
                              {l.costo_unitario != null
                                ? fmtCop(Number(l.costo_unitario))
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
