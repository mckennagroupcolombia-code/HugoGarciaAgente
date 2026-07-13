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
}

const ORDEN_ROLES: RolTextoCapa[] = ["titulo", "subtitulo", "descripcion"];

function preview(texto: string, max = 72): string {
  const t = (texto || "").replace(/\s+/g, " ").trim();
  if (!t) return "(vacío)";
  return t.length <= max ? t : `${t.slice(0, max).trim()}…`;
}

/**
 * Acceso rápido a las 3 capas de texto clave sin cazarlas en la lista Capas.
 * Solo navega/selecciona; la edición vive en el Inspector.
 */
export default function TextosRapidos({
  elementos,
  seleccionId,
  onSeleccionar,
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

  const filas = ORDEN_ROLES.map((rol) => ({
    rol,
    el: porRol.get(rol) ?? null,
  })).filter((f) => f.el);

  if (filas.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface/60 p-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Textos de etiqueta
      </p>
      <ul className="space-y-1">
        {filas.map(({ rol, el }) => {
          if (!el) return null;
          const activa = seleccionId === el.id;
          const esDesc = rol === "descripcion";
          return (
            <li key={el.id}>
              <button
                type="button"
                onClick={() => onSeleccionar(el.id)}
                className={`w-full rounded px-1.5 py-1 text-left transition ${
                  activa
                    ? "bg-accent/15 ring-1 ring-accent/40"
                    : "hover:bg-surface-hover"
                }`}
              >
                <span
                  className={`mb-0.5 block text-[10px] font-semibold uppercase tracking-wide ${
                    activa ? "text-accent" : "text-muted"
                  }`}
                >
                  {labelRolTextoCapa(rol)}
                  {activa ? " · editando" : ""}
                </span>
                <span className="block text-[11px] leading-snug text-ink-secondary">
                  {preview(el.content, esDesc ? 96 : 60)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
