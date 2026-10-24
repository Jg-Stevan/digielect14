/**
 * ANEXO AGENTE C — REPARTE-3-AGENTES-v1 (Pieza 2) — detector de hang
 * (congelones del main thread). El probe + OCR bloquean la UI: si el
 * navegador se congela, hoy el diagnóstico NO se entera (un bloqueo de 30 s+
 * no emite eventos). Dos sensores complementarios, SOLO DURACIONES
 * (privacidad dura — qa-obs-privacidad: jamás contenido de actas):
 *
 * · longtask: PerformanceObserver('longtask') — cada task > 50 ms (umbral del
 *   estándar) se registra como evento hang {fuente:"longtask", duracionMs}.
 * · drift: setInterval de 500 ms — si el gap entre el tick esperado y el real
 *   es > 3 s hubo congelón: se captura el GAP REAL como duración (kit §2.2).
 *
 * Patrón del módulo (dispositivo.ts): iniciar* IDEMPOTENTE, TODO try/catch
 * silencioso (el rastreo JAMÁS lanza), cero costo tras detener. Los eventos
 * van al buffer obs (appendEvento tipo "hang" — TipoEvento extendido AL
 * FINAL) y la agregación por sesión la calcula resumenHangsDe (PURO,
 * testable — la consume export.ts para ReporteSesion.hangResumen).
 */
import { appendEvento } from "./buffer";
import { obtenerBreadcrumbs } from "./breadcrumbs";
import { appVersion, idDispositivo, idSesion } from "./identidad";
import type { EventoObs, HangEvento } from "./tipos";

/** Tick del sensor drift (kit: setInterval de 500 ms). */
export const DRIFT_TICK_MS = 500;
/** Gap del drift que cuenta como congelón (kit: > 3 s). */
export const DRIFT_UMBRAL_MS = 3000;
/** Umbral del estándar longtask (todo task > 50 ms se registra). */
export const LONGTASK_UMBRAL_MS = 50;

let observer: PerformanceObserver | null = null;
let timerDrift: number | null = null;
let proximoTick = 0;
let alVisibilidad: (() => void) | null = null;

/** §G.4 — el estado de visibilidad al momento de la detección (AL FINAL del
 *  HangEvento — D57). En node/SSR sin document → visible (no hay SO que
 *  congele timers — jamás inventar ocultos). */
function visibleAhora(): boolean {
  try {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

/** Emite el evento hang al buffer obs (con el contexto de breadcrumbs del
 *  momento). Todo silencioso: el rastreo jamás rompe la app. */
async function emitirHang(h: HangEvento): Promise<void> {
  try {
    await appendEvento({
      tipo: "hang",
      ts: Date.now(),
      sesion: idSesion(),
      dispositivo: idDispositivo(),
      appVersion: appVersion(),
      datos: h,
    });
  } catch {
    /* silencioso — el rastreo jamás lanza */
  }
}

/** Sensor drift: gap entre el tick esperado y el real (Date.now()). Con el
 *  hilo congelado F ms, el tick atrasa ≈ F — el GAP REAL es la duración.
 *  §G.4 — ORDEN-WAVE3-add-envio-individual-v1: si el documento está OCULTO
 *  (cel bloqueado / app en background), el SO congela los timers del
 *  intervalo y TODO el tiempo en background entraría como «congelón»
 *  (fantasma REAL del informe 1230: 117 s de pantalla bloqueada → el mayor
 *  hang de la sesión). En hidden: re-sincronizar proximoTick y NO emitir —
 *  el gap no es congelón. Solo longtasks reales, etiquetados. */
function tickDrift(): void {
  try {
    const ahora = Date.now();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      proximoTick = ahora + DRIFT_TICK_MS; // re-sincroniza — sin emisión
      return;
    }
    const gap = ahora - proximoTick;
    proximoTick = ahora + DRIFT_TICK_MS;
    if (gap > DRIFT_UMBRAL_MS) {
      void emitirHang({
        fuente: "drift",
        duracionMs: gap,
        umbralMs: DRIFT_UMBRAL_MS,
        breadcrumbs: obtenerBreadcrumbs(),
        visible: visibleAhora(),
      });
    }
  } catch {
    /* silencioso */
  }
}

/** Sensor longtask: PerformanceObserver con entryTypes ['longtask'] — cada
 *  task > LONGTASK_UMBRAL_MS se registra con su duración (solo número y
 *  momento — jamás contenido). Sin PerformanceObserver (navegador viejo /
 *  node) → sin sensor (honesto, jamás lanza). */
function iniciarLongtask(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const obs = new PerformanceObserver((lista) => {
      try {
        for (const entrada of lista.getEntries()) {
          if (entrada.duration > LONGTASK_UMBRAL_MS) {
            void emitirHang({
              fuente: "longtask",
              duracionMs: Math.round(entrada.duration),
              umbralMs: LONGTASK_UMBRAL_MS,
              breadcrumbs: obtenerBreadcrumbs(),
              visible: visibleAhora(),
            });
          }
        }
      } catch {
        /* silencioso */
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
    observer = obs;
  } catch {
    observer = null; // entryTypes no soportado → solo drift
  }
}

/** Arranca los 2 sensores. IDEMPOTENTE (llamado desde el bootstrap de
 *  page.tsx junto a los demás iniciar*). Cero costo en node/SSR.
 *  §G.4 — escucha `visibilitychange`: al VOLVER a "visible" re-sincroniza
 *  proximoTick — sin esto el PRIMER tick post-resume seguiría fantasma
 *  (el gap que cruzó el background entraría como congelón). */
export function iniciarDetectorHang(): void {
  try {
    if (typeof window === "undefined") return;
    if (timerDrift !== null || observer !== null) return; // idempotente
    iniciarLongtask();
    proximoTick = Date.now() + DRIFT_TICK_MS;
    timerDrift = window.setInterval(tickDrift, DRIFT_TICK_MS);
    alVisibilidad = () => {
      try {
        if (document.visibilityState === "visible") {
          proximoTick = Date.now() + DRIFT_TICK_MS; // descarta el gap del background
        }
      } catch {
        /* silencioso */
      }
    };
    // Guard SSR/node (mismo criterio del módulo — el listener es browser-only;
    // los stubs de window SIN document — hang.test — no rompen el armado):
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", alVisibilidad);
    }
  } catch {
    /* silencioso */
  }
}

/** Apaga los sensores (el finally del runner no lo llama — el detector vive
 *  toda la sesión, patrón breadcrumbs; expuesto para simetría/tests). */
export function detenerDetectorHang(): void {
  try {
    if (timerDrift !== null) {
      clearTimeout(timerDrift as unknown as ReturnType<typeof setTimeout>);
      timerDrift = null;
    }
    if (alVisibilidad !== null && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", alVisibilidad);
    }
    alVisibilidad = null;
    observer?.disconnect();
    observer = null;
  } catch {
    /* silencioso */
  }
}

/** Agregación por sesión (kit §2.3) — PURA y testable: sobre los eventos
 *  "hang" del buffer (ya filtrados por el caller — export.ts lee con el
 *  filtro de tipo y de sesión) cuenta hangs, mayor hang y total congelado.
 *  §G.4 — ORDEN-WAVE3-add-envio-individual-v1: cuenta/mayor/total SOLO
 *  sobre eventos VISIBLES (los ocultos — timers congelados por el SO en
 *  background — NO son congelones) y van a cuentaOcultas. Legacy sin el
 *  campo `visible` → tratado visible (`?? true` — jamás recontar).
 *  Sin hangs → {cuenta:0, mayorMs:null, totalMs:null, cuentaOcultas:0}. */
export function resumenHangsDe(
  eventos: Pick<EventoObs, "tipo" | "datos">[],
): { cuenta: number; mayorMs: number | null; totalMs: number | null; cuentaOcultas: number } {
  const hangs = eventos.filter((e) => e.tipo === "hang");
  const duraciones = hangs
    .filter((e) => (e.datos as HangEvento).visible ?? true)
    .map((e) => (e.datos as HangEvento).duracionMs)
    .filter((v): v is number => typeof v === "number");
  const ocultas = hangs.filter((e) => !((e.datos as HangEvento).visible ?? true)).length;
  return {
    cuenta: duraciones.length,
    mayorMs: duraciones.length ? Math.max(...duraciones) : null,
    totalMs: duraciones.length
      ? duraciones.reduce((a, b) => a + b, 0)
      : null,
    cuentaOcultas: ocultas,
  };
}

/** Prueba interna (tests): reset del estado del módulo. */
export function __resetHangParaTest(): void {
  detenerDetectorHang();
  proximoTick = 0;
}
