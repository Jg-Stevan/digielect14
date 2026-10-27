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
  // KIT e73-sondeo-qr-precoz-v1 (§D) — whitelist aditiva (claves conocidas):
  it("e73 · sondeoQrPrecoz/sondeoQrPresupuestoMs: override válido acepta; tipo inválido → default", () => {
    // Override válido — aceptado (el presupuesto se CLAMPA al rango 500..30000):
    expect(
      sanearFlags({ sondeoQrPrecoz: false, sondeoQrPresupuestoMs: 4000 }),
    ).toEqual({ sondeoQrPrecoz: false, sondeoQrPresupuestoMs: 4000 });
    expect(sanearFlags({ sondeoQrPresupuestoMs: 99_999 })).toEqual({ sondeoQrPresupuestoMs: 30_000 });
    // Tipo inválido → ausente (el caller conserva el default — jamás inventar):
    expect(sanearFlags({ sondeoQrPrecoz: "sí", sondeoQrPresupuestoMs: "2500" })).toEqual({});
    expect(sanearFlags({ sondeoQrPresupuestoMs: Number.NaN })).toEqual({});
    // Claves desconocidas siguen rechazadas (el saneo no abre la puerta):
    expect(sanearFlags({ sondeoQrLado: 999 })).toEqual({});
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

  it("P1 · masivaQrHandoff (brief Agente A) — whitelist aditiva, default OFF", () => {
    stubWindow();
    // Default OFF (byte-idéntico a 5d08dd6 — kill-switch del dueño):
    expect(FLAGS_DEFAULT.masivaQrHandoff).toBe(false);
    expect(leerFlags().masivaQrHandoff).toBe(false);
    // El override del dueño pasa el saneo (booleano):
    expect(sanearFlags({ masivaQrHandoff: true })).toEqual({ masivaQrHandoff: true });
    expect(sanearFlags({ masivaQrHandoff: false })).toEqual({ masivaQrHandoff: false });
    // Tipo inválido → ausente (el caller conserva el default — jamás inventar):
    expect(sanearFlags({ masivaQrHandoff: "on" })).toEqual({});
    expect(sanearFlags({ masivaQrHandoff: 1 })).toEqual({});
  });

  // KIT e14-quad-streaming-v1 (§D) — whitelist aditiva (booleanos P4/P5):
  it("quad-streaming · masivaQuad/masivaStreaming: overrides válidos aceptan; tipos inválidos → default", () => {
    // Overrides válidos — aceptados (kill switches del dueño):
    expect(sanearFlags({ masivaQuad: true, masivaStreaming: true })).toEqual({
      masivaQuad: true,
      masivaStreaming: true,
    });
    expect(sanearFlags({ masivaQuad: false })).toEqual({ masivaQuad: false });
    // Tipos inválidos → ausentes (el caller conserva el default — jamás inventar):
    expect(sanearFlags({ masivaQuad: "sí", masivaStreaming: 1 })).toEqual({});
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
      // KIT e73-sondeo-qr-precoz-v1 (§D) — aditivos AL FINAL (contrato D57):
      sondeoQrPrecoz: true,
      sondeoQrPresupuestoMs: 2500,
      // KIT e14-obs-hang-atribucion-v1 (§D) — aditivo AL FINAL (contrato D57):
      hangEnCurso: true,
      // KIT e107-prescan-qr-cola-v1 (§D.4) — aditivo AL FINAL (contrato D57):
      prescanQrCola: true,
      // KIT e14-orientacion-qr-v1 (§D) — aditivo AL FINAL (contrato D57):
      qrBrujulaOrientacion: true,
      // P1 (plan masiva — brief Agente A) — aditivo AL FINAL (contrato D57):
      masivaQrHandoff: false,
      // KIT e14-quad-streaming-v1 (§D) — aditivos AL FINAL (contrato D57):
      // defaults OFF — byte-idéntico a 5d08dd6 (kill-switches del dueño).
      masivaQuad: false,
      masivaStreaming: false,
      // KIT e14-dhash-resize-v1 (§D) — aditivo AL FINAL (contrato D57):
      dhashResize: false,
      // KIT e14-ocr-cascada-v1 (K3 fase 2) — aditivo AL FINAL (contrato D57):
      masivaOcrTesseract: false,
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

// ─── KIT e14-dhash-resize-v1 (§D, T4 ≥ 2) — flag dhashResize (parche P3) ───
describe("flags · dhashResize (decode chico del dhash — kill-switch P3)", () => {
  it("default OFF → byte-idéntico a 5d08dd6 (decode FULL del dhash)", () => {
    stubWindow();
    expect(leerFlags().dhashResize).toBe(false); // FLAGS_DEFAULT.dhashResize
  });

  it("saneo acepta booleano (true/false); leerFlags lo aplica sobre defaults", () => {
    expect(sanearFlags({ dhashResize: true })).toEqual({ dhashResize: true });
    expect(sanearFlags({ dhashResize: false })).toEqual({ dhashResize: false });
    stubWindow();
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) => (k === "e14-flags-overrides" ? JSON.stringify({ dhashResize: true }) : null),
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().dhashResize).toBe(true); // override manual del dueño (D6 — pasa por los DOS whitelists: sanearFlags + leerOverridesFlags)
  });

  it("tipo inválido (no-booleano) → default (ausente del whitelist)", () => {
    expect(sanearFlags({ dhashResize: "sí" })).toEqual({});
    expect(sanearFlags({ dhashResize: 1 })).toEqual({});
    expect(sanearFlags({ dhashResize: null })).toEqual({});
    stubWindow();
    expect(leerFlags().dhashResize).toBe(false); // cae al default conservador
  });
});

// ─── KIT e14-ocr-cascada-v1 (K3 fase 2) — flag masivaOcrTesseract ──────────
describe("flags · masivaOcrTesseract (cascada OCR — kill-switch K3)", () => {
  it("default OFF → byte-idéntico al OCR escalonado de siempre", () => {
    stubWindow();
    expect(leerFlags().masivaOcrTesseract).toBe(false); // FLAGS_DEFAULT
  });

  it("saneo acepta booleano (true/false); leerFlags lo aplica sobre defaults", () => {
    expect(sanearFlags({ masivaOcrTesseract: true })).toEqual({ masivaOcrTesseract: true });
    expect(sanearFlags({ masivaOcrTesseract: false })).toEqual({ masivaOcrTesseract: false });
    stubWindow();
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ masivaOcrTesseract: true }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().masivaOcrTesseract).toBe(true); // override manual del dueño (D6 — pasa por los DOS whitelists: sanearFlags + leerOverridesFlags)
  });

  it("tipo inválido (no-booleano) → default (ausente del whitelist)", () => {
    expect(sanearFlags({ masivaOcrTesseract: "on" })).toEqual({});
    expect(sanearFlags({ masivaOcrTesseract: 1 })).toEqual({});
    expect(sanearFlags({ masivaOcrTesseract: null })).toEqual({});
    stubWindow();
    expect(leerFlags().masivaOcrTesseract).toBe(false); // cae al default conservador
  });
});
