/**
 * referencia-lab.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.6)
 *
 * Referencia de laboratorio (Apéndice A del SPEC) — datos YA medidos por el
 * dueño off-line (CPU del servidor de pruebas, Bun/Python, fotos reales).
 * Copiado VERBATIM: son la línea base con la que se contrasta la medición
 * EN el dispositivo (RapidOCR 49/56 vs Tesseract tuned 39/56 vs hoy 27/56
 * agregando las 4 fotos × 14 anclas).
 */

export const LAB_NOTA =
  "Off-line, CPU del servidor de pruebas (Bun/Python), fotos reales del dueño. El bloque EN DISPOSITIVO (§6 del informe) mide ESTA captura en ESTE teléfono; este bloque es el ranking definitivo entre motores.";

export interface LabVerdict2Row {
  motor: string;
  foto: string;
  hits: number;
  total: number;
  miss: string;
  ms: number | null;
}

export const LAB_VERDICT2: LabVerdict2Row[] = [
  { motor: "RapidOCR PP-OCRv4", foto: "Frankfurt-P2 foto campo (1)", hits: 13, total: 14, miss: "Ver Pag 2 de 2", ms: 2730 },
  { motor: "RapidOCR PP-OCRv4", foto: "Frankfurt-P2 limpia (scanner)", hits: 13, total: 14, miss: "TRANSMISIÓN", ms: 2810 },
  { motor: "RapidOCR PP-OCRv4", foto: "Frankfurt-P2 foto campo (2)", hits: 10, total: 14, miss: "cabecera E-14, REGISTRADURÍA, Ver Pag 2 de 2, FIRMA", ms: 2360 },
  { motor: "RapidOCR PP-OCRv4", foto: "El-Cairo-P1 (votos a mano)", hits: 13, total: 14, miss: "REGISTRADURÍA", ms: 2590 },
  { motor: "Tesseract hoy", foto: "Frankfurt-P2 foto campo (1)", hits: 7, total: 14, miss: "cabecera E-14, REGISTRADURÍA, KIT 745, Ver Pag 2 de 2, código 1D completo, CONSTANCIAS, FIRMA", ms: 3155 },
  { motor: "Tesseract tuned", foto: "Frankfurt-P2 foto campo (1)", hits: 10, total: 14, miss: "cabecera E-14, KIT 745, Ver Pag 2 de 2, código 1D completo", ms: 2912 },
  { motor: "Tesseract hoy", foto: "Frankfurt-P2 foto campo (2)", hits: 6, total: 14, miss: "cabecera E-14, REGISTRADURÍA, TRANSMISIÓN, KIT 745, Ver Pag 2 de 2, código 1D completo, LUGAR Frankfurt, CONSTANCIAS", ms: 1700 },
  { motor: "Tesseract tuned", foto: "Frankfurt-P2 foto campo (2)", hits: 8, total: 14, miss: "cabecera E-14, REGISTRADURÍA, TRANSMISIÓN, KIT 745, Ver Pag 2 de 2, código 1D completo", ms: 1752 },
  { motor: "Tesseract hoy", foto: "El-Cairo-P1 (votos a mano)", hits: 8, total: 14, miss: "cabecera E-14, REGISTRADURÍA, MESA 001, Ver Pag 1 de 2, código 1D completo, LUGAR El Cairo", ms: 2477 },
  { motor: "Tesseract tuned", foto: "El-Cairo-P1 (votos a mano)", hits: 10, total: 14, miss: "cabecera E-14, REGISTRADURÍA, TRANSMISIÓN, Ver Pag 1 de 2", ms: 2446 },
  { motor: "Tesseract hoy (bw+1600)", foto: "Frankfurt-P2 limpia (scanner)", hits: 6, total: 14, miss: "cabecera E-14, REGISTRADURÍA, TRANSMISIÓN, ZONA 15 (exacto), KIT 745, Ver Pag 2 de 2, CONSTANCIAS, FIRMA", ms: null },
  { motor: "Tesseract tuned (text+full)", foto: "Frankfurt-P2 limpia (scanner)", hits: 11, total: 14, miss: "KIT 745, Ver Pag 2 de 2, CONSTANCIAS", ms: null },
];

export interface LabMeasureVerdictRow {
  motor: string;
  res: string;
  tiempo: string;
  conf: string;
  charsOut: number;
  charsGt: number;
  charsOk: number;
  cer: number;
  lineas: string;
  anclas: string;
  numExactos: string;
}

export const LAB_MEASURE_VERDICT: LabMeasureVerdictRow[] = [
  { motor: "Tesseract raw+1600", res: "494x1600", tiempo: "2124ms (mediana 3)", conf: "54/100", charsOut: 394, charsGt: 464, charsOk: 216, cer: 53.4, lineas: "7/24", anclas: "5/14", numExactos: "3/5 (ZONA=15, PUESTO=02, MESA=012)" },
  { motor: "Tesseract raw full-res", res: "928x3006", tiempo: "2938ms (mediana 3)", conf: "65/100", charsOut: 525, charsGt: 464, charsOk: 247, cer: 46.8, lineas: "10/24", anclas: "10/14", numExactos: "5/5 (ZONA=15, PUESTO=02, MESA=012, KIT=745, CÓDIGO 15d)" },
  { motor: "RapidOCR PP-OCRv4", res: "cruda (det 1920)", tiempo: "2798ms (mediana 3) det=0.564s cls=0.086s rec=1.926s", conf: "89.3/100", charsOut: 541, charsGt: 464, charsOk: 324, cer: 30.2, lineas: "22/24", anclas: "13/14", numExactos: "5/5 (ZONA=15, PUESTO=02, MESA=012, KIT=745, CÓDIGO 15d)" },
];

export interface LabTessTime {
  ms: number;
  size: string;
  conf: number;
}

export const LAB_TESS_TIMES: Record<string, LabTessTime> = {
  F1_hoy: { ms: 3155, size: "489x1600", conf: 52 },
  F1_tuned: { ms: 2912, size: "797x2608", conf: 59 },
  F2_hoy: { ms: 1700, size: "426x1394", conf: 51 },
  F2_tuned: { ms: 1752, size: "426x1394", conf: 55 },
  EG_hoy: { ms: 2477, size: "503x1499", conf: 65 },
  EG_tuned: { ms: 2446, size: "503x1499", conf: 68 },
};

export interface LabFase0 {
  variantesPrep: string[];
  notas: string[];
}

export const LAB_FASE0: LabFase0 = {
  variantesPrep: [
    "raw: 494x1600 filtro=34ms tinta=4.4%",
    "gray: 494x1600 filtro=147ms tinta=3.6%",
    "text: 494x1600 filtro=205ms tinta=5.3%",
    "bw: 494x1600 filtro=130ms tinta=8.7%",
  ],
  notas: [
    "FASE 0 (filtros): 'text' 12/14 el mejor; 'bw' el PEOR (8/14) — corrompe 'ZONA 15'→'18'.",
    "El downscale a 1600 px es el 2.º culpable: pierde 'FIRMA JURADO' → falso 'ACTA RECORTADA'.",
    "RapidOCR lee la foto CRUDA sin filtro (no necesita bw ni text) y el código 1D completo (conf .998+).",
  ],
};

/** Bloque completo listo para el JSON (laboratorio). */
export function laboratorio(): {
  nota: string;
  verdict2: LabVerdict2Row[];
  measureVerdict: LabMeasureVerdictRow[];
  tessTimes: Record<string, LabTessTime>;
  fase0: LabFase0;
} {
  return {
    nota: LAB_NOTA,
    verdict2: LAB_VERDICT2,
    measureVerdict: LAB_MEASURE_VERDICT,
    tessTimes: LAB_TESS_TIMES,
    fase0: LAB_FASE0,
  };
}
