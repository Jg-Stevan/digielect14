/**
 * FASE 2 (mapa v2.3) — WRAPPER: el probe vive en el paquete (geom/);
 * aquí se inyecta lo adaptativo de digielect14 (§3.1/D3).
 */
import { configurarPlan } from "@jg-stevan/scanner-core/dominio/plan";
import { presupuestoProbeOrientacionEfectivo } from "./adaptacion/plan";
import { leerFlags } from "./flags";

configurarPlan({
  presupuestoProbeOrientacion: presupuestoProbeOrientacionEfectivo,
  ladoMiniProbe: () => leerFlags().probeMiniLado,
});

export * from "@jg-stevan/scanner-core/geom/orientacion";
