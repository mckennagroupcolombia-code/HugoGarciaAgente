/**
 * Expediente contable: el Libro Mayor por mes y por cuenta, como lo recorre el
 * contador. Una sola pantalla (patrón de Solicitudes de pago): tira de meses, el
 * estado del mes en una tarjeta, el filtro «Por revisar» por defecto y las cuentas
 * del PUC como fichas que se abren al auxiliar, al asiento y a sus documentos.
 *
 * Datos: /api/contabilidad/expediente/* (app/services/expediente_contable.py).
 * Sin LLM. Tamaños con --lm-esc (control A−/A+ del Libro Mayor).
 */
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Icon } from "../icons";
import { FichaCuenta } from "./expediente/EspinaPUC";
import TarjetaMes from "./expediente/TarjetaMes";
import VisorDocumento from "./expediente/VisorDocumento";
import { cop, mesCorto, type Cuenta, type Documento, type Expediente, type Periodo } from "./expediente/tipos";
import "./expediente/expediente.css";

type Filtro = "revisar" | "todas" | "clave";
const PERIODO_KEY = "mckenna-expediente-periodo";

function periodoInicial(ps: Periodo[]): string {
  try {
    const g = localStorage.getItem(PERIODO_KEY);
    if (g && ps.some((p) => p.periodo === g)) return g;
  } catch { /* ignore */ }
  // El último mes cerrado con libro propio: lo que el contador revisa.
  const cerrados = ps.filter((p) => p.tipo === "libro_propio" && !p.en_curso && p.asientos > 0);
  return (cerrados[cerrados.length - 1] ?? ps[ps.length - 1]).periodo;
}

export default function ExpedienteContable({ onIr }: { onIr?: (sub: string) => void }) {
  const periodosQ = useQuery<{ periodos: Periodo[] }>({
    queryKey: ["expediente-periodos"],
    queryFn: () => api.get("/api/contabilidad/expediente/periodos"),
    staleTime: 60_000,
  });
  const ps = periodosQ.data?.periodos ?? [];
  const [periodo, setPeriodo] = useState<string | null>(null);
  useEffect(() => { if (ps.length && !periodo) setPeriodo(periodoInicial(ps)); }, [ps, periodo]);
  useEffect(() => {
    if (!periodo) return;
    document.querySelector<HTMLElement>(`.ex-mes[aria-current="true"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [periodo, ps.length]);
  const elegir = (p: string) => { setPeriodo(p); setAbiertas(new Set()); try { localStorage.setItem(PERIODO_KEY, p); } catch { /* ignore */ } };

  const q = useQuery<Expediente>({
    queryKey: ["expediente-mes", periodo],
    queryFn: () => api.get(`/api/contabilidad/expediente/${periodo}`),
    enabled: Boolean(periodo),
    staleTime: 60_000,
  });
  const [filtro, setFiltro] = useState<Filtro>("revisar");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [doc, setDoc] = useState<Documento | null>(null);
  const [buscar, setBuscar] = useState("");

  const e = q.data;
  const cuentas = useMemo(() => {
    if (!e) return [];
    const mov = e.cuentas.filter((c) => c.es_movimiento || c.verificacion.asientos > 0);
    const orden = (c: Cuenta) => { const i = e.cuentas_clave.indexOf(c.codigo); return i >= 0 ? i : 100 + Number(c.codigo[0]); };
    let lista = mov;
    if (filtro === "revisar") lista = mov.filter((c) => c.verificacion.pendiente);
    if (filtro === "clave") lista = mov.filter((c) => c.clave);
    if (buscar.trim()) {
      const b = buscar.trim().toLowerCase();
      lista = mov.filter((c) => c.codigo.startsWith(b) || c.nombre.toLowerCase().includes(b));
    }
    return [...lista].sort((a, b) => orden(a) - orden(b) || a.codigo.localeCompare(b.codigo));
  }, [e, filtro, buscar]);

  const titulosFuentes = useMemo(() => Object.fromEntries((e?.fuentes ?? []).map((f) => [f.ref, f.titulo])), [e]);
  const toggle = (codigo: string) => setAbiertas((s) => { const n = new Set(s); n.has(codigo) ? n.delete(codigo) : n.add(codigo); return n; });
  const irCuenta = (codigo: string) => {
    setFiltro("todas"); setBuscar("");
    setAbiertas((s) => new Set(s).add(codigo));
    window.setTimeout(() => document.querySelector(`[data-cuenta="${codigo}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
  };
  const abrirFuente = (ref: string) => setDoc({ ref, tipo: ref.split(":")[0], titulo: ref.replace(":", " "), origen: "local", disponible_local: true, archivo: null, mime: ref.endsWith(".xlsx") || ref.startsWith("dian_listado") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : null, bytes: null, sha256: null, enlace_externo: null, nota: "" });

  return (
    <div className="rv ex">
      <header className="rv-encabezado">
        <div>
          <h2 className="rv-titulo">Expediente contable</h2>
          <p className="rv-sub">Mes a mes, cuenta por cuenta: cada cifra con su asiento, su documento y su verificación. El libro propio manda desde el {e?.corte ?? "2026-09-01"}; lo anterior lo declaró el contador.</p>
        </div>
      </header>

      <nav className="ex-periodos" data-guia="ex-periodos" aria-label="Meses">
        {ps.map((p, i) => (<Fragment key={p.periodo}>
          {(i === 0 || p.periodo.slice(0, 4) !== ps[i - 1].periodo.slice(0, 4)) && (
            <span className="ex-anio" aria-hidden>{p.periodo.slice(0, 4)}</span>
          )}
          <button type="button" onClick={() => elegir(p.periodo)} aria-current={p.periodo === periodo ? "true" : undefined}
            className={`ex-mes ${p.tipo === "periodo_contador" ? "ex-mes-contador" : ""} ${p.en_curso ? "ex-mes-curso" : ""}`}
            title={p.tipo === "periodo_contador" ? "Período declarado por el contador" : `${p.asientos} asientos`}>
            <span className="ex-mes-nombre">{mesCorto(p.periodo).split(" ")[0]}</span>
            <span className="ex-mes-anio">20{mesCorto(p.periodo).split(" ")[1]}</span>
            <span className="ex-mes-puntos">
              <i className={p.extracto ? "on" : ""} title="extracto" />
              <i className={p.dian ? "on" : ""} title="DIAN" />
              <i className={p.asientos ? "on" : ""} title="libro" />
            </span>
            {p.observaciones_abiertas > 0 && <span className="ex-mes-obs">{p.observaciones_abiertas}</span>}
          </button>
        </Fragment>))}
      </nav>

      {q.isLoading && <p className="rv-txt rv-cargando">Armando el expediente de {periodo ? mesCorto(periodo) : ""}…</p>}
      {q.error && <p className="rv-txt rv-falta">No se pudo armar el expediente: {(q.error as Error).message}</p>}

      {e && (
        <>
          <TarjetaMes e={e} onAbrirFuente={abrirFuente} onIrCuenta={irCuenta} />

          {e.tipo === "periodo_contador" ? (
            <section className="rv-bloque" data-guia="ex-puc">
              <h3 className="rv-bloque-titulo">Fuentes del mes</h3>
              <p className="rv-sub rv-bloque-ayuda">Lo que hay de este mes para contrastar: el extracto, el listado de la DIAN, las declaraciones y los recibos. El libro propio no cubre este período.</p>
              <ul className="rv-lista">
                {e.fuentes.map((f) => (
                  <li key={f.ref} className="rv-fila rv-tema">
                    <button type="button" className="rv-fila-cabeza" onClick={() => abrirFuente(f.ref)} disabled={!f.disponible_local}>
                      <span className="rv-marca"><Icon name="file" size={18} weight="bold" /></span>
                      <span className="rv-fila-textos"><span className="rv-h">{f.titulo}</span><span className="rv-sub">{f.detalle}{f.cuentas.length ? ` · cuentas ${f.cuentas.join(", ")}` : ""}</span></span>
                      <span className="rv-chevron"><Icon name={f.disponible_local ? "download" : "link"} size={18} weight="bold" /></span>
                    </button>
                  </li>
                ))}
                {e.fuentes.length === 0 && <li className="rv-sub">No hay fuentes cargadas de este mes.</li>}
              </ul>
            </section>
          ) : (
            <section className="rv-bloque" data-guia="ex-puc">
              <div className="ex-filtros">
                <h3 className="rv-bloque-titulo">Cuentas del mes</h3>
                <div className="ex-filtro-botones">
                  {([["revisar", `Por revisar (${e.estado.cuentas_por_revisar})`], ["clave", "Cuentas clave"], ["todas", `Todas (${e.estado.cuentas_con_movimiento})`]] as [Filtro, string][]).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => { setFiltro(v); setBuscar(""); }} className={`ex-btn ${filtro === v && !buscar ? "ex-btn-on" : ""}`}>{l}</button>
                  ))}
                  <input value={buscar} onChange={(ev) => setBuscar(ev.target.value)} placeholder="Buscar cuenta: 2365, proveedores…" className="ex-buscar" aria-label="Buscar cuenta" />
                </div>
              </div>
              <p className="rv-sub rv-bloque-ayuda">
                {filtro === "revisar" && !buscar ? "Solo las cuentas con algo pendiente: sin línea del banco, cruce con la DIAN con diferencias, declaración que difiere u observación abierta. Toca una cuenta para ver su auxiliar." : "Toca una cuenta para ver su auxiliar; toca un asiento para ver su comprobante y sus documentos."}
              </p>
              {cuentas.length === 0 && <p className="rv-txt rv-vacio">{filtro === "revisar" ? "Nada por revisar en este mes." : "Sin cuentas que mostrar."}</p>}
              <ul className="rv-lista">
                {cuentas.map((c) => (
                  <FichaCuenta key={c.codigo} c={c} periodo={e.periodo} abierta={abiertas.has(c.codigo)} onToggle={() => toggle(c.codigo)}
                               onDocumento={setDoc} onAbrirFuente={abrirFuente} titulos={titulosFuentes}
                               extra={c.codigo === "130505" ? <p className="rv-sub">{e.estado.mercadopago.nota} Saldo en el libro: {cop(e.estado.mercadopago.saldo_libro_final)}.</p> : undefined} />
                ))}
              </ul>
              {onIr && (
                <p className="rv-sub pt-3">¿Quieres el árbol completo con todos los niveles? <button type="button" className="underline" onClick={() => onIr("mayor")}>Plan de cuentas y saldos</button>.</p>
              )}
            </section>
          )}
        </>
      )}

      {doc && <VisorDocumento doc={doc} onCerrar={() => setDoc(null)} />}
    </div>
  );
}
