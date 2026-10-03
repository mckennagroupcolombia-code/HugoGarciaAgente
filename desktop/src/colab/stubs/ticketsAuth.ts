/**
 * Sesión del build de colaboradores. Reemplaza a `stores/ticketsAuth` por alias
 * (vite.colab.config.ts): el original arrastra reglas de acceso del equipo
 * interno que no tienen por qué viajar a este bundle. Misma clave de
 * localStorage que el panel, para que la pantalla de ingreso revalide la sesión.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TicketsUser {
  id: number;
  nombre: string;
  username: string;
  foto?: string | null;
  permisos_secciones?: Record<string, boolean> | null;
}

interface Estado {
  token: string | null;
  user: TicketsUser | null;
  apiToken: string | null;
  setAuth: (token: string, user: TicketsUser) => void;
  clear: () => void;
}

export const useTicketsAuth = create<Estado>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      apiToken: null,
      setAuth: (token, user) => set({ token, user, apiToken: null }),
      clear: () => set({ token: null, user: null, apiToken: null }),
    }),
    { name: "mckenna-tickets-auth", partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
);
