/** Caja de un nodo en px CSS del papel (sin el scale del capítulo). */

export type CajaPapel = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function medirCajaEnPapel(
  host: HTMLElement,
  paper: HTMLElement,
): CajaPapel {
  const hr = host.getBoundingClientRect();
  const pr = paper.getBoundingClientRect();
  const sx = pr.width / Math.max(paper.offsetWidth, 1);
  const s = sx > 0.01 ? sx : 1;
  return {
    left: (hr.left - pr.left) / s,
    top: (hr.top - pr.top) / s,
    width: hr.width / s,
    height: hr.height / s,
  };
}
