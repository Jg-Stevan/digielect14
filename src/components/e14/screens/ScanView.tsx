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
import { useCallback, useEffect, useRef, useState } from "react";
import { warmUpScannerWorker } from "@jg-stevan/scanner-core/detector-client";
import { SHUTTER_SCORE } from "@jg-stevan/scanner-core/quality";
// F-SENSOR-PROFILER (PASO 2): tipo del perfil del sensor — el ref es
// propietario de ScanView (lo llena useSesionCamara vía profileActiveSensor;
// lo lee useDestello vía archivoDentroDeTope).
import type { SensorProfile } from "@jg-stevan/scanner-core/sensor-profiler";
import { useE14Store, type BandaSim } from "@/lib/e14/store";
import { rapidOcrPrecalentar } from "@/lib/e14/ocr/rapidocr";
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
// SPRINT-B (B1, refactor/ui-hooks-v1): hooks dedicados extraídos de este
// archivo (MOVIMIENTO PURO — mismos cuerpos, mismos refs, mismo orden de
// efectos; los imports de lib quedan EXACTAMENTE iguales, solo consumidos).
import { liberarCanvas, useAnilloBestShot } from "../hooks/useAnilloBestShot";
import { useLinterna } from "../hooks/useLinterna";
import { NAVEGACION_TRAS_MS, useDestello } from "../hooks/useDestello";
import { useSelectorFuente } from "../hooks/useSelectorFuente";
import { esIOS, useSesionCamara, type CamEstado, type LiveUi } from "../hooks/useSesionCamara";

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

/** Cooldown anti doble-disparo (lab §5.2 — CAPTURE_COOLDOWN_MS del core). */
const COOLDOWN_MS = 1500;

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
  // SPRINT-B (B1): ScanView es el ORQUESTADOR — los refs/estates que
  // comparten varios dominios viven aquí y se INYECTAN a los hooks
  // dedicados (misma identidad, cero duplicación).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visorRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
  // Estado de la cámara — propietario: ScanView (lo escribe el arranque de
  // useSesionCamara; lo leen useLinterna, la captura, el disparo y el JSX).
  const [camEstado, setCamEstado] = useState<CamEstado>("iniciando");
  // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L433-L440
  /** F-SENSOR-PROFILER (PASO 2): perfil del sensor de FOTO del track vivo
   *  (resolución nativa vía getPhotoCapabilities + tope seguro 4032/3200 px
   *  según la gama medida). null = aún sin sondear. Lo LLENA
   *  useSesionCamara (profileActiveSensor) y lo LEE useDestello
   *  (archivoDentroDeTope) — identidad única compartida por inyección. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
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
  const [videoDims, setVideoDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  /** Ref fresca del captureSmart para los listeners del loop (lab L887-888).
   *  Se declara ANTES de los hooks (la consume useSesionCamara) y se asigna
   *  tras definir capturarInteligente — misma mecánica que el original
   *  (asignación por render, lectura por evento). */
  const capturarRef = useRef<() => Promise<void>>(async () => {});

  // Espejo del autoArmado para listeners del loop sin re-render (lab
  // L456-458). Los espejos de linterna (flashRef/torchOnRef) viven en
  // useLinterna — propietario de ese estado.
  autoRef.current = autoArmado;

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

  /* ── SPRINT-B (B1): hooks dedicados — MOVIMIENTO PURO ────────────────
   *  Orden de llamada = orden de registro de efectos, EXACTO al original:
   *  anillo (sin efectos) → linterna (sin efectos) → destello (sin
   *  efectos) → selector (sin efectos) → sesión de cámara (ARRANQUE →
   *  re-asignar → playing → loop). El §9 y el modoMenu de arriba conservan
   *  su posición original (antes del bloque de sesión); el ResizeObserver
   *  se declara tras capturarInteligente, como en el original (RO antes
   *  del loop). */

  // Anillo Best-Shot ZSL (lab L1512-1574): feed ~5 Hz + ganador pre-tap.
  const { alimentarAnillo, liberarAnillo, instantanea, tomarZsl } = useAnilloBestShot({ videoRef });
  // Linterna F-FLASH v3 (lab L473-520): preferencia + verdad al pulsar.
  const {
    flashRef,
    torchOnRef,
    torchOn,
    torchDisponible,
    aplicarLinternaGuardada,
    alternarLinterna,
    setTorchDisponible,
  } = useLinterna({ streamRef, camEstado, mostrarAviso });
  // Destello + flujo de captura al store (dispatch L574-589 + G3 upgrade).
  const {
    destelloKey,
    setDestelloKey,
    canvasABlob,
    archivoDentroDeTope,
    despacharArchivo,
    mejorarSilenciosa,
  } = useDestello({
    sensorProfileRef,
    procesandoRef,
    setProcesando,
    setArchivoPendiente,
    dispararEscaneo,
    mejorarFotoActa,
  });
  // Selector de fuente §E + handlers de archivo (IMPORTAR + iOS nativa).
  const {
    reintentoCamara,
    setReintentoCamara,
    alElegirArchivo,
    alElegirFotoCamara,
  } = useSelectorFuente({
    procesandoRef,
    mostrarAviso,
    archivoDentroDeTope,
    setArchivoPendiente,
    setFuente,
    dispararEscaneo,
    despacharArchivo,
  });
  // Sesión de cámara: arranque F-LENS v4 + cierre, re-asignar, playing y
  // frame loop real (deps [fuente, reintentoCamara] / [camaraViva] intactas).
  const {
    avisoCamara,
    setAvisoCamara,
    puedeTomarFotoRef,
    takePhotoBrokenRef,
    tomarFoto,
    loopRef,
    camaraViva,
  } = useSesionCamara({
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
  });

  const modoCamara = fuente === "CAMARA";
  const buscando = camaraViva && live.corners === null;
  const scoreAlto = (live.score ?? 0) > SHUTTER_SCORE;
  const scorePct = live.score !== null ? Math.round(live.score * 100) : null;

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
    // SPRINT-B (B1): refs/setters estables devueltos por hooks dedicados —
    // identidad invariable (Object.is igual en cada render), añadirlos a deps
    // NO cambia la frecuencia de re-creación del callback (idéntico original).
    loopRef,
    puedeTomarFotoRef,
    takePhotoBrokenRef,
    setDestelloKey,
  ]);

  /** Ref fresca del captureSmart para los listeners del loop (lab L887-888). */
  capturarRef.current = capturarInteligente;

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
  }, [fuente, camEstado, dispararEscaneo, capturarInteligente, puedeTomarFotoRef]);

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
