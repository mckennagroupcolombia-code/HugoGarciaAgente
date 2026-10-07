/**
 * La espina del expediente: el plan de cuentas del mes como fichas. Cada ficha
 * trae el saldo y sus insignias de verificación (banco · DIAN · soporte · Alegra ·
 * declaración · contador); al expandirla carga el auxiliar; cada fila del auxiliar
 * se expande al asiento con su comprobante, sus documentos y sus verificaciones.
 * Patrón de Solicitudes de pago: fichas con el asiento a la vista.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../icons";
import CajaObservacion from "./CajaObservacion";
import { cop, pct, type Asiento, type Auxiliar, type Cuenta, type Documento, type FilaAuxiliar } from "./tipos";

const PESADAS = new Set(["4135", "130505", "529505", "4175"]);

function Insignia({ tono, children, title }: { tono: "ok" | "parcial" | "falta" | "neutro"; children: React.ReactNode; title?: string }) {
  return <span className={`ex-insignia ex-${tono}`} title={title}>{children}</span>;
}

export function InsigniasCuenta({ c }: { c: Cuenta }) {
  const v = c.verificacion;
  const out: React.ReactNode[] = [];
  if (v.banco) out.push(<Insignia key="b" tono={v.banco.sin_vincular ? "parcial" : "ok"} title="Asientos con su línea del extracto">banco {v.banco.vinculados}/{v.banco.vinculados + v.banco.sin_vincular}</Insignia>);
  if (v.dian) out.push(<Insignia key="d" tono={v.dian.solo_libro || v.dian.difieren || v.dian.solo_dian ? "parcial" : "ok"} title="Documentos cruzados con el listado de la DIAN">DIAN {v.dian.en_ambos} en ambos{v.dian.solo_libro ? ` · ${v.dian.solo_libro} solo libro` : ""}{v.dian.solo_dian ? ` · ${v.dian.solo_dian} solo DIAN` : ""}</Insignia>);
  if (v.declaracion) {
    const d = v.declaracion;
    out.push(<Insignia key="x" tono={d.veredicto === "cuadra" ? "ok" : d.veredicto === "difiere" ? "falta" : "parcial"}>{d.formulario === "certificados" ? "certificado MP" : `formulario ${d.formulario}`}: {d.veredicto === "cuadra" ? "cuadra" : d.veredicto === "difiere" ? "difiere" : "pendiente"}</Insignia>);
  }
  if (v.asientos) out.push(<Insignia key="s" tono="neutro" title="Asientos con documento adjunto">soporte {pct(v.con_soporte, v.asientos)}</Insignia>);
  if (v.alegra) out.push(<Insignia key="a" tono="neutro">Alegra {v.alegra.espejados}</Insignia>);
  if (c.codigo === "130505") out.push(<Insignia key="m" tono="parcial">sin fuente externa</Insignia>);
  if (v.observaciones.revisado) out.push(<Insignia key="r" tono="ok">✓ revisado{v.observaciones.revisado_por ? ` por ${v.observaciones.revisado_por}` : ""}</Insignia>);
  if (v.observaciones.abiertas) out.push(<Insignia key="o" tono="falta">{v.observaciones.abiertas} observación(es)</Insignia>);
  return <span className="ex-insignias">{out}</span>;
}

export function FichaCuenta({ c, periodo, abierta, onToggle, onDocumento, onAbrirFuente, extra, titulos }: {
  c: Cuenta; periodo: string; abierta: boolean; onToggle: () => void;
  onDocumento: (d: Documento) => void; onAbrirFuente: (ref: string) => void; extra?: React.ReactNode;
  titulos?: Record<string, string>;
}) {
  const tono = c.verificacion.pendiente ? "parcial" : "ok";
  return (
    <li className={`rv-fila rv-${tono} ex-ficha`} data-cuenta={c.codigo}>
      <button type="button" className="rv-fila-cabeza" onClick={onToggle} aria-expanded={abierta}>
        <span className="rv-marca"><span className="font-mono text-[0.8em]">{c.codigo.length > 4 ? c.codigo.slice(0, 4) : c.codigo}</span></span>
        <span className="rv-fila-textos">
          <span className="rv-h"><span className="font-mono">{c.codigo}</span> {c.nombre}</span>
          <InsigniasCuenta c={c} />
        </span>
        <span className="ex-saldo">
          <span className="rv-sub">saldo</span>
          <b className="tabular-nums">{cop(c.saldo_final)}</b>
        </span>
        <span className={`rv-chevron ${abierta ? "rv-chevron-abierto" : ""}`}><Icon name="caretDown" size={18} weight="bold" /></span>
      </button>
      {abierta && (
        <div className="rv-detalle">
          {c.verificacion.motivos.length > 0 && (
            <ul className="ex-motivos">{c.verificacion.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>
          )}
          {c.descripcion && <p className="rv-sub">{c.descripcion}</p>}
          {c.verificacion.fuentes.length > 0 && (
            <p className="rv-sub">Fuentes: {c.verificacion.fuentes.map((f) => (
              <button key={f} type="button" className="mr-2 underline decoration-dotted" onClick={() => onAbrirFuente(f)}>{titulos?.[f] ?? f.split(":")[0].replace("_", " ")}</button>
            ))}</p>
          )}
          {extra}
          <CajaObservacion periodo={periodo} objetoTipo="cuenta" objetoId={c.codigo} />
          <AuxiliarCuenta periodo={periodo} codigo={c.codigo} onDocumento={onDocumento} />
        </div>
      )}
    </li>
  );
}

export function AuxiliarCuenta({ periodo, codigo, terceroId, onDocumento }: {
  periodo: string; codigo: string; terceroId?: number | null; onDocumento: (d: Documento) => void;
}) {
  const pesada = PESADAS.has(codigo) && !terceroId;
  const [porDia, setPorDia] = useState(pesada);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [asientoAbierto, setAsientoAbierto] = useState<number | null>(null);
  const limite = 60;
  const q = useQuery<Auxiliar>({
    queryKey: ["expediente-cuenta", periodo, codigo, terceroId ?? null, porDia, offset],
    queryFn: () => api.get(`/api/contabilidad/expediente/${periodo}/cuenta/${codigo}?${new URLSearchParams({
      limite: String(porDia ? 5000 : limite), offset: String(porDia ? 0 : offset),
      ...(porDia ? { agrupar: "dia" } : {}), ...(terceroId ? { tercero_id: String(terceroId) } : {}),
    }).toString()}`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <p className="rv-sub">Cargando el auxiliar…</p>;
  if (q.error || !q.data) return <p className="rv-txt rv-falta">No se pudo cargar el auxiliar: {(q.error as Error)?.message}</p>;
  const a = q.data;
  const filasDia = (fecha: string) => a.filas.filter((f) => f.fecha === fecha);

  return (
    <div className="ex-auxiliar">
      <div className="ex-aux-cabeza">
        <span className="rv-sub">Saldo inicial <b className="text-ink tabular-nums">{cop(a.saldo_inicial)}</b> · débitos {cop(a.total_debito)} · créditos {cop(a.total_credito)} · saldo final <b className="text-ink tabular-nums">{cop(a.saldo_final)}</b> · {a.total} asientos</span>
        <span className="ml-auto flex gap-1">
          {pesada && <button type="button" className={`ex-btn ${porDia ? "ex-btn-on" : ""}`} onClick={() => { setPorDia(!porDia); setOffset(0); }}>{porDia ? "Por día" : "Uno a uno"}</button>}
        </span>
      </div>
      <table className="ex-tabla">
        <thead><tr><th>Fecha</th><th>Concepto · tercero · contrapartida</th><th className="text-right">Débito</th><th className="text-right">Crédito</th><th className="text-right">Saldo</th><th>Verificación</th></tr></thead>
        <tbody>
          {porDia && a.por_dia
            ? a.por_dia.map((d) => (
              <DiaFilas key={d.fecha} d={d} abierto={diaAbierto === d.fecha} onToggle={() => setDiaAbierto(diaAbierto === d.fecha ? null : d.fecha)}
                        filas={filasDia(d.fecha)} periodo={periodo} asientoAbierto={asientoAbierto} setAsientoAbierto={setAsientoAbierto} onDocumento={onDocumento} />
            ))
            : a.filas.map((f) => (
              <FilaMov key={f.linea_id} f={f} periodo={periodo} abierto={asientoAbierto === f.movimiento_id}
                       onToggle={() => setAsientoAbierto(asientoAbierto === f.movimiento_id ? null : f.movimiento_id)} onDocumento={onDocumento} />
            ))}
        </tbody>
      </table>
      {!porDia && a.total > limite && (
        <div className="flex items-center gap-2 pt-2">
          <button type="button" className="ex-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limite))}>← Anteriores</button>
          <span className="rv-sub">{offset + 1}–{Math.min(offset + limite, a.total)} de {a.total}</span>
          <button type="button" className="ex-btn" disabled={offset + limite >= a.total} onClick={() => setOffset(offset + limite)}>Siguientes →</button>
        </div>
      )}
      {a.por_tercero.length > 1 && !terceroId && (
        <details className="pt-2">
          <summary className="rv-sub cursor-pointer">Por tercero ({a.por_tercero.length})</summary>
          <table className="ex-tabla mt-1"><tbody>
            {a.por_tercero.map((t) => (
              <tr key={String(t.tercero_id)}><td>{t.nombre}</td><td className="text-right">{t.movimientos} mov.</td><td className="text-right tabular-nums">{cop(t.debito)}</td><td className="text-right tabular-nums">{cop(t.credito)}</td><td className="text-right tabular-nums font-bold">{cop(t.saldo)}</td></tr>
            ))}
          </tbody></table>
        </details>
      )}
    </div>
  );
}

function DiaFilas({ d, abierto, onToggle, filas, periodo, asientoAbierto, setAsientoAbierto, onDocumento }: {
  d: NonNullable<Auxiliar["por_dia"]>[number]; abierto: boolean; onToggle: () => void; filas: FilaAuxiliar[]; periodo: string;
  asientoAbierto: number | null; setAsientoAbierto: (id: number | null) => void; onDocumento: (d: Documento) => void;
}) {
  return (
    <>
      <tr className="ex-fila-dia cursor-pointer" onClick={onToggle}>
        <td className="font-mono">{abierto ? "▾" : "▸"} {d.fecha}</td>
        <td>{d.n} asientos del día</td>
        <td className="text-right tabular-nums">{d.debito ? cop(d.debito) : ""}</td>
        <td className="text-right tabular-nums">{d.credito ? cop(d.credito) : ""}</td>
        <td className="text-right tabular-nums font-bold">{cop(d.saldo)}</td>
        <td><span className="ex-insignias">
          <Insignia tono="neutro">soporte {pct(d.con_soporte, d.n)}</Insignia>
          {d.sin_banco > 0 && <Insignia tono="parcial">{d.sin_banco} sin banco</Insignia>}
          {d.dian_solo_libro > 0 && <Insignia tono="parcial">{d.dian_solo_libro} sin FE en la DIAN</Insignia>}
        </span></td>
      </tr>
      {abierto && filas.map((f) => (
        <FilaMov key={f.linea_id} f={f} periodo={periodo} abierto={asientoAbierto === f.movimiento_id}
                 onToggle={() => setAsientoAbierto(asientoAbierto === f.movimiento_id ? null : f.movimiento_id)} onDocumento={onDocumento} />
      ))}
    </>
  );
}

function InsigniasFila({ v }: { v: FilaAuxiliar["verificaciones"] }) {
  return (
    <span className="ex-insignias">
      {v.banco.estado === "vinculado" && <Insignia tono="ok" title={`${v.banco.fecha_banco} · ${v.banco.descripcion_banco}`}>banco ✓</Insignia>}
      {v.banco.estado === "sin_banco" && <Insignia tono="parcial">sin banco</Insignia>}
      {v.dian.estado === "cuadra" && <Insignia tono="ok" title={v.dian.documento}>DIAN ✓ {v.dian.documento}</Insignia>}
      {v.dian.estado === "difiere" && <Insignia tono="parcial" title={`DIAN ${cop(v.dian.total_dian)}`}>DIAN {v.dian.documento} difiere {cop(v.dian.diferencia)}</Insignia>}
      {v.dian.estado === "solo_libro" && <Insignia tono="parcial">{v.dian.documento} no está en la DIAN</Insignia>}
      {v.dian.estado === "sin_documento" && <Insignia tono="neutro">sin FE</Insignia>}
      {v.soporte.estado === "si" ? <Insignia tono="ok">soporte {v.soporte.n}</Insignia> : <Insignia tono="neutro">sin soporte</Insignia>}
      {v.alegra && <Insignia tono="neutro">Alegra #{v.alegra.journal_id}</Insignia>}
      {v.observacion?.revisado && <Insignia tono="ok">✓ revisado</Insignia>}
      {v.observacion?.abiertas ? <Insignia tono="falta">{v.observacion.abiertas} obs.</Insignia> : null}
    </span>
  );
}

function FilaMov({ f, periodo, abierto, onToggle, onDocumento }: {
  f: FilaAuxiliar; periodo: string; abierto: boolean; onToggle: () => void; onDocumento: (d: Documento) => void;
}) {
  return (
    <>
      <tr className="ex-fila cursor-pointer" onClick={onToggle}>
        <td className="font-mono whitespace-nowrap">{f.fecha}</td>
        <td>
          <span className="text-ink">{f.concepto}</span>
          {f.tercero_nombre && <span className="rv-sub"> · {f.tercero_nombre}</span>}
          {f.contrapartida?.length > 0 && <span className="rv-sub"> · contra {f.contrapartida.map((c) => c.codigo).join(", ")}</span>}
        </td>
        <td className="text-right tabular-nums">{f.debito ? cop(f.debito) : ""}</td>
        <td className="text-right tabular-nums">{f.credito ? cop(f.credito) : ""}</td>
        <td className="text-right tabular-nums font-bold">{cop(f.saldo)}</td>
        <td><InsigniasFila v={f.verificaciones} /></td>
      </tr>
      {abierto && (
        <tr><td colSpan={6} className="ex-asiento-celda"><AsientoDetalle periodo={periodo} movimientoId={f.movimiento_id} onDocumento={onDocumento} /></td></tr>
      )}
    </>
  );
}

export function AsientoDetalle({ periodo, movimientoId, onDocumento }: { periodo: string; movimientoId: number; onDocumento: (d: Documento) => void }) {
  const q = useQuery<Asiento>({
    queryKey: ["expediente-asiento", periodo, movimientoId],
    queryFn: () => api.get(`/api/contabilidad/expediente/${periodo}/asiento/${movimientoId}`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <p className="rv-sub">Abriendo el asiento…</p>;
  if (q.error || !q.data) return <p className="rv-txt rv-falta">No se pudo abrir el asiento.</p>;
  const a = q.data;
  return (
    <div className="ex-asiento" data-guia="ex-asiento">
      <p className="rv-h">Asiento #{a.movimiento.id} · {a.movimiento.fecha} · {a.movimiento.concepto}</p>
      <p className="rv-sub">{a.movimiento.tipo_origen}{a.movimiento.referencia ? ` · ref. ${a.movimiento.referencia}` : ""}{a.movimiento.tercero ? ` · ${a.movimiento.tercero.nombre}${a.movimiento.tercero.identificacion ? ` (${a.movimiento.tercero.identificacion})` : ""}` : ""}</p>
      <table className="ex-tabla ex-comprobante">
        <thead><tr><th>Cuenta</th><th>Concepto</th><th className="text-right">Débito</th><th className="text-right">Crédito</th></tr></thead>
        <tbody>
          {a.lineas.map((l, i) => (
            <tr key={i}><td className="font-mono text-accent">{l.cuenta_codigo}</td><td>{l.cuenta_nombre}{l.descripcion ? <span className="rv-sub"> — {l.descripcion}</span> : null}{l.tercero_nombre ? <span className="rv-sub"> · {l.tercero_nombre}</span> : null}</td><td className="text-right tabular-nums">{l.debito ? cop(l.debito) : "—"}</td><td className="text-right tabular-nums">{l.credito ? cop(l.credito) : "—"}</td></tr>
          ))}
          <tr className="font-bold"><td colSpan={2}>{a.cuadra ? "✓ Sumas iguales" : "✗ No cuadra"}</td><td className="text-right tabular-nums">{cop(a.movimiento.total_debito)}</td><td className="text-right tabular-nums">{cop(a.movimiento.total_credito)}</td></tr>
        </tbody>
      </table>
      <div className="ex-docs">
        <p className="rv-sub font-bold">Documentos y verificaciones</p>
        {a.documentos.length === 0 && !a.banco_linea && <p className="rv-sub">Este asiento no tiene documento adjunto ni línea del banco.</p>}
        <ul>
          {a.documentos.map((d) => (
            <li key={d.ref}>
              <button type="button" className="ex-doc" onClick={() => onDocumento(d)}>
                <Icon name={d.origen === "alegra" && !d.disponible_local ? "link" : "file"} size={16} weight="bold" />
                <span>{d.titulo}</span>
                <span className="rv-sub">{d.disponible_local ? (d.bytes ? `${Math.max(1, Math.round(d.bytes / 1024))} KB` : "") : d.origen === "alegra" ? "en Alegra" : d.nota || d.origen}</span>
              </button>
            </li>
          ))}
          {a.banco_linea && (
            <li className="rv-sub">Banco: {a.banco_linea.fecha} · {a.banco_linea.descripcion} · {cop(a.banco_linea.monto)}{a.banco_linea.notas ? ` · ${a.banco_linea.notas}` : ""}</li>
          )}
          {a.dian && a.dian.estado !== "no_aplica" && (
            <li className="rv-sub">DIAN: {a.dian.documento || "sin documento"} · {a.dian.estado === "cuadra" ? `cuadra (${cop(a.dian.total_dian)})` : a.dian.estado === "difiere" ? `la DIAN dice ${cop(a.dian.total_dian)}` : a.dian.estado}{a.dian.cufe ? <span className="font-mono"> · CUFE {a.dian.cufe.slice(0, 14)}…</span> : null}</li>
          )}
          {a.alegra && <li className="rv-sub">Alegra: comprobante #{a.alegra.journal_id} · <a className="underline" href={a.alegra.url} target="_blank" rel="noopener noreferrer">abrir</a></li>}
        </ul>
      </div>
      <CajaObservacion periodo={periodo} objetoTipo="asiento" objetoId={String(a.movimiento.id)} compacta />
    </div>
  );
}
