/**
 * Tests — KIT e73-sondeo-qr-precoz-v1 (§A.5, T1 ≥ 6):
 *  1. Ladder puro (píxeles/barrido inyectados — sin worker real):
 *     QR en esquina sup-izq → el ladder lo lee con payload EXACTO;
 *     rotadas 90/180/270 en sitio → la rotación del recorte las lee;
 *     sin QR → null; presupuesto agotado antes de S3 → null SIN entrar
 *     (spy del barrido en 0 llamadas).
 *  2. Cliente: serialización FIFO (2 concurrentes → 1 a la vez).
 *  3. Hard-kill: worker colgado (mock) → terminate + respawn + null.
 *  4. Feature-detect: sin Worker → null sin throw (y sin instanciar).
 *  5. Flag OFF → null sin instanciar worker (kill-switch, §A.4).
 * El bundling real lo cubre `bun run build` (smoke §A.1 — declarado en el
 * PR) y el smoke manual en dev queda en §H del kit (verificación de campo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Flags controlados por test (mock ANTES de importar el cliente — hoisted).
const flagsState = vi.hoisted(() => ({ on: true, presupuesto: 2500 }));
vi.mock("../flags", async (importOriginal) => {
  const real = await importOriginal<typeof import("../flags")>();
  return {
    ...real,
    leerFlags: () => ({
      ...real.FLAGS_DEFAULT,
      sondeoQrPrecoz: flagsState.on,
      sondeoQrPresupuestoMs: flagsState.presupuesto,
    }),
  };
});

// ── Fixture: matriz QR REAL del corpus (la misma de qa-qr-identidad.ts) ────
const PAYLOAD_A = "7UfaHJKbmbZx766vul1NWL/H0swwzefhl5P2YMRLqjk=";
const MATRIZ_A = [
  "11111110100110010010101111111",
  "10000010011001100101101000001",
  "10111010001011101001101011101",
  "10111010000010000001101011101",
  "10111010010101100010001011101",
  "10000010001010101110101000001",
  "11111110101010101010101111111",
  "00000000101101000010000000000",
  "11011010011101110111101000001",
  "00111001110010000000010010100",
  "10111011101101111110100111100",
  "01010101011110000111110101000",
  "11001111010111010000111001101",
  "11110001000000110001011111001",
  "10111111100111111111101001001",
  "10101001110100100000100001111",
  "01001110010001000000010010100",
  "11010100100110110101010010111",
  "11111010111101111001101101001",
  "11010001010011000001001010111",
  "11011011010010101100111111001",
  "00000000110001110000100010010",
  "11111110010011110001101011010",
  "10000010001000010101100011001",
  "10111010111010011001111111000",
  "10111010110010111100110001101",
  "10111010001000010110000111111",
  "10000010100000000011011111101",
  "11111110110001110001111000000",
];

type Pix = { data: Uint8ClampedArray; width: number; height: number };

/** Dibuja la matriz QR en un lienzo RGBA blanco (misma receta del QA). */
function lienzoConQr(
  M: string[],
  modulo: number,
  quiet: number,
  W: number,
  H: number,
  ox: number,
  oy: number,
): Pix {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < M.length; y++) {
    for (let x = 0; x < M.length; x++) {
      if (M[y]!.charAt(x) !== "1") continue;
      for (let dy = 0; dy < modulo; dy++) {
        for (let dx = 0; dx < modulo; dx++) {
          const i =
            ((oy + quiet * modulo + y * modulo + dy) * W +
              (ox + quiet * modulo + x * modulo + dx)) *
            4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
    }
  }
  return { data, width: W, height: H };
}

/** Rotación k×90° horaria de la MATRIZ (foto «rotada físicamente» sin EXIF:
 *  los módulos del QR quedan girados en sitio — el ladder la resuelve por
 *  la rotación del recorte). dst[y][x] = src[n-1-x][y], k veces. */
function rotarMatriz(M: string[], k: number): string[] {
  let m = M;
  for (let r = 0; r < k; r++) {
    const n = m.length;
    const out: string[] = [];
    for (let y = 0; y < n; y++) {
      let fila = "";
      for (let x = 0; x < n; x++) fila += m[n - 1 - x]!.charAt(y);
      out.push(fila);
    }
    m = out;
  }
  return m;
}

/** Contenido «de acta» FUERA del recorte (ruido que complica el full-frame
 *  de S1 pero no vive en la esquina sup-izq — igual que una foto real). */
function ensuciarFueraDelRecorte(pix: Pix): void {
  const put = (x: number, y: number, lado: number): void => {
    for (let yy = y; yy < Math.min(pix.height, y + lado); yy++) {
      for (let xx = x; xx < Math.min(pix.width, x + lado); xx++) {
        const i = (yy * pix.width + xx) * 4;
        pix.data[i] = 0;
        pix.data[i + 1] = 0;
        pix.data[i + 2] = 0;
      }
    }
  };
  put(pix.width - 420, 40, 300); // cuadrado negro arriba-derecha
  put(60, pix.height - 400, 320); // cuadrado negro abajo-izquierda
  put(pix.width - 460, pix.height - 460, 360); // abajo-derecha
}

const LADO = 600; // QR_RECORTE_LADO (el lado real — el worker lo inyecta)

import {
  SONDEO_S3_MINIMO_RESTANTE_MS,
  ladderSondeoDePixeles,
  type BarridoQrFn,
} from "./sondeo-qr.worker";
import {
  __setFabricaWorkerSondeoParaTest,
  sondearQrPrecoz,
  type WorkerSondeo,
} from "./sondeo-qr.client";

describe("e73 T1 · ladderSondeoDePixeles (puro — píxeles/barrido inyectados)", () => {
  it("1 · QR en esquina sup-izq → el ladder lo lee con payload EXACTO", () => {
    const pix = lienzoConQr(MATRIZ_A, 6, 4, 2048, 1536, 0, 0);
    ensuciarFueraDelRecorte(pix);
    const barrido: BarridoQrFn = vi.fn(() => null);
    const r = ladderSondeoDePixeles(pix, 2500, { barrido, ladoRecorte: LADO });
    expect(r.payload).toBe(PAYLOAD_A); // payload EXACTO (e63m — jamás fuzzy)
    expect(r.tier).toBeTruthy();
    expect(barrido).not.toHaveBeenCalled(); // early-exit ANTES del barrido
  });

  it("2 · QR pequeño (módulos de 2 px) → el ladder lo lee", () => {
    const pix = lienzoConQr(MATRIZ_A, 2, 3, 2048, 1536, 0, 0);
    ensuciarFueraDelRecorte(pix);
    const barrido: BarridoQrFn = vi.fn(() => null);
    const r = ladderSondeoDePixeles(pix, 2500, { barrido, ladoRecorte: LADO });
    expect(r.payload).toBe(PAYLOAD_A);
    expect(barrido).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3] as const)(
    "3 · foto rotada físicamente %i×90° (sin EXIF) → la rotación del recorte la lee",
    (k) => {
      const pix = lienzoConQr(rotarMatriz(MATRIZ_A, k), 6, 4, 2048, 1536, 0, 0);
      ensuciarFueraDelRecorte(pix);
      const barrido: BarridoQrFn = vi.fn(() => null);
      const r = ladderSondeoDePixeles(pix, 2500, { barrido, ladoRecorte: LADO });
      expect(r.payload).toBe(PAYLOAD_A); // payload EXACTO pese a la rotación
      expect(r.tier).toBeTruthy();
      expect(barrido).not.toHaveBeenCalled();
    },
  );

  it("4 · sin QR → null honesto (S3 corre completo una vez entrado)", () => {
    const pix = lienzoConQr([], 6, 4, 1024, 768, 0, 0); // lienzo limpio
    ensuciarFueraDelRecorte(pix);
    const barrido: BarridoQrFn = vi.fn(() => null);
    const r = ladderSondeoDePixeles(pix, 2500, { barrido, ladoRecorte: LADO });
    expect(r.payload).toBeNull();
    expect(r.tier).toBeNull();
    // Presupuesto 2500: tras S1+S2 reales quedan ≥1500 → S3 SÍ corre
    // (completo una vez entrado) — el barrido inyectado no lee → null.
    expect(barrido).toHaveBeenCalledTimes(1);
  });

  it("5 · presupuesto agotado antes de S3 → null SIN entrar al barrido (reló inyectado)", () => {
    const pix = lienzoConQr([], 6, 4, 1024, 768, 0, 0); // sin QR
    const barrido: BarridoQrFn = vi.fn(() => PAYLOAD_A);
    // Chequeos del ladder EN ORDEN: S1 · S2 · rot0 · rot90 · rot180 · rot270 · S3.
    // Reló simulado: 0,100,100,200,300,400,700 — al llegar a S3 restan
    // 2000-700=1300 < SONDEO_S3_MINIMO_RESTANTE_MS → aborta a null.
    const tSecuencia = [0, 100, 100, 200, 300, 400, 700];
    let i = 0;
    const r = ladderSondeoDePixeles(pix, 2000, {
      barrido,
      ladoRecorte: LADO,
      ahora: () => tSecuencia[Math.min(i++, tSecuencia.length - 1)]!,
    });
    expect(r.payload).toBeNull();
    expect(r.tier).toBeNull();
    expect(barrido).not.toHaveBeenCalled(); // NUNCA entró a S3 (restan <1500)
    expect(SONDEO_S3_MINIMO_RESTANTE_MS).toBe(1500);
  });

  it("6 · presupuesto suficiente + barrido que lee → tier 'barrido' (decoder inyectado)", () => {
    const pix = lienzoConQr([], 6, 4, 1024, 768, 0, 0); // sin QR en S1/S2
    const barrido: BarridoQrFn = vi.fn(() => PAYLOAD_A);
    const r = ladderSondeoDePixeles(pix, 2500, {
      barrido,
      ladoRecorte: LADO,
      ahora: () => 0, // reló congelado — siempre restan ≥1500
    });
    expect(r.payload).toBe(PAYLOAD_A);
    expect(r.tier).toBe("barrido");
    expect(barrido).toHaveBeenCalledTimes(1);
  });

  it("7 · sin presupuesto (≤0) → null inmediato, nada corre", () => {
    const pix = lienzoConQr(MATRIZ_A, 6, 4, 1024, 768, 0, 0);
    const barrido: BarridoQrFn = vi.fn(() => PAYLOAD_A);
    const r = ladderSondeoDePixeles(pix, 0, { barrido, ladoRecorte: LADO, ahora: () => 0 });
    expect(r.payload).toBeNull();
    expect(r.tier).toBeNull();
    expect(barrido).not.toHaveBeenCalled();
  });
});

// ── Cliente — fábrica falsificada (kit §A.5.2/3/4) ──────────────────────────
type FakeWorker = WorkerSondeo & {
  enviados: { blob: Blob; presupuestoMs: number }[];
  terminado: boolean;
};

let fabricados: FakeWorker[];
let ultimo: FakeWorker | null;

function fabricaFalsa(): WorkerSondeo {
  const w: FakeWorker = {
    enviados: [],
    terminado: false,
    postMessage(msg: { blob: Blob; presupuestoMs: number }) {
      w.enviados.push(msg);
    },
    terminate() {
      w.terminado = true;
    },
    onmessage: null,
    onerror: null,
  };
  fabricados.push(w);
  ultimo = w;
  return w;
}

/** Responde como el worker real lo haría. */
function responder(
  w: FakeWorker,
  r: { payload: string | null; tier: string | null; ms: number },
): void {
  w.onmessage?.({ data: r } as MessageEvent);
}

describe("e73 T1 · sondeo-qr.client (singleton FIFO + hard-kill + feature-detect)", () => {
  beforeEach(() => {
    fabricados = [];
    ultimo = null;
    flagsState.on = true;
    flagsState.presupuesto = 2500;
    // Feature-detect §A.1 pasa: globals falsificados (en node no existen).
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("OffscreenCanvas", class {});
    __setFabricaWorkerSondeoParaTest(fabricaFalsa);
  });

  it("8 · serialización FIFO: 2 concurrentes → 1 a la vez (un solo worker)", async () => {
    const p1 = sondearQrPrecoz(new Blob(["a"]));
    const p2 = sondearQrPrecoz(new Blob(["b"]));
    await Promise.resolve(); // microtareas — el 1.er postMessage ya salió
    expect(ultimo?.enviados.length).toBe(1); // el 2.º ESPERA (FIFO)
    expect(fabricados.length).toBe(1); // singleton
    responder(ultimo!, { payload: "P1", tier: "full", ms: 5 });
    const r1 = await p1;
    expect(r1).toEqual({ payload: "P1", tier: "full", ms: 5 });
    await Promise.resolve();
    expect(ultimo?.enviados.length).toBe(2); // ahora sí salió el 2.º
    responder(ultimo!, { payload: null, tier: null, ms: 1 });
    const r2 = await p2;
    expect(r2).toEqual({ payload: null, tier: null, ms: 1 }); // corrió sin QR — telemetría real (§E)
  });

  it("9 · hard-kill: worker colgado → terminate + respawn + null", async () => {
    vi.useFakeTimers();
    try {
      const p1 = sondearQrPrecoz(new Blob(["c"]));
      const creado1 = ultimo!;
      await vi.advanceTimersByTimeAsync(2500 + 1000 + 1); // presupuesto + 1000
      expect(await p1).toBeNull(); // resolve null (jamás frena la ingesta)
      expect(creado1.terminado).toBe(true); // terminate del zombi
      // respawn: el PRÓXIMO sondeo crea un worker NUEVO
      const p2 = sondearQrPrecoz(new Blob(["d"]));
      await Promise.resolve();
      expect(fabricados.length).toBe(2); // respawn perezoso
      responder(ultimo!, { payload: "P2", tier: "recorte", ms: 3 });
      expect(await p2).toEqual({ payload: "P2", tier: "recorte", ms: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("10 · feature-detect: sin Worker/OffscreenCanvas → null sin throw y sin instanciar", async () => {
    vi.unstubAllGlobals(); // node real: Worker undefined
    __setFabricaWorkerSondeoParaTest(fabricaFalsa);
    const espia = vi.fn(fabricaFalsa);
    __setFabricaWorkerSondeoParaTest(espia);
    const r = await sondearQrPrecoz(new Blob(["e"]));
    expect(r).toBeNull();
    expect(espia).not.toHaveBeenCalled(); // jamás instanció nada
  });

  it("11 · flag OFF → null sin instanciar worker (kill-switch byte-idéntico)", async () => {
    flagsState.on = false;
    const r = await sondearQrPrecoz(new Blob(["f"]));
    expect(r).toBeNull();
    expect(fabricados.length).toBe(0); // SIN instanciar worker
  });
});
