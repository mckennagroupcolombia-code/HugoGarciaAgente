/**
 * Guía animada del mapa de Colaboradores (3-oct-2026): ocho escenas cortas que muestran, con un mapa
 * en miniatura, cómo se usa — el árbol por linaje, brotar una rama, a quién le toca, decidir juntos,
 * traer del chat, pegar capturas, mover/plegar y resaltar con el ritmo.
 *
 * Cada escena es una función del tiempo `t` (segundos dentro de su bucle): según `t` se prende o se
 * mueve cada pieza y las transiciones CSS (guia-mapa.css) hacen el resto. Así cada escena se repite
 * sola, sin coreografías de keyframes. Con «reducir movimiento» del sistema se muestra el estado final
 * quieto. Coordenadas en % del escenario (16:9) y letra en `cqw`: se ve igual en el celular y en el PC.
 * Se abre sola la primera vez (localStorage `colab-guia-mapa-vista`) y con el botón «Guía» del mapa.
 */
import "./guia-mapa.css";
import { useEffect, useState, type ReactNode } from "react";
import { COLOR_TIPO, NOMBRE_TIPO, SPRITE_TIPO, type TipoT } from "./mapaTipos";
import { Sprite } from "./pixel";

const W = 21;        // ancho de un nodo (% del escenario)
const H = 22;        // alto de un nodo (% del escenario)

// ─── Piezas del escenario ────────────────────────────────────────────────────

function Nodo({ x, y, tipo, titulo, chip, fuerte, foto, marca, apagado, visible = true, cerrado, pie = "＋ rama", raiz }: {
  x: number; y: number; tipo?: TipoT; titulo: string; chip?: string; fuerte?: boolean; foto?: boolean; marca?: boolean;
  apagado?: boolean; visible?: boolean; cerrado?: boolean; pie?: string; raiz?: boolean;
}) {
  const [fondo, letra] = raiz ? ["#1D2B53", "#fff"] : COLOR_TIPO[tipo ?? "idea"];
  return (
    <div className={`gm-nodo ${visible ? "gm-si" : "gm-no"} ${apagado ? "gm-apagado" : ""} ${marca ? "gm-marca" : ""}`}
         style={{ left: `${x}%`, top: `${y}%`, width: `${W}%`, minHeight: `${H}%`, background: raiz ? "#1D2B53" : undefined }}>
      <div className="gm-cab" style={{ background: fondo, color: letra }}>
        {!raiz && tipo && <Sprite s={SPRITE_TIPO[tipo]} px={1} />}
        <span>{raiz ? "Proyecto" : NOMBRE_TIPO[tipo ?? "idea"]}{cerrado ? " ✓" : ""}</span>
      </div>
      <div className="gm-cuerpo" style={raiz ? { color: "#fff" } : undefined}>
        {foto && <span className="gm-foto" aria-hidden="true" />}
        <b>{titulo}</b>
      </div>
      {chip && <span className={`gm-chip ${fuerte ? "gm-chip-fuerte" : ""}`}>{chip}</span>}
      <span className="gm-pie" style={raiz ? { color: "#fff", borderColor: "rgb(255 255 255 / .4)" } : undefined}>{pie}</span>
    </div>
  );
}

/** El codo de rama entre un padre (x1,y1) y su hija (x2,y2): horizontal, vertical, horizontal. */
function Rama({ x1, y1, x2, y2, visible = true }: { x1: number; y1: number; x2: number; y2: number; visible?: boolean }) {
  const a = x1 + W, ya = y1 + H / 2, yb = y2 + H / 2, xm = (a + x2) / 2;
  const cls = `gm-linea ${visible ? "gm-si" : "gm-no"}`;
  return (
    <>
      <div className={cls} style={{ left: `${a}%`, top: `${ya}%`, width: `${xm - a}%`, height: "0.6cqw" }} />
      <div className={cls} style={{ left: `${xm}%`, top: `${Math.min(ya, yb)}%`, width: "0.6cqw", height: `calc(${Math.abs(yb - ya)}% + 0.6cqw)` }} />
      <div className={cls} style={{ left: `${xm}%`, top: `${yb}%`, width: `${x2 - xm}%`, height: "0.6cqw" }} />
    </>
  );
}

/** El dedo que toca: se desliza a (x,y) y, con `tap`, hace la onda del toque. */
function Dedo({ x, y, tap, visible = true }: { x: number; y: number; tap?: boolean; visible?: boolean }) {
  return (
    <div className={`gm-dedo ${visible ? "gm-si" : "gm-no"}`} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
      {tap && <span className="gm-onda" />}
      <span className="gm-mano">👆</span>
    </div>
  );
}

function Hoja({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <div className={`gm-hoja ${visible ? "gm-hoja-arriba" : ""}`}>{children}</div>;
}

const entre = (t: number, a: number, b: number) => t >= a && t < b;
const escribe = (texto: string, t: number, desde: number, porSeg = 14) => texto.slice(0, Math.max(0, Math.floor((t - desde) * porSeg)));

// ─── Las escenas ─────────────────────────────────────────────────────────────

type Escena = { titulo: string; texto: string; dur: number; dibujo: (t: number) => ReactNode };

const ESCENAS: Escena[] = [
  {
    titulo: "Un solo mapa que crece como un árbol",
    texto: "A la izquierda está la raíz: el proyecto. Cada tarjeta cuelga de la que la originó, así que de izquierda a derecha se lee cómo fue evolucionando: de dónde partimos, qué salió, qué nos frenó y qué decidimos.",
    dur: 7,
    dibujo: (t) => (
      <>
        <Nodo raiz x={2} y={39} titulo="Collar persa" />
        <Rama x1={2} y1={39} x2={27} y2={39} visible={t > 0.6} />
        <Nodo x={27} y={39} tipo="origen" titulo="Collares de Armando" visible={t > 0.6} />
        <Rama x1={27} y1={39} x2={52} y2={16} visible={t > 1.6} />
        <Nodo x={52} y={16} tipo="resultado" titulo="Persa aprobado" visible={t > 1.6} />
        <Rama x1={27} y1={39} x2={52} y2={62} visible={t > 2.3} />
        <Nodo x={52} y={62} tipo="obstaculo" titulo="Aros grandes" cerrado visible={t > 2.3} />
        <Rama x1={52} y1={16} x2={77} y2={2} visible={t > 3.2} />
        <Nodo x={77} y={2} tipo="obstaculo" titulo="Broche débil" visible={t > 3.2} />
        <Rama x1={52} y1={16} x2={77} y2={32} visible={t > 4} />
        <Nodo x={77} y={32} tipo="resultado" titulo="Primera venta" foto visible={t > 4} />
      </>
    ),
  },
  {
    titulo: "Brotar una rama: «＋ rama»",
    texto: "Toca «＋ rama» en la tarjeta de donde sale lo nuevo. Elige qué es (resultado, obstáculo, decisión, tarea, idea…), escríbelo y ponlo en el mapa. Queda colgando de ahí.",
    dur: 8,
    dibujo: (t) => (
      <>
        <Nodo x={8} y={30} tipo="obstaculo" titulo="El broche se abre" chip="le toca a ti" fuerte />
        <Rama x1={8} y1={30} x2={48} y2={30} visible={t > 4.8} />
        <Nodo x={48} y={30} tipo="decision" titulo="Vender como decorativo" chip="le toca a Sebastián" fuerte visible={t > 4.8} />
        <Hoja visible={entre(t, 1.9, 4.6)}>
          <span className="gm-campo"><Sprite s="urna" px={1} /> Decisión ▾</span>
          <span className="gm-campo gm-campo-ancho">{escribe("Vender como decorativo", t, 2.3)}<span className="gm-cursor">|</span></span>
          <span className={`gm-boton ${entre(t, 4.1, 4.6) ? "gm-boton-tap" : ""}`}>Poner en el mapa</span>
        </Hoja>
        <Dedo x={t < 0.4 ? 70 : t < 3.4 ? 17 : 62} y={t < 0.4 ? 92 : t < 3.4 ? 49 : 89}
              tap={entre(t, 1.4, 1.9) || entre(t, 4.1, 4.6)} visible={t < 5.4} />
      </>
    ),
  },
  {
    titulo: "A quién le toca",
    texto: "Quien crea un obstáculo, una decisión o una tarea deja la jugada en la cancha del otro: la tarjeta dice «le toca a…» y desde hace cuánto. Cuando se resuelve, ya no le toca a nadie. Lo que te toca a ti va con borde.",
    dur: 7,
    dibujo: (t) => {
      const sebas = t < 3.4;
      return (
        <>
          <span className="gm-persona" style={{ left: "4%" }}><Sprite s="jugador" px={2} /> Armando</span>
          <span className="gm-persona" style={{ right: "4%" }}><Sprite s="jugador" px={2} /> Sebastián</span>
          <Nodo x={39.5} y={34} tipo="tarea" titulo="Enviar el collar vendido" marca={!sebas && t < 5.6}
                chip={t >= 5.6 ? "hecho" : sebas ? `le toca a Sebastián · ${t < 1.5 ? "1 h" : "2 h"}` : "le toca a ti · ahora"} fuerte={t < 5.6}
                cerrado={t >= 5.6} />
          <span className="gm-pelota" style={{ left: sebas ? "86%" : "11%" }} aria-hidden="true" />
          <span className={`gm-globo ${entre(t, 2.2, 3.6) ? "gm-si" : "gm-no"}`} style={{ right: "5%", top: "62%" }}>«Ya lo empaqué: falta la guía»</span>
          <span className={`gm-globo ${entre(t, 4.6, 6.2) ? "gm-si" : "gm-no"}`} style={{ left: "5%", top: "62%" }}>«Listo, guía enviada ✓»</span>
        </>
      );
    },
  },
  {
    titulo: "Decidir juntos: «Estoy de acuerdo»",
    texto: "Las metas, roles, decisiones y acuerdos llevan la marca de cada uno. Cuando los dos marcan «Estoy de acuerdo», la decisión queda tomada. Si alguien cambia el texto después, el acuerdo vuelve a cero.",
    dur: 7,
    dibujo: (t) => {
      const a = t > 1.6, s = t > 3.6;
      return (
        <>
          <Nodo x={39.5} y={14} tipo="decision" titulo="Talla L a $75.000" cerrado={s}
                chip={`${a ? "✓" : "○"} tú  ${s ? "✓" : "○"} Sebastián`} fuerte={s} />
          <span className={`gm-boton gm-boton-suelto ${entre(t, 1.2, 1.7) ? "gm-boton-tap" : ""}`} style={{ left: "37%", top: "56%" }}>
            {a ? "Ya no estoy de acuerdo" : "Estoy de acuerdo"}
          </span>
          <span className={`gm-sello ${s ? "gm-si" : "gm-no"}`} style={{ left: "63%", top: "10%" }}>¡Tomada!</span>
          <span className={`gm-globo ${entre(t, 2.6, 4.2) ? "gm-si" : "gm-no"}`} style={{ right: "4%", top: "62%" }}>Sebastián: ✓ de acuerdo</span>
          <Dedo x={48} y={t < 0.5 ? 92 : 61} tap={entre(t, 1.2, 1.7)} visible={t < 2.4} />
        </>
      );
    },
  },
  {
    titulo: "Traer lo que ya hablamos por WhatsApp",
    texto: "En WhatsApp: chat › ⋮ › Más › Exportar chat. En el mapa, «Traer del chat»: sube el archivo, marca los mensajes que importan y conviértelos en tarjetas con su cita. El chat no se guarda; solo lo que tú eliges.",
    dur: 8,
    dibujo: (t) => {
      const marcado = t > 1.5;
      return (
        <>
          <div className="gm-chat">
            <span className="gm-msj">Sebastián: Ya quedó la versión con argollas</span>
            <span className={`gm-msj gm-msj-mio ${marcado ? "gm-msj-marcado" : ""}`}>{marcado ? "☑" : "☐"} Tú: 10 de 10, así es que se hace</span>
            <span className="gm-msj">Sebastián: ¿Le mando las fotos?</span>
            <span className={`gm-boton ${entre(t, 2.6, 3.1) ? "gm-boton-tap" : ""}`}><Sprite s="estrella" px={1} /> Resultado</span>
          </div>
          <span className={`gm-vuela ${t > 3.2 ? "gm-vuela-fin" : ""} ${entre(t, 3.1, 4.3) ? "gm-si" : "gm-no"}`}>10 de 10…</span>
          <Rama x1={44} y1={10} x2={73} y2={40} visible={t > 4.2} />
          <Nodo x={44} y={10} tipo="resultado" titulo="Persa aprobado" />
          <Nodo x={73} y={40} tipo="resultado" titulo="Versión terminada: 10 de 10" chip="💬 cita del chat" visible={t > 4.2} />
          <Dedo x={t < 0.5 ? 30 : t < 2.2 ? 8 : 9} y={t < 0.5 ? 95 : t < 2.2 ? 38 : 73} tap={entre(t, 1.1, 1.6) || entre(t, 2.6, 3.1)} visible={t < 3.6} />
        </>
      );
    },
  },
  {
    titulo: "Pegar capturas y fotos",
    texto: "En la hoja de una tarjeta, pega una captura con Ctrl+V en el texto o usa «＋ Agregar» en Pruebas. La primera foto sale en la tarjeta del mapa: el resultado queda con su prueba.",
    dur: 6,
    dibujo: (t) => (
      <>
        <Nodo x={39.5} y={30} tipo="resultado" titulo="Primera venta" foto={t > 4} chip={t > 4 ? "📎 1" : undefined} />
        <Hoja visible={entre(t, 0.5, 3.6)}>
          <span className="gm-campo gm-campo-ancho">La compró una amiga para su perrita</span>
          <span className={`gm-teclas ${entre(t, 1.1, 2.2) ? "gm-si" : "gm-no"}`}><kbd>Ctrl</kbd> + <kbd>V</kbd></span>
          <span className="gm-campo">Pruebas: {t > 1.9 ? <span className="gm-foto gm-foto-chica" /> : "—"}</span>
        </Hoja>
      </>
    ),
  },
  {
    titulo: "Mover una rama y plegarla",
    texto: "Si algo quedó colgando del lugar equivocado, abre la tarjeta y cambia «Sale de»: se muda con todas sus ramas. Con ◂ pliegas lo que no necesitas ver; ▸ 2 te recuerda cuántas hay escondidas.",
    dur: 8,
    dibujo: (t) => {
      const mudada = t > 2.6, plegado = t > 5.6;
      return (
        <>
          <Nodo x={6} y={6} tipo="resultado" titulo="Primeros tejidos" pie={mudada ? "＋ rama" : "＋ rama   ◂"} />
          <Nodo x={6} y={62} tipo="resultado" titulo="Publicación activa" pie={plegado ? "＋ rama   ▸ 2" : "＋ rama   ◂"} />
          <Rama x1={6} y1={62} x2={56} y2={40} visible={!plegado} />
          <Nodo x={56} y={40} tipo="decision" titulo="Precio al público" visible={!plegado} />
          <Rama x1={6} y1={mudada ? 62 : 6} x2={56} y2={mudada ? 76 : 6} visible={!plegado} />
          <Nodo x={56} y={mudada ? 76 : 6} tipo="obstaculo" titulo="Fotos IA sin calibre" visible={!plegado} />
          <span className={`gm-globo ${entre(t, 1, 2.8) ? "gm-si" : "gm-no"}`} style={{ left: "31%", top: "36%" }}>Sale de: Publicación activa ▾</span>
          <Dedo x={t < 4.6 ? 70 : 25} y={t < 4.6 ? 95 : 82} tap={entre(t, 5.2, 5.7)} visible={t > 4.4 && t < 6.6} />
        </>
      );
    },
  },
  {
    titulo: "Resaltar lo tuyo y ver el ritmo",
    texto: "«Me toca» apaga todo lo demás y deja con borde lo que espera por ti. «Ritmo» muestra cuánto tarda cada uno en ver lo nuevo del otro y en responder — y lo que lleva rato esperando.",
    dur: 8,
    dibujo: (t) => {
      const filtro = t > 1.7, ritmo = t > 4.4;
      return (
        <>
          <div className="gm-barra">
            <span className={`gm-pildora ${ritmo ? "gm-pildora-on" : ""} ${entre(t, 3.9, 4.4) ? "gm-boton-tap" : ""}`}>Ritmo <b>te tocan 2</b></span>
            <span className={`gm-pildora ${filtro ? "gm-pildora-on" : ""} ${entre(t, 1.2, 1.7) ? "gm-boton-tap" : ""}`}>Me toca</span>
          </div>
          <Nodo raiz x={2} y={40} titulo="Collar persa" apagado={filtro} />
          <Rama x1={2} y1={40} x2={27} y2={20} />
          <Rama x1={2} y1={40} x2={27} y2={62} />
          <Nodo x={27} y={20} tipo="obstaculo" titulo="¿Cuánto tarda?" chip="le toca a Sebastián" fuerte apagado={filtro} />
          <Nodo x={27} y={62} tipo="decision" titulo="Talla L a $75.000" chip="le toca a ti" fuerte marca={filtro} />
          <Rama x1={27} y1={62} x2={52} y2={62} />
          <Nodo x={52} y={62} tipo="tarea" titulo="Comprar tu collar" chip="le toca a ti" fuerte marca={filtro} />
          <div className={`gm-ritmo ${ritmo ? "gm-si" : "gm-no"}`}>
            <span><b>Tú</b> ves lo nuevo en 1,6 h · respondes en 12 min</span>
            <span><b>Sebastián</b> ve lo nuevo en 8 min · responde en 4 min</span>
          </div>
          <Dedo x={t < 0.5 ? 60 : t < 3 ? 24 : 9} y={t < 0.5 ? 95 : 12} tap={entre(t, 1.2, 1.7) || entre(t, 3.9, 4.4)} visible={t < 5} />
        </>
      );
    },
  },
];

// ─── La guía ─────────────────────────────────────────────────────────────────

const CLAVE_VISTA = "colab-guia-mapa-vista";

export function guiaYaVista(): boolean {
  try { return localStorage.getItem(CLAVE_VISTA) === "1"; } catch { return true; }
}

function sinMovimiento(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export default function GuiaMapa({ onCerrar }: { onCerrar: () => void }) {
  const quieto = sinMovimiento();
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const [corre, setCorre] = useState(!quieto);
  const e = ESCENAS[i];

  useEffect(() => { setT(quieto ? e.dur : 0); }, [i, quieto, e.dur]);
  useEffect(() => {
    if (!corre) return;
    const id = window.setInterval(() => setT((x) => (x + 0.1 >= e.dur + 1 ? 0 : x + 0.1)), 100);   // 1 s quieto al final
    return () => window.clearInterval(id);
  }, [corre, e.dur]);
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight") setI((x) => Math.min(ESCENAS.length - 1, x + 1));
      else if (ev.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      else if (ev.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  function cerrar() {
    try { localStorage.setItem(CLAVE_VISTA, "1"); } catch { /* sin almacenamiento */ }
    onCerrar();
  }
  const ultima = i === ESCENAS.length - 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-label="Guía del mapa" data-guia>
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col gap-2 overflow-y-auto border-2 border-ink bg-surface-panel p-3 shadow-[6px_6px_0_rgb(var(--mck-ink))]"
           style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
        <div className="flex items-center gap-2">
          <Sprite s="bandera" px={2} />
          <p className="px-t flex-1 text-sm font-bold uppercase text-ink">Cómo se usa el mapa · {i + 1}/{ESCENAS.length}</p>
          <button type="button" onClick={cerrar} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar la guía">×</button>
        </div>

        <div className="gm-escenario" aria-hidden="true">{e.dibujo(Math.min(t, e.dur))}</div>

        <h3 className="font-bold text-ink" style={{ fontSize: 18 }}>{e.titulo}</h3>
        <p className="min-h-[5.5rem] text-ink-secondary" style={{ fontSize: 15, lineHeight: 1.45 }}>{e.texto}</p>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink disabled:opacity-40" aria-label="Anterior">‹</button>
          {!quieto && (
            <button type="button" onClick={() => setCorre((v) => !v)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-ink"
                    aria-label={corre ? "Pausar" : "Reproducir"}>{corre ? "❚❚" : "▶"}</button>
          )}
          <div className="flex flex-1 justify-center gap-1.5">
            {ESCENAS.map((x, k) => (
              <button key={k} type="button" onClick={() => setI(k)} aria-label={`Ir a: ${x.titulo}`}
                      className={`h-2.5 w-2.5 border border-ink ${k === i ? "bg-accent" : "bg-surface"}`} />
            ))}
          </div>
          {ultima ? (
            <button type="button" onClick={cerrar} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white">¡A usarlo!</button>
          ) : (
            <button type="button" onClick={() => setI((x) => x + 1)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white" aria-label="Siguiente">Siguiente ›</button>
          )}
        </div>
      </div>
    </div>
  );
}
