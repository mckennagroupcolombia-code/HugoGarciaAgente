/**
 * La vista «Operación» de Colaboradores (26-sep-2026): el proyecto como un juego de gestión —
 * un diorama de la cadena de valor, al estilo de Tiny Tower o Project Highrise — sobre las cajas
 * que ya tiene el tablero. Pisos fijos, de abajo arriba:
 *
 *   Subsuelo · Mercado externo      las cajas «Proveedor» (tiendas NPC: entrega, fiabilidad, insumos)
 *   P1 · Compras y ensamblaje       avatares de ese piso; comprar insumos y «craftear» (venta interna)
 *   P2 · Hub corporativo            McKenna: la bóveda (lo que queda de cada venta) y el inventario
 *   Mesa de guerra                  los consensos: por decidir, y los decididos para calificar (dharma)
 *   P3 · Orquestación y ventas      avatares de ese piso; publicar lo que hay en la bóveda
 *   Techo · Cliente final           «¡Venta!»: caen monedas y se reparten según las reglas
 *
 * Las jugadas las registra el servidor (POST …/operacion, colaboradores.accion_operacion); aquí
 * solo se dibujan y se piden. ⚠️ Es una SIMULACIÓN del proyecto: no toca Alegra, ni el inventario,
 * ni el Libro Mayor de McKenna.
 */
import "./operacion.css";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { tocarSonido } from "../../lib/sonidosJuego";
import { Sprite } from "./pixel";

type Dinero = { monto: number; moneda: string };
export type Avatar = {
  id: string; nombre: string; rol: string; skills: string[]; piso: "compras" | "hub" | "orquestacion";
  color: string; carril: string | null; usuario_id: number | null;
};
type Reparto = { moneda: string; total: number; costo: number; ensamblaje: number; servicios: number; mckenna: number; sin_sumar: string[] };
type Venta = { id: string; nodo: string; cantidad: number; precio_unit: Dinero; fecha: string; por: number; reparto: Reparto };
export type Operacion = {
  ente: { nombre: string; margen_pct?: number; costos_fijos?: Dinero; capital?: Dinero };
  avatares: Avatar[];
  reparto: { ensamblaje_pct: number; servicios_pct: number };
  items: Record<string, { fase: "sourcing" | "ensamblado" | "en_mckenna" | "publicado"; unidades: number }>;
  ventas: Venta[];
  resultados: Record<string, "bien" | "mal">;
  bitacora: { fecha: string; quien: string; texto: string }[];
};
export type NodoOp = {
  id: string; label: string; tipo: string; carril: string; sku?: string; imagen?: string; precio?: Dinero;
  componentes?: { nombre: string; sku?: string; cantidad?: string; costo?: Dinero; proveedor?: string }[];
  empaque?: { nombre: string; costo?: Dinero }; entrega_dias?: number; fiabilidad?: number; url?: string;
  asunto?: string; propuestas?: { id: string; autor?: number; texto: string }[]; votos?: Record<string, string>;
  resuelto?: { propuesta: string; modo: string; por?: number }; skill?: string;
};

const COLORES_AVATAR = ["#b45309", "#1d4ed8", "#0f766e", "#7c3aed", "#b91c1c", "#15803d", "#374151"];
const FASE: Record<string, string> = {
  sourcing: "Por comprar insumos", ensamblado: "Insumos comprados", en_mckenna: "En la bóveda", publicado: "Publicado",
};

function plata(d?: Dinero | null): string {
  if (!d) return "—";
  return `${d.moneda === "COP" ? "$" : d.moneda + " "}${Math.round(d.monto).toLocaleString("es-CO")}`;
}
type Var = CSSProperties & Record<`--${string}`, string>;

export default function OperacionDiorama({
  nodos, operacion: op, dharma, participantes, jugar, onTocar, foto,
}: {
  nodos: NodoOp[];
  operacion: Operacion;
  dharma: Record<string, number>;
  participantes: Record<string, string>;
  /** Una jugada al servidor: devuelve la operación ya actualizada (null si no se pudo). */
  jugar: (accion: string, datos?: Record<string, unknown>) => Promise<Operacion | null>;
  onTocar: (id: string) => void;
  foto?: (mid: string) => ReactNode;
}) {
  const productos = nodos.filter((n) => n.tipo === "producto");
  const proveedores = nodos.filter((n) => n.tipo === "proveedor");
  const consensos = nodos.filter((n) => n.tipo === "consenso");
  const clientes = nodos.filter((n) => n.tipo === "externo");
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const it = (id: string) => op.items[id] ?? { fase: "sourcing" as const, unidades: 0 };
  const enPiso = (p: Avatar["piso"]) => op.avatares.filter((a) => a.piso === p);

  // Lo que ganó cada quien: el costo y el ensamblaje van a los avatares de compras, los servicios a
  // los de orquestación (repartido por partes iguales en cada piso) y el margen a la bóveda.
  const ganado = useMemo(() => {
    const suma = (m: Record<string, number>, mon: string, v: number) => { m[mon] = (m[mon] ?? 0) + v; };
    const por: Record<string, Record<string, number>> = {};
    const boveda: Record<string, number> = {};
    const compras = op.avatares.filter((a) => a.piso === "compras");
    const orq = op.avatares.filter((a) => a.piso === "orquestacion");
    for (const v of op.ventas) {
      const r = v.reparto;
      suma(boveda, r.moneda, r.mckenna);
      for (const a of compras) suma((por[a.id] ??= {}), r.moneda, (r.costo + r.ensamblaje) / compras.length);
      for (const a of orq) suma((por[a.id] ??= {}), r.moneda, r.servicios / orq.length);
    }
    return { por, boveda };
  }, [op]);

  const [lluvia, setLluvia] = useState<Reparto | null>(null);
  const [reglas, setReglas] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function jugada(clave: string, accion: string, datos: Record<string, unknown>) {
    setOcupado(clave); setError(null);
    try {
      const ok = await jugar(accion, datos);
      if (!ok) return;
      if (accion === "comprar" || accion === "craftear") tocarSonido(accion === "comprar" ? "abastecer" : "preparar");
      if (accion === "publicar") tocarSonido("publicar");
    } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }

  async function vender(n: NodoOp, cantidad: number, precio?: number) {
    setOcupado(`v-${n.id}`); setError(null);
    try {
      const nueva = await jugar("vender", { nodo: n.id, cantidad, ...(precio ? { precio: { monto: precio, moneda: n.precio?.moneda ?? "COP" } } : {}) });
      if (!nueva) return;
      // El reparto lo calcula el servidor: es el de la venta que acaba de quedar registrada.
      const rep = nueva.ventas[nueva.ventas.length - 1]?.reparto;
      if (!rep) return;
      tocarSonido("vender");
      window.setTimeout(() => tocarSonido(rep.mckenna >= 0 ? "dirigir" : "urgente"), 350);
      setLluvia(rep);
      window.setTimeout(() => setLluvia(null), 3200);
    } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }
  const AvatarCarta = ({ a }: { a: Avatar }) => {
    const d = a.usuario_id != null ? dharma[String(a.usuario_id)] ?? 0 : null;
    const g = ganado.por[a.id] ?? {};
    return (
      <div className="op-avatar" style={{ "--color": a.color } as Var}>
        <Sprite s="jugador" px={3} colores={{ X: a.color }} />
        <div className="min-w-0">
          <p className="op-avatar-n">{a.nombre}</p>
          <p className="op-avatar-r">{a.rol}</p>
          <p className="op-skills">{a.skills.map((s) => <span key={s}>{s}</span>)}</p>
          <p className="op-avatar-d">
            {d != null && <span title="Dharma: decisiones calificadas (+1 salió bien, −1 salió mal)">☯ {d > 0 ? `+${d}` : d}</span>}
            {Object.entries(g).map(([m, v]) => <span key={m} title="Lo que le tocó de las ventas"><Sprite s="moneda" px={2} /> {plata({ monto: v, moneda: m })}</span>)}
          </p>
        </div>
      </div>
    );
  };

  const Receta = ({ n }: { n: NodoOp }) => (
    <ul className="op-receta">
      {(n.componentes ?? []).map((c, i) => (
        <li key={i}>
          <span>└ {c.sku ? <b>{c.sku} </b> : null}{c.nombre}{c.cantidad ? ` · ${c.cantidad}` : ""}</span>
          <span>{c.proveedor && porId.get(c.proveedor) ? `de ${porId.get(c.proveedor)!.label}` : ""} {c.costo ? plata(c.costo) : ""}</span>
        </li>
      ))}
      {n.empaque?.nombre && <li><span>└ {n.empaque.nombre} (empaque)</span><span>{plata(n.empaque.costo)}</span></li>}
      {!n.componentes?.length && <li className="op-vacio">Sin receta: ábrelo y agrega sus piezas.</li>}
    </ul>
  );

  /** Quién es dueño de la mercancía en cada momento: el diagrama plano no lo mostraba. */
  const DUENOS = ["Proveedor", "Compras", "McKenna", "Orquestación", "Cliente"];
  const duenoActual = (n: NodoOp) => {
    const f = it(n.id);
    if (f.fase === "sourcing") return 0;
    if (f.fase === "ensamblado") return 1;
    return f.fase === "publicado" ? 3 : 2;
  };
  const nombreDe = (piso: Avatar["piso"]) => enPiso(piso).map((a) => a.nombre.split(" ")[0]).join(" y ");
  /** Riesgo de abastecimiento: la fiabilidad más baja y la entrega más lenta de sus proveedores. */
  const riesgo = (n: NodoOp) => {
    const provs = [...new Set((n.componentes ?? []).map((c) => c.proveedor).filter(Boolean) as string[])]
      .map((id) => porId.get(id)).filter((v): v is NodoOp => Boolean(v));
    if (!provs.length) return null;
    const fia = Math.min(...provs.map((v) => v.fiabilidad ?? 3));
    const dias = Math.max(...provs.map((v) => v.entrega_dias ?? 0));
    return { nivel: fia <= 2 ? "alto" : fia === 3 ? "medio" : "bajo", dias, n: provs.length };
  };
  const Item = ({ n, children }: { n: NodoOp; children?: ReactNode }) => (
    <div className="op-item">
      <button type="button" className="op-item-cab" onClick={() => onTocar(n.id)} title="Abrir el producto: su receta, precio y foto">
        <span className="op-item-foto">{n.imagen && foto ? foto(n.imagen) : <Sprite s="gema" px={3} />}</span>
        <span className="min-w-0">
          <b className="block truncate">{n.label}</b>
          <span className="op-sku">{n.sku || "sin SKU"} · {FASE[it(n.id).fase]}{it(n.id).unidades ? ` · ${it(n.id).unidades} u` : ""}</span>
        </span>
      </button>
      <ol className="op-cadena" aria-label="De quién es la mercancía ahora">
        {DUENOS.map((d, i) => {
          const quien = i === 1 ? nombreDe("compras") : i === 3 ? nombreDe("orquestacion") : "";
          return (
            <li key={d} className={i === duenoActual(n) ? "op-cadena-ahora" : i < duenoActual(n) ? "op-cadena-paso" : ""}
                title={i === duenoActual(n) ? "Aquí está ahora" : undefined}>
              {d}{quien ? ` · ${quien}` : ""}
            </li>
          );
        })}
      </ol>
      {(() => {
        const rg = riesgo(n);
        return rg ? (
          <p className={`op-riesgo op-riesgo-${rg.nivel}`}>
            Riesgo de abastecimiento {rg.nivel} · insumos listos en {rg.dias} día{rg.dias === 1 ? "" : "s"} ({rg.n} proveedor{rg.n === 1 ? "" : "es"})
          </p>
        ) : null;
      })()}
      {children}
    </div>
  );

  const decisionDe = (n: NodoOp) => n.propuestas?.find((p) => p.id === n.resuelto?.propuesta);
  const quienDecidio = (n: NodoOp) => {
    const r = n.resuelto;
    if (!r) return "";
    const uid = r.modo === "acuerdo" ? decisionDe(n)?.autor : r.por;
    const nombre = uid != null ? participantes[String(uid)] ?? `#${uid}` : "";
    return r.modo === "skill" ? `${nombre} (por habilidad: ${n.skill})` : r.modo === "turno" ? `${nombre} (por turno)` : `${nombre} (acuerdo)`;
  };

  const boveda = Object.entries(ganado.boveda);

  return (
    <div className="op-obra">
      <div className="op-cielo">
        <div className="op-hud">
          <span className="op-hud-t">Operación</span>
          <span className={boveda.some(([, v]) => v < 0) ? "op-perdida" : ""}
                title="Lo que le queda a la empresa después de pagar costo, ensamblaje y servicios">
            <Sprite s="cofre" px={2} /> Bóveda: {boveda.length ? boveda.map(([m, v]) => plata({ monto: v, moneda: m })).join(" · ") : "vacía"}
          </span>
          <span>· {op.ventas.length} venta{op.ventas.length === 1 ? "" : "s"}</span>
          <span className="op-sim" title="Es un ensayo del proyecto: no mueve el inventario ni la contabilidad de la empresa">simulación del proyecto</span>
          <button type="button" className="op-btn op-btn-claro ml-auto" onClick={() => setReglas(true)}>⚙ Reglas</button>
        </div>
        {error && <p className="op-error" role="alert">{error}</p>}

        <div className="op-torre">
          {/* ── Techo: el cliente final ── */}
          <section className="op-piso op-techo" style={{ "--fondo": "#FFEC27" } as Var}>
            <header className="op-placa"><span className="op-num">★</span><b>Techo · Cliente final</b><span>Aquí cae el botín.</span></header>
            <div className="op-sala">
              {clientes.map((c) => (
                <button key={c.id} type="button" className="op-npc" onClick={() => onTocar(c.id)}>
                  <Sprite s="jugador" px={3} colores={{ X: "#FF77A8" }} /> {c.label}
                </button>
              ))}
              {productos.filter((n) => it(n.id).fase === "publicado").map((n) => (
                <Item key={n.id} n={n}>
                  <Vender n={n} unidades={it(n.id).unidades} ocupado={ocupado === `v-${n.id}`} onVender={vender} />
                </Item>
              ))}
              {!productos.some((n) => it(n.id).fase === "publicado") && (
                <p className="op-vacio">Nada publicado todavía: Orquestación publica lo que hay en la bóveda.</p>
              )}
            </div>
            {lluvia && <Lluvia r={lluvia} ente={op.ente.nombre} />}
          </section>

          {/* ── P3: orquestación ── */}
          <section className="op-piso" style={{ "--fondo": "#29ADFF" } as Var}>
            <header className="op-placa"><span className="op-num">P3</span><b>Orquestación y ventas</b><span>Diseño, integraciones, publicación, automatización.</span></header>
            <div className="op-sala">
              {enPiso("orquestacion").map((a) => <AvatarCarta key={a.id} a={a} />)}
              {productos.filter((n) => it(n.id).fase === "en_mckenna").map((n) => (
                <Item key={n.id} n={n}>
                  <button type="button" className="op-btn" disabled={ocupado === `p-${n.id}`}
                          onClick={() => void jugada(`p-${n.id}`, "publicar", { nodo: n.id })}>Publicar ▶</button>
                </Item>
              ))}
            </div>
          </section>

          {/* ── Mesa de guerra: los consensos ── */}
          <section className="op-piso op-guerra" style={{ "--fondo": "#7E2553" } as Var}>
            <header className="op-placa"><span className="op-num">⚔</span><b>Mesa de guerra</b><span>Se propone, se vota; el empate lo rompe la habilidad o el turno.</span></header>
            <div className="op-sala">
              {consensos.length === 0 && <p className="op-vacio op-vacio-claro">Sin decisiones en juego. Agrega una caja «Consenso» en el tablero.</p>}
              {consensos.map((n) => {
                const d = decisionDe(n);
                const res = op.resultados[n.id];
                return (
                  <div key={n.id} className={`op-mesa ${n.resuelto ? "op-mesa-lista" : ""}`}>
                    <button type="button" className="op-mesa-t" onClick={() => onTocar(n.id)}>
                      <Sprite s="urna" px={2} /> <b>{n.label}</b>
                    </button>
                    {n.resuelto ? (
                      <>
                        <p>Se decidió: <b>{d?.texto ?? "—"}</b></p>
                        <p className="op-sku">Decidió {quienDecidio(n)}</p>
                        <p className="op-resultado">
                          ¿Cómo resultó?
                          {(["bien", "mal"] as const).map((v) => (
                            <button key={v} type="button" aria-pressed={res === v}
                                    className={`op-btn op-btn-mini ${res === v ? (v === "bien" ? "op-bien" : "op-mal") : "op-btn-claro"}`}
                                    onClick={() => void jugada(`r-${n.id}`, "resultado", { nodo: n.id, valor: res === v ? null : v })}>
                              {v === "bien" ? "Salió bien +1" : "Salió mal −1"}
                            </button>
                          ))}
                        </p>
                      </>
                    ) : (
                      <p className="op-sku">
                        {n.propuestas?.length ?? 0} propuesta(s) · {Object.keys(n.votos ?? {}).length} voto(s)
                        {n.skill ? ` · desempata quien sepa de ${n.skill}` : " · desempata el turno"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── P2: el hub de McKenna ── */}
          <section className="op-piso" style={{ "--fondo": "#1D2B53" } as Var}>
            <header className="op-placa op-placa-oscura"><span className="op-num">P2</span><b>Hub corporativo · {op.ente.nombre}</b><span>La bóveda, el ente jurídico y el inventario central.</span></header>
            <div className="op-sala">
              <div className="op-boveda">
                <Sprite s="cofre" px={4} />
                <div>
                  <p><b>Bóveda</b>: {boveda.length ? boveda.map(([m, v]) => plata({ monto: v, moneda: m })).join(" · ") : "$0"}</p>
                  <p className="op-sku">
                    {op.ente.margen_pct != null ? `margen objetivo ${op.ente.margen_pct} % · ` : ""}
                    {op.ente.costos_fijos ? `costos fijos ${plata(op.ente.costos_fijos)}/mes · ` : ""}
                    {op.ente.capital ? `capital ${plata(op.ente.capital)}` : ""}
                    {op.ente.margen_pct == null && !op.ente.costos_fijos && !op.ente.capital ? "Sin reglas de negocio todavía (⚙ Reglas)." : ""}
                  </p>
                </div>
              </div>
              {enPiso("hub").map((a) => <AvatarCarta key={a.id} a={a} />)}
              {productos.filter((n) => it(n.id).unidades > 0).map((n) => <Item key={n.id} n={n} />)}
              {!productos.some((n) => it(n.id).unidades > 0) && <p className="op-vacio op-vacio-claro">Inventario vacío: Compras ensambla y le vende a la empresa.</p>}
            </div>
          </section>

          {/* ── P1: compras y ensamblaje ── */}
          <section className="op-piso" style={{ "--fondo": "#FFA300" } as Var}>
            <header className="op-placa"><span className="op-num">P1</span><b>Compras y logística</b><span>Se consiguen los insumos y se «craftea» el combo.</span></header>
            <div className="op-sala">
              {enPiso("compras").map((a) => <AvatarCarta key={a.id} a={a} />)}
              {productos.length === 0 && <p className="op-vacio">Sin productos: agrega una caja «Producto» con su receta.</p>}
              {productos.map((n) => {
                const f = it(n.id).fase;
                return (
                  <Item key={n.id} n={n}>
                    <Receta n={n} />
                    {f === "sourcing" ? (
                      <button type="button" className="op-btn" disabled={ocupado === `c-${n.id}`}
                              onClick={() => void jugada(`c-${n.id}`, "comprar", { nodo: n.id })}>Comprar insumos</button>
                    ) : (
                      <Craftear n={n} ocupado={ocupado === `k-${n.id}`}
                                onCraftear={(cant) => void jugada(`k-${n.id}`, "craftear", { nodo: n.id, cantidad: cant })}
                                ente={op.ente.nombre} />
                    )}
                  </Item>
                );
              })}
            </div>
          </section>

          {/* ── Subsuelo: el mercado externo ── */}
          <section className="op-piso op-subsuelo" style={{ "--fondo": "#5F574F" } as Var}>
            <header className="op-placa op-placa-oscura"><span className="op-num">S1</span><b>Mercado externo</b><span>Los proveedores: donde se consiguen los insumos.</span></header>
            <div className="op-sala">
              {proveedores.length === 0 && <p className="op-vacio op-vacio-claro">Sin proveedores. Agrega una caja «Proveedor» en el tablero.</p>}
              {proveedores.map((v) => (
                <button key={v.id} type="button" className="op-tienda" onClick={() => onTocar(v.id)}>
                  <span className="op-toldo" aria-hidden="true" />
                  <b>{v.label}</b>
                  <span className="op-sku">
                    {v.entrega_dias != null ? `⏱ ${v.entrega_dias} día${v.entrega_dias === 1 ? "" : "s"}` : "⏱ ?"} ·{" "}
                    <span title="Fiabilidad">{"★".repeat(v.fiabilidad ?? 0)}{"☆".repeat(5 - (v.fiabilidad ?? 0))}</span>
                  </span>
                  {(v.componentes ?? []).slice(0, 4).map((c, i) => <span key={i} className="op-insumo">{c.nombre} {plata(c.costo)}</span>)}
                </button>
              ))}
            </div>
          </section>

          {op.bitacora.length > 0 && (
            <div className="op-bitacora">
              <p className="op-hud-t">Bitácora de misiones</p>
              {[...op.bitacora].reverse().slice(0, 8).map((b, i) => (
                <p key={i}><span className="op-sku">{b.fecha}</span> <b>{b.quien}</b> {b.texto}</p>
              ))}
            </div>
          )}
        </div>
      </div>
      {reglas && (
        <ReglasHoja op={op} participantes={participantes} onCerrar={() => setReglas(false)}
                    onGuardar={async (datos) => {
                      try { if (await jugar("reglas", datos)) setReglas(false); }
                      catch (e) { setError((e as Error).message); setReglas(false); }
                    }} />
      )}
    </div>
  );
}

function Vender({ n, unidades, ocupado, onVender }: {
  n: NodoOp; unidades: number; ocupado: boolean; onVender: (n: NodoOp, cantidad: number, precio?: number) => void;
}) {
  const [cant, setCant] = useState(1);
  const [precio, setPrecio] = useState<string>(n.precio ? String(n.precio.monto) : "");
  return (
    <div className="op-fila">
      <input type="number" min={1} max={unidades} value={cant} onChange={(e) => setCant(Math.max(1, Number(e.target.value) || 1))}
             className="op-inp w-16" aria-label="Unidades" />
      <input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ""))}
             className="op-inp w-24" aria-label="Precio por unidad" placeholder="precio" />
      <button type="button" className="op-btn op-vender" disabled={ocupado || unidades < 1}
              onClick={() => onVender(n, cant, Number(precio) || undefined)}>
        ¡Venta! ({unidades} u)
      </button>
    </div>
  );
}

function Craftear({ n, ocupado, onCraftear, ente }: { n: NodoOp; ocupado: boolean; onCraftear: (cant: number) => void; ente: string }) {
  const [cant, setCant] = useState(1);
  return (
    <div className="op-fila">
      <input type="number" min={1} value={cant} onChange={(e) => setCant(Math.max(1, Number(e.target.value) || 1))}
             className="op-inp w-16" aria-label={`Unidades de ${n.label}`} />
      <button type="button" className="op-btn" disabled={ocupado} onClick={() => onCraftear(cant)}
              title={`Ensamblar y venderle las unidades a ${ente} (venta interna)`}>
        Craftear y vender a McKenna
      </button>
    </div>
  );
}

/** La lluvia de monedas de una venta: cae y se reparte en tres montones. */
function Lluvia({ r, ente }: { r: Reparto; ente: string }) {
  const montones = [
    { t: "Compras (costo + ensamblaje)", v: r.costo + r.ensamblaje, c: "#FFA300" },
    { t: "Orquestación (servicios)", v: r.servicios, c: "#29ADFF" },
    { t: `Bóveda ${ente}`, v: r.mckenna, c: r.mckenna >= 0 ? "#00E436" : "#FF004D" },
  ];
  return (
    <div className="op-lluvia" aria-live="polite">
      {montones.map((m, i) => (
        <div key={i} className="op-monton" style={{ "--c": m.c } as Var}>
          {Array.from({ length: 6 }, (_, k) => (
            <span key={k} className="op-moneda" style={{ "--k": String(k), "--i": String(i) } as Var}><Sprite s="moneda" px={3} /></span>
          ))}
          <b>{plata({ monto: m.v, moneda: r.moneda })}</b>
          <span>{m.t}</span>
        </div>
      ))}
    </div>
  );
}

/** Reglas del juego: el ente, el reparto y los avatares (un tercer colaborador se agrega aquí). */
function ReglasHoja({ op, participantes, onCerrar, onGuardar }: {
  op: Operacion; participantes: Record<string, string>;
  onCerrar: () => void; onGuardar: (datos: Record<string, unknown>) => Promise<void>;
}) {
  const [ente, setEnte] = useState(op.ente);
  const [reparto, setReparto] = useState(op.reparto);
  const [avatares, setAvatares] = useState<Avatar[]>(op.avatares);
  const [guardando, setGuardando] = useState(false);
  const setAv = (i: number, c: Partial<Avatar>) => setAvatares((as) => as.map((a, j) => (j === i ? { ...a, ...c } : a)));
  const num = (t: string) => (t.trim() === "" ? undefined : Number(t.replace(/[^\d.]/g, "")));
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCerrar} aria-hidden="true" />
      <div className="px-hoja op-reglas fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[80dvh] w-full max-w-lg space-y-3 overflow-y-auto border-[3px] border-black bg-[#FFF1E8] p-3 text-black sm:bottom-3"
           role="dialog" aria-label="Reglas del juego">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black uppercase">⚙ Reglas del juego</p>
          <button type="button" onClick={onCerrar} className="px-1 text-lg" aria-label="Cerrar">×</button>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs font-bold uppercase">El ente</legend>
          <input className="op-inp w-full" value={ente.nombre} onChange={(e) => setEnte({ ...ente, nombre: e.target.value })} />
          <div className="flex gap-1">
            <label className="flex-1 text-xs">Margen objetivo %
              <input className="op-inp w-full" inputMode="numeric" value={ente.margen_pct ?? ""} onChange={(e) => setEnte({ ...ente, margen_pct: num(e.target.value) })} /></label>
            <label className="flex-1 text-xs">Costos fijos / mes (COP)
              <input className="op-inp w-full" inputMode="numeric" value={ente.costos_fijos?.monto ?? ""}
                     onChange={(e) => { const v = num(e.target.value); setEnte({ ...ente, costos_fijos: v != null ? { monto: v, moneda: "COP" } : undefined }); }} /></label>
            <label className="flex-1 text-xs">Capital (COP)
              <input className="op-inp w-full" inputMode="numeric" value={ente.capital?.monto ?? ""}
                     onChange={(e) => { const v = num(e.target.value); setEnte({ ...ente, capital: v != null ? { monto: v, moneda: "COP" } : undefined }); }} /></label>
          </div>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="text-xs font-bold uppercase">Reparto de cada venta</legend>
          <p className="text-[11px]">Compras recibe el costo de los insumos más el % de ensamblaje sobre ese costo; Orquestación, el % de servicios sobre el total; lo que queda va a la bóveda.</p>
          <div className="flex gap-1">
            <label className="flex-1 text-xs">Ensamblaje % (sobre el costo)
              <input className="op-inp w-full" inputMode="numeric" value={reparto.ensamblaje_pct} onChange={(e) => setReparto({ ...reparto, ensamblaje_pct: num(e.target.value) ?? 0 })} /></label>
            <label className="flex-1 text-xs">Servicios % (sobre la venta)
              <input className="op-inp w-full" inputMode="numeric" value={reparto.servicios_pct} onChange={(e) => setReparto({ ...reparto, servicios_pct: num(e.target.value) ?? 0 })} /></label>
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase">Avatares (jugadores)</legend>
          {avatares.map((a, i) => (
            <div key={a.id} className="space-y-1 border-2 border-black bg-white p-2">
              <div className="flex gap-1">
                <input className="op-inp min-w-0 flex-1" placeholder="Nombre" value={a.nombre} onChange={(e) => setAv(i, { nombre: e.target.value })} />
                <button type="button" className="px-1 text-red-600" aria-label="Quitar avatar" onClick={() => setAvatares((as) => as.filter((_, j) => j !== i))}>×</button>
              </div>
              <input className="op-inp w-full" placeholder="Rol" value={a.rol} onChange={(e) => setAv(i, { rol: e.target.value })} />
              <input className="op-inp w-full" placeholder="Habilidades, separadas por coma" value={a.skills.join(", ")}
                     onChange={(e) => setAv(i, { skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              <div className="flex flex-wrap gap-1">
                <select className="op-inp" value={a.piso} onChange={(e) => setAv(i, { piso: e.target.value as Avatar["piso"] })} aria-label="Piso">
                  <option value="compras">P1 · Compras</option><option value="hub">P2 · Hub</option><option value="orquestacion">P3 · Orquestación</option>
                </select>
                <select className="op-inp" value={a.usuario_id ?? ""} onChange={(e) => setAv(i, { usuario_id: e.target.value ? Number(e.target.value) : null })} aria-label="Cuenta que juega">
                  <option value="">sin cuenta</option>
                  {Object.entries(participantes).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                </select>
                <span className="flex gap-0.5">
                  {COLORES_AVATAR.map((c) => (
                    <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={a.color === c} onClick={() => setAv(i, { color: c })}
                            className="h-6 w-6 border-2" style={{ background: c, borderColor: a.color === c ? "#000" : "#fff" }} />
                  ))}
                </span>
              </div>
            </div>
          ))}
          {avatares.length < 8 && (
            <button type="button" className="op-btn op-btn-claro"
                    onClick={() => setAvatares((as) => [...as, { id: `a-${Date.now().toString(36)}`, nombre: "Nuevo colaborador", rol: "",
                      skills: [], piso: "hub", color: COLORES_AVATAR[as.length % COLORES_AVATAR.length], carril: null, usuario_id: null }])}>
              ＋ Avatar
            </button>
          )}
          <p className="text-[11px]">Votan en la mesa de guerra las dos cuentas del proyecto. Un avatar «sin cuenta» juega en el diorama pero no vota.</p>
        </fieldset>
        <button type="button" className="op-btn w-full" disabled={guardando}
                onClick={async () => { setGuardando(true); try { await onGuardar({ ente, reparto, avatares }); } finally { setGuardando(false); } }}>
          {guardando ? "Guardando…" : "Guardar reglas"}
        </button>
      </div>
    </>
  );
}
