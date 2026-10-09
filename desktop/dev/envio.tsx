/**
 * Banco de pruebas de la pieza «Envío» del Árbol del producto — SOLO `npm run dev`.
 *
 * Monta el emergente real (revisionEmpaque/EnvioEmergente) SIN backend (`fetch` interceptado):
 * un combo en bolsa que comparte tipo de empaque con otro, publicado en MeLi. Lo que se guarda
 * vive en memoria. No entra al build y no escribe en MeLi.
 *
 *   /app/dev/envio.html             quien diseña el producto (pesa y mide)
 *   /app/dev/envio.html?admin=1     además aplica en MeLi
 *   /app/dev/envio.html?full=1      con una publicación en Full
 *   /app/dev/envio.html?nuevo=1     combo creado después de la revisión
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/index.css";
import "../src/theme/skin-pixel.css";
import "../src/theme/skin-pixel-paleta.css";
import EnvioEmergente from "../src/components/revisionEmpaque/EnvioEmergente";
import { useTicketsAuth, type TicketsUser } from "../src/stores/ticketsAuth";

document.documentElement.dataset.mckSkin = "pixel";
const q = new URLSearchParams(location.search);
const admin = q.get("admin") === "1";
let incluido = q.get("nuevo") !== "1";
useTicketsAuth.setState({
  token: "banco-de-pruebas",
  user: { id: admin ? 8 : 3, username: "ejemplo", nombre: admin ? "Armando" : "Cynthia", activo: 1,
    departamento: null, rol: { nivel: 3 }, permisos_secciones: null } as unknown as TicketsUser,
});

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pieza = (sku: string, nombre: string, casilla: string) => ({ sku, nombre, cantidad: 1, casilla });
const pubs: P[] = [{ id: "MCO2251545783", status: "active", titulo: "Albúmina De Huevo 500 G", thumbnail: "",
  peso_g: 2900, largo_cm: 10, ancho_cm: 10, alto_cm: 10, logistica: "cross_docking" }];
if (q.get("full") === "1") pubs.push({ ...pubs[0], id: "MCO1999999999", logistica: "fulfillment" });
const p: P = {
  sku: "C-ALBHUE500g", nombre: "ALBUMINA DE HUEVO 500g", presentacion: "500 g", grupo_clave: "BLSMTL13X21cms · 500 g",
  empaque_receta: [pieza("BLSMTL13X21cms", "BOLSA 13 X 21 CMS", "bolsa"), pieza("BOLSEGBLAUn", "BOLSA DE SEGURIDAD BLANCA", "bolsa"),
    pieza("ETQ250g", "ETIQUETA 3 X 2.6", "etiqueta")],
  meli: pubs, peso_g: null, empaque_ok: null, caja: null, caja_otra: null, largo_cm: null, ancho_cm: null, alto_cm: null,
  nota: null, omitido: 0, motivo_omitido: null, verificado_por: null, verificado_en: null, aplicado_en: null,
};
const g: P = { clave: "BLSMTL13X21cms · 500 g", nombre: "BOLSA 13 X 21 CMS · 500 g", rigido: 0, largo_cm: null,
  ancho_cm: null, alto_cm: null, nota: null, medido_por: null, medido_en: null };
const META = [["SELLER_PACKAGE_WEIGHT", "Peso", "g"], ["SELLER_PACKAGE_LENGTH", "Largo", "cm"],
  ["SELLER_PACKAGE_WIDTH", "Ancho", "cm"], ["SELLER_PACKAGE_HEIGHT", "Alto", "cm"]].map(([id, nombre, unidad]) => ({ id, nombre, unidad }));

function respuesta() {
  if (!incluido) return { en_revision: false, sku: p.sku, hay_revision: true, meli_pide: META };
  const fin = p.largo_cm ? [p.largo_cm, p.ancho_cm, p.alto_cm] : g.largo_cm ? [g.largo_cm, g.ancho_cm, g.alto_cm] : null;
  const m = p.meli[0];
  const listo = Boolean(p.peso_g && fin && !p.omitido);
  const diferencia = listo && Boolean(m) && (Math.abs(p.peso_g - m.peso_g) > Math.max(10, p.peso_g * 0.05)
    || fin!.some((x: number, i: number) => Math.ceil(x) !== [m.largo_cm, m.ancho_cm, m.alto_cm][i]));
  const prod = { ...p, medidas_finales: fin, peso_meli: m?.peso_g ?? null, medidas_meli: m ? [m.largo_cm, m.ancho_cm, m.alto_cm] : null,
    listo, diferencia };
  const nums = listo ? [Math.round(p.peso_g), ...fin!.map((x: number) => Math.ceil(x))] : null;
  return {
    en_revision: true, sku: p.sku,
    revision: { id: 1, titulo: "Revisión global", folio: "TKT-2026-1639", creada_por: "Armando Garcia", meli_refrescado_en: null },
    producto: prod,
    grupo: { ...g, productos: 2, ejemplos: [p.nombre, "FRUCTOSA 500g"], skus: [p.sku, "C-FRU500g"], sugerido_meli: [18, 19, 4],
      medido: Boolean(g.largo_cm), solo: false },
    pieza: { estado: listo ? (diferencia ? "aviso" : "ok") : "falta", detalle: "" },
    cajas: ["BOX11X4X4", "BOX12X8X4", "BOX17X11X4", "CAJCAR5mL"], puede_aprobar: admin, meli_pide: META,
    a_enviar: nums && META.map((a, i) => ({ id: a.id, value_name: `${nums[i]} ${a.unidad}`, value_struct: { number: nums[i], unit: a.unidad } })),
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const n = (v: unknown) => Number(String(v ?? "").replace(",", "."));
const fetchReal = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/revision-empaque/sku/")) return fetchReal(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const ahora = new Date().toISOString().slice(0, 19);
  if (url.endsWith("/incluir")) { incluido = true; return json({ ok: true }); }
  if (url.endsWith("/producto")) {
    if (body.omitido) Object.assign(p, { omitido: 1, motivo_omitido: body.motivo_omitido });
    else {
      if (!n(body.peso_g)) return json({ error: "Escribe el peso en gramos" }, 400);
      Object.assign(p, { peso_g: n(body.peso_g), omitido: 0, empaque_ok: body.empaque_ok, caja: body.caja, nota: body.nota });
    }
    Object.assign(p, { verificado_por: admin ? "Armando" : "Cynthia", verificado_en: ahora });
    return json({ ok: true });
  }
  if (url.endsWith("/grupo")) {
    if (!n(body.largo_cm) || !n(body.ancho_cm) || !n(body.alto_cm)) return json({ error: "Escribe las tres medidas: largo, ancho y alto" }, 400);
    Object.assign(g, { largo_cm: n(body.largo_cm), ancho_cm: n(body.ancho_cm), alto_cm: n(body.alto_cm),
      medido_por: admin ? "Armando" : "Cynthia", medido_en: ahora });
    return json({ ok: true });
  }
  if (url.endsWith("/medidas")) {
    Object.assign(p, { largo_cm: n(body.largo_cm) || null, ancho_cm: n(body.ancho_cm) || null, alto_cm: n(body.alto_cm) || null });
    return json({ ok: true });
  }
  if (url.endsWith("/meli/releer")) return json({ ok: true, publicaciones: p.meli.length });
  if (url.endsWith("/meli/aplicar")) {
    const r = respuesta() as P;
    const [peso, largo, ancho, alto] = r.a_enviar.map((a: P) => a.value_struct.number);
    p.meli = p.meli.map((m: P) => ({ ...m, peso_g: peso, largo_cm: largo, ancho_cm: ancho, alto_cm: alto }));
    p.aplicado_en = ahora;
    return json({ resultados: [{ sku: p.sku, ok: true, publicaciones: p.meli.map((m: P) => ({ id: m.id, ok: true })) }] });
  }
  return json(respuesta());
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div className="min-h-screen bg-surface p-4">
        <EnvioEmergente sku={p.sku} nombre={p.nombre} onCerrar={() => location.reload()} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
