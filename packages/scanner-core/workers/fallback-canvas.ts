/// <reference lib="webworker" />
/**
 * KIT e14-fallback-worker-v1 (Ola 5 §5.4 — R2) — WORKER del FALLBACK canvas.
 *
 * HOY: si el DetectionWorker (OpenCV) muere, el warp bilineal + realce corren
 * en el hilo principal (image-processor.ts `processImageCanvas`): getImageData
 * de la foto completa (~48,8 MB a 4032×3024), bucle bilineal por píxel y
 * Bradley/Sauvola con integrales — el navegador se congela segundos en gama
 * baja. Era el único punto del camino normal sin worker. AHORA: la ruta de
 * degradación corre AQUÍ y el hilo principal solo decodifica y transfiere.
 *
 * CONTRATO de mensajes (el mismo estilo del capa0-qr.worker):
 *   petición  `{ id, bitmap, quad, filter, rotation, maxLongSide }`
 *             — `bitmap` ImageBitmap TRANSFERIDO (cero copia), `quad`
 *             normalizado aplanado [x,y]×4 (TL,TR,BR,BL), `filter`
 *             PageFilter ("original"|"text"|"bw"), `rotation` 0/90/180/270.
 *   respuesta `{ id, ok: true, png: Blob, ancho, alto }` — el PNG (R-10)
 *             sale por `OffscreenCanvas.convertToBlob`; el data URL lo arma
 *             el hilo principal (blobToDataURL) para respetar el contrato
 *             `ProcessResult.processed`.
 *             `{ id, ok: false, error }` ante CUALQUIER fallo.
 *
 * RED LINES (heredadas del kit e73 / capa0-qr worker):
 *  · JAMÁS throw: cualquier error → `{ok:false}` y el main cae a la ruta
 *    canvas local de siempre (la app NUNCA se rompe — §5.4 contained).
 *  · `bitmap.close()` inmediato tras el draw (pico ~48 MB liberado al
 *    instante); el OffscreenCanvas muere con el mensaje.
 *
 * PARIDAD con la ruta local (image-processor.ts):
 *  · El FILTRO usa las MISMAS funciones PURAS compartidas de image-modes.ts
 *    (`unsharpRgba` + `enhanceToRgba`) — contrato §4.2: prohibida otra
 *    matemática (error #7). Cero duplicación en el paso costoso.
 *  · La HOMOGRAFÍA y el muestreo BILINEAL están DUPLICADOS a propósito
 *    (mismo criterio del repo: helpers gemelos jornada.ts/cola.ts) — extraerlos
 *    a un módulo compartido haría importar image-processor.ts al worker y eso
 *    arrastra detector-client (ciclo + DOM). Comentario por línea donde empieza
 *    cada bloque gemelo; si se corrige la matemática en main, corregir AQUÍ
 *    en el mismo commit (regla de casa de los gemelos).
 *  · El toggle `unsharpOriginal` (filtro "original" con nitidez) NO pasa por
 *    el worker: la ruta local lo aplica sobre canvas (applyUnsharpToCanvas) y
 *    main lo reserva para sí — ver processImageCanvas.
 */
import { enhanceToRgba, unsharpRgba, type EnhanceMode } from "../src/core/image-modes";

interface PeticionFallback {
  id: number;
  bitmap: ImageBitmap;
  /** Quad normalizado aplanado: [x0,y0, x1,y1, x2,y2, x3,y3] (TL,TR,BR,BL). */
  quad: number[];
  filter: string;
  rotation: number;
  maxLongSide: number;
}

type RespuestaFallback =
  | { id: number; ok: true; png: Blob; ancho: number; alto: number }
  | { id: number; ok: false; error: string };

/** Gemelo de `filterToSharedMode` (image-processor.ts L81): los 3 filtros del
 *  producto → modos de image-modes. Literal pequeño duplicado para NO importar
 *  image-processor (ciclo + DOM). */
function filtroAModo(filter: string): EnhanceMode {
  switch (filter) {
    case "original":
      return "raw";
    case "bw":
      return "bw";
    default:
      return "text";
  }
}

// ── GEMELO: solveHomographyDstToSrc (image-processor.ts L1025) — copia
//    literal de la matemática (DLT 4 puntos + pivoteo). No tocar uno sin el otro.
function resolverHomografiaDstASrc(
  dst: ReadonlyArray<readonly [number, number]>,
  src: ReadonlyArray<readonly [number, number]>
): number[] | null {
  const n = 8;
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dst[i]!;
    const [u, v] = src[i]!;
    M.push([X, Y, 1, 0, 0, 0, -X * u, -Y * u, u]);
    M.push([0, 0, 0, X, Y, 1, -X * v, -Y * v, v]);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const h = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) h[i] = M[i]![n]! / M[i]![i]!;
  h[8] = 1;
  return h;
}

/** Fuente de píxeles a resolución completa: OffscreenCanvas + getImageData
 *  (gemelo del srcCanvas de warpQuadToCanvas, image-processor.ts L1123). */
function pixelesDe(bitmap: ImageBitmap): { data: Uint8ClampedArray; sw: number; sh: number } {
  const sw = bitmap.width;
  const sh = bitmap.height;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("sin contexto 2d del fallback");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // red line: liberar el pico ~48 MB ya
  return { data: ctx.getImageData(0, 0, sw, sh).data, sw, sh };
}

// ── GEMELO: warpQuadToCanvas (image-processor.ts L1071) — mismas dimensiones
//    de salida (§7.5), mismo edge-replicate, mismo muestreo bilineal con
//    centros de píxel (simétrico con el warp del DetectionWorker).
function warpQuadAPixeles(
  fuente: { data: Uint8ClampedArray; sw: number; sh: number },
  quad: number[],
  maxSize: number
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const { sw, sh } = fuente;
  if (!(sw > 0) || !(sh > 0)) return null;

  const pts = [0, 2, 4, 6].map((i) => ({ x: quad[i]! * sw, y: quad[i + 1]! * sh }));
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const w0 = Math.max(dist(pts[0]!, pts[1]!), dist(pts[3]!, pts[2]!));
  const h0 = Math.max(dist(pts[1]!, pts[2]!), dist(pts[0]!, pts[3]!));
  if (!(w0 > 1) || !(h0 > 1)) return null;

  const scale = Math.min(1, maxSize / Math.max(w0, h0)); // nunca upscalar (R-02)
  const w = Math.max(16, Math.round(w0 * scale));
  const h = Math.max(16, Math.round(h0 * scale));

  const H = resolverHomografiaDstASrc(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    [
      [pts[0]!.x, pts[0]!.y],
      [pts[1]!.x, pts[1]!.y],
      [pts[2]!.x, pts[2]!.y],
      [pts[3]!.x, pts[3]!.y],
    ]
  );
  if (!H) return null;
  const h0c = H[0]!;
  const h1c = H[1]!;
  const h2c = H[2]!;
  const h3c = H[3]!;
  const h4c = H[4]!;
  const h5c = H[5]!;
  const h6c = H[6]!;
  const h7c = H[7]!;

  const srcData = fuente.data;
  const out = new Uint8ClampedArray(w * h * 4);
  const maxX = sw - 1;
  const maxY = sh - 1;
  for (let y = 0; y < h; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < w; x++) {
      const X = x + 0.5;
      const den = h6c * X + h7c * Y + 1;
      if (den === 0) continue;
      let u = (h0c * X + h1c * Y + h2c) / den;
      let v = (h3c * X + h4c * Y + h5c) / den;
      if (u < 0) u = 0;
      else if (u > maxX) u = maxX;
      if (v < 0) v = 0;
      else if (v > maxY) v = maxY;
      const x0 = u | 0;
      const y0 = v | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] =
          srcData[i00 + c]! * w00 +
          srcData[i10 + c]! * w10 +
          srcData[i01 + c]! * w01 +
          srcData[i11 + c]! * w11;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, w, h };
}

/** Canvas (Offscreen) desde píxeles crudos RGBA. `createImageData` + `set`
 *  (y no `new ImageData(...)`) para no pelear con la variância de tipos
 *  `Uint8ClampedArray<ArrayBuffer>` entre versiones de lib.dom. */
function canvasDePixeles(px: { data: Uint8ClampedArray; w: number; h: number }): OffscreenCanvas {
  const canvas = new OffscreenCanvas(px.w, px.h);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  const imagen = ctx.createImageData(px.w, px.h);
  imagen.data.set(px.data);
  ctx.putImageData(imagen, 0, 0);
  return canvas;
}

/** Gemelo de `bitmapToRotatedCanvas` (image-processor.ts L563) para la
 *  rotación post-warp 90/180/270 con la misma CTM (translate al centro,
 *  rotate, draw centrado). */
function rotarCanvas(origen: OffscreenCanvas, rotation: number): OffscreenCanvas {
  const w = origen.width;
  const h = origen.height;
  const swapped = rotation === 90 || rotation === 270;
  const canvas = new OffscreenCanvas(swapped ? h : w, swapped ? w : h);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = "high";
  if (rotation !== 0) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(origen, -w / 2, -h / 2);
    ctx.restore();
  } else {
    ctx.drawImage(origen, 0, 0);
  }
  return canvas;
}

// ── GEMELO: cropQuad (image-processor.ts L1187) — recorte bbox + rotación,
//    último recurso cuando la homografía es degenerada (warp null).
function cropQuadCanvas(
  fuente: { data: Uint8ClampedArray; sw: number; sh: number },
  quad: number[],
  rotation: number,
  maxSize: number
): OffscreenCanvas {
  const { sw, sh } = fuente;
  const xs = [0, 2, 4, 6].map((i) => quad[i]! * sw);
  const ys = [0, 2, 4, 6].map((i) => quad[i + 1]! * sh);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const w = Math.max(16, right - left);
  const h = Math.max(16, bottom - top);
  const scale = Math.min(1, maxSize / Math.max(w, h));

  const swapped = rotation === 90 || rotation === 270;
  const canvas = new OffscreenCanvas(
    Math.round(swapped ? h * scale : w * scale),
    Math.round(swapped ? w * scale : h * scale)
  );
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  // Scale uniforme tras la rotación (bug E6 del espejado — comentario gemelo).
  ctx.scale(scale, scale);
  const completo = canvasDePixeles({ data: fuente.data, w: fuente.sw, h: fuente.sh });
  ctx.drawImage(completo, -left, -top, w, h, -w / 2, -h / 2, w, h);
  ctx.restore();
  return canvas;
}

/** Gemelo de `applyFilterToCanvas` (image-processor.ts L1229) — MISMAS
 *  funciones puras de image-modes (unsharp ANTES del filtro en modo ≠
 *  raw/text; contrato §4.2, error #7). */
function aplicarFiltroAPixeles(
  canvas: OffscreenCanvas,
  filter: string
): void {
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 1 || H < 1) return;
  const mode = filtroAModo(filter);
  const image = ctx.getImageData(0, 0, W, H);
  let d: Uint8ClampedArray = image.data;
  if (mode !== "raw" && mode !== "text") {
    d = unsharpRgba(d, W, H); // §8: unsharp ANTES del filtro
  }
  const out = enhanceToRgba(d, W, H, mode);
  const dest = ctx.createImageData(W, H);
  dest.data.set(out);
  ctx.putImageData(dest, 0, 0);
}

/** Pipeline completo del fallback DENTRO del worker. Jamás lanza: todo error
 *  sale como `{ok:false}` (red line del kit). */
async function procesar(p: PeticionFallback): Promise<RespuestaFallback> {
  try {
    const fuente = pixelesDe(p.bitmap);
    const warp = warpQuadAPixeles(fuente, p.quad, p.maxLongSide);
    let canvas: OffscreenCanvas;
    if (warp !== null) {
      canvas = rotarCanvas(canvasDePixeles(warp), p.rotation);
    } else {
      canvas = cropQuadCanvas(fuente, p.quad, p.rotation, p.maxLongSide); // último recurso bbox
    }
    aplicarFiltroAPixeles(canvas, p.filter);
    // R-10: los 3 filtros del producto salen PNG (sin ringing sobre tinta) —
    // mismo mime que la ruta local (canvasToDataURL(canvas, "image/png")).
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { id: p.id, ok: true, png, ancho: canvas.width, alto: canvas.height };
  } catch (e) {
    return {
      id: p.id,
      ok: false,
      error: e instanceof Error ? e.message : "fallo del fallback canvas",
    };
  }
}

/** Cableado del mensaje — SOLO en un entorno de worker real (el worker se
 *  importa desde tests como módulo puro; mismo guard del capa0-qr.worker).
 *  El Blob viaja por structured clone (no es transferible); el bitmap ya fue
 *  cerrado en pixelesDe — nada más que devolver. */
if (typeof window === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e: MessageEvent<PeticionFallback>) => {
    void procesar(e.data).then((respuesta: RespuestaFallback) => {
      self.postMessage(respuesta);
    });
  };
}
