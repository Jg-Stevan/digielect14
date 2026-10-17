/**
 * KIT e14-lectura-perdona-lazo-v1 (§6.1) — QA headless de la regla
 * `lazoPerdonadoPorLectura` («la lectura perdona al fiducial»).
 *
 * Mínimo contractual: los 10 casos del §5 del kit. Los textos de los casos
 * 1-2 son los ocr.txt REALES de los ZIPs de campo 2026-10-17 (CONSULADO 88 ·
 * EGIPTO · Frankfurt KIT 399 — citados verbatim en el kit T-A §1 y T-B §1/§5.8;
 * los ZIPs no llegaron al sandbox del agente → fragmentos reconstruidos de las
 * citas del kit, misma política de evidencia que el REPORTE §3-a). Convención
 * del repo: `bun scripts/qa-lectura-perdona.ts` → «N/N» + exit 1 si falla.
 */
import { lazoPerdonadoPorLectura } from "../src/lib/e14/senal-lectura";

// ---------- Textos de campo (cita verbatim del kit T-A §1) ----------
// zip1 (mesa-001, 621 chars): lee REGISTRADURÍA, CONSULADO, PAÍS, ZONA 05
// PUESTO 02 MESA 001, SUMA TOTAL, KIT 399, código 15d 710003993010102,
// E-14; «Ver Pag» falla («Pag1d2» sin la «e») — 9/10 anclas.
const OCR_ZIP1 = [
  "REGISTRADURÍA NACIONAL DEL ESTADO CIVIL",
  "CONSULADO 88 · EGIPTO",
  "PAÍS: COLOMBIA",
  "ZONA 05 PUESTO 02",
  "MESA 001",
  "SENADO DE LA REPÚBLICA",
  "FORMULARIO E - 14",
  "Pag1d2",
  "710003993010102",
  "CANDIDATOS…",
  "VOTOS EN BLANCO: 0 · NULOS: 0 · NO MARCADOS: 0",
  "SUMA TOTAL: 1",
  "KIT: 399",
].join("\n");
// zip2 (mesa-002, 379 chars): cortado en «TOTAL VOTOS INCINERADOS» — SIN
// SUMA TOTAL, SIN KIT, sin MESA (el crop corta antes — kit T-B §5.8).
const OCR_ZIP2 = [
  "REGISTRADURÍA NACIONAL DEL ESTADO CIVIL",
  "CONSULADO 88 · EGIPTO",
  "PAÍS: COLOMBIA",
  "ZONA 05 PUESTO 02",
  "SENADO DE LA REPÚBLICA",
  "CANDIDATOS…",
  "VOTOS EN BLANCO · NULOS · NO MARCADOS",
  "TOTAL VOTOS INCINERADOS",
].join("\n");

const OK4 = { tl: true, tr: true, bl: true, br: true };
const CASOS: Array<{ n: number; nombre: string; ok: boolean }> = [];
function caso(n: number, nombre: string, real: boolean, esperado: boolean) {
  CASOS.push({ n, nombre, ok: real === esperado });
  console.log(
    `caso ${n} ${real === esperado ? "OK " : "FAIL"} — ${nombre} → ${real} (esperado ${esperado})`,
  );
}

// §5.1 — zip1 REAL (el caso objetivo): lazo bl + SUMA TOTAL + KIT 399 → perdonado.
caso(
  1,
  "zip1 real: lazo bl + SUMA TOTAL + KIT 399 → perdón",
  lazoPerdonadoPorLectura({ tl: true, tr: true, bl: false, br: true }, OCR_ZIP1, false),
  true,
);
// §5.2 — zip2 REAL (control): texto cortado en INCINERADOS → faltaSeccion → sin perdón.
caso(
  2,
  "zip2 real: sin SUMA TOTAL (faltaSeccion) → cap se queda",
  lazoPerdonadoPorLectura({ tl: true, tr: true, bl: false, br: true }, OCR_ZIP2, true),
  false,
);
// §5.3 — 4/4 esquinas → false (nada que perdonar).
caso(3, "4/4 esquinas → false", lazoPerdonadoPorLectura(OK4, OCR_ZIP1, false), false);
// §5.4 — esquinas null → false (n/d jamás condena ni rescata).
caso(4, "esquinas null → false", lazoPerdonadoPorLectura(null, OCR_ZIP1, false), false);
// §5.5 — tope: tl faltante + E-14 leído → true · sin cabecera ni código → false.
caso(
  5,
  "tope: tl faltante + E-14 → perdón",
  lazoPerdonadoPorLectura({ tl: false, tr: true, bl: true, br: true }, OCR_ZIP1, false),
  true,
);
caso(
  5,
  "tope: tl faltante sin cabecera ni código → sin perdón",
  lazoPerdonadoPorLectura({ tl: false, tr: true, bl: true, br: true }, OCR_ZIP2, false),
  false,
);
// §5.6 — doble falta (tl+bl) con evidencia de AMBOS lados → true; con UNA → false.
caso(
  6,
  "doble falta tl+bl con ambos lados → perdón",
  lazoPerdonadoPorLectura({ tl: false, tr: true, bl: false, br: true }, OCR_ZIP1, false),
  true,
);
caso(
  6,
  "doble falta con UNA evidencia (texto sin KIT) → sin perdón",
  lazoPerdonadoPorLectura({ tl: false, tr: true, bl: false, br: true }, OCR_ZIP2, false),
  false,
);
// §5.7 — SUMA TOTAL legible pero KIT ilegible (corte por el medio del margen)
// → false → cap 7.9 ADVERTENCIA (degradación conservadora).
caso(
  7,
  "SUMA TOTAL sin KIT (corte medio) → sin perdón",
  lazoPerdonadoPorLectura(
    { tl: true, tr: true, bl: false, br: true },
    OCR_ZIP1.replace("KIT: 399", "KIT: ---"),
    false,
  ),
  false,
);
// §5.8 — página 2: faltaSeccion = falta FIRMA → fondo NO perdonado; con FIRMA
// leída + KIT (el pie P2 trae KIT) → perdonado. Página desconocida → faltaSeccion
// false → se evalúa por KIT/cabecera (conservador igual).
caso(
  8,
  "pag 2: sin FIRMA (faltaSeccion) → sin perdón",
  lazoPerdonadoPorLectura(
    { tl: true, tr: true, bl: false, br: true },
    OCR_ZIP1.replace("SUMA TOTAL: 1", "CONSTANCIAS"),
    true,
  ),
  false,
);
caso(
  8,
  "pag 2: FIRMA + KIT leídos → perdón",
  lazoPerdonadoPorLectura(
    { tl: true, tr: true, bl: false, br: true },
    OCR_ZIP1.replace("SUMA TOTAL: 1", "FIRMA DELEGADOS MESA"),
    false,
  ),
  true,
);
// §5.9 — SIM: esquinas = ESQUINAS_OK → faltan=[] → false → recortada idéntica.
caso(9, "SIM ESQUINAS_OK → false", lazoPerdonadoPorLectura(OK4, OCR_ZIP1, false), false);
// §5.10 — texto POST-banda (ocrBanda ya sumó el sello al texto — pitfall §9.8
// del kit score-lectura, heredado): el sello «K399» leído por la banda suma a
// la evidencia del pie (mismo texto que consume senalDeLectura).
caso(
  10,
  "post-banda: sello leído suma a la evidencia del pie → perdón",
  lazoPerdonadoPorLectura({ tl: true, tr: true, bl: false, br: true }, OCR_ZIP1 + "\nK399", false),
  true,
);

const ok = CASOS.filter((c) => c.ok).length;
console.log(`\nQA lectura-perdona: ${ok}/${CASOS.length}`);
process.exit(ok === CASOS.length ? 0 : 1);
