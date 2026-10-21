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
export interface EntornoInforme {
  userAgent: string;
  idioma: string;
  nucleos: number | null;
  memoriaGB: number | null;
  crossOriginIsolated: boolean;
  url: string;
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
   *  previos a D63-C) — jamás inventar. */
  gateMarco: "completo" | "cortado" | "no-encontrado" | null;
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
   *  "sin-match" = hasheada sin gemela. null = pre-D65 o hash falló. */
  dedup: "v2" | "sin-match" | null;
  /** (T2) distancia de Hamming del match v2 (0–64); null = sin match. */
  dedupDistancia: number | null;
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
}

/** Resumen para la UI (T2) — espejo de lo importante del informe.json. */
export interface ResumenInforme {
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
export interface ProgresoInforme {
  fase: "LEYENDO" | "EMPAQUETANDO";
  actual: number;
  total: number;
}

export interface InformeZip {
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
            4,
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
    tieneDiagnostico: !!diag,
    conCarpeta,
    pesoImagenes,
    extArchivo: extensionDe(reg),
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

/** D65 (T4.2) — resumen de COLGADAS (PURO — humo bun): n = filas con
 *  watchdog ≥ 1 (al menos un intento murió); salvadas = de esas, las cuyo
 *  desenlace final NO es el rechazo-timeout (el reintento las rescató);
 *  porEtapa = conteo de etapaAlMorir (buckets fijos a 0 + "sin-senal").
 *  Registros pre-D65 (watchdog null) no cuentan — el instrumento no existía. */
export function resumenColgadas(filas: FilaInforme[]): {
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
 *  del dedup (el instrumento corrió en esta cola). matches = filas marcadas
 *  gemela por contenido — incluye las que el dueño luego reprocesó con
 *  PROCESAR IGUAL (el match SÍ ocurrió); distancia media SOLO sobre matches
 *  con distancia (sin datos → null — jamás inventar). */
export function resumenDedup(filas: FilaInforme[]): {
  activo: boolean;
  matches: number;
  distanciaMedia: number | null;
  sinMatch: number;
} {
  const matches = filas.filter((f) => f.dedup === "v2");
  const distancias = matches
    .map((f) => f.dedupDistancia)
    .filter((v): v is number => typeof v === "number");
  return {
    activo: filas.some((f) => f.dedup != null),
    matches: matches.length,
    distanciaMedia: distancias.length
      ? Math.round(distancias.reduce((a, b) => a + b, 0) / distancias.length)
      : null,
    sinMatch: filas.filter((f) => f.dedup === "sin-match").length,
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
  const decodeValores = filas
    .map((f) => f.decodeMs)
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
  const outliersProceso = filas.filter(
    (f) => (f.tiempos?.procesoMs ?? 0) > 6000,
  ).length;
  linea(`Outliers procesoMs >6s: ${outliersProceso}`);
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
    ["ENVIADA", "OPTIMA", "ADVERTENCIA", "RECHAZADA", "EN_REVISION_HUMANA"],
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
    ].filter((t): t is string => t != null);
    linea(`${i + 1}. ${trozos.join(" - ")}`);
  });
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
  const entorno = entornoInforme();
  const porEstadoFila = conteo(
    filas.map((f) => f.estado),
    ["PENDIENTE", "PROCESANDO", "LISTA", "ERROR"],
  );
  const porStatusActa = conteo(
    filas.map((f) => f.statusActa),
    ["ENVIADA", "OPTIMA", "ADVERTENCIA", "RECHAZADA", "EN_REVISION_HUMANA"],
  );
  const tiemposMedios = mediosTiempos(filas);
  const informe = {
    generado,
    fuente: "cola-masiva" as const,
    entorno,
    totales: {
      actas: filas.length,
      porEstadoFila,
      porStatusActa,
      tiemposMediosMs: tiemposMedios,
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
        matches: r.matches,
        sinMatch: r.sinMatch,
        distanciaMedia: r.distanciaMedia,
      };
    })(),
    actas: filas.map(actaLivianaJson),
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
        filas,
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
