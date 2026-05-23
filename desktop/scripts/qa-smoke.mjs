import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const ticketsPath = resolve(root, "src/components/TicketsPanel.tsx");
const distPath = resolve(root, "dist/index.html");

assert(existsSync(ticketsPath), "No existe TicketsPanel.tsx");
assert(existsSync(distPath), "No existe dist/index.html (build falló)");

const tickets = readFileSync(ticketsPath, "utf8");

const checks = [
  { ok: tickets.includes("Centro de Mando"), msg: "Falta título Centro de Mando" },
  { ok: tickets.includes("quest-nav-bar"), msg: "Falta barra de navegación quest" },
  { ok: tickets.includes("crear_mision"), msg: "Falta flujo crear misión" },
  { ok: tickets.includes("QuestThemeToggle"), msg: "Falta toggle de tema" },
  { ok: tickets.includes("RecetasPanel"), msg: "Falta panel de recetas" },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  throw new Error(`QA smoke falló:\n- ${failed.map((f) => f.msg).join("\n- ")}`);
}

console.log("QA smoke OK: Centro de Mando (TicketsPanel) validado.");
