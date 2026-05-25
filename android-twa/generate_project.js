/**
 * Genera el proyecto Android TWA sin interacción usando la API de bubblewrap/core.
 */
const path = require('path');
const BUBBLEWRAP_CLI = '/home/mckg/.nvm/versions/node/v22.22.2/lib/node_modules/@bubblewrap/cli';
const corePath = path.join(BUBBLEWRAP_CLI, 'node_modules/@bubblewrap/core');
const { TwaManifest } = require(path.join(corePath, 'dist/lib/TwaManifest'));
const { TwaGenerator } = require(path.join(corePath, 'dist/lib/TwaGenerator'));
const { AndroidSdkTools } = require(path.join(corePath, 'dist/lib/androidSdk/AndroidSdkTools'));
const { JdkHelper } = require(path.join(corePath, 'dist/lib/jdk/JdkHelper'));
const { ConsoleLog } = require(path.join(corePath, 'dist/lib/Log'));

const OUTPUT_DIR = __dirname;
const JDK_PATH = '/usr/lib/jvm/java-21-openjdk-amd64';
const SDK_PATH = '/home/mckg/Android/Sdk';

async function main() {
  const log = new ConsoleLog('generate');
  const jdkHelper = new JdkHelper(process, { jdkPath: JDK_PATH, androidSdkPath: SDK_PATH }, log);
  const androidSdkTools = await AndroidSdkTools.create(process, { jdkPath: JDK_PATH, androidSdkPath: SDK_PATH }, jdkHelper, log);

  // Leer el twa-manifest.json que ya creamos
  const twaManifest = await TwaManifest.fromFile(path.join(OUTPUT_DIR, 'twa-manifest.json'));
  console.log('Manifest leído:', twaManifest.name, twaManifest.packageId);

  // Generar proyecto
  const generator = new TwaGenerator();
  await generator.createTwaProject(OUTPUT_DIR, twaManifest, log);
  console.log('✅ Proyecto Android generado en', OUTPUT_DIR);
}

main().catch((e) => {
  console.error('❌ Error:', e.message || e);
  process.exit(1);
});
