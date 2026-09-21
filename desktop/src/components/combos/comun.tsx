import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, fetchAuthBlobUrl } from "../../api/client";
import { useAppStore } from "../../stores/app";

/** Lo que comparten la galería de Combos y el taller (misión): tipos, casillas, colores y las
 *  acciones que destraban una ranura. Una sola definición para que no diverjan. */

export type Casilla = "materia_prima" | "bolsa" | "envase" | "tapa" | "etiqueta" | "accesorio" | "proteccion" | "operacion" | "otro";
export type Componente = { codigo: string; nombre: string; cantidad: number; casilla: Casilla; existe: boolean };
export type Eslabon = {
  estado: "ok" | "aviso" | "falta";
  titulo: string;
  detalle: string;
  archivo?: string;
  codigo?: string;
  png?: string | null;
  meli_id?: string;
  precio?: number;
  etiqueta_id?: string;
  tamano?: string;
  plantilla_id?: string;
  doc_titulo?: string;
  accion?: Accion;
};
export type Accion =
  | { tipo: "generar_ean" | "disenar_etiqueta" | "crear_documento" | "corregir_alegra" }
  | { tipo: "fijar_sku"; sku: string; mp_nombre: string; archivo: string; doc_titulo: string };
export type Combo = {
  ref: string;
  nombre: string;
  precio_lista: number | null;
  foto: string | null;
  linea: string;
  componentes: Componente[];
  eslabones: Record<string, Eslabon>;
  ok: number;
  avisos: number;
  faltas: number;
};
export type Respuesta = {
  combos: Combo[];
  total: number;
  conteo: { rotos: number; sanos: number; sin_etiqueta: number; sin_documento: number; sin_ean: number };
  generado: string;
};

export const CASILLA: Record<Casilla, { icono: string; nombre: string }> = {
  materia_prima: { icono: "⚗️", nombre: "Materia prima" },
  bolsa: { icono: "🛍️", nombre: "Bolsa" },
  envase: { icono: "🧴", nombre: "Envase" },
  tapa: { icono: "🔩", nombre: "Tapa / cierre" },
  etiqueta: { icono: "🏷️", nombre: "Etiqueta" },
  accesorio: { icono: "🥄", nombre: "Accesorio" },
  proteccion: { icono: "📦", nombre: "Protección" },
  operacion: { icono: "⏱️", nombre: "Mano de obra" },
  otro: { icono: "◻️", nombre: "Otro" },
};

export const EQUIPO: { clave: string; icono: string }[] = [
  { clave: "receta", icono: "🧪" },
  { clave: "etiqueta_fisica", icono: "🏷️" },
  { clave: "documento", icono: "📄" },
  { clave: "ean", icono: "▮▯▮" },
  { clave: "etiqueta", icono: "🎨" },
  { clave: "publicacion", icono: "🛒" },
];

export const FILTROS: { id: string; label: string; cuenta?: keyof Respuesta["conteo"] }[] = [
  { id: "", label: "Todos" },
  { id: "rotos", label: "Con algo roto", cuenta: "rotos" },
  { id: "sin_etiqueta", label: "Sin etiqueta", cuenta: "sin_etiqueta" },
  { id: "sin_documento", label: "Sin documento", cuenta: "sin_documento" },
  { id: "sin_ean", label: "Sin código", cuenta: "sin_ean" },
  { id: "sanos", label: "Completos", cuenta: "sanos" },
];

export const COLOR = {
  ok: { borde: "border-accent-leaf/60", punto: "bg-accent-leaf", texto: "text-accent-leaf" },
  aviso: { borde: "border-accent-sun/70", punto: "bg-accent-sun", texto: "text-accent-sun" },
  falta: { borde: "border-accent-rose/70 border-dashed", punto: "bg-accent-rose", texto: "text-accent-rose" },
} as const;

export function cantidad(c: Componente): string {
  const n = Number.isInteger(c.cantidad) ? String(c.cantidad) : c.cantidad.toFixed(2).replace(/\.?0+$/, "");
  const u = c.casilla !== "materia_prima" ? "" : /mL$/i.test(c.codigo) ? " mL" : /g$/.test(c.codigo) ? " g" : "";
  return `×${n}${u}`;
}

export function Vida({ c }: { c: Combo }) {
  const total = c.ok + c.avisos + c.faltas || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-input" title={`${c.ok} de ${total} eslabones completos`}>
      <div className="bg-accent-leaf" style={{ width: `${(c.ok / total) * 100}%` }} />
      <div className="bg-accent-sun" style={{ width: `${(c.avisos / total) * 100}%` }} />
      <div className="bg-accent-rose" style={{ width: `${(c.faltas / total) * 100}%` }} />
    </div>
  );
}

export function EtiquetaPng({ nombre }: { nombre: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    fetchAuthBlobUrl(`/api/etiquetas/recursos-png/archivo/${nombre.split("/").map(encodeURIComponent).join("/")}`).then((u) => {
      creada = u;
      if (vivo) setUrl(u);
      else if (u) URL.revokeObjectURL(u);
    });
    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [nombre]);
  if (!url) return <div className="flex h-28 items-center justify-center text-[11px] text-muted">Cargando etiqueta…</div>;
  return <img src={url} alt="Etiqueta del producto" className="max-h-44 w-full rounded-md bg-white object-contain p-1" />;
}

export const BTN = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-bold text-ink hover:bg-accent/25 disabled:opacity-50";
export const BTN_SEC = "rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-hover";

/** Lo que destraba una ranura vacía. Cada acción reutiliza el camino que ya existe
 *  (el mismo endpoint de códigos EAN, el Studio, Docs técnicos): acá no nace una segunda vía. */
export function AccionRanura({ c, accion }: { c: Combo; accion: Accion }) {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const setEanPrefill = useAppStore((s) => s.setEanPrefill);
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setConfirmar(false);
    setMsg(null);
  }, [c.ref]);

  const refrescar = async () => {
    await api.post("/api/mapa-sistema/invalidar").catch(() => null);
    await qc.invalidateQueries({ queryKey: ["mapa-sistema-combos"] });
    await qc.invalidateQueries({ queryKey: ["mapa-sistema-flujo"] });
  };
  const correr = async (f: () => Promise<void>) => {
    setOcupado(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg((e as Error)?.message || "No se pudo completar");
    } finally {
      setOcupado(false);
    }
  };

  if (accion.tipo === "generar_ean") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className={BTN}
          onClick={() => {
            setEanPrefill({ sku: c.ref, nombre: c.nombre });
            setEtiquetasTab("codigos_ean");
            setPanel("etiquetas");
          }}
        >
          Crear el código en Diseño →
        </button>
        <span className="text-[10px] text-muted">abre Códigos EAN con el combo ya escrito</span>
      </div>
    );
  }

  if (accion.tipo === "fijar_sku") {
    return (
      <div className="mt-2 space-y-1.5">
        {!confirmar ? (
          <button className={BTN} onClick={() => setConfirmar(true)}>
            Unir por SKU…
          </button>
        ) : (
          <div className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
            <div className="text-muted">¿Son el mismo producto?</div>
            <div className="mt-1">
              📄 <b>{accion.doc_titulo}</b>
            </div>
            <div>
              ⚗️ <b>{accion.mp_nombre}</b> <code className="text-muted">{accion.sku}</code>
            </div>
            <div className="mt-1 text-muted">
              Se escribe <code>referencia: {accion.sku}</code> en el documento. Todos los combos de esa materia prima lo heredan.
            </div>
            <div className="mt-2 flex gap-2">
              <button
                className={BTN}
                disabled={ocupado}
                onClick={() =>
                  correr(async () => {
                    const r = await api.post<{ ok: boolean; errores: { error: string }[] }>("/api/mapa-sistema/documentos/fijar-sku", {
                      items: [{ archivo: accion.archivo, sku: accion.sku }],
                    });
                    if (!r.ok) throw new Error(r.errores[0]?.error || "No se pudo fijar");
                    await refrescar();
                  })
                }
              >
                Sí, fijar el SKU
              </button>
              <button className={BTN_SEC} onClick={() => setConfirmar(false)}>
                No
              </button>
            </div>
          </div>
        )}
        {msg && <p className="text-[11px] text-accent-rose">{msg}</p>}
      </div>
    );
  }

  if (accion.tipo === "disenar_etiqueta") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className={BTN}
          onClick={() => {
            navigator.clipboard?.writeText(c.nombre).catch(() => null);
            setEtiquetasTab("studio");
            setPanel("etiquetas");
          }}
        >
          Diseñar en el Studio →
        </button>
        <span className="text-[10px] text-muted">copia el nombre al portapapeles</span>
      </div>
    );
  }

  if (accion.tipo === "crear_documento") {
    return (
      <div className="mt-2">
        <button className={BTN} onClick={() => setPanel("fichas")}>
          Ir a Docs técnicos →
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button className={BTN_SEC} onClick={() => navigator.clipboard?.writeText(c.ref).catch(() => null)}>
        Copiar SKU
      </button>
      <span className="text-[10px] text-muted">Se corrige en Alegra: abre el kit y agrégale su materia prima.</span>
    </div>
  );
}

