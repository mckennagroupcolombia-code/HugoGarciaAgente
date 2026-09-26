// Permisos de paneles: el menú y el guard de App.tsx deben decir lo mismo.
//
// Si divergen, un panel visible en el menú rebota al abrirse y —porque
// HubNavTabs guarda el último subpanel visitado del hub— la sección COMPLETA
// queda inaccesible. Pasó con "Correo Ventas" y el usuario jerry: toda la
// sección Atención dejó de abrirse aunque tenía los permisos.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** App.tsx no puede tener su propia escalera de permisos: delega en panelAccess. */
function verificarDelegacion() {
  const src = readFileSync(join(raiz, "src/App.tsx"), "utf8");
  const i = src.indexOf("function puedeVerPanel(");
  assert(i > 0, "App.tsx ya no define puedeVerPanel — revisar este QA");
  const cuerpo = src.slice(i, src.indexOf("\n}\n", i));
  assert(
    cuerpo.includes("puedeVerSeccionPanel("),
    "puedeVerPanel debe delegar en puedeVerSeccionPanel (lib/panelAccess)",
  );
  assert(
    !cuerpo.includes("permisos_secciones"),
    "puedeVerPanel volvió a leer permisos_secciones: duplica la lógica del menú",
  );
}

/** Compila los módulos de permisos a ESM para poder ejecutarlos acá. */
function compilar(dir) {
  const entry = join(dir, "entry.ts");
  const bundle = join(dir, "permisos.mjs");
  writeFileSync(
    entry,
    [
      `export { puedeVerSeccionPanel } from ${JSON.stringify(join(raiz, "src/lib/panelAccess"))};`,
      `export { catalogoPermisos } from ${JSON.stringify(join(raiz, "src/lib/permisosCatalogo"))};`,
      `export { NAV_SECTIONS } from ${JSON.stringify(join(raiz, "src/lib/navStructure"))};`,
    ].join("\n"),
  );
  execFileSync(
    "npx",
    ["esbuild", entry, "--bundle", "--format=esm", `--outfile=${bundle}`, "--log-level=error"],
    { cwd: raiz, stdio: ["ignore", "ignore", "inherit"] },
  );
  return bundle;
}

async function verificarAtencion() {
  const dir = mkdtempSync(join(tmpdir(), "qa-panel-access-"));
  try {
    const { puedeVerSeccionPanel, catalogoPermisos, NAV_SECTIONS } = await import(compilar(dir));
    // Despachos (operario, nivel 1) con los permisos que tiene en producción.
    const despachos = {
      id: 10,
      nombre: "Despachos",
      username: "despachos",
      rol: { id: 3, nombre: "Operario", nivel: 1 },
      permisos_secciones: {
        preventa: true, postventa: true, pedidos: true, empaque: true,
        whatsapp: true, stock: true, facturas: true, sync: true,
        tickets: true, settings: true,
      },
    };
    const atencion = ["preventa", "postventa", "ventas-email", "pedidos", "empaque", "guias-envio", "whatsapp"];
    for (const panel of atencion) {
      assert(
        puedeVerSeccionPanel(despachos, panel) === true,
        `Atención: despachos debería ver "${panel}" y no lo ve`,
      );
    }
    // Sin permisos de contabilidad no se cuela el Libro Mayor.
    assert(!puedeVerSeccionPanel(despachos, "libro-mayor"), "libro-mayor no debe heredarse");
    assert(!puedeVerSeccionPanel(despachos, "prestamos"), "prestamos no debe heredarse");

    // Todo panel que exija permiso debe poder otorgarse desde Gestión de
    // usuarios. Si no, el acceso existe en el código y en la base pero nadie
    // puede darlo (pasó con Solicitudes de pago, Préstamos, Socios y Agente WA).
    const otorgables = new Set(catalogoPermisos().flatMap((g) => g.permisos.map((p) => p.id)));
    const sonda = (perm) => ({ ...despachos, permisos_secciones: perm });
    for (const seccion of NAV_SECTIONS) {
      for (const { panel } of seccion.items) {
        if (puedeVerSeccionPanel(sonda({}), panel)) continue; // abierto a todos
        // Su propia clave: si el código la honra, tiene que haber casilla. No
        // vale que el panel se alcance por herencia (Solicitudes de pago se
        // abría con libro-mayor, y por eso nadie notó que faltaba `pagos`).
        if (puedeVerSeccionPanel(sonda({ [panel]: true }), panel)) {
          assert(
            otorgables.has(panel),
            `Panel "${panel}" (${seccion.id}) usa el permiso "${panel}" y no tiene casilla en Gestión de usuarios`,
          );
          continue;
        }
        const clave = [...otorgables].find((k) => puedeVerSeccionPanel(sonda({ [k]: true }), panel));
        assert(
          clave,
          `Panel "${panel}" (${seccion.id}) exige permiso pero ninguna casilla de Gestión de usuarios lo otorga`,
        );
      }
    }
    verificarGuardBackend(catalogoPermisos);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Lo que el backend exige también tiene que poder otorgarse desde el panel.
 *
 * `app/routes.py` protege la contabilidad con un guard por prefijo cuyos grupos
 * viven en `PERMISOS_CONTABILIDAD`. Si una de esas claves no tiene casilla en
 * Gestión de usuarios, el endpoint queda cerrado para siempre: nadie puede
 * conceder lo que la UI no ofrece. Es la otra mitad del problema que ya se vio
 * en el frontend con Solicitudes de pago.
 */
function verificarGuardBackend(catalogoPermisos) {
  const rutas = readFileSync(join(raiz, "..", "app", "routes.py"), "utf8");
  const i = rutas.indexOf("PERMISOS_CONTABILIDAD = {");
  assert(i > 0, "app/routes.py ya no define PERMISOS_CONTABILIDAD — revisar este QA");
  const literal = rutas.slice(i, rutas.indexOf("\n}", i));
  // Solo las claves de permiso (van dentro de los paréntesis de cada grupo);
  // los nombres de grupo son las llaves del diccionario y no se otorgan.
  const claves = new Set();
  for (const grupo of literal.matchAll(/\(([^)]*)\)/g)) {
    for (const m of grupo[1].matchAll(/"([^"]+)"/g)) claves.add(m[1]);
  }
  assert(claves.has("pagos") && claves.has("libro-mayor"), "el guard perdió sus claves conocidas");

  const otorgables = new Set(catalogoPermisos().flatMap((g) => g.permisos.map((p) => p.id)));
  for (const clave of claves) {
    assert(
      otorgables.has(clave),
      `El guard de app/routes.py exige el permiso "${clave}" y Gestión de usuarios no tiene casilla para otorgarlo`,
    );
  }
}

verificarDelegacion();
await verificarAtencion();
console.log("qa-panel-access OK");
