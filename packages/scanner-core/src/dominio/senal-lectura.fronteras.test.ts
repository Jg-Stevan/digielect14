/**
 * KIT e14-fronteras-senal-v1 — fronteras EXACTAS del gate de lectura
 * (Ola 2 §2.2 del plan de remediación: mata las mutaciones M1/M2 de la
 * fase 2, ambas SOBREVIVIENTES con 133 tests en verde).
 *
 *  · M1 — `anclas >= 4` → `>= 5` en `senalDeLectura`: ningún test fijaba la
 *    frontera de FUERTE con 4 anclas. Aquí queda fijada POR AMBOS LADOS
 *    (mesa+4 → FUERTE; mesa+3 → no FUERTE) y por las dos vías de
 *    «mesa reconocida» (regex del texto y `parciales.mesa`).
 *  · M2 — `pieDentro = !faltaSeccion` → `= faltaSeccion` en
 *    `lazoPerdonadoPorLectura`: el perdón de esquinas fiduciales no tenía
 *    ni un test. Quedan fijados los dos lados (faltaSeccion=true JAMÁS
 *    perdona fondos; false los perdona SIN exigir KIT — kit
 *    e14-esquinas-suaves-v1 Q4).
 *
 * NOTA plan-vs-código (el CÓDIGO manda): el plan decía «sin mesa con 4+
 * anclas → no FUERTE (si la política lo exige)». La política REAL de
 * `senalDeLectura` es: sin mesa, FUERTE exige anclas ≥ 6 (segundo disyunto
 * `anclas >= 6`). Se fija ESA frontera exacta: 4 y 5 anclas sin mesa → no
 * FUERTE; 6 anclas sin mesa → FUERTE.
 *
 * PURO (mismo entorno headless que tests/ — bun:test, sin DOM).
 */
import { describe, expect, it } from "bun:test";
import {
  ANCLAS_LECTURA,
  lazoPerdonadoPorLectura,
  senalDeLectura,
} from "./senal-lectura";

// ── Líneas sintéticas: UNA línea por ancla de ANCLAS_LECTURA, en el MISMO
//    orden. Cada línea matchea EXACTAMENTE 1 regex (el autoguard de cada test
//    es `expect(s.anclas).toBe(n)` — si una línea llegara a sumar 2 anclas,
//    el test se queja en vez de pasar con una frontera falsa).
const LINEAS = {
  E14: "E-14",
  REGISTRADURIA: "REGISTRADURIA",
  CONSULADO: "CONSULADO 22",
  PAIS: "PAIS 1",
  ZONA: "ZONA 3",
  PUESTO: "PUESTO 4",
  MESA: "MESA 101",
  PAG: "Ver: 1 Pag: 1 de 2",
  KIT: "KIT 399",
  CODIGO_1D: "123456789012345",
} as const;

type ClaveAncla = keyof typeof LINEAS;

const textoCon = (...claves: ClaveAncla[]): string =>
  claves.map((k) => LINEAS[k]).join("\n");

/** Sanity del instrumento: 10 anclas declaradas = 10 regex del kit. */
describe("instrumento de líneas sintéticas", () => {
  it("cada línea matchea exactamente SU ancla y ninguna otra", () => {
    const claves = Object.keys(LINEAS) as ClaveAncla[];
    expect(claves.length).toBe(ANCLAS_LECTURA.length);
    for (const clave of claves) {
      const soloEsa = senalDeLectura(LINEAS[clave]);
      expect(soloEsa.anclas).toBe(1);
    }
  });
});

describe("fronteras de senalDeLectura (M1 — con mesa, FUERTE es exactamente anclas >= 4)", () => {
  it("mesa reconocida (regex del texto) + 4 anclas → FUERTE (la frontera exacta)", () => {
    const s = senalDeLectura(textoCon("E14", "MESA", "ZONA", "PUESTO"));
    expect(s.anclas).toBe(4);
    expect(s.nivel).toBe("FUERTE");
  });

  it("mesa reconocida (vía parciales, sin MESA en el texto) + 4 anclas → FUERTE", () => {
    const s = senalDeLectura(
      textoCon("E14", "REGISTRADURIA", "ZONA", "PUESTO"),
      { mesa: 101 },
    );
    expect(s.anclas).toBe(4);
    expect(s.nivel).toBe("FUERTE");
  });

  it("mesa + 4 anclas tomadas de la COLA de la lista (PAG/KIT/1D) → FUERTE", () => {
    // Guarda contra una frontera que dependa del ORDEN de las anclas.
    const s = senalDeLectura(textoCon("MESA", "PAG", "KIT", "CODIGO_1D"));
    expect(s.anclas).toBe(4);
    expect(s.nivel).toBe("FUERTE");
  });

  it("mesa + 3 anclas → NO es FUERTE (MEDIA: la cabecera E-14 está)", () => {
    const s = senalDeLectura(textoCon("E14", "MESA", "ZONA"));
    expect(s.anclas).toBe(3);
    expect(s.nivel).not.toBe("FUERTE");
    expect(s.nivel).toBe("MEDIA");
  });

  it("parciales.mesa = null NO cuenta como mesa (manda la regex del texto)", () => {
    const s = senalDeLectura(
      textoCon("E14", "REGISTRADURIA", "ZONA", "PUESTO"),
      { mesa: null },
    );
    expect(s.anclas).toBe(4);
    expect(s.nivel).not.toBe("FUERTE");
  });
});

describe("fronteras de senalDeLectura (política real SIN mesa: FUERTE exige anclas >= 6)", () => {
  it("sin mesa, 4 anclas → NO es FUERTE (MEDIA)", () => {
    const s = senalDeLectura(textoCon("E14", "REGISTRADURIA", "CONSULADO", "PAIS"));
    expect(s.anclas).toBe(4);
    expect(s.nivel).toBe("MEDIA");
  });

  it("sin mesa, 5 anclas → todavía NO es FUERTE (frontera cerrada por abajo)", () => {
    const s = senalDeLectura(
      textoCon("E14", "REGISTRADURIA", "CONSULADO", "PAIS", "ZONA"),
    );
    expect(s.anclas).toBe(5);
    expect(s.nivel).toBe("MEDIA");
  });

  it("sin mesa, 6 anclas → FUERTE (frontera exacta del segundo disyunto)", () => {
    const s = senalDeLectura(
      textoCon("E14", "REGISTRADURIA", "CONSULADO", "PAIS", "ZONA", "PUESTO"),
    );
    expect(s.anclas).toBe(6);
    expect(s.nivel).toBe("FUERTE");
  });

  it("sin anclas ni chars suficientes → DEBIL (piso inferior de la escala)", () => {
    const s = senalDeLectura("MANCHA ILEGIBLE");
    expect(s.anclas).toBe(0);
    expect(s.nivel).toBe("DEBIL");
  });
});

describe("fronteras de lazoPerdonadoPorLectura (M2 — faltaSeccionInferior JAMÁS se perdona)", () => {
  // TOPE_LEIDO demuestra el tope (E-14); sin E-14 ni código 1D no hay evidencia.
  const TOPE_LEIDO = textoCon("E14", "KIT");
  const SIN_EVIDENCIA_TOPE = textoCon("KIT"); // el KIT ya NO prueba el tope (Q4)

  it("fondo (bl) faltante + faltaSeccion=true → NO perdonado aunque el tope esté demostrado", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: true, bl: false, br: true }, TOPE_LEIDO, true),
    ).toBe(false);
  });

  it("fondo (br) faltante + faltaSeccion=true → NO perdonado", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: true, bl: true, br: false }, TOPE_LEIDO, true),
    ).toBe(false);
  });

  it("lazo completo (4 esquinas) + faltaSeccion=true → NO perdonado (con TODA la evidencia)", () => {
    // Tinta ausente NO es un lazo: ninguna evidencia de lectura lo condona.
    const todaLaEvidencia = textoCon("E14", "KIT", "CODIGO_1D");
    expect(
      lazoPerdonadoPorLectura(
        { tl: false, tr: false, bl: false, br: false },
        todaLaEvidencia,
        true,
      ),
    ).toBe(false);
  });

  it("sin evidencia de tope, la esquina superior faltante tampoco se perdona", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: false, bl: true, br: true }, SIN_EVIDENCIA_TOPE, false),
    ).toBe(false);
  });
});

describe("fronteras de lazoPerdonadoPorLectura (M2 — esquinas ausentes SÍ se perdonan con señal fuerte)", () => {
  it("fondo (bl) faltante + faltaSeccion=false → perdonado (KIT ya NO se exige — Q4)", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: true, bl: false, br: true }, textoCon("E14"), false),
    ).toBe(true);
  });

  it("fondo (br) faltante + faltaSeccion=false → perdonado", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: true, bl: true, br: false }, textoCon("E14"), false),
    ).toBe(true);
  });

  it("esquina de TOPE (tr) faltante → perdonada sin importar faltaSeccion (solo condona fondos)", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: false, bl: true, br: true }, textoCon("E14"), true),
    ).toBe(true);
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: false, bl: true, br: true }, textoCon("E14"), false),
    ).toBe(true);
  });

  it("evidencia de tope ALTERNATIVA: el código 1D de 15 dígitos también demuestra el tope", () => {
    expect(
      lazoPerdonadoPorLectura(
        { tl: true, tr: false, bl: true, br: true },
        textoCon("CODIGO_1D"),
        false,
      ),
    ).toBe(true);
  });

  it("perdón mixto (tope+fondo): exige evidencia de AMBOS lados", () => {
    const esquinas = { tl: false, tr: true, bl: true, br: false };
    expect(lazoPerdonadoPorLectura(esquinas, textoCon("E14"), false)).toBe(true);
    expect(lazoPerdonadoPorLectura(esquinas, textoCon("KIT"), false)).toBe(false);
  });

  it("sin esquinas (null) no hay lazo que perdonar → false", () => {
    expect(lazoPerdonadoPorLectura(null, textoCon("E14"), false)).toBe(false);
  });

  it("lazo completo 4/4 presente → false (no hay nada que perdonar)", () => {
    expect(
      lazoPerdonadoPorLectura({ tl: true, tr: true, bl: true, br: true }, textoCon("E14"), false),
    ).toBe(false);
  });
});
