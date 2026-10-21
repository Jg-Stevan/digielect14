/**
 * QA headless — PLAN e63g-e63h-ruta-unica (E1): watchdog de la RE-LECTURA
 * interna (tope) + re-arranque del bucle tras el swap temp→id. Funciones
 * PURAS + source-scan, sin red, sin DOM, determinista (mismo estilo de
 * scripts/qa-autoenvio.ts / qa-identidad-acta.ts).
 *
 *   bun scripts/qa-watchdog-relectura.ts
 *
 * Bloques:
 *   1. Tríada conTope (runtime, timers cortos): valor a tiempo · error a
 *      tiempo (viaja como DATO, jamás throw) · vencido · jamás rechaza ·
 *      rechazo/valor TARDÍOS tras vencido son no-op sin unhandledrejection ·
 *      sin fuga de timer (el proceso termina vivo y rápido).
 *   2. Constantes (source-scan): RELECTURA_TOPE_MS=45_000 NUEVA y SEPARADA
 *      del watchdog D65 (75_000/2/5_000 byte-idénticos).
 *   3. Wiring F0 (source-scan del bloque relectura): conTope con la
 *      constante · vencido → matarYRecrearWorkers() · veredicto de la 1.ª
 *      lectura INTACTO (la rama vencido NO reasigna actaDesenlace) · token
 *      aditivo `tope` (D51) · traza SIEMPRE · CERO reintentos.
 *   4. FASE 1 (source-scan): rearrancarTrasEncolar() tras el swap temp→id
 *      en agregarFiles · guard triple idempotente (sesión fría / pausa /
 *      cola viva) · re-check diferido · colaSesionIniciada solo en
 *      iniciarRunner.
 *   5. Invariancias globales: umbrales 0.82/0.6/0.55/8/6.5 · DEDUP_HAMMING_
 *      MAX=6 · DEDUP_CINTA_CIERTA=2 · proxy=true (rapidocr).
 */
import { readFile } from "node:fs/promises";
import { conTope } from "../src/lib/e14/masiva/tope";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Contador de unhandledrejection: conTope debe adjuntar SIEMPRE handler al
// trabajo (un rechazo tardío tras el tope NO puede colarse como rejection
// sin manejar).
let rechazosSueltos = 0;
process.on("unhandledRejection", () => {
  rechazosSueltos++;
});

// ---------- Bloque 1 · Tríada conTope (runtime) ----------

console.log("— Bloque 1 · tríada conTope (timers cortos) —");

const t0 = Date.now();

// 1a — valor a tiempo
const r1 = await conTope(espera(5).then(() => "VALOR"), 10_000);
ok(
  !r1.vencido && "valor" in r1 && r1.valor === "VALOR",
  "resuelve a tiempo → {vencido:false, valor} con el valor exacto",
);

// 1b — error a tiempo (viaja como dato — conTope JAMÁS throw)
const fallo = new Error("ocr-muerto");
const r2 = await conTope(espera(5).then(() => Promise.reject(fallo)), 10_000);
ok(
  !r2.vencido && "error" in r2 && r2.error === fallo,
  "rechaza a tiempo → {vencido:false, error} con el error EXACTO (dato, no excepción)",
);

// 1c — vencido (trabajo lento, tope corto)
const r3 = await conTope(espera(80).then(() => "tarde"), 15);
ok(r3.vencido === true, "trabajo lento + tope corto → {vencido:true}");

// 1d — conTope en sí jamás rechaza (await directo sobre promesa que rechaza)
let lanzo = false;
let r4: Awaited<ReturnType<typeof conTope<never>>> | null = null;
try {
  r4 = await conTope(Promise.reject(new Error("x")), 10_000);
} catch {
  lanzo = true;
}
ok(
  !lanzo && r4 !== null && !r4.vencido && "error" in r4,
  "conTope JAMÁS rechaza: el rechazo del trabajo llega como rama {error}",
);

// 1e — rechazo TARDÍO tras vencido: no-op, sin unhandledrejection
const r5 = await conTope(
  espera(60).then(() => Promise.reject(new Error("tarde-y-roto"))),
  15,
);
await espera(90); // el rechazo tardío ya aterrizó (con handler de conTope)
ok(r5.vencido === true, "rechazo tardío tras vencido → el resultado sigue {vencido:true}");
ok(rechazosSueltos === 0, "cero unhandledrejection (conTope adjunta handler SIEMPRE)");

// 1f — valor tardío tras vencido: no re-resuelve
const r6 = await conTope(espera(60).then(() => "tarde"), 15);
ok(r6.vencido === true, "valor tardío tras vencido → no re-resuelve (primer desenlace gana)");

// 1g — sin fuga de timer: tope 15 ms limpia o dispara; todo lo anterior
// corre en <2 s de reloj real. Un timer fugado de 45 s retendría el proceso.
ok(Date.now() - t0 < 5_000, "sin fuga de timer: los 6 casos corren en <5 s de reloj real");

// ---------- Bloque 2 · Constantes (source-scan) ----------

console.log("— Bloque 2 · constantes (source-scan) —");

const srcRunner = await readFile(
  new URL("../src/lib/e14/masiva/runner.ts", import.meta.url),
  "utf8",
);
const srcStore = await readFile(
  new URL("../src/lib/e14/masiva/store.ts", import.meta.url),
  "utf8",
);
const srcTope = await readFile(
  new URL("../src/lib/e14/masiva/tope.ts", import.meta.url),
  "utf8",
);

ok(
  srcRunner.includes("const RELECTURA_TOPE_MS = 45_000;"),
  "RELECTURA_TOPE_MS=45_000 existe como constante NUEVA (literal byte-idéntico al plan)",
);
ok(
  srcRunner.includes("const WATCHDOG_MS = 75_000;") &&
    srcRunner.includes("const WATCHDOG_INTENTOS = 2;") &&
    srcRunner.includes("const WATCHDOG_GRACIA_MS = 5_000;"),
  "RED LINE 3: WATCHDOG_MS=75_000 / INTENTOS=2 / GRACIA=5_000 byte-idénticos (D65 intacto)",
);
ok(
  srcTope.includes("export function conTope<T>") &&
    srcTope.includes("{ vencido: true }") &&
    srcTope.includes("{ vencido: false; valor: T }") &&
    srcTope.includes("{ vencido: false; error: unknown }"),
  "tope.ts puro exporta la tríada EXACTA del plan (vencido | valor | error)",
);

// ---------- Bloque 3 · Wiring F0 (source-scan del bloque relectura) ----------

console.log("— Bloque 3 · wiring F0 (source-scan del bloque relectura) —");

ok(
  srcRunner.includes('import { conTope } from "./tope";'),
  "runner importa conTope desde ./tope (módulo puro, mismo patrón identidad/relectura)",
);

// Región del bloque: desde el if del kit e63f hasta el cierre del if (la
// línea del console.info con el token + 1). Ancla por SÍMBOLO (plan §2 —
// las líneas del kit corrieron tras #68/#69).
const lineasRunner = srcRunner.split("\n");
const ini = lineasRunner.findIndex((l) =>
  l.includes("if (procedeRelecturaInterna(acta)) {"),
);
const finLog = lineasRunner.findIndex((l) => l.includes("RelecturaInterna=${relecturaToken}"));
ok(ini > 0 && finLog > ini, "bloque relectura localizado por SÍMBOLO (ancla plan §2)");
const fin = finLog + 1; // la línea siguiente al log es el cierre `    }`
const bloque = lineasRunner.slice(ini, fin + 1).join("\n");

ok(
  bloque.includes("await conTope(") && bloque.includes("RELECTURA_TOPE_MS"),
  "el bloque relectura corre envuelto en conTope con RELECTURA_TOPE_MS",
);

// Partición por ramas: vencido | valor | else (error) — assert por segmento.
const iVenc = bloque.indexOf("if (r.vencido) {");
const iValor = bloque.indexOf('} else if ("valor" in r) {');
const iElse = bloque.indexOf("} else {");
ok(
  iVenc > 0 && iValor > iVenc && iElse > iValor,
  "tríada cableada: ramas vencido / valor / error en orden",
);
const segVenc = bloque.slice(iVenc, iValor);
const segValor = bloque.slice(iValor, iElse);
const segElse = bloque.slice(iElse);

ok(
  segVenc.includes("await matarYRecrearWorkers();"),
  "rama VENCIDO → matarYRecrearWorkers() (infraestructura muerta y re-creada, doctrina T1.2)",
);
ok(
  !segVenc.includes("actaDesenlace ="),
  "RED LINE: veredicto de la 1.ª lectura INTACTO — la rama vencido NO reasigna actaDesenlace",
);
ok(
  segVenc.includes('relecturaToken = "tope";') &&
    segVenc.includes('relecturaDesenlace = "sin-cambio";'),
  "rama vencido: token aditivo `tope` (D51) + desenlace sin-cambio (JAMÁS reintenta)",
);
ok(
  segValor.includes("actaDesenlace = r.valor.acta;") &&
    segValor.includes("relecturaDesenlace = r.valor.desenlace;"),
  "rama valor → desenlace de la re-lectura (comportamiento e63f intacto)",
);
ok(
  segElse.includes('relecturaDesenlace = "sin-cambio";'),
  "rama error → sin-cambio (mismo catch honesto de siempre, ahora como dato)",
);
ok(
  bloque.includes("RelecturaInterna=${relecturaToken}") &&
    bloque.includes("console.info("),
  "traza SIEMPRE (también con tope) vía token ` RelecturaInterna=` (D51 aditivo)",
);
ok(
  !/\bfor\s*\(/.test(bloque) && !/\bwhile\s*\(/.test(bloque),
  "RED LINE: CERO reintentos — sin bucles en el bloque (la relectura corre UNA vez)",
);
ok(
  (srcRunner.match(/conTope\(/g) ?? []).length === 1,
  "conTope se usa EXACTAMENTE en el bloque relectura (el watchdog D65 no se toca)",
);

// ---------- Bloque 4 · FASE 1 (source-scan re-arranque) ----------

console.log("— Bloque 4 · FASE 1 re-arranque tras el swap (source-scan) —");

ok(
  srcRunner.includes("export function rearrancarTrasEncolar(): void {"),
  "runner exporta rearrancarTrasEncolar() (punto ÚNICO del re-arranque)",
);
ok(
  srcRunner.includes("if (!colaSesionIniciada || stopFlag) return;") &&
    srcRunner.includes("let colaSesionIniciada = false;"),
  "guard triple: sesión fría (D45 intacto — encolar no procesa) y pausa activa NO rearrancan",
);
// colaSesionIniciada solo se estampa dentro de iniciarRunner (jamás desde fuera).
const iIniciar = srcRunner.indexOf("export function iniciarRunner(): void {");
const segIniciar = srcRunner.slice(iIniciar, iIniciar + 400);
ok(
  segIniciar.includes("colaSesionIniciada = true;"),
  "colaSesionIniciada=true SOLO en iniciarRunner (sesión viva — la puerta de siempre)",
);
ok(
  srcRunner.includes("if (stopFlag) return; // pausa llegando tarde — el dueño manda") &&
    srcRunner.includes("if (siguientePendiente()) iniciarRunner();"),
  "re-check diferido (macrotask): pausa tardía manda y el bucle renace por la puerta de siempre",
);

// En el store: el llamado queda DESPUÉS del swap temp→id real (set con
// colaDisponible:true) y dentro de la rama de lote exitoso.
const lineasStore = srcStore.split("\n");
const iSwap = lineasStore.findIndex((l) =>
  l.includes("avisoCola: null, // un lote que SÍ entró despeja el aviso de quota"),
);
const iRearranque = lineasStore.findIndex((l) => l.trim() === "rearrancarTrasEncolar();");
ok(iSwap > 0 && iRearranque > iSwap, "store llama rearrancarTrasEncolar() DESPUÉS del swap temp→id");
ok(
  (srcStore.match(/rearrancarTrasEncolar\(\);/g) ?? []).length === 1,
  "PUNTO ÚNICO: el re-arranque se llama UNA sola vez en el store (tras el swap exitoso)",
);

// ---------- Bloque 5 · Invariancias globales (RED LINES §6 del plan) ----------

console.log("— Bloque 5 · invariancias globales (source-scan) —");

const srcDedup = await readFile(
  new URL("../src/lib/e14/masiva/dedup.ts", import.meta.url),
  "utf8",
);
const srcIdentidad = await readFile(
  new URL("../src/lib/e14/masiva/identidad.ts", import.meta.url),
  "utf8",
);
const srcClasificador = await readFile(
  new URL("../src/lib/e14/clasificador.ts", import.meta.url),
  "utf8",
);
const srcTypes = await readFile(
  new URL("../src/lib/e14/types.ts", import.meta.url),
  "utf8",
);
const srcRapidocr = await readFile(
  new URL("../src/lib/e14/ocr/rapidocr.ts", import.meta.url),
  "utf8",
);

ok(
  srcDedup.includes("export const DEDUP_HAMMING_MAX = 6;"),
  "RED LINE 2: DEDUP_HAMMING_MAX=6 byte-idéntico",
);
ok(
  srcIdentidad.includes("export const DEDUP_CINTA_CIERTA = 2;"),
  "RED LINE 2: DEDUP_CINTA_CIERTA=2 intacto (capa 2 identidad e63k intacta)",
);
ok(
  srcClasificador.includes("const UMBRAL_AUTO = 0.82;") &&
    srcClasificador.includes("const UMBRAL_SUGERIDA = 0.6;") &&
    srcClasificador.includes("const UMBRAL_VERIFICACION_LUGAR = 0.55;"),
  "RED LINE 1: umbrales 0.82 / 0.6 / 0.55 byte-idénticos",
);
ok(
  srcTypes.includes('if (score >= 8) return "OPTIMA";') &&
    srcTypes.includes('if (score >= 6.5) return "ADVERTENCIA";'),
  "RED LINE 1: OPTIMA=8 y ADVERTENCIA=6.5 byte-idénticos (statusDeScore)",
);
ok(
  srcRapidocr.includes("ort.env.wasm.proxy = true;"),
  "RED LINE 4: proxy=true en ocr/rapidocr.ts (intocable)",
);

// ---------- resultado ----------

console.log(`\nQA watchdog-relectura: ${pasadas - fallos}/${pasadas} OK`);
if (rechazosSueltos > 0) {
  console.log(`FAIL · ${rechazosSueltos} unhandledrejection — conTope dejó rechazos sueltos`);
  process.exit(1);
}
if (fallos > 0) process.exit(1);
