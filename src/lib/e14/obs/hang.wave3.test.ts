/**
 * Tests — WAVE3 §G.4 (ORDEN-WAVE3-add-envio-individual-v1): hang HONESTO.
 *  · tickDrift con document HIDDEN → re-sincroniza y NO emite (el SO
 *    congela los timers en background: el gap NO es congelón — fantasma
 *    real del informe 1230: 117 s de pantalla bloqueada).
 *  · visibilitychange → al volver a "visible" re-sincroniza proximoTick
 *    (el primer tick post-resume NO es fantasma); detener limpia el
 *    listener.
 *  · resumenHangsDe: cuenta/mayor/total SOLO visibles; ocultos →
 *    cuentaOcultas; legacy sin campo `visible` → tratado visible.
 * Patrón: hang.test.ts (timers falsos + reloj controlado + window capturado;
 * buffer MOCKEADO — nada toca IndexedDB).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendEvento } from "./buffer";
import {
  DRIFT_TICK_MS,
  __resetHangParaTest,
  detenerDetectorHang,
  iniciarDetectorHang,
  resumenHangsDe,
} from "./hang";

vi.mock("./buffer", () => ({
  appendEvento: vi.fn().mockResolvedValue(undefined),
}));

const appendMock = vi.mocked(appendEvento);

type CbVisibilidad = (e: { name: string }) => void;

/** window falso que captura el callback del intervalo (control del reloj). */
let tick: (() => void) | null = null;
/** document falso con visibilidad MUTABLE + listener capturado. */
let documento: {
  visibilityState: "visible" | "hidden";
  addEventListener: (t: string, cb: CbVisibilidad) => void;
  removeEventListener: (t: string, cb: CbVisibilidad) => void;
};
let listenerVisibilidad: CbVisibilidad | null = null;

function stubWindowYDocumento(estado: "visible" | "hidden"): void {
  tick = null;
  listenerVisibilidad = null;
  documento = {
    visibilityState: estado,
    addEventListener: (t, cb) => {
      if (t === "visibilitychange") listenerVisibilidad = cb;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", {
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    clearTimeout: vi.fn(),
  });
  vi.stubGlobal("document", documento);
}

beforeEach(() => {
  appendMock.mockClear();
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  __resetHangParaTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WAVE3 §G.4 — tickDrift honesto (background ≠ congelón)", () => {
  it("document HIDDEN → re-sincroniza y NO emite; al volver a visible NO hay fantasma", () => {
    stubWindowYDocumento("visible");
    iniciarDetectorHang();
    expect(tick).not.toBeNull();

    // tick normal en primer plano: sin gap, sin emisión
    tick!();
    expect(appendMock).not.toHaveBeenCalled();

    // EL PATRÓN DEL INFORME 1230: el cel se bloquea 120 s (timers del SO
    // congelados — el intervalo NO corre en background). Al reactivarse el
    // sistema dispara UN tick con 120 s de atraso:
    vi.setSystemTime(120_000);
    documento.visibilityState = "hidden";
    tick!(); // tick en background → re-sincroniza, NO emite
    expect(appendMock).not.toHaveBeenCalled();

    // resume (visible) + 1 s después: el gap cruzó background → SIN fantasma
    vi.setSystemTime(121_000);
    documento.visibilityState = "visible";
    tick!();
    expect(appendMock).not.toHaveBeenCalled(); // sin el fix: emitiría ~120 s

    // un congelón REAL en primer plano SÍ se emite (el sensor sigue vivo):
    vi.setSystemTime(121_000 + DRIFT_TICK_MS + 3_001);
    tick!();
    expect(appendMock).toHaveBeenCalledTimes(1);
    const h = appendMock.mock.calls[0][0] as { datos: { visible?: boolean } };
    expect(h.datos.visible).toBe(true); // etiquetado visible (D57 AL FINAL)
  });

  it("visibilitychange → visible re-sincroniza proximoTick (primer tick post-resume sin fantasma)", () => {
    stubWindowYDocumento("visible");
    iniciarDetectorHang();
    expect(listenerVisibilidad).not.toBeNull(); // el listener quedó armado

    tick!(); // sync en primer plano
    // 60 s de background (ningún tick corrió — timers congelados):
    vi.setSystemTime(60_000);
    // el SO entrega visibilitychange al volver:
    documento.visibilityState = "visible";
    listenerVisibilidad!({ name: "visibilitychange" });
    // primer tick post-resume: re-sincronizado → sin emisión fantasma
    tick!();
    expect(appendMock).not.toHaveBeenCalled();

    detenerDetectorHang();
    expect(documento.removeEventListener).toHaveBeenCalledWith("visibilitychange", listenerVisibilidad);
  });
});

describe("WAVE3 §G.4 — resumenHangsDe (mayor/total SOLO visibles + cuentaOcultas)", () => {
  it("ocultos EXCLUIDOS de cuenta/mayor/total → cuentaOcultas; legacy sin campo → visible", () => {
    const r = resumenHangsDe([
      { tipo: "hang", datos: { fuente: "longtask", duracionMs: 900, umbralMs: 50, breadcrumbs: [], visible: true } },
      // el fantasma del informe 1230 (117 s en background):
      { tipo: "hang", datos: { fuente: "drift", duracionMs: 117_090, umbralMs: 3_000, breadcrumbs: [], visible: false } },
      // legacy pre-wave3 (sin campo visible) → tratado visible:
      { tipo: "hang", datos: { fuente: "drift", duracionMs: 3_200, umbralMs: 3_000, breadcrumbs: [] } },
    ] as Parameters<typeof resumenHangsDe>[0]);
    expect(r.cuenta).toBe(2); // 900 + 3200 (el oculto NO cuenta)
    expect(r.mayorMs).toBe(3_200); // los 117 s fantasma NO mandan
    expect(r.totalMs).toBe(4_100);
    expect(r.cuentaOcultas).toBe(1);
  });
  it("solo ocultos → cuenta 0 con nulls honestos + cuentaOcultas exacta", () => {
    const r = resumenHangsDe([
      { tipo: "hang", datos: { fuente: "drift", duracionMs: 120_000, umbralMs: 3_000, breadcrumbs: [], visible: false } },
    ] as Parameters<typeof resumenHangsDe>[0]);
    expect(r).toEqual({ cuenta: 0, mayorMs: null, totalMs: null, cuentaOcultas: 1 });
  });
});
