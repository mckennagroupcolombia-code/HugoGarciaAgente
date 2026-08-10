import { useState } from "react";
import { useAppStore } from "../stores/app";
import { Icon } from "../icons";
import {
  useAliadosImportacion,
  useCotizarImportacion,
  useProcesosImportacion,
  useCrearProcesoImportacion,
  useHistoricoImportaciones,
  useMarcarCompradoPor,
  type Aliado,
  type CompradoPor,
  type CotizacionImportacion,
} from "../hooks/useImportaciones";
import { ESTADO_STYLES, PRIORIDAD_STYLES } from "../lib/questStyles";

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  esperando_aprobacion: "Esperando aprobación",
  resuelto: "Resuelto",
  rechazado: "Rechazado",
};

function fmtUsd(n: number): string {
  return n.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

function fmtCop(n: number): string {
  return n.toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

const MODALIDAD_LABEL: Record<string, string> = {
  formal: "Formal (agencia de aduanas)",
  courier_simplificado: "Courier simplificado (tráfico postal)",
  aereo: "Aéreo",
  maritimo: "Marítimo",
  "no especificado": "No especificado",
};

const TIPO_MODALIDAD_LABEL: Record<string, string> = {
  ddp: "DDP",
  importacion_ordinaria: "Importación Ordinaria",
};

const GLOSARIO: { termino: string; significado: string }[] = [
  { termino: "DDP", significado: "Delivered Duty Paid — el aliado entrega la mercancía en destino con fletes, aduana e impuestos ya pagados; McKenna no gestiona nada en el camino. Riesgo: McKenna puede no quedar como importador de registro (ver aviso legal arriba)." },
  { termino: "Ordinaria", significado: "Importación Ordinaria/formal — McKenna (o su agente de aduanas) hace la declaración de importación a nombre propio ante la DIAN. Más trámite, pero deja soporte legal y IVA descontable." },
  { termino: "CBM", significado: "Cubic Meter (metro cúbico) — unidad de volumen de la carga, usada para cotizar transporte marítimo. 1 CBM ≈ una caja de 1m × 1m × 1m." },
  { termino: "FOB", significado: "Free On Board — valor de la mercancía en origen (fábrica/puerto China), sin flete ni seguro. Es la base sobre la que se estiman arancel e IVA." },
  { termino: "Arancel", significado: "Impuesto de importación calculado como % del valor FOB (más flete y seguro), lo cobra la DIAN al nacionalizar la carga." },
  { termino: "IVA", significado: "Impuesto sobre el valor de la mercancía nacionalizada (19% estándar en Colombia), adicional al arancel. Solo es descontable si la importación queda a nombre de McKenna." },
];

function FichaAliado({ aliado }: { aliado: Aliado }) {
  const pendienteConfirmar = aliado.aplicabilidad_materia_prima_farmaceutica_cosmetica === "pendiente_confirmar";

  return (
    <div className="rounded-paper border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">
          {aliado.nombre}{" "}
          <span className="ml-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase text-muted">
            {TIPO_MODALIDAD_LABEL[aliado.tipo_modalidad] ?? aliado.tipo_modalidad}
          </span>
        </h3>
        {aliado.fuente && (
          <a href={aliado.fuente} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
            Ver sitio del aliado
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{aliado.servicio}</p>

      {pendienteConfirmar && aliado.aplicabilidad_nota && (
        <div className="mt-3 rounded-paper border-2 border-orange-300 bg-orange-50 p-3 text-xs text-orange-800 dark:border-orange-700/50 dark:bg-orange-950/30 dark:text-orange-200">
          ⚠️ {aliado.aplicabilidad_nota}
        </div>
      )}

      {aliado.modos && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Object.entries(aliado.modos).map(([key, modo]) => (
            <div key={key} className="rounded-paper border border-border p-3 text-sm">
              <p className="font-bold text-ink">{modo.nombre}</p>
              <p className="mt-1 text-xs text-muted">
                Tránsito: {modo.dias_transito[0]}-{modo.dias_transito[1]} días
              </p>
              {modo.tiers && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-secondary">
                  {modo.tiers.map((t, i) => (
                    <li key={i}>
                      {t.hasta ? `hasta ${t.hasta} ${modo.unidad}` : `≥ ${modo.tiers![i - 1]?.hasta ?? 0} ${modo.unidad}`}
                      : USD {t.usd_por_unidad}/{modo.unidad}
                    </li>
                  ))}
                </ul>
              )}
              {modo.proveedores && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-secondary">
                  {Object.entries(modo.proveedores).map(([prov, tarifa]) => (
                    <li key={prov}>
                      {prov.toUpperCase()}: USD {tarifa.usd_por_kg_min}-{tarifa.usd_por_kg_max}/kg
                    </li>
                  ))}
                </ul>
              )}
              {modo.minimo != null && (
                <p className="mt-2 text-xs text-muted">Mínimo: {modo.minimo} {modo.unidad}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {aliado.restricciones_producto && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-paper border border-border p-3 text-xs">
            <p className="font-bold text-ink">No maneja</p>
            <p className="text-[10px] text-muted">Categorías que el aliado rechaza de plano — no las envíes a cotizar.</p>
            <p className="mt-1 text-ink-secondary">{aliado.restricciones_producto.no_maneja.join(", ")}</p>
          </div>
          <div className="rounded-paper border border-border p-3 text-xs">
            <p className="font-bold text-ink">Requiere revisión previa</p>
            <p className="text-[10px] text-muted">El aliado puede aceptarlas, pero primero hay que confirmar caso por caso.</p>
            <p className="mt-1 text-ink-secondary">{aliado.restricciones_producto.requiere_revision_previa.join(", ")}</p>
          </div>
        </div>
      )}

      {aliado.credenciales && (
        <div className="mt-4 rounded-paper border border-border p-3 text-xs text-ink-secondary">
          Agencia nivel {aliado.credenciales.nivel_agencia} · {aliado.credenciales.anos_experiencia} años de experiencia ·
          Resolución DIAN {aliado.credenciales.resolucion_dian}, código {aliado.credenciales.codigo}
        </div>
      )}

      {aliado.servicios && (
        <div className="mt-3 text-xs">
          <p className="font-bold text-ink">Servicios</p>
          <p className="mt-1 text-ink-secondary">{aliado.servicios.join(", ")}</p>
        </div>
      )}

      {aliado.nota_tarifas && (
        <div className="mt-3 rounded-paper border-2 border-dashed border-border p-3 text-xs text-muted">
          ℹ️ {aliado.nota_tarifas}
        </div>
      )}

      <div className="mt-4 text-xs text-muted">
        Contacto:{" "}
        {Object.entries(aliado.contacto)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" / ") : v}`)
          .join(" · ")}
      </div>
    </div>
  );
}

export default function ImportacionesPanel() {
  const setPanel = useAppStore((s) => s.setPanel);
  const { data: aliadosData, isLoading: cargandoAliados } = useAliadosImportacion();
  const { data: procesosData } = useProcesosImportacion();
  const { data: historico } = useHistoricoImportaciones();
  const cotizar = useCotizarImportacion();
  const crearProceso = useCrearProcesoImportacion();
  const marcarCompradoPor = useMarcarCompradoPor();

  const aliados = aliadosData?.aliados ?? [];
  const guia = aliadosData?.guia_modalidad;

  const [aliadoId, setAliadoId] = useState("china-latin-agent");
  const [kg, setKg] = useState("");
  const [cbm, setCbm] = useState("");
  const [valorFob, setValorFob] = useState("");
  const [cotizacion, setCotizacion] = useState<CotizacionImportacion | null>(null);
  const [titulo, setTitulo] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [mensajeProceso, setMensajeProceso] = useState<string | null>(null);

  const aliadoActivo = aliados.find((a) => a.id === aliadoId);

  async function onCotizar() {
    setMensajeProceso(null);
    try {
      const res = await cotizar.mutateAsync({
        aliado_id: aliadoId,
        kg: kg ? Number(kg) : undefined,
        cbm: cbm ? Number(cbm) : undefined,
        valor_fob_usd: valorFob ? Number(valorFob) : undefined,
      });
      setCotizacion(res);
    } catch {
      setCotizacion(null);
    }
  }

  async function onCrearProceso() {
    if (!titulo.trim()) return;
    setMensajeProceso(null);
    try {
      const res = await crearProceso.mutateAsync({
        titulo: titulo.trim(),
        proveedor: proveedor.trim() || undefined,
        aliado_id: aliadoId,
        modo: cotizacion?.modo,
        kg: kg ? Number(kg) : undefined,
        cbm: cbm ? Number(cbm) : undefined,
        valor_fob_usd: valorFob ? Number(valorFob) : undefined,
      });
      const mensaje = (res as { mensaje?: string })?.mensaje;
      setMensajeProceso(mensaje || "Proceso creado.");
      setTitulo("");
      setProveedor("");
    } catch (e) {
      setMensajeProceso(e instanceof Error ? e.message : "No se pudo crear el proceso.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-paper border-2 border-border bg-surface-panel shadow-paper-sm">
          <Icon name="logistica-importaciones" size={28} weight="bold" className="text-accent" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            Logística Internacional
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Importaciones</h1>
          <p className="mt-1 text-sm text-muted">
            Aliados DDP e importación ordinaria, cotizador y seguimiento de procesos.
          </p>
        </div>
      </div>

      {/* Guía de modalidad: DDP vs Ordinaria */}
      {guia && (
        <section className="rounded-paper border-2 border-red-300 bg-red-50 p-6 shadow-paper-sm dark:border-red-700/50 dark:bg-red-950/20">
          <h2 className="text-base font-bold text-ink">⚖️ {guia.titulo}</h2>
          <p className="mt-2 text-sm text-ink-secondary">{guia.resumen}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-paper border border-border bg-surface-panel p-3 text-xs">
              <p className="font-bold text-ink">Usar DDP cuando…</p>
              <ul className="mt-1 space-y-0.5 text-ink-secondary">
                {guia.cuando_usar_ddp.map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-paper border border-border bg-surface-panel p-3 text-xs">
              <p className="font-bold text-ink">Usar Importación Ordinaria cuando…</p>
              <ul className="mt-1 space-y-0.5 text-ink-secondary">
                {guia.cuando_usar_ordinaria.map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 rounded-paper border border-red-300 bg-surface-panel p-3 text-xs dark:border-red-700/50">
            <p className="font-bold text-ink">Riesgos del DDP</p>
            <ul className="mt-1 space-y-0.5 text-ink-secondary">
              {guia.riesgos_ddp.map((x, i) => (
                <li key={i}>⚠️ {x}</li>
              ))}
            </ul>
          </div>

          <p className="mt-3 text-[11px] text-muted">{guia.matiz_importante}</p>
          <p className="mt-2 text-[10px] italic text-muted">{guia.fuente}</p>
        </section>
      )}

      {/* Fichas de aliados */}
      <section className="rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-sm">
        <h2 className="text-base font-bold text-ink">Aliados</h2>

        <div className="mt-4 rounded-paper border border-dashed border-border p-3 text-xs">
          <p className="font-bold text-ink">Glosario — qué significa cada término</p>
          <dl className="mt-2 space-y-1">
            {GLOSARIO.map((g) => (
              <div key={g.termino} className="flex gap-2">
                <dt className="w-20 shrink-0 font-bold text-accent">{g.termino}</dt>
                <dd className="text-ink-secondary">{g.significado}</dd>
              </div>
            ))}
          </dl>
        </div>

        {cargandoAliados ? (
          <p className="mt-4 text-sm text-muted">Cargando aliados…</p>
        ) : (
          <div className="mt-4 space-y-4">
            {aliados.map((a) => (
              <FichaAliado key={a.id} aliado={a} />
            ))}
          </div>
        )}
      </section>

      {/* Cotizador */}
      <section className="rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-sm">
        <h2 className="text-base font-bold text-ink">Cotizador</h2>
        <label className="mt-3 block text-xs text-muted">
          Aliado
          <select
            value={aliadoId}
            onChange={(e) => {
              setAliadoId(e.target.value);
              setCotizacion(null);
            }}
            className="mt-1 w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink sm:w-64"
          >
            {aliados.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre} ({TIPO_MODALIDAD_LABEL[a.tipo_modalidad] ?? a.tipo_modalidad})
              </option>
            ))}
          </select>
        </label>

        {aliadoActivo && !aliadoActivo.tiene_cotizador ? (
          <p className="mt-4 rounded-paper border border-dashed border-border p-3 text-xs text-muted">
            {aliadoActivo.nombre} no tiene tarifas públicas — no hay cotizador automático.{" "}
            {aliadoActivo.nota_tarifas ?? "Solicitar cotización directa."}
          </p>
        ) : (
          <>
            <p className="mt-3 text-xs text-muted">
              Ingresa peso (kg) y/o volumen (CBM) — se recomienda el modo más adecuado.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-muted">
                Peso (kg)
                <input
                  type="number"
                  min="0"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                  className="mt-1 w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
                />
                <span className="mt-0.5 block text-[10px] normal-case text-muted">
                  Peso real de la carga. Usalo para aéreo (≥50 kg) o courier DHL/UPS (&lt;50 kg).
                </span>
              </label>
              <label className="text-xs text-muted">
                Volumen (CBM)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={cbm}
                  onChange={(e) => setCbm(e.target.value)}
                  className="mt-1 w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
                />
                <span className="mt-0.5 block text-[10px] normal-case text-muted">
                  CBM = metro cúbico (largo × ancho × alto en metros). Úsalo para transporte marítimo.
                </span>
              </label>
              <label className="text-xs text-muted">
                Valor FOB (USD)
                <input
                  type="number"
                  min="0"
                  value={valorFob}
                  onChange={(e) => setValorFob(e.target.value)}
                  className="mt-1 w-full rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
                />
                <span className="mt-0.5 block text-[10px] normal-case text-muted">
                  FOB = valor de la mercancía en origen (sin flete ni seguro). Se usa para estimar arancel + IVA.
                </span>
              </label>
            </div>
            <button
              onClick={onCotizar}
              disabled={cotizar.isPending || (!kg && !cbm)}
              className="mt-4 rounded-paper border-2 border-border bg-accent px-4 py-2 text-sm font-bold text-white shadow-paper-sm disabled:opacity-50"
            >
              {cotizar.isPending ? "Cotizando…" : "Cotizar"}
            </button>

            {cotizar.isError && (
              <p className="mt-3 text-xs text-red-600">
                {cotizar.error instanceof Error ? cotizar.error.message : "Error al cotizar."}
              </p>
            )}

            {cotizacion && (
              <div className="mt-4 rounded-paper border border-border p-4 text-sm">
                <p className="font-bold text-ink">
                  Modo recomendado: {cotizacion.modo_nombre} ({cotizacion.cantidad} {cotizacion.unidad})
                </p>
                <p className="mt-1 text-ink-secondary">
                  Costo de transporte estimado: USD {fmtUsd(cotizacion.costo_transporte_usd)}
                </p>
                {cotizacion.dias_transito_min != null && (
                  <p className="text-ink-secondary">
                    Tránsito estimado: {cotizacion.dias_transito_min}-{cotizacion.dias_transito_max} días
                  </p>
                )}
                {cotizacion.arancel_estimado && (
                  <p className="text-ink-secondary">
                    Arancel estimado: {cotizacion.arancel_estimado.arancel_pct ?? "?"}% + IVA{" "}
                    {cotizacion.arancel_estimado.iva_pct ?? "?"}% — {cotizacion.arancel_estimado.nota}
                  </p>
                )}
                {cotizacion.advertencias.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-orange-700 dark:text-orange-300">
                    {cotizacion.advertencias.map((a, i) => (
                      <li key={i}>⚠️ {a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Procesos de importación */}
      <section className="rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold text-ink">Procesos de importación</h2>
          <button
            onClick={() => setPanel("tickets")}
            className="text-xs text-accent underline"
          >
            Ver en Centro de Mando
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Se crea con el aliado seleccionado arriba ({aliadoActivo?.nombre ?? "—"}).
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Título
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Pedido envases 4 CBM — proveedor XYZ"
              className="mt-1 w-64 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            Proveedor (opcional)
            <input
              type="text"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              className="mt-1 w-48 rounded-paper border border-border bg-surface-input px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            onClick={onCrearProceso}
            disabled={crearProceso.isPending || !titulo.trim()}
            className="rounded-paper border-2 border-border bg-accent px-4 py-2 text-sm font-bold text-white shadow-paper-sm disabled:opacity-50"
          >
            {crearProceso.isPending ? "Creando…" : "+ Nuevo proceso"}
          </button>
        </div>
        {mensajeProceso && <p className="mt-2 text-xs text-muted">{mensajeProceso}</p>}

        <ul className="mt-4 space-y-2">
          {(procesosData?.procesos ?? []).length === 0 && (
            <li className="text-sm text-muted">Sin procesos de importación todavía.</li>
          )}
          {(procesosData?.procesos ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-paper border border-border p-3 text-sm"
            >
              <div>
                <p className="font-bold text-ink">
                  #{p.numero} — {p.titulo}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${PRIORIDAD_STYLES[p.prioridad]}`}>
                  {p.prioridad}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${ESTADO_STYLES[p.estado]}`}>
                  {ESTADO_LABEL[p.estado] ?? p.estado}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Histórico de costos reales */}
      <section className="rounded-paper border-2 border-border bg-surface-panel p-6 shadow-paper-sm">
        <h2 className="text-base font-bold text-ink">Histórico de costos reales</h2>
        <p className="mt-1 text-xs text-muted">
          Casos de importación reales (correo, agencias de aduana) para comparar contra el
          cotizador de arriba. No son cotizaciones de un aliado — son lo que McKenna pagó de
          verdad en cada modalidad.
        </p>

        {historico && historico.casos_grandes.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-1.5 pr-2">Producto</th>
                  <th className="py-1.5 pr-2">Origen</th>
                  <th className="py-1.5 pr-2">Modalidad</th>
                  <th className="py-1.5 pr-2">Fecha</th>
                  <th className="py-1.5 pr-2 text-right">Costo real</th>
                  <th className="py-1.5 pr-2 text-right">vs cotizado</th>
                </tr>
              </thead>
              <tbody>
                {historico.casos_grandes.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 align-top">
                    <td className="py-1.5 pr-2 font-medium text-ink">{c.producto}</td>
                    <td className="py-1.5 pr-2 text-ink-secondary">{c.origen}</td>
                    <td className="py-1.5 pr-2 text-ink-secondary">
                      {MODALIDAD_LABEL[c.modalidad] ?? c.modalidad}
                    </td>
                    <td className="py-1.5 pr-2 text-ink-secondary">{c.fecha_apertura}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-secondary">
                      {c.facturado_cop != null ? `$${fmtCop(c.facturado_cop)}` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      {c.variacion_pct != null ? (
                        <span className={c.variacion_pct > 10 ? "font-bold text-orange-600 dark:text-orange-300" : "text-ink-secondary"}>
                          +{c.variacion_pct}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historico && historico.casos_grandes.some((c) => c.incidencias.length > 0) && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold text-ink">Incidencias documentadas</p>
            {historico.casos_grandes
              .filter((c) => c.incidencias.length > 0)
              .map((c) => (
                <div key={c.id} className="rounded-paper border border-border p-2 text-xs">
                  <p className="font-bold text-ink-secondary">{c.producto}</p>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {c.incidencias.map((inc, i) => (
                      <li key={i}>• {inc}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}

        {historico && historico.compras_chicas.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-bold text-ink">
                Compras chicas ya registradas: {historico.compras_chicas.length}
              </p>
              <button
                onClick={() => setPanel("compras-exterior")}
                className="text-xs text-accent underline"
              >
                Ver en Compras Exterior
              </button>
            </div>
            <p className="mt-1 text-[10px] text-muted">
              Paquetes chicos (materia prima, muestras) con costeo landed ya calculado en ese
              panel — no duplicado aquí, solo referenciado. Marca si cada compra fue directa de
              McKenna o comprada por un socio y luego revendida a la empresa (implicación fiscal
              distinta a la importación directa — ver aviso de arriba).
            </p>
            <ul className="mt-3 space-y-1.5">
              {historico.compras_chicas.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-paper border border-border p-2 text-xs"
                >
                  <span className="text-ink-secondary">
                    #{c.id} · {c.proveedor || "sin proveedor"} · {c.fecha_compra || "sin fecha"}
                  </span>
                  <select
                    value={c.comprado_por}
                    onChange={(e) =>
                      marcarCompradoPor.mutate({
                        compraId: c.id,
                        comprado_por: e.target.value as CompradoPor,
                      })
                    }
                    className={`rounded-paper border px-2 py-1 text-[11px] font-bold ${
                      c.comprado_por === "socio"
                        ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700/50 dark:bg-orange-950/30 dark:text-orange-200"
                        : c.comprado_por === "mckenna"
                          ? "border-border bg-surface-input text-ink"
                          : "border-border bg-surface-input text-muted"
                    }`}
                  >
                    <option value="">Sin marcar</option>
                    <option value="mckenna">Compra directa McKenna</option>
                    <option value="socio">Compra de socio (revendida)</option>
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
