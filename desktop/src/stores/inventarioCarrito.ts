import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CarritoMaterial {
  materialId: number;
  nombre: string;
  unidad: string;
  cantidad: number;
  precio_unitario: number;
  proveedor: string;
}

export function cantidadSugeridaCarrito(m: {
  stock_actual: number;
  stock_minimo: number;
}): number {
  if (m.stock_minimo > 0 && m.stock_actual < m.stock_minimo) {
    return Math.max(m.stock_minimo * 2 - m.stock_actual, 1);
  }
  return 1;
}

type InventarioCarritoState = {
  modalOpen: boolean;
  items: CarritoMaterial[];
  setModalOpen: (open: boolean) => void;
  addMaterial: (m: {
    id: number;
    nombre: string;
    unidad: string;
    stock_actual: number;
    stock_minimo: number;
    precio_unitario: number;
    proveedor?: string;
  }) => void;
  setCantidad: (materialId: number, cantidad: number) => void;
  remove: (materialId: number) => void;
  clear: () => void;
};

export const useInventarioCarrito = create<InventarioCarritoState>()(
  persist(
    (set, get) => ({
      modalOpen: false,
      items: [],
      setModalOpen: (modalOpen) => set({ modalOpen }),
      addMaterial: (m) => {
        const delta = cantidadSugeridaCarrito(m);
        const prev = get().items;
        const idx = prev.findIndex((i) => i.materialId === m.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], cantidad: next[idx].cantidad + delta };
          set({ items: next });
          return;
        }
        set({
          items: [
            ...prev,
            {
              materialId: m.id,
              nombre: m.nombre,
              unidad: m.unidad,
              cantidad: delta,
              precio_unitario: m.precio_unitario || 0,
              proveedor: m.proveedor || "",
            },
          ],
        });
      },
      setCantidad: (materialId, cantidad) => {
        const q = Math.max(0, cantidad);
        if (q <= 0) {
          set({ items: get().items.filter((i) => i.materialId !== materialId) });
          return;
        }
        set({
          items: get().items.map((i) =>
            i.materialId === materialId ? { ...i, cantidad: q } : i,
          ),
        });
      },
      remove: (materialId) => {
        set({ items: get().items.filter((i) => i.materialId !== materialId) });
      },
      clear: () => set({ items: [] }),
    }),
    {
      name: "mckenna-inventario-carrito",
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
