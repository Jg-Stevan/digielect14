/**
 * Contratos del módulo obs (KIT e14-observabilidad-v1).
 *
 * La BASE del evento (TipoEvento … ErroresAgrupados) vive en el paquete y se
 * re-exporta — una sola definición para las dos apps (FASE D3). Aquí solo los
 * tipos de PRODUCTO que divergen por diseño.
 */
import type { AgregadoLectura } from "@jg-stevan/scanner-core/obs-base/eventos-lectura";
import type {
  ErroresAgrupados,
  PoliticaDatos,
  SaludSnapshot,
  UsoContador,
} from "@jg-stevan/scanner-core/obs-base/tipos";

export type {
  Breadcrumb,
  ErrorEvento,
  ErroresAgrupados,
  EventoObs,
  HangEvento,
  PerfActa,
  PoliticaDatos,
  SaludSnapshot,
  Tier,
  TipoEvento,
  UsoContador,
} from "@jg-stevan/scanner-core/obs-base/tipos";

export interface FlagsApp {
  ocrThreadsTope: number; // default 4
  telemetriaSalud: boolean; // default true
  endpointReportes: string | null; // default null — sin backend, D1
  // ─── KIT e14-obs-hang-atribucion-v1 (§D) — campo ADITIVO AL FINAL (D57) ───
  hangEnCurso: boolean; // default true — sensor hang-en-curso (worker heartbeat + WAL); false = byte-idéntico a b688fbc
  // ─── KIT e14-orientacion-qr-v1 (§D) — campo ADITIVO AL FINAL (D57) ───
  qrBrujulaOrientacion: boolean; // default true — QR-brújula de orientación (cuadrante del QR manda + rescate hi-res ZXing; bench v8.3 4/4); false = sondeo OCR de siempre byte a byte
  // ─── KIT e14-ocr-cascada-v1 (K3 fase 2) — campo ADITIVO AL FINAL (D57) ───
  // Renombrado de `masivaOcrTesseract` al retirar el módulo masiva (la
  // cascada es del pipeline general; el nombre era herencia del kit).
  ocrCascada: boolean; // default true (GO-B del dueño) — cascada OCR: intento 1 TESSERACT BEST (ocr/tesseract.ts) → gate → core RapidOCR escalonado como hoy → rescate ROI top/bottom; false = OCR escalonado de siempre byte a byte
  // NOTA (eliminación del módulo masiva): los 17 flags exclusivos de la cola
  // (poolWorkers · thumbsOn · colaPersistente · sondeoQr* · prescan* ·
  // masiva* · dhashResize) se retiraron con el módulo.
  // ─── KIT e14-adaptacion-dispositivo-v1 — campo ADITIVO AL FINAL (D57) ───
  // Adaptación automática al dispositivo (petición del dueño): el tier
  // detectado consume knobs de RECURSOS (hilos OCR — plan.ts). El override
  // MANUAL del dueño manda clave a clave (D6); false = byte-idéntico a hoy.
  adaptacionDispositivo: boolean; // default true
  // ─── KIT e14-ocr-tessbest-v1 (GO-B del dueño) — campo ADITIVO AL FINAL
  // ─── (D57): presupuesto del ESCANEO individual. null = plan por tier
  // ─── (BAJO 480 s · MEDIO 240 s · ALTO 120 s — lección del masiva D48 y
  // ─── la evidencia sim-gama-baja); número = override MANUAL del dueño.
  presupuestoEscaneoMs: number | null; // default null
  // ─── KIT e14-capa0-qr-worker-v1 — campo ADITIVO AL FINAL (D57): la capa 0
  // ─── QR de la cámara corre su cadena jsQR en WORKER (presupuesto real +
  // ─── fases/fin telemetría; port D40+R1.1+R1.4-b de supervision-e14).
  // ─── false = camino de HOY byte-idéntico (main thread, tiers "base").
  capa0QrWorker: boolean; // default true
  // ─── KIT e14-probe-mini768-v1 (port de supervision-e14) — campo ADITIVO AL
  // ─── FINAL (D57): lado mayor de la MINIATURA del sondeo de orientación.
  // ─── A 320 la miniatura «sub-leía» y el fallo seguro casi siempre devolvía
  // ─── al sondeo completo; el det del probe ya va capped a DET_CAP_RAPIDO=1280
  // ─── y el rec a REC_WMAX=480, así que un lienzo de 1280 entrega casi los
  // ─── mismos píxeles por línea que el original y la mini decide en el lienzo
  // ─── barato. Los umbrales del FALLO SEGURO NO cambian. 320 = HOY byte-idéntico.
  probeMiniLado: number; // default 1280 · clamp [320, 1280]

  // ─── KIT e14-heic-tope-v1 — el rescate HEIC (F-HEIC del core) se despacha
  // ─── TOPADO. `heicTopeMp`: megapíxeles máximos del HEIC que se intenta
  // ─── decodificar (se leen del contenedor, sin decodificar). 0 = sin tope =
  // ─── camino anterior. `heicLimiteMs`: plazo de la conversión; tiene que
  // ─── quedar POR DEBAJO del watchdog del puente (120_000) para que el acta
  // ─── muerta se vea como un HEIC rechazado, no como un misterio. 0 = sin plazo.
  heicTopeMp: number; // default 24 · clamp [0, 60]
  heicLimiteMs: number; // default 45000 · clamp [0, 110000]
  // ─── KIT e14-autoenvio-recorte-v1 — tras un RECORTE manual que pasa a
  // ─── OPTIMA: ¿se envía automáticamente (como captura normal) o se queda en
  // ─── REVISIÓN esperando envío manual? Default true (comportamiento actual
  // ─── G4 del gate v2); false = el recorte NUNCA auto-envía (dueño decide).
  autoEnvioConRecorte: boolean; // default true
  // ─── KIT e14-velocidad-5s-v1 — campos ADITIVOS AL FINAL (D57) ───────────
  // Tope del lado mayor de la foto que ENTRA al trabajo (importación + warp +
  // realce). El sensor saca 4032 y el pipeline pagaba decode/warp/OCR a ese
  // tamaño; el det del OCR ya se capa a 1280 y el rec a 480 de ancho, así que
  // 4032 solo inflaba el warp y el decode. 4032 = HOY byte-idéntico.
  ladoMaxTrabajoPx: number; // default 2560 · clamp [1024, 4032]
  // Piso escénico de ANALIZANDO (D16): mínimo en pantalla antes de cerrar al
  // 100 %. Con pipeline a 5 s el piso de 1200 ms era el 25 % del tiempo total
  // del puesto. 1200 = HOY byte-idéntico.
  pisoEscenicoMs: number; // default 300 · clamp [0, 1200]
  // Primer intento de la cascada OCR (D88, 2026-11-10): false = Tesseract
  // fast primero y PP-OCRv4 (RapidOCR 1280) de respaldo; true = kill-switch al
  // orden anterior (RapidOCR 1280 primero y Tesseract solo como rescate).
  ocrPrimeraPasadaRapida: boolean; // default false
  // Ruta corta del IMPORTAR: dims leídas del contenedor JPEG (sin decodificar)
  // y el File pasa intacto si ya está dentro del tope. false = camino robusto
  // de siempre (data URL + decode + canvas + FileReader en el hilo principal).
  importRutaCorta: boolean; // default true
  // ─── KIT e14-velocidad-5s-v1 (fase rec) — knobs del TENSOR de reconocimiento.
  // El A56 con el rec corriendo está a 7,7 de 8 núcleos (medido con /proc/stat
  // durante la corrida) ⇒ NO hay holgura para más workers ni más hilos: la única
  // palanca que corre es HACER MENOS CÁLCULO. El costo del rec es ~ n × h × W
  // (más el copiazo del salida [n,T,6625], con T ∝ W), así que W y h son las
  // dos perillas. 480 sigue en su valor de siempre; 40 es la altura validada
  // con serie A/B/A el 2026-11-05 (32 pierde «SUMA TOTAL» → techo `recortada`).
  ocrRecWmax: number; // default 480 · clamp [160, 960]
  ocrRecAltura: number; // default 40 · clamp [24, 64] (el ONNX acepta H dinámica)
  // Líneas por corrida del rec: los lotes corren al ancho de su línea más
  // ancha, así que lotes chicos desperdician menos pad de ceros (y más runs).
  ocrRecLote: number; // default 6 · clamp [1, 12]
  // El OCR lee la procesada bw (un solo warp) en vez de la variante sin realce
  // (dos warps). false = HOY byte-idéntico (dos processImage bajo la misma rampa).
  ocrLeerBw: boolean; // default false
  // Remuestreo del recorte → tensor: false = nearest (el de siempre, byte
  // idéntico) · true = filtro de área del canvas (`imageSmoothingQuality
  // "high"`). Con `ocrRecAltura` POR DEBAJO de la altura natural del recorte
  // el nearest tira filas de píxeles reales y la red ve trazos partidos; el
  // suave deja bajar la altura conservando la línea entera.
  ocrRecSuave: boolean; // default false
  // Forma del tensor del rec: false = el ancho de cada lote (HOY) · true =
  // TODOS los lotes al cap (`ocrRecWmax`). Cada `run()` del ORT-wasm paga
  // ~130 ms FIJOS y re-optimiza el grafo cuando cambia la forma de entrada;
  // fijarla cambia ese fijo por el pad de ceros (que cuesta ~2 %).
  ocrRecWfija: boolean; // default false
  // Líneas que se LEEN (no que se recortan): las N de ARRIBA y las M de ABAJO,
  // en el orden vertical del det. 0/0 = leer TODAS (el comportamiento original).
  // El medio de un E-14 es la tabla de candidatos/votos y ningún consumidor del
  // texto (cabecera, banda, sección inferior, señal de contenido, anclas) lo
  // decide. 14/14 es la calibración del 2026-11-05 con el rescate encendido.
  ocrRecCabecera: number; // default 14 · clamp [0, 60]
  ocrRecPie: number; // default 14 · clamp [0, 60]
  // RED DE SEGURIDAD del recorte por bordes: si leyendo solo las líneas de arriba
  // y abajo salen MENOS de N anclas estructurales (`ANCLAS_LECTURA`, máx 10), se
  // leen AHÍ MISMO las que se dejaron sin leer. 0 = sin rescate (apuesta pura).
  ocrRecBordesRescate: number; // default 7 · clamp [0, 10]
  // Lado de trabajo de la foto que LEE el OCR (distinto del de la que se
  // muestra/guarda, `ladoMaxTrabajoPx`). 0 = el mismo de siempre. Piso práctico
  // 1920: la 2.ª pasada del escalonado y el rescate ROI re-leen esta imagen a
  // cap 1920 — más chica y la escalada (la que salva las fotos duras) se queda
  // sin pixeles.
  ladoOcrPx: number; // default 0 · clamp [0, 4032]
  // Cierre de la pantalla ANALIZANDO: false = el teatro de siempre (el progreso
  // hace tween al 100 y `Math.min(350, pisoEscenicoMs)` extra antes de navegar)
  // · true = en cuanto el pipeline resolvió (y se cumplió el piso) se navega
  // YA. Son ~600 ms de animación sobre el reloj del dueño.
  cierreInstantaneo: boolean; // default false
  // Pases de jsQR sobre el warp COMPLETO antes de tirar el rescate HR de la
  // brújula. Bench v8.3: el warp acertó 0/4 (el QR queda ~110 px) y el rescate
  // HR 4/4 — cada pase son ~80-120 ms de CPU ya saturada. 0 = directo al HR
  // (el default desde la serie A/B/A del 2026-11-05 en el A56: −145 a −445 ms de
  // brújula en 6/6 sin mover score ni lectura) · 3 = el seguro anterior.
  qrBrujulaWarpPases: number; // default 0 · clamp [0, 3]
  // Escalada del OCR (la cola de las fotos duras): forzar el 2.º intento en
  // modo ROI-CABECERA (franja 0-25 % a cap 1920, ~2,5× más barato que el re-OCR
  // 1920 completo) aunque el plan del hardware diga "completo". false = HOY.
  ocrReOcrRoi: boolean; // default false
  // Tope PARED (ms de reloj del pipeline) para PERMITIR el 2.º intento. 0 = el
  // del plan por tier (MEDIO/ALTO = sin tope, manda el presupuesto del
  // escaneo). En el A56 la 1.ª pasada con rescate ya tarda ~4,8 s: con 3 000 el
  // re-OCR y el ROI simplemente no abren.
  ocrSegundaTopeMs: number; // default 0 · clamp [0, 120000]
  // KIT e14-remediacion-movil-v1 (A1) — campo ADITIVO AL FINAL (D57): ventana
  // de ARRANQUE de la 2.ª pasada como override MANUAL del dueño (doble
  // whitelist flags.ts + obs/politica.ts). null = plan por tier (BAJO 15 s ·
  // MEDIO/ALTO 45 s — postura 2 de A1, rescate ROI conservado); número =
  // override clampado. La garantía de duración vive en la fórmula k·ms1 del
  // bridge (k 2.5 completo / 1.2 ROI, margen 8 s) — este flag solo mueve la
  // ventana. Prioridad: este override > plan por tier > presupuesto del
  // escaneo.
  ocrSegundaPresupuestoMs: number | null; // default null · clamp [5000, 120000]
  // RECHAZO TEMPRANO: con el veredicto bloqueado ANTES del OCR (el guard de
  // completitud ya dijo `completa:false` y el veto solo puede empeorarlo), ¿se
  // cobra UNA sola pasada y se corta? true = sí · false = la escalada corre
  // siempre, como hoy.
  ocrCorteIncompleta: boolean; // default true
}

export interface ReporteSesion {
  meta: {
    appVersion: string;
    generado: string; // ISO
    deviceId: string;
    sesion: string;
    politica: PoliticaDatos;
    // ─── KIT e14-obs-hang-atribucion-v1 (§F) — AL FINAL (D57): el gate del
    // ─── sampler (dispositivo.ts condicionesOk) espejado — saludMuestras
    // ─── pasa de misterio a explicado DESDE el artefacto.
    modoDev: boolean;
    telemetriaSalud: boolean;
  };
  dispositivo: SaludSnapshot & { os: string; ua: string };
  erroresAgrupados: ErroresAgrupados[];
  perfResumen: {
    actas: number;
    p50OcrMs: number | null;
    p95OcrMs: number | null;
    fallosGate: number;
    memoriaPicoMB: number | null;
    /** §G.3 — ORDEN-WAVE3-add-envio-individual-v1 (aditivos AL FINAL —
     *  precedente hangResumen): telemetría del ENVÍO. envios = diagnósticos
     *  con envioMs presente (0 ms es válido hoy — registro local BASELINE;
     *  con §A/ledger D1 el mismo campo captura latencia de red real). */
    envios: number;
    p50EnvioMs: number | null;
    p95EnvioMs: number | null;
  };
  /** §G.3 — una fila por diagnóstico con envioMs != null (aditivo OPCIONAL
   *  al final — informes previos no cambian de forma). PRIVACIDAD dura
   *  (qa-obs-privacidad): actaIdHash = fnv1a8 del id (JAMÁS el id plano) ·
   *  SIN título/mesa/puesto/payload — solo números y la red del momento. */
  enviosDetalle?: EnvioDetalle[];
  saludMuestras: SaludSnapshot[];
  uso: UsoContador[];
  /** ANEXO Agente C (Pieza 2) — agregación de hangs de la sesión (ADITIVA,
   *  opcional: informes previos no cambian de forma). fuente: eventos "hang"
   *  del buffer filtrados por esta sesión — resumenHangsDe (hang.ts, PURO). */
  hangResumen?: {
    cuenta: number;
    mayorMs: number | null;
    totalMs: number | null;
    /** §G.4 — hangs OCULTOS (document.hidden — timers congelados por el SO:
     *  NO son congelones). cuenta/mayor/total quedan SOLO-VISIBLES desde
     *  wave3; los ocultos van aquí (aditivo AL FINAL — el patrón del
     *  informe 1230 — 117 s fantasma — queda imposible). */
    cuentaOcultas: number;
  };
  /** KIT e14-obs-hang-atribucion-v1 (§B) — distribución de los hangs por la
   *  última operación registrada (D58): una fila por `op` (null = legacy/sin
   *  marca), orden cuenta desc → op asc (JSON estable). Aditivo AL FINAL del
   *  reporte (informes previos no cambian de forma). Correlación, NO prueba
   *  de causalidad (§A — el sesgo viaja en opEdadMs). */
  hangPorOp?: HangPorOp[];
  /** FASE C3 (medición §6.7) — agregado de las lecturas retenidas en el
   *  buffer (actas con `PerfActa.lectura`): ms/acta aceptada por motor, el
   *  numerador/denominador del criterio de la decisión C4/C5. Aditivo
   *  OPCIONAL al final (D57): ausente = ninguna acta con lectura. */
  lecturaResumen?: AgregadoLectura;
}

/** KIT e14-obs-hang-atribucion-v1 (§B) — fila de hangPorOp (tipado del
 *  agregado PURO hangsPorOp de hang.ts). */
export interface HangPorOp {
  op: string | null;
  cuenta: number;
  totalMs: number;
  mayorMs: number;
}

/** §G.3 — fila de enviosDetalle (una por diagnóstico con envioMs != null).
 *  PRIVACIDAD: actaIdHash (fnv1a8 — JAMÁS el id plano), sin título/mesa/
 *  puesto/payload (qa-obs-privacidad manda). modo = canal del diagnóstico
 *  al export ("individual" = actaActual — una acta abierta desde REVISIÓN
 *  cuenta individual). "masiva" (cola) se retiró con el módulo. */
export interface EnvioDetalle {
  actaIdHash: string; // fnv1a8(actaId) — 8 hex (JAMÁS el id plano)
  modo: "individual";
  status: string; // ActaStatus del desenlace (string — informe JSON estable)
  ocrMs: number | null;
  totalMs: number | null;
  envioMs: number; // != null por construcción (solo filas con envío medido)
  envioRedTipo: string | null;
  envioDownlinkMbps: number | null;
}
