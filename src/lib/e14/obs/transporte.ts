/**
 * KIT e14-observabilidad-v1 — TRANSPORTE HTTP de reportes. STUB del
 * agente 1: la implementación REAL es del AGENTE 3 (feat/obs-flags-qa-v1,
 * zona exclusiva de este archivo — README-KITS §1).
 *
 * IMPLEMENTA: AGENTE 3 (feat/obs-flags-qa-v1) — contrato README §4.3:
 *  · iniciarTransporte() — idempotente; no-op si flags.endpointReportes
 *    === null (D1: el transporte vive SOLO con endpoint configurado).
 *  · estadoTransporte() — { activo, lotesPendientes, fallosSeguidos }.
 *  · Outbox en IndexedDB `e14-obs-outbox` (DB PROPIA — JAMÁS abrir
 *    `e14-obs` del buffer del agente 1, §4.1).
 */
import { leerFlags } from "../flags";

/** Idempotente; no-op si no hay endpoint configurado (D1). */
export function iniciarTransporte(): void {
  // STUB — la implementación del agente 3 lee leerFlags().endpointReportes
  // aquí. Hoy: sin endpoint (default null) → no-op total.
  void leerFlags();
}

/** Estado visible para el panel dev del agente 2 (contrato §4.3). */
export function estadoTransporte(): { activo: boolean; lotesPendientes: number; fallosSeguidos: number } {
  return { activo: false, lotesPendientes: 0, fallosSeguidos: 0 };
}
