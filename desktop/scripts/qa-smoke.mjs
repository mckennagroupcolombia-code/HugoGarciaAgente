import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const root = process.cwd();
const componentPath = resolve(root, "src/components/CincoSExperiencePanel.tsx");
const wizardPath = resolve(root, "src/components/CincoSGuidedFlow.tsx");
const distPath = resolve(root, "dist/index.html");

assert(existsSync(componentPath), "No existe CincoSExperiencePanel.tsx");
assert(existsSync(wizardPath), "No existe CincoSGuidedFlow.tsx");
assert(existsSync(distPath), "No existe dist/index.html (build falló)");

const component = readFileSync(componentPath, "utf8");
const wizard = readFileSync(wizardPath, "utf8");

const checks = [
  { ok: component.includes("Iniciar rutina"), msg: "Falta botón Iniciar rutina" },
  { ok: component.includes("Checklist de la rutina"), msg: "Falta checklist de rutina" },
  { ok: component.includes("Lista de compras (bloquea la rutina)"), msg: "Falta bloque de lista de compras" },
  { ok: component.includes("Programación de rutina"), msg: "Falta editor de programación" },
  { ok: component.includes("Pre-flight (editable)"), msg: "Falta editor de pre-flight" },
  { ok: component.includes("Core-process (editable)"), msg: "Falta editor de core-process" },
  { ok: component.includes("Post-flight (editable)"), msg: "Falta editor de post-flight" },
  { ok: wizard.includes("Inventario / despensa"), msg: "Falta paso inventario/despensa en wizard" },
  { ok: wizard.includes("Materiales (uno por línea"), msg: "Falta paso de materiales en wizard" },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  throw new Error(`QA smoke falló:\n- ${failed.map((f) => f.msg).join("\n- ")}`);
}

console.log("QA smoke OK: flujo 5S validado.");
