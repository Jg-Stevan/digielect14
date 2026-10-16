/**
 * QA FUERA DEL BUNDLE — KIT identificacion-codigo-v1 (§2/§7, Task 120):
 * gramática del código 1D impreso `codigoUnicoE14` contra los 12 códigos
 * reales del ANALISIS §1 (docs/research/PATRON-identificacion-actas-e14.md —
 * 6 actas oficiales del visor Registraduría, 12 páginas) + 3 negativos.
 * Corre con: `bun scripts/qa-codigo-unico.ts` — sale 1 si algún caso falla.
 */
import { codigoUnicoE14, tipoDeDigito } from "../src/lib/e14/clasificador";

interface Fixture {
  codigo: string;
  kit: number;
  d9: "2" | "3";
  pag: number;
  tot: number;
  acta: string;
}

/** // Fuente: ANALISIS §1 — tabla verificada 12/12 (visor Registraduría). */
const FIXTURES: Fixture[] = [
  { codigo: "710009822010102", kit: 982, d9: "2", pag: 1, tot: 2, acta: "ROMA 001 DELEGADOS p1" },
  { codigo: "710009822010202", kit: 982, d9: "2", pag: 2, tot: 2, acta: "ROMA 001 DELEGADOS p2" },
  { codigo: "710003993010102", kit: 399, d9: "3", pag: 1, tot: 2, acta: "EL CAIRO 001 TRANSMISIÓN p1" },
  { codigo: "710003993010202", kit: 399, d9: "3", pag: 2, tot: 2, acta: "EL CAIRO 001 TRANSMISIÓN p2" },
  { codigo: "710003992010102", kit: 399, d9: "2", pag: 1, tot: 2, acta: "EL CAIRO 001 DELEGADOS p1" },
  { codigo: "710003992010202", kit: 399, d9: "2", pag: 2, tot: 2, acta: "EL CAIRO 001 DELEGADOS p2" },
  { codigo: "710012652010102", kit: 1265, d9: "2", pag: 1, tot: 2, acta: "BARCELONA-GIRONA 001 DELEGADOS p1" },
  { codigo: "710012652010202", kit: 1265, d9: "2", pag: 2, tot: 2, acta: "BARCELONA-GIRONA 001 DELEGADOS p2" },
  { codigo: "710007262010102", kit: 726, d9: "2", pag: 1, tot: 2, acta: "BERLIN 008 DELEGADOS p1" },
  { codigo: "710007262010202", kit: 726, d9: "2", pag: 2, tot: 2, acta: "BERLIN 008 DELEGADOS p2" },
  { codigo: "710007273010102", kit: 727, d9: "3", pag: 1, tot: 2, acta: "BERLIN 009 TRANSMISIÓN p1" },
  { codigo: "710007273010202", kit: 727, d9: "3", pag: 2, tot: 2, acta: "BERLIN 009 TRANSMISIÓN p2" },
];

let ok = 0;
let fails = 0;

console.log("=== QA codigoUnicoE14 — gramática 7100|KIT(4)|TIPO(1)|VER(2)|PAG(2)|TOT(2) ===\n");
console.log("FIXTURES (12 códigos oficiales del ANALISIS §1):\n");
console.log(
  "código           | kit  | d9 | tipo         | ver | pág/tot | acta                        | OK",
);
console.log("-".repeat(118));
for (const f of FIXTURES) {
  const r = codigoUnicoE14(f.codigo);
  const pasa =
    r !== null &&
    r.kit === f.kit &&
    r.tipoDigito === f.d9 &&
    r.pagina === f.pag &&
    r.total === f.tot &&
    r.ver === 1 &&
    tipoDeDigito(r.tipoDigito) === (f.d9 === "3" ? "TRANSMISION" : "DELEGADOS");
  if (pasa) ok += 1;
  else fails += 1;
  console.log(
    `${f.codigo} | ${String(f.kit).padStart(4)} | ${f.d9}  | ${tipoDeDigito(f.d9 as "2" | "3").padEnd(12)} |  1  |   ${f.pag}/${f.tot}    | ${f.acta.padEnd(27)} | ${pasa ? "✓" : "✗ FAIL " + JSON.stringify(r)}`,
  );
}

console.log("\nNEGATIVOS (3):\n");
// 1) Trampa de posiciones (kit §2): `710003992010103` es el fixture DELEGADOS
//    con el ÚLTIMO dígito 2→3 — el dígito cambiado es el d15 (TOTAL: 02→03),
//    NO el d9 (sigue siendo "2" → DELEGADOS). El PARSEO correcto da
//    kit 399 · D · 1/3 — jamás un flip a T (eso exigiría cambiar el d9:
//    710003993010102, ya cubierto en los fixtures 3-4 con tipoDeDigito=T).
//    Nota: la nota del kit decía «d9=3…parseo da T» — el dígito que cambia
//    es el d15 según la gramática verificada 12/12 (ANALISIS §1); la
//    aserción sigue la gramática, no la errata (documentado en el reporte).
const n1 = codigoUnicoE14("710003992010103");
const n1Ok =
  n1 !== null &&
  n1.kit === 399 &&
  n1.tipoDigito === "2" &&
  tipoDeDigito(n1.tipoDigito) === "DELEGADOS" &&
  n1.pagina === 1 &&
  n1.total === 3;
console.log(
  `710003992010103 (d15 2→3: TOTAL=3, d9 intacto=2) → kit 399 · DELEGADOS · 1/3: ${n1Ok ? "✓" : "✗ FAIL " + JSON.stringify(n1)}`,
);
// 2) no numérico (X en d15) → null (el ancla de 15 dígitos ya no matchea;
//    el parseo tampoco acepta no-dígitos).
const n2 = codigoUnicoE14("71000982201010X");
console.log(`71000982201010X (no numérico)      → null: ${n2 === null ? "✓" : "✗ FAIL " + JSON.stringify(n2)}`);
// 3) prefijo malo (8100…) → null (la gramática exige 7100).
const n3 = codigoUnicoE14("810003992010102");
console.log(`810003992010102 (prefijo malo)     → null: ${n3 === null ? "✓" : "✗ FAIL " + JSON.stringify(n3)}`);
if (n1Ok) ok += 1;
else fails += 1;
if (n2 === null) ok += 1;
else fails += 1;
if (n3 === null) ok += 1;
else fails += 1;

console.log(`\n=== RESULTADO: ${ok} OK · ${fails} FAIL ===`);
if (ok !== 15 || fails !== 0) {
  console.error("QA FALLIDO — la gramática no cuadra 12/12 + 3 negativos.");
  process.exit(1);
}
console.log("12/12 fixtures + 3 negativos — gramática VERIFICADA.");
