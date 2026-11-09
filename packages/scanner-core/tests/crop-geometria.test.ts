/**
 * crop-geometria — H5 de la auditoría de la remediación móvil.
 *
 * El filtro `leibles` de los crops perezosos (C2) estima el ratio de cada
 * línea SIN recortar, y ese ratio alimenta el ancho del tensor del rec. Debe
 * salir de la MISMA geometría que el recorte real (`cropLinea`): dos copias
 * de la fórmula pueden derivar. Ambos consumen `medidasDeCaja`.
 *
 * Las medidas son EXACTAS (sin redondear): el canvas redondea al pedir
 * píxeles, pero el ratio que decide el tensor conserva los decimales — con
 * redondeo, el ancho del tensor cambiaba en algunas líneas.
 */
import { describe, expect, test } from "bun:test";
import { medidasDeCaja, type PuntoCaja } from "../src/ocr/crop-geometria";

const caja = (w: number, h: number): PuntoCaja[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

describe("medidasDeCaja (geometría compartida del crop)", () => {
  test("caja alineada: lados exactos", () => {
    expect(medidasDeCaja(caja(100, 20))).toEqual({ w: 100, h: 20 });
  });

  test("caja rotada 90°: los lados largos siguen siendo w", () => {
    const rotada: PuntoCaja[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 20, y: 100 },
      { x: 20, y: 0 },
    ];
    expect(medidasDeCaja(rotada)).toEqual({ w: 100, h: 20 });
  });

  test("sin redondeo: el ratio conserva decimales (tensor del rec)", () => {
    // 100.4×1.4 conserva decimales en el ratio; el canvas del recorte
    // redondea aparte (100×1). Redondear aquí cambiaba el ancho del tensor
    // en algunas líneas respecto al motor medido.
    const { w, h } = medidasDeCaja(caja(100.4, 1.4));
    expect(w).toBeCloseTo(100.4, 6);
    expect(h).toBeCloseTo(1.4, 6);
    expect(w / h).toBeCloseTo(100.4 / 1.4, 6);
    expect({ cropW: Math.max(1, Math.round(w)), cropH: Math.max(1, Math.round(h)) }).toEqual({
      cropW: 100,
      cropH: 1,
    });
  });

  test("caja degenerada: medidas en cero (las guardas viven en cada sitio)", () => {
    const punto = { x: 7, y: 7 };
    expect(medidasDeCaja([punto, punto, punto, punto])).toEqual({ w: 0, h: 0 });
  });
});
