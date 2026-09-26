/**
 * La vista «Edificio» de un proyecto de Colaboradores (26-sep-2026): el proyecto es un edificio en
 * obra y cada caja un piso, en el orden de las flechas (el primer paso es la planta baja). Cada piso
 * se dibuja según su etapa (colaboradores/obra.ts): terreno con el letrero de «se construye»,
 * cimientos con andamio, estructura de vigas, fachada con las luces apagadas y, terminado, con las
 * luces encendidas y lo que el paso es (el escritorio de una acción, las cajas de un entregable, la
 * vitrina con la foto de un producto, la mesa de votación de un consenso…). El obrero de cada piso
 * es la persona de su carril. Arriba trabaja la grúa; con todos los pisos terminados, fiesta.
 *
 * Tocar un piso abre la misma hoja de edición del tablero: llenar el paso ES construir el piso.
 * Al subir de etapa suena un martillazo; al terminar un piso, una moneda; al terminar la obra, la
 * fanfarria (lib/sonidosJuego, respeta el silencio). Con prefers-reduced-motion todo queda quieto.
 */
import "./obra.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { tocarSonido } from "../../lib/sonidosJuego";
import { Sprite, type SpriteId } from "./pixel";
import { ETAPAS_OBRA, etapaObra, ordenPisos, piezasObra } from "./obra";

export type NodoPiso = Parameters<typeof etapaObra>[0] & { label: string; carril: string };

const OBRERO = ["..yyyy..", ".yyyyyy.", "..kcck..", "..kcck..", "...kk...", ".kXXXXk.", "kXkXXkXk", "..kXXk..", "..k..k.."];
const CAJA = ["kkkkkkkk", "knnnonnk", "knnnonnk", "kkkkkkkk", "knnnnnnk", "knnnnnnk", "kkkkkkkk"];
const CONO = ["...kk...", "..kook..", "..kwwk..", ".kooook.", ".kwwwwk.", "kooooook", "kkkkkkkk"];
const LETRERO = ["kkkkkkkkkk", "knnnnnnnnk", "knyyyyyynk", "knnnnnnnnk", "kkkkkkkkkk", "....kk....", "....kk....", "....kk...."];

/** Lo que hay en un piso terminado, según lo que el paso ES. */
const MUEBLE: Record<string, SpriteId[]> = {
  accion: ["ventana", "reloj"], decision: ["estrella", "doc"], entregable: ["cofre", "trofeo"],
  dinero: ["moneda", "bolsa"], externo: ["bandera", "foto"], consenso: ["urna", "pulgar"],
  producto: ["gema", "bolsa"], competencia: ["bandera", "alerta"],
};

type Var = CSSProperties & Record<`--${string}`, string>;

export default function EdificioProyecto({
  nodos, flechas, selId, onTocar, nombreCarril, colorCarril, nombreTipo, foto,
}: {
  nodos: NodoPiso[];
  flechas: { from: string; to: string }[];
  selId?: string | null;
  onTocar: (id: string) => void;
  nombreCarril: (c: string) => string;
  colorCarril: (c: string) => string;
  nombreTipo: (t: string) => string;
  /** La foto de un producto terminado, en su vitrina (se carga con la sesión). */
  foto?: (mid: string) => ReactNode;
}) {
  const pisos = useMemo(() => ordenPisos(nodos, flechas).map((n, i) => ({ n, i, etapa: etapaObra(n), piezas: piezasObra(n) })),
    [nodos, flechas]);
  const terminados = pisos.filter((p) => p.etapa === 4).length;
  const obraLista = pisos.length > 0 && terminados === pisos.length;
  const avance = pisos.length ? Math.round((pisos.reduce((s, p) => s + p.etapa, 0) / (4 * pisos.length)) * 100) : 0;
  const siguiente = pisos.find((p) => p.etapa < 4);
  const carriles = [...new Set(nodos.map((n) => n.carril))];

  // Sonido y destello cuando un piso SUBE de etapa mientras se mira (no al abrir la vista).
  const antes = useRef<Map<string, number> | null>(null);
  const [subio, setSubio] = useState<string | null>(null);
  useEffect(() => {
    const ahora = new Map(pisos.map((p) => [p.n.id, p.etapa]));
    const previo = antes.current;
    antes.current = ahora;
    if (!previo) return;
    const arriba = pisos.find((p) => p.etapa > (previo.get(p.n.id) ?? p.etapa));
    if (!arriba) return;
    const eraLista = [...previo.values()].length === pisos.length && [...previo.values()].every((e) => e === 4);
    tocarSonido(obraLista && !eraLista ? "dirigir" : arriba.etapa === 4 ? "vender" : "preparar");
    setSubio(arriba.n.id);
    const t = window.setTimeout(() => setSubio(null), 1200);
    return () => window.clearTimeout(t);
  }, [pisos, obraLista]);

  return (
    <div className="ob-obra">
      <div className="ob-cielo">
        <div className="ob-marcador">
          <span className="ob-marcador-t">Obra</span>
          <span className="ob-barra" aria-label={`${avance} % construido`}>
            <span style={{ width: `${avance}%` }} />
          </span>
          <b>{avance} %</b>
          <span>· {terminados} de {pisos.length} pisos terminados</span>
          {siguiente && <span className="ob-sig">· la grúa trabaja en {siguiente.i === 0 ? "la planta baja" : `el piso ${siguiente.i}`}: falta {siguiente.piezas.faltan.slice(0, 3).join(", ")}</span>}
        </div>

        <div className="ob-torre">
          {/* El techo: grúa trabajando o, con la obra terminada, la fiesta. */}
          <div className={`ob-techo ${obraLista ? "ob-techo-listo" : ""}`} aria-hidden="true">
            {obraLista ? (
              <>
                <Sprite s="bandera" px={4} className="ob-bandera" />
                <span className="ob-fiesta">¡Obra terminada!</span>
                <Sprite s="trofeo" px={4} />
                {[0, 1, 2, 3, 4, 5].map((k) => <span key={k} className="ob-confeti" style={{ "--k": String(k) } as Var} />)}
              </>
            ) : pisos.length > 0 ? (
              <div className="ob-grua">
                <span className="ob-grua-mastil" />
                <span className="ob-grua-pluma" />
                <span className="ob-grua-cable"><span className="ob-grua-viga" /></span>
              </div>
            ) : null}
          </div>

          {pisos.length === 0 && (
            <div className="ob-lote">
              <Sprite s={LETRERO} px={4} />
              <p>Terreno listo. Agrega la primera caja en el tablero y empieza la obra.</p>
            </div>
          )}

          {[...pisos].reverse().map((p) => {
            const color = colorCarril(p.n.carril);
            const mueble = MUEBLE[p.n.tipo] ?? MUEBLE.accion;
            const img = p.n.tipo === "producto" && p.etapa === 4 && p.n.imagen ? foto?.(p.n.imagen) : null;
            return (
              <button key={p.n.id} type="button" data-etapa-obra={p.etapa}
                      className={`ob-piso ob-e${p.etapa} ${selId === p.n.id ? "ob-sel" : ""} ${subio === p.n.id ? "ob-subio" : ""}`}
                      style={{ "--carril": color } as Var}
                      onClick={() => onTocar(p.n.id)}
                      title={p.piezas.faltan.length ? `Para construirlo falta: ${p.piezas.faltan.join(", ")}` : "Piso terminado"}>
                <span className="ob-num">{p.i === 0 ? "PB" : `P${p.i}`}</span>
                <span className="ob-sala" aria-hidden="true">
                  <span className="ob-capa" />
                  {p.etapa === 0 && <span className="ob-cosa" style={{ left: "46%" }}><Sprite s={LETRERO} px={3} /></span>}
                  {p.etapa >= 1 && p.etapa <= 2 && (<>
                    <span className="ob-cosa" style={{ left: "8%" }}><Sprite s={CONO} px={2} /></span>
                    <span className="ob-cosa" style={{ left: "70%" }}><Sprite s={CAJA} px={2} /></span>
                  </>)}
                  {p.etapa === 4 && (<>
                    <span className="ob-cosa" style={{ left: "10%" }}><Sprite s={mueble[0]} px={3} /></span>
                    <span className="ob-cosa" style={{ left: "70%" }}><Sprite s={mueble[1]} px={3} /></span>
                    {img && <span className="ob-vitrina">{img}</span>}
                  </>)}
                  {/* El obrero (la persona del carril): martilla mientras se construye, descansa al terminar. */}
                  {p.etapa > 0 && (
                    <span className={`ob-obrero ${p.etapa < 4 ? "ob-martilla" : ""}`}>
                      <Sprite s={p.etapa < 4 ? OBRERO : "jugador"} px={3} colores={{ X: color }} />
                      {p.etapa < 4 && <span className="ob-polvo" />}
                    </span>
                  )}
                </span>
                <span className="ob-ficha">
                  <span className="ob-titulo">{p.n.label || "(sin título)"}</span>
                  <span className="ob-quien"><Sprite s="jugador" px={2} colores={{ X: color }} /> {nombreCarril(p.n.carril)} · {nombreTipo(p.n.tipo)}</span>
                  <span className="ob-etapa">
                    <span className="ob-bloques" aria-hidden="true">
                      {[1, 2, 3, 4].map((k) => <span key={k} className={k <= p.etapa ? "ob-lleno" : ""} />)}
                    </span>
                    {ETAPAS_OBRA[p.etapa]}
                  </span>
                  {p.piezas.faltan.length > 0 && p.etapa < 4 && <span className="ob-falta">Falta: {p.piezas.faltan.slice(0, 4).join(" · ")}</span>}
                </span>
              </button>
            );
          })}
          <div className="ob-suelo" aria-hidden="true">
            {carriles.slice(0, 4).map((c, k) => (
              <span key={c} className="ob-paseo" style={{ "--dur": `${10 + k * 3}s`, "--retraso": `${-k * 2.5}s` } as Var}>
                <Sprite s="jugador" px={3} colores={{ X: colorCarril(c) }} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
