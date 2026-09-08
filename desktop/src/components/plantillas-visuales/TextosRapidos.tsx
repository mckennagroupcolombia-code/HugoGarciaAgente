import {
  inferirRolTextoCapa,
  labelCapaElemento,
  type ElementoImagen,
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

/**
 * Selector de textos clave (pills). Cada recuadro lleva el nombre del bloque
 * (ORIGEN, APARIENCIA, LOGO…) — nunca un genérico «Otro».
 */
export default function TextosRapidos({
  elementos,
  seleccionId,
  onSeleccionar,
  variante = "panel",
}: Props) {
  const textos = elementos.filter((e): e is ElementoTexto => e.type === "text" && e.visible !== false);
  const imagenesClave = elementos.filter(
    (e): e is ElementoImagen =>
      e.type === "image" && e.visible !== false && (e.rolCapa === "logo" || e.rolCapa === "barcode"),
  );
  if (textos.length === 0 && imagenesClave.length === 0) return null;

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

  const idsClave = new Set(clave.map((f) => f.el.id));
  const conCampo = textos.filter((t) => t.campoProducto && !idsClave.has(t.id));
  const otros = textos.filter(
    (t) => !idsClave.has(t.id) && !t.campoProducto && (t.content || "").trim(),
  );

  const barra = variante === "barra";

  const pillCls = (activa: boolean) =>
    `max-w-[10rem] rounded-lg border px-2.5 py-1.5 text-left transition ${
      activa
        ? barra
          ? "border-[#016d82] bg-[#016d82] text-white shadow-sm"
          : "border-accent bg-accent/15 text-accent"
        : barra
          ? "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400 hover:bg-neutral-50"
          : "border-border bg-surface text-ink-secondary hover:bg-surface-hover"
    }`;

  const labelCls = (activa: boolean) =>
    `block text-[9px] font-bold uppercase tracking-wide ${
      activa && barra ? "text-white/85" : barra ? "text-neutral-500" : "opacity-80"
    }`;

  const valueCls = barra ? "block truncate text-[12px] font-semibold leading-tight" : "block truncate text-[11px] font-medium leading-tight";

  function Pill({
    id,
    etiqueta,
    valor,
  }: {
    id: string;
    etiqueta: string;
    valor: string;
  }) {
    const activa = seleccionId === id;
    return (
      <button
        type="button"
        title={`${etiqueta}: ${valor}`}
        onClick={() => onSeleccionar(id)}
        className={pillCls(activa)}
      >
        <span className={labelCls(activa)}>{etiqueta}</span>
        <span className={valueCls}>{preview(valor, 22)}</span>
      </button>
    );
  }

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
        {clave.map(({ el }) => (
          <Pill
            key={el.id}
            id={el.id}
            etiqueta={labelCapaElemento(el, elementos)}
            valor={el.content || ""}
          />
        ))}
        {conCampo.map((el) => (
          <Pill
            key={el.id}
            id={el.id}
            etiqueta={labelCapaElemento(el, elementos)}
            valor={el.content || ""}
          />
        ))}
        {imagenesClave.map((el) => (
          <Pill
            key={el.id}
            id={el.id}
            etiqueta={labelCapaElemento(el, elementos)}
            valor={el.rolCapa === "barcode" ? "EAN-13" : "McKenna"}
          />
        ))}
        {otros.map((el) => (
          <Pill
            key={el.id}
            id={el.id}
            etiqueta={labelCapaElemento(el, elementos)}
            valor={el.content || ""}
          />
        ))}
      </div>
    </div>
  );
}
