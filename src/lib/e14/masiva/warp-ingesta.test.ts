/**
 * Tests del KIT flujo-dueno-v1 (K2 — brief Agente B) — warp-ingesta.ts +
 * rotacionDesdeCentroide (orientacion-qr.ts, sub-commit 2).
 *
 * Patrón del repo (prescan-qr.test.ts / sondeo-cadena.test.ts): deps
 * inyectables + fakes — NUNCA worker/IDB reales. La procesadora por fila
 * se inyecta (__setProcesadoraWarpIngestaParaTest) y el dormir también
 * (__setDormirWarpIngestaParaTest) — el bombeo, la cortesía y la propiedad
 * se prueban CONDUCTUALMENTE; el pipeline browser-real (decode/detect/
 * warp) queda cubierto por tsc + el smoke de campo del dueño (honesto:
 * mismos límites del pre-scan e107 — sus tests tampoco abren workers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dependencias DOM/core de orientacion-qr mockeadas (patrón orientacion.mini.
// test.ts / completitud.test.ts): image-utils importa @jg-stevan/scanner-core/
// image-processor (NO resuelve en node) — lo que rotacionDesdeCentroide usa es
// la aritmética PURA del módulo (cuadrante + tabla), cero canvas/zxing.
vi.mock("../image-utils", () => ({
  canvasCon: vi.fn(),
  loadImageMemo: vi.fn(),
}));
vi.mock("../orientacion", () => ({
  anilloGanadorRegistrar: vi.fn(),
  ganadorPersistente: vi.fn(() => null),
}));
vi.mock("./identidad-qr", () => ({
  moduloZxingDe: vi.fn(),
  qrCorto: vi.fn(),
}));

// Cliente del detection-worker mockeado (en node NO hay Worker — el real
// daría abort honesto SIEMPRE). El flag abortar simula el lector caído.
// vi.hoisted: el factory del mock corre durante la evaluación de imports —
// ANTES de las const del módulo de prueba (TDZ — mismo patrón del repo).
const estadoCliente = vi.hoisted(() => ({ abortar: false }));
vi.mock("./prescan-qr.client", () => ({
  DETECT_LONG_SIDE: 400,
  crearClientePrescan: () => ({
    listo: async () => !estadoCliente.abortar,
    detectar: vi.fn(async () => null),
    warpar: vi.fn(async () => null),
    destruir: () => {},
  }),
  // El abort honesto del test real se mapea al flag (fábrica que tira ⇒
  // listo() false — mismo desenlace que un OpenCV sin boot).
  __setFabricaWorkerDeteccionParaTest: (f: unknown) => {
    estadoCliente.abortar = f != null;
  },
  downscaleLado: vi.fn(),
  quadDeFracciones: vi.fn(),
}));

import {
  CORTECIA_PASO_MS,
  CORTECIA_TOPE_MS,
  ESPERA_COLA_TOPE_MS,
  __registrarDepsWarpIngesta,
  __resetWarpIngestaParaTest,
  __setDormirWarpIngestaParaTest,
  __setProcesadoraWarpIngestaParaTest,
  encolarWarpIngesta,
  estampaDeIngesta,
  esperarColaWarpIngesta,
  filaBajoWarpIngesta,
  marcarCadenaDedupEnVuelo,
  type DecisionIngesta,
  type DepsWarpIngesta,
  type EstampaIngesta,
  type FlagsEstampa,
} from "./warp-ingesta";
// (mockeado arriba — la versión de prueba del flag abortar)
import { __setFabricaWorkerDeteccionParaTest } from "./prescan-qr.client";
import { rotacionDesdeCentroide } from "../orientacion-qr";
import type { Quad } from "@jg-stevan/scanner-core/types";
import type { FilaMasiva } from "./tipos";

// ─── Estado de prueba ───────────────────────────────────────────────────────

interface FilaPrueba {
  id: string;
  estado: FilaMasiva["estado"];
  forzarDedupOff?: boolean;
  patches: Partial<FilaMasiva>[];
}

function filasDe(
  defs: { id: string; estado?: FilaMasiva["estado"]; forzarDedupOff?: boolean }[],
): FilaPrueba[] {
  return defs.map((d) => ({
    id: d.id,
    estado: d.estado ?? "PENDIENTE",
    ...(d.forzarDedupOff ? { forzarDedupOff: true } : {}),
    patches: [],
  }));
}

function depsDe(filas: FilaPrueba[], registrados: string[] = []): DepsWarpIngesta {
  return {
    storeState: () => ({
      filas: filas as unknown as FilaMasiva[],
      actualizarFila: (id: string, patch: Partial<FilaMasiva>) => {
        const f = filas.find((x) => x.id === id);
        if (f) {
          f.patches.push(patch);
          Object.assign(f, patch);
        }
      },
    }),
    registrarQrPayload: (payload: string, id: string) => {
      registrados.push(`${id}:${payload}`);
    },
    qrPayloadDeFila: (id: string) => (id === "f1" ? "PAYLOAD-SONDEO-f1" : null),
  };
}

/** Dormir de prueba: paso REAL corto (la cortesía sondea Date.now() real —
 *  sin hot-spin del microtask queue). */
const dormirRapido = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.min(ms, 8)));

async function drenar(): Promise<void> {
  await vi.waitFor(() => expect(filaBajoWarpIngesta("f1")).toBe(false));
  // margen para el finally del bombeo
  await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  __resetWarpIngestaParaTest();
  __setDormirWarpIngestaParaTest(dormirRapido);
  __setProcesadoraWarpIngestaParaTest(null);
  __setFabricaWorkerDeteccionParaTest(null); // lector disponible por defecto (mock)
});

afterEach(() => {
  __resetWarpIngestaParaTest();
  __setDormirWarpIngestaParaTest(null);
  __setProcesadoraWarpIngestaParaTest(null);
  __registrarDepsWarpIngesta(null);
  vi.restoreAllMocks();
});

// ─── Cola serial (brief sub-commit 1 punto 3) ───────────────────────────────

describe("K2 · warp-ingesta — cola serial (1 a la vez, FIFO)", () => {
  it("procesa en orden FIFO SIN solapamiento (serial por construcción)", async () => {
    const filas = filasDe([{ id: "f1" }, { id: "f2" }, { id: "f3" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    const orden: string[] = [];
    let enVuelo = 0;
    let solape = false;
    __setProcesadoraWarpIngestaParaTest(async (id) => {
      if (enVuelo > 0) solape = true;
      enVuelo++;
      await new Promise((r) => setTimeout(r, 10));
      orden.push(id);
      enVuelo--;
    });
    encolarWarpIngesta("f1");
    encolarWarpIngesta("f2");
    encolarWarpIngesta("f3");
    await drenar();
    expect(orden).toEqual(["f1", "f2", "f3"]);
    expect(solape).toBe(false);
  });

  it("encolar es idempotente (la misma fila no entra dos veces)", async () => {
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    const llamadas: string[] = [];
    __setProcesadoraWarpIngestaParaTest(async (id) => {
      llamadas.push(id);
    });
    encolarWarpIngesta("f1");
    encolarWarpIngesta("f1"); // duplicado mientras está en cola
    encolarWarpIngesta("f1"); // duplicado en vuelo o ya pasada
    await drenar();
    expect(llamadas).toEqual(["f1"]);
  });

  it("filaBajoWarpIngesta: true encolada/en vuelo, false tras decidir", async () => {
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    let liberar: (() => void) | null = null;
    __setProcesadoraWarpIngestaParaTest(
      async () =>
        await new Promise<void>((r) => {
          liberar = r;
        }),
    );
    encolarWarpIngesta("f1");
    await vi.waitFor(() => expect(liberar).not.toBeNull());
    expect(filaBajoWarpIngesta("f1")).toBe(true); // en vuelo
    liberar!();
    await drenar();
    expect(filaBajoWarpIngesta("f1")).toBe(false); // decidida — el prescan asegurador la ve
  });
});

// ─── Cortesía de CPU (brief sub-commit 1 punto 3) ───────────────────────────

describe("K2 · warp-ingesta — cortesía de CPU hacia cadenaDedup", () => {
  it("cede mientras cadenaDedup está en vuelo y arranca al liberarse", async () => {
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    const pasos: number[] = [];
    __setDormirWarpIngestaParaTest(async (ms) => {
      pasos.push(ms);
      await new Promise((r) => setTimeout(r, 1));
    });
    marcarCadenaDedupEnVuelo(true); // la subida tiene prioridad
    const llamadas: string[] = [];
    __setProcesadoraWarpIngestaParaTest(async (id) => {
      llamadas.push(id);
    });
    encolarWarpIngesta("f1");
    await new Promise((r) => setTimeout(r, 30));
    expect(llamadas).toEqual([]); // todavía cediendo
    expect(pasos).toContain(CORTECIA_PASO_MS); // sondeó la cortesía
    marcarCadenaDedupEnVuelo(false); // la cadena terminó
    await drenar();
    expect(llamadas).toEqual(["f1"]);
  });

  it("tope de cortesía: la fila procesa AUNQUE cadenaDedup siga en vuelo (nunca bloquea)", async () => {
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    marcarCadenaDedupEnVuelo(true); // atascada TODO el tope
    const llamadas: string[] = [];
    __setProcesadoraWarpIngestaParaTest(async (id) => {
      llamadas.push(id);
    });
    encolarWarpIngesta("f1");
    await vi.waitFor(() => expect(llamadas).toEqual(["f1"]), { timeout: CORTECIA_TOPE_MS + 2000 });
    marcarCadenaDedupEnVuelo(false); // limpieza (el contador no queda pegado)
  }, 10_000);
});

// ─── Abort honesto (lector no disponible) ───────────────────────────────────

describe("K2 · warp-ingesta — abort honesto (§G e107)", () => {
  it("lector no bootea → cola SIN estamps y SIN zombis de propiedad", async () => {
    const filas = filasDe([{ id: "f1" }, { id: "f2" }]);
    const registrados: string[] = [];
    __registrarDepsWarpIngesta(depsDe(filas, registrados));
    const llamadas: string[] = [];
    __setProcesadoraWarpIngestaParaTest(async (id) => {
      llamadas.push(id);
    });
    // Fábrica que TIRA ⇒ lector no disponible (abort honesto — sin boot timeout)
    __setFabricaWorkerDeteccionParaTest(() => {
      throw new Error("no-worker");
    });
    encolarWarpIngesta("f1");
    encolarWarpIngesta("f2");
    await drenar();
    await vi.waitFor(() => expect(filaBajoWarpIngesta("f2")).toBe(false));
    expect(llamadas).toEqual([]); // la procesadora JAMÁS corrió
    expect(registrados).toEqual([]); // sin payloads registrados
    expect(filaBajoWarpIngesta("f1")).toBe(false); // propiedad limpia
    expect(filas[0]!.patches).toEqual([]); // sin stamps — el prescan asegurador decide
  });
});

// ─── Espera del asegurador (punto 7 del brief + §P5-residual) ──────────────

describe("K2 · esperarColaWarpIngesta (drena antes del barrido de cierre)", () => {
  it("true cuando la cola drena (encolada + en vuelo)", async () => {
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    let liberar: (() => void) | null = null;
    __setProcesadoraWarpIngestaParaTest(
      async () =>
        await new Promise<void>((r) => {
          liberar = r;
        }),
    );
    encolarWarpIngesta("f1");
    const espera = esperarColaWarpIngesta(ESPERA_COLA_TOPE_MS);
    await new Promise((r) => setTimeout(r, 10));
    liberar!();
    await expect(espera).resolves.toBe(true);
  });

  it("false al vencer el tope con fila en vuelo (abort honesto del caller)", async () => {
    __setDormirWarpIngestaParaTest(async () => {
      await new Promise((r) => setTimeout(r, 1));
    });
    const filas = filasDe([{ id: "f1" }]);
    __registrarDepsWarpIngesta(depsDe(filas));
    let liberar: (() => void) | null = null;
    __setProcesadoraWarpIngestaParaTest(
      async () =>
        await new Promise<void>((r) => {
          liberar = r;
        }),
    );
    encolarWarpIngesta("f1");
    const espera = esperarColaWarpIngesta(30); // tope corto de prueba
    await new Promise((r) => setTimeout(r, 60));
    liberar!();
    await expect(espera).resolves.toBe(false);
  });
});

// ─── Estampa de la fila decidida (PURA — sub-commit 1 punto 4) ─────────────

describe("K2 · estampaDeIngesta (pura)", () => {
  const QUAD: Quad = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  // Tipos del contrato anclados por uso (knip limpio — mismos valores).
  const _decision: DecisionIngesta = {
    payloadWarp: null,
    heredado: null,
    quadFila: null,
    rotacion: null,
  };
  const _flags: FlagsEstampa = { masivaQrHandoff: false };
  const _salida: EstampaIngesta = estampaDeIngesta(_decision, _flags);
  void _salida;

  it("lectura OK: prescanOk + quad + rotacionSugerida del centroide", () => {
    const { patch, payloadParaRegistrar } = estampaDeIngesta(
      { payloadWarp: "PAY", heredado: null, quadFila: QUAD, rotacion: 90 },
      { masivaQrHandoff: false },
    );
    expect(patch.prescanOk).toBe(true);
    expect(patch.quad).toEqual(QUAD);
    expect(patch.rotacionSugerida).toBe(90);
    expect(patch.prioridadProceso).toBeUndefined(); // K1 sin merge — stamp preparado NO corre
    expect(payloadParaRegistrar).toBeNull(); // handoff OFF
  });

  it("lectura fallida: rotacionSugerida null EXPLÍCITO (el warp corrió y no decidió)", () => {
    const { patch } = estampaDeIngesta(
      { payloadWarp: null, heredado: null, quadFila: null, rotacion: null },
      { masivaQrHandoff: false },
    );
    expect(patch.prescanOk).toBe(true);
    expect(patch.quad).toBeUndefined(); // sin quad — ausente, jamás inventar
    expect(patch.rotacionSugerida).toBeNull();
  });

  it("hand-off: el HEREDADO manda para identidad/dedup y el warp NO se salta (la rotación sigue siendo del warp)", () => {
    const { patch, payloadParaRegistrar } = estampaDeIngesta(
      { payloadWarp: "PAY-WARP", heredado: "PAY-SONDEO", quadFila: QUAD, rotacion: 270 },
      { masivaQrHandoff: true },
    );
    expect(payloadParaRegistrar).toBe("PAY-SONDEO"); // heredado manda (misma identidad exacta)
    expect(patch.rotacionSugerida).toBe(270); // SOLO del warp (el heredado no trae ubicación)
  });

  it("registro del payload SOLO con masivaQrHandoff ON (flag OFF → mapa intacto)", () => {
    const off = estampaDeIngesta(
      { payloadWarp: "PAY", heredado: null, quadFila: null, rotacion: 0 },
      { masivaQrHandoff: false },
    );
    expect(off.payloadParaRegistrar).toBeNull();
    const on = estampaDeIngesta(
      { payloadWarp: "PAY", heredado: null, quadFila: null, rotacion: 0 },
      { masivaQrHandoff: true },
    );
    expect(on.payloadParaRegistrar).toBe("PAY");
  });

  it("stamp K1 PREPARADO: masivaPrioridad ON ⇒ 1 con QR+quad, 2 sin ellos (el campo nace con K1)", () => {
    const p1 = estampaDeIngesta(
      { payloadWarp: "PAY", heredado: null, quadFila: QUAD, rotacion: 0 },
      { masivaQrHandoff: false, masivaPrioridad: true },
    );
    expect(p1.patch.prioridadProceso).toBe(1);
    const p2 = estampaDeIngesta(
      { payloadWarp: null, heredado: null, quadFila: null, rotacion: null },
      { masivaQrHandoff: false, masivaPrioridad: true },
    );
    expect(p2.patch.prioridadProceso).toBe(2);
    const p3 = estampaDeIngesta(
      { payloadWarp: "PAY", heredado: null, quadFila: null, rotacion: 0 },
      { masivaQrHandoff: false, masivaPrioridad: true },
    );
    expect(p3.patch.prioridadProceso).toBe(2); // QR sin quad ⇒ 2 (brief K1)
  });
});

// ─── Cuadrante → rotación (sub-commit 2 — los 4 vectores del bench v8.3) ──

describe("K2 · rotacionDesdeCentroide (orientacion-qr — bench v8.3 4/4)", () => {
  it("los 4 vectores del bench: QR en TL/TR/BR/BL del warp SIN rotar ⇒ 0/270/180/90", () => {
    // El hogar del QR del E-14 es la esquina TL; foto girada α CW ⇒ QR en
    // TL(α=0) · TR(α=90) · BR(α=180) · BL(α=270) ⇒ corrección 0/270/180/90.
    expect(rotacionDesdeCentroide(0.2, 0.2)).toBe(0); // TL — α=0
    expect(rotacionDesdeCentroide(0.8, 0.2)).toBe(270); // TR — α=90
    expect(rotacionDesdeCentroide(0.8, 0.8)).toBe(180); // BR — α=180
    expect(rotacionDesdeCentroide(0.2, 0.8)).toBe(90); // BL — α=270
  });

  it("frontera del cuadrante (0.5 exacto → B/R — convención de cuadranteDesdePunto documentada)", () => {
    expect(rotacionDesdeCentroide(0.5, 0.5)).toBe(180); // BR
    expect(rotacionDesdeCentroide(0.49, 0.49)).toBe(0); // TL
    expect(rotacionDesdeCentroide(0.51, 0.49)).toBe(270); // TR
    expect(rotacionDesdeCentroide(0.49, 0.51)).toBe(90); // BL
  });
});
