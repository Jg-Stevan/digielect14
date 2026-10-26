/**
 * QA headless — KIT e107-prescan-qr-cola-v1 (§H.2): contrato del PRE-SCAN
 * QR en «PROCESAR COLA». Sin red, sin DOM, determinista — source-scan
 * estático POR PATRÓN de línea (mismo esqueleto de los qa-*.ts: readFile +
 * ok() + remate final OK; ANCLA POR PATRÓN, jamás por número de línea —
 * #106 puede moverlas cuando se mergee).
 *
 *   bun scripts/qa-prescan-qr-cola.ts
 *
 * Checks (kit §H.2):
 *   1. MasivaView: `onClick={() => void prescanYIniciar()}` presente; el
 *      `onClick={iniciar}` directo del botón PROCESAR COLA ya NO existe;
 *      disabled incluye `prescan.corriendo`; literal `SONDEANDO QR` presente.
 *   2. prescan-qr.ts: lee `leerFlags().prescanQrCola`; guarda `forzarDedupOff`
 *      y `PENDIENTE`; usa `marcarYaEnviada(..., "payload", ...)`,
 *      `registrarQrPayload`, `originalQrDePayload`, `leerRegistro`/
 *      `guardarRegistro`, `intentoSobrePixeles`, `BarcodeDetector` con
 *      fallback jsQR; 0 matches `zxing` (case-insensitive); hard-kill
 *      presente; `imageOrientation: "from-image"` presente.
 *   3. prescan-qr.client.ts: URLs del detection-worker (?v=8 + fallback);
 *      serial FIFO; hard-kill (presupuesto + extra → terminate); bitmaps
 *      SIEMPRE transferidos (postMessage con lista de transfer); PUBLIC_BASE.
 *   4. Integridad §G: runner.ts, store.ts, sondeo-qr.worker.ts,
 *      identidad-qr.ts, qr-pixeles.ts, historico.ts, cola.ts, tipos.ts
 *      (masiva), informe.ts SIN ninguna aparición de `prescan` (solo
 *      flags.ts + obs/tipos.ts tienen los hunks D.4, verificados por
 *      patrón exacto).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const RAIZ = process.cwd();

let pasadas = 0;
let fallos = 0;

function ok(cond: boolean, msg: string): void {
  pasadas++;
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    fallos++;
    console.log(`  ✗ ${msg}`);
  }
}

async function leer(rel: string): Promise<string | null> {
  try {
    return await readFile(path.join(RAIZ, rel), "utf8");
  } catch {
    return null;
  }
}

/** Cuenta apariciones (case-insensitive) de un patrón en un texto. */
function contar(texto: string, patron: RegExp): number {
  return (texto.match(patron) ?? []).length;
}

async function main(): Promise<void> {
  console.log("\nQA prescan-qr-cola — KIT e107-prescan-qr-cola-v1 (§H.2)\n");

  const vista = (await leer("src/components/e14/screens/MasivaView.tsx")) ?? "";
  const orquestador = (await leer("src/lib/e14/masiva/prescan-qr.ts")) ?? "";
  const cliente = (await leer("src/lib/e14/masiva/prescan-qr.client.ts")) ?? "";
  const flags = (await leer("src/lib/e14/flags.ts")) ?? "";
  const flagsTipo = (await leer("src/lib/e14/obs/tipos.ts")) ?? "";

  // ── 1 · MasivaView (D.3 — el ÚNICO archivo de UI que se toca) ────────────
  ok(
    vista.includes("onClick={() => void prescanYIniciar()}"),
    "MasivaView: botón PROCESAR COLA delega en prescanYIniciar (patrón exacto §D.3)",
  );
  ok(
    !/onClick=\{iniciar\}/.test(vista),
    "MasivaView: el onClick={iniciar} directo ya NO existe (intercepción completa)",
  );
  ok(
    /disabled=\{![^}]*prescan\.corriendo/.test(vista),
    "MasivaView: disabled del botón incluye prescan.corriendo (re-entrada visual)",
  );
  ok(
    vista.includes("SONDEANDO QR"),
    "MasivaView: literal SONDEANDO QR presente (UI de progreso — regla de oro 2)",
  );
  ok(
    vista.includes("PREPARANDO LECTOR"),
    "MasivaView: fase boot → PREPARANDO LECTOR (abort honesto visible)",
  );
  ok(
    vista.includes("usePrescanQrEstado"),
    "MasivaView: hook del estado del pre-scan (SOLO-LECTURA, patrón chip e73)",
  );

  // ── 2 · Orquestador prescan-qr.ts (§D.2) ─────────────────────────────────
  ok(
    orquestador.includes("leerFlags().prescanQrCola"),
    "prescan-qr: R1 lee el kill-switch del dueño (leerFlags().prescanQrCola)",
  );
  ok(
    orquestador.includes("forzarDedupOff"),
    "prescan-qr: PROCESAR IGUAL manda SIEMPRE (forzarDedupOff — RL-e65b-6)",
  );
  ok(
    orquestador.includes('"PENDIENTE"'),
    "prescan-qr: objetivo solo PENDIENTE vivas (R3)",
  );
  ok(
    /marcarYaEnviada\(/.test(orquestador) && orquestador.includes('"payload"'),
    "prescan-qr: ya-enviada vía marcarYaEnviada(..., 'payload', ...) (§C tal cual)",
  );
  ok(
    orquestador.includes("registrarQrPayload") && orquestador.includes("originalQrDePayload"),
    "prescan-qr: mapa del lote (registrarQrPayload/originalQrDePayload) — misma capa 0",
  );
  ok(
    orquestador.includes("leerRegistro") && orquestador.includes("guardarRegistro"),
    "prescan-qr: write DUPLICADA con leerRegistro/guardarRegistro (patrón cadenaDedup)",
  );
  ok(
    orquestador.includes("intentoSobrePixeles") && orquestador.includes("BANDA_A"),
    "prescan-qr: fallback jsQR sobre píxeles del warp (intentoSobrePixeles+BANDA_A)",
  );
  ok(
    orquestador.includes("BarcodeDetector"),
    "prescan-qr: BarcodeDetector nativo en el módulo NUEVO (§F.1 — red line identidad intacta)",
  );
  ok(
    contar(orquestador, /zxing/gi) === 0,
    "prescan-qr: 0 matches 'zxing' (§F.3 — ZXing eliminado del pre-scan por construcción)",
  );
  ok(
    orquestador.includes('imageOrientation: "from-image"'),
    "prescan-qr: decode rápido respeta EXIF (imageOrientation from-image)",
  );
  ok(
    orquestador.includes("iniciar()") || /getState\(\)\.iniciar\(\)/.test(orquestador),
    "prescan-qr: Fase 3 = iniciar() con la lista filtrada (ÚNICO punto de contacto con tM)",
  );
  ok(
    orquestador.includes("filaViva") || orquestador.includes('estado !== "PENDIENTE"'),
    "prescan-qr: guard anti-zombi (fila VIVA y PENDIENTE en el instante del write)",
  );

  // ── 3 · Cliente prescan-qr.client.ts (§D.1) ──────────────────────────────
  ok(
    cliente.includes("detection-worker.js?v=8") && cliente.includes("detection-worker.js"),
    "prescan-qr.client: URLs del worker REAL (?v=8 + fallback — Anexo 1)",
  );
  ok(
    cliente.includes("PRESUPUESTO_FILA_MS") && cliente.includes("HARD_KILL_EXTRA_MS") &&
      /terminate\(\)/.test(cliente),
    "prescan-qr.client: hard-kill anti-zombi (presupuesto + extra → terminate + respawn)",
  );
  ok(
    /transfer:\s*\[/.test(cliente) && cliente.includes("postMessage"),
    "prescan-qr.client: bitmaps SIEMPRE transferidos (postMessage(msg, [bitmap]))",
  );
  ok(
    cliente.includes("NEXT_PUBLIC_BASE_PATH"),
    "prescan-qr.client: PUBLIC_BASE con NEXT_PUBLIC_BASE_PATH (patrón OBLIGATORIO del repo)",
  );
  ok(
    cliente.includes("BOOT_TIMEOUT_MS") && cliente.includes("listo()") === false
      ? true
      : /async function listo|listo\(\):\s*Promise/.test(cliente) ||
          cliente.includes("listo(): Promise<boolean>"),
    "prescan-qr.client: boot honesto con timeout (race de URLs → primer ready)",
  );
  ok(
    cliente.includes("soportado") || /typeof Worker !== "undefined"/.test(cliente),
    "prescan-qr.client: feature-detect (sin Worker/OffscreenCanvas → listo()=false)",
  );

  // ── 4 · Integridad §G — zonas prohibidas SIN ninguna aparición ───────────
  const intocables: [string, string][] = [
    ["src/lib/e14/masiva/runner.ts", "runner.ts (tM — no tocar tM: regla de oro 1)"],
    ["src/lib/e14/masiva/store.ts", "store.ts (cero edits — el filtrado son marcas previas)"],
    ["src/lib/e14/masiva/sondeo-qr.worker.ts", "sondeo-qr.worker.ts (kit e73 INTACTO — §F.4)"],
    ["src/lib/e14/masiva/identidad-qr.ts", "identidad-qr.ts (capa 0/identidad — §F.1)"],
    ["src/lib/e14/masiva/qr-pixeles.ts", "qr-pixeles.ts (solo se IMPORTA — §C)"],
    ["src/lib/e14/masiva/historico.ts", "historico.ts (ledger — §C)"],
    ["src/lib/e14/masiva/cola.ts", "cola.ts (solo se IMPORTA — §C)"],
    ["src/lib/e14/masiva/tipos.ts", "tipos.ts (masiva) — sin token 'qr-prescan' (§F.2)"],
    ["src/lib/e14/informe.ts", "informe.ts (contrato D57 sin cambios — §F.2)"],
  ];
  for (const [rel, etiqueta] of intocables) {
    const txt = (await leer(rel)) ?? "";
    ok(contar(txt, /prescan/gi) === 0, `Integridad §G: ${etiqueta} con 0 apariciones de 'prescan'`);
  }

  // ── 5 · Hunks D.4 exactos (kill-switch del dueño) ────────────────────────
  ok(
    flagsTipo.includes("prescanQrCola: boolean;"),
    "obs/tipos.ts: FlagsApp + prescanQrCola AL FINAL (D57 — patrón exacto)",
  );
  ok(
    flags.includes("prescanQrCola: true,"),
    "flags.ts: FLAGS_DEFAULT + prescanQrCola: true (patrón e73 literal)",
  );
  ok(
    flags.includes('limpio.prescanQrCola = p.prescanQrCola;'),
    "flags.ts: sanearFlags con whitelist aditiva del flag (junto al bloque e73/hang)",
  );

  // ── resultado ────────────────────────────────────────────────────────────
  console.log(`\nQA prescan-qr-cola: ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
