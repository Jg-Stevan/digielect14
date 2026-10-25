"use client";

/**
 * KIT e73-sondeo-qr-precoz-v1 (§A.4) — CLIENTE del sondeo QR en ingesta.
 *
 * Sin precedente en el repo: diseño conservador de cero.
 *  · Singleton de worker + cola FIFO SERIALIZADA (1 sondeo a la vez — RAM
 *    móvil; el trabajo corre mientras el dueño revisa la cola, costo
 *    percibido ≈ 0).
 *  · Hard-kill anti-zombi: `setTimeout(presupuesto + 1000)` →
 *    `worker.terminate()` + respawn perezoso → resolve `null` (un worker
 *    colgado JAMÁS frena la ingesta — red line §I).
 *  · Feature-detect obligatorio (§A.1): `typeof Worker === "undefined" ||
 *    typeof OffscreenCanvas === "undefined"` → `null` SIEMPRE (degradación
 *    honesta, cero throw).
 *  · Flag OFF (sondeoQrPrecoz, default true — §D) → `null` SIN instanciar
 *    worker (kill-switch del dueño — byte-idéntico a 043b2ba).
 *  · JAMÁS throw: cualquier fallo (crear/postMessage/respuesta mala) → null.
 *
 * API única: sondearQrPrecoz(archivo: File | Blob) → {payload, tier, ms} | null
 */
import { logger } from "../../logger";
import { leerFlags } from "../flags";
import type { RespuestaSondeo } from "./sondeo-qr.worker";

/** Resultado del sondeo — payload EXACTO (llave opaca) + tier que lo leyó. */
export type SondeoQr = { payload: string; tier: string; ms: number };

/** Contrato mínimo del worker que este cliente maneja (tests lo falsifican). */
export interface WorkerSondeo {
  postMessage(msg: PeticionSondeoAnonima): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<RespuestaSondeo>) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** Mensaje anónimo (Blob viaja structured-clone). */
type PeticionSondeoAnonima = { blob: Blob; presupuestoMs: number };

/** Fábrica del worker — inyectable SOLO para tests (kit §A.5). En
 *  producción es la ÚNICA referencia `new Worker` de src/ (smoke §A.1). */
export type FabricaWorkerSondeo = () => WorkerSondeo | null;

function fabricaProduccion(): WorkerSondeo | null {
  // §A.1 — la línea de la PUERTA del kit: Turbopack empaqueta el worker
  // (verificada con `bun run build` — REPORTE-kit §smoke).
  return new Worker(new URL("./sondeo-qr.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerSondeo;
}

let fabrica: FabricaWorkerSondeo = fabricaProduccion;
let worker: WorkerSondeo | null = null;
let workerListo = false;

function obtenerWorker(): WorkerSondeo | null {
  if (workerListo) return worker;
  workerListo = true; // una sola tentativa por vida del módulo — el respawn
  // del hard-kill RE-ACTIVA (workerListo=false en terminarWorker).
  try {
    worker = fabrica();
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
  }
  return worker;
}

function terminarWorker(): void {
  try {
    worker?.terminate();
  } catch {
    /* ya muerto */
  }
  worker = null;
  workerListo = false; // respawn perezoso — el próximo sondeo lo re-crea
}

const cola: { archivo: Blob; presupuestoMs: number; resolve: (r: SondeoQr | null) => void }[] =
  [];
let corriendo = false;

/** Presupuesto saneado del flag (§D — default 2500; jamás extender — §I). */
function presupuestoDeFlags(): number {
  const bruto = leerFlags().sondeoQrPresupuestoMs;
  const n = typeof bruto === "number" && Number.isFinite(bruto) ? Math.round(bruto) : 2500;
  return Math.max(500, Math.min(30_000, n));
}

/**
 * API ÚNICA del kit (§A.4): sondear el QR de UN archivo en la ingesta.
 * Serializada FIFO (1 a la vez); jamás throw; fallo/falta de soporte/flag
 * OFF/worker colgado → null (la vía de HOY — dhash in-pool — sigue intacta).
 */
export function sondearQrPrecoz(archivo: File | Blob): Promise<SondeoQr | null> {
  return new Promise((resolve) => {
    try {
      // Feature-detect §A.1 — entornos sin workers (o sin OffscreenCanvas)
      // devuelven null SIEMPRE, sin instanciar nada.
      if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
        resolve(null);
        return;
      }
      // Flag OFF → null sin instanciar worker (kill-switch, byte-idéntico).
      if (!leerFlags().sondeoQrPrecoz) {
        resolve(null);
        return;
      }
      cola.push({ archivo, presupuestoMs: presupuestoDeFlags(), resolve });
      drenar();
    } catch {
      resolve(null); // jamás tumba la ingesta (doctrina del conservador)
    }
  });
}

/** Drena la cola FIFO — un sondeo a la vez (RAM móvil). */
function drenar(): void {
  if (corriendo) return;
  const siguiente = cola.shift();
  if (!siguiente) return;
  corriendo = true;
  void ejecutar(siguiente).finally(() => {
    corriendo = false;
    drenar();
  });
}

async function ejecutar(tarea: {
  archivo: Blob;
  presupuestoMs: number;
  resolve: (r: SondeoQr | null) => void;
}): Promise<void> {
  // La tarea vive HASTA terminar() (respuesta/hard-kill/error) — el .finally
  // de drenar NO puede correr antes: si no, el siguiente mensaje saldría
  // antes de que el worker respondiera el actual (FIFO rota).
  return new Promise<void>((listo) => {
    const { archivo, presupuestoMs, resolve } = tarea;
    const w = obtenerWorker();
    if (!w) {
      resolve(null); // worker no disponible → degradación honesta
      listo();
      return;
    }
    let resuelto = false;
    let hardKill: ReturnType<typeof setTimeout> | null = null;
    const terminar = (r: SondeoQr | null): void => {
      if (resuelto) return;
      resuelto = true;
      if (hardKill !== null) clearTimeout(hardKill);
      resolve(r);
      listo();
    };
    // Hard-kill anti-zombi (§A.4): presupuesto + 1000 ms → terminate + respawn
    // + null. El worker colgado jamás frena la ingesta.
    hardKill = setTimeout(() => {
      logger.warn(
        `[e14] sondeo-qr hard-kill presupuesto=${presupuestoMs}+1000 — worker colgado (respawn)`,
      );
      terminarWorker();
      terminar(null);
    }, presupuestoMs + 1000);
    w.onmessage = (ev: MessageEvent<RespuestaSondeo>) => {
      const r = ev.data;
      terminar(
        r && typeof r.payload === "string" && r.payload.length > 0
          ? { payload: r.payload, tier: String(r.tier ?? ""), ms: Number(r.ms) || 0 }
          : null,
      );
    };
    w.onerror = () => {
      terminarWorker(); // worker roto → respawn perezoso
      terminar(null);
    };
    try {
      w.postMessage({ blob: archivo, presupuestoMs });
    } catch {
      terminarWorker();
      terminar(null);
    }
  });
}

/** Prueba interna (tests): reemplaza la fábrica del worker. `null` restaura
 *  la de producción. */
export function __setFabricaWorkerSondeoParaTest(f: FabricaWorkerSondeo | null): void {
  fabrica = f ?? fabricaProduccion;
  terminarWorker();
  cola.length = 0;
  corriendo = false;
}
