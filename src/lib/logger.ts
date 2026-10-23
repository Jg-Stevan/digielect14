/**
 * Helper de logging con política ÚNICA del proyecto (overnight 2026-10-22,
 * Prioridad 3 del PLAN-overnight.md — AUDIT.md fila «Observabilidad»).
 *
 * Política:
 *  · debug/info — SOLO en desarrollo (`process.env.NODE_ENV !== "production"`).
 *    Next sustituye NODE_ENV en build → el minificador elimina las llamadas
 *    de producción (cero costo de string-building en el bundle servido).
 *  · warn/error — SIEMPRE (útiles en producción: degradaciones visibles en
 *    devtools del operador de mesa, p. ej. divipol → MANUAL).
 *
 * El formato de los mensajes NO cambia (prefijo `[e14] …` incluido en el
 * propio mensaje del caller) — las trazas que los QA y la consola del dueño
 * conocen quedan byte-idénticas en desarrollo.
 *
 * Migración pendiente (Fase 4, módulos GRANDES — fuera de alcance
 * overnight): runner.ts (22 console.info), rapidocr.ts (5), masiva/store.ts
 * (4), scanner-core-bridge.ts (3), identidad-qr.ts (3), store.ts (2),
 * orientacion.ts (2), precalor.ts (1). Los módulos pequeños ya estaban
 * limpios (dedup/historico/cola/origen: 0 console — grep overnight).
 */

/** Único archivo del repo con licencia de console.* — cuando la tanda
 *  futura de ESLint active `no-console`, la directiva vive SOLO aquí. */
/* eslint-disable no-console */

const esDev = process.env.NODE_ENV !== "production";

export const logger = {
  /** Trazas de desarrollo (pipeline, presupuestos, dedup) — eliminadas en
   *  el bundle de producción por sustitución estática de NODE_ENV. */
  debug(...args: unknown[]): void {
    if (esDev) console.debug(...args);
  },
  /** Hitos informativos de desarrollo — eliminadas en producción. */
  info(...args: unknown[]): void {
    if (esDev) console.info(...args);
  },
  /** Degradaciones/avisos — SIEMPRE (el operador debe poder verlos). */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  /** Errores — SIEMPRE. */
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
