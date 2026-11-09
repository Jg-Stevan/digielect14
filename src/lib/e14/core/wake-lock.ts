/**
 * KIT e14-remediacion-movil-v1 (A2 — Screen Wake Lock, P0 #5).
 *
 * EL PORQUÉ: un escaneo E-14 ronda los 120 s y la pantalla del móvil se
 * apaga sola a mitad de camino — el SO no ve «actividad del usuario» (la
 * cámara corre por rVFC/workers, no por toques) y bloquea la pantalla. Al
 * despertar la app sigue viva pero congelada (el SO pausa timers/rVFC —
 * mismo fantasma de fondo que §G.4 de obs/hang.ts) y el operador pierde la
 * captura en curso: reproduce el P0 #4. La cura es el Screen Wake Lock:
 * mientras la vista de escaneo está activa se pide
 * `navigator.wakeLock.request("screen")` y la pantalla no se apaga.
 *
 * CONTRATO:
 *  · usarWakeLock(activo) — hook (React 19: useEffect + refs, sin estado
 *    de UI — un cambio del lock JAMÁS re-renderiza la cámara): true →
 *    request; false → release. El SO SUELTA el lock solo al ocultar la
 *    pestaña (mandato del estándar — no se pelea): el sentinel avisa por
 *    su evento `release` y en `visibilitychange → visible` se RE-ADQUIERE
 *    si el hook seguía activo.
 *  · Sin API / NotAllowedError / NotSupportedError / SecurityError →
 *    NO-OP SILENCIOSO: son condiciones del entorno (Safari viejo, http sin
 *    contexto seguro, request sin gesto reciente) y JAMÁS ensucian la
 *    consola. Solo un error INESPERADO sale por logger.warn (canal SIEMPRE
 *    del paquete — degradación real que el operador debe poder ver).
 *  · Observabilidad BARATA (fuera del buffer obs: TipoEvento es
 *    append-only D57 y NO existe tipo "entorno" — colar estos datos bajo
 *    "uso"/"salud" contaminaría la agregación del ReporteSesion):
 *      - logger del paquete (info SOLO-dev: el build de producción elimina
 *        las llamadas por sustitución estática de NODE_ENV):
 *        "[e14] wakeLock adquirido|perdido".
 *      - contador global window.__e14WakeLock = { activo, reAdquisiciones
 *        } — vivo en el dispositivo, siempre inspeccionable por QA sin
 *        tocar la consola del operador.
 *  · TODO defensivo: try/catch total, jamás lanza, SSR-safe. El acceso a
 *    navigator.wakeLock va por casts (`as unknown as`) con type guard —
 *    SIN tocar lib.dom ni globals.d.ts (el WakeLockSentinel local es el
 *    mínimo de la spec; la lib.dom de TS 5.9 ya trae el suyo, pero esta
 *    forma defensiva sobrevive a un downgrade de TS o de lib).
 */

import { useEffect, useRef } from "react";
import { logger } from "@jg-stevan/scanner-core/dominio/logger";

// ─── Tipos locales (SIN tocar lib.dom ni globals.d.ts) ─────────────────
// La API puede NO existir en runtime (Safari < 16.4, http sin contexto
// seguro): el tipo local es OPCIONAL por diseño y el acceso se guarda con
// type guard antes de cualquier llamada.

/** Sentinel mínimo del Screen Wake Lock (forma según la spec W3C). */
interface WakeLockSentinel {
  readonly released: boolean;
  readonly type: "screen";
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

/** Franja de navigator con la API — opcional (puede no existir). */
type NavigatorConWakeLock = Navigator & {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinel>;
  };
};

/** Contador global de observabilidad — window.__e14WakeLock (QA sin consola). */
interface ContadorWakeLock {
  activo: boolean;
  reAdquisiciones: number;
}

/** Errores de ENTORNO esperados → silencio total (no son defectos: sin
 *  gesto reciente, sin soporte del tipo "screen" o sin contexto seguro).
 *  Todo lo demás sí es anomalía y sale por logger.warn. */
const ERRORES_ESPERADOS = new Set([
  "NotAllowedError",
  "NotSupportedError",
  "SecurityError",
]);

// ─── Observabilidad barata (helpers de módulo — jamás lanzan) ───────────

/** Traza SOLO-dev (logger.info se elimina del bundle de producción — la
 *  consola del operador queda intacta). El caller ya formateó el estado. */
function trazar(mensaje: string): void {
  try {
    logger.info(`[e14] wakeLock ${mensaje}`);
  } catch {
    /* silencioso — el rastreo jamás lanza */
  }
}

/** Error INESPERADO (fuera de ERRORES_ESPERADOS): canal SIEMPRE del logger
 *  (consola + transporte obs como "warn"). Los esperados no llegan aquí. */
function registrarFallo(error: unknown): void {
  const nombre = error instanceof Error ? error.name : "desconocido";
  if (ERRORES_ESPERADOS.has(nombre)) return; // entorno esperado → silencio
  try {
    const detalle =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.warn(`[e14] wakeLock error — ${detalle}`);
  } catch {
    /* silencioso */
  }
}

/** Anota el estado en el contador global window.__e14WakeLock (crea el
 *  objeto si no existe; mutación in-place, sin recrear). Jamás lanza. */
function anotar(activo: boolean, reAdquisicion: boolean): void {
  try {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __e14WakeLock?: ContadorWakeLock };
    const contador =
      w.__e14WakeLock ?? (w.__e14WakeLock = { activo: false, reAdquisiciones: 0 });
    contador.activo = activo;
    if (reAdquisicion) contador.reAdquisiciones += 1;
  } catch {
    /* silencioso — la observabilidad jamás rompe al caller */
  }
}

/** Type guard de la API: la franja de navigator con wakeLock, o null si no
 *  existe (Safari viejo / http) o el request no es función. Jamás lanza. */
function wakeLockApi(): NonNullable<NavigatorConWakeLock["wakeLock"]> | null {
  try {
    if (typeof navigator === "undefined") return null;
    if (!("wakeLock" in navigator)) return null; // API ausente → no-op
    const api = (navigator as unknown as NavigatorConWakeLock).wakeLock;
    if (!api || typeof api.request !== "function") return null;
    return api;
  } catch {
    return null;
  }
}

/** ¿El documento está a la vista? request() con la pestaña oculta LANZA
 *  (NotAllowedError del estándar) — se guarda ANTES de pedir. */
function documentoVisible(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState === "visible";
  } catch {
    return false; // sin forma de saberlo → no pedir (conservador)
  }
}

/** Suelta un sentinel en silencio (el release devuelve promesa — puede
 *  rechazar si ya se liberó: irrelevante). Jamás lanza. */
function liberarSentinela(sentinela: WakeLockSentinel): void {
  try {
    if (sentinela.released) return;
    void sentinela.release().catch(() => {
      /* ya liberado / estado intermedio — irrelevante */
    });
  } catch {
    /* silencioso */
  }
}

/**
 * Hook del wake lock — usarWakeLock(activo: boolean): void.
 *
 * Monta la energía SOLO mientras `activo` es true (la vista de escaneo lo
 * llama con su propio estado de sesión):
 *   · true  → request("screen") (+ re-adquisición en visibilitychange →
 *     visible y en sentinel `release` con la pestaña a la vista).
 *   · false → release inmediato y sin listeners (cero costo).
 *
 * El estado vive en REFS: la pantalla de la cámara no re-renderiza por el
 * lock. Carreras cubiertas: un acquire en vuelo cuando llega el cleanup
 * (unmount / activo→false) suelta el sentinel tardío en silencio, y un
 * acquire duplicado nunca deja dos locks vivos.
 */
export function useWakeLock(activo: boolean): void {
  // NOTA de nombre: la convención del repo usa prefijos en español (usar*),
  // pero un HOOK REAL debe llamarse `use*` — la regla rules-of-hooks de
  // ESLint solo reconoce el prefijo literal `use` (lint del kit A2).
  const activoRef = useRef(activo);
  const sentinelaRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    activoRef.current = activo;

    /** Suelta el sentinel VIGENTE. Primero se des-engancha del ref para que
     *  el evento `release` (que el navegador dispara TAMBIÉN en un release
     *  manual) no cuente como «perdido». Jamás lanza. */
    const soltarVigente = (): void => {
      const vigente = sentinelaRef.current;
      sentinelaRef.current = null;
      if (vigente) liberarSentinela(vigente);
      anotar(false, false);
    };

    /** Pide el lock (idempotente). reAdquisicion=true solo cuando RESCATA
     *  una pérdida del SO — es lo que cuenta el contador global. */
    const adquirir = async (reAdquisicion: boolean): Promise<void> => {
      try {
        if (!activoRef.current) return;
        const vigente = sentinelaRef.current;
        if (vigente && !vigente.released) return; // el lock ya está vivo
        const api = wakeLockApi();
        if (!api) return; // sin API (Safari viejo / http) → no-op silencioso
        if (!documentoVisible()) return; // request() en hidden LANZA → guardar antes
        const sentinela = await api.request("screen");
        // Carrera: mientras el await, `activo` pudo apagarse (unmount o
        // cambio del prop) u otra adquisición ya dejó SU sentinel — el
        // duplicado/tardío se suelta en silencio (nunca dos locks vivos).
        if (
          !activoRef.current ||
          (sentinelaRef.current && !sentinelaRef.current.released)
        ) {
          liberarSentinela(sentinela);
          return;
        }
        sentinelaRef.current = sentinela;
        // El SO puede soltar el lock SOLO (pestaña oculta, ahorro de batería):
        // el evento `release` marca la pérdida y la anota en el contador.
        const alRelease = (): void => {
          try {
            if (sentinelaRef.current !== sentinela) return; // release manual → no es pérdida
            sentinelaRef.current = null;
            anotar(false, false);
            trazar("perdido");
            // Pérdida CON la pestaña a la vista → re-adquirir YA (el
            // visibilitychange no disparará: el documento nunca se ocultó).
            if (activoRef.current && documentoVisible()) {
              void adquirir(true);
            }
          } catch {
            /* silencioso */
          }
        };
        sentinela.addEventListener("release", alRelease);
        if (sentinela.released) {
          // Liberado ANTES de poder escuchar (carrera rara): el evento ya
          // se disparó — corregir el estado por el mismo camino.
          alRelease();
          return;
        }
        anotar(true, reAdquisicion);
        trazar(reAdquisicion ? "adquirido (re-adquisición)" : "adquirido");
      } catch (error) {
        registrarFallo(error);
      }
    };

    if (!activo) {
      soltarVigente();
      return; // inactivo: sin lock ni listeners (cero costo)
    }

    void adquirir(false);

    // Al VOLVER a «visible»: si el hook seguía activo y el lock se perdió
    // (el SO lo suelta al ocultar la pestaña), se re-adquiere.
    const alVisibilidad = (): void => {
      try {
        if (document.visibilityState !== "visible") return;
        if (!activoRef.current) return;
        const vigente = sentinelaRef.current;
        if (vigente && !vigente.released) return; // el lock sobrevivió
        void adquirir(true);
      } catch {
        /* silencioso */
      }
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", alVisibilidad);
    }

    return () => {
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", alVisibilidad);
      }
      activoRef.current = false; // corta los acquire en vuelo (carrera del await)
      soltarVigente();
    };
  }, [activo]);
}
