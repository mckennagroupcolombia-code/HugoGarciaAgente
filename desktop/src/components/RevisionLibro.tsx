/**
 * Libro Mayor → «Revisión del libro»: la pantalla con la que se abre la reunión
 * con el contador. Contesta su primera pregunta —¿qué tienen y qué falta?— y dice
 * qué hay que ajustar hoy, en orden.
 *
 * Minimalista primero: cada renglón es una línea grande (qué es + en una frase cómo
 * está). Al tocarlo se despliega el detalle y el botón a la vista donde se resuelve.
 * Los datos salen de GET /api/contabilidad/revision (app/services/revision_libro.py).
 * Los atributos data-guia los usa la visita guiada (VisitaGuiada.tsx).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Icon } from "../icons";
import type { IconName } from "../icons/types";

type Renglon = {
  id: string; titulo: string; estado: "ok" | "parcial" | "falta"; resumen: string;
  detalle: string[]; ir: string | null; cifra: string | null;
};
type Tema = {
  id: string; titulo: string; detalle: string; pregunta?: string; creado?: string;
  cifras?: { periodo: string; lineas: number; valor: number }[];
  cifras_certificados?: Record<string, number>;
};
type Revision = {
  hoy: string; corte: string;
  veredicto: { nivel: "verde" | "amarillo" | "rojo"; titulo: string; frase: string };
  tenemos: Renglon[]; falta: Renglon[]; ajustar: Renglon[]; hablar: Tema[];
};

/** A qué vista lleva cada «ir» del backend, con el nombre que ve la persona. */
const VISTAS: Record<string, string> = {
  expediente: "Expediente contable",
  "taller-conciliacion": "Taller de conciliación",
  diario: "Tabla de contabilidad",
  balance: "Balance",
  retenciones: "Retenciones y temas",
  mayor: "Plan de cuentas y saldos",
};

const ESTADO: Record<Renglon["estado"], { icono: IconName; clase: string; texto: string }> = {
  ok: { icono: "check", clase: "rv-ok", texto: "Listo" },
  parcial: { icono: "clock", clase: "rv-parcial", texto: "Incompleto" },
  falta: { icono: "warning", clase: "rv-falta", texto: "Falta" },
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function cop(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
}

function Fila({ r, numero, onIr }: { r: Renglon; numero?: number; onIr: (sub: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const e = ESTADO[r.estado];
  const tieneDetalle = r.detalle.length > 0 || r.ir;
  return (
    <li className={`rv-fila ${e.clase}`}>
      <button type="button" className="rv-fila-cabeza" onClick={() => tieneDetalle && setAbierto(!abierto)}
        aria-expanded={tieneDetalle ? abierto : undefined} disabled={!tieneDetalle}>
        <span className="rv-marca" aria-label={e.texto}>
          {numero != null ? <b>{numero}</b> : <Icon name={e.icono} size={18} weight="bold" />}
        </span>
        <span className="rv-fila-textos">
          <span className="rv-h">{r.titulo}</span>
          <span className="rv-sub">{r.resumen}</span>
        </span>
        {r.cifra && <span className="rv-cifra">{r.cifra}</span>}
        {tieneDetalle && <span className={`rv-chevron ${abierto ? "rv-chevron-abierto" : ""}`}><Icon name="caretDown" size={18} weight="bold" /></span>}
      </button>
      {abierto && (
        <div className="rv-detalle">
          {r.detalle.length > 0 && (
            <ul>
              {r.detalle.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          {r.ir && (
            <button type="button" className="rv-ir" onClick={() => onIr(r.ir!)}>
              Ir a {VISTAS[r.ir] ?? r.ir} →
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function TemaFila({ t }: { t: Tema }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <li className="rv-fila rv-tema">
      <button type="button" className="rv-fila-cabeza" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <span className="rv-marca"><Icon name="chat" size={18} weight="bold" /></span>
        <span className="rv-fila-textos">
          <span className="rv-h">{t.titulo}</span>
          {t.pregunta && <span className="rv-sub rv-pregunta">{t.pregunta}</span>}
        </span>
        <span className={`rv-chevron ${abierto ? "rv-chevron-abierto" : ""}`}><Icon name="caretDown" size={18} weight="bold" /></span>
      </button>
      {abierto && (
        <div className="rv-detalle">
          <p>{t.detalle}</p>
          {t.cifras && t.cifras.length > 0 && (
            <p className="rv-sub">
              {t.cifras.length} meses · total {cop(t.cifras.reduce((s, c) => s + c.valor, 0))}
              {" "}(el detalle mes a mes está en Retenciones y temas)
            </p>
          )}
          {t.cifras_certificados && (
            <p className="rv-sub">Certificado: {cop(t.cifras_certificados.total)} a favor de McKenna.</p>
          )}
        </div>
      )}
    </li>
  );
}

function Bloque({ guia, titulo, ayuda, vacio, children }: {
  guia: string; titulo: string; ayuda: string; vacio?: string; children: React.ReactNode;
}) {
  return (
    <section className="rv-bloque" data-guia={guia}>
      <h3 className="rv-bloque-titulo">{titulo}</h3>
      <p className="rv-sub rv-bloque-ayuda">{ayuda}</p>
      {vacio ? <p className="rv-txt rv-vacio">{vacio}</p> : <ul className="rv-lista">{children}</ul>}
    </section>
  );
}

export default function RevisionLibro({ onIr, onVisita, visitaHecha }: {
  onIr: (sub: string) => void; onVisita: () => void; visitaHecha: boolean;
}) {
  const q = useQuery<Revision>({
    queryKey: ["contabilidad-revision"],
    queryFn: () => api.get("/api/contabilidad/revision"),
    staleTime: 60_000,
  });

  if (q.isLoading) return <p className="rv-txt rv-cargando">Revisando el libro…</p>;
  if (q.error || !q.data) return <p className="rv-txt rv-falta">No se pudo armar la revisión: {(q.error as Error)?.message}</p>;
  const d = q.data;

  return (
    <div className="rv">
      <header className="rv-encabezado">
        <div>
          <h2 className="rv-titulo">Revisión del libro</h2>
          <p className="rv-sub">
            Al {fechaLarga(d.hoy)} · el libro propio manda desde el {fechaLarga(d.corte)}; lo anterior lo declaró el contador.
          </p>
        </div>
        {visitaHecha && (
          <button type="button" className="rv-boton" onClick={onVisita} data-guia="rv-visita">
            <Icon name="compass" size={18} weight="bold" /> Repetir la visita
          </button>
        )}
      </header>

      {!visitaHecha && (
        <button type="button" className="rv-invitacion" onClick={onVisita}>
          ¿Primera vez aquí? Haz la visita guiada: en un minuto muestra qué hay en esta sección y por dónde empezar.
        </button>
      )}

      <section className={`rv-veredicto rv-${d.veredicto.nivel}`} data-guia="rv-veredicto">
        <p className="rv-veredicto-titulo">{d.veredicto.titulo}</p>
        <p className="rv-txt">{d.veredicto.frase}</p>
      </section>

      <div className="rv-columnas">
        <Bloque guia="rv-tenemos" titulo={`Lo que tenemos (${d.tenemos.length})`}
          ayuda="Completo y cuadrado. Toca un renglón para ver el detalle.">
          {d.tenemos.map((r) => <Fila key={r.id} r={r} onIr={onIr} />)}
        </Bloque>
        <Bloque guia="rv-falta" titulo={`Lo que nos falta (${d.falta.length})`}
          ayuda="Documentos o datos que todavía no están." vacio={d.falta.length ? undefined : "No falta nada."}>
          {d.falta.map((r) => <Fila key={r.id} r={r} onIr={onIr} />)}
        </Bloque>
      </div>

      <Bloque guia="rv-ajustar" titulo={`Para ajustar hoy (${d.ajustar.length})`}
        ayuda="En orden: primero lo que distorsiona las cifras de septiembre en adelante, después lo del pasado."
        vacio={d.ajustar.length ? undefined : "Nada por ajustar."}>
        {d.ajustar.map((r, i) => <Fila key={r.id} r={r} numero={i + 1} onIr={onIr} />)}
      </Bloque>

      <Bloque guia="rv-hablar" titulo={`Para hablar con el contador (${d.hablar.length})`}
        ayuda="Preguntas abiertas para la reunión. Las cifras se actualizan solas."
        vacio={d.hablar.length ? undefined : "No hay temas abiertos."}>
        {d.hablar.map((t) => <TemaFila key={t.id} t={t} />)}
      </Bloque>
    </div>
  );
}
