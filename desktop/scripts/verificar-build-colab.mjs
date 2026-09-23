// Falla el build si al bundle de colaboradores (dist-colab/) se le cuela algo
// del panel interno: sourcemaps, rutas de API que no son suyas o nombres de
// módulos. Un import descuidado en ColaboradoresPanel.tsx bastaría para
// arrastrar medio panel sin que nadie lo note.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../dist-colab/assets/", import.meta.url).pathname;
const RUTAS_PERMITIDAS = ["/api/colaboradores/", "/api/tickets/"];
const PROHIBIDO = [
  "Contabilidad", "Libro Mayor", "Declarador", "Alegra", "Siigo", "Mercado Libre", "MeLi",
  "Cynthia", "Préstamos", "panelInfo", "flujoApp", "permisos_secciones.contador",
];

const fallas = [];
for (const f of readdirSync(dir)) {
  if (f.endsWith(".map")) { fallas.push(`sourcemap en el bundle: ${f}`); continue; }
  if (!/\.(js|css)$/.test(f)) continue;
  const txt = readFileSync(join(dir, f), "utf8");
  for (const m of txt.matchAll(/["'`](\/api\/[A-Za-z0-9_/-]+)/g)) {
    const ruta = m[1];
    if (ruta !== "/api/" && !RUTAS_PERMITIDAS.some((p) => ruta.startsWith(p))) fallas.push(`${f}: ruta ${ruta}`);
  }
  for (const p of PROHIBIDO) if (txt.includes(p)) fallas.push(`${f}: contiene «${p}»`);
}
if (fallas.length) {
  console.error("✗ El build de colaboradores trae cosas del panel interno:\n  " + [...new Set(fallas)].join("\n  "));
  process.exit(1);
}
console.log("✓ build de colaboradores limpio");
