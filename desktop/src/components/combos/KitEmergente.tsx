import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { EditarModal, type CatalogoItem } from "../CatalogoAlegraPanel";

/**
 * El kit de Alegra en un EMERGENTE sobre el taller de combos: ver y corregir su receta (agregarle la
 * etiqueta que no descuenta, la materia prima que falta, una cantidad errada) sin salir del caso.
 *
 * Es el MISMO emergente de Catálogo Alegra y guarda por el mismo `PATCH /api/alegra/catalogo/<sku>`,
 * con sus mismas reglas: si el kit ya tiene movimientos en Alegra, deja cambiar nombre y precio pero
 * no la receta. Acá no nace una segunda forma de escribir en Alegra.
 */
export default function KitEmergente({ sku, nombre, precio, onCerrar, onGuardado }: {
  sku: string;
  nombre: string;
  precio: number | null;
  onCerrar: () => void;
  onGuardado: () => void | Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La copia local trae id, unidad, IVA…; si no responde, basta con lo que ya sabe el taller.
  const detalle = useQuery({
    queryKey: ["kit-emergente", sku],
    queryFn: () => api.get<{ ok: boolean; item?: CatalogoItem }>(`/api/alegra/catalogo/${encodeURIComponent(sku)}`),
    retry: false,
  });
  if (detalle.isLoading) return null;
  const item: CatalogoItem = detalle.data?.item ?? {
    id: "", reference: sku, name: nombre, type: "kit", status: "active", unit: "unit", unit_cost: 0, precio_lista: precio ?? 0, iva: 0,
  };

  return createPortal(
    <EditarModal
      item={item}
      busy={ocupado}
      error={error}
      onClose={() => { if (!ocupado) onCerrar(); }}
      onSave={async ({ nombre: n, precio: pr, componentes, nuevo_codigo }) => {
        setOcupado(true);
        setError(null);
        try {
          const r = await api.patch<{ ok: boolean; error?: string }>(`/api/alegra/catalogo/${encodeURIComponent(sku)}`, {
            nombre: n,
            precio_lista: pr,
            ...(componentes ? { componentes } : {}),
            ...(nuevo_codigo ? { nuevo_codigo } : {}),
          });
          if (!r.ok) throw new Error(r.error || "Alegra no aceptó el cambio");
          await onGuardado();
          onCerrar();
        } catch (e) {
          setError((e as Error)?.message || "No se pudo guardar en Alegra");
        } finally {
          setOcupado(false);
        }
      }}
    />,
    document.body,
  );
}
