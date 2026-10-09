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
import { ajedrezEjemplo } from "./ajedrezEjemplo";
import { tenisEjemplo } from "./tenisEjemplo";
import { estadoEmpresaEjemplo, jugadoresEjemplo } from "./empresaVivaEjemplo";

const chatsEjemplo: Record<string, { id: number; usuario_id: number; autor_nombre: string; texto: string; creado_en: number }[]> = {};

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

// ?anchos: el ancho de cada contenedor del panel, de adentro hacia afuera, al <title> (para --dump-dom).
if (q.has("anchos")) setInterval(() => {
  let el: HTMLElement | null = document.querySelector("canvas");
  const xs: string[] = [];
  while (el && xs.length < 14) { xs.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"}:${el.clientWidth}/${el.scrollWidth}`); el = el.parentElement; }
  const anim = document.querySelector(".mck-animate-enter") as HTMLElement | null;
  document.title = `ANCHOS|canvas=${Boolean(document.querySelector("canvas"))}|op=${anim ? getComputedStyle(anim).opacity : "-"}|tr=${anim ? getComputedStyle(anim).transform : "-"}|${xs.slice(0, 3).join(" < ")}`;
}, 1000);

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
                                      fontSans: "Montserrat" }, estilo_v: Number(q.get("estilo_v") ?? 99) } }
      : {}),
  });
  if (ruta === "/api/tickets/" || ruta === "/api/tickets") return json([
    { id: 1, titulo: "Facturar pedido web 250", asignado_a: usuario.id, prioridad: "urgente" },
    { id: 2, titulo: "Empacar pedido de Laura", asignado_a: usuario.id, prioridad: "media" },
  ]);
  if (ruta === "/api/tickets/recordatorios") return json([]);
  // Urgencias como las entrega el servidor YA filtradas por persona (acceso_paneles.py).
  if (ruta === "/api/mapa-sistema/urgencias") {
    const it = (etapa: string, n: number, texto: string, panel: string, severidad = "alta") => ({ etapa, id: `${etapa}-${panel}-${severidad}`, n, texto, panel, severidad });
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
  // «Mi ficha» (MiRendimiento) con cifras de EJEMPLO.
  if (ruta === "/api/tickets/rendimiento") return json({
    usuario: { id: usuario.id, nombre: usuario.nombre, username: usuario.username },
    periodo: { desde: "2026-08-27", hasta: "2026-09-26", dias: 30 }, horas_mes: 96.5, horas_mes_anterior: 88,
    variacion_pct: 9.7, dias_activos: 19, jornada_referencia: 159,
    funciones: [{ id: "empaque", funcion: "Empacar pedidos", implica: "Armar y cerrar cajas", nivel: 1, veces: 142, horas: 14.2, promedio_min: 6, fuente: "panel" }],
    tipos: [{ nivel: 1, nombre: "Operativo", horas: 60, porcentaje: 62 }], nota: "Datos de ejemplo del banco de pruebas.",
  });
  // Quién hace cada función (nombres de EJEMPLO, inventados).
  if (ruta === "/api/mapa-sistema/quien-hace") {
    const P = (id: number, nombre: string, peso: number) => ({ id, nombre, peso });
    return json({ funciones: {
      compras: [P(1, "Laura", 23)], envasar: [P(2, "Tomás", 10)], empacar: [P(3, "Rosa", 114), P(2, "Tomás", 29)],
      lote: [P(1, "Laura", 5)], imprimir_et: [P(1, "Laura", 39), P(2, "Tomás", 19)], alistar: [P(1, "Laura", 56)],
      embalar: [P(1, "Laura", 9), P(3, "Rosa", 6)], guias: [P(1, "Laura", 46)], envio: [P(2, "Tomás", 15)],
      clientes: [P(1, "Laura", 52)], meli_qa: [P(1, "Laura", 4)], publica: [P(4, "Marta", 66)],
      facturar: [P(1, "Laura", 134)], sol_pago: [P(5, "Andrés", 38)], aprobar: [P(5, "Andrés", 41)],
      contab: [P(5, "Andrés", 38)], analisis: [P(4, "Marta", 41)],
    } });
  }
  // El juego de la empresa, con un ciclo de EJEMPLO que cambia cada 10 s (dev/empresaVivaEjemplo.ts).
  if (ruta === "/api/empresa-viva/estado") return json(estadoEmpresaEjemplo(Number(usuario.id)));
  // Ajedrez de EJEMPLO en la mesa del parque: el rival acepta y responde solo (dev/ajedrezEjemplo.ts).
  { const r = ajedrezEjemplo(ruta, init, Number(usuario.id)); if (r) return r; }
  // Tenis de EJEMPLO en la cancha del parque: Victor se une y su raqueta sigue la pelota (dev/tenisEjemplo.ts).
  { const r = tenisEjemplo(ruta, init, Number(usuario.id)); if (r) return r; }
  // Otro jugador de EJEMPLO (Jenniffer) que camina por la oficina de la sede y te saluda una vez.
  if (ruta === "/api/empresa-viva/jugador") return json(jugadoresEjemplo());
  // Chat directo de EJEMPLO (Empresa viva → «Hablar»): un canal por persona, mensajes en memoria.
  if (ruta === "/api/canales/directo" && init?.method === "POST") {
    const con = Number(JSON.parse(String(init.body || "{}")).con);
    return json({ id: 900 + con, nombre: `Armando · ${con}`, miembros: [Number(usuario.id), con], directo_con: con });
  }
  {
    const m = ruta.match(/^\/api\/canales\/(\d+)\/(mensajes|leido)$/);
    if (m && Number(m[1]) >= 900) {
      const lista = (chatsEjemplo[m[1]] ??= Number(m[1]) === 910
        ? [{ id: 1, usuario_id: 10, autor_nombre: "Jenniffer", texto: "¡Hola! ¿Ya viste que llegó el proveedor?", creado_en: Date.now() / 1000 - 60 }]
        : []);
      if (m[2] === "leido") return json({ ok: true });
      if (init?.method === "POST") {
        const msg = { id: lista.length + 1, usuario_id: Number(usuario.id), autor_nombre: "Armando", texto: JSON.parse(String(init.body)).texto, creado_en: Date.now() / 1000 };
        lista.push(msg);
        return json(msg, 201);
      }
      const despues = Number(new URL(url, location.origin).searchParams.get("despues_de") || 0);
      return json({ mensajes: lista.filter((x) => x.id > despues) });
    }
  }
  if (ruta === "/api/canales" && (init?.method ?? "GET") === "GET") return json({ canales: [
    { id: 8, nombre: "HORMIGUITAS DE MCKENNA", descripcion: "", miembros: [], espejo_salida: false, wa_jid: "", wa_nombre: "" },
    { id: 2, nombre: "Sede Sur", descripcion: "", miembros: [7, 9, 10], espejo_salida: true, wa_jid: "x@g.us", wa_nombre: "MCKG SEDE SUR" },
  ] });
  if (/^\/api\/canales\/\d+\/mensajes$/.test(ruta) && init?.method === "POST") return json({ id: Date.now() % 100000 }, 201);
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
