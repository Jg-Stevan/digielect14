/**
 * 7.5 (plan de remediación, cierra A4) — FACHADA ÚNICA de vistas → motor.
 *
 * La regla declarada en el repo es que las VISTAS no tocan el motor
 * (`src/lib/e14` es la capa de dominio; `src/components/e14` solo consume
 * contratos). Hasta hoy ~22 imports de componentes iban DIRECTOS a
 * `@jg-stevan/scanner-core` — el swap de esos imports a esta fachada lo
 * hace el agente de UI (docs/PENDIENTES-INTEGRACION.md); mientras tanto la
 * regla `no-restricted-imports` de eslint.config.mjs está en `warn` para
 * `src/components/**` y se SUBE A ERROR tras el swap.
 *
 * Inventario EXACTO de lo que los componentes importan hoy (verificado con
 * `rg "@jg-stevan/scanner-core" src/components` al crear la fachada —
 * re-exporta SOLO eso; nada nuevo "por si acaso"). Tipos con `export type`,
 * valores con `export`.
 */

// ── core/image-processor (QuadEditor, useDestello) ───────────────────────
export {
  detectDocumentEdges,
  loadImage,
  ErrorRescateHeic,
  fileToCaptureDataUrl,
  jpegDimensionsFromBlob,
} from "@jg-stevan/scanner-core/core/image-processor";

// ── core/types (QuadEditor, useSesionCamara, ReviewView) ────────────────
export { defaultQuad, FILTER_PRESETS } from "@jg-stevan/scanner-core/core/types";
export type {
  Point,
  Quad,
  PageFilter,
} from "@jg-stevan/scanner-core/core/types";

// ── core/ocr (ReviewView) ────────────────────────────────────────────────
export { OCR_NO_TEXT } from "@jg-stevan/scanner-core/core/ocr";

// ── core/detector-client (ScanView) ─────────────────────────────────────
export { warmUpScannerWorker } from "@jg-stevan/scanner-core/core/detector-client";

// ── dominio/clasificador (ReviewView, PanelClasificacion) ───────────────
export { nombreExportacion, tipoDeBanda } from "@jg-stevan/scanner-core/dominio/clasificador";
export type { ClasificacionE14, TipoCopia } from "@jg-stevan/scanner-core/dominio/clasificador";

// ── dominio/divipol (PanelClasificacion, ActasView) ─────────────────────
export {
  cargarDivipol,
  departamentosDe,
  estadoDivipol,
  municipiosDe,
  puestosDe,
  zonasDe,
  mesasDePuesto,
} from "@jg-stevan/scanner-core/dominio/divipol";
export type { DivipolBase } from "@jg-stevan/scanner-core/dominio/divipol";

// ── dominio/seed (ResumenView, ActasView) ────────────────────────────────
export { PUESTO_SIMULADO } from "@jg-stevan/scanner-core/dominio/seed";

// ── dominio/types (TopBar, useDestello, useSelectorFuente, ActasView,
//    AnalyzingView, ResumenView) ──────────────────────────────────────────
export type {
  Acta,
  ActaStatus,
  EtapaAnalisis,
  FuenteCaptura,
  HistorialRow,
  Mesa,
  MesaPagina,
  ProgresoAnalisis,
} from "@jg-stevan/scanner-core/dominio/types";

// ── obs-base/buffer (dev/puente.ts — panel de desarrollador) ────────────
export { contarEventos, eventosPorDigest, purgarBuffer } from "@jg-stevan/scanner-core/obs-base/buffer";
