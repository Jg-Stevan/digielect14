/**
 * Contrato de paridad del motor post-OCR (kit e14-motor-paridad-v1).
 *
 * `digielect14` (móvil, por puesto) y `supervision-e14` (masivo) comparten el
 * motor de OCR (el mismo `@jg-stevan/scanner-core`, mismo `tesseract.js` con el
 * mismo `spa.traineddata` descomprimido, mismas ONNX PP-OCRv4 y misma base
 * DIVIPOL) y comparten TAMBIÉN el negocio que decide el resultado final:
 * `clasificador.ts`, `completitud.ts` y `divipol.ts`. Este test fija ESE
 * negocio con un golden generado por el motor real
 * (`bun scripts/gen-contrato-motor.ts`), y el hermano tiene el mismo golden con
 * su propia copia de las funciones.
 *
 * Por qué un archivo compartido y no ejecutar los dos motores: un CI de un solo
 * repo no puede correr los dos a la vez. Con el golden, la mecánica es —
 *   · cambio de negocio en ESTE repo que altera una clasificación → este test
 *     pone rojo → regenere el golden y cópielo al hermano;
 *   · allí el golden NUEVO pone rojo el test hermano hasta que se sincronice
 *     la misma línea.
 * Es decir: un cambio de negocio se hace dos veces o el contrato lo grita.
 *
 * Tolerancia deliberada: `toEqual` ignora campos `undefined`, así que un campo
 * NUEVO opcional que no aporte valor pasa; si aporta valor, el golden lo exige.
 *
 * NO cubre (y no pretende): el OCR sobre píxeles (necesita navegador/wasm), el
 * `puente/` (existe solo aquí) ni `quad`/`score` (salida de la cascada, no del
 * clasificador).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  clasificarCabecera,
  claveDeMesa,
  claveDePuesto,
  faltaSeccionInferior,
  nombreExportacion,
  tituloYUbicacionDe,
  tipoPaginaDe,
} from "./clasificador";
import type { DivipolBase } from "./divipol";
import { statusDeScore } from "./types";

interface DescriptorGolden {
  id: string;
  nota: string;
  ocr: string;
  esperado: Record<string, unknown>;
  derivados: Record<string, unknown>;
}

interface Golden {
  version: number;
  divipolMd5: string;
  estados: Array<{ score: number; status: string }>;
  descriptores: DescriptorGolden[];
}

const GOLDEN = JSON.parse(
  readFileSync(new URL("./__fixtures__/contrato-motor.json", import.meta.url), "utf8"),
) as Golden;

const DIVIPOL_CRUDO = readFileSync(
  new URL("../../../public/e14/divipol.json", import.meta.url),
  "utf8",
);
const BASE = JSON.parse(DIVIPOL_CRUDO) as DivipolBase;

/** Lo que el golden amarra DESPUÉS de clasificar (claves, nombre de export,
 *  título/ubicación y flag de recorte): funciones puras del mismo archivo. */
function derivadosDe(d: DescriptorGolden): Record<string, unknown> {
  const c = clasificarCabecera(d.ocr, BASE);
  return {
    claveMesa: claveDeMesa(c),
    clavePuesto: claveDePuesto(c),
    nombre: nombreExportacion(c),
    tipoPagina: c.tipo ? tipoPaginaDe(c.tipo) : null,
    tituloUbicacion: tituloYUbicacionDe(c),
    faltaSeccionInferior: faltaSeccionInferior(d.ocr, c.pagina),
  };
}

describe("contrato de motor · base DIVIPOL", () => {
  it("la base del repo es la misma sobre la que se generó el golden", () => {
    expect(createHash("md5").update(DIVIPOL_CRUDO, "utf8").digest("hex")).toBe(GOLDEN.divipolMd5);
  });

  it("el golden está en la versión del contrato que este test sabe leer", () => {
    expect(GOLDEN.version).toBe(1);
    expect(GOLDEN.descriptores.length).toBeGreaterThanOrEqual(10);
  });
});

describe("contrato de motor · clasificación (misma entrada ⇒ mismo resultado que masiva)", () => {
  for (const d of GOLDEN.descriptores) {
    it(`${d.id} — ${d.nota}`, () => {
      expect(clasificarCabecera(d.ocr, BASE)).toEqual(d.esperado);
      expect(derivadosDe(d)).toEqual(d.derivados);
    });
  }
});

describe("contrato de motor · escalera score→status", () => {
  it("los cantos 8 y 6.5 siguen siendo OPTIMA/ADVERTENCIA/RECHAZADA", () => {
    expect(GOLDEN.estados.map(({ score }) => ({ score, status: statusDeScore(score) }))).toEqual(
      GOLDEN.estados,
    );
  });
});
