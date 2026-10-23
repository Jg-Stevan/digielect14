"use client";

/**
 * KIT e65b-historico-enviadas-v1 (T-1): LEDGER PERSISTENTE de actas enviadas.
 * El hecho «fue enviada» vive en el envío, no en la cola (REVERSA de D-e65-8
 * → D-e65b-1): sobrevive vaciar() y recargas. SOLO LLAVES de dedup — jamás
 * Blob/acta/dataURL (lección L7). DB SEPARADA de la cola (e14-masiva-v1
 * intocada — cero migración). Todo fallo es conservador: el caller sigue su
 * curso (RL-e65b-3).
 *
 * Patrón IDB: el MISMO de abrirCola() en cola.ts (singleton + onupgradeneeded
 * + onclose + rechazo claro) — cero dependencias nuevas (RL-e65b-4).
 */
const DB_NOMBRE = "e14-masiva-historico-v1";
const DB_VERSION = 1;
const STORE = "llaves"; // keyPath "id" — un registro por fila enviada

export type EntradaHistorica = {
  id: string; // id del registro masiva enviado (re-put idempotente)
  ts: number; // momento del envío
  hashBytes?: string; // SHA-256 hex 64 (capa bytes — e65)
  hashDedup?: string; // dhash hex 16 (capa visual — D65)
  payloadQr?: string; // llave opaca del QR (capa 0 — jamás se parsea)
  serie?: string; // SOLO informativa (jamás llave de dedup — RL-e65b-8)
};

let dbSingleton: IDBDatabase | null = null;

/** Abrir (singleton) — MISMO patrón de abrirCola() en cola.ts. Rechazo CLARO
 *  si IndexedDB no está disponible → el caller decide (conservador). */
function abrirHistorico(): Promise<IDBDatabase> {
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      dbSingleton = req.result;
      // Higiene: si el navegador cierra la conexión, el próximo abrir re-crea.
      dbSingleton.onclose = () => {
        dbSingleton = null;
      };
      resolve(dbSingleton);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB_NO_ABRIO"));
    req.onblocked = () => reject(new Error("IDB_BLOQUEADA"));
  });
}

function transaccion(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, modo).objectStore(STORE);
}

/** put en transacción readwrite — await del tx.oncomplete. throw = el caller
 *  decide (registrarEnviadaHistorico en store.ts lo traga — fire-and-forget,
 *  RL-e65b-2/3). Idempotente: re-put del MISMO id actualiza las llaves. */
export async function registrarEntradaHistorico(e: EntradaHistorica): Promise<void> {
  const db = await abrirHistorico();
  const store = transaccion(db, "readwrite");
  store.put(e);
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_HISTORICO_PUT"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_HISTORICO_PUT_ABORTADA"));
  });
}

/** getAll() — los registros son llaves chicas (~100 B c/u); miles de entradas
 *  son triviales; NUNCA retiene Blob (lección L7). Consumido por
 *  indiceEnviadasDe() en store.ts (índice fusionado ledger+cola — T-2b). */
export async function listarHistorico(): Promise<EntradaHistorica[]> {
  const db = await abrirHistorico();
  const store = transaccion(db, "readonly");
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve((req.result ?? []) as EntradaHistorica[]);
    req.onerror = () => reject(req.error ?? new Error("IDB_HISTORICO_LISTAR"));
  });
}

/** clear() — e65b: SOLO para utilidad futura del dueño, SIN cablear a
 *  vaciar() en producción (RL-e65b-5 — REVERSA de D-e65b-1: el histórico
 *  sobrevive la cola; la cola es el taller, el envío es el hecho).
 *  e64p (C-1/C-2 — MODO PRUEBAS): cableada en store.ts SOLO bajo !COLA_PERSISTENTE
 *  — la memoria de enviadas muere con la sesión/limpiar (la cola arranca
 *  vacía y el dueño re-prueba de cero). En producción
 *  (COLA_PERSISTENTE=true) sigue SIN cablear (D-e65b-1 intacta). */
export async function borrarHistorico(): Promise<void> {
  const db = await abrirHistorico();
  const store = transaccion(db, "readwrite");
  store.clear();
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_HISTORICO_BORRAR"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_HISTORICO_BORRAR_ABORTADA"));
  });
}
