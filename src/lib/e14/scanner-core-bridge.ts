/**
 * RealCoreBridge — el motor REAL del repo (`src/lib/e14/core/`, SPEC-fase-logica §5).
 * FASE LÓGICA L2: fuente ARCHIVO completa —
 *   fileToCaptureDataUrl → detectDocumentEdges → processImage →
 *   evaluateQuality → requestOcr → mapeo §4 → Acta.
 * FASE LÓGICA L3 (§5 CAMARA): la fuente CÁMARA reusa EL MISMO pipeline con
 *   dos entradas —
 *   · `archivo` (foto ya capturada por ZSL / captureSmart / cámara nativa
 *     iOS — la ruta del spec §7: "la foto entra al mismo pipeline (como
 *     ARCHIVO, L2)");
 *   · `frameActual` (video con stream vivo, último recurso) → grab síncrono
 *     a canvas a RESOLUCIÓN DEL STREAM → dataUrl → pipeline. El grab debe
 *     ocurrir ANTES de que React desmonte el visor (el stream se detiene al
 *     cambiar a ANALIZANDO), por eso se hace en el arranque síncrono de
 *     escanearActa.
 * Mapeo de score §4.1 (techos por level), gate de legibilidad §4.2 (el OCR
 * manda sobre el score: ILEGIBLE calca la rechazada v2) y timeout global de
 * 15 s que RESUELVE un acta RECHAZADA (nunca congela la UI ni revienta el
 * flujo de toasts del store). Etiquetas de etapa idénticas por fuente.
 * FASE LÓGICA L5 (§7.5): `recortar` — re-ejecuta §5 sobre `fotoOriginal` con
 * el QUAD MANUAL (F5-MANUAL del core: `manual: true` respeta el quad al
 * píxel, sin refine) → fotoProcesada nueva → evaluateQuality + gate OCR →
 * acta ACTUALIZADA. El rescate D20 NO consume intento (fuente/intento/
 * maxIntentos/paginación se preservan por spread del acta de entrada).
 *
 * Lo que sigue simulado (votos/firmas/ubicación) se rellena del seed exacto
 * (§0: no se presenta como extraído).
 *
 * UX-REAL F1 (SPEC-ux-real-bn-editor §F1, D35): SIMULACIÓN también pasa por
 * este pipeline — la fuente carga el acta E-14 REAL incluida (§1) y la trata
 * EXACTAMENTE como un `archivo` de IMPORTAR (mismo File → fileToCaptureDataUrl
 * → F-IMPORT: EXIF/12MP). El mock de la fase gráfica se retiró.
 */
import {
  detectDocumentEdgesDetail,
  evaluateQuality,
  ErrorRescateHeic,
  fileToCaptureDataUrl,
  // 7.6 (plan de remediación, cierra C2-partial): la FÓRMULA de calidad y
  // sus umbrales de level viven UNA sola vez — en el paquete (antes estaban
  // copiadas aquí a mano y derivaban si el core las cambiaba).
  nivelPorPuntaje,
  processImage,
  puntajeCalidad,
} from "@jg-stevan/scanner-core/core/image-processor";
import type { OrigenQuad } from "@jg-stevan/scanner-core/core/image-processor";
// KIT e14-masiva-ux-v1 (T1): mecanismo de warm-up del worker OpenCV que ya
// expone el core (el mismo que ScanView.tsx:757 invoca al montar) — la
// detección al importar espera al worker en vez de caer al Sobel de una.
import {
  getScannerWorker,
  warmUpScannerWorker,
} from "@jg-stevan/scanner-core/core/detector-client";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/core/ocr";
// KIT e14-motor-rapidocr-v1 (PROD-2 §3): motor de OCR de producción — módulo
// compartido con el informe (singleton de sesión ÚNICO, pitfall §9.6). El
// requestOcr del core SOLO vive en motores.ts (celda «actual» de la matriz —
// instrumento congelado, pitfall §9.2).
import { defaultQuad } from "@jg-stevan/scanner-core/core/types";
import type {
  PageFilter,
  PageQuality,
  Quad,
} from "@jg-stevan/scanner-core/core/types";
import { statusDeScore } from "@jg-stevan/scanner-core/dominio/types";
import { cargarDivipol } from "@jg-stevan/scanner-core/dominio/divipol";
import {
  clasificarCabecera,
  faltaSeccionInferior,
  faltaSeccionInferiorConBanda,
  PATRON_CABECERA,
  tituloYUbicacionDe,
  tipoDeBanda,
  type ClasificacionE14,
} from "@jg-stevan/scanner-core/dominio/clasificador";
// KIT e14-optimizacion-v1 (T1): los 4 decodes del bridge (calidad ×2,
// esquinas, banda) pasan por el memo FIFO tope 2 de image-utils — misma
// imagen, una sola decodificación por dataURL del acta en vuelo.
import { loadImageMemo, procesadaVaciaDataUrl } from "@jg-stevan/scanner-core/dominio/image-utils";
// KIT identificacion-codigo-v1 (FASE F, Task 120): marcas fiduciales de
// esquina sobre el crop ya enderezado — señal «sin recortar» que ve los
// recortes SUPERIORES que faltaSeccionInferior (kit 118, solo inferior) no ve.
import {
  cuatroEsquinasFaltan,
  ladoEsquinaFaltante,
  marcasEsquina,
  perdonFaltaFiduciales,
  trazaEsquinas,
  type EsquinasActa,
} from "@jg-stevan/scanner-core/dominio/integridad";
// GUARD-BORDE Rev. 2 (SPEC-e14-guard-borde §2-§3, D1/D3): la verificación de
// completitud vive en helper ÚNICO (completitud.ts) — «la geometría sospecha,
// la tinta condena» — usado por AMBOS pipelines (escaneo y recorte, AC11).
import { verificarCompletitud } from "@jg-stevan/scanner-core/dominio/completitud";
// KIT e14-gate-v2 (FASE G2): marcador OBLIGATORIO de votos — helper ÚNICO
// compartido con el guard de completitud (motorTinta, cero duplicación).
import { medirZonaVotos } from "@jg-stevan/scanner-core/dominio/marcadores";
// KIT e14-score-lectura-v1: señal de LECTURA del score v2 (módulo puro — §4-A).
// (PISO_LECTURA_FUERTE/TECHO_LECTURA_DEBIL ya no se importan aquí: desde 7.2
// el bloque C3 vive en politica/gate.ts — consumido por AMBOS pipelines.)
import {
  lazoPerdonadoPorLectura,
  senalDeLectura,
} from "@jg-stevan/scanner-core/dominio/senal-lectura";
// 7.1 (plan de remediación, cierra C3) — umbrales con nombre, ÚNICA fuente
// de verdad de los números del producto (./politica/umbrales.ts).
import {
  TECHO_ADVERTENCIA,
  TECHO_ESCUDO_FONDO,
  TECHO_SIN_SENAL,
  UMBRAL_RECHAZO_SCORE,
  UMBRAL_SCORE_INCOMPLETA,
  BANDA_IZQ_FRACCION,
  BANDA_ARRIBA_FRACCION,
  BANDA_DER_FRACCION,
  BANDA_ABAJO_FRACCION,
  BANDA_INFERIOR_IZQ_FRACCION,
  BANDA_INFERIOR_ARRIBA_FRACCION,
  BANDA_INFERIOR_DER_FRACCION,
  BANDA_INFERIOR_ABAJO_FRACCION,
  CALIDAD_JPEG_ENVIO,
  CALIDAD_JPEG_REVISION,
} from "./politica/umbrales";
// 7.2 (plan de remediación, cierra A1) — LA política del gate (bloque ÚNICO
// que antes vivía duplicado a mano aquí en pipelineRecorte y en pipeline.ts).
import { aplicarPoliticaGate } from "./politica/gate";
// 7.1 (C3): piso de lectura FUERTE — única fuente (re-export del paquete).
import { PISO_LECTURA_FUERTE } from "./politica/umbrales";
// 7.9 (C4): ÚNICO constructor del log-contrato D51 (+ su orden canónico).
import { construirLogD51, ORDEN_LOG_D51, type EntradaD51 } from "./log-contrato";
// §G-1 (SPEC-camara-funcional): los assets de la SIMULACIÓN de scores —
// S-6 (plan de remediación, correcciones §3): CARGADORES DINÁMICOS en mapa
// explícito (a prueba de refactors de nombres, resoluble estáticamente por
// el bundler). El import estático engordaba el bundle crítico del escaneo
// con los fixtures del modo demo.
// Ola 1/D35: foto real retirada del repo — `acta-e14-real.jpg` ya NO se
// usa NI se referencia: el modo SIM corre SOLO con los 4 sintéticos
// `acta-sim-*.jpg` (el archivo sobrante en src/assets/ se elimina en el
// PR de custodia del binario — ver docs/PENDIENTES-INTEGRACION.md).
// Orden del arreglo (§D3/§D8.1 — el índice lo decide indiceActaPorScore):
//   [0] ÓPTIMA  = acta-sim-extra-1.jpg (pipeline COMPLETO con detect+warp+bw;
//       sustituta de la foto real del mantenedor — el mantenedor recalibra el orden si
//       el chip 8.2 deja de caer en ÓPTIMA con este asset)
//   [1] MEDIO   = acta-sim-intermedia.jpg (as-is, §D6 Rev. 3)
//   [2] BAJA    = acta-sim-baja.jpg (as-is, §D7 Rev. 3)
//   [3] EXTRA   = acta-sim-extra-2.jpg (solo ciclo rotativo §G)
import type { Acta, ActaFirma, ActaStatus, DiagnosticoActa, ProgresoAnalisis } from "@jg-stevan/scanner-core/dominio/types";
import type { E14Bridge, OpcionesEscaneo } from "@jg-stevan/scanner-core/dominio/bridge";
// KIT e14-motor-rapidocr-v1 (PROD-2 §3): adaptador del motor de producción.
import { rapidOcrInit, rapidOcrReconocer } from "./ocr/rapidocr";
// KIT e14-orientacion-auto-v1 (T-A2/A3): probe de orientación por confianza
// de rec + anclas (§2.1) — corre ANTES del OCR completo en AMBOS pipelines
// (escaneo y pipelineRecorte). SIM OMITIDO (guard — chips 8.2/7.0/4.3
// intactos, §2.2); JAMÁS lanza (catch interno — el pipeline no depende, §5).
import { probeOrientacion, rotarDataUrl } from "./orientacion";
// KIT e14-orientacion-qr-v1 — la brújula QR decide la rotación por el
// cuadrante del QR (bench v8.3: 4/4); el sondeo OCR queda como red de
// seguridad cuando el QR no lee. leerFlags = kill-switch del mantenedor (§D).
import { leerFlags, opcionesRescateHeic } from "./flags";
// WAVE2 A1 — tipo del resultado del probe (para el diag de la mini descartada por el fallo seguro).
import type { ProbeOrientacion } from "./orientacion";
// KIT e14-ocr-escalonado-v1 (§2): caps del det-preprocess (op4) expuestos por
// el motor + decisión/elegir del módulo PURO nuevo (testable headless — bun).
import { DET_CAP_PROD, DET_CAP_RAPIDO } from "./ocr/rapidocr";
import {
  anclasDe,
  elegirMejor,
  necesitaSegunda,
  rescateAporta,
} from "@jg-stevan/scanner-core/dominio/ocr-escalonado";
// KIT e14-ocr-cascada-v1 (K3 fase 2): núcleo PURO de la cascada (gate entre
// motores + rescate ROI) — flag ocrCascada (default OFF ⇒ escalonado
// de siempre byte a byte). Decision/eleccion de siempre: NEEDS ocr-escalonado.
import {
  correrCascadaOcr,
  ROI_FRACCIONES,
  type DepsOcrCascada,
  type PasadaCascada,
} from "@jg-stevan/scanner-core/orquestacion/cascada";
// FASE C del plan post-v2.3 (medición §6.7): resumen de UNA corrida de
// lectura (motor aceptante, intentos con gate, ms por motor) — se persiste
// en `PerfActa.lectura` junto al perf del acta.
import {
  colectorLectura,
  type ResumenLectura,
} from "@jg-stevan/scanner-core/obs-base/eventos-lectura";
// KIT e14-gama-baja-20s-v1: knobs OCR por tier (SYNC/barato — adaptacion/plan.ts).
// KIT e14-ocr-tessbest-v1 (GO-B del mantenedor): TESSERACT BEST como intento 1
// de la cascada (vendido + worker propio + budget) y el presupuesto del
// escaneo por tier (BAJO 480 s · MEDIO 240 s · ALTO 120 s — P0 del informe
// sim-gama-baja: el timeout fijo de 120 s rechazaba actas perfectas en
// mono-hilo). Import dinámico dentro del módulo: el bundle principal no
// descarga tesseract hasta la 1.ª cascada real.
import { tessReconocer } from "./ocr/tesseract";
import {
  planAdaptativo,
  presupuestoEscaneoEfectivo,
} from "./adaptacion/plan";
// KIT e14-diagnostico-autoenvio-v1 (C1): registro del DESENLACE montado justo
// donde hoy se escribe el log de auditoría (UNA sola fuente de verdad — §9.6).
import { construirDiagnostico } from "@jg-stevan/scanner-core/dominio/diagnostico";
import { canvasCon } from "@jg-stevan/scanner-core/dominio/image-utils"; // SPRINT-A A3 — factory de canvas
import { logger } from "../logger"; // SPRINT-A A6 — console→logger (mensajes byte-idénticos)
// FASE F (plan post-v2.3) — el CUERPO de §5 vive en pipeline.ts (move-only) y
// recibe por inyección los helpers de este módulo que comparte con el recorte.
import { correrPipelineL2 } from "./pipeline";

/** Memo de decode POR INSTANCIA de File (WeakMap — GC-friendly, no retiene
 *  blobs; Kit e14-masiva-tiempos-v1 PR-2). El mismo File JAMÁS se decodifica
 *  dos veces: un re-intento del pipeline sobre el MISMO archivo golpea la
 *  memo (~0 ms). TRANSPARENTE para todos los flujos: misma promesa, mismo
 *  resultado; si el decode falla, la entrada sale de la memo y el siguiente
 *  intento re-decodifica (jamás bloquea). */
const decodeMemo = new WeakMap<File, Promise<string>>();

function decodeArchivoMemo(file: File): Promise<string> {
  let p = decodeMemo.get(file);
  if (!p) {
    p = fileToCaptureDataUrl(file, opcionesRescateHeic());
    decodeMemo.set(file, p);
    void p.catch(() => {
      if (decodeMemo.get(file) === p) decodeMemo.delete(file);
    });
  }
  return p;
}

// SPRINT-A (perf/decode-once-v1) A5: el export precargarDecodeArchivo fue
// eliminado — DEAD desde D66 (el prefetch del runner se re-apuntó a
// asegurarMaestro; 0 anclas en scripts/, 0 usos en src). La memo interna
// decodeArchivoMemo sigue viva (el pipeline la usa).

/** Timeout de seguridad global §5 (worker colgado en gama baja).
 *  KIT e67-watchdog-rescate-v1 (M-e67-0 / cambio A): 15_000 → 120_000 — el
 *  plan del mantenedor pedía subirlo (asumía 30 s; el default REAL era 15 s desde
 *  el split del repo — desviación documentada en el REPORTE). Evidencia:
 *  un ARCHIVO real terminó VÁLIDO a los ~53.5 s y el watchdog de 15 s ya lo
 *  había rechazado (resultado descartado en silencio). 120 s da colchón
 *  frente al peor caso observado (53.5 s + 36 líneas OCR) sin esperar de
 *  más a un colgaje real. KIT e14-ocr-tessbest-v1: el default FIJO dejó de
 *  existir — hoy el default lo resuelve `presupuestoEscaneoEfectivo()`
 *  (adaptacion/plan.ts): ALTO 120 s (byte-idéntico a e67) · MEDIO 240 s ·
 *  BAJO 480 s (evidencia sim-gama-baja v2/v3: mono-hilo 6× necesita ~125 s
 *  y el fijo de 120 s rechazaba el acta con score 0.0 ANTES de terminar).
 *  El presupuesto por llamada es OPCIONAL
 *  (OpcionesEscaneoConTimeout.timeoutMs — manda sobre el plan). El RECORTE
 *  manual conserva su RECORTE_TIMEOUT_MS propio (ruta distinta). */
/** KIT e14-recorte-manual-v1 (T1): presupuesto del RECORTE manual — el warp
 *  del editor mide 14–17.4 s en el equipo del mantenedor (OCR solo: 9.8–14.3 s),
 *  al borde del límite de 15 s del escaneo. El timeout SIGUE RECHAZANDO
 *  (gate/score intactos — §5); lo único que cambia es qué foto muestra el
 *  acta resultante: el recorte ya horneado (parcial), no la foto vieja. */
const RECORTE_TIMEOUT_MS = 30_000;
/** KIT e14-recorte-manual-v1 (T1): lo que el pipeline del RECORTE ya horneó
 *  cuando el presupuesto vence — campos del return normal que SOLO dependen
 *  del warp (etapa 1). Vacío = el warp no alcanzó → acta vieja (igual a hoy). */
type ParcialRecorte = {
  fotoProcesada?: string;
  procesadaVacia?: boolean;
  quadDetectado?: Quad;
  rotation?: number;
};
/** KIT e14-masiva-ux-v1 (T1) + KIT e14-ocr-tessbest-v1: tope de cada espera
 *  del warm-up del worker OpenCV en la detección (1ª espera antes del
 *  intento + 1ª antes del reintento — §3-T1). YA NO es una constante fija:
 *  `esperaWorkerEfectiva()` (adaptacion/plan.ts) la resuelve POR TIER —
 *  ALTO 5 s (byte-idéntico histórico) · MEDIO 10 s · BAJO 20 s (a CPU 6× el
 *  compile+wasm mono-hilo no cabe en 5 s y la detección caía a fallback
 *  Sobel → quad peor → score 4.9 en un acta 10.0 — sim-lowend-v4).
 *  Vencido el tope se continúa como hoy (fallback Sobel): la espera JAMÁS
 *  bloquea el pipeline más de lo que tarda el warm-up real. */
/** Techos/labels del mapeo §4 y el gate §4.2. */
const DETALLE_ILEGIBLE = "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS";
const DETALLE_TIMEOUT = "TIEMPO DE PROCESADO EXCEDIDO";
const DETALLE_GENERICO = "SCORE INSUFICIENTE PARA TRANSMISIÓN";
// §F-5 (SPEC-camara-funcional): detalle del rechazo por acta INCOMPLETA —
// la captura corta el papel aunque la cabecera sea legible.
const DETALLE_INCOMPLETA = "EL ACTA ESTÁ CORTADA EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL ACTA COMPLETA";
// KIT e63d-escaneo-ya-recortado-v1 (F3.4): copy de la rama escaneo RETIRADO
// junto con el módulo masiva (el origen del archivo era señal exclusiva del
// runner MASIVA — sin cola no hay flujos «escaneo»).
// KIT e14-gate-v2 (FASE G2): detalle del rechazo por el MARCADOR
// OBLIGATORIO de votos fallido — copy CORTO y descriptivo (decisión del
// mantenedor: SIN guía de cámara). El rechazo directo regresa el flujo a
// captura (comportamiento existente de RECHAZADA).
const DETALLE_SIN_VOTOS = "ACTA SIN VOTOS VISIBLES";
// §D1/KIT: los NÚMEROS de la política (TECHO_SIN_SENAL, TECHO_ESCUDO_FONDO,
// techos del score, umbral de rechazo) viven en politica/umbrales.ts desde
// 7.1 (C3 — única fuente de verdad); el copy BAJO queda aquí.
const DETALLE_BAJO = "NO SE RECONOCE INFORMACIÓN DEL ACTA — REPITA LA FOTO";

/**
 * §D1 (SPEC-e14-score-ocr): SEÑAL DE CONTENIDO del acta — se calcula DESPUÉS
 * del OCR + clasificación. El score del mantenedor mide el RECONOCIMIENTO («el
 * score se basa en el reconocimiento del acta por ocr y que el acta esté
 * completa»), no solo las métricas fotográficas. Señales: cabecera E-14 o
 * alguna lectura cruda del clasificador (MESA/tipo). `ocrTextIsValid` NO es
 * señal (la bolsa de papas lo pasa con texto ficticio del empaque).
 */
function senalDeContenido(texto: string, clasificacion: ClasificacionE14): boolean {
  const p = clasificacion.parciales;
  return (
    PATRON_CABECERA.test(texto) ||
    p?.cabecera === true ||
    (p?.mesa != null && Number.isFinite(p.mesa)) ||
    p?.tipo != null
  );
}

// GUARD-BORDE Rev. 2 (D1/D3): la función esActaCompleta del guard del PR #33
// (geometría: esquina al filo ≤0.001/≥0.999 o área <30% → INCOMPLETA) VIVIÓ
// aquí y hoy vive en ./completitud (verificarCompletitud) — la geometría
// pasó de CONDENAR a SER SOSPECHA: la condena exige tinta impresa cortada al
// filo del recorte (tabla de decisión §2 del spec). Historia completa del
// guard y su calibración: comentario del helper + CHANGES 0-decimoquinto.
// PATRON_CABECERA vive ahora en ./clasificador (§4.5: se mantiene como
// constante para traza/log — ya NO decide sola el estado del gate).

/** §D8.3 (SPEC-e14-score-ocr Rev. 3): quad IDENTIDAD — «el recorte es la
 *  foto entera». Con sinRecorte la detección de bordes NO corre y el quad
 *  (fracciones 0-1 de la foto) cubre TODO el encuadre: se imprime en el log
 *  como hoy (traza de auditoría) y alimenta el editor (recorte manual real
 *  sobre la foto completa) y revelar/filtros (mismo quad). */
const QUAD_IDENTITY: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Grab del <video> a RESOLUCIÓN DEL STREAM (§5 CAMARA): canvas de
 * videoWidth×videoHeight → JPEG 0.92. Síncrono (~10 ms) — se llama ANTES de
 * que el visor se desmonte, mientras el stream sigue vivo.
 */
function capturarFrame(video: HTMLVideoElement): string | null {
  try {
    const canvas = canvasCon(video.videoWidth, video.videoHeight); // SPRINT-A A3 — factory
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(video, 0, 0);
    // 7.1: CALIDAD_JPEG_REVISION (0.92) desde politica/umbrales.ts.
    return canvas.toDataURL("image/jpeg", CALIDAD_JPEG_REVISION);
  } catch {
    return null;
  }
}

/** Entrada del pipeline: File (ARCHIVO o foto CÁMARA) o dataUrl ya crudo.
 *  §D8.2 (SPEC-e14-score-ocr Rev. 3): el flag «sin recorte automático» viaja
 *  con el ASSET de SIMULACIÓN dentro de la entrada (parámetro interno
 *  privado — OpcionesEscaneo queda INTACTO, nada público nuevo). */
export type EntradaPipeline = { archivo: File; sinRecorte?: boolean } | { dataUrl: string };

/**
 * SIMULACIÓN = pipeline real sobre los assets SIM (D35, Ola 1: foto real
 * retirada — solo sintéticos). §G-2 (SPEC-camara-funcional): ciclo
 * determinista de las actas del arreglo (óptima → intermedia → baja →
 * extra → óptima…) — cada disparo consume el índice actual y avanza el
 * contador de módulo. Mismo camino que IMPORTAR: File →
 * fileToCaptureDataUrl (F-IMPORT: EXIF/12MP). Caché POR ÍNDICE a nivel de
 * módulo para no re-descargar un acta ya servida en el ciclo.
 * §D8.1 (SPEC-e14-score-ocr Rev. 3): flag «sin recorte» por ENTRADA — el
 * flag viaja con el ASSET, no con el chip (el ciclo rotativo §G lo hereda
 * automáticamente): [0] óptima = pipeline completo · [1] b/n as-is ·
 * [2] borrosa as-is · [3] extra as-is.
 * S-6: los src se cargan con `import()` DINÁMICO vía mapa explícito de
 * cargadores — el módulo del asset (StaticImageData) llega asíncrono y el
 * `.src` ya resuelve el basePath /web-scanner del deploy estático.
 */
interface ActaSim {
  /** S-6 — cargador dinámico del asset (resoluble estáticamente). */
  cargar: () => Promise<{ default: { src: string } }>;
  nombre: string;
  sinRecorte: boolean;
}
const ACTAS_SIM: readonly ActaSim[] = [
  {
    cargar: () => import("@/assets/acta-sim-extra-1.jpg"),
    nombre: "acta-sim-extra-1.jpg",
    sinRecorte: false,
  }, // Ola 1/D35: sustituta de la foto real retirada (pipeline completo)
  {
    cargar: () => import("@/assets/acta-sim-intermedia.jpg"),
    nombre: "acta-sim-intermedia.jpg",
    sinRecorte: true,
  },
  {
    cargar: () => import("@/assets/acta-sim-baja.jpg"),
    nombre: "acta-sim-baja.jpg",
    sinRecorte: true,
  },
  {
    cargar: () => import("@/assets/acta-sim-extra-2.jpg"),
    nombre: "acta-sim-extra-2.jpg",
    sinRecorte: true,
  },
];
let actaSimIdx = 0;
interface EntradaSim {
  archivo: File;
  sinRecorte: boolean;
}
const actasSimCache: EntradaSim[] = [];
/** Resuelve el asset del índice (cargador S-6 → fetch → File) con la caché
 *  por índice. ÚNICO camino de carga — antes el fetch+cache estaba duplicado
 *  en fetchActaSimulada y fetchActaSimPorScore. */
async function entradaSimDeActa(idx: number): Promise<EntradaSim> {
  const cache = actasSimCache[idx];
  if (cache) return cache;
  const { default: imagen } = await ACTAS_SIM[idx].cargar();
  const res = await fetch(imagen.src);
  if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
  // File con nombre real del asset (.jpg — evita el camino HEIC).
  const entrada: EntradaSim = {
    archivo: new File([await res.blob()], ACTAS_SIM[idx].nombre, {
      type: "image/jpeg",
    }),
    sinRecorte: ACTAS_SIM[idx].sinRecorte,
  };
  actasSimCache[idx] = entrada;
  return entrada;
}
async function fetchActaSimulada(): Promise<EntradaSim> {
  const idx = actaSimIdx;
  actaSimIdx = (actaSimIdx + 1) % ACTAS_SIM.length;
  return entradaSimDeActa(idx);
}

/**
 * §D3 (SPEC-e14-simulacion-scores): asset FIJO por score de chip — mapeo
 * determinista (la óptima = pipeline completo · la cortada = intermedio ·
 * la borrosa = bajo): 8.2 → acta-sim-extra-1.jpg · 7.0 →
 * acta-sim-intermedia.jpg · 4.3 → acta-sim-baja.jpg. Reutiliza la MISMA
 * caché por índice del ciclo rotativo (§G del PR #33, que queda INTACTO —
 * esta vía solo cambia QUÉ índice se sirve: el del chip, nunca el contador
 * rotativo). El flag sinRecorte del asset viaja con la entrada (§D8.1).
 * (Ola 1/D35: la óptima era la foto real — retirada del repo.)
 */
function indiceActaPorScore(score: number): number {
  if (score >= 8) return 0; // ÓPTIMA [8.2] → la sustituta de la real, pipeline completo
  if (score >= UMBRAL_RECHAZO_SCORE) return 1; // MEDIO [7.0] → la b/n as-is (Rev. 3)
  return 2; // BAJA [4.3] → la borrosa as-is (Rev. 3)
}
async function fetchActaSimPorScore(score: number): Promise<EntradaSim> {
  return entradaSimDeActa(indiceActaPorScore(score));
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

// §X (SPEC-score-legible): piso de legibilidad por contraste.
// §G3 (KIT e14-gate-v2): el PISO de identificación (=10) ELIMINADO — la
// identificación AUTO de la cabecera ya NO fuerza 10/10. El fallo del
// 2026-10-16 (acta SIN votos 10/10 y auto-enviada) nació aquí: el piso se
// aplicaba AL FINAL y mandaba sobre todos los techos. El score llega a 10
// SOLO por métricas reales; los votos los cuida el gate de marcadores
// (./marcadores) y la identificación sigue alimentando SOLO la
// clasificación AUTO del gate (evaluarGate — intocable).
const PISO_CONTRASTE_LEGIBLE = 80; // ≈ excellentQuality().contrast=84 del core

/** §X.1 (SPEC-score-legible): contraste efectivo — una foto de documento
 *  (papel blanco ~85 % del encuadre) tiene dispersión global de luminancia
 *  BAJA POR DISEÑO aunque la tinta sea nítida (evidencia §0.2: metricas=
 *  {sharpness:80 brightness:95 contrast:22} → 6.7 MODERADA de un acta
 *  clasificada AUTO). El contraste global del CRUDO no es evidencia de
 *  ilegibilidad cuando el OCR leyó texto válido → piso de acta legible.
 *  El OCR manda (principio §4.2 extendido).
 *  KIT e14-score-lectura-v1 (C2): el spread de TINTA del papel
 *  (`contrastPapel` — p95−p5 del recorte a hi-res) entra al max: rescata
 *  actas borrosas-pero-legibles SIN depender del binario del OCR. El piso
 *  existente QUEDA dentro del max (pitfall §9.6 — quitarlo es regresión
 *  silenciosa en actas con tinta débil). */
function contrasteEfectivoDe(q: PageQualityV2, ocrLegible: boolean): number {
  return Math.max(q.contrast, q.contrastPapel, ocrLegible ? PISO_CONTRASTE_LEGIBLE : 0);
}

/** Mapeo §4.1: PageQuality del core → score 0-10 (1 decimal) con techos por
 *  level. §X (SPEC-score-legible): recibe señales de legibilidad — OCR válido
 *  y clasificación AUTO (identificación completa). §D1 (SPEC-e14-score-ocr):
 *  `conSenal` extiende el paquete — SIN señal de contenido del acta el score
 *  no describe una digitalización → techo 4.9 («score bajo»). */
function scoreDeCalidad(
  q: PageQualityV2,
  senales?: {
    ocrLegible: boolean;
    identificada: boolean;
    conSenal?: boolean;
    pisoPerfecto?: boolean;
  },
): number {
  const contrasteEf = contrasteEfectivoDe(q, senales?.ocrLegible ?? false);
  // KIT e14-score-lectura-v1 (B2/C1): la nitidez del score v2 es la HI-RES
  // (mediana de 9 tiles del Laplaciano a ~1000px — §4-B1). El 0 del fallback
  // sin señal (degradación §5) cae a la del core (W=120) por el ||.
  const sharpnessV2 = q.sharpnessHi || q.sharpness;
  const bruto = (sharpnessV2 * 0.4 + q.brightness * 0.3 + contrasteEf * 0.3) / 10;
  let score10 = Math.round(bruto * 10) / 10;
  // KIT e14-luz-sim-puntos-v1 (T-D): piso de LECTURA PERFECTA — lectura
  // FUERTE con ≥8/10 anclas + nitidez hi-res ≥90 + tinta de papel ≥75 =
  // evidencia dura de acta bien capturada; el BRILLO bajo (interior/vidrio/
  // sombra) deja de castigar. Va ANTES de los caps (lección §G3: el piso
  // JAMÁS vence a los techos — recortada/incompleta/sin-votos/sin-senal
  // siguen mandando después; aquí el único cap posterior posible es
  // fair/poor y las condiciones ya lo excluyen por construcción).
  if (senales?.pisoPerfecto) score10 = 10;
  let level = q.level;
  if (sharpnessV2 !== q.sharpness || contrasteEf !== q.contrast) {
    // 7.6 (C2-partial): la fórmula (0.45/0.25/0.3) y los umbrales del level
    // (80/62/45) viven ÚNICAMENTE en el paquete (image-processor.ts — la
    // copia manual que había aquí derivaba si el core cambiaba). Mismo
    // recálculo de siempre: solo cambia la ENTRADA (sharpnessV2 +
    // contrasteEfectivo — §3 paso 2 del kit score-lectura).
    level = nivelPorPuntaje(puntajeCalidad(sharpnessV2, q.brightness, contrasteEf));
  }
  if (level === "fair") score10 = Math.min(score10, TECHO_ADVERTENCIA); // techo ADVERTENCIA
  if (level === "poor") score10 = Math.min(score10, UMBRAL_SCORE_INCOMPLETA); // techo RECHAZADA
  // §D1 (SPEC-e14-score-ocr): techo SIN SEÑAL de contenido (AUTO exige tipo
  // leído → implica señal — no colisionan). Fórmulas/techos existentes BYTE
  // A BYTE intactos (§7 prohibido).
  if (senales && !senales.conSenal) score10 = Math.min(score10, TECHO_SIN_SENAL);
  // §G3 (KIT e14-gate-v2): SIN piso por identificación — los techos de
  // arriba y las métricas reales deciden el score; `identificada` (el
  // parámetro sigue llegando) alimenta SOLO la clasificación AUTO del gate
  // (evaluarGate), NUNCA el score.
  return score10;
}

// ── KIT e14-visor-accion-y-score-v1 (FASE S §S.1) ──────────────────────
/** Diagnóstico del recorte de `calidadDeActa` (out-param — mismo patrón del
 *  acumulador `parcial` del pipeline): dimensiones del bbox REAL usado (px)
 *  y si se activó el fallback al frame completo. Alimenta `crop=` en los 2
 *  logs de auditoría (fallback → `crop=full`). */
export interface InfoCrop {
  w: number;
  h: number;
  fallback: boolean;
}

/** Margen del bbox: +3% del PROPIO bbox por lado (clamp [0,1]) — evita
 *  tinta al filo falsa por píxel (§S.1.1). */
const MARGEN_BBOX_PCT = 0.03;
/** Bbox degenerado: lado < 8 px REALES (o NaN/∞) → fallback al frame
 *  completo (§S.1.1 — comportamiento de hoy). */
const BBOX_MIN_PX = 8;
/** Cap del canvas del recorte: lado más largo ≤ 2000 px — NUNCA upscalar
 *  (§S.1.1; evaluateQuality baja a W=120 igual — costo: un drawImage). */
const CROP_LADO_MAX = 2000;

// ── KIT e14-score-lectura-v1 (C1 — nitidez de ALTA resolución) ──────────
/** Lado largo del canvas de análisis hi-res (§3): costo <80 ms; el cap
 *  CROP_LADO_MAX=2000 ya limita el recorte de origen (solo DOWNSCALE —
 *  pitfall §9.1: NUNCA getImageData de la foto 12MP completa). */
const HI_RES_LADO = 1000;
/** MISMA normalización del core (evaluateQuality: σ(Laplaciano)×2.2 cap
 *  100 — cambio solo de resolución, pitfall del kit §4-B1). */
const LAP_NORM = 2.2;
/** Spread de tinta del documento legible típico (§3): papel ~220 − tinta
 *  ~60 = 160 → 100. Normaliza contrastPapel. */
const PAPER_SPREAD_NORM = 160;

/** KIT e14-score-lectura-v1 (§4-B1): PageQuality del core EXTENDIDO con las
 *  2 señales hi-res del recorte. El tipo del core es INTOCABLE (pitfall
 *  §9.7 — nunca modificar el paquete ni redeclarar el import). */
interface PageQualityV2 extends PageQuality {
  /** min(100, mediana de σ(Laplaciano) de 9 tiles 3×3 × 2.2) a ~1000px. */
  sharpnessHi: number;
  /** min(100, (p95−p5 del histograma de luminancia del recorte) × 100/160). */
  contrastPapel: number;
}

/** Señales hi-res del recorte (§4-B1): Laplaciano 4-vecinos sobre gris;
 *  MEDIANA (no promedio — pitfall §9.3: un reflejo especular inflaría el
 *  promedio con su filo) de la varianza de 9 tiles 3×3;
 *  sharpnessHi = min(100, σ_mediana×LAP_NORM). Histograma 256 bins del MISMO
 *  gris para p5/p95 (percentiles por barrido acumulado — pitfall §9.2:
 *  NUNCA sort de ~10⁶ píxeles); contrastPapel = min(100, (p95−p5)×100/160).
 *  Un solo getImageData (willReadFrequently ya existe). Cualquier fallo →
 *  0/0 (el score v2 degrada al comportamiento actual — §5 del kit). */
function senalHiResDeCanvas(
  origen: HTMLCanvasElement | HTMLImageElement,
  wSrc: number,
  hSrc: number,
): { sharpnessHi: number; contrastPapel: number } {
  try {
    const lado = Math.max(wSrc, hSrc);
    if (!lado || !Number.isFinite(lado)) return { sharpnessHi: 0, contrastPapel: 0 };
    // Solo DOWNSCALE (§4-B1/pitfall §9.1): el recorte ya vive a ≤2000px, se
    // deriva a ≤1000; si es más chico se queda tal cual (nunca upscale).
    const escala = Math.min(1, HI_RES_LADO / lado);
    const w = Math.max(1, Math.round(wSrc * escala));
    const h = Math.max(1, Math.round(hSrc * escala));
    const cv = canvasCon(w, h); // SPRINT-A A3 — factory
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { sharpnessHi: 0, contrastPapel: 0 };
    ctx.drawImage(origen, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    // Gris único (luminancia BT.601 como el core) + histograma 256 bins.
    const gris = new Uint8ClampedArray(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
      const g = ((data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000) | 0;
      gris[i] = g;
      hist[g]++;
    }
    // Laplaciano 4-vecinos por tile (3×3 rejilla) → varianza → mediana.
    const tw = Math.max(1, Math.floor(w / 3));
    const th = Math.max(1, Math.floor(h / 3));
    const vars: number[] = [];
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        const x0 = tx * tw;
        const y0 = ty * th;
        const x1 = tx === 2 ? w : x0 + tw;
        const y1 = ty === 2 ? h : y0 + th;
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        for (let y = y0 + 1; y < y1 - 1; y++) {
          for (let x = x0 + 1; x < x1 - 1; x++) {
            const i = y * w + x;
            const lap = gris[i - 1] + gris[i + 1] + gris[i - w] + gris[i + w] - 4 * gris[i];
            sum += lap;
            sumSq += lap * lap;
            n++;
          }
        }
        if (n > 0) vars.push(sumSq / n - (sum / n) * (sum / n));
      }
    }
    // Mediana de ≤9 varianzas (sort trivial — el pitfall §9.2 es del
    // histograma de PÍXELES, no de estos 9 valores).
    vars.sort((a, b) => a - b);
    const medianaVar = vars.length > 0 ? vars[Math.floor(vars.length / 2)] : 0;
    const sharpnessHi = Math.min(100, Math.sqrt(Math.max(0, medianaVar)) * LAP_NORM);
    // p5/p95 por barrido acumulado del histograma (SIN sort — pitfall §9.2).
    const total = w * h;
    let acc = 0;
    let p5 = 0;
    let p95 = 255;
    for (let b = 0; b < 256; b++) {
      acc += hist[b];
      if (acc >= total * 0.05) {
        p5 = b;
        break;
      }
    }
    acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += hist[b];
      if (acc >= total * 0.95) {
        p95 = b;
        break;
      }
    }
    const contrastPapel = Math.min(100, ((p95 - p5) * 100) / PAPER_SPREAD_NORM);
    return { sharpnessHi, contrastPapel };
  } catch {
    return { sharpnessHi: 0, contrastPapel: 0 };
  }
}

/** Bbox del acta en PÍXELES REALES desde el QUAD normalizado 0-1 (misma
 *  convención que ya consumen processImage y verificarCompletitud — TL,TR,BR,
 *  BL en fracciones; NO se inventa conversión nueva). Bbox = min/max de x e y
 *  de los 4 puntos + margen. null si degenerado (NaN/∞ o lado < BBOX_MIN_PX). */
function bboxActaEnPx(
  quad: Quad,
  w: number,
  h: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  if (xs.some((v) => !Number.isFinite(v)) || ys.some((v) => !Number.isFinite(v))) {
    return null;
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = (maxX - minX) * MARGEN_BBOX_PCT;
  const padY = (maxY - minY) * MARGEN_BBOX_PCT;
  const x0 = Math.max(0, minX - padX);
  const x1 = Math.min(1, maxX + padX);
  const y0 = Math.max(0, minY - padY);
  const y1 = Math.min(1, maxY + padY);
  const sx = Math.round(x0 * w);
  const sy = Math.round(y0 * h);
  const sw = Math.round((x1 - x0) * w);
  const sh = Math.round((y1 - y0) * h);
  if (sw < BBOX_MIN_PX || sh < BBOX_MIN_PX) return null;
  return { sx, sy, sw, sh };
}

/** FASE S (§S.0 — diagnóstico cerrado): el score ya NO mide la MESA — mide
 *  el ACTA. `evaluateQuality` del core (paquete INTOCABLE) baja a W=120 sobre
 *  TODO el encuadre: el acta vertical deja el papel en ~25-40% del cuadro y
 *  la mesa oscura manda en el promedio (brightness 24-34 → peor métrica →
 *  chip LUMINOSIDAD → 7.0-7.7 ADVERTENCIA en actas perfectas; la MISMA acta
 *  sin fondo da 9.0). Helper: decodifica `fotoOriginal`, recorta el bbox del
 *  quad (+3% por lado, clamp [0,1]) a canvas (cap 2000 px el lado largo —
 *  nunca upscalar) y evalúa ESE recorte (ImageSource acepta
 *  HTMLCanvasElement — core image-processor). Fallback conservador: bbox
 *  degenerado o cualquier fallo de decode/canvas → `evaluateQuality(
 *  fotoOriginal)` como hoy (frame completo). SIM sinRecorte (quad identidad):
 *  bbox = frame completo → mismo camino; los chips SIM siguen INYECTADOS
 *  (8.2/7.0/4.3 — §D3, no-regresión dura AC-S2). */
async function calidadDeActa(
  fotoOriginal: string,
  quad: Quad,
  info?: InfoCrop,
): Promise<PageQualityV2> {
  const marcarFallback = () => {
    if (info) {
      info.fallback = true;
      info.w = 0;
      info.h = 0;
    }
  };
  try {
    const img = await loadImageMemo(fotoOriginal);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error("sin dimensiones");
    const bbox = bboxActaEnPx(quad, w, h);
    if (!bbox) throw new Error("bbox degenerado");
    const escala = Math.min(1, CROP_LADO_MAX / Math.max(bbox.sw, bbox.sh));
    const cw = Math.max(1, Math.round(bbox.sw * escala));
    const ch = Math.max(1, Math.round(bbox.sh * escala));
    const canvas = canvasCon(cw, ch); // SPRINT-A A3 — factory
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("sin ctx");
    ctx.drawImage(img, bbox.sx, bbox.sy, bbox.sw, bbox.sh, 0, 0, cw, ch);
    if (info) {
      info.fallback = false;
      info.w = bbox.sw;
      info.h = bbox.sh;
    }
    const calidad = await evaluateQuality(canvas);
    // KIT e14-score-lectura-v1 (C1): señales hi-res del MISMO recorte ya
    // dibujado (downscale a 1000px — un solo getImageData, <80 ms §3).
    const extra = senalHiResDeCanvas(canvas, cw, ch);
    return { ...calidad, ...extra };
  } catch {
    marcarFallback();
    const q = await evaluateQuality(fotoOriginal);
    // Fallback (§4-B1): señales hi-res del FRAME vía el MISMO helper (el
    // drawImage del helper ya escala a 1000 — nunca getImageData de 12MP);
    // si falla también → 0/0: el score v2 degrada al comportamiento actual.
    try {
      const img = await loadImageMemo(fotoOriginal);
      const extra = senalHiResDeCanvas(img, img.naturalWidth, img.naturalHeight);
      return { ...q, ...extra };
    } catch {
      return { ...q, sharpnessHi: 0, contrastPapel: 0 };
    }
  }
}

/**
 * KIT identificacion-codigo-v1 (FASE F): marcas fiduciales de esquina sobre
 * la FOTOPROCESADA (el warp del core ya la enderezó y recortó al acta — el
 * mismo contenido que evalúa calidadDeActa; ADAPTACIÓN documentada: el kit
 * dice «crop ya enderezado, mismo input que calidadDeActa» y fotoProcesada
 * ES ese crop sin duplicar lógica de recorte).
 * Devuelve null cuando NO se pudo medir (decode fallido / sin foto): la
 * política del repo es «sin señal honesta no se condena» — null JAMÁS marca
 * recorte (mismo espíritu que página desconocida en faltaSeccionInferior).
 */
async function esquinasDeActa(foto: string | undefined): Promise<EsquinasActa | null> {
  if (!foto) return null;
  try {
    const img = await loadImageMemo(foto);
    const canvas = canvasCon(img.naturalWidth, img.naturalHeight); // SPRINT-A A3 — factory
    if (!canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return marcasEsquina(canvas);
  } catch {
    return null;
  }
}

/**
 * KIT consenso-frankfurt-v1 (FASE 4, §5): segunda pasada OCR DIRIGIDA del
 * sello de la banda — el sello TRANSMISIÓN es BLANCO-sobre-negro y tesseract
 * (psm6, página completa) NO lo lee: 0 menciones en la captura de Frankfurt
 * 746 (§0-F4). Recorta la franja de la banda (x 22-88% · y 3-13% — la banda
 * vive bajo el encabezado), la INVIERTE (255-lum → tinta oscura sobre claro,
 * la geometría del sello se vuelve legible) y la escala ×2 antes del OCR
 * del core. Corre UNA sola vez y SOLO cuando `tipoDeBanda(texto)` es null
 * (presupuesto ~1-3 s, dentro del TIMEOUT_MS de 15 s del core — si venció,
 * se descarta igual). NO re-OCR del acta completa. Fallo → "" (sin banda
 * nueva: la cascada sigue con el d9 del consenso — nunca condena).
 */
// SPRINT-A (perf/decode-once-v1) A4: las dead stores ultimoOcrConf/Det/Rec
// (PROD-2 §4-C5) fueron eliminadas — se escribían 9× y NUNCA se leían
// (knip + review 23-oct; sin anclas en scripts/qa-*.ts). La traza real del
// motor vive en las líneas ocr=rapidocr de los pipelines, que capturan
// conf/det/rec de ocrEsc directamente (confOcr/detOcr/recOcr — vivas).
/** Motor de producción (PROD-2): RapidOCR PP-OCRv4 sobre el recorte original.
 *  Mismo contrato que requestOcr: texto + progreso 0→1. Sin fallback de motor
 *  (pitfall §9.3): el fallo sigue el mismo camino controlado de hoy (§5 del
 *  kit — texto vacío → gate decide). */
async function reconocerRapidOcr(
  dataUrl: string,
  onProgress?: (p: number) => void,
): Promise<string> {
  const rt = await rapidOcrInit(); // singleton de sesión (pre-warm en bg)
  const r = await rapidOcrReconocer(rt, dataUrl, onProgress);
  return r.texto;
}

/** OCR principal de un pipeline — KIT e14-ocr-escalonado-v1 (§2): 1.ª pasada
 *  con det cap RÁPIDO (1280, ~0.44× del det) → si la lectura sale débil,
 *  re-OCR completo a 1920 y QUEDARSE CON EL MEJOR (anclas de ANCLAS_LECTURA,
 *  luego conf — NUNCA automáticamente la 2.ª, §2.4). Sesión ÚNICA (§2.1): el
 *  cap es del preprocess (op4), no del modelo — el singleton no cambia.
 *  · SIM: OMITIDO (§3) — flujo de hoy a 1920, UNA pasada, 0 trazas (chips
 *    8.2/7.0/4.3 intactos por construcción).
 *  · Presupuesto (§3): el timeout EXISTENTE del pipeline manda — si la 1.ª
 *    pasada lo consume, NO hay 2.ª (sin presupuestos nuevos).
 *  · Progreso (§3): la 2.ª pasada reusa el MISMO emit de OCR (ANALIZANDO no
 *    se queda colgado).
 *  · Traza (§2.5) en línea PROPIA — append-only, parseable por el rastreador
 *    (sin línea en SIM):
 *      [e14] ocr-escalonado pasada1=1280 lectura=DEBIL reocr=1 elegido=1920 anclas1=2 anclas2=9 ms1=8200 ms2=14100
 *      [e14] ocr-escalonado pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=7 ms1=8200
 *  El downstream (banda condicional, clasificación, gate, diagnostico)
 *  consume SOLO el texto elegido (§2.4) — el caller recibe el texto ya
 *  resuelto y las métricas de la pasada elegida (SPRINT-A A4: la referencia
 *  a ultimoOcr* fue removida con sus dead stores). */
interface OcrEscalonadoSalida {
  texto: string;
  conf: number | null;
  detMs: number;
  recMs: number;
  /** KIT e14-remediacion-movil-v1 — traza de la CASCADA (qué pasadas se pagaron y
   *  cuánto). Aditiva: el escalonado de siempre y SIM no la llenan (n/d). */
  traza?: TrazaOcr;
  /** FASE C (medición §6.7) — resumen de la corrida para `PerfActa.lectura`:
   *  motor aceptante, intentos con gate y ms por motor. Solo la cascada lo
   *  llena (el escalonado de siempre / SIM quedan sin telemetría nueva). */
  lectura?: ResumenLectura;
  /** KIT e14-remediacion-movil-v1 (B3 — P1 #9): tramos del OCR sin atribuir
   *  que la 2.ª pasada del escalonado pagaba FUERA de la cascada (el hueco
   *  medido de 9,5-11,5 s). msCrops = recortes (pasada 1 + 2.ª); msSegundaPasada
   *  = la 2.ª completa (ms2 del re-OCR 1920 o msRoi del rescate ROI). SIM no
   *  lo llena (0 trazas — §3). */
  tramos?: {
    msCrops?: number | null;
    msSegundaPasada?: number | null;
  };
}

/** Trazas de la cascada — el acta dice desde IndexedDB cuántas pasadas se
 *  pagaron (antes solo lo decía una logger.info que el build de producción
 *  recorta: en campo el OCR era un agujero de 6 s sin explicación). */
export interface TrazaOcr {
  /** "intento1" | "1280" | "1920" | "roi" | "rescate-motor" — dónde quedó. */
  paso: string;
  /** cap de la pasada ELEGIDA (1280 | 1920 | "roi" | "tess"). */
  elegidoCap: string;
  motorIntento1: string;
  msIntento1: number;
  ms1280: number | null;
  ms1920: number | null;
  msRoi: number | null;
  msMotor: number | null;
  /** true = el rescate ROI entró a elegirMejor (gane o pierda). */
  rescate: boolean;
  /** det/rec de la pasada ELEGIDA (0 = n/d si el motor no separa). */
  detMs: number;
  recMs: number;
  /** Tamaño de la pasada ELEGIDA — el rec es casi lineal en nLineas×W; sin
   *  esto el acta no explica por qué un rec cuesta 3.5 s y otro 6 s. */
  nBoxes: number;
  nLineas: number;
  /** ms esperando el run() del rec (wasm + IPC con el worker del proxy);
   *  `recMs − msRunRec` = hilo principal (tensores + CTC decode). */
  msRunRec: number;
}

/** Pasada con métricas para elegirMejor (§2.4) — el ganador viaja por
 *  REFERENCIA con su cap (1280|1920) para la traza elegido=. */
interface PasadaEscalonada {
  texto: string;
  conf: number;
  detMs: number;
  recMs: number;
  cap: number;
}

async function reconocerRapidOcrEscalonado(
  fotoOcr: string,
  onProgress: (p: number) => void,
  escalonado: {
    /** true → SIM: flujo de hoy a 1920, una pasada, 0 trazas (§3). */
    simular: boolean;
    /** Presupuesto del pipeline (timeout EXISTENTE, §3 — sin nuevos). */
    presupuestoMs: number;
    /** performance.now del INICIO del pipeline (base del presupuesto). */
    inicioMs: number;
    /** KIT e14-velocidad-5s-v1 — la ORIENTACIÓN ya está decidida por otra
     *  señal (brújula QR). El sondeo cls del motor (¿esta línea va boca
     *  abajo?) responde la MISMA pregunta del cuadrante del QR; con true se
     *  omite en TODAS las pasadas de esta llamada. Ausente/false = hoy. */
    orientacionDecidida?: boolean;
    /** KIT e14-velocidad-5s-v1 — RECHAZO TEMPRANO: el veredicto ya está
     *  bloqueado antes del OCR (ver `rechazoTemprano` en el pipeline), así que
     *  la 2.ª pasada no puede cambiar el desenlace. true = no escalar. */
    corteIncompleta?: boolean;
  },
): Promise<OcrEscalonadoSalida> {
  const rt = await rapidOcrInit(); // sesión ÚNICA (§2.1 — pre-warm en bg)
  const omitirCls = escalonado.orientacionDecidida === true;
  if (escalonado.simular) {
    // SIM: EXACTAMENTE el flujo de hoy (det 1920, una pasada, 0 trazas).
    const r = await rapidOcrReconocer(rt, fotoOcr, onProgress);
    return { texto: r.texto, conf: r.confMedia, detMs: r.msDet, recMs: r.msRec };
  }
  // 1.ª pasada — det cap RÁPIDO (1280) → cls → rec (igual que hoy, §2.2).
  const t1 = performance.now();
  const r1 = await rapidOcrReconocer(rt, fotoOcr, onProgress, {
    detCap: DET_CAP_RAPIDO,
    omitirCls,
    sinRescateBordes: escalonado.corteIncompleta === true,
  });
  const ms1 = Math.round(performance.now() - t1);
  const senal1 = senalDeLectura(r1.texto);
  // §2.3 decisión + §3 presupuesto (el timeout existente manda): vencido →
  // NO hay 2.ª (mismo desenlace que hoy: el timeout del pipeline resuelve).
  // KIT e14-gama-baja-20s-v1 — knobs del plan adaptativo (SYNC, barato):
  // en BAJO el intento extra se acota a su PROPIO presupuesto pared
  // (ocrSegundaPresupuestoMs = 15000) y cambia el MODO del 2.º intento
  // (rescate ROI cabecera en vez del re-OCR 1920 completo). MEDIO/ALTO y
  // adaptación OFF ⇒ histórico byte a byte (null = sin tope adicional —
  // manda el presupuesto EXISTENTE del pipeline, §3 del kit escalonado).
  const planOcr = planAdaptativo();
  // KIT e14-velocidad-5s-v1 — DOS perillas de la escalada (A/B por override, sin
  // tocar el plan de hardware). La evidencia del corpus (2026-11-05, A56): en
  // 084939 la 1.ª pasada con rescate interno costó 4,78 s y AUNQUE NO SALIÓ
  // FUERTE el re-OCR 1920 (+3,99 s) y el ROI (+3,37 s) tampoco cambiaron el
  // desenlace — acabó en REVISIÓN HUMANA con el mismo texto. Es decir: en las
  // fotos duras el multiplicador no es el motor, es la ESCALADA que corre por
  // inercia. `ocrSegundaTopeMs` (>0) pone el tope PARED que el tier MEDIO/ALTO
  // no trae; `ocrReOcrRoi` fuerza el rescate ROI-cabecera (franja 0-25 % a cap
  // 1920, ~1/2,5 del re-OCR completo) aunque el plan diga "completo".
  const fEscalada = leerFlags();
  const modoReOcr =
    fEscalada.ocrReOcrRoi || (planOcr.adaptado && planOcr.ocrReOcrModo === "roi-cabecera")
      ? "roi-cabecera"
      : "completo";
  const presupuestoSegunda =
    fEscalada.ocrSegundaPresupuestoMs != null && fEscalada.ocrSegundaPresupuestoMs > 0
      ? Math.min(escalonado.presupuestoMs, fEscalada.ocrSegundaPresupuestoMs)
      : fEscalada.ocrSegundaTopeMs > 0
        ? Math.min(escalonado.presupuestoMs, fEscalada.ocrSegundaTopeMs)
        : planOcr.adaptado && planOcr.ocrSegundaPresupuestoMs != null
          ? Math.min(escalonado.presupuestoMs, planOcr.ocrSegundaPresupuestoMs)
          : escalonado.presupuestoMs;
  // KIT e14-remediacion-movil-v1 (A1 — P0 #1/#2): CONDICIÓN DE ARRANQUE CON
  // MARGEN REAL. La condición vieja solo preguntaba cuánto llevaba el
  // pipeline (`transcurrido < ventana`) — NADA limitaba cuánto iba a DURAR
  // la pasada en vuelo: en el A13 una 2.ª completa arrancaba «con margen» a
  // los 35 s y terminaba DESPUÉS del watchdog de 120 s → RECHAZADA 0.0 de un
  // acta legible (informe §5). Ahora la pasada SOLO se abre si su coste
  // ESTIMADO cabe en el presupuesto restante:
  //   arrancar si (k · ms1) < (presupuesto − transcurrido − margen)
  // · k según MODO (medido en el A13): 2.5 re-OCR completo · 1.2 ROI-cabecera
  //   (su coste ≈ ms1 — NO se reusa el 2.5 del modo completo).
  // · margen 8 s: lo que queda por pagar tras el OCR (gate + clasificación +
  //   banda + emisión) antes del watchdog.
  // Respeta la decisión de proyecto «nunca se abandona una pasada a mitad»
  // (docs/REPORTE-e14-gama-baja-20s-v1): aquí no se aborta nada — se decide
  // NO ABRIR la pasada que no cabe. Toda apertura tardía que aun así venciera
  // queda MEDIDA (B1 emite la muestra `vencido: true` desde el watchdog).
  const K_SEGUNDA_COMPLETO = 2.5; // A13: re-OCR 1920 ≈ 2,5× la 1.ª pasada
  const K_SEGUNDA_ROI = 1.2; // A13: ROI cabecera ≈ 1,0-1,2× la 1.ª pasada
  const MARGEN_SEGUNDA_MS = 8_000;
  const transcurridoAlDecidir = performance.now() - escalonado.inicioMs;
  const kSegunda = modoReOcr === "roi-cabecera" ? K_SEGUNDA_ROI : K_SEGUNDA_COMPLETO;
  const costeEstimadoSegunda = Math.round(ms1 * kSegunda);
  const tocaSegunda =
    necesitaSegunda(r1.texto) &&
    escalonado.corteIncompleta !== true &&
    transcurridoAlDecidir < presupuestoSegunda &&
    costeEstimadoSegunda <
      escalonado.presupuestoMs - transcurridoAlDecidir - MARGEN_SEGUNDA_MS;
  let elegido: PasadaEscalonada = {
    texto: r1.texto,
    conf: r1.confMedia,
    detMs: r1.msDet,
    recMs: r1.msRec,
    cap: DET_CAP_RAPIDO,
  };
  let ms2: number | null = null;
  let anclas2: number | null = null;
  // B3 — acumulador de tramos mudos (crops de la 1.ª + los de la 2.ª si abre).
  let msCropsTotal = r1.msCrops;
  let msSegundaPasada: number | null = null;
  if (tocaSegunda) {
    if (modoReOcr === "roi-cabecera") {
      // KIT e14-gama-baja-20s-v1 — rescate ROI CABECERA: franja top 0-25%
      // re-escalada a cap 1920 (MISMO helper y fracciones de la cascada K3 —
      // recortarRoiDataUrl + ROI_FRACCIONES.top) en vez del re-OCR 1920
      // COMPLETO. En gama baja el re-OCR completo cuesta ~2.5× la 1.ª pasada
      // (det ≈ (1920/1280)² + cls + rec de TODO el acta) y es el
      // multiplicador dominante del pipeline (126 s low-end mono-hilo,
      // sim-recursos). El candidato compuesto (cabecera del ROI + cuerpo de
      // la 1.ª pasada) se adopta SOLO si AÑADE anclas (`rescateAporta` —
      // información puramente aditiva; conf de la pasada BASE). JAMÁS
      // tumba: cualquier fallo del crop/OCR → r1 queda como está.
      const tR = performance.now();
      const roiUrl = await recortarRoiDataUrl(
        fotoOcr,
        ROI_FRACCIONES.top[0],
        ROI_FRACCIONES.top[1],
      );
      let msRoi = Math.round(performance.now() - tR);
      let adoptado = 0;
      if (roiUrl) {
        try {
          const rRoi = await rapidOcrReconocer(rt, roiUrl, onProgress);
          msRoi = Math.round(performance.now() - tR);
          msCropsTotal += rRoi.msCrops; // B3 — crops de la 2.ª (ROI)
          const texto2 =
            rRoi.texto.trim().length > 0
              ? rRoi.texto.trim() + "\n" + r1.texto.trim()
              : r1.texto;
          anclas2 = anclasDe(texto2);
          if (rescateAporta(r1.texto, texto2)) {
            elegido = {
              texto: texto2,
              conf: r1.confMedia, // conf de la pasada BASE — conservador
              detMs: r1.msDet,
              recMs: r1.msRec,
              cap: DET_CAP_RAPIDO,
            };
            adoptado = 1;
          }
        } catch {
          /* fallo del rescate → r1 queda como está (jamás tumba) */
        }
      }
      // Traza PROPIA (línea NUEVA — los parsers de ocr-escalonado intactos;
      // la línea de abajo sigue imprimiendo reocr=0 elegido=1280 en este modo).
      msSegundaPasada = msRoi; // B3 — la 2.ª de este modo ES el rescate ROI
      logger.info(
        `[e14] ocr-rescate-cabecera y0=${ROI_FRACCIONES.top[0]} y1=${ROI_FRACCIONES.top[1]} ` +
          `ms=${msRoi} anclas1=${anclasDe(r1.texto)} anclas2=${anclas2 ?? "-"} adoptado=${adoptado}`,
      );
    } else {
      // 2.ª pasada — det cap PROD (1920) → cls → rec (§2.4); MISMO emit de
      // progreso (§3). Elegir el MEJOR — NUNCA automáticamente la 2.ª.
      const t2 = performance.now();
      const r2 = await rapidOcrReconocer(rt, fotoOcr, onProgress, {
        detCap: DET_CAP_PROD,
        omitirCls,
      });
      ms2 = Math.round(performance.now() - t2);
      msCropsTotal += r2.msCrops; // B3 — crops de la 2.ª (completa)
      msSegundaPasada = ms2; // B3
      anclas2 = anclasDe(r2.texto);
      const ganadora = elegirMejor(
        { texto: r1.texto, conf: r1.confMedia, detMs: r1.msDet, recMs: r1.msRec, cap: DET_CAP_RAPIDO },
        { texto: r2.texto, conf: r2.confMedia, detMs: r2.msDet, recMs: r2.msRec, cap: DET_CAP_PROD },
      );
      elegido = ganadora; // MISMA referencia — la ganadora trae sus métricas
    }
  }
  // Traza propia (§2.5 — línea PROPIA, append-only; SIN línea en SIM).
  // KIT e14-remediacion-movil-v1 (A1): tokens ADITIVOS AL FINAL de la
  // decisión de arranque (los parsers conocidos solo leen hasta anclas2/ms2):
  // ventana (tope pared del intento extra) · est (k·ms1 estimado) · abre.
  logger.info(
    `[e14] ocr-escalonado pasada1=${DET_CAP_RAPIDO} lectura=${senal1.nivel} ` +
      `reocr=${ms2 != null ? 1 : 0} elegido=${elegido.cap} anclas1=${anclasDe(r1.texto)}` +
      (ms2 != null
        ? ` anclas2=${anclas2} ms1=${ms1} ms2=${ms2}`
        : ` ms1=${ms1}`) +
      (escalonado.corteIncompleta === true ? " corte=1" : "") +
      ` ventana=${presupuestoSegunda} k=${kSegunda} est=${costeEstimadoSegunda} abre=${tocaSegunda ? 1 : 0}`,
  );
  return { texto: elegido.texto, conf: elegido.conf, detMs: elegido.detMs, recMs: elegido.recMs, tramos: { msCrops: msCropsTotal, msSegundaPasada: msSegundaPasada } };
}

/**
 * KIT e14-ocr-cascada-v1 (K3 fase 2 — plan flujo-mantenedor paso 6) — recorte de
 * UN ROI del warp para el rescate OCR: franja horizontal [y0Frac, y1Frac]
 * re-escalada a cap DET_CAP_PROD (1920 — brief K3: «re-escalado a cap 1920»)
 * → dataUrl JPEG 0.92 (entrada de OCR, tolerante; el MISMO patrón de crop
 * invertido de ocrBanda §5). SOLO corre tras el warp full-res (la entrada
 * es fotoOcr — el recorte SIN filtro del PROD-1 §4.1). JAMÁS lanza: null =
 * el ROI se descarta y la cascada continúa (doctrina del conservador).
 */
async function recortarRoiDataUrl(
  foto: string,
  y0Frac: number,
  y1Frac: number,
): Promise<string | null> {
  try {
    const img = await loadImageMemo(foto);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return null;
    const y0 = Math.round(Math.max(0, Math.min(1, y0Frac)) * H);
    const y1 = Math.round(Math.max(0, Math.min(1, y1Frac)) * H);
    const hSrc = Math.max(1, y1 - y0);
    // Re-escalado a cap 1920 del lado largo (el ROI lejos del cap remonta
    // resolución de lectura — brief K3 fase 1, cascadas B/C).
    const escala = Math.min(1, DET_CAP_PROD / Math.max(W, hSrc));
    const wDst = Math.max(1, Math.round(W * escala));
    const hDst = Math.max(1, Math.round(hSrc * escala));
    const canvas = canvasCon(wDst, hDst); // SPRINT-A A3 — factory
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, y0, W, hSrc, 0, 0, wDst, hDst);
    // 7.1: CALIDAD_JPEG_REVISION (0.92) desde politica/umbrales.ts.
    return canvas.toDataURL("image/jpeg", CALIDAD_JPEG_REVISION);
  } catch {
    return null; // jamás tumba — el rescate se descarta
  }
}

/**
 * KIT e14-ocr-cascada-v1 (K3 fase 2) + GO-B — la CASCADA en el pipeline,
 * SOLO con `leerFlags().ocrCascada` ON (default ON — decisión del mantenedor
 * 2026-11; kill-switch override {"ocrCascada": false} ⇒ esta función nunca
 * se invoca y el camino es `reconocerRapidOcrEscalonado` byte a byte):
 *
 *   intento 1 (TESSERACT BEST — ocr/tesseract.ts, vendido, worker propio,
 *   budget 60 s capado al restante del pipeline) → GATE (clasificador
 *   puro, nivel AUTO) ⇒ listo; Tess fallo/vencido ⇒ RapidOCR 1280 de
 *   siempre como intento 1 (reusable); si no AUTO ⇒ core RapidOCR COMO
 *   HOY (1280 → necesitaSegunda → 1920 → elegirMejor); si débil y sin
 *   AUTO ⇒ rescate por ROIs top 0-25% / bottom 75-100% (cap 1920) →
 *   elegirMejor SOLO entre pasadas RapidOCR (entre motores decidió el
 *   GATE).
 *
 * El GATE usa el clasificador REAL de producción (clasificarCabecera +
 * cargarDivipol — el MISMO juez que decide el acta más abajo en el
 * pipeline, FASE 6). GO-B OTORGADO (mantenedor 2026-11: «dejemos como primer
 * motor de ocr tess best y escalonado a pp ocr»): `ocr/tesseract.ts`
 * (tesseract.js 5 vendido, worker propio — JAMÁS main thread) hace el
 * intento 1 con texto SOLO-vía-GATE (jamás elegirMejor) + budget propio
 * (dato del banco K3: 60 000 ms — decisión D76); cae honesto a
 * RapidOCR 1280 (pasada motor:"rapidocr" — la cascada la REUSA y el
 * escalonado a PP-OCR sigue byte a byte).
 */
const OCR_CASCADA_TESSERACT_GO = true; // GO-B del mantenedor (2026-11) — kill-switch: flag `ocrCascada` OFF
/** KIT e14-velocidad-5s-v1 — pasada Tesseract best (worker propio de la lib).
 *  El texto vale SOLO por el GATE (jamás `elegirMejor` — regla §1 del kit
 *  cascada). null = no disponible (presupuesto corto, lib rota, sin texto):
 *  el caller sigue con lo que tenga; jamás tumba el pipeline. */
async function tessPasadaParaGate(
  foto: string,
  cfg: { presupuestoMs: number; inicioMs: number },
): Promise<PasadaCascada | null> {
  const restante = cfg.presupuestoMs - (performance.now() - cfg.inicioMs);
  try {
    // tessReconocer decide sola: vence si el restante no alcanza el mínimo
    // honesto (< 20 s — falla segura), la CREACIÓN lleva presupuesto propio de
    // 180 s (descarga vendida de la 1.ª vez) capado por este restante, y la
    // recognize 60 s (bench).
    const r = await tessReconocer(foto, restante);
    logger.info(`[e14] tess-best ok conf=${r.conf.toFixed(2)} chars=${r.texto.length}`);
    return { texto: r.texto, conf: r.conf, cap: "tess", motor: "tesseract" };
  } catch (e) {
    logger.warn("[e14] tess-best no disponible", {
      motivo: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
async function reconocerRapidOcrCascada(
  fotoOcr: string,
  onProgress: (p: number) => void,
  cfg: {
    presupuestoMs: number;
    inicioMs: number;
    orientacionDecidida?: boolean;
    /** KIT e14-velocidad-5s-v1 — RECHAZO TEMPRANO: con el veredicto bloqueado
     *  antes del OCR, el presupuesto restante se declara vencido (la cascada
     *  cobra SU 1.ª pasada y para: ni re-OCR 1920, ni ROI, ni motor de rescate
     *  — ninguna de ellas puede volver completa un acta que el guard ya
     *  condenó con geometría + fiduciales). */
    corteIncompleta?: boolean;
  },
): Promise<OcrEscalonadoSalida> {
  const rt = await rapidOcrInit(); // sesión ÚNICA (§2.1 — pre-warm en bg)
  const base = await cargarDivipol(); // cacheada — 0 costo tras la 1.ª
  // KIT e14-velocidad-5s-v1 — ORDEN de la cascada. Flag ON (default): el
  // INTENTO 1 es la pasada RÁPIDA de RapidOCR (det 1280) y Tesseract best
  // queda como RESCATE final, solo para el acta que esa pasada no ubicó.
  // Flag OFF ⇒ GO-B del mantenedor de siempre (Tess primero). El TEXTO elegido es
  // el mismo en los dos órdenes: entre motores siempre decidió el GATE.
  const rapidaPrimero = leerFlags().ocrPrimeraPasadaRapida === true;
  // KIT e14-velocidad-5s-v1 — la brújula QR ya fijó el cuadrante del acta:
  // el sondeo cls (¿línea boca abajo?) responde la MISMA pregunta con menos
  // evidencia, así que se omite en TODAS las pasadas de esta cascada.
  const omitirCls = cfg.orientacionDecidida === true;
  const rapid = (foto: string, cap: number): Promise<PasadaCascada> =>
    rapidOcrReconocer(rt, foto, onProgress, {
      detCap: cap,
      omitirCls,
      sinRescateBordes: cfg.corteIncompleta === true,
    }).then((r) => ({
      ...aPasada(r, cap),
      motor: "rapidocr" as const,
    }));
  const rapid1280 = (foto: string): Promise<PasadaCascada> => rapid(foto, DET_CAP_RAPIDO);
  // GATE = el clasificador REAL de prod (mismo juez, FASE 6 del pipeline).
  const clasificarNivel = (texto: string): "AUTO" | "SUGERIDA" | "MANUAL" =>
    clasificarCabecera(texto, base).nivel;
  const aPasada = (
    r: Awaited<ReturnType<typeof rapidOcrReconocer>>,
    cap: number | "roi",
  ): PasadaCascada => ({
    texto: r.texto,
    conf: r.confMedia,
    cap,
    msDet: r.msDet,
    msRec: r.msRec,
    nBoxes: r.nBoxes,
    nLineas: r.lineas.length,
    msRunRec: r.msRunRec,
  });
  // FASE C (medición §6.7): el sink REAL de la telemetría ya existe en el
  // paquete — aquí se colecta por acta y el resumen viaja al perf.
  const colector = colectorLectura();
  const deps: DepsOcrCascada = {
    intento1: async (foto) => {
      // D88 (2026-11-10) — default OFF: el intento 1 es Tesseract fast y la
      // pasada RÁPIDA de RapidOCR queda de respaldo (código debajo intacto).
      // RECHAZO TEMPRANO: con el veredicto bloqueado el orden manda poco, pero
      // el motor de rescate NO se paga — Tess es 20-60 s de presupuesto para un
      // acta que ya es RECHAZADA; acá se va directo por la rápida.
      if (rapidaPrimero || cfg.corteIncompleta === true) return rapid1280(foto);
      // GO-B (mantenedor 2026-11): TESSERACT BEST primero (worker propio de la
      // lib, budget capado al restante del pipeline) → su texto vale SOLO
      // por el GATE. Cualquier fallo/vencido/sin-presupuesto-suficiente ⇒
      // RapidOCR 1280 de SIEMPRE («escalonado a pp ocr») — pasada marcada
      // motor:"rapidocr" para que la cascada la REUSE como 1.ª pasada
      // (jamás se paga dos veces la misma pasada del mismo motor).
      if (OCR_CASCADA_TESSERACT_GO) {
        const p = await tessPasadaParaGate(foto, cfg);
        if (p) return p;
      }
      return rapid1280(foto);
    },
    mismoMotorIntento1: !OCR_CASCADA_TESSERACT_GO || rapidaPrimero,
    ocr1280: rapid1280,
    ocr1920: async (foto) => rapid(foto, DET_CAP_PROD),
    // ROI a cap PROD (1920) — brief K3: «RapidOCR sobre ROIs re-escalados a
    // cap 1920». Sin opts = detCap default DET_CAP_PROD (rapidocr.ts).
    ocrRoi: async (roiDataUrl) => rapid(roiDataUrl, DET_CAP_PROD),
    recortarRoi: recortarRoiDataUrl,
    clasificarNivel,
    // KIT e14-velocidad-5s-v1 — Tesseract best SOLO como rescate final: el
    // acta que el core RapidOCR no ubicó (gate ≠ AUTO) puede salvarla otro
    // motor. Con el intento 1 rápido, el caso fácil NUNCA lo paga.
    rescateMotor: rapidaPrimero
      ? (foto) => tessPasadaParaGate(foto, cfg)
      : undefined,
    // KIT e14-remediacion-movil-v1 (D6 — P2 #12): deps del rescate QUE APORTA.
    // anclasFaltantes: campos del GATE aún sin leer (dep/mun/zon/puesto/mesa
    // contados con el MISMO clasificador de producción — si ya están todos,
    // ningún texto cambia el desenlace y el rescate no se paga).
    anclasFaltantes: (texto) => {
      const c = clasificarCabecera(texto, base);
      let faltan = 0;
      if (!c.departamento) faltan++;
      if (!c.municipio) faltan++;
      if (!c.zona) faltan++;
      if (!c.puesto) faltan++;
      if (c.mesa === null) faltan++;
      return faltan;
    },
    // presupuestoRestanteMs: la MISMA señal del presupuestoVencido (cfg),
    // pero en ms — el rescate midió 11-13 s (RESCATE_COSTE_ESPERADO_MS).
    presupuestoRestanteMs: () =>
      cfg.presupuestoMs - (performance.now() - cfg.inicioMs),
    // Presupuesto EXISTENTE del pipeline (§3 del kit escalonado — sin
    // presupuestos nuevos). RECHAZO TEMPRANO: se declara vencido de entrada,
    // que es exactamente lo que significa «quedan 0 s de OCR por cobrar» — las
    // tres escaladas (1920, ROI, rescate de motor) ya están guardadas por esta
    // misma señal en el módulo puro, sin regla nueva.
    presupuestoVencido: () =>
      cfg.corteIncompleta === true ||
      performance.now() - cfg.inicioMs >= cfg.presupuestoMs,
    onEvento: colector.sink,
  };
  const s = await correrCascadaOcr(fotoOcr, deps);
  // Traza PROPIA (D51 — línea nueva, SOLO con flag ON; parseable).
  const ms1 = s.ms1280 != null ? s.ms1280 + s.msIntento1 : s.msIntento1;
  logger.info(
    `[e14] ocr-cascada intento1=${s.motorIntento1 === "tesseract" ? "tess-best" : DET_CAP_RAPIDO} ` +
      `gate1=${s.paso === "intento1" ? "AUTO" : "NO"} elegido=${s.elegidoCap} ` +
      `rescate=${s.rescate ? 1 : 0} ms1=${ms1}` +
      (s.ms1920 != null ? ` ms2=${s.ms1920}` : " ms2=-") +
      (s.msRoi != null ? ` msRoi=${s.msRoi}` : " msRoi=-") +
      (s.msMotor != null ? ` msMotor=${s.msMotor}` : " msMotor=-") +
      (cfg.corteIncompleta === true ? " corte=1" : ""),
  );
  // El downstream (banda condicional, clasificación, gate, diagnóstico)
  // consume SOLO el texto elegido — mismas métricas de la pasada elegida
  // (0 = n/d honesto si el motor elegido no separa det/rec — Tesseract).
  return {
    texto: s.texto,
    conf: s.conf,
    detMs: s.detMs ?? 0,
    recMs: s.recMs ?? 0,
    traza: {
      paso: s.paso,
      elegidoCap: String(s.elegidoCap),
      motorIntento1: s.motorIntento1,
      msIntento1: s.msIntento1,
      ms1280: s.ms1280,
      ms1920: s.ms1920,
      msRoi: s.msRoi,
      msMotor: s.msMotor,
      rescate: s.rescate,
      detMs: s.detMs ?? 0,
      recMs: s.recMs ?? 0,
      nBoxes: s.nBoxes ?? 0,
      nLineas: s.nLineas ?? 0,
      msRunRec: Math.round(s.msRunRec ?? 0),
    },
    lectura: colector.resumen(),
  };
}

async function ocrBanda(fotoProcesada: string): Promise<string> {
  try {
    const img = await loadImageMemo(fotoProcesada);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return "";
    // 7.1: fracciones de la banda (0.22/0.03/0.88/0.13) desde
    // politica/umbrales.ts — la franja del sello KIT.
    const x0 = Math.round(W * BANDA_IZQ_FRACCION);
    const y0 = Math.round(H * BANDA_ARRIBA_FRACCION);
    const w = Math.max(1, Math.round(W * BANDA_DER_FRACCION) - x0);
    const h = Math.max(1, Math.round(H * BANDA_ABAJO_FRACCION) - y0);
    const canvas = canvasCon(w * 2, h * 2); // escala ×2 (§5) — SPRINT-A A3 factory
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    ctx.drawImage(img, x0, y0, w, h, 0, 0, w * 2, h * 2);
    const d = ctx.getImageData(0, 0, w * 2, h * 2);
    // INVERTIDO (§5): el sello es blanco-sobre-negro → 255-lum por canal.
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = 255 - d.data[i];
      d.data[i + 1] = 255 - d.data[i + 1];
      d.data[i + 2] = 255 - d.data[i + 2];
    }
    ctx.putImageData(d, 0, 0);
    // KIT e14-motor-rapidocr-v1 (PROD-2 §2-C3): la banda pasa al ÚNICO motor
    // de producción — el canvas invertido ×2 ya es polaridad normal y
    // RapidOCR lo lee (campos 6/6 en Frankfurt incluyen lo que aporta la
    // banda). Escape hatch documentado (§5): revert puntual de C3.
    // 7.1: CALIDAD_JPEG_ENVIO (0.9) desde politica/umbrales.ts.
    return await reconocerRapidOcr(canvas.toDataURL("image/jpeg", CALIDAD_JPEG_ENVIO));
  } catch {
    return ""; // fallo de decode/canvas/OCR → sin banda nueva (nunca condena)
  }
}

/** KIT e14-seccion-inferior-banda-v1: OCR DEDICADO de la franja del PIE —
 *  «SUMA TOTAL» (pág 1) / «FIRMA» (pág ≥2). Solo se cobra cuando el OCR
 *  rápido no leyó la sección. No invierte: el pie es tinta oscura sobre
 *  papel claro; ×2 y RapidOCR, igual que `ocrBanda`. */
async function ocrBandaInferior(fotoProcesada: string): Promise<string> {
  try {
    const img = await loadImageMemo(fotoProcesada);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return "";
    const x0 = Math.round(W * BANDA_INFERIOR_IZQ_FRACCION);
    const y0 = Math.round(H * BANDA_INFERIOR_ARRIBA_FRACCION);
    const x1 = Math.round(W * BANDA_INFERIOR_DER_FRACCION);
    const y1 = Math.round(H * BANDA_INFERIOR_ABAJO_FRACCION);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const canvas = canvasCon(w * 2, h * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, x0, y0, w, h, 0, 0, w * 2, h * 2);
    return await reconocerRapidOcr(canvas.toDataURL("image/jpeg", CALIDAD_JPEG_ENVIO));
  } catch {
    return "";
  }
}

/** KIT e14-masiva-ux-v1 (T1): ¿el worker OpenCV está listo para detectar?
 *  Si no, espera su warm-up con TOPE (warmUpScannerWorker/waitReady del
 *  core — nunca tumba el pipeline: false = continuar como hoy, fallback
 *  Sobel manda). SSR/worker muerto → false inmediato. */
async function esperarWorkerCaliente(topeMs: number): Promise<boolean> {
  try {
    const cliente = getScannerWorker();
    if (cliente?.isReady) return true;
    warmUpScannerWorker(); // crea/reanima el worker si no existe (idempotente)
    const activo = getScannerWorker();
    if (!activo) return false;
    return await Promise.race([
      activo.waitReady(),
      new Promise<boolean>((res) => setTimeout(() => res(false), topeMs)),
    ]);
  } catch {
    return false;
  }
}

/** KIT e14-masiva-ux-v1 (T4) — RETIRADA DEL MÓDULO MASIVA: el runner que
 *  pasaba 120_000 ya no existe; el presupuesto opcional y el rescate
 *  post-timeout (e67) siguen disponibles para el flujo individual. */
export type OpcionesEscaneoConTimeout = OpcionesEscaneo & {
  /** Presupuesto total del pipeline para ESTA llamada (ms). Ausente =
   *  presupuestoEscaneoEfectivo() (plan por tier — KIT e14-ocr-tessbest-v1:
   *  ALTO 120_000 desde e67 — 15_000 antes — · MEDIO 240_000 · BAJO 480_000). */
  timeoutMs?: number;
  /** e67-watchdog-rescate-v1 (cambio B — RESCATE post-timeout): el pipeline
   *  NO se cancela al vencer el presupuesto — sigue vivo y su desenlace
   *  llega DESPUÉS del acta RECHAZADA de timeout. Antes ese resultado
   *  válido se DESCARTABA en silencio (`if (vencido) return`). Ahora viaja
   *  por ESTE callback (SOLO se dispara tras un vencimiento — idempotente:
   *  si el pipeline gana la carrera jamás se llama). El receptor decide:
   *  el store individual rescata actas válidas (OPTIMA/ADVERTENCIA) y
   *  revierte el rechazo. Firmas intactas.
   *  `tiempoRealMs` = ms reales del pipeline completo (dato, jamás inventado). */
  onRescateTardio?: (acta: Acta, tiempoRealMs: number) => void;
};

/** Resultado del gate §4 (evaluarGate) — status + rechazo + clasificación. */
export interface ResultadoGate {
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  clasificacion: ClasificacionE14 | null;
}

/** Traza §4.6: clasif={dep:88,mun:335,zon:05,std:02,mesa:001,tipo:T,nivel:AUTO}. */
function fmtClasif(c: ClasificacionE14 | null): string {
  if (!c) return "sin-clasificar";
  const tipo = c.tipo === "TRANSMISION" ? "T" : c.tipo === "DELEGADOS" ? "D" : "-";
  // KIT actas-vivas-paginas-v1 (FASE B): página en la traza de auditoría —
  // «pag:2/2» leída · «pag:?» DESCONOCIDA (el hueco irá al primer libre).
  const pag = c.pagina ? `${c.pagina.index}/${c.pagina.total}` : "?";
  // KIT identificacion-codigo-v1 (Task 120): consenso del código + avisos de
  // los cruces en la traza de auditoría (cod:crudo · av:A+B+C).
  const cod = c.codigoUnico ? `,cod:${c.codigoUnico.crudo}` : "";
  const av = c.avisos?.length ? `,av:${c.avisos.join("+")}` : "";
  return (
    `dep:${c.departamento?.codigo ?? "?"},mun:${c.municipio?.codigo ?? "?"},` +
    `zon:${c.zona?.codigo ?? "?"},std:${c.puesto?.codigo ?? "?"},` +
    `mesa:${c.mesa !== null ? String(c.mesa).padStart(3, "0") : "?"},` +
    `pag:${pag},tipo:${tipo},nivel:${c.nivel}${cod}${av}`
  );
}

/**
 * Emite progreso INTERPOLADO mientras una espera real del core está en vuelo
 * (decode/detect/proceso no exponen avance interno; el OCR sí lo reporta
 * real). La fracción se cap al 95% para que la resolución de la etapa
 * siempre produzca un salto visible en ANALIZANDO.
 */
function conRampa<T>(
  promesa: Promise<T>,
  msEstimados: number,
  evento: (fraccion: number) => ProgresoAnalisis,
  emitir: (p: ProgresoAnalisis) => void,
): Promise<T> {
  const inicio = performance.now();
  // FIX (auditoría 2-a #7): autolímite del ramp — si la promesa envuelta
  // cuelga SIN resolver (worker OpenCV muerto), el intervalo seguía
  // disparando indefinidamente (un timer fugado por pipeline colgado; el
  // timeout externo recupera la UI pero no el timer). 20× el estimado es
  // inalcanzable en operación normal y cubre el peor caso real.
  let ticks = 0;
  const maxTicks = Math.ceil((msEstimados * 20) / 140);
  const timer = setInterval(() => {
    if (++ticks > maxTicks) {
      clearInterval(timer);
      return;
    }
    const f = Math.min(1, (performance.now() - inicio) / msEstimados);
    emitir(evento(f * 0.95));
  }, 140);
  return promesa.then(
    (valor) => {
      clearInterval(timer);
      return valor;
    },
    (error) => {
      clearInterval(timer);
      throw error;
    },
  );
}

/** e64-qr T-2.1 — acumulador del pipeline: lo conocido al vencer el timeout
 *  + la señal de la CAPA 0 QR de cámara (ADITIVA — el QR jamás afecta
 *  score/status/gate/OCR; llave OPACA, red line 10). qrCam:
 *  undefined = el decodificador no terminó (timeout — los campos viajan
 *  AUSENTES, jamás inventar) · null = corrió y terminó en null
 *  ("sin-payload") · {payload} = leído ("leido"). */
export interface ParcialPipeline {
  fotoOriginal?: string;
  qrCam?: { payload: string } | null;
  /** KIT e14-remediacion-movil-v1 (B1 — P0 #3): parciales de TIEMPO ya
   *  medidos al vencer el watchdog — el acta de timeout deja de emitir una
   *  muestra sin cuerpo. El pipeline (pipeline.ts) sincroniza este objeto en
   *  cada frontera de fase (decode/detect/proceso/calidad/orient/ocr);
   *  el watchdog lo lee tal cual (nada re-evaluado — §9.10). Ausente =
   *  venció antes de la primera frontera (decode). */
  msParciales?: Record<string, number>;
  /** H4 (auditoría de B1): clave del ESCANEO — watchdog y desenlace tardío
   *  construyen actas con id propio (el contador de `construirActa` avanza),
   *  así que el id de acta NO sirve para deduplicar la muestra de perf. Esta
   *  clave nace una vez por `escanearActa` y viaja por los dos caminos. */
  escaneoId?: string;
}

/** Campos reales §3.1 que recibe `construirActa` (FASE F: tipo extraído de la
 *  firma para poder inyectar el método en `PasosPipelineL2` — mismo contrato). */
type CamposActa = {
  fotoProcesada?: string;
  /** §D4 (SPEC-e14-score-ocr): la procesada salió sin tinta. */
  procesadaVacia?: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE C): OCR de secciones detectó el
   *  recorte del papel (faltaSeccionInferior). */
  recortada?: boolean;
  /** KIT identificacion-codigo-v1 (FASE F): LADO de la esquina fiducial
   *  faltante (píldora «ACTA RECORTADA · SUP-IZQ») — null cuando el
   *  recorte vino SOLO del OCR de secciones o 4/4 presentes. */
  recorteLado?: string | null;
  quadDetectado?: Quad;
  calidad?: PageQuality;
  ocrTexto?: string;
  motor?: "worker" | "canvas";
  /** §D8.3 (SPEC-e14-score-ocr Rev. 3): filtro del acta al nacer —
   *  "original" cuando el asset sim corrió as-is, "bw" (default del
   *  producto) en el pipeline normal. */
  filtro?: PageFilter;
  score: number;
  /** Score visual = bruto de scoreDeCalidad ANTES de los caps del sitio. */
  scoreVisual?: number;
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  /** Clasificación de cabecera (SPEC-cabecera-clasificacion §4/§6). */
  clasificacion?: ClasificacionE14 | null;
};

/**
 * FASE F (plan post-v2.3) — PASOS INYECTABLES de §5: el cuerpo del pipeline
 * vive en `pipeline.ts` (move-only) y este repo le entrega los helpers que
 * §5 comparte con el pipeline de RECORTE (§7.5) + los DOS métodos de la
 * clase que el cuerpo usa. Sin cambios de decisión.
 *
 * 7.8 (plan de remediación, A5) — la god-interface de 21 miembros se agrupa
 * en SUB-INTERFACES por etapa (ISP — el contrato de cada extracción del
 * troceado 7.3 es UNA sub-interfaz, no las 21 piezas). `PasosPipelineL2`
 * sigue siendo la INTERSECCIÓN exacta de las cuatro: los consumidores actuales
 * no se rompen; los pasos nuevos del plan (docs/PLAN-TROCEADO-PIPELINE.md)
 * ya declaran la porción mínima que necesitan.
 */
/** Etapa CAPTURA: entrada → dataUrl + quad (decode, detección, warm-up). */
export type PasosCaptura = {
  conRampa: typeof conRampa;
  decodeArchivoMemo: typeof decodeArchivoMemo;
  quadIdentidad: Quad;
  esperarWorkerCaliente: typeof esperarWorkerCaliente;
};
/** Etapa CALIDAD: warp/crop → métricas → score bruto (§4.1). */
export type PasosCalidad = {
  calidadDeActa: typeof calidadDeActa;
  scoreDeCalidad: typeof scoreDeCalidad;
  contrasteEfectivoDe: typeof contrasteEfectivoDe;
};
/** Etapa OCR: escalonado + cascada + banda del sello (§4, PROD-1/PROD-2). */
export type PasosOcr = {
  reconocerRapidOcrEscalonado: typeof reconocerRapidOcrEscalonado;
  reconocerRapidOcrCascada: typeof reconocerRapidOcrCascada;
  ocrBanda: typeof ocrBanda;
  ocrBandaInferior: typeof ocrBandaInferior;
};
/** Etapa GATE: señales, clasificación y desenlace (§4.2 — la política vive
 *  además en politica/gate.ts desde 7.2; estas piezas llegan inyectadas). */
export type PasosGate = {
  senalDeContenido: typeof senalDeContenido;
  esquinasDeActa: typeof esquinasDeActa;
  fmtClasif: typeof fmtClasif;
  construirActa: (
    opciones: OpcionesEscaneo,
    parcial: ParcialPipeline,
    campos: CamposActa,
  ) => Acta;
  evaluarGate: (
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ) => ResultadoGate;
  DETALLE_ILEGIBLE: typeof DETALLE_ILEGIBLE;
  DETALLE_INCOMPLETA: typeof DETALLE_INCOMPLETA;
  DETALLE_SIN_VOTOS: typeof DETALLE_SIN_VOTOS;
  DETALLE_BAJO: typeof DETALLE_BAJO;
  TECHO_SIN_SENAL: typeof TECHO_SIN_SENAL;
  TECHO_ESCUDO_FONDO: typeof TECHO_ESCUDO_FONDO;
};

export type PasosPipelineL2 = PasosCaptura & PasosCalidad & PasosOcr & PasosGate;

export class RealCoreBridge implements E14Bridge {
  private contador = 0;

  async escanearActa(opciones: OpcionesEscaneoConTimeout): Promise<Acta> {
    // Resolución de la entrada (L3 §5 CAMARA + F1 SIMULACIÓN):
    //  · CAMARA + archivo (ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO.
    //  · CAMARA sin archivo + frameActual (video vivo) → grab síncrono.
    //  · SIMULACIÓN sin archivo (D35) → el acta E-14 incluida, EXACTAMENTE
    //    como un archivo de IMPORTAR (la foto real del mantenedor, EXIF incluido).
    //  · Sin entrada → error explícito (el guard del store ya avisó).
    let entrada: EntradaPipeline | null = null;
    if (opciones.archivo) {
      entrada = { archivo: opciones.archivo };
    } else if (opciones.fuente === "CAMARA") {
      const video = opciones.frameActual;
      const dataUrl = video && video.readyState >= 2 && video.videoWidth
        ? capturarFrame(video)
        : null;
      if (!dataUrl) {
        throw new Error("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)");
      }
      entrada = { dataUrl };
    } else if (opciones.fuente === "SIMULACION") {
      // SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
      // Mismo camino que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP).
      // §D3 (SPEC-e14-simulacion-scores): con `simular` el asset es el FIJO de
      // la banda del chip (determinista) — el ciclo rotativo §G queda intacto
      // para el disparo normal de la fuente. §D8.2 (Rev. 3): el flag
      // sinRecorte del asset viaja con la entrada (parámetro interno privado).
      const sim =
        opciones.simular && opciones.scoreSimulado != null
          ? await fetchActaSimPorScore(opciones.scoreSimulado)
          : await fetchActaSimulada();
      entrada = { archivo: sim.archivo, sinRecorte: sim.sinRecorte };
    } else {
      throw new Error("SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)");
    }

    // Acumulador de lo que ya se tiene (el acta de timeout rellena lo que
    // alcance a conocer — p. ej. fotoOriginal si el decode alcanzó a correr).
    const parcial: ParcialPipeline = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) opciones.onProgreso?.(p);
    };

    // e67 (cambio B): reloj del rescate — ms REALES del pipeline completo
    // (el callback de rescate viaja con este dato, jamás inventado).
    const tInicioEscaneo = performance.now();
    // H4: identidad del ESCANEO (performance.now es monótono — único por
    // disparo). El watchdog y el pipeline tardío la comparten para que la
    // muestra de perf se emita una sola vez.
    parcial.escaneoId = `esc-${tInicioEscaneo}`;
    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve un acta RECHAZADA
        // controlada (el toast crit sale del flujo normal del store).
        const actaVencida = this.construirActa(opciones, parcial, {
          score: 0,
          scoreVisual: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
        });
        // KIT e14-remediacion-movil-v1 (B1 — P0 #3): el WATCHDOG EMITE SU
        // PerfActa con `vencido: true` y los parciales ya medidos (proceso/
        // calidad hasta donde existan — parcial.msParciales). Antes, si el
        // pipeline no llegaba a su emisor final, la muestra del peor caso se
        // perdía (0/1 timeout con datos en la medición del informe).
        try {
          void import("./obs/captura")
            .then((m) =>
              m.emitirPerfDeActa({
                actaId: actaVencida.id,
                escaneoId: parcial.escaneoId,
                status: actaVencida.status,
                intento: opciones.intento,
                tiempos: parcial.msParciales ?? {},
                scoreVisual: 0,
                scoreFinal: 0,
                gate: "TIMEOUT",
                ocrValido: false,
                vencido: true,
                camino: "pipeline",
              }),
            )
            .catch(() => {});
        } catch {
          /* la emisión del watchdog jamás rompe el desenlace */
        }
        resolve(actaVencida);
        // Presupuesto OPCIONAL por llamada (OpcionesEscaneoConTimeout);
        // el default manda en el flujo individual (120_000 desde e67).
      }, opciones.timeoutMs ?? presupuestoEscaneoEfectivo());

      // FASE F (plan post-v2.3): el cuerpo de §5 vive en `pipeline.ts` y se
      // ejecuta con los pasos INYECTADOS (mismos helpers de este módulo,
      // compartidos con el recorte §7.5 — sin cambios de decisión).
      correrPipelineL2(
        opciones,
        entrada,
        parcial,
        emitir,
        this.pasosPipelineL2(),
      ).then(
        (acta) => {
          if (vencido) {
            // e67 (cambio B) — RESCATE post-timeout: el pipeline siguió
            // vivo tras el vencimiento y terminó con un desenlace REAL
            // (gate/score del pipeline, no del watchdog). Ya no se
            // descarta en silencio: viaja por onRescateTardio para que el
            // receptor valide y revierta el rechazo si es válido. Sin
            // callback → no-op, comportamiento de siempre.
            opciones.onRescateTardio?.(
              acta,
              Math.round(performance.now() - tInicioEscaneo),
            );
            return;
          }
          clearTimeout(timer);
          resolve(acta);
        },
        (error) => {
          // KIT e14-heic-tope-v1 — el rescate HEIC rechazo o agotó su plazo, la
          // trazabilidad NO puede depender de que el llamador recuerde loggear:
          // el mantenedor necesita ver en el registro que un acta murió por el
          // formato de la foto, no por el motor.
          if (error instanceof ErrorRescateHeic) {
            logger.warn("[e14] rescate HEIC topado", { mensaje: error.message });
          }
          if (vencido) {
            // e67: el pipeline TARDÍO falló — traza honesta; el acta
            // queda RECHAZADA por tiempo (correcto, caso C del kit).
            logger.info("[e14] pipeline falló tras timeout", {
              mensaje: error instanceof Error ? error.message : String(error),
            });
            return;
          }
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** FASE F (plan post-v2.3) — «pasos inyectables» de §5: literal barato con
   *  las referencias de módulo + los DOS métodos de esta clase que el cuerpo
   *  movido a `pipeline.ts` consume. Mismos helpers que el recorte (§7.5). */
  private pasosPipelineL2(): PasosPipelineL2 {
    return {
      conRampa,
      decodeArchivoMemo,
      quadIdentidad: QUAD_IDENTITY,
      esperarWorkerCaliente,
      calidadDeActa,
      scoreDeCalidad,
      contrasteEfectivoDe,
      senalDeContenido,
      esquinasDeActa,
      reconocerRapidOcrEscalonado,
      reconocerRapidOcrCascada,
      ocrBanda,
      ocrBandaInferior,
      fmtClasif,
      construirActa: (o, p, c) => this.construirActa(o, p, c),
      evaluarGate: (s, t, c, i, m) => this.evaluarGate(s, t, c, i, m),
      DETALLE_ILEGIBLE,
      DETALLE_INCOMPLETA,
      DETALLE_SIN_VOTOS,
      DETALLE_BAJO,
      TECHO_SIN_SENAL,
      TECHO_ESCUDO_FONDO,
    };
  }

  /**
   * L5 (§7.5) — RECORTE MANUAL (rescate D20): re-ejecuta el pipeline §5 sobre
   * `fotoOriginal` con el quad del editor (F5-MANUAL: `manual: true` respeta
   * el quad al píxel, sin refine) y devuelve el acta ACTUALIZADA. El acta
   * conserva IDENTIDAD (fuente/intento/maxIntentos/paginación/título…) — el
   * rescate NO es una captura nueva, no consume intento. Timeout 15 s igual
   * que escanearActa: resuelve un acta RECHAZADA ILEGIBLE controlada.
   * F4/D37: `rotacionOverride` (4º parámetro) hornea la rotación LOCAL del
   * editor — el retorno de pipelineRecorte fija `rotation: rotacionUsada`.
   * KIT e14-esquinas-suaves-v1 (Q2): `manual` (6º parámetro, default false)
   * marca el recorte del EDITOR (decisión CON VISTA — escudo-manual: la tinta
   * al filo del crop manual nunca RECHAZA). Solo lo pasa el store
   * (aplicarRecorte); mejorarResolución conserva el default (conservador).
   */
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
    rotacionOverride?: number,
    // KIT e14-quad-sobel-v1 (P1 §4-B): origen del quad cuando la detección
    // corrió (mejorarResolución). El recorte MANUAL del editor (store) no lo
    // pasa — el quad lo puso el usuario, ninguna detección corrió → undefined
    // → token ausente (n/d no miente).
    quadOrigen?: OrigenQuad | "pagina-completa" | null,
    // KIT e14-esquinas-suaves-v1 (Q2): recorte del editor = decisión CON VISTA.
    manual = false,
  ): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      return Promise.reject(new Error("SIN FOTO ORIGINAL PARA RECORTAR"));
    }
    const rotacion = rotacionOverride ?? acta.rotation ?? 0;
    // KIT e14-recorte-manual-v1 (T1): acumulador del recorte YA HORNEADO —
    // pipelineRecorte lo llena apenas el warp completa (patrón `parcial` del
    // escaneo §5, A7); el timeout lo usa para que el acta RECHAZADA por
    // tiempo muestre EL RECORTE NUEVO del mantenedor y no la foto anterior. Si el
    // warp no alcanzó, parcial queda vacío → comportamiento actual.
    const parcial: ParcialRecorte = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve el acta RECHAZADA
        // controlada (el toast sale del flujo normal del store).
        // KIT e14-recorte-manual-v1 (T1): `...parcial` trae el recorte ya
        // horneado si el warp alcanzó a correr — el mantenedor ve SU recorte
        // (puede re-aplicar/reintentar), no la foto anterior. Gate y score
        // INTACTOS: sigue RECHAZADA ILEGIBLE por tiempo.
        resolve({
          ...acta,
          ...parcial,
          score: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          firmas: this.firmasPorStatus(acta.firmas, "RECHAZADA"),
          // FIX (auditoría 2-a #8): el invariante del gate (RECHAZADA ⇒
          // clasificación descartada) también en el timeout del recorte —
          // el spread conservaba una clasificación AUTO previa (p. ej. de
          // un acta ADVERTENCIA que se re-recortaba) y el título/historial
          // mostraban mesa/tipo/página de una identificación que el propio
          // gate acaba de descartar (undefined = sin clasificación, mismo
          // convenio del contrato Acta).
          clasificacion: undefined,
        });
      }, RECORTE_TIMEOUT_MS);

      void this.pipelineRecorte(acta, fotoOriginal, quad, rotacion, emitir, quadOrigen, manual, parcial).then(
        (actaNueva) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(actaNueva);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /**
   * KIT camara-visor-v1 (G3 — upgrade silencioso del lab L1789-1842):
   * RE-PROCESA el acta con una foto NUEVA a máxima resolución (la toma
   * full-res del sensor que aterrizó en segundo plano tras el disparo
   * rápido por escalera). REUTILIZA el pipeline existente (mismo patrón de
   * `recortar`: re-proceso sin consumir intento — el acta conserva
   * identidad de captura: fuente/intento/maxIntentos/paginación) con dos
   * diferencias obligatorias frente al recorte: (1) el QUAD se RE-DETECTA
   * sobre la foto nueva (los quads son normalizados 0-1 y el aspecto del
   * sensor 4:3 ≠ preview 16:9 — re-usar el quad del preview desplazaría el
   * warp; el lab hace exactamente esto con applyAutoQuad) y (2) la
   * `fotoOriginal` del acta queda REEMPLAZADA por la nueva. El gate se
   * re-evalúa COMPLETO (pipelineRecorte: completitud + marcadores + OCR +
   * clasificación — helper único §4.4).
   */
  async mejorarResolucion(
    acta: Acta,
    fotoNueva: string,
    onProgreso?: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    // 1) Detección del quad sobre la foto NUEVA (worker OpenCV → fallback
    //    Sobel del core — MISMA vía del pipeline de escaneo). Si no detecta
    //    (imagen sin bordes), quad identidad: la foto entera es el acta —
    //    degradación honesta (§0: sin datos reales no se inventa).
    //    KIT e14-quad-sobel-v1 (P1 §4-B): el origen viaja con el quad — y en
    //    el catch el origen es null (ni siquiera corrió el Sobel — n/d no
    //    miente, misma filosofía del T-A).
    let quad: Quad;
    let quadOrigen: OrigenQuad | "pagina-completa" | null = null;
    try {
      const detalle = await detectDocumentEdgesDetail(fotoNueva);
      quad = detalle.quad;
      quadOrigen = detalle.origen;
    } catch {
      quad = defaultQuad();
    }
    // 2) Pipeline de RECORTE existente sobre la foto nueva (calidad + OCR +
    //    gate completo, timeout 15 s igual que recortar). El acta conservada
    //    es la ORIGINAL del disparo (identidad); su fotoOriginal pasa a ser
    //    la full-res que aterrizó.
    const actaBase: Acta = { ...acta, fotoOriginal: fotoNueva };
    return this.recortar(actaBase, quad, onProgreso, undefined, quadOrigen);
  }

  /** Pipeline §5 del RECORTE (sin decode/detección: la foto y el quad ya son
   *  conocidos). Reusa los helpers del pipeline L2 (conRampa, scoreDeCalidad,
   *  PATRON_CABECERA) y el mapeo §4.1 + gate §4.2 idénticos. */
  private async pipelineRecorte(
    acta: Acta,
    fotoOriginal: string,
    quad: Quad,
    rotacion: number,
    emitir: (p: ProgresoAnalisis) => void,
    // KIT e14-quad-sobel-v1 (P1 §4-B): origen del quad — null/undefined si la
    // detección NO corrió (recorte manual del editor, catch de mejorar).
    quadOrigen: OrigenQuad | "pagina-completa" | null = null,
    // KIT e14-esquinas-suaves-v1 (Q2): true SOLO desde el editor del store
    // (aplicarRecorte) — activa el ESCUDO-MANUAL del gate (abajo).
    manual = false,
    // KIT e14-recorte-manual-v1 (T1): acumulador del recorte horneado — el
    // timeout de recortar() resuelve con él (patrón `parcial` del escaneo).
    parcial: ParcialRecorte,
  ): Promise<Acta> {
    const ms = { proceso: 0, calidad: 0, ocr: 0, total: 0 };
    const inicio = performance.now();
    // F2/D36: el recorte conserva el filtro del acta (default del producto "bw").
    const filtro: PageFilter = acta.filtro ?? "bw";

    // 1) Recorte + realce (warp real INTER_CUBIC + filtro del acta, F5-MANUAL).
    //    KIT e14-ocr-lee-original-v1 (PROD-1 §4.2): MISMO patrón del escaneo —
    //    DOS variantes bajo la MISMA conRampa: la del filtro del acta
    //    (MOSTRAR/GUARDAR) y "original" para LEER. Si el acta YA está en
    //    "original", la procesada ES la entrada del OCR (UNA sola llamada —
    //    pitfall §9.4: NO duplicar el warp; la promesa se comparte).
    //    .catch(() => null): la variante nueva jamás rechaza el rescate
    //    (fallback bw-fallback §5). msEstimados 1400→2200 (2.º warp, §1.4).
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    const pBw = processImage(fotoOriginal, quad, filtro, rotacion, { manual: true });
    const pOcr =
      filtro === "original"
        ? pBw
        : processImage(fotoOriginal, quad, "original", rotacion, { manual: true }).catch(
            () => null,
          );
    const [resultado, resultadoOcr] = await conRampa(
      Promise.all([pBw, pOcr]),
      2200,
      // RECORTANDO .2→.6 (warp) → REALZANDO .4→1 (enhance), interpolado.
      (f) =>
        f < 0.55
          ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
          : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
      emitir,
    );
    ms.proceso = performance.now() - tProceso;
    emitir({ etapa: "REALZANDO", progreso: 1 });
    // KIT e14-orientacion-auto-v1 (T-A3): let — el probe puede reemplazarla
    // por la YA derecha (§2.1 paso 4); el horneado `parcial` de abajo consume
    // la final.
    let fotoProcesada = resultado.processed;
    // KIT e14-recorte-manual-v1 (T1): el warp COMPLETÓ — horneado al
    // acumulador (el timeout de recortar() ya puede mostrar este recorte
    // aunque calidad/OCR/gate no alcancen dentro del presupuesto).
    parcial.fotoProcesada = fotoProcesada;
    parcial.quadDetectado = quad;
    parcial.rotation = rotacion;
    // PROD-1 (§4.2): entrada del OCR con fallback idéntico al escaneo (§5).
    // Con filtro "original" la procesada ES la entrada (ocrIn=original — reuse).
    let fotoOcr = fotoProcesada;
    let ocrIn: "original" | "bw-fallback" = "original";
    if (resultadoOcr?.processed) {
      fotoOcr = resultadoOcr.processed;
    } else {
      ocrIn = "bw-fallback";
    }
    // KIT e14-orientacion-auto-v1 (T-A3): MISMO probe del escaneo (§2.1) —
    // en recorte MANUAL el usuario puede no haber corregido la rotación.
    // Aquí no hay SIM (el recorte siempre es real). Al aplicar se giran
    // fotoOcr Y fotoProcesada y el acumulador `parcial` (horneado temprano,
    // kit recorte-manual) se actualiza con la YA derecha.
    // D57 — KIT e14-instrumentos-espera-v1 (T2): MISMO instrumento del escaneo
    // — coste del probe persistido en el diagnóstico (aditivo, defensivo).
    let probeMsOrientacion: number | null = null;
    // WAVE2 A1 — sub-decisión de la miniatura descartada por el fallo seguro
    // (datos para calibración wave 3 — jamás cambia la decisión de HOY).
    let probeMiniOrientacion: ProbeOrientacion["orientacionProbeMini"] | null =
      null;
    {
      // Merge e14-gama-baja-20s + tessbest (PR #118): presupuesto del probe
      // resuelto DENTRO de orientacion.ts por tier (ver nota del call-site
      // anterior) — el fail-fast de 6 s del kit original quedó subsumido.
      const probe = await probeOrientacion(fotoOcr);
      if (probe != null) probeMsOrientacion = probe.ms; // D57 T2
      probeMiniOrientacion = probe?.orientacionProbeMini ?? null; // WAVE2 A1 — la mini que el fallo seguro descartó
      if (probe?.aplicado) {
        fotoOcr = await rotarDataUrl(fotoOcr, probe.rot);
        fotoProcesada = await rotarDataUrl(fotoProcesada, probe.rot);
        parcial.fotoProcesada = fotoProcesada;
      }
    }
    // §D4 (SPEC-e14-score-ocr): tinta de la procesada re-recortada — mismo
    // criterio del pipeline (un crop sobre zona sin tinta → ORIGINAL).
    const procesadaVacia = await procesadaVaciaDataUrl(fotoProcesada);
    // KIT e14-recorte-manual-v1 (T1): la tinta del recorte ya se midió —
    // también al acumulador (ReviewView decide el swap de display con esto;
    // el swap permanece — T3 solo cambia el aviso bajo la tarjeta).
    parcial.procesadaVacia = procesadaVacia;

    // 2) Calidad de la página.
    //    KIT visor-accion-score-v1 (FASE S): MISMO cambio que el escaneo —
    //    el quad del editor está en coordenadas de `fotoOriginal` (misma
    //    unidad): el score mide el RECORTE pedido, no la mesa (§S.0).
    emitir({ etapa: "CALIDAD", progreso: 0 });
    const tCalidad = performance.now();
    const infoCrop: InfoCrop = { w: 0, h: 0, fallback: false };
    const calidad = await calidadDeActa(fotoOriginal, quad, infoCrop);
    ms.calidad = performance.now() - tCalidad;
    emitir({ etapa: "CALIDAD", progreso: 1 });

    // 3) OCR sobre la variante de ENTRADA del OCR (PROD-1 §4.2: recorte SIN
    //    filtro con fallback idéntico al escaneo; gate §4.2). KIT
    //    e14-ocr-escalonado-v1 (§2): MISMO OCR ESCALONADO del escaneo — el
    //    manual también merece el ahorro (§2). El recorte NO tiene SIM
    //    (siempre real; guard fuente SIMULACION = mismo del diag §9.2).
    //    Motor RapidOCR (PROD-2 §2-C2); progreso real por lotes (§2-C4).
    const tOcr = performance.now();
    const ocrEsc = await reconocerRapidOcrEscalonado(
      fotoOcr,
      (p) => {
        emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
      },
      {
        simular: acta.fuente === "SIMULACION",
        // §3 presupuesto: el timeout EXISTENTE del recorte manda
        // (RECORTE_TIMEOUT_MS — T1 recorte-manual); sin presupuestos nuevos.
        presupuestoMs: RECORTE_TIMEOUT_MS,
        inicioMs: inicio,
      },
    );
    let texto = ocrEsc.texto;
    ms.ocr = performance.now() - tOcr;
    // PROD-2 (§4.2): conf/det/rec de la pasada ELEGIDA, antes de la banda.
    const confOcr = ocrEsc.conf;
    const detOcr = ocrEsc.detMs;
    const recOcr = ocrEsc.recMs;
    emitir({ etapa: "OCR", progreso: 1 });
    // KIT consenso-frankfurt-v1 (FASE 4, §5): banda dirigida — MISMO helper
    // del escaneo (§4.4); el recorte no tiene SIM (siempre real).
    if (tipoDeBanda(texto) === null) {
      const tBanda = performance.now();
      texto += "\n" + (await ocrBanda(fotoProcesada));
      ms.ocr += performance.now() - tBanda;
    }
    ms.total = performance.now() - inicio;

    const motor = resultado.precision?.engine ?? "canvas";

    // 4) Mapeo §4 → status/score/rechazo + clasificación (idéntico al
    //    escaneo — helper ÚNICO evaluarGate, §4.4: AMBOS pipelines con el
    //    MISMO criterio). §X (SPEC-score-legible): clasificación primero,
    //    score con señales de legibilidad.
    // §F-3 (SPEC-camara-funcional) + GUARD-BORDE Rev. 2 (D3/AC11): el quad
    // del editor está en coordenadas de `fotoOriginal` → la MISMA regla de
    // completitud ANTES del gate — el helper ÚNICO verificarCompletitud
    // (geometría sospecha, tinta condena: el rescate de un encuadre apretado
    // con filo limpio ya NO muere por geometría sola). El rescate NO sirve
    // de bypass: si el papel está cortado EN VERDAD (tinta al filo), ningún
    // crop lo completa; si el acta SÍ está entera (detección falló por
    // sombra), el recorte manual la rescata legítimamente.
    // KIT consenso-frankfurt-v1 (FASE 2, §3): esquinas ANTES del guard — la
    // marca presente es PRUEBA POSITIVA de papel entero (ANALISIS §5.1) →
    // verificarCompletitud la consulta y perdona la sospecha geométrica
    // (§0-F2). UNA sola medición (helper único esquinasDeActa — §4.4).
    // <80×120 → null (n/d — jamás condena).
    const esquinas = await esquinasDeActa(fotoProcesada);
    const ladoEsquina = esquinas ? ladoEsquinaFaltante(esquinas) : null;
    const trazaEsq = trazaEsquinas(esquinas);
    const verificacion = await verificarCompletitud(quad, fotoProcesada, esquinas);
    // KIT e14-velocidad-5s-v1 — las SEÑALES de lectura se SUBEN sobre el veto:
    // el perdón 4/4 necesita `pisoPerfecto` y `recortada`. Son puras (leen
    // `texto`/`clasificacion`/`calidad`, que ya están en vuelo), así que
    // moverlas no cambia ningún valor; `medirZonaVotos` y el resto del orden
    // quedan donde estaban.
    const clasificacion = clasificarCabecera(texto, await cargarDivipol());
    // KIT e14-seccion-inferior-banda-v1: si el OCR rápido no llegó al pie,
    // la banda inferior DEDICADA (o el par fiducial inferior) decide la
    // sección. Ese texto NO se agrega al `texto` de clasificación/score.
    let faltaSeccion = faltaSeccionInferior(texto, clasificacion.pagina);
    if (faltaSeccion && leerFlags().bandaInferiorOcr) {
      const tBandaInferior = performance.now();
      const textoBandaInferior = await ocrBandaInferior(fotoProcesada);
      const msBandaInferior = performance.now() - tBandaInferior;
      ms.ocr += msBandaInferior;
      ms.total = performance.now() - inicio;
      const parFiducialInferior = Boolean(esquinas?.bl && esquinas?.br);
      faltaSeccion = faltaSeccionInferiorConBanda(
        true,
        clasificacion.pagina,
        textoBandaInferior,
        parFiducialInferior,
      );
      logger.info(
        `[e14] banda-inferior recorte ${Math.round(msBandaInferior)}ms ` +
          `texto=${textoBandaInferior.length} ` +
          `seccion=${!faltaSeccionInferior(textoBandaInferior, clasificacion.pagina)} ` +
          `par=${parFiducialInferior} falta=${faltaSeccion}`,
      );
    }
    const lazoPerdonado = lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion);
    const recortada = faltaSeccion || (ladoEsquina !== null && !lazoPerdonado);
    const senal = senalDeLectura(texto, clasificacion.parciales);
    const pisoPerfecto =
      senal.nivel === "FUERTE" &&
      senal.anclas >= 8 &&
      calidad.sharpnessHi >= 90 &&
      calidad.contrastPapel >= 75;
    // e71 (P10) — VETO 4/4 FIDUCIALES (mismo criterio del escaneo — helper
    // ÚNICO cuatroEsquinasFaltan, pitfall §9.9): las 4 marcas ausentes →
    // `completa` false. KIT e14-velocidad-5s-v1: el perdón por evidencia
    // física fuerte (helper ÚNICO perdonFaltaFiduciales — MISMO criterio en
    // ambos pipelines y en el escaneo, §9.9) aplica acá también. En el
    // RECORTE MANUAL el veto NO rechaza (doctrina Q2 del kit esquinas-suaves:
    // el operador VIO el papel) — degrada al escudo-manual (techo 7.9) vía
    // vetoIncompleta/escudoManual de abajo; diag.gate.completa SÍ reporta
    // false (kit P10 — coherencia del informe con la medición física).
    const completa =
      verificacion.completa &&
      (!cuatroEsquinasFaltan(esquinas) || perdonFaltaFiduciales(pisoPerfecto, recortada));
    // KIT e14-esquinas-suaves-v1 (Q2): ESCUDO-MANUAL — `!completa` en un recorte
    // MANUAL no rechaza: techo 7.9 (patrón del escudo D10). El operador VIO el
    // papel; a lo sumo su crop cortó un poco de impresión y lo decide mirando.
    // SIN_VOTOS y BAJO siguen mandando (contenido, no esquinas). Solo recorte:
    // el escaneo conserva el veto completo (conservador en campo — Q1 lo relaja).
    // (vetoIncompleta/escudoManual se derivan en `aplicarPoliticaGate` — 7.2.)
    // GATE-MARCADORES (KIT e14-gate-v2, FASE G2) en el recorte — mismo
    // marcador obligatorio y MISMO criterio que el escaneo (helper ÚNICO,
    // §4.4): el recorte re-evalúa TODO el gate, los votos incluidos. Sin
    // excepción: un recorte que deja la zona de votos fuera → SIN_VOTOS
    // (vuelve a captura) — el recorte NUNCA rescata un acta sin votos.
    // KIT actas-vivas-paginas-v1 (FASE C): la clasificación y el recorte OCR de
    // secciones se calcularon ARRIBA (KIT e14-velocidad-5s-v1 — el perdón 4/4
    // los necesita antes del veto); acá solo se consumen.
    // (KIT consenso-frankfurt-v1 FASE 2: las esquinas se miden ANTES del
    // guard — arriba; aquí solo consume ladoEsquina/trazaEsq.)
    // KIT e14-lectura-perdona-lazo-v1 (§4-B): MISMO perdón del escaneo — la
    // LECTURA perdona al lazo (falso positivo margen corto/sombra); la señal
    // de secciones NUNCA se perdona. Mismo criterio en AMBOS pipelines
    // (pitfall §9.9 del kit score-lectura — helper único).
    const marcadores = await medirZonaVotos(fotoProcesada);
    // KIT actas-vivas-paginas-v1 (FASE C): gate de votos SOLO P1 — la pág 2
    // (constancias) NO tiene zona de votos. Página desconocida → se mide
    // (conservador). Log: votos=skip-pag2 cuando aplique.
    const votosSkipPag2 = clasificacion.pagina?.index === 2;
    const ocrLegible = ocrTextIsValid(texto);
    // §D1 (SPEC-e14-score-ocr): señal de contenido — mismo criterio §4.4
    // (helper único, AMBOS pipelines con el MISMO criterio).
    const senalActa = senalDeContenido(texto, clasificacion);
    // KIT e14-luz-sim-puntos-v1 (T-D) + e14-velocidad-5s-v1: `senal` y
    // `pisoPerfecto` ya se calcularon ARRIBA (el perdón 4/4 los necesita antes
    // del veto) — son PURAS (misma entrada → misma salida).
    const scoreBruto = scoreDeCalidad(calidad, {
      ocrLegible,
      identificada: clasificacion.nivel === "AUTO",
      conSenal: senalActa,
      pisoPerfecto,
    });
    // KIT e14-diagnostico-autoenvio-v1 (§3-A): score visual ANTES de los caps
    // del sitio (misma convención que el escaneo). ORDEN del merge (kit
    // e14-diag-campos-aditivos-v1 §4-A.3): scoreDeCalidad → scoreVisual → C3.
    const scoreVisual = scoreBruto;
    // 7.2 (A1) — LA política del gate, bloque ÚNICO con el escaneo (golden:
    // gate.paridad.test.ts): C3 (piso/techo lectura) → escudo-fondo D10 →
    // escudo-manual Q2 → cap recortada FASE C → gate INCOMPLETA/SIN_VOTOS
    // con contingencia C4 → caps 6.4 → rechazoFinal §D3 → techosDiag. El
    // recorte NO tiene SIM (scoreSimulado null — siempre real) y aquí sí
    // viaja la bandera `manual` del editor (escudo Q2 en vez de veto).
    const {
      score,
      gate,
      rechazoFinal,
      marcadoresOk,
      techosDiag,
      // (vetoIncompleta no se consume en el log/diag del recorte — solo el
      // escudoManual viaja como token `manual=1`/`escudo-manual=1`.)
      escudoManual,
    } = aplicarPoliticaGate(
      {
        score: scoreBruto,
        scoreSimulado: null, // el recorte jamás simula (guard fuente SIM §9.2)
        senal,
        calidad,
        senalActa,
        texto,
        clasificacion,
        completa,
        manual,
        hayVotos: marcadores.hayVotos,
        votosSkipPag2,
        fondo: verificacion.fondo,
        recortada,
        intento: acta.intento,
        maxIntentos: acta.maxIntentos,
      },
      {
        evaluarGate: (s, t, c, i, m) => this.evaluarGate(s, t, c, i, m),
        DETALLE_INCOMPLETA,
        DETALLE_SIN_VOTOS,
        DETALLE_BAJO,
      },
    );

    // FASE S (§S.1.5): crop= bbox real usado por calidadDeActa (px) — WxH;
    // `full` si el fallback al frame completo se activó (diagnóstico en campo).
    const cropLog = infoCrop.fallback ? "full" : `${infoCrop.w}x${infoCrop.h}`;
    // KIT e14-diagnostico-autoenvio-v1 (C1/§6-B): techosDiag nace dentro de
    // `aplicarPoliticaGate` (7.2) con las MISMAS condiciones que aplicaron
    // los caps — orden real de aplicación; el token `escudo-manual` (Q2) y
    // el veto `incompleta` SOLO cuando el veto es REAL (un recorte manual
    // incompleto NO es INCOMPLETA — es escudo).
    // C1: registro del desenlace junto al log (§9.6). Guard extra §9.2: un
    // recorte de un acta SIMULACION tampoco adjunta (doble guard con el store).
    let diag: DiagnosticoActa | null = null;
    if (acta.fuente !== "SIMULACION") {
      try {
        diag = construirDiagnostico({
          actaId: acta.id, // el acta existe — identidad conservada (spread)
          intento: acta.intento,
          maxIntentos: acta.maxIntentos,
          status: gate.status,
          rechazo: rechazoFinal,
          scoreVisual,
          scoreFinal: score,
          techos: techosDiag,
          metricas: {
            sharpness: calidad.sharpness,
            // KIT e14-diag-campos-aditivos-v1: métricas v2 REALES (§3).
            sharpnessHi: calidad.sharpnessHi,
            brightness: calidad.brightness,
            contrast: calidad.contrast,
            contrastPapel: calidad.contrastPapel,
            contrasteEfectivo: contrasteEfectivoDe(calidad, ocrLegible),
          },
          level: calidad.level,
          lecturaChars: texto.length,
          // KIT e14-diag-campos-aditivos-v1: la señal del C3 del recorte —
          // MISMA instancia, sin recálculo (pitfall §9.10).
          senalLectura: { nivel: senal.nivel, anclas: senal.anclas },
          senalActa,
          ocrValido: ocrTextIsValid(texto),
          gate: {
            completa,
            fondo: verificacion.fondo,
            recortada,
            ladoEsquina: ladoEsquina ?? null,
            votos: {
              densidadPct: marcadores.densidadVotosPct,
              skipPag2: votosSkipPag2,
              ok: marcadoresOk,
            },
            procesadaVacia,
            clasifNivel: gate.clasificacion?.nivel ?? "—",
          },
          captura: {
            motor,
            filtro,
            crop: { w: infoCrop.w, h: infoCrop.h, fallback: infoCrop.fallback },
            quad,
            quadOrigen,
          },
          tiempos: {
            procesoMs: ms.proceso,
            calidadMs: ms.calidad,
            ocrMs: ms.ocr,
            totalMs: ms.total,
            // D61 — KIT e14-tiempos-ocultos-v1 (T2): esta ruta (recorte manual
            // del editor) NO mide decode/detect (su `ms` local solo trae
            // proceso/calidad/ocr/total) — null honesto, jamás inventar.
            decodeMs: null,
            detectMs: null,
          },
        });
      } catch {
        diag = null;
      }
    }
    // D57 — KIT e14-instrumentos-espera-v1 (T2): orientacionProbeMs al
    // diagnóstico — asignación DEFENSIVA (jamás lanza; sin diagnóstico → se
    // omite — kit §4-T2). ADITIVO: no toca score/status/gate/tiempos.
    if (diag != null && ocrEsc.traza) {
      diag.trazaOcr = ocrEsc.traza;
    }
    if (diag != null && probeMsOrientacion != null) {
      diag.orientacionProbeMs = probeMsOrientacion;
    }
    // WAVE2 A1 — sub-decisión de la miniatura descartada por el fallo seguro
    // (asignación DEFENSIVA — jamás lanza; sin diagnóstico o sin mini → se
    // omite — jamás inventar). Datos de calibración wave 3.
    if (diag != null && probeMiniOrientacion != null) {
      diag.orientacionProbeMini = probeMiniOrientacion;
    }
    // §3c (GUARD-BORDE): la evidencia del guard va al log-contrato D51 vía
    // el constructor único (7.9) — condicionales empujados solo cuando
    // aplican; `perdon=` al FINAL del segmento (Q1).
    const entradasD51: EntradaD51[] = [
      ["proceso", Math.round(ms.proceso)],
      ["calidad", Math.round(ms.calidad)],
      ["ocr", Math.round(ms.ocr)],
      ["motor", motor],
      ["ocrValido", String(ocrTextIsValid(texto))],
      ["cabeceraE14", String(PATRON_CABECERA.test(texto))],
      ["completa", String(completa)],
      ["senal", String(senalActa)],
      ["vacia", String(procesadaVacia)],
      ["votos", votosSkipPag2 ? "skip-pag2" : `${marcadores.densidadVotosPct.toFixed(1)}%`],
    ];
    if (!marcadoresOk) entradasD51.push(["SIN_VOTOS", true]);
    if (recortada) entradasD51.push(["recortada", 1]);
    if (ladoEsquina) entradasD51.push(["lado", ladoEsquina]);
    if (lazoPerdonado) entradasD51.push(["lazo", "perdonado"]);
    entradasD51.push(["esquinas", trazaEsq]);
    if (verificacion.sospecha) {
      entradasD51.push(["borde", verificacion.sospecha]);
      entradasD51.push(["tintaFilo", String(verificacion.tintaFilo)]);
      entradasD51.push(
        ["franja", `[${verificacion.densidades.map((d) => d.toFixed(1)).join(",")}]`],
      );
      entradasD51.push(["fondo", String(verificacion.fondo)]);
      if (verificacion.perdonLado) entradasD51.push(["perdon", verificacion.perdonLado]);
    }
    if (manual) entradasD51.push(["manual", 1]);
    if (escudoManual) entradasD51.push(["escudo-manual", 1]);
    entradasD51.push(["quad", `[${quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}]`]);
    // KIT e14-luz-sim-puntos-v1 (T-D): piso-10 aplicado (grep-able).
    entradasD51.push(["piso10", pisoPerfecto ? 1 : 0]);
    if (quadOrigen) entradasD51.push(["origen", quadOrigen]);
    entradasD51.push(["score", score]);
    entradasD51.push(["filtro", filtro]);
    entradasD51.push(["ocrIn", ocrIn]);
    // KIT e14-motor-rapidocr-v1 (PROD-2 §4.2): token grep-able del motor
    // (2º `ocr=` del contrato — duplicados consumidos en orden).
    entradasD51.push(["ocr", "rapidocr"]);
    entradasD51.push(["conf", confOcr != null ? confOcr.toFixed(2) : "?"]);
    entradasD51.push(["det", `${Math.round(detOcr)}ms`]);
    entradasD51.push(["rec", `${Math.round(recOcr)}ms`]);
    // KIT e14-score-lectura-v1 (REBASE): señal de lectura v2 en la traza.
    entradasD51.push(["lectura", senal.nivel]);
    entradasD51.push(["anclas", senal.anclas]);
    entradasD51.push(["piso", String(score >= PISO_LECTURA_FUERTE && senal.nivel === "FUERTE")]);
    entradasD51.push(["clasif", `{${fmtClasif(gate.clasificacion)}}`]);
    entradasD51.push(["crop", cropLog]);
    entradasD51.push([
      "metricas",
      `{sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
        `contrast:${calidad.contrast} contEff:${contrasteEfectivoDe(calidad, ocrLegible)} ` +
        `level:${calidad.level}}`,
    ]);
    const cuerpoD51 = construirLogD51(entradasD51, ORDEN_LOG_D51);
    // Sufijo EXTERNO al paréntesis: TODOS aditivos (D51) — orden de inserción.
    const sufijosD51: EntradaD51[] = [];
    if (diag) sufijosD51.push(["diag", 1]);
    // KIT e63f-autoenvio-v1 (F0): balde fino del no-AUTO — token ADITIVO AL
    // FINAL. Ausente si AUTO o sin motivo de los listados.
    if (gate.clasificacion?.clasifDebil) {
      sufijosD51.push(["ClasifDebil", gate.clasificacion.clasifDebil]);
    }
    const sufijoD51 = construirLogD51(sufijosD51, []);
    logger.info(
      `[e14] recorte ${acta.fuente} total=${Math.round(ms.total)}ms ` +
        `(${cuerpoD51})${sufijoD51 ? " " + sufijoD51 : ""}`,
    );

    // Acta ACTUALIZADA: identidad intacta (spread), campos reales nuevos y
    // rechazo LIMPIO si el rescate mejora el estado (D20). F4/D37: la
    // rotación usada queda HORNEADA (rotation) — la respeta el PDF §6 y un
    // eventual re-recorte/filtrado.
    // §1.3 (SPEC-titulo-ubicacion): el recorte re-corre el gate → clasificación
    // AUTO nueva → título/ubicación reales. ADAPTACIÓN de nombre: el spec llama
    // `resultado` a esta constante, pero ese identificador ya vive arriba (el
    // `conRampa` del paso 1) → `actaActualizada` (misma forma, cero lógica nueva).
    const actaActualizada: Acta = {
      ...acta,
      fotoProcesada,
      procesadaVacia,
      // KIT actas-vivas-paginas-v1 (FASE C): bandera del OCR de secciones,
      // re-evaluada en cada re-proceso (la más reciente manda).
      recortada,
      // KIT identificacion-codigo-v1 (FASE F): LADO de la esquina faltante,
      // re-evaluado en cada re-proceso (null = vino SOLO del OCR de
      // secciones o 4/4 presentes).
      recorteLado: ladoEsquina,
      quadDetectado: quad,
      rotation: rotacion,
      ocrTexto: texto,
      metricas: {
        sharpness: calidad.sharpness,
        brightness: calidad.brightness,
        contrast: calidad.contrast,
      },
      motor,
      score,
      status: gate.status,
      rechazo: rechazoFinal,
      clasificacion: gate.clasificacion ?? undefined,
      firmas: this.firmasPorStatus(acta.firmas, gate.status),
    };
    const titUbi = tituloYUbicacionDe(gate.clasificacion ?? null);
    if (titUbi) {
      actaActualizada.titulo = titUbi.titulo;
      actaActualizada.ubicacion = titUbi.ubicacion;
    }
    // KIT e14-diagnostico-autoenvio-v1 (C1): el desenlace del RECORTE viaja
    // en el acta actualizada (el store decide ZIP/registro — C3).
    if (diag) actaActualizada.diagnostico = diag;
    // KIT e14-recorte-manual-v1 (T3): recorte MANUAL con foto SIN TINTA —
    // el acta carga el flag y REVISIÓN cambia el aviso bajo la tarjeta a
    // «TU RECORTE SE APLICÓ — …». El swap de display permanece (§D4) y el
    // umbral de tinta NO se toca (image-utils intacto — prohibido §2-T3.3).
    if (manual && procesadaVacia) actaActualizada.recorteManualSinTinta = true;
    // KIT e14-remediacion-movil-v1 (B1 — P1 #22): la ruta de RECORTE/IMPORT
    // también emite su PerfActa con `camino: "recorte"` — era el call-site
    // único del emisor (pipeline.ts) lo que dejaba las importaciones 0/2 sin
    // muestra. Guard §9.2: un recorte de un acta SIMULACION tampoco emite.
    // lazy import + catch total (el rastreo jamás rompe el recorte, §2.4).
    if (acta.fuente !== "SIMULACION") {
      try {
        void import("./obs/captura")
          .then((m) =>
            m.emitirPerfDeActa({
              actaId: actaActualizada.id,
              status: actaActualizada.status,
              intento: acta.intento,
              tiempos: {
                procesoMs: Math.round(ms.proceso),
                calidadMs: Math.round(ms.calidad),
                ocrMs: Math.round(ms.ocr),
                totalMs: Math.round(ms.total),
              },
              scoreVisual,
              scoreFinal: score,
              gate: gate.status,
              ocrValido: ocrTextIsValid(texto),
              camino: "recorte",
              tramos: {
                msCrops: ocrEsc.tramos?.msCrops ?? null,
                msSegundaPasada: ocrEsc.tramos?.msSegundaPasada ?? null,
                msProbe: probeMsOrientacion ?? null,
                msBanda: null,
              },
            }),
          )
          .catch(() => {});
      } catch {
        /* la emisión jamás rompe el recorte */
      }
    }
    return actaActualizada;
  }

  /**
   * Gate §4.2 REVISADO (SPEC-cabecera-clasificacion §4 + §7.2 SPEC-rediseno-
   * revision) — helper ÚNICO para AMBOS pipelines (escaneo y recorte, §4.4):
   *  1. RECHAZADA SOLO por CALIDAD (score < UMBRAL_RECHAZO_SCORE=6.5 vía
   *     statusDeScore, §4.1) —
   *     la tarjeta «ACTA NO RECONOCIDA» queda reservada a este caso. Al
   *     AGOTAR intentos la contingencia es AUTOMÁTICA (C4, sin botón manual).
   *  2. Calidad suficiente + clasificación AUTO → status por score (OPTIMA/
   *     ADVERTENCIA) como hoy + clasificación persistida (Fase B al envío).
   *  3. Calidad suficiente + SUGERIDA/MANUAL (incluye OCR sin texto, §4.3) →
   *     EN_REVISION_HUMANA: la pantalla distingue por intento (§7.3 — «repetir-
   *     primero» antes de agotar; contingencia con panel al agotar).
   * PATRON_CABECERA ya NO decide el estado (§4.5) — solo traza en el log.
   * §X (SPEC-score-legible): la clasificación llega calculada desde el
   * pipeline — alimenta el score (piso por identificación).
   */
  private evaluarGate(
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ): ResultadoGate {
    if (score >= UMBRAL_RECHAZO_SCORE) {
      if (clasificacion.nivel === "AUTO") {
        return { status: statusDeScore(score), rechazo: null, clasificacion };
      }
      // SUGERIDA/MANUAL: la CONTINGENCIA (panel) llega SOLO al agotar intentos;
      // antes, el acta viaja como EN_REVISION_HUMANA «repetir-primero» (§7.3 —
      // la pantalla distingue por intento; el estado no cambia).
      return { status: "EN_REVISION_HUMANA", rechazo: null, clasificacion };
    }
    // score < 6.5 — rechazo por CALIDAD. Al AGOTAR intentos: contingencia
    // automática (C4) — el sistema escala solo, sin botón manual.
    if (intento >= maxIntentos) {
      return {
        status: "EN_REVISION_HUMANA",
        rechazo: ocrTextIsValid(ocrTexto)
          ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
          : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
        clasificacion: null,
      };
    }
    return {
      status: "RECHAZADA",
      rechazo: ocrTextIsValid(ocrTexto)
        ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
        : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
      clasificacion: null,
    };
  }

  /**
   * F2 (§F2.2, D36) — FILTRO: re-procesa la foto con el filtro elegido,
   * IGUAL que setFilterOnPage del core (apps/scanner-lab/src/components/
   * scanner/…/store.ts L644-669): SOLO processImage — sin re-OCR, sin
   * re-calidad (el gate ya resolvió). Devuelve el acta con fotoProcesada y
   * filtro actualizados. Sin timeout: es un ÚNICO processImage con fallback
   * canvas (misma exposición al cuelgue que tiene el lab aquí — documentado
   * en worklog como ADAPTACIÓN de la opción «timeout 15 s» del spec).
   */
  async revelar(acta: Acta, filtro: PageFilter): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      throw new Error("SIN FOTO ORIGINAL PARA FILTRAR");
    }
    // Fuente: apps/scanner-lab/…/store.ts L644-669 (setFilterOnPage) —
    // processImage(original, quad, filter, rotation, { manual }).
    const resultado = await processImage(
      fotoOriginal,
      acta.quadDetectado ?? defaultQuad(),
      filtro,
      acta.rotation ?? 0,
      { manual: true },
    );
    return { ...acta, fotoProcesada: resultado.processed, filtro };
  }

  /**
   * F-OCR del lab (EditorView.tsx L1360-1395): corre requestOcr sobre la
   * imagen PROCESADA del acta y devuelve el texto crudo.
   * KIT e14-ocr-lee-original-v1 (PROD-1 §4.3): coherencia con la regla del
   * producto — el re-OCR manual del editor aplica la MISMA regla: lee el
   * RECORTE SIN filtro ("original", el crudo del warp) cuando hay
   * fotoOriginal + quadDetectado; fallback a la procesada (comportamiento de
   * hoy). NOTA (documentada): el texto del editor puede diferir del histórico
   * — ES la regla nueva del producto, NO un bug (en impresas con sello el
   * crudo colapsa chars — §1.2 del kit, esperado).
   * ADAPTACIÓN documentada: el lab elige imagen con prioridad
   * `preview ?? procesada-fresca ?? original` (L1373-1376) porque tiene
   * previewCache; en e14 la procesada SIEMPRE está fresca (todo cambio pasa
   * por el pipeline) → se usa fotoProcesada directa. El guard `previewLoading`
   * (L1364-1370) NO aplica (no hay preview en e14) → omitido. Sin timeout
   * extra (igual que el lab L1379 — requestOcr se gobierna solo).
   */
  async reconocerTexto(acta: Acta): Promise<string> {
    const fotoProcesada = acta.fotoProcesada;
    if (!fotoProcesada) {
      throw new Error("SIN FOTO PROCESADA PARA RECONOCER TEXTO");
    }
    // PROD-1 (§4.3): regla del producto en el re-OCR del editor — recorte
    // "original" con el quad horneado (misma convención POST-warp); el catch
    // cae al fallback de abajo (comportamiento de hoy, §5 del kit).
    if (acta.fotoOriginal && acta.quadDetectado) {
      try {
        const r = await processImage(
          acta.fotoOriginal,
          acta.quadDetectado,
          "original",
          acta.rotation ?? 0,
        );
        // PROD-2 (§2-C2): el re-OCR del editor pasa por el ÚNICO motor.
        return reconocerRapidOcr(r.processed);
      } catch {
        /* cae al fallback de abajo */
      }
    }
    return reconocerRapidOcr(fotoProcesada); // comportamiento de hoy (fallback)
  }

  /** Firmas coherentes con el estado (misma regla del mock/§7.5):
   *  ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK. */
  private firmasPorStatus(firmas: ActaFirma[], status: ActaStatus): ActaFirma[] {
    if (firmas.length < 2) return firmas;
    const estadoFirma2: ActaFirma["estado"] =
      status === "ADVERTENCIA" ? "TENUE" : status === "RECHAZADA" ? "NO_DETECTADO" : "OK";
    return firmas.map((f, i) => (i === 1 ? { ...f, estado: estadoFirma2 } : { ...f }));
  }

  /** Acta final: seed SOLO cuando la clasificación no está resuelta (§1) + campos reales §3.1. */
  private construirActa(
    opciones: OpcionesEscaneo,
    parcial: ParcialPipeline,
    campos: CamposActa,
  ): Acta {
    const numeroMesa = opciones.objetivo
      ? opciones.objetivo.mesaId.replace(/\D/g, "").padStart(3, "0")
      : "001";
    this.contador += 1;

    // Firmas coherentes con el estado (misma regla del mock §7.5):
    // ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK.
    const estadoFirma2: ActaFirma["estado"] =
      campos.status === "ADVERTENCIA" ? "TENUE" : campos.status === "RECHAZADA" ? "NO_DETECTADO" : "OK";

    // §1.2 (SPEC-titulo-ubicacion): clasificación AUTO → el acta nace con
    // título/ubicación REALES. KIT e14-sin-relleno-v1 + auditoría 2026-11-11
    // (hallazgos #2 y #3): NINGÚN campo de pantalla viene ya del acta de
    // demostración — sin clasificación el acta no muestra candidaturas con
    // votos, nombres de jurados ni un barcode inventado; el tipo se deriva de
    // la clasificación.
    const titUbi = tituloYUbicacionDe(campos.clasificacion ?? null);
    const tipoHonesto =
      campos.clasificacion?.tipo === "TRANSMISION"
        ? "SENADO DE LA REPÚBLICA"
        : campos.clasificacion?.tipo === "DELEGADOS"
          ? "CÓNSUL/EMBAJADOR"
          : "SIN CLASIFICAR";
    return {
      id: `acta-${Date.now()}-${this.contador}`,
      titulo: titUbi?.titulo ?? "ACTA SIN IDENTIFICAR",
      ubicacion: titUbi?.ubicacion ?? {
        departamento: "—",
        municipio: "—",
        zona: "—",
        puesto: "—",
        mesa: numeroMesa,
      },
      tipo: tipoHonesto,
      // §6: página REAL del «Ver/Pag/de» cuando la clasificación la leyó.
      // KIT actas-vivas-paginas-v1 (FASE B): la página viaja COMO VENGA de
      // la clasificación (null incluido — DESCONOCIDA: el chip muestra
      // «PÁG - DE -» y el hueco va al primer libre; el default P1 mintió
      // con la pág 2 del Frankfurt, bug del mantenedor 16-oct). Sin
      // clasificación → objetivo seed (hoy).
      pagina: campos.clasificacion
        ? campos.clasificacion.pagina
        : {
            index: opciones.objetivo?.pagina ?? 1,
            total: 2,
          },
      candidatos: [],
      firmas: [
        { nombre: "—", jurado: "JURADO 1", estado: "OK" },
        { nombre: "—", jurado: "JURADO 2", estado: estadoFirma2 },
        { nombre: "—", jurado: "JURADO 3", estado: "OK" },
      ],
      score: campos.score,
      scoreVisual: campos.scoreVisual,
      status: campos.status,
      rechazo: campos.rechazo,
      intento: opciones.intento,
      maxIntentos: opciones.maxIntentos,

      // ----- Campos reales (§3.1) -----
      fuente: opciones.fuente,
      fotoOriginal: parcial.fotoOriginal,
      fotoProcesada: campos.fotoProcesada,
      procesadaVacia: campos.procesadaVacia,
      recortada: campos.recortada ?? false,
      recorteLado: campos.recorteLado ?? null,
      ocrTexto: campos.ocrTexto,
      metricas: campos.calidad
        ? {
            sharpness: campos.calidad.sharpness,
            brightness: campos.calidad.brightness,
            contrast: campos.calidad.contrast,
          }
        : undefined,
      motor: campos.motor ?? "canvas",
      quadDetectado: campos.quadDetectado,
      rotation: 0,
      // F2/D36: default del producto (types.ts L50 del core) — toda captura
      // nace en B/N adaptativo (Fuente: CameraView.tsx L602-604 del lab).
      // §D8.3 (Rev. 3): EXCEPTO los assets sim as-is, que nacen "original".
      filtro: campos.filtro ?? ("bw" as PageFilter),
      // SPEC-cabecera-clasificacion §6: clasificación de cabecera (AUTO →
      // archivada al envío; SUGERIDA/MANUAL → panel de corrección §5).
      clasificacion: campos.clasificacion ?? undefined,
      // e64-qr T-2.1 — señal de la CAPA 0 QR de cámara (ADITIVA AL FINAL,
      // contrato D57): qrCam definido = el decodificador corrió ("leido" con
      // payload / "sin-payload" con null); undefined (timeout — el
      // instrumento no terminó) = los campos viajan AUSENTES (jamás
      // inventar). SOLO presencia — jamás contenido (red line 10).
      ...(parcial.qrCam
        ? { qrPayload: parcial.qrCam.payload, qrEstado: "leido" as const }
        : parcial.qrCam !== undefined
          ? { qrEstado: "sin-payload" as const }
          : {}),
    };
  }

  horaEnvio(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
  }

  horaHistorial(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
  }
}
