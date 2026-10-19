/**
 * KIT e14-carga-masiva-v1 (T1): cola PERSISTENTE del módulo MASIVA —
 * IndexedDB VANILLA (kit §0.3: package.json/bun.lock INTOCABLES — cero
 * dependencias nuevas). UN solo store «archivos» (keyPath id → RegistroMasiva
 * completo): el File original duerme aquí (no en RAM) y el acta completa
 * queda junto a él tras procesar (recortable en REVISIÓN, F5).
 * Errores de IDB NUNCA tumban la UI (kit §3): el caller decide — la entrada
 * afectada pasa a ERROR con motivo corto / la vista pinta su píldora.
 */
import type { RegistroMasiva } from "./tipos";

const DB_NOMBRE = "e14-masiva-v1";
const DB_VERSION = 1;
const STORE = "archivos";

let dbSingleton: IDBDatabase | null = null;

/** Abrir (singleton). Rechazo CLARO si IndexedDB no está disponible → la
 *  vista muestra la píldora «TU NAVEGADOR NO SOPORTA LA COLA — IMPORTA DE
 *  A UNA EN ESCANEAR» (kit §3). */
export function abrirCola(): Promise<IDBDatabase> {
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

/** Envolver un request IDB en promesa — error con contexto corto (kit §3:
 *  motivo corto, nunca tumba la UI; el catch del caller clasifica). */
function pedir<T>(req: IDBRequest<T>, contexto: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(contexto));
  });
}

function transaccion(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, modo).objectStore(STORE);
}

let contadorId = 0;

/** 1 registro por File, id «masiva-<ts>-<contador>», estado PENDIENTE.
 *  Una sola transacción (lote atómico): todo entra o nada entra. */
export async function agregarLote(files: File[]): Promise<string[]> {
  const db = await abrirCola();
  const store = transaccion(db, "readwrite");
  const ahora = Date.now();
  const ids: string[] = [];
  files.forEach((file, i) => {
    const id = `masiva-${ahora}-${contadorId++}`;
    const registro: RegistroMasiva = {
      id,
      nombre: file.name || `FOTO_${i + 1}`,
      agregadaEn: ahora + i, // FIFO estable DENTRO del lote (orden de suelta)
      estado: "PENDIENTE",
      archivo: file,
    };
    ids.push(id);
    store.put(registro);
  });
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_AGREGAR"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_AGREGAR_ABORTADA"));
  });
  return ids;
}

export async function guardarRegistro(registro: RegistroMasiva): Promise<void> {
  const db = await abrirCola();
  const store = transaccion(db, "readwrite");
  store.put(registro);
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_GUARDAR"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_GUARDAR_ABORTADA"));
  });
}

export async function leerRegistro(id: string): Promise<RegistroMasiva> {
  const db = await abrirCola();
  const store = transaccion(db, "readonly");
  const registro = await pedir<RegistroMasiva | undefined>(
    store.get(id),
    "IDB_LEER",
  );
  if (!registro) throw new Error("REGISTRO_FUERA_DE_LA_COLA");
  return registro;
}

/** Listar SIN materializar todo de golpe: cursor uno-a-uno — cada registro
 *  (Blob + acta con dataURLs) vive un instante y se libera al mapearlo a
 *  fila liviana (lección L7). */
export async function listarRegistros(): Promise<RegistroMasiva[]> {
  const db = await abrirCola();
  const store = transaccion(db, "readonly");
  const req = store.openCursor();
  const registros: RegistroMasiva[] = [];
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      registros.push(cursor.value as RegistroMasiva);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("IDB_LISTAR"));
  });
  return registros;
}

export async function borrar(id: string): Promise<void> {
  const db = await abrirCola();
  const store = transaccion(db, "readwrite");
  store.delete(id);
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_BORRAR"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_BORRAR_ABORTADA"));
  });
}

export async function vaciar(): Promise<void> {
  const db = await abrirCola();
  const store = transaccion(db, "readwrite");
  store.clear();
  const tx = store.transaction;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_VACIAR"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_VACIAR_ABORTADA"));
  });
}

/** Recuperación de caída (kit §3): TODO estado PROCESANDO vuelve a
 *  PENDIENTE — una app que murió a mitad de OCR no debe dejar entradas
 *  zombis. Se llama en el arranque de MASIVA (T4, cargarFilas). */
export async function recuperarCola(): Promise<void> {
  const registros = await listarRegistros();
  const zombis = registros.filter((r) => r.estado === "PROCESANDO");
  for (const r of zombis) {
    await guardarRegistro({ ...r, estado: "PENDIENTE" });
  }
}
