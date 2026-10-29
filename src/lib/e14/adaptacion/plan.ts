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
 *
 *  NOTA del merge con e14-ocr-tessbest-v1 (PR #118): el 3.er knob del kit
 *  original (probeBudgetMs BAJO 6000 fail-fast) quedó SUBSUMIDO por
 *  PROBE_ORIENTACION_POR_TIER de main — la evidencia sim-lowend v5/v6
 *  demostró que CORTAR el sondeo en gama baja (t0 compartido consumido por
 *  cargas de fondo) produce rotación débil → warp corta la cabecera →
 *  acta RECHAZADA que con sondeo completo era 10.0 ÓPTIMA. Gana el knob
 *  de main (probeOrientacionMs: BAJO 150 s · MEDIO 60 s · ALTO 12 s).
 *
 *  Prioridad D6 intacta: override MANUAL del dueño (ocrThreadsTope) manda
 *  sobre ocrHilos; los knobs nuevos NO tienen override (el kill-switch
 *  `adaptacionDispositivo: false` los revierte TODOS al histórico). */
const KNOBS_OCR_HISTORICO = {
  ocrReOcrModo: "completo",
  ocrSegundaPresupuestoMs: null,
} as const;

const KNOBS_OCR_POR_TIER: Record<
  Tier,
  {
    ocrReOcrModo: "completo" | "roi-cabecera";
    ocrSegundaPresupuestoMs: number | null;
  }
> = {
  BAJO: { ocrReOcrModo: "roi-cabecera", ocrSegundaPresupuestoMs: 15_000 },
  MEDIO: { ocrReOcrModo: "completo", ocrSegundaPresupuestoMs: null },
  ALTO: { ocrReOcrModo: "completo", ocrSegundaPresupuestoMs: null },
};


/** KIT e14-ocr-tessbest-v1 — Presupuesto del ESCANEO individual (timeout
 *  del pipeline) por tier. Evidencia (docs/REPORTE-sim-gama-baja-v2.md +
 *  sim-lowend-v3-resultados.json): en mono-hilo 6× el pipeline real
 *  necesita ~125 s y el timeout fijo de 120 s (e67) lo RECHAZABA con score
 *  0.0 justo antes de terminar (P0). ALTO = 120 s byte-idéntico al
 *  histórico; MEDIO/BAJO escalan (lección D48 del masiva: el presupuesto
 *  manda sobre el reloj de la máquina del dueño, no al revés). La UI nunca
 *  se congela: el pipeline corre en worker y el ANALIZANDO es event-driven
 *  (D18). Coherente con la cascada: vencido ⇒ no se abre ninguna etapa
 *  nueva (§3 del kit escalonado). */
const PRESUPUESTO_ESCANEO_POR_TIER: Record<Tier, number> = {
  BAJO: 480_000,
  MEDIO: 240_000,
  ALTO: 120_000,
};

/** Referencia histórica (e67) — default/ALTO y fallback seguro. */
export const PRESUPUESTO_ESCANEO_DEFAULT_MS = 120_000;

/** KIT e14-ocr-tessbest-v1 — presupuesto del PROBE de orientación por tier
 *  (histórico fijo 12 000 — D56 §3 T3, calibrado con det del probe a
 *  DET_CAP_RAPIDO en equipos del dueño: det ~1.2 s + rec0 ~3 s + rec90 ~3 s
 *  + rec270 ~3 s ≈ 10.2 s). Evidencia sim-lowend v5/v6 (mono-hilo 6× + 3G):
 *  el t0 COMPARTIDO se consume con cargas de fondo (descarga vendida de
 *  Tess, modelos en cola) ⇒ el sondeo queda cortado (cortes=presupuesto) sin
 *  evaluar challengers → rotación débil sin confirmar → el warp corta la
 *  cabecera (recortada=1 lado=sup) → cabeceraE14=false → RECHAZADA en un
 *  acta que con sondeo completo es 10.0 ÓPTIMA. BAJO cubre el probe completo
 *  con margen; ALTO = 12 s byte-idéntico. Kill-switch: adaptación OFF ⇒ 12 s. */
const PROBE_ORIENTACION_POR_TIER: Record<Tier, number> = {
  BAJO: 150_000,
  MEDIO: 60_000,
  ALTO: 12_000,
};

/** Referencia histórica (D56 §3 T3) — default/ALTO y fallback seguro. */
export const PROBE_ORIENTACION_DEFAULT_MS = 12_000;

/** KIT e14-ocr-tessbest-v1 — espera del warm-up del worker OpenCV en la
 *  DETECCIÓN (tope histórico 5 s — kit masiva-ux T1). Evidencia sim-lowend-v4:
 *  a CPU 6× el compile+warm wasm mono-hilo NO cabe en 5 s ⇒ la detección cae
 *  a fallback (quad peor → score 4.9 y cabecera dañada → ILEGIBLE en un acta
 *  que a 1× fue 10.0 ÓPTIMA). ALTO = 5 s byte-idéntico; BAJO/MEDIO escalan
 *  (el tope es una ESPERA pasiva — el worker avanza mientras tanto, jamás
 *  bloquea más de lo que tarda el warm-up real). Kill-switch: adaptación OFF
 *  ⇒ 5 s histórico exacto. */
const ESPERA_WORKER_POR_TIER: Record<Tier, number> = {
  BAJO: 20_000,
  MEDIO: 10_000,
  ALTO: 5_000,
};

/** Referencia histórica (masiva-ux T1) — default/ALTO y fallback seguro. */
export const ESPERA_WORKER_DEFAULT_MS = 5_000;

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
  /** KIT e14-ocr-tessbest-v1 — presupuesto del escaneo individual ya
   *  RESUELTO (override manual > plan por tier > default 120 s). */
  presupuestoEscaneoMs: number;
  /** De dónde salió presupuestoEscaneoMs (misma auditoría honesta). */
  presupuestoEscaneoFuente: "override-manual" | "plan-adaptativo" | "default";
  /** KIT e14-ocr-tessbest-v1 — espera del warm-up del worker OpenCV en la
   *  detección ya RESUELTA por tier (BAJO 20 s · MEDIO 10 s · ALTO 5 s). */
  esperaWorkerMs: number;
  /** KIT e14-ocr-tessbest-v1 — presupuesto del probe de orientación ya
   *  RESUELTO por tier (BAJO 150 s · MEDIO 60 s · ALTO 12 s). Subsume el
   *  probeBudgetMs (BAJO 6 s fail-fast) del kit e14-gama-baja-20s-v1: la
   *  evidencia sim-lowend v5/v6 mostró que cortar el sondeo produce actas
   *  RECHAZADAS, así que gana el presupuesto completo de main. */
  probeOrientacionMs: number;
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

/** Resuelve el presupuesto del escaneo con la MISMA prioridad del plan:
 *  override MANUAL del dueño (flag `presupuestoEscaneoMs`, clamp 30-900 s)
 *  > plan por tier > default 120 s. Jamás lanza. */
function resolverPresupuesto(tier: Tier): {
  ms: number;
  fuente: PlanAdaptativo["presupuestoEscaneoFuente"];
} {
  try {
    const override = leerOverridesFlags().presupuestoEscaneoMs;
    if (typeof override === "number" && Number.isFinite(override)) {
      return {
        ms: Math.max(30_000, Math.min(900_000, Math.round(override))),
        fuente: "override-manual",
      };
    }
  } catch {
    /* sin override legible → plan por tier */
  }
  return {
    ms: PRESUPUESTO_ESCANEO_POR_TIER[tier] ?? PRESUPUESTO_ESCANEO_DEFAULT_MS,
    fuente: "plan-adaptativo",
  };
}

/** Espera del warm-up del worker OpenCV por tier (sin flag propio — el
 *  kill-switch `adaptacionDispositivo` OFF ⇒ 5 s histórico exacto). */
function resolverEsperaWorker(tier: Tier): number {
  return ESPERA_WORKER_POR_TIER[tier] ?? ESPERA_WORKER_DEFAULT_MS;
}

/** Presupuesto del probe de orientación por tier (mismo criterio). */
function resolverProbeOrientacion(tier: Tier): number {
  return PROBE_ORIENTACION_POR_TIER[tier] ?? PROBE_ORIENTACION_DEFAULT_MS;
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
        presupuestoEscaneoMs: PRESUPUESTO_ESCANEO_DEFAULT_MS,
        presupuestoEscaneoFuente: "default",
        esperaWorkerMs: ESPERA_WORKER_DEFAULT_MS,
        probeOrientacionMs: PROBE_ORIENTACION_DEFAULT_MS,
      };
    }
    // 1 · override MANUAL del dueño — manda sobre el plan (D6). El override
    // existe para ocrHilos; los knobs OCR nuevos siguen siendo por-tier
    // (solo el kill-switch `adaptacionDispositivo: false` los revierte).
    const overrideHilos = leerOverridesFlags().ocrThreadsTope;
    if (typeof overrideHilos === "number") {
      const pres = resolverPresupuesto(tierRap.tier);
      return {
        adaptado: true,
        tier: tierRap.tier,
        tierInferido: tierRap.tierInferido,
        ocrHilos: hilosOk ? Math.min(overrideHilos, nucleos) : 1,
        ocrHilosFuente: "override-manual",
        hilosWasmDisponibles: hilosOk,
        ...KNOBS_OCR_POR_TIER[tierRap.tier],
        presupuestoEscaneoMs: pres.ms,
        presupuestoEscaneoFuente: pres.fuente,
        esperaWorkerMs: resolverEsperaWorker(tierRap.tier),
        probeOrientacionMs: resolverProbeOrientacion(tierRap.tier),
      };
    }
    // 2 · plan adaptativo por tier (capado por hardware real).
    const pres = resolverPresupuesto(tierRap.tier);
    return {
      adaptado: true,
      tier: tierRap.tier,
      tierInferido: tierRap.tierInferido,
      ocrHilos: hilosOk ? Math.min(HILOS_POR_TIER[tierRap.tier], nucleos) : 1,
      ocrHilosFuente: "plan-adaptativo",
      hilosWasmDisponibles: hilosOk,
      ...KNOBS_OCR_POR_TIER[tierRap.tier],
      presupuestoEscaneoMs: pres.ms,
      presupuestoEscaneoFuente: pres.fuente,
      esperaWorkerMs: resolverEsperaWorker(tierRap.tier),
      probeOrientacionMs: resolverProbeOrientacion(tierRap.tier),
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
      presupuestoEscaneoMs: PRESUPUESTO_ESCANEO_DEFAULT_MS,
      presupuestoEscaneoFuente: "default",
      esperaWorkerMs: ESPERA_WORKER_DEFAULT_MS,
      probeOrientacionMs: PROBE_ORIENTACION_DEFAULT_MS,
    };
  }
}

/** Helper del consumidor (rapidocr.ts) — resuelve numThreads con las MISMAS
 *  condiciones de siempre (SAB + crossOriginIsolated → 1 hilo sin ellas). */
export function numThreadsOcrEfectivos(): number {
  const plan = planAdaptativo();
  return plan.hilosWasmDisponibles ? plan.ocrHilos : 1;
}

/** Helper del consumidor (scanner-core-bridge) — presupuesto del ESCANEO
 *  individual ya resuelto (SYNC, barato, jamás lanza). Adaptación OFF o
 *  fallo ⇒ default histórico 120 s (byte-idéntico a e67). */
export function presupuestoEscaneoEfectivo(): number {
  try {
    return planAdaptativo().presupuestoEscaneoMs;
  } catch {
    return PRESUPUESTO_ESCANEO_DEFAULT_MS;
  }
}

/** Helper del consumidor (scanner-core-bridge) — espera del warm-up del
 *  worker OpenCV ya resuelta (SYNC, barato, jamás lanza). Adaptación OFF o
 *  fallo ⇒ 5 s histórico exacto (masiva-ux T1). */
export function esperaWorkerEfectiva(): number {
  try {
    return planAdaptativo().esperaWorkerMs;
  } catch {
    return ESPERA_WORKER_DEFAULT_MS;
  }
}

/** Helper del consumidor (orientacion.ts) — presupuesto del probe de
 *  orientación ya resuelto (SYNC, barato, jamás lanza). Adaptación OFF o
 *  fallo ⇒ 12 s histórico exacto (D56 §3 T3). */
export function presupuestoProbeOrientacionEfectivo(): number {
  try {
    return planAdaptativo().probeOrientacionMs;
  } catch {
    return PROBE_ORIENTACION_DEFAULT_MS;
  }
}
