/// <reference lib="webworker" />
/**
 * KIT e14-capa0-qr-worker-v1 — WORKER de la CAPA 0 IDENTIDAD QR.
 *
 * PORT a digielect14 del kit D40 de supervision-e14 (misma evolución R1.1
 * guard de presupuesto + R1.4-b fases/fin). El flujo INDIVIDUAL de cámara
 * solo corría el tier "base" del ladder en el hilo UI (techo ~0.5 s — la
 * cadena completa ~15-17 s SYNC congelaba la vista, D74); aquí corre
 * FUERA del hilo principal con presupuesto de VERDAD y la UI deja de
 * depender del QR pesado.
 *
 * Mensaje: `{id, blob, ladoLargo, rescate4096, presupuestoMs}` →
 * respuesta `{id, corrio: true, payload|null, tier|null, ms}`.
 *
 * CADENA (MISMA orden/semántica de `decodificarQrDePixeles` de
 * identidad-qr.ts, con el presupuesto de pared chequeado ANTES de cada
 * tier pesado — vencido() igual que en main):
 *   1. ladderBase      — A → B → C → C1.5 (tier "base")
 *   2. recorte-600     — esquina sup-izq jsQR-only (tier "recorte-600")
 *   3. barrido         — grilla ceñida por cuadrantes (tier "barrido")
 *   4. barrido-nitido  — barrido sobre unsharp 3×3 (tier "barrido-nitido")
 *   5. barrido-binarizado — umbral local integral (tier "barrido-binarizado")
 *   6. rotacion90/180/270 — A completa rotada (tier "rotacionN")
 *   7. rescate 4096    — SOLO si rescate4096 ∧ el canvas de trabajo quedó
 *                        clampeado (≥2048 — MISMA condición de main: sobre
 *                        un original ≤2048 sería upscale inútil): ladder
 *                        base + barrido sobre el decode a 4096.
 *
 * R1.4-b — KIT qr-fases-telemetria-v1: la respuesta viaja con `fases`
 * (ms POR FASE — solo las que CORRIERON: ausente = saltada por el reló
 * o no alcanzada) y `fin` (payload | agotado | vencido | sin-decode).
 * Cronómetro PASIVO (solo medir — jamás cambia decisiones ni orden).
 *
 * RED LINES (heredadas del kit e73 §I — VIGENTES):
 * · zxing-wasm JAMÁS en el worker (jsQR vendido = puro JS, worker-safe):
 *   el tier zxing de la cadena corre en MAIN (identidad-qr.ts — el
 *   fallback de cámara de hoy conserva SU cobertura).
 * · JAMÁS throw: cualquier fallo → `{payload: null, tier: null, ms}` — el
 *   caller en main decide (fallback camino de hoy / sin-payload).
 * · Memoria: `bitmap.close()` INMEDIATO tras el draw (pico ~64 MB en el
 *   rescate 4096, liberado al instante); el OffscreenCanvas muere con el
 *   mensaje.
 *
 * KIT e14-remediacion-movil-v1 (C4 — workers que no mueren; P2 #15 — análisis
 * del colgado del QR en medición 3/3 con hard-kill ya activo):
 *
 * SÍNTOMA medido: consola `RuntimeError: Aborted()` desde `e.onmessage`
 * (familia emscripten) + worker colgado más allá de presupuesto+1500 ms.
 *
 * POR QUÉ sale un `Aborted()` de un `onmessage` (mecánica emscripten):
 * emscripten compila los módulos WASM con un estado GLOBAL y MUTABLE (heap
 * tipado, stack, tabla de excepciones). `abort()` — por OOM al crecer la
 * memoria, por re-entrancia (se entra al módulo mientras OTRA llamada sigue
 * viva y el estado interno se pisa) o por llamada tras un `abort()` previo —
 * deja el módulo en estado roto y TODA entrada posterior lanza
 * `RuntimeError: Aborted()`; si la entrada ocurre desde el handler de
 * mensajes, el frame del stack es literalmente `onmessage`. ES UN ESTADO
 * CONTAGIOSO: una vez abortado, el módulo no se recupera sin re-instanciar.
 *
 * DÓNDE NO ESTÁ: en ESTE bundle. El worker es jsQR vendido (puro JS —
 * red line §I) y NO importa zxing-wasm ni OpenCV: el artefacto
 * public/scanner/capa0-qr.worker.js NO contiene WebAssembly/emscripten
 * (verificado por el smoke de bundling, que prohíbe `import(` y por grep
 * del artefacto). Por eso el `Aborted()` medido NO puede nacer aquí —
 * candidatos reales, por probabilidad:
 *   1. OOM de heap en el RESCATE de main: tras el hard-kill el caller paga
 *      el rescate zxing (identidad-qr.ts, zxing-wasm en el hilo principal)
 *      sobre una foto de 12 MP en un dispositivo de 2 GB — el crecimiento
 *      fallido del heap de zxing-wasm/emscripten aborta el módulo y el
 *      error sube por el stack del llamador (lección INVALID SESSION móvil).
 *   2. Re-entrancia de zxing-wasm en MAIN: dos decodes QR solapados (brújula
 *      de orientación + rescate) entran al MISMO módulo emscripten vivo.
 *   3. OpenCV.js dentro de detection-worker.js (warp hasta 4032) — su
 *      `self.onmessage` es el frame `onmessage` del stack si su heap aborta.
 * Este comentario documenta la hipótesis; la réplica en dispositivo debe
 * confirmar con la traza (ver docs/NOTA-c4-workers.md). NO se inventa un
 * fix arriesgado contra wasm ajeno a este bundle.
 *
 * MITIGACIÓN barata y segura AQUÍ (no cambia resultados ni protocolo):
 * guard de re-entrancia en el `onmessage` — si hay UNA tarea en vuelo, NO se
 * vuelve a entrar a la cadena (jsQR/decodes), se responde inmediatamente un
 * «ocupado» con una RespuestaCapa0 LEGAL del protocolo existente
 * (corrio:true + payload null + presupuestoVencido:true + fin "vencido" —
 * «el null NO es un hecho, NO cacheable», mismo tratamiento del hard-kill
 * en el cliente). El flujo de cámara actual es SECUENCIAL (1 petición a la
 * vez) ⇒ el guard es un NO-OP en el camino feliz; su valor es blindar el
 * escenario pool≥2 (runner masivo del repo hermano) donde dos cadenas
 * concurrentes pisarían el guard de barrido de módulo (activarGuardBarrido
 * es estado GLOBAL de qr-pixeles) y multiplicarían los picos de memoria
 * (2×2048² + 2×4096²) — exactamente la combustible del OOM/re-entrancia.
 * La llamada a la cadena ya vive en try/catch (capa0EnWorker JAMÁS throw,
 * §I) y el cableado completo se envuelve en try/catch con respuesta de
 * fallo controlada (cinturón contra un structured-clone imposible).
 */
import {
  activarGuardBarrido, // R1.1 — guard del barrido por cuadrante/fracción
  barridoQrDePixeles,
  BANDA_A,
  binarizadaQrDePixeles,
  intentoSobrePixeles,
  jsQrDeVentana,
  ladderBaseDePixeles,
  nitidezQrDePixeles,
  QR_RECORTE_LADO,
  rotarPixeles,
  ventanaDePixeles,
  type PixelesQr,
} from "../src/qr/qr-pixeles";

/** Lado largo del RESCATE (e64-qr T-1.4 — el 4096² de main). Literal en el
 *  worker para NO importar identidad-qr (arrastraría zxing/logger al
 *  bundle — red line). Valor espejo de QR_LADO_LARGO_RESCATE. */
const QR_LADO_RESCATE = 4096;

/** Umbral del rescate (MISMO literal de main: QR_LADO_LARGO=2048). */
const QR_LADO_UMBRAL_RESCATE = 2048;

/** R1.4-b — desglose de fases de la cadena (ms POR FASE, mismo reloj
 *  Date.now() del presupuesto). Solo viajan las fases que CORRIERON:
 *  ausente = saltada por el guard del reló (R1.1) o no alcanzada — jamás
 *  inventar trabajo que no ocurrió. La suma de fases ≤ ms SIEMPRE
 *  (ms incluye también el overhead del propio mensaje del worker).
 *  `nitido`/`binarizada` incluyen su transform (unsharp/umbral) + barrido
 *  — son UNA unidad de decisión. `rotaciones` es la SUMA de las que
 *  corrieron (0-3). `rescate4096` incluye re-decode a 4096 + base +
 *  barrido del rescate. */
export type FasesCapa0 = {
  /** decode del Blob al lado largo de trabajo (createImageBitmap + draw). */
  decode?: number;
  /** ladder base A→B→C→C1.5 sobre el frame de trabajo. */
  base?: number;
  /** ventana esquina sup-izq (QR_RECORTE_LADO) + jsQR. */
  recorte600?: number;
  /** barrido por cuadrantes sobre el frame de trabajo. */
  barrido?: number;
  /** unsharp 3×3 + barrido. */
  nitido?: number;
  /** umbral local integral + barrido. */
  binarizada?: number;
  /** SUMA de las rotaciones 90/180/270 que corrieron (rotación + intento A). */
  rotaciones?: number;
  /** rescate 4096: re-decode + ladder base + barrido (parcial si el reló
   *  lo cortó a mitad — el ms estampado es el real corrido). */
  rescate4096?: number;
};

/** R1.4-b — cómo TERMINÓ la cadena (la respuesta a "¿por qué null sin
 *  tier?"): "payload" = leyó QR (tier presente); "agotado" = corrió TODO
 *  el ladder y no hay QR en estos bytes (null REAL — cacheable R1.2);
 *  "vencido" = el reló la cortó (null NO es un hecho — NO cacheable);
 *  "sin-decode" = el propio decode del blob falló (ni entró al ladder). */
export type FinCapa0 = "payload" | "agotado" | "vencido" | "sin-decode";

/** Mensaje que el cliente (capa0-qr.client.ts) postea al worker. */
export type PeticionCapa0 = {
  id: number;
  blob: Blob;
  ladoLargo: number;
  rescate4096: boolean;
  presupuestoMs: number | null;
};

/** Respuesta del worker — corrio SIEMPRE true cuando responde (el cliente
 *  usa `null` de la promesa para "NO corrió": sin soporte/kill-switch/
 *  hard-kill/error de transporte).
 *  R1.1 — presupuestoVencido: el reló de la cadena estaba VENCIDO al
 *  terminar (el ladder se cortó por presupuesto, no se agotó de verdad).
 *  R1.4-b — fases/fin: telemetría por fase + causa del fin (undefined =
 *  cadena no completó — catch interno; jamás inventar). */
export type RespuestaCapa0 = {
  id: number;
  corrio: true;
  payload: string | null;
  tier: string | null;
  ms: number;
  presupuestoVencido: boolean;
  fases?: FasesCapa0;
  fin?: FinCapa0;
};

/** Decode del Blob a PixelesQr — createImageBitmap EXIF "from-image" →
 *  drawImage a OffscreenCanvas con lado largo ≤ `ladoLargo` → getImageData.
 *  bitmap.close() INMEDIATO. Sin soporte o fallo → null honesto. */
async function pixelesDeBlob(
  blob: Blob,
  ladoLargo: number,
): Promise<PixelesQr | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    if (
      typeof createImageBitmap === "undefined" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      return null; // feature-detect del worker — degradación honesta
    }
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const escala = Math.min(1, ladoLargo / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close(); // INMEDIATO tras el draw — pico liberado al instante
    bitmap = null;
    const imgData = ctx.getImageData(0, 0, w, h);
    return { data: imgData.data, width: w, height: h };
  } catch {
    return null; // EXIF no soportado / decode falló → null honesto
  } finally {
    try {
      bitmap?.close(); // doble cierre es inofensivo (espec)
    } catch {
      /* ya cerrado */
    }
  }
}

/**
 * Cadena completa jsQR-only de la capa 0 — MISMA orden/semántica de la
 * cadena de main (identidad-qr.ts decodificarQrDePixeles + rescate de
 * decodificarQrDeCapture) con el presupuesto de pared. JAMÁS throw.
 *
 * R1.1 — KIT qr-presupuesto-real-v1: el presupuesto pasa a ser de VERDAD.
 * Con presupuesto null vencido() es siempre false ⇒ byte-idéntico. Con
 * presupuesto (unificada 8 s / BAJO 5 s):
 *  · barridos con guard POR CUADRANTE y POR FRACCIÓN (activarGuardBarrido
 *    — el chequeo interno vive en qr-pixeles.barridoQrDePixeles);
 *  · cada ROTACIÓN chequea el reló ANTES de rotar el frame completo (antes
 *    corrían SIEMPRE las 3 — 3-6 s extra con el presupuesto vencido);
 *  · el rescate 4096 chequea el reló ANTES del re-decode (16 MP) y ANTES
 *    de su barrido a 4096 (≈4× el costo del 2048).
 *
 * R1.4-b — KIT qr-fases-telemetria-v1: cada fase se cronometra con el
 * MISMO reloj del presupuesto (Date.now()) y el resultado viaja con
 * `fases` (solo fases que corrieron) + `fin` (causa del fin). El timer es
 * PASIVO: no cambia orden, guards ni decisiones.
 */
async function cadenaCapa0EnWorker(
  peticion: PeticionCapa0,
): Promise<{
  payload: string | null;
  tier: string | null;
  presupuestoVencido: boolean;
  fases: FasesCapa0;
  fin: FinCapa0;
}> {
  const t0 = Date.now();
  const presupuestoMs =
    typeof peticion.presupuestoMs === "number" && peticion.presupuestoMs > 0
      ? peticion.presupuestoMs
      : null;
  const vencido = () =>
    presupuestoMs !== null && Date.now() - t0 > presupuestoMs;
  const fases: FasesCapa0 = {};
  const tDecode = Date.now();
  const pix = await pixelesDeBlob(peticion.blob, peticion.ladoLargo);
  fases.decode = Date.now() - tDecode;
  if (!pix) {
    return { payload: null, tier: null, presupuestoVencido: false, fases, fin: "sin-decode" };
  }
  activarGuardBarrido(vencido); // R1.1 — guard del barrido (null budget ⇒ inerte)
  try {
    // 1. ladder base (A→B→C→C1.5) — igual que main (sin guard: es el tier barato)
    const tBase = Date.now();
    const base = ladderBaseDePixeles(pix);
    fases.base = Date.now() - tBase;
    if (base != null)
      return { payload: base, tier: "base", presupuestoVencido: false, fases, fin: "payload" };
    // 2. recorte esquina estándar — jsQR-only aquí (el zxing del recorte en
    //    main lo cubre el fallback de cámara si este worker no leyó nada)
    const tRecorte = Date.now();
    const recorte = ventanaDePixeles(pix, 0, 0, QR_RECORTE_LADO);
    const jsRecorte = recorte ? jsQrDeVentana(recorte) : null;
    fases.recorte600 = Date.now() - tRecorte;
    if (jsRecorte != null)
      return { payload: jsRecorte, tier: "recorte-600", presupuestoVencido: false, fases, fin: "payload" };
    // 3-5. barridos pesados — guard de presupuesto ANTES de cada uno (igual
    //      que main: si venció se saltan y la cadena sigue a rotaciones).
    if (!vencido()) {
      const tBarrido = Date.now();
      const barrido = barridoQrDePixeles(pix);
      fases.barrido = Date.now() - tBarrido;
      if (barrido != null)
        return { payload: barrido, tier: "barrido", presupuestoVencido: false, fases, fin: "payload" };
    }
    if (!vencido()) {
      const tNitido = Date.now();
      const nitido = barridoQrDePixeles(nitidezQrDePixeles(pix));
      fases.nitido = Date.now() - tNitido;
      if (nitido != null)
        return { payload: nitido, tier: "barrido-nitido", presupuestoVencido: false, fases, fin: "payload" };
    }
    if (!vencido()) {
      const tBinarizada = Date.now();
      const binarizada = barridoQrDePixeles(binarizadaQrDePixeles(pix));
      fases.binarizada = Date.now() - tBinarizada;
      if (binarizada != null)
        return {
          payload: binarizada,
          tier: "barrido-binarizado",
          presupuestoVencido: false,
          fases,
          fin: "payload",
        };
    }
    // 6. rotaciones — R1.1: guard POR ROTACIÓN (antes corrían las 3 SIEMPRE:
    //    3 rotaciones de frame completo + 3 intentos jsQR A — con el
    //    presupuesto vencido eran 3-6 s extra garantizados).
    //    R1.4-b: `rotaciones` ACUMULA las que corrieron (0-3).
    for (const grados of [90, 180, 270]) {
      if (vencido()) break;
      const tRot = Date.now();
      const payload = intentoSobrePixeles(rotarPixeles(pix, grados), BANDA_A);
      fases.rotaciones = (fases.rotaciones ?? 0) + (Date.now() - tRot);
      if (payload != null)
        return {
          payload,
          tier: `rotacion${grados}`,
          presupuestoVencido: false,
          fases,
          fin: "payload",
        };
    }
    // 7. rescate 4096 — MISMA condición de main (pix clampeado ≥ 2048) y SOLO
    //    si la opción del plan lo permite (floor BAJO: OFF — anti-OOM). R1.1:
    //    guard de reló ANTES del re-decode (16 MP) y ANTES de su barrido.
    //    R1.4-b: el ms del rescate se estampa en TODO camino de salida.
    if (
      peticion.rescate4096 &&
      Math.max(pix.width, pix.height) >= QR_LADO_UMBRAL_RESCATE
    ) {
      if (!vencido()) {
        const tRescate = Date.now();
        const estamparRescate = () => {
          fases.rescate4096 = Date.now() - tRescate;
        };
        const pixGrande = await pixelesDeBlob(peticion.blob, QR_LADO_RESCATE);
        if (pixGrande) {
          const baseGrande = ladderBaseDePixeles(pixGrande);
          if (baseGrande != null) {
            estamparRescate();
            return {
              payload: baseGrande,
              tier: "rescate4096",
              presupuestoVencido: false,
              fases,
              fin: "payload",
            };
          }
          if (!vencido()) {
            const barridoGrande = barridoQrDePixeles(pixGrande);
            estamparRescate();
            if (barridoGrande != null)
              return {
                payload: barridoGrande,
                tier: "rescate4096-barrido",
                presupuestoVencido: false,
                fases,
                fin: "payload",
              };
          } else {
            estamparRescate(); // reló a mitad del rescate — parcial REAL
          }
        } else {
          estamparRescate(); // re-decode 4096 falló — el intento corrió
        }
      }
    }
    return {
      payload: null,
      tier: null,
      presupuestoVencido: vencido(), // R1.1 — ¿null real o corte por reló?
      fases,
      fin: vencido() ? "vencido" : "agotado",
    };
  } finally {
    activarGuardBarrido(null); // R1.1 — el guard muere con la cadena
  }
}

/** Mensaje completo: decode + cadena presupuestada + ms. JAMÁS throw. */
async function capa0EnWorker(
  peticion: PeticionCapa0,
): Promise<RespuestaCapa0> {
  const t0 = Date.now();
  try {
    const r = await cadenaCapa0EnWorker(peticion);
    return {
      id: peticion.id,
      corrio: true,
      payload: r.payload,
      tier: r.tier,
      ms: Date.now() - t0,
      presupuestoVencido: r.presupuestoVencido,
      fases: r.fases,
      fin: r.fin,
    };
  } catch {
    return {
      id: peticion.id,
      corrio: true,
      payload: null,
      tier: null,
      ms: Date.now() - t0,
      // conservador — un fallo NO es un null agotado
      presupuestoVencido: true,
      // R1.4-b — sin fases/fin: la cadena NO completó (jamás inventar).
    }; // jamás throw (§I — doctrina del conservador)
  }
}

/** Cableado del mensaje — SOLO en un entorno de worker real (el worker se
 *  importa desde tests como módulo puro).
 *
 *  C4 — guard de re-entrancia (MITIGACIÓN del colgado; ver el bloque del kit
 *  en la cabecera): MÁXIMO UNA cadena viva en el worker. Con tarea en vuelo
 *  el mensaje se responde «ocupado» por el MISMO protocolo (RespuestaCapa0
 *  legal, sin fin nuevo ni campo nuevo) y se descarta — sin cola: el cliente
 *  ya tiene presupuesto + hard-kill y el flujo de cámara re-pide si hace
 *  falta. La tarea en vuelo es INMUNE a este guard: su respuesta sale
 *  normal y el `finally` re-abre el paso. */
if (typeof window === "undefined" && typeof self !== "undefined") {
  /** C4 — ¿hay una cadena viva? (estado de MÓDULO — el worker es mono-hilo). */
  let tareaEnVuelo = false;
  /** C4 — id de la petición en vuelo (para el fallo controlado del catch). */
  let idEnVuelo: number | null = null;

  /** C4 — respuesta «ocupado» / de fallo controlado: LEGAL según el protocolo
   *  (los fines válidos del cliente son payload|agotado|vencido|sin-decode).
   *  Se usa "vencido" + presupuestoVencido:true — la MISMA semántica del
   *  hard-kill del cliente: corrió-NO-vio (null NO cacheable, el caller solo
   *  paga el rescate zxing de main si su flujo lo define así). ms=0 HONESTO:
   *  la cadena no corrió ni un ms. */
  const respuestaOcupado = (id: number): RespuestaCapa0 => ({
    id,
    corrio: true,
    payload: null,
    tier: null,
    ms: 0,
    presupuestoVencido: true,
    fin: "vencido",
  });

  self.onmessage = (ev: MessageEvent<PeticionCapa0>) => {
    const peticion = ev.data;
    // C4 — RE-ENTRANCIA BLOQUEADA: con cadena viva NO se entra al núcleo
    // (jsQR ni decodes de imagen) — respuesta inmediata y fuera.
    if (tareaEnVuelo) {
      try {
        self.postMessage(
          respuestaOcupado(typeof peticion?.id === "number" ? peticion.id : -1),
        );
      } catch {
        /* el postMessage jamás tumba al worker */
      }
      return;
    }
    tareaEnVuelo = true;
    idEnVuelo = typeof peticion?.id === "number" ? peticion.id : null;
    void capa0EnWorker(peticion)
      .then((respuesta: RespuestaCapa0) => {
        self.postMessage(respuesta);
      })
      .catch(() => {
        // C4 — cinturón: capa0EnWorker JAMÁS throw (§I); si algo se escapara
        // (p. ej. structured-clone de la respuesta), el pendiente del cliente
        // no se queda colgado: fallo controlado por el mismo protocolo.
        try {
          self.postMessage(respuestaOcupado(idEnVuelo ?? -1));
        } catch {
          /* silencioso */
        }
      })
      .finally(() => {
        tareaEnVuelo = false;
        idEnVuelo = null;
      });
  };
}
