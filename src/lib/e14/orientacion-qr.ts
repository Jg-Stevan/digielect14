/** FASE 2 (mapa v2.3) — WRAPPER: brújula QR del paquete + flags de D. */
import { configurarPlan } from "@jg-stevan/scanner-core/dominio/plan";
import { leerFlags } from "./flags";

configurarPlan({
  pasesBrujulaWarp: () => leerFlags().qrBrujulaWarpPases,
});

export * from "@jg-stevan/scanner-core/geom/orientacion-qr";
