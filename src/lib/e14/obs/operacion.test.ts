/**
 * Tests — KIT e14-obs-hang-atribucion-v1 (§A, T1 ≥ 3): registro de la
 * operación activa (D58).
 *  · set/get: marcarOperacion estampa y operacionActa lo devuelve.
 *  · edad crece: la edad de la marca CRECE con el reloj (sesgo honesto).
 *  · null-honesto: sin marca previa → {op: null, edadMs: null} (jamás
 *    inventar "ocioso").
 *  · reset + edad ≥ 0 (reloj retroactivo → 0).
 * Estado del módulo aislado por test vía __resetOperacionParaTest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetOperacionParaTest,
  marcarOperacion,
  operacionActa,
} from "./operacion";

beforeEach(() => {
  __resetOperacionParaTest();
});

afterEach(() => {
  __resetOperacionParaTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("operacion · registro de la operación activa (D58)", () => {
  it("set/get — marcarOperacion estampa la última operación y operacionActa la devuelve", () => {
    expect(operacionActa()).toEqual({ op: null, edadMs: null }); // sin marca aún
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    marcarOperacion("ocr");
    expect(operacionActa()).toEqual({ op: "ocr", edadMs: 0 });
    // la última marca GANA (module state — cada señal actualiza)
    marcarOperacion("dhash");
    expect(operacionActa().op).toBe("dhash");
  });

  it("edad crece — la edad de la marca avanza con el reloj (el sesgo es parte del dato)", () => {
    const ahora = vi.spyOn(Date, "now");
    ahora.mockReturnValue(5_000);
    marcarOperacion("informe");
    const edad1 = operacionActa().edadMs;
    ahora.mockReturnValue(5_750);
    const edad2 = operacionActa().edadMs;
    expect(edad1).toBe(0);
    expect(edad2).toBe(750);
    expect(edad2!).toBeGreaterThan(edad1!);
  });

  it("null-honesto — sin marca previa JAMÁS inventa op ni edad", () => {
    expect(operacionActa()).toEqual({ op: null, edadMs: null });
    // y tras reset vuelve al estado honesto (sin marca)
    marcarOperacion("deteccion");
    expect(operacionActa().op).toBe("deteccion");
    __resetOperacionParaTest();
    expect(operacionActa()).toEqual({ op: null, edadMs: null });
  });

  it("edad clamp — reloj retroactivo (mock hacia atrás) NO produce edad negativa", () => {
    const ahora = vi.spyOn(Date, "now");
    ahora.mockReturnValue(10_000);
    marcarOperacion("verificacion");
    ahora.mockReturnValue(9_000); // reloj retroactivo (jamás en producción)
    expect(operacionActa()).toEqual({ op: "verificacion", edadMs: 0 });
  });
});
