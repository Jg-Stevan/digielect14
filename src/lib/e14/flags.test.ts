/**
 * Tests — flags.ts (KIT e14-observabilidad-v1, A1-C7): cadena de prioridad
 * DEFAULTS ← flags.json remoto cacheado ← overrides (kill switch manual),
 * saneo del JSON remoto y resultados de refrescarFlags (ok/sin-endpoint/
 * error) con fetch mockeado. Entorno node — window stub mínimo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetFlagsParaTest, FLAGS_DEFAULT, leerFlags, refrescarFlags, sanearFlags } from "./flags";

afterEach(() => {
  __resetFlagsParaTest();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubWindow(): void {
  vi.stubGlobal("window", {
    setTimeout: () => 0,
    clearTimeout: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
}

describe("flags · sanearFlags", () => {
  it("solo claves conocidas y tipos válidos; ocrThreadsTope clamped 1..8", () => {
    expect(
      sanearFlags({ poolWorkers: 2, thumbsOn: false, ocrThreadsTope: 99, telemetriaSalud: true, endpointReportes: null, hack: "x" }),
    ).toEqual({ poolWorkers: 2, thumbsOn: false, ocrThreadsTope: 8, telemetriaSalud: true, endpointReportes: null });
  });
  it("entrada hostil → {} (nunca lanza)", () => {
    expect(sanearFlags(null)).toEqual({});
    expect(sanearFlags("###")).toEqual({});
    expect(sanearFlags(42)).toEqual({});
    // poolWorkers fuera de 1|2 se descarta; ocrThreadsTope se CLAMPA al rango 1..8
    expect(sanearFlags({ poolWorkers: 7, ocrThreadsTope: -3 })).toEqual({ ocrThreadsTope: 1 });
  });
});

describe("flags · leerFlags (cadena de prioridad)", () => {
  it("defaults del contrato sin nada configurado", () => {
    stubWindow();
    expect(leerFlags()).toEqual(FLAGS_DEFAULT);
    expect(FLAGS_DEFAULT).toEqual({
      poolWorkers: 2,
      thumbsOn: true,
      ocrThreadsTope: 4,
      telemetriaSalud: true,
      endpointReportes: null,
      colaPersistente: true,
    });
  });

  it("overrides (localStorage) mandan sobre defaults — kill switch manual", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ ocrThreadsTope: 2, thumbsOn: false }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const f = leerFlags();
    expect(f.ocrThreadsTope).toBe(2);
    expect(f.thumbsOn).toBe(false);
    expect(f.poolWorkers).toBe(2); // lo no-overridden queda en default
  });
});

describe("flags · poolWorkers wiring (poolworkers-wiring-v1)", () => {
  it("sin override → poolWorkers default = 2 (kill switch apagado)", () => {
    stubWindow();
    expect(leerFlags().poolWorkers).toBe(2);
  });

  it("override válido 1 → se respeta (modo secuencial, RAM justa)", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ poolWorkers: 1 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().poolWorkers).toBe(1);
  });

  it("override válido 2 → se respeta", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ poolWorkers: 2 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().poolWorkers).toBe(2);
  });

  it("override fuera de rango (0, 3, \"x\") → saneo lo descarta y cae al default seguro 2", () => {
    // Validación defensiva en flags.ts (sanearFlags), NO en el runner (kit §3).
    expect(sanearFlags({ poolWorkers: 0 })).toEqual({});
    expect(sanearFlags({ poolWorkers: 3 })).toEqual({});
    expect(sanearFlags({ poolWorkers: "x" })).toEqual({});
    // Con un override hostil el efectivo sigue siendo el default:
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ poolWorkers: 0 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().poolWorkers).toBe(2);
  });
});

describe("flags · colaPersistente wiring (cola-persistente-v1)", () => {
  it("sin override → colaPersistente default = true (la masiva SOLO muere con vaciar() del dueño)", () => {
    stubWindow();
    expect(leerFlags().colaPersistente).toBe(true);
  });

  it("override false → se respeta (MODO PRUEBAS e64p: auto-borrado al cargar)", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ colaPersistente: false }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().colaPersistente).toBe(false);
  });

  it("override no-booleano (0, \"x\", null) → saneo lo descarta y cae al default seguro true (nunca borrar por accidente)", () => {
    expect(sanearFlags({ colaPersistente: 0 })).toEqual({});
    expect(sanearFlags({ colaPersistente: "x" })).toEqual({});
    expect(sanearFlags({ colaPersistente: null })).toEqual({});
    // Con un override hostil el efectivo sigue siendo el default:
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ colaPersistente: 0 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().colaPersistente).toBe(true);
  });
});

describe("flags · refrescarFlags (fetch mockeado)", () => {
  it("flags.json bueno → 'ok' y leerFlags lo aplica (bajo los overrides)", async () => {
    stubWindow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ocrThreadsTope: 6, poolWorkers: 1 }) }) as unknown as Response),
    );
    expect(await refrescarFlags()).toBe("ok");
    const f = leerFlags();
    expect(f.ocrThreadsTope).toBe(6);
    expect(f.poolWorkers).toBe(1);
    expect(f.telemetriaSalud).toBe(true); // default intacto
  });

  it("overrides ganan a los remotos (prioridad máxima del dueño)", async () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ ocrThreadsTope: 1 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ocrThreadsTope: 6 }) }) as unknown as Response),
    );
    expect(await refrescarFlags()).toBe("ok");
    expect(leerFlags().ocrThreadsTope).toBe(1);
  });

  it("404/ausente → 'sin-endpoint' (estado normal: no hay flags.json)", async () => {
    stubWindow();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as unknown as Response));
    expect(await refrescarFlags()).toBe("sin-endpoint");
    expect(leerFlags()).toEqual(FLAGS_DEFAULT);
  });

  it("fallo de red → 'error' y el último bueno queda cacheado (offline-safe)", async () => {
    stubWindow();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thumbsOn: false }) } as unknown as Response)
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchFn);
    expect(await refrescarFlags()).toBe("ok");
    expect(await refrescarFlags()).toBe("error");
    expect(leerFlags().thumbsOn).toBe(false); // fallback al último bueno
  });
});
