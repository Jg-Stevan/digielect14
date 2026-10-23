/**
 * QA headless — KIT e14-observabilidad-v1, AGENTE 3 (A3-C3): barrido de
 * FUGAS de privacidad sobre src/lib/e14/obs/** y src/lib/e14/flags.ts.
 * Sin red, sin DOM, determinista (mismo harness de los 7 QA existentes).
 *
 *   bun scripts/qa-obs-privacidad.ts
 *
 * Reglas congeladas (reglas de oro 2/4/5 del README-KITS §2 — D1/D4):
 *   a. CERO `console.` en obs/** + flags.ts (solo logger).
 *   b. CERO `localStorage.setItem` fuera de las 6 claves del contrato §4.1.
 *   c. El buffer/transporte JAMÁS serializan blob/File/dataURL; la única
 *      ruta de miniaturas vive en export.ts y SIEMPRE precedida del chequeo
 *      de política (miniaturas default OFF — D4).
 *   d. `actaId` plano JAMÁS sale de captura.ts (la firma §4.3 de
 *      emitirPerfDeActa lo RECIBE y lo hashea con fnv1a8 → actaIdHash).
 *   e. export.ts re-verifica los toggles con default OFF (textoOcr,
 *      miniaturas) vía leerPolitica — defensa en profundidad.
 *
 * FASE 0: los objetivos los crea el agente 1 (feat/obs-nucleo-v1). Sin
 * núcleo el QA reporta PENDIENTE y sale 0 (adaptación declarada M-A3-1 en
 * el REPORTE); al aterrizar pasa a ESTRICTO (fallo = exit 1).
 */
import { readdir, readFile } from "node:fs/promises";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const TOTAL_ANCLAS = 7;

/** Lee un archivo del repo relativo a la raíz; null si aún no existe. */
async function leerFuente(rel: string): Promise<string | null> {
  try {
    return await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

/** Lista recursiva de archivos .ts/.tsx (sin .test.ts) bajo dirRel.
 *  dirRel es RELATIVO A LA RAÍZ del repo (prefijo `../` obligatorio — ver
 *  nota en qa-obs-contract.ts; bug de FASE 0 corregido en la calibración). */
async function listarTs(dirRel: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entradas = await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).catch(
      () => null,
    );
    if (entradas === null) return; // dir ausente — FASE 0
    for (const e of entradas) {
      const ruta = `${dir}${e.name}${e.isDirectory() ? "/" : ""}`;
      if (e.isDirectory()) await walk(ruta);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(ruta);
    }
  }
  await walk(dirRel);
  return out;
}

/** Quita comentarios de línea y bloque (los greps negativos no deben
 *  dispararse por menciones en documentación del propio código). */
function quitarComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

// ---------- Objetivos ----------

const DIR_OBS = "src/lib/e14/obs/";
const archivosObs = await listarTs(DIR_OBS);
const rutas = [...archivosObs, "src/lib/e14/flags.ts"];
const fuentes = await Promise.all(rutas.map(async (r) => ({ ruta: r, src: await leerFuente(r) })));
const pares = fuentes.filter((f): f is { ruta: string; src: string } => f.src !== null);
const sentinelTipos = await leerFuente(`${DIR_OBS}tipos.ts`);

// ---------- FASE 0 · modo PENDIENTE (sin núcleo) ----------

if (sentinelTipos === null) {
  console.log("— FASE 0 · objetivos del núcleo ausentes (src/lib/e14/obs/tipos.ts) —");
  console.log("  Las anclas de privacidad se activan al integrar feat/obs-nucleo-v1 (kit §1).");
  console.log(
    `QA obs-privacidad: 0/${TOTAL_ANCLAS} · PENDIENTE NÚCLEO (FASE 0) — gate FASE 0 OK`,
  );
  process.exit(0);
}

const CLAVES_CONTRATO = new Set([
  "e14-obs",
  "e14-obs-outbox",
  "e14-obs-politica",
  "e14-dev-mode",
  "e14-obs-device-id",
  "e14-flags-overrides",
]);

const srcBuffer = (await leerFuente(`${DIR_OBS}buffer.ts`)) ?? "";
const srcTransporte = (await leerFuente(`${DIR_OBS}transporte.ts`)) ?? "";
const srcExport = (await leerFuente(`${DIR_OBS}export.ts`)) ?? "";
const srcCaptura = (await leerFuente(`${DIR_OBS}captura.ts`)) ?? "";

const todoCodigo = pares.map((p) => quitarComentarios(p.src)).join("\n");

// ---------- Bloque a · cero console.* (solo logger) ----------

console.log("— Bloque a · cero console.* en obs/** + flags.ts —");

ok(
  pares.length > 0 && !/\bconsole\./.test(todoCodigo),
  `cero console.* en ${pares.length} archivos de obs/** + flags.ts (regla de oro 4 — usar logger)`,
);

// ---------- Bloque b · localStorage.setItem solo con claves §4.1 ----------

console.log("— Bloque b · setItem restringido a las 6 claves del contrato §4.1 —");

const escrituras = [...todoCodigo.matchAll(/localStorage\.setItem\(\s*["'`]([^"'`]+)["'`]/g)].map(
  (m) => m[1],
);
const ilegales = escrituras.filter((k) => !CLAVES_CONTRATO.has(k));
ok(
  pares.length > 0 && ilegales.length === 0,
  `toda escritura localStorage usa claves §4.1 (${escrituras.length} escrituras, 0 fuera del contrato)`,
);

// ---------- Bloque c · blob/File/dataURL JAMÁS en buffer/transporte ----------

console.log("— Bloque c · sin serialización de contenido en buffer/transporte —");

const prohibited = /blob|dataurl|\bnew File\b/i;
ok(
  !prohibited.test(quitarComentarios(srcBuffer)) &&
    !prohibited.test(quitarComentarios(srcTransporte)),
  "buffer.ts y transporte.ts sin blob/File/dataURL (jamás viaja contenido de actas)",
);

// La ÚNICA ruta de muestras de miniaturas vive en export.ts y queda gated
// por el chequeo de política (miniaturas default OFF — D4).
// CALIBRADO (FASE 1, núcleo real del agente 1): la heurística «toda mención
// de la palabra miniaturas cerca de politica» marcaba el NOMBRE del helper
// (miniaturasDeFallidas) — el ancla ahora verifica la RUTA: la llamada al
// productor de muestras ocurre DENTRO del if de política.
const expSinCom = quitarComentarios(srcExport);
const idxGate = expSinCom.search(/if\s*\([^)]*politica\.miniaturas/);
const idxLlamadaMuestras = idxGate >= 0 ? expSinCom.indexOf("miniaturasDeFallidas()", idxGate) : -1;
ok(
  idxGate >= 0 && idxLlamadaMuestras > idxGate && idxLlamadaMuestras - idxGate < 300,
  "la única ruta de muestras (miniaturasDeFallidas) se invoca DENTRO de `if (…politica.miniaturas…)` — muestras solo con el toggle ON (D4)",
);

// ---------- Bloque d · actaId plano JAMÁS fuera de captura.ts ----------

console.log("— Bloque d · cero PII: actaId solo hasheado (FNV-1a 8 hex) —");

ok(
  !/datos\.actaId\b/.test(todoCodigo),
  "cero `datos.actaId` en obs/** + flags.ts (el evento JAMÁS lleva el id plano)",
);
{
  const conActaIdPlano = pares
    .filter((p) => !p.ruta.endsWith("obs/captura.ts"))
    .filter((p) => /actaId(?!Hash)/.test(quitarComentarios(p.src)));
  ok(
    srcCaptura !== null && conActaIdPlano.length === 0,
    `actaId plano SOLO en captura.ts (firma §4.3 que lo recibe y hashea — captura.ts presente: ${srcCaptura !== null}) — fuera de ella: ${conActaIdPlano.length} archivos`,
  );
}

// ---------- Bloque e · export.ts re-verifica toggles default OFF ----------

console.log("— Bloque e · export.ts re-verifica la política (defensa en profundidad) —");

// CALIBRADO (FASE 1): el scrub de textoOcr es ESTRUCTURAL (el ReporteSesion
// del contrato §4.2 no tiene campo de texto — doc de export.ts) y el de
// miniaturas es el gate del bloque c. El ancla verifica la lectura real de
// la política (leerPolitica()) + el gate de muestras.
ok(
  /leerPolitica\s*\(/.test(expSinCom) && idxGate >= 0,
  "export.ts construye el reporte vía leerPolitica() y las muestras quedan gated por politica.miniaturas (textoOcr es estructural: ReporteSesion sin campo de texto — D4)",
);

// ---------- resultado ----------

console.log(`\nQA obs-privacidad: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
