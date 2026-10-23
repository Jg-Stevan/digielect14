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
 * e64-qr T-1.5: Bloque 6 — QA de los TIERS NUEVOS con la numeración del kit
 * (PLAN-e64-qr §4-T-1.5): F1 filo (T-1.0 + estructura en los 2 barridos) ·
 * F2 blur σ≈1.5 módulo 3px (T-1.1 nitidez) · F3 gradiente de iluminación
 * (T-1.2 binarizada) · F4 QR chico ~5% (T-1.3 escalas 0.08/0.32) · F5
 * sub-pixel a 2048 que pasa a nativa ≤4096 (T-1.4 rescate) · F6 sin QR →
 * null en presupuesto (< 15 s). F1/F4 del kit aplican DIRECTO aquí (los
 * fixtures del kit asumían el barrido e63n — reconstruido en T-PRE).
 *
 * Nota honesta: el wrapper DOM (decodificarQrDeCapture — render a canvas
 * ≤2048 + UN getImageData) no corre headless; su NÚCLEO (la cadena
 * decodificarQrDePixeles — el MISMO código que el wrapper consume tras el
 * render) se ejercita aquí con matrices QR reales decodificadas por el
 * jsQR VENDIDO, y la SEMÁNTICA del render (downscale ≤2048 / rescate
 * ≤4096) se emula con un bilinear puro en el fixture F5 (la receta del
 * canvas del banco — misma intención del smoothing). El wrapper completo
 * queda para la mini-Fase D del dueño (kit §4).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BARRIDO_VENTANAS,
  BINARIZADA_DELTA,
  BINARIZADA_VENTANA,
  NITIDEZ_K,
  QR_ESPERA_INTENTOS,
  QR_ESPERA_INTERVALO_MS,
  QR_INTENTOS_BASE,
  QR_LADO_LARGO,
  QR_LADO_LARGO_RESCATE,
  QR_RECORTE_LADO,
  QR_ROTACIONES,
  barridoQrDePixeles,
  binarizadaQrDePixeles,
  decodificarQrDePixeles,
  decodificarQrDeRecorte,
  estadoZxingQr,
  esperarDesenlaceQr,
  ladderBaseDePixeles,
  ladderQrDePixeles,
  nitidezQrDePixeles,
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
// ADENDA e66 (M-e66-2): matches pasó a ser MULTI-CAPA (v2+identidad+qr+
// ya-enviada — plan P3) — aquí 3 (qr+v2+identidad); el desglose aditivo v2
// preserva la cuenta que matches era antes (1).
ok(
  capas.qr === 1 && capas.matches === 3 && capas.v2 === 1 && capas.identidad === 1 && capas.activo,
  "post-mortem §1.3 · resumenDedup cuenta las 3 capas — e66: matches multi-capa=3 (qr/v2/identidad) con desglose aditivo v2=1",
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

// ─────────────────── Bloque 6 · e64-qr T-1.5 — TIERS NUEVOS ──────────────

console.log("— Bloque 6 · e64-qr tiers nuevos (F1-F6 del kit PLAN-e64-qr §4-T-1.5) —");

/** Dibuja la matriz QR en un lienzo RGBA blanco (módulo/quiet en px). */
function lienzoConQr(
  M: string[],
  modulo: number,
  quiet: number,
  W: number,
  H: number,
  ox: number,
  oy: number,
): PixelesQr {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < M.length; y++) {
    for (let x = 0; x < M.length; x++) {
      if (M[y]!.charAt(x) !== "1") continue;
      for (let dy = 0; dy < modulo; dy++) {
        for (let dx = 0; dx < modulo; dx++) {
          const i = ((oy + quiet * modulo + y * modulo + dy) * W + (ox + quiet * modulo + x * modulo + dx)) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width: W, height: H };
}

/** Downscale bilinear puro (misma intención del drawImage del canvas del
 *  banco — emula el render de pixelesDeCapture para el fixture F5). */
function downscaleBilinear(pix: PixelesQr, ladoLargo: number): PixelesQr {
  const ladoMayor = Math.max(pix.width, pix.height);
  const escala = Math.min(1, ladoLargo / ladoMayor);
  const W = Math.max(1, Math.round(pix.width * escala));
  const H = Math.max(1, Math.round(pix.height * escala));
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = Math.min(pix.width - 1, Math.max(0, (x + 0.5) * (pix.width / W) - 0.5));
      const fy = Math.min(pix.height - 1, Math.max(0, (y + 0.5) * (pix.height / H) - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(pix.width - 1, x0 + 1);
      const y1 = Math.min(pix.height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const di = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const arriba = pix.data[(y0 * pix.width + x0) * 4 + c]! * (1 - tx) + pix.data[(y0 * pix.width + x1) * 4 + c]! * tx;
        const abajo = pix.data[(y1 * pix.width + x0) * 4 + c]! * (1 - tx) + pix.data[(y1 * pix.width + x1) * 4 + c]! * tx;
        out[di + c] = arriba * (1 - ty) + abajo * ty;
      }
    }
  }
  return { data: out, width: W, height: H };
}

// F1 (T-1.0) — QR anclado al filo inf-der del cuadrante TL (kit §4-T-1.5):
// el fixture del kit era imposible sin barrido — aquí el barrido e63n
// (reconstruido) con la celda filo lo cubre. + ESTRUCTURA: la celda filo
// existe en los DOS barridos (source-scan al final del bloque).
const F1_W = 800, F1_H = 600; // cuadrante TL = (0..400, 0..300)
const F1_ladoQr = (29 + 8) * 5; // 185 px incl quiet
const f1 = lienzoConQr(MATRIZ_A, 5, 4, F1_W, F1_H, 400 - F1_ladoQr, 300 - F1_ladoQr);
const tF1 = Date.now();
const rF1 = barridoQrDePixeles(f1);
ok(
  rF1 === PAYLOAD_A,
  `F1 (T-1.0) · QR anclado al filo inf-der del cuadrante TL → barrido rescata payload EXACTO (${Date.now() - tF1} ms)`,
);

// F2 (T-1.1) — blur gaussiano ligero (σ≈1.5, módulo 3px): base y barrido
// FALLAN; el tier NITIDEZ rescata (k=0.6 unsharp 3×3).
function fixtureBlur(sigma: number): PixelesQr {
  const W = 900, H = 700;
  const pix = lienzoConQr(MATRIZ_A, 3, 4, W, H, 40, 40);
  const src = new Uint8ClampedArray(pix.data);
  const blur = new Float32Array(W * H);
  const R = Math.ceil(sigma * 2.5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let suma = 0;
      let pesos = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy));
          const xx = Math.min(W - 1, Math.max(0, x + dx));
          const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          suma += src[(yy * W + xx) * 4]! * w;
          pesos += w;
        }
      }
      blur[y * W + x] = suma / pesos;
    }
  }
  for (let p = 0; p < W * H; p++) {
    const v = Math.round(blur[p]!);
    pix.data[p * 4] = v; pix.data[p * 4 + 1] = v; pix.data[p * 4 + 2] = v; pix.data[p * 4 + 3] = 255;
  }
  return pix;
}
const f2 = fixtureBlur(1.5);
const f2base = ladderBaseDePixeles(f2);
const f2barrido = barridoQrDePixeles(f2);
const tF2 = Date.now();
const f2nitido = barridoQrDePixeles(nitidezQrDePixeles(f2));
ok(
  f2base === null && f2barrido === null && f2nitido === PAYLOAD_A,
  `F2 (T-1.1) · blur σ1.5 módulo 3px: base/barrido null → NITIDEZ rescata payload EXACTO (${Date.now() - tF2} ms)`,
);
ok(NITIDEZ_K === 0.6, "F2 · NITIDEZ_K = 0.6 (literal del kit)");

// F3 (T-1.2) — gradiente de iluminación (235→60 + QR contraste 60):
// base/barrido/nitidez FALLAN; el tier BINARIZADA rescata (umbral local).
function fixtureGradiente(contrasteQr: number): PixelesQr {
  const W = 900, H = 700;
  const modulo = 5, quiet = 4;
  const ladoQr = (MATRIZ_A.length + quiet * 2) * modulo;
  const ox = 40, oy = 40;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g = 235 - (x / W) * 175 - (y / H) * 15;
      const dentro = x >= ox && x < ox + ladoQr && y >= oy && y < oy + ladoQr;
      let v = g;
      if (dentro) {
        const mx = Math.floor((x - ox - quiet * modulo) / modulo);
        const my = Math.floor((y - oy - quiet * modulo) / modulo);
        if (mx >= 0 && mx < MATRIZ_A.length && my >= 0 && my < MATRIZ_A.length && MATRIZ_A[my]!.charAt(mx) === "1") {
          v = g - contrasteQr;
        }
      }
      const c = Math.max(0, Math.min(255, Math.round(v)));
      const i = (y * W + x) * 4;
      data[i] = c; data[i + 1] = c; data[i + 2] = c; data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}
const f3 = fixtureGradiente(60);
const f3base = ladderBaseDePixeles(f3);
const f3barrido = barridoQrDePixeles(f3);
const f3nitido = barridoQrDePixeles(nitidezQrDePixeles(f3));
const tF3 = Date.now();
const f3binarizada = barridoQrDePixeles(binarizadaQrDePixeles(f3));
ok(
  f3base === null && f3barrido === null && f3nitido === null && f3binarizada === PAYLOAD_A,
  `F3 (T-1.2) · gradiente 235→60 (contraste QR 60): base/barrido/nitidez null → BINARIZADA rescata EXACTO (${Date.now() - tF3} ms)`,
);
ok(
  BINARIZADA_VENTANA === 0.025 && BINARIZADA_DELTA === 12,
  "F3 · BINARIZADA_VENTANA = 0.025 y BINARIZADA_DELTA = 12 (literales del kit)",
);

// F4 (T-1.3) — QR chico (~4.2% del ancho a 2048) + escalas extendidas.
ok(
  JSON.stringify(BARRIDO_VENTANAS) === "[0.08,0.11,0.14,0.19,0.25,0.32]",
  "F4 (T-1.3) · BARRIDO_VENTANAS = [0.08,0.11,0.14,0.19,0.25,0.32] (0.08/0.32 nuevos)",
);
const f4 = lienzoConQr(MATRIZ_A, 3, 4, 2048, 1500, 80, 60);
const tF4 = Date.now();
const f4r = barridoQrDePixeles(f4);
ok(
  f4r === PAYLOAD_A,
  `F4 (T-1.3) · QR chico (módulo 3px ≈ 4.2% del ancho) a 2048 → barrido decodifica EXACTO (${Date.now() - tF4} ms)`,
);

// F5 (T-1.4) — sub-pixel a 2048 que pasa a nativa ≤4096: módulo 1px nativo
// (2400×1800): el canvas de trabajo (1536×2048, clampeado) lo deja SUB-PIXEL
// (base+barrido null — la cadena completa no puede) y el rescate a nativa
// decodifica (la secuencia EXACTA de decodificarQrDeCapture — pixelesDe-
// Capture emulado con bilinear puro).
const F5_W = 2400, F5_H = 1800;
const f5nat = lienzoConQr(MATRIZ_A, 1, 4, F5_W, F5_H, 950, 250);
const f5_2048 = downscaleBilinear(f5nat, QR_LADO_LARGO);
const f5base2048 = ladderBaseDePixeles(f5_2048);
const f5barrido2048 = barridoQrDePixeles(f5_2048);
const tF5 = Date.now();
const f5grande = downscaleBilinear(f5nat, QR_LADO_LARGO_RESCATE);
const f5rescate = ladderBaseDePixeles(f5grande);
ok(
  Math.max(f5_2048.width, f5_2048.height) === QR_LADO_LARGO &&
    Math.max(f5grande.width, f5grande.height) === Math.max(F5_W, F5_H) &&
    f5base2048 === null &&
    f5barrido2048 === null &&
    f5rescate === PAYLOAD_A,
  `F5 (T-1.4) · módulo 1px: 2048 clampeado base+barrido null → rescate nativa ${f5grande.width}×${f5grande.height} decodifica EXACTO (${Date.now() - tF5} ms)`,
);
ok(
  QR_LADO_LARGO_RESCATE === 4096,
  "F5 · QR_LADO_LARGO_RESCATE = 4096 (literal del kit)",
);

// F6 — imagen SIN QR (ruido puro): la CADENA COMPLETA (decodificarQrDe-
// Pixeles — el núcleo que el wrapper consume) → null EN PRESUPUESTO
// (< 15 s total del kit). En bun el tier zxing degrada honesto a null
// (el wasm no está en /wasm/ headless — misma ruta del catch T-0.1).
ok(estadoZxingQr() === "no-intentado", "F6 · estadoZxingQr() inicial = no-intentado (solo-lectura, sin disparar la carga)");
const f6: PixelesQr = { data: new Uint8ClampedArray(1024 * 768 * 4).fill(128), width: 1024, height: 768 };
const tF6 = Date.now();
const rF6 = await decodificarQrDePixeles(f6);
ok(
  rF6 === null && Date.now() - tF6 < 15_000,
  `F6 · imagen SIN QR → cadena completa null en presupuesto (${Date.now() - tF6} ms < 15 000 ms)`,
);

// Presupuesto del barrido completo a 2048² con las 6 fracciones (kit T-1.3:
// ≤ 5 s o separar BARRIDO_VENTANAS_ZXING — medido en sandbox).
const ruido2048: PixelesQr = { data: new Uint8ClampedArray(2048 * 2048 * 4).fill(128), width: 2048, height: 2048 };
const tB = Date.now();
const rB = barridoQrDePixeles(ruido2048);
ok(
  rB === null && Date.now() - tB < 8_000,
  `presupuesto T-1.3 · barrido jsQR completo 2048² (6 fracs) → null en ${Date.now() - tB} ms (< 8 s sandbox — techo kit 5 s en campo, ver REPORTE)`,
);

// Estructura (source-scan) — inserciones en la cadena + celdas filo +
// rescate + trazas + qrEstado (T-0.1/T-0.2/T-1.0/T-1.1/T-1.2/T-1.4).
const iBarrido = srcQr.indexOf("const barrido = barridoQrDePixeles(pix);");
const iNitidez = srcQr.indexOf("const nitido = barridoQrDePixeles(nitidezQrDePixeles(pix));");
const iBinarizada = srcQr.indexOf("const binarizada = barridoQrDePixeles(binarizadaQrDePixeles(pix));");
const iZxing = srcQr.indexOf("const zxing = await barridoQrZxingDePixeles(pix);");
ok(
  iBarrido > 0 && iNitidez > iBarrido && iBinarizada > iNitidez && iZxing > iBinarizada,
  "orden de la cadena: base → barrido → NITIDEZ (T-1.1) → BINARIZADA (T-1.2) → zxing → rotación",
);
ok(
  (srcQr.match(/winFilo/g) ?? []).length >= 4 &&
    (srcQr.match(/e64-qr T-1\.0/g) ?? []).length >= 2,
  `T-1.0 · celda filo presente en los 2 barridos (${(srcQr.match(/winFilo/g) ?? []).length} referencias)`,
);
ok(
  srcQr.includes("rescate4096") &&
    srcQr.includes("if (Math.max(pix.width, pix.height) < QR_LADO_LARGO) return null;") &&
    srcQr.includes("ladoLargo: number = QR_LADO_LARGO"),
  "T-1.4 · rescate en decodificarQrDeCapture (guard del canvas clampeado + 2º parámetro opcional de pixelesDeCapture)",
);
ok(
  srcQr.includes("qr-capa0 zxing INDISPONIBLE") && srcQr.includes("export function estadoZxingQr()"),
  "T-0.1 · traza de zxing indisponible + getter estadoZxingQr()",
);
ok(
  srcQr.includes('[e14] qr-capa0 tier=') && srcQr.includes('trazaQr("barrido-nitido"') && srcQr.includes('trazaQr("barrido-binarizado"'),
  "trazaQr · trazas por tier (base/barrido/barrido-nitido/barrido-binarizado/zxing/rotacionN/null)",
);
const srcMasiva = await readFile(new URL("../src/components/e14/screens/MasivaView.tsx", import.meta.url), "utf8");
ok(
  srcStore.includes("actualizarFila: (id, patch) => patchFila(id, patch)") &&
    srcRunner.includes(".actualizarFila(fila.id, { qrEstado: qrEstadoCapa0 })") &&
    srcRunner.includes('qrEstado: "leido"') &&
    srcStore.includes('r.qrEstado ?? (r.qrPayload ? "leido" : undefined)') &&
    srcMasiva.includes('f.qrEstado === "leido"') &&
    srcMasiva.includes('f.qrEstado === "sin-payload" && f.estado === "LISTA"'),
  "T-0.2 · qrEstado: actualizarFila (patrón patchFila) + estampado en el runner + restauración en filaDeRegistro + chips QR ✓/✗ en MasivaView (✗ solo LISTA)",
);

// wasm local byte-idéntico al npm (nueva garantía del tier zxing — e64):
const shaWasm = createHash("sha256")
  .update(await readFile(new URL("../public/wasm/zxing_reader.wasm", import.meta.url)))
  .digest("hex");
const { ZXING_WASM_SHA256 } = (await import("zxing-wasm/reader")) as { ZXING_WASM_SHA256: string };
ok(
  shaWasm === ZXING_WASM_SHA256,
  "tier zxing · public/wasm/zxing_reader.wasm BYTE-IDÉNTICO al paquete zxing-wasm 3.1.6 (sha256)",
);
ok(
  (await readFile(new URL("../package.json", import.meta.url), "utf8")).includes('"zxing-wasm": "3.1.6"'),
  "tier zxing · dependencia declarada zxing-wasm@3.1.6 (doc hermano §1 — literal)",
);

// ─── e71 (Opt-2) — tier RECORTE (esquina estándar 600×600, SIN barrido) ──
console.log("\n── e71 Opt-2 · tier recorte-600 ──");
ok(
  QR_RECORTE_LADO === 600,
  "Opt-2 · QR_RECORTE_LADO = 600 (literal del kit: «aprox 600x600 px»)",
);
// (a) QR DENTRO de la esquina estándar: (400,400)-(585,585) sobre 900×700 —
// completamente dentro del recorte 600×600 top-left. NOTA honesta: un QR
// nítido también lo lee la banda A (imagen completa) — el caso EXERCITA el
// tier (payload EXACTO por la vía del recorte); la GANANCIA del kit es de
// rendimiento: los barridos (~15 s) ya no corren cuando el QR está aquí.
const fRec = lienzoConQr(MATRIZ_A, 5, 4, 900, 700, 400, 400);
const tRec = Date.now();
const rRec = await decodificarQrDeRecorte(fRec);
ok(
  rRec === PAYLOAD_A && Date.now() - tRec < 2_000,
  `Opt-2 · QR en la esquina estándar → recorte-600 decodifica EXACTO en ${Date.now() - tRec} ms (una pasada jsQR sobre el recorte, sin barrido)`,
);
// (b) QR FUERA del recorte (abajo-derecha) → el tier es HONESTO (null): el
// rescate de esos casos sigue vivo en el barrido completo de siempre.
const fFuera = lienzoConQr(MATRIZ_A, 5, 4, 900, 700, 700, 500);
const rFuera = await decodificarQrDeRecorte(fFuera);
ok(
  rFuera === null,
  "Opt-2 · QR fuera de la esquina estándar → recorte-600 null (honesto — el barrido completo de siempre queda detrás como fallback sagrado)",
);
// (c) orden de la cadena: recorte ANTES de cualquier barrido completo (los
// barridos ~15 s JAMÁS corren si el QR vive en la esquina estándar).
const iRecorte = srcQr.indexOf("const recorte = await decodificarQrDeRecorte(pix);");
ok(
  iRecorte > 0 &&
    iRecorte < srcQr.indexOf("const barrido = barridoQrDePixeles(pix);") &&
    srcQr.includes('trazaQr("recorte-600"') &&
    srcQr.includes("export const QR_RECORTE_LADO = 600;"),
  "Opt-2 · orden de la cadena: base → recorte-600 → barrido → NITIDEZ → BINARIZADA → zxing → rotación (traza nueva tier=recorte-600)",
);

// ───────────────────────────── resultado ────────────────────────────────────

console.log(`\nQA qr-identidad: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
