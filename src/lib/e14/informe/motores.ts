/**
 * motores.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.4)
 *
 * Los 2 motores Tesseract del comparativo:
 *  · `actual` — requestOcr de @jg-stevan/scanner-core (worker caliente del
 *    producto: spa+eng OEM1, downscale interno 1600). SIN cambios al core.
 *  · `tesseract-fullres` — Tesseract.js 5.1.1 (mismo URL CDN que el core,
 *    reutiliza global/cache) con worker PROPIO y recognize SIN downscale —
 *    aísla el efecto del downscale 1600 (culpable n.º 2 de FASE 0: perdió
 *    "FIRMA JURADO" → falso «ACTA RECORTADA»).
 */
import { evento } from "./telemetria";
import { requestOcr } from "@jg-stevan/scanner-core/ocr";

export interface SalidaOcr {
  texto: string;
  /** 0..1 (null si el motor no expone confianza — `actual`). */
  conf: number | null;
}

/** Motor del producto (etiqueta del informe: «Tesseract spa+eng · downscale
 *  1600 · worker del producto»). Reutiliza el worker caliente del pipeline. */
export async function ocrActual(dataUrl: string): Promise<SalidaOcr> {
  const texto = await requestOcr(dataUrl);
  return { texto, conf: null };
}

// ─── Tesseract full-res (worker propio, singleton por informe) ──────────────

const TESS_CDN =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

interface TessWorkerLike {
  recognize(image: string): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}
interface TessGlobal {
  createWorker(lang: string, oem: number, opts?: unknown): Promise<TessWorkerLike>;
}

let tessScriptCargando: Promise<TessGlobal> | null = null;

function cargarTessGlobal(): Promise<TessGlobal> {
  const w = window as unknown as { Tesseract?: TessGlobal };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (tessScriptCargando) return tessScriptCargando;
  tessScriptCargando = new Promise<TessGlobal>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESS_CDN;
    s.onload = () => {
      const g = (window as unknown as { Tesseract?: TessGlobal }).Tesseract;
      if (g) resolve(g);
      else reject(new Error("Tesseract global ausente tras cargar el script"));
    };
    s.onerror = () => {
      tessScriptCargando = null;
      reject(new Error(`CDN Tesseract inaccesible: ${TESS_CDN}`));
    };
    document.head.appendChild(s);
  });
  return tessScriptCargando;
}

let workerFullRes: TessWorkerLike | null = null;

/** Init perezoso del worker propio (full-res). */
export async function tessFullResInit(): Promise<void> {
  if (workerFullRes) return;
  const t0 = performance.now();
  const Tesseract = await cargarTessGlobal();
  workerFullRes = await Tesseract.createWorker("spa+eng", 1);
  evento("tessfullres/init", `worker propio listo en ${Math.round(performance.now() - t0)}ms`);
}

/** recognize SIN downscale (entrada tal cual). */
export async function tessFullResReconocer(dataUrl: string): Promise<SalidaOcr> {
  if (!workerFullRes) await tessFullResInit();
  const t0 = performance.now();
  const { data } = await workerFullRes!.recognize(dataUrl);
  evento(
    "tessfullres/rec",
    `${data.text.length} chars · conf=${data.confidence}/100 · ${Math.round(performance.now() - t0)}ms`,
  );
  return { texto: data.text, conf: data.confidence / 100 };
}

/** Libera el worker propio (al final del informe). */
export async function tessFullResTerminar(): Promise<void> {
  if (!workerFullRes) return;
  try {
    await workerFullRes.terminate();
  } catch {
    /* nada — el cleanup jamás rompe */
  }
  workerFullRes = null;
}
