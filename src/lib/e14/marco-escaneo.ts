/** KIT e63c-quad-gate-escaneo-v1 (D63-C): detector del MARCO IMPRESO del
 *  formulario E-14 para el gate de ESCANEOS. Evidencia (informe prod
 *  20261020-122235): «delegados-P1» leyó FUERTE y aun así el gate la tumbó
 *  con «ACTA CORTADA» — el guard afinado para FOTOS interpreta «contenido
 *  hasta el borde = cortada», y en un escaneo el acta va pegada al borde.
 *
 *  Regla de oro del kit §0: el gate sigue siendo HONESTO — lo que cambia es
 *  CÓMO se decide en escaneos: mirando el MARCO IMPRESO del formulario (el
 *  rectángulo de trazo oscuro del borde del E-14), no la cercanía del
 *  contenido al borde de la imagen:
 *  · Marco presente y entero (4 líneas) → veredicto "completo" → el gate de
 *    fotos NO bloquea (completa=true) y el RECT del formulario alimenta la
 *    región de la zona de votos (el marco ES el borde del acta — mismo
 *    sistema de referencia que las fracciones ZONA_* de marcadores.ts).
 *  · Marco cortado por el borde de la página (2–3 líneas) → "cortado" →
 *    INCOMPLETA como hoy (honesto: el scanner sí cortó la hoja).
 *  · Marco no encontrable (0–1 líneas — escaneo sin marco legible o acta
 *    encasquetada con el marco al filo) → "no-encontrado" → el gate NO
 *    bloquea; el veredicto lo deciden lectura/score/SIM como siempre.
 *
 *  FOTOS (origen "foto") y SIM JAMÁS llegan aquí (guard en el bridge) — el
 *  gate de fotos queda NI UNA LÍNEA distinto (kit T2.4/T3).
 *
 *  Parte PURA (sin DOM, testeable con bun): evaluarMarcoDeBitmap. Parte DOM
 *  (decode del data URL): evaluarMarcoImpreso. */

/** Veredicto del marco impreso (traza aditiva `gateMarco` — kit T2.3). */
export type MarcoImpreso = "completo" | "cortado" | "no-encontrado";

/** Resultado del detector: veredicto + rect del formulario en FRACCIONES del
 *  bitmap (0..1) cuando las 4 líneas cerraron un rectángulo (veredicto
 *  "completo") — null en los demás (jamás inventar una geometría). */
export interface MarcoEscaneo {
  veredicto: MarcoImpreso;
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
}

// ---------- Constantes (nombradas y comentadas — kit §1) ----------

/** Tinta = luminancia BT.601 por debajo de este umbral (trazo impreso). */
const UMBRAL_TINTA_MARCO = 150;

/** Una línea del marco exige que ≥ este porcentaje del lado esté oscuro
 *  (el marco impreso es CONTINUO; el texto deja filas/columnas agujereadas). */
const LINEA_MIN_PCT = 0.5;

/** Región de búsqueda de cada lado: fracción del dim correspondiente desde
 *  el borde (el marco del E-14 va pegado al borde del formulario). */
const REGION_FRACCION = 0.22;

/** Inset mínimo (px, a escala de análisis) para que una línea cuente como
 *  lado del marco: una línea pegada al filo (0–4 px) es AMBIGUA — puede ser
 *  el RESTO de un marco cortado por el borde (remanente del grosor de la
 *  línea) y no demuestra un lado entero. El marco real del E-14 va insertado
 *  ≥ 2% del ancho (≈ 9 px a 480) — un marco completo legítimo siempre pasa. */
const INSET_MIN_PX = 5;

/** Ancho del bitmap de análisis (decode barato del data URL procesado). */
const ANALISIS_MARCO_ANCHO = 480;

/** Fracción mínima entre lados opuestos del rect (sanity geométrico). */
const RECT_GAP_MIN = 0.05;

/** Fracción de píxeles oscuros de una fila/columna (cuánta tinta hay). */
function fraccionTintaLinea(
  esFila: boolean,
  indice: number,
  ancho: number,
  alto: number,
  rgba: Uint8ClampedArray,
): number {
  const total = esFila ? ancho : alto;
  let oscuros = 0;
  for (let i = 0; i < total; i++) {
    const px = esFila ? (indice * ancho + i) * 4 : (i * ancho + indice) * 4;
    const L = 0.299 * rgba[px] + 0.587 * rgba[px + 1] + 0.114 * rgba[px + 2];
    if (L < UMBRAL_TINTA_MARCO) oscuros++;
  }
  return oscuros / total;
}

/** Mejor línea de marco en la franja (región) de un lado: el índice con mayor
 *  fracción de tinta que alcance LINEA_MIN_PCT, o null. Devuelve el índice
 *  absoluto (fila o columna) y su fracción. */
function mejorLinea(
  esFila: boolean,
  desde: number,
  hasta: number,
  ancho: number,
  alto: number,
  rgba: Uint8ClampedArray,
): { indice: number; fraccion: number } | null {
  let mejor: { indice: number; fraccion: number } | null = null;
  for (let i = desde; i < hasta; i++) {
    const f = fraccionTintaLinea(esFila, i, ancho, alto, rgba);
    if (f >= LINEA_MIN_PCT && (mejor == null || f > mejor.fraccion)) {
      mejor = { indice: i, fraccion: f };
    }
  }
  return mejor;
}

/** Detector PURA del marco impreso (kit T2.1) sobre el bitmap (ya
 *  encasquetado — post-quad). Veredicto según el conteo de lados con línea
 *  completa: 4 → "completo" (+rect) · 2–3 → "cortado" · 0–1 → "no-encontrado". */
export function evaluarMarcoDeBitmap(
  ancho: number,
  alto: number,
  rgba: Uint8ClampedArray,
): MarcoEscaneo {
  if (ancho <= 0 || alto <= 0 || rgba.length < ancho * alto * 4) {
    return { veredicto: "no-encontrado", rect: null };
  }
  const regionFilas = Math.max(3, Math.round(alto * REGION_FRACCION));
  const regionCols = Math.max(3, Math.round(ancho * REGION_FRACCION));
  // Búsqueda de líneas EXCLUYENDO el filo (0..INSET_MIN_PX): una línea ahí es
  // ambigua con el corte físico (kit: el marco «cortado» no demuestra lado).
  const top = mejorLinea(true, INSET_MIN_PX, regionFilas, ancho, alto, rgba);
  const bottom = mejorLinea(true, alto - regionFilas, alto - INSET_MIN_PX, ancho, alto, rgba);
  const left = mejorLinea(false, INSET_MIN_PX, regionCols, ancho, alto, rgba);
  const right = mejorLinea(false, ancho - regionCols, ancho - INSET_MIN_PX, ancho, alto, rgba);
  const lados = [top, bottom, left, right].filter((l) => l != null).length;
  if (lados >= 4 && top && bottom && left && right) {
    const rect = {
      x0: left.indice / ancho,
      y0: top.indice / alto,
      x1: right.indice / ancho,
      y1: bottom.indice / alto,
    };
    const rectSano =
      rect.x1 - rect.x0 >= RECT_GAP_MIN &&
      rect.y1 - rect.y0 >= RECT_GAP_MIN &&
      rect.x0 < rect.x1 &&
      rect.y0 < rect.y1;
    if (rectSano) return { veredicto: "completo", rect };
  }
  if (lados >= 2) return { veredicto: "cortado", rect: null };
  return { veredicto: "no-encontrado", rect: null };
}

/** Decode del data URL PROCESADO a bitmap de análisis (parte DOM — solo
 *  navegador). Falla → "no-encontrado" (el marco jamás tumba el pipeline). */
async function bitmapDeDataUrl(dataUrl: string): Promise<{ ancho: number; alto: number; rgba: Uint8ClampedArray } | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const escala = Math.min(1, ANALISIS_MARCO_ANCHO / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return { ancho: w, alto: h, rgba: ctx.getImageData(0, 0, w, h).data };
  } catch {
    return null;
  }
}

/** Punto que llama el bridge (kit T2.1): marco impreso sobre la imagen ya
 *  encasquetada. Cualquier fallo → "no-encontrado" (el gate NO bloquea —
 *  el veredicto lo deciden lectura/score como siempre). */
export async function evaluarMarcoImpreso(dataUrl: string): Promise<MarcoEscaneo> {
  try {
    const bm = await bitmapDeDataUrl(dataUrl);
    if (!bm) return { veredicto: "no-encontrado", rect: null };
    return evaluarMarcoDeBitmap(bm.ancho, bm.alto, bm.rgba);
  } catch {
    return { veredicto: "no-encontrado", rect: null };
  }
}
