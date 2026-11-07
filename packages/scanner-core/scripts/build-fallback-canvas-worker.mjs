/**
 * build-fallback-canvas-worker.mjs — Ola 5 §5.4 (R2).
 *
 * Emite `public/scanner/fallback-canvas.worker.js` (IIFE clásica) desde
 * `workers/fallback-canvas.ts`. Misma lección que el worker de capa 0
 * (DICTAMEN-e73 §3.1): el .ts NO se deja al bundler de la app — Turbopack lo
 * copia CRUDO como asset de `static/media`, el navegador no puede ejecutarlo y
 * el fallback se cae en silencio.
 *
 * Solo lo corre digielect14 (el worker vive en su copia del paquete; el hermano
 * no tiene el archivo). Uso desde la raíz de la app:
 *   bun packages/scanner-core/scripts/build-fallback-canvas-worker.mjs
 */
import { build } from "bun";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const PAQUETE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
let outDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) outDir = resolve(args[i + 1]);
}
if (!outDir) outDir = resolve(process.cwd(), "public", "scanner");

const resultado = await build({
  entrypoints: [join(PAQUETE, "workers", "fallback-canvas.ts")],
  outdir: outDir,
  naming: "fallback-canvas.worker.js",
  format: "iife",
  target: "browser",
  minify: true,
});

if (!resultado.success) {
  console.error("BUILD FALLIDO:", resultado.logs);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const bytes = await Bun.file(join(outDir, "fallback-canvas.worker.js")).size;
console.log(`OK fallback-canvas.worker.js emitido (${(bytes / 1024).toFixed(1)} KB) → ${outDir}`);
