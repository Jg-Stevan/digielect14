/**
 * KIT e14-adaptacion-dispositivo-v1 — PLAN adaptativo (knobs de RECURSOS).
 *
 * Heredero del espíritu del kit e14-gama-adaptativa-v1 (D74, retirado con
 * el módulo masiva): el tier YA detectado deja de ser solo-telemetría y
 * CONSUME presupuestos de recursos — acotado a knobs de PERFORMANCE
 * (jamás reglas de negocio: scores, gates, umbrales y desenlaces del
 * pipeline NO se tocan) y con el kill-switch del dueño:
 *
 *   FLAG `adaptacionDispositivo` (default TRUE — petición explícita del
 *   dueño 2026-11) · override manual localStorage MÁXIMA prioridad (D6):
 *   {"adaptacionDispositivo": false} ⇒ knobs byte-idénticos a hoy.
 *
 * PRIORIDAD POR KNOB (hilos OCR):
 *   1. override MANUAL del dueño (`ocrThreadsTope` en e14-flags-overrides)
 *      — el plan NO lo toca (D6: la app jamás revierte una decisión manual).
 *   2. plan adaptativo por tier — BAJO 2 · MEDIO 3 · ALTO 6 (exprimir en
 *      gama alta; proteger en gama baja). Siempre capado por
 *      hardwareConcurrency y exigido por SAB+COOP/COEP (1 hilo sin ellos).
 *   3. default histórico 4 (FLAGS_DEFAULT.ocrThreadsTope) — adaptación OFF.
 *
 * SYNC y BARATO: `planAdaptativo()` no hace async ni benchmarks — usa
 * `tierRapido()` (señales baratas del navigator). El perfil COMPLETO
 * (async, con benchmarks) alimenta el informe IA y la UI.
 */

import { FLAGS_DEFAULT, leerFlags } from "../flags";
import { leerOverridesFlags } from "../obs/politica";
import { tierRapido } from "./perfil";
import type { Tier } from "../obs/tipos";

/** Hilos OCR objetivo por tier (ANTES del cap por hardwareConcurrency).
 *  ALTO exprime (6 > default 4 — petición del dueño); BAJO protege. */
const HILOS_POR_TIER: Record<Tier, number> = {
  BAJO: 2,
  MEDIO: 3,
  ALTO: 6,
};

export interface PlanAdaptativo {
  /** false ⇒ el flag del dueño está OFF ⇒ knobs byte-idénticos a hoy. */
  adaptado: boolean;
  tier: Tier;
  tierInferido: boolean;
  /** Hilos wasm del OCR ya RESUELTOS (prioridad + capas aplicadas). */
  ocrHilos: number;
  /** De dónde salió ocrHilos (auditoría honesta para informe/UI/traza). */
  ocrHilosFuente: "override-manual" | "plan-adaptativo" | "default";
  /** Sin SharedArrayBuffer+COOP/COEP el wasm corre a 1 hilo — registro. */
  hilosWasmDisponibles: boolean;
}

function nucleosDisponibles(): number {
  try {
    if (typeof navigator === "undefined") return 1;
    const n = navigator.hardwareConcurrency;
    return typeof n === "number" && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function hilosWasmDisponibles(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof self !== "undefined" &&
      self.crossOriginIsolated === true
    );
  } catch {
    return false;
  }
}

/** Plan efectivo de recursos — SYNC, barato, jamás lanza. Consumidores:
 *  rapidocr (numThreads), PanelDev (visor) e informe-ia (auditoría). */
export function planAdaptativo(): PlanAdaptativo {
  const nucleos = nucleosDisponibles();
  const hilosOk = hilosWasmDisponibles();
  const tierRap = tierRapido();
  try {
    const flags = leerFlags();
    if (!flags.adaptacionDispositivo) {
      // Adaptación OFF (flag del dueño o kill-switch) → histórico puro.
      return {
        adaptado: false,
        tier: tierRap.tier,
        tierInferido: tierRap.tierInferido,
        ocrHilos: hilosOk
          ? Math.min(FLAGS_DEFAULT.ocrThreadsTope, nucleos)
          : 1,
        ocrHilosFuente: "default",
        hilosWasmDisponibles: hilosOk,
      };
    }
    // 1 · override MANUAL del dueño — manda sobre el plan (D6).
    const overrideHilos = leerOverridesFlags().ocrThreadsTope;
    if (typeof overrideHilos === "number") {
      return {
        adaptado: true,
        tier: tierRap.tier,
        tierInferido: tierRap.tierInferido,
        ocrHilos: hilosOk ? Math.min(overrideHilos, nucleos) : 1,
        ocrHilosFuente: "override-manual",
        hilosWasmDisponibles: hilosOk,
      };
    }
    // 2 · plan adaptativo por tier (capado por hardware real).
    return {
      adaptado: true,
      tier: tierRap.tier,
      tierInferido: tierRap.tierInferido,
      ocrHilos: hilosOk ? Math.min(HILOS_POR_TIER[tierRap.tier], nucleos) : 1,
      ocrHilosFuente: "plan-adaptativo",
      hilosWasmDisponibles: hilosOk,
    };
  } catch {
    // Fallo inesperado → histórico puro (jamás romper el OCR por el plan).
    return {
      adaptado: false,
      tier: tierRap.tier,
      tierInferido: tierRap.tierInferido,
      ocrHilos: hilosOk ? Math.min(FLAGS_DEFAULT.ocrThreadsTope, nucleos) : 1,
      ocrHilosFuente: "default",
      hilosWasmDisponibles: hilosOk,
    };
  }
}

/** Helper del consumidor (rapidocr.ts) — resuelve numThreads con las MISMAS
 *  condiciones de siempre (SAB + crossOriginIsolated → 1 hilo sin ellas). */
export function numThreadsOcrEfectivos(): number {
  const plan = planAdaptativo();
  return plan.hilosWasmDisponibles ? plan.ocrHilos : 1;
}
