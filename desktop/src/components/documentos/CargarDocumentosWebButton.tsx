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
        <div className="max-w-md space-y-1 text-xs text-emerald-700 dark:text-emerald-400">
          <p>
            {data.total} documento{data.total !== 1 ? "s" : ""} completo
            {data.total !== 1 ? "s" : ""} (FT + COA + SDS) actualizado
            {data.total !== 1 ? "s" : ""} en la tienda.
            {sitioOk
              ? " Ya visibles en las fichas de producto."
              : ` Índice listo; la tienda no respondió (${data.sitio?.error || "sin respuesta"}).`}
          </p>
          {!!data.omitidos_incompletos && (
            <p className="text-amber-800 dark:text-amber-300">
              {data.omitidos_incompletos} omitido
              {data.omitidos_incompletos !== 1 ? "s" : ""} (falta COA, SDS o PDF)
              {data.omitidos_titulos?.length
                ? `: ${data.omitidos_titulos.slice(0, 6).join(", ")}${
                    data.omitidos_titulos.length > 6 ? "…" : ""
                  }`
                : "."}
            </p>
          )}
        </div>
      )}
      {mut.isError && (
        <p className="text-xs text-danger">
          {(mut.error as Error).message || "No se pudo cargar en la página web"}
        </p>
      )}
    </div>
  );
}
