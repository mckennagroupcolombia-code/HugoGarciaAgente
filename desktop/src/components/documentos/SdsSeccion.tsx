/**
 * Sección 3 del formulario FT + COA + SDS: la hoja de seguridad en el esquema 2
 * (app/services/sds_estructura.py). Cada dato una vez:
 *  - Peligros estructurados: palabra de advertencia, pictogramas, frases H y P
 *    (antes eran tres textos libres que se repetían y a veces se contradecían).
 *  - Lo que ya dice la FT (conservación general, apariencia, olor, solubilidad)
 *    no se escribe aquí: el documento remite. La composición va solo en el COA:
 *    la SDS no lleva sección 3.
 *  - Primeros auxilios no tiene casilla: son las frases P de respuesta (P3xx).
 *
 * La SDS se sugiere sola con IA según el título la primera vez que la sección
 * aparece vacía; lo sugerido queda pendiente de visto bueno y el documento
 * final no se genera sin él (lo exige también el backend).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Field } from "./DocumentoGeneradorTab";
import ghs01 from "../../assets/ghs/GHS01.svg";
import ghs02 from "../../assets/ghs/GHS02.svg";
import ghs03 from "../../assets/ghs/GHS03.svg";
import ghs04 from "../../assets/ghs/GHS04.svg";
import ghs05 from "../../assets/ghs/GHS05.svg";
import ghs06 from "../../assets/ghs/GHS06.svg";
import ghs07 from "../../assets/ghs/GHS07.svg";
import ghs08 from "../../assets/ghs/GHS08.svg";
import ghs09 from "../../assets/ghs/GHS09.svg";

/** Nombres oficiales en español (igual que PICTOGRAMAS_GHS en sds_estructura.py). */
export const PICTOGRAMAS: { codigo: string; nombre: string; src: string }[] = [
  { codigo: "GHS01", nombre: "Bomba explotando", src: ghs01 },
  { codigo: "GHS02", nombre: "Llama", src: ghs02 },
  { codigo: "GHS03", nombre: "Llama sobre círculo", src: ghs03 },
  { codigo: "GHS04", nombre: "Bombona de gas", src: ghs04 },
  { codigo: "GHS05", nombre: "Corrosión", src: ghs05 },
  { codigo: "GHS06", nombre: "Calavera y tibias", src: ghs06 },
  { codigo: "GHS07", nombre: "Signo de exclamación", src: ghs07 },
  { codigo: "GHS08", nombre: "Peligro para la salud", src: ghs08 },
  { codigo: "GHS09", nombre: "Medio ambiente", src: ghs09 },
];

export type Senal = "" | "Peligro" | "Atención";

export type SdsForm = {
  usos: string;
  telefono: string;
  clasificacion: string;
  senal: Senal;
  pictogramas: string[];
  frasesH: string;
  frasesP: string;
  incendios: string;
  vertidos: string;
  almacenamiento: string;
  exposicion: string;
  /** Una por línea: «Punto de inflamación|Mayor de 100 °C». */
  propiedades: string;
  estabilidad: string;
  toxicologia: string;
  ecologia: string;
  eliminacion: string;
  transporte: string;
  normativa: string;
  otraInfo: string;
  sugeridaIa: boolean;
  vistoBueno: { por: string; en: string } | null;
};

export const SDS_VACIA: SdsForm = {
  usos: "", telefono: "", clasificacion: "", senal: "", pictogramas: [], frasesH: "", frasesP: "",
  incendios: "", vertidos: "", almacenamiento: "", exposicion: "", propiedades: "", estabilidad: "",
  toxicologia: "", ecologia: "", eliminacion: "", transporte: "", normativa: "", otraInfo: "",
  sugeridaIa: false, vistoBueno: null,
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const txt = (v: unknown): string => (v == null ? "" : Array.isArray(v) ? v.map(txt).filter(Boolean).join("\n") : String(v).trim());
const lineas = (t: string): string[] => t.split("\n").map((l) => l.trim()).filter(Boolean);

function filasPropiedades(v: unknown): string {
  if (!Array.isArray(v)) return txt(v);
  return v
    .map((f) => (Array.isArray(f) ? `${txt(f[0])}|${txt(f[1])}` : txt(f)))
    .filter((l) => l.replace("|", "").trim())
    .join("\n");
}

/** SDS ya normalizada al esquema 2 (POST /api/fichas/sds/normalizar) → formulario. */
export function sdsDesdeDatos(sds: Obj | null | undefined): SdsForm {
  if (!sds) return { ...SDS_VACIA };
  const ident = obj(sds.identificacion);
  const pel = obj(sds.peligros);
  const man = obj(sds.manipulacion);
  const reg = obj(sds.regulatorio);
  const senal = txt(pel.senal);
  const vb = obj(sds.visto_bueno);
  return {
    usos: txt(ident.usos),
    telefono: txt(ident.telefono_emergencia),
    clasificacion: txt(pel.clasificacion),
    senal: senal === "Peligro" || senal === "Atención" ? senal : "",
    pictogramas: Array.isArray(pel.pictogramas_ghs) ? pel.pictogramas_ghs.map(String) : [],
    frasesH: txt(pel.frases_h),
    frasesP: txt(pel.frases_p),
    incendios: txt(sds.incendios),
    vertidos: txt(sds.vertidos),
    almacenamiento: txt(man.almacenamiento),
    exposicion: txt(sds.exposicion),
    propiedades: filasPropiedades(sds.propiedades),
    estabilidad: txt(sds.estabilidad),
    toxicologia: txt(sds.toxicologia),
    ecologia: txt(sds.ecologia),
    eliminacion: txt(sds.eliminacion),
    transporte: txt(sds.transporte),
    normativa: txt(reg.normativa),
    otraInfo: txt(sds.otra_info),
    sugeridaIa: Boolean(sds.sugerida_ia),
    vistoBueno: vb.en ? { por: txt(vb.por), en: txt(vb.en) } : null,
  };
}

/** Formulario → `_sds` a guardar. Las claves en `null` retiran el formato anterior
 *  (el backend fusiona con lo guardado y borra lo que llega en null). */
export function sdsAPayload(
  f: SdsForm,
  base: { titulo: string; identificacion: Obj },
): Obj {
  return {
    titulo: base.titulo,
    esquema: 2,
    identificacion: { ...base.identificacion, usos: f.usos, telefono_emergencia: f.telefono },
    peligros: {
      clasificacion: f.clasificacion,
      senal: f.senal,
      pictogramas_ghs: f.pictogramas,
      frases_h: lineas(f.frasesH),
      frases_p: lineas(f.frasesP),
      pictogramas: null,
      recomendaciones: null,
    },
    recomendaciones: null,
    // La composición se diligencia y se imprime en el COA.
    composicion: null,
    incendios: f.incendios,
    vertidos: f.vertidos,
    manipulacion: { almacenamiento: f.almacenamiento, recomendaciones: null },
    exposicion: f.exposicion,
    propiedades: lineas(f.propiedades).map((l) => {
      const [a, ...b] = l.split("|");
      return [a.trim(), b.join("|").trim()];
    }),
    estabilidad: f.estabilidad,
    toxicologia: f.toxicologia,
    ecologia: f.ecologia,
    eliminacion: f.eliminacion,
    transporte: f.transporte,
    regulatorio: { normativa: f.normativa },
    otra_info: f.otraInfo,
    sugerida_ia: f.sugeridaIa,
    visto_bueno: f.vistoBueno,
  };
}

const CAMPOS_TEXTO = [
  "clasificacion", "frasesH", "frasesP", "incendios", "vertidos", "almacenamiento", "exposicion",
  "propiedades", "estabilidad", "toxicologia", "ecologia", "eliminacion", "transporte", "normativa",
] as const;

export function sdsEstaVacia(f: SdsForm): boolean {
  return !f.senal && !f.pictogramas.length && CAMPOS_TEXTO.every((k) => !f[k].trim());
}

/** Sugerencia (esquema 2) sobre el formulario: solo llena lo vacío. */
function aplicarSugerencia(f: SdsForm, sug: Obj): SdsForm {
  const s = sdsDesdeDatos(sug);
  const out: SdsForm = { ...f };
  for (const k of [...CAMPOS_TEXTO, "usos"] as const) {
    if (!out[k].trim() && s[k].trim()) out[k] = s[k];
  }
  if (!out.senal && s.senal) out.senal = s.senal;
  if (!out.pictogramas.length && s.pictogramas.length) out.pictogramas = s.pictogramas;
  out.sugeridaIa = true;
  out.vistoBueno = null;
  return out;
}

export type ContextoFt = { conservacion: string; propiedades: [string, string][] };

/** Secciones 5–16: texto libre, una línea plegable cada una. */
const SECCIONES_TEXTO: { n: string; titulo: string; clave: "incendios" | "vertidos" | "almacenamiento" | "exposicion" | "propiedades" | "estabilidad" | "toxicologia" | "ecologia" | "eliminacion" | "transporte" | "normativa" | "otraInfo"; ayuda?: string; mono?: boolean }[] = [
  { n: "5", titulo: "Lucha contra incendios", clave: "incendios" },
  { n: "6", titulo: "Vertido accidental", clave: "vertidos" },
  { n: "7", titulo: "Almacenamiento seguro", clave: "almacenamiento", ayuda: "Solo lo que la FT no dice: incompatibilidades, materiales a evitar…" },
  { n: "8", titulo: "Exposición y EPP", clave: "exposicion" },
  { n: "9", titulo: "Propiedades de seguridad", clave: "propiedades", mono: true, ayuda: "Propiedad|valor por línea · Punto de inflamación|Mayor de 100 °C" },
  { n: "10", titulo: "Estabilidad y reactividad", clave: "estabilidad" },
  { n: "11", titulo: "Toxicología", clave: "toxicologia" },
  { n: "12", titulo: "Ecología", clave: "ecologia" },
  { n: "13", titulo: "Eliminación", clave: "eliminacion" },
  { n: "14", titulo: "Transporte", clave: "transporte" },
  { n: "15", titulo: "Normativa", clave: "normativa" },
  { n: "16", titulo: "Otra información", clave: "otraInfo" },
];

/** Una sección en una línea (número · título · lo que dice o «vacía»); se abre al tocarla. */
function SeccionPlegable({ n, titulo, valor, children }: { n?: string; titulo: string; valor: string; children: ReactNode }) {
  const resumen = valor.replace(/\s+/g, " ").trim();
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs hover:bg-surface-input/60">
        {n && <span className="w-5 shrink-0 text-right font-mono text-[10px] font-bold text-accent">{n}</span>}
        <span className="shrink-0 font-medium">{titulo}</span>
        <span className={`min-w-0 flex-1 truncate ${resumen ? "text-muted" : "italic text-muted/60"}`}>{resumen || "vacía"}</span>
        <span className="shrink-0 text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

export default function SdsSeccion({
  value,
  onChange,
  nombre,
  identificacion,
  obtenerFt,
  avisos,
  cargando = false,
}: {
  value: SdsForm;
  onChange: (f: SdsForm) => void;
  nombre: string;
  identificacion: { cas: string; inci: string };
  /** Lo que la FT ya dice: se muestra como referencia y se pasa a la IA para no repetirlo. */
  obtenerFt: () => ContextoFt;
  /** Lo que no cuadraba al convertir la hoja del formato anterior. */
  avisos: string[];
  /** Se está convirtiendo una hoja guardada: no sugerir aunque se vea vacía. */
  cargando?: boolean;
}) {
  const set = <K extends keyof SdsForm>(k: K, v: SdsForm[K]) => onChange({ ...value, [k]: v });
  const valueRef = useRef(value);
  valueRef.current = value;
  const vacia = sdsEstaVacia(value);
  const titulo = nombre.trim();

  const sugerirMut = useMutation({
    mutationFn: async () => {
      if (!titulo) throw new Error("Escriba primero el nombre del producto");
      const r = await api.post<{ sds?: Obj; error?: string }>(
        "/api/fichas/sds/sugerir",
        { titulo, ft: obtenerFt(), identificacion },
        { timeoutMs: 180000 },
      );
      if (r.error || !r.sds) throw new Error(r.error || "La IA no devolvió la hoja de seguridad");
      return r.sds;
    },
    // Sobre el valor actual, no el del momento del clic: la IA tarda y se puede seguir escribiendo.
    onSuccess: (sug) => onChange(aplicarSugerencia(valueRef.current, sug)),
  });

  /* Si se vacía todo, ya no hay sugerencia que aprobar. */
  useEffect(() => {
    if (!cargando && vacia && (value.sugeridaIa || value.vistoBueno)) onChange({ ...value, sugeridaIa: false, vistoBueno: null });
  }, [vacia]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Se sugiere sola cuando la sección aparece en pantalla vacía y con título.
   * Una vez por título: si la IA falla o se borra lo sugerido, queda el botón. */
  const raizRef = useRef<HTMLDivElement | null>(null);
  const autoTitulo = useRef("");
  const mutarRef = useRef(sugerirMut.mutate);
  mutarRef.current = sugerirMut.mutate;
  useEffect(() => {
    const el = raizRef.current;
    if (!el || !titulo || !vacia || cargando || autoTitulo.current === titulo) return;
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || autoTitulo.current === titulo) return;
      autoTitulo.current = titulo;
      obs.disconnect();
      mutarRef.current();
    }, { threshold: 0.2 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [titulo, vacia, cargando]);

  const darVistoBueno = async () => {
    const { useTicketsAuth } = await import("../../stores/ticketsAuth");
    const u = useTicketsAuth.getState().user;
    onChange({
      ...valueRef.current,
      vistoBueno: { por: (u?.nombre || u?.username || "").trim() || "Usuario del panel", en: new Date().toISOString() },
    });
  };

  const ft = obtenerFt();
  const togglePicto = (codigo: string) =>
    set(
      "pictogramas",
      value.pictogramas.includes(codigo)
        ? value.pictogramas.filter((c) => c !== codigo)
        : PICTOGRAMAS.map((p) => p.codigo).filter((c) => c === codigo || value.pictogramas.includes(c)),
    );
  const sinPeligro = !value.senal && !value.pictogramas.length && !value.frasesH.trim();
  const hayRespuesta = lineas(value.frasesP).some((l) => /^P3\d\d/i.test(l) || /^respuesta\s*:/i.test(l));


  return (
    <div ref={raizRef} id="sds-seccion" className="space-y-4">
      {/* ── Estado de la sugerencia / visto bueno ── */}
      {cargando ? (
        <div className="rounded-lg border border-border p-3 text-xs text-muted">Cargando la hoja de seguridad…</div>
      ) : sugerirMut.isPending ? (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-muted">
          Sugiriendo la hoja de seguridad para «{titulo}»…
        </div>
      ) : vacia ? (
        <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs text-muted">
            La hoja de seguridad se sugiere a partir del título del producto: peligros, pictogramas, frases H y P y
            las secciones 5 a 15. Queda pendiente hasta que alguien le dé el visto bueno.
          </p>
          {sugerirMut.isError && <p className="text-xs text-danger">{(sugerirMut.error as Error).message}</p>}
          <button
            type="button"
            onClick={() => sugerirMut.mutate()}
            disabled={!titulo}
            className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {titulo ? `Sugerir SDS para «${titulo}»` : "Escriba primero el nombre del producto"}
          </button>
        </div>
      ) : value.sugeridaIa && !value.vistoBueno ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
          <p className="text-xs text-warning">
            <b>Sugerencia de IA según el título — pendiente de visto bueno.</b> Revise cada casilla. El documento final
            no se genera hasta darle el visto bueno; la vista previa sale como borrador.
          </p>
          <button
            type="button"
            onClick={() => void darVistoBueno()}
            className="rounded border border-success/60 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/20"
          >
            ✓ Dar visto bueno
          </button>
        </div>
      ) : value.vistoBueno ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/10 p-3">
          <p className="text-xs text-success">
            ✓ Visto bueno de <b>{value.vistoBueno.por}</b> ·{" "}
            {new Date(value.vistoBueno.en).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <button type="button" onClick={() => set("vistoBueno", null)} className="text-[11px] font-medium text-muted hover:text-danger">
            Quitar visto bueno
          </button>
        </div>
      ) : null}

      {!vacia && !sugerirMut.isPending && (
        <button
          type="button"
          onClick={() => sugerirMut.mutate()}
          className="text-[11px] font-medium text-accent hover:underline"
          title="Pide a la IA solo las casillas que siguen vacías"
        >
          Completar con IA las casillas vacías
        </button>
      )}

      {avisos.length > 0 && (
        <details className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-warning">
            Esta hoja venía en el formato anterior: {avisos.length} punto(s) para revisar
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}

      {/* ── Peligros: lo único que va siempre a la vista ── */}
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-xs font-semibold">Peligros</span>
          <div className="flex gap-1.5" role="group" aria-label="Palabra de advertencia">
            {(["", "Atención", "Peligro"] as Senal[]).map((s) => (
              <button
                key={s || "ninguna"}
                type="button"
                onClick={() => set("senal", s)}
                className={`rounded border px-2.5 py-0.5 text-[11px] font-semibold ${
                  value.senal === s
                    ? s === "Peligro"
                      ? "border-danger bg-danger/15 text-danger"
                      : s === "Atención"
                        ? "border-warning bg-warning/15 text-warning"
                        : "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted hover:bg-surface-input"
                }`}
              >
                {s ? s.toUpperCase() : "Sin palabra de advertencia"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Pictogramas">
            {PICTOGRAMAS.map((p) => {
              const activo = value.pictogramas.includes(p.codigo);
              return (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => togglePicto(p.codigo)}
                  title={`${p.codigo} · ${p.nombre}`}
                  aria-label={`${p.codigo} ${p.nombre}`}
                  aria-pressed={activo}
                  className={`rounded p-0.5 ${activo ? "bg-danger/10 ring-2 ring-danger" : "opacity-30 grayscale hover:opacity-70"}`}
                >
                  <img src={p.src} alt="" className="h-8 w-8" />
                </button>
              );
            })}
          </div>
        </div>
        <Field
          label="Clasificación"
          value={value.clasificacion}
          onChange={(v) => set("clasificacion", v)}
          rows={2}
          placeholder="Irritación cutánea, categoría 2 (H315)… — o «No clasificado como peligroso»."
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <Field
            label="Frases H · una por línea"
            value={value.frasesH}
            onChange={(v) => set("frasesH", v)}
            rows={3}
            mono
            placeholder={"H315: Provoca irritación cutánea."}
          />
          <Field
            label="Frases P · una por línea"
            value={value.frasesP}
            onChange={(v) => set("frasesP", v)}
            rows={3}
            mono
            placeholder={"P280: Llevar guantes de protección."}
          />
        </div>
        {sinPeligro && lineas(value.frasesP).length > 0 && (
          <p className="text-[11px] text-warning">Hay frases P pero ningún peligro clasificado: revise si sobran.</p>
        )}
        <p className="text-[11px] text-muted">
          La composición va en el COA. Primeros auxilios {hayRespuesta ? "sale de las frases P3xx." : "se toma de las frases P3xx (agréguelas si aplican)."}
        </p>
      </div>

      {/* ── El resto: una línea por sección, se despliega solo la que se toca ── */}
      <div className="divide-y divide-border rounded-lg border border-border">
        <SeccionPlegable titulo="Uso recomendado y teléfono de emergencia" valor={[value.usos, value.telefono].filter(Boolean).join(" · ")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Usos recomendados" value={value.usos} onChange={(v) => set("usos", v)} rows={2} />
            <Field label="Teléfono de emergencia" value={value.telefono} onChange={(v) => set("telefono", v)} />
          </div>
        </SeccionPlegable>
        {SECCIONES_TEXTO.map(({ n, titulo, clave, ayuda, mono }) => (
          <SeccionPlegable key={clave} n={n} titulo={titulo} valor={value[clave]}>
            <Field label={titulo} value={value[clave]} onChange={(v) => set(clave, v)} rows={3} mono={mono} placeholder={ayuda} />
            {clave === "almacenamiento" && ft.conservacion.trim() && (
              <p className="mt-1 text-[11px] text-muted"><span className="font-medium">La FT ya dice:</span> {ft.conservacion}</p>
            )}
          </SeccionPlegable>
        ))}
      </div>
    </div>
  );
}
