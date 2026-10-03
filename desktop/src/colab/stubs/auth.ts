/** El build de colaboradores no usa el token de servicio (ver stubs/ticketsAuth.ts). */
export const useAuthStore = {
  getState: () => ({ token: "", clear: () => {} }),
};
