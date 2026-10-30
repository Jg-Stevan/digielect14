#!/usr/bin/env bun
/**
 * smoke-capa0-qr-worker.mjs — KIT e14-capa0-qr-worker-v1.
 *
 * SMOKE DE BUNDLING REAL del worker de capa 0 — MISMO patrón del smoke del
 * heartbeat (jamás verde falso, lección e73 §3.1: «exit 0 no es worker
 * compilado»).
 *
 * Afirma, en orden:
 *   1. FRESCURA — regenera el artefacto a /tmp y lo compara BYTE A BYTE con
 *      public/scanner/capa0-qr.worker.js (artefacto obsoleto = fallo).
 *   2. MARCADORES — el bundle contiene la cadena real (onmessage ·
 *      rescate4096 · presupuestoVencido · fines "agotado"/"sin-decode").
 *   3. PROHIBIDOS — el bundle NO contiene import( (worker clásico) ·
 *      process.env (no existe en worker) · localStorage · zxing (jamás en
 *      este grafo — red line e73 §I: el worker es jsQR-only).
 *
 * Uso: bun scripts/smoke-capa0-qr-worker.mjs
 * Sale: exit 0 = todo afirmado · exit 1 con contexto al primer fallo.
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

const ART = "./public/scanner/capa0-qr.worker.js";
const SRC = "./src/lib/e14/qr/capa0-qr.worker.ts";

// ── 1 · FRESCURA (regenerar a /tmp y comparar byte a byte) ──────────────────
const TMP_DIR = await mkdtemp(join(tmpdir(), "capa0-qr-smoke-"));
const fresh = await Bun.build({
  entrypoints: [SRC],
  outdir: TMP_DIR, // NOTA: `outfile` a solas NO escribe en bun 1.3.14 — outdir+naming
  naming: { entry: "[name].[ext]", chunk: "[name]-ash].[ext]", asset: "[name]-ash].[ext]" },
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
const tmpBytes = await readFile(join(TMP_DIR, "capa0-qr.worker.js"));
ok(existsSync(ART), "existe public/scanner/capa0-qr.worker.js (artefacto comprometido)");
const artBytes = await readFile(ART);
ok(
  Buffer.compare(tmpBytes, artBytes) === 0,
  "FRESCURA · artefacto byte-idéntico a la regeneración (jamás obsoleto)",
);

// ── 2 · MARCADORES (la cadena de capa 0 ESTÁ en el bundle) ──────────────────
const js = artBytes.toString("utf8");
ok(js.includes("onmessage"), "MARCADOR · onmessage presente (worker vivo)");
ok(js.includes("rescate4096"), "MARCADOR · rescate4096 presente (opción del plan)");
ok(js.includes("presupuestoVencido"), "MARCADOR · presupuestoVencido presente (R1.1)");
ok(js.includes("sin-decode"), "MARCADOR · fin sin-decode presente (R1.4-b)");
ok(js.includes("agotado"), "MARCADOR · fin agotado presente (R1.4-b)");

// ── 3 · PROHIBIDOS (lo que mataría el worker / rompería la red line) ────────
ok(!js.includes("import("), "PROHIBIDO · sin import( (worker clásico — import() no aplica)");
ok(!js.includes("process.env"), "PROHIBIDO · sin process.env (no existe en worker — crashea)");
ok(!js.includes("localStorage"), "PROHIBIDO · sin localStorage (contexto viaja por mensajes)");
ok(!/zxing/i.test(js), "PROHIBIDO · sin zxing (jamás en el grafo de capa 0 — e73 §I)");

if (fallos > 0) {
  console.error(`\nsmoke-capa0-qr-worker: ${fallos} fallo(s) — VERDE FALSO BLOQUEADO`);
  process.exit(1);
}
console.log("\nsmoke-capa0-qr-worker: TODO OK — worker compilado de verdad, no de mentira");
