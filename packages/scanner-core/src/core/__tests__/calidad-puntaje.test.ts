/**
 * 7.6 (plan de remediación, C2-partial) — la FÓRMULA de calidad del core
 * (`puntajeCalidad`, pesos 0.45/0.25/0.3) y sus umbrales de level
 * (`nivelPorPuntaje`, 80/62/45) como ÚNICA copia. Hasta 7.6 el bridge de la
 * app tenía la fórmula copiada a mano para recalcular el level con las
 * señales v2 (sharpnessHi + contrasteEfectivo) y derivaba si el core
 * cambiaba los pesos: hoy ambos consumen ESTA función.
 *
 * Anclas del producto (§4.1 SPEC-e14-score-ocr): los techos del level viven
 * en la app (politica/umbrales.ts — fair→7.9, poor→6.4); aquí se congela
 * solo el mapa puntaje→level que comparte core y app.
 */
import { describe, expect, test } from "bun:test";
import { nivelPorPuntaje, puntajeCalidad } from "../image-processor";

describe("puntajeCalidad — fórmula 0.45/0.25/0.3 (única copia)", () => {
  test("pesos exactos sobre los tres canales", () => {
    expect(puntajeCalidad(100, 100, 100)).toBe(100);
    expect(puntajeCalidad(0, 0, 0)).toBe(0);
    // 80*0.45 + 95*0.25 + 22*0.3 = 36 + 23.75 + 6.6 = 66.35
    expect(puntajeCalidad(80, 95, 22)).toBeCloseTo(66.35, 10);
    // Caso del comentario del core: excellentQuality() ≈ 80/84/…
    // 100*0.45 + 70*0.25 + 84*0.3 = 45 + 17.5 + 25.2 = 87.7
    expect(puntajeCalidad(100, 70, 84)).toBeCloseTo(87.7, 10);
  });

  test("la frontera del level 'good' roza el umbral 62 por abajo y arriba", () => {
    // 61.99… por debajo → fair · 62 exacto → good (≥, no >).
    expect(nivelPorPuntaje(61.999999)).toBe("fair");
    expect(nivelPorPuntaje(62)).toBe("good");
  });

  test("nivelPorPuntaje — partición 80/62/45 byte a byte la de evaluateQuality", () => {
    expect(nivelPorPuntaje(80)).toBe("excellent");
    expect(nivelPorPuntaje(79.999999)).toBe("good");
    expect(nivelPorPuntaje(45)).toBe("fair");
    expect(nivelPorPuntaje(44.999999)).toBe("poor");
    expect(nivelPorPuntaje(0)).toBe("poor");
  });

  test("el recálculo v2 del bridge produce el level del core con la MISMA entrada", () => {
    // Propiedad de paridad: si la entrada v2 coincide con la del core, el
    // level recalculado por la app coincide con el que evaluateQuality
    // estampó (la fórmula es UNA).
    // 80*0.45 + 90*0.25 + 30*0.3 = 36 + 22.5 + 9 = 67.5 → good
    const score = puntajeCalidad(80, 90, 30);
    expect(score).toBeCloseTo(67.5, 10);
    expect(nivelPorPuntaje(score)).toBe("good");
  });
});
