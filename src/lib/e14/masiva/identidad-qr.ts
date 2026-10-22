/**
 * KIT e63m-capa0-qr-identidad-v1 — CAPA 0: IDENTIDAD QR PRE-OCR (F1/F2).
 *
 * El QR del E-14 es DATO LEÍDO, no imagen: dos fotos del MISMO papel
 * producen el MISMO payload byte-a-byte aunque el dhash no pueda separarlas
 * (banco #72 — GO medido del dueño: 88.2% decode, 0 colisiones, re-encodes
 * dhash 8-33 agrupan por payload EXACTO; la separación criptográfica del
 * peligro dhash: par estilo G2/G4 con prefijo de 21 chars común y payload
 * DISTINTO no agrupa — sin zona de falso positivo). Esta capa corre ANTES de
 * despachar OCR en el runner (punto ÚNICO §1.2): gemela por QR = reutiliza
 * el desenlace del original y el OCR (24-39 s) JAMÁS se paga.
 *
 * Con este GO, la Etapa 3 del plan e63g-e63h (§2.1 matcher rotación-
 * invariante / §2.2 re-chequeo) queda SUSTITUIDA por e63m. El dhash NO se
 * toca (HAMMING_MAX=6 byte-idéntico — dedup.ts intacto).
 *
 * RED LINES (kit §3):
 * · 5 — Dedup jamás inventa: la llave es la IGUALDAD EXACTA de payload
 *   (sin umbrales, sin fuzzy, sin prefijos). Fallback sagrado:
 *   reutilizarResultado→false→pipeline completo. PROCESAR IGUAL manda.
 * · 10 — qrPayload es llave OPACA: NO se parsea, NO se invierte, NO se
 *   compara por prefijos (el prefijo de 21 chars es observación
 *   estructural del banco, jamás lógica de decisión).
 * · 9 — jsQR 1.4.0 VENDIDO byte-idéntico al de #72 (vendor/jsQR.js);
 *   BarcodeDetector nativo PROHIBIDO (determinismo entre máquinas).
 *
 * Núcleo PURO (ladderQrDePixeles / rotación / espera — testeable headless
 * por scripts/qa-qr-identidad.ts, mismo patrón que tope.ts/identidad.ts) +
 * wrapper DOM (decodificarQrDeCapture — la vía del banco: render a canvas
 * de trabajo lado largo ≤ 2048 y UN getImageData).
 */
import jsQR from "./vendor/jsQR.js";
import type { EstadoEntrada } from "./tipos";

// ─── Constantes NUEVAS del kit §1.1 (separadas de las existentes) ───────────
/** Lado largo MÁXIMO del canvas de trabajo (kit §1.1 — igual que el banco:
 *  el thumb 320 del dhash es DEMASIADO PEQUEÑO para el QR). */
export const QR_LADO_LARGO = 2048;
/** Bandas del ladder — fracciones EXACTAS del banco (#72 bench.html). */
interface EspecieBanda {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  escala: number;
}
const BANDAS_BASE: EspecieBanda[] = [
  { id: "A", x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, escala: 1 }, // imagen completa
  { id: "B", x0: 0.0, y0: 0.0, x1: 0.45, y1: 0.25, escala: 1 }, // banda top-left
  { id: "C", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1 }, // banda ajustada
  { id: "C1.5", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1.5 }, // reintento up-escalado
];
const BANDA_A = BANDAS_BASE[0]!; // floor del tier de rotación (A completa)

/** Ladder BASE en orden (kit §1.1 — byte-idéntico al banco): A imagen
 *  completa → B banda top-left → C banda ajustada → C×1.5 up-escalado. */
export const QR_INTENTOS_BASE: readonly string[] = BANDAS_BASE.map((b) => b.id);
/** Tier de rotación (kit §1.1): SOLO si el ladder base falla — A completa
 *  @90°→@180°→@270° (evidencia del banco: el QR CAMBIA de esquina al rotar
 *  — durazno1 solo decodifica con A@90°; repetir bandas finas sobre el
 *  rotado no sirve, la imagen completa sí). */
export const QR_ROTACIONES: readonly number[] = [90, 180, 270];
/** Espera acotada del caso «original en vuelo» (kit §1.1/§1.2.4): intervalo
 *  × intentos = techo efectivo de 15 s. Re-chequeo SOLO-LECTURA del estado
 *  del original; sin timers globales. */
export const QR_ESPERA_INTERVALO_MS = 1_500;
export const QR_ESPERA_INTENTOS = 10;

/** Fuente de píxeles RGBA — la MISMA forma que devuelve getImageData
 *  (canal a canal, 4 bytes por píxel, fila por fila). */
export interface PixelesQr {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Estado del original para la espera acotada — EstadoEntrada + AUSENTE
 *  (la fila fue quitada/vaciada mientras se esperaba). */
export type EstadoOriginalQr = EstadoEntrada | "AUSENTE";

// ─── Núcleo puro: UN intento de decode sobre UNA banda ──────────────────────
/** Semántica EXACTA del intentoDecode del banco: banda fuente redondeada
 *  (sw/sh), destino = banda × escala (dw/dh), jsQR con attemptBoth, payload
 *  EXACTO tal cual sale. escala=1 → copia 1:1 (idéntica al drawImage del
 *  banco); escala>1 → remuestreo bilinear (misma intención del smoothing
 *  del banco — única diferencia microscópica vs drawImage del navegador,
 *  declarada en el REPORTE: C1.5 es el 4.º intento del ladder, el floor del
 *  tier de rotación es A a escala 1 EXACTO). */
function intentoSobrePixeles(cv: PixelesQr, esp: EspecieBanda): string | null {
  try {
    const sx = Math.round(cv.width * esp.x0);
    const sy = Math.round(cv.height * esp.y0);
    const sw = Math.max(1, Math.round(cv.width * (esp.x1 - esp.x0)));
    const sh = Math.max(1, Math.round(cv.height * (esp.y1 - esp.y0)));
    const dw = Math.max(1, Math.round(sw * esp.escala));
    const dh = Math.max(1, Math.round(sh * esp.escala));
    const data = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const di = (y * dw + x) * 4;
        if (esp.escala === 1) {
          // Copia 1:1 EXACTA de la banda (el drawImage del banco con
          // destino = tamaño fuente es idéntico píxel a píxel).
          const sxi = Math.min(cv.width - 1, sx + x);
          const syi = Math.min(cv.height - 1, sy + y);
          const si = (syi * cv.width + sxi) * 4;
          data[di] = cv.data[si]!;
          data[di + 1] = cv.data[si + 1]!;
          data[di + 2] = cv.data[si + 2]!;
          data[di + 3] = cv.data[si + 3]!;
        } else {
          // Remuestreo bilinear del up-escalado (mismas fracciones/rounding).
          const fx = Math.min(cv.width - 1, Math.max(0, (x + 0.5) * (sw / dw) - 0.5 + sx));
          const fy = Math.min(cv.height - 1, Math.max(0, (y + 0.5) * (sh / dh) - 0.5 + sy));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(cv.width - 1, x0 + 1);
          const y1 = Math.min(cv.height - 1, y0 + 1);
          const tx = fx - x0;
          const ty = fy - y0;
          const i00 = (y0 * cv.width + x0) * 4;
          const i10 = (y0 * cv.width + x1) * 4;
          const i01 = (y1 * cv.width + x0) * 4;
          const i11 = (y1 * cv.width + x1) * 4;
          for (let c = 0; c < 4; c++) {
            const arriba = cv.data[i00 + c]! * (1 - tx) + cv.data[i10 + c]! * tx;
            const abajo = cv.data[i01 + c]! * (1 - tx) + cv.data[i11 + c]! * tx;
            data[di + c] = arriba * (1 - ty) + abajo * ty;
          }
        }
      }
    }
    const res = jsQR(data, dw, dh, { inversionAttempts: "attemptBoth" });
    return res ? res.data : null;
  } catch {
    return null; // un intento jamás tumba el ladder
  }
}

/** Rotación EXACTA de 90° horaria (permutación de píxeles — para múltiplos
 *  de 90° el canvasRotado del banco es la MISMA permutación, sin
 *  interpolación). Rotaciones compuestas: siempre DESDE la fuente (el banco
 *  rota el canvas de trabajo original para cada grados). */
function rotar90Pixeles(src: PixelesQr): PixelesQr {
  const w = src.width;
  const h = src.height;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      // dst(x' = h-1-y, y' = x) — dst width = h, dst height = w.
      const di = (x * h + (h - 1 - y)) * 4;
      data[di] = src.data[si]!;
      data[di + 1] = src.data[si + 1]!;
      data[di + 2] = src.data[si + 2]!;
      data[di + 3] = src.data[si + 3]!;
    }
  }
  return { data, width: h, height: w };
}

function rotarPixeles(src: PixelesQr, grados: number): PixelesQr {
  let actual = src;
  for (let k = 0; k < grados / 90; k++) actual = rotar90Pixeles(actual);
  return actual;
}

/**
 * Ladder COMPLETO sobre píxeles (kit §1.1): base A→B→C→C1.5 con early-exit
 * al primer payload; tier de rotación SOLO si el base falla (A@90→A@180→
 * A@270, early-exit ídem). null si nada decodifica (fallback limpio).
 * Puro — el QA lo ejercita con matrices QR reales headless.
 */
export function ladderQrDePixeles(pix: PixelesQr): string | null {
  for (const esp of BANDAS_BASE) {
    const payload = intentoSobrePixeles(pix, esp);
    if (payload != null) return payload; // early-exit al primer payload
  }
  for (const grados of QR_ROTACIONES) {
    const payload = intentoSobrePixeles(rotarPixeles(pix, grados), BANDA_A);
    if (payload != null) return payload;
  }
  return null;
}

// ─── Wrapper DOM (vía del banco — producción) ───────────────────────────────
/** dataURL del capture → píxeles del canvas de trabajo (lado largo ≤ 2048 —
 *  MISMA receta del canvasDeTrabajo del banco, byte-idéntico en semántica).
 *  null/jamás-throw: un fallo de render es sin-payload (fallback limpio). */
async function pixelesDeCapture(dataUrl: string): Promise<PixelesQr | null> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("QR_NO_DECODE_IMAGEN"));
    img.src = dataUrl;
  });
  const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const escala = Math.min(1, QR_LADO_LARGO / ladoMayor);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(img.naturalWidth * escala));
  cv.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const imgData = ctx.getImageData(0, 0, cv.width, cv.height);
  return { data: imgData.data, width: cv.width, height: cv.height };
}

/**
 * API del kit §1.1 — decodificar el QR de UN capture (dataURL de la vía
 * fileToCaptureDataUrl): canvas de trabajo ≤2048 → ladder A/B/C/C1.5 →
 * tier rotación A@90/180/270. Devuelve {payload} o null si nada decodifica.
 * JAMÁS throw hacia el runner (kit §1.1 — cualquier falla = sin-payload =
 * pipeline normal intacto).
 */
export async function decodificarQrDeCapture(
  dataUrl: string,
): Promise<{ payload: string } | null> {
  try {
    const pix = await pixelesDeCapture(dataUrl);
    if (!pix) return null;
    const payload = ladderQrDePixeles(pix);
    return payload != null ? { payload } : null;
  } catch {
    return null; // fallback limpio — la capa 0 jamás tumba el pipeline
  }
}

// ─── Espera acotada del caso «original en vuelo» (kit §1.2.4) ───────────────
/**
 * Espera APLAZADA: re-chequeo SOLO-LECTURA del estado del original cada
 * QR_ESPERA_INTERVALO_MS hasta QR_ESPERA_INTENTOS (techo efectivo 15 s —
 * sin timers globales; DEDUP_CINTA_CIERTA=2 intacto). Devuelve "reutiliza"
 * cuando el original aterriza con desenlace final (LISTA/DUPLICADA) y
 * "techo" cuando vence el techo O el original sale del vuelo por otra
 * puerta (ERROR / PENDIENTE / AUSENTE — esperar sería en balde: el
 * reproceso completo honesto manda). Los parámetros son inyectables SOLO
 * para el QA headless (timers cortos); en producción corren los default
 * del kit.
 */
export async function esperarDesenlaceQr(
  estadoDe: () => EstadoOriginalQr,
  intervaloMs: number = QR_ESPERA_INTERVALO_MS,
  maxIntentos: number = QR_ESPERA_INTENTOS,
): Promise<"reutiliza" | "techo"> {
  for (let i = 0; i < maxIntentos; i++) {
    await new Promise((r) => setTimeout(r, intervaloMs));
    const estado = estadoDe();
    if (estado === "LISTA" || estado === "DUPLICADA") return "reutiliza";
    if (estado === "ERROR" || estado === "PENDIENTE" || estado === "AUSENTE") {
      return "techo";
    }
    // PROCESANDO → sigue en vuelo: la espera continúa (el techo manda).
  }
  return "techo";
}

/** Prefijo corto del payload para trazas/informe (8 chars + «…») — SOLO
 *  cosmética: la decisión vive SIEMPRE en la igualdad EXACTA (red line 10). */
export function qrCorto(payload: string): string {
  return `${payload.slice(0, 8)}…`;
}
