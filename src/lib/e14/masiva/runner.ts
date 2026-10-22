"use client";

/**
 * KIT e14-carga-masiva-v1 (T2): motor SECUENCIAL del módulo MASIVA — UNA
 * foto a la vez, SIEMPRE. Por qué secuencial y no en paralelo: el OCR es
 * wasm mono-hilo (GH Pages sin SAB — AUDITORIA §2); dos OCR en paralelo se
 * reparten el mismo CPU → NO hay ganancia y la UI sí sufre. Secuencial =
 * throughput máximo real (~1 acta / 15-18 s → 100 actas ≈ 25-30 min).
 *
 * REGLA DE ORO (kit §0): llama getBridge().escanearActa(...) igual que la
 * app normal — MISMO pipeline, MISMO gate, MISMO desenlace. Nunca escribe
 * actaActual, nunca navega vistas, NUNCA simula. La orquestación vive aquí;
 * el store del flujo normal solo ve las 3 acciones de integración (T3).
 */
import { getScannerWorker, warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
import { getBridge } from "../get-bridge";
// D65 (T1): soltar el runtime OCR al matar los workers del intento vencido.
import { rapidOcrReiniciar } from "../ocr/rapidocr";
// KIT e14-masiva-ux-v1 (T4): tipo con el presupuesto de timeout opcional
// (intersección LOCAL en el bridge — kit §1 prohíbe tocar bridge.ts).
// D66 — KIT e14-decode-unico-precalor-v1: el prefetch (D61) se RE-APUNTA —
// ya no calienta la memo del original (el pipeline ya no la consume: recibe
// el MASTER) sino que asegura el master de N+1 vía el precalor (T3.6/T3.1).
import { type OpcionesEscaneoConTimeout } from "../scanner-core-bridge";
// D66 — KIT e14-decode-unico-precalor-v1 (T1/T3): maestro único a escala de
// trabajo + precalor de la cola (consumo T3.3 + prefetch re-apuntado).
import { maestroDeImagen, type MaestroImagen } from "./archivos";
import { asegurarMaestro, consumirMaestro, descartarMaestro } from "./precalor";
import { useE14Store } from "../store";
import { guardarRegistro, leerRegistro } from "./cola";
import {
  originalQrDePayload,
  registrarQrPayload,
  useMasivaStore,
} from "./store";
import { clasificarOrigenDeArchivo, type OrigenVeredicto } from "./origen"; // D63-A — detector de origen (kit e63a-origen-escaneo-v1)
import { preProcesoEscaneo, type PreProcesoEscaneo } from "./deskew"; // D63-B — pre-proceso de escaneos (kit e63b-deskew-escaneo-v1)
// D65 (T1.3): semilla para el acta de timeout del watchdog — la MISMA que el
// bridge usa en SU acta de timeout (solo lectura de la forma; cero criterios).
import { ACTA_MOCK } from "../seed";
import { paginaDeActa, tituloDeActa, type FilaMasiva, type RegistroMasiva } from "./tipos";
import type { Acta, EtapaAnalisis, ProgresoAnalisis } from "../types";
// e63f — KIT e63f-autoenvio-v1 (F2): re-lectura interna pre-«repetir-primero».
// Lógica pura en masiva/relectura.ts (testeable headless); aquí solo la
// orquestación: re-OCR del MISMO bitmap (reconocerTexto — cap fino) +
// re-clasificar con la base divipol.
import { clasificarCabecera } from "../clasificador";
import { cargarDivipol } from "../divipol";
import { desenlaceTrasRelectura, procedeRelecturaInterna } from "./relectura";
// e63k — KIT e63k-capa2-identidad-v1 (F1.4): CAPA 2 de dedup por IDENTIDAD
// impresa (código 1D consensuado — identidad.ts es lógica pura; aquí solo
// la orquestación post-OCR, punto ÚNICO del kit).
import { identidadDeActa } from "./identidad";
// e63g — PLAN e63g-e63h-ruta-unica (E1/F0): tope de la re-lectura interna —
// tríada {vencido} | {valor} | {error}, jamás throw (tope.ts es lógica
// pura; aquí solo la orquestación del bloque relectura).
import { conTope } from "./tope";
// e63m — KIT e63m-capa0-qr-identidad-v1 (F2): CAPA 0 IDENTIDAD QR PRE-OCR
// (identidad-qr.ts es núcleo puro + wrapper DOM; aquí solo la orquestación
// pre-OCR — punto ÚNICO del kit, ANTES de despachar OCR). El capture sale
// de la vía del pipeline (fileToCaptureDataUrl — la MISMA que midió el
// banco #72; jsQR 1.4.0 vendido byte-idéntico en vendor/jsQR.js).
import { fileToCaptureDataUrl } from "@jg-stevan/scanner-core/image-processor";
import {
  decodificarQrDeCapture,
  esperarDesenlaceQr,
  qrCorto,
} from "./identidad-qr";

// ─── D65 — KIT e14-progreso-watchdog-dedup-v1 (T1): WATCHDOG HUMANO ───
// Antes (e14-masiva-ux-v1 T4): presupuesto ÚNICO de 120 s — un colgado moría
// CIEGO una vez (informe 20261020-122235: 3 actas ~175 s, 8.7 min de cola
// congelada, `tiempos: null` sin etapa ni duración — el «se detiene a medio
// camino»). Ahora cada INTENTO tiene presupuesto propio y UN reintento:
const WATCHDOG_MS = 75_000;
const WATCHDOG_INTENTOS = 2;
const WATCHDOG_GRACIA_MS = 5_000;
/** Espejo del DETALLE_TIMEOUT del bridge (constante PRIVADA allí): el string
 *  ES el veredicto visible de siempre y SOLO sale de sus rutas de timeout —
 *  el watchdog lo usa para detectar el vencimiento del intento. */
const DETALLE_TIMEOUT = "TIEMPO DE PROCESADO EXCEDIDO";
// · WATCHDOG_MS (75 s) — presupuesto de CADA intento: el pipeline real mide
//   ~21 s total (OCR 12.5-22.6 s domina); 75 s ≈ 3× el peor caso real — un
//   intento que lo vence ya no es lentitud, es un colgaje. El flujo
//   individual sigue en 15 s (default de escanearActa — intacto).
// · WATCHDOG_INTENTOS (2) — intento original + 1 REINTENTO automático del
//   MISMO procesado ya iniciado por el dueño (NO re-encola nada nuevo — D45
//   intacto; criterios/score intactos). Al vencer: etapa capturada, workers
//   del intento muertos y re-creados (detección OpenCV + OCR RapidOCR), y
//   UN relanzamiento. Si el reintento también vence → MISMO veredicto de
//   hoy (ILEGIBLE - TIEMPO DE PROCESADO EXCEDIDO, score 0) con trazas
//   watchdog/etapaAlMorir/elapsedMs persistidas (T1.4 — nada de inventar).
// · WATCHDOG_GRACIA_MS — gracia de la carrera EXTERNA sobre WATCHDOG_MS:
//   cubre colgajes FUERA del bridge (origen/pre-proceso) que su timeout no ve.

// ─── e63g — PLAN e63g-e63h-ruta-unica (E1/F0): TOPE DE LA RE-LECTURA ───
// La re-lectura interna (e63f F2) corre FUERA del watchdog D65 (solo
// presupuesta el pipeline del intento): un colgaje de reconocerTexto ahí
// dejaba la cola esperando PARA SIEMPRE (sin veredicto, sin error, sin
// reintento posible — agujero latente desde e63f; no disparó en 181622).
// Presupuesto PROPIO y SEPARADO del watchdog: 45 s ≈ 2× el peor caso real
// del re-OCR a cap fino (~22 s) — vencido eso ya no es lentitud, es
// colgaje. Vencido: workers muertos y re-creados (misma infraestructura
// del watchdog), veredicto de la 1.ª lectura INTACTO y CERO reintentos.
const RELECTURA_TOPE_MS = 45_000;

/** Throttle del progreso (250 ms — kit D65 T3.1 literal): el OCR emite decenas
 *  de eventos por etapa; la bandeja solo necesita el último. */
const PROGRESO_MS = 250;

let corriendoFlag = false;
let stopFlag = false;
let ultimoProgresoEn = 0;
// e63g FASE 1: ¿el dueño arrancó la cola ALGUNA VEZ en esta sesión? El
// re-arranque tras el swap temp→id solo procede en sesión viva (D45
// intacto: encolar en sesión fría JAMÁS procesa por sí solo).
let colaSesionIniciada = false;

// ─── % ÚNICO DEL PROCESO COMPLETO POR ACTA (cambio pedido por el dueño) ───
// Antes: el chip de la fila saltaba por tramos fijos por FASE (25→50→OCR
// 50-95→98) y, con el OCR ESCALONADO (1.ª pasada 1280 → re-OCR 1920), el
// número RETROCEDÍA (la 2.ª pasada re-emite su fracción 0→1: 95→50→95).
// Ahora cada señal del bridge mapea a un TRAMO del total del proceso y el
// valor es MONOTÓNICO (Math.max por señal — jamás baja dentro de la misma
// acta). Pesos según la duración REAL del pipeline (~21 s: OCR ~13 s domina
// → ~60% del arco; decode+detección ~2 s; recorte/realce ~2 s; calidad <1 s;
// el 5% final = clasificación/gate/guardado → LISTA pinta 100%).
const FRAC_DECODE_HASTA = 0.15; // DETECTANDO 0→1 (decode + detección de quad)
const FRAC_RECORTE_HASTA = 0.3; // RECORTANDO/REALZANDO (emite 0.2→1)
const FRAC_CALIDAD_HASTA = 0.35; // CALIDAD 0→1
const FRAC_OCR_P1_HASTA = 0.68; // OCR 1.ª pasada (fracción REAL por lotes)
const FRAC_OCR_TOPE = 0.95; // 2.ª pasada (1920) y banda dirigida: tope

/** Estado del % global de la fila EN CURSO (se resetea al empezar cada
 *  acta — el runner es secuencial, sin carrera). `ocrPasada` detecta una
 *  NUEVA pasada del escalonado por caída fuerte de la fracción OCR (dentro
 *  de una pasada la fracción solo sube — es real, por lotes de rec). */
const vidaGlobal = { frac: 0, ocrPasada: 1, ocrFracPrev: 0 };

/** Tramo del TOTAL (0..1) que representa una señal del bridge — la suma de
 *  todas las fases = el proceso COMPLETO del acta. Etapa desconocida →
 *  conserva el máximo alcanzado (jamás inventa). */
function fracGlobalDe(p: ProgresoAnalisis): number {
  const f = Math.min(1, Math.max(0, p.progreso));
  switch (p.etapa) {
    case "DETECTANDO":
      return f * FRAC_DECODE_HASTA;
    case "RECORTANDO":
    case "REALZANDO": {
      // el bridge compone este tramo como 0.2→1 (recorte + realce)
      const t = Math.min(1, Math.max(0, (f - 0.2) / 0.8));
      return FRAC_DECODE_HASTA + t * (FRAC_RECORTE_HASTA - FRAC_DECODE_HASTA);
    }
    case "CALIDAD":
      return FRAC_RECORTE_HASTA + f * (FRAC_CALIDAD_HASTA - FRAC_RECORTE_HASTA);
    case "OCR": {
      // ¿2.ª pasada del escalonado? caída fuerte de la fracción REAL
      if (f < vidaGlobal.ocrFracPrev - 0.15) vidaGlobal.ocrPasada += 1;
      vidaGlobal.ocrFracPrev = f;
      if (vidaGlobal.ocrPasada <= 1) {
        return FRAC_CALIDAD_HASTA + f * (FRAC_OCR_P1_HASTA - FRAC_CALIDAD_HASTA);
      }
      // 2.ª pasada (re-OCR 1920) y siguientes (banda dirigida): tope 0.95
      return Math.min(
        FRAC_OCR_TOPE,
        FRAC_OCR_P1_HASTA + f * (FRAC_OCR_TOPE - FRAC_OCR_P1_HASTA),
      );
    }
    default:
      return vidaGlobal.frac;
  }
}

/** Patch INMUTABLE de UNA fila (la bandeja pinta filas livianas). */
function marcarFila(id: string, patch: Partial<FilaMasiva>): void {
  const filas = useMasivaStore.getState().filas;
  useMasivaStore.setState({
    filas: filas.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  });
}

/** D65 (T3) — vocabulario del kit para la señal de vida (marcarProgreso). */
type EtapaVidaKit = "preparando" | "deteccion" | "ocr" | "verificacion";

/** D65 (T3) — bucket del kit para una señal ProgresoAnalisis del bridge:
 *  · DETECTANDO con fracción ≤ 0.5 → "preparando" (rampa del decode).
 *  · DETECTANDO > 0.5, RECORTANDO, REALZANDO → "deteccion" (quad detectado
 *    + recorte/realce — cola de la fase de encuadre).
 *  · CALIDAD → "verificacion" · OCR → "ocr".
 *  La fracción del OCR es REAL (reconocedor por lotes de rec — §2-C4 del kit
 *  ocr-escalonado, consume el MISMO emit del bridge); las rampas del bridge
 *  son interpolación → SIN número (kit T3: barra animada, jamás inventar %). */
function bucketDeVida(
  p: ProgresoAnalisis,
): { etapa: EtapaVidaKit; ocrFraccion?: number } {
  switch (p.etapa) {
    case "OCR":
      return { etapa: "ocr", ocrFraccion: Math.min(1, Math.max(0, p.progreso)) };
    case "CALIDAD":
      return { etapa: "verificacion" };
    case "DETECTANDO":
      return p.progreso <= 0.5 ? { etapa: "preparando" } : { etapa: "deteccion" };
    default:
      return { etapa: "deteccion" }; // RECORTANDO / REALZANDO
  }
}

/** D65 (T3.1) — emisión de vida vía el action NUEVO del store (throttle).
 *  El % global se computa ANTES del throttle: la detección de pasada OCR
 *  necesita ver TODAS las señales (con 250 ms de muestreo la caída de la
 *  fracción sigue siendo evidente — de ~1.0 a ~0.0). */
function marcarVida(id: string, p: ProgresoAnalisis): void {
  const bruto = fracGlobalDe(p);
  if (bruto > vidaGlobal.frac) vidaGlobal.frac = bruto; // MONOTÓNICO
  const ahora = Date.now();
  if (ahora - ultimoProgresoEn < PROGRESO_MS) return;
  ultimoProgresoEn = ahora;
  useMasivaStore
    .getState()
    .marcarProgreso(id, { ...bucketDeVida(p), fracGlobal: vidaGlobal.frac });
}

/** D65 (T1.4) — etapaAlMorir: vocabulario del kit para la TRAZA (aquí la
 *  primera etapa se llama "decodificando", no "preparando"; mismo bucket).
 *  Sin señal → null (jamás inventar). */
function etapaDeSenal(
  senal: { etapa: EtapaAnalisis; fraccion: number } | null,
): string | null {
  if (!senal) return null;
  switch (senal.etapa) {
    case "OCR":
      return "ocr";
    case "CALIDAD":
      return "verificacion";
    case "DETECTANDO":
      return senal.fraccion <= 0.5 ? "decodificando" : "deteccion";
    default:
      return "deteccion"; // RECORTANDO / REALZANDO — cola del encuadre
  }
}

/** D65 (T1) — desenlace del INTENTO clasificado por la carrera: "acta"
 *  (el bridge resolvió), "error" (el bridge rechazó — fila ERROR de siempre)
 *  o "tope" (venció el watchdog — el pipeline sigue en vuelo y se ABANDONA:
 *  sus workers ya van a ser muertos y re-creados). NUNCA inventa acta. */
type DesenlaceIntento =
  | { tipo: "acta"; acta: Acta }
  | { tipo: "error"; error: unknown }
  | { tipo: "tope" };

function correrIntento(
  pipeline: Promise<Acta>,
  topeMs: number,
): Promise<DesenlaceIntento> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ tipo: "tope" }), topeMs);
    pipeline.then(
      (acta) => {
        clearTimeout(timer);
        resolve({ tipo: "acta", acta });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ tipo: "error", error });
      },
    );
  });
}

/** D65 (T1) — ¿el acta es el veredicto-timeout del bridge? (score 0 +
 *  ILEGIBLE/TIEMPO DE PROCESADO EXCEDIDO — el detalle SOLO sale de sus
 *  rutas de timeout; un rechazo REAL del gate jamás lo lleva). */
function esVeredictoTimeout(acta: Acta): boolean {
  return (
    acta.rechazo?.tipo === "ILEGIBLE" && acta.rechazo.detalle === DETALLE_TIMEOUT
  );
}

/** D65 (T1.2) — matar y re-crear los workers del intento vencido:
 *  · DETECCIÓN (OpenCV del core): dispose() rechaza lo en vuelo y termina el
 *    worker → getScannerWorker() lo sustituye por uno fresco (self-healing
 *    público del core); warmUpScannerWorker() arranca la recarga de OpenCV.
 *    El intento ABANDONADO muere rápido (sus promesas en vuelo rechazan) —
 *    deja de competir por CPU con el reintento.
 *  · OCR (RapidOCR/ONNX): soltar sesiones + singleton fuera → el reintento
 *    re-crea el runtime (rapidOcrReiniciar — best-effort, jamás lanza).
 *  Nada de esto toca criterios/score del veredicto: es infraestructura. */
async function matarYRecrearWorkers(): Promise<void> {
  try {
    getScannerWorker()?.dispose();
  } catch {
    /* worker ya muerto — el self-healing lo re-crea */
  }
  try {
    warmUpScannerWorker();
  } catch {
    /* la detección del reintento lo crea on-demand */
  }
  try {
    await rapidOcrReiniciar();
  } catch {
    /* jamás lanza — cinturón */
  }
}

/** D65 (T1.3) — veredicto del watchdog agotado SIN acta del bridge (colgaje
 *  FUERA del bridge — origen/pre-proceso, que su timeout no ve): la MISMA
 *  forma del acta de timeout del bridge (score 0, ILEGBILE/TIEMPO DE
 *  PROCESADO EXCEDIDO — nada inventado: es el veredicto de «murió el
 *  procesado» de siempre). Sin esto la cola se congelaba para siempre. */
function actaTimeoutWatchdog(filaId: string): Acta {
  return {
    id: `acta-watchdog-${filaId}`,
    titulo: ACTA_MOCK.titulo,
    // MISMA forma de ubicación del bridge (ACTA_MOCK plano + mesa seed 001 —
    // ver construirActa del bridge: numeroMesa "001" sin objetivo).
    ubicacion: {
      departamento: ACTA_MOCK.departamento,
      municipio: ACTA_MOCK.municipio,
      zona: ACTA_MOCK.zona,
      puesto: ACTA_MOCK.puesto,
      mesa: "001",
    },
    tipo: ACTA_MOCK.tipo,
    pagina: { index: 1, total: 2 },
    candidatos: ACTA_MOCK.candidatos.map((c) => ({ ...c })),
    firmas: [
      {
        nombre: ACTA_MOCK.firmas[0].nombre,
        jurado: ACTA_MOCK.firmas[0].jurado,
        estado: "OK",
      },
      {
        nombre: ACTA_MOCK.firmas[1].nombre,
        jurado: ACTA_MOCK.firmas[1].jurado,
        estado: "NO_DETECTADO", // RECHAZADA — misma regla de firmas del bridge
      },
      {
        nombre: ACTA_MOCK.firmas[2].nombre,
        jurado: ACTA_MOCK.firmas[2].jurado,
        estado: "OK",
      },
    ],
    codigoBarras: ACTA_MOCK.codigoBarras,
    score: 0,
    status: "RECHAZADA",
    rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
    intento: 1, // semántica de PRIMERA captura (el watchdog NO es re-captura)
    maxIntentos: 4,
    fuente: "ARCHIVO",
    motor: "canvas",
    rotation: 0,
    filtro: "bw",
    recortada: false,
    recorteLado: null,
  };
}

/** Thumb de la bandeja: canvas 2d, lado mayor 320, JPEG 0.7 (kit §4 regla 4).
 *  Con loadImageMemo NO (el thumb es una foto distinta; decode directo y
 *  fuera — la RAM muere con el canvas). También lo usa el mini-store al
 *  re-sincronizar un acta editada en REVISIÓN (thumb fresco tras recorte). */
export async function hacerThumb(
  dataUrl: string | null | undefined,
): Promise<string | undefined> {
  if (!dataUrl) return undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("THUMB_NO_DECODE"));
      img.src = dataUrl;
    });
    const ladoMayor = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const escala = Math.min(1, 320 / ladoMayor);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined; // thumb es cosmético — nunca tumba el desenlace
  }
}

function motivoCorto(err: unknown): string {
  const crudo = err instanceof Error ? err.message : String(err);
  const corto = crudo.replace(/\s+/g, " ").trim().slice(0, 48);
  return (corto || "ERROR DEL PIPELINE").toUpperCase();
}

/** Siguiente PENDIENTE o DUPLICADA (FIFO por agregadaEn) — el ORDEN vive en
 *  las filas livianas (mini-store), los DATOS viven en IDB (leerRegistro
 *  uno-a-uno). Las filas temporales (copia a IDB aún en vuelo — «GUARDANDO
 *  N…») se saltan: su id real llega al resolver agregarLote y el loop las
 *  toma en la siguiente pasada. KIT e14-masiva-tiempos-v1 (PR-1): las
 *  DUPLICADAS ENTRAN al loop — su procesamiento es la copia rápida (<1 s). */
function siguientePendiente(): FilaMasiva | null {
  const pendientes = useMasivaStore
    .getState()
    .filas.filter(
      (f) =>
        (f.estado === "PENDIENTE" || f.estado === "DUPLICADA") &&
        !f.id.startsWith("masiva-temp-"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn);
  return pendientes[0] ?? null;
}

/** KIT e14-masiva-tiempos-v1 (PR-1): la fila DUPLICADA REUTILIZA el resultado
 *  de su original (kit §2 — copia registro+status+thumb, sin pipeline, sin
 *  contadores: el desenlace del acta gemela YA fue registrado con la
 *  original). El acta copiada se RE-IDENTIFICA con el id de ESTA fila
 *  (contrato de sincronizarAlVolver: acta.id === id de la fila abierta).
 *  Devuelve false ante CUALQUIER falta (original quitada/ERROR/sin acta) →
 *  la fila cae al reproceso completo — jamás inventar. */
async function reutilizarResultado(fila: FilaMasiva, t0: number): Promise<boolean> {
  if (!fila.dupOf) return false;
  try {
    const [registro, original] = await Promise.all([
      leerRegistro(fila.id),
      leerRegistro(fila.dupOf),
    ]);
    const actaOrigen = original.acta;
    if (!actaOrigen) return false; // original sin desenlace (ERROR/en vuelo)
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return false;
    const actaCopia = { ...actaOrigen, id: fila.id };
    // e63k (F1.4): derivar la serie del acta COPIADA (la gemela ES el mismo
    // papel — misma identidad). El mapa de identidad de futuras filas
    // también cubre gemelas copiadas.
    const serieCopia = identidadDeActa(actaCopia)?.serie ?? null;
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaCopia,
      thumb: original.thumb,
      // D59 — KIT e14-info-acta-filas-v1 (T2): la gemela ES el mismo acta →
      // mismo título (honesto — copia el desenlace, copia la info).
      infoTitulo: tituloDeActa(actaCopia),
      hashDedup: registro.hashDedup,
      dupOf: fila.dupOf,
      serie: serieCopia, // e63k — identidad de la copia (null = sin consenso, honesto)
    };
    await guardarRegistro(registroListo);
    const ms = Date.now() - t0;
    console.info(
      `[e14] dedup fila=${fila.id} dupOf=${fila.dupOf} reutiliza score=${actaCopia.score ?? "-"} ms=${ms}`,
    );
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaCopia.status,
      score: actaCopia.score,
      nivel: actaCopia.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaCopia),
      infoTitulo: tituloDeActa(actaCopia), // D59 — KIT e14-info-acta-filas-v1 (T2)
      motivo: actaCopia.rechazo?.tipo ?? null,
      thumb: original.thumb,
      enviadaAuto: actaCopia.status === "ENVIADA" && !!actaCopia.enviadoAutomaticamente,
      envioEnCola: actaCopia.hashSha256 === "EN COLA",
      serie: serieCopia, // e63k — el mapa de identidad cubre gemelas copiadas
      error: null,
    });
    return true;
  } catch {
    return false; // original fuera de la cola / IDB caído → reprocesa completo
  }
}

/** Desenlace de UNA foto — byte a byte el pipeline real (kit §6-C: el
 *  desenlace DEBE ser idéntico al del IMPORTAR normal).
 *  D66 — KIT e14-decode-unico-precalor-v1: el pipeline recibe el MASTER
 *  (T1: un solo decodificado a escala de trabajo) — precalentado (T3.3:
 *  decode = 0 s) o recién horneado con `maestroDeImagen`; sin master →
 *  fallback HONESTO a la ruta de siempre (identidad AC-P3 intacta). */
async function procesarUno(filaEntrante: FilaMasiva): Promise<void> {
  // % global: cada acta NACE en 0 — su propio 0→100 del proceso COMPLETO
  // (reset aquí cubre TAMBIÉN el fallback de la rama DUPLICADA de abajo).
  vidaGlobal.frac = 0;
  vidaGlobal.ocrPasada = 1;
  vidaGlobal.ocrFracPrev = 0;
  // KIT e14-masiva-tiempos-v1 (PR-1): rama DEDUP — copia del resultado de la
  // original (<1 s). Si la original no sirve, la fila cae al pipeline
  // completo AQUÍ MISMO (fallback honesto — el dueño nunca pierde la foto).
  let fila = filaEntrante;
  if (fila.estado === "DUPLICADA") {
    marcarFila(fila.id, { estado: "PROCESANDO", error: null });
    const t0 = Date.now();
    if (await reutilizarResultado(fila, t0)) return;
    // Fallback: des-marcar y reprocesar como fila normal (mismo pase).
    fila = { ...fila, estado: "PENDIENTE", dupOf: null };
    marcarFila(fila.id, { estado: "PENDIENTE", dupOf: null });
    try {
      const registro = await leerRegistro(fila.id);
      await guardarRegistro({ ...registro, estado: "PENDIENTE", dupOf: undefined });
    } catch {
      /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
    }
    console.info(`[e14] dedup fila=${fila.id} sin-original reprocesa-completo`);
  }
  // D66 — KIT e14-decode-unico-precalor-v1 (T3.3): consumir el MASTER
  // precalentado ANTES de marcar PROCESANDO (orden crítico: el precalor
  // descarta masters de filas que dejan de ser PENDIENTE — si marcáramos
  // primero, la suscripción descartaría el master que estamos a punto de
  // consumir). decode = 0 s — el coste ya vivió en precalorMs durante la
  // espera en cola. Un master se consume UNA vez; el chip PREPARADA muere
  // con la fila al pasar a PROCESANDO.
  // D63-A2 (T0): `let` — si el pre-proceso aplicó (deskew), el master
  // precalentado NO alimenta el pipeline y la referencia se SUELTA
  // (disciplina de memoria más abajo — el blob muere YA, no al fin del
  // scope: el OCR domina con ~13 s por fila).
  let entradaPrecalor = consumirMaestro(fila.id);
  if (entradaPrecalor) {
    console.info(
      `[e14] precalor fila=${fila.id} consumido precalorMs=${entradaPrecalor.precalorMs} origen=${entradaPrecalor.maestro.origenDecode}`,
    );
  }
  marcarFila(fila.id, { estado: "PROCESANDO", error: null, precalentada: false });
  // D65 (T3): señal de vida INICIAL — "preparando" (origen/pre-proceso van
  // primero; el bridge emite la suya apenas arranca). fracGlobal = 0: el
  // proceso del acta acaba de nacer (UN % para TODO el proceso).
  useMasivaStore
    .getState()
    .marcarProgreso(fila.id, { etapa: "preparando", fracGlobal: vidaGlobal.frac });
  let registro: RegistroMasiva | null = null;
  // e63m — payload QR de la CAPA 0 (identidad-qr.ts): llave OPACA — solo se
  // guarda en el registro y viaja al informe (export-only); JAMÁS se parsea,
  // se invierte o se compara por prefijos (RED LINE 10). null = sin-payload
  // (el QR no decodificó — pipeline normal intacto, sin campo en IDB).
  let qrPayload: string | null = null;
  // D65 (T1.4) — trazas del watchdog (visibles también en el catch).
  let watchdogUsados = 0;
  let etapaAlMorir: string | null = null;
  let elapsedMuerteMs: number | null = null;
  try {
    registro = await leerRegistro(fila.id);
    const archivo = registro.archivo;
    // IDB clona el File original (sigue siendo File — structured clone de
    // File API). El guard honesto evita alimentar al bridge con un Blob
    // genérico (OpcionesEscaneo.archivo espera File — A5).
    if (!(archivo instanceof File)) throw new Error("ARCHIVO_FUERA_DE_LA_COLA");

    // KIT e14-masiva-tiempos-v1 (PR-2): la instancia del File de SIEMPRE —
    // base de origen/pre-proceso (D63-A/B corren sobre el ORIGINAL: EXIF y
    // márgenes viven ahí; el master es un re-encode sin EXIF).
    const archivoPipeline = archivo;

    // D57 — KIT e14-instrumentos-espera-v1 (T1): espera en cola → inicio del
    // pipeline. tInicio capturado antes del PRIMER intento (kit §4-T1):
    // esperaMs = tInicio − fila.agregadaEn (≥ 0 defensivo — jamás inventar).
    // SOLO masiva lo llena (el flujo individual no tiene espera de cola).
    const tInicio = Date.now();
    const esperaMs = Math.max(0, tInicio - fila.agregadaEn);

    // D65 (T1) — estado del intento del WATCHDOG (kit T1.1/T1.2/T1.3).
    let veredictoOrigen: OrigenVeredicto | null = null;
    let preProceso: PreProcesoEscaneo | null = null;
    let actaBruta: Acta | null = null;
    let senal: { etapa: EtapaAnalisis; fraccion: number } | null = null;
    let errorIntento: { error: unknown } | null = null;
    // D66 — trazas del master del DESENLACE (el del intento que produjo
    // actaBruta; los reintentos re-hornean — la traza describe el master que
    // SÍ sirvió; jamás inventar).
    let maestroDesenlace: MaestroImagen | null = null;
    let decodeMasterMs: number | null = null;
    let intentoDesenlace = 0;
    // Archivo del intento: el 1.º usa el archivo re-leído de IDB (el prefetch
    // del original ya no existe — D66 re-apuntó ese trabajo al precalor:
    // dispararPrefetch→asegurarMaestro). Los REINTENTOS re-leen el registro:
    // instancia FRESCA del File — la decodeMemo del bridge es POR INSTANCIA y
    // el intento muerto pudo envenenar la suya con un decode colgado (el
    // fallback honesto de v1 se conserva si IDB falla).
    let archivoIntento: File = archivo;

    // ─── e63m — KIT e63m-capa0-qr-identidad-v1 (F2): CAPA 0 IDENTIDAD QR
    // PRE-OCR (punto ÚNICO del kit — ANTES de despachar OCR: det/cls/rec y
    // la cadena dhash visual quedan río abajo) ─── El QR es DATO LEÍDO
    // (banco #72: GO 88.2% decode, 0 colisiones, gemelas agrupan por payload
    // EXACTO). Llave = IGUALDAD EXACTA de payload (sin umbrales, sin fuzzy —
    // RED LINES 5/10). Decisión por el estado del original:
    // · payload null → pipeline normal INTACTO (dhash + OCR + capa 2 e63k).
    // · payload NUEVO → se registra (mapa del lote en store) y SIGUE normal
    //   (el ORIGINAL paga el OCR, como hoy).
    // · payload VISTO + original con desenlace final → reutilizarResultado
    //   (maquinaria EXACTA — desenlace clonado, sin doble envío, comparten
    //   hash) con token aditivo `dedup=qr`; OCR JAMÁS se paga.
    // · payload VISTO + original EN VUELO (PROCESANDO) → APLAZADA `capa0=qr`:
    //   espera acotada SOLO-LECTURA (QR_ESPERA_INTERVALO_MS ×
    //   QR_ESPERA_INTENTOS — sin timers globales); techo vencido →
    //   reproceso completo honesto.
    // · Fallback sagrado: reutilizarResultado→false → pipeline completo.
    //   Dedup JAMÁS inventa: falso-positivo = NO-GO. La capa 0 JAMÁS throw
    //   (cualquier falla → sin-payload → normal).
    try {
      const captureQr = await fileToCaptureDataUrl(archivo);
      const qrQr = await decodificarQrDeCapture(captureQr);
      qrPayload = qrQr?.payload ?? null;
    } catch {
      qrPayload = null; // la capa 0 jamás tumba el pipeline (fallback limpio)
    }
    if (!qrPayload) {
      console.info(`[e14] capa0-qr sin-payload fila=${fila.id} nombre=${fila.nombre}`);
    } else {
      const payloadQrCorto = qrCorto(qrPayload);
      const qrPayloadSeguro: string = qrPayload; // acotado (la closure no hereda narrowing)
      const idOriginalQr = originalQrDePayload(qrPayload);
      const originalQr =
        idOriginalQr && idOriginalQr !== fila.id
          ? (useMasivaStore.getState().filas.find((f) => f.id === idOriginalQr) ?? null)
          : null;
      // Reutilización vía la maquinaria EXACTA de reutilizarResultado (la
      // fila viaja como DUPLICADA con dupOf del original). El token
      // `dedup=qr` + qrPayload se estampan DESPUÉS (post-write honesto: si
      // el fallback salta, la traza nunca mintió — reutilizarResultado ya
      // re-leyó el registro y clonó el desenlace; OCR JAMÁS se pagó).
      const reutilizarViaQr = async (o: FilaMasiva): Promise<boolean> => {
        const tQr = Date.now();
        const filaGemela: FilaMasiva = { ...fila, estado: "DUPLICADA", dupOf: o.id };
        if (!(await reutilizarResultado(filaGemela, tQr))) return false;
        try {
          const regQr = await leerRegistro(fila.id);
          await guardarRegistro({ ...regQr, dedup: "qr", qrPayload: qrPayloadSeguro });
        } catch {
          /* IDB caído — la fila ya está LISTA con el desenlace (honesto) */
        }
        console.info(
          `[e14] capa0-qr reutiliza ${payloadQrCorto} fila=${fila.id} original=${o.id}`,
        );
        return true;
      };
      if (!originalQr) {
        // ORIGINAL — payload nuevo en el lote (o auto-registrado: la fila ya
        // carryaba el payload de una pasada previa / entrada muerta re-apuntada).
        registrarQrPayload(qrPayload, fila.id);
        console.info(`[e14] capa0-qr original ${payloadQrCorto} fila=${fila.id}`);
      } else if (fila.forzarDedupOff) {
        // El dueño pulsó PROCESAR IGUAL — las capas 0/1/2 lo respetan SIEMPRE
        // (misma doctrina e63k): reproceso completo, nada se reutiliza.
        console.info(
          `[e14] capa0-qr reprocesa-completo ${payloadQrCorto} fila=${fila.id} forzarDedupOff`,
        );
      } else if (originalQr.estado === "LISTA" || originalQr.estado === "DUPLICADA") {
        // Original con desenlace FINAL → reutiliza (el OCR jamás se paga).
        if (await reutilizarViaQr(originalQr)) return;
        console.info(
          `[e14] capa0-qr fallback fila=${fila.id} reprocesa-completo reutilizarResultado=false`,
        );
      } else if (originalQr.estado === "PROCESANDO") {
        // Original EN VUELO → APLAZADA `capa0=qr` (maquinaria aplazada de
        // e63k con motivo NUEVO): espera acotada SOLO-LECTURA del estado.
        console.info(
          `[e14] capa0-qr aplazada ${payloadQrCorto} fila=${fila.id} original=${originalQr.id}`,
        );
        const desenlaceQr = await esperarDesenlaceQr(() =>
          useMasivaStore.getState().filas.find((f) => f.id === originalQr.id)?.estado ?? "AUSENTE",
        );
        if (desenlaceQr === "reutiliza") {
          if (await reutilizarViaQr(originalQr)) return;
          console.info(
            `[e14] capa0-qr fallback fila=${fila.id} reprocesa-completo reutilizarResultado=false`,
          );
        } else {
          // Techo vencido (o el original salió del vuelo por otra puerta):
          // reproceso completo HONESTO — como si no hubiera gemela.
          console.info(
            `[e14] capa0-qr techo-vencido reprocesa-completo fila=${fila.id} original=${originalQr.id}`,
          );
        }
      } else {
        // Original sin desenlace final ni en vuelo (PENDIENTE/ERROR) →
        // reproceso completo honesto (la gemela paga SU OCR, como hoy).
        console.info(
          `[e14] capa0-qr reprocesa-completo ${payloadQrCorto} fila=${fila.id} original=${originalQr.id} estado=${originalQr.estado}`,
        );
      }
    }

    for (let intento = 1; intento <= WATCHDOG_INTENTOS; intento += 1) {
      const tIntento = Date.now();
      senal = null; // la etapa al morir es la del INTENTO que muere
      // Reintento del watchdog: MISMA acta → el % global CONSERVA el máximo
      // alcanzado (monotónico — no vuelve a 0; la etiqueta de fase sí vuelve
      // a PREPARANDO para contar la historia del reintento).
      useMasivaStore
        .getState()
        .marcarProgreso(fila.id, { etapa: "preparando", fracGlobal: vidaGlobal.frac });
      try {
        // ── D63-A — KIT e63a-origen-escaneo-v1 (punto ÚNICO del kit, T1/T2):
        // origen del archivo — detector heurístico conservador (origen.ts),
        // calculado UNA vez por fila AL INICIO del pipeline. SOLO visibilidad:
        // no alimenta score/gate (calibra D63-B/D63-C). Falla → null (el
        // detector jamás tumba el pipeline). Traza aditiva propia (contrato
        // D51: solo-AÑADIR) + campos en el diagnóstico (parche D57 de abajo).
        // D65: bloque AJENO byte-idéntico — el REINTENTO lo re-ejecuta (los
        // workers del intento anterior ya fueron muertos y re-creados).
        veredictoOrigen = await clasificarOrigenDeArchivo(archivoIntento);
        console.info(
          `[e14] origen=${veredictoOrigen.origen ?? "null"} senales=${veredictoOrigen.senales ?? "null"}`,
        );
        // ── D63-A2 — KIT e14-d63a2-deskew-pipeline-v1 (T1): calibración por
        // CONSTRUCCIÓN — una fila nacida de un PDF (viaPdf, rama PDF del
        // store) ES un escaneo aunque el detector D63-A por señales no lo
        // diga (un E-14 impreso a sangre NO tiene borde blanco de escáner:
        // evidencia F1, informe 200613 — 10 null con borde-no-blanco). Las
        // señales de píxel del detector QUEDAN (honestidad D57) como prefijo
        // `pdf-render+…`. SIM y captura individual JAMÁS traen viaPdf (campo
        // de MASIVA — nace SOLO en la rama PDF de agregarFiles).
        if (fila.viaPdf && veredictoOrigen.origen !== "escaneo") {
          veredictoOrigen = {
            origen: "escaneo",
            senales: `pdf-render+${veredictoOrigen.senales}`,
          };
          console.info(
            `[e14] origen pdf-render → escaneo (señales píxel preservadas: ${veredictoOrigen.senales})`,
          );
        }

        // ── D63-B — KIT e63b-deskew-escaneo-v1 (bloque de PRE-PROCESO, T2/T3):
        // SOLO escaneos (origen del detector D63-A) — detección de ángulo sobre
        // la banda del encabezado + deskew selectivo (|θ| ≥ 0.3° y ≤ 10°) con
        // resample de alta calidad + limpieza suave del punto blanco. Fotos y
        // escaneos rectos+limpios pasan el archivo ORIGINAL byte-idéntico (memo
        // de decode del bridge intacta — cero cambios). El pipeline consume el
        // master corregido (T2.2); el original duerme en IDB sin cambios.
        // D65: bloque AJENO byte-idéntico (ídem D63-A — se re-ejecuta).
        preProceso = await preProcesoEscaneo(archivoIntento, veredictoOrigen.origen);
        if (veredictoOrigen.origen === "escaneo") {
          console.info(
            `[e14] preproceso skewGrados=${preProceso.skewGrados ?? "null"} deskewMs=${preProceso.deskewMs ?? "null"} limpiezaMs=${preProceso.limpiezaMs ?? "null"} limpieza=${preProceso.limpieza} aplicado=${preProceso.aplicado} decodeMs=${preProceso.decodeMs ?? "null"}`,
          );
        }
        // ── D63-A2 (T0) — DISCIPLINA DE MEMORIA: si el CORREGIDO manda, el
        // master precalentado de esta fila muere AQUÍ (descartado por la vía
        // del precalor + referencia local soltada — NUNCA huérfano). El
        // precalor sigue decodificando el ORIGINAL en la espera (sin cambios
        // — simplicidad del kit): las filas PDF aplicadas pierden el
        // beneficio del precalor (doble decode por fila escaneada — coste
        // CONOCIDO y documentado: el OCR domina con ~13 s).
        if (preProceso?.aplicado && entradaPrecalor) {
          console.info(
            `[e14] precalor fila=${fila.id} descartado fuente=corregido precalorMs=${entradaPrecalor.precalorMs}`,
          );
          descartarMaestro(fila.id); // vía del precalor (idempotente — defensa)
          entradaPrecalor = null; // soltar el blob YA (no al fin del scope)
        }

        // ── D66 — KIT e14-decode-unico-precalor-v1 (T1.2/T1.5): MASTER del
        // intento. Intento 1 consume el master PRECALENTADO (T3.3 — el decode
        // ya vivió en la espera; entradaPrecalor se consumió ANTES de marcar
        // PROCESANDO). Reintentos (intento ≥ 2): horneado FRESCO del
        // archivoIntento — el File fue re-leído de IDB (D65) y el intento
        // muerto pudo envenenar la decodeMemo por-instancia del master
        // anterior. Sin master (decode imposible) → fallback HONESTO: el
        // bridge recibe archivoIntento tal cual (AC-P3).
        const tMaestro = Date.now();
        // ── D63-A2 (T0): FUENTE del master — el CORREGIDO del pre-proceso
        // (D63-B) cuando aplicó; el original en los demás casos. El bloque
        // D63-B calcula preProceso.archivo PERO la fusión D65/D66 lo dejó
        // desconectado (solo sus métricas llegaban — hallazgo del worklog
        // D65, orden del dueño: despertarlo AQUÍ y NADA más). El master
        // único D66 queda VERDADERO: el pipeline sigue consumiendo UN master
        // (`maestro?.archivo ?? archivoIntento` del bridge, sin tocar).
        const fuenteMaestro: File = preProceso?.aplicado
          ? preProceso.archivo
          : archivoIntento;
        const maestro: MaestroImagen | null =
          intento === 1 && !preProceso?.aplicado
            ? (entradaPrecalor?.maestro ??
              (await maestroDeImagen(fuenteMaestro, { nombre: fila.nombre })))
            : await maestroDeImagen(fuenteMaestro, { nombre: fila.nombre });
        const decodeMsIntento = maestro
          ? intento === 1 && entradaPrecalor
            ? 0 // T3.3/T4: precalentada → el decode ya pasó en la espera
            : Math.max(1, Math.round(Date.now() - tMaestro))
          : null;
        if (maestro) {
          console.info(
            `[e14] decode-maestro fila=${fila.id} intento=${intento} ms=${decodeMsIntento} origen=${maestro.origenDecode} precalentada=${intento === 1 && !!entradaPrecalor} ${maestro.ancho}x${maestro.alto}${preProceso?.aplicado ? " fuente=corregido" : ""}`,
          );
        }

        // T4: variable tipada con la intersección (sin excess-check de literal —
        // el parámetro de la interfaz E14Bridge sigue siendo OpcionesEscaneo).
        // D65 (T1): presupuesto del INTENTO — lo RESTANTE de WATCHDOG_MS (el
        // pre-proceso ya gastó lo suyo; el timeout del bridge dispara SU acta
        // de timeout exactamente en la frontera del intento).
        const opcionesMasiva: OpcionesEscaneoConTimeout = {
          objetivo: null, // A4 — la clasificación REAL manda (viene del OCR)
          intento: 1, // A6 — semántica de PRIMERA captura (el watchdog NO es re-captura)
          maxIntentos: 4, // fallos → RECHAZADA repetible / rescate por recorte manual
          fuente: "ARCHIVO", // A5 — MASIVA SIEMPRE archivo
          archivo: maestro?.archivo ?? archivoIntento, // D66 — el master (fallback: original)
          // D63-C — KIT e63c-quad-gate-escaneo-v1: origen del detector D63-A
          // alimenta T1 (quad página-completa) y T2 (gate del marco impreso).
          // SIM y el flujo individual JAMÁS lo traen (nada de escaneos les aplica).
          origenActa: veredictoOrigen.origen,
          onProgreso: (p) => {
            senal = { etapa: p.etapa, fraccion: p.progreso }; // etapa al morir (T1.4)
            marcarVida(fila.id, p); // señal de vida (T3 — throttle 250 ms)
          },
          timeoutMs: Math.max(5_000, WATCHDOG_MS - (Date.now() - tIntento)),
        };
        const resultado = await correrIntento(
          getBridge().escanearActa(opcionesMasiva),
          WATCHDOG_MS + WATCHDOG_GRACIA_MS,
        );
        if (resultado.tipo === "acta") {
          actaBruta = resultado.acta;
          // D66: el desenlace nació de ESTE master — fija sus trazas.
          maestroDesenlace = maestro;
          decodeMasterMs = decodeMsIntento;
          intentoDesenlace = intento;
          if (!esVeredictoTimeout(resultado.acta)) break; // desenlace REAL
          // veredicto-timeout del bridge → el intento MURIÓ (cae al final del
          // loop: traza + kill de workers + reintento si queda cupo).
        } else if (resultado.tipo === "error") {
          errorIntento = resultado; // error REAL → catch de siempre (fila ERROR)
          break;
        }
        // resultado.tipo === "tope" → el bridge nunca respondió: intento muerto.
      } catch (err) {
        errorIntento = { error: err }; // NUNCA es muerte de watchdog
        break;
      }
      watchdogUsados = intento;
      etapaAlMorir = etapaDeSenal(senal);
      elapsedMuerteMs = Date.now() - tIntento;
      console.info(
        `[e14] watchdog fila=${fila.id} intento=${intento}/${WATCHDOG_INTENTOS} etapa=${etapaAlMorir ?? "null"} elapsed=${elapsedMuerteMs}ms`,
      );
      if (intento >= WATCHDOG_INTENTOS) break; // kit T1.3: veredicto de siempre
      // D65 (T1.2): matar y re-crear los workers del intento (detección + OCR)
      // y relanzar UNA vez. El reintento es del MISMO procesado ya iniciado por
      // el dueño (no re-encola nada nuevo — D45 intacto; criterios/score intactos).
      await matarYRecrearWorkers();
      try {
        const fresco = await leerRegistro(fila.id);
        if (fresco.archivo instanceof File) {
          registro = fresco;
          archivoIntento = fresco.archivo;
        }
      } catch {
        /* IDB caído — el reintento usa la instancia actual (honesto) */
      }
    }
    if (errorIntento) throw errorIntento.error;
    if (!actaBruta) {
      // Colgaje FUERA del bridge (origen/pre-proceso) en TODOS los intentos:
      // el veredicto de SIEMPRE con la MISMA forma del acta de timeout del
      // bridge (score 0 — nada inventado).
      actaBruta = actaTimeoutWatchdog(fila.id);
    }
    // D57 (T1): parche INMUTABLE del diagnóstico (kit §4-T1). ADITIVO — no
    // toca score/status/gate; si el diagnóstico no existe (no debería: el
    // bridge lo monta en todo desenlace fuera de SIM), se omite el campo.
    // D63-A (T2): las trazas de origen viajan en el MISMO parche (aditivas,
    // al final del contrato D57 — origen/origenSenales, ver origen.ts).
    // D65: veredictoOrigen/preProceso son del ÚLTIMO intento ejecutado (si el
    // desenlace existe, al menos un intento completó sus bloques D63).
    const acta =
      actaBruta.diagnostico != null
        ? {
            ...actaBruta,
            diagnostico: {
              ...actaBruta.diagnostico,
              tiempos: { ...actaBruta.diagnostico.tiempos, esperaMs },
              origen: veredictoOrigen?.origen ?? null,
              origenSenales: veredictoOrigen?.senales ?? null,
              // D63-B (T2/T3): trazas del pre-proceso de escaneos (aditivas,
              // al final del contrato — null cuando no aplicó/no es escaneo).
              skewGrados: preProceso?.skewGrados ?? null,
              deskewMs: preProceso?.deskewMs ?? null,
              limpieza: preProceso?.limpieza ?? null,
              // D63-A2 (T0): provenance del master que el bridge CONSUMIÓ —
              // "corregido" (deskew aplicado) | "original". Aditivo al final
              // del contrato D57; el informe T2 lo consume como
              // preprocesoAplicado (bool, presente si origen escaneo).
              // preProceso existe SIEMPRE en MASIVA (nulo para no-escaneos →
              // "original") — null solo si no hay diagnóstico (jamás inventar).
              maestroFuente: preProceso
                ? preProceso.aplicado
                  ? ("corregido" as const)
                  : ("original" as const)
                : null,
            },
          }
        : actaBruta;

    // FIX M8 (auditoría 2-c): la decisión del dueño manda TAMBIÉN para el
    // ENVÍO — si quitó la fila mientras el OCR corría, el desenlace NO se
    // transmite (antes registrarEnvioMasiva corría ANTES del guard: fila de
    // historial + completadas + hueco archivado de un acta descartado).
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return;

    // ─── e63f — KIT e63f-autoenvio-v1 (F2): RE-LECTURA INTERNA antes de
    // «repetir-primero» ─── SUGERIDA/MANUAL con captura PERFECTA (score ≥ 8 ∧
    // lectura FUERTE ∧ gate completa) no vuelve a capturar: se RE-LEE el
    // MISMO bitmap (reconocerTexto — re-warp con el quad horneado SIN
    // re-detección + rapidocr a cap fino DET_CAP_PROD, la pasada-2 del
    // escalonado) → re-clasificar → re-evaluar el gate (desenlaceTrasRelec-
    // tura). AUTO → OPTIMA → autoenvío normal más abajo; si no → revisión
    // humana como hoy. UNA pasada MÁXIMA (RED LINE 5) y el humano NUNCA la
    // ve (intento de LECTURA, no de captura — el «repetir-primero» físico
    // del flujo individual NO cambia). NUNCA aplica a RECHAZADAS por calidad
    // (score < 6.5 — ahí re-escanear SÍ ayuda), ADVERTENCIA (red line) ni
    // gate incompleta. Trazas aditivas: token ` RelecturaInterna=` (D51) y
    // flag `relectura` en la fila. Cualquier falla interna (runtime OCR,
    // base divipol) deja el veredicto de siempre — jamás empeora.
    //
    // e63g (E1/F0): el bloque va envuelto en conTope (RELECTURA_TOPE_MS) —
    // era el ÚNICO await de la fila sin presupuesto propio (el watchdog D65
    // no lo cubre) y un colgaje de reconocerTexto congelaba la cola PARA
    // SIEMPRE. Tríada: valor → desenlace de la re-lectura; error →
    // sin-cambio (como el catch de siempre); VENCIDO → matarYRecrear-
    // Workers() + veredicto de la 1.ª lectura INTACTO (actaDesenlace sigue
    // siendo `acta`) + token `tope` (D51 aditivo) + CERO reintentos. La
    // traza SIEMPRE (también con tope).
    let actaDesenlace = acta;
    let relecturaDesenlace: "auto" | "sin-cambio" | null = null;
    let relecturaToken: "auto" | "sin-cambio" | "tope" | null = null;
    if (procedeRelecturaInterna(acta)) {
      const tRelectura = performance.now();
      const r = await conTope(
        (async () => {
          const textoRe = await getBridge().reconocerTexto(acta);
          const clasifRe = clasificarCabecera(textoRe, await cargarDivipol());
          return desenlaceTrasRelectura(acta, textoRe, clasifRe);
        })(),
        RELECTURA_TOPE_MS,
      );
      if (r.vencido) {
        // Tope vencido — infraestructura muerta y re-creada (misma doctrina
        // del watchdog T1.2); el VEREDICTO de la 1.ª lectura queda intacto.
        // La relectura JAMÁS reintenta (red line): sin-cambio y fuera.
        await matarYRecrearWorkers();
        relecturaDesenlace = "sin-cambio";
        relecturaToken = "tope";
      } else if ("valor" in r) {
        actaDesenlace = r.valor.acta;
        relecturaDesenlace = r.valor.desenlace;
        relecturaToken = r.valor.desenlace;
      } else {
        relecturaDesenlace = "sin-cambio";
        relecturaToken = "sin-cambio";
      }
      console.info(
        `[e14] relectura-interna fila=${fila.id} ms=${Math.round(performance.now() - tRelectura)} RelecturaInterna=${relecturaToken}`,
      );
    }

    // ─── e63k — KIT e63k-capa2-identidad-v1 (F1.4): CAPA 2 DEDUP POR
    // IDENTIDAD (punto ÚNICO del kit, POST-OCR) ─── La identidad nace SOLO
    // del código 1D consensuado (identidad.ts — RED LINE 2: sin consenso no
    // hay identidad, jamás regex suelto sobre el texto). La marca pre-OCR
    // quedó APLAZADA en la banda 3..6 (store); AQUÍ decide la serie impresa.
    const identidad = identidadDeActa(actaDesenlace);
    // ¿Original por identidad? OTRA fila (f.id !== fila.id) con la MISMA
    // identidadActa (13 dígitos = formulario+PAG — P1 y P2 del mismo
    // formulario son actas DISTINTAS, nunca se deduplican entre sí) en
    // estado LISTA|DUPLICADA; la de agregadaEn MÍNIMA es la original.
    // forzarDedupOff (el dueño pulsó PROCESAR IGUAL) manda sobre la capa 2.
    let originalIdentidad: FilaMasiva | null = null;
    if (identidad && !fila.forzarDedupOff) {
      originalIdentidad =
        useMasivaStore
          .getState()
          .filas.filter(
            (f) =>
              f.id !== fila.id &&
              f.serie != null &&
              f.serie.slice(0, 13) === identidad.identidadActa &&
              (f.estado === "LISTA" || f.estado === "DUPLICADA"),
          )
          .sort((a, b) => a.agregadaEn - b.agregadaEn)[0] ?? null;
      if (originalIdentidad) {
        // DUPLICADA por identidad — SU PROPIO desenlace (no el de la
        // original): NO reenvía, NO borra, revisión disponible. La capa 2
        // decide por CUALQUIER status del desenlace (un dup RECHAZADO por
        // blur de la misma acta también es dup) → return ANTES del envío y
        // del contador (kit §1.4-5). El guard anti-zombi M8 ya corrió antes
        // en el flujo (la fila está viva al llegar aquí) — NO se duplica.
        const thumbIdentidad = await hacerThumb(
          actaDesenlace.fotoProcesada ?? actaDesenlace.fotoOriginal,
        );
        await guardarRegistro({
          ...registro,
          estado: "DUPLICADA",
          dupOf: originalIdentidad.id,
          acta: actaDesenlace,
          thumb: thumbIdentidad,
          serie: identidad.serie,
          dedup: "identidad",
          infoTitulo: tituloDeActa(actaDesenlace),
          // e63m: el payload QR de esta fila viaja con SU desenlace (post-mortem).
          ...(qrPayload ? { qrPayload } : {}),
        });
        marcarFila(fila.id, {
          estado: "DUPLICADA",
          dupOf: originalIdentidad.id,
          statusActa: actaDesenlace.status,
          score: actaDesenlace.score,
          nivel: actaDesenlace.clasificacion?.nivel ?? null,
          pagina: paginaDeActa(actaDesenlace),
          infoTitulo: tituloDeActa(actaDesenlace),
          motivo: actaDesenlace.rechazo?.tipo ?? null,
          thumb: thumbIdentidad,
          enviadaAuto: false,
          // e63k (decisión declarada en el REPORTE §1): la serie TAMBIÉN al
          // mapa en memoria (regla general del kit — el mapa de identidad de
          // la sesión ve esta fila aunque la original se haya quitado).
          serie: identidad.serie,
          error: null,
        });
        console.info(
          `[e14] dedup-identidad fila=${fila.id} serie=${identidad.identidadActa} original=${originalIdentidad.id}`,
        );
        return; // NO registrarEnvioMasiva NI contarMotivoNoEnvioActa
      }
    }
    // Falso-positivo visual EVITADO (el caso 3992/3993 de la consola del
    // dueño — QA §3.2): la banda visual 3..6 la había dejado sospechosa y
    // la serie impresa demuestra que es OTRA acta → resolución final
    // "sin-match" en el registroListo de abajo (conservando dedupDistancia
    // y dedupVisualDe del write aplazado — post-mortem). La fila sigue al
    // envío normal — SU desenlace, NUNCA el de otra. La traza vive en el
    // REGISTRO (kit §1.2 — dedupVisualDe es de RegistroMasiva; el store no
    // la restaura a la fila).
    const dedupVisualDeAplazada = registro?.dedupVisualDe ?? null;
    // Solo se RESUELVE una banda que SIGUE aplazada (registro.dedup ===
    // "visual-aplazada"): jamás revertir un veredicto "identidad" previo
    // (el dueño pudo PROCESAR IGUAL una dup real — su traza queda intacta).
    const falsoPositivoEvitado =
      identidad != null &&
      originalIdentidad == null &&
      dedupVisualDeAplazada != null &&
      registro?.dedup === "visual-aplazada";
    if (falsoPositivoEvitado) {
      console.info(
        `[e14] dedup-identidad fila=${fila.id} falso-positivo-visual evitado serie=${identidad!.serie} original-visual=${dedupVisualDeAplazada}`,
      );
    }

    // Desenlace → la MISMA vía que el flujo normal (T3.3/T3.2). El envío
    // automático reutiliza registrarEnvio (historial + completadas + hueco
    // archivado + cola offline); el resto cae al contador T5 con las
    // MISMAS claves.
    let actaFinal = actaDesenlace;
    let enviadaAuto = false;
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): coste del ENVÍO del desenlace —
    // registrarEnvioMasiva (hash + historial + completadas + hueco archivado +
    // cola offline; la sección síncrona del envío). SOLO hay envío real ONLINE:
    // offline/EN COLA y no-OPTIMA → campo OMITIDO (jamás 0 falso — kit §2-T3).
    let envioMs: number | null = null;
    if (actaDesenlace.status === "OPTIMA") {
      // KIT e14-masiva-ux-v1 (T3.2): el envío respeta la conexión del momento
      // (misma semántica que registrarEnvio para actaActual): OFFLINE →
      // hashSha256 "EN COLA" — la fila pinta «EN COLA» y refrescarEnviosTrasDrenaje
      // la drena al reconectar. Online → el hash lo maneja el flujo normal.
      const onlineAlEnviar = useE14Store.getState().online;
      const tEnvio = onlineAlEnviar ? performance.now() : 0;
      useE14Store.getState().registrarEnvioMasiva(actaDesenlace);
      actaFinal = {
        ...actaDesenlace, // e63f F2: el desenlace POST re-lectura manda (si AUTO → clasificación nueva viaja al envío)
        status: "ENVIADA",
        enviadoAutomaticamente: getBridge().horaEnvio(),
        ...(onlineAlEnviar ? {} : { hashSha256: "EN COLA" }),
      };
      enviadaAuto = true;
      if (onlineAlEnviar) envioMs = Math.round(performance.now() - tEnvio);
    } else {
      useE14Store.getState().contarMotivoNoEnvioActa(actaDesenlace);
    }
    // D61 (T3): parche INMUTABLE del diagnóstico con envioMs — MISMO patrón
    // del parche esperaMs de D57 (spread, solo si diagnostico != null). Va
    // ANTES de construir registroListo → viaja en la PRIMERA persistencia.
    if (envioMs != null && actaFinal.diagnostico != null) {
      actaFinal = {
        ...actaFinal,
        diagnostico: {
          ...actaFinal.diagnostico,
          tiempos: { ...actaFinal.diagnostico.tiempos, envioMs },
        },
      };
    }

    const thumb = await hacerThumb(acta.fotoProcesada ?? acta.fotoOriginal);
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaFinal,
      thumb,
      // D59 — KIT e14-info-acta-filas-v1 (T2): título con la info reconocida
      // del desenlace REAL (persiste — desviación aditiva de thumb).
      infoTitulo: tituloDeActa(actaFinal),
      // e63k (F1.4): resolución final del FP visual evitado — "sin-match"
      // cierra la banda aplazada; dedupDistancia y dedupVisualDe quedan como
      // estaban (spread de arriba — post-mortem del falso positivo).
      ...(falsoPositivoEvitado ? { dedup: "sin-match" as const } : {}),
      // e63k (F1.4): regla general de persistencia de la serie (aplica
      // SIEMPRE que haya desenlace con identidad leída, también cuando NO
      // es dup — sirve al mapa de la cola y al informe). Ausente = sin
      // consenso (jamás inventar — RED LINE 2).
      ...(identidad ? { serie: identidad.serie } : {}),
      // D66 — KIT e14-decode-unico-precalor-v1 (T4): trazas de decodificación
      // ADITIVAS del master del DESENLACE (solo con master — sin él los
      // campos VIAJAN AUSENTES: registros previos/ERROR/fallback quedan como
      // hoy — jamás inventar). decodeMs top-level ≠ tiempos.decodeMs (D61 —
      // decode del archivo por el bridge; semánticas distintas, ambas honestas).
      ...(maestroDesenlace
        ? {
            decodeMs: decodeMasterMs ?? 0,
            origenDecode: maestroDesenlace.origenDecode,
            precalentada: intentoDesenlace === 1 && !!entradaPrecalor,
            precalorMs:
              intentoDesenlace === 1 ? (entradaPrecalor?.precalorMs ?? null) : null,
          }
        : {}),
      // e63m — payload QR de la CAPA 0 (llave opaca): campo ADITIVO AL FINAL
      // (contrato D57) — absent = sin-payload (jamás inventar). Export-only.
      ...(qrPayload ? { qrPayload } : {}),
    };
    // FIX M14 (auditoría 2-c): persistencia fallida TRAS el envío — la fila
    // NO pasa a ERROR (el acta SÍ se transmitió; una fila ERROR invita a
    // reprocesar → doble envío tras recarga) y el registro JAMÁS queda
    // PENDIENTE con el archivo (el reproceso automático re-enviaría).
    // Reintento MÍNIMO: estado LISTA + desenlace liviano, SIN el acta
    // completa (la causa típica del fallo es quota — el registro con acta
    // de ~15 MB no cabe; el liviano sí).
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): la MISMA ventana mide ahora la
    // persistencia del desenlace (guardarRegistro principal + fallback
    // liviano — kit §2-T3): persistMs = coste REAL del write que el usuario
    // experimenta. Si ambos writes fallan, el campo se OMITE (sin dato —
    // jamás inventar).
    let persistMs: number | null = null;
    const tPersist = performance.now();
    try {
      await guardarRegistro(registroListo);
      persistMs = Math.round(performance.now() - tPersist);
    } catch {
      try {
        await guardarRegistro({ ...registro, estado: "LISTA", thumb });
        persistMs = Math.round(performance.now() - tPersist);
      } catch {
        /* IDB caída del todo — la fila vive honesta en memoria (LISTA);
           persistMs se omite (sin dato — jamás inventar). */
      }
    }
    // D61 (T3) — re-save de INSTRUMENTO (FUERA del desenlace): persistMs nace
    // DEL write que lo mide (paradoja del instrumento — no puede viajar dentro
    // de él). Con el valor ya medido, parchea el diagnóstico (patrón inmutable
    // de esperaMs) y re-persiste para que sobreviva la recarga (kit T5 — IDB).
    // Best-effort y SILENCIOSO: si falla, IDB se queda con el write 1 —
    // desenlace INTACTO (sin este campo; honesto). El liviano del fallback no
    // lleva acta → sin diagnóstico → no hay nada que parchear (omitido).
    if (persistMs != null && registroListo.acta?.diagnostico != null) {
      try {
        await guardarRegistro({
          ...registroListo,
          acta: {
            ...registroListo.acta,
            diagnostico: {
              ...registroListo.acta.diagnostico,
              tiempos: {
                ...registroListo.acta.diagnostico.tiempos,
                persistMs,
              },
            },
          },
        });
      } catch {
        /* el write 1 manda — persistMs viaja solo si este re-save cabe */
      }
    }
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaFinal.status,
      score: actaFinal.score,
      nivel: actaFinal.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaFinal),
      infoTitulo: tituloDeActa(actaFinal), // D59 — KIT e14-info-acta-filas-v1 (T2)
      motivo: actaFinal.rechazo?.tipo ?? null,
      thumb,
      enviadaAuto,
      envioEnCola: actaFinal.hashSha256 === "EN COLA", // KIT e14-masiva-ux-v1 (T3.2)
      // e63f (F2): el desenlace pasó por la re-lectura interna (trazabilidad
      // — el detalle auto|sin-cambio vive en la traza RelecturaInterna=).
      relectura: relecturaDesenlace != null,
      // e63k (F1.4): serie impresa al mapa de la cola (identidad capa 2).
      serie: identidad?.serie ?? null,
      error: null,
    });
  } catch (err) {
    // Errores de IDB/decode/pipeline NUNCA tumban la UI (kit §3): la
    // entrada pasa a ERROR con motivo corto (repetible — quitar y
    // re-soltar la foto vuelve a encolarla).
    // FIX M8-b (auditoría 2-c): el guard anti-zombi TAMBIÉN en el catch —
    // re-persistir el registro de una fila QUITADA lo revivía al recargar.
    if (!useMasivaStore.getState().filas.some((f) => f.id === fila.id)) return;
    // D59 — KIT e14-info-acta-filas-v1 (T2): la fila ERROR NUNCA muestra
    // título viejo (infoTitulo: null — limpiar en el catch).
    marcarFila(fila.id, {
      estado: "ERROR",
      error: motivoCorto(err),
      infoTitulo: null,
      thumb: undefined,
    });
    if (registro) {
      try {
        await guardarRegistro({
          ...registro,
          estado: "ERROR",
          // e63m: si el QR decodificó antes de que el pipeline fallara, el
          // payload viaja también en la fila ERROR (post-mortem honesto).
          ...(qrPayload ? { qrPayload } : {}),
          // D65 (T1.4): si un intento murió por watchdog antes del error real,
          // la traza sobrevive también en la fila ERROR (honesto).
          ...(watchdogUsados > 0
            ? {
                watchdog: watchdogUsados,
                ...(etapaAlMorir != null ? { etapaAlMorir } : {}),
                ...(elapsedMuerteMs != null ? { elapsedMs: elapsedMuerteMs } : {}),
              }
            : {}),
        });
      } catch {
        /* IDB otra vez — la fila ya quedó ERROR en memoria (honesto) */
      }
    }
  } finally {
    const progreso = useMasivaStore.getState().progreso;
    if (progreso?.id === fila.id) useMasivaStore.setState({ progreso: null });
  }
}

async function bucle(): Promise<void> {
  while (!stopFlag) {
    const fila = siguientePendiente();
    if (!fila) break;
    // D66 — KIT e14-decode-unico-precalor-v1: prefetch RE-APUNTADO (D61) —
    // al iniciar N se asegura el MASTER de N+1 (decode oculto tras el OCR
    // de N, AC-P1 intacto) vía el precalor. El consumo vive en procesarUno
    // (consumirMaestro — el master de N pudo venir del precalor de la cola
    // ociosa o de este prefetch; DUPLICADA no consume master: es copia).
    dispararPrefetch(fila.id);
    await procesarUno(fila);
  }
}

/** D66 — KIT e14-decode-unico-precalor-v1 (prefetch D61 re-apuntado, T3.1):
 *  asegura el MASTER de la próxima fila pipeline-able (PENDIENTE, no temp,
 *  no DUPLICADA) con `ignorarOciosidad` — el decode de N+1 se esconde tras
 *  el OCR de N igual que hoy (AC-P1), pero produce el master que el
 *  pipeline SÍ consume (la memo del original quedó sin consumidor).
 *  Idempotente (asegurarMaestro no duplica) y jamás bloquea: si falla, la
 *  fila procesa con build inline o fallback (AC-P2). */
function dispararPrefetch(filaActualId: string): void {
  if (stopFlag) return;
  const proxima = useMasivaStore
    .getState()
    .filas.filter(
      (f) =>
        f.estado === "PENDIENTE" &&
        f.id !== filaActualId &&
        !f.id.startsWith("masiva-temp-"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn)[0];
  if (!proxima) return;
  void asegurarMaestro(proxima.id);
}

/** UN solo runner global (módulo singleton) — `iniciar()` double-call →
 *  no-op (kit §4 regla 1). */
export function iniciarRunner(): void {
  if (corriendoFlag) return;
  corriendoFlag = true;
  stopFlag = false;
  colaSesionIniciada = true; // e63g FASE 1: sesión viva — el swap puede rearrancar
  useMasivaStore.setState({ corriendo: true });
  void bucle().finally(() => {
    corriendoFlag = false;
    useMasivaStore.setState({ corriendo: false, progreso: null });
  });
}

/** Pausa MANUAL: stop = true — el OCR en vuelo TERMINA (no hay aborto a
 *  mitad de pipeline; la fila queda LISTA/ERROR y el loop no toma la
 *  siguiente). PROCESAR retoma donde iba. También lo llama la AUTO-PAUSA
 *  al abrir un acta en REVISIÓN (kit §4 regla 2 — el flujo de revisión usa
 *  el main thread y actaActual, no pelear). Reanudar es MANUAL (botón). */
export function pausarRunner(): void {
  stopFlag = true;
}

/** e63g — PLAN e63g-e63h-ruta-unica (E1/FASE 1): RE-ARRANQUE del bucle tras
 *  el swap temp→id real (lo llama `agregarFiles` del store). El agujero:
 *  `siguientePendiente` salta los ids `masiva-temp-` — si la copia a IDB
 *  aterriza DESPUÉS de que el bucle rompió (cola que se vació mientras el
 *  lote copiaba), las filas nuevas quedaban PENDIENTE para siempre.
 *  Guard IDEMPOTENTE (triple):
 *  · sesión fría (el dueño JAMÁS pulsó PROCESAR) → NO arranca (D45
 *    intacto: encolar no procesa por sí solo);
 *  · pausa activa (stopFlag — manual o auto-pausa de REVISIÓN) → NO
 *    arranca (reanudar es MANUAL — contrato del botón);
 *  · cola viva → iniciarRunner() es no-op (corriendoFlag) y el bucle vivo
 *    toma las nuevas en su siguiente pasada.
 *  El re-check va DIFERIDO (macrotask): cierra la ventana en la que el
 *  bucle rompe ENTRE el swap y este llamado — al disparar el timer el
 *  `finally` del bucle ya limpió corriendoFlag, y si hay pendientes
 *  reales el bucle renace exactamente por la puerta de siempre. */
export function rearrancarTrasEncolar(): void {
  if (!colaSesionIniciada || stopFlag) return;
  setTimeout(() => {
    if (stopFlag) return; // pausa llegando tarde — el dueño manda
    if (siguientePendiente()) iniciarRunner();
  }, 0);
}
