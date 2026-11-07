/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2) — FASE 1 (mapa v2.3): la fábrica
 * CompositeBridge vive en el PAQUETE (crearGetBridge); el RealCoreBridge
 * (composition root de ESTA app — FASE 4 del mapa) se inyecta aquí.
 */
import { crearGetBridge } from "@jg-stevan/scanner-core/dominio/get-bridge";
import { RealCoreBridge } from "./scanner-core-bridge";

export const getBridge = crearGetBridge(() => new RealCoreBridge());
