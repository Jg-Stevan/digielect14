/**
 * QA headless — KIT e14-observabilidad-v1, AGENTE 3 (A3-C2): el CONTRATO
 * congelado. Greps estáticos sobre src/ que fijan lo acordado en
 * README-KITS.md §4 (tipos, claves de persistencia, defaults de política,
 * firmas públicas) para que ninguna ola futura lo rompa. Sin red, sin DOM,
 * determinista (mismo harness de los 7 QA existentes — patrón
 * scripts/qa-watchdog-relectura.ts).
 *
 *   bun scripts/qa-obs-contract.ts
 *
 * FASE 0: los objetivos (src/lib/e14/obs/**, src/lib/e14/flags.ts) los crea
 * el agente 1 (feat/obs-nucleo-v1). Mientras el núcleo NO exista, el QA
 * reporta PENDIENTE y sale 0 — el gate del branch no se rompe por anclas que
 * aún no pueden evaluarse (adaptación declarada M-A3-1 en el REPORTE). Al
 * aterrizar el núcleo el QA pasa a modo ESTRICTO: cualquier ancla roja =
 * exit 1 (kit A3-C5: «si una ancla falla al integrar, STOP y documenta»).
 *
 * Bloques (anclas del kit A3-C2 — meta ~40, número exacto = el que salga):
 *   1. obs/tipos.ts: los 12 tipos del contrato §4.2 (verbatim del agente 1).
 *   2. Claves de persistencia §4.1: los 6 literales EXACTOS en src/lib/**.
 *   3. Defaults de política en politica.ts (D4): metadatos ON · textoOcr OFF
 *      · miniaturas OFF · saludEnVivo ON.
 *   4. Anti-recursión: flag `capturando` en captura.ts.
 *   5. Cero PII en perf: emitirPerfDeActa + actaIdHash + fnv1a8 en captura.ts.
 *   6. Firmas públicas §4.3: `export function <nombre>` en su archivo (11
 *      grupos, los 34 nombres + ErrorBoundaryObs del contrato).
 *   7. transporte.ts: sin `console.` (usa logger) + estado `fallosSeguidos`
 *      del kill local.
 */
import { readdir, readFile } from "node:fs/promises";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

// Total de anclas definidas (para la línea PENDIENTE de FASE 0). Mantener
// sincronizado con los ok() de abajo.
const TOTAL_ANCLAS = 38;

/** Lee un archivo del repo relativo a la raíz; null si aún no existe. */
async function leerFuente(rel: string): Promise<string | null> {
  try {
    return await readFile(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

/** Lista recursiva de archivos .ts/.tsx (sin .test.ts) bajo dirRel.
 *  dirRel es RELATIVO A LA RAÍZ del repo (el script vive en scripts/ — el
 *  prefijo `../` es obligatorio: sin él el readdir resuelve scripts/src/…
 *  y devuelve [] silencioso — bug de FASE 0 corregido en la calibración). */
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

// ---------- Objetivos del contrato ----------

const srcTipos = await leerFuente("src/lib/e14/obs/tipos.ts");
const srcBuffer = await leerFuente("src/lib/e14/obs/buffer.ts");
const srcBreadcrumbs = await leerFuente("src/lib/e14/obs/breadcrumbs.ts");
const srcUso = await leerFuente("src/lib/e14/obs/uso.ts");
const srcDigest = await leerFuente("src/lib/e14/obs/digest.ts");
const srcDispositivo = await leerFuente("src/lib/e14/obs/dispositivo.ts");
const srcPolitica = await leerFuente("src/lib/e14/obs/politica.ts");
const srcExport = await leerFuente("src/lib/e14/obs/export.ts");
const srcIdentidad = await leerFuente("src/lib/e14/obs/identidad.ts");
const srcCaptura = await leerFuente("src/lib/e14/obs/captura.ts");
const srcTransporte = await leerFuente("src/lib/e14/obs/transporte.ts");
const srcFlags = await leerFuente("src/lib/e14/flags.ts");

const archivosLib = await listarTs("src/lib/");
const srcLib = (await Promise.all(archivosLib.map((r) => leerFuente(r))))
  .map((s) => s ?? "")
  .join("\n");

// ---------- FASE 0 · modo PENDIENTE (sin núcleo) ----------

if (srcTipos === null) {
  console.log("— FASE 0 · objetivos del núcleo ausentes (src/lib/e14/obs/tipos.ts) —");
  console.log("  Las anclas del contrato se activan al integrar feat/obs-nucleo-v1 (kit §1).");
  console.log(
    `QA obs-contract: 0/${TOTAL_ANCLAS} · PENDIENTE NÚCLEO (FASE 0) — gate FASE 0 OK`,
  );
  process.exit(0);
}

// ---------- Bloque 1 · obs/tipos.ts — los 12 tipos del contrato §4.2 ----------

console.log("— Bloque 1 · obs/tipos.ts: 12 tipos del contrato §4.2 —");

const TIPOS = [
  "TipoEvento",
  "Tier",
  "Breadcrumb",
  "ErrorEvento",
  "PerfActa",
  "SaludSnapshot",
  "UsoContador",
  "PoliticaDatos",
  "EventoObs",
  "ErroresAgrupados",
  "FlagsApp",
  "ReporteSesion",
] as const;

for (const tipo of TIPOS) {
  ok(
    new RegExp(`^export (type|interface) ${tipo}\\b`, "m").test(srcTipos ?? ""),
    `tipos.ts exporta ${tipo} (contrato §4.2 verbatim)`,
  );
}

// ---------- Bloque 2 · claves de persistencia §4.1 (literales EXACTOS) ----------

console.log("— Bloque 2 · claves de persistencia §4.1 (en src/lib/**) —");

const CLAVES = [
  "e14-obs", // DB IndexedDB del buffer (agente 1)
  "e14-obs-outbox", // DB IndexedDB del transporte (agente 3 — JAMÁS abrir e14-obs)
  "e14-obs-politica", // localStorage PoliticaDatos (agente 1)
  "e14-dev-mode", // localStorage "on"|"off" (helpers A1 / UI A2)
  "e14-obs-device-id", // localStorage UUID anónimo persistente (agente 1)
  "e14-flags-overrides", // localStorage overrides manuales de flags (A1/A2)
] as const;

for (const clave of CLAVES) {
  ok(
    srcLib.includes(`"${clave}"`),
    `clave "${clave}" existe con literal EXACTO en src/lib/** (§4.1)`,
  );
}

// ---------- Bloque 3 · defaults de política (D4) en politica.ts ----------

console.log("— Bloque 3 · defaults de política (D4) en politica.ts —");

ok(
  (srcPolitica ?? "").includes("metadatos: true"),
  "default metadatos: true (D4 — ON sin excepciones)",
);
ok(
  (srcPolitica ?? "").includes("textoOcr: false"),
  "default textoOcr: false (D4 — OFF sin excepciones)",
);
ok(
  (srcPolitica ?? "").includes("miniaturas: false"),
  "default miniaturas: false (D4 — OFF sin excepciones)",
);
ok(
  (srcPolitica ?? "").includes("saludEnVivo: true"),
  "default saludEnVivo: true (D4 — solo corre con modo dev ON)",
);

// ---------- Bloque 4 · anti-recursión (flag capturando) ----------

console.log("— Bloque 4 · anti-recursión (guard capturando) —");

ok(
  (srcBuffer ?? "").includes("capturando"),
  "flag `capturando` existe como guard anti-recursión en buffer.ts appendEvento (regla de oro 4 — CALIBRADO: el núcleo lo implementó en el buffer, no en captura.ts — desviación documentada por el agente 1 en REPORTE-obs-nucleo-v1/worklog)",
);

// ---------- Bloque 5 · perf de actas con CERO PII ----------

console.log("— Bloque 5 · perf sin PII (actaId SIEMPRE hasheado) —");

ok(
  (srcCaptura ?? "").includes("export function emitirPerfDeActa") &&
    (srcCaptura ?? "").includes("actaIdHash"),
  "emitirPerfDeActa existe y emite actaIdHash (FNV-1a — JAMÁS el id plano)",
);
ok(
  (srcCaptura ?? "").includes("fnv1a8"),
  "captura.ts usa fnv1a8 para hashear actaId (cero PII — regla de oro 5)",
);

// ---------- Bloque 6 · firmas públicas §4.3 (11 grupos por archivo) ----------

console.log("— Bloque 6 · firmas públicas del contrato §4.3 —");

function tienenFirmas(src: string | null, firmas: string[]): boolean {
  return firmas.every(
    (f) =>
      new RegExp(`export (async )?function ${f}\\b`).test(src ?? "") ||
      new RegExp(`export async function ${f}\\b`).test(src ?? ""),
  );
}

ok(
  tienenFirmas(srcBuffer, [
    "abrirBuffer",
    "appendEvento",
    "leerEventos",
    "contarEventos",
    "purgarBuffer",
    "eventosPorDigest",
  ]),
  "buffer.ts exporta las 6 firmas §4.3 (abrirBuffer…eventosPorDigest)",
);
ok(
  tienenFirmas(srcCaptura, ["instalarCaptura", "emitirPerfDeActa"]) &&
    /export (const|class) ErrorBoundaryObs\b/.test(srcCaptura ?? ""),
  "captura.ts exporta instalarCaptura + emitirPerfDeActa + ErrorBoundaryObs §4.3 (CALIBRADO: acepta const|class — el núcleo lo implementó como clase de React, mismo ComponentType del contrato)",
);
ok(
  tienenFirmas(srcBreadcrumbs, [
    "iniciarBreadcrumbs",
    "registrarBreadcrumb",
    "obtenerBreadcrumbs",
  ]),
  "breadcrumbs.ts exporta las 3 firmas §4.3 (iniciarBreadcrumbs…obtenerBreadcrumbs)",
);
ok(
  tienenFirmas(srcUso, ["registrarUso", "iniciarUso"]),
  "uso.ts exporta registrarUso + iniciarUso §4.3",
);
ok(
  tienenFirmas(srcDigest, ["digestDe", "agregarErrores"]),
  "digest.ts exporta digestDe + agregarErrores §4.3",
);
ok(
  tienenFirmas(srcDispositivo, [
    "obtenerDispositivo",
    "iniciarMuestreoSalud",
    "detenerMuestreoSalud",
  ]),
  "dispositivo.ts exporta las 3 firmas §4.3 (obtenerDispositivo…detenerMuestreoSalud)",
);
ok(
  tienenFirmas(srcPolitica, [
    "leerPolitica",
    "guardarPolitica",
    "leerModoDev",
    "guardarModoDev",
    "leerOverridesFlags",
    "guardarOverridesFlags",
  ]),
  "politica.ts exporta las 6 firmas §4.3 (leerPolitica…guardarOverridesFlags)",
);
ok(
  tienenFirmas(srcExport, ["construirReporte", "descargarReporte"]),
  "export.ts exporta construirReporte + descargarReporte §4.3",
);
ok(
  tienenFirmas(srcIdentidad, ["idSesion", "idDispositivo", "appVersion", "fnv1a8"]),
  "identidad.ts exporta las 4 firmas §4.3 (idSesion…fnv1a8)",
);
ok(
  tienenFirmas(srcTransporte, ["iniciarTransporte", "estadoTransporte"]),
  "transporte.ts exporta iniciarTransporte + estadoTransporte §4.3 (stub A1 → implementación A3)",
);
ok(
  tienenFirmas(srcFlags, ["leerFlags", "refrescarFlags"]),
  "flags.ts exporta leerFlags + refrescarFlags §4.3",
);

// ---------- Bloque 7 · transporte.ts — higiene del contrato ----------

console.log("— Bloque 7 · transporte.ts: logger y kill local —");

ok(
  !/\bconsole\./.test(srcTransporte ?? ""),
  "transporte.ts SIN console.* (usa logger — regla de oro 4)",
);
ok(
  (srcTransporte ?? "").includes("fallosSeguidos"),
  "transporte.ts lleva estado fallosSeguidos (kill local tras 3 fallos del endpoint)",
);

// ---------- resultado ----------

console.log(`\nQA obs-contract: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
