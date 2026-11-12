/**
 * P-22 (plan 2026-11-12) — HUELLAS del sobre del puente (capa 2 y 3 del
 * anti-reproceso del panel de supervisión).
 *
 * La deuda P2 del reporte: el SHA-256 de los bytes (C-08) no ve una acta
 * RE-FOTOGRAFIADA (bytes distintos, misma imagen). El sobre ahora viaja con:
 *
 *  · `qrPayload` — el payload EXACTO leído del código impreso (capa 0),
 *    normalizado con `normalizarQrPayload`. La comparación del panel es
 *    IGUALDAD EXACTA (RED LINE 10 del dedup de masiva: jamás prefijos, sin
 *    fuzzy).
 *  · `dhash64` — hash perceptual 64-bit (hex 16) de la foto PROCESADA; el
 *    respaldo SIN QR: distancia de Hamming ≤ 6 (umbral D65) decide «misma
 *    imagen».
 *
 * App-side A PROPÓSITO (glue de este pipeline): el paquete compartido
 * scanner-core es el contrato de PARIDAD (qa-paridad-motor 20/20) y una
 * huella de dedup del puente NO es dominio del motor — vive aquí como
 * `src/lib/e14/masiva/dedup.ts` vive en el hermano.
 */

/** dhash horizontal 9×8 → 64 bit (hex 16): gradiente de luminancia por fila
 *  sobre la foto redimensionada a 9×8. decode con createImageBitmap (EXIF ya
 *  horneado en la foto PROCESADA del pipeline — la del sobre). Cualquier
 *  fallo (canvas, contexto, decode) → null: sin huella comparable, jamás
 *  relleno (misma doctrina del SHA C-08). */
export async function dhash64DeDataUrl(dataUrl: string): Promise<string | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const ANCHO = 9;
      const ALTO = 8;
      const canvas = document.createElement("canvas");
      canvas.width = ANCHO;
      canvas.height = ALTO;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, ANCHO, ALTO);
      const { data } = ctx.getImageData(0, 0, ANCHO, ALTO);
      // Grises fila por fila (RGBA — mismas ponderaciones que el core).
      const gris: number[] = [];
      for (let y = 0; y < ALTO; y++) {
        for (let x = 0; x < ANCHO; x++) {
          const i = (y * ANCHO + x) * 4;
          gris[y * ANCHO + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
      }
      let hex = "";
      for (let y = 0; y < ALTO; y++) {
        let byte = 0;
        for (let x = 0; x < 8; x++) {
          byte = (byte << 1) | (gris[y * ANCHO + x] > gris[y * ANCHO + x + 1] ? 1 : 0);
        }
        hex += byte.toString(16).padStart(2, "0");
      }
      return hex;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Distancia de Hamming entre dos hashes hex de 64 bit (16 caracteres hex).
 *  Longitudes distintas o ausentes → 64 (máxima distancia: jamás «igual»).
 *  Gemelo EXACTO del de `masiva/dedup.ts` del hermano (y de
 *  `shared/e14/huellas.ts` en sup) — misma aritmética bit a bit. */
export function hamming64(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Normalización del payload del código impreso: trim + NFKD sin diacríticos
 *  + mayúsculas + sin espacios. Vacío/extraño → null (sin huella). Gemelo del
 *  de `shared/e14/huellas.ts` del hermano. */
export function normalizarQrPayload(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
  return limpio.length > 0 ? limpio : null;
}
