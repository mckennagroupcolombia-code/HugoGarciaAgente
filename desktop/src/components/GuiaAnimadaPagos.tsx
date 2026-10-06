import { useEffect, useMemo, useState } from "react";

/**
 * Guía animada de Solicitudes de pago — wizard del flujo del dinero (6-oct-2026).
 *
 * Primera versión: asientos sueltos que se reproducían solos. No se entendía: un
 * asiento aislado no muestra que la plata se MUEVE —sale del banco, se vuelve un
 * derecho con el proveedor, se transforma en mercancía, vuelve como venta—.
 *
 * Ahora es una sola historia sobre un mapa: cada paso es una moneda que viaja de
 * un lugar a otro, a mano (Siguiente / Atrás), y debajo cómo se escribe en el
 * libro. La regla que se aprende: débito = a donde LLEGA el valor, crédito = de
 * donde SALE. Las cifras son de casos reales del Libro Mayor (#62 Factores,
 * CIV2336 de Comercializadora, ventas #9098 y #9029); lo «ilustrativo» se marca.
 */

type Zona = "fuente" | "tenemos" | "gasto";
type Balde = { cod: string; nombre: string; ayuda: string; zona: Zona; x: number; y: number };
type Mov = { de: string; a: string; v: number };
type Paso = {
  cap: number; titulo: string; texto: string; porque?: string; ref?: string; movs: Mov[]; foco?: string[];
};

const BALDES: Balde[] = [
  { cod: "4135", nombre: "Ventas", ayuda: "lo que hemos ganado vendiendo", zona: "fuente", x: 12, y: 17 },
  { cod: "236540", nombre: "Le debemos a la DIAN", ayuda: "retenciones que guardamos para pagarle", zona: "fuente", x: 12, y: 50 },
  { cod: "2205", nombre: "Le debemos al proveedor", ayuda: "facturas sin terminar de pagar", zona: "fuente", x: 12, y: 83 },
  { cod: "1110", nombre: "Banco", ayuda: "plata en la cuenta de ahorros", zona: "tenemos", x: 38, y: 28 },
  { cod: "130505", nombre: "Mercado Pago nos debe", ayuda: "ventas MeLi aún no retiradas", zona: "tenemos", x: 38, y: 74 },
  { cod: "133005", nombre: "El proveedor nos debe", ayuda: "anticipo: pagamos y falta la factura", zona: "tenemos", x: 63, y: 15 },
  { cod: "1435", nombre: "Mercancía en bodega", ayuda: "inventario facturado", zona: "tenemos", x: 63, y: 48 },
  { cod: "240810", nombre: "IVA a favor", ayuda: "la DIAN nos lo descuenta", zona: "tenemos", x: 63, y: 82 },
  { cod: "529505", nombre: "Gastos", ayuda: "comisiones: valor que se consume", zona: "gasto", x: 88, y: 48 },
];
const B = Object.fromEntries(BALDES.map((b) => [b.cod, b]));
const INICIAL: Record<string, number> = { "1110": 10_000_000 };

const CAPITULOS = [
  "Cómo leer el mapa", "Anticipo al proveedor", "Llega la factura", "Compra con factura",
  "Ventas: entra la plata", "Cartera: nos deben / les debemos", "Resumen",
];

const PASOS: Paso[] = [
  {
    cap: 0, titulo: "El dinero no desaparece: cambia de lugar", movs: [],
    texto: "Cada caja es una cuenta del Libro Mayor: un lugar donde puede estar el valor de la empresa. En el centro está lo que TENEMOS (banco, mercancía, " +
      "derechos de cobro). A la izquierda, de dónde SALE el valor que tenemos: lo que ganamos vendiendo y lo que todavía debemos. " +
      "A la derecha, en qué se CONSUME (gastos). Empezamos con $10.000.000 de ejemplo en el banco.",
    porque: "La regla del libro es una sola: el DÉBITO es la caja a donde llega el valor y el CRÉDITO la caja de donde sale. " +
      "Por eso todo asiento cuadra: lo que sale de un lado llega a otro.",
  },
  {
    cap: 1, titulo: "Le giramos a Factores contra la cotización", ref: "Solicitud #62 · 1-oct",
    movs: [{ de: "1110", a: "133005", v: 4_893_000 }], foco: ["1110", "133005"],
    texto: "La cotización es de $4.998.000 y Factores ya descontó la retención, así que pide $4.893.000. Sale esa plata del banco, pero todavía " +
      "no hay mercancía ni factura. Lo que tenemos ahora es un DERECHO: Factores nos debe el pedido. Solo se registra lo que salió del banco.",
    porque: "Aún no hay retención: nace con la factura, que es con lo que se cancela. Y si la plata fuera directo a «Mercancía», el libro " +
      "diría que ya tenemos 100 kg de proteína que nadie ha facturado (el problema del asiento #7965).",
  },
  {
    cap: 2, titulo: "Llega la factura: el derecho se convierte en mercancía e IVA", ref: "Ilustrativo: facturan 80 kg de los 100 pagados",
    movs: [{ de: "133005", a: "1435", v: 3_360_000 }, { de: "133005", a: "240810", v: 638_400 }], foco: ["133005", "1435", "240810"],
    texto: "Con la factura en la mano, el derecho se TRANSFORMA: $3.360.000 en mercancía (80 kg × $42.000) y $638.400 de IVA que la DIAN nos " +
      "descuenta. En total la factura vale $3.998.400 y se descuenta del anticipo.",
    porque: "Se legaliza con lo que dice la factura, no con la cotización. El IVA no es costo: sin factura no se podía descontar, por eso no estaba en el anticipo.",
  },
  {
    cap: 2, titulo: "La retención nace con la factura", ref: "2,5 % sobre la base facturada de $3.360.000",
    movs: [{ de: "236540", a: "133005", v: 84_000 }], foco: ["236540", "133005"],
    texto: "De esa factura, $84.000 no son para Factores sino para la DIAN: es la retención, y ahora se la debemos a la DIAN. " +
      "Esa parte de la factura no se cancela con el anticipo, así que esos $84.000 vuelven a la caja de lo que Factores nos debe.",
    porque: "Cuando sale valor de una caja de la izquierda, esa deuda CRECE: aparece la deuda con la DIAN justo cuando hay factura que la sustente.",
  },
  {
    cap: 2, titulo: "Resultado: Factores nos sigue debiendo $978.600", movs: [], foco: ["133005"],
    texto: "Mira la caja del anticipo: pagamos más de lo que facturaron. Ese saldo no se pierde. Se descuenta en el próximo pedido " +
      "o se le pide la devolución, y el wizard lo ofrece cada vez que se le va a pagar a Factores.",
  },
  {
    cap: 3, titulo: "Llega mercancía con factura antes de pagarla", ref: "Factura CIV2336 · Comercializadora · asiento #5860",
    movs: [{ de: "2205", a: "1435", v: 1_120_000 }, { de: "2205", a: "240810", v: 212_800 }], foco: ["2205", "1435", "240810"],
    texto: "Esta vez la mercancía llegó primero, con su factura. Entra a bodega y su IVA queda a favor, y nace una deuda con el proveedor por $1.332.800.",
    porque: "No hay anticipo: cuando hay factura, la compra se registra directo en la bodega.",
  },
  {
    cap: 3, titulo: "Le pagamos: baja la deuda", ref: "Extracto −$1.300.000",
    movs: [{ de: "1110", a: "2205", v: 1_300_000 }, { de: "236540", a: "2205", v: 28_000 }], foco: ["1110", "2205", "236540"],
    texto: "Del banco salen $1.300.000 y $28.000 de retención pasan a deberse a la DIAN. La deuda con el proveedor baja, pero no a cero: " +
      "se giró un número redondo y quedan $4.800 por pagar.",
  },
  {
    cap: 4, titulo: "Vendemos en MeLi: el ingreso nace en Mercado Pago", ref: "Venta MeLi · asiento #9098",
    movs: [{ de: "4135", a: "130505", v: 52_020 }], foco: ["4135", "130505"],
    texto: "Al vender ganamos $52.020, pero la plata no llega al banco: queda en Mercado Pago. Lo que tenemos es un derecho de cobro.",
    porque: "La venta se reconoce aquí, una sola vez.",
  },
  {
    cap: 4, titulo: "MeLi cobra su comisión", ref: "Asiento #9101",
    movs: [{ de: "130505", a: "529505", v: 9_622 }], foco: ["130505", "529505"],
    texto: "Una parte de lo que Mercado Pago nos debía se consume en comisión: es un gasto.",
  },
  {
    cap: 4, titulo: "Retiramos de Mercado Pago al banco", ref: "Ilustrativo con esta venta (el retiro real del 29-sep fue de $11.792.301)",
    movs: [{ de: "130505", a: "1110", v: 42_398 }], foco: ["130505", "1110"],
    texto: "Entra plata al banco, pero NO es un ingreso nuevo: es la misma venta que ya estaba en Mercado Pago y ahora cambia de lugar. Fíjate en que «Ventas» no se movió.",
    porque: "Si se contara como ingreso al llegar al banco, la venta quedaría registrada dos veces.",
  },
  {
    cap: 4, titulo: "Venta directa: el cliente consigna", ref: "Venta Alegra · asiento #9029",
    movs: [{ de: "4135", a: "1110", v: 219_700 }], foco: ["4135", "1110"],
    texto: "Aquí sí entra plata al banco como ingreso, porque la venta y el pago ocurren juntos.",
  },
  {
    cap: 5, titulo: "¿Quién le debe a quién?", movs: [], foco: ["133005", "2205"],
    texto: "Arriba, «El proveedor nos debe» tiene saldo: plata a NUESTRO favor. Abajo a la izquierda, «Le debemos al proveedor» tiene " +
      "$4.800: saldo EN CONTRA. Las dos cajas viven por separado, y el wizard las muestra al elegir el proveedor para que ninguna se olvide.",
  },
  {
    cap: 5, titulo: "Se cruzan sin mover el banco", ref: "Así quedó en el asiento #7964 con Comercializadora",
    movs: [{ de: "133005", a: "2205", v: 4_800 }], foco: ["133005", "2205"],
    texto: "Si el mismo proveedor nos debe y le debemos, en el siguiente pago lo uno paga lo otro. La deuda queda en cero y el giro del banco baja.",
  },
  {
    cap: 6, titulo: "Todo cuadra", movs: [],
    texto: "Lo que TENEMOS (centro) = lo que había al empezar + lo que ganamos + lo que debemos − lo que gastamos. Cada moneda salió de una caja y " +
      "llegó a otra; eso es la partida doble. En Solicitudes de pago: con cotización = anticipo; cuando llega la factura = «Legalizar»; y una diferencia que no cuadra se marca «por arreglar».",
  },
];

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

/** Cómo cambia cada caja con un movimiento: las del centro y gastos crecen al recibir; las fuentes crecen al entregar. */
function aplicar(saldos: Record<string, number>, movs: Mov[]): Record<string, number> {
  const s = { ...saldos };
  for (const m of movs) {
    const signo = (cod: string, llega: boolean) => (B[cod].zona === "fuente" ? (llega ? -1 : 1) : (llega ? 1 : -1));
    s[m.de] = (s[m.de] ?? 0) + signo(m.de, false) * m.v;
    s[m.a] = (s[m.a] ?? 0) + signo(m.a, true) * m.v;
  }
  return s;
}

const COLOR: Record<Zona, string> = {
  fuente: "border-amber-500/60 bg-amber-500/10",
  tenemos: "border-sky-500/60 bg-sky-500/10",
  gasto: "border-rose-500/60 bg-rose-500/10",
};

export default function GuiaAnimadaPagos({ onCerrar }: { onCerrar: () => void }) {
  const [i, setI] = useState(0);
  const [fase, setFase] = useState<"quieto" | "viajando" | "llego">("llego");
  const paso = PASOS[i];

  // Saldos ANTES de este paso y DESPUÉS; mientras la moneda viaja se muestran los de antes.
  const antes = useMemo(() => PASOS.slice(0, i).reduce((s, p) => aplicar(s, p.movs), { ...INICIAL }), [i]);
  const despues = useMemo(() => aplicar(antes, paso.movs), [antes, paso]);
  const saldos = fase === "llego" ? despues : antes;

  function ir(n: number) {
    if (n < 0 || n >= PASOS.length) return;
    if (n < i) { setI(n); setFase("llego"); return; }   // hacia atrás: sin animación
    setI(n);
    setFase(PASOS[n].movs.length ? "quieto" : "llego");
  }
  useEffect(() => {
    if (fase !== "quieto") return;
    const a = window.setTimeout(() => setFase("viajando"), 350);
    return () => window.clearTimeout(a);
  }, [fase, i]);
  useEffect(() => {
    if (fase !== "viajando") return;
    const a = window.setTimeout(() => setFase("llego"), 2200);
    return () => window.clearTimeout(a);
  }, [fase, i]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      if (e.key === "ArrowRight") ir(i + 1);
      if (e.key === "ArrowLeft") ir(i - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const foco = new Set(paso.foco ?? []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6" onClick={onCerrar}>
      <div className="w-full max-w-5xl rounded-2xl border border-border bg-surface-panel p-4 shadow-2xl"
           onClick={(e) => e.stopPropagation()} style={{ animation: "mck-slide-up .35s ease-out both" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">Guía: cómo se mueve el dinero</h3>
            <p className="text-sm text-muted">Avanza a tu ritmo con «Siguiente». Cada moneda es un movimiento real del Libro Mayor.</p>
          </div>
          <button type="button" onClick={onCerrar} className="rounded-lg border border-border px-2 py-1 text-sm font-bold text-muted hover:text-ink">Cerrar</button>
        </div>

        {/* Capítulos */}
        <div className="mt-3 flex flex-wrap gap-1">
          {CAPITULOS.map((c, n) => {
            const primero = PASOS.findIndex((p) => p.cap === n);
            return (
              <button key={c} type="button" onClick={() => ir(primero)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        paso.cap === n ? "bg-accent text-white" : paso.cap > n ? "bg-emerald-500/15 text-emerald-600" : "bg-surface text-muted"}`}>
                {paso.cap > n ? "✓ " : ""}{c}
              </button>
            );
          })}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${((i + 1) / PASOS.length) * 100}%` }} />
        </div>

        {/* Mapa del dinero */}
        <div className="relative mt-3 h-[420px] overflow-hidden rounded-xl border border-border bg-surface sm:h-[380px]">
          {(["fuente", "tenemos", "gasto"] as Zona[]).map((z) => (
            <p key={z} className="absolute top-1 text-[10px] font-bold uppercase tracking-wide text-muted"
               style={{ left: z === "fuente" ? "2%" : z === "tenemos" ? "30%" : "78%" }}>
              {z === "fuente" ? "De dónde sale el valor" : z === "tenemos" ? "Lo que tenemos" : "En qué se consume"}
            </p>
          ))}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {fase !== "llego" && paso.movs.map((m, n) => (
              <line key={n} x1={B[m.de].x} y1={B[m.de].y} x2={B[m.a].x} y2={B[m.a].y}
                    stroke="currentColor" className="text-accent" strokeWidth="0.5" strokeDasharray="1.5 1.2" vectorEffect="non-scaling-stroke"
                    style={{ strokeWidth: 2 }} />
            ))}
          </svg>
          {BALDES.map((b) => {
            const v = saldos[b.cod] ?? 0;
            const activo = foco.has(b.cod);
            return (
              <div key={b.cod}
                   className={`absolute w-[23%] max-w-[190px] -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 px-1.5 py-1 text-center transition-all duration-500 ${COLOR[b.zona]} ${
                     activo ? "z-10 scale-105 shadow-lg ring-2 ring-accent" : foco.size ? "opacity-45" : ""}`}
                   style={{ left: `${b.x}%`, top: `${b.y}%` }}>
                <p className="text-[11px] font-bold leading-tight text-ink sm:text-xs">{b.nombre}</p>
                <p className="hidden text-[10px] leading-tight text-muted sm:block">{b.ayuda}</p>
                <p className={`mt-0.5 text-xs font-extrabold tabular-nums sm:text-sm ${Math.abs(v) < 1 ? "text-muted" : "text-ink"}`}>{cop(v)}</p>
                <p className="text-[9px] text-muted">{b.cod}</p>
              </div>
            );
          })}
          {/* Monedas en viaje */}
          {fase !== "llego" && paso.movs.map((m, n) => {
            const pos = fase === "quieto" ? B[m.de] : B[m.a];
            return (
              <div key={`${i}-${n}`}
                   className="absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-amber-300 bg-amber-400 px-2 py-0.5 text-xs font-extrabold text-amber-950 shadow-lg"
                   style={{ left: `${pos.x}%`, top: `${pos.y}%`, transition: "left 1.8s ease-in-out, top 1.8s ease-in-out" }}>
                🪙 {cop(m.v)}
              </div>
            );
          })}
        </div>

        {/* Explicación del paso */}
        <div key={i} className="mt-3 grid gap-3 md:grid-cols-[1.5fr_1fr]" style={{ animation: "mck-slide-in-right .3s ease-out both" }}>
          <div className="space-y-2 text-sm">
            <p className="text-base font-bold text-ink">{paso.titulo}</p>
            {paso.ref && <p className="text-xs text-muted">{paso.ref}</p>}
            <p className="text-ink">{paso.texto}</p>
            {paso.porque && <p className="rounded-lg bg-emerald-500/10 p-2 text-emerald-800 dark:text-emerald-300"><b>Por qué importa.</b> {paso.porque}</p>}
          </div>
          {paso.movs.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-2 text-xs">
              <p className="mb-1 font-bold text-ink">Así se escribe en el libro</p>
              {paso.movs.map((m, n) => (
                <div key={n} className="mb-1.5">
                  <p className="text-ink"><b className="text-sky-700 dark:text-sky-300">Débito</b> {m.a} {B[m.a].nombre} <span className="tabular-nums">{cop(m.v)}</span></p>
                  <p className="text-ink"><b className="text-amber-700 dark:text-amber-300">Crédito</b> {m.de} {B[m.de].nombre} <span className="tabular-nums">{cop(m.v)}</span></p>
                </div>
              ))}
              <p className="mt-1 text-muted">Débito = a donde llega · Crédito = de donde sale.</p>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => ir(i - 1)} disabled={i === 0}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-muted hover:text-ink disabled:opacity-30">◀ Atrás</button>
          {paso.movs.length > 0 && fase === "llego" && (
            <button type="button" onClick={() => setFase("quieto")}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-muted hover:text-ink">↻ Ver otra vez</button>
          )}
          <span className="ml-auto text-xs text-muted">Paso {i + 1} de {PASOS.length}</span>
          {i < PASOS.length - 1 ? (
            <button type="button" onClick={() => ir(i + 1)} disabled={fase === "viajando"}
                    className="rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">Siguiente ▶</button>
          ) : (
            <button type="button" onClick={onCerrar} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-white">Terminar ✓</button>
          )}
        </div>
      </div>
    </div>
  );
}
