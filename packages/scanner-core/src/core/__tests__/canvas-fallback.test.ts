/**
 * KIT e14-fallback-canvas-v1 — anclas del FALLBACK canvas del core
 * (Ola 2 §2.3 paso 3: `image-processor.ts` medía 6,4 % y tenía 0 tests
 * directos; el fallback de R2 era la zona sin test).
 *
 * QUÉ se ancla: `processImage` SIN worker OpenCV — en Node `window` no existe
 * → `getScannerWorker()` devuelve null → `processImagePrecise` devuelve null —
 * cae SIEMPRE al pipeline canvas local: warp por homografía + muestreo
 * BILINEAL (`warpQuadToCanvas`), rotación post-warp, filtro compartido de
 * image-modes (el modo "original" = raw es paso puro con alpha 255) y el
 * contrato `precision.engine === "canvas"`. Ese fallback es la red de
 * seguridad del producto («la app NUNCA se rompe»): si alguien rompe la
 * homografía, el muestreo o la rotación, aquí se pone rojo aunque el worker
 * siga pareciendo sano.
 *
 * CÓMO sin DOM: stubs MÍNIMOS de `document`/`Image`/canvas 2D dentro de este
 * archivo (el fuente NO se toca). El stub de canvas implementa solo lo que el
 * fallback usa: drawImage (formas de 2/4/8 args con la CTM real), getImageData,
 * putImageData, createImageData, save/restore/translate/rotate/scale,
 * toDataURL (base64 de los píxeles reales → permite asertar CONTENIDO) y
 * toBlob(null) — que fuerza el camino toDataURL de `canvasToDataURL`, la caída
 * documentada del propio código (error #22, Safari/iOS).
 *
 * Imagen sintética 64×64 (y 64×32 para la rotación): mitad izquierda negra,
 * mitad derecha blanca — la frontera vertical es la regla con la que se mide
 * homografía, escala y rotación.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { processImage } from "../image-processor";
import type { Quad } from "../types";

// ── Stubs mínimos (solo lo que el fallback canvas toca) ────────────────────

/** Registro de imágenes sintéticas: la `src` de `new Image()` es una clave. */
const RECURSOS = new Map<
  string,
  { w: number; h: number; pinta: (x: number, y: number) => [number, number, number] }
>();

class ImagenFake {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  pixeles = new Uint8ClampedArray(0);

  set src(valor: string) {
    const rec = RECURSOS.get(valor);
    if (!rec) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    this.naturalWidth = rec.w;
    this.naturalHeight = rec.h;
    this.width = rec.w;
    this.height = rec.h;
    const px = new Uint8ClampedArray(rec.w * rec.h * 4);
    for (let y = 0; y < rec.h; y++) {
      for (let x = 0; x < rec.w; x++) {
        const [r, g, b] = rec.pinta(x, y);
        const i = (y * rec.w + x) * 4;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = 255;
      }
    }
    this.pixeles = px;
    queueMicrotask(() => this.onload?.());
  }

  get src(): string {
    return "";
  }
}

class CanvasFake {
  private ancho = 0;
  private alto = 0;
  private contexto: ContextoFake | null = null;
  pixeles = new Uint8ClampedArray(0);

  get width(): number {
    return this.ancho;
  }

  set width(v: number) {
    this.ancho = v;
    this.pixeles = new Uint8ClampedArray(v * this.alto * 4);
  }

  get height(): number {
    return this.alto;
  }

  set height(v: number) {
    this.alto = v;
    this.pixeles = new Uint8ClampedArray(this.ancho * v * 4);
  }

  getContext(_tipo: "2d", _opts?: { willReadFrequently?: boolean }): ContextoFake {
    if (!this.contexto) this.contexto = new ContextoFake(this);
    return this.contexto;
  }

  /** Igual que el real ante un Blob nulo: `canvasToDataURL` cae a toDataURL. */
  toBlob(cb: (b: Blob | null) => void, _mime?: string, _calidad?: number): void {
    cb(null);
  }

  toDataURL(mime = "image/png"): string {
    return `data:${mime};base64,${Buffer.from(this.pixeles).toString("base64")}`;
  }
}

/** Contexto 2D con CTM afín real (translate/rotate/scale/save/restore) y
 *  drawImage por re-muestreo vecino — suficiente para anclar el fallback. */
class ContextoFake {
  imageSmoothingQuality = "high";
  private a = 1;
  private b = 0;
  private c = 0;
  private d = 1;
  private e = 0;
  private f = 0;
  private pila: Array<[number, number, number, number, number, number]> = [];

  constructor(private canvas: CanvasFake) {}

  save(): void {
    this.pila.push([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  restore(): void {
    const t = this.pila.pop();
    if (t) [this.a, this.b, this.c, this.d, this.e, this.f] = t;
  }

  translate(x: number, y: number): void {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
  }

  scale(x: number, y: number): void {
    this.a *= x;
    this.b *= x;
    this.c *= y;
    this.d *= y;
  }

  rotate(rad: number): void {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const { a, b, c, d } = this;
    this.a = a * cos + c * sin;
    this.b = b * cos + d * sin;
    this.c = c * cos - a * sin;
    this.d = d * cos - b * sin;
  }

  drawImage(fuente: ImagenFake | CanvasFake, ...args: number[]): void {
    const swFuente = fuente instanceof ImagenFake ? fuente.naturalWidth : fuente.width;
    const shFuente = fuente instanceof ImagenFake ? fuente.naturalHeight : fuente.height;
    const px = fuente.pixeles;
    let sx = 0;
    let sy = 0;
    let sw = swFuente;
    let sh = shFuente;
    let dx = 0;
    let dy = 0;
    let dw = swFuente;
    let dh = shFuente;
    if (args.length === 2) {
      dx = args[0]!;
      dy = args[1]!;
    } else if (args.length === 4) {
      dx = args[0]!;
      dy = args[1]!;
      dw = args[2]!;
      dh = args[3]!;
    } else {
      sx = args[0]!;
      sy = args[1]!;
      sw = args[2]!;
      sh = args[3]!;
      dx = args[4]!;
      dy = args[5]!;
      dw = args[6]!;
      dh = args[7]!;
    }
    const det = this.a * this.d - this.b * this.c;
    if (det === 0 || dw === 0 || dh === 0) return;
    // Inversa de la CTM: device → espacio de usuario.
    const ia = this.d / det;
    const ib = -this.b / det;
    const ic = -this.c / det;
    const id = this.a / det;
    const ie = (this.c * this.f - this.d * this.e) / det;
    const iff = (this.b * this.e - this.a * this.f) / det;
    // Caja del rect destino por la CTM → píxeles de destino a visitar.
    const W = this.canvas.width;
    const H = this.canvas.height;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [ex, ey] of [
      [dx, dy],
      [dx + dw, dy],
      [dx + dw, dy + dh],
      [dx, dy + dh],
    ]) {
      const px2 = this.a * ex! + this.c * ey! + this.e;
      const py2 = this.b * ex! + this.d * ey! + this.f;
      minX = Math.min(minX, px2);
      minY = Math.min(minY, py2);
      maxX = Math.max(maxX, px2);
      maxY = Math.max(maxY, py2);
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(H - 1, Math.ceil(maxY));
    const destino = this.canvas.pixeles;
    for (let Y = y0; Y <= y1; Y++) {
      for (let X = x0; X <= x1; X++) {
        const xc = X + 0.5;
        const yc = Y + 0.5;
        const ux = ia * xc + ic * yc + ie;
        const uy = ib * xc + id * yc + iff;
        const su = sx + (ux - dx) * (sw / dw);
        const sv = sy + (uy - dy) * (sh / dh);
        if (su < 0 || su >= sw || sv < 0 || sv >= sh) continue;
        const fx = Math.min(swFuente - 1, Math.floor(su));
        const fy = Math.min(shFuente - 1, Math.floor(sv));
        const iD = (Y * W + X) * 4;
        const iF = (fy * swFuente + fx) * 4;
        destino[iD] = px[iF]!;
        destino[iD + 1] = px[iF + 1]!;
        destino[iD + 2] = px[iF + 2]!;
        destino[iD + 3] = px[iF + 3]!;
      }
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  } {
    const out = new Uint8ClampedArray(sw * sh * 4);
    const origen = this.canvas.pixeles;
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const fx = sx + x;
        const fy = sy + y;
        if (fx < 0 || fx >= W || fy < 0 || fy >= H) continue;
        const iD = (y * sw + x) * 4;
        const iF = (fy * W + fx) * 4;
        out[iD] = origen[iF]!;
        out[iD + 1] = origen[iF + 1]!;
        out[iD + 2] = origen[iF + 2]!;
        out[iD + 3] = origen[iF + 3]!;
      }
    }
    return { data: out, width: sw, height: sh };
  }

  putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number): void {
    const destino = this.canvas.pixeles;
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const fx = dx + x;
        const fy = dy + y;
        if (fx < 0 || fx >= W || fy < 0 || fy >= H) continue;
        const iD = (fy * W + fx) * 4;
        const iF = (y * img.width + x) * 4;
        destino[iD] = img.data[iF]!;
        destino[iD + 1] = img.data[iF + 1]!;
        destino[iD + 2] = img.data[iF + 2]!;
        destino[iD + 3] = img.data[iF + 3]!;
      }
    }
  }

  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
}

const documentFake = {
  createElement(tag: string): CanvasFake {
    if (tag !== "canvas") throw new Error(`stub del fallback: createElement(${tag}) no soportado`);
    return new CanvasFake();
  },
};

// ── Instalación de los stubs (solo dentro de esta suite) ───────────────────

const g = globalThis as unknown as {
  Image?: unknown;
  HTMLImageElement?: unknown;
  document?: unknown;
};
const globalesOriginales = {
  Image: g.Image,
  HTMLImageElement: g.HTMLImageElement,
  document: g.document,
};

beforeAll(() => {
  RECURSOS.set("mem://mitades-64", {
    w: 64,
    h: 64,
    pinta: (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]),
  });
  RECURSOS.set("mem://mitades-64x32", {
    w: 64,
    h: 32,
    pinta: (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255]),
  });
  g.Image = ImagenFake;
  // `bitmapToRotatedCanvas` distingue la fuente con `instanceof HTMLImageElement`
  g.HTMLImageElement = ImagenFake;
  g.document = documentFake;
});

afterAll(() => {
  RECURSOS.clear();
  g.Image = globalesOriginales.Image;
  g.HTMLImageElement = globalesOriginales.HTMLImageElement;
  g.document = globalesOriginales.document;
});

// ── Helpers de aserción de contenido ───────────────────────────────────────

/** Decodifica el payload base64 de un data URL del stub (RGBA crudo). */
function decodificarRgba(dataUrl: string): Uint8ClampedArray {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const px = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  return px;
}

const canal = (px: Uint8ClampedArray, x: number, y: number, ancho: number): number =>
  px[(y * ancho + x) * 4] ?? -1;

const alfa = (px: Uint8ClampedArray, x: number, y: number, ancho: number): number =>
  px[(y * ancho + x) * 4 + 3] ?? -1;

const QUAD_COMPLETO: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe("fallback canvas de processImage (sin worker OpenCV)", () => {
  it("quad completo sin rotación: homografía identidad preserva el contenido y reporta engine 'canvas'", async () => {
    const res = await processImage("mem://mitades-64", QUAD_COMPLETO, "original");

    // Contrato de precisión del fallback (NO del worker):
    expect(res.precision?.engine).toBe("canvas");
    expect(res.precision?.refined).toBe(false);
    expect(res.precision?.cornersSolid).toBeNull();
    expect(res.precision?.width).toBe(64);
    expect(res.precision?.height).toBe(64);
    expect(res.decodeMs).toBeUndefined(); // decodeMs es SOLO del camino worker

    // processed (PNG, R-10) y thumbnail salen como data URLs no vacías.
    expect(res.processed.startsWith("data:image/png;base64,")).toBe(true);
    expect(res.thumbnail.startsWith("data:")).toBe(true);
    expect(res.thumbnail.length).toBeGreaterThan("data:".length);

    // CONTENIDO: el modo "original" (= raw) no toca píxeles; el warp bilinear
    // con centros de píxel mantiene las mitades y promedia en la frontera.
    const px = decodificarRgba(res.processed);
    expect(px.length).toBe(64 * 64 * 4);
    expect(alfa(px, 8, 32, 64)).toBe(255);
    expect(canal(px, 8, 32, 64)).toBeLessThanOrEqual(2); // izquierda negra
    expect(canal(px, 56, 32, 64)).toBeGreaterThanOrEqual(253); // derecha blanca
    const borde = canal(px, 31, 32, 64); // col 31: 0.5·negro + 0.5·blanco ≈ 128
    expect(borde).toBeGreaterThan(100);
    expect(borde).toBeLessThan(160);
  });

  it("maxLongSide escala la salida y NUNCA upscaula (R-02): 64→32 con tope 32; piso de 16 con tope 8", async () => {
    const medio = await processImage("mem://mitades-64", QUAD_COMPLETO, "original", 0, {
      maxLongSide: 32,
    });
    expect(medio.precision?.engine).toBe("canvas");
    expect(medio.precision?.width).toBe(32);
    expect(medio.precision?.height).toBe(32);
    const pxMedio = decodificarRgba(medio.processed);
    expect(canal(pxMedio, 8, 16, 32)).toBeLessThanOrEqual(2);
    expect(canal(pxMedio, 24, 16, 32)).toBeGreaterThanOrEqual(253);

    const piso = await processImage("mem://mitades-64", QUAD_COMPLETO, "original", 0, {
      maxLongSide: 8,
    });
    expect(piso.precision?.width).toBe(16); // Math.max(16, …) — piso del warp
    expect(piso.precision?.height).toBe(16);
  });

  it("rotación 90: dims intercambiadas (64×32 → 32×64) y el split vertical pasa a horizontal", async () => {
    const res = await processImage("mem://mitades-64x32", QUAD_COMPLETO, "original", 90);
    expect(res.precision?.engine).toBe("canvas");
    expect(res.precision?.width).toBe(32);
    expect(res.precision?.height).toBe(64);
    const px = decodificarRgba(res.processed);
    expect(canal(px, 8, 8, 32)).toBeLessThanOrEqual(2); // mitad superior negra
    expect(canal(px, 24, 8, 32)).toBeLessThanOrEqual(2);
    expect(canal(px, 8, 56, 32)).toBeGreaterThanOrEqual(253); // mitad inferior blanca
    expect(canal(px, 24, 56, 32)).toBeGreaterThanOrEqual(253);
  });

  it("quad degenerado (más fino que 1 px): warp null → recorte bbox (último recurso), nunca basura", async () => {
    // OJO (hallazgo de este test): ni un quad colineal (3 esquinas en línea)
    // ni una esquina DUPLICADA activan el null del resolvedor de forma
    // determinista — la eliminación gaussiana con pivoteo fraccional puede
    // "resolver" el sistema singular por redondeo y devolver un warp
    // estirado-plausible. El null SÍ es determinista por el guard de tamaño
    // (w0/h0 ≤ 1): las dos esquinas de un lado casi coinciden → null →
    // cropQuad. Contrato observable: quad roto → bbox, nunca crash ni vacío.
    const quadRoto: Quad = [
      { x: 0, y: 0 },
      { x: 0.01, y: 0 }, // a 0,64 px de la TL → w0 = 0,64 ≤ 1 → warp null
      { x: 1, y: 1 },
      { x: 0.99, y: 1 },
    ];
    const res = await processImage("mem://mitades-64", quadRoto, "original");
    expect(res.precision?.engine).toBe("canvas");
    // cropQuad (último recurso): bbox del quad = 64×64 — contenido real, no
    // canvas vacío: mitad izquierda negra, mitad derecha blanca.
    expect(res.precision?.width).toBe(64);
    expect(res.precision?.height).toBe(64);
    const px = decodificarRgba(res.processed);
    expect(canal(px, 8, 32, 64)).toBeLessThanOrEqual(2);
    expect(canal(px, 56, 32, 64)).toBeGreaterThanOrEqual(253);
  });
});
