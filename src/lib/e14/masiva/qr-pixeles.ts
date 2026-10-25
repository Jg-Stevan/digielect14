/**
 * KIT e73-sondeo-qr-precoz-v1 (§A.2) — NÚCLEO PURO de píxeles para decode QR.
 *
 * Módulo NUEVO, puro y worker-safe: cero DOM, cero zxing, cero canvas — SOLO
 * jsQR vendido (puro JS) + aritmética de píxeles. El contenido fue MOVIDO
 * byte a byte de `identidad-qr.ts` SIN cambiar comportamiento (refactor
 * ADITIVO declarado por el kit §A.2 — "preferible: mover a módulo puro nuevo
 * `qr-pixeles.ts` re-exportado por identidad-qr — cero diffs en consumidores").
 * identidad-qr.ts re-exporta TODO lo que aquí vive: los consumidores
 * existentes (runner.ts, qa-qr-identidad.ts, tests) no cambian ni una línea.
 *
 * Motivo del módulo: el WORKER de sondeo (`sondeo-qr.worker.ts`) importa de
 * aquí las primitivas S1/S2 del ladder presupuestado. Mantener este archivo
 * libre de zxing-wasm y de DOM es lo que hace seguro el bundling del worker
 * (corrección #3 del dictamen: zxing-wasm PROHIBIDO en el worker — la red de
 * seguridad in-pool lo conserva; jsQR vendido es puro JS, worker-safe).
 *
 * RED LINES heredadas (kit e63m §3 + e64 §7 — vigentes byte a byte):
 * · Payload EXACTO jamás fuzzy (llave opaca — jamás prefijos, red line 10).
 * · jsQR 1.4.0 VENDIDO byte-idéntico al de #72 (vendor/jsQR.js).
 * · Jamás throw: un intento que falla = null (el caller decide).
 */
import jsQR from "./vendor/jsQR.js";

/** Fuente de píxeles RGBA — la MISMA forma que devuelve getImageData
 *  (canal a canal, 4 bytes por píxel, fila por fila). */
export interface PixelesQr {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Bandas del ladder — fracciones EXACTAS del banco (#72 bench.html). */
export interface EspecieBanda {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  escala: number;
}

export const BANDAS_BASE: EspecieBanda[] = [
  { id: "A", x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, escala: 1 }, // imagen completa
  { id: "B", x0: 0.0, y0: 0.0, x1: 0.45, y1: 0.25, escala: 1 }, // banda top-left
  { id: "C", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1 }, // banda ajustada
  { id: "C1.5", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1.5 }, // reintento up-escalado
];

export const BANDA_A = BANDAS_BASE[0]!; // floor del tier de rotación (A completa)

// ─── Núcleo puro: UN intento de decode sobre UNA banda ──────────────────────
/** Semántica EXACTA del intentoDecode del banco: banda fuente redondeada
 *  (sw/sh), destino = banda × escala (dw/dh), jsQR con attemptBoth, payload
 *  EXACTO tal cual sale. escala=1 → copia 1:1 (idéntica al drawImage del
 *  banco); escala>1 → remuestreo bilinear (misma intención del smoothing
 *  del banco — única diferencia microscópica vs drawImage del navegador,
 *  declarada en el REPORTE: C1.5 es el 4.º intento del ladder, el floor del
 *  tier de rotación es A a escala 1 EXACTO). */
export function intentoSobrePixeles(cv: PixelesQr, esp: EspecieBanda): string | null {
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

export function rotarPixeles(src: PixelesQr, grados: number): PixelesQr {
  let actual = src;
  for (let k = 0; k < grados / 90; k++) actual = rotar90Pixeles(actual);
  return actual;
}
