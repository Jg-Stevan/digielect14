/**
 * QA headless — KIT e14-observabilidad-v1, AGENTE 3 (A3-C4): anclas del
 * CONTRATO de la UI del modo dev (kit del agente 2, feat/obs-modo-dev-v1).
 * Sin red, sin DOM, determinista — greps estáticos sobre src/components/e14/**.
 *
 *   bun scripts/qa-obs-ui.ts
 *
 * Anclas del kit A3-C4:
 *   a. ResumenView.tsx ya NO contiene `INFORME ZIP` ni `generarInformeZip`
 *      (grep NEGATIVO — el botón del informe migró al panel dev).
 *   b. aria-label="Abrir modo de diagnóstico" existe en components/e14/**.
 *   c. `e14-dev-mode` se lee/escribe SOLO vía leerModoDev/guardarModoDev
 *      (grep negativo de acceso directo a la clave en components — la
 *      persistencia es del contrato §4.1, dueño agente 1).
 *   d. badge DEV en TopBar.tsx (el modo dev es visible siempre que está ON).
 *   e. PanelDev contiene las 7 secciones del contrato (modo dev, salud,
 *      errores agrupados, perf de actas, uso, política de datos, kill
 *      switch/overrides) — greps conceptuales: si el agente 2 usó textos
 *      distintos NO cambiar el QA a ciegas: coordinar con el dueño y
 *      documentar en el REPORTE (kit A3-C4 ⚠).
 *   f. El kill switch escribe por guardarOverridesFlags (grep positivo) y
 *      JAMÁS escribe `e14-flags-overrides` directo (grep negativo).
 *
 * FASE 0: el módulo dev/** lo crea el agente 2 (feat/obs-modo-dev-v1). Sin
 * UI el QA reporta PENDIENTE y sale 0 (adaptación declarada M-A3-1 en el
 * REPORTE); al aterrizar pasa a ESTRICTO (fallo = exit 1).
 */
import { readdir, readFile } from "node:fs/promises";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

const TOTAL_ANCLAS = 8;

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
 *  dispararse por menciones en documentación del propio código — patrón
 *  qa-obs-privacidad.ts). */
function quitarComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

// ---------- Objetivos ----------

const DIR_UI = "src/components/e14/";
const DEV_DIR = `${DIR_UI}dev/`;
const rutasUi = await listarTs(DIR_UI);
const fuentesUi = await Promise.all(
  rutasUi.map(async (r) => ({ ruta: r, src: await leerFuente(r) })),
);
const paresUi = fuentesUi.filter((f): f is { ruta: string; src: string } => f.src !== null);

const srcResumen = (await leerFuente(`${DIR_UI}screens/ResumenView.tsx`)) ?? "";
const srcTopBar = (await leerFuente(`${DIR_UI}TopBar.tsx`)) ?? "";
const devExiste = paresUi.some((p) => p.ruta.startsWith(DEV_DIR));
const srcDev = paresUi
  .filter((p) => p.ruta.startsWith(DEV_DIR))
  .map((p) => p.src)
  .join("\n");
const todoUi = paresUi.map((p) => p.src).join("\n");

// ---------- FASE 0 · modo PENDIENTE (sin UI del agente 2) ----------

if (!devExiste) {
  console.log(`— FASE 0 · objetivo ausente (${DEV_DIR}**) —`);
  console.log("  Las anclas de la UI dev se activan al integrar feat/obs-modo-dev-v1 (kit §1).");
  console.log(`QA obs-ui: 0/${TOTAL_ANCLAS} · PENDIENTE UI (FASE 0) — gate FASE 0 OK`);
  process.exit(0);
}

// ---------- Bloque a · el botón de informe migró fuera de ResumenView ----------

console.log("— Bloque a · ResumenView sin INFORME ZIP (migró al panel dev) —");

// CALIBRADO (FASE 1, UI real del agente 2): la cabecera de ResumenView
// documenta la migración y menciona `INFORME ZIP`/`generarInformeZip` en
// COMENTARIO — el grep negativo corre sobre el código (sin comentarios).
// Evidencia: screens/ResumenView.tsx L13-15 (doc) vs código limpio.
const resumenSinCom = quitarComentarios(srcResumen);

ok(
  !resumenSinCom.includes("INFORME ZIP") && !resumenSinCom.includes("generarInformeZip"),
  "ResumenView.tsx SIN `INFORME ZIP` ni `generarInformeZip` en CÓDIGO (grep negativo sin comentarios — kit A3-C4 a; el flujo migró a PanelDev §C3)",
);

// ---------- Bloque b · puerta del modo dev ----------

console.log("— Bloque b · aria-label de la puerta del modo diagnóstico —");

// CALIBRADO (FASE 1, UI real del agente 2): TuercaResumen.tsx L88 usa un
// ternario — aria-label={modoDev ? "Abrir modo de diagnóstico" :
// "Activar modo de diagnóstico"} — el binding + el nombre accesible
// existen; el ancla exige ambos en lugar del literal concatenado.
ok(
  /aria-label=\{?/.test(srcDev) &&
    srcDev.includes('"Abrir modo de diagnóstico"') &&
    srcDev.includes('"Activar modo de diagnóstico"'),
  'la puerta del modo diagnóstico tiene aria-label con nombre accesible ("Abrir/Activar modo de diagnóstico" — TuercaResumen; kit A3-C4 b calibrado al ternario)',
);

// ---------- Bloque c · e14-dev-mode SOLO vía helpers del contrato ----------

console.log("— Bloque c · persistencia e14-dev-mode vía helpers (§4.1) —");

ok(
  !/localStorage\.(get|set|remove)Item\(\s*["'`]e14-dev-mode/.test(todoUi),
  "components/e14 SIN acceso directo a localStorage e14-dev-mode (la clave vive en politica.ts — §4.1)",
);
ok(
  /leerModoDev|guardarModoDev/.test(srcDev),
  "la UI dev lee/escribe el modo vía leerModoDev/guardarModoDev (helpers del contrato)",
);

// ---------- Bloque d · badge DEV en TopBar ----------

console.log("— Bloque d · badge DEV en TopBar —");

ok(
  /\bDEV\b/.test(srcTopBar),
  "TopBar.tsx muestra el badge DEV (kit A3-C4 d)",
);

// ---------- Bloque e · PanelDev con las 7 secciones del contrato ----------

console.log("— Bloque e · PanelDev: 7 secciones —");

{
  const SECCIONES = [
    ["modo dev", /modo dev/i],
    ["salud", /salud/i],
    ["errores agrupados", /error/i],
    ["perf de actas", /perf/i],
    ["uso", /\buso\b/i],
    ["política de datos", /pol[ií]tica/i],
    ["kill switch / overrides", /override|kill/i],
  ] as const;
  const faltantes = SECCIONES.filter(([, re]) => !re.test(srcDev)).map(([n]) => n);
  ok(
    faltantes.length === 0,
    `PanelDev cubre las 7 secciones del contrato${
      faltantes.length ? ` — FALTA: ${faltantes.join(", ")}` : ""
    } (kit A3-C4 e — textos distintos → coordinar con el dueño, NO editar a ciegas)`,
  );
}

// ---------- Bloque f · kill switch vía guardarOverridesFlags ----------

console.log("— Bloque f · kill switch por guardarOverridesFlags —");

ok(
  todoUi.includes("guardarOverridesFlags"),
  "el kill switch escribe por guardarOverridesFlags (helper §4.3 del agente 1)",
);
ok(
  !/localStorage\.setItem\(\s*["'`]e14-flags-overrides/.test(todoUi),
  "components/e14 SIN escritura directa de e14-flags-overrides (persistencia del contrato — §4.1)",
);

// ---------- resultado ----------

console.log(`\nQA obs-ui: ${pasadas - fallos}/${pasadas} OK`);
if (fallos > 0) process.exit(1);
