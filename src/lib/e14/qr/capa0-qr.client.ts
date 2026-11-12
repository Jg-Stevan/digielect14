"use client";

/**
 * FASE 2 (mapa v2.3) — WRAPPER: el cliente unificado vive en el paquete
 * (merge D+S sobre el MISMO artefacto del build único 3.7). Aquí se
 * inyectan el kill-switch del mantenedor y el tier del plan adaptativo.
 */
import { configurarCapa0 } from "@jg-stevan/scanner-core/qr/capa0-qr.client";
import { leerFlags } from "../flags";
import { planAdaptativo } from "../adaptacion/plan";

configurarCapa0({
  habilitado: () => leerFlags().capa0QrWorker,
  tier: () => {
    try {
      return planAdaptativo().tier;
    } catch {
      return null;
    }
  },
});

export * from "@jg-stevan/scanner-core/qr/capa0-qr.client";
