/**
 * KIT e14-puente-supervision-v1 (§6) — AUTO-PUSH: cada acta que el operador
 * ENVÍA sale también hacia el panel de supervisión.
 *
 * Patrón EXACTO del persister de store.ts (~L1372-1403): suscripción única
 * al store zustand con última REFERENCIA de `actaActual` guardada en módulo
 * — el cambio de identidad es el evento exacto (comparar JSON de ~14 MB por
 * cada set sería prohibitivo, misma razón del persister).
 *
 * Disparo: actaActual cambió de referencia && status === "ENVIADA" &&
 * fotoProcesada existe → mapear (§3) + encolar (§2) + `void
 * enviarPendientes()` FIRE-AND-FORGET con debounce (si ya hay un envío en
 * curso no se lanza otro — el ciclo drena TODA la cola, los encolados
 * durante el vuelo viajan en la próxima pasada).
 *
 * Guard D6 (doctrina del repo): las actas de SIMULACIÓN jamás contaminan el
 * panel real — misma exclusión del slot del persister (fuente SIMULACION).
 *
 * REGLA DE ORO §2.4: TODO el cuerpo en try/catch — el auto-push jamás rompe
 * la app ni el flujo de envío individual del store.
 */
import type { Acta } from "../types";
import { useE14Store } from "../store";
import { encolarActa } from "./cola";
import { enviarPendientes } from "./envio";
import { mapearActaAPuente } from "./mapear";

let iniciado = false;
/** Última referencia vista de actaActual (patrón ultimaActaPersistida). */
let ultimaActaVista: Acta | null | undefined = undefined;
/** Debounce del disparo: un envío en vuelo a la vez. */
let empujeEnVuelo = false;

/** Trabajo async del disparo: mapear → encolar → drenar (fire-and-forget). */
async function empujarActa(acta: Acta): Promise<void> {
  try {
    const entrada = await mapearActaAPuente(acta);
    if (!entrada) return; // sin join DIVIPOL / sin foto — se salta (§3)
    await encolarActa(entrada);
    if (empujeEnVuelo) return; // debounce: el ciclo en vuelo ya drena
    empujeEnVuelo = true;
    try {
      await enviarPendientes();
    } finally {
      empujeEnVuelo = false;
    }
  } catch {
    /* silencioso — el auto-push jamás rompe la app */
  }
}

/**
 * Suscribir el auto-push al store (idempotente — llamada única en el
 * bootstrap de page.tsx). Solo cliente (guard typeof window — SSR jamás
 * monta suscripción).
 */
export function iniciarPuenteSupervision(): void {
  try {
    if (iniciado) return; // idempotente
    if (typeof window === "undefined") return;
    iniciado = true;
    useE14Store.subscribe((s) => {
      try {
        if (s.actaActual === ultimaActaVista) return; // mismo acta en RAM
        ultimaActaVista = s.actaActual;
        const acta = s.actaActual;
        if (!acta) return;
        if (acta.status !== "ENVIADA") return; // solo desenlaces enviados
        if (!acta.fotoProcesada) return; // sin evidencia no viaja
        if (acta.fuente === "SIMULACION") return; // guard D6 (ver cabecera)
        void empujarActa(acta); // fire-and-forget — sin await en el store
      } catch {
        /* silencioso — la suscripción jamás rompe el set del store */
      }
    });
  } catch {
    /* silencioso — el enganche jamás rompe el bootstrap */
  }
}
