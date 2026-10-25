#!/usr/bin/env bun
/**
 * smoke-heartbeat-worker.mjs — KIT e14-obs-hang-atribucion-v1 (§C.1).
 *
 * SMOKE DE BUNDLING REAL del worker del heartbeat — integrado al gate
 * (check-quality.sh) para que JAMÁS vuelva a pasar un verde falso
 * (lección e73 §3.1 re-confirmada por el §C.1 de este kit: «exit 0 no es
 * worker compilado» — Turbopack emitió el .ts crudo a static/media).
 *
 * Afirma, en orden:
 *   1. FRESCURA — regenera el artefacto a /tmp y lo compara BYTE A BYTE con
 *      public/scanner/heartbeat.worker.js (artefacto obsoleto = fallo).
 *   2. MARCADORES — el bundle contiene la lógica real del guardián
 *      (debeMarcar · debeDesmarcar · e14-hang-wal · lápida).
 *   3. PROHIBIDOS — el bundle NO contiene import( (worker clásico) ·
 *      process.env (no existe en worker) · console. (privacidad obs) ·
 *      localStorage (privacidad obs — el contexto viaja por mensajes) ·
 *      zxing (jamás en este grafo).
 *   4. CLIENTE — en el build de la app (.next): CERO assets .ts bajo
 *      static/media, CERO referencias al .ts del worker, y el chunk del
 *      cliente SÍ referencia heartbeat.worker.js.
 *
 * Uso: bun scripts/smoke-heartbeat-worker.mjs   (tras `bun run build`)
 * Sale: exit 0 = todo afirmado · exit 1 con contexto al primer fallo.
 */

import { readdir, readFile, mkdtemp } from "node:fs/promises";
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

const ART = "./public/scanner/heartbeat.worker.js";
const SRC = "./src/lib/e14/obs/heartbeat.worker.ts";
const BANNER =
  "/* GENERADO por scripts/build-heartbeat-worker.mjs — NO EDITAR A MANO.\n" +
  " * Fuente única: src/lib/e14/obs/heartbeat.worker.ts\n" +
  " * Regenerar: bun scripts/build-heartbeat-worker.mjs\n" +
  " * Verificado por scripts/smoke-heartbeat-worker.mjs (gate).\n" +
  " * KIT e14-obs-hang-atribucion-v1 (§C.1 — patrón FIX DICTAMEN-e73 §3.1). */\n";

// ── 1 · FRESCURA (regenerar a /tmp y comparar byte a byte) ──────────────────
const TMP_DIR = await mkdtemp(join(tmpdir(), "heartbeat-smoke-"));
const fresh = await Bun.build({
  entrypoints: [SRC],
  outdir: TMP_DIR, // NOTA: `outfile` a solas NO escribe en bun 1.3.14 — outdir+naming
  naming: { entry: "[name].[ext]", chunk: "[name]-ash].[ext]", asset: "[name]-ash].[ext]" },
  format: "iife",
  target: "browser",
  minify: false,
  sourcemap: "none",
  banner: BANNER,
});
if (!fresh.success) {
  console.error("✗ FALLO: la regeneración del worker ni siquiera compila");
  for (const log of fresh.logs) console.error(String(log));
  process.exit(1);
}
const tmpBytes = await readFile(join(TMP_DIR, "heartbeat.worker.js"));
ok(existsSync(ART), "existe public/scanner/heartbeat.worker.js (artefacto comprometido)");
const artBytes = await readFile(ART);
ok(
  Buffer.compare(tmpBytes, artBytes) === 0,
  "FRESCURA · artefacto byte-idéntico a la regeneración (jamás obsoleto)",
);

// ── 2 · MARCADORES (la lógica del guardián ESTÁ en el bundle) ───────────────
const js = artBytes.toString("utf8");
ok(js.includes("debeMarcar"), "MARCADOR · debeMarcar presente (decisión de marca)");
ok(js.includes("debeDesmarcar"), "MARCADOR · debeDesmarcar presente (borra al reanudar)");
ok(js.includes("e14-hang-wal"), "MARCADOR · DB propia e14-hang-wal presente (WAL)");
ok(js.includes("escribirLapida"), "MARCADOR · escribirLapida presente (desenlace limpio)");
ok(js.includes("onmessage"), "MARCADOR · cableado onmessage presente (worker vivo)");

// ── 3 · PROHIBIDOS (lo que mataría el worker / rompería privacidad) ────────
ok(!js.includes("import("), "PROHIBIDO · sin import( (worker clásico — import() no aplica)");
ok(!js.includes("process.env"), "PROHIBIDO · sin process.env (no existe en worker — crashea)");
ok(!js.includes("console."), "PROHIBIDO · sin console. (privacidad obs — qa-obs-privacidad)");
ok(!js.includes("localStorage"), "PROHIBIDO · sin localStorage (contexto viaja por mensajes)");
ok(!/zxing/i.test(js), "PROHIBIDO · sin zxing (jamás en el grafo del heartbeat)");

// ── 4 · CLIENTE (el build de la app NO apunta a .ts; SÍ al .worker.js) ──────
const NEXT_STATIC = ".next/static";
if (existsSync(NEXT_STATIC)) {
  // (a) cero assets .ts bajo static/media
  const media = `${NEXT_STATIC}/media`;
  const mediaFiles = existsSync(media) ? await readdir(media) : [];
  const tsAssets = mediaFiles.filter((f) => f.endsWith(".ts"));
  ok(
    tsAssets.length === 0,
    `CLIENTE · cero assets .ts en static/media (${mediaFiles.length} archivos escaneados)`,
  );
  // (b) cero referencias al .ts del worker + (c) referencia al .worker.js
  let refTs = 0;
  let refJs = 0;
  async function escanear(dir) {
    for (const f of await readdir(dir, { withFileTypes: true })) {
      const p = `${dir}/${f.name}`;
      if (f.isDirectory()) await escanear(p);
      else if (f.name.endsWith(".js")) {
        const s = await readFile(p, "utf8");
        if (s.includes("heartbeat.worker.ts")) refTs++;
        if (s.includes("heartbeat.worker.js")) refJs++;
      }
    }
  }
  await escanear(NEXT_STATIC);
  ok(refTs === 0, `CLIENTE · cero chunks referenciando heartbeat.worker.ts (${refTs})`);
  ok(refJs > 0, `CLIENTE · el build referencia heartbeat.worker.js (${refJs} chunks)`);
} else {
  console.log("· (.next/static no existe — smoke de cliente se ejecuta tras `bun run build`)");
}

if (fallos > 0) {
  console.error(`\nsmoke-heartbeat-worker: ${fallos} fallo(s) — VERDE FALSO BLOQUEADO`);
  process.exit(1);
}
console.log("\nsmoke-heartbeat-worker: TODO OK — worker compilado de verdad, no de mentira");
