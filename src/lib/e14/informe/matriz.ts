/**
 * matriz.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.5)
 *
 * El comparativo EN el dispositivo: 5 variantes de la MISMA captura
 * (processImage de producción con el quad detectado) × 3 motores OCR
 * (9 celdas secuenciales, cada una con try/catch individual).
 * Guard: sin fotoOriginal o sin quadDetectado → matriz omitida con motivo
 * (el informe sale igual, AC-3). NUNCA guarda dataUrls en el resultado.
 */
import { evento, reiniciarEventos, tomarUltimoPipeline } from "./telemetria";
import { loadImage, processImage } from "@jg-stevan/scanner-core/image-processor";
import type { Quad, PageFilter } from "@jg-stevan/scanner-core/types";
import { evaluarCelda, gtDeTexto, sim, norm, type EvalCelda, type GtKey } from "./analisis-texto";
import { ocrActual, tessFullResInit, tessFullResReconocer, tessFullResTerminar } from "./motores";
// KIT e14-motor-rapidocr-v1 (PROD-2 §4.1-C1): el módulo se MOVIO a ocr/ —
// misma instancia compartida con producción (singleton de sesión, §9.6).
import { rapidOcrInit, rapidOcrReconocer } from "../ocr/rapidocr";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface VarianteInfo {
  nombre: string;
  buildMs: number;
  w: number;
  h: number;
  dataUrlLen: number;
  /** solo para trazas internas — jamás va al informe. */
  dataUrl: string;
}

export interface CeldaMatriz {
  motor: string;
  variante: string;
  cargaMs: number | null;
  inferMs: number;
  totalMs: number;
  conf: number | null;
  chars: number;
  palabras: number;
  lineas: number;
  anclas: { hits: number; total: number; miss: string[] };
  campos: EvalCelda["campos"];
  gt: { hits: number; total: number } | null;
  cer: number | null;
  lineasGt: EvalCelda["lineasGt"] | null;
  /** similitud vs la celda de referencia (NO es precisión). */
  simRef: number | null;
  error: string | null;
}

export interface MatrizResultado {
  omitidaMotivo: string | null;
  variantes: Omit<VarianteInfo, "dataUrl">[];
  celdas: CeldaMatriz[];
  /** texto OCR completo por celda (índice alineado con celdas) — va al
   *  informe (TXT/JSON), que es TEXTO: NUNCA retiene dataUrls (AC-7). */
  textos: string[];
  presupuestoMs: number;
  duracionMs: number;
}

// ─── Presupuesto ────────────────────────────────────────────────────────────

const PRESUPUESTO_MS = 90_000;

// ─── Construcción ───────────────────────────────────────────────────────────

/** Grayscale por píxel (luma 0.299/0.587/0.114 — determinista y portable;
 *  el core no tiene filtro gray — variante derivada del "original"). */
async function aGris(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = g;
    px[i + 1] = g;
    px[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL("image/jpeg", 0.92);
}

interface FotoCaptura {
  /** data URL cruda (foto ORIGINAL del pipeline, no la procesada). */
  original: string;
  /** quad del pipeline (null → matriz omitida). */
  quad: Quad | null;
  rotacion?: number;
}

async function construirVariantes(foto: FotoCaptura): Promise<Record<string, VarianteInfo>> {
  const variantes: Record<string, VarianteInfo> = {};
  const registrar = async (nombre: string, fn: () => Promise<{ dataUrl: string }>) => {
    const t0 = performance.now();
    const { dataUrl } = await fn();
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    variantes[nombre] = {
      nombre,
      buildMs: Math.round(performance.now() - t0),
      w,
      h,
      dataUrlLen: dataUrl.length,
      dataUrl,
    };
    evento("matriz/variante", `${nombre}: ${w}x${h} · ${Math.round(performance.now() - t0)}ms · dataUrl ${dataUrl.length} bytes`);
  };

  const quad = foto.quad!;
  // Mapeo variante → PageFilter de PRODUCCIÓN (el core solo tiene
  // "original"|"text"|"bw"): recorte-raw = "original" (el crudo del warp,
  // misma elección del puente §D8.3 para el as-is). recorte-gray se deriva
  // del "original" con luma por píxel (el core no tiene gray).
  await registrar("recorte-raw", () => processImage(foto.original, quad, "original", foto.rotacion).then((r) => ({ dataUrl: r.processed })));
  await registrar("recorte-text", () => processImage(foto.original, quad, "text", foto.rotacion).then((r) => ({ dataUrl: r.processed })));
  await registrar("recorte-gray", async () => ({
    dataUrl: await aGris((await processImage(foto.original, quad, "original", foto.rotacion)).processed),
  }));
  await registrar("recorte-bw", () => processImage(foto.original, quad, "bw", foto.rotacion).then((r) => ({ dataUrl: r.processed })));
  // foto-completa: la original tal cual (dims vía loadImage)
  const img = await loadImage(foto.original);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  variantes["foto-completa"] = {
    nombre: "foto-completa",
    buildMs: 0,
    w,
    h,
    dataUrlLen: foto.original.length,
    dataUrl: foto.original,
  };
  evento("matriz/variante", `foto-completa: ${w}x${h} · as-is`);
  return variantes;
}

// ─── Celdas ─────────────────────────────────────────────────────────────────

async function correrCelda(
  motor: string,
  variante: string,
  fn: () => Promise<{ texto: string; conf: number | null }>,
  textos: string[],
): Promise<CeldaMatriz> {
  const t0 = performance.now();
  let cargaMs: number | null = null;
  try {
    if (motor === "tesseract-fullres" && !tessYaInit) {
      await tessFullResInit();
      cargaMs = Math.round(performance.now() - t0);
      tessYaInit = true;
    }
    if (motor === "rapidocr-v4" && !rapidYaInit) {
      await rapidOcrInit();
      cargaMs = Math.round(performance.now() - t0);
      rapidYaInit = true;
    }
    const t1 = performance.now();
    const { texto, conf } = await fn();
    const inferMs = Math.round(performance.now() - t1);
    textos.push(texto);
    // gtKey: match del código 1D sobre el TEXTO de ESTA celda (GT de Apéndice B)
    const gtKey = gtDeTexto(texto);
    const ev = evaluarCelda(texto, gtKey);
    const celda: CeldaMatriz = {
      motor,
      variante,
      cargaMs,
      inferMs,
      totalMs: Math.round(performance.now() - t0),
      conf,
      chars: texto.length,
      palabras: texto.trim() ? texto.trim().split(/\s+/).length : 0,
      lineas: texto.trim() ? texto.trim().split("\n").length : 0,
      anclas: ev.anclas,
      campos: ev.campos,
      gt: ev.gt,
      cer: ev.cer,
      lineasGt: ev.lineasGt,
      simRef: null,
      error: null,
    };
    evento(
      "matriz/celda",
      `${motor}/${variante}: anclas ${ev.anclas.hits}/${ev.anclas.total} · campos ${ev.campos.ok} · ${celda.chars} chars · ${celda.totalMs}ms${ev.gt ? ` · gt ${ev.gt.hits}/${ev.gt.total}` : ""}`,
    );
    return celda;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    evento("matriz/celda", `${motor}/${variante}: ERROR — ${msg}`);
    return celdaVacia(motor, variante, cargaMs, Math.round(performance.now() - t0), msg);
  }
}

let tessYaInit = false;
let rapidYaInit = false;

function celdaVacia(
  motor: string,
  variante: string,
  cargaMs: number | null,
  totalMs: number,
  error: string,
): CeldaMatriz {
  return {
    motor,
    variante,
    cargaMs,
    inferMs: 0,
    totalMs,
    conf: null,
    chars: 0,
    palabras: 0,
    lineas: 0,
    anclas: { hits: 0, total: 10, miss: [] },
    campos: { zona: null, puesto: null, mesa: null, kit: null, codigo1D: null, pagina: null, ok: 0 },
    gt: null,
    cer: null,
    lineasGt: null,
    simRef: null,
    error,
  };
}

// ─── Similitud vs referencia ────────────────────────────────────────────────

export function marcarSimRef(celdas: CeldaMatriz[], textosPorCelda: string[]): void {
  // referencia = mayor anclas.hits + campos.ok, desempate por más chars
  let refIdx = -1;
  let mejorScore = -1;
  let mejorChars = -1;
  for (let i = 0; i < celdas.length; i++) {
    const c = celdas[i];
    if (c.error) continue;
    const score = c.anclas.hits + c.campos.ok;
    if (score > mejorScore || (score === mejorScore && c.chars > mejorChars)) {
      mejorScore = score;
      mejorChars = c.chars;
      refIdx = i;
    }
  }
  if (refIdx < 0) return;
  const refNorm = norm(textosPorCelda[refIdx]);
  for (let i = 0; i < celdas.length; i++) {
    if (celdas[i].error || i === refIdx) continue;
    celdas[i].simRef = sim(refNorm, norm(textosPorCelda[i]));
  }
  celdas[refIdx].simRef = 1;
  evento("matriz/referencia", `variante de referencia: ${celdas[refIdx].motor}/${celdas[refIdx].variante}`);
}

// ─── Orquestación de la matriz ──────────────────────────────────────────────

export async function correrMatriz(foto: FotoCaptura): Promise<MatrizResultado> {
  const tInicio = performance.now();
  const resultado: MatrizResultado = {
    omitidaMotivo: null,
    variantes: [],
    celdas: [],
    textos: [],
    presupuestoMs: PRESUPUESTO_MS,
    duracionMs: 0,
  };

  // Guard (§4.5): sin fotoOriginal o sin quad → omitida con motivo
  if (!foto.original) {
    resultado.omitidaMotivo = "sin fotoOriginal en el acta";
    return resultado;
  }
  if (!foto.quad) {
    resultado.omitidaMotivo = "sin quadDetectado (timeout/detección fallida o SIM sin recorte)";
    return resultado;
  }

  let variantes: Record<string, VarianteInfo>;
  try {
    variantes = await construirVariantes(foto);
  } catch (e) {
    resultado.omitidaMotivo = `variantes fallaron: ${e instanceof Error ? e.message : String(e)}`;
    return resultado;
  }
  resultado.variantes = Object.values(variantes).map(({ dataUrl: _d, ...resto }) => resto);

  const celdas: CeldaMatriz[] = [];
  const textos: string[] = [];

  const agotado = () => performance.now() - tInicio > PRESUPUESTO_MS;
  const siAgotado = "presupuesto agotado";

  // ── motor actual × [bw, raw, text, gray]
  for (const v of ["recorte-bw", "recorte-raw", "recorte-text", "recorte-gray"]) {
    if (agotado()) {
      celdas.push(celdaVacia("actual", v, null, 0, siAgotado));
      continue;
    }
    celdas.push(await correrCelda("actual", v, () => ocrActual(variantes[v].dataUrl), textos));
  }

  // ── tesseract-fullres × [raw, text]
  for (const v of ["recorte-raw", "recorte-text"]) {
    if (agotado()) {
      celdas.push(celdaVacia("tesseract-fullres", v, null, 0, siAgotado));
      continue;
    }
    celdas.push(
      await correrCelda(
        "tesseract-fullres",
        v,
        () => tessFullResReconocer(variantes[v].dataUrl),
        textos,
      ),
    );
  }

  // ── rapidocr-v4 (det 1920) × [foto-completa, raw, bw]
  for (const v of ["foto-completa", "recorte-raw", "recorte-bw"]) {
    if (agotado()) {
      celdas.push(celdaVacia("rapidocr-v4", v, null, 0, siAgotado));
      continue;
    }
    celdas.push(
      await correrCelda(
        "rapidocr-v4",
        v,
        async () => {
          const rt = await rapidOcrInit();
          const r = await rapidOcrReconocer(rt, variantes[v].dataUrl);
          return { texto: r.texto, conf: r.confMedia };
        },
        textos,
      ),
    );
  }

  // cleanup del worker full-res (fin de la matriz)
  void tessFullResTerminar();

  marcarSimRef(celdas, textos);
  resultado.celdas = celdas;
  resultado.textos = textos;
  resultado.duracionMs = Math.round(performance.now() - tInicio);
  evento("matriz/fin", `9 celdas en ${resultado.duracionMs}ms (presupuesto ${PRESUPUESTO_MS / 1000}s)`);
  return resultado;
}

/** Resetea los singletons de init (por si arranca un informe nuevo). */
export function resetInitsMatriz(): void {
  tessYaInit = false;
  rapidYaInit = false;
  // la bitácora se reinicia con el informe
  reiniciarEventos();
  // el último pipeline del informe anterior se conserva para trazas:
  void tomarUltimoPipeline();
}
