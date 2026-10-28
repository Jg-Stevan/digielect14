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
      sanearFlags({ ocrThreadsTope: 99, telemetriaSalud: true, endpointReportes: null, hack: "x" }),
    ).toEqual({ ocrThreadsTope: 8, telemetriaSalud: true, endpointReportes: null });
  });
  it("entrada hostil → {} (nunca lanza)", () => {
    expect(sanearFlags(null)).toEqual({});
    expect(sanearFlags("###")).toEqual({});
    expect(sanearFlags(42)).toEqual({});
    // hangEnCurso no-booleano se descarta; ocrThreadsTope se CLAMPA al rango 1..8
    expect(sanearFlags({ hangEnCurso: 7, ocrThreadsTope: -3 })).toEqual({ ocrThreadsTope: 1 });
  });

  // KIT e14-orientacion-qr-v1 (§D) — whitelist aditiva (booleano):
  it("orientacion-qr · qrBrujulaOrientacion: override válido acepta; tipo inválido → default", () => {
    // Override válido — aceptado (kill switch del dueño):
    expect(sanearFlags({ qrBrujulaOrientacion: false })).toEqual({ qrBrujulaOrientacion: false });
    expect(sanearFlags({ qrBrujulaOrientacion: true })).toEqual({ qrBrujulaOrientacion: true });
    // Tipo inválido → ausente (el caller conserva el default — jamás inventar):
    expect(sanearFlags({ qrBrujulaOrientacion: "sí" })).toEqual({});
    expect(sanearFlags({ qrBrujulaOrientacion: 1 })).toEqual({});
  });

});

describe("flags · leerFlags (cadena de prioridad)", () => {
  it("defaults del contrato sin nada configurado", () => {
    stubWindow();
    expect(leerFlags()).toEqual(FLAGS_DEFAULT);
    expect(FLAGS_DEFAULT).toEqual({
      ocrThreadsTope: 4,
      telemetriaSalud: true,
      endpointReportes: null,
      // KIT e14-obs-hang-atribucion-v1 (§D) — aditivo AL FINAL (contrato D57):
      hangEnCurso: true,
      // KIT e14-orientacion-qr-v1 (§D) — aditivo AL FINAL (contrato D57):
      qrBrujulaOrientacion: true,
      // KIT e14-ocr-cascada-v1 (K3 fase 2) — aditivo AL FINAL (contrato D57):
      ocrCascada: false,
      // KIT e14-adaptacion-dispositivo-v1 — aditivo AL FINAL (contrato D57):
      adaptacionDispositivo: true,
    });
  });

  it("overrides (localStorage) mandan sobre defaults — kill switch manual", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ ocrThreadsTope: 2, hangEnCurso: false }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const f = leerFlags();
    expect(f.ocrThreadsTope).toBe(2);
    expect(f.hangEnCurso).toBe(false);
    expect(f.telemetriaSalud).toBe(true); // lo no-overridden queda en default
  });
});

describe("flags · refrescarFlags (fetch mockeado)", () => {
  it("flags.json bueno → 'ok' y leerFlags lo aplica (bajo los overrides)", async () => {
    stubWindow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ocrThreadsTope: 6 }) }) as unknown as Response),
    );
    expect(await refrescarFlags()).toBe("ok");
    const f = leerFlags();
    expect(f.ocrThreadsTope).toBe(6);
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ hangEnCurso: false }) } as unknown as Response)
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchFn);
    expect(await refrescarFlags()).toBe("ok");
    expect(await refrescarFlags()).toBe("error");
    expect(leerFlags().hangEnCurso).toBe(false); // fallback al último bueno
  });
});

// ─── KIT e14-obs-hang-atribucion-v1 (§D, T4 ≥ 2) — flag hangEnCurso ────────
describe("flags · hangEnCurso (kill-switch del sensor hang-en-curso, §D)", () => {
  it("saneo acepta booleano (true/false); leerFlags lo aplica sobre defaults", () => {
    expect(sanearFlags({ hangEnCurso: false })).toEqual({ hangEnCurso: false });
    expect(sanearFlags({ hangEnCurso: true })).toEqual({ hangEnCurso: true });
    stubWindow();
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) => (k === "e14-flags-overrides" ? JSON.stringify({ hangEnCurso: false }) : null),
        setItem: () => {},
      },
    });
    expect(leerFlags().hangEnCurso).toBe(false); // override manual del dueño (D6)
  });
  it("tipo inválido (no-booleano) → default (ausente del whitelist)", () => {
    expect(sanearFlags({ hangEnCurso: "off" })).toEqual({});
    expect(sanearFlags({ hangEnCurso: 0 })).toEqual({});
    expect(sanearFlags({ hangEnCurso: null })).toEqual({});
    expect(leerFlags().hangEnCurso).toBe(true); // FLAGS_DEFAULT.hangEnCurso
  });
});

// ─── KIT e14-ocr-cascada-v1 (K3 fase 2) — flag ocrCascada ──────────────────
describe("flags · ocrCascada (cascada OCR — kill-switch K3; renombrado del antiguo masivaOcrTesseract)", () => {
  it("default OFF → byte-idéntico al OCR escalonado de siempre", () => {
    stubWindow();
    expect(leerFlags().ocrCascada).toBe(false); // FLAGS_DEFAULT
  });

  it("saneo acepta booleano (true/false); leerFlags lo aplica sobre defaults", () => {
    expect(sanearFlags({ ocrCascada: true })).toEqual({ ocrCascada: true });
    expect(sanearFlags({ ocrCascada: false })).toEqual({ ocrCascada: false });
    stubWindow();
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ ocrCascada: true }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().ocrCascada).toBe(true); // override manual del dueño (D6 — pasa por los DOS whitelists: sanearFlags + leerOverridesFlags)
  });

  it("tipo inválido (no-booleano) → default (ausente del whitelist)", () => {
    expect(sanearFlags({ ocrCascada: "on" })).toEqual({});
    expect(sanearFlags({ ocrCascada: 1 })).toEqual({});
    expect(sanearFlags({ ocrCascada: null })).toEqual({});
    stubWindow();
    expect(leerFlags().ocrCascada).toBe(false); // cae al default conservador
  });
});
