/**
 * KIT e14-rastreo-tiempos-v1 — contratos del rastreo de tiempos de
 * digitalización. SOLO tipos + constantes: cero lógica runtime.
 *
 * QUÉ MIDE (el ciclo real de un usuario normal, sin tocar el pipeline):
 *  · UNIDAD DE DIGITALIZACIÓN («acta con reintentos»): desde que el
 *    operador dispara la captura hasta el desenlace terminal (enviada,
 *    escalada o dejada pendiente) — incluye re-escaneos del MISMO hueco.
 *  · FASES: pipeline (captura→resuelto, con decode/detect/ocr/calidad del
 *    diagnóstico REAL del bridge) + revisión (llega a REVISIÓN→decisión).
 *  · NAVEGACIÓN: tiempo de permanencia por vista (cómo se usa la app).
 *  · SESIÓN: todo lo anterior con inicio/fin y throughput (actas/hora).
 *
 * PRIVACIDAD (mismo espíritu D1/D4 de obs): ids con HASH (fnv1a8 — jamás
 * el id plano), SIN fotos, SIN OCR, SIN título/mesa/puesto — solo tiempos,
 * estados y contadores. Nada sale del dispositivo sin descarga manual.
 */

/** Fuente observada (espejo de FuenteCaptura + N/D honesto). */
export type FuenteRastreo = "CAMARA" | "ARCHIVO" | "SIMULACION" | "N/D";

/** Tiempos INTERNOS del pipeline (los del diagnóstico REAL del bridge —
 *  DiagnosticoActa.tiempos). null = el intento no dejó ese dato. */
export interface TiemposPipeline {
  decodeMs: number | null;
  detectMs: number | null;
  calidadMs: number | null;
  ocrMs: number | null;
  procesoMs: number | null;
  totalMs: number | null;
  envioMs: number | null;
}

/** Una UNIDAD de digitalización: ciclo(s) de captura de UN hueco de mesa,
 *  con reintentos incluidos, cerrado por desenlace terminal o navegación. */
export interface UnidadRastreo {
  /** fnv1a8 del id de la PRIMERA acta del ciclo (privacidad — JAMÁS plano). */
  idHash: string;
  fuente: FuenteRastreo;
  intentos: number;
  /** Último desenlace observado (status del acta al cerrar). */
  statusFinal: string;
  enviada: boolean;
  /** true = se envió sin pasar por revisión humana (auto-envío ÓPTIMA). */
  autoEnvio: boolean;
  /** Pared captura→resuelto del ÚLTIMO intento (ms, monotónico). */
  pipelineMs: number | null;
  /** REVISIÓN→decisión (ms). null = nunca hubo revisión (auto-envío). */
  revisionMs: number | null;
  /** Pared total de la unidad: tsFin − tsInicio (reintentos incluidos). */
  totalMs: number | null;
  scoreFinal: number | null;
  /** Desglose interno del último intento (diagnóstico del bridge). */
  pipelineInterno: TiemposPipeline | null;
  /** Desenlace de cada intento, en orden ("RECHAZADA","ENVIADA",…). */
  statusPorIntento: string[];
  /** maxIntentos del ciclo (4 — para saber si una EN_RH aún puede repetir). */
  maxIntentos: number;
  tsInicio: number;
  tsFin: number | null;
  /** true = acta de los chips TEST SCORES (fuente SIMULACION) — se reporta
   *  SEPARADA y JAMÁS entra en los agregados de tiempos reales. */
  sim: boolean;
}

/** Evento puntual de la línea de tiempo de la sesión. */
export interface EventoRastreo {
  /** epoch ms. */
  t: number;
  tipo:
    | "sesion"
    | "captura"
    | "desenlace"
    | "envio"
    | "rescaneo"
    | "revision-humana"
    | "archivo-mesa"
    | "navegacion"
    | "sim";
  detalle: string;
  /** Duración medida por el evento (ms) — null cuando no aplica. */
  ms: number | null;
}

/** Permanencia por vista (cómo se mueve el operador por la app). */
export interface NavegacionRastreo {
  vista: string;
  ms: number;
  visitas: number;
}

/** Sesión de rastreo: una «prueba» completa activada desde el panel. */
export interface SesionRastreo {
  version: 1;
  id: string;
  /** epoch ms. */
  inicio: number;
  fin: number | null;
  activa: boolean;
  /** Unidades cerradas (tope 300 — las más recientes). */
  actas: UnidadRastreo[];
  navegacion: Record<string, NavegacionRastreo>;
  /** Línea de tiempo (tope 500 — las más recientes). */
  eventos: EventoRastreo[];
  /** true si en algún momento de la sesión hubo SIM encendido (contexto). */
  conSim: boolean;
}

/** Persistencia (localStorage e14-rastreo-v1): sesión activa + cerradas. */
export interface HistorialRastreo {
  version: 1;
  activa: SesionRastreo | null;
  /** Últimas 10 sesiones cerradas (la más reciente primero). */
  cerradas: SesionRastreo[];
}

export const CLAVE_RASTREO = "e14-rastreo-v1";
export const CAP_ACTAS = 300;
export const CAP_EVENTOS = 500;
export const CAP_SESIONES = 10;

/** Metas orientativas del informe (referencia de campo — NO son gates:
 *  jamás bloquean nada, solo etiquetan en el informe). Valores elegidos
 *  con el perfil MEDIO del kit adaptacion (OCR caliente ~8-35 s). */
export const METAS = {
  /** Acta total (captura→enviada) considerada fluida. */
  actaTotalMs: 90_000,
  /** Pipeline (captura→resuelto) considerado fluido. */
  pipelineMs: 45_000,
} as const;
