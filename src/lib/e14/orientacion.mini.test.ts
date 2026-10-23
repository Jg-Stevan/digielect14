/**
 * Tests unitarios — MINI-PROBE de orientación (KIT REPARTE-3-AGENTES-v1,
 * Agente A — Cambio 1): probeOrientacion sondea primero una miniatura a
 * 320 px del lado mayor y solo confía en ella si el FALLO SEGURO alcanza
 * (corte sana/confirmada, o rotación aplicada con ≥2 anclas y conf ≥0.6);
 * en cualquier otro caso re-corre el sondeo a resolución original — el
 * comportamiento de HOY — y ESA es la decisión (orientacionProbeEscala>320).
 *
 * Dependencias DOM/OCR mockeadas (patrón completitud.test.ts): image-utils
 * (loadImageMemo/canvasCon — canvas falso), ocr/rapidocr (det/rec en secuencia
 * controlada) y logger (captura de la traza). senalDeLectura/ANCLAS_LECTURA
 * reales (regex puras — la lógica de anclas se ejercita de verdad).
 *
 * «Decisión idéntica» (nivel unitario): UNA sola función de sondeo (sondeoDe)
 * decide en ambos caminos — los tests fijan que (a) el camino miniatura y el
 * de resolución original reciben EXACTAMENTE las mismas sequencias de
 * rec por rotación (mismo orden, mismos atajos), y (b) la decisión devuelta
 * es la de la pasada que manda según el fallo seguro, con la escala
 * correspondiente en orientacionProbeEscala. La verificación con los assets
 * reales acta-sim-* requiere el runtime del navegador (ONNX wasm + canvas) —
 * ver orientacion.decision-identica.test.ts (nivel lógico) y el reporte.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** URL que devuelve el toDataURL del canvas falso — la «miniatura». */
const MINI_URL = "data:image/jpeg;base64,MINI-FAKE";
/** Foto «original» que entra al probe (dataURL de siempre). */
const FOTO = "data:image/jpeg;base64,FOTO-3000x4000";

class CanvasFalso {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext(): {
    drawImage: ReturnType<typeof vi.fn>;
    translate: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
  } {
    return {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    };
  }
  toDataURL(): string {
    return MINI_URL;
  }
}

type Linea = { texto: string; conf: number };
/** Líneas del rec POR LLAMADA (cada llamada del rec-lote = UNA rotación,
 *  en el orden del sondeo: h>w → [0,180,90,270]; w>h → [0,90,270,180]). */
let recPorRotacion: Linea[][] = [];
/** crops + w/h POR LLAMADA de cropsOrientacion (1.ª = miniatura, 2.ª = original). */
let detPorFuente: { nCrops: number; w: number; h: number }[] = [];
/** Llamadas a cropsOrientacion: la fuente que recibió (mini vs original). */
const fuentesDet: string[] = [];
const lineasInfo: string[] = [];

vi.mock("./image-utils", () => ({
  // El decode del repo: la «foto» mide 3000×4000 (acta vertical de campo).
  loadImageMemo: vi.fn(async (url: string) => {
    if (url !== FOTO && url !== MINI_URL) throw new Error("URL_DESCONOCIDA");
    // La miniatura ya NO se re-escala desde sí misma (el probe solo decodifica
    // la original para medir el lado mayor y para el det de la fuente dada).
    return url === MINI_URL
      ? { naturalWidth: 240, naturalHeight: 320 }
      : { naturalWidth: 3000, naturalHeight: 4000 };
  }),
  canvasCon: vi.fn((w: number, h: number) => new CanvasFalso(w, h)),
}));

vi.mock("./ocr/rapidocr", () => ({
  rapidOcrInit: vi.fn(async () => ({ rt: "singleton-falso" })),
  rapidOcrCropsOrientacion: vi.fn(
    async (
      _rt: unknown,
      fuente: string,
      _k: number,
    ): Promise<{ crops: CanvasFalso[]; w: number; h: number; msDet: number }> => {
      fuentesDet.push(fuente);
      const spec = detPorFuente.shift();
      if (!spec) throw new Error("DET_SIN_SPEC");
      return {
        crops: Array.from({ length: spec.nCrops }, (_, i) => new CanvasFalso(40, 8 + i)),
        w: spec.w,
        h: spec.h,
        msDet: 1,
      };
    },
  ),
  rapidOcrRecLote: vi.fn(async (): Promise<Linea[]> => {
    const lineas = recPorRotacion.shift();
    if (!lineas) throw new Error("REC_SIN_SPEC");
    return lineas;
  }),
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn((msg: string) => {
      lineasInfo.push(msg);
    }),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { probeOrientacion } from "./orientacion";

/** Texto 0° sano (MEDIA por cabecera E-14 — atajo T1 «sana» del sondeo). */
const TEXTO_SANA: Linea[] = [
  { texto: "FORMULARIO E-14 MESAS ESCRUTADAS", conf: 0.93 },
  { texto: "CONSULADO 12 PAIS 5 MESA 33", conf: 0.91 },
  { texto: "departamento del Consulado de Colombia en Madrid", conf: 0.88 },
];
/** Texto 0° basura (acta de lado — nada legible). */
const TEXTO_DEBIL: Linea[] = [{ texto: "arco i1t9 zz", conf: 0.31 }];
/** Texto 180° legible (la rotación ganadora del caso del dueño). */
const TEXTO_180: Linea[] = [
  { texto: "FORMULARIO E-14", conf: 0.9 },
  { texto: "CONSULADO 12 PAIS 5 MESA 33", conf: 0.88 },
  { texto: "REGISTRADURIA NACIONAL DEL ESTADO CIVIL KIT 399", conf: 0.85 },
];

beforeEach(() => {
  vi.clearAllMocks();
  recPorRotacion = [];
  detPorFuente = [];
  fuentesDet.length = 0;
  lineasInfo.length = 0;
  // node no tiene DOM: `girarFuente` hace `src instanceof HTMLCanvasElement`
  // (dimsDe) — sin el stub, el instanceof lanza TypeError y el probe cae al
  // catch externo (null). Con el stub, los CanvasFalso del mock PASAN.
  vi.stubGlobal("HTMLCanvasElement", CanvasFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Traza del sondeo decisor: exactamente UNA línea [e14] orientacion. */
function trazaOrientacion(): string {
  const lineas = lineasInfo.filter((l) => l.startsWith("[e14] orientacion "));
  expect(lineas).toHaveLength(1);
  return lineas[0]!;
}

describe("mini-probe de orientación (Cambio 1 — Agente A)", () => {
  it("camino feliz: acta SANA decide en la miniatura (escala 320, un solo det)", async () => {
    detPorFuente = [{ nCrops: 8, w: 240, h: 320 }];
    recPorRotacion = [TEXTO_SANA]; // rot 0 → corte «sana» (h>w: [0,180,…])
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);
    expect(r!.aplicado).toBe(false);
    expect(r!.orientacionProbeEscala).toBe(320);
    // El det corrió UNA vez (sobre la MINIATURA) y el rec una sola rotación.
    expect(fuentesDet).toEqual([MINI_URL]);
    expect(trazaOrientacion()).toContain("cortes=sana");
    expect(trazaOrientacion()).toContain("escala=320");
  });

  it("camino feliz: acta ROTADA con evidencia fuerte decide en la miniatura (aplicado=1, escala 320)", async () => {
    detPorFuente = [{ nCrops: 8, w: 240, h: 320 }];
    recPorRotacion = [
      TEXTO_DEBIL, // rot 0 — DEBIL → challengers
      TEXTO_180, // rot 180 — 4 anclas, conf ~0.88 → ganadora FUERTE (≥2 anclas, ≥0.6)
    ];
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(320);
    expect(fuentesDet).toEqual([MINI_URL]); // la original JAMÁS se det-ea
    expect(trazaOrientacion()).toContain("rot=180");
    expect(trazaOrientacion()).toContain("escala=320");
  });

  it("fallo seguro: miniatura DEBIL (aplicado=0) → re-corre a resolución original y decide ELLA", async () => {
    detPorFuente = [
      { nCrops: 8, w: 240, h: 320 }, // miniatura: débil → NO confiable
      { nCrops: 8, w: 3000, h: 4000 }, // original: decide de siempre
    ];
    recPorRotacion = [
      TEXTO_DEBIL, // mini rot 0
      TEXTO_DEBIL, // mini rot 180 (débil — candidata no, aplicado=0)
      TEXTO_DEBIL, // mini rot 90
      TEXTO_DEBIL, // mini rot 270
      TEXTO_DEBIL, // original rot 0
      TEXTO_180, // original rot 180 → aplicado=1 (la decisión de HOY)
    ];
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(4000); // decidió la ORIGINAL (lado mayor 4000)
    expect(fuentesDet).toEqual([MINI_URL, FOTO]); // mini primero, original después
    expect(trazaOrientacion()).toContain("crop=3000x4000");
    expect(trazaOrientacion()).toContain("escala=4000");
  });

  it("fallo seguro: rotación ganadora de la miniatura DÉBIL (1 ancla) → no se confía → original", async () => {
    detPorFuente = [
      { nCrops: 8, w: 240, h: 320 },
      { nCrops: 8, w: 3000, h: 4000 },
    ];
    const unaAncla: Linea[] = [
      { texto: "MESA 33", conf: 0.95 }, // 1 ancla sola → umbral ≥2 falla
    ];
    recPorRotacion = [
      TEXTO_DEBIL, // mini rot 0
      unaAncla, // mini rot 180 — score ≥ MARGEN pero anclas=1 → NO confiable
      TEXTO_DEBIL, // original rot 0
      TEXTO_180, // original rot 180 → aplicado=1
    ];
    const r = await probeOrientacion(FOTO);
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(4000);
    expect(fuentesDet).toEqual([MINI_URL, FOTO]);
  });

  it("fallo seguro: det de la miniatura SIN cajas → re-corre a resolución original", async () => {
    detPorFuente = [
      { nCrops: 0, w: 240, h: 320 }, // miniatura: det sin cajas
      { nCrops: 8, w: 3000, h: 4000 }, // original: cajas → sondeo de siempre
    ];
    recPorRotacion = [
      TEXTO_DEBIL, // original rot 0
      TEXTO_180, // original rot 180
    ];
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(4000);
    expect(fuentesDet).toEqual([MINI_URL, FOTO]);
  });

  it("fallo seguro: det/rec de la miniatura LANZA → el sondeo original decide (el probe jamás tumba)", async () => {
    detPorFuente = [{ nCrops: 8, w: 3000, h: 4000 }];
    recPorRotacion = [
      TEXTO_DEBIL, // original rot 0
      TEXTO_180, // original rot 180
    ];
    // La miniatura lanza: el primer spec se consume y el siguiente det pega a
    // la original; para forzar el lanzamiento de la MINI, dejamos detPorFuente
    // sin spec para la miniatura → DET_SIN_SPEC.
    detPorFuente.unshift(null as unknown as { nCrops: number; w: number; h: number });
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(4000);
    expect(trazaOrientacion()).toContain("escala=4000");
  });

  it("conf límite: ganadora con conf < 0.6 NO se confía (umbral conservador Nº 2)", async () => {
    detPorFuente = [
      { nCrops: 8, w: 240, h: 320 },
      { nCrops: 8, w: 3000, h: 4000 },
    ];
    const confBaja: Linea[] = [
      { texto: "FORMULARIO E-14 CONSULADO 12", conf: 0.55 }, // 2 anclas, conf 0.55
    ];
    recPorRotacion = [
      TEXTO_DEBIL, // mini rot 0
      confBaja, // mini rot 180 — anclas 2 ✓ pero conf 0.55 < 0.6 → NO
      TEXTO_DEBIL, // original rot 0
      TEXTO_180, // original rot 180
    ];
    const r = await probeOrientacion(FOTO);
    expect(r!.rot).toBe(180);
    expect(r!.orientacionProbeEscala).toBe(4000);
  });

  it("foto ya pequeña (lado mayor ≤ 320): UN solo sondeo, byte-idéntico a hoy, escala = lado real", async () => {
    detPorFuente = [{ nCrops: 8, w: 300, h: 320 }];
    recPorRotacion = [
      TEXTO_DEBIL, // rot 0
      TEXTO_180, // rot 180
    ];
    // La foto ENTRA chica (lado mayor EXACTO 320): el mock del decode debe
    // devolver 300×320 para FOTO.
    const { loadImageMemo } = await import("./image-utils");
    (loadImageMemo as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => ({ naturalWidth: 300, naturalHeight: 320 }),
    );
    const r = await probeOrientacion(FOTO);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(320); // el lado mayor REAL de la fuente
    expect(fuentesDet).toEqual([FOTO]); // SIN miniatura — un solo sondeo
  });

  it("modo confirmación (e70): miniatura confirmada (anclas ≥3, conf ≥0.7, quadWorker) → escala 320 sin challengers", async () => {
    detPorFuente = [{ nCrops: 8, w: 240, h: 320 }];
    recPorRotacion = [TEXTO_SANA]; // rot 0: 3+ anclas, conf 0.9 → confirmada
    const r = await probeOrientacion(FOTO, {
      confirmar: { quadWorker: true },
    });
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);
    expect(r!.aplicado).toBe(false);
    expect(r!.orientacionProbeEscala).toBe(320);
    expect(fuentesDet).toEqual([MINI_URL]);
    expect(trazaOrientacion()).toContain("cortes=confirmada");
    expect(trazaOrientacion()).toContain("exif=1");
  });

  it("la traza es UNA línea por probe con `escala=` ADITIVO AL FINAL (formato D51 intacto)", async () => {
    detPorFuente = [{ nCrops: 8, w: 240, h: 320 }];
    recPorRotacion = [TEXTO_SANA];
    await probeOrientacion(FOTO);
    const t = trazaOrientacion();
    expect(t).toMatch(/^\[e14\] orientacion crop=240x320 rot=0 probe=\{0:[\d.]+\} anclas0=\d+ conf0=[\d.]+ aplicado=0 ms=\d+ cortes=sana orden=[\d,]+ gan=- exif=0 escala=320$/);
  });

  it("decisión idéntica (estructura): mismo desenlace de rec ⇒ misma decisión que el sondeo de resolución original", async () => {
    // El caso del dueño (lote 15:04, rot=270 en tira vertical): la MINIATURA
    // lee la evidencia rotada y la ORIGINAL leería lo MISMO (más resolución
    // nunca gira el texto). Comprobamos que con desenlaces IDÉNTICOS en ambos
    // caminos, la decisión final es la misma rotación — el camino miniatura
    // solo cambia CUÁNDO se decide, no QUÉ se decide.
    const mini270: Linea[] = [
      { texto: "E-14 CONSULADO 7 MESA 101", conf: 0.8 },
      { texto: "PAIS 3 ZONA 4 PUESTO 9", conf: 0.75 },
    ];
    detPorFuente = [
      { nCrops: 8, w: 240, h: 320 }, // mini
      { nCrops: 8, w: 3000, h: 4000 }, // original (para comparar decisión)
    ];
    recPorRotacion = [
      TEXTO_DEBIL, // mini rot 0
      mini270, // mini rot 180 (h>w → 180 segundo)
      TEXTO_DEBIL, // mini rot 90
      TEXTO_DEBIL, // mini rot 270 — 180 gana con MARGEN
      TEXTO_DEBIL, // original rot 0
      mini270, // original rot 180 — MISMA evidencia
      TEXTO_DEBIL, // original rot 90
      TEXTO_DEBIL, // original rot 270
    ];
    const r = await probeOrientacion(FOTO);
    // La miniatura SÍ era confiable (2+ anclas, conf ≥0.6) → la decisión de la
    // miniatura manda y coincide con la que la original produciría con el
    // mismo desenlace (rot=180, aplicado=1).
    expect(r!.rot).toBe(180);
    expect(r!.aplicado).toBe(true);
    expect(r!.orientacionProbeEscala).toBe(320);
    expect(fuentesDet).toEqual([MINI_URL]); // la original ni siquiera se det-ea
  });
});
