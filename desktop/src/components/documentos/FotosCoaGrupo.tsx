import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useTicketsAuth } from "../../stores/ticketsAuth";
import ImageLightbox from "../ImageLightbox";

interface FotoCoa {
  mensaje_id: number;
  estado: string;
  lote: string | null;
  creado_en: number;
}

function fecha(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
}

/** Fotos del grupo «COA y fichas técnicas» que actualizaron este documento (coa_canal_auto):
 *  se ven aquí para cotejar el COA del proveedor sin salir del editor. */
export default function FotosCoaGrupo({ titulo }: { titulo: string }) {
  const token = useTicketsAuth((s) => s.token) || "";
  const [abierta, setAbierta] = useState<string | null>(null);
  // El título se escribe a mano: se busca cuando deja de cambiar.
  const [t, setT] = useState(titulo.trim());
  useEffect(() => {
    const id = window.setTimeout(() => setT(titulo.trim()), 600);
    return () => window.clearTimeout(id);
  }, [titulo]);
  const q = useQuery({
    queryKey: ["fichas-fotos-coa", t],
    queryFn: () => api.get<{ fotos: FotoCoa[] }>(`/api/fichas/fotos-coa?titulo=${encodeURIComponent(t)}`),
    enabled: t.length > 1,
    staleTime: 60_000,
  });
  const fotos = q.data?.fotos ?? [];
  if (!fotos.length) return null;
  const url = (f: FotoCoa) => `/api/fichas/fotos-coa/${f.mensaje_id}?token=${encodeURIComponent(token)}`;

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface p-2">
      <p className="mb-1.5 text-xs font-semibold text-ink">
        Fotos del grupo «COA y fichas técnicas» · {fotos.length}
      </p>
      <div className="flex flex-wrap gap-2">
        {fotos.map((f) => (
          <button
            key={f.mensaje_id}
            type="button"
            onClick={() => setAbierta(url(f))}
            title={`Lote ${f.lote || "—"} · ${fecha(f.creado_en)}`}
            className="group flex w-24 flex-col items-stretch gap-0.5 text-left"
          >
            <img
              src={url(f)}
              alt={`COA lote ${f.lote || ""}`}
              loading="lazy"
              className="h-28 w-24 rounded border border-border object-cover transition group-hover:border-accent"
            />
            <span className="truncate text-[10px] text-muted">Lote {f.lote || "—"}</span>
            <span className="text-[10px] text-muted">{fecha(f.creado_en)}</span>
          </button>
        ))}
      </div>
      {abierta && <ImageLightbox url={abierta} onClose={() => setAbierta(null)} />}
    </div>
  );
}
