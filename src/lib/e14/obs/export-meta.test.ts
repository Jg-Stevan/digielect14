/**
 * Tests — KIT e14-obs-hang-atribucion-v1 (§F, T6 ≥ 2): reporte obs
 * AUTO-DESCRIPTIVO.
 *  · el reporte trae meta.modoDev/meta.telemetriaSalud ESPEJADOS (el gate
 *    del sampler queda legible desde el artefacto — saludMuestras: [] pasa
 *    de misterio a explicado).
 *  · (el ts por muestra se afirma en salud-ts.test.ts — el mock de
 *    obtenerDispositivo de este archivo no puede convivir con el sampler
 *    real del mismo módulo).
 * Los módulos de datos se MOCKEAN (entorno node — nada toca IndexedDB);
 * politica/flags corren REALES sobre window.localStorage stub (así el
 * espejo se prueba de punta a punta con overrides del dueño incluidos).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks de los 4 orígenes de datos del reporte (construirReporte queda
// pura lógica de agregación — exactamente lo que §F toca).
vi.mock("./buffer", () => ({
  eventosPorDigest: vi.fn(async () => []),
  leerEventos: vi.fn(async () => []),
  purgarBuffer: vi.fn(async () => undefined),
}));
vi.mock("./dispositivo", () => ({
  obtenerDispositivo: vi.fn(async () => ({
    memoriaMB: 11,
    nucleos: 4,
    memoriaGB: 8,
    bateria: { nivel: null, cargando: null },
    red: { tipo: "4g", downlinkMbps: 10, saveData: false },
    storageLibreMB: 1000,
    tier: "ALTO",
    tierInferido: false,
    os: "vitest",
    ua: "vitest-t6",
  })),
}));
vi.mock("./captura", () => ({
  hashDeActaIdDe: vi.fn(() => "hash-falso"),
}));
vi.mock("../store", () => ({
  useE14Store: { getState: () => ({ actaActual: null }) },
}));

import * as buffer from "./buffer";
import { construirReporte, lecturaResumenDe } from "./export";
import type { EventoObs } from "./tipos";

function localStorageStub(valores: Record<string, string>): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => valores[k] ?? null,
      setItem: () => {},
      removeItem: () => {},
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("§F — el reporte trae el gate del sampler ESPEJADO en meta", () => {
  it("modo dev ON + telemetriaSalud ON → {modoDev: true, telemetriaSalud: true}", async () => {
    localStorageStub({ "e14-dev-mode": "on" });
    const r = await construirReporte();
    expect(r.meta.modoDev).toBe(true);
    expect(r.meta.telemetriaSalud).toBe(true);
  });
  it("modo dev OFF + override telemetriaSalud:false → espejo honesto (saludMuestras vacío QUEDA EXPLICADO)", async () => {
    localStorageStub({
      "e14-dev-mode": "off",
      "e14-flags-overrides": JSON.stringify({ telemetriaSalud: false }),
    });
    const r = await construirReporte();
    expect(r.meta.modoDev).toBe(false);
    expect(r.meta.telemetriaSalud).toBe(false);
    // y los campos viven AL FINAL de meta (D57) junto a politica:
    expect(Object.keys(r.meta).slice(-2)).toEqual(["modoDev", "telemetriaSalud"]);
  });
});

describe("C3 (§6.7) — el reporte trae el agregado de lectura por motor", () => {
  const perf = (lectura?: unknown): EventoObs =>
    ({
      id: "e1",
      ts: 1,
      tipo: "perf",
      sesion: "s",
      dispositivo: "d",
      appVersion: "v",
      datos: { lectura },
    }) as EventoObs;

  it("PURA: perf sin lectura → undefined (honesto, no inventa ceros)", () => {
    expect(lecturaResumenDe([perf(undefined)])).toBeUndefined();
    // lectura malformada = acta sin aceptante (cuenta, pero no inventa ms)
    expect(lecturaResumenDe([perf({})])?.sinAceptante).toBe(1);
  });

  it("PURA: agrega ms/acta aceptada desde las lecturas retenidas", () => {
    const lectura = (motor: string, ms: number) => ({
      motorAceptante: motor,
      intentos: [{ paso: "1280", motor, validacion: "AUTO", aceptada: false, ms }],
      msPorMotor: { [motor]: ms },
    });
    const r = lecturaResumenDe([perf(lectura("rapidocr", 2000)), perf(lectura("rapidocr", 3000))]);
    expect(r?.actas).toBe(2);
    expect(r?.porAceptante["rapidocr"]?.msPorActa).toBe(2500);
  });

  it("construirReporte lo expone cuando el buffer tiene perf con lectura", async () => {
    const eventos: EventoObs[] = [
      {
        ...perf({
          motorAceptante: "tesseract",
          intentos: [
            { paso: "1280", motor: "rapidocr", validacion: "MANUAL", aceptada: false, ms: 1800 },
            { paso: "rescate-motor", motor: "tesseract", validacion: "AUTO", aceptada: false, ms: 2400 },
          ],
          msPorMotor: { rapidocr: 1800, tesseract: 2400 },
        }),
      },
    ];
    vi.mocked(buffer.leerEventos).mockImplementation(async (f) => (f ? eventos.filter(f) : eventos));
    try {
      const r = await construirReporte();
      expect(r.lecturaResumen?.porAceptante["tesseract"]).toEqual({
        actas: 1,
        intentos: 2,
        msTotal: 4200,
        msPorActa: 4200,
        msPorMotor: { rapidocr: 1800, tesseract: 2400 },
      });
    } finally {
      vi.mocked(buffer.leerEventos).mockImplementation(async () => []);
    }
  });
});
