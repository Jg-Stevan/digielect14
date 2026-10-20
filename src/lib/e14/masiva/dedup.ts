/**
 * KIT e14-masiva-tiempos-v1 (PR-1, T-dedup): dedup por hash perceptual —
 * dhash 64-bit sobre el thumb 320px que ya produce `hacerThumb` (reuso,
 * costo del hash <5 ms; el decode del archivo es el costo real y corre en
 * background al ENCOLAR, nunca bloquea la UI).
 *
 * Hamming ≤ 6 contra filas existentes → la fila se marca DUPLICADA (estado
 * SOLO visual) y al procesar REUTILIZA el resultado de la original (kit §2).
 * Conservador: cualquier fallo (decode, IDB, hash) → hash null → la fila
 * NUNCA se marca (procesa normal — jamás inventar).
 */
import { fileToCaptureDataUrl } from "@jg-stevan/scanner-core/image-processor";
import { hacerThumb } from "./runner";

/** Tolerancia del kit §2: gemelas reales caen 0-2; fotos distintas >12. */
export const HAMMING_MAX = 6;

/**
 * dhash 64-bit clásico (horizontal gradient) ASYNC: decode del thumb →
 * canvas 9×8 en grises → bit=1 cuando gray[x] > gray[x+1] → 8 bits × 8 filas
 * = 64 bits → hex 16. Cualquier fallo → null (jamás tumba el encolado).
 */
export async function dhash64DeDataUrl(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("DHASH_NO_DECODE"));
      img.src = dataUrl;
    });
    const W = 9;
    const H = 8;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    // Grises fila por fila (RGBA).
    const gris: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        gris[y * W + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    let hex = "";
    for (let y = 0; y < H; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) {
        byte = (byte << 1) | (gris[y * W + x] > gris[y * W + x + 1] ? 1 : 0);
      }
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

/** Distancia de Hamming entre dos hashes hex 64-bit (longitudes distintas → 64). */
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

/**
 * dhash de UN archivo de la cola: la MISMA vía del pipeline (fileToCaptureDataUrl
 * — EXIF/12MP, HEIC incluido) → thumb 320 (hacerThumb — reuso kit §2) → dhash.
 * El resultado es idéntico para gemelas .heic/.jpg (misma conversión del core).
 * Cualquier fallo → null (la fila procesa normal — conservador).
 */
export async function dhashDeArchivo(file: File): Promise<string | null> {
  try {
    const dataUrl = await fileToCaptureDataUrl(file);
    const thumb = await hacerThumb(dataUrl);
    if (!thumb) return null;
    return await dhash64DeDataUrl(thumb);
  } catch {
    return null;
  }
}
