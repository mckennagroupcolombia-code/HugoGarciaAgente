import { Ico } from "../icons/Ico";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import MisionCombos from "./combos/MisionCombos";
import type { Respuesta } from "./combos/comun";

/**
 * Combos: la «fotografía» de cada producto de venta y todo lo que lo compone.
 *
 * Un combo (`type=kit` en Alegra) son gramos de materia prima + empaque + etiqueta;
 * alrededor cuelgan documento técnico, código EAN, diseño de etiqueta y publicación.
 * Se trabaja solo en el taller guiado (MisionCombos), caso a caso: la antigua
 * «vista clásica» (cuadrícula de todos los combos) se quitó porque no se usaba.
 *
 * Solo lee `/api/mapa-sistema/combos` (app/services/mapa_producto.py), sin LLM.
 */

export default function CombosPanel() {
  // Al llegar a Combos por cualquier camino, el «volver al combo» del cabezote ya cumplió —
  // salvo que el salto viniera de otro panel (origen), que conserva su «← Seguir con…».
  useEffect(() => {
    const { tallerRetorno } = useAppStore.getState();
    if (tallerRetorno && !tallerRetorno.origen) useAppStore.setState({ tallerRetorno: null, tallerSalto: null });
  }, []);

  const datos = useQuery({
    queryKey: ["mapa-sistema-combos"],
    queryFn: () => api.get<Respuesta>("/api/mapa-sistema/combos"),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-[1760px]">
      {datos.isLoading && <p className="text-xs text-muted">Leyendo el catálogo de Alegra…</p>}
      {datos.isError && <div className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-3 py-2 text-xs text-ink">No se pudieron leer los combos: {(datos.error as Error)?.message}</div>}
      {datos.data && <MisionCombos datos={datos.data} />}
    </div>
  );
}
