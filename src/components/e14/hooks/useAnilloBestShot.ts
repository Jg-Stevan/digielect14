"use client";

/**
 * useAnilloBestShot — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado al
 * buffer circular Best-Shot ZSL del lab. MOVIMIENTO PURO desde
 * screens/ScanView.tsx (mismos cuerpos, mismos refs, mismas dependencias —
 * el orden de efectos no cambia: este hook no registra efectos).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · Constantes del ring/cooldown ZSL (RING_MAX_LONG_SIDE, ZSL_DESDE/HASTA,
 *    RING_MAX, RING_FEED_MS).
 *  · medirGris / medirPixeles (medidas SIN encode/decode extra, §5.4 lab).
 *  · liberarCanvas (R-14 — disciplina de memoria iOS).
 *  · empujarAnillo / alimentarAnillo / liberarAnillo (lab L1512-1574).
 *  · instantanea (frame actual + medidas píxel-idénticas) y tomarZsl
 *    (ganador pre-tap 80–450 ms + vaciado del ring).
 *
 * `videoRef` es INYECTADO (el <video> vive en ScanView — el hook lo consume,
 * no lo crea): mismo objeto, misma identidad que en el original.
 */
import { useCallback, useRef, type RefObject } from "react";

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L200-209
// (FIX v4 4.5 — tope de lado mayor de las copias del ring ZSL). El ring es
// SOLO el fallback de la auto-captura (anti tap-shock): no necesita
// resolución completa. Con el stream alto de iOS (1920×1440), 8 slots a
// resolución completa ≈ 66 MB — esa presión hacía que WebKit matara la
// capa de video (visor negro en iPhones modestos). Presupuesto resultante:
// ≤ 8 × (1280×960×4) ≈ 37 MB.
const RING_MAX_LONG_SIDE = 1280;

/** F-ZSL: ventana pre-tap 80–450 ms (anti tap-shock) + ring de máx 8 frames. */
const ZSL_DESDE_MS = 80;
const ZSL_HASTA_MS = 450;
const RING_MAX = 8;
/** Feed del ring desde el video a ~5 Hz (lab L735-737). */
const RING_FEED_MS = 200;

/** R-14 (lab releaseFrame L360-365): suelta YA el backing store del canvas
 *  perdedor — no espera al GC (disciplina de memoria iOS, error #22). */
export function liberarCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/* ── ZSL §5.4 del lab — medidas SIN encode/decode extra (L311-356) ───────── */

/** Medidas de una candidata del burst: varianza Laplaciano + exposición. */
interface Medidas {
  lapVar: number;
  exposure: number;
}

/** Laplaciano 3×3 (varianza) + histograma de exposición sobre la luma de un
 *  canvas ≤ 400 px (misma matemática del quality.ts del core). */
function medirGris(gray: Float32Array, w: number, h: number): Medidas {
  const n = w * h;
  let under = 0;
  let over = 0;
  for (let i = 0; i < n; i++) {
    const l = gray[i]!;
    if (l < 30) under += 1;
    else if (l > 225) over += 1;
  }
  const exposure = 1 - (under + over) / n;
  let lapSum = 0;
  let lapSq = 0;
  let cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      cnt += 1;
    }
  }
  const lapVar = cnt > 0 ? lapSq / cnt - (lapSum / cnt) ** 2 : 0;
  return { lapVar, exposure };
}

/** Dibuja la fuente a 400 px de lado mayor y mide. SIN encode ni decode. */
function medirPixeles(src: CanvasImageSource, sw: number, sh: number): Medidas | null {
  if (!(sw > 0) || !(sh > 0)) return null;
  const s = Math.min(1, 400 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s));
  const h = Math.max(1, Math.round(sh * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  }
  return medirGris(gray, w, h);
}

/** Frame del ring ZSL (copia dedicada + lapVar + timestamp). */
interface FrameAnillo {
  canvas: HTMLCanvasElement;
  lapVar: number;
  timestamp: number;
}

/** Parámetros del hook — inyección de refs/owners (movimiento puro). */
interface UseAnilloBestShotParams {
  /** El <video> vivo de la sesión de cámara (creado en ScanView). */
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function useAnilloBestShot({ videoRef }: UseAnilloBestShotParams) {
  // F-ZSL — buffer circular Best-Shot (lab L407-411).
  const anilloRef = useRef<FrameAnillo[]>([]);
  const anilloFeedAtRef = useRef(0);
  const anilloScratchRef = useRef<HTMLCanvasElement | null>(null);

  /** Copia el fotograma al ring (máx 8) y suelta YA el backing store del
   *  expulsado (disciplina de memoria iOS, error #22).
   *  Fuente: lab CameraView.tsx L1512-1537 (FIX v4 4.5) — la copia se dibuja
   *  ESCALADA para que su lado mayor sea ≤ RING_MAX_LONG_SIDE (1280 px): a
   *  resolución completa (stream alto de iOS 1920×1440) 8 slots ≈ 66 MB y
   *  esa presión de memoria hacía que WebKit matara la capa de video (visor
   *  negro). El ring es SOLO el fallback: no necesita resolución completa. */
  const empujarAnillo = useCallback((canvas: HTMLCanvasElement, lapVar: number) => {
    const anillo = anilloRef.current;
    const srcLong = Math.max(canvas.width, canvas.height);
    const escala = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
    const copia = document.createElement("canvas");
    copia.width = Math.max(1, Math.round(canvas.width * escala));
    copia.height = Math.max(1, Math.round(canvas.height * escala));
    copia.getContext("2d")?.drawImage(canvas, 0, 0, copia.width, copia.height);
    anillo.push({ canvas: copia, lapVar, timestamp: performance.now() });
    if (anillo.length > RING_MAX) {
      const viejo = anillo.shift();
      if (viejo) liberarCanvas(viejo.canvas);
    }
  }, []);

  /** Alimenta el ring desde el <video> vivo a ~5 Hz: garantiza que el buffer
   *  SIEMPRE cubra la ventana pre-tap de 80–450 ms.
   *  Fuente: lab CameraView.tsx L1541-1574 (FIX v4 4.5) — el scratch se
   *  dimensiona a la medida ESCALADA (lado mayor ≤ 1280 px), no a la
   *  resolución del track: el ring no necesita más y la medición es
   *  idéntica (medirPixeles remuestrea a ~400 px). */
  const alimentarAnillo = useCallback((): void => {
    const ahora = performance.now();
    if (ahora - anilloFeedAtRef.current < RING_FEED_MS) return;
    anilloFeedAtRef.current = ahora;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!anilloScratchRef.current) anilloScratchRef.current = document.createElement("canvas");
    const scratch = anilloScratchRef.current;
    const srcLong = Math.max(video.videoWidth, video.videoHeight);
    const escala = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
    const dw = Math.max(1, Math.round(video.videoWidth * escala));
    const dh = Math.max(1, Math.round(video.videoHeight * escala));
    if (scratch.width !== dw || scratch.height !== dh) {
      scratch.width = dw;
      scratch.height = dh;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, dw, dh);
    const m = medirPixeles(scratch, dw, dh);
    empujarAnillo(scratch, m?.lapVar ?? 0);
  }, [empujarAnillo]);

  /** Libera el ring (al desmontar la sesión de cámara — lab L1395-1400). */
  const liberarAnillo = useCallback(() => {
    for (const f of anilloRef.current) liberarCanvas(f.canvas);
    anilloRef.current = [];
  }, []);

  /** Instantánea del <video> a resolución del track + medidas sobre ESA MISMA
   *  imagen (par píxel-idéntico). SIN encode: solo si gana el burst. */
  const instantanea = useCallback(
    (): { canvas: HTMLCanvasElement; lapVar: number } | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      const m = medirPixeles(canvas, canvas.width, canvas.height);
      empujarAnillo(canvas, m?.lapVar ?? 0);
      return { canvas, lapVar: m?.lapVar ?? 0 };
    },
    [empujarAnillo],
  );

  /** F-ZSL: ganador pre-tap (mayor lapVar entre 80 y 450 ms antes del
   *  disparo) y VACIADO del ring — el canvas del ganador pasa al burst. */
  const tomarZsl = useCallback((): { canvas: HTMLCanvasElement; lapVar: number } | null => {
    const ahora = performance.now();
    const enVentana = anilloRef.current.filter((f) => {
      const edad = ahora - f.timestamp;
      return edad >= ZSL_DESDE_MS && edad <= ZSL_HASTA_MS;
    });
    const ganador =
      enVentana.length > 0
        ? enVentana.reduce((a, b) => (b.lapVar > a.lapVar ? b : a))
        : null;
    // Libera el ring EXCEPTO el canvas del ganador (lab L809-814).
    for (const f of anilloRef.current) {
      if (f === ganador) continue;
      liberarCanvas(f.canvas);
    }
    anilloRef.current = [];
    if (!ganador) return null;
    return { canvas: ganador.canvas, lapVar: ganador.lapVar };
  }, []);

  return { anilloRef, empujarAnillo, alimentarAnillo, liberarAnillo, instantanea, tomarZsl };
}
