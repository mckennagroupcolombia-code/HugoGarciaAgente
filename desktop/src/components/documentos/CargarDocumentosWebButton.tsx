import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface CargarDocumentosWebResult {
  ok: boolean;
  total: number;
  con_coa?: number;
  con_sds?: number;
  titulos?: string[];
  omitidos_incompletos?: number;
  omitidos_titulos?: string[];
  sitio?: { ok?: boolean; error?: string; omitido?: boolean };
}

export default function CargarDocumentosWebButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const mut = useMutation({
    mutationFn: () =>
      api.post<CargarDocumentosWebResult>(
        "/api/fichas/biblioteca/cargar-web",
        {},
        { timeoutMs: 120000 },
      ),
  });

  const data = mut.data;
  const sitioOk = data?.sitio?.ok !== false;

  return (
    <div className={compact ? "inline-flex flex-col items-end gap-1" : "space-y-2"}>
      <button
        type="button"
        onClick={() => mut.mutate()}
        disabled={mut.isPending}
        title="Publica en la tienda solo documentos completos (FT + COA + SDS diligenciados)"
        className={
          compact
            ? "rounded-lg border-2 border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            : "rounded-lg border-2 border-accent bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-hover disabled:opacity-40"
        }
      >
        {mut.isPending ? "Cargando en la web…" : "Cargar en página web"}
      </button>
      {mut.isSuccess && data && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {data.total} documento{data.total !== 1 ? "s" : ""} completo{data.total !== 1 ? "s" : ""}{" "}
          (FT + COA + SDS) en la tienda.
          {data.omitidos_incompletos
            ? ` ${data.omitidos_incompletos} no se cargó${data.omitidos_incompletos !== 1 ? "n" : ""} (incompleto o sin PDF).`
            : ""}
          {sitioOk
            ? " Los cambios ya están en mckennagroup.co."
            : ` Índice listo; la tienda no respondió (${data.sitio?.error || "sin respuesta"}). Se verán en la próxima visita.`}
        </p>
      )}
      {mut.isError && (
        <p className="text-xs text-danger">
          {(mut.error as Error).message || "No se pudo cargar en la página web"}
        </p>
      )}
    </div>
  );
}
