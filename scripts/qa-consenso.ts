/**
 * QA FUERA DEL BUNDLE — KIT consenso-frankfurt-v1 (§8, Task 122): AC1-AC5
 * al patrón del qa-codigo-unico.ts. Corre con: `bun scripts/qa-consenso.ts`
 * — sale 1 si algún caso falla.
 *
 * AC1 unidad slash (candidatosCodigo1D + codigoUnicoE14 Frankfurt 745).
 * AC2 unidad consenso kit (pie/código/registro — El Cairo 300↔399, sin
 *     inventar 512).
 * AC3 unidad mesa (guard de rango §4.3.1 + discrepancia registro §4.3.2 —
 *     divipol REAL public/e14/divipol.json).
 * AC4 marcasEsquina adaptativa (canvas sintético con la geometría medida
 *     §0-F1: marcas ~3%W, y 2-6%H · 97.6-97.9%, x 3.8-8% · 97.2% — 12
 *     páginas + negativos sin marcas / barcode / canvas 60×90 → null).
 * AC5 verificarCompletitud (quad al filo + tinta ~30%: 4 fiduciales →
 *     completa=true conservando la evidencia; null/parcial → hoy).
 *
 * NOTA DE HARNESS: bun no tiene DOM — `marcasEsquina` recibe un canvas
 * duck-typed y `verificarCompletitud` corre sobre stubs de `document`/`Image`
 * con una imagen sintética de ~30% de tinta (misma cadena motorTinta real).
 * Los PDFs reales del visor no están en el repo (AppSync privado — §0-F5):
 * la geometría sintética replica las posiciones MEDIDAS de las 2 capturas
 * del dueño; el chequeo con capturas reales es el re-QA del dueño (AC7-AC10).
 */
import { readFileSync } from "node:fs";
import type { Quad } from "@jg-stevan/scanner-core/types";
import type { DivipolBase } from "../src/lib/e14/divipol";
import {
  clasificarCabecera,
  candidatosCodigo1D,
  codigoUnicoE14,
  tipoDeBanda,
} from "../src/lib/e14/clasificador";
import { ESQUINAS_OK, marcasEsquina, trazaEsquinas } from "../src/lib/e14/integridad";
import { verificarCompletitud } from "../src/lib/e14/completitud";

// ── Stubs de DOM (ANTES de cualquier llamada — los imports ya evaluaron) ──

type Pix = (x: number, y: number) => readonly [number, number, number];

/** Canvas duck-typed: `marcasEsquina`/`motorTinta` solo usan getContext →
 *  getImageData (+ drawImage/putImageData no-ops). El buffer de la imagen
 *  completa se construye UNA vez y queda cacheado: la 2ª+ llamada mide el
 *  COSTE DEL ALGORITMO, no el del pintor del stub (el getImageData real del
 *  navegador es un memcpy — el presupuesto §2 aplica a eso). */
function makeCanvas(w: number, h: number, pix: Pix): HTMLCanvasElement {
  const lee = (sx: number, sy: number, sw: number, sh: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const [r, g, b] = pix(sx + x, sy + y);
        const i = (y * sw + x) * 4;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }
    }
    return out;
  };
  let full: Uint8ClampedArray | null = null;
  return {
    width: w,
    height: h,
    getContext: () => ({
      drawImage: () => {},
      putImageData: () => {},
      getImageData: (sx: number, sy: number, sw: number, sh: number) => {
        if (sx === 0 && sy === 0 && sw === w && sh === h) {
          full ??= lee(sx, sy, sw, sh);
          return { data: full, width: sw, height: sh, colorSpace: "srgb" };
        }
        return { data: lee(sx, sy, sw, sh), width: sw, height: sh, colorSpace: "srgb" };
      },
    }),
  } as unknown as HTMLCanvasElement;
}

// Imagen sintética del motorTinta: 320×1062 (AR de acta ~0.30) con ~30% de
// tinta determinista (franjas 0-2% ≈ 30% → tintaFilo ≥20% · sin fondo <85%).
const INK_W = 320;
const INK_H = 1062;
const tintaPix: Pix = (x, y) =>
  ((x * 7 + y * 13) % 10) < 3 ? ([40, 40, 40] as const) : ([250, 250, 250] as const);

const g = globalThis as unknown as { document: unknown; Image: unknown };
g.document = {
  createElement: (tag: string): unknown => {
    if (tag !== "canvas") throw new Error(`stub document.createElement: ${tag}`);
    return makeCanvas(INK_W, INK_H, tintaPix);
  },
};
class FakeImage {
  naturalWidth = INK_W;
  naturalHeight = INK_H;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}
g.Image = FakeImage;

// ── Pintores de actas sintéticas (geometría §0-F1) ──

const BLANCO: readonly [number, number, number] = [245, 245, 245]; // lum ≈ 0.96
const TINTA: readonly [number, number, number] = [26, 26, 26]; // lum ≈ 0.10

interface Marca {
  cx: number; // centro x (fracción de W)
  cy: number; // centro y (fracción de H)
}

function pintorActa(w: number, h: number, marcas: Marca[]): Pix {
  const s = Math.round(w * 0.03); // marca real ~3%W (27px/908 · 30px/995)
  return (x, y) => {
    for (const m of marcas) {
      const x0 = Math.round(m.cx * w) - Math.floor(s / 2);
      const y0 = Math.round(m.cy * h) - Math.floor(s / 2);
      if (x >= x0 && x < x0 + s && y >= y0 && y < y0 + s) return TINTA;
    }
    return BLANCO;
  };
}

/** Marcas fiduciales en las POSICIONES MEDIDAS del dueño (§0-F1): tl(5.8%,3.6%)
 *  tr(97.2%,4.1%) bl(8.0%,97.6%) br(97.2%,97.9%) — con y-sup variable. */
function marcasDelDueño(ySup: number, xIzq = 0.058): Marca[] {
  return [
    { cx: xIzq, cy: ySup },
    { cx: 0.972, cy: Math.min(0.06, ySup + 0.005) },
    { cx: 0.08, cy: 0.976 },
    { cx: 0.972, cy: 0.979 },
  ];
}

// ── Base DIVIPOL real (la misma que carga el pipeline) ──

const base = JSON.parse(
  readFileSync(new URL("../public/e14/divipol.json", import.meta.url), "utf8"),
) as DivipolBase;

// ── Contadores ──

let ok = 0;
let fails = 0;
function check(nombre: string, cond: boolean, detalle = ""): void {
  if (cond) {
    ok += 1;
    console.log(`  ✓ ${nombre}`);
  } else {
    fails += 1;
    console.log(`  ✗ FAIL ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const QUAD_FILO: Quad = [
  { x: 0.0005, y: 0.0005 },
  { x: 0.9995, y: 0.0005 },
  { x: 0.9995, y: 0.9995 },
  { x: 0.0005, y: 0.9995 },
];
const QUAD_SANO: Quad = [
  { x: 0.02, y: 0.02 },
  { x: 0.98, y: 0.02 },
  { x: 0.98, y: 0.98 },
  { x: 0.02, y: 0.98 },
];

const CAB = "E-14 REGISTRADURÍA NACIONAL\nCONSULADO: 88 - CONSULADOS\n";

// ═════════════════════════════════════════════════════════════════════════
console.log("=== QA consenso-frankfurt — AC1..AC5 (§8 del kit) ===\n");

// ── AC1 — unidad slash ──
console.log("AC1 · candidatosCodigo1D + codigoUnicoE14 (Frankfurt «7» como «/»):");
const c1a = candidatosCodigo1D("/1000/453010202 …");
check("«/1000/453010202 …» → incluye 710007453010202", c1a.includes("710007453010202"), JSON.stringify(c1a));
const c1b = candidatosCodigo1D("71000/453010202");
check("«71000/453010202» (15 crudos, 1 «/») → incluye 710007453010202", c1b.includes("710007453010202"), JSON.stringify(c1b));
const c1c = candidatosCodigo1D("/1000/45301020 2");
check(
  "espacio pegado: 16 crudos → pega a 15 y añade (el glue no inventa dígitos)",
  c1c.includes("710007453010202"),
  JSON.stringify(c1c),
);
const c1d = candidatosCodigo1D("/1000 453010202");
check(
  "15 crudos con 1 espacio pegan a 14 → SIN candidato (no cabe ventana de 15; límite del §4.1)",
  c1d.length === 0,
  JSON.stringify(c1d),
);
const c1e = candidatosCodigo1D("KIT 399 · 710003993010102 · MESA 001");
check("código puro \\d{15} NO genera candidato (lo cubre ANCLA_CODIGO_1D)", c1e.length === 0, JSON.stringify(c1e));
const cu745 = codigoUnicoE14("710007453010202");
check(
  "codigoUnicoE14(710007453010202) → kit 745 · d9 3 · pág 2/2",
  cu745 !== null && cu745.kit === 745 && cu745.tipoDigito === "3" && cu745.pagina === 2 && cu745.total === 2,
  JSON.stringify(cu745),
);

// ── AC2 — unidad consenso kit (arbitraje por el registro, divipol real) ──
console.log("\nAC2 · consenso del KIT arbitrado por el registro (mun 335):");
const a2a = clasificarCabecera(
  `${CAB}PAIS: 335 - EL CAIRO\nZONA: 05 PUESTO: 02 MESA: 001\nKIT 399\n710003003010102\nVer.: 01 Pag.: 01 de 02\nTRANSMISION`,
  base,
);
check(
  "pie 399 + código leído 300 → kit 399 + PIE_CODIGO_DISCREPAN + KIT_CODIGO_CORREGIDO",
  a2a.kit === 399 &&
    (a2a.avisos ?? []).includes("PIE_CODIGO_DISCREPAN") &&
    (a2a.avisos ?? []).includes("KIT_CODIGO_CORREGIDO"),
  `kit=${a2a.kit} av=${JSON.stringify(a2a.avisos)}`,
);
check("procedencia del kit ganador = REGISTRO", a2a.kitFuente === "REGISTRO", String(a2a.kitFuente));
const a2b = clasificarCabecera(
  `${CAB}PAIS: 335 - EL CAIRO\nZONA: 05 PUESTO: 02 MESA: 001\n710003003010102\nVer.: 01 Pag.: 01 de 02\nTRANSMISION`,
  base,
);
check(
  "pie AUSENTE + código 300 → 399 + KIT_CODIGO_CORREGIDO (sin PIE_CODIGO_DISCREPAN)",
  a2b.kit === 399 &&
    (a2b.avisos ?? []).includes("KIT_CODIGO_CORREGIDO") &&
    !(a2b.avisos ?? []).includes("PIE_CODIGO_DISCREPAN"),
  `kit=${a2b.kit} av=${JSON.stringify(a2b.avisos)}`,
);
const a2c = clasificarCabecera(
  `${CAB}PAIS: 335 - EL CAIRO\nZONA: 05 PUESTO: 02 MESA: 001\n710005123010102\nVer.: 01 Pag.: 01 de 02`,
  base,
);
check(
  "kit 512 fuera de registro (sin pie) → 512 + sin inventar",
  a2c.kit === 512 &&
    a2c.kitFuente === "CODIGO" &&
    !(a2c.avisos ?? []).includes("KIT_CODIGO_CORREGIDO"),
  `kit=${a2c.kit} fuente=${a2c.kitFuente} av=${JSON.stringify(a2c.avisos)}`,
);

// ── AC3 — unidad mesa (guard de rango + cruce con registro) ──
console.log("\nAC3 · MESA: guard de rango (p.t) + registro (mun 335 t=1 · mun 120 t=9):");
const a3a = clasificarCabecera(
  `${CAB}PAIS: 335 - EL CAIRO\nZONA: 05 PUESTO: 02 MESA: 004\nKIT 399\n710003993010102\nVer.: 01 Pag.: 01 de 02`,
  base,
);
check(
  "MESA 004 con t=1 → MESA_FUERA_RANGO + mesa por registro (1)",
  a3a.mesa === 1 &&
    (a3a.avisos ?? []).includes("MESA_FUERA_RANGO") &&
    (a3a.avisos ?? []).includes("MESA_POR_KIT"),
  `mesa=${a3a.mesa} av=${JSON.stringify(a3a.avisos)}`,
);
check("la lectura imposible NO llega a parciales.mesa", a3a.parciales?.mesa === null, String(a3a.parciales?.mesa));
check("mesa por registro NUNCA da AUTO", a3a.nivel === "SUGERIDA", a3a.nivel);
const a3b = clasificarCabecera(
  `${CAB}PAIS: 335 - EL CAIRO\nZONA: 05 PUESTO: 02 MESA: 001\nKIT 399\n710003993010102\nVer.: 01 Pag.: 01 de 02`,
  base,
);
check(
  "MESA 001 (= registro 1) → sin aviso de mesa + AUTO intacto",
  a3b.mesa === 1 &&
    !(a3b.avisos ?? []).includes("MESA_FUERA_RANGO") &&
    !(a3b.avisos ?? []).includes("MESA_REGISTRO_DISCREPAN") &&
    a3b.nivel === "AUTO",
  `mesa=${a3b.mesa} nivel=${a3b.nivel} av=${JSON.stringify(a3b.avisos)}`,
);
const a3c = clasificarCabecera(
  `${CAB}PAIS: 120 - ALEMANIA\nZONA: 05 PUESTO: 02 MESA: 001\nTRANSMISION\nKIT 726\n710007262010102\nVer.: 01 Pag.: 01 de 02`,
  base,
);
check(
  "MESA 001 en rango (t=9) ≠ registro 8 → MESA_REGISTRO_DISCREPAN + AUTO baja a SUGERIDA",
  a3c.mesa === 1 &&
    (a3c.avisos ?? []).includes("MESA_REGISTRO_DISCREPAN") &&
    a3c.nivel === "SUGERIDA",
  `mesa=${a3c.mesa} nivel=${a3c.nivel} av=${JSON.stringify(a3c.avisos)}`,
);

// ── Unidad Frankfurt completa (§0-F4 — la cadena del dueño, sin ocrBanda) ──
console.log("\nFrankfurt 746 (código «/1000/453010202» + pie oficial 746):");
const fr = clasificarCabecera(
  `${CAB}PAIS: 120 - ALEMANIA\nZONA: 15 PUESTO: 02\nKIT 746\n/1000/453010202\nVer.: 01 Pag.: 02 de 02`,
  base,
);
check(
  "consenso del código slash → kit 745 (registro) + PÁG 2/2 + mesa 12 por kit",
  fr.kit === 745 && fr.pagina?.index === 2 && fr.pagina?.total === 2 && fr.mesa === 12,
  `kit=${fr.kit} pag=${JSON.stringify(fr.pagina)} mesa=${fr.mesa} av=${JSON.stringify(fr.avisos)}`,
);
check(
  "pie oficial 746 ≠ código 745 (inconsistencia de la forma) → PIE_CODIGO_DISCREPAN",
  (fr.avisos ?? []).includes("PIE_CODIGO_DISCREPAN"),
  JSON.stringify(fr.avisos),
);
check("tipoDeBanda extraída (FASE 4): TRANSMISIÓN primero, DELEGADOS después", (() => {
  const t1 = tipoDeBanda("…\nTRANSMISION\n…");
  const t2 = tipoDeBanda("CÓNSUL/EMBAJADOR 05");
  const t3 = tipoDeBanda("sin banda");
  return t1 === "TRANSMISION" && t2 === "DELEGADOS" && t3 === null;
})());

// ── AC4 — marcasEsquina adaptativa ──
console.log("\nAC4 · marcasEsquina adaptativa (geometría §0-F1):");
const nulo = marcasEsquina(makeCanvas(60, 90, () => BLANCO));
check("canvas 60×90 → null (no medible, jamás condena)", nulo === null, trazaEsquinas(nulo));

const W1 = 908;
const H1 = 2859; // captura del dueño (Frankfurt, AR 0.318)
const fr4 = marcasEsquina(makeCanvas(W1, H1, pintorActa(W1, H1, marcasDelDueño(0.036))));
check(
  `Frankfurt 908×2859 con marcas ~3%W en posiciones medidas → 4/4`,
  fr4 !== null && fr4.tl && fr4.tr && fr4.bl && fr4.br,
  trazaEsquinas(fr4),
);

const W2 = 995;
const H2 = 3127; // captura del dueño (El Cairo)
const cairo = marcasEsquina(makeCanvas(W2, H2, pintorActa(W2, H2, marcasDelDueño(0.041))));
check(
  "El Cairo 995×3127 (marca 30px) → 4/4",
  cairo !== null && cairo.tl && cairo.tr && cairo.bl && cairo.br,
  trazaEsquinas(cairo),
);

const sinMarcas = marcasEsquina(makeCanvas(W1, H1, () => BLANCO));
check(
  "canvas grande SIN marcas → 0/4 (todo-false, NO null)",
  sinMarcas !== null && !sinMarcas.tl && !sinMarcas.tr && !sinMarcas.bl && !sinMarcas.br,
  trazaEsquinas(sinMarcas),
);

/** Barcode real bajo la zona sup-izq (y 6-10%H, x 0-20%W) SIN fiduciales —
 *  el anillo debe rechazarlo (§0-F1: anillo ~0.5-0.6 < 0.75). */
const barcodePix: Pix = (x, y) =>
  y >= H1 * 0.06 && y <= H1 * 0.1 && x <= W1 * 0.2 ? TINTA : BLANCO;
const conBarcode = marcasEsquina(makeCanvas(W1, H1, barcodePix));
check(
  "banda tipo barcode sin anillo blanco → 0/4 (el anillo descarta texto/barras)",
  conBarcode !== null && !conBarcode.tl && !conBarcode.tr && !conBarcode.bl && !conBarcode.br,
  trazaEsquinas(conBarcode),
);

console.log("  · 12 páginas del visor (y-sup 2-6%H, x-izq 3.8-8%W):");
const ySups = [0.02, 0.026, 0.032, 0.036, 0.041, 0.046, 0.052, 0.056, 0.06, 0.024, 0.038, 0.05];
const xIzqs = [0.038, 0.044, 0.05, 0.058, 0.064, 0.07, 0.08, 0.042, 0.055, 0.061, 0.047, 0.075];
let paginasOk = 0;
for (let i = 0; i < 12; i += 1) {
  const r = marcasEsquina(
    makeCanvas(W1, H1, pintorActa(W1, H1, marcasDelDueño(ySups[i], xIzqs[i]))),
  );
  const bien = r !== null && r.tl && r.tr && r.bl && r.br;
  if (bien) paginasOk += 1;
  else console.log(`    ✗ pág ${i + 1} (y=${ySups[i]} x=${xIzqs[i]}): ${trazaEsquinas(r)}`);
}
check("12/12 páginas → 4/4", paginasOk === 12, `${paginasOk}/12`);

// Presupuesto §2 (<30 ms en navegador): el navegador paga getImageData
// (memcpy) + el bucle de la integral. Aquí el buffer ya está cacheado → la
// medición aísla la integral + búsqueda (la parte que depende del código).
// Se cronometran 3 pasadas y se toma la MÍNIMA (bun frío infla la 1ª).
const canvasTiming = makeCanvas(W1, H1, pintorActa(W1, H1, marcasDelDueño(0.036)));
marcasEsquina(canvasTiming); // 1ª pasada: construye el buffer del stub (NO se cronometra)
let dtMs = Infinity;
for (let i = 0; i < 3; i += 1) {
  const t0 = performance.now();
  marcasEsquina(canvasTiming);
  dtMs = Math.min(dtMs, performance.now() - t0);
}
console.log(
  `  · presupuesto: integral+búsqueda 908×2859 = ${dtMs.toFixed(1)} ms (mín de 3; kit: <30 ms en navegador + memcpy del getImageData)`,
);
check("presupuesto de integral+búsqueda (bun) ≤ 30 ms", dtMs <= 30, `${dtMs.toFixed(1)} ms`);

// ── AC5 — verificarCompletitud: los fiduciales perdonan ──
console.log("\nAC5 · verificarCompletitud (quad al filo + tinta ~30% del stub):");
const perdonada = await verificarCompletitud(QUAD_FILO, "data:image/jpeg;base64,stub", ESQUINAS_OK);
// KIT e14-esquinas-suaves-v1 (Q1): el perdón por lado RELAJA al 4/4 — con
// las 4 fiduciales CADA lado tiene su par → TODOS perdonados: tintaFilo
// queda false (antes: true conservado como evidencia por
// perdonadaSiPapelEntero) y la evidencia vive en `perdonLado="N|S|E|O"`
// (token perdon= del log). Misma decisión (completa=true).
check(
  "4 fiduciales + tinta al filo → completa=true (perdon=N|S|E|O — Q1: perdón por lado)",
  perdonada.completa === true &&
    perdonada.sospecha === "N|S|E|O" &&
    perdonada.tintaFilo === false &&
    perdonada.densidades.length === 4 &&
    perdonada.fondo === false &&
    perdonada.perdonLado === "N|S|E|O",
  JSON.stringify(perdonada),
);
const hoy = await verificarCompletitud(QUAD_FILO, "data:image/jpeg;base64,stub", null);
check(
  "esquinas null + tinta al filo → completa=false (comportamiento de hoy)",
  hoy.completa === false && hoy.sospecha === "N|S|E|O" && hoy.tintaFilo === true,
  JSON.stringify(hoy),
);
const parcial = await verificarCompletitud(QUAD_FILO, "data:image/jpeg;base64,stub", {
  tl: true,
  tr: true,
  bl: true,
  br: false,
});
check(
  "esquinas con FALTANTE (br) + tinta → completa=false (conservador)",
  parcial.completa === false,
  JSON.stringify(parcial),
);
const sano = await verificarCompletitud(QUAD_SANO, "data:image/jpeg;base64,stub", null);
check(
  "quad sano → completa=true sin análisis (D4 intacto)",
  sano.completa === true && sano.sospecha === "" && sano.densidades.length === 0,
  JSON.stringify(sano),
);

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n=== RESULTADO: ${ok} OK · ${fails} FAIL ===`);
if (fails !== 0) {
  console.error("QA FALLIDO — consenso-frankfurt no cuadra (§8).");
  process.exit(1);
}
console.log("AC1-AC5 VERIFICADOS (bun, divipol real, stubs de canvas documentados).");
