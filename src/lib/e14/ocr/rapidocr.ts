/**
 * FASE 3 (mapa v2.3) — WRAPPER de configuración de la app: el motor vive
 * en el paquete; AQUÍ se inyecta lo adaptativo de digielect14:
 *   · topeThreads ← adaptacion/plan.numThreadsOcrEfectivos (COOP+plan)
 *   · knobsRec ← flags (ocrRec* — mismos defaults históricos)
 */
import { configurarPlan } from "@jg-stevan/scanner-core/dominio/plan";
import { numThreadsOcrEfectivos } from "../adaptacion/plan";
import { leerFlags } from "../flags";

configurarPlan({
  topeThreadsOcr: numThreadsOcrEfectivos,
  knobsRec: () => {
    const f = leerFlags();
    return {
      anchoMax: f.ocrRecWmax,
      alto: f.ocrRecAltura,
      lote: f.ocrRecLote,
      suave: f.ocrRecSuave,
      wFija: f.ocrRecWfija,
      cabecera: f.ocrRecCabecera,
      pie: f.ocrRecPie,
      bordesRescate: f.ocrRecBordesRescate,
    };
  },
});

export * from "@jg-stevan/scanner-core/ocr/rapidocr";
