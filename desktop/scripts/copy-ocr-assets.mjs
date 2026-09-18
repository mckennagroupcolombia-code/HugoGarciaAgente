// Copia el motor de OCR (tesseract.js) y el idioma a public/assets/ocr para
// servirlos desde /app/assets/ocr — Flask solo expone /app/assets — sin depender
// de un CDN. La carpeta está en .gitignore: se regenera en cada dev/build.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
for (const a of archivos) copyFileSync(a, join(destino, a.split(/[\\/]/).pop()));
// Descomprimido: Flask marca los .gz con Content-Encoding: gzip y el navegador
// recibe un cuerpo que no puede leer. ocrMarca.ts lo pide con `gzip: false`.
writeFileSync(join(destino, "eng.traineddata"), gunzipSync(readFileSync(idiomaGz)));
console.log(`OCR: ${archivos.length + 1} archivos → public/assets/ocr`);
