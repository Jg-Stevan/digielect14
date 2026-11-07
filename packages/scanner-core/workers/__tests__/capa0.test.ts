/**
 * 7.12 (plan de remediación, cierra T4) — TEST FUNCIONAL del WORKER de la
 * CAPA 0 QR. `public/scanner/capa0-qr.worker.js` solo tenía smokes de
 * bundling byte-a-byte (detectan el «verde falso» de Turbopack, no la
 * lógica): aquí se ancla el FILTRO capa-0 — lo que el worker ACEPTA
 * (ladder base, ventana/recorte-600, barrido, rotaciones) y lo que RECHAZA
 * (sin QR, ruido) — contra la FUENTE TS aislada del paquete
 * (`workers/capa0-qr.worker.ts` → `src/qr/qr-pixeles.ts`, el motor del
 * filtro), y el CONTRATO del mensaje del worker REAL (`JAMÁS throw` +
 * degradación honesta `sin-decode`).
 *
 * Generación de fixtures: `zxing-wasm/writer` produce el PNG del QR
 * (SINTÉTICO — nada de actas) y `pngGrisAPixeles` lo decodifica (PNG
 * grayscale 8-bit, filters 0-4) al `PixelesQr` que consume la cadena.
 * RED LINE respetada: zxing SOLO en el test, jamás en el worker/bundle.
 *
 * Nota honesta de entorno: bun no implementa `createImageBitmap`/
 * `OffscreenCanvas`, así que el decode del Blob dentro del worker devuelve
 * null honesto (fin "sin-decode") — el filtro se ejercita vía la MISMA
 * función (`cadenaCapa0EnWorker` consume estas funciones de qr-pixeles) y
 * el contrato del mensaje se ancla con un worker real de bun.
 */
import { describe, expect, test } from "bun:test";
import { unzlibSync } from "fflate";
import { writeBarcode } from "zxing-wasm/writer";
import {
  barridoQrDePixeles,
  BANDA_A,
  intentoSobrePixeles,
  ladderBaseDePixeles,
  QR_RECORTE_LADO,
  rotarPixeles,
  ventanaDePixeles,
  jsQrDeVentana,
  type PixelesQr,
} from "../../src/qr/qr-pixeles";

/** Payload sintético del QR de prueba (la capa-0 no interpreta: devuelve el
 *  texto crudo — el parseo del payload vive en identidad-qr.ts, en main). */
const PAYLOAD = "E14QR|TEST|7.12";

/** Los dos casos de "null REAL" recorren TODA la grilla del barrido sin
 *  early-exit (1400² cruzado y ruido 400²): en máquinas lentas el coste real
 *  ronda 9 s y el límite por defecto de 5 s de bun:test los corta. El trabajo
 *  es el del producto, así que se amplía el reloj del test, no el fixture. */
const TIMEOUT_BARRIDO_COMPLETO = 30_000;

/** Decodifica un PNG GRAYSCALE 8-bit (el que emite zxing-wasm) a
 *  PixelesQr {data: RGBA, width, height} con luminancia por canal. Sin
 *  dependencias de imagen: chunks + unzlibSync + unfilter estándar. */
function pngGrisAPixeles(png: Uint8Array): PixelesQr {
  const be32 = (b: Uint8Array, i: number): number =>
    ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error("no es PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (off < png.length) {
    const len = be32(png, off);
    const tipo = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const data = png.subarray(off + 8, off + 8 + len);
    if (tipo === "IHDR") {
      width = be32(data, 0);
      height = be32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (tipo === "IDAT") {
      idat.push(data);
    }
    off += 12 + len;
    if (tipo === "IEND") break;
  }
  if (bitDepth !== 8 || colorType !== 0) {
    throw new Error(`PNG no soportado por el fixture: depth=${bitDepth} color=${colorType}`);
  }
  // Scanlines filtradas: cada fila = 1 byte de filtro + width bytes.
  const crudo = unzlibSync(
    idat.reduce((acc, trozo) => {
      const out = new Uint8Array(acc.length + trozo.length);
      out.set(acc);
      out.set(trozo, acc.length);
      return out;
    }, new Uint8Array()),
  );
  const bpp = 1;
  const fila = width * bpp;
  const px = new Uint8ClampedArray(width * height * 4); // RGBA out
  const previa = new Uint8Array(fila);
  const actual = new Uint8Array(fila);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filtro = crudo[y * (fila + 1)];
    actual.set(crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1)));
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? actual[x - bpp] : 0;
      const b = previa[x];
      const c = x >= bpp ? previa[x - bpp] : 0;
      if (filtro === 1) actual[x] = (actual[x] + a) & 0xff;
      else if (filtro === 2) actual[x] = (actual[x] + b) & 0xff;
      else if (filtro === 3) actual[x] = (actual[x] + ((a + b) >> 1)) & 0xff;
      else if (filtro === 4) actual[x] = (actual[x] + paeth(a, b, c)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const lum = actual[x];
      const i = (y * width + x) * 4;
      px[i] = lum;
      px[i + 1] = lum;
      px[i + 2] = lum;
      px[i + 3] = 255;
    }
    previa.set(actual);
  }
  return { data: px, width, height };
}

/** QR sintético → PixelesQr (fixture reutilizable de los casos de acepta). */
async function qrFixture(escala = 4): Promise<PixelesQr> {
  const out = await writeBarcode(PAYLOAD, { format: "QRCode", scale: escala });
  if (!out.image) throw new Error("zxing-wasm no emitió PNG para el fixture");
  const png = new Uint8Array(await out.image.arrayBuffer());
  return pngGrisAPixeles(png);
}

/** Frame con el QR pequeño en la esquina sup-izq y relleno liso alrededor
 *  (patrón real de captura: el QR NO llena el frame — por eso existen el
 *  barrido por cuadrantes y el recorte-600). */
async function frameConQrEnEsquina(lado = 900): Promise<PixelesQr> {
  const qr = await qrFixture(2);
  const data = new Uint8ClampedArray(lado * lado * 4).fill(235); // papel liso
  for (let y = 0; y < qr.height; y++) {
    for (let x = 0; x < qr.width; x++) {
      const src = (y * qr.width + x) * 4;
      const dst = (y * lado + x) * 4;
      data[dst] = qr.data[src];
      data[dst + 1] = qr.data[src + 1];
      data[dst + 2] = qr.data[src + 2];
      data[dst + 3] = 255;
    }
  }
  return { data, width: lado, height: lado };
}

describe("7.12 · filtro capa-0 — lo que ACEPTA", () => {
  test("ladder base (tier 'base'): QR limpio que llena el decode → payload", async () => {
    const pix = await qrFixture(4);
    expect(ladderBaseDePixeles(pix)).toBe(PAYLOAD);
  });

  test("recorte-600 (ventana sup-izq + jsQR): QR en la esquina → payload", async () => {
    const pix = await qrFixture(4);
    const win = ventanaDePixeles(pix, 0, 0, QR_RECORTE_LADO);
    expect(win).not.toBeNull();
    expect(jsQrDeVentana(win!)).toBe(PAYLOAD);
  });

  test("barrido por cuadrantes (tier 'barrido'): QR pequeño en frame liso", async () => {
    const pix = await frameConQrEnEsquina(900);
    // jsQR es tolerante y la ladder A TAMBIÉN lee este frame — el ancla es
    // la aceptación del BARRIDO con el MISMO payload (los tiers jamás se
    // contradicen: el worker sale en el primero que lee, orden de la cadena).
    expect(barridoQrDePixeles(pix)).toBe(PAYLOAD);
  });

  test("división de trabajo de los tiers: QR centrado que CRUZA los 4 cuadrantes — ladder lo lee, el barrido NO", async () => {
    // Un QR centrado queda partido por las 4 ventanas del barrido (ningún
    // cuadrante lo contiene entero) — por eso el LADDER corre primero en la
    // cadena del worker. Ancla la división de trabajo real de los tiers.
    const lado = 1400;
    const qr = await qrFixture(2);
    const data = new Uint8ClampedArray(lado * lado * 4).fill(235);
    const ox = Math.floor((lado - qr.width) / 2);
    const oy = Math.floor((lado - qr.height) / 2);
    for (let y = 0; y < qr.height; y++) {
      for (let x = 0; x < qr.width; x++) {
        const src = (y * qr.width + x) * 4;
        const dst = ((y + oy) * lado + (x + ox)) * 4;
        data[dst] = qr.data[src];
        data[dst + 1] = qr.data[src + 1];
        data[dst + 2] = qr.data[src + 2];
        data[dst + 3] = 255;
      }
    }
    const pix: PixelesQr = { data, width: lado, height: lado };
    expect(ladderBaseDePixeles(pix)).toBe(PAYLOAD); // la base (1ª de la cadena) lee
    expect(barridoQrDePixeles(pix)).toBeNull(); // el barrido no ve un QR cruzado
  }, TIMEOUT_BARRIDO_COMPLETO);

  test("rotaciones (tier 'rotacionN'): QR girado 90° sigue siendo legible por el intento A", async () => {
    // jsQR es tolerante a rotaciones rectas, así que la ladder también lee;
    // el ancla es el TIER de rotación del worker (el intento A sobre el
    // frame rotado devuelve el MISMO payload — los tiers jamás se contradicen).
    const pix = await qrFixture(4);
    const rotado = rotarPixeles(pix, 90);
    expect(intentoSobrePixeles(rotado, BANDA_A)).toBe(PAYLOAD);
    expect(ladderBaseDePixeles(rotado)).toBe(PAYLOAD); // tolerancia de jsQR (honesto)
  });
});

describe("7.12 · filtro capa-0 — lo que RECHAZA (null REAL, cacheable R1.2)", () => {
  test("papel liso sin QR → ladder null, barrido null y recorte null", async () => {
    const lado = 600;
    const data = new Uint8ClampedArray(lado * lado * 4).fill(220);
    const pix: PixelesQr = { data, width: lado, height: lado };
    expect(ladderBaseDePixeles(pix)).toBeNull();
    expect(barridoQrDePixeles(pix)).toBeNull();
    const win = ventanaDePixeles(pix, 0, 0, QR_RECORTE_LADO);
    expect(win).not.toBeNull(); // la ventana SÍ existe (el recorte corre)
    expect(jsQrDeVentana(win!)).toBeNull(); // …y no lee nada (null real)
  });

  test("ruido (sin patrón QR) → null por toda la cadena del filtro", () => {
    // PRNG determinista (xorshift, semilla fija — el test no depende del azar).
    let seed = 0x2545f491;
    const aleatorio = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0xffffffff;
    };
    const lado = 400;
    const data = new Uint8ClampedArray(lado * lado * 4);
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.floor(aleatorio() * 256);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    const pix: PixelesQr = { data, width: lado, height: lado };
    expect(ladderBaseDePixeles(pix)).toBeNull();
    expect(barridoQrDePixeles(pix)).toBeNull();
  }, TIMEOUT_BARRIDO_COMPLETO);
});

describe("7.12 · contrato del mensaje del WORKER REAL", () => {
  test("worker de bun: JAMÁS throw — responde {corrio:true, fin:'sin-decode'} honesto", async () => {
    // Worker REAL sobre la FUENTE TS (bun compila TS en workers). En este
    // entorno no hay createImageBitmap → el feature-detect del worker
    // devuelve null honesto: la respuesta debe ser
    // {corrio:true, payload:null, tier:null, fin:"sin-decode"} y NUNCA una
    // excepción (doctrina del conservador §I del kit).
    const url = new URL("../capa0-qr.worker.ts", import.meta.url);
    const worker = new Worker(url);
    const respuesta = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("worker no respondió (8 s)")), 8000);
      worker.onmessage = (ev: MessageEvent) => {
        clearTimeout(timeout);
        resolve(ev.data as Record<string, unknown>);
      };
      worker.onerror = (ev) => {
        clearTimeout(timeout);
        reject(new Error(`worker onerror: ${ev.message}`));
      };
      // Un blob NO-imagen: el decode falla honesto (sin-decode), jamás throw.
      const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
      worker.postMessage({ id: 7, blob, ladoLargo: 1600, rescate4096: false, presupuestoMs: 8000 });
    });
    worker.terminate();
    expect(respuesta["id"]).toBe(7); // el id viaja intacto
    expect(respuesta["corrio"]).toBe(true); // SIEMPRE true cuando responde
    expect(respuesta["payload"]).toBeNull();
    expect(respuesta["tier"]).toBeNull();
    expect(respuesta["fin"]).toBe("sin-decode"); // ni siquiera entró al ladder
    expect(typeof respuesta["ms"]).toBe("number"); // ms reales, jamás inventado
  });
});
