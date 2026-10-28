/**
 * QA headless — KIT e14-aa-quickwins-bfcache-v1 (§E, T5): contrato de los
 * quick wins AA + el fix bfcache. Sin red, sin DOM, determinista —
 * source-scan estático (patrón lección 3A.1, mismo esqueleto de los
 * qa-*.ts: readFile + ok() + remate final OK). ANCLA POR PATRÓN, jamás por
 * número de línea (los números del kit son del snapshot 9b0fe8d).
 *
 *   bun scripts/qa-aa-quickwins.ts
 *
 * Checks (kit §E):
 *   1. Grises AA (C1): en src/components/** hay 0 líneas con co-ocurrencia
 *      text-(slate|gray)-(500|600) + token de tamaño ≤ 12 px en la MISMA
 *      línea de clases.
 *   2. Rojo crit (M4): primitives.tsx con 0 ef4444 y ≥ 4 E52222; y
 *      PanelDev/VistaErrores/ActasView/ResumenView AÚN contienen ef4444
 *      (migración incompleta prohibida en AMBAS direcciones — sobre
 *      superficie oscura el #E52222 EMPEORARÍA el contraste).
 *   3. Táctiles (M1): ResumenView sin min-h-[40px] y con min-h-[44px].
 *   4. Residuales INTACTOS (pactados fuera de alcance): ReviewView conserva
 *      su text-[13px] … gray-500 y PanelClasificacion su gray-500 disabled
 *      — el QA afirma que SIGUEN (si el agente los tocó, rojo: tocó lo
 *      prohibido).
 *   5. Exclusiones intactas: el icono de ReviewView (h-6 w-6) conserva su
 *      gris (fuera de AA 1.4.3).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

/** Lee un archivo del repo relativo a la raíz; null si no existe. */
async function leer(ruta: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), ruta), "utf8");
  } catch {
    return null;
  }
}

/** Lista recursiva de .tsx bajo src/components (source-scan del check 1). */
async function tsxDe(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await tsxDe(rel)));
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const GRIS = /text-(?:slate|gray)-(?:500|600)/;
const PEQUE = /text-\[(?:9|9\.5|10|10\.5|11)px\]|text-xs\b/;

async function main(): Promise<void> {
  // ── 1 · Grises AA: 0 co-ocurrencias gris ≤12px en src/components/** ──────
  const componentes = await tsxDe("src/components");
  let coocurrentes = 0;
  for (const f of componentes) {
    const src = (await leer(f)) ?? "";
    for (const linea of src.split("\n")) {
      if (GRIS.test(linea) && PEQUE.test(linea)) coocurrentes++;
    }
  }
  ok(
    coocurrentes === 0,
    `0 líneas con gris 500/600 + texto ≤ 12 px en src/components/** (${componentes.length} .tsx escaneados — C1 del kit §B)`,
  );

  // ── 2 · Rojo crit: #E52222 SOLO en primitives; los oscuros intactos ──────
  const primitives = (await leer("src/components/e14/primitives.tsx")) ?? "";
  ok(!primitives.includes("ef4444"), "primitives.tsx con 0 ef4444 (M4 — migración completa)");
  ok(
    (primitives.match(/E52222/g) ?? []).length >= 4,
    "primitives.tsx con ≥ 4 E52222 (crit bg/text/shadow/rgba — blanco-sobre-rojo 4.58:1 pasa AA)",
  );
  const oscuros: [string, string][] = [
    ["PanelDev", "src/components/e14/dev/PanelDev.tsx"],
    ["VistaErrores", "src/components/e14/dev/VistaErrores.tsx"],
    ["ActasView", "src/components/e14/screens/ActasView.tsx"],
    ["ResumenView", "src/components/e14/screens/ResumenView.tsx"],
  ];
  for (const [nombre, ruta] of oscuros) {
    const src = (await leer(ruta)) ?? "";
    ok(
      src.includes("ef4444"),
      `${nombre} AÚN contiene ef4444 (superficie oscura ≈5.5:1 — oscurecerlo EMPEORARÍA; §C quirúrgico)`,
    );
  }

  // ── 3 · Targets táctiles: 44 px, SOLO min-h (§D) ─────────────────────
  const resumen = (await leer("src/components/e14/screens/ResumenView.tsx")) ?? "";
  ok(
    !resumen.includes("min-h-[40px]") && resumen.includes("min-h-[44px]"),
    "ResumenView sin min-h-[40px] y con min-h-[44px] (REINICIAR JORNADA — M1)",
  );

  // ── 4 · Residuales pactados INTACTOS (tocarlos ES desviación) ──────
  const review = (await leer("src/components/e14/screens/ReviewView.tsx")) ?? "";
  ok(
    /text-\[13px\][^\n]*text-gray-500/.test(review),
    "ReviewView conserva su residual text-[13px] gray-500 (13 px > 12 px — pactado para e80, kit §B)",
  );
  const panelClas = (await leer("src/components/e14/PanelClasificacion.tsx")) ?? "";
  ok(
    /text-gray-500[^\n]*cursor-not-allowed|cursor-not-allowed[^\n]*text-gray-500/.test(panelClas),
    "PanelClasificacion conserva su gray-500 DISABLED (exento por WCAG 1.4.3 — kit §B)",
  );

  // ── 5 · Exclusiones intactas: icono con su gris (fuera de AA 1.4.3) ─────
  ok(
    /h-6 w-6[^\n]*text-gray-500/.test(review),
    "icono ReviewView (h-6 w-6) conserva su gris (exclusión verificada del auditor — kit §B)",
  );

  // ── resultado ────────────────────────────────────────────────────────────
  console.log(`\nQA aa-quickwins: ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
