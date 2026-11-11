/**
 * C-30 — RELAJACIÓN del guard-borde para la vía IMPORTAR (fuente ARCHIVO:
 * documento ya capturado, NO foto de cámara — OPCIÓN 2 del plan de
 * anomalías, decisión de producto tomada). El gate de CÁMARA NO cambia
 * (integridad del encuadre vivo).
 *
 * VIVE EN LA CAPA APP a propósito: el guard canónico (`verificarCompletitud`)
 * pertenece al motor `packages/scanner-core`, compartido BYTE A BYTE con
 * supervision-e14 (`scripts/qa-paridad-motor.ts`) — una relajación exclusiva
 * del digitalizador móvil no puede viajar al paquete sin sincronizar el
 * hermano (AGENTS.md §motor). El veredicto del motor se RECIBE y se re-lee
 * aquí; la regla D1 del motor queda intacta.
 *
 * Qué relaja (evidencia 4.9/6.4/10.0 del plan: archivos válidos condenados
 * por geometría con contenido perfecto):
 *  · COBERTURA — el umbral geométrico baja de 0.25 (AREA_MINIMA del motor)
 *    a 0.15: un importado con el acta ocupando el 15-25 % del encuadre deja
 *    de ser «sospechoso de cortadura» por sí solo (no hay encuadre que
 *    corregir: la foto ya existe).
 *  · TINTA AL FILO — solo ADVIERTE (no veta): la densidad medida queda como
 *    evidencia en el log-contrato (borde=/tintaFilo=/franja=), pero el
 *    veredicto no bloquea el acta.
 * Qué NO relaja: la rama degenerada del motor (§7 — recorte inservible:
 * `tintaFilo` con densidades vacías, sin medición) ni el veto 4/4 fiduciales
 * del pipeline (viven fuera de este helper).
 */
import type { Quad } from "@jg-stevan/scanner-core/core/types";
import type { ResultadoCompletitud } from "@jg-stevan/scanner-core/dominio/completitud";

/** Umbral de cobertura RELAJADO solo para IMPORTAR (motor: 0.25). */
export const AREA_MINIMA_ARCHIVO = 0.15;

/** Área del cuadrilátero en fracciones de encuadre (shoelace, robusta al
 *  orden de las esquinas). Réplica de la fórmula `areaDeQuad` del motor
 *  (completitud.ts) — duplicada A PROPÓSITO por la paridad del paquete (ver
 *  cabecera); la regla D1 no se toca aquí. */
export function areaDeQuadArchivo(quad: Quad): number {
  let dobleArea = 0;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % quad.length];
    dobleArea += p.x * q.y - q.x * p.y;
  }
  return Math.abs(dobleArea) / 2;
}

/** Por qué se relajó (evidencia para el log-contrato — token `c30=`). */
export type MotivoRelajacion = "cobertura" | "tinta-filo";

/**
 * Re-leer un veredicto NEGATIVO del guard bajo la postura de IMPORTAR.
 * El veredicto positivo pasa intacto; la sospecha/tinta/densidades se
 * conservan SIEMPRE (el log conserva la evidencia — solo cambia `completa`).
 */
export function relajarCompletitudParaArchivo(
  r: ResultadoCompletitud,
  quad: Quad,
): { resultado: ResultadoCompletitud; motivo: MotivoRelajacion | null } {
  if (r.completa) return { resultado: r, motivo: null };
  // (a) COBERTURA relajada: la sospecha vino del brazo de área (los 4 lados
  // marcados) y el área real está EN o POR ENCIMA del umbral de IMPORTAR →
  // quad «sano» bajo la postura de archivo (el motor ni siquiera habría
  // corrido el análisis con 0.15).
  if (r.sospecha === "N|S|E|O" && areaDeQuadArchivo(quad) >= AREA_MINIMA_ARCHIVO) {
    return { resultado: { ...r, completa: true }, motivo: "cobertura" };
  }
  // (b) Tinta al filo MEDIDA (rama no degenerada: densidades presentes) →
  // solo advierte; el veredicto NO bloquea el acta importada.
  if (r.tintaFilo && r.densidades.length > 0) {
    return { resultado: { ...r, completa: true }, motivo: "tinta-filo" };
  }
  // Degenerada §7 (sin medición) u otro caso → el veto de hoy se conserva.
  return { resultado: r, motivo: null };
}
