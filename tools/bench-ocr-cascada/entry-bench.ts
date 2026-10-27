/**
 * Entry del bundle CONGELADO del banco (KIT e14-bench-ocr-cascada-v1 — K3
 * fase 1 — SOLO tools/, NUNCA producción): re-exporta los módulos REALES de
 * producción para que el banco evalúe B y C con EL MISMO juez y EL MISMO
 * motor que el pipeline (clasificador + rapidocr + caps del det + decisión
 * del escalonado + cliente del detection-worker — brief K3: «Reutiliza el
 * clasificador/gate REAL (importa clasificador.ts / la lógica de decisión
 * que usa prod)»).
 *
 * Congelado con esbuild a `vendor/bench-kit.congelado.js` (IIFE global
 * `BenchKit`) — regenerar con `./generar-vendor.sh` tras cambiar src/. El
 * commit del bundle registra el commit fuente de la copia (ver cabecera del
 * .js). Nada de esto entra al bundle de la app (knip: entry tools/**).
 */

// PRIMERO: el shim arma process.env.NEXT_PUBLIC_BASE_PATH (absoluta) antes
// de que los módulos de abajo evalúen (ver bench-shim.ts).
import "./bench-shim";

// GATE — el clasificador REAL de prod (juez de B y C) + su base DIVIPOL.
export { clasificarCabecera } from "../../src/lib/e14/clasificador";
export { cargarDivipol } from "../../src/lib/e14/divipol";

// Motor OCR REAL de prod (RapidOCR PP-OCRv4, caps del det-preprocess op4).
export {
  DET_CAP_PROD,
  DET_CAP_RAPIDO,
  rapidOcrInit,
  rapidOcrPrecalentar,
  rapidOcrReconocer,
} from "../../src/lib/e14/ocr/rapidocr";

// Decisión/elegir del OCR ESCALONADO de siempre (arm A — las MISMAS reglas:
// necesitaSegunda §2.3 + elegirMejor §2.4) + señal de lectura (conteo de
// anclas del reporte).
export { anclasDe, elegirMejor, necesitaSegunda } from "../../src/lib/e14/ocr-escalonado";
export { senalDeLectura } from "../../src/lib/e14/senal-lectura";

// Cliente del detection-worker REAL (OpenCV detect→quad · warp SIN rotar):
// el MISMO asset público que usa el pre-scan de prod
// (public/scanner/detection-worker.js?v=8) con los MISMOS budgets
// (presupuesto 4000+1500 ms, hard-kill anti-zombi).
export { crearClientePrescan } from "../../src/lib/e14/masiva/prescan-qr.client";

// Decode HEIC del banco (el core hace import("heic2any") — bundled aquí).
export { default as heic2any } from "heic2any";
