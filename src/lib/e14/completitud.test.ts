/**
 * Tests unitarios — completitud.ts (GUARD-BORDE Rev. 2, tabla de decisión §2).
 * Overnight 2026-10-22, Prioridad 2 del docs/archive/PLAN-overnight.md.
 *
 * Dependencia DOM mockeada: loadImageMemo (image-utils) rechaza siempre →
 * motorTinta → noUtilizable → se ejercita la rama §7 (warp degenerado /
 * decode imposible: la sospecha geométrica SE MANTIENE como condena, salvo
 * perdón 4/4 fiduciales de FASE 2).
 *
 * Filas de la tabla §2 cubiertas aquí:
 *  · Sana (sin filo ∧ área ≥ 25%) → COMPLETA (camino feliz D4, costo 0).
 *  · Sospechosa + motor NO utilizable → condena conservadora (§7).
 *  · Sospechosa degenerada + 4 fiduciales → COMPLETA (perdón FASE 2).
 *  · Cobertura < 25% → los CUATRO lados sospechosos (D2).
 *  · Esquina del frame → DOS lados a la vez (D2).
 *  · El caso real del dueño (§1c: encuadre apretado 0.988/0.998) → SANA.
 *
 * FUERA de alcance (requieren canvas real → browser): densidades de tinta
 * 20% condena / 85% escudo anti-fondo D10 y el perdón POR LADO (Q1) con
 * motor utilizable — el dueño los valida en runtime (REPORTE-e14-
 * esquinas-suaves-v1).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./image-utils", () => ({
  // El motor de tinta NO puede decodificar en node → rama §7 determinista.
  loadImageMemo: vi.fn(() => Promise.reject(new Error("SIN_DOM_EN_UNIT_TEST"))),
}));

import type { Quad } from "@jg-stevan/scanner-core/types";

import type { EsquinasActa } from "./integridad";
import { motorTinta, verificarCompletitud } from "./completitud";

const FOTO = "data:image/png;base64,x"; // irrelevante: el motor se mockea

/** Quad centrado lejos del filo (0.1..0.9) — área 0.64. */
const quadSano: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

/** Quad con UNA esquina tocando el filo inferior (y ≥ 1−0.001) → sospecha S. */
const quadAlFiloSur: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9995 },
  { x: 0.1, y: 0.9995 },
];

/** Quad chico centrado (área 0.04 < 0.25) → cobertura → 4 lados. */
const quadChico: Quad = [
  { x: 0.4, y: 0.4 },
  { x: 0.6, y: 0.4 },
  { x: 0.6, y: 0.6 },
  { x: 0.4, y: 0.6 },
];

/** Esquina EXACTA del frame (0.0005, 0.0005) toca N y O a la vez. */
const quadEsquinaDeFrame: Quad = [
  { x: 0.0005, y: 0.0005 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

const FIDUCIALES_4: EsquinasActa = {
  tl: true,
  tr: true,
  bl: true,
  br: true,
} as unknown as EsquinasActa;

describe("verificarCompletitud — tabla de decisión §2", () => {
  it("quad SANO → COMPLETA sin análisis (camino feliz D4, costo 0)", async () => {
    const r = await verificarCompletitud(quadSano, FOTO);
    expect(r).toEqual({
      completa: true,
      sospecha: "",
      tintaFilo: false,
      densidades: [],
      fondo: false,
      perdonLado: "",
    });
  });

  it("CASO REAL del dueño (§1c): encuadre apretado 0.988/0.998 → SANA (fix del guard)", async () => {
    // La foto PERFECTA del dueño llena el encuadre por hábito — el guard del
    // PR #33 la condenaba; Rev. 2 solo sospecha desde 0.999 (MARGEN_BORDE).
    // Esquinas 0.002..0.998 (el caso medido 0.988/0.998 queda dentro del
    // margen): NINGUNA toca el filo → quad sano sin análisis.
    const apretado: Quad = [
      { x: 0.002, y: 0.002 },
      { x: 0.998, y: 0.002 },
      { x: 0.998, y: 0.998 },
      { x: 0.002, y: 0.998 },
    ];
    const r = await verificarCompletitud(apretado, FOTO);
    expect(r.completa).toBe(true);
    expect(r.sospecha).toBe("");
  });

  it("quad al filo (S) + motor NO utilizable → condena conservadora §7", async () => {
    const r = await verificarCompletitud(quadAlFiloSur, FOTO);
    expect(r.completa).toBe(false);
    expect(r.sospecha).toBe("S");
    expect(r.tintaFilo).toBe(true); // la sospecha se MANTIENE como condena
    expect(r.densidades).toEqual([]);
  });

  it("condena §7 + 4 fiduciales → PERDÓN FASE 2 (papel demostrado entero)", async () => {
    const r = await verificarCompletitud(quadAlFiloSur, FOTO, FIDUCIALES_4);
    expect(r.completa).toBe(true); // perdonadaSiPapelEntero
    expect(r.sospecha).toBe("S"); // la evidencia se conserva para el log
  });

  it("condena §7 + fiduciales PARCIALES (solo tl/tr) → SIN perdón total", async () => {
    const parciales = { tl: true, tr: true, bl: false, br: false } as unknown as EsquinasActa;
    const r = await verificarCompletitud(quadAlFiloSur, FOTO, parciales);
    expect(r.completa).toBe(false); // FASE 2 exige 4/4
  });

  it("cobertura < 25% → los CUATRO lados sospechosos (D2: no se sabe dónde corta)", async () => {
    const r = await verificarCompletitud(quadChico, FOTO);
    expect(r.completa).toBe(false);
    expect(r.sospecha).toBe("N|S|E|O");
  });

  it("esquina EXACTA del frame toca DOS lados (D2: N|O)", async () => {
    const r = await verificarCompletitud(quadEsquinaDeFrame, FOTO);
    expect(r.completa).toBe(false);
    expect(r.sospecha).toBe("N|O");
  });

  it("esquinas: null y undefined → comportamiento EXACTO de hoy (la tinta decide)", async () => {
    expect((await verificarCompletitud(quadAlFiloSur, FOTO, null)).completa).toBe(false);
    expect((await verificarCompletitud(quadAlFiloSur, FOTO, undefined)).completa).toBe(false);
  });
});

describe("motorTinta — degradación sin DOM", () => {
  it("decode imposible → noUtilizable con densidad 0 (jamás inventa)", async () => {
    const m = await motorTinta(FOTO);
    expect(m.utilizable).toBe(false);
    expect(m.cw).toBe(0);
    expect(m.ch).toBe(0);
    expect(m.densidadDe(0, 0, 10, 10)).toBe(0);
  });
});
