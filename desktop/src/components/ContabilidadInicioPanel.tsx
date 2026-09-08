import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import ChecklistGuiado, { type ChecklistGuiadoItem, type ChecklistSeveridad } from "./ui/ChecklistGuiado";
import type { IconName } from "../icons/types";

interface ChecklistItemApi {
  id: string;
  titulo: string;
  detalle: string;
  cantidad: number;
  severidad: ChecklistSeveridad;
  cta: string;
}

interface ChecklistResponse {
  items: ChecklistItemApi[];
  total_pendientes: number;
  completo: boolean;
}

const ICONO_POR_ID: Partial<Record<string, IconName>> = {
  extractos_pendientes: "receipt",
  extracto_sin_cargar: "receipt",
  prestamos_pendientes: "handshake",
  facturacion_pendiente: "listChecks",
};

/**
 * Primera pantalla del hub Contabilidad: "esto es lo que falta por hacer
 * hoy", en un solo lugar, en vez de que el usuario tenga que recordar en
 * cuál de las 6+ pestañas vive cada cosa. No es un panel nuevo de datos —
 * cada item navega al lugar donde ya se resuelve hoy (Libro Mayor → Diario
 * / Préstamos, o el ticket de revisión de facturación), reusando el
 * mecanismo de "boot tab" que ya existe en el store.
 */
export default function ContabilidadInicioPanel() {
  const setPanel = useAppStore((s) => s.setPanel);
  const setLibroMayorBootTab = useAppStore((s) => s.setLibroMayorBootTab);
  const setLibroMayorAbrirPendientes = useAppStore((s) => s.setLibroMayorAbrirPendientes);
  const setTicketsBootView = useAppStore((s) => s.setTicketsBootView);

  const q = useQuery<ChecklistResponse>({
    queryKey: ["contabilidad-checklist"],
    queryFn: () => api.get("/api/contabilidad/checklist"),
    staleTime: 30_000,
  });

  function irA(cta: string) {
    switch (cta) {
      case "libro_mayor_diario":
        setLibroMayorAbrirPendientes(true);
        setPanel("libro-mayor");
        setLibroMayorBootTab("diario");
        return;
      case "libro_mayor_prestamos":
        setPanel("libro-mayor");
        setLibroMayorBootTab("prestamos");
        return;
      case "ticket_facturacion":
        setPanel("tickets");
        setTicketsBootView("list");
        return;
      default:
        return;
    }
  }

  const items: ChecklistGuiadoItem[] = (q.data?.items ?? []).map((it) => ({
    id: it.id,
    titulo: it.titulo,
    detalle: it.detalle,
    cantidad: it.cantidad,
    severidad: it.severidad,
    icon: ICONO_POR_ID[it.id],
    onClick: () => irA(it.cta),
  }));

  const pendientes = items.filter((it) => it.severidad !== "ok");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold tracking-tight text-ink">Inicio · Contabilidad</h2>
        <p className="mt-0.5 text-xs text-muted">
          Lo que falta por hacer hoy en contabilidad, en un solo lugar. Cada pendiente lleva directo a
          donde se resuelve.
        </p>
      </div>
      <ChecklistGuiado
        titulo="Pendientes"
        items={pendientes.length > 0 ? pendientes : items}
        progreso={q.data ? { hechos: items.length - pendientes.length, total: items.length } : undefined}
        loading={q.isLoading}
      />
      {q.isError && (
        <p className="text-xs text-danger">
          No se pudo cargar el checklist. Intenta de nuevo en unos segundos.
        </p>
      )}
    </div>
  );
}
