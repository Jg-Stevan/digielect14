#!/usr/bin/env bun
/**
 * smoke-sondeo-worker.mjs — FIX DICTAMEN-e73-implementacion-v1 §3.2.
 *
 * SMOKE DE BUNDLING REAL — integrado al gate (check-quality.sh) para que
 * JAMÁS vuelva a pasar un verde falso (lección del dictamen: «exit 0 no es
 * worker compilado»).
 *
 * Afirma, en orden:
 *   1. FRESCURA — regenera el artefacto a /tmp y lo compara BYTE A BYTE con
 *      public/scanner/sondeo-qr.worker.js (artefacto obsoleto = fallo).
 *   2. MARCADORES — el bundle contiene la lógica real del ladder
 *      (sondearEnWorker · ladderSondeoDePixeles · barridoQrDePixeles).
 *   3. PROHIBIDOS — el bundle NO contiene import( (worker clásico) ·
 *      zxing (red line §I) · process.env (crashearía: sin process en worker).
 *   4. CLIENTE — en el build de la app (.next): CERO assets .ts bajo
 *      static/media, CERO referencias al .ts del worker, y el chunk del
 *      cliente SÍ referencia sondeo-qr.worker.js.
 *   5. ENTREGA — el artefacto aparece en el output servible (out/ si existe).
 *
 * Uso: bun scripts/smoke-sondeo-worker.mjs   (tras `bun run build`)
 * Sale: exit 0 = todo afirmado · exit 1 con contexto al primer fallo.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
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

const ART = "./public/scanner/sondeo-qr.worker.js";
const SRC = "./src/lib/e14/masiva/sondeo-qr.worker.ts";
const BANNER =
  "/* GENERADO por scripts/build-sondeo-worker.mjs — NO EDITAR A MANO.\n" +
  " * Fuente única: src/lib/e14/masiva/sondeo-qr.worker.ts\n" +
  " * Regenerar: bun scripts/build-sondeo-worker.mjs\n" +
  " * Verificado por scripts/smoke-sondeo-worker.mjs (gate).\n" +
  " * FIX DICTAMEN-e73-implementacion-v1 §3.1. */\n";

// ── 1 · FRESCURA (regenerar a /tmp y comparar byte a byte) ──────────────────
const TMP_DIR = await mkdtemp(join(tmpdir(), "sondeo-smoke-"));
const fresh = await Bun.build({
  entrypoints: [SRC],
  outdir: TMP_DIR, // NOTA: `outfile` a solas NO escribe en bun 1.3.14 — outdir+naming
  naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
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
const tmpBytes = await readFile(join(TMP_DIR, "sondeo-qr.worker.js"));
ok(existsSync(ART), "existe public/scanner/sondeo-qr.worker.js (artefacto comprometido)");
const artBytes = await readFile(ART);
ok(
  Buffer.compare(tmpBytes, artBytes) === 0,
  "FRESCURA · artefacto byte-idéntico a la regeneración (jamás obsoleto)",
);

// ── 2 · MARCADORES (la lógica del ladder ESTÁ en el bundle) ─────────────────
const js = artBytes.toString("utf8");
ok(js.includes("sondearEnWorker"), "MARCADOR · sondearEnWorker presente (lógica del mensaje)");
ok(js.includes("ladderSondeoDePixeles"), "MARCADOR · ladderSondeoDePixeles presente (S1/S2/S3)");
ok(js.includes("barridoQrDePixeles"), "MARCADOR · barridoQrDePixeles presente (S3 jsQR-only)");
ok(js.includes("onmessage"), "MARCADOR · cableado onmessage presente (worker vivo)");

// ── 3 · PROHIBIDOS (lo que mataría el worker en el navegador) ───────────────
ok(!js.includes("import("), "PROHIBIDO · sin import( (worker clásico — import() no aplica)");
ok(!/zxing/i.test(js), "PROHIBIDO · sin zxing (red line §I — jamás en el worker)");
ok(!js.includes("process.env"), "PROHIBIDO · sin process.env (no existe en worker — crashea)");
ok(!js.includes("identidad-qr"), "PROHIBIDO · sin identidad-qr (grafo jsQR-only por construcción)");

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
        if (s.includes("sondeo-qr.worker.ts")) refTs++;
        if (s.includes("sondeo-qr.worker.js")) refJs++;
      }
    }
  }
  await escanear(NEXT_STATIC);
  ok(refTs === 0, `CLIENTE · cero chunks referenciando sondeo-qr.worker.ts (${refTs})`);
  ok(refJs > 0, `CLIENTE · el build referencia sondeo-qr.worker.js (${refJs} chunks)`);
} else {
  console.log("· (.next/static no existe — smoke de cliente se ejecuta tras `bun run build`)");
}

// ── 5 · ENTREGA (output servible — export estático) ─────────────────────────
if (existsSync("./out/scanner/sondeo-qr.worker.js")) {
  const outBytes = await readFile("./out/scanner/sondeo-qr.worker.js");
  ok(
    Buffer.compare(outBytes, artBytes) === 0,
    "ENTREGA · out/scanner/sondeo-qr.worker.js byte-idéntico al artefacto",
  );
} else {
  console.log("· (out/ no existe — entrega estática verificada en el build con BUILD_STATIC=1)");
}

if (fallos > 0) {
  console.error(`\nsmoke-sondeo-worker: ${fallos} fallo(s) — VERDE FALSO BLOQUEADO`);
  process.exit(1);
}
console.log("\nsmoke-sondeo-worker: TODO OK — worker compilado de verdad, no de mentira");
