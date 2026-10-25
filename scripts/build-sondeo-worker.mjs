#!/usr/bin/env bun
/**
 * build-sondeo-worker.mjs — FIX DICTAMEN-e73-implementacion-v1 §3.1.
 *
 * PRECOMPILA el worker del sondeo QR (src/lib/e14/masiva/sondeo-qr.worker.ts)
 * a un IIFE clásico autocontenido en public/scanner/sondeo-qr.worker.js.
 *
 * Por qué existe: Turbopack (Next 16) trató
 * `new Worker(new URL("./sondeo-qr.worker.ts", import.meta.url))` como ASSET
 * estático y emitió el .ts CRUDO a .next/static/media/ — el navegador jamás
 * pudo ejecutar el worker («verde falso»: build exit 0 ≠ worker compilado).
 * El artefacto precompilado en public/ (precedente: detection-worker.js de
 * scanner-core) se sirve tal cual, con MIME de JS, sin depender del bundler.
 *
 * Fuente ÚNICA: el .ts. Este script es el ÚNICO generador del artefacto —
 * el smoke del gate (smoke-sondeo-worker.mjs) re-genera a /tmp y compara
 * byte a byte para detectar artefacto obsoleto (jamás verde falso).
 *
 * Uso:      bun scripts/build-sondeo-worker.mjs
 * Salida:   public/scanner/sondeo-qr.worker.js  (comprometido al repo)
 */

const SRC = "./src/lib/e14/masiva/sondeo-qr.worker.ts";
const OUT_DIR = "./public/scanner";
const OUT = "./public/scanner/sondeo-qr.worker.js";

const banner =
  "/* GENERADO por scripts/build-sondeo-worker.mjs — NO EDITAR A MANO.\n" +
  " * Fuente única: src/lib/e14/masiva/sondeo-qr.worker.ts\n" +
  " * Regenerar: bun scripts/build-sondeo-worker.mjs\n" +
  " * Verificado por scripts/smoke-sondeo-worker.mjs (gate).\n" +
  " * FIX DICTAMEN-e73-implementacion-v1 §3.1. */\n";

const result = await Bun.build({
  entrypoints: [SRC],
  outdir: OUT_DIR, // NOTA: `outfile` a solas NO escribe en bun 1.3.14 — outdir+naming
  naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
  format: "iife", // worker CLÁSICO (sin módulos ES — import() no aplica aquí)
  target: "browser",
  minify: false, // identificadores estables → marcadores verificables por el smoke
  sourcemap: "none",
  banner,
});

if (!result.success) {
  console.error("✗ build-sondeo-worker: el bundling falló");
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

console.log(`✓ public/scanner/sondeo-qr.worker.js regenerado (${(await Bun.file(OUT).size)} bytes)`);
