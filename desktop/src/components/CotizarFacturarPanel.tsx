import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

interface ClienteResultado {
  id: string;
  nombre: string;
  identificacion: string;
  email: string;
  telefono: string;
  direccion: string;
}

interface ProductoResultado {
  codigo: string;
  nombre: string;
  type: string;
}

interface Linea {
  codigo: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
}

interface AccionResultado {
  ok: boolean;
  numero?: string;
  total?: number;
  cufe?: string;
  url?: string;
  enviado_whatsapp?: boolean;
  error?: string;
}

interface ProductoExtraido {
  nombre: string;
  cantidad: number;
  candidatos: ProductoResultado[];
}

interface ExtraccionResultado {
  ok: boolean;
  cliente?: { nombre: string; identificacion: string; telefono: string; correo: string; direccion: string };
  productos?: ProductoExtraido[];
  notas?: string;
  error?: string;
}

interface ConversacionWA {
  usuario_id: string;
  telefono: string;
  resumen: string;
  ultimo: string;
  n_mensajes: number;
}

function pesos(v: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);
}

function formatTelefono(tel: string): string {
  const d = (tel || "").replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("57") ? d.slice(2) : d;
  if (local.length === 10) return `+57 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return tel;
}

function formatFecha(iso: string): string {
  try {
    const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "ahora";
    if (mins < 60) return `hace ${mins} min`;
    const horas = Math.round(mins / 60);
    if (horas < 24) return `hace ${horas} h`;
    return `hace ${Math.round(horas / 24)} d`;
  } catch {
    return iso;
  }
}

export default function CotizarFacturarPanel() {
  // Cliente
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [resultadosCliente, setResultadosCliente] = useState<ClienteResultado[]>([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [nombre, setNombre] = useState("");
  const [identificacion, setIdentificacion] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [direccion, setDireccion] = useState("");

  // Productos
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [resultadosProducto, setResultadosProducto] = useState<ProductoResultado[]>([]);
  const [buscandoProducto, setBuscandoProducto] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>([]);

  const [notas, setNotas] = useState("");
  const [referencia, setReferencia] = useState("");
  const [enCurso, setEnCurso] = useState<"cotizar" | "facturar" | null>(null);
  const [resultado, setResultado] = useState<{ tipo: "cotizar" | "facturar"; data: AccionResultado } | null>(null);
  const [confirmarFactura, setConfirmarFactura] = useState(false);

  // Extracción desde conversación de WhatsApp
  const [textoConversacion, setTextoConversacion] = useState("");
  const [extrayendo, setExtrayendo] = useState(false);
  const [errorExtraccion, setErrorExtraccion] = useState<string | null>(null);
  const [productosPendientes, setProductosPendientes] = useState<ProductoExtraido[]>([]);
  const [conversaciones, setConversaciones] = useState<ConversacionWA[]>([]);
  const [cargandoConversaciones, setCargandoConversaciones] = useState(false);
  const [mostrarConversaciones, setMostrarConversaciones] = useState(false);
  const [filtroConversaciones, setFiltroConversaciones] = useState("");

  const conversacionesFiltradas = useMemo(() => {
    const q = filtroConversaciones.replace(/\D/g, "");
    if (!q) return conversaciones;
    return conversaciones.filter((c) => c.telefono.includes(q));
  }, [conversaciones, filtroConversaciones]);

  // Búsqueda de cliente (debounced)
  useEffect(() => {
    const q = busquedaCliente.trim();
    if (q.length < 2) {
      setResultadosCliente([]);
      return;
    }
    let cancelado = false;
    const t = window.setTimeout(() => {
      setBuscandoCliente(true);
      void api
        .get<{ items: ClienteResultado[] }>(`/api/facturacion/clientes/buscar?q=${encodeURIComponent(q)}`)
        .then((data) => {
          if (!cancelado) setResultadosCliente(data.items ?? []);
        })
        .catch(() => {
          if (!cancelado) setResultadosCliente([]);
        })
        .finally(() => {
          if (!cancelado) setBuscandoCliente(false);
        });
    }, 250);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [busquedaCliente]);

  // Búsqueda de producto (debounced)
  useEffect(() => {
    const q = busquedaProducto.trim();
    if (q.length < 1) {
      setResultadosProducto([]);
      return;
    }
    let cancelado = false;
    const t = window.setTimeout(() => {
      setBuscandoProducto(true);
      void api
        .get<{ items: ProductoResultado[] }>(`/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=20&excluir_combos=0`)
        .then((data) => {
          if (!cancelado) setResultadosProducto(data.items ?? []);
        })
        .catch(() => {
          if (!cancelado) setResultadosProducto([]);
        })
        .finally(() => {
          if (!cancelado) setBuscandoProducto(false);
        });
    }, 220);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [busquedaProducto]);

  function elegirCliente(c: ClienteResultado) {
    setNombre(c.nombre);
    setIdentificacion(c.identificacion);
    setTelefono(c.telefono);
    setCorreo(c.email);
    setDireccion(c.direccion);
    setBusquedaCliente("");
    setResultadosCliente([]);
  }

  async function agregarProducto(p: ProductoResultado, cantidadInicial = 1) {
    setBusquedaProducto("");
    setResultadosProducto([]);
    if (lineas.some((l) => l.codigo === p.codigo)) return;
    let precio = 0;
    try {
      const detalle = await api.get<{ ok: boolean; precio_lista?: number }>(
        `/api/siigo/productos/detalle?codigo=${encodeURIComponent(p.codigo)}`,
      );
      precio = detalle.precio_lista ?? 0;
    } catch {
      precio = 0;
    }
    setLineas((prev) => [
      ...prev,
      { codigo: p.codigo, nombre: p.nombre, cantidad: cantidadInicial || 1, precio_unitario: precio },
    ]);
  }

  async function procesarExtraccion(payload: { texto: string } | { usuario_id: string }) {
    setExtrayendo(true);
    setErrorExtraccion(null);
    try {
      const data = await api.post<ExtraccionResultado>("/api/facturacion/extraer-conversacion", payload);
      if (!data.ok) {
        setErrorExtraccion(data.error || "No se pudo extraer la información.");
        return;
      }
      const c = data.cliente;
      if (c) {
        if (c.nombre && !nombre.trim()) setNombre(c.nombre);
        if (c.identificacion && !identificacion.trim()) setIdentificacion(c.identificacion);
        if (c.telefono && !telefono.trim()) setTelefono(c.telefono);
        if (c.correo && !correo.trim()) setCorreo(c.correo);
        if (c.direccion && !direccion.trim()) setDireccion(c.direccion);
      }
      if (data.notas && !notas.trim()) setNotas(data.notas);

      const pendientes: ProductoExtraido[] = [];
      for (const p of data.productos ?? []) {
        if (p.candidatos.length === 1) {
          await agregarProducto(p.candidatos[0], p.cantidad || 1);
        } else {
          pendientes.push(p);
        }
      }
      if (pendientes.length > 0) setProductosPendientes((prev) => [...prev, ...pendientes]);
    } catch (e) {
      setErrorExtraccion((e as Error).message);
    } finally {
      setExtrayendo(false);
    }
  }

  async function ejecutarExtraccion() {
    const texto = textoConversacion.trim();
    if (!texto) return;
    await procesarExtraccion({ texto });
  }

  async function cargarConversaciones() {
    setCargandoConversaciones(true);
    try {
      const data = await api.get<{ items: ConversacionWA[] }>("/api/facturacion/conversaciones-wa?limit=40");
      setConversaciones(data.items ?? []);
    } catch {
      setConversaciones([]);
    } finally {
      setCargandoConversaciones(false);
    }
  }

  function alternarConversaciones() {
    const nuevoValor = !mostrarConversaciones;
    setMostrarConversaciones(nuevoValor);
    if (nuevoValor && conversaciones.length === 0) void cargarConversaciones();
  }

  async function elegirConversacion(c: ConversacionWA) {
    setMostrarConversaciones(false);
    if (!telefono.trim()) {
      const digitos = c.telefono.replace(/\D/g, "");
      if (digitos.length === 10 || digitos.length === 12) setTelefono(digitos);
    }
    await procesarExtraccion({ usuario_id: c.usuario_id });
  }

  function confirmarPendiente(idx: number, candidato: ProductoResultado, cantidad: number) {
    void agregarProducto(candidato, cantidad || 1);
    setProductosPendientes((prev) => prev.filter((_, i) => i !== idx));
  }

  function descartarPendiente(idx: number) {
    setProductosPendientes((prev) => prev.filter((_, i) => i !== idx));
  }

  function actualizarLinea(codigo: string, campo: "cantidad" | "precio_unitario", valor: number) {
    setLineas((prev) => prev.map((l) => (l.codigo === codigo ? { ...l, [campo]: valor } : l)));
  }

  function quitarLinea(codigo: string) {
    setLineas((prev) => prev.filter((l) => l.codigo !== codigo));
  }

  const total = lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0);
  const clienteListo = nombre.trim().length > 0 && telefono.trim().length > 0;
  const puedeCotizar = clienteListo && lineas.length > 0 && enCurso === null;
  const puedeFacturar = clienteListo && identificacion.trim().length > 0 && lineas.length > 0 && enCurso === null;

  async function ejecutarCotizar() {
    setEnCurso("cotizar");
    setResultado(null);
    try {
      const data = await api.post<AccionResultado>("/api/facturacion/cotizar", {
        cliente: { nombre, identificacion, correo, direccion },
        productos: lineas,
        telefono,
        notas,
      });
      setResultado({ tipo: "cotizar", data });
    } catch (e) {
      setResultado({ tipo: "cotizar", data: { ok: false, error: (e as Error).message } });
    } finally {
      setEnCurso(null);
    }
  }

  async function ejecutarFacturar() {
    if (!confirmarFactura) {
      setConfirmarFactura(true);
      return;
    }
    setConfirmarFactura(false);
    setEnCurso("facturar");
    setResultado(null);
    try {
      const data = await api.post<AccionResultado>("/api/facturacion/facturar-directo", {
        cliente: { nombre, identificacion, correo, direccion },
        productos: lineas,
        telefono,
        referencia,
      });
      setResultado({ tipo: "facturar", data });
    } catch (e) {
      setResultado({ tipo: "facturar", data: { ok: false, error: (e as Error).message } });
    } finally {
      setEnCurso(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Cotizar / Facturar directo</h2>
        <p className="text-xs text-muted">
          Venta ad-hoc por WhatsApp o trato directo — no ligada a un pedido de MeLi/la web. La
          cotización es solo un PDF informativo (sin DIAN); Facturar crea una factura electrónica
          real en Alegra. Ambas se envían por WhatsApp al cliente.
        </p>
      </div>

      {/* Extracción desde conversación de WhatsApp */}
      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">🪄 Extraer de conversación de WhatsApp</p>
        <p className="mb-2 text-xs text-muted">
          Elige la conversación real del cliente (nodo WhatsApp), o pega el texto manualmente
          abajo. Solo rellena los campos vacíos — revisa siempre antes de cotizar o facturar.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={alternarConversaciones}
            disabled={extrayendo}
            className="rounded-paper border-2 border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mostrarConversaciones ? "Ocultar conversaciones" : "🔎 Elegir conversación reciente"}
          </button>
          {cargandoConversaciones && <span className="text-xs text-muted">Cargando…</span>}
        </div>

        {mostrarConversaciones && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border/70">
            <input
              type="text"
              value={filtroConversaciones}
              onChange={(e) => setFiltroConversaciones(e.target.value)}
              placeholder="Filtrar por número…"
              className="w-full border-b border-border bg-surface px-3 py-2 text-xs text-ink outline-none"
            />
            <div className="max-h-56 overflow-y-auto">
              {conversacionesFiltradas.length === 0 && !cargandoConversaciones && (
                <p className="px-3 py-2 text-xs text-muted">Sin conversaciones recientes de clientes.</p>
              )}
              {conversacionesFiltradas.map((c) => (
                <button
                  key={c.usuario_id}
                  type="button"
                  disabled={extrayendo}
                  onClick={() => void elegirConversacion(c)}
                  className="block w-full border-b border-border/50 px-3 py-2 text-left text-xs last:border-0 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{formatTelefono(c.telefono)}</span>
                    <span className="shrink-0 text-[10px] text-muted">{formatFecha(c.ultimo)}</span>
                  </div>
                  {c.resumen && <p className="mt-0.5 truncate text-muted">{c.resumen}</p>}
                </button>
              ))}
            </div>
          </div>
        )}

        <textarea
          value={textoConversacion}
          onChange={(e) => setTextoConversacion(e.target.value)}
          placeholder='O pega aquí el texto manualmente: "Cliente: Hola, necesito 2kg de ácido cítrico..."'
          rows={4}
          className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!textoConversacion.trim() || extrayendo}
            onClick={() => void ejecutarExtraccion()}
            className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {extrayendo ? "Extrayendo…" : "Extraer del texto pegado"}
          </button>
          {errorExtraccion && <span className="text-xs text-red-600">{errorExtraccion}</span>}
        </div>
        {productosPendientes.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-ink">Productos por confirmar (no se agregaron solos):</p>
            {productosPendientes.map((p, idx) => (
              <div key={`${p.nombre}-${idx}`} className="rounded-lg border border-border/70 bg-surface p-2 text-xs">
                <p className="mb-1">
                  <span className="font-semibold text-ink">&ldquo;{p.nombre}&rdquo;</span>{" "}
                  <span className="text-muted">— cant. {p.cantidad}</span>
                </p>
                {p.candidatos.length === 0 ? (
                  <p className="text-muted">Sin coincidencia en Siigo/Alegra — búscalo manualmente abajo.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {p.candidatos.map((c) => (
                      <button
                        key={c.codigo}
                        type="button"
                        onClick={() => confirmarPendiente(idx, c, p.cantidad)}
                        className="rounded border border-border px-2 py-1 hover:border-accent hover:text-accent"
                      >
                        {c.codigo} — {c.nombre}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => descartarPendiente(idx)} className="mt-1 text-muted underline">
                  Descartar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cliente */}
      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Cliente</p>
        <div className="relative mb-3">
          <input
            type="text"
            value={busquedaCliente}
            onChange={(e) => setBusquedaCliente(e.target.value)}
            placeholder="Buscar cliente existente por nombre o identificación…"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {(resultadosCliente.length > 0 || buscandoCliente) && busquedaCliente.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface-panel shadow-paper-lg">
              {buscandoCliente && <p className="px-3 py-2 text-xs text-muted">Buscando…</p>}
              {!buscandoCliente && resultadosCliente.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted">Sin resultados — se creará como cliente nuevo.</p>
              )}
              {resultadosCliente.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => elegirCliente(c)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover"
                >
                  <span className="font-semibold text-ink">{c.nombre}</span>{" "}
                  <span className="text-muted">— {c.identificacion}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre completo *"
            className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="text"
            value={identificacion}
            onChange={(e) => setIdentificacion(e.target.value)}
            placeholder="Identificación (CC/NIT) — obligatoria para facturar"
            className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="text"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Teléfono WhatsApp * (ej. 3001234567)"
            className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="Correo (opcional)"
            className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            type="text"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Dirección (opcional)"
            className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent sm:col-span-2"
          />
        </div>
      </div>

      {/* Productos */}
      <div className="rounded-xl border border-border bg-surface-panel p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Productos</p>
        <div className="relative mb-3">
          <input
            type="text"
            value={busquedaProducto}
            onChange={(e) => setBusquedaProducto(e.target.value)}
            placeholder="Buscar producto por nombre o SKU…"
            className="w-full rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {(resultadosProducto.length > 0 || buscandoProducto) && busquedaProducto.trim().length >= 1 && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-paper-lg">
              {buscandoProducto && <p className="px-3 py-2 text-xs text-muted">Buscando…</p>}
              {resultadosProducto.map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => void agregarProducto(p)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover"
                >
                  <span className="font-mono text-ink">{p.codigo}</span>{" "}
                  <span className="text-ink-secondary">— {p.nombre}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lineas.length === 0 ? (
          <p className="text-xs text-muted">Sin productos agregados todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="py-1">SKU</th>
                  <th className="py-1">Producto</th>
                  <th className="py-1 text-right">Cant</th>
                  <th className="py-1 text-right">Precio unit. (con IVA)</th>
                  <th className="py-1 text-right">Subtotal</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lineas.map((l) => (
                  <tr key={l.codigo}>
                    <td className="py-1.5 font-mono text-ink">{l.codigo}</td>
                    <td className="py-1.5 text-ink-secondary">{l.nombre}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        value={l.cantidad}
                        onChange={(e) => actualizarLinea(l.codigo, "cantidad", Number(e.target.value) || 0)}
                        className="w-16 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs text-ink"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.precio_unitario}
                        onChange={(e) => actualizarLinea(l.codigo, "precio_unitario", Number(e.target.value) || 0)}
                        className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-right text-xs text-ink"
                      />
                    </td>
                    <td className="py-1.5 text-right font-semibold text-ink">{pesos(l.cantidad * l.precio_unitario)}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => quitarLinea(l.codigo)} className="text-muted hover:text-danger">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex justify-end text-sm font-bold text-ink">Total: {pesos(total)}</div>
          </div>
        )}
      </div>

      {/* Notas / referencia */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia interna (opcional, ej. trato/pedido)"
          className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <input
          type="text"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Notas para la cotización (opcional)"
          className="rounded-paper border-2 border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!puedeCotizar}
          onClick={() => void ejecutarCotizar()}
          className="rounded-paper border-2 border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enCurso === "cotizar" ? "Generando…" : "📋 Generar cotización (WhatsApp)"}
        </button>
        <button
          type="button"
          disabled={!puedeFacturar}
          onClick={() => void ejecutarFacturar()}
          className={`rounded-paper border-2 px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
            confirmarFactura
              ? "border-red-500 bg-red-500 text-white hover:bg-red-600"
              : "border-border text-ink hover:border-red-400 hover:text-red-600"
          }`}
        >
          {enCurso === "facturar"
            ? "Facturando…"
            : confirmarFactura
              ? "⚠️ Confirmar — crea factura DIAN real"
              : "🧾 Facturar (Alegra + WhatsApp)"}
        </button>
        {confirmarFactura && (
          <button
            type="button"
            onClick={() => setConfirmarFactura(false)}
            className="text-xs text-muted underline"
          >
            Cancelar
          </button>
        )}
        {!identificacion.trim() && (
          <span className="text-xs text-muted">Facturar necesita la identificación del cliente.</span>
        )}
      </div>

      {resultado && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            resultado.data.ok
              ? "border-green-300/50 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {resultado.data.ok ? (
            <>
              ✅ {resultado.tipo === "cotizar" ? "Cotización" : "Factura"} <strong>{resultado.data.numero}</strong> generada
              {resultado.data.total != null ? ` por ${pesos(resultado.data.total)}` : ""} y enviada por WhatsApp al cliente.
              {resultado.tipo === "facturar" && resultado.data.enviado_whatsapp === false && (
                <p className="mt-1">⚠️ El PDF no se pudo enviar al cliente por WhatsApp — revisa manual.</p>
              )}
              {resultado.data.url && (
                <a href={resultado.data.url} target="_blank" rel="noreferrer" className="mt-1 block underline">
                  Ver en Alegra
                </a>
              )}
            </>
          ) : (
            <>❌ {resultado.data.error || "No se pudo completar la acción."}</>
          )}
        </div>
      )}
    </div>
  );
}
