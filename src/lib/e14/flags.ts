/**
 * KIT e14-observabilidad-v1 (A1-C7) — flags de la app (leerFlags/refrescar
 * Flags del contrato §4.3). Cadena de prioridad:
 *
 *   DEFAULTS ← public/flags.json (remoto, cacheado 24 h, offline-safe)
 *            ← overrides localStorage (MÁXIMA prioridad — el kill switch
 *              MANUAL del dueño, D6: la app JAMÁS se auto-configura).
 *
 * flags.json es un archivo ESTÁTICO en public/ (hoy NO existe → «sin-
 * endpoint»): el dueño lo puede desplegar/editar sin tocar el código —
 * same-origin con NEXT_PUBLIC_BASE_PATH (mismo patrón PUBLIC_BASE del core).
 *
 * SIN dependencias nuevas: fetch nativo + reintentos exponenciales.
 */
import { leerOverridesFlags } from "./obs/politica";
import type { FlagsApp } from "./obs/tipos";
import {
  HEIC_LIMITE_MS_DEFECTO,
  HEIC_TOPE_MP_DEFECTO,
  type OpcionesRescateHeic,
} from "@jg-stevan/scanner-core/core/image-processor";

const PUBLIC_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const REINTENTO_BASE_MS = 60_000;
const REINTENTO_TOPE_MS = REFRESH_MS;

/** Defaults del contrato §4.2 (ocrThreadsTope 4 · telemetriaSalud true ·
 *  endpointReportes null — sin backend, D1 · hangEnCurso true — KIT
 *  e14-obs-hang-atribucion-v1 §D: sensor hang-en-curso, kill-switch del
 *  dueño · qrBrujulaOrientacion true · ocrCascada false).
 *  NOTA (eliminación del módulo masiva): los 17 flags exclusivos de la cola
 *  MASIVA (poolWorkers · thumbsOn · colaPersistente · sondeoQr* · prescan* ·
 *  masiva* · dhashResize) se retiraron junto con el módulo. El flag
 *  `masivaOcrTesseract` se RENOMBRA a `ocrCascada`: su feature (la cascada
 *  OCR del pipeline general) NO era exclusiva de masiva, pero el nombre sí
 *  era herencia del kit que la introdujo. */
export const FLAGS_DEFAULT: FlagsApp = {
  ocrThreadsTope: 4,
  telemetriaSalud: true,
  endpointReportes: null,
  hangEnCurso: true,
  // KIT e14-orientacion-qr-v1 (§D): QR-brújula de orientación — el cuadrante
  // del QR manda la rotación y el rescate hi-res (ZXing) solo corre si
  // jsQR@warp falla (bench v8.3: 4/4 con fotos arrugadas/blotchy donde
  // jsQR 0/4). Kill-switch del dueño: OFF = sondeo OCR de siempre byte a
  // byte (el probe D56 queda como red de seguridad).
  qrBrujulaOrientacion: true,
  // KIT e14-ocr-cascada-v1 (K3 fase 2) + GO-B del dueño (2026-11): CASCADA
  // OCR — intento 1 = TESSERACT BEST (ocr/tesseract.ts — spa 4.0.0_best,
  // vendido, worker propio, budget 60 s) → GATE (clasificador puro) → core
  // RapidOCR escalonado como siempre (1280→1920→elegirMejor) → rescate por
  // ROIs top/bottom. Default ON por decisión del dueño («tess best primero,
  // escalonado a pp ocr»); kill-switch: override {"ocrCascada": false} ⇒
  // OCR escalonado de siempre byte a byte (sin descarga de Tess).
  ocrCascada: true,
  // KIT e14-adaptacion-dispositivo-v1 — adaptación automática al dispositivo
  // (petición del dueño): el tier consume knobs de RECURSOS (hilos OCR —
  // adaptacion/plan.ts). Override manual manda (D6); false = byte-idéntico.
  adaptacionDispositivo: true,
  // KIT e14-ocr-tessbest-v1 (GO-B) — presupuesto del ESCANEO individual.
  // null = plan por tier (BAJO 480 s · MEDIO 240 s · ALTO 120 s — evidencia
  // sim-gama-baja: el timeout fijo de 120 s rechazaba actas perfectas en
  // mono-hilo). Override manual del dueño (D6): número en ms, clamp 30-900 s.
  presupuestoEscaneoMs: null,
  // KIT e14-capa0-qr-worker-v1 — la capa 0 QR de la cámara corre su cadena
  // jsQR en WORKER (presupuesto real por tier + fases/fin — port D40+R1.1+
  // R1.4-b de supervision-e14). Kill-switch del dueño: false = camino de HOY
  // byte-idéntico (main thread, tiers "base").
  capa0QrWorker: true,
  // KIT e14-probe-mini768-v1 (port del kit de supervision-e14) — lado mayor de
  // la MINIATURA del sondeo de orientación. El FALLO SEGURO (miniaturaConfiada)
  // NO cambia de umbrales: la mini manda solo con evidencia fuerte (corte sana o
  // confirmada, o rotación aplicada con ≥2 anclas y conf ≥0.6), así que subir la
  // resolución cambia CUÁNDO se alcanza esa evidencia, no qué se decide. A 320 el
  // E-14 sub-lee y el probe paga el sondeo completo de 4 rotaciones casi siempre.
  // Override: {"probeMiniLado":320} = comportamiento anterior byte-idéntico.
  probeMiniLado: 1280,
  // KIT e14-heic-tope-v1 — el rescate HEIC del core topado por producto, no por
  // el motor: heic2any 0.0.4 no admite `width`/`height`, así que decode a
  // resolución NATIVA es lo que hay y un 50 MP no termina nunca (medido en el
  // A56: 12 MP = 6 913 ms; 50 MP = watchdog de 120 s y acta sin rastro). El
  // default es el mismo que publica el core (HEIC_TOPE_MP_DEFECTO /
  // HEIC_LIMITE_MS_DEFECTO); override {"heicTopeMp":0,"heicLimiteMs":0} =
  // camino anterior, sin red de seguridad.
  heicTopeMp: HEIC_TOPE_MP_DEFECTO,
  heicLimiteMs: HEIC_LIMITE_MS_DEFECTO,
  // KIT e14-autoenvio-recorte-v1 — tras un RECORTE manual que pasa a
  // OPTIMA: ¿se envía automáticamente (como captura normal) o se queda en
  // REVISIÓN esperando envío manual? Default true (comportamiento actual
  // G4 del gate v2); false = el recorte NUNCA auto-envía (dueño decide).
  autoEnvioConRecorte: true,
  // ─── KIT e14-velocidad-5s-v1 — tres knobs ADITIVOS AL FINAL (D57) ───────
  // Lado mayor de la foto que entra al trabajo (importación + warp + realce).
  // Medido en el A56: a 4032 el warp+realce paga 2 256 ms y el decode 1 300;
  // a 2560 el área cae 2,5× y la lectura del OCR no se mueve (el det ya va
  // capped a 1280 y el rec a REC_WMAX=480). 4032 = hoy byte-idéntico.
  ladoMaxTrabajoPx: 2560,
  // Piso escénico de ANALIZANDO (D16). Era 1 200 ms + 350 de cierre: con un
  // pipeline de 4 s eso solo era el 40 % del tiempo del puesto.
  pisoEscenicoMs: 300,
  // D88 (2026-11-10): intento 1 = Tesseract fast (mismo veredicto que best en
  // 24 pares medidos y 1,5-2,8× más rápido); PP-OCRv4 queda de respaldo.
  // true = kill-switch del dueño al orden anterior (RapidOCR 1280 primero y
  // Tesseract solo como rescate final).
  ocrPrimeraPasadaRapida: false,
  // Ruta corta del IMPORTAR: las dimensiones se leen del contenedor del JPEG
  // (256 KB, sin decodificar) y la foto que ya está dentro del tope pasa como
  // llegó. false = el camino robusto de siempre (data URL + decode + canvas +
  // FileReader), medido en 1 500-2 200 ms CONGELANDO el hilo principal.
  importRutaCorta: true,
  // ─── KIT e14-velocidad-5s-v1 (fase rec) — el A56 con el rec corre a 7,7 de 8
  // núcleos (medido con /proc/stat DURANTE la corrida, 2026-11-05): no hay
  // holgura para más workers/hilos, solo menos cálculo. Estos tres knobs mueven
  // el tensor del rec (n·h·W) y el flag `ocrLeerBw` ahorra UN warp completo.
  // `ocrRecWmax`/`ocrRecLote`/`ocrLeerBw`/`ocrRecSuave`/`ocrRecWfija` siguen en
  // su valor de siempre (byte-idéntico); los cuatro de abajo se movieron con
  // serie A/B/A encima — ver el bloque de evidencia pegado a `ocrRecAltura`.
  ocrRecWmax: 480,
  // A/B/A del 2026-11-05 en el A56 (series A1/A2 con 48/0/0/8, D1 y E1 con
  // 40/14/14/7 sobre las 6 actas del corpus): los desenlaces son IDÉNTICOS
  // (10/8.5/10/8.9/10/8.6, 6/6 auto-envío, mismas anclas y chars) y el `rec`
  // baja de ~4,7 s a ~3,9 s de mediana. ALTURA 40 es el piso útil: con 32 se
  // pierde «SUMA TOTAL» y aparece el techo `recortada`. CABECERA/PIE 14 leen
  // solo las dos zonas con contenido del acta y BORDES 7 deja el rescate por
  // bordes encendido como red — 085053 (35 cajas) lo dispara y no ahorra nada,
  // pero ninguna de las dos series perdió una letra con él apagado.
  ocrRecAltura: 40,
  ocrRecLote: 6,
  ocrLeerBw: false,
  ocrRecSuave: false,
  ocrRecWfija: false,
  ocrRecCabecera: 14,
  ocrRecPie: 14,
  ocrRecBordesRescate: 7,
  ladoOcrPx: 0,
  cierreInstantaneo: false,
  // Pases del jsQR sobre el WARP completo antes del rescate HR guiado por el
  // quad. 0 = directo al HR. Medido en el A56 con las 6 actas reales y la
  // Serie A/B/A del 2026-11-05 (override 0 vs default 3, misma config por lo
  // demás): la brújula bajó en 6/6 corridas (−145 a −445 ms) y el desenlace NO
  // cambió en ninguna — same score (10/8.5/10/8.9/10/8.6), mismas anclas y
  // MISMO número de caracteres, y las 6 leyeron el QR por `zxing-hr` (el bench
  // v8.3 ya decía 0/4 de acierto del warp: la marca queda en ~110 px). Riesgo
  // asumido y acotado: si a un acta le hiciera falta un pase de warp y el HR
  // falla, no se pierde información — cae al sondeo de orientación (lento,
  // 6-14 s, pero correcto). override {"qrBrujulaWarpPases":3} = el seguro de
  // la config anterior.
  qrBrujulaWarpPases: 0,
  ocrReOcrRoi: false,
  ocrSegundaTopeMs: 0,
  // KIT e14-remediacion-movil-v1 (A1): ventana de ARRANQUE de la 2.ª pasada
  // como flag del dueño (override MANUAL — doble whitelist). null = el plan
  // por tier (BAJO 15 s · MEDIO/ALTO 45 s — postura 2 de A1). Número =
  // override MANUAL clampado. El modo por tier sigue en adaptacion/plan.ts
  // (roi-cabecera) y la fórmula k·ms1 del bridge es la garantía dura.
  ocrSegundaPresupuestoMs: null,
  // KIT e14-velocidad-5s-v1 — RECHAZO TEMPRANO. El guard de completitud condena
  // sin leer una letra (geometría del quad + fiduciales medidos sobre la
  // procesada), y `completa` se copia de esa verificación: si ya dijo
  // `completa:false`, NINGÚN texto del mundo cambia el desenlace — el acta es
  // RECHAZADA/contingencia igual. Sin embargo la escalada de OCR se corría por
  // inercia: 084939 pagó 4,78 s de 1.ª pasada + 3,99 de re-OCR 1920 + 3,37 de
  // ROI para un acta ya condenada. true = cuando el veredicto está bloqueado AN
  // TES del OCR se cobra UNA sola pasada (1280) y se corta ahí; false = hoy.
  ocrCorteIncompleta: true,
};

/** Último flags.json bueno (null = nunca llegó). */
let remotosCacheados: Partial<FlagsApp> | null = null;

/** Saneo del JSON remoto/overrides: solo claves conocidas y tipos válidos
 *  (jamás confiar en lo que llega por red/archivo). */
export function sanearFlags(o: unknown): Partial<FlagsApp> {
  if (typeof o !== "object" || o === null) return {};
  const p = o as Partial<FlagsApp>;
  const limpio: Partial<FlagsApp> = {};
  if (typeof p.ocrThreadsTope === "number" && Number.isFinite(p.ocrThreadsTope)) {
    limpio.ocrThreadsTope = Math.max(1, Math.min(8, Math.round(p.ocrThreadsTope)));
  }
  if (typeof p.telemetriaSalud === "boolean") limpio.telemetriaSalud = p.telemetriaSalud;
  // 0.5/S3 (plan de remediación) — `endpointReportes` ya no pasa como cualquier
  // string: SOLO null (apagado), un https absoluto válido, o un http de ORIGEN
  // LOCAL (localhost / IP privada / `.local` mDNS — doctrina del hub-local; es
  // lo que usan los harnesses QA y lo que el CSP ya permite). `http://` ajeno
  // o basura ⇒ la clave NO se aplica (default null).
  if (p.endpointReportes === null) {
    limpio.endpointReportes = null;
  } else if (typeof p.endpointReportes === "string" && p.endpointReportes.trim()) {
    try {
      const u = new URL(p.endpointReportes);
      const local =
        u.hostname === "localhost" ||
        u.hostname.endsWith(".local") || // mDNS RFC 6762 — no enrutable
        /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
      if (u.protocol === "https:" || (u.protocol === "http:" && local)) {
        limpio.endpointReportes = p.endpointReportes;
      }
    } catch {
      /* basura → la clave no se aplica (default null) */
    }
  }
  // KIT e14-obs-hang-atribucion-v1 (§D) — whitelist aditiva (booleano).
  if (typeof p.hangEnCurso === "boolean") limpio.hangEnCurso = p.hangEnCurso;
  // KIT e14-orientacion-qr-v1 (§D) — whitelist aditiva (booleano).
  if (typeof p.qrBrujulaOrientacion === "boolean") limpio.qrBrujulaOrientacion = p.qrBrujulaOrientacion;
  // KIT e14-ocr-cascada-v1 (K3 fase 2) — whitelist aditiva (booleano).
  if (typeof p.ocrCascada === "boolean") limpio.ocrCascada = p.ocrCascada;
  // KIT e14-adaptacion-dispositivo-v1 — whitelist aditiva (booleano).
  if (typeof p.adaptacionDispositivo === "boolean") limpio.adaptacionDispositivo = p.adaptacionDispositivo;
  // KIT e14-ocr-tessbest-v1 (GO-B) — whitelist aditiva (null o ms clampados).
  if (p.presupuestoEscaneoMs === null) limpio.presupuestoEscaneoMs = null;
  if (typeof p.presupuestoEscaneoMs === "number" && Number.isFinite(p.presupuestoEscaneoMs)) {
    limpio.presupuestoEscaneoMs = Math.max(30_000, Math.min(900_000, Math.round(p.presupuestoEscaneoMs)));
  }
  // KIT e14-capa0-qr-worker-v1 — whitelist aditiva (booleano).
  if (typeof p.capa0QrWorker === "boolean") limpio.capa0QrWorker = p.capa0QrWorker;
  // KIT e14-probe-mini768-v1 — whitelist aditiva (número clampado). Fuera de
  // rango o basura ⇒ la clave no se aplica y manda el default; nunca un 0.
  if (typeof p.probeMiniLado === "number" && Number.isFinite(p.probeMiniLado)) {
    limpio.probeMiniLado = Math.max(320, Math.min(1280, Math.round(p.probeMiniLado)));
  }
  // KIT e14-heic-tope-v1 — whitelist aditiva (números clampados). Acá 0 SÍ es
  // legal y significa «sin tope / sin límite» = el camino anterior; por eso el
  // clamp es [0, tope] y no [1, tope]. Basura o fuera de rango ⇒ manda default.
  if (typeof p.heicTopeMp === "number" && Number.isFinite(p.heicTopeMp)) {
    limpio.heicTopeMp = Math.max(0, Math.min(60, Math.round(p.heicTopeMp)));
  }
  if (typeof p.heicLimiteMs === "number" && Number.isFinite(p.heicLimiteMs)) {
    limpio.heicLimiteMs = Math.max(0, Math.min(110_000, Math.round(p.heicLimiteMs)));
  }
  // KIT e14-autoenvio-recorte-v1 — whitelist aditiva (booleano).
  if (typeof p.autoEnvioConRecorte === "boolean") limpio.autoEnvioConRecorte = p.autoEnvioConRecorte;
  // KIT e14-velocidad-5s-v1 — whitelist aditiva. El tope de trabajo solo se
  // aplica en múltiplos útiles y jamás por encima de lo que saca el sensor.
  if (typeof p.ladoMaxTrabajoPx === "number" && Number.isFinite(p.ladoMaxTrabajoPx)) {
    limpio.ladoMaxTrabajoPx = Math.max(1024, Math.min(4032, Math.round(p.ladoMaxTrabajoPx)));
  }
  if (typeof p.pisoEscenicoMs === "number" && Number.isFinite(p.pisoEscenicoMs)) {
    limpio.pisoEscenicoMs = Math.max(0, Math.min(1200, Math.round(p.pisoEscenicoMs)));
  }
  if (typeof p.ocrPrimeraPasadaRapida === "boolean") limpio.ocrPrimeraPasadaRapida = p.ocrPrimeraPasadaRapida;
  if (typeof p.importRutaCorta === "boolean") limpio.importRutaCorta = p.importRutaCorta;
  // ─── KIT e14-velocidad-5s-v1 (fase rec) — whitelist aditiva. 0 no es un
  // valor útil acá (un tensor de alto 0 revienta el run), por eso el piso es
  // el propio del modelo, no cero.
  if (typeof p.ocrRecWmax === "number" && Number.isFinite(p.ocrRecWmax)) {
    limpio.ocrRecWmax = Math.max(160, Math.min(960, Math.round(p.ocrRecWmax)));
  }
  if (typeof p.ocrRecAltura === "number" && Number.isFinite(p.ocrRecAltura)) {
    limpio.ocrRecAltura = Math.max(24, Math.min(64, Math.round(p.ocrRecAltura / 4) * 4));
  }
  if (typeof p.ocrRecLote === "number" && Number.isFinite(p.ocrRecLote)) {
    limpio.ocrRecLote = Math.max(1, Math.min(12, Math.round(p.ocrRecLote)));
  }
  if (typeof p.ocrLeerBw === "boolean") limpio.ocrLeerBw = p.ocrLeerBw;
  if (typeof p.ocrRecSuave === "boolean") limpio.ocrRecSuave = p.ocrRecSuave;
  if (typeof p.ocrRecWfija === "boolean") limpio.ocrRecWfija = p.ocrRecWfija;
  if (typeof p.ocrRecCabecera === "number" && Number.isFinite(p.ocrRecCabecera)) {
    limpio.ocrRecCabecera = Math.max(0, Math.min(60, Math.round(p.ocrRecCabecera)));
  }
  if (typeof p.ocrRecPie === "number" && Number.isFinite(p.ocrRecPie)) {
    limpio.ocrRecPie = Math.max(0, Math.min(60, Math.round(p.ocrRecPie)));
  }
  if (typeof p.ocrRecBordesRescate === "number" && Number.isFinite(p.ocrRecBordesRescate)) {
    limpio.ocrRecBordesRescate = Math.max(0, Math.min(10, Math.round(p.ocrRecBordesRescate)));
  }
  if (typeof p.ladoOcrPx === "number" && Number.isFinite(p.ladoOcrPx)) {
    limpio.ladoOcrPx = Math.max(0, Math.min(4032, Math.round(p.ladoOcrPx)));
  }
  if (typeof p.cierreInstantaneo === "boolean") limpio.cierreInstantaneo = p.cierreInstantaneo;
  if (typeof p.qrBrujulaWarpPases === "number" && Number.isFinite(p.qrBrujulaWarpPases)) {
    limpio.qrBrujulaWarpPases = Math.max(0, Math.min(3, Math.round(p.qrBrujulaWarpPases)));
  }
  if (typeof p.ocrReOcrRoi === "boolean") limpio.ocrReOcrRoi = p.ocrReOcrRoi;
  if (typeof p.ocrSegundaTopeMs === "number" && Number.isFinite(p.ocrSegundaTopeMs)) {
    limpio.ocrSegundaTopeMs = Math.max(0, Math.min(120_000, Math.round(p.ocrSegundaTopeMs)));
  }
  // KIT e14-remediacion-movil-v1 (A1) — whitelist aditiva (null o ms clampados).
  if (p.ocrSegundaPresupuestoMs === null) limpio.ocrSegundaPresupuestoMs = null;
  if (typeof p.ocrSegundaPresupuestoMs === "number" && Number.isFinite(p.ocrSegundaPresupuestoMs)) {
    limpio.ocrSegundaPresupuestoMs = Math.max(5_000, Math.min(120_000, Math.round(p.ocrSegundaPresupuestoMs)));
  }
  if (typeof p.ocrCorteIncompleta === "boolean") limpio.ocrCorteIncompleta = p.ocrCorteIncompleta;
  return limpio;
}

/** leerFlags() del contrato — SYNC: defaults ← remotos cacheados (si el
 *  refresco ya llegó) ← overrides (máxima prioridad). Nunca lanza. */
export function leerFlags(): FlagsApp {
  let flags: FlagsApp = { ...FLAGS_DEFAULT };
  try {
    if (remotosCacheados) flags = { ...flags, ...remotosCacheados };
    const overrides = sanearFlags(leerOverridesFlags());
    flags = { ...flags, ...overrides };
  } catch {
    /* silencioso — defaults */
  }
  return flags;
}

/** Opciones del rescate F-HEIC del core (KIT e14-heic-tope-v1). Un solo lector
 *  de los dos flags para los DOS sitios que decodifican un File (useDestello y
 *  la memo del bridge): si cada uno copiara los números, un override del dueño
 *  se aplicaría a medias y el acta se comportaría distinto según de dónde venga. */
export function opcionesRescateHeic(): OpcionesRescateHeic {
  const f = leerFlags();
  return { topeMpHeic: f.heicTopeMp, limiteMsHeic: f.heicLimiteMs };
}

/** Un intento de refresco (fetch de flags.json). Distinción honesta para
 *  el contrato: "sin-endpoint" (404 — no está servido), null (fallo de
 *  RED/parseo — el caller clasifica "error") o el JSON saneado. */
async function intentarFetch(): Promise<Partial<FlagsApp> | "sin-endpoint" | null> {
  try {
    if (typeof fetch !== "function") return "sin-endpoint";
    const res = await fetch(`${PUBLIC_BASE}/flags.json`, { cache: "no-store" });
    if (!res.ok) return "sin-endpoint";
    return sanearFlags(await res.json());
  } catch {
    return null; // offline / cuerpo corrupto → "error" (fallback al cache)
  }
}

let refreshProgramado = false;
let reintentoMs = REINTENTO_BASE_MS;
let timerRefresh: number | null = null;

/** Programar el próximo intento: 24 h tras un éxito; backoff exponencial
 *  (1m → 2m → 4m … cap 24 h) tras un fallo — offline-safe. Idempotente. */
function programarProximo(ms: number): void {
  if (refreshProgramado || typeof window === "undefined") return;
  refreshProgramado = true;
  timerRefresh = window.setTimeout(() => {
    refreshProgramado = false;
    void refrescarFlags();
  }, ms);
  if (timerRefresh !== null && typeof timerRefresh === "object" && "unref" in timerRefresh) {
    (timerRefresh as { unref: () => void }).unref?.();
  }
}

/** refrescarFlags() del contrato — «ok" | "sin-endpoint" | "error"»:
 *  · "sin-endpoint": no hay flags.json servido (404/ausente — el estado
 *    actual del repo). Defaults + overrides mandan.
 *  · "ok": remotos cacheados (leerFlags los aplica ya).
 *  · "error": fallo de red — fallback al último cacheado (o defaults).
 *  Con éxito reprograma el refresco a 24 h; con fallo, backoff. */
export async function refrescarFlags(): Promise<"ok" | "sin-endpoint" | "error"> {
  try {
    if (typeof window === "undefined") return "sin-endpoint";
    const remotos = await intentarFetch();
    if (remotos === "sin-endpoint") {
      // No hay flags.json servido (estado normal hoy) → 24 h y listo.
      programarProximo(REFRESH_MS);
      return "sin-endpoint";
    }
    if (remotos && Object.keys(remotos).length > 0) {
      remotosCacheados = remotos;
      reintentoMs = REINTENTO_BASE_MS;
      programarProximo(REFRESH_MS);
      return "ok";
    }
    // fallo de RED (o cuerpo corrupto) → "error" + backoff — el último
    // bueno queda cacheado (offline-safe, contrato §4.3).
    programarProximo(reintentoMs);
    reintentoMs = Math.min(REINTENTO_TOPE_MS, reintentoMs * 2);
    return "error";
  } catch {
    // fallo de red: backoff y re-intentar — el último bueno queda cacheado
    programarProximo(reintentoMs);
    reintentoMs = Math.min(REINTENTO_TOPE_MS, reintentoMs * 2);
    return "error";
  }
}

/** Prueba interna (tests): reset del estado del módulo. */
export function __resetFlagsParaTest(): void {
  remotosCacheados = null;
  refreshProgramado = false;
  reintentoMs = REINTENTO_BASE_MS;
  if (timerRefresh !== null && typeof timerRefresh === "object" && "unref" in timerRefresh) {
    clearTimeout(timerRefresh as unknown as ReturnType<typeof setTimeout>);
  }
  timerRefresh = null;
}
