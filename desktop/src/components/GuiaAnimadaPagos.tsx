import { useEffect, useMemo, useState } from "react";

/**
 * Guía animada de Solicitudes de pago (6-oct-2026).
 *
 * Una sección por naturaleza de operación, cada una con un caso REAL del Libro
 * Mayor (número de asiento y solicitud). Los asientos entran uno a uno y las
 * cuentas T se van llenando: así se ve dónde cae cada débito, cuál es su
 * contrapartida y cómo queda el saldo —a favor o en contra— al final.
 *
 * Los números son los del libro al 6-oct-2026. El paso «facturó 80 de 100» de la
 * legalización es ilustrativo (la factura de ese pedido aún no llega).
 */

type Nat = "D" | "C";
type Linea = { cuenta: string; d?: number; c?: number; nota?: string };
type Paso = { titulo: string; ref: string; explica: string; lineas: Linea[] };
type Seccion = {
  id: string; icono: string; titulo: string; soluciona: string; cuentasT: string;
  pasos: Paso[]; cierre: string;
};

const CUENTAS: Record<string, { nombre: string; nat: Nat; lectura: [string, string] }> = {
  "1110": { nombre: "Bancos (ahorros 42800000974)", nat: "D", lectura: ["plata en el banco", "sobregiro"] },
  "133005": { nombre: "Anticipos a proveedores", nat: "D", lectura: ["el proveedor NOS DEBE (a favor)", "le debemos"] },
  "130505": { nombre: "Clientes / Mercado Pago por cobrar", nat: "D", lectura: ["NOS DEBEN", "les debemos"] },
  "1435": { nombre: "Inventario de mercancía", nat: "D", lectura: ["mercancía en bodega", "—"] },
  "240810": { nombre: "IVA descontable", nat: "D", lectura: ["crédito contra la DIAN", "—"] },
  "529505": { nombre: "Comisiones (gasto)", nat: "D", lectura: ["gasto del período", "—"] },
  "236540": { nombre: "Retención en la fuente compras", nat: "C", lectura: ["le debemos a la DIAN", "a favor ante la DIAN"] },
  "2205": { nombre: "Proveedores nacionales", nat: "C", lectura: ["LE DEBEMOS al proveedor", "nos debe"] },
  "4135": { nombre: "Ingresos por ventas", nat: "C", lectura: ["ingreso del período", "—"] },
};

const SECCIONES: Seccion[] = [
  {
    id: "anticipo", icono: "💸", titulo: "1 · Anticipo: pagar antes de la factura",
    soluciona:
      "Factores y Comercializadora cobran por adelantado contra una cotización, y después facturan otra cosa. " +
      "Si el giro se registra como compra (1435 + IVA), el libro da por recibida mercancía que nadie ha facturado " +
      "y la factura después no tiene contra qué cruzarse. Como anticipo, el giro queda como plata a favor hasta que llegue la factura.",
    cuentasT:
      "133005 sube al débito: el proveedor nos debe la mercancía. La contrapartida es Bancos (sale la plata) y la " +
      "retención (se practica al girar, en el pago o abono en cuenta, lo que ocurra primero). Ni 1435 ni 240810 se tocan.",
    pasos: [{
      titulo: "Giro a Factores contra la cotización", ref: "Solicitud #62 · 1-oct · extracto −$4.437.081 cód 8162",
      explica: "Cotización $4.998.000 (WPC 80, base $4.200.000 + IVA). Se retiene 2,5 % y se cruza un anticipo viejo de $455.919: sale del banco exactamente lo del extracto.",
      lineas: [
        { cuenta: "133005", d: 4_998_000, nota: "anticipo por la cotización" },
        { cuenta: "236540", c: 105_000, nota: "retención 2,5 % al girar" },
        { cuenta: "133005", c: 455_919, nota: "se cruza el anticipo viejo a favor" },
        { cuenta: "1110", c: 4_437_081, nota: "lo que muestra el extracto" },
      ],
    }],
    cierre: "Queda en 133005 un saldo a favor de $4.542.081 con Factores: plata entregada sin factura. Aparece en «anticipo · falta la factura».",
  },
  {
    id: "legaliza", icono: "🧾", titulo: "2 · Llega la factura: legalizar el anticipo",
    soluciona:
      "Causa la compra con lo FACTURADO, no con lo cotizado. Si facturan menos, la diferencia queda a favor en 133005 y se cruza en el " +
      "próximo pago (o se pide la devolución). Si facturan más, queda por pagar en 2205. La retención se ajusta a la base facturada.",
    cuentasT:
      "Entran al débito el inventario (1435) y el IVA (240810) de la factura. La contrapartida es 133005, que baja: el anticipo se " +
      "consume. Si la base bajó, la retención de más se reversa al débito de 236540.",
    pasos: [
      {
        titulo: "El anticipo de #62", ref: "Asiento del giro (paso 1)",
        explica: "Punto de partida: $4.998.000 a favor en 133005 por esta solicitud.",
        lineas: [{ cuenta: "133005", d: 4_998_000, nota: "anticipo" }, { cuenta: "236540", c: 105_000 }, { cuenta: "1110", c: 4_893_000, nota: "giro (sin el cruce viejo)" }],
      },
      {
        titulo: "Facturan 80 kg de los 100 pagados (ilustrativo)", ref: "Legalizar → factura FEE…",
        explica: "Base facturada $3.360.000 + IVA $638.400. La retención correcta es $84.000: se reversan $21.000. Se consumen $4.019.400 del anticipo.",
        lineas: [
          { cuenta: "1435", d: 3_360_000, nota: "80 kg facturados" },
          { cuenta: "240810", d: 638_400, nota: "IVA de la factura" },
          { cuenta: "236540", d: 21_000, nota: "retención de más, se reversa" },
          { cuenta: "133005", c: 4_019_400, nota: "se consume el anticipo" },
        ],
      },
    ],
    cierre: "Quedan $978.600 a favor en 133005: exactamente lo girado de más (4.893.000 − 3.998.400 + 84.000). El próximo pago a Factores lo ofrece para cruzar.",
  },
  {
    id: "compra", icono: "📦", titulo: "3 · Mercancía entregada con factura",
    soluciona:
      "Cuando la mercancía llega con su factura electrónica antes de pagar, no hay anticipo: el pago y la compra son el mismo acto. " +
      "El asiento reproduce la factura renglón por renglón y separa el IVA descontable.",
    cuentasT:
      "1435 y 240810 al débito. Contrapartidas: retención (a la DIAN), Bancos (lo girado) y, si se giró menos de lo facturado, 2205 " +
      "(lo que se le sigue debiendo al proveedor).",
    pasos: [{
      titulo: "Factura CIV2336 de Comercializadora Internacional", ref: "Solicitud #41 · asiento #5860 · 2-sep",
      explica: "Bolsas 10×17 y 13×21: base $1.120.000 + IVA $212.800. Se giraron $1.300.000 redondos: faltaron $4.800.",
      lineas: [
        { cuenta: "1435", d: 20_000, nota: "BOLTRA10X17ZIP" },
        { cuenta: "1435", d: 1_100_000, nota: "BOLTRA13X21ZIP" },
        { cuenta: "240810", d: 212_800, nota: "IVA descontable" },
        { cuenta: "236540", c: 28_000, nota: "retención 2,5 %" },
        { cuenta: "2205", c: 4_800, nota: "queda por pagar" },
        { cuenta: "1110", c: 1_300_000, nota: "extracto −$1.300.000" },
      ],
    }],
    cierre: "El inventario sube con lo facturado y quedan $4.800 por pagar en 2205 con Comercializadora.",
  },
  {
    id: "ingreso", icono: "🏦", titulo: "4 · Plata que entra a la cuenta de ahorros",
    soluciona:
      "No toda plata que entra es ingreso. Una venta directa sí; un retiro de Mercado Pago al banco es un TRASLADO: la venta ya se " +
      "reconoció cuando MeLi la cobró. Contarla otra vez al llegar al banco duplicaría los ingresos.",
    cuentasT:
      "Bancos al débito siempre. La contrapartida decide qué es: 4135 si es venta, 130505 si es plata que Mercado Pago ya nos debía.",
    pasos: [
      {
        titulo: "Venta directa facturada en Alegra", ref: "Asiento #9029 · 5-oct",
        explica: "El cliente consigna: la plata entra y nace el ingreso.",
        lineas: [{ cuenta: "1110", d: 219_700, nota: "consignación" }, { cuenta: "4135", c: 219_700, nota: "venta" }],
      },
      {
        titulo: "Venta en MeLi: el ingreso nace en Mercado Pago", ref: "Asiento #9098 · 6-oct",
        explica: "La venta se reconoce cuando MeLi la cobra; la plata queda en Mercado Pago (130505), no en el banco.",
        lineas: [{ cuenta: "130505", d: 52_020, nota: "por cobrar a Mercado Pago" }, { cuenta: "4135", c: 52_020, nota: "venta MeLi" }],
      },
      {
        titulo: "MeLi descuenta su comisión", ref: "Asiento #9101 · 6-oct",
        explica: "Es gasto y baja lo que Mercado Pago nos debe.",
        lineas: [{ cuenta: "529505", d: 9_622, nota: "comisión" }, { cuenta: "130505", c: 9_622 }],
      },
      {
        titulo: "Retiro de Mercado Pago al banco", ref: "Asiento #6131 · 29-sep · extracto PAGO INTERBANC MERCADOPAGO",
        explica: "Traslado entre cuentas propias: Bancos sube y 130505 baja. No hay ingreso nuevo.",
        lineas: [{ cuenta: "1110", d: 11_792_301, nota: "entra al banco" }, { cuenta: "130505", c: 11_792_301, nota: "baja lo que MP nos debía" }],
      },
    ],
    cierre: "4135 solo se movió por las ventas; el retiro de $11,8M no infló los ingresos.",
  },
  {
    id: "cartera", icono: "⚖️", titulo: "5 · Cartera: ¿nos deben o les debemos?",
    soluciona:
      "Con cada proveedor pueden convivir dos saldos: 133005 (le pagamos de más o por adelantado → NOS DEBE) y 2205 (le pagamos de menos " +
      "→ LE DEBEMOS). El wizard los muestra al elegir el proveedor y deja cruzarlos en el siguiente giro para que ninguno se olvide.",
    cuentasT:
      "Saldo deudor de 133005 = a favor de McKenna. Saldo acreedor de 2205 = en contra. Cruzar es acreditar 133005 y debitar 2205 en el " +
      "mismo asiento del pago: el giro baja o sube por la diferencia. Hoy, con Factores, 2205 tiene $17.526.868 por pagar.",
    pasos: [
      {
        titulo: "Quedan $4.800 por pagar", ref: "Asiento #5860 · 2-sep (Comercializadora)",
        explica: "Se giró menos de lo facturado.",
        lineas: [{ cuenta: "1435", d: 1_332_800, nota: "compra + IVA (resumido)" }, { cuenta: "236540", c: 28_000 }, { cuenta: "2205", c: 4_800, nota: "LE DEBEMOS" }, { cuenta: "1110", c: 1_300_000 }],
      },
      {
        titulo: "Quedan $18.415 a favor", ref: "Asiento #5861 · 24-sep",
        explica: "Se giró la cotización completa ($876.554) sin descontar la retención: pagamos de más.",
        lineas: [{ cuenta: "1435", d: 876_554, nota: "compra + IVA (resumido)" }, { cuenta: "236540", c: 18_415 }, { cuenta: "133005", d: 18_415, nota: "NOS DEBE" }, { cuenta: "1110", c: 876_554 }],
      },
      {
        titulo: "Se cruzan los dos en el siguiente giro", ref: "Asiento #7964 · solicitud #65 · 2-oct",
        explica: "El giro baja por el anticipo y sube por la deuda: los dos saldos quedan en cero.",
        lineas: [{ cuenta: "1435", d: 539_070, nota: "compra + IVA (resumido)" }, { cuenta: "2205", d: 4_800, nota: "se paga la deuda" }, { cuenta: "133005", c: 18_415, nota: "se usa el anticipo" }, { cuenta: "1110", c: 525_455 }],
      },
    ],
    cierre: "133005 y 2205 de Comercializadora en $0. Ojo: el extracto del 1-oct dice $425.455, no $525.455 — esa diferencia es la que se ve en Conciliación.",
  },
];

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

export default function GuiaAnimadaPagos({ onCerrar }: { onCerrar: () => void }) {
  const [sec, setSec] = useState(0);
  const [visibles, setVisibles] = useState(0);
  const [auto, setAuto] = useState(true);
  const s = SECCIONES[sec];
  // Todas las líneas de la sección en orden, con el paso al que pertenecen.
  const plano = useMemo(
    () => s.pasos.flatMap((p, pi) => p.lineas.map((l, li) => ({ ...l, pi, li }))),
    [s],
  );

  useEffect(() => { setVisibles(0); setAuto(true); }, [sec]);
  useEffect(() => {
    if (!auto || visibles >= plano.length) return;
    const t = window.setTimeout(() => setVisibles((v) => v + 1), visibles === 0 ? 500 : 1100);
    return () => window.clearTimeout(t);
  }, [auto, visibles, plano.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  const mostradas = plano.slice(0, visibles);
  const pasoActual = mostradas.length ? mostradas[mostradas.length - 1].pi : 0;
  const ultima = mostradas[mostradas.length - 1];
  const cuentas = Array.from(new Set(plano.map((l) => l.cuenta)));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6" onClick={onCerrar}>
      <div className="w-full max-w-5xl rounded-2xl border border-border bg-surface-panel p-4 shadow-2xl"
           onClick={(e) => e.stopPropagation()} style={{ animation: "mck-slide-up .35s ease-out both" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">Guía animada · cómo se registra cada operación</h3>
            <p className="text-sm text-muted">Casos reales del Libro Mayor. Las cuentas T se llenan asiento por asiento.</p>
          </div>
          <button type="button" onClick={onCerrar} className="rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted hover:text-ink">Cerrar</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {SECCIONES.map((x, i) => (
            <button key={x.id} type="button" onClick={() => setSec(i)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold ${i === sec ? "bg-accent text-white" : "bg-surface text-muted hover:text-ink"}`}>
              {x.icono} {x.titulo.replace(/^\d · /, "")}
            </button>
          ))}
        </div>

        <div key={s.id} className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]" style={{ animation: "mck-slide-in-right .35s ease-out both" }}>
          <div className="space-y-2 text-sm">
            <p className="text-base font-bold text-ink">{s.icono} {s.titulo}</p>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-800 dark:text-emerald-300">
              <b>Qué soluciona.</b> {s.soluciona}
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2 text-sky-800 dark:text-sky-300">
              <b>Cuentas T y contrapartidas.</b> {s.cuentasT}
            </div>
            <ol className="space-y-1.5">
              {s.pasos.map((p, i) => (
                <li key={i} className={`rounded-lg border p-2 transition-all duration-300 ${
                  visibles > 0 && i === pasoActual ? "border-accent bg-accent/5" : i < pasoActual ? "border-border opacity-70" : "border-border opacity-40"}`}>
                  <p className="font-bold text-ink">{p.titulo}</p>
                  <p className="text-xs text-muted">{p.ref}</p>
                  <p className="mt-0.5 text-xs text-ink">{p.explica}</p>
                </li>
              ))}
            </ol>
            {visibles >= plano.length && (
              <p className="rounded-lg border-2 border-accent/40 p-2 font-semibold text-ink" style={{ animation: "mck-slide-up .4s ease-out both" }}>
                ✓ {s.cierre}
              </p>
            )}
          </div>

          <div>
            {ultima && (
              <p key={visibles} className="mb-2 rounded-lg bg-surface px-2 py-1 text-xs text-ink" style={{ animation: "mck-slide-in-left .3s ease-out both" }}>
                <b>{ultima.d ? "Débito" : "Crédito"} {ultima.cuenta}</b> {CUENTAS[ultima.cuenta]?.nombre} por {cop(ultima.d || ultima.c || 0)}
                {ultima.nota ? ` — ${ultima.nota}` : ""}
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {cuentas.map((cod) => {
                const info = CUENTAS[cod];
                const ls = mostradas.filter((l) => l.cuenta === cod);
                const d = ls.reduce((a, l) => a + (l.d || 0), 0);
                const c = ls.reduce((a, l) => a + (l.c || 0), 0);
                const saldo = info.nat === "D" ? d - c : c - d;
                const activa = ultima?.cuenta === cod;
                return (
                  <div key={cod} className={`rounded-lg border-2 p-2 transition-colors duration-300 ${activa ? "border-accent" : "border-border"} ${ls.length ? "" : "opacity-40"}`}>
                    <p className="text-xs font-bold text-ink">{cod} · {info.nombre}</p>
                    <div className="mt-1 grid grid-cols-2 border-t-2 border-ink/60 text-xs tabular-nums">
                      <div className="min-h-[2.5rem] border-r-2 border-ink/60 pr-1 text-right">
                        <span className="block text-[10px] text-muted">Débito</span>
                        {ls.filter((l) => l.d).map((l) => (
                          <span key={`${l.pi}-${l.li}`} className="block text-ink" style={{ animation: "mck-slide-up .4s ease-out both" }}>{cop(l.d!)}</span>
                        ))}
                      </div>
                      <div className="pl-1">
                        <span className="block text-[10px] text-muted">Crédito</span>
                        {ls.filter((l) => l.c).map((l) => (
                          <span key={`${l.pi}-${l.li}`} className="block text-ink" style={{ animation: "mck-slide-up .4s ease-out both" }}>{cop(l.c!)}</span>
                        ))}
                      </div>
                    </div>
                    {ls.length > 0 && (
                      <p className={`mt-1 text-[11px] font-bold ${Math.abs(saldo) < 1 ? "text-muted" : saldo > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                        Saldo {cop(Math.abs(saldo))}{Math.abs(saldo) < 1 ? " — en cero" : ` — ${saldo > 0 ? info.lectura[0] : info.lectura[1]}`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => { setAuto(false); setVisibles((v) => Math.max(0, v - 1)); }}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-muted hover:text-ink">◀ Atrás</button>
              <button type="button" onClick={() => setAuto((a) => !a)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-muted hover:text-ink">{auto ? "Pausa" : "Reproducir"}</button>
              <button type="button" onClick={() => { setAuto(false); setVisibles((v) => Math.min(plano.length, v + 1)); }}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-muted hover:text-ink">Siguiente ▶</button>
              <button type="button" onClick={() => { setVisibles(0); setAuto(true); }}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-bold text-muted hover:text-ink">Repetir</button>
              <span className="ml-auto text-xs text-muted">{visibles}/{plano.length} movimientos</span>
              {visibles >= plano.length && sec < SECCIONES.length - 1 && (
                <button type="button" onClick={() => setSec(sec + 1)} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-white">
                  Siguiente operación →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
