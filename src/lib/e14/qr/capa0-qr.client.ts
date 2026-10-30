"use client";

/**
 * KIT e14-capa0-qr-worker-v1 — CLIENTE del worker de la CAPA 0 QR.
 *
 * PORT a digielect14 del cliente D40 de supervision-e14 (misma evolución
 * R1.1 + R1.4-b), adaptado al flujo INDIVIDUAL de cámara:
 *  · Worker precompilado en public/scanner/capa0-qr.worker.js (IIFE —
 *    precedente detection-worker.js / heartbeat.worker.js; el .ts NO se
 *    deja al bundler de la app — lección del FIX DICTAMEN-e73 §3.1).
 *  · Hard-kill anti-zombi: `presupuesto + 1500 ms` → terminate + respawn
 *    perezoso + pendientes → null (un worker colgado JAMÁS frena el
 *    pipeline — el caller cae al camino de hoy).
 *  · Feature-detect obligatorio: sin Worker/OffscreenCanvas → null SIEMPRE.
 *  · Flag OFF (capa0QrWorker, default true) → null SIN instanciar worker
 *    (kill-switch del dueño — camino de hoy byte-idéntico).
 *  · JAMÁS throw: cualquier fallo → null.
 *
 * API 1 — decodificarQrCapa0Worker(blob, opciones) →
 *   { corrio: true, payload, tier, ms, fases?, fin? } | null
 * API 2 — decodificarQrCapa0Camara(dataUrl) — WRAPPER del flujo de cámara:
 *   convierte la dataUrl del capture a Blob, corre la cadena en el worker
 *   con el presupuesto del plan (unificada: ALTO/MEDIO 8 s · BAJO 5 s,
 *   rescate 4096 OFF en BAJO — floor anti-OOM) y SI el worker no corrió
 *   (flag OFF / sin soporte / hard-kill) cae al camino de HOY byte-idéntico
 *   (identidad-qr.decodificarQrDeCapture tiers "base"). Si el worker SÍ
 *   corrió, su cobertura (cadena completa jsQR) ES estrictamente mayor que
 *   el tier base — null del worker = null honesto, sin doble trabajo.
 */
import { logger } from "../../logger";
import { leerFlags } from "../flags";
import { planAdaptativo } from "../adaptacion/plan";
import type { FinCapa0, FasesCapa0, RespuestaCapa0 } from "./capa0-qr.worker";

export type { FinCapa0, FasesCapa0 } from "./capa0-qr.worker";

/** Resultado del worker — ESPEJO de RespuestaCapa0 (sin el id).
 *  R1.1 — presupuestoVencido: undefined (bundle viejo) = conservador.
 *  R1.4-b — fases/fin: telemetría por fase + causa del fin. undefined =
 *  bundle viejo o cadena no completó (catch interno) — jamás inventar. */
export type ResultadoCapa0Worker = {
  corrio: true;
  payload: string | null;
  tier: string | null;
  ms: number;
  presupuestoVencido?: boolean;
  fases?: FasesCapa0;
  fin?: FinCapa0;
};

/** Opciones de la cadena (presupuesto por tier — mismos nombres del kit). */
export type OpcionesCapa0Worker = {
  ladoLargo: number;
  rescate4096: boolean;
  presupuestoMs: number | null;
};

/** Base pública de assets — MISMO patrón del repo (flags.ts). */
const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Cache-busting del worker precompilado (mismo patrón ?v=N del
 *  detection-worker — bump al regenerar el bundle).
 *  v1: port D40 + R1.1 (presupuesto real + guard) + R1.4-b (fases/fin). */
const WORKER_URL = `${PUBLIC_BASE}/scanner/capa0-qr.worker.js?v=1`;

/** Gracia del hard-kill SOBRE el presupuesto del worker (el kill solo cae
 *  sobre colgajes reales). */
const GRACIA_KILL_MS = 1500;

let worker: Worker | null = null;
let workerListo = false;

function obtenerWorker(): Worker | null {
  if (workerListo) return worker;
  workerListo = true; // una sola tentativa por vida del módulo — el respawn
  // del hard-kill RE-ACTIVA (workerListo=false en terminarWorker).
  try {
    worker = new Worker(WORKER_URL);
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = enMensaje;
    worker.onerror = enError;
  }
  return worker;
}

/** Pendientes vivos por id — el hard-kill resuelve TODOS a null. */
const pendientes = new Map<
  number,
  { resolve: (r: ResultadoCapa0Worker | null) => void; kill: ReturnType<typeof setTimeout> }
>();
let seqId = 0;

/** R1.4-b — validación del desglose que cruza el postMessage: objeto plano
 *  con valores numéricos finitos ≥ 0 (desconfianza sanadora — un bundle
 *  viejo no trae el campo y un mensaje malo no tumba el cliente). */
function fasesValidas(f: unknown): FasesCapa0 | undefined {
  if (typeof f !== "object" || f === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as FasesCapa0) : undefined;
}

/** Fines legales — espejo de FinCapa0 (el postMessage cruza sin tipos). */
const FINES_CAPA0: ReadonlySet<string> = new Set([
  "payload",
  "agotado",
  "vencido",
  "sin-decode",
]);

function enMensaje(ev: MessageEvent<RespuestaCapa0>): void {
  const r = ev.data;
  const pendiente = typeof r?.id === "number" ? pendientes.get(r.id) : undefined;
  if (!pendiente) return; // respuesta huérfana (post-kill) — ignorar
  pendientes.delete(r.id);
  clearTimeout(pendiente.kill);
  pendiente.resolve({
    corrio: true,
    payload: typeof r.payload === "string" && r.payload.length > 0 ? r.payload : null,
    tier: typeof r.payload === "string" && r.payload.length > 0 ? String(r.tier ?? "") : null,
    ms: Number(r.ms) || 0,
    // R1.1 — passthrough honesto: undefined (bundle viejo) = conservador
    presupuestoVencido: r.presupuestoVencido === false ? false : true,
    // R1.4-b — passthrough validado: undefined = sin telemetría (jamás inventar).
    fases: fasesValidas(r.fases),
    fin:
      typeof r.fin === "string" && FINES_CAPA0.has(r.fin)
        ? (r.fin as FinCapa0)
        : undefined,
  });
}

function enError(): void {
  terminarWorker(); // worker roto → respawn perezoso + pendientes a null
}

function terminarWorker(): void {
  for (const [, pendiente] of pendientes) {
    clearTimeout(pendiente.kill);
    pendiente.resolve(null);
  }
  pendientes.clear();
  try {
    worker?.terminate();
  } catch {
    /* ya muerto */
  }
  worker = null;
  workerListo = false;
}

/**
 * API 1 del kit: la cadena jsQR de la CAPA 0 en el worker. Jamás throw;
 * sin soporte / flag OFF / hard-kill / error → null.
 */
export function decodificarQrCapa0Worker(
  blob: Blob,
  opciones: OpcionesCapa0Worker,
): Promise<ResultadoCapa0Worker | null> {
  return new Promise((resolve) => {
    try {
      if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
        resolve(null);
        return;
      }
      // Kill-switch del dueño — leído EN EL LLAMADO (el override localStorage
      // aplica sin reload).
      if (!leerFlags().capa0QrWorker) {
        resolve(null);
        return;
      }
      const w = obtenerWorker();
      if (!w) {
        resolve(null); // worker no disponible → degradación honesta
        return;
      }
      const id = ++seqId;
      const presupuesto = opciones.presupuestoMs;
      const kill = setTimeout(
        () => {
          logger.warn(
            `[e14] capa0-qr worker hard-kill presupuesto=${presupuesto ?? "∞"}+${GRACIA_KILL_MS} — worker colgado (respawn); el pipeline cae al camino de hoy`,
          );
          terminarWorker();
        },
        (presupuesto ?? 120_000) + GRACIA_KILL_MS,
      );
      pendientes.set(id, { resolve, kill });
      w.postMessage({
        id,
        blob,
        ladoLargo: opciones.ladoLargo,
        rescate4096: opciones.rescate4096,
        presupuestoMs: presupuesto,
      });
    } catch {
      resolve(null); // jamás tumba el pipeline (doctrina del conservador)
    }
  });
}

/** Lado largo del canvas de trabajo de la cadena (MISMO literal de main:
 *  identidad-qr.ts QR_LADO_LARGO — literal aquí para no arrastrar el
 *  módulo con zxing al wrapper). */
const QR_LADO_LARGO = 2048;

/**
 * API 2 — la CAPA 0 QR de la CÁMARA en el worker. Contrato EXACTO del
 * bloque e64-qr T-2.1 del bridge ({payload} | null, jamás throw):
 *  · dataUrl → Blob (fetch local — sin re-decode en main).
 *  · presupuesto por tier del plan adaptativo (unificada: BAJO 5 s con
 *    rescate 4096 OFF — floor anti-OOM, lección INVALID SESSION; ALTO/
 *    MEDIO 8 s con rescate — plan MEDIO unificado de supervision-e14).
 *  · worker SÍ corrió → su payload (cobertura ⊇ tier base de hoy);
 *    payload null → null honesto (SIN doble trabajo en main).
 *  · worker NO corrió → camino de HOY byte-idéntico (tiers "base").
 */
export async function decodificarQrCapa0Camara(
  dataUrl: string,
): Promise<{ payload: string } | null> {
  try {
    const respuesta = await fetch(dataUrl);
    const blob = await respuesta.blob();
    let presupuestoMs = 8_000;
    let rescate4096 = true;
    try {
      const plan = planAdaptativo();
      if (plan.tier === "BAJO") {
        presupuestoMs = 5_000;
        rescate4096 = false; // floor anti-OOM (lección INVALID SESSION móvil)
      }
    } catch {
      /* plan indisponible → unificada default (8 s / rescate) */
    }
    const r = await decodificarQrCapa0Worker(blob, {
      ladoLargo: QR_LADO_LARGO,
      rescate4096,
      presupuestoMs,
    });
    if (r) {
      // Telemetría PASIVA — la misma que la masiva lee en sus informes:
      // tier + ms + fin + desglose de fases (Σ fases ≤ ms SIEMPRE).
      try {
        logger.info(
          `[e14] qr-capa0-worker tier=${r.tier ?? "null"} ms=${r.ms} fin=${r.fin ?? "n/d"} fases=${r.fases ? JSON.stringify(r.fases) : "n/d"} presupuestoVencido=${r.presupuestoVencido ? 1 : 0}`,
        );
      } catch {
        /* la traza jamás tumba el pipeline */
      }
      return r.payload ? { payload: r.payload } : null;
    }
  } catch {
    /* worker/fetch falló → camino de hoy */
  }
  // Camino de HOY byte-idéntico (flag OFF / sin soporte / hard-kill).
  const { decodificarQrDeCapture } = await import("./identidad-qr");
  return decodificarQrDeCapture(dataUrl, { tiers: "base" });
}
