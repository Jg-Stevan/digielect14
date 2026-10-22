"use client";

/**
 * ESCANEAR (§7.1) — CYBER-NEÓN PANTALLA CÁMARA (SPEC-e14-cyber-neon-
 * captura Rev. 1): visor full-bleed #030504 limpio fuera de CÁMARA, pill de
 * modos con chip blanco data-driven (IA/cuadrícula/AUTO), HUD ámbar + ⋮,
 * fila de estado, chips de calidad y fila de disparo con
 * obturador-documento. La LÓGICA de cámara (fallbacks, disparo por
 * plataforma, linterna, ZSL, gate) queda INTACTA — solo capa visual.
 * CÁMARA FUNCIONAL (SPEC-e14-camara-funcional Rev. 1 — ronda de
 * FUNCIONALIDAD, estética neón conservada al píxel): botón ámbar = captura
 * automática (§B), menú ⋮ (§C), flash honesto (§D), aviso de cámara con
 * reintento y fin del rebote silencioso (§E), fila de estado centrada sin
 * «ISO: 1600» (§A). La lógica intocable (disparo por plataforma, cascada,
 * sondas, gate, ZSL) queda byte a byte.
 * SIMULACIÓN DE SCORES (SPEC-e14-simulacion-scores Rev. 1): los 3 chips de
 * calidad encima del obturador pasan de decorativos a <button> — BOTONES de
 * simulación (§D2): mismo visual exacto del mock, área táctil ≥44px
 * invisible, disabled durante análisis, funcionan en los 3 modos y disparan
 * store.simularScore(banda) → pipeline real con el asset FIJO del dueño y
 * score inyectado (§D3 — la completa = óptima · la cortada = intermedio ·
 * la borrosa = bajo). Nada visual cambia salvo cursor/feedback de toque.
 * Historial previo: marco con corner brackets, retícula central, botón
 * disparo, ghost IMPORTAR y PANEL DE SIMULACIÓN para forzar el resultado.
 * FASE LÓGICA L2 (§7): chips de FUENTE (SIMULACIÓN · CÁMARA · IMPORTAR);
 * IMPORTAR IMAGEN real (input file → setArchivoPendiente → análisis);
 * warmUp del worker OpenCV al montar (§9).
 *
 * FASE LÓGICA L3 (§7 rev.3 — interfaz de escaneo del lab COPIADA de
 * apps/scanner-lab/src/components/scanner/CameraView.tsx y re-vestida con la
 * estética Precision Monitor, con CERO dependencias nuevas: solo las que ya
 * tiene e14 + funciones puras del core):
 *  · <video> en el marco existente + CameraFrameLoop del core (detección en
 *    vivo OpenCV, score compuesto, k-de-n, isDeviceStable).
 *  · HUD "CALIDAD 82%" + "ACTA DETECTADA / NO DETECTADA" (font-data).
 *  · Pill "BUSCANDO ACTA…" superior centrada (lab L1737-1753) mientras
 *    corners === null.
 *  · Quad overlay SVG en vivo (lab L1693-1711) en ok-tint con mapeo
 *    object-cover exacto (mapPoint).
 *  · Pill "IA · AUTO / IA · MANUAL" (lab L1553-1566) con punto pulsante verde.
 *  · Toggle AUTO — default OFF (D22 del spec → D24 aquí): el gate del CORE
 *    dispara onTrigger (k-de-n, cooldown 1500 ms, re-arme, quietud); el
 *    componente solo filtra if (!autoArmado || procesando) (lab L1380-1385).
 *  · Flash F-FLASH v3 (lab L486-555 + L1404-1416): applyConstraints +
 *    verificación getSettings().torch + flashRef con reintentos.
 *  · ZSL best-shot ring (lab L779-805 + L1395-1400): el disparo manual NO
 *    usa el frame del instante del tap — ganador por lapVar de 80-450 ms
 *    ANTES del disparo; ring liberado al desmontar.
 *  · Ruta iOS (lab L902-925): con ImageCapture → captureSmart (foto
 *    full-res del sensor); iOS/Safari sin ImageCapture → cámara NATIVA vía
 *    <input capture="environment">; último recurso → grab del video vivo
 *    (frameActual del bridge).
 *  · Destello blanco ~120 ms al capturar (lab L569, flashKey).
 *  · onNoDetectTimeout → toast "NO DETECTO EL ACTA · ACÉRCALA AL ENCUADRE".
 *  · Permiso denegado / sin HTTPS / sin getUserMedia → toast warn + vuelta
 *    automática a SIMULACIÓN (spec §7).
 *
 * FIDELIDAD AL LAB (fix/e14-fidelidad-lab — SPEC-auditoria-copias.md):
 *  · F-LENS v4 COMPLETO (H1): sondas secuenciales cerrando cada cámara +
 *    chooseMainProbe (autofocus real → mayor resolución) + fix zoom +
 *    telemetría window.__cameraChoice — la cascada facingMode quedó como red
 *    de seguridad (lab L116-223 + L1095-1207).
 *  · F-SENSOR-PROFILER (H2): perfilado del track + takePhotoBlob con capa 1
 *    (photoSettings al ISP) y capa 2 (clampBlobToSafeCap) + capa 3 (decode
 *    único + downscaleImage por GAMA) en el punto de entrada del pipeline —
 *    CÁMARA, IMPORTAR y cámara nativa iOS reciben el tope ANTES del bridge.
 *  · captureSmart §5.4 (H3): snapA ANTES del disparo; TORCH_HINT verbatim
 *    (H4); accept .heic/.heif + guard F-IMPORT/HEIC (H5).
 * Fuera de alcance (spec): "Revisar N" + contador multi-página (1 acta = 1
 * captura). En SIMULACIÓN/IMPORTAR la vista queda EXACTAMENTE como en L2.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L61-L67
// (imports del sensor-profiler — el core YA exporta todo: cero cambios en el
// core. KIT camara-visor G3: buildCappedPhotoSettings sale de la captura —
// la resolución la manda FOTO_LADDER; clampBlobToSafeCap/getSensorSafeCap
// siguen como Capa 2 — red de seguridad post-decode).
import {
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@jg-stevan/scanner-core/sensor-profiler";
// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L48-L54
// (loadImage/fileToCaptureDataUrl) — la capa 3 del dispatch decodifica UNA
// vez antes de que la foto entre al pipeline del bridge.
import { fileToCaptureDataUrl, loadImage } from "@jg-stevan/scanner-core/image-processor";
import { CameraFrameLoop, type FrameLoopTelemetry } from "@jg-stevan/scanner-core/frame-loop";
import { SHUTTER_SCORE } from "@jg-stevan/scanner-core/quality";
import type { Quad } from "@jg-stevan/scanner-core/types";
import { useE14Store, type BandaSim } from "@/lib/e14/store";
import { rapidOcrPrecalentar } from "@/lib/e14/ocr/rapidocr";
import type { Acta } from "@/lib/e14/types";
import {
  CameraNavIcon,
  FolderImportIcon,
  SparklesIcon,
  StitchBoltIcon,
  StitchGridIcon,
  StitchImportIcon,
  StitchShutterDocIcon,
  GaugeIcon,
} from "../icons";
// Task 4: botón «?» del HUD — abre la guía de uso (AyudaOverlay).
import { abrirAyuda } from "../AyudaOverlay";

/* ── Chips de calidad = BOTONES DE SIMULACIÓN (SPEC-e14-simulacion-scores
 *  §D2/§D3) ────
 *  Antes: leyenda decorativa del gate. Ahora: cada chip es un <button> que
 *  dispara un análisis determinista con la foto de ejemplo del dueño y el
 *  score inyectado de su banda (la completa = óptima · la cortada =
 *  intermedio · la borrosa = bajo); el desenlace real lo decide el gate
 *  (ÓPTIMA → 10.0 enviada · MEDIO → ADVERTENCIA revisión (7.0) · BAJA →
 *  RECHAZADA). Estética neón INTACTA (mismas clases del mock aprobado) —
 *  solo se añade cursor/feedback de toque, área táctil ≥44px invisible y
 *  disabled durante el análisis (AC7/AC8). Los scores de bracket son los
 *  que INYECTA el chip. §D6.3 (SPEC-e14-score-ocr Rev. 3): el piso
 *  re-aplica solo con score ≥ 8 — la foto b/n del MEDIO clasifica AUTO
 *  real y queda en 7.0 ADVERTENCIA (la banda medio vive). */
const NIVELES_CALIDAD: {
  id: BandaSim;
  label: string;
  score: string;
  chip: string;
  dot: string;
  anillo: string;
  aria: string;
}[] = [
  {
    id: "optima",
    label: "ÓPTIMA",
    score: "8.2",
    // STITCH (mock 1): bg-[#00E676]/10 + border + text (dot pulsante).
    chip: "bg-[#00E676]/10 border-[#00E676]/40 hover:bg-[#00E676]/20 text-[#00E676]",
    dot: "bg-[#00E676] animate-pulse",
    anillo: "border-[#00E676]",
    aria: "Simular acta óptima (10.0 — envío automático)",
  },
  {
    id: "medio",
    label: "MEDIO",
    score: "7.0",
    chip: "bg-yellow-500/10 border-yellow-500/40 hover:bg-yellow-500/20 text-yellow-400",
    dot: "bg-yellow-400",
    anillo: "border-yellow-400",
    aria: "Simular acta intermedia (7.0 — revisión)",
  },
  {
    id: "baja",
    label: "BAJA",
    score: "4.3",
    chip: "bg-red-500/10 border-red-500/40 hover:bg-red-500/20 text-red-400",
    dot: "bg-red-400",
    anillo: "border-red-400",
    aria: "Simular acta baja (4.3 — rechazada)",
  },
];

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

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L200-209
// (FIX v4 4.5 — tope de lado mayor de las copias del ring ZSL). El ring es
// SOLO el fallback de la auto-captura (anti tap-shock): no necesita
// resolución completa. Con el stream alto de iOS (1920×1440), 8 slots a
// resolución completa ≈ 66 MB — esa presión hacía que WebKit matara la
// capa de video (visor negro en iPhones modestos). Presupuesto resultante:
// ≤ 8 × (1280×960×4) ≈ 37 MB.
const RING_MAX_LONG_SIDE = 1280;

/** Cooldown anti doble-disparo (lab §5.2 — CAPTURE_COOLDOWN_MS del core). */
const COOLDOWN_MS = 1500;
/** F-ZSL: ventana pre-tap 80–450 ms (anti tap-shock) + ring de máx 8 frames. */
const ZSL_DESDE_MS = 80;
const ZSL_HASTA_MS = 450;
const RING_MAX = 8;
/** Feed del ring desde el video a ~5 Hz (lab L735-737). */
const RING_FEED_MS = 200;
/** Throttle de la telemetría que va al UI (lab L1371). */
const TELEMETRIA_UI_MS = 100;
/** Destello de captura ~120 ms (spec §7 — duración en globals.css) + margen
 *  antes de navegar a ANALIZANDO (el visor se desmonta). */
const NAVEGACION_TRAS_MS = 260;
/** takePhoto puede colgarse (lab error #29): carrera de 8 s — KIT
 *  camara-visor G3: la carrera queda SOLO para el ÚLTIMO peldaño de la
 *  escalera (el desnudo, el que puede tardar ~15 s del ISP); los peldaños
 *  intermedios fallan RÁPIDO si las constraints son rechazadas. */
const TAKEPHOTO_TIMEOUT_MS = 8000;

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L119-L127
// (TORCH_HINT verbatim — remediación H4: es copy de UX de campo; el operador
//  electoral necesita el diagnóstico completo, no la versión corta).
/** F-FLASH v3 — diagnóstico del flash: cubre navegador sin soporte (iPhone:
 *  Safari 17.4+, Chrome/Firefox de iOS no exponen torch; WebViews in-app
 *  tampoco), cámara sin LED (gran angular/macro) y permisos WebView. */
const TORCH_HINT =
  "No se pudo controlar la linterna aquí. Causas típicas: navegador sin " +
  "soporte (en iPhone usa Safari 17.4 o posterior; Chrome/Firefox de iOS " +
  "no lo permiten), cámara abierta sin LED (gran angular o macro) o la " +
  "app corre dentro de otra app (Instagram, WhatsApp…). Cierra el " +
  "escáner y vuelve a abrirlo; si persiste, prueba en otro navegador.";

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


// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L245-L290
// (downscaleImage — función de módulo del lab, canvas puro. NO existe en el
// core → se COPIA, regla de oro 6 del SPEC-auditoria-copias.md; remediación H2.)
/** Reduce imágenes enormes de galería para no reventar la memoria del store.
 *  4032 (bug v3 de CALIDAD: estaba en 3400 y re-escalaba la foto nativa del
 *  iPhone de 4032px, añadiendo un re-encode JPEG extra — codigo-test guarda
 *  la foto full-res con una sola compresión). Con el Dual Pipeline ya no hay
 *  downscale en capturas de GAMAS ALTAS (4032×3024 ≈ 12.2 MP, lejos del
 *  límite de canvas de iOS); en media/baja el F-SENSOR-PROFILER pide 3200 px
 *  al sensor y ESTE tope es la segunda red de seguridad (imports incluidos).
 *  Recibe el elemento YA decodificado (decode único de la captura) y devuelve
 *  null si no hace falta re-escalar. */
/** C13: ahora ASÍNCRONA con toBlob (no bloquea el hilo ~1 s con imports de
 *  48 MP — mismo patrón canvasToDataUrl de más abajo). */
async function downscaleImage(
  img: HTMLImageElement,
  max = 4032
): Promise<string | null> {
  const big = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
  if (big <= max || !big) return null;
  const scale = max / big;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95)
    );
    if (blob && blob.size > 0) {
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      });
    }
  } catch {
    /* respaldo abajo */
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return null;
  }
}

/* ── ZSL §5.4 del lab — medidas SIN encode/decode extra (L311-356) ───────── */

/** Medidas de una candidata del burst: varianza Laplaciano + exposición. */
interface Medidas {
  lapVar: number;
  exposure: number;
}

/** Laplaciano 3×3 (varianza) + histograma de exposición sobre la luma de un
 *  canvas ≤ 400 px (misma matemática del quality.ts del core). */
function medirGris(gray: Float32Array, w: number, h: number): Medidas {
  const n = w * h;
  let under = 0;
  let over = 0;
  for (let i = 0; i < n; i++) {
    const l = gray[i]!;
    if (l < 30) under += 1;
    else if (l > 225) over += 1;
  }
  const exposure = 1 - (under + over) / n;
  let lapSum = 0;
  let lapSq = 0;
  let cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      cnt += 1;
    }
  }
  const lapVar = cnt > 0 ? lapSq / cnt - (lapSum / cnt) ** 2 : 0;
  return { lapVar, exposure };
}

/** Dibuja la fuente a 400 px de lado mayor y mide. SIN encode ni decode. */
function medirPixeles(src: CanvasImageSource, sw: number, sh: number): Medidas | null {
  if (!(sw > 0) || !(sh > 0)) return null;
  const s = Math.min(1, 400 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s));
  const h = Math.max(1, Math.round(sh * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  }
  return medirGris(gray, w, h);
}

// Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L927-L948
// (F-IMPORT robusto + F-HEIC — el MISMO onFilePicked del lab sirve a sus dos
//  inputs, galería y cámara nativa iOS; aquí igual, remediación H5).
/** ¿El archivo es una imagen visible en el picker? (el picker filtra por
 *  accept, pero en desktop se puede elegir «todos los archivos»). */
function pareceImagen(archivo: File): boolean {
  return (
    archivo.type.startsWith("image/") ||
    /\.(heic|heif|jpe?g|png|webp|bmp|gif|avif)$/i.test(archivo.name)
  );
}

/** ¿Parece HEIC? Heurística del lab: los «.jpg» de iPhone transportados por
 *  apps pueden traer contenido HEIC; si la decodificación nativa falla
 *  también irán al rescate (F-HEIC del core), pero no se puede saber de
 *  antemano → aviso solo si es HEIC explícito. */
function esHeic(archivo: File): boolean {
  return /heic|heif/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name);
}

/** iOS/Safari NO implementa ImageCapture en ninguna versión (lab §5.2). */
function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ se presenta como Mac con touch.
  return /Mac/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

/** R-14 (lab releaseFrame L360-365): suelta YA el backing store del canvas
 *  perdedor — no espera al GC (disciplina de memoria iOS, error #22). */
function liberarCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Telemetría reducida para el UI (throttle ~100 ms — LiveUi del lab). */
interface LiveUi {
  corners: Quad | null;
  score: number | null;
}

/** Frame del ring ZSL (copia dedicada + lapVar + timestamp). */
interface FrameAnillo {
  canvas: HTMLCanvasElement;
  lapVar: number;
  timestamp: number;
}

type CamEstado = "iniciando" | "viva" | "no-disponible";

export function ScanView() {
  const dispararEscaneo = useE14Store((s) => s.dispararEscaneo);
  const fuente = useE14Store((s) => s.fuente);
  const setFuente = useE14Store((s) => s.setFuente);
  // §D2/§D3 (SPEC-e14-simulacion-scores): los chips disparan la simulación
  // determinista (store.simularScore — mismo camino de dispararEscaneo).
  const simularScore = useE14Store((s) => s.simularScore);
  const setArchivoPendiente = useE14Store((s) => s.setArchivoPendiente);
  const setFramePendiente = useE14Store((s) => s.setFramePendiente);
  // G3 (upgrade silencioso): re-proceso full-res del acta en revisión.
  const mejorarFotoActa = useE14Store((s) => s.mejorarFotoActa);
  const inputRef = useRef<HTMLInputElement>(null);
  /** HQ-iOS: cámara NATIVA del sistema (el click del shutter es el gesto). */
  const inputCamaraRef = useRef<HTMLInputElement>(null);

  // ── Cámara (refs y estado — patrón del lab L383-458) ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visorRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<CameraFrameLoop | null>(null);
  const procesandoRef = useRef(false);
  const cooldownRef = useRef(0);
  // D9 (SPEC-e14-guard-borde Rev. 2): captura automática ARMADA por defecto —
  // REVISA el default OFF de D22/D24 por mandato del dueño («cuando se habra
  // la camara siempre este activado la captura automatica»). El estado nace
  // armado Y cada APERTURA de cámara RE-ARMA (setAutoArmado(true) en el
  // arranque exitoso del stream — el estado persiste entre aperturas, hay
  // que forzarlo). El operador conserva el toggle: desarmar EN VIVO se
  // respeta dentro de la MISMA apertura (no se re-arma solo — AC14-AC16).
  const [autoArmado, setAutoArmado] = useState(true);
  const autoRef = useRef(false);
  /** F-FLASH: preferencia de linterna de la sesión (re-aplicada por stream). */
  const [flashPrefOn, setFlashPrefOn] = useState(false);
  const flashRef = useRef(false);
  /** Espejo legible desde listeners sin re-render (lab L399-400). */
  const torchOnRef = useRef(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchDisponible, setTorchDisponible] = useState(false);
  const [camEstado, setCamEstado] = useState<CamEstado>("iniciando");
  // §E (SPEC-camara-funcional): aviso de cámara (denied/perdido) con
  // reintento — fin del rebote silencioso a SIMULACIÓN. reintentoCamara es
  // el token que re-dispara el efecto de arranque ([ACTIVAR CÁMARA]).
  const [avisoCamara, setAvisoCamara] = useState<null | "denied" | "perdido">(null);
  const [reintentoCamara, setReintentoCamara] = useState(0);
  // STITCH REDESIGN (SPEC-e14-redesign-stitch §3.1.4): los avisos que antes
  // eran toasts flotantes viven como FRANJA DENTRO del visor (sin
  // notificaciones — §4/D2). tono crit = borde/texto rojo; warn = ámbar.
  const [avisoVisor, setAvisoVisor] = useState<
    null | { texto: string; tono: "crit" | "warn" }
  >(null);
  const avisoTimerRef = useRef(0);
  /** Muestra la franja del visor con auto-desaparición (ms). */
  const mostrarAviso = useCallback(
    (texto: string, tono: "crit" | "warn", ms = 4000) => {
      window.clearTimeout(avisoTimerRef.current);
      setAvisoVisor({ texto, tono });
      avisoTimerRef.current = window.setTimeout(() => setAvisoVisor(null), ms);
    },
    [],
  );
  // §3.1.1 (mock 1): botón de cuadrícula de la píldora IA — overlay
  // visual de retícula sobre el visor (toggle decorativo, como el mock).
  const [gridOn, setGridOn] = useState(false);
  // §6.3 (SPEC): el botón AMARILLO abre el selector de MODO (los 3 modos
  // actuales como píldoras re-vestidas) — modoMenuMontado es la fase de
  // entrada (150 ms, opacidad + scale). El menú ⋮ del skin anterior
  // desaparece (§6.6: oculto por defecto hasta que el dueño asigne función).
  const [modoMenuAbierto, setModoMenuAbierto] = useState(false);
  const [modoMenuMontado, setModoMenuMontado] = useState(false);
  const [live, setLive] = useState<LiveUi>({ corners: null, score: null });
  const [procesando, setProcesando] = useState(false);
  const [destelloKey, setDestelloKey] = useState(0);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const puedeTomarFotoRef = useRef(false);
  // Fuente: lab CameraView.tsx L770 (takePhotoBrokenRef) — FIX v4 4.1: lista
  // negra temporal del sensor. Un takePhoto que expira la marca para que
  // captureSmart NO vuelva a colgar en cada disparo; se rehabilita al abrir
  // stream nuevo (lab L2760) y si una respuesta futura llega (L1434).
  const takePhotoBrokenRef = useRef(false);
  // G3 (upgrade silencioso del lab L1806-1842): identidad del acta que ESTE
  // disparo creó (el pageId del lab) — la captura despacharCaptura al
  // resolver dispararEscaneo; el runner del upgrade la usa como guard.
  const actaObjetivoRef = useRef<Acta | null>(null);
  const toastIOSYaRef = useRef(false);
  const telemetriaAtRef = useRef(0);
  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L433-L440
  /** F-SENSOR-PROFILER (PASO 2): perfil del sensor de FOTO del track vivo
   *  (resolución nativa vía getPhotoCapabilities + tope seguro 4032/3200 px
   *  según la gama medida). null = aún sin sondear. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
  // F-ZSL — buffer circular Best-Shot (lab L407-411).
  const anilloRef = useRef<FrameAnillo[]>([]);
  const anilloFeedAtRef = useRef(0);
  const anilloScratchRef = useRef<HTMLCanvasElement | null>(null);

  // Espejos para listeners del loop sin re-render (lab L456-458).
  autoRef.current = autoArmado;
  flashRef.current = flashPrefOn;
  torchOnRef.current = torchOn;

  const modoCamara = fuente === "CAMARA";
  const camaraViva = modoCamara && camEstado === "viva";
  const buscando = camaraViva && live.corners === null;
  const scoreAlto = (live.score ?? 0) > SHUTTER_SCORE;
  const scorePct = live.score !== null ? Math.round(live.score * 100) : null;

  // §9: precarga OpenCV.js del worker sin bloquear la UI.
  useEffect(() => {
    warmUpScannerWorker();
    // KIT e14-prowarm-ocr-v1 (T2b): pre-warm del OCR diferido 2 s (app recién
    // abierta — no competir con la carga). Idempotente: si MASIVA ya calentó,
    // rapidOcrPrecalentar() resuelve al instante (flag de módulo).
    const t = window.setTimeout(() => void rapidOcrPrecalentar(), 2000);
    return () => window.clearTimeout(t);
  }, []);

  // §C → §6.3 (redesign-stitch): Escape cierra el selector de modo;
  // modoMenuMontado pasa a true un frame tras el montaje para que la
  // transición de entrada (150 ms, opacidad + scale-0.97→1) corra en CSS
  // puro (sin framer-motion).
  useEffect(() => {
    if (!modoMenuAbierto) {
      setModoMenuMontado(false);
      return;
    }
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModoMenuAbierto(false);
    };
    window.addEventListener("keydown", alTecla);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setModoMenuMontado(true));
    });
    return () => {
      window.removeEventListener("keydown", alTecla);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [modoMenuAbierto]);

  /* ── Linterna — F-FLASH v3 (lab L473-520) ─────────────────────────── */

  /** Enciende/apaga el torch y VERIFICA el resultado real leyendo
   *  getSettings().torch — NO confiando en getCapabilities() (hay Chrome que
   *  no anuncian torch en caps pero SÍ lo aplican). Devuelve true si el LED
   *  quedó controlado. */
  const ponerLinterna = useCallback(async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    try {
      const caps = track.getCapabilities?.() as { torch?: boolean } | undefined;
      if (caps?.torch) setTorchDisponible(true);
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as MediaTrackConstraints & { advanced: unknown[] });
      const st = track.getSettings() as { torch?: boolean };
      const aplicado = on ? st.torch === true : st.torch !== true;
      if (aplicado) {
        torchOnRef.current = on;
        setTorchOn(on);
      }
      if (caps?.torch || aplicado) setTorchDisponible(true);
      if (!aplicado && on) {
        // Aceptado en silencio pero sin señal verificable: deshaz para no
        // dejar un LED encendido "fantasma" (lab L494-502).
        await track
          .applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints & {
            advanced: unknown[];
          })
          .catch(() => undefined);
      }
      return aplicado;
    } catch {
      return false;
    }
  }, []);

  /** Re-aplica la preferencia persistida CON REINTENTOS (0/250/700/1500 ms):
   *  varios Android rechazan applyConstraints justo tras getUserMedia. */
  const aplicarLinternaGuardada = useCallback(() => {
    for (const ms of [0, 250, 700, 1500]) {
      window.setTimeout(() => {
        if (!flashRef.current || torchOnRef.current) return;
        void ponerLinterna(true);
      }, ms);
    }
  }, [ponerLinterna]);

  /* ── Captura ZSL (lab L710-770) ───────────────────────────────────── */

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

  /** Copia el fotograma al ring (máx 8) y suelta YA el backing store del
   *  expulsado (disciplina de memoria iOS, error #22).
   *  Fuente: lab CameraView.tsx L1512-1537 (FIX v4 4.5) — la copia se dibuja
   *  ESCALADA para que su lado mayor sea ≤ RING_MAX_LONG_SIDE (1280 px): a
   *  resolución completa (stream alto de iOS 1920×1440) 8 slots ≈ 66 MB y
   *  esa presión de memoria hacía que WebKit matara la capa de video (visor
   *  negro). El ring es SOLO el fallback: no necesita resolución completa. */
  const empujarAnillo = useCallback((canvas: HTMLCanvasElement, lapVar: number) => {
    const anillo = anilloRef.current;
    const srcLong = Math.max(canvas.width, canvas.height);
    const escala = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
    const copia = document.createElement("canvas");
    copia.width = Math.max(1, Math.round(canvas.width * escala));
    copia.height = Math.max(1, Math.round(canvas.height * escala));
    copia.getContext("2d")?.drawImage(canvas, 0, 0, copia.width, copia.height);
    anillo.push({ canvas: copia, lapVar, timestamp: performance.now() });
    if (anillo.length > RING_MAX) {
      const viejo = anillo.shift();
      if (viejo) liberarCanvas(viejo.canvas);
    }
  }, []);

  /** Alimenta el ring desde el <video> vivo a ~5 Hz: garantiza que el buffer
   *  SIEMPRE cubra la ventana pre-tap de 80–450 ms.
   *  Fuente: lab CameraView.tsx L1541-1574 (FIX v4 4.5) — el scratch se
   *  dimensiona a la medida ESCALADA (lado mayor ≤ 1280 px), no a la
   *  resolución del track: el ring no necesita más y la medición es
   *  idéntica (medirPixeles remuestrea a ~400 px). */
  const alimentarAnillo = useCallback((): void => {
    const ahora = performance.now();
    if (ahora - anilloFeedAtRef.current < RING_FEED_MS) return;
    anilloFeedAtRef.current = ahora;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!anilloScratchRef.current) anilloScratchRef.current = document.createElement("canvas");
    const scratch = anilloScratchRef.current;
    const srcLong = Math.max(video.videoWidth, video.videoHeight);
    const escala = srcLong > RING_MAX_LONG_SIDE ? RING_MAX_LONG_SIDE / srcLong : 1;
    const dw = Math.max(1, Math.round(video.videoWidth * escala));
    const dh = Math.max(1, Math.round(video.videoHeight * escala));
    if (scratch.width !== dw || scratch.height !== dh) {
      scratch.width = dw;
      scratch.height = dh;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, dw, dh);
    const m = medirPixeles(scratch, dw, dh);
    empujarAnillo(scratch, m?.lapVar ?? 0);
  }, [empujarAnillo]);

  /** Libera el ring (al desmontar la sesión de cámara — lab L1395-1400). */
  const liberarAnillo = useCallback(() => {
    for (const f of anilloRef.current) liberarCanvas(f.canvas);
    anilloRef.current = [];
  }, []);

  /** Instantánea del <video> a resolución del track + medidas sobre ESA MISMA
   *  imagen (par píxel-idéntico). SIN encode: solo si gana el burst. */
  const instantanea = useCallback(
    (): { canvas: HTMLCanvasElement; lapVar: number } | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);
      const m = medirPixeles(canvas, canvas.width, canvas.height);
      empujarAnillo(canvas, m?.lapVar ?? 0);
      return { canvas, lapVar: m?.lapVar ?? 0 };
    },
    [empujarAnillo],
  );

  /** F-ZSL: ganador pre-tap (mayor lapVar entre 80 y 450 ms antes del
   *  disparo) y VACIADO del ring — el canvas del ganador pasa al burst. */
  const tomarZsl = useCallback((): { canvas: HTMLCanvasElement; lapVar: number } | null => {
    const ahora = performance.now();
    const enVentana = anilloRef.current.filter((f) => {
      const edad = ahora - f.timestamp;
      return edad >= ZSL_DESDE_MS && edad <= ZSL_HASTA_MS;
    });
    const ganador =
      enVentana.length > 0
        ? enVentana.reduce((a, b) => (b.lapVar > a.lapVar ? b : a))
        : null;
    // Libera el ring EXCEPTO el canvas del ganador (lab L809-814).
    for (const f of anilloRef.current) {
      if (f === ganador) continue;
      liberarCanvas(f.canvas);
    }
    anilloRef.current = [];
    if (!ganador) return null;
    return { canvas: ganador.canvas, lapVar: ganador.lapVar };
  }, []);

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L625-L635
  /** Blob → data URL (para el takePhoto hi-res). */
  const blobToDataUrl = useCallback(
    (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ""));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      }),
    []
  );

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

  /** Canvas → Blob JPEG 0.92 (toBlob, NUNCA toDataURL en canvas grande). */
  const canvasABlob = useCallback(async (canvas: HTMLCanvasElement): Promise<Blob | null> => {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    return blob && blob.size > 0 ? blob : null;
  }, []);

  /** Despacha la captura: destello + vibrate + File → store → ANALIZANDO.
   *  La navegación se demora ~260 ms para que el destello (~120 ms) se vea
   *  ANTES de desmontar el visor. G3 (upgrade silencioso): al resolver
   *  dispararEscaneo captura la IDENTIDAD del acta creada por este disparo
   *  (el pageId del lab) — el runner del upgrade la usa como guard. */
  const despacharCaptura = useCallback(
    (archivo: File) => {
      setArchivoPendiente(archivo);
      setDestelloKey((k) => k + 1);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(30);
      }
      window.setTimeout(() => {
        procesandoRef.current = false;
        setProcesando(false);
        void dispararEscaneo().then(() => {
          actaObjetivoRef.current = useE14Store.getState().actaActual;
        });
      }, NAVEGACION_TRAS_MS);
    },
    [dispararEscaneo, setArchivoPendiente],
  );

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L574-L589
  // (dispatch de handleCaptureDataUrl — decode ÚNICO + capa 3 del
  //  F-SENSOR-PROFILER, remediación H2). Adaptación e14 (fila 4 de la
  //  auditoría): el lab entrega dataUrl a su pipeline; el bridge de e14
  //  recibe File → esta función decodifica UNA vez, aplica el tope por GAMA
  //  y devuelve el File YA dentro del tope — el pipeline de e14 recibe la
  //  foto ya dentro del tope, SIN IMPORTAR LA FUENTE (CÁMARA takePhoto/ZSL +
  //  IMPORTAR 12–48 MP + foto nativa iOS). `robusto` = Files del picker
  //  (F-IMPORT del core: HEIC/EXIF/12-48MP seguros — el lab hace exactamente
  //  esto en onFilePicked); false = File nacido del blob del sensor (base64
  //  barato, sin re-decode). Devuelve null SOLO si la ruta robusta falló.
  const archivoDentroDeTope = useCallback(
    async (archivo: File, robusto: boolean): Promise<File | null> => {
      try {
        const rawDataUrl = robusto
          ? await fileToCaptureDataUrl(archivo)
          : await blobToDataUrl(archivo);
        if (!rawDataUrl) return null; // F-IMPORT falló → el llamador avisa (lab L954-961)
        // Decode ÚNICO de la captura (antes: downscale + detect + quality
        // decodificaban la misma foto de 12 MP tres veces). El elemento se
        // reutiliza en las etapas; solo se re-decodifica si hubo que
        // re-escalar una imagen de galería más grande que el sensor.
        const decoded = await loadImage(rawDataUrl);
        // F-SENSOR-PROFILER: el tope del downscale sigue la GAMA medida
        // (4032 alta / 3200 media-baja) — segunda red de seguridad por si
        // la foto llegó por encima del tope (photoSettings no aplicado).
        const scaledUrl = await downscaleImage(
          decoded,
          sensorProfileRef.current?.safeCapPx ?? getSensorSafeCap()
        );
        // Dentro del tope → el archivo original pasa INTACTO (F-RES-PRIORITY:
        // la resolución del sensor manda, cero re-encode extra).
        if (!scaledUrl) return archivo;
        const blob = await (await fetch(scaledUrl)).blob();
        if (!blob.size) return archivo;
        return new File([blob], archivo.name, { type: blob.type || "image/jpeg" });
      } catch {
        return archivo; // el bridge reintenta con su propio pipeline robusto
      }
    },
    [blobToDataUrl],
  );

  /** Despacha la captura FINAL (ya dentro del tope H2): destello + vibrate +
   *  File → store → ANALIZANDO. La navegación se demora ~260 ms para que el
   *  destello (~120 ms) se vea ANTES de desmontar el visor. */
  const despacharArchivo = useCallback(
    async (blobOArchivo: Blob, robusto: boolean) => {
      const base =
        blobOArchivo instanceof File
          ? blobOArchivo
          : new File([blobOArchivo], `acta-camara-${Date.now()}.jpg`, {
              type: blobOArchivo.type || "image/jpeg",
            });
      const final = (await archivoDentroDeTope(base, robusto)) ?? base;
      despacharCaptura(final);
    },
    [archivoDentroDeTope, despacharCaptura],
  );

  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L1806-1842
  // (runSilentUpgrade — LOTE 5.4/5.5, adaptado a e14).
  /** G3 — UPGRADE SILENCIOSO: la foto full-res del sensor aterrizó (~15-18 s)
   *  tras el disparo rápido por peldaño → re-procesa el acta EN REVISIÓN
   *  (store.mejorarFotoActa → bridge.mejorarResolucion: re-proceso sin
   *  consumir intento, quad RE-DETECTADO sobre la foto nueva, gate completo).
   *  Todo el trabajo vive FUERA del flujo crítico (el usuario ya está en
   *  revisión). Solo SUBE (lab L1830-1832): si el lado mayor no supera
   *  claramente al del peldaño (2048), el acta no se toca. Fallos
   *  silenciosos: si no llega o llega roto, el acta queda como está. */
  const mejorarSilenciosa = useCallback(
    async (upgrade: Promise<Blob>): Promise<void> => {
      try {
        const blob = await upgrade;
        if (!blob || blob.size === 0) return;
        // Solo SUBE: decode FUERA del flujo crítico (el upgrade ya vuela en
        // segundo plano — el lab lo mide con readBlobLongSide barato; aquí
        // el decode único de loadImage es aceptable a esta altura).
        const rawDataUrl = await blobToDataUrl(blob);
        if (!rawDataUrl) return;
        const decoded = await loadImage(rawDataUrl);
        const longSide = Math.max(decoded.naturalWidth || 0, decoded.naturalHeight || 0);
        if (!Number.isFinite(longSide) || longSide < 2048) return;
        // Mismo tratamiento que el camino de siempre: decode único + tope
        // por GAMA (archivoDentroDeTope — capa 3 H2) antes del bridge.
        const objetivo = actaObjetivoRef.current;
        if (!objetivo) return;
        const final = await archivoDentroDeTope(
          new File([blob], "mejora-fullres.jpg", { type: blob.type || "image/jpeg" }),
          false,
        );
        if (!final) return;
        const finalUrl = await blobToDataUrl(final);
        if (!finalUrl) return;
        // Guardas de identidad (acta sigue viva y es la misma) viven en el
        // store — igual que el lab (pageId alive check L1824-1826).
        void mejorarFotoActa(finalUrl, objetivo);
      } catch {
        /* silencioso: el upgrade JAMÁS rompe nada */
      }
    },
    [blobToDataUrl, archivoDentroDeTope, mejorarFotoActa],
  );

  /** Captura inteligente (lab captureSmart L785-885, adaptada a e14: el
   *  resultado entra al pipeline del bridge como File):
   *  1. ZSL pre-tap (ganador del ring, anti tap-shock).
   *  2. Foto full-res del sensor (takePhoto) si hay ImageCapture → gana
   *     SIEMPRE (F-RES-PRIORITY: la resolución es intocable).
   *  3. Sin foto → burst {zsl, snapA, snap} por lapVar → encode del ganador.
   *  4. Sin NADA → grab del video vivo vía frameActual del bridge. */
  const capturarInteligente = useCallback(async (): Promise<void> => {
    if (procesandoRef.current) return;
    if (cooldownRef.current > Date.now()) return;
    loopRef.current?.notifyCaptured();
    cooldownRef.current = Date.now() + COOLDOWN_MS;
    procesandoRef.current = true;
    setProcesando(true);

    const zsl = tomarZsl();
    // §5.4 — frame A ANTES de la foto: si takePhoto cuelga y cae (8 s),
    // ya queda un candidato válido medido del momento real del tap.
    // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L843-L845
    // (remediación H3 — snapA existe antes del disparo; el burst de respaldo
    //  queda [zsl, snapA, snapB] con snapA del instante correcto).
    const snapA = instantanea();
    // G3/G5 (lab L1770): canPhoto = gate de plataforma (CAN_TAKEPHOTO, ya en
    // el ref) Y lista negra temporal NO activa — un sensor con el takePhoto
    // colgado no vuelve a pagar los 8 s en cada disparo.
    const puedeFotoAhora = puedeTomarFotoRef.current && !takePhotoBrokenRef.current;
    const fotoBlob = puedeFotoAhora
      ? await tomarFoto((upgrade) => void mejorarSilenciosa(upgrade))
      : null;
    if (fotoBlob) {
      // La foto full-sensor gana: suelta los frames de respaldo (R-14).
      if (zsl) liberarCanvas(zsl.canvas);
      if (snapA) liberarCanvas(snapA.canvas);
      // Capa 3 H2: decode único + tope por GAMA antes del bridge (el blob ya
      // viene ≤tope de las capas 1-2 — aquí es verificación barata, como el
      // dispatch L574-589 del lab).
      void despacharArchivo(fotoBlob, false);
      return;
    }
    if (puedeFotoAhora && camEstado === "viva") {
      // takePhoto colgó (> 8 s) o no existe → aviso honesto del fallback
      // (franja del visor — redesign-stitch §3.1.4).
      mostrarAviso(
        "CAPTURA A RESOLUCIÓN DEL VISOR — la foto del sensor no respondió; se analiza el mejor fotograma reciente.",
        "warn",
        5000,
      );
    }
    const snapB = instantanea();
    const candidatos = [zsl, snapA, snapB].filter(
      (f): f is { canvas: HTMLCanvasElement; lapVar: number } => f !== null,
    );
    if (candidatos.length === 0) {
      // Último recurso (lab B8 → e14): grab del video vivo por el bridge
      // (frameActual → canvas a resolución del stream).
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth) {
        setDestelloKey((k) => k + 1);
        window.setTimeout(() => {
          procesandoRef.current = false;
          setProcesando(false);
          void dispararEscaneo();
        }, NAVEGACION_TRAS_MS);
      } else {
        procesandoRef.current = false;
        setProcesando(false);
        mostrarAviso("NO SE PUDO CAPTURAR — inténtalo de nuevo.", "crit");
      }
      return;
    }
    const ganador = candidatos.reduce((a, b) => (b.lapVar > a.lapVar ? b : a));
    const blob = await canvasABlob(ganador.canvas);
    for (const c of candidatos) {
      // FIX (auditoría 2-b #8): TODOS los canvases se liberan (antes el
      // ganador quedaba vivo esperando al GC — inconsistente con la
      // disciplina iOS del propio módulo, error #22 del lab).
      liberarCanvas(c.canvas);
    }
    if (blob) {
      // Capa 3 H2: el frame ganador también pasa por el tope (decode único,
      // verificación barata — frames de preview, muy por debajo del tope).
      void despacharArchivo(blob, false);
    } else {
      procesandoRef.current = false;
      setProcesando(false);
      mostrarAviso("NO SE PUDO CAPTURAR — inténtalo de nuevo.", "crit");
    }
  }, [
    tomarZsl,
    tomarFoto,
    instantanea,
    canvasABlob,
    despacharArchivo,
    dispararEscaneo,
    camEstado,
    mostrarAviso,
    mejorarSilenciosa,
  ]);

  /** Ref fresca del captureSmart para los listeners del loop (lab L887-888). */
  const capturarRef = useRef(capturarInteligente);
  capturarRef.current = capturarInteligente;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las 4 ausentes son estables: setFramePendiente (acción Zustand), mostrarAviso/profileActiveSensor (useCallback []) y aplicarLinternaGuardada (useCallback ← ponerLinterna, que es useCallback []); el arranque SOLO debe correr al cambiar fuente/reintentoCamara
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- aplicarLinternaGuardada es estable (useCallback ← ponerLinterna, que es useCallback []); re-suscribir «playing» solo al alternar camaraViva
  }, [camaraViva]);

  /** Tamaño del visor (ResizeObserver — mapeo object-cover del overlay). */
  useEffect(() => {
    const el = visorRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBoxSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- las 3 ausentes son estables: alimentarAnillo (useCallback ← empujarAnillo []), liberarAnillo ([]) y mostrarAviso (useCallback []); el loop usa refs deliberadamente para evitar staleness
  }, [camaraViva]);

  /** Linterna — botón SIEMPRE activo con cámara; la verdad al pulsar (lab
   *  toggleTorch L1404-1422). Sin cámara viva o sin verificación → hint
   *  completo del lab (TORCH_HINT verbatim — remediación H4). */
  const alternarLinterna = useCallback(async () => {
    if (camEstado !== "viva") {
      mostrarAviso(`LINTERNA NO CONTROLADA — ${TORCH_HINT}`, "warn", 7000);
      return;
    }
    const siguiente = !torchOn;
    const aplicado = await ponerLinterna(siguiente);
    if (aplicado) {
      setFlashPrefOn(siguiente);
      // FLASH ENCENDIDO: feedback persistente = el botón encendido (ámbar).
    } else {
      mostrarAviso(`LINTERNA NO CONTROLADA — ${TORCH_HINT}`, "warn", 7000);
    }
  }, [camEstado, torchOn, ponerLinterna, mostrarAviso]);

  /** §B (SPEC-camara-funcional): botón ámbar = CAPTURA AUTOMÁTICA (paridad
   *  con el lab CameraView L2350-2382): en CÁMARA alterna el MISMO autoArmado
   *  del botón inferior «Auto» (quedan sincronizados — mismo useState);
   *  en SIMULACIÓN/IMPORTAR el tap NO se queda mudo: avisa que la función
   *  vive con la cámara viva. */
  const alternarAutoHUD = useCallback(() => {
    if (!modoCamara) {
      mostrarAviso(
        "CAPTURA AUTOMÁTICA EN CÁMARA — funciona con la cámara viva. Cambia de modo con el botón amarillo.",
        "warn",
        4500,
      );
      return;
    }
    setAutoArmado((v) => !v);
  }, [modoCamara, mostrarAviso]);

  /* ── Disparo por plataforma (lab onShutter L902-925) ──────────────── */

  const alDisparar = useCallback(() => {
    if (fuente !== "CAMARA") {
      // SIM/ARCHIVO: disparo directo (L2 intacto; el guard del store avisa).
      void dispararEscaneo();
      return;
    }
    const video = videoRef.current;
    const streamVivo = camEstado === "viva" && !!video && video.readyState >= 2;
    if (streamVivo) {
      if (puedeTomarFotoRef.current || !esIOS()) {
        // Chrome/Android → takePhoto full-res; desktop sin ImageCapture →
        // best frame ZSL del ring (el fallback interno de captureSmart).
        void capturarInteligente();
      } else {
        // HQ-iOS: el click del shutter ES el gesto de usuario que iOS exige
        // → cámara NATIVA del sistema (input capture=environment).
        inputCamaraRef.current?.click();
      }
      return;
    }
    inputCamaraRef.current?.click(); // cámara iniciando → picker
  }, [fuente, camEstado, dispararEscaneo, capturarInteligente]);

  /** Elegir imagen = fuente ARCHIVO + análisis inmediato (L2) + capa 3 H2:
   *  la foto de galería (12–48 MP) entra al pipeline YA dentro del tope
   *  (decode único + downscaleImage por GAMA — dispatch L574-589 del lab).
 *  Guard F-IMPORT/HEIC del lab L937-948 (remediación H5). */
  const alElegirArchivo = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el MISMO archivo (REPETIR FOTO)
    if (!archivo) return;
    // FIX M4 (auditoría 2-b): guard temprano — con una captura en vuelo el
    // archivo se procesaría (tope/HEIC) para nada y el disparo se ignora.
    if (procesandoRef.current || useE14Store.getState().vista === "analizando") {
      mostrarAviso("ESPERA — YA HAY UNA CAPTURA EN CURSO", "warn", 2500);
      return;
    }
    if (!pareceImagen(archivo)) {
      mostrarAviso("ARCHIVO NO VÁLIDO — el archivo seleccionado no es una imagen.", "crit");
      return;
    }
    // HEIC explícito → aviso de conversión (puede tardar unos segundos; la
    // conversión vive en el F-HEIC del core, dentro del pipeline).
    if (esHeic(archivo)) {
      mostrarAviso("CONVIRTIENDO HEIC… la conversión puede tardar unos segundos.", "warn", 3000);
    }
    void (async () => {
      const final = await archivoDentroDeTope(archivo, true);
      if (!final) {
        // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx
        // L954-L961 (error path de F-IMPORT) — franja del visor (§3.1.4).
        mostrarAviso(
          esHeic(archivo)
            ? "NO SE PUDO PROCESAR LA IMAGEN — no se pudo convertir el HEIC. El archivo parece dañado o protegido. Prueba con otro."
            : "NO SE PUDO PROCESAR LA IMAGEN — el archivo puede estar corrupto o ser un formato no soportado. Prueba con otro.",
          "crit",
          6000,
        );
        return;
      }
      setArchivoPendiente(final);
      setFuente("ARCHIVO");
      void dispararEscaneo();
    })();
  };

  /** Ruta iOS (HQ-iOS §5.2): la foto de la cámara nativa entra como archivo
   *  al MISMO pipeline (fuente ya es CÁMARA — spec §7 "como ARCHIVO, L2") +
   *  capa 3 H2: la foto nativa (12–48 MP, puede ser HEIC) pasa por el tope
   *  y la conversión robusta del core ANTES de tocar el bridge. Guard
   *  F-IMPORT/HEIC del lab L937-948 (remediación H5 — el mismo handler del
   *  lab sirve a sus dos inputs). */
  const alElegirFotoCamara = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    // FIX M4 (auditoría 2-b): mismo guard del IMPORTAR (ruta iOS nativa).
    if (procesandoRef.current || useE14Store.getState().vista === "analizando") {
      mostrarAviso("ESPERA — YA HAY UNA CAPTURA EN CURSO", "warn", 2500);
      return;
    }
    if (!pareceImagen(archivo)) {
      mostrarAviso("ARCHIVO NO VÁLIDO — el archivo seleccionado no es una imagen.", "crit");
      return;
    }
    if (esHeic(archivo)) {
      mostrarAviso("CONVIRTIENDO HEIC… la conversión puede tardar unos segundos.", "warn", 3000);
    }
    void despacharArchivo(archivo, true);
  };

  /* ── Overlay: quad REAL con mapeo object-cover (lab L1493-1515) ────── */

  const alCargarMetaVideo = useCallback(() => {
    const v = videoRef.current;
    if (v?.videoWidth) setVideoDims({ w: v.videoWidth, h: v.videoHeight });
  }, []);

  /** Mapea fracciones del FRAME → % del visor visible (object-cover). */
  const mapearPunto = useCallback(
    (p: { x: number; y: number }) => {
      if (!boxSize.w || !videoDims.w) return { x: p.x * 100, y: p.y * 100 };
      const escala = Math.max(boxSize.w / videoDims.w, boxSize.h / videoDims.h);
      const dw = videoDims.w * escala;
      const dh = videoDims.h * escala;
      const ox = (boxSize.w - dw) / 2;
      const oy = (boxSize.h - dh) / 2;
      return {
        x: ((ox + p.x * dw) / boxSize.w) * 100,
        y: ((oy + p.y * dh) / boxSize.h) * 100,
      };
    },
    [boxSize, videoDims],
  );

  const puntosQuad = live.corners
    ?.map((p) => {
      const m = mapearPunto(p);
      return `${m.x.toFixed(2)} ${m.y.toFixed(2)}`;
    })
    .join(" L ");


  // §4: label del modo ACTIVO para la fila de contexto del dock (data-driven).
  const labelModo =
    fuente === "CAMARA" ? "CÁMARA" : fuente === "ARCHIVO" ? "IMPORTAR" : "SIMULACIÓN";

  // §6.8 (mock 1): obturador Ø72 — aro blanco 3.5px + shutter-glow + interior
  // bg-brand-panel border-green/40 + documento 32px. MISMO disparo por
  // plataforma (~alDisparar), intocado.
  const obturador = (
    <button
      type="button"
      id="shutter-capture-btn"
      aria-label="Capturar fotografía del acta E-14"
      onClick={alDisparar}
      disabled={procesando}
      className={`relative w-[74px] h-[74px] rounded-full p-1 bg-transparent border-2 border-white/80 flex items-center justify-center active:scale-90 transition-all duration-100 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:border-[#10b981] focus:outline-none focus:border-[#10b981] cursor-pointer ${
        procesando ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <div className="w-full h-full rounded-full bg-[#10161f] border border-[#10b981]/50 flex items-center justify-center text-white active:bg-[#10b981]/20 transition-colors shadow-inner">
        <StitchShutterDocIcon className="w-8 h-8 text-[#10b981]" />
      </div>
    </button>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-brand-viewfinder pt-safe">
      {/* Inputs ocultos: IMPORTAR (galería) + cámara nativa iOS (capture).
          accept con .heic/.heif (lab L1536, remediación H5): en Android/Chrome
          los HEIC llegan con MIME vacío o raro y «image/*» a secas los deja
          FUERA del picker — sin el accept, la conversión F-HEIC del core
          jamás se ejercita. La cámara nativa iOS también entrega HEIC. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        aria-label="Importar imagen"
        onChange={alElegirArchivo}
      />
      <input
        ref={inputCamaraRef}
        type="file"
        accept="image/*,.heic,.heif"
        capture="environment"
        className="hidden"
        aria-label="Tomar foto con la cámara del sistema"
        onChange={alElegirFotoCamara}
      />

      {/* §3.1.2 VISOR (mock 1): fondo #050706 limpio (G1: sin LÁSER — el
          anillo de análisis de AnalyzingView es OTRA pantalla y conserva su
          animación). La cámara real sigue siendo el <video>/stream actual.
          En modo CÁMARA se conservan TODOS los overlays funcionales,
          re-vestidos a brand-green. */}
      <div className="flex-1 min-h-0 flex">
        <div
          ref={visorRef}
          className="relative flex-1 bg-brand-viewfinder flex items-center justify-center overflow-hidden"
        >
          {/* FIX del dueño (14-oct): la vista previa va LIMPIA — sin capas
              decorativas sobre el video. Las tres del mock 1 (haze radial
              mix-blend-screen + gradiente negro 80/40/90 + scanlines)
              oscurecían y "filtraban" la imagen real de la cámara, que es
              justo lo que el operador necesita ver nítido para encuadrar.
              G1 (KIT camara-visor-v1): el LÁSER de escaneo también sale
              (puro adorno — pointer-events-none — pedido expreso del dueño:
              «quitar la línea verde de la cámara»). Se conserva SOLO la
              retícula opcional (no altera la imagen). */}
          {/* Retícula visual (§3.1.1: botón de cuadrícula de la píldora IA) */}
          {gridOn && (
            <div
              className="absolute inset-0 z-[12] pointer-events-none bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[length:33.33%_33.33%]"
              aria-hidden
            />
          )}

          {/* Header con segmented selector [ CÁMARA | SIMULACIÓN | IMPORTAR ] + controles */}
          {/* Task 2-b: en lg+ el HUD gana respiro (padding/píldoras mayores) y
              la fila se acota a max-w-2xl centrada — segment control
              profesional, no dos islas a los bordes del visor. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col gap-2 p-3 lg:gap-3 lg:px-5 lg:pt-4">
            <div className="flex items-center justify-between w-full lg:max-w-2xl lg:mx-auto">
              {/* Píldora IA: AUTO + Grid */}
              <div className="pointer-events-auto flex items-center gap-1.5 bg-[#10161f]/90 border border-slate-800 rounded-full px-2.5 py-1 lg:px-3.5 lg:py-1.5 backdrop-blur-md shadow-md">
                <span className="inline-flex items-center justify-center bg-white text-slate-900 text-[10px] font-black rounded px-1.5 py-0.5 leading-none select-none">
                  IA
                </span>
                <button
                  type="button"
                  aria-label="Alternar cuadrícula"
                  aria-pressed={gridOn}
                  onClick={() => setGridOn((v) => !v)}
                  className={`p-1 lg:p-1.5 rounded-full transition flex items-center justify-center gap-1.5 ${
                    gridOn ? "text-[#10b981] bg-[#10b981]/15" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <StitchGridIcon className="w-4 h-4" />
                  {/* Task 2-b (crítica VLM): etiqueta visible en lg+ — el icono
                      solo deja de ser adivinanza; en móvil queda el aria-label. */}
                  <span className="hidden lg:inline text-[10px] font-bold tracking-wide">
                    CUADRÍCULA
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Captura automática"
                  aria-pressed={modoCamara ? autoArmado : undefined}
                  title={
                    modoCamara
                      ? "Captura automática (dispara sola con el acta quieta y nítida)"
                      : "Captura automática (disponible en modo cámara)"
                  }
                  onClick={alternarAutoHUD}
                  className={`inline-flex items-center gap-1.5 text-[11px] lg:text-xs font-bold tracking-wide px-2 lg:px-3 py-0.5 lg:py-1 rounded-full select-none transition ${
                    autoArmado && modoCamara ? "bg-[#10b981]/15 text-[#10b981]" : "text-slate-300 hover:text-white"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      autoArmado && modoCamara ? "bg-[#10b981] animate-ping" : "bg-slate-500"
                    }`}
                    aria-hidden
                  />
                  AUTO
                </button>
                {/* Task 4: «?» — guía de uso a un toque (crítica VLM: nada
                    que adivinar). Siempre visible; etiqueta AYUDA solo en lg. */}
                <button
                  type="button"
                  onClick={abrirAyuda}
                  aria-label="Cómo funciona — abrir la guía de uso"
                  title="Cómo funciona (tecla ?)"
                  className="ml-0.5 p-1 lg:p-1.5 rounded-full text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition flex items-center justify-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className="font-mono font-extrabold text-[13px] leading-none"
                  >
                    ?
                  </span>
                  <span className="hidden lg:inline text-[10px] font-bold tracking-wide">
                    AYUDA
                  </span>
                </button>
              </div>

              {/* Selector de modo rápido segmented */}
              <div className="pointer-events-auto flex items-center p-0.5 lg:p-1 bg-[#10161f]/90 border border-slate-800 rounded-full backdrop-blur-md shadow-md">
                <button
                  type="button"
                  onClick={() => {
                    setFuente("CAMARA");
                    setModoMenuAbierto(false);
                  }}
                  className={`flex items-center gap-1 px-2.5 lg:px-3.5 py-1 lg:py-1.5 rounded-full text-[11px] lg:text-xs font-semibold transition-all ${
                    fuente === "CAMARA"
                      ? "bg-[#10b981] text-[#090d12] font-bold shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <CameraNavIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">CÁMARA</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFuente("SIMULACION");
                    setModoMenuAbierto(false);
                  }}
                  className={`flex items-center gap-1 px-2.5 lg:px-3.5 py-1 lg:py-1.5 rounded-full text-[11px] lg:text-xs font-semibold transition-all ${
                    fuente === "SIMULACION"
                      ? "bg-[#10b981] text-[#090d12] font-bold shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">SIM</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current?.click();
                    setModoMenuAbierto(false);
                  }}
                  className={`flex items-center gap-1 px-2.5 lg:px-3.5 py-1 lg:py-1.5 rounded-full text-[11px] lg:text-xs font-semibold transition-all ${
                    fuente === "ARCHIVO"
                      ? "bg-[#10b981] text-[#090d12] font-bold shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FolderImportIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">SUBIR</span>
                </button>
              </div>
            </div>
          </div>

          {modoCamara ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                disablePictureInPicture
                onLoadedMetadata={alCargarMetaVideo}
                aria-label="Vista previa de la cámara"
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Estado: iniciando cámara */}
              {camEstado === "iniciando" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60">
                  <span className="h-6 w-6 rounded-full border-2 border-brand-green/30 border-t-brand-green animate-spin" aria-hidden />
                  <span className="text-[10px] font-bold tracking-[0.2em] text-white/60 uppercase">
                    INICIANDO CÁMARA…
                  </span>
                </div>
              )}

              {/* Aviso de cámara con opciones claras y botón destacado para simulación.
                  Task 2-b (crítica VLM #1): copy humano y accionable — título en
                  primera persona + pasos numerados; en sm+ se centra como
                  tarjeta y en lg gana ancho/aire (no pegado al borde). */}
              {avisoCamara && camEstado !== "viva" && (
                <div className="absolute inset-x-4 top-[72px] z-40 rounded-2xl border border-amber-500/40 bg-[#10161f]/95 backdrop-blur-xl p-5 sm:mx-auto sm:max-w-md lg:top-20 lg:max-w-lg shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wider">
                      {avisoCamara === "denied" ? "No podemos acceder a tu cámara" : "Se perdió la señal de la cámara"}
                    </p>
                  </div>
                  {avisoCamara === "denied" ? (
                    <ol className="list-decimal pl-4 text-xs leading-relaxed text-slate-300 font-sans marker:text-amber-400/80 marker:font-mono">
                      <li>
                        Revisa el permiso de la cámara en el navegador (icono de
                        candado o de cámara junto a la barra de direcciones) y
                        permite el acceso.
                      </li>
                      <li>O activa la simulación para probar el flujo completo sin cámara.</li>
                      <li>O sube una foto del acta desde tu galería o tu disco.</li>
                    </ol>
                  ) : (
                    <p className="text-xs leading-relaxed text-slate-300 font-sans">
                      La cámara se detuvo u otra aplicación se quedó con ella.
                      Ciérrala y presiona «Reintentar», o sube una foto del acta.
                    </p>
                  )}
                  <div className="mt-4 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAvisoCamara(null);
                        setFuente("SIMULACION");
                      }}
                      className="h-10 rounded-xl px-4 text-xs font-bold text-[#090d12] bg-[#10b981] hover:bg-[#059669] transition shadow-md shadow-[#10b981]/20 flex items-center justify-center gap-1.5"
                    >
                      <SparklesIcon className="w-4 h-4" />
                      PROBAR CON SIMULACIÓN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvisoCamara(null);
                        setCamEstado("iniciando");
                        setReintentoCamara((n) => n + 1);
                      }}
                      className="h-10 rounded-xl px-3 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition flex items-center justify-center"
                    >
                      Reintentar cámara
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAvisoCamara(null);
                        inputRef.current?.click();
                      }}
                      className="h-10 rounded-xl px-3 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition flex items-center justify-center gap-1"
                    >
                      <FolderImportIcon className="w-3.5 h-3.5" />
                      Subir foto del acta
                    </button>
                  </div>
                </div>
              )}

              {/* Quad en vivo (lab L1693-1711) — SVG sobre el video,
                  brand-green, transición CSS ~150 ms. */}
              {camaraViva && puntosQuad && (
                <div
                  className="absolute inset-0 pointer-events-none z-20 transition-opacity duration-150"
                  aria-hidden
                >
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d={`M 0 0 L 100 0 L 100 100 L 0 100 Z M ${puntosQuad} Z`}
                      fill="rgba(0,0,0,0.32)"
                      fillRule="evenodd"
                    />
                    <path
                      d={`M ${puntosQuad} Z`}
                      fill="none"
                      stroke="var(--color-brand-green)"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {live.corners?.map((p, i) => {
                    const m = mapearPunto(p);
                    return (
                      <span
                        key={i}
                        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,230,118,0.9),0_1px_4px_rgba(0,0,0,0.5)]"
                        style={{ left: `${m.x}%`, top: `${m.y}%` }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Pill "BUSCANDO ACTA…" (lab L1737-1753): superior centrada
                  mientras corners === null. */}
              {buscando && !procesando && (
                <div className="pointer-events-none absolute inset-x-0 top-[72px] z-30 flex justify-center px-6">
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 backdrop-blur-sm">
                    <span
                      className="h-3.5 w-3.5 rounded-full border-2 border-brand-green border-t-transparent animate-spin"
                      aria-hidden
                    />
                    <p className="text-[11px] font-bold tracking-[0.08em] text-white/85">
                      BUSCANDO ACTA…
                    </p>
                  </div>
                </div>
              )}

              {/* HUD (§7 rev.3): medidor de captura EN VIVO (G7 del kit
                  camara-visor-v1) + estado de detección. */}
              {camaraViva && !procesando && (
                <>
                  {scorePct !== null && (
                    <div
                      className="pointer-events-none absolute bottom-3 left-3 z-20"
                      role="status"
                      aria-label={`Calidad de encuadre ${scorePct} por ciento`}
                    >
                      <div className="flex h-8 items-center gap-2.5 rounded-full bg-black/55 px-3 shadow-[0_4px_14px_rgba(0,0,0,0.35)] backdrop-blur-md">
                        <GaugeIcon
                          className={`h-3.5 w-3.5 ${
                            scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/80"
                          }`}
                        />
                        <div className="h-1 w-14 overflow-hidden rounded-full bg-white/20">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ease-out ${
                              scorePct > SHUTTER_SCORE * 100
                                ? "bg-gradient-to-r from-[#30d158] to-[#34c759]"
                                : scorePct > 55
                                  ? "bg-gradient-to-r from-[#007aff] to-[#4da2ff]"
                                  : "bg-white/50"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(4, scorePct))}%` }}
                          />
                        </div>
                        <span
                          className={`min-w-7 text-right text-[11px] font-semibold tabular-nums ${
                            scorePct > SHUTTER_SCORE * 100 ? "text-[#34c759]" : "text-white/85"
                          }`}
                        >
                          {scorePct}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-full border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur-sm">
                    <span
                      className={`text-[10px] font-bold tracking-[0.12em] font-mono ${
                        live.corners ? "text-brand-green" : "text-white/60"
                      }`}
                    >
                      {live.corners ? "ACTA DETECTADA" : "NO DETECTADA"}
                    </span>
                  </div>
                </>
              )}

              {/* Overlay "armado" */}
              {camaraViva && autoArmado && scoreAlto && !procesando && (
                <div className="pointer-events-none absolute inset-x-0 top-[42%] z-30 flex justify-center px-6">
                  <div className="flex items-center gap-2.5 rounded-full bg-black/75 border border-white/10 px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.3)] backdrop-blur-sm">
                    <span className="h-2 w-2 rounded-full bg-brand-green" aria-hidden />
                    <p className="text-[13px] font-bold text-white">
                      MANTÉN INMÓVIL EL ACTA…
                    </p>
                  </div>
                </div>
              )}

              {/* Procesando captura */}
              {procesando && (
                <div
                  className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-[3px]"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="h-10 w-10 rounded-full border-[3px] border-white/15 border-t-brand-green animate-spin"
                    aria-hidden
                  />
                  <p className="text-[13px] font-bold text-white">CAPTURANDO…</p>
                  <p className="text-[10px] font-bold tracking-[0.2em] text-white/55 uppercase font-mono">
                    CAPTURA RECIBIDA · PASANDO A ANÁLISIS
                  </p>
                </div>
              )}

              {/* Destello blanco de captura */}
              {destelloKey > 0 && (
                <div
                  key={destelloKey}
                  className="animate-capture-flash pointer-events-none absolute inset-0 z-50 bg-white"
                  aria-hidden
                />
              )}
            </>
          ) : (
            /* SIMULACIÓN/ARCHIVO: Visor con marco táctico E-14. Task 2-b: en
               lg+ el marco gana tamaño (max-w/max-h mayores) — los brackets
               tácticos son spans posicionados al contenedor y escalan solos. */
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center select-none">
              <div className="relative w-full max-w-[280px] sm:max-w-[320px] lg:max-w-[360px] h-[64vh] max-h-[440px] lg:max-h-[540px] rounded-2xl border-2 border-dashed border-[#10b981]/30 bg-[#10b981]/[0.03] flex flex-col items-center justify-between p-5 backdrop-blur-[2px] shadow-[0_0_40px_rgba(16,185,129,0.05)]">
                {/* Esquinas tácticas */}
                <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#10b981]" />
                <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#10b981]" />
                <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#10b981]" />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#10b981]" />

                <div className="w-full flex items-center justify-between text-[10px] font-mono font-bold tracking-widest text-[#10b981] uppercase">
                  <span>FORMATO E-14</span>
                  <span>{fuente}</span>
                </div>

                <div className="flex flex-col items-center gap-2.5 my-auto px-2">
                  <div className="w-14 h-14 rounded-2xl bg-[#10161f] border border-slate-800 flex items-center justify-center text-[#10b981] shadow-lg">
                    {fuente === "SIMULACION" ? (
                      <SparklesIcon className="w-7 h-7" />
                    ) : (
                      <FolderImportIcon className="w-7 h-7" />
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-white tracking-wide uppercase">
                    {fuente === "SIMULACION" ? "SIMULADOR ELECTORAL" : "IMPORTAR ARCHIVO"}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 leading-relaxed max-w-[220px] lg:max-w-[280px]">
                    {fuente === "SIMULACION"
                      ? "Presione el obturador abajo o elija un nivel de score (Óptima, Medio, Baja) para probar la validación."
                      : "Seleccione un archivo de imagen o fotografía de acta electoral E-14."}
                  </p>
                  {fuente === "ARCHIVO" && (
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="mt-2 px-4 py-2 rounded-xl bg-[#10b981] hover:bg-[#059669] text-[#090d12] text-xs font-bold uppercase tracking-wider transition shadow-md shadow-[#10b981]/20 cursor-pointer"
                    >
                      Elegir imagen
                    </button>
                  )}
                </div>

                <div className="w-full py-1 border-t border-slate-800/80 flex items-center justify-center">
                  <span className="text-[9px] font-mono text-slate-500 tracking-wider uppercase">
                    DIGITALIZADOR OFICIAL E-14
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* §3.1.4 FRANJA DE AVISOS del visor. Task 2-b: en lg se aleja del
              borde y baja un poco (el HUD es más alto en lg). */}
          {avisoVisor && !procesando && (
            <div
              className={`absolute inset-x-4 top-[72px] z-40 rounded-xl bg-[#10161f]/95 border px-3.5 py-2.5 font-mono text-xs shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md lg:inset-x-6 lg:top-20 ${
                avisoVisor.tono === "crit"
                  ? "border-red-500/40 text-red-400"
                  : "border-amber-500/40 text-amber-400"
              }`}
              role="status"
              aria-live="polite"
            >
              {avisoVisor.texto}
            </div>
          )}
        </div>
      </div>

      {/* Dock inferior con botones de simulación y obturador */}
      <footer className="relative z-20 bg-[#090d12]/92 border-t border-slate-800/80 backdrop-blur-2xl px-4 lg:px-6 pt-3 lg:pt-4 pb-4 flex flex-col items-center shrink-0">
        {/* Fila de contexto — Task 2-b: lg:max-w-md (acompaña la botonera). */}
        <div className="w-full max-w-sm lg:max-w-md mx-auto mb-1.5 px-1 flex items-center justify-between text-[10px] font-mono font-medium tracking-widest uppercase text-slate-400 select-none">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" aria-hidden />
            {labelModo}
          </span>
          <span className="text-[9px] text-slate-500">TEST SCORES</span>
        </div>

        {/* Barra de SIMULACIÓN — Task 2-b: lg:max-w-md + chips con más aire en
            lg. Mismos ids/aria/handlers (los tests E2E dependen de ellos). */}
        <div
          className="w-full max-w-sm lg:max-w-md mx-auto mb-3 px-1 flex items-center justify-between gap-2 bg-[#10161f]/90 border border-slate-800 rounded-xl p-1.5 lg:p-2 backdrop-blur-md shadow-md z-30"
          data-purpose="score-simulation-bar"
        >
          {NIVELES_CALIDAD.map(({ id, label, score, chip, dot, aria }) => (
            <button
              key={id}
              type="button"
              aria-label={aria}
              title={`Simular score ${label.toLowerCase()}`}
              disabled={procesando}
              onClick={() => simularScore(id)}
              className={`flex-1 min-h-11 flex items-center justify-center gap-1.5 lg:gap-2 py-1.5 lg:py-2 px-2 lg:px-3 rounded-lg border transition-all cursor-pointer active:scale-95 disabled:cursor-default disabled:opacity-50 ${chip}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
              <span className="text-[10px] lg:text-[11px] font-bold tracking-wider uppercase font-mono">
                {label}
              </span>
              <span className="text-[9px] lg:text-[10px] opacity-80 font-mono">({score})</span>
            </button>
          ))}
        </div>

        {/* §6/Rev.4 Fila de disparo: [Importar | obturador | Flash] —
            EXACTAMENTE la fila de Rev. 4 (Auto fuera; la linterna real, el
            disparo por plataforma y la vía IMPORTAR intactos). */}
        {modoCamara ? (
          <div className="w-full flex items-center justify-between max-w-sm lg:max-w-md px-2 mb-1" data-purpose="shutter-action-dock">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label="Importar imagen"
              className="group flex flex-col items-center justify-center gap-1 text-center w-16 active:opacity-70 transition-all focus:outline-none"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 group-hover:text-brand-green transition-colors">
                <StitchImportIcon className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-medium text-white/80 tracking-tight">
                Importar
              </span>
            </button>

            {obturador}

            {/* FLASH — F-FLASH v3: SIEMPRE activo con cámara (la verdad se
                descubre al pulsar); sin stream → franja con el motivo. */}
            <button
              type="button"
              aria-pressed={torchOn}
              aria-label={
                torchOn
                  ? "Apagar la linterna"
                  : torchDisponible
                    ? "Encender la linterna"
                    : "Linterna — toca para ver el motivo"
              }
              onClick={() => void alternarLinterna()}
              className="group flex flex-col items-center justify-center gap-1 text-center w-16 active:opacity-70 transition-all focus:outline-none"
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  torchOn ? "text-yellow-400" : "text-white/90 group-hover:text-brand-green"
                }`}
              >
                <StitchBoltIcon className="w-6 h-6" />
              </div>
              <span
                className={`text-[11px] font-medium tracking-tight ${
                  torchOn ? "text-yellow-400" : "text-white/80"
                }`}
              >
                Flash
              </span>
            </button>
          </div>
        ) : (
          <div className="w-full flex items-center justify-between max-w-sm lg:max-w-md px-2 mb-1" data-purpose="shutter-action-dock">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label="Importar imagen"
              className="group flex flex-col items-center justify-center gap-1 text-center w-16 active:opacity-70 transition-all focus:outline-none"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 group-hover:text-brand-green transition-colors">
                <StitchImportIcon className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-medium text-white/80 tracking-tight">
                Importar
              </span>
            </button>

            {obturador}

            {/* §D: Flash con feedback honesto — la linterna REAL vive en el
                modo CÁMARA; aquí el tap muestra la franja del visor. */}
            <button
              type="button"
              aria-label="Flash (disponible en modo cámara)"
              onClick={() =>
                mostrarAviso(
                  "LINTERNA EN CÁMARA — la linterna se controla con la cámara viva. Cambia de modo con el botón amarillo.",
                  "warn",
                  4500,
                )
              }
              className="group flex flex-col items-center justify-center gap-1 text-center w-16 active:opacity-70 transition-all focus:outline-none"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 group-hover:text-brand-green transition-colors">
                <StitchBoltIcon className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-medium text-white/80 tracking-tight">
                Flash
              </span>
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
