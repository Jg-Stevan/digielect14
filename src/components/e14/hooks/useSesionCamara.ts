"use client";

/**
 * useSesionCamara — SPRINT-B (B1, refactor/ui-hooks-v1): hook dedicado a la
 * SESIÓN DE CÁMARA. MOVIMIENTO PURO desde screens/ScanView.tsx (mismos
 * cuerpos, mismos refs, MISMO ORDEN de efectos y MISMAS dependencias).
 *
 * Contiene (extraído tal cual de ScanView.tsx):
 *  · Constantes de plataforma/preview/escalera (IS_ANDROID, CAN_TAKEPHOTO,
 *    IDEAL_PREVIEW_*, FOTO_LADDER, esCalidadPrimero, TAKEPHOTO_TIMEOUT_MS).
 *  · F-LENS v4 — sondas secuenciales y elección de la cámara principal
 *    (BACK/FRONT_CAMERA_RE, CameraProbeResult, probeCamera, chooseMainProbe,
 *    caché e14-main-camera-v1, PROBE_TIMEOUT_MS) + esIOS.
 *  · tomarFoto (DUAL PIPELINE — escalera FOTO_LADDER + carrera 8 s + lista
 *    negra + upgrade LOTE 5.4).
 *  · Efectos, EN EL MISMO ORDEN RELATIVO del original: ARRANQUE (lab
 *    L996-1252, con su cierre/cleanup byte a byte) → re-asignar stream →
 *    «playing» → FRAME LOOP REAL (detección en vivo + k-de-n + feed ZSL).
 *  · avisoCamara («denied»/«perdido» — §E) + toastIOSYaRef.
 *
 * Todas las dependencias externas son INYECTADAS con la misma identidad que
 * en el original: videoRef/streamRef (ScanView), camEstado/setCamEstado
 * (ScanView), reintentoCamara (useSelectorFuente — token del §E), autoRef/
 * setAutoArmado (D9), procesandoRef/cooldownRef/capturarRef (captura),
 * setLive/mostrarAviso (HUD), setFramePendiente (bridge), flashRef/
 * torchOnRef/aplicarLinternaGuardada/setTorchDisponible (useLinterna),
 * alimentarAnillo/liberarAnillo (useAnilloBestShot — feed ZSL del loop).
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { CameraFrameLoop, type FrameLoopTelemetry } from "@jg-stevan/scanner-core/frame-loop";
import {
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@jg-stevan/scanner-core/sensor-profiler";
import type { Quad } from "@jg-stevan/scanner-core/types";
import { useE14Store } from "@/lib/e14/store";

/* ── Tipos compartidos del skin (extraídos tal cual de ScanView.tsx) ─────── */

/** Telemetría reducida para el UI (throttle ~100 ms — LiveUi del lab). */
export interface LiveUi {
  corners: Quad | null;
  score: number | null;
}

type CamEstado = "iniciando" | "viva" | "no-disponible";
export type { CamEstado };

/** iOS/Safari NO implementa ImageCapture en ninguna versión (lab §5.2). */
export function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ se presenta como Mac con touch.
  return /Mac/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

/* ── Constantes de cámara (lab CameraView.tsx, adaptadas al task §2) ─────── */

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L142-151
// (FIX v6 6.1 del lab — IS_ANDROID / CAN_TAKEPHOTO): Safari MODERNO (iOS
// 17+/26) TAMBIÉN expone ImageCapture (con un takePhoto() que se cuelga) —
// el reparto de regímenes ya NO puede decidirse por «typeof ImageCapture»:
// se decide por UA Android (la única plataforma donde takePhoto funciona de
// verdad). La exclusión de iOS vuelve a ser automática y Android queda igual.
const IS_ANDROID =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
/** takePhoto() fiable SOLO en Android (Chrome). Safari moderno expone
 *  ImageCapture pero takePhoto() se cuelga → NO usar en iOS. */
const CAN_TAKEPHOTO = IS_ANDROID && typeof ImageCapture !== "undefined";

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L156-176
// (LOTE 5.1 — REVERT de F5-B): preview POR PLATAFORMA. Android gama baja:
// 960×540@30 (evidencia diag v6 SM-A135M: 1080p en gama baja = 2 fps, 216
// long tasks — el preview ligero 540p es el régimen de Android y el loop de
// detección de e14 ya remuestrea a ~400 px → análisis idéntico desde 540p);
// iOS/resto: 1920×1440 (el disparo manual es input nativo y el régimen alto
// ya es probado). La foto real de Android llega por la escalera FOTO_LADDER
// (~1 s en 2048×1536) — DUAL PIPELINE intacto. Regla E3 intacta: SOLO
// `ideal`, nunca `exact/min` (no rechaza).
const IDEAL_PREVIEW_WIDTH = CAN_TAKEPHOTO ? 960 : 1920;
const IDEAL_PREVIEW_HEIGHT = CAN_TAKEPHOTO ? 540 : 1440;
/** Tope suave de FPS del preview (lab L173-175): «ideal» NO rechaza cámaras
 *  que solo ofrecen 60, solo evita negociar 60 cuando el hardware lo permite. */
const IDEAL_PREVIEW_FPS = 30;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L155-161
// (LOTE 5, F5-A — escalera rápida de photoSettings para takePhoto en
// Android. Evidencia cam-lab SM-A135M 2026-10-14: el takePhoto DESNUDO
// (sin photoSettings) tarda ~15 s (proceso full-res del ISP) y 2048×1536
// tarda ~1.0 s. El desnudo queda como ÚLTIMO recurso (ningún dispositivo
// queda peor que hoy: cada peldaño solo se intenta si el anterior falló
// RÁPIDO).)
const FOTO_LADDER: Array<{ imageWidth: number; imageHeight: number }> = [
  { imageWidth: 2048, imageHeight: 1536 },
  { imageWidth: 1280, imageHeight: 960 },
];

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L178-188
// (LOTE 5.5 — ¿esta captura va a «calidad primero»?): ADAPTACIÓN e14 — no
// hay ajustes de photoMode (el lab lee su store) → modo «auto» EXACTO del
// lab: SOLO los equipos con 8+ GB (deviceMemory === 8) pagan la espera del
// desnudo full-res. Se lee en cada captura, NUNCA en render (cero
// re-renders). try/catch: navegador sin datos → rápido.
function esCalidadPrimero(): boolean {
  try {
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return CAN_TAKEPHOTO && dm === 8;
  } catch {
    return false;
  }
}

/** takePhoto puede colgarse (lab error #29): carrera de 8 s — KIT
 *  camara-visor G3: la carrera queda SOLO para el ÚLTIMO peldaño de la
 *  escalera (el desnudo, el que puede tardar ~15 s del ISP); los peldaños
 *  intermedios fallan RÁPIDO si las constraints son rechazadas. */
const TAKEPHOTO_TIMEOUT_MS = 8000;

/** Throttle de la telemetría que va al UI (lab L1371). */
const TELEMETRIA_UI_MS = 100;

/** QA/diagnóstico: telemetría viva del loop + lente elegida (F-LENS v4)
 *  desde la consola. */
declare global {
  interface Window {
    __e14Telemetria?: FrameLoopTelemetry;
    __cameraChoice?: unknown;
  }
}

/* ── F-LENS v4 — selección de la cámara PRINCIPAL (puerto EXACTO del lab) ────
 *  Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L76-L92
 *  (comentario E4/F-LENS v4) + L116-L223 (código). Remedición H1 del
 *  SPEC-auditoria-copias.md: la fase lógica dejó solo la cascada
 *  facingMode (la red de seguridad del lab) y el bug visible en producción
 *  fue la GRAN ANGULAR en vez de la principal 50MP. */

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L76-L92 (E4/F-LENS v4):
// E4: facingMode NO es confiable en iPhone (puede ganar la frontal o
//     ignorarse) → tras permiso se re-selecciona por LABEL + deviceId
//     exact, con facingMode como constrain inicial únicamente.
// F-LENS v4 (bug v3: "no cambia nada ni el flash" — y codigo-test SÍ
// funciona en el MISMO teléfono): dos causas de raíz encontradas al
// comparar con el CameraController de codigo-test:
//     A) v3 sondeaba las demás lentes CON el stream actual aún abierto →
//        en muchos Android abrir una 2ª cámara con otra activa lanza
//        NotReadableError → TODAS las sondas fallaban → nunca cambiaba
//        de lente ni encontraba el LED. codigo-test sondea SECUENCIAL-
//        MENTE cerrando cada cámara antes de abrir la siguiente y ANTES
//        de abrir la definitiva (puerto exacto de probeDevice +
//        chooseMainCamera: autofocus real → mayor resolución).
//     B) el botón flash se deshabilitaba salvo que getCapabilities()
//        reportara torch; hay Chrome que NO lo anuncian pero SÍ lo
//        aplican → ahora el botón está habilitado en cámara real y la
//        verdad se descubre APLICANDO y leyendo getSettings().torch.

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L116-L117
const BACK_CAMERA_RE = /back|rear|environment|trasera|posterior|arri[eè]re/i;
const FRONT_CAMERA_RE = /front|delantera|anterior|face|facial|selfie/i;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L129-L137
/** Resultado de sondear UNA cámara (puerto de CameraProbe de codigo-test). */
interface CameraProbeResult {
  deviceId: string;
  label: string;
  focusModes: string[];
  torch: boolean;
  maxWidth: number;
  maxHeight: number;
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L139-L144
/** Modos de foco que cuentan como autofocus REAL (regla D3 de codigo-test). */
const REAL_AF_MODES = new Set(["continuous", "single-shot"]);

function hasRealAF(modes: string[]): boolean {
  return modes.some((m) => REAL_AF_MODES.has(m.toLowerCase()));
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L146-L148
function readCapsNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L150-L188
/** Abre UNA cámara SOLO para leer sus capabilities y la CIERRA (puerto de
 *  probeDevice de codigo-test). SIN constraints de resolución en la sonda:
 *  medir el sensor real requiere abrir la cámara "pelada". Devuelve null
 *  si la cámara no se pudo abrir (queda descartada). El `finally` CIERRA
 *  el stream SIEMPRE — nunca hay dos cámaras abiertas a la vez (era la
 *  causa del bug v3: sondas con el stream vivo → NotReadableError).
 *  FIX v5 (5.3) del lab — `timeoutMs` opcional: una sonda colgada
 *  (getUserMedia que nunca resuelve, típico en algún driver Android)
 *  caduca y devuelve null; si la apertura llega TARDE, su stream se cierra
 *  igualmente para no dejar la cámara ocupada para siempre. */
async function probeCamera(
  media: MediaDevices,
  deviceId: string,
  label: string,
  timeoutMs = 0,
): Promise<CameraProbeResult | null> {
  let stream: MediaStream | null = null;
  let timedOut = false;
  try {
    const opening = media.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    if (timeoutMs > 0) {
      stream = await Promise.race([
        opening,
        new Promise<null>((resolve) => {
          window.setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, timeoutMs);
        }),
      ]);
      if (timedOut || stream === null) {
        // La sonda caducó: si la apertura resuelve después, cerrarla (sin
        // esto la cámara quedaría abierta y las siguientes sondas darían
        // NotReadableError en cadena).
        void opening
          .then((s) => {
            s.getTracks().forEach((t) => t.stop());
          })
          .catch(() => undefined);
        return null;
      }
    } else {
      stream = await opening;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) return null;
    const caps = (track.getCapabilities?.() ?? {}) as {
      focusMode?: string[];
      torch?: boolean;
      width?: { max?: number };
      height?: { max?: number };
    };
    return {
      deviceId,
      label: label || track.label,
      focusModes: Array.isArray(caps.focusMode) ? caps.focusMode : [],
      torch: caps.torch === true,
      maxWidth: readCapsNum(caps.width?.max),
      maxHeight: readCapsNum(caps.height?.max),
    };
  } catch {
    return null; // cámara ocupada/no accesible → descartada
  } finally {
    stream?.getTracks().forEach((t) => t.stop()); // CIERRA antes de la siguiente
  }
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L190-L223
/** Elige la cámara principal (puerto de chooseMainCamera de codigo-test):
 *  · Entre traseras con AUTOFOCUS REAL gana la de MAYOR resolución de
 *    sensor (maxWidth×maxHeight) — la principal es siempre el sensor
 *    grande; el torch desempata resoluciones idénticas.
 *  · Sin AF en ninguna (típico iOS, regla D6): grupo de label más SIMPLE
 *    (sin palabras de lente), luego menos palabras, luego más resolución. */
function chooseMainProbe(probes: CameraProbeResult[]): CameraProbeResult | null {
  if (probes.length === 0) return null;
  const backs = probes.filter(
    (p) => BACK_CAMERA_RE.test(p.label) && !FRONT_CAMERA_RE.test(p.label)
  );
  const pool = backs.length > 0 ? backs : probes;
  const byRes = (a: CameraProbeResult, b: CameraProbeResult): number =>
    b.maxWidth * b.maxHeight - a.maxWidth * a.maxHeight;
  const withAf = pool.filter((p) => hasRealAF(p.focusModes));
  if (withAf.length > 0) {
    return [...withAf].sort(
      (a, b) => byRes(a, b) || (a.torch !== b.torch ? (a.torch ? -1 : 1) : 0)
    )[0];
  }
  const lensWords = /ultra|gran angular|wide|angular|tele|teleobjetivo/i;
  const wordCount = (label: string): number =>
    label.split(/\s+/).filter((w) => w.length > 0).length;
  const simples = pool.filter((p) => !lensWords.test(p.label));
  const ranked =
    simples.length > 0
      ? [...simples].sort(
          (a, b) => wordCount(a.label) - wordCount(b.label) || byRes(a, b)
        )
      : [...pool].sort(
          (a, b) => a.label.length - b.label.length || byRes(a, b)
        );
  return ranked[0];
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L362-418
// (FIX v5 5.3 — APERTURA RÁPIDA): la elección de la cámara principal se
// persiste en localStorage y los arranques siguientes abren la deviceId
// cacheada DIRECTAMENTE (2ª apertura < ~1 s perceptual — sin desbloqueo/
// sondeos/elección). Sin TTL (el hardware no cambia); invalidación SOLO por
// fallo de apertura (NotFound/NotReadable/permiso revocado) → borrado y
// sondeo completo. Clave PROPIA de e14 (kit camara-visor G6):
// «e14-main-camera-v1» — NO comparte caché con el lab.
const MAIN_CAMERA_CACHE_KEY = "e14-main-camera-v1";

interface MainCameraCache {
  deviceId: string;
  label: string;
  /** score = maxWidth×maxHeight (regla D3) — solo telemetría/depuración. */
  score: number;
  at: number;
  torch: boolean;
  focusModes: string[];
  maxWidth: number;
  maxHeight: number;
}

function readMainCameraCache(): MainCameraCache | null {
  try {
    const raw = localStorage.getItem(MAIN_CAMERA_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as MainCameraCache;
    if (!c || typeof c.deviceId !== "string" || c.deviceId === "") return null;
    return c;
  } catch {
    return null; // almacenamiento corrupto/bloqueado — sondeo completo
  }
}

function writeMainCameraCache(p: CameraProbeResult): void {
  try {
    const entry: MainCameraCache = {
      deviceId: p.deviceId,
      label: p.label,
      score: p.maxWidth * p.maxHeight,
      at: Date.now(),
      torch: p.torch,
      focusModes: p.focusModes,
      maxWidth: p.maxWidth,
      maxHeight: p.maxHeight,
    };
    localStorage.setItem(MAIN_CAMERA_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* cuota llena / modo privado — solo es una caché */
  }
}

function clearMainCameraCache(): void {
  try {
    localStorage.removeItem(MAIN_CAMERA_CACHE_KEY);
  } catch {
    /* idem */
  }
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L424-426
// (FIX v5 5.3) — plazo por sonda (ms): una cámara lenta no puede bloquear
// el arranque 10 s; caduca y se sigue con la siguiente.
const PROBE_TIMEOUT_MS = 2000;

/** Parámetros del hook — inyección de propietarios (movimiento puro).
 *  Cada ref/valor conserva EXACTAMENTE la identidad y el ciclo de vida que
 *  tenía en ScanView. */
interface UseSesionCamaraParams {
  /** El <video> del visor (propietario: ScanView — lo referencia el JSX). */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Stream abierto (propietario: ScanView — compartido con useLinterna). */
  streamRef: RefObject<MediaStream | null>;
  /** Estado de la cámara (propietario: ScanView — consumido por linterna,
   *  captura, disparo y JSX). */
  camEstado: CamEstado;
  setCamEstado: Dispatch<SetStateAction<CamEstado>>;
  /** Token de reintento del aviso §E (propietario: useSelectorFuente) —
   *  [ACTIVAR CÁMARA] re-dispara el arranque. */
  reintentoCamara: number;
  /** D9: captura automática armada (espejo para el loop — sin staleness). */
  autoRef: RefObject<boolean>;
  setAutoArmado: Dispatch<SetStateAction<boolean>>;
  /** Gates de captura (propietario: ScanView). */
  procesandoRef: RefObject<boolean>;
  cooldownRef: RefObject<number>;
  /** Ref fresca del captureSmart para onTrigger del loop (lab L887-888). */
  capturarRef: RefObject<() => Promise<void>>;
  /** HUD en vivo (propietario: ScanView). */
  setLive: Dispatch<SetStateAction<LiveUi>>;
  /** Franja de avisos del visor (propietario: ScanView). */
  mostrarAviso: (texto: string, tono: "crit" | "warn", ms?: number) => void;
  /** Acción del store: bridge recibe el <video> para el grab de emergencia. */
  setFramePendiente: (video: HTMLVideoElement | null) => void;
  /** Linterna (useLinterna): re-aplicar preferencia por stream/«playing». */
  flashRef: RefObject<boolean>;
  torchOnRef: RefObject<boolean>;
  aplicarLinternaGuardada: () => void;
  setTorchDisponible: Dispatch<SetStateAction<boolean>>;
  /** Perfil del sensor de FOTO (propietario: ScanView — lo llena
   *  profileActiveSensor y lo lee useDestello.archivoDentroDeTope). */
  sensorProfileRef: RefObject<SensorProfile | null>;
  /** Anillo ZSL (useAnilloBestShot): feed ~5 Hz + liberación al cerrar. */
  alimentarAnillo: () => void;
  liberarAnillo: () => void;
}

export function useSesionCamara({
  videoRef,
  streamRef,
  camEstado,
  setCamEstado,
  reintentoCamara,
  autoRef,
  setAutoArmado,
  procesandoRef,
  cooldownRef,
  capturarRef,
  setLive,
  mostrarAviso,
  setFramePendiente,
  flashRef,
  torchOnRef,
  aplicarLinternaGuardada,
  setTorchDisponible,
  sensorProfileRef,
  alimentarAnillo,
  liberarAnillo,
}: UseSesionCamaraParams) {
  const fuente = useE14Store((s) => s.fuente);
  const [avisoCamara, setAvisoCamara] = useState<null | "denied" | "perdido">(null);
  // Fuente: lab CameraView.tsx L770 (takePhotoBrokenRef) — FIX v4 4.1: lista
  // negra temporal del sensor. Un takePhoto que expira la marca para que
  // captureSmart NO vuelva a colgar en cada disparo; se rehabilita al abrir
  // stream nuevo (lab L2760) y si una respuesta futura llega (L1434).
  const puedeTomarFotoRef = useRef(false);
  const takePhotoBrokenRef = useRef(false);
  const toastIOSYaRef = useRef(false);
  const telemetriaAtRef = useRef(0);
  const loopRef = useRef<CameraFrameLoop | null>(null);

  const modoCamara = fuente === "CAMARA";
  const camaraViva = modoCamara && camEstado === "viva";

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L444-L454
  /** F-SENSOR-PROFILER: sondea el sensor del stream REAL una vez por
   *  apertura (getPhotoCapabilities → nativa + tope por gama). Falla en
   *  silencio (Safari) → takePhoto dispara a secas y el clamp post-decode
   *  protege la RAM. */
  const profileActiveSensor = useCallback((stream: MediaStream): void => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    void profileSensor(track).then((p) => {
      sensorProfileRef.current = p;
    });
  }, []);

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L1289-1470
  // (takePhotoBlob — LOTE 5 F5-A + F5.3/F5.4/F5.5 + FIX v4 4.1 + FIX v6 6.1,
  //  remediación H2: capas 1 y 2 del F-SENSOR-PROFILER se conservan).
  /** DUAL PIPELINE (pilar 2) — Captura a RESOLUCIÓN DEL SENSOR como Blob con
   *  la ESCALERA FOTO_LADDER: 2048×1536 → 1280×960 → desnudo (cada peldaño
   *  solo se intenta si el anterior falló RÁPIDO; la carrera de 8 s queda
   *  SOLO para el ÚLTIMO peldaño — el desnudo, el que puede tardar ~15 s del
   *  ISP). takePhoto() IGNORA la resolución del <video> del preview y dispara
   *  directo al sensor físico (12–48 MP). FIX v6 6.1: el guard de plataforma
   *  es CAN_TAKEPHOTO (positiva de Android) — Safari moderno expone
   *  ImageCapture pero takePhoto() se cuelga → fuera de Android ni se
   *  intenta. Lista negra temporal (takePhotoBrokenRef): un desnudo que
   *  expira marca el sensor para que captureSmart no vuelva a colgar en cada
   *  disparo (lab L1432-1435; rehabilitación: respuesta ok / stream nuevo).
   *  LOTE 5.4 (F5.4-A): si el ganador fue un PELDAÑO dispara YA la foto
   *  full-res del sensor y la entrega por `onUpgrade` — corre SIEMPRE fuera
   *  de presupuesto y NUNCA bloquea (su catch vive en el runner del llamador). */
  const tomarFoto = useCallback(
    async (onUpgrade?: (upgrade: Promise<Blob>) => void): Promise<Blob | null> => {
      if (!CAN_TAKEPHOTO) return null; // FIX v6 6.1 del lab — Android only
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return null;
      try {
        const capture = new ImageCapture(track);
        const profile = sensorProfileRef.current;
        // LOTE 5.5 — calidad primero (deviceMemory 8+): UNA carrera larga
        // contra el sensor con el DESNUDO de primero (la página nace
        // full-res). Si el desnudo falla RÁPIDO, la cola cae a los peldaños.
        const qualityFirst = esCalidadPrimero();
        const settings = qualityFirst ? undefined : FOTO_LADDER[0];
        // Settings del ÚLTIMO intento disparado; se lee SOLO si hubo blob
        // ganador para decidir si corres upgrade (peldaño → sí; desnudo →
        // ya es full-res, no).
        let winnerSettings: { imageWidth: number; imageHeight: number } | undefined =
          settings;
        const attempt = async (
          ps?: { imageWidth: number; imageHeight: number },
          conCarrera?: boolean,
        ): Promise<Blob | null> => {
          try {
            const photoPromise = capture.takePhoto(ps as PhotoSettings);
            if (!conCarrera) {
              // Peldaño intermedio: falla RÁPIDO si las constraints son
              // rechazadas — sin carrera (la de 8 s es del desnudo).
              const b = await photoPromise;
              return b && b.size > 0 ? b : null;
            }
            const blob = await Promise.race([
              photoPromise,
              new Promise<never>((_, reject) =>
                window.setTimeout(
                  () => reject(new Error("takePhoto timeout 8s")),
                  TAKEPHOTO_TIMEOUT_MS,
                ),
              ),
            ]);
            return blob && blob.size > 0 ? blob : null;
          } catch {
            return null;
          }
        };
        // Primer intento: con carrera SOLO si es el desnudo (qualityFirst).
        let blob = await attempt(settings, settings === undefined);
        // LOTE 5.3 (F5.3-A) — avance de escalera ÚNICO para Android:
        // siguiente peldaño y luego desnudo (con carrera). qualityFirst: el
        // desnudo ya corrió de primero — los peldaños son el plan B (sin
        // carrera: fail fast). Caso raro «desnudo falló rápido + peldaño
        // ganó» → winnerSettings queda definido y el upgrade SÍ se dispara
        // (comportamiento EXACTO del lab — su winnerSettings se asigna igual
        // en el retry de qualityFirst).
        const escalera: Array<{ imageWidth: number; imageHeight: number } | undefined> =
          qualityFirst ? [...FOTO_LADDER] : [...FOTO_LADDER.slice(1), undefined];
        for (const ps of escalera) {
          if (blob) break;
          winnerSettings = ps;
          blob = await attempt(ps, ps === undefined);
        }
        // FIX v4 4.1 — lista negra temporal: respondió → rehabilitar;
        // expiró el desnudo → captureSmart deja de pedir takePhoto.
        if (blob) takePhotoBrokenRef.current = false;
        else takePhotoBrokenRef.current = true;
        if (!blob) return null;
        // LOTE 5.4 (F5.4-A) — el upgrade solo tiene sentido si lo que ganó
        // fue un PELDAÑO (2048/1280). Fire-and-forget: la promesa NUNCA se
        // espera aquí (el desnudo tarda ~15 s); SIN tocar takePhotoBrokenRef
        // (un desnudo lento/roto NO lista-negrea la escalera, que ya entregó
        // la foto del flujo).
        if (winnerSettings !== undefined && onUpgrade) {
          try {
            onUpgrade(capture.takePhoto(undefined));
          } catch {
            /* throw sincrónico raro del sensor: nunca rompe la captura */
          }
        }
        // Capa 2 — red de seguridad post-decode (solo recorta si el blob
        // excede el tope; si no, el blob original pasa intacto).
        return await clampBlobToSafeCap(blob, profile?.safeCapPx ?? getSensorSafeCap());
      } catch {
        return null;
      }
    },
    [],
  );

  /* ── Arranque de cámara (lab L996-1252: F-LENS v4 + cascada de respaldo,
     fallback a SIMULACIÓN propio de e14 — remediado H1) ───────────────── */

  useEffect(() => {
    if (fuente !== "CAMARA") return;
    let cancelado = false;
    setCamEstado("iniciando");

    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media || typeof media.getUserMedia !== "function" || !window.isSecureContext) {
      // §E (SPEC-camara-funcional): fin del rebote silencioso — la app SE
      // QUEDA en modo CÁMARA con el overlay de aviso + reintento (paridad
      // con el aviso B2 del lab); el toast es redundante con el overlay.
      setCamEstado("no-disponible");
      setAvisoCamara("denied");
      return;
    }

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1049-1053 (isPermError) — equivalente exacto (§3 auditoría: reutilizar,
    // no duplicar; aquí ya existía con este nombre desde L3).
    const esErrorPermiso = (e: unknown): boolean =>
      e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1055-1093 (openWithCascade) — E3 + DUAL PIPELINE: SOLO anchos/altos
    // IDEALES (ideal nunca rechaza getUserMedia). F-LENS: el primer intento
    // fuerza EXACT la trasera (en algunos móviles "environment" a secas
    // negocia la gran angular); si el exact falla se relaja a ideal →
    // {video:true}. Es la RED DE SEGURIDAD que corre SOLO si las sondas de
    // F-LENS v4 no lograron abrir la principal.
    const abrirConCascada = async (): Promise<MediaStream | null> => {
      // Fuente: lab CameraView.tsx L2353-2391 (E3 + DUAL PIPELINE) — el
      // PREVIEW pide las constraints ideales POR PLATAFORMA (G2) + 30 FPS
      // (fluido en gama baja; la captura hi-res va por takePhoto al sensor).
      const intentos: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
            frameRate: { ideal: IDEAL_PREVIEW_FPS },
          },
          audio: false,
        },
        {
          video: {
            facingMode: "environment",
            width: { ideal: IDEAL_PREVIEW_WIDTH },
            height: { ideal: IDEAL_PREVIEW_HEIGHT },
            frameRate: { ideal: IDEAL_PREVIEW_FPS },
          },
          audio: false,
        },
        { video: { facingMode: "environment" }, audio: false },
        { video: true, audio: false },
      ];
      for (const c of intentos) {
        try {
          return await media.getUserMedia(c);
        } catch (e) {
          if (esErrorPermiso(e)) return null; // permiso: la cascada no ayuda
          /* siguiente nivel */
        }
      }
      return null;
    };

    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
    // L1095-1207 (openMainCamera) — F-LENS v4 arranque estilo codigo-test
    // (donde el flash SÍ funciona):
    // 1) desbloquea labels con un stream genérico que se cierra al instante;
    // 2) sondea TODAS las cámaras UNA POR UNA cerrando cada una antes de
    //    abrir la siguiente (v3 las sondeaba con el stream vivo → en muchos
    //    Android la 2ª apertura lanza NotReadableError y NADA cambiaba);
    // 3) elige la principal con la regla D3/D6 (autofocus real → mayor
    //    resolución; torch desempata; sin AF → label más simple);
    // 4) abre SOLO la ganadora con el preview ligero (aquí 1920×1080 ideal —
    //    D27, decisión documentada de e14; la captura hi-res va por
    //    takePhoto al sensor).
    // Devuelve el stream de la principal o null (→ cascade/SIM).
    // (Nota e14: el lab marca permisoDenegado aquí para su aviso B2 con CTA
    //  «Activar cámara»; e14 no tiene ese overlay — el fallback unificado a
    //  SIMULACIÓN con toast cubre el caso, ver fila 16 de la auditoría.)
    const abrirCamaraPrincipal = async (): Promise<MediaStream | null> => {
      // 0) Fuente: lab CameraView.tsx L2468-2489 (FIX v5 5.3 — VÍA RÁPIDA):
      //    abrir la deviceId CACHEADA con las MISMAS constraints de preview
      //    ideal del camino completo (sin sondas → 2ª apertura < ~1 s
      //    perceptual). Invalidación SOLO por fallo (NotFound/NotReadable/
      //    permiso revocado) → borrar y sondear completo como antes.
      const cache = readMainCameraCache();
      if (cache) {
        try {
          return await media.getUserMedia({
            video: {
              deviceId: { exact: cache.deviceId },
              width: { ideal: IDEAL_PREVIEW_WIDTH },
              height: { ideal: IDEAL_PREVIEW_HEIGHT },
              frameRate: { ideal: IDEAL_PREVIEW_FPS },
            },
            audio: false,
          });
        } catch (err) {
          clearMainCameraCache();
          if (esErrorPermiso(err)) return null; // permiso: la cascada no ayuda
        }
      }
      // 1) Desbloqueo de etiquetas (F1-a de codigo-test): sin permiso previo
      //    los labels/deviceIds llegan vacíos en enumerateDevices.
      try {
        const unlock = await media.getUserMedia({ video: true, audio: false });
        unlock.getTracks().forEach((t) => t.stop());
      } catch {
        /* sin permiso: los probes fallarán y se cae al cascade */
      }
      // 2) Sondeo secuencial: cada cámara se ABRE, se MIDE y se CIERRA.
      let devices: MediaDeviceInfo[] = [];
      try {
        devices = (await media.enumerateDevices()).filter(
          (d) => d.kind === "videoinput" && d.deviceId
        );
      } catch {
        devices = [];
      }
      const probes: CameraProbeResult[] = [];
      for (const d of devices) {
        // FIX M6 (auditoría 2-b): el sondEO consulta la cancelación — salir
        // de CÁMARA durante el arranque (BottomNav vivo durante
        // «INICIANDO CÁMARA…») dejaba las cámaras abriéndose/cerrándose en
        // background varios segundos (LED de cámara activo sin vista).
        if (cancelado) return null;
        // FIX v5 (5.3) del lab: plazo de 2 s por sonda (una cámara lenta no
        // bloquea el arranque).
        const p = await probeCamera(media, d.deviceId, d.label, PROBE_TIMEOUT_MS);
        if (p) probes.push(p);
      }
      // 3) Elección de la principal (D3: AF real → mayor resolución).
      const main = chooseMainProbe(probes);
      // 4) Apertura SOLO de la ganadora (con fallbacks en cascada).
      // DUAL PIPELINE (G2): preview POR PLATAFORMA + 30 fps ideal; el sensor
      // completo solo despierta en el instante de la captura (FOTO_LADDER).
      const attempts: MediaStreamConstraints[] = main
        ? [
            {
              video: {
                deviceId: { exact: main.deviceId },
                width: { ideal: IDEAL_PREVIEW_WIDTH },
                height: { ideal: IDEAL_PREVIEW_HEIGHT },
                frameRate: { ideal: IDEAL_PREVIEW_FPS },
              },
              audio: false,
            },
            { video: { deviceId: { exact: main.deviceId } }, audio: false },
          ]
        : [];
      attempts.push({ video: true, audio: false }); // último recurso
      for (let ai = 0; ai < attempts.length; ai += 1) {
        // FIX M6 (auditoría 2-b): idem sondas — la apertura de la ganadora
        // también aborta si el usuario ya se fue de la vista.
        if (cancelado) return null;
        try {
          const stream = await media.getUserMedia(attempts[ai]!);
          // FIX v5 (5.3) del lab: persistir la elección SOLO si el stream
          // abrió con la deviceId de la ganadora (los 2 primeros intentos la
          // fijan; el fallback {video:true} NO escribe caché).
          if (main && ai < 2) writeMainCameraCache(main);
          // Vía zoom: si el track abrió con zoom < 1 (equivalente 0.5× del
          // MISMO track), súbelo a 1 para el FOV de la principal.
          try {
            const track = stream.getVideoTracks()[0];
            const zcaps = track?.getCapabilities?.() as
              | { zoom?: { min?: number; max?: number } }
              | undefined;
            const zst = track?.getSettings?.() as { zoom?: number } | undefined;
            if (
              zcaps?.zoom &&
              typeof zcaps.zoom.min === "number" &&
              zcaps.zoom.min < 1 &&
              typeof zst?.zoom === "number" &&
              zst.zoom < 1
            ) {
              await track
                ?.applyConstraints({
                  advanced: [{ zoom: 1 }],
                } as MediaTrackConstraints & { advanced: unknown[] })
                .catch(() => undefined);
            }
          } catch {
            /* sin soporte de zoom */
          }
          // Telemetría de QA (window.__cameraChoice): qué lente quedó abierta
          // y qué se midió en las sondas — útil para depurar remotamente.
          try {
            const track = stream.getVideoTracks()[0];
            const st = track?.getSettings?.() as {
              width?: number;
              height?: number;
            } | undefined;
            (window as unknown as { __cameraChoice?: unknown }).__cameraChoice = {
              elegida: main?.label ?? track?.label ?? "",
              torch: main?.torch ?? false,
              focusModes: main?.focusModes ?? [],
              width: st?.width ?? 0,
              height: st?.height ?? 0,
              sondas: probes.map((p) => ({
                label: p.label,
                torch: p.torch,
                af: p.focusModes,
                max: `${p.maxWidth}x${p.maxHeight}`,
              })),
            };
          } catch {
            /* solo telemetría */
          }
          return stream;
        } catch {
          /* siguiente nivel */
        }
      }
      return null;
    };

    void (async () => {
      // F-LENS v4: primero el camino de codigo-test (sondas secuenciales +
      // principal por resolución/AF); cascade facingMode como red de seguridad.
      let stream = await abrirCamaraPrincipal();
      if (!stream) stream = await abrirConCascada();
      if (!stream) {
        if (cancelado) return;
        // §E (SPEC-camara-funcional): fracaso tras sondas+cascada → overlay
        // con [ACTIVAR CÁMARA] (reintento) / [VOLVER A SIMULACIÓN] — SIN
        // rebote automático. abrirCamaraPrincipal/abrirConCascada intactas.
        setCamEstado("no-disponible");
        setAvisoCamara("denied");
        return;
      }
      if (cancelado) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      setCamEstado("viva");
      // D9 (SPEC-e14-guard-borde Rev. 2): cada APERTURA de cámara nace ARMADA
      // — primera vez, [ACTIVAR CÁMARA] tras un aviso, o reabrir tras cambiar
      // de fuente («repetir captura» remonta el componente → useState(true)).
      // El desarme EN VIVO del operador se respeta hasta la próxima apertura
      // (AC15: re-armado en cada apertura; AC16: desarme respetado en vivo).
      setAutoArmado(true);
      // F-SENSOR-PROFILER (PASO 2) — Fuente: apps/scanner-lab/... L1032-1034:
      // mide la nativa de FOTO del sensor y fija el tope seguro (4032/3200
      // px) para tomarFoto, una vez por apertura (remediación H2).
      profileActiveSensor(stream);
      // §5.2: Safari/iOS no implementa ImageCapture → el shutter manual abre
      // la cámara NATIVA; auto-captura usa frames del video.
      // G5 (FIX v6 6.1 del lab): el gate es CAN_TAKEPHOTO (positiva de
      // Android) — Safari moderno expone ImageCapture pero takePhoto se
      // cuelga. KIT camara-visor: stream nuevo rehabilita takePhoto
      // (lab L2760 — la lista negra temporal se limpia).
      puedeTomarFotoRef.current = CAN_TAKEPHOTO;
      takePhotoBrokenRef.current = false;
      if (!puedeTomarFotoRef.current && esIOS() && !toastIOSYaRef.current) {
        toastIOSYaRef.current = true;
        mostrarAviso(
          "CÁMARA NATIVA EN IPHONE — el disparo abre la cámara del sistema: la foto sale a resolución completa del sensor.",
          "warn",
          6000,
        );
      }
      // B3 (lab): si el track muere (permiso revocado, otra app roba la
      // cámara) → overlay §E «SE PERDIÓ LA CÁMARA» sin cambio de modo (el
      // visor no queda congelado; el reintento revive el stream).
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          if (cancelado) return;
          // §E (SPEC-camara-funcional): stream perdido → overlay «SE PERDIÓ
          // LA CÁMARA» SIN cambio de modo (el visor no queda congelado; el
          // reintento revive el stream).
          setCamEstado("no-disponible");
          setAvisoCamara("perdido");
        };
      }
      // F-FLASH v3: botón habilitado SIEMPRE con cámara real (la verdad del
      // torch se verifica al pulsar); preferencia persistida → re-aplicar.
      setTorchDisponible(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        setFramePendiente(video); // bridge: grab del frame si no hay foto
      }
      if (flashRef.current) aplicarLinternaGuardada();
    })();

    return () => {
      cancelado = true;
      const t = streamRef.current?.getVideoTracks()[0];
      if (t) t.onended = null; // stop() no dispara "ended" (lab B3)
      streamRef.current?.getTracks().forEach((st) => st.stop());
      streamRef.current = null;
      setFramePendiente(null);
      setCamEstado("iniciando");
      setAvisoCamara(null); // §E: el aviso NO sobrevive al ciclo de arranque
      procesandoRef.current = false;
      cooldownRef.current = 0;
    };
    // (directiva exhaustive-deps del original NO se arrastra: la regla solo
    // aplica en screens/ScanView.tsx — override por ruta en eslint.config.mjs,
    // congelado. Justificación original, línea a línea: las ausentes son
    // estables — setFramePendiente (acción Zustand), mostrarAviso/
    // profileActiveSensor y aplicarLinternaGuardada (useCallback estables);
    // el arranque SOLO debe correr al cambiar fuente/reintentoCamara.)
  }, [fuente, reintentoCamara]);

  /** Re-asigna el stream al <video> (lab L1255-1261) por si el elemento se
   *  remontó (cambio de vista ida/vuelta manteniendo la fuente viva). */
  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [camaraViva]);

  /** Dimensiones del video + "playing" → re-aplicar torch (lab L1262-1269). */
  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    if (!video) return;
    const alReproducir = () => {
      if (flashRef.current && !torchOnRef.current) aplicarLinternaGuardada();
    };
    video.addEventListener("playing", alReproducir);
    return () => video.removeEventListener("playing", alReproducir);
    // (directiva exhaustive-deps del original NO se arrastra: la regla solo
    // aplica en screens/ScanView.tsx. Justificación original: aplicarLinter
    // naGuardada es estable (useCallback ← ponerLinterna, que es useCallback
    // []); re-suscribir «playing» solo al alternar camaraViva.)
  }, [camaraViva]);

  /* ── FRAME LOOP REAL (lab L1356-1402): detección en vivo + k-de-n ──── */

  useEffect(() => {
    if (!camaraViva) return;
    const video = videoRef.current;
    if (!video) return;
    const loop = new CameraFrameLoop();
    loopRef.current = loop;
    loop.start(video, {
      onFrame: (t) => {
        if (typeof window !== "undefined") window.__e14Telemetria = t;
        // F-ZSL: alimenta el ring (~5 Hz) — cubre la ventana pre-tap.
        alimentarAnillo();
        const ahora = performance.now();
        if (ahora - telemetriaAtRef.current < TELEMETRIA_UI_MS) return; // ~10 Hz
        telemetriaAtRef.current = ahora;
        setLive({ corners: t.corners, score: t.score ? t.score.total : null });
      },
      onTrigger: () => {
        // El gate fino (k-de-n, cooldown del core, re-arme, isDeviceStable)
        // vive en CameraFrameLoop — aquí solo el filtro del lab L1380-1385.
        if (!autoRef.current) return;
        if (procesandoRef.current) return;
        if (cooldownRef.current > Date.now()) return;
        void capturarRef.current();
      },
      onNoDetectTimeout: () => {
        // §3.1.4 (redesign-stitch): «NO DETECTO EL ACTA · ACÉRCALA AL
        // ENCUADRE» como franja del visor (re-notifica como el toast).
        mostrarAviso("NO DETECTO EL ACTA · ACÉRCALA AL ENCUADRE", "warn", 3500);
      },
    });
    return () => {
      loop.stop();
      loopRef.current = null;
      // F-ZSL: libera el Best-Shot ring al cerrar la sesión de cámara.
      liberarAnillo();
    };
    // (directiva exhaustive-deps del original NO se arrastra: la regla solo
    // aplica en screens/ScanView.tsx. Justificación original: las 3 ausentes
    // son estables — alimentarAnillo (useCallback ← empujarAnillo []),
    // liberarAnillo ([]) y mostrarAviso (useCallback []); el loop usa refs
    // deliberadamente para evitar staleness.)
  }, [camaraViva]);

  return {
    avisoCamara,
    setAvisoCamara,
    puedeTomarFotoRef,
    takePhotoBrokenRef,
    tomarFoto,
    loopRef,
    camaraViva,
  };
}
