/**
 * KIT e14-puente-supervision-v1 (§2) — OUTBOX IndexedDB PROPIO del puente
 * (patrón EXACTO de jornada.ts: DB VANILLA sin dependencias, promesas
 * envueltas, higiene onclose, singleton; gemelo de obs/transporte.ts).
 *
 * DB `e14-puente-v1` v1 — store ÚNICO `pendientes` (keyPath `hash`).
 * JAMÁS abre `e14-obs` ni `e14-obs-outbox` ni `e14-jornada-v1`: el outbox
 * del puente vive solo (un fallo de IDB del puente no puede contaminar al
 * resto, y viceversa — misma filosofía §4.1 del transporte obs).
 *
 * Registro: { hash, entrada: EntradaPuente, ts, intentos }.
 *  · hash — SHA-256 (crypto.subtle, hex minúsculas) del contenido de la
 *    entrada (id + página + huella barata de la foto): la llave de
 *    DEDUPLICACIÓN — encolar dos veces la misma acta es un put idempotente.
 *    Sin contexto seguro (http://) crypto.subtle no existe → fallback
 *    FNV-1a 32-bit (idDispositivo usa el mismo criterio de degradación
 *    honesta) — la dedupe sigue funcionando, solo con más colisiones.
 * · intentos — cargo de reintentos (los reactiva sincronizarAhora()).
 *
 * Sin IndexedDB (SSR/tests) → TODAS las funciones resuelven con valores
 * vacíos sin lanzar (regla de oro: el puente jamás rompe la app).
 */
import type { EntradaPuente } from "./tipos";

const DB_NOMBRE = "e14-puente-v1";
const DB_VERSION = 1;
const STORE_PENDIENTES = "pendientes";

/** Fila del outbox (store `pendientes`, keyPath `hash`). */
export interface RegistroPendiente {
  hash: string;
  entrada: EntradaPuente;
  ts: number;
  intentos: number;
}

let dbSingleton: IDBDatabase | null = null;

/** Abrir el outbox (singleton idempotente — patrón jornada.ts). */
function abrirPuente(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbSingleton) {
      resolve(dbSingleton);
      return;
    }
    if (typeof indexedDB === "undefined") {
      reject(new Error("SIN_INDEXEDDB"));
      return;
    }
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PENDIENTES)) {
        db.createObjectStore(STORE_PENDIENTES, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => {
      dbSingleton = req.result;
      // Higiene (patrón jornada.ts): conexión cerrada → re-abrir después.
      dbSingleton.onclose = () => {
        dbSingleton = null;
      };
      resolve(dbSingleton);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB_PUENTE_NO_ABRIO"));
    req.onblocked = () => reject(new Error("IDB_PUENTE_BLOQUEADA"));
  });
}

/** Envolver un request IDB en promesa (patrón jornada.ts). */
function pedir<T>(req: IDBRequest<T>, contexto: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(contexto));
  });
}

/** Esperar el cierre de una transacción (patrón obs/transporte.ts). */
function esperarTx(store: IDBObjectStore, contexto: string): Promise<void> {
  const tx = store.transaction;
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(contexto));
    tx.onabort = () => reject(tx.error ?? new Error(`${contexto}_ABORTADA`));
  });
}

function storeDe(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_PENDIENTES, modo).objectStore(STORE_PENDIENTES);
}

// ─── Hash de deduplicación (SHA-256 estable del contenido) ──────────────────

/** Huella del ENLACE del acta: identidad de mesa/página + tres ventanas de
 *  la foto (largo + primeros 512 + últimos 256 chars del dataURL) — barata
 *  de calcular y suficiente para distinguir gemelas reales de re-encoladas. */
function semillaDe(entrada: EntradaPuente): string {
  const foto = entrada.srcFoto;
  return `${entrada.idEnlace}|${entrada.mesa}|${entrada.formulario}|${entrada.paginaIndex}|${entrada.nombreArchivo}|${foto?.length ?? 0}|${foto ? foto.slice(0, 512) : ""}|${foto ? foto.slice(-256) : ""}`;
}

/** FNV-1a 32-bit → hex (mismo helper que obs/identidad.fnv1a8 — duplicado
 *  a propósito: el puente NO importa obs para mantener el kit autónomo). */
function fnv1a8(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** SHA-256 de la semilla → hex minúsculas; sin crypto.subtle (SSR, contexto
 *  no seguro) → FNV-1a con prefijo `f-` (espacio de llaves separado). */
async function hashDeEntrada(entrada: EntradaPuente): Promise<string> {
  const semilla = semillaDe(entrada);
  try {
    const sutil = globalThis.crypto?.subtle;
    if (!sutil) throw new Error("SIN_CRYPTO_SUBTLE");
    const bytes = new TextEncoder().encode(semilla);
    const digest = await sutil.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return hex;
  } catch {
    return `f-${fnv1a8(semilla)}`;
  }
}

// ─── API del outbox (todo falla SUAVE — valores vacíos, jamás lanza) ───────

/** Encolar una entrada (put idempotente por hash — re-encolar la misma acta
 *  SOBREESCRIBE la fila: sin duplicados, sin error). */
export async function encolarActa(entrada: EntradaPuente): Promise<void> {
  try {
    const hash = await hashDeEntrada(entrada);
    const db = await abrirPuente();
    const store = storeDe(db, "readwrite");
    store.put({ hash, entrada, ts: Date.now(), intentos: 0 });
    await esperarTx(store, "PUENTE_ENCOLAR");
  } catch {
    /* sin IDB / hash imposible → la acta no viaja por el puente (silencioso) */
  }
}

/** Pendientes en orden FIFO (ts ASC — los viejos salen primero). */
export async function leerPendientes(): Promise<RegistroPendiente[]> {
  try {
    const db = await abrirPuente();
    const filas = await pedir<RegistroPendiente[]>(
      storeDe(db, "readonly").getAll() as IDBRequest<RegistroPendiente[]>,
      "PUENTE_LEER",
    );
    return filas.sort((a, b) => a.ts - b.ts || (a.hash < b.hash ? -1 : 1));
  } catch {
    return []; // SSR/tests/IDB caída → cola vacía (silencioso)
  }
}

export async function borrarPendiente(hash: string): Promise<void> {
  try {
    const db = await abrirPuente();
    const store = storeDe(db, "readwrite");
    store.delete(hash);
    await esperarTx(store, "PUENTE_BORRAR");
  } catch {
    /* silencioso */
  }
}

export async function contarPendientes(): Promise<number> {
  try {
    const db = await abrirPuente();
    return await pedir<number>(
      storeDe(db, "readonly").count(),
      "PUENTE_CONTAR",
    );
  } catch {
    return 0; // SSR/tests → cero (silencioso)
  }
}

/** Cargar intentos de una fila (persistido — sobrevive recargas). */
export async function marcarIntentos(hash: string, intentos: number): Promise<void> {
  try {
    const db = await abrirPuente();
    const fila = await pedir<RegistroPendiente | undefined>(
      storeDe(db, "readonly").get(hash),
      "PUENTE_LEER_FILA",
    );
    if (!fila) return;
    const store = storeDe(db, "readwrite");
    store.put({ ...fila, intentos });
    await esperarTx(store, "PUENTE_INTENTOS");
  } catch {
    /* silencioso — la fila queda con su intento anterior */
  }
}
