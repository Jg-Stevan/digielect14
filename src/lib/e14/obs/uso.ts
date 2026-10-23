/**
 * KIT e14-observabilidad-v1 (A1-C4) — uso de features: cuántas veces el
 * operador hace cada cosa, SIN una línea de contenido.
 *
 * · registrarUso(vista, accion) — merge in-place sobre un mapa en memoria
 *   (clave dia|vista|accion → n); flush al buffer (eventos tipo `uso` con
 *   datos UsoContador) cada 30 s o al visibilitychange → hidden (deltas:
 *   se appendea lo acumulado y el mapa se limpia).
 * · iniciarUso() — idempotente: suscripción SELECTIVA a useE14Store y
 *   useMasivaStore para las transiciones clave:
 *     · cambio de vista (→ breadcrumb tipo vista + contador «abrir-vista»)
 *     · fila MASIVA → PROCESANDO/LISTA/ERROR/DUPLICADA/YA-ENVIADA
 *       (los nombres REALES del contrato EstadoEntrada — jamás inventar).
 *
 * La vista actual: el shell alterna vistas con `vista` del useE14Store
 * (page.tsx la renderiza) — se engancha por SUSCRIPCIÓN, sin editar un
 * solo componente (kit A1-C4). Cero PII: los contadores llevan NOMBRES de
 * vista/acción/estado, nunca ids de fila ni contenido (§2.5).
 */
import { useE14Store } from "../store";
import { useMasivaStore } from "../masiva/store";
import { appendEvento } from "./buffer";
import { registrarVista } from "./breadcrumbs";
import { idDispositivo, idSesion, appVersion } from "./identidad";
import type { UsoContador } from "./tipos";

const FLUSH_MS = 30_000;

/** "2026-10-23" en HORA LOCAL (determinista, sin Intl). */
export function diaDe(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Mapa en memoria: clave `dia|vista|accion` → contador. */
const contadores = new Map<string, UsoContador>();

/** Merge in-place (PURA vía helper — testeada). */
export function mezclarContador(
  dia: string,
  vista: string,
  accion: string,
  n = 1,
): void {
  const clave = `${dia}|${vista}|${accion}`;
  const actual = contadores.get(clave);
  if (actual) actual.n += n;
  else contadores.set(clave, { dia, vista, accion, n });
}

/** Volcar el mapa: deltas listos para append + mapa limpio (PURA). */
export function volcarContadores(): UsoContador[] {
  const salida = [...contadores.values()];
  contadores.clear();
  return salida;
}

/** registrarUso del contrato §4.3 — merge en memoria; el flush lo dispara
 *  el timer/visibility (o el próximo iniciarUso). Nunca lanza. */
export async function registrarUso(vista: string, accion: string): Promise<void> {
  try {
    mezclarContador(diaDe(new Date()), vista, accion);
  } catch {
    /* silencioso */
  }
}

/** Flush real al buffer (deltas). appendEvento es silencioso y
 *  anti-recursivo — el flush jamás lanza. */
export async function flushUso(): Promise<void> {
  try {
    const deltas = volcarContadores();
    const sesion = idSesion();
    const dispositivo = idDispositivo();
    const version = appVersion();
    for (const contador of deltas) {
      await appendEvento({
        tipo: "uso",
        ts: Date.now(),
        sesion,
        dispositivo,
        appVersion: version,
        datos: contador,
      });
    }
  } catch {
    /* silencioso */
  }
}

let iniciado = false;

/** Suscripciones selectivas + timers (idempotente — el bootstrap C7 llama
 *  una vez). SSR-safe: solo corre en cliente. */
export function iniciarUso(): void {
  try {
    if (iniciado || typeof window === "undefined") return;
    iniciado = true;

    // Vistas — la transición vive en el useE14Store (el shell la renderiza).
    useE14Store.subscribe((estado, previo) => {
      try {
        if (estado.vista === previo.vista) return;
        registrarVista(estado.vista); // breadcrumb tipo vista
        void registrarUso(estado.vista, "abrir-vista");
      } catch {
        /* silencioso */
      }
    });

    // Filas MASIVA — transiciones de estado (diff de mapa id→desenlace).
    const desenlaceDe = (f: { estado: string; acta?: { status?: string } | null }): string =>
      f.acta?.status ? `${f.estado}/${f.acta.status}` : f.estado;
    const mapaDesenlaces = new Map<string, string>();
    const syncMapa = (filas: { id: string; estado: string; acta?: { status?: string } | null }[]) => {
      const nuevo = new Map<string, string>();
      for (const f of filas) nuevo.set(f.id, desenlaceDe(f));
      // transiciones: compara contra el mapa previo (las filas nuevas entran
      // sin contador — solo cuentan los CAMBIOS, no la carga inicial)
      for (const [id, desenlace] of nuevo) {
        const previo = mapaDesenlaces.get(id);
        if (previo !== undefined && previo !== desenlace) {
          void registrarUso("masiva", `fila→${desenlace}`);
        }
      }
      mapaDesenlaces.clear();
      for (const [id, d] of nuevo) mapaDesenlaces.set(id, d);
    };

    useMasivaStore.subscribe((estado) => {
      try {
        syncMapa(estado.filas);
      } catch {
        /* silencioso */
      }
    });

    // Flush periódico + al ocultar la pestaña (el gesto «cerrar y llevarse
    // el reporte» no pierde los contadores del tramo final).
    window.setInterval(() => void flushUso(), FLUSH_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushUso();
    });
  } catch {
    /* silencioso */
  }
}
