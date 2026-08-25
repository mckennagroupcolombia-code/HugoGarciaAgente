import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Icon } from "../icons";
import { HUB_TAB_LABEL, hubTabClass } from "../lib/hubTabClass";

type Modo = "producto" | "combo";

export type SiigoAltaInicial = { codigo: string; nombre: string };

function esCodigoCombo(codigo: string): boolean {
  return codigo.trim().toUpperCase().startsWith("C-");
}

function sugerirConsultaOrigen(sku: string): string {
  const s = sku.replace(/^c-\s*/i, "").trim();
  const stem = s.replace(/\d.*$/u, "").replace(/[-_]+$/g, "");
  return stem.length >= 2 ? stem : s;
}

interface DetalleComboSiigo {
  ok: boolean;
  error?: string;
  codigo?: string;
  nombre?: string;
  es_combo?: boolean;
  precio_lista?: number;
  iva?: boolean;
  componentes?: Array<{ codigo: string; nombre: string; cantidad: number }>;
}

interface SiigoResumen {
  codigo?: string;
  nombre?: string;
  unidad?: string;
  activo?: boolean;
  type?: string;
}

interface CrearResp {
  ok: boolean;
  mensaje?: string;
  error?: string;
  siigo_id?: string;
  siigo_producto?: SiigoResumen | null;
}

interface CodigoCheck {
  codigo: string;
  existe_en_siigo: boolean;
  duplicado: boolean;
  siigo_producto: SiigoResumen | null;
}

interface BusquedaItem {
  codigo: string;
  nombre: string;
  type?: string;
}

function esComboSiigo(item: BusquedaItem): boolean {
  const t = (item.type || "").toLowerCase();
  if (t === "combo") return true;
  if (t === "product") return false;
  return item.codigo.toUpperCase().startsWith("C-");
}

function mapUnidadSiigo(raw?: string): "Un" | "mL" | "g" {
  const u = (raw || "").toLowerCase();
  if (u.includes("gram") || u === "g" || u.includes("grm")) return "g";
  if (u.includes("mili") || u.includes("ml") || u.includes("mlt")) return "mL";
  return "Un";
}

interface ComponenteLinea {
  id: string;
  codigo: string;
  nombre: string;
  cantidad: string;
}

function cop(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function nuevaLinea(): ComponenteLinea {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    codigo: "",
    nombre: "",
    cantidad: "1",
  };
}

export default function CrearProductosSiigoPanel({
  compact = false,
  onCreado,
  inicial = null,
  accion = "crear",
}: {
  compact?: boolean;
  onCreado?: (info: { codigo: string; nombre: string }) => void;
  /** Precarga SKU y nombre (p. ej. desde una fila de Códigos EAN). */
  inicial?: SiigoAltaInicial | null;
  /** duplicar: fuerza combo y pide un combo origen para copiar la receta. */
  accion?: "crear" | "duplicar";
}) {
  const modoCompacto = compact;
  const duplicarCombo = accion === "duplicar";
  const codigoInicial = (inicial?.codigo || "").trim();
  const nombreInicial = (inicial?.nombre || "").trim();
  const naceComoCombo = duplicarCombo || esCodigoCombo(codigoInicial);
  const comboCodigoInicial = naceComoCombo
    ? esCodigoCombo(codigoInicial)
      ? codigoInicial
      : codigoInicial
        ? `C-${codigoInicial}`
        : "C-"
    : "C-";
  const [modo, setModo] = useState<Modo>(naceComoCombo ? "combo" : "producto");

  // Producto
  const [codigo, setCodigo] = useState(naceComoCombo ? "" : codigoInicial);
  const [nombre, setNombre] = useState(naceComoCombo ? "" : nombreInicial);
  const [unidad, setUnidad] = useState<"Un" | "mL" | "g">("Un");
  const [precioCosto, setPrecioCosto] = useState("");
  const [precioVenta, setPrecioVenta] = useState("");
  const [iva, setIva] = useState(true);

  // Combo
  const [comboCodigo, setComboCodigo] = useState(comboCodigoInicial);
  const [comboNombre, setComboNombre] = useState(naceComoCombo ? nombreInicial : "");
  const [comboPrecio, setComboPrecio] = useState("");
  const [comboIva, setComboIva] = useState(true);
  const [componentes, setComponentes] = useState<ComponenteLinea[]>([nuevaLinea()]);
  const [busqueda, setBusqueda] = useState("");
  const [sugerencias, setSugerencias] = useState<BusquedaItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [lineaActiva, setLineaActiva] = useState<string | null>(null);

  const [catalogoQ, setCatalogoQ] = useState(
    duplicarCombo ? sugerirConsultaOrigen(codigoInicial) : codigoInicial,
  );
  const [catalogoItems, setCatalogoItems] = useState<BusquedaItem[]>([]);
  const [catalogoBuscando, setCatalogoBuscando] = useState(false);
  const [catalogoAbierto, setCatalogoAbierto] = useState(duplicarCombo);
  const catalogoRef = useRef<HTMLDivElement>(null);
  const catalogoInputRef = useRef<HTMLInputElement>(null);

  const [origenCombo, setOrigenCombo] = useState<{ codigo: string; nombre: string } | null>(null);
  const [cargandoReceta, setCargandoReceta] = useState(false);
  const [errorReceta, setErrorReceta] = useState<string | null>(null);

  const [check, setCheck] = useState<CodigoCheck | null>(null);
  const [resultado, setResultado] = useState<CrearResp | null>(null);

  const codigoActivo = modo === "producto" ? codigo : comboCodigo;

  const verificarCodigo = useMutation({
    mutationFn: (c: string) =>
      api.post<CodigoCheck>("/api/facturas/codigo/check", { codigo: c }),
    onSuccess: (data) => {
      setCheck(data);
      setResultado(null);
    },
  });

  const autoCheckHecho = useRef(false);
  useEffect(() => {
    if (autoCheckHecho.current) return;
    if (codigoInicial.length < 2) return;
    autoCheckHecho.current = true;
    verificarCodigo.mutate(codigoInicial);
  }, [codigoInicial, verificarCodigo]);

  const crearProducto = useMutation({
    mutationFn: () =>
      api.post<CrearResp>("/api/siigo/productos", {
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        unidad,
        precio_costo: Number(precioCosto || 0),
        ...(Number(precioVenta || 0) > 0
          ? { precio_venta: Number(precioVenta) }
          : {}),
        iva,
      }),
    onSuccess: (res) => {
      setResultado(res);
      if (res.ok) {
        const creadoCodigo = res.siigo_producto?.codigo || codigo.trim();
        const creadoNombre = res.siigo_producto?.nombre || nombre.trim();
        setCheck({
          codigo: creadoCodigo,
          existe_en_siigo: true,
          duplicado: true,
          siigo_producto: res.siigo_producto || null,
        });
        onCreado?.({ codigo: creadoCodigo, nombre: creadoNombre });
      }
    },
    onError: (err: Error) => {
      setResultado({ ok: false, error: err.message });
    },
  });

  const crearCombo = useMutation({
    mutationFn: () =>
      api.post<CrearResp>("/api/siigo/combos", {
        codigo: comboCodigo.trim(),
        nombre: comboNombre.trim(),
        ...(Number(comboPrecio || 0) > 0
          ? { precio_lista: Number(comboPrecio) }
          : {}),
        iva: comboIva,
        componentes: componentes
          .filter((c) => c.codigo.trim())
          .map((c) => ({
            code: c.codigo.trim(),
            quantity: Number(c.cantidad || 1) || 1,
          })),
      }),
    onSuccess: (res) => {
      setResultado(res);
      if (res.ok) {
        const creadoCodigo = res.siigo_producto?.codigo || comboCodigo.trim();
        const creadoNombre = res.siigo_producto?.nombre || comboNombre.trim();
        setCheck({
          codigo: creadoCodigo,
          existe_en_siigo: true,
          duplicado: true,
          siigo_producto: res.siigo_producto || null,
        });
        onCreado?.({ codigo: creadoCodigo, nombre: creadoNombre });
      }
    },
    onError: (err: Error) => {
      setResultado({ ok: false, error: err.message });
    },
  });

  useEffect(() => {
    if (!catalogoAbierto) return;
    const onDoc = (e: MouseEvent) => {
      if (!catalogoRef.current?.contains(e.target as Node)) setCatalogoAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [catalogoAbierto]);

  useEffect(() => {
    if (!catalogoAbierto) return;
    const q = catalogoQ.trim();
    if (q.length < 1) {
      setCatalogoItems([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setCatalogoBuscando(true);
      void api
        .get<{ items: BusquedaItem[] }>(
          `/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=40&excluir_combos=0`,
        )
        .then((data) => {
          if (!cancelled) setCatalogoItems(data.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setCatalogoItems([]);
        })
        .finally(() => {
          if (!cancelled) setCatalogoBuscando(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [catalogoQ, catalogoAbierto]);

  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 1 || !lineaActiva) {
      setSugerencias([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      setBuscando(true);
      void api
        .get<{ items: BusquedaItem[] }>(
          `/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=40&excluir_combos=0`,
        )
        .then((data) => {
          if (!cancelled) setSugerencias(data.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setSugerencias([]);
        })
        .finally(() => {
          if (!cancelled) setBuscando(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [busqueda, lineaActiva]);

  const precioVentaSugerido = useMemo(() => {
    const costo = Number(precioCosto || 0);
    if (!costo) return 0;
    return Math.round(costo * 1.3);
  }, [precioCosto]);

  const creando = crearProducto.isPending || crearCombo.isPending;
  const existe = check?.existe_en_siigo || check?.duplicado;

  function resetFormulario() {
    setResultado(null);
    setCheck(null);
    if (modo === "producto") {
      setCodigo("");
      setNombre("");
      setUnidad("Un");
      setPrecioCosto("");
      setPrecioVenta("");
      setIva(true);
    } else {
      setComboCodigo("C-");
      setComboNombre("");
      setComboPrecio("");
      setComboIva(true);
      setComponentes([nuevaLinea()]);
      setBusqueda("");
      setSugerencias([]);
      setLineaActiva(null);
    }
  }

  function copiarRecetaCombo(codigoOrigen: string) {
    const origen = codigoOrigen.trim();
    if (origen.length < 2) return;
    setCatalogoAbierto(false);
    setErrorReceta(null);
    setCargandoReceta(true);
    void api
      .get<DetalleComboSiigo>(
        `/api/siigo/productos/detalle?codigo=${encodeURIComponent(origen)}`,
      )
      .then((data) => {
        if (!data.ok) {
          setErrorReceta(data.error || `No se pudo leer ${origen} en Siigo`);
          return;
        }
        if (!data.es_combo) {
          setErrorReceta(`${data.codigo || origen} no es un combo en Siigo`);
          return;
        }
        const comps = (data.componentes || []).filter((c) => (c.codigo || "").trim());
        if (comps.length < 1) {
          setErrorReceta(`${data.codigo} no tiene componentes para copiar`);
          return;
        }
        setModo("combo");
        setOrigenCombo({
          codigo: data.codigo || origen,
          nombre: data.nombre || "",
        });
        setComponentes(
          comps.map((c) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            codigo: c.codigo,
            nombre: c.nombre || "",
            cantidad: String(c.cantidad || 1),
          })),
        );
        if (Number(data.precio_lista || 0) > 0) {
          setComboPrecio(String(Math.round(Number(data.precio_lista))));
        }
        if (typeof data.iva === "boolean") setComboIva(data.iva);
        setResultado(null);
      })
      .catch((err: Error) => {
        setErrorReceta(err.message || "Error al copiar la receta");
      })
      .finally(() => setCargandoReceta(false));
  }

  function aplicarHallazgo(item: BusquedaItem) {
    if (duplicarCombo) {
      copiarRecetaCombo(item.codigo);
      return;
    }
    const combo = esComboSiigo(item);
    setResultado(null);
    setCatalogoAbierto(false);
    if (combo) {
      setModo("combo");
      setComboCodigo(item.codigo);
      setComboNombre(item.nombre);
    } else {
      setModo("producto");
      setCodigo(item.codigo);
      setNombre(item.nombre);
    }
    setCheck({
      codigo: item.codigo,
      existe_en_siigo: true,
      duplicado: true,
      siigo_producto: {
        codigo: item.codigo,
        nombre: item.nombre,
        type: item.type,
      },
    });
    verificarCodigo.mutate(item.codigo, {
      onSuccess: (data) => {
        const unidadSiigo = data.siigo_producto?.unidad;
        if (!combo && unidadSiigo) setUnidad(mapUnidadSiigo(unidadSiigo));
        if (data.siigo_producto?.nombre) {
          if (combo) setComboNombre(data.siigo_producto.nombre);
          else setNombre(data.siigo_producto.nombre);
        }
      },
    });
  }

  function onBuscarCatalogo() {
    setCatalogoAbierto(true);
    const q = catalogoQ.trim();
    if (q.length < 1) {
      catalogoInputRef.current?.focus();
      return;
    }
    setCatalogoBuscando(true);
    void api
      .get<{ items: BusquedaItem[] }>(
        `/api/siigo/productos/buscar?q=${encodeURIComponent(q)}&limit=40&excluir_combos=0`,
      )
      .then((data) => setCatalogoItems(data.items ?? []))
      .catch(() => setCatalogoItems([]))
      .finally(() => setCatalogoBuscando(false));
  }

  function onVerificar() {
    const c = codigoActivo.trim();
    if (c.length < 2) return;
    verificarCodigo.mutate(c);
  }

  function onCrear() {
    setResultado(null);
    if (modo === "producto") crearProducto.mutate();
    else crearCombo.mutate();
  }

  return (
    <div className={`mx-auto space-y-2.5 ${modoCompacto ? "max-w-none" : "max-w-3xl space-y-3"}`}>
      {!modoCompacto && (
        <div>
          <h2 className="text-base font-semibold text-ink">Crear productos y combos en Siigo</h2>
        </div>
      )}
      {codigoInicial && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink">
          {duplicarCombo ? (
            <>
              Duplicar combo hacia{" "}
              <span className="font-mono font-semibold text-accent">{comboCodigoInicial}</span>
              {nombreInicial ? ` · ${nombreInicial}` : ""}. Elige un combo existente para copiar
              su receta; el SKU y el nombre nuevos se mantienen.
            </>
          ) : (
            <>
              Datos del EAN: <span className="font-mono font-semibold text-accent">{codigoInicial}</span>
              {nombreInicial ? ` · ${nombreInicial}` : ""}. Puedes cambiar entre producto y combo; SKU y nombre se conservan.
            </>
          )}
        </p>
      )}

      <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
        {(
          [
            { id: "producto" as const, label: "Producto / insumo", icon: "package" as const },
            { id: "combo" as const, label: "Combo / kit", icon: "barcode" as const },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-label={t.label}
            onClick={() => {
              if (t.id !== modo) {
                if (t.id === "combo") {
                  const c = codigo.trim();
                  if (c && comboCodigo.replace(/^c-/i, "").trim() === "") {
                    setComboCodigo(esCodigoCombo(c) ? c : `C-${c}`);
                  }
                  if (nombre.trim() && !comboNombre.trim()) setComboNombre(nombre);
                } else {
                  const c = comboCodigo.trim();
                  if (c && !codigo.trim()) {
                    setCodigo(c.replace(/^c-/i, ""));
                  }
                  if (comboNombre.trim() && !nombre.trim()) setNombre(comboNombre);
                }
              }
              setModo(t.id);
              setResultado(null);
              setCheck(null);
            }}
            className={hubTabClass(modo === t.id, "flex-1 justify-center")}
          >
            <Icon name={t.icon} size={22} weight="bold" />
            <span className={HUB_TAB_LABEL}>{t.label}</span>
          </button>
        ))}
      </div>

      <div ref={catalogoRef} className="space-y-1 rounded-xl border-2 border-accent bg-accent/10 p-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-accent">
          {duplicarCombo ? "Combo origen (copiar receta)" : "Buscar productos y combos en Siigo"}
        </p>
        <div className="relative">
          <div className="flex gap-2">
            <input
              ref={catalogoInputRef}
              type="search"
              value={catalogoQ}
              onChange={(e) => {
                setCatalogoQ(e.target.value);
                setCatalogoAbierto(true);
              }}
              onFocus={() => {
                if (catalogoQ.trim().length >= 1 || catalogoItems.length > 0) {
                  setCatalogoAbierto(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const visibles = duplicarCombo
                    ? catalogoItems.filter(esComboSiigo)
                    : catalogoItems;
                  const first = visibles[0];
                  if (first) aplicarHallazgo(first);
                  else onBuscarCatalogo();
                }
              }}
              placeholder={duplicarCombo ? "Busca el combo a copiar (ej. C-UREA250g)" : "Código o nombre (ej. CARBON, C-AGUDES…)"}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={onBuscarCatalogo}
              className="mck-icon-btn inline-flex shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm hover:opacity-90"
              title="Buscar productos y combos existentes en Siigo"
              aria-label="Buscar"
            >
              <Icon name="search" size={16} weight="bold" />
            </button>
          </div>
          {catalogoAbierto && (catalogoQ.trim().length >= 1 || catalogoBuscando || catalogoItems.length > 0) && (
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-xl">
              {catalogoBuscando && (
                <p className="px-3 py-2 text-[11px] text-muted">Buscando en Siigo…</p>
              )}
              {!catalogoBuscando && catalogoQ.trim().length >= 1 && catalogoItems.length === 0 && (
                <p className="px-3 py-2 text-[11px] text-muted">
                  {duplicarCombo
                    ? "Sin coincidencias. Prueba el código del combo origen (C-…)."
                    : "Sin coincidencias — puedes crear el producto o combo abajo"}
                </p>
              )}
              {(duplicarCombo ? catalogoItems.filter(esComboSiigo) : catalogoItems).map((s) => {
                const combo = esComboSiigo(s);
                return (
                  <button
                    key={s.codigo}
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-accent/10"
                    onClick={() => aplicarHallazgo(s)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-ink">{s.codigo}</span>
                      <span
                        className={`rounded px-1 py-px text-[8px] font-bold uppercase ${
                          combo
                            ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
                            : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                        }`}
                      >
                        {combo ? "Combo" : "Producto"}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-[10px] text-muted">{s.nombre}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {duplicarCombo && (
        <div className="space-y-1">
          {cargandoReceta && (
            <p className="text-xs text-muted">Leyendo receta del combo origen en Siigo…</p>
          )}
          {errorReceta && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {errorReceta}
            </p>
          )}
          {origenCombo && !errorReceta && (
            <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-ink">
              Receta copiada de{" "}
              <span className="font-mono font-semibold">{origenCombo.codigo}</span>
              {origenCombo.nombre ? ` · ${origenCombo.nombre}` : ""}. Revisa componentes y crea el combo nuevo.
            </p>
          )}
        </div>
      )}

      {modo === "producto" ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-surface-panel p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Código</span>
              <div className="flex gap-2">
                <input
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(e.target.value.replace(/\s/g, ""));
                    setCheck(null);
                    setResultado(null);
                  }}
                  placeholder="Ej: NIAC100g"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={onVerificar}
                  disabled={codigo.trim().length < 2 || verificarCodigo.isPending}
                  className="mck-icon-btn inline-flex shrink-0 items-center justify-center rounded-lg border border-border text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                  title="Verificar código en Siigo"
                  aria-label="Verificar"
                >
                  {verificarCodigo.isPending ? "…" : <Icon name="check" size={16} weight="bold" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (codigo.trim() && catalogoQ.trim().length < 1) setCatalogoQ(codigo.trim());
                    setCatalogoAbierto(true);
                    window.setTimeout(() => catalogoInputRef.current?.focus(), 30);
                    catalogoInputRef.current?.scrollIntoView({ block: "nearest" });
                  }}
                  className="mck-icon-btn inline-flex shrink-0 items-center justify-center rounded-lg border border-accent bg-accent text-white hover:opacity-90"
                  title="Buscar productos y combos en Siigo"
                  aria-label="Buscar"
                >
                  <Icon name="search" size={16} weight="bold" />
                </button>
              </div>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Unidad</span>
              <select
                value={unidad}
                onChange={(e) => setUnidad(e.target.value as "Un" | "mL" | "g")}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="Un">Unidades</option>
                <option value="g">Gramos</option>
                <option value="mL">Mililitros</option>
              </select>
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Nombre</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre en Siigo (máx. 100)"
                maxLength={100}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Costo (sin IVA, opcional)
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={precioCosto}
                onChange={(e) => setPrecioCosto(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Precio lista (opcional)
                {precioVentaSugerido > 0 && !precioVenta
                  ? ` · sug. ${cop(precioVentaSugerido)}`
                  : ""}
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
                placeholder="Vacío = sin lista de precios"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={iva}
              onChange={(e) => setIva(e.target.checked)}
              className="accent-accent"
            />
            Incluye IVA (19%)
          </label>
        </div>
      ) : (
        <div className="space-y-2.5 rounded-xl border border-border bg-surface-panel p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Código combo
              </span>
              <div className="flex gap-2">
                <input
                  value={comboCodigo}
                  onChange={(e) => {
                    setComboCodigo(e.target.value.replace(/\s/g, ""));
                    setCheck(null);
                    setResultado(null);
                  }}
                  placeholder="C-PRODUCTO100g"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={onVerificar}
                  disabled={comboCodigo.trim().length < 2 || verificarCodigo.isPending}
                  className="mck-icon-btn inline-flex shrink-0 items-center justify-center rounded-lg border border-border text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                  title="Verificar código en Siigo"
                  aria-label="Verificar"
                >
                  {verificarCodigo.isPending ? "…" : <Icon name="check" size={16} weight="bold" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (comboCodigo.trim() && catalogoQ.trim().length < 1) {
                      setCatalogoQ(comboCodigo.trim());
                    }
                    setCatalogoAbierto(true);
                    window.setTimeout(() => catalogoInputRef.current?.focus(), 30);
                    catalogoInputRef.current?.scrollIntoView({ block: "nearest" });
                  }}
                  className="mck-icon-btn inline-flex shrink-0 items-center justify-center rounded-lg border border-accent bg-accent text-white hover:opacity-90"
                  title="Buscar productos y combos en Siigo"
                  aria-label="Buscar"
                >
                  <Icon name="search" size={16} weight="bold" />
                </button>
              </div>
              <p className="text-[10px] text-muted">Convención McKenna: prefijo C-</p>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Precio lista (opcional)
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={comboPrecio}
                onChange={(e) => setComboPrecio(e.target.value)}
                placeholder="Vacío = sin lista de precios"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Nombre</span>
              <input
                value={comboNombre}
                onChange={(e) => setComboNombre(e.target.value)}
                placeholder="Nombre del kit / combo"
                maxLength={100}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={comboIva}
              onChange={(e) => setComboIva(e.target.checked)}
              className="accent-accent"
            />
            Incluye IVA (19%)
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                Componentes
              </p>
              <button
                type="button"
                onClick={() => setComponentes((prev) => [...prev, nuevaLinea()])}
                title="Agregar línea"
                aria-label="Agregar línea"
                className="inline-flex items-center justify-center text-accent hover:opacity-80"
              >
                <Icon name="plus" size={16} weight="bold" />
              </button>
            </div>
            <p className="text-[10px] text-muted">
              Puedes agregar insumos o combos existentes (ej. C-AGUDES250mL): Siigo no acepta
              combo-dentro-de-combo, así que la app expande automáticamente a sus productos.
            </p>
            <div className="space-y-2">
              {componentes.map((linea) => (
                <div
                  key={linea.id}
                  className="relative grid grid-cols-[1fr_5.5rem_auto] gap-2 rounded-lg border border-border/70 bg-surface p-2"
                >
                  <div>
                    <input
                      value={linea.codigo || (lineaActiva === linea.id ? busqueda : "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLineaActiva(linea.id);
                        setBusqueda(v);
                        setComponentes((prev) =>
                          prev.map((c) =>
                            c.id === linea.id ? { ...c, codigo: "", nombre: "" } : c,
                          ),
                        );
                      }}
                      onFocus={() => {
                        setLineaActiva(linea.id);
                        setBusqueda(linea.codigo || linea.nombre || "");
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const typed = (busqueda || linea.codigo || "").trim();
                        if (!typed) return;
                        const match =
                          sugerencias.find((s) => s.codigo.toUpperCase() === typed.toUpperCase())
                          || sugerencias[0];
                        const codigoSel = match?.codigo || typed.replace(/\s/g, "");
                        const nombreSel = match?.nombre || "";
                        setComponentes((prev) =>
                          prev.map((c) =>
                            c.id === linea.id
                              ? { ...c, codigo: codigoSel, nombre: nombreSel }
                              : c,
                          ),
                        );
                        setLineaActiva(null);
                        setBusqueda("");
                        setSugerencias([]);
                      }}
                      placeholder="Buscar código o nombre… (Enter para usar)"
                      className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
                    />
                    {linea.nombre && (
                      <p className="mt-0.5 truncate text-[10px] text-muted">{linea.nombre}</p>
                    )}
                    {lineaActiva === linea.id && (sugerencias.length > 0 || buscando || busqueda.trim().length >= 1) && (
                      <div className="absolute left-2 right-2 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-lg">
                        {buscando && (
                          <p className="px-3 py-2 text-[11px] text-muted">Buscando en Siigo…</p>
                        )}
                        {!buscando && sugerencias.length === 0 && busqueda.trim().length >= 1 && (
                          <button
                            type="button"
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent/10"
                            onClick={() => {
                              const codigoSel = busqueda.trim().replace(/\s/g, "");
                              setComponentes((prev) =>
                                prev.map((c) =>
                                  c.id === linea.id
                                    ? { ...c, codigo: codigoSel, nombre: "" }
                                    : c,
                                ),
                              );
                              setLineaActiva(null);
                              setBusqueda("");
                              setSugerencias([]);
                            }}
                          >
                            <span className="font-mono text-xs font-bold text-ink">
                              Usar código: {busqueda.trim().replace(/\s/g, "")}
                            </span>
                            <span className="text-[10px] text-muted">
                              No apareció en la lista — se enviará tal cual a Siigo
                            </span>
                          </button>
                        )}
                        {sugerencias.map((s) => {
                          const comboSug = esComboSiigo(s);
                          return (
                          <button
                            key={s.codigo}
                            type="button"
                            className="flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-accent/10"
                            onClick={() => {
                              setComponentes((prev) =>
                                prev.map((c) =>
                                  c.id === linea.id
                                    ? { ...c, codigo: s.codigo, nombre: s.nombre }
                                    : c,
                                ),
                              );
                              setLineaActiva(null);
                              setBusqueda("");
                              setSugerencias([]);
                            }}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-ink">{s.codigo}</span>
                              <span
                                className={`rounded px-1 py-px text-[8px] font-bold uppercase ${
                                  comboSug
                                    ? "bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
                                    : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                                }`}
                              >
                                {comboSug ? "Combo" : "Producto"}
                              </span>
                            </span>
                            <span className="text-[10px] text-muted">{s.nombre}</span>
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={linea.cantidad}
                    onChange={(e) =>
                      setComponentes((prev) =>
                        prev.map((c) =>
                          c.id === linea.id ? { ...c, cantidad: e.target.value } : c,
                        ),
                      )
                    }
                    className="rounded-md border border-border bg-surface-panel px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
                    title="Cantidad"
                  />
                  <button
                    type="button"
                    disabled={componentes.length <= 1}
                    onClick={() =>
                      setComponentes((prev) => prev.filter((c) => c.id !== linea.id))
                    }
                    className="rounded-md px-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/20"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {check && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            existe
              ? "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200"
              : "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300"
          }`}
        >
          {existe ? (
            <>
              El código <span className="font-mono font-bold">{check.codigo}</span> ya existe
              {check.siigo_producto?.nombre ? ` — ${check.siigo_producto.nombre}` : ""}.
            </>
          ) : (
            <>
              Código <span className="font-mono font-bold">{check.codigo}</span> disponible en Siigo.
            </>
          )}
        </div>
      )}

      {resultado && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            resultado.ok
              ? "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
              : "border-red-300/50 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {resultado.ok
            ? resultado.mensaje || "Creado en Siigo"
            : resultado.error || "No se pudo crear"}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCrear}
          disabled={
            creando
            || existe
            || (modo === "producto"
              ? !codigo.trim() || !nombre.trim()
              : !comboCodigo.trim()
                || !comboNombre.trim()
                || componentes.every((c) => !c.codigo.trim()))
          }
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-40"
        >
          {creando
            ? "Creando en Siigo…"
            : modo === "producto"
              ? "Crear producto en Siigo"
              : "Crear combo en Siigo"}
        </button>
        <button
          type="button"
          onClick={resetFormulario}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent"
        >
          Limpiar
        </button>
      </div>

      <p className={`text-muted ${modoCompacto ? "text-[10px]" : "text-xs"}`}>
        Los productos usan categoría de inventario 297 (Productos). Los combos heredan la
        clasificación de un combo existente. Requiere plan Siigo Nube Premium para combos.
      </p>
    </div>
  );
}
