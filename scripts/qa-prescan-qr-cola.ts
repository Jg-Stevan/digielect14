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
 *      fallback jsQR; 0 matches `zxing` en el ORQUESTADOR (case-insensitive
 *      — ENMIENDA e14-prescan-rescate-qr-v1: el zxing del pre-scan vive
 *      SOLO en prescan-qr-rescate.ts, check §7); hard-kill
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
    "prescan-qr: 0 matches 'zxing' en el ORQUESTADOR (§F.3 ENMIENDADO por e14-prescan-rescate-qr-v1 — el zxing del pre-scan vive SOLO en prescan-qr-rescate.ts, check §7; la frontera del orquestador se conserva)",
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
  // KIT e14-quad-streaming-v1 (P5) — ENMIENDA del contrato e107: el runner
  // consume por TURNO de clasificación (flag masivaStreaming, default OFF)
  // y la fila lleva `prescanOk` — el token prescanOk está PERMITIDO
  // EXACTAMENTE en runner.ts y masiva/tipos.ts (campo nuevo AL FINAL —
  // contrato D57); se le retira del texto antes de contar. store.ts y el
  // resto siguen INTACTOS (0 apariciones — la lógica del pre-scan vive
  // SOLO en prescan-qr.ts / turno-clasificacion.ts).
  const intocables: [string, string, boolean][] = [
    ["src/lib/e14/masiva/runner.ts", "runner.ts (tM — no tocar tM: regla de oro 1)", true],
    ["src/lib/e14/masiva/store.ts", "store.ts (cero edits — el filtrado son marcas previas)", false],
    ["src/lib/e14/masiva/sondeo-qr.worker.ts", "sondeo-qr.worker.ts (kit e73 INTACTO — §F.4)", false],
    ["src/lib/e14/masiva/identidad-qr.ts", "identidad-qr.ts (capa 0/identidad — §F.1)", false],
    ["src/lib/e14/masiva/qr-pixeles.ts", "qr-pixeles.ts (solo se IMPORTA — §C)", false],
    ["src/lib/e14/masiva/historico.ts", "historico.ts (ledger — §C)", false],
    ["src/lib/e14/masiva/cola.ts", "cola.ts (solo se IMPORTA — §C)", false],
    ["src/lib/e14/masiva/tipos.ts", "tipos.ts (masiva) — sin token 'qr-prescan' (§F.2)", true],
    ["src/lib/e14/informe.ts", "informe.ts (contrato D57 sin cambios — §F.2)", false],
  ];
  for (const [rel, etiqueta, permitePrescanOk] of intocables) {
    let txt = (await leer(rel)) ?? "";
    if (permitePrescanOk) {
      const conPrescanOk = contar(txt, /prescanOk/g);
      ok(
        conPrescanOk > 0,
        `Integridad §G (enmienda e14-quad-streaming): ${etiqueta} usa el token prescanOk (${conPrescanOk})`,
      );
      txt = txt.replace(/prescanOk/g, ""); // solo ese token — el resto PROHIBIDO
    }
    ok(contar(txt, /prescan/gi) === 0, `Integridad §G: ${etiqueta} sin 'prescan' más allá de prescanOk`);
  }
  // e14-quad-streaming (P5) — la lógica del TURNO vive en su módulo propio
  // (sin imports — sin ciclos runner→prescan) y el runner NO importa el
  // módulo del pre-scan (imports unidireccionales — SPLIT C1).
  const turno = (await leer("src/lib/e14/masiva/turno-clasificacion.ts")) ?? "";
  ok(
    turno.includes("abrirTurnoClasificacion") &&
      turno.includes("cerrarTurnoClasificacion") &&
      turno.includes("turnoClasificacionEnCurso"),
    "turno-clasificacion.ts: semáforo del turno (abrir/cerrar/enCurso) presente",
  );
  const runnerTxt = (await leer("src/lib/e14/masiva/runner.ts")) ?? "";
  ok(
    !/from "\.\/prescan-qr"/.test(runnerTxt),
    "runner.ts: SIN import del módulo del pre-scan (unidireccional — el turno viaja por turno-clasificacion.ts)",
  );
  ok(
    runnerTxt.includes("masivaStreaming") &&
      runnerTxt.includes("prescanOk") &&
      runnerTxt.includes("turnoClasificacionEnCurso()"),
    "runner.ts: filtro del turno en siguientePendiente (masivaStreaming + prescanOk + enCurso) presente",
  );
  ok(
    runnerTxt.includes("OpcionesEscaneoConQuad") && runnerTxt.includes("quadPrecomputado"),
    "runner.ts: quad del pre-scan viaja en opcionesMasiva (P4 — OpcionesEscaneoConQuad)",
  );
  const bridgeTxt = (await leer("src/lib/e14/scanner-core-bridge.ts")) ?? "";
  ok(
    bridgeTxt.includes("OpcionesEscaneoConQuad") &&
      bridgeTxt.includes("quadPrecomputadoPlausible") &&
      bridgeTxt.includes("QUAD_PRECOMPUTADO_MANUAL"),
    "scanner-core-bridge.ts: quadPrecomputado + validación de plausibilidad + decisión SEMILLA documentada (P4)",
  );

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

  // ── 6 · KIT flujo-dueno-v1 (K2 — brief Agente B) — warp de INGESTA ──────
  // ENMIENDA K2 (justificación: el contrato e107 se amplía de nuevo — el
  // trabajo del pre-scan SUBE a la ingesta tras el flag masivaWarpIngesta;
  // store.ts sigue SIN el token (encola por el módulo nuevo) y el resto de
  // intocables queda intacto — §G arriba verde 43/43 con el K2 incluido).
  const warpIngesta = (await leer("src/lib/e14/masiva/warp-ingesta.ts")) ?? "";
  ok(
    warpIngesta.length > 0 && warpIngesta.includes("encolarWarpIngesta"),
    "warp-ingesta.ts: módulo NUEVO del warp de ingesta (encolarWarpIngesta presente)",
  );
  ok(
    warpIngesta.includes("marcarCadenaDedupEnVuelo") &&
      warpIngesta.includes("CORTECIA_TOPE_MS") &&
      warpIngesta.includes("CORTECIA_PASO_MS"),
    "warp-ingesta: cortesía de CPU hacia cadenaDedup (marcar + tope/paso)",
  );
  ok(
    warpIngesta.includes("filaBajoWarpIngesta") && warpIngesta.includes("esperarColaWarpIngesta"),
    "warp-ingesta: propiedad de filas (bajo-cola) + drenaje acotado para el asegurador",
  );
  ok(
    warpIngesta.includes("prescanOk: true") &&
      warpIngesta.includes("rotacionSugerida") &&
      warpIngesta.includes("quadDeFracciones"),
    "warp-ingesta: estamps prescanOk + rotacionSugerida + quad (formato P4)",
  );
  ok(
    warpIngesta.includes('from "./vendor/jsQR.js"') && contar(warpIngesta, /zxing/gi) === 0,
    "warp-ingesta: sondeo con jsQR vendido — 0 matches 'zxing' (red line sondeos)",
  );
  ok(
    warpIngesta.includes("rotacionDesdeCentroide") &&
      warpIngesta.includes("QR_WARP_LADO_TOPE = 1600"),
    "warp-ingesta: cuadrante→rotación reutilizado (orientacion-qr) + cap del warp ≤1600 (paridad e107)",
  );
  ok(
    warpIngesta.includes("PRESUPUESTO_FILA_MS") === false &&
      warpIngesta.includes("crearClientePrescan"),
    "warp-ingesta: presupuestos vía el cliente del worker (mismos hard-kills del prescan — sin duplicación)",
  );
  ok(
    !/from "\.\/store"/.test(warpIngesta),
    "warp-ingesta: SIN import del store (deps inyectadas — cero ciclos, doctrina turno)",
  );
  ok(
    orquestador.includes("masivaWarpIngesta") &&
      orquestador.includes("filaBajoWarpIngesta") &&
      orquestador.includes("esperarColaWarpIngesta") &&
      orquestador.includes("__registrarDepsWarpIngesta"),
    "prescan-qr: K2 — objetivo excluye filas con dueño + drenaje antes del barrido + registrador de deps",
  );
  ok(
    !/from "\.\/warp-ingesta"/.test(runnerTxt),
    "runner.ts: SIN import del warp-ingesta (el runner consume solo estamps de la fila)",
  );
  const storeTxt = (await leer("src/lib/e14/masiva/store.ts")) ?? "";
  ok(
    storeTxt.includes("encolarWarpIngesta") &&
      storeTxt.includes("leerFlags().masivaWarpIngesta === true") &&
      storeTxt.includes("marcarCadenaDedupEnVuelo(true)") &&
      storeTxt.includes("marcarCadenaDedupEnVuelo(false)"),
    "store.ts: disparo K2 (encolar bajo flag) + cortesía marcada alrededor de cadenaDedup",
  );
  ok(
    storeTxt.includes("leerFlags().masivaSondeoCrudo === true") &&
      storeTxt.includes("sondeo = await sondearQrPrecoz(entrada.archivo);"),
    "store.ts: masivaSondeoCrudo default ON = camino de hoy (guard fuerza sondeo=null en OFF)",
  );
  // K2 — flags del dueño: defaults + DOBLE whitelist + FlagsApp AL FINAL.
  ok(
    flags.includes("masivaWarpIngesta: false,") &&
      flags.includes("masivaRotacionQr: false,") &&
      flags.includes("masivaSondeoCrudo: true,"),
    "flags.ts: FLAGS_DEFAULT K2 (warp/rotación OFF · sondeo-crudo ON) AL FINAL (D57)",
  );
  ok(
    flags.includes("limpio.masivaWarpIngesta = p.masivaWarpIngesta;") &&
      flags.includes("limpio.masivaRotacionQr = p.masivaRotacionQr;") &&
      flags.includes("limpio.masivaSondeoCrudo = p.masivaSondeoCrudo;"),
    "flags.ts: whitelist aditiva K2 en sanearFlags (3 claves)",
  );
  ok(
    (await leer("src/lib/e14/obs/politica.ts"))?.includes(
      "limpio.masivaWarpIngesta = o.masivaWarpIngesta;",
    ) === true,
    "obs/politica.ts: DOBLE whitelist — overrides K2 alcanzables vía localStorage (D6)",
  );
  ok(
    flagsTipo.includes("masivaWarpIngesta: boolean;") &&
      flagsTipo.includes("masivaRotacionQr: boolean;") &&
      flagsTipo.includes("masivaSondeoCrudo: boolean;"),
    "obs/tipos.ts: FlagsApp + 3 flags K2 AL FINAL (D57 — patrón exacto)",
  );
  ok(
    (await leer("src/lib/e14/orientacion-qr.ts"))?.includes(
      "export function rotacionDesdeCentroide",
    ) === true,
    "orientacion-qr.ts: rotacionDesdeCentroide export ADITIVO (mapeo bench v8.3 4/4 — módulo intacto)",
  );
  // K2 — rotación de ingesta: runner (spread) + bridge (aplicación + guard).
  ok(
    runnerTxt.includes("OpcionesEscaneoConRotacion") &&
      runnerTxt.includes("masivaRotacionQr") &&
      runnerTxt.includes("rotacionPrecomputada"),
    "runner.ts: spread condicional de rotacionPrecomputada en opcionesMasiva (mismo patrón P4)",
  );
  ok(
    bridgeTxt.includes("OpcionesEscaneoConRotacion") &&
      bridgeTxt.includes("rotacionPrecomputadaPlausible") &&
      bridgeTxt.includes("masivaRotacionQr") &&
      bridgeTxt.includes("rotacionIngestaAplicada") &&
      bridgeTxt.includes("[e14] rotacion-ingesta"),
    "scanner-core-bridge.ts: rotación de ingesta post-warp pre-OCR + plausibilidad + traza propia (D51)",
  );

  // ── 7 · KIT e14-prescan-rescate-qr-v1 — rescate del QR difícil ─────────
  // ENMIENDA §F.3 (orden del dueño): «intentar leer rápido con jsQR, y
  // dejar lo último y difícil para zxing». El rescate vive en SU módulo
  // (main thread, import DINÁMICO de identidad-qr — cero import estático
  // de zxing-wasm: el chunk solo baja si hay rescate real) — el orquestador
  // sigue sin mencionar zxing (check §2 intacto) y el worker sigue
  // jsQR-only (dictamen e73 intacto, smoke del gate lo escanea).
  const rescate = (await leer("src/lib/e14/masiva/prescan-qr-rescate.ts")) ?? "";
  ok(
    rescate.length > 0 && rescate.includes("rescateQrDeWarped"),
    "prescan-qr-rescate.ts: módulo NUEVO del rescate (rescateQrDeWarped presente)",
  );
  ok(
    contar(rescate, /from ["']zxing-wasm/g) === 0 &&
      rescate.includes('import("./identidad-qr")'),
    "prescan-qr-rescate: SIN import estático de zxing-wasm — identidad-qr por import DINÁMICO cacheado (el wasm solo baja si hay rescate)",
  );
  ok(
    rescate.includes("decodificarQrDeRecorte") &&
      rescate.includes("barridoQrZxingDePixeles"),
    "prescan-qr-rescate: reusa tiers YA TESTEADOS de la capa 0 (esquina-600 + barrido presupuestado 4 s) — identidad-qr.ts INTACTO",
  );
  ok(
    rescate.includes("QR_RESCATE_LADO_TOPE = 1600"),
    "prescan-qr-rescate: raster cap ≤1600 (paridad exacta con el intento jsQR de leerQrDeWarped)",
  );
  ok(
    orquestador.includes('from "./prescan-qr-rescate"') &&
      orquestador.includes("rescateQrDeWarped") &&
      orquestador.includes("prescanQrRescate"),
    "prescan-qr: rescate cableado tras null de leerQrDeWarped, gated por prescanQrRescate (default OFF = byte-idéntico)",
  );
  // KIT e14-prescan-zxing-rescate-v1 — flags del dueño (D57 + DOBLE whitelist).
  ok(
    flags.includes("prescanQrRescate: false,") &&
      flags.includes("limpio.prescanQrRescate = p.prescanQrRescate;"),
    "flags.ts: FLAGS_DEFAULT + whitelist aditiva de prescanQrRescate (default OFF)",
  );
  ok(
    flagsTipo.includes("prescanQrRescate: boolean;") &&
      ((await leer("src/lib/e14/obs/politica.ts")) ?? "").includes(
        "limpio.prescanQrRescate = o.prescanQrRescate;",
      ),
    "obs/tipos.ts + obs/politica.ts: FlagsApp AL FINAL (D57) + DOBLE whitelist de prescanQrRescate",
  );

  // ── resultado ────────────────────────────────────────────────────────────
  console.log(`\nQA prescan-qr-cola: ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
