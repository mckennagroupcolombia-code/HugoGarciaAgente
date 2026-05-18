import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TicketsRol {
  id: number;
  nombre: string;
  nivel: number;
}

export interface TicketsDept {
  id: number;
  nombre: string;
  color: string;
}

export interface TicketsUser {
  id: number;
  nombre: string;
  username: string;
  activo: number;
  rol: TicketsRol | null;
  departamento: TicketsDept | null;
}

interface TicketsAuthState {
  token: string | null;
  user: TicketsUser | null;
  setAuth: (token: string, user: TicketsUser) => void;
  clear: () => void;
}

export const useTicketsAuth = create<TicketsAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: "mckenna-tickets-auth" },
  ),
);
