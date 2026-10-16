/**
 * Dominio E-14 (SPEC §6 — ampliado para v2).
 * FASE LÓGICA L1: campos async opcionales (§3.1) — el mock y el seed siguen
 * compatibles (todo es opcional).
 */
import type { PageFilter, Quad } from "@jg-stevan/scanner-core/types";
import type { ClasificacionE14 } from "./clasificador";

// ---------- Captura y análisis (SPEC fase lógica §3.1) ----------
export type FuenteCaptura = "SIMULACION" | "CAMARA" | "ARCHIVO";

export type EtapaAnalisis = "DETECTANDO" | "RECORTANDO" | "REALZANDO" | "CALIDAD" | "OCR";

export interface ProgresoAnalisis {
  etapa: EtapaAnalisis;
  progreso: number; // 0..1 dentro de la etapa
}

// ---------- Acta (flujo de revisión) ----------
export type ActaStatus =
  | "OPTIMA" // verde   ≥ 8.0  → envío automático
  | "ADVERTENCIA" // ámbar   6.5–7.9 → confirmar o repetir
  | "RECHAZADA" // rojo    < 6.5  → repetir obligatorio (4 intentos; contingencia automática al agotar)
  | "ENVIADA" // verde   tras envío (auto o manual)
  | "EN_REVISION_HUMANA"; // ámbar   contingencia al AGOTAR intentos (C4 automática) o SUGERIDA/MANUAL «repetir-primero»

export interface ActaUbicacion {
  departamento: string;
  municipio: string;
  zona: string;
  puesto: string;
  mesa: string;
}
export interface ActaCandidato {
  codigo: string;
  votos: number;
} // "101": 25 …

/**
 * Estado de una firma sobre el acta.
 * D6: "TENUE" añadido para reproducir el marcado ámbar "TRAZO TENUE"
 * de las pantallas de advertencia del zip v2 (ver docs/DECISIONS.md).
 */
export interface ActaFirma {
  nombre: string;
  jurado: string;
  estado: "OK" | "NO_DETECTADO" | "TENUE";
}

export interface Acta {
  id: string;
  titulo: string; // "ROMA - CONSULADO"
  ubicacion: ActaUbicacion;
  tipo: string; // "SENADO DE LA REPÚBLICA"
  /** Página del acta (KIT actas-vivas-paginas-v1, FASE B — nullable): la
   *  página del papel es DATO — si el OCR/1D no la leyó viaja null
   *  (DESCONOCIDA) y TODOS los consumidores muestran la honestidad
   *  («PÁG - DE -», hueco al primer libre) en vez de asumir P1 mintiendo. */
  pagina: { index: number; total: number } | null;
  candidatos: ActaCandidato[];
  firmas: ActaFirma[];
  codigoBarras: string; // "*E14-SEN-2026-001*"
  score: number; // 0..10 SIEMPRE /10 (D2)
  status: ActaStatus;
  /** Motivo del rechazo → define la variante visual (§7.5) */
  rechazo:
    | null
    | { tipo: "ILEGIBLE"; detalle: string }
    | { tipo: "GENERICO"; detalle: string }
    | { tipo: "INCOMPLETA"; detalle: string }
    /** §D3 (SPEC-e14-score-ocr): sin señal de contenido del acta — «score
     *  bajo» determinista (repetir NUNCA revisión humana en 1ª ronda). */
    | { tipo: "BAJO"; detalle: string }
    /** KIT e14-gate-v2 (FASE G2): marcador OBLIGATORIO fallido — la zona de
     *  votos del acta no tiene tinta (fallo 2026-10-16: acta sin votos
     *  10/10 y auto-enviada). Rechazo directo → se repite la captura. */
    | { tipo: "SIN_VOTOS"; detalle: string };
  intento: number;
  maxIntentos: number; // "INTENTO 1 DE 4"
  enviadoAutomaticamente?: string; // "16:42:00"
  hashSha256?: string; // "EN COLA" | hash

  // ----- FASE LÓGICA (§3.1, opcionales — compatibles con seed/mocks) -----
  fuente?: FuenteCaptura;
  /** data URL warp+realce (la evidencia real). */
  fotoProcesada?: string;
  /** data URL cruda del frame/archivo. */
  fotoOriginal?: string;
  /** §D4 (SPEC-e14-score-ocr): la PROCESADA salió sin tinta (warp de un quad
   *  degenerado sobre superficie lisa) → REVISIÓN muestra la ORIGINAL. */
  procesadaVacia?: boolean;
  /** KIT actas-vivas-paginas-v1 (FASE C): OCR de secciones detectó el
   *  RECORTE del papel (P1 sin «SUMA TOTAL» / P≥2 sin «FIRMA» — el caso
   *  real del dueño: captura con la parte inferior pisada sin advertencia).
   *  Score con techo 7.9 (ADVERTENCIA, no rechazo) + píldora «ACTA
   *  RECORTADA». Página desconocida → jamás se marca. */
  recortada?: boolean;
  /** KIT identificacion-codigo-v1 (FASE F, Task 120): LADO de la esquina
   *  fiducial faltante («sup-izq» — marcasEsquina sobre el crop ya
   *  enderezado) cuando el recorte lo detectó la señal de esquinas; null si
   *  el recorte vino SOLO del OCR de secciones del kit 118 o 4/4 presentes. */
  recorteLado?: string | null;
  /** texto detectado (debug/verificación). */
  ocrTexto?: string;
  /** métricas del core 0-100. */
  metricas?: { sharpness: number; brightness: number; contrast: number };
  motor?: "worker" | "canvas" | "mock";
  /** esquinas de la detección automática (inicio del editor §7.5). */
  quadDetectado?: Quad;
  /** 0|90|180|270 — horneada en fotoProcesada. */
  rotation?: number;
  /** F2 (D36): filtro con el que se procesó (default del producto = "bw"). */
  filtro?: PageFilter;
  /**
   * Clasificación de cabecera contra la base DIVIPOL (SPEC-cabecera-
   * clasificacion §4/§6 — opcional, compatible con seed): nivel AUTO →
   * archivada en su mesa al envío; SUGERIDA/MANUAL → panel de corrección.
   */
  clasificacion?: ClasificacionE14;
}

// ---------- Control de mesas (vista ACTAS) ----------
export type MesaEstado = "COMPLETADA" | "EN_PROCESO" | "PENDIENTE";
export type PaginaEstado = "OK" | "RESCANEO" | "EN_PROCESO" | "PENDIENTE";
export type TipoPagina = "DELEGADOS" | "TRANSMISIÓN";

export interface MesaPagina {
  tipo: TipoPagina;
  pagina: 1 | 2;
  estado: PaginaEstado;
}
export interface Mesa {
  id: string; // "MESA 01"
  estado: MesaEstado;
  progresoPct: number; // 100 | 50 | 0
  paginas: MesaPagina[]; // DELEGADOS P1/P2 · TRANSMISIÓN P1/P2
  /** Fase B (§6): clave DIVIPOL de la mesa real (seed no la lleva). */
  clave?: string;
}

// ---------- Resumen de trabajo (vista RESUMEN) ----------
export interface ProgresoPuesto {
  asignadasHoy: number;
  completadas: number;
} // 12 / 9 → 75%
export interface HistorialRow {
  id: string;
  titulo: string; // "MESA 01 — TRANSMISIÓN P2"
  estado: "ENVIADO" | "RESCANEO_REQUERIDO" | "REVISION_HUMANA";
  hora?: string; // "14:32"
}

/** Score → estado canónico (§6). */
export function statusDeScore(score: number): ActaStatus {
  if (score >= 8) return "OPTIMA";
  if (score >= 6.5) return "ADVERTENCIA";
  return "RECHAZADA";
}
