/**
 * Caja de observación del contador sobre un objeto del expediente (cuenta, asiento,
 * cruce o documento): «Revisado ✓» de un clic, o una nota / pregunta / ajuste con
 * texto. El equipo ve «Resolver» en las abiertas. El autor lo pone el backend desde
 * la sesión; aquí nunca se manda.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../icons";
import { esContador } from "../../lib/contadorAccess";
import { useTicketsAuth } from "../../stores/ticketsAuth";

type Obs = { id: number; estado: string; texto: string; por: string; created_at: string; respuesta?: string; resuelto_en?: string | null; resuelto_por?: string | null; abierta: boolean };

export default function CajaObservacion({ periodo, objetoTipo, objetoId, compacta }: {
  periodo: string; objetoTipo: "mes" | "cuenta" | "asiento" | "cruce" | "documento"; objetoId: string; compacta?: boolean;
}) {
  const qc = useQueryClient();
  const contador = esContador(useTicketsAuth((s) => s.user));
  const [abrir, setAbrir] = useState(false);
  const [tipo, setTipo] = useState<"nota" | "pregunta" | "ajuste">("pregunta");
  const [texto, setTexto] = useState("");
  const [respuesta, setRespuesta] = useState<Record<number, string>>({});
  const clave = ["expediente-observaciones", periodo, objetoTipo, objetoId];
  const q = useQuery<{ observaciones: Obs[] }>({
    queryKey: clave,
    queryFn: () => api.get(`/api/contabilidad/expediente/observaciones?${new URLSearchParams({ periodo, objeto_tipo: objetoTipo, objeto_id: objetoId }).toString()}`),
    staleTime: 30_000,
  });
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: clave });
    void qc.invalidateQueries({ queryKey: ["expediente-mes", periodo] });
    void qc.invalidateQueries({ queryKey: ["expediente-cuenta"] });
    void qc.invalidateQueries({ queryKey: ["contabilidad-revision"] });
  };
  const crear = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ error?: string }>("/api/contabilidad/expediente/observaciones", body),
    onSuccess: (r) => { if (r?.error) window.alert(r.error); else { setTexto(""); setAbrir(false); invalidar(); } },
    onError: (e) => window.alert((e as Error).message),
  });
  const resolver = useMutation({
    mutationFn: ({ id, r }: { id: number; r: string }) => api.post<{ error?: string }>(`/api/contabilidad/expediente/observaciones/${id}/resolver`, { respuesta: r }),
    onSuccess: () => invalidar(),
    onError: (e) => window.alert((e as Error).message),
  });
  const obs = q.data?.observaciones ?? [];
  const revisado = obs.find((o) => o.estado === "revisado");
  const base = { periodo, objeto_tipo: objetoTipo, objeto_id: objetoId };

  return (
    <div className={`ex-caja-obs ${compacta ? "ex-caja-obs-compacta" : ""}`} data-guia={compacta ? undefined : "ex-observacion"} onClick={(e) => e.stopPropagation()}>
      <div className="ex-caja-obs-acciones">
        {revisado ? (
          <button type="button" className="ex-btn ex-btn-on" title={`Revisado por ${revisado.por} el ${revisado.created_at.slice(0, 10)}`}
            onClick={() => crear.mutate({ ...base, quitar_revisado: true })}>
            <Icon name="check" size={14} weight="bold" /> Revisado por {revisado.por.split(" ")[0]}
          </button>
        ) : (
          <button type="button" className="ex-btn" onClick={() => crear.mutate({ ...base, estado: "revisado" })} disabled={crear.isPending}>
            <Icon name="check" size={14} weight="bold" /> Marcar revisado
          </button>
        )}
        <button type="button" className="ex-btn" onClick={() => setAbrir(!abrir)}>
          <Icon name="chat" size={14} weight="bold" /> {abrir ? "Cancelar" : "Dejar nota"}
        </button>
        {obs.filter((o) => o.abierta).length > 0 && <span className="ex-insignia ex-falta">{obs.filter((o) => o.abierta).length} abierta(s)</span>}
      </div>
      {abrir && (
        <form className="ex-caja-obs-form" onSubmit={(e) => { e.preventDefault(); crear.mutate({ ...base, estado: tipo, texto }); }}>
          <div className="flex flex-wrap gap-1">
            {(["pregunta", "ajuste", "nota"] as const).map((t) => (
              <button key={t} type="button" className={`ex-btn ${tipo === t ? "ex-btn-on" : ""}`} onClick={() => setTipo(t)}>
                {t === "pregunta" ? "Pregunta" : t === "ajuste" ? "Ajuste que pido" : "Nota"}
              </button>
            ))}
          </div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="ex-buscar w-full"
            placeholder={tipo === "ajuste" ? "Qué hay que corregir y por qué (p. ej. «este IVA va a 2408»)" : tipo === "pregunta" ? "Qué necesitas saber de este renglón" : "Nota para el equipo"} />
          <button type="submit" className="rv-ir" disabled={crear.isPending || (tipo !== "nota" && !texto.trim())}>Guardar</button>
        </form>
      )}
      {obs.filter((o) => o.estado !== "revisado").length > 0 && (
        <ul className="ex-obs">
          {obs.filter((o) => o.estado !== "revisado").map((o) => (
            <li key={o.id}>
              <b>{o.por}</b> <span className="rv-sub">{o.created_at.slice(0, 16).replace("T", " ")}</span> · <i>{o.estado}</i>: {o.texto}
              {o.respuesta && <div className="rv-sub">↳ {o.resuelto_por ?? "Equipo"}: {o.respuesta}</div>}
              {o.abierta && !contador && (
                <div className="mt-1 flex flex-wrap gap-1">
                  <input value={respuesta[o.id] ?? ""} onChange={(e) => setRespuesta({ ...respuesta, [o.id]: e.target.value })} placeholder="Respuesta…" className="ex-buscar" />
                  <button type="button" className="ex-btn" onClick={() => resolver.mutate({ id: o.id, r: respuesta[o.id] ?? "" })} disabled={resolver.isPending}>Resolver</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
