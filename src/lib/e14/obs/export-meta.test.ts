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
vi.mock("../masiva/cola", () => ({
  listarMapeados: vi.fn(async () => []),
}));

import { construirReporte } from "./export";

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
