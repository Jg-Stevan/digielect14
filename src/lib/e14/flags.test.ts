/**
 * Tests — flags.ts (KIT e14-observabilidad-v1, A1-C7): cadena de prioridad
 * DEFAULTS ← flags.json remoto cacheado ← overrides (kill switch manual),
 * saneo del JSON remoto y resultados de refrescarFlags (ok/sin-endpoint/
 * error) con fetch mockeado. Entorno node — window stub mínimo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetFlagsParaTest,
  FLAGS_DEFAULT,
  leerFlags,
  opcionesRescateHeic,
  refrescarFlags,
  sanearFlags,
} from "./flags";

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
      // KIT e14-capa0-qr-worker-v1 — aditivo AL FINAL (contrato D57):
      capa0QrWorker: true,
      // KIT e14-probe-mini768-v1 — aditivo AL FINAL (contrato D57):
      probeMiniLado: 1280,
      // KIT e14-heic-tope-v1 — aditivo AL FINAL (contrato D57): los mismos
      // números que publica el core (una sola fuente de verdad).
      heicTopeMp: 24,
      heicLimiteMs: 15_000,
      // KIT e14-gate-v2 — aditivo AL FINAL (contrato D57): auto-envío con recorte
      autoEnvioConRecorte: true,
      // KIT e14-velocidad-5s-v1 — aditivo AL FINAL (contrato D57): los tres
      // knobs del puesto rápido (tope de trabajo, teatro de ANALIZANDO y el
      // orden del intento 1 de OCR).
      ladoMaxTrabajoPx: 2560,
      pisoEscenicoMs: 300,
      ocrPrimeraPasadaRapida: true,
      importRutaCorta: true,
      // KIT e14-velocidad-5s-v1 (fase rec) — aditivo AL FINAL (contrato D57):
      // los knobs del tensor del rec y el ahorro del segundo warp. `ocrRecWmax`
      // /`ocrRecLote`/`ocrLeerBw`/`ocrRecSuave`/`ocrRecWfija` siguen en su valor
      // de siempre; 40/14/14/7 es la candidata A/B/A del 2026-11-05 (6/6
      // auto-envío con los MISMOS scores de la serie de 48/0/0/8).
      ocrRecWmax: 480,
      ocrRecAltura: 40,
      ocrRecLote: 6,
      ocrLeerBw: false,
      ocrRecSuave: false,
      ocrRecWfija: false,
      ocrRecCabecera: 14,
      ocrRecPie: 14,
      ocrRecBordesRescate: 7,
      ladoOcrPx: 0,
      cierreInstantaneo: false,
      qrBrujulaWarpPases: 0,
      ocrReOcrRoi: false,
      ocrSegundaTopeMs: 0,
      ocrCorteIncompleta: true,
      // KIT e14-remediacion-movil-v1 (A1) — aditivo AL FINAL (contrato D57):
      // ventana de ARRANQUE de la 2.ª pasada como override MANUAL del dueño.
      ocrSegundaPresupuestoMs: null,
    });
  });

  it("KIT e14-heic-tope-v1 — el kill switch del rescate HEIC es 0, no ausente", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ heicTopeMp: 0, heicLimiteMs: 0 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    // 0 = «sin tope / sin límite» = el camino anterior (antes de topar, un 50 MP
    // colgaba 120 s y el acta moría sin traza). Que 0 sobreviva es el punto.
    expect(opcionesRescateHeic()).toEqual({ topeMpHeic: 0, limiteMsHeic: 0 });
    // Y el saneo no convierte basura en un número cualquiera: fuera de rango o
    // no-numérico ⇒ la clave no se aplica y manda el default.
    expect(sanearFlags({ heicTopeMp: 500, heicLimiteMs: -1 })).toEqual({
      heicTopeMp: 60,
      heicLimiteMs: 0,
    });
    expect(sanearFlags({ heicTopeMp: "24" })).toEqual({});
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

describe("flags · probeMiniLado (lado de la miniatura del sondeo — KIT e14-probe-mini768-v1)", () => {
  it('default 1280 · override {"probeMiniLado":320} = kill-switch al comportamiento anterior', () => {
    stubWindow();
    expect(leerFlags().probeMiniLado).toBe(1280); // FLAGS_DEFAULT
  });

  it("saneo: número clampeado 320..1280; inválido → ausente (mandan los defaults)", () => {
    expect(sanearFlags({ probeMiniLado: 768 })).toEqual({ probeMiniLado: 768 });
    expect(sanearFlags({ probeMiniLado: 320 })).toEqual({ probeMiniLado: 320 });
    expect(sanearFlags({ probeMiniLado: 64 })).toEqual({ probeMiniLado: 320 }); // jamás un lienzo 0
    expect(sanearFlags({ probeMiniLado: 9999 })).toEqual({ probeMiniLado: 1280 });
    expect(sanearFlags({ probeMiniLado: "ancho" })).toEqual({});
    expect(sanearFlags({ probeMiniLado: Number.NaN })).toEqual({});
  });

  it("override manual (localStorage) manda sobre el default (D6)", () => {
    vi.stubGlobal("window", {
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? JSON.stringify({ probeMiniLado: 320 }) : null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(leerFlags().probeMiniLado).toBe(320);
  });
});

// ─── KIT e14-velocidad-5s-v1 — INVARIANTE del doble whitelist (D6) ─────────
describe("flags · cada clave de FLAGS_DEFAULT tiene sus DOS puertas", () => {
  it("sanearFlags (flags.json remoto) Y leerOverridesFlags (localStorage) aceptan todas", async () => {
    const { leerOverridesFlags } = await import("./obs/politica");
    const sinPuertaRemota: string[] = [];
    const sinPuertaLocal: string[] = [];
    for (const [clave, valor] of Object.entries(FLAGS_DEFAULT)) {
      if (!(clave in sanearFlags({ [clave]: valor }))) sinPuertaRemota.push(clave);
      vi.stubGlobal("window", {
        setTimeout: () => 0,
        clearTimeout: () => {},
        localStorage: {
          getItem: (k: string) =>
            k === "e14-flags-overrides" ? JSON.stringify({ [clave]: valor }) : null,
          setItem: () => {},
          removeItem: () => {},
        },
      });
      if (!(clave in leerOverridesFlags())) sinPuertaLocal.push(clave);
    }
    // «cada puerta su línea»: un flag sin su línea en politica.ts es un
    // kill-switch MUERTO — el override manual del dueño (máxima prioridad, D6)
    // jamás llega. Dos flag del kit lo estuvieron hasta este test.
    expect(sinPuertaRemota, `sin puerta en sanearFlags: ${sinPuertaRemota.join(",")}`).toEqual([]);
    expect(sinPuertaLocal, `sin puerta en leerOverridesFlags: ${sinPuertaLocal.join(",")}`).toEqual([]);
  });
});
