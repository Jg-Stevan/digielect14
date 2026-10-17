/**
 * telemetria.ts — INFORME-TELEMETRÍA v1 (SPEC-informe-telemetria-ocr-v1 §4.1)
 *
 * Colector de la bitácora del informe + registro del pipeline E-14 + store
 * zustand de estado. TODO es observación: el informe jamás modifica el
 * pipeline, el gate, el score ni las pantallas (contrato §1 del SPEC).
 *
 * Consumidores:
 *  · scanner-core-bridge.ts  → registrarPipelineE14() (gancho §6.1, try/catch)
 *  · store.ts (dispararEscaneo) → iniciarInformeCaptura() (gancho §6.2)
 *  · informe/iniciar.ts, informe/matriz.ts, informe/generar.ts
 *  · components/e14/InformeDescarga.tsx (píldora, §4.9)
 */
import { create } from "zustand";

// ─── Tipos (fuente de verdad del informe) ───────────────────────────────────

export interface EventoInforme {
  /** performance.now() relativo al arranque del módulo (ms). */
  tMs: number;
  /** HH:MM:SS local. */
  hora: string;
  tipo: string;
  detalle: string;
}

export interface PipelineInfo {
  registrado: boolean;
  fuente: "SIMULACION" | "CAMARA" | "ARCHIVO";
  /** true = la entrada fue File (IMPORTAR) vs video-grab/dataUrl (SIM/CÁMARA). */
  entradaArchivo: boolean;
  ms: {
    decode: number;
    detect: number;
    proceso: number;
    calidad: number;
    ocr: number;
    total: number;
  };
  quad: { x: number; y: number }[] | null;
  /** asset SIM as-is (quad identidad). */
  sinRecorte: boolean;
  /** InfoCrop §S.1.5 del bridge (bbox del quad +3%, fallback al frame). */
  cropInfo: { w: number; h: number; fallback: boolean } | null;
  calidad: { sharpness: number; brightness: number; contrast: number; level: string } | null;
  /** contrasteEfectivoDe(calidad, ocrLegible) — piso §X = 80. */
  contEfectivo: number | null;
  /** "bw"/"original" — el filtro con el que se procesó. */
  filtroActa: string;
  /** KIT e14-ocr-lee-original-v1 (PROD-1 §4.4): filtro de la ENTRADA del OCR —
   *  "original" (crudo del warp) | "original-as-is" (SIM) | "bw-fallback"
   *  (la variante falló y el OCR leyó la bw). NO confundir con filtroActa:
   *  ese describe la IMAGEN mostrada/guardada (pitfall §9.8 del kit). */
  ocrInputFiltro: string;
  /** "worker"/"canvas"/"mock". */
  motor: string;
  /** KIT e14-motor-rapidocr-v1 (PROD-2 §4.2): motor del OCR de producción —
   *  "rapidocr-v4" (el instrumento del informe sigue midiendo "actual" =
   *  Tesseract 1600 vía requestOcr del core — matriz CONGELADA). */
  ocrMotor: string;
  /** KIT e14-motor-rapidocr-v1 (PROD-2 §4.2): conf media del OCR de
   *  producción (0-1, CTC decode del rec) — null si no hay dato. */
  ocrConf: number | null;
  ocrChars: number;
  ocrValido: boolean;
  completa: boolean | null;
  sospecha: string;
  tintaFilo: boolean;
  densidades: number[];
  fondo: boolean;
  procesadaVacia: boolean;
  votosDensidadPct: number;
  votosSkipPag2: boolean;
  votosOk: boolean;
  recortada: boolean;
  senalActa: boolean;
  scoreFinal: number;
  simular: boolean;
  scoreSimulado: number | null;
  status: string;
  rechazo: { tipo: string; detalle: string } | null;
}

// ─── Bitácora + pipeline registrado (estado de módulo, sin imágenes) ────────

const t0 = typeof performance !== "undefined" ? performance.now() : 0;
let eventos: EventoInforme[] = [];
let ultimoPipeline: PipelineInfo | null = null;

function horaLocal(date = new Date()): string {
  return date.toLocaleTimeString("es-CO", { hour12: false });
}

/** Registra un movimiento en la bitácora del informe (tMs relativo al
 *  arranque del módulo). Nunca lanza. */
export function evento(tipo: string, detalle: string): void {
  try {
    eventos.push({
      tMs: Math.round(performance.now() - t0),
      hora: horaLocal(),
      tipo,
      detalle,
    });
  } catch {
    /* la bitácora jamás rompe nada */
  }
}

/** Reinicia la bitácora (arranca un informe nuevo — gana la última captura). */
export function reiniciarEventos(): void {
  eventos = [];
}

export function tomarEventos(): EventoInforme[] {
  return eventos;
}

/** Registra las medidas exactas del pipeline (llamada SOLO desde el puente,
 *  §6.1 del SPEC — envuelta en try/catch por el llamador). */
export function registrarPipelineE14(p: PipelineInfo): void {
  ultimoPipeline = p;
  evento(
    "pipeline/registrado",
    `fuente=${p.fuente} ms.total=${Math.round(p.ms.total)} score=${p.scoreFinal} status=${p.status}`,
  );
}

/** Último pipeline registrado (null si la captura salió antes del registro). */
export function tomarUltimoPipeline(): PipelineInfo | null {
  return ultimoPipeline;
}

/** Marca el pipeline como NO registrado (salida temprana del pipeline:
 *  timeout/ILEGIBLE sin quad — AC-3 del SPEC). */
export function marcarPipelineNoRegistrado(motivo: string): void {
  ultimoPipeline = {
    registrado: false,
    fuente: "CAMARA",
    entradaArchivo: false,
    ms: { decode: 0, detect: 0, proceso: 0, calidad: 0, ocr: 0, total: 0 },
    quad: null,
    sinRecorte: false,
    cropInfo: null,
    calidad: null,
    contEfectivo: null,
    filtroActa: "",
    ocrInputFiltro: "",
    motor: "",
    ocrMotor: "",
    ocrConf: null,
    ocrChars: 0,
    ocrValido: false,
    completa: null,
    sospecha: "",
    tintaFilo: false,
    densidades: [],
    fondo: false,
    procesadaVacia: false,
    votosDensidadPct: 0,
    votosSkipPag2: false,
    votosOk: false,
    recortada: false,
    senalActa: false,
    scoreFinal: 0,
    simular: false,
    scoreSimulado: null,
    status: motivo,
    rechazo: { tipo: "NO_REGISTRADO", detalle: motivo },
  };
}

// ─── Entorno ────────────────────────────────────────────────────────────────

export interface InfoDispositivo {
  userAgent: string;
  plataforma: string;
  nucleos: number | null;
  memoriaGB: number | null;
  red: { tipo: string; downlinkMbps: number | null; rttMs: number | null } | null;
  pantalla: string;
  idioma: string;
  zonaHoraria: string;
  webgpu: boolean;
}

/** Entorno del dispositivo (§4.1) — sin datos personales más allá del UA. */
export function infoDispositivo(): InfoDispositivo {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  };
  const conn = nav.connection;
  return {
    userAgent: nav.userAgent,
    plataforma: (nav as Navigator & { platform?: string }).platform ?? "",
    nucleos: nav.hardwareConcurrency ?? null,
    memoriaGB: nav.deviceMemory ?? null,
    red: conn
      ? {
          tipo: conn.effectiveType ?? "",
          downlinkMbps: conn.downlink ?? null,
          rttMs: conn.rtt ?? null,
        }
      : null,
    pantalla: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
    idioma: nav.language,
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webgpu: "gpu" in navigator,
  };
}

/** Hora Bogotá para encabezados (convención del repo). */
export function horaBogota(date = new Date()): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

/** Nombre de archivo con hora Bogotá: informe-e14-YYYYMMDD-HHMMSS. */
export function nombreArchivoInforme(ext: string): string {
  const fmt = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const fecha = `${p.year}${p.month}${p.day}`;
  const hora = `${p.hour}${p.minute}${p.second}`;
  return `informe-e14-${fecha}-${hora}.${ext}`;
}

// ─── Descarga ───────────────────────────────────────────────────────────────

/** Descarga un Blob con <a download> (patrón estándar del navegador). */
export function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke diferido: algunos navegadores aún leen el blob en el click handler
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─── Blobs del informe actual (memoria pequeña — nunca imágenes, AC-7) ──────

const blobsInforme: {
  txt: { blob: Blob; nombre: string } | null;
  json: { blob: Blob; nombre: string } | null;
} = { txt: null, json: null };

export function guardarBlobsInforme(
  txt: { blob: Blob; nombre: string },
  json: { blob: Blob; nombre: string },
): void {
  blobsInforme.txt = txt;
  blobsInforme.json = json;
}

export function limpiarBlobsInforme(): void {
  blobsInforme.txt = null;
  blobsInforme.json = null;
}

/** Lee el texto del blob del informe actual (QA/tests — sin tocar la UI). */
export async function leerInforme(tipo: "txt" | "json"): Promise<string | null> {
  const item = blobsInforme[tipo];
  if (!item) return null;
  return await item.blob.text();
}

function descargarInformeInterno(tipo: "txt" | "json"): void {
  const item = blobsInforme[tipo];
  if (!item) return;
  descargarBlob(item.blob, item.nombre);
}

// ─── Store zustand (solo estado visible de la píldora) ──────────────────────

export interface InformeStoreState {
  estado: "inactivo" | "procesando" | "listo" | "error";
  nombreBase: string | null;
  error: string | null;
  /** Descarga el blob ya armado (TXT o JSON) — §4.7 del SPEC. */
  descargarInforme: (tipo: "txt" | "json") => void;
}

export const informeStore = create<InformeStoreState>(() => ({
  estado: "inactivo",
  nombreBase: null,
  error: null,
  descargarInforme: descargarInformeInterno,
}));
