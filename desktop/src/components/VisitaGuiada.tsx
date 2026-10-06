/**
 * Visita guiada del Libro Mayor: ilumina cada parte de la sección y explica para
 * qué sirve, en orden de reunión con el contador (primero la revisión, luego dónde
 * está cada cosa). Cada paso apunta a un elemento con `data-guia="…"`; si pide otra
 * vista (`sub`), la abre antes de iluminar. Si el elemento no está (p. ej. en el
 * celular, donde el riel se pliega), la tarjeta sale centrada y la visita sigue.
 *
 * Teclado: ← → para moverse, Esc para salir.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export type PasoVisita = { guia: string; sub?: string; titulo: string; texto: string };

export const PASOS_LIBRO_MAYOR: PasoVisita[] = [
  { guia: "ex-periodos", sub: "expediente", titulo: "El expediente, mes a mes",
    texto: "El libro se recorre por meses, como lo revisa un contador. Los meses en gris son anteriores al corte: los declaró el contador y aquí solo se muestran sus fuentes. Desde septiembre de 2026 manda el libro propio." },
  { guia: "ex-estado", sub: "expediente", titulo: "El estado del mes",
    texto: "Lo que se comprueba primero: que el libro cuadre, que el banco coincida con el extracto, que las facturas estén en la DIAN y que las cuentas de impuestos digan lo mismo que las declaraciones. Cada bloque se despliega." },
  { guia: "ex-puc", sub: "expediente", titulo: "Las cuentas como fichas",
    texto: "El plan de cuentas es la columna vertebral. Cada cuenta trae su saldo y sus insignias de verificación; al tocarla se abre su auxiliar y, dentro, cada asiento con su comprobante y sus documentos. «Por revisar» muestra solo las que tienen algo pendiente." },
  { guia: "rv-veredicto", sub: "revision", titulo: "Revisión del libro",
    texto: "Esta pantalla contesta la primera pregunta del contador: qué tenemos y qué nos falta para revisar el libro. El recuadro resume en una frase cómo está hoy." },
  { guia: "rv-tenemos", sub: "revision", titulo: "Lo que tenemos",
    texto: "Lo que ya está completo y cuadrado: el banco conciliado, los documentos de la DIAN, las declaraciones, los préstamos. Toca cualquier renglón para ver el detalle." },
  { guia: "rv-falta", sub: "revision", titulo: "Lo que nos falta",
    texto: "Documentos o datos que todavía no están, como los estados financieros 2025 o el saldo de Mercado Pago al 31 de agosto. Es la lista para pedirle al contador o conseguir." },
  { guia: "rv-ajustar", sub: "revision", titulo: "Para ajustar hoy",
    texto: "Lo que hoy está mal o incompleto, en orden de prioridad. Cada renglón dice qué es y tiene un botón que lleva a la vista donde se resuelve." },
  { guia: "rv-hablar", sub: "revision", titulo: "Para hablar con el contador",
    texto: "Las preguntas abiertas para la reunión, con sus cifras al día. Cuando él responda, el tema se cierra." },
  { guia: "riel", titulo: "Todas las vistas del libro",
    texto: "Desde este riel se abre cada parte del libro. Está ordenado en cuatro etapas: consultar, registrar, conciliar el banco y configurar." },
  { guia: "sub-mayor", sub: "mayor", titulo: "El libro: plan de cuentas y saldos",
    texto: "Cada cuenta del PUC con su saldo inicial, débitos, créditos y saldo final. Al tocar una cuenta se ven los asientos que la movieron." },
  { guia: "sub-libro-diario", sub: "libro-diario", titulo: "Libro Diario",
    texto: "Los asientos día por día, con la cuenta, el débito y el crédito de cada uno. Se puede filtrar por cuenta y descargar en CSV." },
  { guia: "sub-retenciones", sub: "retenciones", titulo: "Retenciones y temas",
    texto: "Los certificados de lo que Mercado Pago nos retuvo (saldo a favor en las declaraciones), con el PDF original de cada mes." },
  { guia: "grupo-conciliar", titulo: "Conciliar el banco",
    texto: "Aquí se cruza cada línea del extracto de Bancolombia con su asiento. Septiembre está completo; julio y agosto son del período que declaró el contador." },
  { guia: "lm-letra", titulo: "Tamaño de la letra",
    texto: "Si algo se ve pequeño, súbelo aquí. Cada persona lo ajusta a su pantalla y el navegador lo recuerda." },
];

type Caja = { top: number; left: number; width: number; height: number } | null;

export default function VisitaGuiada({ pasos, onIr, onCerrar }: {
  pasos: PasoVisita[]; onIr: (sub: string) => void; onCerrar: () => void;
}) {
  const [i, setI] = useState(0);
  const [caja, setCaja] = useState<Caja>(null);
  const paso = pasos[i];

  const medir = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`[data-guia="${paso.guia}"]`);
    if (!el || el.offsetParent === null) { setCaja(null); return; }
    const r = el.getBoundingClientRect();
    setCaja({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [paso.guia]);

  // Al cambiar de paso: abrir su vista, esperar a que pinte, centrarlo y medirlo.
  useEffect(() => {
    if (paso.sub) onIr(paso.sub);
    let vivo = true;
    const t = window.setTimeout(() => {
      if (!vivo) return;
      document.querySelector<HTMLElement>(`[data-guia="${paso.guia}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => vivo && medir(), 350);
    }, paso.sub ? 450 : 50);
    return () => { vivo = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useLayoutEffect(() => {
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => { window.removeEventListener("resize", medir); window.removeEventListener("scroll", medir, true); };
  }, [medir]);

  const ultimo = i === pasos.length - 1;
  const siguiente = () => (ultimo ? onCerrar() : setI(i + 1));
  const anterior = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      else if (e.key === "ArrowRight") siguiente();
      else if (e.key === "ArrowLeft") anterior();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  // La tarjeta va debajo del elemento si cabe; si no, arriba; sin elemento, centrada.
  const ancho = Math.min(440, window.innerWidth - 32);
  let estilo: React.CSSProperties = { width: ancho, left: (window.innerWidth - ancho) / 2, top: window.innerHeight / 2 - 120 };
  const alta = caja && caja.height > window.innerHeight * 0.55;
  const derecha = caja ? caja.left + caja.width + 18 : 0;
  if (caja && alta && derecha + ancho < window.innerWidth - 8) {
    // Elemento alto (el riel): la tarjeta va al lado, a media altura, sin taparlo.
    estilo = { width: ancho, left: derecha, top: Math.max(16, window.innerHeight / 2 - 120) };
  } else if (caja) {
    const abajo = caja.top + caja.height + 14;
    const left = Math.min(Math.max(16, caja.left), window.innerWidth - ancho - 16);
    estilo = abajo + 230 < window.innerHeight
      ? { width: ancho, left, top: abajo }
      : { width: ancho, left, top: Math.max(16, caja.top - 14 - 240) };
  }

  return createPortal(
    <div className="vg" role="dialog" aria-modal="true" aria-label="Visita guiada del Libro Mayor">
      {caja ? (
        <div className="vg-luz" style={{ top: caja.top - 6, left: caja.left - 6, width: caja.width + 12, height: caja.height + 12 }} />
      ) : (
        <div className="vg-velo" />
      )}
      <div className="vg-tarjeta" style={estilo}>
        <p className="vg-paso">Paso {i + 1} de {pasos.length}</p>
        <h3 className="vg-titulo">{paso.titulo}</h3>
        <p className="vg-texto">{paso.texto}</p>
        <div className="vg-botones">
          <button type="button" className="vg-salir" onClick={onCerrar}>Salir</button>
          <span className="vg-espacio" />
          {i > 0 && <button type="button" className="vg-btn" onClick={anterior}>← Anterior</button>}
          <button type="button" className="vg-btn vg-btn-primario" onClick={siguiente}>
            {ultimo ? "Terminar" : "Siguiente →"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
