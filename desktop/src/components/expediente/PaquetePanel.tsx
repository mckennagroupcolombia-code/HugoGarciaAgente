/**
 * El paquete del mes: estado (listo / desactualizado / generando / sin generar),
 * botón para generarlo o actualizarlo y descarga. Lo genera el backend en un hilo
 * (app/services/expediente_paquete.py); aquí solo se consulta cada 3 s mientras corre.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAuthBlobUrl } from "../../api/client";
import { Icon } from "../../icons";

type Estado = { estado: "no" | "generando" | "listo" | "error"; generado_en?: string; bytes?: number; archivos?: number; faltantes?: number; firma_vigente?: boolean | null; error?: string; segundos?: number };

function mb(b?: number) { return b ? `${(b / 1024 / 1024).toFixed(1)} MB` : ""; }

export default function PaquetePanel({ periodo }: { periodo: string }) {
  const qc = useQueryClient();
  const q = useQuery<Estado>({
    queryKey: ["expediente-paquete", periodo],
    queryFn: () => api.get(`/api/contabilidad/expediente/${periodo}/paquete`),
    refetchInterval: (query) => (query.state.data?.estado === "generando" ? 3000 : false),
  });
  const generar = useMutation({
    mutationFn: () => api.post(`/api/contabilidad/expediente/${periodo}/paquete/generar`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["expediente-paquete", periodo] }),
    onError: (e) => window.alert((e as Error).message),
  });
  const e = q.data;
  const descargar = async () => {
    const url = await fetchAuthBlobUrl(`/api/contabilidad/expediente/${periodo}/paquete/descargar`);
    if (!url) { window.alert("No se pudo descargar el paquete."); return; }
    const a = document.createElement("a"); a.href = url; a.download = `expediente_${periodo}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const listo = e?.estado === "listo";
  const vigente = listo && e?.firma_vigente !== false;
  return (
    <div className="ex-paquete" data-guia="ex-paquete">
      <div className="rv-fila-textos">
        <span className="rv-h"><Icon name="package" size={18} weight="bold" /> Paquete del mes (ZIP)</span>
        <span className="rv-sub">
          {!e || e.estado === "no" ? "Todavía no se ha generado: datos en CSV/JSON, índice, extracto, cruce DIAN, declaraciones y soportes."
            : e.estado === "generando" ? "Generando… (tarda un par de minutos con miles de asientos)"
            : e.estado === "error" ? `Falló: ${e.error}`
            : `${vigente ? "Listo" : "Desactualizado: hay cambios desde que se generó"} · ${mb(e.bytes)} · ${e.archivos} archivos · ${e.faltantes} faltantes anotados · ${e.generado_en?.slice(0, 16).replace("T", " ")}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className="ex-btn" onClick={() => generar.mutate()} disabled={e?.estado === "generando" || generar.isPending}>
          {listo ? (vigente ? "Regenerar" : "Actualizar") : "Generar"}
        </button>
        {listo && <button type="button" className="rv-ir" onClick={() => void descargar()}><Icon name="download" size={16} weight="bold" /> Descargar</button>}
      </div>
    </div>
  );
}
