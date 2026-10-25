/**
 * KIT e14-informe-analisis-v1 (T1): INFORME de análisis de la cola MASIVA —
 * ZIP construido TODO en el navegador (sin red, §0.7) con las actas
 * problema: original.jpg + procesada.jpg byte-idénticas (sin re-encode) +
 * ficha.json completa (diagnóstico incluido, SIN fotos) + informe.json
 * global (SIN dataURLs — prohibido §6) + informe.txt legible.
 *
 * REINTRODUCCIÓN POR PEDIDO EXPLÍCITO del dueño (19/10: «informe
 * automáticamente… en un archivo comprimido para analizar las imágenes sin
 * modificar y modificadas»). §0.2: NADA se descarga solo — este módulo solo
 * CONSTRUYE el blob; la descarga vive detrás del botón «INFORME ↓» de
 * RESUMEN (T2). El retiro e14-fuera-informes-v1 sigue vigente para todo lo
 * demás (acumulador localStorage, auto-descarga al rechazar, COMPORTAMIENTO).
 *
 * Receta rescatada de d57e538 (diagnostico.ts, hoy borrado): fflate STORE
 * { level: 0 } (JPEG ya comprimido — NO re-comprimir) + dataUrlABytes (atob
 * → Uint8Array, byte-idéntico) + Blob + createObjectURL (hoy downloadBlob
 * del core 0.1.0 lo resuelve — ReviewView.tsx:31 ya lo usa).
 *
 * Fuente de datos: SOLO la cola masiva (IndexedDB e14-masiva-v1 vía
 * listarRegistros/leerRegistro — consumo tal cual, cola.ts INTOCABLE). El
 * flujo INDIVIDUAL no persiste actas (limitación documentada en el REPORTE).
 * Lectura SECUENCIAL: el mapa liviano sale de listarMapeados() (mapper en el
 * cursor — RAM acotada) y el contenido de carpetas se materializa con
 * leerRegistro() UNO A LA VEZ (nunca Promise.all — RAM acotada, T1.1).
 */
import { listarMapeados, leerRegistro } from "./masiva/cola";
import type { EstadoEntrada, RegistroMasiva } from "./masiva/tipos";
// WAVE2 C3 — ANEXO2 (tier): SOLO lectura del tier (D6: la app detecta y
// reporta — jamás cambia reglas). obtenerDispositivo NO muta estado (las
// firmas que mutan — muestreo/buffer — no se importan ni se llaman).
import { obtenerDispositivo } from "./obs/dispositivo";
import type { Tier } from "./obs/tipos";
// WAVE2 C2 — forma del diagnóstico que el kit A1 expone (orientacion.ts
// L119 del kit REPARTE-WAVE2): hoy AÚN no está en DiagnosticoActa
// (branches paralelas) — la intersección tipa el passthrough SIN as any;
// cuando A1 aterrice los campos son idénticos y el cast queda en no-op.
import type { DiagnosticoActa } from "./types";

// ---------- Tope de tamaño (T1.6) ----------
/** Tope de imágenes: si el estimado supera esto, solo las 50 actas-problema
 *  más recientes llevan imágenes (el informe.json SIEMPRE lista todo). */
const TOPE_IMAGENES_BYTES = 250 * 1024 * 1024;
const TOPE_ACTAS_CON_IMAGEN = 50;
/** Filas LISTA que SÍ llevan carpeta con imágenes (T1.3). Las ÓPTIMA/
 *  ENVIADA solo van en informe.json; ERROR con Blob lleva la suya. */
const ESTADOS_CARPETA: readonly string[] = [
  "RECHAZADA",
  "ADVERTENCIA",
  "EN_REVISION_HUMANA",
];

// ---------- Tipos públicos ----------

/** Entorno donde nació el informe (T1.2) — datos reales para calibrar. */
interface EntornoInforme {
  userAgent: string;
  idioma: string;
  nucleos: number | null;
  memoriaGB: number | null;
  crossOriginIsolated: boolean;
  url: string;
  // ---------- WAVE2 C3 — ANEXO2 (tier) — ADITIVOS AL FINAL (opcionales) ----------
  /** (C3) Tier del dispositivo (reglas §4.4 de obs/dispositivo.ts — D6:
   *  SOLO detectar y reportar). AUSENTE cuando el navegador no da datos
   *  (SSR, vitest, lectura fallida) — jamás inventar. */
  tier?: Tier;
  /** (C3) true = tier INFERIDO (sin deviceMemory — iOS: núcleos + heapLimit). */
  tierInferido?: boolean;
}

/** Fila liviana de la cola — base del informe.json (T1.2) y del filtro de
 *  carpetas (T1.3). CERO dataURLs: los fotos viven SOLO en las carpetas. */
export interface FilaInforme {
  id: string;
  nombre: string;
  agregadaEn: number;
  estado: EstadoEntrada;
  /** Motivo corto de las filas ERROR (null en las demás). */
  error: string | null;
  statusActa: string | null;
  score: number | null;
  rechazo: { tipo: string; detalle: string } | null;
  paginaIndex: number | null;
  clasificacionNivel: string | null;
  lecturaNivel: string | null;
  gateCompleta: boolean | null;
  quadOrigen: string | null;
  tiempos: {
    procesoMs: number;
    calidadMs: number;
    ocrMs: number;
    totalMs: number;
    /** D57 — KIT e14-instrumentos-espera-v1: espera en cola MASIVA (solo
     *  filas procesadas con el kit activo — ausente jamás se inventa). */
    esperaMs?: number;
    /** D61 — KIT e14-tiempos-ocultos-v1: decode del archivo (null/ausente en
     *  canvas-path y SIM — jamás se inventa). */
    decodeMs?: number | null;
    /** D61 — KIT e14-tiempos-ocultos-v1: detección de página del core. ídem. */
    detectMs?: number | null;
    /** D61 — KIT e14-tiempos-ocultos-v1: persistencia del desenlace en IDB
     *  (solo MASIVA — ausente jamás se inventa). */
    persistMs?: number;
    /** D61 — KIT e14-tiempos-ocultos-v1: envío online del desenlace (offline/
     *  EN COLA/no-OPTIMA → ausente — jamás se inventa). */
    envioMs?: number;
  } | null;
  /** D57 — KIT e14-instrumentos-espera-v1 (T2): ms del probe de orientación
   *  del diagnóstico (null cuando no corrió — SIM/registros previos). */
  orientacionProbeMs: number | null;
  /** D63-A — KIT e63a-origen-escaneo-v1 (T2/T3): origen del archivo según
   *  el detector heurístico (null = duda o registro previo a D63-A). */
  origen: string | null;
  /** D63-A — T2: señales auditables de la decisión (null = no evaluado). */
  origenSenales: string | null;
  /** D63-D — KIT e63d-informe-trazas-escaneo-v1 (T1): ángulo de skew medido
   *  por el pre-proceso de escaneos (D63-B, con signo, pasos de 0.1°).
   *  null = no medido (fotos, SIM, registros previos, banda sin tinta o
   *  ángulo fuera de ±10°) — jamás inventar. */
  skewGrados: number | null;
  /** D63-D — (T2) ms del deskew aplicado (D63-B); null = NO se rotó. Es la
   *  base del «deskew medio de escaneos corregidos» de la línea ESCANEOS. */
  deskewMs: number | null;
  /** D63-D — (T1) veredicto del marco impreso (D63-C): "completo" |
   *  "cortado" | "no-encontrado". null = no evaluado (fotos, SIM, registros
   *  previos a D63-C) — jamás inventar. KIT e63d (F3.2): nuevo valor
   *  "ceñido" (marco EN el filo — escáner atravesó el marco: nunca bloquea). */
  gateMarco: "completo" | "ceñido" | "cortado" | "no-encontrado" | null;
  // ─── D65 — KIT e14-progreso-watchdog-dedup-v1: trazas aditivas (T1.4/T2.3) ───
  /** (T1) intentos consumidos por el watchdog (0/1/2). null = registro
   *  pre-D65 o fila que no corrió pipeline (gemela copiada) — jamás inventar. */
  watchdog: number | null;
  /** (T1) etapa del pipeline al morir el ÚLTIMO intento vencido
   *  ("decodificando" | "deteccion" | "ocr" | "verificacion"). */
  etapaAlMorir: string | null;
  /** (T1) duración (ms) del intento que murió (hoy era null y escondía los
   *  ~175 s — kit §0). null = sin dato. */
  elapsedMs: number | null;
  /** (T2) traza del dedup v2 POR CONTENIDO: "v2" = gemela matcheada;
   *  "sin-match" = hasheada sin gemela. null = pre-D65 o hash falló.
   *  e63k — valores NUEVOS AL FINAL (contrato D57): "visual-aplazada" =
   *  banda 3..6 sin marca pre-OCR (la capa 2 decide); "identidad" = capa 2
   *  marcó DUPLICADA por serie impresa repetida. e63m: "qr" = CAPA 0
   *  (identidad-QR pre-OCR — payload EXACTO repetido, OCR jamás se paga). */
  dedup: "v2" | "sin-match" | "identidad" | "visual-aplazada" | "qr"
    | "ya-enviada" // e65-dedup-enviadas-v1 — valor NUEVO AL FINAL (contrato D57, export-only)
    // WAVE3 C.2 (obs-informe-wave3-v1) — puertas del veto AL FINAL (D57):
    // "ya-enviada-postocr" (H1 post-OCR) · "ya-enviada-copia" (traza visual
    // de cadenaDedup aterrizó sobre un registro YA-ENVIADA).
    | "ya-enviada-postocr"
    | "ya-enviada-copia"
    | "qr-sondeo" | null; // KIT e73-sondeo-qr-precoz-v1 (§B) — gemela por payload EXACTO leído en INGESTA (valor NUEVO AL FINAL — contrato D57)
  /** (T2) distancia de Hamming del match v2 (0–64); null = sin match. */
  dedupDistancia: number | null;
  // ---------- WAVE3 §B — ORDEN-WAVE3-remoto-rescate-obs-v1 (T rescate) ----------
  /** traza del RESCATE anti-falso-rechazo (§B): "lanzado" = reintento del
   *  paso desenlace corrió y también rechazó; "salvado" = el desenlace
   *  final ≠ RECHAZADA tras el reintento. null = sin rescate (pre-wave3 o
   *  fila sin pipeline — jamás inventar). Aditivo AL FINAL (D57). */
  rescateRechazo: "lanzado" | "salvado" | null;
  // ---------- KIT e73-sondeo-qr-precoz-v1 (§E) — campos ADITIVOS AL FINAL (contrato D57) ----------
  /** (§E) ms del sondeo QR en ingesta — PRESENTE solo si el sondeo CORRIÓ
   *  (con o sin lectura — "N leídos"); null = no corrió (flag OFF / sin
   *  soporte / hard-kill / registro previo al kit — jamás inventar). */
  sondeoQrMs: number | null;
  /** (§E) tier que leyó el payload — SOLO con lectura ("M con payload");
   *  null = sondeó sin leer. */
  sondeoQrTier: string | null;
  // ---------- D66 — KIT e14-decode-unico-precalor-v1 (T4) ----------
  /** D66 (T4): ms SOLO del decodificado a MASTER (0 = precalentada — el
   *  decode vivió en el precalor; null = sin master: fallback/ERROR/
   *  registros previos — jamás inventar). Top-level, SEPARADO de
   *  tiempos.decodeMs (D61 — decode del archivo por el bridge). */
  decodeMs: number | null;
  /** D66 (T4): quién fabricó el master — decode nativo o reserva wasm.
   *  null = sin master. */
  origenDecode: "nativo" | "wasm" | null;
  /** D66 (T4): el desenlace nació de un master PRECALENTADO (provenance —
   *  persiste en el registro, a diferencia del flag transitorio de fila). */
  precalentada: boolean;
  /** D66 (T4): ms totales del precalor para esta fila (solo precalentadas;
   *  null = no precalentada). */
  precalorMs: number | null;
  // ---------- D63-A2 — KIT e14-d63a2-deskew-pipeline-v1 (T2) ----------
  /** ¿El pre-proceso (deskew D63-B) aplicó sobre esta fila? SOLO escaneos
   *  (presente si origen "escaneo"; ausente para fotos/WhatsApp/SIM/
   *  registros previos — jamás inventar). Fuente: diagnostico.maestroFuente
   *  (T0 — "corregido" | "original"). */
  preprocesoAplicado?: boolean;
  /** ¿El acta trae diagnóstico completo? (base de detección/tiempos). */
  tieneDiagnostico: boolean;
  /** ¿Esta fila lleva carpeta en actas/ (T1.3)? */
  conCarpeta: boolean;
  /** Peso estimado de imágenes de su carpeta (dataURL×3/4 o Blob.size). */
  pesoImagenes: number;
  /** Extensión real para original.<ext> de filas ERROR con Blob (T1.3). */
  extArchivo: string;
  // ---------- e63f — KIT e63f-autoenvio-v1 (F0) ----------
  /** Balde fino del no-AUTO del clasificador (F0): "puesto-lugar" | "tipo" |
   *  "mesa-registro" | "ruta". null = AUTO o sin motivo de los listados —
   *  jamás inventar (fuente: clasificacion.clasifDebil; clasificaciones
   *  pre-e63f no traen el campo → null). */
  clasifDebil: string | null;
  // ---------- e63k — KIT e63k-capa2-identidad-v1 (F1.5) ----------
  /** Serie impresa 15 dígitos (consenso del código 1D — clasificacion.
   *  codigoUnico.crudo; el runner la persiste en el write LISTA — regla
   *  general e63k). null = sin lectura consensuada (jamás inventar —
   *  RED LINE 2). Base de la capa 2 de dedup por identidad. */
  serie: string | null;
  // ---------- e63m — KIT e63m-capa0-qr-identidad-v1 (F3) — ADITIVOS AL FINAL ----------
  /** Payload QR EXACTO de la CAPA 0 (identidad-qr.ts — base64 de 32 bytes,
   *  llave OPACA). null = sin-payload / registro previo (jamás inventar).
   *  EXPORT-ONLY: se lee del registro tal cual — PROHIBIDO recalcular. */
  qrPayload: string | null;
  /** Hash perceptual dhash hex-16 de la capa 1 (reg.hashDedup — SI existe en
   *  memoria/IDB). null = el instrumento no corrió / decode falló. Ídem:
   *  EXPORT-ONLY, jamás se recalcula en el exportador (kit §1.3). */
  dedupHash: string | null;
  // ---------- ANEXO AGENTE C (REPARTE-3-AGENTES-v1) — aditivos AL FINAL ----------
  /** dupOf del registro (fila gemela → id de su original; null = original). */
  dupOf: string | null;
  /** Tiempo AHORRADO por reutilizar el desenlace de la original (solo
   *  duplicadas con dato — fórmula de ahorrosDedup; null = sin referencia,
   *  jamás inventar). */
  ahorroMs: number | null;
  // ---------- WAVE2 (REPARTE-WAVE2-tiempos-v1) — C2: diagnóstico del probe — ADITIVOS AL FINAL ----------
  /** (C2) Sub-decisión de la miniatura del probe (A1), TAL CUAL viene del
   *  diagnóstico si existe. AUSENTE si la mini no corrió o el camino fue
   *  confiado (la mini YA fue la decisión — jamás inventar). SOLO
   *  diagnóstico de campo para la calibración wave 3 — nada de esto
   *  alimenta decisiones (D6). */
  orientacionProbeMini?: {
    rot: 0 | 90 | 180 | 270;
    aplicado: boolean;
    corte: "sana" | "presupuesto" | "completo" | "confirmada";
    conf: number | null;
    anclas: number | null;
  };
  /** (C2) Escala (lado mayor en px) a la que corrió el probe. Hoy NO llega
   *  al registro — cuando A1 la conecte el informe la publica sin otro
   *  cambio aquí. */
  orientacionProbeEscala?: number;
}

/** WAVE2 C2 — campos del diagnóstico que el kit A1 añadirá a
 *  DiagnosticoActa (hoy en branches paralelas). Intersección tipada (SIN
 *  as any): el passthrough compila HOY y queda en no-op cuando A1
 *  aterrice (campos idénticos). */
type ProbeExtrasDiag = {
  orientacionProbeMini?: {
    rot: 0 | 90 | 180 | 270;
    aplicado: boolean;
    corte: "sana" | "presupuesto" | "completo" | "confirmada";
    conf: number | null;
    anclas: number | null;
  };
  orientacionProbeEscala?: number;
};

/** Resumen para la UI (T2) — espejo de lo importante del informe.json. */
interface ResumenInforme {
  generado: string;
  totalActas: number;
  carpetas: number;
  porEstadoFila: Record<string, number>;
  porStatusActa: Record<string, number>;
  tiemposMediosMs: {
    procesoMs: number | null;
    calidadMs: number | null;
    ocrMs: number | null;
    totalMs: number | null;
    /** D57 — media de esperaMs SOLO sobre actas con el dato (null si
     *  ninguna lo trae — jamás inventar, kit §2). */
    esperaMs: number | null;
    /** D61 — KIT e14-tiempos-ocultos-v1 (T4): medias SOLO sobre actas con el
     *  dato (mismo criterio de esperaMs — null si ninguna lo trae). */
    decodeMs: number | null;
    detectMs: number | null;
    persistMs: number | null;
    envioMs: number | null;
  };
  /** Tope T1.6 aplicado: imágenes recortadas a las N más recientes. */
  imagenesRecortadasA: number | null;
  actasSinImagen: string[];
  /** Peso REAL del zip terminado. */
  pesoZipBytes: number;
}

/** Progreso opcional (T1.5: el código puede reportar; la UI hoy no lo pinta). */
interface ProgresoInforme {
  fase: "LEYENDO" | "EMPAQUETANDO";
  actual: number;
  total: number;
}

interface InformeZip {
  blob: Blob;
  nombre: string;
  resumen: ResumenInforme;
}

// ---------- Helpers puros ----------

/** dataURL → bytes EXACTOS (atob, sin re-encode — receta d57e538 §9.3). */
function dataUrlABytes(dataUrl: string): Uint8Array {
  const coma = dataUrl.indexOf(",");
  const base64 = coma === -1 ? dataUrl : dataUrl.slice(coma + 1);
  const binaria = atob(base64);
  const bytes = new Uint8Array(binaria.length);
  for (let i = 0; i < binaria.length; i += 1) bytes[i] = binaria.charCodeAt(i);
  return bytes;
}

/** Extensión REAL para el original.<ext> de una fila ERROR con Blob: la del
 *  nombre manda (el guard dejó pasar por extensión); si no hay, el MIME. */
function extensionDe(reg: RegistroMasiva): string {
  const porNombre = /\.([a-z0-9]{2,5})$/i.exec(reg.nombre)?.[1]?.toLowerCase();
  if (porNombre) return porNombre;
  const porMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return porMime[reg.archivo?.type ?? ""] ?? "bin";
}

/** Mapa liviano de un registro (lectura del listado — CERO dataURLs aquí).
 *  D63-A2 rev.2: exportada PURO para el humo de integración REAL
 *  (RegistroMasiva → filaLiviana → actaLivianaJson — el humo rev.1 validó
 *  el spread con una FilaInforme fabricada y se saltó exactamente este
 *  constructor, donde estaba el hueco). */
export function filaLiviana(reg: RegistroMasiva): FilaInforme {
  const acta = reg.acta;
  const diag = acta?.diagnostico;
  // WAVE2 C2 — lectura del diagnóstico EXTENDIDO (A1): la intersección solo
  // TIPEA los campos nuevos — jamás los fabrica (ausentes → undefined).
  const diagProbe = diag as (DiagnosticoActa & ProbeExtrasDiag) | undefined;
  const conCarpeta =
    reg.estado === "ERROR"
      ? !!reg.archivo // ERROR de pipeline: conserva el Blob (T1.3)
      : reg.estado === "LISTA"
        ? !!acta && ESTADOS_CARPETA.includes(acta.status)
        : false;
  const pesoImagenes =
    reg.estado === "ERROR"
      ? (reg.archivo?.size ?? 0)
      : Math.floor(
          (((acta?.fotoOriginal?.length ?? 0) +
            (acta?.fotoProcesada?.length ?? 0)) *
            3) /
            4 +
            // e68-blob-idb-v1: las fotos del acta duermen como Blobs en el
            // registro (migración base64 → Blob) — sus bytes REALES suman a
            // la estimación (registros previos a e68 traen dataURLs → rama
            // ×3/4; ambos mundos conviven sin doble conteo).
            (reg.fotoOriginalBlob?.size ?? 0) +
            (reg.fotoProcesadaBlob?.size ?? 0),
        );
  return {
    id: reg.id,
    nombre: reg.nombre,
    agregadaEn: reg.agregadaEn,
    estado: reg.estado,
    error: reg.error ?? null,
    statusActa: acta?.status ?? null,
    score: acta?.score ?? null,
    rechazo: acta?.rechazo
      ? { tipo: acta.rechazo.tipo, detalle: acta.rechazo.detalle }
      : null,
    paginaIndex: acta?.pagina?.index ?? null,
    clasificacionNivel: acta?.clasificacion?.nivel ?? null,
    lecturaNivel: diag ? diag.lectura.nivel : null,
    gateCompleta: diag ? diag.gate.completa : null,
    quadOrigen: diag ? diag.captura.quadOrigen : null,
    tiempos: diag?.tiempos ?? null,
    // D57 — instrumentos aditivos: orientacionProbeMs cuando el diagnóstico
    // lo trae (null si no — la forma del mapa NO cambia para los parsers).
    orientacionProbeMs: diag?.orientacionProbeMs ?? null,
    // D63-A — origen del detector (null si el diagnóstico no lo trae —
    // registros previos/SIM; jamás inventar).
    origen: diag?.origen ?? null,
    origenSenales: diag?.origenSenales ?? null,
    // D63-D — trazas de escaneos del diagnóstico (null si no las trae —
    // fotos, SIM, registros previos a D63-B/C; jamás inventar).
    skewGrados: diag?.skewGrados ?? null,
    deskewMs: diag?.deskewMs ?? null,
    gateMarco: diag?.gate?.gateMarco ?? null,
    // D63-A2 (T2): presente SOLO si origen escaneo + provenance del master
    // (fotos/WhatsApp/SIM/registros previos → ausente; jamás inventar).
    // false ES dato (escaneo recto — maestroFuente "original").
    preprocesoAplicado:
      diag?.origen === "escaneo" && diag.maestroFuente != null
        ? diag.maestroFuente === "corregido"
        : undefined,
    // D66 — trazas de decodificación del REGISTRO (null/ausente = sin master
    // — fallback a la ruta de siempre, ERROR, registros previos; jamás
    // inventar). decodeMs top-level ≠ tiempos.decodeMs (D61, decode del
    // archivo en el bridge — semánticas distintas, ambas honestas).
    decodeMs: reg.decodeMs ?? null,
    origenDecode: reg.origenDecode ?? null,
    precalentada: reg.precalentada === true,
    precalorMs: reg.precalorMs ?? null,
    // D65 — trazas del watchdog y del dedup v2 (viven EN el registro, no en
    // el diagnóstico — kit T1.4/T2.3). null si el registro no las trae
    // (pre-D65, gemela copiada, hash falló — jamás inventar).
    watchdog: reg.watchdog ?? null,
    etapaAlMorir: reg.etapaAlMorir ?? null,
    elapsedMs: reg.elapsedMs ?? null,
    dedup: reg.dedup ?? null,
    dedupDistancia: reg.dedupDistancia ?? null,
    // WAVE3 §B — traza del rescate (null si el registro no la trae —
    // pre-wave3 o sin rescate; jamás inventar).
    rescateRechazo: reg.rescateRechazo ?? null,
    // KIT e73 (§E) — telemetría del sondeo QR en ingesta (null si el registro
    // no la trae — pre-e73 / flag OFF / hard-kill — jamás inventar).
    sondeoQrMs: reg.sondeoQrMs ?? null,
    sondeoQrTier: reg.sondeoQrTier ?? null,
    tieneDiagnostico: !!diag,
    conCarpeta,
    pesoImagenes,
    extArchivo: extensionDe(reg),
    // e63f (F0): balde fino del no-AUTO (null si AUTO/sin motivo — la
    // clasificación vieja no trae el campo → null, jamás inventar).
    clasifDebil: acta?.clasificacion?.clasifDebil ?? null,
    // e63k (F1.5): serie impresa del registro (el runner la persiste en el
    // write LISTA — null/ausente = sin consenso, jamás inventar).
    serie: reg.serie ?? null,
    // e63m (F3): payload QR + hash dhash del registro — EXPORT-ONLY (se
    // copian tal cual del registro; PROHIBIDO recalcular hashes/payloads
    // aquí — kit §1.3). null/ausente = sin dato (jamás inventar).
    qrPayload: reg.qrPayload ?? null,
    dedupHash: reg.hashDedup ?? null,
    // ANEXO Agente C: dupOf del registro + ahorro (null aquí — el cálculo
    // necesita el LOTE completo y vive en ahorrosDedup/generarInformeZip).
    dupOf: reg.dupOf ?? null,
    ahorroMs: null,
    // WAVE2 C2 — diagnóstico del probe (A1): passthrough tal cual (campos
    // AUSENTES si el diagnóstico no los trae — jamás inventar). SOLO
    // diagnóstico de campo para la calibración wave 3 (D6).
    orientacionProbeMini: diagProbe?.orientacionProbeMini,
    orientacionProbeEscala: diagProbe?.orientacionProbeEscala,
  };
}

/** D63-D rev.2 (T2b): señal DOMINANTE de un string de señales de un origen
 *  null — la negativa que explica la duda (cada string de null trae
 *  EXACTAMENTE una de estas, por la regla de decisión de D63-A):
 *  - `sin-exif+sin-bitmap` → sin-bitmap (el decode falló — causa raíz)
 *  - `sin-exif+borde-no-blanco+…` → borde-no-blanco (el borde no pareció scanner)
 *  - `sin-exif+borde-blanco+ratio-fuera` → ratio-fuera (blanco pero forma absurda)
 *  null si no hay negativa identificable (no se inventa balde). */
function senalDominante(senales: string): string | null {
  const partes = senales.split("+");
  if (partes.includes("sin-bitmap")) return "sin-bitmap";
  if (partes.includes("borde-no-blanco")) return "borde-no-blanco";
  if (partes.includes("ratio-fuera")) return "ratio-fuera";
  return null;
}

/** Conteo por valor — claves fijas a 0 cuando se pasan (JSON estable). */
function conteo(
  valores: Array<string | null | undefined>,
  claves?: readonly string[],
): Record<string, number> {
  const mapa: Record<string, number> = {};
  if (claves) for (const clave of claves) mapa[clave] = 0;
  for (const valor of valores) {
    if (valor == null) continue;
    mapa[valor] = (mapa[valor] ?? 0) + 1;
  }
  return mapa;
}

/** Espejo del DETALLE_TIMEOUT del bridge/runner (constante PRIVADA allí):
 *  el string ES el veredicto de «murió el procesado» — el informe lo usa
 *  para separar colgadas salvadas de colgadas muertas (D65 T4.2). */
const DETALLE_TIMEOUT_INFORME = "TIEMPO DE PROCESADO EXCEDIDO";

/** e63m (F3) — prefijo corto del payload para la columna dedupQr del txt:
 *  primeros 24 chars + «…» (WAVE3 C.4 — el corte 8 COLISIONABA entre actas
 *  DISTINTAS: par LcyzMYaR del informe 104609 diverge en el char 22 — 16
 *  chars AÚN colisionaban, 24 los distingue; verificado con los 4 payloads
 *  reales). La decisión vive SIEMPRE en la igualdad EXACTA; esto es SOLO
 *  cosmética. Espejo local de qrCorto de identidad-qr.ts (informe.ts NO
 *  importa el módulo QR: el exportador jamás toca el decodificador —
 *  export-only). */
function qrCortoInforme(payload: string): string {
  return `${payload.slice(0, 24)}…`;
}

/** D65 (T4.2) — resumen de COLGADAS (PURO — humo bun): n = filas con
 *  watchdog ≥ 1 (al menos un intento murió); salvadas = de esas, las cuyo
 *  desenlace final NO es el rechazo-timeout (el reintento las rescató);
 *  porEtapa = conteo de etapaAlMorir (buckets fijos a 0 + "sin-senal").
 *  Registros pre-D65 (watchdog null) no cuentan — el instrumento no existía. */
function resumenColgadas(filas: FilaInforme[]): {
  total: number;
  salvadas: number;
  porEtapa: Record<string, number>;
} {
  const colgadas = filas.filter((f) => f.watchdog != null && f.watchdog >= 1);
  const salvadas = colgadas.filter(
    (f) =>
      !(
        f.rechazo?.tipo === "ILEGIBLE" &&
        f.rechazo.detalle === DETALLE_TIMEOUT_INFORME
      ),
  ).length;
  const porEtapa = conteo(
    colgadas.map((f) => f.etapaAlMorir ?? "sin-senal"),
    ["decodificando", "deteccion", "ocr", "verificacion"],
  );
  return { total: colgadas.length, salvadas, porEtapa };
}

/** D65 (T4.3) — resumen de DEDUP v2 (PURO — humo bun). activo = hay trazas
 *  del dedup (el instrumento corrió en esta cola).
 *  e66 (P3, revoca el criterio e63k F1.5): matches = TODAS las capas que
 *  detectaron duplicado — "v2" + "identidad" + "qr" + "ya-enviada" — no solo
 *  la capa visual v2. "visual-aplazada" NO es match (resolución pendiente —
 *  activo true igualmente porque dedup != null) y "sin-match" tampoco.
 *  Desglose aditivo: v2 (la cuenta que matches era antes), qr, identidad,
 *  yaEnviada. distanciaMedia SOLO sobre filas con distancia presente
 *  (v2/identidad — sin datos → null, jamás inventar). */
export function resumenDedup(filas: FilaInforme[]): {
  activo: boolean;
  matches: number;
  /** e66 (P3) — desglose aditivo: matches de la capa visual v2 (lo que
   *  matches significaba antes del kit; los parsers viejos lo pierden, los
   *  nuevos lo tienen explícito). */
  v2: number;
  distanciaMedia: number | null;
  sinMatch: number;
  identidad: number;
  /** e63m (F3): gemelas atrapadas por la CAPA 0 (dedup "qr" — identidad-QR
   *  pre-OCR, el OCR jamás se pagó). 0 = la capa no atrapó nada (dato real). */
  qr: number;
  /** e66 (P3): filas nacidas YA-ENVIADA (dedup "ya-enviada" — match contra
   *  registro enviado del histórico). Aditivo al final. */
  yaEnviada: number;
  /** WAVE3 C.2 (obs-informe-wave3-v1) — puertas del veto (aditivo al final):
   *  postocr = H1 en el punto único de envío; copia = traza visual que
   *  aterrizó sobre un registro YA-ENVIADA. NO cuentan en `matches`
   *  (semántica e66 estable — solo trazas nuevas explícitas). */
  yaEnviadaPostocr: number;
  yaEnviadaCopia: number;
  /** KIT e73 (§E) — gemelas atrapadas por el SONDEO en INGESTA (dedup
   *  "qr-sondeo" — pre-pool: jamás slot/probe/OCR). Aditivo al final. */
  qrSondeo: number;
} {
  const conMatch = filas.filter(
    (f) =>
      f.dedup === "v2" ||
      f.dedup === "identidad" ||
      f.dedup === "qr" ||
      f.dedup === "ya-enviada",
  );
  // e66 (P3): distancia SOLO de las capas que la traen (v2/identidad) y con
  // el dato presente (typeof excluye null/undefined — jamás inventar).
  const distancias = conMatch
    .filter((f) => f.dedup === "v2" || f.dedup === "identidad")
    .map((f) => f.dedupDistancia)
    .filter((v): v is number => typeof v === "number");
  return {
    activo: filas.some((f) => f.dedup != null),
    matches: conMatch.length,
    v2: filas.filter((f) => f.dedup === "v2").length,
    distanciaMedia: distancias.length
      ? Math.round(distancias.reduce((a, b) => a + b, 0) / distancias.length)
      : null,
    sinMatch: filas.filter((f) => f.dedup === "sin-match").length,
    identidad: filas.filter((f) => f.dedup === "identidad").length,
    qr: filas.filter((f) => f.dedup === "qr").length,
    yaEnviada: filas.filter((f) => f.dedup === "ya-enviada").length,
    yaEnviadaPostocr: filas.filter((f) => f.dedup === "ya-enviada-postocr").length,
    yaEnviadaCopia: filas.filter((f) => f.dedup === "ya-enviada-copia").length,
    qrSondeo: filas.filter((f) => f.dedup === "qr-sondeo").length,
  };
}

/** Medias SOLO sobre actas con el dato (sin inventar — T1.2). */
function mediosTiempos(filas: FilaInforme[]): ResumenInforme["tiemposMediosMs"] {
  // D57 — "esperaMs" AÑADIDO (aditivo — los campos viejos no cambian de
  // forma; compatibilidad con informes previos, kit §4-T3).
  // D61 — KIT e14-tiempos-ocultos-v1 (T4): "decodeMs/detectMs/persistMs/
  // envioMs" AÑADIDOS con el MISMO criterio (media SOLO sobre actas con el
  // dato — el filtro typeof ya excluye null/undefined; jamás inventar).
  const campos = [
    "procesoMs",
    "calidadMs",
    "ocrMs",
    "totalMs",
    "esperaMs",
    "decodeMs",
    "detectMs",
    "persistMs",
    "envioMs",
  ] as const;
  const medias: Record<string, number | null> = {};
  for (const campo of campos) {
    const valores = filas
      .map((f) => f.tiempos?.[campo])
      .filter((v): v is number => typeof v === "number");
    medias[campo] = valores.length
      ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)
      : null;
  }
  return medias as ResumenInforme["tiemposMediosMs"];
}

// ---------- ANEXO AGENTE C — percentiles + throughput + ahorro de duplicadas ----------

/** Etapas del desglose (nombres REALES de campos de FilaInforme — kit C §1.1).
 *  "decode" = decode REAL del master: precalorMs cuando la fila nació de un
 *  master precalentado (decodeMs top-level es 0 ahí — el decode vivió en el
 *  precalor), decodeMs si no. Semántica idéntica a la línea
 *  CONVERSION/PERSISTENCIA del txt (misma fuente de valores). */
export type EtapaInforme = "decode" | "espera" | "probe" | "ocr" | "total";

/** Valor REALES (ms) de una etapa para UNA fila — null si la fila no trae el
 *  dato (jamás inventar). PURA. */
export function valorEtapa(f: FilaInforme, etapa: EtapaInforme): number | null {
  // WAVE2 C1 — reuso (dupOf != null): la copia NO pagó pipeline propio —
  // sus decode/probe/OCR HEREDADOS del original (spread de
  // reutilizarResultadoCritica, e72) NO son SU consumo (criterio literal
  // del dueño en e72: el duplicado muestra SU consumo). espera y total SÍ
  // son propios de la copia (e66 P3.4 / e72) → siguen igual.
  if (f.dupOf != null && etapa !== "espera" && etapa !== "total") return null;
  switch (etapa) {
    case "decode": {
      const v = f.precalentada ? f.precalorMs : f.decodeMs;
      return typeof v === "number" ? v : null;
    }
    case "espera":
      return typeof f.tiempos?.esperaMs === "number" ? f.tiempos.esperaMs : null;
    case "probe":
      return typeof f.orientacionProbeMs === "number" ? f.orientacionProbeMs : null;
    case "ocr":
      return typeof f.tiempos?.ocrMs === "number" ? f.tiempos.ocrMs : null;
    case "total":
      return typeof f.tiempos?.totalMs === "number" ? f.tiempos.totalMs : null;
  }
}

/** Percentil p (0–100) con interpolación lineal estándar (método inclusivo:
 *  rango = p/100·(n−1) sobre la lista ORDENADA; p50 ≡ mediana — para n par
 *  da el promedio de los dos centrales, EXACTO el mismo valor que el cálculo
 *  inline que el txt ya hacía para la espera). PURA y testable: [] → null
 *  (sin reventar); 1 elemento → ese elemento. */
export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  if (ordenados.length === 1) return ordenados[0];
  const rango = (p / 100) * (ordenados.length - 1);
  const bajo = Math.floor(rango);
  const alto = Math.ceil(rango);
  if (bajo === alto) return ordenados[bajo];
  return ordenados[bajo] + (rango - bajo) * (ordenados[alto] - ordenados[bajo]);
}

/** p50/p95 (ms redondeados) por etapa — SOLO sobre actas con el dato
 *  (null si la etapa no tiene datos — jamás inventar). PURA. */
export function percentilesTiempos(
  filas: FilaInforme[],
): Record<EtapaInforme, { p50: number | null; p95: number | null }> {
  const etapas: EtapaInforme[] = ["decode", "espera", "probe", "ocr", "total"];
  const res = {} as Record<EtapaInforme, { p50: number | null; p95: number | null }>;
  for (const etapa of etapas) {
    const valores = filas
      // WAVE2 C1 — etapa total: las copias (dupOf) quedan FUERA aunque
      // traigan su total real ≈0 (verdad que NO describe el costo del
      // pipeline — el p50 total describe solo actas que SÍ procesaron).
      // decode/probe/OCR se auto-excluyen vía valorEtapa → null; espera
      // queda sobre TODAS las filas con dato (su espera es real).
      .filter((f) => etapa !== "total" || f.dupOf == null)
      .map((f) => valorEtapa(f, etapa))
      .filter((v): v is number => v != null);
    res[etapa] = {
      p50: valores.length ? Math.round(percentil(valores, 50) as number) : null,
      p95: valores.length ? Math.round(percentil(valores, 95) as number) : null,
    };
  }
  return res;
}

/** THROUGHPUT del lote (kit C §1.3): actas ENVIADAS por minuto de reloj.
 *  Fórmula: nENVIADAS / ((último fin − primer inicio) / 60000), donde el
 *  INICIO de un acta = agregadaEn + esperaMs (cuando salió de la cola) y su
 *  FIN = inicio + totalMs (totalMs NO incluye la espera — línea TOTALES del
 *  txt). Solo ENVIADAS con totalMs (sin dato → fuera del censo); sin
 *  ENVIADAS con datos → null (jamás inventar). PURA. */
export function throughputEnviadas(filas: FilaInforme[]): {
  n: number;
  minutos: number | null;
  porMinuto: number | null;
} {
  const enviadas = filas.filter(
    (f) => f.statusActa === "ENVIADA" && typeof f.tiempos?.totalMs === "number",
  );
  if (!enviadas.length) return { n: 0, minutos: null, porMinuto: null };
  const inicios = enviadas.map(
    (f) => f.agregadaEn + (typeof f.tiempos?.esperaMs === "number" ? f.tiempos.esperaMs : 0),
  );
  const fines = enviadas.map(
    (f) =>
      f.agregadaEn +
      (typeof f.tiempos?.esperaMs === "number" ? f.tiempos.esperaMs : 0) +
      (f.tiempos?.totalMs ?? 0),
  );
  const duracionMs = Math.max(...fines) - Math.min(...inicios);
  const minutos = Math.round((duracionMs / 60000) * 100) / 100;
  const porMinuto =
    duracionMs > 0
      ? Math.round((enviadas.length / (duracionMs / 60000)) * 100) / 100
      : null;
  return { n: enviadas.length, minutos, porMinuto };
}

/** ANEXO Agente C (Tarea 2) — AHORRO de cada DUPLICADA (PURO, testable).
 *
 *  Fórmula: ahorroMs = max(0, REFERENCIA − totalMs de la copia), donde
 *  REFERENCIA es, en orden de precisión:
 *  1. el totalMs de SU original (dupOf presente EN ESTE lote con dato),
 *  2. la media de totalMs de las ENVIADAS del lote (el pipeline típico que
 *     la copia se saltó — el mismo denominador natural que el anexo usa
 *     para ahorroEquivalenteActas).
 *  Nota de origen: la UI que citaba el anexo («Ahorrado 12.4s») NO existe
 *  en main (MasivaView solo muestra «≡ original» para gemelas) → fórmula
 *  propia documentada, calculada SOLO desde campos ya existentes.
 *  Sin totalMs propio o sin referencia → la copia no aporta ahorro (null;
 *  jamás inventar). ahorroTotalMs = suma redondeada (null si ninguna);
 *  ahorroEquivalenteActas = ahorroTotalMs / media(totalMs ENVIADAS), a 1
 *  decimal (cuántas actas-equivalentes se dejaron de procesar). */
export function ahorrosDedup(filas: FilaInforme[]): {
  porActa: Record<string, number>;
  ahorroTotalMs: number | null;
  ahorroEquivalenteActas: number | null;
} {
  const enviadas = filas.filter(
    (f) => f.statusActa === "ENVIADA" && typeof f.tiempos?.totalMs === "number",
  );
  const mediaEnviadas = enviadas.length
    ? enviadas.reduce((s, f) => s + (f.tiempos?.totalMs ?? 0), 0) / enviadas.length
    : null;
  const porId = new Map(filas.map((f) => [f.id, f] as const));
  const porActa: Record<string, number> = {};
  let suma = 0;
  let cuenta = 0;
  for (const f of filas) {
    if (f.statusActa !== "DUPLICADA") continue;
    const propio = f.tiempos?.totalMs;
    if (typeof propio !== "number") continue; // sin dato → fuera (honesto)
    const original = f.dupOf != null ? porId.get(f.dupOf) : undefined;
    const referencia =
      typeof original?.tiempos?.totalMs === "number"
        ? original.tiempos.totalMs
        : mediaEnviadas;
    if (referencia == null) continue;
    const ahorro = Math.max(0, Math.round(referencia - propio));
    porActa[f.id] = ahorro;
    suma += ahorro;
    cuenta += 1;
  }
  return {
    porActa,
    ahorroTotalMs: cuenta ? Math.round(suma) : null,
    ahorroEquivalenteActas:
      cuenta && mediaEnviadas
        ? Math.round((suma / mediaEnviadas) * 10) / 10
        : null,
  };
}

/** Entorno real del navegador (T1.2) — datos para calibrar, sin inventar. */
function entornoInforme(): EntornoInforme {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "",
      idioma: "",
      nucleos: null,
      memoriaGB: null,
      crossOriginIsolated: false,
      url: "",
    };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    idioma: nav.language,
    nucleos: nav.hardwareConcurrency ?? null,
    memoriaGB: nav.deviceMemory ?? null,
    crossOriginIsolated:
      typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    url: typeof location !== "undefined" ? location.href : "",
  };
}

/** WAVE2 C3 — ANEXO2: tier del entorno para el informe. Reusa
 *  obtenerDispositivo() de obs/dispositivo.ts (SOLO lectura — no muta
 *  nada; D6). null honesto cuando el navegador no da datos (SSR/vitest)
 *  o cualquier lectura falla — jamás inventar (mismo patrón silencioso
 *  de almacenamientoIdbMb). */
async function tierDelEntorno(): Promise<{
  tier: Tier;
  tierInferido: boolean;
} | null> {
  try {
    if (typeof navigator === "undefined") return null;
    const snap = await obtenerDispositivo();
    return { tier: snap.tier, tierInferido: snap.tierInferido };
  } catch {
    return null;
  }
}

/** Nombre de archivo/carpeta seguro (T1.8): minúsculas, sin espacios ni
 *  caracteres raros, máx 40. Vacío → «acta» (nunca un tramo vacío). */
function sanitizarNombre(nombre: string): string {
  const limpio = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, 40)
    .replace(/[.\-]+$/, "");
  return limpio || "acta";
}

/** Carpeta única por fila (T1.8): id + nombre sanitizado + estado — el id
 *  ya hace única la carpeta; el sufijo -2 es el cinturón del kit. */
function nombreCarpeta(fila: FilaInforme, usados: Set<string>): string {
  const estado =
    fila.estado === "LISTA" ? (fila.statusActa ?? "LISTA") : fila.estado;
  const base = `${fila.id}-${sanitizarNombre(fila.nombre)}-${estado}`;
  let nombre = base;
  let n = 2;
  while (usados.has(nombre)) {
    nombre = `${base}-${n}`;
    n += 1;
  }
  usados.add(nombre);
  return nombre;
}

/** Entrada liviana del array actas[] del informe.json (T1.2 — campos exactos
 *  del kit; PROHIBIDO fotoOriginal/fotoProcesada/ocrTexto aquí). D63-D rev.2:
 *  exportada PURO para verificación por humo (misma razón que renderTxt). */
export function actaLivianaJson(fila: FilaInforme) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    agregadaEn: fila.agregadaEn,
    estado: fila.estado,
    error: fila.error,
    statusActa: fila.statusActa,
    score: fila.score,
    rechazo: fila.rechazo,
    paginaIndex: fila.paginaIndex,
    clasificacionNivel: fila.clasificacionNivel,
    lecturaNivel: fila.lecturaNivel,
    gateCompleta: fila.gateCompleta,
    quadOrigen: fila.quadOrigen,
    tiempos: fila.tiempos,
    // D57 — por-acta, SOLO cuando exista (kit §4-T3: "cuando existan" —
    // JSON.stringify omite undefined → informes previos no cambian de forma).
    ...(fila.orientacionProbeMs != null
      ? { orientacionProbeMs: fila.orientacionProbeMs }
      : {}),
    // D63-D rev.2 (T1b): trazas de origen — campo AUSENTE si el diagnóstico
    // no lo trae (registros previos/SIM — jamás inventar; misma receta del
    // spread condicional de arriba). skewGrados 0 ES dato (guard != null).
    ...(fila.origen != null ? { origen: fila.origen } : {}),
    ...(fila.origenSenales != null
      ? { origenSenales: fila.origenSenales }
      : {}),
    ...(fila.skewGrados != null ? { skewGrados: fila.skewGrados } : {}),
    ...(fila.gateMarco != null ? { gateMarco: fila.gateMarco } : {}),
    // D66 — KIT e14-decode-unico-precalor-v1 (T4): trazas de decodificación —
    // campos AUSENTES si el registro no trae master (misma receta del spread
    // condicional: informes previos no cambian de forma).
    ...(fila.decodeMs != null ? { decodeMs: fila.decodeMs } : {}),
    ...(fila.origenDecode != null ? { origenDecode: fila.origenDecode } : {}),
    ...(fila.precalentada ? { precalentada: true } : {}),
    ...(fila.precalorMs != null ? { precalorMs: fila.precalorMs } : {}),
    // D65 (T1.4/T2.3): trazas del watchdog y del dedup v2 — campo AUSENTE si
    // el registro no lo trae (pre-D65/gemela copiada — misma receta del
    // spread condicional de arriba; informes previos no cambian de forma).
    ...(fila.watchdog != null ? { watchdog: fila.watchdog } : {}),
    ...(fila.etapaAlMorir != null ? { etapaAlMorir: fila.etapaAlMorir } : {}),
    ...(fila.elapsedMs != null ? { elapsedMs: fila.elapsedMs } : {}),
    ...(fila.dedup != null ? { dedup: fila.dedup } : {}),
    ...(fila.dedupDistancia != null
      ? { dedupDistancia: fila.dedupDistancia }
      : {}),
    // D63-A2 (T2): ¿el pre-proceso (deskew) aplicó? — campo AUSENTE salvo
    // escaneos post-D63-A2 (misma receta del spread condicional; informes
    // previos no cambian de forma). preprocesoAplicado false ES dato
    // (escaneo recto — el deskew no rotó).
    ...(fila.preprocesoAplicado != null
      ? { preprocesoAplicado: fila.preprocesoAplicado }
      : {}),
    // e63k (F1.5): serie impresa — campo AUSENTE si no hay consenso
    // (misma receta del spread condicional; informes previos intactos).
    ...(fila.serie != null ? { serie: fila.serie } : {}),
    // e63m (F3): payload QR + hash dhash — campos AUSENTES si el registro
    // no los trae (misma receta del spread condicional; informes previos
    // intactos). EXPORT-ONLY: viajan tal cual, jamás se recalculan.
    ...(fila.qrPayload != null ? { qrPayload: fila.qrPayload } : {}),
    ...(fila.dedupHash != null ? { dedupHash: fila.dedupHash } : {}),
    // ANEXO Agente C — dupOf + ahorroMs (ADITIVOS AL FINAL: campos AUSENTES
    // si no aplican — originales no traen ahorro; informes previos intactos).
    ...(fila.dupOf != null ? { dupOf: fila.dupOf } : {}),
    ...(fila.ahorroMs != null ? { ahorroMs: fila.ahorroMs } : {}),
    // WAVE2 C1 — reuso (dupOf): la herencia e72 se DECLARA sin borrar
    // campos previos (D57 append-only — informes viejos siguen leyéndose).
    // Solo las copias la traen (la original SÍ pagó su pipeline).
    ...(fila.dupOf != null ? { tiemposHeredados: true } : {}),
    // WAVE2 C2 — diagnóstico del probe (A1): campos AUSENTES si la fila no
    // los trae (misma receta del spread condicional — informes previos
    // intactos). SOLO diagnóstico de campo (D6: no alimenta decisiones).
    ...(fila.orientacionProbeMini != null
      ? { orientacionProbeMini: fila.orientacionProbeMini }
      : {}),
    ...(fila.orientacionProbeEscala != null
      ? { orientacionProbeEscala: fila.orientacionProbeEscala }
      : {}),
  };
}

/** informe.txt — render legible del MISMO contenido del informe.json (T1).
 *  D63-D: exportada PURO (sin side effects) para verificación por humo —
 *  misma razón que tituloDeActa en masiva/tipos.ts (D59REV). */
export function renderTxt(
  generado: string,
  entorno: EntornoInforme,
  filas: FilaInforme[],
  porEstadoFila: Record<string, number>,
  porStatusActa: Record<string, number>,
  tiemposMedios: ResumenInforme["tiemposMediosMs"],
  recortado: boolean,
  sinImagen: string[],
): string {
  const L: string[] = [];
  const linea = (s = "") => L.push(s);
  linea("E14 - INFORME DE ANALISIS DE LA COLA MASIVA");
  linea("=".repeat(46));
  linea(`Generado: ${generado}`);
  linea(`Fuente: cola-masiva (IndexedDB e14-masiva-v1)`);
  linea();
  linea("ENTORNO");
  linea(`- Navegador: ${entorno.userAgent}`);
  linea(`- Idioma: ${entorno.idioma} - Nucleos: ${entorno.nucleos ?? "?"} - Memoria(GB): ${entorno.memoriaGB ?? "?"}`);
  // WAVE2 C3 — ANEXO2 (tier del entorno): línea NUEVA tras Núcleos/Memoria
  // (append-only — parsers por prefijo intactos). SOLO cuando el tier fue
  // detectado — sin dato el txt queda byte-idéntico (jamás inventar).
  // "(inferido)" = sin deviceMemory (iOS — reglas §4.4 de
  // obs/dispositivo.ts; D6: detectar y reportar, jamás cambia reglas).
  if (entorno.tier != null) {
    linea(`- Tier: ${entorno.tier}${entorno.tierInferido ? " (inferido)" : ""}`);
  }
  linea(`- crossOriginIsolated: ${entorno.crossOriginIsolated}`);
  linea(`- URL: ${entorno.url}`);
  linea();
  linea("TOTALES");
  linea(`- Actas en la cola: ${filas.length}`);
  linea(
    `- Por estado de fila: ${Object.entries(porEstadoFila)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  linea(
    `- Por estado del acta: ${Object.entries(porStatusActa)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  linea(
    `- Tiempos medios (solo actas con diagnostico): total ${tiemposMedios.totalMs ?? "-"}ms - proceso ${tiemposMedios.procesoMs ?? "-"}ms - calidad ${tiemposMedios.calidadMs ?? "-"}ms - OCR ${tiemposMedios.ocrMs ?? "-"}ms`,
  );
  // WAVE2 C1 — línea NUEVA tras la de medias (ADITIVA — la de medias queda
  // INTACTA byte a byte: las medias siguen sobre TODAS las filas con dato,
  // incluida la herencia e72; los percentiles son los que excluyen el
  // reuso). n = copias con dupOf (reuso e65/e71/e72): su decode/probe/OCR
  // es HEREDADO (no propio) y su total real ≈0 no describe pipeline.
  linea(
    `- Reuso excluido de percentiles decode/probe/OCR/total: ${filas.filter((f) => f.dupOf != null).length} reuso (sus medias/p50 propios son ≈0 por diseño e72 — el p50 total describe solo actas que procesaron)`,
  );
  // D57 — KIT e14-instrumentos-espera-v1 (T3): línea NUEVA tras los tiempos
  // medios (append-only — los parsers del dueño van por prefijo). p50 SOLO
  // sobre actas con esperaMs; sin datos → "-" (jamás inventar).
  const esperas = filas
    .map((f) => f.tiempos?.esperaMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const p50 = esperas.length
    ? Math.round(
        esperas.length % 2 === 1
          ? esperas[(esperas.length - 1) / 2]
          : (esperas[esperas.length / 2 - 1] + esperas[esperas.length / 2]) / 2,
      )
    : null;
  linea(
    `- Espera media en cola: ${tiemposMedios.esperaMs ?? "-"}ms (p50 ${p50 ?? "-"}ms) — la espera es tiempo en COLA antes de iniciar; totalMs NO incluye la espera`,
  );
  // D61 — KIT e14-tiempos-ocultos-v1 (T4): línea NUEVA AL FINAL de TOTALES
  // (formato exacto del kit — aditiva, el parser por prefijos de los
  // instrumentos no se rompe). Sin datos → "-" como la línea de espera
  // (jamás inventar). La media de persistMs cubre los writes del runner
  // MASIVA; envioMs solo filas ENVIADAS online; decode/detect solo la ruta
  // worker del pipeline (canvas-path → null).
  linea(
    `CONVERSION/PERSISTENCIA (solo actas con dato): decode medio ${tiemposMedios.decodeMs ?? "-"}ms · detect medio ${tiemposMedios.detectMs ?? "-"}ms · persistencia media ${tiemposMedios.persistMs ?? "-"}ms · envio medio ${tiemposMedios.envioMs ?? "-"}ms`,
  );
  // D66 — KIT e14-decode-unico-precalor-v1 (T4): líneas aditivas AL FINAL de
  // TIEMPOS (formato literal del kit — sin reordenar las existentes, contrato
  // D57: los parsers del dueño van por prefijo). Medias en SEGUNDOS con 1
  // decimal SOLO sobre filas con el dato ("-" si ninguna — jamás inventar);
  // conteos nativo/wasm sobre origenDecode; precalentadas = filas cuyo
  // desenlace nació de un master precalentado; precalor medio ídem.
  // D66 (T4): media del decode REAL — FIX del bug «0.0s» fijo (kit C §1.4):
  // decodeMs top-level es 0 para las filas PRECALENTADAS (el decode vivió en
  // el precalor — su ms real está en precalorMs), así que la media salía
  // 0.0s aunque el lote entero decodificara. El valor REAL por fila es
  // precalorMs cuando precalentada y decodeMs si no (misma semántica de la
  // etapa "decode" de los percentiles). nativo/wasm/precalentadas y el
  // precalor medio quedan INTACTOS (append-only: solo cambia la fuente del
  // valor de la media — el bug permitido a corregir por el kit).
  const decodeValores = filas
    .map((f) => (f.precalentada ? f.precalorMs : f.decodeMs))
    .filter((v): v is number => typeof v === "number");
  const decodeMediaS = decodeValores.length
    ? (decodeValores.reduce((a, b) => a + b, 0) / decodeValores.length / 1000).toFixed(1)
    : null;
  const nativoCount = filas.filter((f) => f.origenDecode === "nativo").length;
  const wasmCount = filas.filter((f) => f.origenDecode === "wasm").length;
  const precalentadasCount = filas.filter((f) => f.precalentada).length;
  const precalorValores = filas
    .map((f) => f.precalorMs)
    .filter((v): v is number => typeof v === "number");
  const precalorMedioS = precalorValores.length
    ? (precalorValores.reduce((a, b) => a + b, 0) / precalorValores.length / 1000).toFixed(1)
    : null;
  linea(
    `Decodificacion: media ${decodeMediaS ?? "-"}s - nativo ${nativoCount} / wasm ${wasmCount} - precalentadas ${precalentadasCount} (precalor medio ${precalorMedioS ?? "-"}s)`,
  );
  // D66 (T4): vigilancia del outlier de 19 s del informe 122235 — cuántas
  // actas mantienen procesoMs por encima de 6 s (criterio de aceptación 2
  // del kit: cero outliers >6 s en lote normal). 0 con datos = honesto.
  // WAVE3 C.1 (obs-informe-wave3-v1): EXCLUYE el reuso (dupOf — el MISMO
  // conjunto que «Reuso excluido de percentiles» identifica como heredados
  // e72): su procesoMs es HEREDADO (copia del desenlace), jamás un outlier
  // del pipeline real. Evidencia real lote 9: 19 → 11 (solo ENVIADAS). La
  // ETIQUETA queda SIN CAMBIOS (D51 — parsers por prefijo intactos).
  const outliersProceso = filas.filter(
    (f) => f.dupOf == null && (f.tiempos?.procesoMs ?? 0) > 6000,
  ).length;
  linea(`Outliers procesoMs >6s: ${outliersProceso}`);
  // Kit C (REPARTE-3-AGENTES-v1 §1.1) — líneas NUEVAS al final de TOTALES
  // (append-only, D51: los parsers van por prefijo). p50/p95 por etapa SOLO
  // sobre actas con dato ("-" si la etapa no tiene — jamás inventar).
  const pcts = percentilesTiempos(filas);
  const celdaPct = (v: { p50: number | null; p95: number | null }) =>
    `${v.p50 ?? "-"} / ${v.p95 ?? "-"}`;
  linea(
    `PERCENTILES p50/p95 ms (solo actas con dato): decode ${celdaPct(pcts.decode)} - espera ${celdaPct(pcts.espera)} - probe ${celdaPct(pcts.probe)} - OCR ${celdaPct(pcts.ocr)} - total ${celdaPct(pcts.total)}`,
  );
  // Kit C (§1.3) — THROUGHPUT del lote: ENVIADAS por minuto de reloj
  // (fórmula documentada en throughputEnviadas — primer inicio → último fin).
  const tp = throughputEnviadas(filas);
  linea(
    `THROUGHPUT: ${tp.n} ENVIADAS en ${tp.minutos ?? "-"} min = ${tp.porMinuto ?? "-"} actas/min (primer inicio → último fin del lote)`,
  );
  // WAVE3 §B — ORDEN-WAVE3-remoto-rescate-obs-v1 (feat/rescate-rechazo-v1):
  // línea NUEVA AL FINAL de TOTALES (aditiva — D51, parsers por prefijo).
  // usados = reintentos lanzados (rescateRechazo != null); salvaron =
  // desenlace final ≠ RECHAZADA tras rescate ("salvado"). 0/0 = honesto
  // (sin rescates en la corrida — el instrumento silencioso es un dato).
  const rescatesUsados = filas.filter((f) => f.rescateRechazo != null).length;
  const rescatesSalvaron = filas.filter((f) => f.rescateRechazo === "salvado").length;
  linea(`Rescates rechazo: ${rescatesUsados} usados / ${rescatesSalvaron} salvaron`);
  // KIT e73-sondeo-qr-precoz-v1 (§E) — línea NUEVA AL FINAL de TOTALES
  // (aditiva — D51, parsers por prefijo): el sondeo QR en INGESTA. N leídos
  // = filas cuyo sondeo CORRIÓ (con o sin lectura — sondeoQrMs presente);
  // M con payload = sondeos con LECTURA (sondeoQrTier presente). p50/p95 de
  // sondeoQrMs SOLO sobre filas con el dato; desglose por tier SOLO con
  // lecturas ("-" si nada — jamás inventar). 0/0 = honesto (flag OFF o
  // registros previos al kit — el instrumento silencioso es un dato).
  const sondeadas = filas.filter((f) => f.sondeoQrMs != null);
  const conPayloadSondeo = sondeadas.filter((f) => f.sondeoQrTier != null);
  const p50Sondeo = percentil(
    sondeadas.map((f) => f.sondeoQrMs as number),
    50,
  );
  const p95Sondeo = percentil(
    sondeadas.map((f) => f.sondeoQrMs as number),
    95,
  );
  const tiersSondeo = [
    "full",
    "recorte",
    "rot90",
    "rot180",
    "rot270",
    "barrido",
  ]
    .map((t) => {
      const n = conPayloadSondeo.filter((f) => f.sondeoQrTier === t).length;
      return n > 0 ? `${t} ${n}` : null;
    })
    .filter((v): v is string => v != null)
    .join(" / ");
  linea(
    `Sondeo QR: ${sondeadas.length} leídos · ${conPayloadSondeo.length} con payload · p50/p95 ${p50Sondeo ?? "-"}/${p95Sondeo ?? "-"} ms · tiers: ${tiersSondeo || "-"}`,
  );
  linea();
  const rechazoFilas = filas.filter((f) => f.rechazo);
  linea(`RECHAZOS (${rechazoFilas.length})`);
  if (!rechazoFilas.length) linea("- Ninguno");
  for (const f of rechazoFilas) {
    linea(`- [${f.estado}/${f.statusActa}] ${f.nombre}: ${f.rechazo?.tipo} - ${f.rechazo?.detalle}`);
  }
  linea();
  const deteccion = conteo(
    filas.filter((f) => f.tieneDiagnostico).map((f) => f.quadOrigen ?? "null"),
    ["worker", "sobel", "null"],
  );
  linea(
    `DETECCION (quadOrigen): ${Object.entries(deteccion)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}`,
  );
  // D63-A — KIT e63a-origen-escaneo-v1 (T3): líneas aditivas AL FINAL de la
  // sección DETECCION (formato EXACTO del kit — SOLO visibilidad). Sin datos
  // de origen (registros previos/SIM) caen al balde null — jamás inventar.
  // La línea ESCANEOS cuenta SOLO las filas marcadas escaneo por su
  // statusActa (el vocabulario es el de porStatusActa); motivos = tipos de
  // rechazo únicos de las RECHAZADAS (ninguna → «ninguno»).
  const conteoOrigen = conteo(filas.map((f) => f.origen ?? "null"), ["escaneo", "foto", "null"]);
  // D63-D rev.2 (T2b): segundo nivel de la línea ORIGEN con las señales de
  // los null — conteo por la señal DOMINANTE (la negativa que explica la
  // duda: sin-bitmap = decode falló; borde-no-blanco = el borde no pareció
  // scanner; ratio-fuera = blanco pero forma absurda — cada string de
  // señales de un null trae EXACTAMENTE una de estas). Evidencia 162728:
  // los 8 escaneos reales cayeron null y sin esto no se calibra el
  // detector. Orden: conteo desc, luego alfabético (estable). Sin null
  // (o sin señales) la línea queda byte-idéntica a la de D63-A.
  const dominantes = conteo(
    filas
      .filter((f) => f.origen == null && f.origenSenales != null)
      .map((f) => senalDominante(f.origenSenales!))
      .filter((s): s is string => s != null),
  );
  const detalleNull = Object.entries(dominantes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  linea(
    `ORIGEN: ${Object.entries(conteoOrigen)
      .map(([k, v]) => `${k} ${v}`)
      .join(" - ")}${detalleNull ? ` (null: ${detalleNull})` : ""}`,
  );
  const escaneos = filas.filter((f) => f.origen === "escaneo");
  const escPorStatus = conteo(
    escaneos.map((f) => f.statusActa),
    // e66 (P2): "DUPLICADA" al final — una gemela de un ESCANEO hereda el
    // diagnóstico (con origen escaneo) del original y cae en este conteo.
    ["ENVIADA", "OPTIMA", "ADVERTENCIA", "RECHAZADA", "EN_REVISION_HUMANA", "DUPLICADA"],
  );
  const motivosEscaneos = [
    ...new Set(escaneos.filter((f) => f.rechazo).map((f) => f.rechazo?.tipo)),
  ].join(", ");
  // D63-D — KIT e63d-informe-trazas-escaneo-v1 (T2): extensión ADITIVA AL
  // FINAL de la línea ESCANEOS que dejó D63-A (el prefijo queda intacto —
  // los parsers van por prefijo, contrato D57). Sin escaneos NO se añade
  // NADA (línea byte-idéntica a D63-A). Chunks:
  // (1) deskew medio SOLO de escaneos CORREGIDOS (deskewMs presente — una
  //     media sin datos no se inventa, honestidad del kit);
  // (2) conteo de quadOrigen "pagina-completa" (valor nuevo de D63-C);
  // (3) gateMarco por resultado, baldes fijos a 0 (JSON/txt estables).
  let extensionEscaneos = "";
  if (escaneos.length) {
    const corregidos = escaneos.filter((f) => f.deskewMs != null);
    if (corregidos.length) {
      const deskewMedio = Math.round(
        corregidos.reduce((s, f) => s + (f.deskewMs ?? 0), 0) /
          corregidos.length,
      );
      extensionEscaneos += ` - deskew medio ${deskewMedio}ms (${corregidos.length} corregidos)`;
    }
    const paginaCompleta = escaneos.filter(
      (f) => f.quadOrigen === "pagina-completa",
    ).length;
    extensionEscaneos += ` - pagina-completa ${paginaCompleta}`;
    const porGateMarco = conteo(
      escaneos.map((f) => f.gateMarco),
      ["completo", "cortado", "no-encontrado"],
    );
    extensionEscaneos += ` - gateMarco completo ${porGateMarco["completo"]} - cortado ${porGateMarco["cortado"]} - no-encontrado ${porGateMarco["no-encontrado"]}`;
  }
  linea(
    `ESCANEOS: ENVIADAS ${escPorStatus["ENVIADA"]} - ADVERTENCIA ${escPorStatus["ADVERTENCIA"]} - RECHAZADAS ${escPorStatus["RECHAZADA"]} (motivos: ${motivosEscaneos || "ninguno"})${extensionEscaneos}`,
  );
  // KIT e63f-autoenvio-v1 (F0 — línea ADITIVA nueva, patrón ESCANEOS): por
  // qué el clasificador no dio AUTO — censo por motivo de las filas que
  // traen el balde (una acta enviada a mano TAMBIÉN fue retirada del
  // autoenvío). Solo se imprime si n > 0 — sin el balde la sección queda
  // byte-idéntica (los parsers van por prefijo, contrato D51).
  const conClasifDebil = filas.filter((f) => f.clasifDebil);
  if (conClasifDebil.length) {
    const porMotivo = conteo(
      conClasifDebil.map((f) => f.clasifDebil),
      ["puesto-lugar", "tipo", "mesa-registro", "ruta"],
    );
    linea(
      `CLASIF-DEBIL: puesto-lugar ${porMotivo["puesto-lugar"]} · tipo ${porMotivo["tipo"]} · mesa ${porMotivo["mesa-registro"]} · ruta ${porMotivo["ruta"]}`,
    );
  }
  // e63m — KIT e63m-capa0-qr-identidad-v1 (F3): post-mortem de gemelas por
  // fin posible (kit §1.3) — capa 0 identidad-QR (dedup qr) · capa 1 dhash
  // (marcada — dedup v2) · capa 2 identidad impresa (dedup identidad). Solo
  // se imprime si el instrumento corrió (alguna traza dedup — patrón
  // CLASIF-DEBIL: sin datos el txt queda byte-idéntico, contrato D57).
  const resumenCapas = resumenDedup(filas);
  if (resumenCapas.activo) {
    linea(
      // e66 (P3): capa1-dhash-marcada ahora lee `v2` (matches pasó a ser
      // MULTI-CAPA: v2+identidad+qr+ya-enviada — M-e66-2); los tokens previos
      // no cambian de forma y `capa3-ya-enviada` se AÑADE AL FINAL (contrato
      // D51: solo añadir — los parsers del dueño por prefijo intactos).
      // WAVE3 C.2: conteos de las puertas nuevas AL FINAL de la línea
      // (SIEMPRE impresos — formato estable: 0 es dato real, patrón
      // gateMarco; capa3-ya-enviada queda INTACTO).
      `DEDUP-CAPAS: capa0-qr ${resumenCapas.qr} - capa1-dhash-marcada ${resumenCapas.v2} - capa2-identidad ${resumenCapas.identidad} - capa3-ya-enviada ${resumenCapas.yaEnviada} - capa3-ya-enviada-postocr ${resumenCapas.yaEnviadaPostocr} - capa3-ya-enviada-copia ${resumenCapas.yaEnviadaCopia}`,
    );
  }
  linea();
  linea(`ACTAS (${filas.length})`);
  filas.forEach((f, i) => {
    const trozos = [
      `[${f.estado}${f.statusActa ? `/${f.statusActa}` : ""}]`,
      f.nombre,
      f.score != null ? `score ${f.score}` : null,
      f.rechazo ? `${f.rechazo.tipo}: ${f.rechazo.detalle}` : null,
      f.paginaIndex != null ? `P${f.paginaIndex}` : null,
      f.clasificacionNivel ? `nivel ${f.clasificacionNivel}` : null,
      f.lecturaNivel ? `lectura ${f.lecturaNivel}` : null,
      f.gateCompleta != null ? `gate ${f.gateCompleta ? "completa" : "incompleta"}` : null,
      f.quadOrigen ? `quad ${f.quadOrigen}` : null,
      f.tiempos ? `${f.tiempos.totalMs}ms` : null,
      f.error ? `error ${f.error}` : null,
      // D63-D — KIT e63d-informe-trazas-escaneo-v1 (T1): trazas de escaneos
      // AL FINAL de la línea (aditivo — jamás reordenar, contrato D57).
      // Honestidad del kit: sin dato NO se imprime nada (null/ausente).
      // skewGrados usa != null (un 0.0 medido es un dato real, no ausencia).
      // D63-D rev.2 (T1 — cambio de criterio): origenSenales se imprime
      // SIEMPRE que exista, TAMBIÉN con origen null — evidencia 162728: los
      // 8 escaneos reales cayeron null y sin sus señales no se calibra el
      // detector. Formato del kit: `origen null (sin-exif+borde-no-blanco+…)`.
      // Registro sin origen NI señales → nada (byte-idéntico al pre-D63-A).
      f.origen != null || f.origenSenales != null
        ? `origen ${f.origen ?? "null"}${f.origenSenales ? ` (${f.origenSenales})` : ""}`
        : null,
      f.skewGrados != null ? `skewGrados ${f.skewGrados}` : null,
      f.gateMarco != null ? `gateMarco ${f.gateMarco}` : null,
      // D65 (T1.4/T2.3) — trazas del watchdog y del dedup v2 AL FINAL de la
      // línea (aditivo — jamás reordenar, contrato D57). Sin dato NO se
      // imprime nada (null/ausente — honestidad del kit).
      f.watchdog != null ? `watchdog ${f.watchdog}` : null,
      f.etapaAlMorir != null ? `etapaAlMorir ${f.etapaAlMorir}` : null,
      f.elapsedMs != null ? `elapsedMs ${f.elapsedMs}` : null,
      f.dedup != null ? `dedup ${f.dedup}` : null,
      f.dedupDistancia != null ? `dedupDistancia ${f.dedupDistancia}` : null,
      // e63k (F1.5) — serie impresa AL FINAL de la línea (aditivo — jamás
      // reordenar, contrato D57). Sin dato NO se imprime nada (honesto).
      f.serie != null ? `serie ${f.serie}` : null,
      // e63m (F3) — columna dedupQr AL FINAL de la línea (aditivo — jamás
      // reordenar, contrato D57). WAVE3 C.4: primeros 24 chars + «…»
      // (el corte 8 colisionaba entre actas distintas), «—» si null (la
      // columna SIEMPRE aparece).
      `dedupQr ${f.qrPayload != null ? qrCortoInforme(f.qrPayload) : "—"}`,
      // WAVE3 C.3 (obs-informe-wave3-v1) — TODO ERROR es visible (aditivo
      // AL FINAL de la línea, D51): con motivo → entre comillas; sin motivo
      // (registro pre-wave3) → la AUSENCIA es visible, jamás inventada.
      // El chunk histórico `error X` de la mitad queda INTACTO (parsers por
      // prefijo — solo añadir).
      f.estado === "ERROR"
        ? f.error
          ? `error "${f.error}"`
          : "error (sin motivo — registro pre-wave3)"
        : null,
    ].filter((t): t is string => t != null);
    linea(`${i + 1}. ${trozos.join(" - ")}`);
  });
  // ANEXO AGENTE C (Tarea 1) — desglose de TIEMPOS POR ACTA (formato puro:
  // solo campos ya existentes). ENVIADAS primero (por totalMs desc), luego
  // DUPLICADAS (por esperaMs desc), resto al final (orden estable). Los 3
  // más lentos de CADA etapa se marcan con sufijo «<<» (saltan a la vista).
  linea();
  linea(
    "TIEMPOS POR ACTA (id | status | decode | espera | probe | OCR | total | dedup | ahorro) — << = 3 más lentos de la etapa",
  );
  const etapasAnexo: EtapaInforme[] = ["decode", "espera", "probe", "ocr", "total"];
  const marcadosLentos = new Set<string>();
  for (const etapa of etapasAnexo) {
    const conDato = filas
      .filter((f) => valorEtapa(f, etapa) != null)
      .sort((a, b) => (valorEtapa(b, etapa) ?? 0) - (valorEtapa(a, etapa) ?? 0));
    for (const f of conDato.slice(0, 3)) marcadosLentos.add(f.id);
  }
  const ordenAnexo = [
    ...filas
      .filter((f) => f.statusActa === "ENVIADA")
      .sort((a, b) => (b.tiempos?.totalMs ?? 0) - (a.tiempos?.totalMs ?? 0)),
    ...filas
      .filter((f) => f.statusActa === "DUPLICADA")
      .sort((a, b) => (b.tiempos?.esperaMs ?? 0) - (a.tiempos?.esperaMs ?? 0)),
    ...filas.filter((f) => f.statusActa !== "ENVIADA" && f.statusActa !== "DUPLICADA"),
  ];
  for (const f of ordenAnexo) {
    const celda = (v: number | null) => (v != null ? `${v}` : "-");
    linea(
      `${f.id.slice(0, 8)} ${f.statusActa ?? f.estado} decode ${celda(valorEtapa(f, "decode"))} espera ${celda(valorEtapa(f, "espera"))} probe ${celda(valorEtapa(f, "probe"))} OCR ${celda(valorEtapa(f, "ocr"))} total ${celda(valorEtapa(f, "total"))} dedup ${f.dedup ?? "-"}${f.ahorroMs != null ? ` ahorro ${f.ahorroMs}` : ""}${marcadosLentos.has(f.id) ? " <<" : ""}`,
    );
  }
  if (recortado) {
    linea();
    linea(
      `IMAGENES RECORTADAS A LAS ${TOPE_ACTAS_CON_IMAGEN} ACTAS-PROBLEMA MAS RECIENTES (${sinImagen.length} sin imagenes):`,
    );
    for (const id of sinImagen) linea(`- ${id}`);
  }
  linea();
  linea("Limitacion: la fuente es la cola MASIVA - las actas del flujo");
  linea("individual no persisten y no aparecen aqui.");
  return `${L.join("\n")}\n`;
}

// ---------- Punto de entrada ----------

/**
 * Construir el ZIP del informe (T1). La descarga la hace la UI con
 * downloadBlob (core) — aquí SOLO se construye. Lanza COLA_VACIA si la cola
 * no tiene registros (la UI la trata con el botón deshabilitado).
 */
/** e68-blob-idb-v1 (Paso 4): uso REAL de IndexedDB reportado por el
 *  navegador (navigator.storage.estimate) en MB con 1 decimal. null cuando
 *  el navegador no lo expone (Safari viejo, contexto no seguro) — jamás
 *  inventar. Best-effort: cualquier fallo → null.
 *  e71 (P9): fórmula en forma LITERAL del kit — bytes / 1e6 = MB, redondeo a
 *  1 decimal. AUDITORÍA honesta: la forma previa (Math.round(idb / 1e5) / 10)
 *  ya era matemáticamente idéntica (idb/1e6) — el 330 MB observado por el
 *  dueño NO era un multiplicador erróneo sino el uso REAL que Chrome reporta
 *  en usageDetails.indexedDB (LevelDB nunca encoge: páginas muertas de los
 *  re-writes de registros — migración e68 reescribe cada registro — hasta la
 *  próxima compactación). La fórmula queda explícita para auditoría a la
 *  vista; el número que reporta es el uso EN DISCO del origen, no el dato
 *  vivo (nota para el dueño en REPORTE-e71 §P9). */
async function almacenamientoIdbMb(): Promise<number | null> {
  try {
    const estimacion = await navigator.storage?.estimate?.();
    // usageDetails NO está en el lib.dom de este TS — acceso tipado local
    // (Record<string, number>; la llave indexedDB es la de Chrome/Edge).
    const detalles = (estimacion as { usageDetails?: Record<string, number> })
      ?.usageDetails;
    const idb = detalles?.indexedDB;
    return typeof idb === "number" ? Math.round((idb / 1e6) * 10) / 10 : null;
  } catch {
    return null;
  }
}

export async function generarInformeZip(
  onProgreso?: (p: ProgresoInforme) => void,
): Promise<InformeZip> {
  // T1.1 — fuente de datos: la cola masiva. FIX C6 (auditoría 2-c): el mapa
  // liviano sale del MAPPER DENTRO del cursor — los registros completos
  // (acta con dataURLs de ~7-14 MB c/u) JAMÁS se materializan todos a la
  // vez (el listado anterior hacía pico de >1 GB en jornadas reales).
  // Después leerRegistro(id) UNO A LA VEZ (nunca Promise.all).
  const filas = await listarMapeados(filaLiviana);
  if (!filas.length) throw new Error("COLA_VACIA");

  // T1.6 — tope: estimar imágenes de carpetas ANTES de compilar. Si pasa
  // 250 MB → solo las 50 actas-problema más recientes llevan imágenes.
  const candidatas = filas.filter((f) => f.conCarpeta);
  const pesoTotal = candidatas.reduce((n, f) => n + f.pesoImagenes, 0);
  const recortado = pesoTotal > TOPE_IMAGENES_BYTES;
  const conImagen = new Set<string>(candidatas.map((f) => f.id));
  let sinImagen: string[] = [];
  if (recortado) {
    const ordenadas = [...candidatas].sort((a, b) => b.agregadaEn - a.agregadaEn);
    conImagen.clear();
    for (const f of ordenadas.slice(0, TOPE_ACTAS_CON_IMAGEN)) conImagen.add(f.id);
    sinImagen = ordenadas.slice(TOPE_ACTAS_CON_IMAGEN).map((f) => f.id);
  }

  // T1.2 — informe.json (global, SIN imágenes — prohibido §6).
  const generado = new Date().toISOString();
  // WAVE2 C3 — ANEXO2: entorno + tier (campos AUSENTES si no hubo dato —
  // informes previos no cambian de forma, D57 append-only).
  const entorno: EntornoInforme = {
    ...entornoInforme(),
    ...(await tierDelEntorno()),
  };
  const porEstadoFila = conteo(
    filas.map((f) => f.estado),
    ["PENDIENTE", "PROCESANDO", "LISTA", "ERROR"],
  );
  const porStatusActa = conteo(
    filas.map((f) => f.statusActa),
    // e66 (P2): "DUPLICADA" AL FINAL (JSON estable — claves fijas a 0) — las
    // gemelas reutilizadas ya no inflan ENVIADA (D-e66-1).
    ["ENVIADA", "OPTIMA", "ADVERTENCIA", "RECHAZADA", "EN_REVISION_HUMANA", "DUPLICADA"],
  );
  const tiemposMedios = mediosTiempos(filas);
  // ANEXO Agente C (Tarea 2) — ahorro de duplicadas calculado sobre el LOTE
  // completo y aplicado a las filas (ahorroMs por acta — JSON y txt).
  const ahorros = ahorrosDedup(filas);
  const filasConAhorro = filas.map((f) =>
    ahorros.porActa[f.id] != null ? { ...f, ahorroMs: ahorros.porActa[f.id] } : f,
  );
  const informe = {
    generado,
    fuente: "cola-masiva" as const,
    entorno,
    totales: {
      actas: filas.length,
      porEstadoFila,
      porStatusActa,
      tiemposMediosMs: tiemposMedios,
      // e71 (P3.1) — yaEnviadas ahora cuenta las actas con desenlace ENVIADA
      // (auto OPTIMA o envío manual) de ESTA cola — el dueño la lee como
      // «actas enviadas» y reportaba 0: el estado YA-ENVIADA (dedup contra
      // el ledger, e65) solo existe en re-subidas de la misma sesión y NO es
      // el significado que el reporte necesita. porStatusActa.ENVIADA sigue
      // siendo el censo completo por status (intacto); este contador queda
      // como atajo honesto = porStatusActa.ENVIADA.
      yaEnviadas: filas.filter((f) => f.statusActa === "ENVIADA").length,
      // e68-blob-idb-v1 (Paso 4 — observabilidad, ADITIVO AL FINAL): uso
      // REAL de IndexedDB en MB (navegador — estimate). null = no expuesto
      // (jamás inventar). Base de comparación del criterio «IDB ~40 % menos»
      // del kit (antes/después con el MISMO lote).
      almacenamientoMB: await almacenamientoIdbMb(),
      // Kit C/ANEXO (REPARTE-3-AGENTES-v1) — percentiles + throughput
      // (ADITIVOS AL FINAL de totales: informes previos no cambian de forma).
      tiemposPercentilesMs: percentilesTiempos(filas),
      throughput: throughputEnviadas(filas),
    },
    rechazos: {
      porTipo: conteo(
        filas.flatMap((f) => (f.rechazo ? [f.rechazo.tipo] : [])),
      ),
      porDetalle: conteo(
        filas.flatMap((f) => (f.rechazo ? [f.rechazo.detalle] : [])),
      ),
    },
    deteccion: conteo(
      filas.filter((f) => f.tieneDiagnostico).map((f) => f.quadOrigen ?? "null"),
      ["worker", "sobel", "null"],
    ),
    // D65 — KIT e14-progreso-watchdog-dedup-v1 (T4): resumen machine-readable
    // de las secciones nuevas del txt (claves ADITIVAS al final — informe.json
    // estable; ceros = dato real, no invención).
    colgadas: (() => {
      const r = resumenColgadas(filas);
      return {
        total: r.total,
        salvadasPorReintento: r.salvadas,
        porEtapa: r.porEtapa,
      };
    })(),
    dedup: (() => {
      const r = resumenDedup(filas);
      return {
        version: "v2" as const,
        activo: r.activo,
        matches: r.matches, // e66 (P3): TODAS las capas (v2+identidad+qr+ya-enviada)
        v2: r.v2, // e66 — desglose aditivo (lo que matches era antes)
        sinMatch: r.sinMatch,
        distanciaMedia: r.distanciaMedia,
        identidad: r.identidad, // e63k — capa 2 por identidad (aditivo al final)
        qr: r.qr, // e63m — capa 0 identidad-QR pre-OCR (aditivo al final)
        yaEnviada: r.yaEnviada, // e66 — capa e65 contra el histórico (aditivo al final)
        yaEnviadaPostocr: r.yaEnviadaPostocr, // WAVE3 C.2 — puerta H1 post-OCR (aditivo al final)
        yaEnviadaCopia: r.yaEnviadaCopia, // WAVE3 C.2 — puerta traza-sobre-veto (aditivo al final)
        qrSondeo: r.qrSondeo, // KIT e73 — sondeo QR en ingesta (aditivo al final)
        // ANEXO Agente C (Tarea 2) — ahorro de las duplicadas (ADITIVO AL
        // FINAL: null si ninguna copia aportó dato — jamás inventar).
        ahorroTotalMs: ahorros.ahorroTotalMs,
        ahorroEquivalenteActas: ahorros.ahorroEquivalenteActas,
      };
    })(),
    actas: filasConAhorro.map(actaLivianaJson),
    ...(recortado
      ? { imagenesRecortadasA: TOPE_ACTAS_CON_IMAGEN, actasSinImagen: sinImagen }
      : {}),
  };
  const codificador = new TextEncoder();
  const contenidos: Record<string, Uint8Array> = {
    "informe.json": codificador.encode(JSON.stringify(informe, null, 2)),
    "informe.txt": codificador.encode(
      renderTxt(
        generado,
        entorno,
        filasConAhorro,
        porEstadoFila,
        porStatusActa,
        tiemposMedios,
        recortado,
        sinImagen,
      ),
    ),
  };

  // T1.3/T1.4 — carpetas: leerRegistro UNO A LA VEZ; la referencia del
  // registro muere con cada iteración (RAM acotada). Las ÓPTIMA/ENVIADA y
  // las recortadas por el tope NO materializan carpeta.
  // FIX M11 (auditoría 2-c): leerRegistro SOLO para filas con carpeta —
  // antes deserializaba el registro completo (acta enorme incluida) de
  // TODAS las filas, incluidas las que no aportan nada al ZIP.
  const usados = new Set<string>();
  let carpetas = 0;
  let actual = 0;
  for (const fila of filas) {
    if (fila.conCarpeta && conImagen.has(fila.id)) {
      const reg = await leerRegistro(fila.id);
      const ruta = `actas/${nombreCarpeta(fila, usados)}`;
      if (fila.estado === "ERROR") {
        // ERROR de pipeline: el Blob original + ficha mínima (sin acta).
        if (reg.archivo) {
          contenidos[`${ruta}/original.${fila.extArchivo}`] = new Uint8Array(
            await reg.archivo.arrayBuffer(),
          );
        }
        contenidos[`${ruta}/ficha.json`] = codificador.encode(
          JSON.stringify(
            {
              id: reg.id,
              nombre: reg.nombre,
              estado: reg.estado,
              error: reg.error ?? null,
            },
            null,
            2,
          ),
        );
      } else if (reg.acta) {
        // LISTA problema: original/procesada byte-idénticos + ficha COMPLETA
        // menos fotos (diagnóstico incluido — el corazón del análisis).
        const acta = reg.acta;
        if (acta.fotoOriginal) {
          contenidos[`${ruta}/original.jpg`] = dataUrlABytes(acta.fotoOriginal);
        }
        if (acta.fotoProcesada) {
          contenidos[`${ruta}/procesada.jpg`] = dataUrlABytes(
            acta.fotoProcesada,
          );
        }
        const ficha: Record<string, unknown> = {
          ...acta,
          nombreFila: reg.nombre,
          agregadaEn: reg.agregadaEn,
          // D66 — KIT e14-decode-unico-precalor-v1 (T4): trazas de
          // decodificación del REGISTRO (aditivas AL FINAL de la ficha —
          // campos AUSENTES si no hubo master; jamás inventar).
          ...(reg.decodeMs != null ? { decodeMs: reg.decodeMs } : {}),
          ...(reg.origenDecode != null ? { origenDecode: reg.origenDecode } : {}),
          ...(reg.precalentada === true ? { precalentada: true } : {}),
          ...(reg.precalorMs != null ? { precalorMs: reg.precalorMs } : {}),
        };
        delete ficha.fotoOriginal;
        delete ficha.fotoProcesada;
        contenidos[`${ruta}/ficha.json`] = codificador.encode(
          JSON.stringify(ficha, null, 2),
        );
      }
      carpetas += 1;
    }
    actual += 1;
    onProgreso?.({ fase: "LEYENDO", actual, total: filas.length });
  }

  // T1.5 — zip() ASYNC con STORE { level: 0 }: no bloquea el hilo de la UI
  // y NO re-comprime JPEGs ya comprimidos (receta d57e538).
  onProgreso?.({ fase: "EMPAQUETANDO", actual: 0, total: 1 });
  const { zip } = await import("fflate");
  const empaquetado = await new Promise<Uint8Array>((resolve, reject) => {
    zip(contenidos, { level: 0 }, (err, datos) =>
      err ? reject(err) : resolve(datos),
    );
  });

  const ahora = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  const sello = `${ahora.getFullYear()}${p2(ahora.getMonth() + 1)}${p2(
    ahora.getDate(),
  )}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}${p2(ahora.getSeconds())}`;
  // TS 5.7 estricto (mismo pitfall resuelto en archivos.ts): fflate aloca su
  // propio ArrayBuffer (byteOffset 0) — el cast declara lo que ya es cierto.
  const blob = new Blob([empaquetado as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
  return {
    blob,
    nombre: `e14-informe-${sello}.zip`,
    resumen: {
      generado,
      totalActas: filas.length,
      carpetas,
      porEstadoFila,
      porStatusActa,
      tiemposMediosMs: tiemposMedios,
      imagenesRecortadasA: recortado ? TOPE_ACTAS_CON_IMAGEN : null,
      actasSinImagen: sinImagen,
      pesoZipBytes: empaquetado.length,
    },
  };
}
