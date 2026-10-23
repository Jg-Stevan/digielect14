/**
 * KIT e14-observabilidad-v1 — AGENTE 2 (UI modo dev) · FASE 0.
 *
 * Tipos del CONTRATO PINNED (README-KITS.md §4.2), copiados VERBATIM en el
 * subset que la UI de modo dev consume. El agente 1 los creará EXACTAMENTE
 * iguales en `src/lib/e14/obs/tipos.ts`.
 *
 * FASE 1 (cuando exista `origin/feat/obs-nucleo-v1`): ESTE ARCHIVO SE ELIMINA
 * y los imports de la UI pasan a `@/lib/e14/obs/tipos` — cero cambios en los
 * componentes (los nombres de tipo son los mismos del contrato).
 * `Tier` queda interno (lo consumen las interfaces exportadas); cada export
 * de aquí nace con consumidor (gate knip).
 */

export interface Breadcrumb {
  t: number; // epoch ms
  tipo: "click" | "vista" | "cola" | "store" | "red";
  detalle: string; // aria-label / data-accion / transición — SIN contenido de actas
}

type Tier = "ALTO" | "MEDIO" | "BAJO";

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

export interface PoliticaDatos {
  metadatos: boolean; // default TRUE
  textoOcr: boolean; // default FALSE
  miniaturas: boolean; // default FALSE
  saludEnVivo: boolean; // default TRUE (solo corre con modo dev ON)
}

export interface FlagsApp {
  poolWorkers: 1 | 2; // default 2
  thumbsOn: boolean; // default true
  ocrThreadsTope: number; // default 4
  telemetriaSalud: boolean; // default true
  endpointReportes: string | null; // default null — sin backend, D1
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

/** Defaults D4 (README-KITS.md §2.3): metadatos ON · OCR OFF · miniaturas OFF · salud ON. */
export const POLITICA_DEFAULT: PoliticaDatos = {
  metadatos: true,
  textoOcr: false,
  miniaturas: false,
  saludEnVivo: true,
};

/** Defaults de FlagsApp (README-KITS.md §4.2). */
export const FLAGS_DEFAULT: FlagsApp = {
  poolWorkers: 2,
  thumbsOn: true,
  ocrThreadsTope: 4,
  telemetriaSalud: true,
  endpointReportes: null,
};
