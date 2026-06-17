import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  ETIQUETA_STUDIO_DEFAULT,
  aplicarDefaultsAlternativa,
  borradorMeliCompleto,
  puedeExportarEtiqueta,
  validarEtiquetaStudio,
  type EtiquetaStudioDatos,
  type ReglaNormativa,
} from "../../lib/etiquetasNormativa";
import { mmParaTipoEtiqueta, useTiposEtiqueta } from "../../lib/etiquetasTipos";
import { presentacionDesdeTipoEtiqueta } from "../../lib/etiquetasStudioHelpers";
import { EtiquetaMckennaPreview } from "./EtiquetaMckennaPreview";
import { EtiquetaTextoEditorPanel } from "./EtiquetaTextoEditorPanel";
import { EtiquetasStudioCatalogo, type CatalogoStudioFila } from "./EtiquetasStudioCatalogo";
import { SelectorFormatoEtiqueta, type FormatoEtiquetaValor } from "./SelectorFormatoEtiqueta";
import { useGuardarPublicacion } from "../../hooks/usePublicaciones";
import type { CampoDiagramacionId } from "../../lib/etiquetasDiagramacion";

interface ComboRow {
  code: string;
  name: string;
  precio_lista?: number;
  meli_id?: string;
}

interface ResolverAiResponse {
  archivo_ai?: string | null;
  score?: number;
  auto?: boolean;
  total_ai?: number;
  inferido?: {
    contenido_neto?: string;
    unidad?: string;
    tipo_etiqueta?: string;
  } | null;
  candidatos?: Array<{
    archivo: string;
    nombre: string;
    formato: string;
    score: number;
  }>;
}

type PanelExtra = "plantilla" | "meli" | null;

function inferirPresentacionSku(sku: string): Partial<EtiquetaStudioDatos> {
  const raw = sku.trim();
  if (!raw) return {};
  const m =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|mL|lt|l)\b/i) ||
    raw.match(/(\d+)(kg|g|ml|mL|lt|l)$/i);
  if (!m) return {};
  const neto = m[1].replace(",", ".");
  const u = m[2].toLowerCase();
  if (u === "kg" && parseFloat(neto) === 1) {
    return { contenido_neto: "1", unidad: "Kg", tipo_etiqueta: "1 Kg" };
  }
  if (u === "ml") {
    return { contenido_neto: neto, unidad: "mL", tipo_etiqueta: `${neto} mL` };
  }
  if (u === "lt" || u === "l") {
    return { contenido_neto: neto, unidad: "L", tipo_etiqueta: "50 mL" };
  }
  return { contenido_neto: neto, unidad: "g", tipo_etiqueta: `${neto} g` };
}

function claseSeveridad(s: ReglaNormativa["severidad"]): string {
  if (s === "error") return "border-red-300 bg-red-50 text-red-800";
  if (s === "warning") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

export function EtiquetasStudioPanel() {
  const qc = useQueryClient();
  const { data: tiposData } = useTiposEtiqueta();
  const tipos = tiposData?.tipos ?? [];
  const guardarPub = useGuardarPublicacion();

  const [datos, setDatos] = useState<EtiquetaStudioDatos>({ ...ETIQUETA_STUDIO_DEFAULT });
  const [buscarSku, setBuscarSku] = useState("");
  const [buscarPlantillaAi, setBuscarPlantillaAi] = useState("");
  const [plantillaAiManual, setPlantillaAiManual] = useState(false);
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false);
  const [catalogoModoEscaneo, setCatalogoModoEscaneo] = useState(false);
  const [panelExtra, setPanelExtra] = useState<PanelExtra>(null);
  const [seleccionCampo, setSeleccionCampo] = useState<string>("b1");
  const [camposPresentes, setCamposPresentes] = useState<Set<CampoDiagramacionId>>(new Set());
  const [graficosPresentes, setGraficosPresentes] = useState<string[]>([]);
  const [versionActiva, setVersionActiva] = useState<"original" | "alternativa">("alternativa");
  const [meliMsg, setMeliMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [fichaMsg, setFichaMsg] = useState<string | null>(null);
  const [formatoMsg, setFormatoMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const studioLoadKeyRef = useRef("");
  const descripcionEditadaRef = useRef(false);

  interface DescripcionFichaResponse {
    ok: boolean;
    descripcion_etiqueta?: string;
    fuente?: string | null;
    termino?: string;
    caracteres?: number;
  }

  const { data: combosData } = useQuery({
    queryKey: ["etiquetas-combos", buscarSku],
    queryFn: () =>
      api.get<{ combos: ComboRow[] }>(
        `/api/etiquetas/combos-siigo${buscarSku ? `?q=${encodeURIComponent(buscarSku)}` : ""}`,
      ),
    staleTime: 30_000,
  });

  const { data: studioGuardado } = useQuery({
    queryKey: ["etiquetas-studio", datos.sku, versionActiva],
    queryFn: () =>
      api.get<{ datos: EtiquetaStudioDatos | null; versiones?: string[] }>(
        `/api/etiquetas/studio/${encodeURIComponent(datos.sku)}?version=${versionActiva}`,
      ),
    enabled: !!datos.sku.trim(),
  });

  const { data: etiquetaDatosSku } = useQuery({
    queryKey: ["etiquetas-datos-sku", datos.sku],
    queryFn: () =>
      api.get<{ lote_defecto?: string; vencimiento_defecto?: string; tipo_etiqueta?: string }>(
        `/api/etiquetas/datos/${encodeURIComponent(datos.sku)}`,
      ),
    enabled: !!datos.sku.trim(),
  });

  useEffect(() => {
    const g = studioGuardado?.datos;
    if (!g || !datos.sku.trim() || Object.keys(g).length === 0) return;

    const loadKey = `${datos.sku}|${versionActiva}`;
    if (loadKey !== studioLoadKeyRef.current) {
      studioLoadKeyRef.current = loadKey;
      descripcionEditadaRef.current = false;
      setDatos((prev) => ({ ...prev, ...g }));
      if (g.archivo_ai) setPlantillaAiManual(true);
      return;
    }

    if (!descripcionEditadaRef.current) {
      setDatos((prev) => ({ ...prev, ...g }));
      if (g.archivo_ai) setPlantillaAiManual(true);
    }
  }, [studioGuardado?.datos, datos.sku, versionActiva]);

  const resolverQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (datos.sku) p.set("sku", datos.sku);
    if (datos.nombre_producto) p.set("nombre_producto", datos.nombre_producto);
    if (datos.ingrediente) p.set("ingrediente", datos.ingrediente);
    if (datos.contenido_neto) p.set("contenido_neto", datos.contenido_neto);
    if (datos.unidad) p.set("unidad", datos.unidad);
    if (datos.tipo_etiqueta) p.set("tipo_etiqueta", datos.tipo_etiqueta);
    if (plantillaAiManual && datos.archivo_ai) p.set("archivo_ai", datos.archivo_ai);
    if (buscarPlantillaAi.trim()) p.set("q", buscarPlantillaAi.trim());
    p.set("limite", "25");
    return p.toString();
  }, [
    datos.sku,
    datos.nombre_producto,
    datos.ingrediente,
    datos.contenido_neto,
    datos.unidad,
    datos.tipo_etiqueta,
    datos.archivo_ai,
    plantillaAiManual,
    buscarPlantillaAi,
  ]);

  const { data: resolverAi } = useQuery({
    queryKey: ["etiquetas-resolver-ai", resolverQuery],
    queryFn: () =>
      api.get<ResolverAiResponse>(`/api/etiquetas/studio/resolver-ai?${resolverQuery}`),
    enabled: !!datos.nombre_producto.trim() || !!datos.sku.trim(),
    staleTime: 8_000,
  });

  useEffect(() => {
    if (!resolverAi || datos.forzar_plantilla_svg) return;
    if (plantillaAiManual) return;

    const patchAi: Partial<EtiquetaStudioDatos> = {};
    if (resolverAi.archivo_ai && resolverAi.archivo_ai !== datos.archivo_ai) {
      patchAi.archivo_ai = resolverAi.archivo_ai;
    }
    if (resolverAi.inferido) {
      const inf = resolverAi.inferido;
      if (inf.contenido_neto && !datos.contenido_neto.trim()) {
        patchAi.contenido_neto = inf.contenido_neto;
      }
      if (inf.unidad && datos.unidad === ETIQUETA_STUDIO_DEFAULT.unidad && inf.unidad !== "g") {
        patchAi.unidad = inf.unidad;
      }
      if (inf.tipo_etiqueta && datos.tipo_etiqueta === ETIQUETA_STUDIO_DEFAULT.tipo_etiqueta) {
        patchAi.tipo_etiqueta = inf.tipo_etiqueta;
        const [ancho, alto] = mmParaTipoEtiqueta(inf.tipo_etiqueta, tipos);
        patchAi.ancho_mm = ancho;
        patchAi.alto_mm = alto;
      }
    }
    if (Object.keys(patchAi).length > 0) {
      setDatos((d) => ({ ...d, ...patchAi }));
    }
  }, [
    resolverAi,
    plantillaAiManual,
    datos.forzar_plantilla_svg,
    datos.archivo_ai,
    datos.contenido_neto,
    datos.unidad,
    datos.tipo_etiqueta,
    tipos,
  ]);

  useEffect(() => {
    const e = etiquetaDatosSku;
    if (!e || !datos.sku.trim()) return;
    setDatos((prev) => ({
      ...prev,
      lote: prev.lote || e.lote_defecto || "",
      vencimiento: prev.vencimiento || e.vencimiento_defecto || "",
      tipo_etiqueta: prev.tipo_etiqueta || e.tipo_etiqueta || prev.tipo_etiqueta,
    }));
  }, [etiquetaDatosSku, datos.sku]);

  const reglas = useMemo(() => validarEtiquetaStudio(datos), [datos]);
  const borradorMeli = useMemo(() => borradorMeliCompleto(datos), [datos]);
  const puedeExportar = puedeExportarEtiqueta(datos);
  const erroresNorma = reglas.filter((r) => r.severidad === "error").length;
  const avisosNorma = reglas.filter((r) => r.severidad === "warning").length;

  const patch = useCallback((p: Partial<EtiquetaStudioDatos>) => {
    if ("descripcion_etiqueta" in p) {
      descripcionEditadaRef.current = true;
    }
    setDatos((d) => ({ ...d, ...p }));
  }, []);

  const complementarDesdeFicha = useCallback(
    async (
      base: Pick<EtiquetaStudioDatos, "sku" | "nombre_producto" | "ingrediente" | "perfil">,
      opts?: { forzar?: boolean },
    ) => {
      if (!base.nombre_producto?.trim() && !base.ingrediente?.trim()) return;
      const actual = (datos.descripcion_etiqueta || "").trim();
      if (!opts?.forzar && actual.length > 80) {
        const ok = window.confirm(
          "Ya hay una descripción en el cuadro. ¿Reemplazarla con el texto generado desde la ficha técnica?",
        );
        if (!ok) return;
      }
      setFichaMsg(null);
      const p = new URLSearchParams();
      if (base.sku) p.set("sku", base.sku);
      if (base.nombre_producto) p.set("nombre_producto", base.nombre_producto);
      if (base.ingrediente) p.set("ingrediente", base.ingrediente);
      if (base.perfil) p.set("perfil", base.perfil);
      try {
        const res = await api.get<DescripcionFichaResponse>(
          `/api/etiquetas/studio/descripcion-ficha?${p.toString()}`,
        );
        if (res.ok && res.descripcion_etiqueta) {
          descripcionEditadaRef.current = true;
          patch({ descripcion_etiqueta: res.descripcion_etiqueta });
          setFichaMsg(`Ficha técnica aplicada (${res.caracteres ?? res.descripcion_etiqueta.length} car.)`);
        } else {
          setFichaMsg("Sin ficha técnica en Sheets.");
        }
      } catch (e) {
        setFichaMsg(e instanceof Error ? e.message : "Error leyendo ficha");
      }
    },
    [patch, datos.descripcion_etiqueta],
  );

  const fichaMut = useMutation({
    mutationFn: () => complementarDesdeFicha(datos, { forzar: false }),
  });

  const guardarMut = useMutation({
    mutationFn: (payload: EtiquetaStudioDatos) =>
      api.post<{ ok: boolean }>(`/api/etiquetas/studio/${encodeURIComponent(payload.sku)}`, {
        ...payload,
        version: versionActiva,
      }),
    onSuccess: () => {
      descripcionEditadaRef.current = false;
      setStatusMsg("Guardado");
      window.setTimeout(() => setStatusMsg(null), 2000);
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio", datos.sku] });
    },
  });

  const copiarVersionMut = useMutation({
    mutationFn: (sku: string) =>
      api.post<{ ok: boolean }>(`/api/etiquetas/studio/${encodeURIComponent(sku)}`, {
        accion: "copiar_version",
        origen: "original",
        destino: "alternativa",
      }),
    onSuccess: () => {
      setVersionActiva("alternativa");
      descripcionEditadaRef.current = false;
      studioLoadKeyRef.current = "";
      setDatos((d) => {
        const next = { ...d, ...aplicarDefaultsAlternativa(d) } as EtiquetaStudioDatos;
        void complementarDesdeFicha(next, { forzar: true });
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio", datos.sku] });
    },
  });

  const vincularFormatoMut = useMutation({
    mutationFn: (payload: {
      sku: string;
      tipo_etiqueta: string;
      nombre_producto: string;
      ancho_mm: number;
      alto_mm: number;
      contenido_neto: string;
      unidad: string;
      lote: string;
      vencimiento: string;
    }) =>
      api.post(`/api/etiquetas/datos/${encodeURIComponent(payload.sku)}`, {
        siigo_code: payload.sku,
        siigo_name: payload.nombre_producto,
        nombre_etiqueta: payload.nombre_producto,
        presentacion: `${payload.contenido_neto}${payload.unidad}`,
        tipo_etiqueta: payload.tipo_etiqueta,
        lote_defecto: payload.lote,
        vencimiento_defecto: payload.vencimiento,
        studio: true,
      }),
    onSuccess: () => {
      setFormatoMsg("Vinculado a impresión");
      window.setTimeout(() => setFormatoMsg(null), 2000);
    },
    onError: (e: Error) => setFormatoMsg(e.message),
  });

  const exportarMut = useMutation({
    mutationFn: (payload: EtiquetaStudioDatos) =>
      api.post<{ ok: boolean; pdf_ruta?: string; pdf_nombre?: string; mensaje?: string }>(
        "/api/etiquetas/studio/exportar-pdf",
        payload,
      ),
    onSuccess: (res) => {
      setExportMsg(res.mensaje || `PDF: ${res.pdf_nombre || "ok"}`);
      window.setTimeout(() => setExportMsg(null), 4000);
    },
    onError: (e: Error) => setExportMsg(e.message),
  });

  function cargarCombo(c: ComboRow, opts?: { archivoAi?: string; forzarSvg?: boolean }) {
    const pres = inferirPresentacionSku(c.code);
    const tipo = pres.tipo_etiqueta ?? datos.tipo_etiqueta;
    const [ancho, alto] = mmParaTipoEtiqueta(tipo, tipos);
    studioLoadKeyRef.current = "";
    descripcionEditadaRef.current = false;
    setPlantillaAiManual(!!opts?.archivoAi);
    setBuscarPlantillaAi("");
    setFichaMsg(null);
    setMostrarCatalogo(false);
    setDatos(
      aplicarDefaultsAlternativa({
        ...ETIQUETA_STUDIO_DEFAULT,
        sku: c.code,
        codigo_barras: "",
        nombre_producto: c.name.replace(/\s+/g, " ").trim(),
        ingrediente: c.name.replace(/\s+/g, " ").trim(),
        contenido_neto: pres.contenido_neto ?? ETIQUETA_STUDIO_DEFAULT.contenido_neto,
        unidad: pres.unidad ?? ETIQUETA_STUDIO_DEFAULT.unidad,
        tipo_etiqueta: tipo,
        ancho_mm: ancho,
        alto_mm: alto,
        archivo_ai: opts?.archivoAi || "",
        forzar_plantilla_svg: !!opts?.forzarSvg,
      }) as EtiquetaStudioDatos,
    );
    setBuscarSku(c.code);
  }

  function editarDesdeCatalogo(fila: CatalogoStudioFila) {
    cargarCombo(
      { code: fila.sku, name: fila.nombre },
      {
        archivoAi: fila.archivo_ai_manual ? fila.archivo_ai || undefined : undefined,
        forzarSvg: fila.fuente === "svg",
      },
    );
  }

  const candidatosAi = resolverAi?.candidatos ?? [];
  const plantillaActiva =
    datos.forzar_plantilla_svg
      ? "SVG genérico"
      : datos.archivo_ai || resolverAi?.archivo_ai || "—";

  function cambiarFormatoImpresion(v: FormatoEtiquetaValor) {
    const pres = presentacionDesdeTipoEtiqueta(v.nombre);
    const next: Partial<EtiquetaStudioDatos> = {
      tipo_etiqueta: v.nombre,
      ancho_mm: v.anchoMm,
      alto_mm: v.altoMm,
    };
    if (pres.contenido_neto) next.contenido_neto = pres.contenido_neto;
    if (pres.unidad) next.unidad = pres.unidad;
    patch(next);
    if (datos.sku.trim() && v.nombre.trim()) {
      vincularFormatoMut.mutate({
        sku: datos.sku,
        tipo_etiqueta: v.nombre,
        nombre_producto: datos.nombre_producto,
        ancho_mm: v.anchoMm,
        alto_mm: v.altoMm,
        contenido_neto: pres.contenido_neto ?? datos.contenido_neto,
        unidad: pres.unidad ?? datos.unidad,
        lote: datos.lote,
        vencimiento: datos.vencimiento,
      });
    }
  }

  const datosPreview = useMemo(
    () => ({
      ...datos,
      modo_etiqueta: versionActiva,
      descripcion_etiqueta: datos.descripcion_etiqueta ?? "",
      diagramacion: datos.diagramacion ?? {},
      diagramacion_graficos: datos.diagramacion_graficos ?? {},
    }),
    [datos, versionActiva],
  );

  async function aplicarAPublicacion() {
    if (!datos.sku.trim()) return;
    setMeliMsg(null);
    try {
      await guardarMut.mutateAsync(datos);
      await guardarPub.mutateAsync({
        sku: datos.sku,
        campos: {
          descripcion: borradorMeli.descripcion,
          caracteristicas: Object.entries(borradorMeli.atributos).map(([titulo, valor]) => ({
            titulo,
            valor,
          })),
        },
      });
      await api.post(`/api/etiquetas/datos/${encodeURIComponent(datos.sku)}`, {
        siigo_code: datos.sku,
        siigo_name: datos.nombre_producto,
        nombre_etiqueta: datos.nombre_producto,
        presentacion: `${datos.contenido_neto}${datos.unidad}`,
        tipo_etiqueta: datos.tipo_etiqueta,
        lote_defecto: datos.lote,
        vencimiento_defecto: datos.vencimiento,
        studio: true,
      });
      setMeliMsg("Borrador MeLi aplicado");
    } catch (e) {
      setMeliMsg(e instanceof Error ? e.message : "Error al aplicar");
    }
  }

  const extraBtnCls = (t: "plantilla" | "meli") =>
    `rounded-md px-2.5 py-1 text-[10px] font-semibold ${
      panelExtra === t ? "bg-accent text-white" : "border border-border hover:bg-surface-hover"
    }`;

  const combosFiltrados = (combosData?.combos ?? []).slice(0, 8);
  const edicionTexto = versionActiva === "alternativa";

  return (
    <div className="mx-auto flex max-w-[min(100%,1920px)] flex-col gap-3">
      {/* Barra superior: producto + acciones */}
      <div className="sticky top-0 z-20 rounded-xl border border-border bg-surface-panel p-3 shadow-paper-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMostrarCatalogo((v) => !v)}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${
              mostrarCatalogo ? "bg-accent text-white" : "border border-border bg-surface hover:bg-surface-hover"
            }`}
          >
            {mostrarCatalogo ? "Cerrar catálogo" : "Catálogo"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMostrarCatalogo(true);
              setCatalogoModoEscaneo(true);
            }}
            className="shrink-0 rounded-lg border-2 border-violet-500 bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700"
            title="Abre el catálogo para elegir qué etiqueta escanear"
          >
            Escanear diagramación
          </button>

          <div className="relative min-w-[12rem] flex-1">
            <input
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              placeholder="Buscar SKU o producto…"
              value={buscarSku}
              onChange={(e) => setBuscarSku(e.target.value)}
            />
            {buscarSku.trim() && combosFiltrados.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-lg">
                {combosFiltrados.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => cargarCombo(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-hover"
                    >
                      <span>
                        <span className="font-mono text-accent">{c.code}</span>{" "}
                        <span className="text-ink">{c.name}</span>
                      </span>
                      {c.meli_id && <span className="text-[10px] text-blue-600">MeLi</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {datos.sku && (
            <div className="hidden min-w-0 max-w-[14rem] truncate text-xs sm:block">
              <span className="font-mono font-semibold text-accent">{datos.sku}</span>
              <span className="text-muted"> · {datos.nombre_producto}</span>
            </div>
          )}

          <div className="flex shrink-0 rounded-lg border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setVersionActiva("alternativa")}
              className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${
                versionActiva === "alternativa" ? "bg-accent text-white" : "text-muted"
              }`}
            >
              Alternativa
            </button>
            <button
              type="button"
              onClick={() => setVersionActiva("original")}
              className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold ${
                versionActiva === "original" ? "bg-accent text-white" : "text-muted"
              }`}
            >
              Original
            </button>
          </div>

          {(erroresNorma > 0 || avisosNorma > 0) && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                erroresNorma > 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
              }`}
              title={reglas.map((r) => r.mensaje).join("\n")}
            >
              {erroresNorma > 0 ? `${erroresNorma} error${erroresNorma > 1 ? "es" : ""}` : `${avisosNorma} aviso${avisosNorma > 1 ? "s" : ""}`}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setPanelExtra(panelExtra === "plantilla" ? null : "plantilla")} className={extraBtnCls("plantilla")}>
              Plantilla
            </button>
            <button type="button" onClick={() => setPanelExtra(panelExtra === "meli" ? null : "meli")} className={extraBtnCls("meli")}>
              MeLi
            </button>
            {versionActiva === "alternativa" && datos.sku && (
              <button
                type="button"
                disabled={copiarVersionMut.isPending}
                onClick={() => copiarVersionMut.mutate(datos.sku)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold hover:bg-surface-hover disabled:opacity-50"
                title="Copiar texto base desde la versión original"
              >
                Desde original
              </button>
            )}
            <button
              type="button"
              disabled={!datos.sku || guardarMut.isPending || versionActiva === "original"}
              onClick={() => guardarMut.mutate(datos)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {guardarMut.isPending ? "…" : "Guardar"}
            </button>
            <button
              type="button"
              disabled={!puedeExportar || exportarMut.isPending}
              onClick={() => exportarMut.mutate({ ...datos, modo_etiqueta: versionActiva })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-hover disabled:opacity-50"
            >
              PDF
            </button>
          </div>
        </div>

        {(statusMsg || exportMsg || meliMsg || formatoMsg) && (
          <p className="mt-2 text-center text-[10px] font-semibold text-accent">
            {[statusMsg, exportMsg, meliMsg, formatoMsg].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {mostrarCatalogo && (
        <EtiquetasStudioCatalogo
          onSeleccionar={editarDesdeCatalogo}
          skuActivo={datos.sku}
          accionLabel="Abrir"
          modoEscaneo={catalogoModoEscaneo}
          skuEscaneoInicial={catalogoModoEscaneo ? datos.sku : undefined}
          onModoEscaneoChange={setCatalogoModoEscaneo}
        />
      )}

      {/* Área principal: preview + editor de textos */}
      <div className="grid min-h-[calc(100vh-10rem)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface-panel p-3">
          <SelectorFormatoEtiqueta
            previewBar
            value={{ nombre: datos.tipo_etiqueta, anchoMm: datos.ancho_mm, altoMm: datos.alto_mm }}
            onChange={cambiarFormatoImpresion}
          />

          <div className="min-h-0 flex-1 rounded-lg bg-[#e8eaed] p-2">
            {datos.sku ? (
              <EtiquetaMckennaPreview
                datos={datosPreview}
                className="h-full w-full"
                raw={!edicionTexto}
                editable={edicionTexto}
                modoStudio
                marcoFormato
                panelTextoExterno={edicionTexto}
                seleccionCampo={seleccionCampo}
                onSeleccionCampo={(id) => id && setSeleccionCampo(id)}
                onCamposPresentesChange={setCamposPresentes}
                onGraficosPresentesChange={setGraficosPresentes}
                onPatch={patch}
              />
            ) : (
              <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm font-medium text-muted">Busca un SKU para editar los textos de la etiqueta</p>
                <button
                  type="button"
                  onClick={() => setMostrarCatalogo(true)}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
                >
                  Abrir catálogo
                </button>
              </div>
            )}
          </div>

          {datos.sku && (
            <p className="text-center text-[10px] text-muted">
              Vista a tamaño real del formato · arrastra textos y gráficos · {plantillaActiva}
            </p>
          )}
        </section>

        {panelExtra === "plantilla" ? (
          <aside className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Plantilla .ai</h3>
              <button type="button" onClick={() => setPanelExtra(null)} className="text-xs text-muted hover:text-ink">✕</button>
            </div>
            <div className="space-y-3 overflow-y-auto">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!datos.forzar_plantilla_svg}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setPlantillaAiManual(false);
                    patch({ forzar_plantilla_svg: on, ...(on ? { archivo_ai: "" } : {}) });
                  }}
                />
                SVG genérico
              </label>
              {!datos.forzar_plantilla_svg && (
                <>
                  <select
                    className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs font-mono"
                    value={datos.archivo_ai || ""}
                    onChange={(e) => {
                      setPlantillaAiManual(!!e.target.value);
                      patch({ archivo_ai: e.target.value, forzar_plantilla_svg: false });
                    }}
                  >
                    <option value="">Automático</option>
                    {candidatosAi.map((c) => (
                      <option key={c.archivo} value={c.archivo}>{c.archivo}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted font-mono">{plantillaActiva}</p>
                </>
              )}
            </div>
          </aside>
        ) : panelExtra === "meli" ? (
          <aside className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel p-3">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Borrador MeLi</h3>
              <button type="button" onClick={() => setPanelExtra(null)} className="text-xs text-muted hover:text-ink">✕</button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto">
              <p className="text-xs font-semibold">{borradorMeli.titulo}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[10px]">{borradorMeli.descripcion}</pre>
              <button
                type="button"
                disabled={!puedeExportar || !datos.sku || guardarPub.isPending}
                onClick={() => void aplicarAPublicacion()}
                className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Aplicar a Publicaciones
              </button>
            </div>
          </aside>
        ) : (
          <EtiquetaTextoEditorPanel
            datos={datos}
            diagramacion={datos.diagramacion}
            diagramacionGraficos={datos.diagramacion_graficos}
            seleccion={seleccionCampo}
            onSeleccion={setSeleccionCampo}
            onPatchDatos={patch}
            onPatchDiagramacion={(d) => patch({ diagramacion: d })}
            onPatchGraficos={(g) => patch({ diagramacion_graficos: g })}
            soloLectura={!edicionTexto}
            camposPresentes={camposPresentes}
            graficosPresentes={graficosPresentes}
            onCompletarFicha={() => fichaMut.mutate()}
            fichaPendiente={fichaMut.isPending}
            fichaMsg={fichaMsg}
          />
        )}
      </div>

      {reglas.length > 0 && (
        <details className="rounded-lg border border-border bg-surface-panel px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-ink-secondary">
            Validación normativa ({reglas.length})
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {reglas.map((r) => (
              <li key={r.id} className={`rounded border px-2 py-1 text-[10px] ${claseSeveridad(r.severidad)}`}>
                {r.mensaje}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
