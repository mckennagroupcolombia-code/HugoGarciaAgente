/**
 * Banco de pruebas del Mapa vivo — SOLO `npm run dev`.
 *
 * Monta el MapaVivo real con una persona de EJEMPLO y SIN backend (`fetch`
 * interceptado): sirve para ver qué ve cada perfil sin entrar con la sesión de
 * nadie. No entra al build.
 *
 *   /app/dev/mapa.html              administración (ve las 9 etapas)
 *   /app/dev/mapa.html?perfil=despachos   alguien que despacha (pedidos, empaque)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import MapaVivo from "../src/components/MapaVivo";
import { useTicketsAuth, type TicketsUser } from "../src/stores/ticketsAuth";

const q = new URLSearchParams(location.search);
const PERFILES: Record<string, Partial<TicketsUser>> = {
  admin: { id: 8, nombre: "Armando García", rol: { nivel: 3 } as TicketsUser["rol"], permisos_secciones: null },
  despachos: {
    id: 12, nombre: "Stella Ejemplo", rol: { nivel: 1 } as TicketsUser["rol"],
    permisos_secciones: { tickets: true, pedidos: true, empaque: true, "guias-envio": true, facturacion: true },
  },
};
const perfil = PERFILES[q.get("perfil") ?? "admin"] ?? PERFILES.admin;
useTicketsAuth.setState({
  token: "banco-de-pruebas",
  user: { username: "ejemplo", activo: 1, departamento: null, ...perfil } as TicketsUser,
});
try {
  localStorage.removeItem("mck-mapa-vivo-vista");                 // siempre encuadrado desde cero
  if (q.get("nivel")) localStorage.setItem("mck-mapa-vivo-nivel", q.get("nivel")!);
} catch { /* sin almacenamiento */ }

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const ruta = new URL(url, location.origin).pathname.replace(/^\/app(?=\/api\/)/, "");
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/")) return fetchReal(entrada, init);
  if (ruta === "/api/mapa-sistema/bloqueos") {
    if (perfil.rol?.nivel !== 3) return json({ error: "Sin permiso" }, 403);
    return json({ por_etapa: {
      preparar: { alta: 3, media: 12, items: [
        { etapa: "preparar", id: "a", n: 3, texto: "combos sin código EAN", panel: "combos", severidad: "alta" },
        { etapa: "preparar", id: "b", n: 12, texto: "documentos sin combo", panel: "fichas", severidad: "media" }] },
      contar: { alta: 1, media: 0, items: [
        { etapa: "contar", id: "c", n: 1, texto: "solicitud de pago por aprobar", panel: "pagos", severidad: "alta" }] },
    } });
  }
  if (ruta === "/api/tickets/") {
    const id = perfil.id;
    return json([
      { id: 1, titulo: "Facturar pedido web 250", asignado_a: id },
      { id: 2, titulo: "Etiqueta nueva para la chía", asignado_a: id },
      { id: 3, titulo: "Conciliar extracto de agosto", asignado_a: 99 },
    ]);
  }
  if (ruta === "/api/tickets/recordatorios") return json([{ proxima_fecha: "2026-01-01" }, { proxima_fecha: "2099-01-01" }]);
  return json({ error: "Banco de pruebas: esta ruta no tiene backend" }, 404);
};

// ?medir: ancho de ventana y cámara real al título (para leerlo con --dump-dom).
if (q.has("medir")) setTimeout(() => {
  const vp = document.querySelector<HTMLElement>(".react-flow__viewport");
  const lz = document.querySelector<HTMLElement>(".react-flow");
  document.title = `MEDIDA|ventana=${innerWidth}|lienzo=${lz?.clientWidth}|camara=${vp?.style.transform}`;
}, 2500);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface p-2">
        <MapaVivo />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
