/**
 * KIT e14-observabilidad-v1 — contratos del módulo obs.
 * SOLO tipos: cero lógica runtime. Fuente de verdad: README-KITS.md §4.
 */
export type TipoEvento = "error" | "warn" | "perf" | "salud" | "uso" | "hang"; // ANEXO Agente C: "hang" NUEVO AL FINAL (contrato D57: append-only)
export type Tier = "ALTO" | "MEDIO" | "BAJO";

export interface Breadcrumb {
  t: number; // epoch ms
  tipo: "click" | "vista" | "cola" | "store" | "red";
  detalle: string; // aria-label / data-accion / transición — SIN contenido de actas
}

export interface ErrorEvento {
  mensaje: string; // truncado 500
  stack: string; // truncado 2000
  tipo: string; // constructor del error
  archivo: string | null; // primer frame del stack dentro de src/
  digest: string; // FNV-1a 8 hex (digestDe)
  breadcrumbs: Breadcrumb[]; // últimos 30 al momento del fallo
}

export interface PerfActa {
  actaIdHash: string; // FNV-1a — JAMÁS el id plano
  status: string;
  intento: number;
  tiempos: Record<string, number>;
  scoreVisual: number;
  scoreFinal: number;
  gate: string;
  ocrValido: boolean;
}

export interface SaludSnapshot {
  memoriaMB: number | null; // performance.memory?.usedJSHeapSize / 1048576
  nucleos: number;
  memoriaGB: number | null; // navigator.deviceMemory (null en iOS)
  bateria: { nivel: number | null; cargando: boolean | null }; // null en iOS
  red: { tipo: string | null; downlinkMbps: number | null; saveData: boolean };
  storageLibreMB: number | null;
  tier: Tier;
  tierInferido: boolean;
}

export interface UsoContador {
  dia: string; // "2026-10-23" (hora local)
  vista: string;
  accion: string;
  n: number;
}

/** ANEXO AGENTE C (REPARTE-3-AGENTES-v1, Pieza 2) — evento de CONGELÓN del
 *  main thread. PRIVACIDAD dura (qa-obs-privacidad): solo DURACIONES y
 *  momentos — jamás contenido de actas. breadcrumbs = los últimos 30 al
 *  momento del congelón (Breadcrumb ya es sin-contenido por contrato). */
export interface HangEvento {
  fuente: "drift" | "longtask"; // drift = gap del intervalo 500 ms · longtask = PerformanceObserver
  duracionMs: number; // gap REAL medido (kit: captura el gap real) o duración de la task
  umbralMs: number; // umbral que disparó el registro (3 000 drift · 50 longtask)
  breadcrumbs: Breadcrumb[]; // contexto de navegación alrededor (sin contenido)
}

export interface PoliticaDatos {
  metadatos: boolean; // default TRUE
  textoOcr: boolean; // default FALSE
  miniaturas: boolean; // default FALSE
  saludEnVivo: boolean; // default TRUE (solo corre con modo dev ON)
}

export interface EventoObs {
  id: string; // crypto.randomUUID()
  ts: number;
  tipo: TipoEvento;
  sesion: string; // UUID por sesión
  dispositivo: string; // UUID persistente
  appVersion: string;
  datos: ErrorEvento | PerfActa | SaludSnapshot | UsoContador | HangEvento | Record<string, unknown>;
}

export interface ErroresAgrupados {
  digest: string;
  severidad: "error" | "warn";
  tipo: string;
  mensaje: string;
  archivo: string | null;
  veces: number;
  primera: number;
  ultima: number;
  versiones: string[];
  breadcrumbsRecientes: Breadcrumb[]; // del evento más reciente
}

export interface FlagsApp {
  poolWorkers: 1 | 2; // default 2
  thumbsOn: boolean; // default true
  ocrThreadsTope: number; // default 4
  telemetriaSalud: boolean; // default true
  endpointReportes: string | null; // default null — sin backend, D1
  colaPersistente: boolean; // default true (cola-persistente-v1) — la masiva SOLO muere con vaciar() del dueño; false = MODO PRUEBAS e64p
}

export interface ReporteSesion {
  meta: {
    appVersion: string;
    generado: string; // ISO
    deviceId: string;
    sesion: string;
    politica: PoliticaDatos;
  };
  dispositivo: SaludSnapshot & { os: string; ua: string };
  erroresAgrupados: ErroresAgrupados[];
  perfResumen: {
    actas: number;
    p50OcrMs: number | null;
    p95OcrMs: number | null;
    fallosGate: number;
    memoriaPicoMB: number | null;
  };
  saludMuestras: SaludSnapshot[];
  uso: UsoContador[];
  /** ANEXO Agente C (Pieza 2) — agregación de hangs de la sesión (ADITIVA,
   *  opcional: informes previos no cambian de forma). fuente: eventos "hang"
   *  del buffer filtrados por esta sesión — resumenHangsDe (hang.ts, PURO). */
  hangResumen?: {
    cuenta: number;
    mayorMs: number | null;
    totalMs: number | null;
  };
}
