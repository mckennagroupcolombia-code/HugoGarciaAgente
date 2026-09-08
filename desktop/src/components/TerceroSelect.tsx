import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

type TipoTercero = "proveedor" | "cliente" | "socio" | "empleado" | "otro";
type TipoPersona = "natural" | "juridica";
type TerceroMin = { id: number; nombre: string; tipo: TipoTercero; activo: number };

const TODOS_LOS_TIPOS: TipoTercero[] = ["proveedor", "cliente", "socio", "empleado", "otro"];

/**
 * Select de terceros con un botón "+ Nuevo" al lado: si el tercero que
 * necesitas (quien presta, un proveedor persona natural que hace un
 * servicio…) todavía no existe, lo creas ahí mismo sin perder lo que ya
 * habías llenado en el formulario donde vive este selector.
 */
export default function TerceroSelect({
  value,
  onChange,
  label = "Tercero",
  tiposPermitidos,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  tiposPermitidos?: TipoTercero[];
}) {
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({
    nombre: "",
    tipo: (tiposPermitidos?.[0] ?? "proveedor") as TipoTercero,
    tipo_persona: "juridica" as TipoPersona,
    identificacion: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const tercerosQ = useQuery<{ terceros: TerceroMin[] }>({
    queryKey: ["cc-terceros-select"],
    queryFn: () => api.get("/api/contabilidad/cc/terceros?activos=1"),
  });

  const crearMut = useMutation({
    mutationFn: () =>
      api.post<TerceroMin>("/api/contabilidad/cc/terceros", {
        nombre: nuevo.nombre.trim(),
        tipo: nuevo.tipo,
        tipo_persona: nuevo.tipo_persona,
        identificacion: nuevo.identificacion.trim(),
      }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["cc-terceros-select"] });
      void qc.invalidateQueries({ queryKey: ["cc-terceros"] });
      onChange(String(t.id));
      setCreando(false);
      setNuevo({ nombre: "", tipo: tiposPermitidos?.[0] ?? "proveedor", tipo_persona: "juridica", identificacion: "" });
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message || "No se pudo crear"),
  });

  const terceros = (tercerosQ.data?.terceros ?? []).filter(
    (t) => t.activo && (!tiposPermitidos || tiposPermitidos.includes(t.tipo)),
  );

  return (
    <div className="space-y-1.5">
      <label className="block space-y-1 text-xs font-semibold text-ink-secondary">
        {label}
        <div className="flex gap-1.5">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">Selecciona…</option>
            {terceros.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreando((v) => !v)}
            className="shrink-0 rounded-lg border-2 border-border px-2 text-xs font-bold text-ink hover:border-accent hover:text-accent"
            title="Crear un tercero nuevo"
          >
            + Nuevo
          </button>
        </div>
      </label>

      {creando && (
        <div className="space-y-2 rounded-lg border border-dashed border-accent/50 bg-accent/5 p-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Nombre"
              className="rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-xs text-ink"
            />
            <select
              value={nuevo.tipo}
              onChange={(e) => setNuevo((f) => ({ ...f, tipo: e.target.value as TipoTercero }))}
              className="rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-xs text-ink"
            >
              {(tiposPermitidos ?? TODOS_LOS_TIPOS).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={nuevo.tipo_persona}
              onChange={(e) => setNuevo((f) => ({ ...f, tipo_persona: e.target.value as TipoPersona }))}
              className="rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-xs text-ink"
            >
              <option value="juridica">Persona jurídica (NIT)</option>
              <option value="natural">Persona natural (cédula)</option>
            </select>
            <input
              value={nuevo.identificacion}
              onChange={(e) => setNuevo((f) => ({ ...f, identificacion: e.target.value }))}
              placeholder={nuevo.tipo_persona === "natural" ? "Cédula" : "NIT"}
              className="rounded-lg border-2 border-border bg-surface-panel px-2 py-1.5 text-xs text-ink"
            />
          </div>
          {err && <p className="text-[11px] font-semibold text-danger">{err}</p>}
          <button
            type="button"
            disabled={!nuevo.nombre.trim() || crearMut.isPending}
            onClick={() => crearMut.mutate()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            {crearMut.isPending ? "Creando…" : "Crear y seleccionar"}
          </button>
        </div>
      )}
    </div>
  );
}
