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
//   · ortConfig                — KIT e14-remediacion-movil-v1 (D5 — #18): la
//                                config REAL que el paquete publica en
//                                window.__E14_ORT_CONFIG__ (initReal de
//                                scanner-core: { numThreads, proxy, simd }).
//                                Antes se leía ort.env.wasm.numThreads del
//                                módulo, que reportaba el DEFAULT de ORT (o
//                                nada) porque aquí el motor aún no se había
//                                inicializado — la verdad está en la variable
//                                publicada post-init. Este módulo se evalúa al
//                                ARRANQUE, así que la espera es ACOTADA
//                                (sondeo 250 ms × 120 = 30 s): se publica el
//                                evento en cuanto aparece la config (prewarm/
//                                init) o con null honesto si nunca llegó.
// Scrub: no hay PII — números y booleanos del entorno (contrato obs §3).
let instrumentadoMultihilo = false;

/** Lee la config ORT publicada por el paquete (initReal) — best-effort y
 *  silencioso: null si aún no existe o el entorno no la expone. */
function leerConfigOrtPublicada(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const cfg = (window as unknown as { __E14_ORT_CONFIG__?: unknown }).__E14_ORT_CONFIG__;
    return cfg !== null && typeof cfg === "object" ? (cfg as Record<string, unknown>) : null;
  } catch {
    return null; // jamás rompe el arranque (§2.4)
  }
}

void (async () => {
  if (instrumentadoMultihilo) return;
  instrumentadoMultihilo = true;
  try {
    if (typeof window === "undefined") return; // SSR/tests node → nada que medir
    // D5 (#18): espera ACOTADA a la config real publicada post-init — el
    // evento sigue siendo UNO por sesión; sin init ⇒ null honesto.
    let ortConfig: Record<string, unknown> | null = null;
    for (let i = 0; i < 120 && ortConfig === null; i++) {
      await new Promise<void>((resolver) => setTimeout(resolver, 250));
      ortConfig = leerConfigOrtPublicada();
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
        ortConfig,
      },
    });
  } catch {
    /* la instrumentación jamás rompe el arranque del OCR (§2.4) */
  }
})();
