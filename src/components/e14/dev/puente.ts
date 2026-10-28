/**
 * KIT e14-observabilidad-v1 — AGENTE 2 (UI modo dev) · FASE 1 · PUENTE.
 *
 * Costura entre la UI (`dev/*.tsx`) y el núcleo real de observabilidad del
 * agente 1 (`src/lib/e14/obs/**` + `src/lib/e14/flags.ts`). Las firmas son
 * EXACTAMENTE las del contrato pinned (README-KITS.md §4.3) — la UI codifica
 * contra el contrato, no contra el núcleo: FASE 1 SOLO cambió los cuerpos
 * (delegación); consumidores y JSX no se tocó.
 *
 * Delegación (obs/ = núcleo agente 1):
 *  · modo dev / política / overrides → obs/politica.ts (claves pinned §4.1,
 *    defaults D4, saneo de corruptos del núcleo).
 *  · flags efectivas / refresco → lib/e14/flags.ts (cadena real:
 *    DEFAULTS ← public/flags.json cacheado ← overrides — máxima prioridad).
 *  · salud / muestreo 5 min → obs/dispositivo.ts (timer del NÚCLEO, no de la
 *    UI; re-verifica modo dev + saludEnVivo + telemetriaSalud cada tick).
 *  · buffer de eventos → obs/buffer.ts (IDB e14-obs, tope 500 + TTL 30d).
 *  · identidad → obs/identidad.ts (appVersion de package.json — ya no hay
 *    constante espejo; idDispositivo crea el UUID persistente en la primera
 *    lectura — diseño lazy del núcleo).
 *  · export ZIP/JSON → obs/export.ts (ReporteSesion del contrato).
 *
 * Reactividad: los setters del núcleo no notifican a la UI, así que este
 * puente conserva el evento DOM intra-pestaña `e14-obs:cambio` (más el
 * `storage` cross-pestaña) — CERO timers/polling.
 *
 * DESVIACIÓN DOCUMENTADA (única): guardarOverridesFlags mantiene semántica
 * de REEMPLAZO completo (FASE 0) en vez de delegar — el kill switch del
 * panel necesita APAGAR un override (delete de la clave), y el núcleo hace
 * MERGE ({...actual, ...o}): una clave borrada del objeto sobreviviría en
 * storage y el switch jamás apagaría. Se escribe el objeto FINAL directo en
 * la clave PINNED `e14-flags-overrides` (§4.1 — exportada por el núcleo
 * como CLAVE_OVERRIDES); la lectura y el saneo siguen siendo 100 % del
 * núcleo (leerOverridesFlags → sanearFlags en leerFlags).
 */
import { useEffect, useState } from "react";
import {
  CLAVE_OVERRIDES,
  POLITICA_DEFAULT,
  guardarModoDev as nucleoGuardarModoDev,
  guardarPolitica as nucleoGuardarPolitica,
  leerModoDev as nucleoLeerModoDev,
  leerPolitica as nucleoLeerPolitica,
  leerOverridesFlags as nucleoLeerOverridesFlags,
} from "@/lib/e14/obs/politica";
import {
  contarEventos as nucleoContarEventos,
  eventosPorDigest as nucleoEventosPorDigest,
  purgarBuffer as nucleoPurgarBuffer,
} from "@/lib/e14/obs/buffer";
import {
  detenerMuestreoSalud as nucleoDetenerMuestreoSalud,
  iniciarMuestreoSalud as nucleoIniciarMuestreoSalud,
  obtenerDispositivo as nucleoObtenerDispositivo,
} from "@/lib/e14/obs/dispositivo";
import {
  appVersion as nucleoAppVersion,
  idDispositivo as nucleoIdDispositivo,
  idSesion as nucleoIdSesion,
} from "@/lib/e14/obs/identidad";
import { descargarReporte as nucleoDescargarReporte } from "@/lib/e14/obs/export";
import {
  leerFlags as nucleoLeerFlags,
  refrescarFlags as nucleoRefrescarFlags,
} from "@/lib/e14/flags";
// KIT e14-adaptacion-dispositivo-v1 — núcleo nuevo (perfil/plan/informe IA).
import {
  obtenerPerfilDispositivo as nucleoObtenerPerfilDispositivo,
  type PerfilDispositivo as PerfilDispositivoAdaptacion,
} from "@/lib/e14/adaptacion/perfil";
import {
  planAdaptativo as nucleoPlanAdaptativo,
  type PlanAdaptativo as PlanAdaptativoAdaptacion,
} from "@/lib/e14/adaptacion/plan";
import { descargarInformeIA as nucleoDescargarInformeIA } from "@/lib/e14/adaptacion/informe-ia";
import type {
  ErroresAgrupados,
  FlagsApp,
  PoliticaDatos,
  SaludSnapshot,
} from "@/lib/e14/obs/tipos";

// ── Claves para FILTRAR los eventos de reactividad (valores pinned §4.1) ───
// La persistencia vive en el núcleo; aquí solo importan los nombres para
// decidir qué evento re-renderiza qué hook. CLAVE_POLITICA no la exporta el
// núcleo → literal local (mismo valor pinned).
const CLAVE_MODO_DEV = "e14-dev-mode"; // exportada también por obs/politica
const CLAVE_POLITICA = "e14-obs-politica";

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

// ── Modo dev (delega en obs/politica.ts — contrato §4.3) ───────────────────
function leerModoDev(): boolean {
  return nucleoLeerModoDev();
}

export function guardarModoDev(on: boolean): void {
  nucleoGuardarModoDev(on);
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

// ── Política de datos (delega en obs/politica.ts · defaults D4) ────────────
/** El núcleo aporta defaults + saneo de JSON corrupto (→ defaults + evento
 *  warn PoliticaCorrupta) — ya no hay spread local. */
function leerPolitica(): PoliticaDatos {
  return nucleoLeerPolitica();
}

export function guardarPolitica(p: PoliticaDatos): void {
  nucleoGuardarPolitica(p);
  emitirCambio(CLAVE_POLITICA);
}

// ── Overrides de flags (kill switch — ver desviación en el encabezado) ─────
function leerOverridesFlags(): Partial<FlagsApp> {
  return nucleoLeerOverridesFlags();
}

/** Semántica de REEMPLAZO completo: el caller pasa el objeto final (sin la
 *  clave = sin override). El núcleo hace MERGE y no puede BORRAR claves, así
 *  que el puente escribe el objeto final en la clave pinned (CLAVE_OVERRIDES,
 *  exportada por el núcleo); el saneo sigue en el núcleo vía leerFlags. */
export function guardarOverridesFlags(o: Partial<FlagsApp>): void {
  try {
    window.localStorage.setItem(CLAVE_OVERRIDES, JSON.stringify(o));
  } catch {
    /* modo privado: no persiste */
  }
  emitirCambio(CLAVE_OVERRIDES);
}

// ── Flags efectivas (delega en lib/e14/flags.ts — cadena REAL) ─────────────
/** DEFAULTS ← public/flags.json (cacheado 24 h, offline-safe) ← overrides
 *  (máxima prioridad). El endpoint hoy no existe → «sin-endpoint» honesto. */
export function leerFlags(): FlagsApp {
  return nucleoLeerFlags();
}

export async function refrescarFlags(): Promise<"ok" | "sin-endpoint" | "error"> {
  return nucleoRefrescarFlags();
}

// ── Salud del dispositivo (delega en obs/dispositivo.ts) ───────────────────
export type SnapshotDispositivo = SaludSnapshot & { os: string; ua: string };

/** El núcleo lee navigator/batería/storage (client-only) — el try/catch del
 *  puente mantiene la firma `| null` del contrato de UI: SSR o navegador
 *  sin APIs → null (la UI muestra "—", jamás inventa). */
export async function obtenerDispositivo(): Promise<SnapshotDispositivo | null> {
  try {
    return await nucleoObtenerDispositivo();
  } catch {
    return null;
  }
}

/** Muestreo 5 min del NÚCLEO: idempotente, solo corre con modo dev ON &&
 *  politica.saludEnVivo && flags.telemetriaSalud — re-verifica CADA tick y
 *  se auto-detiene (cero timers huérfanos con OFF). */
export function iniciarMuestreoSalud(): void {
  nucleoIniciarMuestreoSalud();
}

export function detenerMuestreoSalud(): void {
  nucleoDetenerMuestreoSalud();
}

// ── Buffer de eventos (delega en obs/buffer.ts — IDB e14-obs real) ─────────
export async function contarEventos(): Promise<number> {
  return nucleoContarEventos();
}

export async function eventosPorDigest(): Promise<ErroresAgrupados[]> {
  return nucleoEventosPorDigest();
}

export async function purgarBuffer(): Promise<void> {
  await nucleoPurgarBuffer();
}

// ── Identidad (delega en obs/identidad.ts) ─────────────────────────────────
/** UUID anónimo persistente (e14-obs-device-id). Nota FASE 1: el núcleo lo
 *  CREA en la primera lectura (lazy, diseño obs) — antes el puente solo leía. */
export function idDispositivo(): string | null {
  try {
    return nucleoIdDispositivo();
  } catch {
    return null; // jamás romper la UI por identidad
  }
}

/** UUID por sesión de página (memo del núcleo — estable dentro de la sesión). */
export function idSesion(): string | null {
  try {
    return nucleoIdSesion();
  } catch {
    return null;
  }
}

/** Versión horneada del build (package.json importado por el núcleo). */
export function appVersion(): string {
  return nucleoAppVersion();
}

// ── Export (delega en obs/export.ts — ReporteSesion del contrato) ──────────
/** ZIP (fflate level 0, muestras/ solo con miniaturas ON) o JSON; con
 *  vaciarDespues purga el buffer (D1: export MANUAL). */
export async function descargarReporte(
  formato: "zip" | "json",
  vaciarDespues: boolean,
): Promise<{ nombre: string; bytes: number }> {
  return nucleoDescargarReporte(formato, vaciarDespues);
}

// ── Hooks de política/overrides reactivos (consumidor: PanelDev C4) ────────

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

// ── KIT e14-adaptacion-dispositivo-v1 (perfil + plan + informe IA) ─────────
// La UI (PanelDev) codifica contra el puente — misma costumbre que el resto
// del núcleo obs. Los módulos adaptacion/* ya son null-honestos y jamás
// lanzan; los try/catch del puente solo cubren SSR.

export type { PerfilDispositivo } from "@/lib/e14/adaptacion/perfil";
export type { PlanAdaptativo } from "@/lib/e14/adaptacion/plan";

export async function obtenerPerfilDispositivo(
  forzar = false,
): Promise<PerfilDispositivoAdaptacion | null> {
  try {
    return await nucleoObtenerPerfilDispositivo(forzar);
  } catch {
    return null;
  }
}

export function planAdaptativo(): PlanAdaptativoAdaptacion {
  return nucleoPlanAdaptativo();
}

export async function descargarInformeIA(): Promise<{ nombre: string; bytes: number }> {
  return nucleoDescargarInformeIA();
}
