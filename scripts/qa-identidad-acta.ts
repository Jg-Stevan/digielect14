/**
 * QA headless — kit e63k-capa2-identidad-v1 §3: dedup CAPA 2 por identidad
 * impresa + banda aplazada + PWA. Funciones PURAS, sin red, sin DOM,
 * determinista (mismo estilo de scripts/qa-autoenvio.ts).
 * Fixtures SINTÉTICOS: SOLO estructura impresa — las 8 series de 15 dígitos
 * citadas en la consola del dueño (kit §0.2) ya existen como gramática
 * ejemplo del propio clasificador.ts; cero actas/informes reales (RED LINE 7
 * de la casa).
 *
 *   bun scripts/qa-identidad-acta.ts
 *
 * Bloques:
 *   1. Gramática identidadDeActa con las 8 series reales — formulario 11
 *      (7100+KIT+TIPO+VER), acta 13 (formulario+PAG), paginaSerie; sin
 *      codigoUnico → null (honesto) + re-validación defensiva.
 *   2. Anti-falso-positivo (el test que la consola del 21-oct reprobó):
 *      3993-P2 (transmisión) ≠ 3992-P2 (delegados) por identidadActa E
 *      identidadFormulario — misma mesa/mismos votos NO interviene.
 *   3. Test del dueño: dos fotos del MISMO papel comparten identidadActa;
 *      P1 vs P2 del mismo formulario comparten identidadFormulario pero NO
 *      identidadActa (nunca se deduplican entre sí).
 *   4. resumenDedup con el vocabulario nuevo: "identidad" cuenta y NO es
 *      match v2; "visual-aplazada" no es match; activo true con cualquiera.
 *   5. Invariancias source-scan: DEDUP_HAMMING_MAX=6 · DEDUP_CINTA_CIERTA=2 ·
 *      umbrales 0.82/0.6/0.55/8/6.5 intocados · proxy=true (rapidocr).
 */
import { readFile } from "node:fs/promises";
import { codigoUnicoE14 } from "../src/lib/e14/clasificador";
import {
  DEDUP_CINTA_CIERTA,
  identidadDeActa,
} from "../src/lib/e14/masiva/identidad";
import { resumenDedup, type FilaInforme } from "../src/lib/e14/informe";
import type { Acta } from "../src/lib/e14/types";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

// ---------- fixtures sintéticos (SOLO estructura impresa — sin actas) ----------

/** Acta sintética: SOLO lo que identidadDeActa lee (clasificacion.codigoUnico
 *  ya parseado por la gramática del repo — el mismo camino del consenso). */
function actaConSerie(serie: string | null): Acta {
  return {
    clasificacion: serie ? { codigoUnico: codigoUnicoE14(serie) } : {},
  } as unknown as Acta;
}

/** Las 8 series reales del dueño (lote 21-oct — kit §0.2/§3.1): 4 mesas ×
 *  P1/P2, kits 399 (El Cairo), 1265, 982 — d9: 3=TRANSMISIÓN · 2=DELEGADOS. */
const SERIES = [
  "710003993010102",
  "710003993010202",
  "710003992010102",
  "710003992010202",
  "710012652010102",
  "710012652010202",
  "710009822010102",
  "710009822010202",
] as const;

/** Ficha mínima para resumenDedup (solo lee dedup/dedupDistancia). */
function ficha(
  dedup: FilaInforme["dedup"],
  distancia?: number | null,
): FilaInforme {
  return {
    dedup,
    ...(distancia != null ? { dedupDistancia: distancia } : {}),
  } as unknown as FilaInforme;
}

// ---------- Bloque 1 · Gramática identidadDeActa (las 8 series reales) ----------

console.log("— Bloque 1 · gramática identidadDeActa (8 series del dueño) —");

const esperado: Record<string, { form: string; acta: string; pag: number }> = {
  "710003993010102": { form: "71000399301", acta: "7100039930101", pag: 1 },
  "710003993010202": { form: "71000399301", acta: "7100039930102", pag: 2 },
  "710003992010102": { form: "71000399201", acta: "7100039920101", pag: 1 },
  "710003992010202": { form: "71000399201", acta: "7100039920102", pag: 2 },
  "710012652010102": { form: "71001265201", acta: "7100126520101", pag: 1 },
  "710012652010202": { form: "71001265201", acta: "7100126520102", pag: 2 },
  "710009822010102": { form: "71000982201", acta: "7100098220101", pag: 1 },
  "710009822010202": { form: "71000982201", acta: "7100098220102", pag: 2 },
};
for (const serie of SERIES) {
  const id = identidadDeActa(actaConSerie(serie));
  const e = esperado[serie]!;
  ok(
    id != null &&
      id.serie === serie &&
      id.identidadFormulario === e.form &&
      id.identidadActa === e.acta &&
      id.paginaSerie === e.pag,
    `${serie} → form ${e.form} · acta ${e.acta} · pag ${e.pag}`,
  );
}
ok(
  identidadDeActa(actaConSerie(null)) === null,
  "sin codigoUnico → null (honesto — RED LINE 2: sin consenso no hay identidad)",
);
ok(
  identidadDeActa(null) === null && identidadDeActa(undefined) === null,
  "acta null/undefined → null (jamás lanza)",
);
ok(
  identidadDeActa({
    clasificacion: { codigoUnico: { crudo: "123" } },
  } as unknown as Acta) === null,
  "re-validación defensiva: crudo inválido (registros viejos) → null",
);

// ---------- Bloque 2 · Anti-falso-positivo (el caso 3992/3993 — QA §3.2) ----------

console.log("— Bloque 2 · anti-falso-positivo (3992 vs 3993) —");

const idTransmisionP2 = identidadDeActa(actaConSerie("710003993010202"))!;
const idDelegadosP2 = identidadDeActa(actaConSerie("710003992010202"))!;
ok(
  idTransmisionP2.identidadActa !== idDelegadosP2.identidadActa,
  `identidadActa distinta: transmisión P2 (${idTransmisionP2.identidadActa}) ≠ delegados P2 (${idDelegadosP2.identidadActa})`,
);
ok(
  idTransmisionP2.identidadFormulario !== idDelegadosP2.identidadFormulario,
  `identidadFormulario distinta (dígito 9 — tipo: 3 vs 2): ${idTransmisionP2.identidadFormulario} ≠ ${idDelegadosP2.identidadFormulario}`,
);
ok(
  idTransmisionP2.paginaSerie === idDelegadosP2.paginaSerie &&
    idTransmisionP2.serie.slice(0, 4) === idDelegadosP2.serie.slice(0, 4),
  "misma mesa/mismos votos NO interviene: la comparación es SOLO la serie impresa (no hay comparación de datos — RED LINE 2)",
);

// ---------- Bloque 3 · Test del dueño (misma acta 2× / P1 vs P2) ----------

console.log("— Bloque 3 · test del dueño —");

const fotoA = identidadDeActa(actaConSerie("710003993010102"))!;
const fotoB = identidadDeActa(actaConSerie("710003993010102"))!;
ok(
  fotoA.identidadActa === fotoB.identidadActa && fotoA.serie === fotoB.serie,
  "dos fotos del MISMO papel comparten identidadActa COMPLETA (capa 2 las marca — dedup-identidad)",
);
const p1 = identidadDeActa(actaConSerie("710003993010102"))!;
const p2 = identidadDeActa(actaConSerie("710003993010202"))!;
ok(
  p1.identidadFormulario === p2.identidadFormulario,
  `P1 vs P2 del mismo formulario comparten identidadFormulario (${p1.identidadFormulario})`,
);
ok(
  p1.identidadActa !== p2.identidadActa,
  `P1 vs P2 del mismo formulario NUNCA se deduplican entre sí: ${p1.identidadActa} ≠ ${p2.identidadActa} (13 dígitos INCLUYEN PAG)`,
);
ok(
  DEDUP_CINTA_CIERTA === 2 && DEDUP_CINTA_CIERTA < 6,
  "DEDUP_CINTA_CIERTA=2: la marca pre-OCR solo es CIERTA en la cinta baja (kit e63h: gemelas 0-2; el FP 3992/3993 cayó en 6)",
);

// ---------- Bloque 4 · resumenDedup con el vocabulario nuevo ----------

console.log("— Bloque 4 · resumenDedup vocabulario e63k —");

const r1 = resumenDedup([
  ficha("identidad", null),
  ficha("v2", 1),
  ficha("v2", 3),
  ficha("visual-aplazada"),
  ficha("sin-match"),
]);
ok(r1.identidad === 1, "dedup \"identidad\" cuenta en identidad (capa 2)");
// ADENDA e66 (M-e66-2 — revoca el criterio e63k F1.5 por mandato del plan
// P3): matches ahora cuenta TODAS las capas (v2 + identidad + qr +
// ya-enviada); el desglose v2 preserva la cuenta que matches era antes.
// "visual-aplazada" sigue NO siendo match (resolución pendiente).
ok(
  r1.matches === 3,
  "e66/M-e66-2: matches = TODAS las capas (2 v2 + 1 identidad = 3); \"visual-aplazada\" y \"sin-match\" NO cuentan",
);
ok(r1.v2 === 2, "e66: desglose aditivo v2 preserva la cuenta que matches era antes (2)");
ok(r1.sinMatch === 1, "\"sin-match\" cuenta aparte (1)");
ok(
  r1.activo === true,
  "activo=true con cualquier traza (\"visual-aplazada\" incluida — dedup != null)",
);
const r2 = resumenDedup([ficha("visual-aplazada")]);
ok(r2.activo === true && r2.matches === 0 && r2.identidad === 0, "\"visual-aplazada\" NO es match y NO es identidad — solo activa el instrumento");
// e66 (M-e66-2): la capa ya-enviada (e65) cuenta como match con desglose propio.
const r3 = resumenDedup([ficha("ya-enviada"), ficha("qr")]);
ok(
  r3.matches === 2 && r3.yaEnviada === 1 && r3.qr === 1 && r3.v2 === 0,
  "e66: \"ya-enviada\" y \"qr\" cuentan como match con desglose aditivo (matches=2, yaEnviada=1, qr=1, v2=0)",
);
ok(
  resumenDedup([]).activo === false,
  "sin trazas → activo=false (el instrumento no corrió)",
);
ok(
  resumenDedup([ficha("v2"), ficha("v2")]).distanciaMedia === null,
  "match sin distancia → distanciaMedia null (jamás inventar)",
);

// ---------- Bloque 5 · Invariancias (source-scan — RED LINES del kit) ----------

console.log("— Bloque 5 · invariancias (source-scan) —");

const srcDedup = await readFile(
  new URL("../src/lib/e14/masiva/dedup.ts", import.meta.url),
  "utf8",
);
const srcIdentidad = await readFile(
  new URL("../src/lib/e14/masiva/identidad.ts", import.meta.url),
  "utf8",
);
const srcClasificador = await readFile(
  new URL("../src/lib/e14/clasificador.ts", import.meta.url),
  "utf8",
);
const srcTypes = await readFile(
  new URL("../src/lib/e14/types.ts", import.meta.url),
  "utf8",
);
const srcRapidocr = await readFile(
  new URL("../src/lib/e14/ocr/rapidocr.ts", import.meta.url),
  "utf8",
);

ok(
  srcDedup.includes("export const DEDUP_HAMMING_MAX = 6;"),
  "RED LINE 1: DEDUP_HAMMING_MAX=6 byte-idéntico (dedup.ts intocado — la corrección es la CINTA, no el umbral)",
);
ok(
  srcIdentidad.includes("export const DEDUP_CINTA_CIERTA = 2;"),
  "DEDUP_CINTA_CIERTA=2 en el fuente (la banda 3..6 la decide la capa 2)",
);
ok(
  srcClasificador.includes("const UMBRAL_AUTO = 0.82;") &&
    srcClasificador.includes("const UMBRAL_SUGERIDA = 0.6;") &&
    srcClasificador.includes("const UMBRAL_VERIFICACION_LUGAR = 0.55;"),
  "RED LINE: umbrales 0.82 / 0.6 / 0.55 byte-idénticos en el fuente",
);
ok(
  srcTypes.includes('if (score >= 8) return "OPTIMA";') &&
    srcTypes.includes('if (score >= 6.5) return "ADVERTENCIA";'),
  "RED LINE: OPTIMA=8 y ADVERTENCIA=6.5 byte-idénticos (statusDeScore)",
);
ok(
  srcRapidocr.includes("ort.env.wasm.proxy = true;"),
  "RED LINE: proxy=true en ocr/rapidocr.ts (producción — el export AI Studio no volvió a colarse)",
);

// ---------- resultado ----------

console.log(`\nQA identidad-acta: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
