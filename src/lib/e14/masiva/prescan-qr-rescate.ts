"use client";

/**
 * KIT e14-prescan-rescate-qr-v1 — ENMIENDA §F.3 del kit e107 (orden del
 * dueño: «intentar leer rápido con jsQR, y dejar lo último y difícil para
 * zxing»).
 *
 * Tier de RESCATE del pre-scan: SOLO corre tras un null explícito de
 * leerQrDeWarped (BarcodeDetector → jsQR ≤1600). Red lines respetadas:
 *  · zxing JAMÁS en el worker (dictamen e73 #3): este módulo vive en MAIN
 *    THREAD — el grafo del worker del pre-scan sigue jsQR-only (smoke del
 *    gate intacto) y el orquestador sigue SIN mencionar zxing (QA §F.3:
 *    la frontera se conserva, el rescate tiene módulo propio).
 *  · Cero import estático de "zxing-wasm": la capa 0 llega por import
 *    DINÁMICO cacheado (mismo gesto e73 — una vez por vida de la página);
 *    el chunk del wasm solo se descarga si un rescate real lo pide.
 *  · identidad-qr.ts queda INTACTO: se reusan SUS tiers YA TESTEADOS —
 *    R1 = decodificarQrDeRecorte (esquina estándar 600 px: jsQR → zxing,
 *    los DOS binarizadores GlobalHistogram→LocalAverage) · R2 =
 *    barridoQrZxingDePixeles (grilla ceñida con presupuesto interno
 *    ZXING_BARRIDO_PRESUPUESTO_MS = 4 000 ms).
 *  · Jamás throw (doctrina del conservador): cualquier fallo = null y la
 *    fila sigue PENDIENTE (regla de oro 4 — QR no leído jamás se descarta).
 *  · Flag del dueño prescanQrRescate (default OFF): sin flag, este módulo
 *    ni se intenta (el call-site está tras el guard del orquestador).
 */
import { logger } from "../../logger";
import type { PixelesQr } from "./qr-pixeles";

/** Cap del raster del rescate — MISMO tope del intento jsQR
 *  (QR_WARP_LADO_TOPE de leerQrDeWarped): el rescate ve la MISMA imagen
 *  que ya falló, nunca más grande (cero costo extra de raster). */
const QR_RESCATE_LADO_TOPE = 1600;

/** Import dinámico CACHED de la capa 0 (identidad-qr) — una sola tentativa
 *  por vida de la página; el wasm solo descarga si un rescate lo pide.
 *  Fallo de red/bundle → catch del caller = null honesto (fila PENDIENTE). */
let modCapa0: Promise<typeof import("./identidad-qr")> | null = null;
function capa0(): Promise<typeof import("./identidad-qr")> {
  if (modCapa0 === null) modCapa0 = import("./identidad-qr");
  return modCapa0;
}

/** Raster RGBA del warped (mismo gesto de leerQrDeWarped: drawImage +
 *  getImageData con el mismo cap) — null honesto sin OffscreenCanvas. */
function pixelesDeWarped(warped: ImageBitmap): PixelesQr | null {
  try {
    if (typeof OffscreenCanvas === "undefined") return null;
    const lado = Math.max(warped.width, warped.height);
    const escala = lado > QR_RESCATE_LADO_TOPE ? QR_RESCATE_LADO_TOPE / lado : 1;
    const w = Math.max(1, Math.round(warped.width * escala));
    const h = Math.max(1, Math.round(warped.height * escala));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(warped, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h };
  } catch {
    return null; // sin raster no hay rescate — jamás tumba la fila
  }
}

/** payload corto para trazas — mismo gesto de qrCorto de la capa 0. */
function qrCorto(payload: string): string {
  return `${payload.slice(0, 8)}…`;
}

/**
 * RESCATE del QR difícil sobre el warped (SOLO tras null del camino
 * rápido): R1 esquina estándar (recorte-600 de e71: jsQR → zxing × 2
 * binarizadores) → R2 barrido ceñido zxing (presupuesto interno 4 000 ms).
 * Devuelve payload EXACTO o null — jamás throw, jamás inventa. La traza
 * deja el costo y la vía visibles: via=recorte|barrido|null.
 */
export async function rescateQrDeWarped(
  warped: ImageBitmap,
): Promise<string | null> {
  try {
    const pix = pixelesDeWarped(warped);
    if (!pix) return null;
    const mod = await capa0();
    const t0 = performance.now();
    // R1 — esquina estándar (e71 Opt-2: el QR del E-14 vive arriba-izquierda;
    // decodificarQrDeRecorte = recorte 600 px → jsQR attemptBoth → zxing con
    // los DOS binarizadores — MISMO contrato del barrido: QRCode-only).
    const recorte = await mod.decodificarQrDeRecorte(pix);
    if (recorte != null) {
      logger.info(
        `[e14] prescan-qr rescate via=recorte ms=${Math.round(performance.now() - t0)} payload=${qrCorto(recorte)}`,
      );
      return recorte;
    }
    // R2 — LO ÚLTIMO Y DIFÍCIL (pedido literal del dueño): barrido ceñido
    // zxing sobre la grilla completa — presupuesto interno 4 000 ms (el
    // chequeo performance.now() > limite va POR VENTANA, al vencer devuelve
    // null SIN exhaustar). Módulo indisponible → null inmediato.
    const barrido = await mod.barridoQrZxingDePixeles(pix);
    if (barrido != null) {
      logger.info(
        `[e14] prescan-qr rescate via=barrido ms=${Math.round(performance.now() - t0)} payload=${qrCorto(barrido)}`,
      );
      return barrido;
    }
    logger.info(
      `[e14] prescan-qr rescate via=null ms=${Math.round(performance.now() - t0)} — QR difícil no rescató (fila sigue PENDIENTE)`,
    );
    return null;
  } catch {
    return null; // el rescate jamás tumba la fila (regla de oro 4)
  }
}
