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
  /** §G.4 — ORDEN-WAVE3-add-envio-individual-v1 (obs-envio-individual-v1):
   *  estado de VISIBILIDAD al momento de la detección (AL FINAL — D57).
   *  En background el SO congela los timers: el gap NO es congelón (fantasma
   *  real del informe 1230: 117 s de pantalla bloqueada contaban como hang).
   *  Eventos legacy sin el campo → tratar como visible (`?? true`). */
  visible: boolean;
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
  // ─── KIT e73-sondeo-qr-precoz-v1 (§D) — campos ADITIVOS AL FINAL (D57) ───
  sondeoQrPrecoz: boolean; // default true — sondeo QR en INGESTA (worker e73); false = kill-switch (byte-idéntico a 043b2ba)
  sondeoQrPresupuestoMs: number; // default 2500 — presupuesto del reló del ladder del worker (jamás extender — kit §I)
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
}

/** §G.3 — fila de enviosDetalle (una por diagnóstico con envioMs != null).
 *  PRIVACIDAD: actaIdHash (fnv1a8 — JAMÁS el id plano), sin título/mesa/
 *  puesto/payload (qa-obs-privacidad manda). modo = canal del diagnóstico
 *  al export ("individual" = actaActual — una acta abierta desde la bandeja
 *  a REVISIÓN cuenta individual; "masiva" = cola). */
export interface EnvioDetalle {
  actaIdHash: string; // fnv1a8(actaId) — 8 hex (JAMÁS el id plano)
  modo: "individual" | "masiva";
  status: string; // ActaStatus del desenlace (string — informe JSON estable)
  ocrMs: number | null;
  totalMs: number | null;
  envioMs: number; // != null por construcción (solo filas con envío medido)
  envioRedTipo: string | null;
  envioDownlinkMbps: number | null;
}
