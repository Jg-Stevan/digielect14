/// <reference lib="webworker" />
/**
 * KIT e14-obs-hang-atribucion-v1 (§C.3, T3) — WORKER del heartbeat.
 *
 * Protocolo UNIDIRECCIONAL (el main colgado no puede escuchar): el main
 * late; este worker vigila. Si los beats se detienen ≥ umbral con página
 * VISIBLE, escribe la MARCA en el WAL propio (`e14-hang-wal` — §C.2);
 * cuando los beats vuelven, la BORRA (el drift ya contó ese hang); con
 * `apagado` (pagehide limpio) escribe la LÁPIDA y se apaga. La marca que
 * sobrevive a una muerte COLGADA la drena el próximo arranque (§C.4) —
 * cierre del punto ciego estructural.
 *
 * STANDALONE: su ÚNICO import del repo es el núcleo PURO + IDB de
 * heartbeat-wal.ts (sin window/localStorage/DOM — el CONTEXTO completo
 * llega por mensajes: `sesion`/`appVersion` viajan en `config`, jamás
 * importa identidad/flags/buffer). Solo timestamps, números e ids —
 * privacidad dura (qa-obs-privacidad). Todo try/catch silencioso.
 *
 * Interval PROPIO de 500 ms (independiente del beat del main — si el main
 * cuelga, su setInterval muere; el de este hilo sigue vivo).
 */

import {
  borrarMarcaActiva,
  debeDesmarcar,
  debeMarcar,
  escribirLapida,
  escribirMarca,
  HANG_EN_CURSO_UMBRAL_MS,
} from "./heartbeat-wal";

/** Tick propio del worker (C.3 — el guardián late aunque el main no). */
const TICK_MS = 500;

type Mensaje =
  | { tipo: "config"; umbralMs: number; sesion: string; appVersion: string }
  | { tipo: "beat"; ts: number }
  | { tipo: "visibilidad"; visible: boolean }
  | { tipo: "apagado" };

let umbralMs = HANG_EN_CURSO_UMBRAL_MS;
let sesion = "";
let appVersion = "";
let ultimoBeatTs = 0; // 0 = sin beats aún (el tick no decide hasta el 1.º/config)
let visible = true;
let yaMarcada = false;
let timer: ReturnType<typeof setInterval> | null = null;

function detenerInterval(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function tick(): void {
  try {
    if (ultimoBeatTs <= 0) return; // sin línea de base — jamás inventar silencio
    const ahora = Date.now();
    const msDesdeBeat = ahora - ultimoBeatTs;
    if (debeDesmarcar({ msDesdeBeat, umbralMs, yaMarcada })) {
      yaMarcada = false; // el main reanudó — el drift ya contó el hang completo
      void borrarMarcaActiva();
      return;
    }
    if (debeMarcar({ msDesdeBeat, visible, yaMarcada, umbralMs })) {
      yaMarcada = true;
      void escribirMarca({
        id: "activo",
        inicio: ultimoBeatTs,
        detectadoEn: ahora,
        umbralMs,
        visible,
        sesion,
        appVersion,
      });
    }
  } catch {
    /* silencioso — el guardián jamás lanza */
  }
}

function apagar(): void {
  // Lápida best-effort: el interval se detiene CUANDO la escritura resuelve
  // (un close() prematuro podría matar la tx de IDB en vuelo).
  void escribirLapida()
    .catch(() => false)
    .then(() => {
      detenerInterval();
      try {
        (self as unknown as { close: () => void }).close();
      } catch {
        /* silencioso */
      }
    });
}

if (typeof window === "undefined" && typeof self !== "undefined") {
  (self as unknown as DedicatedWorkerGlobalScope).onmessage = (
    ev: MessageEvent<Mensaje>,
  ) => {
    try {
      const m = ev.data;
      if (!m || typeof m !== "object") return;
      if (m.tipo === "config") {
        umbralMs =
          typeof m.umbralMs === "number" && m.umbralMs > 0
            ? m.umbralMs
            : HANG_EN_CURSO_UMBRAL_MS;
        sesion = typeof m.sesion === "string" ? m.sesion : "";
        appVersion = typeof m.appVersion === "string" ? m.appVersion : "";
        // El propio `config` prueba liveness del main: línea de base.
        if (ultimoBeatTs <= 0) ultimoBeatTs = Date.now();
        if (timer === null) timer = setInterval(tick, TICK_MS);
        return;
      }
      if (m.tipo === "beat") {
        if (typeof m.ts === "number" && m.ts > 0) ultimoBeatTs = m.ts;
        return;
      }
      if (m.tipo === "visibilidad") {
        visible = m.visible === true;
        return;
      }
      if (m.tipo === "apagado") {
        apagar();
      }
    } catch {
      /* silencioso — el guardián jamás lanza */
    }
  };
}
