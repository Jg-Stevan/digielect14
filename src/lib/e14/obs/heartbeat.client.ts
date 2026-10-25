/**
 * KIT e14-obs-hang-atribucion-v1 (§C.4, T3) — CLIENTE del sensor de hang
 * EN CURSO (heartbeat → worker + WAL).
 *
 * Singleton IDEMPOTENTE arrancado junto a iniciarDetectorHang (page.tsx).
 *  · Kill-switch del dueño (§D): `hangEnCurso: false` → SIN drenaje, SIN
 *    worker, SIN beats, SIN listeners — comportamiento observable IDÉNTICO
 *    a b688fbc (byte-idéntico, §1).
 *  · Feature-detect (§C.1): sin Worker o sin indexedDB → sensor off,
 *    degradación honesta, cero throw (doctrina del conservador).
 *  · DRENAJE ANTES de crear el worker (§C.4): si la sesión ANTERIOR murió
 *    COLGADA, su marca sobrevivió en `e14-hang-wal` — se emite el evento
 *    hang `fuente:"hang-en-curso"` sellado con la sesión NUEVA que la
 *    descubre (la identidad del ORIGEN viaja DENTRO de datos como
 *    `sesionOrigen`/`appVersionOrigen`); `duracionMs = umbralMs` = mínimo
 *    demostrable (§1 — jamás inventar). Lápida → borrar y callar.
 *  · Beats cada 500 ms (structured clone de 1 número — barato),
 *    `visibilitychange` → visibilidad del momento, `pagehide` → apagado
 *    (lápida — bfcache incluido, sin falsos positivos).
 *
 * EMISIÓN (§C.1 — resultado del smoke): este worker NO se deja al bundler
 * de la app — se PRECOMPILA con `bun scripts/build-heartbeat-worker.mjs`
 * a `public/scanner/heartbeat.worker.js` (IIFE clásica — precedentes:
 * detection-worker.js de scanner-core · sondeo-qr.worker.js del FIX
 * DICTAMEN-e73) y se instancia por URL absoluta. El smoke §C.1
 * re-confirmó la lección e73: Turbopack emitió el .ts CRUDO como asset
 * estático (verde falso — el navegador jamás lo ejecutaría). El smoke
 * REAL del gate (smoke-heartbeat-worker.mjs) bloquea ese regression.
 *
 * PRIVACIDAD dura (qa-obs-privacidad): cero `console.`, cero
 * `localStorage.setItem`, jamás blob/File/dataURL/contenido de actas.
 */
import { appendEvento } from "./buffer";
import { appVersion, idDispositivo, idSesion } from "./identidad";
import { leerFlags } from "../flags";
import {
  eventoDeMarca,
  HANG_EN_CURSO_UMBRAL_MS,
  leerYLimpiar,
} from "./heartbeat-wal";

/** Cadencia del beat del main (§C.4 — el worker tiene su propio tick de
 *  500 ms: si el main cuelga, SU interval muere; el del worker no). */
export const BEAT_MS = 500;

/** Base pública de assets — MISMO patrón del repo (flags.ts /
 *  sondeo-qr.client.ts): el worker precompilado se sirve desde public/.
 */
const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

let iniciado = false;

/** Drena el WAL del arranque (§C.4 — ANTES de crear el worker). Silencioso
 *  de punta a punta: el drenaje es observabilidad, jamás bloquea el arranque. */
async function drenarWal(): Promise<void> {
  try {
    const drenaje = await leerYLimpiar();
    if (!drenaje) return; // WAL vacío/ilegible — nada honesto que emitir
    if ("limpio" in drenaje) return; // lápida: desenlace limpio — callar
    await appendEvento({
      tipo: "hang",
      ts: Date.now(),
      sesion: idSesion(), // la sesión NUEVA que DESCUBRE la marca
      dispositivo: idDispositivo(),
      appVersion: appVersion(),
      datos: eventoDeMarca(drenaje.marca, Date.now()),
    });
  } catch {
    /* silencioso — el drenaje jamás lanza */
  }
}

/** Arranca el sensor COMPLETO (drenaje → worker → beats/listeners).
 *  IDEMPOTENTE (bootstrap de page.tsx, junto a iniciarDetectorHang) y
 *  SILENCIOSO: cualquier fallo deja la vía de HOY intacta. */
export function iniciarSensorHangEnCurso(): void {
  try {
    if (typeof window === "undefined") return;
    if (iniciado) return;
    iniciado = true;
    // Kill-switch del dueño (§D): OFF → byte-idéntico a b688fbc — la marca
    // sobreviviente NO se drena (el dueño eligió apagar el sensor completo).
    if (!leerFlags().hangEnCurso) return;
    // Feature-detect (§C.1) — ambos lados: sin soporte, sensor off honesto.
    if (typeof Worker === "undefined" || typeof indexedDB === "undefined") return;
    // 1) Drenar el WAL del arranque ANTES de crear el worker (§C.4).
    void drenarWal();
    // 2) Worker + config (el propio config prueba liveness — §C.3).
    // PRECOMPILADO (§C.1 — evidencia en el comentario del encabezado):
    // Turbopack emite el .ts crudo como asset → patrón e73 (IIFE en public/).
    const worker = new Worker(`${PUBLIC_BASE}/scanner/heartbeat.worker.js`);
    worker.postMessage({
      tipo: "config",
      umbralMs: HANG_EN_CURSO_UMBRAL_MS,
      sesion: idSesion(),
      appVersion: appVersion(),
    });
    // 3) Beats del main (structured clone de 1 número — barato).
    const beat = (): void => {
      try {
        worker.postMessage({ tipo: "beat", ts: Date.now() });
      } catch {
        /* worker muerto — el hard-edge de la página lo cubre el pagehide */
      }
    };
    beat();
    window.setInterval(beat, BEAT_MS);
    // 4) Visibilidad del momento (el worker solo marca con página visible).
    const alVisibilidad = (): void => {
      try {
        worker.postMessage({
          tipo: "visibilidad",
          visible: document.visibilityState !== "hidden",
        });
      } catch {
        /* silencioso */
      }
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", alVisibilidad);
    }
    // 5) pagehide → lápida (desenlace limpio; bfcache incluido — sin falsos
    //    positivos: al restaurarse, los beats reanudan y el worker borra).
    const alPagehide = (): void => {
      try {
        worker.postMessage({ tipo: "apagado" });
      } catch {
        /* silencioso */
      }
    };
    window.addEventListener("pagehide", alPagehide);
  } catch {
    /* silencioso — la observabilidad jamás rompe la app (§2.4) */
  }
}
