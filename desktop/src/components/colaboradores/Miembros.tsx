/**
 * Quién está en el proyecto (3-oct-2026). Un proyecto nace PERSONAL (solo su dueño) y se comparte
 * invitando: cualquier anfitrión —alguien de la casa con el permiso `colaboradores`— invita a quien
 * quiera; el invitado recibe acceso al panel y ve SOLO los proyectos donde está. El dueño saca gente;
 * los demás pueden salirse. Un colaborador externo no invita. Backend: colaboradores.agregar_miembro.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { MINI } from "./campos";
import type { Miembro } from "./modelo";
import { Sprite } from "./pixel";

type Invitable = { id: number; nombre: string; externo: boolean };

export function resumenMiembros(ms: Miembro[] | undefined, yoId: number): string {
  const otros = (ms ?? []).filter((m) => m.id !== yoId).map((m) => m.nombre.split(" ")[0]);
  if (!otros.length) return "Personal";
  return `Con ${otros.length > 2 ? `${otros.slice(0, 2).join(", ")} y ${otros.length - 2} más` : otros.join(" y ")}`;
}

export default function Miembros({ did, yoId, anfitrion, onCerrar, onSalir }: {
  did: number; yoId: number; anfitrion: boolean; onCerrar: () => void; onSalir: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery<{ miembros: Miembro[]; soy_dueno: boolean }>({
    queryKey: ["colab-miembros", did],
    queryFn: () => api.get(`/api/colaboradores/diagramas/${did}/miembros`),
  });
  const soyDueno = q.data?.soy_dueno ?? false;
  const inv = useQuery<{ usuarios: Invitable[] }>({
    queryKey: ["colab-invitables"],
    queryFn: () => api.get("/api/colaboradores/usuarios"),
    enabled: anfitrion && soyDueno,
  });
  const [elegido, setElegido] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ["colab-miembros", did] });
    void qc.invalidateQueries({ queryKey: ["colab-tablero", did] });
    void qc.invalidateQueries({ queryKey: ["colab-diagramas"] });
  };

  async function invitar() {
    if (!elegido) return;
    setError(null);
    try {
      const r = await api.post<{ acceso_dado: boolean }>(`/api/colaboradores/diagramas/${did}/miembros`, { usuario_id: Number(elegido) });
      const n = inv.data?.usuarios.find((u) => String(u.id) === elegido)?.nombre ?? "";
      setAviso(r.acceso_dado ? `${n} ya está en el proyecto. Se le activó Colaboradores en su menú.` : `${n} ya está en el proyecto.`);
      setElegido("");
      refrescar();
    } catch (e) { setError((e as Error).message); }
  }
  async function quitar(m: Miembro) {
    const yo = m.id === yoId;
    if (!window.confirm(yo ? "¿Salirte de este proyecto? Ya no lo verás." : `¿Sacar a ${m.nombre} del proyecto? Lo que puso se queda.`)) return;
    setError(null);
    try {
      await api.delete(`/api/colaboradores/diagramas/${did}/miembros/${m.id}`);
      if (yo) { onSalir(); return; }
      refrescar();
    } catch (e) { setError((e as Error).message); }
  }

  const ms = q.data?.miembros ?? [];
  const dentro = new Set(ms.map((m) => m.id));
  const libres = (inv.data?.usuarios ?? []).filter((u) => !dentro.has(u.id));
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/20" onClick={onCerrar} aria-hidden="true" />
      <div className="px-hoja fixed inset-x-0 bottom-0 z-[60] mx-auto max-h-[80dvh] w-full max-w-md space-y-2 overflow-y-auto rounded-t-2xl border border-border bg-surface-panel p-3 shadow-2xl sm:bottom-3 sm:rounded-2xl"
           style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }} role="dialog" aria-label="Quién está en el proyecto">
        <div className="flex items-center gap-2">
          <Sprite s="jugador" px={2} />
          <p className="px-t flex-1 text-xs font-bold uppercase text-muted">Quién está en el proyecto</p>
          <button type="button" onClick={onCerrar} className="px-1 text-lg leading-none text-muted" aria-label="Cerrar">×</button>
        </div>
        <p className="text-xs text-ink-secondary">
          {ms.length <= 1 ? "Es un proyecto personal: solo tú lo ves. Invita a alguien cuando quieras trabajarlo en equipo."
            : "Todos los de esta lista ven y editan el mapa. Nadie más lo ve."}
        </p>
        <ul className="space-y-1">
          {ms.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink">{m.id === yoId ? `${m.nombre} (tú)` : m.nombre}</span>
              <span className="text-[11px] text-muted">{m.rol === "dueno" ? "creó el proyecto" : "miembro"}</span>
              {m.rol !== "dueno" && (soyDueno || m.id === yoId) && (
                <button type="button" onClick={() => void quitar(m)} className="text-xs font-bold text-red-500">
                  {m.id === yoId ? "Salirme" : "Sacar"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {anfitrion && soyDueno && (
          <div className="space-y-1 rounded border border-border p-2">
            <p className="text-xs font-bold text-ink">Invitar a alguien</p>
            <div className="flex gap-1.5">
              <select value={elegido} onChange={(e) => setElegido(e.target.value)} className={`${MINI} min-w-0 flex-1`} aria-label="Persona">
                <option value="">elige una persona…</option>
                {libres.map((u) => <option key={u.id} value={u.id}>{u.nombre}{u.externo ? " · colaborador externo" : ""}</option>)}
              </select>
              <button type="button" disabled={!elegido} onClick={() => void invitar()}
                      className="rounded-lg bg-accent px-3 py-1 text-sm font-bold text-white disabled:opacity-50">Invitar</button>
            </div>
            <p className="text-[11px] text-muted">Si no tenía Colaboradores en su menú, se le activa; solo verá los proyectos donde lo invites.</p>
          </div>
        )}
        {aviso && <p className="text-xs text-ink">{aviso}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </>
  );
}
