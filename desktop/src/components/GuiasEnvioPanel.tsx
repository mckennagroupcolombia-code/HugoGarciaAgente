import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, fetchAuthBlobUrl } from "../api/client";

/**
 * Guías (rótulos) de envío para la impresora térmica Vretti.
 *
 * Sustituye el formato en Excel/Word: se eligen los pedidos ya registrados
 * (tienda web / WhatsApp), se genera un PDF de 10x15 cm — una página por
 * paquete — y se manda a la térmica. Cada rótulo queda registrado, así que el
 * conteo del día sirve para la casilla "envíos" de Operativos → Mensajería.
 */

type Pedido = {
  canal: "web" | "whatsapp";
  pedido_id: string;
  fecha: string;
  estado: string;
  nombre: string;
  documento: string;
  telefono: string;
  direccion: string;
  ciudad: string;
  departamento: string;
  observaciones: string;
  contenido: string[];
  valor_declarado: number;
  guia: string;
  transportadora: string;
  listo: boolean;
};

type Remitente = {
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  nota: string;
};

type RotuloHist = {
  id: number;
  canal: string;
  pedido_id: string;
  destinatario: string;
  ciudad: string;
  guia: string;
  copias: number;
  creado_en: string;
};

const TAMANOS = [
  { id: "10x15", label: "10 x 15 cm (rollo Vretti)" },
  { id: "10x10", label: "10 x 10 cm" },
  { id: "5x7.5", label: "5 x 7,5 cm" },
];

const CANAL_LABEL: Record<string, string> = {
  web: "Página web",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

const MANUAL_VACIO = {
  nombre: "",
  documento: "",
  telefono: "",
  direccion: "",
  ciudad: "",
  departamento: "",
  observaciones: "",
  contenido: "",
  piezas: "1",
  peso_kg: "",
  valor_declarado: "",
  guia: "",
  transportadora: "Interrapidísimo",
};

export default function GuiasEnvioPanel() {
  const qc = useQueryClient();
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [tamano, setTamano] = useState("10x15");
  const [copias, setCopias] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<"pedidos" | "manual" | "ajustes">("pedidos");
  const [manual, setManual] = useState({ ...MANUAL_VACIO });
  const [remitenteForm, setRemitenteForm] = useState<Remitente | null>(null);

  const pedidosQ = useQuery<{ pedidos: Pedido[]; total: number; sin_direccion: number }>({
    queryKey: ["guias-pedidos", busqueda],
    queryFn: () => api.get(`/api/guias/pedidos?dias=15&q=${encodeURIComponent(busqueda)}`),
    refetchInterval: 120_000,
  });
  const remitenteQ = useQuery<{ remitente: Remitente }>({
    queryKey: ["guias-remitente"],
    queryFn: () => api.get("/api/guias/remitente"),
  });
  const histQ = useQuery<{ rotulos: RotuloHist[] }>({
    queryKey: ["guias-historial"],
    queryFn: () => api.get("/api/guias/historial?dias=15"),
  });

  const abrirPdf = async (url: string) => {
    const blob = await fetchAuthBlobUrl(url);
    if (blob) window.open(blob, "_blank", "noopener");
    else setError("No se pudo abrir el PDF de los rótulos");
  };

  const crearMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string; pdf_url?: string; ids?: number[] }>(
        "/api/guias/rotulos",
        body,
      ),
    onSuccess: async (r) => {
      if (r.error || !r.pdf_url) return setError(r.error || "No se pudo generar");
      setMsg(`${r.ids?.length ?? 0} rótulo(s) listos — se abre el PDF para imprimir`);
      setSeleccion([]);
      void qc.invalidateQueries({ queryKey: ["guias-historial"] });
      await abrirPdf(r.pdf_url);
    },
    onError: (e) => setError((e as Error).message || "No se pudo generar"),
  });

  const remitenteMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok?: boolean; error?: string }>("/api/guias/remitente", body),
    onSuccess: (r) => {
      if (r.error) return setError(r.error);
      setMsg("Datos del remitente guardados");
      void qc.invalidateQueries({ queryKey: ["guias-remitente"] });
    },
    onError: (e) => setError((e as Error).message || "No se pudo guardar"),
  });

  const pedidos = pedidosQ.data?.pedidos ?? [];
  const clave = (p: Pedido) => `${p.canal}:${p.pedido_id}`;
  const listos = useMemo(() => pedidos.filter((p) => p.listo), [pedidos]);
  const remitente = remitenteQ.data?.remitente;

  const toggle = (k: string) =>
    setSeleccion((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const generarDePedidos = () => {
    setError(null);
    setMsg(null);
    crearMut.mutate({
      pedidos: seleccion.map((k) => {
        const [canal, ...resto] = k.split(":");
        return { canal, id: resto.join(":") };
      }),
      copias,
      tamano,
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Guías de envío</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Elige los pedidos que salen hoy y genera los rótulos: un PDF de{" "}
            {TAMANOS.find((t) => t.id === tamano)?.label.split(" (")[0]} con una página por
            paquete, listo para la impresora térmica. Ya no hay que llenar el formato en
            Excel/Word.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-panel p-1">
          {(["pedidos", "manual", "ajustes"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setError(null);
                setMsg(null);
                setModo(m);
                if (m === "ajustes" && remitente && !remitenteForm) setRemitenteForm({ ...remitente });
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                modo === m ? "bg-accent text-white" : "text-muted hover:bg-surface"
              }`}
            >
              {m === "pedidos" ? "Desde pedidos" : m === "manual" ? "Envío suelto" : "Remitente"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-panel p-3">
        <label className="block text-xs">
          <span className="font-bold text-muted">Tamaño del rollo</span>
          <select
            value={tamano}
            onChange={(e) => setTamano(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          >
            {TAMANOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="font-bold text-muted">Copias por paquete</span>
          <input
            type="number"
            min={1}
            max={5}
            value={copias}
            onChange={(e) => setCopias(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="mt-1 w-24 rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
          />
        </label>
        <p className="flex-1 text-[11px] text-muted">
          Al imprimir elige la <strong>Vretti</strong> y en «Escala» deja{" "}
          <strong>Tamaño real / 100 %</strong>; si sale corrido, revisa que el papel del driver
          también sea {tamano.replace("x", " x ")} cm.
        </p>
      </div>

      {msg && <p className="text-xs font-semibold text-emerald-600">{msg}</p>}
      {error && <p className="text-xs font-semibold text-danger">{error}</p>}

      {modo === "pedidos" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por pedido, cliente o ciudad…"
              className="w-64 rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-ink"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSeleccion(seleccion.length === listos.length ? [] : listos.map(clave))
                }
                className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-ink hover:bg-surface"
              >
                {seleccion.length === listos.length && listos.length > 0
                  ? "Quitar todos"
                  : "Marcar todos"}
              </button>
              <button
                type="button"
                disabled={crearMut.isPending || seleccion.length === 0}
                onClick={generarDePedidos}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {crearMut.isPending
                  ? "Generando…"
                  : `Imprimir ${seleccion.length || ""} rótulo(s)`}
              </button>
            </div>
          </div>

          {(pedidosQ.data?.sin_direccion ?? 0) > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              {pedidosQ.data?.sin_direccion} pedido(s) no tienen dirección o ciudad completas: no
              se pueden rotular hasta completarlos (o hazlos por «Envío suelto»).
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2 font-bold">Pedido</th>
                  <th className="px-3 py-2 font-bold">Destinatario</th>
                  <th className="px-3 py-2 font-bold">Dirección</th>
                  <th className="px-3 py-2 font-bold">Ciudad</th>
                  <th className="px-3 py-2 font-bold">Canal</th>
                </tr>
              </thead>
              <tbody>
                {pedidosQ.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-muted">
                      Cargando pedidos…
                    </td>
                  </tr>
                )}
                {!pedidosQ.isLoading && pedidos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-muted">
                      No hay pedidos por despachar en los últimos 15 días.
                    </td>
                  </tr>
                )}
                {pedidos.map((p) => {
                  const k = clave(p);
                  return (
                    <tr
                      key={k}
                      className={`border-t border-border/60 ${p.listo ? "" : "opacity-50"}`}
                    >
                      <td className="px-2 py-2">
                        {p.listo && (
                          <input
                            type="checkbox"
                            checked={seleccion.includes(k)}
                            onChange={() => toggle(k)}
                            aria-label={`Seleccionar ${p.pedido_id}`}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-ink">{p.pedido_id}</span>
                        <span className="block text-[10px] text-muted">{p.fecha}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-ink">{p.nombre || "—"}</span>
                        <span className="block text-[10px] text-muted">{p.telefono}</span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2 text-muted">
                        {p.direccion || <span className="text-danger">Sin dirección</span>}
                      </td>
                      <td className="px-3 py-2 font-semibold text-ink">
                        {p.ciudad || <span className="text-danger">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted">{CANAL_LABEL[p.canal] || p.canal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modo === "manual" && (
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface-panel p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMsg(null);
            crearMut.mutate({
              manual: {
                ...manual,
                piezas: Number(manual.piezas || 1),
                valor_declarado: Number(manual.valor_declarado || 0),
              },
              copias,
              tamano,
            });
          }}
        >
          <Campo label="Nombre del destinatario">
            <input
              required
              value={manual.nombre}
              onChange={(e) => setManual((m) => ({ ...m, nombre: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Teléfono">
            <input
              value={manual.telefono}
              onChange={(e) => setManual((m) => ({ ...m, telefono: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Dirección" className="sm:col-span-2">
            <input
              required
              value={manual.direccion}
              onChange={(e) => setManual((m) => ({ ...m, direccion: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Ciudad">
            <input
              required
              value={manual.ciudad}
              onChange={(e) => setManual((m) => ({ ...m, ciudad: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Departamento">
            <input
              value={manual.departamento}
              onChange={(e) => setManual((m) => ({ ...m, departamento: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="CC / NIT">
            <input
              value={manual.documento}
              onChange={(e) => setManual((m) => ({ ...m, documento: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Nº de guía (si ya la tienes)">
            <input
              value={manual.guia}
              onChange={(e) => setManual((m) => ({ ...m, guia: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Indicaciones para el mensajero" className="sm:col-span-2">
            <input
              value={manual.observaciones}
              onChange={(e) => setManual((m) => ({ ...m, observaciones: e.target.value }))}
              placeholder="Barrio, conjunto, torre/apto, punto de referencia"
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Contenido (una línea por producto)" className="sm:col-span-2">
            <textarea
              rows={3}
              value={manual.contenido}
              onChange={(e) => setManual((m) => ({ ...m, contenido: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Piezas">
            <input
              type="number"
              min={1}
              value={manual.piezas}
              onChange={(e) => setManual((m) => ({ ...m, piezas: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <Campo label="Valor declarado (opcional)">
            <input
              type="number"
              min={0}
              value={manual.valor_declarado}
              onChange={(e) => setManual((m) => ({ ...m, valor_declarado: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
            />
          </Campo>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={crearMut.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {crearMut.isPending ? "Generando…" : "Generar rótulo"}
            </button>
            <button
              type="button"
              onClick={() => setManual({ ...MANUAL_VACIO })}
              className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted"
            >
              Limpiar
            </button>
          </div>
        </form>
      )}

      {modo === "ajustes" && (
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface-panel p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMsg(null);
            if (remitenteForm) remitenteMut.mutate({ ...remitenteForm });
          }}
        >
          <p className="text-xs text-muted sm:col-span-2">
            Estos datos salen en la parte de abajo de cada rótulo. Complétalos una vez (NIT,
            dirección y teléfono de McKenna) y quedan para todos los envíos.
          </p>
          {(
            [
              ["nombre", "Razón social"],
              ["nit", "NIT"],
              ["direccion", "Dirección"],
              ["ciudad", "Ciudad"],
              ["telefono", "Teléfono"],
              ["correo", "Correo"],
              ["nota", "Línea descriptiva"],
            ] as const
          ).map(([campo, label]) => (
            <Campo key={campo} label={label}>
              <input
                value={(remitenteForm ?? remitente)?.[campo] ?? ""}
                onChange={(e) =>
                  setRemitenteForm((f) => ({
                    ...((f ?? remitente) as Remitente),
                    [campo]: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-border bg-surface-input px-2 py-2 text-sm text-ink"
              />
            </Campo>
          ))}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={remitenteMut.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {remitenteMut.isPending ? "Guardando…" : "Guardar remitente"}
            </button>
          </div>
        </form>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
          Rótulos impresos (15 días)
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-border bg-surface text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-bold">Fecha</th>
                <th className="px-3 py-2 font-bold">Pedido</th>
                <th className="px-3 py-2 font-bold">Destinatario</th>
                <th className="px-3 py-2 font-bold">Ciudad</th>
                <th className="px-3 py-2 font-bold">Copias</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(histQ.data?.rotulos ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-muted">
                    Todavía no se ha impreso ningún rótulo.
                  </td>
                </tr>
              )}
              {(histQ.data?.rotulos ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-3 py-2 tabular-nums text-muted">{r.creado_en}</td>
                  <td className="px-3 py-2 font-semibold text-ink">{r.pedido_id || "—"}</td>
                  <td className="px-3 py-2 text-ink">{r.destinatario}</td>
                  <td className="px-3 py-2 text-muted">{r.ciudad}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">{r.copias}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        void abrirPdf(`/api/guias/rotulos.pdf?ids=${r.id}&tamano=${tamano}`)
                      }
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Reimprimir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Campo({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className ?? ""}`}>
      <span className="font-bold text-muted">{label}</span>
      {children}
    </label>
  );
}
