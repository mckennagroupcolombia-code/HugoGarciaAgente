/**
 * El estado del mes en una tarjeta: veredicto en una frase y las cuatro cosas que
 * un contador comprueba primero (cuadre, banco, DIAN, impuestos). Minimalista:
 * cada bloque se despliega para ver el detalle.
 */
import { useState } from "react";
import { Icon } from "../../icons";
import CajaObservacion from "./CajaObservacion";
import PaquetePanel from "./PaquetePanel";
import { cop, mesLargo, pct, type Expediente, type Impuesto } from "./tipos";

const VEREDICTO_IMP: Record<Impuesto["veredicto"], { texto: string; clase: string }> = {
  cuadra: { texto: "cuadra con lo declarado", clase: "rv-ok" },
  difiere: { texto: "difiere de lo declarado", clase: "rv-falta" },
  pendiente: { texto: "declaración pendiente", clase: "rv-parcial" },
  presentada: { texto: "presentada (sin cifra para comparar)", clase: "rv-parcial" },
  sin_declaracion: { texto: "sin declaración", clase: "rv-parcial" },
};

function Bloque({ titulo, estado, resumen, children }: { titulo: string; estado: "ok" | "parcial" | "falta" | "neutro"; resumen: string; children?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const icono = estado === "ok" ? "check" : estado === "falta" ? "warning" : estado === "parcial" ? "clock" : "file";
  return (
    <li className={`rv-fila rv-${estado === "neutro" ? "tema" : estado}`}>
      <button type="button" className="rv-fila-cabeza" onClick={() => children && setAbierto(!abierto)} aria-expanded={abierto} disabled={!children}>
        <span className="rv-marca"><Icon name={icono} size={18} weight="bold" /></span>
        <span className="rv-fila-textos"><span className="rv-h">{titulo}</span><span className="rv-sub">{resumen}</span></span>
        {children && <span className={`rv-chevron ${abierto ? "rv-chevron-abierto" : ""}`}><Icon name="caretDown" size={18} weight="bold" /></span>}
      </button>
      {abierto && <div className="rv-detalle">{children}</div>}
    </li>
  );
}

export default function TarjetaMes({ e, onAbrirFuente, onIrCuenta }: {
  e: Expediente; onAbrirFuente: (ref: string) => void; onIrCuenta: (codigo: string) => void;
}) {
  const b = e.estado.banco;
  const d = e.estado.dian;
  const contador = e.tipo === "periodo_contador";
  const impDifieren = e.estado.impuestos.filter((i) => i.veredicto === "difiere");
  const impPend = e.estado.impuestos.filter((i) => i.veredicto === "pendiente");

  return (
    <section className={`rv-veredicto rv-${e.veredicto.nivel === "neutro" ? "neutro" : e.veredicto.nivel}`} data-guia="ex-estado">
      <p className="rv-veredicto-titulo">{mesLargo(e.periodo)}: {e.veredicto.titulo}</p>
      {e.veredicto.frase && <p className="rv-txt">{e.veredicto.frase}</p>}
      <ul className="rv-lista mt-3">
        {!contador && (
          <Bloque titulo="Partida doble" estado={e.estado.cuadra ? "ok" : "falta"}
            resumen={`${e.estado.asientos} asientos · débitos ${cop(e.estado.total_debito)} = créditos ${cop(e.estado.total_credito)}${e.estado.anulados ? ` · ${e.estado.anulados} anulados` : ""}`} />
        )}
        <Bloque titulo="Banco (1110 Bancolombia)" estado={contador ? "neutro" : b.cuadra ? "ok" : "parcial"}
          resumen={b.lineas
            ? `Extracto: ${b.vinculadas} de ${b.lineas} líneas con asiento · cierra en ${cop(b.saldo_extracto_final)}${contador ? "" : ` · libro ${cop(b.saldo_libro_final)}`}`
            : "Sin extracto cargado para este mes"}>
          <ul>
            <li>Saldo del extracto: {cop(b.saldo_extracto_inicial)} → {cop(b.saldo_extracto_final)} <span className="rv-sub">({b.saldo_metodo})</span></li>
            {!contador && <li>Saldo del libro en 1110: {cop(b.saldo_libro_inicial)} → {cop(b.saldo_libro_final)}</li>}
            {!contador && b.diferencia != null && (
              <li><b>Diferencia extracto − libro: {cop(b.diferencia)}</b>{Math.abs(b.diferencia) > 1 ? " — el libro arrastra saldo de antes del corte (ventas MeLi en Bancos) hasta que se fijen los saldos iniciales." : " — cuadra."}</li>
            )}
            <li>Abonos {cop(b.abonos)} · cargos {cop(b.cargos)} · {b.sin_vincular} líneas sin asiento{!contador ? ` · ${b.libro_sin_banco} asientos de 1110 sin línea del banco` : ""}</li>
            {b.extractos.map((x) => (
              <li key={x.id}>
                <button type="button" className="underline decoration-dotted" onClick={() => onAbrirFuente(`extracto:${x.id}`)}>{x.nombre || x.archivo_nombre}</button>
                <span className="rv-sub"> {x.desde} → {x.hasta} · {x.lineas} líneas</span>
              </li>
            ))}
          </ul>
          {!contador && <button type="button" className="rv-ir" onClick={() => onIrCuenta("1110")}>Ver la cuenta 1110 →</button>}
        </Bloque>
        <Bloque titulo="Documentos electrónicos (DIAN)" estado={!d.listado ? "falta" : contador ? "neutro" : (d.emitidos!.solo_libro || d.emitidos!.difieren || d.recibidos!.solo_dian) ? "parcial" : "ok"}
          resumen={!d.listado ? (d.error ? `No se pudo cruzar: ${d.error}` : "Sin listado de la DIAN para este mes") : contador
            ? `${d.emitidos!.dian} facturas emitidas por ${cop(d.emitidos!.valor_dian)} · ${d.recibidos!.dian} recibidas por ${cop(d.recibidos!.valor_dian)}`
            : `Ventas: ${d.emitidos!.en_ambos} en ambos (${d.emitidos!.cuadran} exactas) · ${d.emitidos!.solo_dian} solo en la DIAN · ${d.emitidos!.solo_libro} solo en el libro`}>
          {d.listado && (
            <ul>
              <li>Facturas emitidas: DIAN {d.emitidos!.dian} por {cop(d.emitidos!.valor_dian)}{!contador ? ` · libro ${d.emitidos!.libro} por ${cop(d.emitidos!.valor_libro)} · ${d.emitidos!.difieren} con otro valor` : ""}</li>
              <li>Notas crédito: DIAN {d.notas_credito!.dian} por {cop(d.notas_credito!.valor_dian)}{!contador ? ` · ${d.notas_credito!.solo_dian} sin asiento` : ""}</li>
              <li>Documentos soporte: {d.documentos_soporte!.dian} por {cop(d.documentos_soporte!.valor_dian)}{!contador ? ` · ${d.documentos_soporte!.cuadran} cuadran` : ""}</li>
              <li>Facturas recibidas: DIAN {d.recibidos!.dian} por {cop(d.recibidos!.valor_dian)}{!contador ? ` · ${d.recibidos!.en_ambos} en el libro · ${d.recibidos!.solo_dian} solo en la DIAN` : ""}</li>
              <li><button type="button" className="underline decoration-dotted" onClick={() => onAbrirFuente(`dian_listado:${e.periodo}`)}>Descargar el listado original de la DIAN</button></li>
            </ul>
          )}
          {!contador && d.listado && <button type="button" className="rv-ir" onClick={() => onIrCuenta("4135")}>Ver ventas (4135) →</button>}
        </Bloque>
        <Bloque titulo="Impuestos: lo que dicen las cuentas vs. lo declarado"
          estado={impDifieren.length ? "falta" : impPend.length ? "parcial" : "ok"}
          resumen={impDifieren.length ? `${impDifieren.map((i) => i.cuenta).join(", ")} difieren de lo declarado`
            : impPend.length ? `${impPend.length} cuentas con declaración pendiente` : "Todo lo declarado coincide con el libro"}>
          <table className="w-full text-left">
            <thead><tr className="rv-sub"><th className="py-1 pr-2">Cuenta</th><th className="py-1 pr-2 text-right">Causado</th><th className="py-1 pr-2 text-right">Pagado</th><th className="py-1 pr-2 text-right">Saldo</th><th className="py-1 pr-2 text-right">Declarado</th><th className="py-1">Estado</th></tr></thead>
            <tbody>
              {e.estado.impuestos.map((i) => (
                <tr key={i.cuenta} className="border-t border-border/50">
                  <td className="py-1 pr-2"><button type="button" className="font-mono font-bold underline decoration-dotted" onClick={() => onIrCuenta(i.cuenta)}>{i.cuenta}</button> <span className="rv-sub">{i.nombre}</span></td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(i.causado)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(i.pagado)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{cop(i.saldo_final)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {i.declarado?.valor != null ? cop(i.declarado.valor) : "—"}
                    {i.declarado?.ref && <button type="button" className="ml-1 text-accent" title="Abrir la declaración" onClick={() => onAbrirFuente(i.declarado!.ref!)}><Icon name="file" size={14} /></button>}
                  </td>
                  <td className={`py-1 ${VEREDICTO_IMP[i.veredicto].clase}`}>{VEREDICTO_IMP[i.veredicto].texto}{i.nota ? ` · ${i.nota}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bloque>
        {!contador && (
          <Bloque titulo="Soportes" estado="neutro"
            resumen={`${pct(e.cuentas.reduce((s, c) => s + (c.es_movimiento ? c.verificacion.con_soporte : 0), 0), e.cuentas.reduce((s, c) => s + (c.es_movimiento ? c.verificacion.asientos : 0), 0))} de los asientos tienen documento adjunto · ${e.estado.observaciones.abiertas} observaciones abiertas del contador`} />
        )}
      </ul>
      <div className="ex-pie-mes">
        <PaquetePanel periodo={e.periodo} />
        <CajaObservacion periodo={e.periodo} objetoTipo="mes" objetoId={e.periodo} compacta />
      </div>
    </section>
  );
}
