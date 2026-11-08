/**
 * KIT sincronia-pestanas-v1 (plan de remediación — bloque 6.12, parte store):
 * coordinación MÍNIMA entre pestañas para la jornada compartida (IndexedDB es
 * por-origen: dos pestañas de la PWA escriben la MISMA jornada).
 *
 *  · Web Locks → reclamarEdicionExclusiva(): una pestaña editora a la vez.
 *  · BroadcastChannel("e14-jornada") → emitir/suscribirse a «jornada-cambiada»
 *    para la re-hidratación pasiva del store.
 *
 * REGLA DE ORO: la sincronía JAMÁS rompe la app — todo está envuelto en
 * try/catch silencioso y degrada a «sin coordinación» (comportamiento de
 * siempre: último-escritor-gana) si la API no existe o falla.
 */

/** Nombre del canal BroadcastChannel compartido por todas las pestañas. */
const NOMBRE_CANAL = "e14-jornada";
/** Nombre del lock Web Locks de edición exclusiva. */
const NOMBRE_LOCK = "e14-jornada-edicion";

/** Canal perezoso (una instancia por pestaña — se crea al primer uso).
 *  null = BroadcastChannel no disponible → sin avisos entre pestañas. */
let canal: BroadcastChannel | null = null;
function canalPerezoso(): BroadcastChannel | null {
  if (canal) return canal;
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    canal = new BroadcastChannel(NOMBRE_CANAL);
    return canal;
  } catch {
    canal = null; // regla de oro: sin canal, sin coordinación (silencioso)
    return null;
  }
}

/** Libera el lock retenido por reclamarEdicionExclusiva (solo para tests /
 *  cierre explícito — el navegador lo suelta al morir la pestaña igual). */
let soltarLock: (() => void) | null = null;

/**
 * Reclama la EDICIÓN EXCLUSIVA de la jornada para esta pestaña (Web Locks
 * con ifAvailable — jamás espera en cola). El lock se RETIENE hasta que la
 * pestaña muere: otra pestaña que lo pida recibe false.
 * · Sin navigator.locks (navegador viejo / contexto no seguro) → true con
 *   degradación honesta: sin coordinación posible, se permite editar
 *   (comportamiento de siempre).
 * · Cualquier error → true (regla de oro).
 */
export async function reclamarEdicionExclusiva(): Promise<boolean> {
  if (soltarLock) return true; // esta pestaña ya es la editora
  try {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks?.request) return true; // sin Web Locks → sin coordinación (permitir)
    let soltar: () => void = () => {};
    // El lock solo se retiene MIENTRAS el callback está vivo: retenemos una
    // promesa que nunca resuelve (se libera al morir la pestaña o en
    // liberarEdicionExclusiva).
    const retenido = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const lock = await locks.request(NOMBRE_LOCK, { ifAvailable: true }, () => retenido);
    if (lock === null) return false; // otra pestaña tiene la edición
    soltarLock = soltar;
    return true;
  } catch {
    return true; // regla de oro: el lock jamás bloquea la app
  }
}

/** Suelta el lock de edición (best-effort; el navegador lo suelta igual). */
export function liberarEdicionExclusiva(): void {
  try {
    soltarLock?.();
  } catch {
    /* silencioso */
  } finally {
    soltarLock = null;
  }
}

/** Avisa a las OTRAS pestañas que la jornada persistida cambió (el emisor
 *  NO se recibe a sí mismo — semántica de BroadcastChannel). */
export function emitirJornadaCambiada(): void {
  try {
    canalPerezoso()?.postMessage({ tipo: "jornada-cambiada", ts: Date.now() });
  } catch {
    /* silencioso — la otra pestaña vivirá sin el aviso (como hoy) */
  }
}

/**
 * Se suscribe a «jornada-cambiada» de las OTRAS pestañas. Devuelve la
 * función de des-suscripción (simétrica, segura de llamar dos veces).
 * Sin canal → suscripción nula (no-op).
 */
export function suscribirseAJornadaCambiada(cb: () => void): () => void {
  const c = canalPerezoso();
  if (!c) return () => {};
  const alMensaje = (e: MessageEvent) => {
    try {
      const data = e.data as { tipo?: string } | null;
      if (data?.tipo === "jornada-cambiada") cb();
    } catch {
      /* mensaje ajeno/corrupto → ignorar (silencioso) */
    }
  };
  try {
    c.addEventListener("message", alMensaje);
  } catch {
    return () => {};
  }
  return () => {
    try {
      c.removeEventListener("message", alMensaje);
    } catch {
      /* silencioso */
    }
  };
}
