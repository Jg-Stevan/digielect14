/**
 * Generador del golden `src/lib/e14/__fixtures__/contrato-motor.json`.
 *
 *   bun scripts/gen-contrato-motor.ts        # reescribe el golden
 *   bun scripts/gen-contrato-motor.ts --check # sale 1 si el golden NO refleja el motor
 *
 * El golden es el ÚNICO artefacto compartido entre `digielect14` (móvil, por
 * puesto) y `supervision-e14` (masivo). Cada repo tiene un test que corre SUS
 * propios módulos contra ÉL: si un cambio de negocio altera la clasificación,
 * el test del repo donde se cambió pone rojo hasta que el dueño regenere el
 * golden y lo copie al hermano — donde el mismo golden pone rojo hasta que se
 * sincronice. Paridad garantizada por un archivo, no por ejecutar los dos
 *  motores (imposible en un solo CI).
 *
 * Fixtures SINTÉTICOS: textos OCR fabricados + la base `public/e14/divipol.json`
 * PÚBLICA del repo (dato de registro, no acta) + códigos 1D ya citados en el
 * propio clasificador.ts — jamás actas ni informes reales (RED LINE 7).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  clasificarCabecera,
  faltaSeccionInferior,
  claveDeMesa,
  claveDePuesto,
  nombreExportacion,
  tituloYUbicacionDe,
  tipoPaginaDe,
} from "@jg-stevan/scanner-core/dominio/clasificador";
import type { DivipolBase } from "@jg-stevan/scanner-core/dominio/divipol";
import { statusDeScore } from "@jg-stevan/scanner-core/dominio/types";
import { DESCRYPTORES } from "./contrato-vectores";

const RUTA_GOLDEN = new URL("../src/lib/e14/__fixtures__/contrato-motor.json", import.meta.url);
const RUTA_DIVIPOL = new URL("../public/e14/divipol.json", import.meta.url);

const divipolCrudo = readFileSync(RUTA_DIVIPOL, "utf8");
const base = JSON.parse(divipolCrudo) as DivipolBase;
const divipolMd5 = createHash("md5").update(divipolCrudo, "utf8").digest("hex");

/** Serialización canónica: claves ordenadas (el golden no depende del orden de
 *  construcción del objeto ni del repo). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const salida: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) salida[k] = canon(x);
    }
    return salida;
  }
  return v;
}

const descriptores = DESCRYPTORES.map((d) => {
  const c = clasificarCabecera(d.ocr, base);
  return {
    id: d.id,
    nota: d.nota,
    ocr: d.ocr,
    esperado: canon(c),
    /** Lo que el motor produce DESPUÉS de clasificar y ya es resultado final
     *  para el usuario y para el hub: la clave de mesa/puesto (dedup y panel),
     *  el nombre de export, el título/ubicación del acta y el flag de recorte.
     *  Son funciones PURAS del mismo clasificador. */
    derivados: canon({
      claveMesa: claveDeMesa(c),
      clavePuesto: claveDePuesto(c),
      nombre: nombreExportacion(c),
      tipoPagina: c.tipo ? tipoPaginaDe(c.tipo) : null,
      tituloUbicacion: tituloYUbicacionDe(c),
      faltaSeccionInferior: faltaSeccionInferior(d.ocr, c.pagina),
    }),
  };
});

/** Escalera score→status (`types.ts`): los umbrales D23/D41 del desenlace. Se
 *  pinan aquí porque `types.ts` NO es comparable byte a byte entre los dos
 *  repos (el hermano tiene tipos del lote) y aun así deciden el chip que ve el
 *  dueño. Barrido por los cantos, no por valores random. */
const estados = [10, 8, 7.99, 6.5, 6.49, 0].map((score) => ({ score, status: statusDeScore(score) }));

const golden = {
  _comment:
    "GOLDEN de paridad del motor post-OCR (contrato e14-motor-paridad-v1). Generado por scripts/gen-contrato-motor.ts. Copiar EXACTO a supervision-e14. No editar a mano.",
  version: 1,
  generador: "scripts/gen-contrato-motor.ts",
  divipolMd5,
  estados,
  descriptores,
};

const nuevo = JSON.stringify(golden, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const actual = fileURLToPath(RUTA_GOLDEN);
  const viejo = readFileSync(actual, "utf8").replace(/\r\n/g, "\n");
  if (viejo !== nuevo) {
    console.error("FAIL · el golden NO refleja el motor actual — regenerar y propagar al hermano");
    process.exit(1);
  }
  console.log(`OK · golden coherente con el motor (${descriptores.length} descriptores, divipol ${divipolMd5})`);
} else {
  writeFileSync(RUTA_GOLDEN, nuevo, "utf8");
  console.log(`escrito ${fileURLToPath(RUTA_GOLDEN)} · ${descriptores.length} descriptores · divipol ${divipolMd5}`);
}
