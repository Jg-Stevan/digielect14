/**
 * Ítem 3.2 (mapa v2.3): UN motor en el paquete (ocr/motores/tesseract).
 * Este wrapper fija el langPath de ESTA app y CONSERVA el contrato de D
 * (throw en fallo + {texto, conf} — el bridge de D cae a RapidOCR por su
 * camino de siempre, byte a byte).
 * D88 (2026-11-10): el langPath lleva la versión del sabor servido
 * (/models/tess/4.0.0_fast) para invalidar IndexedDB/SW/HTTP en equipos
 * que ya cachearon el traineddata anterior.
 */
import {
  configurarTesseract,
  tesseractReconocer,
  tesseractInit,
  tesseractReiniciar,
  tessPrecalentar as tessPrecalentarPaquete,
} from "@jg-stevan/scanner-core/ocr/motores/tesseract";

configurarTesseract({ langPath: "/models/tess/4.0.0_fast" });

export { tesseractInit, tesseractReiniciar };

/** Contrato de D: throw en fallo (la cascada del bridge cae a RapidOCR). */
export async function tessReconocer(
  dataUrl: string,
  presupuestoMs?: number,
): Promise<{ texto: string; conf: number }> {
  const r = await tesseractReconocer(dataUrl, presupuestoMs);
  if (!r || r.texto.length === 0) {
    throw new Error("tess-best: sin resultado — cascada cae a RapidOCR");
  }
  return { texto: r.texto, conf: r.confMedia };
}

/** Precalentamiento fire-and-forget (mismo contrato del kit GO-B). */
export function tessPrecalentar(): void {
  tessPrecalentarPaquete();
}
