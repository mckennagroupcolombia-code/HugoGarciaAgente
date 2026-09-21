import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { useAppStore } from "../stores/app";

/**
 * Combos: la «fotografía» de cada producto de venta y todo lo que lo compone.
 *
 * Un combo (`type=kit` en Alegra) son gramos de materia prima + empaque + etiqueta;
 * alrededor cuelgan documento técnico, código EAN, diseño de etiqueta y publicación.
 * Acá se ve como la ficha de un personaje: su inventario (la receta) y su
 * equipamiento (los eslabones), con las ranuras vacías a la vista. Antes no había
 * ninguna pantalla que mostrara de qué está hecho un combo.
 *
 * Solo lee `/api/mapa-sistema/combos` (app/services/mapa_producto.py), sin LLM.
 */

type Casilla = "materia_prima" | "bolsa" | "envase" | "tapa" | "etiqueta" | "accesorio" | "proteccion" | "operacion" | "otro";
type Componente = { codigo: string; nombre: string; cantidad: number; casilla: Casilla; existe: boolean };
type Eslabon = {
  estado: "ok" | "aviso" | "falta";
  titulo: string;
  detalle: string;
  archivo?: string;
  codigo?: string;
  png?: string | null;
  meli_id?: string;
  precio?: number;
  accion?: Accion;
};
type Accion =
  | { tipo: "generar_ean" | "disenar_etiqueta" | "crear_documento" | "corregir_alegra" }
  | { tipo: "fijar_sku"; sku: string; mp_nombre: string; archivo: string; doc_titulo: string };
type EanPropuesto = {
  sku: string;
  nombre_producto: string;
  numero_producto: number;
  presentacion: string;
  anio: number;
  bimestre: number;
  codigo_previsto: string;
};
type Combo = {
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
type Respuesta = {
  combos: Combo[];
  total: number;
  conteo: { rotos: number; sanos: number; sin_etiqueta: number; sin_documento: number; sin_ean: number };
  generado: string;
};

const CASILLA: Record<Casilla, { icono: string; nombre: string }> = {
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

const EQUIPO: { clave: string; icono: string }[] = [
  { clave: "receta", icono: "🧪" },
  { clave: "etiqueta_fisica", icono: "🏷️" },
  { clave: "documento", icono: "📄" },
  { clave: "ean", icono: "▮▯▮" },
  { clave: "etiqueta", icono: "🎨" },
  { clave: "publicacion", icono: "🛒" },
];

const FILTROS: { id: string; label: string; cuenta?: keyof Respuesta["conteo"] }[] = [
  { id: "", label: "Todos" },
  { id: "rotos", label: "Con algo roto", cuenta: "rotos" },
  { id: "sin_etiqueta", label: "Sin etiqueta", cuenta: "sin_etiqueta" },
  { id: "sin_documento", label: "Sin documento", cuenta: "sin_documento" },
  { id: "sin_ean", label: "Sin código", cuenta: "sin_ean" },
  { id: "sanos", label: "Completos", cuenta: "sanos" },
];

const COLOR = {
  ok: { borde: "border-accent-leaf/60", punto: "bg-accent-leaf", texto: "text-accent-leaf" },
  aviso: { borde: "border-accent-sun/70", punto: "bg-accent-sun", texto: "text-accent-sun" },
  falta: { borde: "border-accent-rose/70 border-dashed", punto: "bg-accent-rose", texto: "text-accent-rose" },
} as const;

function cantidad(c: Componente): string {
  const n = Number.isInteger(c.cantidad) ? String(c.cantidad) : c.cantidad.toFixed(2).replace(/\.?0+$/, "");
  const u = c.casilla !== "materia_prima" ? "" : /mL$/i.test(c.codigo) ? " mL" : /g$/.test(c.codigo) ? " g" : "";
  return `×${n}${u}`;
}

function Vida({ c }: { c: Combo }) {
  const total = c.ok + c.avisos + c.faltas || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-input" title={`${c.ok} de ${total} eslabones completos`}>
      <div className="bg-accent-leaf" style={{ width: `${(c.ok / total) * 100}%` }} />
      <div className="bg-accent-sun" style={{ width: `${(c.avisos / total) * 100}%` }} />
      <div className="bg-accent-rose" style={{ width: `${(c.faltas / total) * 100}%` }} />
    </div>
  );
}

function EtiquetaPng({ nombre }: { nombre: string }) {
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

const BTN = "rounded-md border border-accent bg-accent/15 px-2 py-1 text-[11px] font-bold text-ink hover:bg-accent/25 disabled:opacity-50";
const BTN_SEC = "rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-hover";

/** Lo que destraba una ranura vacía. Cada acción reutiliza el camino que ya existe
 *  (el mismo endpoint de códigos EAN, el Studio, Docs técnicos): acá no nace una segunda vía. */
function AccionRanura({ c, accion }: { c: Combo; accion: Accion }) {
  const qc = useQueryClient();
  const setPanel = useAppStore((s) => s.setPanel);
  const setEtiquetasTab = useAppStore((s) => s.setEtiquetasTab);
  const [prop, setProp] = useState<EanPropuesto | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setProp(null);
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
      <div className="mt-2 space-y-1.5">
        {!prop ? (
          <button
            className={BTN}
            disabled={ocupado}
            onClick={() => correr(async () => setProp(await api.get<EanPropuesto>(`/api/mapa-sistema/combos/${encodeURIComponent(c.ref)}/ean-propuesto`)))}
          >
            Generar código…
          </button>
        ) : (
          <div className="rounded-md border border-border bg-surface p-2 text-[11px] text-ink">
            <div>
              Producto n.º <b>{prop.numero_producto}</b> · presentación <b>{prop.presentacion}</b> · 20{prop.anio}, bimestre {prop.bimestre}
            </div>
            <div className="mt-1 font-mono text-sm tracking-[0.18em]">{prop.codigo_previsto}</div>
            <div className="mt-2 flex gap-2">
              <button
                className={BTN}
                disabled={ocupado}
                onClick={() =>
                  correr(async () => {
                    await api.post("/api/etiquetas/codigos-ean", {
                      sku: prop.sku,
                      nombre_producto: prop.nombre_producto,
                      numero_producto: prop.numero_producto,
                      presentacion: prop.presentacion,
                      anio: prop.anio,
                      bimestre: prop.bimestre,
                    });
                    await refrescar();
                  })
                }
              >
                Crear este código
              </button>
              <button className={BTN_SEC} onClick={() => setProp(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {msg && <p className="text-[11px] text-accent-rose">{msg}</p>}
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

function Detalle({ c }: { c: Combo }) {
  const etq = c.eslabones.etiqueta;
  const mp = c.componentes.filter((x) => x.casilla === "materia_prima");
  const resto = c.componentes.filter((x) => x.casilla !== "materia_prima");
  return (
    <div className="space-y-4">
      {/* Cabecera: la «fotografía» */}
      <div className="flex gap-4">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-white">
          {c.foto ? (
            <img src={c.foto} alt={c.nombre} className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl text-muted">?</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{c.linea || "Sin línea en la web"}</div>
          <h3 className="text-base font-bold leading-tight text-ink">{c.nombre}</h3>
          <code className="text-[11px] text-ink-secondary">{c.ref}</code>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-40">
              <Vida c={c} />
            </div>
            <span className="text-[11px] tabular-nums text-muted">
              {c.ok}/{c.ok + c.avisos + c.faltas} completo
            </span>
          </div>
          {c.precio_lista ? (
            <div className="mt-1 text-xs tabular-nums text-ink-secondary">${Math.round(c.precio_lista).toLocaleString("es-CO")} en Alegra</div>
          ) : null}
        </div>
      </div>

      {/* Inventario: la receta */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
          Inventario · lo que descuenta cada venta ({c.componentes.length})
        </h4>
        {c.componentes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-accent-rose/70 bg-accent-rose/10 p-3 text-xs text-ink">
            Este combo no tiene receta en Alegra: al venderse no descuenta inventario ni tiene costo.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...mp, ...resto].map((x, i) => (
              <div
                key={`${x.codigo}-${i}`}
                className={`relative rounded-lg border p-2 ${
                  x.casilla === "materia_prima" ? "border-accent/70 bg-accent/10" : "border-border bg-surface-input"
                } ${x.existe ? "" : "border-dashed border-accent-rose/70"}`}
                title={x.nombre}
              >
                <span className="absolute right-1.5 top-1.5 rounded bg-surface px-1 text-[10px] font-bold tabular-nums text-ink">
                  {cantidad(x)}
                </span>
                <div className="text-xl leading-none">{CASILLA[x.casilla].icono}</div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-muted">{CASILLA[x.casilla].nombre}</div>
                <div className="line-clamp-2 text-[11px] leading-tight text-ink">{x.nombre}</div>
                <code className="text-[9.5px] text-muted">{x.codigo}</code>
                {!x.existe && <div className="text-[9.5px] font-bold text-accent-rose">ya no existe en Alegra</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Equipamiento: los eslabones */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Equipamiento · lo que lo respalda</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {EQUIPO.map(({ clave, icono }) => {
            const e = c.eslabones[clave];
            if (!e) return null;
            const col = COLOR[e.estado];
            return (
              <div key={clave} className={`rounded-lg border bg-surface-input p-2.5 ${col.borde}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{icono}</span>
                  <span className="text-xs font-bold text-ink">{e.titulo}</span>
                  <span className={`ml-auto text-[10px] font-bold uppercase ${col.texto}`}>
                    {e.estado === "ok" ? "equipado" : e.estado === "aviso" ? "revisar" : "ranura vacía"}
                  </span>
                </div>
                {!(clave === "ean" && e.codigo) && <p className="mt-1 text-[11px] leading-snug text-muted">{e.detalle}</p>}
                {clave === "ean" && e.codigo && <div className="mt-1 font-mono text-sm tracking-[0.2em] text-ink">{e.codigo}</div>}
                {e.accion && <AccionRanura c={c} accion={e.accion} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* La etiqueta real, si ya se imprimió a PNG */}
      <div>
        <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Así se ve la etiqueta</h4>
        {etq?.png ? (
          <EtiquetaPng nombre={etq.png} />
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted">
            {etq?.estado === "falta"
              ? "Todavía no hay etiqueta que mostrar."
              : "Hay diseño en el Studio, pero no se ha exportado a PNG con este nombre."}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CombosPanel() {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("rotos");
  const [sel, setSel] = useState<string | null>(null);
  const [visibles, setVisibles] = useState(60);

  const datos = useQuery({
    queryKey: ["mapa-sistema-combos"],
    queryFn: () => api.get<Respuesta>("/api/mapa-sistema/combos"),
    refetchInterval: 60_000,
  });

  const lista = useMemo(() => {
    const todos = datos.data?.combos ?? [];
    const texto = q.trim().toUpperCase();
    return todos.filter((c) => {
      if (texto && !c.nombre.toUpperCase().includes(texto) && !c.ref.toUpperCase().includes(texto)) return false;
      if (filtro === "rotos") return c.faltas > 0;
      if (filtro === "sanos") return c.faltas === 0 && c.avisos === 0;
      if (filtro === "sin_etiqueta") return c.eslabones.etiqueta?.estado === "falta";
      if (filtro === "sin_documento") return c.eslabones.documento?.estado === "falta";
      if (filtro === "sin_ean") return c.eslabones.ean?.estado === "falta";
      return true;
    });
  }, [datos.data, q, filtro]);

  useEffect(() => setVisibles(60), [q, filtro]);
  const elegido = useMemo(() => lista.find((c) => c.ref === sel) ?? lista[0] ?? null, [lista, sel]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h2 className="text-base font-bold text-ink">Combos</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          Cada producto de venta con todo lo que lo compone: su receta en Alegra (el inventario) y lo que lo respalda (documento,
          código, etiqueta y publicación). Las ranuras vacías son lo que falta para que esté completo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          id="combos-buscar"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className="w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-ink sm:w-64"
        />
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              filtro === f.id ? "border-accent bg-accent/15 font-bold text-ink" : "border-border bg-surface-input text-muted hover:text-ink"
            }`}
          >
            {f.label}
            {f.cuenta && datos.data ? <span className="ml-1 tabular-nums opacity-70">{datos.data.conteo[f.cuenta]}</span> : null}
            {!f.cuenta && datos.data ? <span className="ml-1 tabular-nums opacity-70">{datos.data.total}</span> : null}
          </button>
        ))}
      </div>

      {datos.isError && (
        <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">
          No se pudieron leer los combos: {(datos.error as Error)?.message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Lista */}
        <div className="space-y-2">
          {datos.isLoading && <p className="text-xs text-muted">Leyendo el catálogo de Alegra…</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {lista.slice(0, visibles).map((c) => (
              <button
                key={c.ref}
                onClick={() => setSel(c.ref)}
                className={`rounded-lg border p-2 text-left transition ${
                  elegido?.ref === c.ref ? "border-accent bg-surface-hover" : "border-border bg-surface-panel hover:bg-surface-hover"
                }`}
              >
                <div className="flex gap-2">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-white">
                    {c.foto ? <img src={c.foto} alt="" className="h-full w-full object-contain" loading="lazy" /> : null}
                  </div>
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-[11px] font-bold leading-tight text-ink">{c.nombre}</div>
                    <code className="text-[9.5px] text-muted">{c.ref}</code>
                  </div>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {EQUIPO.map(({ clave }) => (
                    <span
                      key={clave}
                      title={`${c.eslabones[clave]?.titulo}: ${c.eslabones[clave]?.detalle}`}
                      className={`h-1.5 flex-1 rounded-full ${COLOR[c.eslabones[clave]?.estado ?? "falta"].punto}`}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
          {lista.length > visibles && (
            <button
              onClick={() => setVisibles((v) => v + 60)}
              className="w-full rounded-lg border border-border bg-surface-input py-1.5 text-xs text-ink hover:bg-surface-hover"
            >
              Ver más ({lista.length - visibles} restantes)
            </button>
          )}
          {datos.data && lista.length === 0 && <p className="text-xs text-muted">Ningún combo coincide.</p>}
        </div>

        {/* Ficha */}
        <div className="rounded-xl border border-border bg-surface-panel p-4 lg:sticky lg:top-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          {elegido ? <Detalle c={elegido} /> : <p className="text-xs text-muted">Elige un combo para ver de qué está hecho.</p>}
        </div>
      </div>
    </div>
  );
}
