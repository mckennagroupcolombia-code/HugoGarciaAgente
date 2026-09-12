import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";

/**
 * Explicación viva del esquema de socios, familiares y terceros.
 *
 * Existe porque este esquema no se deduce mirando los asientos: hay que saber
 * que el socio compra con su tarjeta personal, que la mercancía llega a su
 * nombre y que por eso el banco de McKenna no se mueve hasta el reintegro. Sin
 * esa explicación a la mano, alguien "corrige" el asiento y vuelve a romper la
 * conciliación.
 *
 * Los números salen en vivo del Libro Mayor; el texto es fijo.
 */

type MedioPago = { id: number; nombre: string; cuenta_id: number; activo: number };

type SaldoSocio = {
  tercero_id: number;
  nombre: string;
  identificacion: string;
  saldo: number;
  cargado: number;
  abonado: number;
  movimientos: number;
};

type Saldos = {
  socios: Array<{ tercero: string; identificacion: string; saldo: number }>;
  retencion_por_pagar: number;
  periodo_retencion?: {
    periodo: string;
    total_retencion: number;
    por_concepto: Record<string, number>;
    vencimiento: { conocido: boolean; fecha?: string; dias_restantes?: number; estado: string; motivo?: string };
  };
  uvt?: number | null;
  minimos?: Array<{ concepto: string; tarifa_declarante_pct: number; tarifa_no_declarante_pct: number; minimo_uvt: number; minimo_cop: number | null; norma: string }>;
};

function cop(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function EsquemaTercerosPanel() {
  const q = useQuery<Saldos>({
    queryKey: ["esquema-terceros"],
    queryFn: () => api.get("/api/contabilidad/esquema-terceros"),
  });
  const d = q.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h2 className="text-base font-bold text-ink">Cómo funciona el esquema</h2>
        <p className="mt-1 text-xs text-muted">
          Quién es quién alrededor de McKenna y cómo queda cada operación en la contabilidad.
          Los saldos salen en vivo del Libro Mayor.
        </p>
      </header>

      <Bloque titulo="Las cuatro relaciones">
        <table className="min-w-full text-left text-[11px]">
          <thead className="text-[10px] uppercase text-muted">
            <tr>
              <th className="py-1 pr-3 font-bold">Quién</th>
              <th className="py-1 pr-3 font-bold">Qué hace</th>
              <th className="py-1 font-bold">Cuenta</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {[
              ["Socios (Armando, Cynthia)", "Compran en Amazon u otros comercios de EEUU con su tarjeta personal. La mercancía llega a su nombre y se la entregan a la empresa para venderla.", "2380"],
              ["Socios", "Cobran una cuota de manejo por conseguir esa mercancía (5-10% según la compra).", "2380 contra costo"],
              ["Familiares por servicios", "Prestan servicios a la empresa y reciben pago.", "5135"],
              ["Familiares prestamistas", "Consignaron dinero a la cuenta de la empresa como préstamo.", "2295"],
            ].map(([quien, que, cuenta]) => (
              <tr key={quien} className="border-t border-border/40">
                <td className="py-1.5 pr-3 font-bold text-ink">{quien}</td>
                <td className="py-1.5 pr-3 text-muted">{que}</td>
                <td className="py-1.5 font-mono text-accent">{cuenta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Bloque>

      <Bloque titulo="Por qué el banco no se mueve al comprar" tono="acento">
        <p className="text-[11px] leading-relaxed text-ink">
          La plata de la compra sale de la <strong>tarjeta personal del socio</strong>, no de la
          cuenta de McKenna. El banco de la empresa se mueve <strong>después</strong>, cuando se le
          reintegra. Por eso la compra se registra como una <strong>deuda con el socio (2380)</strong> y
          no como una salida de Bancos.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Registrarlo contra Bancos —como se hacía hasta septiembre de 2026— acreditaba una cuenta
          que no se había movido, y hacía imposible cuadrar el extracto: la línea real del banco es
          el reintegro, en otra fecha y por el neto.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 text-[10px] leading-relaxed text-ink">{`Al comprar (no se mueve el banco)
  Débito   1435  Inventarios - Mercancías     mercancía + flete + cuota
      Crédito  2365  Retención en la fuente   si supera la cuantía mínima
      Crédito  2380  Por pagar al socio       el neto

Al reintegrar (esta es la línea del extracto)
  Débito   2380  Por pagar al socio           el neto
      Crédito  1110  Bancos                   el neto`}</pre>
      </Bloque>

      <Bloque titulo="Límite aduanero — qué NO se puede hacer" tono="alerta">
        <p className="text-[11px] leading-relaxed text-ink">
          Esa mercancía <strong>no entró por importación ordinaria</strong>: llegó a nombre de una
          persona natural, por una modalidad pensada para uso personal y no para reventa comercial.
          De ahí se derivan tres límites:
        </p>
        <ul className="mt-2 space-y-1 text-[11px] text-muted">
          <li>• <strong className="text-ink">No hay IVA descontable.</strong> Nace de una factura o de una declaración de importación (Art. 485 E.T.), y McKenna no tiene ninguna a su nombre.</li>
          <li>• <strong className="text-ink">No se deducen aranceles</strong> que la empresa no pagó ni puede soportar.</li>
          <li>• <strong className="text-ink">El documento soporte no sanea el estatus aduanero.</strong> Soporta la compra al socio para renta; no convierte en legalmente importada la mercancía.</li>
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Revender por esta vía puede configurar infracción aduanera con aprehensión y decomiso
          (Decreto 1165 de 2019) y, pasados ciertos umbrales de valor, contrabando (Arts. 319 y 320
          C.P., Ley 1762 de 2015). La contabilidad no arregla eso: solo lo refleja con fidelidad.
          Lo único que lo resuelve es <strong>formalizar la importación</strong> cuando el volumen lo
          justifique — por eso el mecanismo se planteó residual y temporal.
        </p>
      </Bloque>

      <Bloque titulo="Cuándo se retiene y cuándo no">
        <p className="text-[11px] leading-relaxed text-muted">
          No toda operación lleva retención: hay una <strong>cuantía mínima</strong> por concepto.
          Retener por debajo del tope es tan incorrecto como no retener por encima.
          {d?.uvt ? <> UVT vigente: <strong className="text-ink">{cop(d.uvt)}</strong>.</> : null}
        </p>
        {d?.minimos && (
          <table className="mt-2 min-w-full text-left text-[11px]">
            <thead className="text-[10px] uppercase text-muted">
              <tr>
                <th className="py-1 pr-3 font-bold">Concepto</th>
                <th className="py-1 pr-3 text-right font-bold">Declarante</th>
                <th className="py-1 pr-3 text-right font-bold">No declarante</th>
                <th className="py-1 pr-3 text-right font-bold">Desde</th>
                <th className="py-1 font-bold">Norma</th>
              </tr>
            </thead>
            <tbody>
              {d.minimos.map((m) => (
                <tr key={m.concepto} className="border-t border-border/40">
                  <td className="py-1 pr-3 text-ink">{m.concepto.replace(/_/g, " ")}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{m.tarifa_declarante_pct}%</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{m.tarifa_no_declarante_pct}%</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {m.minimo_uvt > 0 ? `${m.minimo_uvt} UVT · ${m.minimo_cop ? cop(m.minimo_cop) : "—"}` : "sin mínimo"}
                  </td>
                  <td className="py-1 text-muted">{m.norma}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Bloque>

      <Bloque titulo="Situación actual">
        {q.isLoading && <p className="text-xs text-muted">Cargando…</p>}
        {d && (
          <div className="space-y-3">
            <ReintegroSocios />

            {d.periodo_retencion && d.periodo_retencion.total_retencion > 0 && (
              <VencimientoRetencion p={d.periodo_retencion} />
            )}
          </div>
        )}
      </Bloque>
    </div>
  );
}

function VencimientoRetencion({ p }: { p: NonNullable<Saldos["periodo_retencion"]> }) {
  const v = p.vencimiento;
  const tono = !v.conocido
    ? "bg-amber-500/10 text-amber-600"
    : v.estado === "vencido" || v.estado === "hoy"
      ? "bg-red-500/15 text-red-500"
      : v.estado === "proximo"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-emerald-500/10 text-emerald-600";
  return (
    <div className={`rounded-lg px-3 py-2 text-[11px] ${tono}`}>
      <p>
        <strong>Retención por declarar del período {p.periodo}: {cop(p.total_retencion)}</strong>
        {" · "}
        {Object.entries(p.por_concepto).map(([c, v2]) => `${c.replace(/_/g, " ")} ${cop(v2)}`).join(" · ")}
      </p>
      <p className="mt-1">
        {v.conocido
          ? `Vence ${v.fecha} — quedan ${v.dias_restantes} día(s).`
          : v.motivo ?? "Vencimiento no confirmado."}
      </p>
    </div>
  );
}

function Bloque({
  titulo, children, tono,
}: { titulo: string; children: ReactNode; tono?: "acento" | "alerta" }) {
  const borde =
    tono === "alerta" ? "border-amber-500/40" : tono === "acento" ? "border-accent/40" : "border-border";
  return (
    <section className={`rounded-xl border ${borde} bg-surface-panel p-4`}>
      <h3 className="mb-2 text-sm font-bold text-ink">{titulo}</h3>
      {children}
    </section>
  );
}


/**
 * Reintegro al socio: el giro que extingue la deuda de 2380.
 *
 * Es **la línea que aparece en el extracto bancario** — la compra no, porque
 * salió de la tarjeta personal del socio. Por eso este es el único momento en
 * que el banco de McKenna se acredita, y el único que se concilia.
 */
function ReintegroSocios() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const saldosQ = useQuery<{ socios: SaldoSocio[] }>({
    queryKey: ["socios-saldos"],
    queryFn: () => api.get("/api/socios/saldos"),
  });
  const mediosQ = useQuery<{ medios_pago: MedioPago[] }>({
    queryKey: ["cc-medios-pago"],
    queryFn: () => api.get("/api/contabilidad/cc/medios-pago"),
  });
  const medios = (mediosQ.data?.medios_pago ?? []).filter((m) => m.activo);
  const socios = saldosQ.data?.socios ?? [];

  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-muted">McKenna le debe a los socios</p>
      {msg && (
        <p className={`mt-1 rounded-lg px-3 py-2 text-[11px] font-bold ${
          msg.tipo === "ok" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
        }`}>{msg.texto}</p>
      )}
      <table className="mt-1 min-w-full text-left text-[11px]">
        <tbody>
          {socios.map((s) => (
            <tr key={s.tercero_id} className="border-t border-border/40">
              <td className="py-1.5 pr-3 text-ink">{s.nombre}</td>
              <td className="py-1.5 pr-3 text-muted">{s.identificacion}</td>
              <td className="py-1.5 pr-3 text-right text-[10px] text-muted">
                {s.movimientos} mov · abonado {cop(s.abonado)}
              </td>
              <td className="py-1.5 pr-3 text-right font-bold tabular-nums text-accent">{cop(s.saldo)}</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => setAbierto(abierto === s.tercero_id ? null : s.tercero_id)}
                  className="rounded-lg border border-accent px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent hover:text-white"
                >
                  {abierto === s.tercero_id ? "Cancelar" : "Reintegrar"}
                </button>
              </td>
            </tr>
          ))}
          {!socios.length && (
            <tr><td className="py-1 text-muted">Sin saldos pendientes.</td></tr>
          )}
        </tbody>
      </table>

      {socios.map((s) =>
        abierto === s.tercero_id ? (
          <FormReintegro
            key={s.tercero_id}
            socio={s}
            medios={medios}
            onCerrar={() => setAbierto(null)}
            onHecho={(texto) => {
              setMsg({ tipo: "ok", texto });
              setAbierto(null);
              void qc.invalidateQueries({ queryKey: ["socios-saldos"] });
              void qc.invalidateQueries({ queryKey: ["esquema-terceros"] });
              void qc.invalidateQueries({ queryKey: ["cc-movimientos"] });
            }}
            onError={(texto) => setMsg({ tipo: "error", texto })}
          />
        ) : null,
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-muted">
        Este giro es <strong>la línea que cuadra contra el extracto bancario</strong>. La compra no
        aparece en el banco porque salió de la tarjeta del socio. La retención, cuando aplicó, ya se
        descontó al registrar la compra — el saldo de arriba es el neto a girar.
      </p>
    </div>
  );
}

function FormReintegro({
  socio, medios, onCerrar, onHecho, onError,
}: {
  socio: SaldoSocio;
  medios: MedioPago[];
  onCerrar: () => void;
  onHecho: (texto: string) => void;
  onError: (texto: string) => void;
}) {
  const [f, setF] = useState({
    monto: String(Math.round(socio.saldo)),
    fecha: new Date().toISOString().slice(0, 10),
    medio_pago_id: "",
    referencia: "",
    permitir_exceso: false,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const mut = useMutation({
    mutationFn: () =>
      api.post<{ ok?: boolean; error?: string; saldo_nuevo?: number; movimiento_id_conciliacion?: string }>(
        "/api/socios/reintegro",
        {
          tercero_id: socio.tercero_id,
          monto: parseFloat(f.monto.replace(",", ".")) || 0,
          fecha: f.fecha,
          medio_pago_id: Number(f.medio_pago_id),
          referencia: f.referencia.trim(),
          permitir_exceso: f.permitir_exceso,
        },
      ),
    onSuccess: (r) => {
      if (r.error) return onError(r.error);
      onHecho(
        `Reintegro registrado — saldo de ${socio.nombre}: ${cop(r.saldo_nuevo ?? 0)}. ` +
        `Concilia en el extracto como ${r.movimiento_id_conciliacion}.`,
      );
    },
    onError: (e) => onError((e as Error).message),
  });

  const monto = parseFloat(f.monto.replace(",", ".")) || 0;
  const excede = monto > socio.saldo + 0.01;

  return (
    <form
      className="mt-2 space-y-2 rounded-lg border border-accent/40 bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.medio_pago_id) return onError("Selecciona el medio de pago");
        mut.mutate();
      }}
    >
      <p className="text-[11px] font-bold text-ink">
        Reintegrar a {socio.nombre} — se le deben {cop(socio.saldo)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-bold text-muted">
          Monto
          <input
            type="number" min="0" step="1000" required value={f.monto}
            onChange={(e) => set("monto", e.target.value)}
            className="mt-0.5 block w-32 rounded border border-border bg-surface-input px-2 py-1 text-[11px] text-ink"
          />
        </label>
        <label className="text-[10px] font-bold text-muted">
          Fecha del giro
          <input
            type="date" required value={f.fecha} onChange={(e) => set("fecha", e.target.value)}
            className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-[11px] text-ink"
          />
        </label>
        <label className="text-[10px] font-bold text-muted">
          Medio de pago
          <select
            required value={f.medio_pago_id} onChange={(e) => set("medio_pago_id", e.target.value)}
            className="mt-0.5 block rounded border border-border bg-surface-input px-2 py-1 text-[11px] text-ink"
          >
            <option value="">Selecciona…</option>
            {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold text-muted">
          Referencia
          <input
            value={f.referencia} onChange={(e) => set("referencia", e.target.value)}
            placeholder="N° de transferencia"
            className="mt-0.5 block w-36 rounded border border-border bg-surface-input px-2 py-1 text-[11px] text-ink"
          />
        </label>
        <button
          type="submit" disabled={mut.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
        >
          {mut.isPending ? "…" : "Registrar giro"}
        </button>
        <button type="button" onClick={onCerrar} className="px-1 text-[11px] text-muted">✕</button>
      </div>

      {excede && (
        <label className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600">
          <input
            type="checkbox" checked={f.permitir_exceso}
            onChange={(e) => set("permitir_exceso", e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          <span>
            El giro supera lo adeudado en {cop(monto - socio.saldo)}. Quedaría como anticipo y el
            socio le deberá a la empresa — marca la casilla si es a propósito.
          </span>
        </label>
      )}
    </form>
  );
}
