import { useEffect, useState } from "react";

/**
 * «Sus flujos de trabajo» dentro de la ficha (5-oct-2026): en qué cadenas de la operación
 * participa cada persona y en qué pasos. Cada flujo es una cadena en orden (la misma operación
 * del Edificio del Mapa, mapa/operacionMcKenna.ts); los pasos que hace la persona salen de su
 * ficha (rendimiento.py) y, en los que no hace, se dice quién los hace
 * (/api/mapa-sistema/quien-hace). Solo nombres, veces y horas de la propia ficha.
 */

type Funcion = { id: string; funcion: string; veces: number; horas: number };
type Persona = { id: number; nombre: string; peso: number };
type Paso = { nombre: string; funciones: string[] };
type Flujo = { id: string; nombre: string; resumen: string; pasos: Paso[] };

// En orden: cómo avanza el trabajo de un paso al siguiente. Un paso puede atenderlo más de una
// función (imprimir etiquetas desde la impresora o desde el Studio es el mismo paso).
const FLUJOS: Flujo[] = [
  {
    id: "produccion", nombre: "Producción", resumen: "De la materia prima al producto etiquetado",
    pasos: [
      { nombre: "Recibe y guarda insumos", funciones: ["compras"] },
      { nombre: "Prepara fórmulas", funciones: ["preparar"] },
      { nombre: "Dosifica y envasa", funciones: ["envasar"] },
      { nombre: "Empaca y sella", funciones: ["empacar"] },
      { nombre: "Fecha y lote", funciones: ["lote"] },
      { nombre: "Imprime la etiqueta", funciones: ["imprimir_et", "imprimir_studio"] },
    ],
  },
  {
    id: "hongos", nombre: "Línea de hongos", resumen: "Del sustrato al hongo listo",
    pasos: [{ nombre: "Sustrato, inoculación y monotubes", funciones: ["hongos"] }],
  },
  {
    id: "despachos", nombre: "Despachos", resumen: "Del pedido a la transportadora",
    pasos: [
      { nombre: "Alista el pedido", funciones: ["alistar"] },
      { nombre: "Embala", funciones: ["embalar"] },
      { nombre: "Imprime la guía", funciones: ["guias"] },
      { nombre: "Anota la guía", funciones: ["cuaderno"] },
      { nombre: "Lleva a la transportadora", funciones: ["envio"] },
    ],
  },
  {
    id: "ventas", nombre: "Ventas y clientes", resumen: "De la pregunta del cliente a la factura",
    pasos: [
      { nombre: "Atiende clientes", funciones: ["clientes"] },
      { nombre: "Preventa y postventa MeLi", funciones: ["meli_qa"] },
      { nombre: "Factura", funciones: ["facturar"] },
      { nombre: "Anulaciones y notas crédito", funciones: ["nc"] },
    ],
  },
  {
    id: "pagos", nombre: "Pagos y contabilidad", resumen: "De la factura de compra al informe",
    pasos: [
      { nombre: "Monta la solicitud de pago", funciones: ["sol_pago"] },
      { nombre: "Aprueba el pago", funciones: ["aprobar"] },
      { nombre: "Compras al exterior", funciones: ["exterior"] },
      { nombre: "Libro Mayor e impuestos", funciones: ["contab"] },
      { nombre: "Rentabilidad", funciones: ["analisis"] },
    ],
  },
  {
    id: "catalogo", nombre: "Catálogo y calidad", resumen: "Del diseño de la etiqueta a la publicación",
    pasos: [
      { nombre: "Diseña etiquetas", funciones: ["diseno"] },
      { nombre: "Fichas técnicas, COA y SDS", funciones: ["docs"] },
      { nombre: "Combos y catálogo", funciones: ["catalogo"] },
      { nombre: "Publica productos y fotos", funciones: ["publica"] },
    ],
  },
  {
    id: "equipo", nombre: "Apoyo al equipo", resumen: "Lo que mantiene la casa andando",
    pasos: [
      { nombre: "Desayuno", funciones: ["desayuno"] },
      { nombre: "Almuerzo", funciones: ["almuerzo"] },
      { nombre: "Aseo", funciones: ["aseo"] },
    ],
  },
];

// Un flujo aparece si la persona le dedica al menos una hora o lo hizo varias veces: un toque
// suelto (abrir una publicación una vez) no es su flujo.
const MIN_HORAS = 1;
const MIN_VECES = 3;

function horasCortas(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${Math.round(h)} h`;
}

export default function FlujosTrabajo({ token, usuarioId, funciones, fs }: {
  token: string; usuarioId: number; funciones: Funcion[]; fs: number;
}) {
  const [quien, setQuien] = useState<Record<string, Persona[]> | null>(null);
  useEffect(() => {
    fetch(`/api/mapa-sistema/quien-hace?_t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setQuien(j?.funciones ?? {}))
      .catch(() => setQuien({}));
  }, [token]);

  const porId = new Map(funciones.map((f) => [f.id, f]));
  const flujos = FLUJOS.map((fl) => {
    const pasos = fl.pasos.map((p) => {
      const suyas = p.funciones.map((id) => porId.get(id)).filter((f): f is Funcion => !!f);
      return {
        ...p,
        nombreSuyo: suyas.length === 1 ? suyas[0].funcion : p.nombre,
        horas: suyas.reduce((a, f) => a + f.horas, 0),
        veces: suyas.reduce((a, f) => a + f.veces, 0),
        hace: suyas.length > 0,
      };
    });
    return {
      ...fl,
      pasos,
      horas: pasos.reduce((a, p) => a + p.horas, 0),
      veces: pasos.reduce((a, p) => a + p.veces, 0),
      hechos: pasos.filter((p) => p.hace).length,
    };
  });
  // Quien desarrolla el sistema: su tiempo en módulos operativos es un flujo aparte.
  const modulos = funciones.filter((f) => f.id.startsWith("modulo_"));
  if (modulos.length) {
    flujos.push({
      id: "desarrollo", nombre: "Desarrollo del sistema", resumen: "Construye y ajusta los módulos del panel con IA",
      pasos: modulos.map((m) => ({ nombre: m.funcion, nombreSuyo: m.funcion, funciones: [m.id], horas: m.horas, veces: m.veces, hace: true })),
      horas: modulos.reduce((a, m) => a + m.horas, 0),
      veces: modulos.reduce((a, m) => a + m.veces, 0),
      hechos: modulos.length,
    });
  }
  const suyos = flujos
    .filter((f) => f.horas >= MIN_HORAS || f.veces >= MIN_VECES)
    .sort((a, b) => b.horas - a.horas || b.veces - a.veces);

  // Quién más hace un paso (sin la persona de la ficha), por nombre de pila.
  const otros = (p: { funciones: string[] }) => {
    const vistos = new Map<number, string>();
    for (const id of p.funciones) {
      for (const x of quien?.[id] ?? []) if (x.id !== usuarioId) vistos.set(x.id, x.nombre);
    }
    return [...vistos.values()].slice(0, 2);
  };

  return (
    <>
      <h3 className="mt-10 font-bold" style={{ fontSize: fs * 1.15 }}>
        Sus flujos de trabajo
      </h3>
      <p style={{ color: "#4a3b2e", fontSize: fs * 0.8 }}>
        Cada flujo es una cadena de pasos en orden. Los pasos en color son los que hace; en los demás se ve quién los hace.
      </p>
      {suyos.length === 0 ? (
        <p className="mt-2" style={{ color: "#4a3b2e" }}>Todavía no hay trabajo registrado en ningún flujo este mes.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {suyos.map((fl) => (
            <section key={fl.id} className="rounded-2xl border-2 p-4" style={{ borderColor: "#e4d6c3" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-bold">{fl.nombre}</span>
                <span className="font-semibold tabular-nums">{horasCortas(fl.horas)}</span>
              </div>
              <p style={{ color: "#4a3b2e", fontSize: fs * 0.75 }}>
                {fl.resumen}
                {fl.pasos.length > 1 && ` · hace ${fl.hechos} de ${fl.pasos.length} pasos`}
              </p>
              <ol className="mt-3 flex flex-wrap items-stretch gap-y-2" style={{ fontSize: fs * 0.72, lineHeight: 1.3 }}>
                {fl.pasos.map((p, i) => {
                  const de = p.hace ? [] : otros(p);
                  return (
                    <li key={p.nombre} className="flex items-stretch">
                      {i > 0 && (
                        <span aria-hidden="true" className="flex items-center px-1.5 font-bold" style={{ color: "#b4581d" }}>
                          →
                        </span>
                      )}
                      <div
                        className="rounded-xl border-2 px-3 py-2"
                        style={
                          p.hace
                            ? { background: "#f6e3cc", borderColor: "#b4581d", color: "#1f1711", maxWidth: 220 }
                            : { borderColor: "#cdbba4", borderStyle: "dashed", color: "#6b5a4a", maxWidth: 220 }
                        }
                      >
                        <span className="sr-only">{`Paso ${i + 1}: `}</span>
                        <span className={p.hace ? "block font-bold" : "block font-semibold"}>{p.hace ? p.nombreSuyo : p.nombre}</span>
                        {p.hace ? (
                          <span className="block tabular-nums">
                            {p.veces ? `${p.veces} ${p.veces === 1 ? "vez" : "veces"}` : ""}
                            {p.veces && p.horas >= 0.05 ? " · " : ""}
                            {p.horas >= 0.05 ? horasCortas(p.horas) : ""}
                          </span>
                        ) : (
                          <span className="block">
                            {quien == null ? "…" : de.length ? `Lo hace ${de.join(" y ")}` : "Nadie lo registra"}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
