import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";

interface SyncResult {
  status: string;
  mensaje: string;
  timestamp?: string;
}

interface ActionDef {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  needsInput?: "pack_id" | "fecha" | "nombre";
  inputPlaceholder?: string;
}

const ACTIONS: ActionDef[] = [
  { id: "hoy", label: "Sync Hoy", description: "Facturas MeLi del ultimo dia", endpoint: "/api/sync/hoy" },
  { id: "10dias", label: "Sync 10 Dias", description: "Facturas de los ultimos 10 dias", endpoint: "/api/sync/10dias" },
  { id: "inteligente", label: "Sync Inteligente", description: "Cruce MeLi vs Siigo", endpoint: "/api/sync/inteligente" },
  { id: "completo", label: "Sync Completo", description: "Sync + reporte de stock", endpoint: "/api/sync/completo" },
  { id: "aprendizaje", label: "Aprendizaje IA", description: "Analizar interacciones MeLi", endpoint: "/api/sync/aprendizaje" },
  { id: "gmail", label: "Facturas Gmail", description: "Escanear facturas de compra", endpoint: "/api/sync/gmail" },
  { id: "stock", label: "Reporte Stock", description: "Generar reporte por WhatsApp", endpoint: "/api/sync/stock" },
  { id: "pack", label: "Sync por Pack", description: "Sincronizar un Pack ID especifico", endpoint: "/api/sync/pack", needsInput: "pack_id", inputPlaceholder: "Pack ID" },
  { id: "fecha", label: "Sync por Fecha", description: "Sincronizar facturas de un dia", endpoint: "/api/sync/fecha", needsInput: "fecha", inputPlaceholder: "AAAA-MM-DD" },
  { id: "producto", label: "Consultar Producto", description: "Buscar en Google Sheets", endpoint: "/api/consultar/producto", needsInput: "nombre", inputPlaceholder: "Nombre del producto" },
];

function ActionCard({ action }: { action: ActionDef }) {
  const [inputVal, setInputVal] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (action.needsInput === "nombre") {
        return api.get<SyncResult>(`${action.endpoint}?nombre=${encodeURIComponent(inputVal)}`);
      }
      const body = action.needsInput
        ? { [action.needsInput]: inputVal }
        : undefined;
      return api.post<SyncResult>(action.endpoint, body);
    },
    onSuccess: (data) => setResult(data),
    onError: (err) => setResult({ status: "error", mensaje: err.message }),
  });

  const canSubmit = action.needsInput ? inputVal.trim().length > 0 : true;

  return (
    <div className="rounded-xl border border-border bg-surface-panel p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-100">{action.label}</p>
        <p className="text-xs text-muted">{action.description}</p>
      </div>

      {action.needsInput && (
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) mutation.mutate();
          }}
          placeholder={action.inputPlaceholder}
          className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-muted/50 focus:border-accent"
        />
      )}

      <button
        onClick={() => mutation.mutate()}
        disabled={!canSubmit || mutation.isPending}
        className="rounded-lg bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/25 disabled:opacity-40"
      >
        {mutation.isPending ? "Ejecutando..." : "Ejecutar"}
      </button>

      {result && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            result.status === "error"
              ? "bg-danger/10 text-danger"
              : "bg-success/10 text-success"
          }`}
        >
          {result.mensaje ?? JSON.stringify(result)}
        </div>
      )}
    </div>
  );
}

export default function SyncPanel() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h2 className="text-lg font-semibold text-gray-100">Sincronizacion y Operaciones</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <ActionCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  );
}
