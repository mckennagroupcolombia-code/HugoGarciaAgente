import { useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  FUENTE_LABEL,
  LINEA_LABEL,
  fmtPrecio,
  useActualizarCatalogo,
  useActualizarProducto,
  useActualizarSolicitud,
  useAgregarProducto,
  useAutoclasificar,
  useBuscarProductos,
  useCatalogoPaises,
  useCatalogoWeb,
  useCatalogos,
  useCoincidencias,
  useComparador,
  useEliminarProducto,
  useEscanearCatalogos,
  useExtraerCatalogo,
  useExtraerUrl,
  useGuardarProveedor,
  useHistorialPrecios,
  useImportarFuentes,
  useImportarLineasCatalogo,
  useProveedorDetalle,
  useProveedores,
  useProveedoresResumen,
  usePublicarMasivo,
  usePublicarOfertaWeb,
  useSolicitudesCotizacion,
  type CatalogoCorreo,
  type LineaCandidata,
  type ProductoAgrupado,
  type Proveedor,
  type SolicitudCotizacion,
} from "../hooks/useProveedores";

type Tab = "directorio" | "productos" | "comparador" | "catalogos" | "oferta" | "cotizaciones";

const TABS: { id: Tab; label: string }[] = [
  { id: "directorio", label: "Directorio" },
  { id: "productos", label: "¿Quién vende…?" },
  { id: "comparador", label: "Comparador" },
  { id: "catalogos", label: "Catálogos" },
  { id: "oferta", label: "Oferta web" },
  { id: "cotizaciones", label: "Cotizaciones" },
];

const INPUT = "mt-1 w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink";
const BTN = "rounded-paper border border-border bg-surface-panel px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-hover disabled:opacity-50";
const BTN_ACCENT = "rounded-paper bg-accent px-3 py-1.5 text-xs font-bold text-white hover:bg-accent-hover disabled:opacity-50";
const CARD = "rounded-paper border border-border bg-surface-panel p-4";

function fmtFecha(f?: string | null): string {
  if (!f) return "—";
  return f.slice(0, 10);
}

// ───────────────────────────── Resumen ─────────────────────────────

function Resumen() {
  const { data } = useProveedoresResumen();
  if (!data) return null;
  const items: [string, string | number][] = [
    ["Proveedores", data.proveedores],
    ["Productos distintos", data.productos],
    ["Precios históricos", data.precios],
    ["Publicados en web", data.publicables],
    ["Catálogos por revisar", data.catalogos_pendientes],
    ["Cotizaciones nuevas", data.cotizaciones_nuevas],
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-paper border border-border bg-surface-panel px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{k}</p>
          <p className="text-lg font-bold text-ink">{v}</p>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Directorio ─────────────────────────────

const CAMPOS_PROVEEDOR: { k: keyof Proveedor; label: string; tipo?: "select-pais" | "select-tipo" | "textarea" }[] = [
  { k: "nombre", label: "Nombre" },
  { k: "nit", label: "NIT / ID fiscal" },
  { k: "pais", label: "País", tipo: "select-pais" },
  { k: "ciudad", label: "Ciudad" },
  { k: "tipo", label: "Tipo", tipo: "select-tipo" },
  { k: "email", label: "Correo" },
  { k: "telefono", label: "Teléfono / WhatsApp" },
  { k: "sitio_web", label: "Sitio web" },
  { k: "incoterm", label: "Incoterm habitual" },
  { k: "moneda", label: "Moneda" },
  { k: "condiciones_pago", label: "Condiciones de pago" },
  { k: "notas", label: "Notas", tipo: "textarea" },
];

function FormProveedor({ inicial, onClose }: { inicial?: Proveedor; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Proveedor>>(inicial ?? { tipo: "importador", moneda: "COP", pais: "" });
  const guardar = useGuardarProveedor();
  const { data: cat } = useCatalogoPaises();
  const set = (k: keyof Proveedor, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className={`${CARD} mt-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{inicial ? "Editar proveedor" : "Nuevo proveedor"}</h3>
        <button className={BTN} onClick={onClose}>Cerrar</button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CAMPOS_PROVEEDOR.map(({ k, label, tipo }) => (
          <label key={k} className={`text-xs text-muted ${tipo === "textarea" ? "sm:col-span-2 lg:col-span-3" : ""}`}>
            {label}
            {tipo === "select-pais" ? (
              <select value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className={INPUT}>
                <option value="">— sin definir —</option>
                {(cat?.paises ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : tipo === "select-tipo" ? (
              <select value={String(form[k] ?? "importador")} onChange={(e) => set(k, e.target.value)} className={INPUT}>
                {(cat?.tipos ?? ["importador", "fabricante", "distribuidor", "nacional", "otro"]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : tipo === "textarea" ? (
              <textarea value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} rows={3} className={INPUT} />
            ) : (
              <input value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} className={INPUT} />
            )}
          </label>
        ))}
      </div>
      {inicial && (
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={Boolean(form.activo ?? 1)} onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked ? 1 : 0 }))} />
          Proveedor activo
        </label>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          className={BTN_ACCENT}
          disabled={guardar.isPending || !(form.nombre ?? "").trim()}
          onClick={() => guardar.mutate({ id: inicial?.id, datos: form }, { onSuccess: onClose })}
        >
          {guardar.isPending ? "Guardando…" : "Guardar"}
        </button>
        {guardar.isError && <span className="text-xs text-red-600">{(guardar.error as Error).message}</span>}
      </div>
    </div>
  );
}

function FichaProveedor({ id, onCerrar }: { id: number; onCerrar: () => void }) {
  const { data, isLoading } = useProveedorDetalle(id);
  const [editando, setEditando] = useState(false);
  const [nuevo, setNuevo] = useState<{ nombre: string; presentacion: string; precio: string; moneda: string; linea: string; origen_pais: string } | null>(null);
  const agregar = useAgregarProducto();
  const eliminar = useEliminarProducto();
  const actualizar = useActualizarProducto();
  const publicarMasivo = usePublicarMasivo();
  const autoclasificar = useAutoclasificar();
  const { data: cat } = useCatalogoPaises();

  if (isLoading || !data) return <p className="mt-3 text-xs text-muted">Cargando…</p>;
  const nPublicados = data.productos.filter((p) => p.publicar_web).length;

  return (
    <div className="mt-3 space-y-3">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">{data.nombre}</h3>
            <p className="text-xs text-muted">
              {[data.tipo, data.pais, data.ciudad, data.nit && `NIT ${data.nit}`].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {[data.email, data.telefono, data.sitio_web].filter(Boolean).join(" · ") || "Sin datos de contacto"}
            </p>
            {data.notas && <p className="mt-2 whitespace-pre-wrap text-xs text-ink-secondary">{data.notas}</p>}
          </div>
          <div className="flex gap-2">
            <button className={BTN} onClick={() => setEditando((v) => !v)}><Icon name="pencil" size={12} /> Editar</button>
            <button className={BTN} onClick={onCerrar}>Volver</button>
          </div>
        </div>
        {editando && <FormProveedor inicial={data} onClose={() => setEditando(false)} />}
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-ink">Productos que maneja ({data.productos.length}) <span className="font-normal text-muted">· {nPublicados} en Cotizar</span></h4>
          <div className="flex flex-wrap gap-2">
            <button className={BTN} disabled={autoclasificar.isPending} onClick={() => autoclasificar.mutate({ proveedor_id: id })} title="Sugiere línea y país de origen por el nombre (sin IA)">
              Sugerir línea y origen
            </button>
            <button className={BTN} disabled={publicarMasivo.isPending} onClick={() => publicarMasivo.mutate({ proveedor_ids: [id], despublicar: nPublicados === data.productos.length })}>
              {nPublicados === data.productos.length ? "Quitar todos de Cotizar" : "Publicar todos en Cotizar"}
            </button>
            <button className={BTN} onClick={() => setNuevo({ nombre: "", presentacion: "", precio: "", moneda: data.moneda || "COP", linea: "", origen_pais: data.pais || "" })}>
              <Icon name="plus" size={12} /> Agregar producto
            </button>
          </div>
        </div>
        {nuevo && (
          <div className="mt-3 grid gap-2 rounded-paper border border-dashed border-border p-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs text-muted sm:col-span-2">Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className={INPUT} /></label>
            <label className="text-xs text-muted">Presentación<input value={nuevo.presentacion} onChange={(e) => setNuevo({ ...nuevo, presentacion: e.target.value })} className={INPUT} placeholder="25 kg, 1 L…" /></label>
            <label className="text-xs text-muted">Precio<input value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} className={INPUT} type="number" /></label>
            <label className="text-xs text-muted">Línea
              <select value={nuevo.linea} onChange={(e) => setNuevo({ ...nuevo, linea: e.target.value })} className={INPUT}>
                <option value="">—</option>
                {Object.entries(LINEA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">Origen
              <select value={nuevo.origen_pais} onChange={(e) => setNuevo({ ...nuevo, origen_pais: e.target.value })} className={INPUT}>
                <option value="">—</option>
                {(cat?.paises ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-6">
              <button
                className={BTN_ACCENT}
                disabled={!nuevo.nombre.trim() || agregar.isPending}
                onClick={() =>
                  agregar.mutate(
                    { proveedorId: id, datos: { ...nuevo, precio: nuevo.precio ? Number(nuevo.precio) : undefined } },
                    { onSuccess: () => setNuevo(null) },
                  )
                }
              >
                Guardar
              </button>
              <button className={BTN} onClick={() => setNuevo(null)}>Cancelar</button>
            </div>
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-[10px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-2">Producto</th>
                <th className="py-1 pr-2">SKU Alegra</th>
                <th className="py-1 pr-2">Línea</th>
                <th className="py-1 pr-2">Origen</th>
                <th className="py-1 pr-2">Último precio</th>
                <th className="py-1 pr-2">Fecha</th>
                <th className="py-1 pr-2">Fuente</th>
                <th className="py-1 pr-2">Web</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {data.productos.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-1 pr-2 text-ink">{p.nombre}{p.presentacion && <span className="text-muted"> · {p.presentacion}</span>}</td>
                  <td className="py-1 pr-2 font-mono text-[11px] text-muted">{p.sku_siigo || "—"}</td>
                  <td className="py-1 pr-2 text-ink-secondary">{LINEA_LABEL[p.linea] ?? (p.linea || "—")}</td>
                  <td className="py-1 pr-2 text-ink-secondary">{p.origen_pais || "—"}</td>
                  <td className="py-1 pr-2 font-bold text-ink">{fmtPrecio(p.ultimo_precio, p.ultima_moneda ?? "COP")}{p.unidad && <span className="font-normal text-muted">/{p.unidad}</span>}</td>
                  <td className="py-1 pr-2 text-muted">{fmtFecha(p.ultima_fecha)}</td>
                  <td className="py-1 pr-2 text-muted">{FUENTE_LABEL[p.fuente] ?? p.fuente}</td>
                  <td className="py-1 pr-2">
                    <input
                      type="checkbox"
                      checked={Boolean(p.publicar_web)}
                      title="Publicar en la sección Cotizar de la web"
                      onChange={(e) => actualizar.mutate({ id: p.id, datos: { publicar_web: e.target.checked ? 1 : 0 } })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button className="text-muted hover:text-red-600" title="Eliminar" onClick={() => { if (confirm(`¿Eliminar "${p.nombre}" de ${data.nombre}?`)) eliminar.mutate(p.id); }}>
                      <Icon name="trash" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {data.productos.length === 0 && (
                <tr><td colSpan={9} className="py-3 text-center text-muted">Sin productos registrados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data.precios.length > 0 && (
        <div className={CARD}>
          <h4 className="text-sm font-bold text-ink">Historial de compras ({data.precios.length})</h4>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[10px] uppercase text-muted">
                <tr><th className="py-1 pr-2">Fecha</th><th className="py-1 pr-2">Producto</th><th className="py-1 pr-2">Cantidad</th><th className="py-1 pr-2">Precio unit.</th><th className="py-1 pr-2">Documento</th><th className="py-1">Fuente</th></tr>
              </thead>
              <tbody>
                {data.precios.map((ph) => (
                  <tr key={ph.id} className="border-t border-border">
                    <td className="py-1 pr-2 text-muted">{ph.fecha}</td>
                    <td className="py-1 pr-2 text-ink">{ph.nombre}</td>
                    <td className="py-1 pr-2 text-ink-secondary">{ph.cantidad ? `${ph.cantidad} ${ph.unidad}` : "—"}</td>
                    <td className="py-1 pr-2 font-bold text-ink">{fmtPrecio(ph.precio_unitario, ph.moneda)}</td>
                    <td className="py-1 pr-2 font-mono text-[11px] text-muted">{ph.documento}</td>
                    <td className="py-1 text-muted">{FUENTE_LABEL[ph.fuente] ?? ph.fuente}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.catalogos.length > 0 && (
        <div className={CARD}>
          <h4 className="text-sm font-bold text-ink">Catálogos recibidos por correo</h4>
          <ul className="mt-2 space-y-1 text-xs">
            {data.catalogos.map((c) => (
              <li key={c.id} className="text-ink-secondary">
                {c.fecha} · <span className="text-ink">{c.asunto}</span> · {c.adjuntos.map((a) => a.filename).join(", ")} · <span className="text-muted">{c.estado}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImportarFuentes() {
  const importar = useImportarFuentes();
  const [siigo, setSiigo] = useState(false);
  const [desde, setDesde] = useState("2024-01-01");
  const r = importar.data;
  return (
    <div className={`${CARD} mt-3`}>
      <h3 className="text-sm font-bold text-ink">Alimentar desde compras reales (sin IA)</h3>
      <p className="mt-1 text-xs text-muted">
        Cruza las facturas de compra ya procesadas (Gmail/XML DIAN), las compras exterior de Contabilidad y,
        opcionalmente, las facturas de compra de Alegra. Cada ítem queda como producto del proveedor con su precio
        histórico real. Se puede repetir sin duplicar.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={siigo} onChange={(e) => setSiigo(e.target.checked)} /> Incluir Alegra (compras)
        </label>
        {siigo && (
          <label className="text-xs text-muted">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={INPUT} /></label>
        )}
        <button className={BTN_ACCENT} disabled={importar.isPending} onClick={() => importar.mutate({ fuente: "todo", incluir_siigo: siigo, fecha_desde: desde })}>
          {importar.isPending ? "Importando…" : "Importar ahora"}
        </button>
      </div>
      {importar.isError && <p className="mt-2 text-xs text-red-600">{(importar.error as Error).message}</p>}
      {r && (
        <ul className="mt-3 space-y-1 text-xs text-ink-secondary">
          {(["historial", "compras_exterior", "siigo"] as const).map((k) => {
            const x = r[k];
            if (!x) return null;
            return (
              <li key={k}>
                <strong className="text-ink">{FUENTE_LABEL[k === "historial" ? "factura_compra" : k]}:</strong>{" "}
                {x.ok ? `${x.lineas ?? 0} líneas, ${x.precios_nuevos ?? 0} precios nuevos` : `error — ${x.error}`}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Directorio() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const { data, isLoading } = useProveedores(q);
  const lista = data?.proveedores ?? [];

  if (sel != null) return <FichaProveedor id={sel} onCerrar={() => setSel(null)} />;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor, NIT o país…" className={`${INPUT} mt-0 sm:w-72`} />
        <button className={BTN} onClick={() => setNuevo((v) => !v)}><Icon name="plus" size={12} /> Nuevo proveedor</button>
      </div>
      {nuevo && <FormProveedor onClose={() => setNuevo(false)} />}
      <ImportarFuentes />
      <div className="mt-3 overflow-x-auto rounded-paper border border-border bg-surface-panel">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-[10px] uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Proveedor</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">País</th>
              <th className="px-3 py-2">Productos</th>
              <th className="px-3 py-2">Compras</th>
              <th className="px-3 py-2">Última compra</th>
              <th className="px-3 py-2">Catálogos</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="cursor-pointer border-t border-border hover:bg-surface-hover" onClick={() => setSel(p.id)}>
                <td className="px-3 py-2 font-bold text-ink">{p.nombre}{!p.activo && <span className="ml-2 text-[10px] text-muted">(inactivo)</span>}</td>
                <td className="px-3 py-2 text-ink-secondary">{p.tipo}</td>
                <td className="px-3 py-2 text-ink-secondary">{p.pais || "—"}</td>
                <td className="px-3 py-2 text-ink">{p.n_productos ?? 0}</td>
                <td className="px-3 py-2 text-ink">{p.n_precios ?? 0}</td>
                <td className="px-3 py-2 text-muted">{fmtFecha(p.ultima_compra)}</td>
                <td className="px-3 py-2 text-muted">{p.n_catalogos ?? 0}</td>
              </tr>
            ))}
            {!isLoading && lista.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-muted">Sin proveedores. Usa «Importar ahora» para arrancar con las compras reales.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ───────────────────────────── ¿Quién vende…? ─────────────────────────────

function HistorialPrecios({ clave }: { clave: string }) {
  const { data } = useHistorialPrecios(clave);
  const precios = data?.precios ?? [];
  if (!precios.length) return <p className="mt-2 text-xs text-muted">Sin historial de precios para este producto.</p>;
  const max = Math.max(...precios.map((p) => p.precio_unitario));
  const min = Math.min(...precios.map((p) => p.precio_unitario));
  return (
    <div className="mt-2">
      <div className="flex h-16 items-end gap-1">
        {precios.map((p) => {
          const h = max === min ? 60 : 15 + ((p.precio_unitario - min) / (max - min)) * 85;
          return (
            <div key={p.id} className="group relative flex-1 rounded-t bg-accent/70" style={{ height: `${h}%` }} title={`${p.fecha} · ${p.proveedor} · ${fmtPrecio(p.precio_unitario, p.moneda)}`} />
          );
        })}
      </div>
      <table className="mt-2 w-full text-left text-[11px]">
        <tbody>
          {precios.slice(-8).reverse().map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="py-0.5 pr-2 text-muted">{p.fecha}</td>
              <td className="py-0.5 pr-2 text-ink">{p.proveedor}</td>
              <td className="py-0.5 pr-2 font-bold text-ink">{fmtPrecio(p.precio_unitario, p.moneda)}{p.unidad && <span className="font-normal text-muted">/{p.unidad}</span>}</td>
              <td className="py-0.5 text-muted">{p.cantidad ? `${p.cantidad} ${p.unidad}` : ""} · {FUENTE_LABEL[p.fuente] ?? p.fuente}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TarjetaProducto({ g }: { g: ProductoAgrupado }) {
  const [abierto, setAbierto] = useState(false);
  const actualizar = useActualizarProducto();
  const { data: cat } = useCatalogoPaises();
  const prodRef = g.proveedores[0]?.producto_id;
  const edit = (datos: Record<string, unknown>) => prodRef && actualizar.mutate({ id: prodRef, datos: { ...datos, aplicar_a_clave: true } });
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-ink">{g.nombre}</h4>
          <p className="text-xs text-muted">
            {g.proveedores.length} fuente{g.proveedores.length !== 1 && "s"}
            {g.cas && ` · CAS ${g.cas}`}
            {g.skus_siigo.length > 0 && ` · Alegra ${g.skus_siigo.join(", ")}`}
          </p>
        </div>
        <div className="text-right">
          {g.mejor_precio != null && (
            <>
              <p className="text-[10px] uppercase text-muted">Mejor último precio</p>
              <p className="text-base font-bold text-ink">{fmtPrecio(g.mejor_precio)}</p>
              <p className="text-[11px] text-muted">{g.mejor_proveedor}</p>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-[10px] uppercase text-muted">
            <tr><th className="py-1 pr-2">Proveedor</th><th className="py-1 pr-2">País</th><th className="py-1 pr-2">Último precio</th><th className="py-1 pr-2">Mínimo</th><th className="py-1 pr-2">Compras</th><th className="py-1">Fecha</th></tr>
          </thead>
          <tbody>
            {g.proveedores.map((f) => (
              <tr key={f.proveedor_id} className="border-t border-border">
                <td className="py-1 pr-2 font-bold text-ink">{f.proveedor}<span className="ml-1 font-normal text-muted">({f.tipo})</span></td>
                <td className="py-1 pr-2 text-ink-secondary">{f.pais || "—"}</td>
                <td className="py-1 pr-2 text-ink">{fmtPrecio(f.ultimo_precio, f.moneda)}</td>
                <td className="py-1 pr-2 text-ink-secondary">{fmtPrecio(f.precio_min, f.moneda)}</td>
                <td className="py-1 pr-2 text-ink-secondary">{f.n_compras}</td>
                <td className="py-1 text-muted">{fmtFecha(f.ultima_fecha)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="text-xs text-muted">Línea
          <select value={g.linea} onChange={(e) => edit({ linea: e.target.value })} className={INPUT}>
            <option value="">—</option>
            {Object.entries(LINEA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Origen (mapa web)
          <select value={g.origen_paises[0] ?? ""} onChange={(e) => edit({ origen_pais: e.target.value })} className={INPUT}>
            <option value="">—</option>
            {(cat?.paises ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input type="checkbox" checked={g.publicar_web} onChange={(e) => edit({ publicar_web: e.target.checked ? 1 : 0 })} />
          Publicar en «Cotizar» (web)
        </label>
        <button className={BTN} onClick={() => setAbierto((v) => !v)}>{abierto ? "Ocultar historial" : "Ver historial de precios"}</button>
      </div>
      {abierto && <HistorialPrecios clave={g.clave} />}
    </div>
  );
}

function QuienVende() {
  const [q, setQ] = useState("");
  const [linea, setLinea] = useState("");
  const { data, isLoading } = useBuscarProductos(q, { linea });
  const lista = data?.productos ?? [];
  const multi = useMemo(() => lista.filter((g) => g.proveedores.length > 1).length, [lista]);
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Materia prima, CAS o SKU… ej. ácido salicílico" className={`${INPUT} mt-0 sm:w-96`} />
        <select value={linea} onChange={(e) => setLinea(e.target.value)} className={`${INPUT} mt-0 sm:w-56`}>
          <option value="">Todas las líneas</option>
          {Object.entries(LINEA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-xs text-muted">{lista.length} productos · {multi} con más de un proveedor</span>
      </div>
      <p className="mt-2 text-xs text-muted">
        Al cotizar o comprar: aquí se ve quién maneja el mismo producto y a qué precio lo compramos la última vez,
        para pedir cotización a todos y elegir el mejor. Línea, origen y «Publicar» se aplican a todas las fuentes del producto.
      </p>
      <div className="mt-3 space-y-3">
        {isLoading && <p className="text-xs text-muted">Buscando…</p>}
        {lista.slice(0, 60).map((g) => <TarjetaProducto key={g.clave} g={g} />)}
        {lista.length > 60 && <p className="text-xs text-muted">Mostrando 60 de {lista.length}. Afina la búsqueda.</p>}
      </div>
    </>
  );
}

// ───────────────────────────── Comparador ─────────────────────────────

function Comparador() {
  const { data: coin } = useCoincidencias();
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [minimo, setMinimo] = useState(2);
  const { data, isLoading } = useComparador(sel, q, minimo);
  const provs = data?.proveedores ?? [];
  const filas = data?.filas ?? [];
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const columnas = provs.slice(0, sel.length ? sel.length : 8);

  return (
    <>
      <div className={`${CARD} mt-3`}>
        <h3 className="text-sm font-bold text-ink">Comparador de proveedores</h3>
        <p className="mt-1 text-xs text-muted">
          Cruza el nombre genérico de cada materia prima (sin marca ni presentación) entre proveedores. Selecciona los que
          quieras comparar; sin selección se muestran los 8 con más productos. Verde = último precio más bajo en COP.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(coin?.proveedores ?? []).map((p) => (
            <button key={p.id} className={`${BTN} ${sel.includes(p.id) ? "border-accent text-accent" : ""}`} onClick={() => toggle(p.id)}>
              {p.nombre} <span className="text-muted">({p.n_productos})</span>
            </button>
          ))}
          {sel.length > 0 && <button className={BTN} onClick={() => setSel([])}>Limpiar</button>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar materia prima…" className={`${INPUT} mt-0 sm:w-72`} />
          <label className="text-xs text-muted">
            Mínimo de proveedores
            <select value={minimo} onChange={(e) => setMinimo(Number(e.target.value))} className={`${INPUT} mt-0 ml-2 inline-block w-20`}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="text-xs text-muted">{data?.total_filas ?? 0} materias primas{minimo > 1 ? ` en ${minimo}+ proveedores` : ""}</span>
        </div>
      </div>

      {coin && coin.pares.length > 0 && (
        <div className={`${CARD} mt-3`}>
          <h4 className="text-sm font-bold text-ink">Quiénes se solapan más</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {coin.pares.slice(0, 10).map((p) => (
              <button key={`${p.a}-${p.b}`} className={BTN} onClick={() => setSel([p.a, p.b])} title="Comparar estos dos">
                {p.a_nombre} ↔ {p.b_nombre} <span className="text-accent">{p.n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-paper border border-border bg-surface-panel">
        <table className="w-full text-left text-xs" style={{ minWidth: 520 + columnas.length * 150 }}>
          <thead className="text-[10px] uppercase text-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-panel px-3 py-2">Materia prima</th>
              <th className="px-2 py-2">Línea</th>
              {columnas.map((p) => (
                <th key={p.id} className="px-2 py-2">{p.nombre}<br /><span className="font-normal normal-case text-muted">{p.pais || ""} · {p.n_productos}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={2 + columnas.length} className="px-3 py-4 text-muted">Comparando…</td></tr>}
            {filas.slice(0, 200).map((f) => (
              <tr key={f.clave} className="border-t border-border">
                <td className="sticky left-0 z-10 bg-surface-panel px-3 py-1.5 font-bold text-ink">{f.nombre}{f.cas && <span className="ml-1 font-mono text-[10px] font-normal text-muted">{f.cas}</span>}<span className="ml-1 text-[10px] font-normal text-muted">×{f.n_proveedores}</span></td>
                <td className="px-2 py-1.5 text-muted">{LINEA_LABEL[f.linea] ?? (f.linea || "—")}</td>
                {columnas.map((p) => {
                  const c = f.celdas[String(p.id)];
                  if (!c) return <td key={p.id} className="px-2 py-1.5 text-center text-muted">·</td>;
                  const mejor = f.mejor_pid === p.id;
                  return (
                    <td key={p.id} className={`px-2 py-1.5 ${mejor ? "rounded bg-emerald-100 font-bold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" : "text-ink"}`} title={`${c.nombre}${c.fecha ? ` · ${c.fecha}` : ""}${c.n_compras ? ` · ${c.n_compras} compras` : ""}`}>
                      {c.ultimo_precio ? fmtPrecio(c.ultimo_precio, c.moneda || "COP") : <span className="text-accent">✓ lo maneja</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!isLoading && filas.length === 0 && <tr><td colSpan={2 + columnas.length} className="px-3 py-4 text-center text-muted">Sin coincidencias con esos criterios.</td></tr>}
          </tbody>
        </table>
      </div>
      {filas.length > 200 && <p className="mt-2 text-xs text-muted">Mostrando 200 de {filas.length}. Filtra por nombre.</p>}
    </>
  );
}

// ───────────────────────────── Catálogos ─────────────────────────────

function RevisarLineas({
  lineas,
  catalogoId,
  proveedorSugerido,
  onListo,
}: {
  lineas: LineaCandidata[];
  catalogoId: number | null;
  proveedorSugerido?: { id: number | null; nombre: string; email?: string };
  onListo: () => void;
}) {
  const [sel, setSel] = useState<Set<number>>(() => new Set(lineas.map((_, i) => i)));
  const [filtro, setFiltro] = useState("");
  const [provId, setProvId] = useState<number | "">(proveedorSugerido?.id ?? "");
  const [provNombre, setProvNombre] = useState(proveedorSugerido?.id ? "" : proveedorSugerido?.nombre ?? "");
  const [moneda, setMoneda] = useState("COP");
  const [lineaCat, setLineaCat] = useState("");
  const [origen, setOrigen] = useState("");
  const [publicar, setPublicar] = useState(true);
  const { data: provs } = useProveedores("");
  const { data: cat } = useCatalogoPaises();
  const importar = useImportarLineasCatalogo();

  const visibles = lineas.map((l, i) => [l, i] as const).filter(([l]) => !filtro || l.nombre.toLowerCase().includes(filtro.toLowerCase()));
  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className={`${CARD} mt-3`}>
      <h4 className="text-sm font-bold text-ink">Revisar líneas detectadas ({lineas.length})</h4>
      <p className="text-xs text-muted">Extracción heurística (sin IA): desmarca lo que no sea producto. Se guardan solo las marcadas.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-muted">Proveedor existente
          <select value={provId} onChange={(e) => setProvId(e.target.value ? Number(e.target.value) : "")} className={INPUT}>
            <option value="">— nuevo (abajo) —</option>
            {(provs?.proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Nuevo proveedor
          <input value={provNombre} onChange={(e) => setProvNombre(e.target.value)} className={INPUT} disabled={provId !== ""} placeholder="Nombre si no existe" />
        </label>
        <label className="text-xs text-muted">Moneda de precios
          <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className={INPUT}>
            {["COP", "USD", "EUR", "CNY", "INR"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Línea (todas)
          <select value={lineaCat} onChange={(e) => setLineaCat(e.target.value)} className={INPUT}>
            <option value="">—</option>
            {Object.entries(LINEA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">País de origen (todas)
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={INPUT}>
            <option value="">—</option>
            {(cat?.paises ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar…" className={`${INPUT} mt-0 sm:w-56`} />
        <button className={BTN} onClick={() => setSel(new Set(visibles.map(([, i]) => i)))}>Marcar visibles</button>
        <button className={BTN} onClick={() => setSel(new Set())}>Desmarcar todo</button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} /> Publicar en «Cotizar» (web)
        </label>
        <span className="text-xs text-muted">{sel.size} seleccionadas</span>
      </div>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-paper border border-border">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 bg-surface-panel text-[10px] uppercase text-muted">
            <tr><th className="px-2 py-1"></th><th className="px-2 py-1">Producto</th><th className="px-2 py-1">Precio</th><th className="px-2 py-1">CAS</th><th className="px-2 py-1">Archivo</th></tr>
          </thead>
          <tbody>
            {visibles.map(([l, i]) => (
              <tr key={i} className={`border-t border-border ${sel.has(i) ? "" : "opacity-50"}`}>
                <td className="px-2 py-1"><input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} /></td>
                <td className="px-2 py-1 text-ink" title={l.fila}>{l.nombre}</td>
                <td className="px-2 py-1 text-ink-secondary">{l.precio != null ? l.precio.toLocaleString("es-CO") : "—"}</td>
                <td className="px-2 py-1 font-mono text-[11px] text-muted">{l.cas || "—"}</td>
                <td className="px-2 py-1 text-muted">{l.archivo ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          className={BTN_ACCENT}
          disabled={importar.isPending || sel.size === 0 || (provId === "" && !provNombre.trim())}
          onClick={() =>
            importar.mutate(
              {
                catalogoId,
                body: {
                  proveedor_id: provId === "" ? undefined : provId,
                  proveedor_nombre: provId === "" ? provNombre.trim() : undefined,
                  lineas: lineas.filter((_, i) => sel.has(i)),
                  moneda,
                  publicar_web: publicar,
                  linea: lineaCat,
                  origen_pais: origen,
                },
              },
              { onSuccess: onListo },
            )
          }
        >
          {importar.isPending ? "Guardando…" : `Guardar ${sel.size} productos`}
        </button>
        <button className={BTN} onClick={onListo}>Cancelar</button>
        {importar.isError && <span className="text-xs text-red-600">{(importar.error as Error).message}</span>}
        {importar.data && <span className="text-xs text-ink-secondary">Guardadas {importar.data.lineas} líneas, {importar.data.precios_nuevos} precios.</span>}
      </div>
    </div>
  );
}

function Catalogos() {
  const [dias, setDias] = useState(730);
  const [estado, setEstado] = useState("detectado");
  const { data, isLoading } = useCatalogos(estado);
  const escanear = useEscanearCatalogos();
  const extraer = useExtraerCatalogo();
  const actualizar = useActualizarCatalogo();
  const extraerUrl = useExtraerUrl();
  const catalogoWeb = useCatalogoWeb();
  const [url, setUrl] = useState("");
  const [revision, setRevision] = useState<{ lineas: LineaCandidata[]; catalogoId: number | null; sugerido?: { id: number | null; nombre: string; email?: string } } | null>(null);
  const lista = data?.catalogos ?? [];

  const abrir = (c: CatalogoCorreo) =>
    extraer.mutate(c.id, {
      onSuccess: (r) => {
        if (!r.ok) return;
        setRevision({ lineas: r.lineas, catalogoId: c.id, sugerido: { id: c.proveedor_id, nombre: c.proveedor_nombre ?? c.remitente, email: c.remitente_email } });
      },
    });

  return (
    <>
      <div className={`${CARD} mt-3`}>
        <h3 className="text-sm font-bold text-ink">Catálogos y listas de precios en el correo</h3>
        <p className="mt-1 text-xs text-muted">
          Busca en Gmail correos con adjuntos (PDF, Excel, CSV) que mencionen catálogo, lista de precios, portafolio o cotización.
          Solo registra metadatos; los productos se extraen cuando tú abres cada catálogo.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">Últimos días
            <input type="number" min={7} max={3650} value={dias} onChange={(e) => setDias(Number(e.target.value))} className={`${INPUT} w-28`} />
          </label>
          <button className={BTN_ACCENT} disabled={escanear.isPending} onClick={() => escanear.mutate({ dias })}>
            {escanear.isPending ? "Buscando en Gmail…" : "Buscar catálogos en Gmail"}
          </button>
          {escanear.data && (
            <span className="text-xs text-ink-secondary">
              {escanear.data.ok ? `${escanear.data.correos_revisados} correos revisados, ${escanear.data.catalogos_nuevos} catálogos nuevos` : escanear.data.error}
            </span>
          )}
          {escanear.isError && <span className="text-xs text-red-600">{(escanear.error as Error).message}</span>}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <label className="grow text-xs text-muted">Página web de un proveedor (lista de productos)
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://proveedor.com/productos" className={INPUT} />
          </label>
          <button
            className={BTN}
            disabled={extraerUrl.isPending || !url.trim()}
            onClick={() => catalogoWeb.mutate({ url: url.trim(), solo_extraer: true }, { onSuccess: (r) => r.ok && setRevision({ lineas: r.lineas, catalogoId: null }) })}
            title="Usa el extractor del dominio si existe (glotracol, interkrol, cadiep, productos3a, globalquimia) o la heurística genérica"
          >
            {catalogoWeb.isPending ? "Leyendo…" : "Leer catálogo web"}
          </button>
          {catalogoWeb.data && !catalogoWeb.data.ok && <span className="text-xs text-red-600">{catalogoWeb.data.error}</span>}
          {catalogoWeb.data?.ok && <span className="text-xs text-muted">{catalogoWeb.data.n ?? catalogoWeb.data.lineas?.length} líneas ({catalogoWeb.data.metodo})</span>}
        </div>
      </div>

      {revision && <RevisarLineas lineas={revision.lineas} catalogoId={revision.catalogoId} proveedorSugerido={revision.sugerido} onListo={() => setRevision(null)} />}
      {extraer.isPending && <p className="mt-3 text-xs text-muted">Descargando adjuntos y extrayendo líneas…</p>}
      {extraer.data && !extraer.data.ok && <p className="mt-3 text-xs text-red-600">{extraer.data.error}</p>}

      <div className="mt-3 flex items-center gap-2">
        {[["detectado", "Por revisar"], ["importado", "Importados"], ["omitido", "Omitidos"], ["", "Todos"]].map(([v, l]) => (
          <button key={v} className={`${BTN} ${estado === v ? "border-accent text-accent" : ""}`} onClick={() => setEstado(v)}>{l}</button>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto rounded-paper border border-border bg-surface-panel">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead className="text-[10px] uppercase text-muted">
            <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Remitente</th><th className="px-3 py-2">Asunto</th><th className="px-3 py-2">Adjuntos</th><th className="px-3 py-2">Proveedor</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2 text-muted">{c.fecha}</td>
                <td className="px-3 py-2 text-ink">{c.remitente}<br /><span className="text-[11px] text-muted">{c.remitente_email}</span></td>
                <td className="px-3 py-2 text-ink-secondary">{c.asunto}</td>
                <td className="px-3 py-2 text-muted">{c.adjuntos.map((a) => a.filename).join(", ")}</td>
                <td className="px-3 py-2 text-ink-secondary">{c.proveedor_nombre ?? <span className="text-muted">sin vincular</span>}{c.n_lineas > 0 && <span className="text-muted"> · {c.n_lineas} líneas</span>}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={BTN} onClick={() => abrir(c)}>Extraer productos</button>
                    {c.estado !== "omitido" && (
                      <button className={BTN} title="Omitir" onClick={() => actualizar.mutate({ id: c.id, datos: { estado: "omitido" } })}><Icon name="close" size={12} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && lista.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted">Nada por aquí. Pulsa «Buscar catálogos en Gmail».</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ───────────────────────────── Oferta web ─────────────────────────────

function OfertaWeb() {
  const { data } = useBuscarProductos("", { publicables: true });
  const publicar = usePublicarOfertaWeb();
  const autoclasificar = useAutoclasificar();
  const { data: res } = useProveedoresResumen();
  const lista = data?.productos ?? [];
  const sinLinea = lista.filter((g) => !g.linea).length;
  const sinOrigen = lista.filter((g) => g.origen_paises.length === 0).length;
  return (
    <>
      <div className={`${CARD} mt-3`}>
        <h3 className="text-sm font-bold text-ink">Sección «Cotizar» de mckennagroup.co</h3>
        <p className="mt-1 text-xs text-muted">
          Publica el listado de materias primas que McKenna puede conseguir a través de su red de proveedores.
          El cliente ve producto, línea, país de origen y presentaciones; <strong>nunca el proveedor</strong>. Lo que no
          está en stock solo se puede cotizar. El mapa del inicio también usa estos países de origen.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className={BTN_ACCENT} disabled={publicar.isPending} onClick={() => publicar.mutate()}>
            {publicar.isPending ? "Publicando…" : `Publicar ${lista.length} productos en la web`}
          </button>
          {publicar.data && <span className="text-xs text-ink-secondary">Publicados {publicar.data.n_productos} productos de {publicar.data.n_paises} países de origen.</span>}
          {publicar.isError && <span className="text-xs text-red-600">{(publicar.error as Error).message}</span>}
          {res && <span className="text-xs text-muted">{res.oferta_web_publicada ? "Hay una versión publicada." : "Aún no se ha publicado nada."}</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <button className={BTN} disabled={autoclasificar.isPending} onClick={() => autoclasificar.mutate({})}>
            {autoclasificar.isPending ? "Clasificando…" : "Sugerir línea y origen a los que faltan"}
          </button>
          <span className="text-xs text-muted">Reglas por nombre (ácido → Cosmética, goma guar → Pakistán…). No usa IA; revisa y corrige lo que no cuadre.</span>
          {autoclasificar.data && <span className="text-xs text-ink-secondary">{autoclasificar.data.actualizados} productos actualizados.</span>}
        </div>
        {(sinLinea > 0 || sinOrigen > 0) && (
          <p className="mt-2 text-xs text-orange-700 dark:text-orange-300">
            <Icon name="warning" size={12} /> {sinLinea} sin línea y {sinOrigen} sin país de origen: se publican igual, pero no se filtran por línea ni aparecen en el mapa.
          </p>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {lista.map((g) => <TarjetaProducto key={g.clave} g={g} />)}
        {lista.length === 0 && <p className="text-xs text-muted">Marca productos con «Publicar en Cotizar» desde Directorio, ¿Quién vende…? o al importar un catálogo.</p>}
      </div>
    </>
  );
}

// ───────────────────────────── Cotizaciones ─────────────────────────────

const ESTADO_SOL: Record<SolicitudCotizacion["estado"], string> = {
  nueva: "Nueva",
  en_proceso: "En proceso",
  enviada: "Enviada",
  cerrada: "Cerrada",
};

function Solicitud({ s }: { s: SolicitudCotizacion }) {
  const [resp, setResp] = useState(s.respuesta || "");
  const actualizar = useActualizarSolicitud();
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-ink">#{s.id} · {s.producto}{s.presentacion && <span className="font-normal text-muted"> · {s.presentacion}</span>}</h4>
          <p className="text-xs text-ink-secondary">
            {s.nombre}{s.empresa && ` (${s.empresa})`} · {s.email} {s.telefono && `· ${s.telefono}`} {s.ciudad && `· ${s.ciudad}`}
          </p>
          <p className="text-xs text-muted">{s.created_at} · cantidad: {s.cantidad || "—"}</p>
          {s.mensaje && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-secondary">“{s.mensaje}”</p>}
        </div>
        <select value={s.estado} onChange={(e) => actualizar.mutate({ id: s.id, datos: { estado: e.target.value } })} className={`${INPUT} mt-0 w-36`}>
          {Object.entries(ESTADO_SOL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {s.proveedores_posibles.length > 0 && (
        <p className="mt-2 text-xs text-ink-secondary">
          <strong className="text-ink">A quién consultar:</strong>{" "}
          {s.proveedores_posibles.map((p) => `${p.nombre}${p.ultimo_precio ? ` (últ. ${fmtPrecio(p.ultimo_precio)})` : ""}`).join(" · ")}
        </p>
      )}
      <label className="mt-3 block text-xs text-muted">Respuesta al cliente (se envía por correo)
        <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={4} className={INPUT} placeholder="Precio, presentación, tiempo de entrega, condiciones…" />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button className={BTN} disabled={actualizar.isPending} onClick={() => actualizar.mutate({ id: s.id, datos: { respuesta: resp } })}>Guardar</button>
        <button className={BTN_ACCENT} disabled={actualizar.isPending || !resp.trim() || !s.email} onClick={() => actualizar.mutate({ id: s.id, datos: { respuesta: resp, enviar_respuesta: true } })}>
          Enviar por correo
        </button>
        {actualizar.data?.envio_correo && <span className="text-xs text-ink-secondary">{actualizar.data.envio_correo}</span>}
      </div>
    </div>
  );
}

function Cotizaciones() {
  const [estado, setEstado] = useState("nueva");
  const { data, isLoading } = useSolicitudesCotizacion(estado);
  const lista = data?.solicitudes ?? [];
  return (
    <>
      <div className="mt-3 flex items-center gap-2">
        {[["nueva", "Nuevas"], ["en_proceso", "En proceso"], ["enviada", "Enviadas"], ["cerrada", "Cerradas"], ["", "Todas"]].map(([v, l]) => (
          <button key={v} className={`${BTN} ${estado === v ? "border-accent text-accent" : ""}`} onClick={() => setEstado(v)}>{l}</button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {isLoading && <p className="text-xs text-muted">Cargando…</p>}
        {lista.map((s) => <Solicitud key={s.id} s={s} />)}
        {!isLoading && lista.length === 0 && <p className="text-xs text-muted">Sin solicitudes en este estado. Llegan desde mckennagroup.co/cotizar.</p>}
      </div>
    </>
  );
}

// ───────────────────────────── Panel ─────────────────────────────

export default function ProveedoresPanel() {
  const [tab, setTab] = useState<Tab>("directorio");
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper border border-border bg-surface-panel">
          <Icon name="logistica-proveedores" size={20} weight="bold" className="text-accent" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-ink">Proveedores</h1>
          <p className="text-xs text-muted">Red de abastecimiento: quién vende qué, precio histórico y oferta cotizable en la web.</p>
        </div>
      </div>
      <Resumen />
      <nav className="mt-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-bold ${tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "directorio" && <Directorio />}
      {tab === "productos" && <QuienVende />}
      {tab === "comparador" && <Comparador />}
      {tab === "catalogos" && <Catalogos />}
      {tab === "oferta" && <OfertaWeb />}
      {tab === "cotizaciones" && <Cotizaciones />}
    </div>
  );
}
