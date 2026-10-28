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
 * KIT e14-aa-quickwins-bfcache-v1 (§A, T1) — FIX bfcache (desviación
 * D-104-2 del DICTAMEN-obs-hang-atribucion-v1 §4.2): tras un `pagehide`
 * el worker se AUTOCIERRA (`apagado` → `close()`) y el cliente no lo
 * recreaba → el sensor quedaba MUERTO por el resto de la vida de una
 * página restaurada de bfcache. Ahora `pageshow` con `persisted === true`
 * reconstruye la instancia. Semántica honesta «jamás inventar, jamás
 * doble-contar»:
 *  · El WAL del restore se CONSUME SIN EMITIR (`leerYLimpiar()`, resultado
 *    descartado): lápida (caso común) → callar es correcto; marca sin
 *    lápida (raro: worker murió a mitad de hang) → la página VIVE ahora
 *    (el restore lo prueba) → el drift de hang.ts YA contó ese hang
 *    completo al reanudar — emitirlo sería doble conteo con encuadre
 *    falso. ES LA ESPEJO del ARRANQUE: allí una marca sobreviviente =
 *    muerte colgada → SE EMITE; aquí la página está viva → se consume en
 *    silencio. La asimetría ES la semántica.
 *  · Kill-switch RE-chequeado en el restore: apagado a mitad de sesión →
 *    no se reconstruye nada (coherente con §D — la marca tampoco se drena).
 *  · El interval del beat vive en variable de MÓDULO y se limpia ANTES de
 *    crear la instancia nueva (hoy el interval viejo seguiría posteando a
 *    un worker cerrado — throw silencioso cada 500 ms). Los listeners se
 *    añaden UNA sola vez y postean a la variable de módulo del worker
 *    vivo (no al closure del primero).
 *  · `persisted === false` → carga normal: ya cubierta por el arranque,
 *    no toca NADA.
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

/** Contrato mínimo del worker que este cliente maneja (tests lo
 *  falsifican — patrón sondeo-qr.client.ts §A.5). */
export interface WorkerHeartbeat {
  postMessage(msg: MensajeHeartbeat): void;
  terminate(): void;
}

type MensajeHeartbeat =
  | { tipo: "config"; umbralMs: number; sesion: string; appVersion: string }
  | { tipo: "beat"; ts: number }
  | { tipo: "visibilidad"; visible: boolean }
  | { tipo: "apagado" };

/** Fábrica del worker — inyectable SOLO para tests (patrón exacto de
 *  sondeo-qr.client.ts:218). En producción es la única referencia
 *  `new Worker` de este módulo. */
type FabricaWorkerHeartbeat = () => WorkerHeartbeat | null;

/** Base pública de assets — MISMO patrón del repo (flags.ts /
 *  sondeo-qr.client.ts): el worker precompilado se sirve desde public/.
 */
const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function fabricaProduccion(): WorkerHeartbeat | null {
  return new Worker(
    `${PUBLIC_BASE}/scanner/heartbeat.worker.js`,
  ) as unknown as WorkerHeartbeat;
}

let fabrica: FabricaWorkerHeartbeat = fabricaProduccion;

/** Prueba interna (tests): reemplaza la fábrica del worker y RESET del
 *  singleton (idempotencia + instancia viva). `null` restaura la de
 *  producción. Jamás usar fuera de vitest. */
export function __setFabricaWorkerHeartbeatParaTest(
  f: FabricaWorkerHeartbeat | null,
): void {
  fabrica = f ?? fabricaProduccion;
  apagarInstancia();
  iniciado = false;
}

let iniciado = false;
/** Worker vivo de la instancia ACTUAL (variable de MÓDULO — los listeners
 *  postean a esta referencia, no al closure del primer arranque). */
let workerVivo: WorkerHeartbeat | null = null;
/** id del interval del beat de la instancia ACTUAL (§A.1.4 — se limpia
 *  ANTES de crear la nueva: sin acumulación de intervals). */
let intervalBeat: number | null = null;

/** Apaga la instancia viva (interval + worker) — silencioso de punta a
 *  punta: si el worker ya se autocerró (pagehide → apagado → close()), el
 *  terminate es no-op. */
function apagarInstancia(): void {
  if (intervalBeat !== null) {
    try {
      window.clearInterval(intervalBeat);
    } catch {
      /* silencioso */
    }
    intervalBeat = null;
  }
  try {
    workerVivo?.terminate();
  } catch {
    /* ya muerto — no-op */
  }
  workerVivo = null;
}

/** Construye la instancia COMPLETA (worker precompilado → config →
 *  [baseline de visibilidad] → beat inmediato → interval del main).
 *  Silencioso: si la fábrica no soporta workers, queda degradado sin
 *  interval ni listeners colgando de una instancia muerta. */
function crearInstancia(conBaselineVisibilidad: boolean): void {
  try {
    apagarInstancia();
    const worker = fabrica();
    if (!worker) return; // sin soporte — degradación honesta (§C.1)
    workerVivo = worker;
    workerVivo.postMessage({
      tipo: "config",
      umbralMs: HANG_EN_CURSO_UMBRAL_MS,
      sesion: idSesion(),
      appVersion: appVersion(),
    });
    if (conBaselineVisibilidad) {
      // Restore (§A.1.3): el worker nuevo arranca visible:true por defecto
      // y una restauración puede ser a pestaña en SEGUNDO plano — la
      // visibilidad del momento viaja AHORA (el worker solo marca visible).
      workerVivo.postMessage({
        tipo: "visibilidad",
        visible: document.visibilityState !== "hidden",
      });
    }
    // Beats del main (structured clone de 1 número — barato). La closure
    // lee la variable de MÓDULO: sobrevive a los reemplazos de instancia.
    workerVivo.postMessage({ tipo: "beat", ts: Date.now() });
    intervalBeat = window.setInterval(() => {
      try {
        workerVivo?.postMessage({ tipo: "beat", ts: Date.now() });
      } catch {
        /* worker muerto — el pagehide/restauración lo cubre */
      }
    }, BEAT_MS);
  } catch {
    /* silencioso — el sensor jamás rompe el arranque ni el restore */
  }
}

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

/** KIT e14-aa-quickwins-bfcache-v1 (§A.1) — RESTORE de bfcache. La semántica
 *  completa vive documentada en el encabezado del archivo: kill-switch
 *  re-chequeado → WAL consumido SIN EMITIR (espejo invertido del arranque)
 *  → instancia reconstruida (baseline de visibilidad + beat inmediato). */
function alPageshow(ev: PageTransitionEvent): void {
  try {
    if (!ev.persisted) return; // carga normal — el arranque ya cubrió (§A.1.5)
    // Kill-switch re-chequeado (§A.1.1 — coherente con §D del kit 104:
    // apagado a mitad de sesión → sin reconstrucción y SIN drenaje).
    if (!leerFlags().hangEnCurso) return;
    // Feature-detect honesta: sin indexedDB el consumir-WAL no aplicaría y
    // sin Worker no hay nada que reconstruir (la instancia vieja tampoco
    // pudo existir) — sensor off, cero throw.
    if (typeof Worker === "undefined" || typeof indexedDB === "undefined") return;
    // WAL del restore CONSUMIDO SIN EMITIR (§A.1.2 — jamás doble conteo
    // con el drift de hang.ts; ver encabezado).
    void leerYLimpiar();
    // Worker RECONSTRUIDO (§A.1.3/§A.1.4): terminate del viejo (no-op si ya
    // se autocerró), interval viejo limpio ANTES del nuevo, config, baseline
    // de visibilidad del momento y beat inmediato.
    crearInstancia(true);
  } catch {
    /* silencioso — el restore jamás lanza ni bloquea (doctrina del conservador) */
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
    // 2) Worker + config + beat inmediato + interval (el propio config
    //    prueba liveness — §C.3). PRECOMPILADO (§C.1 — evidencia en el
    //    encabezado): sin baseline de visibilidad (semántica de ARRANQUE
    //    original intacta — el visibilidad real llega por el listener).
    crearInstancia(false);
    // 3) Visibilidad del momento (el worker solo marca con página visible).
    //    Postea a la variable de MÓDULO (§A.1.4 — sobrevive a restores).
    const alVisibilidad = (): void => {
      try {
        workerVivo?.postMessage({
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
    // 4) pagehide → lápida (desenlace limpio; bfcache incluido — sin falsos
    //    positivos: al restaurarse, los beats reanudan y el worker borra).
    const alPagehide = (): void => {
      try {
        workerVivo?.postMessage({ tipo: "apagado" });
      } catch {
        /* silencioso */
      }
    };
    window.addEventListener("pagehide", alPagehide);
    // 5) KIT e14-aa-quickwins-bfcache-v1 (§A) — restore de bfcache
    //    reconstruye el sensor (el worker autocerrado dejaba el sensor
    //    MUERTO en la página restaurada — desviación D-104-2).
    window.addEventListener("pageshow", alPageshow);
  } catch {
    /* silencioso — la observabilidad jamás rompe la app (§2.4) */
  }
}
