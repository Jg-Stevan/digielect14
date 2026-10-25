#!/usr/bin/env bun
/**
 * build-heartbeat-worker.mjs — KIT e14-obs-hang-atribucion-v1 (§C.1).
 *
 * PRECOMPILA el worker del heartbeat (src/lib/e14/obs/heartbeat.worker.ts)
 * a un IIFE clásico autocontenido en public/scanner/heartbeat.worker.js.
 *
 * Por qué existe: el SMOKE DE BUNDLING §C.1 (puerta del kit) re-confirmó
 * en este build la lección e73 §3.1 — Turbopack (Next 16) trató
 * `new Worker(new URL("./heartbeat.worker.ts", import.meta.url))` como
 * ASSET estático y emitió el .ts CRUDO a .next/static/media/
 * (evidencia: heartbeat.worker.*.ts crudo en el build del 25-oct). El
 * navegador jamás pudo ejecutar ese worker («verde falso»). El artefacto
 * precompilado en public/ (precedentes: detection-worker.js de
 * scanner-core · sondeo-qr.worker.js del FIX DICTAMEN-e73) se sirve tal
 * cual, con MIME de JS, sin depender del bundler.
 *
 * Fuente ÚNICA: el .ts. Este script es el ÚNICO generador del artefacto —
 * el smoke del gate (smoke-heartbeat-worker.mjs) re-genera a /tmp y
 * compara byte a byte para detectar artefacto obsoleto (jamás verde falso).
 *
 * Uso:      bun scripts/build-heartbeat-worker.mjs
 * Salida:   public/scanner/heartbeat.worker.js  (comprometido al repo)
 */

const SRC = "./src/lib/e14/obs/heartbeat.worker.ts";
const OUT_DIR = "./public/scanner";
const OUT = "./public/scanner/heartbeat.worker.js";

const banner =
  "/* GENERADO por scripts/build-heartbeat-worker.mjs — NO EDITAR A MANO.\n" +
  " * Fuente única: src/lib/e14/obs/heartbeat.worker.ts\n" +
  " * Regenerar: bun scripts/build-heartbeat-worker.mjs\n" +
  " * Verificado por scripts/smoke-heartbeat-worker.mjs (gate).\n" +
  " * KIT e14-obs-hang-atribucion-v1 (§C.1 — patrón FIX DICTAMEN-e73 §3.1). */\n";

const result = await Bun.build({
  entrypoints: [SRC],
  outdir: OUT_DIR, // NOTA: `outfile` a solas NO escribe en bun 1.3.14 — outdir+naming
  naming: { entry: "[name].[ext]", chunk: "[name]-ash].[ext]", asset: "[name]-ash].[ext]" },
  format: "iife", // worker CLÁSICO (sin módulos ES — el núcleo se inlinea)
  target: "browser",
  minify: false, // identificadores estables → marcadores verificables por el smoke
  sourcemap: "none",
  banner,
});

if (!result.success) {
  console.error("✗ build-heartbeat-worker: el bundling falló");
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

console.log(`✓ public/scanner/heartbeat.worker.js regenerado (${(await Bun.file(OUT).size)} bytes)`);
