/**
 * QA headless — kit e63f-autoenvio-v1 §5.1: «que se envíe solo la mayoría,
 * SIN bajar la integridad». Funciones PURAS, sin red, sin DOM, determinista.
 * Fixtures SINTÉTICOS: textos OCR fabricados + la base `public/e14/divipol.json`
 * PÚBLICA del repo (dato de registro, no actas) + códigos 1D ya citados en el
 * propio clasificador.ts — jamás actas/informes reales (RED LINE 7).
 *
 *   bun scripts/qa-autoenvio.ts
 *
 * Bloques:
 *   1. F1a normalizarNombreLugar — caso REAL del informe 120553 («EI Calro-
 *      Consulado» vs «El Cairo - Consulado»: 0.471 pre-kit → ≥ 0.55) +
 *      control LUGAR realmente distinto + normalizarNombre BYTE-IDÉNTICO en
 *      comportamiento (RED LINE 3 — la equivalencia I↔L NO se filtra).
 *   2. F1a+F1b vía clasificarCabecera (base divipol real): El Cairo deja de
 *      caer (AUTO sin cap) · consenso kit 399 frena el downgrade con LUGAR
 *      ilegible + aviso LUGAR-DESVIADO · sin kit → cap como hoy (byte-idéntico).
 *   3. F0 balde fino — prioridad puesto-lugar > tipo > mesa-registro > ruta
 *      + AUTO → null.
 *   4. Invariancias — umbrales 0.82/0.6/0.55 y OPTIMA=8/ADVERTENCIA=6.5 byte-
 *      idénticos (source-scan) + claves viejas del store intactas + registro
 *      KIT intacto.
 */
import { readFile } from "node:fs/promises";
import {
  clasificarCabecera,
  normalizarNombre,
  normalizarNombreLugar,
  similitud,
} from "../src/lib/e14/clasificador";
import type { DivipolBase } from "../src/lib/e14/divipol";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

// ---------- fixtures sintéticos (textos OCR + base divipol PÚBLICA del repo) ----------

const base = JSON.parse(
  await readFile(new URL("../public/e14/divipol.json", import.meta.url), "utf8"),
) as DivipolBase;

/** Cabecera EL CAIRO (mun 335, zona 05, puesto 02 «El Cairo - Consulado»
 *  t:1 — base divipol del repo). Código 1D: los 15 dígitos YA CITADOS en el
 *  propio clasificador.ts (ejemplo del kit identificacion-codigo) — kit 399,
 *  d9=3 TRANSMISION, 1 de 2. Nada de actas reales: solo estructura impresa. */
function textoElCairo(
  lugar: string,
  opts: { sinTipo?: boolean; sinCodigo?: boolean; mesa?: string } = {},
): string {
  return [
    "REGISTRADURIA NACIONAL DEL ESTADO CIVIL",
    "E-14",
    "CONSULADO: 88 - CONSULADOS",
    "PAIS: 335 - EGIPTO",
    `ZONA: 05 PUESTO: 02 MESA: ${opts.mesa ?? "001"}`,
    `LUGAR: ${lugar}`,
    ...(opts.sinTipo ? [] : ["TRANSMISIÓN"]),
    ...(opts.sinCodigo ? [] : ["710003993010102"]),
    "Ver. 01 Pag: 1 de 2",
  ].join("\n");
}

/** Cabecera ALEMANIA (mun 120): zona 05 puesto 02 «Berlin Consulado» ·
 *  zona 15 puesto 02 «Frankfurt Consulado» (t:12). Kit configurable:
 *  726=Berlin(mesa 8) · 745=Frankfurt(mesa 12) — REGISTRO_KITS. */
function textoBerlin(
  lugar: string,
  opts: {
    sinTipo?: boolean;
    sinCodigo?: boolean;
    zona?: string;
    mesa?: string;
    codigo?: string;
  } = {},
): string {
  return [
    "E-14",
    "CONSULADO: 88 - CONSULADOS",
    "PAIS: 120 - ALEMANIA",
    `ZONA: ${opts.zona ?? "05"} PUESTO: 02 MESA: ${opts.mesa ?? "001"}`,
    `LUGAR: ${lugar}`,
    ...(opts.sinTipo ? [] : ["TRANSMISIÓN"]),
    ...(opts.sinCodigo ? [] : [opts.codigo ?? "710007263010102"]),
    "Ver. 01 Pag: 1 de 2",
  ].join("\n");
}

// ---------- Bloque 1 · F1a — normalizarNombreLugar (pura) ----------

console.log("— Bloque 1 · F1a normalizarNombreLugar —");

const simCasoReal = similitud(
  normalizarNombreLugar("EI Calro-Consulado"),
  normalizarNombreLugar("El Cairo - Consulado"),
);
ok(
  simCasoReal >= 0.55,
  `caso REAL informe 120553 («EI Calro-Consulado» vs «El Cairo - Consulado») ≥ 0.55 [pre-kit 0.471 → ${simCasoReal.toFixed(3)}]`,
);
ok(
  simCasoReal === 1,
  "canónica I↔L + puntuación→espacio hace idénticas las dos lecturas del mismo puesto",
);
ok(
  similitud(
    normalizarNombreLugar("FRANKFURT CONSULADO"),
    normalizarNombreLugar("BERLIN CONSULADO"),
  ) < 0.55,
  "control negativo: LUGAR realmente distinto (Frankfurt vs Berlin) sigue < 0.55 — cap intacto",
);
ok(
  normalizarNombre("EI Calro-Consulado") === "EI CALRO-CONSULADO",
  "RED LINE 3: normalizarNombre SIN I→L y con guion intacto (byte-idéntico en comportamiento)",
);
ok(
  normalizarNombre("El Cairo - Consulado") === "EL CAIRO - CONSULADO",
  "RED LINE 3: normalizarNombre conserva la puntuación (la nueva normalización NO se filtró)",
);

// ---------- Bloque 2 · F1a+F1b vía clasificarCabecera (base divipol real) ----------

console.log("— Bloque 2 · F1a+F1b — verificación LUGAR (clasificarCabecera, base real) —");

// Caso real P2 del kit: LUGAR ruidoso con datos estructurados correctos →
// con F1a ya no cae (sin cap → AUTO).
const c2 = clasificarCabecera(textoElCairo("EI Calro-Consulado"), base);
ok(
  c2.nivel === "AUTO" && c2.clasifDebil === null,
  `El Cairo «EI Calro-Consulado» → AUTO sin cap (pre-kit: cap 0.75 → SUGERIDA) [nivel=${c2.nivel}]`,
);
ok(c2.puesto?.codigo === "02" && c2.confianzas.puesto === 1, "puesto 02 conserva su confianza de código (1.0)");
ok(c2.avisos?.includes("LUGAR-DESVIADO") !== true, "sin aviso LUGAR-DESVIADO (el LUGAR no chocó con F1a activa)");

// F1b: LUGAR ILEGIBLE + kit del consenso corrobora la ruta → NO cap + aviso.
const c3 = clasificarCabecera(textoElCairo("88-02"), base);
ok(
  c3.nivel === "AUTO" && c3.confianzas.puesto === 1,
  `F1b: código 02 + kit 399 (mun 335) + LUGAR ilegible «88-02» → sin cap [nivel=${c3.nivel}]`,
);
ok(
  c3.avisos?.includes("LUGAR-DESVIADO") === true,
  "F1b deja aviso display LUGAR-DESVIADO (el humano lo ve — el acta no se pierde)",
);

// F1b guard: mismo caso SIN kit en registro → cap como hoy (byte-idéntico).
const c4 = clasificarCabecera(textoElCairo("88-02", { sinCodigo: true }), base);
ok(
  c4.nivel === "SUGERIDA" && c4.confianzas.puesto === 0.75 && c4.clasifDebil === "puesto-lugar",
  `F1b guard: sin kit → cap como hoy (0.75 + SUGERIDA) [nivel=${c4.nivel} conf=${c4.confianzas.puesto}]`,
);

// Control negativo del kit §5.1: LUGAR realmente distinto → cap intacto.
const c5 = clasificarCabecera(textoBerlin("FRANKFURT CONSULADO", { sinCodigo: true }), base);
ok(
  c5.nivel === "SUGERIDA" &&
    c5.confianzas.puesto === 0.75 &&
    c5.clasifDebil === "puesto-lugar" &&
    c5.puesto?.nombre === "Berlin Consulado",
  "control: Frankfurt leído vs Berlin resuelto (sin kit) → cap intacto (conf 0.75, SUGERIDA)",
);

// ---------- Bloque 3 · F0 — balde fino del no-AUTO ----------

console.log("— Bloque 3 · F0 balde fino (prioridad y motivos) —");

ok(
  clasificarCabecera(textoBerlin("FRANKFURT CONSULADO", { sinCodigo: true, sinTipo: true }), base)
    .clasifDebil === "puesto-lugar",
  "prioridad: cap LUGAR + tipo ausente → «puesto-lugar» (no «tipo»)",
);
ok(
  clasificarCabecera(textoElCairo("El Cairo - Consulado", { sinTipo: true, sinCodigo: true }), base)
    .clasifDebil === "tipo",
  "motivo «tipo»: sin banda y sin código → SUGERIDA con balde tipo",
);
ok(
  clasificarCabecera(textoBerlin("Frankfurt Consulado", { zona: "15", mesa: "005", codigo: "710007453010102" }), base)
    .clasifDebil === "mesa-registro",
  "motivo «mesa-registro»: MESA 005 leída vs registro 745=12 → MESA_REGISTRO_DISCREPAN (NUNCA AUTO — red line intacta)",
);
ok(
  clasificarCabecera(
    ["REGISTRADURIA NACIONAL DEL ESTADO CIVIL", "E-14", "CONSULADO: 88 - CONSULADOS", "LUGAR: XYZQP SIN SENTIDO", "TRANSMISIÓN", "710003993010102"].join("\n"),
    base,
  ).clasifDebil === "ruta",
  "motivo «ruta»: dep resuelto sin PAIS (rescate sin match) → balde ruta",
);
ok(
  clasificarCabecera(textoElCairo("El Cairo - Consulado"), base).clasifDebil === null &&
    clasificarCabecera(textoElCairo("El Cairo - Consulado"), base).nivel === "AUTO",
  "AUTO → clasifDebil null (el score NO es un motivo de clasificación)",
);

// ---------- Bloque 4 · Invariancias (source-scan — RED LINES del kit) ----------

console.log("— Bloque 4 · invariancias (source-scan) —");

const srcClasificador = await readFile(new URL("../src/lib/e14/clasificador.ts", import.meta.url), "utf8");
const srcTypes = await readFile(new URL("../src/lib/e14/types.ts", import.meta.url), "utf8");
const srcStore = await readFile(new URL("../src/lib/e14/store.ts", import.meta.url), "utf8");
const srcKits = await readFile(new URL("../src/lib/e14/kits.ts", import.meta.url), "utf8");

ok(
  srcClasificador.includes("const UMBRAL_AUTO = 0.82;") &&
    srcClasificador.includes("const UMBRAL_SUGERIDA = 0.6;") &&
    srcClasificador.includes("const UMBRAL_VERIFICACION_LUGAR = 0.55;"),
  "RED LINE 1: umbrales 0.82 / 0.6 / 0.55 byte-idénticos en el fuente",
);
ok(
  srcTypes.includes('if (score >= 8) return "OPTIMA";') &&
    srcTypes.includes('if (score >= 6.5) return "ADVERTENCIA";'),
  "RED LINE 1: OPTIMA=8 y ADVERTENCIA=6.5 byte-idénticos (statusDeScore)",
);
ok(
  srcStore.includes("`revision:clasif-${nivel}`") &&
    srcStore.includes("`revision:clasif-${nivel}:${motivo}`"),
  "RED LINE 6: claves viejas del store intactas + clave fina NUEVA aditiva",
);
ok(
  srcKits.includes('mun: "335"') && srcKits.includes("kit: 399,"),
  "RED LINE 6: REGISTRO_KITS intacto (el registro sigue sin resolver nada solo)",
);

// ---------- resultado ----------

console.log(`\nQA autoenvío: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
