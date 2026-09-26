/**
 * Banco de pruebas del tablero de Colaboradores — SOLO `npm run dev`.
 *
 * Monta el ColaboradoresPanel real con un diagrama de EJEMPLO (datos
 * inventados) y SIN backend: `fetch` queda interceptado, así que guardar,
 * votar o subir fotos nunca llega a producción (a diferencia de los otros
 * bancos de dev/, que sí llaman a la API). No entra al build.
 *
 *   /app/dev/colaboradores.html
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import ColaboradoresPanel from "../src/components/ColaboradoresPanel";

const COP = (monto: number) => ({ monto, moneda: "COP" });

let diagrama = {
  id: 1, titulo: "Collares — proyecto de ejemplo", descripcion: "", version: 1, archivado: 0,
  actualizado_en: "2026-09-25 10:00:00", actualizado_por: 20, actualizado_por_nombre: "Sebastián García",
  turno_actual: null, colaborador_id: 20, participantes: { "8": "Armando García", "20": "Sebastián García" },
  nodos: 7, flechas: 5,
  doc: {
    nodes: [
      { id: "s1", label: "Comprar materiales", tipo: "accion", carril: "sebastian", x: -520, y: -140,
        tiempo_min: 120, costo: COP(85000), adjuntos: [{ id: "1-factura.pdf", nombre: "Factura aros", tipo: "pdf" }] },
      { id: "s2", label: "Fabricación de los collares", tipo: "accion", carril: "sebastian", x: -520, y: 60,
        tiempo_min: 300, datos: [{ campo: "lote", valor: "20 collares" }],
        consecuencias: [{ si: "se acaban los aros", entonces: "se para el lote", medida: "comprar 20 % de más" }] },
      { id: "c1", label: "¿Bolsa o caja?", tipo: "consenso", carril: "conjunto", x: -520, y: 280,
        asunto: "¿Qué empaque usamos para el collar M?",
        propuestas: [{ id: "p8", autor: 8, texto: "Bolsa kraft con visor" }, { id: "p20", autor: 20, texto: "Caja de cartón pequeña" }],
        votos: { "8": "p8" } },
      { id: "p1", label: "Collar de cadena M", tipo: "producto", carril: "conjunto", x: -80, y: -60,
        imagen: "1-foto.jpg", sku: "C-COLLAR-M", precio: COP(45000), url: "https://tienda.ejemplo.co/collar-m",
        empaque: { nombre: "Bolsa kraft", costo: COP(800) },
        componentes: [{ nombre: "Aros 6 mm", cantidad: "40 un", costo: COP(6000) },
                      { nombre: "Hebilla", cantidad: "1 un", costo: COP(2500) },
                      { nombre: "Termoencogible", cantidad: "10 cm", costo: COP(300) }] },
      { id: "r1", label: "Collar ajustable acero", tipo: "competencia", carril: "conjunto", x: 380, y: -160,
        imagen: "1-rival.jpg", plataforma: "Instagram", precio: COP(52000), url: "https://instagram.com/ejemplo",
        datos: [{ campo: "envío", valor: "gratis" }] },
      { id: "r2", label: "Cadena de ahogo", tipo: "competencia", carril: "conjunto", x: 380, y: 200,
        plataforma: "Marketplace", precio: COP(38000) },
      { id: "m1", label: "Registrar la venta", tipo: "dinero", carril: "mckenna", x: -80, y: 360, costo: COP(12000), tiempo_min: 20 },
    ],
    edges: [
      { id: "e1", from: "s1", to: "s2", label: "materiales listos", fromLado: "b", toLado: "t", forma: "recta" },
      { id: "e2", from: "s2", to: "p1", label: "producto terminado", fromLado: "r", toLado: "l", forma: "recta" },
      { id: "e3", from: "c1", to: "p1", label: "define el empaque", fromLado: "r", toLado: "b", forma: "recta" },
      { id: "e4", from: "p1", to: "r1", label: "vs", fromLado: "r", toLado: "l", forma: "recta", color: "#b91c1c" },
      { id: "e5", from: "p1", to: "r2", label: "vs", fromLado: "r", toLado: "l", forma: "recta", color: "#b91c1c" },
    ],
  },
};

/** Una «foto» dibujada: eslabones de cadena alrededor del centro. */
function fotoEjemplo(tono: string): string {
  const eslabones = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const x = 200 + Math.cos(a) * 120, y = 200 + Math.sin(a) * 120;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="26" ry="15" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${tono}"/>`
    + `<g fill="none" stroke="#52606d" stroke-width="10">${eslabones}</g></svg>`;
}

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const ruta = new URL(url, location.origin).pathname.replace(/^\/app(?=\/api\/)/, "");
  const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/")) return fetchReal(entrada, init);            // assets de Vite y fuentes

  const media = ruta.match(/\/media\/([^/]+)$/);
  if (media) {
    if (media[1].endsWith(".pdf")) return new Response(new Blob(["%PDF-1.4 ejemplo"], { type: "application/pdf" }));
    const tono = media[1].includes("rival") ? "#f6d7dd" : "#dfe9f1";
    return new Response(new Blob([fotoEjemplo(tono)], { type: "image/svg+xml" }));
  }
  if (ruta === "/api/colaboradores/diagramas" && metodo === "GET") {
    const { doc: _doc, ...resumen } = diagrama;
    return json({ diagramas: [resumen], yo: { id: 8, nombre: "Armando García" } });
  }
  if (ruta === "/api/colaboradores/diagramas/1") {
    if (metodo === "PUT") {
      const b = JSON.parse(String(init?.body ?? "{}"));
      diagrama = { ...diagrama, doc: b.doc, titulo: b.titulo ?? diagrama.titulo, version: diagrama.version + 1 };
    }
    return json(diagrama);
  }
  if (ruta.endsWith("/consenso")) return json(diagrama);                     // sin lógica: solo no romper
  return json({ error: "Banco de pruebas: esta ruta no tiene backend" }, 404);
};

// Para capturas sin clics (Chrome headless): ?abrir abre el diagrama, ?sel=<id>
// toca esa caja y ?clasico apaga el pixel art.
const q = new URLSearchParams(location.search);
try { localStorage.setItem("colab-pixel", q.has("clasico") ? "0" : "1"); } catch { /* sin almacenamiento */ }
if (q.has("abrir")) {
  const tocar = (sel: string, luego?: () => void, intentos = 40) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) { el.click(); luego?.(); } else if (intentos > 0) setTimeout(() => tocar(sel, luego, intentos - 1), 100);
  };
  tocar("button.w-full.text-left", () => {
    const id = q.get("sel");
    if (id) setTimeout(() => tocar(`.react-flow__node[data-id="${id}"]`, () => {
      // ?medir: el estilo calculado de un campo de la hoja, al título (para --dump-dom).
      if (q.has("medir")) setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`.px-hoja ${q.get("medir") || "input"}`);
        if (el) { const s = getComputedStyle(el); document.title = `MEDIDA|${s.fontFamily}|${s.fontSize}|${el.className}`; }
      }, 800);
    }), 600);
  });
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface p-2">
        <ColaboradoresPanel />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
