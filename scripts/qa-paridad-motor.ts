/**
 * QA headless — contrato e14-motor-paridad-v1: los DOS repos del dominio
 * (`digielect14` = móvil por puesto, `supervision-e14` = supervisor masivo)
 * comparten el negocio que decide el resultado de un acta. Este harness
 * VERIFICA que sigan compartiéndolo, comparando el checkout hermano en disco.
 *
 *   bun scripts/qa-paridad-motor.ts
 *
 * Sin hermano en el disco (el caso del CI de GitHub, que solo clona este repo)
 * sale OK con «omitido» explícito: el guardado real en CI lo hace el golden
 * (`src/lib/e14/__fixtures__/contrato-motor.json`), que los dos repos validan
 * contra SU propia copia del motor.
 *
 * Qué compara, en orden de fuerza:
 *   1. El golden byte a byte — es el artefacto del contrato; si diverge, algún
 *      repo lo regeneró sin propagar.
 *   2. `public/e14/divipol.json` byte a byte — la base que resuelve rutas.
 *   3. Los módulos de negocio compartidos (`clasificador` · `completitud` ·
 *      `kits` · `integridad` · `diagnostico` · `senal-lectura` · `marcadores` ·
 *      `divipol`), con una LISTA BLANCA de diferencias declaradas (el hermano
 *      exporta dos símbolos más para sus tests, importa `PUBLIC_BASE` de
 *      `@/shared/env` y redactó distinto la procedencia de sus muestras).
 *      Fuera de la lista, cualquier línea distinta es hallazgo: el negocio se
 *      sincroniza, no se bifurca.
 *      NO se cotejan `image-utils.ts`, `seed.ts`, `scanner-core-bridge.ts` ni
 *      nada de `masiva/` u `ocr/`: son capas propias de cada producto (el lote
 *       recibe RAR/PDF y tiene bandeja; el móvil no) y divergir es correcto.
 *   4. Anclas puntuales que ya divergieron una vez (el `split` del dict de
 *      RapidOCR — ver docs/DEUDA.md · trampas de entorno).
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
const SRC_A = join(RAIZ, "src", "lib", "e14");
const SRC_B = join(HERMANO, "src", "modules", "digitalizador", "lib", "e14");

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

const goldenA = lee(join(SRC_A, "__fixtures__", "contrato-motor.json"));
const goldenB = lee(join(SRC_B, "__tests__", "__fixtures__", "contrato-motor.json"));
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

/** Diferencias PERMITIDAS entre la copia de este repo y la del hermano. Cada
 *  entrada es [descripción, regex, reemplazo]. Si la regex no aparece en NINGUNO
 *  de los dos lados, el cotejo igual pasa — pero si aparece y produce un texto
 *  que no coincide, se reporta. */
interface Permiso {
  que: string;
  en: RegExp;
  pone: string;
}

const MODULOS: Array<{ archivo: string; permisos: Permiso[] }> = [
  {
    archivo: "clasificador.ts",
    permisos: [
      {
        que: "el hermano EXPORTA codigoUnicoE14 (lo usa en sus tests; aquí es interno)",
        en: /^(?:export )?function codigoUnicoE14/gm,
        pone: "function codigoUnicoE14",
      },
    ],
  },
  { archivo: "completitud.ts", permisos: [] },
  { archivo: "kits.ts", permisos: [] },
  { archivo: "integridad.ts", permisos: [] },
  { archivo: "diagnostico.ts", permisos: [] },
  {
    archivo: "senal-lectura.ts",
    permisos: [
      {
        que: "el hermano EXPORTA la interfaz SenalLectura (la importan sus tests)",
        en: /^(?:export )?interface SenalLectura/gm,
        pone: "interface SenalLectura",
      },
    ],
  },
  {
    archivo: "marcadores.ts",
    permisos: [
      // El hermano citó «fotos de referencia del dueño» y aquí se citan los
      // assets del repo; misma medición, distinta procedencia nombrada. Los
      // tres permisos colapsan ESO, no el código: si un umbral de tinta cambia,
      // el cotejo sigue poniéndolo rojo.
      {
        que: "los nombres de las muestras medidas (assets del repo vs fotos del dueño)",
        en: /acta-sim-intermedia\.jpg|acta-sim-baja\.jpg|acta-e14-real\.jpg|muestra (?:intermedia|baja|nítida)/g,
        pone: "MUESTRA",
      },
      {
        que: "la frase que describe quién midió (dos redacciones de la misma evidencia)",
        en: /medido sobre los assets reales del repo, script jpeg-js|medido con jpeg-js sobre las fotos de referencia del dueño/g,
        pone: "MEDICION",
      },
      { que: "raya alta vs baja tipográfica en los porcentajes citados", en: /–/g, pone: "-" },
    ],
  },
  {
    archivo: "divipol.ts",
    permisos: [
      {
        que: "el hermano trae PUBLIC_BASE de @/shared/env (acá es const local)",
        en: /^(?:import \{ PUBLIC_BASE \} from "@\/shared\/env";|const PUBLIC_BASE = process\.env\.NEXT_PUBLIC_BASE_PATH \?\? "";)$(?:\r?\n)?/gm,
        pone: "",
      },
      { que: "comentario R2 del hermano sobre PUBLIC_BASE", en: /^\/\/ R2 — PUBLIC_BASE único.*$(?:\r?\n)?/gm, pone: "" },
    ],
  },
];

/** Normalización GLOBAL del alias al motor vendorizado: el mismo import del core
 *  se escribe `@/lib/e14/core/…` acá y `@/modules/digitalizador/lib/e14/core/…`
 *  allá (cada repo tiene su árbol). Es diferencia de RUTA, no de negocio, así
 *  que se colapsa antes de cotejar — y solo esa cadena: si cambia un umbral o una
 *  firma del core, el cotejo la sigue viendo. */
const ALIAS_CORE = /@\/(?:modules\/digitalizador\/)?lib\/e14\/core\//g;

function sincronizado(texto: string, permisos: Permiso[]): string {
  let salida = texto.replace(ALIAS_CORE, "@/e14/core/");
  for (const p of permisos) salida = salida.replace(p.en, p.pone);
  return salida.replace(/\r\n/g, "\n");
}

for (const m of MODULOS) {
  const a = join(SRC_A, m.archivo);
  const b = join(SRC_B, m.archivo);
  if (!existsSync(a) || !existsSync(b)) {
    ok(false, `${m.archivo}: falta en uno de los dos repos (${existsSync(a) ? "" : "A "}${existsSync(b) ? "" : "B"})`);
    continue;
  }
  const sa = sincronizado(lee(a), m.permisos);
  const sb = sincronizado(lee(b), m.permisos);
  if (sa === sb) {
    ok(true, `${m.archivo}: idéntico tras ${m.permisos.length} diferencia(s) declarada(s)`);
    continue;
  }
  const la = sa.split("\n");
  const lb = sb.split("\n");
  const primeras: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && primeras.length < 3; i++) {
    if (la[i] !== lb[i]) primeras.push(`L${i + 1} A:${(la[i] ?? "∅").trim().slice(0, 72)} | B:${(lb[i] ?? "∅").trim().slice(0, 72)}`);
  }
  ok(false, `${m.archivo}: DIVERGE (${primeras.length} primeras diferencias de ${Math.abs(la.length - lb.length)} líneas de delta)\n     ${primeras.join("\n     ")}`);
}

// ---------- 4 · anclas puntuales que ya divergieron ----------

const rapidocrA = lee(join(SRC_A, "ocr", "rapidocr.ts"));
const rapidocrB = lee(join(SRC_B, "ocr", "rapidocr.ts"));
const splitDict = (t: string): boolean => /\.text\(\)\)\.split\(\/\\r\?\\n\/\)/.test(t);
ok(splitDict(rapidocrA), "A parsea el dict de RapidOCR con split(/\\r?\\n/) (tolerante a CRLF)");
ok(splitDict(rapidocrB), "B parsea el dict de RapidOCR con split(/\\r?\\n/) (misma ancla)");

const escanerA = lee(join(SRC_A, "scanner-core-bridge.ts"));

// El motor es código del repo (src/lib/e14/core/), no npm. Sus imports DINÁMICOS
// (`import("heic2any")` en el rescate F-HEIC) y directos (`jspdf` en pdf-export)
// ya no los aporta ningún paquete: si alguien los quita «porque no aparecen en
// ningún import de src/», el build sigue verde y el HEIC de un iPhone revienta en
// runtime. Anclados aquí los dos lados.
const pkgA = JSON.parse(lee(join(RAIZ, "package.json"))) as {
  dependencies?: Record<string, string>;
};
const pkgB = JSON.parse(lee(join(HERMANO, "package.json"))) as {
  dependencies?: Record<string, string>;
};
ok(
  !!pkgA.dependencies?.heic2any && !!pkgB.dependencies?.heic2any,
  "los dos declaran heic2any (import dinámico del core vendorizado — HEIC)",
);
ok(!!pkgA.dependencies?.jspdf, "A declara jspdf (pdf-export del core vendorizado)");
ok(
  !pkgA.dependencies?.["@jg-stevan/scanner-core"] &&
    !pkgB.dependencies?.["@jg-stevan/scanner-core"],
  "ninguno de los dos vuelve a depender del paquete npm del motor",
);
ok(escanerA.includes("clasificarCabecera"), "A sigue clasificando con el clasificador compartido (no con uno propio)");

// ---------- resultado ----------

console.log(`\nQA paridad de motor: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
