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
import { useMasivaStore } from "./store";
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

/** Throttle del progreso (250 ms — kit D65 T3.1 literal): el OCR emite decenas
 *  de eventos por etapa; la bandeja solo necesita el último. */
const PROGRESO_MS = 250;

let corriendoFlag = false;
let stopFlag = false;
let ultimoProgresoEn = 0;

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

/** D65 (T3.1) — emisión de vida vía el action NUEVO del store (throttle). */
function marcarVida(id: string, p: ProgresoAnalisis): void {
  const ahora = Date.now();
  if (ahora - ultimoProgresoEn < PROGRESO_MS) return;
  ultimoProgresoEn = ahora;
  useMasivaStore.getState().marcarProgreso(id, bucketDeVida(p));
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
  // primero; el bridge emite la suya apenas arranca).
  useMasivaStore.getState().marcarProgreso(fila.id, { etapa: "preparando" });
  let registro: RegistroMasiva | null = null;
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

    for (let intento = 1; intento <= WATCHDOG_INTENTOS; intento += 1) {
      const tIntento = Date.now();
      senal = null; // la etapa al morir es la del INTENTO que muere
      useMasivaStore.getState().marcarProgreso(fila.id, { etapa: "preparando" });
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
    let actaDesenlace = acta;
    let relecturaDesenlace: "auto" | "sin-cambio" | null = null;
    if (procedeRelecturaInterna(acta)) {
      const tRelectura = performance.now();
      try {
        const textoRe = await getBridge().reconocerTexto(acta);
        const clasifRe = clasificarCabecera(textoRe, await cargarDivipol());
        const aplicado = desenlaceTrasRelectura(acta, textoRe, clasifRe);
        actaDesenlace = aplicado.acta;
        relecturaDesenlace = aplicado.desenlace;
      } catch {
        relecturaDesenlace = "sin-cambio";
      }
      console.info(
        `[e14] relectura-interna fila=${fila.id} ms=${Math.round(performance.now() - tRelectura)} RelecturaInterna=${relecturaDesenlace}`,
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
