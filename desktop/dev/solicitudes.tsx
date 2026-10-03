/**
 * Banco de pruebas de la bandeja de solicitudes y el hilo-misión — SOLO `npm run dev`.
 *
 * Monta InboxConversaciones real como la ve alguien de despachos (Stella), con datos de
 * EJEMPLO y `fetch` interceptado: nada llega a producción. Las fotos (`/api/tickets/uploads/*`)
 * no pasan por fetch: sin backend salen rotas salvo que el navegador de prueba las sirva.
 *
 *   /app/dev/solicitudes.html            bandeja
 *   /app/dev/solicitudes.html?abrir=1650 con el hilo abierto
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import "../src/theme/skin-pixel.css";
import "../src/theme/skin-pixel-paleta.css";
import InboxConversaciones from "../src/components/tickets/InboxConversaciones";
import { useTicketsAuth, type TicketsUser } from "../src/stores/ticketsAuth";

const q = new URLSearchParams(location.search);
const YO = 9;
const user = {
  id: YO, nombre: "Gloria Stella", username: "stella", activo: 1, departamento: null,
  rol: { nivel: 1 } as TicketsUser["rol"],
  permisos_secciones: { tickets: true, tickets_solicitudes: true, tickets_acciones: true },
} as TicketsUser;
useTicketsAuth.setState({ token: "banco", user });
try { localStorage.clear(); } catch { /* */ }

const hoy = new Date();
const hace = (min: number) => new Date(hoy.getTime() - min * 60000).toISOString().replace("T", " ").slice(0, 19);
const conv = (id: number, titulo: string, estado: string, extra: Record<string, unknown> = {}) => ({
  id, numero: `TKT-2026-${id - 123}`, titulo, tipo: "solicitud", subtipo: null, estado, prioridad: "media",
  creado_por: 8, asignado_a: YO, creado_en: hace(300), actualizado_en: hace(60),
  creado_por_nombre: "Armando Garcia", asignado_a_nombre: "Gloria Stella", adjuntos_total: 0,
  ultimo_texto: null, ultimo_en: null, ultimo_usuario_id: null, ultimo_autor: null, no_leidos: 0,
  contraparte_id: 8, contraparte_nombre: "Armando Garcia", ultima_actividad: hace(60), ...extra,
});
const estados: Record<number, string> = { 1650: q.get("estado") ?? "en_proceso" };
const conversaciones = () => [
  conv(1650, "Empacar 250 gr 500 gr  Mani Triturado - Uvas Pasas - Albaricoques", estados[1650], { adjuntos_total: 1, ultima_actividad: hace(5) }),
  conv(1651, "Revisar etiquetas de la chía antes de despachar", "pendiente", { no_leidos: 2, ultimo_texto: "Mira la foto", ultimo_autor: "Armando Garcia", ultimo_usuario_id: 8 }),
  conv(1652, "Limpiar el área de empaque", "pendiente", { tipo: "accion" }),
  conv(1649, "Empacar Semilla de Amapola 500gr 250gr", "resuelto"),
  conv(1647, "Empacar 250 GR SEMILLA de CHIA a ver en cual bolsa cabe y poner la medida", "resuelto"),
  conv(1653, "Comprar bolsas al vacío 8x10", "en_proceso", { creado_por: YO, asignado_a: 8, contraparte_nombre: "Armando Garcia" }),
];
const adjuntos: Record<number, unknown[]> = {
  1650: [
    { id: 1, ticket_id: 1650, nombre_archivo: "foto1.png", nombre_original: "bolsas.png", mime: "image/png", creado_por: 8, creado_por_nombre: "Armando Garcia", creado_en: hace(299) },
  ],
};
const timeline: Record<number, unknown[]> = {
  1650: [
    { tipo: "sistema", id: "s1", creado_en: hace(300), usuario_id: 8, autor_nombre: "Armando Garcia", texto: "Armando Garcia creó esta solicitud/acción" },
    { tipo: "sistema", id: "s2", creado_en: hace(300), usuario_id: 8, autor_nombre: "Armando Garcia", texto: "Armando Garcia la asignó a Gloria Stella" },
    { tipo: "mensaje", id: 10, creado_en: hace(299), usuario_id: 8, autor_nombre: "Armando Garcia", texto: "📎 Imagen adjunta" },
    { tipo: "mensaje", id: 11, creado_en: hace(200), usuario_id: 8, autor_nombre: "Armando Garcia", texto: "Usa las bolsas kraft con ventana para el maní." },
  ],
};

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const ruta = new URL(url, location.origin).pathname.replace(/^\/app(?=\/api\/)/, "");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/")) return fetchReal(entrada, init);
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (ruta === "/api/tickets/conversaciones") return json(conversaciones());
  if (ruta === "/api/tickets/presencia/en-linea") return json({ usuario_ids: [] });
  if (ruta === "/api/tickets/usuarios") return json([{ id: 8, nombre: "Armando Garcia" }, { id: YO, nombre: "Gloria Stella" }]);
  let m = /^\/api\/tickets\/(\d+)\/estado$/.exec(ruta);
  if (m && metodo === "PUT") { estados[Number(m[1])] = JSON.parse(String(init?.body)).estado; return json({ ok: true }); }
  m = /^\/api\/tickets\/(\d+)\/(timeline|adjuntos|materiales|pasos|corrida.*)$/.exec(ruta);
  if (m) {
    const id = Number(m[1]);
    if (m[2] === "timeline") return json(timeline[id] ?? []);
    if (m[2] === "adjuntos") return json(adjuntos[id] ?? []);
    return json([]);
  }
  m = /^\/api\/tickets\/(\d+)$/.exec(ruta);
  if (m) {
    const c = conversaciones().find((x) => x.id === Number(m![1]));
    return json({ ...c, descripcion: c?.titulo, categoria: "logistica", soporte_archivo: null, pasos_total: 0, pasos_completados: 0 });
  }
  return json(metodo === "GET" ? [] : { ok: true });
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface">
        <InboxConversaciones token="banco" user={user} bootTicketId={q.get("abrir") ? Number(q.get("abrir")) : null} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
