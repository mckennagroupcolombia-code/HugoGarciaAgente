import { useAppStore, type EtiquetasSolicitudActiva } from "../stores/app";

export interface SolicitudEtiquetaBasica {
  id: number;
  titulo?: string;
  descripcion?: string;
  numero?: string;
  estado?: string;
  subtipo?: string | null;
  asignado_a?: number | null;
  asignado_a_nombre?: string | null;
  creado_por_nombre?: string | null;
}

export interface LineaPedidoEtiqueta {
  label: string;
  tipoEtiqueta?: string;
  cantidad: number;
}

const TIPOS_ETIQUETA = [
  "30 mL", "5 mL", "125 g", "250 g", "1 Lt",
  "100 g", "Lactato", "Circular", "Circular 70", "5 g", "54mm",
];

function normalizarTextoEtiqueta(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/gr\b/g, "g").replace(/ml\b/g, "ml");
}

export function inferirTipoEtiqueta(texto: string): string | undefined {
  const n = normalizarTextoEtiqueta(texto);
  for (const tipo of [...TIPOS_ETIQUETA].sort((a, b) => b.length - a.length)) {
    const nt = normalizarTextoEtiqueta(tipo);
    if (n.includes(nt)) return tipo;
  }
  if (/\b30\s*ml\b/i.test(texto)) return "30 mL";
  if (/\b5\s*ml\b/i.test(texto)) return "5 mL";
  if (/\b250\s*g\b/i.test(texto)) return "250 g";
  if (/\b125\s*g\b/i.test(texto)) return "125 g";
  if (/\b100\s*g\b/i.test(texto)) return "100 g";
  if (/\b5\s*g\b/i.test(texto)) return "5 g";
  if (/\b54\s*mm\b/i.test(texto)) return "54mm";
  if (/lactato/i.test(texto)) return "Lactato";
  if (/circular\s*70/i.test(texto)) return "Circular 70";
  if (/circular/i.test(texto)) return "Circular";
  if (/\b1\s*lt\b/i.test(texto)) return "1 Lt";
  return undefined;
}

export function esSolicitudEtiqueta(t: SolicitudEtiquetaBasica): boolean {
  const st = (t.subtipo || "").trim().toLowerCase();
  if (st === "etiqueta" || st === "etiquetas") return true;
  const tit = (t.titulo || "").trim().toLowerCase();
  if (tit === "etiquetas" || tit.includes("pedido de etiqueta")) return true;
  return /\betiqueta/.test(tit);
}

export function parseLineasPedidoEtiqueta(texto: string): LineaPedidoEtiqueta[] {
  return (texto || "")
    .split("\n")
    .map((l) => l.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean)
    .filter((l) => !/^(pdf|lote|vencimiento|agrega)/i.test(l))
    .map((label) => {
      const cantMatch = label.match(/(?:×|x|\*)\s*(\d+)|(\d+)\s*(?:u(?:nidades?)?|etiquetas?)\b/i);
      const cantidad = cantMatch ? parseInt(cantMatch[1] || cantMatch[2], 10) : 1;
      return {
        label,
        tipoEtiqueta: inferirTipoEtiqueta(label),
        cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
      };
    });
}

export function irAImprimirDesdeSolicitud(sol: EtiquetasSolicitudActiva) {
  const store = useAppStore.getState();
  store.setEtiquetasSolicitudActiva(sol);
  store.setEtiquetasTab("imprimir");
  store.setPanel("etiquetas");
}
