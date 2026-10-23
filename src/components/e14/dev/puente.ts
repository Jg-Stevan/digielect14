/**
 * KIT e14-observabilidad-v1 — AGENTE 2 (UI modo dev) · FASE 0 · PUENTE.
 *
 * Costura local entre la UI (`dev/*.tsx`) y el núcleo de observabilidad del
 * agente 1 (`src/lib/e14/obs/**`), que AÚN NO EXISTE en FASE 0. Las firmas
 * son EXACTAMENTE las del contrato pinned (README-KITS.md §4.3) — la UI
 * codifica contra el contrato, no contra el núcleo.
 *
 * FASE 0 (esta): persistencia local SOLO en las claves PINNEADAS e
 * inalterables (§4.1) con los defaults del contrato; todo lo que depende
 * del núcleo responde con un valor HONESTO vacío (0 / [] / null / no-op) —
 * jamás inventa datos.
 *
 * CRECIMIENTO POR TAREA (gate: «cada export nace con consumidor»):
 *  · C1 (este commit): modo dev — `leerModoDev` / `guardarModoDev` /
 *    `useModoDev` (tuerca).
 *  · C4: política, overrides, flags, salud, buffer de lectura, identidad
 *    (consumidores: PanelDev).
 *  · C5: `purgarBuffer` (consumidor: VistaErrores).
 *  · C6: hook `useSaludVivo` (consumidor: PanelDev).
 *
 * FASE 1 (cuando exista `origin/feat/obs-nucleo-v1`): los cuerpos se
 * reemplazan por delegación a los módulos reales (`obs/politica.ts`,
 * `obs/buffer.ts`, `obs/dispositivo.ts`, `obs/identidad.ts`,
 * `lib/e14/flags.ts`) — las firmas y los consumidores NO cambian.
 */
import { useEffect, useState } from "react";

// ── Claves de persistencia (README-KITS.md §4.1 — INALTERABLES) ────────────
const CLAVE_MODO_DEV = "e14-dev-mode"; // "on" | "off"

/** Evento DOM intra-pestaña: `storage` solo cruza pestañas, así que los
 *  setters de este puente disparan este evento para re-render reactivo
 *  local (lo más barato: CERO timers/polling). Interno al puente. */
const EV_OBS_CAMBIO = "e14-obs:cambio";

function emitirCambio(clave: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EV_OBS_CAMBIO, { detail: clave }));
  } catch {
    /* sin window (SSR/prerender): nada que notificar */
  }
}

/** Suscripción barata a cambios de las claves observadas: evento DOM
 *  intra-pestaña + `storage` cross-pestaña. Llamar DENTRO de useEffect. */
function suscribirObs(claves: string[], cb: () => void): () => void {
  const onDom = (e: Event) => {
    const detalle = (e as CustomEvent<string>).detail;
    if (!detalle || claves.includes(detalle)) cb();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || claves.includes(e.key)) cb();
  };
  window.addEventListener(EV_OBS_CAMBIO, onDom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EV_OBS_CAMBIO, onDom);
    window.removeEventListener("storage", onStorage);
  };
}

// ── Modo dev (contrato §4.3 obs/politica.ts) ───────────────────────────────
/** Contrato §4.3 — interno del puente en FASE 0 (consumidor: `useModoDev`);
 *  FASE 1 delega en obs/politica.ts. */
function leerModoDev(): boolean {
  try {
    return localStorage.getItem(CLAVE_MODO_DEV) === "on";
  } catch {
    return false; // modo privado / sin localStorage → OFF
  }
}

export function guardarModoDev(on: boolean): void {
  try {
    localStorage.setItem(CLAVE_MODO_DEV, on ? "on" : "off");
  } catch {
    /* modo privado: el ajuste no persiste — la UI lo refleja igual */
  }
  emitirCambio(CLAVE_MODO_DEV);
}

/** Modo dev reactivo (badge TopBar C2, tuerca C1, panel C4). */
export function useModoDev(): boolean {
  const [on, setOn] = useState(false); // SSR/hidratación: OFF primero, sync en efecto
  useEffect(() => {
    const sync = () => setOn(leerModoDev());
    sync();
    return suscribirObs([CLAVE_MODO_DEV], sync);
  }, []);
  return on;
}
