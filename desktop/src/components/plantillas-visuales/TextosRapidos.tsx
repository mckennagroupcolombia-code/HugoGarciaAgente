import {
  inferirRolTextoCapa,
  labelRolTextoCapa,
  type ElementoTexto,
  type ElementoVisual,
  type RolTextoCapa,
} from "../../lib/plantillasVisuales";

interface Props {
  elementos: ElementoVisual[];
  seleccionId: string | null;
  onSeleccionar: (id: string) => void;
  /** En la barra inferior: pills compactas con contraste fuerte. */
  variante?: "panel" | "barra";
}

const ORDEN_ROLES: RolTextoCapa[] = ["titulo", "subtitulo", "descripcion"];

function preview(texto: string, max = 28): string {
  const t = (texto || "").replace(/\s+/g, " ").trim();
  if (!t) return "vacío";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

function shortRol(rol: RolTextoCapa): string {
  if (rol === "descripcion") return "Descripción";
  if (rol === "titulo") return "Título";
  if (rol === "subtitulo") return "Subtítulo";
  return "Texto";
}

/**
 * Selector de textos clave (pills).
 */
export default function TextosRapidos({
  elementos,
  seleccionId,
  onSeleccionar,
  variante = "panel",
}: Props) {
  const textos = elementos.filter((e): e is ElementoTexto => e.type === "text");
  if (textos.length === 0) return null;

  const porRol = new Map<RolTextoCapa, ElementoTexto>();
  for (const el of textos) {
    const rol = inferirRolTextoCapa(el, elementos) ?? "otro";
    if (ORDEN_ROLES.includes(rol) && !porRol.has(rol)) {
      porRol.set(rol, el);
    }
  }

  const clave = ORDEN_ROLES.map((rol) => ({
    rol,
    el: porRol.get(rol) ?? null,
  })).filter((f): f is { rol: RolTextoCapa; el: ElementoTexto } => !!f.el);

  const otros = textos.filter(
    (t) => !clave.some((f) => f.el.id === t.id),
  );

  if (clave.length === 0 && otros.length === 0) return null;

  const barra = variante === "barra";

  return (
    <div className={barra ? "space-y-1" : "space-y-1.5"}>
      <p
        className={`text-[10px] font-bold uppercase tracking-wide ${
          barra ? "text-neutral-700" : "text-muted"
        }`}
      >
        Textos
      </p>
      <div className="flex flex-wrap gap-1.5">
        {clave.map(({ rol, el }) => {
          const activa = seleccionId === el.id;
          return (
            <button
              key={el.id}
              type="button"
              title={preview(el.content, 80)}
              onClick={() => onSeleccionar(el.id)}
              className={`max-w-[10rem] rounded-lg border px-2.5 py-1.5 text-left transition ${
                activa
                  ? barra
                    ? "border-[#016d82] bg-[#016d82] text-white shadow-sm"
                    : "border-accent bg-accent/15 text-accent"
                  : barra
                    ? "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400 hover:bg-neutral-50"
                    : "border-border bg-surface text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              <span
                className={`block text-[9px] font-bold uppercase tracking-wide ${
                  activa && barra ? "text-white/85" : barra ? "text-neutral-500" : "opacity-80"
                }`}
              >
                {shortRol(rol)}
              </span>
              <span
                className={`block truncate leading-tight ${
                  barra ? "text-[12px] font-semibold" : "text-[11px] font-medium"
                }`}
              >
                {preview(el.content, 22)}
              </span>
            </button>
          );
        })}
        {otros.map((el) => {
          const activa = seleccionId === el.id;
          const rol = inferirRolTextoCapa(el, elementos);
          return (
            <button
              key={el.id}
              type="button"
              title={preview(el.content, 80)}
              onClick={() => onSeleccionar(el.id)}
              className={`max-w-[8.5rem] rounded-lg border px-2.5 py-1.5 text-left transition ${
                activa
                  ? barra
                    ? "border-[#016d82] bg-[#016d82] text-white shadow-sm"
                    : "border-accent bg-accent/15 text-accent"
                  : barra
                    ? "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400 hover:bg-neutral-50"
                    : "border-border bg-surface text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              <span
                className={`block text-[9px] font-bold uppercase tracking-wide ${
                  activa && barra ? "text-white/85" : barra ? "text-neutral-500" : "opacity-80"
                }`}
              >
                {rol && rol !== "otro" ? labelRolTextoCapa(rol) : "Otro"}
              </span>
              <span
                className={`block truncate leading-tight ${
                  barra ? "text-[12px] font-semibold" : "text-[11px] font-medium"
                }`}
              >
                {preview(el.content, 18)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
