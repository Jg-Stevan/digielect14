/**
 * QA headless — contrato e14-motor-paridad-v1 (post-v2.3): los DOS repos del
 * dominio (`digielect14` = móvil por puesto, `supervision-e14` = supervisor
 * masivo) comparten el paquete `@jg-stevan/scanner-core` vendorizado en
 * `packages/scanner-core/`. Este harness VERIFICA que las dos copias del
 * paquete sigan diciendo lo mismo, comparando el checkout hermano en disco.
 *
 *   bun scripts/qa-paridad-motor.ts
 *
 * Sin hermano en el disco (el caso del CI de GitHub, que solo clona este repo)
 * sale OK con «omitido» explícito: el golden del paquete lo validan las dos
 * apps contra SU propia copia, y los 120 tests del paquete corren en ambos CI
 * (workflow 3.8). Con hermano, esto añade el cotejo repo↔repo.
 *
 * Qué compara, en orden de fuerza:
 *   1. El golden del contrato byte a byte — es el artefacto compartido; si
 *      diverge, una copia del paquete se regeneró sin propagar.
 *   2. `public/e14/divipol.json` byte a byte — la base que resuelve rutas.
 *   3. Los módulos de negocio del paquete (`dominio/clasificador` ·
 *      `completitud` · `kits` · `integridad` · `diagnostico` · `senal-lectura` ·
 *      `marcadores` · `divipol`). Las dos copias deben ser BYTE A BYTE
 *      idénticas: un cambio del motor se aplica a los dos repos en el mismo
 *      commit.
 *   4. Anclas puntuales que ya divergieron una vez (el `split` del dict de
 *      RapidOCR — ver docs/DEUDA.md · trampas de entorno) y las dependencias
 *      que el paquete necesita en runtime.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const HERMANO = process.env.E14_HERMANO ?? join(RAIZ, "..", "supervision-e14");
const PKG_A = join(RAIZ, "packages", "scanner-core");
const PKG_B = join(HERMANO, "packages", "scanner-core");
const SRC_A = join(PKG_A, "src", "dominio");
const SRC_B = join(PKG_B, "src", "dominio");

if (!existsSync(SRC_B)) {
  console.log(
    `OK · omitido — no hay checkout hermano en ${HERMANO} (E14_HERMANO para señalarlo).\n` +
      `     En CI este paso no corre; la paridad la sostiene el golden compartido.`,
  );
  process.exit(0);
}

const lee = (p: string): string => readFileSync(p, "utf8");
const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");

console.log(`— hermano: ${HERMANO} —`);

// ---------- 1 y 2 · artefactos del contrato ----------

const goldenA = lee(join(PKG_A, "tests", "fixtures", "contrato-motor.json"));
const goldenB = lee(join(PKG_B, "tests", "fixtures", "contrato-motor.json"));
ok(
  md5(goldenA) === md5(goldenB),
  `golden del contrato idéntico en los dos repos [${md5(goldenA).slice(0, 8)}]`,
);

const divipolA = lee(join(RAIZ, "public", "e14", "divipol.json"));
const divipolB = lee(join(HERMANO, "public", "e14", "divipol.json"));
ok(
  md5(divipolA) === md5(divipolB),
  `public/e14/divipol.json idéntico (base DIVIPOL compartida) [${md5(divipolA).slice(0, 8)}]`,
);

// ---------- 3 · módulos de negocio, con diferencias declaradas ----------

/** Los módulos de negocio del paquete: las dos copias repo↔repo deben ser
 *  idénticas. No hay lista blanca — un cambio del motor se aplica a las dos
 *  copias en el mismo commit. */
const MODULOS = [
  "clasificador.ts",
  "completitud.ts",
  "kits.ts",
  "integridad.ts",
  "diagnostico.ts",
  "senal-lectura.ts",
  "marcadores.ts",
  "divipol.ts",
];

for (const archivo of MODULOS) {
  const a = join(SRC_A, archivo);
  const b = join(SRC_B, archivo);
  if (!existsSync(a) || !existsSync(b)) {
    ok(false, `${archivo}: falta en uno de los dos repos (${existsSync(a) ? "" : "A "}${existsSync(b) ? "" : "B"})`);
    continue;
  }
  const sa = lee(a).replace(/\r\n/g, "\n");
  const sb = lee(b).replace(/\r\n/g, "\n");
  if (sa === sb) {
    ok(true, `${archivo}: idéntico en las dos copias del paquete`);
    continue;
  }
  const la = sa.split("\n");
  const lb = sb.split("\n");
  const primeras: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && primeras.length < 3; i++) {
    if (la[i] !== lb[i]) primeras.push(`L${i + 1} A:${(la[i] ?? "∅").trim().slice(0, 72)} | B:${(lb[i] ?? "∅").trim().slice(0, 72)}`);
  }
  ok(false, `${archivo}: DIVERGE (${primeras.length} primeras diferencias de ${Math.abs(la.length - lb.length)} líneas de delta)\n     ${primeras.join("\n     ")}`);
}

// ---------- 4 · anclas puntuales que ya divergieron ----------

const rapidocrA = lee(join(PKG_A, "src", "ocr", "rapidocr.ts"));
const rapidocrB = lee(join(PKG_B, "src", "ocr", "rapidocr.ts"));
const splitDict = (t: string): boolean => /\.text\(\)\)\.split\(\/\\r\?\\n\/\)/.test(t);
ok(splitDict(rapidocrA), "A parsea el dict de RapidOCR con split(/\\r?\\n/) (tolerante a CRLF)");
ok(splitDict(rapidocrB), "B parsea el dict de RapidOCR con split(/\\r?\\n/) (misma ancla)");

const escanerA = lee(join(RAIZ, "src", "lib", "e14", "scanner-core-bridge.ts"));

// El motor vive en el paquete. Sus imports DINÁMICOS (`import("heic2any")` en
// el rescate F-HEIC) y directos (`jspdf` en pdf-export) se resuelven desde el
// app que consume el workspace: si alguien los quita «porque no aparecen en
// ningún import de src/», el build sigue verde y el HEIC de un iPhone revienta
// en runtime.
const pkgA = JSON.parse(lee(join(RAIZ, "package.json"))) as {
  dependencies?: Record<string, string>;
};
const pkgB = JSON.parse(lee(join(HERMANO, "package.json"))) as {
  dependencies?: Record<string, string>;
};
ok(
  !!pkgA.dependencies?.heic2any && !!pkgB.dependencies?.heic2any,
  "los dos declaran heic2any (import dinámico del core — HEIC)",
);
ok(!!pkgA.dependencies?.jspdf, "A declara jspdf (pdf-export del core)");
ok(
  pkgA.dependencies?.["@jg-stevan/scanner-core"] === "workspace:*" &&
    pkgB.dependencies?.["@jg-stevan/scanner-core"] === "workspace:*",
  "los dos consumen el paquete vendorizado por workspace",
);
ok(escanerA.includes("clasificarCabecera"), "A sigue clasificando con el clasificador compartido (no con uno propio)");

// ---------- resultado ----------

console.log(`\nQA paridad de motor: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
