/**
 * Banco de pruebas de la Revisión de pesos, medidas y empaques — SOLO `npm run dev`.
 *
 * Monta la tarjeta real de la solicitud SIN backend (`fetch` interceptado): cuatro combos de
 * ejemplo y tres tipos de empaque; lo que se guarda vive en memoria y el avance se mueve. No
 * entra al build y no escribe en MeLi.
 *
 *   /app/dev/revision.html            como Jenniffer (pesa y mide)
 *   /app/dev/revision.html?admin=1    como Armando (además aprueba y aplica)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import "../src/theme/skin-pixel.css";
import "../src/theme/skin-pixel-paleta.css";
import RevisionEmpaqueEnSolicitud from "../src/components/revisionEmpaque/RevisionEmpaque";
import { useTicketsAuth, type TicketsUser } from "../src/stores/ticketsAuth";

document.documentElement.dataset.mckSkin = "pixel";
const admin = new URLSearchParams(location.search).get("admin") === "1";
useTicketsAuth.setState({
  token: "banco-de-pruebas",
  user: { id: admin ? 8 : 10, username: "ejemplo", nombre: admin ? "Armando" : "Jenniffer", activo: 1,
    departamento: null, rol: { nivel: 3 }, permisos_secciones: null } as unknown as TicketsUser,
});

const pieza = (sku: string, nombre: string, casilla: string) => ({ sku, nombre, cantidad: 1, casilla });
const pub = (id: string, peso: number, m: number[]) => ({ id, status: "active", titulo: id, thumbnail: "",
  peso_g: peso, largo_cm: m[0], ancho_cm: m[1], alto_cm: m[2] });
type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const producto = (sku: string, nombre: string, presentacion: string, grupo: string, empaque: P[], meli: P[]): P => ({
  sku, nombre, presentacion, grupo_clave: grupo, empaque_receta: empaque, meli, peso_g: null, empaque_ok: null,
  caja: null, caja_otra: null, largo_cm: null, ancho_cm: null, alto_cm: null, nota: null, omitido: 0,
  motivo_omitido: null, verificado_por: null, verificado_en: null, aplicado_en: null, aplicado_resultado: null,
});
const BOLSA = [pieza("BLSMTL13X21cms", "BOLSA 13 X 21 CMS", "bolsa"), pieza("BOLSEGBLAUn", "BOLSA DE SEGURIDAD BLANCA", "bolsa"),
  pieza("ETQ250g", "ETIQUETA 3 X 2.6", "etiqueta"), pieza("PPLBRB10cms", "PAPEL BURBUJA 10CM", "proteccion")];
const productos: P[] = [
  producto("C-ALBHUE500g", "ALBUMINA DE HUEVO 500g", "500 g", "BLSMTL13X21cms · 500 g", BOLSA,
    [pub("MCO2251545783", 630, [21, 17, 6])]),
  producto("C-FRU500g", "FRUCTOSA 500g", "500 g", "BLSMTL13X21cms · 500 g", BOLSA, [pub("MCO1235506437", 2900, [18, 19, 4])]),
  producto("C-ACIGLI50P30mL", "ACIDO GLICOLICO 50% 30mL", "30 mL", "FARAZU30mL + GOTPIP77MUn",
    [pieza("FARAZU30mL", "FRASCO AZUL 30 ML", "envase"), pieza("GOTPIP77MUn", "GOTERO PIPETA 77MM", "envase"),
      pieza("TAPPERSEG18mm", "TAPA SEGURIDAD 18MM", "tapa")], [pub("MCO859831102", 121, [18, 10, 5])]),
  producto("C-KITREPCOS1", "KIT REPARADOR COSMETICO 1", "60 g", "solo:C-KITREPCOS1",
    [pieza("C-ACIGLI50P30mL", "ACIDO GLICOLICO 50% 30mL", "kit"), pieza("C-VITC30P30mL", "VITAMINA C 30% 30mL", "kit")], []),
];
const grupos: P[] = [
  { clave: "BLSMTL13X21cms · 500 g", nombre: "BOLSA 13 X 21 CMS · 500 g", rigido: 0 },
  { clave: "FARAZU30mL + GOTPIP77MUn", nombre: "FRASCO AZUL 30 ML + GOTERO PIPETA 77MM", rigido: 1 },
  { clave: "solo:C-KITREPCOS1", nombre: "Sin envase en la receta: se mide este producto", rigido: 0 },
].map((g) => ({ ...g, largo_cm: null, ancho_cm: null, alto_cm: null, nota: null, medido_por: null, medido_en: null }));
const revision = { id: 1, ticket_id: 1, titulo: "Revisión global de pesos, medidas y empaques", entregada_en: null as string | null,
  meli_refrescado_en: "2026-10-02T05:30:00" };

function estado() {
  const g = Object.fromEntries(grupos.map((x) => [x.clave, x]));
  const ps = productos.map((p) => {
    const gg = g[p.grupo_clave];
    const fin = p.largo_cm ? [p.largo_cm, p.ancho_cm, p.alto_cm] : gg.largo_cm ? [gg.largo_cm, gg.ancho_cm, gg.alto_cm] : null;
    const pm = p.meli[0];
    const listo = Boolean(p.peso_g && fin && !p.omitido);
    return { ...p, medidas_finales: fin, peso_meli: pm?.peso_g ?? null,
      medidas_meli: pm ? [pm.largo_cm, pm.ancho_cm, pm.alto_cm] : null, listo,
      diferencia: listo && pm && (Math.abs(p.peso_g - pm.peso_g) > Math.max(10, p.peso_g * 0.05)
        || fin!.some((x: number, i: number) => Math.ceil(x) !== [pm.largo_cm, pm.ancho_cm, pm.alto_cm][i])) };
  });
  const gs = grupos.map((x) => {
    const ms = ps.filter((p) => p.grupo_clave === x.clave);
    return { ...x, productos: ms.length, ejemplos: ms.map((p) => p.nombre).slice(0, 3), skus: ms.map((p) => p.sku),
      sugerido_meli: ms[0]?.medidas_meli ?? null, medido: Boolean(x.largo_cm), solo: x.clave.startsWith("solo:") };
  });
  return {
    revision, productos: ps, grupos: gs, cajas: ["BOX11X4X4", "BOX12X8X4", "BOX17X11X4", "CAJCAR5mL"], puede_aprobar: admin,
    progreso: {
      total: ps.length, pesados: ps.filter((p) => p.peso_g && !p.omitido).length, omitidos: ps.filter((p) => p.omitido).length,
      grupos_total: gs.length, grupos_medidos: gs.filter((x) => x.medido).length, listos: ps.filter((p) => p.listo).length,
      con_diferencia: ps.filter((p) => p.diferencia).length, aplicados: ps.filter((p) => p.aplicado_en).length,
    },
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const fetchReal = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/revision-empaque")) return fetchReal(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const ahora = new Date().toISOString().slice(0, 19);
  let m = url.match(/\/producto\/([^/?]+)/);
  if (m) {
    const p = productos.find((x) => x.sku === decodeURIComponent(m![1]))!;
    if (body.omitido) {
      if (!body.motivo_omitido) return json({ error: "Escribe por qué no se pudo pesar (p. ej. «no hay en bodega»)" }, 400);
      Object.assign(p, { omitido: 1, motivo_omitido: body.motivo_omitido });
    } else {
      const peso = Number(String(body.peso_g ?? "").replace(",", "."));
      if (!peso) return json({ error: "Escribe el peso en gramos" }, 400);
      Object.assign(p, { peso_g: peso, omitido: 0, empaque_ok: body.empaque_ok, caja: body.caja, caja_otra: body.caja_otra,
        nota: body.nota, largo_cm: body.largo_cm || null, ancho_cm: body.ancho_cm || null, alto_cm: body.alto_cm || null });
    }
    Object.assign(p, { verificado_por: admin ? "Armando" : "Jenniffer", verificado_en: ahora });
    return json({ ok: true });
  }
  if (url.endsWith("/grupo")) {
    const g = grupos.find((x) => x.clave === body.clave)!;
    const n = (v: unknown) => Number(String(v ?? "").replace(",", "."));
    if (!n(body.largo_cm) || !n(body.ancho_cm) || !n(body.alto_cm)) return json({ error: "Escribe las tres medidas: largo, ancho y alto" }, 400);
    Object.assign(g, { largo_cm: n(body.largo_cm), ancho_cm: n(body.ancho_cm), alto_cm: n(body.alto_cm),
      medido_por: admin ? "Armando" : "Jenniffer", medido_en: ahora });
    return json({ ok: true });
  }
  if (url.endsWith("/entregar")) {
    revision.entregada_en = ahora;
    return json({ ok: true, mensaje: "Revisión entregada (banco de pruebas)." });
  }
  if (url.endsWith("/meli/refrescar")) return json({ ok: true });
  if (url.endsWith("/meli/aplicar")) {
    return json({ resultados: (body.skus as string[]).map((sku) => {
      const p = productos.find((x) => x.sku === sku)!;
      p.aplicado_en = ahora;
      return { sku, ok: true, publicaciones: p.meli.map((x: P) => ({ id: x.id, ok: true })) };
    }) });
  }
  return json(estado());
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div className="min-h-screen bg-surface p-4">
        <div className="mx-auto max-w-xl space-y-3 rounded-2xl border border-border p-4">
          <h2 className="text-lg font-bold text-ink">Revisión global: peso, medidas y empaque de cada producto</h2>
          <RevisionEmpaqueEnSolicitud ticket={{ id: 1, subtipo: "revision_empaque" }} />
        </div>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
