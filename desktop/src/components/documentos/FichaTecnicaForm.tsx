import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Field, listaDesdeTexto } from "./DocumentoGeneradorTab";
import { formatearFormulaMolecular } from "../../lib/formulaMolecular";

export type ComposicionFila = { componente: string; valor: string };

export interface FichaTecnicaFormState {
  nombreProducto: string;
  referencia: string;
  sinonimos: string;
  cas: string;
  paisOrigen: string;
  fabricante: string;
  fechaRevision: string;
  descripcion: string;
  apariencia: string;
  puntoFusion: string;
  indiceSaponificacion: string;
  ph: string;
  olor: string;
  sabor: string;
  modoUso: string;
  formulaQuimica: string;
  solubilidad: string;
  propiedadesLista: string;
  aplicaciones: string;
  composicion: ComposicionFila[];
  recomendaciones: string;
  lote: string;
  colorAcento: string;
}

const EMPTY_COMP: ComposicionFila = { componente: "", valor: "" };

function filasIdentidad(datos: Record<string, unknown>): [string, string][] {
  const raw = datos.identidad;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      if (Array.isArray(f) && f.length >= 2) return [String(f[0]), String(f[1])] as [string, string];
      return null;
    })
    .filter(Boolean) as [string, string][];
}

function filasPropiedades(datos: Record<string, unknown>): [string, string][] {
  const raw = datos.propiedades;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      if (Array.isArray(f) && f.length >= 2) return [String(f[0]), String(f[1])] as [string, string];
      return null;
    })
    .filter(Boolean) as [string, string][];
}

function valorEnFilas(filas: [string, string][], ...claves: string[]): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const keys = new Set(claves.map(norm));
  for (const [k, v] of filas) {
    if (keys.has(norm(k)) && v.trim()) return v.trim();
  }
  return "";
}

function fechaParaInput(fecha: string): string {
  const t = fecha.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  const dmy = t.match(/^(\d{2})[\s/.-](\d{2})[\s/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return "";
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseComposicion(datos: Record<string, unknown>, identidad: [string, string][]): ComposicionFila[] {
  const raw = datos.composicion;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((r) => {
      if (Array.isArray(r) && r.length >= 2) {
        return { componente: String(r[0]), valor: String(r[1]) };
      }
      return { ...EMPTY_COMP };
    });
  }
  const comp = identidad.filter(([k]) => /composici/i.test(k));
  if (comp.length) {
    return comp.map(([k, v]) => ({ componente: k, valor: v }));
  }
  return [{ ...EMPTY_COMP }];
}

function IaBtn({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="shrink-0 rounded border border-accent/40 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
    >
      {loading ? "IA…" : label}
    </button>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-accent">
      {children}
    </h4>
  );
}

function IaChips({
  chips,
  value,
  onChange,
  onClear,
}: {
  chips: string[];
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());

  if (!chips.length) return null;

  const toggle = (chip: string) =>
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      next.has(chip) ? next.delete(chip) : next.add(chip);
      return next;
    });

  const insertar = (lista: string[]) => {
    const cur = value.trim();
    const nuevo = lista.join(", ");
    onChange(cur ? `${cur}, ${nuevo}` : nuevo);
    onClear();
  };

  const haySeleccion = seleccionadas.size > 0;

  return (
    <div className="mt-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-accent">
          Selecciona las que apliquen y presiona insertar
        </span>
        <div className="flex items-center gap-2">
          {haySeleccion && (
            <button
              type="button"
              onClick={() => insertar([...seleccionadas])}
              className="rounded bg-accent px-2 py-0.5 text-[10px] font-semibold text-white hover:opacity-80"
            >
              Insertar ({seleccionadas.size})
            </button>
          )}
          <button
            type="button"
            onClick={() => insertar(chips)}
            className="text-[10px] font-semibold text-accent hover:underline"
          >
            Todas
          </button>
          <button type="button" onClick={onClear} className="text-[10px] text-muted hover:text-danger">
            ✕
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.map((chip) => {
          const activa = seleccionadas.has(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => toggle(chip)}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                activa
                  ? "border-accent bg-accent text-white"
                  : "border-accent/40 bg-surface-input/50 text-ink hover:border-accent hover:bg-accent/10"
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function datosDesdeFormulario(state: FichaTecnicaFormState): Record<string, unknown> {
  return {
    titulo: state.nombreProducto.toUpperCase(),
    nombre_producto: state.nombreProducto,
    referencia: state.referencia,
    sinonimos: state.sinonimos,
    cas: state.cas,
    pais_origen: state.paisOrigen,
    fabricante: state.fabricante,
    fecha_revision: state.fechaRevision,
    descripcion: state.descripcion,
    caracteristicas_fisicas: {
      apariencia: state.apariencia,
      punto_fusion: state.puntoFusion,
      indice_saponificacion: state.indiceSaponificacion,
      ph: state.ph,
      olor: state.olor,
      sabor: state.sabor,
      formula_quimica: state.formulaQuimica,
      solubilidad: state.solubilidad,
    },
    modo_uso: state.modoUso,
    propiedades_lista: listaDesdeTexto(state.propiedadesLista),
    aplicaciones: listaDesdeTexto(state.aplicaciones),
    composicion: state.composicion
      .filter((r) => r.componente.trim() || r.valor.trim())
      .map((r) => [r.componente.trim(), r.valor.trim()]),
    recomendaciones: state.recomendaciones,
    lote: state.lote,
    color_acento: state.colorAcento,
  };
}

export function formularioDesdeDatos(datos: Record<string, unknown>): FichaTecnicaFormState {
  const identidad = filasIdentidad(datos);
  const props = filasPropiedades(datos);
  const cf = (datos.caracteristicas_fisicas || {}) as Record<string, string>;

  const nombre =
    String(datos.nombre_producto || datos.titulo || "") ||
    valorEnFilas(identidad, "nombre del producto");

  const fisicasKeys = new Set([
    "apariencia", "punto de fusion", "indice de saponificacion", "ph", "olor",
    "formula quimica", "solubilidad", "humedad", "inercia quimica",
  ]);
  const extraProps = props
    .filter(([k]) => !fisicasKeys.has(k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
    .map(([k, v]) => (v ? `${k}|${v}` : k))
    .join("\n");

  const propsLista = datos.propiedades_lista;
  let propiedadesLista = extraProps;
  if (Array.isArray(propsLista)) {
    propiedadesLista = propsLista.map((p) => String(p)).join("\n");
  } else if (typeof propsLista === "string" && propsLista.trim()) {
    propiedadesLista = propsLista;
  }

  const flat = (k: string, ...alts: string[]) => {
    for (const key of [k, ...alts]) {
      const v = datos[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  return {
    nombreProducto: nombre,
    referencia: String(datos.referencia || "") || valorEnFilas(identidad, "referencia siigo", "referencia"),
    sinonimos: flat("sinonimos", "synonyms") || valorEnFilas(identidad, "sinonimos", "sinonimo", "synonyms"),
    cas: String(datos.cas || "") || valorEnFilas(identidad, "cas", "cas #", "cas number"),
    paisOrigen:
      flat("pais_origen", "country_of_origin", "origin") ||
      valorEnFilas(identidad, "pais de origen", "pais origen", "origen", "country of origin"),
    fabricante:
      flat("fabricante", "manufacturer", "supplier") ||
      valorEnFilas(identidad, "fabricante", "fabricante proveedor", "manufacturer"),
    fechaRevision:
      fechaParaInput(String(datos.fecha_revision || datos.revision_date || "")) ||
      fechaParaInput(valorEnFilas(identidad, "fecha de revision", "revision date")) ||
      hoyIso(),
    descripcion: flat("descripcion", "description"),
    apariencia:
      flat("apariencia", "appearance") ||
      cf.apariencia ||
      valorEnFilas(props, "apariencia", "appearance"),
    puntoFusion:
      flat("punto_fusion", "melting_point", "melting point") ||
      cf.punto_fusion ||
      valorEnFilas(props, "punto de fusion", "punto fusion", "melting point"),
    indiceSaponificacion:
      flat("indice_saponificacion", "saponification_value") ||
      cf.indice_saponificacion ||
      valorEnFilas(props, "indice de saponificacion", "indice saponificacion", "saponification value"),
    ph: flat("ph") || cf.ph || valorEnFilas(props, "ph"),
    olor: flat("olor", "odour", "odor") || cf.olor || valorEnFilas(props, "olor", "odour", "odor"),
    sabor: flat("sabor", "taste") || cf.sabor || valorEnFilas(props, "sabor", "taste"),
    modoUso:
      flat("modo_uso", "usage", "directions", "incorporation") ||
      valorEnFilas(props, "modo de uso", "modo uso", "usage"),
    formulaQuimica: formatearFormulaMolecular(
      flat("formula_quimica", "molecular_formula", "formula") ||
      cf.formula_quimica ||
      valorEnFilas(props, "formula quimica", "formula", "molecular formula"),
    ),
    solubilidad:
      flat("solubilidad", "solubility") ||
      cf.solubilidad ||
      valorEnFilas(props, "solubilidad", "solubility"),
    propiedadesLista: propiedadesLista,
    aplicaciones: Array.isArray(datos.aplicaciones)
      ? (datos.aplicaciones as string[]).join("\n\n")
      : flat("aplicaciones", "applications", "uses"),
    composicion: parseComposicion(datos, identidad),
    recomendaciones: flat("recomendaciones", "recommendations", "storage"),
    lote: flat("lote", "lot", "batch"),
    colorAcento: String(datos.color_acento || "#069DC2"),
  };
}

export default function FichaTecnicaForm({
  productoRef,
  productoNombre,
  onBuildDatos,
  onLoadDatos,
  hideIdentificacion,
  externalNombreProducto,
  externalCas,
  externalReferencia,
  hideColorAcento,
  externalColorAcento,
  hideRecomendaciones = true,
  onAutoCompletarRef,
}: {
  productoRef?: string;
  productoNombre?: string;
  onBuildDatos: (build: () => Record<string, unknown>) => void;
  onLoadDatos: (load: (datos: Record<string, unknown>) => void) => void;
  hideIdentificacion?: boolean;
  externalNombreProducto?: string;
  externalCas?: string;
  externalReferencia?: string;
  hideColorAcento?: boolean;
  externalColorAcento?: string;
  hideRecomendaciones?: boolean;
  onAutoCompletarRef?: (fn: (resultados: Record<string, string>) => void) => void;
}) {
  const [state, setState] = useState<FichaTecnicaFormState>(() => ({
    ...formularioDesdeDatos({}),
    fechaRevision: hoyIso(),
  }));

  const patch = useCallback((p: Partial<FichaTecnicaFormState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const build = useCallback(() => {
    const datos = datosDesdeFormulario(state);
    if (hideRecomendaciones) {
      datos.recomendaciones = "";
    }
    return datos;
  }, [state, hideRecomendaciones]);

  useEffect(() => {
    onBuildDatos(() => build());
  }, [build, onBuildDatos]);

  // Registrar loader en layout (antes del paint) para que el escáner no llame un no-op
  useLayoutEffect(() => {
    onLoadDatos((datos) => {
      setState((prev) => {
        const next = formularioDesdeDatos(datos);
        const merged: FichaTecnicaFormState = { ...prev };
        (Object.keys(next) as (keyof FichaTecnicaFormState)[]).forEach((k) => {
          const v = next[k];
          if (typeof v === "string") {
            if (v.trim()) (merged as unknown as Record<string, unknown>)[k] = v;
          } else if (k === "composicion" && Array.isArray(v)) {
            const rows = v as ComposicionFila[];
            if (rows.some((r) => r.componente.trim() || r.valor.trim())) merged.composicion = rows;
          }
        });
        return merged;
      });
    });
  }, [onLoadDatos]);

  const autoCompletar = useCallback((resultados: Record<string, string>) => {
    const updates: Partial<FichaTecnicaFormState> = {};
    for (const [campo, v] of Object.entries(resultados)) {
      if (!v || !String(v).trim()) continue;
      const val = String(v).trim();
      switch (campo) {
        case "sinonimos":
        case "synonyms":
          updates.sinonimos = val; break;
        case "cas":
          updates.cas = val; break;
        case "pais_origen":
        case "country_of_origin":
          updates.paisOrigen = val; break;
        case "fabricante":
        case "manufacturer":
        case "supplier":
          updates.fabricante = val; break;
        case "descripcion":
        case "description":
          updates.descripcion = val; break;
        case "apariencia":
        case "appearance":
          updates.apariencia = val; break;
        case "punto_fusion":
        case "melting_point":
          updates.puntoFusion = val; break;
        case "indice_saponificacion":
          updates.indiceSaponificacion = val; break;
        case "ph":
          updates.ph = val; break;
        case "olor":
        case "odour":
        case "odor":
          updates.olor = val; break;
        case "sabor":
        case "taste":
          updates.sabor = val; break;
        case "formula_quimica":
        case "molecular_formula":
        case "formula":
          updates.formulaQuimica = formatearFormulaMolecular(val); break;
        case "solubilidad":
        case "solubility":
          updates.solubilidad = val; break;
        case "modo_uso":
        case "usage":
        case "directions":
          updates.modoUso = val; break;
        case "propiedades_lista":
        case "properties":
          updates.propiedadesLista = val; break;
        case "aplicaciones":
        case "applications":
        case "uses":
          updates.aplicaciones = val; break;
        case "recomendaciones":
        case "recommendations":
          updates.recomendaciones = val; break;
        case "nombre_producto":
        case "product_name":
        case "titulo":
          updates.nombreProducto = val; break;
        case "lote":
        case "lot":
        case "batch":
          updates.lote = val; break;
      }
    }
    if (Object.keys(updates).length) patch(updates);
  }, [patch]);

  useLayoutEffect(() => {
    onAutoCompletarRef?.(autoCompletar);
  }, [autoCompletar, onAutoCompletarRef]);

  useEffect(() => {
    if (productoRef) patch({ referencia: productoRef });
  }, [productoRef, patch]);

  useEffect(() => {
    if (productoNombre) patch({ nombreProducto: productoNombre });
  }, [productoNombre, patch]);

  // Solo sincronizar externos cuando traen valor ("" no debe borrar lo escaneado)
  useEffect(() => {
    if (hideIdentificacion && externalNombreProducto)
      patch({ nombreProducto: externalNombreProducto });
  }, [hideIdentificacion, externalNombreProducto, patch]);

  useEffect(() => {
    if (hideIdentificacion && externalCas)
      patch({ cas: externalCas });
  }, [hideIdentificacion, externalCas, patch]);

  useEffect(() => {
    if (hideIdentificacion && externalReferencia)
      patch({ referencia: externalReferencia });
  }, [hideIdentificacion, externalReferencia, patch]);

  useEffect(() => {
    if (hideColorAcento && externalColorAcento)
      patch({ colorAcento: externalColorAcento });
  }, [hideColorAcento, externalColorAcento, patch]);

  const sugerirMut = useMutation({
    mutationFn: (campo: string) => {
      const nombre = state.nombreProducto.trim();
      if (!nombre) throw new Error("Indique el nombre del producto primero");
      return api.post<{ valor: string }>("/api/fichas/sugerir-campo", { campo, nombre }, { timeoutMs: 180000 });
    },
    onSuccess: (r, campo) => {
      const v = r.valor || "";
      const parseChips = (raw: string) =>
        raw.split(",").map((s) => s.trim()).filter(Boolean);
      switch (campo) {
        case "sinonimos":            patch({ sinonimos: v }); break;
        case "cas":                  patch({ cas: v }); break;
        case "descripcion":          patch({ descripcion: v }); break;
        case "apariencia":           patch({ apariencia: v }); break;
        case "punto_fusion":         patch({ puntoFusion: v }); break;
        case "indice_saponificacion":patch({ indiceSaponificacion: v }); break;
        case "ph":                   patch({ ph: v }); break;
        case "olor":                 patch({ olor: v }); break;
        case "sabor":                patch({ sabor: v }); break;
        case "formula_quimica":      patch({ formulaQuimica: formatearFormulaMolecular(v) }); break;
        case "solubilidad":          patch({ solubilidad: v }); break;
        case "modo_uso":             patch({ modoUso: v }); break;
        case "propiedades_lista":    patch({ propiedadesLista: v }); break;
        case "aplicaciones":         patch({ aplicaciones: v }); break;
        case "recomendaciones":      patch({ recomendaciones: v }); break;
        case "composicion": {
          const rows = v.split("\n").filter(Boolean).map((line) => {
            const [comp, val] = line.split("|");
            return { componente: (comp || "").trim(), valor: (val || "").trim() };
          });
          if (rows.length) patch({ composicion: rows });
          break;
        }
      }
    },
  });

  const ia = (campo: string) => ({
    loading: sugerirMut.isPending && sugerirMut.variables === campo,
    onClick: () => sugerirMut.mutate(campo),
  });

  const updateComp = (idx: number, field: keyof ComposicionFila, value: string) => {
    setState((s) => {
      const composicion = [...s.composicion];
      composicion[idx] = { ...composicion[idx], [field]: value };
      return { ...s, composicion };
    });
  };

  const addComp = () => setState((s) => ({ ...s, composicion: [...s.composicion, { ...EMPTY_COMP }] }));

  const removeComp = (idx: number) =>
    setState((s) => ({
      ...s,
      composicion: s.composicion.length > 1 ? s.composicion.filter((_, i) => i !== idx) : [{ ...EMPTY_COMP }],
    }));

  return (
    <div className="space-y-6">
      {!hideIdentificacion && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
          <h3 className="text-sm font-bold tracking-widest text-ink">FICHA TÉCNICA</h3>
        </div>
      )}

      <section className="space-y-3">
        {!hideIdentificacion && <SectionTitle>Identificación</SectionTitle>}

        {sugerirMut.isError && (
          <p className="rounded border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger">
            IA: {(sugerirMut.error as Error).message}
          </p>
        )}

        {!hideIdentificacion && (
          <Field
            label="Nombre del producto"
            value={state.nombreProducto}
            onChange={(v) => patch({ nombreProducto: v })}
            placeholder="Ej. Arcilla roja"
          />
        )}

        <Field
          label="Sinónimos"
          value={state.sinonimos}
          onChange={(v) => patch({ sinonimos: v })}
          rows={2}
          placeholder="Nombres alternativos, INCI, comerciales…"
          actions={<IaBtn label="IA" {...ia("sinonimos")} />}
        />

        <div className={`grid gap-3 ${hideIdentificacion ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          {!hideIdentificacion && (
            <Field
              label="Número CAS"
              value={state.cas}
              onChange={(v) => patch({ cas: v })}
              placeholder="0000-00-0"
              mono
              actions={<IaBtn label="IA" {...ia("cas")} />}
            />
          )}
          <Field
            label="Fecha de revisión"
            type="date"
            value={state.fechaRevision}
            onChange={(v) => patch({ fechaRevision: v })}
          />
          <Field
            label="Lote (vacío = línea en blanco)"
            value={state.lote}
            onChange={(v) => patch({ lote: v })}
            placeholder="Ej. LT-2025-001"
            mono
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="País de origen"
            value={state.paisOrigen}
            onChange={(v) => patch({ paisOrigen: v })}
            placeholder="Ej. Colombia, China, India…"
          />
          <Field
            label="Fabricante"
            value={state.fabricante}
            onChange={(v) => patch({ fabricante: v })}
            placeholder="Nombre del fabricante o proveedor"
          />
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle>Descripción</SectionTitle>
        <Field
          label="Descripción"
          value={state.descripcion}
          onChange={(v) => patch({ descripcion: v })}
          rows={5}
          placeholder="Origen, modo de obtención, proceso, usos generales…"
          actions={<IaBtn label="IA" {...ia("descripcion")} />}
        />
      </section>

      <section className="space-y-3">
        <SectionTitle>Características físicas</SectionTitle>

        <Field
          label="Apariencia"
          value={state.apariencia}
          onChange={(v) => patch({ apariencia: v })}
          placeholder="Ej. Polvo blanco fino cristalino"
          actions={<IaBtn label="IA" {...ia("apariencia")} />}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Olor"
            value={state.olor}
            onChange={(v) => patch({ olor: v })}
            placeholder="Ej. Inodoro o ligero aroma"
            actions={<IaBtn label="IA" {...ia("olor")} />}
          />
          <Field
            label="Sabor"
            value={state.sabor}
            onChange={(v) => patch({ sabor: v })}
            placeholder="Ej. Insípido, dulce, amargo…"
            actions={<IaBtn label="IA" {...ia("sabor")} />}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Punto de fusión",           campo: "punto_fusion",          val: state.puntoFusion,           set: (v: string) => patch({ puntoFusion: v }),           ph: "Ej. 58-62 °C", formula: false },
            { label: "Índice de saponificación",  campo: "indice_saponificacion", val: state.indiceSaponificacion,  set: (v: string) => patch({ indiceSaponificacion: v }),  ph: "Ej. 190-200 mg KOH/g", formula: false },
            { label: "pH",                        campo: "ph",                    val: state.ph,                    set: (v: string) => patch({ ph: v }),                    ph: "Ej. 4.5-6.0", formula: false },
            { label: "Fórmula química",           campo: "formula_quimica",       val: state.formulaQuimica,        set: (v: string) => patch({ formulaQuimica: v }),        ph: "Ej. C₆H₁₂O₆", formula: true },
            { label: "Solubilidad",               campo: "solubilidad",           val: state.solubilidad,           set: (v: string) => patch({ solubilidad: v }),           ph: "Ej. Soluble en agua fría", formula: false },
          ].map(({ label, campo, val, set, ph: placeholder, formula }) => (
            <Field
              key={campo}
              label={label}
              value={val}
              onChange={set}
              placeholder={placeholder}
              formula={formula}
              actions={<IaBtn label="IA" {...ia(campo)} />}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle>Beneficios</SectionTitle>
        <Field
          label="Beneficios"
          value={state.propiedadesLista}
          onChange={(v) => patch({ propiedadesLista: v })}
          rows={4}
          placeholder="Una propiedad por línea. Formato: Nombre|Valor (ej. Densidad|0.85 g/cm³)"
          actions={<IaBtn label="IA" {...ia("propiedades_lista")} />}
        />
      </section>

      <section className="space-y-2">
        <SectionTitle>Aplicaciones</SectionTitle>
        <Field
          label="Aplicaciones"
          value={state.aplicaciones}
          onChange={(v) => patch({ aplicaciones: v })}
          rows={4}
          placeholder="Una aplicación por línea"
          actions={<IaBtn label="IA" {...ia("aplicaciones")} />}
        />
      </section>

      <section className="space-y-2">
        <Field
          label="Modo de uso"
          value={state.modoUso}
          onChange={(v) => patch({ modoUso: v })}
          rows={3}
          placeholder="Concentración típica, forma de incorporación, temperatura, orden de adición…"
          actions={<IaBtn label="IA" {...ia("modo_uso")} />}
        />
      </section>

      {!hideRecomendaciones && (
        <section className="space-y-2">
          <Field
            label="Recomendaciones GHS"
            value={state.recomendaciones}
            onChange={(v) => patch({ recomendaciones: v })}
            rows={6}
            placeholder={"Una recomendación por línea. Ej:\nPREVENCIÓN: Evitar inhalar polvo. Usar EPP adecuado.\nRESPUESTA: En caso de contacto ocular, lavar con agua abundante.\nALMACENAMIENTO: Mantener en lugar seco y bien ventilado."}
            actions={<IaBtn label="IA" {...ia("recomendaciones")} />}
          />
        </section>
      )}
      {!hideColorAcento && (
        <section className="space-y-3">
          <SectionTitle>Color del formato</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {[
              { hex: "#069DC2", nombre: "Azul McKenna" },
              { hex: "#003DA5", nombre: "Azul marino" },
              { hex: "#5CB85C", nombre: "Verde claro" },
              { hex: "#37474F", nombre: "Gris antracita" },
              { hex: "#6A1B9A", nombre: "Morado" },
              { hex: "#B71C1C", nombre: "Rojo" },
              { hex: "#FFA040", nombre: "Naranja claro" },
              { hex: "#000000", nombre: "Negro" },
            ].map(({ hex, nombre }) => (
              <button
                key={hex}
                type="button"
                title={nombre}
                onClick={() => patch({ colorAcento: hex })}
                className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: hex,
                  borderColor: state.colorAcento === hex ? "#fff" : hex,
                  outline: state.colorAcento === hex ? `2px solid ${hex}` : "none",
                }}
              />
            ))}
            <input
              type="color"
              value={state.colorAcento}
              onChange={(e) => patch({ colorAcento: e.target.value })}
              title="Color personalizado"
              className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent p-0"
            />
          </div>
          <p className="text-[10px] text-muted">Selecciona una paleta o usa el selector para un color personalizado.</p>
        </section>
      )}

    </div>
  );
}
