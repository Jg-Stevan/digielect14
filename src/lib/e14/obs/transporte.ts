/**
 * KIT e14-observabilidad-v1 (A3-C1) — TRANSPORTE HTTP de reportes: la ÚNICA
 * salida de datos por red de la app, APAGADA por defecto (D1: nada sale del
 * dispositivo sin acción explícita).
 *
 * Contrato README-KITS §4.3 (firmas EXACTAS del stub del agente 1):
 *  · iniciarTransporte() — idempotente; no-op TOTAL si
 *    leerFlags().endpointReportes === null (cero timers, cero listeners,
 *    estado {activo:false, …}).
 *  · estadoTransporte() — { activo, lotesPendientes, fallosSeguidos }.
 *
 * Outbox PROPIO (§4.1): IndexedDB `e14-obs-outbox` v1, store `lotes`
 * (keyPath `id`) — JAMÁS abre el DB `e14-obs` del buffer del agente 1.
 *
 * Flujo (con endpoint configurado): un batcher cada BATCHER_MS toma hasta
 * LOTE_TOPE eventos de error/warn/salud/uso del buffer (leerEventos), los
 * escribe al outbox como lote {id, ts, intentos: 0} y los envía:
 *  · POST endpointReportes con {loteId, deviceId, appVersion, eventos[]} —
 *    scrub previo por leerPolitica() (sin textoOcr/miniaturas si están OFF;
 *    JAMÁS viaja contenido de actas: solo lo que la política libere).
 *  · Reintentos exponenciales por lote (BACKOFF_MS: 1m → 5m → 30m, tope
 *    3 intentos; el lote vencido queda pendiente como evidencia).
 *  · KILL LOCAL (constante FALLOS_KILL_LOCAL = 3): tras 3 fallos seguidos
 *    del mismo endpoint el transporte se auto-detiene (activo:false) y deja
 *    el outbox INTACTO — se reactiva manualmente desde iniciarTransporte()
 *    o al reiniciar la app (el arranque re-lee el outbox: modo avión →
 *    envía al recuperar). Un éxito reinicia el contador de fallos.
 *
 * Semántica de entrega: AL MENOS UNA VEZ — los eventos NO se borran del
 * buffer (las exportaciones y el panel dev siguen leyéndolos); el receptor
 * deduplica por evento.id (EventoObs del contrato §4.2). El transporte
 * jamás serializa contenido binario: solo JSON de metadatos.
 *
 * REGLA DE ORO §2.4: TODO try/catch silencioso (el rastreo jamás rompe la
 * app); cero consola nativa — logger.warn SOLO para la autodetención.
 */
import { leerFlags } from "../flags";
import { logger } from "../../logger";
import { leerEventos } from "./buffer";
import { appVersion, idDispositivo, nuevoUuid } from "./identidad";
import { leerPolitica } from "./politica";
import type { EventoObs, PoliticaDatos } from "./tipos";

const DB_OUTBOX = "e14-obs-outbox";
const DB_VERSION = 1;
const STORE_LOTES = "lotes";

/** Batcher: cada 10 min (kit A3-C1 · ancla QA A3-C3g). */
export const BATCHER_MS = 10 * 60 * 1000;
/** Tope de eventos por lote (kit A3-C1 · ancla QA A3-C3g). */
export const LOTE_TOPE = 50;
/** KILL LOCAL: 3 fallos seguidos del mismo endpoint → autodetención con
 *  outbox intacto (kit A3-C1 · ancla QA A3-C3c). */
export const FALLOS_KILL_LOCAL = 3;
/** Backoff exponencial por lote: intento 1 → +1m · 2 → +5m · 3 → +30m
 *  (tope 3 intentos — kit A3-C1 · ancla QA A3-C3d). */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000] as const;

/** Tipos que el batcher cosecha del buffer (kit A3-C1 — perf NO viaja por
 *  red: ese dato llega al dueño por export manual / reporte de sesión). */
const TIPOS_LOTE: ReadonlySet<EventoObs["tipo"]> = new Set([
  "error",
  "warn",
  "salud",
  "uso",
]);

/** Lote del outbox (store `lotes`, keyPath `id` — §4.1). */
interface LoteOutbox {
  id: string;
  ts: number;
  intentos: number;
  eventos: EventoObs[];
}

interface EstadoTransporte {
  activo: boolean;
  lotesPendientes: number;
  fallosSeguidos: number;
}

let estado: EstadoTransporte = {
  activo: false,
  lotesPendientes: 0,
  fallosSeguidos: 0,
};
let timerBatcher: ReturnType<typeof setInterval> | null = null;
let timerReintento: ReturnType<typeof setTimeout> | null = null;
let enviando = false;
/** Dedupe de cosecha por sesión (at-least-once: tras un reinicio pueden
 *  reenviarse eventos aún vivos del buffer — el receptor deduplica por id). */
let idsCosechados = new Set<string>();

// ─── Outbox — IndexedDB PROPIO (`e14-obs-outbox`; jamás el `e14-obs`) ──────

let dbSingleton: IDBDatabase | null = null;

/** Abrir el outbox (singleton idempotente, patrón buffer.ts). */
function abrirOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbSingleton) {
      resolve(dbSingleton);
      return;
    }
    if (typeof indexedDB === "undefined") {
      reject(new Error("SIN_INDEXEDDB"));
      return;
    }
    const req = indexedDB.open(DB_OUTBOX, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOTES)) {
        db.createObjectStore(STORE_LOTES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      dbSingleton = req.result;
      // Higiene (patrón buffer.ts): conexión cerrada → re-abrir después.
      dbSingleton.onclose = () => {
        dbSingleton = null;
      };
      resolve(dbSingleton);
    };
    req.onerror = () => reject(req.error ?? new Error("OUTBOX_NO_ABRIO"));
    req.onblocked = () => reject(new Error("OUTBOX_BLOQUEADA"));
  });
}

/** Envolver un request IDB en promesa (patrón buffer.ts). */
function pedir<T>(req: IDBRequest<T>, contexto: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(contexto));
  });
}

/** Esperar el cierre de una transacción (patrón buffer.ts). */
function esperarTx(store: IDBObjectStore, contexto: string): Promise<void> {
  const tx = store.transaction;
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(contexto));
    tx.onabort = () => reject(tx.error ?? new Error(`${contexto}_ABORTADA`));
  });
}

function storeDe(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_LOTES, modo).objectStore(STORE_LOTES);
}

async function guardarLote(lote: LoteOutbox): Promise<void> {
  const db = await abrirOutbox();
  const store = storeDe(db, "readwrite");
  store.put(lote);
  await esperarTx(store, "OUTBOX_PUT");
}

/** Lotes pendientes en orden FIFO (ts ASC — los viejos salen primero). */
async function leerLotes(): Promise<LoteOutbox[]> {
  try {
    const db = await abrirOutbox();
    const lotes = await pedir<LoteOutbox[]>(
      storeDe(db, "readonly").getAll() as IDBRequest<LoteOutbox[]>,
      "OUTBOX_LEER",
    );
    return lotes.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  } catch {
    return [];
  }
}

async function borrarLote(id: string): Promise<void> {
  const db = await abrirOutbox();
  const store = storeDe(db, "readwrite");
  store.delete(id);
  await esperarTx(store, "OUTBOX_DELETE");
}

async function contarLotes(): Promise<number> {
  try {
    const db = await abrirOutbox();
    return await pedir<number>(storeDe(db, "readonly").count(), "OUTBOX_CONTAR");
  } catch {
    return 0;
  }
}

/** Reactivación (manual o reinicio de la app): presupuesto de reintentos
 *  fresco para los lotes pendientes. El outbox JAMÁS se borra aquí. */
async function reactivarPresupuesto(): Promise<void> {
  try {
    const db = await abrirOutbox();
    const lotes = await pedir<LoteOutbox[]>(
      storeDe(db, "readonly").getAll() as IDBRequest<LoteOutbox[]>,
      "OUTBOX_REACT_LEER",
    );
    const conCargo = lotes.filter((l) => l.intentos !== 0);
    if (conCargo.length === 0) return;
    const store = storeDe(db, "readwrite");
    for (const l of conCargo) store.put({ ...l, intentos: 0 });
    await esperarTx(store, "OUTBOX_REACTIVAR");
  } catch {
    /* silencioso */
  }
}

// ─── Scrub (puro) — solo lo que la política libere; jamás contenido ────────

/** Claves que jamás deben salir sin su toggle ON (defensa en profundidad:
 *  el buffer no las emite — si algo raro llegara, el transporte la retira). */
const CLAVE_TEXTO = /textoocr|ocrtexto|lecturaocr/i;
const CLAVE_VISUAL = /miniat|thumb|imagen|fotograf|data.?url/i;

/** Depura los eventos de un lote según la política vigente (PURE — testeada
 *  en transporte.test.ts): perf fuera si metadatos OFF; claves de contenido
 *  de texto OCR / miniaturas fuera si sus toggles están OFF (D4). */
export function depurarParaEnvio(
  eventos: EventoObs[],
  politica: PoliticaDatos,
): EventoObs[] {
  return eventos
    .filter((e) => politica.metadatos || e.tipo !== "perf")
    .map((e) => {
      const d = e.datos as Record<string, unknown> | null;
      if (typeof d !== "object" || d === null) return e;
      const datos: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) {
        if (!politica.textoOcr && CLAVE_TEXTO.test(k)) continue;
        if (!politica.miniaturas && CLAVE_VISUAL.test(k)) continue;
        datos[k] = v;
      }
      return { ...e, datos };
    });
}

// ─── Estado y detenciones ──────────────────────────────────────────────────

function limpiarTimers(): void {
  try {
    if (timerBatcher !== null) {
      clearInterval(timerBatcher);
      timerBatcher = null;
    }
    if (timerReintento !== null) {
      clearTimeout(timerReintento);
      timerReintento = null;
    }
  } catch {
    /* silencioso */
  }
}

/** Apagado limpio por cambio de flags (el endpoint desapareció) — sin aviso:
 *  es una decisión de configuración, no una degradación. */
function detenerSilencioso(): void {
  limpiarTimers();
  estado = { ...estado, activo: false };
}

/** KILL LOCAL: autodetención con outbox intacto + aviso único al operador. */
function detenerPorFallos(): void {
  detenerSilencioso();
  try {
    logger.warn(
      `[e14] transporte: autodetención tras ${FALLOS_KILL_LOCAL} fallos seguidos del endpoint (outbox intacto) — reactivar con iniciarTransporte() o reiniciar la app`,
    );
  } catch {
    /* silencioso */
  }
}

// ─── Envío ─────────────────────────────────────────────────────────────────

/** Enviar un lote. Éxito → lote borrado del outbox + contador de fallos a
 *  cero. Fallo (red o HTTP no-ok) → intentos++ del lote (persistido) y:
 *  kill local al llegar a FALLOS_KILL_LOCAL, o backoff exponencial. */
async function enviarLote(lote: LoteOutbox, endpoint: string): Promise<void> {
  let enviado = false;
  try {
    // Scrub previo (kit A3-C1): la política vigente decide en el MOMENTO
    // del envío — un toggle apagado después de cosechar igualmente retira
    // su contenido del sobre.
    const sobre = {
      loteId: lote.id,
      deviceId: idDispositivo(),
      appVersion: appVersion(),
      eventos: depurarParaEnvio(lote.eventos, leerPolitica()),
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sobre),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    enviado = true;
  } catch {
    enviado = false;
  }
  if (enviado) {
    try {
      await borrarLote(lote.id);
    } catch {
      /* el receptor ya lo recibió — el lote huérfano se reenviaría
       * duplicado (at-least-once) y el receptor deduplica por id */
    }
    estado.fallosSeguidos = 0;
    estado.lotesPendientes = Math.max(0, estado.lotesPendientes - 1);
    return;
  }
  try {
    await guardarLote({ ...lote, intentos: lote.intentos + 1 });
  } catch {
    /* silencioso — el lote queda como estaba (con su intento anterior) */
  }
  estado.fallosSeguidos += 1;
  if (estado.fallosSeguidos >= FALLOS_KILL_LOCAL) {
    detenerPorFallos();
    return;
  }
  programarReintento(lote.intentos + 1);
}

/** Backoff exponencial por lote: 1m → 5m → 30m (tope 3). Un solo reintento
 *  programado a la vez (los lotes se procesan FIFO en cada disparo). */
function programarReintento(intentos: number): void {
  try {
    if (!estado.activo || timerReintento !== null) return;
    const i = Math.min(Math.max(intentos, 1), BACKOFF_MS.length);
    const ms = BACKOFF_MS[i - 1];
    timerReintento = setTimeout(() => {
      timerReintento = null;
      void soloPendientes();
    }, ms);
  } catch {
    /* silencioso */
  }
}

/** Enviar SOLO lo pendiente del outbox (FIFO) — arranque/backlog/reintento.
 *  Un lote con intentos al tope se salta (queda pendiente como evidencia). */
async function soloPendientes(): Promise<void> {
  if (enviando) return;
  enviando = true;
  try {
    const endpoint = leerFlags().endpointReportes;
    if (!endpoint) {
      detenerSilencioso();
      return;
    }
    await enviarPendientesInternas(endpoint);
  } catch {
    /* silencioso — regla de oro 4 */
  } finally {
    enviando = false;
  }
}

/** Cosechar hasta LOTE_TOPE eventos nuevos del buffer → lote al outbox →
 *  envío. Los eventos NO salen del buffer (solo se copian al lote). */
async function cosechar(endpoint: string): Promise<void> {
  try {
    const candidatos = await leerEventos(
      (e) => TIPOS_LOTE.has(e.tipo) && !idsCosechados.has(e.id),
    );
    if (candidatos.length === 0) return;
    const lote: LoteOutbox = {
      id: nuevoUuid(),
      ts: Date.now(),
      intentos: 0,
      eventos: candidatos.slice(0, LOTE_TOPE),
    };
    for (const e of lote.eventos) idsCosechados.add(e.id);
    await guardarLote(lote);
    estado.lotesPendientes += 1;
    await enviarLote(lote, endpoint);
  } catch {
    /* silencioso */
  }
}

/** Ciclo del batcher: primero lo pendiente (FIFO), luego cosecha nueva. */
async function ciclo(): Promise<void> {
  if (enviando) return;
  enviando = true;
  try {
    const endpoint = leerFlags().endpointReportes;
    if (!endpoint) {
      detenerSilencioso();
      return;
    }
    await enviarPendientesInternas(endpoint);
    await cosechar(endpoint);
  } catch {
    /* silencioso */
  } finally {
    enviando = false;
  }
}

/** Envío interno ya con endpoint resuelto (para el ciclo del batcher). */
async function enviarPendientesInternas(endpoint: string): Promise<void> {
  const lotes = await leerLotes();
  for (const lote of lotes) {
    if (!estado.activo) return;
    if (lote.intentos >= BACKOFF_MS.length) continue;
    await enviarLote(lote, endpoint);
  }
}

// ─── Contrato §4.3 (firmas EXACTAS del stub del agente 1) ──────────────────

/** Idempotente. Con `flags.endpointReportes === null` (default): no-op TOTAL
 *  — cero timers, cero listeners, estado {activo:false, …} (D1). Con
 *  endpoint: batcher cada 10 min + backlog del outbox al arrancar. Llamable
 *  de nuevo tras un kill local para reactivar manualmente. */
export function iniciarTransporte(): void {
  try {
    if (estado.activo) return; // idempotente
    const endpoint = leerFlags().endpointReportes;
    if (!endpoint) return; // no-op TOTAL (D1)
    estado = {
      activo: true,
      lotesPendientes: estado.lotesPendientes,
      fallosSeguidos: 0, // reactivación manual → presupuesto de kill fresco
    };
    idsCosechados = new Set();
    if (typeof window !== "undefined") {
      timerBatcher = setInterval(() => {
        void ciclo();
      }, BATCHER_MS);
    }
    // Backlog: el arranque re-lee el outbox (modo avión → envía al recuperar).
    void (async () => {
      try {
        await reactivarPresupuesto();
        estado.lotesPendientes = await contarLotes();
        await soloPendientes();
      } catch {
        /* silencioso */
      }
    })();
  } catch {
    /* silencioso — el transporte jamás rompe el bootstrap */
  }
}

/** Estado visible para el panel dev del agente 2 (contrato §4.3). */
export function estadoTransporte(): {
  activo: boolean;
  lotesPendientes: number;
  fallosSeguidos: number;
} {
  return { ...estado };
}

/** Prueba interna (tests): reset del estado del módulo (patrón flags.ts). */
export function __resetTransporteParaTest(): void {
  limpiarTimers();
  estado = { activo: false, lotesPendientes: 0, fallosSeguidos: 0 };
  enviando = false;
  idsCosechados = new Set();
  dbSingleton = null;
}
