#!/usr/bin/env bun
/**
 * smoke-fallback-canvas-worker.mjs — Ola 5 §5.4 (R2).
 *
 * SMOKE DE BUNDLING REAL del worker de fallback canvas — mismo patrón que el
 * smoke de capa 0 (lección e73 §3.1: «exit 0 no es worker compilado»). Nació
 * porque el cliente original usaba `new URL(".../fallback-canvas.ts",
 * import.meta.url)`: Turbopack copiaba el .ts CRUDO a static/media, el
 * navegador no podía ejecutarlo y el fallback se caía en silencio.
 *
 * Afirma:
 *   1. FRESCURA — regenera a /tmp y compara BYTE A BYTE con el artefacto.
 *   2. MARCADORES — onmessage · convertToBlob · OffscreenCanvas · filtros.
 *   3. PROHIBIDOS — import( · process.env · localStorage · detector-client
 *      (el worker es DOM-free y no arrastra el cliente de OpenCV).
 *   4. CLIENTE — image-processor apunta al .worker.js precompilado (no al .ts).
 *
 * Uso: bun scripts/smoke-fallback-canvas-worker.mjs
 */
import { readFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fallos = 0;
function ok(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`);
  } else {
    fallos++;
    console.error(`✗ FALLO: ${msg}`);
  }
}

const ART = "./public/scanner/fallback-canvas.worker.js";
const SRC = "./packages/scanner-core/workers/fallback-canvas.ts";
const CLIENTE = "./packages/scanner-core/src/core/image-processor.ts";

// ── 1 · FRESCURA ────────────────────────────────────────────────────────────
const TMP_DIR = await mkdtemp(join(tmpdir(), "fallback-canvas-smoke-"));
const fresh = await Bun.build({
  entrypoints: [SRC],
  outdir: TMP_DIR,
  naming: "fallback-canvas.worker.js",
  format: "iife",
  target: "browser",
  minify: true,
  sourcemap: "none",
});
if (!fresh.success) {
  console.error("✗ FALLO: la regeneración del worker ni siquiera compila");
  for (const log of fresh.logs) console.error(String(log));
  process.exit(1);
}
const tmpBytes = await readFile(join(TMP_DIR, "fallback-canvas.worker.js"));
ok(existsSync(ART), "existe public/scanner/fallback-canvas.worker.js (artefacto comprometido)");
const artBytes = await readFile(ART);
ok(
  Buffer.compare(tmpBytes, artBytes) === 0,
  "FRESCURA · artefacto byte-idéntico a la regeneración (jamás obsoleto)",
);

// ── 2 · MARCADORES ──────────────────────────────────────────────────────────
const js = artBytes.toString("utf8");
ok(js.includes("onmessage"), "MARCADOR · onmessage presente (worker vivo)");
ok(js.includes("convertToBlob"), "MARCADOR · convertToBlob presente (PNG vía OffscreenCanvas)");
ok(js.includes("OffscreenCanvas"), "MARCADOR · OffscreenCanvas presente");
ok(js.includes('"bw"') && js.includes('"text"') && js.includes('"original"'), "MARCADOR · los 3 filtros del producto presentes");

// ── 3 · PROHIBIDOS ──────────────────────────────────────────────────────────
ok(!js.includes("import("), "PROHIBIDO · sin import( (worker clásico)");
ok(!js.includes("process.env"), "PROHIBIDO · sin process.env (no existe en worker — crashea)");
ok(!js.includes("localStorage"), "PROHIBIDO · sin localStorage (no existe en worker)");
ok(!js.includes("detector-client"), "PROHIBIDO · sin detector-client (ciclo + DOM en el grafo)");

// ── 4 · CLIENTE ─────────────────────────────────────────────────────────────
const cliente = await readFile(CLIENTE, "utf8");
ok(
  cliente.includes("/scanner/fallback-canvas.worker.js"),
  "CLIENTE · image-processor apunta al artefacto precompilado",
);
ok(
  !cliente.includes('new URL("../../workers/fallback-canvas.ts"'),
  "CLIENTE · sin new URL sobre el .ts (lo que copiaba el fuente CRUDO)",
);

if (fallos > 0) {
  console.error(`\nsmoke-fallback-canvas-worker: ${fallos} fallo(s) — VERDE FALSO BLOQUEADO`);
  process.exit(1);
}
console.log("\nsmoke-fallback-canvas-worker: TODO OK — worker compilado de verdad");
