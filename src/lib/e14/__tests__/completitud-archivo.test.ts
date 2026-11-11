/**
 * C-30 — relajación del guard-borde para la vía IMPORTAR (fuente ARCHIVO,
 * OPCIÓN 2 del plan): área mínima 0.25 → 0.15 y la tinta al filo SOLO
 * advierte (no veta). El veredicto del motor se RECIBE — este helper vive en
 * la capa app (el motor es compartido byte a byte con supervision-e14).
 * Puro: sin DOM, sin I/O (los tests de completitud.test.ts cubren el motor).
 */
import { describe, expect, it } from "vitest";
import type { Quad } from "@jg-stevan/scanner-core/core/types";
import type { ResultadoCompletitud } from "@jg-stevan/scanner-core/dominio/completitud";

import {
  AREA_MINIMA_ARCHIVO,
  areaDeQuadArchivo,
  relajarCompletitudParaArchivo,
} from "../completitud-archivo";

/** Quad rectangular en fracciones: origen (0,0) ancho w alto h. */
function rect(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function veredicto(extra: Partial<ResultadoCompletitud>): ResultadoCompletitud {
  return {
    completa: false,
    sospecha: "N|S|E|O",
    tintaFilo: true,
    densidades: [],
    fondo: false,
    perdonLado: "",
    ...extra,
  };
}

describe("C-30 — relajarCompletitudParaArchivo (IMPORTAR, opción 2)", () => {
  it("el umbral exportado es 0.15 (motor: 0.25)", () => {
    expect(AREA_MINIMA_ARCHIVO).toBe(0.15);
  });

  it("cobertura 0.15–0.25 → completa (el importado deja de morir por encuadre)", () => {
    // Área 0.18 (0.5 × 0.36): hoy < AREA_MINIMA del motor (0.25) → condena;
    // con la postura IMPORTAR (≥ 0.15) el quad es «sano».
    const quad = rect(0.5, 0.36);
    expect(areaDeQuadArchivo(quad)).toBeCloseTo(0.18, 10);
    const r = relajarCompletitudParaArchivo(
      veredicto({ tintaFilo: true, densidades: [25] }),
      quad,
    );
    expect(r.motivo).toBe("cobertura");
    expect(r.resultado.completa).toBe(true);
    // La evidencia se conserva para el log.
    expect(r.resultado.sospecha).toBe("N|S|E|O");
    expect(r.resultado.tintaFilo).toBe(true);
  });

  it("área exactamente en el umbral (0.15) → dentro de la postura IMPORTAR", () => {
    const quad = rect(0.5, 0.3);
    expect(areaDeQuadArchivo(quad)).toBeCloseTo(0.15, 10);
    const r = relajarCompletitudParaArchivo(veredicto({}), quad);
    expect(r.motivo).toBe("cobertura");
    expect(r.resultado.completa).toBe(true);
  });

  it("área < 0.15 sin tinta medida (degenerada §7) → el veto se conserva", () => {
    const quad = rect(0.3, 0.3); // 0.09
    const r = relajarCompletitudParaArchivo(
      veredicto({ tintaFilo: true, densidades: [] }), // rama degenerada: sin medición
      quad,
    );
    expect(r.motivo).toBeNull();
    expect(r.resultado.completa).toBe(false);
  });

  it("tinta al filo MEDIDA sobre quad al borde → solo advierte (no veta)", () => {
    // Quad grande (área ~1) tocando el borde SUR — la sospecha vino del
    // brazo BORDE (sospecha parcial, no los 4 lados).
    const quad = rect(0.98, 0.99);
    const r = relajarCompletitudParaArchivo(
      veredicto({ sospecha: "S", tintaFilo: true, densidades: [21.5] }),
      quad,
    );
    expect(r.motivo).toBe("tinta-filo");
    expect(r.resultado.completa).toBe(true);
  });

  it("veredicto positivo del motor pasa INTACTO (sin motivo)", () => {
    const r = relajarCompletitudParaArchivo(
      { completa: true, sospecha: "", tintaFilo: false, densidades: [], fondo: false, perdonLado: "" },
      rect(0.5, 0.3),
    );
    expect(r.motivo).toBeNull();
    expect(r.resultado.completa).toBe(true);
  });

  it("sospecha de cobertura SIN área suficiente (<0.15) con tinta medida → advierte por tinta", () => {
    const quad = rect(0.2, 0.2); // 0.04 — bajo el umbral relajado
    const r = relajarCompletitudParaArchivo(
      veredicto({ tintaFilo: true, densidades: [22] }), // medición real
      quad,
    );
    expect(r.motivo).toBe("tinta-filo");
    expect(r.resultado.completa).toBe(true);
  });
});
