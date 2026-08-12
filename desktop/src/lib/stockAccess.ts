import type { TicketsUser } from "../stores/ticketsAuth";

/** Stock simplificado (producto + unidades): cuentas de Stella. */
const STOCK_SIMPLE_USERNAMES = new Set(["stella", "velastella"]);

export function esVistaStockSimplificada(user: TicketsUser | null): boolean {
  if (!user?.username) return false;
  return STOCK_SIMPLE_USERNAMES.has(user.username.trim().toLowerCase());
}
