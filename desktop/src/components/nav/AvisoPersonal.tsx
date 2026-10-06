import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";

type Aviso = { id: string; titulo: string; mensaje: string; firma?: string; creado: string };

/** Comunicado personal: aparece una sola vez al abrir la app; «Entendido» lo marca como visto. */
export default function AvisoPersonal() {
  const token = useTicketsAuth((s) => s.token);
  const qc = useQueryClient();
  const [cerrando, setCerrando] = useState(false);
  const { data } = useQuery({
    queryKey: ["avisos-personales", token],
    queryFn: () => api.get<{ avisos: Aviso[] }>("/api/avisos-personales/pendientes"),
    enabled: !!token,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const aviso = data?.avisos?.[0];
  if (!aviso) return null;

  const entendido = async () => {
    setCerrando(true);
    try {
      await api.post(`/api/avisos-personales/${aviso.id}/visto`);
    } catch {
      /* si falla, vuelve a salir la próxima vez */
    }
    qc.setQueryData(["avisos-personales", token], { avisos: (data?.avisos ?? []).filter((a) => a.id !== aviso.id) });
    setCerrando(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 text-ink shadow-paper-lg">
        <h2 className="mb-3 text-lg font-bold">{aviso.titulo}</h2>
        <p className="whitespace-pre-line text-[15px] leading-relaxed">{aviso.mensaje}</p>
        {aviso.firma && <p className="mt-4 text-sm font-semibold">{aviso.firma}</p>}
        <button
          type="button"
          onClick={entendido}
          disabled={cerrando}
          className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          Entendido, ¡gracias!
        </button>
      </div>
    </div>,
    document.body,
  );
}
