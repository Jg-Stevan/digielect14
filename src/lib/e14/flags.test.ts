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
      // KIT e14-ocr-cascada-v1 (K3 fase 2) + GO-B del dueño (2026-11) — aditivo AL FINAL (contrato D57):
      ocrCascada: true,
      // KIT e14-adaptacion-dispositivo-v1 — aditivo AL FINAL (contrato D57):
      adaptacionDispositivo: true,
      // KIT e14-ocr-tessbest-v1 (GO-B) — aditivo AL FINAL (contrato D57):
      presupuestoEscaneoMs: null,
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
describe("flags · ocrCascada (cascada OCR GO-B; renombrado del antiguo masivaOcrTesseract)", () => {
  it("default ON (GO-B del dueño 2026-11: tess best primero, escalonado a pp ocr)", () => {
    stubWindow();
    expect(leerFlags().ocrCascada).toBe(true); // FLAGS_DEFAULT
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
          k === "e14-flags-overrides" ? JSON.stringify({ ocrCascada: false }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().ocrCascada).toBe(false); // kill-switch manual del dueño (D6 — pasa por los DOS whitelists: sanearFlags + leerOverridesFlags)
  });

  it("tipo inválido (no-booleano) → default (ausente del whitelist)", () => {
    expect(sanearFlags({ ocrCascada: "on" })).toEqual({});
    expect(sanearFlags({ ocrCascada: 1 })).toEqual({});
    expect(sanearFlags({ ocrCascada: null })).toEqual({});
    stubWindow();
    expect(leerFlags().ocrCascada).toBe(true); // cae al default del GO-B
  });
});

describe("flags · presupuestoEscaneoMs (presupuesto del escaneo — override MANUAL del dueño, KIT e14-ocr-tessbest-v1)", () => {
  it("default null ⇒ el plan por tier resuelve (BAJO 480 s · MEDIO 240 s · ALTO 120 s)", () => {
    stubWindow();
    expect(leerFlags().presupuestoEscaneoMs).toBe(null); // FLAGS_DEFAULT
  });

  it("saneo: número clampeado 30_000..900_000; null pasa; inválido → ausente", () => {
    expect(sanearFlags({ presupuestoEscaneoMs: 240_000 })).toEqual({ presupuestoEscaneoMs: 240_000 });
    expect(sanearFlags({ presupuestoEscaneoMs: 5_000 })).toEqual({ presupuestoEscaneoMs: 30_000 });
    expect(sanearFlags({ presupuestoEscaneoMs: 9_999_999 })).toEqual({ presupuestoEscaneoMs: 900_000 });
    expect(sanearFlags({ presupuestoEscaneoMs: null })).toEqual({ presupuestoEscaneoMs: null });
    expect(sanearFlags({ presupuestoEscaneoMs: "largo" })).toEqual({});
    expect(sanearFlags({ presupuestoEscaneoMs: Number.NaN })).toEqual({});
  });

  it("override manual (localStorage) manda sobre el plan (D6 — DOBLE whitelist)", () => {
    stubWindow();
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ presupuestoEscaneoMs: 60_000 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().presupuestoEscaneoMs).toBe(60_000);
  });
});
