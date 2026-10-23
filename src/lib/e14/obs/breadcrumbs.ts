/**
 * KIT e14-observabilidad-v1 (A1-C3/C4) — breadcrumbs: el ring buffer 30 en
 * memoria del «cómo llegamos al fallo».
 *
 * · registrarBreadcrumb(b) — push público (ring FIFO, max 30).
 * · obtenerBreadcrumbs() — snapshot del ring (los últimos 30, en orden
 *   cronológico) — lo consumen logger/captura al construir ErrorEvento.
 * · registrarVista(v) — transición de vista (la engancha uso.ts/C4 vía
 *   suscripción al store — SIN editar componentes).
 * · iniciarBreadcrumbs() — (C4) listener global `click` en capture+passive
 *   que extrae aria-label/data-accion del target — JAMÁS textContent del
 *   acta (cero PII, README-KITS §2.5).
 *
 * Ring en MEMORIA (muere con la sesión): los breadcrumbs solo valen como
 * contexto INMEDIATO de un error — persistirlos aparte no aporta (el error
 * ya viaja con los últimos 30 adjuntos).
 */
import type { Breadcrumb } from "./tipos";

const MAX_BREADCRUMBS = 30;

let ring: Breadcrumb[] = [];

/** Push al ring (FIFO 30). Nunca lanza (regla de oro §2.4). */
export function registrarBreadcrumb(b: Omit<Breadcrumb, "t">): void {
  try {
    ring.push({ ...b, t: Date.now() });
    if (ring.length > MAX_BREADCRUMBS) ring = ring.slice(-MAX_BREADCRUMBS);
  } catch {
    /* silencioso */
  }
}

/** Transición de vista — tipo "vista" del contrato (detalle = nombre de
 *  vista; jamás contenido). La consume uso.ts (C4) en su suscripción. */
export function registrarVista(vista: string): void {
  registrarBreadcrumb({ tipo: "vista", detalle: vista });
}

/** Snapshot cronológico del ring (copia — el ring sigue vivo). */
export function obtenerBreadcrumbs(): Breadcrumb[] {
  return [...ring];
}

/** (C4) Listener global de clicks + hook de vista — idempotente. Stub
 *  compilable en C3: la firma es del contrato §4.3 y page.tsx (C7) la
 *  llama; el wiring real llega con uso.ts en C4. */
export function iniciarBreadcrumbs(): void {
  /* wiring C4 */
}
