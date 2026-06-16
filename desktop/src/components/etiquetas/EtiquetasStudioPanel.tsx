import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import {
  ETIQUETA_STUDIO_DEFAULT,
  borradorMeliCompleto,
  puedeExportarEtiqueta,
  perfilSubtitulo,
  validarEtiquetaStudio,
  type EtiquetaStudioDatos,
  type ReglaNormativa,
} from "../../lib/etiquetasNormativa";
import { mmParaTipoEtiqueta, useTiposEtiqueta } from "../../lib/etiquetasTipos";
import { EtiquetaMckennaPreview } from "./EtiquetaMckennaPreview";
import { EtiquetasStudioCatalogo, type CatalogoStudioFila } from "./EtiquetasStudioCatalogo";
import { SelectorFormatoEtiqueta } from "./SelectorFormatoEtiqueta";
import { useGuardarPublicacion } from "../../hooks/usePublicaciones";

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

function Campo({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const cls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-ink-secondary">{label}</span>
      {multiline ? (
        <textarea
          className={`${cls} min-h-[72px] resize-y`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </label>
  );
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
  const [vistaStudio, setVistaStudio] = useState<"catalogo" | "editor">("catalogo");
  const [meliMsg, setMeliMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const { data: combosData } = useQuery({
    queryKey: ["etiquetas-combos", buscarSku],
    queryFn: () =>
      api.get<{ combos: ComboRow[] }>(
        `/api/etiquetas/combos-siigo${buscarSku ? `?q=${encodeURIComponent(buscarSku)}` : ""}`,
      ),
    staleTime: 30_000,
  });

  const { data: studioGuardado } = useQuery({
    queryKey: ["etiquetas-studio", datos.sku],
    queryFn: () =>
      api.get<{ datos: EtiquetaStudioDatos | null }>(
        `/api/etiquetas/studio/${encodeURIComponent(datos.sku)}`,
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
    if (g && Object.keys(g).length > 0) {
      setDatos((prev) => ({ ...prev, ...g }));
      if (g.archivo_ai) setPlantillaAiManual(true);
    }
  }, [studioGuardado?.datos]);

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

  const patch = useCallback((p: Partial<EtiquetaStudioDatos>) => {
    setDatos((d) => ({ ...d, ...p }));
  }, []);

  const guardarMut = useMutation({
    mutationFn: (payload: EtiquetaStudioDatos) =>
      api.post<{ ok: boolean }>(`/api/etiquetas/studio/${encodeURIComponent(payload.sku)}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["etiquetas-studio", datos.sku] });
    },
  });

  const exportarMut = useMutation({
    mutationFn: (payload: EtiquetaStudioDatos) =>
      api.post<{ ok: boolean; pdf_ruta?: string; pdf_nombre?: string; mensaje?: string }>(
        "/api/etiquetas/studio/exportar-pdf",
        payload,
      ),
    onSuccess: (res) => {
      setExportMsg(res.mensaje || `PDF guardado: ${res.pdf_nombre || res.pdf_ruta || "ok"}`);
    },
    onError: (e: Error) => setExportMsg(e.message),
  });

  function cargarCombo(c: ComboRow, opts?: { archivoAi?: string; forzarSvg?: boolean }) {
    const pres = inferirPresentacionSku(c.code);
    const tipo = pres.tipo_etiqueta ?? datos.tipo_etiqueta;
    const [ancho, alto] = mmParaTipoEtiqueta(tipo, tipos);
    setPlantillaAiManual(!!opts?.archivoAi);
    setBuscarPlantillaAi("");
    setDatos({
      ...ETIQUETA_STUDIO_DEFAULT,
      sku: c.code,
      codigo_barras: c.code,
      nombre_producto: c.name.replace(/\s+/g, " ").trim(),
      ingrediente: c.name.replace(/\s+/g, " ").trim(),
      contenido_neto: pres.contenido_neto ?? ETIQUETA_STUDIO_DEFAULT.contenido_neto,
      unidad: pres.unidad ?? ETIQUETA_STUDIO_DEFAULT.unidad,
      tipo_etiqueta: tipo,
      ancho_mm: ancho,
      alto_mm: alto,
      archivo_ai: opts?.archivoAi || "",
      forzar_plantilla_svg: !!opts?.forzarSvg,
    });
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
    setVistaStudio("editor");
  }

  const candidatosAi = resolverAi?.candidatos ?? [];
  const plantillaActiva =
    datos.forzar_plantilla_svg
      ? "SVG genérico"
      : datos.archivo_ai || resolverAi?.archivo_ai || "—";

  function onPerfilChange(perfil: EtiquetaStudioDatos["perfil"]) {
    patch({ perfil, subtitulo: perfilSubtitulo(perfil) });
  }

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
      setMeliMsg("Borrador aplicado a Publicaciones y datos de etiqueta.");
    } catch (e) {
      setMeliMsg(e instanceof Error ? e.message : "Error al aplicar borrador");
    }
  }

  return (
    <div className="mx-auto max-w-[min(100%,1600px)] space-y-4">
      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Studio de etiquetas — Remaster</h2>
            <p className="mt-1 text-sm text-muted">
              Catálogo SKU ↔ plantilla Illustrator ↔ publicación MeLi. Editor con validación normativa
              (Res. 2674/2013), preview Inkscape y borrador MeLi.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setVistaStudio("catalogo")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                vistaStudio === "catalogo" ? "bg-accent text-white" : "text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              Catálogo
            </button>
            <button
              type="button"
              onClick={() => setVistaStudio("editor")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                vistaStudio === "editor" ? "bg-accent text-white" : "text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              Editor
            </button>
          </div>
        </div>
      </div>

      {vistaStudio === "catalogo" && (
        <EtiquetasStudioCatalogo
          onSeleccionar={editarDesdeCatalogo}
          skuActivo={datos.sku}
          accionLabel="Editar"
        />
      )}

      {vistaStudio === "editor" && (
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink">Producto Siigo</h3>
            <input
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              placeholder="Buscar SKU o nombre…"
              value={buscarSku}
              onChange={(e) => setBuscarSku(e.target.value)}
            />
            <div className="max-h-36 divide-y overflow-y-auto rounded-lg border border-border">
              {(combosData?.combos ?? []).slice(0, 12).map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => cargarCombo(c)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-hover"
                >
                  <span>
                    <span className="font-mono text-accent">{c.code}</span> {c.name}
                  </span>
                  {c.meli_id && <span className="text-[10px] text-blue-600">MeLi</span>}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink">Plantilla Illustrator</h3>
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
              Usar SVG genérico (sin .ai)
            </label>
            {!datos.forzar_plantilla_svg && (
              <>
                <p className="text-[11px] text-muted">
                  {resolverAi?.total_ai ?? "—"} plantillas .ai ·{" "}
                  {plantillaAiManual
                    ? "Selección manual"
                    : resolverAi?.auto
                      ? "Vinculada automáticamente al SKU/nombre"
                      : "Sin coincidencia automática"}
                  {resolverAi?.score ? ` · score ${resolverAi.score}` : ""}
                </p>
                <p className="text-[10px] text-amber-800">
                  Con .ai se conserva el diseño Illustrator original: solo se reemplaza texto y barras
                  en su posición. LOT/EXP y legal no se añaden si no vienen en la plantilla.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-ink-secondary">Archivo .ai activo</span>
                  <select
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono"
                    value={datos.archivo_ai || ""}
                    onChange={(e) => {
                      setPlantillaAiManual(!!e.target.value);
                      patch({ archivo_ai: e.target.value, forzar_plantilla_svg: false });
                    }}
                  >
                    <option value="">— Automático —</option>
                    {datos.archivo_ai &&
                      !candidatosAi.some((c) => c.archivo === datos.archivo_ai) && (
                        <option value={datos.archivo_ai}>{datos.archivo_ai}</option>
                      )}
                    {candidatosAi.map((c) => (
                      <option key={c.archivo} value={c.archivo}>
                        {c.archivo} ({c.score})
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  className="w-full rounded-lg border border-border px-3 py-2 text-xs"
                  placeholder="Buscar plantilla .ai por nombre…"
                  value={buscarPlantillaAi}
                  onChange={(e) => setBuscarPlantillaAi(e.target.value)}
                />
                {buscarPlantillaAi.trim() && candidatosAi.length > 0 && (
                  <div className="max-h-32 divide-y overflow-y-auto rounded-lg border border-border">
                    {candidatosAi.map((c) => (
                      <button
                        key={c.archivo}
                        type="button"
                        onClick={() => {
                          setPlantillaAiManual(true);
                          patch({ archivo_ai: c.archivo, forzar_plantilla_svg: false });
                          setBuscarPlantillaAi("");
                        }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[10px] hover:bg-surface-hover"
                      >
                        <span className="font-mono">{c.archivo}</span>
                        <span className="text-muted">{c.formato} · {c.score}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted">
                  Activa: <span className="font-mono text-ink">{plantillaActiva}</span>
                </p>
              </>
            )}
          </section>

          <section className="grid gap-3 rounded-xl border border-border bg-surface-panel p-4 sm:grid-cols-2">
            <Campo label="SKU / Código" value={datos.sku} onChange={(v) => patch({ sku: v })} />
            <Campo label="Nombre en etiqueta" value={datos.nombre_producto} onChange={(v) => patch({ nombre_producto: v })} />
            <Campo label="Ingrediente principal" value={datos.ingrediente} onChange={(v) => patch({ ingrediente: v })} />
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-ink-secondary">Perfil normativo</span>
              <select
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                value={datos.perfil}
                onChange={(e) => onPerfilChange(e.target.value as EtiquetaStudioDatos["perfil"])}
              >
                <option value="materia_prima_alimentaria">Materia prima alimentaria</option>
                <option value="insumo_cosmetico">Insumo cosmético</option>
                <option value="insumo_tecnico">Insumo técnico</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <Campo label="Subtítulo etiqueta" value={datos.subtitulo} onChange={(v) => patch({ subtitulo: v })} multiline />
            </div>
            <Campo label="Neto" value={datos.contenido_neto} onChange={(v) => patch({ contenido_neto: v })} />
            <Campo label="Unidad" value={datos.unidad} onChange={(v) => patch({ unidad: v })} />
            <Campo label="Extra presentación" value={datos.presentacion_extra} onChange={(v) => patch({ presentacion_extra: v })} />
            <div className="sm:col-span-2">
              <Campo label="Aplicaciones" value={datos.aplicaciones} onChange={(v) => patch({ aplicaciones: v })} multiline />
            </div>
            <div className="sm:col-span-2">
              <Campo
                label="Descripción en etiqueta (párrafo principal)"
                value={datos.descripcion_etiqueta}
                onChange={(v) => patch({ descripcion_etiqueta: v })}
                multiline
                hint="Reemplaza el texto principal del SVG modelo"
              />
            </div>
            <Campo label="CAS" value={datos.cas} onChange={(v) => patch({ cas: v })} placeholder="ej. 3344-18-1" />
            <Campo label="Concentración" value={datos.concentracion} onChange={(v) => patch({ concentracion: v })} />
            <Campo
              label="Fórmula molecular"
              value={datos.formula_molecular}
              onChange={(v) => patch({ formula_molecular: v })}
              placeholder="opcional"
            />
            <Campo label="Pureza / calidad" value={datos.pureza} onChange={(v) => patch({ pureza: v })} />
            <Campo label="Lote (plantilla)" value={datos.lote} onChange={(v) => patch({ lote: v })} placeholder="ej. A2406" />
            <Campo
              label="Vencimiento (plantilla)"
              value={datos.vencimiento}
              onChange={(v) => patch({ vencimiento: v })}
              placeholder="ej. 2027-06"
            />
            <Campo
              label="Código barras"
              value={datos.codigo_barras}
              onChange={(v) => patch({ codigo_barras: v })}
              placeholder={datos.sku || "SKU Code128"}
              hint="Vacío = usa el SKU. Code128 en zona derecha de la etiqueta."
            />
            <div className="sm:col-span-2">
              <Campo label="Notas técnicas / COA" value={datos.notas_tecnicas} onChange={(v) => patch({ notas_tecnicas: v })} multiline />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={datos.incluye_cuchara} onChange={(e) => patch({ incluye_cuchara: e.target.checked })} />
              Incluye cuchara (solo con texto de formulación)
            </label>
            {datos.incluye_cuchara && (
              <div className="sm:col-span-2">
                <Campo label="Texto cuchara" value={datos.texto_cuchara} onChange={(v) => patch({ texto_cuchara: v })} />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={datos.mostrar_lote_vencimiento}
                onChange={(e) => patch({ mostrar_lote_vencimiento: e.target.checked })}
              />
              Mostrar LOT. / EXP. en etiqueta
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={datos.placeholders_lote_vencimiento}
                onChange={(e) => patch({ placeholders_lote_vencimiento: e.target.checked })}
              />
              Rayas si lote/vence vacío
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={datos.mostrar_bloque_legal} onChange={(e) => patch({ mostrar_bloque_legal: e.target.checked })} />
              Bloque legal
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={datos.mostrar_res_2674} onChange={(e) => patch({ mostrar_res_2674: e.target.checked })} />
              Res. 2674 Art. 37-3
            </label>
            <div className="sm:col-span-2">
              <SelectorFormatoEtiqueta
                value={{ nombre: datos.tipo_etiqueta, anchoMm: datos.ancho_mm, altoMm: datos.alto_mm }}
                onChange={(v) =>
                  patch({ tipo_etiqueta: v.nombre, ancho_mm: v.anchoMm, alto_mm: v.altoMm })
                }
              />
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink">Validación normativa</h3>
            <ul className="space-y-1.5">
              {reglas.map((r) => (
                <li key={r.id} className={`rounded-lg border px-3 py-2 text-xs ${claseSeveridad(r.severidad)}`}>
                  {r.mensaje}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="mb-2 text-sm font-bold text-ink">Vista previa en tiempo real</h3>
            <div className="flex justify-center rounded-lg bg-[#e8eaed] p-3">
              <EtiquetaMckennaPreview datos={datos} className="h-auto w-full max-w-[340px] drop-shadow-md" />
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">
              {datos.ancho_mm}×{datos.alto_mm} mm · {datos.tipo_etiqueta}
            </p>
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!datos.sku || guardarMut.isPending}
              onClick={() => guardarMut.mutate(datos)}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Guardar plantilla
            </button>
            <button
              type="button"
              disabled={!puedeExportar || exportarMut.isPending}
              onClick={() => exportarMut.mutate(datos)}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Exportar PDF impresión
            </button>
            <button
              type="button"
              disabled={!puedeExportar || !datos.sku || guardarPub.isPending}
              onClick={() => void aplicarAPublicacion()}
              className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50"
            >
              Aplicar borrador MeLi
            </button>
          </section>
          {exportMsg && <p className="text-xs text-muted">{exportMsg}</p>}
          {meliMsg && <p className="text-xs text-blue-700">{meliMsg}</p>}

          <section className="space-y-2 rounded-xl border border-border bg-surface-panel p-4">
            <h3 className="text-sm font-bold text-ink">Borrador MeLi</h3>
            <p className="text-xs font-semibold text-ink-secondary">Título sugerido</p>
            <p className="rounded bg-surface px-2 py-1 text-xs">{borradorMeli.titulo}</p>
            <p className="text-xs">
              {borradorMeli.domain_id} · {borradorMeli.category_id}
            </p>
            <ul className="list-disc pl-4 text-[10px] text-muted">
              {borradorMeli.checklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-accent">Ver descripción</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-[10px]">
                {borradorMeli.descripcion}
              </pre>
            </details>
          </section>
        </div>
      </div>
      )}
    </div>
  );
}
