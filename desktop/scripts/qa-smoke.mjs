import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const ticketsPath = resolve(root, "src/components/TicketsPanel.tsx");
// Sidebar.tsx se borró con el remaster de navegación (4e45f3af): el armazón es Layout.tsx.
const layoutPath = resolve(root, "src/components/Layout.tsx");
const distPath = resolve(root, "dist/index.html");

assert(existsSync(ticketsPath), "No existe TicketsPanel.tsx");
assert(existsSync(layoutPath), "No existe Layout.tsx");
assert(existsSync(distPath), "No existe dist/index.html (build falló)");

const tickets = readFileSync(ticketsPath, "utf8");
const layout = readFileSync(layoutPath, "utf8");

const checks = [
  { ok: tickets.includes("Agenda"), msg: "Falta título Agenda" },
  { ok: tickets.includes("quest-nav-bar"), msg: "Falta barra de navegación quest" },
  { ok: tickets.includes("crear_mision"), msg: "Falta flujo crear misión" },
  { ok: layout.includes("barraMovil"), msg: "Falta la barra de navegación del celular en Layout" },
  { ok: tickets.includes("RecetasPanel"), msg: "Falta panel de recetas" },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  throw new Error(`QA smoke falló:\n- ${failed.map((f) => f.msg).join("\n- ")}`);
}

console.log("QA smoke OK: Centro de Mando (TicketsPanel) validado.");
