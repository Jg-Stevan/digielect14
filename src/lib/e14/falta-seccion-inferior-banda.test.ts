import { describe, expect, it } from "vitest";

import { faltaSeccionInferiorConBanda } from "@jg-stevan/scanner-core/dominio/clasificador";

const P1 = { index: 1, total: 1 };
const P2 = { index: 2, total: 3 };

describe("faltaSeccionInferiorConBanda", () => {
  it("el OCR principal ya leyó la sección → no falta", () => {
    expect(faltaSeccionInferiorConBanda(false, P2, "", false)).toBe(false);
  });

  it("la banda inferior dedicada lee FIRMA (pág ≥2) → no falta", () => {
    expect(faltaSeccionInferiorConBanda(true, P2, "FIRMA DE LOS JURADOS", false)).toBe(false);
  });

  it("la banda inferior dedicada lee SUMA TOTAL (pág 1) → no falta", () => {
    expect(faltaSeccionInferiorConBanda(true, P1, "SUMA TOTAL", false)).toBe(false);
  });

  it("el par fiducial inferior presente es evidencia física → no falta", () => {
    expect(faltaSeccionInferiorConBanda(true, P2, "", true)).toBe(false);
  });

  it("sin banda y sin par inferior → conserva la condena", () => {
    expect(faltaSeccionInferiorConBanda(true, P2, "texto sin la sección", false)).toBe(true);
  });

  it("pág 1 exige SUMA TOTAL: FIRMA no basta, pero el par inferior sí", () => {
    expect(faltaSeccionInferiorConBanda(true, P1, "FIRMA", false)).toBe(true);
    expect(faltaSeccionInferiorConBanda(true, P1, "FIRMA", true)).toBe(false);
  });

  it("página desconocida (null) → conservador, no condena", () => {
    expect(faltaSeccionInferiorConBanda(true, null, "", false)).toBe(false);
  });
});
