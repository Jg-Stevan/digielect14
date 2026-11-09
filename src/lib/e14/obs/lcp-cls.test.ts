/**
 * Tests — KIT e14-remediacion-movil-v1 (D3 — #13): partes PURAS del observer
 * LCP/CLS (selectorLcp + acumuladores + resultadoDe). Entorno node SIN DOM:
 * las entradas se falsifican con casts (patrón salud-ts.test.ts) y
 * appendEvento se MOCKEA — nada toca IndexedDB. El script de <head> y la
 * instalación (window/PerformanceObserver) NO se ejercitan aquí — el QA de
 * campo lo cubre en dispositivo (medición §6.7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@jg-stevan/scanner-core/obs-base/buffer", () => ({
  appendEvento: vi.fn(async () => undefined),
}));

import {
  acumularCls,
  acumularLcp,
  estadoLcpClsInicial,
  resultadoDe,
  selectorLcp,
} from "./lcp-cls";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Entrada LCP falsificada (el callback entrega PerformanceEntry). */
const entradaLcp = (startTime: number, element: unknown = null) =>
  ({ entryType: "largest-contentful-paint", startTime, element }) as unknown as PerformanceEntry;

/** Entrada layout-shift falsificada. */
const entradaShift = (value: number, hadRecentInput = false) =>
  ({ entryType: "layout-shift", value, hadRecentInput }) as unknown as PerformanceEntry;

/** Elemento falsificado (solo lo que selectorLcp lee). */
const el = (props: Record<string, unknown>) => props as unknown as Element;

describe("selectorLcp — selector barato (tag + #id + 2 primeras clases, truncado 80)", () => {
  it("null / undefined / objeto sin tagName → null (jamás lanza)", () => {
    expect(selectorLcp(null)).toBeNull();
    expect(selectorLcp(undefined)).toBeNull();
    expect(selectorLcp({} as unknown as Element)).toBeNull();
  });

  it("tag solo → 'img'", () => {
    expect(selectorLcp(el({ tagName: "IMG" }))).toBe("img");
  });

  it("tag + id → 'img#hero'", () => {
    expect(selectorLcp(el({ tagName: "IMG", id: "hero" }))).toBe("img#hero");
  });

  it("id vacío → tratado como SIN id (un id '' no identifica nada)", () => {
    expect(selectorLcp(el({ tagName: "IMG", id: "" }))).toBe("img");
  });

  it("SOLO las 2 primeras clases (regla del kit — selector barato)", () => {
    expect(selectorLcp(el({ tagName: "DIV", className: "tarjeta acta extra" }))).toBe(
      "div.tarjeta.acta",
    );
  });

  it("SVG (className NO es string) → cae a getAttribute('class')", () => {
    const svg = el({
      tagName: "svg",
      className: { baseVal: "no-sirve" },
      getAttribute: (k: string) => (k === "class" ? "icono" : null),
    });
    expect(selectorLcp(svg)).toBe("svg.icono");
  });

  it("selector truncado a 80 caracteres", () => {
    const s = selectorLcp(el({ tagName: "DIV", id: "c".repeat(100) }));
    expect(s).not.toBeNull();
    expect(String(s).length).toBeLessThanOrEqual(80);
  });
});

describe("acumuladores — LCP último candidato gana · CLS solo sin hadRecentInput", () => {
  it("LCP: la última entrada REEMPLAZA (el navegador emite el candidato vigente)", () => {
    const est = estadoLcpClsInicial();
    acumularLcp(est, [
      entradaLcp(100, el({ tagName: "P" })),
      entradaLcp(14700, el({ tagName: "IMG", id: "foto", className: "acta-portada" })),
    ]);
    expect(est.lcpValor).toBe(14700);
    expect(est.lcpId).toBe("foto");
    expect(est.lcpSelector).toBe("img#foto.acta-portada");
  });

  it("LCP sin elemento → id/selector null (el bug #13 queda MEDIDO, no oculto)", () => {
    const est = estadoLcpClsInicial();
    acumularLcp(est, [entradaLcp(14700)]);
    expect(resultadoDe(est).lcp).toEqual({ valor: 14700, id: null, selector: null });
  });

  it("CLS: suma shifts SIN hadRecentInput y los cuenta; la interacción NO penaliza", () => {
    const est = estadoLcpClsInicial();
    acumularCls(est, [entradaShift(0.02), entradaShift(0.01, true), entradaShift(0.03)]);
    const r = resultadoDe(est);
    expect(r.cls.total).toBeCloseTo(0.05, 10);
    expect(r.cls.shifts).toBe(2);
  });

  it("sin LCP → lcp null honesto (jamás inventar)", () => {
    expect(resultadoDe(estadoLcpClsInicial()).lcp).toBeNull();
    expect(resultadoDe(estadoLcpClsInicial()).cls).toEqual({ total: 0, shifts: 0 });
  });

  it("entradas malformadas se saltan sin lanzar (defensivo)", () => {
    const est = estadoLcpClsInicial();
    acumularLcp(est, [{ entryType: "largest-contentful-paint" } as unknown as PerformanceEntry]);
    acumularCls(est, [{ entryType: "layout-shift" } as unknown as PerformanceEntry]);
    expect(resultadoDe(est).lcp).toBeNull();
    expect(resultadoDe(est).cls).toEqual({ total: 0, shifts: 0 });
  });
});
