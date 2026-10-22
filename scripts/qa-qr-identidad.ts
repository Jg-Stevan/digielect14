/**
 * QA headless — KIT e63m-capa0-qr-identidad-v1 (§2): CAPA 0 identidad-QR
 * pre-OCR. Funciones PURAS + source-scan, sin red, sin DOM, determinista
 * (mismo estilo de scripts/qa-watchdog-relectura.ts).
 *
 *   bun scripts/qa-qr-identidad.ts
 *
 * Los 7 casos mínimos del kit §2 (mapa caso→bloque):
 *   1 → Bloque 1 (payload EXACTO agrupa: decode del fixture + igualdad del
 *       mapa del lote, source-scan del wiring) + Bloque 3.
 *   2 → Bloque 1 (par estilo G2/G4: prefijo común, payload distinto — NO
 *       agrupan por igualdad EXACTA, sin fuzzy).
 *   3 → Bloque 1 (imagen sin QR → null — análogo puro del wrapper DOM) +
 *       source-scan del catch (jamás throw).
 *   4 → Bloque 2 (original en vuelo → APLAZADA → techo → reproceso honesto,
 *       timers cortos inyectados) + source-scan de la traza.
 *   5 → Bloque 1 (captura rotada 90°/180°/270° → payload idéntico —
 *       invariancia VERIFICADA, no asumida).
 *   6 → Bloque 3 (reutilizarResultado→false → reproceso completo — fallback
 *       sagrado, sin return en la rama fallback).
 *   7 → Bloque 4 (export trae qrPayload + dedupHash y NO recalcula —
 *       export-only).
 * Más: Bloque 5 — RED LINES §3 (umbrales byte-idénticos, vendor byte-idéntico
 * a #72, BarcodeDetector prohibido, package.json sin jsQR, trazas aditivas).
 *
 * Nota honesta: el wrapper DOM (decodificarQrDeCapture — render a canvas
 * ≤2048 + UN getImageData) no corre headless; su núcleo (ladderQrDePixeles —
 * el MISMO código que produceconsume el wrapper) se ejercita aquí con
 * matrices QR reales decodificadas por el jsQR VENDIDO. El wrapper fue
 * probado en navegador por el banco #72 (misma receta de render) y queda
 * para la mini-Fase D del dueño (kit §4).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  QR_ESPERA_INTENTOS,
  QR_ESPERA_INTERVALO_MS,
  QR_INTENTOS_BASE,
  QR_LADO_LARGO,
  QR_ROTACIONES,
  esperarDesenlaceQr,
  ladderQrDePixeles,
  qrCorto,
  type PixelesQr,
} from "../src/lib/e14/masiva/identidad-qr";
// FilaInforme/entorno viajan implícitos; las 4 funciones son PURAS (humo).
import {
  actaLivianaJson,
  filaLiviana,
  renderTxt,
  resumenDedup,
} from "../src/lib/e14/informe";
import type { RegistroMasiva } from "../src/lib/e14/masiva/tipos";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Fixtures: matrices QR 29×29 (versión 3, ECC L) generadas con el
// encoder de referencia y congeladas aquí — los payloads son el par del
// banco: el G1 real del corpus del dueño y un gemelo-estructural con el
// MISMO prefijo de 21 chars y cola distinta (estilo G2/G4 — kit §0.2). ───
const PAYLOAD_A = "7UfaHJKbmbZx766vul1NWL/H0swwzefhl5P2YMRLqjk=";
const PAYLOAD_B = "7UfaHJKbmbZx766vul1NWX/AAAAAAAAAAAAAAAAAAAA=";

const MATRIZ_A = [
  "11111110100110010010101111111",
  "10000010011001100101101000001",
  "10111010001011101001101011101",
  "10111010000010000001101011101",
  "10111010010101100010001011101",
  "10000010001010101110101000001",
  "11111110101010101010101111111",
  "00000000101101000010000000000",
  "11011010011101110111101000001",
  "00111001110010000000010010100",
  "10111011101101111110100111100",
  "01010101011110000111110101000",
  "11001111010111010000111001101",
  "11110001000000110001011111001",
  "10111111100111111111101001001",
  "10101001110100100000100001111",
  "01001110010001000000010010100",
  "11010100100110110101010010111",
  "11111010111101111001101101001",
  "11010001010011000001001010111",
  "11011011010010101100111111001",
  "00000000110001110000100010010",
  "11111110010011110001101011010",
  "10000010001000010101100011001",
  "10111010111010011001111111000",
  "10111010110010111100110001101",
  "10111010001000010110000111111",
  "10000010100000000011011111101",
  "11111110110001110001111000000",
];
const MATRIZ_B = [
  "11111110001010110101001111111",
  "10000010101000110100001000001",
  "10111010000011001010001011101",
  "10111010111010010101101011101",
  "10111010010000001011001011101",
  "10000010110110000001001000001",
  "11111110101010101010101111111",
  "00000000011100010110100000000",
  "11111011110101011100010101010",
  "00110001101010000010101010011",
  "00010011001001111100000011000",
  "00000100100011101010001001011",
  "10111011111011010011010100000",
  "01001100000000010100101110111",
  "00010110010110001001000000000",
  "11110101011100010110011001000",
  "00111011011100001000010110000",
  "10010000101011000011001110100",
  "10010010011001110110000000100",
  "10100101010011011100111011001",
  "10011011010010100011111110000",
  "00000000110000011100100010101",
  "11111110111110001011101011110",
  "10000010000100110011100011011",
  "10111010100100010100111110110",
  "10111010110011101001000000000",
  "10111010101001110111001110110",
  "10000010110011001001100111010",
  "11111110110010100011011100100",
];

/** Matriz binaria → píxeles RGBA (módulo escalado + quiet zone — el QR de un
 *  capture real vive dentro de una página con margen blanco). */
function pixDeMatriz(filas: string[], modulo = 8, quiet = 4): PixelesQr {
  const n = filas.length;
  const lado = (n + quiet * 2) * modulo;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (filas[y]!.charAt(x) !== "1") continue;
      for (let dy = 0; dy < modulo; dy++) {
        for (let dx = 0; dx < modulo; dx++) {
          const i = (((quiet + y) * modulo + dy) * lado + (quiet + x) * modulo + dx) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width: lado, height: lado };
}

/** Rotación 90° horaria INDEPENDIENTE (no la del módulo — referencias
 *  cruzadas: si el módulo rotara mal, este fixture no decodificaría). */
function rotar90(src: PixelesQr): PixelesQr {
  const w = src.width;
  const h = src.height;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (x * h + (h - 1 - y)) * 4;
      for (let c = 0; c < 4; c++) data[di + c] = src.data[si + c]!;
    }
  }
  return { data, width: h, height: w };
}

// ─── Registro fabricado para el Bloque 4 (export) ───
function regFabricado(parcial: Partial<RegistroMasiva>): RegistroMasiva {
  return {
    id: "masiva-qa-1",
    nombre: "acta-e14-real.jpg",
    agregadaEn: 1_760_000_000_000,
    estado: "LISTA",
    ...parcial,
  } as RegistroMasiva;
}
const ENTORNO_QA = {
  userAgent: "qa-e63m-headless",
  idioma: "es",
  nucleos: 4,
  memoriaGB: null,
  crossOriginIsolated: false,
  url: "qa://e63m",
};

// ═══════════════ Bloque 1 · Ladder sobre QR reales (casos 1/2/3/5) ═════════

console.log("— Bloque 1 · ladder QR sobre fixtures reales (jsQR vendido) —");

const pixA = pixDeMatriz(MATRIZ_A);
const pixB = pixDeMatriz(MATRIZ_B);

// Caso 1 — payload EXACTO: el fixture A decodifica byte-a-byte.
const t1 = Date.now();
const pA = ladderQrDePixeles(pixA);
ok(
  pA === PAYLOAD_A,
  "Caso 1 · fixture QR del corpus decodifica el payload EXACTO (igualdad byte-a-byte)",
);

// Caso 2 — par estilo G2/G4: MISMO prefijo de 21 chars, payload DISTINTO →
// la igualdad EXACTA NO agrupa (el mapa es Map<string> por payload completo;
// aquí se verifica que los payloads decodificados son distintos y de igual
// prefijo — la comparación del wiring es === sobre TODO el payload).
const pB = ladderQrDePixeles(pixB);
ok(
  pB === PAYLOAD_B && pA !== pB && pA!.slice(0, 21) === pB!.slice(0, 21),
  "Caso 2 · prefijo común 21 chars + payload distinto → NO agrupan (igualdad EXACTA, sin fuzzy)",
);

// Caso 3 — imagen sin QR → null (análogo puro de decodificarQrDeCapture
// sobre un capture sin QR: ruido/imagen lisa).
const ruido: PixelesQr = {
  data: new Uint8ClampedArray(200 * 120 * 4).fill(128),
  width: 200,
  height: 120,
};
ok(ladderQrDePixeles(ruido) === null, "Caso 3 · imagen SIN QR → null (fallback limpio, sin throw)");

// Caso 5 — invariancia rotacional VERIFICADA: el fixture rotado 90/180/270
// decodifica el MISMO payload (tier de rotación A-completa).
const rot1 = rotar90(pixA);
const rot2 = rotar90(rot1);
const rot3 = rotar90(rot2);
ok(
  ladderQrDePixeles(rot1) === PAYLOAD_A &&
    ladderQrDePixeles(rot2) === PAYLOAD_A &&
    ladderQrDePixeles(rot3) === PAYLOAD_A,
  "Caso 5 · rotación 90°/180°/270° → payload IDÉNTICO (invariancia verificada, no asumida)",
);

// Constantes del kit §1.1 (literales).
ok(
  QR_LADO_LARGO === 2048 &&
    JSON.stringify(QR_INTENTOS_BASE) === '["A","B","C","C1.5"]' &&
    JSON.stringify([...QR_ROTACIONES]) === "[90,180,270]",
  "Constantes §1.1: QR_LADO_LARGO=2048 · ladder A/B/C/C1.5 · rotaciones 90/180/270",
);
ok(
  QR_ESPERA_INTERVALO_MS === 1_500 && QR_ESPERA_INTENTOS === 10,
  "Constantes §1.1: espera acotada 1_500 ms × 10 intentos (techo efectivo 15 s)",
);
ok(qrCorto(PAYLOAD_A) === "7UfaHJKb…" && qrCorto(PAYLOAD_A).length === 9, "qrCorto = primeros 8 chars + «…» (solo cosmético)");
ok(
  Date.now() - t1 < 20_000,
  "los 6 decodes del ladder corren en <20 s de reloj real (presupuesto honesto)",
);

// Vendor byte-idéntico al de #72 (red line 9).
const sha = async (ruta: string) =>
  createHash("sha256").update(await readFile(new URL(ruta, import.meta.url))).digest("hex");
ok(
  (await sha("../src/lib/e14/masiva/vendor/jsQR.js")) ===
    (await sha("../tools/bench-qr-identidad/jsQR.js")),
  "RED LINE 9 · vendor jsQR.js BYTE-IDÉNTICO al del banco #72 (sha256)",
);

// ═══════════ Bloque 2 · Espera acotada (caso 4 — timers cortos) ════════════

console.log("— Bloque 2 · espera APLAZADA acotada (timers cortos) —");

// 2a — el original aterriza con desenlace final al 3.er chequeo → reutiliza.
let chequeos = 0;
const r2a = await esperarDesenlaceQr(() => {
  chequeos++;
  return chequeos >= 3 ? "LISTA" : "PROCESANDO";
}, 2, 10);
ok(r2a === "reutiliza" && chequeos === 3, "Caso 4a · original aterriza LISTA → reutiliza (re-chequeo SOLO-LECTURA)");

// 2b — el original queda PROCESANDO SIEMPRE → techo tras los 10 intentos
// (acotado — el proceso sigue vivo y rápido).
const t2b = Date.now();
let intentos2b = 0;
const r2b = await esperarDesenlaceQr(() => {
  intentos2b++;
  return "PROCESANDO";
}, 2, 10);
ok(
  r2b === "techo" && intentos2b === 10 && Date.now() - t2b < 5_000,
  "Caso 4b · original en vuelo SIEMPRE → techo tras 10 re-chequeos (sin fuga de espera)",
);

// 2c — el original sale del vuelo por otra puerta → techo TEMPRANO (1
// chequeo: ERROR / PENDIENTE / AUSENTE — esperar sería en balde).
for (const estado of ["ERROR", "PENDIENTE", "AUSENTE"] as const) {
  let llamadas = 0;
  const r = await esperarDesenlaceQr(() => {
    llamadas++;
    return estado;
  }, 2, 10);
  ok(r === "techo" && llamadas === 1, `Caso 4c · original ${estado} → techo temprano (reproceso honesto, sin esperar en balde)`);
}

// 2d — el original aterriza DUPLICADA (desenlace final también vale).
const r2d = await esperarDesenlaceQr(() => "DUPLICADA", 2, 10);
ok(r2d === "reutiliza", "Caso 4d · original DUPLICADA (desenlace final) → reutiliza");

// ═══════════════ Bloque 3 · Wiring CAPA 0 en el runner (source-scan) ═══════

console.log("— Bloque 3 · wiring pre-OCR en runner.ts (source-scan) —");

const srcRunner = await readFile(
  new URL("../src/lib/e14/masiva/runner.ts", import.meta.url),
  "utf8",
);
const srcStore = await readFile(
  new URL("../src/lib/e14/masiva/store.ts", import.meta.url),
  "utf8",
);
const srcQr = await readFile(
  new URL("../src/lib/e14/masiva/identidad-qr.ts", import.meta.url),
  "utf8",
);

// Imports del kit + vía del capture.
ok(
  srcRunner.includes('import { fileToCaptureDataUrl } from "@jg-stevan/scanner-core/image-processor";') &&
    srcRunner.includes('from "./identidad-qr"'),
  "runner importa identidad-qr + fileToCaptureDataUrl (la vía del banco #72)",
);

// Posición del bloque: DESPUÉS de leer el registro/archivo y ANTES del bucle
// del watchdog (el OCR de det/cls/rec y el dhash quedan río abajo). Ancla
// ÚNICA: el encabezado del bloque (el comentario del import comparte prefijo
// — se descarta con los guiones de sección).
const iQr = srcRunner.indexOf("─── e63m — KIT e63m-capa0-qr-identidad-v1");
const iFor = srcRunner.indexOf("for (let intento = 1; intento <= WATCHDOG_INTENTOS; intento += 1) {");
const iReg = srcRunner.indexOf("const archivoPipeline = archivo;");
ok(iQr > 0 && iFor > iQr && iReg > 0 && iReg < iQr, "bloque capa 0 ANCLA: tras el capture/datos listos y ANTES de despachar OCR (bucle watchdog)");

const bloqueQr = srcRunner.slice(iQr, iFor);

// Las 5 trazas del kit §1.4 (console.info SIEMPRE, también en los fallos).
for (const token of [
  "capa0-qr sin-payload",
  "capa0-qr original",
  "capa0-qr reutiliza",
  "capa0-qr aplazada",
  "capa0-qr techo-vencido reprocesa-completo",
]) {
  ok(bloqueQr.includes(token), `traza aditiva D51 presente: «${token}»`);
}

// Caso 1 (wiring) — reutiliza vía la maquinaria EXACTA + token dedup=qr.
ok(
  bloqueQr.includes("reutilizarResultado(filaGemela, tQr)") &&
    bloqueQr.includes('dedup: "qr"') &&
    bloqueQr.includes("if (await reutilizarViaQr(originalQr)) return;"),
  "Caso 1 · payload visto + desenlace final → reutilizarResultado (maquinaria EXACTA) + token dedup=qr + return (OCR jamás se paga)",
);

// Caso 6 (wiring) — fallback sagrado: false → reproceso completo SIN return.
const iLista = bloqueQr.indexOf('originalQr.estado === "LISTA"');
const iProc = bloqueQr.indexOf('originalQr.estado === "PROCESANDO"');
const segLista = bloqueQr.slice(iLista, iProc > 0 ? iProc : undefined);
ok(
  segLista.includes("reutilizarResultado=false") &&
    !/return;/.test(segLista.slice(segLista.indexOf("reutilizarResultado=false"))),
  "Caso 6 · reutilizarResultado→false → reproceso completo (fallback sagrado, sin return)",
);

// Caso 4 (wiring) — APLAZADA con espera acotada del kit.
ok(
  bloqueQr.includes("await esperarDesenlaceQr(") &&
    bloqueQr.includes('?.estado ?? "AUSENTE"'),
  "Caso 4 · original PROCESANDO → APLAZADA capa0=qr con re-chequeo SOLO-LECTURA del estado",
);
ok(
  !/setInterval|setTimeout\(\s*[0-9]/.test(bloqueQr),
  "RED LINE 6 · sin timers globales en el bloque (solo la espera acotada del módulo)",
);

// Guard de auto-hit (REINTENTAR de una fila que ya carryaba su payload).
ok(
  bloqueQr.includes("idOriginalQr !== fila.id"),
  "guard de auto-hit: una fila jamás reutiliza SU PROPIO payload (REINTENTAR honesto)",
);

// PROCESAR IGUAL manda (e63k intacto).
ok(
  bloqueQr.includes("fila.forzarDedupOff"),
  "RED LINE 5 · forzarDedupOff (PROCESAR IGUAL) manda sobre la capa 0",
);

// El payload viaja al registro (aditivo al final — contrato D57) y a las
// rutas ERROR/DUPLICADA-e63k (post-mortem).
const spreadQr = (srcRunner.match(/\.\.\.\(qrPayload \? \{ qrPayload \} : \{\}\)/g) ?? []).length;
ok(spreadQr === 3, `qrPayload se estampa en EXACTAMENTE 3 writes de registro (LISTA/DUPLICADA-e63k/ERROR) — hallados ${spreadQr}`);

// Llave OPACA: cero parse/inversión/prefijos en módulo + wiring.
ok(
  !/atob|decodeURIComponent|JSON\.parse|slice\(0,\s*(13|21)\)/.test(srcQr + bloqueQr) &&
    srcStore.includes("originalQrDePayload(payload: string)"),
  "RED LINE 10 · qrPayload llave OPACA: sin parse/invertir/prefijos (solo igualdad EXACTA del Map)",
);

// ═══════════════ Bloque 4 · Export (caso 7 — export-only) ══════════════════

console.log("— Bloque 4 · informe.json/informe.txt (export-only) —");

const regQr = regFabricado({
  qrPayload: PAYLOAD_A,
  hashDedup: "c0ffee42c0ffee42",
  dedup: "qr",
});
const filaQr = filaLiviana(regQr);
ok(
  filaQr.qrPayload === PAYLOAD_A && filaQr.dedupHash === "c0ffee42c0ffee42",
  "Caso 7 · filaLiviana trae qrPayload + dedupHash del registro TAL CUAL",
);
const jsonQr = JSON.parse(JSON.stringify(actaLivianaJson(filaQr))) as Record<string, unknown>;
ok(
  jsonQr.qrPayload === PAYLOAD_A && jsonQr.dedupHash === "c0ffee42c0ffee42",
  "Caso 7 · informe.json trae qrPayload + dedupHash (export-only)",
);
const regSin = regFabricado({});
const jsonSin = JSON.parse(JSON.stringify(actaLivianaJson(filaLiviana(regSin)))) as Record<string, unknown>;
ok(
  !("qrPayload" in jsonSin) && !("dedupHash" in jsonSin),
  "Caso 7 · registros sin dato viajan AUSENTES (jamás inventar — informes previos intactos)",
);

// EXPORT-ONLY: el exportador NO recalcula (no importa el módulo QR ni el
// dhash — solo lee campos del registro).
const srcInforme = await readFile(new URL("../src/lib/e14/informe.ts", import.meta.url), "utf8");
ok(
  !/from "\.\/masiva\/identidad-qr"|from "\.\/identidad-qr"/.test(srcInforme) &&
    !/dhashDeArchivo\(|dhash64DeDataUrl\(|ladderQrDePixeles\(/.test(srcInforme),
  "RED LINE 7 · export-only: el exportador jamás importa el decodificador ni recalcula hashes/payloads",
);

// Post-mortem por capas (kit §1.3) — resumen + txt sobre el MISMO lote.
const filasCapas = [
  filaLiviana(regFabricado({ qrPayload: PAYLOAD_A, hashDedup: "c0ffee42c0ffee42", dedup: "qr" })),
  filaLiviana(regFabricado({ id: "masiva-qa-2", dedup: "v2", dedupDistancia: 1 })),
  filaLiviana(regFabricado({ id: "masiva-qa-3", dedup: "identidad" })),
  filaLiviana(regFabricado({ id: "masiva-qa-4", dedup: "sin-match" })),
];
const capas = resumenDedup(filasCapas);
ok(
  capas.qr === 1 && capas.matches === 1 && capas.identidad === 1 && capas.activo,
  "post-mortem §1.3 · resumenDedup cuenta las 3 capas (qr / v2-marcada / identidad)",
);

const txt = renderTxt(
  "2026-10-22T00:00:00.000Z",
  ENTORNO_QA,
  filasCapas,
  { LISTA: 4 },
  { OPTIMA: 4 },
  {
    procesoMs: null,
    calidadMs: null,
    ocrMs: null,
    totalMs: null,
    esperaMs: null,
    decodeMs: null,
    detectMs: null,
    persistMs: null,
    envioMs: null,
  },
  false,
  [],
);
ok(
  txt.includes(`dedupQr ${qrCorto(PAYLOAD_A)}`) && txt.includes("dedupQr —"),
  "informe.txt · columna dedupQr: 8 chars + «…» con payload y «—» si null (kit §1.3 literal)",
);
ok(
  txt.includes("DEDUP-CAPAS: capa0-qr 1 - capa1-dhash-marcada 1 - capa2-identidad 1"),
  "informe.txt · línea DEDUP-CAPAS (post-mortem de gemelas por fin posible)",
);

// ═══════════════ Bloque 5 · RED LINES §3 (invariancias globales) ═══════════

console.log("— Bloque 5 · red lines §3 (invariancias globales) —");

const srcDedup = await readFile(new URL("../src/lib/e14/masiva/dedup.ts", import.meta.url), "utf8");
const srcIdentidad = await readFile(new URL("../src/lib/e14/masiva/identidad.ts", import.meta.url), "utf8");
const srcClasificador = await readFile(new URL("../src/lib/e14/clasificador.ts", import.meta.url), "utf8");
const srcTypes = await readFile(new URL("../src/lib/e14/types.ts", import.meta.url), "utf8");
const srcRapidocr = await readFile(new URL("../src/lib/e14/ocr/rapidocr.ts", import.meta.url), "utf8");
const srcTope = await readFile(new URL("../src/lib/e14/masiva/tope.ts", import.meta.url), "utf8");
const srcRelectura = await readFile(new URL("../src/lib/e14/masiva/relectura.ts", import.meta.url), "utf8");

ok(srcDedup.includes("export const DEDUP_HAMMING_MAX = 6;"), "RED LINE 2 · DEDUP_HAMMING_MAX=6 byte-idéntico");
ok(srcIdentidad.includes("export const DEDUP_CINTA_CIERTA = 2;"), "RED LINE 2 · DEDUP_CINTA_CIERTA=2 intacto (capa 2 e63k intacta)");
ok(
  srcRunner.includes("const WATCHDOG_MS = 75_000;") &&
    srcRunner.includes("const WATCHDOG_INTENTOS = 2;") &&
    srcRunner.includes("const WATCHDOG_GRACIA_MS = 5_000;"),
  "RED LINE 3 · WATCHDOG 75_000/2/5_000 byte-idénticos (e63g intacto)",
);
ok(srcRunner.includes("const RELECTURA_TOPE_MS = 45_000;"), "RED LINE 3 · RELECTURA_TOPE_MS=45_000 byte-idéntico (la relectura jamás reintenta)");
ok(srcRapidocr.includes("ort.env.wasm.proxy = true;"), "RED LINE 4 · proxy=true en ocr/rapidocr.ts (intocable)");
ok(
  srcClasificador.includes("const UMBRAL_AUTO = 0.82;") &&
    srcClasificador.includes("const UMBRAL_SUGERIDA = 0.6;") &&
    srcClasificador.includes("const UMBRAL_VERIFICACION_LUGAR = 0.55;"),
  "RED LINE 1 · umbrales 0.82 / 0.6 / 0.55 byte-idénticos",
);
ok(
  srcTypes.includes('if (score >= 8) return "OPTIMA";') &&
    srcTypes.includes('if (score >= 6.5) return "ADVERTENCIA";'),
  "RED LINE 1 · OPTIMA=8 y ADVERTENCIA=6.5 byte-idénticos",
);
ok(
  srcTope.includes("export function conTope<T>") &&
    srcRelectura.includes("export function procedeRelecturaInterna"),
  "e63g intacto · tope.ts + relectura.ts sin cambios de contrato",
);
ok(!srcQr.includes("new BarcodeDetector"), "RED LINE §1.1 · BarcodeDetector nativo PROHIBIDO (determinismo — jsQR vendido)");
ok(
  !(await readFile(new URL("../package.json", import.meta.url), "utf8")).includes("jsqr"),
  "RED LINE 9 · package.json intocado (jsQR vendido, NO de npm)",
);

// Cadena autoenvío / watchdog / OCR intocados: el bloque e63m NO toca
// evaluarGate/statusDeScore ni la orquestación del watchdog.
ok(
  !bloqueQr.includes("evaluarGate") &&
    !bloqueQr.includes("statusDeScore") &&
    !bloqueQr.includes("matarYRecrearWorkers") &&
    !bloqueQr.includes("escanearActa"),
  "cero cambios a autoenvío/watchdog/OCR desde el bloque capa 0",
);

// ───────────────────────────── resultado ────────────────────────────────────

console.log(`\nQA qr-identidad: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
