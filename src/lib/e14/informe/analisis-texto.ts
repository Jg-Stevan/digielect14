/**
 * analisis-texto.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.2)
 *
 * Métricas de texto del comparativo: normalización idéntica al laboratorio,
 * Levenshtein/similitud, 10 anclas estructurales genéricas, campos numéricos
 * por celda, GT embebida (Apéndice B — Frankfurt P2 "F" / El Cairo P1 "EG")
 * y CER contra GT solo para "F" (24 líneas impresas).
 */
import { evento } from "./telemetria";

// ─── Normalización (idéntica al laboratorio) ────────────────────────────────

/** uppercase → NFD sin diacríticos → [^A-Z0-9]+ → " " → trim. */
export function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Distancia de Levenshtein clásica (dos filas). */
export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** Similitud 1 − lev/max(len) (0..1). */
export function sim(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - lev(a, b) / max;
}

// ─── Anclas estructurales (10, genéricas — sirven para CUALQUIER acta) ──────

export const ANCLAS_ESTRUCTURALES: [string, (t: string) => boolean][] = [
  ["cabecera E-14", (t) => /E\s*-\s*14/i.test(t)],
  ["REGISTRADURÍA", (t) => /REGISTRADUR[IÍ]A/i.test(t)],
  ["TRANSMISIÓN", (t) => /TRANSMISI/i.test(t)],
  ["CONSULADO n", (t) => /CONSULADO[::\s.]*\d|CONSULADOS/i.test(t)],
  ["PAÍS n-NOMBRE", (t) => /PA[IÍ]S[::\s.]*\d/i.test(t)],
  ["ZONA n", (t) => /ZONA[::\s.]*\d+/i.test(t)],
  ["PUESTO n", (t) => /PUESTO[::\s.]*\d+/i.test(t)],
  ["MESA nnn", (t) => /MESA[::\s.]*\d+/i.test(t)],
  ["Ver Pag n de n", (t) => /Ver\.?\s*:?\s*\d+\s*Pag\.?\s*:?\s*\d+\s*de\s*\d+/i.test(t)],
  ["código 1D 15d", (t) => /\b\d{15}\b/.test(t)],
];

// ─── Apéndice B — GT embebida ───────────────────────────────────────────────

export const CODIGOS_GT = { F: "710007453010202", EG: "710003993010102" } as const;

export type GtKey = keyof typeof CODIGOS_GT | null;

export const GT_F_LINES: string[] = [
  // Frankfurt P2 — SOLO texto impreso (24 líneas)
  "710007453010202",
  "VER. 01 PAG. 2 DE 2",
  "ACTA DE ESCRUTINIO DE LOS",
  "JURADOS DE VOTACION",
  "E-14",
  "TRANSMISION",
  "ELECCION PRESIDENCIA Y",
  "VICEPRESIDENCIA DE LA REPUBLICA",
  "JUNIO 21 DE 2026",
  "REGISTRADURIA",
  "CONSULADO: 88 - CONSULADOS",
  "PAIS: 120 - ALEMANIA",
  "ZONA: 15 PUESTO: 02 MESA: 012",
  "LUGAR: Frankfurt Consulado",
  "X 2-11-83-18 X",
  "CONSTANCIAS DE LOS JURADOS DE VOTACION",
  "HUBO RECUENTO DE VOTOS? SI NO",
  "SOLICITADO POR:",
  "EN REPRESENTACION DE:",
  "FIRMA JURADO 1",
  "FIRMA JURADO 2",
  "FIRMA JURADO 3",
  "FIRMA JURADO 4",
  "KIT 745",
];

// Anclas EXACTAS (14) — mismas del marcador unificado del laboratorio:
export const GT_ANCLAS: Record<"F" | "EG", [string, RegExp][]> = {
  F: [
    ["cabecera E-14", /E\s*-\s*14/i],
    ["REGISTRADURÍA", /REGISTRADUR[IÍ]A/i],
    ["TRANSMISIÓN", /TRANSMISI/i],
    ["CONSULADO 88", /CONSULADO.*88|88.*CONSULAD/i],
    ["PAÍS 120 ALEMANIA", /ALEMANIA/i],
    ["ZONA 15 (exacto)", /ZONA[::\s.]*15(?!\d)/i],
    ["PUESTO 02", /PUESTO[::\s.]*0?2(?!\d)/i],
    ["MESA 012", /MESA[::\s.]*012(?!\d)/i],
    ["KIT 745", /KIT[::\s.]*745/i],
    ["Ver Pag 2 de 2", /Ver\.?\s*:?\s*0?1\s*Pag\.?\s*:?\s*0?2\s*de\s*0?2/i],
    ["código 1D completo", /710007453010202/],
    ["LUGAR Frankfurt", /Frankfurt/i],
    ["CONSTANCIAS", /CONSTANCIAS/i],
    ["FIRMA", /FIRMA/i],
  ],
  EG: [
    ["cabecera E-14", /E\s*-\s*14/i],
    ["REGISTRADURÍA", /REGISTRADUR[IÍ]A/i],
    ["TRANSMISIÓN", /TRANSMISI/i],
    ["CONSULADO 88", /CONSULADO.*88|88.*CONSULAD/i],
    ["PAÍS 335 EGIPTO", /EGIPTO/i],
    ["ZONA 05 (exacto)", /ZONA[::\s.]*0?5(?!\d)/i],
    ["PUESTO 02", /PUESTO[::\s.]*0?2(?!\d)/i],
    ["MESA 001", /MESA[::\s.]*001(?!\d)/i],
    ["KIT 399", /KIT[::\s.]*399/i],
    ["Ver Pag 1 de 2", /Ver\.?\s*:?\s*0?1\s*Pag\.?\s*:?\s*0?1\s*de\s*0?2/i],
    ["código 1D completo", /710003993010102/],
    ["LUGAR El Cairo", /CAIRO/i],
    ["SUMA TOTAL (P1)", /SUMA\s*TOTAL/i],
    ["NIVELACIÓN MESA", /NIVELACI[OÓ]N/i],
  ],
};

// ─── Campos numéricos (regex tolerantes, misma familia del clasificador) ────

export interface CamposNum {
  zona: number | null;
  puesto: number | null;
  mesa: number | null;
  kit: number | null;
  codigo1D: string | null;
  pagina: { ver: number; pag: number; de: number } | null;
}

function trasNexo(texto: string, nexo: RegExp): number | null {
  const m = nexo.exec(texto);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function camposNum(texto: string): CamposNum {
  let pagina: CamposNum["pagina"] = null;
  const mPag = /Ver\.?\s*:?\s*(\d+)\s*Pag\.?\s*:?\s*(\d+)\s*de\s*(\d+)/i.exec(texto);
  if (mPag) {
    pagina = { ver: parseInt(mPag[1], 10), pag: parseInt(mPag[2], 10), de: parseInt(mPag[3], 10) };
  }
  const m1D = /\b(\d{15})\b/.exec(texto);
  return {
    zona: trasNexo(texto, /ZONA[::\s.]*0?(\d+)/i),
    puesto: trasNexo(texto, /PUESTO[::\s.]*0?(\d+)/i),
    mesa: trasNexo(texto, /MESA[::\s.]*0?(\d+)/i),
    kit: trasNexo(texto, /KIT[::\s.]*0?(\d+)/i),
    codigo1D: m1D ? m1D[1] : null,
    pagina,
  };
}

// ─── GT del acta (match por código 1D en el texto) ──────────────────────────

/** Resuelve la GT del acta por su código 1D (null si no hay match). */
export function gtDeTexto(texto: string): "F" | "EG" | null {
  if (texto.includes(CODIGOS_GT.F)) return "F";
  if (texto.includes(CODIGOS_GT.EG)) return "EG";
  return null;
}

// ─── Evaluación de celda ────────────────────────────────────────────────────

export interface ResultadoAnclas {
  hits: number;
  total: number;
  miss: string[];
}

export interface ResultadoCampos {
  zona: number | null;
  puesto: number | null;
  mesa: number | null;
  kit: number | null;
  codigo1D: string | null;
  pagina: number | null;
  ok: number;
}

export interface EvalCelda {
  anclas: ResultadoAnclas;
  campos: ResultadoCampos;
  gt: { hits: number; total: number } | null;
  cer: number | null;
  lineasGt: { rec: number; total: number; falladas: string[] } | null;
}

/** Anclas estructurales (10) — siempre comparables entre celdas. */
export function anclasEstructuralesDe(texto: string): ResultadoAnclas {
  const miss: string[] = [];
  let hits = 0;
  for (const [nombre, test] of ANCLAS_ESTRUCTURALES) {
    if (test(texto)) hits++;
    else miss.push(nombre);
  }
  return { hits, total: ANCLAS_ESTRUCTURALES.length, miss };
}

/**
 * Evalúa una celda OCR del comparativo:
 *  · anclas: 10 estructurales (siempre).
 *  · campos: 6 numéricos extraídos + cuántos hay (ok).
 *  · gt: las 14 EXACTAS del Apéndice B — SOLO cuando `gtKey` (match de
 *    código 1D del texto). null si no aplica.
 *  · cer: lev(norm(GT.join("\n")), norm(texto)) / len(norm(GT)) — SOLO "F".
 *  · lineasGt: líneas GT recuperadas con tolerancia sim ≥ 0.8 — SOLO "F".
 */
export function evaluarCelda(texto: string, gtKey: GtKey): EvalCelda {
  const anclas = anclasEstructuralesDe(texto);
  const campos = camposNum(texto);
  const ok = Object.values(campos).filter((v) => v !== null).length;

  let gt: EvalCelda["gt"] = null;
  let cer: number | null = null;
  let lineasGt: EvalCelda["lineasGt"] = null;

  if (gtKey) {
    const anclasGt = GT_ANCLAS[gtKey];
    const hitsGt = anclasGt.filter(([, re]) => re.test(texto)).length;
    gt = { hits: hitsGt, total: anclasGt.length };
  }
  if (gtKey === "F") {
    const normGt = norm(GT_F_LINES.join("\n"));
    cer = lev(normGt, norm(texto)) / Math.max(1, normGt.length);
    const textoNorm = norm(texto);
    const tokens = textoNorm.split(" ").filter(Boolean);
    // n-grams de 1..4 tokens consecutivos del texto (una línea GT suele
    // salir como 1-4 tokens seguidos, con errores OCR leves).
    const ngrams: string[] = [];
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i + n <= tokens.length; i++) ngrams.push(tokens.slice(i, i + n).join(" "));
    }
    const falladas: string[] = [];
    let rec = 0;
    for (const linea of GT_F_LINES) {
      const nl = norm(linea);
      if (!nl) continue;
      let hallada = textoNorm.includes(nl);
      if (!hallada && nl.length >= 8) {
        for (const seg of ngrams) {
          if (Math.abs(seg.length - nl.length) > Math.max(4, nl.length * 0.4)) continue;
          if (sim(nl, seg) >= 0.8) {
            hallada = true;
            break;
          }
        }
      }
      if (hallada) rec++;
      else falladas.push(linea);
    }
    lineasGt = { rec, total: GT_F_LINES.length, falladas };
  }

  const camposResultado: ResultadoCampos = {
    zona: campos.zona,
    puesto: campos.puesto,
    mesa: campos.mesa,
    kit: campos.kit,
    codigo1D: campos.codigo1D,
    pagina: campos.pagina ? campos.pagina.pag : null,
    ok,
  };

  return { anclas, campos: camposResultado, gt, cer, lineasGt };
}

/** Marca un evento de análisis (bitácora). */
export function eventoAnalisis(detalle: string): void {
  evento("texto/analisis", detalle);
}
