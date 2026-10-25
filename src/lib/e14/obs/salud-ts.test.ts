/**
 * Tests — KIT e14-obs-hang-atribucion-v1 (§F v1.1, T6 ≥ 2): `ts` en CADA
 * SaludSnapshot del sampler. Corre SIN mockear ./dispositivo (el otro test
 * de §F lo mockea para construirReporte — no pueden convivir): navigator/
 * window se stubbean y el sampler corre REAL (obtenerDispositivo honesto en
 * node: todos los lectores de navegador → null), appendEvento capturado.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./buffer", () => ({
  appendEvento: vi.fn(async () => undefined),
}));

import { appendEvento } from "./buffer";
import { detenerMuestreoSalud, iniciarMuestreoSalud } from "./dispositivo";

const appendMock = vi.mocked(appendEvento);

afterEach(() => {
  detenerMuestreoSalud();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("§F v1.1 — cada muestra de salud lleva ts (Date.now() al capturar)", () => {
  it("tickSalud estampa ts numérico en el snapshot capturado", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "vitest-t6-sampler",
      hardwareConcurrency: 4,
    });
    vi.stubGlobal("window", {
      // modo dev ON → condicionesOk true (politica/flags defaults: ON)
      localStorage: { getItem: (k: string) => (k === "e14-dev-mode" ? "on" : null), setItem: () => {} },
      setInterval: () => 123 as unknown as number,
      clearInterval: () => {},
      clearTimeout: () => {},
      setTimeout: () => 0,
    });
    appendMock.mockClear();
    iniciarMuestreoSalud(); // muestra inmediata al iniciar
    await vi.waitFor(() => {
      expect(appendMock).toHaveBeenCalled();
    });
    const arg = appendMock.mock.calls[0][0];
    expect(arg.tipo).toBe("salud");
    const snap = arg.datos as { ts?: number; memoriaMB: number | null };
    expect(typeof snap.ts).toBe("number"); // LA muestra es datable
    expect(snap.ts!).toBeLessThanOrEqual(Date.now());
  });
  it("modo dev OFF → sin muestra (cero costo — el sampler ni arranca)", () => {
    vi.stubGlobal("navigator", { userAgent: "vitest", hardwareConcurrency: 4 });
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem: () => {} },
      setInterval: () => 0 as unknown as number,
      clearInterval: () => {},
      clearTimeout: () => {},
      setTimeout: () => 0,
    });
    appendMock.mockClear();
    iniciarMuestreoSalud();
    expect(appendMock).not.toHaveBeenCalled();
  });
});
