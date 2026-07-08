/** Ajusta la posición izquierda de un panel flotante para que no se salga del viewport. */
export function clampFloatingLeft(left: number, panelWidth: number, viewportWidth: number, margin = 8): number {
  const max = viewportWidth - panelWidth - margin;
  if (max < margin) return margin;
  return Math.min(Math.max(left, margin), max);
}
