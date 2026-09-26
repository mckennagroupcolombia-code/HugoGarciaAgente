/**
 * Colaboradores — la única vista (26-sep-2026): el proyecto es un EDIFICIO en pixel art que se
 * construye entre los dos. Fusiona lo que antes eran tres vistas (tablero, obra y operación):
 *
 *  · Pisos y habitaciones configurables («🏗 Construir»): de abajo arriba, con el nombre que quieran.
 *  · Cada caja es un BLOQUE colocado en una habitación, y se construye a medida que se llena
 *    (terreno → cimientos → estructura → fachada → terminado, colaboradores/obra.ts): llenar el
 *    cómo, dónde, cuándo y por qué, el tiempo, el dinero o sus campos propios ES construirla.
 *  · Las flechas de antes son ENTREGAS: un avatar camina con la caja de un bloque a otro (sube por la
 *    escalera si cambia de piso). Tocarlo abre la entrega.
 *  · El bucle de la operación vive en los bloques de producto (comprar → craftear → publicar →
 *    ¡venta!) y la venta hace llover monedas repartidas según las partidas con nombre de «⚙ Reglas».
 *  · Las decisiones se votan en su bloque y, ya decididas, se califican (dharma).
 *
 * Las jugadas las registra el servidor (colaboradores.accion_operacion). ⚠️ Es una SIMULACIÓN del
 * proyecto: no mueve el inventario ni la contabilidad de la empresa.
 */
import "./edificio-colab.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { tocarSonido } from "../../lib/sonidosJuego";
import { Sprite } from "./pixel";
import { ETAPAS_OBRA, etapaObra, piezasObra } from "./obra";
import {
  COLORES_AVATAR, COLORES_PISO, TINTA_PISO, habitacionDe, nuevoId, plantillaDe, plata,
  type Avatar, type EntregaDoc, type NodoDoc, type Operacion, type Piso, type Regla, type RepartoVenta,
} from "./modelo";

type Var = CSSProperties & Record<`--${string}`, string>;
const CAJA = ["kkkkkkkk", "knnnonnk", "knnnonnk", "kkkkkkkk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"];
const OBRERO = ["..yyyy..", ".yyyyyy.", "..kcck..", "..kcck..", "...kk...", ".kXXXXk.", "kXkXXkXk", "..kXXk..", "..k..k.."];
const FASE: Record<string, string> = {
  sourcing: "Por comprar insumos", ensamblado: "Insumos comprados", en_mckenna: "En la bóveda", publicado: "Publicado",
};
const DUENO: Record<string, string> = {
  sourcing: "el proveedor", ensamblado: "quien ensambla", en_mckenna: "la empresa", publicado: "la empresa (publicado)",
};

export default function EdificioColab({
  nodos, entregas, op, dharma, participantes, selId, onCaja, onEntrega, onNueva, jugar, foto,
}: {
  nodos: NodoDoc[];
  entregas: EntregaDoc[];
  op: Operacion;
  dharma: Record<string, number>;
  participantes: Record<string, string>;
  selId?: string | null;
  onCaja: (id: string) => void;
  onEntrega: (id: string) => void;
  onNueva: (habitacion: string) => void;
  /** Una jugada al servidor: devuelve la operación actualizada (lanza el error si no se pudo). */
  jugar: (accion: string, datos?: Record<string, unknown>) => Promise<Operacion | null>;
  foto?: (mid: string) => ReactNode;
}) {
  const pisos = op.edificio.pisos;
  const avatar = (id?: string | null) => op.avatares.find((a) => a.id === id);
  const porHab = useMemo(() => {
    const m = new Map<string, NodoDoc[]>();
    for (const n of nodos) {
      const h = habitacionDe(n, pisos);
      m.set(h, [...(m.get(h) ?? []), n]);
    }
    return m;
  }, [nodos, pisos]);
  const etapas = useMemo(() => new Map(nodos.map((n) => [n.id, etapaObra(n)])), [nodos]);
  const terminadas = [...etapas.values()].filter((e) => e === 4).length;
  const avance = nodos.length ? Math.round(([...etapas.values()].reduce((s, e) => s + e, 0) / (4 * nodos.length)) * 100) : 0;
  const obraLista = nodos.length > 0 && terminadas === nodos.length;

  // Lo que cada quien ganó y lo que quedó en la bóveda, de las ventas registradas.
  const cuentas = useMemo(() => {
    const por: Record<string, Record<string, number>> = {};
    const boveda: Record<string, number> = {};
    for (const v of op.ventas) {
      const r = v.reparto;
      boveda[r.moneda] = (boveda[r.moneda] ?? 0) + (r.boveda ?? r.mckenna ?? 0);
      for (const p of r.partes ?? []) {
        if (p.para === "boveda") continue;
        (por[p.para] ??= {})[r.moneda] = ((por[p.para] ??= {})[r.moneda] ?? 0) + p.monto;
      }
    }
    return { por, boveda };
  }, [op.ventas]);

  // ── Dónde está cada bloque, para que los avatares caminen de uno a otro ──
  const torre = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [anchoTorre, setAnchoTorre] = useState(0);
  const medir = useCallback(() => {
    const t = torre.current;
    if (!t) return;
    const tr = t.getBoundingClientRect();
    const m: Record<string, { x: number; y: number }> = {};
    t.querySelectorAll<HTMLElement>("[data-caja]").forEach((el) => {
      const r = el.getBoundingClientRect();
      m[el.dataset.caja!] = { x: r.left - tr.left + r.width / 2 - 12, y: r.top - tr.top + r.height - 40 };
    });
    setAnchoTorre(tr.width);
    setPos(m);
  }, []);
  useLayoutEffect(() => { medir(); }, [medir, nodos, entregas, pisos]);
  useEffect(() => {
    const t = torre.current;
    if (!t) return;
    let cuadro = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(cuadro); cuadro = requestAnimationFrame(medir); });
    ro.observe(t);
    return () => { ro.disconnect(); cancelAnimationFrame(cuadro); };
  }, [medir]);

  const [lluvia, setLluvia] = useState<RepartoVenta | null>(null);
  const [hoja, setHoja] = useState<"construir" | "reglas" | null>(null);
  const [avatarAbierto, setAvatarAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function jugada(clave: string, accion: string, datos: Record<string, unknown>) {
    setOcupado(clave); setError(null);
    try {
      const nueva = await jugar(accion, datos);
      if (!nueva) return;
      if (accion === "vender") {
        const rep = nueva.ventas[nueva.ventas.length - 1]?.reparto;
        if (rep) {
          tocarSonido("vender");
          window.setTimeout(() => tocarSonido((rep.boveda ?? 0) >= 0 ? "dirigir" : "urgente"), 350);
          setLluvia(rep);
          window.setTimeout(() => setLluvia(null), 3400);
        }
      } else if (accion === "comprar") tocarSonido("abastecer");
      else if (accion === "craftear") tocarSonido("preparar");
      else if (accion === "publicar") tocarSonido("publicar");
    } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }

  const bovedaTxt = Object.entries(cuentas.boveda).map(([m, v]) => plata({ monto: v, moneda: m })).join(" · ") || "$0";

  return (
    <div className="eb-obra">
      <div className="eb-cielo">
        <div className="eb-hud">
          <span className="eb-hud-t">Obra</span>
          <span className="eb-barra" aria-label={`${avance} % construido`}><span style={{ width: `${avance}%` }} /></span>
          <b>{avance} %</b>
          <span>· {terminadas}/{nodos.length} bloques</span>
          <span className={Object.values(cuentas.boveda).some((v) => v < 0) ? "eb-perdida" : ""}>
            <Sprite s="cofre" px={2} /> {op.reparto.boveda}: {bovedaTxt}
          </span>
          <span className="eb-sim" title="Es un ensayo del proyecto: no mueve el inventario ni la contabilidad de la empresa">simulación</span>
          <span className="ml-auto flex gap-1">
            <button type="button" className="eb-btn eb-btn-claro" onClick={() => setHoja("construir")}>🏗 Construir</button>
            <button type="button" className="eb-btn eb-btn-claro" onClick={() => setHoja("reglas")}>⚙ Reglas</button>
          </span>
        </div>
        {error && <p className="eb-error" role="alert">{error}</p>}

        <div className="eb-torre" ref={torre}>
          {/* El techo: la grúa mientras falte algo por construir; con todo terminado, la fiesta. */}
          <div className="eb-techo" aria-hidden="true">
            {obraLista ? (
              <><Sprite s="bandera" px={4} className="eb-bandera" /><span className="eb-fiesta">¡Obra terminada!</span><Sprite s="trofeo" px={4} /></>
            ) : (
              <div className="eb-grua"><span className="eb-grua-mastil" /><span className="eb-grua-pluma" /><span className="eb-grua-cable"><span className="eb-grua-viga" /></span></div>
            )}
          </div>

          {[...pisos].reverse().map((p, iRev) => {
            const nivel = pisos.length - 1 - iRev;
            const tinta = TINTA_PISO[p.color] ?? "#FFF1E8";
            const suyos = op.avatares.filter((a) => a.piso === p.id);
            return (
              <section key={p.id} className="eb-piso" style={{ "--piso": p.color, "--tinta": tinta } as Var} aria-label={p.nombre}>
                <header className="eb-placa">
                  <span className="eb-num">{nivel === 0 ? "PB" : `P${nivel}`}</span>
                  <b>{p.nombre}</b>
                  <span className="eb-avatares">
                    {suyos.map((a) => (
                      <button key={a.id} type="button" className="eb-avatar-btn" onClick={() => setAvatarAbierto(avatarAbierto === a.id ? null : a.id)}
                              aria-expanded={avatarAbierto === a.id} title={`${a.nombre} · ${a.rol}`}>
                        <Sprite s="jugador" px={3} colores={{ X: a.color }} /> {a.nombre.split(" ")[0]}
                      </button>
                    ))}
                  </span>
                  {suyos.filter((a) => a.id === avatarAbierto).map((a) => (
                    <AvatarCarta key={a.id} a={a} dharma={a.usuario_id != null ? dharma[String(a.usuario_id)] ?? 0 : null} ganado={cuentas.por[a.id] ?? {}} />
                  ))}
                </header>
                <div className="eb-habs">
                  {p.habitaciones.map((h) => {
                    const cajas = porHab.get(h.id) ?? [];
                    return (
                      <div key={h.id} className="eb-hab" data-hab={h.id}>
                        <p className="eb-hab-t"><span>{h.nombre}</span>
                          <button type="button" className="eb-mas" onClick={() => onNueva(h.id)} title={`Colocar una caja en ${h.nombre}`} aria-label={`Nueva caja en ${h.nombre}`}>＋</button>
                        </p>
                        <div className="eb-cajas">
                          {cajas.length === 0 && (
                            <button type="button" className="eb-vacio" onClick={() => onNueva(h.id)}>Terreno libre: colocar una caja</button>
                          )}
                          {cajas.map((n) => (
                            <Bloque key={n.id} n={n} etapa={etapas.get(n.id) ?? 0} sel={selId === n.id} op={op}
                                    responsable={avatar(n.avatar)} nodos={nodos} participantes={participantes}
                                    ocupado={ocupado} foto={foto}
                                    onAbrir={() => onCaja(n.id)} jugada={jugada} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <span className="eb-escalera" aria-hidden="true" />
              </section>
            );
          })}
          <div className="eb-suelo" aria-hidden="true" />

          {/* Las entregas: el avatar camina con la caja de un bloque al otro (por la escalera si cambia de piso). */}
          <div className="eb-capa">
            {entregas.map((e, i) => {
              const a = pos[e.from], b = pos[e.to];
              if (!a || !b) return null;
              const mismoPiso = Math.abs(a.y - b.y) < 30;
              const xs = mismoPiso ? b.x : anchoTorre - 34;
              const quien = avatar(e.portador);
              return (
                // El DIV se mueve (index.css fuerza `position: relative` en todo <button>); el botón va dentro.
                <div key={e.id} className="eb-porta"
                     style={{ "--x0": `${a.x}px`, "--y0": `${a.y}px`, "--xs": `${xs}px`, "--x1": `${b.x}px`, "--y1": `${b.y}px`,
                              "--dur": `${mismoPiso ? 6 : 9}s`, "--retraso": `${-i * 1.7}s` } as Var}>
                  <button type="button" className="eb-porta-btn" onClick={() => onEntrega(e.id)} data-entrega={e.id}
                          title={`${quien?.nombre ?? "Alguien"} lleva ${e.label ? `«${e.label}»` : "la caja"} de «${nodos.find((n) => n.id === e.from)?.label}» a «${nodos.find((n) => n.id === e.to)?.label}»`}>
                    <span className="eb-porta-carga"><Sprite s={CAJA} px={2} /></span>
                    <Sprite s="jugador" px={3} colores={{ X: quien?.color ?? "#374151" }} />
                    {e.label && <span className="eb-porta-etq">{e.label}</span>}
                  </button>
                </div>
              );
            })}
          </div>
          {lluvia && <Lluvia r={lluvia} avatares={op.avatares} />}
        </div>

        {op.bitacora.length > 0 && (
          <details className="eb-bitacora">
            <summary>Bitácora de misiones ({op.bitacora.length})</summary>
            {[...op.bitacora].reverse().slice(0, 12).map((b, i) => (
              <p key={i}><span className="eb-gris">{b.fecha}</span> <b>{b.quien}</b> {b.texto}</p>
            ))}
          </details>
        )}
      </div>

      {hoja === "construir" && (
        <ConstruirHoja pisos={pisos} porHab={porHab} onCerrar={() => setHoja(null)}
                       onGuardar={async (nuevos) => {
                         try { await jugar("edificio", { edificio: { pisos: nuevos } }); tocarSonido("preparar"); setHoja(null); }
                         catch (e) { setError((e as Error).message); setHoja(null); }
                       }} />
      )}
      {hoja === "reglas" && (
        <ReglasHoja op={op} participantes={participantes} onCerrar={() => setHoja(null)}
                    onGuardar={async (datos) => {
                      try { await jugar("reglas", datos); setHoja(null); }
                      catch (e) { setError((e as Error).message); setHoja(null); }
                    }} />
      )}
    </div>
  );
}

// ─── Un bloque (una caja) ────────────────────────────────────────────────────

function Bloque({ n, etapa, sel, op, responsable, nodos, participantes, ocupado, foto, onAbrir, jugada }: {
  n: NodoDoc; etapa: number; sel: boolean; op: Operacion; responsable?: Avatar; nodos: NodoDoc[];
  participantes: Record<string, string>; ocupado: string | null; foto?: (mid: string) => ReactNode;
  onAbrir: () => void; jugada: (clave: string, accion: string, datos: Record<string, unknown>) => Promise<void>;
}) {
  const pl = plantillaDe(n.tipo);
  const { faltan } = piezasObra(n);
  const it = op.items[n.id] ?? { fase: "sourcing", unidades: 0 };
  const [cant, setCant] = useState(1);
  const color = responsable?.color ?? "#374151";
  return (
    <div className={`eb-bloque eb-e${etapa} ${sel ? "eb-sel" : ""}`} data-caja={n.id} style={{ "--resp": color } as Var}>
      {/* La fachada del bloque: cómo va su obra, con su ícono y quien trabaja en él. */}
      <button type="button" className="eb-fachada" onClick={onAbrir}
              title={faltan.length && etapa < 4 ? `Para construirlo falta: ${faltan.join(", ")}` : "Terminado"}>
        <span className="eb-icono">{n.imagen && foto && etapa >= 3 ? foto(n.imagen) : <Sprite s={n.icono ?? pl.icono} px={3} />}</span>
        {etapa < 4 && etapa > 0 && <span className="eb-obrero"><Sprite s={OBRERO} px={2} colores={{ X: color }} /></span>}
        <span className="eb-etapa-t">{ETAPAS_OBRA[etapa]}</span>
      </button>
      <button type="button" className="eb-cuerpo" onClick={onAbrir}>
        <b className="eb-titulo">{n.label}</b>
        <span className="eb-sub">
          {responsable && <><Sprite s="jugador" px={2} colores={{ X: color }} /> {responsable.nombre.split(" ")[0]} · </>}
          {pl.label}
        </span>
        {n.tipo === "producto" && <span className="eb-sub">{n.sku || "sin SKU"} · {FASE[it.fase]}{it.unidades ? ` · ${it.unidades} u` : ""} · es de {DUENO[it.fase]}</span>}
        {n.tipo === "proveedor" && (
          <span className="eb-sub">⏱ {n.entrega_dias ?? "?"} d · {"★".repeat(n.fiabilidad ?? 0)}{"☆".repeat(5 - (n.fiabilidad ?? 0))}</span>
        )}
        {n.tipo === "consenso" && (
          <span className="eb-sub">
            {n.resuelto ? `Decidido: ${n.propuestas?.find((p) => p.id === n.resuelto?.propuesta)?.texto ?? "—"}`
              : `Por decidir · ${n.propuestas?.length ?? 0} propuesta(s) · ${Object.keys(n.votos ?? {}).length} voto(s)`}
          </span>
        )}
        {(n.datos ?? []).filter((d) => d.campo || d.valor).slice(0, 3).map((d, i) => (
          <span key={i} className="eb-campo"><b>{d.campo || "—"}</b> {d.valor}</span>
        ))}
        <span className="eb-piezas" aria-label={`Obra: ${ETAPAS_OBRA[etapa]}`}>
          {[1, 2, 3, 4].map((k) => <span key={k} className={k <= etapa ? "eb-lleno" : ""} />)}
          {etapa < 4 && faltan.length > 0 && <em>falta {faltan.slice(0, 2).join(", ")}</em>}
        </span>
      </button>

      {n.tipo === "producto" && (
        <div className="eb-acciones">
          {it.fase === "sourcing" ? (
            <button type="button" className="eb-btn" disabled={ocupado === n.id}
                    onClick={() => void jugada(n.id, "comprar", { nodo: n.id })}>Comprar insumos</button>
          ) : (
            <>
              <input type="number" min={1} value={cant} onChange={(e) => setCant(Math.max(1, Number(e.target.value) || 1))}
                     className="eb-inp" aria-label="Unidades" />
              <button type="button" className="eb-btn" disabled={ocupado === n.id} title="Ensamblar y venderle las unidades a la empresa (venta interna)"
                      onClick={() => void jugada(n.id, "craftear", { nodo: n.id, cantidad: cant })}>Craftear</button>
              {it.fase === "en_mckenna" && (
                <button type="button" className="eb-btn" disabled={ocupado === n.id}
                        onClick={() => void jugada(n.id, "publicar", { nodo: n.id })}>Publicar</button>
              )}
              {it.fase === "publicado" && (
                <button type="button" className="eb-btn eb-vender" disabled={ocupado === n.id || it.unidades < 1}
                        onClick={() => void jugada(n.id, "vender", { nodo: n.id, cantidad: Math.min(cant, it.unidades) })}>
                  ¡Venta!
                </button>
              )}
            </>
          )}
        </div>
      )}
      {n.tipo === "consenso" && n.resuelto && (
        <div className="eb-acciones">
          <span className="eb-sub">¿Cómo resultó?</span>
          {(["bien", "mal"] as const).map((v) => {
            const activo = op.resultados[n.id] === v;
            return (
              <button key={v} type="button" aria-pressed={activo} disabled={ocupado === n.id}
                      className={`eb-btn eb-btn-mini ${activo ? (v === "bien" ? "eb-bien" : "eb-mal") : "eb-btn-claro"}`}
                      onClick={() => void jugada(n.id, "resultado", { nodo: n.id, valor: activo ? null : v })}>
                {v === "bien" ? "Bien +1" : "Mal −1"}
              </button>
            );
          })}
          <span className="eb-sub" title="Quien decidió">
            {(() => {
              const r = n.resuelto!;
              const uid = r.modo === "acuerdo" ? n.propuestas?.find((p) => p.id === r.propuesta)?.autor : r.por;
              return uid != null ? `decidió ${participantes[String(uid)]?.split(" ")[0] ?? "#" + uid}` : "";
            })()}
          </span>
        </div>
      )}
      {n.tipo === "producto" && <Riesgo n={n} nodos={nodos} />}
    </div>
  );
}

/** Riesgo de abastecimiento de un producto: la fiabilidad más baja y la entrega más lenta de sus proveedores. */
function Riesgo({ n, nodos }: { n: NodoDoc; nodos: NodoDoc[] }) {
  const provs = [...new Set((n.componentes ?? []).map((c) => c.proveedor).filter(Boolean) as string[])]
    .map((id) => nodos.find((x) => x.id === id)).filter((v): v is NodoDoc => Boolean(v));
  if (!provs.length) return null;
  const fia = Math.min(...provs.map((v) => v.fiabilidad ?? 3));
  const dias = Math.max(...provs.map((v) => v.entrega_dias ?? 0));
  const nivel = fia <= 2 ? "alto" : fia === 3 ? "medio" : "bajo";
  return <p className={`eb-riesgo eb-riesgo-${nivel}`}>Riesgo {nivel} · insumos en {dias} d</p>;
}

function AvatarCarta({ a, dharma, ganado }: { a: Avatar; dharma: number | null; ganado: Record<string, number> }) {
  return (
    <div className="eb-avatar" style={{ "--color": a.color } as Var}>
      <p><b>{a.nombre}</b> · {a.rol}</p>
      <p className="eb-skills">{a.skills.map((s) => <span key={s}>{s}</span>)}</p>
      <p className="eb-sub">
        {dharma != null && <span title="Dharma: decisiones calificadas">☯ {dharma > 0 ? `+${dharma}` : dharma} · </span>}
        {Object.entries(ganado).map(([m, v]) => <span key={m}>ganado {plata({ monto: v, moneda: m })} </span>)}
        {!Object.keys(ganado).length && "sin ventas todavía"}
      </p>
    </div>
  );
}

/** La lluvia de monedas de una venta: una columna por partida y la de la bóveda. */
function Lluvia({ r, avatares }: { r: RepartoVenta; avatares: Avatar[] }) {
  const cols = [
    ...(r.partes ?? []).filter((p) => p.monto).map((p) => ({
      t: `${p.nombre} → ${p.para === "boveda" ? r.boveda_nombre ?? "bóveda" : avatares.find((a) => a.id === p.para)?.nombre.split(" ")[0] ?? p.para}`,
      v: p.monto, c: avatares.find((a) => a.id === p.para)?.color ?? "#FFA300" })),
    { t: r.boveda_nombre ?? "Bóveda", v: r.boveda ?? r.mckenna ?? 0, c: (r.boveda ?? 0) >= 0 ? "#00E436" : "#FF004D" },
  ];
  return (
    <div className="eb-lluvia" aria-live="polite">
      <p className="eb-lluvia-t">¡Venta! {plata({ monto: r.total, moneda: r.moneda })}</p>
      <div className="eb-montones">
        {cols.map((m, i) => (
          <div key={i} className="eb-monton" style={{ "--c": m.c } as Var}>
            {Array.from({ length: 5 }, (_, k) => (
              <span key={k} className="eb-moneda" style={{ "--k": String(k), "--i": String(i) } as Var}><Sprite s="moneda" px={3} /></span>
            ))}
            <b>{plata({ monto: m.v, moneda: r.moneda })}</b>
            <span>{m.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Construir: pisos y habitaciones ─────────────────────────────────────────

function ConstruirHoja({ pisos: inicial, porHab, onCerrar, onGuardar }: {
  pisos: Piso[]; porHab: Map<string, NodoDoc[]>; onCerrar: () => void; onGuardar: (p: Piso[]) => Promise<void>;
}) {
  const [pisos, setPisos] = useState<Piso[]>(inicial);
  const [guardando, setGuardando] = useState(false);
  const setPiso = (i: number, c: Partial<Piso>) => setPisos((ps) => ps.map((p, j) => (j === i ? { ...p, ...c } : p)));
  const cajasDe = (p: Piso) => p.habitaciones.reduce((s, h) => s + (porHab.get(h.id)?.length ?? 0), 0);
  const mover = (i: number, d: number) => setPisos((ps) => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const c = [...ps]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCerrar} aria-hidden="true" />
      <div className="eb-hoja fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[82dvh] w-full max-w-lg space-y-2 overflow-y-auto p-3 sm:bottom-3"
           role="dialog" aria-label="Construir el edificio">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black uppercase">🏗 Construir: pisos y habitaciones</p>
          <button type="button" onClick={onCerrar} className="px-1 text-lg" aria-label="Cerrar">×</button>
        </div>
        <p className="text-[11px]">De arriba abajo, como se ve el edificio. Un piso o una habitación con cajas no se puede quitar: primero se mueven sus cajas.</p>
        <button type="button" className="eb-btn eb-btn-claro"
                onClick={() => setPisos((ps) => [...ps, { id: nuevoId("p"), nombre: "Piso nuevo", color: COLORES_PISO[ps.length % COLORES_PISO.length],
                                                          habitaciones: [{ id: nuevoId("h"), nombre: "Espacio" }] }])}>
          ＋ Piso arriba
        </button>
        {[...pisos].map((p, i) => ({ p, i })).reverse().map(({ p, i }) => {
          const n = cajasDe(p);
          return (
            <div key={p.id} className="space-y-1 border-2 border-black bg-white p-2">
              <div className="flex items-center gap-1">
                <span className="eb-num" style={{ background: p.color, color: TINTA_PISO[p.color] ?? "#FFF1E8" }}>{i === 0 ? "PB" : `P${i}`}</span>
                <input className="eb-inp min-w-0 flex-1" value={p.nombre} onChange={(e) => setPiso(i, { nombre: e.target.value })} aria-label="Nombre del piso" />
                <button type="button" className="px-1" onClick={() => mover(i, 1)} aria-label="Subir piso" disabled={i === pisos.length - 1}>▲</button>
                <button type="button" className="px-1" onClick={() => mover(i, -1)} aria-label="Bajar piso" disabled={i === 0}>▼</button>
                <button type="button" className="px-1 text-red-600 disabled:opacity-30" disabled={n > 0 || pisos.length === 1}
                        title={n ? `Tiene ${n} caja(s)` : "Quitar piso"} aria-label="Quitar piso"
                        onClick={() => setPisos((ps) => ps.filter((_, j) => j !== i))}>×</button>
              </div>
              <span className="flex flex-wrap gap-0.5">
                {COLORES_PISO.map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={p.color === c} onClick={() => setPiso(i, { color: c })}
                          className="h-5 w-5 border-2" style={{ background: c, borderColor: p.color === c ? "#000" : "#fff" }} />
                ))}
              </span>
              {p.habitaciones.map((h, k) => {
                const nh = porHab.get(h.id)?.length ?? 0;
                return (
                  <div key={h.id} className="flex items-center gap-1 pl-4">
                    <span className="text-xs">└</span>
                    <input className="eb-inp min-w-0 flex-1" value={h.nombre} aria-label="Nombre de la habitación"
                           onChange={(e) => setPiso(i, { habitaciones: p.habitaciones.map((x, j) => (j === k ? { ...x, nombre: e.target.value } : x)) })} />
                    <span className="text-[11px] text-[#5F574F]">{nh} caja{nh === 1 ? "" : "s"}</span>
                    <button type="button" className="px-1 text-red-600 disabled:opacity-30" disabled={nh > 0 || p.habitaciones.length === 1}
                            aria-label="Quitar habitación"
                            onClick={() => setPiso(i, { habitaciones: p.habitaciones.filter((_, j) => j !== k) })}>×</button>
                  </div>
                );
              })}
              {p.habitaciones.length < 8 && (
                <button type="button" className="pl-4 text-xs font-bold text-[#1d4ed8]"
                        onClick={() => setPiso(i, { habitaciones: [...p.habitaciones, { id: nuevoId("h"), nombre: "Habitación nueva" }] })}>
                  ＋ habitación
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="eb-btn w-full" disabled={guardando}
                onClick={async () => { setGuardando(true); try { await onGuardar(pisos); } finally { setGuardando(false); } }}>
          {guardando ? "Construyendo…" : "Guardar el edificio"}
        </button>
      </div>
    </>
  );
}

// ─── Reglas: el ente, las partidas del reparto y los avatares ───────────────

function ReglasHoja({ op, participantes, onCerrar, onGuardar }: {
  op: Operacion; participantes: Record<string, string>;
  onCerrar: () => void; onGuardar: (datos: Record<string, unknown>) => Promise<void>;
}) {
  const [ente, setEnte] = useState(op.ente);
  const [reglas, setReglas] = useState<Regla[]>(op.reparto.reglas);
  const [boveda, setBoveda] = useState(op.reparto.boveda);
  const [avatares, setAvatares] = useState<Avatar[]>(op.avatares);
  const [guardando, setGuardando] = useState(false);
  const setAv = (i: number, c: Partial<Avatar>) => setAvatares((as) => as.map((a, j) => (j === i ? { ...a, ...c } : a)));
  const setRg = (i: number, c: Partial<Regla>) => setReglas((rs) => rs.map((r, j) => (j === i ? { ...r, ...c } : r)));
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onCerrar} aria-hidden="true" />
      <div className="eb-hoja fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[82dvh] w-full max-w-lg space-y-3 overflow-y-auto p-3 sm:bottom-3"
           role="dialog" aria-label="Reglas del juego">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black uppercase">⚙ Reglas del juego</p>
          <button type="button" onClick={onCerrar} className="px-1 text-lg" aria-label="Cerrar">×</button>
        </div>

        <fieldset className="space-y-1">
          <legend className="text-xs font-bold uppercase">El ente</legend>
          <input className="eb-inp w-full" value={ente.nombre} onChange={(e) => setEnte({ ...ente, nombre: e.target.value })} aria-label="Nombre del ente" />
          {ente.campos.map((c, i) => (
            <div key={i} className="flex gap-1">
              <input className="eb-inp w-2/5" placeholder="nombre (lo eliges tú)" value={c.nombre}
                     onChange={(e) => setEnte({ ...ente, campos: ente.campos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })} />
              <input className="eb-inp min-w-0 flex-1" placeholder="valor" value={c.valor}
                     onChange={(e) => setEnte({ ...ente, campos: ente.campos.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
              <button type="button" className="px-1 text-red-600" aria-label="Quitar campo"
                      onClick={() => setEnte({ ...ente, campos: ente.campos.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          {ente.campos.length < 10 && (
            <button type="button" className="text-xs font-bold text-[#1d4ed8]"
                    onClick={() => setEnte({ ...ente, campos: [...ente.campos, { nombre: "", valor: "" }] })}>＋ campo</button>
          )}
        </fieldset>

        <fieldset className="space-y-1">
          <legend className="text-xs font-bold uppercase">Reparto de cada venta</legend>
          <p className="text-[11px]">Cada partida toma un % del costo de la receta o de la venta y lo lleva a alguien. Lo que sobra va a:</p>
          <input className="eb-inp w-full" value={boveda} onChange={(e) => setBoveda(e.target.value)} aria-label="Nombre de la bóveda" />
          {reglas.map((r, i) => (
            <div key={r.id} className="flex flex-wrap items-center gap-1 border border-black bg-white p-1">
              <input className="eb-inp min-w-0 flex-1" placeholder="nombre de la partida" value={r.nombre} onChange={(e) => setRg(i, { nombre: e.target.value })} />
              <input className="eb-inp w-16" inputMode="numeric" value={r.pct} aria-label="Porcentaje"
                     onChange={(e) => setRg(i, { pct: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} />
              <span className="text-xs">% de</span>
              <select className="eb-inp" value={r.base} onChange={(e) => setRg(i, { base: e.target.value as Regla["base"] })} aria-label="Base">
                <option value="costo">el costo</option><option value="venta">la venta</option>
              </select>
              <span className="text-xs">para</span>
              <select className="eb-inp" value={r.para} onChange={(e) => setRg(i, { para: e.target.value })} aria-label="Para quién">
                {avatares.map((a) => <option key={a.id} value={a.id}>{a.nombre.split(" ")[0]}</option>)}
                <option value="boveda">{boveda || "la bóveda"}</option>
              </select>
              <button type="button" className="px-1 text-red-600" aria-label="Quitar partida" onClick={() => setReglas((rs) => rs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {reglas.length < 10 && (
            <button type="button" className="text-xs font-bold text-[#1d4ed8]"
                    onClick={() => setReglas((rs) => [...rs, { id: nuevoId("r"), nombre: "", base: "venta", pct: 0, para: avatares[0]?.id ?? "boveda" }])}>
              ＋ partida
            </button>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase">Avatares (jugadores)</legend>
          {avatares.map((a, i) => (
            <div key={a.id} className="space-y-1 border-2 border-black bg-white p-2">
              <div className="flex gap-1">
                <input className="eb-inp min-w-0 flex-1" placeholder="Nombre" value={a.nombre} onChange={(e) => setAv(i, { nombre: e.target.value })} />
                <button type="button" className="px-1 text-red-600" aria-label="Quitar avatar" onClick={() => setAvatares((as) => as.filter((_, j) => j !== i))}>×</button>
              </div>
              <input className="eb-inp w-full" placeholder="Rol" value={a.rol} onChange={(e) => setAv(i, { rol: e.target.value })} />
              <input className="eb-inp w-full" placeholder="Habilidades, separadas por coma" value={a.skills.join(", ")}
                     onChange={(e) => setAv(i, { skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              <div className="flex flex-wrap gap-1">
                <select className="eb-inp" value={a.piso} onChange={(e) => setAv(i, { piso: e.target.value })} aria-label="Piso donde trabaja">
                  {[...op.edificio.pisos].reverse().map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <select className="eb-inp" value={a.usuario_id ?? ""} onChange={(e) => setAv(i, { usuario_id: e.target.value ? Number(e.target.value) : null })} aria-label="Cuenta que juega">
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
            <button type="button" className="eb-btn eb-btn-claro"
                    onClick={() => setAvatares((as) => [...as, { id: nuevoId("a"), nombre: "Nuevo colaborador", rol: "", skills: [],
                      piso: op.edificio.pisos[0]?.id ?? "", color: COLORES_AVATAR[as.length % COLORES_AVATAR.length], carril: null, usuario_id: null }])}>
              ＋ Avatar
            </button>
          )}
          <p className="text-[11px]">Votan en las decisiones las dos cuentas del proyecto. Un avatar «sin cuenta» juega en el edificio pero no vota.</p>
        </fieldset>

        <button type="button" className="eb-btn w-full" disabled={guardando}
                onClick={async () => {
                  setGuardando(true);
                  try { await onGuardar({ ente, avatares, reparto: { reglas: reglas.filter((r) => r.nombre.trim()), boveda } }); }
                  finally { setGuardando(false); }
                }}>
          {guardando ? "Guardando…" : "Guardar reglas"}
        </button>
      </div>
    </>
  );
}
