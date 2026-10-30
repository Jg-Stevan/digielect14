/**
 * KIT e14-ocr-tessbest-v1 (GO-B otorgado por el dueño 2026-11 — «dejemos
 * como primer motor de OCR tess best y escalonado a pp ocr») — motor
 * TESSERACT BEST (tesseract.js 5 · spa traineddata 4.0.0_best · OEM
 * LSTM_ONLY — tessdata_best es LSTM-only) como INTENTO 1 de la cascada
 * `ocr-cascada.ts`.
 *
 * KIT e14-ocr-psm4-port-v1 — PUERTO DE VELOCIDAD desde supervision-e14
 * @ a249518 («tesseract-spa-best-v1», el commit con los mejores tiempos
 * medidos por el dueño): (1) PSM 4 SINGLE_COLUMN vía setParameters — la
 * config EXACTA del benchmark (94,4 % dígitos · 2,2 s/pág · RAM ~67 MB);
 * (2) corePath DIRECTORIO + core lstm no-SIMD vendido (paridad de assets
 * con el repo origen). La cascada, presupuestos, GATE y kill-switch
 * quedan INTACTOS — solo cambia cómo reconoce el intento 1.
 *
 * Contrato (hereda las reglas del brief K3 + REPORTE-sim-gama-baja-v2):
 *  · VENDIDO a public/ — jamás CDN en producción (PWA offline; mismo
 *    patrón que vendor/onnxruntime y vendor/opencv):
 *      /vendor/tesseract/worker.min.js            (~124 KB, de la lib)
 *      /vendor/tesseract/tesseract-core-simd-lstm.{wasm.js,wasm}  (~6.8 MB)
 *      /models/tess/spa.traineddata.gz            (~12 MB, tessdata_best)
 *  · WORKER PROPIO de la lib (JAMÁS main thread) — el hilo principal solo
 *    espera la promesa (cero riesgo «página no responde»).
 *  · PRESUPUESTO PROPIO (bench tools/bench-ocr-cascada: default 60 000 ms,
 *    capado por el caller al presupuesto restante del pipeline): vencido o
 *    roto ⇒ TERMINA el worker y LANZA → el bridge cae a RapidOCR 1280 de
 *    siempre («escalonado a pp ocr», byte a byte — jamás tumba el pipeline).
 *  · Su texto SOLO vale por el GATE (clasificador): JAMÁS entra a
 *    `elegirMejor` (conf entre motores no es comparable — brief K3 §1).
 *  · LAZY: no descarga nada hasta la primera cascada (el SW cachea
 *    /models/tess + /vendor/tesseract en MOTOR_CACHE al primer uso).
 *
 * PURO de DOM salvo import dinámico de tesseract.js (chunk aparte — el
 * bundle principal ni lo toca). Sin logger propio: el resultado lo narra
 * el bridge (traza D51 ampliada).
 */

const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Presupuesto de UNA recognize Tesseract (dato del bench
 *  tools/bench-ocr-cascada §B — «budget Tesseract default 60 000 ms»). */
const TESS_RECONOCER_PRESUPUESTO_MS = 60_000;

/** Presupuesto de la CREACIÓN del worker — la 1.ª vez descarga la lib
 *  vendida (~19 MB: spa best 12 MB + core simd-lstm 6.9 MB) que a 3G real
 *  tarda ~95-120 s (evidencia sim-lowend-v4: 60 s NO alcanzan y la cascada
 *  caía a RapidOCR en la 1.ª corrida). El SW cachea /models/tess +
 *  /vendor/tesseract en MOTOR_CACHE ⇒ creations siguientes tardan s.
 *  Capado SIEMPRE por el presupuesto restante del pipeline (caller). */
const TESS_CREACION_PRESUPUESTO_MS = 180_000;

/** Menor presupuesto con el que VALE la pena intentar (menos que esto la
 *  recognize ni arranca — falla segura inmediata → RapidOCR de siempre). */
const TESS_RECONOCER_MIN_MS = 20_000;

/** Estructura mínima del resultado tesseract.js v5 (tipos estructurales —
 *  el paquete viaja por import dinámico y el bundle no lo toca). */
interface TessSalida {
  data: { text: string; confidence: number };
}
interface TessWorkerMin {
  recognize(image: string): Promise<TessSalida>;
  terminate(): Promise<unknown>;
  setParameters(params: Record<string, string>): Promise<unknown>;
}

/** Worker singleton (1 recognize a la vez — la cascada es secuencial). */
let workerProm: Promise<TessWorkerMin> | null = null;

function crearWorker(): Promise<TessWorkerMin> {
  return import("tesseract.js").then(({ createWorker, PSM }) =>
    // OEM 1 = LSTM_ONLY (obligatorio: tessdata_best SOLO trae LSTM).
    // Vendidos same-origin (basePath incluido) — sin red externa.
    createWorker("spa", 1, {
      workerPath: `${PUBLIC_BASE}/vendor/tesseract/worker.min.js`,
      // KIT e14-ocr-psm4-port-v1 — DIRECTORIO (no archivo fijo): la lib
      // elige simd-lstm o lstm según la sonda SIMD del dispositivo (ambos
      // vendidos — paridad con supervision-e14 a249518; antes solo simd ⇒
      // en no-SIMD el intento 1 fallaba SIEMPRE y la cascada caía al
      // escalonado completo = el camino lento en exactamente gama baja).
      corePath: `${PUBLIC_BASE}/vendor/tesseract`,
      langPath: `${PUBLIC_BASE}/models/tess`,
      gzip: true,
      logger: () => {}, // silencio — cero ruido de consola en producción
    } as Parameters<typeof createWorker>[2])
      .then(async (w) => {
        // KIT e14-ocr-psm4-port-v1 — PSM 4 (SINGLE_COLUMN): la config EXACTA
        // del benchmark con los mejores tiempos (spa-best + psm 4: 94,4 %
        // dígitos impresos · 2,2 s/pág · RAM pico ~67 MB — results/
        // metrics.json, supervision-e14 @ a249518 «tesseract-spa-best-v1»).
        // Sin esto el intento 1 corre PSM 3 (default) — el bench: psm 3/6
        // cayeron menos dígitos ⇒ menor tasa de gate-AUTO ⇒ más actas pagando
        // el escalonado completo (1280→1920+ROI). Misma línea de
        // tesseract-ocr.ts del repo origen: setParameters tras crear worker.
        await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
        return w;
      }),
  ) as Promise<TessWorkerMin>;
}

/** Termina el worker (vencido/roto) — el próximo intento crea uno fresco. */
async function matarWorker(): Promise<void> {
  const w = workerProm;
  workerProm = null;
  try {
    const vivo = await w;
    await vivo?.terminate();
  } catch {
    /* ya muerto — nada que hacer */
  }
}

/** KIT e14-ocr-tessbest-v1 — PRECALENTAMIENTO (fire-and-forget): arranca la
 *  creación del worker (descarga vendida la 1.ª vez — el SW la cachea)
 *  SIN presupuesto: al abrir el visor de cámara el operador tarda ≥10 s en
 *  encuadrar ⇒ la 1.ª captura ya encuentra assets calientes o en camino.
 *  Idempotente + jamás lanza + silencioso (el fallo lo narra la cascada). */
export function tessPrecalentar(): void {
  try {
    if (typeof window === "undefined" || workerProm !== null) return;
    workerProm = crearWorker();
    void workerProm.catch(() => {
      // fallo de descarga/creación: libera el singleton — la 1.ª cascada
      // lo reintenta con presupuesto propio (y cae a RapidOCR si vuelve a
      // fallar). Jamás deja un workerProm rechazado envenenado.
      workerProm = null;
    });
  } catch {
    /* silencioso — el precalentamiento jamás tumba nada */
  }
}

function carreraConPresupuesto<T>(
  tarea: Promise<T>,
  ms: number,
  alVencer: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const vencimiento = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(alVencer()), ms);
  });
  return Promise.race([tarea, vencimiento]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/**
 * Reconocer `dataUrl` con Tess best. Devuelve texto + conf NORMALIZADA a
 * 0-1 (tesseract.js reporta 0-100 — la traza D51 vive en escala 0-1).
 * Lanza en: SSR, lib ausente, worker roto o presupuesto vencido (y en ese
 * caso el worker queda terminado — recreable). JAMÁS bloquea el main
 * thread: el recognize corre en el worker de la lib.
 */
export async function tessReconocer(
  dataUrl: string,
  presupuestoMs: number = TESS_RECONOCER_PRESUPUESTO_MS,
): Promise<{ texto: string; conf: number }> {
  if (typeof window === "undefined") {
    throw new Error("tess-best: sin window (SSR) — cascada cae a RapidOCR");
  }
  if (!(presupuestoMs >= TESS_RECONOCER_MIN_MS) || typeof dataUrl !== "string" || dataUrl.length === 0) {
    throw new Error(
      `tess-best: presupuesto insuficiente (${Math.round(presupuestoMs)} ms < ${TESS_RECONOCER_MIN_MS}) — cascada cae a RapidOCR`,
    );
  }
  const t0 = performance.now();
  try {
    if (workerProm === null) workerProm = crearWorker();
    // CREACIÓN: la 1.ª vez descarga ~19 MB vendidos (3G ≈ 95-120 s) ⇒
    // presupuesto PROPIO de 180 s, SIEMPRE capado por el del pipeline.
    const msCreacion = Math.min(presupuestoMs, TESS_CREACION_PRESUPUESTO_MS);
    const w = await carreraConPresupuesto(workerProm, msCreacion, () => {
      void matarWorker();
      return new Error(`tess-best: creación de worker vencida (${msCreacion} ms)`);
    });
    const restante = presupuestoMs - (performance.now() - t0);
    if (restante <= 0) throw new Error("tess-best: sin presupuesto restante para recognize");
    // RECOGNIZE: presupuesto del bench (60 s) capado por el restante real.
    const msRec = Math.min(restante, TESS_RECONOCER_PRESUPUESTO_MS);
    const r = await carreraConPresupuesto(w.recognize(dataUrl), msRec, () => {
      void matarWorker();
      return new Error(`tess-best: presupuesto vencido (${msRec} ms)`);
    });
    const texto = typeof r?.data?.text === "string" ? r.data.text.replace(/\s+$/, "") : "";
    const conf = Math.max(0, Math.min(1, (r?.data?.confidence ?? 0) / 100));
    if (texto.length === 0) throw new Error("tess-best: recognize sin texto");
    return { texto, conf };
  } catch (e) {
    // Vencido/roto ⇒ worker terminado (matarWorker ya corrió dentro de la
    // carrera; por si el fallo vino antes, idempotente) y el error SUBE —
    // el caller (bridge) cae a RapidOCR 1280 de siempre.
    await matarWorker();
    throw e instanceof Error ? e : new Error(String(e));
  }
}
