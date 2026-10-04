/**
 * Cálculo del simulador de precios (colaboradores/PreciosProyecto). Puro: lo usan los deslizadores en
 * vivo, sin guardar. El servidor (app/services/colab_precios.py) solo guarda las entradas.
 *
 * Cascada de UNA unidad, desde lo que paga el cliente:
 *   precio de la publicación − comisión de la plataforma − envío − IVA − otros costos de McKenna
 *   = lo que le entra a McKenna;  − lo que McKenna le paga al colaborador = le queda a McKenna.
 *   lo que le paga McKenna − su costo de fabricación (con merma) = le queda al colaborador.
 *
 * IVA: «incluido» = el precio ya trae el IVA (lo que dice la factura: 58.500 × 19/119 = 9.340);
 * «encima» = 19 % sobre el precio (58.500 × 19 % = 11.115), un colchón conservador — así se hizo la
 * cuenta del collar L el 4-oct-2026. Como el colaborador no cobra IVA, McKenna no tiene IVA que
 * descontar: todo el IVA de la venta sale de su lado.
 */

export type CostoColab = { nombre: string; monto: number };
export type ProductoPrecio = {
  id: number; nombre: string; sku: string; plataforma: string; nota: string;
  precio_publicacion: number; comision_pct: number; envio: number; iva_pct: number; iva_modo: "incluido" | "encima";
  otros_mckenna: number; precio_compra: number; costos: CostoColab[]; merma_pct: number;
  meta_mckenna: number; meta_colaborador: number; proveedor_id: number | null;
  acuerdos: Record<string, string>; actualizado_por: number; actualizado_en: string;
};
export type Entradas = Omit<ProductoPrecio, "id" | "acuerdos" | "actualizado_por" | "actualizado_en">;

export type Cascada = {
  comision: number; envio: number; iva: number; otros: number;
  entra_mckenna: number;          // lo que le entra a McKenna antes de pagarle al colaborador
  queda_mckenna: number;          // entra_mckenna − precio de compra
  costo_colab: number | null;     // null = el colaborador aún no puso su costo
  queda_colab: number | null;
  tope_compra: number;            // lo máximo que McKenna puede pagar y quedarse con su mínimo
  piso_compra: number | null;     // lo mínimo que el colaborador puede cobrar y quedarse con su mínimo
  publicacion_minima: number | null; // precio de publicación con el que ambos llegan a su mínimo
};

const factorIva = (e: Pick<Entradas, "iva_pct" | "iva_modo">) =>
  e.iva_modo === "encima" ? e.iva_pct / 100 : e.iva_pct / (100 + e.iva_pct);

export function costoColab(e: Pick<Entradas, "costos" | "merma_pct">): number | null {
  if (!e.costos.length) return null;
  const base = e.costos.reduce((s, c) => s + (Number(c.monto) || 0), 0);
  return Math.round(base * (1 + (e.merma_pct || 0) / 100));
}

export function calcular(e: Entradas): Cascada {
  const P = e.precio_publicacion || 0;
  const comision = Math.round(P * (e.comision_pct || 0) / 100);
  const iva = Math.round(P * factorIva(e));
  const envio = Math.round(e.envio || 0);
  const otros = Math.round(e.otros_mckenna || 0);
  const entra = P - comision - envio - iva - otros;
  const costo = costoColab(e);
  const compra = Math.round(e.precio_compra || 0);
  // Despeje: P × (1 − comisión − IVA) − envío − otros − compra = mínimo de McKenna.
  const resto = 1 - (e.comision_pct || 0) / 100 - factorIva(e);
  const piso = costo == null ? null : costo + (e.meta_colaborador || 0);
  const compraMin = piso ?? compra;
  return {
    comision, envio, iva, otros,
    entra_mckenna: entra,
    queda_mckenna: entra - compra,
    costo_colab: costo,
    queda_colab: costo == null ? null : compra - costo,
    tope_compra: entra - (e.meta_mckenna || 0),
    piso_compra: piso,
    publicacion_minima: resto > 0 ? Math.ceil((compraMin + (e.meta_mckenna || 0) + envio + otros) / resto / 100) * 100 : null,
  };
}

export const pesos = (n: number | null | undefined) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("es-CO")}`;
