import { useAppStore } from "../stores/app";

/**
 * «Aprobar pago — …» (tickets con subtipo «pago», pagos_wizard._abrir_ticket) se resuelven en
 * Contabilidad → Solicitudes de pago, con su propio flujo (firma, banco, comprobante). Aquí se
 * lleva a ese módulo con la solicitud resaltada, en vez de abrir los pasos Leer/Empezar/Entregar
 * de una solicitud común, que no hacían nada con el pago (7-oct-2026).
 */
export function esSolicitudDePago(c: { subtipo?: string | null }): boolean {
  return (c.subtipo ?? "").trim() === "pago";
}

/** Número de la solicitud de pago escrito en la descripción del ticket («SYS_SOLICITUD_PAGO: 71»). */
export function pagoIdDeDescripcion(descripcion: string | null | undefined): number | null {
  const m = /SYS_SOLICITUD_PAGO:\s*(\d+)/.exec(descripcion ?? "");
  return m ? Number(m[1]) : null;
}

export function irASolicitudPago(pagoId: number | null | undefined) {
  const st = useAppStore.getState();
  st.setPagosBoot({ abrir: false, sid: pagoId ?? undefined });
  st.setPanel("pagos");
}
