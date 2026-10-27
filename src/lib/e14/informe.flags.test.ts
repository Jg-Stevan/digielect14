/**
 * Tests — W0 (KIT k1-obs-prioridad — brief Agente A): snapshot de FLAGS del
 * informe (observabilidad — atribución de mediciones).
 *  1. lineaFlagsPipeline: formato ESTABLE del txt — SOLO flags masiva* y
 *     dhash* en orden de declaración, booleanos 1/0, prefijo `[e14] flags:`.
 *  2. overridesCrudosFlags: JSON crudo de localStorage (CLAVE_OVERRIDES) —
 *     sin window → {} · sin clave → {} · corrupto → {} · array → {}
 *     (jamás lanza — el informe no muere por observabilidad).
 * PATRÓN: flags.test.ts (vi.stubGlobal de window) + helpers PURO del
 * informe.ts (misma doctrina del renderTxt/filaLiviana).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineaFlagsPipeline, overridesCrudosFlags } from "./informe";
import { FLAGS_DEFAULT } from "./flags";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("W0 k1 · lineaFlagsPipeline (formato estable para el parser del dueño)", () => {
  it("41 · defaults → SOLO masiva* y dhash* con 1/0, en orden de FLAGS_DEFAULT", () => {
    const linea = lineaFlagsPipeline(FLAGS_DEFAULT);
    // Prefijo propio (D51 — parsers por prefijo del dueño).
    expect(linea.startsWith("[e14] flags: ")).toBe(true);
    // SOLO los flags del pipeline masiva — en orden de declaración,
    // booleanos como 1/0 (formato fijo: clave=valor separado por espacios).
    // W1 añadió masivaPrioridad a FLAGS_DEFAULT — la línea lo incluye (el
    // test 43 de abajo ya anticipaba el gesto: crece por la COLA, jamás
    // reordena).
    expect(linea).toBe(
      "[e14] flags: masivaQrHandoff=0 masivaQuad=0 masivaStreaming=0 dhashResize=0 masivaPrioridad=0",
    );
  });

  it("42 · flags ON → 1 (atribución de la corrida)", () => {
    expect(
      lineaFlagsPipeline({ ...FLAGS_DEFAULT, masivaQuad: true, dhashResize: true }),
    ).toBe(
      "[e14] flags: masivaQrHandoff=0 masivaQuad=1 masivaStreaming=0 dhashResize=1 masivaPrioridad=0",
    );
  });

  it("43 · flag nuevo del pipeline (masiva*) entra SOLO en la línea, sin romper el formato", () => {
    // El flag de W1 (masivaPrioridad) viaja en la línea en cuanto exista en
    // FLAGS_DEFAULT — el parser del dueño lee clave=valor, no posiciones.
    const conPrioridad = lineaFlagsPipeline({
      ...FLAGS_DEFAULT,
      masivaPrioridad: true,
    } as typeof FLAGS_DEFAULT);
    expect(conPrioridad).toBe(
      "[e14] flags: masivaQrHandoff=0 masivaQuad=0 masivaStreaming=0 dhashResize=0 masivaPrioridad=1",
    );
  });

  it("44 · flags NO-pipeline (poolWorkers/endpointReportes/…) JAMÁS aparecen", () => {
    const linea = lineaFlagsPipeline(FLAGS_DEFAULT);
    expect(linea).not.toContain("poolWorkers");
    expect(linea).not.toContain("thumbsOn");
    expect(linea).not.toContain("prescanQrCola");
    expect(linea).not.toContain("qrBrujulaOrientacion");
    expect(linea).not.toContain("sondeoQr");
    expect(linea).not.toContain("hangEnCurso");
  });
});

describe("W0 k1 · overridesCrudosFlags (JSON crudo — contexto del kill switch)", () => {
  it("45 · sin window (SSR/vitest node) → {} — jamás lanza", () => {
    expect(overridesCrudosFlags()).toEqual({});
  });

  it("46 · clave ausente → {}", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (_k: string) => null,
        setItem: () => {},
      },
    });
    expect(overridesCrudosFlags()).toEqual({});
  });

  it("47 · JSON válido → el objeto CRUDO tal cual (sin sanear — overridesCrudos)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides"
            ? JSON.stringify({ masivaQuad: true, claveDesconocida: 7 })
            : null,
        setItem: () => {},
      },
    });
    // CRUDO: claves que el saneo descartaría TAMBIÉN viajan (es contexto,
    // no configuración — leerFlags sigue siendo quien manda).
    expect(overridesCrudosFlags()).toEqual({
      masivaQuad: true,
      claveDesconocida: 7,
    });
  });

  it("48 · JSON corrupto / array / no-objeto → {} (conservador)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) =>
          k === "e14-flags-overrides" ? "{esto no es json" : null,
        setItem: () => {},
      },
    });
    expect(overridesCrudosFlags()).toEqual({});
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k === "e14-flags-overrides" ? "[1,2,3]" : null),
        setItem: () => {},
      },
    });
    expect(overridesCrudosFlags()).toEqual({});
  });
});
