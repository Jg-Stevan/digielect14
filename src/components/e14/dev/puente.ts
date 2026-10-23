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
 *  · C1 (hecho): modo dev — `guardarModoDev` / `useModoDev` (tuerca).
 *  · C4 (este commit): política, overrides, flags, salud, buffer de
 *    lectura, identidad y export (consumidor: PanelDev).
 *  · C5: `purgarBuffer` gana su 2.º consumidor (VistaErrores).
 *  · C6: hook `useSaludVivo` (consumidor: PanelDev).
 *
 * FASE 1 (cuando exista `origin/feat/obs-nucleo-v1`): los cuerpos se
 * reemplazan por delegación a los módulos reales (`obs/politica.ts`,
 * `obs/buffer.ts`, `obs/dispositivo.ts`, `obs/identidad.ts`,
 * `obs/export.ts`, `lib/e14/flags.ts`) — las firmas y los consumidores
 * NO cambian.
 */
import { useEffect, useState } from "react";
import type {
  ErroresAgrupados,
  FlagsApp,
  PoliticaDatos,
  SaludSnapshot,
} from "./contrato";
import { FLAGS_DEFAULT, POLITICA_DEFAULT } from "./contrato";

// ── Claves de persistencia (README-KITS.md §4.1 — INALTERABLES) ────────────
const CLAVE_MODO_DEV = "e14-dev-mode"; // "on" | "off"
const CLAVE_POLITICA = "e14-obs-politica"; // PoliticaDatos JSON
const CLAVE_OVERRIDES = "e14-flags-overrides"; // Partial<FlagsApp> JSON
const CLAVE_DEVICE_ID = "e14-obs-device-id"; // la ESCRIBE el agente 1 — aquí SOLO se lee si existe

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

// ── Política de datos (contrato §4.3 obs/politica.ts · defaults D4) ───────
/** Contrato §4.3 — interno del puente en FASE 0 (consumidor: `usePolitica`);
 *  FASE 1 delega en obs/politica.ts. */
function leerPolitica(): PoliticaDatos {
  try {
    const crudo = localStorage.getItem(CLAVE_POLITICA);
    if (!crudo) return POLITICA_DEFAULT;
    return { ...POLITICA_DEFAULT, ...(JSON.parse(crudo) as Partial<PoliticaDatos>) };
  } catch {
    return POLITICA_DEFAULT;
  }
}

export function guardarPolitica(p: PoliticaDatos): void {
  try {
    localStorage.setItem(CLAVE_POLITICA, JSON.stringify(p));
  } catch {
    /* modo privado: no persiste */
  }
  emitirCambio(CLAVE_POLITICA);
}

// ── Overrides de flags (contrato §4.3 obs/politica.ts · kill switch) ──────
/** Contrato §4.3 — interno del puente en FASE 0 (consumidor:
 *  `useOverridesFlags`); FASE 1 delega en obs/politica.ts. */
function leerOverridesFlags(): Partial<FlagsApp> {
  try {
    const crudo = localStorage.getItem(CLAVE_OVERRIDES);
    if (!crudo) return {};
    return JSON.parse(crudo) as Partial<FlagsApp>;
  } catch {
    return {};
  }
}

/** Semántica de REEMPLAZO completo: el caller pasa el objeto final (sin la
 *  clave = sin override). FASE 1 verifica contra obs/politica.ts real. */
export function guardarOverridesFlags(o: Partial<FlagsApp>): void {
  try {
    localStorage.setItem(CLAVE_OVERRIDES, JSON.stringify(o));
  } catch {
    /* modo privado: no persiste */
  }
  emitirCambio(CLAVE_OVERRIDES);
}

// ── Flags efectivas (contrato §4.3 lib/e14/flags.ts) ──────────────────────
/** FASE 0: defaults del contrato + overrides locales. La capa
 *  `public/flags.json` / endpoint remoto vive en flags.ts del agente 1. */
export function leerFlags(): FlagsApp {
  return { ...FLAGS_DEFAULT, ...leerOverridesFlags() };
}

export async function refrescarFlags(): Promise<"ok" | "sin-endpoint" | "error"> {
  // Contrato: "sin-endpoint" si no hay endpoint de flags configurado.
  // FASE 0 no conoce endpoint (endpointReportes default null) → honesto.
  return "sin-endpoint";
}

// ── Salud del dispositivo (contrato §4.3 obs/dispositivo.ts) ──────────────
export type SnapshotDispositivo = SaludSnapshot & { os: string; ua: string };

/** FASE 0: el núcleo no existe → null (la UI muestra "—", jamás inventa). */
export async function obtenerDispositivo(): Promise<SnapshotDispositivo | null> {
  return null;
}

export function iniciarMuestreoSalud(): void {
  /* FASE 1: delegar en obs/dispositivo.ts (timer 5 min, idempotente) */
}

export function detenerMuestreoSalud(): void {
  /* FASE 1: delegar en obs/dispositivo.ts */
}

// ── Buffer de eventos (contrato §4.3 obs/buffer.ts) ───────────────────────
/** FASE 0: buffer vacío (obs/buffer.ts es del agente 1). */
export async function contarEventos(): Promise<number> {
  return 0;
}

export async function eventosPorDigest(): Promise<ErroresAgrupados[]> {
  return [];
}

export async function purgarBuffer(): Promise<void> {
  /* FASE 1: delegar en obs/buffer.ts (tope 500 + TTL 30d, FIFO) */
}

// ── Identidad (contrato §4.3 obs/identidad.ts) ────────────────────────────
/** FASE 0: solo LECTURA de la clave pinned si el núcleo la llegó a escribir. */
export function idDispositivo(): string | null {
  try {
    return localStorage.getItem(CLAVE_DEVICE_ID);
  } catch {
    return null;
  }
}

/** FASE 0: la identidad de sesión la crea obs/identidad.ts (agente 1). */
export function idSesion(): string | null {
  return null;
}

/** FASE 0: constante espejo de package.json. FASE 1: obs/identidad.ts
 *  (`appVersion(): string // de package.json importado`). */
export function appVersion(): string {
  return "0.1.0";
}

// ── Export (contrato §4.3 obs/export.ts) ──────────────────────────────────
/** FASE 0: inalcanzable desde la UI (los botones exigen buffer no vacío y
 *  el buffer FASE 0 siempre está en 0). Falla HONESTA si algún día se
 *  invoca — jamás simula una descarga. FASE 1: delegar en obs/export.ts. */
export async function descargarReporte(
  _formato: "zip" | "json",
  _vaciarDespues: boolean,
): Promise<{ nombre: string; bytes: number }> {
  throw new Error("NÚCLEO OBS PENDIENTE (FASE 1) — obs/export.ts");
}

// ── Hooks de política/overrides reactivos (consumidor: PanelDev C4) ───────

/** Política de datos reactiva (panel C4). */
export function usePolitica(): PoliticaDatos {
  const [p, setP] = useState<PoliticaDatos>(POLITICA_DEFAULT);
  useEffect(() => {
    const sync = () => setP(leerPolitica());
    sync();
    return suscribirObs([CLAVE_POLITICA], sync);
  }, []);
  return p;
}

/** Overrides de flags reactivos (kill switch C4 + tabla de flags). */
export function useOverridesFlags(): Partial<FlagsApp> {
  const [o, setO] = useState<Partial<FlagsApp>>({});
  useEffect(() => {
    const sync = () => setO(leerOverridesFlags());
    sync();
    return suscribirObs([CLAVE_OVERRIDES], sync);
  }, []);
  return o;
}
