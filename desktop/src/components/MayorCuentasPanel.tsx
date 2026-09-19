import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";
import { Icon } from "../icons";
import "./libroMayor.css";

/**
 * Libro Mayor discriminado por cuenta contable.
 *
 * El libro ya tenía los asientos, pero para verlos por cuenta solo había un
 * desplegable plano de 39 cuentas que pintaba una cuenta T sin saldo corrido, y
 * un balance de una sola lista del que no se podía entrar a nada. Un contador
 * no trabaja así: baja por clase → grupo → cuenta → subcuenta hasta encontrar
 * la cifra rara y ahí pide el extracto de ESA cuenta.
 *
 * Eso es esta vista, en tres pasos: (1) el período, (2) el árbol del PUC con
 * saldos en cada nivel, (3) el extracto de la cuenta elegida — cada línea con
 * su contrapartida y el saldo corrido, el resumen por tercero, y el mismo
 * documento en PDF o CSV para el contador.
 *
 * La contrapartida va en el renglón, no escondida tras un clic: un extracto de
 * 2205 sin ella es una columna de cifras sin causa.
 */

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

interface NodoArbol {
  codigo: string;
  nombre: string;
  nivel: "clase" | "grupo" | "cuenta" | "subcuenta" | "detalle";
  tipo: string;
  naturaleza: "debito" | "credito";
  cuenta_id: number | null;
  existe: boolean;
  activa: boolean;
  es_movimiento: boolean;
  propio: { saldo_inicial: number; debito: number; credito: number; lineas: number; saldo_final: number };
  saldo_inicial: number;
  debito: number;
  credito: number;
  saldo_final: number;
  lineas: number;
  hijos: NodoArbol[];
  /** Qué operación vive en la cuenta y qué impuestos acarrea (puc_colombia
   *  DESCRIPCIONES + impuestos_por_cuenta). Va pegada a la cuenta para que el
   *  contador no tenga que preguntarle a quien asentó qué significa un saldo. */
  descripcion?: string;
  nota_tributaria?: string;
  /** Auxiliar por tercero de lo asentado directamente en la cuenta. */
  terceros?: TerceroEnCuenta[];
}

interface TerceroEnCuenta {
  tercero_id: number | null;
  nombre: string;
  identificacion: string;
  saldo_inicial: number;
  debito: number;
  credito: number;
  saldo_final: number;
  lineas: number;
}

interface AuxTercero {
  tercero_id: number | null;
  nombre: string;
  identificacion: string;
  tipo: string;
  por_pagar: number;
  por_cobrar: number;
  debito: number;
  credito: number;
  lineas: number;
  cuentas: {
    cuenta_id: number;
    codigo: string;
    nombre: string;
    tipo: string;
    saldo_inicial: number;
    debito: number;
    credito: number;
    saldo_final: number;
    lineas: number;
  }[];
}

interface Arbol {
  desde: string | null;
  hasta: string | null;
  arbol: NodoArbol[];
  total_debito: number;
  total_credito: number;
  cuadra: boolean;
}

interface Contrapartida {
  codigo: string;
  nombre: string;
  cuenta_id: number;
  valor: number;
  lado: "debito" | "credito";
}

interface LineaExtracto {
  linea_id: number;
  movimiento_id: number;
  fecha: string;
  concepto: string;
  referencia: string;
  tipo_origen: string;
  descripcion: string;
  tercero_id: number | null;
  tercero_nombre: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  debito: number;
  credito: number;
  saldo: number;
  contrapartida: Contrapartida[];
}

interface ResumenTercero {
  tercero_id: number | null;
  nombre: string;
  debito: number;
  credito: number;
  saldo: number;
  movimientos: number;
}

interface Extracto {
  cuenta: {
    id: number; codigo: string; nombre: string; tipo: string; naturaleza: "debito" | "credito";
    descripcion?: string; nota_tributaria?: string;
  };
  desde: string | null;
  hasta: string | null;
  incluir_subcuentas: boolean;
  saldo_inicial: number;
  movimientos: LineaExtracto[];
  total_debito: number;
  total_credito: number;
  saldo_final: number;
  truncado: boolean;
  por_tercero: ResumenTercero[];
}

/* ─── Formato ────────────────────────────────────────────────────────────── */

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

/** Cifra en la tabla: los ceros se vuelven guion para que la vista respire. */
function cifra(n: number): string {
  return n ? cop(n) : "—";
}

const TIPO_COLOR: Record<string, string> = {
  activo: "text-sky-700 dark:text-sky-300",
  pasivo: "text-amber-700 dark:text-amber-300",
  patrimonio: "text-violet-700 dark:text-violet-300",
  ingreso: "text-emerald-700 dark:text-emerald-300",
  gasto: "text-rose-700 dark:text-rose-300",
  costo: "text-orange-700 dark:text-orange-300",
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function primerDiaMes(offsetMeses = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMeses);
  return d.toISOString().slice(0, 10);
}

function ultimoDiaMes(offsetMeses = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMeses + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

interface Periodo {
  desde: string;
  hasta: string;
  etiqueta: string;
}

const PRESETS: { id: string; label: string; calc: () => Periodo }[] = [
  { id: "mes", label: "Este mes", calc: () => ({ desde: primerDiaMes(), hasta: hoyISO(), etiqueta: "Este mes" }) },
  {
    id: "mes-pasado",
    label: "Mes pasado",
    calc: () => ({ desde: primerDiaMes(-1), hasta: ultimoDiaMes(-1), etiqueta: "Mes pasado" }),
  },
  {
    id: "anio",
    label: "Este año",
    calc: () => ({ desde: `${new Date().getFullYear()}-01-01`, hasta: hoyISO(), etiqueta: "Este año" }),
  },
  { id: "todo", label: "Todo el libro", calc: () => ({ desde: "", hasta: "", etiqueta: "Todo el libro" }) },
];

/* ─── Panel ──────────────────────────────────────────────────────────────── */

type CuentaSel = { id: number; codigo: string; nombre: string };

export default function MayorCuentasPanel() {
  // Arranca en el año: es lo que un contador mira primero (saldos acumulados),
  // y un mes suelto deja el balance a medias.
  const [preset, setPreset] = useState("anio");
  const [rango, setRango] = useState<Periodo>(() => PRESETS.find((p) => p.id === "anio")!.calc());
  const [vista, setVista] = useState<"cuentas" | "terceros">("cuentas");
  const [cuentaSel, setCuentaSel] = useState<CuentaSel | null>(null);
  const [subcuentas, setSubcuentas] = useState(false);
  const [terceroFiltro, setTerceroFiltro] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (rango.desde) params.set("desde", rango.desde);
  if (rango.hasta) params.set("hasta", rango.hasta);

  const arbolQ = useQuery<Arbol>({
    queryKey: ["cc-arbol", rango.desde, rango.hasta, "terceros"],
    queryFn: () => api.get(`/api/contabilidad/cc/arbol?${params.toString()}&terceros=1`),
    staleTime: 30_000,
  });

  // Elegir una cuenta fija también el tercero: los terceros de 2205 no son los
  // de 1110 y arrastrar el filtro anterior mostraría un extracto vacío sin
  // explicar por qué.
  const abrirCuenta = (c: CuentaSel, tercero: number | null = null) => {
    setCuentaSel(c);
    setTerceroFiltro(tercero);
  };

  const aplicarPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p) setRango(p.calc());
  };

  return (
    <div className="lm-root space-y-3">
      <PasosMayor cuentaSel={cuentaSel} periodo={rango.etiqueta} vista={vista} />

      {/* Paso 1 — período */}
      <div className="lm-card p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => aplicarPreset(p.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                preset === p.id
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-panel text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={rango.desde}
              onChange={(e) => {
                setPreset("custom");
                setRango((r) => ({ ...r, desde: e.target.value, etiqueta: "Rango elegido" }));
              }}
              className="lm-input !py-1 text-xs"
              aria-label="Desde"
            />
            <span className="text-xs text-muted">a</span>
            <input
              type="date"
              value={rango.hasta}
              onChange={(e) => {
                setPreset("custom");
                setRango((r) => ({ ...r, hasta: e.target.value, etiqueta: "Rango elegido" }));
              }}
              className="lm-input !py-1 text-xs"
              aria-label="Hasta"
            />
          </span>
        </div>
        {arbolQ.data && (
          <p className={`text-[11px] font-bold ${arbolQ.data.cuadra ? "text-emerald-600" : "text-danger"}`}>
            {arbolQ.data.cuadra
              ? `✓ Partida doble cuadrada — ${cop(arbolQ.data.total_debito)} al débito y al crédito`
              : `✗ El libro no cuadra: ${cop(arbolQ.data.total_debito)} al débito contra ${cop(
                  arbolQ.data.total_credito,
                )} al crédito`}
          </p>
        )}
      </div>

      {arbolQ.data && <ResumenClases arbol={arbolQ.data} />}

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Ver el libro por">
        {([
          ["cuentas", "Por cuenta (PUC)", "book"],
          ["terceros", "Por tercero", "users"],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              vista === id ? "bg-accent text-white" : "border border-border bg-surface-panel text-muted hover:text-ink"
            }`}
          >
            <Icon name={icon} size={14} weight="bold" />
            {label}
          </button>
        ))}
      </div>

      <div className={`grid gap-3 ${cuentaSel ? "2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : ""}`}>
        {/* Paso 2 — árbol del PUC o auxiliar por tercero */}
        {vista === "cuentas" ? (
          <ArbolCuentas
            datos={arbolQ.data}
            cargando={arbolQ.isLoading}
            error={arbolQ.error as Error | null}
            seleccionada={cuentaSel?.id ?? null}
            terceroSel={terceroFiltro}
            compacto={Boolean(cuentaSel)}
            onSeleccionar={(n, tercero) =>
              n.cuenta_id && abrirCuenta({ id: n.cuenta_id, codigo: n.codigo, nombre: n.nombre }, tercero ?? null)
            }
            desde={rango.desde}
            hasta={rango.hasta}
          />
        ) : (
          <AuxiliarTerceros
            desde={rango.desde}
            hasta={rango.hasta}
            seleccion={cuentaSel ? { cuenta: cuentaSel.id, tercero: terceroFiltro } : null}
            compacto={Boolean(cuentaSel)}
            onSeleccionar={abrirCuenta}
          />
        )}

        {/* Paso 3 — extracto */}
        {cuentaSel ? (
          <ExtractoCuenta
            cuenta={cuentaSel}
            desde={rango.desde}
            hasta={rango.hasta}
            subcuentas={subcuentas}
            onSubcuentas={setSubcuentas}
            terceroFiltro={terceroFiltro}
            onTerceroFiltro={setTerceroFiltro}
            onCerrar={() => {
              setCuentaSel(null);
              setTerceroFiltro(null);
            }}
          />
        ) : (
          <p className="text-center text-xs text-muted">
            {vista === "cuentas"
              ? "Toca el nombre de una cuenta (o de un tercero dentro de ella) para ver su extracto: cada causación con su contrapartida y el saldo corrido."
              : "Abre un tercero y toca una de sus cuentas para ver cada causación a su nombre."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Resumen por clase (lo que se ve primero) ───────────────────────────── */

function ResumenClases({ arbol }: { arbol: Arbol }) {
  const clase = (c: string) => arbol.arbol.find((n) => n.codigo === c)?.saldo_final ?? 0;
  const ingresos = clase("4");
  const egresos = clase("5") + clase("6") + clase("7");
  const tarjetas = [
    { label: "Activo", valor: clase("1"), cls: TIPO_COLOR.activo },
    { label: "Pasivo", valor: clase("2"), cls: TIPO_COLOR.pasivo },
    { label: "Patrimonio", valor: clase("3"), cls: TIPO_COLOR.patrimonio },
    { label: "Ingresos", valor: ingresos, cls: TIPO_COLOR.ingreso },
    { label: "Gastos y costos", valor: egresos, cls: TIPO_COLOR.gasto },
    { label: "Resultado del período", valor: ingresos - egresos, cls: ingresos - egresos < 0 ? "text-danger" : "text-accent" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {tarjetas.map((t) => (
        <div key={t.label} className="lm-card px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{t.label}</p>
          <p className={`mt-0.5 truncate text-base font-extrabold tabular-nums ${t.cls}`}>{cop(t.valor)}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── Auxiliar por tercero ───────────────────────────────────────────────── */

function AuxiliarTerceros({
  desde,
  hasta,
  seleccion,
  compacto,
  onSeleccionar,
}: {
  desde: string;
  hasta: string;
  seleccion: { cuenta: number; tercero: number | null } | null;
  compacto: boolean;
  onSeleccionar: (c: CuentaSel, tercero: number | null) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const p = new URLSearchParams();
  if (desde) p.set("desde", desde);
  if (hasta) p.set("hasta", hasta);
  const q = useQuery<{ terceros: AuxTercero[] }>({
    queryKey: ["cc-aux-terceros", desde, hasta],
    queryFn: () => api.get(`/api/contabilidad/cc/auxiliar-terceros?${p.toString()}`),
    staleTime: 30_000,
  });
  const lista = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    const todos = q.data?.terceros ?? [];
    if (!t) return todos;
    return todos.filter((x) => x.nombre.toLowerCase().includes(t) || x.identificacion.includes(t));
  }, [q.data, busqueda]);

  const alternar = (id: number) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <div className="lm-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Auxiliar por tercero</p>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre o NIT…"
          className="lm-input ml-auto !w-44 !py-1 text-xs"
        />
      </div>
      {q.isLoading && <p className="px-3 py-4 text-xs text-muted">Cargando terceros…</p>}
      {q.error && <p className="px-3 py-4 text-xs font-semibold text-danger">{(q.error as Error).message}</p>}
      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-1.5 font-bold">Tercero / cuenta</th>
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Saldo inicial</th>}
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Débitos</th>}
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Créditos</th>}
              <th className="px-3 py-1.5 text-right font-bold">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => {
              const clave = t.tercero_id ?? 0;
              const abierto = abiertos.has(clave);
              return (
                <Fragment key={clave}>
                  <tr className="border-t border-border/50 bg-surface-panel/60">
                    <td className="max-w-0 px-3 py-1.5" colSpan={compacto ? 1 : 4}>
                      <button
                        type="button"
                        onClick={() => alternar(clave)}
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        <span className={`text-muted transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
                        <span className="truncate font-extrabold text-ink">{t.nombre}</span>
                        {t.identificacion && <span className="shrink-0 text-[10px] text-muted">{t.identificacion}</span>}
                        {t.tipo && (
                          <span className="shrink-0 rounded bg-surface-hover px-1 text-[9px] font-bold uppercase text-muted">
                            {t.tipo}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] text-muted">
                          {t.cuentas.length} cuenta{t.cuentas.length === 1 ? "" : "s"} · {t.lineas} mov.
                        </span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-[10px] text-muted">
                      {t.por_pagar ? (
                        <span className="block font-bold text-amber-700 dark:text-amber-300">por pagar {cop(t.por_pagar)}</span>
                      ) : null}
                      {t.por_cobrar ? (
                        <span className="block font-bold text-sky-700 dark:text-sky-300">por cobrar {cop(t.por_cobrar)}</span>
                      ) : null}
                    </td>
                  </tr>
                  {abierto &&
                    t.cuentas.map((c) => {
                      const sel = seleccion?.cuenta === c.cuenta_id && seleccion?.tercero === t.tercero_id;
                      return (
                        <tr key={c.cuenta_id} className={`border-t border-border/30 ${sel ? "bg-accent/10" : ""}`}>
                          <td className="max-w-0 py-1 pl-8 pr-3">
                            <button
                              type="button"
                              onClick={() =>
                                onSeleccionar({ id: c.cuenta_id, codigo: c.codigo, nombre: c.nombre }, t.tercero_id)
                              }
                              className="flex w-full items-center gap-1.5 text-left hover:underline"
                            >
                              <span className="shrink-0 tabular-nums text-muted">{c.codigo}</span>
                              <span className={`truncate font-semibold ${TIPO_COLOR[c.tipo] ?? "text-ink"}`}>{c.nombre}</span>
                            </button>
                          </td>
                          {!compacto && (
                            <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                              {cifra(c.saldo_inicial)}
                            </td>
                          )}
                          {!compacto && (
                            <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                              {cifra(c.debito)}
                            </td>
                          )}
                          {!compacto && (
                            <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                              {cifra(c.credito)}
                            </td>
                          )}
                          <td
                            className={`whitespace-nowrap px-3 py-1 text-right font-bold tabular-nums ${
                              c.saldo_final < 0 ? "text-danger" : "text-ink"
                            }`}
                          >
                            {cop(c.saldo_final)}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
            {!q.isLoading && lista.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-5 text-center text-muted">
                  Ningún tercero con movimiento en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Los tres pasos (guía, no navegación) ───────────────────────────────── */

function PasosMayor({
  cuentaSel,
  periodo,
  vista,
}: {
  cuentaSel: { codigo: string; nombre: string } | null;
  periodo: string;
  vista: "cuentas" | "terceros";
}) {
  const pasos = [
    { n: 1, label: "Período", detalle: periodo, hecho: true },
    {
      n: 2,
      label: vista === "cuentas" ? "Cuenta" : "Tercero y cuenta",
      detalle: cuentaSel
        ? `${cuentaSel.codigo} · ${cuentaSel.nombre}`
        : vista === "cuentas"
          ? "Baja por el árbol del PUC"
          : "Abre un tercero",
      hecho: Boolean(cuentaSel),
    },
    {
      n: 3,
      label: "Extracto",
      detalle: cuentaSel ? "Revisar y exportar" : "Aparece al elegir la cuenta",
      hecho: Boolean(cuentaSel),
    },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {pasos.map((p) => (
        <div
          key={p.n}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
            p.hecho ? "border-accent/30 bg-accent/5" : "border-border bg-surface-panel"
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
              p.hecho ? "bg-accent text-white" : "bg-surface-hover text-muted"
            }`}
          >
            {p.n}
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">{p.label}</span>
            <span className="block truncate text-xs font-semibold text-ink">{p.detalle}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Árbol del PUC ──────────────────────────────────────────────────────── */

function ArbolCuentas({
  datos,
  cargando,
  error,
  seleccionada,
  terceroSel,
  compacto,
  onSeleccionar,
  desde,
  hasta,
}: {
  datos: Arbol | undefined;
  cargando: boolean;
  error: Error | null;
  seleccionada: number | null;
  terceroSel: number | null;
  compacto: boolean;
  onSeleccionar: (n: NodoArbol, tercero?: number | null) => void;
  desde: string;
  hasta: string;
}) {
  // Clases y grupos abiertos de entrada: el árbol cerrado obliga a tres clics
  // antes de ver nada. Las cuentas con subcuentas sí arrancan cerradas.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [inicializado, setInicializado] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [bajandoPdf, setBajandoPdf] = useState(false);

  useEffect(() => {
    if (inicializado || !datos) return;
    const s = new Set<string>();
    for (const clase of datos.arbol) {
      s.add(clase.codigo);
      for (const grupo of clase.hijos) s.add(grupo.codigo);
    }
    setAbiertos(s);
    setInicializado(true);
  }, [datos, inicializado]);

  const alternar = (codigo: string) =>
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(codigo)) s.delete(codigo);
      else s.add(codigo);
      return s;
    });

  // Al buscar, el árbol se aplana: se listan las cuentas que coinciden por
  // código o nombre, sin obligar a saber en qué clase viven.
  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q || !datos) return null;
    const out: NodoArbol[] = [];
    const rec = (ns: NodoArbol[]) => {
      for (const n of ns) {
        if (n.codigo.includes(q) || n.nombre.toLowerCase().includes(q)) out.push(n);
        rec(n.hijos);
      }
    };
    rec(datos.arbol);
    return out;
  }, [busqueda, datos]);

  const descargarBalance = async () => {
    setBajandoPdf(true);
    try {
      const p = new URLSearchParams();
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      const url = await fetchAuthBlobUrl(`/api/contabilidad/cc/balance.pdf?${p.toString()}`);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = "balance_comprobacion.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBajandoPdf(false);
    }
  };

  return (
    <div className="lm-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Plan de cuentas con saldos</p>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar 2205, bancos…"
          className="lm-input ml-auto !w-40 !py-1 text-xs"
        />
        <button
          type="button"
          onClick={descargarBalance}
          disabled={bajandoPdf}
          className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-muted transition hover:text-ink disabled:opacity-50"
        >
          {bajandoPdf ? "Generando…" : "Balance PDF"}
        </button>
      </div>

      {cargando && <p className="px-3 py-4 text-xs text-muted">Cargando el libro…</p>}
      {error && <p className="px-3 py-4 text-xs font-semibold text-danger">{error.message}</p>}

      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-1.5 font-bold">Cuenta</th>
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Saldo inicial</th>}
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Débitos</th>}
              {!compacto && <th className="hidden px-2 py-1.5 text-right font-bold md:table-cell">Créditos</th>}
              <th className="px-3 py-1.5 text-right font-bold">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {coincidencias
              ? coincidencias.map((n) => (
                  <FilaCuenta
                    key={n.codigo}
                    nodo={n}
                    profundidad={0}
                    abierto={false}
                    tieneHijos={false}
                    compacto={compacto}
                    seleccionada={seleccionada === n.cuenta_id}
                    onAlternar={() => {}}
                    onSeleccionar={onSeleccionar}
                  />
                ))
              : (datos?.arbol ?? []).map((n) => (
                  <RamaArbol
                    key={n.codigo}
                    nodo={n}
                    profundidad={0}
                    abiertos={abiertos}
                    onAlternar={alternar}
                    seleccionada={seleccionada}
                    terceroSel={terceroSel}
                    compacto={compacto}
                    onSeleccionar={onSeleccionar}
                  />
                ))}
            {!cargando && (coincidencias?.length === 0 || (!coincidencias && !datos?.arbol.length)) && (
              <tr>
                <td colSpan={5} className="px-3 py-5 text-center text-muted">
                  {coincidencias ? "Ninguna cuenta coincide." : "Sin movimientos en el período."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RamaArbol({
  nodo,
  profundidad,
  abiertos,
  onAlternar,
  seleccionada,
  terceroSel,
  compacto,
  onSeleccionar,
}: {
  nodo: NodoArbol;
  profundidad: number;
  abiertos: Set<string>;
  onAlternar: (codigo: string) => void;
  seleccionada: number | null;
  terceroSel: number | null;
  compacto: boolean;
  onSeleccionar: (n: NodoArbol, tercero?: number | null) => void;
}) {
  const abierto = abiertos.has(nodo.codigo);
  const terceros = nodo.terceros ?? [];
  return (
    <>
      <FilaCuenta
        nodo={nodo}
        profundidad={profundidad}
        abierto={abierto}
        tieneHijos={nodo.hijos.length > 0 || terceros.length > 0}
        compacto={compacto}
        seleccionada={seleccionada === nodo.cuenta_id && nodo.cuenta_id !== null && terceroSel === null}
        onAlternar={() => onAlternar(nodo.codigo)}
        onSeleccionar={onSeleccionar}
      />
      {/* Auxiliar por tercero de lo asentado en esta cuenta: quién compone el
          saldo, que es la primera pregunta frente a un 2205 o un 2365. */}
      {abierto &&
        terceros.map((t) => (
          <tr
            key={`t-${t.tercero_id ?? 0}`}
            className={`border-t border-border/30 ${
              seleccionada === nodo.cuenta_id && terceroSel === t.tercero_id && t.tercero_id !== null
                ? "bg-accent/10"
                : ""
            }`}
          >
            <td className="w-full max-w-0 py-1 pr-3">
              <div className="flex items-center gap-1.5" style={{ paddingLeft: `${(profundidad + 1) * 14 + 20}px` }}>
                <Icon name="user" size={11} className="shrink-0 text-muted" />
                {t.tercero_id ? (
                  <button
                    type="button"
                    onClick={() => onSeleccionar(nodo, t.tercero_id)}
                    className="truncate text-left italic text-ink underline-offset-2 hover:underline"
                    title={`Extracto de ${nodo.codigo} solo con ${t.nombre}`}
                  >
                    {t.nombre}
                  </button>
                ) : (
                  <span className="truncate italic text-muted">{t.nombre}</span>
                )}
                {t.identificacion && <span className="shrink-0 text-[10px] text-muted">{t.identificacion}</span>}
              </div>
            </td>
            {!compacto && (
              <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                {cifra(t.saldo_inicial)}
              </td>
            )}
            {!compacto && (
              <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                {cifra(t.debito)}
              </td>
            )}
            {!compacto && (
              <td className="hidden whitespace-nowrap px-2 py-1 text-right tabular-nums text-muted md:table-cell">
                {cifra(t.credito)}
              </td>
            )}
            <td
              className={`whitespace-nowrap px-3 py-1 text-right tabular-nums ${
                t.saldo_final < 0 ? "text-danger" : "text-ink"
              }`}
            >
              {cop(t.saldo_final)}
            </td>
          </tr>
        ))}
      {abierto &&
        nodo.hijos.map((h) => (
          <RamaArbol
            key={h.codigo}
            nodo={h}
            profundidad={profundidad + 1}
            abiertos={abiertos}
            onAlternar={onAlternar}
            seleccionada={seleccionada}
            terceroSel={terceroSel}
            compacto={compacto}
            onSeleccionar={onSeleccionar}
          />
        ))}
    </>
  );
}

function FilaCuenta({
  nodo,
  profundidad,
  abierto,
  tieneHijos,
  compacto,
  seleccionada,
  onAlternar,
  onSeleccionar,
}: {
  nodo: NodoArbol;
  profundidad: number;
  abierto: boolean;
  tieneHijos: boolean;
  compacto: boolean;
  seleccionada: boolean;
  onAlternar: () => void;
  onSeleccionar: (n: NodoArbol, tercero?: number | null) => void;
}) {
  const esTitulo = profundidad <= 1;
  const clicable = nodo.cuenta_id !== null;
  return (
    <tr
      className={`border-t border-border/50 ${seleccionada ? "bg-accent/10" : esTitulo ? "bg-surface-panel/60" : ""}`}
    >
      <td className="w-full max-w-0 px-3 py-1.5">
        <div className="flex items-center gap-1" style={{ paddingLeft: `${profundidad * 14}px` }}>
          {tieneHijos ? (
            <button
              type="button"
              onClick={onAlternar}
              aria-label={abierto ? "Contraer" : "Desplegar"}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted transition hover:text-ink"
            >
              <span className={`transition-transform ${abierto ? "rotate-90" : ""}`}>▸</span>
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <span className={`shrink-0 tabular-nums ${esTitulo ? "font-extrabold text-ink" : "text-muted"}`}>
            {nodo.codigo}
          </span>
          {clicable ? (
            <button
              type="button"
              onClick={() => onSeleccionar(nodo)}
              className={`truncate text-left underline-offset-2 hover:underline ${
                esTitulo ? "font-extrabold text-ink" : `font-semibold ${TIPO_COLOR[nodo.tipo] ?? "text-ink"}`
              }`}
              title={
                nodo.descripcion
                  ? `${nodo.codigo} · ${nodo.nombre}\n\n${nodo.descripcion}` +
                    (nodo.nota_tributaria ? `\n\nImpuestos: ${nodo.nota_tributaria}` : "")
                  : `Ver el extracto de ${nodo.codigo} · ${nodo.nombre}`
              }
            >
              {nodo.nombre}
            </button>
          ) : (
            <span className={`truncate ${esTitulo ? "font-extrabold text-ink" : "font-semibold text-muted"}`}>
              {nodo.nombre}
            </span>
          )}
          {/* Un nivel que además tiene asientos propios: 1110 Bancos mueve por
              su cuenta y encima acumula 111010 MercadoPago. */}
          {tieneHijos && nodo.propio.lineas > 0 && (
            <span
              className="shrink-0 rounded bg-surface-hover px-1 text-[9px] font-bold text-muted"
              title={`${nodo.propio.lineas} asientos propios, además de los de sus subcuentas`}
            >
              propia
            </span>
          )}
        </div>
      </td>
      {!compacto && (
        <td className="hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted md:table-cell">
          {cifra(nodo.saldo_inicial)}
        </td>
      )}
      {!compacto && (
        <td className="hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted md:table-cell">
          {cifra(nodo.debito)}
        </td>
      )}
      {!compacto && (
        <td className="hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted md:table-cell">
          {cifra(nodo.credito)}
        </td>
      )}
      <td
        className={`whitespace-nowrap px-3 py-1.5 text-right font-bold tabular-nums ${
          nodo.saldo_final < 0 ? "text-danger" : "text-ink"
        }`}
        title={`Débitos ${cop(nodo.debito)} · Créditos ${cop(nodo.credito)}`}
      >
        {cop(nodo.saldo_final)}
      </td>
    </tr>
  );
}

/* ─── Extracto de la cuenta ──────────────────────────────────────────────── */

function ExtractoCuenta({
  cuenta,
  desde,
  hasta,
  subcuentas,
  onSubcuentas,
  terceroFiltro,
  onTerceroFiltro,
  onCerrar,
}: {
  cuenta: { id: number; codigo: string; nombre: string };
  desde: string;
  hasta: string;
  subcuentas: boolean;
  onSubcuentas: (v: boolean) => void;
  terceroFiltro: number | null;
  onTerceroFiltro: (v: number | null) => void;
  onCerrar: () => void;
}) {
  const [expandido, setExpandido] = useState<number | null>(null);
  const [bajando, setBajando] = useState<"pdf" | "csv" | null>(null);
  const [verTerceros, setVerTerceros] = useState(false);

  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (subcuentas) params.set("subcuentas", "1");
  if (terceroFiltro) params.set("tercero_id", String(terceroFiltro));
  const qs = params.toString();

  const extQ = useQuery<Extracto>({
    queryKey: ["cc-extracto", cuenta.id, qs],
    queryFn: () => api.get(`/api/contabilidad/cc/extracto/${cuenta.id}?${qs}`),
  });
  const e = extQ.data;

  const descargar = async (formato: "pdf" | "csv") => {
    setBajando(formato);
    try {
      const url = await fetchAuthBlobUrl(`/api/contabilidad/cc/extracto/${cuenta.id}.${formato}?${qs}`);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = `extracto_${cuenta.codigo}.${formato}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBajando(null);
    }
  };

  const terceroActivo = e?.por_tercero.find((t) => t.tercero_id === terceroFiltro);

  return (
    <div className="lm-card overflow-hidden">
      <div className="flex flex-wrap items-start gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-ink">
            {cuenta.codigo} · {cuenta.nombre}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted">
            Extracto {desde || "desde el inicio"} → {hasta || "hoy"}
            {e ? ` · naturaleza ${e.cuenta.naturaleza}` : ""}
          </p>
          {/* La guía de la cuenta, en la cabecera del extracto: es donde aparece
              la pregunta «¿qué es este saldo?» sin nadie a quien preguntarle. */}
          {e?.cuenta.descripcion && (
            <p className="mt-1 max-w-3xl text-xs leading-snug text-ink">{e.cuenta.descripcion}</p>
          )}
          {e?.cuenta.nota_tributaria && (
            <p className="mt-0.5 max-w-3xl text-xs leading-snug text-muted">
              Impuestos: {e.cuenta.nota_tributaria}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => descargar("pdf")}
            disabled={bajando !== null}
            className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
          >
            {bajando === "pdf" ? "Generando…" : "PDF"}
          </button>
          <button
            type="button"
            onClick={() => descargar("csv")}
            disabled={bajando !== null}
            className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold text-muted transition hover:text-ink disabled:opacity-50"
          >
            {bajando === "csv" ? "…" : "CSV"}
          </button>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar el extracto"
            className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-muted transition hover:text-ink"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={subcuentas} onChange={(ev) => onSubcuentas(ev.target.checked)} />
          Incluir subcuentas
        </label>
        {e && e.por_tercero.length > 1 && (
          <button
            type="button"
            onClick={() => setVerTerceros((v) => !v)}
            className="font-bold text-accent underline-offset-2 hover:underline"
          >
            {verTerceros ? "Ocultar" : "Ver"} resumen por tercero ({e.por_tercero.length})
          </button>
        )}
        {terceroActivo && (
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-bold text-accent">
            {terceroActivo.nombre}
            <button type="button" onClick={() => onTerceroFiltro(null)} aria-label="Quitar el filtro de tercero">
              ✕
            </button>
          </span>
        )}
      </div>

      {e && (
        <div className="grid grid-cols-4 border-b border-border">
          <Kpi label="Saldo inicial" valor={e.saldo_inicial} />
          <Kpi label="Débitos" valor={e.total_debito} />
          <Kpi label="Créditos" valor={e.total_credito} />
          <Kpi label="Saldo final" valor={e.saldo_final} acento />
        </div>
      )}

      {verTerceros && e && (
        <div className="max-h-56 overflow-auto border-b border-border">
          <table className="min-w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-1 font-bold">Tercero</th>
                <th className="px-2 py-1 text-right font-bold">Mov.</th>
                <th className="px-2 py-1 text-right font-bold">Débito</th>
                <th className="px-2 py-1 text-right font-bold">Crédito</th>
                <th className="px-3 py-1 text-right font-bold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {e.por_tercero.map((t) => (
                <tr key={t.tercero_id ?? 0} className="border-t border-border/50">
                  <td className="px-3 py-1">
                    {t.tercero_id ? (
                      <button
                        type="button"
                        onClick={() => onTerceroFiltro(t.tercero_id)}
                        className="font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        {t.nombre}
                      </button>
                    ) : (
                      <span className="text-muted">{t.nombre}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">{t.movimientos}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">{cifra(t.debito)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted">{cifra(t.credito)}</td>
                  <td className="px-3 py-1 text-right font-bold tabular-nums text-ink">{cop(t.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {extQ.isLoading && <p className="px-3 py-4 text-xs text-muted">Cargando el extracto…</p>}
      {extQ.error && <p className="px-3 py-4 text-xs font-semibold text-danger">{(extQ.error as Error).message}</p>}
      {e?.truncado && (
        <p className="border-b border-border bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          El extracto llegó al tope de líneas y quedó recortado. Acota el período para verlo completo.
        </p>
      )}

      {e && (
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-left text-[11px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-1.5 font-bold">Fecha</th>
                <th className="px-2 py-1.5 font-bold">Concepto y contrapartida</th>
                <th className="px-2 py-1.5 text-right font-bold">Débito</th>
                <th className="px-2 py-1.5 text-right font-bold">Crédito</th>
                <th className="px-3 py-1.5 text-right font-bold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/50 bg-surface-panel/60">
                <td className="px-3 py-1.5 text-muted" colSpan={4}>
                  <em>Saldo inicial del período</em>
                </td>
                <td className="px-3 py-1.5 text-right font-bold tabular-nums text-ink">{cop(e.saldo_inicial)}</td>
              </tr>
              {e.movimientos.map((m) => (
                <FilaExtracto
                  key={m.linea_id}
                  linea={m}
                  abierto={expandido === m.linea_id}
                  onAlternar={() => setExpandido((v) => (v === m.linea_id ? null : m.linea_id))}
                />
              ))}
              {e.movimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-muted">
                    Esta cuenta no tuvo movimiento en el período.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface font-bold">
                <td className="px-3 py-1.5" colSpan={2}>
                  Totales del período
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink">{cop(e.total_debito)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink">{cop(e.total_credito)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-accent">{cop(e.saldo_final)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, valor, acento }: { label: string; valor: number; acento?: boolean }) {
  return (
    <div className="border-r border-border px-3 py-2 last:border-r-0">
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 truncate text-sm font-extrabold tabular-nums ${
          acento ? "text-accent" : valor < 0 ? "text-danger" : "text-ink"
        }`}
      >
        {cop(valor)}
      </p>
    </div>
  );
}

/** Una línea del extracto. Al abrirla se ve el asiento completo — las dos (o
 * más) patas de la partida doble — sin salir del extracto. */
function FilaExtracto({
  linea,
  abierto,
  onAlternar,
}: {
  linea: LineaExtracto;
  abierto: boolean;
  onAlternar: () => void;
}) {
  const contra = linea.contrapartida;
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border/50 align-top transition hover:bg-surface-hover"
        onClick={onAlternar}
      >
        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted">{linea.fecha}</td>
        <td className="px-2 py-1.5">
          <p className="font-semibold text-ink">{linea.concepto}</p>
          <p className="text-[10px] text-muted">
            {linea.tercero_nombre && <span className="font-semibold">{linea.tercero_nombre} · </span>}
            {contra.length > 0 ? (
              <span>
                contra{" "}
                {contra.slice(0, 3).map((c, i) => (
                  <span key={c.cuenta_id}>
                    {i > 0 && ", "}
                    <span className="font-semibold">{c.codigo}</span> {c.nombre}
                  </span>
                ))}
                {contra.length > 3 && ` y ${contra.length - 3} más`}
              </span>
            ) : (
              <span className="italic">sin contrapartida</span>
            )}
          </p>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-ink">{cifra(linea.debito)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-ink">{cifra(linea.credito)}</td>
        <td className="px-3 py-1.5 text-right font-bold tabular-nums text-ink">{cop(linea.saldo)}</td>
      </tr>
      {abierto && (
        <tr className="border-t border-border/30 bg-surface-panel/70">
          <td colSpan={5} className="px-3 py-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              Asiento #{linea.movimiento_id}
              {linea.referencia && !linea.referencia.startsWith("auto:") ? ` · ${linea.referencia}` : ""}
              {linea.tipo_origen ? ` · ${linea.tipo_origen}` : ""}
            </p>
            <table className="w-full text-[10px]">
              <tbody>
                <tr className="font-bold text-ink">
                  <td className="py-0.5">
                    {linea.cuenta_codigo} {linea.cuenta_nombre} <span className="text-muted">(esta cuenta)</span>
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{cifra(linea.debito)}</td>
                  <td className="py-0.5 text-right tabular-nums">{cifra(linea.credito)}</td>
                </tr>
                {contra.map((c) => (
                  <tr key={c.cuenta_id} className="text-muted">
                    <td className="py-0.5">
                      {c.codigo} {c.nombre}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">{c.lado === "debito" ? cop(c.valor) : "—"}</td>
                    <td className="py-0.5 text-right tabular-nums">{c.lado === "credito" ? cop(c.valor) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {linea.descripcion && <p className="mt-1 text-[10px] text-muted">{linea.descripcion}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

export type { Arbol, Extracto, NodoArbol };
