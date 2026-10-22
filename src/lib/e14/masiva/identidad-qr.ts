/**
 * KIT e63m-capa0-qr-identidad-v1 — CAPA 0: IDENTIDAD QR PRE-OCR (F1/F2).
 *
 * El QR del E-14 es DATO LEÍDO, no imagen: dos fotos del MISMO papel
 * producen el MISMO payload byte-a-byte aunque el dhash no pueda separarlas
 * (banco #72 — GO medido del dueño: 88.2% decode, 0 colisiones, re-encodes
 * dhash 8-33 agrupan por payload EXACTO; la separación criptográfica del
 * peligro dhash: par estilo G2/G4 con prefijo de 21 chars común y payload
 * DISTINTO no agrupa — sin zona de falso positivo). Esta capa corre ANTES de
 * despachar OCR en el runner (punto ÚNICO §1.2): gemela por QR = reutiliza
 * el desenlace del original y el OCR (24-39 s) JAMÁS se paga.
 *
 * Con este GO, la Etapa 3 del plan e63g-e63h (§2.1 matcher rotación-
 * invariante / §2.2 re-chequeo) queda SUSTITUIDA por e63m. El dhash NO se
 * toca (HAMMING_MAX=6 byte-idéntico — dedup.ts intacto).
 *
 * ─── KIT e64-qr-v1 · T-PRE — RECONSTRUCCIÓN DECLARADA ───────────────────
 * El kit e64 y su doc hermano (INSTRUCCIONES-qr-diagnostico-y-rescate-v1,
 * §1 «Mapa del sistema QR — arquitectura REAL verificada línea a línea»)
 * presuponen el estado e63n (`9e45dc9`) que NUNCA llegó al remoto (main
 * real f8ec6a9 = e63m; el commit no existe ni en ramas ni en PRs — API
 * verificada). Esta superficie de e63n se reconstruye aquí con la ÚNICA
 * fuente disponible (doc hermano §1) y queda declarada en
 * docs/REPORTE-e64-qr-v1.md §desviaciones:
 *   2. ladderBaseDePixeles     — A (100%) → B (top-left 45%×25%) →
 *                                C (8-38%×5-20%) → C1.5 (C up-escalado ×1.5)
 *   3. barridoQrDePixeles      — grilla de ventanas cuadradas por cuadrante
 *                                [TL→TR→BL→BR] × BARRIDO_VENTANAS
 *                                [0.11,0.14,0.19,0.25] × paso 0.5 — jsQR
 *                                attemptBoth por ventana
 *   4. barridoQrZxingDePixeles — misma grilla, zxing-wasm 3.1.6,
 *                                binarizadores GlobalHistogram→LocalAverage,
 *                                presupuesto 4 000 ms
 *                                (ZXING_BARRIDO_PRESUPUESTO_MS), wasm
 *                                servido LOCAL desde public/wasm/
 *                                zxing_reader.wasm vía
 *                                setZXingModuleOverrides({ locateFile })
 *                                con base `${NEXT_PUBLIC_BASE_PATH}/wasm/`
 *   5. tier ROTACIÓN           — A rotada 90°→180°→270° (última)
 *   → early-exit al primer payload · JAMÁS throw · trazaQr
 *     `[e14] qr-capa0 tier=base|barrido|zxing|rotacion90|…|null ms=…`
 * Los contratos e63m quedan equivalentes: ladderQrDePixeles (base +
 * rotación — el QA headless 48/48 lo ejercita), espera APLAZADA acotada,
 * qrCorto, vendor jsQR byte-idéntico.
 *
 * RED LINES (kit e63m §3 + e64 §7):
 * · 5 — Dedup jamás inventa: la llave es la IGUALDAD EXACTA de payload
 *   (sin umbrales, sin fuzzy, sin prefijos). Fallback sagrado:
 *   reutilizarResultado→false→pipeline completo. PROCESAR IGUAL manda.
 * · 10 — qrPayload es llave OPACA: NO se parsea, NO se invierte, NO se
 *   compara por prefijos (el prefijo de 21 chars es observación
 *   estructural del banco, jamás lógica de decisión).
 * · 9 — jsQR 1.4.0 VENDIDO byte-idéntico al de #72 (vendor/jsQR.js);
 *   BarcodeDetector nativo PROHIBIDO (determinismo entre máquinas).
 * · e64 §7-4 — La CAPA 0 jamás throw hacia el runner/pipeline: cualquier
 *   falla = null = flujo normal.
 * · e64 §7-6 — Sin timers globales: promesas acotadas + parámetros
 *   inyectables (el presupuesto del barrido zxing es reló local).
 */
import jsQR from "./vendor/jsQR.js";
import type { Binarizer, ReaderOptions } from "zxing-wasm/reader";
import type { EstadoEntrada } from "./tipos";

// ─── Constantes NUEVAS del kit e63m §1.1 (separadas de las existentes) ──────
/** Lado largo MÁXIMO del canvas de trabajo (kit §1.1 — igual que el banco:
 *  el thumb 320 del dhash es DEMASIADO PEQUEÑO para el QR). */
export const QR_LADO_LARGO = 2048;
/** Bandas del ladder — fracciones EXACTAS del banco (#72 bench.html). */
interface EspecieBanda {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  escala: number;
}
const BANDAS_BASE: EspecieBanda[] = [
  { id: "A", x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0, escala: 1 }, // imagen completa
  { id: "B", x0: 0.0, y0: 0.0, x1: 0.45, y1: 0.25, escala: 1 }, // banda top-left
  { id: "C", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1 }, // banda ajustada
  { id: "C1.5", x0: 0.08, y0: 0.05, x1: 0.38, y1: 0.2, escala: 1.5 }, // reintento up-escalado
];
const BANDA_A = BANDAS_BASE[0]!; // floor del tier de rotación (A completa)

/** Ladder BASE en orden (kit §1.1 — byte-idéntico al banco): A imagen
 *  completa → B banda top-left → C banda ajustada → C×1.5 up-escalado. */
export const QR_INTENTOS_BASE: readonly string[] = BANDAS_BASE.map((b) => b.id);
/** Tier de rotación (kit §1.1): SOLO si el ladder base falla — A completa
 *  @90°→@180°→@270° (evidencia del banco: el QR CAMBIA de esquina al rotar
 *  — durazno1 solo decodifica con A@90°; repetir bandas finas sobre el
 *  rotado no sirve, la imagen completa sí). */
export const QR_ROTACIONES: readonly number[] = [90, 180, 270];
/** Espera acotada del caso «original en vuelo» (kit §1.1/§1.2.4): intervalo
 *  × intentos = techo efectivo de 15 s. Re-chequeo SOLO-LECTURA del estado
 *  del original; sin timers globales. */
export const QR_ESPERA_INTERVALO_MS = 1_500;
export const QR_ESPERA_INTENTOS = 10;

// ─── e63n (T-PRE) — constantes del BARRIDO y del tier ZXING ────────────────
/** Fracciones de ventana del barrido ceñido (doc hermano §1: grilla por
 *  cuadrante × fracciones [0.11,0.14,0.19,0.25] — el QR de campo mide
 *  ~5-8% del ancho y la ventana ganadora lo llena al 38-55%; T-1.3 del e64
 *  extiende esta lista). Cada fracción es del ANCHO del canvas de trabajo. */
export const BARRIDO_VENTANAS: readonly number[] = [0.11, 0.14, 0.19, 0.25];
/** Presupuesto de reló del barrido zxing (doc hermano §1: 4 000 ms — el
 *  barrido jsQR NO tiene reló: es puro y acotado por nº de ventanas). */
export const ZXING_BARRIDO_PRESUPUESTO_MS = 4_000;
/** Binarizadores del barrido zxing en orden (doc hermano §1:
 *  GlobalHistogram→LocalAverage — el banco #77 midió GlobalHistogram ganando
 *  en blur y LocalAverage en nítidas). */
export const ZXING_BINARIZADORES: readonly Binarizer[] = [
  "GlobalHistogram",
  "LocalAverage",
];
/** El E-14 usa QR — restringir el simbolismo acelera cada ventana del
 *  barrido (micro-decisión declarada: el formato es dato del dominio). */
export const ZXING_FORMATO = "QRCode" as const;

/** Fuente de píxeles RGBA — la MISMA forma que devuelve getImageData
 *  (canal a canal, 4 bytes por píxel, fila por fila). */
export interface PixelesQr {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Estado del original para la espera acotada — EstadoEntrada + AUSENTE
 *  (la fila fue quitada/vaciada mientras se esperaba). */
export type EstadoOriginalQr = EstadoEntrada | "AUSENTE";

// ─── Núcleo puro: UN intento de decode sobre UNA banda ──────────────────────
/** Semántica EXACTA del intentoDecode del banco: banda fuente redondeada
 *  (sw/sh), destino = banda × escala (dw/dh), jsQR con attemptBoth, payload
 *  EXACTO tal cual sale. escala=1 → copia 1:1 (idéntica al drawImage del
 *  banco); escala>1 → remuestreo bilinear (misma intención del smoothing
 *  del banco — única diferencia microscópica vs drawImage del navegador,
 *  declarada en el REPORTE: C1.5 es el 4.º intento del ladder, el floor del
 *  tier de rotación es A a escala 1 EXACTO). */
function intentoSobrePixeles(cv: PixelesQr, esp: EspecieBanda): string | null {
  try {
    const sx = Math.round(cv.width * esp.x0);
    const sy = Math.round(cv.height * esp.y0);
    const sw = Math.max(1, Math.round(cv.width * (esp.x1 - esp.x0)));
    const sh = Math.max(1, Math.round(cv.height * (esp.y1 - esp.y0)));
    const dw = Math.max(1, Math.round(sw * esp.escala));
    const dh = Math.max(1, Math.round(sh * esp.escala));
    const data = new Uint8ClampedArray(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const di = (y * dw + x) * 4;
        if (esp.escala === 1) {
          // Copia 1:1 EXACTA de la banda (el drawImage del banco con
          // destino = tamaño fuente es idéntico píxel a píxel).
          const sxi = Math.min(cv.width - 1, sx + x);
          const syi = Math.min(cv.height - 1, sy + y);
          const si = (syi * cv.width + sxi) * 4;
          data[di] = cv.data[si]!;
          data[di + 1] = cv.data[si + 1]!;
          data[di + 2] = cv.data[si + 2]!;
          data[di + 3] = cv.data[si + 3]!;
        } else {
          // Remuestreo bilinear del up-escalado (mismas fracciones/rounding).
          const fx = Math.min(cv.width - 1, Math.max(0, (x + 0.5) * (sw / dw) - 0.5 + sx));
          const fy = Math.min(cv.height - 1, Math.max(0, (y + 0.5) * (sh / dh) - 0.5 + sy));
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const x1 = Math.min(cv.width - 1, x0 + 1);
          const y1 = Math.min(cv.height - 1, y0 + 1);
          const tx = fx - x0;
          const ty = fy - y0;
          const i00 = (y0 * cv.width + x0) * 4;
          const i10 = (y0 * cv.width + x1) * 4;
          const i01 = (y1 * cv.width + x0) * 4;
          const i11 = (y1 * cv.width + x1) * 4;
          for (let c = 0; c < 4; c++) {
            const arriba = cv.data[i00 + c]! * (1 - tx) + cv.data[i10 + c]! * tx;
            const abajo = cv.data[i01 + c]! * (1 - tx) + cv.data[i11 + c]! * tx;
            data[di + c] = arriba * (1 - ty) + abajo * ty;
          }
        }
      }
    }
    const res = jsQR(data, dw, dh, { inversionAttempts: "attemptBoth" });
    return res ? res.data : null;
  } catch {
    return null; // un intento jamás tumba el ladder
  }
}

/** Rotación EXACTA de 90° horaria (permutación de píxeles — para múltiplos
 *  de 90° el canvasRotado del banco es la MISMA permutación, sin
 *  interpolación). Rotaciones compuestas: siempre DESDE la fuente (el banco
 *  rota el canvas de trabajo original para cada grados). */
function rotar90Pixeles(src: PixelesQr): PixelesQr {
  const w = src.width;
  const h = src.height;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      // dst(x' = h-1-y, y' = x) — dst width = h, dst height = w.
      const di = (x * h + (h - 1 - y)) * 4;
      data[di] = src.data[si]!;
      data[di + 1] = src.data[si + 1]!;
      data[di + 2] = src.data[si + 2]!;
      data[di + 3] = src.data[si + 3]!;
    }
  }
  return { data, width: h, height: w };
}

function rotarPixeles(src: PixelesQr, grados: number): PixelesQr {
  let actual = src;
  for (let k = 0; k < grados / 90; k++) actual = rotar90Pixeles(actual);
  return actual;
}

/**
 * Ladder BASE sobre píxeles (T-PRE — refactor del bucle del kit §1.1):
 * A imagen completa → B banda top-left → C banda ajustada → C1.5
 * up-escalado, early-exit al primer payload. El tier de ROTACIÓN NO está
 * aquí (quedó en ladderQrDePixeles — e63m/QA intacto — y en la cadena
 * completa decodificarQrDePixeles como ÚLTIMO tier, doc hermano §1).
 * Puro — testeable headless.
 */
export function ladderBaseDePixeles(pix: PixelesQr): string | null {
  for (const esp of BANDAS_BASE) {
    const payload = intentoSobrePixeles(pix, esp);
    if (payload != null) return payload; // early-exit al primer payload
  }
  return null;
}

/**
 * Ladder COMPLETO e63m sobre píxeles (kit §1.1): base A→B→C→C1.5 con
 * early-exit al primer payload; tier de rotación SOLO si el base falla
 * (A@90→A@180→A@270, early-exit ídem). null si nada decodifica. Puro —
 * el QA headless lo ejercita con matrices QR reales (contrato e63m
 * byte-equivalente: mismo conjunto de intentos en el mismo orden).
 */
export function ladderQrDePixeles(pix: PixelesQr): string | null {
  const base = ladderBaseDePixeles(pix);
  if (base != null) return base;
  for (const grados of QR_ROTACIONES) {
    const payload = intentoSobrePixeles(rotarPixeles(pix, grados), BANDA_A);
    if (payload != null) return payload;
  }
  return null;
}

// ─── e63n (T-PRE) — BARRIDO CEÑIDO (grilla de ventanas por cuadrante) ──────
/** Cuadrantes del barrido EN ORDEN (doc hermano §1: TL→TR→BL→BR). La
 *  frontera cae en floor(lado/2) — las ventanas NUNCA cruzan cuadrantes. */
interface Cuadrante {
  id: string;
  x0: number; // fracción del ancho donde empieza
  y0: number; // fracción del alto donde empieza
  x1: number; // fracción del ancho donde termina
  y1: number; // fracción del alto donde termina
}
const CUADRANTES: Cuadrante[] = [
  { id: "TL", x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
  { id: "TR", x0: 0.5, y0: 0, x1: 1, y1: 0.5 },
  { id: "BL", x0: 0, y0: 0.5, x1: 0.5, y1: 1 },
  { id: "BR", x0: 0.5, y0: 0.5, x1: 1, y1: 1 },
];

/** Límites EN PÍXELES de un cuadrante (frontera en floor — micro-decisión
 *  declarada: sin solapes entre cuadrantes, coberturas exactas). */
function limitesDeCuadrante(
  pix: PixelesQr,
  q: Cuadrante,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.round(pix.width * q.x0),
    y0: Math.round(pix.height * q.y0),
    x1: Math.round(pix.width * q.x1),
    y1: Math.round(pix.height * q.y1),
  };
}

/** Ventana cuadrada CLAMPADA a la imagen (T-PRE — la usa el barrido y el
 *  filo del cuadrante de T-1.0): clampea origen y lado, JAMÁS inventa
 *  píxeles (copia fila a fila del buffer fuente). null si el lado pedido
 *  excede la imagen (nada que decodificar ahí). */
export function ventanaDePixeles(
  pix: PixelesQr,
  x: number,
  y: number,
  lado: number,
): PixelesQr | null {
  const ladoX = Math.min(lado, pix.width);
  const ladoY = Math.min(lado, pix.height);
  if (ladoX < 1 || ladoY < 1) return null;
  const x0 = Math.min(Math.max(0, Math.round(x)), pix.width - ladoX);
  const y0 = Math.min(Math.max(0, Math.round(y)), pix.height - ladoY);
  const data = new Uint8ClampedArray(ladoX * ladoY * 4);
  for (let yy = 0; yy < ladoY; yy++) {
    const si = ((y0 + yy) * pix.width + x0) * 4;
    data.set(
      pix.data.subarray(si, si + ladoX * 4),
      yy * ladoX * 4,
    );
  }
  return { data, width: ladoX, height: ladoY };
}

/** UN intento jsQR sobre UNA ventana (attemptBoth — la inversión la cubre
 *  aquí, no en el tier zxing). Jamás throw (red line e64 §7-4). */
export function jsQrDeVentana(win: PixelesQr): string | null {
  try {
    const res = jsQR(win.data, win.width, win.height, {
      inversionAttempts: "attemptBoth",
    });
    return res ? res.data : null;
  } catch {
    return null;
  }
}

/** Lado EN PÍXELES de la ventana de UNA fracción (micro-decisión declarada:
 *  fracción del ANCHO — el doc hermano H-6 mide el QR «~5-8% del ancho» y
 *  calibra las fracciones contra esa magnitud). */
function ladoDeVentana(pix: PixelesQr, fraccion: number): number {
  return Math.max(16, Math.round(pix.width * fraccion));
}

/**
 * BARRIDO CEÑIDO jsQR (doc hermano §1.3): grilla de ventanas cuadradas por
 * cuadrante [TL→TR→BL→BR] × BARRIDO_VENTANAS × paso 0.5 (solape de media
 * ventana — micro-decisión declarada), jsQR attemptBoth por ventana,
 * early-exit al primer payload. Puro, sin reló (acotado por nº de
 * ventanas — el reló de 4 s es del tier zxing). T-1.0 del e64 añadió la
 * celda final anclada al filo inferior-derecho de cada cuadrante (doc
 * hermano H-5 — la franja de hasta `paso` px que la condición `+ lado <=`
 * dejaba descubierta).
 */
export function barridoQrDePixeles(pix: PixelesQr): string | null {
  for (const q of CUADRANTES) {
    const lim = limitesDeCuadrante(pix, q);
    for (const fraccion of BARRIDO_VENTANAS) {
      const lado = ladoDeVentana(pix, fraccion);
      const paso = Math.max(1, Math.round(lado * 0.5));
      for (let y = lim.y0; y + lado <= lim.y1; y += paso) {
        for (let x = lim.x0; x + lado <= lim.x1; x += paso) {
          const win = ventanaDePixeles(pix, x, y, lado);
          if (!win) continue;
          const payload = jsQrDeVentana(win);
          if (payload != null) return payload;
        }
      }
      // e64-qr T-1.0 — celda final del cuadrante: la condición `+ lado <=`
      // deja una franja descubierta de hasta `paso` px en el filo
      // derecho/inferior (doc hermano H-5); este anclaje la cubre (el clamp
      // de ventanaDePixeles ya existe — jamás inventa píxeles).
      const winFilo = ventanaDePixeles(pix, lim.x1 - lado, lim.y1 - lado, lado);
      const payloadFilo = winFilo ? jsQrDeVentana(winFilo) : null;
      if (payloadFilo != null) return payloadFilo;
    }
  }
  return null;
}

// ─── e64-qr T-1.1 · NITIDEZ (unsharp 3×3) ──────────────────────────────
/** Máscara de enfoque sobre RGBA: salida = clamp(orig + k·(orig − blur3×3)).
 *  Motivo (doc hermano R-1): el remuestreo a ≤2048 suaviza módulos de ~3-8 px
 *  — jsQR binariza mejor con filos (evidencia banco #77: motion blur en el
 *  filo del decode). Pura, sin DOM, sin throw: bordes intactos (y,x ∈
 *  [1,extremo-1] — el marco de 1 px no aporta al decode, el QR nunca vive
 *  pegado al filo ABSOLUTO de la foto). Uint8ClampedArray clampea solo. */
export const NITIDEZ_K = 0.6;

export function nitidezQrDePixeles(pix: PixelesQr): PixelesQr {
  const { data, width: w, height: h } = pix;
  const out = new Uint8ClampedArray(data); // orig + delta acumulado
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        // blur 3×3 (sin separables — 9 lecturas, ventana local)
        let suma = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) suma += data[i + (dy * w + dx) * 4 + c]!;
        const blur = suma / 9;
        out[i + c] = data[i + c]! + NITIDEZ_K * (data[i + c]! - blur);
      }
    }
  }
  return { data: out, width: w, height: h };
}

// ─── e64-qr T-1.2 · BINARIZADA (umbral local adaptativo) ───────────────────
/** Blanco-negro puro con umbral LOCAL (ventana integral — patrón EXACTO del
 *  que ya usa marcasEsquina en src/lib/e14/integridad.ts:74-100, con luma
 *  8 bits + Float64 en vez de 6 bits + Uint32: aquí SÍ se necesita el rango
 *  completo para el delta): fotos con sombra o iluminación dura donde el
 *  binarizado interno de jsQR falla. Salida RGBA 0/255 — jsQR la consume
 *  igual (attemptBoth la invierte si hace falta). Pura, sin DOM, sin throw. */
export const BINARIZADA_VENTANA = 0.025; // fracción del lado menor (mín 24 px)
export const BINARIZADA_DELTA = 12;      // holgura sobre la media local

export function binarizadaQrDePixeles(pix: PixelesQr): PixelesQr {
  const { data, width: w, height: h } = pix;
  // luma 8 bits (redondeo una vez)
  const luma = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++)
    luma[p] = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
  // imagen integral (W+1)×(H+1) Float64 — luma 8 bits no desborda
  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      fila += luma[y * w + x]!;
      integral[(y + 1) * iw + x + 1] = integral[y * iw + x + 1]! + fila;
    }
  }
  const lado = Math.max(24, Math.round(Math.min(w, h) * BINARIZADA_VENTANA));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - lado);
    const y1 = Math.min(h - 1, y + lado);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - lado);
      const x1 = Math.min(w - 1, x + lado);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const suma =
        integral[(y1 + 1) * iw + x1 + 1]! - integral[y0 * iw + x1 + 1]! -
        integral[(y1 + 1) * iw + x0]! + integral[y0 * iw + x0]!;
      const media = suma / area;
      const v = luma[y * w + x]! < media - BINARIZADA_DELTA ? 0 : 255;
      const i = (y * w + x) * 4;
      out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// ─── e63n (T-PRE) — tier ZXING (zxing-wasm 3.1.6, wasm LOCAL) ──────────────
/** Módulo zxing-wasm/reader cacheado — undefined = aún no intentado ·
 *  null = la carga falló (degrada a solo-jsQR) · módulo = listo. */
type ModZxing = typeof import("zxing-wasm/reader");
let modZxing: ModZxing | null | undefined;

/**
 * Carga DIFERIDA del módulo zxing (doc hermano §1: `import("zxing-wasm/
 * reader")` + wasm servido LOCAL desde public/wasm/ vía
 * setZXingModuleOverrides({ locateFile }) con base
 * `${NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/`). Una sola tentativa por sesión
 * (caché); falla → null CON traza de indisponibilidad (T-0.1 del e64 —
 * doc hermano F-0.2) y el pipeline degrada a solo-jsQR. Jamás throw.
 */
async function moduloZxingDe(): Promise<ModZxing | null> {
  if (modZxing !== undefined) return modZxing;
  try {
    const mod = await import("zxing-wasm/reader");
    mod.setZXingModuleOverrides({
      locateFile: (archivo: string) =>
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/wasm/${archivo}`,
    });
    modZxing = mod;
  } catch {
    // e64-qr T-0.1 — el fallo del wasm/glue era SILENCIOSO (doc hermano
    // H-3): sin esta traza era imposible distinguir «QR ilegible» de
    // «wasm no cargó» (deploy sin BUILD_STATIC=1, basePath equivocado,
    // red bloqueada). El pipeline NO se rompe: degrada a solo-jsQR.
    console.warn(
      `[e14] qr-capa0 zxing INDISPONIBLE (wasm/glue no cargó) — rescate degrada a solo-jsQR`,
    );
    modZxing = null;
  }
  return modZxing;
}

/** e64-qr T-0.1 — Estado del módulo zxing para diagnóstico (doc hermano
 *  F-0.2): "no-intentado" = aún sin intentar · "indisponible" = la carga
 *  falló (rescate degrada a solo-jsQR) · "listo" = wasm cargado. SOLO-
 *  LECTURA: jamás muta el estado, jamás dispara la carga. */
export function estadoZxingQr(): "no-intentado" | "indisponible" | "listo" {
  return modZxing === undefined
    ? "no-intentado"
    : modZxing === null
      ? "indisponible"
      : "listo";
}

/** Opciones del barrido por ventana (micro-decisión declarada: el barrido
 *  lanza ~700-2300 ventanas — cada una debe ser BARATA; la rotación y la
 *  inversión ya las cubren el tier rotación y jsQR attemptBoth). */
const OPCIONES_ZXING_VENTANA = (
  binarizador: Binarizer,
): ReaderOptions => ({
  formats: [ZXING_FORMATO],
  binarizer: binarizador,
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
});

/** UN intento zxing sobre UNA ventana con UN binarizador. null si el
 *  módulo no está, si no hay ImageData (entorno headless — degrada
 *  honesto) o si nada lee. Jamás throw. */
async function zxingDeVentana(
  win: PixelesQr,
  binarizador: Binarizer,
): Promise<string | null> {
  try {
    const mod = await moduloZxingDe();
    if (!mod || typeof ImageData === "undefined") return null;
    const img = new ImageData(win.width, win.height);
    img.data.set(win.data); // copia por ventana — despreciable vs el decode
    const resultados = await mod.readBarcodesFromImageData(
      img,
      OPCIONES_ZXING_VENTANA(binarizador),
    );
    return resultados[0]?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * BARRIDO CEÑIDO zxing (doc hermano §1.4): la MISMA grilla del barrido
 * jsQR con los binarizadores GlobalHistogram→LocalAverage por ventana y
 * presupuesto de reló 4 000 ms (ZXING_BARRIDO_PRESUPUESTO_MS — chequeo
 * `performance.now() > limite` por ventana; al vencer devuelve null SIN
 * exhaustar). Módulo indisponible → null inmediato (solo-jsQR).
 */
export async function barridoQrZxingDePixeles(
  pix: PixelesQr,
): Promise<string | null> {
  const mod = await moduloZxingDe();
  if (!mod || typeof ImageData === "undefined") return null;
  const limite = performance.now() + ZXING_BARRIDO_PRESUPUESTO_MS;
  for (const q of CUADRANTES) {
    const lim = limitesDeCuadrante(pix, q);
    for (const fraccion of BARRIDO_VENTANAS) {
      const lado = ladoDeVentana(pix, fraccion);
      const paso = Math.max(1, Math.round(lado * 0.5));
      for (let y = lim.y0; y + lado <= lim.y1; y += paso) {
        for (let x = lim.x0; x + lado <= lim.x1; x += paso) {
          if (performance.now() > limite) return null; // presupuesto vencido
          const win = ventanaDePixeles(pix, x, y, lado);
          if (!win) continue;
          for (const binarizador of ZXING_BINARIZADORES) {
            const payload = await zxingDeVentana(win, binarizador);
            if (payload != null) return payload;
          }
        }
      }
      // e64-qr T-1.0 — celda final del cuadrante (hueco del filo, doc
      // hermano H-5): anclada al filo inferior-derecho, MISMA grilla, los
      // DOS binarizadores y el chequeo de presupuesto intacto.
      if (performance.now() > limite) return null; // presupuesto vencido
      const winFilo = ventanaDePixeles(pix, lim.x1 - lado, lim.y1 - lado, lado);
      if (winFilo) {
        for (const binarizador of ZXING_BINARIZADORES) {
          const payloadFilo = await zxingDeVentana(winFilo, binarizador);
          if (payloadFilo != null) return payloadFilo;
        }
      }
    }
  }
  return null;
}

// ─── Trazas (doc hermano §1 — «Trazas existentes») ──────────────────────────
/** Traza EXACTA del formato e63n: `[e14] qr-capa0 tier=<tier> ms=<ms>
 *  payload=<8 chars…>`. Solo-observabilidad: jamás decide nada. */
function trazaQr(tier: string, payload: string, t0: number): void {
  console.info(
    `[e14] qr-capa0 tier=${tier} ms=${Date.now() - t0} payload=${qrCorto(payload)}`,
  );
}

/**
 * CADENA COMPLETA de decode sobre píxeles (doc hermano §1 + e64 Fase 1 —
 * el orden REAL): ladderBase → barrido jsQR → barrido NITIDEZ (T-1.1) →
 * barrido BINARIZADA (T-1.2) → barrido zxing → tier rotación, early-exit
 * al primer payload, `null` si nada decodifica. Async SOLO por el tier
 * zxing (wasm). La traza `tier=` sale por cada desenlace (también null —
 * T-0.3 del e64 la usa para verificar la versión desplegada). JAMÁS throw
 * (todas las sub-llamadas ya son a prueba de throw).
 */
export async function decodificarQrDePixeles(
  pix: PixelesQr,
): Promise<string | null> {
  const t0 = Date.now();
  const base = ladderBaseDePixeles(pix);
  if (base != null) {
    trazaQr("base", base, t0);
    return base;
  }
  const barrido = barridoQrDePixeles(pix);
  if (barrido != null) {
    trazaQr("barrido", barrido, t0);
    return barrido;
  }
  // e64-qr T-1.1 — tier NITIDEZ: barrido sobre la imagen enfocada (doc
  // hermano R-1 — el remuestreo a 2048 suaviza los módulos; convolución
  // ~25 ms a 2048² + barrido acotado por nº de ventanas).
  const nitido = barridoQrDePixeles(nitidezQrDePixeles(pix));
  if (nitido != null) {
    trazaQr("barrido-nitido", nitido, t0);
    return nitido;
  }
  // e64-qr T-1.2 — tier BINARIZADA: barrido sobre el blanco-negro con
  // umbral LOCAL (doc hermano R-2 — sombra/iluminación dura donde el
  // binarizado interno de jsQR falla; imagen integral O(1) por píxel).
  const binarizada = barridoQrDePixeles(binarizadaQrDePixeles(pix));
  if (binarizada != null) {
    trazaQr("barrido-binarizado", binarizada, t0);
    return binarizada;
  }
  const zxing = await barridoQrZxingDePixeles(pix);
  if (zxing != null) {
    trazaQr("zxing", zxing, t0);
    return zxing;
  }
  for (const grados of QR_ROTACIONES) {
    const payload = intentoSobrePixeles(rotarPixeles(pix, grados), BANDA_A);
    if (payload != null) {
      trazaQr(`rotacion${grados}`, payload, t0);
      return payload;
    }
  }
  console.info(`[e14] qr-capa0 tier=null ms=${Date.now() - t0}`);
  return null;
}

// ─── Wrapper DOM (vía del banco — producción) ───────────────────────────────
/** dataURL del capture → píxeles del canvas de trabajo (lado largo ≤ 2048 —
 *  MISMA receta del canvasDeTrabajo del banco, byte-idéntico en semántica).
 *  null/jamás-throw: un fallo de render es sin-payload (fallback limpio). */
async function pixelesDeCapture(dataUrl: string): Promise<PixelesQr | null> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("QR_NO_DECODE_IMAGEN"));
    img.src = dataUrl;
  });
  const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const escala = Math.min(1, QR_LADO_LARGO / ladoMayor);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(img.naturalWidth * escala));
  cv.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const imgData = ctx.getImageData(0, 0, cv.width, cv.height);
  return { data: imgData.data, width: cv.width, height: cv.height };
}

/**
 * API del kit §1.1 — decodificar el QR de UN capture (dataURL de la vía
 * fileToCaptureDataUrl): canvas de trabajo ≤2048 → CADENA COMPLETA e63n
 * (decodificarQrDePixeles). Devuelve {payload} o null si nada decodifica.
 * JAMÁS throw hacia el runner (kit §1.1 — cualquier falla = sin-payload =
 * pipeline normal intacto).
 */
export async function decodificarQrDeCapture(
  dataUrl: string,
): Promise<{ payload: string } | null> {
  try {
    const pix = await pixelesDeCapture(dataUrl);
    if (!pix) return null;
    const payload = await decodificarQrDePixeles(pix);
    return payload != null ? { payload } : null;
  } catch {
    return null; // fallback limpio — la capa 0 jamás tumba el pipeline
  }
}

// ─── Espera acotada del caso «original en vuelo» (kit e63m §1.2.4) ──────────
/**
 * Espera APLAZADA: re-chequeo SOLO-LECTURA del estado del original cada
 * QR_ESPERA_INTERVALO_MS hasta QR_ESPERA_INTENTOS (techo efectivo 15 s —
 * sin timers globales; DEDUP_CINTA_CIERTA=2 intacto). Devuelve "reutiliza"
 * cuando el original aterriza con desenlace final (LISTA/DUPLICADA) y
 * "techo" cuando vence el techo O el original sale del vuelo por otra
 * puerta (ERROR / PENDIENTE / AUSENTE — esperar sería en balde: el
 * reproceso completo honesto manda). Los parámetros son inyectables SOLO
 * para el QA headless (timers cortos); en producción corren los default
 * del kit.
 */
export async function esperarDesenlaceQr(
  estadoDe: () => EstadoOriginalQr,
  intervaloMs: number = QR_ESPERA_INTERVALO_MS,
  maxIntentos: number = QR_ESPERA_INTENTOS,
): Promise<"reutiliza" | "techo"> {
  for (let i = 0; i < maxIntentos; i++) {
    await new Promise((r) => setTimeout(r, intervaloMs));
    const estado = estadoDe();
    if (estado === "LISTA" || estado === "DUPLICADA") return "reutiliza";
    if (estado === "ERROR" || estado === "PENDIENTE" || estado === "AUSENTE") {
      return "techo";
    }
    // PROCESANDO → sigue en vuelo: la espera continúa (el techo manda).
  }
  return "techo";
}

/** Prefijo corto del payload para trazas/informe (8 chars + «…») — SOLO
 *  cosmética: la decisión vive SIEMPRE en la igualdad EXACTA (red line 10). */
export function qrCorto(payload: string): string {
  return `${payload.slice(0, 8)}…`;
}
