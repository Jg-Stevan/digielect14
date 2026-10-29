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

/** KIT e14-gama-baja-20s-v1 — knobs OCR por tier (además de ocrHilos).
 *  SOLO knobs de PERFORMANCE (jamás reglas de negocio: scores, gates,
 *  umbrales y desenlaces del pipeline NO se tocan):
 *
 *  · reOcrModo — cómo es el 2.º intento cuando la 1.ª pasada (det 1280)
 *    sale débil (`necesitaSegunda`, ocr-escalonado §2.3):
 *      "completo"     = re-OCR 1920 de siempre (MEDIO/ALTO — byte-idéntico).
 *      "roi-cabecera" = rescate de la franja superior 0-25% re-escalada a
 *                       cap 1920 (MISMO helper y fracciones de la cascada
 *                       K3: recortarRoiDataUrl + ROI_FRACCIONES.top). En
 *                       gama baja el re-OCR completo cuesta ~2.5× la 1.ª
 *                       pasada (det ≈ (1920/1280)² + cls + rec de TODO el
 *                       acta) y es el multiplicador dominante del pipeline
 *                       (126 s low-end mono-hilo — sim-recursos).
 *  · segundaPresupuestoMs — tope PARED del pipeline para PERMITIR el
 *      intento extra (null = sin tope adicional — manda el presupuesto
 *      EXISTENTE del pipeline, §3 del kit escalonado). BAJO 15000: la
 *      1.ª pasada + pre-OCR ya consumen ~15-23 s con 2 hilos ⇒ el rescate
 *      entra SOLO cuando hay margen real; nunca se abandona una pasada
 *      a mitad (solo se decide NO ABRIR una nueva).
 *  · probeBudgetMs — presupuesto del sondeo de orientación (default 12000
 *      = PROBE_BUDGET_MS de orientacion.ts, duplicado como literal para NO
 *      crear el ciclo plan→orientacion→rapidocr→plan). BAJO 6000 =
 *      fail-fast: si la miniatura no alcanzó confianza, el sondeo completo
 *      en gama baja rara vez converge dentro de presupuesto (medido: det
 *      3037 ms en HP 4-core; D56 §3 T3) — abortar pronto y seguir con 0°.
 *
 *  Prioridad D6 intacta: override MANUAL del dueño (ocrThreadsTope) manda
 *  sobre ocrHilos; los knobs nuevos NO tienen override (el kill-switch
 *  `adaptacionDispositivo: false` los revierte TODOS al histórico). */
const KNOBS_OCR_HISTORICO = {
  ocrReOcrModo: "completo",
  ocrSegundaPresupuestoMs: null,
  probeBudgetMs: 12_000,
} as const;

const KNOBS_OCR_POR_TIER: Record<
  Tier,
  {
    ocrReOcrModo: "completo" | "roi-cabecera";
    ocrSegundaPresupuestoMs: number | null;
    probeBudgetMs: number;
  }
> = {
  BAJO: { ocrReOcrModo: "roi-cabecera", ocrSegundaPresupuestoMs: 15_000, probeBudgetMs: 6_000 },
  MEDIO: { ocrReOcrModo: "completo", ocrSegundaPresupuestoMs: null, probeBudgetMs: 12_000 },
  ALTO: { ocrReOcrModo: "completo", ocrSegundaPresupuestoMs: null, probeBudgetMs: 12_000 },
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
  /** KIT e14-gama-baja-20s-v1 — modo del 2.º intento OCR cuando la 1.ª
   *  pasada sale débil (ver KNOBS_OCR_POR_TIER). BAJO: "roi-cabecera";
   *  resto/histórico: "completo". */
  ocrReOcrModo: "completo" | "roi-cabecera";
  /** Tope pared del pipeline para PERMITIR el intento extra (ms) —
   *  null = sin tope adicional (mandan los presupuestos existentes). */
  ocrSegundaPresupuestoMs: number | null;
  /** Presupuesto del sondeo de orientación (ms) — default 12000. */
  probeBudgetMs: number;
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
        ...KNOBS_OCR_HISTORICO,
      };
    }
    // 1 · override MANUAL del dueño — manda sobre el plan (D6). El override
    // existe para ocrHilos; los knobs OCR nuevos siguen siendo por-tier
    // (solo el kill-switch `adaptacionDispositivo: false` los revierte).
    const overrideHilos = leerOverridesFlags().ocrThreadsTope;
    if (typeof overrideHilos === "number") {
      return {
        adaptado: true,
        tier: tierRap.tier,
        tierInferido: tierRap.tierInferido,
        ocrHilos: hilosOk ? Math.min(overrideHilos, nucleos) : 1,
        ocrHilosFuente: "override-manual",
        hilosWasmDisponibles: hilosOk,
        ...KNOBS_OCR_POR_TIER[tierRap.tier],
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
      ...KNOBS_OCR_POR_TIER[tierRap.tier],
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
      ...KNOBS_OCR_HISTORICO,
    };
  }
}

/** Helper del consumidor (rapidocr.ts) — resuelve numThreads con las MISMAS
 *  condiciones de siempre (SAB + crossOriginIsolated → 1 hilo sin ellas). */
export function numThreadsOcrEfectivos(): number {
  const plan = planAdaptativo();
  return plan.hilosWasmDisponibles ? plan.ocrHilos : 1;
}
