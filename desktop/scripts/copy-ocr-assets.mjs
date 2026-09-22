// Copia el motor de OCR (tesseract.js) y el idioma a public/assets/ocr para
// servirlos desde /app/assets/ocr — Flask solo expone /app/assets — sin depender
// de un CDN. La carpeta está en .gitignore: se regenera en cada dev/build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "public", "assets", "ocr");
const paquete = (nombre) => dirname(require.resolve(`${nombre}/package.json`));

const core = paquete("tesseract.js-core");
const archivos = [
  join(paquete("tesseract.js"), "dist", "worker.min.js"),
  // El worker elige uno según el soporte SIMD del navegador.
  join(core, "tesseract-core-relaxedsimd-lstm.wasm.js"),
  join(core, "tesseract-core-simd-lstm.wasm.js"),
  join(core, "tesseract-core-lstm.wasm.js"),
];
const idiomaGz = join(paquete("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz");

mkdirSync(destino, { recursive: true });
// Dos personas compilan en esta máquina (mckg y cynthia). `copyFileSync` sobre un archivo que
// dejó la otra falla con EPERM —intenta ajustarle los permisos y no es su dueño— y el build
// entero moría antes de llegar a tsc. Si ya está y pesa lo mismo, no se toca; si no, se borra
// (para eso basta con poder escribir en la carpeta) y se copia de nuevo.
const copiar = (origen, dest) => {
  if (existsSync(dest) && statSync(dest).size === statSync(origen).size) return;
  rmSync(dest, { force: true });
  copyFileSync(origen, dest);
};
for (const a of archivos) copiar(a, join(destino, a.split(/[\\/]/).pop()));
// Descomprimido: Flask marca los .gz con Content-Encoding: gzip y el navegador
// recibe un cuerpo que no puede leer. ocrMarca.ts lo pide con `gzip: false`.
const idioma = gunzipSync(readFileSync(idiomaGz));
const destIdioma = join(destino, "eng.traineddata");
if (!(existsSync(destIdioma) && statSync(destIdioma).size === idioma.length)) {
  rmSync(destIdioma, { force: true });
  writeFileSync(destIdioma, idioma);
}
console.log(`OCR: ${archivos.length + 1} archivos → public/assets/ocr`);
