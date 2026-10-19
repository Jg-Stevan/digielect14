#!/usr/bin/env bun
/**
 * diag-flujo v1 — diagnóstico READ-ONLY del flujo del repo (digielect14)
 * =====================================================================
 * QUÉ HACE (4 frentes, un solo comando):
 *   1. ERRORES  — eslint + tsc --noEmit + riesgos en el código (console.log,
 *                 TODO/FIXME, `any`, debugger, catch vacíos) + boot del dev server.
 *   2. TIEMPOS  — duración de cada fase (lint/tsc/build/boot) + peso del export
 *                 estático (out/) + assets públicos (wasm/jpg — payload real).
 *   3. FLUJO    — mapa de vistas + anclas del pipeline (¿siguen vivas tras los
 *                 refactors?) + LOC por módulo + candidatos a código muerto
 *                 (archivos de src/ que NADIE importa).
 *   4. INFORME  — escribe informes/INFORME-diag-<fecha>.md + .json (máquina).
 *
 * CÓMO USAR (desde la RAÍZ del repo):
 *   bun diag-flujo-v1.ts                # todo (lint+tsc+build+boot)
 *   bun diag-flujo-v1.ts --rapido       # sin build ni boot (segundos)
 *   bun diag-flujo-v1.ts --no-build     # todo menos el build
 *   bun diag-flujo-v1.ts --no-boot      # todo menos el boot del dev server
 *   DIAG_PORT=3457 bun diag-flujo-v1.ts # puerto del boot-check (default 3457)
 *
 * GARANTÍAS:
 *   - READ-ONLY sobre el código: NUNCA edita src/, package.json ni config.
 *   - Solo escribe en informes/ (y out/ vía el build oficial de Next).
 *   - Cero dependencias nuevas: solo node:builtins — corre con bun (y node 20+).
 *   - El boot-check usa el puerto 3457 (no toca tu dev server del 3000).
 *   - Si tienes un dev server corriendo, ciérralo antes del paso BUILD
 *     (next build y next dev comparten .next/).
 */

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, extname, resolve, dirname, basename } from "node:path";

// ---------------------------------------------------------------- config ---
const T0 = performance.now();
const FLAGS = new Set(process.argv.slice(2));
const DO_BUILD = !FLAGS.has("--no-build") && !FLAGS.has("--rapido");
const DO_BOOT = !FLAGS.has("--no-boot") && !FLAGS.has("--rapido");
const PORT_BOOT = Number(process.env.DIAG_PORT ?? 3457);
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");
const DIR_INFORMES = join(ROOT, "informes");
const CARPETAS_FUERA = new Set(["node_modules", ".next", ".git", "out", "informes", "dist", ".turbo"]);
const EXTS_CODIGO = [".ts", ".tsx"];
const TIMEOUT_FASE_MS = 10 * 60_000;
const TIMEOUT_BOOT_MS = 30_000;

/** Anclas del flujo — si una desaparece, un refactor la rompió. */
const ANCHORES_FLUJO = [
  "dispararEscaneo",
  "analisisCompletado",
  "contarMotivoNoEnvioActa",
  "registrarEnvioMasiva",
  "abrirActaMasiva",
  "escanearActa",
  "getBridge",
  "loadImageMemo",
  "iniciarRunner",
  "recuperarCola",
  "tituloDeActa",
  "hacerThumb",
];

/** Palancas de tiempo conocidas — el valor vivo se imprime por informe. */
const CONSTANTES_TIEMPO = [
  "det_limit_side_len",
  "detLimitSideLen",
  "RECORTE_TIMEOUT_MS",
  "maxIntentos",
  "PROGRESO_MS",
  "ort.env.wasm.proxy",
];

interface Riesgo {
  id: string;
  re: RegExp;
  nivel: "CRITICO" | "LIMPIAR" | "REVISAR";
}
const RIESGOS: Riesgo[] = [
  { id: "debugger", re: /\bdebugger\b/, nivel: "CRITICO" },
  { id: "console.log", re: /console\.(log|debug|info)\(/, nivel: "LIMPIAR" },
  { id: "TODO:/FIXME/HACK", re: /\bTODO\s*:|\bFIXME\b|\bHACK\b|\bXXX\b/, nivel: "REVISAR" },
  { id: ": any / as any", re: /:\s*any\b|as\s+any\b/, nivel: "REVISAR" },
  { id: "catch vacío {}", re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, nivel: "REVISAR" },
  { id: "catch (total)", re: /\bcatch\b/, nivel: "REVISAR" },
];

// --------------------------------------------------------------- helpers ---
interface CmdRes {
  code: number | null;
  out: string;
  ms: number;
}
function runCmd(cmd: string[], env?: Record<string, string>): Promise<CmdRes> {
  return new Promise((resolveP) => {
    const t = performance.now();
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: ROOT,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = "";
    const cap = (d: Buffer) => {
      out += d.toString("utf8");
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => child.kill(), TIMEOUT_FASE_MS);
    child.on("error", (e) => {
      out += `\nSPAWN_ERROR: ${String(e)}`;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code, out, ms: performance.now() - t });
    });
  });
}

/** Leer un stream hasta que el texto calce regex o se agote el tiempo. */
function leerHasta(stream: Readable | null, regex: RegExp, ms: number): Promise<string> {
  return new Promise((resolveP) => {
    if (!stream) {
      resolveP("");
      return;
    }
    let texto = "";
    let listo = false;
    const fin = () => {
      if (listo) return;
      listo = true;
      stream.destroy();
      resolveP(texto);
    };
    const timer = setTimeout(fin, ms);
    stream.on("data", (d: Buffer) => {
      texto += d.toString("utf8");
      if (regex.test(texto)) {
        clearTimeout(timer);
        fin();
      }
    });
    stream.on("error", () => {
      clearTimeout(timer);
      fin();
    });
    stream.on("close", () => {
      clearTimeout(timer);
      fin();
    });
  });
}

async function walk(dir: string, exts: string[] | null, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (CARPETAS_FUERA.has(e.name)) continue;
      await walk(p, exts, acc);
    } else if (!exts || exts.includes(extname(e.name))) {
      acc.push(p);
    }
  }
  return acc;
}

const seg = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;

// ------------------------------------------------------------ colecta src ---
interface InfoArchivo {
  ruta: string;
  rel: string;
  loc: number;
  bytes: number;
  imports: string[];
  texto: string;
}

async function recopilarSrc(): Promise<InfoArchivo[]> {
  const rutas = await walk(SRC, EXTS_CODIGO);
  const infos: InfoArchivo[] = [];
  for (const ruta of rutas) {
    const texto = await readFile(ruta, "utf8");
    const imports = new Set<string>();
    const re = /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) imports.add(m[1]);
    infos.push({
      ruta,
      rel: relative(ROOT, ruta),
      loc: texto.split("\n").length,
      bytes: Buffer.byteLength(texto),
      imports: [...imports],
      texto,
    });
  }
  return infos;
}

// --------------------------------------------------------- grafo de imports ---
function resolverImport(desde: InfoArchivo, spec: string, rutas: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) base = resolve(dirname(desde.ruta), spec);
  else if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else return null;
  const candidatos = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidatos.find((c) => rutas.has(c)) ?? null;
}

function hallarHuerfanos(infos: InfoArchivo[]): string[] {
  const rutas = new Set(infos.map((i) => i.ruta));
  const importados = new Set<string>();
  for (const info of infos) {
    for (const spec of info.imports) {
      const r = resolverImport(info, spec, rutas);
      if (r) importados.add(r);
    }
  }
  const textoGlobal = infos.map((i) => i.texto).join("\n");
  return infos
    .filter(
      (i) =>
        !importados.has(i.ruta) &&
        !i.rel.startsWith(`src${join("/", "app")}`) && // entries de Next
        !textoGlobal.includes(basename(i.ruta)), // referenciado por string (worker, etc.)
    )
    .map((i) => i.rel)
    .sort();
}

// ------------------------------------------------------------- riesgos ---
interface RiesgoRes {
  id: string;
  nivel: Riesgo["nivel"];
  total: number;
  top: { rel: string; n: number }[];
}
function escanearRiesgos(infos: InfoArchivo[], extras: InfoArchivo[]): Record<string, RiesgoRes> {
  const res: Record<string, RiesgoRes> = {};
  for (const r of RIESGOS) {
    const porArchivo = new Map<string, number>();
    let total = 0;
    for (const info of [...infos, ...extras]) {
      const n = (info.texto.match(new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : `${r.re.flags}g`)) ?? []).length;
      if (n > 0) {
        total += n;
        porArchivo.set(info.rel, (porArchivo.get(info.rel) ?? 0) + n);
      }
    }
    res[r.id] = {
      id: r.id,
      nivel: r.nivel,
      total,
      top: [...porArchivo.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([rel, n]) => ({ rel, n })),
    };
  }
  return res;
}

// ------------------------------------------------------- anclas + config ---
function verificarAnclas(infos: InfoArchivo[]): { simbolo: string; vivo: boolean; donde: string }[] {
  return ANCHORES_FLUJO.map((simbolo) => {
    const re = new RegExp(`\\b${simbolo}\\b`);
    const hit = infos.find((i) => re.test(i.texto));
    return { simbolo, vivo: !!hit, donde: hit ? hit.rel : "— NO HALLADO —" };
  });
}

async function snapshotConstantes(infos: InfoArchivo[], extras: InfoArchivo[]) {
  const filas: { nombre: string; hallado: boolean; donde: string; linea: string }[] = [];
  for (const nombre of CONSTANTES_TIEMPO) {
    const re = new RegExp(nombre.replace(/\./g, "\\."));
    const hit = [...infos, ...extras].find((i) => re.test(i.texto));
    if (!hit) {
      filas.push({ nombre, hallado: false, donde: "—", linea: "no hallado (ok si ya no aplica)" });
      continue;
    }
    const lineaObj = hit.texto.split("\n").findIndex((l) => re.test(l));
    const linea = (hit.texto.split("\n")[lineaObj] ?? "").trim().slice(0, 110);
    filas.push({ nombre, hallado: true, donde: `${hit.rel}:${lineaObj + 1}`, linea });
  }
  return filas;
}

// ---------------------------------------------------------------- vistas ---
function mapaVistas(infos: InfoArchivo[]): { union: string | null; renderizadas: string[] } {
  const store = infos.find((i) => i.rel.endsWith("lib/e14/store.ts"));
  const union = store?.texto.match(/export type Vista = ([^;]+);/)?.[1]?.trim() ?? null;
  const page = infos.find((i) => i.rel.endsWith("app/page.tsx"));
  const renderizadas = page
    ? [...page.texto.matchAll(/vista === "([a-z]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i)
    : [];
  return { union, renderizadas };
}

// ------------------------------------------------------------ boot check ---
interface BootRes {
  ok: boolean;
  readyEn: string | null;
  nota: string;
  errores: string[];
  ms: number;
}
async function chequearBoot(): Promise<BootRes> {
  const t = performance.now();
  const child = spawn("bunx", ["next", "dev", "--port", String(PORT_BOOT)], {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
  });
  const re = /Ready in|EADDRINUSE|[Ee]rror/;
  const [outTxt, errTxt] = await Promise.all([
    leerHasta(child.stdout, re, TIMEOUT_BOOT_MS),
    leerHasta(child.stderr, re, TIMEOUT_BOOT_MS),
  ]);
  child.kill();
  await new Promise<void>((res) => {
    child.on("close", () => res());
    setTimeout(res, 2000);
  });
  const todo = `${outTxt}\n${errTxt}`;
  const mReady = todo.match(/Ready in ([\d.]+m?s)/i);
  const ocupado = /EADDRINUSE/i.test(todo);
  const errores = todo
    .split("\n")
    .filter((l) => /\berror\b/i.test(l) && !/0 error/i.test(l))
    .map((l) => l.trim().slice(0, 160))
    .slice(0, 8);
  return {
    ok: !!mReady && !ocupado,
    readyEn: mReady ? mReady[1] : null,
    nota: ocupado ? `PUERTO ${PORT_BOOT} OCUPADO — boot NO verificado esta vez` : "",
    errores,
    ms: performance.now() - t,
  };
}

// ---------------------------------------------------------- análisis out/ ---
interface PesoRes {
  existe: boolean;
  totalBytes: number;
  nArchivos: number;
  categorias: { cat: string; bytes: number; n: number }[];
  top: { rel: string; bytes: number }[];
  duplicados: { clave: string; n: number; bytes: number; rels: string[] }[];
}
/** Nombre SIN el hash de bundler: «x.38dh_vup27riw.wasm» y «x.wasm» → misma clave. */
function stemDe(rel: string): string {
  const base = basename(rel);
  const partes = base.split(".");
  if (partes.length < 2) return base;
  const ext = partes.pop() as string;
  let stem = partes.join(".");
  if (partes.length >= 2) {
    const ultimo = partes[partes.length - 1];
    if (/^[a-z0-9_-]{6,}$/i.test(ultimo) && /\d/.test(ultimo) && /[a-z]/i.test(ultimo)) {
      stem = partes.slice(0, -1).join(".");
    }
  }
  return stem ? `${stem}.${ext}` : base;
}
function hallarDuplicados(todos: { rel: string; bytes: number }[]) {
  const grupos = new Map<string, { n: number; bytes: number; rels: string[] }>();
  for (const f of todos) {
    const clave = stemDe(f.rel);
    const g = grupos.get(clave) ?? { n: 0, bytes: 0, rels: [] };
    g.n += 1;
    g.bytes += f.bytes;
    g.rels.push(f.rel);
    grupos.set(clave, g);
  }
  return [...grupos.entries()]
    .filter(([, g]) => g.n >= 2 && g.bytes > 500 * 1024)
    .map(([clave, g]) => ({ clave, ...g }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
}
async function pesarCarpeta(carpeta: string, categorizar: (rel: string) => string): Promise<PesoRes> {
  if (!existsSync(carpeta)) {
    return { existe: false, totalBytes: 0, nArchivos: 0, categorias: [], top: [], duplicados: [] };
  }
  const rutas = await walk(carpeta, null);
  let totalBytes = 0;
  const porCat = new Map<string, { bytes: number; n: number }>();
  const todos: { rel: string; bytes: number }[] = [];
  for (const ruta of rutas) {
    const texto = await readFile(ruta).catch(() => null);
    const bytes = texto ? texto.byteLength : 0;
    totalBytes += bytes;
    const rel = relative(ROOT, ruta);
    const cat = categorizar(rel);
    const c = porCat.get(cat) ?? { bytes: 0, n: 0 };
    c.bytes += bytes;
    c.n += 1;
    porCat.set(cat, c);
    todos.push({ rel, bytes });
  }
  return {
    existe: true,
    totalBytes,
    nArchivos: rutas.length,
    categorias: [...porCat.entries()]
      .map(([cat, v]) => ({ cat, ...v }))
      .sort((a, b) => b.bytes - a.bytes),
    top: todos.sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    duplicados: hallarDuplicados(todos),
  };
}

const catOut = (rel: string): string => {
  if (rel.includes("_next/static/chunks")) return "chunks JS";
  if (rel.includes("_next/static/media")) return "media (fuentes/img)";
  if (rel.includes("_next/static/css")) return "css";
  if (rel.includes("vendor/")) return "vendor (opencv/ort)";
  if (rel.includes("models/")) return "modelos OCR (onnx)";
  if (rel.includes("scanner/")) return "scanner (worker/wasm)";
  if (rel.includes("e14/")) return "e14 (divipol)";
  if (rel.endsWith(".html")) return "html estático";
  return "otros";
};
const catPublic = (rel: string): string => {
  if (rel.includes(".wasm")) return "wasm (OCR)";
  if (rel.includes("scanner/")) return "scanner (worker/modelos)";
  if (/\.(jpg|jpeg|png|webp|svg)$/i.test(rel)) return "imágenes";
  return "otros";
};

// ------------------------------------------------------------------ main ---
interface DataInforme {
  fecha: string;
  entorno: { bun: string; branch: string; commit: string; dirty: number; scripts: string[] };
  salud: { lint: CmdRes & { problems: string }; tsc: CmdRes & { errores: number }; boot: BootRes | null; build: (CmdRes & { ok: boolean }) | null };
  tiempos: { fase: string; ms: number }[];
  pesos: { out: PesoRes; publico: PesoRes };
  flujo: { vistas: { union: string | null; renderizadas: string[] }; anclas: ReturnType<typeof verificarAnclas>; huerfanos: string[]; grupos: { grupo: string; archivos: number; loc: number }[]; topLoc: { rel: string; loc: number }[] };
  riesgos: Record<string, RiesgoRes>;
  constantes: Awaited<ReturnType<typeof snapshotConstantes>>;
  totalMs: number;
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, "package.json")) || !existsSync(SRC)) {
    console.log("✗ CORRE ESTE SCRIPT DESDE LA RAÍZ DEL REPO (no veo package.json ni src/).");
    process.exit(1);
  }
  const tiempos: { fase: string; ms: number }[] = [];
  const fase = async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
    const t = performance.now();
    const r = await fn();
    tiempos.push({ fase: nombre, ms: performance.now() - t });
    console.log(`  ✓ ${nombre} — ${seg(performance.now() - t)}`);
    return r;
  };

  console.log("\n== DIAG-FLUJO v1 — diagnóstico del repo ==");

  // --- entorno ------------------------------------------------------------
  console.log("· ENTORNO…");
  const [gitBranch, gitCommit, gitDirty, bunVer, pkgRaw] = await Promise.all([
    runCmd(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
    runCmd(["git", "rev-parse", "--short", "HEAD"]),
    runCmd(["git", "status", "--porcelain"]),
    runCmd(["bun", "--version"]),
    readFile(join(ROOT, "package.json"), "utf8").catch(() => "{}"),
  ]);
  const pkg = JSON.parse(pkgRaw) as { version?: string; scripts?: Record<string, string> };
  const entorno = {
    bun: bunVer.out.trim() || "desconocida",
    branch: gitBranch.out.trim() || "—",
    commit: gitCommit.out.trim() || "—",
    dirty: gitDirty.out.split("\n").filter((l) => l.trim()).length,
    scripts: Object.keys(pkg.scripts ?? {}),
  };

  // --- colecta de código (flujo) ------------------------------------------
  const infos = await fase("mapa de código (src/)", recopilarSrc);
  const rutasPublicJs = (await walk(PUBLIC, [".js"])).map((ruta) => ({ ruta, rel: relative(ROOT, ruta), texto: "" }));
  const extras: InfoArchivo[] = [];
  for (const p of rutasPublicJs) {
    try {
      const texto = await readFile(p.ruta, "utf8");
      extras.push({ ruta: p.ruta, rel: p.rel, loc: texto.split("\n").length, bytes: Buffer.byteLength(texto), imports: [], texto });
    } catch {
      /* archivo desaparecido entre walk y read — seguir */
    }
  }

  // --- lint + tsc ---------------------------------------------------------
  console.log("· LINT + TSC…");
  const lintRes = await fase("eslint", () => runCmd(["bun", "run", "lint"]));
  const mProblems = lintRes.out.match(/(\d+) problems?[^(\n]*\(([^)]*)\)/);
  const tscRes = await fase("tsc --noEmit", () => runCmd(["bunx", "tsc", "--noEmit"]));
  const erroresTsc = (tscRes.out.match(/error TS\d+/g) ?? []).length;

  // --- boot ---------------------------------------------------------------
  let boot: BootRes | null = null;
  if (DO_BOOT) {
    console.log("· BOOT (dev server efímero)…");
    boot = await fase(`boot dev :${PORT_BOOT}`, chequearBoot);
  }

  // --- build + pesos ------------------------------------------------------
  let build: (CmdRes & { ok: boolean }) | null = null;
  if (DO_BUILD) {
    console.log("· BUILD (export estático)…");
    const b = await fase("next build (BUILD_STATIC=1)", () =>
      runCmd(["bunx", "next", "build"], { BUILD_STATIC: "1", NEXT_PUBLIC_BASE_PATH: "/digielect14" }),
    );
    build = { ...b, ok: b.code === 0 && existsSync(join(ROOT, "out")) };
  }
  const outRes = await fase("pesar out/ + public/", async () => ({
    out: await pesarCarpeta(join(ROOT, "out"), catOut),
    publico: await pesarCarpeta(PUBLIC, catPublic),
  }));

  // --- análisis estático --------------------------------------------------
  const riesgos = escanearRiesgos(infos, extras);
  const anclas = verificarAnclas(infos);
  const huerfanos = hallarHuerfanos(infos);
  const constantes = await snapshotConstantes(infos, extras);
  const vistas = mapaVistas(infos);

  const grupos = new Map<string, { archivos: number; loc: number }>();
  for (const i of infos) {
    const m = i.rel.match(/^src\/(lib|components)\/e14(?:\/([^/]+))?/);
    const grupo = m ? `${m[1]}/e14${m[2] ? `/${m[2]}` : ""}` : i.rel.split("/").slice(0, 2).join("/");
    const g = grupos.get(grupo) ?? { archivos: 0, loc: 0 };
    g.archivos += 1;
    g.loc += i.loc;
    grupos.set(grupo, g);
  }

  const data: DataInforme = {
    fecha: new Date().toLocaleString("es-CO", { dateStyle: "full", timeStyle: "short" }),
    entorno,
    salud: {
      lint: { ...lintRes, problems: mProblems ? `${mProblems[1]} problems (${mProblems[2]})` : (lintRes.code === 0 ? "0 problems" : "ver salida cruda") },
      tsc: { ...tscRes, errores: erroresTsc },
      boot,
      build,
    },
    tiempos,
    pesos: outRes,
    flujo: {
      vistas,
      anclas,
      huerfanos,
      grupos: [...grupos.entries()].map(([grupo, v]) => ({ grupo, ...v })).sort((a, b) => b.loc - a.loc),
      topLoc: infos.map((i) => ({ rel: i.rel, loc: i.loc })).sort((a, b) => b.loc - a.loc).slice(0, 10),
    },
    riesgos,
    constantes,
    totalMs: performance.now() - T0,
  };

  // --- informe ------------------------------------------------------------
  const L: string[] = [];
  const semaforo =
    erroresTsc === 0 && lintRes.code === 0 && (!build || build.ok) && riesgos["debugger"].total === 0
      ? "OK — el repo compila y no hay riesgos críticos"
      : erroresTsc > 0 || (build && !build.ok)
        ? "CRITICO — errores de compilación: arreglar antes de cualquier kit"
        : "ATENCION — compila, pero hay limpieza pendiente (ver riesgos)";
  L.push(`# INFORME-diag — ${data.fecha}`);
  L.push("");
  L.push(`**Veredicto:** ${semaforo}`);
  L.push("");
  L.push(`**Rama:** \`${entorno.branch}\` @ \`${entorno.commit}\` — ${entorno.dirty} archivo(s) sin commit · bun ${entorno.bun}`);
  L.push("");
  L.push("## 1. Salud (errores)");
  L.push("");
  L.push(`- **eslint:** ${data.salud.lint.problems} — exit ${data.salud.lint.code} (${seg(data.salud.lint.ms)})`);
  L.push(`- **tsc:** ${erroresTsc} errores — exit ${tscRes.code} (${seg(tscRes.ms)})`);
  if (boot) {
    L.push(boot.ok
      ? `- **boot dev:** OK — Ready in ${boot.readyEn} (${seg(boot.ms)})`
      : `- **boot dev:** FALLO — ${boot.nota || (boot.errores[0] ?? "sin «Ready» en 30s")}`);
    for (const e of boot.errores) L.push(`  - \`${e}\``);
  }
  if (build) {
    L.push(`- **build estático:** ${build.ok ? "OK" : "FALLO"} (${seg(build.ms)})`);
    if (!build.ok) {
      L.push("");
      L.push("```");
      L.push(...build.out.split("\n").slice(-30));
      L.push("```");
    }
  }
  L.push("");
  L.push("## 2. Tiempos de fases (este diagnóstico)");
  L.push("");
  L.push("| fase | duración |");
  L.push("|---|---|");
  for (const t of tiempos) L.push(`| ${t.fase} | ${seg(t.ms)} |`);
  L.push(`| TOTAL script | ${seg(data.totalMs)} |`);
  L.push("");
  L.push("### Palancas de tiempo (valores VIVOS del código — compara entre informes)");
  L.push("");
  L.push("| constante | dónde | línea |");
  L.push("|---|---|---|");
  for (const c of constantes) L.push(`| ${c.nombre} | \`${c.donde}\` | \`${c.linea}\` |`);
  L.push("");
  L.push("### Payload (lo que baja el navegador)");
  L.push("");
  if (data.pesos.out.existe) {
    L.push(`**out/ (export estático):** ${mb(data.pesos.out.totalBytes)} en ${data.pesos.out.nArchivos} archivos`);
    L.push("");
    L.push("| categoría | peso | archivos |");
    L.push("|---|---|---|");
    for (const c of data.pesos.out.categorias) L.push(`| ${c.cat} | ${mb(c.bytes)} | ${c.n} |`);
    L.push("");
    L.push("**Top 12 archivos en out/:**");
    L.push("");
    for (const f of data.pesos.out.top) L.push(`- \`${f.rel}\` — ${kb(f.bytes)}`);
    if (data.pesos.out.duplicados.length > 0) {
      L.push("");
      L.push("### ⚠ POSIBLES DUPLICADOS en out/ (mismo asset con y sin hash de bundler)");
      L.push("");
      for (const d of data.pesos.out.duplicados) {
        L.push(`- **${d.clave}** ×${d.n} — ${mb(d.bytes)} totales:`);
        for (const r of d.rels) L.push(`  - \`${r}\` — ${kb(d.bytes / d.n)}`);
      }
      L.push("");
      L.push("> Un asset servido por `public/` NO debería viajar también dentro del bundle `_next/static/media` — candidato a optimización de carga (verificar cuál URL consume el runtime antes de borrar)."
      );
    }
  } else {
    L.push("**out/:** no existe (corre sin `--no-build` para medir el payload).");
  }
  L.push("");
  L.push(`**public/ (fuente):** ${mb(data.pesos.publico.totalBytes)} en ${data.pesos.publico.nArchivos} archivos`);
  L.push("");
  for (const c of data.pesos.publico.categorias) L.push(`- ${c.cat}: ${mb(c.bytes)} (${c.n})`);
  L.push("");
  L.push("**Top archivos de public/:**");
  L.push("");
  for (const f of data.pesos.publico.top.slice(0, 8)) L.push(`- \`${f.rel}\` — ${mb(f.bytes)}`);
  L.push("");
  L.push("## 3. Flujo (mapa vivo)");
  L.push("");
  L.push(`- **Vista union:** \`${vistas.union ?? "no hallada"}\``);
  L.push(`- **Vistas renderizadas en page.tsx:** ${vistas.renderizadas.join(" · ")}`);
  L.push("");
  L.push("### Anclas del pipeline (¿siguen vivas?)");
  L.push("");
  for (const a of anclas) L.push(`- ${a.vivo ? "[OK]" : "[ROTA]"} \`${a.simbolo}\` → \`${a.donde}\``);
  L.push("");
  L.push("### LOC por módulo");
  L.push("");
  L.push("| módulo | archivos | LOC |");
  L.push("|---|---|---|");
  for (const g of data.flujo.grupos) L.push(`| ${g.grupo} | ${g.archivos} | ${g.loc} |`);
  L.push("");
  L.push("**Top 10 archivos por LOC:**");
  L.push("");
  for (const f of data.flujo.topLoc) L.push(`- \`${f.rel}\` — ${f.loc} líneas`);
  L.push("");
  L.push("### Candidatos a CÓDIGO MUERTO (nadie los importa — confirmar a mano antes de borrar)");
  L.push("");
  if (huerfanos.length === 0) L.push("- Ninguno detectado.");
  for (const h of huerfanos) L.push(`- \`${h}\``);
  L.push("");
  L.push("## 4. Riesgos / limpieza");
  L.push("");
  L.push("| patrón | total | nivel | top archivos |");
  L.push("|---|---|---|---|");
  for (const r of Object.values(riesgos)) {
    L.push(`| ${r.id} | ${r.total} | ${r.nivel} | ${r.top.map((t) => `\`${t.rel}\`×${t.n}`).join(" · ") || "—"} |`);
  }
  L.push("");
  L.push("> Nota: los `catch {}` defensivos son DISEÑO del repo (auditoría v1) — el número importa como DERIVA, no como error.");
  L.push("");
  L.push("## 5. Acciones sugeridas");
  L.push("");
  const acciones: string[] = [];
  if (erroresTsc > 0) acciones.push(`Arreglar ${erroresTsc} errores de tsc (bloquean todo kit).`);
  if (lintRes.code !== 0) acciones.push("Arreglar eslint (exit != 0).");
  if (boot && !boot.ok && !boot.nota) acciones.push("Investigar el boot: el dev server no llegó a «Ready».");
  if (riesgos["debugger"].total > 0) acciones.push(`Quitar ${riesgos["debugger"].total} debugger.`);
  if (riesgos["console.log"].total > 0) acciones.push(`Quitar ${riesgos["console.log"].total} console.log/debug/info.`);
  if (riesgos["TODO:/FIXME/HACK"].total > 0) acciones.push(`Revisar ${riesgos["TODO:/FIXME/HACK"].total} marcador TODO:/FIXME/HACK.`);
  if (huerfanos.length > 0) acciones.push(`Confirmar y borrar código muerto: ${huerfanos.length} candidato(s).`);
  if (data.pesos.out.existe) {
    const wasm = data.pesos.out.categorias.find((c) => c.cat.includes("wasm"));
    if (wasm && wasm.bytes > 15 * 1024 * 1024) acciones.push(`Payload wasm alto en out/: ${mb(wasm.bytes)} — revisar si quedó un wasm muerto (kit T3 borró 28.3 MB).`);
    const dupBytes = data.pesos.out.duplicados.reduce((s, d) => s + d.bytes, 0);
    if (dupBytes > 0) acciones.push(`POSIBLES DUPLICADOS en out/: ${mb(dupBytes)} — verificar cuál URL consume el runtime (public/vendor vs bundle _next/static/media) y eliminar la copia muerta.`);
  }
  acciones.push("Comparar este informe con el anterior: deriva de constantes, LOC y payload.");
  if (acciones.length === 0) acciones.push("Nada urgente — repo sano.");
  acciones.forEach((a, i) => L.push(`${i + 1}. ${a}`));
  L.push("");
  L.push("## 6. Recordatorios v1 del proyecto");
  L.push("");
  L.push("- T6 (det 1280) sigue PENDIENTE de aprobación + validación con ZIPs de campo.");
  L.push("- Lote real 100+ fotos en TU equipo + RAM plana (DevTools) — pendiente del dueño.");
  L.push("- Los `informes/` son LOCALES: no subir a git salvo decisión contraria (añadir a .gitignore si quieres).");
  L.push("");
  L.push("---");
  L.push(`_diag-flujo v1 — read-only. Comando: \`bun diag-flujo-v1.ts${FLAGS.size ? ` ${[...FLAGS].join(" ")}` : ""}\` · total ${seg(data.totalMs)}_`);

  await mkdir(DIR_INFORMES, { recursive: true });
  const sello = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{2})(\d{2})$/, "$1-$2$3");
  const rutaMd = join(DIR_INFORMES, `INFORME-diag-${sello}.md`);
  await writeFile(rutaMd, L.join("\n"), "utf8");
  await writeFile(join(DIR_INFORMES, `diag-${sello}.json`), JSON.stringify(data, null, 2), "utf8");

  console.log("\n== RESUMEN ==");
  console.log(`· Veredicto: ${semaforo}`);
  console.log(`· lint: ${data.salud.lint.problems} · tsc: ${erroresTsc} errores${build ? ` · build: ${build.ok ? "OK" : "FALLO"}` : ""}${boot ? ` · boot: ${boot.ok ? `OK (${boot.readyEn})` : "FALLO"}` : ""}`);
  console.log(`· Riesgos: debugger ${riesgos["debugger"].total} · console.log ${riesgos["console.log"].total} · TODO: ${riesgos["TODO:/FIXME/HACK"].total} · any ${riesgos[": any / as any"].total} · catch-vacíos ${riesgos["catch vacío {}"].total}/${riesgos["catch (total)"].total}`);
  console.log(`· Código muerto (candidatos): ${huerfanos.length === 0 ? "ninguno" : huerfanos.join(", ")}`);
  if (data.pesos.out.existe) console.log(`· Payload out/: ${mb(data.pesos.out.totalBytes)} · public/: ${mb(data.pesos.publico.totalBytes)}`);
  console.log(`· INFORME: ${rutaMd}`);
  console.log(`· JSON: ${join(DIR_INFORMES, `diag-${sello}.json`)}`);
  console.log(`· Total: ${seg(data.totalMs)}\n`);
}

void main();
