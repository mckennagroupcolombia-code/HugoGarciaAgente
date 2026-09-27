/**
 * Banco de pruebas del Espacio de producto — SOLO `npm run dev`.
 *
 * Monta el panel real SIN backend (`fetch` interceptado): dos combos de ejemplo
 * (uno completo, uno con piezas faltantes) y las fotos en memoria, para probar
 * el pegado con Ctrl+V y lo que titila sin tocar la biblioteca real. No entra al build.
 *
 *   /app/dev/espacio.html                 lista de productos
 *   /app/dev/espacio.html?ref=C-FALTA500g abre directo el producto incompleto en «Fotos»
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import "../src/theme/skin-pixel.css";
import "../src/theme/skin-pixel-paleta.css";
import EspacioProductoPanel from "../src/components/EspacioProductoPanel";
import { useTicketsAuth, type TicketsUser } from "../src/stores/ticketsAuth";

document.documentElement.dataset.mckSkin = "pixel";
const q = new URLSearchParams(location.search);
useTicketsAuth.setState({
  token: "banco-de-pruebas",
  user: { id: 8, username: "ejemplo", nombre: "Ejemplo", activo: 1, departamento: null, rol: { nivel: 3 }, permisos_secciones: null } as unknown as TicketsUser,
});
try {
  if (q.get("ref")) {
    localStorage.setItem("mck-espacio-producto-ref", q.get("ref")!);
    localStorage.setItem("mck-espacio-producto-pestana", "fotos");
  } else {
    localStorage.removeItem("mck-espacio-producto-ref");
  }
} catch { /* sin almacenamiento */ }

const esl = (estado: string, titulo: string, extra: object = {}) => ({ estado, titulo, detalle: `${titulo} (${estado})`, ...extra });
const COMBOS = [
  {
    ref: "C-COMPLETO250g", nombre: "PRODUCTO COMPLETO 250g", componentes: [],
    eslabones: {
      receta: esl("ok", "Receta"), etiqueta_fisica: esl("ok", "Etiqueta en la receta"),
      documento: esl("ok", "Documento técnico"), ean: esl("ok", "Código EAN", { codigo: "7700000000001" }),
      etiqueta: esl("ok", "Diseño de etiqueta", { png: "a.png", png_digital: "a_digital.png" }), publicacion: esl("ok", "Publicación"),
    },
  },
  {
    ref: "C-FALTA500g", nombre: "PRODUCTO INCOMPLETO 500g", componentes: [],
    eslabones: {
      receta: esl("ok", "Receta"), etiqueta_fisica: esl("aviso", "Etiqueta en la receta"),
      documento: esl("aviso", "Documento técnico"), ean: esl("falta", "Código EAN"),
      etiqueta: esl("falta", "Diseño de etiqueta"), publicacion: esl("aviso", "Publicación"),
    },
  },
];
const fotos: Record<string, { meli: object[]; web: object[] }> = {
  "C-COMPLETO250G": { meli: [{ archivo: "x.png", subido_at: "2026-09-27T10:00:00", ancho: 1200, alto: 1200 }], web: [{ archivo: "y.png", subido_at: "2026-09-27T10:00:00", ancho: 400, alto: 300 }] },
};
const aB64 = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(b); });

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url, location.origin);
  const ruta = url.pathname.replace(/^\/app(?=\/api\/)/, "");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (!ruta.startsWith("/api/")) return fetchReal(entrada, init);
  if (ruta === "/api/mapa-sistema/combos") return json({ combos: COMBOS, total: COMBOS.length, conteo: {} });
  if (ruta === "/api/mapa-sistema/fotos-producto") {
    const resumen: Record<string, object> = {};
    for (const [k, v] of Object.entries(fotos)) resumen[k] = { meli: v.meli.length, web: v.web.length };
    return json({ resumen });
  }
  const m = ruta.match(/^\/api\/mapa-sistema\/fotos-producto\/([^/]+)$/);
  if (m) {
    const ref = decodeURIComponent(m[1]).toUpperCase();
    const reg = (fotos[ref] ??= { meli: [], web: [] });
    const metodo = (init?.method || "GET").toUpperCase();
    if (metodo === "POST") {
      const form = init?.body as FormData;
      const canal = String(form.get("canal")) as "meli" | "web";
      const archivo = form.get("archivo") as File;
      const img = await createImageBitmap(archivo);
      reg[canal].push({ archivo: `${ref}_${Date.now()}.png`, subido_at: new Date().toISOString(), por: "ejemplo", ancho: img.width, alto: img.height, miniatura: await aB64(archivo) });
      return json({ ok: true });
    }
    if (metodo === "DELETE") {
      const canal = url.searchParams.get("canal") as "meli" | "web";
      reg[canal] = reg[canal].filter((f) => (f as { archivo: string }).archivo !== url.searchParams.get("archivo"));
      return json({ ok: true });
    }
    return json({ ref, canales: reg });
  }
  return json({});
};

const qc = new QueryClient({ defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } } });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="min-h-screen bg-surface p-4 text-ink"><EspacioProductoPanel /></div>
    </QueryClientProvider>
  </StrictMode>,
);
