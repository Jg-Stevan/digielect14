/**
 * 7.1 (plan de remediación, cierra C3) — ÚNICA FUENTE DE VERDAD de los
 * números del producto. Antes vivían como literales crudos repartidos entre
 * `pipeline.ts` y `scanner-core-bridge.ts` (6.4/6.5/7.9 en los caps del gate,
 * 0.92/0.9 de re-encode JPEG, fracciones de la banda del sello, techo sin
 * señal) o duplicados entre módulos: cambiar un umbral exigía cazar el
 * número a mano en dos archivos y cualquier ajuste aplicado a un solo lado
 * producía DOS productos distintos según el camino del acta.
 *
 * Reglas del módulo:
 *  · SOLO números (y los alias históricos que el repo ya usa). El copy de
 *    los rechazos (DETALLE_*) vive en el bridge — no es un umbral.
 *  · Ningún import del bridge ni del pipeline (capa política — ambos
 *    consumen AQUÍ; la flecha de valores jamás se invierte).
 *  · Las constantes de LECTURA (PISO_LECTURA_FUERTE/TECHO_LECTURA_DEBIL)
 *    ya viven con definición ÚNICA en el paquete
 *    (`@jg-stevan/scanner-core/dominio/senal-lectura.ts`), junto a la señal
 *    que las aplica y su test de fronteras — aquí se RE-EXPORTAN para que
 *    la app tenga un solo punto de importación (moverlas rompería la
 *    autosuficiencia del paquete, que también sirve al hermano).
 *  · Cambiar un valor de aquí ES una decisión de producto: registrarla en
 *    `docs/DECISIONS.md` antes de tocar (DEUDA.md §Intocables).
 *
 * Consumidores: `politica/gate.ts` (7.2 — el helper único del gate),
 * `pipeline.ts`, `scanner-core-bridge.ts`.
 */

// ── Score → status (§4.1 SPEC-e14-score-ocr) ─────────────────────────────

/**
 * Frontera ADVERTENCIA/RECHAZADA de `statusDeScore` (paquete, dominio/types):
 * score < 6.5 ⇒ RECHAZADA · ≥ 6.5 ⇒ ADVERTENCIA u ÓPTIMA (≥ 8). La usa el
 * gate (rechazo por CALIDAD) y el mapeo del chip SIM (≥ 6.5 → asset MEDIO).
 * El literal gemelo vive DENTRO del paquete (statusDeScore) — moverlo aquí
 * rompería el paquete; la paridad entre ambos la fija el golden del
 * clasificador y los tests de frontera del paquete.
 */
export const UMBRAL_RECHAZO_SCORE = 6.5;

/**
 * Cap de los VETOS del sitio (INCOMPLETA/SIN_VOTOS) y techo del level
 * "poor": el mayor valor con un decimal por debajo de UMBRAL_RECHAZO_SCORE
 * — un acta vetada queda RECHAZADA garantizada (coherencia score↔status).
 * Antes: `Math.min(score, 6.4)` repetido a mano en ambos pipelines
 * (pipeline.ts:728,731 · bridge:2035-2036) y el techo poor del
 * scoreDeCalidad (bridge:484).
 */
export const UMBRAL_SCORE_INCOMPLETA = 6.4;

/**
 * Techo ADVERTENCIA (7.9): el score máximo de un acta que NO puede ser
 * ÓPTIMA (statusDeScore: ≥ 8 sería ÓPTIMA/auto-envío). Un solo valor con
 * tres usos que hoy repetían el literal: el techo del level "fair"
 * (bridge:483), el escudo anti-fondo D10 (fondo/sombra al filo del warp) y
 * el escudo-manual Q2 del recorte del editor + acta RECORTADA (OCR de
 * secciones). El alias histórico conserva el nombre que el repo ya imprime
 * en techosDiag y expone por `PasosPipelineL2`.
 */
export const TECHO_ADVERTENCIA = 7.9;
/** Alias histórico del escudo D10 (MISMO valor, cero drift). */
export const TECHO_ESCUDO_FONDO = TECHO_ADVERTENCIA;

/**
 * §D1 (SPEC-e14-score-ocr): techo de una foto SIN SEÑAL de contenido del
 * acta (bolsa de papas, pared, borrosa total) — por debajo de
 * UMBRAL_RECHAZO_SCORE ⇒ «score bajo» garantizado. Movido desde el bridge
 * (donde vivía como const local y viajaba inyectado por PasosPipelineL2).
 */
export const TECHO_SIN_SENAL = 4.9;

// ── Lectura (KIT e14-score-lectura-v1) — definición ÚNICA en el paquete ──
export {
  PISO_LECTURA_FUERTE,
  TECHO_LECTURA_DEBIL,
} from "@jg-stevan/scanner-core/dominio/senal-lectura";

// ── Re-encode JPEG ────────────────────────────────────────────────────────

/** Calidad del grab del frame de cámara y de los ROIs de OCR
 *  (`capturarFrame`, `recortarRoiDataUrl` — antes `toDataURL("image/jpeg", 0.92)`). */
export const CALIDAD_JPEG_REVISION = 0.92;

/** Calidad del recodificado de la banda del sello para el OCR
 *  (`ocrBanda` — antes `toDataURL("image/jpeg", 0.9)`). */
export const CALIDAD_JPEG_ENVIO = 0.9;

// ── Banda del sello (franja de OCR §5, `ocrBanda`) ───────────────────────

/** Fracciones del crop de la banda sobre la foto procesada: la franja
 *  horizontal del sello KIT va del 22 % al 88 % del ancho y del 3 % al 13 %
 *  del alto (antes literales 0.22/0.03/0.88/0.13 en bridge:1245-1248). */
export const BANDA_IZQ_FRACCION = 0.22;
export const BANDA_ARRIBA_FRACCION = 0.03;
export const BANDA_DER_FRACCION = 0.88;
export const BANDA_ABAJO_FRACCION = 0.13;

// ── Intentos ─────────────────────────────────────────────────────────────

/**
 * Intentos de escaneo antes de agotar (la contingencia C4 — EN_REVISION_HUMANA
 * con el rechazo real — llega solo al agotar). El literal 4 está duplicado hoy
 * en `store.ts` (default de captura y de re-escaneo): la migración de store.ts
 * a esta constante queda pendiente (docs/PENDIENTES-INTEGRACION.md — el store
 * está en zona de otro agente de la ola).
 */
export const MAX_INTENTOS_ESCANEO = 4;
