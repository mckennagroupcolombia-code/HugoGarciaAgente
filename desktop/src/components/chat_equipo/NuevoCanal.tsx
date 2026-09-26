import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useUsuariosEquipo } from "../../hooks/useConversaciones";
import type { CanalEquipo, RespCanalesEquipo } from "../../hooks/useCanalesEquipo";

/** Crear un canal (supervisión / administración). Opcionalmente enlazado a un grupo oficial de WhatsApp. */
export default function NuevoCanal({
  grupos, onCreado, onCancelar,
}: {
  grupos: RespCanalesEquipo["grupos_wa"];
  onCreado: (c: CanalEquipo) => void;
  onCancelar: () => void;
}) {
  const qc = useQueryClient();
  const usuarios = useUsuariosEquipo();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [waJid, setWaJid] = useState("");
  const [espejo, setEspejo] = useState(false);
  const [miembros, setMiembros] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    setGuardando(true);
    setError(null);
    try {
      const c = await api.post<CanalEquipo>("/api/canales", { nombre, descripcion, wa_jid: waJid, espejo_salida: espejo, miembros });
      await qc.invalidateQueries({ queryKey: ["canales-equipo"] });
      onCreado(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const lista = (usuarios.data ?? []) as { id: number; nombre: string; activo?: number | boolean }[];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-4">
      <h3 className="text-[15px] font-bold text-ink">Nuevo canal del equipo</h3>
      <label className="text-[12px] text-ink">
        Nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Bodega y llegadas"
          className="mt-1 w-full rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
      </label>
      <label className="text-[12px] text-ink">
        Para qué es
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Lo que llega, fotos y cantidades"
          className="mt-1 w-full rounded-md border border-border bg-surface-input px-2 py-1.5 text-[13px]" />
      </label>
      <div className="rounded-lg border border-border bg-surface-input p-3">
        <p className="text-[12px] font-bold text-ink">Enlazar a un grupo de WhatsApp (transición)</p>
        <p className="text-[11px] text-ink-secondary">Mientras el equipo se pasa al panel, lo que se escriba en ese grupo aparece aquí.</p>
        <select value={waJid} onChange={(e) => setWaJid(e.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px]">
          <option value="">Sin enlazar</option>
          {grupos.map((g) => (
            <option key={g.jid} value={g.jid} disabled={g.enlazado}>{g.nombre}{g.enlazado ? " (ya enlazado)" : ""}</option>
          ))}
        </select>
        {waJid && (
          <label className="mt-2 flex items-start gap-2 text-[12px] text-ink">
            <input type="checkbox" checked={espejo} onChange={(e) => setEspejo(e.target.checked)} className="mt-0.5" />
            <span>También enviar al grupo lo que se escriba en el panel (con el nombre de quien lo escribe).</span>
          </label>
        )}
      </div>
      <div>
        <p className="text-[12px] font-bold text-ink">Miembros</p>
        <p className="text-[11px] text-ink-secondary">Si no marcas a nadie, el canal es de todo el equipo.</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {lista.filter((u) => u.activo !== 0 && u.activo !== false).map((u) => {
            const on = miembros.includes(u.id);
            return (
              <button key={u.id} type="button"
                onClick={() => setMiembros(on ? miembros.filter((x) => x !== u.id) : [...miembros, u.id])}
                aria-pressed={on}
                className={`rounded-full border px-2 py-0.5 text-[11.5px] ${on ? "border-accent bg-accent text-white" : "border-border bg-surface-input text-ink"}`}>
                {u.nombre}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-[12px] text-accent-rose">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void crear()} disabled={!nombre.trim() || guardando}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
          {guardando ? "Creando…" : "Crear canal"}
        </button>
        <button onClick={onCancelar} className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-ink">Cancelar</button>
      </div>
    </div>
  );
}
