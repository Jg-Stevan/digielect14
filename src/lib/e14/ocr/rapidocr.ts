/**
 * FASE 3 (mapa v2.3) — WRAPPER de configuración de la app: el motor vive
 * en el paquete; AQUÍ se inyecta lo adaptativo de digielect14:
 *   · topeThreads ← adaptacion/plan.numThreadsOcrEfectivos (COOP+plan)
 *   · knobsRec ← flags (ocrRec* — mismos defaults históricos)
 */
import { configurarPlan } from "@jg-stevan/scanner-core/dominio/plan";
import { numThreadsOcrEfectivos } from "../adaptacion/plan";
import { leerFlags } from "../flags";
// Ola 5 §5.2 (R1) — canal obs para la instrumentación de multihilo. El
// appendEvento es SILENCIOSO por diseño (regla §2.4): jamás rompe el arranque.
import { appendEvento } from "@jg-stevan/scanner-core/obs-base/buffer";

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

// ─── Ola 5 §5.2 (R1) — instrumentación de MULTHILO del OCR ──────────────────
// «Instrumenta la verdad primero»: sin este log de campo no se sabe si el
// despliegue multihilo (COOP/COEP solo en Cloudflare) está usando los núcleos
// o sigue mono-hilo (125,8 s medidos en GH Pages gama baja). UN evento por
// sesión (este módulo se evalúa una vez por carga) con:
//   · crossOriginIsolated      — sin SAB el wasm cae a 1 hilo (GH Pages).
//   · navigator.hardwareConcurrency — núcleos declarados.
//   · topeThreadsPlan          — techo configurado por el plan adaptativo
//                                (numThreadsOcrEfectivos, ya inyectado arriba).
//   · ortWasmNumThreads        — `ort.env.wasm.numThreads` si se pudo leer del
//                                módulo onnxruntime-web (best-effort: el env
//                                del hilo principal puede no reflejar el del
//                                worker proxy; null = no accesible).
// Scrub: no hay PII — números y booleanos del entorno (contrato obs §3).
let instrumentadoMultihilo = false;

void (async () => {
  if (instrumentadoMultihilo) return;
  instrumentadoMultihilo = true;
  try {
    if (typeof window === "undefined") return; // SSR/tests node → nada que medir
    let ortWasmNumThreads: number | null = null;
    try {
      const ort = await import("onnxruntime-web");
      const leido = (ort.env?.wasm as { numThreads?: number } | undefined)?.numThreads;
      if (typeof leido === "number" && Number.isFinite(leido)) ortWasmNumThreads = leido;
    } catch {
      /* ort no cargó aún (o falló): null honesto — el log no depende de él */
    }
    await appendEvento({
      tipo: "perf",
      ts: Date.now(),
      sesion: "",
      dispositivo: "",
      appVersion: "",
      datos: {
        codigo: "ocr:multihilo-entorno",
        crossOriginIsolated: window.crossOriginIsolated ?? false,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        topeThreadsPlan: numThreadsOcrEfectivos(),
        ortWasmNumThreads,
      },
    });
  } catch {
    /* la instrumentación jamás rompe el arranque del OCR (§2.4) */
  }
})();
