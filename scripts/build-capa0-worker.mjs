/**
 * KIT e14-capa0-qr-worker-v1 — build del WORKER de capa 0.
 *
 * Genera `public/scanner/capa0-qr.worker.js` (IIFE clásica) desde
 * `src/lib/e14/qr/capa0-qr.worker.ts` — MISMO patrón de emisión del
 * heartbeat worker (build-heartbeat-worker.mjs): el .ts NO se deja al
 * bundler de la app (Turbopack emitió el .ts crudo como asset — FIX
 * DICTAMEN-e73-implementacion-v1 §3.1). Port del build-capa0-worker.mjs
 * de supervision-e14 al patrón local del repo.
 *
 * Uso: `bun scripts/build-capa0-worker.mjs`
 * Smoke del resultado (gate): scripts/smoke-capa0-qr-worker.mjs —
 * el bundle NO contiene zxing/process.env/import( (red line e73 §I —
 * el grafo del worker es jsQR-only).
 */
import { build } from "bun";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const resultado = await build({
  entrypoints: [join(RAIZ, "src/lib/e14/qr/capa0-qr.worker.ts")],
  outdir: join(RAIZ, "public/scanner"),
  naming: "capa0-qr.worker.js",
  format: "iife",
  target: "browser",
  minify: true,
});

if (!resultado.success) {
  console.error("BUILD FALLIDO:", resultado.logs);
  process.exit(1);
}
const bytes = await Bun.file(join(RAIZ, "public/scanner/capa0-qr.worker.js")).size;
console.log(`OK capa0-qr.worker.js emitido (${(bytes / 1024).toFixed(1)} KB)`);
