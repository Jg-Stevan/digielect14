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
 *   2. Chip QR (C1): MasivaView ya NO contiene text-white/30 (2.70:1 — el
 *      peor fallo AA) y SÍ conserva las condiciones lógicas del chip
 *      (f.qrEstado === "leido" · sin-payload+LISTA — T-0.2 de
 *      qa-qr-identidad sigue anclando LÓGICA, no clases) + el chip ✗ ahora
 *      text-slate-400.
 *   3. Rojo crit (M4): primitives.tsx con 0 ef4444 y ≥ 4 E52222; y
 *      PanelDev/VistaErrores/ActasView/ResumenView AÚN contienen ef4444
 *      (migración incompleta prohibida en AMBAS direcciones — sobre
 *      superficie oscura el #E52222 EMPEORARÍA el contraste).
 *   4. Táctiles (M1): MasivaView sin min-h-[32px]/[34px]/[42px] y con
 *      min-h-[44px]; ResumenView sin min-h-[40px].
 *   5. Residuales INTACTOS (pactados fuera de alcance): ReviewView conserva
 *      su text-[13px] … gray-500 y PanelClasificacion su gray-500 disabled
 *      — el QA afirma que SIGUEN (si el agente los tocó, rojo: tocó lo
 *      prohibido).
 *   6. Exclusiones intactas: los iconos (w-11 h-11 de MasivaView · h-6 w-6
 *      de ReviewView) conservan su gris (fuera de AA 1.4.3).
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
/** KIT ux-masiva-fixes-v1 (§F.2, M-ux-2): los tokens con prefijo
 *  `disabled:` son estilos de ESTADO INACTIVO — WCAG 1.4.3 los exime
 *  (mismo criterio que la exención de PanelClasificacion DISABLED, §5)
 *  y el kit ux-masiva-fixes-v1 prescribe disabled:text-slate-500 para
 *  PROCESAR COLA. Se remueven de la línea ANTES del test GRIS: cualquier
 *  gris 500/600 en texto ACTIVO sigue prohibido con la misma severidad
 *  (el contrato del estilo disabled vive en qa-ux-masiva-fixes 6.2). */
const ESTADO_INACTIVO = /(?:disabled|enabled):text-(?:slate|gray)-(?:500|600)/g;

async function main(): Promise<void> {
  // ── 1 · Grises AA: 0 co-ocurrencias gris ≤12px en src/components/** ──────
  const componentes = await tsxDe("src/components");
  let coocurrentes = 0;
  for (const f of componentes) {
    const src = (await leer(f)) ?? "";
    for (const linea of src.split("\n")) {
      // M-ux-2: estilos de estado inactivo (disabled:) fuera del scan —
      // el texto ACTIVO con gris 500/600 sigue contando (ver arriba).
      if (GRIS.test(linea.replace(ESTADO_INACTIVO, "")) && PEQUE.test(linea)) {
        coocurrentes++;
      }
    }
  }
  ok(
    coocurrentes === 0,
    `0 líneas con gris 500/600 + texto ≤ 12 px en src/components/** (${componentes.length} .tsx escaneados — C1 del kit §B)`,
  );

  // ── 2 · Chip QR ✗: el peor fallo AA del repo corregido, lógica intacta ───
  const masiva = (await leer("src/components/e14/screens/MasivaView.tsx")) ?? "";
  ok(!masiva.includes("text-white/30"), "MasivaView SIN text-white/30 (2.70:1 — diagnóstico C1, kit §B)");
  ok(
    masiva.includes('f.qrEstado === "leido"') &&
      masiva.includes('f.qrEstado === "sin-payload"') &&
      masiva.includes('f.estado === "LISTA"'),
    "lógica del chip QR intacta (leido / sin-payload+LISTA — T-0.2 qa-qr-identidad sigue anclando LÓGICA)",
  );
  ok(
    /qrEstado === "sin-payload"[^\n]*\n[^\n]*text-slate-400/.test(masiva) ||
      /text-\[9px\] font-semibold tracking-wide text-slate-400/.test(masiva),
    "chip QR ✗ ahora text-slate-400 (≈7:1 — mantiene la jerarquía atenuada)",
  );

  // ── 3 · Rojo crit: #E52222 SOLO en primitives; los oscuros intactos ──────
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

  // ── 4 · Targets táctiles: 44 px en operador, SOLO min-h (§D) ─────────────
  ok(
    !masiva.includes("min-h-[32px]") &&
      !masiva.includes("min-h-[34px]") &&
      !masiva.includes("min-h-[42px]"),
    "MasivaView sin min-h-[32px]/[34px]/[42px] (FILTROS · ENVIAR ADVERTENCIAS · PAUSAR · PROCESAR · VACIAR — M1)",
  );
  ok(masiva.includes("min-h-[44px]"), "MasivaView con min-h-[44px] (targets táctiles ≥ 44 px)");
  const resumen = (await leer("src/components/e14/screens/ResumenView.tsx")) ?? "";
  ok(
    !resumen.includes("min-h-[40px]") && resumen.includes("min-h-[44px]"),
    "ResumenView sin min-h-[40px] y con min-h-[44px] (REINICIAR JORNADA — M1)",
  );

  // ── 5 · Residuales pactados INTACTOS (tocarlos ES desviación) ────────────
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

  // ── 6 · Exclusiones intactas: iconos con su gris (fuera de AA 1.4.3) ─────
  ok(
    /w-11 h-11[^\n]*text-slate-500/.test(masiva),
    "icono MasivaView (w-11 h-11) conserva su gris (exclusión verificada del auditor — kit §B)",
  );
  ok(
    /h-6 w-6[^\n]*text-gray-500/.test(review),
    "icono ReviewView (h-6 w-6) conserva su gris (exclusión verificada del auditor — kit §B)",
  );

  // ── resultado ────────────────────────────────────────────────────────────
  console.log(`\nQA aa-quickwins: ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
