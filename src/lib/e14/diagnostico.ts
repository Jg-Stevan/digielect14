/**
 * KIT e14-diagnostico-autoenvio-v1 (C2) — «POR QUÉ NO SE ENVIÓ».
 * Módulo PURO (sin React): causaPrincipal determinista §4 · paquete ZIP §3 ·
 * acumulador localStorage §5 · reporte de comportamiento §5.
 *
 * Reglas duras del kit:
 *  - OBSERVACIÓN PASIVA: nada aquí altera el desenlace del acta — TODO
 *    try/catch y la descarga es un efecto secundario puro (§9.7/§9.9).
 *  - Las fotos van BYTE A BYTE del dataURL al ZIP, sin re-encode (§9.3).
 *  - ZIP STORE (level 0) — los JPEG ya vienen comprimidos (§3/C6).
 *  - localStorage puede lanzar (privado/Safari) → fallback a memoria
 *    (§9.4: el reporte de la sesión sobrevive, el persistente no — honesto).
 *  - Cap 500 entradas, evict FIFO (§9.8).
 *  - El toast del kit C3 no existe como sistema en este app (el store solo
 *    lo menciona en comentarios heredados del lab): el feedback es la traza
 *    `[e14] diag=…` en consola + el botón «DIAGNÓSTICO ↓» de REVISIÓN (C4,
 *    red de seguridad OBLIGATORIA §9.1). Adaptación documentada en REPORTE.
 */
import { zipSync, strToU8, type Zippable } from "fflate";
import type { Acta, ActaStatus, DiagnosticoActa } from "./types";

const STORAGE_KEY = "e14-diag-v1";
const CAP_ENTRADAS = 500;

// ---------- §4 — causaPrincipal (el POR QUÉ en UNA línea) ----------

/** Reglas deterministas EN ORDEN (§4). Los tokens de techos van con su
 *  valor (`recortada:7.9`) → el matching es por prefijo. `lectura-DEBIL`
 *  y `piso-lectura-FUERTE` no existen en main hasta mergear score-lectura
 *  (§8) — las reglas quedan listas y son inertes mientras tanto. */
export function causaPrincipal(d: DiagnosticoActa): string {
  const rechazoTipo = d.rechazo?.tipo ?? null;
  if (rechazoTipo === "SIN_VOTOS") return "zona de votos sin tinta";
  if (rechazoTipo === "INCOMPLETA") return "tinta impresa cortada al filo del recorte";
  if (rechazoTipo === "BAJO") return "sin señal del acta (no se leyó cabecera/mesa/tipo)";
  const techos = d.score.techos;
  const conTecho = (prefijo: string) => techos.some((t) => t.startsWith(prefijo));
  if (d.status === "RECHAZADA") {
    if (d.level === "poor") return "foto físicamente deficiente (blur/exposición)";
    if (d.lectura.nivel === "DEBIL") return `casi nada leído (anclas=${d.lectura.anclas})`;
    return "métricas visuales bajas (nitidez/brillo/contraste)";
  }
  if (d.status === "ADVERTENCIA") {
    if (conTecho("recortada"))
      return `acta recortada (lazo=${d.gate.ladoEsquina ?? "secciones"})`;
    if (conTecho("escudo-fondo")) return "fondo/sombra incluido en el recorte";
    if (conTecho("techo-fair")) return "nitidez/exposición ACEPTABLE pero no alta";
    if (conTecho("lectura-DEBIL")) return "lectura débil frena el piso";
    return "score visual <8 sin techo específico";
  }
  return "ver diagnostico.json";
}

// ---------- C1 helper — montaje del registro (lo llama el bridge) ----------

/** Empaca lo que el sitio del log ya tiene en scope (§6-B: las MISMAS
 *  expresiones que ya usa el log — NO re-evalúa nada nuevo). Los techos
 *  llegan YA construidos por el sitio (orden de aplicación real). */
export function construirDiagnostico(p: {
  actaId: string;
  intento: number;
  maxIntentos: number;
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  scoreVisual: number;
  scoreFinal: number;
  techos: string[];
  metricas: {
    sharpness: number;
    brightness: number;
    contrast: number;
    contrasteEfectivo: number;
  };
  level: string;
  lecturaChars: number;
  senalActa: boolean;
  ocrValido: boolean;
  gate: DiagnosticoActa["gate"];
  captura: DiagnosticoActa["captura"];
  tiempos: DiagnosticoActa["tiempos"];
}): DiagnosticoActa {
  return {
    ts: new Date().toISOString(),
    actaId: p.actaId,
    intento: p.intento,
    maxIntentos: p.maxIntentos,
    status: p.status,
    rechazo: p.rechazo,
    score: { visual: p.scoreVisual, final: p.scoreFinal, techos: p.techos },
    metricas: {
      sharpness: p.metricas.sharpness,
      // v2 score-lectura (PR #13) — null hasta que main la herede (§8).
      sharpnessHi: null,
      brightness: p.metricas.brightness,
      contrast: p.metricas.contrast,
      contrastPapel: null,
      contrasteEfectivo: p.metricas.contrasteEfectivo,
    },
    level: p.level,
    lectura: { nivel: "—", anclas: 0, chars: p.lecturaChars },
    senalActa: p.senalActa,
    ocrValido: p.ocrValido,
    gate: p.gate,
    captura: p.captura,
    tiempos: p.tiempos,
  };
}

// ---------- §5 — acumulador (localStorage + fallback memoria) ----------

interface EntradaDesenlace {
  ts: string;
  status: ActaStatus;
  autoEnviada: boolean;
  score: number;
  lectura: string;
  techos: string[];
  causaPrincipal: string;
  tiempos: DiagnosticoActa["tiempos"];
  /** §5 «por intento» — el desenlace siempre lo conoce (§3-A). */
  intento: number;
}

/** Fallback a memoria (§9.4): modo privado/Safari — la sesión sobrevive. */
const memoria: EntradaDesenlace[] = [];
let localStorageDisponible: boolean | null = null;

function cargarEntradas(): EntradaDesenlace[] {
  if (localStorageDisponible === null) {
    try {
      window.localStorage.setItem(`${STORAGE_KEY}-probe`, "1");
      window.localStorage.removeItem(`${STORAGE_KEY}-probe`);
      localStorageDisponible = true;
    } catch {
      localStorageDisponible = false;
    }
  }
  if (!localStorageDisponible) return memoria;
  try {
    const crudo = window.localStorage.getItem(STORAGE_KEY);
    if (!crudo) return memoria.length > 0 ? memoria : [];
    const parsed = JSON.parse(crudo) as EntradaDesenlace[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return memoria;
  }
}

function guardarEntradas(entradas: EntradaDesenlace[]): void {
  if (!localStorageDisponible) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entradas));
  } catch {
    // Cuota llena / privado → la memoria conserva la sesión (§9.4).
  }
}

/** Acumula el DESENLACE (§5). Guard §9.2: SIM nunca (el acta simulada no
 *  trae diagnostico adjunto — doble guard con el bridge). El desenlace
 *  OPTIMA TAMBIÉN entra (denominador de la tasa, §7.3) pero NUNCA genera
 *  ZIP — el trigger del paquete es solo no-OPTIMA (§1, lo decide el store). */
export function registrarDesenlace(acta: Acta): void {
  try {
    if (!acta.diagnostico) return;
    const d = acta.diagnostico;
    const entrada: EntradaDesenlace = {
      ts: d.ts,
      status: d.status,
      autoEnviada: d.status === "OPTIMA",
      score: d.score.final,
      lectura: d.lectura.nivel,
      techos: d.score.techos,
      causaPrincipal: d.status === "OPTIMA" ? "—" : causaPrincipal(d),
      tiempos: d.tiempos,
      intento: d.intento,
    };
    const entradas = cargarEntradas();
    entradas.push(entrada);
    while (entradas.length > CAP_ENTRADAS) entradas.shift(); // evict FIFO §9.8
    if (localStorageDisponible) guardarEntradas(entradas);
    else memoria.push(entrada);
  } catch {
    // El acumulador jamás rompe el desenlace (§9.7).
  }
}

// ---------- §3 — el paquete ZIP ----------

/** dataURL → bytes SIN re-encode (§9.3, mismo patrón de hashing del
 *  integridad con atob). */
function dataUrlABytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** «mesa|titulo-sanitizado» (§9.5): sin espacios/tildes/`:` — corto. */
function sanitizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function hhmmss(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

/** render legible del desglose completo (§3: causa principal arriba). */
function renderDiagnosticoTxt(d: DiagnosticoActa): string {
  const L: string[] = [];
  L.push("DIAGNÓSTICO DE AUTO-ENVÍO — POR QUÉ NO SE ENVIÓ");
  L.push("=================================================");
  L.push(`Causa principal: ${causaPrincipal(d)}`);
  L.push(`Generado: ${d.ts}`);
  L.push("");
  L.push("DESENLACE");
  L.push(`- status: ${d.status} · score: ${d.score.final}/10 (visual ${d.score.visual})`);
  L.push(`- techos: ${d.score.techos.length > 0 ? d.score.techos.join(", ") : "ninguno"}`);
  L.push(
    `- rechazo: ${d.rechazo ? `${d.rechazo.tipo} — ${d.rechazo.detalle}` : "—"}`,
  );
  L.push(`- intento: ${d.intento} de ${d.maxIntentos}`);
  L.push("");
  L.push("LECTURA Y SEÑAL");
  L.push(
    `- lectura: ${d.lectura.nivel} (anclas ${d.lectura.anclas}, ${d.lectura.chars} chars)`,
  );
  L.push(`- senalActa: ${d.senalActa} · ocrValido: ${d.ocrValido} · procesadaVacia: ${d.gate.procesadaVacia}`);
  L.push("");
  L.push("GATE");
  L.push(
    `- completa: ${d.gate.completa} · fondo: ${d.gate.fondo} · recortada: ${d.gate.recortada}${d.gate.ladoEsquina ? ` (${d.gate.ladoEsquina})` : ""}`,
  );
  L.push(
    `- votos: ${d.gate.votos.densidadPct != null ? `${d.gate.votos.densidadPct.toFixed(1)}%` : "?"} · skipPag2: ${d.gate.votos.skipPag2} · ok: ${d.gate.votos.ok}`,
  );
  L.push(`- clasif: ${d.gate.clasifNivel}`);
  L.push("");
  L.push("CAPTURA");
  L.push(
    `- motor: ${d.captura.motor} · filtro: ${d.captura.filtro} · crop: ${d.captura.crop.fallback ? "full" : `${d.captura.crop.w}x${d.captura.crop.h}`}`,
  );
  L.push(
    `- quad: [${d.captura.quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}]`,
  );
  L.push("");
  L.push("MÉTRICAS");
  L.push(
    `- sharpness ${d.metricas.sharpness} · sharpnessHi ${d.metricas.sharpnessHi ?? "—"} · brightness ${d.metricas.brightness}`,
  );
  L.push(
    `- contrast ${d.metricas.contrast} · contrastPapel ${d.metricas.contrastPapel ?? "—"} · contEfectivo ${d.metricas.contrasteEfectivo}`,
  );
  L.push(`- level: ${d.level}`);
  L.push("");
  L.push("TIEMPOS (ms)");
  L.push(
    `- proceso ${d.tiempos.procesoMs} · calidad ${d.tiempos.calidadMs} · ocr ${d.tiempos.ocrMs} · total ${d.tiempos.totalMs}`,
  );
  L.push("");
  L.push("COMPORTAMIENTO DEL PUESTO (al momento)");
  L.push(reporteComportamiento().txt);
  return L.join("\n");
}

function descargarBytes(nombre: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Arma y dispara la descarga del ZIP §3 (trigger no-OPTIMA — lo decide el
 *  store). Devuelve {ok, bytes, ms} — el feedback lo pone el llamador
 *  (adaptación «toast» documentada). TODO try/catch (§9.7). */
export function descargarPaqueteDiagnostico(acta: Acta): {
  ok: boolean;
  bytes: number;
  ms: number;
} {
  const t0 = performance.now();
  try {
    const d = acta.diagnostico;
    if (!d) return { ok: false, bytes: 0, ms: 0 };
    const contenido: Zippable = {
      "diagnostico.json": strToU8(JSON.stringify(d, null, 2)),
      "diagnostico.txt": strToU8(renderDiagnosticoTxt(d)),
      "ocr.txt": strToU8(acta.ocrTexto || "(sin texto OCR)"),
      "comportamiento.txt": strToU8(reporteComportamiento().txt),
    };
    // Las fotos BYTE A BYTE del dataURL (§9.3) — solo si existen.
    if (acta.fotoOriginal) contenido["original.jpg"] = dataUrlABytes(acta.fotoOriginal);
    if (acta.fotoProcesada) contenido["final.jpg"] = dataUrlABytes(acta.fotoProcesada);
    const zip = zipSync(contenido, { level: 0 }); // STORE — sin recomprimir
    const identificador = acta.ubicacion?.mesa
      ? `mesa-${sanitizar(acta.ubicacion.mesa)}`
      : sanitizar(acta.titulo);
    const nombre = `e14-diag-${identificador}-${hhmmss(new Date())}-i${acta.intento}.zip`;
    descargarBytes(nombre, zip);
    const ms = Math.round(performance.now() - t0);
    console.info(
      `[e14] diag=${ms}ms bytes=${zip.length} zip=${nombre} causa="${causaPrincipal(d)}"`,
    );
    return { ok: true, bytes: zip.length, ms };
  } catch (e) {
    console.info(`[e14] diag ERROR ${String(e)}`);
    return { ok: false, bytes: 0, ms: Math.round(performance.now() - t0) };
  }
}

// ---------- §5 — reporte de comportamiento ----------

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return Math.round(ordenados[idx]);
}

export interface ReporteComportamiento {
  total: number;
  autoEnviadas: number;
  tasaPct: number;
  causasTop: Array<{ causa: string; n: number; pct: number }>;
  statusDist: Record<string, number>;
  tiempos: {
    proceso: { p50: number; p95: number };
    calidad: { p50: number; p95: number };
    ocr: { p50: number; p95: number };
    total: { p50: number; p95: number };
  };
  lecturaCruce: Record<string, { total: number; autoPct: number }>;
  porIntento: Record<string, { total: number; autoPct: number }>;
  json: string;
  txt: string;
}

export function reporteComportamiento(): ReporteComportamiento {
  const entradas = cargarEntradas();
  const total = entradas.length;
  const autoEnviadas = entradas.filter((e) => e.autoEnviada).length;
  const tasaPct = total === 0 ? 0 : Math.round((autoEnviadas / total) * 100);

  // histograma de causas (solo no-auto) ordenado desc
  const causas = new Map<string, number>();
  for (const e of entradas) {
    if (e.autoEnviada) continue;
    causas.set(e.causaPrincipal, (causas.get(e.causaPrincipal) ?? 0) + 1);
  }
  const causasTop = [...causas.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([causa, n]) => ({
      causa,
      n,
      pct: total === 0 ? 0 : Math.round((n / total) * 100),
    }));

  const statusDist: Record<string, number> = {};
  for (const e of entradas) statusDist[e.status] = (statusDist[e.status] ?? 0) + 1;

  const tiempos = {
    proceso: {
      p50: percentil(entradas.map((e) => e.tiempos.procesoMs), 50),
      p95: percentil(entradas.map((e) => e.tiempos.procesoMs), 95),
    },
    calidad: {
      p50: percentil(entradas.map((e) => e.tiempos.calidadMs), 50),
      p95: percentil(entradas.map((e) => e.tiempos.calidadMs), 95),
    },
    ocr: {
      p50: percentil(entradas.map((e) => e.tiempos.ocrMs), 50),
      p95: percentil(entradas.map((e) => e.tiempos.ocrMs), 95),
    },
    total: {
      p50: percentil(entradas.map((e) => e.tiempos.totalMs), 50),
      p95: percentil(entradas.map((e) => e.tiempos.totalMs), 95),
    },
  };

  // cruce lectura × auto-envío (§5: esperado FUERTE→100 / MEDIA→medio / DEBIL→0)
  const lecturaCruce: Record<string, { total: number; autoPct: number }> = {};
  for (const e of entradas) {
    const k = lecturaCruce[e.lectura] ?? { total: 0, autoPct: 0 };
    k.total += 1;
    if (e.autoEnviada) k.autoPct += 1;
    lecturaCruce[e.lectura] = k;
  }
  for (const k of Object.values(lecturaCruce)) {
    k.autoPct = k.total === 0 ? 0 : Math.round((k.autoPct / k.total) * 100);
  }

  // por intento (§5: i1..i4 → % auto)
  const porIntento: Record<string, { total: number; autoPct: number }> = {};
  for (const e of entradas) {
    const i = `i${e.intento}`;
    const k = porIntento[i] ?? { total: 0, autoPct: 0 };
    k.total += 1;
    if (e.autoEnviada) k.autoPct += 1;
    porIntento[i] = k;
  }
  for (const k of Object.values(porIntento)) {
    k.autoPct = k.total === 0 ? 0 : Math.round((k.autoPct / k.total) * 100);
  }

  const json = JSON.stringify(
    {
      generado: new Date().toISOString(),
      fuente: STORAGE_KEY,
      cap: CAP_ENTRADAS,
      total,
      autoEnviadas,
      tasaPct,
      causasTop,
      statusDist,
      tiempos,
      lecturaCruce,
      porIntento,
      entradas,
    },
    null,
    2,
  );

  const L: string[] = [];
  L.push("REPORTE DE COMPORTAMIENTO — AUTO-ENVÍO E-14");
  L.push("===========================================");
  L.push(`Generado: ${new Date().toISOString()}`);
  L.push(`Desenlaces registrados: ${total} (cap ${CAP_ENTRADAS})`);
  L.push(`TASA DE AUTO-ENVÍO: ${tasaPct}% (auto ${autoEnviadas} de ${total})`);
  L.push("");
  L.push("CAUSAS TOP (no-auto):");
  if (causasTop.length === 0) L.push("  (sin desenlaces no-auto registrados)");
  causasTop.forEach((c, i) => {
    L.push(`  ${i + 1}. ${c.causa} — ${c.n} (${c.pct}%)`);
  });
  L.push("");
  L.push("DISTRIBUCIÓN DE STATUS:");
  const clavesStatus = Object.keys(statusDist);
  if (clavesStatus.length === 0) L.push("  (sin entradas)");
  for (const k of clavesStatus) L.push(`  ${k}: ${statusDist[k]}`);
  L.push("");
  L.push("TIEMPOS (ms):");
  L.push(
    `  proceso ${tiempos.proceso.p50}/${tiempos.proceso.p95} · calidad ${tiempos.calidad.p50}/${tiempos.calidad.p95} · ocr ${tiempos.ocr.p50}/${tiempos.ocr.p95} · total ${tiempos.total.p50}/${tiempos.total.p95} (p50/p95)`,
  );
  L.push("");
  L.push("LECTURA × AUTO-ENVÍO:");
  for (const [k, v] of Object.entries(lecturaCruce)) {
    L.push(`  ${k}: ${v.autoPct}% auto (${v.total})`);
  }
  L.push("");
  L.push("POR INTENTO:");
  for (const [k, v] of Object.entries(porIntento)) {
    L.push(`  ${k}: ${v.autoPct}% auto (${v.total})`);
  }
  const txt = L.join("\n");

  return {
    total,
    autoEnviadas,
    tasaPct,
    causasTop,
    statusDist,
    tiempos,
    lecturaCruce,
    porIntento,
    json,
    txt,
  };
}

/** C5 — EXPORTAR REPORTE: ZIP con JSON+TXT del comportamiento (§2-C5). */
export function exportarReporteComportamientoZip(): {
  ok: boolean;
  bytes: number;
  ms: number;
} {
  const t0 = performance.now();
  try {
    const rep = reporteComportamiento();
    const zip = zipSync(
      {
        "comportamiento.json": strToU8(rep.json),
        "comportamiento.txt": strToU8(rep.txt),
      },
      { level: 0 },
    );
    const nombre = `e14-comportamiento-${hhmmss(new Date())}.zip`;
    descargarBytes(nombre, zip);
    const ms = Math.round(performance.now() - t0);
    console.info(`[e14] diag reporte=${ms}ms bytes=${zip.length} zip=${nombre}`);
    return { ok: true, bytes: zip.length, ms };
  } catch (e) {
    console.info(`[e14] diag reporte ERROR ${String(e)}`);
    return { ok: false, bytes: 0, ms: Math.round(performance.now() - t0) };
  }
}
