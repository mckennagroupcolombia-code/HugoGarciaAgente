/**
 * Banco de pruebas de la APP COMPLETA — SOLO `npm run dev`.
 *
 * Monta el App real (Layout, cabezote, menú, celular) con una sesión de EJEMPLO y
 * `fetch` interceptado: nada llega a producción. Sirve para ver lo que el banco de un
 * solo panel no ve (cómo convive con el cabezote, el panel inicial, el celular).
 * Los errores quedan en la consola y, con ?medir, el primero va al <title>.
 *
 *   /app/dev/app.html?perfil=admin|despachos&panel_guardado=hugo
 */
const q = new URLSearchParams(location.search);
const PERFILES: Record<string, Record<string, unknown>> = {
  admin: { id: 8, nombre: "Armando García", username: "armando", activo: 1, rol: { nivel: 3, nombre: "admin" }, departamento: null, permisos_secciones: null },
  despachos: {
    id: 12, nombre: "Stella Ejemplo", username: "stella", activo: 1, rol: { nivel: 1, nombre: "operador" }, departamento: null,
    permisos_secciones: { tickets: true, pedidos: true, empaque: true, "guias-envio": true, facturacion: true },
  },
};
const usuario = PERFILES[q.get("perfil") ?? "admin"] ?? PERFILES.admin;

// La sesión y el panel guardados, como los deja un uso anterior.
localStorage.clear();
localStorage.setItem("mckenna-tickets-auth", JSON.stringify({ state: { token: "banco", user: usuario, apiToken: "banco-api" }, version: 0 }));
localStorage.setItem("mckenna-auth", JSON.stringify({ state: { token: "banco-api" }, version: 0 }));
localStorage.setItem("mckenna-app", JSON.stringify({ state: { panel: q.get("panel_guardado") ?? "hugo" }, version: 0 }));

const errores: string[] = [];
const anotar = (m: string) => { errores.push(m); if (q.has("medir")) document.title = `ERRORES(${errores.length})|${errores[0]}`; };
window.addEventListener("error", (e) => {
  // Archivo y línea del primer marco que sea código del proyecto (/src/).
  const donde = String((e.error as Error)?.stack ?? "").split("\n").find((l) => l.includes("/src/"))?.trim() ?? "";
  anotar(`error: ${e.message} @ ${donde.replace(/^at /, "").replace(/https?:\/\/[^/]+/, "")}`);
});
window.addEventListener("unhandledrejection", (e) => anotar(`promesa: ${String((e.reason as Error)?.message ?? e.reason)}`));
const consolaError = console.error.bind(console);
console.error = (...a: unknown[]) => { anotar(`console.error: ${a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ").slice(0, 300)}`); consolaError(...a); };
const panelActual = () => JSON.parse(localStorage.getItem("mckenna-app") || "{}")?.state?.panel;
// ?tocar=Empaque,◇ Mapa : toca esos botones por su texto, uno cada 2 s, y anota el panel.
const recorrido: string[] = [];
(q.get("tocar") ?? "").split(",").filter(Boolean).forEach((texto, i) => setTimeout(() => {
  const b = [...document.querySelectorAll<HTMLElement>("button")].find((x) => x.textContent?.trim().includes(texto));
  if (b) b.click();
  setTimeout(() => recorrido.push(`${texto}→${b ? panelActual() : "NO-ENCONTRADO"}`), 900);
}, 2500 + i * 2000));
if (q.has("medir")) setTimeout(() => {
  if (!errores.length) document.title = `SIN-ERRORES|panel=${panelActual()}|${recorrido.join(" ; ")}`;
}, 3500 + recorrido.length * 2000 + ((q.get("tocar") ?? "").split(",").filter(Boolean).length) * 2000);

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const ruta = new URL(url, location.origin).pathname.replace(/^\/app(?=\/api\/)/, "");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/") && !ruta.startsWith("/chat")) return fetchReal(entrada, init);
  // ?rutas: la lista de rutas pedidas, al atributo data-rutas del <body> (para --dump-dom).
  if (q.has("rutas")) document.body.dataset.rutas = `${document.body.dataset.rutas ?? ""} ${ruta}`;
  // ?piel=flujo: la persona ya eligió esa piel (sirve para comparar contra la anterior).
  if (ruta.startsWith("/api/tickets/auth/me")) return json({
    ...usuario, api_token: "banco-api",
    ...(q.get("piel") || q.get("modo")
      ? { preferencias_ui: { panel: { skin: q.get("piel") ?? "pixel", mode: q.get("modo") ?? "light",
                                      fontSans: "Montserrat" }, estilo_v: 99 } }
      : {}),
  });
  if (ruta === "/api/tickets/" || ruta === "/api/tickets") return json([
    { id: 1, titulo: "Facturar pedido web 250", asignado_a: usuario.id, prioridad: "urgente" },
    { id: 2, titulo: "Empacar pedido de Laura", asignado_a: usuario.id, prioridad: "media" },
  ]);
  if (ruta === "/api/tickets/recordatorios") return json([]);
  // Urgencias como las entrega el servidor YA filtradas por persona (acceso_paneles.py).
  if (ruta === "/api/mapa-sistema/urgencias") {
    const it = (etapa: string, n: number, texto: string, panel: string, severidad = "alta") => ({ etapa, id: `${etapa}-${panel}`, n, texto, panel, severidad });
    const grupo = (...xs: ReturnType<typeof it>[]) => ({
      alta: xs.filter((x) => x.severidad === "alta").reduce((a, x) => a + x.n, 0),
      media: xs.filter((x) => x.severidad === "media").reduce((a, x) => a + x.n, 0), items: xs });
    const despachos = { entregar: grupo(it("entregar", 3, "pedidos web pagados que siguen sin despachar", "pedidos")) };
    return json({ por_etapa: usuario.rol && (usuario.rol as { nivel: number }).nivel >= 3 ? {
      ...despachos,
      preparar: grupo(it("preparar", 124, "publicaciones agotadas", "control-inventario"), it("preparar", 39, "con stock crítico", "control-inventario", "media")),
      contar: grupo(it("contar", 117, "movimientos del banco sin clasificar", "libro-mayor")),
    } : despachos, sin_senal: [], generado: "" });
  }
  if (ruta === "/api/status") return json({ status: "activo", servicios: {} });
  // Pedidos Web con datos de EJEMPLO (inventados): sin ellos el panel solo muestra su estado vacío.
  if (ruta === "/api/pedidos/web") {
    const p = (id: number, nombre: string, status: string, envio: string, total: number, factura?: string, err?: string) => ({
      id, reference: `MCKG-2026-${1000 + id}`, buyer_name: nombre, buyer_email: `cliente${id}@ejemplo.co`,
      buyer_phone: "3001234567", buyer_city: "Bogotá", buyer_dept: "Cundinamarca", buyer_address: "Calle 1 # 2-3",
      items: [{ name: "Ácido hialurónico 50 g", quantity: 2, unit_price: total / 2, sku: "C-AHIA50g" }],
      total, shipping_cost: 12000, status, shipping_status: envio, created_at: `2026-09-2${id % 5} 10:3${id}:00`,
      payment_method: "pse", payment_type: "bank_transfer",
      ...(factura ? { siigo_invoice_number: factura, siigo_invoice_status: "ok" } : {}),
      ...(err ? { siigo_invoice_status: "error", siigo_invoice_error: err } : {}),
    });
    return json({ orders: [
      p(1, "Laura Gómez", "approved", "preparing", 84000),
      p(2, "Carlos Ruiz", "approved", "shipped", 126500, "FE-1234"),
      p(3, "Ana Torres", "approved", "delivered", 45900, "FE-1235"),
      p(4, "Pedro Díaz", "pending", "preparing", 230000),
      p(5, "Marta León", "approved", "preparing", 99000, undefined, "NIT inválido en Alegra"),
      p(6, "Jorge Peña", "rejected", "preparing", 51000),
    ], total: 6, page: 1, per_page: 50 });
  }
  // Lo demás: «servicio no disponible». Es lo más honesto para un banco sin servidor: los
  // paneles saben mostrar su estado sin datos ante un error, mientras que una respuesta
  // inventada ([] o {}) con la forma equivocada los tumba por razones del banco.
  // ?vacio=lista vuelve al comportamiento anterior (lista vacía para todo).
  return q.get("vacio") === "lista" ? json([]) : json({ error: "banco de pruebas sin servidor" }, 503);
};

void import("react-dom/client").then(async ({ createRoot }) => {
  const [{ StrictMode }, { QueryClient, QueryClientProvider }, { default: App }] = await Promise.all([
    import("react"), import("@tanstack/react-query"), import("../src/App"),
  ]);
  await import("../src/index.css");
  await import("../src/theme/skin-pixel.css");
  await import("../src/theme/skin-pixel-paleta.css");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });
  createRoot(document.getElementById("root")!).render(
    <StrictMode><QueryClientProvider client={qc}><App /></QueryClientProvider></StrictMode>,
  );
});
