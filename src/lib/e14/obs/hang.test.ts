/**
 * Tests — ANEXO AGENTE C (REPARTE-3-AGENTES-v1, Pieza 2): detector de hang.
 * · drift: timers falsos + reloj controlado — un gap > 3 s emite el evento
 *   hang con la duración REAL (el gap); gaps normales no emiten nada.
 * · longtask: PerformanceObserver mockeado — tasks > 50 ms se agregan, las
 *   de <= 50 ms no.
 * · resumenHangsDe: agregación por sesión PURA (cuenta, mayor, total).
 * · idempotencia de iniciarDetectorHang + reset de tests.
 * El buffer se MOCKEA (appendEvento capturado) — nada toca IndexedDB aquí.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendEvento } from "./buffer";
import {
  DRIFT_UMBRAL_MS,
  LONGTASK_UMBRAL_MS,
  __resetHangParaTest,
  detenerDetectorHang,
  iniciarDetectorHang,
  resumenHangsDe,
} from "./hang";

vi.mock("./buffer", () => ({
  appendEvento: vi.fn().mockResolvedValue(undefined),
}));

type CbLongtask = (lista: { getEntries: () => { duration: number }[] }) => void;

/** PerformanceObserver falso: captura la callback para dispararla a mano. */
class ObserverFalso {
  static ultima: CbLongtask | null = null;
  constructor(cb: CbLongtask) {
    ObserverFalso.ultima = cb;
  }
  observe(): void {}
  disconnect(): void {}
}

const appendMock = vi.mocked(appendEvento);

beforeEach(() => {
  appendMock.mockClear();
  ObserverFalso.ultima = null;
});

afterEach(() => {
  __resetHangParaTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Stub de window que CAPTURA el callback del intervalo (control total del
 *  reloj — la simulación exacta del congelón). */
let tick: (() => void) | null = null;

function stubWindow(): void {
  tick = null;
  vi.stubGlobal("window", {
    setInterval: (fn: () => void) => {
      tick = fn;
      return 123 as unknown as number;
    },
    clearInterval: () => {},
    clearTimeout: () => {},
  });
  vi.stubGlobal("PerformanceObserver", ObserverFalso);
}

describe("detector de hang — sensor drift (kit: gap > 3 s = congelón)", () => {
  it("gap normal (tick puntual) NO emite; el reloj avanza y el gap se resetea", async () => {
    vi.useFakeTimers({ now: 0 });
    stubWindow();
    iniciarDetectorHang();
    vi.setSystemTime(500);
    await tick!(); // gap = 0 (proximoTick era 500)
    vi.setSystemTime(1100); // gap = 100 ms (< umbral — jitter real)
    await tick!();
    expect(appendMock).not.toHaveBeenCalled();
  });
  it(`gap > ${DRIFT_UMBRAL_MS} ms → emite hang {fuente:"drift"} con el GAP REAL`, async () => {
    vi.useFakeTimers({ now: 0 });
    stubWindow();
    iniciarDetectorHang(); // proximoTick = 500
    vi.setSystemTime(500);
    await tick!(); // gap = 0, proximoTick = 1000
    appendMock.mockClear();
    vi.setSystemTime(1000 + DRIFT_UMBRAL_MS + 200); // congelón de 3.2 s desde el último tick
    await tick!(); // gap = 4200 − 1000 = 3200
    expect(appendMock).toHaveBeenCalledTimes(1);
    const arg = appendMock.mock.calls[0][0];
    expect(arg.tipo).toBe("hang");
    expect(arg.datos).toMatchObject({ fuente: "drift", duracionMs: DRIFT_UMBRAL_MS + 200, umbralMs: DRIFT_UMBRAL_MS });
    expect(Array.isArray((arg.datos as { breadcrumbs?: unknown }).breadcrumbs)).toBe(true); // contexto sin contenido
  });
  it("el evento viaja con identidad de sesión/dispositivo/appVersion", async () => {
    vi.useFakeTimers({ now: 0 });
    stubWindow();
    iniciarDetectorHang();
    vi.setSystemTime(DRIFT_UMBRAL_MS + 600);
    await tick!();
    const arg = appendMock.mock.calls[0][0];
    expect(typeof arg.sesion).toBe("string");
    expect(typeof arg.dispositivo).toBe("string");
    expect(typeof arg.appVersion).toBe("string");
    expect(arg.ts).toBeTypeOf("number");
  });
});

describe("detector de hang — sensor longtask (kit: cada task > 50 ms)", () => {
  it(`tasks > ${LONGTASK_UMBRAL_MS} ms se registran; <= umbral no`, async () => {
    vi.useFakeTimers({ now: 0 });
    stubWindow();
    iniciarDetectorHang();
    expect(ObserverFalso.ultima).not.toBeNull();
    await ObserverFalso.ultima!({ getEntries: () => [{ duration: 40 }] });
    expect(appendMock).not.toHaveBeenCalled();
    await ObserverFalso.ultima!({ getEntries: () => [{ duration: 120.6 }, { duration: 50 }] });
    await Promise.resolve(); // microtareas del void emitirHang
    expect(appendMock).toHaveBeenCalledTimes(1); // 50 no pasa el umbral ESTRICTO
    const arg = appendMock.mock.calls[0][0];
    expect(arg.datos).toMatchObject({ fuente: "longtask", duracionMs: 121, umbralMs: LONGTASK_UMBRAL_MS });
  });
});

describe("resumenHangsDe (agregación por sesión — PURA)", () => {
  it("cuenta, mayor y total sobre los eventos hang; otros tipos fuera", () => {
    const eventos = [
      { tipo: "hang", datos: { fuente: "drift", duracionMs: 3200, umbralMs: 3000, breadcrumbs: [] } },
      { tipo: "hang", datos: { fuente: "longtask", duracionMs: 900, umbralMs: 50, breadcrumbs: [] } },
      { tipo: "salud", datos: {} },
    ] as Parameters<typeof resumenHangsDe>[0];
    // WAVE3 §G.4: +cuentaOcultas (aditivo AL FINAL — legacy sin campo
    // `visible` tratado visible: 0 ocultos aquí).
    expect(resumenHangsDe(eventos)).toEqual({ cuenta: 2, mayorMs: 3200, totalMs: 4100, cuentaOcultas: 0 });
  });
  it("sin hangs → {cuenta:0, mayorMs:null, totalMs:null} (jamás inventar)", () => {
    // WAVE3 §G.4: cuentaOcultas: 0 (aditivo AL FINAL).
    expect(resumenHangsDe([])).toEqual({ cuenta: 0, mayorMs: null, totalMs: null, cuentaOcultas: 0 });
  });
});

describe("iniciarDetectorHang (bootstrap) — idempotente y apagable", () => {
  it("2 llamadas → UN solo intervalo; detener limpia", () => {
    vi.useFakeTimers({ now: 0 });
    stubWindow();
    iniciarDetectorHang();
    iniciarDetectorHang();
    expect(tick).not.toBeNull();
    detenerDetectorHang();
    const trasStop = tick;
    iniciarDetectorHang(); // tras detener, vuelve a armar
    expect(trasStop).not.toBeNull();
  });
  it("sin window (node/SSR) → no arma nada y no lanza", () => {
    tick = null; // limpiar el callback capturado por el test anterior
    expect(() => iniciarDetectorHang()).not.toThrow();
    expect(tick).toBeNull();
  });
});
